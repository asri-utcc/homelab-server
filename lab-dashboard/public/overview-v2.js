/* ============================================================================
   Lab Dashboard — Overview v2 (Data-First Operations Board)
   ----------------------------------------------------------------------------
   - Consumes unified GET /api/overview + POST /api/overview/seen
   - Seamless automatic fallback to existing APIs when server hasn't restarted:
       * Host/Docker/PM2/Services/Energy via window.updateOverviewGalaxy(s, rate)
       * AI Chats via GET /api/gemini/sessions + GET /api/audit/live
       * Videos via GET /api/video-studio/jobs
       * Agents via GET /api/agent-hub/mini (fallback /api/agent-hub/status) + /api/agent-hub/jobs
       * Seen-video tracking via localStorage (synced with server when available)
   - Zero 3D/canvas/rAF loops. Clean, responsive, keyboard-accessible.
   ========================================================================== */
(function () {
    'use strict';

    const POLL_MS = 6000;
    const FACTORY_POLL_MS = 8000;
    const QUOTA_POLL_MS = 60000;
    const API_RETRY_MS = 60000;
    const SEEN_STORAGE_KEY = 'ov2_seen_videos_v1';
    const HIST_STORAGE_KEY = 'ov2.hist.v1';
    const HIST_MAX = 60;
    const ATTN_COLLAPSED_LIMIT = 6;
    const TERMINAL_STATUSES = new Set(['completed', 'done', 'failed', 'error', 'cancelled', 'canceled', 'aborted']);
    const ACTIVE_VIDEO_STATUSES = new Set([
        'queued', 'researching', 'scripting', 'tts', 'rendering', 'mixing',
        'previewing', 'editing', 'running', 'building', 'downloading', 'extracting', 'analyzing',
    ]);

    const ui = {
        activityTab: 'ai',       // 'ai' | 'videos'
        aiTab: 'attention',      // 'attention' | 'unread' | 'recent'
        videoTab: 'unseen',      // 'unseen' | 'all' | 'active'
        infraTab: 'auto',        // 'auto' | 'problems' | 'pm2' | 'docker' | 'services'
        attnExpanded: false,
        apiMode: 'unknown',      // 'unknown' | 'unified' | 'fallback'
        apiDisabledUntil: 0,
        lastSummary: null,
        lastRate: { rx: 0, tx: 0 },
        lastData: null,
        lastUpdatedAt: 0,
        lastHistPushAt: 0,
        hist: { cpu: [], ram: [], watts: [] },
        prevKpiVals: {},
        kpiFlashTimers: {},
        freshTimer: null,
        inFlight: false,
        restartingKey: null,
        quota: null,
        quotaInFlight: false,
        quotaUpdatedAt: 0,
        quotaModelsOpen: false,
        quotaTab: 'all',
        factoryState: null,
        socialQueue: null,
        factoryInFlight: false,
        factoryUpdatedAt: 0,
        factoryBusyKey: null,
        factoryFeedback: null,
        factoryFeedbackTimer: null,
        wsCtrl: null,
        wsDemoMode: true,
        wsUserDemoOverride: null,
        wsHadLiveActive: false,
        wsSelectedStation: 'overview',
        wsInspectorOpen: false,
        wsView: (() => {
            try {
                return localStorage.getItem('ov3.wsView') === '3d' ? '3d' : 'pixel';
            } catch (_) {
                return 'pixel';
            }
        })(),
        poCtrl: null,
        poDemoMode: true,
        poUserDemoOverride: null,
        poHadLiveActive: false,
        poSelectedDept: 'all',
        cronJobs: null,
        cronFetchedAt: 0,
        cronInFlight: false,
        officeThemeObsInit: false,
    };

    const flashTimers = new WeakMap();

    // ── Utilities ───────────────────────────────────────────────────────────
    const $ = (id) => document.getElementById(id);

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }

    function clampPct(v) {
        const n = Number(v);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(100, n));
    }

    function fmtGb(bytes) {
        const n = Number(bytes) || 0;
        return (n / 1073741824).toFixed(1);
    }

    function fmtMb(bytes) {
        const n = Number(bytes) || 0;
        if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GB`;
        return `${(n / 1048576).toFixed(1)} MB`;
    }

    function fmtRate(bps) {
        const n = Number(bps) || 0;
        if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB/s`;
        if (n >= 1024) return `${(n / 1024).toFixed(0)} KB/s`;
        return `${Math.round(n)} B/s`;
    }

    function fmtDuration(sec) {
        const s = Math.max(0, Math.round(Number(sec) || 0));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return `${m}:${String(r).padStart(2, '0')}`;
    }

    function fmtElapsed(ms) {
        const sec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
        if (sec < 60) return `${sec} วิ`;
        const min = Math.floor(sec / 60);
        if (min < 60) return `${min} น. ${sec % 60} วิ`;
        const hr = Math.floor(min / 60);
        return `${hr} ชม. ${min % 60} น.`;
    }

    function fmtUptime(sec) {
        const s = Math.max(0, Math.floor(Number(sec) || 0));
        const d = Math.floor(s / 86400);
        const h = Math.floor((s % 86400) / 3600);
        const m = Math.floor((s % 3600) / 60);
        if (d > 0) return `${d}d ${h}h`;
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    }

    function relTime(ms) {
        const n = Number(ms);
        if (!Number.isFinite(n) || n < 0) return 'ไม่ทราบเวลา';
        const sec = Math.floor(n / 1000);
        if (sec < 45) return sec < 5 ? 'เมื่อสักครู่' : `${sec} วินาทีที่แล้ว`;
        const min = Math.floor(sec / 60);
        if (min < 60) return `${min} นาทีที่แล้ว`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `${hr} ชั่วโมงที่แล้ว`;
        const day = Math.floor(hr / 24);
        return `${day} วันที่แล้ว`;
    }

    function fmtRelTime(ts) {
        const ms = typeof ts === 'number' ? ts : Date.parse(ts || '');
        if (!Number.isFinite(ms) || ms <= 0) return '';
        return relTime(Math.max(0, Date.now() - ms));
    }

    function fmtAge(ageMs) {
        const ms = Number(ageMs);
        if (!Number.isFinite(ms) || ms < 0) return 'ออฟไลน์';
        return relTime(ms);
    }

    function fmtThb(v) {
        const n = Number(v);
        if (!Number.isFinite(n)) return '—';
        const dec = Math.abs(n) < 1000 ? 2 : 0;
        return `฿${n.toLocaleString('th-TH', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
    }

    function cleanStepText(raw) {
        const s = String(raw || '').trim();
        if (!s || /^watchdog\b/i.test(s)) return '';
        return s.slice(0, 120);
    }

    function barTone(pct, baseClass) {
        if (pct >= 88) return 'is-hot';
        if (pct >= 75) return 'is-warn';
        return baseClass || '';
    }

    function barToneV3(pct) {
        if (pct >= 88) return 'err';
        if (pct >= 75) return 'warn';
        return 'ok';
    }

    // ── Telemetry History Ring Buffer (60 points in sessionStorage) ─────────
    function loadHist() {
        try {
            const raw = sessionStorage.getItem(HIST_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return;
            const cleanArr = (arr) => (Array.isArray(arr) ? arr.map(Number).filter(Number.isFinite).slice(-HIST_MAX) : []);
            ui.hist = {
                cpu: cleanArr(parsed.cpu),
                ram: cleanArr(parsed.ram),
                watts: cleanArr(parsed.watts),
            };
        } catch (_) {
            ui.hist = { cpu: [], ram: [], watts: [] };
        }
    }

    function saveHist() {
        try {
            sessionStorage.setItem(HIST_STORAGE_KEY, JSON.stringify(ui.hist));
        } catch (_) {}
    }

    function pushHist(data) {
        if (!data || typeof data !== 'object') return;
        const host = data.host || {};
        const cpuRaw = host.cpu && host.cpu.pct;
        const ramRaw = host.mem && host.mem.pct;
        const wattsRaw = data.infra && data.infra.energy && data.infra.energy.realtime && data.infra.energy.realtime.power_watts;

        const pushPoint = (key, val) => {
            const arr = ui.hist[key];
            if (!Array.isArray(arr)) return;
            arr.push(val);
            if (arr.length > HIST_MAX) arr.splice(0, arr.length - HIST_MAX);
        };

        let changed = false;
        if (cpuRaw != null && Number.isFinite(Number(cpuRaw))) {
            pushPoint('cpu', Math.round(clampPct(cpuRaw) * 10) / 10);
            changed = true;
        }
        if (ramRaw != null && Number.isFinite(Number(ramRaw))) {
            pushPoint('ram', Math.round(clampPct(ramRaw) * 10) / 10);
            changed = true;
        }
        if (wattsRaw != null && Number.isFinite(Number(wattsRaw)) && Number(wattsRaw) >= 0) {
            pushPoint('watts', Math.round(Number(wattsRaw)));
            changed = true;
        }
        if (changed) {
            ui.lastHistPushAt = Date.now();
            saveHist();
        }
    }

    function sparkline(values, opts) {
        const w = (opts && Number(opts.w)) || 120;
        const h = (opts && Number(opts.h)) || 28;
        const pts = Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : [];
        if (pts.length < 2) return '';

        let min = Math.min(...pts);
        let max = Math.max(...pts);
        if (max - min < 1e-6) {
            min -= 1;
            max += 1;
        }
        const pad = 2;
        const spanY = Math.max(1, h - pad * 2);
        const coords = pts.map((val, idx) => {
            const x = (idx / (pts.length - 1)) * w;
            const y = pad + (1 - (val - min) / (max - min)) * spanY;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        });
        const linePoints = coords.join(' ');
        const areaPoints = `0,${h} ${linePoints} ${w},${h}`;

        return `<svg class="ov3-spark-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" aria-hidden="true">`
            + `<polygon class="ov3-spark-area" points="${areaPoints}" fill="currentColor" fill-opacity="0.14"></polygon>`
            + `<polyline class="ov3-spark-line" points="${linePoints}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"></polyline>`
            + `</svg>`;
    }

    function jumpToPanel(selector) {
        if (!selector) return;
        const id = selector.startsWith('#') ? selector.slice(1) : selector;
        const el = $(id);
        if (!el) return;
        const reduced = typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
        el.classList.remove('is-flash');
        void el.offsetWidth;
        el.classList.add('is-flash');
        const prev = flashTimers.get(el);
        if (prev) clearTimeout(prev);
        flashTimers.set(el, setTimeout(() => {
            el.classList.remove('is-flash');
            flashTimers.delete(el);
        }, 1200));
    }

    function normalizeVideoKey(input) {
        if (!input || typeof input !== 'string') return '';
        const s = input.trim();
        if (!s) return '';
        const idx = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
        return idx >= 0 ? s.slice(idx + 1) : s;
    }

    function isOverviewActive() {
        const view = $('view-overview');
        return Boolean(view && view.classList.contains('is-active'));
    }

    // ── Local Seen-Video Store (optimistic + fallback persistence) ──────────
    function readLocalSeen() {
        try {
            const raw = localStorage.getItem(SEEN_STORAGE_KEY);
            if (!raw) return { seenVideos: {}, seenAllBefore: 0 };
            const parsed = JSON.parse(raw);
            return {
                seenVideos: (parsed && parsed.seenVideos && typeof parsed.seenVideos === 'object') ? parsed.seenVideos : {},
                seenAllBefore: Number(parsed && parsed.seenAllBefore) || 0,
            };
        } catch (_) {
            return { seenVideos: {}, seenAllBefore: 0 };
        }
    }

    function writeLocalSeen(st) {
        try {
            localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify({
                seenVideos: st.seenVideos || {},
                seenAllBefore: Number(st.seenAllBefore) || 0,
            }));
        } catch (_) {}
    }

    function isLocallySeen(key, createdAtMs, st) {
        const map = (st && st.seenVideos) || {};
        if (key && Object.prototype.hasOwnProperty.call(map, key)) {
            return Number(map[key]) > 0;
        }
        const before = Number(st && st.seenAllBefore) || 0;
        return before > 0 && createdAtMs > 0 && createdAtMs <= before;
    }

    // ── Fallback Aggregator (used when /api/overview returns 404) ───────────
    async function fetchJsonSafe(url) {
        try {
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) return null;
            return await res.json();
        } catch (_) {
            return null;
        }
    }

    function buildInfraFromSummary(s) {
        const hostRaw = (s && s.host) || {};
        const temps = Array.isArray(hostRaw.temps) ? hostRaw.temps : [];
        let peakTempC = null;
        for (const t of temps) {
            const c = Number(t && t.celsius);
            if (Number.isFinite(c) && (peakTempC === null || c > peakTempC)) peakTempC = c;
        }
        const host = {
            hostname: hostRaw.hostname || 'homelab',
            kernel: hostRaw.kernel || '',
            uptimeSec: Number(hostRaw.uptimeSec) || 0,
            load: Array.isArray(hostRaw.load) ? hostRaw.load : [0, 0, 0],
            cpu: hostRaw.cpu || { pct: 0, cores: [], count: 0 },
            mem: hostRaw.mem || { total: 0, used: 0, avail: 0, pct: 0 },
            disks: Array.isArray(hostRaw.disks) ? hostRaw.disks : [],
            peakTempC,
            failedUnits: Array.isArray(hostRaw.failedUnits) ? hostRaw.failedUnits : [],
        };

        const svcItems = Array.isArray(s && s.services && s.services.items) ? s.services.items : [];
        const downServices = svcItems.filter((x) => x && !x.up);
        const pm2Items = Array.isArray(s && s.pm2 && s.pm2.items) ? s.pm2.items : [];
        const downPm2 = pm2Items.filter((p) => p && p.status !== 'online');
        const dockerItems = Array.isArray(s && s.docker && s.docker.items) ? s.docker.items : [];
        const stoppedDocker = dockerItems.filter((c) => c && c.state !== 'running');

        const problems = [
            ...downServices.map((x) => ({ kind: 'service', name: x.name || x.id, status: 'down', detail: x.detail || 'unreachable', url: x.url || '' })),
            ...downPm2.map((p) => ({ kind: 'pm2', name: p.name, status: p.status || 'stopped', detail: `restarts: ${p.restarts ?? 0}`, url: '' })),
            ...stoppedDocker.map((c) => ({ kind: 'docker', name: c.name, status: c.state || 'stopped', detail: c.status || '', url: '' })),
            ...host.failedUnits.map((u) => ({ kind: 'systemd', name: u, status: 'failed', detail: 'systemd unit failed', url: '' })),
        ];

        return {
            host,
            infra: {
                services: { total: svcItems.length, up: svcItems.length - downServices.length, down: downServices.length, items: svcItems },
                pm2: { total: pm2Items.length, online: pm2Items.length - downPm2.length, down: downPm2.length, items: pm2Items },
                docker: { total: dockerItems.length, running: dockerItems.length - stoppedDocker.length, stopped: stoppedDocker.length, items: dockerItems },
                kuma: (s && s.kuma) || { total: 0, up: 0, down: 0 },
                energy: (s && s.energy) || {},
                problems,
            },
        };
    }

    async function fetchFallbackOverview() {
        const [sessData, liveData, vidData, miniData, jobsData, summaryFallback] = await Promise.all([
            fetchJsonSafe('/api/gemini/sessions'),
            fetchJsonSafe('/api/audit/live'),
            fetchJsonSafe('/api/video-studio/jobs'),
            fetchJsonSafe('/api/agent-hub/mini').then((d) => d || fetchJsonSafe('/api/agent-hub/status')),
            fetchJsonSafe('/api/agent-hub/jobs?limit=25'),
            ui.lastSummary ? Promise.resolve(ui.lastSummary) : fetchJsonSafe('/api/summary'),
        ]);

        if (summaryFallback && !ui.lastSummary) ui.lastSummary = summaryFallback;
        const { host, infra } = buildInfraFromSummary(ui.lastSummary || {});

        // 1. AI Chats
        const liveRuns = Array.isArray(liveData && liveData.runs) ? liveData.runs : [];
        const liveBySid = new Map();
        for (const r of liveRuns) {
            if (r && r.sessionId && !liveBySid.has(r.sessionId)) liveBySid.set(r.sessionId, r);
        }
        const runningIds = new Set(Array.isArray(sessData && sessData.runningSessionIds) ? sessData.runningSessionIds : []);
        for (const r of liveRuns) if (r && r.sessionId) runningIds.add(r.sessionId);

        const running = [];
        const unread = [];
        const recent = [];
        const rawSessions = Array.isArray(sessData && sessData.sessions) ? sessData.sessions : [];

        for (const s of rawSessions) {
            if (!s || !s.id) continue;
            const live = liveBySid.get(s.id) || null;
            const isRun = Boolean(s.running) || runningIds.has(s.id);
            const isUnr = !isRun && Boolean(s.unread);
            const item = {
                id: s.id,
                title: String(s.title || 'แชทไม่มีชื่อ'),
                model: String((live && live.model) || s.model || 'auto'),
                pinned: Boolean(s.pinned),
                running: isRun,
                unread: isUnr,
                messageCount: Number(s.messageCount) || 0,
                lastMessage: String(s.lastMessage || (live && live.promptSnippet) || '').slice(0, 140),
                updatedAt: Number(s.updatedAt) || 0,
                lastCompletedAt: Number(s.lastCompletedAt) || 0,
                lastCompletedStatus: s.lastCompletedStatus || null,
                elapsedMs: live && Number.isFinite(Number(live.elapsedMs)) ? Number(live.elapsedMs) : null,
                stepText: live ? cleanStepText(live.lastStepText) : '',
            };
            if (isRun) running.push(item);
            else if (isUnr) unread.push(item);
            if (recent.length < 10) recent.push(item);
        }

        // 2. Videos (deduplicated by key)
        const localSeen = readLocalSeen();
        const activeVideoJobs = [];
        const completedByKey = new Map();
        const seenActiveIds = new Set();
        const rawVids = Array.isArray(vidData && vidData.jobs) ? vidData.jobs : [];

        for (const j of rawVids) {
            if (!j || !j.id) continue;
            const st = String(j.status || '').toLowerCase();
            if (j.alive || ACTIVE_VIDEO_STATUSES.has(st)) {
                if (seenActiveIds.has(j.id)) continue;
                seenActiveIds.add(j.id);
                activeVideoJobs.push({
                    id: j.id,
                    topic: String(j.topic || j.id),
                    styleId: String(j.styleId || ''),
                    status: j.status || 'running',
                    stage: j.stage || j.status || 'running',
                    progress: clampPct(j.progress),
                    message: String(j.message || ''),
                    createdAt: j.createdAt || null,
                });
                continue;
            }
            const versions = Array.isArray(j.versions) ? j.versions : [];
            const latest = versions.length ? versions[versions.length - 1] : null;
            if (st === 'done' && latest) {
                const videoPath = String(latest.videoPath || '').trim();
                const key = normalizeVideoKey(videoPath || j.id);
                if (!key) continue;
                const createdAtMs = Date.parse(latest.createdAt || j.updatedAt || j.createdAt || '') || 0;
                const prev = completedByKey.get(key);
                if (prev && prev.createdAtMs >= createdAtMs) continue;
                const thumbPath = String(latest.storyboardOutPath || latest.gifOutPath || '').trim();
                completedByKey.set(key, {
                    key,
                    source: 'video-studio',
                    jobId: j.id,
                    title: String(j.topic || key),
                    styleId: String(j.styleId || ''),
                    versionCount: versions.length,
                    durationSec: Number(latest.durationSec || j.durationSec) || null,
                    sizeBytes: Number(latest.sizeBytes) || 0,
                    costThb: latest.costThb != null ? Number(latest.costThb) : null,
                    renderNode: String(latest.renderNode || ''),
                    watchUrl: videoPath ? `/api/gemini/local-file?path=${encodeURIComponent(videoPath)}` : (latest.watchUrl || ''),
                    downloadUrl: videoPath ? `/api/gemini/local-file?path=${encodeURIComponent(videoPath)}&download=1` : (latest.downloadUrl || ''),
                    thumbUrl: thumbPath ? `/api/gemini/local-image?path=${encodeURIComponent(thumbPath)}` : '',
                    editorUrl: `/video-editor.html?job=${encodeURIComponent(j.id)}`,
                    createdAt: latest.createdAt || j.updatedAt || j.createdAt || null,
                    createdAtMs,
                    seen: isLocallySeen(key, createdAtMs, localSeen),
                });
            }
        }
        const allCompleted = [...completedByKey.values()].sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
        const unseenVideos = allCompleted.filter((v) => !v.seen);

        // 3. Agents & Render Jobs
        const rawJobs = Array.isArray(jobsData && jobsData.jobs) ? jobsData.jobs : [];
        const activeAgentJobs = [];
        const activeByNode = new Map();
        const lastByNode = new Map();
        for (const j of rawJobs) {
            if (!j || !j.jobId) continue;
            const st = String(j.status || '').toLowerCase();
            const clean = {
                jobId: j.jobId,
                kind: String(j.kind || 'generic'),
                name: String(j.name || j.compositionId || j.outputName || j.kind || 'job'),
                nodeId: String(j.nodeId || ''),
                nodeName: String(j.nodeAlias || j.alias || j.hostname || j.nodeId || ''),
                status: j.status || 'queued',
                progress: clampPct(j.progress),
                message: String(j.message || ''),
                updatedAt: j.updatedAt || j.createdAt || null,
            };
            const nk = clean.nodeId.toLowerCase();
            if (!TERMINAL_STATUSES.has(st)) {
                activeAgentJobs.push(clean);
                if (nk && !activeByNode.has(nk)) activeByNode.set(nk, clean);
            } else if (nk && !lastByNode.has(nk)) {
                lastByNode.set(nk, clean);
            }
        }

        const rawNodes = Array.isArray(miniData && miniData.nodes) ? miniData.nodes : [];
        const nodes = rawNodes.map((n) => {
            const specs = (n && n.specs) || {};
            const metrics = (n && n.metrics) || {};
            const memUsed = Number(metrics.memUsed ?? n.memUsed) || 0;
            const memTotal = Number(metrics.memTotal ?? n.memTotal) || 0;
            const nk = String(n.nodeId || '').toLowerCase();
            return {
                nodeId: String(n.nodeId || ''),
                alias: String(n.alias || ''),
                displayName: String(n.displayName || n.alias || specs.hostname || n.hostname || n.nodeId || 'Agent'),
                hostname: String(specs.hostname || n.hostname || n.nodeId || ''),
                os: String(specs.os || specs.osCaption || n.os || ''),
                online: Boolean(n.online),
                ageMs: Number.isFinite(Number(n.ageMs)) ? Number(n.ageMs) : null,
                cpuThreads: Number(specs.cpuThreads ?? n.cpuThreads) || 0,
                cpuPct: (metrics.cpuPct ?? n.cpuPct) != null ? Math.round(Number(metrics.cpuPct ?? n.cpuPct) * 10) / 10 : null,
                memUsed,
                memTotal,
                memPct: n.memPct != null ? Number(n.memPct) : (memTotal > 0 ? Math.round((memUsed / memTotal) * 1000) / 10 : null),
                hasNvenc: Boolean(specs.hasNvenc ?? n.hasNvenc),
                gpuModel: String(specs.gpuModel || n.gpuModel || ''),
                gpuUtilPct: (metrics.gpuUtilPct ?? n.gpuUtilPct) != null ? Math.round(Number(metrics.gpuUtilPct ?? n.gpuUtilPct)) : null,
                gpuTempC: (metrics.gpuTempC ?? n.gpuTempC) != null ? Math.round(Number(metrics.gpuTempC ?? n.gpuTempC)) : null,
                currentJob: activeByNode.get(nk) || null,
                lastJob: lastByNode.get(nk) || null,
            };
        }).sort((a, b) => Number(b.online) - Number(a.online));

        const onlineNodes = nodes.filter((n) => n.online);
        const overlapping = activeVideoJobs.length > 0
            ? activeAgentJobs.filter((j) => j.kind === 'remotion' || j.name === 'motion-mix' || j.name === 'motion-preview').length
            : 0;
        const rendersActive = activeVideoJobs.length + Math.max(0, activeAgentJobs.length - overlapping);

        return {
            ok: true,
            generatedAt: new Date().toISOString(),
            attention: {
                aiRunning: running.length,
                aiUnread: unread.length,
                videosUnseen: unseenVideos.length,
                rendersActive,
                agentsOnline: onlineNodes.length,
                agentsTotal: nodes.length,
                servicesDown: infra.problems.length,
            },
            ai: {
                runningCount: running.length,
                unreadCount: unread.length,
                totalSessions: rawSessions.length,
                running,
                unread: unread.slice(0, 15),
                recent: recent.slice(0, 10),
            },
            videos: {
                activeCount: activeVideoJobs.length,
                unseenCount: unseenVideos.length,
                totalCompleted: allCompleted.length,
                activeJobs: activeVideoJobs,
                unseen: unseenVideos.slice(0, 15),
                recent: allCompleted.slice(0, 20),
            },
            agents: {
                totalNodes: nodes.length,
                onlineNodes: onlineNodes.length,
                totalThreads: onlineNodes.reduce((a, n) => a + (n.cpuThreads || 0), 0),
                totalRamBytes: onlineNodes.reduce((a, n) => a + (n.memTotal || 0), 0),
                nvencNodes: onlineNodes.filter((n) => n.hasNvenc).length,
                activeJobCount: activeAgentJobs.length,
                activeJobs: activeAgentJobs,
                nodes,
            },
            host,
            infra,
            warnings: [],
        };
    }

    async function fetchOverviewData() {
        const now = Date.now();
        if (ui.apiMode !== 'fallback' || now >= ui.apiDisabledUntil) {
            try {
                const res = await fetch('/api/overview', { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.ok) {
                        ui.apiMode = 'unified';
                        return data;
                    }
                } else if (res.status === 404) {
                    ui.apiMode = 'fallback';
                    ui.apiDisabledUntil = now + API_RETRY_MS;
                }
            } catch (_) {
                ui.apiMode = 'fallback';
                ui.apiDisabledUntil = now + API_RETRY_MS;
            }
        }
        return await fetchFallbackOverview();
    }

    // ── Actions ─────────────────────────────────────────────────────────────
    function openAiChat(sessionId) {
        if (sessionId) {
            try { localStorage.setItem('core_active_session', sessionId); } catch (_) {}
        }
        window.location.href = '/gemini';
    }

    async function createAndOpenNewChat() {
        try {
            const res = await fetch('/api/gemini/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: 'แชทใหม่' }),
            });
            const data = await res.json();
            if (data && data.ok && data.session && data.session.id) {
                openAiChat(data.session.id);
                return;
            }
        } catch (_) {}
        window.location.href = '/gemini';
    }

    async function markChatRead(sessionId) {
        if (!sessionId) return;
        try {
            await fetch('/api/gemini/sessions/read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: sessionId, unread: false }),
            });
        } catch (_) {}
        await tick(true);
    }

    async function markAllChatsRead() {
        try {
            await fetch('/api/gemini/sessions/read-all', { method: 'POST' });
        } catch (_) {}
        await tick(true);
    }

    async function setVideoSeen(payload) {
        // 1. Optimistic local state update (works instantly in both unified & fallback mode)
        const st = readLocalSeen();
        const ts = Date.now();
        if (payload.all) {
            st.seenAllBefore = ts;
            for (const k of Object.keys(st.seenVideos)) {
                if (Number(st.seenVideos[k]) <= 0) st.seenVideos[k] = ts;
            }
            const recent = (ui.lastData && ui.lastData.videos && ui.lastData.videos.recent) || [];
            for (const v of recent) st.seenVideos[v.key] = ts;
        } else if (payload.id) {
            st.seenVideos[payload.id] = payload.seen === false ? 0 : ts;
        }
        writeLocalSeen(st);

        // Apply immediately to in-memory snapshot for zero-lag UI feedback
        if (ui.lastData && ui.lastData.videos) {
            const vids = ui.lastData.videos.recent || [];
            for (const v of vids) {
                if (payload.all) v.seen = true;
                else if (v.key === payload.id) v.seen = payload.seen !== false;
            }
            ui.lastData.videos.unseen = vids.filter((v) => !v.seen);
            ui.lastData.videos.unseenCount = ui.lastData.videos.unseen.length;
            if (ui.lastData.attention) ui.lastData.attention.videosUnseen = ui.lastData.videos.unseenCount;
            renderAll(ui.lastData);
        }

        // 2. Persist to server if unified API is active
        if (ui.apiMode !== 'fallback') {
            try {
                await fetch('/api/overview/seen', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
            } catch (_) {}
        }
    }

    async function restartService(kind, name) {
        if (!name || ui.restartingKey) return;
        const label = kind === 'pm2' ? `PM2 "${name}"` : `คอนเทนเนอร์ "${name}"`;
        if (!window.confirm(`ต้องการรีสตาร์ท ${label} ใช่หรือไม่?`)) return;
        const endpoint = kind === 'pm2'
            ? `/api/pm2/${encodeURIComponent(name)}/restart`
            : `/api/containers/${encodeURIComponent(name)}/restart`;
        ui.restartingKey = `${kind}:${name}`;
        if (ui.lastData) renderInfra(ui.lastData);
        try {
            await fetch(endpoint, { method: 'POST' });
        } catch (_) {}
        ui.restartingKey = null;
        await tick(true);
    }

    // ── Video Player Dialog ─────────────────────────────────────────────────
    function openVideoDialogItem(v) {
        if (!v) return;

        const dlg = $('ov2-video-dialog');
        const vidEl = $('ov2-vd-player');
        const titleEl = $('ov2-vd-title');
        const metaEl = $('ov2-vd-meta');
        const dlBtn = $('ov2-vd-download');
        const edBtn = $('ov2-vd-editor');
        if (!dlg || !vidEl) {
            if (v.watchUrl) window.open(v.watchUrl, '_blank', 'noopener');
            if (v.key && !v.seen) setVideoSeen({ id: v.key, seen: true });
            return;
        }

        titleEl.textContent = v.title || v.key || 'วิดีโอ';
        const parts = [];
        if (v.durationSec) parts.push(`ยาว ${fmtDuration(v.durationSec)}`);
        if (v.sizeBytes) parts.push(fmtMb(v.sizeBytes));
        if (v.costThb != null) parts.push(`ค่าใช้จ่าย ${fmtThb(v.costThb)}`);
        if (v.renderNode) parts.push(`เรนเดอร์บน ${v.renderNode}`);
        metaEl.textContent = parts.join('  /  ') || v.key || '';

        if (dlBtn) {
            dlBtn.href = v.downloadUrl || v.watchUrl || '#';
            dlBtn.style.display = (v.downloadUrl || v.watchUrl) ? 'inline-flex' : 'none';
        }
        if (edBtn) {
            edBtn.href = v.editorUrl || '/video-studio';
            edBtn.style.display = v.editorUrl ? 'inline-flex' : 'none';
        }

        vidEl.src = v.watchUrl || '';
        vidEl.poster = v.thumbUrl || '';
        if (typeof dlg.showModal === 'function') {
            if (!dlg.open) dlg.showModal();
        } else {
            dlg.setAttribute('open', 'open');
        }
        vidEl.play().catch(() => {});

        if (v.key && !v.seen) {
            setVideoSeen({ id: v.key, seen: true });
        }
    }

    function openVideoPlayer(videoKey) {
        const recent = (ui.lastData && ui.lastData.videos && ui.lastData.videos.recent) || [];
        const v = recent.find((item) => item.key === videoKey);
        if (!v) return;
        openVideoDialogItem(v);
    }

    function openFactoryJobPreview(jobId) {
        if (!jobId) return;
        const recent = (ui.lastData && ui.lastData.videos && ui.lastData.videos.recent) || [];
        const matched = recent.find((item) => item.jobId === jobId || item.key === jobId);
        if (matched) {
            openVideoDialogItem(matched);
            return;
        }
        const jobs = (ui.factoryState && Array.isArray(ui.factoryState.jobs)) ? ui.factoryState.jobs : [];
        const j = jobs.find((item) => item && item.id === jobId);
        if (!j) {
            window.open(`/video-studio#qc=${encodeURIComponent(jobId)}`, '_blank', 'noopener');
            return;
        }
        const versions = Array.isArray(j.versions) ? j.versions : [];
        const latest = versions.length ? versions[versions.length - 1] : null;
        const out = j.outputs || {};
        const videoPath = String(latest?.videoPath || out.videoPath || out.finalPath || '').trim();
        const thumbPath = String(latest?.storyboardOutPath || latest?.gifOutPath || out.storyboardOutPath || out.gifOutPath || '').trim();
        const watchUrl = videoPath
            ? `/api/gemini/local-file?path=${encodeURIComponent(videoPath)}`
            : (latest?.watchUrl || out.watchUrl || `/api/video-studio/jobs/${encodeURIComponent(j.id)}/file/final`);
        const downloadUrl = videoPath
            ? `/api/gemini/local-file?path=${encodeURIComponent(videoPath)}&download=1`
            : (latest?.downloadUrl || out.downloadUrl || watchUrl);
        openVideoDialogItem({
            key: normalizeVideoKey(videoPath || j.id),
            title: j.topic || j.id,
            durationSec: Number(latest?.durationSec ?? out.durationSec ?? j.durationSec) || null,
            sizeBytes: Number(latest?.sizeBytes ?? out.sizeBytes) || 0,
            costThb: (out.costDetails?.clipTotalThb ?? latest?.costThb ?? out.costThb) != null
                ? Number(out.costDetails?.clipTotalThb ?? latest?.costThb ?? out.costThb)
                : null,
            renderNode: String(latest?.renderNode || out.renderNode || j.renderNode || ''),
            watchUrl,
            downloadUrl,
            thumbUrl: thumbPath ? `/api/gemini/local-image?path=${encodeURIComponent(thumbPath)}` : '',
            editorUrl: `/video-editor.html?job=${encodeURIComponent(j.id)}`,
            seen: true,
        });
    }

    function closeVideoPlayer() {
        const dlg = $('ov2-video-dialog');
        const vidEl = $('ov2-vd-player');
        if (vidEl) {
            vidEl.pause();
            vidEl.removeAttribute('src');
            vidEl.load();
        }
        if (dlg && dlg.open && typeof dlg.close === 'function') dlg.close();
    }

    // ── Renderers ───────────────────────────────────────────────────────────
    function renderInitialSkeletons() {
        if (ui.lastData) return;
        const kpisEl = $('ov3-kpis');
        if (kpisEl && !kpisEl.querySelector('.ov3-kpi')) {
            kpisEl.innerHTML = Array.from({ length: 6 }, () => `
                <div class="ov3-kpi" data-tone="neutral" aria-hidden="true">
                    <span class="ov3-skel" style="width:54%;height:12px"></span>
                    <span class="ov3-skel" style="width:42%;height:26px"></span>
                    <span class="ov3-skel" style="width:76%;height:12px"></span>
                </div>
            `).join('');
        }
        const attnBody = $('ov3-attn-body');
        if (attnBody && !attnBody.querySelector('.ov3-attn__row')) {
            attnBody.innerHTML = Array.from({ length: 3 }, () => `
                <div class="ov3-attn__row" aria-hidden="true">
                    <span class="ov3-attn__ico"><span class="ov3-skel" style="width:20px;height:20px;border-radius:6px"></span></span>
                    <div class="ov3-attn__main">
                        <span class="ov3-skel" style="width:62%;height:13px"></span>
                        <span class="ov3-skel" style="width:40%;height:11px"></span>
                    </div>
                    <div class="ov3-attn__act"><span class="ov3-skel" style="width:58px;height:26px;border-radius:6px"></span></div>
                </div>
            `).join('');
        }
    }

    function getGreetingByHour(h) {
        if (h >= 5 && h <= 11) return 'อรุณสวัสดิ์, บังยี';
        if (h >= 12 && h <= 16) return 'สวัสดีตอนบ่าย, บังยี';
        if (h >= 17 && h <= 21) return 'สวัสดีตอนเย็น, บังยี';
        return 'ดึกแล้วนะคะ, บังยี';
    }

    function updateFreshness() {
        const now = new Date();
        const greetEl = $('ov3-greet');
        if (greetEl) {
            const nextGreet = getGreetingByHour(now.getHours());
            if (greetEl.textContent !== nextGreet) greetEl.textContent = nextGreet;
        }
        const dateEl = $('ov3-date');
        if (dateEl) {
            const nextDate = now.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' });
            if (dateEl.textContent !== nextDate) dateEl.textContent = nextDate;
        }

        const freshEl = $('ov3-fresh');
        const metaEl = $('ov2-status-meta');
        if (!metaEl) return;

        if (!ui.lastUpdatedAt) {
            if (freshEl) freshEl.removeAttribute('data-stale');
            metaEl.textContent = 'กำลังเชื่อมต่อ…';
            return;
        }

        const diffMs = Math.max(0, Date.now() - ui.lastUpdatedAt);
        const sec = Math.floor(diffMs / 1000);
        if (sec > 60) {
            if (freshEl) freshEl.setAttribute('data-stale', '1');
            metaEl.textContent = `ข้อมูลอาจไม่สด · ${relTime(diffMs)}`;
        } else {
            if (freshEl) freshEl.removeAttribute('data-stale');
            metaEl.textContent = sec < 2 ? 'อัปเดตล่าสุดเมื่อสักครู่' : `อัปเดตล่าสุด ${sec} วินาทีที่แล้ว`;
        }
        updateQuotaCountdowns();
    }

    function getBvAlerts() {
        try {
            if (window.HomelabBVAlerts && typeof window.HomelabBVAlerts.list === 'function') {
                const arr = window.HomelabBVAlerts.list();
                return Array.isArray(arr) ? arr : [];
            }
        } catch (_) {}
        return [];
    }

    function bvAlertBadgeLabel(kind) {
        const k = String(kind || 'login').toLowerCase();
        if (k === 'captcha') return '🛡️ CAPTCHA';
        if (k === 'otp') return '🔢 รหัส OTP';
        if (k === 'payment') return '💳 ชำระเงิน';
        if (k === 'social_upload') return '📤 โซเชียล BV';
        if (k === 'handoff') return '🤝 รอดำเนินการ';
        if (k === 'paused') return '⏸️ หยุดรอ';
        return '🔐 ล็อกอิน BV';
    }

    function renderHeader(data) {
        updateFreshness();
        if (!data) return;

        const att = data.attention || {};
        const bvCount = getBvAlerts().length;
        const pillEl = $('ov3-status-pill');
        const dotEl = $('ov2-status-dot');
        const sumEl = $('ov2-status-summary');

        const parts = [];
        if (bvCount > 0) parts.push(`รอล็อกอิน BV ${bvCount}`);
        if (att.servicesDown > 0) parts.push(`บริการมีปัญหา ${att.servicesDown}`);
        if (att.aiRunning > 0) parts.push(`AI กำลังทำ ${att.aiRunning} แชท`);
        if (att.aiUnread > 0) parts.push(`ยังไม่อ่าน ${att.aiUnread}`);
        if (att.videosUnseen > 0) parts.push(`วิดีโอยังไม่ดู ${att.videosUnseen}`);
        if (att.rendersActive > 0) parts.push(`กำลังเรนเดอร์ ${att.rendersActive}`);

        const tone = (att.servicesDown > 0 || bvCount > 0) ? 'err' : (parts.length > 0 ? 'warn' : 'ok');

        if (pillEl) pillEl.setAttribute('data-tone', tone);
        if (dotEl) {
            dotEl.className = 'ov2-status-dot' + (tone === 'err' ? ' is-err' : (tone === 'warn' ? ' is-warn' : ''));
        }
        if (sumEl) {
            sumEl.textContent = parts.length ? parts.join(' · ') : 'ทุกระบบปกติ ไม่มีงานค้างที่ต้องดู';
        }
    }

    function attnIcon(kind) {
        if (kind === 'bv') {
            return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
        }
        if (kind === 'problem') {
            return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
        }
        if (kind === 'chat') {
            return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
        }
        if (kind === 'video') {
            return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
        }
        return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>';
    }

    function buildAttentionItems(data) {
        const items = [];
        const infra = (data && data.infra) || {};
        const ai = (data && data.ai) || {};
        const vids = (data && data.videos) || {};
        const agents = (data && data.agents) || {};

        // 0. Global Browser Vision Sticky Alerts (top priority — user action required)
        for (const bv of getBvAlerts()) {
            const metaParts = [
                bv.roomTitle || '',
                bv.platform ? bv.platform.toUpperCase() : '',
                bv.domain || '',
                bv.detail || '',
                bv.ts ? fmtRelTime(bv.ts) : '',
            ].filter(Boolean);
            const canResume = Boolean(bv.chatId || bv.sessionName);
            const actionsHtml = `<button type="button" class="ov2-btn ov2-btn--xs ov2-btn--primary" data-bv-open="${esc(bv.id)}">เปิดล็อกอิน</button>`
                + (canResume ? `<button type="button" class="ov2-btn ov2-btn--xs ov2-btn--ghost" data-bv-resume="${esc(bv.id)}" title="เสร็จแล้วให้ AI ทำต่อ">ทำต่อ</button>` : '');
            items.push({
                kind: 'bv',
                rowKind: 'problem',
                title: bv.title || 'ต้องล็อกอินใน Browser Vision',
                badge: { text: bvAlertBadgeLabel(bv.kind), tone: 'err' },
                meta: metaParts.join(' · '),
                actionsHtml,
            });
        }

        // 1. Infrastructure problems & failed renders (highest priority)
        for (const p of (infra.problems || [])) {
            const canRestartPm2 = p.kind === 'pm2' && ['pm2-ui', 'onepercentbot'].includes(p.name);
            const canRestartDocker = p.kind === 'docker' && String(p.name || '').startsWith('lab-');
            const busy = ui.restartingKey === `${p.kind}:${p.name}`;
            let actionsHtml = '';
            if (canRestartPm2 || canRestartDocker) {
                actionsHtml = `<button type="button" class="ov2-btn ov2-btn--xs" data-restart-kind="${esc(p.kind)}" data-restart-name="${esc(p.name)}" ${busy ? 'disabled' : ''}>${busy ? '…' : 'รีสตาร์ท'}</button>`;
            } else if (p.url) {
                actionsHtml = `<a class="ov2-btn ov2-btn--xs" href="${esc(p.url)}" target="_blank" rel="noopener">ตรวจสอบ</a>`;
            } else {
                actionsHtml = `<button type="button" class="ov2-btn ov2-btn--xs ov2-btn--ghost" data-jump-infra="problems">ดูบริการ</button>`;
            }
            items.push({
                kind: 'problem',
                title: p.name || 'บริการมีปัญหา',
                badge: { text: p.kind || 'problem', tone: 'err' },
                meta: [p.status, p.detail].filter(Boolean).join(' · '),
                actionsHtml,
            });
        }

        for (const f of (vids.failedRecent || [])) {
            items.push({
                kind: 'problem',
                title: f.topic || f.id || 'งานเรนเดอร์ล้มเหลว',
                badge: { text: 'เรนเดอร์ล้มเหลว', tone: 'err' },
                meta: [f.message || f.status, f.updatedAt ? fmtRelTime(f.updatedAt) : ''].filter(Boolean).join(' · '),
                actionsHtml: '<a class="ov2-btn ov2-btn--xs" href="/video-studio">ตรวจสอบ</a>',
            });
        }

        // 2. Active video renders & non-overlapping Agent Hub jobs
        const activeVidJobs = vids.activeJobs || [];
        for (const j of activeVidJobs) {
            const pct = Math.round(clampPct(j.progress));
            items.push({
                kind: 'job',
                title: j.topic || j.id || 'งานสร้างวิดีโอ',
                badge: { text: `เรนเดอร์ ${pct}%`, tone: 'ok' },
                meta: ['Video Studio', j.stage || j.status, j.message || '', j.updatedAt ? fmtRelTime(j.updatedAt) : ''].filter(Boolean).join(' · '),
                actionsHtml: '<a class="ov2-btn ov2-btn--xs" href="/video-studio">เปิดสตูดิโอ</a>',
            });
        }

        for (const aj of (agents.activeJobs || [])) {
            if (activeVidJobs.length > 0 && (aj.kind === 'remotion' || aj.name === 'motion-mix' || aj.name === 'motion-preview')) {
                continue;
            }
            const pct = Math.round(clampPct(aj.progress));
            items.push({
                kind: 'job',
                title: aj.name || aj.kind || 'งานลูกข่าย',
                badge: { text: `${pct}%`, tone: 'ok' },
                meta: [aj.nodeName || aj.nodeId || 'Agent', aj.kind, aj.message || aj.status].filter(Boolean).join(' · '),
                actionsHtml: '<a class="ov2-btn ov2-btn--xs" href="/agent-hub">ดูงาน</a>',
            });
        }

        // 3. Running & unread AI chats
        for (const s of (ai.running || [])) {
            const snip = cleanStepText(s.stepText) || s.lastMessage || '';
            items.push({
                kind: 'chat',
                title: s.title || 'แชท AI',
                badge: { text: s.elapsedMs ? `กำลังทำ ${fmtElapsed(s.elapsedMs)}` : 'กำลังทำ', tone: 'ok' },
                meta: [s.model || 'auto', snip].filter(Boolean).join(' · '),
                actionsHtml: `<button type="button" class="ov2-btn ov2-btn--xs ov2-btn--primary" data-open-chat="${esc(s.id)}">ติดตาม</button>`,
            });
        }

        for (const s of (ai.unread || [])) {
            const timeText = fmtRelTime(s.lastCompletedAt || s.updatedAt);
            items.push({
                kind: 'chat',
                title: s.title || 'แชท AI',
                badge: { text: 'ยังไม่อ่าน', tone: 'warn' },
                meta: [s.model || 'auto', s.lastMessage || '', timeText].filter(Boolean).join(' · '),
                actionsHtml: `<button type="button" class="ov2-btn ov2-btn--xs ov2-btn--ghost" data-mark-chat-read="${esc(s.id)}" title="ทำเครื่องหมายว่าอ่านแล้ว">อ่านแล้ว</button><button type="button" class="ov2-btn ov2-btn--xs ov2-btn--primary" data-open-chat="${esc(s.id)}">เปิดอ่าน</button>`,
            });
        }

        // 4. Unseen completed videos
        for (const v of (vids.unseen || [])) {
            const metaParts = [];
            if (v.durationSec) metaParts.push(fmtDuration(v.durationSec));
            if (v.sizeBytes) metaParts.push(fmtMb(v.sizeBytes));
            if (v.costThb != null) metaParts.push(fmtThb(v.costThb));
            if (v.renderNode) metaParts.push(v.renderNode);
            if (v.createdAtMs) metaParts.push(fmtRelTime(v.createdAtMs));
            items.push({
                kind: 'video',
                title: v.title || v.key || 'วิดีโอใหม่',
                badge: { text: 'ยังไม่ดู', tone: 'warn' },
                meta: metaParts.join(' · '),
                actionsHtml: `<button type="button" class="ov2-btn ov2-btn--xs ov2-btn--ghost" data-toggle-video-seen="${esc(v.key)}" data-next-seen="1" title="ทำเครื่องหมายว่าดูแล้ว">ดูแล้ว</button><button type="button" class="ov2-btn ov2-btn--xs ov2-btn--primary" data-play-video="${esc(v.key)}">ดูคลิป</button>`,
            });
        }

        return items;
    }

    function renderAttention(data) {
        const subEl = $('ov3-attn-sub');
        const bodyEl = $('ov3-attn-body');
        if (!bodyEl) return;

        const items = buildAttentionItems(data);
        if (subEl) {
            subEl.textContent = items.length > 0 ? `${items.length} รายการที่ต้องดูแล` : 'ทุกอย่างเรียบร้อย';
        }

        if (items.length === 0) {
            ui.attnExpanded = false;
            bodyEl.innerHTML = `
                <div class="ov3-empty">
                    <div class="ov3-empty__title">ทุกระบบปกติ ไม่มีรายการรอบังยีอยู่</div>
                    <div class="ov3-empty__sub">แชท AI อ่านครบแล้ว · วิดีโอดูครบแล้ว · บริการทั้งหมดออนไลน์</div>
                </div>
            `;
            return;
        }

        const visible = ui.attnExpanded ? items : items.slice(0, ATTN_COLLAPSED_LIMIT);
        const rowsHtml = visible.map((item) => `
            <div class="ov3-attn__row" data-kind="${esc(item.rowKind || item.kind)}">
                <span class="ov3-attn__ico" aria-hidden="true">${attnIcon(item.kind)}</span>
                <div class="ov3-attn__main">
                    <div class="ov3-attn__title">
                        <span>${esc(item.title)}</span>
                        ${item.badge ? `<span class="ov3-badge" data-tone="${esc(item.badge.tone)}">${esc(item.badge.text)}</span>` : ''}
                    </div>
                    ${item.meta ? `<div class="ov3-attn__meta">${esc(item.meta)}</div>` : ''}
                </div>
                <div class="ov3-attn__act">${item.actionsHtml}</div>
            </div>
        `).join('');

        const toggleHtml = items.length > ATTN_COLLAPSED_LIMIT
            ? `<div class="ov3-attn__footer"><button type="button" class="ov2-btn ov2-btn--xs ov2-btn--ghost" data-attn-toggle="${ui.attnExpanded ? '0' : '1'}">${ui.attnExpanded ? 'แสดงน้อยลง' : `ดูทั้งหมด (${items.length})`}</button></div>`
            : '';

        bodyEl.innerHTML = rowsHtml + toggleHtml;
    }

    function renderKpis(data) {
        const kpisEl = $('ov3-kpis');
        if (!kpisEl) return;

        const att = data.attention || {};
        const ai = data.ai || {};
        const vids = data.videos || {};
        const agents = data.agents || {};
        const host = data.host || {};
        const infra = data.infra || {};
        const pm2 = infra.pm2 || { online: 0, total: 0 };
        const docker = infra.docker || { running: 0, total: 0 };
        const en = infra.energy || {};
        const rt = en.realtime || {};
        const td = en.today || {};
        const mo = en.this_month || {};

        const attnCount = buildAttentionItems(data).length;
        const activityPending = (att.aiRunning || 0) + (att.aiUnread || 0) + (att.videosUnseen || 0) + (att.rendersActive || 0);

        const actParts = [];
        if (att.aiRunning > 0) actParts.push(`AI ทำ ${att.aiRunning}`);
        if (att.aiUnread > 0) actParts.push(`รออ่าน ${att.aiUnread}`);
        if (att.videosUnseen > 0) actParts.push(`ยังไม่ดู ${att.videosUnseen}`);
        if (att.rendersActive > 0) actParts.push(`เรนเดอร์ ${att.rendersActive}`);

        const hostCpu = host.cpu && host.cpu.pct != null ? clampPct(host.cpu.pct) : null;
        const hostCores = (host.cpu && host.cpu.count) || 0;
        const load1m = (host.load && host.load[0] != null) ? Number(host.load[0]).toFixed(2) : '—';

        const hostMemPct = host.mem && host.mem.pct != null ? clampPct(host.mem.pct) : null;
        const hostMemUsed = (host.mem && host.mem.used) || 0;
        const hostMemTotal = (host.mem && host.mem.total) || 0;

        const wattsVal = rt.power_watts != null && Number.isFinite(Number(rt.power_watts))
            ? Math.round(Number(rt.power_watts))
            : null;

        const cards = [
            {
                key: 'attention',
                label: 'ต้องดูแลตอนนี้',
                val: String(attnCount),
                ctx: att.servicesDown > 0
                    ? `บริการมีปัญหา ${att.servicesDown} รายการ`
                    : (attnCount > 0
                        ? `รอตรวจ ${attnCount} รายการ`
                        : `PM2 ${pm2.online}/${pm2.total} · Docker ${docker.running}/${docker.total}`),
                tone: att.servicesDown > 0 ? 'err' : (attnCount > 0 ? 'warn' : 'ok'),
                jump: '#ov3-attn',
                spark: '',
            },
            {
                key: 'activity',
                label: 'AI & วิดีโอ',
                val: String(activityPending),
                ctx: actParts.length > 0
                    ? actParts.slice(0, 2).join(' · ')
                    : `${ai.totalSessions || 0} แชท · ${vids.totalCompleted || 0} คลิป`,
                tone: (att.aiUnread > 0 || att.videosUnseen > 0) ? 'warn' : ((att.aiRunning > 0 || att.rendersActive > 0) ? 'ok' : 'neutral'),
                jump: '#ov3-activity',
                spark: '',
            },
            {
                key: 'agents',
                label: 'Agent ออนไลน์',
                val: `${att.agentsOnline || 0}/${att.agentsTotal || 0}`,
                ctx: agents.onlineNodes > 0
                    ? `${agents.totalThreads || 0} เธรด · ${fmtGb(agents.totalRamBytes)} GB`
                    : 'ไม่มีเครื่องลูกออนไลน์',
                tone: att.agentsOnline > 0 ? 'ok' : (att.agentsTotal > 0 ? 'warn' : 'neutral'),
                jump: '#ov2-panel-nodes',
                spark: '',
            },
            {
                key: 'cpu',
                label: 'CPU หลัก',
                val: hostCpu != null ? `${hostCpu.toFixed(0)}%` : '—',
                ctx: `${hostCores} คอร์ · load ${load1m}${host.peakTempC != null ? ` · ${host.peakTempC.toFixed(0)}°C` : ''}`,
                tone: hostCpu == null ? 'neutral' : (hostCpu >= 88 ? 'err' : (hostCpu >= 75 ? 'warn' : 'neutral')),
                jump: '#ov2-panel-nodes',
                spark: sparkline(ui.hist.cpu, { w: 120, h: 28 }),
            },
            {
                key: 'ram',
                label: 'RAM หลัก',
                val: hostMemPct != null ? `${hostMemPct.toFixed(0)}%` : '—',
                ctx: hostMemTotal > 0 ? `${fmtGb(hostMemUsed)} / ${fmtGb(hostMemTotal)} GB` : '—',
                tone: hostMemPct == null ? 'neutral' : (hostMemPct >= 88 ? 'err' : (hostMemPct >= 75 ? 'warn' : 'neutral')),
                jump: '#ov2-panel-nodes',
                spark: sparkline(ui.hist.ram, { w: 120, h: 28 }),
            },
            {
                key: 'watts',
                label: 'ไฟฟ้าบ้าน',
                val: wattsVal != null ? `${wattsVal.toLocaleString('th-TH')} W` : '—',
                ctx: td.cost_thb != null
                    ? `วันนี้ ${fmtThb(td.cost_thb)}${mo.cost_thb != null ? ` · เดือน ${fmtThb(mo.cost_thb)}` : ''}`
                    : 'กำลังรอข้อมูล PZEM-01',
                tone: wattsVal == null ? 'neutral' : (wattsVal >= 3000 ? 'err' : (wattsVal >= 2000 ? 'warn' : 'neutral')),
                jump: '#ov2-panel-energy',
                spark: sparkline(ui.hist.watts, { w: 120, h: 28 }),
            },
        ];

        // Replace skeleton markup with real KPI buttons on first data arrival, then patch in place
        const hasRealButtons = kpisEl.querySelectorAll('button.ov3-kpi[data-kpi-key]').length === cards.length;
        if (!hasRealButtons) {
            kpisEl.innerHTML = cards.map((c) => `
                <button type="button" class="ov3-kpi" data-kpi-key="${esc(c.key)}" data-tone="${esc(c.tone)}" data-jump="${esc(c.jump)}">
                    <span class="ov3-kpi__label">${esc(c.label)}</span>
                    <span class="ov3-kpi__value">${esc(c.val)}</span>
                    <span class="ov3-kpi__ctx">${esc(c.ctx)}</span>
                    ${c.spark ? `<span class="ov3-kpi__spark" aria-hidden="true">${c.spark}</span>` : ''}
                </button>
            `).join('');
            for (const c of cards) ui.prevKpiVals[c.key] = c.val;
            return;
        }

        for (const c of cards) {
            const cardEl = kpisEl.querySelector(`button.ov3-kpi[data-kpi-key="${c.key}"]`);
            if (!cardEl) continue;
            cardEl.setAttribute('data-tone', c.tone);
            cardEl.setAttribute('data-jump', c.jump);
            const lblEl = cardEl.querySelector('.ov3-kpi__label');
            const valEl = cardEl.querySelector('.ov3-kpi__value');
            const ctxEl = cardEl.querySelector('.ov3-kpi__ctx');
            if (lblEl && lblEl.textContent !== c.label) lblEl.textContent = c.label;
            if (valEl && valEl.textContent !== c.val) valEl.textContent = c.val;
            if (ctxEl && ctxEl.textContent !== c.ctx) ctxEl.textContent = c.ctx;

            let sparkEl = cardEl.querySelector('.ov3-kpi__spark');
            if (c.spark) {
                if (!sparkEl) {
                    sparkEl = document.createElement('span');
                    sparkEl.className = 'ov3-kpi__spark';
                    sparkEl.setAttribute('aria-hidden', 'true');
                    cardEl.appendChild(sparkEl);
                }
                sparkEl.innerHTML = c.spark;
            } else if (sparkEl) {
                sparkEl.remove();
            }

            const prevVal = ui.prevKpiVals[c.key];
            if (prevVal !== undefined && prevVal !== c.val) {
                cardEl.classList.remove('is-changed');
                void cardEl.offsetWidth;
                cardEl.classList.add('is-changed');
                if (ui.kpiFlashTimers[c.key]) clearTimeout(ui.kpiFlashTimers[c.key]);
                ui.kpiFlashTimers[c.key] = setTimeout(() => {
                    cardEl.classList.remove('is-changed');
                    delete ui.kpiFlashTimers[c.key];
                }, 600);
            }
            ui.prevKpiVals[c.key] = c.val;
        }
    }

    function renderActivityTabs(data) {
        const ai = (data && data.ai) || { runningCount: 0, unreadCount: 0, totalSessions: 0 };
        const vids = (data && data.videos) || { activeCount: 0, unseenCount: 0, totalCompleted: 0 };
        const agentActiveCount = (data && data.agents && data.agents.activeJobs) ? data.agents.activeJobs.length : 0;
        const aiAttn = (ai.runningCount || 0) + (ai.unreadCount || 0);
        const vidAttn = (vids.unseenCount || 0) + (vids.activeCount || 0) + agentActiveCount;

        const tabsEl = $('ov3-activity-tabs');
        if (tabsEl) {
            const tabs = [
                {
                    id: 'ai',
                    label: 'แชท AI',
                    count: aiAttn > 0 ? aiAttn : (ai.totalSessions || 0),
                    tone: ai.runningCount > 0 ? 'ok' : (ai.unreadCount > 0 ? 'warn' : 'neutral'),
                },
                {
                    id: 'videos',
                    label: 'วิดีโอ & เรนเดอร์',
                    count: vidAttn > 0 ? vidAttn : (vids.totalCompleted || 0),
                    tone: (vids.activeCount > 0 || agentActiveCount > 0) ? 'ok' : (vids.unseenCount > 0 ? 'warn' : 'neutral'),
                },
            ];
            tabsEl.innerHTML = tabs.map((t) => `
                <button type="button" class="ov3-tab" role="tab" aria-selected="${ui.activityTab === t.id ? 'true' : 'false'}" data-activity-tab="${t.id}">
                    <span>${esc(t.label)}</span>
                    <span class="ov3-badge" data-tone="${esc(t.tone)}">${esc(t.count)}</span>
                </button>
            `).join('');
        }

        const isAi = ui.activityTab !== 'videos';
        const aiPane = $('ov2-panel-ai');
        const vidPane = $('ov2-panel-videos');
        const subEl = $('ov3-activity-sub');
        const aiMarkAll = $('ov2-ai-mark-all');
        const vidMarkAll = $('ov2-vid-mark-all');
        const openAiLink = $('ov3-activity-open-ai');
        const openVidLink = $('ov3-activity-open-vid');

        if (aiPane) aiPane.hidden = !isAi;
        if (vidPane) vidPane.hidden = isAi;
        if (subEl) {
            subEl.textContent = isAi
                ? `${ai.totalSessions || 0} แชททั้งหมด`
                : `${vids.totalCompleted || 0} คลิปที่เสร็จแล้ว`;
        }
        if (aiMarkAll) aiMarkAll.style.display = (isAi && ai.unreadCount > 0) ? 'inline-flex' : 'none';
        if (vidMarkAll) vidMarkAll.style.display = (!isAi && vids.unseenCount > 0) ? 'inline-flex' : 'none';
        if (openAiLink) openAiLink.style.display = isAi ? 'inline-flex' : 'none';
        if (openVidLink) openVidLink.style.display = !isAi ? 'inline-flex' : 'none';
    }

    function renderAiPanel(data) {
        const ai = data.ai || { running: [], unread: [], recent: [], runningCount: 0, unreadCount: 0, totalSessions: 0 };
        const tabsEl = $('ov2-ai-tabs');
        const bodyEl = $('ov2-ai-body');
        const markAllBtn = $('ov2-ai-mark-all');

        if (markAllBtn) markAllBtn.style.display = (ui.activityTab !== 'videos' && ai.unreadCount > 0) ? 'inline-flex' : 'none';

        const attentionCount = (ai.runningCount || 0) + (ai.unreadCount || 0);
        if (tabsEl) {
            tabsEl.innerHTML = [
                { id: 'attention', label: 'ต้องดู', count: attentionCount, tone: ai.runningCount > 0 ? 'ok' : (ai.unreadCount > 0 ? 'warn' : 'neutral') },
                { id: 'unread', label: 'ยังไม่อ่าน', count: ai.unreadCount || 0, tone: ai.unreadCount > 0 ? 'warn' : 'neutral' },
                { id: 'recent', label: 'แชทล่าสุด', count: (ai.recent || []).length, tone: 'neutral' },
            ].map((t) => `
                <button type="button" class="ov3-tab" role="tab" aria-selected="${ui.aiTab === t.id ? 'true' : 'false'}" data-ai-tab="${t.id}">
                    <span>${esc(t.label)}</span>
                    <span class="ov3-badge" data-tone="${esc(t.tone)}">${esc(t.count)}</span>
                </button>
            `).join('');
        }

        if (!bodyEl) return;

        const renderChatRow = (s) => {
            const cls = s.running ? ' is-running' : (s.unread ? ' is-unread' : '');
            const statusBadge = s.running
                ? `<span class="ov3-badge" data-tone="ok">กำลังทำ${s.elapsedMs ? ` ${esc(fmtElapsed(s.elapsedMs))}` : ''}</span>`
                : (s.unread ? '<span class="ov3-badge" data-tone="warn">ยังไม่อ่าน</span>' : '');
            const stepClean = s.running ? cleanStepText(s.stepText) : '';
            const snip = stepClean || s.lastMessage || '';
            const timeText = fmtRelTime(s.lastCompletedAt || s.updatedAt);
            return `
                <div class="ov2-chat-row${cls}">
                    <a class="ov2-chat-main" href="/gemini" data-open-chat="${esc(s.id)}">
                        <div class="ov2-chat-title-row">
                            <span class="ov2-chat-title">${esc(s.title)}</span>
                            ${statusBadge}
                        </div>
                        ${snip ? `<div class="ov2-chat-snip">${esc(snip)}</div>` : ''}
                        <div class="ov2-chat-meta">
                            <span class="ov2-mono">${esc(s.model || 'auto')}</span>
                            ${s.messageCount ? `<span>${esc(s.messageCount)} ข้อความ</span>` : ''}
                            ${timeText ? `<span>${esc(timeText)}</span>` : ''}
                        </div>
                    </a>
                    <div class="ov2-chat-actions">
                        ${s.unread ? `<button type="button" class="ov2-btn ov2-btn--xs ov2-btn--ghost" data-mark-chat-read="${esc(s.id)}" title="ทำเครื่องหมายว่าอ่านแล้ว">อ่านแล้ว</button>` : ''}
                        <button type="button" class="ov2-btn ov2-btn--xs ov2-btn--primary" data-open-chat="${esc(s.id)}">เปิด</button>
                    </div>
                </div>
            `;
        };

        if (ui.aiTab === 'attention') {
            const primary = [...(ai.running || []), ...(ai.unread || [])];
            const primaryIds = new Set(primary.map((x) => x.id));
            const filler = (ai.recent || []).filter((x) => !primaryIds.has(x.id)).slice(0, Math.max(0, 6 - primary.length));
            if (primary.length === 0 && filler.length === 0) {
                bodyEl.innerHTML = '<div class="ov3-empty">ยังไม่มีประวัติแชท AI</div>';
                return;
            }
            const blocks = [];
            if (primary.length > 0) {
                blocks.push(`<div class="ov2-list">${primary.map(renderChatRow).join('')}</div>`);
                if (filler.length > 0) {
                    blocks.push('<div class="ov2-sub-divider">แชทล่าสุด</div>');
                    blocks.push(`<div class="ov2-list">${filler.map(renderChatRow).join('')}</div>`);
                }
            } else {
                blocks.push('<div class="ov3-card__sub" style="padding:2px 4px 4px;">ไม่มีแชทกำลังทำหรือยังไม่อ่าน — แสดงแชทล่าสุด</div>');
                blocks.push(`<div class="ov2-list">${filler.map(renderChatRow).join('')}</div>`);
            }
            bodyEl.innerHTML = blocks.join('');
            return;
        }

        const items = ui.aiTab === 'unread' ? (ai.unread || []) : (ai.recent || []).slice(0, 8);
        if (items.length === 0) {
            bodyEl.innerHTML = `<div class="ov3-empty">${ui.aiTab === 'unread' ? 'อ่านแชท AI ครบทุกรายการแล้ว' : 'ยังไม่มีประวัติแชท AI'}</div>`;
            return;
        }
        bodyEl.innerHTML = `<div class="ov2-list">${items.map(renderChatRow).join('')}</div>`;
    }

    function renderVideosPanel(data) {
        const vids = data.videos || { activeJobs: [], unseen: [], recent: [], activeCount: 0, unseenCount: 0, totalCompleted: 0 };
        const agentActive = (data.agents && data.agents.activeJobs) || [];
        const tabsEl = $('ov2-vid-tabs');
        const bodyEl = $('ov2-vid-body');
        const markAllBtn = $('ov2-vid-mark-all');

        if (markAllBtn) markAllBtn.style.display = (ui.activityTab === 'videos' && vids.unseenCount > 0) ? 'inline-flex' : 'none';

        const activeTotal = (vids.activeCount || 0) + agentActive.length;
        if (tabsEl) {
            tabsEl.innerHTML = [
                { id: 'unseen', label: 'ยังไม่ดู', count: vids.unseenCount || 0, tone: vids.unseenCount > 0 ? 'warn' : 'neutral' },
                { id: 'all', label: 'ทั้งหมด', count: vids.totalCompleted || 0, tone: 'neutral' },
                { id: 'active', label: 'กำลังเรนเดอร์', count: activeTotal, tone: activeTotal > 0 ? 'ok' : 'neutral' },
            ].map((t) => `
                <button type="button" class="ov3-tab" role="tab" aria-selected="${ui.videoTab === t.id ? 'true' : 'false'}" data-vid-tab="${t.id}">
                    <span>${esc(t.label)}</span>
                    <span class="ov3-badge" data-tone="${esc(t.tone)}">${esc(t.count)}</span>
                </button>
            `).join('');
        }

        if (!bodyEl) return;

        // Active render banners (Video Studio + Agent Hub)
        const activeCards = [];
        for (const j of (vids.activeJobs || [])) {
            const pct = clampPct(j.progress);
            activeCards.push(`
                <div class="ov2-render-banner">
                    <div class="ov2-render-top">
                        <span>${esc(j.topic || j.id)}</span>
                        <span class="ov2-mono">${Math.round(pct)}%</span>
                    </div>
                    <div class="ov3-bar"><span class="ov3-bar__fill" data-tone="ok" style="width:${pct.toFixed(0)}%"></span></div>
                    <div class="ov2-render-sub">Video Studio · ขั้นตอน: ${esc(j.stage || j.status)}${j.message ? ` — ${esc(j.message)}` : ''}</div>
                </div>
            `);
        }
        for (const aj of agentActive) {
            const pct = clampPct(aj.progress);
            activeCards.push(`
                <div class="ov2-render-banner">
                    <div class="ov2-render-top">
                        <span>${esc(aj.name || aj.kind)} (${esc(aj.nodeName || aj.nodeId || 'Agent')})</span>
                        <span class="ov2-mono">${Math.round(pct)}%</span>
                    </div>
                    <div class="ov3-bar"><span class="ov3-bar__fill" data-tone="ok" style="width:${pct.toFixed(0)}%"></span></div>
                    <div class="ov2-render-sub">${esc(aj.kind)} · ${esc(aj.status)}${aj.message ? ` — ${esc(aj.message)}` : ''}</div>
                </div>
            `);
        }

        if (ui.videoTab === 'active') {
            bodyEl.innerHTML = activeCards.length
                ? activeCards.join('')
                : '<div class="ov3-empty">ขณะนี้ไม่มีงานเรนเดอร์หรือสร้างวิดีโอที่กำลังทำงาน</div>';
            return;
        }

        let list = ui.videoTab === 'unseen' ? (vids.unseen || []) : (vids.recent || []);
        let fallbackNote = '';
        if (ui.videoTab === 'unseen' && list.length === 0) {
            list = (vids.recent || []).slice(0, 5);
            if (list.length > 0) fallbackNote = 'ดูวิดีโอครบทุกคลิปแล้ว — แสดงคลิปล่าสุด';
        }

        const listSlice = list.slice(0, 7);
        if (listSlice.length === 0 && activeCards.length === 0) {
            bodyEl.innerHTML = '<div class="ov3-empty">ยังไม่มีวิดีโอที่สร้างเสร็จ — กด "สร้างคลิป" เพื่อเริ่มงานใหม่</div>';
            return;
        }

        const noteHtml = fallbackNote ? `<div class="ov3-card__sub" style="padding:2px 4px 4px;">${esc(fallbackNote)}</div>` : '';
        const rowsHtml = listSlice.map((v) => {
            const meta = [];
            if (v.durationSec) meta.push(fmtDuration(v.durationSec));
            if (v.sizeBytes) meta.push(fmtMb(v.sizeBytes));
            if (v.costThb != null) meta.push(fmtThb(v.costThb));
            if (v.renderNode) meta.push(v.renderNode);
            if (v.createdAtMs) meta.push(fmtRelTime(v.createdAtMs));
            return `
                <div class="ov2-video-row${v.seen ? '' : ' is-unseen'}">
                    <div class="ov2-video-thumb" data-play-video="${esc(v.key)}" role="button" tabindex="0" title="คลิกเพื่อเล่นวิดีโอ">
                        ${v.thumbUrl ? `<img src="${esc(v.thumbUrl)}" alt="" decoding="async">` : '<span class="ov2-video-thumb-ph">▶</span>'}
                    </div>
                    <div class="ov2-video-info">
                        <div class="ov2-video-title" title="${esc(v.title)}">
                            ${!v.seen ? '<span class="ov3-badge" data-tone="warn" style="margin-right:6px;">ใหม่</span>' : ''}${esc(v.title)}
                        </div>
                        <div class="ov2-video-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('<span>·</span>')}</div>
                    </div>
                    <div class="ov2-video-actions">
                        <button type="button" class="ov2-btn ov2-btn--xs ov2-btn--primary" data-play-video="${esc(v.key)}">ดู</button>
                        <button type="button" class="ov2-btn ov2-btn--xs ov2-btn--ghost" data-toggle-video-seen="${esc(v.key)}" data-next-seen="${v.seen ? '0' : '1'}" title="${v.seen ? 'ทำเป็นยังไม่ได้ดู' : 'ทำเครื่องหมายว่าดูแล้ว'}">${v.seen ? 'ยังไม่ดู' : 'ดูแล้ว'}</button>
                    </div>
                </div>
            `;
        }).join('');

        bodyEl.innerHTML = activeCards.join('') + noteHtml + `<div class="ov2-list">${rowsHtml}</div>`;
    }

    function renderResourceMatrix(data) {
        const host = data.host || {};
        const agents = data.agents || { nodes: [], onlineNodes: 0, totalNodes: 0 };
        const infra = data.infra || {};
        const pm2 = infra.pm2 || { online: 0, total: 0 };
        const docker = infra.docker || { running: 0, total: 0 };
        const subEl = $('ov2-nodes-sub');
        const tbody = $('ov2-matrix-body');
        const mobEl = $('ov2-nodes-mobile');

        const hostCpu = clampPct(host.cpu && host.cpu.pct);
        const hostCores = (host.cpu && host.cpu.count) || 0;
        const hostMemTotal = (host.mem && host.mem.total) || 0;
        const hostMemUsed = (host.mem && host.mem.used) || 0;
        const hostMemPct = clampPct(host.mem && host.mem.pct);
        const rootDisk = (host.disks || []).find((d) => d && d.mount === '/') || (host.disks || [])[0] || null;

        // homelab host is always row 1, followed by online agents, then offline agents
        const sortedAgents = [...(agents.nodes || [])].sort((a, b) => Number(Boolean(b.online)) - Number(Boolean(a.online)));

        const allMachines = [
            {
                isHost: true,
                online: true,
                displayName: `${host.hostname || 'homelab'} (เซิร์ฟเวอร์หลัก)`,
                sub: `Linux · uptime ${fmtUptime(host.uptimeSec)}`,
                cpuPct: hostCpu,
                cpuMeta: `${hostCores} คอร์ · load ${(host.load && host.load[0] != null) ? Number(host.load[0]).toFixed(2) : '—'}`,
                memUsed: hostMemUsed,
                memTotal: hostMemTotal,
                memPct: hostMemPct,
                gpuPrimary: rootDisk ? `Disk / ${Number(rootDisk.usedPct || 0).toFixed(0)}%` : 'CPU Only',
                gpuSecondary: [
                    host.peakTempC != null ? `อุณหภูมิ ${host.peakTempC.toFixed(0)}°C` : null,
                    `↓ ${fmtRate(ui.lastRate.rx)} ↑ ${fmtRate(ui.lastRate.tx)}`,
                ].filter(Boolean).join(' · '),
                gpuPct: null,
                jobMain: `PM2 ${pm2.online}/${pm2.total} · Docker ${docker.running}/${docker.total}`,
                jobSub: data.ai && data.ai.runningCount > 0 ? `AI กำลังทำงาน ${data.ai.runningCount} แชท` : 'ทำงานปกติ',
                busy: Boolean(data.ai && data.ai.runningCount > 0),
                ageMs: null,
            },
            ...sortedAgents.map((n) => {
                const isOnline = Boolean(n.online);
                const offlineStatus = n.ageMs != null && Number.isFinite(Number(n.ageMs))
                    ? `ออฟไลน์ · เห็นล่าสุด ${relTime(n.ageMs)}`
                    : 'ออฟไลน์';
                const jobMain = !isOnline
                    ? offlineStatus
                    : (n.currentJob
                        ? `${n.currentJob.name} (${Math.round(clampPct(n.currentJob.progress))}%)`
                        : 'ว่างพร้อมรับงาน');
                const jobSub = !isOnline
                    ? (n.lastJob ? `งานล่าสุด: ${n.lastJob.name}` : 'ไม่ได้เชื่อมต่อ')
                    : (n.currentJob
                        ? `${n.currentJob.kind} · ${n.currentJob.message || n.currentJob.status}`
                        : (n.lastJob ? `ล่าสุด: ${n.lastJob.name} · ${fmtRelTime(n.lastJob.finishedAt || n.lastJob.updatedAt)}` : 'รอรับคำสั่ง offload'));
                return {
                    isHost: false,
                    online: isOnline,
                    displayName: n.displayName || n.hostname || n.nodeId,
                    sub: `${n.hostname || n.nodeId}${n.os ? ` · ${n.os}` : ''}`,
                    cpuPct: isOnline && n.cpuPct != null ? clampPct(n.cpuPct) : null,
                    cpuMeta: isOnline ? (n.cpuThreads ? `${n.cpuThreads} เธรด` : '') : '',
                    memUsed: isOnline ? (n.memUsed || 0) : 0,
                    memTotal: isOnline ? (n.memTotal || 0) : 0,
                    memPct: isOnline && n.memPct != null ? clampPct(n.memPct) : null,
                    gpuPrimary: isOnline ? (n.gpuModel || 'ไม่มีข้อมูล GPU') : '—',
                    gpuSecondary: !isOnline
                        ? ''
                        : (n.gpuUtilPct != null
                            ? `${n.gpuUtilPct}%${n.gpuTempC ? ` · ${n.gpuTempC}°C` : ''}${n.hasNvenc ? ' · NVENC' : ''}`
                            : (n.hasNvenc ? 'NVENC พร้อมใช้' : '—')),
                    gpuPct: isOnline && n.gpuUtilPct != null ? clampPct(n.gpuUtilPct) : null,
                    jobMain,
                    jobSub,
                    busy: isOnline && Boolean(n.currentJob),
                    ageMs: n.ageMs,
                };
            }),
        ];

        const onlineTotal = 1 + (agents.onlineNodes || 0);
        const totalMachines = allMachines.length;
        const totalThreads = hostCores + (agents.totalThreads || 0);
        const totalRam = hostMemTotal + (agents.totalRamBytes || 0);
        if (subEl) {
            subEl.textContent = `ออนไลน์ ${onlineTotal}/${totalMachines} เครื่อง · รวม ${totalThreads} เธรด · RAM ${fmtGb(totalRam)} GB`;
        }

        if (tbody) {
            tbody.innerHTML = allMachines.map((m) => {
                if (!m.online) {
                    return `
                        <tr class="ov3-node is-offline">
                            <td>
                                <div class="ov2-node-cell">
                                    <span class="ov2-node-dot" aria-hidden="true"></span>
                                    <div>
                                        <div class="ov2-node-name">${esc(m.displayName)}</div>
                                        <div class="ov2-node-sub">${esc(m.sub)}</div>
                                    </div>
                                </div>
                            </td>
                            <td class="ov2-meter-cell"><span class="ov2-meter-val">—</span></td>
                            <td class="ov2-meter-cell"><span class="ov2-meter-val">—</span></td>
                            <td class="ov2-gpu-cell"><span class="ov2-meter-val">—</span></td>
                            <td class="ov2-job-cell">
                                <div class="ov2-job-main"><span class="ov3-badge" data-tone="neutral" style="margin-right:6px;">ออฟไลน์</span>${esc(m.jobMain)}</div>
                                <div class="ov2-job-sub" title="${esc(m.jobSub)}">${esc(m.jobSub)}</div>
                            </td>
                        </tr>
                    `;
                }

                const cpuValText = m.cpuPct != null ? `${m.cpuPct.toFixed(0)}%` : '—';
                const cpuW = m.cpuPct != null ? m.cpuPct : 0;
                const ramValText = m.memTotal > 0 ? `${fmtGb(m.memUsed)} / ${fmtGb(m.memTotal)} GB` : '—';
                const ramPctText = m.memTotal > 0 && m.memPct != null ? `${m.memPct.toFixed(0)}%` : '';
                const ramW = m.memTotal > 0 && m.memPct != null ? m.memPct : 0;
                return `
                    <tr class="ov3-node">
                        <td>
                            <div class="ov2-node-cell">
                                <span class="ov2-node-dot is-online" aria-hidden="true"></span>
                                <div>
                                    <div class="ov2-node-name">${esc(m.displayName)}</div>
                                    <div class="ov2-node-sub">${esc(m.sub)}</div>
                                </div>
                            </div>
                        </td>
                        <td class="ov2-meter-cell">
                            <div class="ov2-meter-top">
                                <span class="ov2-meter-val">${cpuValText}</span>
                                <span class="ov2-meter-sub">${esc(m.cpuMeta)}</span>
                            </div>
                            <div class="ov3-bar"><span class="ov3-bar__fill" data-tone="${barToneV3(cpuW)}" style="width:${cpuW.toFixed(1)}%"></span></div>
                        </td>
                        <td class="ov2-meter-cell">
                            <div class="ov2-meter-top">
                                <span class="ov2-meter-val">${ramValText}</span>
                                <span class="ov2-meter-sub">${ramPctText}</span>
                            </div>
                            <div class="ov3-bar"><span class="ov3-bar__fill" data-tone="${barToneV3(ramW)}" style="width:${ramW.toFixed(1)}%"></span></div>
                        </td>
                        <td class="ov2-gpu-cell">
                            <div class="ov2-gpu-name" title="${esc(m.gpuPrimary)}">${esc(m.gpuPrimary)}</div>
                            <div class="ov2-meter-sub">${esc(m.gpuSecondary)}</div>
                            ${m.gpuPct != null ? `<div class="ov3-bar" style="margin-top:4px;"><span class="ov3-bar__fill" data-tone="${barToneV3(m.gpuPct)}" style="width:${m.gpuPct.toFixed(0)}%"></span></div>` : ''}
                        </td>
                        <td class="ov2-job-cell">
                            <div class="ov2-job-main">${m.busy ? '<span class="ov3-badge" data-tone="ok" style="margin-right:5px;">ทำงาน</span>' : ''}${esc(m.jobMain)}</div>
                            <div class="ov2-job-sub" title="${esc(m.jobSub)}">${esc(m.jobSub)}</div>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        if (mobEl) {
            mobEl.innerHTML = allMachines.map((m) => {
                if (!m.online) {
                    return `
                        <div class="ov3-node ov2-node-card is-offline">
                            <div class="ov2-node-card-top">
                                <div class="ov2-node-cell" style="min-width:0;">
                                    <span class="ov2-node-dot"></span>
                                    <div style="min-width:0;">
                                        <div class="ov2-node-name">${esc(m.displayName)}</div>
                                        <div class="ov2-node-sub">${esc(m.sub)}</div>
                                    </div>
                                </div>
                                <span class="ov3-badge" data-tone="neutral">ออฟไลน์</span>
                            </div>
                            <div class="ov2-node-card-meters">
                                <div><div class="ov2-meter-top"><span class="ov2-meter-val">CPU —</span></div></div>
                                <div><div class="ov2-meter-top"><span class="ov2-meter-val">RAM —</span></div></div>
                            </div>
                            <div class="ov2-job-sub">GPU —</div>
                            <div class="ov2-job-main">${esc(m.jobMain)}</div>
                        </div>
                    `;
                }

                const cpuW = m.cpuPct != null ? m.cpuPct : 0;
                const ramW = m.memTotal > 0 && m.memPct != null ? m.memPct : 0;
                return `
                    <div class="ov3-node ov2-node-card">
                        <div class="ov2-node-card-top">
                            <div class="ov2-node-cell" style="min-width:0;">
                                <span class="ov2-node-dot is-online"></span>
                                <div style="min-width:0;">
                                    <div class="ov2-node-name">${esc(m.displayName)}</div>
                                    <div class="ov2-node-sub">${esc(m.sub)}</div>
                                </div>
                            </div>
                            <span class="ov3-badge" data-tone="ok">ออนไลน์</span>
                        </div>
                        <div class="ov2-node-card-meters">
                            <div>
                                <div class="ov2-meter-top"><span class="ov2-meter-val">CPU ${m.cpuPct != null ? `${m.cpuPct.toFixed(0)}%` : '—'}</span><span class="ov2-meter-sub">${esc(m.cpuMeta)}</span></div>
                                <div class="ov3-bar"><span class="ov3-bar__fill" data-tone="${barToneV3(cpuW)}" style="width:${cpuW.toFixed(0)}%"></span></div>
                            </div>
                            <div>
                                <div class="ov2-meter-top"><span class="ov2-meter-val">RAM ${m.memTotal > 0 ? `${ramW.toFixed(0)}%` : '—'}</span><span class="ov2-meter-sub">${m.memTotal > 0 ? `${fmtGb(m.memUsed)}/${fmtGb(m.memTotal)} GB` : '—'}</span></div>
                                <div class="ov3-bar"><span class="ov3-bar__fill" data-tone="${barToneV3(ramW)}" style="width:${ramW.toFixed(0)}%"></span></div>
                            </div>
                        </div>
                        <div class="ov2-job-sub">${esc(m.gpuPrimary)}${m.gpuSecondary ? ` · ${esc(m.gpuSecondary)}` : ''}</div>
                        <div class="ov2-job-main">${esc(m.jobMain)}</div>
                    </div>
                `;
            }).join('');
        }
    }

    function renderInfra(data) {
        const infra = data.infra || {};
        const problems = infra.problems || [];
        const pm2 = infra.pm2 || { items: [], online: 0, total: 0 };
        const docker = infra.docker || { items: [], running: 0, total: 0 };
        const svcs = infra.services || { items: [], up: 0, total: 0 };

        if (ui.infraTab === 'auto') {
            ui.infraTab = problems.length > 0 ? 'problems' : 'pm2';
        }

        const subEl = $('ov3-infra-sub');
        if (subEl) {
            subEl.textContent = `PM2 ${pm2.online}/${pm2.total} · Docker ${docker.running}/${docker.total}`;
        }

        const tabsEl = $('ov2-infra-tabs');
        const bodyEl = $('ov2-infra-body');
        if (tabsEl) {
            tabsEl.innerHTML = [
                { id: 'problems', label: 'มีปัญหา', count: problems.length, tone: problems.length > 0 ? 'err' : 'neutral' },
                { id: 'pm2', label: 'PM2', count: `${pm2.online}/${pm2.total}`, tone: pm2.online < pm2.total ? 'err' : 'neutral' },
                { id: 'docker', label: 'Docker', count: `${docker.running}/${docker.total}`, tone: docker.running < docker.total ? 'err' : 'neutral' },
                { id: 'services', label: 'บริการเว็บ', count: `${svcs.up}/${svcs.total}`, tone: svcs.up < svcs.total ? 'err' : 'neutral' },
            ].map((t) => `
                <button type="button" class="ov3-tab" role="tab" aria-selected="${ui.infraTab === t.id ? 'true' : 'false'}" data-infra-tab="${t.id}">
                    <span>${esc(t.label)}</span>
                    <span class="ov3-badge" data-tone="${esc(t.tone)}">${esc(t.count)}</span>
                </button>
            `).join('');
        }

        if (bodyEl) {
            if (ui.infraTab === 'problems') {
                const healthNote = `<div class="ov2-infra-summary"><span>PM2 ออนไลน์ ${pm2.online}/${pm2.total}</span><span>·</span><span>Docker ทำงาน ${docker.running}/${docker.total}</span><span>·</span><span>บริการเว็บปกติ ${svcs.up}/${svcs.total}</span></div>`;
                if (problems.length === 0) {
                    bodyEl.innerHTML = healthNote + '<div class="ov3-empty">ไม่มีบริการ PM2, Docker หรือเว็บที่ล่มอยู่ในขณะนี้</div>';
                } else {
                    bodyEl.innerHTML = `<div class="ov2-infra-list">${problems.map((p) => `
                        <div class="ov2-infra-row is-down">
                            <div class="ov2-infra-name-wrap">
                                <span class="ov3-badge" data-tone="err">${esc(p.kind)}</span>
                                <span class="ov2-infra-name">${esc(p.name)}</span>
                            </div>
                            <span class="ov2-infra-detail">${esc(p.detail || p.status)}</span>
                            <span class="ov3-badge ov2-infra-stat--hide-sm" data-tone="err">${esc(p.status)}</span>
                            <span>${p.url ? `<a class="ov2-btn ov2-btn--xs" href="${esc(p.url)}" target="_blank" rel="noopener">เปิด</a>` : ''}</span>
                        </div>
                    `).join('')}</div>` + healthNote;
                }
            } else if (ui.infraTab === 'pm2') {
                bodyEl.innerHTML = `<div class="ov2-infra-list">${(pm2.items || []).map((p) => {
                    const ok = p.status === 'online';
                    const canRestart = ['pm2-ui', 'onepercentbot'].includes(p.name);
                    const busy = ui.restartingKey === `pm2:${p.name}`;
                    return `
                        <div class="ov2-infra-row${ok ? '' : ' is-down'}">
                            <div class="ov2-infra-name-wrap">
                                <span class="ov2-node-dot${ok ? ' is-online' : ''}"></span>
                                <span class="ov2-infra-name ov2-mono">${esc(p.name)}</span>
                            </div>
                            <span class="ov2-infra-stat">CPU ${Number(p.cpu || 0).toFixed(1)}%</span>
                            <span class="ov2-infra-stat ov2-infra-stat--hide-sm">${fmtMb(p.mem || 0)}</span>
                            <span>${canRestart ? `<button type="button" class="ov2-btn ov2-btn--xs" data-restart-kind="pm2" data-restart-name="${esc(p.name)}" ${busy ? 'disabled' : ''}>${busy ? '...' : 'รีสตาร์ท'}</button>` : `<span class="ov3-badge" data-tone="${ok ? 'ok' : 'err'}">${ok ? 'online' : esc(p.status)}</span>`}</span>
                        </div>
                    `;
                }).join('') || '<div class="ov3-empty">ไม่พบข้อมูล PM2</div>'}</div>`;
            } else if (ui.infraTab === 'docker') {
                const sorted = [...(docker.items || [])].sort((a, b) => Number(a.state === 'running') - Number(b.state === 'running'));
                bodyEl.innerHTML = `<div class="ov2-infra-list">${sorted.map((c) => {
                    const ok = c.state === 'running';
                    const canRestart = String(c.name || '').startsWith('lab-');
                    const busy = ui.restartingKey === `docker:${c.name}`;
                    return `
                        <div class="ov2-infra-row${ok ? '' : ' is-down'}">
                            <div class="ov2-infra-name-wrap">
                                <span class="ov2-node-dot${ok ? ' is-online' : ''}"></span>
                                <span class="ov2-infra-name ov2-mono">${esc(c.name)}</span>
                            </div>
                            <span class="ov2-infra-stat">${Number(c.cpu || 0).toFixed(1)}%</span>
                            <span class="ov2-infra-stat ov2-infra-stat--hide-sm">${esc((c.mem || '').split('/')[0].trim() || '—')}</span>
                            <span>${canRestart ? `<button type="button" class="ov2-btn ov2-btn--xs" data-restart-kind="docker" data-restart-name="${esc(c.name)}" ${busy ? 'disabled' : ''}>${busy ? '...' : 'รีสตาร์ท'}</button>` : `<span class="ov3-badge" data-tone="${ok ? 'ok' : 'err'}">${esc(c.state)}</span>`}</span>
                        </div>
                    `;
                }).join('') || '<div class="ov3-empty">ไม่พบข้อมูล Docker</div>'}</div>`;
            } else {
                const sorted = [...(svcs.items || [])].sort((a, b) => Number(Boolean(a.up)) - Number(Boolean(b.up)));
                bodyEl.innerHTML = `<div class="ov2-infra-list">${sorted.map((s) => `
                    <div class="ov2-infra-row${s.up ? '' : ' is-down'}">
                        <div class="ov2-infra-name-wrap">
                            <span class="ov2-node-dot${s.up ? ' is-online' : ''}"></span>
                            <span class="ov2-infra-name">${esc(s.name)}</span>
                        </div>
                        <span class="ov2-infra-stat">${s.up && s.latencyMs != null ? `${s.latencyMs} ms` : esc(s.detail || 'down')}</span>
                        <span class="ov3-badge" data-tone="${s.up ? 'ok' : 'err'}">${s.up ? 'ปกติ' : 'ล่ม'}</span>
                        <span>${s.url ? `<a class="ov2-btn ov2-btn--xs" href="${esc(s.url)}" target="_blank" rel="noopener">เปิด</a>` : ''}</span>
                    </div>
                `).join('') || '<div class="ov3-empty">ไม่พบข้อมูลบริการ</div>'}</div>`;
            }
        }

        // Energy Module
        const en = infra.energy || {};
        const rt = en.realtime || {};
        const td = en.today || {};
        const mo = en.this_month || {};
        const wEl = $('ov2-en-watts');
        const acEl = $('ov2-en-ac');
        const todayEl = $('ov2-en-today');
        const todayKwhEl = $('ov2-en-today-kwh');
        const monthEl = $('ov2-en-month');
        const monthKwhEl = $('ov2-en-month-kwh');
        const projEl = $('ov2-en-proj');
        const projKwhEl = $('ov2-en-proj-kwh');

        if (wEl) wEl.innerHTML = rt.power_watts != null ? `${Math.round(Number(rt.power_watts)).toLocaleString('th-TH')} <small>W</small>` : '— <small>W</small>';
        if (acEl) acEl.textContent = rt.voltage_volts != null
            ? `${Number(rt.voltage_volts).toFixed(1)} V · ${Number(rt.current_amps || 0).toFixed(2)} A · PF ${Number(rt.power_factor || 0).toFixed(2)}`
            : 'กำลังรอข้อมูล PZEM-01';
        if (todayEl) todayEl.textContent = td.cost_thb != null ? fmtThb(td.cost_thb) : '—';
        if (todayKwhEl) todayKwhEl.textContent = td.energy_kwh != null ? `${Number(td.energy_kwh).toFixed(1)} kWh` : '—';
        if (monthEl) monthEl.textContent = mo.cost_thb != null ? fmtThb(mo.cost_thb) : '—';
        if (monthKwhEl) monthKwhEl.textContent = mo.energy_kwh != null ? `${Number(mo.energy_kwh).toFixed(0)} kWh` : '—';
        if (projEl) projEl.textContent = mo.projected_cost_thb != null ? `~${fmtThb(mo.projected_cost_thb)}` : '—';
        if (projKwhEl) projKwhEl.textContent = mo.projected_kwh != null ? `~${Number(mo.projected_kwh).toFixed(0)} kWh` : '—';
    }

    function renderAll(data) {
        if (!data) return;
        renderHeader(data);
        renderKpis(data);
        renderAttention(data);
        renderActivityTabs(data);
        renderAiPanel(data);
        renderVideosPanel(data);
        renderResourceMatrix(data);
        renderInfra(data);
    }

    // ── AI Quota (All Accounts + Providers · 7-Day Pace UI) ─────────────────
    const QUOTA_SLOT_SIZE = 100 / 7;

    function quotaTone(pct) {
        const n = Number(pct);
        if (!Number.isFinite(n)) return 'neutral';
        if (n >= 50) return 'ok';
        if (n >= 20) return 'warn';
        return 'err';
    }

    function fmtQuotaCountdown(iso) {
        if (!iso) return '—';
        const diff = Date.parse(iso) - Date.now();
        if (!Number.isFinite(diff)) return '—';
        if (diff <= 0) return 'พร้อมรีเซ็ตแล้ว';
        const days = Math.floor(diff / 86400000);
        const hrs = Math.floor((diff % 86400000) / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        if (days > 0) {
            return `${days} วัน ${hrs} ชม. ${String(mins).padStart(2, '0')} น. ${String(secs).padStart(2, '0')} วิ`;
        }
        return `${hrs} ชม. ${String(mins).padStart(2, '0')} น. ${String(secs).padStart(2, '0')} วิ`;
    }

    function calculateWeeklyPace(usedPct, resetIso, now = Date.now()) {
        const safePct = Math.min(100, Math.max(0, Math.round(usedPct || 0)));
        const resetEpoch = resetIso ? Date.parse(resetIso) : 0;
        let daysRemaining = 3.5;
        let hasValidEpoch = false;

        if (Number.isFinite(resetEpoch) && resetEpoch > now) {
            daysRemaining = (resetEpoch - now) / 86400000;
            hasValidEpoch = true;
        }

        const cycleDays = 7;
        const daysRemainingClamped = Math.min(cycleDays, Math.max(0, daysRemaining));
        const daysElapsed = Math.min(cycleDays, Math.max(0, cycleDays - daysRemainingClamped));
        const expectedPct = (daysElapsed / cycleDays) * 100;
        const delta = safePct - expectedPct;
        const remainingQuotaPct = Math.max(0, 100 - safePct);
        const suggestedDailyBudget = daysRemainingClamped > 0.2
            ? (remainingQuotaPct / daysRemainingClamped)
            : remainingQuotaPct;

        const currentDayIndex = Math.min(7, Math.max(1, Math.ceil(daysElapsed) || 1));
        const daysAhead = delta > 0 ? (delta / (100 / cycleDays)).toFixed(1) : '0';

        let level = 1;
        let badgeTone = 'ok';
        let badgeLabel = '● ปกติ (On Pace)';
        let shortBadge = '● On Pace';
        let summaryText = `อยู่ในเกณฑ์: เหลืออีก ${daysRemainingClamped.toFixed(1)} วัน | ใช้ได้เฉลี่ย ~${suggestedDailyBudget.toFixed(0)}%/วัน`;

        if (delta > 20 || (safePct >= 90 && daysRemainingClamped >= 1.5) || safePct >= 98) {
            level = 3;
            badgeTone = 'err';
            badgeLabel = '⚡ วิกฤติ (Critical)';
            shortBadge = '⚡ Critical';
            summaryText = `วิกฤติ! ใช้ล้นเกินจุดวันนี้ไป ~${daysAhead} วัน (+${Math.max(0, Math.round(delta))}%) | เหลือ ${daysRemainingClamped.toFixed(1)} วัน (ควรชะลอการใช้)`;
        } else if (delta > 5 || (safePct >= 75 && daysRemainingClamped >= 2)) {
            level = 2;
            badgeTone = 'warn';
            badgeLabel = '▲ เร่งตัว (High Burn)';
            shortBadge = '▲ High Burn';
            summaryText = `เร่งตัว: ใช้ล้นเกินจุดวันนี้ไป ~${daysAhead} วัน (+${Math.round(delta)}%) | เหลือ ${daysRemainingClamped.toFixed(1)} วัน (แนะชะลอเหลือ ~${suggestedDailyBudget.toFixed(0)}%/วัน)`;
        }

        return { safePct, currentDayIndex, level, badgeTone, badgeLabel, shortBadge, summaryText, hasValidEpoch };
    }

    function build7SegmentRackHtml(usedPct, currentDayIndex) {
        const safePct = Math.min(100, Math.max(0, Number(usedPct) || 0));
        let cells = '';
        for (let idx = 0; idx < 7; idx++) {
            const dayNumber = idx + 1;
            const lower = idx * QUOTA_SLOT_SIZE;
            const upper = (idx + 1) * QUOTA_SLOT_SIZE;
            let fillPct = 0;
            if (safePct >= upper) fillPct = 100;
            else if (safePct > lower) fillPct = Math.round(((safePct - lower) / QUOTA_SLOT_SIZE) * 100);

            const isToday = dayNumber === currentDayIndex;
            const isOver = (dayNumber > currentDayIndex) && (fillPct > 0);
            const cls = [
                'ov3-qseg',
                fillPct > 0 ? 'has-usage' : '',
                isToday ? 'is-today' : '',
                isOver ? 'is-over-budget' : '',
            ].filter(Boolean).join(' ');

            const pointer = isToday ? '<span class="ov3-qtoday-ptr">▼ วันนี้</span>' : '';
            const title = `วันที่ ${dayNumber} ของรอบ${isToday ? ' (วันนี้)' : ''} - ใช้โควตาส่วนนี้ไป ${fillPct}%`;
            cells += `<div class="${cls}" title="${esc(title)}"><div class="ov3-qseg__fill" style="height:${fillPct}%"></div><span class="ov3-qseg__tag">D${dayNumber}</span>${pointer}</div>`;
        }
        return `<div class="ov3-qrack"><div class="ov3-qrack__grid">${cells}</div></div>`;
    }

    function updateQuotaCountdowns() {
        const root = $('ov3-panel-quota');
        if (!root) return;
        const nodes = root.querySelectorAll('[data-quota-reset]');
        for (const el of nodes) {
            const iso = el.getAttribute('data-quota-reset');
            if (!iso) continue;
            const next = fmtQuotaCountdown(iso);
            if (el.textContent !== next) el.textContent = next;
        }
    }

    function shortAccountTag(acct, fallbackIdx = 0) {
        const id = String((acct && acct.id) || '').trim();
        if (/^g(\d+)$/i.test(id)) return `G#${id.slice(1)}`;
        const lbl = String((acct && acct.label) || '').trim();
        const m = lbl.match(/(\d+)/);
        if (/google/i.test(lbl) && m) return `G#${m[1]}`;
        return lbl ? lbl.slice(0, 8) : `G#${fallbackIdx + 1}`;
    }

    function buildGooglePoolCards(acct, opts = {}) {
        const d = acct && acct.data;
        const label = (acct && acct.label) || 'Google';
        const tag = opts.accountTag || '';

        if (!d || !d.ok) {
            return `
                <article class="ov3-qpool-card${opts.fullSpanOnError ? ' is-fullspan' : ''}">
                    <div class="ov3-qpool-card__head">
                        <div class="ov3-qpool-card__title">${tag ? `${esc(tag)} · ` : ''}${esc(label)}</div>
                        <span class="ov3-badge" data-tone="warn">ข้ามอัตโนมัติ</span>
                    </div>
                    <div class="ov3-qmeta-row">${esc((d && d.error) || 'ไม่พบโทเค็นหรือติดต่อ API ไม่ได้')}</div>
                </article>
            `;
        }

        const pools = Array.isArray(d.pools) ? d.pools : [];
        const weeklyPool = pools.find((x) =>
            (x.weekly && x.weekly.resetTime) ||
            (x.resetTime && (Date.parse(x.resetTime) - Date.now()) > 12 * 3600 * 1000)
        );
        const sharedWeeklyReset = (weeklyPool && weeklyPool.weekly && weeklyPool.weekly.resetTime)
            || (weeklyPool && weeklyPool.resetTime)
            || new Date(Date.now() + 7 * 86400000).toISOString();

        return pools.map((p) => {
            const rem = Math.round(clampPct(p.remainingPct));
            const used = Math.round(clampPct(p.usedPct));
            const isExhausted = rem <= 0;
            const tone = quotaTone(rem);
            const resetMs = p.resetTime ? (Date.parse(p.resetTime) - Date.now()) : 0;
            const is5hWindow = resetMs > 0 && resetMs <= 12 * 3600 * 1000;
            const weeklyResetForRack = (p.weekly && p.weekly.resetTime)
                ? p.weekly.resetTime
                : (is5hWindow ? sharedWeeklyReset : p.resetTime);
            const rackUsedPct = p.weekly ? p.weekly.usedPct : p.usedPct;
            const pace = calculateWeeklyPace(rackUsedPct, weeklyResetForRack);
            const fiveHourOnly = false; // 2026-11-28 ผู้ใช้ขอให้ pool Gemini แสดง weekly rack D1-D7 + pace เหมือน Claude/GPT
            const badgeTone = isExhausted ? 'err' : (fiveHourOnly ? tone : pace.badgeTone);
            const badgeText = isExhausted ? '⚡ หมด (0%)' : (fiveHourOnly ? '5 ชม.' : pace.shortBadge);
            const badgeTitle = isExhausted ? 'หมดโควตาแล้ว' : (fiveHourOnly ? 'นับเฉพาะรอบ 5 ชั่วโมง' : pace.badgeLabel);
            const rackHtml = fiveHourOnly ? '' : build7SegmentRackHtml(rackUsedPct, pace.currentDayIndex);
            const familyAttr = p.id === 'claude' ? 'claude' : 'gemini';
            const cardTitle = tag ? `${tag} · ${p.name || p.id}` : (p.name || p.id);

            const splitHtml = (p.fiveHour && p.weekly) ? `
                <div class="ov3-qmeta-row ov3-qmeta-row--split">
                    <span>5h: <strong class="ov3-qval" data-tone="${quotaTone(p.fiveHour.remainingPct)}">${Math.round(clampPct(p.fiveHour.remainingPct))}%</strong></span>
                    <span>Wk: <strong class="ov3-qval" data-tone="${quotaTone(p.weekly.remainingPct)}">${Math.round(clampPct(p.weekly.remainingPct))}%</strong> · <span data-quota-reset="${esc(p.weekly.resetTime || '')}">${esc(fmtQuotaCountdown(p.weekly.resetTime))}</span></span>
                </div>
            ` : '';

            const exhaustedBox = isExhausted ? `
                <div class="ov3-qcountdown-box">
                    <div class="ov3-qcountdown-box__lbl">🔴 หมดโควตา — รีเซ็ตใน</div>
                    <div class="ov3-qcountdown-box__val" data-quota-reset="${esc(p.resetTime || '')}">${esc(fmtQuotaCountdown(p.resetTime))}</div>
                </div>
            ` : '';

            return `
                <article class="ov3-qpool-card${isExhausted ? ' is-exhausted' : ''}">
                    <div class="ov3-qpool-card__head">
                        <div class="ov3-qpool-card__title" data-family="${familyAttr}" title="${esc(cardTitle)}${d.email ? ` (${esc(d.email)})` : ''}">${esc(cardTitle)}</div>
                        <span class="ov3-badge" data-tone="${badgeTone}" title="${esc(badgeTitle)}">${esc(badgeText)}</span>
                    </div>
                    <div class="ov3-qpool-card__metric-row">
                        <div class="ov3-qpool-card__pct" data-tone="${tone}">${rem}%<span>คงเหลือ</span></div>
                        <span class="ov3-qmeta-row">ใช้ ${used}% · ${esc(p.modelsCount || 0)} โมเดล</span>
                    </div>
                    <div class="ov3-qbar"><span class="ov3-qbar__fill" data-tone="${tone}" style="width:${rem}%"></span></div>
                    <div class="ov3-qmeta-row">
                        <span>${p.fiveHour ? 'รอบ 5 ชม.' : `วัน D${pace.currentDayIndex}/7`}</span>
                        <span data-quota-reset="${esc(p.resetTime || '')}">${esc(fmtQuotaCountdown(p.resetTime))}</span>
                    </div>
                    ${splitHtml}
                    ${rackHtml}
                    ${fiveHourOnly ? '' : `<div class="ov3-qpace" data-level="${pace.level}" title="${esc(pace.summaryText)}">${esc(pace.summaryText)}</div>`}
                    ${exhaustedBox}
                </article>
            `;
        }).join('');
    }

    function renderGoogleQuotaSection(acct) {
        const d = acct && acct.data;
        const label = (acct && acct.label) || 'Google';
        const email = (d && d.email) || (acct && acct.email) || '';
        const tier = (d && d.tier) ? ` (${d.tier})` : '';

        if (!d || !d.ok) {
            return `
                <section class="ov3-qsec">
                    <div class="ov3-qsec__head">
                        <div class="ov3-qsec__title">
                            <span class="ov3-qsec__name">Google Antigravity · ${esc(label)}</span>
                            ${email ? `<span class="ov3-qsec__sub">${esc(email)}</span>` : ''}
                        </div>
                        <span class="ov3-badge" data-tone="neutral">ข้ามอัตโนมัติ</span>
                    </div>
                    <div class="ov3-qpool-grid">
                        ${buildGooglePoolCards(acct, { fullSpanOnError: true })}
                    </div>
                </section>
            `;
        }

        const pools = Array.isArray(d.pools) ? d.pools : [];
        const exhaustedCount = pools.filter((p) => Number(p.remainingPct) <= 0).length;
        const hasAvail = pools.some((p) => Number(p.remainingPct) > 5);
        const headTone = exhaustedCount === pools.length && pools.length > 0
            ? 'err'
            : (exhaustedCount > 0 ? 'warn' : (hasAvail ? 'ok' : 'neutral'));
        const headText = !pools.length
            ? 'ไม่มีข้อมูล'
            : (exhaustedCount > 0 ? `หมดโควตา ${exhaustedCount} พูล` : `${pools.length} พูลพร้อมใช้`);

        return `
            <section class="ov3-qsec">
                <div class="ov3-qsec__head">
                    <div class="ov3-qsec__title">
                        <span class="ov3-qsec__name">Google Antigravity · ${esc(label)}</span>
                        <span class="ov3-qsec__sub">${esc(email)}${esc(tier)} · 5 ชม. + รายสัปดาห์</span>
                    </div>
                    <span class="ov3-badge" data-tone="${headTone}">${esc(headText)}</span>
                </div>
                <div class="ov3-qpool-grid">${buildGooglePoolCards(acct) || '<div class="ov3-empty">ไม่มีข้อมูลพูล</div>'}</div>
            </section>
        `;
    }

    function buildClaudeUnifiedCard(cw, opts = {}) {
        const tag = opts.accountTag ? `${opts.accountTag} · ` : '';
        if (!cw || !cw.ok) {
            const note = cw && cw.error
                ? `${cw.error} — ข้ามอัตโนมัติ`
                : 'ไม่ได้ใช้งานหรือเชื่อมต่อไม่ได้ — ข้ามอัตโนมัติ';
            return `
                <article class="ov3-qpool-card ov3-qpool-card--unified${opts.fullSpanOnError ? ' is-fullspan' : ''}">
                    <div class="ov3-qpool-card__head">
                        <div class="ov3-qpool-card__title" data-family="claude">${esc(tag)}Claude.ai (Pro)</div>
                        <span class="ov3-badge" data-tone="neutral">ไม่ได้ใช้</span>
                    </div>
                    <div class="ov3-qmeta-row">${esc(note)}</div>
                </article>
            `;
        }

        const fh = cw.fiveHour || { remainingPct: 100, usedPct: 0, resetTime: null };
        const wk = cw.weekly || { remainingPct: 100, usedPct: 0, resetTime: null };
        const fhRem = Math.round(clampPct(fh.remainingPct));
        const fhUsed = Math.round(clampPct(fh.usedPct));
        const wkRem = Math.round(clampPct(wk.remainingPct));
        const wkUsed = Math.round(clampPct(wk.usedPct));
        const fhTone = quotaTone(fhRem);
        const wkTone = quotaTone(wkRem);
        const wkPace = calculateWeeklyPace(wkUsed, wk.resetTime);
        const wkRack = build7SegmentRackHtml(wkUsed, wkPace.currentDayIndex);
        const isExhausted = fhRem <= 0 || wkRem <= 0;
        const planUpper = String(cw.plan || 'Pro').toUpperCase();
        const badgeTone = wkRem <= 0 ? 'err' : (fhRem <= 0 ? 'err' : wkPace.badgeTone);
        const badgeText = wkRem <= 0 ? '⚡ หมดสัปดาห์' : (fhRem <= 0 ? '⚡ หมด 5h' : wkPace.shortBadge);
        const badgeTitle = wkRem <= 0 ? 'หมดโควตาสัปดาห์' : (fhRem <= 0 ? 'หมดรอบ 5 ชม.' : wkPace.badgeLabel);
        const exhaustedIso = wkRem <= 0 ? (wk.resetTime || '') : (fh.resetTime || '');
        const exhaustedLbl = wkRem <= 0 ? '🔴 หมดโควตาสัปดาห์ — รีเซ็ตใน' : '🔴 หมดรอบ 5 ชม. — รีเซ็ตใน';

        return `
            <article class="ov3-qpool-card ov3-qpool-card--unified${isExhausted ? ' is-exhausted' : ''}">
                <div class="ov3-qpool-card__head">
                    <div class="ov3-qpool-card__title" data-family="claude" title="Claude.ai (${esc(planUpper)}) · ${esc(cw.orgName || 'OAuth')}">${esc(tag)}Claude ${esc(planUpper)} · 5h + Wk</div>
                    <span class="ov3-badge" data-tone="${badgeTone}" title="${esc(badgeTitle)}">${esc(badgeText)}</span>
                </div>
                <div class="ov3-qsub-block">
                    <div class="ov3-qsub-row">
                        <span class="ov3-qsub-row__lbl">5h Limit · ใช้ ${fhUsed}%</span>
                        <span class="ov3-qsub-row__val" data-tone="${fhTone}">${fhRem}%</span>
                    </div>
                    <div class="ov3-qbar"><span class="ov3-qbar__fill" data-tone="${fhTone}" style="width:${fhRem}%"></span></div>
                    <div class="ov3-qmeta-row">
                        <span>รีเซ็ต 5 ชม.</span>
                        <span data-quota-reset="${esc(fh.resetTime || '')}">${esc(fmtQuotaCountdown(fh.resetTime))}</span>
                    </div>
                </div>
                <div class="ov3-qsub-block">
                    <div class="ov3-qsub-row">
                        <span class="ov3-qsub-row__lbl">Weekly · ใช้ ${wkUsed}% (D${wkPace.currentDayIndex}/7)</span>
                        <span class="ov3-qsub-row__val" data-tone="${wkTone}">${wkRem}%</span>
                    </div>
                    <div class="ov3-qmeta-row">
                        <span>รีเซ็ตสัปดาห์</span>
                        <span data-quota-reset="${esc(wk.resetTime || '')}">${esc(fmtQuotaCountdown(wk.resetTime))}</span>
                    </div>
                    ${wkRack}
                </div>
                <div class="ov3-qpace" data-level="${wkPace.level}" title="${esc(wkPace.summaryText)}">${esc(wkPace.summaryText)}</div>
                ${isExhausted ? `
                    <div class="ov3-qcountdown-box">
                        <div class="ov3-qcountdown-box__lbl">${exhaustedLbl}</div>
                        <div class="ov3-qcountdown-box__val" data-quota-reset="${esc(exhaustedIso)}">${esc(fmtQuotaCountdown(exhaustedIso))}</div>
                    </div>
                ` : ''}
            </article>
        `;
    }

    function renderClaudeQuotaSection(cw) {
        const isOk = Boolean(cw && cw.ok);
        const fhRem = isOk ? Math.round(clampPct(cw.fiveHour?.remainingPct ?? 100)) : 0;
        const wkRem = isOk ? Math.round(clampPct(cw.weekly?.remainingPct ?? 100)) : 0;
        const headTone = !isOk ? 'neutral' : (wkRem <= 0 ? 'err' : (fhRem <= 0 ? 'warn' : 'ok'));
        const headText = !isOk
            ? 'ไม่ได้ใช้'
            : (wkRem <= 0 ? 'หมดโควตาสัปดาห์' : (fhRem <= 0 ? 'รอบ 5 ชม. หมด' : `พร้อมใช้ (${String(cw.plan || 'Pro').toUpperCase()})`));

        return `
            <section class="ov3-qsec">
                <div class="ov3-qsec__head">
                    <div class="ov3-qsec__title">
                        <span class="ov3-qsec__name">Claude.ai (${esc(String((cw && cw.plan) || 'Pro').toUpperCase())})</span>
                        <span class="ov3-qsec__sub">${esc((cw && cw.orgName) || 'OAuth · Claude Code')} · รวม 5 ชม. &amp; รายสัปดาห์</span>
                    </div>
                    <span class="ov3-badge" data-tone="${headTone}">${esc(headText)}</span>
                </div>
                <div class="ov3-qpool-grid">
                    ${buildClaudeUnifiedCard(cw, { fullSpanOnError: !isOk })}
                </div>
            </section>
        `;
    }

    function buildCreditsCards(ds, gc, opts = {}) {
        const dsTotal = ds && ds.ok ? parseFloat(ds.totalBalance || '0') : 0;
        const dsReady = Boolean(ds && ds.ok && ds.isAvailable && dsTotal > 0.1);
        const dsLow = Boolean(ds && ds.ok && ds.isAvailable && dsTotal <= 0.5 && dsTotal > 0.1);
        const dsTone = !ds || !ds.ok ? 'neutral' : (!dsReady ? 'err' : (dsLow ? 'warn' : 'ok'));
        const dsBadge = !ds || !ds.ok ? 'ไม่ได้ตั้งค่า' : (!dsReady ? 'เครดิตหมด' : (dsLow ? 'ใกล้หมด' : '● พร้อมใช้'));
        const dsModels = (ds && ds.ok && Array.isArray(ds.models)) ? ds.models : [];
        const dsPaceText = dsReady ? 'Pay-As-You-Go · หักตาม Token จริง · ไม่มีวันหมดอายุ' : 'เครดิตหมด — สมองกลางข้าม DeepSeek อัตโนมัติ';

        const gcReady = Boolean(gc && gc.ok && !gc.isEmpty && Number(gc.remainingThb) > 0.5);
        const gcLow = Boolean(gc && gc.ok && Number(gc.remainingThb) < Number(gc.lowThb || 10));
        const gcTone = !gc || !gc.ok ? 'neutral' : (Number(gc.remainingThb) <= 0.5 ? 'err' : (gcLow ? 'warn' : 'ok'));
        const gcBadge = !gc || !gc.ok ? 'ไม่ได้ตั้งค่า' : (Number(gc.remainingThb) <= 0.5 ? 'เครดิตหมด' : (gcLow ? 'ใกล้หมด' : '● พร้อมใช้'));
        const gcPct = (gc && gc.ok)
            ? clampPct((Number(gc.remainingThb) / (Number(gc.topUpThb) || Number(gc.baselineThb) || 1)) * 100)
            : 0;
        const gcPaceText = (gc && gc.ok)
            ? `เสียงบรรยาย Gemini TTS · ใช้ไป ฿${Number(gc.spentThb || 0).toFixed(2)} (${gc.calls || 0} ครั้ง) · เรต ${gc.usdToThb || 34.5} ฿/$`
            : 'ไม่มีข้อมูลเครดิต Gemini TTS';

        const dsTitle = opts.compact ? 'DeepSeek · API' : 'DeepSeek API Credit';
        const gcTitle = opts.compact ? 'TTS · Gemini Credit' : 'Gemini API Credit (TTS วิดีโอ)';

        return `
            <article class="ov3-qpool-card">
                <div class="ov3-qpool-card__head">
                    <div class="ov3-qpool-card__title" title="DeepSeek API Credit">${esc(dsTitle)}</div>
                    <span class="ov3-badge" data-tone="${dsTone}">${esc(dsBadge)}</span>
                </div>
                ${ds && ds.ok ? `
                    <div class="ov3-qpool-card__metric-row">
                        <div class="ov3-qpool-card__pct" data-tone="${dsTone}">$${esc(ds.totalBalance)}<span>${esc(ds.currency || 'USD')}</span></div>
                        <span class="ov3-qmeta-row">เติม $${esc(ds.toppedUpBalance || '0.00')} · โบนัส $${esc(ds.grantedBalance || '0.00')}</span>
                    </div>
                    <div class="ov3-qbar"><span class="ov3-qbar__fill" data-tone="${dsTone}" style="width:${dsReady ? 100 : 0}%"></span></div>
                    ${dsModels.length ? `<div class="ov3-qpills">${dsModels.map((m) => `<span class="ov3-qpill">${esc(m.name || m.id)}</span>`).join('')}</div>` : ''}
                    <div class="ov3-qpace" data-level="${dsReady ? 1 : 2}" title="${esc(dsPaceText)}">${esc(dsPaceText)}</div>
                ` : `<div class="ov3-qmeta-row">ยังไม่ได้ตั้งค่า DEEPSEEK_API_KEY</div>`}
            </article>

            <article class="ov3-qpool-card">
                <div class="ov3-qpool-card__head">
                    <div class="ov3-qpool-card__title" data-family="credit" title="Gemini API Credit (TTS วิดีโอ)">${esc(gcTitle)}</div>
                    <span class="ov3-badge" data-tone="${gcTone}">${esc(gcBadge)}</span>
                </div>
                ${gc && gc.ok ? `
                    <div class="ov3-qpool-card__metric-row">
                        <div class="ov3-qpool-card__pct" data-tone="${gcTone}">฿${Number(gc.remainingThb).toFixed(2)}<span>${esc(gc.currency || 'THB')}</span></div>
                        <span class="ov3-qmeta-row">ตั้งต้น ฿${Number(gc.baselineThb).toFixed(0)} · ใช้ ฿${Number(gc.spentThb).toFixed(2)}</span>
                    </div>
                    <div class="ov3-qbar"><span class="ov3-qbar__fill" data-tone="${gcTone}" style="width:${gcPct.toFixed(0)}%"></span></div>
                    <div class="ov3-qmeta-row ov3-qmeta-row--split">
                        <span>In ${Number(gc.inputTokens || 0).toLocaleString('th-TH')}</span>
                        <span>Out ${Number(gc.outputTokens || 0).toLocaleString('th-TH')}</span>
                    </div>
                    <div class="ov3-qpace" data-level="${gcLow ? 2 : 1}" title="${esc(gcPaceText)}">${esc(gcPaceText)}</div>
                ` : `<div class="ov3-qmeta-row">ไม่มีข้อมูลเครดิต Gemini TTS</div>`}
            </article>
        `;
    }

    function renderCreditsQuotaSection(ds, gc) {
        const dsTotal = ds && ds.ok ? parseFloat(ds.totalBalance || '0') : 0;
        const dsReady = Boolean(ds && ds.ok && ds.isAvailable && dsTotal > 0.1);
        const dsLow = Boolean(ds && ds.ok && ds.isAvailable && dsTotal <= 0.5 && dsTotal > 0.1);
        const gcReady = Boolean(gc && gc.ok && !gc.isEmpty && Number(gc.remainingThb) > 0.5);
        const gcLow = Boolean(gc && gc.ok && Number(gc.remainingThb) < Number(gc.lowThb || 10));

        const anyWarn = dsLow || gcLow;
        const anyReady = dsReady || gcReady;
        const headTone = anyWarn ? 'warn' : (anyReady ? 'ok' : 'neutral');
        const headText = anyWarn ? 'เครดิตใกล้หมด' : (anyReady ? 'พร้อมใช้' : 'ไม่ได้เติม');

        return `
            <section class="ov3-qsec">
                <div class="ov3-qsec__head">
                    <div class="ov3-qsec__title">
                        <span class="ov3-qsec__name">เครดิต API (Pay-As-You-Go)</span>
                        <span class="ov3-qsec__sub">DeepSeek Platform &amp; Gemini API (TTS วิดีโอ)</span>
                    </div>
                    <span class="ov3-badge" data-tone="${headTone}">${esc(headText)}</span>
                </div>
                <div class="ov3-qpool-grid">
                    ${buildCreditsCards(ds, gc, { compact: false })}
                </div>
            </section>
        `;
    }

    function renderQuotaModelsTable(q) {
        const wrap = $('ov3-quota-models-wrap');
        const toggleBtn = $('ov3-quota-toggle-models');

        const accounts = (q && q.accounts) || [];
        const ds = q && q.deepseek;
        const dsModels = (ds && ds.ok && Array.isArray(ds.models)) ? ds.models : [];

        let totalModels = dsModels.length;
        for (const a of accounts) {
            if (a && a.data && a.data.ok && Array.isArray(a.data.models)) {
                totalModels += a.data.models.length;
            }
        }

        if (toggleBtn) {
            toggleBtn.textContent = totalModels > 0
                ? `รายโมเดล (${totalModels}) ${ui.quotaModelsOpen ? '▴' : '▾'}`
                : `รายโมเดล ${ui.quotaModelsOpen ? '▴' : '▾'}`;
            toggleBtn.setAttribute('aria-expanded', ui.quotaModelsOpen ? 'true' : 'false');
        }

        if (!wrap) return;
        wrap.hidden = !ui.quotaModelsOpen;
        if (!ui.quotaModelsOpen) return;

        if (totalModels === 0) {
            wrap.innerHTML = '<div class="ov3-empty" style="padding:18px;">ไม่พบรายละเอียดรายโมเดล</div>';
            return;
        }

        const rows = [];
        for (const a of accounts) {
            const d = a && a.data;
            const list = (d && d.ok && Array.isArray(d.models)) ? d.models : [];
            if (!list.length) continue;
            rows.push(`<tr class="ov3-qmodels-group"><td colspan="4">${esc(a.label || a.id)}${d.email ? ` · ${esc(d.email)}` : ''} (${list.length} โมเดล)</td></tr>`);
            for (const m of list) {
                const rem = Math.round(clampPct(m.remainingPct) * 10) / 10;
                const used = Math.round(clampPct(m.usedPct) * 10) / 10;
                const tone = quotaTone(rem);
                const col = tone === 'ok' ? 'var(--ov-green)' : (tone === 'warn' ? 'var(--ov-amber)' : 'var(--ov-red)');
                const rst = m.resetTime
                    ? `<span data-quota-reset="${esc(m.resetTime)}">${esc(fmtQuotaCountdown(m.resetTime))}</span>`
                    : '—';
                rows.push(`
                    <tr>
                        <td class="ov2-mono">${esc(m.displayName || m.id)}</td>
                        <td class="ov2-mono">
                            <span class="ov3-qmini-bar"><span style="width:${clampPct(rem)}%;background:${col}"></span></span>
                            <strong style="color:${col}">${rem}%</strong>
                        </td>
                        <td class="ov2-mono" style="color:var(--ov-ink-3)">${used}%</td>
                        <td class="ov2-mono">${rst}</td>
                    </tr>
                `);
            }
        }

        if (dsModels.length) {
            rows.push(`<tr class="ov3-qmodels-group"><td colspan="4">DeepSeek Platform · Pay-As-You-Go (${dsModels.length} โมเดล)</td></tr>`);
            for (const m of dsModels) {
                rows.push(`
                    <tr>
                        <td class="ov2-mono">${esc(m.name || m.id)} <span style="color:var(--ov-ink-3)">(${esc(m.id)})</span></td>
                        <td class="ov2-mono"><strong style="color:var(--ov-green)">$${esc(ds.totalBalance)} ${esc(ds.currency || 'USD')}</strong></td>
                        <td class="ov2-mono" style="color:var(--ov-ink-3)">Pay-As-You-Go</td>
                        <td class="ov2-mono" style="color:var(--ov-ink-3)">ไม่มีวันหมดอายุ</td>
                    </tr>
                `);
            }
        }

        wrap.innerHTML = `
            <table class="ov3-table ov3-qmodels-table">
                <thead>
                    <tr>
                        <th scope="col">โมเดล</th>
                        <th scope="col">คงเหลือ</th>
                        <th scope="col">ใช้ไป</th>
                        <th scope="col">รีเซ็ตใน</th>
                    </tr>
                </thead>
                <tbody>${rows.join('')}</tbody>
            </table>
        `;
    }

    function renderQuotaPanel(q) {
        const gridEl = $('ov3-quota-grid');
        const subEl = $('ov3-quota-sub');
        const tabsEl = $('ov3-quota-tabs');
        if (!gridEl || !q) return;

        const accounts = q.accounts || [];
        const cw = q.claudeWeb;
        const ds = q.deepseek;
        const gc = q.geminiCredit;

        const totalChannels = accounts.length + 3;
        let readyChannels = 0;
        for (const a of accounts) {
            if (a && a.data && a.data.ok && (a.data.pools || []).some((p) => Number(p.remainingPct) > 5)) {
                readyChannels += 1;
            }
        }
        if (cw && cw.ok && Math.min(cw.fiveHour?.remainingPct ?? 100, cw.weekly?.remainingPct ?? 100) > 5) {
            readyChannels += 1;
        }
        if (ds && ds.ok && ds.isAvailable && parseFloat(ds.totalBalance || '0') > 0.1) {
            readyChannels += 1;
        }
        if (gc && gc.ok && !gc.isEmpty && Number(gc.remainingThb) > 0.5) {
            readyChannels += 1;
        }

        if (subEl) {
            const timeStr = ui.quotaUpdatedAt
                ? new Date(ui.quotaUpdatedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
                : '';
            subEl.textContent = `พร้อมใช้ ${readyChannels}/${totalChannels} ช่องทาง${timeStr ? ` · อัปเดต ${timeStr}` : ''}`;
        }

        const validTabs = new Set(['all', ...accounts.map((a) => a.id), 'claude', 'credits']);
        if (!validTabs.has(ui.quotaTab)) ui.quotaTab = 'all';

        if (tabsEl) {
            const tabs = [
                {
                    id: 'all',
                    label: 'ทั้งหมด',
                    badge: `${readyChannels}/${totalChannels}`,
                    tone: readyChannels > 0 ? 'ok' : 'err',
                },
                ...accounts.map((a) => {
                    const ps = (a.data && a.data.ok && Array.isArray(a.data.pools)) ? a.data.pools : [];
                    const summary = ps.length ? ps.map((p) => `${Math.round(clampPct(p.remainingPct))}%`).join(' · ') : 'ข้าม';
                    const hasOk = ps.some((p) => Number(p.remainingPct) > 5);
                    const hasZero = ps.some((p) => Number(p.remainingPct) <= 0);
                    return {
                        id: a.id,
                        label: a.label || a.id,
                        badge: summary,
                        tone: !ps.length ? 'neutral' : (hasZero ? (hasOk ? 'warn' : 'err') : 'ok'),
                    };
                }),
                {
                    id: 'claude',
                    label: 'Claude Pro',
                    badge: (cw && cw.ok)
                        ? `${Math.round(clampPct(cw.fiveHour?.remainingPct))}% · ${Math.round(clampPct(cw.weekly?.remainingPct))}%`
                        : 'ไม่ได้ใช้',
                    tone: !(cw && cw.ok) ? 'neutral' : ((cw.weekly?.remainingPct ?? 100) <= 0 ? 'err' : ((cw.fiveHour?.remainingPct ?? 100) <= 0 ? 'warn' : 'ok')),
                },
                {
                    id: 'credits',
                    label: 'เครดิต API',
                    badge: [
                        (ds && ds.ok) ? `$${ds.totalBalance}` : null,
                        (gc && gc.ok) ? `฿${Math.round(Number(gc.remainingThb))}` : null,
                    ].filter(Boolean).join(' · ') || '—',
                    tone: 'ok',
                },
            ];

            tabsEl.innerHTML = tabs.map((t) => `
                <button type="button" class="ov3-tab" role="tab" aria-selected="${ui.quotaTab === t.id ? 'true' : 'false'}" data-quota-tab="${esc(t.id)}">
                    <span>${esc(t.label)}</span>
                    <span class="ov3-badge" data-tone="${esc(t.tone)}">${esc(t.badge)}</span>
                </button>
            `).join('');
        }

        if (ui.quotaTab === 'all') {
            const flatCards = [];
            accounts.forEach((a, idx) => {
                flatCards.push(buildGooglePoolCards(a, { accountTag: shortAccountTag(a, idx) }));
            });
            flatCards.push(buildClaudeUnifiedCard(cw, { accountTag: '' }));
            flatCards.push(buildCreditsCards(ds, gc, { compact: true }));
            gridEl.innerHTML = `<div class="ov3-qpool-grid">${flatCards.join('')}</div>`;
        } else {
            const sections = [];
            for (const a of accounts) {
                if (ui.quotaTab === a.id) {
                    sections.push(renderGoogleQuotaSection(a));
                }
            }
            if (ui.quotaTab === 'claude') {
                sections.push(renderClaudeQuotaSection(cw));
            }
            if (ui.quotaTab === 'credits') {
                sections.push(renderCreditsQuotaSection(ds, gc));
            }
            gridEl.innerHTML = sections.join('');
        }
        renderQuotaModelsTable(q);
    }

    async function fetchQuotaData(force = false) {
        if (ui.quotaInFlight) return;
        if (!force && (document.hidden || !isOverviewActive())) return;
        ui.quotaInFlight = true;
        try {
            const [primary, accountsRes] = await Promise.all([
                fetchJsonSafe('/api/gemini/quota'),
                fetchJsonSafe('/api/ai-router/accounts'),
            ]);
            const rawAccts = (accountsRes && Array.isArray(accountsRes.accounts)) ? accountsRes.accounts : [];
            const extraDefs = rawAccts.filter((a) => a && a.id && a.id !== 'g1' && a.ready);
            const extraResults = await Promise.all(extraDefs.map(async (a) => ({
                id: a.id,
                label: a.label || a.id,
                email: a.email || '',
                data: await fetchJsonSafe(`/api/gemini/quota?account=${encodeURIComponent(a.id)}`),
            })));

            ui.quota = {
                accounts: [
                    {
                        id: 'g1',
                        label: (primary && primary.accountLabel) || 'Google#1',
                        email: (primary && primary.email) || '',
                        data: primary,
                    },
                    ...extraResults,
                ],
                claudeWeb: primary ? primary.claudeWeb : null,
                deepseek: primary ? primary.deepseek : null,
                geminiCredit: primary ? primary.geminiCredit : null,
            };
            ui.quotaUpdatedAt = Date.now();
            renderQuotaPanel(ui.quota);
        } catch (_) {
            // keep last rendered quota snapshot quietly
        } finally {
            ui.quotaInFlight = false;
        }
    }

    // ── Video Factory Control Panel ─────────────────────────────────────────
    const QUICK_STYLE_MAP = {
        'documentary-cinematic': 'look-1',
        'news-broadcast': 'look-32',
        'explainer-tech': 'look-3',
        'storytelling-dark': 'look-14',
        'minimal-clean': 'look-20',
    };

    const QUICK_VOICE_MAP = {
        'gemini-charon': 'gemini:Charon',
        'gemini-kore': 'gemini:Kore',
        'edge-niwat': 'edge:th-TH-NiwatNeural',
        'edge-premwadee': 'edge:th-TH-PremwadeeNeural',
    };

    const STATION_FALLBACK_META = {
        script:  { id: 'script',  emoji: '📝', name: 'น้องสคริปต์', dept: 'แผนกเขียนบท',       role: 'ค้นข้อมูล วางโครงเรื่อง และเขียนบทบรรยาย' },
        art:     { id: 'art',     emoji: '🎨', name: 'น้องอาร์ต',    dept: 'แผนกภาพ & ฉาก',      role: 'ออกแบบภาพประกอบ ซีนกราฟิก และสตอรี่บอร์ด' },
        voice:   { id: 'voice',   emoji: '🎙️', name: 'น้องพากย์',    dept: 'ห้องอัดเสียง TTS',    role: 'พากย์เสียงภาษาไทย ซิงก์จังหวะ และมิกซ์ BGM' },
        edit:    { id: 'edit',    emoji: '🎬', name: 'น้องตัดต่อ',   dept: 'สถานีตัดต่อ & GPU',   role: 'ประกอบวิดีโอ Remotion และเรนเดอร์บนเครื่องลูก GPU' },
        publish: { id: 'publish', emoji: '🚀', name: 'น้องโพสต์',    dept: 'ตรวจ QC & โซเชียล',   role: 'ตรวจสอบคุณภาพ QC และส่งโพสต์ TikTok/Reels/Shorts' },
    };

    function setFactoryFeedback(text, tone = 'ok', durationMs = 5500) {
        if (ui.factoryFeedbackTimer) {
            clearTimeout(ui.factoryFeedbackTimer);
            ui.factoryFeedbackTimer = null;
        }
        if (!text) {
            ui.factoryFeedback = null;
            renderFactoryFeedback();
            return;
        }
        ui.factoryFeedback = { text: String(text), tone, until: Date.now() + durationMs };
        renderFactoryFeedback();
        ui.factoryFeedbackTimer = setTimeout(() => {
            ui.factoryFeedback = null;
            ui.factoryFeedbackTimer = null;
            renderFactoryFeedback();
        }, durationMs);
    }

    function renderFactoryFeedback() {
        const panel = $('ov3-panel-factory');
        if (!panel) return;
        const body = panel.querySelector('.ov3-fac-body');
        if (!body) return;
        let el = $('ov3-fac-feedback');
        const fb = ui.factoryFeedback;
        if (!fb || Date.now() >= fb.until) {
            if (el) el.remove();
            return;
        }
        if (!el) {
            el = document.createElement('div');
            el.id = 'ov3-fac-feedback';
            el.className = 'ov3-qpace';
            el.setAttribute('role', 'status');
            el.setAttribute('aria-live', 'polite');
            const pipeEl = $('ov3-fac-pipeline');
            if (pipeEl && pipeEl.nextSibling) body.insertBefore(el, pipeEl.nextSibling);
            else body.prepend(el);
        }
        el.setAttribute('data-level', fb.tone === 'err' ? '3' : (fb.tone === 'warn' ? '2' : '1'));
        el.title = fb.text;
        el.textContent = fb.text;
    }

    function resolveActiveStationFromJob(job) {
        if (!job) return 'edit';
        const combined = `${String(job.status || '').toLowerCase()} ${String(job.stage || job.currentStep || '').toLowerCase()}`;
        if (/(publish|upload|social|telegram|post|qc)/.test(combined)) return 'publish';
        if (/(render|mix|edit|remotion|ffmpeg|preview|compos|encode)/.test(combined)) return 'edit';
        if (/(tts|voice|audio|narrat|speech)/.test(combined)) return 'voice';
        if (/(art|image|visual|story|scene|draw|extract|download|asset)/.test(combined)) return 'art';
        if (/(script|research|plan|draft|analyz|queue)/.test(combined)) return 'script';
        const pct = Number(job.progress ?? job.pct ?? 0);
        if (pct >= 88) return 'publish';
        if (pct >= 58) return 'edit';
        if (pct >= 38) return 'voice';
        if (pct >= 18) return 'art';
        return 'script';
    }

    function renderFactoryPanel() {
        const panel = $('ov3-panel-factory');
        if (!panel) return;

        const fs = ui.factoryState;
        const subEl = $('ov3-fac-sub');
        const pipeEl = $('ov3-fac-pipeline');
        const linesEl = $('ov3-fac-lines');
        const qcEl = $('ov3-fac-qc');

        const jobs = (fs && Array.isArray(fs.jobs)) ? fs.jobs : [];
        const lines = (fs && Array.isArray(fs.lines)) ? fs.lines : [];
        const analytics = (fs && fs.analytics) || {};
        const socialItems = (ui.socialQueue && Array.isArray(ui.socialQueue.items)) ? ui.socialQueue.items : [];

        const runningJobs = jobs.filter((j) => j && (j.factoryCol === 'running' || j.alive || ACTIVE_VIDEO_STATUSES.has(String(j.status || '').toLowerCase())));
        const queuedCount = Number(analytics.queuedJobs ?? jobs.filter((j) => j && j.factoryCol === 'queued').length) || 0;
        const scriptCount = Number(analytics.scriptJobs ?? jobs.filter((j) => j && j.factoryCol === 'script').length) || 0;
        const activeCount = Number(analytics.runningJobs ?? runningJobs.length) || 0;
        const qcJobs = jobs.filter((j) => j && (j.factoryCol === 'qc' || (j.status === 'done' && String(j.qcStatus || 'pending') === 'pending')));
        const qcCount = Number(analytics.qcPendingJobs ?? qcJobs.length) || 0;
        const readyCount = Number(analytics.qcApprovedJobs ?? jobs.filter((j) => j && j.factoryCol === 'ready').length) || 0;
        const monthCost = Number(analytics.monthCostThb ?? 0) || 0;

        if (subEl) {
            if (!fs) {
                subEl.textContent = 'กำลังเชื่อมต่อสถานะโรงงาน…';
            } else {
                subEl.textContent = `กำลังผลิต ${activeCount} · รอ QC ${qcCount} · พร้อมโพสต์ ${readyCount} · เดือนนี้ ${fmtThb(monthCost)}`;
            }
        }

        if (pipeEl) {
            const activeStation = runningJobs.length ? resolveActiveStationFromJob(runningJobs[0]) : 'edit';
            const stages = [
                { key: 'queued', label: 'รอคิว',      count: queuedCount, focus: 'script' },
                { key: 'script', label: 'สคริปต์',     count: scriptCount, focus: 'script' },
                { key: 'active', label: 'กำลังผลิต',   count: activeCount, focus: activeStation },
                { key: 'qc',     label: 'รอ QC',       count: qcCount,     focus: 'publish' },
                { key: 'social', label: 'พร้อมโพสต์',  count: readyCount,  focus: 'publish' },
            ];
            pipeEl.innerHTML = stages.map((st) => `
                <div class="ov3-fac-stage${st.count > 0 ? ' has-items' : ''}" data-fac-stage="${esc(st.key)}" data-fac-focus="${esc(st.focus)}" role="button" tabindex="0" style="cursor:pointer" title="คลิกเพื่อโฟกัสแผนกนี้ในโมเดล 3D">
                    <strong>${esc(st.count)}</strong>
                    <span>${esc(st.label)}</span>
                </div>
            `).join('');
        }

        renderFactoryFeedback();

        if (linesEl) {
            if (!fs) {
                linesEl.innerHTML = '<div class="ov3-fac-empty">กำลังโหลดสายการผลิต…</div>';
            } else if (!lines.length) {
                linesEl.innerHTML = '<div class="ov3-fac-empty">ยังไม่มีสายการผลิต — ตั้งค่าได้ที่หน้าโรงงานวิดีโอ</div>';
            } else {
                linesEl.innerHTML = lines.map((ln) => {
                    const enabled = Boolean(ln.active);
                    const busyToggle = ui.factoryBusyKey === `toggle:${ln.id}`;
                    const busyRun = ui.factoryBusyKey === `run:${ln.id}`;
                    const meta = [ln.schedule || 'Manual', ln.lastRunStatus || (enabled ? 'พร้อมใช้งาน' : 'พักชั่วคราว')].filter(Boolean).join(' · ');
                    return `
                        <div class="ov3-fac-line ${enabled ? 'is-enabled' : 'is-disabled'}">
                            <div class="ov3-fac-line__info">
                                <div class="ov3-fac-line__name" title="${esc(ln.description || ln.name)}">${enabled ? '🟢' : '⏸️'} ${esc(ln.name || ln.id)}</div>
                                <div class="ov3-fac-line__meta" title="${esc(meta)}">${esc(meta)}</div>
                            </div>
                            <div class="ov3-fac-line__acts">
                                <button type="button" class="ov2-btn ov2-btn--xs ov2-btn--ghost" data-fac-toggle-line="${esc(ln.id)}" ${busyToggle ? 'disabled' : ''} title="${enabled ? 'ปิดสายการผลิตนี้ชั่วคราว' : 'เปิดใช้งานสายการผลิตนี้'}">${busyToggle ? '…' : (enabled ? 'เปิด' : 'ปิด')}</button>
                                <button type="button" class="ov2-btn ov2-btn--xs ov2-btn--primary" data-fac-run-line="${esc(ln.id)}" ${busyRun ? 'disabled' : ''} title="สั่งรันสายการผลิตนี้ทันที">${busyRun ? '…' : '▶ รัน'}</button>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        if (qcEl) {
            if (!fs) {
                qcEl.innerHTML = '<div class="ov3-fac-empty">กำลังโหลดรายการตรวจ QC…</div>';
            } else {
                const sortedQc = [...qcJobs]
                    .sort((a, b) => (Date.parse(b.updatedAt || b.createdAt || '') || 0) - (Date.parse(a.updatedAt || a.createdAt || '') || 0))
                    .slice(0, 4);

                const qcRowsHtml = sortedQc.length
                    ? sortedQc.map((j) => {
                        const out = j.outputs || {};
                        const dur = Number(out.durationSec ?? j.durationSec) || 0;
                        const cost = out.costDetails?.clipTotalThb ?? out.costThb;
                        const rNode = out.renderNode || j.renderNode || '';
                        const meta = [
                            dur ? fmtDuration(dur) : '',
                            cost != null && Number(cost) > 0 ? fmtThb(cost) : '',
                            rNode,
                            j.updatedAt || j.createdAt ? fmtRelTime(j.updatedAt || j.createdAt) : '',
                        ].filter(Boolean).join(' · ');
                        const busyQc = ui.factoryBusyKey === `qc:${j.id}`;
                        return `
                            <div class="ov3-fac-qc-row">
                                <div class="ov3-fac-qc__info">
                                    <div class="ov3-fac-qc__title" title="${esc(j.topic || j.id)}">${esc(j.topic || j.id)}</div>
                                    <div class="ov3-fac-qc__meta">${esc(meta || j.styleId || 'รอตรวจคุณภาพ')}</div>
                                </div>
                                <div class="ov3-fac-qc__acts">
                                    <button type="button" class="ov2-btn ov2-btn--xs ov2-btn--ghost" data-fac-preview-job="${esc(j.id)}" title="ดูตัวอย่างคลิป">▶ ดู</button>
                                    <button type="button" class="ov2-btn ov2-btn--xs ov2-btn--primary" data-fac-approve-qc="${esc(j.id)}" ${busyQc ? 'disabled' : ''} title="อนุมัติผ่าน QC">${busyQc ? '…' : '✅ ผ่าน QC'}</button>
                                    <a class="ov2-btn ov2-btn--xs ov2-btn--ghost" href="/video-studio#qc=${encodeURIComponent(j.id)}" title="แก้/โพสต์ที่ Video Studio">↗</a>
                                </div>
                            </div>
                        `;
                    }).join('')
                    : '<div class="ov3-fac-empty">ไม่มีคลิปรอตรวจ QC — ทุกคลิปพร้อมโพสต์</div>';

                const postedCount = socialItems.filter((it) => ['posted', 'published', 'done'].includes(String(it.status || '').toLowerCase())).length
                    || Number(analytics.socialPublishedCount || 0);
                const scheduledCount = socialItems.filter((it) => ['scheduled', 'queued', 'pending'].includes(String(it.status || '').toLowerCase())).length
                    || Number(analytics.socialScheduledCount || 0);
                const bvSocialCount = socialItems.filter((it) => {
                    const st = String(it.status || '').toLowerCase();
                    return (it.mode === 'browser_vision' && !['posted', 'published', 'done', 'completed', 'cancelled', 'failed'].includes(st))
                        || /login|auth|captcha|waiting_user|browser_vision/.test(st);
                }).length;

                const socialSummary = `
                    <div class="ov3-fac-qc-row" style="border-style:dashed;">
                        <div class="ov3-fac-qc__info">
                            <div class="ov3-fac-qc__title">📤 คิวโพสต์โซเชียล</div>
                            <div class="ov3-fac-qc__meta">โพสต์แล้ว ${esc(postedCount)} · ตั้งเวลา ${esc(scheduledCount)}${bvSocialCount > 0 ? ` · 🔐 BV ${esc(bvSocialCount)}` : ''}</div>
                        </div>
                        <div class="ov3-fac-qc__acts">
                            <a class="ov2-btn ov2-btn--xs ov2-btn--ghost" href="/video-studio">โพสต์ ↗</a>
                        </div>
                    </div>
                `;
                qcEl.innerHTML = qcRowsHtml + socialSummary;
            }
        }
    }

    async function fetchFactoryState(force = false) {
        if (ui.factoryInFlight) return;
        if (!force && (document.hidden || !isOverviewActive())) return;
        ui.factoryInFlight = true;
        try {
            const [facRes, socRes] = await Promise.all([
                fetchJsonSafe('/api/video-studio/factory/state'),
                fetchJsonSafe('/api/video-studio/social/queue'),
            ]);
            if (facRes && facRes.ok) {
                ui.factoryState = facRes;
                ui.factoryUpdatedAt = Date.now();
            }
            if (socRes && socRes.ok) {
                ui.socialQueue = socRes;
            }
            renderFactoryPanel();
            if (ui.wsView === '3d') syncWorkshop3D();
            else syncPixelOffice();
        } catch (_) {
            // keep last rendered factory snapshot quietly
        } finally {
            ui.factoryInFlight = false;
        }
    }

    async function postFactoryJson(url, bodyObj) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: bodyObj !== undefined ? JSON.stringify(bodyObj) : '{}',
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || (data && data.ok === false)) {
            throw new Error((data && data.error) || `HTTP ${res.status}`);
        }
        return data || { ok: true };
    }

    async function submitQuickFactoryOrder(e) {
        if (e) e.preventDefault();
        const topicEl = $('ov3-fac-topic');
        const styleEl = $('ov3-fac-style');
        const voiceEl = $('ov3-fac-voice');
        const durEl = $('ov3-fac-duration');
        const submitBtn = $('ov3-fac-submit');
        const form = $('ov3-fac-quick-form');
        const toggleBtn = $('ov3-fac-quick-toggle');

        const topic = String(topicEl?.value || '').trim();
        if (topic.length < 2) {
            setFactoryFeedback('กรุณาระบุหัวข้อคลิปอย่างน้อย 2 ตัวอักษร', 'warn');
            topicEl?.focus();
            return;
        }

        const rawStyle = String(styleEl?.value || 'documentary-cinematic').trim();
        const styleId = QUICK_STYLE_MAP[rawStyle] || rawStyle || 'look-1';
        const rawVoice = String(voiceEl?.value || 'gemini-charon').trim();
        const voice = QUICK_VOICE_MAP[rawVoice] || rawVoice || 'gemini:Charon';
        const durationSec = Math.max(15, Math.min(240, Number(durEl?.value || 60) || 60));
        const contentMode = rawStyle === 'news-broadcast' ? 'news' : 'standard';

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'กำลังส่ง…';
        }
        try {
            const res = await postFactoryJson('/api/video-studio/factory/orders', {
                topic,
                styleId,
                voice,
                bgm: 'warm_tech',
                durationSec,
                stopGate: 'qc',
                contentMode,
            });
            setFactoryFeedback(`✅ ${res.message || 'ส่งออเดอร์เข้าสายพานผลิตแล้ว'}`, 'ok', 6500);
            if (topicEl) topicEl.value = '';
            if (form) form.hidden = true;
            if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
            await Promise.all([fetchFactoryState(true), tick(true)]);
        } catch (err) {
            setFactoryFeedback(`❌ ส่งออเดอร์ไม่สำเร็จ: ${err.message || err}`, 'err', 7000);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = '🚀 ส่งเข้าสายผลิต';
            }
        }
    }

    async function toggleFactoryLine(lineId) {
        if (!lineId || ui.factoryBusyKey) return;
        ui.factoryBusyKey = `toggle:${lineId}`;
        renderFactoryPanel();
        try {
            const res = await postFactoryJson(`/api/video-studio/factory/lines/${encodeURIComponent(lineId)}/toggle`, {});
            const active = Boolean(res.line && res.line.active);
            setFactoryFeedback(`${active ? '🟢 เปิด' : '⏸️ พัก'}สายการผลิต "${(res.line && res.line.name) || lineId}" แล้ว`, 'ok');
            await fetchFactoryState(true);
        } catch (err) {
            setFactoryFeedback(`❌ เปลี่ยนสถานะสายไม่สำเร็จ: ${err.message || err}`, 'err');
        } finally {
            ui.factoryBusyKey = null;
            renderFactoryPanel();
        }
    }

    async function runFactoryLine(lineId) {
        if (!lineId || ui.factoryBusyKey) return;
        ui.factoryBusyKey = `run:${lineId}`;
        const newsBtn = lineId === 'line-news-v2' ? $('ov3-fac-run-news') : null;
        if (newsBtn) newsBtn.disabled = true;
        renderFactoryPanel();
        try {
            const res = await postFactoryJson(`/api/video-studio/factory/lines/${encodeURIComponent(lineId)}/run`, {});
            const msg = (res.result && res.result.message) || `เริ่มรันสาย "${(res.line && res.line.name) || lineId}" แล้ว`;
            setFactoryFeedback(`🚀 ${msg}`, 'ok', 6500);
            await Promise.all([fetchFactoryState(true), tick(true)]);
        } catch (err) {
            setFactoryFeedback(`❌ สั่งรันสายไม่สำเร็จ: ${err.message || err}`, 'err', 7000);
        } finally {
            ui.factoryBusyKey = null;
            if (newsBtn) newsBtn.disabled = false;
            renderFactoryPanel();
        }
    }

    async function pumpFactoryQueue() {
        const pumpBtn = $('ov3-fac-pump');
        if (ui.factoryBusyKey) return;
        ui.factoryBusyKey = 'pump';
        if (pumpBtn) pumpBtn.disabled = true;
        try {
            const res = await postFactoryJson('/api/video-studio/factory/pump', {});
            if (res.started) {
                setFactoryFeedback(`▶ ปั๊มคิวสำเร็จ — เริ่มผลิตงาน ${res.started}`, 'ok');
            } else if (res.active > 0) {
                setFactoryFeedback('⚡ มีงานกำลังผลิตอยู่บนสายพานแล้ว', 'ok');
            } else {
                setFactoryFeedback('✓ ไม่มีงานรอคิวในสายพานขณะนี้', 'ok');
            }
            await Promise.all([fetchFactoryState(true), tick(true)]);
        } catch (err) {
            setFactoryFeedback(`❌ ปั๊มคิวไม่สำเร็จ: ${err.message || err}`, 'err');
        } finally {
            ui.factoryBusyKey = null;
            if (pumpBtn) pumpBtn.disabled = false;
        }
    }

    async function approveFactoryQC(jobId) {
        if (!jobId || ui.factoryBusyKey) return;
        ui.factoryBusyKey = `qc:${jobId}`;
        renderFactoryPanel();
        try {
            await postFactoryJson(`/api/video-studio/factory/jobs/${encodeURIComponent(jobId)}/qc`, {
                qcStatus: 'approved',
                status: 'approved',
                note: 'อนุมัติผ่าน QC จากแดชบอร์ดภาพรวม',
            });
            setFactoryFeedback(`✅ อนุมัติผ่าน QC เรียบร้อย (${jobId})`, 'ok');
            await fetchFactoryState(true);
        } catch (err) {
            setFactoryFeedback(`❌ อนุมัติ QC ไม่สำเร็จ: ${err.message || err}`, 'err');
        } finally {
            ui.factoryBusyKey = null;
            renderFactoryPanel();
        }
    }

    // ── 3D Digital Workshop Stage Controller ────────────────────────────────
    function getCurrentTheme() {
        const attr = document.documentElement.getAttribute('data-theme');
        if (attr) return attr;
        try {
            const saved = localStorage.getItem('lab_theme');
            if (saved) return saved;
        } catch (_) {}
        return 'dark';
    }

    function getLiveActiveVideoJob() {
        const facJobs = (ui.factoryState && Array.isArray(ui.factoryState.jobs)) ? ui.factoryState.jobs : [];
        const runningFac = facJobs.find((j) => j && (j.alive || j.factoryCol === 'running' || ACTIVE_VIDEO_STATUSES.has(String(j.status || '').toLowerCase())));
        if (runningFac) return runningFac;
        const ovJobs = (ui.lastData && ui.lastData.videos && Array.isArray(ui.lastData.videos.activeJobs)) ? ui.lastData.videos.activeJobs : [];
        if (ovJobs.length) return ovJobs[0];
        const socItems = (ui.socialQueue && Array.isArray(ui.socialQueue.items)) ? ui.socialQueue.items : [];
        const uploadingSoc = socItems.find((it) => it && ['uploading', 'posting', 'running'].includes(String(it.status || '').toLowerCase()));
        if (uploadingSoc) return { topic: uploadingSoc.title || `โพสต์ ${uploadingSoc.platform || 'Social'}`, status: 'uploading', progress: 92 };
        return null;
    }

    function updateWorkshopCamAndDockHighlight() {
        const camBar = $('ov3-ws-cam-bar');
        if (camBar) {
            camBar.querySelectorAll('[data-ws-cam]').forEach((btn) => {
                btn.classList.toggle('is-active', btn.dataset.wsCam === ui.wsSelectedStation);
            });
        }
        const dock = $('ov3-ws-dock');
        if (dock) {
            dock.querySelectorAll('[data-ws-station]').forEach((btn) => {
                btn.classList.toggle('is-selected', btn.dataset.wsStation === ui.wsSelectedStation);
            });
        }
    }

    function renderWorkshopInspector(meta) {
        const el = $('ov3-ws-inspector');
        if (!el) return;
        if (!meta || !meta.id || meta.id === 'overview') {
            ui.wsInspectorOpen = false;
            el.hidden = true;
            return;
        }

        const fb = STATION_FALLBACK_META[meta.id] || {};
        const name = meta.name || fb.name || meta.id;
        const emoji = meta.emoji || fb.emoji || '🎬';
        const dept = meta.dept || fb.dept || '';
        const role = meta.role || fb.role || '';
        const status = meta.status || 'idle';
        const tone = status === 'active' ? 'ok' : (status === 'done' ? 'ok' : (status === 'pending' ? 'warn' : (status === 'error' ? 'err' : 'neutral')));
        const statusText = meta.statusText || 'พร้อม';

        const detailLines = [];
        if (role) detailLines.push(`<div><strong>หน้าที่:</strong> ${esc(role)}</div>`);
        if (meta.jobTitle) detailLines.push(`<div><strong>งานปัจจุบัน:</strong> ${esc(meta.jobTitle)}${meta.progress ? ` (${Math.round(clampPct(meta.progress))}%)` : ''}</div>`);
        if (meta.detail) detailLines.push(`<div><strong>สถานะ:</strong> ${esc(meta.detail)}</div>`);
        if (meta.renderNode) detailLines.push(`<div><strong>เครื่องเรนเดอร์:</strong> <span class="ov2-mono">${esc(meta.renderNode)}</span></div>`);

        let quickActs = '';
        if (meta.id === 'script') {
            quickActs = `<button type="button" class="ov2-btn ov2-btn--xs ov2-btn--primary" data-ws-action="quick-order">+ สั่งคลิปด่วน</button><a class="ov2-btn ov2-btn--xs ov2-btn--ghost" href="/video-studio">แก้บท ↗</a>`;
        } else if (meta.id === 'art') {
            quickActs = `<button type="button" class="ov2-btn ov2-btn--xs ov2-btn--primary" data-ws-action="quick-order">+ สั่งคลิปด่วน</button><a class="ov2-btn ov2-btn--xs ov2-btn--ghost" href="/video-studio">เลือกสไตล์ ↗</a>`;
        } else if (meta.id === 'voice') {
            quickActs = `<button type="button" class="ov2-btn ov2-btn--xs ov2-btn--primary" data-ws-action="pump">▶ ปั๊มคิว</button><a class="ov2-btn ov2-btn--xs ov2-btn--ghost" href="/video-studio">ตั้งค่าเสียง ↗</a>`;
        } else if (meta.id === 'edit') {
            quickActs = `<a class="ov2-btn ov2-btn--xs ov2-btn--primary" href="/agent-hub">ดูเครื่อง GPU ↗</a><a class="ov2-btn ov2-btn--xs ov2-btn--ghost" href="/video-studio">เปิดตัดต่อ ↗</a>`;
        } else if (meta.id === 'publish') {
            quickActs = `<button type="button" class="ov2-btn ov2-btn--xs ov2-btn--primary" data-ws-action="jump-qc">🔍 ตรวจ QC</button><a class="ov2-btn ov2-btn--xs ov2-btn--ghost" href="/video-studio">Social Hub ↗</a>`;
        }

        el.innerHTML = `
            <div class="ov3-ws-insp__head">
                <div class="ov3-ws-insp__title">${esc(emoji)} ${esc(name)} <span class="ov3-badge" data-tone="${tone}" style="margin-left:4px;">${esc(statusText)}</span></div>
                <button type="button" class="ov3-ws-insp__close" data-ws-insp-close="1" aria-label="ปิดรายละเอียด">✕</button>
            </div>
            ${dept ? `<div class="ov3-ws-insp__meta" style="opacity:0.85;">${esc(dept)}</div>` : ''}
            <div class="ov3-ws-insp__meta">${detailLines.join('')}</div>
            <div class="ov3-ws-insp__actions">
                ${quickActs}
                <button type="button" class="ov2-btn ov2-btn--xs ov2-btn--ghost" data-ws-cam="overview">🌐 ภาพรวม</button>
            </div>
        `;
        el.hidden = false;
        ui.wsInspectorOpen = true;
    }

    function selectWorkshopStation(stationId, { showInspector = true } = {}) {
        const id = stationId && STATION_FALLBACK_META[stationId] ? stationId : 'overview';
        ui.wsSelectedStation = id;
        let meta = null;
        if (ui.wsCtrl && typeof ui.wsCtrl.focusStation === 'function') {
            meta = ui.wsCtrl.focusStation(id);
        }
        updateWorkshopCamAndDockHighlight();
        if (id === 'overview' || !showInspector) {
            renderWorkshopInspector(null);
        } else {
            const st = ui.wsCtrl && typeof ui.wsCtrl.getState === 'function' ? ui.wsCtrl.getState() : null;
            renderWorkshopInspector((st && st.stations && st.stations[id]) || meta || STATION_FALLBACK_META[id]);
        }
    }

    function syncWorkshopActive() {
        const ovActive = isOverviewActive() && !document.hidden;
        if (ui.poCtrl && typeof ui.poCtrl.setActive === 'function') {
            ui.poCtrl.setActive(ovActive && ui.wsView === 'pixel');
        }
        if (ui.wsCtrl && typeof ui.wsCtrl.setActive === 'function') {
            ui.wsCtrl.setActive(ovActive && ui.wsView === '3d');
        }
    }

    function syncWorkshop3D() {
        const liveJob = getLiveActiveVideoJob();
        const hasLive = Boolean(liveJob);

        // Auto-switch to Live mode the instant a real video production job starts;
        // auto-enable Demo Showcase when idle unless user explicitly toggled it off.
        if (hasLive) {
            if (!ui.wsHadLiveActive || ui.wsUserDemoOverride === null) {
                ui.wsDemoMode = false;
            }
        } else if (ui.wsUserDemoOverride === null) {
            ui.wsDemoMode = true;
        }
        ui.wsHadLiveActive = hasLive;

        if (ui.wsCtrl) {
            try {
                const prevSt = typeof ui.wsCtrl.getState === 'function' ? ui.wsCtrl.getState() : null;
                if (!prevSt || Boolean(prevSt.demoMode) !== Boolean(ui.wsDemoMode)) {
                    ui.wsCtrl.setDemoMode(Boolean(ui.wsDemoMode));
                }
                ui.wsCtrl.updateState({
                    factoryState: ui.factoryState,
                    overviewData: ui.lastData,
                    socialQueue: ui.socialQueue,
                });
            } catch (_) {}
        }

        if (ui.wsView !== '3d') return;

        const wsState = (ui.wsCtrl && typeof ui.wsCtrl.getState === 'function') ? ui.wsCtrl.getState() : null;
        const badgeEl = $('ov3-ws-live-badge');
        const jobEl = $('ov3-ws-active-job');
        const demoBtn = $('ov3-ws-demo-btn');

        if (badgeEl) {
            if (hasLive && !ui.wsDemoMode) {
                badgeEl.setAttribute('data-mode', 'live');
                badgeEl.innerHTML = '<i></i><span>🟢 LIVE</span>';
            } else if (ui.wsDemoMode) {
                badgeEl.setAttribute('data-mode', 'demo');
                badgeEl.innerHTML = '<i></i><span>🎬 DEMO SHOWCASE</span>';
            } else {
                badgeEl.setAttribute('data-mode', 'idle');
                badgeEl.innerHTML = '<i></i><span>✨ STUDIO STANDBY</span>';
            }
        }

        if (jobEl) {
            if (hasLive && !ui.wsDemoMode) {
                const title = String(liveJob.topic || liveJob.title || liveJob.id || 'กำลังผลิตวิดีโอ');
                const pct = Math.round(clampPct(liveJob.progress ?? liveJob.pct));
                jobEl.textContent = `กำลังผลิต ${title}${pct > 0 ? ` (${pct}%)` : ''}`;
            } else if (ui.wsDemoMode) {
                jobEl.textContent = (wsState && wsState.summary && wsState.summary.headline)
                    || '🎬 โหมดสาธิต · พนักงานการ์ตูน 5 แผนกกำลังผลิตวิดีโอครบสายพาน';
            } else {
                jobEl.textContent = (wsState && wsState.summary && wsState.summary.headline)
                    || '✨ พร้อมรับออเดอร์ผลิตวิดีโอ';
            }
        }

        if (demoBtn) {
            demoBtn.classList.toggle('is-active', Boolean(ui.wsDemoMode));
            demoBtn.setAttribute('aria-pressed', ui.wsDemoMode ? 'true' : 'false');
            demoBtn.textContent = ui.wsDemoMode ? '🎬 โหมดสาธิต (เปิด)' : '🎬 สาธิตการทำงาน';
        }

        const dockEl = $('ov3-ws-dock');
        if (dockEl) {
            const stations = (wsState && wsState.stations) || {};
            dockEl.querySelectorAll('[data-ws-station]').forEach((btn) => {
                const sid = btn.dataset.wsStation;
                const st = stations[sid];
                btn.classList.remove('is-active', 'is-done', 'is-pending', 'is-idle', 'is-error');
                const status = (st && st.status) || (ui.wsDemoMode ? 'active' : 'idle');
                btn.classList.add(`is-${status}`);
                btn.classList.toggle('is-selected', ui.wsSelectedStation === sid);
                const stateEl = btn.querySelector('.ov3-ws-node__state');
                if (stateEl) {
                    if (st && st.status === 'active' && st.progress > 0) {
                        stateEl.textContent = `⚡ ${Math.round(clampPct(st.progress))}%`;
                    } else if (st && st.statusText) {
                        stateEl.textContent = st.statusText;
                    } else {
                        stateEl.textContent = ui.wsDemoMode ? '⚡ กำลังทำ' : 'พร้อม';
                    }
                }
            });
        }

        updateWorkshopCamAndDockHighlight();

        if (ui.wsInspectorOpen && ui.wsSelectedStation !== 'overview' && wsState && wsState.stations && wsState.stations[ui.wsSelectedStation]) {
            renderWorkshopInspector(wsState.stations[ui.wsSelectedStation]);
        }
    }

    function initWorkshop3D() {
        const hostEl = $('ov3-ws-canvas-host');
        if (!hostEl) return;

        const doMount = () => {
            if (ui.wsCtrl || !window.HomelabWorkshop3D || typeof window.HomelabWorkshop3D.mount !== 'function') return;
            const labelsEl = $('ov3-ws-labels');
            try {
                ui.wsCtrl = window.HomelabWorkshop3D.mount(hostEl, {
                    labelsEl,
                    theme: getCurrentTheme(),
                    demoMode: ui.wsDemoMode,
                    onSelectStation: (meta) => {
                        const id = (meta && meta.id) || 'overview';
                        ui.wsSelectedStation = id;
                        updateWorkshopCamAndDockHighlight();
                        renderWorkshopInspector(id === 'overview' ? null : meta);
                    },
                });
                syncWorkshop3D();
                syncWorkshopActive();
            } catch (err) {
                const jobEl = $('ov3-ws-active-job');
                if (jobEl) jobEl.textContent = 'ไม่สามารถเริ่มต้นฉาก 3D ได้ชั่วคราว';
            }
        };

        if (window.HomelabWorkshop3D && typeof window.HomelabWorkshop3D.mount === 'function') {
            doMount();
        } else {
            window.addEventListener('homelab:workshop3d-ready', doMount, { once: true });
            syncWorkshop3D();
        }
    }

    function initOfficeThemeObserver() {
        if (ui.officeThemeObsInit || typeof MutationObserver === 'undefined') return;
        ui.officeThemeObsInit = true;
        const themeObs = new MutationObserver(() => {
            const theme = getCurrentTheme();
            if (ui.wsCtrl && typeof ui.wsCtrl.setTheme === 'function') {
                ui.wsCtrl.setTheme(theme);
            }
            if (ui.poCtrl && typeof ui.poCtrl.setTheme === 'function') {
                ui.poCtrl.setTheme(theme);
            }
        });
        themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    async function fetchCronForOffice(force = false) {
        if (ui.cronInFlight) return;
        if (!force && (document.hidden || !isOverviewActive())) return;
        if (!force && (Date.now() - ui.cronFetchedAt < 30000)) return;
        ui.cronInFlight = true;
        try {
            const res = await fetchJsonSafe('/api/cron');
            if (res && res.ok && Array.isArray(res.jobs)) {
                ui.cronJobs = res.jobs;
                ui.cronFetchedAt = Date.now();
                if (ui.wsView === 'pixel') syncPixelOffice();
            } else if (Array.isArray(res)) {
                ui.cronJobs = res;
                ui.cronFetchedAt = Date.now();
                if (ui.wsView === 'pixel') syncPixelOffice();
            }
        } catch (_) {
            // keep last cron snapshot quietly
        } finally {
            ui.cronInFlight = false;
        }
    }

    function updatePixelDeptHighlight() {
        const bar = $('ov3-po-dept-bar');
        if (!bar) return;
        bar.querySelectorAll('[data-po-dept]').forEach((btn) => {
            btn.classList.toggle('is-active', btn.dataset.poDept === ui.poSelectedDept);
        });
    }

    function syncPixelOffice() {
        const liveVideo = getLiveActiveVideoJob();
        const aiRunning = Number(ui.lastData?.ai?.runningCount || 0) > 0;
        const agentsActive = Number(ui.lastData?.agents?.activeJobCount || 0) > 0;
        const now = Date.now();
        const cronActive = Array.isArray(ui.cronJobs) && ui.cronJobs.some((j) => {
            if (!j || !j.lastRunAt) return false;
            const ms = Number(j.lastRunAt);
            return Number.isFinite(ms) && (now - ms) >= 0 && (now - ms) < 180000;
        });
        const hasLive = Boolean(liveVideo || aiRunning || agentsActive || cronActive);

        if (hasLive) {
            if (!ui.poHadLiveActive || ui.poUserDemoOverride === null) {
                ui.poDemoMode = false;
            }
        } else if (ui.poUserDemoOverride === null) {
            ui.poDemoMode = true;
        }
        ui.poHadLiveActive = hasLive;

        let poSummary = null;
        if (ui.poCtrl) {
            try {
                if (typeof ui.poCtrl.setDemoMode === 'function') {
                    ui.poCtrl.setDemoMode(Boolean(ui.poDemoMode));
                }
                if (typeof ui.poCtrl.updateState === 'function') {
                    poSummary = ui.poCtrl.updateState({
                        overviewData: ui.lastData,
                        factoryState: ui.factoryState,
                        socialQueue: ui.socialQueue,
                        cronJobs: ui.cronJobs,
                    });
                }
                if (!poSummary && typeof ui.poCtrl.getState === 'function') {
                    poSummary = ui.poCtrl.getState();
                }
            } catch (_) {}
        }

        if (ui.wsView !== 'pixel') return;

        const badgeEl = $('ov3-ws-live-badge');
        const jobEl = $('ov3-ws-active-job');
        const demoBtn = $('ov3-po-demo-btn');
        const legendEl = $('ov3-po-legend');

        if (badgeEl) {
            if (hasLive && !ui.poDemoMode) {
                badgeEl.setAttribute('data-mode', 'live');
                badgeEl.innerHTML = '<i></i><span>🟢 LIVE OFFICE</span>';
            } else if (ui.poDemoMode) {
                badgeEl.setAttribute('data-mode', 'demo');
                badgeEl.innerHTML = '<i></i><span>🎮 SIMULATION</span>';
            } else {
                badgeEl.setAttribute('data-mode', 'idle');
                badgeEl.innerHTML = '<i></i><span>☕ CHILL MODE</span>';
            }
        }

        if (jobEl) {
            if (poSummary && poSummary.headline) {
                jobEl.textContent = poSummary.headline;
            } else if (hasLive && !ui.poDemoMode) {
                const parts = [];
                if (aiRunning) parts.push(`AI ${ui.lastData.ai.runningCount}`);
                if (liveVideo) parts.push('วิดีโอ');
                if (agentsActive) parts.push(`Hub ${ui.lastData.agents.activeJobCount}`);
                if (cronActive) parts.push('Cron');
                jobEl.textContent = `⚡ กำลังทำงานจริง: ${parts.join(' · ') || 'Homelab Pixel Company'}`;
            } else if (ui.poDemoMode) {
                jobEl.textContent = '🎮 โหมดจำลอง · ทีมเอเจนต์กำลังทำงาน ส่งงาน และพักผ่อนในออฟฟิศ';
            } else {
                jobEl.textContent = '☕ ออฟฟิศสงบ · เอเจนต์กำลังพักผ่อนรอรับงานใหม่';
            }
        }

        if (demoBtn) {
            demoBtn.classList.toggle('is-active', Boolean(ui.poDemoMode));
            demoBtn.setAttribute('aria-pressed', ui.poDemoMode ? 'true' : 'false');
            demoBtn.textContent = ui.poDemoMode ? '🎮 โหมดจำลอง (เปิด)' : '🎮 โหมดจำลอง';
        }

        if (legendEl) {
            if (poSummary && typeof poSummary === 'object') {
                const total = Number(poSummary.total ?? poSummary.agentCount ?? 0);
                const working = Number(poSummary.working ?? poSummary.busy ?? 0);
                const resting = Number(poSummary.resting ?? poSummary.idle ?? Math.max(0, total - working));
                const handoff = Number(poSummary.handoff ?? poSummary.delivering ?? 0);
                legendEl.innerHTML = `
                    <div class="ov3-po__legend-group">
                        <span class="ov3-po__legend-item"><i class="ov3-po__legend-dot ov3-po__legend-dot--work"></i>กำลังทำงาน <strong>${working}</strong></span>
                        <span class="ov3-po__legend-item"><i class="ov3-po__legend-dot ov3-po__legend-dot--idle"></i>พักผ่อน/เดินเล่น <strong>${resting}</strong></span>
                        <span class="ov3-po__legend-item"><i class="ov3-po__legend-dot ov3-po__legend-dot--handoff"></i>เดินส่งงาน <strong>${handoff}</strong></span>
                    </div>
                    <span class="ov3-po__legend-item">👥 เอเจนต์ทั้งหมด <strong>${total || 11}</strong> ตัว · คลิกห้องเพื่อซูม</span>
                `;
            } else {
                legendEl.innerHTML = `
                    <div class="ov3-po__legend-group">
                        <span class="ov3-po__legend-item"><i class="ov3-po__legend-dot ov3-po__legend-dot--work"></i>AI · วิดีโอ · ระบบ &amp; โหนด · พักผ่อน</span>
                        <span class="ov3-po__legend-item"><i class="ov3-po__legend-dot ov3-po__legend-dot--idle"></i>โถงพักผ่อน 4 โซน</span>
                    </div>
                    <span class="ov3-po__legend-item">${window.HomelabPixelOffice ? '👾 พร้อมแสดงผลพิกเซลออฟฟิศ' : '⏳ กำลังรอโมดูลพิกเซลออฟฟิศ…'}</span>
                `;
            }
        }
        updatePixelDeptHighlight();
    }

    function initPixelOffice() {
        const hostEl = $('ov3-po-host');
        if (!hostEl) return;

        const doMount = () => {
            if (ui.poCtrl || !window.HomelabPixelOffice || typeof window.HomelabPixelOffice.mount !== 'function') return;
            try {
                ui.poCtrl = window.HomelabPixelOffice.mount(hostEl, {
                    tooltipEl: $('ov3-po-tip'),
                    theme: getCurrentTheme(),
                    demoMode: ui.poDemoMode,
                    onSelect: (meta) => {
                        if (meta && meta.type === 'agent' && meta.agentId && ui.poPanels) {
                            ui.poPanels.select(meta.agentId);
                        }
                        if (meta && meta.dept) {
                            const deptMap = { ops: 'hub', cron: 'video' };
                            ui.poSelectedDept = deptMap[meta.dept] || meta.dept;
                            updatePixelDeptHighlight();
                        }
                    },
                });
                if (window.PixelOfficePanels) {
                    ui.poPanels = window.PixelOfficePanels.attach(hostEl.parentElement, ui.poCtrl, { hostEl });
                }
                syncPixelOffice();
                syncWorkshopActive();
            } catch (_) {
                const jobEl = $('ov3-ws-active-job');
                if (jobEl && ui.wsView === 'pixel') {
                    jobEl.textContent = 'ไม่สามารถเริ่มต้นพิกเซลออฟฟิศได้ชั่วคราว';
                }
            }
        };

        if (window.HomelabPixelOffice && typeof window.HomelabPixelOffice.mount === 'function') {
            doMount();
        } else {
            window.addEventListener('homelab:pixeloffice-ready', doMount, { once: true });
            syncPixelOffice();
        }
    }

    function setWorkshopView(view) {
        const next = view === '3d' ? '3d' : 'pixel';
        ui.wsView = next;
        try {
            localStorage.setItem('ov3.wsView', next);
        } catch (_) {}

        const card = $('ov3-workshop-3d');
        if (card) card.setAttribute('data-view', next);

        document.querySelectorAll('.ov3-ws3d__view-tab[data-ws-view]').forEach((btn) => {
            const active = btn.dataset.wsView === next;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        const poHost = $('ov3-po-host');
        const poTip = $('ov3-po-tip');
        const poLegend = $('ov3-po-legend');
        const wsHost = $('ov3-ws-canvas-host');
        const wsLabels = $('ov3-ws-labels');
        const wsInsp = $('ov3-ws-inspector');

        if (poHost) poHost.hidden = (next !== 'pixel');
        document.querySelectorAll('.po-pn, .po-tgl').forEach((el) => { el.hidden = (next !== 'pixel'); });
        if (poLegend) poLegend.hidden = (next !== 'pixel');
        if (poTip && next !== 'pixel') poTip.hidden = true;
        if (wsHost) wsHost.hidden = (next !== '3d');
        if (wsLabels) wsLabels.hidden = (next !== '3d');
        if (wsInsp && next !== '3d') wsInsp.hidden = true;

        if (next === '3d') {
            if (!ui.wsCtrl) initWorkshop3D();
            syncWorkshop3D();
        } else {
            if (!ui.poCtrl) initPixelOffice();
            syncPixelOffice();
        }
        syncWorkshopActive();
    }

    // ── Polling & Hook from app.js ──────────────────────────────────────────
    async function tick(force = false) {
        if (ui.inFlight) return;
        if (!force && (document.hidden || !isOverviewActive())) return;
        ui.inFlight = true;
        try {
            const data = await fetchOverviewData();
            if (data && data.ok) {
                ui.lastData = data;
                window.__labOverviewCache = data;
                ui.lastUpdatedAt = Date.now();
                pushHist(data);
                renderAll(data);
                if (ui.wsView === '3d') syncWorkshop3D();
                else syncPixelOffice();
            }
        } catch (_) {
            // keep last rendered snapshot quietly
        } finally {
            ui.inFlight = false;
        }
        if (isOverviewActive() && !document.hidden) {
            fetchCronForOffice(force);
        }
    }

    // Hook called by app.js every 5s after /api/summary returns (zero extra summary calls)
    function onSummaryUpdate(summary, rate) {
        ui.lastSummary = summary || null;
        if (rate && typeof rate === 'object') {
            ui.lastRate = { rx: Number(rate.rx) || 0, tx: Number(rate.tx) || 0 };
        }
        if (ui.lastData && summary) {
            const { host, infra } = buildInfraFromSummary(summary);
            ui.lastData.host = host;
            ui.lastData.infra = infra;
            if (ui.lastData.attention) ui.lastData.attention.servicesDown = infra.problems.length;
            window.__labOverviewCache = ui.lastData;
            ui.lastUpdatedAt = Date.now();
            if (Date.now() - ui.lastHistPushAt >= 4500) pushHist(ui.lastData);
            renderHeader(ui.lastData);
            renderKpis(ui.lastData);
            renderAttention(ui.lastData);
            renderResourceMatrix(ui.lastData);
            renderInfra(ui.lastData);
        }
    }

    window.updateOverviewV2 = onSummaryUpdate;
    // Preserve legacy hook name used by app.js line 2047
    window.updateOverviewGalaxy = onSummaryUpdate;

    // ── Event Delegation ────────────────────────────────────────────────────
    function bindEvents() {
        const root = $('ov2-root');
        if (!root) return;

        root.addEventListener('click', (e) => {
            const kpiBtn = e.target.closest('.ov3-kpi[data-jump]');
            if (kpiBtn) {
                const key = kpiBtn.dataset.kpiKey;
                if (key === 'activity' && ui.lastData) {
                    const att = ui.lastData.attention || {};
                    if ((att.aiRunning || 0) + (att.aiUnread || 0) === 0 && (att.videosUnseen || 0) + (att.rendersActive || 0) > 0) {
                        ui.activityTab = 'videos';
                    } else {
                        ui.activityTab = 'ai';
                    }
                    renderActivityTabs(ui.lastData);
                }
                jumpToPanel(kpiBtn.dataset.jump);
                return;
            }

            const attnToggle = e.target.closest('[data-attn-toggle]');
            if (attnToggle) {
                ui.attnExpanded = attnToggle.dataset.attnToggle === '1';
                if (ui.lastData) renderAttention(ui.lastData);
                return;
            }

            const jumpInfraBtn = e.target.closest('[data-jump-infra]');
            if (jumpInfraBtn) {
                ui.infraTab = jumpInfraBtn.dataset.jumpInfra || 'problems';
                if (ui.lastData) renderInfra(ui.lastData);
                jumpToPanel('#ov2-panel-infra');
                return;
            }

            const actTabBtn = e.target.closest('[data-activity-tab]');
            if (actTabBtn) {
                ui.activityTab = actTabBtn.dataset.activityTab;
                if (ui.lastData) {
                    renderActivityTabs(ui.lastData);
                    if (ui.activityTab === 'videos') renderVideosPanel(ui.lastData);
                    else renderAiPanel(ui.lastData);
                }
                return;
            }

            const aiTabBtn = e.target.closest('[data-ai-tab]');
            if (aiTabBtn) {
                ui.aiTab = aiTabBtn.dataset.aiTab;
                if (ui.lastData) renderAiPanel(ui.lastData);
                return;
            }

            const vidTabBtn = e.target.closest('[data-vid-tab]');
            if (vidTabBtn) {
                ui.videoTab = vidTabBtn.dataset.vidTab;
                if (ui.lastData) renderVideosPanel(ui.lastData);
                return;
            }

            const infraTabBtn = e.target.closest('[data-infra-tab]');
            if (infraTabBtn) {
                ui.infraTab = infraTabBtn.dataset.infraTab;
                if (ui.lastData) renderInfra(ui.lastData);
                return;
            }

            const markReadBtn = e.target.closest('[data-mark-chat-read]');
            if (markReadBtn) {
                e.preventDefault();
                markChatRead(markReadBtn.dataset.markChatRead);
                return;
            }

            const openChatEl = e.target.closest('[data-open-chat]');
            if (openChatEl) {
                e.preventDefault();
                openAiChat(openChatEl.dataset.openChat);
                return;
            }

            const playVidEl = e.target.closest('[data-play-video]');
            if (playVidEl) {
                e.preventDefault();
                openVideoPlayer(playVidEl.dataset.playVideo);
                return;
            }

            const toggleSeenBtn = e.target.closest('[data-toggle-video-seen]');
            if (toggleSeenBtn) {
                e.preventDefault();
                setVideoSeen({
                    id: toggleSeenBtn.dataset.toggleVideoSeen,
                    seen: toggleSeenBtn.dataset.nextSeen === '1',
                });
                return;
            }

            const restartBtn = e.target.closest('[data-restart-kind]');
            if (restartBtn) {
                e.preventDefault();
                restartService(restartBtn.dataset.restartKind, restartBtn.dataset.restartName);
                return;
            }

            // Global Sticky Browser Vision Alerts inside #ov3-attn
            const bvOpenBtn = e.target.closest('[data-bv-open]');
            if (bvOpenBtn) {
                e.preventDefault();
                window.HomelabBVAlerts?.openTarget?.(bvOpenBtn.dataset.bvOpen);
                return;
            }

            const bvResumeBtn = e.target.closest('[data-bv-resume]');
            if (bvResumeBtn) {
                e.preventDefault();
                window.HomelabBVAlerts?.resumeTarget?.(bvResumeBtn.dataset.bvResume);
                return;
            }

            // Video Factory Control Panel delegated actions
            const facStage = e.target.closest('.ov3-fac-stage[data-fac-focus]');
            if (facStage) {
                e.preventDefault();
                selectWorkshopStation(facStage.dataset.facFocus, { showInspector: true });
                return;
            }

            const facToggleLine = e.target.closest('[data-fac-toggle-line]');
            if (facToggleLine) {
                e.preventDefault();
                toggleFactoryLine(facToggleLine.dataset.facToggleLine);
                return;
            }

            const facRunLine = e.target.closest('[data-fac-run-line]');
            if (facRunLine) {
                e.preventDefault();
                runFactoryLine(facRunLine.dataset.facRunLine);
                return;
            }

            const facPreviewJob = e.target.closest('[data-fac-preview-job]');
            if (facPreviewJob) {
                e.preventDefault();
                openFactoryJobPreview(facPreviewJob.dataset.facPreviewJob);
                return;
            }

            const facApproveQc = e.target.closest('[data-fac-approve-qc]');
            if (facApproveQc) {
                e.preventDefault();
                approveFactoryQC(facApproveQc.dataset.facApproveQc);
                return;
            }

            // 3D Workshop HUD controls (Camera bar, Dock, Inspector)
            const wsCamBtn = e.target.closest('[data-ws-cam]');
            if (wsCamBtn) {
                e.preventDefault();
                const camId = wsCamBtn.dataset.wsCam || 'overview';
                selectWorkshopStation(camId, { showInspector: camId !== 'overview' });
                return;
            }

            const wsDockBtn = e.target.closest('[data-ws-station]');
            if (wsDockBtn) {
                e.preventDefault();
                selectWorkshopStation(wsDockBtn.dataset.wsStation, { showInspector: true });
                return;
            }

            const wsInspClose = e.target.closest('[data-ws-insp-close]');
            if (wsInspClose) {
                e.preventDefault();
                renderWorkshopInspector(null);
                return;
            }

            const wsActionBtn = e.target.closest('[data-ws-action]');
            if (wsActionBtn) {
                e.preventDefault();
                const act = wsActionBtn.dataset.wsAction;
                if (act === 'quick-order') {
                    const form = $('ov3-fac-quick-form');
                    const toggleBtn = $('ov3-fac-quick-toggle');
                    if (form) form.hidden = false;
                    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
                    jumpToPanel('#ov3-panel-factory');
                    setTimeout(() => $('ov3-fac-topic')?.focus(), 180);
                } else if (act === 'pump') {
                    pumpFactoryQueue();
                } else if (act === 'jump-qc') {
                    jumpToPanel('#ov3-panel-factory');
                }
                return;
            }
        });

        root.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                const thumb = e.target.closest('.ov2-video-thumb[data-play-video]');
                if (thumb) {
                    e.preventDefault();
                    openVideoPlayer(thumb.dataset.playVideo);
                    return;
                }
                const facStage = e.target.closest('.ov3-fac-stage[data-fac-focus]');
                if (facStage) {
                    e.preventDefault();
                    selectWorkshopStation(facStage.dataset.facFocus, { showInspector: true });
                }
            }
        });

        $('ov2-btn-refresh')?.addEventListener('click', () => {
            tick(true);
            fetchQuotaData(true);
            fetchFactoryState(true);
        });
        $('ov3-quota-refresh')?.addEventListener('click', () => fetchQuotaData(true));
        $('ov3-quota-tabs')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-quota-tab]');
            if (!btn) return;
            ui.quotaTab = btn.dataset.quotaTab || 'all';
            if (ui.quota) renderQuotaPanel(ui.quota);
        });
        $('ov3-quota-toggle-models')?.addEventListener('click', () => {
            ui.quotaModelsOpen = !ui.quotaModelsOpen;
            if (ui.quota) renderQuotaModelsTable(ui.quota);
        });
        $('ov3-fac-quick-toggle')?.addEventListener('click', () => {
            const form = $('ov3-fac-quick-form');
            const btn = $('ov3-fac-quick-toggle');
            if (!form) return;
            const willOpen = form.hidden;
            form.hidden = !willOpen;
            if (btn) btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            if (willOpen) $('ov3-fac-topic')?.focus();
        });
        $('ov3-fac-quick-form')?.addEventListener('submit', submitQuickFactoryOrder);
        $('ov3-fac-run-news')?.addEventListener('click', () => runFactoryLine('line-news-v2'));
        $('ov3-fac-pump')?.addEventListener('click', pumpFactoryQueue);
        $('ov3-ws-demo-btn')?.addEventListener('click', () => {
            ui.wsDemoMode = !ui.wsDemoMode;
            ui.wsUserDemoOverride = ui.wsDemoMode;
            syncWorkshop3D();
        });
        $('ov3-po-demo-btn')?.addEventListener('click', () => {
            ui.poDemoMode = !ui.poDemoMode;
            ui.poUserDemoOverride = ui.poDemoMode;
            syncPixelOffice();
        });
        $('ov3-workshop-3d')?.addEventListener('click', (e) => {
            const viewTab = e.target.closest('.ov3-ws3d__view-tab[data-ws-view]');
            if (viewTab) {
                e.preventDefault();
                setWorkshopView(viewTab.dataset.wsView);
                return;
            }
            const deptBtn = e.target.closest('#ov3-po-dept-bar [data-po-dept]');
            if (deptBtn) {
                e.preventDefault();
                ui.poSelectedDept = deptBtn.dataset.poDept || 'all';
                updatePixelDeptHighlight();
                if (ui.poCtrl && typeof ui.poCtrl.focusDept === 'function') {
                    ui.poCtrl.focusDept(ui.poSelectedDept);
                }
            }
        });
        $('ov3-ws-reset-btn')?.addEventListener('click', () => {
            ui.wsSelectedStation = 'overview';
            ui.wsCtrl?.resetCamera?.();
            updateWorkshopCamAndDockHighlight();
            renderWorkshopInspector(null);
        });
        $('ov2-btn-new-chat')?.addEventListener('click', createAndOpenNewChat);
        $('ov2-ai-mark-all')?.addEventListener('click', markAllChatsRead);
        $('ov2-vid-mark-all')?.addEventListener('click', () => setVideoSeen({ all: true }));
        $('ov2-btn-goto-services')?.addEventListener('click', () => {
            if (typeof window.switchView === 'function') window.switchView('services');
        });
        $('ov2-btn-goto-energy')?.addEventListener('click', () => {
            if (typeof window.switchView === 'function') window.switchView('energy');
        });
        $('ov2-vd-close')?.addEventListener('click', closeVideoPlayer);
        $('ov2-video-dialog')?.addEventListener('click', (e) => {
            if (e.target === $('ov2-video-dialog')) closeVideoPlayer();
        });
        $('ov2-video-dialog')?.addEventListener('cancel', closeVideoPlayer);
    }

    // ── Prayer Times Widget (Offline Astronomical + Aladhan API) ────────────
    function initPrayerWidget() {
        const card = $('ov-prayer-card');
        if (!card) return;

        const CITIES = [
            { name: 'Bangkok', lat: 13.7563, lon: 100.5018 },
            { name: 'Nonthaburi', lat: 13.8621, lon: 100.5144 },
            { name: 'Pathum Thani', lat: 14.0208, lon: 100.5250 },
            { name: 'Chonburi', lat: 13.3611, lon: 100.9847 },
            { name: 'Chiang Mai', lat: 18.7883, lon: 98.9853 },
            { name: 'Phuket', lat: 7.8804, lon: 98.3923 },
            { name: 'Hat Yai', lat: 7.0086, lon: 100.4747 },
            { name: 'Pattani', lat: 6.8695, lon: 101.2505 },
            { name: 'Yala', lat: 6.5411, lon: 101.2804 },
            { name: 'Narathiwat', lat: 6.4255, lon: 101.8253 },
            { name: 'Nakhon Si Thammarat', lat: 8.4304, lon: 99.9631 },
            { name: 'Krabi', lat: 8.0863, lon: 98.9063 },
            { name: 'Satun', lat: 6.6238, lon: 100.0674 },
        ];
        const METHOD_LABELS = {
            0: 'Jafari', 1: 'Karachi', 2: 'ISNA', 3: 'MWL', 4: 'Makkah',
            5: 'Egypt', 11: 'MUIS', 13: 'Diyanet', 15: 'Moonsighting',
            17: 'JAKIM', 20: 'KEMENAG', 99: 'Custom',
        };
        const METHOD_ANGLES = {
            0: [16, 14], 1: [18, 18], 2: [15, 15], 3: [18, 17], 4: [18.5, 17],
            5: [19.5, 17.5], 11: [20, 18], 13: [18, 17], 15: [18, 18],
            17: [20, 18], 20: [20, 18],
        };
        const PRAYERS = [
            { key: 'Fajr', th: 'ซุบฮิ', en: 'Fajr' },
            { key: 'Dhuhr', th: 'ซุฮ์ริ', en: 'Dhuhr' },
            { key: 'Asr', th: 'อัศริ', en: 'Asr' },
            { key: 'Maghrib', th: 'มัฆริบ', en: 'Maghrib' },
            { key: 'Isha', th: 'อิชาอ์', en: 'Isha' },
        ];

        const cityBtn = $('ov-prayer-city-btn');
        const hijriEl = $('ov-prayer-hijri');
        const nextNameEl = $('ov-prayer-next-name');
        const nextTimeEl = $('ov-prayer-next-time');
        const countdownEl = $('ov-prayer-countdown');
        const progEl = $('ov-prayer-prog');
        const metaStrip = $('ov-prayer-meta-strip');
        const sunriseInfoEl = $('ov-prayer-sunrise-info');
        const methodBadgeEl = $('ov-prayer-method-badge');
        const gearBtn = $('ov-prayer-gear-btn');

        let currentTimings = null;
        let currentSunrise = '--:--';

        function getSettings() {
            const defaults = {
                city: localStorage.getItem('ov_prayer_city') || 'Bangkok',
                lat: 13.7563, lon: 100.5018, tz: 7, method: 3,
                fajrAngle: 18, ishaAngle: 17, school: 0, highLat: 3, midnightMode: 0,
                hijriAdj: 0, tune: { Fajr: 0, Dhuhr: 0, Asr: 0, Maghrib: 0, Isha: 0 },
                showSunrise: false, timeFormat: '24h',
            };
            try {
                const raw = localStorage.getItem('ov_prayer_settings_v1');
                if (!raw) {
                    const c = CITIES.find((x) => x.name === defaults.city) || CITIES[0];
                    defaults.lat = c.lat;
                    defaults.lon = c.lon;
                    return defaults;
                }
                const parsed = JSON.parse(raw);
                return { ...defaults, ...parsed, tune: { ...defaults.tune, ...(parsed.tune || {}) } };
            } catch (_) {
                return defaults;
            }
        }

        function formatDisplayTime(hhmm, fmt) {
            if (!hhmm || !hhmm.includes(':')) return hhmm || '--:--';
            if (fmt !== '12h') return hhmm;
            const [hStr, mStr] = hhmm.split(':');
            const h = parseInt(hStr, 10);
            if (Number.isNaN(h)) return hhmm;
            return `${h % 12 || 12}:${mStr} ${h >= 12 ? 'PM' : 'AM'}`;
        }

        function computeOfflineTimings(date, cfg) {
            const lat = Number(cfg.lat) || 13.7563;
            const lon = Number(cfg.lon) || 100.5018;
            const tz = Number(cfg.tz) || 7;
            const rad = Math.PI / 180;
            const start = new Date(date.getFullYear(), 0, 0);
            const dayOfYear = Math.floor((date - start) / 86400000);
            const gamma = (2 * Math.PI / 365) * (dayOfYear - 1);
            const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
            const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma);
            const solarNoonMin = 720 - 4 * lon - eqTime + tz * 60;

            const hourAngle = (angleDeg) => {
                const cosH = (Math.sin(angleDeg * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
                return Math.acos(Math.max(-1, Math.min(1, cosH))) / rad * 4;
            };
            const shadowFactor = Number(cfg.school) === 1 ? 2 : 1;
            const asrAngle = Math.atan(1 / (shadowFactor + Math.tan(Math.abs(lat * rad - decl)))) / rad;
            const [defFajr, defIsha] = METHOD_ANGLES[cfg.method] || [18, 17];
            const fajrAng = Number(cfg.method) === 99 ? (Number(cfg.fajrAngle) || 18) : defFajr;
            const ishaAng = Number(cfg.method) === 99 ? (Number(cfg.ishaAngle) || 17) : defIsha;
            const tune = cfg.tune || {};
            const fmtMin = (m) => {
                const tot = ((Math.round(m) % 1440) + 1440) % 1440;
                return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
            };
            const maghribMin = solarNoonMin + hourAngle(-0.833);
            const ishaMin = Number(cfg.method) === 4 ? (maghribMin + 90) : (solarNoonMin + hourAngle(-ishaAng));
            return {
                Sunrise: fmtMin(solarNoonMin - hourAngle(-0.833)),
                Fajr: fmtMin(solarNoonMin - hourAngle(-fajrAng) + (Number(tune.Fajr) || 0)),
                Dhuhr: fmtMin(solarNoonMin + 2 + (Number(tune.Dhuhr) || 0)),
                Asr: fmtMin(solarNoonMin + hourAngle(asrAngle) + (Number(tune.Asr) || 0)),
                Maghrib: fmtMin(maghribMin + (Number(tune.Maghrib) || 0)),
                Isha: fmtMin(ishaMin + (Number(tune.Isha) || 0)),
            };
        }

        function formatHijriFallback(date, hijriAdj) {
            const d = new Date(date.getTime() + (Number(hijriAdj) || 0) * 86400000);
            try {
                return new Intl.DateTimeFormat('th-TH-u-ca-islamic', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
            } catch (_) {
                return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
            }
        }

        function toSeconds(hhmm) {
            const [h, m] = String(hhmm || '00:00').split(':').map(Number);
            return (h || 0) * 3600 + (m || 0) * 60;
        }

        function updateCountdown() {
            if (!currentTimings) return;
            const cfg = getSettings();
            const now = new Date();
            const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

            let nextIdx = PRAYERS.findIndex((p) => toSeconds(currentTimings[p.key]) > nowSec);
            const isTomorrow = nextIdx === -1;
            if (isTomorrow) nextIdx = 0;

            const nextP = PRAYERS[nextIdx];
            const prevP = PRAYERS[(nextIdx + PRAYERS.length - 1) % PRAYERS.length];
            let nextSec = toSeconds(currentTimings[nextP.key]);
            let prevSec = toSeconds(currentTimings[prevP.key]);
            if (isTomorrow) nextSec += 86400;
            if (prevSec > nextSec) prevSec -= 86400;
            const curForProg = (isTomorrow && nowSec < prevSec) ? nowSec + 86400 : nowSec;

            const diff = Math.max(0, nextSec - nowSec);
            const hh = String(Math.floor(diff / 3600)).padStart(2, '0');
            const mm = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
            const ss = String(diff % 60).padStart(2, '0');

            if (nextNameEl) nextNameEl.textContent = `${nextP.th} (${nextP.en})`;
            if (nextTimeEl) nextTimeEl.textContent = formatDisplayTime(currentTimings[nextP.key], cfg.timeFormat);
            if (countdownEl) countdownEl.textContent = `อีก ${hh}:${mm}:${ss}`;
            if (sunriseInfoEl) sunriseInfoEl.textContent = `ชูรูก ${formatDisplayTime(currentSunrise, cfg.timeFormat)}`;
            if (progEl) {
                const span = Math.max(1, nextSec - prevSec);
                const pct = Math.max(0, Math.min(100, ((curForProg - prevSec) / span) * 100));
                progEl.style.width = `${pct.toFixed(1)}%`;
            }

            PRAYERS.forEach((p, idx) => {
                const pill = card.querySelector(`.ov2-prayer-pill[data-prayer="${p.key}"]`);
                if (!pill) return;
                const strong = pill.querySelector('strong');
                if (strong) strong.textContent = formatDisplayTime(currentTimings[p.key], cfg.timeFormat);
                pill.classList.toggle('is-next', idx === nextIdx);
                pill.classList.toggle('is-passed', !isTomorrow && idx < nextIdx);
            });
        }

        async function loadPrayerTimes(forceRefresh = false) {
            const cfg = getSettings();
            const cityLabel = cfg.city === 'custom'
                ? `${Number(cfg.lat).toFixed(2)}, ${Number(cfg.lon).toFixed(2)}`
                : cfg.city;
            if (cityBtn) cityBtn.textContent = cityLabel;
            if (metaStrip) metaStrip.style.display = cfg.showSunrise ? 'flex' : 'none';
            if (methodBadgeEl) {
                methodBadgeEl.textContent = `${METHOD_LABELS[cfg.method] || 'MWL'} · ${Number(cfg.school) === 1 ? 'Hanafi' : 'Shafi'}`;
            }

            const now = new Date();
            const dd = String(now.getDate()).padStart(2, '0');
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const yyyy = now.getFullYear();
            const dateKey = `${yyyy}-${mm}-${dd}`;
            const t = cfg.tune || {};
            const tuneStr = `0,${Number(t.Fajr) || 0},0,${Number(t.Dhuhr) || 0},${Number(t.Asr) || 0},${Number(t.Maghrib) || 0},0,${Number(t.Isha) || 0},0`;
            const cfgHash = `${Number(cfg.lat).toFixed(3)}_${Number(cfg.lon).toFixed(3)}_m${cfg.method}_s${cfg.school}_h${cfg.highLat}_mn${cfg.midnightMode}_ha${cfg.hijriAdj}_fa${cfg.fajrAngle}_ia${cfg.ishaAngle}_t${tuneStr}`;
            const cacheKey = `ov_prayer_cache_v2_${dateKey}_${cfgHash}`;

            if (!forceRefresh) {
                try {
                    const cached = localStorage.getItem(cacheKey);
                    if (cached) {
                        const parsed = JSON.parse(cached);
                        currentTimings = parsed.timings;
                        currentSunrise = parsed.sunrise || '--:--';
                        if (hijriEl) hijriEl.textContent = parsed.hijri || formatHijriFallback(now, cfg.hijriAdj);
                        updateCountdown();
                        return;
                    }
                } catch (_) {}
            }

            const offline = computeOfflineTimings(now, cfg);
            currentTimings = offline;
            currentSunrise = offline.Sunrise || '--:--';
            if (hijriEl) hijriEl.textContent = formatHijriFallback(now, cfg.hijriAdj);
            updateCountdown();

            try {
                let url = `https://api.aladhan.com/v1/timings/${dd}-${mm}-${yyyy}?latitude=${encodeURIComponent(cfg.lat)}&longitude=${encodeURIComponent(cfg.lon)}&method=${encodeURIComponent(cfg.method)}&school=${encodeURIComponent(cfg.school)}&tune=${encodeURIComponent(tuneStr)}&latitudeAdjustmentMethod=${encodeURIComponent(cfg.highLat)}&midnightMode=${encodeURIComponent(cfg.midnightMode)}`;
                if (Number(cfg.method) === 99) url += `&methodSettings=${encodeURIComponent(`${cfg.fajrAngle},null,${cfg.ishaAngle}`)}`;
                if (Number(cfg.hijriAdj)) url += `&adjustment=${encodeURIComponent(cfg.hijriAdj)}`;
                const res = await fetch(url);
                if (!res.ok) return;
                const json = await res.json();
                const data = json && json.data;
                if (data && data.timings) {
                    const clean = {};
                    PRAYERS.forEach((p) => { clean[p.key] = String(data.timings[p.key] || '').slice(0, 5); });
                    const sunrise = String(data.timings.Sunrise || offline.Sunrise || '--:--').slice(0, 5);
                    const hijri = data.date && data.date.hijri
                        ? `${data.date.hijri.day} ${(data.date.hijri.month && data.date.hijri.month.en) || ''} ${data.date.hijri.year} AH`
                        : formatHijriFallback(now, cfg.hijriAdj);
                    currentTimings = clean;
                    currentSunrise = sunrise;
                    if (hijriEl) hijriEl.textContent = hijri;
                    try { localStorage.setItem(cacheKey, JSON.stringify({ timings: clean, sunrise, hijri })); } catch (_) {}
                    updateCountdown();
                }
            } catch (_) {}
        }

        cityBtn?.addEventListener('click', () => {
            const cfg = getSettings();
            const curIdx = Math.max(-1, CITIES.findIndex((c) => c.name === cfg.city));
            const nextCity = CITIES[(curIdx + 1) % CITIES.length];
            cfg.city = nextCity.name;
            cfg.lat = nextCity.lat;
            cfg.lon = nextCity.lon;
            try {
                localStorage.setItem('ov_prayer_city', nextCity.name);
                localStorage.setItem('ov_prayer_settings_v1', JSON.stringify(cfg));
            } catch (_) {}
            window.dispatchEvent(new CustomEvent('prayer-settings-updated'));
        });

        gearBtn?.addEventListener('click', () => {
            if (typeof window.switchView === 'function') {
                window.switchView('settings');
                setTimeout(() => {
                    $('card-prayer-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 120);
            }
        });

        window.addEventListener('prayer-settings-updated', () => loadPrayerTimes(true));
        loadPrayerTimes();
        setInterval(updateCountdown, 1000);
    }

    // ── Rueso, Narathiwat Weather Widget (Open-Meteo via /api/weather + fallback) ──
    function initWeatherWidget() {
        const card = $('ov-weather-card');
        if (!card) return;

        const WEATHER_POLL_MS = 15 * 60 * 1000;
        const DIRECT_URL = 'https://api.open-meteo.com/v1/forecast?latitude=6.3917&longitude=101.5186'
            + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,rain,weather_code,wind_speed_10m,is_day'
            + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
            + '&timezone=Asia%2FBangkok&forecast_days=4';

        function mapWmoFallback(code, isDay) {
            const c = Number(code);
            if (c === 0) return { conditionTh: isDay ? 'ท้องฟ้าแจ่มใส' : 'ท้องฟ้าโปร่ง', emoji: isDay ? '☀️' : '🌙' };
            if (c === 1) return { conditionTh: 'เมฆบางส่วนเล็กน้อย', emoji: isDay ? '🌤️' : '🌙' };
            if (c === 2) return { conditionTh: 'มีเมฆบางส่วน', emoji: isDay ? '⛅' : '☁️' };
            if (c === 3) return { conditionTh: 'มีเมฆมาก', emoji: '☁️' };
            if (c === 45 || c === 48) return { conditionTh: 'มีหมอก', emoji: '🌫️' };
            if (c >= 51 && c <= 67) return { conditionTh: 'ฝนตก', emoji: '🌧️' };
            if (c >= 80 && c <= 82) return { conditionTh: 'ฝนซู่', emoji: '🌦️' };
            if (c >= 95) return { conditionTh: 'พายุฝนฟ้าคะนอง', emoji: '⛈️' };
            return { conditionTh: 'สภาพอากาศทั่วไป', emoji: isDay ? '🌤️' : '🌙' };
        }

        function formatDayLabel(isoDate, idx) {
            if (idx === 0) return 'วันนี้';
            if (idx === 1) return 'พรุ่งนี้';
            try {
                const d = new Date(`${isoDate}T00:00:00+07:00`);
                return d.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric' });
            } catch (_) {
                return String(isoDate || '').slice(5);
            }
        }

        function renderWeather(data) {
            const body = $('ov-weather-body');
            const sub = $('ov-weather-sub');
            if (!body) return;
            body.textContent = '';

            if (!data || !data.current) {
                const errEl = document.createElement('div');
                errEl.className = 'ov3-empty';
                errEl.textContent = 'ไม่สามารถโหลดข้อมูลอากาศ อ.รือเสาะ ได้ในขณะนี้';
                body.appendChild(errEl);
                return;
            }

            if (sub) {
                const loc = (data.location && data.location.name) || 'อ.รือเสาะ จ.นราธิวาส';
                sub.textContent = `${loc}${data.stale ? ' (แคช)' : ''}`;
            }

            const cur = data.current;
            const wrap = document.createElement('div');
            wrap.className = 'ov3-weather-grid';

            const left = document.createElement('div');
            left.className = 'ov3-weather-cur';

            const hero = document.createElement('div');
            hero.className = 'ov3-weather-hero';

            const ico = document.createElement('span');
            ico.className = 'ov3-weather-ico';
            ico.setAttribute('aria-hidden', 'true');
            ico.textContent = cur.emoji || '🌤️';

            const tempWrap = document.createElement('div');
            tempWrap.className = 'ov3-weather-temp-wrap';

            const temp = document.createElement('div');
            temp.className = 'ov3-weather-temp ov2-num';
            temp.textContent = cur.tempC != null ? `${Math.round(cur.tempC)}°C` : '—°C';

            const cond = document.createElement('div');
            cond.className = 'ov3-weather-cond';
            cond.textContent = cur.conditionTh || 'สภาพอากาศทั่วไป';

            tempWrap.appendChild(temp);
            tempWrap.appendChild(cond);
            hero.appendChild(ico);
            hero.appendChild(tempWrap);

            const stats = document.createElement('div');
            stats.className = 'ov3-weather-stats';
            const addStat = (lbl, val) => {
                const s = document.createElement('span');
                s.className = 'ov3-weather-stat';
                s.textContent = `${lbl} ${val}`;
                stats.appendChild(s);
            };
            addStat('รู้สึก', cur.feelsLikeC != null ? `${Math.round(cur.feelsLikeC)}°C` : '—');
            addStat('ความชื้น', cur.humidityPct != null ? `${Math.round(cur.humidityPct)}%` : '—');
            addStat('ลม', cur.windKmh != null ? `${Math.round(cur.windKmh)} กม./ชม.` : '—');
            if (cur.rainMm != null && Number(cur.rainMm) > 0) {
                addStat('ฝน', `${Number(cur.rainMm).toFixed(1)} มม.`);
            }

            left.appendChild(hero);
            left.appendChild(stats);

            const right = document.createElement('div');
            right.className = 'ov3-weather-daily';
            const daily = Array.isArray(data.daily) ? data.daily.slice(0, 4) : [];
            daily.forEach((d, idx) => {
                const cell = document.createElement('div');
                cell.className = 'ov3-weather-day' + (idx === 0 ? ' is-today' : '');

                const dLbl = document.createElement('span');
                dLbl.className = 'ov3-weather-day__lbl';
                dLbl.textContent = formatDayLabel(d.date, idx);

                const dIco = document.createElement('span');
                dIco.className = 'ov3-weather-day__ico';
                dIco.textContent = d.emoji || '🌤️';

                const dTmp = document.createElement('strong');
                dTmp.className = 'ov3-weather-day__tmp ov2-num';
                dTmp.textContent = `${d.tempMinC != null ? Math.round(d.tempMinC) : '—'}° / ${d.tempMaxC != null ? Math.round(d.tempMaxC) : '—'}°`;

                const dRain = document.createElement('small');
                dRain.className = 'ov3-weather-day__rain';
                dRain.textContent = `💧 ${d.precipProbPct != null ? Math.round(d.precipProbPct) : 0}%`;

                cell.appendChild(dLbl);
                cell.appendChild(dIco);
                cell.appendChild(dTmp);
                cell.appendChild(dRain);
                right.appendChild(cell);
            });

            wrap.appendChild(left);
            wrap.appendChild(right);
            body.appendChild(wrap);
        }

        async function loadWeather(force = false) {
            try {
                const r = await fetch(`/api/weather${force ? '?force=1' : ''}`, { cache: 'no-store' });
                if (r.ok) {
                    const data = await r.json();
                    if (data && data.current) {
                        window.__labWeatherCache = data;
                        renderWeather(data);
                        return;
                    }
                }
            } catch (_) {}

            // Direct Open-Meteo fallback if server hasn't restarted yet
            try {
                const r2 = await fetch(DIRECT_URL);
                if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
                const raw = await r2.json();
                const cur = (raw && raw.current) || {};
                const isDay = cur.is_day !== 0;
                const meta = mapWmoFallback(cur.weather_code, isDay);
                const dRaw = (raw && raw.daily) || {};
                const dates = Array.isArray(dRaw.time) ? dRaw.time : [];
                const daily = dates.map((date, idx) => {
                    const code = Array.isArray(dRaw.weather_code) ? dRaw.weather_code[idx] : 0;
                    const dm = mapWmoFallback(code, true);
                    return {
                        date,
                        tempMaxC: Array.isArray(dRaw.temperature_2m_max) ? Number(dRaw.temperature_2m_max[idx]) : null,
                        tempMinC: Array.isArray(dRaw.temperature_2m_min) ? Number(dRaw.temperature_2m_min[idx]) : null,
                        precipProbPct: Array.isArray(dRaw.precipitation_probability_max) ? Number(dRaw.precipitation_probability_max[idx]) : null,
                        weatherCode: Number(code) || 0,
                        conditionTh: dm.conditionTh,
                        emoji: dm.emoji,
                    };
                });
                const fallbackData = {
                    ok: true,
                    location: { name: 'อ.รือเสาะ จ.นราธิวาส', lat: 6.3917, lon: 101.5186, timezone: 'Asia/Bangkok' },
                    fetchedAt: new Date().toISOString(),
                    cached: false,
                    stale: false,
                    current: {
                        tempC: cur.temperature_2m != null ? Number(cur.temperature_2m) : null,
                        feelsLikeC: cur.apparent_temperature != null ? Number(cur.apparent_temperature) : null,
                        humidityPct: cur.relative_humidity_2m != null ? Number(cur.relative_humidity_2m) : null,
                        windKmh: cur.wind_speed_10m != null ? Number(cur.wind_speed_10m) : null,
                        rainMm: cur.rain != null ? Number(cur.rain) : 0,
                        weatherCode: Number(cur.weather_code) || 0,
                        isDay,
                        conditionTh: meta.conditionTh,
                        emoji: meta.emoji,
                    },
                    daily,
                };
                window.__labWeatherCache = fallbackData;
                renderWeather(fallbackData);
            } catch (_) {
                renderWeather(window.__labWeatherCache || null);
            }
        }

        $('ov-weather-refresh')?.addEventListener('click', () => loadWeather(true));
        loadWeather(false);
        setInterval(() => {
            if (!document.hidden) loadWeather(false);
        }, WEATHER_POLL_MS);
    }

    // ── Boot ────────────────────────────────────────────────────────────────
    function init() {
        if (!$('ov2-root')) return;
        loadHist();
        renderInitialSkeletons();
        renderHeader(null);
        if (!ui.freshTimer) {
            ui.freshTimer = setInterval(updateFreshness, 1000);
        }
        bindEvents();
        initOfficeThemeObserver();
        setWorkshopView(ui.wsView);
        initPrayerWidget();
        initWeatherWidget();
        tick(true);
        fetchQuotaData(true);
        fetchFactoryState(true);
        fetchCronForOffice(true);
        setInterval(() => tick(false), POLL_MS);
        setInterval(() => fetchFactoryState(false), FACTORY_POLL_MS);
        setInterval(() => fetchQuotaData(false), QUOTA_POLL_MS);
        setInterval(() => fetchCronForOffice(false), 30000);

        window.addEventListener('homelab:bv-alerts-updated', () => {
            if (ui.lastData) {
                renderHeader(ui.lastData);
                renderKpis(ui.lastData);
                renderAttention(ui.lastData);
            } else {
                renderAttention({});
            }
        });

        document.addEventListener('visibilitychange', () => {
            syncWorkshopActive();
            if (!document.hidden && isOverviewActive()) {
                tick(false);
                if (Date.now() - ui.factoryUpdatedAt > FACTORY_POLL_MS) fetchFactoryState(false);
                if (Date.now() - ui.quotaUpdatedAt > QUOTA_POLL_MS) fetchQuotaData(false);
            }
        });

        const view = $('view-overview');
        if (view && typeof MutationObserver !== 'undefined') {
            const obs = new MutationObserver(() => {
                syncWorkshopActive();
                if (isOverviewActive() && !document.hidden) {
                    tick(false);
                    if (Date.now() - ui.factoryUpdatedAt > FACTORY_POLL_MS) fetchFactoryState(false);
                    if (Date.now() - ui.quotaUpdatedAt > QUOTA_POLL_MS) fetchQuotaData(false);
                }
            });
            obs.observe(view, { attributes: true, attributeFilter: ['class'] });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
