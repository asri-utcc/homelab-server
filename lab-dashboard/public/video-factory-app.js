'use strict';

/**
 * video-factory-app.js
 * -----------------------------------------------------------------------------
 * Frontend controller for Homelab Video Factory OS (/video-studio).
 * Connects all 7 Factory stations to live backend APIs:
 *  - Legacy Video Studio APIs (/api/video-studio/*) — 100% preserved
 *  - Video Factory OS APIs (/api/video-studio/factory/*)
 *  - Option C Hybrid Social Hub APIs (/api/video-studio/social/*)
 */
(() => {
  const DATA = window.VIDEO_FACTORY_DATA || {};
  const $ = (id) => document.getElementById(id);

  const state = {
    view: 'floor',
    floorMode: 'kanban',
    factoryApiAvailable: true,
    presets: [],
    customStyles: [],
    favoriteStyles: new Set(['look-32', 'look-3', 'look-1', 'look-11']),
    thumbManifest: null,
    artManifest: null,
    thumbBust: Math.floor(Date.now() / 3600000),
    selectedStyleId: 'look-3',
    orderMode: 'single',
    orderStyleCat: 'ทั้งหมด',
    jobs: [],
    lines: [],
    workers: { onlineCount: 0, totalCount: 0, nvencCount: 0, nodes: [] },
    analytics: null,
    geminiCredit: null,
    lowCreditToastShown: false,
    selectedJobId: null,
    qcJobId: null,
    qcJobDetail: null,
    qcScript: null,
    qcTimeline: null,
    socialJobId: null,
    socialAdapters: [],
    socialQueue: [],
    socialCalendar: [],
    socialDrafts: {}, // { [jobId]: { [platform]: { title, caption } } }
    pollTimer: null,
    learnTimer: null,
  };

  // ── Utilities ──────────────────────────────────────────────────────────────
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function encodeSubPath(rel) {
    return String(rel || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
  }

  function fmtSec(s) {
    const n = Math.max(0, Math.floor(Number(s || 0)));
    return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function toast(msg, type = 'ok') {
    const stack = $('toast-stack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (type === 'err' ? 'err' : type === 'warn' ? 'warn' : 'ok');
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  async function apiFetch(url, opts = {}) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...opts,
      headers: {
        ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {}),
      },
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) {}
    if (!res.ok) {
      const err = new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function styleThumbUrl(id) {
    const mtime = state.thumbManifest && state.thumbManifest[id] && state.thumbManifest[id].mtime;
    const v = mtime || state.thumbBust;
    return `/api/gemini/local-file?path=${encodeURIComponent(DATA.STYLE_THUMB_DIR + '/' + id + '.jpg')}&v=${encodeURIComponent(v)}`;
  }

  function styleArtUrl(id) {
    const item = state.artManifest && state.artManifest[id];
    if (!item) return null;
    const file = item.file || (id + '.jpg');
    const v = item.mtime || state.thumbBust;
    return `/api/gemini/local-file?path=${encodeURIComponent(DATA.STYLE_ART_DIR + '/' + file)}&v=${encodeURIComponent(v)}`;
  }

  function allStyles() {
    return [...state.customStyles, ...state.presets];
  }

  function findStyle(id) {
    return allStyles().find((s) => s.id === id) || allStyles()[0] || {
      id: id || 'look-3', thName: id || 'look-3', enName: id || 'look-3', category: 'ทั่วไป', summary: '',
    };
  }

  function extractPaletteColors(s) {
    const raw = s?.tokens?.palette ?? s?.palette ?? s?.colors;
    if (Array.isArray(raw) && raw.length) {
      const arr = raw.filter((v) => typeof v === 'string' && v.trim()).slice(0, 5);
      if (arr.length) return arr;
    }
    if (raw && typeof raw === 'object') {
      const ordered = [raw.bg, raw.bgSecondary, raw.accent, raw.accent2 || raw.cardBg, raw.fg]
        .filter((v) => typeof v === 'string' && v.trim());
      if (ordered.length) return ordered.slice(0, 5);
      const fallbackVals = Object.values(raw).filter((v) => typeof v === 'string' && /^#/.test(v.trim()));
      if (fallbackVals.length) return fallbackVals.slice(0, 5);
    }
    return ['#0f172a', '#1e293b', '#38bdf8', '#f6c453', '#eef2f7'];
  }

  function classifyJobCol(job) {
    if (job.factoryCol) return job.factoryCol;
    const status = String(job.status || '').toLowerCase();
    const qc = String(job.qcStatus || 'pending').toLowerCase();
    if (job.alive || ['researching', 'scripting', 'tts', 'rendering', 'mixing', 'previewing', 'editing', 'building', 'running'].includes(status)) {
      return 'running';
    }
    if (status === 'done' && qc === 'skipped') return 'kept';
    if (status === 'draft_ready' || (status === 'done' && qc === 'rejected')) return 'script';
    if (status === 'done') return qc === 'approved' ? 'ready' : 'qc';
    if (status === 'queued' && (job.deferredStart || !job.alive)) return 'queued';
    if (status === 'error' || status === 'aborted') return 'queued';
    return 'queued';
  }

  function mapStageToStep(job) {
    const failed = job.status === 'error' || job.status === 'aborted';
    const raw = String((failed && job.interruptedStage) || job.stage || job.status || '').toLowerCase();
    if (DATA.STAGE_TO_STEP && Object.prototype.hasOwnProperty.call(DATA.STAGE_TO_STEP, raw)) {
      return DATA.STAGE_TO_STEP[raw];
    }
    if (job.status === 'done') return 5;
    return 0;
  }

  function colLabel(col) {
    return ((DATA.COL_DEFS || []).find((c) => c.key === col) || {}).title || col;
  }

  function jobCostThb(job) {
    const val = job?.outputs?.costDetails?.clipTotalThb ?? job?.outputs?.costThb;
    return typeof val === 'number' && Number.isFinite(val) ? val : null;
  }

  function jobLatestVideoFile(job) {
    if (job?.outputs?.jobVideoFile) return job.outputs.jobVideoFile;
    if (job?.finalFile) return job.finalFile;
    if (Array.isArray(job?.versions) && job.versions.length) {
      const last = job.versions[job.versions.length - 1];
      return typeof last === 'string' ? last : (last?.file || null);
    }
    return null;
  }

  function normalizeVersionEntry(v, idx) {
    if (typeof v === 'string') return { file: v, label: `v${idx + 1} (${v})`, raw: null };
    const file = v?.file || 'final.mp4';
    const num = v?.version || (idx + 1);
    const kind = v?.kind ? ` · ${v.kind}` : '';
    const dur = Number(v?.durationSec) > 0 ? ` (${Number(v.durationSec).toFixed(1)}s)` : '';
    return {
      file,
      label: `v${num}${kind}${dur}`,
      raw: v,
    };
  }

  // ── Init Selects ───────────────────────────────────────────────────────────
  function populateStaticSelects() {
    const voicesHtml = (DATA.VOICE_OPTIONS || []).map((v) =>
      `<option value="${esc(v.value)}">${esc(v.label)}</option>`
    ).join('');
    $('order-voice').innerHTML = voicesHtml;
    $('new-line-voice').innerHTML = voicesHtml;

    const bgmHtml = (DATA.BGM_OPTIONS || []).map((b) =>
      `<option value="${esc(b.value)}">${esc(b.label)}</option>`
    ).join('');
    $('order-bgm').innerHTML = bgmHtml;
    $('qc-remix-bgm').innerHTML = bgmHtml;

    // Default news date = yesterday (local)
    const yest = new Date(Date.now() - 24 * 3600 * 1000);
    $('order-news-date').value = yest.toISOString().slice(0, 10);

    // Default schedule datetime = +2 hours
    const sched = new Date(Date.now() + 2 * 3600 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    $('social-schedule-dt').value = `${sched.getFullYear()}-${pad(sched.getMonth() + 1)}-${pad(sched.getDate())}T${pad(sched.getHours())}:00`;
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  function switchView(view) {
    state.view = view;
    document.querySelectorAll('.view-section').forEach((s) => s.classList.add('hidden'));
    const target = $('view-' + view);
    if (target) target.classList.remove('hidden');
    document.querySelectorAll('.rail-btn[data-view]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.view === view);
    });
    if (view === 'floor') renderFloor();
    if (view === 'order') renderOrderStyles();
    if (view === 'qc') loadQCJob(state.qcJobId);
    if (view === 'social') loadSocialHub();
    if (view === 'lines') renderLines();
    if (view === 'styles') renderStyleLab();
    if (view === 'archive') renderArchive();
  }

  document.querySelectorAll('.rail-btn[data-view]').forEach((b) => {
    b.addEventListener('click', () => switchView(b.dataset.view));
  });
  $('btn-goto-order').addEventListener('click', () => switchView('order'));
  document.querySelectorAll('.tally-pill[data-jump-col]').forEach((btn) => {
    btn.addEventListener('click', () => switchView('floor'));
  });

  // ── Top Telemetry: Credit & Workers ────────────────────────────────────────
  function renderCreditUI(gc) {
    if (!gc || !gc.ok) {
      $('credit-pill-label').textContent = 'เครดิต N/A';
      return;
    }
    state.geminiCredit = gc;
    const rem = Number(gc.remainingThb || 0);
    const lowThb = gc.lowThb !== undefined && gc.lowThb !== null ? Number(gc.lowThb) : 10;
    const isLow = rem < lowThb;
    const isWarn = !isLow && rem < 30;

    const pill = $('credit-pill');
    pill.className = 'credit-pill ' + (isLow ? 'is-low' : (isWarn ? 'is-warn' : 'is-ok'));
    $('credit-pill-label').textContent = isLow ? `฿${rem.toFixed(2)} ⚠️ ใกล้หมด` : `~฿${rem.toFixed(2)}`;
    pill.title = `ตั้งต้น ฿${Number(gc.baselineThb || 0).toFixed(2)} · ใช้ไป ฿${Number(gc.spentThb || 0).toFixed(2)} (${gc.calls || 0} ครั้ง) · เตือนเมื่อต่ำกว่า ฿${lowThb}`;

    if (isLow) {
      $('low-credit-banner').classList.remove('hidden');
      $('low-credit-msg').textContent = `คงเหลือประมาณ ฿${rem.toFixed(2)} (ต่ำกว่าเกณฑ์ ฿${lowThb.toFixed(0)}) — สลับไปใช้ Edge TTS (ฟรี ฿0) ได้ทันที`;
      if (!state.lowCreditToastShown) {
        state.lowCreditToastShown = true;
        toast(`⚠️ เครดิต Gemini API เหลือ ~฿${rem.toFixed(2)} (ต่ำกว่า ฿${lowThb})`, 'warn');
      }
    } else {
      $('low-credit-banner').classList.add('hidden');
    }
  }

  function renderWorkersUI(w) {
    const workers = w || { onlineCount: 0, totalCount: 0, nodes: [] };
    state.workers = workers;
    const pill = $('btn-worker-pop');
    const onlineNodes = (workers.nodes || []).filter((n) => n.online);
    if (onlineNodes.length > 0) {
      const lead = onlineNodes[0];
      const gpu = lead.specs?.gpuName ? ` · ${lead.specs.gpuName}` : '';
      pill.className = 'worker-pill is-online';
      $('worker-pill-label').textContent = `${lead.alias || lead.nodeId}${gpu} (${onlineNodes.length} ออนไลน์)`;
      $('order-est-worker').textContent = lead.alias || lead.nodeId;
    } else {
      pill.className = 'worker-pill is-offline';
      $('worker-pill-label').textContent = workers.totalCount > 0 ? `0/${workers.totalCount} Worker ออนไลน์` : 'ไม่พบ Worker (Local Fallback)';
      $('order-est-worker').textContent = 'homelab (Fallback)';
    }

    const body = $('worker-popover-body');
    if (!workers.nodes || !workers.nodes.length) {
      body.innerHTML = `<div class="sub-muted" style="margin-top:8px;">ยังไม่มีเครื่องลูกข่ายเชื่อมต่อใน Agent Hub</div>`;
      return;
    }
    body.innerHTML = workers.nodes.map((n) => {
      const cpu = n.metrics?.cpuPct ?? 0;
      const ram = n.specs?.ramGb ? `${n.specs.ramGb} GB RAM` : '';
      const gpu = n.specs?.gpuName ? `${n.specs.gpuName}${n.specs.hasNvenc ? ' [NVENC]' : ''}` : 'CPU';
      return `
        <div class="worker-node-card ${n.online ? 'is-on' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <b>${esc(n.alias || n.nodeId)}</b>
            <span class="badge ${n.online ? 'emerald' : ''}">${n.online ? '🟢 ONLINE' : '⚪ OFFLINE'}</span>
          </div>
          <div class="sub-muted mono" style="margin-top:3px;">${esc(gpu)}${ram ? ' · ' + esc(ram) : ''}</div>
          ${n.online ? `<div class="sub-muted mono" style="margin-top:3px;">CPU: ${cpu}% · RAM: ${n.metrics?.memUsedPct ?? '—'}%</div><div class="worker-bar"><span style="width:${Math.min(100, Math.max(4, cpu))}%;"></span></div>` : ''}
        </div>
      `;
    }).join('');
  }

  $('btn-worker-pop').addEventListener('click', (e) => {
    e.stopPropagation();
    $('worker-popover').classList.toggle('hidden');
  });
  $('btn-close-worker-pop').addEventListener('click', () => $('worker-popover').classList.add('hidden'));
  document.addEventListener('click', (e) => {
    const pop = $('worker-popover');
    if (!pop.classList.contains('hidden') && !pop.contains(e.target) && !e.target.closest('#btn-worker-pop')) {
      pop.classList.add('hidden');
    }
  });

  $('btn-switch-edge-global').addEventListener('click', () => {
    $('order-voice').value = 'edge:th-TH-PremwadeeNeural';
    updateOrderEstimate();
    toast('สลับเสียงพากย์เป็น Edge TTS (ฟรี ฿0) แล้วค่ะ', 'ok');
  });

  // ── Load Factory State (with graceful legacy fallback) ─────────────────────
  async function refreshFactoryState(silent = true) {
    try {
      const data = await apiFetch('/api/video-studio/factory/state');
      state.factoryApiAvailable = true;
      $('api-reload-banner').classList.add('hidden');

      state.jobs = Array.isArray(data.jobs) ? data.jobs : [];
      state.lines = Array.isArray(data.lines) ? data.lines : [];
      state.analytics = data.analytics || null;
      if (data.prefs && Array.isArray(data.prefs.favoriteStyles)) {
        state.favoriteStyles = new Set(data.prefs.favoriteStyles);
      }
      renderWorkersUI(data.workers);
      if (data.geminiCredit) renderCreditUI(data.geminiCredit);
      if (data.status && data.status.freeRamMb) {
        $('rail-ram-label').textContent = `RAM ว่าง: ${(data.status.freeRamMb / 1024).toFixed(1)} / ${(data.status.totalRamMb / 1024).toFixed(1)} GB`;
      }
      $('engine-live-tag').textContent = data.status?.busy ? 'RUNNING' : 'LIVE';
    } catch (err) {
      if (err.status === 404) {
        state.factoryApiAvailable = false;
        $('api-reload-banner').classList.remove('hidden');
        // Fallback to legacy Video Studio APIs so page remains 100% functional
        const [jobsRes, statusRes] = await Promise.all([
          apiFetch('/api/video-studio/jobs').catch(() => ({ jobs: [] })),
          apiFetch('/api/video-studio/status').catch(() => ({})),
        ]);
        state.jobs = (jobsRes.jobs || []).map((j) => ({
          ...j,
          factoryCol: classifyJobCol(j),
          lineName: String(j.id || '').startsWith('daily-news-') ? 'ข่าวเช้า Broadcast v2' : 'สั่งอิสระ',
        }));
        if (statusRes.geminiCredit) renderCreditUI(statusRes.geminiCredit);
        if (statusRes.freeRamMb) {
          $('rail-ram-label').textContent = `RAM ว่าง: ${(statusRes.freeRamMb / 1024).toFixed(1)} / ${(statusRes.totalRamMb / 1024).toFixed(1)} GB`;
        }
      } else if (!silent) {
        toast(`โหลดข้อมูลสายพานไม่สำเร็จ: ${err.message}`, 'err');
      }
    }

    updateLineFilterOptions();
    updateCounters();
    if (state.view === 'floor') renderFloor();
    if (state.view === 'lines') renderLines();
    if (state.view === 'archive') renderArchive();
  }

  function updateLineFilterOptions() {
    const sel = $('floor-line-filter');
    const prev = sel.value || 'all';
    const names = [...new Set(state.jobs.map((j) => j.lineName || 'สั่งอิสระ'))];
    sel.innerHTML = `<option value="all">ทุกสายการผลิต</option>` + names.map((n) =>
      `<option value="${esc(n)}">${esc(n)}</option>`
    ).join('');
    sel.value = names.includes(prev) ? prev : 'all';
  }

  function updateCounters() {
    const c = { running: 0, queued: 0, script: 0, qc: 0, ready: 0, kept: 0 };
    for (const j of state.jobs) {
      const col = classifyJobCol(j);
      c[col] = (c[col] || 0) + 1;
    }
    $('cnt-running').textContent = c.running;
    $('cnt-queued').textContent = c.queued;
    $('cnt-qc').textContent = c.qc;
    $('cnt-ready').textContent = c.ready;
    if ($('cnt-kept')) $('cnt-kept').textContent = c.kept;
    $('rail-floor-cnt').textContent = state.jobs.length;
    $('rail-qc-cnt').textContent = c.qc + c.script;
    $('rail-social-cnt').textContent = c.ready;
    $('rail-lines-cnt').textContent = state.lines.length || 3;
  }

  $('btn-retry-factory-api').addEventListener('click', () => refreshFactoryState(false));
  $('btn-refresh-floor').addEventListener('click', () => {
    refreshFactoryState(false);
    toast('รีเฟรชสายพานแล้วค่ะ', 'ok');
  });

  // ── VIEW 1: FACTORY FLOOR ──────────────────────────────────────────────────
  function renderFloor() {
    const q = $('floor-search').value.trim().toLowerCase();
    const lineFilter = $('floor-line-filter').value;
    const filtered = state.jobs.filter((j) => {
      const ln = j.lineName || 'สั่งอิสระ';
      if (lineFilter !== 'all' && ln !== lineFilter) return false;
      if (!q) return true;
      return String(j.title || j.topic || '').toLowerCase().includes(q)
        || String(j.id || '').toLowerCase().includes(q)
        || String(j.styleId || '').toLowerCase().includes(q);
    });

    if (state.floorMode === 'kanban') {
      $('floor-kanban').classList.remove('hidden');
      $('floor-table-wrap').classList.add('hidden');
      $('floor-kanban').innerHTML = (DATA.COL_DEFS || []).map((col) => {
        const items = filtered.filter((j) => classifyJobCol(j) === col.key);
        const cardsHtml = items.length ? items.map((j) => {
          const stepIdx = mapStageToStep(j);
          const isErr = j.status === 'error' || j.status === 'aborted';
          const stepsHtml = (DATA.STEPS || []).map((_, i) => {
            let cls = '';
            if (j.status === 'done' || i < stepIdx) cls = 'done';
            else if (i === stepIdx) cls = isErr ? 'err' : (col.key === 'running' ? 'active' : '');
            return `<span class="mini-step ${cls}"></span>`;
          }).join('');

          const sbFile = j.outputs?.storyboardFile || j.storyboardFile;
          const gifFile = j.outputs?.gifFile || j.gifFile;
          const thumbSrc = sbFile
            ? `/api/video-studio/file/${encodeURIComponent(j.id)}/${encodeSubPath(sbFile)}`
            : (j.styleId ? styleThumbUrl(j.styleId) : '');
          const gifSrc = gifFile ? `/api/video-studio/file/${encodeURIComponent(j.id)}/${encodeSubPath(gifFile)}` : '';

          const cost = jobCostThb(j);
          const verCount = Array.isArray(j.versions) && j.versions.length ? j.versions.length : 1;
          const workerLabel = j.renderNode || j.outputs?.renderNode || (col.key === 'queued' ? 'คิวรอ' : '—');
          const dur = Math.round(Number(j.outputs?.durationSec ?? j.durationSec ?? 0));

          const soc = j.social || {};
          const socialChips = col.key === 'ready'
            ? `<div style="display:flex;gap:4px;flex-wrap:wrap;">
                ${['telegram', 'youtube', 'tiktok'].map((pk) => {
                  const s = soc[pk] || '';
                  const short = pk === 'telegram' ? 'TG' : pk === 'youtube' ? 'YT' : 'TT';
                  return `<span class="badge ${s === 'posted' ? 'emerald' : s === 'scheduled' ? 'cyan' : ''}">${short} ${s === 'posted' ? '✓' : s === 'scheduled' ? '⏳' : '·'}</span>`;
                }).join('')}
              </div>`
            : '';

          let quickAction = '';
          if (isErr && !j.alive) {
            quickAction = `<button type="button" class="btn btn-amber btn-xs" data-resume-job="${esc(j.id)}">▶ ทำงานต่อ</button>`;
          } else if (col.key === 'qc') {
            quickAction = `<button type="button" class="btn btn-amber btn-xs" data-open-qc="${esc(j.id)}">🔍 ตรวจ QC</button><button type="button" class="btn btn-xs" data-skip-qc="${esc(j.id)}">✔️ ผ่าน (ไม่โพสต์)</button>`;
          } else if (col.key === 'script') {
            quickAction = `<button type="button" class="btn btn-cyan btn-xs" data-open-qc="${esc(j.id)}">📝 ตรวจบท</button>`;
          } else if (col.key === 'ready') {
            quickAction = `<button type="button" class="btn btn-emerald btn-xs" data-open-social="${esc(j.id)}">📤 โพสต์</button>`;
          } else if (col.key === 'kept') {
            quickAction = `<button type="button" class="btn btn-xs" data-unskip-qc="${esc(j.id)}">↩️ ส่งตรวจ QC</button><button type="button" class="btn btn-emerald btn-xs" data-open-social="${esc(j.id)}">📤 โพสต์</button>`;
          } else if (col.key === 'running') {
            quickAction = `<button type="button" class="btn btn-rose btn-xs" data-abort-job="${esc(j.id)}">⏹ ยกเลิก</button>`;
          }

          return `
            <article class="job-card ${state.selectedJobId === j.id ? 'is-selected' : ''} ${isErr ? 'is-error' : ''}" data-job-card="${esc(j.id)}">
              <div class="job-thumb-strip">
                ${thumbSrc ? `<img class="job-thumb-bg" loading="lazy" src="${thumbSrc}" alt="" onerror="this.style.display='none'" />` : ''}
                ${gifSrc ? `<img class="job-hover-gif" loading="lazy" src="${gifSrc}" alt="" onerror="this.style.display='none'" />` : ''}
                <div class="job-thumb-badges">
                  <span class="badge mono">${esc(j.styleId || '—')} · ${dur}s</span>
                  <span class="badge ${isErr ? 'rose' : verCount > 1 ? 'amber' : ''} mono">${isErr ? (j.status === 'aborted' ? 'ยกเลิก' : 'ผิดพลาด') : 'v' + verCount}</span>
                </div>
              </div>
              <div class="job-title">${esc(j.title || j.topic || j.id)}</div>
              <div class="job-meta-row mono">
                <span>${esc(j.lineName || 'สั่งอิสระ')}</span>
                <span>· 🖥️ ${esc(workerLabel)}</span>
                ${cost !== null ? `<span>· ${cost > 0 ? '฿' + cost.toFixed(2) : 'ฟรี ฿0'}</span>` : ''}
              </div>
              <div class="mini-stepper" title="6 ด่านการผลิต">${stepsHtml}</div>
              ${col.key === 'running' ? `<div class="mini-progress"><span style="width:${Math.max(4, Number(j.progress || 0))}%"></span></div><div class="sub-muted mono">${esc(j.message || j.stage || 'กำลังผลิต')} (${Number(j.progress || 0)}%)</div>` : ''}
              ${isErr ? `<div class="sub-muted" style="color:#FECDD3;">⚠️ ${esc(j.error || j.message || 'งานหยุดชะงัก')}</div>` : ''}
              ${socialChips}
              <div class="card-actions">
                ${quickAction}
                <button type="button" class="btn btn-xs" data-inspect-job="${esc(j.id)}">รายละเอียด</button>
              </div>
            </article>
          `;
        }).join('') : `<div class="sub-muted" style="text-align:center;padding:24px 8px;border:1px dashed var(--line);border-radius:8px;">ไม่มีงานในด่านนี้</div>`;

        return `
          <div class="conveyor-col ${col.cls}">
            <div class="col-head">
              <div class="col-title">${esc(col.title)}</div>
              <span class="badge mono">${items.length}</span>
            </div>
            ${cardsHtml}
          </div>
        `;
      }).join('');
    } else {
      $('floor-kanban').classList.add('hidden');
      $('floor-table-wrap').classList.remove('hidden');
      $('floor-table-body').innerHTML = filtered.map((j) => {
        const col = classifyJobCol(j);
        const cost = jobCostThb(j);
        return `
          <tr>
            <td class="mono">${esc(j.id)}</td>
            <td><b>${esc(j.title || j.topic || j.id)}</b></td>
            <td>${esc(j.lineName || 'สั่งอิสระ')} <span class="badge mono">${esc(j.styleId || '—')}</span></td>
            <td><span class="badge ${col === 'qc' ? 'amber' : col === 'running' ? 'cyan' : col === 'ready' ? 'emerald' : col === 'kept' ? 'slate' : ''}">${esc(colLabel(col))}</span></td>
            <td class="mono">${esc(j.renderNode || j.outputs?.renderNode || '—')}</td>
            <td class="mono">${cost !== null ? (cost > 0 ? '฿' + cost.toFixed(2) : 'ฟรี ฿0') : '—'}</td>
            <td>
              <div style="display:flex;gap:5px;flex-wrap:wrap;">
                <button type="button" class="btn btn-xs" data-inspect-job="${esc(j.id)}">ดู</button>
                <button type="button" class="btn btn-xs btn-amber" data-open-qc="${esc(j.id)}">QC</button>
                ${j.status === 'done' && !['approved', 'skipped'].includes(j.qcStatus) ? `<button type="button" class="btn btn-xs" data-skip-qc="${esc(j.id)}" title="ผ่านเลย ไม่ต้องโพสต์">✔️</button>` : ''}
                ${j.status === 'done' ? `<button type="button" class="btn btn-xs btn-emerald" data-open-social="${esc(j.id)}">โพสต์</button>` : ''}
              </div>
            </td>
          </tr>
        `;
      }).join('') || `<tr><td colspan="7" class="sub-muted" style="text-align:center;">ยังไม่มีงานในสายพาน</td></tr>`;
    }

    // Bind floor interactions
    document.querySelectorAll('[data-job-card]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        openDrawer(el.dataset.jobCard);
      });
    });
    document.querySelectorAll('[data-inspect-job]').forEach((b) => {
      b.addEventListener('click', () => openDrawer(b.dataset.inspectJob));
    });
    document.querySelectorAll('[data-open-qc]').forEach((b) => {
      b.addEventListener('click', () => {
        state.qcJobId = b.dataset.openQc;
        switchView('qc');
      });
    });
    document.querySelectorAll('[data-open-social]').forEach((b) => {
      b.addEventListener('click', () => {
        state.socialJobId = b.dataset.openSocial;
        switchView('social');
      });
    });
    document.querySelectorAll('[data-resume-job]').forEach((b) => {
      b.addEventListener('click', () => resumeJobById(b.dataset.resumeJob));
    });
    document.querySelectorAll('[data-abort-job]').forEach((b) => {
      b.addEventListener('click', () => abortJobById(b.dataset.abortJob));
    });
    document.querySelectorAll('[data-skip-qc]').forEach((b) => {
      b.addEventListener('click', () => setJobQcQuick(b.dataset.skipQc, 'skipped'));
    });
    document.querySelectorAll('[data-unskip-qc]').forEach((b) => {
      b.addEventListener('click', () => setJobQcQuick(b.dataset.unskipQc, 'pending'));
    });
  }

  $('floor-search').addEventListener('input', renderFloor);
  $('floor-line-filter').addEventListener('change', renderFloor);
  document.querySelectorAll('[data-floor-mode]').forEach((b) => {
    b.addEventListener('click', () => {
      state.floorMode = b.dataset.floorMode;
      document.querySelectorAll('[data-floor-mode]').forEach((x) => x.classList.toggle('is-active', x === b));
      renderFloor();
    });
  });

  async function resumeJobById(jobId) {
    try {
      const r = await apiFetch(`/api/video-studio/jobs/${encodeURIComponent(jobId)}/resume`, { method: 'POST' });
      toast(`▶ เริ่มทำงานต่อจากขั้น ${r.resumedFrom || 'เดิม'} แล้วค่ะ`, 'ok');
      refreshFactoryState(true);
    } catch (e) {
      toast(`ทำงานต่อไม่สำเร็จ: ${e.message}`, 'err');
    }
  }

  async function abortJobById(jobId) {
    try {
      await apiFetch(`/api/video-studio/jobs/${encodeURIComponent(jobId)}/abort`, { method: 'POST' });
      toast('⏹ ส่งคำสั่งยกเลิกงานแล้วค่ะ', 'warn');
      refreshFactoryState(true);
    } catch (e) {
      toast(`ยกเลิกงานไม่สำเร็จ: ${e.message}`, 'err');
    }
  }

  async function deleteJobById(jobId) {
    if (!confirm(`ยืนยันลบงาน ${jobId} ออกจากดิสก์ถาวร?`)) return;
    try {
      await apiFetch(`/api/video-studio/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
      toast(`🗑 ลบงาน ${jobId} แล้วค่ะ`, 'ok');
      closeDrawer();
      refreshFactoryState(true);
    } catch (e) {
      toast(`ลบงานไม่สำเร็จ: ${e.message}`, 'err');
    }
  }

  // ── RIGHT INSPECTOR DRAWER ─────────────────────────────────────────────────
  async function openDrawer(jobId) {
    state.selectedJobId = jobId;
    $('drawer-backdrop').classList.remove('hidden');
    $('drawer-title').textContent = 'กำลังโหลด...';
    $('drawer-id').textContent = jobId;
    $('drawer-body').innerHTML = `<div class="sub-muted">กำลังโหลดรายละเอียดงาน...</div>`;

    try {
      const detail = await apiFetch(`/api/video-studio/jobs/${encodeURIComponent(jobId)}`);
      const j = detail.job || detail;
      const col = classifyJobCol(j);
      const stepIdx = mapStageToStep(j);
      const isErr = j.status === 'error' || j.status === 'aborted';
      const cost = jobCostThb(j);
      const videoFile = jobLatestVideoFile(j);
      const dlUrl = videoFile ? `/api/video-studio/file/${encodeURIComponent(j.id)}/${encodeSubPath(videoFile)}?download=1` : '';

      $('drawer-title').textContent = j.title || j.topic || j.id;
      $('drawer-id').textContent = `${j.id} · ${j.styleId || '—'} · ${fmtDateTime(j.updatedAt || j.createdAt)}`;

      const stepsHtml = (DATA.STEPS || []).map((st, i) => {
        const cls = (j.status === 'done' || i < stepIdx) ? 'emerald' : (i === stepIdx ? (isErr ? 'rose' : 'cyan') : '');
        return `<span class="badge ${cls}">${i + 1}. ${esc(st.label)}</span>`;
      }).join('');

      const nodePairs = [
        ['เรนเดอร์', j.renderNode || j.outputs?.renderNode],
        ['มิกซ์', j.mixNode || j.outputs?.mixNode],
        ['พรีวิว', j.previewNode || j.outputs?.previewNode],
      ].filter(([, v]) => Boolean(v));

      $('drawer-body').innerHTML = `
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <span class="badge amber">${esc(colLabel(col))}</span>
          <span class="badge mono">${Math.round(Number(j.outputs?.durationSec ?? j.durationSec ?? 0))}s</span>
          <span class="badge mono">QC: ${esc(j.qcStatus || 'pending')}</span>
          ${cost !== null ? `<span class="badge emerald mono">💸 ${cost > 0 ? '฿' + cost.toFixed(2) : 'ฟรี ฿0'}</span>` : ''}
        </div>
        ${j.message ? `<div class="sub-muted" style="color:var(--ink-2);">${esc(j.message)}</div>` : ''}
        ${j.error ? `<div class="badge rose" style="white-space:normal;border-radius:8px;padding:7px 9px;">⚠️ ${esc(j.error)}</div>` : ''}
        <div>
          <div class="sub-muted" style="font-weight:700;margin-bottom:6px;">ความคืบหน้า 6 ด่าน</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;">${stepsHtml}</div>
        </div>
        ${nodePairs.length ? `
          <div>
            <div class="sub-muted" style="font-weight:700;margin-bottom:6px;">เครื่องที่ประมวลผล (Agent Hub)</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${nodePairs.map(([k, v]) => `<span class="badge cyan mono">${esc(k)}: ${esc(v)}</span>`).join('')}
            </div>
          </div>` : ''}
        <div>
          <div class="sub-muted" style="font-weight:700;margin-bottom:6px;">บันทึกการทำงานล่าสุด (Log Tail)</div>
          <pre class="log-box">${esc(Array.isArray(detail.logTail) && detail.logTail.length ? detail.logTail.join('\n') : 'ไม่มีบันทึก')}</pre>
        </div>
      `;

      $('drawer-foot').innerHTML = `
        <button type="button" class="btn btn-amber btn-sm" id="dr-open-qc">🔍 เปิดห้อง QC / แก้บท</button>
        ${j.status === 'done' && j.qcStatus !== 'skipped' ? `<button type="button" class="btn btn-sm" id="dr-skip-qc">✔️ ผ่าน (ไม่โพสต์)</button>` : ''}
        ${j.status === 'done' && j.qcStatus === 'skipped' ? `<button type="button" class="btn btn-sm" id="dr-unskip-qc">↩️ ส่งกลับรอ QC</button>` : ''}
        ${j.status === 'done' ? `<button type="button" class="btn btn-emerald btn-sm" id="dr-open-social">📤 ศูนย์โพสต์</button>` : ''}
        ${j.status === 'done' ? `<a class="btn btn-sm" href="/video-editor.html?job=${encodeURIComponent(j.id)}" target="_blank">✂️ 6-Track Editor</a>` : ''}
        ${dlUrl ? `<a class="btn btn-sm" href="${dlUrl}" download>⬇ โหลด Master</a>` : ''}
        ${(isErr && !j.alive) ? `<button type="button" class="btn btn-cyan btn-sm" id="dr-resume">▶ ทำงานต่อ</button>` : ''}
        ${j.alive ? `<button type="button" class="btn btn-rose btn-sm" id="dr-abort">⏹ ยกเลิก</button>` : `<button type="button" class="btn btn-rose btn-sm" id="dr-delete">🗑 ลบ</button>`}
      `;

      $('dr-open-qc').onclick = () => { closeDrawer(); state.qcJobId = j.id; switchView('qc'); };
      const btnSkip = $('dr-skip-qc');
      if (btnSkip) btnSkip.onclick = () => { closeDrawer(); setJobQcQuick(j.id, 'skipped'); };
      const btnUnskip = $('dr-unskip-qc');
      if (btnUnskip) btnUnskip.onclick = () => { closeDrawer(); setJobQcQuick(j.id, 'pending'); };
      const btnSoc = $('dr-open-social');
      if (btnSoc) btnSoc.onclick = () => { closeDrawer(); state.socialJobId = j.id; switchView('social'); };
      const btnRes = $('dr-resume');
      if (btnRes) btnRes.onclick = () => { resumeJobById(j.id); closeDrawer(); };
      const btnAb = $('dr-abort');
      if (btnAb) btnAb.onclick = () => { abortJobById(j.id); closeDrawer(); };
      const btnDel = $('dr-delete');
      if (btnDel) btnDel.onclick = () => deleteJobById(j.id);
    } catch (e) {
      $('drawer-body').innerHTML = `<div class="badge rose">โหลดรายละเอียดไม่สำเร็จ: ${esc(e.message)}</div>`;
    }
  }

  function closeDrawer() {
    $('drawer-backdrop').classList.add('hidden');
  }
  $('btn-close-drawer').addEventListener('click', closeDrawer);
  $('drawer-backdrop').addEventListener('click', (e) => {
    if (e.target === $('drawer-backdrop')) closeDrawer();
  });

  // ── STYLES LOADING & RENDERING ─────────────────────────────────────────────
  async function loadStyles() {
    state.thumbBust = Math.floor(Date.now() / 3600000);
    const fetchManifest = async (manifestPath) => {
      try {
        const res = await fetch(`/api/gemini/local-file?path=${encodeURIComponent(manifestPath)}&v=${state.thumbBust}`);
        if (res.ok) {
          const d = await res.json();
          if (d && d.items) return d.items;
        }
      } catch (_) {}
      return null;
    };
    const [thumbItems, artItems] = await Promise.all([
      fetchManifest(DATA.STYLE_THUMB_DIR + '/manifest.json'),
      fetchManifest(DATA.STYLE_ART_DIR + '/manifest.json'),
    ]);
    if (thumbItems) state.thumbManifest = thumbItems;
    if (artItems) state.artManifest = artItems;

    try {
      const data = await apiFetch('/api/video-studio/styles');
      state.presets = Array.isArray(data?.presets) ? data.presets : [];
      state.customStyles = Array.isArray(data?.custom) ? data.custom : [];
      const total = state.presets.length + state.customStyles.length;
      $('rail-styles-cnt').textContent = total ? String(total) : '46+';
      $('order-style-count').textContent = `${total} สไตล์`;
      if (!state.selectedStyleId && state.presets.length) {
        state.selectedStyleId = state.presets[0].id;
      }
      renderOrderStyles();
      if (state.view === 'styles') renderStyleLab();
    } catch (e) {
      toast(`โหลดรายการสไตล์ไม่สำเร็จ: ${e.message}`, 'err');
    }
  }

  async function toggleFavorite(styleId) {
    const had = state.favoriteStyles.has(styleId);
    if (had) state.favoriteStyles.delete(styleId);
    else state.favoriteStyles.add(styleId);
    renderOrderStyles();
    if (state.view === 'styles') renderStyleLab();

    if (state.factoryApiAvailable) {
      try {
        await apiFetch('/api/video-studio/factory/favorites/toggle', {
          method: 'POST',
          body: JSON.stringify({ styleId }),
        });
      } catch (_) {}
    }
  }

  function renderStyleCards(containerId, searchId, onPick, useCatFilter = false) {
    const q = ($(searchId)?.value || '').trim().toLowerCase();
    const list = allStyles().filter((s) => {
      if (useCatFilter && state.orderStyleCat !== 'ทั้งหมด') {
        if (state.orderStyleCat === '⭐ ที่ติดดาว' && !state.favoriteStyles.has(s.id)) return false;
        if (state.orderStyleCat !== '⭐ ที่ติดดาว' && s.category !== state.orderStyleCat) return false;
      }
      if (!q) return true;
      return [s.thName, s.enName, s.id, s.category, s.summary].some((v) => String(v || '').toLowerCase().includes(q));
    });

    $(containerId).innerHTML = list.map((s) => {
      const pal = extractPaletteColors(s);
      const isSel = s.id === state.selectedStyleId;
      const isFav = state.favoriteStyles.has(s.id);
      return `
        <button type="button" class="style-card ${isSel ? 'is-selected' : ''}" data-sid="${esc(s.id)}">
          <div class="style-card-media" style="--s-bg:${esc(pal[0] || '#0f172a')};--s-bg2:${esc(pal[1] || pal[0] || '#1e293b')};">
            <img loading="lazy" src="${styleThumbUrl(s.id)}" alt="${esc(s.thName)}" onerror="this.parentElement.classList.add('is-missing')" />
            <div class="style-card-fallback">
              <div style="width:55%;height:7px;border-radius:4px;background:${esc(pal[2] || '#38bdf8')};"></div>
              <div style="font-size:10px;color:${esc(pal[4] || pal[3] || '#eef2f7')};opacity:0.85;">${esc(s.enName)}</div>
            </div>
            <span class="style-zoom-btn" data-zoom-sid="${esc(s.id)}" title="ดูภาพใหญ่">⤢</span>
            <span class="style-fav-btn" data-fav-sid="${esc(s.id)}" title="ติดดาว">${isFav ? '⭐' : '☆'}</span>
            <div class="style-card-overlay">
              <div class="swatch-row">${pal.map((c) => `<span class="swatch" style="background:${esc(c)}"></span>`).join('')}</div>
              <div style="font-size:12px;font-weight:700;color:#fff;line-height:1.25;">${esc(s.thName)}</div>
              <div style="font-size:10px;color:rgba(255,255,255,0.72);">${esc(s.id)}</div>
            </div>
          </div>
        </button>
      `;
    }).join('') || `<div class="sub-muted">ไม่พบสไตล์ที่ตรงกับคำค้น</div>`;

    $(containerId).querySelectorAll('[data-sid]').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-fav-sid]') || e.target.closest('[data-zoom-sid]')) return;
        onPick(card.dataset.sid);
      });
    });
    $(containerId).querySelectorAll('[data-fav-sid]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(btn.dataset.favSid);
      });
    });
    $(containerId).querySelectorAll('[data-zoom-sid]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openStyleModal(btn.dataset.zoomSid);
      });
    });
  }

  // ── VIEW 2: ORDER & BATCH COMPOSER ─────────────────────────────────────────
  function renderOrderStyles() {
    const cats = ['ทั้งหมด', '⭐ ที่ติดดาว', ...new Set(allStyles().map((s) => s.category).filter(Boolean))];
    $('order-style-cats').innerHTML = cats.map((c) =>
      `<button type="button" class="btn btn-xs ${state.orderStyleCat === c ? 'btn-amber' : ''}" data-ocat="${esc(c)}">${esc(c)}</button>`
    ).join('');
    $('order-style-cats').querySelectorAll('[data-ocat]').forEach((b) => {
      b.addEventListener('click', () => { state.orderStyleCat = b.dataset.ocat; renderOrderStyles(); });
    });
    renderStyleCards('order-style-grid', 'order-style-search', (sid) => {
      state.selectedStyleId = sid;
      renderOrderStyles();
      updateOrderPreview();
    }, true);
    updateOrderPreview();
    updateOrderEstimate();
  }

  function updateOrderPreview() {
    const s = findStyle(state.selectedStyleId);
    $('order-preview-img').src = styleThumbUrl(s.id);
    $('order-preview-name').textContent = s.thName || s.id;
    $('order-preview-id').textContent = `${s.id} · ${s.category || 'ทั่วไป'}`;
    $('order-preview-desc').textContent = s.summary || '';
  }

  function updateOrderEstimate() {
    const dur = Number($('order-dur').value || 45);
    $('order-dur-label').textContent = `${dur} วินาที`;
    let count = 1;
    if (state.orderMode === 'batch') {
      const lines = $('order-batch-topics').value.split(/\r?\n/).map((x) => x.trim()).filter((x) => x.length >= 2);
      count = Math.max(1, lines.length);
      $('batch-count-hint').textContent = `ตรวจพบ ${lines.length} คลิปในชุดนี้ (รันทีละ 1 งานตามคิว)`;
    }
    const isFree = ($('order-voice').value || '').startsWith('edge:');
    const perClip = isFree ? 0 : Math.max(0.18, (dur / 45) * 0.38);
    $('order-est-count').textContent = `${count} คลิป`;
    $('order-est-cost').textContent = isFree ? '฿0.00 (ฟรี)' : `~฿${(perClip * count).toFixed(2)}`;
    $('order-est-cost').style.color = isFree ? 'var(--emerald)' : 'var(--amber)';
  }

  $('order-style-search').addEventListener('input', renderOrderStyles);
  $('order-dur').addEventListener('input', updateOrderEstimate);
  $('order-voice').addEventListener('change', updateOrderEstimate);
  $('order-batch-topics').addEventListener('input', updateOrderEstimate);

  document.querySelectorAll('#order-mode-tabs [data-omode]').forEach((b) => {
    b.addEventListener('click', () => {
      state.orderMode = b.dataset.omode;
      document.querySelectorAll('#order-mode-tabs [data-omode]').forEach((x) => x.classList.toggle('is-active', x === b));
      ['single', 'batch', 'news'].forEach((m) => $('omode-' + m).classList.toggle('hidden', m !== state.orderMode));
      if (state.orderMode === 'news') {
        state.selectedStyleId = 'look-32';
        $('order-dur').value = 210;
        renderOrderStyles();
      }
      updateOrderEstimate();
    });
  });

  document.querySelectorAll('[data-starter]').forEach((b) => {
    b.addEventListener('click', () => { $('order-topic').value = b.dataset.starter; });
  });
  document.querySelectorAll('[data-recipe]').forEach((b) => {
    b.addEventListener('click', () => {
      const r = b.dataset.recipe;
      if (r === 'news') { state.selectedStyleId = 'look-32'; $('order-dur').value = 210; $('order-bgm').value = 'warm_tech'; }
      if (r === 'tech') { state.selectedStyleId = 'look-3'; $('order-dur').value = 45; $('order-bgm').value = 'warm_tech'; }
      if (r === 'story') { state.selectedStyleId = 'look-1'; $('order-dur').value = 60; $('order-bgm').value = 'story_cinematic'; }
      renderOrderStyles();
      toast('โหลดสูตรสายการผลิตแล้วค่ะ', 'ok');
    });
  });

  $('btn-submit-order').addEventListener('click', async () => {
    const btn = $('btn-submit-order');
    const stopGate = document.querySelector('input[name="stopgate"]:checked')?.value || 'qc';
    const voice = $('order-voice').value;
    const bgm = $('order-bgm').value;
    const durationSec = Number($('order-dur').value || 45);
    const notes = $('order-notes').value.trim() || undefined;
    const sendTelegram = $('order-send-tg').checked;

    const payload = {
      orderMode: state.orderMode,
      styleId: state.selectedStyleId,
      durationSec,
      voice,
      bgm,
      notes,
      stopGate,
      sendTelegram,
    };

    if (state.orderMode === 'single') {
      const topic = $('order-topic').value.trim();
      if (topic.length < 2) { toast('กรุณาพิมพ์หัวข้อวิดีโออย่างน้อย 2 ตัวอักษร', 'err'); return; }
      payload.topic = topic;
    } else if (state.orderMode === 'batch') {
      const topics = $('order-batch-topics').value.split(/\r?\n/).map((x) => x.trim()).filter((x) => x.length >= 2);
      if (!topics.length) { toast('กรุณาใส่หัวข้ออย่างน้อย 1 บรรทัด', 'err'); return; }
      payload.topics = topics;
    } else if (state.orderMode === 'news') {
      payload.newsDate = $('order-news-date').value || undefined;
    }

    btn.disabled = true;
    try {
      if (state.factoryApiAvailable) {
        const res = await apiFetch('/api/video-studio/factory/orders', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast(`🚀 ${res.message || 'ส่งเข้าสายพานผลิตเรียบร้อยแล้ว!'}`, 'ok');
      } else {
        if (state.orderMode !== 'single') {
          throw new Error('โหมด Batch / ข่าวประจำวัน v2 ต้องสั่ง pm2 reload lab-dashboard ก่อนใช้งาน');
        }
        await apiFetch('/api/video-studio/jobs', {
          method: 'POST',
          body: JSON.stringify({
            topic: payload.topic,
            styleId: payload.styleId,
            durationSec: Math.min(120, payload.durationSec),
            mode: stopGate === 'draft' ? 'draft' : 'oneshot',
            bgm: payload.bgm,
            voice: payload.voice,
            notes: payload.notes,
            sendTelegram: payload.sendTelegram,
          }),
        });
        toast('🚀 ส่งงานเข้า Video Studio แล้วค่ะ', 'ok');
      }
      if (state.orderMode === 'single') $('order-topic').value = '';
      await refreshFactoryState(true);
      switchView('floor');
    } catch (e) {
      toast(`สั่งผลิตไม่สำเร็จ: ${e.message}`, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  // ── VIEW 3: QC STATION & REVISION WORKBENCH ────────────────────────────────
  function populateQCJobSelector() {
    const sel = $('qc-job-select');
    if (!state.jobs.length) {
      sel.innerHTML = `<option value="">ยังไม่มีงานในโรงงาน</option>`;
      return null;
    }
    sel.innerHTML = state.jobs.map((j) =>
      `<option value="${esc(j.id)}">[${esc(colLabel(classifyJobCol(j)))}] ${esc((j.title || j.topic || j.id).slice(0, 52))}</option>`
    ).join('');
    if (!state.qcJobId || !state.jobs.some((j) => j.id === state.qcJobId)) {
      const preferred = state.jobs.find((j) => ['qc', 'script', 'ready'].includes(classifyJobCol(j))) || state.jobs[0];
      state.qcJobId = preferred.id;
    }
    sel.value = state.qcJobId;
    return state.qcJobId;
  }

  async function loadQCJob(jobId) {
    if (jobId) state.qcJobId = jobId;
    const id = populateQCJobSelector();
    if (!id) return;

    try {
      const [detail, timeline] = await Promise.all([
        apiFetch(`/api/video-studio/jobs/${encodeURIComponent(id)}`),
        apiFetch(`/api/video-studio/jobs/${encodeURIComponent(id)}/timeline`).catch(() => null),
      ]);
      const j = detail.job || detail;
      state.qcJobDetail = j;
      state.qcScript = detail.script ? JSON.parse(JSON.stringify(detail.script)) : { title: j.title || j.topic, scenes: [] };
      state.qcTimeline = timeline;
      renderQCWorkbench(j);
    } catch (e) {
      toast(`โหลดงานเข้าห้อง QC ไม่สำเร็จ: ${e.message}`, 'err');
    }
  }

  function renderQCWorkbench(j) {
    $('qc-decision-title').textContent = `กำลังตรวจ: ${j.title || j.topic || j.id}`;
    const dur = Math.round(Number(j.outputs?.durationSec ?? j.durationSec ?? 0));
    $('qc-decision-sub').textContent = `${j.id} · ${j.styleId || '—'} · ${dur}s · QC=${j.qcStatus || 'pending'}`;
    $('qc-decision-note').value = j.qcNote || '';
    $('qc-btn-open-editor').href = `/video-editor.html?job=${encodeURIComponent(j.id)}`;

    const cost = jobCostThb(j);
    $('qc-cost-badge').textContent = cost !== null ? (cost > 0 ? `💸 ฿${cost.toFixed(2)}` : '💸 ฟรี ฿0') : '💸 —';

    // Node chips
    const nodes = [
      ['🖥️ เรนเดอร์', j.renderNode || j.outputs?.renderNode],
      ['🎚️ มิกซ์', j.mixNode || j.outputs?.mixNode],
      ['🖼️ พรีวิว', j.previewNode || j.outputs?.previewNode],
    ].filter(([, v]) => Boolean(v));
    $('qc-node-chips').innerHTML = nodes.map(([k, v]) => `<span class="badge mono">${esc(k)}: ${esc(v)}</span>`).join('');

    // Resume / Abort controls
    const canResume = (j.status === 'error' || j.status === 'aborted') && !j.alive;
    $('qc-btn-resume').classList.toggle('hidden', !canResume);
    $('qc-btn-abort').classList.toggle('hidden', !j.alive);

    // Versions & real HTML5 Video Player
    const rawVers = Array.isArray(j.versions) && j.versions.length
      ? j.versions
      : (jobLatestVideoFile(j) ? [jobLatestVideoFile(j)] : []);
    const versions = rawVers.map(normalizeVersionEntry);
    const verSel = $('qc-version-select');
    if (versions.length) {
      verSel.innerHTML = versions.map((v) => `<option value="${esc(v.file)}">${esc(v.label)}</option>`).join('');
      const latest = versions[versions.length - 1];
      verSel.value = latest.file;
      setQCVideoFile(j.id, latest.file);
    } else {
      verSel.innerHTML = `<option value="">ยังไม่มีไฟล์วิดีโอ</option>`;
      $('qc-video').classList.add('hidden');
      $('qc-video').removeAttribute('src');
      $('qc-video-empty').classList.remove('hidden');
      $('qc-video-empty-msg').textContent = j.status === 'draft_ready'
        ? 'งานนี้หยุดอยู่ที่ด่านตรวจบท (Draft) — แก้บททางขวาแล้วกด "บันทึก & Build" ได้เลย'
        : (j.message || 'ยังไม่มีไฟล์วิดีโอ');
      $('qc-btn-download').classList.add('hidden');
    }

    // Storyboard image
    const sbFile = j.outputs?.storyboardFile || j.storyboardFile;
    if (sbFile) {
      const sbUrl = `/api/video-studio/file/${encodeURIComponent(j.id)}/${encodeSubPath(sbFile)}`;
      $('qc-storyboard-wrap').classList.remove('hidden');
      $('qc-storyboard-img').src = sbUrl;
      $('qc-storyboard-img').onclick = () => window.open(sbUrl, '_blank');
    } else {
      $('qc-storyboard-wrap').classList.add('hidden');
    }

    // Scene chips synced to timeline
    const tlScenes = Array.isArray(state.qcTimeline?.scenes) && state.qcTimeline.scenes.length
      ? state.qcTimeline.scenes
      : (state.qcScript?.scenes || []).map((s, idx) => ({ id: s.id, title: s.title || `ซีน ${idx + 1}`, startSec: idx * 8, endSec: (idx + 1) * 8 }));
    $('qc-scene-strip').innerHTML = tlScenes.map((sc, idx) => `
      <button type="button" class="scene-chip" data-jump-sec="${Number(sc.startSec || 0)}">
        <div class="mono" style="color:var(--amber);font-weight:700;">#${idx + 1} · ${fmtSec(sc.startSec)}</div>
        <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(sc.title || sc.id)}</div>
      </button>
    `).join('') || `<div class="sub-muted">ยังไม่มีข้อมูลซีน</div>`;

    $('qc-scene-strip').querySelectorAll('[data-jump-sec]').forEach((b) => {
      b.addEventListener('click', () => {
        const vid = $('qc-video');
        if (vid && !vid.classList.contains('hidden')) {
          vid.currentTime = Number(b.dataset.jumpSec || 0);
          vid.play().catch(() => {});
        }
      });
    });

    // Version & Revision Log
    const revs = Array.isArray(j.revisions) ? j.revisions : [];
    const logItems = [
      ...revs.slice().reverse().map((r) => `
        <div style="padding:8px 10px;border-radius:7px;background:var(--well);border:1px solid var(--line);font-size:12px;">
          <b class="mono" style="color:var(--cyan);">AI Revise (${esc(r.mode || 'rebuild')})</b> · ${esc(r.summary || r.prompt)}
          <div class="sub-muted mono" style="margin-top:2px;">${fmtDateTime(r.at)} · ${esc(r.engine || '')}</div>
        </div>
      `),
      ...versions.slice().reverse().map((v) => `
        <div style="padding:8px 10px;border-radius:7px;background:var(--well);border:1px solid var(--line);font-size:12px;">
          <b class="mono" style="color:var(--amber);">${esc(v.label)}</b> · ${esc(v.file)}
          ${v.raw?.renderNode ? `<span class="sub-muted mono"> · 🖥️ ${esc(v.raw.renderNode)}</span>` : ''}
        </div>
      `),
    ];
    $('qc-rev-log').innerHTML = logItems.join('') || `<div class="sub-muted">ยังไม่มีประวัติการแก้ไข</div>`;

    // Quick Edit defaults
    $('qc-trim-start').value = 0;
    $('qc-trim-end').value = dur > 0 ? dur : 30;
    $('qc-remix-bgm').value = j.bgm || 'warm_tech';

    // Script & Shot Director Editor
    renderQCScriptEditor(j);
  }

  function setQCVideoFile(jobId, filename) {
    const url = `/api/video-studio/file/${encodeURIComponent(jobId)}/${encodeSubPath(filename)}`;
    const vid = $('qc-video');
    vid.src = url;
    vid.classList.remove('hidden');
    $('qc-video-empty').classList.add('hidden');
    $('qc-btn-download').href = url + '?download=1';
    $('qc-btn-download').setAttribute('download', filename.split('/').pop() || 'video.mp4');
    $('qc-btn-download').classList.remove('hidden');
  }

  $('qc-version-select').addEventListener('change', (e) => {
    if (state.qcJobId && e.target.value) setQCVideoFile(state.qcJobId, e.target.value);
  });

  $('qc-video').addEventListener('timeupdate', () => {
    const t = $('qc-video').currentTime || 0;
    $('qc-timecode').textContent = fmtSec(t);
    $('btn-attach-time').textContent = `+ แนบเวลาปัจจุบัน (@${fmtSec(t)})`;
  });

  $('qc-btn-copy-link').addEventListener('click', async () => {
    const vid = $('qc-video');
    const selectedFile = $('qc-version-select')?.value || '';
    const verObj = selectedFile && Array.isArray(state.qcJobDetail?.versions)
      ? state.qcJobDetail.versions.find((v) => v && typeof v === 'object' && v.file === selectedFile)
      : null;
    const isLatest = !selectedFile || selectedFile === jobLatestVideoFile(state.qcJobDetail);
    const selectedFileUrl = (selectedFile && state.qcJobId)
      ? `${window.location.origin}/api/video-studio/file/${encodeURIComponent(state.qcJobId)}/${encodeSubPath(selectedFile)}`
      : '';
    const url = verObj?.watchUrl
      || (!isLatest && selectedFileUrl)
      || state.qcJobDetail?.outputs?.watchUrl
      || selectedFileUrl
      || (vid && vid.src ? vid.src : '');
    if (!url) { toast('ยังไม่มีลิงก์วิดีโอสำหรับงานนี้', 'warn'); return; }
    try {
      await navigator.clipboard.writeText(url);
      toast('🔗 คัดลอกลิงก์วิดีโอแล้วค่ะ', 'ok');
    } catch (_) { toast('คัดลอกลิงก์ไม่สำเร็จ', 'err'); }
  });

  $('qc-btn-resume').addEventListener('click', () => state.qcJobId && resumeJobById(state.qcJobId));
  $('qc-btn-abort').addEventListener('click', () => state.qcJobId && abortJobById(state.qcJobId));
  $('qc-job-select').addEventListener('change', (e) => loadQCJob(e.target.value));
  $('btn-qc-reload').addEventListener('click', () => loadQCJob(state.qcJobId));

  document.querySelectorAll('#qc-rev-tabs [data-rtab]').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#qc-rev-tabs [data-rtab]').forEach((x) => x.classList.toggle('is-active', x === b));
      ['ai', 'script', 'quick', 'nle'].forEach((t) => $('rtab-' + t).classList.toggle('hidden', t !== b.dataset.rtab));
    });
  });

  $('btn-attach-time').addEventListener('click', () => {
    const t = $('qc-video').currentTime || 0;
    $('qc-ai-prompt').value = `@${fmtSec(t)} ` + $('qc-ai-prompt').value;
    $('qc-ai-prompt').focus();
  });
  document.querySelectorAll('[data-rev-hint]').forEach((b) => {
    b.addEventListener('click', () => { $('qc-ai-prompt').value = b.dataset.revHint; });
  });

  $('btn-run-ai-rev').addEventListener('click', async () => {
    if (!state.qcJobId) return;
    const prompt = $('qc-ai-prompt').value.trim();
    if (prompt.length < 2) { toast('กรุณาพิมพ์คำสั่งแก้ไขให้ AI ก่อนค่ะ', 'err'); return; }
    const btn = $('btn-run-ai-rev');
    btn.disabled = true;
    try {
      const res = await apiFetch(`/api/video-studio/factory/jobs/${encodeURIComponent(state.qcJobId)}/revise`, {
        method: 'POST',
        body: JSON.stringify({ prompt, timeSec: $('qc-video').currentTime || 0 }),
      });
      $('qc-ai-prompt').value = '';
      toast(`🔄 ${res.summary || 'ส่งคำสั่งแก้เข้าสายพานแล้ว!'} (${res.mode})`, 'ok');
      await refreshFactoryState(true);
      await loadQCJob(state.qcJobId);
    } catch (e) {
      toast(`สั่งแก้ด้วย AI ไม่สำเร็จ: ${e.message}`, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  // Script & Shot Director Editor
  function renderQCScriptEditor(j) {
    const scenes = Array.isArray(state.qcScript?.scenes) ? state.qcScript.scenes : [];
    const shotCfg = typeof DATA.getShotOptionsForStyle === 'function' ? DATA.getShotOptionsForStyle(j.styleId) : null;

    $('qc-script-list').innerHTML = scenes.map((sc, idx) => {
      const curShot = (sc.direction && sc.direction.shot) || '';
      const shotSelectHtml = shotCfg ? `
        <div>
          <label class="field-label">${esc(shotCfg.label)}</label>
          <select class="select" data-sc-shot="${idx}">
            ${shotCfg.options.map(([v, l]) => `<option value="${esc(v)}" ${curShot === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
          </select>
        </div>` : '';

      return `
        <div class="scene-edit-card" data-sc-idx="${idx}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
            <strong class="mono">ซีน ${idx + 1} (${esc(sc.id || 's' + (idx + 1))})</strong>
            <div style="display:flex;gap:5px;flex-wrap:wrap;">
              <button type="button" class="btn btn-xs" data-sc-move="${idx}" data-dir="-1">↑</button>
              <button type="button" class="btn btn-xs" data-sc-move="${idx}" data-dir="1">↓</button>
              <button type="button" class="btn btn-xs btn-cyan" data-regen-scene="${esc(sc.id || 's' + (idx + 1))}">🔄 เรนเดอร์เฉพาะซีนนี้</button>
              <button type="button" class="btn btn-xs btn-rose" data-sc-del="${idx}">ลบ</button>
            </div>
          </div>
          <div class="scene-edit-grid">
            <div><label class="field-label">หัวข้อ (Title)</label><input class="input" data-sc-field="title" data-idx="${idx}" value="${esc(sc.title || '')}" /></div>
            <div><label class="field-label">คำรอง (Subtitle)</label><input class="input" data-sc-field="subtitle" data-idx="${idx}" value="${esc(sc.subtitle || '')}" /></div>
            <div><label class="field-label">ไอคอน (Icon)</label><input class="input" data-sc-field="icon" data-idx="${idx}" value="${esc(sc.icon || '')}" /></div>
            <div><label class="field-label">ภาพประกอบ (Visual)</label><input class="input" data-sc-field="visual" data-idx="${idx}" value="${esc(sc.visual || '')}" /></div>
          </div>
          ${shotSelectHtml}
          <div>
            <label class="field-label">บทบรรยาย (Narration)</label>
            <textarea class="textarea" style="min-height:60px;" data-sc-field="narration" data-idx="${idx}">${esc(sc.narration || '')}</textarea>
          </div>
          <div>
            <label class="field-label">Bullets (คั่นด้วย ,)</label>
            <input class="input" data-sc-field="bullets" data-idx="${idx}" value="${esc(Array.isArray(sc.bullets) ? sc.bullets.join(', ') : (sc.bullets || ''))}" placeholder="ประเด็น 1, ประเด็น 2, ประเด็น 3" />
          </div>
        </div>
      `;
    }).join('') || `<div class="sub-muted">ยังไม่มีไฟล์บท (script.json) สำหรับงานนี้</div>`;

    $('qc-script-list').querySelectorAll('[data-sc-field]').forEach((el) => {
      el.addEventListener('input', () => {
        const i = Number(el.dataset.idx);
        const f = el.dataset.scField;
        if (!state.qcScript?.scenes?.[i]) return;
        if (f === 'bullets') {
          state.qcScript.scenes[i][f] = el.value.split(',').map((x) => x.trim()).filter(Boolean);
        } else {
          state.qcScript.scenes[i][f] = el.value;
        }
      });
    });
    $('qc-script-list').querySelectorAll('[data-sc-shot]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const i = Number(sel.dataset.scShot);
        if (!state.qcScript?.scenes?.[i]) return;
        const sc = state.qcScript.scenes[i];
        if (sel.value) {
          sc.direction = { ...(sc.direction || {}), shot: sel.value };
        } else if (sc.direction) {
          delete sc.direction.shot;
        }
      });
    });
    $('qc-script-list').querySelectorAll('[data-sc-move]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.scMove);
        const dir = Number(btn.dataset.dir);
        const arr = state.qcScript?.scenes || [];
        if (i + dir < 0 || i + dir >= arr.length) return;
        [arr[i], arr[i + dir]] = [arr[i + dir], arr[i]];
        renderQCScriptEditor(j);
      });
    });
    $('qc-script-list').querySelectorAll('[data-sc-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.scDel);
        if ((state.qcScript?.scenes?.length || 0) <= 1) { toast('ต้องเหลืออย่างน้อย 1 ซีน', 'warn'); return; }
        state.qcScript.scenes.splice(i, 1);
        renderQCScriptEditor(j);
      });
    });
    $('qc-script-list').querySelectorAll('[data-regen-scene]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const scId = btn.dataset.regenScene;
        try {
          await apiFetch(`/api/video-studio/jobs/${encodeURIComponent(state.qcJobId)}/script`, {
            method: 'PUT',
            body: JSON.stringify({ script: state.qcScript }),
          });
          await apiFetch(`/api/video-studio/jobs/${encodeURIComponent(state.qcJobId)}/edit-scene`, {
            method: 'POST',
            body: JSON.stringify({ sceneId: scId }),
          });
          toast(`🔄 สั่งเรนเดอร์ซีน ${scId} ใหม่แล้วค่ะ`, 'ok');
          refreshFactoryState(true);
        } catch (e) {
          toast(`เรนเดอร์ซีนไม่สำเร็จ: ${e.message}`, 'err');
        }
      });
    });
  }

  $('btn-qc-add-scene').addEventListener('click', () => {
    if (!state.qcScript) return;
    if (!Array.isArray(state.qcScript.scenes)) state.qcScript.scenes = [];
    const n = state.qcScript.scenes.length + 1;
    state.qcScript.scenes.push({
      id: `s${n}`,
      title: `ซีนใหม่ ${n}`,
      subtitle: '',
      icon: 'sparkles',
      visual: '',
      narration: 'พิมพ์บทบรรยายสำหรับซีนใหม่...',
      bullets: [],
    });
    renderQCScriptEditor(state.qcJobDetail || {});
  });

  $('btn-qc-save-only').addEventListener('click', async () => {
    if (!state.qcJobId || !state.qcScript) return;
    try {
      await apiFetch(`/api/video-studio/jobs/${encodeURIComponent(state.qcJobId)}/script`, {
        method: 'PUT',
        body: JSON.stringify({ script: state.qcScript }),
      });
      toast('💾 บันทึกบท (script.json) เรียบร้อยแล้วค่ะ', 'ok');
    } catch (e) {
      toast(`บันทึกบทไม่สำเร็จ: ${e.message}`, 'err');
    }
  });

  $('btn-qc-save-build').addEventListener('click', async () => {
    if (!state.qcJobId || !state.qcScript) return;
    try {
      await apiFetch(`/api/video-studio/jobs/${encodeURIComponent(state.qcJobId)}/script`, {
        method: 'PUT',
        body: JSON.stringify({ script: state.qcScript }),
      });
      const isDraft = state.qcJobDetail?.status === 'draft_ready';
      const ep = isDraft ? 'build' : 'rebuild';
      await apiFetch(`/api/video-studio/jobs/${encodeURIComponent(state.qcJobId)}/${ep}`, {
        method: 'POST',
        body: JSON.stringify(ep === 'rebuild' ? { script: state.qcScript } : {}),
      });
      toast(`🚀 บันทึกบทและสั่ง ${ep.toUpperCase()} เข้าสายพานแล้วค่ะ`, 'ok');
      refreshFactoryState(true);
      switchView('floor');
    } catch (e) {
      toast(`สั่ง Build/Rebuild ไม่สำเร็จ: ${e.message}`, 'err');
    }
  });

  // Quick Trim / Cut / Remix
  $('btn-qc-trim-s').addEventListener('click', () => { $('qc-trim-start').value = ($('qc-video').currentTime || 0).toFixed(1); });
  $('btn-qc-trim-e').addEventListener('click', () => { $('qc-trim-end').value = ($('qc-video').currentTime || 0).toFixed(1); });
  $('qc-remix-vol').addEventListener('input', (e) => { $('qc-remix-vol-val').textContent = Number(e.target.value).toFixed(2); });
  $('qc-remix-duck').addEventListener('input', (e) => { $('qc-remix-duck-val').textContent = e.target.value + ' dB'; });

  $('btn-qc-do-trim').addEventListener('click', async () => {
    if (!state.qcJobId) return;
    try {
      await apiFetch(`/api/video-studio/jobs/${encodeURIComponent(state.qcJobId)}/trim`, {
        method: 'POST',
        body: JSON.stringify({ start: Number($('qc-trim-start').value || 0), end: Number($('qc-trim-end').value || 0) }),
      });
      toast('✂️ ส่งงานตัดหัว-ท้าย (Trim) เข้าสายพานแล้วค่ะ', 'ok');
      refreshFactoryState(true);
    } catch (e) { toast(`Trim ไม่สำเร็จ: ${e.message}`, 'err'); }
  });

  $('btn-qc-do-cut').addEventListener('click', async () => {
    if (!state.qcJobId) return;
    try {
      await apiFetch(`/api/video-studio/jobs/${encodeURIComponent(state.qcJobId)}/cut`, {
        method: 'POST',
        body: JSON.stringify({ from: Number($('qc-cut-from').value || 0), to: Number($('qc-cut-to').value || 0) }),
      });
      toast('✂️ ส่งงานตัดท่อนกลาง (Cut) เข้าสายพานแล้วค่ะ', 'ok');
      refreshFactoryState(true);
    } catch (e) { toast(`Cut ไม่สำเร็จ: ${e.message}`, 'err'); }
  });

  $('btn-qc-do-remix').addEventListener('click', async () => {
    if (!state.qcJobId) return;
    try {
      await apiFetch(`/api/video-studio/jobs/${encodeURIComponent(state.qcJobId)}/remix`, {
        method: 'POST',
        body: JSON.stringify({
          bgm: $('qc-remix-bgm').value,
          bgmVol: Number($('qc-remix-vol').value),
          duckDb: Number($('qc-remix-duck').value),
        }),
      });
      toast('🎚️ ส่งงาน Remix เสียงใหม่แล้วค่ะ (ฟรี ฿0)', 'ok');
      refreshFactoryState(true);
    } catch (e) { toast(`Remix ไม่สำเร็จ: ${e.message}`, 'err'); }
  });

  async function setJobQcQuick(jobId, qcStatus, note = '') {
    if (!jobId) return;
    try {
      await apiFetch(`/api/video-studio/factory/jobs/${encodeURIComponent(jobId)}/qc`, {
        method: 'POST',
        body: JSON.stringify({ qcStatus, note }),
      });
      await refreshFactoryState(true);
      if (qcStatus === 'skipped') {
        toast('✔️ ผ่านแล้ว เก็บไว้ดูเอง (ไม่ต้องโพสต์) ค่ะ', 'ok');
      } else if (qcStatus === 'pending') {
        toast('↩️ ส่งกลับไปรอตรวจ QC แล้วค่ะ', 'ok');
      }
    } catch (e) {
      toast(`อัปเดตสถานะ QC ไม่สำเร็จ: ${e.message}`, 'err');
    }
  }

  async function submitQCDecision(qcStatus) {
    if (!state.qcJobId) return;
    try {
      await apiFetch(`/api/video-studio/factory/jobs/${encodeURIComponent(state.qcJobId)}/qc`, {
        method: 'POST',
        body: JSON.stringify({ qcStatus, note: $('qc-decision-note').value.trim() }),
      });
      await refreshFactoryState(true);
      if (qcStatus === 'approved') {
        state.socialJobId = state.qcJobId;
        toast('✅ อนุมัติผ่าน QC! ส่งต่อไปยังศูนย์โพสต์โซเชียลแล้วค่ะ', 'ok');
        switchView('social');
      } else if (qcStatus === 'skipped') {
        toast('✔️ ผ่านแล้ว เก็บไว้ดูเอง ไม่ต้องโพสต์ค่ะ', 'ok');
        switchView('archive');
      } else {
        toast('🔄 ตีกลับงานไปรอแก้ไขแล้วค่ะ', 'warn');
        switchView('floor');
      }
    } catch (e) {
      toast(`บันทึกผล QC ไม่สำเร็จ: ${e.message}`, 'err');
    }
  }
  $('btn-qc-approve').addEventListener('click', () => submitQCDecision('approved'));
  $('btn-qc-reject').addEventListener('click', () => submitQCDecision('rejected'));
  if ($('btn-qc-skip')) $('btn-qc-skip').addEventListener('click', () => submitQCDecision('skipped'));

  // ── VIEW 4: SOCIAL DISPATCH & SCHEDULER (OPTION C) ─────────────────────────
  async function loadSocialHub() {
    try {
      const [adRes, qRes, calRes] = await Promise.all([
        apiFetch('/api/video-studio/social/adapters'),
        apiFetch('/api/video-studio/social/queue'),
        apiFetch('/api/video-studio/social/calendar?days=7'),
      ]);
      state.socialAdapters = adRes.adapters || [];
      state.socialQueue = qRes.items || [];
      state.socialCalendar = calRes.days || [];
    } catch (e) {
      if (e.status !== 404) toast(`โหลดศูนย์โพสต์โซเชียลไม่สำเร็จ: ${e.message}`, 'err');
    }
    renderSocial();
  }

  function renderSocial() {
    const readyJobs = state.jobs.filter((j) => j.status === 'done');
    if (!readyJobs.length) {
      $('social-ready-list').innerHTML = `<div class="sub-muted">ยังไม่มีคลิปที่เรนเดอร์เสร็จพร้อมโพสต์</div>`;
      $('social-selected-title').textContent = 'ยังไม่มีคลิปพร้อมโพสต์';
      $('social-selected-meta').textContent = '—';
      $('social-platforms-wrap').innerHTML = '';
    } else {
      if (!state.socialJobId || !readyJobs.some((j) => j.id === state.socialJobId)) {
        const approved = readyJobs.find((j) => j.qcStatus === 'approved');
        state.socialJobId = (approved || readyJobs[0]).id;
      }
      $('social-ready-list').innerHTML = readyJobs.map((j) => `
        <button type="button" class="job-card ${j.id === state.socialJobId ? 'is-selected' : ''}" data-sjob="${esc(j.id)}" style="text-align:left;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span class="badge ${j.qcStatus === 'approved' ? 'emerald' : j.qcStatus === 'skipped' ? 'slate' : 'amber'}">${j.qcStatus === 'approved' ? '✅ ผ่าน QC' : j.qcStatus === 'skipped' ? '✔️ เก็บไว้ดูเอง' : '🔍 รอ QC'}</span>
            <span class="mono sub-muted">${Math.round(Number(j.outputs?.durationSec ?? j.durationSec ?? 0))}s</span>
          </div>
          <div class="job-title">${esc(j.title || j.topic || j.id)}</div>
        </button>
      `).join('');
      $('social-ready-list').querySelectorAll('[data-sjob]').forEach((b) => {
        b.addEventListener('click', () => { state.socialJobId = b.dataset.sjob; renderSocial(); });
      });

      const sj = readyJobs.find((j) => j.id === state.socialJobId) || readyJobs[0];
      $('social-selected-title').textContent = sj.title || sj.topic || sj.id;
      $('social-selected-meta').textContent = `${sj.id} · ${sj.styleId || '—'} · ${Math.round(Number(sj.outputs?.durationSec ?? sj.durationSec ?? 0))}s`;

      const draftMap = state.socialDrafts[sj.id] || {};
      const adapters = state.socialAdapters.length ? state.socialAdapters : [
        { key: 'telegram', name: 'Telegram Channel / Bot', statusLabel: 'Bot API พร้อมยิงจริง', defaultEnabled: true, supportsBrowserVision: false },
        { key: 'youtube', name: 'YouTube Shorts', statusLabel: 'Official API v3 · พร้อมเสียบคีย์', defaultEnabled: true, supportsBrowserVision: true },
        { key: 'tiktok', name: 'TikTok', statusLabel: 'Browser Vision Semi-Auto + Export Kit', defaultEnabled: true, supportsBrowserVision: true },
        { key: 'facebook', name: 'Facebook Reels', statusLabel: 'Browser Vision Semi-Auto + Export Kit', defaultEnabled: false, supportsBrowserVision: true },
        { key: 'instagram', name: 'Instagram Reels', statusLabel: 'Browser Vision Semi-Auto + Export Kit', defaultEnabled: false, supportsBrowserVision: true },
      ];

      $('social-platforms-wrap').innerHTML = adapters.map((p) => {
        const st = (sj.social && sj.social[p.key]) || 'ready';
        const stBadge = st === 'posted' ? '<span class="badge emerald">✓ โพสต์แล้ว</span>'
          : st === 'scheduled' ? '<span class="badge cyan">⏳ ตั้งเวลาไว้</span>'
          : st === 'failed' ? '<span class="badge rose">⚠ ล้มเหลว</span>'
          : '<span class="badge">พร้อมโพสต์</span>';
        const dTitle = draftMap[p.key]?.title ?? (sj.title || sj.topic || '').slice(0, 90);
        const dCap = draftMap[p.key]?.caption ?? `${sj.title || sj.topic || ''}\n\n#Homelab #AI #สรุปสั้นเข้าใจง่าย`;
        return `
          <div class="platform-card ${p.defaultEnabled ? 'is-enabled' : ''}">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
              <label style="display:inline-flex;align-items:center;gap:6px;font-weight:700;cursor:pointer;">
                <input type="checkbox" data-plat-chk="${esc(p.key)}" ${p.defaultEnabled ? 'checked' : ''} />
                <span>${esc(p.name)}</span>
              </label>
              ${stBadge}
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
              <span class="sub-muted mono">${esc(p.statusLabel || p.modeLabel || '')}</span>
              ${p.supportsBrowserVision ? `<button type="button" class="btn btn-xs btn-cyan" data-bv-launch="${esc(p.key)}">🌐 เปิด Browser Semi-Auto</button>` : ''}
            </div>
            <input type="text" class="input" data-plat-title="${esc(p.key)}" value="${esc(dTitle)}" placeholder="หัวข้อ / Title" />
            <textarea class="textarea" style="min-height:68px;" data-plat-cap="${esc(p.key)}">${esc(dCap)}</textarea>
          </div>
        `;
      }).join('');

      $('social-platforms-wrap').querySelectorAll('[data-bv-launch]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const platKey = btn.dataset.bvLaunch;
          btn.disabled = true;
          try {
            const r = await apiFetch('/api/video-studio/social/browser-launch', {
              method: 'POST',
              body: JSON.stringify({ platform: platKey, jobId: sj.id }),
            });
            const targetUrl = r.browserVisionUrl || r.uploadUrl;
            if (targetUrl) {
              window.HomelabBVAlerts?.raise({
                id: 'bv-soc-' + platKey + '-' + sj.id,
                kind: 'social_upload',
                title: '📤 รอล็อกอิน/อัปโหลด ' + platKey,
                detail: r.message || sj.title || sj.topic || 'เปิด Browser Vision เพื่ออัปโหลดคลิป',
                sourceType: 'social',
                platform: platKey,
                browserVisionUrl: r.browserVisionUrl || targetUrl,
                url: r.uploadUrl || targetUrl,
              });
              window.open(targetUrl, '_blank', 'noopener');
            }
            const safeKey = (window.CSS && typeof window.CSS.escape === 'function') ? window.CSS.escape(platKey) : platKey;
            const titleEl = document.querySelector(`[data-plat-title="${safeKey}"]`);
            const capEl = document.querySelector(`[data-plat-cap="${safeKey}"]`);
            const kitPlat = r.exportKit?.platforms?.[platKey] || {};
            const pTitle = (titleEl && titleEl.value.trim()) || kitPlat.title || sj.title || sj.topic || '';
            const pCap = (capEl && capEl.value.trim()) || kitPlat.caption || '';
            const dlLink = r.exportKit?.downloadUrl || r.exportKit?.watchUrl || sj.outputs?.watchUrl || '';
            const clipParts = [
              pTitle ? `Title: ${pTitle}` : '',
              pCap ? `Caption:\n${pCap}` : '',
              dlLink ? `Master Video: ${dlLink}` : '',
            ].filter(Boolean);
            const clipText = clipParts.join('\n\n') || r.exportKit?.clipboardText || '';
            let copied = false;
            if (clipText && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
              try {
                await navigator.clipboard.writeText(clipText);
                copied = true;
              } catch (_) {}
            }
            toast(`🌐 ${r.message || 'เปิด Browser Vision Semi-Auto แล้ว'}${copied ? ' · คัดลอกแคปชันและลิงก์ Master ลงคลิปบอร์ดแล้ว' : ''}`, 'ok');
          } catch (e) {
            toast(`เปิด Browser Semi-Auto ไม่สำเร็จ: ${e.message}`, 'err');
          } finally {
            btn.disabled = false;
          }
        });
      });
    }

    // 7-Day Calendar
    $('social-calendar').innerHTML = (state.socialCalendar || []).map((d) => `
      <div class="cal-day">
        <div style="font-weight:700;font-size:12px;color:var(--amber);">${esc(d.label)}</div>
        ${(d.items || []).map((it) => `
          <div class="cal-slot">
            <div class="mono" style="color:var(--cyan);font-weight:700;">${esc(it.time)}</div>
            <div style="font-weight:600;margin:2px 0;">${esc(it.title)}</div>
            <div class="sub-muted mono">${esc(it.channel)}</div>
          </div>
        `).join('')}
      </div>
    `).join('') || `<div class="sub-muted">กำลังโหลดปฏิทิน 7 วัน...</div>`;

    // Social Queue Table
    $('social-queue-count').textContent = `${state.socialQueue.length} รายการ`;
    $('social-queue-body').innerHTML = (state.socialQueue || []).map((it) => {
      const cls = it.status === 'posted' ? 'emerald' : it.status === 'scheduled' ? 'cyan' : it.status === 'failed' ? 'rose' : 'amber';
      return `
        <tr>
          <td><span class="badge">${esc(it.platformName || it.platform)}</span></td>
          <td><b>${esc(it.topic || it.jobId)}</b><div class="sub-muted mono">${esc(it.jobId)}</div></td>
          <td><span class="badge ${cls}">${esc(it.status)}</span></td>
          <td class="mono">${fmtDateTime(it.scheduledAt || it.dispatchedAt || it.createdAt)}</td>
          <td class="sub-muted" style="max-width:260px;">${esc(it.note || it.error || '—')}</td>
          <td>
            <div style="display:flex;gap:5px;">
              ${it.status !== 'posted' ? `<button type="button" class="btn btn-xs btn-cyan" data-sq-retry="${esc(it.id)}">↻ ยิงซ้ำ</button>` : ''}
              <button type="button" class="btn btn-xs btn-rose" data-sq-del="${esc(it.id)}">ลบ</button>
            </div>
          </td>
        </tr>
      `;
    }).join('') || `<tr><td colspan="6" class="sub-muted" style="text-align:center;">ยังไม่มีรายการในคิวโพสต์</td></tr>`;

    $('social-queue-body').querySelectorAll('[data-sq-retry]').forEach((b) => {
      b.addEventListener('click', async () => {
        try {
          await apiFetch(`/api/video-studio/social/queue/${encodeURIComponent(b.dataset.sqRetry)}/retry`, { method: 'POST' });
          toast('↻ ส่งโพสต์ซ้ำเรียบร้อยแล้วค่ะ', 'ok');
          loadSocialHub();
        } catch (e) { toast(`ยิงซ้ำไม่สำเร็จ: ${e.message}`, 'err'); }
      });
    });
    $('social-queue-body').querySelectorAll('[data-sq-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        try {
          await apiFetch(`/api/video-studio/social/queue/${encodeURIComponent(b.dataset.sqDel)}`, { method: 'DELETE' });
          toast('ลบรายการออกจากคิวแล้วค่ะ', 'ok');
          loadSocialHub();
        } catch (e) { toast(`ลบไม่สำเร็จ: ${e.message}`, 'err'); }
      });
    });
  }

  $('btn-refresh-social').addEventListener('click', () => loadSocialHub());

  $('btn-ai-pack-social').addEventListener('click', async () => {
    if (!state.socialJobId) { toast('กรุณาเลือกคลิปก่อนค่ะ', 'warn'); return; }
    const btn = $('btn-ai-pack-social');
    btn.disabled = true;
    try {
      const res = await apiFetch('/api/video-studio/social/caption-pack', {
        method: 'POST',
        body: JSON.stringify({ jobId: state.socialJobId }),
      });
      state.socialDrafts[state.socialJobId] = res.pack || {};
      renderSocial();
      toast(`✨ สร้างแคปชัน & แฮชแท็กครบ 5 ช่องแล้ว (${res.engine})`, 'ok');
    } catch (e) {
      toast(`สร้างแคปชันไม่สำเร็จ: ${e.message}`, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  $('btn-copy-export-kit').addEventListener('click', async () => {
    if (!state.socialJobId) { toast('กรุณาเลือกคลิปก่อนค่ะ', 'warn'); return; }
    const titles = {};
    const captions = {};
    document.querySelectorAll('[data-plat-title]').forEach((el) => { titles[el.dataset.platTitle] = el.value; });
    document.querySelectorAll('[data-plat-cap]').forEach((el) => { captions[el.dataset.platCap] = el.value; });
    try {
      const kit = await apiFetch('/api/video-studio/social/export-kit', {
        method: 'POST',
        body: JSON.stringify({ jobId: state.socialJobId, titles, captions }),
      });
      await navigator.clipboard.writeText(kit.clipboardText || '');
      toast('📦 คัดลอก Manual Export Kit (หัวข้อ แคปชัน แฮชแท็ก และลิงก์ Master) ลงคลิปบอร์ดแล้วค่ะ', 'ok');
    } catch (e) {
      toast(`คัดลอก Export Kit ไม่สำเร็จ: ${e.message}`, 'err');
    }
  });

  $('btn-dispatch-social').addEventListener('click', async () => {
    if (!state.socialJobId) { toast('กรุณาเลือกคลิปก่อนค่ะ', 'warn'); return; }
    const platforms = Array.from(document.querySelectorAll('[data-plat-chk]:checked')).map((c) => c.dataset.platChk);
    if (!platforms.length) { toast('กรุณาติ๊กเลือกแพลตฟอร์มอย่างน้อย 1 ช่อง', 'err'); return; }

    const titles = {};
    const captions = {};
    document.querySelectorAll('[data-plat-title]').forEach((el) => { titles[el.dataset.platTitle] = el.value; });
    document.querySelectorAll('[data-plat-cap]').forEach((el) => { captions[el.dataset.platCap] = el.value; });

    const publishMode = document.querySelector('input[name="pubtime"]:checked')?.value || 'now';
    let scheduledAt = null;
    if (publishMode === 'schedule') {
      const rawDt = ($('social-schedule-dt').value || '').trim();
      const parsedMs = Date.parse(rawDt);
      if (!rawDt || Number.isNaN(parsedMs)) {
        toast('กรุณาระบุวันและเวลาตั้งโพสต์ให้ถูกต้องก่อนส่งเข้าคิวค่ะ', 'warn');
        $('social-schedule-dt').focus();
        return;
      }
      scheduledAt = new Date(parsedMs).toISOString();
    }

    const btn = $('btn-dispatch-social');
    btn.disabled = true;
    try {
      const res = await apiFetch('/api/video-studio/social/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          jobId: state.socialJobId,
          platforms,
          titles,
          captions,
          publishMode,
          scheduledAt,
        }),
      });
      toast(`🚀 ${res.message || 'ส่งเข้าคิวโพสต์แล้ว!'}`, 'ok');
      await Promise.all([refreshFactoryState(true), loadSocialHub()]);
    } catch (e) {
      toast(`ส่งโพสต์ไม่สำเร็จ: ${e.message}`, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  // ── VIEW 5: PRODUCTION LINES ───────────────────────────────────────────────
  function renderLines() {
    $('lines-list').innerHTML = (state.lines || []).map((ln) => `
      <div class="panel" style="background:var(--well);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
          <strong style="font-size:14px;">${esc(ln.name)}</strong>
          <span class="badge ${ln.active ? 'emerald' : ''}">${ln.active ? '🟢 เปิดใช้งาน' : '⏸ พักไว้'}</span>
        </div>
        ${ln.description ? `<div class="sub-muted" style="margin-bottom:6px;">${esc(ln.description)}</div>` : ''}
        <div class="sub-muted mono" style="margin-bottom:6px;">⏰ ${esc(ln.schedule)} · สไตล์ ${esc(ln.styleId)} · ${ln.durationSec}s · ${esc(ln.voice)}</div>
        <div class="sub-muted" style="margin-bottom:12px;">รันล่าสุด: ${esc(ln.lastRunStatus || '—')} ${ln.lastRunAt ? '(' + fmtDateTime(ln.lastRunAt) + ')' : ''}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-amber btn-sm" data-run-line="${esc(ln.id)}">▶ สั่งรันรอบนี้ทันที</button>
          <button type="button" class="btn btn-sm" data-toggle-line="${esc(ln.id)}">${ln.active ? 'พักสายนี้' : 'เปิดใช้งาน'}</button>
          ${!ln.builtin ? `<button type="button" class="btn btn-rose btn-sm" data-del-line="${esc(ln.id)}">ลบ</button>` : ''}
        </div>
      </div>
    `).join('') || `<div class="sub-muted">ยังไม่มีสายการผลิต</div>`;

    $('lines-list').querySelectorAll('[data-toggle-line]').forEach((b) => {
      b.addEventListener('click', async () => {
        try {
          await apiFetch(`/api/video-studio/factory/lines/${encodeURIComponent(b.dataset.toggleLine)}/toggle`, { method: 'POST' });
          await refreshFactoryState(true);
          renderLines();
        } catch (e) { toast(`สลับสถานะสายไม่สำเร็จ: ${e.message}`, 'err'); }
      });
    });
    $('lines-list').querySelectorAll('[data-run-line]').forEach((b) => {
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const r = await apiFetch(`/api/video-studio/factory/lines/${encodeURIComponent(b.dataset.runLine)}/run`, {
            method: 'POST',
            body: JSON.stringify({}),
          });
          toast(`▶ เริ่มสายการผลิต "${r.line?.name || ''}" แล้วค่ะ!`, 'ok');
          await refreshFactoryState(true);
          switchView('floor');
        } catch (e) {
          toast(`สั่งรันสายไม่สำเร็จ: ${e.message}`, 'err');
        } finally {
          b.disabled = false;
        }
      });
    });
    $('lines-list').querySelectorAll('[data-del-line]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('ยืนยันลบสายการผลิตนี้?')) return;
        try {
          await apiFetch(`/api/video-studio/factory/lines/${encodeURIComponent(b.dataset.delLine)}`, { method: 'DELETE' });
          toast('ลบสายการผลิตแล้วค่ะ', 'ok');
          await refreshFactoryState(true);
          renderLines();
        } catch (e) { toast(`ลบสายไม่สำเร็จ: ${e.message}`, 'err'); }
      });
    });
  }

  $('btn-open-new-line').addEventListener('click', () => $('line-modal').classList.remove('hidden'));
  $('btn-close-line-modal').addEventListener('click', () => $('line-modal').classList.add('hidden'));
  $('btn-cancel-line-modal').addEventListener('click', () => $('line-modal').classList.add('hidden'));
  $('btn-save-new-line').addEventListener('click', async () => {
    try {
      await apiFetch('/api/video-studio/factory/lines', {
        method: 'POST',
        body: JSON.stringify({
          name: $('new-line-name').value.trim(),
          defaultTopic: $('new-line-topic').value.trim(),
          styleId: $('new-line-style').value.trim() || 'look-3',
          durationSec: Number($('new-line-dur').value || 45),
          voice: $('new-line-voice').value,
          schedule: $('new-line-schedule').value.trim() || 'สั่งรันเอง (Manual)',
        }),
      });
      $('line-modal').classList.add('hidden');
      $('new-line-name').value = '';
      $('new-line-topic').value = '';
      toast('💾 สร้างสายการผลิตใหม่แล้วค่ะ', 'ok');
      await refreshFactoryState(true);
      renderLines();
    } catch (e) {
      toast(`สร้างสายไม่สำเร็จ: ${e.message}`, 'err');
    }
  });

  // ── VIEW 6: STYLE LAB & REAL STYLE LEARNER ─────────────────────────────────
  function renderStyleLab() {
    renderStyleCards('lab-style-grid', 'lab-style-search', (sid) => openStyleModal(sid), false);
    $('custom-styles-box').innerHTML = state.customStyles.length
      ? state.customStyles.map((s) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-radius:8px;background:var(--well);border:1px solid var(--line);">
            <div><div style="font-weight:700;">${esc(s.thName)}</div><div class="sub-muted mono">${esc(s.id)}</div></div>
            <button type="button" class="btn btn-rose btn-xs" data-del-cs="${esc(s.id)}">ลบ</button>
          </div>
        `).join('')
      : `<div class="sub-muted">ยังไม่มี Custom Style</div>`;

    $('custom-styles-box').querySelectorAll('[data-del-cs]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm(`ยืนยันลบสไตล์ ${b.dataset.delCs}?`)) return;
        try {
          await apiFetch(`/api/video-studio/styles/custom/${encodeURIComponent(b.dataset.delCs)}`, { method: 'DELETE' });
          toast('ลบ Custom Style แล้วค่ะ', 'ok');
          loadStyles();
        } catch (e) { toast(`ลบสไตล์ไม่สำเร็จ: ${e.message}`, 'err'); }
      });
    });
  }
  $('lab-style-search').addEventListener('input', renderStyleLab);

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
      r.readAsDataURL(file);
    });
  }

  $('btn-start-learn').addEventListener('click', async () => {
    const name = $('learn-name-inp').value.trim();
    const url = $('learn-url-inp').value.trim();
    const files = Array.from($('learn-file-inp').files || []);
    if (!url && !files.length) {
      toast('กรุณาใส่ URL วิดีโอตัวอย่าง หรืออัปโหลดไฟล์อย่างน้อย 1 ไฟล์', 'err');
      return;
    }
    const btn = $('btn-start-learn');
    btn.disabled = true;
    $('learn-status-box').classList.remove('hidden');
    $('learn-status-text').textContent = 'กำลังอัปโหลดและเริ่มวิเคราะห์สไตล์...';

    try {
      const uploadIds = [];
      for (const f of files) {
        if (f.size > 60 * 1024 * 1024) throw new Error(`ไฟล์ ${f.name} ใหญ่เกิน 60MB`);
        const dataUrl = await readAsDataUrl(f);
        const up = await apiFetch('/api/video-studio/upload', {
          method: 'POST',
          body: JSON.stringify({ dataUrl, filename: f.name }),
        });
        if (up?.uploadId) uploadIds.push(up.uploadId);
      }
      const res = await apiFetch('/api/video-studio/styles/learn', {
        method: 'POST',
        body: JSON.stringify({
          url: url || undefined,
          uploadIds: uploadIds.length ? uploadIds : undefined,
          name: name || undefined,
        }),
      });
      const learnId = res.learnId;
      if (state.learnTimer) clearInterval(state.learnTimer);
      state.learnTimer = setInterval(async () => {
        try {
          const st = await apiFetch(`/api/video-studio/styles/learn/${encodeURIComponent(learnId)}`);
          $('learn-status-text').textContent = st.message || st.status || 'กำลังวิเคราะห์...';
          if (st.status === 'done') {
            clearInterval(state.learnTimer);
            toast('✨ เรียนรู้สไตล์ใหม่สำเร็จแล้ว!', 'ok');
            $('learn-name-inp').value = '';
            $('learn-url-inp').value = '';
            $('learn-file-inp').value = '';
            loadStyles();
          } else if (st.status === 'error') {
            clearInterval(state.learnTimer);
            toast(`เรียนรู้สไตล์ไม่สำเร็จ: ${st.message || 'error'}`, 'err');
          }
        } catch (_) {}
      }, 2500);
    } catch (e) {
      $('learn-status-text').textContent = `ไม่สำเร็จ: ${e.message}`;
      toast(`สอนสไตล์ไม่สำเร็จ: ${e.message}`, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  // ── VIEW 7: ARCHIVE & ANALYTICS ────────────────────────────────────────────
  function renderArchive() {
    const a = state.analytics;
    $('kpi-total').textContent = a ? a.totalJobs : state.jobs.length;
    $('kpi-qc-rate').textContent = a ? `${a.firstPassQcRate}%` : '—';
    $('kpi-month-cost').textContent = a ? `฿${Number(a.monthCostThb || 0).toFixed(2)}` : '—';
    $('kpi-offload-rate').textContent = a ? `${a.offloadRatePct}%` : '100%';

    $('archive-table-body').innerHTML = state.jobs.map((j) => {
      const col = classifyJobCol(j);
      const cost = jobCostThb(j);
      const verCount = Array.isArray(j.versions) && j.versions.length ? j.versions.length : 1;
      const vidFile = jobLatestVideoFile(j);
      const dlUrl = vidFile ? `/api/video-studio/file/${encodeURIComponent(j.id)}/${encodeSubPath(vidFile)}?download=1` : '';
      const soc = j.social || {};
      const socStr = ['telegram', 'youtube', 'tiktok']
        .map((k) => `${k === 'telegram' ? 'TG' : k === 'youtube' ? 'YT' : 'TT'}:${soc[k] || '·'}`)
        .join(' · ');

      return `
        <tr>
          <td class="mono">${esc(j.id)}</td>
          <td><b>${esc(j.title || j.topic || j.id)}</b></td>
          <td class="mono">${esc(j.styleId || '—')}</td>
          <td><span class="badge">${esc(colLabel(col))}</span></td>
          <td class="mono">v${verCount}</td>
          <td class="mono">${cost !== null ? (cost > 0 ? '฿' + cost.toFixed(2) : 'ฟรี ฿0') : '—'}</td>
          <td class="mono sub-muted">${esc(socStr)}</td>
          <td>
            <div style="display:flex;gap:5px;flex-wrap:wrap;">
              <button type="button" class="btn btn-xs btn-amber" data-arch-qc="${esc(j.id)}">QC</button>
              ${j.status === 'done' && !['approved', 'skipped'].includes(j.qcStatus) ? `<button type="button" class="btn btn-xs" data-arch-skip="${esc(j.id)}" title="ผ่านเลย ไม่ต้องโพสต์ เก็บไว้ดูเอง">✔️ ผ่าน</button>` : ''}
              ${j.qcStatus === 'skipped' ? `<span class="badge slate">✔️ เก็บไว้ดูเอง</span><button type="button" class="btn btn-xs" data-arch-unskip="${esc(j.id)}" title="ยกเลิก ส่งกลับไปรอ QC">↩️</button>` : ''}
              ${j.status === 'done' ? `<button type="button" class="btn btn-xs btn-emerald" data-arch-soc="${esc(j.id)}">โพสต์</button>` : ''}
              ${j.status === 'done' ? `<a class="btn btn-xs" href="/video-editor.html?job=${encodeURIComponent(j.id)}" target="_blank">✂️</a>` : ''}
              ${dlUrl ? `<a class="btn btn-xs" href="${dlUrl}" download>⬇</a>` : ''}
              ${!j.alive ? `<button type="button" class="btn btn-xs btn-rose" data-arch-del="${esc(j.id)}">🗑</button>` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('') || `<tr><td colspan="8" class="sub-muted" style="text-align:center;">ยังไม่มีงานในคลัง</td></tr>`;

    $('archive-table-body').querySelectorAll('[data-arch-qc]').forEach((b) => {
      b.addEventListener('click', () => { state.qcJobId = b.dataset.archQc; switchView('qc'); });
    });
    $('archive-table-body').querySelectorAll('[data-arch-skip]').forEach((b) => {
      b.addEventListener('click', () => setJobQcQuick(b.dataset.archSkip, 'skipped'));
    });
    $('archive-table-body').querySelectorAll('[data-arch-unskip]').forEach((b) => {
      b.addEventListener('click', () => setJobQcQuick(b.dataset.archUnskip, 'pending'));
    });
    $('archive-table-body').querySelectorAll('[data-arch-soc]').forEach((b) => {
      b.addEventListener('click', () => { state.socialJobId = b.dataset.archSoc; switchView('social'); });
    });
    $('archive-table-body').querySelectorAll('[data-arch-del]').forEach((b) => {
      b.addEventListener('click', () => deleteJobById(b.dataset.archDel));
    });
  }

  if ($('archive-bulk-skip')) {
    $('archive-bulk-skip').addEventListener('click', async () => {
      const pendingQcJobs = state.jobs.filter((j) => classifyJobCol(j) === 'qc');
      if (!pendingQcJobs.length) {
        toast('ไม่มีงานที่ค้างตรวจ QC แล้วค่ะ', 'ok');
        return;
      }
      if (!confirm(`ปิดงานที่ค้างตรวจ QC ทั้งหมด ${pendingQcJobs.length} งาน เป็น 'เก็บไว้ดูเอง (ไม่โพสต์)' ใช่ไหม?`)) return;
      let ok = 0;
      let fail = 0;
      for (const j of pendingQcJobs) {
        try {
          await apiFetch(`/api/video-studio/factory/jobs/${encodeURIComponent(j.id)}/qc`, {
            method: 'POST',
            body: JSON.stringify({ qcStatus: 'skipped', note: 'bulk-skip' }),
          });
          ok++;
        } catch {
          fail++;
        }
      }
      await refreshFactoryState(true);
      toast(`✔️ ปิดงานค้าง QC สำเร็จ ${ok} งาน${fail ? ` (ล้มเหลว ${fail} งาน)` : ''}`, fail ? 'warn' : 'ok');
    });
  }

  // ── STYLE LIGHTBOX MODAL ───────────────────────────────────────────────────
  function openStyleModal(sid) {
    const s = findStyle(sid);
    const pal = extractPaletteColors(s);
    const thumbUrl = styleThumbUrl(s.id);
    const artUrl = styleArtUrl(s.id);
    $('modal-style-title').textContent = s.thName || s.id;
    $('modal-style-en').textContent = `${s.enName || s.id} · ${s.id}`;
    $('modal-style-cat').textContent = s.category || 'ทั่วไป';
    $('modal-style-desc').textContent = s.summary || '';

    const artWrap = $('modal-style-art-wrap');
    const artImg = $('modal-style-art');
    if (artWrap && artImg) {
      if (artUrl) {
        artImg.onerror = () => artWrap.classList.add('hidden');
        artImg.src = artUrl;
        artImg.alt = `${s.thName || s.enName || s.id} (ตัวอย่างสไตล์)`;
        artWrap.classList.remove('hidden');
      } else {
        artImg.removeAttribute('src');
        artWrap.classList.add('hidden');
      }
    }

    const modalImg = $('modal-style-img');
    modalImg.onerror = () => {
      modalImg.onerror = null;
      if (artUrl && modalImg.src !== artUrl) modalImg.src = artUrl;
    };
    modalImg.src = thumbUrl || artUrl || '';
    modalImg.alt = `${s.thName || s.enName || s.id} (9:16)`;

    $('modal-style-swatches').innerHTML = pal.map((c) => `<span class="swatch" style="width:16px;height:16px;background:${esc(c)}"></span>`).join('');
    $('btn-use-modal-style').onclick = () => {
      state.selectedStyleId = s.id;
      $('style-modal').classList.add('hidden');
      switchView('order');
      toast(`เลือกใช้สไตล์ "${s.thName || s.id}" แล้วค่ะ`, 'ok');
    };
    $('style-modal').classList.remove('hidden');
  }
  $('btn-close-style-modal').addEventListener('click', () => $('style-modal').classList.add('hidden'));
  $('style-modal').addEventListener('click', (e) => { if (e.target === $('style-modal')) $('style-modal').classList.add('hidden'); });
  $('line-modal').addEventListener('click', (e) => { if (e.target === $('line-modal')) $('line-modal').classList.add('hidden'); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const styleModal = $('style-modal');
    if (styleModal && !styleModal.classList.contains('hidden')) {
      styleModal.classList.add('hidden');
      return;
    }
    const lineModal = $('line-modal');
    if (lineModal && !lineModal.classList.contains('hidden')) {
      lineModal.classList.add('hidden');
      return;
    }
    const drawer = $('drawer-backdrop');
    if (drawer && !drawer.classList.contains('hidden')) {
      closeDrawer();
      return;
    }
    const pop = $('worker-popover');
    if (pop && !pop.classList.contains('hidden')) {
      pop.classList.add('hidden');
    }
  });

  // ── BOOTSTRAP ──────────────────────────────────────────────────────────────
  populateStaticSelects();
  loadStyles();
  refreshFactoryState(true);
  state.pollTimer = setInterval(() => {
    refreshFactoryState(true);
  }, 8000);
})();
