'use strict';

/**
 * asset-vault-ai.js
 * -----------------------------------------------------------------------------
 * AI Co-Pilot Backend for 3D Asset Vault (Phase 1 + Phase 2 + Phase 3)
 * - LLM one-shot bpy script generation via cross-team-orchestrator + ai-router
 * - Static Python safety checker (blocks subprocess/socket/os.system/eval/exec)
 * - Local Blender execution under withBlenderLock + cancellable child process
 * - Worker Blender execution via agent-hub-manager + Browser Vision live-session + local fallback
 * - Self-heal retry loop (up to 2 heal rounds, max 3 attempts total)
 * - Automatic addVersion() on verified GLB output
 * - Per-asset chat history stored outside asset dir (VAULT_DIR/ai-chat/<id>.json)
 * - Job state persisted to VAULT_DIR/ai-jobs/<jobId>.json
 * - Phase 3: suggestIdeas (3 Thai ideas), startTurntable (360° 36-frame MP4/GIF/PNG + cache + Range stream)
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const MAX_INSTRUCTION_LEN = 2000;
const MAX_CHAT_MESSAGES = 200;
const MAX_ATTEMPTS = 3; // 1 initial + up to 2 self-heal rounds
const BLENDER_EDIT_TIMEOUT_MS = 240_000;
const MAX_LOG_LINES = 200;
const MAX_STDERR_FOR_HEAL = 3000;

// In-memory job registry and concurrency locks
const _jobs = new Map();
const _activeAssetJobs = new Map(); // assetId -> jobId
const _chatWriteChains = new Map(); // assetId -> Promise

let customLlmRunner = null;
let workerRunner = null;

// ── Lazy vault accessor & runtime paths ──────────────────────────────────────

function getVault() {
    return require('./asset-vault-manager');
}

function getAiChatDir() {
    return path.join(getVault().VAULT_DIR, 'ai-chat');
}

function getAiJobsDir() {
    return path.join(getVault().VAULT_DIR, 'ai-jobs');
}

function getWorkRoot() {
    return path.join(getVault().OUTPUTS_3D_DIR, 'ai-edits');
}

function getTurntablesDir() {
    return path.join(getVault().OUTPUTS_3D_DIR, 'turntables');
}

// ── Dependency injection hooks ───────────────────────────────────────────────

function setLlmRunner(fn) {
    customLlmRunner = typeof fn === 'function' ? fn : null;
}

function setWorkerRunner(fn) {
    workerRunner = typeof fn === 'function' ? fn : null;
}

// ── Atomic file & chat helpers ───────────────────────────────────────────────

async function writeJsonAtomic(filePath, data) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
    const payload = JSON.stringify(data, null, 2);
    await fsp.writeFile(tmpPath, payload, 'utf8');
    await fsp.rename(tmpPath, filePath);
}

function withChatLock(id, fn) {
    const prev = _chatWriteChains.get(id) || Promise.resolve();
    const run = prev.then(() => fn(), () => fn());
    const settled = run.catch(() => {});
    _chatWriteChains.set(id, settled);
    settled.finally(() => {
        if (_chatWriteChains.get(id) === settled) {
            _chatWriteChains.delete(id);
        }
    });
    return run;
}

function getChatFilePath(id) {
    getVault().assertValidAssetId(id);
    return path.join(getAiChatDir(), `${id}.json`);
}

function isValidJobId(jobId) {
    return typeof jobId === 'string' && /^[a-z0-9][a-z0-9_-]{3,79}$/i.test(jobId);
}

function getJobFilePath(jobId) {
    if (!isValidJobId(jobId)) {
        throw getVault().makeError('รหัส job ไม่ถูกต้อง', 400);
    }
    return path.join(getAiJobsDir(), `${jobId}.json`);
}

async function getChat(id) {
    const filePath = getChatFilePath(id);
    try {
        const raw = await fsp.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        const messages = Array.isArray(parsed && parsed.messages) ? parsed.messages : [];
        return { messages };
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            return { messages: [] };
        }
        throw err;
    }
}

async function clearChat(id) {
    const filePath = getChatFilePath(id);
    return withChatLock(id, async () => {
        await writeJsonAtomic(filePath, { assetId: id, updatedAt: new Date().toISOString(), messages: [] });
        return { ok: true, messages: [] };
    });
}

async function appendChat(id, msg) {
    const filePath = getChatFilePath(id);
    return withChatLock(id, async () => {
        let messages = [];
        try {
            const raw = await fsp.readFile(filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed && parsed.messages)) {
                messages = parsed.messages;
            }
        } catch (err) {
            if (!err || err.code !== 'ENOENT') throw err;
        }
        const entry = {
            role: (msg && ['user', 'ai', 'system'].includes(msg.role)) ? msg.role : 'system',
            text: String((msg && msg.text) || ''),
            ts: (msg && msg.ts) || new Date().toISOString(),
        };
        if (msg && msg.v !== undefined && msg.v !== null) entry.v = msg.v;
        if (msg && msg.jobId) entry.jobId = msg.jobId;
        if (msg && msg.error !== undefined) entry.error = Boolean(msg.error);
        if (msg && msg.fromVersion !== undefined && msg.fromVersion !== null) entry.fromVersion = msg.fromVersion;
        if (msg && msg.attempts !== undefined && msg.attempts !== null) entry.attempts = msg.attempts;

        messages.push(entry);
        if (messages.length > MAX_CHAT_MESSAGES) {
            messages = messages.slice(-MAX_CHAT_MESSAGES);
        }
        await writeJsonAtomic(filePath, {
            assetId: id,
            updatedAt: new Date().toISOString(),
            messages,
        });
        return entry;
    });
}

// ── Python extraction & static safety check ──────────────────────────────────

function extractPython(text) {
    const raw = String(text || '');
    const pyFence = raw.match(/```(?:python|py)[ \t]*\r?\n([\s\S]*?)```/i);
    if (pyFence && pyFence[1] !== undefined) {
        return pyFence[1].trim();
    }
    const genericFence = raw.match(/```[ \t]*\r?\n([\s\S]*?)```/);
    if (genericFence && genericFence[1] !== undefined) {
        return genericFence[1].trim();
    }
    return raw.trim();
}

const UNSAFE_PY_REGEX = new RegExp([
    String.raw`\b(subprocess|socket|urllib3?|requests|shutil|importlib|ctypes|pty|ftplib|telnetlib|__import__|__builtins__)\b`,
    String.raw`\bhttp\.client\b`,
    String.raw`\bos\.(system|popen|exec\w*|spawn\w*|fork\w*|kill\w*|unlink|rmdir|removedirs|remove)\b`,
    String.raw`\bgetattr\s*\(\s*os\b`,
    String.raw`(?<![\w.])(eval|exec|compile)\s*\(`,
].join('|'));

function checkScriptSafety(code) {
    const src = String(code || '').trim();
    if (!src) {
        return { ok: false, reason: 'สคริปต์ Python ว่างเปล่า' };
    }
    const m = src.match(UNSAFE_PY_REGEX);
    if (m) {
        return {
            ok: false,
            reason: `ตรวจพบคำสั่งต้องห้ามเพื่อความปลอดภัย: ${m[0].trim()}`,
        };
    }
    return { ok: true, reason: null };
}

// ── Prompt builder ───────────────────────────────────────────────────────────

function buildEditPrompt({
    instruction,
    meta = {},
    baseVersion = 1,
    stats = null,
    sourcePy = '',
    chatTail = [],
    prevError = '',
    prevScript = '',
} = {}) {
    const lines = [];
    lines.push('You are an expert Blender Python (bpy) 3D modeling & technical artist.');
    lines.push('Write a complete, standalone Blender Python script to modify an existing 3D GLB asset according to the user instruction.');
    lines.push('');
    lines.push('## Asset Context');
    lines.push(`- Asset ID: ${meta.id || 'unknown'}`);
    lines.push(`- Name: ${meta.name || 'untitled'}`);
    if (meta.category) lines.push(`- Category: ${meta.category}`);
    if (meta.description) lines.push(`- Description: ${String(meta.description).slice(0, 400)}`);
    lines.push(`- Base Version: v${baseVersion}`);
    if (meta.dimensions) {
        lines.push(`- Dimensions (m): ${JSON.stringify(meta.dimensions)}`);
    }
    if (stats && Object.keys(stats).length) {
        lines.push(`- Geometry Stats: ${JSON.stringify(stats)}`);
    }

    if (Array.isArray(chatTail) && chatTail.length) {
        lines.push('');
        lines.push('## Recent Edit History');
        for (const msg of chatTail.slice(-6)) {
            const role = msg.role || 'user';
            const snippet = String(msg.text || '').replace(/\s+/g, ' ').slice(0, 220);
            lines.push(`- [${role}]: ${snippet}`);
        }
    }

    if (sourcePy && String(sourcePy).trim()) {
        lines.push('');
        lines.push('## Reference source.py from Base Version (truncated)');
        lines.push('```python');
        lines.push(String(sourcePy).slice(0, 6000));
        lines.push('```');
    }

    lines.push('');
    lines.push('## User Instruction');
    lines.push(String(instruction || '').trim());

    if (prevError) {
        lines.push('');
        lines.push('## Previous Attempt Failed — Fix Required');
        lines.push('The previous script failed with the following error/stderr. Diagnose the exact root cause and produce a fixed complete script:');
        lines.push('```text');
        lines.push(String(prevError).slice(-MAX_STDERR_FOR_HEAL));
        lines.push('```');
        if (prevScript) {
            lines.push('Previous script:');
            lines.push('```python');
            lines.push(String(prevScript).slice(0, 8000));
            lines.push('```');
        }
    }

    lines.push('');
    lines.push('## Mandatory Execution Contract');
    lines.push('1. The script is invoked headlessly as:');
    lines.push('   `blender -b --factory-startup --python script.py -- <IN_GLB> <OUT_GLB> <OUT_PNG>`');
    lines.push('2. Parse CLI arguments after `--`:');
    lines.push('   ```python');
    lines.push("   argv = sys.argv[sys.argv.index('--') + 1:]");
    lines.push('   in_glb, out_glb, out_png = argv[0], argv[1], argv[2]');
    lines.push('   ```');
    lines.push('3. Add optional live-session helper guards near the top of the script:');
    lines.push('   ```python');
    lines.push('   try:');
    lines.push('       live_progress');
    lines.push('   except NameError:');
    lines.push('       live_progress = lambda *a, **k: None');
    lines.push('   try:');
    lines.push('       live_snapshot');
    lines.push('   except NameError:');
    lines.push('       live_snapshot = lambda *a, **k: None');
    lines.push('   ```');
    lines.push('4. Start from an empty scene (`bpy.ops.wm.read_factory_settings(use_empty=True)`), then import `in_glb` via `bpy.ops.import_scene.gltf(filepath=in_glb)`.');
    lines.push('5. Apply the requested edits cleanly, preserving existing parts/materials unless explicitly asked to change or remove them. Ensure mesh normals, transforms, and PBR materials are valid.');
    lines.push('6. Export the modified scene to `out_glb` using `bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB")` BEFORE rendering preview.');
    lines.push('7. Render a clean 1024x768 preview PNG to `out_png` (auto-frame all mesh objects with a camera + neutral lighting; handle both Blender 3.x and 4.x engine names safely by checking available render engines or using `BLENDER_EEVEE_NEXT` / `BLENDER_EEVEE` / `CYCLES` with CPU fallback). Wrap preview rendering in try/except so the GLB export is never lost.');
    lines.push('8. Call `live_progress(pct, msg)` and `live_snapshot(label)` at key milestones.');
    lines.push('9. STRICT SECURITY: NEVER import or call `subprocess`, `socket`, `urllib`, `requests`, `shutil.rmtree`, `os.system`, `os.remove`, `__import__`, `eval()`, or `exec()`. NEVER perform network access or write files outside `out_glb`, `out_png`, and the current working directory.');
    lines.push('10. OUTPUT FORMAT: Return ONLY a single ```python ... ``` code block with the complete runnable script. No prose outside the code block.');

    return lines.join('\n');
}

// ── LLM Runner ───────────────────────────────────────────────────────────────

async function defaultLlmRunner(prompt, opts = {}) {
    const ct = require('./cross-team-orchestrator');
    const aiRouter = require('./ai-router');
    const candidates = await aiRouter.buildWorkerCandidates('neon', { qType: 'code' });
    const res = await ct.runWithFailover(candidates, {
        stageName: opts.stageName || 'vault-ai',
        prompt,
        cwd: '/home/dev/projects',
        readOnly: true,
        mode: 'plan',
        timeoutMs: opts.timeoutMs || 240000,
        idleMs: opts.idleMs || 120000,
        rolePrefix: '🧊 Vault-AI',
        decision: {},
        originalPrompt: opts.instruction || String(prompt || '').slice(0, 200),
        onThoughtEvent: opts.onThoughtEvent || (() => {}),
        abortCtx: opts.abortCtx || { aborted: false },
        claimedBrains: new Set(),
    });
    if (!res || !res.ok) {
        throw getVault().makeError((res && res.error) || 'LLM ไม่สามารถสร้างสคริปต์ได้', 502);
    }
    return String(res.output || '');
}

async function runLlm(prompt, opts = {}) {
    if (customLlmRunner) {
        return String(await customLlmRunner(prompt, opts));
    }
    return defaultLlmRunner(prompt, opts);
}

// ── Job state & persistence ──────────────────────────────────────────────────

function pushJobLog(job, text) {
    if (!job || !text) return;
    const rawLines = String(text).split(/\r?\n/);
    for (const line of rawLines) {
        const trimmed = line.trimEnd();
        if (!trimmed) continue;
        job.log.push(trimmed.slice(0, 500));
    }
    if (job.log.length > MAX_LOG_LINES) {
        job.log = job.log.slice(-MAX_LOG_LINES);
    }
}

function sanitizeJob(job) {
    if (!job) return null;
    return {
        jobId: job.jobId,
        kind: job.kind || 'edit',
        assetId: job.assetId,
        instruction: job.instruction || '',
        fromVersion: job.fromVersion,
        target: job.target,
        effectiveTarget: job.effectiveTarget,
        liveSession: job.liveSession || null,
        status: job.status,
        progress: job.progress,
        message: job.message,
        attempt: job.attempt,
        maxAttempts: job.maxAttempts,
        newVersion: job.newVersion || null,
        outputUrl: job.outputUrl || null,
        monitorUrl: job.monitorUrl || null,
        workerNodeId: job.workerNodeId || null,
        cached: Boolean(job.cached),
        error: job.error || null,
        log: Array.isArray(job.log) ? job.log.slice(-MAX_LOG_LINES) : [],
        workerJobId: job.workerJobId || null,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        finishedAt: job.finishedAt || null,
        durationMs: job.durationMs || 0,
    };
}

async function persistJob(job) {
    job.updatedAt = new Date().toISOString();
    try {
        await writeJsonAtomic(getJobFilePath(job.jobId), sanitizeJob(job));
    } catch (_) {
        // Non-fatal persistence error
    }
}

async function getJob(jobId) {
    if (!isValidJobId(jobId)) {
        return null;
    }
    const mem = _jobs.get(jobId);
    if (mem) {
        return sanitizeJob(mem);
    }
    try {
        const raw = await fsp.readFile(getJobFilePath(jobId), 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        if (err && err.code === 'ENOENT') return null;
        throw err;
    }
}

async function cancelJob(jobId) {
    const vault = getVault();
    if (!isValidJobId(jobId)) {
        throw vault.makeError('รหัส job ไม่ถูกต้อง', 400);
    }
    const job = _jobs.get(jobId);
    if (!job) {
        const persisted = await getJob(jobId);
        if (!persisted) {
            throw vault.makeError(`ไม่พบงาน AI '${jobId}'`, 404);
        }
        return persisted;
    }
    if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
        return sanitizeJob(job);
    }

    job._cancelled = true;
    if (job._abortCtx) {
        job._abortCtx.aborted = true;
    }
    if (job._child && !job._child.killed) {
        const child = job._child;
        try {
            child.kill('SIGTERM');
        } catch (_) {}
        setTimeout(() => {
            try {
                if (child.exitCode === null && !child.killed) {
                    child.kill('SIGKILL');
                }
            } catch (_) {}
        }, 2000).unref();
    }

    job.status = 'cancelled';
    job.message = 'ยกเลิกงานโดยผู้ใช้';
    job.finishedAt = new Date().toISOString();
    job.durationMs = Math.max(0, Date.now() - (job._startedAt || Date.now()));
    pushJobLog(job, '[cancel] ยกเลิกงานโดยผู้ใช้');
    if (_activeAssetJobs.get(job.assetId) === job.jobId) {
        _activeAssetJobs.delete(job.assetId);
    }
    if (job._lockKey && _activeAssetJobs.get(job._lockKey) === job.jobId) {
        _activeAssetJobs.delete(job._lockKey);
    }
    await persistJob(job);
    return sanitizeJob(job);
}

// ── Local Blender Runner ─────────────────────────────────────────────────────

// Pure-Python GLB import/export shim for headless Blender builds lacking numpy
const PY_GLTF_SHIM = `
import os, sys, json, struct, base64, bpy
from bpy.props import StringProperty, BoolProperty
from mathutils import Matrix, Vector, Quaternion

def _has_numpy():
    try:
        import numpy  # noqa: F401
        return True
    except Exception:
        return False

def _load_gltf_pure(src_path):
    ext = os.path.splitext(src_path)[1].lower()
    if ext == ".glb":
        with open(src_path, "rb") as f:
            raw = f.read()
        if len(raw) < 20 or raw[:4] != b"glTF":
            raise ValueError("Invalid GLB magic header")
        json_len, json_type = struct.unpack_from("<II", raw, 12)
        if json_type != 0x4E4F534A:
            raise ValueError("Missing GLB JSON chunk")
        gltf = json.loads(raw[20:20 + json_len].decode("utf-8").rstrip("\\x00"))
        bin_chunk = b""
        off = 20 + json_len
        if off + 8 <= len(raw):
            bin_len, bin_type = struct.unpack_from("<II", raw, off)
            if bin_type == 0x004E4942:
                bin_chunk = raw[off + 8:off + 8 + bin_len]
        buffers = [bin_chunk]
    else:
        with open(src_path, "r", encoding="utf-8") as f:
            gltf = json.load(f)
        base_dir = os.path.dirname(src_path)
        buffers = []
        for b in gltf.get("buffers", []):
            uri = b.get("uri", "")
            if uri.startswith("data:"):
                buffers.append(base64.b64decode(uri.split(",", 1)[1]))
            elif uri:
                with open(os.path.join(base_dir, uri), "rb") as bf:
                    buffers.append(bf.read())
            else:
                buffers.append(b"")

    bvs = gltf.get("bufferViews", [])
    accs = gltf.get("accessors", [])
    meshes = gltf.get("meshes", [])
    nodes = gltf.get("nodes", [])
    comp_fmt = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
    type_cnt = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}

    def read_acc(idx):
        acc = accs[idx]
        bv = bvs[acc["bufferView"]]
        buf = buffers[bv.get("buffer", 0)]
        fmt_ch, comp_sz = comp_fmt[acc["componentType"]]
        n_comp = type_cnt[acc["type"]]
        count = acc["count"]
        stride = bv.get("byteStride") or (comp_sz * n_comp)
        base_off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
        fmt = "<" + (fmt_ch * n_comp)
        out = []
        for i in range(count):
            vals = struct.unpack_from(fmt, buf, base_off + i * stride)
            out.append(vals[0] if n_comp == 1 else vals)
        return out

    def node_local_mat(node):
        if "matrix" in node and len(node["matrix"]) == 16:
            m = node["matrix"]
            return Matrix(((m[0], m[4], m[8], m[12]), (m[1], m[5], m[9], m[13]), (m[2], m[6], m[10], m[14]), (m[3], m[7], m[11], m[15])))
        t = node.get("translation", [0.0, 0.0, 0.0])
        r = node.get("rotation", [0.0, 0.0, 0.0, 1.0])
        s = node.get("scale", [1.0, 1.0, 1.0])
        return Matrix.Translation(Vector((t[0], t[1], t[2]))) @ Quaternion((r[3], r[0], r[1], r[2])).to_matrix().to_4x4() @ Matrix.Diagonal((s[0], s[1], s[2], 1.0))

    yup_to_zup = Matrix(((1.0, 0.0, 0.0, 0.0), (0.0, 0.0, -1.0, 0.0), (0.0, 1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)))

    def add_mesh(mesh_idx, world_mat, obj_name):
        gmesh = meshes[mesh_idx]
        verts, faces, v_base = [], [], 0
        for prim in gmesh.get("primitives", []):
            attrs = prim.get("attributes", {})
            if "POSITION" not in attrs:
                continue
            pos_list = read_acc(attrs["POSITION"])
            for px, py, pz in pos_list:
                v = yup_to_zup @ (world_mat @ Vector((px, py, pz)))
                verts.append((v.x, v.y, v.z))
            mode = prim.get("mode", 4)
            idxs = read_acc(prim["indices"]) if "indices" in prim else list(range(len(pos_list)))
            if mode == 4:
                for i in range(0, len(idxs) - 2, 3):
                    a, b, c = idxs[i] + v_base, idxs[i + 1] + v_base, idxs[i + 2] + v_base
                    if a != b and b != c and c != a:
                        faces.append((a, b, c))
            elif mode == 5:
                for i in range(len(idxs) - 2):
                    tri = (idxs[i] + v_base, idxs[i + 1] + v_base, idxs[i + 2] + v_base) if i % 2 == 0 else (idxs[i] + v_base, idxs[i + 2] + v_base, idxs[i + 1] + v_base)
                    if len(set(tri)) == 3:
                        faces.append(tri)
            elif mode == 6:
                for i in range(1, len(idxs) - 1):
                    tri = (idxs[0] + v_base, idxs[i] + v_base, idxs[i + 1] + v_base)
                    if len(set(tri)) == 3:
                        faces.append(tri)
            v_base += len(pos_list)
        if not verts:
            return
        me = bpy.data.meshes.new(obj_name)
        me.from_pydata(verts, [], faces)
        me.update()
        ob = bpy.data.objects.new(obj_name, me)
        bpy.context.scene.collection.objects.link(ob)

    def walk(node_idx, parent_mat, depth=0):
        if depth > 64:
            return
        node = nodes[node_idx]
        wmat = parent_mat @ node_local_mat(node)
        if "mesh" in node:
            add_mesh(node["mesh"], wmat, node.get("name") or f"Mesh_{node_idx}")
        for ch in node.get("children", []):
            walk(ch, wmat, depth + 1)

    scenes = gltf.get("scenes", [])
    s_idx = gltf.get("scene", 0)
    if scenes and 0 <= s_idx < len(scenes) and scenes[s_idx].get("nodes"):
        for root in scenes[s_idx]["nodes"]:
            walk(root, Matrix.Identity(4))
    elif nodes:
        child_set = {c for n in nodes for c in n.get("children", [])}
        for i in range(len(nodes)):
            if i not in child_set:
                walk(i, Matrix.Identity(4))
    else:
        for i in range(len(meshes)):
            add_mesh(i, Matrix.Identity(4), f"Mesh_{i}")

def _export_glb_pure(dst_path):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    zup_to_yup = Matrix(((1.0, 0.0, 0.0, 0.0), (0.0, 0.0, 1.0, 0.0), (0.0, -1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)))
    bin_chunks = bytearray()
    buffer_views, accessors, g_meshes, g_nodes, g_materials = [], [], [], [], []
    mat_map = {}

    def align4():
        rem = len(bin_chunks) % 4
        if rem:
            bin_chunks.extend(b"\\x00" * (4 - rem))

    def get_mat_idx(bmat):
        if not bmat:
            return None
        key = bmat.name
        if key in mat_map:
            return mat_map[key]
        color, metallic, roughness = [0.8, 0.8, 0.8, 1.0], 0.0, 0.6
        if bmat.use_nodes and bmat.node_tree:
            for nd in bmat.node_tree.nodes:
                if nd.type == "BSDF_PRINCIPLED":
                    bc = nd.inputs.get("Base Color")
                    if bc: color = [float(bc.default_value[0]), float(bc.default_value[1]), float(bc.default_value[2]), float(bc.default_value[3])]
                    mt = nd.inputs.get("Metallic")
                    if mt: metallic = float(mt.default_value)
                    rg = nd.inputs.get("Roughness")
                    if rg: roughness = float(rg.default_value)
                    break
        else:
            dc = bmat.diffuse_color
            color = [float(dc[0]), float(dc[1]), float(dc[2]), float(dc[3])]
        idx = len(g_materials)
        g_materials.append({"name": bmat.name, "pbrMetallicRoughness": {"baseColorFactor": color, "metallicFactor": metallic, "roughnessFactor": roughness}})
        mat_map[key] = idx
        return idx

    for ob in bpy.context.scene.objects:
        if ob.type != "MESH":
            continue
        eval_ob = ob.evaluated_get(depsgraph)
        me = eval_ob.to_mesh()
        try:
            me.calc_loop_triangles()
            if not me.loop_triangles:
                continue
            wmat = zup_to_yup @ ob.matrix_world
            nmat = wmat.to_3x3().inverted_safe().transposed()
            pos_bytes, nrm_bytes, idx_bytes = bytearray(), bytearray(), bytearray()
            vmin, vmax = [float("inf")] * 3, [float("-inf")] * 3
            v_count = 0
            for tri in me.loop_triangles:
                for loop_idx in tri.loops:
                    loop = me.loops[loop_idx]
                    co = wmat @ me.vertices[loop.vertex_index].co
                    no = (nmat @ me.vertices[loop.vertex_index].normal).normalized()
                    x, y, z = float(co.x), float(co.y), float(co.z)
                    if x < vmin[0]: vmin[0] = x
                    if y < vmin[1]: vmin[1] = y
                    if z < vmin[2]: vmin[2] = z
                    if x > vmax[0]: vmax[0] = x
                    if y > vmax[1]: vmax[1] = y
                    if z > vmax[2]: vmax[2] = z
                    pos_bytes.extend(struct.pack("<fff", x, y, z))
                    nrm_bytes.extend(struct.pack("<fff", float(no.x), float(no.y), float(no.z)))
                    idx_bytes.extend(struct.pack("<I", v_count))
                    v_count += 1
            if v_count == 0:
                continue
            align4()
            pos_off = len(bin_chunks); bin_chunks.extend(pos_bytes)
            pos_bv = len(buffer_views); buffer_views.append({"buffer": 0, "byteOffset": pos_off, "byteLength": len(pos_bytes), "target": 34962})
            pos_acc = len(accessors); accessors.append({"bufferView": pos_bv, "componentType": 5126, "count": v_count, "type": "VEC3", "min": vmin, "max": vmax})
            align4()
            nrm_off = len(bin_chunks); bin_chunks.extend(nrm_bytes)
            nrm_bv = len(buffer_views); buffer_views.append({"buffer": 0, "byteOffset": nrm_off, "byteLength": len(nrm_bytes), "target": 34962})
            nrm_acc = len(accessors); accessors.append({"bufferView": nrm_bv, "componentType": 5126, "count": v_count, "type": "VEC3"})
            align4()
            idx_off = len(bin_chunks); bin_chunks.extend(idx_bytes)
            idx_bv = len(buffer_views); buffer_views.append({"buffer": 0, "byteOffset": idx_off, "byteLength": len(idx_bytes), "target": 34963})
            idx_acc = len(accessors); accessors.append({"bufferView": idx_bv, "componentType": 5125, "count": v_count, "type": "SCALAR"})
            prim = {"attributes": {"POSITION": pos_acc, "NORMAL": nrm_acc}, "indices": idx_acc, "mode": 4}
            if ob.data.materials:
                mi = get_mat_idx(ob.data.materials[0])
                if mi is not None:
                    prim["material"] = mi
            mesh_idx = len(g_meshes)
            g_meshes.append({"name": ob.name, "primitives": [prim]})
            g_nodes.append({"name": ob.name, "mesh": mesh_idx})
        finally:
            eval_ob.to_mesh_clear()

    align4()
    gltf = {
        "asset": {"version": "2.0", "generator": "3D Asset Vault AI Shim"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(g_nodes)))}],
        "nodes": g_nodes,
        "meshes": g_meshes,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(bin_chunks)}],
    }
    if g_materials:
        gltf["materials"] = g_materials
    json_bytes = bytearray(json.dumps(gltf, separators=(",", ":")).encode("utf-8"))
    while len(json_bytes) % 4 != 0:
        json_bytes.append(0x20)
    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_chunks)
    with open(dst_path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total_len))
        f.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
        f.write(json_bytes)
        f.write(struct.pack("<II", len(bin_chunks), 0x004E4942))
        f.write(bin_chunks)

if not _has_numpy():
    class VAULT_OT_import_gltf_fallback(bpy.types.Operator):
        bl_idname = "import_scene.gltf"
        bl_label = "Import glTF (Pure Python Fallback)"
        filepath: StringProperty(default="")
        def execute(self, context):
            _load_gltf_pure(self.filepath)
            return {"FINISHED"}

    class VAULT_OT_export_gltf_fallback(bpy.types.Operator):
        bl_idname = "export_scene.gltf"
        bl_label = "Export glTF (Pure Python Fallback)"
        filepath: StringProperty(default="")
        export_format: StringProperty(default="GLB")
        use_selection: BoolProperty(default=False)
        export_apply: BoolProperty(default=True)
        def execute(self, context):
            _export_glb_pure(self.filepath)
            return {"FINISHED"}

    def _register_vault_gltf_shims(*_args):
        for cls in (VAULT_OT_import_gltf_fallback, VAULT_OT_export_gltf_fallback):
            try:
                bpy.utils.register_class(cls)
            except Exception:
                pass

    _register_vault_gltf_shims()
    if hasattr(bpy.app.handlers, "load_factory_startup_post"):
        bpy.app.handlers.load_factory_startup_post.append(bpy.app.handlers.persistent(_register_vault_gltf_shims))
`;

async function runLocalBlender(scriptPath, inGlb, outGlb, png, job) {
    const vault = getVault();
    return vault.withBlenderLock(async () => {
        if (job && job._cancelled) {
            return { ok: false, cancelled: true, error: 'งานถูกยกเลิก', stdout: '', stderr: '' };
        }
        const workDir = path.dirname(scriptPath);
        const shimPath = path.join(workDir, '_vault_gltf_shim.py');
        await fsp.writeFile(shimPath, PY_GLTF_SHIM, 'utf8');
        const args = [
            '-b', '--factory-startup', '--python-exit-code', '1',
            '--python', shimPath,
            '--python', scriptPath,
            '--', inGlb, outGlb, png,
        ];
        return new Promise((resolve) => {
            const child = execFile(vault.BLENDER_BIN, args, {
                timeout: BLENDER_EDIT_TIMEOUT_MS,
                maxBuffer: 16 * 1024 * 1024,
                cwd: workDir,
            }, (err, stdout, stderr) => {
                if (job && job._child === child) {
                    job._child = null;
                }
                const outStr = String(stdout || '');
                const errStr = String(stderr || '');
                if (job) {
                    if (outStr) pushJobLog(job, outStr.slice(-2000));
                    if (errStr) pushJobLog(job, errStr.slice(-2000));
                }
                if (job && job._cancelled) {
                    return resolve({ ok: false, cancelled: true, error: 'งานถูกยกเลิก', stdout: outStr, stderr: errStr });
                }
                if (err) {
                    const detail = errStr.trim() || outStr.trim() || err.message || 'Blender execution failed';
                    return resolve({
                        ok: false,
                        error: detail,
                        exitCode: err.code,
                        stdout: outStr,
                        stderr: errStr,
                    });
                }
                return resolve({ ok: true, stdout: outStr, stderr: errStr });
            });
            if (job) {
                job._child = child;
            }
        });
    });
}

// ── Main Edit Job Orchestrator (Phase 1 + Phase 2 Self-Heal) ─────────────────

async function startEdit(id, opts = {}) {
    const vault = getVault();
    vault.assertValidAssetId(id);

    const instruction = String(opts.instruction || '').trim();
    if (!instruction) {
        throw vault.makeError('กรุณาระบุคำสั่งปรับแต่ง (instruction)', 400);
    }
    if (instruction.length > MAX_INSTRUCTION_LEN) {
        throw vault.makeError(`คำสั่งปรับแต่งยาวเกิน ${MAX_INSTRUCTION_LEN} ตัวอักษร`, 400);
    }

    const meta = await vault.readMetaRaw(id);
    if (!meta) {
        throw vault.makeError(`ไม่พบ asset '${id}'`, 404);
    }

    const existingJobId = _activeAssetJobs.get(id);
    if (existingJobId) {
        const existingJob = _jobs.get(existingJobId);
        if (existingJob && !['done', 'error', 'cancelled'].includes(existingJob.status)) {
            throw vault.makeError('กำลังมีงาน AI รันอยู่สำหรับโมเดลนี้ กรุณารอให้เสร็จหรือยกเลิกก่อน', 409);
        }
        _activeAssetJobs.delete(id);
    }

    const versions = Array.isArray(meta.versions) ? meta.versions : [];
    if (!versions.length) {
        throw vault.makeError('โมเดลนี้ยังไม่มีเวอร์ชันใดให้ปรับแต่ง', 400);
    }

    let baseVerObj = null;
    if (opts.fromVersion !== undefined && opts.fromVersion !== null && opts.fromVersion !== '') {
        const vNum = parseInt(String(opts.fromVersion).replace(/^v/i, ''), 10);
        baseVerObj = versions.find((item) => Number(item.v) === vNum) || null;
        if (!baseVerObj) {
            throw vault.makeError(`ไม่พบเวอร์ชัน v${opts.fromVersion} ใน asset '${id}'`, 404);
        }
    } else {
        baseVerObj = versions[versions.length - 1];
    }

    const assetDir = vault.getAssetDir(id);
    const modelFile = baseVerObj.files && baseVerObj.files.model;
    if (!modelFile) {
        throw vault.makeError(`เวอร์ชัน v${baseVerObj.v} ไม่มีไฟล์โมเดล GLB`, 400);
    }
    const inGlb = path.join(assetDir, `v${baseVerObj.v}`, modelFile);
    if (!fs.existsSync(inGlb)) {
        throw vault.makeError(`ไม่พบไฟล์โมเดลต้นฉบับของเวอร์ชัน v${baseVerObj.v}`, 404);
    }

    const rawTarget = String(opts.target || 'auto').trim().toLowerCase();
    const target = ['local', 'worker', 'auto'].includes(rawTarget) ? rawTarget : 'auto';
    const liveSession = opts.liveSession ? String(opts.liveSession).trim().slice(0, 128) : null;

    const jobId = `vai_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const nowIso = new Date().toISOString();
    const job = {
        jobId,
        kind: 'edit',
        assetId: id,
        instruction,
        fromVersion: baseVerObj.v,
        target,
        effectiveTarget: (target === 'worker' || (target === 'auto' && workerRunner)) ? (workerRunner ? 'worker' : 'local') : 'local',
        liveSession,
        status: 'queued',
        progress: 5,
        message: 'เตรียมเริ่มงาน AI ปรับแต่งโมเดล...',
        attempt: 0,
        maxAttempts: MAX_ATTEMPTS,
        newVersion: null,
        outputUrl: null,
        monitorUrl: null,
        workerNodeId: null,
        cached: false,
        error: null,
        log: [],
        workerJobId: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        finishedAt: null,
        durationMs: 0,
        _startedAt: Date.now(),
        _cancelled: false,
        _child: null,
        _abortCtx: { aborted: false },
    };

    _jobs.set(jobId, job);
    _activeAssetJobs.set(id, jobId);
    await persistJob(job);

    await appendChat(id, {
        role: 'user',
        text: instruction,
        jobId,
        fromVersion: baseVerObj.v,
    });

    // Launch background async pipeline
    runEditJob(job, meta, baseVerObj, inGlb).catch(async (err) => {
        job.status = 'error';
        job.error = err ? err.message : String(err);
        job.message = `เกิดข้อผิดพลาดไม่คาดคิด: ${job.error}`;
        job.finishedAt = new Date().toISOString();
        job.durationMs = Math.max(0, Date.now() - job._startedAt);
        pushJobLog(job, `[fatal] ${job.error}`);
        await persistJob(job);
        if (_activeAssetJobs.get(job.assetId) === job.jobId) {
            _activeAssetJobs.delete(job.assetId);
        }
    });

    return { jobId, job: sanitizeJob(job) };
}

async function runEditJob(job, meta, baseVerObj, inGlb) {
    const vault = getVault();
    const assetDir = vault.getAssetDir(job.assetId);
    const workDir = path.join(getWorkRoot(), job.jobId);
    await fsp.mkdir(workDir, { recursive: true });

    let sourcePy = '';
    if (baseVerObj.files && baseVerObj.files.source) {
        try {
            sourcePy = await fsp.readFile(path.join(assetDir, `v${baseVerObj.v}`, baseVerObj.files.source), 'utf8');
        } catch (_) {}
    }

    let chatTail = [];
    try {
        const chatData = await getChat(job.assetId);
        chatTail = (chatData.messages || []).slice(-10);
    } catch (_) {}

    let prevError = '';
    let prevScript = '';
    let lastError = 'ไม่สามารถสร้างโมเดลที่ถูกต้องได้';

    try {
        for (let attempt = 1; attempt <= job.maxAttempts; attempt++) {
            if (job._cancelled) return;

            job.attempt = attempt;
            job.status = attempt === 1 ? 'generating' : 'healing';
            job.progress = attempt === 1 ? 15 : Math.min(20 + attempt * 15, 65);
            job.message = attempt === 1
                ? 'กำลังให้ AI เขียนสคริปต์ Blender (bpy)...'
                : `กำลังให้ AI แก้ไขสคริปต์อัตโนมัติ (รอบที่ ${attempt}/${job.maxAttempts})...`;
            pushJobLog(job, `[attempt ${attempt}/${job.maxAttempts}] ${job.message}`);
            await persistJob(job);

            const prompt = buildEditPrompt({
                instruction: job.instruction,
                meta,
                baseVersion: baseVerObj.v,
                stats: baseVerObj.stats || null,
                sourcePy,
                chatTail,
                prevError,
                prevScript,
            });

            let rawLlmOutput = '';
            try {
                rawLlmOutput = await runLlm(prompt, {
                    stageName: attempt === 1 ? 'vault-ai-edit' : `vault-ai-heal-${attempt}`,
                    instruction: job.instruction,
                    abortCtx: job._abortCtx,
                    onThoughtEvent: (_type, msg) => {
                        if (msg) pushJobLog(job, `[llm] ${msg}`);
                    },
                });
            } catch (llmErr) {
                if (job._cancelled) return;
                lastError = (llmErr && llmErr.message) || String(llmErr);
                prevError = `LLM generation error: ${lastError}`;
                pushJobLog(job, `[llm-error] ${lastError}`);
                continue;
            }

            if (job._cancelled) return;

            const code = extractPython(rawLlmOutput);
            const safety = checkScriptSafety(code);
            if (!safety.ok) {
                lastError = safety.reason;
                prevError = `Static security check rejected script: ${safety.reason}. Remove any forbidden imports/calls and rewrite safely.`;
                prevScript = code;
                pushJobLog(job, `[security-block] ${safety.reason}`);
                continue;
            }

            const scriptPath = path.join(workDir, `edit_attempt_${attempt}.py`);
            const outGlb = path.join(workDir, `out_attempt_${attempt}.glb`);
            const outPng = path.join(workDir, `preview_attempt_${attempt}.png`);
            await fsp.writeFile(scriptPath, code, 'utf8');

            job.status = 'running';
            job.progress = Math.min(45 + (attempt - 1) * 15, 80);
            job.message = `กำลังรัน Blender (รอบที่ ${attempt}/${job.maxAttempts})...`;
            pushJobLog(job, `[blender] รันสคริปต์ ${path.basename(scriptPath)}`);
            await persistJob(job);

            let runRes = null;
            const wantsWorker = (job.target === 'worker' || job.target === 'auto') && typeof workerRunner === 'function';
            if (wantsWorker) {
                job.effectiveTarget = 'worker';
                try {
                    runRes = await workerRunner({
                        job,
                        scriptPath,
                        scriptCode: code,
                        inGlb,
                        outGlb,
                        outPng,
                        workDir,
                        liveSession: job.liveSession,
                    });
                } catch (wErr) {
                    pushJobLog(job, `[worker-error] ${(wErr && wErr.message) || wErr} — fallback to local`);
                    runRes = { fallbackLocal: true };
                }
            }

            if (!runRes || runRes.fallbackLocal) {
                job.effectiveTarget = 'local';
                runRes = await runLocalBlender(scriptPath, inGlb, outGlb, outPng, job);
            }

            if (job._cancelled || (runRes && runRes.cancelled)) return;

            if (!runRes || !runRes.ok) {
                const rawErr = (runRes && (runRes.stderr || runRes.error || runRes.stdout)) || 'Blender failed';
                lastError = String(rawErr).slice(-MAX_STDERR_FOR_HEAL);
                prevError = lastError;
                prevScript = code;
                pushJobLog(job, `[blender-error] exit=${runRes && runRes.exitCode} ${lastError.slice(-400)}`);
                continue;
            }

            // Verify output GLB exists, non-empty, and valid glTF 2.0
            let glbValid = false;
            let verifyErr = '';
            try {
                const st = await fsp.stat(outGlb);
                if (!st.isFile() || st.size <= 0) {
                    verifyErr = 'ไฟล์ OUT_GLB มีขนาด 0 ไบต์';
                } else {
                    const inspected = await vault.inspectGlb(outGlb);
                    if (!inspected || !inspected.valid) {
                        verifyErr = 'ไฟล์ OUT_GLB ไม่ใช่รูปแบบ glTF binary ที่ถูกต้อง';
                    } else {
                        glbValid = true;
                    }
                }
            } catch (stErr) {
                verifyErr = `ไม่พบไฟล์ผลลัพธ์ OUT_GLB (${stErr && stErr.code ? stErr.code : stErr.message})`;
            }

            if (!glbValid) {
                const tailErr = String((runRes.stderr || '') + '\n' + verifyErr).trim().slice(-MAX_STDERR_FOR_HEAL);
                lastError = verifyErr;
                prevError = tailErr;
                prevScript = code;
                pushJobLog(job, `[verify-error] ${verifyErr}`);
                continue;
            }

            // Success! Save new version into vault
            job.status = 'saving';
            job.progress = 92;
            job.message = 'กำลังบันทึกเวอร์ชันใหม่เข้าคลัง 3D Vault...';
            await persistJob(job);

            const addParams = {
                model: { path: outGlb },
                source: { path: scriptPath },
                note: `🤖 AI: ${job.instruction}`.slice(0, 500),
            };
            try {
                const pst = await fsp.stat(outPng);
                if (pst.isFile() && pst.size > 0) {
                    addParams.preview = { path: outPng };
                }
            } catch (_) {}

            const updatedMeta = await vault.addVersion(job.assetId, addParams);
            const updatedVersions = Array.isArray(updatedMeta && updatedMeta.versions) ? updatedMeta.versions : [];
            const latestVer = updatedVersions.length ? updatedVersions[updatedVersions.length - 1] : null;
            const newV = latestVer ? latestVer.v : null;

            job.newVersion = newV;
            job.status = 'done';
            job.progress = 100;
            job.message = newV ? `สร้างเวอร์ชัน v${newV} สำเร็จ` : 'สร้างเวอร์ชันใหม่สำเร็จ';
            job.finishedAt = new Date().toISOString();
            job.durationMs = Math.max(0, Date.now() - job._startedAt);
            pushJobLog(job, `[done] บันทึกเวอร์ชัน v${newV} เรียบร้อย (${job.durationMs}ms)`);
            await persistJob(job);

            await appendChat(job.assetId, {
                role: 'ai',
                text: `ปรับแต่งสำเร็จ สร้างเวอร์ชัน v${newV} เรียบร้อยแล้ว (${attempt > 1 ? `แก้ไขอัตโนมัติ ${attempt - 1} รอบ` : 'สำเร็จในรอบแรก'})`,
                v: newV,
                jobId: job.jobId,
                attempts: attempt,
            });
            return;
        }

        // Exhausted all attempts
        if (!job._cancelled) {
            job.status = 'error';
            job.error = lastError;
            job.message = `ไม่สามารถปรับแต่งได้หลังลอง ${job.maxAttempts} รอบ`;
            job.finishedAt = new Date().toISOString();
            job.durationMs = Math.max(0, Date.now() - job._startedAt);
            pushJobLog(job, `[failed] ${lastError.slice(-400)}`);
            await persistJob(job);

            await appendChat(job.assetId, {
                role: 'ai',
                text: `ขออภัย ไม่สามารถปรับแต่งโมเดลได้หลังลอง ${job.maxAttempts} รอบ: ${String(lastError).slice(0, 300)}`,
                error: true,
                jobId: job.jobId,
                attempts: job.attempt,
            });
        }
    } finally {
        job._child = null;
        if (_activeAssetJobs.get(job.assetId) === job.jobId) {
            _activeAssetJobs.delete(job.assetId);
        }
    }
}

// ── Status & Phase 3 (Suggest Ideas, 360° Turntable, Worker Runner) ──────────

function resolveAssetVersion(meta, rawV) {
    const vault = getVault();
    const versions = Array.isArray(meta && meta.versions) ? meta.versions : [];
    if (!versions.length) {
        throw vault.makeError('โมเดลนี้ยังไม่มีเวอร์ชันใด', 400);
    }
    if (rawV !== undefined && rawV !== null && rawV !== '') {
        const vNum = parseInt(String(rawV).replace(/^v/i, ''), 10);
        const found = versions.find((item) => Number(item.v) === vNum) || null;
        if (!found) {
            throw vault.makeError(`ไม่พบเวอร์ชัน v${rawV} ใน asset '${meta.id}'`, 404);
        }
        return found;
    }
    return versions[versions.length - 1];
}

function isBlenderCapableNode(n) {
    if (!n || !n.online) return false;
    const caps = (n.specs && Array.isArray(n.specs.capabilities) ? n.specs.capabilities : [])
        .concat(Array.isArray(n.capabilities) ? n.capabilities : []);
    return caps.includes('blender') || caps.includes('blender-3d') || Boolean(n.specs && n.specs.blenderPath);
}

async function getStatus() {
    const vault = getVault();
    const blenderLocal = fs.existsSync(vault.BLENDER_BIN);
    const workerNodes = [];
    const seen = new Set();
    try {
        const hub = require('./agent-hub-manager');
        if (typeof hub.getHubStatus === 'function') {
            const st = await hub.getHubStatus();
            const allNodes = Array.isArray(st && st.nodes) ? st.nodes : [];
            for (const n of allNodes) {
                if (!isBlenderCapableNode(n) || seen.has(n.nodeId)) continue;
                seen.add(n.nodeId);
                workerNodes.push({
                    nodeId: n.nodeId,
                    hostname: (n.specs && n.specs.hostname) || n.nodeId,
                    alias: n.alias || '',
                    hasGpu: Boolean(n.specs && n.specs.hasNvidiaSmi),
                    online: true,
                });
            }
        }
        if (typeof hub.selectBestBlenderNode === 'function') {
            const best = hub.selectBestBlenderNode();
            if (best && !seen.has(best.nodeId)) {
                seen.add(best.nodeId);
                workerNodes.unshift({
                    nodeId: best.nodeId,
                    hostname: (best.specs && best.specs.hostname) || best.nodeId,
                    alias: best.alias || '',
                    hasGpu: Boolean(best.specs && best.specs.hasNvidiaSmi),
                    online: true,
                });
            }
        }
    } catch (_) {
        // Agent Hub unavailable — fall back to empty worker list
    }
    return {
        blenderLocal,
        workerOnline: workerNodes.length > 0,
        workerNodes,
        llm: true,
    };
}

// ── Phase 3.1: Suggest 3 Thai Ideas ──────────────────────────────────────────

function extractFirstJsonObject(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;

    // Strip optional markdown fence first
    const fence = raw.match(/```(?:json)?[ \t]*\r?\n([\s\S]*?)```/i);
    const candidate = fence && fence[1] ? fence[1].trim() : raw;

    // Balanced brace scan for the first complete {...} object
    const start = candidate.indexOf('{');
    if (start >= 0) {
        let depth = 0;
        let inStr = false;
        let escaped = false;
        for (let i = start; i < candidate.length; i++) {
            const ch = candidate[i];
            if (inStr) {
                if (escaped) {
                    escaped = false;
                } else if (ch === '\\') {
                    escaped = true;
                } else if (ch === '"') {
                    inStr = false;
                }
                continue;
            }
            if (ch === '"') {
                inStr = true;
            } else if (ch === '{') {
                depth++;
            } else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    const slice = candidate.slice(start, i + 1);
                    try {
                        return JSON.parse(slice);
                    } catch (_) {
                        break;
                    }
                }
            }
        }
    }

    // Greedy fallback regex
    const m = candidate.match(/\{[\s\S]*\}/);
    if (m) {
        try {
            return JSON.parse(m[0]);
        } catch (_) {
            return null;
        }
    }
    return null;
}

function normalizeDifficulty(val) {
    const s = String(val || '').trim().toLowerCase();
    if (s === 'ง่าย' || s === 'easy' || s === 'low' || s === 'simple') return 'ง่าย';
    if (s === 'ยาก' || s === 'hard' || s === 'high' || s === 'complex') return 'ยาก';
    return 'กลาง';
}

function buildSuggestPrompt({ meta = {}, verObj = {}, sourcePy = '' } = {}) {
    const lines = [];
    lines.push('คุณคือผู้เชี่ยวชาญด้านการออกแบบและปรับแต่งโมเดล 3D ด้วย Blender Python (bpy)');
    lines.push('จากข้อมูลโมเดล 3D ด้านล่าง ให้เสนอไอเดียการปรับแต่ง/ต่อยอดโมเดลที่น่าสนใจและทำได้จริงด้วย bpy เป็นภาษาไทย 3 ข้อพอดี (เรียงจาก ง่าย → กลาง → ยาก)');
    lines.push('');
    lines.push('## Asset Context');
    lines.push(`- Asset ID: ${meta.id || 'unknown'}`);
    lines.push(`- Name: ${meta.name || 'untitled'}`);
    if (meta.category) lines.push(`- Category: ${meta.category}`);
    if (meta.description) lines.push(`- Description: ${String(meta.description).slice(0, 400)}`);
    lines.push(`- Version: v${verObj.v || 1}`);
    if (meta.dimensions) {
        lines.push(`- Dimensions (m): ${JSON.stringify(meta.dimensions)}`);
    }
    if (verObj.stats && Object.keys(verObj.stats).length) {
        lines.push(`- Geometry Stats: ${JSON.stringify(verObj.stats)}`);
    }
    if (sourcePy && String(sourcePy).trim()) {
        lines.push('');
        lines.push('## Reference source.py (truncated)');
        lines.push('```python');
        lines.push(String(sourcePy).slice(0, 4000));
        lines.push('```');
    }
    lines.push('');
    lines.push('## Output Format (STRICT JSON ONLY)');
    lines.push('ตอบกลับเป็น JSON object ก้อนเดียวเท่านั้น ห้ามมีข้อความอธิบายนอก JSON โดยต้องมี ideas 3 ข้อพอดี:');
    lines.push('{"ideas":[{"title":"ชื่อไอเดียสั้นกระชับภาษาไทย","instruction":"คำสั่งปรับแต่งภาษาไทยที่ชัดเจนพร้อมส่งให้ AI เขียนสคริปต์ bpy","difficulty":"ง่าย"},{"title":"...","instruction":"...","difficulty":"กลาง"},{"title":"...","instruction":"...","difficulty":"ยาก"}]}');
    return lines.join('\n');
}

async function suggestIdeas(id, opts = {}) {
    const vault = getVault();
    vault.assertValidAssetId(id);

    const meta = await vault.readMetaRaw(id);
    if (!meta) {
        throw vault.makeError(`ไม่พบ asset '${id}'`, 404);
    }

    const verObj = resolveAssetVersion(meta, opts.v ?? opts.version ?? opts.fromVersion);
    const assetDir = vault.getAssetDir(id);
    let sourcePy = '';
    if (verObj.files && verObj.files.source) {
        try {
            sourcePy = await fsp.readFile(path.join(assetDir, `v${verObj.v}`, verObj.files.source), 'utf8');
        } catch (_) {}
    }

    const prompt = buildSuggestPrompt({ meta, verObj, sourcePy });
    const rawOut = await runLlm(prompt, {
        stageName: 'vault-ai-suggest',
        instruction: `เสนอไอเดียปรับแต่ง 3 ทางสำหรับ ${meta.name || id}`,
        timeoutMs: 120_000,
        idleMs: 60_000,
    });

    const parsed = extractFirstJsonObject(rawOut);
    if (!parsed || !Array.isArray(parsed.ideas)) {
        throw vault.makeError('AI ตอบกลับรูปแบบไอเดียไม่ถูกต้อง (ไม่สามารถ parse JSON ได้)', 502);
    }

    const ideas = parsed.ideas
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
            title: String(item.title || '').trim().slice(0, 120),
            instruction: String(item.instruction || '').trim().slice(0, 800),
            difficulty: normalizeDifficulty(item.difficulty),
        }))
        .filter((item) => item.title && item.instruction)
        .slice(0, 3);

    if (ideas.length !== 3) {
        throw vault.makeError(`AI สร้างไอเดียไม่ครบ 3 ข้อ (ได้ ${ideas.length} ข้อ)`, 502);
    }

    return {
        ok: true,
        assetId: id,
        v: verObj.v,
        ideas,
    };
}

// ── Phase 3.2: 360° Turntable Generator + Range Streaming ────────────────────

const PY_TURNTABLE_SCRIPT = `
import os, sys, math, bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
in_glb = argv[0]
frames_dir = argv[1]
num_frames = int(argv[2]) if len(argv) > 2 else 36

os.makedirs(frames_dir, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=in_glb)

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not meshes:
    raise RuntimeError('No mesh objects found in imported GLB')

# Compute combined world-space bounding box
min_v = Vector((float('inf'), float('inf'), float('inf')))
max_v = Vector((float('-inf'), float('-inf'), float('-inf')))
for ob in meshes:
    for corner in ob.bound_box:
        wc = ob.matrix_world @ Vector(corner)
        min_v.x = min(min_v.x, wc.x)
        min_v.y = min(min_v.y, wc.y)
        min_v.z = min(min_v.z, wc.z)
        max_v.x = max(max_v.x, wc.x)
        max_v.y = max(max_v.y, wc.y)
        max_v.z = max(max_v.z, wc.z)

center = (min_v + max_v) * 0.5
extents = max_v - min_v
radius = max(extents.length * 0.5, 0.25)

scene = bpy.context.scene

# Neutral dark-slate world lighting
world = bpy.data.worlds.new('TurntableWorld')
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
if bg:
    bg.inputs[0].default_value = (0.07, 0.09, 0.13, 1.0)
    bg.inputs[1].default_value = 0.85

# Studio 3-point lighting
def add_light(name, ltype, loc, energy, size=2.0):
    ld = bpy.data.lights.new(name=name, type=ltype)
    ld.energy = energy
    if ltype == 'AREA' and hasattr(ld, 'size'):
        ld.size = size
    lo = bpy.data.objects.new(name=name, object_data=ld)
    scene.collection.objects.link(lo)
    lo.location = loc
    direction = center - lo.location
    lo.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    return lo

add_light('KeyLight', 'AREA', center + Vector((radius * 2.4, -radius * 2.2, radius * 2.4)), energy=max(80.0, radius * radius * 60.0), size=radius * 1.5)
add_light('FillLight', 'AREA', center + Vector((-radius * 2.5, -radius * 1.5, radius * 1.2)), energy=max(35.0, radius * radius * 25.0), size=radius * 2.0)
add_light('RimLight', 'AREA', center + Vector((0.0, radius * 2.8, radius * 2.0)), energy=max(45.0, radius * radius * 35.0), size=radius * 1.5)

# Camera setup
cam_data = bpy.data.cameras.new('TurntableCam')
cam_data.lens = 50.0
cam_data.clip_start = max(0.001, radius * 0.01)
cam_data.clip_end = max(100.0, radius * 50.0)
cam_obj = bpy.data.objects.new('TurntableCam', cam_data)
scene.collection.objects.link(cam_obj)
scene.camera = cam_obj

scene.render.resolution_x = 480
scene.render.resolution_y = 480
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'

dist = radius * 3.1
elev = math.radians(22.0)

def position_camera(idx):
    angle = (2.0 * math.pi * idx) / float(num_frames)
    cx = center.x + dist * math.cos(elev) * math.cos(angle)
    cy = center.y + dist * math.cos(elev) * math.sin(angle)
    cz = center.z + dist * math.sin(elev)
    cam_obj.location = Vector((cx, cy, cz))
    cam_obj.rotation_euler = (center - cam_obj.location).to_track_quat('-Z', 'Y').to_euler()

# Pick best working headless render engine: EEVEE -> Workbench -> Cycles CPU
# On headless Linux without libEGL.so.1, EEVEE/Workbench aborts the process when opening EGL,
# so detect EGL availability first and go straight to Cycles CPU if missing.
def _has_headless_egl():
    if sys.platform != 'linux':
        return True
    try:
        import ctypes.util
        return bool(ctypes.util.find_library('EGL'))
    except Exception:
        return False

if _has_headless_egl():
    engine_candidates = ['BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'BLENDER_WORKBENCH', 'CYCLES']
else:
    engine_candidates = ['CYCLES']
    print('[turntable] libEGL unavailable on headless host -> using CYCLES CPU', flush=True)

chosen_engine = None
first_frame_path = os.path.join(frames_dir, 'frame_0001.png')
position_camera(0)

for eng in engine_candidates:
    try:
        scene.render.engine = eng
        if eng == 'CYCLES':
            scene.cycles.device = 'CPU'
            scene.cycles.samples = 4
            if hasattr(scene.cycles, 'use_adaptive_sampling'):
                scene.cycles.use_adaptive_sampling = False
            if hasattr(scene.cycles, 'use_denoising'):
                scene.cycles.use_denoising = False
            if hasattr(scene.cycles, 'max_bounces'):
                scene.cycles.max_bounces = 2
            if hasattr(scene.cycles, 'diffuse_bounces'):
                scene.cycles.diffuse_bounces = 1
            if hasattr(scene.cycles, 'glossy_bounces'):
                scene.cycles.glossy_bounces = 1
        elif eng == 'BLENDER_WORKBENCH':
            scene.display.shading.light = 'STUDIO'
            scene.display.shading.color_type = 'MATERIAL'
        scene.render.filepath = first_frame_path
        bpy.ops.render.render(write_still=True)
        if os.path.exists(first_frame_path) and os.path.getsize(first_frame_path) > 0:
            chosen_engine = eng
            print(f'[turntable] engine={eng} OK', flush=True)
            break
    except Exception as e:
        print(f'[turntable] engine={eng} unavailable: {e}', flush=True)

if not chosen_engine:
    raise RuntimeError('No usable Blender render engine available for turntable')

for i in range(1, num_frames):
    position_camera(i)
    scene.render.filepath = os.path.join(frames_dir, f'frame_{i + 1:04d}.png')
    bpy.ops.render.render(write_still=True)

print(f'[turntable] rendered {num_frames} frames with {chosen_engine}', flush=True)
`;

function findFfmpegBin() {
    const candidates = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return new Promise((resolve) => {
        execFile('which', ['ffmpeg'], { timeout: 3000 }, (err, stdout) => {
            if (err) return resolve(null);
            const p = String(stdout || '').trim().split(/\r?\n/)[0];
            resolve(p && fs.existsSync(p) ? p : null);
        });
    });
}

function getTurntableCacheCandidates(id, vNum) {
    const dir = getTurntablesDir();
    return [
        { filePath: path.join(dir, `${id}_v${vNum}.mp4`), ext: '.mp4', contentType: 'video/mp4' },
        { filePath: path.join(dir, `${id}_v${vNum}.gif`), ext: '.gif', contentType: 'image/gif' },
        { filePath: path.join(dir, `${id}_v${vNum}.png`), ext: '.png', contentType: 'image/png' },
    ];
}

async function findCachedTurntable(id, vNum, glbMtimeMs = 0) {
    for (const c of getTurntableCacheCandidates(id, vNum)) {
        try {
            const st = await fsp.stat(c.filePath);
            if (st.isFile() && st.size > 0 && (!glbMtimeMs || st.mtimeMs >= glbMtimeMs)) {
                return { ...c, stat: st };
            }
        } catch (_) {}
    }
    return null;
}

async function startTurntable(id, opts = {}) {
    const vault = getVault();
    vault.assertValidAssetId(id);

    const meta = await vault.readMetaRaw(id);
    if (!meta) {
        throw vault.makeError(`ไม่พบ asset '${id}'`, 404);
    }

    const verObj = resolveAssetVersion(meta, opts.v ?? opts.version ?? opts.fromVersion);
    const assetDir = vault.getAssetDir(id);
    const modelFile = verObj.files && verObj.files.model;
    if (!modelFile) {
        throw vault.makeError(`เวอร์ชัน v${verObj.v} ไม่มีไฟล์โมเดล GLB`, 400);
    }
    const inGlb = path.join(assetDir, `v${verObj.v}`, modelFile);
    let glbStat;
    try {
        glbStat = await fsp.stat(inGlb);
    } catch (_) {
        throw vault.makeError(`ไม่พบไฟล์โมเดลต้นฉบับของเวอร์ชัน v${verObj.v}`, 404);
    }

    const outputUrl = `/api/3d-vault/ai/turntable/${encodeURIComponent(id)}/${verObj.v}`;

    // Check fresh cache first (unless force=true)
    if (!opts.force) {
        const cached = await findCachedTurntable(id, verObj.v, glbStat.mtimeMs);
        if (cached) {
            const jobId = `vtt_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
            const nowIso = new Date().toISOString();
            const job = {
                jobId,
                kind: 'turntable',
                assetId: id,
                instruction: `360° Turntable v${verObj.v}`,
                fromVersion: verObj.v,
                target: 'local',
                effectiveTarget: 'local',
                liveSession: null,
                status: 'done',
                progress: 100,
                message: 'โหลดวิดีโอหมุน 360° จากแคชแล้ว',
                attempt: 1,
                maxAttempts: 1,
                newVersion: null,
                outputUrl,
                monitorUrl: null,
                workerNodeId: null,
                cached: true,
                error: null,
                log: [`[cache] พบไฟล์แคช ${path.basename(cached.filePath)} ที่ยังใหม่อยู่`],
                workerJobId: null,
                createdAt: nowIso,
                updatedAt: nowIso,
                finishedAt: nowIso,
                durationMs: 0,
                _startedAt: Date.now(),
                _cancelled: false,
                _child: null,
            };
            _jobs.set(jobId, job);
            await persistJob(job);
            return { ok: true, jobId, job: sanitizeJob(job) };
        }
    }

    // Deduplicate concurrent turntable renders for the same asset+version
    const lockKey = `turntable:${id}:v${verObj.v}`;
    const existingId = _activeAssetJobs.get(lockKey);
    if (existingId) {
        const existingJob = _jobs.get(existingId);
        if (existingJob && !['done', 'error', 'cancelled'].includes(existingJob.status)) {
            return { ok: true, jobId: existingJob.jobId, job: sanitizeJob(existingJob) };
        }
        _activeAssetJobs.delete(lockKey);
    }

    const jobId = `vtt_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const nowIso = new Date().toISOString();
    const job = {
        jobId,
        kind: 'turntable',
        assetId: id,
        instruction: `360° Turntable v${verObj.v}`,
        fromVersion: verObj.v,
        target: 'local',
        effectiveTarget: 'local',
        liveSession: null,
        status: 'queued',
        progress: 5,
        message: 'กำลังเตรียมเรนเดอร์หมุน 360° (36 เฟรม)...',
        attempt: 1,
        maxAttempts: 1,
        newVersion: null,
        outputUrl: null,
        monitorUrl: null,
        workerNodeId: null,
        cached: false,
        error: null,
        log: [],
        workerJobId: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        finishedAt: null,
        durationMs: 0,
        _startedAt: Date.now(),
        _cancelled: false,
        _child: null,
        _lockKey: lockKey,
    };

    _jobs.set(jobId, job);
    _activeAssetJobs.set(lockKey, jobId);
    await persistJob(job);

    runTurntableJob(job, inGlb, verObj.v, outputUrl, lockKey).catch(async (err) => {
        job.status = 'error';
        job.error = err ? err.message : String(err);
        job.message = `สร้างวิดีโอ 360° ไม่สำเร็จ: ${job.error}`;
        job.finishedAt = new Date().toISOString();
        job.durationMs = Math.max(0, Date.now() - job._startedAt);
        pushJobLog(job, `[fatal] ${job.error}`);
        await persistJob(job);
        if (_activeAssetJobs.get(lockKey) === job.jobId) {
            _activeAssetJobs.delete(lockKey);
        }
    });

    return { ok: true, jobId, job: sanitizeJob(job) };
}

async function runTurntableJob(job, inGlb, vNum, outputUrl, lockKey) {
    const vault = getVault();
    const workDir = path.join(getWorkRoot(), job.jobId);
    const framesDir = path.join(workDir, 'frames');
    const turntablesDir = getTurntablesDir();
    await fsp.mkdir(framesDir, { recursive: true });
    await fsp.mkdir(turntablesDir, { recursive: true });

    try {
        if (job._cancelled) return;

        const shimPath = path.join(workDir, '_vault_gltf_shim.py');
        const scriptPath = path.join(workDir, 'turntable.py');
        await fsp.writeFile(shimPath, PY_GLTF_SHIM, 'utf8');
        await fsp.writeFile(scriptPath, PY_TURNTABLE_SCRIPT, 'utf8');

        job.status = 'running';
        job.progress = 20;
        job.message = 'กำลังเรนเดอร์ 36 เฟรมด้วย Blender...';
        pushJobLog(job, `[turntable] เริ่มเรนเดอร์ 36 เฟรม (480x480) จาก v${vNum}`);
        await persistJob(job);

        const renderRes = await vault.withBlenderLock(async () => {
            if (job._cancelled) {
                return { ok: false, cancelled: true, error: 'งานถูกยกเลิก' };
            }
            const args = [
                '-b', '--factory-startup', '--python-exit-code', '1',
                '--python', shimPath,
                '--python', scriptPath,
                '--', inGlb, framesDir, '36',
            ];
            return new Promise((resolve) => {
                const child = execFile(vault.BLENDER_BIN, args, {
                    timeout: BLENDER_EDIT_TIMEOUT_MS,
                    maxBuffer: 16 * 1024 * 1024,
                    cwd: workDir,
                }, (err, stdout, stderr) => {
                    if (job._child === child) job._child = null;
                    const outStr = String(stdout || '');
                    const errStr = String(stderr || '');
                    if (outStr) pushJobLog(job, outStr.slice(-1500));
                    if (errStr) pushJobLog(job, errStr.slice(-1500));
                    if (job._cancelled) {
                        return resolve({ ok: false, cancelled: true, error: 'งานถูกยกเลิก' });
                    }
                    if (err) {
                        return resolve({ ok: false, error: errStr.trim() || outStr.trim() || err.message });
                    }
                    return resolve({ ok: true });
                });
                job._child = child;
            });
        });

        if (job._cancelled || (renderRes && renderRes.cancelled)) return;
        if (!renderRes || !renderRes.ok) {
            throw new Error((renderRes && renderRes.error) || 'Blender turntable render failed');
        }

        const firstFrame = path.join(framesDir, 'frame_0001.png');
        if (!fs.existsSync(firstFrame)) {
            throw new Error('ไม่พบภาพเฟรมที่เรนเดอร์จาก Blender');
        }

        job.progress = 80;
        job.message = 'กำลังรวมเฟรมเป็นวิดีโอ 360°...';
        await persistJob(job);

        const ffmpegBin = await findFfmpegBin();
        const mp4Target = path.join(turntablesDir, `${job.assetId}_v${vNum}.mp4`);
        const gifTarget = path.join(turntablesDir, `${job.assetId}_v${vNum}.gif`);
        const pngTarget = path.join(turntablesDir, `${job.assetId}_v${vNum}.png`);

        // Clean stale alternate formats for this version
        for (const p of [mp4Target, gifTarget, pngTarget]) {
            try { await fsp.unlink(p); } catch (_) {}
        }

        let encoded = false;
        if (ffmpegBin) {
            const tmpMp4 = `${mp4Target}.tmp.${process.pid}.mp4`;
            const mp4Ok = await new Promise((resolve) => {
                const child = execFile(ffmpegBin, [
                    '-y', '-framerate', '12',
                    '-i', path.join(framesDir, 'frame_%04d.png'),
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                    '-movflags', '+faststart',
                    tmpMp4,
                ], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }, (err, _out, stderr) => {
                    if (job._child === child) job._child = null;
                    if (err) {
                        pushJobLog(job, `[ffmpeg-mp4-warn] ${String(stderr || err.message).slice(-400)}`);
                        return resolve(false);
                    }
                    return resolve(true);
                });
                job._child = child;
            });
            if (mp4Ok && fs.existsSync(tmpMp4) && fs.statSync(tmpMp4).size > 0) {
                await fsp.rename(tmpMp4, mp4Target);
                pushJobLog(job, `[ffmpeg] สร้างไฟล์ ${path.basename(mp4Target)} สำเร็จ`);
                encoded = true;
            } else {
                try { await fsp.unlink(tmpMp4); } catch (_) {}
                // Fallback to GIF via ffmpeg
                const tmpGif = `${gifTarget}.tmp.${process.pid}.gif`;
                const gifOk = await new Promise((resolve) => {
                    execFile(ffmpegBin, [
                        '-y', '-framerate', '12',
                        '-i', path.join(framesDir, 'frame_%04d.png'),
                        tmpGif,
                    ], { timeout: 60_000 }, (err) => resolve(!err));
                });
                if (gifOk && fs.existsSync(tmpGif) && fs.statSync(tmpGif).size > 0) {
                    await fsp.rename(tmpGif, gifTarget);
                    pushJobLog(job, `[ffmpeg] fallback สร้างไฟล์ ${path.basename(gifTarget)} สำเร็จ`);
                    encoded = true;
                } else {
                    try { await fsp.unlink(tmpGif); } catch (_) {}
                }
            }
        }

        if (!encoded) {
            await fsp.copyFile(firstFrame, pngTarget);
            pushJobLog(job, `[fallback] ไม่มี ffmpeg → บันทึกภาพเฟรมแรก ${path.basename(pngTarget)}`);
        }

        if (job._cancelled) return;

        job.outputUrl = outputUrl;
        job.status = 'done';
        job.progress = 100;
        job.message = 'สร้างวิดีโอหมุน 360° สำเร็จ';
        job.finishedAt = new Date().toISOString();
        job.durationMs = Math.max(0, Date.now() - job._startedAt);
        await persistJob(job);
    } catch (err) {
        if (job._cancelled) return;
        job.status = 'error';
        job.error = err ? err.message : String(err);
        job.message = `สร้างวิดีโอ 360° ไม่สำเร็จ: ${job.error}`;
        job.finishedAt = new Date().toISOString();
        job.durationMs = Math.max(0, Date.now() - job._startedAt);
        pushJobLog(job, `[error] ${job.error}`);
        await persistJob(job);
    } finally {
        job._child = null;
        if (_activeAssetJobs.get(lockKey) === job.jobId) {
            _activeAssetJobs.delete(lockKey);
        }
    }
}

async function serveTurntableFile(req, res, id, vStr) {
    const vault = getVault();
    vault.assertValidAssetId(id);
    if (!/^\d+$/.test(String(vStr || ''))) {
        throw vault.makeError('หมายเลขเวอร์ชันต้องเป็นตัวเลข', 400);
    }
    const vNum = parseInt(vStr, 10);
    if (!Number.isInteger(vNum) || vNum < 1) {
        throw vault.makeError('หมายเลขเวอร์ชันไม่ถูกต้อง', 400);
    }

    const found = await findCachedTurntable(id, vNum, 0);
    if (!found) {
        throw vault.makeError(`ไม่พบไฟล์ turntable ของ '${id}' เวอร์ชัน v${vNum}`, 404);
    }

    const total = found.stat.size;
    const rangeHeader = req.headers && req.headers.range;
    const baseHeaders = {
        'Content-Type': found.contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=60',
    };

    if (rangeHeader && /^bytes=\d*-\d*$/.test(rangeHeader)) {
        const parts = rangeHeader.replace(/^bytes=/, '').split('-');
        const start = parts[0] ? parseInt(parts[0], 10) : 0;
        const end = parts[1] ? Math.min(parseInt(parts[1], 10), total - 1) : total - 1;
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
            res.writeHead(416, { 'Content-Range': `bytes */${total}` });
            res.end();
            return;
        }
        const chunkSize = end - start + 1;
        res.writeHead(206, {
            ...baseHeaders,
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Content-Length': String(chunkSize),
        });
        if (req.method === 'HEAD') {
            res.end();
            return;
        }
        fs.createReadStream(found.filePath, { start, end }).pipe(res);
        return;
    }

    res.writeHead(200, {
        ...baseHeaders,
        'Content-Length': String(total),
    });
    if (req.method === 'HEAD') {
        res.end();
        return;
    }
    fs.createReadStream(found.filePath).pipe(res);
}

// ── Phase 3.3: Worker Runner (Agent Hub + Live Session + Local Fallback) ─────

const MAX_WORKER_INLINE_GLB_BYTES = 5 * 1024 * 1024; // 5 MB base64 cap
const WORKER_POLL_INTERVAL_MS = 1500;

function wrapScriptForWorker(scriptCode, inGlbBase64) {
    const header = [
        '# --- 3D Vault Worker Input/Argv Wrapper ---',
        'import os as _v_os, sys as _v_sys, base64 as _v_b64',
        '_v_work = _v_os.environ.get("BLENDER_WORK_DIR") or _v_os.getcwd()',
        '_v_in = _v_os.path.join(_v_work, "_vault_in.glb")',
        `with open(_v_in, "wb") as _v_f:`,
        `    _v_f.write(_v_b64.b64decode("${inGlbBase64}"))`,
        '_v_out = _v_os.environ.get("BLENDER_OUTPUT_FILE") or _v_os.path.join(_v_work, "out.glb")',
        '_v_png = _v_os.environ.get("BLENDER_PREVIEW_FILE") or _v_os.path.join(_v_work, "preview.png")',
        'if "--" not in _v_sys.argv:',
        '    _v_sys.argv.extend(["--", _v_in, _v_out, _v_png])',
        '# --- End Wrapper ---',
        '',
    ].join('\n');
    return header + String(scriptCode || '');
}

function openLiveSessionMonitorTab(hubJobId, liveSession, job) {
    if (!liveSession) return;
    const monitorUrl = `http://127.0.0.1:8090/api/agent-hub/jobs/${hubJobId}/monitor`;
    const labBrowserBin = '/home/dev/.local/bin/lab-browser';
    if (!fs.existsSync(labBrowserBin)) {
        pushJobLog(job, '[live-session] ไม่พบ lab-browser ข้ามการเปิดแท็บสตรีมสด');
        return;
    }
    try {
        execFile(labBrowserBin, [
            'session', 'open', monitorUrl,
            '--new-tab',
            '--session', liveSession,
            '--shared-auth',
        ], { timeout: 15_000 }, (err, _out, stderr) => {
            if (err) {
                pushJobLog(job, `[live-session] เปิดแท็บ Browser Vision ไม่สำเร็จ: ${String(stderr || err.message).slice(0, 200)}`);
            } else {
                pushJobLog(job, `[live-session] เปิดหน้าจอสตรีมสดบน session ${liveSession} แล้ว`);
            }
        });
    } catch (err) {
        pushJobLog(job, `[live-session] error: ${err.message}`);
    }
}

async function defaultWorkerRunner({ job, scriptCode, inGlb, outGlb, outPng, liveSession }) {
    let hub;
    try {
        hub = require('./agent-hub-manager');
    } catch (err) {
        pushJobLog(job, `ไม่มี worker ออนไลน์ → รันในเครื่อง (${err.message})`);
        return { fallbackLocal: true };
    }

    const node = typeof hub.selectBestBlenderNode === 'function'
        ? hub.selectBestBlenderNode('auto', false)
        : null;
    if (!node) {
        pushJobLog(job, 'ไม่มี worker ออนไลน์ → รันในเครื่อง');
        return { fallbackLocal: true };
    }

    const inBuf = await fsp.readFile(inGlb);
    if (inBuf.length > MAX_WORKER_INLINE_GLB_BYTES) {
        pushJobLog(job, `ไฟล์โมเดลใหญ่เกิน ${(MAX_WORKER_INLINE_GLB_BYTES / (1024 * 1024)).toFixed(0)}MB สำหรับส่งผ่าน worker → รันในเครื่อง`);
        return { fallbackLocal: true };
    }

    const wrappedScript = wrapScriptForWorker(scriptCode, inBuf.toString('base64'));
    const outputName = `${job.jobId}_a${job.attempt}.glb`;
    const previewName = `${job.jobId}_a${job.attempt}_preview.png`;

    const hubJob = await hub.createBlenderJob({
        script: wrappedScript,
        nodeId: node.nodeId,
        outputName,
        previewName,
    });

    job.workerJobId = hubJob.jobId;
    job.workerNodeId = hubJob.nodeId || node.nodeId;
    job.monitorUrl = `/api/agent-hub/jobs/${hubJob.jobId}/monitor`;
    job.message = `กำลังรัน Blender บน Worker (${job.workerNodeId})...`;
    pushJobLog(job, `[worker] ส่งงาน ${hubJob.jobId} ไปยัง ${job.workerNodeId} แล้ว`);
    await persistJob(job);

    if (liveSession) {
        openLiveSessionMonitorTab(hubJob.jobId, liveSession, job);
    }

    const deadline = Date.now() + BLENDER_EDIT_TIMEOUT_MS;
    let lastStatusKey = '';
    while (Date.now() < deadline) {
        if (job._cancelled) {
            if (typeof hub.cancelJob === 'function') {
                try { await hub.cancelJob(hubJob.jobId); } catch (_) {}
            }
            return { ok: false, cancelled: true, error: 'งานถูกยกเลิก' };
        }

        const st = hubJob.status || 'queued';
        const pct = Number(hubJob.progress) || 0;
        const msg = hubJob.message || '';
        const statusKey = `${st}|${pct}|${msg}`;
        if (statusKey !== lastStatusKey) {
            lastStatusKey = statusKey;
            job.progress = Math.min(88, Math.max(job.progress, 45 + Math.round(pct * 0.42)));
            if (msg) job.message = `[${job.workerNodeId}] ${msg}`;
            pushJobLog(job, `[worker:${st}] ${pct}% ${msg}`);
            await persistJob(job);
        }

        if (st === 'completed') {
            const srcOut = hubJob.outputFilePath;
            if (!srcOut || !fs.existsSync(srcOut)) {
                return {
                    ok: false,
                    error: 'Worker ทำงานเสร็จแต่ไม่พบไฟล์ผลลัพธ์ GLB',
                    stderr: 'Missing outputFilePath from worker hub job',
                };
            }
            await fsp.copyFile(srcOut, outGlb);
            if (hubJob.previewFilePath && fs.existsSync(hubJob.previewFilePath)) {
                try { await fsp.copyFile(hubJob.previewFilePath, outPng); } catch (_) {}
            }
            const logs = Array.isArray(hubJob.liveLogs) ? hubJob.liveLogs.join('\n') : '';
            return { ok: true, stdout: logs, stderr: '' };
        }

        if (st === 'failed' || st === 'cancelled' || st === 'lost' || st === 'timeout' || st === 'timed_out') {
            const tailLogs = Array.isArray(hubJob.liveLogs) ? hubJob.liveLogs.slice(-60).join('\n') : '';
            const errMsg = hubJob.error || hubJob.message || 'Worker Blender job failed';
            return {
                ok: false,
                cancelled: st === 'cancelled' && job._cancelled,
                error: errMsg,
                stderr: tailLogs || errMsg,
            };
        }

        await new Promise((r) => setTimeout(r, WORKER_POLL_INTERVAL_MS));
    }

    if (typeof hub.cancelJob === 'function') {
        try { await hub.cancelJob(hubJob.jobId); } catch (_) {}
    }
    return {
        ok: false,
        error: 'Worker Blender job timed out',
        stderr: `Worker job ${hubJob.jobId} timed out after ${Math.round(BLENDER_EDIT_TIMEOUT_MS / 1000)}s`,
    };
}

// Register default worker runner (can still be overridden in tests via setWorkerRunner)
setWorkerRunner(defaultWorkerRunner);

// ── HTTP Router ──────────────────────────────────────────────────────────────

async function handleRequest(req, res, url, helpers = {}) {
    const { readJsonBody, sendJson } = helpers;
    const p = url.pathname;
    const method = (req.method || 'GET').toUpperCase();

    if (!p.startsWith('/api/3d-vault/ai/')) {
        return false;
    }

    try {
        // GET /api/3d-vault/ai/status
        if (method === 'GET' && p === '/api/3d-vault/ai/status') {
            sendJson(res, 200, await getStatus());
            return true;
        }

        // Asset-scoped routes: /api/3d-vault/ai/assets/:id/(chat|edit|suggest|turntable)
        const assetMatch = p.match(/^\/api\/3d-vault\/ai\/assets\/([^/]+)\/(chat|edit|suggest|turntable)$/);
        if (assetMatch) {
            const id = decodeURIComponent(assetMatch[1]);
            const action = assetMatch[2];

            if (action === 'chat' && method === 'GET') {
                sendJson(res, 200, await getChat(id));
                return true;
            }
            if (action === 'chat' && method === 'DELETE') {
                sendJson(res, 200, await clearChat(id));
                return true;
            }
            if (action === 'edit' && method === 'POST') {
                const body = await readJsonBody(req, 256 * 1024);
                const result = await startEdit(id, body || {});
                sendJson(res, 200, { ok: true, ...result });
                return true;
            }
            if (action === 'suggest' && method === 'POST') {
                const body = await readJsonBody(req, 64 * 1024);
                sendJson(res, 200, await suggestIdeas(id, body || {}));
                return true;
            }
            if (action === 'turntable' && method === 'POST') {
                const body = await readJsonBody(req, 64 * 1024);
                sendJson(res, 200, await startTurntable(id, body || {}));
                return true;
            }
        }

        // GET/HEAD /api/3d-vault/ai/turntable/:id/:v
        const turntableMatch = p.match(/^\/api\/3d-vault\/ai\/turntable\/([^/]+)\/([^/]+)$/);
        if (turntableMatch && (method === 'GET' || method === 'HEAD')) {
            const id = decodeURIComponent(turntableMatch[1]);
            const vStr = decodeURIComponent(turntableMatch[2]);
            await serveTurntableFile(req, res, id, vStr);
            return true;
        }

        // Job routes: /api/3d-vault/ai/jobs/:jobId[/cancel]
        const jobCancelMatch = p.match(/^\/api\/3d-vault\/ai\/jobs\/([^/]+)\/cancel$/);
        if (jobCancelMatch && method === 'POST') {
            const jobId = decodeURIComponent(jobCancelMatch[1]);
            const job = await cancelJob(jobId);
            sendJson(res, 200, { ok: true, job });
            return true;
        }

        const jobMatch = p.match(/^\/api\/3d-vault\/ai\/jobs\/([^/]+)$/);
        if (jobMatch && method === 'GET') {
            const jobId = decodeURIComponent(jobMatch[1]);
            const job = await getJob(jobId);
            if (!job) {
                throw getVault().makeError(`ไม่พบงาน AI '${jobId}'`, 404);
            }
            sendJson(res, 200, job);
            return true;
        }

        sendJson(res, 404, { error: 'ไม่พบ AI API endpoint ที่ร้องขอ' });
        return true;
    } catch (err) {
        const status = err && Number.isInteger(err.statusCode) ? err.statusCode : 500;
        if (!res.headersSent) {
            sendJson(res, status, { error: err ? err.message : 'Internal error' });
        } else if (!res.writableEnded) {
            res.end();
        }
        return true;
    }
}

module.exports = {
    handleRequest,
    startEdit,
    getJob,
    cancelJob,
    getChat,
    clearChat,
    appendChat,
    suggestIdeas,
    startTurntable,
    setLlmRunner,
    setWorkerRunner,
    defaultWorkerRunner,
    checkScriptSafety,
    extractPython,
    extractFirstJsonObject,
    buildEditPrompt,
    _jobs,
};
