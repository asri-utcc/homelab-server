'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
process.env.VAULT_DIR = path.join(tmp, 'vault');

const vault = require('../asset-vault-manager');

/**
 * Build a minimal valid binary glTF 2.0 (.glb) buffer with 1 triangle
 * spanning [0..width, 0..height, 0..depth].
 */
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
    jsonHdr.writeUInt32LE(0x4E4F534A, 4); // JSON

    const binHdr = Buffer.alloc(8);
    binHdr.writeUInt32LE(binBuf.length, 0);
    binHdr.writeUInt32LE(0x004E4942, 4); // BIN

    return Buffer.concat([header, jsonHdr, jsonBuf, binHdr, binBuf]);
}

// 1x1 transparent PNG
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const TINY_PNG_DATAURL = `data:image/png;base64,${TINY_PNG_B64}`;

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

async function runTests() {
    assert.strictEqual(vault.VAULT_DIR, path.resolve(process.env.VAULT_DIR));

    const glb1 = makeMinimalGlb(2, 3, 4);
    const glb2 = makeMinimalGlb(5, 6, 7);
    const pyScript = 'import bpy\nprint("hello 3d vault")\n';

    // 1. Create asset via dataUrl (HTTP style)
    const created1 = await vault.createAsset({
        name: 'Test Chair #1',
        description: 'เก้าอี้ทดสอบ',
        category: 'furniture',
        tags: ['Wood', 'chair', 'wood'],
        note: 'เวอร์ชันเริ่มต้น',
        model: { dataUrl: toDataUrl(glb1, 'model/gltf-binary'), filename: 'chair.glb' },
        source: { dataUrl: toDataUrl(Buffer.from(pyScript, 'utf8'), 'text/x-python'), filename: 'chair.py' },
        preview: { dataUrl: TINY_PNG_DATAURL, filename: 'preview.png' },
    });

    assert(/^[a-z0-9-]+-[0-9a-f]{6}$/.test(created1.id), 'valid slug-hex id: ' + created1.id);
    assert.strictEqual(created1.name, 'Test Chair #1');
    assert.strictEqual(created1.category, 'furniture');
    assert.deepStrictEqual(created1.tags, ['wood', 'chair']);
    assert.strictEqual(created1.versions.length, 1);
    assert.strictEqual(created1.versions[0].v, 1);
    assert.strictEqual(created1.versions[0].files.model, 'model.glb');
    assert.strictEqual(created1.versions[0].files.source, 'source.py');
    assert.strictEqual(created1.versions[0].files.preview, 'preview.png');
    assert.strictEqual(created1.versions[0].stats.triangles, 1);
    assert.strictEqual(created1.versions[0].stats.meshes, 1);
    assert.deepStrictEqual(created1.dimensions, { x: 2, y: 3, z: 4 });
    assert.strictEqual(created1.source.type, 'blender-script');

    // 2. Create 2nd asset via local file path (CLI style)
    const localGlbPath = path.join(tmp, 'device_box.glb');
    await fsp.writeFile(localGlbPath, glb2);
    const created2 = await vault.createAsset({
        name: 'กล่องเซิร์ฟเวอร์',
        category: 'device',
        tags: ['homelab', 'rack'],
        note: 'นำเข้าจากพาธ',
        model: { path: localGlbPath },
    });
    assert.strictEqual(created2.category, 'device');
    assert.strictEqual(created2.source.type, 'import');
    assert.deepStrictEqual(created2.dimensions, { x: 5, y: 6, z: 7 });

    // 3. List, search, tag, category, favorite, sort + index rebuild
    const allList = await vault.listAssets();
    assert.strictEqual(allList.ok, true);
    assert.strictEqual(allList.assets.length, 2);
    assert(allList.tags.some((t) => t.tag === 'chair' && t.count === 1));
    assert(allList.categories.some((c) => c.category === 'furniture' && c.count === 1));

    const searchQ = await vault.listAssets({ q: 'เก้าอี้' });
    assert.strictEqual(searchQ.assets.length, 1);
    assert.strictEqual(searchQ.assets[0].id, created1.id);

    const searchTag = await vault.listAssets({ tag: 'homelab' });
    assert.strictEqual(searchTag.assets.length, 1);
    assert.strictEqual(searchTag.assets[0].id, created2.id);

    const searchCat = await vault.listAssets({ category: 'furniture' });
    assert.strictEqual(searchCat.assets.length, 1);

    // Delete index.json and confirm automatic rebuild
    await fsp.unlink(path.join(vault.VAULT_DIR, 'index.json'));
    const rebuilt = await vault.listAssets({ sort: 'name' });
    assert.strictEqual(rebuilt.assets.length, 2);
    assert(fs.existsSync(path.join(vault.VAULT_DIR, 'index.json')));

    // 4. Patch metadata + favorite filter + saveThumbnail
    const patched = await vault.updateMeta(created1.id, {
        name: 'Test Chair Updated',
        description: 'อัปเดตแล้ว',
        tags: ['wood', 'chair', 'featured'],
        favorite: true,
    });
    assert.strictEqual(patched.name, 'Test Chair Updated');
    assert.strictEqual(patched.favorite, true);
    assert.deepStrictEqual(patched.tags, ['wood', 'chair', 'featured']);

    const favList = await vault.listAssets({ fav: '1' });
    assert.strictEqual(favList.assets.length, 1);
    assert.strictEqual(favList.assets[0].id, created1.id);

    const thumbRes = await vault.saveThumbnail(created2.id, 1, TINY_PNG_DATAURL);
    assert.strictEqual(thumbRes.ok, true);
    assert(thumbRes.thumb.includes(`/assets/${created2.id}/files/v1/preview.png`));

    // 5. Add version
    const withV2 = await vault.addVersion(created1.id, {
        note: 'ขยายขนาดเวอร์ชัน 2',
        model: { dataUrl: toDataUrl(glb2, 'model/gltf-binary'), filename: 'chair_v2.glb' },
        source: { content: 'import bpy\n# v2\n', filename: 'chair_v2.py' },
    });
    assert.strictEqual(withV2.versions.length, 2);
    assert.strictEqual(withV2.versions[1].v, 2);
    assert.strictEqual(withV2.versions[1].note, 'ขยายขนาดเวอร์ชัน 2');
    assert.deepStrictEqual(withV2.dimensions, { x: 5, y: 6, z: 7 });

    // 6. Duplicate asset
    const dup = await vault.duplicateAsset(created1.id, 'Chair Clone');
    assert.notStrictEqual(dup.id, created1.id);
    assert.strictEqual(dup.name, 'Chair Clone');
    assert.strictEqual(dup.versions.length, 2);
    const dupFile = await vault.resolveSafeFile(dup.id, 2, 'model.glb');
    assert(dupFile && dupFile.size === glb2.length);

    // 7. Export ZIP & Import ZIP round-trip
    const expZip = await vault.exportAsset(created1.id, { v: 'all', format: 'zip' });
    assert(fs.existsSync(expZip.filePath), 'exported zip exists');
    assert.strictEqual(expZip.mime, 'application/zip');
    assert((await fsp.stat(expZip.filePath)).size > 0);

    const reimported = await vault.importZip(expZip.filePath);
    assert.notStrictEqual(reimported.id, created1.id);
    assert.strictEqual(reimported.name, patched.name);
    assert.strictEqual(reimported.category, patched.category);
    assert.deepStrictEqual(reimported.tags, patched.tags);
    assert.strictEqual(reimported.versions.length, 2);
    assert.strictEqual(reimported.versions[0].sha256, withV2.versions[0].sha256);
    assert.strictEqual(reimported.versions[1].sha256, withV2.versions[1].sha256);
    assert.strictEqual(reimported.versions[0].files.source, 'source.py');
    assert.strictEqual(reimported.versions[0].files.preview, 'preview.png');
    await expZip.cleanup();
    assert(!fs.existsSync(expZip.filePath), 'cleanup removes temporary zip');

    // 8. Soft-delete version and whole asset
    const delV = await vault.deleteAsset(dup.id, 1);
    assert.strictEqual(delV.ok, true);
    assert.strictEqual(delV.v, 1);
    const dupAfterV1 = await vault.getAsset(dup.id);
    assert.strictEqual(dupAfterV1.versions.length, 1);

    const delAll = await vault.deleteAsset(dup.id);
    assert.strictEqual(delAll.ok, true);
    assert.strictEqual(await vault.getAsset(dup.id), null);
    assert(fs.existsSync(path.join(vault.VAULT_DIR, '.trash', delAll.trashedTo)), 'moved to .trash');

    // 9. Path traversal, dotfiles, and outside-root path rejections
    assert.strictEqual(await vault.resolveSafeFile('../etc', 1, 'passwd'), null);
    assert.strictEqual(await vault.resolveSafeFile('.trash', 1, 'model.glb'), null);
    assert.strictEqual(await vault.resolveSafeFile(created1.id, '../v1', 'model.glb'), null);
    assert.strictEqual(await vault.resolveSafeFile(created1.id, 1, '../meta.json'), null);
    assert.strictEqual(await vault.resolveSafeFile(created1.id, 1, '.hidden.glb'), null);
    assert.strictEqual(await vault.resolveSafeFile(created1.id, 1, '/etc/passwd'), null);
    assert.strictEqual(await vault.resolveSafeFile(created1.id, 1, 'meta.json'), null);

    await assert.rejects(
        () => vault.importPath({ path: '/etc/hosts' }),
        /ไม่อนุญาต/
    );
    await assert.rejects(
        () => vault.createAsset({ name: 'Bad Path', model: { path: '/etc/passwd' } }),
        /ไม่อนุญาต/
    );

    // Reject malicious Zip Slip archive
    const evilZip = path.join(tmp, 'evil.zip');
    const evilDir = path.join(tmp, 'evil_src');
    await fsp.mkdir(evilDir, { recursive: true });
    await fsp.writeFile(path.join(evilDir, 'ok.txt'), 'x');
    // Build a crafted zip with "../escape.txt" entry via python3 zipfile (always available on Debian)
    execFileSync('python3', [
        '-c',
        'import sys, zipfile; z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("../escape.txt","pwn"); z.close()',
        evilZip,
    ]);
    await assert.rejects(() => vault.importZip(evilZip), /path traversal/i);

    // 10. HTTP handleRequest check
    const srv = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const readJsonBody = (r, max = 1024 * 1024) => new Promise((resolve, reject) => {
            let raw = '';
            r.on('data', (c) => { raw += c; if (raw.length > max) reject(new Error('too large')); });
            r.on('end', () => resolve(raw.trim() ? JSON.parse(raw) : {}));
            r.on('error', reject);
        });
        const sendJson = (r, code, obj) => {
            r.writeHead(code, { 'Content-Type': 'application/json' });
            r.end(JSON.stringify(obj));
        };
        const serveStatic = async (_r, r, p) => {
            r.writeHead(200, { 'Content-Type': 'text/html' });
            r.end(`static:${p}`);
        };
        const handled = await vault.handleRequest(req, res, url, { readJsonBody, sendJson, serveStatic });
        if (!handled) {
            res.writeHead(404);
            res.end('unhandled');
        }
    });
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const port = srv.address().port;
    try {
        const unmatched = await httpReq(port, 'GET', '/api/something-else');
        assert.strictEqual(unmatched.status, 404);
        assert.strictEqual(unmatched.body.toString(), 'unhandled');

        const pageRes = await httpReq(port, 'GET', '/3d-vault');
        assert.strictEqual(pageRes.status, 200);
        assert.strictEqual(pageRes.body.toString(), 'static:/3d-vault.html');

        const statsRes = await httpReq(port, 'GET', '/api/3d-vault/stats');
        assert.strictEqual(statsRes.status, 200);
        const statsJson = JSON.parse(statsRes.body.toString());
        assert.strictEqual(statsJson.ok, true);
        assert.strictEqual(statsJson.totalAssets, 3);

        const fileRes = await httpReq(port, 'GET', `/api/3d-vault/assets/${created1.id}/files/v1/model.glb`);
        assert.strictEqual(fileRes.status, 200);
        assert.strictEqual(fileRes.body.toString('ascii', 0, 4), 'glTF');

        const travRes = await httpReq(port, 'GET', `/api/3d-vault/assets/${created1.id}/files/v1/%2e%2e%2fmeta.json`);
        assert.strictEqual(travRes.status, 404);

        const dotRes = await httpReq(port, 'GET', `/api/3d-vault/assets/${created1.id}/files/v1/.secret.glb`);
        assert.strictEqual(dotRes.status, 404);

        const expHttp = await httpReq(port, 'GET', `/api/3d-vault/assets/${created1.id}/export?format=zip`);
        assert.strictEqual(expHttp.status, 200);
        assert.strictEqual(expHttp.body.toString('ascii', 0, 2), 'PK');
    } finally {
        await new Promise((resolve) => srv.close(resolve));
    }

    // 11. Blender conversion: OBJ -> GLB and GLB -> STL
    if (fs.existsSync('/usr/bin/blender')) {
        const objPath = path.join(tmp, 'tri.obj');
        const outGlb = path.join(tmp, 'tri.glb');
        const outStl = path.join(tmp, 'tri.stl');
        await fsp.writeFile(objPath, [
            'o Triangle',
            'v 0.0 0.0 0.0',
            'v 2.0 0.0 0.0',
            'v 0.0 3.0 0.0',
            'f 1 2 3',
            '',
        ].join('\n'), 'utf8');

        const toGlb = await vault.convertToGlb(objPath, outGlb);
        assert(fs.existsSync(toGlb.outputPath), 'converted GLB exists');
        assert(toGlb.sizeBytes > 0, 'converted GLB non-empty');
        const glbBuf = await fsp.readFile(outGlb);
        assert.strictEqual(glbBuf.toString('ascii', 0, 4), 'glTF', 'GLB magic header is glTF');

        const fromGlb = await vault.convertFromGlb(outGlb, 'stl', outStl);
        assert(fs.existsSync(fromGlb.outputPath), 'converted STL exists');
        assert(fromGlb.sizeBytes > 0, 'converted STL non-empty');

        // Also test ingesting OBJ directly into vault + exporting as STL
        const objAsset = await vault.createAsset({
            name: 'Triangle OBJ',
            category: 'part',
            tags: ['obj', 'test'],
            model: { path: objPath },
        });
        assert.strictEqual(objAsset.versions[0].files.model, 'model.glb');
        assert.strictEqual(objAsset.versions[0].files.original, 'original.obj');

        const expStl = await vault.exportAsset(objAsset.id, { format: 'stl' });
        assert(fs.existsSync(expStl.filePath) && (await fsp.stat(expStl.filePath)).size > 0);
        assert.strictEqual(expStl.mime, 'model/stl');
        await expStl.cleanup();
    } else {
        console.log('SKIP: /usr/bin/blender not found, skipping Blender OBJ->GLB / GLB->STL tests');
    }

    // 12. importOutputs() idempotency test (into isolated tmp vault only)
    const outputsDir = path.join(os.homedir(), '.gemini', 'outputs', '3d');
    if (fs.existsSync(path.join(outputsDir, 'swiftlet_house_18x8m_v3.glb')) && fs.existsSync(path.join(outputsDir, 'homelab_3d_core.glb'))) {
        const seed1 = await vault.importOutputs();
        assert.strictEqual(seed1.ok, true);
        assert.strictEqual(seed1.importedAssets, 2);
        assert.strictEqual(seed1.importedVersions, 4);
        const swiftlet = seed1.assets.find((a) => a.name === 'บ้านนกแอ่น 18x8 ม.');
        const core = seed1.assets.find((a) => a.name === 'Homelab 3D Core');
        assert(swiftlet && swiftlet.versionCount === 3, 'swiftlet has 3 versions');
        assert(core && core.versionCount === 1, 'homelab core has 1 version');

        // Second run must be completely idempotent
        const seed2 = await vault.importOutputs();
        assert.strictEqual(seed2.ok, true);
        assert.strictEqual(seed2.importedAssets, 0);
        assert.strictEqual(seed2.importedVersions, 0);
        assert.strictEqual(seed2.skippedVersions, 4);
    }
}

runTests()
    .then(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
        console.log('asset-vault tests OK');
    })
    .catch((err) => {
        fs.rmSync(tmp, { recursive: true, force: true });
        console.error(err);
        process.exit(1);
    });
