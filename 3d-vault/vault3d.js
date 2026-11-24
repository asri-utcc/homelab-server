#!/usr/bin/env node
'use strict';

/**
 * vault3d.js
 * -----------------------------------------------------------------------------
 * Zero-dependency CLI for the Homelab 3D Asset Vault.
 * Calls /home/dev/projects/lab-dashboard/asset-vault-manager.js directly
 * so local scripts and AI agents can manage assets without HTTP login cookies.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const DEFAULT_MANAGER_PATH = '/home/dev/projects/lab-dashboard/asset-vault-manager.js';
const PUBLIC_BASE_URL = process.env.VAULT_PUBLIC_URL || 'https://homelab.tail285279.ts.net/3d-vault';

process.stdout.on('error', (err) => {
    if (err && err.code === 'EPIPE') process.exit(0);
});

const BOOLEAN_FLAGS = new Set([
    'help', 'h',
    'json', 'j',
    'fav', 'favorite',
]);

const VALUE_FLAGS = new Set([
    'q', 'query',
    'tag', 'tags', 't',
    'category', 'cat', 'c',
    'sort',
    'name', 'n',
    'desc', 'description', 'd',
    'source', 's',
    'preview', 'p',
    'note', 'm',
    'v', 'version',
    'format', 'f',
    'out', 'o',
    'asset', 'asset-id',
    'vault',
]);

function parseBooleanValue(val) {
    if (val === undefined) return true;
    const s = String(val).trim().toLowerCase();
    if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
    return true;
}

function applyFlag(opts, key, val) {
    switch (key) {
        case 'h':
        case 'help':
            opts.help = true;
            break;
        case 'j':
        case 'json':
            opts.json = parseBooleanValue(val);
            break;
        case 'fav':
        case 'favorite':
            opts.favorite = parseBooleanValue(val);
            break;
        case 'q':
        case 'query':
            opts.q = val;
            break;
        case 't':
        case 'tag':
        case 'tags':
            opts.tags = opts.tags ? `${opts.tags},${val}` : val;
            break;
        case 'c':
        case 'cat':
        case 'category':
            opts.category = val;
            break;
        case 'sort':
            opts.sort = val;
            break;
        case 'n':
        case 'name':
            opts.name = val;
            break;
        case 'd':
        case 'desc':
        case 'description':
            opts.description = val;
            break;
        case 's':
        case 'source':
            opts.source = val;
            break;
        case 'p':
        case 'preview':
            opts.preview = val;
            break;
        case 'm':
        case 'note':
            opts.note = val;
            break;
        case 'v':
        case 'version':
            opts.v = val;
            break;
        case 'f':
        case 'format':
            opts.format = val;
            break;
        case 'o':
        case 'out':
            opts.out = val;
            break;
        case 'asset':
        case 'asset-id':
            opts.assetId = val;
            break;
        case 'vault':
            opts.vault = val;
            break;
        default:
            throw new Error(`ไม่รู้จัก option '--${key}' (รัน vault3d --help เพื่อดูวิธีใช้)`);
    }
}

function parseArgs(argv) {
    const positionals = [];
    const opts = {
        json: false,
        help: false,
    };
    let stopFlags = false;

    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (stopFlags) {
            positionals.push(token);
            continue;
        }
        if (token === '--') {
            stopFlags = true;
            continue;
        }
        if (!token.startsWith('-') || token === '-') {
            positionals.push(token);
            continue;
        }

        let key;
        let inlineVal;
        if (token.startsWith('--')) {
            const eq = token.indexOf('=');
            if (eq !== -1) {
                key = token.slice(2, eq);
                inlineVal = token.slice(eq + 1);
            } else {
                key = token.slice(2);
            }
        } else {
            key = token.slice(1);
        }

        if (BOOLEAN_FLAGS.has(key)) {
            applyFlag(opts, key, inlineVal);
            continue;
        }
        if (VALUE_FLAGS.has(key)) {
            const val = inlineVal !== undefined ? inlineVal : argv[++i];
            if (val === undefined) {
                throw new Error(`Option '--${key}' ต้องระบุค่า`);
            }
            applyFlag(opts, key, val);
            continue;
        }

        throw new Error(`ไม่รู้จัก option '${token}' (รัน vault3d --help เพื่อดูวิธีใช้)`);
    }

    return { positionals, opts };
}

function resolveCanonicalGeminiDir() {
    const fixed = '/home/dev/.gemini';
    if (fs.existsSync(fixed)) return fixed;
    return path.join(os.homedir(), '.gemini');
}

function loadManager(opts) {
    const geminiDir = resolveCanonicalGeminiDir();
    if (opts && opts.vault) {
        process.env.VAULT_DIR = path.resolve(opts.vault);
    } else if (!process.env.VAULT_DIR) {
        process.env.VAULT_DIR = path.join(geminiDir, '3d-vault');
    }
    if (!process.env.OUTPUTS_3D_DIR) {
        process.env.OUTPUTS_3D_DIR = path.join(geminiDir, 'outputs', '3d');
    }
    const managerPath = process.env.VAULT_MANAGER_PATH || DEFAULT_MANAGER_PATH;
    return require(managerPath);
}

function assetWebUrl(id) {
    return `${PUBLIC_BASE_URL.replace(/\/+$/, '')}#asset=${encodeURIComponent(id)}`;
}

function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDimensions(dim) {
    if (!dim || typeof dim !== 'object') return '-';
    return `${dim.x} x ${dim.y} x ${dim.z} m`;
}

function printJson(obj) {
    process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function showHelp() {
    const text = `3D Asset Vault CLI (vault3d)
จัดการคลังโมเดล 3 มิติแบบแยกเวอร์ชัน (.glb, .py, preview, metadata) โดยไม่ผ่าน HTTP

การใช้งาน:
  vault3d <command> [arguments] [options]

คำสั่งหลัก:
  list [--q <word>] [--tag <a,b>] [--category <cat>] [--fav] [--sort updated|name|size] [--json]
      แสดงรายการโมเดลทั้งหมดในคลังหรือค้นหาตามคำค้น/แท็ก/หมวดหมู่

  show <id> [--json]
      แสดงรายละเอียด metadata และประวัติเวอร์ชันทั้งหมดของโมเดล

  add <model> [--name <title>] [--tags <a,b>] [--category <cat>] [--desc <text>]
      [--source <script.py>] [--preview <img.png>] [--note <text>] [--fav] [--json]
      เพิ่มโมเดล 3 มิติใหม่เข้าคลัง (สร้าง v1 พร้อมแปลงเป็น GLB อัตโนมัติหากเป็นไฟล์สกุลอื่น)

  add-version <id> <model> [--source <script.py>] [--preview <img.png>] [--note <text>] [--json]
      เพิ่มเวอร์ชันใหม่ (v+1) ให้โมเดลเดิม

  export <id> [--v <N|all|latest>] [--format <zip|glb|stl|obj|fbx|ply>] [--out <path>] [--json]
      ส่งออกโมเดลเป็นไฟล์ .zip (รวม meta.json + เวอร์ชัน) หรือแปลงไฟล์ 3D ด้วย Blender

  import <zip-or-model> [--asset <id>] [--name <title>] [--category <cat>] [--tags <a,b>]
      [--source <script.py>] [--preview <img.png>] [--note <text>] [--json]
      นำเข้าไฟล์ .zip ที่ export จากคลัง (หรือไฟล์ 3D เดี่ยวจาก /home/dev/.gemini, /home/dev/projects, /tmp)

  import-outputs [--json]
      นำเข้างาน 3 มิติตั้งต้นจาก ~/.gemini/outputs/3d แบบ idempotent (ไม่ทับ/ไม่ซ้ำ/ไม่ลบต้นฉบับ)

  stats [--json]
      แสดงสถิติคลัง 3D Asset Vault และความพร้อมของ Blender / ZIP

คำสั่งเสริม:
  update <id> [--name <title>] [--desc <text>] [--category <cat>] [--tags <a,b>]
      [--fav[=true|false]] [--v <N> --note <text>] [--json]
      แก้ไขข้อมูลเมตาหรือหมายเหตุเวอร์ชัน

  duplicate <id> [--name <title>] [--json]
      ทำสำเนาโมเดลทั้งชุดพร้อมเวอร์ชันเป็นรายการใหม่

  delete <id> [--v <N>] [--json]
      ย้ายโมเดล (หรือเฉพาะเวอร์ชัน vN) ไปยัง .trash (soft delete)

ตัวเลือกทั่วไป:
  --vault <dir>   ระบุตำแหน่งคลัง (ค่าเริ่มต้น: env VAULT_DIR หรือ ~/.gemini/3d-vault)
  --json          แสดงผลลัพธ์เป็น JSON บน stdout
  --help, -h      แสดงคู่มือการใช้งานนี้

หมวดหมู่ที่รองรับ (--category):
  building, furniture, device, part, scene, other

ตัวอย่าง:
  vault3d import-outputs --json
  vault3d list --q swiftlet --json
  vault3d add /home/dev/.gemini/outputs/3d/model.glb --name "ตู้แร็ค 12U" --category device \\
      --tags homelab,rack --source /tmp/rack.py --preview /tmp/rack.png --note "ต้นแบบแรก"
  vault3d add-version rack-12u-a1b2c3 /tmp/rack_v2.glb --source /tmp/rack_v2.py --note "เพิ่มพัดลมด้านหลัง"
  vault3d export rack-12u-a1b2c3 --format zip --out /tmp/rack.zip
`;
    process.stdout.write(text);
}

function assertLocalFileExists(filePath, label) {
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs)) {
        const err = new Error(`ไม่พบไฟล์${label ? ' ' + label : ''}: ${abs}`);
        err.statusCode = 404;
        throw err;
    }
    return abs;
}

async function cmdList(manager, opts) {
    const result = await manager.listAssets({
        q: opts.q || '',
        tag: opts.tags || '',
        category: opts.category || '',
        fav: opts.favorite ? '1' : '',
        sort: opts.sort || 'updated',
    });

    if (opts.json) {
        printJson(result);
        return;
    }

    console.log(`3D Asset Vault (${result.assets.length}/${result.total} รายการ)`);
    if (!result.assets.length) {
        console.log('  (ไม่พบโมเดลที่ตรงเงื่อนไข)');
        return;
    }
    for (const a of result.assets) {
        const star = a.favorite ? '★ ' : '';
        const tags = (a.tags || []).length ? ` [${a.tags.join(', ')}]` : '';
        console.log(`- ${star}${a.id} | ${a.name} (${a.category}) | v${a.latestVersion} (${a.versionCount} versions) | ${formatBytes(a.sizeBytes)}${tags}`);
        console.log(`  URL: ${assetWebUrl(a.id)}`);
    }
}

async function cmdShow(manager, positionals, opts) {
    const id = positionals[0];
    if (!id) {
        throw new Error('กรุณาระบุ asset ID: vault3d show <id>');
    }
    const asset = await manager.getAsset(id);
    if (!asset) {
        const err = new Error(`ไม่พบ asset '${id}'`);
        err.statusCode = 404;
        throw err;
    }

    if (opts.json) {
        printJson({ ok: true, asset, url: assetWebUrl(asset.id) });
        return;
    }

    console.log(`ID:          ${asset.id}`);
    console.log(`Name:        ${asset.name}${asset.favorite ? ' ★' : ''}`);
    console.log(`Category:    ${asset.category}`);
    console.log(`Tags:        ${(asset.tags || []).join(', ') || '-'}`);
    console.log(`Dimensions:  ${formatDimensions(asset.dimensions)}`);
    console.log(`Source:      ${asset.source ? `${asset.source.type} (${asset.source.origin || '-'})` : '-'}`);
    console.log(`Updated:     ${asset.updatedAt}`);
    console.log(`Web URL:     ${assetWebUrl(asset.id)}`);
    if (asset.description) {
        console.log(`Description: ${asset.description}`);
    }
    console.log(`Versions (${(asset.versions || []).length}):`);
    for (const ver of (asset.versions || [])) {
        const stats = ver.stats || {};
        const triStr = stats.triangles !== undefined ? `${stats.triangles} tris, ${stats.meshes ?? 0} meshes` : '-';
        console.log(`  v${ver.v}: ${formatBytes(ver.sizeBytes)} | ${triStr} | sha256:${String(ver.sha256 || '').slice(0, 12)} | ${ver.createdAt}`);
        if (ver.note) console.log(`      Note: ${ver.note}`);
        const files = ver.files || {};
        console.log(`      Files: model=${files.model || '-'}, source=${files.source || '-'}, preview=${files.preview || '-'}, original=${files.original || '-'}`);
    }
}

async function cmdAdd(manager, positionals, opts) {
    const modelArg = positionals[0];
    if (!modelArg) {
        throw new Error('กรุณาระบุไฟล์โมเดล: vault3d add <model> [options]');
    }
    const modelAbs = assertLocalFileExists(modelArg, 'โมเดล');
    const sourceAbs = opts.source ? assertLocalFileExists(opts.source, 'สคริปต์ .py') : null;
    const previewAbs = opts.preview ? assertLocalFileExists(opts.preview, 'ภาพพรีวิว') : null;

    const fallbackName = path.basename(modelAbs, path.extname(modelAbs));
    const asset = await manager.createAsset({
        name: opts.name || fallbackName,
        description: opts.description || '',
        category: opts.category || 'other',
        tags: opts.tags || '',
        favorite: Boolean(opts.favorite),
        note: opts.note || '',
        model: { path: modelAbs },
        sourceFile: sourceAbs ? { path: sourceAbs } : undefined,
        preview: previewAbs ? { path: previewAbs } : undefined,
    });

    const url = assetWebUrl(asset.id);
    if (opts.json) {
        printJson({ ok: true, asset, url });
        return;
    }

    const latest = asset.versions[asset.versions.length - 1];
    console.log(`เพิ่มโมเดลเข้าคลังสำเร็จ: ${asset.id}`);
    console.log(`  ชื่อ: ${asset.name} | หมวด: ${asset.category} | เวอร์ชัน: v${latest.v} (${formatBytes(latest.sizeBytes)})`);
    console.log(`  ขนาดโมเดล: ${formatDimensions(asset.dimensions)}`);
    console.log(`  ลิงก์: ${url}`);
}

async function cmdAddVersion(manager, positionals, opts) {
    const id = positionals[0];
    const modelArg = positionals[1];
    if (!id || !modelArg) {
        throw new Error('กรุณาระบุ ID และไฟล์โมเดล: vault3d add-version <id> <model> [options]');
    }
    const modelAbs = assertLocalFileExists(modelArg, 'โมเดล');
    const sourceAbs = opts.source ? assertLocalFileExists(opts.source, 'สคริปต์ .py') : null;
    const previewAbs = opts.preview ? assertLocalFileExists(opts.preview, 'ภาพพรีวิว') : null;

    const asset = await manager.addVersion(id, {
        note: opts.note || '',
        model: { path: modelAbs },
        sourceFile: sourceAbs ? { path: sourceAbs } : undefined,
        preview: previewAbs ? { path: previewAbs } : undefined,
    });

    const version = asset.versions[asset.versions.length - 1] || null;
    const url = assetWebUrl(asset.id);
    if (opts.json) {
        printJson({ ok: true, asset, version, url });
        return;
    }

    console.log(`เพิ่มเวอร์ชันใหม่สำเร็จ: ${asset.id} -> v${version ? version.v : '?'}`);
    console.log(`  ขนาดไฟล์: ${formatBytes(version ? version.sizeBytes : 0)} | บันทึก: ${version && version.note ? version.note : '-'}`);
    console.log(`  ลิงก์: ${url}`);
}

async function cmdExport(manager, positionals, opts) {
    const id = positionals[0];
    if (!id) {
        throw new Error('กรุณาระบุ asset ID: vault3d export <id> [--v N|all] [--format zip|glb|stl|obj|fbx|ply] [--out <path>]');
    }
    const format = String(opts.format || 'zip').trim().toLowerCase().replace(/^\./, '');
    const exp = await manager.exportAsset(id, {
        v: opts.v,
        format,
    });

    try {
        let outPath;
        if (opts.out) {
            const candidate = path.resolve(opts.out);
            let isDir = false;
            try {
                isDir = fs.statSync(candidate).isDirectory();
            } catch (_) {
                isDir = opts.out.endsWith('/') || opts.out.endsWith(path.sep);
            }
            outPath = isDir ? path.join(candidate, exp.filename) : candidate;
        } else {
            outPath = path.resolve(process.cwd(), exp.filename);
        }

        await fsp.mkdir(path.dirname(outPath), { recursive: true });
        await fsp.copyFile(exp.filePath, outPath);
        const st = await fsp.stat(outPath);

        if (opts.json) {
            printJson({
                ok: true,
                id,
                format,
                v: opts.v || (format === 'zip' ? 'all' : 'latest'),
                out: outPath,
                filename: path.basename(outPath),
                sizeBytes: st.size,
            });
            return;
        }

        console.log(`ส่งออกไฟล์สำเร็จ: ${outPath}`);
        console.log(`  Asset: ${id} | รูปแบบ: ${format.toUpperCase()} | ขนาด: ${formatBytes(st.size)}`);
    } finally {
        await exp.cleanup();
    }
}

async function cmdImport(manager, positionals, opts) {
    const fileArg = positionals[0];
    if (!fileArg) {
        throw new Error('กรุณาระบุไฟล์ที่จะนำเข้า: vault3d import <zip-or-model>');
    }
    const absPath = assertLocalFileExists(fileArg, 'นำเข้า');
    const ext = path.extname(absPath).toLowerCase();

    let asset;
    if (ext === '.zip') {
        asset = await manager.importZip(absPath);
    } else {
        const sourceAbs = opts.source ? assertLocalFileExists(opts.source, 'สคริปต์ .py') : undefined;
        const previewAbs = opts.preview ? assertLocalFileExists(opts.preview, 'ภาพพรีวิว') : undefined;
        asset = await manager.importPath({
            path: absPath,
            assetId: opts.assetId,
            name: opts.name,
            description: opts.description,
            category: opts.category,
            tags: opts.tags,
            favorite: opts.favorite,
            note: opts.note,
            sourcePath: sourceAbs,
            previewPath: previewAbs,
        });
    }

    const url = assetWebUrl(asset.id);
    if (opts.json) {
        printJson({ ok: true, asset, url });
        return;
    }

    console.log(`นำเข้าโมเดลสำเร็จ: ${asset.id}`);
    console.log(`  ชื่อ: ${asset.name} | จำนวนเวอร์ชัน: ${(asset.versions || []).length}`);
    console.log(`  ลิงก์: ${url}`);
}

async function cmdImportOutputs(manager, opts) {
    const result = await manager.importOutputs();
    if (opts.json) {
        printJson(result);
        return;
    }

    console.log(`Import outputs เสร็จสิ้น: เพิ่มใหม่ ${result.importedAssets} assets, ${result.importedVersions} versions (ข้ามที่ซ้ำ ${result.skippedVersions} versions)`);
    for (const a of (result.assets || [])) {
        console.log(`- ${a.id} | ${a.name} (${a.versionCount} versions)`);
        console.log(`  URL: ${assetWebUrl(a.id)}`);
    }
}

async function cmdStats(manager, opts) {
    const st = await manager.getStats();
    if (opts.json) {
        printJson(st);
        return;
    }

    console.log(`3D Asset Vault Stats`);
    console.log(`  Vault Dir:   ${st.vaultDir}`);
    console.log(`  Assets:      ${st.totalAssets}`);
    console.log(`  Versions:    ${st.totalVersions}`);
    console.log(`  Total Size:  ${formatBytes(st.totalSizeBytes)}`);
    console.log(`  Favorites:   ${st.favoritesCount}`);
    console.log(`  Blender:     ${st.blenderAvailable ? 'ready' : 'missing'}`);
    console.log(`  ZIP/UNZIP:   ${st.zipAvailable ? 'ready' : 'missing'}`);
    if (st.categories && st.categories.length) {
        console.log(`  Categories:  ${st.categories.map((c) => `${c.category}(${c.count})`).join(', ')}`);
    }
    if (st.tags && st.tags.length) {
        console.log(`  Top Tags:    ${st.tags.slice(0, 12).map((t) => `${t.tag}(${t.count})`).join(', ')}`);
    }
}

async function cmdUpdate(manager, positionals, opts) {
    const id = positionals[0];
    if (!id) {
        throw new Error('กรุณาระบุ asset ID: vault3d update <id> [options]');
    }
    const patch = {};
    if (opts.name !== undefined) patch.name = opts.name;
    if (opts.description !== undefined) patch.description = opts.description;
    if (opts.category !== undefined) patch.category = opts.category;
    if (opts.tags !== undefined) patch.tags = opts.tags;
    if (opts.favorite !== undefined) patch.favorite = opts.favorite;
    if (opts.note !== undefined) {
        patch.versionNote = opts.note;
        if (opts.v !== undefined) patch.v = opts.v;
    }

    const asset = await manager.updateMeta(id, patch);
    const url = assetWebUrl(asset.id);
    if (opts.json) {
        printJson({ ok: true, asset, url });
        return;
    }

    console.log(`อัปเดตข้อมูลสำเร็จ: ${asset.id}`);
    console.log(`  ชื่อ: ${asset.name} | หมวด: ${asset.category} | แท็ก: ${(asset.tags || []).join(', ') || '-'}`);
    console.log(`  ลิงก์: ${url}`);
}

async function cmdDuplicate(manager, positionals, opts) {
    const id = positionals[0];
    if (!id) {
        throw new Error('กรุณาระบุ asset ID: vault3d duplicate <id> [--name <newName>]');
    }
    const asset = await manager.duplicateAsset(id, opts.name);
    const url = assetWebUrl(asset.id);
    if (opts.json) {
        printJson({ ok: true, asset, url });
        return;
    }
    console.log(`ทำสำเนาสำเร็จ: ${id} -> ${asset.id} (${asset.name})`);
    console.log(`  ลิงก์: ${url}`);
}

async function cmdDelete(manager, positionals, opts) {
    const id = positionals[0];
    if (!id) {
        throw new Error('กรุณาระบุ asset ID: vault3d delete <id> [--v N]');
    }
    const result = await manager.deleteAsset(id, opts.v);
    if (opts.json) {
        printJson(result);
        return;
    }
    const scope = result.v ? `เวอร์ชัน v${result.v} ของ ${result.id}` : `asset ${result.id}`;
    console.log(`ย้าย ${scope} ไปยัง .trash/${result.trashedTo} แล้ว`);
}

async function main() {
    const rawArgv = process.argv.slice(2);
    const { positionals, opts } = parseArgs(rawArgv);

    if (opts.help || positionals.length === 0) {
        showHelp();
        return;
    }

    const cmd = String(positionals[0]).toLowerCase();
    const rest = positionals.slice(1);

    if (cmd === 'help') {
        showHelp();
        return;
    }

    const manager = loadManager(opts);

    switch (cmd) {
        case 'list':
        case 'ls':
            await cmdList(manager, opts);
            return;
        case 'show':
        case 'get':
        case 'info':
            await cmdShow(manager, rest, opts);
            return;
        case 'add':
        case 'create':
            await cmdAdd(manager, rest, opts);
            return;
        case 'add-version':
        case 'version':
            await cmdAddVersion(manager, rest, opts);
            return;
        case 'export':
            await cmdExport(manager, rest, opts);
            return;
        case 'import':
            await cmdImport(manager, rest, opts);
            return;
        case 'import-outputs':
        case 'seed':
            await cmdImportOutputs(manager, opts);
            return;
        case 'stats':
            await cmdStats(manager, opts);
            return;
        case 'update':
        case 'patch':
            await cmdUpdate(manager, rest, opts);
            return;
        case 'duplicate':
        case 'dup':
            await cmdDuplicate(manager, rest, opts);
            return;
        case 'delete':
        case 'rm':
            await cmdDelete(manager, rest, opts);
            return;
        default: {
            const err = new Error(`ไม่รู้จักคำสั่ง '${positionals[0]}' (รัน vault3d --help เพื่อดูคำสั่งทั้งหมด)`);
            err.statusCode = 400;
            throw err;
        }
    }
}

main().catch((err) => {
    const msg = err && err.message ? err.message : String(err);
    const wantsJson = process.argv.some((a) => a === '--json' || a === '-j' || a.startsWith('--json=true'));
    if (wantsJson) {
        printJson({
            ok: false,
            error: msg,
            statusCode: err && Number.isInteger(err.statusCode) ? err.statusCode : 1,
        });
    } else {
        process.stderr.write(`Error: ${msg}\n`);
    }
    process.exit(1);
});
