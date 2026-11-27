'use strict';

const fs = require('fs');
const net = require('net');
const config = require('./config');
const core = require('./browser-core');
const authStore = require('./auth-store');
const sessionClient = require('./session-client');
const { executeAction } = require('./actions');

const MUTATING_CMDS = new Set([
  'open',
  'visit',
  'navigate',
  'click',
  'hover',
  'fill',
  'type',
  'press',
  'select',
  'scroll',
  'back',
  'reload',
  'eval',
  'wait',
  'download',
]);

const OPEN_CMDS = new Set(['open', 'visit', 'navigate']);
const SENSITIVE_CHECK_CMDS = new Set(['open', 'visit', 'navigate', 'click', 'press']);
const AUTH_PULL_BEFORE_CMDS = new Set(['open', 'visit', 'navigate', 'click', 'eval', 'download', 'save-image']);

const MAX_FRAME_BACKPRESSURE_BYTES = 2 * 1024 * 1024; // 2 MB
const MIN_FRAME_INTERVAL_MS = 120; // ~8 fps max to protect CPU/RAM
const KEEPALIVE_FRAME_INTERVAL_MS = 2000;
const AUTH_SYNC_DEBOUNCE_MS = 1500;
const AUTH_WATCH_INTERVAL_MS = 1000;
const SHUTDOWN_AUTH_TIMEOUT_MS = 3000;
const SENSITIVE_CHECK_TIMEOUT_MS = 1500;
const AI_INTERVENE_WINDOW_MS = 3000;

const PAUSED_MESSAGE = 'Session is paused by the user. Wait for user resume before continuing.';

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {
    // ignore cleanup errors
  }
}

function withTimeout(promise, ms, fallbackValue = null) {
  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallbackValue), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([
    Promise.resolve(promise).catch(() => fallbackValue),
    timeoutPromise,
  ]).finally(() => clearTimeout(timer));
}

function normalizeModifiers(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw | 0;
  if (raw && typeof raw === 'object') {
    return (
      (raw.alt || raw.altKey ? 1 : 0) |
      (raw.ctrl || raw.ctrlKey ? 2 : 0) |
      (raw.meta || raw.metaKey ? 4 : 0) |
      (raw.shift || raw.shiftKey ? 8 : 0)
    );
  }
  return 0;
}

function hasNonShiftModifier(msg) {
  const mods = normalizeModifiers(msg && msg.modifiers);
  return Boolean(mods & (1 | 2 | 4)) || Boolean(msg && (msg.ctrlKey || msg.metaKey || msg.altKey));
}

function normalizeMouseAction(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'mousepressed' || s === 'mousedown' || s === 'down' || s === 'press') return 'mousePressed';
  if (s === 'mousereleased' || s === 'mouseup' || s === 'up' || s === 'release') return 'mouseReleased';
  if (s === 'mousemoved' || s === 'mousemove' || s === 'move') return 'mouseMoved';
  if (s === 'click') return 'click';
  if (s === 'dblclick' || s === 'doubleclick') return 'dblclick';
  return 'mouseMoved';
}

function normalizeMouseButton(raw, cdpType) {
  if (raw === 0 || raw === 'left') return 'left';
  if (raw === 1 || raw === 'middle') return 'middle';
  if (raw === 2 || raw === 'right') return 'right';
  if (raw === 'back' || raw === 'forward') return raw;
  if (raw === 'none') return cdpType === 'mouseMoved' ? 'none' : 'left';
  return cdpType === 'mouseMoved' ? 'none' : 'left';
}

async function detectSensitive(page) {
  if (!page || page.isClosed()) return null;
  const check = async () => {
    const url = page.url() || '';
    const domHit = await page.evaluate(() => {
      const isVisible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };

      // 1. CAPTCHA iframes / widgets
      const iframes = document.querySelectorAll('iframe[src]');
      for (const fr of iframes) {
        const src = String(fr.getAttribute('src') || '');
        if (/recaptcha|hcaptcha|turnstile|challenges\.cloudflare/i.test(src)) {
          return { kind: 'CAPTCHA' };
        }
      }

      // 2. OTP input
      const otpInputs = document.querySelectorAll('input[autocomplete*="one-time-code" i]');
      for (const inp of otpInputs) {
        if (isVisible(inp)) return { kind: 'OTP' };
      }

      // 3. Visible password input
      const pwInputs = document.querySelectorAll('input[type="password"]');
      for (const inp of pwInputs) {
        if (isVisible(inp)) return { kind: 'PASSWORD' };
      }

      return null;
    });

    let kind = domHit && domHit.kind ? domHit.kind : null;
    if (!kind && /checkout|payment|pay\b/i.test(url)) {
      kind = 'PAYMENT';
    }
    if (!kind) return null;

    const metaByKind = {
      CAPTCHA: {
        pauseReason: 'SENSITIVE_CAPTCHA',
        message: 'ตรวจพบหน้าตรวจสอบตัวตน (CAPTCHA) กรุณาดำเนินการด้วยตนเองแล้วกดทำต่อ',
      },
      OTP: {
        pauseReason: 'SENSITIVE_OTP',
        message: 'ตรวจพบช่องกรอกรหัส OTP กรุณากรอกรหัสแล้วกดทำต่อ',
      },
      PASSWORD: {
        pauseReason: 'SENSITIVE_PASSWORD',
        message: 'ตรวจพบช่องรหัสผ่าน (Login) กรุณากรอกข้อมูลเข้าสู่ระบบแล้วกดทำต่อ',
      },
      PAYMENT: {
        pauseReason: 'SENSITIVE_PAYMENT',
        message: 'ตรวจพบหน้าชำระเงิน (Payment/Checkout) กรุณาตรวจสอบและยืนยันด้วยตนเอง',
      },
    };
    const meta = metaByKind[kind];
    return { kind, pauseReason: meta.pauseReason, message: meta.message };
  };

  return withTimeout(check(), SENSITIVE_CHECK_TIMEOUT_MS, null);
}

async function inspectFocusedEditable(page) {
  if (!page || page.isClosed()) return { isEditable: false };
  const check = async () => {
    const res = await page.evaluate(() => {
      const NON_TEXT_TYPES = new Set([
        'button', 'checkbox', 'color', 'file', 'hidden',
        'image', 'radio', 'range', 'reset', 'submit',
      ]);
      let doc = document;
      let el = doc.activeElement;
      for (let depth = 0; depth < 6 && el; depth++) {
        if (el.shadowRoot && el.shadowRoot.activeElement) {
          el = el.shadowRoot.activeElement;
          continue;
        }
        if (el.tagName === 'IFRAME') {
          try {
            if (el.contentDocument && el.contentDocument.activeElement) {
              doc = el.contentDocument;
              el = doc.activeElement;
              continue;
            }
          } catch (_) {
            // cross-origin iframe
          }
        }
        break;
      }
      if (!el || el === doc.body || el === doc.documentElement) {
        return { isEditable: false };
      }
      const tag = String(el.tagName || '').toLowerCase();
      if (tag === 'input') {
        if (el.disabled || el.readOnly) return { isEditable: false };
        const inputType = String(el.getAttribute('type') || 'text').trim().toLowerCase() || 'text';
        if (NON_TEXT_TYPES.has(inputType)) return { isEditable: false };
        return {
          isEditable: true,
          tag,
          inputType,
          inputMode: String(el.getAttribute('inputmode') || '').trim().toLowerCase(),
          autocomplete: String(el.getAttribute('autocomplete') || '').trim().toLowerCase(),
          label: String(el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').trim().slice(0, 80),
        };
      }
      if (tag === 'textarea') {
        if (el.disabled || el.readOnly) return { isEditable: false };
        return {
          isEditable: true,
          tag,
          inputType: 'textarea',
          inputMode: String(el.getAttribute('inputmode') || '').trim().toLowerCase(),
          autocomplete: String(el.getAttribute('autocomplete') || '').trim().toLowerCase(),
          label: String(el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').trim().slice(0, 80),
        };
      }
      if (el.isContentEditable) {
        return {
          isEditable: true,
          tag,
          inputType: 'contenteditable',
          inputMode: String(el.getAttribute('inputmode') || '').trim().toLowerCase(),
          autocomplete: '',
          label: String(el.getAttribute('aria-label') || '').trim().slice(0, 80),
        };
      }
      return { isEditable: false };
    });
    return res && typeof res === 'object' ? res : { isEditable: false };
  };
  return withTimeout(check(), 250, { isEditable: false });
}

async function inspectPoint(page, x, y) {
  if (!page || page.isClosed()) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return page.evaluate(({ px, py }) => {
    const cssEscape = (str) => {
      if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(str);
      }
      return String(str).replace(/([^\w-])/g, '\\$1');
    };

    const isUniqueId = (root, id) => {
      if (!id) return false;
      try {
        return root.querySelectorAll('#' + cssEscape(id)).length === 1;
      } catch (_) {
        return false;
      }
    };

    const buildSelector = (node) => {
      const root = typeof node.getRootNode === 'function' ? node.getRootNode() : document;
      if (node.id && isUniqueId(root, node.id)) {
        return '#' + cssEscape(node.id);
      }
      const parts = [];
      let cur = node;
      let depth = 0;
      while (cur && cur.nodeType === 1 && depth < 6) {
        const tag = cur.tagName.toLowerCase();
        if (cur.id && isUniqueId(root, cur.id)) {
          parts.unshift('#' + cssEscape(cur.id));
          break;
        }
        if (tag === 'html' || tag === 'body') {
          parts.unshift(tag);
          break;
        }
        let seg = tag;
        const parent = cur.parentElement;
        if (parent) {
          const sameTag = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
          if (sameTag.length > 1) {
            const idx = sameTag.indexOf(cur) + 1;
            seg = `${tag}:nth-of-type(${idx})`;
          }
        }
        parts.unshift(seg);
        cur = parent;
        depth++;
      }
      return parts.join(' > ');
    };

    let doc = document;
    let curX = px;
    let curY = py;
    let offsetX = 0;
    let offsetY = 0;
    let targetEl = null;

    for (let hop = 0; hop < 10; hop++) {
      let hit = null;
      try {
        hit = doc.elementFromPoint(curX, curY);
      } catch (_) {
        break;
      }
      if (!hit) break;

      // Descend into open shadowRoots
      let shadowGuard = 0;
      while (hit && hit.shadowRoot && shadowGuard < 10) {
        shadowGuard++;
        let deeper = null;
        try {
          deeper = hit.shadowRoot.elementFromPoint(curX, curY);
        } catch (_) {
          break;
        }
        if (!deeper || deeper === hit) break;
        hit = deeper;
      }

      const tagUpper = hit.tagName ? hit.tagName.toUpperCase() : '';
      if (tagUpper === 'IFRAME' || tagUpper === 'FRAME') {
        let innerDoc = null;
        try {
          innerDoc = hit.contentDocument;
        } catch (_) {
          innerDoc = null;
        }
        if (innerDoc) {
          const rect = hit.getBoundingClientRect();
          const dx = rect.left + (hit.clientLeft || 0);
          const dy = rect.top + (hit.clientTop || 0);
          curX -= dx;
          curY -= dy;
          offsetX += dx;
          offsetY += dy;
          doc = innerDoc;
          targetEl = hit;
          continue;
        }
      }

      targetEl = hit;
      break;
    }

    if (!targetEl) return null;

    const r = targetEl.getBoundingClientRect();
    const box = {
      x: Math.round(r.left + offsetX),
      y: Math.round(r.top + offsetY),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
    const tag = targetEl.tagName.toLowerCase();
    const id_attr = targetEl.id || '';
    const classes = Array.from(targetEl.classList || []).filter(Boolean);
    const selector = buildSelector(targetEl);
    const html = String(targetEl.outerHTML || '').slice(0, 600);
    const text = String(targetEl.innerText || targetEl.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    const win = (targetEl.ownerDocument && targetEl.ownerDocument.defaultView) || window;
    const cs = win.getComputedStyle(targetEl);
    const styles = {
      display: cs.display,
      fontSize: cs.fontSize,
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      padding: cs.padding,
      margin: cs.margin,
    };

    return { box, tag, id_attr, classes, selector, html, text, styles };
  }, { px: x, py: y });
}

async function main() {
  const rawCfg = process.env.LAB_BROWSER_DAEMON_OPTS || process.argv[2] || '{}';
  const initOpts = JSON.parse(rawCfg);
  const sessionName = config.sanitizeSessionName(initOpts.session || 'default');
  const idleTtlSec = Math.max(30, Math.min(86400, Number(initOpts.idleTtlSec) || config.DEFAULT_IDLE_TTL_SEC));
  const authProfile = initOpts.authProfile ? config.sanitizeAuthProfile(initOpts.authProfile) : null;

  config.ensureDirs({ includeAuth: Boolean(authProfile) });
  const { sockPath, streamSockPath, metaPath } = sessionClient.getSessionPaths(sessionName);
  safeUnlink(sockPath);
  safeUnlink(streamSockPath);

  const session = await core.openBrowserSession({
    ...initOpts,
    persistProfile: initOpts.persist ? sessionName : null,
    authProfile,
  });

  // ── State ──────────────────────────────────────────────────────────────────
  let closing = false;
  let authFlushedOnClose = false;
  let idleTimer = null;
  let server = null;
  let streamServer = null;
  let queue = Promise.resolve();
  const startedAt = new Date().toISOString();
  let lastActivityAt = startedAt;

  let paused = false;
  let pauseReason = null;
  let aiBusy = false;
  let aiLastMutatingDoneAt = 0;

  const subscribers = new Set();
  let pendingSubscribers = 0;
  let activeCdp = null;
  let activeCdpPage = null;
  let screencastRunning = false;
  let screencastGen = 0;
  let screencastStartingPage = null;
  let screencastStartingPromise = null;
  let screencastQuality = 72;
  let lastFrameSentAt = 0;
  let lastFrameMsg = null;
  let keepaliveTimer = null;

  // ── Shared Auth Sync State ─────────────────────────────────────────────────
  const authPath = authProfile ? authStore.getProfilePath(authProfile) : null;
  let authSyncTimer = null;
  let authSyncChain = Promise.resolve();
  let authWatcherAttached = false;
  const lastSynced = new Map(); // cookieKey -> fingerprint
  let lastAuthVersion = 0;
  let lastObservedAuthSig = null;

  function captureAuthFileSig() {
    if (!authPath) return null;
    try {
      const st = fs.statSync(authPath);
      return `${st.mtimeMs}:${st.size}:${st.ino}`;
    } catch (_) {
      return null;
    }
  }

  if (authProfile && session.initialAuthState) {
    lastAuthVersion = Number(session.initialAuthState.version) || 0;
    const fps = session.initialAuthState.syncedFingerprints || {};
    for (const [k, fp] of Object.entries(fps)) {
      lastSynced.set(k, fp);
    }
    lastObservedAuthSig = captureAuthFileSig();
  }

  function resetAuthCursor(version = lastAuthVersion) {
    lastSynced.clear();
    if (typeof version === 'number' && Number.isFinite(version)) {
      lastAuthVersion = version;
    }
    lastObservedAuthSig = captureAuthFileSig();
  }

  async function applyAuthDiff(toAdd, toClear, syncedFingerprints, version) {
    if (Array.isArray(toClear) && toClear.length > 0) {
      for (const c of toClear) {
        try {
          await session.context.clearCookies({
            name: c.name,
            domain: c.domain,
            path: c.path || '/',
          });
        } catch (_) {
          // ignore per-cookie clear failure
        }
      }
    }

    if (Array.isArray(toAdd) && toAdd.length > 0) {
      try {
        await session.context.addCookies(toAdd);
      } catch (_) {
        for (const c of toAdd) {
          try {
            await session.context.addCookies([c]);
          } catch (_) {
            // ignore single malformed cookie
          }
        }
      }
    }

    lastSynced.clear();
    if (syncedFingerprints && typeof syncedFingerprints === 'object') {
      for (const [k, fp] of Object.entries(syncedFingerprints)) {
        lastSynced.set(k, fp);
      }
    }
    if (typeof version === 'number' && Number.isFinite(version)) {
      lastAuthVersion = version;
    }
    lastObservedAuthSig = captureAuthFileSig();
  }

  function flushAuth(full = false) {
    if (!authProfile) return Promise.resolve(null);
    const run = async () => {
      const cookies = await session.context.cookies();
      let origins;
      if (full) {
        try {
          const st = await session.context.storageState({ indexedDB: true });
          origins = Array.isArray(st && st.origins) ? st.origins : undefined;
        } catch (_) {
          const st = await session.context.storageState().catch(() => null);
          origins = Array.isArray(st && st.origins) ? st.origins : undefined;
        }
      }

      const syncRes = authStore.sync(authProfile, {
        cookies,
        ...(origins !== undefined ? { origins } : {}),
        knownKeys: Array.from(lastSynced.keys()),
        knownFingerprints: lastSynced,
        lastVersion: lastAuthVersion,
      });

      await applyAuthDiff(
        syncRes.toAdd,
        syncRes.toClear,
        syncRes.syncedFingerprints,
        syncRes.version
      );

      return {
        version: syncRes.version,
        changed: syncRes.changed,
        added: syncRes.toAdd.length,
        cleared: syncRes.toClear.length,
        cookieCount: syncRes.cookies.length,
        originCount: syncRes.origins.length,
      };
    };
    authSyncChain = authSyncChain.then(run, run);
    return authSyncChain;
  }

  function pullAuth() {
    if (!authProfile || closing) return Promise.resolve(null);
    const run = async () => {
      if (closing) return null;
      if (authPath && !fs.existsSync(authPath) && lastSynced.size === 0 && lastAuthVersion === 0) {
        lastObservedAuthSig = null;
        return null;
      }
      const syncRes = authStore.sync(authProfile, {
        knownKeys: Array.from(lastSynced.keys()),
        knownFingerprints: lastSynced,
        lastVersion: lastAuthVersion,
      });
      await applyAuthDiff(
        syncRes.toAdd,
        syncRes.toClear,
        syncRes.syncedFingerprints,
        syncRes.version
      );
      return syncRes;
    };
    authSyncChain = authSyncChain.then(run, run);
    return authSyncChain;
  }

  async function pullAuthIfStoreChanged() {
    if (!authProfile || closing) return;
    const sig = captureAuthFileSig();
    if (!sig || sig === lastObservedAuthSig) return;
    await pullAuth().catch(() => {});
  }

  function scheduleAuthSync() {
    if (!authProfile || closing) return;
    if (authSyncTimer) clearTimeout(authSyncTimer);
    authSyncTimer = setTimeout(() => {
      authSyncTimer = null;
      if (!closing) {
        flushAuth(false).catch(() => {});
      }
    }, AUTH_SYNC_DEBOUNCE_MS);
    if (typeof authSyncTimer.unref === 'function') authSyncTimer.unref();
  }

  function onAuthFileChange(curr, prev) {
    if (closing || !authProfile) return;
    if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size && curr.nlink === prev.nlink) {
      return;
    }
    const sig = captureAuthFileSig();
    if (sig && sig === lastObservedAuthSig) return;
    try {
      const loaded = authStore.load(authProfile);
      if (loaded.version === lastAuthVersion && loaded.exists) {
        lastObservedAuthSig = sig;
        return;
      }
    } catch (_) {
      // fall through to pullAuth
    }
    pullAuth().catch(() => {});
  }

  if (authProfile && authPath) {
    fs.watchFile(authPath, { interval: AUTH_WATCH_INTERVAL_MS }, onAuthFileChange);
    authWatcherAttached = true;
  }

  // ── Broadcast & Status Helpers ─────────────────────────────────────────────
  function sendToSubscriber(socket, msg) {
    if (!socket || socket.destroyed || !socket.writable) return false;
    try {
      socket.write(JSON.stringify(msg) + '\n');
      return true;
    } catch (_) {
      return false;
    }
  }

  function broadcast(msg, { isFrame = false } = {}) {
    if (subscribers.size === 0) return;
    const line = JSON.stringify(msg) + '\n';
    for (const sock of subscribers) {
      if (!sock || sock.destroyed || !sock.writable) {
        subscribers.delete(sock);
        continue;
      }
      if (isFrame && sock.writableLength > MAX_FRAME_BACKPRESSURE_BYTES) {
        continue;
      }
      try {
        sock.write(line);
      } catch (_) {
        subscribers.delete(sock);
      }
    }
  }

  function getPageViewport(page) {
    const vp = page && !page.isClosed() && typeof page.viewportSize === 'function'
      ? page.viewportSize()
      : null;
    if (vp && vp.width && vp.height) {
      return { width: vp.width, height: vp.height };
    }
    if (session.viewportMeta && session.viewportMeta.width && session.viewportMeta.height) {
      return { width: session.viewportMeta.width, height: session.viewportMeta.height };
    }
    return { width: 1440, height: 900 };
  }

  async function getTabsList() {
    const pages = session.context.pages().filter((p) => !p.isClosed());
    const cur = activePage;
    return Promise.all(
      pages.map(async (p, i) => ({
        index: i,
        active: p === cur,
        url: p.url(),
        title: await p.title().catch(() => ''),
      }))
    );
  }

  async function buildStatusPayload() {
    const page = await getActivePage();
    const tabs = await getTabsList();
    const activeTab = tabs.findIndex((t) => t.active);
    return {
      ok: true,
      session: sessionName,
      pid: process.pid,
      startedAt,
      lastActivityAt,
      idleTtlSec,
      persist: Boolean(initOpts.persist),
      authProfile: authProfile || null,
      paused,
      pauseReason,
      viewers: subscribers.size,
      aiBusy,
      tabCount: tabs.length,
      activeTab: activeTab >= 0 ? activeTab : 0,
      tabs,
      viewport: getPageViewport(page),
      url: page.url(),
      title: await page.title().catch(() => ''),
    };
  }

  async function broadcastPageState(page) {
    if (closing || subscribers.size === 0 || !page || page.isClosed()) return;
    const tabs = await getTabsList();
    const activeTab = tabs.findIndex((t) => t.active);
    const payload = {
      url: page.url(),
      title: await page.title().catch(() => ''),
      viewport: getPageViewport(page),
      tabs,
      activeTab: activeTab >= 0 ? activeTab : 0,
    };
    broadcast({ type: 'page', ...payload });
    broadcast({ type: 'tabs', ...payload });
  }

  function setPaused(nextPaused, reason = null, extra = {}) {
    paused = Boolean(nextPaused);
    pauseReason = paused ? String(reason || 'USER_PAUSED') : null;
    broadcast({
      type: 'pause-state',
      paused,
      pauseReason,
      reason: pauseReason,
      ...extra,
    });
  }

  function setAiBusy(nextBusy, cmd = null, target = null) {
    const busy = Boolean(nextBusy);
    aiBusy = busy;
    if (!busy) {
      aiLastMutatingDoneAt = Date.now();
    }
    broadcast({
      type: 'ai-busy',
      busy,
      aiBusy: busy,
      ...(cmd ? { cmd } : {}),
      ...(target ? { target } : {}),
    });
    broadcast({
      type: 'status',
      aiBusy: busy,
      paused,
      pauseReason,
    });
  }

  function isAiRecentlyBusy() {
    return aiBusy || (aiLastMutatingDoneAt > 0 && Date.now() - aiLastMutatingDoneAt <= AI_INTERVENE_WINDOW_MS);
  }

  // ── CDP Screencast Management ──────────────────────────────────────────────
  function stopKeepaliveTimer() {
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
  }

  function startKeepaliveTimer(gen, cdp, page) {
    stopKeepaliveTimer();
    keepaliveTimer = setInterval(async () => {
      if (closing || !screencastRunning || gen !== screencastGen || subscribers.size === 0) {
        stopKeepaliveTimer();
        return;
      }
      const now = Date.now();
      if (now - lastFrameSentAt < KEEPALIVE_FRAME_INTERVAL_MS - 50) return;

      if (lastFrameMsg) {
        lastFrameSentAt = now;
        broadcast({ ...lastFrameMsg, ts: now }, { isFrame: true });
        return;
      }

      // Bootstrap initial frame if compositor hasn't pushed one yet (e.g., static page / about:blank)
      if (cdp && page && !page.isClosed()) {
        try {
          const cap = await cdp.send('Page.captureScreenshot', {
            format: 'jpeg',
            quality: screencastQuality,
          });
          if (gen !== screencastGen || closing || subscribers.size === 0) return;
          if (cap && cap.data) {
            const vp = getPageViewport(page);
            const msg = {
              type: 'frame',
              format: 'jpeg',
              mime: 'image/jpeg',
              data: cap.data,
              width: vp.width,
              height: vp.height,
              meta: { deviceWidth: vp.width, deviceHeight: vp.height },
              metadata: { deviceWidth: vp.width, deviceHeight: vp.height },
              ts: Date.now(),
            };
            lastFrameMsg = msg;
            lastFrameSentAt = msg.ts;
            broadcast(msg, { isFrame: true });
          }
        } catch (_) {
          // ignore transient screenshot errors during navigation
        }
      }
    }, KEEPALIVE_FRAME_INTERVAL_MS);
    if (typeof keepaliveTimer.unref === 'function') keepaliveTimer.unref();
  }

  async function stopScreencast() {
    screencastGen++;
    screencastRunning = false;
    screencastStartingPage = null;
    screencastStartingPromise = null;
    stopKeepaliveTimer();
    const cdp = activeCdp;
    activeCdp = null;
    activeCdpPage = null;
    if (cdp) {
      await cdp.send('Page.stopScreencast').catch(() => {});
      await cdp.detach().catch(() => {});
    }
  }

  async function startScreencast(page) {
    if (closing || subscribers.size === 0 || !page || page.isClosed()) return;
    if (screencastRunning && activeCdp && activeCdpPage === page) return;
    if (screencastStartingPage === page && screencastStartingPromise) {
      return screencastStartingPromise;
    }

    const startTask = (async () => {
      await stopScreencast();
      if (closing || subscribers.size === 0 || !page || page.isClosed()) return;

      const gen = ++screencastGen;
      screencastStartingPage = page;
      let cdp;
      try {
        cdp = await session.context.newCDPSession(page);
      } catch (_) {
        if (screencastStartingPage === page) screencastStartingPage = null;
        return;
      }

      if (gen !== screencastGen || closing || subscribers.size === 0 || page.isClosed()) {
        await cdp.detach().catch(() => {});
        return;
      }

      activeCdp = cdp;
      activeCdpPage = page;
      screencastRunning = true;
      screencastStartingPage = null;
      lastFrameSentAt = 0;

      cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
        // Always ack immediately so Chromium never stalls the screencast buffer
        cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
        if (closing || gen !== screencastGen || subscribers.size === 0) return;

        const now = Date.now();
        if (now - lastFrameSentAt < MIN_FRAME_INTERVAL_MS) return; // cap ~20fps
        lastFrameSentAt = now;

        const vp = getPageViewport(page);
        const w = (metadata && metadata.deviceWidth) || vp.width;
        const h = (metadata && metadata.deviceHeight) || vp.height;
        const msg = {
          type: 'frame',
          format: 'jpeg',
          mime: 'image/jpeg',
          data,
          width: w,
          height: h,
          meta: metadata || { deviceWidth: w, deviceHeight: h },
          metadata: metadata || { deviceWidth: w, deviceHeight: h },
          ts: now,
        };
        lastFrameMsg = msg;
        broadcast(msg, { isFrame: true });
      });

      const vp = getPageViewport(page);
      try {
        await cdp.send('Page.startScreencast', {
          format: 'jpeg',
          quality: screencastQuality,
          maxWidth: vp.width,
          maxHeight: vp.height,
          everyNthFrame: 1,
        });
      } catch (_) {
        if (gen === screencastGen) {
          await stopScreencast();
        }
        return;
      }

      if (gen === screencastGen && !closing && subscribers.size > 0) {
        startKeepaliveTimer(gen, cdp, page);
      }
    })();

    screencastStartingPage = page;
    screencastStartingPromise = startTask;
    try {
      await startTask;
    } finally {
      if (screencastStartingPromise === startTask) {
        screencastStartingPromise = null;
        if (screencastStartingPage === page) screencastStartingPage = null;
      }
    }
  }

  async function ensureInputCdp(page) {
    if (activeCdp && activeCdpPage === page) return activeCdp;
    if (subscribers.size > 0 && !closing && page === activePage) {
      await startScreencast(page);
      if (activeCdp && activeCdpPage === page) return activeCdp;
    }
    return null;
  }

  // ── Page & Telemetry Management ────────────────────────────────────────────
  const telemetryMap = new WeakMap();
  const attachedPages = new WeakSet();

  const getTelemetry = (page) => {
    let t = telemetryMap.get(page);
    if (!t) {
      t = core.attachTelemetry(page);
      telemetryMap.set(page, t);
    }
    return t;
  };

  let activePage = null;

  function attachPageListeners(page) {
    if (!page || attachedPages.has(page)) return;
    attachedPages.add(page);
    getTelemetry(page);

    page.on('framenavigated', (frame) => {
      if (closing) return;
      if (frame !== page.mainFrame()) return;
      if (page === activePage) {
        broadcastPageState(page).catch(() => {});
      }
      if (authProfile) {
        scheduleAuthSync();
      }
    });

    page.on('load', () => {
      if (closing) return;
      if (page === activePage) {
        broadcastPageState(page).catch(() => {});
        if (authProfile) {
          flushAuth(true).catch(() => {});
        }
      }
    });

    page.on('close', () => {
      if (closing) return;
      if (activePage === page) {
        const remaining = session.context.pages().filter((p) => !p.isClosed() && p !== page);
        const next = remaining.length > 0 ? remaining[remaining.length - 1] : null;
        setActivePage(next).catch(() => {});
      } else if (activePage && !activePage.isClosed()) {
        broadcastPageState(activePage).catch(() => {});
      }
    });
  }

  async function setActivePage(page) {
    const prev = activePage;
    activePage = page && !page.isClosed() ? page : null;
    if (activePage) {
      attachPageListeners(activePage);
    }
    if (prev !== activePage) {
      lastFrameMsg = null;
      if (activePage && subscribers.size > 0 && !closing) {
        await startScreencast(activePage).catch(() => {});
      } else if (!activePage) {
        await stopScreencast().catch(() => {});
      }
      if (activePage && !closing) {
        await broadcastPageState(activePage).catch(() => {});
      }
    }
    return activePage;
  }

  await setActivePage(session.page);

  session.context.on('page', (newPage) => {
    if (closing) return;
    setActivePage(newPage).catch(() => {});
  });

  async function getActivePage() {
    if (activePage && !activePage.isClosed()) return activePage;
    const pages = session.context.pages().filter((p) => !p.isClosed());
    if (pages.length > 0) {
      return setActivePage(pages[pages.length - 1]);
    }
    const created = await session.context.newPage();
    return setActivePage(created);
  }

  // ── Idle Timer & Shutdown ──────────────────────────────────────────────────
  let lastCommandAtMs = Date.now();
  const MAX_VIEWER_IDLE_MS = 20 * 60 * 1000; // 20 min max passive viewer without commands
  const MAX_SESSION_MB = parseInt(process.env.LAB_BROWSER_SESSION_MAX_MB, 10) || 2048;
  const HARD_MAX_SESSION_MB = parseInt(process.env.LAB_BROWSER_SESSION_HARD_MAX_MB, 10) || 3072;
  const MIN_SYSTEM_AVAILABLE_MB = 1500;
  let memBreachCount = 0;

  function readPssKb(pid) {
    try {
      const content = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
      const match = content.match(/^Pss:\s+(\d+)/m);
      return match ? Number(match[1]) : null;
    } catch (_) {
      return null;
    }
  }

  function readMemAvailableMb() {
    try {
      const content = fs.readFileSync('/proc/meminfo', 'utf8');
      const match = content.match(/^MemAvailable:\s+(\d+)/m);
      return match ? Math.round(Number(match[1]) / 1024) : Infinity;
    } catch (_) {
      return Infinity;
    }
  }

  function isSensitivePageUrl(u) {
    if (!u || typeof u !== 'string') return false;
    try {
      const parsed = new URL(u);
      const host = parsed.hostname.toLowerCase();
      const sensitiveHosts = [
        'accounts.google.com',
        'login.microsoftonline.com',
        'login.live.com',
        'appleid.apple.com',
      ];
      if (sensitiveHosts.some((h) => host === h || host.endsWith('.' + h))) {
        return true;
      }
      if (/(signin|login|challenge|2fa|otp)/i.test(parsed.pathname)) {
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  function stripUrlQuery(u) {
    if (!u || typeof u !== 'string') return 'unknown';
    try {
      const parsed = new URL(u);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
      }
      return u.split(/[?#]/)[0] || 'unknown';
    } catch (_) {
      return u.split(/[?#]/)[0] || 'unknown';
    }
  }

  const rssWatchdog = setInterval(() => {
    if (closing) return;
    try {
      const { execFileSync } = require('child_process');
      const out = execFileSync('ps', ['-eo', 'pid,ppid,rss'], { encoding: 'utf8', timeout: 2000 });
      const children = new Map();
      const rssByPid = new Map();
      for (const line of out.trim().split('\n').slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 3) continue;
        const p = Number(parts[0]), pp = Number(parts[1]), r = Number(parts[2]);
        rssByPid.set(p, r);
        if (!children.has(pp)) children.set(pp, []);
        children.get(pp).push(p);
      }
      let totalRssKb = 0;
      let totalPssKb = 0;
      const stack = [process.pid];
      const seen = new Set();
      while (stack.length) {
        const cur = stack.pop();
        if (seen.has(cur)) continue;
        seen.add(cur);
        const rssKb = rssByPid.get(cur) || 0;
        totalRssKb += rssKb;
        const pssKb = readPssKb(cur);
        totalPssKb += (pssKb !== null ? pssKb : rssKb);
        for (const c of (children.get(cur) || [])) stack.push(c);
      }
      const pssMb = Math.round(totalPssKb / 1024);
      const rssMb = Math.round(totalRssKb / 1024);
      const availMb = readMemAvailableMb();
      const hardOver = pssMb > HARD_MAX_SESSION_MB;
      const over = hardOver || (pssMb > MAX_SESSION_MB && availMb < MIN_SYSTEM_AVAILABLE_MB);
      if (!over) {
        memBreachCount = 0;
        return;
      }
      memBreachCount += 1;
      const rawUrl = (activePage && !activePage.isClosed()) ? activePage.url() : '';
      const safeUrl = stripUrlQuery(rawUrl);
      const onSensitivePage = Boolean(rawUrl && isSensitivePageUrl(rawUrl));
      const required = hardOver ? 2 : (onSensitivePage ? 4 : 2);
      const limitMb = hardOver ? HARD_MAX_SESSION_MB : MAX_SESSION_MB;
      if (memBreachCount < required) {
        console.error(`[lab-browser] Session ${sessionName} memory warning (${memBreachCount}/${required}): PSS ${pssMb} MB, RSS ${rssMb} MB, avail ${availMb} MB, limit ${limitMb} MB, url=${safeUrl}`);
        return;
      }
      try {
        broadcast({
          type: 'session_closed',
          reason: 'memory_limit_exceeded',
          mb: pssMb,
          limitMb,
        });
      } catch (_) {}
      console.error(`[lab-browser] Session ${sessionName} exceeded memory limit (PSS ${pssMb} MB > ${limitMb} MB; RSS ${rssMb} MB, avail ${availMb} MB, url=${safeUrl}), shutting down to protect homelab.`);
      shutdown('memory_limit_exceeded').catch(() => process.exit(0));
    } catch (_) {}
  }, 30000);
  if (typeof rssWatchdog.unref === 'function') rssWatchdog.unref();

  function resetIdleTimer() {
    lastActivityAt = new Date().toISOString();
    lastCommandAtMs = Date.now();
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (closing) return;
      const idleDurationMs = Date.now() - lastCommandAtMs;
      if (aiBusy || ((subscribers.size > 0 || pendingSubscribers > 0) && idleDurationMs < MAX_VIEWER_IDLE_MS)) {
        idleTimer = setTimeout(() => {
          if (!closing && !aiBusy && (Date.now() - lastCommandAtMs >= MAX_VIEWER_IDLE_MS || subscribers.size === 0)) {
            shutdown('idle_timeout').catch(() => process.exit(0));
          } else if (!closing) {
            resetIdleTimer();
          }
        }, Math.min(idleTtlSec * 1000, 60000));
        idleTimer.unref();
        return;
      }
      shutdown('idle_timeout').catch(() => process.exit(0));
    }, idleTtlSec * 1000);
    idleTimer.unref();
  }

  async function shutdown(reason = 'shutdown') {
    if (closing) return;
    closing = true;
    if (idleTimer) clearTimeout(idleTimer);
    if (authSyncTimer) clearTimeout(authSyncTimer);
    stopKeepaliveTimer();

    if (authWatcherAttached && authPath) {
      try { fs.unwatchFile(authPath, onAuthFileChange); } catch (_) {}
      authWatcherAttached = false;
    }

    await withTimeout(stopScreencast(), 1500);

    if (authProfile && !authFlushedOnClose) {
      authFlushedOnClose = true;
      await withTimeout(flushAuth(true), SHUTDOWN_AUTH_TIMEOUT_MS);
    }

    for (const sock of subscribers) {
      try { sock.destroy(); } catch (_) {}
    }
    subscribers.clear();

    const closeNetServer = (srv) => {
      if (!srv) return Promise.resolve();
      return withTimeout(new Promise((resolve) => srv.close(() => resolve())), 1500);
    };
    await Promise.all([closeNetServer(streamServer), closeNetServer(server)]);

    await withTimeout(session.close(), 4000);
    safeUnlink(sockPath);
    safeUnlink(streamSockPath);
    safeUnlink(metaPath);
    process.exit(reason === 'error' ? 1 : 0);
  }

  // ── Stream Input & Action Dispatcher (Bypasses Command Queue) ──────────────
  async function handleMouseInput(page, msg) {
    const x = Number(msg.x);
    const y = Number(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const action = normalizeMouseAction(msg.action || msg.event || msg.mouseType);
    const modifiers = normalizeModifiers(msg.modifiers);
    const clickCount = Math.max(1, Number(msg.clickCount) || 1);

    if (action !== 'mouseMoved' && !paused && isAiRecentlyBusy()) {
      setPaused(true, 'USER_INTERVENING');
    }

    const cdp = await ensureInputCdp(page);
    const dispatchOne = async (cdpType, count) => {
      const button = normalizeMouseButton(msg.button, cdpType);
      if (cdp) {
        await cdp.send('Input.dispatchMouseEvent', {
          type: cdpType,
          x,
          y,
          button,
          clickCount: cdpType === 'mouseMoved' ? 0 : count,
          modifiers,
        });
      } else {
        if (cdpType === 'mouseMoved') {
          await page.mouse.move(x, y);
        } else if (cdpType === 'mousePressed') {
          await page.mouse.move(x, y);
          await page.mouse.down({ button: button === 'none' ? 'left' : button, clickCount: count });
        } else if (cdpType === 'mouseReleased') {
          await page.mouse.move(x, y);
          await page.mouse.up({ button: button === 'none' ? 'left' : button, clickCount: count });
        }
      }
    };

    if (action === 'click') {
      await dispatchOne('mousePressed', clickCount);
      await dispatchOne('mouseReleased', clickCount);
    } else if (action === 'dblclick') {
      await dispatchOne('mousePressed', 1);
      await dispatchOne('mouseReleased', 1);
      await dispatchOne('mousePressed', 2);
      await dispatchOne('mouseReleased', 2);
    } else {
      await dispatchOne(action, clickCount);
    }

    if (authProfile && action !== 'mouseMoved') {
      scheduleAuthSync();
    }
    if (action === 'mouseReleased' || action === 'click' || action === 'dblclick') {
      const focusState = await inspectFocusedEditable(page).catch(() => ({ isEditable: false }));
      broadcast({ type: 'focus-state', ...(focusState || { isEditable: false }) });
    }
  }

  async function handleWheelInput(page, msg) {
    if (!paused && isAiRecentlyBusy()) {
      setPaused(true, 'USER_INTERVENING');
    }
    const x = Number(msg.x);
    const y = Number(msg.y);
    const deltaX = Number(msg.deltaX ?? msg.dx ?? 0) || 0;
    const deltaY = Number(msg.deltaY ?? msg.dy ?? 0) || 0;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      await page.mouse.move(x, y);
    }
    await page.mouse.wheel(deltaX, deltaY);
  }

  async function handleKeyInput(page, msg) {
    if (!paused && isAiRecentlyBusy()) {
      setPaused(true, 'USER_INTERVENING');
    }
    const rawAction = String(msg.action || msg.event || 'press').trim().toLowerCase();
    const key = typeof msg.key === 'string' ? msg.key : '';
    const text = typeof msg.text === 'string' ? msg.text : '';
    const useInsertText = Boolean(
      text &&
      (!key || key.length === 1) &&
      !hasNonShiftModifier(msg)
    );

    if (rawAction === 'down' || rawAction === 'keydown') {
      if (useInsertText) {
        await page.keyboard.insertText(text);
      } else if (key) {
        await page.keyboard.down(key);
      }
    } else if (rawAction === 'up' || rawAction === 'keyup') {
      if (key && !useInsertText) {
        // Guard against non-ASCII / Unicode characters (e.g. Thai) that were inserted via insertText
        if (key.length > 1 || key.charCodeAt(0) <= 127) {
          await page.keyboard.up(key);
        }
      }
    } else {
      // press
      if (useInsertText) {
        await page.keyboard.insertText(text);
      } else if (key) {
        await page.keyboard.press(key);
      }
    }

    if (authProfile && (key === 'Enter' || key === 'Return')) {
      scheduleAuthSync();
    }
    if (key === 'Tab' || key === 'Enter' || key === 'Return') {
      const focusState = await inspectFocusedEditable(page).catch(() => ({ isEditable: false }));
      broadcast({ type: 'focus-state', ...(focusState || { isEditable: false }) });
    }
  }

  async function handleTextInput(page, msg) {
    if (!paused && isAiRecentlyBusy()) {
      setPaused(true, 'USER_INTERVENING');
    }
    const text = typeof msg.text === 'string'
      ? msg.text
      : (typeof msg.value === 'string' ? msg.value : '');
    if (text) {
      await page.keyboard.insertText(text);
    }
  }

  async function handleNavAction(page, action, rawUrl) {
    const act = String(action || '').toLowerCase();
    if (act === 'back') {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    } else if (act === 'forward') {
      await page.goForward({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    } else if (act === 'reload') {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    } else if (act === 'goto' || act === 'navigate') {
      const safeUrl = config.normalizeUrl(rawUrl);
      if (authProfile) {
        await pullAuthIfStoreChanged();
      }
      await page.goto(safeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } else {
      throw new Error(`Unsupported nav action "${action}"`);
    }
    await broadcastPageState(page);
    if (authProfile) {
      scheduleAuthSync();
    }
  }

  async function handleStreamMessage(socket, msg) {
    if (closing || !msg || typeof msg !== 'object') return;
    resetIdleTimer();
    const type = String(msg.type || '').trim().toLowerCase();
    const reqId = msg.reqId !== undefined ? msg.reqId : (msg.id !== undefined ? msg.id : null);

    try {
      if (type === 'ping') {
        sendToSubscriber(socket, { type: 'pong', ts: Date.now() });
        return;
      }
      if (type === 'pong') {
        return;
      }
      if (type === 'status') {
        const st = await buildStatusPayload();
        sendToSubscriber(socket, { type: 'status', ...st });
        return;
      }
      if (type === 'pause') {
        const reason = String(msg.reason || 'USER_PAUSED');
        setPaused(true, reason);
        return;
      }
      if (type === 'resume') {
        const note = typeof msg.note === 'string' && msg.note.trim() ? msg.note.trim() : null;
        if (authProfile) {
          await flushAuth(true).catch(() => {});
        }
        setPaused(false, null, note ? { note } : {});
        return;
      }

      const page = await getActivePage();

      if (type === 'input') {
        const kind = String(msg.kind || msg.inputType || '').trim().toLowerCase();
        if (kind === 'mouse') {
          await handleMouseInput(page, msg);
        } else if (kind === 'wheel') {
          await handleWheelInput(page, msg);
        } else if (kind === 'key' || kind === 'keyboard') {
          await handleKeyInput(page, msg);
        } else if (kind === 'text') {
          await handleTextInput(page, msg);
        } else if (kind === 'capture') {
          const buf = await page.screenshot({ type: 'png' });
          sendToSubscriber(socket, {
            type: 'capture',
            ...(reqId !== null ? { reqId, id: reqId } : {}),
            dataUrl: 'data:image/png;base64,' + buf.toString('base64'),
            url: page.url(),
            title: await page.title().catch(() => ''),
            viewport: getPageViewport(page),
          });
        } else if (kind === 'nav' || kind === 'navigate') {
          await handleNavAction(page, msg.action || 'goto', msg.url);
        }
        return;
      }

      if (type === 'mouse') {
        await handleMouseInput(page, msg);
        return;
      }
      if (type === 'wheel') {
        await handleWheelInput(page, msg);
        return;
      }
      if (type === 'key' || type === 'keyboard') {
        await handleKeyInput(page, msg);
        return;
      }
      if (type === 'text') {
        await handleTextInput(page, msg);
        return;
      }

      if (type === 'inspect') {
        const x = Number(msg.x);
        const y = Number(msg.y);
        const info = await inspectPoint(page, x, y);
        sendToSubscriber(socket, {
          ...(info || {}),
          type: 'inspect',
          ...(reqId !== null ? { reqId, id: reqId } : {}),
          x,
          y,
          found: Boolean(info),
          element: info,
        });
        return;
      }

      if (type === 'capture') {
        const buf = await page.screenshot({ type: 'png' });
        sendToSubscriber(socket, {
          type: 'capture',
          ...(reqId !== null ? { reqId, id: reqId } : {}),
          dataUrl: 'data:image/png;base64,' + buf.toString('base64'),
          url: page.url(),
          title: await page.title().catch(() => ''),
          viewport: getPageViewport(page),
        });
        return;
      }

      if (type === 'nav') {
        await handleNavAction(page, msg.action || (msg.url ? 'goto' : 'reload'), msg.url);
        return;
      }
      if (type === 'navigate') {
        await handleNavAction(page, 'goto', msg.url);
        return;
      }
      if (type === 'back' || type === 'forward' || type === 'reload') {
        await handleNavAction(page, type);
        return;
      }

      if (type === 'tabs') {
        await broadcastPageState(page);
        return;
      }

      if (type === 'tab') {
        const idx = Number(msg.index);
        const pages = session.context.pages().filter((p) => !p.isClosed());
        if (Number.isInteger(idx) && idx >= 0 && idx < pages.length) {
          await setActivePage(pages[idx]);
          await pages[idx].bringToFront().catch(() => {});
        }
        return;
      }

      if (type === 'new-tab') {
        const newPage = await session.context.newPage();
        await setActivePage(newPage);
        await newPage.bringToFront().catch(() => {});
        const rawUrl = typeof msg.url === 'string' ? msg.url.trim() : '';
        if (rawUrl && rawUrl.toLowerCase() !== 'about:blank') {
          const safeUrl = config.normalizeUrl(rawUrl);
          if (authProfile) await pullAuthIfStoreChanged();
          await newPage.goto(safeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await broadcastPageState(newPage);
          if (authProfile) scheduleAuthSync();
        }
        return;
      }

      if (type === 'close-tab') {
        const pages = session.context.pages().filter((p) => !p.isClosed());
        const idx = msg.index !== undefined ? Number(msg.index) : pages.indexOf(page);
        const targetPage = Number.isInteger(idx) && idx >= 0 && idx < pages.length ? pages[idx] : page;
        if (pages.length <= 1) {
          await targetPage.goto('about:blank').catch(() => {});
          await broadcastPageState(targetPage);
        } else {
          await targetPage.close().catch(() => {});
        }
        return;
      }

      if (type === 'resize' || type === 'viewport') {
        const width = Math.max(200, Math.min(4096, Math.round(Number(msg.width) || 0)));
        const height = Math.max(200, Math.min(4096, Math.round(Number(msg.height) || 0)));
        if (width >= 200 && height >= 200) {
          await page.setViewportSize({ width, height });
          if (screencastRunning && activeCdpPage === page) {
            await stopScreencast();
            await startScreencast(page);
          }
          await broadcastPageState(page);
        }
        return;
      }

      if (type === 'quality') {
        const q = Math.max(20, Math.min(95, Math.round(Number(msg.quality) || 72)));
        if (q !== screencastQuality) {
          screencastQuality = q;
          if (screencastRunning && activeCdpPage === page) {
            await stopScreencast();
            await startScreencast(page);
          }
        }
      }
    } catch (err) {
      sendToSubscriber(socket, {
        type: 'error',
        ...(reqId !== null ? { reqId, id: reqId } : {}),
        action: type,
        error: err && err.message ? err.message : String(err),
      });
    }
  }

  // ── Command Socket Handler ─────────────────────────────────────────────────
  async function handleCommand(req) {
    resetIdleTimer();
    const cmd = String(req.cmd || '').toLowerCase();
    const args = Array.isArray(req.args) ? req.args : [];
    const opts = { ...(req.opts || {}), sessionMode: true };

    if (cmd === 'ping') {
      return { ok: true, pong: true, session: sessionName, pid: process.pid };
    }

    if (cmd === 'status') {
      return buildStatusPayload();
    }

    if (cmd === 'pause') {
      const reason = String(args[0] || opts.reason || 'USER_PAUSED');
      setPaused(true, reason);
      const curUrl = activePage && !activePage.isClosed() ? activePage.url() : '';
      return {
        ok: true,
        action: 'pause',
        session: sessionName,
        paused: true,
        pauseReason: reason,
        url: curUrl,
      };
    }

    if (cmd === 'resume') {
      const note = String(args[0] || opts.note || '').trim() || null;
      if (authProfile) {
        await flushAuth(true).catch(() => {});
      }
      setPaused(false, null, note ? { note } : {});
      const curUrl = activePage && !activePage.isClosed() ? activePage.url() : '';
      return {
        ok: true,
        action: 'resume',
        session: sessionName,
        paused: false,
        pauseReason: null,
        ...(note ? { note } : {}),
        url: curUrl,
      };
    }

    if (cmd === 'auth-sync') {
      if (!authProfile) {
        return {
          ok: true,
          action: 'auth-sync',
          session: sessionName,
          authProfile: null,
          synced: false,
          message: 'Session does not use shared auth',
        };
      }
      const syncRes = await flushAuth(true);
      return {
        ok: true,
        action: 'auth-sync',
        session: sessionName,
        authProfile,
        synced: true,
        ...(syncRes || {}),
      };
    }

    if (cmd === 'auth-clear') {
      const targetProfile = authProfile || (opts.authProfile ? config.sanitizeAuthProfile(opts.authProfile) : null);
      let clearRes = null;
      if (targetProfile) {
        clearRes = authStore.clear(targetProfile);
      }
      await session.context.clearCookies().catch(() => {});
      resetAuthCursor(clearRes ? clearRes.version : lastAuthVersion);
      return {
        ok: true,
        action: 'auth-clear',
        session: sessionName,
        authProfile: targetProfile,
        cleared: true,
        ...(clearRes ? { version: clearRes.version } : {}),
      };
    }

    if (cmd === 'tabs') {
      await getActivePage();
      const tabs = await getTabsList();
      return { ok: true, action: 'tabs', session: sessionName, tabs };
    }

    if (cmd === 'tab') {
      const idx = Number(args[0]);
      const pages = session.context.pages().filter((p) => !p.isClosed());
      if (!Number.isInteger(idx) || idx < 0 || idx >= pages.length) {
        throw new Error(`Invalid tab index "${args[0]}" (available: 0..${Math.max(0, pages.length - 1)})`);
      }
      await setActivePage(pages[idx]);
      await activePage.bringToFront().catch(() => {});
      return {
        ok: true,
        action: 'tab',
        index: idx,
        url: activePage.url(),
        title: await activePage.title().catch(() => ''),
      };
    }

    if (cmd === 'close' || cmd === 'stop' || cmd === 'quit') {
      if (authProfile && !authFlushedOnClose) {
        authFlushedOnClose = true;
        await withTimeout(flushAuth(true), SHUTDOWN_AUTH_TIMEOUT_MS);
      }
      setImmediate(() => {
        shutdown('requested').catch(() => process.exit(0));
      });
      return { ok: true, action: 'close', session: sessionName, closed: true };
    }

    // Pause gate for mutating commands (CONTRACT E)
    const isMutating = MUTATING_CMDS.has(cmd);
    if (paused && isMutating) {
      const curUrl = activePage && !activePage.isClosed() ? activePage.url() : '';
      return {
        ok: false,
        paused: true,
        pauseReason,
        url: curUrl,
        message: PAUSED_MESSAGE,
      };
    }

    // Pull latest shared auth cookies before open/click/eval
    if (authProfile && AUTH_PULL_BEFORE_CMDS.has(cmd)) {
      await pullAuthIfStoreChanged();
    }

    // --new-tab support for open/visit/navigate
    if (opts.newTab && OPEN_CMDS.has(cmd)) {
      const newPage = await session.context.newPage();
      await setActivePage(newPage);
      await newPage.bringToFront().catch(() => {});
    }

    const page = await getActivePage();
    const telemetry = getTelemetry(page);

    if (isMutating) {
      setAiBusy(true, cmd, args[0] || null);
    }

    let result;
    try {
      const actionOpts = {
        ...opts,
        visual: subscribers.size > 0,
        onAiAction: (evt) => {
          broadcast({
            type: 'ai-action',
            ...evt,
            aiBusy: true,
            ts: Date.now(),
          });
        },
      };
      result = await executeAction(page, telemetry, cmd, args, actionOpts);

      // Sensitive page auto-pause / warning (CONTRACT F)
      if (result && result.ok && SENSITIVE_CHECK_CMDS.has(cmd)) {
        const sensitive = await detectSensitive(page);
        if (sensitive) {
          if (subscribers.size > 0) {
            const handoff = { kind: sensitive.kind, message: sensitive.message };
            setPaused(true, sensitive.pauseReason, { handoff });
            result.handoff = handoff;
          } else {
            result.sensitive = { kind: sensitive.kind };
          }
        }
      }

      if (OPEN_CMDS.has(cmd) || cmd === 'back' || cmd === 'reload') {
        await broadcastPageState(page).catch(() => {});
      }
    } finally {
      if (isMutating) {
        setAiBusy(false, cmd);
        resetIdleTimer();
        if (authProfile) {
          scheduleAuthSync();
        }
      }
    }

    return result;
  }

  // ── Command Unix Socket Server ─────────────────────────────────────────────
  const IMMEDIATE_CMDS = new Set(['ping', 'status', 'pause']);

  server = net.createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');

    const reply = (res) => {
      if (!socket.destroyed && socket.writable) {
        socket.write(JSON.stringify(res) + '\n');
      }
    };

    socket.on('data', (chunk) => {
      buffer += chunk;
      let nlIdx;
      while ((nlIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nlIdx).trim();
        buffer = buffer.slice(nlIdx + 1);
        if (!line) continue;

        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch (err) {
          reply({ ok: false, error: err && err.message ? err.message : String(err) });
          continue;
        }

        const cmdLower = String((parsed && parsed.cmd) || '').toLowerCase();

        // Bypass blocking action queue for status/ping/pause and immediate paused rejections
        if (IMMEDIATE_CMDS.has(cmdLower) || (paused && MUTATING_CMDS.has(cmdLower))) {
          handleCommand(parsed)
            .then(reply)
            .catch((err) => reply({ ok: false, error: err && err.message ? err.message : String(err) }));
          continue;
        }

        queue = queue.then(async () => {
          let res;
          try {
            res = await handleCommand(parsed);
          } catch (err) {
            res = { ok: false, error: err && err.message ? err.message : String(err) };
          }
          reply(res);
        });
      }
    });
  });

  // ── Stream Unix Socket Server ──────────────────────────────────────────────
  streamServer = net.createServer((socket) => {
    if (closing) {
      socket.destroy();
      return;
    }
    socket.setEncoding('utf8');
    let buffer = '';
    let detached = false;
    pendingSubscribers++;
    resetIdleTimer();

    const onDisconnect = () => {
      if (detached) return;
      detached = true;
      const had = subscribers.delete(socket);
      if (had && subscribers.size === 0 && !closing) {
        stopScreencast().catch(() => {});
        resetIdleTimer();
      }
    };

    socket.on('close', onDisconnect);
    socket.on('end', onDisconnect);
    socket.on('error', onDisconnect);

    socket.on('data', (chunk) => {
      buffer += chunk;
      let nlIdx;
      while ((nlIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nlIdx).trim();
        buffer = buffer.slice(nlIdx + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch (_) {
          continue;
        }
        handleStreamMessage(socket, msg).catch(() => {});
      }
    });

    (async () => {
      try {
        const page = await getActivePage();
        const tabs = await getTabsList();
        const activeTab = tabs.findIndex((t) => t.active);
        if (detached || closing || socket.destroyed) return;

        subscribers.add(socket);
        sendToSubscriber(socket, {
          type: 'hello',
          session: sessionName,
          pid: process.pid,
          authProfile: authProfile || null,
          url: page.url(),
          title: await page.title().catch(() => ''),
          viewport: getPageViewport(page),
          tabs,
          activeTab: activeTab >= 0 ? activeTab : 0,
          paused,
          pauseReason,
          aiBusy,
          viewers: subscribers.size,
        });

        if (lastFrameMsg && !socket.destroyed) {
          sendToSubscriber(socket, lastFrameMsg);
        }

        if (subscribers.size === 1) {
          await startScreencast(page);
        }
      } catch (_) {
        onDisconnect();
      } finally {
        pendingSubscribers = Math.max(0, pendingSubscribers - 1);
      }
    })();
  });

  // ── Bind Both Sockets & Write Metadata ─────────────────────────────────────
  const listenSocket = (srv, filePath) =>
    new Promise((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(filePath, () => {
        try {
          fs.chmodSync(filePath, 0o600);
        } catch (_) {
          // ignore chmod error
        }
        resolve();
      });
    });

  await listenSocket(server, sockPath);
  await listenSocket(streamServer, streamSockPath);

  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        session: sessionName,
        pid: process.pid,
        socketPath: sockPath,
        streamSocketPath: streamSockPath,
        authProfile: authProfile || null,
        startedAt,
        idleTtlSec,
        persist: Boolean(initOpts.persist),
      },
      null,
      2
    ),
    { mode: 0o600 }
  );

  resetIdleTimer();
  process.on('SIGTERM', () => shutdown('sigterm'));
  process.on('SIGINT', () => shutdown('sigint'));

  if (session.browser) {
    session.browser.on('disconnected', () => {
      shutdown('browser_disconnected').catch(() => process.exit(1));
    });
  }
}

main().catch((err) => {
  process.stderr.write((err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(1);
});
