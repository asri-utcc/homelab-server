(function () {
  'use strict';

  // ── Query Parameters & Session Identity ────────────────────────────────────
  const params = new URLSearchParams(window.location.search || '');
  const rawProfile = String(params.get('profile') || '').trim();
  const profileValid = /^[a-z0-9_-]{1,16}$/i.test(rawProfile);
  const CHAT_ID = profileValid ? ('labweb_' + rawProfile).slice(0, 29) : 'labweb_main';
  const SESSION_NAME = 'bv_' + CHAT_ID;
  const DEFAULT_START_URL = 'https://www.google.com';
  const rawInitialUrl = String(params.get('url') || '').trim();

  const IDLE_TTL_SEC = 3600;
  const PING_INTERVAL_MS = 25000;
  const RESIZE_DEBOUNCE_MS = 400;
  const BACKOFF_MS = [1000, 2000, 4000, 7000, 11000, 15000];
  const VIEWPORT_MIN_W = 800;
  const VIEWPORT_MAX_W = 1920;
  const VIEWPORT_MIN_H = 500;
  const VIEWPORT_MAX_H = 1200;

  const SENSITIVE_LABELS = new Map([
    ['sensitive_captcha', '🤖 CAPTCHA'],
    ['captcha', '🤖 CAPTCHA'],
    ['sensitive_otp', '🔢 OTP'],
    ['otp', '🔢 OTP'],
    ['sensitive_password', '🔐 รหัสผ่าน / Login'],
    ['password', '🔐 รหัสผ่าน / Login'],
    ['sensitive_payment', '💳 ชำระเงิน'],
    ['payment', '💳 ชำระเงิน'],
    ['user_intervening', '✋ ผู้ใช้กำลังควบคุม'],
    ['user_paused', '⏸️ หยุดโดยผู้ใช้'],
    ['user', '⏸️ หยุดโดยผู้ใช้']
  ]);

  const SPECIAL_KEYS = new Set([
    'Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'Insert',
    'Home', 'End', 'PageUp', 'PageDown',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'
  ]);

  const SHORTCUT_KEYS = new Set(['a', 'c', 'x', 'z', 'y']);

  // ── DOM References ─────────────────────────────────────────────────────────
  const btnBack = document.getElementById('lb-btn-back');
  const btnForward = document.getElementById('lb-btn-forward');
  const btnReload = document.getElementById('lb-btn-reload');
  const urlInput = document.getElementById('lb-url-input');
  const tabSelect = document.getElementById('lb-tab-select');
  const btnNewTab = document.getElementById('lb-btn-new-tab');
  const btnCloseTab = document.getElementById('lb-btn-close-tab');

  const statusPill = document.getElementById('lb-status-pill');
  const viewportBadge = document.getElementById('lb-viewport-badge');
  const sessionBadge = document.getElementById('lb-session-badge');

  const authBtn = document.getElementById('lb-auth-btn');
  const authPopover = document.getElementById('lb-auth-popover');
  const authRefreshBtn = document.getElementById('lb-auth-refresh');
  const authMeta = document.getElementById('lb-auth-meta');
  const authDomainsEl = document.getElementById('lb-auth-domains');
  const authClearBtn = document.getElementById('lb-auth-clear-btn');

  const kbBtn = document.getElementById('lb-kb-btn');
  const fullscreenBtn = document.getElementById('lb-fullscreen-btn');
  const reconnectBtn = document.getElementById('lb-reconnect-btn');
  const closeBrowserBtn = document.getElementById('lb-close-browser-btn');

  const pauseBanner = document.getElementById('lb-pause-banner');
  const pauseKindEl = document.getElementById('lb-pause-kind');
  const resumeNoteInput = document.getElementById('lb-resume-note');
  const resumeBtn = document.getElementById('lb-resume-btn');

  const stageWrap = document.getElementById('lb-stage-wrap');
  const stageEl = document.getElementById('lb-stage');
  const frameImg = document.getElementById('lb-frame-img');
  const placeholderEl = document.getElementById('lb-placeholder');
  const placeholderIcon = document.getElementById('lb-placeholder-icon');
  const placeholderTitle = document.getElementById('lb-placeholder-title');
  const placeholderSub = document.getElementById('lb-placeholder-sub');
  const placeholderRetry = document.getElementById('lb-placeholder-retry');

  const kbBar = document.getElementById('lb-kb-bar');
  const kbTag = document.getElementById('lb-kb-tag');
  const kbProxy = document.getElementById('lb-kb-proxy');
  const kbTabBtn = document.getElementById('lb-kb-tab');
  const kbEnterBtn = document.getElementById('lb-kb-enter');
  const kbBackspaceBtn = document.getElementById('lb-kb-backspace');
  const kbCloseBtn = document.getElementById('lb-kb-close');

  const toastStack = document.getElementById('lb-toast-stack');

  if (sessionBadge) {
    sessionBadge.textContent = SESSION_NAME;
    sessionBadge.title = `เซสชัน: ${SESSION_NAME} (AI สามารถสั่งงานร่วมได้ด้วย --session ${SESSION_NAME} --shared-auth)`;
  }

  // ── Runtime State ──────────────────────────────────────────────────────────
  let ws = null;
  let wsConnecting = false;
  let wsConnected = false;
  let connectSeq = 0;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let pingTimer = null;
  let userClosed = false;
  let closingBrowser = false;

  let viewport = { width: 1280, height: 800 };
  let lastSentResize = { width: 0, height: 0 };
  let resizeTimer = null;

  let paused = false;
  let pauseReason = '';
  let tabsCount = 1;
  let activeTabIndex = 0;

  let pendingFrame = null;
  let frameRafScheduled = false;

  let pendingMouseMove = null;
  let mouseMoveRafScheduled = false;
  let activeMouseButton = null;

  let kbComposing = false;
  let kbManualOpen = false;
  let kbDismissedByUser = false;
  let kbFieldInfo = null;
  let lastKbBackspaceAt = 0;

  // ── Utility Helpers ────────────────────────────────────────────────────────
  function redirectToLogin() {
    const nextUrl = '/lab-browser' + (window.location.search || '');
    window.location.replace('/login?next=' + encodeURIComponent(nextUrl));
  }

  function normalizeUserUrl(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
    return 'https://' + trimmed;
  }

  function showToast(message, variant) {
    if (!toastStack || !message) return;
    const toast = document.createElement('div');
    toast.className = 'lb-toast' + (variant ? ' lb-toast--' + variant : '');
    toast.textContent = String(message);
    toastStack.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.2s ease';
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 220);
    }, 4500);
  }

  function formatBrowserError(rawMsg, httpStatus) {
    const text = String(rawMsg || '').trim();
    if (/max.*browser|browser.*limit|limit.*reached|MAX_CHAT_BROWSERS|too many.*browser/i.test(text)) {
      return 'เปิดเบราว์เซอร์เกินจำนวนสูงสุดพร้อมกัน (สูงสุด 5 ตัว) — กรุณาปิดเบราว์เซอร์ห้องอื่นก่อนแล้วลองใหม่';
    }
    if (/low.*ram|min_free|free.*mb|out of memory|memory.*limit|ENOMEM|\bram\b/i.test(text)) {
      return 'RAM ของเซิร์ฟเวอร์ต่ำกว่าเกณฑ์ปลอดภัย — กรุณาปิดเบราว์เซอร์อื่นเพื่อคืนหน่วยความจำก่อนลองใหม่';
    }
    if (text) return text;
    if (httpStatus) return `เซิร์ฟเวอร์ตอบกลับ HTTP ${httpStatus}`;
    return 'ไม่สามารถเชื่อมต่อเบราว์เซอร์ได้';
  }

  function isTouchOrMobileView() {
    try {
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
    } catch (_) {}
    return Boolean(('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.innerWidth <= 900);
  }

  function getButtonName(btn) {
    if (btn === 1) return 'middle';
    if (btn === 2) return 'right';
    return 'left';
  }

  function getModifiersMask(e) {
    return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
  }

  // ── UI State Updaters ──────────────────────────────────────────────────────
  function setPlaceholder(visible, title, sub, showRetry, icon) {
    if (!placeholderEl) return;
    placeholderEl.classList.toggle('is-hidden', !visible);
    if (icon !== undefined && placeholderIcon) placeholderIcon.textContent = icon;
    if (title !== undefined && placeholderTitle) placeholderTitle.textContent = title;
    if (sub !== undefined && placeholderSub) placeholderSub.textContent = sub;
    if (placeholderRetry) {
      placeholderRetry.style.display = showRetry ? 'inline-flex' : 'none';
    }
  }

  function updateViewportBadge() {
    if (viewportBadge) {
      viewportBadge.textContent = `${viewport.width}×${viewport.height}`;
    }
  }

  function updateStatusUI() {
    if (statusPill) {
      statusPill.className = 'lb-pill';
      if (paused) {
        statusPill.classList.add('lb-pill--paused');
        statusPill.textContent = '⏸️ หยุดชั่วคราว';
      } else if (wsConnected) {
        statusPill.classList.add('lb-pill--online');
        statusPill.textContent = '🟢 ออนไลน์';
      } else if (wsConnecting) {
        statusPill.classList.add('lb-pill--connecting');
        statusPill.textContent = '🟡 กำลังเชื่อม...';
      } else {
        statusPill.classList.add('lb-pill--offline');
        statusPill.textContent = '⚪ ออฟไลน์';
      }
    }

    if (closeBrowserBtn) {
      closeBrowserBtn.disabled = closingBrowser;
    }

    if (pauseBanner) {
      pauseBanner.classList.toggle('is-visible', Boolean(paused));
      if (pauseKindEl) {
        const key = String(pauseReason || '').toLowerCase();
        const label = pauseReason ? (SENSITIVE_LABELS.get(key) || String(pauseReason)) : '';
        if (label) {
          pauseKindEl.textContent = label;
          pauseKindEl.style.display = 'inline-flex';
        } else {
          pauseKindEl.style.display = 'none';
        }
      }
    }

    updateKbBarUI();
  }

  function updateUrlUI(url) {
    if (!urlInput || typeof url !== 'string') return;
    if (document.activeElement !== urlInput) {
      urlInput.value = url;
    }
  }

  function updateTabsUI(tabs, activeIndex) {
    if (!tabSelect || !Array.isArray(tabs) || tabs.length === 0) return;
    tabsCount = tabs.length;
    const prevVal = tabSelect.value;
    tabSelect.innerHTML = '';
    let resolvedActive = activeIndex;

    tabs.forEach((t, idx) => {
      const opt = document.createElement('option');
      const tabIdx = typeof t.index === 'number' ? t.index : idx;
      opt.value = String(tabIdx);
      const rawTitle = String(t.title || t.url || `แท็บ ${tabIdx + 1}`).trim();
      const shortTitle = rawTitle.length > 34 ? rawTitle.slice(0, 34) + '…' : rawTitle;
      opt.textContent = `${tabIdx + 1}. ${shortTitle}`;
      if (t.active || tabIdx === activeIndex) {
        opt.selected = true;
        resolvedActive = tabIdx;
      }
      tabSelect.appendChild(opt);
    });

    if (resolvedActive !== undefined && resolvedActive !== null) {
      activeTabIndex = Number(resolvedActive) || 0;
      tabSelect.value = String(activeTabIndex);
    } else if (prevVal && Array.from(tabSelect.options).some((o) => o.value === prevVal)) {
      tabSelect.value = prevVal;
      activeTabIndex = parseInt(prevVal, 10) || 0;
    }
  }

  function resetFrameState() {
    pendingFrame = null;
    paused = false;
    pauseReason = '';
    frameImg.classList.remove('has-frame');
    frameImg.removeAttribute('src');
    updateStatusUI();
  }

  // ── Coordinate Mapping (object-fit: contain <-> actual frame viewport) ────
  function getRenderedImageRect() {
    const box = frameImg.getBoundingClientRect();
    const boxW = box.width;
    const boxH = box.height;
    if (boxW <= 0 || boxH <= 0) {
      return { left: box.left, top: box.top, width: 0, height: 0 };
    }
    const natW = frameImg.naturalWidth || viewport.width || 1280;
    const natH = frameImg.naturalHeight || viewport.height || 800;
    const imgRatio = natW / natH;
    const boxRatio = boxW / boxH;

    let renderW;
    let renderH;
    let offsetX;
    let offsetY;
    if (boxRatio > imgRatio) {
      renderH = boxH;
      renderW = boxH * imgRatio;
      offsetX = (boxW - renderW) / 2;
      offsetY = 0;
    } else {
      renderW = boxW;
      renderH = boxW / imgRatio;
      offsetX = 0;
      offsetY = (boxH - renderH) / 2;
    }
    return {
      left: box.left + offsetX,
      top: box.top + offsetY,
      width: renderW,
      height: renderH
    };
  }

  function mapPoint(clientX, clientY) {
    const rect = getRenderedImageRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { x: 0, y: 0, inside: false };
    }
    const normX = (clientX - rect.left) / rect.width;
    const normY = (clientY - rect.top) / rect.height;
    const inside = normX >= 0 && normX <= 1 && normY >= 0 && normY <= 1;
    const clampedX = Math.max(0, Math.min(1, normX));
    const clampedY = Math.max(0, Math.min(1, normY));
    const targetW = viewport.width || frameImg.naturalWidth || 1280;
    const targetH = viewport.height || frameImg.naturalHeight || 800;
    return {
      x: Math.round(clampedX * targetW),
      y: Math.round(clampedY * targetH),
      inside
    };
  }

  // ── Frame Rendering (rAF coalescing) ──────────────────────────────────────
  function flushFrame() {
    frameRafScheduled = false;
    const frame = pendingFrame;
    pendingFrame = null;
    if (!frame || !frame.data) return;

    const mime = frame.mime || 'image/jpeg';
    frameImg.src = frame.data.startsWith('data:') ? frame.data : `data:${mime};base64,${frame.data}`;
    if (!frameImg.classList.contains('has-frame')) {
      frameImg.classList.add('has-frame');
      setPlaceholder(false);
    }
  }

  function scheduleFrame(msg) {
    const meta = msg.meta || msg.metadata || {};
    const w = Number(meta.deviceWidth || msg.width || 0);
    const h = Number(meta.deviceHeight || msg.height || 0);
    if (w > 0 && h > 0 && (w !== viewport.width || h !== viewport.height)) {
      viewport = { width: w, height: h };
      updateViewportBadge();
    }
    pendingFrame = {
      data: msg.data,
      mime: msg.mime || 'image/jpeg'
    };
    if (!frameRafScheduled) {
      frameRafScheduled = true;
      requestAnimationFrame(flushFrame);
    }
  }

  // ── Mobile / IME Keyboard Bar ──────────────────────────────────────────────
  function applyKbInputAttributes(info) {
    if (!kbProxy) return;
    const rawType = info && info.inputType ? String(info.inputType).toLowerCase() : 'text';
    const ac = info && info.autocomplete ? String(info.autocomplete).toLowerCase() : '';
    const rawMode = info && info.inputMode ? String(info.inputMode).toLowerCase() : '';
    const isOtp = ac.includes('one-time-code');

    if (rawType === 'password') {
      kbProxy.type = 'password';
      kbProxy.inputMode = '';
    } else if (rawType === 'email') {
      kbProxy.type = 'email';
      kbProxy.inputMode = 'email';
    } else if (rawType === 'tel') {
      kbProxy.type = 'tel';
      kbProxy.inputMode = 'tel';
    } else if (rawType === 'url') {
      kbProxy.type = 'url';
      kbProxy.inputMode = 'url';
    } else if (rawType === 'search') {
      kbProxy.type = 'search';
      kbProxy.inputMode = 'search';
    } else if (rawType === 'number' || isOtp) {
      kbProxy.type = 'text';
      kbProxy.inputMode = rawMode || 'numeric';
    } else {
      kbProxy.type = 'text';
      kbProxy.inputMode = ['numeric', 'decimal', 'tel', 'email', 'url', 'search'].includes(rawMode) ? rawMode : '';
    }

    if (kbTag) {
      if (rawType === 'password') kbTag.textContent = '🔐 รหัสผ่าน';
      else if (isOtp) kbTag.textContent = '🔢 รหัส OTP';
      else if (rawType === 'email') kbTag.textContent = '📧 อีเมล';
      else if (rawType === 'number' || rawType === 'tel') kbTag.textContent = '🔢 ตัวเลข';
      else if (rawType === 'search') kbTag.textContent = '🔍 ค้นหา';
      else if (info && info.isEditable) kbTag.textContent = '⌨️ ช่องพิมพ์';
      else kbTag.textContent = '⌨️ แป้นพิมพ์';
    }

    const fieldLabel = info && info.label ? info.label : '';
    if (rawType === 'password') {
      kbProxy.placeholder = 'แตะพิมพ์รหัสผ่านที่นี่...';
    } else if (fieldLabel) {
      kbProxy.placeholder = `พิมพ์ (${fieldLabel})...`;
    } else {
      kbProxy.placeholder = 'แตะพิมพ์ข้อความ (รองรับภาษาไทย / IME) เพื่อส่งเข้าหน้าเว็บ...';
    }
  }

  function updateKbBarUI() {
    if (!kbBar) return;
    const isAuthPause = paused && /password|otp|login/i.test(String(pauseReason || ''));
    if (isAuthPause && (!kbFieldInfo || !kbFieldInfo.isEditable)) {
      applyKbInputAttributes({
        isEditable: true,
        inputType: /otp/i.test(String(pauseReason || '')) ? 'text' : 'password',
        autocomplete: /otp/i.test(String(pauseReason || '')) ? 'one-time-code' : ''
      });
    }
    const autoShow = isTouchOrMobileView() && !kbDismissedByUser && (
      (kbFieldInfo && kbFieldInfo.isEditable) || isAuthPause
    );
    const shouldShow = Boolean(kbManualOpen || autoShow);
    kbBar.classList.toggle('is-visible', shouldShow);
    if (kbBtn) {
      kbBtn.classList.toggle('is-active', shouldShow || (kbProxy && document.activeElement === kbProxy));
    }
  }

  function flushKbProxy() {
    if (!kbProxy) return;
    const val = kbProxy.value;
    if (!val) return;
    kbProxy.value = '';
    if (wsConnected) {
      send({ type: 'input', kind: 'text', text: val });
    }
  }

  function sendKbKey(key) {
    if (!wsConnected || !key) return;
    send({ type: 'input', kind: 'key', action: 'press', key });
  }

  function openMobileKeyboard() {
    if (!kbBar || !kbProxy) return;
    kbManualOpen = true;
    kbDismissedByUser = false;
    if (!kbFieldInfo || !kbFieldInfo.isEditable) {
      applyKbInputAttributes(kbFieldInfo);
    }
    updateKbBarUI();
    void kbBar.offsetHeight;
    kbProxy.focus({ preventScroll: true });
    updateKbBarUI();
  }

  function closeMobileKeyboard() {
    kbComposing = false;
    flushKbProxy();
    kbManualOpen = false;
    kbDismissedByUser = true;
    if (kbProxy && document.activeElement === kbProxy) {
      kbProxy.blur();
    }
    updateKbBarUI();
  }

  // ── WebSocket Transport & Keepalive ───────────────────────────────────────
  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function stopPingTimer() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function startPingTimer() {
    stopPingTimer();
    pingTimer = setInterval(() => {
      if (wsConnected) {
        send({ type: 'ping', ts: Date.now() });
      }
    }, PING_INTERVAL_MS);
  }

  function closeSocketOnly() {
    connectSeq++;
    clearReconnectTimer();
    stopPingTimer();
    wsConnecting = false;
    wsConnected = false;
    if (ws) {
      const old = ws;
      ws = null;
      old.onopen = old.onmessage = old.onerror = old.onclose = null;
      try { old.close(1000, 'client-close'); } catch (_) {}
    }
    updateStatusUI();
  }

  function send(msg) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !msg || typeof msg !== 'object') {
      return false;
    }
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch (_) {
      return false;
    }
  }

  // ── Stage Resize Sync (Debounced 400ms, clamped 800..1920 x 500..1200) ────
  function computeClampedStageSize() {
    const targetEl = stageWrap || stageEl;
    if (!targetEl) return null;
    const rect = targetEl.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 100) return null;
    const width = Math.max(VIEWPORT_MIN_W, Math.min(VIEWPORT_MAX_W, Math.round(rect.width)));
    const height = Math.max(VIEWPORT_MIN_H, Math.min(VIEWPORT_MAX_H, Math.round(rect.height)));
    return { width, height };
  }

  function sendStageResizeIfNeeded(force) {
    if (!wsConnected) return;
    const size = computeClampedStageSize();
    if (!size) return;
    const diffW = Math.abs(size.width - (lastSentResize.width || viewport.width));
    const diffH = Math.abs(size.height - (lastSentResize.height || viewport.height));
    if (!force && diffW < 8 && diffH < 8) return;
    lastSentResize = { width: size.width, height: size.height };
    send({ type: 'resize', width: size.width, height: size.height });
  }

  function scheduleStageResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      sendStageResizeIfNeeded(false);
    }, RESIZE_DEBOUNCE_MS);
  }

  if (typeof ResizeObserver === 'function' && (stageWrap || stageEl)) {
    const ro = new ResizeObserver(() => {
      scheduleStageResize();
    });
    ro.observe(stageWrap || stageEl);
  } else {
    window.addEventListener('resize', scheduleStageResize);
  }

  // ── Server Message Handler ─────────────────────────────────────────────────
  function handleServerMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    const t = msg.type;

    if (t === 'frame') {
      scheduleFrame(msg);
    } else if (t === 'hello') {
      if (msg.viewport && msg.viewport.width && msg.viewport.height) {
        viewport = { width: Number(msg.viewport.width), height: Number(msg.viewport.height) };
        updateViewportBadge();
      }
      if (typeof msg.url === 'string') updateUrlUI(msg.url);
      if (Array.isArray(msg.tabs)) updateTabsUI(msg.tabs, msg.activeTab);
  function syncStandaloneBvAlert(isPaused, reason, urlStr) {
    if (!window.HomelabBVAlerts) return;
    const alertId = 'bv-web-' + CHAT_ID;
    if (isPaused) {
      const rLow = String(reason || '').toLowerCase();
      const kind = /otp/.test(rLow) ? 'otp' : /captcha|turnstile|human/.test(rLow) ? 'captcha' : /pay|card|checkout/.test(rLow) ? 'payment' : /login|password|auth/.test(rLow) ? 'login' : 'paused';
      const label = reason ? (SENSITIVE_LABELS.get(rLow) || String(reason)) : '⏸️ เบราว์เซอร์รอคุณดำเนินการ';
      window.HomelabBVAlerts.raise({
        id: alertId,
        kind,
        title: label,
        detail: 'Lab Browser (' + CHAT_ID + ') รอการดำเนินการของคุณ',
        sourceType: 'browser',
        sessionName: CHAT_ID,
        url: urlStr || (urlInput && urlInput.value ? urlInput.value.trim() : ''),
        browserVisionUrl: location.pathname + location.search
      });
    } else {
      window.HomelabBVAlerts.resolve(alertId);
    }
  }

      if (typeof msg.paused === 'boolean') {
        paused = msg.paused;
        pauseReason = msg.pauseReason || msg.reason || '';
        syncStandaloneBvAlert(paused, pauseReason, msg.url);
      }
      updateStatusUI();
      scheduleStageResize();
    } else if (t === 'page' || t === 'tabs') {
      if (Array.isArray(msg.tabs)) updateTabsUI(msg.tabs, msg.activeTab);
      if (typeof msg.url === 'string') updateUrlUI(msg.url);
      if (msg.viewport && msg.viewport.width && msg.viewport.height) {
        viewport = { width: Number(msg.viewport.width), height: Number(msg.viewport.height) };
        updateViewportBadge();
      }
    } else if (t === 'url' || t === 'nav' || t === 'navigate') {
      if (typeof msg.url === 'string') updateUrlUI(msg.url);
      if (Array.isArray(msg.tabs)) updateTabsUI(msg.tabs, msg.activeTab);
    } else if (t === 'pause-state' || t === 'paused') {
      paused = Boolean(msg.paused !== undefined ? msg.paused : true);
      pauseReason = paused ? String(msg.reason || msg.pauseReason || (msg.handoff && msg.handoff.kind) || '') : '';
      if (paused && /password|otp|login/i.test(pauseReason)) {
        kbDismissedByUser = false;
      }
      syncStandaloneBvAlert(paused, pauseReason, msg.url);
      updateStatusUI();
    } else if (t === 'focus-state') {
      kbFieldInfo = msg.isEditable ? msg : null;
      if (msg.isEditable) {
        kbDismissedByUser = false;
        applyKbInputAttributes(msg);
      } else if (!kbManualOpen) {
        applyKbInputAttributes(null);
      }
      updateKbBarUI();
    } else if (t === 'status') {
      if (typeof msg.paused === 'boolean') {
        paused = msg.paused;
        pauseReason = paused ? String(msg.pauseReason || msg.reason || '') : '';
        syncStandaloneBvAlert(paused, pauseReason, msg.url);
      }
      if (typeof msg.url === 'string') updateUrlUI(msg.url);
      if (Array.isArray(msg.tabs)) updateTabsUI(msg.tabs, msg.activeTab);
      if (msg.viewport && msg.viewport.width && msg.viewport.height) {
        viewport = { width: Number(msg.viewport.width), height: Number(msg.viewport.height) };
        updateViewportBadge();
      }
      updateStatusUI();
    } else if (t === 'error') {
      const friendly = formatBrowserError(msg.error);
      showToast('⚠️ ' + friendly, 'error');
      if (!frameImg.classList.contains('has-frame')) {
        setPlaceholder(true, 'เกิดข้อผิดพลาดในการเชื่อมต่อ', friendly, true, '⚠️');
      }
    }
  }

  // ── Boot & Reconnect Flow ──────────────────────────────────────────────────
  function scheduleReconnect() {
    if (userClosed) return;
    clearReconnectTimer();
    const delay = BACKOFF_MS[Math.min(reconnectAttempt, BACKOFF_MS.length - 1)];
    reconnectAttempt++;
    if (!frameImg.classList.contains('has-frame')) {
      setPlaceholder(
        true,
        'กำลังเชื่อมต่อใหม่...',
        `จะลองเชื่อมต่ออีกครั้งใน ${Math.round(delay / 1000)} วินาที`,
        true,
        '🔌'
      );
    }
    reconnectTimer = setTimeout(() => {
      if (!userClosed) {
        bootBrowser();
      }
    }, delay);
  }

  async function checkSessionAlive() {
    const res = await fetch('/api/browser-vision/session?chat=' + encodeURIComponent(CHAT_ID), {
      cache: 'no-store'
    });
    if (res.status === 401) {
      redirectToLogin();
      return { redirected: true };
    }
    const data = await res.json().catch(() => ({}));
    return {
      redirected: false,
      alive: Boolean(res.ok && data && data.ok && data.alive),
      status: data && data.status ? data.status : null
    };
  }

  async function bootBrowser() {
    if (userClosed) return;
    closeSocketOnly();
    const mySeq = ++connectSeq;
    wsConnecting = true;
    updateStatusUI();

    if (!frameImg.classList.contains('has-frame')) {
      setPlaceholder(
        true,
        'กำลังเปิด Lab Browser...',
        'กำลังเตรียมเซสชัน Chromium และเชื่อมต่อสตรีมภาพสด (แชร์ Login ร่วมกับ Browser Vision)',
        false,
        '🌐'
      );
    }

    // 1. Check whether session is already alive
    let sessionAlive = false;
    try {
      const check = await checkSessionAlive();
      if (check.redirected || mySeq !== connectSeq || userClosed) return;
      sessionAlive = check.alive;
      if (check.status && typeof check.status.url === 'string') {
        updateUrlUI(check.status.url);
      }
    } catch (_) {
      sessionAlive = false;
    }

    if (mySeq !== connectSeq || userClosed) return;

    // 2. Start / ensure browser daemon via REST
    const startPayload = {
      chat: CHAT_ID,
      idleTtlSec: IDLE_TTL_SEC
    };
    if (!sessionAlive) {
      startPayload.url = rawInitialUrl ? normalizeUserUrl(rawInitialUrl) : DEFAULT_START_URL;
    }

    try {
      const startRes = await fetch('/api/browser-vision/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(startPayload)
      });
      if (startRes.status === 401) {
        redirectToLogin();
        return;
      }
      if (mySeq !== connectSeq || userClosed) return;
      const startData = await startRes.json().catch(() => ({}));
      if (!startRes.ok || !startData.ok) {
        wsConnecting = false;
        updateStatusUI();
        const errMsg = formatBrowserError(startData.error, startRes.status);
        showToast('⚠️ เปิดเบราว์เซอร์ไม่สำเร็จ: ' + errMsg, 'error');
        setPlaceholder(true, 'เปิดเบราว์เซอร์ไม่สำเร็จ', errMsg, true, '⚠️');
        scheduleReconnect();
        return;
      }
      if (startData.status) {
        if (typeof startData.status.url === 'string') updateUrlUI(startData.status.url);
        if (Array.isArray(startData.status.tabs)) updateTabsUI(startData.status.tabs, startData.status.activeTab);
        if (typeof startData.status.paused === 'boolean') {
          paused = startData.status.paused;
          pauseReason = startData.status.pauseReason || '';
        }
      }
    } catch (err) {
      if (mySeq !== connectSeq || userClosed) return;
      wsConnecting = false;
      updateStatusUI();
      const errMsg = formatBrowserError(err && err.message ? err.message : 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ');
      showToast('⚠️ ' + errMsg, 'error');
      setPlaceholder(true, 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', errMsg, true, '⚠️');
      scheduleReconnect();
      return;
    }

    if (mySeq !== connectSeq || userClosed) return;

    // 3. Connect WebSocket stream
    const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${wsProto}://${window.location.host}/ws/browser-vision?chat=${encodeURIComponent(CHAT_ID)}`;
    let sock;
    try {
      sock = new WebSocket(wsUrl);
    } catch (err) {
      wsConnecting = false;
      updateStatusUI();
      showToast('⚠️ เปิด WebSocket ไม่สำเร็จ', 'error');
      scheduleReconnect();
      return;
    }
    ws = sock;

    sock.onopen = () => {
      if (mySeq !== connectSeq || ws !== sock) {
        try { sock.close(); } catch (_) {}
        return;
      }
      wsConnecting = false;
      wsConnected = true;
      reconnectAttempt = 0;
      clearReconnectTimer();
      startPingTimer();
      updateStatusUI();
      send({ type: 'status' });
      scheduleStageResize();
    };

    sock.onmessage = (ev) => {
      if (mySeq !== connectSeq || ws !== sock) return;
      if (typeof ev.data !== 'string') return;
      try {
        const msg = JSON.parse(ev.data);
        handleServerMessage(msg);
      } catch (_) {}
    };

    sock.onerror = () => {
      // onclose handles reconnect
    };

    sock.onclose = () => {
      if (mySeq !== connectSeq) return;
      ws = null;
      stopPingTimer();
      wsConnecting = false;
      wsConnected = false;
      updateStatusUI();
      if (!userClosed) {
        scheduleReconnect();
      }
    };
  }

  // ── Shared Login Popover Actions ──────────────────────────────────────────
  function closeAuthPopover() {
    if (authPopover) authPopover.classList.remove('is-open');
  }

  async function loadSharedAuthStatus() {
    if (!authMeta || !authDomainsEl) return;
    authMeta.textContent = 'กำลังโหลดสถานะ Shared Login...';
    authDomainsEl.innerHTML = '';
    try {
      const res = await fetch('/api/browser-vision/auth/status', { cache: 'no-store' });
      if (res.status === 401) {
        redirectToLogin();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        authMeta.textContent = '❌ โหลดไม่สำเร็จ: ' + (data.error || res.status);
        return;
      }
      const domains = Array.isArray(data.domains) ? data.domains : [];
      const cookies = Number(data.cookieCount) || 0;
      authMeta.textContent = `โดเมนที่ล็อกอินไว้: ${domains.length} · คุกกี้: ${cookies} รายการ`;

      if (domains.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'lb-auth-empty';
        empty.textContent = 'ยังไม่มีเซสชันล็อกอินที่บันทึกไว้';
        authDomainsEl.appendChild(empty);
      } else {
        domains.forEach((d) => {
          const item = document.createElement('div');
          item.className = 'lb-auth-domain';
          item.textContent = '🌐 ' + d;
          authDomainsEl.appendChild(item);
        });
      }
    } catch (err) {
      authMeta.textContent = '❌ เกิดข้อผิดพลาด: ' + (err && err.message ? err.message : String(err));
    }
  }

  async function clearSharedAuth() {
    const ok = window.confirm(
      'ยืนยันล้าง Shared Login (คุกกี้และเซสชันที่แชร์ร่วมกับ Browser Vision ทุกห้องแชท) ทั้งหมดหรือไม่?'
    );
    if (!ok) return;
    try {
      const res = await fetch('/api/browser-vision/auth/clear', { method: 'POST' });
      if (res.status === 401) {
        redirectToLogin();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        showToast('🗑️ ล้าง Shared Login ทั้งหมดเรียบร้อยแล้ว', 'success');
        await loadSharedAuthStatus();
      } else {
        showToast('❌ ล้าง Shared Login ไม่สำเร็จ: ' + (data.error || res.status), 'error');
      }
    } catch (err) {
      showToast('❌ เกิดข้อผิดพลาด: ' + (err && err.message ? err.message : String(err)), 'error');
    }
  }

  // ── Resume & Close Browser Actions ────────────────────────────────────────
  async function requestResume() {
    const cleanNote = resumeNoteInput ? String(resumeNoteInput.value || '').trim() : '';
    try {
      const res = await fetch('/api/browser-vision/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat: CHAT_ID, note: cleanNote })
      });
      if (res.status === 401) {
        redirectToLogin();
        return;
      }
      if (!res.ok) {
        send({ type: 'resume', note: cleanNote });
      }
    } catch (_) {
      send({ type: 'resume', note: cleanNote });
    }
    paused = false;
    pauseReason = '';
    window.HomelabBVAlerts?.resolve('bv-web-' + CHAT_ID);
    if (resumeNoteInput) resumeNoteInput.value = '';
    updateStatusUI();
    showToast('▶️ ดำเนินการต่อแล้ว', 'success');
  }

  async function closeBrowserSession() {
    if (closingBrowser) return;
    closingBrowser = true;
    userClosed = true;
    window.HomelabBVAlerts?.resolve('bv-web-' + CHAT_ID);
    closeAuthPopover();
    closeSocketOnly();
    updateStatusUI();

    try {
      const res = await fetch('/api/browser-vision/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat: CHAT_ID })
      });
      if (res.status === 401) {
        redirectToLogin();
        return;
      }
    } catch (_) {}

    closingBrowser = false;
    resetFrameState();
    setPlaceholder(
      true,
      'ปิดเบราว์เซอร์เรียบร้อยแล้ว (คืน RAM แล้ว)',
      'คุกกี้และ Login ที่บันทึกไว้ยังเก็บอยู่ใน Shared Login — กดปุ่มด้านล่างเพื่อเปิดใช้งานใหม่ได้ตลอดเวลา',
      true,
      '🛑'
    );
    showToast('🛑 ปิดโปรเซสเบราว์เซอร์แล้ว (คืน RAM)', 'success');
  }

  function reconnectManual() {
    userClosed = false;
    reconnectAttempt = 0;
    lastSentResize = { width: 0, height: 0 };
    bootBrowser();
  }

  // ── Navigation Actions ─────────────────────────────────────────────────────
  function navigateToUrl(raw) {
    const url = normalizeUserUrl(raw);
    if (!url) return;
    if (!wsConnected) {
      showToast('ยังไม่ได้เชื่อมต่อเบราว์เซอร์ กรุณารอสักครู่หรือกดเชื่อมต่อใหม่', 'warn');
      return;
    }
    send({ type: 'navigate', url });
    if (urlInput) urlInput.blur();
    if (stageEl) stageEl.focus({ preventScroll: true });
  }

  // ── Fullscreen Toggle ──────────────────────────────────────────────────────
  function updateFullscreenButton() {
    if (!fullscreenBtn) return;
    const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    fullscreenBtn.classList.toggle('is-active', isFs);
    fullscreenBtn.title = isFs ? 'ออกจากโหมดเต็มจอ' : 'โหมดเต็มจอ (Fullscreen)';
  }

  function toggleFullscreen() {
    const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    if (isFs) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) Promise.resolve(exit.call(document)).catch(() => {});
    } else {
      const el = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) {
        Promise.resolve(req.call(el)).catch(() => {
          showToast('เบราว์เซอร์นี้ไม่รองรับโหมดเต็มจออัตโนมัติ', 'warn');
        });
      }
    }
  }

  document.addEventListener('fullscreenchange', updateFullscreenButton);
  document.addEventListener('webkitfullscreenchange', updateFullscreenButton);

  // ── Stage Input Forwarding (Mouse, Wheel, Touch, Keyboard, Paste) ──────────
  function flushPendingMouseMove() {
    mouseMoveRafScheduled = false;
    const pt = pendingMouseMove;
    pendingMouseMove = null;
    if (!pt || !wsConnected) return;
    send({
      type: 'input',
      kind: 'mouse',
      action: 'mouseMoved',
      x: pt.x,
      y: pt.y,
      modifiers: pt.modifiers
    });
  }

  stageEl.addEventListener('mousemove', (e) => {
    if (!wsConnected) return;
    const pt = mapPoint(e.clientX, e.clientY);
    if (!pt.inside) return;
    pendingMouseMove = { x: pt.x, y: pt.y, modifiers: getModifiersMask(e) };
    if (!mouseMoveRafScheduled) {
      mouseMoveRafScheduled = true;
      requestAnimationFrame(flushPendingMouseMove);
    }
  });

  stageEl.addEventListener('mousedown', (e) => {
    closeAuthPopover();
    if (kbProxy && document.activeElement === kbProxy) {
      kbComposing = false;
      flushKbProxy();
    }
    stageEl.focus({ preventScroll: true });
    if (!wsConnected) return;
    const pt = mapPoint(e.clientX, e.clientY);
    if (!pt.inside) return;
    e.preventDefault();
    const button = getButtonName(e.button);
    activeMouseButton = button;
    send({
      type: 'input',
      kind: 'mouse',
      action: 'mousePressed',
      x: pt.x,
      y: pt.y,
      button,
      clickCount: Math.max(1, e.detail || 1),
      modifiers: getModifiersMask(e)
    });
  });

  window.addEventListener('mouseup', (e) => {
    if (!wsConnected || !activeMouseButton) return;
    const button = getButtonName(e.button);
    activeMouseButton = null;
    const pt = mapPoint(e.clientX, e.clientY);
    send({
      type: 'input',
      kind: 'mouse',
      action: 'mouseReleased',
      x: pt.x,
      y: pt.y,
      button,
      clickCount: Math.max(1, e.detail || 1),
      modifiers: getModifiersMask(e)
    });
  });

  stageEl.addEventListener('dblclick', (e) => {
    e.preventDefault();
  });

  stageEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  stageEl.addEventListener('wheel', (e) => {
    if (!wsConnected) return;
    const pt = mapPoint(e.clientX, e.clientY);
    if (!pt.inside) return;
    e.preventDefault();
    send({
      type: 'input',
      kind: 'wheel',
      x: pt.x,
      y: pt.y,
      deltaX: Math.round(e.deltaX),
      deltaY: Math.round(e.deltaY)
    });
  }, { passive: false });

  // Touch forwarding: tap -> click, drag -> wheel scroll
  let touchState = null;
  stageEl.addEventListener('touchstart', (e) => {
    closeAuthPopover();
    if (!wsConnected) return;
    if (e.touches.length !== 1) {
      touchState = null;
      return;
    }
    const t = e.touches[0];
    touchState = {
      startX: t.clientX,
      startY: t.clientY,
      lastX: t.clientX,
      lastY: t.clientY,
      moved: false
    };
  }, { passive: true });

  stageEl.addEventListener('touchmove', (e) => {
    if (!wsConnected || !touchState || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dist = Math.hypot(t.clientX - touchState.startX, t.clientY - touchState.startY);
    if (!touchState.moved && dist > 8) {
      touchState.moved = true;
    }
    if (!touchState.moved) return;
    const dx = t.clientX - touchState.lastX;
    const dy = t.clientY - touchState.lastY;
    touchState.lastX = t.clientX;
    touchState.lastY = t.clientY;
    const pt = mapPoint(t.clientX, t.clientY);
    if (!pt.inside) return;
    e.preventDefault();
    send({
      type: 'input',
      kind: 'wheel',
      x: pt.x,
      y: pt.y,
      deltaX: Math.round(-dx * 1.4),
      deltaY: Math.round(-dy * 1.4)
    });
  }, { passive: false });

  stageEl.addEventListener('touchend', (e) => {
    const st = touchState;
    touchState = null;
    if (!st || st.moved || !wsConnected) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const pt = mapPoint(t.clientX, t.clientY);
    if (!pt.inside) return;
    e.preventDefault();
    const keepKbFocused = Boolean(kbProxy && (kbManualOpen || document.activeElement === kbProxy));
    if (keepKbFocused) {
      kbComposing = false;
      flushKbProxy();
    }
    send({ type: 'input', kind: 'mouse', action: 'mouseMoved', x: pt.x, y: pt.y });
    send({ type: 'input', kind: 'mouse', action: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    send({ type: 'input', kind: 'mouse', action: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    if (keepKbFocused && kbProxy) {
      kbProxy.focus({ preventScroll: true });
    }
  }, { passive: false });

  stageEl.addEventListener('touchcancel', () => {
    touchState = null;
  }, { passive: true });

  // Keyboard & Paste on Stage
  stageEl.addEventListener('keydown', (e) => {
    if (!wsConnected) return;
    if (document.activeElement !== stageEl) return;
    if (e.isComposing || e.key === 'Process' || e.key === 'Dead') return;

    const key = String(e.key || '');
    const keyLower = key.toLowerCase();

    // Allow Ctrl+V / Cmd+V to trigger native paste event so local clipboard text is sent
    if ((e.ctrlKey || e.metaKey) && keyLower === 'v') {
      return;
    }

    // Ignore bare modifier keys
    if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const modifiers = getModifiersMask(e);

    // Ctrl/Meta + A / C / X / Z / Y shortcuts (mapped to Control+ for Linux Chromium)
    if ((e.ctrlKey || e.metaKey) && SHORTCUT_KEYS.has(keyLower)) {
      const chord = (e.shiftKey ? 'Control+Shift+' : 'Control+') + keyLower;
      send({
        type: 'input',
        kind: 'key',
        action: 'press',
        key: chord,
        code: e.code,
        modifiers
      });
      return;
    }

    // Special navigation / editing keys (with optional modifiers)
    if (SPECIAL_KEYS.has(key)) {
      const parts = [];
      if (e.ctrlKey || e.metaKey) parts.push('Control');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      parts.push(key);
      send({
        type: 'input',
        kind: 'key',
        action: 'press',
        key: parts.join('+'),
        code: e.code,
        modifiers
      });
      return;
    }

    // Printable character without Ctrl/Meta/Alt -> kind:'text' (supports Thai & Unicode cleanly)
    if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      send({ type: 'input', kind: 'text', text: key });
      return;
    }

    // Fallback for any other modified key chord
    const fallbackParts = [];
    if (e.ctrlKey || e.metaKey) fallbackParts.push('Control');
    if (e.altKey) fallbackParts.push('Alt');
    if (e.shiftKey && key.length > 1) fallbackParts.push('Shift');
    fallbackParts.push(key);
    send({
      type: 'input',
      kind: 'key',
      action: 'press',
      key: fallbackParts.join('+'),
      code: e.code,
      modifiers
    });
  });

  stageEl.addEventListener('paste', (e) => {
    if (!wsConnected) return;
    if (document.activeElement !== stageEl) return;
    const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    send({ type: 'input', kind: 'text', text });
  });

  // ── Toolbar & Control Event Bindings ───────────────────────────────────────
  if (btnBack) btnBack.addEventListener('click', () => send({ type: 'back' }));
  if (btnForward) btnForward.addEventListener('click', () => send({ type: 'forward' }));
  if (btnReload) btnReload.addEventListener('click', () => send({ type: 'reload' }));

  if (urlInput) {
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        navigateToUrl(urlInput.value);
      } else if (e.key === 'Escape') {
        urlInput.blur();
        if (stageEl) stageEl.focus({ preventScroll: true });
      }
    });
    urlInput.addEventListener('focus', () => {
      try { urlInput.select(); } catch (_) {}
    });
  }

  if (tabSelect) {
    tabSelect.addEventListener('change', () => {
      const idx = parseInt(tabSelect.value, 10);
      if (!isNaN(idx)) {
        activeTabIndex = idx;
        send({ type: 'tab', index: idx });
      }
    });
  }

  if (btnNewTab) {
    btnNewTab.addEventListener('click', () => {
      send({ type: 'new-tab', url: DEFAULT_START_URL });
    });
  }

  if (btnCloseTab) {
    btnCloseTab.addEventListener('click', () => {
      const idx = tabSelect ? parseInt(tabSelect.value, 10) : activeTabIndex;
      const payload = { type: 'close-tab' };
      if (!isNaN(idx)) payload.index = idx;
      send(payload);
      if (tabsCount <= 1) {
        showToast('ล้างแท็บสุดท้ายกลับไปหน้าว่างแล้ว', 'warn');
      }
    });
  }

  if (authBtn && authPopover) {
    authBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !authPopover.classList.contains('is-open');
      if (willOpen) {
        authPopover.classList.add('is-open');
        loadSharedAuthStatus();
      } else {
        authPopover.classList.remove('is-open');
      }
    });
    authPopover.addEventListener('click', (e) => e.stopPropagation());
  }
  if (authRefreshBtn) authRefreshBtn.addEventListener('click', loadSharedAuthStatus);
  if (authClearBtn) authClearBtn.addEventListener('click', clearSharedAuth);

  document.addEventListener('click', (e) => {
    if (authPopover && authPopover.classList.contains('is-open')) {
      if (!authPopover.contains(e.target) && e.target !== authBtn) {
        closeAuthPopover();
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && authPopover && authPopover.classList.contains('is-open')) {
      closeAuthPopover();
    }
  });

  if (kbBtn) {
    kbBtn.addEventListener('click', () => {
      if (kbBar && kbBar.classList.contains('is-visible') && kbProxy && document.activeElement === kbProxy) {
        closeMobileKeyboard();
      } else {
        openMobileKeyboard();
      }
    });
  }

  if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleFullscreen);
  if (reconnectBtn) reconnectBtn.addEventListener('click', reconnectManual);
  if (closeBrowserBtn) closeBrowserBtn.addEventListener('click', closeBrowserSession);
  if (placeholderRetry) placeholderRetry.addEventListener('click', reconnectManual);

  if (resumeBtn) resumeBtn.addEventListener('click', requestResume);
  if (resumeNoteInput) {
    resumeNoteInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        requestResume();
      }
    });
  }

  // ── IME / Mobile Keyboard Proxy Bindings ───────────────────────────────────
  if (kbProxy) {
    kbProxy.addEventListener('compositionstart', () => {
      kbComposing = true;
    });
    kbProxy.addEventListener('compositionend', () => {
      kbComposing = false;
      flushKbProxy();
    });
    kbProxy.addEventListener('input', (e) => {
      if (kbComposing || (e && e.isComposing)) return;
      flushKbProxy();
    });
    kbProxy.addEventListener('beforeinput', (e) => {
      if (e && e.inputType === 'deleteContentBackward' && kbProxy.value.length === 0) {
        const now = Date.now();
        if (now - lastKbBackspaceAt < 30) return;
        lastKbBackspaceAt = now;
        e.preventDefault();
        sendKbKey('Backspace');
      }
    });
    kbProxy.addEventListener('keydown', (e) => {
      if (!wsConnected) return;
      if (e.key === 'Backspace') {
        if (kbProxy.value.length === 0) {
          lastKbBackspaceAt = Date.now();
          e.preventDefault();
          sendKbKey('Backspace');
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        kbComposing = false;
        flushKbProxy();
        sendKbKey('Enter');
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        kbComposing = false;
        flushKbProxy();
        sendKbKey('Tab');
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMobileKeyboard();
      }
    });
    kbProxy.addEventListener('paste', (e) => {
      if (!wsConnected) return;
      const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
      if (!text) return;
      e.preventDefault();
      kbComposing = false;
      flushKbProxy();
      send({ type: 'input', kind: 'text', text });
    });
    kbProxy.addEventListener('focus', () => {
      kbManualOpen = true;
      updateKbBarUI();
    });
    kbProxy.addEventListener('blur', () => {
      kbComposing = false;
      flushKbProxy();
      updateKbBarUI();
    });
  }

  if (kbTabBtn) {
    kbTabBtn.addEventListener('click', () => {
      kbComposing = false;
      flushKbProxy();
      sendKbKey('Tab');
      if (kbProxy) kbProxy.focus({ preventScroll: true });
    });
  }
  if (kbEnterBtn) {
    kbEnterBtn.addEventListener('click', () => {
      kbComposing = false;
      flushKbProxy();
      sendKbKey('Enter');
    });
  }
  if (kbBackspaceBtn) {
    kbBackspaceBtn.addEventListener('click', () => {
      if (kbProxy && kbProxy.value.length > 0) {
        kbProxy.value = kbProxy.value.slice(0, -1);
      } else {
        sendKbKey('Backspace');
      }
      if (kbProxy) kbProxy.focus({ preventScroll: true });
    });
  }
  if (kbCloseBtn) {
    kbCloseBtn.addEventListener('click', closeMobileKeyboard);
  }

  // Cleanly close WS on unload (keep browser daemon alive until idleTtlSec or explicit close)
  window.addEventListener('beforeunload', () => {
    stopPingTimer();
    clearReconnectTimer();
    if (ws) {
      try { ws.close(1000, 'page-unload'); } catch (_) {}
    }
  });

  // ── Start Boot Sequence ────────────────────────────────────────────────────
  updateViewportBadge();
  updateStatusUI();
  bootBrowser();
})();
