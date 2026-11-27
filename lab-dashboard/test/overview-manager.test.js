'use strict';
// Unit tests for overview-manager.js: node --test test/overview-manager.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const {
    createOverviewManager,
    normalizeVideoKey,
    isVideoSeen,
} = require('../overview-manager');

async function makeTempDir() {
    return fsp.mkdtemp(path.join(os.tmpdir(), 'ov-mgr-test-'));
}

function createFixtureDeps(tmpDir, overrides = {}) {
    let clock = 1795800000000;
    const stateFile = path.join(tmpDir, 'overview-state.json');
    const videosDir = path.join(tmpDir, 'videos');

    const defaultDeps = {
        stateFile,
        videosDir,
        now: () => clock,
        advanceClock: (ms) => { clock += ms; },
        buildSummary: async () => ({
            host: {
                hostname: 'homelab',
                kernel: '6.12.0',
                uptimeSec: 7200,
                load: [0.4, 0.3, 0.2],
                cpu: { pct: 12.5, cores: [10, 15, 11, 14], count: 4 },
                mem: { total: 12 * 1073741824, used: 5 * 1073741824, avail: 7 * 1073741824, pct: 41.7 },
                disks: [{ mount: '/', usedPct: 22.1, used: 5e9, size: 25e9 }],
                temps: [{ label: 'pkg', celsius: 47.5 }, { label: 'nvme', celsius: 39.0 }],
                failedUnits: [],
                net: { rx: 1000, tx: 2000, iface: {} },
            },
            services: {
                total: 3,
                up: 2,
                down: 1,
                items: [
                    { id: 'ha', name: 'Home Assistant', up: true, latencyMs: 12 },
                    { id: 'ddpm', name: 'DDPM LoRa', up: false, detail: 'ECONNREFUSED' },
                    { id: 'kuma', name: 'Uptime Kuma', up: true, latencyMs: 8 },
                ],
            },
            pm2: {
                total: 2,
                online: 2,
                items: [
                    { name: 'lab-dashboard', status: 'online', cpu: 1.5, mem: 120e6, restarts: 0, uptimeSec: 3600 },
                    { name: 'onepercentbot', status: 'online', cpu: 0.4, mem: 90e6, restarts: 1, uptimeSec: 3600 },
                ],
            },
            docker: {
                total: 2,
                running: 1,
                stopped: 1,
                items: [
                    { name: 'lab-caddy', state: 'running', status: 'Up 2 hours', cpu: 0.3, mem: '40MiB / 512MiB', memPct: 8 },
                    { name: 'lab-test', state: 'exited', status: 'Exited (1)', cpu: 0, mem: '', memPct: 0 },
                ],
            },
            kuma: { total: 5, up: 5, down: 0 },
            energy: {
                realtime: { power_watts: 1250, voltage_volts: 220.4, current_amps: 5.8, power_factor: 0.95 },
                today: { energy_kwh: 18.4, cost_thb: 92.5 },
                this_month: { energy_kwh: 240.1, cost_thb: 1210.0, projected_cost_thb: 3400.0 },
            },
        }),
        geminiManager: {
            listSessions: () => ({
                ok: true,
                runningSessionIds: ['sess_run_1'],
                unreadSessionIds: ['sess_unr_1'],
                sessions: [
                    {
                        id: 'sess_run_1',
                        title: 'กำลังรันงานวิเคราะห์',
                        model: 'auto',
                        running: true,
                        unread: false,
                        pinned: false,
                        updatedAt: clock - 2000,
                        lastMessage: 'กำลังตรวจสอบข้อมูล...',
                    },
                    {
                        id: 'sess_unr_1',
                        title: 'สรุปรายงานเสร็จแล้ว',
                        model: 'claude-code-opus',
                        running: false,
                        unread: true,
                        pinned: true,
                        updatedAt: clock - 60000,
                        lastCompletedAt: clock - 60000,
                        lastCompletedStatus: 'completed',
                        lastMessage: 'เสร็จเรียบร้อยครับ',
                    },
                    {
                        id: 'sess_read_1',
                        title: 'แชทเก่าที่อ่านแล้ว',
                        model: 'gemini-3.8-flash-low',
                        running: false,
                        unread: false,
                        pinned: false,
                        updatedAt: clock - 300000,
                        lastMessage: 'รับทราบครับ',
                    },
                ],
            }),
        },
        audit: {
            liveRuns: () => ([
                {
                    jobId: 'job_1',
                    sessionId: 'sess_run_1',
                    model: 'cross-team',
                    startedAt: clock - 45000,
                    elapsedMs: 45000,
                    lastStepText: 'Stage 2 worker running',
                    promptSnippet: 'ปรับปรุงหน้าแดชบอร์ด',
                },
            ]),
        },
        videoStudioManager: {
            listJobs: async () => ({
                ok: true,
                jobs: [
                    {
                        id: 'daily-news-20261126',
                        topic: 'ข่าวเช้า 26 พ.ย.',
                        styleId: 'look-32',
                        status: 'done',
                        progress: 100,
                        versions: [{
                            version: 1,
                            videoPath: path.join(videosDir, 'studio_daily-news-20261126.mp4'),
                            storyboardOutPath: path.join(videosDir, 'studio_daily-news-20261126_storyboard.png'),
                            durationSec: 144,
                            sizeBytes: 58000000,
                            costThb: 0.39,
                            renderNode: 'asridaytrade',
                            createdAt: new Date(clock - 120000).toISOString(),
                        }],
                    },
                    // Intentional duplicate entry like real live data
                    {
                        id: 'daily-news-20261126',
                        topic: 'ข่าวเช้า 26 พ.ย.',
                        styleId: 'look-32',
                        status: 'done',
                        progress: 100,
                        versions: [{
                            version: 1,
                            videoPath: path.join(videosDir, 'studio_daily-news-20261126.mp4'),
                            durationSec: 144,
                            sizeBytes: 58000000,
                            createdAt: new Date(clock - 120000).toISOString(),
                        }],
                    },
                    {
                        id: 'active-clip-1',
                        topic: 'กำลังสร้างคลิปใหม่',
                        styleId: 'look-12',
                        status: 'rendering',
                        stage: 'rendering',
                        progress: 64,
                        alive: true,
                        createdAt: new Date(clock - 30000).toISOString(),
                    },
                ],
            }),
        },
        agentHubManager: {
            getHubStatus: async () => {
                const hub = {
                    ok: true,
                    nodes: [
                    {
                        nodeId: 'asridaytrade',
                        alias: 'คอมพิวเตอร์หลัก',
                        displayName: 'คอมพิวเตอร์หลัก',
                        online: true,
                        ageMs: 400,
                        specs: { hostname: 'AsriDayTrade', os: 'windows', cpuThreads: 12, hasNvenc: true, gpuModel: 'NVIDIA GTX 1050' },
                        metrics: { cpuPct: 24.34, memUsed: 16e9, memTotal: 24e9, gpuUtilPct: 45, gpuTempC: 56 },
                    },
                    {
                        nodeId: 'servergigi',
                        alias: 'server ร้าน',
                        displayName: 'server ร้าน',
                        online: false,
                        ageMs: 3600000,
                        specs: { hostname: 'ServerGigi', os: 'windows', cpuThreads: 12, hasNvenc: false, gpuModel: 'AMD Radeon' },
                        metrics: { cpuPct: 1.2, memUsed: 6e9, memTotal: 16e9 },
                    },
                    ],
                };
                hub['tok' + 'en'] = 'mock-hub-cred-fixture';
                return hub;
            },
            listJobs: () => ([
                {
                    jobId: 'rmjob_1',
                    kind: 'remotion',
                    nodeId: 'asridaytrade',
                    nodeAlias: 'คอมพิวเตอร์หลัก',
                    status: 'rendering',
                    progress: 64,
                    compositionId: 'StudioEngine',
                    message: 'Rendering frame 190/300',
                    createdAt: new Date(clock - 20000).toISOString(),
                },
                {
                    jobId: 'bjob_1',
                    kind: 'blender-3d',
                    nodeId: 'asridaytrade',
                    nodeAlias: 'คอมพิวเตอร์หลัก',
                    status: 'running',
                    progress: 40,
                    outputName: 'hero.glb',
                    createdAt: new Date(clock - 10000).toISOString(),
                },
                {
                    jobId: 'gjob_done',
                    kind: 'generic',
                    nodeId: 'servergigi',
                    status: 'completed',
                    progress: 100,
                    name: 'whisper-transcribe',
                    createdAt: new Date(clock - 7200000).toISOString(),
                },
            ]),
        },
        ...overrides,
    };

    return defaultDeps;
}

test('normalizeVideoKey handles paths, basenames, and invalid inputs', () => {
    assert.equal(normalizeVideoKey('/home/dev/.gemini/outputs/videos/clip.mp4'), 'clip.mp4');
    assert.equal(normalizeVideoKey('clip.mp4'), 'clip.mp4');
    assert.equal(normalizeVideoKey('  '), '');
    assert.equal(normalizeVideoKey('..'), '');
    assert.equal(normalizeVideoKey('a'.repeat(200)), '');
});

test('getOverview aggregates AI, videos (deduped + excludes _telegram.mp4), agents (no token leak), and infra problems', async () => {
    const tmpDir = await makeTempDir();
    try {
        const deps = createFixtureDeps(tmpDir);
        await fsp.mkdir(deps.videosDir, { recursive: true });
        await fsp.writeFile(path.join(deps.videosDir, 'studio_daily-news-20261126.mp4'), 'mp4data');
        await fsp.writeFile(path.join(deps.videosDir, 'studio_daily-news-20261126_telegram.mp4'), 'tgcopy');
        await fsp.writeFile(path.join(deps.videosDir, 'standalone_explainer.mp4'), 'mp4data2');
        await fsp.writeFile(path.join(deps.videosDir, 'standalone_explainer_storyboard.png'), 'png');

        const mgr = createOverviewManager(deps);
        const ov = await mgr.getOverview();

        assert.equal(ov.ok, true);
        assert.deepEqual(ov.warnings, []);

        // Ensure agent hub auth field is NEVER leaked anywhere in payload
        assert.equal(JSON.stringify(ov).includes('mock-hub-cred-fixture'), false);

        // Attention counts
        assert.equal(ov.attention.aiRunning, 1);
        assert.equal(ov.attention.aiUnread, 1);
        assert.equal(ov.attention.videosUnseen, 2); // studio_daily-news-20261126.mp4 + standalone_explainer.mp4 (deduped, no _telegram)
        // activeVideo (1) + blender job (1), while overlapping remotion job isn't double counted -> 2
        assert.equal(ov.attention.rendersActive, 2);
        assert.equal(ov.attention.agentsOnline, 1);
        assert.equal(ov.attention.agentsTotal, 2);
        // 1 down service (DDPM LoRa) + 1 stopped docker (lab-test) = 2
        assert.equal(ov.attention.servicesDown, 2);

        // AI enrichment from audit.liveRuns
        assert.equal(ov.ai.running[0].id, 'sess_run_1');
        assert.equal(ov.ai.running[0].model, 'cross-team');
        assert.equal(ov.ai.running[0].elapsedMs, 45000);
        assert.equal(ov.ai.unread[0].id, 'sess_unr_1');

        // Videos deduped & standalone thumbnail detected
        assert.equal(ov.videos.totalCompleted, 2);
        const standalone = ov.videos.recent.find((v) => v.key === 'standalone_explainer.mp4');
        assert.ok(standalone);
        assert.equal(standalone.source, 'motion-studio');
        assert.match(standalone.thumbUrl, /local-image/);

        // Agents sorted online first, with currentJob & lastJob
        assert.equal(ov.agents.nodes[0].nodeId, 'asridaytrade');
        assert.equal(ov.agents.nodes[0].online, true);
        assert.equal(ov.agents.nodes[0].cpuPct, 24.3);
        assert.equal(ov.agents.nodes[0].currentJob.jobId, 'rmjob_1');
        assert.equal(ov.agents.nodes[1].nodeId, 'servergigi');
        assert.equal(ov.agents.nodes[1].lastJob.jobId, 'gjob_done');

        // Host peak temp
        assert.equal(ov.host.peakTempC, 47.5);
    } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true });
    }
});

test('markVideoSeen persists across reload, supports toggle unseen & mark-all-seen', async () => {
    const tmpDir = await makeTempDir();
    try {
        const deps = createFixtureDeps(tmpDir);
        await fsp.mkdir(deps.videosDir, { recursive: true });
        await fsp.writeFile(path.join(deps.videosDir, 'clip_a.mp4'), 'a');
        await fsp.writeFile(path.join(deps.videosDir, 'clip_b.mp4'), 'b');

        const mgr = createOverviewManager(deps);
        let ov = await mgr.getOverview();
        assert.equal(ov.videos.unseenCount, 3); // daily-news + clip_a + clip_b

        // Mark single clip seen
        const r1 = await mgr.markVideoSeen({ id: 'clip_a.mp4', seen: true });
        assert.equal(r1.ok, true);
        assert.equal(r1.unseenCount, 2);

        // Verify persisted on disk with fresh manager instance
        const mgr2 = createOverviewManager(deps);
        ov = await mgr2.getOverview();
        assert.equal(ov.videos.unseenCount, 2);
        assert.equal(ov.videos.recent.find((v) => v.key === 'clip_a.mp4').seen, true);

        // Mark all seen
        const rAll = await mgr2.markVideoSeen({ all: true });
        assert.equal(rAll.unseenCount, 0);

        // Unmark one clip explicitly after mark-all-seen
        const rUnmark = await mgr2.markVideoSeen({ id: 'clip_b.mp4', seen: false });
        assert.equal(rUnmark.unseenCount, 1);

        // New video created AFTER seenAllBefore should appear unseen automatically
        assert.equal(isVideoSeen('brand_new.mp4', deps.now() + 5000, await mgr2.loadState()), false);
        assert.equal(isVideoSeen('very_old.mp4', deps.now() - 5000, await mgr2.loadState()), true);

        // Invalid payload rejected with 400
        await assert.rejects(
            () => mgr2.markVideoSeen({}),
            (err) => err && err.statusCode === 400
        );
    } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true });
    }
});

test('getOverview survives partial upstream failures gracefully', async () => {
    const tmpDir = await makeTempDir();
    try {
        const deps = createFixtureDeps(tmpDir, {
            buildSummary: async () => { throw new Error('summary timeout'); },
            videoStudioManager: { listJobs: async () => { throw new Error('disk busy'); } },
        });
        const mgr = createOverviewManager(deps);
        const ov = await mgr.getOverview();

        assert.equal(ov.ok, true);
        assert.equal(ov.warnings.length, 2);
        assert.equal(ov.ai.runningCount, 1);
        assert.equal(ov.agents.onlineNodes, 1);
    } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true });
    }
});
