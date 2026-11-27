'use strict';

/**
 * overview-manager.js
 * -----------------------------------------------------------------------------
 * Unified data aggregator & seen-video tracker for Lab Dashboard Overview v2.
 *
 * Exposes:
 *   - GET  /api/overview       -> getOverview()
 *   - POST /api/overview/seen  -> markVideoSeen({ id | ids | all, seen })
 *
 * Design guarantees:
 *   - Resilient: every upstream collector is isolated in try/catch so partial
 *     failures never break the Overview payload.
 *   - Secure: strictly strips secrets/tokens (e.g. agentHub.token) before
 *     returning data to the client.
 *   - Deterministic video keys: uses basename(videoPath) || job.id so server
 *     and frontend fallback produce identical keys.
 *   - Atomic JSON persistence for seen-video state (~/.gemini/overview-state.json).
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const DEFAULT_STATE_FILE = path.join(os.homedir(), '.gemini', 'overview-state.json');
const DEFAULT_VIDEOS_DIR = path.join(os.homedir(), '.gemini', 'outputs', 'videos');

const TERMINAL_JOB_STATUSES = new Set([
    'completed',
    'done',
    'failed',
    'error',
    'cancelled',
    'canceled',
    'aborted',
]);

const ACTIVE_VIDEO_STATUSES = new Set([
    'queued',
    'researching',
    'scripting',
    'tts',
    'rendering',
    'mixing',
    'previewing',
    'editing',
    'running',
    'building',
    'downloading',
    'extracting',
    'analyzing',
]);

const MAX_SEEN_KEYS = 500;
const MAX_KEY_LEN = 180;

function normalizeVideoKey(input) {
    if (!input || typeof input !== 'string') return '';
    const trimmed = input.trim();
    if (!trimmed) return '';
    // If given a file path, normalize to basename
    const base = trimmed.includes('/') || trimmed.includes('\\')
        ? path.basename(trimmed)
        : trimmed;
    const clean = base.replace(/[\x00-\x1f\x7f]/g, '').trim();
    if (!clean || clean === '.' || clean === '..' || clean.length > MAX_KEY_LEN) return '';
    return clean;
}

function parseTimestampMs(val) {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string' && val.trim()) {
        const parsed = Date.parse(val);
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
}

function isVideoSeen(videoKey, createdAtMs, state) {
    const key = normalizeVideoKey(videoKey);
    const seenMap = (state && state.seenVideos && typeof state.seenVideos === 'object')
        ? state.seenVideos
        : {};
    if (key && Object.prototype.hasOwnProperty.call(seenMap, key)) {
        return Number(seenMap[key]) > 0;
    }
    const seenAllBefore = Number(state && state.seenAllBefore) || 0;
    if (seenAllBefore > 0 && createdAtMs > 0 && createdAtMs <= seenAllBefore) {
        return true;
    }
    return false;
}

function cleanStepText(raw) {
    const s = String(raw || '').trim();
    if (!s || /^watchdog\b/i.test(s)) return '';
    return s.slice(0, 120);
}
function prettifyVideoTitle(filename) {
    const stem = String(filename || '')
        .replace(/\.mp4$/i, '')
        .replace(/^studio_/, '')
        .replace(/[_-]+/g, ' ')
        .trim();
    return stem || filename || 'วิดีโอ';
}

function buildLocalFileUrl(filePath, download = false) {
    if (!filePath) return '';
    return `/api/gemini/local-file?path=${encodeURIComponent(filePath)}${download ? '&download=1' : ''}`;
}

function buildLocalImageUrl(filePath) {
    if (!filePath) return '';
    return `/api/gemini/local-image?path=${encodeURIComponent(filePath)}`;
}

function sanitizeAgentNode(n, activeJobByNode, lastJobByNode) {
    if (!n || typeof n !== 'object') return null;
    const nodeId = String(n.nodeId || '').trim();
    if (!nodeId) return null;
    const specs = (n.specs && typeof n.specs === 'object') ? n.specs : {};
    const metrics = (n.metrics && typeof n.metrics === 'object') ? n.metrics : {};
    const memUsed = Number(metrics.memUsed ?? n.memUsed) || 0;
    const memTotal = Number(metrics.memTotal ?? n.memTotal) || 0;
    const memPct = n.memPct != null
        ? Number(n.memPct)
        : (memTotal > 0 ? Math.round((memUsed / memTotal) * 1000) / 10 : null);
    const cpuRaw = metrics.cpuPct ?? n.cpuPct;
    const cpuPct = cpuRaw != null && Number.isFinite(Number(cpuRaw)) ? Math.round(Number(cpuRaw) * 10) / 10 : null;
    const gpuUtilRaw = metrics.gpuUtilPct ?? n.gpuUtilPct;
    const gpuTempRaw = metrics.gpuTempC ?? n.gpuTempC;
    const keyLower = nodeId.toLowerCase();
    const curJob = activeJobByNode.get(keyLower) || null;
    const prevJob = lastJobByNode.get(keyLower) || null;

    return {
        nodeId,
        alias: String(n.alias || '').trim(),
        displayName: String(n.displayName || n.alias || specs.hostname || n.hostname || nodeId).trim(),
        hostname: String(specs.hostname || n.hostname || nodeId).trim(),
        os: String(specs.os || specs.osCaption || n.os || '').trim(),
        online: Boolean(n.online),
        ageMs: Number.isFinite(Number(n.ageMs)) ? Number(n.ageMs) : null,
        cpuThreads: Number(specs.cpuThreads ?? n.cpuThreads) || 0,
        cpuPct,
        memUsed,
        memTotal,
        memPct,
        hasNvenc: Boolean(specs.hasNvenc ?? n.hasNvenc),
        gpuModel: String(specs.gpuModel || n.gpuModel || '').trim(),
        gpuUtilPct: gpuUtilRaw != null && Number.isFinite(Number(gpuUtilRaw)) ? Math.round(Number(gpuUtilRaw)) : null,
        gpuTempC: gpuTempRaw != null && Number.isFinite(Number(gpuTempRaw)) ? Math.round(Number(gpuTempRaw)) : null,
        activeJobs: Number(n.activeJobs) || (curJob ? 1 : 0),
        maxJobs: Number(n.maxJobs) || 1,
        currentJob: curJob,
        lastJob: prevJob,
    };
}

function createOverviewManager(deps = {}) {
    const stateFile = deps.stateFile || DEFAULT_STATE_FILE;
    const videosDir = deps.videosDir || DEFAULT_VIDEOS_DIR;
    const nowFn = typeof deps.now === 'function' ? deps.now : () => Date.now();

    let stateCache = null;
    let writeQueue = Promise.resolve();

    async function loadState() {
        if (stateCache) return stateCache;
        try {
            const raw = await fsp.readFile(stateFile, 'utf8');
            const parsed = JSON.parse(raw);
            stateCache = {
                seenVideos: (parsed && parsed.seenVideos && typeof parsed.seenVideos === 'object' && !Array.isArray(parsed.seenVideos))
                    ? { ...parsed.seenVideos }
                    : {},
                seenAllBefore: Number(parsed && parsed.seenAllBefore) || 0,
                updatedAt: Number(parsed && parsed.updatedAt) || 0,
            };
        } catch (_) {
            stateCache = { seenVideos: {}, seenAllBefore: 0, updatedAt: 0 };
        }
        return stateCache;
    }

    function pruneSeenMap(seenVideos) {
        const entries = Object.entries(seenVideos || {});
        if (entries.length <= MAX_SEEN_KEYS) return seenVideos;
        entries.sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0));
        return Object.fromEntries(entries.slice(0, MAX_SEEN_KEYS));
    }

    async function persistState(nextState) {
        stateCache = {
            seenVideos: pruneSeenMap(nextState.seenVideos),
            seenAllBefore: Number(nextState.seenAllBefore) || 0,
            updatedAt: nowFn(),
        };
        const snapshot = JSON.stringify(stateCache, null, 2);
        writeQueue = writeQueue.then(async () => {
            await fsp.mkdir(path.dirname(stateFile), { recursive: true });
            const tmpPath = `${stateFile}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            try {
                await fsp.writeFile(tmpPath, snapshot, { encoding: 'utf8', mode: 0o600 });
                await fsp.rename(tmpPath, stateFile);
            } catch (err) {
                await fsp.unlink(tmpPath).catch(() => {});
                throw err;
            }
        });
        await writeQueue;
        return stateCache;
    }

    async function collectAi(warnings) {
        let sessData = { sessions: [], runningSessionIds: [], unreadSessionIds: [] };
        if (deps.geminiManager && typeof deps.geminiManager.listSessions === 'function') {
            try {
                const res = await deps.geminiManager.listSessions();
                if (res && typeof res === 'object') sessData = res;
            } catch (err) {
                warnings.push(`gemini: ${err.message}`);
            }
        }

        let liveRuns = [];
        if (deps.audit && typeof deps.audit.liveRuns === 'function') {
            try {
                const runs = await deps.audit.liveRuns();
                if (Array.isArray(runs)) liveRuns = runs;
            } catch (err) {
                warnings.push(`audit: ${err.message}`);
            }
        }

        const liveBySession = new Map();
        for (const r of liveRuns) {
            if (!r || !r.sessionId) continue;
            if (!liveBySession.has(r.sessionId)) liveBySession.set(r.sessionId, r);
        }

        const rawSessions = Array.isArray(sessData.sessions) ? sessData.sessions : [];
        const runningIds = new Set(Array.isArray(sessData.runningSessionIds) ? sessData.runningSessionIds : []);
        for (const r of liveRuns) {
            if (r && r.sessionId) runningIds.add(r.sessionId);
        }

        const running = [];
        const unread = [];
        const recent = [];
        const seenRunningIds = new Set();

        for (const s of rawSessions) {
            if (!s || !s.id) continue;
            const live = liveBySession.get(s.id) || null;
            const isRunning = Boolean(s.running) || runningIds.has(s.id);
            const isUnread = !isRunning && Boolean(s.unread);
            const item = {
                id: s.id,
                title: String(s.title || 'แชทไม่มีชื่อ'),
                model: String((live && live.model) || s.model || 'auto'),
                pinned: Boolean(s.pinned),
                running: isRunning,
                unread: isUnread,
                messageCount: Number(s.messageCount) || 0,
                lastMessage: String(s.lastMessage || (live && live.promptSnippet) || '').slice(0, 140),
                updatedAt: parseTimestampMs(s.updatedAt),
                lastCompletedAt: parseTimestampMs(s.lastCompletedAt),
                lastCompletedStatus: s.lastCompletedStatus || null,
                elapsedMs: live && Number.isFinite(Number(live.elapsedMs)) ? Number(live.elapsedMs) : null,
                stepText: live ? cleanStepText(live.lastStepText) : '',
            };
            if (isRunning) {
                running.push(item);
                seenRunningIds.add(s.id);
            } else if (isUnread) {
                unread.push(item);
            }
            if (recent.length < 12) recent.push(item);
        }

        // Include orphan liveRuns whose sessionId wasn't in sessions index
        for (const r of liveRuns) {
            if (!r) continue;
            const sid = r.sessionId || r.jobId || '';
            if (!sid || seenRunningIds.has(sid)) continue;
            seenRunningIds.add(sid);
            running.push({
                id: sid,
                title: String(r.promptSnippet || r.source || 'AI กำลังทำงาน').slice(0, 64),
                model: String(r.model || 'ai'),
                pinned: false,
                running: true,
                unread: false,
                messageCount: 0,
                lastMessage: String(r.promptSnippet || '').slice(0, 140),
                updatedAt: parseTimestampMs(r.startedAt),
                lastCompletedAt: 0,
                lastCompletedStatus: null,
                elapsedMs: Number.isFinite(Number(r.elapsedMs)) ? Number(r.elapsedMs) : null,
                stepText: cleanStepText(r.lastStepText),
            });
        }

        unread.sort((a, b) => (b.lastCompletedAt || b.updatedAt) - (a.lastCompletedAt || a.updatedAt));
        running.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        return {
            runningCount: running.length,
            unreadCount: unread.length,
            totalSessions: rawSessions.length,
            running,
            unread: unread.slice(0, 15),
            recent: recent.slice(0, 10),
        };
    }

    async function collectVideos(state, warnings) {
        const activeJobs = [];
        const completedByKey = new Map();
        const failedJobs = [];
        const seenJobIds = new Set();

        if (deps.videoStudioManager && typeof deps.videoStudioManager.listJobs === 'function') {
            try {
                const res = await deps.videoStudioManager.listJobs(50);
                const jobs = Array.isArray(res && res.jobs) ? res.jobs : [];
                for (const j of jobs) {
                    if (!j || !j.id) continue;
                    const status = String(j.status || '').toLowerCase();
                    const isAlive = Boolean(j.alive) || ACTIVE_VIDEO_STATUSES.has(status);
                    if (isAlive) {
                        if (seenJobIds.has(j.id)) continue;
                        seenJobIds.add(j.id);
                        activeJobs.push({
                            id: j.id,
                            topic: String(j.topic || j.id),
                            styleId: String(j.styleId || ''),
                            status: j.status || 'running',
                            stage: j.stage || j.status || 'running',
                            progress: Math.max(0, Math.min(100, Number(j.progress) || 0)),
                            message: String(j.message || ''),
                            createdAt: j.createdAt || null,
                            updatedAt: j.updatedAt || null,
                        });
                        continue;
                    }

                    const versions = Array.isArray(j.versions) ? j.versions : [];
                    const latest = versions.length ? versions[versions.length - 1] : null;
                    if (status === 'done' && latest) {
                        const videoPath = String(latest.videoPath || '').trim();
                        const key = normalizeVideoKey(videoPath || j.id);
                        if (!key) continue;
                        const createdAtMs = parseTimestampMs(latest.createdAt || j.updatedAt || j.createdAt);
                        const existing = completedByKey.get(key);
                        if (existing && existing.createdAtMs >= createdAtMs) continue;

                        const thumbPath = String(latest.storyboardOutPath || latest.gifOutPath || '').trim();
                        completedByKey.set(key, {
                            key,
                            source: 'video-studio',
                            jobId: j.id,
                            title: String(j.topic || prettifyVideoTitle(key)),
                            styleId: String(j.styleId || ''),
                            versionCount: versions.length,
                            durationSec: Number(latest.durationSec || j.durationSec) || null,
                            sizeBytes: Number(latest.sizeBytes) || 0,
                            costThb: latest.costThb != null ? Number(latest.costThb) : null,
                            renderNode: String(latest.renderNode || ''),
                            watchUrl: videoPath ? buildLocalFileUrl(videoPath, false) : (latest.watchUrl || ''),
                            downloadUrl: videoPath ? buildLocalFileUrl(videoPath, true) : (latest.downloadUrl || ''),
                            thumbUrl: thumbPath ? buildLocalImageUrl(thumbPath) : '',
                            editorUrl: `/video-editor.html?job=${encodeURIComponent(j.id)}`,
                            createdAt: latest.createdAt || j.updatedAt || j.createdAt || null,
                            createdAtMs,
                            seen: isVideoSeen(key, createdAtMs, state),
                        });
                    } else if (status === 'error' || status === 'failed') {
                        const updatedMs = parseTimestampMs(j.updatedAt || j.createdAt);
                        if (nowFn() - updatedMs <= 24 * 60 * 60 * 1000 && !seenJobIds.has(`err:${j.id}`)) {
                            seenJobIds.add(`err:${j.id}`);
                            failedJobs.push({
                                id: j.id,
                                topic: String(j.topic || j.id),
                                status,
                                message: String(j.error || j.message || ''),
                                updatedAt: j.updatedAt || j.createdAt || null,
                            });
                        }
                    }
                }
            } catch (err) {
                warnings.push(`videoStudio: ${err.message}`);
            }
        }

        // Scan standalone CLI-rendered videos in videosDir (deduplicated against studio jobs)
        try {
            const entries = await fsp.readdir(videosDir, { withFileTypes: true });
            const fileSet = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
            for (const ent of entries) {
                if (!ent.isFile()) continue;
                const name = ent.name;
                if (name.startsWith('.') || !name.toLowerCase().endsWith('.mp4')) continue;
                if (name.toLowerCase().endsWith('_telegram.mp4')) continue;
                const key = normalizeVideoKey(name);
                if (!key || completedByKey.has(key)) continue;

                const fullPath = path.join(videosDir, name);
                let st;
                try {
                    st = await fsp.stat(fullPath);
                } catch (_) {
                    continue;
                }
                const stem = name.slice(0, -4);
                const storyboardName = `${stem}_storyboard.png`;
                const gifName = `${stem}_preview.gif`;
                const thumbPath = fileSet.has(storyboardName)
                    ? path.join(videosDir, storyboardName)
                    : (fileSet.has(gifName) ? path.join(videosDir, gifName) : '');
                const createdAtMs = Math.round(st.mtimeMs || 0);

                completedByKey.set(key, {
                    key,
                    source: 'motion-studio',
                    jobId: null,
                    title: prettifyVideoTitle(name),
                    styleId: '',
                    versionCount: 1,
                    durationSec: null,
                    sizeBytes: st.size || 0,
                    costThb: null,
                    renderNode: '',
                    watchUrl: buildLocalFileUrl(fullPath, false),
                    downloadUrl: buildLocalFileUrl(fullPath, true),
                    thumbUrl: thumbPath ? buildLocalImageUrl(thumbPath) : '',
                    editorUrl: '',
                    createdAt: createdAtMs ? new Date(createdAtMs).toISOString() : null,
                    createdAtMs,
                    seen: isVideoSeen(key, createdAtMs, state),
                });
            }
        } catch (err) {
            if (err && err.code !== 'ENOENT') warnings.push(`videosDir: ${err.message}`);
        }

        const allCompleted = [...completedByKey.values()].sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
        const unseen = allCompleted.filter((v) => !v.seen);

        return {
            activeCount: activeJobs.length,
            unseenCount: unseen.length,
            totalCompleted: allCompleted.length,
            activeJobs,
            unseen: unseen.slice(0, 15),
            recent: allCompleted.slice(0, 20),
            failedRecent: failedJobs.slice(0, 5),
        };
    }

    async function collectAgents(warnings) {
        let hubStatus = null;
        let allJobs = [];

        if (deps.agentHubManager && typeof deps.agentHubManager.getHubStatus === 'function') {
            try {
                hubStatus = await deps.agentHubManager.getHubStatus();
            } catch (err) {
                warnings.push(`agentHub: ${err.message}`);
            }
        }
        if (deps.agentHubManager && typeof deps.agentHubManager.listJobs === 'function') {
            try {
                const jobs = await deps.agentHubManager.listJobs({ limit: 30 });
                if (Array.isArray(jobs)) allJobs = jobs;
            } catch (err) {
                warnings.push(`agentJobs: ${err.message}`);
            }
        } else if (hubStatus && Array.isArray(hubStatus.renderJobs)) {
            allJobs = hubStatus.renderJobs;
        }

        const activeJobs = [];
        const activeJobByNode = new Map();
        const lastJobByNode = new Map();

        for (const j of allJobs) {
            if (!j || !j.jobId) continue;
            const st = String(j.status || '').toLowerCase();
            const cleanJob = {
                jobId: j.jobId,
                kind: String(j.kind || 'generic'),
                name: String(j.name || j.compositionId || j.outputName || j.kind || 'job'),
                nodeId: String(j.nodeId || ''),
                nodeName: String(j.nodeAlias || j.alias || j.hostname || j.nodeId || ''),
                status: j.status || 'queued',
                progress: Math.max(0, Math.min(100, Number(j.progress) || 0)),
                message: String(j.message || ''),
                createdAt: j.createdAt || null,
                updatedAt: j.updatedAt || null,
                finishedAt: j.finishedAt || null,
                durationMs: Number.isFinite(Number(j.durationMs)) ? Number(j.durationMs) : null,
            };
            const nodeKey = cleanJob.nodeId.toLowerCase();
            if (!TERMINAL_JOB_STATUSES.has(st)) {
                activeJobs.push(cleanJob);
                if (nodeKey && !activeJobByNode.has(nodeKey)) activeJobByNode.set(nodeKey, cleanJob);
            } else if (nodeKey && !lastJobByNode.has(nodeKey)) {
                lastJobByNode.set(nodeKey, cleanJob);
            }
        }

        const rawNodes = (hubStatus && Array.isArray(hubStatus.nodes)) ? hubStatus.nodes : [];
        const nodes = rawNodes
            .map((n) => sanitizeAgentNode(n, activeJobByNode, lastJobByNode))
            .filter(Boolean)
            .sort((a, b) => {
                if (a.online !== b.online) return a.online ? -1 : 1;
                return a.displayName.localeCompare(b.displayName);
            });

        const onlineNodes = nodes.filter((n) => n.online);
        const totalThreads = onlineNodes.reduce((acc, n) => acc + (n.cpuThreads || 0), 0);
        const totalRamBytes = onlineNodes.reduce((acc, n) => acc + (n.memTotal || 0), 0);
        const nvencNodes = onlineNodes.filter((n) => n.hasNvenc).length;

        return {
            totalNodes: nodes.length,
            onlineNodes: onlineNodes.length,
            totalThreads,
            totalRamBytes,
            nvencNodes,
            activeJobCount: activeJobs.length,
            activeJobs,
            recentJobs: allJobs.slice(0, 8).map((j) => ({
                jobId: j.jobId,
                kind: String(j.kind || 'generic'),
                name: String(j.name || j.compositionId || j.outputName || j.kind || 'job'),
                nodeName: String(j.nodeAlias || j.alias || j.hostname || j.nodeId || ''),
                status: j.status || 'unknown',
                progress: Number(j.progress) || 0,
                updatedAt: j.updatedAt || j.createdAt || null,
            })),
            nodes,
        };
    }

    async function collectInfra(warnings) {
        let s = null;
        if (typeof deps.buildSummary === 'function') {
            try {
                s = await deps.buildSummary();
            } catch (err) {
                warnings.push(`summary: ${err.message}`);
            }
        }

        const hostRaw = (s && s.host) || {};
        const temps = Array.isArray(hostRaw.temps) ? hostRaw.temps : [];
        const peakTempC = temps.reduce((mx, t) => {
            const v = Number(t && t.celsius);
            return Number.isFinite(v) && v > mx ? v : mx;
        }, -Infinity);

        const host = {
            hostname: hostRaw.hostname || os.hostname(),
            kernel: hostRaw.kernel || os.release(),
            uptimeSec: Number(hostRaw.uptimeSec) || 0,
            load: Array.isArray(hostRaw.load) ? hostRaw.load : [0, 0, 0],
            cpu: hostRaw.cpu || { pct: 0, cores: [], count: os.cpus().length },
            mem: hostRaw.mem || { total: 0, used: 0, avail: 0, pct: 0 },
            disks: Array.isArray(hostRaw.disks) ? hostRaw.disks : [],
            peakTempC: peakTempC > -Infinity ? peakTempC : null,
            failedUnits: Array.isArray(hostRaw.failedUnits) ? hostRaw.failedUnits : [],
            net: hostRaw.net || { rx: 0, tx: 0, iface: {} },
        };

        const svcItems = Array.isArray(s && s.services && s.services.items) ? s.services.items : [];
        const downServices = svcItems.filter((x) => x && !x.up);
        const pm2Items = Array.isArray(s && s.pm2 && s.pm2.items) ? s.pm2.items : [];
        const downPm2 = pm2Items.filter((p) => p && p.status !== 'online');
        const dockerItems = Array.isArray(s && s.docker && s.docker.items) ? s.docker.items : [];
        const stoppedDocker = dockerItems.filter((c) => c && c.state !== 'running');

        const problems = [
            ...downServices.map((x) => ({
                kind: 'service',
                name: x.name || x.id,
                status: 'down',
                detail: x.detail || 'unreachable',
                url: x.url || '',
            })),
            ...downPm2.map((p) => ({
                kind: 'pm2',
                name: p.name,
                status: p.status || 'stopped',
                detail: `restarts: ${p.restarts ?? 0}`,
                url: '',
            })),
            ...stoppedDocker.map((c) => ({
                kind: 'docker',
                name: c.name,
                status: c.state || 'stopped',
                detail: c.status || '',
                url: '',
            })),
            ...host.failedUnits.map((u) => ({
                kind: 'systemd',
                name: u,
                status: 'failed',
                detail: 'systemd unit failed',
                url: '',
            })),
        ];

        return {
            host,
            services: {
                total: svcItems.length,
                up: svcItems.length - downServices.length,
                down: downServices.length,
                items: svcItems,
            },
            pm2: {
                total: pm2Items.length,
                online: pm2Items.length - downPm2.length,
                down: downPm2.length,
                items: pm2Items,
            },
            docker: {
                total: dockerItems.length,
                running: dockerItems.length - stoppedDocker.length,
                stopped: stoppedDocker.length,
                items: dockerItems,
            },
            kuma: (s && s.kuma) ? { total: s.kuma.total || 0, up: s.kuma.up || 0, down: s.kuma.down || 0 } : { total: 0, up: 0, down: 0 },
            energy: (s && s.energy) || {},
            problems,
        };
    }

    async function getOverview() {
        const warnings = [];
        const state = await loadState();

        const [ai, videos, agents, infra] = await Promise.all([
            collectAi(warnings),
            collectVideos(state, warnings),
            collectAgents(warnings),
            collectInfra(warnings),
        ]);

        // Avoid double-counting when a Video Studio job dispatches a Remotion/motion-* job to an Agent node
        const overlappingAgentCount = videos.activeCount > 0
            ? agents.activeJobs.filter((j) => j.kind === 'remotion' || j.name === 'motion-mix' || j.name === 'motion-preview').length
            : 0;
        const rendersActive = videos.activeCount + Math.max(0, agents.activeJobCount - overlappingAgentCount);

        const attention = {
            aiRunning: ai.runningCount,
            aiUnread: ai.unreadCount,
            videosUnseen: videos.unseenCount,
            rendersActive,
            agentsOnline: agents.onlineNodes,
            agentsTotal: agents.totalNodes,
            servicesDown: infra.problems.length,
        };

        return {
            ok: true,
            generatedAt: new Date(nowFn()).toISOString(),
            attention,
            ai,
            videos,
            agents,
            host: infra.host,
            infra: {
                services: infra.services,
                pm2: infra.pm2,
                docker: infra.docker,
                kuma: infra.kuma,
                energy: infra.energy,
                problems: infra.problems,
            },
            warnings,
        };
    }

    async function markVideoSeen(body) {
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            const err = new Error('Invalid JSON payload');
            err.statusCode = 400;
            throw err;
        }

        const state = await loadState();
        const nextSeen = { ...state.seenVideos };
        let nextSeenAllBefore = Number(state.seenAllBefore) || 0;
        const ts = nowFn();

        if (body.all === true) {
            nextSeenAllBefore = ts;
            // Clear explicit unseen (0) overrides so "mark all seen" marks everything up to now
            for (const [k, v] of Object.entries(nextSeen)) {
                if (Number(v) <= 0) nextSeen[k] = ts;
            }
            const warnings = [];
            const vids = await collectVideos({ seenVideos: nextSeen, seenAllBefore: nextSeenAllBefore }, warnings);
            for (const v of vids.recent) {
                nextSeen[v.key] = ts;
            }
        } else {
            const rawIds = [];
            if (typeof body.id === 'string' && body.id.trim()) rawIds.push(body.id);
            if (Array.isArray(body.ids)) {
                for (const item of body.ids) {
                    if (typeof item === 'string' && item.trim()) rawIds.push(item);
                }
            }
            const keys = rawIds.map(normalizeVideoKey).filter(Boolean);
            if (keys.length === 0) {
                const err = new Error('id or ids (or all: true) is required');
                err.statusCode = 400;
                throw err;
            }
            const seenFlag = body.seen !== false;
            for (const key of keys) {
                nextSeen[key] = seenFlag ? ts : 0;
            }
        }

        const saved = await persistState({
            seenVideos: nextSeen,
            seenAllBefore: nextSeenAllBefore,
        });

        const warnings = [];
        const videos = await collectVideos(saved, warnings);

        return {
            ok: true,
            unseenCount: videos.unseenCount,
            seenAllBefore: saved.seenAllBefore,
            seenVideos: saved.seenVideos,
        };
    }

    return {
        getOverview,
        markVideoSeen,
        loadState,
        resetCache() { stateCache = null; },
    };
}

module.exports = {
    createOverviewManager,
    normalizeVideoKey,
    isVideoSeen,
    prettifyVideoTitle,
    sanitizeAgentNode,
    DEFAULT_STATE_FILE,
    DEFAULT_VIDEOS_DIR,
};
