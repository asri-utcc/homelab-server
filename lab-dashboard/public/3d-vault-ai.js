// 3D Asset Vault — AI Co-Pilot Panel (ES Module, zero external dependencies)

const API_BASE = '/api/3d-vault/ai';
const POLL_INTERVAL_MS = 1500;
const RESTART_MSG = 'ฟีเจอร์ AI ต้อง restart lab-dashboard ก่อน';

const state = {
  open: false,
  assetId: null,
  version: null,
  status: null,
  statusLoaded: false,
  apiUnavailable: false,
  messages: [],
  ideas: [],
  ideasLoading: false,
  sending: false,
  target: 'auto',
  activeJob: null,
  pollTimer: null,
  turntableJob: null,
  turntablePollTimer: null,
  lastViewerKey: '',
};

let panelEl = null;
let toggleBtn = null;
let turntableModalEl = null;

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getLiveSession() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('bv');
    if (fromUrl && fromUrl.trim()) return fromUrl.trim();
    const fromStorage = window.localStorage.getItem('bvSession');
    if (fromStorage && fromStorage.trim()) return fromStorage.trim();
  } catch {
    // ignore storage/url errors
  }
  return '';
}

function showToast(msg, type = 'info', durationMs = 4200) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${esc(msg)}</span><button type="button" class="toast-close" aria-label="ปิด">✕</button>`;
  const remove = () => el.remove();
  el.querySelector('.toast-close')?.addEventListener('click', remove);
  stack.appendChild(el);
  if (durationMs > 0) setTimeout(remove, durationMs);
}

async function apiJson(path, opts = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...opts,
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  });

  const ct = res.headers.get('content-type') || '';
  const isJson = ct.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;

  // Only treat as "backend not restarted" when the AI route itself is missing.
  const missingRoute =
    res.status === 501 ||
    (res.status === 404 &&
      (!data || data.error === 'ไม่พบ AI API endpoint ที่ร้องขอ' || path === '/status'));
  if (missingRoute) {
    state.apiUnavailable = true;
    const err = new Error(RESTART_MSG);
    err.status = res.status;
    err.needsRestart = true;
    throw err;
  }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  state.apiUnavailable = false;
  return data || {};
}

function injectStyles() {
  if (document.getElementById('vault-ai-styles')) return;
  const style = document.createElement('style');
  style.id = 'vault-ai-styles';
  style.textContent = `
    #viewer-body {
      position: relative;
    }

    #btn-viewer-ai.active {
      background: var(--cad-cyan-soft);
      border-color: var(--cad-cyan);
      color: #E0F2FE;
    }

    .vault-ai-panel[hidden] {
      display: none !important;
    }

    .vault-ai-panel {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 380px;
      max-width: 100%;
      z-index: 48;
      display: flex;
      flex-direction: column;
      background: var(--panel-bg, rgba(24, 32, 42, 0.96));
      border-left: 1px solid var(--panel-border-strong);
      backdrop-filter: blur(14px);
      box-shadow: -12px 0 36px rgba(0, 0, 0, 0.45);
      color: var(--ink-primary);
      font-family: var(--font-sans);
    }

    .vai-handle {
      display: none;
    }

    .vai-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 11px 12px;
      background: var(--surface-1);
      border-bottom: 1px solid var(--panel-border);
      flex-shrink: 0;
    }

    .vai-head-left {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }

    .vai-title-row {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }

    .vai-title {
      font-size: 0.9rem;
      font-weight: 700;
      color: var(--ink-primary);
      white-space: nowrap;
    }

    .vai-ver-chip {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      padding: 1px 6px;
      border-radius: 4px;
      background: var(--cad-cyan-soft);
      border: 1px solid rgba(56, 189, 248, 0.35);
      color: #E0F2FE;
    }

    .vai-runtime-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 0.72rem;
      color: var(--ink-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .vai-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--ink-muted);
    }
    .vai-dot.ok { background: var(--emerald-ok); box-shadow: 0 0 6px rgba(16, 185, 129, 0.55); }
    .vai-dot.local { background: var(--cad-cyan); }
    .vai-dot.warn { background: var(--timber-amber); }
    .vai-dot.err { background: var(--danger-rose); }

    .vai-head-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .vai-icon-btn {
      border: 1px solid var(--panel-border);
      background: var(--surface-2);
      color: var(--ink-secondary);
      border-radius: var(--radius-sm);
      padding: 4px 8px;
      font-size: 0.74rem;
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s, background 0.15s;
    }

    .vai-icon-btn:hover:not(:disabled) {
      border-color: var(--cad-cyan);
      color: var(--ink-primary);
    }

    .vai-icon-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .vai-banner {
      padding: 9px 12px;
      background: var(--timber-amber-soft);
      border-bottom: 1px solid rgba(245, 158, 11, 0.38);
      color: #FEF3C7;
      font-size: 0.78rem;
      line-height: 1.45;
      flex-shrink: 0;
    }

    .vai-messages {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .vai-empty {
      margin: auto 0;
      padding: 18px 14px;
      border: 1px dashed var(--panel-border-strong);
      border-radius: var(--radius-md);
      background: rgba(22, 30, 40, 0.55);
      color: var(--ink-secondary);
      font-size: 0.8rem;
      line-height: 1.55;
    }

    .vai-empty strong {
      display: block;
      color: var(--ink-primary);
      font-size: 0.86rem;
      margin-bottom: 4px;
    }

    .vai-msg {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-width: 92%;
      padding: 9px 11px;
      border-radius: var(--radius-md);
      font-size: 0.82rem;
      line-height: 1.5;
      word-break: break-word;
      white-space: pre-wrap;
    }

    .vai-msg.user {
      align-self: flex-end;
      background: var(--cad-cyan-soft);
      border: 1px solid rgba(56, 189, 248, 0.34);
      color: #E0F2FE;
      border-bottom-right-radius: 3px;
    }

    .vai-msg.ai {
      align-self: flex-start;
      background: var(--surface-2);
      border: 1px solid var(--panel-border);
      border-left: 2px solid var(--cad-cyan);
      color: var(--ink-primary);
      border-bottom-left-radius: 3px;
    }

    .vai-msg.system {
      align-self: center;
      max-width: 100%;
      background: rgba(30, 40, 54, 0.65);
      border: 1px solid var(--panel-border);
      color: var(--ink-secondary);
      font-size: 0.75rem;
      padding: 6px 10px;
      text-align: center;
    }

    .vai-msg-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 2px;
      white-space: normal;
    }

    .vai-chip-btn {
      border: 1px solid var(--panel-border-strong);
      background: var(--surface-1);
      color: var(--ink-primary);
      border-radius: 5px;
      padding: 4px 8px;
      font-size: 0.73rem;
      font-weight: 500;
      cursor: pointer;
    }

    .vai-chip-btn:hover {
      border-color: var(--cad-cyan);
      background: var(--cad-cyan-soft);
      color: #E0F2FE;
    }

    .vai-chip-btn.primary {
      border-color: rgba(56, 189, 248, 0.5);
      background: var(--cad-cyan-soft);
      color: #E0F2FE;
    }

    .vai-job-card {
      margin: 0 12px 8px;
      padding: 10px 11px;
      border-radius: var(--radius-md);
      background: var(--surface-1);
      border: 1px solid var(--panel-border-strong);
      display: flex;
      flex-direction: column;
      gap: 7px;
      flex-shrink: 0;
    }

    .vai-job-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 0.78rem;
    }

    .vai-job-step {
      color: var(--ink-primary);
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .vai-job-pct {
      font-family: var(--font-mono);
      font-size: 0.74rem;
      color: var(--cad-cyan);
      flex-shrink: 0;
    }

    .vai-progress-track {
      width: 100%;
      height: 6px;
      border-radius: 999px;
      background: var(--surface-3);
      overflow: hidden;
    }

    .vai-progress-fill {
      height: 100%;
      width: 0%;
      background: var(--cad-cyan);
      transition: width 0.25s ease;
    }

    .vai-progress-fill.healing {
      background: var(--timber-amber);
    }

    .vai-job-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 0.72rem;
      color: var(--ink-secondary);
    }

    .vai-log-details {
      font-size: 0.72rem;
      color: var(--ink-secondary);
    }

    .vai-log-details summary {
      cursor: pointer;
      user-select: none;
      color: var(--ink-secondary);
    }

    .vai-log-pre {
      margin-top: 6px;
      max-height: 130px;
      overflow: auto;
      padding: 7px 8px;
      border-radius: var(--radius-sm);
      background: var(--bg-slate);
      border: 1px solid var(--panel-border);
      font-family: var(--font-mono);
      font-size: 0.69rem;
      line-height: 1.4;
      color: #CBD5E1;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .vai-cancel-btn {
      border: 1px solid rgba(244, 63, 94, 0.45);
      background: var(--danger-soft);
      color: #FECDD3;
      border-radius: 5px;
      padding: 3px 8px;
      font-size: 0.72rem;
      cursor: pointer;
    }

    .vai-cancel-btn:hover {
      border-color: var(--danger-rose);
    }

    .vai-ideas-bar {
      padding: 8px 12px 6px;
      border-top: 1px solid var(--panel-border);
      background: rgba(22, 30, 40, 0.78);
      display: flex;
      flex-direction: column;
      gap: 7px;
      flex-shrink: 0;
    }

    .vai-ideas-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .vai-ideas-btn {
      border: 1px solid rgba(245, 158, 11, 0.42);
      background: var(--timber-amber-soft);
      color: #FDE68A;
      border-radius: var(--radius-sm);
      padding: 4px 9px;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
    }

    .vai-ideas-btn:hover:not(:disabled) {
      border-color: var(--timber-amber);
    }

    .vai-ideas-btn:disabled {
      opacity: 0.55;
      cursor: wait;
    }

    .vai-ideas-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 6px;
    }

    .vai-idea-card {
      text-align: left;
      border: 1px solid var(--panel-border);
      background: var(--surface-2);
      border-radius: var(--radius-sm);
      padding: 7px 9px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 2px;
      transition: border-color 0.15s, background 0.15s;
    }

    .vai-idea-card:hover {
      border-color: var(--cad-cyan);
      background: var(--surface-3);
    }

    .vai-idea-title {
      font-size: 0.77rem;
      font-weight: 600;
      color: var(--ink-primary);
    }

    .vai-idea-desc {
      font-size: 0.72rem;
      color: var(--ink-secondary);
      line-height: 1.35;
    }

    .vai-composer {
      padding: 9px 12px 11px;
      border-top: 1px solid var(--panel-border);
      background: var(--surface-1);
      display: flex;
      flex-direction: column;
      gap: 7px;
      flex-shrink: 0;
    }

    .vai-input {
      width: 100%;
      min-height: 58px;
      max-height: 130px;
      resize: vertical;
      padding: 8px 10px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--panel-border-strong);
      background: var(--bg-slate);
      color: var(--ink-primary);
      font-size: 0.82rem;
      line-height: 1.45;
    }

    .vai-input::placeholder {
      color: var(--ink-muted);
    }

    .vai-composer-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }

    .vai-target-select {
      border: 1px solid var(--panel-border-strong);
      background: var(--surface-2);
      color: var(--ink-primary);
      border-radius: var(--radius-sm);
      padding: 5px 7px;
      font-size: 0.74rem;
      cursor: pointer;
    }

    .vai-composer-right {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .vai-send-btn {
      border: 1px solid var(--cad-cyan);
      background: var(--cad-cyan);
      color: #0B1219;
      font-weight: 700;
      border-radius: var(--radius-sm);
      padding: 5px 12px;
      font-size: 0.78rem;
      cursor: pointer;
    }

    .vai-send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* 360 Turntable Modal */
    .vai-modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 130;
      background: rgba(8, 12, 18, 0.78);
      backdrop-filter: blur(6px);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }

    .vai-modal-backdrop.open {
      display: flex;
    }

    .vai-modal-card {
      width: min(560px, 100%);
      max-height: 90vh;
      overflow: auto;
      background: var(--surface-1);
      border: 1px solid var(--panel-border-strong);
      border-radius: var(--radius-lg);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
      display: flex;
      flex-direction: column;
    }

    .vai-modal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      border-bottom: 1px solid var(--panel-border);
    }

    .vai-modal-title {
      font-size: 0.92rem;
      font-weight: 700;
      color: var(--ink-primary);
    }

    .vai-modal-body {
      padding: 14px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }

    .vai-turntable-media {
      width: 100%;
      max-height: 62vh;
      border-radius: var(--radius-md);
      background: var(--bg-slate);
      border: 1px solid var(--panel-border);
      object-fit: contain;
    }

    @media (max-width: 899px) {
      .vault-ai-panel {
        position: fixed;
        top: auto;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100%;
        height: min(76vh, 580px);
        z-index: 80;
        border-left: none;
        border-top: 1px solid var(--panel-border-strong);
        border-radius: 14px 14px 0 0;
        box-shadow: 0 -14px 40px rgba(0, 0, 0, 0.6);
      }

      .vai-handle {
        display: block;
        width: 38px;
        height: 4px;
        border-radius: 999px;
        background: var(--panel-border-strong);
        margin: 7px auto 2px;
        flex-shrink: 0;
      }
    }
  `;
  document.head.appendChild(style);
}

function renderPanelShell() {
  if (!panelEl) return;
  panelEl.setAttribute('aria-label', 'แผง AI ปรับแต่งโมเดล 3D');
  panelEl.innerHTML = `
    <div class="vai-handle" aria-hidden="true"></div>
    <div class="vai-head">
      <div class="vai-head-left">
        <div class="vai-title-row">
          <span class="vai-title">✨ AI ปรับแต่ง 3D</span>
          <span class="vai-ver-chip" id="vai-ver-chip">v—</span>
        </div>
        <div class="vai-runtime-badge" id="vai-runtime-badge">
          <span class="vai-dot"></span>
          <span>กำลังตรวจเครื่องรัน...</span>
        </div>
      </div>
      <div class="vai-head-actions">
        <button type="button" class="vai-icon-btn" id="vai-btn-clear" title="ล้างประวัติแชตของโมเดลนี้">ล้างแชต</button>
        <button type="button" class="vai-icon-btn" id="vai-btn-close" aria-label="ปิดแผง AI">✕</button>
      </div>
    </div>

    <div class="vai-banner" id="vai-banner" hidden></div>

    <div class="vai-messages" id="vai-messages"></div>

    <div class="vai-job-card" id="vai-job-card" hidden>
      <div class="vai-job-top">
        <span class="vai-job-step" id="vai-job-step">กำลังเตรียมงาน...</span>
        <span class="vai-job-pct" id="vai-job-pct">0%</span>
      </div>
      <div class="vai-progress-track">
        <div class="vai-progress-fill" id="vai-progress-fill"></div>
      </div>
      <div class="vai-job-meta">
        <span id="vai-job-meta-text">รอคิว...</span>
        <button type="button" class="vai-cancel-btn" id="vai-btn-cancel">ยกเลิกงาน</button>
      </div>
      <details class="vai-log-details" id="vai-log-details">
        <summary>ดู Log การทำงาน</summary>
        <pre class="vai-log-pre" id="vai-log-pre">ยังไม่มี log</pre>
      </details>
    </div>

    <div class="vai-ideas-bar">
      <div class="vai-ideas-head">
        <button type="button" class="vai-ideas-btn" id="vai-btn-ideas">💡 ขอไอเดีย 3 แบบ</button>
        <button type="button" class="vai-icon-btn" id="vai-btn-360-now" title="สร้างวิดีโอหมุน 360° ของเวอร์ชันปัจจุบัน">🎞 360°</button>
      </div>
      <div class="vai-ideas-grid" id="vai-ideas-grid" hidden></div>
    </div>

    <div class="vai-composer">
      <textarea
        id="vai-input"
        class="vai-input"
        rows="2"
        placeholder="สั่งปรับแต่งเป็นภาษาไทย เช่น เพิ่มหน้าต่างด้านหน้า เปลี่ยนสีหลังคาเป็นเทาเข้ม... (Enter ส่ง, Shift+Enter ขึ้นบรรทัด)"
      ></textarea>
      <div class="vai-composer-row">
        <select id="vai-target" class="vai-target-select" aria-label="เลือกเครื่องรัน Blender">
          <option value="auto">เครื่องรัน: อัตโนมัติ</option>
          <option value="local">เครื่องรัน: เครื่องนี้ (local)</option>
          <option value="worker">เครื่องรัน: Worker</option>
        </select>
        <div class="vai-composer-right">
          <button type="button" class="vai-send-btn" id="vai-btn-send">ส่งคำสั่ง</button>
        </div>
      </div>
    </div>
  `;

  panelEl.querySelector('#vai-btn-close')?.addEventListener('click', () => setPanelOpen(false));
  panelEl.querySelector('#vai-btn-clear')?.addEventListener('click', handleClearChat);
  panelEl.querySelector('#vai-btn-ideas')?.addEventListener('click', handleSuggestIdeas);
  panelEl.querySelector('#vai-btn-360-now')?.addEventListener('click', () => {
    if (state.version != null) startTurntable(state.version);
  });
  panelEl.querySelector('#vai-btn-cancel')?.addEventListener('click', handleCancelJob);
  panelEl.querySelector('#vai-btn-send')?.addEventListener('click', handleSend);

  const targetSelect = panelEl.querySelector('#vai-target');
  if (targetSelect) {
    targetSelect.value = state.target;
    targetSelect.addEventListener('change', (e) => {
      state.target = e.target.value || 'auto';
    });
  }

  const inputEl = panelEl.querySelector('#vai-input');
  inputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
}

function ensureTurntableModal() {
  if (turntableModalEl) return turntableModalEl;
  const el = document.createElement('div');
  el.className = 'vai-modal-backdrop';
  el.id = 'vai-turntable-modal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'vai-tt-title');
  el.innerHTML = `
    <div class="vai-modal-card">
      <div class="vai-modal-head">
        <span class="vai-modal-title" id="vai-tt-title">🎞 พรีวิวหมุนรอบ 360°</span>
        <button type="button" class="vai-icon-btn" id="vai-tt-close" aria-label="ปิดหน้าต่าง">✕</button>
      </div>
      <div class="vai-modal-body" id="vai-tt-body"></div>
    </div>
  `;
  el.addEventListener('click', (e) => {
    if (e.target === el) closeTurntableModal();
  });
  el.querySelector('#vai-tt-close')?.addEventListener('click', closeTurntableModal);
  document.body.appendChild(el);
  turntableModalEl = el;
  return el;
}

function closeTurntableModal() {
  if (state.turntablePollTimer) {
    clearTimeout(state.turntablePollTimer);
    state.turntablePollTimer = null;
  }
  state.turntableJob = null;
  if (turntableModalEl) {
    turntableModalEl.classList.remove('open');
    const body = turntableModalEl.querySelector('#vai-tt-body');
    if (body) body.innerHTML = '';
  }
}

function setPanelOpen(open) {
  state.open = Boolean(open);
  if (panelEl) panelEl.hidden = !state.open;
  if (toggleBtn) toggleBtn.classList.toggle('active', state.open);
  if (state.open) {
    refreshStatus();
    if (state.assetId) loadChat(state.assetId);
    panelEl?.querySelector('#vai-input')?.focus();
  }
}

function renderBanner(message) {
  const banner = panelEl?.querySelector('#vai-banner');
  if (!banner) return;
  if (!message) {
    banner.hidden = true;
    banner.textContent = '';
    return;
  }
  banner.hidden = false;
  banner.textContent = message;
}

function renderStatusBadge() {
  const badge = panelEl?.querySelector('#vai-runtime-badge');
  const verChip = panelEl?.querySelector('#vai-ver-chip');
  if (verChip) verChip.textContent = state.version != null ? `v${state.version}` : 'v—';
  if (!badge) return;

  if (state.apiUnavailable) {
    badge.innerHTML = `<span class="vai-dot err"></span><span>AI API ยังไม่พร้อม</span>`;
    return;
  }
  if (!state.statusLoaded || !state.status) {
    badge.innerHTML = `<span class="vai-dot"></span><span>กำลังตรวจเครื่องรัน...</span>`;
    return;
  }
  const s = state.status;
  const nodes = Array.isArray(s.workerNodes) ? s.workerNodes : [];
  if (s.workerOnline && nodes.length) {
    const first = nodes[0];
    const label = typeof first === 'string' ? first : (first.alias || first.name || first.id || 'worker');
    badge.innerHTML = `<span class="vai-dot ok"></span><span>Worker ออนไลน์ (${esc(label)})${s.blenderLocal ? ' · Local พร้อม' : ''}</span>`;
  } else if (s.blenderLocal) {
    badge.innerHTML = `<span class="vai-dot local"></span><span>รันบนเครื่องนี้ (Local Blender)</span>`;
  } else {
    badge.innerHTML = `<span class="vai-dot warn"></span><span>ไม่พบ Blender ที่พร้อมใช้งาน</span>`;
  }
}

function extractMessageVersion(msg) {
  const v = msg?.newVersion ?? msg?.version ?? msg?.v ?? msg?.meta?.newVersion ?? msg?.meta?.version;
  const num = Number(v);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function renderMessages() {
  const box = panelEl?.querySelector('#vai-messages');
  if (!box) return;

  if (!state.assetId) {
    box.innerHTML = `<div class="vai-empty"><strong>ยังไม่ได้เปิดโมเดล</strong>เปิดโมเดล 3D ในหน้า viewer เพื่อเริ่มสั่งปรับแต่งด้วย AI</div>`;
    return;
  }

  if (!state.messages.length) {
    box.innerHTML = `
      <div class="vai-empty">
        <strong>พร้อมปรับแต่งโมเดลเวอร์ชัน v${esc(state.version ?? 1)}</strong>
        พิมพ์คำสั่งภาษาไทยด้านล่าง เช่น เปลี่ยนสีวัสดุ ปรับสัดส่วน เพิ่มชิ้นส่วน หรือกดปุ่ม <b>💡 ขอไอเดีย 3 แบบ</b> เพื่อดูข้อเสนอแนะ
      </div>
    `;
    return;
  }

  box.innerHTML = state.messages
    .map((m) => {
      const role = m.role === 'user' || m.role === 'system' ? m.role : 'ai';
      const text = m.text || m.content || m.message || '';
      const ver = role === 'ai' ? extractMessageVersion(m) : null;
      const actionsHtml =
        role === 'ai' && ver
          ? `
            <div class="vai-msg-actions">
              <button type="button" class="vai-chip-btn primary" data-vai-open="${esc(ver)}">เปิด v${esc(ver)}</button>
              <button type="button" class="vai-chip-btn" data-vai-compare="${esc(ver)}">เทียบก่อน/หลัง</button>
              <button type="button" class="vai-chip-btn" data-vai-360="${esc(ver)}">🎞 360°</button>
            </div>
          `
          : '';
      return `<div class="vai-msg ${role}"><div>${esc(text)}</div>${actionsHtml}</div>`;
    })
    .join('');

  box.querySelectorAll('[data-vai-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = Number(btn.getAttribute('data-vai-open'));
      if (state.assetId && Number.isFinite(v)) {
        window.__vaultViewer?.open?.(state.assetId, v, false);
      }
    });
  });

  box.querySelectorAll('[data-vai-compare]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = Number(btn.getAttribute('data-vai-compare'));
      if (state.assetId && Number.isFinite(v)) {
        window.__vaultViewer?.open?.(state.assetId, v, true);
      }
    });
  });

  box.querySelectorAll('[data-vai-360]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = Number(btn.getAttribute('data-vai-360'));
      if (Number.isFinite(v)) startTurntable(v);
    });
  });

  box.scrollTop = box.scrollHeight;
}

function renderIdeas() {
  const grid = panelEl?.querySelector('#vai-ideas-grid');
  const btn = panelEl?.querySelector('#vai-btn-ideas');
  if (btn) {
    btn.disabled = state.ideasLoading || !state.assetId;
    btn.textContent = state.ideasLoading ? '💡 กำลังคิดไอเดีย...' : '💡 ขอไอเดีย 3 แบบ';
  }
  if (!grid) return;

  if (!state.ideas.length) {
    grid.hidden = true;
    grid.innerHTML = '';
    return;
  }

  grid.hidden = false;
  grid.innerHTML = state.ideas
    .slice(0, 3)
    .map((idea, idx) => {
      const title =
        typeof idea === 'string'
          ? idea
          : idea.title || idea.label || idea.name || `ไอเดีย ${idx + 1}`;
      const desc =
        typeof idea === 'string'
          ? ''
          : idea.description || idea.detail || idea.summary || '';
      const prompt =
        typeof idea === 'string'
          ? idea
          : idea.prompt || idea.instruction || (desc ? `${title}: ${desc}` : title);
      return `
        <button type="button" class="vai-idea-card" data-idea-idx="${idx}" data-idea-prompt="${esc(prompt)}">
          <span class="vai-idea-title">${esc(title)}</span>
          ${desc ? `<span class="vai-idea-desc">${esc(desc)}</span>` : ''}
        </button>
      `;
    })
    .join('');

  grid.querySelectorAll('.vai-idea-card').forEach((card) => {
    card.addEventListener('click', () => {
      const prompt = card.getAttribute('data-idea-prompt') || '';
      const input = panelEl?.querySelector('#vai-input');
      if (input) {
        input.value = prompt;
        input.focus();
      }
    });
  });
}

function renderJobCard() {
  const card = panelEl?.querySelector('#vai-job-card');
  const sendBtn = panelEl?.querySelector('#vai-btn-send');
  const job = state.activeJob;

  if (sendBtn) {
    sendBtn.disabled = state.sending || Boolean(job) || !state.assetId;
  }
  if (!card) return;

  if (!job) {
    card.hidden = true;
    return;
  }

  card.hidden = false;
  const pct = Math.max(0, Math.min(100, Number(job.progress ?? 0)));
  const status = String(job.status || 'running').toLowerCase();
  const isHealing = status === 'healing';
  const stepText =
    job.step ||
    (isHealing
      ? 'พบข้อผิดพลาด กำลังให้ AI แก้สคริปต์อัตโนมัติ...'
      : status === 'queued'
        ? 'กำลังเข้าคิวงาน...'
        : 'กำลังประมวลผลใน Blender...');

  const attempt = Number(job.attempt || 0);
  const maxAttempts = Number(job.maxAttempts || 3);
  const metaParts = [];
  if (job.runner || job.target) metaParts.push(`เครื่อง: ${job.runner || job.target}`);
  if (attempt > 0) metaParts.push(`รอบที่ ${attempt}/${maxAttempts}`);
  if (isHealing) metaParts.push('กำลังซ่อมสคริปต์');
  const metaText = metaParts.join(' · ') || 'กำลังทำงาน...';

  const stepEl = card.querySelector('#vai-job-step');
  const pctEl = card.querySelector('#vai-job-pct');
  const fillEl = card.querySelector('#vai-progress-fill');
  const metaEl = card.querySelector('#vai-job-meta-text');
  const logEl = card.querySelector('#vai-log-pre');

  if (stepEl) stepEl.textContent = stepText;
  if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
  if (fillEl) {
    fillEl.style.width = `${pct}%`;
    fillEl.classList.toggle('healing', isHealing);
  }
  if (metaEl) metaEl.textContent = metaText;
  if (logEl) {
    const rawLogs = Array.isArray(job.logs) ? job.logs.join('\n') : (job.log || job.logs || '');
    logEl.textContent = rawLogs ? String(rawLogs) : 'รอข้อความ log จาก Blender...';
    logEl.scrollTop = logEl.scrollHeight;
  }
}

async function refreshStatus() {
  try {
    const data = await apiJson('/status');
    state.status = data;
    state.statusLoaded = true;
    renderBanner('');
  } catch (err) {
    state.statusLoaded = true;
    if (err.needsRestart) {
      renderBanner(RESTART_MSG);
    }
  }
  renderStatusBadge();
}

async function loadChat(assetId) {
  if (!assetId) return;
  try {
    const data = await apiJson(`/assets/${encodeURIComponent(assetId)}/chat`);
    if (state.assetId !== assetId) return;
    state.messages = Array.isArray(data.messages) ? data.messages : [];
    renderBanner('');
    renderMessages();
  } catch (err) {
    if (err.needsRestart) {
      renderBanner(RESTART_MSG);
      renderStatusBadge();
    } else {
      showToast(`โหลดประวัติแชตไม่สำเร็จ: ${err.message}`, 'err');
    }
  }
}

async function handleClearChat() {
  if (!state.assetId) return;
  try {
    await apiJson(`/assets/${encodeURIComponent(state.assetId)}/chat`, { method: 'DELETE' });
    state.messages = [];
    renderMessages();
    showToast('ล้างประวัติแชตแล้ว', 'ok', 2200);
  } catch (err) {
    if (err.needsRestart) {
      renderBanner(RESTART_MSG);
      showToast(RESTART_MSG, 'warn');
    } else {
      showToast(`ล้างแชตไม่สำเร็จ: ${err.message}`, 'err');
    }
  }
}

async function handleSuggestIdeas() {
  if (!state.assetId || state.ideasLoading) return;
  state.ideasLoading = true;
  renderIdeas();
  try {
    const data = await apiJson(`/assets/${encodeURIComponent(state.assetId)}/suggest`, {
      method: 'POST',
      body: JSON.stringify({
        version: state.version,
        v: state.version,
      }),
    });
    const list = Array.isArray(data.ideas)
      ? data.ideas
      : Array.isArray(data.suggestions)
        ? data.suggestions
        : [];
    state.ideas = list.slice(0, 3);
    renderBanner('');
    if (!state.ideas.length) {
      showToast('ไม่พบข้อเสนอแนะสำหรับโมเดลนี้', 'warn');
    }
  } catch (err) {
    if (err.needsRestart) {
      renderBanner(RESTART_MSG);
      showToast(RESTART_MSG, 'warn');
    } else {
      showToast(`ขอไอเดียไม่สำเร็จ: ${err.message}`, 'err');
    }
  } finally {
    state.ideasLoading = false;
    renderIdeas();
  }
}

function stopEditPolling() {
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
}

async function handleSend() {
  if (!state.assetId || state.sending || state.activeJob) return;
  const input = panelEl?.querySelector('#vai-input');
  const instruction = (input?.value || '').trim();
  if (!instruction) {
    input?.focus();
    return;
  }

  state.sending = true;
  renderJobCard();

  const liveSession = getLiveSession();
  const payload = {
    instruction,
    version: state.version,
    v: state.version,
    target: state.target || 'auto',
  };
  if (liveSession) payload.liveSession = liveSession;

  // Optimistic user bubble
  state.messages = [
    ...state.messages,
    { role: 'user', text: instruction, createdAt: new Date().toISOString() },
  ];
  renderMessages();
  if (input) input.value = '';

  try {
    const res = await apiJson(`/assets/${encodeURIComponent(state.assetId)}/edit`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const job = res.job || res;
    const jobId = res.jobId || job.jobId || job.id;
    if (!jobId) throw new Error('ไม่ได้รับรหัสงาน (jobId) จากเซิร์ฟเวอร์');

    state.activeJob = {
      id: jobId,
      assetId: state.assetId,
      status: job.status || 'queued',
      progress: job.progress ?? 5,
      step: job.message || job.step || 'ส่งคำสั่งแล้ว กำลังเริ่มต้น...',
      logs: Array.isArray(job.log) ? job.log : (job.logs || []),
      attempt: job.attempt || 1,
      maxAttempts: job.maxAttempts || 3,
      target: job.effectiveTarget || job.target || state.target,
      runner: job.effectiveTarget || job.target || state.target,
    };
    renderBanner('');
    renderJobCard();
    scheduleEditPoll(jobId);
  } catch (err) {
    if (err.needsRestart) {
      renderBanner(RESTART_MSG);
      showToast(RESTART_MSG, 'warn');
    } else {
      showToast(`ส่งคำสั่งไม่สำเร็จ: ${err.message}`, 'err');
      state.messages = [
        ...state.messages,
        { role: 'system', text: `ส่งคำสั่งไม่สำเร็จ: ${err.message}` },
      ];
      renderMessages();
    }
  } finally {
    state.sending = false;
    renderJobCard();
  }
}

function scheduleEditPoll(jobId) {
  stopEditPolling();
  state.pollTimer = setTimeout(() => pollEditJob(jobId), POLL_INTERVAL_MS);
}

async function pollEditJob(jobId) {
  if (!state.activeJob || state.activeJob.id !== jobId) return;
  try {
    const res = await apiJson(`/jobs/${encodeURIComponent(jobId)}`);
    const job = res.job || res;
    if (!state.activeJob || state.activeJob.id !== jobId) return;

    const status = String(job.status || '').toLowerCase();
    state.activeJob = {
      ...state.activeJob,
      ...job,
      id: jobId,
      status,
      step: job.message || job.step || state.activeJob.step,
      logs: Array.isArray(job.log) ? job.log : (job.logs || []),
      runner: job.effectiveTarget || job.target || state.activeJob.runner,
    };
    renderJobCard();

    if (status === 'done' || status === 'completed' || status === 'success') {
      const targetAssetId = state.activeJob.assetId || state.assetId;
      const newVer = Number(job.newVersion ?? job.version ?? job.result?.newVersion ?? job.result?.version);
      stopEditPolling();
      state.activeJob = null;
      renderJobCard();

      showToast(
        Number.isFinite(newVer) && newVer > 0
          ? `AI สร้างเวอร์ชัน v${newVer} เรียบร้อย`
          : 'AI ปรับแต่งโมเดลเรียบร้อย',
        'ok',
        4500,
      );

      if (targetAssetId) {
        await window.__vaultViewer?.reloadAssets?.(true);
        if (Number.isFinite(newVer) && newVer > 0) {
          await window.__vaultViewer?.open?.(targetAssetId, newVer);
        } else {
          await loadChat(targetAssetId);
        }
      }
      return;
    }

    if (status === 'failed' || status === 'error') {
      const errMsg = job.error || job.message || 'รันสคริปต์ Blender ไม่สำเร็จ';
      stopEditPolling();
      state.activeJob = null;
      renderJobCard();
      showToast(`งาน AI ล้มเหลว: ${errMsg}`, 'err', 6000);
      if (state.assetId) await loadChat(state.assetId);
      return;
    }

    if (status === 'cancelled' || status === 'canceled') {
      stopEditPolling();
      state.activeJob = null;
      renderJobCard();
      showToast('ยกเลิกงาน AI แล้ว', 'warn', 3000);
      if (state.assetId) await loadChat(state.assetId);
      return;
    }

    scheduleEditPoll(jobId);
  } catch (err) {
    if (err.needsRestart) {
      stopEditPolling();
      state.activeJob = null;
      renderJobCard();
      renderBanner(RESTART_MSG);
      return;
    }
    if (err.status === 404) {
      stopEditPolling();
      state.activeJob = null;
      renderJobCard();
      showToast('ไม่พบงาน (อาจถูกล้างหลัง restart)', 'warn', 5000);
      if (state.assetId) await loadChat(state.assetId);
      return;
    }
    // Transient network error: retry on next tick
    scheduleEditPoll(jobId);
  }
}

async function handleCancelJob() {
  const job = state.activeJob;
  if (!job || !job.id) return;
  try {
    await apiJson(`/jobs/${encodeURIComponent(job.id)}/cancel`, { method: 'POST' });
    stopEditPolling();
    state.activeJob = null;
    renderJobCard();
    showToast('ส่งคำสั่งยกเลิกงานแล้ว', 'warn', 2800);
    if (state.assetId) loadChat(state.assetId);
  } catch (err) {
    if (err.needsRestart) {
      renderBanner(RESTART_MSG);
      showToast(RESTART_MSG, 'warn');
    } else {
      showToast(`ยกเลิกงานไม่สำเร็จ: ${err.message}`, 'err');
    }
  }
}

function renderTurntableBody({ loading, progress, step, outputUrl, outputType, error, version }) {
  const modal = ensureTurntableModal();
  const titleEl = modal.querySelector('#vai-tt-title');
  const bodyEl = modal.querySelector('#vai-tt-body');
  if (titleEl) titleEl.textContent = `🎞 พรีวิวหมุนรอบ 360°${version != null ? ` (v${version})` : ''}`;
  if (!bodyEl) return;

  if (error) {
    bodyEl.innerHTML = `<div class="vai-banner" style="width:100%;border-radius:8px;">${esc(error)}</div>`;
    return;
  }

  if (loading) {
    const pct = Math.max(0, Math.min(100, Number(progress ?? 10)));
    bodyEl.innerHTML = `
      <div style="width:100%;display:flex;flex-direction:column;gap:8px;">
        <div class="vai-job-top">
          <span class="vai-job-step">${esc(step || 'กำลังเรนเดอร์วิดีโอหมุน 360°...')}</span>
          <span class="vai-job-pct">${Math.round(pct)}%</span>
        </div>
        <div class="vai-progress-track">
          <div class="vai-progress-fill" style="width:${pct}%"></div>
        </div>
      </div>
    `;
    return;
  }

  if (outputUrl) {
    const hasExt = /\.[a-z0-9]{2,5}(\?|#|$)/i.test(outputUrl.split('?')[0] + (outputUrl.includes('?') ? '?' : ''));
    const typeHint = String(outputType || '').toLowerCase();
    let isImage;
    if (/\.(gif|webp|png|jpe?g)(\?|$)/i.test(outputUrl)) isImage = true;
    else if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(outputUrl)) isImage = false;
    else if (typeHint) isImage = /gif|image|webp|png|jpe?g/.test(typeHint);
    else isImage = false;
    // No extension / no hint: start as <video>, fall back to <img> on error.
    const fallback = !hasExt && !typeHint;
    const mediaHtml = isImage
      ? `<img class="vai-turntable-media" src="${esc(outputUrl)}" alt="พรีวิวหมุนรอบ 360 องศา" />`
      : `<video class="vai-turntable-media" src="${esc(outputUrl)}" autoplay loop muted playsinline controls></video>`;
    bodyEl.innerHTML = `
      ${mediaHtml}
      <div style="display:flex;gap:8px;justify-content:flex-end;width:100%;">
        <a class="vai-chip-btn primary" href="${esc(outputUrl)}" download>ดาวน์โหลดไฟล์ 360°</a>
      </div>
    `;
    if (fallback) {
      const vid = bodyEl.querySelector('video.vai-turntable-media');
      vid?.addEventListener('error', () => {
        const img = document.createElement('img');
        img.className = 'vai-turntable-media';
        img.alt = 'พรีวิวหมุนรอบ 360 องศา';
        img.src = outputUrl;
        vid.replaceWith(img);
      }, { once: true });
    }
  }
}

async function startTurntable(version) {
  if (!state.assetId) return;
  const modal = ensureTurntableModal();
  modal.classList.add('open');
  renderTurntableBody({ loading: true, progress: 8, step: 'กำลังเริ่มสร้างพรีวิว 360°...', version });

  const liveSession = getLiveSession();
  const payload = {
    version,
    v: version,
    target: state.target || 'auto',
  };
  if (liveSession) payload.liveSession = liveSession;

  try {
    const res = await apiJson(`/assets/${encodeURIComponent(state.assetId)}/turntable`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const directUrl = res.outputUrl || res.videoUrl || res.gifUrl || res.result?.outputUrl;
    if (directUrl) {
      renderTurntableBody({ loading: false, outputUrl: directUrl, outputType: res.outputType || res.job?.outputType, version });
      return;
    }

    const job = res.job || res;
    const jobId = res.jobId || job.jobId || job.id;
    if (!jobId) throw new Error('ไม่ได้รับรหัสงาน turntable');

    state.turntableJob = { id: jobId, version };
    pollTurntableJob(jobId, version);
  } catch (err) {
    if (err.needsRestart) {
      renderBanner(RESTART_MSG);
      renderTurntableBody({ error: RESTART_MSG, version });
    } else {
      renderTurntableBody({ error: `สร้างพรีวิว 360° ไม่สำเร็จ: ${err.message}`, version });
    }
  }
}

async function pollTurntableJob(jobId, version) {
  if (!state.turntableJob || state.turntableJob.id !== jobId) return;
  try {
    const res = await apiJson(`/jobs/${encodeURIComponent(jobId)}`);
    const job = res.job || res;
    if (!state.turntableJob || state.turntableJob.id !== jobId) return;

    const status = String(job.status || '').toLowerCase();
    const outputUrl = job.outputUrl || job.videoUrl || job.gifUrl || job.result?.outputUrl;

    if (status === 'done' || status === 'completed' || status === 'success') {
      state.turntableJob = null;
      if (outputUrl) {
        renderTurntableBody({ loading: false, outputUrl, outputType: job.outputType, version });
      } else {
        renderTurntableBody({ error: 'งานเสร็จสิ้นแต่ไม่พบลิงก์ไฟล์ผลลัพธ์', version });
      }
      return;
    }

    if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled') {
      state.turntableJob = null;
      renderTurntableBody({ error: job.error || 'สร้างพรีวิว 360° ไม่สำเร็จ', version });
      return;
    }

    renderTurntableBody({
      loading: true,
      progress: job.progress ?? 25,
      step: job.message || job.step || 'กำลังเรนเดอร์ 360°...',
      version,
    });

    state.turntablePollTimer = setTimeout(() => pollTurntableJob(jobId, version), POLL_INTERVAL_MS);
  } catch (err) {
    if (err.needsRestart) {
      state.turntableJob = null;
      renderTurntableBody({ error: RESTART_MSG, version });
      return;
    }
    if (err.status === 404) {
      state.turntableJob = null;
      renderTurntableBody({ error: 'ไม่พบงาน (อาจถูกล้างหลัง restart)', version });
      return;
    }
    state.turntablePollTimer = setTimeout(() => pollTurntableJob(jobId, version), POLL_INTERVAL_MS);
  }
}

function handleViewerChange(e) {
  const detail = e?.detail || {};
  const assetId = detail.assetId || null;
  const v = detail.v != null ? Number(detail.v) : null;
  const key = `${assetId || ''}:${v ?? ''}`;
  const assetChanged = assetId !== state.assetId;

  state.assetId = assetId;
  state.version = Number.isFinite(v) ? v : null;

  if (assetChanged) {
    state.ideas = [];
    state.messages = [];
    renderIdeas();
  }

  renderStatusBadge();
  renderJobCard();

  if (key === state.lastViewerKey) return;
  state.lastViewerKey = key;

  if (assetId) {
    refreshStatus();
    loadChat(assetId);
  } else {
    renderMessages();
  }
}

function init() {
  injectStyles();
  panelEl = document.getElementById('vault-ai-panel');
  toggleBtn = document.getElementById('btn-viewer-ai');

  if (panelEl) {
    renderPanelShell();
    renderStatusBadge();
    renderMessages();
    renderIdeas();
    renderJobCard();
  }

  toggleBtn?.addEventListener('click', () => {
    setPanelOpen(!state.open);
  });

  document.addEventListener('vault:viewer-change', handleViewerChange);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && turntableModalEl?.classList.contains('open')) {
      e.stopImmediatePropagation();
      closeTurntableModal();
    }
  }, true);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
