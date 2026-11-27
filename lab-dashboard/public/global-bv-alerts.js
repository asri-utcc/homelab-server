(() => {
  'use strict';

  const STYLE_ID = 'hbv-alert-styles';
  const BC_NAME = 'homelab_bv_alerts_v1';
  const STORE_KEY = 'homelab_bv_alerts_store_v1';
  const DISMISS_KEY = 'homelab_bv_alerts_dismissed_v1';
  const COLLAPSE_KEY = 'homelab_bv_alerts_collapsed_v1';
  const OPEN_ROOMS_KEY = 'bv_open_rooms';

  const ALERT_TTL_MS = 45 * 60 * 1000;      // 45 minutes
  const DISMISS_TTL_MS = 10 * 60 * 1000;    // 10 minutes
  const POLL_INTERVAL_MS = 4000;            // 4 seconds
  const ALERTS_404_BACKOFF_MS = 60000;      // 60 seconds when /alerts returns 404 (pre-restart)
  const SOCIAL_POLL_INTERVAL_MS = 15000;    // 15 seconds fallback social queue check
  const MAX_FALLBACK_ROOMS = 3;

  let inFrame = false;
  try { inFrame = window.top !== window.self; } catch (_) { inFrame = true; }

  const KIND_META = {
    login: {
      icon: '🔐',
      badge: '🔐 ต้องล็อกอินใน Browser Vision',
      defaultTitle: 'AI หยุดรอคุณล็อกอิน',
      defaultDetail: 'กรุณาเข้าสู่ระบบในหน้า Browser Vision แล้วกด "เสร็จแล้ว (ให้ AI ทำต่อ)"',
      urgent: false,
    },
    captcha: {
      icon: '🛡️',
      badge: '🛡️ ติด CAPTCHA',
      defaultTitle: 'ติด CAPTCHA ต้องยืนยันตัวตน',
      defaultDetail: 'กรุณาแก้ CAPTCHA หรือยืนยันตัวตนใน Browser Vision เพื่อให้ AI ทำงานต่อ',
      urgent: true,
    },
    otp: {
      icon: '🔢',
      badge: '🔢 รหัส OTP',
      defaultTitle: 'ต้องกรอกรหัส OTP / 2FA',
      defaultDetail: 'กรุณากรอกรหัสยืนยันตัวตนใน Browser Vision แล้วกด "เสร็จแล้ว (ให้ AI ทำต่อ)"',
      urgent: true,
    },
    payment: {
      icon: '💳',
      badge: '💳 หน้าชำระเงิน',
      defaultTitle: 'AI หยุดรอตรวจสอบหน้าชำระเงิน',
      defaultDetail: 'กรุณาตรวจสอบและดำเนินการในหน้าชำระเงินด้วยตนเองใน Browser Vision',
      urgent: true,
    },
    social_upload: {
      icon: '📤',
      badge: '📤 อัปโหลดโซเชียล',
      defaultTitle: 'งานอัปโหลดโซเชียลรอดำเนินการ',
      defaultDetail: 'มีงานโพสต์โซเชียลที่ต้องเปิด Browser Vision เพื่อล็อกอินหรือตรวจสอบ',
      urgent: false,
    },
    handoff: {
      icon: '🤝',
      badge: '🤝 รอคุณดำเนินการ',
      defaultTitle: 'AI ส่งต่อหน้าเว็บให้คุณดำเนินการ',
      defaultDetail: 'กรุณาเปิด Browser Vision เพื่อดำเนินการต่อให้เสร็จ แล้วกด Resume AI',
      urgent: false,
    },
    paused: {
      icon: '⏸️',
      badge: '⏸️ AI หยุดรอ',
      defaultTitle: 'Browser Vision หยุดรอการดำเนินการ',
      defaultDetail: 'AI หยุดรอคุณในหน้าเว็บ กดเปิดหน้า Browser Vision หรือสั่งให้ AI ทำต่อ',
      urgent: false,
    },
  };

  // ── URL & Text Helpers ─────────────────────────────────────────────────────
  const SENSITIVE_HOSTS = new Set([
    'accounts.google.com',
    'login.microsoftonline.com',
    'login.live.com',
    'appleid.apple.com',
    'idmsa.apple.com',
  ]);
  const SENSITIVE_PATH_RE = /(^|[\/_\-.])(signin|sign-in|login|log-in|oauth|oauth2|challenge|2fa|two-factor|mfa|otp|captcha|verify|verification|checkpoint)([\/_\-.]|$)/i;

  function isSensitiveUrl(rawUrl) {
    if (typeof rawUrl !== 'string') return false;
    const t = rawUrl.trim();
    if (!t || t === 'about:blank') return false;
    try {
      const u = new URL(t);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      const host = u.hostname.toLowerCase();
      const pathname = (u.pathname || '/').toLowerCase();
      if (SENSITIVE_HOSTS.has(host)) return true;
      if ((host === 'tiktok.com' || host.endsWith('.tiktok.com')) && pathname.includes('/login')) return true;
      if ((host === 'facebook.com' || host.endsWith('.facebook.com')) && (pathname.includes('/login') || pathname.includes('/checkpoint'))) return true;
      if ((host === 'instagram.com' || host.endsWith('.instagram.com')) && (pathname.includes('/accounts/login') || pathname.includes('/challenge'))) return true;
      return SENSITIVE_PATH_RE.test(pathname);
    } catch (_) {
      return false;
    }
  }

  function sanitizeUrl(rawUrl) {
    if (typeof rawUrl !== 'string') return { url: '', domain: '' };
    const t = rawUrl.trim();
    if (!t || t === 'about:blank') return { url: '', domain: '' };
    try {
      const u = new URL(t);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return { url: '', domain: '' };
      return { url: `${u.origin}${u.pathname}`, domain: u.hostname.toLowerCase() };
    } catch (_) {
      return { url: t.split(/[?#]/)[0], domain: '' };
    }
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeKind(kind) {
    const k = String(kind || 'login').toLowerCase().trim();
    if (KIND_META[k]) return k;
    if (/captcha/.test(k)) return 'captcha';
    if (/otp|2fa|mfa/.test(k)) return 'otp';
    if (/pay|checkout/.test(k)) return 'payment';
    if (/social|upload/.test(k)) return 'social_upload';
    if (/handoff/.test(k)) return 'handoff';
    if (/pause/.test(k)) return 'paused';
    return 'login';
  }

  function normalizeAlert(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const kind = normalizeKind(raw.kind);
    const meta = KIND_META[kind] || KIND_META.login;
    const chatId = raw.chatId ? String(raw.chatId).trim() : null;
    const sessionName = raw.sessionName ? String(raw.sessionName).trim() : (chatId ? `bv_${chatId}` : null);
    const sourceType = raw.sourceType === 'social' || raw.sourceType === 'browser' ? raw.sourceType : (chatId ? 'chat' : 'browser');
    const platform = raw.platform ? String(raw.platform).trim() : null;
    const roomTitle = raw.roomTitle ? String(raw.roomTitle).trim() : null;
    const urlInfo = sanitizeUrl(raw.url || '');
    const domain = raw.domain ? String(raw.domain).trim() : urlInfo.domain;

    let browserVisionUrl = raw.browserVisionUrl ? String(raw.browserVisionUrl).trim() : '';
    if (!browserVisionUrl) {
      if (chatId) {
        browserVisionUrl = `/gemini?session=${encodeURIComponent(chatId)}&bv=1`;
      } else if (sessionName && sessionName.startsWith('bv_labweb_')) {
        const profile = sessionName.slice('bv_labweb_'.length);
        browserVisionUrl = `/lab-browser?profile=${encodeURIComponent(profile)}`;
      } else {
        browserVisionUrl = '/lab-browser';
      }
    }

    const id = raw.id
      ? String(raw.id).trim()
      : `${sourceType}:${chatId || sessionName || platform || domain || 'global'}:${kind}`;

    const ts = Number.isFinite(Number(raw.ts)) && Number(raw.ts) > 0 ? Number(raw.ts) : Date.now();

    return {
      id,
      kind,
      title: String(raw.title || meta.defaultTitle).trim(),
      detail: String(raw.detail || meta.defaultDetail).trim(),
      sourceType,
      chatId,
      sessionName,
      roomTitle,
      platform,
      domain,
      url: urlInfo.url,
      browserVisionUrl,
      ts,
      _origin: raw._origin || (id.startsWith('srv:') ? 'server' : 'client'),
    };
  }

  // ── Shared Storage & Sync (localStorage + BroadcastChannel) ────────────────
  let bc = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel(BC_NAME);
    }
  } catch (_) { bc = null; }

  function readStoreMap() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const now = Date.now();
      const cleaned = {};
      let mutated = false;
      for (const [k, v] of Object.entries(parsed)) {
        if (!v || typeof v !== 'object' || !v.id) { mutated = true; continue; }
        const age = now - (Number(v.ts) || 0);
        if (age > ALERT_TTL_MS) { mutated = true; continue; }
        cleaned[k] = v;
      }
      if (mutated) {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(cleaned)); } catch (_) {}
      }
      return cleaned;
    } catch (_) {
      return {};
    }
  }

  function writeStoreMap(map) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(map));
    } catch (_) {}
  }

  function readDismissMap() {
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== 'object') return {};
      const now = Date.now();
      const cleaned = {};
      for (const [k, exp] of Object.entries(parsed)) {
        if (Number(exp) > now) cleaned[k] = Number(exp);
      }
      return cleaned;
    } catch (_) {
      return {};
    }
  }

  function writeDismissMap(map) {
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
    } catch (_) {}
  }

  function getCanonicalKey(alert) {
    if (!alert || typeof alert !== 'object') return '';
    if (alert.chatId) return `chat:${String(alert.chatId).trim()}`;
    if (alert.sessionName) {
      const sn = String(alert.sessionName).trim();
      if (sn) return `sess:${sn}`;
    }
    return String(alert.id || '').trim();
  }

  function isDismissed(alert, dismissMap) {
    const now = Date.now();
    const checkExp = (exp) => {
      if (!exp || exp <= now) return false;
      // If a fresh event arrived AFTER the dismissal was created, surface it again
      const dismissedAt = exp - DISMISS_TTL_MS;
      if (Number(alert.ts) > dismissedAt + 1500) return false;
      return true;
    };
    if (checkExp(dismissMap[alert.id])) return true;
    const ck = getCanonicalKey(alert);
    if (ck && checkExp(dismissMap[`ck:${ck}`])) return true;
    return false;
  }

  function isGenericDetail(detail, kind) {
    const d = String(detail || '').trim();
    if (!d) return true;
    const meta = KIND_META[kind] || KIND_META.login;
    if (d === meta.defaultDetail) return true;
    if (Object.values(KIND_META).some((m) => m.defaultDetail === d)) return true;
    if (d.endsWith('กรุณาเปิด Browser Vision เพื่อดำเนินการต่อแล้วกด Resume')) return true;
    return false;
  }

  function isGenericTitle(title, kind) {
    const t = String(title || '').trim();
    if (!t) return true;
    const meta = KIND_META[kind] || KIND_META.login;
    return t === meta.defaultTitle || Object.values(KIND_META).some((m) => m.defaultTitle === t);
  }

  function mergeAlertGroup(group) {
    if (group.length === 1) return group[0];
    // Sort newest first; prefer entries with more complete metadata on tie
    group.sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
    const merged = { ...group[0] };
    let maxTs = Number(merged.ts) || 0;

    for (let i = 1; i < group.length; i++) {
      const item = group[i];
      const itemTs = Number(item.ts) || 0;
      if (itemTs > maxTs) maxTs = itemTs;

      if (!merged.roomTitle && item.roomTitle) merged.roomTitle = item.roomTitle;
      if (!merged.platform && item.platform) merged.platform = item.platform;
      if (!merged.chatId && item.chatId) merged.chatId = item.chatId;
      if (!merged.sessionName && item.sessionName) merged.sessionName = item.sessionName;
      if (!merged.url && item.url) merged.url = item.url;
      if (!merged.domain && item.domain) merged.domain = item.domain;
      if ((!merged.browserVisionUrl || merged.browserVisionUrl === '/lab-browser') && item.browserVisionUrl && item.browserVisionUrl !== '/lab-browser') {
        merged.browserVisionUrl = item.browserVisionUrl;
      }

      // Upgrade generic kind ('paused' / 'handoff') to a more specific kind if available
      if ((merged.kind === 'paused' || merged.kind === 'handoff') && item.kind && item.kind !== 'paused' && item.kind !== 'handoff') {
        merged.kind = item.kind;
      }

      // Prefer non-generic title and detail (e.g., merge client roomTitle/chat snippet with server alert)
      if (isGenericTitle(merged.title, merged.kind) && item.title && !isGenericTitle(item.title, item.kind)) {
        merged.title = item.title;
      }
      if (isGenericDetail(merged.detail, merged.kind) && item.detail && !isGenericDetail(item.detail, item.kind)) {
        merged.detail = item.detail;
      }
    }

    merged.ts = maxTs;
    return merged;
  }

  function getActiveAlerts() {
    const store = readStoreMap();
    const dismissMap = readDismissMap();
    const groups = new Map();
    for (const item of Object.values(store)) {
      if (isDismissed(item, dismissMap)) continue;
      const ck = getCanonicalKey(item) || item.id;
      if (!groups.has(ck)) groups.set(ck, []);
      groups.get(ck).push(item);
    }
    const list = [];
    for (const group of groups.values()) {
      list.push(mergeAlertGroup(group));
    }
    list.sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
    return list;
  }

  function postBroadcast(msg) {
    if (!bc) return;
    try { bc.postMessage(msg); } catch (_) {}
  }

  // ── Smart Chat Message Detector ────────────────────────────────────────────
  const ACTION_CUE_RE = /(?:กรุณา|รบกวน|ช่วยเข้าไป|เข้าไป(?:ล็อกอิน|เข้าสู่ระบบ|ยืนยัน|กรอก|แก้|กด|ดำเนินการ)|กด\s*(?:ปุ่ม\s*)?(?:resume|เสร็จแล้ว|ให้\s*ai\s*ทำต่อ|ดำเนินการต่อ)|รอคุณ|หยุดรอ|ดำเนินการในเบราว์เซอร์|ล็อกอินให้หน่อย|ล็อกอินก่อน|แก้\s*captcha|กรอก\s*(?:รหัส\s*)?otp|please\s+(?:log\s*in|sign\s*in|verify|solve|complete|enter|resume)|waiting\s+for\s+you|manual\s+(?:login|verification|action))/i;
  const CONTEXT_CUE_RE = /(?:browser\s*vision|หน้าจอด้านขวา|หน้าต่างเบราว์เซอร์|ล็อกอิน|เข้าสู่ระบบ|log\s*in|sign\s*in|captcha|recaptcha|turnstile|otp|2fa|ยืนยันตัวตน|verify\s+your|หน้าชำระเงิน|checkout)/i;
  const DIRECT_BV_HANDOFF_RE = /(?:browser\s*vision|หน้าจอด้านขวา)[\s\S]{0,120}(?:ล็อกอิน|เข้าสู่ระบบ|login|sign\s*in|captcha|otp|2fa|ยืนยัน|resume|หยุดรอ|กดปุ่ม)/i;

  function detectChatMessage(text, chatId, roomTitle) {
    if (typeof text !== 'string') return null;
    // Strip code blocks & inline code so documentation/code snippets don't trigger false alerts
    const stripped = text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`\n]+`/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (stripped.length < 12) return null;

    const hasDirectHandoff = DIRECT_BV_HANDOFF_RE.test(stripped);
    const hasActionAndContext = ACTION_CUE_RE.test(stripped) && CONTEXT_CUE_RE.test(stripped);
    if (!hasDirectHandoff && !hasActionAndContext) return null;

    let kind = 'login';
    if (/captcha|recaptcha|turnstile|cloudflare/i.test(stripped)) {
      kind = 'captcha';
    } else if (/\botp\b|\b2fa\b|\bmfa\b|รหัสยืนยัน|รหัสผ่านครั้งเดียว/i.test(stripped)) {
      kind = 'otp';
    } else if (/ชำระเงิน|checkout|payment|บัตรเครดิต/i.test(stripped)) {
      kind = 'payment';
    } else if (/ล็อกอิน|เข้าสู่ระบบ|log\s*in|sign\s*in|password|รหัสผ่าน/i.test(stripped)) {
      kind = 'login';
    } else {
      kind = 'handoff';
    }

    const urlMatch = stripped.match(/https?:\/\/[^\s)>"'\]}]+/i);
    const urlInfo = urlMatch ? sanitizeUrl(urlMatch[0]) : { url: '', domain: '' };
    const meta = KIND_META[kind] || KIND_META.login;

    // Extract a concise Thai/English snippet (first relevant sentence up to 150 chars)
    const snippet = stripped.length > 150 ? stripped.slice(0, 147) + '...' : stripped;

    const alert = normalizeAlert({
      id: `chat:${chatId || 'active'}:${kind}`,
      kind,
      title: meta.defaultTitle,
      detail: snippet,
      sourceType: 'chat',
      chatId: chatId || null,
      roomTitle: roomTitle || null,
      url: urlInfo.url,
      domain: urlInfo.domain,
      ts: Date.now(),
    });
    if (!alert) return null;
    return api.raise(alert);
  }

  // ── Navigation & Resume Actions ────────────────────────────────────────────
  function dispatchOpenToGeminiIframe(chatId) {
    const frames = document.querySelectorAll('iframe[src*="gemini"]');
    for (const f of frames) {
      try {
        if (f.contentWindow) {
          f.contentWindow.postMessage(
            { type: 'homelab:open-bv-session', chatId, openBrowserVision: true },
            location.origin
          );
        }
      } catch (_) {}
    }
  }

  function openTarget(alertOrId) {
    const alert = typeof alertOrId === 'string'
      ? getActiveAlerts().find((a) => a.id === alertOrId)
      : alertOrId;
    if (!alert) return;

    const pathname = (location.pathname || '/').toLowerCase();
    const isDashboardRoot = pathname === '/' || pathname === '/index.html';
    const isGeminiPage = pathname === '/gemini' || pathname === '/gemini.html';

    if (alert.chatId) {
      if (isDashboardRoot) {
        try {
          if (typeof window.switchView === 'function') {
            window.switchView('terminal');
          } else {
            const btn = document.querySelector('.sidebar__item[data-view="terminal"]')
              || document.querySelector('.mobile-nav-btn[data-view="terminal"]');
            if (btn) btn.click();
          }
          const geminiSubtab = document.querySelector('.term-subtab[data-term-subtab="gemini"]');
          if (geminiSubtab && !geminiSubtab.classList.contains('active') && !geminiSubtab.classList.contains('is-active')) {
            geminiSubtab.click();
          }
        } catch (_) {}
        dispatchOpenToGeminiIframe(alert.chatId);
        setTimeout(() => dispatchOpenToGeminiIframe(alert.chatId), 350);
        return;
      }
      if (isGeminiPage) {
        if (typeof window.__homelabOpenBvSession === 'function') {
          try { window.__homelabOpenBvSession(alert.chatId); return; } catch (_) {}
        }
        try {
          window.postMessage(
            { type: 'homelab:open-bv-session', chatId: alert.chatId, openBrowserVision: true },
            location.origin
          );
          return;
        } catch (_) {}
      }
    }

    const targetUrl = alert.browserVisionUrl
      || (alert.chatId ? `/gemini?session=${encodeURIComponent(alert.chatId)}&bv=1` : '/lab-browser');
    if (inFrame) {
      try {
        window.top.location.href = targetUrl;
        return;
      } catch (_) {}
    }
    window.location.href = targetUrl;
  }

  async function resumeTarget(alertOrId) {
    const alert = typeof alertOrId === 'string'
      ? getActiveAlerts().find((a) => a.id === alertOrId)
      : alertOrId;
    if (!alert) return { ok: false };

    const chatParam = alert.chatId
      || (alert.sessionName && alert.sessionName.startsWith('bv_') ? alert.sessionName.slice(3) : alert.sessionName);

    let resOk = true;
    if (chatParam) {
      try {
        const res = await fetch('/api/browser-vision/resume', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat: chatParam,
            note: 'User completed login/verification via Global Sticky Alert',
          }),
        });
        resOk = res.ok;
      } catch (_) {
        resOk = false;
      }
    }

    api.resolve(alert.id);
    if (alert.chatId) api.resolve(alert.chatId);
    if (alert.sessionName) api.resolve(alert.sessionName);
    return { ok: resOk };
  }

  // ── Core State Operations (shared between iframe & top-level) ──────────────
  function emitUpdatedEvent(alerts) {
    try {
      window.dispatchEvent(new CustomEvent('homelab:bv-alerts-updated', {
        detail: { alerts: Array.isArray(alerts) ? alerts : getActiveAlerts() },
      }));
    } catch (_) {}
  }

  let onStateChanged = () => {};

  function raiseAlert(rawAlert, opts = {}) {
    const normalized = normalizeAlert(rawAlert);
    if (!normalized) return null;

    const store = readStoreMap();
    const prev = store[normalized.id];
    const isNew = !prev;
    store[normalized.id] = {
      ...prev,
      ...normalized,
      ts: normalized.ts || Date.now(),
    };
    writeStoreMap(store);

    if (!opts.fromSync) {
      postBroadcast({ type: 'raise', alert: store[normalized.id] });
      if (inFrame) {
        try {
          window.top.postMessage({ type: 'homelab:bv-alert-raise', alert: store[normalized.id] }, location.origin);
        } catch (_) {}
      }
    }

    onStateChanged({ isNew, raisedAlert: store[normalized.id] });
    return store[normalized.id];
  }

  function resolveAlert(idOrChatOrSession, opts = {}) {
    const key = String(idOrChatOrSession || '').trim();
    if (!key) return false;
    const store = readStoreMap();
    const targetCanonical = store[key] ? getCanonicalKey(store[key]) : '';
    let removed = false;
    for (const [id, item] of Object.entries(store)) {
      if (
        id === key
        || item.chatId === key
        || item.sessionName === key
        || (`bv_${key}` === item.sessionName)
        || (targetCanonical && getCanonicalKey(item) === targetCanonical)
      ) {
        delete store[id];
        removed = true;
      }
    }
    if (removed) writeStoreMap(store);

    if (!opts.fromSync) {
      postBroadcast({ type: 'resolve', key });
      if (inFrame) {
        try {
          window.top.postMessage({ type: 'homelab:bv-alert-resolve', key }, location.origin);
        } catch (_) {}
      }
    }

    if (removed || opts.forceRender) onStateChanged({ isNew: false });
    return removed;
  }

  function dismissAlert(id, opts = {}) {
    const key = String(id || '').trim();
    if (!key) return false;
    const map = readDismissMap();
    const until = Date.now() + DISMISS_TTL_MS;
    map[key] = until;

    // Also dismiss every alert in the store sharing the same canonical session key
    const store = readStoreMap();
    const targetItem = store[key];
    const targetCanonical = targetItem ? getCanonicalKey(targetItem) : '';
    if (targetCanonical) {
      map[`ck:${targetCanonical}`] = until;
      for (const [storeId, item] of Object.entries(store)) {
        if (getCanonicalKey(item) === targetCanonical) {
          map[storeId] = until;
        }
      }
    }
    writeDismissMap(map);

    if (!opts.fromSync) {
      postBroadcast({ type: 'dismiss', id: key, until });
      if (inFrame) {
        try {
          window.top.postMessage({ type: 'homelab:bv-alert-dismiss', id: key }, location.origin);
        } catch (_) {}
      }
    }

    onStateChanged({ isNew: false });
    return true;
  }

  const api = {
    raise: (alert) => raiseAlert(alert, { fromSync: false }),
    resolve: (idOrChatOrSession) => resolveAlert(idOrChatOrSession, { fromSync: false }),
    dismiss: (id) => dismissAlert(id, { fromSync: false }),
    list: () => getActiveAlerts(),
    openTarget,
    resumeTarget,
    detectChatMessage,
    isSensitiveUrl,
  };

  window.HomelabBVAlerts = api;

  // ── Iframe Mode: Bridge only, never render duplicate overlay UI ────────────
  if (inFrame) {
    onStateChanged = () => {
      emitUpdatedEvent(getActiveAlerts());
    };
    if (bc) {
      bc.onmessage = () => emitUpdatedEvent(getActiveAlerts());
    }
    window.addEventListener('storage', (e) => {
      if (e.key === STORE_KEY || e.key === DISMISS_KEY) {
        emitUpdatedEvent(getActiveAlerts());
      }
    });
    return;
  }

  // ── Top-Level Window Only: Floating Sticky Alert UI + Polling ──────────────
  if (window.__hbvAlertsInitialized) return;
  window.__hbvAlertsInitialized = true;

  const chimedIds = new Set();
  let collapsed = false;
  try { collapsed = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (_) {}

  api.isCollapsed = () => collapsed;
  api.setCollapsed = (val) => {
    collapsed = Boolean(val);
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (_) {}
    renderOverlay();
  };

  function isSoundMuted() {
    try {
      const keys = ['hbv_sound_muted', 'sound_muted', 'lab_sound_muted', 'mute_sounds'];
      for (const k of keys) {
        const v = localStorage.getItem(k);
        if (v === '1' || v === 'true') return true;
      }
    } catch (_) {}
    return false;
  }

  function playSoftChime() {
    if (isSoundMuted()) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const now = ctx.currentTime;
      [587.33, 880].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const start = now + idx * 0.12;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(0.05, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0008, start + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.24);
      });
    } catch (_) {}
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .hbv-stack {
        position: fixed;
        top: 14px;
        right: 16px;
        z-index: 99990;
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: 400px;
        max-width: calc(100vw - 24px);
        pointer-events: none;
        font-family: system-ui, -apple-system, 'Segoe UI', 'Noto Sans Thai', sans-serif;
      }
      .hbv-stack[hidden] { display: none !important; }
      .hbv-card {
        pointer-events: auto;
        background: rgba(15, 23, 42, 0.95);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        color: #f1f5f9;
        border: 1.5px solid rgba(245, 158, 11, 0.72);
        border-radius: 14px;
        padding: 13px 14px 12px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(245, 158, 11, 0.2);
        animation: hbv-slide-in 0.24s cubic-bezier(0.22, 1, 0.36, 1), hbv-pulse-amber 2.2s ease-in-out infinite;
      }
      .hbv-card[data-urgent="true"] {
        border-color: rgba(239, 68, 68, 0.82);
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.58), 0 0 0 1px rgba(239, 68, 68, 0.25);
        animation: hbv-slide-in 0.24s cubic-bezier(0.22, 1, 0.36, 1), hbv-pulse-red 1.8s ease-in-out infinite;
      }
      @keyframes hbv-slide-in {
        from { opacity: 0; transform: translateY(-10px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes hbv-pulse-amber {
        0%, 100% { box-shadow: 0 14px 36px rgba(0, 0, 0, 0.52), 0 0 0 0 rgba(245, 158, 11, 0.38); }
        50% { box-shadow: 0 14px 36px rgba(0, 0, 0, 0.52), 0 0 0 7px rgba(245, 158, 11, 0); }
      }
      @keyframes hbv-pulse-red {
        0%, 100% { box-shadow: 0 14px 36px rgba(0, 0, 0, 0.55), 0 0 0 0 rgba(239, 68, 68, 0.45); }
        50% { box-shadow: 0 14px 36px rgba(0, 0, 0, 0.55), 0 0 0 8px rgba(239, 68, 68, 0); }
      }
      .hbv-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 6px;
      }
      .hbv-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 3px 9px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.01em;
        background: rgba(245, 158, 11, 0.2);
        color: #fcd34d;
        border: 1px solid rgba(245, 158, 11, 0.42);
      }
      .hbv-card[data-urgent="true"] .hbv-badge {
        background: rgba(239, 68, 68, 0.22);
        color: #fca5a5;
        border-color: rgba(239, 68, 68, 0.48);
      }
      .hbv-head-tools {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }
      .hbv-icon-btn {
        border: 1px solid rgba(148, 163, 184, 0.26);
        background: rgba(30, 41, 59, 0.72);
        color: #cbd5e1;
        border-radius: 7px;
        padding: 3px 7px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        line-height: 1.2;
        transition: background 0.15s ease, color 0.15s ease;
      }
      .hbv-icon-btn:hover {
        background: rgba(51, 65, 85, 0.95);
        color: #ffffff;
      }
      .hbv-title {
        font-size: 14px;
        font-weight: 700;
        color: #f8fafc;
        line-height: 1.35;
        margin-bottom: 4px;
      }
      .hbv-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 6px;
        font-size: 11.5px;
        color: #94a3b8;
      }
      .hbv-meta-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 1px 7px;
        border-radius: 6px;
        background: rgba(30, 41, 59, 0.85);
        border: 1px solid rgba(148, 163, 184, 0.2);
        color: #cbd5e1;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .hbv-detail {
        font-size: 12.5px;
        color: #cbd5e1;
        line-height: 1.45;
        margin-bottom: 10px;
        word-break: break-word;
      }
      .hbv-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
      }
      .hbv-btn {
        flex: 1 1 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        padding: 7px 11px;
        border-radius: 9px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        border: 1px solid transparent;
        transition: transform 0.12s ease, filter 0.15s ease, background 0.15s ease;
        white-space: nowrap;
      }
      .hbv-btn:active { transform: scale(0.98); }
      .hbv-btn:disabled { opacity: 0.55; cursor: not-allowed; }
      .hbv-btn-open {
        background: linear-gradient(135deg, #f59e0b, #ea580c);
        color: #0f172a;
        box-shadow: 0 4px 14px rgba(245, 158, 11, 0.34);
      }
      .hbv-card[data-urgent="true"] .hbv-btn-open {
        background: linear-gradient(135deg, #ef4444, #f97316);
        color: #ffffff;
        box-shadow: 0 4px 14px rgba(239, 68, 68, 0.36);
      }
      .hbv-btn-open:hover:not(:disabled) { filter: brightness(1.08); }
      .hbv-btn-resume {
        background: rgba(22, 163, 74, 0.22);
        border-color: rgba(34, 197, 94, 0.48);
        color: #86efac;
      }
      .hbv-btn-resume:hover:not(:disabled) {
        background: rgba(22, 163, 74, 0.36);
      }
      .hbv-pill {
        pointer-events: auto;
        align-self: flex-end;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 8px 14px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.94);
        border: 1.5px solid rgba(245, 158, 11, 0.8);
        color: #fcd34d;
        font-size: 12.5px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.48);
        animation: hbv-pulse-amber 2s ease-in-out infinite;
      }
      .hbv-pill[data-urgent="true"] {
        border-color: rgba(239, 68, 68, 0.85);
        color: #fca5a5;
        animation: hbv-pulse-red 1.8s ease-in-out infinite;
      }
      .hbv-pill:hover { filter: brightness(1.1); }
      .hbv-more {
        pointer-events: auto;
        align-self: flex-end;
        font-size: 11.5px;
        color: #fcd34d;
        background: rgba(15, 23, 42, 0.88);
        border: 1px solid rgba(245, 158, 11, 0.4);
        border-radius: 999px;
        padding: 3px 10px;
      }

      /* Light theme support */
      :root[data-theme="light"] .hbv-card {
        background: rgba(255, 255, 255, 0.96);
        color: #0f172a;
        border-color: rgba(217, 119, 6, 0.72);
        box-shadow: 0 14px 36px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(217, 119, 6, 0.16);
      }
      :root[data-theme="light"] .hbv-card[data-urgent="true"] {
        border-color: rgba(220, 38, 38, 0.78);
      }
      :root[data-theme="light"] .hbv-title { color: #0f172a; }
      :root[data-theme="light"] .hbv-detail { color: #334155; }
      :root[data-theme="light"] .hbv-badge {
        background: rgba(245, 158, 11, 0.16);
        color: #b45309;
        border-color: rgba(217, 119, 6, 0.38);
      }
      :root[data-theme="light"] .hbv-card[data-urgent="true"] .hbv-badge {
        background: rgba(239, 68, 68, 0.14);
        color: #b91c1c;
        border-color: rgba(220, 38, 38, 0.4);
      }
      :root[data-theme="light"] .hbv-meta-chip {
        background: #f1f5f9;
        border-color: #cbd5e1;
        color: #334155;
      }
      :root[data-theme="light"] .hbv-icon-btn {
        background: #f1f5f9;
        border-color: #cbd5e1;
        color: #475569;
      }
      :root[data-theme="light"] .hbv-icon-btn:hover {
        background: #e2e8f0;
        color: #0f172a;
      }
      :root[data-theme="light"] .hbv-btn-resume {
        background: rgba(22, 163, 74, 0.14);
        border-color: rgba(22, 163, 74, 0.42);
        color: #15803d;
      }
      :root[data-theme="light"] .hbv-pill {
        background: rgba(255, 255, 255, 0.96);
        color: #b45309;
        box-shadow: 0 10px 26px rgba(15, 23, 42, 0.16);
      }
      :root[data-theme="light"] .hbv-pill[data-urgent="true"] {
        color: #b91c1c;
      }
      :root[data-theme="light"] .hbv-more {
        background: rgba(255, 255, 255, 0.94);
        color: #b45309;
      }

      @media (max-width: 640px) {
        .hbv-stack {
          top: 10px;
          right: 10px;
          left: 10px;
          width: auto;
          max-width: none;
        }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureStackEl() {
    let el = document.getElementById('hbv-alert-stack');
    if (el) return el;
    if (!document.body) return null;
    injectStyles();
    el = document.createElement('div');
    el.id = 'hbv-alert-stack';
    el.className = 'hbv-stack';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'แจ้งเตือน Browser Vision');
    document.body.appendChild(el);
    return el;
  }

  function renderOverlay() {
    const alerts = getActiveAlerts();
    emitUpdatedEvent(alerts);

    const stack = ensureStackEl();
    if (!stack) return;

    if (alerts.length === 0) {
      stack.hidden = true;
      stack.innerHTML = '';
      return;
    }

    stack.hidden = false;
    const anyUrgent = alerts.some((a) => (KIND_META[a.kind] || KIND_META.login).urgent);

    if (collapsed) {
      stack.innerHTML = '';
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'hbv-pill';
      pill.dataset.urgent = anyUrgent ? 'true' : 'false';
      pill.title = 'คลิกเพื่อขยายการแจ้งเตือน Browser Vision';
      pill.textContent = `${anyUrgent ? '🛡️' : '🔐'} ${alerts.length} งานรอล็อกอิน`;
      pill.onclick = () => api.setCollapsed(false);
      stack.appendChild(pill);
      return;
    }

    stack.innerHTML = '';
    const visible = alerts.slice(0, 3);
    for (const item of visible) {
      const meta = KIND_META[item.kind] || KIND_META.login;
      const card = document.createElement('div');
      card.className = 'hbv-card';
      card.dataset.alertId = item.id;
      card.dataset.kind = item.kind;
      card.dataset.urgent = meta.urgent ? 'true' : 'false';

      const sourceLabel = item.roomTitle
        ? `💬 ${item.roomTitle}`
        : (item.platform
          ? `📱 ${item.platform}`
          : (item.chatId ? `💬 ห้อง ${item.chatId.slice(0, 14)}` : '🌐 Browser Vision'));

      const domainChip = item.domain
        ? `<span class="hbv-meta-chip" title="${escapeHtml(item.url || item.domain)}">🌐 ${escapeHtml(item.domain)}</span>`
        : '';

      card.innerHTML = `
        <div class="hbv-head">
          <span class="hbv-badge">${escapeHtml(meta.badge)}</span>
          <div class="hbv-head-tools">
            <button type="button" class="hbv-icon-btn" data-act="collapse" title="ย่อเป็นป้ายลอย">ย่อ</button>
            <button type="button" class="hbv-icon-btn" data-act="dismiss" title="ซ่อนชั่วคราว 10 นาที">✕</button>
          </div>
        </div>
        <div class="hbv-title">${escapeHtml(item.title)}</div>
        <div class="hbv-meta">
          <span class="hbv-meta-chip">${escapeHtml(sourceLabel)}</span>
          ${domainChip}
        </div>
        <div class="hbv-detail">${escapeHtml(item.detail)}</div>
        <div class="hbv-actions">
          <button type="button" class="hbv-btn hbv-btn-open" data-act="open">🚀 เปิดหน้าล็อกอินทันที</button>
          <button type="button" class="hbv-btn hbv-btn-resume" data-act="resume">✅ เสร็จแล้ว (ให้ AI ทำต่อ)</button>
        </div>
      `;

      card.querySelector('[data-act="open"]').onclick = () => openTarget(item);
      const btnResume = card.querySelector('[data-act="resume"]');
      btnResume.onclick = async () => {
        btnResume.disabled = true;
        btnResume.textContent = '⏳ กำลังแจ้ง AI...';
        await resumeTarget(item);
      };
      card.querySelector('[data-act="collapse"]').onclick = () => api.setCollapsed(true);
      card.querySelector('[data-act="dismiss"]').onclick = () => api.dismiss(item.id);

      stack.appendChild(card);
    }

    if (alerts.length > visible.length) {
      const more = document.createElement('div');
      more.className = 'hbv-more';
      more.textContent = `+ อีก ${alerts.length - visible.length} รายการรอตรวจสอบ`;
      stack.appendChild(more);
    }
  }

  onStateChanged = ({ isNew, raisedAlert } = {}) => {
    if (isNew && raisedAlert && !chimedIds.has(raisedAlert.id)) {
      chimedIds.add(raisedAlert.id);
      playSoftChime();
    }
    renderOverlay();
  };

  // ── Cross-Tab & Iframe Message Listeners ───────────────────────────────────
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'homelab:bv-alert-raise' && e.data.alert) {
      raiseAlert(e.data.alert, { fromSync: false });
    } else if (e.data.type === 'homelab:bv-alert-resolve' && e.data.key) {
      resolveAlert(e.data.key, { fromSync: false });
    } else if (e.data.type === 'homelab:bv-alert-dismiss' && e.data.id) {
      dismissAlert(e.data.id, { fromSync: false });
    }
  });

  if (bc) {
    bc.onmessage = (e) => {
      const msg = e && e.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'raise' && msg.alert) {
        raiseAlert(msg.alert, { fromSync: true });
      } else if (msg.type === 'resolve' && msg.key) {
        resolveAlert(msg.key, { fromSync: true, forceRender: true });
      } else if (msg.type === 'dismiss' && msg.id) {
        dismissAlert(msg.id, { fromSync: true });
      }
    };
  }

  window.addEventListener('storage', (e) => {
    if (e.key === STORE_KEY || e.key === DISMISS_KEY || e.key === COLLAPSE_KEY) {
      if (e.key === COLLAPSE_KEY) {
        collapsed = e.newValue === '1';
      }
      renderOverlay();
    }
  });

  // ── Dual-Source Polling (/api/browser-vision/alerts + Fallback) ────────────
  let alertsApiBackoffUntil = 0;
  let lastSocialPollAt = 0;
  let pollInFlight = false;

  function syncServerAlerts(serverAlerts) {
    const store = readStoreMap();
    const incomingIds = new Set();
    let changed = false;
    let newlyRaised = null;

    for (const raw of serverAlerts) {
      const norm = normalizeAlert({ ...raw, _origin: 'server' });
      if (!norm) continue;
      incomingIds.add(norm.id);
      const prev = store[norm.id];
      if (!prev) {
        store[norm.id] = norm;
        changed = true;
        if (!newlyRaised) newlyRaised = norm;
      } else if (
        prev.title !== norm.title
        || prev.detail !== norm.detail
        || prev.url !== norm.url
        || prev.kind !== norm.kind
      ) {
        store[norm.id] = { ...prev, ...norm };
        changed = true;
      }
    }

    // Remove stale server-sourced alerts that are no longer active on the server
    for (const [id, item] of Object.entries(store)) {
      if ((item._origin === 'server' || id.startsWith('srv:')) && !incomingIds.has(id)) {
        delete store[id];
        changed = true;
      }
    }

    if (changed) {
      writeStoreMap(store);
      if (newlyRaised && !chimedIds.has(newlyRaised.id)) {
        chimedIds.add(newlyRaised.id);
        playSoftChime();
      }
      renderOverlay();
    }
  }

  async function runFallbackPoll() {
    const found = [];

    // 1. Check up to 3 most recently open Browser Vision rooms from localStorage
    let roomIds = [];
    try {
      const raw = localStorage.getItem(OPEN_ROOMS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object') {
        roomIds = Object.keys(parsed).filter((k) => parsed[k]).slice(-MAX_FALLBACK_ROOMS);
      }
    } catch (_) {}

    for (const chatId of roomIds) {
      try {
        const res = await fetch('/api/browser-vision/session?chat=' + encodeURIComponent(chatId), {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!res.ok) continue;
        const data = await res.json().catch(() => null);
        if (!data || !data.alive || !data.status) continue;
        const st = data.status;
        const paused = st.paused === true;
        const sensitive = isSensitiveUrl(st.url || '');
        if (!paused && !sensitive) continue;

        const reason = String(st.pauseReason || '').toLowerCase();
        let kind = 'paused';
        if (/captcha/.test(reason)) kind = 'captcha';
        else if (/otp|2fa/.test(reason)) kind = 'otp';
        else if (/payment|checkout/.test(reason)) kind = 'payment';
        else if (/login|password|auth/.test(reason) || sensitive) kind = 'login';

        const meta = KIND_META[kind] || KIND_META.login;
        const urlInfo = sanitizeUrl(st.url || '');
        found.push({
          id: `srv:bv_${chatId}:${kind}`,
          kind,
          title: meta.defaultTitle,
          detail: meta.defaultDetail,
          sourceType: 'chat',
          chatId,
          sessionName: data.session || `bv_${chatId}`,
          url: urlInfo.url,
          domain: urlInfo.domain,
          browserVisionUrl: `/gemini?session=${encodeURIComponent(chatId)}&bv=1`,
          ts: Date.now(),
          _origin: 'server',
        });
      } catch (_) {}
    }

    // 2. Check social upload queue (throttled to every 15s)
    const now = Date.now();
    if (now - lastSocialPollAt >= SOCIAL_POLL_INTERVAL_MS) {
      lastSocialPollAt = now;
      try {
        const res = await fetch('/api/video-studio/social/queue', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          const items = Array.isArray(data && data.items) ? data.items : [];
          for (const it of items) {
            if (!it || typeof it !== 'object') continue;
            const st = String(it.status || '').toLowerCase();
            const isBvWait = it.mode === 'browser_vision'
              && !['posted', 'published', 'done', 'completed', 'cancelled', 'failed'].includes(st);
            const isLoginWait = /login|auth|captcha|waiting_user|browser_vision/.test(st);
            if (!isBvWait && !isLoginWait) continue;

            const platform = String(it.platform || 'social').toLowerCase();
            found.push({
              id: `srv:social:${it.id || platform}`,
              kind: 'social_upload',
              title: `📤 อัปโหลด ${platform.toUpperCase()} รอล็อกอิน/ยืนยัน`,
              detail: it.title ? `คลิป "${it.title}" รอดำเนินการใน Browser Vision` : KIND_META.social_upload.defaultDetail,
              sourceType: 'social',
              platform,
              sessionName: `bv_labweb_soc_${platform}`,
              browserVisionUrl: `/lab-browser?profile=${encodeURIComponent('soc_' + platform)}`,
              ts: Date.parse(it.updatedAt || it.createdAt || '') || Date.now(),
              _origin: 'server',
            });
          }
        }
      } catch (_) {}
    } else {
      // Preserve existing fallback social alerts during throttle window
      const existing = readStoreMap();
      for (const item of Object.values(existing)) {
        if (item && String(item.id || '').startsWith('srv:social:')) {
          found.push(item);
        }
      }
    }

    syncServerAlerts(found);
  }

  async function pollServer() {
    if (pollInFlight || document.hidden) return;
    pollInFlight = true;
    try {
      const now = Date.now();
      if (now < alertsApiBackoffUntil) {
        await runFallbackPoll();
        return;
      }
      const res = await fetch('/api/browser-vision/alerts', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (res.status === 404) {
        alertsApiBackoffUntil = Date.now() + ALERTS_404_BACKOFF_MS;
        await runFallbackPoll();
        return;
      }
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (data && data.ok && Array.isArray(data.alerts)) {
        syncServerAlerts(data.alerts);
      }
    } catch (_) {
      // Network hiccup — keep existing alerts intact
    } finally {
      pollInFlight = false;
    }
  }

  function boot() {
    renderOverlay();
    pollServer();
    setInterval(pollServer, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        renderOverlay();
        pollServer();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
