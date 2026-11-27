'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

function createMockReq(method, urlStr, { headers = {}, body = null, remoteAddress = '127.0.0.1' } = {}) {
    const req = new EventEmitter();
    req.method = method;
    req.url = urlStr;
    req.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    req.socket = { remoteAddress };
    req.destroy = () => {};
    req._body = body;
    return req;
}

function createMockRes() {
    const headers = {};
    const res = {
        statusCode: 200,
        headers,
        body: '',
        writableEnded: false,
        setHeader(k, v) {
            headers[String(k).toLowerCase()] = v;
        },
        writeHead(code, hdrs = {}) {
            this.statusCode = code;
            for (const [k, v] of Object.entries(hdrs)) {
                headers[String(k).toLowerCase()] = v;
            }
        },
        end(chunk = '') {
            if (chunk) this.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
            this.writableEnded = true;
        },
        json() {
            return JSON.parse(this.body || '{}');
        },
    };
    return res;
}

async function callApi(mgr, method, urlPath, { headers = {}, body = null } = {}) {
    const req = createMockReq(method, urlPath, { headers, body });
    const res = createMockRes();
    const url = new URL(urlPath, 'http://localhost');
    const handled = await mgr.handleApi(req, res, url, {
        sendJson(r, code, obj) {
            r.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
            r.end(JSON.stringify(obj));
        },
        async readJsonBody(r) {
            return r._body || {};
        },
        clientIp() {
            return '100.93.214.10';
        },
    });
    assert.equal(handled, true, `Expected handleApi to handle ${method} ${urlPath}`);
    return { status: res.statusCode, body: res.json(), headers: res.headers };
}

test('Agent Hub v1.2.0: workerState, self-status (non-mutating), mini, and paused node exclusion', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-hub-v120-test-'));
    const prevRoot = process.env.AGENT_HUB_ROOT;
    const prevSkip = process.env.AGENT_HUB_SKIP_SIDE_EFFECTS;

    process.env.AGENT_HUB_ROOT = tmpRoot;
    process.env.AGENT_HUB_SKIP_SIDE_EFFECTS = '1';

    const mgrPath = require.resolve('../agent-hub-manager');
    delete require.cache[mgrPath];
    const mgr = require('../agent-hub-manager');

    try {
        const status0 = await mgr.getHubStatus();
        assert.equal(status0.agentVersion, '1.2.0');
        const token = status0.token;
        const authHeaders = { 'X-Agent-Token': token };

        // 1. Unauthorized self-status must return 401
        const unauth = await callApi(mgr, 'GET', '/api/agent-hub/agent/self-status?nodeId=win-a');
        assert.equal(unauth.status, 401);

        // 2. Unregistered node self-status
        const unreg = await callApi(mgr, 'GET', '/api/agent-hub/agent/self-status?nodeId=ghost-pc', { headers: authHeaders });
        assert.equal(unreg.status, 200);
        assert.equal(unreg.body.ok, true);
        assert.equal(unreg.body.registered, false);
        assert.equal(unreg.body.online, false);
        assert.equal(unreg.body.workerState, 'offline');

        // 3. Register two capable Windows nodes via heartbeat
        const hbA = await callApi(mgr, 'POST', '/api/agent-hub/agent/heartbeat', {
            headers: authHeaders,
            body: {
                specs: {
                    nodeId: 'win-a',
                    hostname: 'WIN-A',
                    os: 'windows',
                    cpuThreads: 16,
                    hasNvenc: true,
                    hasNvidiaSmi: true,
                    blenderPath: 'C:\\Blender\\blender.exe',
                    capabilities: ['remote-exec', 'file-ops', 'job-run', 'ffmpeg', 'ffmpeg-nvenc', 'blender', 'blender-3d', 'nodejs', 'remotion-render', 'python'],
                },
                metrics: {
                    cpuPct: 10,
                    memTotal: 32e9,
                    memUsed: 8e9,
                    activeJobs: 0,
                    paused: false,
                },
            },
        });
        assert.equal(hbA.status, 200);
        assert.equal(hbA.body.ok, true);
        assert.equal(hbA.body.workerState, 'idle');
        assert.equal(hbA.body.paused, false);
        assert.equal(hbA.body.agentVersion, '1.2.0');
        assert.equal(hbA.body.totalNodes, 1);
        assert.equal(hbA.body.onlineNodes, 1);

        await mgr.updateNodeMeta('win-a', { alias: 'เครื่องเทรด' });

        // 4. Verify self-status reflects alias & does NOT mutate lastSeenAt
        const statusBefore = (await mgr.getHubStatus()).nodes.find((n) => n.nodeId === 'win-a');
        const lastSeenBefore = statusBefore.lastSeenAt;
        await new Promise((r) => setTimeout(r, 25));

        const selfRes = await callApi(mgr, 'GET', '/api/agent-hub/agent/self-status?nodeId=win-a', { headers: authHeaders });
        assert.equal(selfRes.status, 200);
        assert.equal(selfRes.body.registered, true);
        assert.equal(selfRes.body.online, true);
        assert.equal(selfRes.body.paused, false);
        assert.equal(selfRes.body.workerState, 'idle');
        assert.equal(selfRes.body.alias, 'เครื่องเทรด');
        assert.equal(selfRes.body.displayName, 'เครื่องเทรด');
        assert.equal(selfRes.body.hub.agentVersion, '1.2.0');
        assert.equal(selfRes.body.hub.onlineNodes, 1);

        const statusAfter = (await mgr.getHubStatus()).nodes.find((n) => n.nodeId === 'win-a');
        assert.equal(statusAfter.lastSeenAt, lastSeenBefore, 'self-status MUST NOT mutate lastSeenAt');

        // 5. Running state reflected via heartbeat metrics.currentJobs / activeJobs
        const hbRunning = await callApi(mgr, 'POST', '/api/agent-hub/agent/heartbeat', {
            headers: authHeaders,
            body: {
                specs: { nodeId: 'win-a' },
                metrics: {
                    cpuPct: 65,
                    activeJobs: 1,
                    paused: false,
                    currentJobs: [{ jobId: 'gjob_demo', name: 'whisper-transcribe', kind: 'generic', status: 'running', progress: 42, message: 'transcribing' }],
                },
            },
        });
        assert.equal(hbRunning.body.workerState, 'running');
        assert.equal(hbRunning.body.displayName, 'เครื่องเทรด');

        const miniRunning = await callApi(mgr, 'GET', '/api/agent-hub/mini');
        assert.equal(miniRunning.status, 200);
        assert.equal(miniRunning.body.nodes[0].workerState, 'running');
        assert.equal(miniRunning.body.nodes[0].paused, false);
        assert.equal(miniRunning.body.nodes[0].currentJobs.length, 1);
        assert.equal(miniRunning.body.nodes[0].currentJobs[0].name, 'whisper-transcribe');

        // 6. Pause win-a -> workerState='paused' and schedulers skip win-a unless allowPaused=true
        const hbPaused = await callApi(mgr, 'POST', '/api/agent-hub/agent/heartbeat', {
            headers: authHeaders,
            body: {
                specs: { nodeId: 'win-a' },
                metrics: {
                    cpuPct: 5,
                    activeJobs: 0,
                    paused: true,
                    currentJobs: [],
                },
            },
        });
        assert.equal(hbPaused.body.workerState, 'paused');
        assert.equal(hbPaused.body.paused, true);

        assert.equal(mgr.selectBestRenderNode('auto'), null);
        assert.equal(mgr.selectBestRenderNode('win-a'), null);
        assert.equal(mgr.selectBestRenderNode('win-a', { allowPaused: true }).nodeId, 'win-a');

        assert.equal(mgr.selectBestBlenderNode('auto', true), null);
        assert.equal(mgr.selectBestBlenderNode('win-a', true, { allowPaused: true }).nodeId, 'win-a');

        assert.equal(mgr.selectBestRemotionNode('auto'), null);
        assert.equal(mgr.selectBestRemotionNode('win-a', { allowPaused: true }).nodeId, 'win-a');

        assert.equal(mgr.findMatchingGenericNodes({ requires: ['python'], command: 'python -V' }).length, 0);
        assert.equal(mgr.findMatchingGenericNodes({ requires: ['python'], command: 'python -V', allowPaused: true }).length, 1);

        // 7. Add second node win-b (not paused) -> schedulers select win-b instead of paused win-a
        await callApi(mgr, 'POST', '/api/agent-hub/agent/heartbeat', {
            headers: authHeaders,
            body: {
                specs: {
                    nodeId: 'win-b',
                    hostname: 'WIN-B',
                    os: 'windows',
                    cpuThreads: 8,
                    hasNvenc: false,
                    blenderPath: 'C:\\Blender\\blender.exe',
                    capabilities: ['remote-exec', 'file-ops', 'job-run', 'ffmpeg', 'blender', 'nodejs', 'remotion-render', 'python'],
                },
                metrics: { cpuPct: 15, activeJobs: 0, paused: false },
            },
        });

        assert.equal(mgr.selectBestRenderNode('auto').nodeId, 'win-b');
        assert.equal(mgr.selectBestBlenderNode('auto').nodeId, 'win-b');
        assert.equal(mgr.selectBestRemotionNode('auto').nodeId, 'win-b');
        assert.equal(mgr.selectBestGenericNode({ requires: ['python'], command: 'python -V' }).nodeId, 'win-b');

        // 8. Resume win-a -> becomes idle and preferred again (higher specs + NVENC)
        await callApi(mgr, 'POST', '/api/agent-hub/agent/heartbeat', {
            headers: authHeaders,
            body: {
                specs: { nodeId: 'win-a' },
                metrics: { cpuPct: 5, activeJobs: 0, paused: false },
            },
        });
        assert.equal(mgr.selectBestRenderNode('auto').nodeId, 'win-a');
        assert.equal(mgr.selectBestGenericNode({ requires: ['python'], command: 'python -V' }).nodeId, 'win-a');
    } finally {
        if (prevRoot === undefined) delete process.env.AGENT_HUB_ROOT;
        else process.env.AGENT_HUB_ROOT = prevRoot;
        if (prevSkip === undefined) delete process.env.AGENT_HUB_SKIP_SIDE_EFFECTS;
        else process.env.AGENT_HUB_SKIP_SIDE_EFFECTS = prevSkip;
        await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    }
});

test('Agent Hub v1.2.0 regression: omitted currentJobs on subsequent heartbeat clears stale jobs and returns to idle', async () => {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-hub-v120-reg-'));
    const prevRoot = process.env.AGENT_HUB_ROOT;
    const prevSkip = process.env.AGENT_HUB_SKIP_SIDE_EFFECTS;

    process.env.AGENT_HUB_ROOT = tmpRoot;
    process.env.AGENT_HUB_SKIP_SIDE_EFFECTS = '1';

    const mgrPath = require.resolve('../agent-hub-manager');
    delete require.cache[mgrPath];
    const mgr = require('../agent-hub-manager');

    try {
        const status0 = await mgr.getHubStatus();
        const authHeaders = { 'X-Agent-Token': status0.token };

        // 1. Heartbeat with running job in metrics.currentJobs
        const hbRunning = await callApi(mgr, 'POST', '/api/agent-hub/agent/heartbeat', {
            headers: authHeaders,
            body: {
                specs: { nodeId: 'win-reg', hostname: 'WIN-REG', os: 'windows' },
                metrics: {
                    cpuPct: 55,
                    activeJobs: 1,
                    paused: false,
                    currentJobs: [
                        { jobId: 'gjob_stale', name: 'render-clip', kind: 'generic', status: 'running', progress: 80, message: 'encoding' },
                    ],
                },
            },
        });
        assert.equal(hbRunning.status, 200);
        assert.equal(hbRunning.body.workerState, 'running');

        const miniBefore = await callApi(mgr, 'GET', '/api/agent-hub/mini');
        assert.equal(miniBefore.body.nodes[0].workerState, 'running');
        assert.equal(miniBefore.body.nodes[0].activeJobs, 1);
        assert.equal(miniBefore.body.nodes[0].currentJobs.length, 1);

        // 2. Subsequent heartbeat with activeJobs: 0 and currentJobs OMITTED
        const hbIdle = await callApi(mgr, 'POST', '/api/agent-hub/agent/heartbeat', {
            headers: authHeaders,
            body: {
                specs: { nodeId: 'win-reg' },
                metrics: {
                    cpuPct: 5,
                    activeJobs: 0,
                    paused: false,
                },
            },
        });
        assert.equal(hbIdle.status, 200);
        assert.equal(hbIdle.body.workerState, 'idle');

        const hubStatusAfter = await mgr.getHubStatus();
        const nodeAfter = hubStatusAfter.nodes.find((n) => n.nodeId === 'win-reg');
        assert.equal(nodeAfter.workerState, 'idle');
        assert.equal(nodeAfter.activeJobs, 0);
        assert.equal(nodeAfter.currentJobs.length, 0);
        assert.deepEqual(nodeAfter.metrics.currentJobs, []);

        const miniAfter = await callApi(mgr, 'GET', '/api/agent-hub/mini');
        assert.equal(miniAfter.body.nodes[0].workerState, 'idle');
        assert.equal(miniAfter.body.nodes[0].activeJobs, 0);
        assert.equal(miniAfter.body.nodes[0].currentJobs.length, 0);

        const selfAfter = await callApi(mgr, 'GET', '/api/agent-hub/agent/self-status?nodeId=win-reg', { headers: authHeaders });
        assert.equal(selfAfter.body.workerState, 'idle');
        assert.equal(selfAfter.body.activeJobs, 0);
        assert.equal(selfAfter.body.currentJobs.length, 0);
    } finally {
        if (prevRoot === undefined) delete process.env.AGENT_HUB_ROOT;
        else process.env.AGENT_HUB_ROOT = prevRoot;
        if (prevSkip === undefined) delete process.env.AGENT_HUB_SKIP_SIDE_EFFECTS;
        else process.env.AGENT_HUB_SKIP_SIDE_EFFECTS = prevSkip;
        await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    }
});
