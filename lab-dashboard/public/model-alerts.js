(() => {
  'use strict';

  // index.html ฝัง gemini.html ไว้ใน iframe และทั้งสองหน้าโหลดสคริปต์นี้ → ให้เฉพาะหน้า top-level สร้าง UI
  // ไม่งั้นปุ่ม "โมเดล" จะซ้ำสองชุด (guard ด้านล่างแยกตาม window จึงกันไม่ได้)
  try { if (window.top !== window.self) return; } catch (_) { return; }
  if (window.__mraInitialized) return;
  window.__mraInitialized = true;

  const POLL_MS = 60000;
  const SHOWN_KEY = 'mra_shown_alerts';
  const STYLE_ID = 'mra-styles';

  const STATUS_META = {
    active: { label: 'ใช้งานอยู่', cls: 'mra-st-active' },
    pending: { label: 'รออนุมัติ', cls: 'mra-st-pending' },
    disabled: { label: 'ปิดใช้งาน', cls: 'mra-st-disabled' },
    missing: { label: 'ไม่พบ', cls: 'mra-st-missing' },
    rejected: { label: 'ปฏิเสธแล้ว', cls: 'mra-st-rejected' }
  };

  let registryState = null;
  let modalOpen = false;
  let scanning = false;
  let researching = false;
  let sortBy = 'cost';
  let audioUnlocked = false;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .mra-fab {
        position: fixed;
        right: 20px;
        bottom: calc(132px + env(safe-area-inset-bottom, 0px)); /* พ้นแถบพิมพ์/ปุ่มส่งของหน้าแชท */
        z-index: 9990;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.28);
        background: rgba(15, 23, 42, 0.88);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        color: #f1f5f9;
        font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.42);
        transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
      }
      .mra-fab:hover {
        transform: translateY(-2px);
        border-color: rgba(56, 189, 248, 0.55);
        background: rgba(15, 23, 42, 0.96);
      }
      @media (max-width: 768px) {
        /* มือถือ: เหลือแค่ไอคอนวงกลมเล็ก ลอยเหนือแถบพิมพ์ ไม่ทับปุ่มส่ง/ช่องพิมพ์ */
        .mra-fab {
          right: 8px;
          bottom: calc(172px + env(safe-area-inset-bottom, 0px));
          width: 38px;
          height: 38px;
          padding: 0;
          justify-content: center;
          font-size: 17px;
          opacity: 0.88;
        }
        .mra-fab .mra-fab-label { display: none; }
        .mra-fab .mra-badge {
          position: absolute;
          top: -5px;
          right: -5px;
          min-width: 17px;
          height: 17px;
          font-size: 10px;
          padding: 0 4px;
        }
        .mra-fab .mra-badge[data-count="0"] { display: none; }
      }
      .mra-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        height: 20px;
        padding: 0 6px;
        border-radius: 999px;
        background: #f59e0b;
        color: #0f172a;
        font-size: 11px;
        font-weight: 700;
      }
      .mra-badge[data-count="0"] {
        display: none;
      }
      .mra-toast-stack {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 9995;
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: 360px;
        max-width: 92vw;
        pointer-events: none;
      }
      .mra-toast {
        pointer-events: auto;
        background: rgba(13, 19, 33, 0.92);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        border: 1px solid rgba(148, 163, 184, 0.24);
        border-left: 3px solid #38bdf8;
        border-radius: 12px;
        padding: 13px 14px;
        color: #e2e8f0;
        font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
        box-shadow: 0 14px 36px rgba(0, 0, 0, 0.48);
        animation: mra-slide-in 0.2s ease-out;
      }
      .mra-toast[data-kind="new_pending"] {
        border-left-color: #f59e0b;
      }
      .mra-toast[data-kind="missing"],
      .mra-toast[data-kind="scan_failed"] {
        border-left-color: #ef4444;
      }
      .mra-toast[data-kind="new_auto"],
      .mra-toast[data-kind="returned"] {
        border-left-color: #22c55e;
      }
      @keyframes mra-slide-in {
        from { opacity: 0; transform: translateX(18px); }
        to { opacity: 1; transform: translateX(0); }
      }
      .mra-toast-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 6px;
      }
      .mra-toast-title {
        font-size: 13.5px;
        font-weight: 700;
        color: #f8fafc;
        line-height: 1.35;
      }
      .mra-conf {
        flex-shrink: 0;
        font-size: 11px;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 999px;
        background: rgba(56, 189, 248, 0.16);
        color: #7dd3fc;
        border: 1px solid rgba(56, 189, 248, 0.3);
      }
      .mra-toast-model {
        font-size: 12px;
        color: #94a3b8;
        margin-bottom: 4px;
        word-break: break-all;
      }
      .mra-toast-detail {
        font-size: 12.5px;
        color: #cbd5e1;
        line-height: 1.45;
        margin-bottom: 10px;
      }
      .mra-toast-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .mra-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        padding: 6px 10px;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.25);
        background: rgba(30, 41, 59, 0.85);
        color: #e2e8f0;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease;
      }
      .mra-btn:hover:not(:disabled) {
        background: rgba(51, 65, 85, 0.95);
        border-color: rgba(148, 163, 184, 0.45);
      }
      .mra-btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .mra-btn-approve {
        background: rgba(22, 163, 74, 0.22);
        border-color: rgba(34, 197, 94, 0.45);
        color: #86efac;
      }
      .mra-btn-approve:hover:not(:disabled) {
        background: rgba(22, 163, 74, 0.36);
      }
      .mra-btn-reject {
        background: rgba(220, 38, 38, 0.2);
        border-color: rgba(239, 68, 68, 0.42);
        color: #fca5a5;
      }
      .mra-btn-reject:hover:not(:disabled) {
        background: rgba(220, 38, 38, 0.34);
      }
      .mra-btn-primary {
        background: rgba(14, 165, 233, 0.22);
        border-color: rgba(56, 189, 248, 0.48);
        color: #7dd3fc;
      }
      .mra-btn-primary:hover:not(:disabled) {
        background: rgba(14, 165, 233, 0.35);
      }
      .mra-backdrop {
        position: fixed;
        inset: 0;
        z-index: 9998;
        background: rgba(2, 6, 23, 0.72);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
      }
      .mra-modal {
        width: 1040px;
        max-width: 92vw;
        max-height: 86vh;
        display: flex;
        flex-direction: column;
        background: rgba(13, 19, 33, 0.96);
        border: 1px solid rgba(148, 163, 184, 0.24);
        border-radius: 16px;
        color: #e2e8f0;
        font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
        overflow: hidden;
      }
      .mra-modal-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 16px 20px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.16);
        background: rgba(15, 23, 42, 0.7);
      }
      .mra-modal-title {
        font-size: 16px;
        font-weight: 700;
        color: #f8fafc;
        margin: 0;
      }
      .mra-scan-meta {
        font-size: 12px;
        color: #94a3b8;
        margin-top: 3px;
      }
      .mra-modal-controls {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .mra-scan-banner {
        padding: 10px 20px;
        font-size: 12.5px;
        background: rgba(14, 165, 233, 0.12);
        border-bottom: 1px solid rgba(56, 189, 248, 0.22);
        color: #bae6fd;
      }
      .mra-table-wrap {
        overflow: auto;
        flex: 1;
      }
      .mra-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12.5px;
      }
      .mra-table th {
        position: sticky;
        top: 0;
        background: rgba(15, 23, 42, 0.96);
        color: #94a3b8;
        font-weight: 600;
        text-align: left;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.18);
        white-space: nowrap;
      }
      .mra-table td {
        padding: 10px 12px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.1);
        vertical-align: top;
      }
      .mra-table tr:hover td {
        background: rgba(30, 41, 59, 0.45);
      }
      .mra-st {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
      }
      .mra-st-active { background: rgba(34, 197, 94, 0.18); color: #86efac; }
      .mra-st-pending { background: rgba(245, 158, 11, 0.2); color: #fcd34d; }
      .mra-st-disabled { background: rgba(100, 116, 139, 0.25); color: #cbd5e1; }
      .mra-st-missing { background: rgba(239, 68, 68, 0.2); color: #fca5a5; }
      .mra-st-rejected { background: rgba(153, 27, 27, 0.28); color: #fecaca; }
      .mra-group-row td {
        padding: 8px 12px;
        background: rgba(56, 189, 248, 0.08);
        color: #7dd3fc;
        font-size: 12px;
        font-weight: 700;
      }
      .mra-sub {
        font-size: 11px;
        color: #94a3b8;
        margin-top: 2px;
      }
      .mra-row-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }
      .mra-spin {
        display: inline-block;
        width: 12px;
        height: 12px;
        border: 2px solid rgba(125, 211, 252, 0.3);
        border-top-color: #7dd3fc;
        border-radius: 50%;
        animation: mra-rot 0.7s linear infinite;
      }
      .mra-select {
        padding: 6px 8px;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.25);
        background: rgba(30, 41, 59, 0.9);
        color: #e2e8f0;
        font-size: 12px;
        font-weight: 600;
      }
      .mra-conf-pill {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        white-space: nowrap;
      }
      .mra-conf-high { background: rgba(34, 197, 94, 0.2); color: #86efac; border: 1px solid rgba(34, 197, 94, 0.35); }
      .mra-conf-mid { background: rgba(245, 158, 11, 0.2); color: #fcd34d; border: 1px solid rgba(245, 158, 11, 0.35); }
      .mra-conf-low { background: rgba(239, 68, 68, 0.2); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.35); }
      .mra-src-links {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 4px;
      }
      .mra-src-link {
        font-size: 10.5px;
        padding: 1px 6px;
        border-radius: 6px;
        background: rgba(56, 189, 248, 0.12);
        border: 1px solid rgba(56, 189, 248, 0.28);
        color: #7dd3fc;
        text-decoration: none;
      }
      .mra-src-link:hover {
        background: rgba(56, 189, 248, 0.24);
        text-decoration: underline;
      }
      @keyframes mra-rot {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  function getShownSet() {
    try {
      const raw = sessionStorage.getItem(SHOWN_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  }

  function markShown(id) {
    try {
      const set = getShownSet();
      set.add(id);
      sessionStorage.setItem(SHOWN_KEY, JSON.stringify([...set].slice(-100)));
    } catch {}
  }

  function playBeep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const now = ctx.currentTime;
      [660, 880].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.06, now + idx * 0.11);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.11 + 0.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.11);
        osc.stop(now + idx * 0.11 + 0.11);
      });
    } catch {}
  }

  function setupFirstClickNotificationPermission() {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    const handler = () => {
      document.removeEventListener('click', handler, true);
      audioUnlocked = true;
      try {
        Notification.requestPermission().catch(() => {});
      } catch {}
    };
    document.addEventListener('click', handler, { capture: true, once: true });
  }

  function fireBrowserNotification(alertItem) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      new Notification(alertItem.title || 'แจ้งเตือนโมเดล AI', {
        body: `${alertItem.modelId || ''} ${alertItem.detail || ''}`.trim()
      });
    } catch {}
  }

  async function apiJson(url, opts = {}) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  function formatTime(iso) {
    if (!iso) return '-';
    try {
      return new Date(iso).toLocaleString('th-TH', {
        dateStyle: 'short',
        timeStyle: 'short'
      });
    } catch {
      return String(iso);
    }
  }

  function ensureFab() {
    let fab = document.getElementById('mra-fab');
    if (fab) return fab;
    fab = document.createElement('button');
    fab.id = 'mra-fab';
    fab.type = 'button';
    fab.title = 'จัดการโมเดล AI';
    fab.setAttribute('aria-label', 'จัดการโมเดล AI');
    fab.className = 'mra-fab';
    fab.innerHTML = '<span aria-hidden="true">🧠</span><span class="mra-fab-label">โมเดล</span><span class="mra-badge" id="mra-fab-badge" data-count="0">0</span>';
    fab.addEventListener('click', () => openModal());
    document.body.appendChild(fab);
    return fab;
  }

  function updateFabBadge(count) {
    const badge = document.getElementById('mra-fab-badge');
    if (!badge) return;
    const n = Number(count) || 0;
    badge.dataset.count = String(n);
    badge.textContent = String(n);
  }

  function ensureToastStack() {
    let stack = document.getElementById('mra-toast-stack');
    if (stack) return stack;
    stack = document.createElement('div');
    stack.id = 'mra-toast-stack';
    stack.className = 'mra-toast-stack';
    document.body.appendChild(stack);
    return stack;
  }

  function renderToast(alertItem) {
    const stack = ensureToastStack();
    const toast = document.createElement('div');
    toast.className = 'mra-toast';
    toast.dataset.kind = alertItem.kind || 'info';
    toast.dataset.alertId = alertItem.id;

    const confText = typeof alertItem.confidence === 'number'
      ? `ความมั่นใจ ${alertItem.confidence}%`
      : '';

    toast.innerHTML = `
      <div class="mra-toast-head">
        <div class="mra-toast-title"></div>
        ${confText ? `<span class="mra-conf">${confText}</span>` : ''}
      </div>
      ${alertItem.modelId ? `<div class="mra-toast-model"></div>` : ''}
      <div class="mra-toast-detail"></div>
      <div class="mra-toast-actions"></div>
    `;
    toast.querySelector('.mra-toast-title').textContent = alertItem.title || 'แจ้งเตือนโมเดล';
    if (alertItem.modelId) {
      toast.querySelector('.mra-toast-model').textContent = `โมเดล: ${alertItem.modelId}`;
    }
    toast.querySelector('.mra-toast-detail').textContent = alertItem.detail || '';

    const actions = toast.querySelector('.mra-toast-actions');
    const closeToast = () => toast.remove();

    if (alertItem.kind === 'new_pending' && alertItem.modelId) {
      const btnApprove = document.createElement('button');
      btnApprove.type = 'button';
      btnApprove.className = 'mra-btn mra-btn-approve';
      btnApprove.textContent = '✅ อนุมัติ';
      btnApprove.onclick = async () => {
        btnApprove.disabled = true;
        try {
          await apiJson('/api/model-registry/approve', {
            method: 'POST',
            body: JSON.stringify({ modelId: alertItem.modelId })
          });
          await apiJson('/api/model-registry/alerts/ack', {
            method: 'POST',
            body: JSON.stringify({ ids: [alertItem.id] })
          }).catch(() => {});
          closeToast();
          refreshRegistry();
        } catch (err) {
          btnApprove.disabled = false;
          alert('อนุมัติไม่สำเร็จ: ' + err.message);
        }
      };

      const btnReject = document.createElement('button');
      btnReject.type = 'button';
      btnReject.className = 'mra-btn mra-btn-reject';
      btnReject.textContent = '❌ ปฏิเสธ';
      btnReject.onclick = async () => {
        btnReject.disabled = true;
        try {
          await apiJson('/api/model-registry/reject', {
            method: 'POST',
            body: JSON.stringify({ modelId: alertItem.modelId })
          });
          await apiJson('/api/model-registry/alerts/ack', {
            method: 'POST',
            body: JSON.stringify({ ids: [alertItem.id] })
          }).catch(() => {});
          closeToast();
          refreshRegistry();
        } catch (err) {
          btnReject.disabled = false;
          alert('ปฏิเสธไม่สำเร็จ: ' + err.message);
        }
      };

      const btnView = document.createElement('button');
      btnView.type = 'button';
      btnView.className = 'mra-btn mra-btn-primary';
      btnView.textContent = '👀 ดูรายละเอียด';
      btnView.onclick = () => openModal();

      actions.append(btnApprove, btnReject, btnView);
    } else {
      const btnAck = document.createElement('button');
      btnAck.type = 'button';
      btnAck.className = 'mra-btn mra-btn-primary';
      btnAck.textContent = 'รับทราบ';
      btnAck.onclick = async () => {
        btnAck.disabled = true;
        try {
          await apiJson('/api/model-registry/alerts/ack', {
            method: 'POST',
            body: JSON.stringify({ ids: [alertItem.id] })
          });
          closeToast();
        } catch (err) {
          btnAck.disabled = false;
          alert('รับทราบไม่สำเร็จ: ' + err.message);
        }
      };
      actions.appendChild(btnAck);
    }

    stack.appendChild(toast);
  }

  async function pollAlerts() {
    try {
      const data = await apiJson('/api/model-registry/alerts?unacked=1&limit=20');
      const alerts = Array.isArray(data.alerts) ? data.alerts : [];
      const shown = getShownSet();
      let hasNew = false;
      for (const item of alerts) {
        if (!item || !item.id || shown.has(item.id)) continue;
        markShown(item.id);
        renderToast(item);
        fireBrowserNotification(item);
        hasNew = true;
      }
      if (hasNew && audioUnlocked) {
        playBeep();
      }
    } catch {}
  }

  async function refreshRegistry() {
    try {
      const data = await apiJson('/api/model-registry');
      registryState = data;
      updateFabBadge(data.pendingCount || 0);
      if (modalOpen) renderModalContent();
    } catch {}
  }

  function computeRowMetrics(m) {
    const sug = m.suggested || {};
    const res = m.research || {};
    const qObj = res.effectiveQ || sug.q || {};
    const avgQ = (res.scores && Number.isFinite(res.scores.avgQ))
      ? res.scores.avgQ
      : Number((((Number(qObj.code) || 75) * 0.4) + ((Number(qObj.analysis) || 75) * 0.35) + ((Number(qObj.chat) || 78) * 0.25)).toFixed(1));
    const effCost = (res.pricing && Number.isFinite(res.pricing.effectiveCost))
      ? res.pricing.effectiveCost
      : (Number.isFinite(Number(sug.cost)) ? Number(sug.cost) : 1);
    const conf = typeof m.confidence === 'number' ? m.confidence : 25;
    const valueScore = (res.scores && Number.isFinite(res.scores.valueScore))
      ? res.scores.valueScore
      : Number((avgQ / Math.max(0.15, effCost)).toFixed(1));
    const valueNorm = Math.min(100, (avgQ / Math.max(0.2, effCost)) * 0.5);
    const compositeScore = Number((avgQ * 0.6 + conf * 0.3 + valueNorm * 0.1).toFixed(1));
    return { avgQ, effCost, conf, valueScore, compositeScore };
  }

  function renderModalContent(scanSummary) {
    const modal = document.getElementById('mra-modal');
    if (!modal || !registryState) return;

    const metaEl = modal.querySelector('#mra-scan-meta');
    if (metaEl) {
      const okText = registryState.lastScanOk === false ? 'ล้มเหลว' : 'ปกติ';
      const resText = registryState.lastResearchAt ? ` · วิจัยภายนอกล่าสุด: ${formatTime(registryState.lastResearchAt)}` : '';
      metaEl.textContent = `สแกนล่าสุด: ${formatTime(registryState.lastScanAt)} · สถานะ: ${okText} · รออนุมัติ: ${registryState.pendingCount || 0}${resText}`;
    }

    const banner = modal.querySelector('#mra-scan-banner');
    if (banner) {
      if (scanSummary) {
        banner.style.display = 'block';
        banner.textContent = scanSummary;
      } else {
        banner.style.display = 'none';
      }
    }

    const tbody = modal.querySelector('#mra-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const rawModels = Array.isArray(registryState.models) ? [...registryState.models] : [];
    const models = rawModels.map((m) => ({ m, metrics: computeRowMetrics(m) }));
    // DeepSeek จ่ายตามการใช้งานจริง → อยู่นอกกฎเกณฑ์ แยกกลุ่มต่อท้าย ไม่มีเลขอันดับ
    // Claude + Gemini (ซับสคริปชัน) จัดอันดับรวมกัน
    const isPayPerUse = (m) => m.engine === 'deepseek' || String(m.id || '').startsWith('deepseek');
    models.sort((a, b) => {
      const pa = isPayPerUse(a.m) ? 1 : 0;
      const pb = isPayPerUse(b.m) ? 1 : 0;
      if (pa !== pb) return pa - pb;
      if (sortBy === 'confidence') return (b.metrics.conf - a.metrics.conf) || (b.metrics.avgQ - a.metrics.avgQ);
      if (sortBy === 'intelligence') return (b.metrics.avgQ - a.metrics.avgQ) || (b.metrics.conf - a.metrics.conf);
      if (sortBy === 'value') return (b.metrics.valueScore - a.metrics.valueScore) || (b.metrics.avgQ - a.metrics.avgQ);
      if (sortBy === 'cost') return (a.metrics.effCost - b.metrics.effCost) || (b.metrics.avgQ - a.metrics.avgQ) || (b.metrics.conf - a.metrics.conf);
      return (b.metrics.compositeScore - a.metrics.compositeScore) || (b.metrics.conf - a.metrics.conf);
    });

    let rankNo = 0;
    let lastGroup = null;
    for (let idx = 0; idx < models.length; idx += 1) {
      const { m, metrics } = models[idx];
      const payPerUse = isPayPerUse(m);
      const group = payPerUse ? 'ppu' : 'sub';
      if (group !== lastGroup) {
        lastGroup = group;
        const head = document.createElement('tr');
        head.className = 'mra-group-row';
        head.innerHTML = `<td colspan="8">${payPerUse
          ? '💳 จ่ายตามการใช้งานจริง (DeepSeek) · อยู่นอกการจัดอันดับ'
          : '🎟️ ซับสคริปชันที่จ่ายไปแล้ว (Claude + Gemini) · เรียงต้นทุนรวมกัน'}</td>`;
        tbody.appendChild(head);
      }
      if (!payPerUse) rankNo += 1;
      const tr = document.createElement('tr');
      const st = STATUS_META[m.status] || { label: m.status || '-', cls: 'mra-st-disabled' };
      const sug = m.suggested || {};
      const res = m.research || null;
      const qObj = (res && res.effectiveQ) || sug.q || null;
      const q = qObj ? `avg:${metrics.avgQ} (c:${qObj.code ?? '-'} / a:${qObj.analysis ?? '-'} / ch:${qObj.chat ?? '-'})` : '-';
      const costText = `cost:${metrics.effCost}` + (res && res.pricing && res.pricing.outputUsdPer1M != null ? ` ($${res.pricing.outputUsdPer1M}/1M)` : '');
      const basisText = sug.basis || '';

      const confVal = typeof m.confidence === 'number' ? m.confidence : null;
      const srcCount = res && typeof res.uniqueDomainCount === 'number' ? res.uniqueDomainCount : null;
      const confCls = confVal == null ? 'mra-conf-mid'
        : (res && res.agreement === 'conflict') || confVal < 50 ? 'mra-conf-low'
          : (confVal >= 76 && (srcCount === null || srcCount >= 3)) ? 'mra-conf-high'
            : 'mra-conf-mid';

      const srcLinksHtml = (res && Array.isArray(res.sources) && res.sources.length > 0)
        ? `<div class="mra-src-links">${res.sources.slice(0, 5).map((s) =>
            `<a class="mra-src-link" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(s.title || s.domain)}">${escapeHtml(s.domain)}</a>`
          ).join('')}</div>`
        : '';

      const srcMetaHtml = srcCount !== null
        ? `<div class="mra-sub">${srcCount} แหล่งอิสระ · ${escapeHtml(res.agreement || '-')}</div>`
        : '';

      tr.innerHTML = `
        <td><strong>${payPerUse ? '—' : '#' + rankNo} ${escapeHtml(m.id)}</strong></td>
        <td>${escapeHtml(m.name || '-')}</td>
        <td>${escapeHtml(m.engine || '-')}</td>
        <td><span class="mra-st ${st.cls}">${st.label}</span></td>
        <td>
          <span class="mra-conf-pill ${confCls}">${confVal != null ? confVal + '%' : '-'}</span>
          ${srcMetaHtml}
        </td>
        <td>
          <div>${escapeHtml(q)} · ${escapeHtml(costText)}</div>
          ${basisText ? `<div class="mra-sub">${escapeHtml(basisText)}</div>` : ''}
          ${srcLinksHtml}
        </td>
        <td>${escapeHtml(formatTime(m.lastSeen))}</td>
        <td><div class="mra-row-actions"></div></td>
      `;

      const actWrap = tr.querySelector('.mra-row-actions');
      const bRes = makeActionBtn('🔎', 'mra-btn', async () => {
        await apiJson('/api/model-registry/research', {
          method: 'POST',
          body: JSON.stringify({ modelId: m.id, skipCache: true })
        });
        await refreshRegistry();
        renderModalContent(`วิจัยภายนอกสำเร็จสำหรับ ${m.id}`);
      });
      bRes.title = 'วิจัยข้อมูลภายนอกเฉพาะโมเดลนี้';
      actWrap.appendChild(bRes);

      if (m.status === 'pending') {
        const bApp = makeActionBtn('✅ อนุมัติ', 'mra-btn mra-btn-approve', async () => {
          await apiJson('/api/model-registry/approve', {
            method: 'POST',
            body: JSON.stringify({ modelId: m.id })
          });
          await refreshRegistry();
        });
        const bRej = makeActionBtn('❌ ปฏิเสธ', 'mra-btn mra-btn-reject', async () => {
          await apiJson('/api/model-registry/reject', {
            method: 'POST',
            body: JSON.stringify({ modelId: m.id })
          });
          await refreshRegistry();
        });
        actWrap.append(bApp, bRej);
      } else {
        const willEnable = m.status !== 'active';
        const bTog = makeActionBtn(
          willEnable ? 'เปิดใช้งาน' : 'ปิดใช้งาน',
          'mra-btn',
          async () => {
            await apiJson('/api/model-registry/toggle', {
              method: 'POST',
              body: JSON.stringify({ modelId: m.id, enabled: willEnable })
            });
            await refreshRegistry();
          }
        );
        actWrap.appendChild(bTog);
      }

      tbody.appendChild(tr);
    }
  }

  function makeActionBtn(label, cls, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = cls;
    btn.textContent = label;
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await onClick();
      } catch (err) {
        alert('ดำเนินการไม่สำเร็จ: ' + err.message);
        btn.disabled = false;
      }
    };
    return btn;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function openModal() {
    if (modalOpen) return;
    modalOpen = true;

    const backdrop = document.createElement('div');
    backdrop.id = 'mra-backdrop';
    backdrop.className = 'mra-backdrop';
    backdrop.innerHTML = `
      <div class="mra-modal" id="mra-modal" role="dialog" aria-modal="true" aria-label="จัดการโมเดล AI">
        <div class="mra-modal-head">
          <div>
            <h3 class="mra-modal-title">🧠 จัดการโมเดล AI (Model Registry)</h3>
            <div class="mra-scan-meta" id="mra-scan-meta">กำลังโหลดข้อมูล...</div>
          </div>
          <div class="mra-modal-controls">
            <select id="mra-sort-select" class="mra-select" title="เรียงลำดับโมเดล">
              <option value="cost">เรียง: ต้นทุนต่ำ→สูง</option>
              <option value="composite">เรียง: คะแนนรวม</option>
              <option value="confidence">เรียง: ความมั่นใจ</option>
              <option value="intelligence">เรียง: ความฉลาด (avgQ)</option>
              <option value="value">เรียง: ความคุ้มค่า</option>
            </select>
            <button type="button" class="mra-btn mra-btn-primary" id="mra-btn-research">🔎 วิจัยภายนอก</button>
            <button type="button" class="mra-btn mra-btn-primary" id="mra-btn-scan">🔄 สแกนเดี๋ยวนี้</button>
            <button type="button" class="mra-btn" id="mra-btn-close">ปิด</button>
          </div>
        </div>
        <div class="mra-scan-banner" id="mra-scan-banner" style="display:none;"></div>
        <div class="mra-table-wrap">
          <table class="mra-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>ชื่อ</th>
                <th>Engine</th>
                <th>สถานะ</th>
                <th>ความมั่นใจ</th>
                <th>แนะนำ q / cost + เหตุผล</th>
                <th>พบล่าสุด</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody id="mra-tbody"></tbody>
          </table>
        </div>
      </div>
    `;

    const closeModal = () => {
      modalOpen = false;
      backdrop.remove();
    };

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });
    backdrop.querySelector('#mra-btn-close').onclick = closeModal;

    const sortSelect = backdrop.querySelector('#mra-sort-select');
    if (sortSelect) {
      sortSelect.value = sortBy;
      sortSelect.onchange = () => {
        sortBy = sortSelect.value;
        renderModalContent();
      };
    }

    const btnResearch = backdrop.querySelector('#mra-btn-research');
    if (btnResearch) {
      btnResearch.onclick = async () => {
        if (researching) return;
        researching = true;
        btnResearch.disabled = true;
        btnResearch.innerHTML = '<span class="mra-spin"></span> กำลังวิจัยภายนอก...';
        try {
          const res = await apiJson('/api/model-registry/research', {
            method: 'POST',
            body: JSON.stringify({ sortBy })
          });
          await refreshRegistry();
          renderModalContent(
            `วิจัยภายนอกเสร็จสิ้น: ประเมิน ${res.researchedCount || 0} โมเดล (ผ่านเกณฑ์ ≥3 แหล่งอิสระ ${res.meetsMinSourcesCount || 0} โมเดล)`
          );
        } catch (err) {
          renderModalContent('วิจัยภายนอกไม่สำเร็จ: ' + err.message);
        } finally {
          researching = false;
          btnResearch.disabled = false;
          btnResearch.textContent = '🔎 วิจัยภายนอก';
        }
      };
    }

    const btnScan = backdrop.querySelector('#mra-btn-scan');
    btnScan.onclick = async () => {
      if (scanning) return;
      scanning = true;
      btnScan.disabled = true;
      btnScan.innerHTML = '<span class="mra-spin"></span> กำลังสแกน...';
      try {
        const res = await apiJson('/api/model-registry/scan', { method: 'POST', body: '{}' });
        const changes = Array.isArray(res.changes) ? res.changes : [];
        await refreshRegistry();
        renderModalContent(
          changes.length > 0
            ? `สแกนเสร็จสิ้น: พบการเปลี่ยนแปลง ${changes.length} รายการ`
            : 'สแกนเสร็จสิ้น: ไม่พบการเปลี่ยนแปลงใหม่'
        );
        pollAlerts();
      } catch (err) {
        renderModalContent('สแกนไม่สำเร็จ: ' + err.message);
      } finally {
        scanning = false;
        btnScan.disabled = false;
        btnScan.textContent = '🔄 สแกนเดี๋ยวนี้';
      }
    };

    document.body.appendChild(backdrop);
    await refreshRegistry();
    renderModalContent();
  }

  function init() {
    injectStyles();
    ensureFab();
    setupFirstClickNotificationPermission();
    refreshRegistry();
    pollAlerts();
    setInterval(() => {
      pollAlerts();
      refreshRegistry();
    }, POLL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
