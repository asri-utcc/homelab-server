'use strict';

/**
 * asset-vault-manager.js
 * -----------------------------------------------------------------------------
 * 3D Asset Vault Backend Manager for Lab Dashboard
 * Manages versioned 3D models (GLB + Blender .py scripts + previews + originals),
 * local Blender conversion (OBJ/STL/FBX/PLY/GLTF/BLEND <-> GLB), portable ZIP
 * export/import, and HTTP API dispatching.
 *
 * Safety Guarantees:
 *  - Zero external npm dependencies (Node built-ins + /usr/bin/{blender,zip,unzip})
 *  - Pure argv-array execFile calls (never shell interpolation)
 *  - Strict VAULT_DIR path-traversal & dotfile guards
 *  - Atomic JSON writes (.tmp + rename) + promise-chain write mutex
 *  - Serialized Blender job mutex to protect shared server RAM
 *  - Zip Slip & zip-bomb guards on archive import
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

const VAULT_DIR = path.resolve(process.env.VAULT_DIR || path.join(os.homedir(), '.gemini', '3d-vault'));
const ASSETS_DIR = path.join(VAULT_DIR, 'assets');
const TRASH_DIR = path.join(VAULT_DIR, '.trash');
const INDEX_FILE = path.join(VAULT_DIR, 'index.json');
const OUTPUTS_3D_DIR = path.resolve(process.env.OUTPUTS_3D_DIR || path.join(os.homedir(), '.gemini', 'outputs', '3d'));

const BLENDER_BIN = process.env.BLENDER_BIN || '/usr/bin/blender';
const ZIP_BIN = process.env.ZIP_BIN || '/usr/bin/zip';
const UNZIP_BIN = process.env.UNZIP_BIN || '/usr/bin/unzip';

const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;       // 80 MB raw binary limit
const MAX_JSON_BODY_BYTES = 110 * 1024 * 1024;   // 110 MB JSON body limit (base64 overhead)
const MAX_ZIP_EXTRACT_BYTES = 250 * 1024 * 1024; // 250 MB zip-bomb cap
const BLENDER_TIMEOUT_MS = 180_000;
const ZIP_TIMEOUT_MS = 120_000;

const ALLOWED_LOCAL_ROOTS = [
    path.resolve('/home/dev/.gemini'),
    path.resolve('/home/dev/projects'),
    path.resolve('/tmp'),
];

const VALID_CATEGORIES = new Set(['building', 'furniture', 'device', 'part', 'scene', 'other']);
const MODEL_EXTS = new Set(['.glb', '.gltf', '.obj', '.stl', '.fbx', '.ply', '.blend']);
const SOURCE_EXTS = new Set(['.py']);
const PREVIEW_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const ALLOWED_SERVE_EXTS = new Set([
    '.glb', '.gltf', '.obj', '.stl', '.fbx', '.ply', '.blend',
    '.py', '.png', '.jpg', '.jpeg', '.webp',
]);
const EXPORT_FORMATS = new Set(['zip', 'glb', 'stl', 'obj', 'fbx', 'ply']);

const MIME_BY_EXT = {
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.obj': 'text/plain; charset=utf-8',
    '.stl': 'model/stl',
    '.fbx': 'application/octet-stream',
    '.ply': 'application/octet-stream',
    '.blend': 'application/octet-stream',
    '.py': 'text/x-python; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.zip': 'application/zip',
};

const MIME_TO_PREVIEW_EXT = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
};

// ── Concurrency mutexes ──────────────────────────────────────────────────────

let indexWriteChain = Promise.resolve();
function withWriteLock(fn) {
    const run = indexWriteChain.then(() => fn(), () => fn());
    indexWriteChain = run.catch(() => {});
    return run;
}

let blenderChain = Promise.resolve();
function withBlenderLock(fn) {
    const run = blenderChain.then(() => fn(), () => fn());
    blenderChain = run.catch(() => {});
    return run;
}

// ── Low-level helpers & security guards ──────────────────────────────────────

function makeError(message, statusCode = 400) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

function execFileAsync(bin, args, opts = {}) {
    return new Promise((resolve, reject) => {
        execFile(bin, args, {
            maxBuffer: 16 * 1024 * 1024,
            ...opts,
        }, (err, stdout, stderr) => {
            if (err) {
                err.stdout = stdout;
                err.stderr = stderr;
                return reject(err);
            }
            resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
}

function slugifyName(name) {
    const cleaned = String(name || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48)
        .replace(/-+$/g, '');
    return cleaned || 'asset';
}

function generateAssetId(name) {
    const slug = slugifyName(name);
    const hex = crypto.randomBytes(3).toString('hex');
    return `${slug}-${hex}`;
}

function isValidAssetId(id) {
    if (typeof id !== 'string' || !id) return false;
    if (id.startsWith('.') || id.includes('..') || id.includes('/') || id.includes('\\') || id.includes('\0')) {
        return false;
    }
    return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id);
}

function assertValidAssetId(id) {
    if (!isValidAssetId(id)) {
        throw makeError('รหัส asset ไม่ถูกต้อง', 400);
    }
    return id;
}

function parseVersionNumber(v) {
    if (typeof v === 'number') {
        if (!Number.isInteger(v) || v < 1) return null;
        return v;
    }
    if (typeof v === 'string') {
        const s = v.trim();
        const m = s.match(/^v?(\d+)$/i);
        if (!m) return null;
        const n = parseInt(m[1], 10);
        return n >= 1 ? n : null;
    }
    return null;
}

function assertInsideDir(targetPath, rootDir, { allowHidden = false } = {}) {
    if (typeof targetPath !== 'string' || targetPath.includes('\0')) {
        throw makeError('Path ไม่ถูกต้อง', 400);
    }
    const resolvedRoot = path.resolve(rootDir);
    const resolvedTarget = path.resolve(targetPath);
    const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
    if (!resolvedTarget.startsWith(prefix)) {
        throw makeError('ไม่อนุญาตให้เข้าถึง path นอกคลังจัดเก็บ', 403);
    }
    const rel = path.relative(resolvedRoot, resolvedTarget);
    const segments = rel.split(path.sep);
    for (const seg of segments) {
        if (!seg || seg === '..' || seg === '.') {
            throw makeError('ตรวจพบ path traversal', 403);
        }
        if (!allowHidden && seg.startsWith('.')) {
            throw makeError('ไม่อนุญาตให้เข้าถึงไฟล์ที่ขึ้นต้นด้วยจุด', 403);
        }
    }
    return resolvedTarget;
}

function assertInsideVault(targetPath, opts) {
    return assertInsideDir(targetPath, VAULT_DIR, opts);
}

function isAllowedLocalPath(rawPath) {
    if (typeof rawPath !== 'string' || !rawPath.trim() || rawPath.includes('\0')) return false;
    const resolved = path.resolve(rawPath.trim());
    return ALLOWED_LOCAL_ROOTS.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

async function resolveAllowedLocalPath(rawPath) {
    if (!isAllowedLocalPath(rawPath)) {
        throw makeError('ไม่อนุญาตให้เข้าถึง path นอกพื้นที่ที่กำหนด (/home/dev/.gemini, /home/dev/projects, /tmp)', 403);
    }
    const resolved = path.resolve(rawPath.trim());
    let real;
    try {
        real = await fsp.realpath(resolved);
    } catch (_) {
        throw makeError(`ไม่พบไฟล์ต้นทาง: ${path.basename(resolved)}`, 404);
    }
    if (!isAllowedLocalPath(real)) {
        throw makeError('ไม่อนุญาตให้ใช้ symlink ที่ชี้ออกนอกพื้นที่ที่กำหนด', 403);
    }
    const st = await fsp.stat(real);
    if (!st.isFile()) {
        throw makeError('path ที่ระบุไม่ใช่ไฟล์', 400);
    }
    if (st.size <= 0) {
        throw makeError('ไฟล์ต้นทางว่างเปล่า', 400);
    }
    if (st.size > MAX_UPLOAD_BYTES) {
        throw makeError(`ไฟล์มีขนาดเกิน ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB`, 413);
    }
    return real;
}

function normalizeCategory(cat) {
    const c = String(cat || '').trim().toLowerCase();
    return VALID_CATEGORIES.has(c) ? c : 'other';
}

function normalizeTags(tags) {
    let arr = [];
    if (Array.isArray(tags)) {
        arr = tags;
    } else if (typeof tags === 'string') {
        arr = tags.split(',');
    }
    const seen = new Set();
    const out = [];
    for (const item of arr) {
        const t = String(item || '').trim().toLowerCase();
        if (!t || seen.has(t)) continue;
        seen.add(t);
        out.push(t.slice(0, 48));
        if (out.length >= 30) break;
    }
    return out;
}

function normalizeDimensions(dim) {
    if (!dim || typeof dim !== 'object') return null;
    const x = Number(dim.x);
    const y = Number(dim.y);
    const z = Number(dim.z);
    if (![x, y, z].every((n) => Number.isFinite(n) && n >= 0)) return null;
    return {
        x: Math.round(x * 1000) / 1000,
        y: Math.round(y * 1000) / 1000,
        z: Math.round(z * 1000) / 1000,
    };
}

async function writeJsonAtomic(filePath, obj) {
    assertInsideVault(filePath, { allowHidden: false });
    const dir = path.dirname(filePath);
    await fsp.mkdir(dir, { recursive: true });
    const tmpName = `tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`;
    const tmpPath = path.join(dir, tmpName);
    const content = JSON.stringify(obj, null, 2) + '\n';
    await fsp.writeFile(tmpPath, content, 'utf8');
    await fsp.rename(tmpPath, filePath);
}

async function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

function parseDataUrl(dataUrl) {
    const raw = String(dataUrl || '');
    const m = raw.match(/^data:([^;,]+)(?:;[^;,]+)*;base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!m) {
        throw makeError('รูปแบบไฟล์ไม่ถูกต้อง (ต้องเป็น Base64 Data URL)', 400);
    }
    const mime = m[1].trim().toLowerCase();
    const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
    if (!buf.length) {
        throw makeError('ไฟล์ที่อัปโหลดว่างเปล่า', 400);
    }
    if (buf.length > MAX_UPLOAD_BYTES) {
        throw makeError(`ไฟล์มีขนาดเกิน ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB`, 413);
    }
    return { mime, buffer: buf };
}

async function ensureVaultDirs() {
    await fsp.mkdir(ASSETS_DIR, { recursive: true });
}

// ── GLB binary inspector (zero external dependencies) ────────────────────────

function mat4Identity() {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function mat4Multiply(a, b) {
    const out = new Array(16).fill(0);
    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
            out[col * 4 + row] =
                a[0 * 4 + row] * b[col * 4 + 0] +
                a[1 * 4 + row] * b[col * 4 + 1] +
                a[2 * 4 + row] * b[col * 4 + 2] +
                a[3 * 4 + row] * b[col * 4 + 3];
        }
    }
    return out;
}

function mat4FromTRS(t, r, s) {
    const tx = t ? Number(t[0]) || 0 : 0;
    const ty = t ? Number(t[1]) || 0 : 0;
    const tz = t ? Number(t[2]) || 0 : 0;
    const qx = r ? Number(r[0]) || 0 : 0;
    const qy = r ? Number(r[1]) || 0 : 0;
    const qz = r ? Number(r[2]) || 0 : 0;
    const qw = r ? (Number.isFinite(Number(r[3])) ? Number(r[3]) : 1) : 1;
    const sx = s ? (Number.isFinite(Number(s[0])) ? Number(s[0]) : 1) : 1;
    const sy = s ? (Number.isFinite(Number(s[1])) ? Number(s[1]) : 1) : 1;
    const sz = s ? (Number.isFinite(Number(s[2])) ? Number(s[2]) : 1) : 1;

    const x2 = qx + qx;
    const y2 = qy + qy;
    const z2 = qz + qz;
    const xx = qx * x2;
    const xy = qx * y2;
    const xz = qx * z2;
    const yy = qy * y2;
    const yz = qy * z2;
    const zz = qz * z2;
    const wx = qw * x2;
    const wy = qw * y2;
    const wz = qw * z2;

    return [
        (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
        (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
        (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
        tx, ty, tz, 1,
    ];
}

function transformPoint(m, x, y, z) {
    return [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
    ];
}

async function inspectGlb(glbPath) {
    const fd = await fsp.open(glbPath, 'r');
    try {
        const header = Buffer.alloc(20);
        const { bytesRead } = await fd.read(header, 0, 20, 0);
        if (bytesRead < 20 || header.toString('ascii', 0, 4) !== 'glTF') {
            return { valid: false, stats: {}, dimensions: null };
        }
        const chunkLen = header.readUInt32LE(12);
        const chunkType = header.readUInt32LE(16);
        if (chunkType !== 0x4E4F534A || chunkLen <= 0 || chunkLen > 32 * 1024 * 1024) {
            return { valid: true, stats: {}, dimensions: null };
        }
        const jsonBuf = Buffer.alloc(chunkLen);
        const readRes = await fd.read(jsonBuf, 0, chunkLen, 20);
        if (readRes.bytesRead < chunkLen) {
            return { valid: true, stats: {}, dimensions: null };
        }
        let gltf;
        try {
            gltf = JSON.parse(jsonBuf.toString('utf8').replace(/\0+$/, ''));
        } catch (_) {
            return { valid: true, stats: {}, dimensions: null };
        }

        const meshes = Array.isArray(gltf.meshes) ? gltf.meshes : [];
        const accessors = Array.isArray(gltf.accessors) ? gltf.accessors : [];
        const nodes = Array.isArray(gltf.nodes) ? gltf.nodes : [];

        let triangles = 0;
        for (const mesh of meshes) {
            for (const prim of (mesh.primitives || [])) {
                const mode = prim.mode === undefined ? 4 : prim.mode;
                let count = 0;
                if (prim.indices !== undefined && accessors[prim.indices]) {
                    count = Number(accessors[prim.indices].count) || 0;
                } else if (prim.attributes && prim.attributes.POSITION !== undefined && accessors[prim.attributes.POSITION]) {
                    count = Number(accessors[prim.attributes.POSITION].count) || 0;
                }
                if (mode === 4) triangles += Math.floor(count / 3);
                else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2);
            }
        }

        // Compute world bounding box
        const minW = [Infinity, Infinity, Infinity];
        const maxW = [-Infinity, -Infinity, -Infinity];
        let hasBounds = false;

        function expandMeshBounds(meshIdx, worldMat) {
            const mesh = meshes[meshIdx];
            if (!mesh || !Array.isArray(mesh.primitives)) return;
            for (const prim of mesh.primitives) {
                const posIdx = prim.attributes && prim.attributes.POSITION;
                const acc = posIdx !== undefined ? accessors[posIdx] : null;
                if (!acc || !Array.isArray(acc.min) || !Array.isArray(acc.max)) continue;
                if (acc.min.length < 3 || acc.max.length < 3) continue;
                const xs = [acc.min[0], acc.max[0]];
                const ys = [acc.min[1], acc.max[1]];
                const zs = [acc.min[2], acc.max[2]];
                for (const cx of xs) {
                    for (const cy of ys) {
                        for (const cz of zs) {
                            const pt = transformPoint(worldMat, cx, cy, cz);
                            for (let k = 0; k < 3; k++) {
                                if (pt[k] < minW[k]) minW[k] = pt[k];
                                if (pt[k] > maxW[k]) maxW[k] = pt[k];
                            }
                            hasBounds = true;
                        }
                    }
                }
            }
        }

        function walkNode(nodeIdx, parentMat, depth) {
            if (depth > 64) return;
            const node = nodes[nodeIdx];
            if (!node) return;
            const localMat = Array.isArray(node.matrix) && node.matrix.length === 16
                ? node.matrix
                : mat4FromTRS(node.translation, node.rotation, node.scale);
            const worldMat = mat4Multiply(parentMat, localMat);
            if (node.mesh !== undefined) {
                expandMeshBounds(node.mesh, worldMat);
            }
            if (Array.isArray(node.children)) {
                for (const childIdx of node.children) {
                    walkNode(childIdx, worldMat, depth + 1);
                }
            }
        }

        const sceneIdx = Number.isInteger(gltf.scene) ? gltf.scene : 0;
        const scene = Array.isArray(gltf.scenes) ? gltf.scenes[sceneIdx] : null;
        if (scene && Array.isArray(scene.nodes) && scene.nodes.length) {
            for (const nIdx of scene.nodes) {
                walkNode(nIdx, mat4Identity(), 0);
            }
        } else if (nodes.length) {
            const childSet = new Set();
            for (const n of nodes) {
                for (const c of (n.children || [])) childSet.add(c);
            }
            for (let i = 0; i < nodes.length; i++) {
                if (!childSet.has(i)) walkNode(i, mat4Identity(), 0);
            }
        } else {
            for (let i = 0; i < meshes.length; i++) {
                expandMeshBounds(i, mat4Identity());
            }
        }

        const dimensions = hasBounds ? normalizeDimensions({
            x: maxW[0] - minW[0],
            y: maxW[1] - minW[1],
            z: maxW[2] - minW[2],
        }) : null;

        return {
            valid: true,
            stats: { triangles, meshes: meshes.length },
            dimensions,
        };
    } finally {
        await fd.close();
    }
}

async function verifyGlbHeader(filePath) {
    const fd = await fsp.open(filePath, 'r');
    try {
        const hdr = Buffer.alloc(4);
        const { bytesRead } = await fd.read(hdr, 0, 4, 0);
        return bytesRead === 4 && hdr.toString('ascii', 0, 4) === 'glTF';
    } finally {
        await fd.close();
    }
}

// ── Blender format conversions ───────────────────────────────────────────────

const PY_GLTF_HELPERS = `
import os, sys, json, struct, base64, bpy
from mathutils import Matrix, Vector, Quaternion

def _has_numpy():
    try:
        import numpy  # noqa: F401
        return True
    except Exception:
        return False

def _clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me, do_unlink=True)

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
            return Matrix((
                (m[0], m[4], m[8], m[12]),
                (m[1], m[5], m[9], m[13]),
                (m[2], m[6], m[10], m[14]),
                (m[3], m[7], m[11], m[15]),
            ))
        t = node.get("translation", [0.0, 0.0, 0.0])
        r = node.get("rotation", [0.0, 0.0, 0.0, 1.0])
        s = node.get("scale", [1.0, 1.0, 1.0])
        mat_t = Matrix.Translation(Vector((t[0], t[1], t[2])))
        mat_r = Quaternion((r[3], r[0], r[1], r[2])).to_matrix().to_4x4()
        mat_s = Matrix.Diagonal((s[0], s[1], s[2], 1.0))
        return mat_t @ mat_r @ mat_s

    yup_to_zup = Matrix((
        (1.0, 0.0,  0.0, 0.0),
        (0.0, 0.0, -1.0, 0.0),
        (0.0, 1.0,  0.0, 0.0),
        (0.0, 0.0,  0.0, 1.0),
    ))

    created = []
    def add_mesh(mesh_idx, world_mat, obj_name):
        gmesh = meshes[mesh_idx]
        verts = []
        faces = []
        v_base = 0
        for prim in gmesh.get("primitives", []):
            attrs = prim.get("attributes", {})
            if "POSITION" not in attrs:
                continue
            pos_list = read_acc(attrs["POSITION"])
            for px, py, pz in pos_list:
                v = yup_to_zup @ (world_mat @ Vector((px, py, pz)))
                verts.append((v.x, v.y, v.z))
            mode = prim.get("mode", 4)
            if "indices" in prim:
                idxs = read_acc(prim["indices"])
            else:
                idxs = list(range(len(pos_list)))
            if mode == 4:
                for i in range(0, len(idxs) - 2, 3):
                    a, b, c = idxs[i] + v_base, idxs[i + 1] + v_base, idxs[i + 2] + v_base
                    if a != b and b != c and c != a:
                        faces.append((a, b, c))
            elif mode == 5:
                for i in range(len(idxs) - 2):
                    if i % 2 == 0:
                        tri = (idxs[i] + v_base, idxs[i + 1] + v_base, idxs[i + 2] + v_base)
                    else:
                        tri = (idxs[i] + v_base, idxs[i + 2] + v_base, idxs[i + 1] + v_base)
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
        created.append(ob)

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
    return created

def _export_glb_pure(dst_path):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    zup_to_yup = Matrix((
        (1.0,  0.0, 0.0, 0.0),
        (0.0,  0.0, 1.0, 0.0),
        (0.0, -1.0, 0.0, 0.0),
        (0.0,  0.0, 0.0, 1.0),
    ))
    bin_chunks = bytearray()
    buffer_views = []
    accessors = []
    g_meshes = []
    g_nodes = []
    g_materials = []
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
        color = [0.8, 0.8, 0.8, 1.0]
        metallic = 0.0
        roughness = 0.6
        if bmat.use_nodes and bmat.node_tree:
            for nd in bmat.node_tree.nodes:
                if nd.type == "BSDF_PRINCIPLED":
                    bc = nd.inputs.get("Base Color")
                    if bc:
                        color = [float(bc.default_value[0]), float(bc.default_value[1]), float(bc.default_value[2]), float(bc.default_value[3])]
                    mt = nd.inputs.get("Metallic")
                    if mt:
                        metallic = float(mt.default_value)
                    rg = nd.inputs.get("Roughness")
                    if rg:
                        roughness = float(rg.default_value)
                    break
        else:
            dc = bmat.diffuse_color
            color = [float(dc[0]), float(dc[1]), float(dc[2]), float(dc[3])]
        idx = len(g_materials)
        g_materials.append({
            "name": bmat.name,
            "pbrMetallicRoughness": {
                "baseColorFactor": color,
                "metallicFactor": metallic,
                "roughnessFactor": roughness,
            },
        })
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

            pos_bytes = bytearray()
            nrm_bytes = bytearray()
            idx_bytes = bytearray()
            vmin = [float("inf"), float("inf"), float("inf")]
            vmax = [float("-inf"), float("-inf"), float("-inf")]
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
            pos_off = len(bin_chunks)
            bin_chunks.extend(pos_bytes)
            pos_bv = len(buffer_views)
            buffer_views.append({"buffer": 0, "byteOffset": pos_off, "byteLength": len(pos_bytes), "target": 34962})
            pos_acc = len(accessors)
            accessors.append({"bufferView": pos_bv, "componentType": 5126, "count": v_count, "type": "VEC3", "min": vmin, "max": vmax})

            align4()
            nrm_off = len(bin_chunks)
            bin_chunks.extend(nrm_bytes)
            nrm_bv = len(buffer_views)
            buffer_views.append({"buffer": 0, "byteOffset": nrm_off, "byteLength": len(nrm_bytes), "target": 34962})
            nrm_acc = len(accessors)
            accessors.append({"bufferView": nrm_bv, "componentType": 5126, "count": v_count, "type": "VEC3"})

            align4()
            idx_off = len(bin_chunks)
            bin_chunks.extend(idx_bytes)
            idx_bv = len(buffer_views)
            buffer_views.append({"buffer": 0, "byteOffset": idx_off, "byteLength": len(idx_bytes), "target": 34963})
            idx_acc = len(accessors)
            accessors.append({"bufferView": idx_bv, "componentType": 5125, "count": v_count, "type": "SCALAR"})

            prim = {
                "attributes": {"POSITION": pos_acc, "NORMAL": nrm_acc},
                "indices": idx_acc,
                "mode": 4,
            }
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
        "asset": {"version": "2.0", "generator": "3D Asset Vault Blender Bridge"},
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
`;

async function convertToGlb(inputPath, outputPath) {
    if (!inputPath || typeof inputPath !== 'string') {
        throw makeError('กรุณาระบุไฟล์ต้นฉบับสำหรับแปลงเป็น GLB', 400);
    }
    const src = path.resolve(inputPath);
    const ext = path.extname(src).toLowerCase();
    if (!MODEL_EXTS.has(ext)) {
        throw makeError(`ไม่รองรับนามสกุลไฟล์ 3D: ${ext || '(ไม่มี)'}`, 400);
    }
    if (!fs.existsSync(src)) {
        throw makeError(`ไม่พบไฟล์ต้นฉบับ: ${path.basename(src)}`, 404);
    }

    const dst = outputPath
        ? path.resolve(outputPath)
        : path.join(os.tmpdir(), `${path.basename(src, ext)}-${crypto.randomBytes(3).toString('hex')}.glb`);

    await fsp.mkdir(path.dirname(dst), { recursive: true });

    if (ext === '.glb') {
        if (!(await verifyGlbHeader(src))) {
            throw makeError('ไฟล์ GLB ไม่ถูกต้อง (ไม่พบหัวไฟล์ glTF)', 400);
        }
        if (src !== dst) {
            await fsp.copyFile(src, dst);
        }
        const st = await fsp.stat(dst);
        return { outputPath: dst, converted: false, format: 'glb', sizeBytes: st.size };
    }

    if (!fs.existsSync(BLENDER_BIN)) {
        throw makeError('ไม่พบ /usr/bin/blender ในเครื่อง ไม่สามารถแปลงไฟล์เป็น GLB ได้', 503);
    }

    const pyExpr = PY_GLTF_HELPERS + `
argv = sys.argv[sys.argv.index("--") + 1:]
src, dst, ext = argv[0], argv[1], argv[2].lower()
has_np = _has_numpy()
if ext == ".blend":
    bpy.ops.wm.open_mainfile(filepath=src)
else:
    _clear_scene()
    if ext in (".gltf", ".glb"):
        if has_np:
            bpy.ops.import_scene.gltf(filepath=src)
        else:
            _load_gltf_pure(src)
    elif ext == ".obj":
        if "obj_import" in dir(bpy.ops.wm): bpy.ops.wm.obj_import(filepath=src)
        else: bpy.ops.import_scene.obj(filepath=src)
    elif ext == ".stl":
        if "stl_import" in dir(bpy.ops.wm): bpy.ops.wm.stl_import(filepath=src)
        else: bpy.ops.import_mesh.stl(filepath=src)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=src)
    elif ext == ".ply":
        if "ply_import" in dir(bpy.ops.wm): bpy.ops.wm.ply_import(filepath=src)
        else: bpy.ops.import_mesh.ply(filepath=src)
    else:
        raise ValueError(f"Unsupported input format: {ext}")

if has_np:
    bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB")
else:
    _export_glb_pure(dst)
`;

    await withBlenderLock(async () => {
        try {
            await execFileAsync(
                BLENDER_BIN,
                ['--background', '--factory-startup', '--python-exit-code', '1', '--python-expr', pyExpr, '--', src, dst, ext],
                { timeout: BLENDER_TIMEOUT_MS }
            );
        } catch (err) {
            const detail = String(err.stderr || err.stdout || err.message).trim().split('\n').slice(-4).join(' | ');
            throw makeError(`Blender แปลงไฟล์เป็น GLB ไม่สำเร็จ: ${detail}`, 500);
        }
    });

    if (!fs.existsSync(dst)) {
        throw makeError('Blender ไม่ได้สร้างไฟล์ GLB ผลลัพธ์', 500);
    }
    const st = await fsp.stat(dst);
    if (st.size <= 0 || !(await verifyGlbHeader(dst))) {
        await fsp.rm(dst, { force: true }).catch(() => {});
        throw makeError('ไฟล์ GLB ที่แปลงได้ไม่สมบูรณ์ (magic header ไม่ใช่ glTF)', 500);
    }
    return { outputPath: dst, converted: true, format: 'glb', sizeBytes: st.size };
}

async function convertFromGlb(glbPath, formatOrOutPath, maybeOutPath) {
    if (!glbPath || typeof glbPath !== 'string') {
        throw makeError('กรุณาระบุไฟล์ GLB ต้นทาง', 400);
    }
    const src = path.resolve(glbPath);
    if (!fs.existsSync(src)) {
        throw makeError(`ไม่พบไฟล์ GLB ต้นทาง: ${path.basename(src)}`, 404);
    }

    let fmt;
    let dst;
    if (maybeOutPath !== undefined) {
        fmt = String(formatOrOutPath || '').trim().toLowerCase().replace(/^\./, '');
        dst = path.resolve(maybeOutPath);
    } else {
        dst = path.resolve(String(formatOrOutPath || ''));
        fmt = path.extname(dst).toLowerCase().replace(/^\./, '');
    }

    if (!['glb', 'stl', 'obj', 'fbx', 'ply'].includes(fmt)) {
        throw makeError(`ไม่รองรับรูปแบบส่งออก: ${fmt || '(ว่าง)'}`, 400);
    }

    await fsp.mkdir(path.dirname(dst), { recursive: true });

    if (fmt === 'glb') {
        if (src !== dst) await fsp.copyFile(src, dst);
        const st = await fsp.stat(dst);
        return { outputPath: dst, format: 'glb', sizeBytes: st.size };
    }

    if (!fs.existsSync(BLENDER_BIN)) {
        throw makeError(`ไม่พบ /usr/bin/blender ในเครื่อง ไม่สามารถแปลงเป็น ${fmt.toUpperCase()} ได้`, 503);
    }

    const pyExpr = PY_GLTF_HELPERS + `
argv = sys.argv[sys.argv.index("--") + 1:]
src, dst, fmt = argv[0], argv[1], argv[2].lower()
has_np = _has_numpy()
_clear_scene()
if has_np:
    bpy.ops.import_scene.gltf(filepath=src)
else:
    _load_gltf_pure(src)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
if meshes:
    for o in bpy.data.objects: o.select_set(False)
    for o in meshes: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
if fmt == "stl":
    if "stl_export" in dir(bpy.ops.wm): bpy.ops.wm.stl_export(filepath=dst)
    else: bpy.ops.export_mesh.stl(filepath=dst)
elif fmt == "obj":
    if "obj_export" in dir(bpy.ops.wm): bpy.ops.wm.obj_export(filepath=dst)
    else: bpy.ops.export_scene.obj(filepath=dst)
elif fmt == "fbx":
    bpy.ops.export_scene.fbx(filepath=dst)
elif fmt == "ply":
    if "ply_export" in dir(bpy.ops.wm): bpy.ops.wm.ply_export(filepath=dst)
    else: bpy.ops.export_mesh.ply(filepath=dst)
else:
    raise ValueError(f"Unsupported export format: {fmt}")
`;

    await withBlenderLock(async () => {
        try {
            await execFileAsync(
                BLENDER_BIN,
                ['--background', '--factory-startup', '--python-exit-code', '1', '--python-expr', pyExpr, '--', src, dst, fmt],
                { timeout: BLENDER_TIMEOUT_MS }
            );
        } catch (err) {
            const detail = String(err.stderr || err.stdout || err.message).trim().split('\n').slice(-4).join(' | ');
            throw makeError(`Blender แปลงไฟล์เป็น ${fmt.toUpperCase()} ไม่สำเร็จ: ${detail}`, 500);
        }
    });

    if (!fs.existsSync(dst)) {
        throw makeError(`Blender ไม่ได้สร้างไฟล์ ${fmt.toUpperCase()} ผลลัพธ์`, 500);
    }
    const st = await fsp.stat(dst);
    if (st.size <= 0) {
        await fsp.rm(dst, { force: true }).catch(() => {});
        throw makeError(`ไฟล์ ${fmt.toUpperCase()} ที่แปลงได้มีขนาด 0 ไบต์`, 500);
    }
    return { outputPath: dst, format: fmt, sizeBytes: st.size };
}

// ── Index & metadata helpers ─────────────────────────────────────────────────

function getAssetDir(id) {
    assertValidAssetId(id);
    const dir = path.join(ASSETS_DIR, id);
    return assertInsideDir(dir, ASSETS_DIR, { allowHidden: false });
}

function getMetaPath(id) {
    return path.join(getAssetDir(id), 'meta.json');
}

function buildThumbUrl(id, versionNum, previewFile) {
    if (!previewFile) return null;
    return `/api/3d-vault/assets/${encodeURIComponent(id)}/files/v${versionNum}/${encodeURIComponent(previewFile)}`;
}

function buildIndexRow(meta) {
    const versions = Array.isArray(meta.versions) ? meta.versions : [];
    const latest = versions.length ? versions[versions.length - 1] : null;
    let thumb = null;
    for (let i = versions.length - 1; i >= 0; i--) {
        if (versions[i].files && versions[i].files.preview) {
            thumb = buildThumbUrl(meta.id, versions[i].v, versions[i].files.preview);
            break;
        }
    }
    const sizeBytes = latest ? (Number(latest.sizeBytes) || 0) : 0;
    const totalSizeBytes = versions.reduce((sum, ver) => sum + (Number(ver.sizeBytes) || 0), 0);
    return {
        id: meta.id,
        name: meta.name,
        description: meta.description || '',
        category: normalizeCategory(meta.category),
        tags: normalizeTags(meta.tags),
        favorite: Boolean(meta.favorite),
        latestVersion: latest ? latest.v : 0,
        versionCount: versions.length,
        sizeBytes,
        totalSizeBytes,
        dimensions: meta.dimensions || null,
        createdAt: meta.createdAt || meta.updatedAt || new Date().toISOString(),
        updatedAt: meta.updatedAt || meta.createdAt || new Date().toISOString(),
        thumb,
    };
}

async function readMetaRaw(id) {
    const metaPath = getMetaPath(id);
    try {
        const raw = await fsp.readFile(metaPath, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        if (err && err.code === 'ENOENT') return null;
        throw err;
    }
}

async function rebuildIndexUnlocked() {
    await ensureVaultDirs();
    let entries = [];
    try {
        entries = await fsp.readdir(ASSETS_DIR, { withFileTypes: true });
    } catch (_) {
        entries = [];
    }
    const rows = [];
    for (const ent of entries) {
        if (!ent.isDirectory() || ent.name.startsWith('.') || !isValidAssetId(ent.name)) continue;
        try {
            const meta = await readMetaRaw(ent.name);
            if (meta && meta.id === ent.name) {
                rows.push(buildIndexRow(meta));
            }
        } catch (_) {
            // Skip corrupt individual meta.json rather than breaking whole index
        }
    }
    rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const idx = { version: 1, assets: rows };
    await writeJsonAtomic(INDEX_FILE, idx);
    return idx;
}

async function readIndex() {
    try {
        const raw = await fsp.readFile(INDEX_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1 && Array.isArray(parsed.assets)) {
            return parsed;
        }
    } catch (_) {
        // Rebuild from meta.json files if missing or corrupt
    }
    return withWriteLock(() => rebuildIndexUnlocked());
}

async function upsertIndexRowUnlocked(meta) {
    let idx;
    try {
        const raw = await fsp.readFile(INDEX_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1 && Array.isArray(parsed.assets)) {
            idx = parsed;
        }
    } catch (_) {
        idx = null;
    }
    if (!idx) {
        return rebuildIndexUnlocked();
    }
    const row = buildIndexRow(meta);
    const pos = idx.assets.findIndex((a) => a.id === meta.id);
    if (pos >= 0) idx.assets[pos] = row;
    else idx.assets.unshift(row);
    await writeJsonAtomic(INDEX_FILE, idx);
    return idx;
}

async function removeIndexRowUnlocked(id) {
    let idx;
    try {
        const raw = await fsp.readFile(INDEX_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1 && Array.isArray(parsed.assets)) {
            idx = parsed;
        }
    } catch (_) {
        idx = null;
    }
    if (!idx) {
        return rebuildIndexUnlocked();
    }
    idx.assets = idx.assets.filter((a) => a.id !== id);
    await writeJsonAtomic(INDEX_FILE, idx);
    return idx;
}

function summarizeFacets(allAssets) {
    const tagCounts = new Map();
    const catCounts = new Map();
    for (const a of allAssets) {
        const c = normalizeCategory(a.category);
        catCounts.set(c, (catCounts.get(c) || 0) + 1);
        for (const t of (a.tags || [])) {
            tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
        }
    }
    const tags = Array.from(tagCounts.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    const categories = Array.from(catCounts.entries())
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
    return { tags, categories };
}

// ── File ingestion helper (supports {dataUrl,filename} or {path}) ────────────

function normalizeFileSpec(spec, fallbackFilename = '') {
    if (!spec) return null;
    if (typeof spec === 'string') {
        const s = spec.trim();
        if (!s) return null;
        if (s.startsWith('data:')) return { dataUrl: s, filename: fallbackFilename };
        return { path: s };
    }
    if (typeof spec === 'object') {
        if (spec.dataUrl) {
            return { dataUrl: String(spec.dataUrl), filename: String(spec.filename || fallbackFilename || '') };
        }
        if (spec.path) {
            return { path: String(spec.path), filename: String(spec.filename || path.basename(String(spec.path))) };
        }
        if (typeof spec.content === 'string') {
            return { content: spec.content, filename: String(spec.filename || fallbackFilename || '') };
        }
    }
    return null;
}

function extractFileSpecs(params = {}) {
    let modelSpec = normalizeFileSpec(params.model);
    if (!modelSpec && params.dataUrl) {
        modelSpec = normalizeFileSpec({ dataUrl: params.dataUrl, filename: params.filename });
    }
    if (!modelSpec && params.modelDataUrl) {
        modelSpec = normalizeFileSpec({ dataUrl: params.modelDataUrl, filename: params.modelFilename });
    }
    if (!modelSpec && params.modelPath) {
        modelSpec = normalizeFileSpec({ path: params.modelPath });
    }

    // Disambiguate params.source: could be file spec ({dataUrl,filename}|{path}|string)
    // OR provenance object ({type:'blender-script'|'upload'|'import', origin}).
    let sourceFileSpec = normalizeFileSpec(params.sourceFile);
    let sourceMeta = null;

    if (params.sourceMeta && typeof params.sourceMeta === 'object') {
        sourceMeta = params.sourceMeta;
    }

    if (params.source) {
        if (typeof params.source === 'string') {
            if (!sourceFileSpec) sourceFileSpec = normalizeFileSpec(params.source, 'source.py');
        } else if (typeof params.source === 'object') {
            if (params.source.dataUrl || params.source.path || typeof params.source.content === 'string') {
                if (!sourceFileSpec) sourceFileSpec = normalizeFileSpec(params.source, 'source.py');
            } else if (params.source.type) {
                sourceMeta = params.source;
            }
        }
    }
    if (!sourceFileSpec && params.sourceDataUrl) {
        sourceFileSpec = normalizeFileSpec({ dataUrl: params.sourceDataUrl, filename: params.sourceFilename || 'source.py' });
    }
    if (!sourceFileSpec && params.sourcePath) {
        sourceFileSpec = normalizeFileSpec({ path: params.sourcePath });
    }

    let previewSpec = normalizeFileSpec(params.preview);
    if (!previewSpec && params.previewDataUrl) {
        previewSpec = normalizeFileSpec({ dataUrl: params.previewDataUrl, filename: params.previewFilename || 'preview.png' });
    }
    if (!previewSpec && params.previewPath) {
        previewSpec = normalizeFileSpec({ path: params.previewPath });
    }

    return { modelSpec, sourceFileSpec, previewSpec, sourceMeta };
}

async function materializeVersionFiles(vDir, { modelSpec, sourceFileSpec, previewSpec }) {
    if (!modelSpec) {
        throw makeError('กรุณาแนบไฟล์โมเดล 3D (.glb, .gltf, .obj, .stl, .fbx, .ply หรือ .blend)', 400);
    }

    assertInsideDir(vDir, ASSETS_DIR, { allowHidden: false });
    await fsp.mkdir(vDir, { recursive: true });

    // 1. Model file
    let modelExt = '';
    let modelOrigName = '';
    let localModelPath = null;
    let modelBuffer = null;

    if (modelSpec.path) {
        localModelPath = await resolveAllowedLocalPath(modelSpec.path);
        modelOrigName = path.basename(localModelPath);
        modelExt = path.extname(modelOrigName).toLowerCase();
    } else if (modelSpec.dataUrl) {
        const parsed = parseDataUrl(modelSpec.dataUrl);
        modelBuffer = parsed.buffer;
        modelOrigName = path.basename(String(modelSpec.filename || 'model.glb'));
        modelExt = path.extname(modelOrigName).toLowerCase();
        if (!modelExt) {
            if (parsed.mime === 'model/gltf-binary') modelExt = '.glb';
            else if (parsed.mime === 'model/gltf+json') modelExt = '.gltf';
            else if (parsed.mime === 'model/stl') modelExt = '.stl';
        }
    } else {
        throw makeError('รูปแบบไฟล์โมเดลไม่ถูกต้อง', 400);
    }

    if (!MODEL_EXTS.has(modelExt)) {
        throw makeError(`ไม่รองรับนามสกุลไฟล์โมเดล '${modelExt || '(ไม่มี)'}' (รองรับ .glb .gltf .obj .stl .fbx .ply .blend)`, 400);
    }

    const finalGlbPath = path.join(vDir, 'model.glb');
    let originalFilename = null;

    if (modelExt === '.glb') {
        if (localModelPath) {
            await fsp.copyFile(localModelPath, finalGlbPath);
        } else {
            await fsp.writeFile(finalGlbPath, modelBuffer);
        }
        if (!(await verifyGlbHeader(finalGlbPath))) {
            throw makeError('ไฟล์ .glb ไม่ถูกต้อง (ไม่พบหัวไฟล์ glTF)', 400);
        }
    } else {
        originalFilename = `original${modelExt}`;
        const originalPath = path.join(vDir, originalFilename);
        if (localModelPath) {
            await fsp.copyFile(localModelPath, originalPath);
        } else {
            await fsp.writeFile(originalPath, modelBuffer);
        }
        await convertToGlb(originalPath, finalGlbPath);
    }

    // 2. Optional source .py script
    let sourceFilename = null;
    let sourceOrigName = null;
    if (sourceFileSpec) {
        const destSource = path.join(vDir, 'source.py');
        if (sourceFileSpec.path) {
            const realSrc = await resolveAllowedLocalPath(sourceFileSpec.path);
            const ext = path.extname(realSrc).toLowerCase();
            if (!SOURCE_EXTS.has(ext)) {
                throw makeError('ไฟล์สคริปต์ต้องเป็นนามสกุล .py เท่านั้น', 400);
            }
            await fsp.copyFile(realSrc, destSource);
            sourceOrigName = path.basename(realSrc);
            sourceFilename = 'source.py';
        } else if (sourceFileSpec.dataUrl) {
            const parsed = parseDataUrl(sourceFileSpec.dataUrl);
            const fn = path.basename(String(sourceFileSpec.filename || 'source.py'));
            const ext = path.extname(fn).toLowerCase() || '.py';
            if (!SOURCE_EXTS.has(ext)) {
                throw makeError('ไฟล์สคริปต์ต้องเป็นนามสกุล .py เท่านั้น', 400);
            }
            await fsp.writeFile(destSource, parsed.buffer);
            sourceOrigName = fn;
            sourceFilename = 'source.py';
        } else if (typeof sourceFileSpec.content === 'string') {
            const buf = Buffer.from(sourceFileSpec.content, 'utf8');
            if (buf.length > MAX_UPLOAD_BYTES) {
                throw makeError('ไฟล์สคริปต์มีขนาดใหญ่เกินกำหนด', 413);
            }
            await fsp.writeFile(destSource, buf);
            sourceOrigName = path.basename(String(sourceFileSpec.filename || 'source.py'));
            sourceFilename = 'source.py';
        }
    }

    // 3. Optional preview image
    let previewFilename = null;
    if (previewSpec) {
        if (previewSpec.path) {
            const realPrev = await resolveAllowedLocalPath(previewSpec.path);
            let ext = path.extname(realPrev).toLowerCase();
            if (!PREVIEW_EXTS.has(ext)) {
                throw makeError('ภาพพรีวิวรองรับเฉพาะ .png, .jpg หรือ .webp', 400);
            }
            if (ext === '.jpeg') ext = '.jpg';
            previewFilename = `preview${ext}`;
            await fsp.copyFile(realPrev, path.join(vDir, previewFilename));
        } else if (previewSpec.dataUrl) {
            const parsed = parseDataUrl(previewSpec.dataUrl);
            const fn = path.basename(String(previewSpec.filename || ''));
            let ext = MIME_TO_PREVIEW_EXT[parsed.mime] || path.extname(fn).toLowerCase();
            if (ext === '.jpeg') ext = '.jpg';
            if (!PREVIEW_EXTS.has(ext)) {
                throw makeError('ภาพพรีวิวรองรับเฉพาะ .png, .jpg หรือ .webp', 400);
            }
            previewFilename = `preview${ext}`;
            await fsp.writeFile(path.join(vDir, previewFilename), parsed.buffer);
        }
    }

    // 4. Inspect GLB stats, dimensions, size, sha256
    const st = await fsp.stat(finalGlbPath);
    const sha256 = await sha256File(finalGlbPath);
    const inspected = await inspectGlb(finalGlbPath);

    return {
        files: {
            model: 'model.glb',
            source: sourceFilename,
            preview: previewFilename,
            original: originalFilename,
        },
        sizeBytes: st.size,
        sha256,
        stats: inspected.stats || {},
        dimensions: inspected.dimensions || null,
        originName: sourceOrigName || modelOrigName,
        originPath: localModelPath || null,
        hasSource: Boolean(sourceFilename),
    };
}

// ── Public Manager API ───────────────────────────────────────────────────────

async function listAssets(opts = {}) {
    const idx = await readIndex();
    const all = Array.isArray(idx.assets) ? idx.assets : [];
    const { tags, categories } = summarizeFacets(all);

    const q = String(opts.q || '').trim().toLowerCase();
    const tagFilter = String(opts.tag || '').trim().toLowerCase();
    const catFilter = String(opts.category || '').trim().toLowerCase();
    const favFlag = opts.fav === true || opts.fav === 1 || opts.fav === '1' || opts.fav === 'true'
        || opts.favorite === true || opts.favorite === 1 || opts.favorite === '1' || opts.favorite === 'true';
    const sort = String(opts.sort || 'updated').trim().toLowerCase();

    const requiredTags = tagFilter ? tagFilter.split(',').map((s) => s.trim()).filter(Boolean) : [];

    let list = all.filter((a) => {
        if (favFlag && !a.favorite) return false;
        if (catFilter && catFilter !== 'all' && normalizeCategory(a.category) !== catFilter) return false;
        if (requiredTags.length) {
            const aTags = new Set((a.tags || []).map((t) => String(t).toLowerCase()));
            for (const rt of requiredTags) {
                if (!aTags.has(rt)) return false;
            }
        }
        if (q) {
            const hay = [
                a.id,
                a.name,
                a.description,
                a.category,
                ...(a.tags || []),
            ].join(' ').toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    list = list.slice();
    if (sort === 'name') {
        list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'th'));
    } else if (sort === 'size') {
        list.sort((a, b) => (Number(b.sizeBytes) || 0) - (Number(a.sizeBytes) || 0));
    } else {
        list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    }

    return {
        ok: true,
        assets: list,
        total: all.length,
        tags,
        categories,
    };
}

async function getAsset(id) {
    assertValidAssetId(id);
    return readMetaRaw(id);
}

async function createAsset(params = {}) {
    const name = String(params.name || '').trim();
    if (!name) {
        throw makeError('กรุณาระบุชื่อโมเดล 3D (name)', 400);
    }

    await ensureVaultDirs();
    const { modelSpec, sourceFileSpec, previewSpec, sourceMeta } = extractFileSpecs(params);

    let id = generateAssetId(name);
    while (fs.existsSync(path.join(ASSETS_DIR, id))) {
        id = generateAssetId(name);
    }

    const assetDir = getAssetDir(id);
    const vDir = path.join(assetDir, 'v1');
    const nowIso = new Date().toISOString();

    let mat;
    try {
        mat = await materializeVersionFiles(vDir, { modelSpec, sourceFileSpec, previewSpec });
    } catch (err) {
        await fsp.rm(assetDir, { recursive: true, force: true }).catch(() => {});
        throw err;
    }

    let resolvedSource;
    if (sourceMeta && sourceMeta.type) {
        const validTypes = new Set(['blender-script', 'upload', 'import']);
        resolvedSource = {
            type: validTypes.has(sourceMeta.type) ? sourceMeta.type : 'upload',
            origin: String(sourceMeta.origin || mat.originName || ''),
        };
    } else if (mat.hasSource) {
        resolvedSource = { type: 'blender-script', origin: mat.originName || 'source.py' };
    } else if (mat.originPath) {
        resolvedSource = { type: 'import', origin: mat.originPath };
    } else {
        resolvedSource = { type: 'upload', origin: mat.originName || 'upload' };
    }

    const meta = {
        id,
        name: name.slice(0, 160),
        description: String(params.description || '').trim().slice(0, 2000),
        category: normalizeCategory(params.category),
        tags: normalizeTags(params.tags),
        favorite: Boolean(params.favorite),
        createdAt: nowIso,
        updatedAt: nowIso,
        source: resolvedSource,
        dimensions: normalizeDimensions(params.dimensions) || mat.dimensions,
        versions: [
            {
                v: 1,
                createdAt: nowIso,
                note: String(params.note || '').trim().slice(0, 500),
                files: mat.files,
                sizeBytes: mat.sizeBytes,
                sha256: mat.sha256,
                stats: mat.stats,
            },
        ],
    };

    await withWriteLock(async () => {
        await writeJsonAtomic(getMetaPath(id), meta);
        await upsertIndexRowUnlocked(meta);
    });

    return meta;
}

async function addVersion(id, params = {}) {
    assertValidAssetId(id);
    const existing = await readMetaRaw(id);
    if (!existing) {
        throw makeError(`ไม่พบ asset '${id}'`, 404);
    }

    const { modelSpec, sourceFileSpec, previewSpec } = extractFileSpecs(params);
    const versions = Array.isArray(existing.versions) ? existing.versions : [];
    const maxV = versions.reduce((m, item) => Math.max(m, Number(item.v) || 0), 0);
    const nextV = maxV + 1;

    const assetDir = getAssetDir(id);
    const vDir = path.join(assetDir, `v${nextV}`);
    const nowIso = new Date().toISOString();

    let mat;
    try {
        mat = await materializeVersionFiles(vDir, { modelSpec, sourceFileSpec, previewSpec });
    } catch (err) {
        await fsp.rm(vDir, { recursive: true, force: true }).catch(() => {});
        throw err;
    }

    const updatedMeta = await withWriteLock(async () => {
        const fresh = await readMetaRaw(id);
        if (!fresh) {
            await fsp.rm(vDir, { recursive: true, force: true }).catch(() => {});
            throw makeError(`ไม่พบ asset '${id}'`, 404);
        }
        const entry = {
            v: nextV,
            createdAt: nowIso,
            note: String(params.note || '').trim().slice(0, 500),
            files: mat.files,
            sizeBytes: mat.sizeBytes,
            sha256: mat.sha256,
            stats: mat.stats,
        };
        fresh.versions = Array.isArray(fresh.versions) ? fresh.versions : [];
        fresh.versions.push(entry);
        fresh.updatedAt = nowIso;
        if (mat.dimensions) fresh.dimensions = mat.dimensions;
        if (params.dimensions) {
            const customDim = normalizeDimensions(params.dimensions);
            if (customDim) fresh.dimensions = customDim;
        }
        await writeJsonAtomic(getMetaPath(id), fresh);
        await upsertIndexRowUnlocked(fresh);
        return fresh;
    });

    return updatedMeta;
}

async function updateMeta(id, patch = {}) {
    assertValidAssetId(id);
    return withWriteLock(async () => {
        const meta = await readMetaRaw(id);
        if (!meta) {
            throw makeError(`ไม่พบ asset '${id}'`, 404);
        }
        if (patch.name !== undefined) {
            const n = String(patch.name || '').trim();
            if (!n) throw makeError('ชื่อโมเดลต้องไม่ว่างเปล่า', 400);
            meta.name = n.slice(0, 160);
        }
        if (patch.description !== undefined) {
            meta.description = String(patch.description || '').trim().slice(0, 2000);
        }
        if (patch.category !== undefined) {
            meta.category = normalizeCategory(patch.category);
        }
        if (patch.tags !== undefined) {
            meta.tags = normalizeTags(patch.tags);
        }
        if (patch.favorite !== undefined) {
            meta.favorite = Boolean(patch.favorite);
        }
        if (patch.dimensions !== undefined) {
            meta.dimensions = patch.dimensions === null ? null : normalizeDimensions(patch.dimensions);
        }
        if (patch.versionNote !== undefined || (patch.v !== undefined && patch.note !== undefined)) {
            const vNum = parseVersionNumber(patch.v ?? (meta.versions[meta.versions.length - 1]?.v));
            const ver = (meta.versions || []).find((item) => item.v === vNum);
            if (ver) {
                ver.note = String(patch.versionNote ?? patch.note ?? '').trim().slice(0, 500);
            }
        }
        meta.updatedAt = new Date().toISOString();
        await writeJsonAtomic(getMetaPath(id), meta);
        await upsertIndexRowUnlocked(meta);
        return meta;
    });
}

async function saveThumbnail(id, v, dataUrl) {
    assertValidAssetId(id);
    const { mime, buffer } = parseDataUrl(dataUrl);
    const ext = MIME_TO_PREVIEW_EXT[mime];
    if (!ext) {
        throw makeError('ภาพพรีวิวรองรับเฉพาะ image/png, image/jpeg หรือ image/webp', 400);
    }

    return withWriteLock(async () => {
        const meta = await readMetaRaw(id);
        if (!meta) {
            throw makeError(`ไม่พบ asset '${id}'`, 404);
        }
        const versions = Array.isArray(meta.versions) ? meta.versions : [];
        if (!versions.length) {
            throw makeError('asset นี้ยังไม่มีเวอร์ชัน', 400);
        }
        const vNum = v !== undefined && v !== null && v !== ''
            ? parseVersionNumber(v)
            : versions[versions.length - 1].v;
        const ver = versions.find((item) => item.v === vNum);
        if (!ver) {
            throw makeError(`ไม่พบเวอร์ชัน v${v}`, 404);
        }

        const vDir = path.join(getAssetDir(id), `v${ver.v}`);
        assertInsideDir(vDir, ASSETS_DIR, { allowHidden: false });
        await fsp.mkdir(vDir, { recursive: true });

        // Remove old preview file if extension changed
        if (ver.files && ver.files.preview && ver.files.preview !== `preview${ext}`) {
            const oldPath = path.join(vDir, ver.files.preview);
            await fsp.rm(oldPath, { force: true }).catch(() => {});
        }

        const previewFile = `preview${ext}`;
        const target = path.join(vDir, previewFile);
        assertInsideDir(target, ASSETS_DIR, { allowHidden: false });
        await fsp.writeFile(target, buffer);

        ver.files = ver.files || {};
        ver.files.preview = previewFile;
        meta.updatedAt = new Date().toISOString();
        await writeJsonAtomic(getMetaPath(id), meta);
        await upsertIndexRowUnlocked(meta);

        return {
            ok: true,
            id: meta.id,
            v: ver.v,
            thumb: buildThumbUrl(meta.id, ver.v, previewFile),
            asset: meta,
        };
    });
}

async function copyDirRecursive(srcDir, dstDir) {
    await fsp.mkdir(dstDir, { recursive: true });
    const entries = await fsp.readdir(srcDir, { withFileTypes: true });
    for (const ent of entries) {
        if (ent.name.startsWith('.')) continue;
        const src = path.join(srcDir, ent.name);
        const dst = path.join(dstDir, ent.name);
        if (ent.isDirectory()) {
            await copyDirRecursive(src, dst);
        } else if (ent.isFile()) {
            await fsp.copyFile(src, dst);
        }
    }
}

async function duplicateAsset(id, name) {
    assertValidAssetId(id);
    const orig = await readMetaRaw(id);
    if (!orig) {
        throw makeError(`ไม่พบ asset '${id}'`, 404);
    }

    const newName = String(name || `${orig.name} (สำเนา)`).trim().slice(0, 160);
    let newId = generateAssetId(newName);
    while (fs.existsSync(path.join(ASSETS_DIR, newId))) {
        newId = generateAssetId(newName);
    }

    const srcDir = getAssetDir(id);
    const dstDir = getAssetDir(newId);
    const nowIso = new Date().toISOString();

    await copyDirRecursive(srcDir, dstDir);

    const newMeta = {
        ...JSON.parse(JSON.stringify(orig)),
        id: newId,
        name: newName,
        favorite: false,
        createdAt: nowIso,
        updatedAt: nowIso,
    };

    await withWriteLock(async () => {
        await writeJsonAtomic(getMetaPath(newId), newMeta);
        await upsertIndexRowUnlocked(newMeta);
    });

    return newMeta;
}

async function deleteAsset(id, v) {
    assertValidAssetId(id);
    return withWriteLock(async () => {
        const meta = await readMetaRaw(id);
        if (!meta) {
            throw makeError(`ไม่พบ asset '${id}'`, 404);
        }

        await fsp.mkdir(TRASH_DIR, { recursive: true });
        const ts = Date.now();

        if (v !== undefined && v !== null && v !== '') {
            const vNum = parseVersionNumber(v);
            if (!vNum) throw makeError(`หมายเลขเวอร์ชันไม่ถูกต้อง: ${v}`, 400);
            const versions = Array.isArray(meta.versions) ? meta.versions : [];
            const idx = versions.findIndex((item) => item.v === vNum);
            if (idx < 0) throw makeError(`ไม่พบเวอร์ชัน v${vNum}`, 404);
            if (versions.length <= 1) {
                throw makeError('ไม่สามารถลบเวอร์ชันสุดท้ายได้ กรุณาลบทั้งโมเดลแทน', 400);
            }

            const vDir = path.join(getAssetDir(id), `v${vNum}`);
            const trashName = `${id}-v${vNum}-${ts}`;
            const trashDest = path.join(TRASH_DIR, trashName);
            assertInsideVault(trashDest, { allowHidden: true });
            if (fs.existsSync(vDir)) {
                await fsp.rename(vDir, trashDest);
            }

            meta.versions.splice(idx, 1);
            meta.updatedAt = new Date().toISOString();
            await writeJsonAtomic(getMetaPath(id), meta);
            await upsertIndexRowUnlocked(meta);

            return { ok: true, deleted: true, id, v: vNum, trashedTo: trashName, asset: meta };
        }

        const assetDir = getAssetDir(id);
        const trashName = `${id}-${ts}`;
        const trashDest = path.join(TRASH_DIR, trashName);
        assertInsideVault(trashDest, { allowHidden: true });
        await fsp.rename(assetDir, trashDest);
        await removeIndexRowUnlocked(id);

        return { ok: true, deleted: true, id, trashedTo: trashName };
    });
}

async function exportAsset(id, opts = {}) {
    assertValidAssetId(id);
    const meta = await readMetaRaw(id);
    if (!meta) {
        throw makeError(`ไม่พบ asset '${id}'`, 404);
    }
    const versions = Array.isArray(meta.versions) ? meta.versions : [];
    if (!versions.length) {
        throw makeError('asset นี้ยังไม่มีเวอร์ชันสำหรับส่งออก', 400);
    }

    const format = String(opts.format || 'zip').trim().toLowerCase().replace(/^\./, '');
    if (!EXPORT_FORMATS.has(format)) {
        throw makeError(`ไม่รองรับรูปแบบส่งออก '${format}' (รองรับ zip, glb, stl, obj, fbx, ply)`, 400);
    }

    const vRaw = opts.v;
    const isAll = vRaw === undefined || vRaw === null || vRaw === '' || String(vRaw).toLowerCase() === 'all';

    if (format === 'zip') {
        if (!fs.existsSync(ZIP_BIN)) {
            throw makeError('ไม่พบ /usr/bin/zip ในเครื่อง', 503);
        }

        let selectedVersions;
        let vSuffix = '';
        if (isAll) {
            selectedVersions = versions;
        } else {
            const vNum = parseVersionNumber(vRaw);
            const found = versions.find((item) => item.v === vNum);
            if (!found) throw makeError(`ไม่พบเวอร์ชัน v${vRaw}`, 404);
            selectedVersions = [found];
            vSuffix = `-v${found.v}`;
        }

        const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'vault3d-export-'));
        const stageDir = path.join(tmpRoot, 'bundle');
        const cleanup = async () => {
            await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
        };

        try {
            await fsp.mkdir(stageDir, { recursive: true });
            const exportMeta = {
                ...JSON.parse(JSON.stringify(meta)),
                versions: JSON.parse(JSON.stringify(selectedVersions)),
            };
            await fsp.writeFile(path.join(stageDir, 'meta.json'), JSON.stringify(exportMeta, null, 2) + '\n', 'utf8');

            const assetDir = getAssetDir(id);
            for (const ver of selectedVersions) {
                const srcV = path.join(assetDir, `v${ver.v}`);
                const dstV = path.join(stageDir, `v${ver.v}`);
                if (fs.existsSync(srcV)) {
                    await copyDirRecursive(srcV, dstV);
                }
            }

            const filename = `${meta.id}${vSuffix}.zip`;
            const zipPath = path.join(tmpRoot, filename);
            await execFileAsync(ZIP_BIN, ['-r', '-q', zipPath, '.'], {
                cwd: stageDir,
                timeout: ZIP_TIMEOUT_MS,
            });

            return {
                filePath: zipPath,
                filename,
                mime: 'application/zip',
                cleanup,
            };
        } catch (err) {
            await cleanup();
            throw err;
        }
    }

    // Single-model export (glb / stl / obj / fbx / ply)
    let targetVer;
    if (isAll || String(vRaw).toLowerCase() === 'latest') {
        targetVer = versions[versions.length - 1];
    } else {
        const vNum = parseVersionNumber(vRaw);
        targetVer = versions.find((item) => item.v === vNum);
        if (!targetVer) throw makeError(`ไม่พบเวอร์ชัน v${vRaw}`, 404);
    }

    const modelPath = path.join(getAssetDir(id), `v${targetVer.v}`, targetVer.files?.model || 'model.glb');
    assertInsideDir(modelPath, ASSETS_DIR, { allowHidden: false });
    if (!fs.existsSync(modelPath)) {
        throw makeError('ไม่พบไฟล์ model.glb ของเวอร์ชันที่เลือก', 404);
    }

    if (format === 'glb') {
        return {
            filePath: modelPath,
            filename: `${meta.id}-v${targetVer.v}.glb`,
            mime: MIME_BY_EXT['.glb'],
            cleanup: async () => {},
        };
    }

    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'vault3d-export-'));
    const cleanup = async () => {
        await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    };
    const filename = `${meta.id}-v${targetVer.v}.${format}`;
    const outPath = path.join(tmpRoot, filename);

    try {
        await convertFromGlb(modelPath, format, outPath);
        return {
            filePath: outPath,
            filename,
            mime: MIME_BY_EXT[`.${format}`] || 'application/octet-stream',
            cleanup,
        };
    } catch (err) {
        await cleanup();
        throw err;
    }
}

async function listFilesRecursive(dir, baseDir = dir) {
    const out = [];
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
        if (ent.name.startsWith('.') || ent.name === '__MACOSX') continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            const sub = await listFilesRecursive(full, baseDir);
            out.push(...sub);
        } else if (ent.isFile()) {
            out.push({ full, rel: path.relative(baseDir, full) });
        }
    }
    return out;
}

async function importZip(zipPath) {
    if (!fs.existsSync(UNZIP_BIN)) {
        throw makeError('ไม่พบ /usr/bin/unzip ในเครื่อง', 503);
    }
    const realZip = await resolveAllowedLocalPath(zipPath);

    // 1. Inspect archive entries before extracting (Zip Slip + dotfile guard)
    let entryListRaw;
    try {
        const res = await execFileAsync(UNZIP_BIN, ['-Z1', realZip], { timeout: ZIP_TIMEOUT_MS });
        entryListRaw = res.stdout;
    } catch (err) {
        throw makeError('ไฟล์ ZIP เสียหายหรือไม่ใช่ไฟล์ ZIP ที่ถูกต้อง', 400);
    }

    const entries = entryListRaw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!entries.length) {
        throw makeError('ไฟล์ ZIP ว่างเปล่า', 400);
    }

    for (const entry of entries) {
        if (entry.startsWith('/') || entry.startsWith('\\') || entry.includes('\0')) {
            throw makeError(`ปฏิเสธไฟล์ ZIP ที่มี path อันตราย: ${entry}`, 400);
        }
        const parts = entry.split(/[\\/]+/).filter(Boolean);
        for (const seg of parts) {
            if (seg === '..') {
                throw makeError(`ปฏิเสธไฟล์ ZIP ที่มี path traversal: ${entry}`, 400);
            }
            if (seg.startsWith('.') && seg !== '.') {
                throw makeError(`ปฏิเสธไฟล์ ZIP ที่มีไฟล์ซ่อนขึ้นต้นด้วยจุด: ${entry}`, 400);
            }
        }
    }

    // Check uncompressed size via unzip -Zt (summary line)
    try {
        const statRes = await execFileAsync(UNZIP_BIN, ['-Zt', realZip], { timeout: ZIP_TIMEOUT_MS });
        const m = statRes.stdout.match(/,\s*(\d+)\s+bytes\s+uncompressed/i);
        if (m && Number(m[1]) > MAX_ZIP_EXTRACT_BYTES) {
            throw makeError('ขนาดไฟล์หลังแตก ZIP เกินขีดจำกัด (250 MB)', 413);
        }
    } catch (err) {
        if (err.statusCode) throw err;
    }

    const tmpExtract = await fsp.mkdtemp(path.join(os.tmpdir(), 'vault3d-import-'));
    try {
        await execFileAsync(UNZIP_BIN, ['-q', '-o', realZip, '-d', tmpExtract], { timeout: ZIP_TIMEOUT_MS });

        // Locate vault bundle meta.json (at root or single top-level directory)
        let bundleRoot = null;
        if (fs.existsSync(path.join(tmpExtract, 'meta.json'))) {
            bundleRoot = tmpExtract;
        } else {
            const top = (await fsp.readdir(tmpExtract, { withFileTypes: true }))
                .filter((e) => !e.name.startsWith('.') && e.name !== '__MACOSX');
            if (top.length === 1 && top[0].isDirectory()) {
                const candidate = path.join(tmpExtract, top[0].name);
                if (fs.existsSync(path.join(candidate, 'meta.json'))) {
                    bundleRoot = candidate;
                }
            }
        }

        // Case A: Native 3D Asset Vault export bundle
        if (bundleRoot) {
            const rawMeta = JSON.parse(await fsp.readFile(path.join(bundleRoot, 'meta.json'), 'utf8'));
            const name = String(rawMeta.name || path.basename(realZip, '.zip')).trim().slice(0, 160);
            const rawVersions = Array.isArray(rawMeta.versions) ? rawMeta.versions : [];
            if (!rawVersions.length) {
                throw makeError('meta.json ในไฟล์ ZIP ไม่มีข้อมูลเวอร์ชัน', 400);
            }

            await ensureVaultDirs();
            let newId = generateAssetId(name);
            while (fs.existsSync(path.join(ASSETS_DIR, newId))) {
                newId = generateAssetId(name);
            }

            const assetDir = getAssetDir(newId);
            const nowIso = new Date().toISOString();
            const importedVersions = [];
            let latestDims = normalizeDimensions(rawMeta.dimensions);

            try {
                for (let i = 0; i < rawVersions.length; i++) {
                    const rv = rawVersions[i];
                    const origVNum = parseVersionNumber(rv.v) || (i + 1);
                    const srcVDir = path.join(bundleRoot, `v${origVNum}`);
                    assertInsideDir(srcVDir, tmpExtract, { allowHidden: false });

                    const modelRel = path.basename(String(rv.files?.model || 'model.glb'));
                    const srcModel = path.join(srcVDir, modelRel);
                    if (!fs.existsSync(srcModel)) {
                        throw makeError(`ไม่พบไฟล์ ${modelRel} ใน v${origVNum} ของไฟล์ ZIP`, 400);
                    }

                    const dstVNum = origVNum;
                    const dstVDir = path.join(assetDir, `v${dstVNum}`);
                    assertInsideDir(dstVDir, ASSETS_DIR, { allowHidden: false });
                    await fsp.mkdir(dstVDir, { recursive: true });

                    const dstModel = path.join(dstVDir, 'model.glb');
                    const mExt = path.extname(srcModel).toLowerCase();
                    if (mExt === '.glb') {
                        await fsp.copyFile(srcModel, dstModel);
                        if (!(await verifyGlbHeader(dstModel))) {
                            throw makeError(`ไฟล์ model.glb ใน v${origVNum} ไม่ถูกต้อง`, 400);
                        }
                    } else {
                        await convertToGlb(srcModel, dstModel);
                    }

                    let srcFile = null;
                    if (rv.files?.source) {
                        const sf = path.basename(String(rv.files.source));
                        const sfPath = path.join(srcVDir, sf);
                        if (fs.existsSync(sfPath) && path.extname(sf).toLowerCase() === '.py') {
                            await fsp.copyFile(sfPath, path.join(dstVDir, 'source.py'));
                            srcFile = 'source.py';
                        }
                    }

                    let prevFile = null;
                    if (rv.files?.preview) {
                        const pf = path.basename(String(rv.files.preview));
                        let pExt = path.extname(pf).toLowerCase();
                        if (pExt === '.jpeg') pExt = '.jpg';
                        const pfPath = path.join(srcVDir, pf);
                        if (fs.existsSync(pfPath) && PREVIEW_EXTS.has(pExt)) {
                            prevFile = `preview${pExt}`;
                            await fsp.copyFile(pfPath, path.join(dstVDir, prevFile));
                        }
                    }

                    let origFile = null;
                    if (rv.files?.original) {
                        const of = path.basename(String(rv.files.original));
                        const oExt = path.extname(of).toLowerCase();
                        const ofPath = path.join(srcVDir, of);
                        if (fs.existsSync(ofPath) && MODEL_EXTS.has(oExt)) {
                            origFile = `original${oExt}`;
                            await fsp.copyFile(ofPath, path.join(dstVDir, origFile));
                        }
                    }

                    const st = await fsp.stat(dstModel);
                    const sha256 = await sha256File(dstModel);
                    const inspected = await inspectGlb(dstModel);
                    if (inspected.dimensions) latestDims = inspected.dimensions;

                    importedVersions.push({
                        v: dstVNum,
                        createdAt: rv.createdAt || nowIso,
                        note: String(rv.note || '').trim().slice(0, 500),
                        files: {
                            model: 'model.glb',
                            source: srcFile,
                            preview: prevFile,
                            original: origFile,
                        },
                        sizeBytes: st.size,
                        sha256,
                        stats: inspected.stats || rv.stats || {},
                    });
                }
            } catch (err) {
                await fsp.rm(assetDir, { recursive: true, force: true }).catch(() => {});
                throw err;
            }

            importedVersions.sort((a, b) => a.v - b.v);

            const newMeta = {
                id: newId,
                name,
                description: String(rawMeta.description || '').trim().slice(0, 2000),
                category: normalizeCategory(rawMeta.category),
                tags: normalizeTags(rawMeta.tags),
                favorite: Boolean(rawMeta.favorite),
                createdAt: rawMeta.createdAt || nowIso,
                updatedAt: nowIso,
                source: {
                    type: 'import',
                    origin: path.basename(realZip),
                },
                dimensions: latestDims,
                versions: importedVersions,
            };

            await withWriteLock(async () => {
                await writeJsonAtomic(getMetaPath(newId), newMeta);
                await upsertIndexRowUnlocked(newMeta);
            });

            return newMeta;
        }

        // Case B: Generic 3D archive (no meta.json) — pick best 3D model + optional .py + preview
        const allFiles = await listFilesRecursive(tmpExtract);
        const priority = ['.glb', '.gltf', '.obj', '.stl', '.fbx', '.ply', '.blend'];
        let pickedModel = null;
        for (const ext of priority) {
            pickedModel = allFiles.find((f) => path.extname(f.full).toLowerCase() === ext);
            if (pickedModel) break;
        }
        if (!pickedModel) {
            throw makeError('ไม่พบไฟล์โมเดล 3D หรือ meta.json ภายในไฟล์ ZIP', 400);
        }
        const pickedSource = allFiles.find((f) => path.extname(f.full).toLowerCase() === '.py') || null;
        const pickedPreview = allFiles.find((f) => PREVIEW_EXTS.has(path.extname(f.full).toLowerCase())) || null;

        return await createAsset({
            name: path.basename(realZip, '.zip') || path.basename(pickedModel.full, path.extname(pickedModel.full)),
            category: 'other',
            tags: ['import'],
            note: `นำเข้าจาก ${path.basename(realZip)}`,
            model: { path: pickedModel.full },
            sourceFile: pickedSource ? { path: pickedSource.full } : null,
            preview: pickedPreview ? { path: pickedPreview.full } : null,
            sourceMeta: { type: 'import', origin: path.basename(realZip) },
        });
    } finally {
        await fsp.rm(tmpExtract, { recursive: true, force: true }).catch(() => {});
    }
}

async function importPath(params = {}) {
    const rawPath = typeof params === 'string' ? params : params.path;
    const realPath = await resolveAllowedLocalPath(rawPath);
    const ext = path.extname(realPath).toLowerCase();

    if (ext === '.zip') {
        return importZip(realPath);
    }

    if (params.assetId) {
        return addVersion(params.assetId, {
            model: { path: realPath },
            sourceFile: params.sourcePath ? { path: params.sourcePath } : params.sourceFile,
            preview: params.previewPath ? { path: params.previewPath } : params.preview,
            note: params.note || '',
        });
    }

    const baseName = path.basename(realPath, ext);
    return createAsset({
        name: params.name || baseName,
        description: params.description || '',
        category: params.category || 'other',
        tags: params.tags || [],
        favorite: Boolean(params.favorite),
        note: params.note || '',
        model: { path: realPath },
        sourceFile: params.sourcePath ? { path: params.sourcePath } : params.sourceFile,
        preview: params.previewPath ? { path: params.previewPath } : params.preview,
        sourceMeta: { type: 'import', origin: realPath },
    });
}

async function importOutputs() {
    const seeds = [
        {
            name: 'บ้านนกแอ่น 18x8 ม.',
            description: 'แบบจำลอง 3 มิติบ้านนกแอ่นขนาด 18x8 เมตร สร้างด้วยสคริปต์ Blender',
            category: 'building',
            tags: ['swiftlet', 'house', 'blender'],
            versions: [
                {
                    model: 'swiftlet_house_18x8m_livetest.glb',
                    source: 'build_swiftlet_house_18x8.py',
                    preview: 'swiftlet_house_18x8m_preview.png',
                    note: 'ต้นแบบแรก',
                },
                {
                    model: 'swiftlet_house_18x8m_v2_backup.glb',
                    source: 'build_swiftlet_house_18x8_live.py',
                    preview: 'swiftlet_house_18x8m_livetest_preview.png',
                    note: 'ลบประตูห้องครัว',
                },
                {
                    model: 'swiftlet_house_18x8m_v3.glb',
                    source: 'build_swiftlet_house_18x8_v3.py',
                    preview: 'swiftlet_house_18x8m_v3_preview.png',
                    note: 'เปลี่ยนหน้าต่างเป็นประตู',
                },
            ],
        },
        {
            name: 'Homelab 3D Core',
            description: 'โมเดล 3 มิติ Homelab 3D Core',
            category: 'device',
            tags: ['homelab', 'server'],
            versions: [
                {
                    model: 'homelab_3d_core.glb',
                    source: null,
                    preview: 'homelab_3d_core_preview.png',
                    note: 'ต้นฉบับจาก outputs/3d',
                },
            ],
        },
    ];

    let importedAssets = 0;
    let importedVersions = 0;
    let skippedVersions = 0;
    const touchedAssets = [];

    for (const seed of seeds) {
        const idx = await readIndex();
        const existingRow = (idx.assets || []).find((a) => a.name === seed.name);
        let assetMeta = existingRow ? await readMetaRaw(existingRow.id) : null;

        for (const sv of seed.versions) {
            const modelPath = path.join(OUTPUTS_3D_DIR, sv.model);
            if (!fs.existsSync(modelPath)) {
                skippedVersions++;
                continue;
            }
            const sourcePath = sv.source ? path.join(OUTPUTS_3D_DIR, sv.source) : null;
            const previewPath = sv.preview ? path.join(OUTPUTS_3D_DIR, sv.preview) : null;
            const hasSourceFile = Boolean(sourcePath && fs.existsSync(sourcePath));
            const hasPreviewFile = Boolean(previewPath && fs.existsSync(previewPath));

            const modelSha = await sha256File(modelPath);
            const sourceSha = hasSourceFile ? await sha256File(sourcePath) : null;

            // Idempotency check: skip if this version (matching sha256, and matching source.py sha256
            // when distinct scripts share an identical GLB) is already stored.
            if (assetMeta) {
                let duplicate = false;
                for (const ev of (assetMeta.versions || [])) {
                    if (ev.sha256 !== modelSha) continue;
                    if (!sourceSha) {
                        duplicate = true;
                        break;
                    }
                    if (ev.files && ev.files.source) {
                        const evSrcPath = path.join(getAssetDir(assetMeta.id), `v${ev.v}`, ev.files.source);
                        try {
                            const evSrcSha = await sha256File(evSrcPath);
                            if (evSrcSha === sourceSha) {
                                duplicate = true;
                                break;
                            }
                        } catch (_) { /* ignore */ }
                    } else if (ev.note === sv.note) {
                        duplicate = true;
                        break;
                    }
                }
                if (duplicate) {
                    skippedVersions++;
                    continue;
                }
            }

            if (!assetMeta) {
                assetMeta = await createAsset({
                    name: seed.name,
                    description: seed.description,
                    category: seed.category,
                    tags: seed.tags,
                    note: sv.note,
                    model: { path: modelPath },
                    sourceFile: hasSourceFile ? { path: sourcePath } : null,
                    preview: hasPreviewFile ? { path: previewPath } : null,
                    sourceMeta: {
                        type: hasSourceFile ? 'blender-script' : 'import',
                        origin: modelPath,
                    },
                });
                importedAssets++;
                importedVersions++;
            } else {
                assetMeta = await addVersion(assetMeta.id, {
                    note: sv.note,
                    model: { path: modelPath },
                    sourceFile: hasSourceFile ? { path: sourcePath } : null,
                    preview: hasPreviewFile ? { path: previewPath } : null,
                });
                importedVersions++;
            }
        }

        if (assetMeta) {
            touchedAssets.push({
                id: assetMeta.id,
                name: assetMeta.name,
                versionCount: (assetMeta.versions || []).length,
            });
        }
    }

    return {
        ok: true,
        importedAssets,
        importedVersions,
        skippedVersions,
        assets: touchedAssets,
    };
}

async function getStats() {
    const idx = await readIndex();
    const assets = Array.isArray(idx.assets) ? idx.assets : [];
    const { tags, categories } = summarizeFacets(assets);
    let totalVersions = 0;
    let totalSizeBytes = 0;
    let favoritesCount = 0;

    for (const a of assets) {
        totalVersions += Number(a.versionCount) || 0;
        totalSizeBytes += Number(a.totalSizeBytes ?? a.sizeBytes) || 0;
        if (a.favorite) favoritesCount++;
    }

    return {
        ok: true,
        vaultDir: VAULT_DIR,
        totalAssets: assets.length,
        totalVersions,
        totalSizeBytes,
        favoritesCount,
        categories,
        tags,
        blenderAvailable: fs.existsSync(BLENDER_BIN),
        zipAvailable: fs.existsSync(ZIP_BIN) && fs.existsSync(UNZIP_BIN),
    };
}

async function resolveSafeFile(id, v, filename) {
    if (!isValidAssetId(id)) return null;
    const vNum = parseVersionNumber(v);
    if (!vNum) return null;

    if (typeof filename !== 'string' || !filename) return null;
    if (
        filename.startsWith('.') ||
        filename.includes('..') ||
        filename.includes('/') ||
        filename.includes('\\') ||
        filename.includes('\0')
    ) {
        return null;
    }

    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_SERVE_EXTS.has(ext)) return null;

    const vDir = path.resolve(ASSETS_DIR, id, `v${vNum}`);
    const target = path.resolve(vDir, filename);

    const vaultPrefix = VAULT_DIR.endsWith(path.sep) ? VAULT_DIR : VAULT_DIR + path.sep;
    const assetsPrefix = ASSETS_DIR.endsWith(path.sep) ? ASSETS_DIR : ASSETS_DIR + path.sep;
    if (!target.startsWith(vaultPrefix) || !target.startsWith(assetsPrefix)) return null;
    if (path.dirname(target) !== vDir) return null;

    try {
        const lst = await fsp.lstat(target);
        if (lst.isSymbolicLink() || !lst.isFile()) return null;
        return {
            filePath: target,
            filename: path.basename(target),
            mime: MIME_BY_EXT[ext] || 'application/octet-stream',
            size: lst.size,
        };
    } catch (_) {
        return null;
    }
}

// ── HTTP Request Dispatcher ──────────────────────────────────────────────────

function safeDecode(seg) {
    try {
        return decodeURIComponent(seg);
    } catch (_) {
        throw makeError('URL encoding ไม่ถูกต้อง', 400);
    }
}

async function serveResolvedFile(req, res, url, info) {
    if (!info) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'File not found' }));
        return;
    }
    const headers = {
        'Content-Type': info.mime,
        'Content-Length': info.size,
        'Cache-Control': 'private, max-age=3600',
    };
    if (url.searchParams.get('download') === '1') {
        headers['Content-Disposition'] = `attachment; filename="${info.filename.replace(/["\\\r\n]/g, '')}"`;
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
        res.end();
        return;
    }
    await new Promise((resolve) => {
        const stream = fs.createReadStream(info.filePath);
        stream.on('error', () => {
            if (!res.writableEnded) res.end();
            resolve();
        });
        res.on('close', resolve);
        res.on('finish', resolve);
        stream.pipe(res);
    });
}

async function handleRequest(req, res, url, helpers = {}) {
    const { readJsonBody, sendJson, serveStatic } = helpers;
    const p = url.pathname;
    const method = (req.method || 'GET').toUpperCase();

    if (p === '/3d-vault' || p === '/3d-vault/') {
        if (method === 'GET' || method === 'HEAD') {
            await serveStatic(req, res, '/3d-vault.html');
            return true;
        }
    }

    if (p !== '/api/3d-vault' && !p.startsWith('/api/3d-vault/')) {
        return false;
    }

    if (p.startsWith('/api/3d-vault/ai/')) {
        return require('./asset-vault-ai').handleRequest(req, res, url, helpers);
    }

    try {
        // GET /api/3d-vault/stats
        if (method === 'GET' && p === '/api/3d-vault/stats') {
            sendJson(res, 200, await getStats());
            return true;
        }

        // GET /api/3d-vault/assets
        if (method === 'GET' && p === '/api/3d-vault/assets') {
            const result = await listAssets({
                q: url.searchParams.get('q') || '',
                tag: url.searchParams.get('tag') || '',
                category: url.searchParams.get('category') || '',
                fav: url.searchParams.get('fav') || url.searchParams.get('favorite') || '',
                sort: url.searchParams.get('sort') || 'updated',
            });
            sendJson(res, 200, result);
            return true;
        }

        // POST /api/3d-vault/assets
        if (method === 'POST' && p === '/api/3d-vault/assets') {
            const body = await readJsonBody(req, MAX_JSON_BODY_BYTES);
            const asset = await createAsset(body);
            sendJson(res, 201, { ok: true, asset });
            return true;
        }

        // POST /api/3d-vault/import-zip
        if (method === 'POST' && p === '/api/3d-vault/import-zip') {
            const body = await readJsonBody(req, MAX_JSON_BODY_BYTES);
            if (body && body.path) {
                const asset = await importZip(body.path);
                sendJson(res, 201, { ok: true, asset });
                return true;
            }
            if (!body || !body.dataUrl) {
                throw makeError('กรุณาแนบไฟล์ .zip (dataUrl หรือ path)', 400);
            }
            const { buffer } = parseDataUrl(body.dataUrl);
            const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vault3d-zipup-'));
            const safeName = path.basename(String(body.filename || 'import.zip')).replace(/[^a-zA-Z0-9._-]/g, '_') || 'import.zip';
            const tmpZip = path.join(tmpDir, safeName.endsWith('.zip') ? safeName : `${safeName}.zip`);
            try {
                await fsp.writeFile(tmpZip, buffer);
                const asset = await importZip(tmpZip);
                sendJson(res, 201, { ok: true, asset });
            } finally {
                await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
            }
            return true;
        }

        // POST /api/3d-vault/import-path
        if (method === 'POST' && p === '/api/3d-vault/import-path') {
            const body = await readJsonBody(req, 256 * 1024);
            const asset = await importPath(body);
            sendJson(res, 201, { ok: true, asset });
            return true;
        }

        // POST /api/3d-vault/import-outputs
        if (method === 'POST' && p === '/api/3d-vault/import-outputs') {
            const result = await importOutputs();
            sendJson(res, 200, result);
            return true;
        }

        // POST /api/3d-vault/reindex
        if (method === 'POST' && p === '/api/3d-vault/reindex') {
            await withWriteLock(() => rebuildIndexUnlocked());
            sendJson(res, 200, await listAssets());
            return true;
        }

        // File serving aliases: /api/3d-vault/files/:id/:v/:filename or /api/3d-vault/file/:id/:v/:filename
        if ((method === 'GET' || method === 'HEAD') && (p.startsWith('/api/3d-vault/files/') || p.startsWith('/api/3d-vault/file/'))) {
            const prefix = p.startsWith('/api/3d-vault/files/') ? '/api/3d-vault/files/' : '/api/3d-vault/file/';
            const parts = p.slice(prefix.length).split('/').filter(Boolean);
            if (parts.length === 3) {
                const id = safeDecode(parts[0]);
                const v = safeDecode(parts[1]);
                const filename = safeDecode(parts[2]);
                const info = await resolveSafeFile(id, v, filename);
                await serveResolvedFile(req, res, url, info);
                return true;
            }
            sendJson(res, 404, { ok: false, error: 'File not found' });
            return true;
        }

        // Per-asset routes: /api/3d-vault/assets/:id/...
        if (p.startsWith('/api/3d-vault/assets/')) {
            const rest = p.slice('/api/3d-vault/assets/'.length);
            const rawParts = rest.split('/').filter(Boolean);
            if (!rawParts.length) {
                sendJson(res, 404, { ok: false, error: 'Asset ID required' });
                return true;
            }
            const id = safeDecode(rawParts[0]);

            // /api/3d-vault/assets/:id
            if (rawParts.length === 1) {
                if (method === 'GET') {
                    const asset = await getAsset(id);
                    if (!asset) {
                        sendJson(res, 404, { ok: false, error: 'ไม่พบโมเดล 3D ที่ระบุ' });
                        return true;
                    }
                    sendJson(res, 200, { ok: true, asset });
                    return true;
                }
                if (method === 'PATCH' || method === 'PUT') {
                    const body = await readJsonBody(req, 256 * 1024);
                    const asset = await updateMeta(id, body);
                    sendJson(res, 200, { ok: true, asset });
                    return true;
                }
                if (method === 'DELETE') {
                    const vParam = url.searchParams.get('v');
                    const result = await deleteAsset(id, vParam || undefined);
                    sendJson(res, 200, result);
                    return true;
                }
            }

            const sub = safeDecode(rawParts[1]);

            // POST /api/3d-vault/assets/:id/versions
            if (rawParts.length === 2 && sub === 'versions' && method === 'POST') {
                const body = await readJsonBody(req, MAX_JSON_BODY_BYTES);
                const asset = await addVersion(id, body);
                const version = asset.versions[asset.versions.length - 1] || null;
                sendJson(res, 201, { ok: true, asset, version });
                return true;
            }

            // DELETE /api/3d-vault/assets/:id/versions/:v
            if (rawParts.length === 3 && sub === 'versions' && method === 'DELETE') {
                const v = safeDecode(rawParts[2]);
                const result = await deleteAsset(id, v);
                sendJson(res, 200, result);
                return true;
            }

            // POST /api/3d-vault/assets/:id/thumbnail
            if (rawParts.length === 2 && sub === 'thumbnail' && method === 'POST') {
                const body = await readJsonBody(req, 16 * 1024 * 1024);
                const v = body.v !== undefined ? body.v : url.searchParams.get('v');
                const result = await saveThumbnail(id, v, body.dataUrl);
                sendJson(res, 200, result);
                return true;
            }

            // POST /api/3d-vault/assets/:id/versions/:v/thumbnail
            if (rawParts.length === 4 && sub === 'versions' && safeDecode(rawParts[3]) === 'thumbnail' && method === 'POST') {
                const v = safeDecode(rawParts[2]);
                const body = await readJsonBody(req, 16 * 1024 * 1024);
                const result = await saveThumbnail(id, v, body.dataUrl);
                sendJson(res, 200, result);
                return true;
            }

            // POST /api/3d-vault/assets/:id/duplicate
            if (rawParts.length === 2 && sub === 'duplicate' && method === 'POST') {
                const body = await readJsonBody(req, 64 * 1024);
                const asset = await duplicateAsset(id, body.name);
                sendJson(res, 201, { ok: true, asset });
                return true;
            }

            // GET /api/3d-vault/assets/:id/export?v=N|all&format=zip|glb|stl|obj|fbx|ply
            if (rawParts.length === 2 && sub === 'export' && method === 'GET') {
                const v = url.searchParams.get('v') || undefined;
                const format = url.searchParams.get('format') || 'zip';
                const exp = await exportAsset(id, { v, format });
                try {
                    const st = await fsp.stat(exp.filePath);
                    res.writeHead(200, {
                        'Content-Type': exp.mime,
                        'Content-Length': st.size,
                        'Content-Disposition': `attachment; filename="${exp.filename.replace(/["\\\r\n]/g, '')}"`,
                        'Cache-Control': 'no-store',
                    });
                    await new Promise((resolve) => {
                        const stream = fs.createReadStream(exp.filePath);
                        stream.on('error', () => {
                            if (!res.writableEnded) res.end();
                            resolve();
                        });
                        res.on('close', resolve);
                        res.on('finish', resolve);
                        stream.pipe(res);
                    });
                } finally {
                    await exp.cleanup();
                }
                return true;
            }

            // File serving under /api/3d-vault/assets/:id/...
            if (method === 'GET' || method === 'HEAD') {
                // /api/3d-vault/assets/:id/files/:v/:filename
                // /api/3d-vault/assets/:id/file/:v/:filename
                // /api/3d-vault/assets/:id/versions/:v/:filename
                if (rawParts.length === 4 && (sub === 'files' || sub === 'file' || sub === 'versions')) {
                    const v = safeDecode(rawParts[2]);
                    const filename = safeDecode(rawParts[3]);
                    const info = await resolveSafeFile(id, v, filename);
                    await serveResolvedFile(req, res, url, info);
                    return true;
                }
                // /api/3d-vault/assets/:id/versions/:v/files/:filename
                if (rawParts.length === 5 && sub === 'versions' && safeDecode(rawParts[3]) === 'files') {
                    const v = safeDecode(rawParts[2]);
                    const filename = safeDecode(rawParts[4]);
                    const info = await resolveSafeFile(id, v, filename);
                    await serveResolvedFile(req, res, url, info);
                    return true;
                }
                // /api/3d-vault/assets/:id/v<N>/:filename
                if (rawParts.length === 3 && /^v\d+$/i.test(sub)) {
                    const filename = safeDecode(rawParts[2]);
                    const info = await resolveSafeFile(id, sub, filename);
                    await serveResolvedFile(req, res, url, info);
                    return true;
                }
            }
        }

        sendJson(res, 404, { ok: false, error: '3D Vault route not found' });
        return true;
    } catch (err) {
        const status = err && Number.isInteger(err.statusCode) ? err.statusCode : 400;
        if (!res.headersSent) {
            sendJson(res, status, { ok: false, error: err ? err.message : 'Internal error' });
        } else if (!res.writableEnded) {
            res.end();
        }
        return true;
    }
}

module.exports = {
    handleRequest,
    listAssets,
    getAsset,
    createAsset,
    addVersion,
    updateMeta,
    saveThumbnail,
    duplicateAsset,
    deleteAsset,
    exportAsset,
    importZip,
    importPath,
    importOutputs,
    getStats,
    convertToGlb,
    convertFromGlb,
    resolveSafeFile,
    VAULT_DIR,
    withBlenderLock,
    execFileAsync,
    inspectGlb,
    getAssetDir,
    readMetaRaw,
    BLENDER_BIN,
    OUTPUTS_3D_DIR,
    makeError,
    assertValidAssetId,
};
