'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-ai-test-'));
process.env.VAULT_DIR = path.join(tmp, 'vault');
process.env.OUTPUTS_3D_DIR = path.join(tmp, 'outputs3d');

const vault = require('../asset-vault-manager');
const vaultAi = require('../asset-vault-ai');

function makeMinimalGlb(width = 2, height = 3, depth = 4) {
    const verts = new Float32Array([
        0, 0, 0,
        width, 0, 0,
        0, height, depth,
    ]);
    const binRaw = Buffer.from(verts.buffer);
    const binPad = (4 - (binRaw.length % 4)) % 4;
    const binBuf = Buffer.concat([binRaw, Buffer.alloc(binPad, 0)]);

    const gltf = {
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{
            primitives: [{
                attributes: { POSITION: 0 },
                mode: 4,
            }],
        }],
        buffers: [{ byteLength: binBuf.length }],
        bufferViews: [{
            buffer: 0,
            byteOffset: 0,
            byteLength: binRaw.length,
            target: 34962,
        }],
        accessors: [{
            bufferView: 0,
            componentType: 5126,
            count: 3,
            type: 'VEC3',
            min: [0, 0, 0],
            max: [width, height, depth],
        }],
    };

    const jsonRaw = Buffer.from(JSON.stringify(gltf), 'utf8');
    const jsonPad = (4 - (jsonRaw.length % 4)) % 4;
    const jsonBuf = Buffer.concat([jsonRaw, Buffer.alloc(jsonPad, 0x20)]);

    const totalLen = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
    const header = Buffer.alloc(12);
    header.write('glTF', 0, 4, 'ascii');
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(totalLen, 8);

    const jsonHdr = Buffer.alloc(8);
    jsonHdr.writeUInt32LE(jsonBuf.length, 0);
    jsonHdr.writeUInt32LE(0x4E4F534A, 4);

    const binHdr = Buffer.alloc(8);
    binHdr.writeUInt32LE(binBuf.length, 0);
    binHdr.writeUInt32LE(0x004E4942, 4);

    return Buffer.concat([header, jsonHdr, jsonBuf, binHdr, binBuf]);
}

function toDataUrl(buf, mime = 'application/octet-stream') {
    return `data:${mime};base64,${buf.toString('base64')}`;
}

function httpReq(port, method, reqPath, bodyObj = null) {
    return new Promise((resolve, reject) => {
        const payload = bodyObj !== null ? JSON.stringify(bodyObj) : null;
        const headers = {};
        if (payload !== null) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(payload);
        }
        const req = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(chunks),
                });
            });
        });
        req.on('error', reject);
        if (payload !== null) req.write(payload);
        req.end();
    });
}

async function waitForJob(jobId, timeoutMs = 120000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const job = await vaultAi.getJob(jobId);
        if (job && ['done', 'error', 'cancelled'].includes(job.status)) {
            return job;
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Timed out waiting for job ${jobId}`);
}

const GOOD_BPY_SCRIPT = [
    '```python',
    'import bpy, sys',
    'argv = sys.argv[sys.argv.index("--") + 1:]',
    'in_glb, out_glb, out_png = argv[0], argv[1], argv[2]',
    'bpy.ops.wm.read_factory_settings(use_empty=True)',
    'bpy.ops.import_scene.gltf(filepath=in_glb)',
    'bpy.ops.mesh.primitive_cube_add(size=1.0, location=(2.0, 0.0, 0.0))',
    'bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB")',
    '```',
].join('\n');

const BAD_RUNTIME_BPY_SCRIPT = [
    '```python',
    'import bpy',
    'raise Exception("intentional_test_failure")',
    '```',
].join('\n');

async function runTests() {
    const hasBlender = fs.existsSync(vault.BLENDER_BIN);

    // 1) checkScriptSafety: block subprocess/os.system/socket, allow normal bpy script
    {
        const badSub = vaultAi.checkScriptSafety('import subprocess\nsubprocess.run(["ls"])');
        assert.strictEqual(badSub.ok, false, 'subprocess must be blocked');

        const badOsSys = vaultAi.checkScriptSafety('import os\nos.system("id")');
        assert.strictEqual(badOsSys.ok, false, 'os.system must be blocked');

        const badSocket = vaultAi.checkScriptSafety('import socket\ns = socket.socket()');
        assert.strictEqual(badSocket.ok, false, 'socket must be blocked');

        const good = vaultAi.checkScriptSafety('import bpy\nbpy.ops.mesh.primitive_cube_add(size=1)');
        assert.strictEqual(good.ok, true, 'normal bpy script must pass');
    }

    // 2) extractPython: extract ```python ... ```
    {
        const extracted = vaultAi.extractPython('คำอธิบาย\n```python\nimport bpy\nprint(123)\n```\nจบ');
        assert.strictEqual(extracted, 'import bpy\nprint(123)');
    }

    // Create base asset with minimal GLB
    const baseAsset = await vault.createAsset({
        name: 'AI Test Cube',
        model: { dataUrl: toDataUrl(makeMinimalGlb(2, 2, 2)), filename: 'cube.glb' },
    });
    const assetId = baseAsset.id;

    // 3) chat: appendChat/getChat/clearChat must not create files in asset dir and cap at 200
    {
        const assetDir = vault.getAssetDir(assetId);
        const beforeFiles = (await fsp.readdir(assetDir)).sort();

        for (let i = 1; i <= 205; i++) {
            await vaultAi.appendChat(assetId, { role: 'user', text: `msg-${i}` });
        }
        const chat = await vaultAi.getChat(assetId);
        assert.strictEqual(chat.messages.length, 200, 'chat must be capped at 200 messages');
        assert.strictEqual(chat.messages[0].text, 'msg-6');
        assert.strictEqual(chat.messages[199].text, 'msg-205');

        const afterFiles = (await fsp.readdir(assetDir)).sort();
        assert.deepStrictEqual(afterFiles, beforeFiles, 'chat must not create files inside asset dir');

        await vaultAi.clearChat(assetId);
        const cleared = await vaultAi.getChat(assetId);
        assert.strictEqual(cleared.messages.length, 0);
    }

    // 4) startEdit with LLM mock returning valid bpy script
    if (hasBlender) {
        vaultAi.setLlmRunner(async () => GOOD_BPY_SCRIPT);
        const started = await vaultAi.startEdit(assetId, {
            instruction: 'เพิ่มกล่องข้างๆ',
            target: 'local',
        });
        assert.ok(started.jobId);
        const job = await waitForJob(started.jobId);
        assert.strictEqual(job.status, 'done', `expected done, got ${job.status}: ${job.error || ''}`);
        assert.strictEqual(job.newVersion, 2);

        const updated = await vault.getAsset(assetId);
        const v2 = updated.versions.find((v) => v.v === 2);
        assert.ok(v2, 'v2 must exist');
        assert.ok(String(v2.note || '').startsWith('🤖 AI:'), `unexpected v2 note: ${v2.note}`);
    } else {
        console.log('SKIP test 4 (Blender not found at ' + vault.BLENDER_BIN + ')');
    }

    // 5) self-heal: 1st attempt raises Exception, 2nd attempt succeeds -> attempts === 2, status === 'done'
    if (hasBlender) {
        let callCount = 0;
        vaultAi.setLlmRunner(async () => {
            callCount += 1;
            return callCount === 1 ? BAD_RUNTIME_BPY_SCRIPT : GOOD_BPY_SCRIPT;
        });
        const started = await vaultAi.startEdit(assetId, {
            instruction: 'เพิ่มกล่องอีกลูก',
            target: 'local',
        });
        const job = await waitForJob(started.jobId);
        assert.strictEqual(job.status, 'done', `expected done after heal, got ${job.status}: ${job.error || ''}`);
        assert.strictEqual(job.attempt, 2);
    } else {
        console.log('SKIP test 5 (Blender not found at ' + vault.BLENDER_BIN + ')');
    }

    // 6) mock returns unsafe script every attempt -> status error & no new version
    {
        const isolatedAsset = await vault.createAsset({
            name: 'Unsafe Test Asset',
            model: { dataUrl: toDataUrl(makeMinimalGlb(1, 1, 1)), filename: 'unsafe.glb' },
        });
        vaultAi.setLlmRunner(async () => '```python\nimport subprocess\nsubprocess.run(["echo", "bad"])\n```');
        const started = await vaultAi.startEdit(isolatedAsset.id, {
            instruction: 'รันคำสั่งอันตราย',
            target: 'local',
        });
        const job = await waitForJob(started.jobId);
        assert.strictEqual(job.status, 'error');

        const after = await vault.getAsset(isolatedAsset.id);
        assert.strictEqual(after.versions.length, 1, 'no new version should be created when unsafe');
    }

    // 6b) extended unsafe-script blocklist
    {
        const blocked = [
            'import os\nos.popen("ls")',
            'from shutil import rmtree\nrmtree("/x")',
            'import importlib\nimportlib.import_module("x")',
            'import ctypes',
            'import os\nos.unlink("/x")',
            'import os\ngetattr(os, "sys" + "tem")("x")',
            'import http.client',
            'compile("1", "f", "exec")',
            'x = __builtins__',
        ];
        for (const code of blocked) {
            assert.strictEqual(vaultAi.checkScriptSafety(code).ok, false, 'should block: ' + code);
        }
        const allowed = [
            'import bpy, os\np = os.path.join("a", "b")',
            'import os\nos.makedirs("d", exist_ok=True)\nprint(os.getcwd(), os.environ.get("X"))',
            'import bpy\nbpy.ops.mesh.primitive_cube_add()',
            'import re\nr = re.compile("a")',
        ];
        for (const code of allowed) {
            assert.strictEqual(vaultAi.checkScriptSafety(code).ok, true, 'should allow: ' + code);
        }
    }

    // 7) HTTP: GET /api/3d-vault/ai/status -> 200, POST edit with empty instruction -> 400
    {
        const readJsonBody = (req) => new Promise((resolve, reject) => {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                if (!raw.trim()) return resolve({});
                try {
                    resolve(JSON.parse(raw));
                } catch (e) {
                    e.statusCode = 400;
                    reject(e);
                }
            });
        });
        const sendJson = (res, code, obj) => {
            res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(obj));
        };

        const server = http.createServer(async (req, res) => {
            const url = new URL(req.url, 'http://127.0.0.1');
            const handled = await vault.handleRequest(req, res, url, {
                readJsonBody,
                sendJson,
                serveStatic: () => {},
            });
            if (!handled) {
                sendJson(res, 404, { error: 'not found' });
            }
        });

        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address();
        try {
            const statusRes = await httpReq(port, 'GET', '/api/3d-vault/ai/status');
            assert.strictEqual(statusRes.status, 200);
            const statusJson = JSON.parse(statusRes.body.toString('utf8'));
            assert.strictEqual(typeof statusJson.blenderLocal, 'boolean');

            const emptyEditRes = await httpReq(port, 'POST', `/api/3d-vault/ai/assets/${assetId}/edit`, {
                instruction: '   ',
            });
            assert.strictEqual(emptyEditRes.status, 400);
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    }

    console.log('asset-vault-ai tests OK');
}

runTests()
    .then(async () => {
        await fsp.rm(tmp, { recursive: true, force: true });
    })
    .catch(async (err) => {
        console.error(err);
        await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
        process.exit(1);
    });
