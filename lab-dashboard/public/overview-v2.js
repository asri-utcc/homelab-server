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
    function openVideoPlayer(videoKey) {
        const recent = (ui.lastData && ui.lastData.videos && ui.lastData.videos.recent) || [];
        const v = recent.find((item) => item.key === videoKey);
        if (!v) return;

        const dlg = $('ov2-video-dialog');
        const vidEl = $('ov2-vd-player');
        const titleEl = $('ov2-vd-title');
        const metaEl = $('ov2-vd-meta');
        const dlBtn = $('ov2-vd-download');
        const edBtn = $('ov2-vd-editor');
        if (!dlg || !vidEl) {
            if (v.watchUrl) window.open(v.watchUrl, '_blank', 'noopener');
            if (!v.seen) setVideoSeen({ id: v.key, seen: true });
            return;
        }

        titleEl.textContent = v.title || v.key;
        const parts = [];
        if (v.durationSec) parts.push(`ยาว ${fmtDuration(v.durationSec)}`);
        if (v.sizeBytes) parts.push(fmtMb(v.sizeBytes));
        if (v.costThb != null) parts.push(`ค่าใช้จ่าย ${fmtThb(v.costThb)}`);
        if (v.renderNode) parts.push(`เรนเดอร์บน ${v.renderNode}`);
        metaEl.textContent = parts.join('  /  ') || v.key;

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

        if (!v.seen) {
            setVideoSeen({ id: v.key, seen: true });
        }
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

    function renderHeader(data) {
        updateFreshness();
        if (!data) return;

        const att = data.attention || {};
        const pillEl = $('ov3-status-pill');
        const dotEl = $('ov2-status-dot');
        const sumEl = $('ov2-status-summary');

        const parts = [];
        if (att.servicesDown > 0) parts.push(`บริการมีปัญหา ${att.servicesDown}`);
        if (att.aiRunning > 0) parts.push(`AI กำลังทำ ${att.aiRunning} แชท`);
        if (att.aiUnread > 0) parts.push(`ยังไม่อ่าน ${att.aiUnread}`);
        if (att.videosUnseen > 0) parts.push(`วิดีโอยังไม่ดู ${att.videosUnseen}`);
        if (att.rendersActive > 0) parts.push(`กำลังเรนเดอร์ ${att.rendersActive}`);

        const tone = att.servicesDown > 0 ? 'err' : (parts.length > 0 ? 'warn' : 'ok');

        if (pillEl) pillEl.setAttribute('data-tone', tone);
        if (dotEl) {
            dotEl.className = 'ov2-status-dot' + (tone === 'err' ? ' is-err' : (tone === 'warn' ? ' is-warn' : ''));
        }
        if (sumEl) {
            sumEl.textContent = parts.length ? parts.join(' · ') : 'ทุกระบบปกติ ไม่มีงานค้างที่ต้องดู';
        }
    }

    function attnIcon(kind) {
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
            <div class="ov3-attn__row" data-kind="${esc(item.kind)}">
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

    // ── AI Quota (All Accounts + Providers) ─────────────────────────────────
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
        if (diff <= 0) return 'พร้อมรีเซ็ต';
        const days = Math.floor(diff / 86400000);
        const hrs = Math.floor((diff % 86400000) / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        if (days > 0) return `${days} วัน ${hrs} ชม.`;
        if (hrs > 0) return `${hrs} ชม. ${String(mins).padStart(2, '0')} น.`;
        if (mins > 0) return `${mins} น. ${String(secs).padStart(2, '0')} วิ`;
        return `${secs} วิ`;
    }

    function shortPoolName(p) {
        if (!p) return 'Pool';
        if (p.id === 'gemini') return 'Gemini (Hydrogen / Flash / Pro)';
        if (p.id === 'claude') return 'Claude & GPT';
        return p.name || p.id || 'Pool';
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

    function renderGoogleQuotaCard(acct) {
        const d = acct && acct.data;
        const label = (acct && acct.label) || 'Google';
        const email = (d && d.email) || (acct && acct.email) || '';

        if (!d || !d.ok) {
            return `
                <article class="ov3-qcard">
                    <div class="ov3-qcard__head">
                        <div class="ov3-qcard__title-wrap">
                            <div class="ov3-qcard__name">${esc(label)}</div>
                            ${email ? `<div class="ov3-qcard__sub">${esc(email)}</div>` : ''}
                        </div>
                        <span class="ov3-badge" data-tone="neutral">ข้ามอัตโนมัติ</span>
                    </div>
                    <div class="ov3-qcredit__sub">ไม่สามารถดึงโควตาได้ (${esc((d && d.error) || 'ไม่มีข้อมูล')}) · ระบบ Auto Router ข้ามให้อัตโนมัติ</div>
                </article>
            `;
        }

        const pools = Array.isArray(d.pools) ? d.pools : [];
        const hasAvail = pools.some((p) => Number(p.remainingPct) > 5);
        const hasExhausted = pools.some((p) => Number(p.remainingPct) <= 0);
        const allLow = !hasAvail && pools.length > 0;
        const badgeTone = allLow ? 'err' : (hasExhausted ? 'warn' : (hasAvail ? 'ok' : 'neutral'));
        const badgeText = allLow ? 'หมดทุกพูล' : (hasExhausted ? 'หมดบางพูล' : (hasAvail ? 'พร้อมใช้' : 'ไม่มีพูล'));

        const poolsHtml = pools.map((p) => {
            const rem = Math.round(clampPct(p.remainingPct));
            const tone = quotaTone(rem);
            const fh = p.fiveHour;
            const wk = p.weekly;
            let metaHtml = '';

            if (fh && wk) {
                const fhRem = Math.round(clampPct(fh.remainingPct));
                const wkRem = Math.round(clampPct(wk.remainingPct));
                const fhTone = quotaTone(fhRem);
                const wkTone = quotaTone(wkRem);
                const fhSpan = fh.resetTime
                    ? `<span class="ov3-qpool__win" data-tone="${fhTone === 'ok' ? '' : fhTone}">5 ชม. ${fhRem}% (<span data-quota-reset="${esc(fh.resetTime)}">${esc(fmtQuotaCountdown(fh.resetTime))}</span>)</span>`
                    : `<span class="ov3-qpool__win" data-tone="${fhTone === 'ok' ? '' : fhTone}">5 ชม. ${fhRem}%</span>`;
                let wkSpan = '';
                if (wkRem <= 0) {
                    const wkReset = wk.resetTime || p.resetTime || '';
                    wkSpan = `<span class="ov3-qpool__win" data-tone="err">สัปดาห์หมด 0%${wkReset ? ` · รีเซ็ตใน <span data-quota-reset="${esc(wkReset)}">${esc(fmtQuotaCountdown(wkReset))}</span>` : ''}</span>`;
                } else {
                    wkSpan = wk.resetTime
                        ? `<span class="ov3-qpool__win" data-tone="${wkTone === 'ok' ? '' : wkTone}">7 วัน ${wkRem}% (<span data-quota-reset="${esc(wk.resetTime)}">${esc(fmtQuotaCountdown(wk.resetTime))}</span>)</span>`
                        : `<span class="ov3-qpool__win" data-tone="${wkTone === 'ok' ? '' : wkTone}">7 วัน ${wkRem}%</span>`;
                }
                metaHtml = `${fhSpan}${wkSpan}`;
            } else {
                const used = Math.round(clampPct(p.usedPct));
                const rst = p.resetTime
                    ? `รีเซ็ตใน <span data-quota-reset="${esc(p.resetTime)}">${esc(fmtQuotaCountdown(p.resetTime))}</span>`
                    : '—';
                metaHtml = `<span>ใช้ไป ${used}% (${esc(p.modelsCount || 0)} โมเดล)</span><span>${rst}</span>`;
            }

            return `
                <div class="ov3-qpool">
                    <div class="ov3-qpool__top">
                        <span class="ov3-qpool__label">${esc(shortPoolName(p))}</span>
                        <span class="ov3-qpool__val" data-tone="${tone}">${rem}%</span>
                    </div>
                    <div class="ov3-bar"><span class="ov3-bar__fill" data-tone="${tone}" style="width:${rem}%"></span></div>
                    <div class="ov3-qpool__meta">${metaHtml}</div>
                </div>
            `;
        }).join('');

        return `
            <article class="ov3-qcard${allLow ? ' is-limit' : ''}">
                <div class="ov3-qcard__head">
                    <div class="ov3-qcard__title-wrap">
                        <div class="ov3-qcard__name">${esc(label)}</div>
                        ${email ? `<div class="ov3-qcard__sub" title="${esc(email)}">${esc(email)}</div>` : ''}
                    </div>
                    <span class="ov3-badge" data-tone="${badgeTone}">${esc(badgeText)}</span>
                </div>
                <div class="ov3-qpools">${poolsHtml || '<div class="ov3-qcredit__sub">ไม่มีข้อมูลพูล</div>'}</div>
            </article>
        `;
    }

    function renderClaudeQuotaCard(cw) {
        if (!cw || !cw.ok) {
            const note = cw && cw.error
                ? `${cw.error} — Auto Router ข้ามให้อัตโนมัติ`
                : 'ไม่ได้ใช้งานหรือเชื่อมต่อไม่ได้ — Auto Router ข้ามให้อัตโนมัติ';
            return `
                <article class="ov3-qcard">
                    <div class="ov3-qcard__head">
                        <div class="ov3-qcard__title-wrap">
                            <div class="ov3-qcard__name">Claude.ai Pro</div>
                            <div class="ov3-qcard__sub">Anthropic Rolling 5h &amp; 7d</div>
                        </div>
                        <span class="ov3-badge" data-tone="neutral">ไม่ได้ใช้</span>
                    </div>
                    <div class="ov3-qcredit__sub">${esc(note)}</div>
                </article>
            `;
        }

        const fh = cw.fiveHour || { remainingPct: 100, usedPct: 0, resetTime: null };
        const wk = cw.weekly || { remainingPct: 100, usedPct: 0, resetTime: null };
        const fhRem = Math.round(clampPct(fh.remainingPct));
        const wkRem = Math.round(clampPct(wk.remainingPct));
        const fhTone = quotaTone(fhRem);
        const wkTone = quotaTone(wkRem);
        const isExhausted = fhRem <= 0 || wkRem <= 0;
        const minRem = Math.min(fhRem, wkRem);
        const badgeTone = wkRem <= 0 ? 'err' : (fhRem <= 0 ? 'warn' : (minRem > 5 ? 'ok' : 'warn'));
        const badgeText = wkRem <= 0 ? 'หมดโควตาสัปดาห์' : (fhRem <= 0 ? 'รอบ 5 ชม. หมด' : (minRem > 5 ? 'พร้อมใช้' : 'ใกล้หมด'));
        const planLabel = cw.plan ? `Claude.ai (${String(cw.plan).toUpperCase()})` : 'Claude.ai Pro';
        const subText = cw.orgName || 'OAuth · Claude Code';

        return `
            <article class="ov3-qcard${isExhausted ? ' is-limit' : ''}">
                <div class="ov3-qcard__head">
                    <div class="ov3-qcard__title-wrap">
                        <div class="ov3-qcard__name">${esc(planLabel)}</div>
                        <div class="ov3-qcard__sub" title="${esc(subText)}">${esc(subText)}</div>
                    </div>
                    <span class="ov3-badge" data-tone="${badgeTone}">${esc(badgeText)}</span>
                </div>
                <div class="ov3-qpools">
                    <div class="ov3-qpool">
                        <div class="ov3-qpool__top">
                            <span class="ov3-qpool__label">รอบ 5 ชั่วโมง (5h Rolling)</span>
                            <span class="ov3-qpool__val" data-tone="${fhTone}">${fhRem}%</span>
                        </div>
                        <div class="ov3-bar"><span class="ov3-bar__fill" data-tone="${fhTone}" style="width:${fhRem}%"></span></div>
                        <div class="ov3-qpool__meta">
                            <span>ใช้ไป ${Math.round(clampPct(fh.usedPct))}%</span>
                            <span>${fh.resetTime ? `รีเซ็ตใน <span data-quota-reset="${esc(fh.resetTime)}">${esc(fmtQuotaCountdown(fh.resetTime))}</span>` : '—'}</span>
                        </div>
                    </div>
                    <div class="ov3-qpool">
                        <div class="ov3-qpool__top">
                            <span class="ov3-qpool__label">รายสัปดาห์ (7 วัน)</span>
                            <span class="ov3-qpool__val" data-tone="${wkTone}">${wkRem}%</span>
                        </div>
                        <div class="ov3-bar"><span class="ov3-bar__fill" data-tone="${wkTone}" style="width:${wkRem}%"></span></div>
                        <div class="ov3-qpool__meta">
                            <span>ใช้ไป ${Math.round(clampPct(wk.usedPct))}%</span>
                            <span>${wk.resetTime ? `รีเซ็ตใน <span data-quota-reset="${esc(wk.resetTime)}">${esc(fmtQuotaCountdown(wk.resetTime))}</span>` : '—'}</span>
                        </div>
                    </div>
                </div>
            </article>
        `;
    }

    function renderCreditsQuotaCard(ds, gc) {
        const dsTotal = ds && ds.ok ? parseFloat(ds.totalBalance || '0') : 0;
        const dsReady = Boolean(ds && ds.ok && ds.isAvailable && dsTotal > 0.1);
        const dsLow = Boolean(ds && ds.ok && ds.isAvailable && dsTotal <= 0.5 && dsTotal > 0.1);
        const dsTone = !ds || !ds.ok ? 'neutral' : (!dsReady ? 'err' : (dsLow ? 'warn' : 'ok'));
        const dsBadge = !ds || !ds.ok ? 'ไม่ได้ตั้งค่า' : (!dsReady ? 'เครดิตหมด' : (dsLow ? 'ใกล้หมด' : 'พร้อมใช้'));
        const dsModels = (ds && ds.ok && Array.isArray(ds.models))
            ? ds.models.map((m) => m.name || m.id).filter(Boolean).join(' · ')
            : '';

        const gcReady = Boolean(gc && gc.ok && !gc.isEmpty && Number(gc.remainingThb) > 0.5);
        const gcLow = Boolean(gc && gc.ok && Number(gc.remainingThb) < Number(gc.lowThb || 10));
        const gcTone = !gc || !gc.ok ? 'neutral' : (Number(gc.remainingThb) <= 0.5 ? 'err' : (gcLow ? 'warn' : 'ok'));
        const gcBadge = !gc || !gc.ok ? 'ไม่ได้ตั้งค่า' : (Number(gc.remainingThb) <= 0.5 ? 'เครดิตหมด' : (gcLow ? 'ใกล้หมด' : 'พร้อมใช้'));
        const gcPct = (gc && gc.ok)
            ? clampPct((Number(gc.remainingThb) / (Number(gc.topUpThb) || Number(gc.baselineThb) || 1)) * 100)
            : 0;

        const anyWarn = dsLow || gcLow;
        const anyReady = dsReady || gcReady;
        const headTone = anyWarn ? 'warn' : (anyReady ? 'ok' : 'neutral');
        const headText = anyWarn ? 'เครดิตใกล้หมด' : (anyReady ? 'พร้อมใช้' : 'ไม่ได้เติม');

        return `
            <article class="ov3-qcard">
                <div class="ov3-qcard__head">
                    <div class="ov3-qcard__title-wrap">
                        <div class="ov3-qcard__name">เครดิต API (Pay-As-You-Go)</div>
                        <div class="ov3-qcard__sub">DeepSeek &amp; Gemini TTS</div>
                    </div>
                    <span class="ov3-badge" data-tone="${headTone}">${esc(headText)}</span>
                </div>

                <div class="ov3-qcredit">
                    <div class="ov3-qpool__top">
                        <span class="ov3-qpool__label">DeepSeek API</span>
                        <span class="ov3-badge" data-tone="${dsTone}">${esc(dsBadge)}</span>
                    </div>
                    ${ds && ds.ok ? `
                        <div class="ov3-qcredit__val" data-tone="${dsTone}">$${esc(ds.totalBalance)} <span style="font-size:12px;font-weight:500;color:var(--ov-ink-3);">${esc(ds.currency || 'USD')}</span></div>
                        <div class="ov3-qcredit__sub">เติมเอง $${esc(ds.toppedUpBalance || '0.00')} · โบนัส $${esc(ds.grantedBalance || '0.00')}</div>
                        ${dsModels ? `<div class="ov3-qcredit__sub" title="${esc(dsModels)}">${esc(dsModels)}</div>` : ''}
                    ` : `<div class="ov3-qcredit__sub">ยังไม่ได้ตั้งค่า หรือติดต่อ API ไม่ได้</div>`}
                </div>

                <div class="ov3-qdivider"></div>

                <div class="ov3-qcredit">
                    <div class="ov3-qpool__top">
                        <span class="ov3-qpool__label">Gemini TTS (เสียงวิดีโอ)</span>
                        <span class="ov3-badge" data-tone="${gcTone}">${esc(gcBadge)}</span>
                    </div>
                    ${gc && gc.ok ? `
                        <div class="ov3-qcredit__val" data-tone="${gcTone}">฿${Number(gc.remainingThb).toFixed(2)}</div>
                        <div class="ov3-bar"><span class="ov3-bar__fill" data-tone="${gcTone}" style="width:${gcPct.toFixed(0)}%"></span></div>
                        <div class="ov3-qcredit__sub">ตั้งต้น ฿${Number(gc.baselineThb).toFixed(2)} · ใช้ไป ฿${Number(gc.spentThb).toFixed(2)} (${esc(gc.calls || 0)} ครั้ง)</div>
                    ` : `<div class="ov3-qcredit__sub">ไม่มีข้อมูลเครดิต Gemini TTS</div>`}
                </div>
            </article>
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
        if (!gridEl || !q) return;

        const accounts = q.accounts || [];
        const cw = q.claudeWeb;
        const ds = q.deepseek;
        const gc = q.geminiCredit;

        let totalChannels = accounts.length + 3; // Google accounts + Claude Pro + DeepSeek + Gemini TTS
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

        const cardsHtml = [
            ...accounts.map(renderGoogleQuotaCard),
            renderClaudeQuotaCard(cw),
            renderCreditsQuotaCard(ds, gc),
        ].join('');

        gridEl.innerHTML = cardsHtml;
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

    // ── Polling & Hook from app.js ──────────────────────────────────────────
    async function tick(force = false) {
        if (ui.inFlight) return;
        if (!force && (document.hidden || !isOverviewActive())) return;
        ui.inFlight = true;
        try {
            const data = await fetchOverviewData();
            if (data && data.ok) {
                ui.lastData = data;
                ui.lastUpdatedAt = Date.now();
                pushHist(data);
                renderAll(data);
            }
        } catch (_) {
            // keep last rendered snapshot quietly
        } finally {
            ui.inFlight = false;
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
        });

        root.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                const thumb = e.target.closest('.ov2-video-thumb[data-play-video]');
                if (thumb) {
                    e.preventDefault();
                    openVideoPlayer(thumb.dataset.playVideo);
                }
            }
        });

        $('ov2-btn-refresh')?.addEventListener('click', () => {
            tick(true);
            fetchQuotaData(true);
        });
        $('ov3-quota-refresh')?.addEventListener('click', () => fetchQuotaData(true));
        $('ov3-quota-toggle-models')?.addEventListener('click', () => {
            ui.quotaModelsOpen = !ui.quotaModelsOpen;
            if (ui.quota) renderQuotaModelsTable(ui.quota);
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
        initPrayerWidget();
        tick(true);
        fetchQuotaData(true);
        setInterval(() => tick(false), POLL_MS);
        setInterval(() => fetchQuotaData(false), QUOTA_POLL_MS);

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && isOverviewActive()) {
                tick(false);
                if (Date.now() - ui.quotaUpdatedAt > QUOTA_POLL_MS) fetchQuotaData(false);
            }
        });

        const view = $('view-overview');
        if (view && typeof MutationObserver !== 'undefined') {
            const obs = new MutationObserver(() => {
                if (isOverviewActive() && !document.hidden) {
                    tick(false);
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
