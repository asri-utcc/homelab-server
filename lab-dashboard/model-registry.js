'use strict';

/**
 * model-registry.js
 * -----------------------------------------------------------------------------
 * 🧭 Model Registry & Watchdog — ค้นพบ, จำแนก, เฝ้าดู และแจ้งเตือนโมเดล AI
 *
 *  1. init(deps)             : รับแคตตาล็อกฐาน + helper จากภายนอก (DI เพื่อกัน circular dep)
 *  2. discoverAgyModels()    : สแกน `agy models` จากทุกบัญชีที่พร้อมใช้งาน (พร้อม heal เมื่อ crash)
 *  3. classifyNewModel()     : ให้คะแนนความมั่นใจ (confidence) และประมาณค่า q/cost/pool
 *  4. getEffectiveFamilies() : คืนแคตตาล็อกโมเดลที่กรอง disabled/missing/rejected + เติม variant/custom
 *  5. scan()                 : เทียบ diff อัปเดตสถานะ บันทึก alert และส่งสรุปเข้า Telegram
 *  6. approve/reject/toggle  : จัดการสถานะโมเดลและขยาย customFamilies
 *  7. startWatchdog()        : ตั้งรอบสแกนอัตโนมัติ (default ทุก 6 ชม.)
 *
 * ห้าม require('./ai-router') ในไฟล์นี้เด็ดขาด — ใช้ dependency injection ผ่าน init() เท่านั้น
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const pareto = require('./public/model-pareto');
let researcher = null;
try {
    researcher = require('./model-researcher');
} catch (_) {
    researcher = null;
}

const HOME_DIR = os.homedir();
const DEFAULT_GEMINI_DIR = path.join(HOME_DIR, '.gemini');
const TELEGRAM_NOTIFY_SCRIPT = '/home/dev/projects/notify-telegram.py';
const DASHBOARD_URL = 'https://homelab.tail285279.ts.net/';

const AUTO_ENABLE_CONFIDENCE = 80;
const MISSING_CONSECUTIVE_SCANS = 2;
const SCAN_FAILED_ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const AGY_DISCOVER_TIMEOUT_MS = 15000;

const VARIANT_SUFFIX_RE = /-(low|medium|high|xhigh|max)$/;
const STANDARD_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);

// ── Path helpers (รองรับ override ด้วย env สำหรับเทสต์) ────────────────────────
function getRegistryFile() {
    return process.env.MODEL_REGISTRY_FILE || path.join(DEFAULT_GEMINI_DIR, 'model-registry.json');
}

function getAlertsFile() {
    return process.env.MODEL_ALERTS_FILE || path.join(DEFAULT_GEMINI_DIR, 'model-alerts.jsonl');
}

function getAlertsAckFile() {
    return process.env.MODEL_ALERTS_ACK_FILE || path.join(DEFAULT_GEMINI_DIR, 'model-alerts-acked.json');
}

function isNotifyDisabled() {
    const v = String(process.env.MODEL_REGISTRY_NO_NOTIFY || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}

// ── Dependency Injection state ─────────────────────────────────────────────────
function defaultPoolOf(model) {
    const s = String(model || '');
    if (/argon/i.test(s)) return 'argon';
    if (/^(claude|gpt)/i.test(s)) return 'claude';
    return 'gemini';
}

let deps = {
    families: [],
    deepseekModels: [],
    claudeCodeModels: [],
    listAccounts: () => [],
    agyBin: process.env.AGY_BIN || path.join(HOME_DIR, '.local/bin/agy'),
    healBinaryCache: async () => false,
    isBinaryCrash: () => false,
    poolOf: defaultPoolOf
};

// Cache ใน memory อิงตาม path + mtime เพื่อไม่ต้องอ่านดิสก์หนักๆ ทุก request
let regCache = {
    filePath: null,
    mtimeMs: -1,
    data: null
};

let scanInFlight = null;

// ── Utility helpers ────────────────────────────────────────────────────────────
function formatVariantLabel(familyLabel, variant) {
    if (!variant) return familyLabel;
    const vLabel = variant === 'xhigh'
        ? 'XHigh'
        : variant[0].toUpperCase() + variant.slice(1);
    return `${familyLabel} (${vLabel})`;
}

function clampQ(n, fallback = 75) {
    const num = Number(n);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(1, Math.min(100, Math.round(num)));
}

function sanitizeQ(q, fallback = { code: 75, analysis: 75, chat: 78 }) {
    const src = (q && typeof q === 'object') ? q : {};
    return {
        code: clampQ(src.code, fallback.code),
        analysis: clampQ(src.analysis, fallback.analysis),
        chat: clampQ(src.chat, fallback.chat)
    };
}

function sanitizeCost(cost, fallback = 1) {
    const num = Number(cost);
    if (!Number.isFinite(num) || num < 0) return fallback;
    return Number(num.toFixed(3));
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function genAlertId() {
    const rand = crypto.randomBytes(3).toString('hex');
    return `ma_${Date.now()}_${rand}`;
}

function ensureParentDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function atomicWriteJson(filePath, obj) {
    ensureParentDir(filePath);
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(2).toString('hex')}`;
    const payload = JSON.stringify(obj, null, 2) + '\n';
    fs.writeFileSync(tmpPath, payload, 'utf8');
    fs.renameSync(tmpPath, filePath);
}

// สร้างชื่อ family id จาก prefix หรือ model id (เช่น 'gemini-4-carbon-' → 'gemini-carbon')
function deriveFamilyId(prefixOrModelId) {
    let base = String(prefixOrModelId || '').trim().toLowerCase().replace(/-+$/, '');
    if (!base) return 'custom-model';
    // ตัดเลขเวอร์ชันกลางสำหรับตระกูล gemini เช่น gemini-4-carbon → gemini-carbon
    base = base.replace(/^gemini-\d+(?:\.\d+)?-/, 'gemini-');
    // ตัดอักขระที่ไม่ปลอดภัยออก
    base = base.replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return base || 'custom-model';
}

function deriveFamilyLabel(modelName, prefixOrModelId) {
    if (modelName && typeof modelName === 'string') {
        // ตัดวงเล็บ effort ท้ายชื่อออก เช่น "Gemini 4 Carbon (High)" → "Gemini 4 Carbon"
        const cleaned = modelName.replace(/\s*\((low|medium|high|xhigh|max)\)\s*$/i, '').trim();
        if (cleaned) return cleaned;
    }
    const base = String(prefixOrModelId || '').replace(/-+$/, '');
    return base
        .split('-')
        .filter(Boolean)
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(' ') || 'Custom Model';
}

// ── Seed / Load / Save Registry ────────────────────────────────────────────────
function buildSeedRegistry() {
    const now = new Date().toISOString();
    const models = {};
    const poolOf = typeof deps.poolOf === 'function' ? deps.poolOf : defaultPoolOf;

    // 1. Seed จาก MODEL_FAMILIES
    for (const f of (deps.families || [])) {
        if (!f || !Array.isArray(f.variants)) continue;
        const engine = f.engine || 'agy';
        for (const v of f.variants) {
            const id = f.model || `${f.prefix || ''}${v}`;
            if (!id) continue;
            models[id] = {
                id,
                name: formatVariantLabel(f.label || id, v),
                engine,
                family: f.id || null,
                status: 'active',
                source: 'builtin',
                confidence: 100,
                suggested: {
                    q: sanitizeQ(f.q),
                    cost: sanitizeCost(f.cost, 1),
                    pool: engine === 'agy' ? poolOf(id) : engine,
                    basis: 'โมเดลมาตรฐานในแคตตาล็อกหลัก'
                },
                firstSeen: now,
                lastSeen: now,
                accounts: [],
                decidedBy: 'auto',
                decidedAt: now,
                missedScans: 0
            };
        }
    }

    // 2. Seed จาก DeepSeek models (รองรับทั้งรูป {id,name} และ {model,label,q})
    for (const d of (deps.deepseekModels || [])) {
        if (!d) continue;
        const id = d.id || d.model;
        if (!id || models[id]) continue;
        const baseQ = Number.isFinite(Number(d.q)) ? Number(d.q) : 80;
        models[id] = {
            id,
            name: d.name || d.label || id,
            engine: 'deepseek',
            family: 'deepseek',
            status: 'active',
            source: 'builtin',
            confidence: 100,
            suggested: {
                q: { code: clampQ(baseQ), analysis: clampQ(baseQ), chat: clampQ(baseQ) },
                cost: 0.2,
                pool: 'deepseek',
                basis: 'โมเดล DeepSeek มาตรฐาน'
            },
            firstSeen: now,
            lastSeen: now,
            accounts: [],
            decidedBy: 'auto',
            decidedAt: now,
            missedScans: 0
        };
    }

    // 3. Seed จาก Claude Code models (ถ้ายังไม่มีใน families)
    for (const c of (deps.claudeCodeModels || [])) {
        if (!c || !c.id || models[c.id]) continue;
        models[c.id] = {
            id: c.id,
            name: c.name || c.id,
            engine: 'claude-code',
            family: c.id,
            status: 'active',
            source: 'builtin',
            confidence: 100,
            suggested: {
                q: { code: 85, analysis: 85, chat: 85 },
                cost: 1.33,
                pool: 'claude-code',
                basis: 'โมเดล Claude Code CLI มาตรฐาน'
            },
            firstSeen: now,
            lastSeen: now,
            accounts: [],
            decidedBy: 'auto',
            decidedAt: now,
            missedScans: 0
        };
    }

    return {
        version: 1,
        lastScanAt: null,
        lastScanOk: null,
        models,
        customFamilies: []
    };
}

function isValidRegistryShape(obj) {
    return Boolean(
        obj
        && typeof obj === 'object'
        && !Array.isArray(obj)
        && obj.models
        && typeof obj.models === 'object'
        && !Array.isArray(obj.models)
    );
}

function saveRegistry(reg) {
    const filePath = getRegistryFile();
    try {
        const normalized = {
            version: 1,
            lastScanAt: reg.lastScanAt || null,
            lastScanOk: reg.lastScanOk === undefined ? null : reg.lastScanOk,
            ...(reg.lastScanFailedAlertAt ? { lastScanFailedAlertAt: reg.lastScanFailedAlertAt } : {}),
            ...(reg.lastResearchAt ? { lastResearchAt: reg.lastResearchAt } : {}),
            ...(reg.lastResearchSummary ? { lastResearchSummary: reg.lastResearchSummary } : {}),
            models: reg.models || {},
            customFamilies: Array.isArray(reg.customFamilies) ? reg.customFamilies : []
        };
        atomicWriteJson(filePath, normalized);
        let mtimeMs = Date.now();
        try {
            mtimeMs = fs.statSync(filePath).mtimeMs;
        } catch (_) {}
        regCache = { filePath, mtimeMs, data: normalized };
        return true;
    } catch (_) {
        return false;
    }
}

function loadRegistry() {
    const filePath = getRegistryFile();
    try {
        let st;
        try {
            st = fs.statSync(filePath);
        } catch (err) {
            if (err && err.code === 'ENOENT') {
                const seeded = buildSeedRegistry();
                regCache = { filePath, mtimeMs: -1, data: seeded };
                return seeded;
            }
            throw err;
        }

        if (regCache.filePath === filePath && regCache.mtimeMs === st.mtimeMs && regCache.data) {
            return regCache.data;
        }

        const raw = fs.readFileSync(filePath, 'utf8');
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (_) {
            parsed = null;
        }

        if (!isValidRegistryShape(parsed)) {
            // ไฟล์ JSON พัง → สำรองเป็น .corrupt-<ts> แล้ว seed ใหม่โดยไม่ throw
            try {
                fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
            } catch (_) {}
            const seeded = buildSeedRegistry();
            saveRegistry(seeded);
            return seeded;
        }

        if (!Array.isArray(parsed.customFamilies)) {
            parsed.customFamilies = [];
        }
        regCache = { filePath, mtimeMs: st.mtimeMs, data: parsed };
        return parsed;
    } catch (_) {
        // Safe floor: ห้าม throw ออกไปนอกโมดูลเด็ดขาด
        const seeded = buildSeedRegistry();
        return seeded;
    }
}

function init(injectedDeps = {}) {
    deps = {
        ...deps,
        ...injectedDeps,
        families: Array.isArray(injectedDeps.families) ? injectedDeps.families : deps.families,
        deepseekModels: Array.isArray(injectedDeps.deepseekModels) ? injectedDeps.deepseekModels : deps.deepseekModels,
        claudeCodeModels: Array.isArray(injectedDeps.claudeCodeModels) ? injectedDeps.claudeCodeModels : deps.claudeCodeModels,
        poolOf: typeof injectedDeps.poolOf === 'function' ? injectedDeps.poolOf : deps.poolOf
    };

    // ล้าง cache เผื่อมีการเรียก init ซ้ำด้วย deps หรือ path ใหม่
    regCache = { filePath: null, mtimeMs: -1, data: null };

    const filePath = getRegistryFile();
    try {
        if (!fs.existsSync(filePath)) {
            const seeded = buildSeedRegistry();
            saveRegistry(seeded);
            return seeded;
        }
        return loadRegistry();
    } catch (_) {
        return buildSeedRegistry();
    }
}

// ── Discovery: สแกนโมเดลจาก `agy models` ทุกบัญชีที่พร้อมใช้งาน ───────────────────
function resolveAgyBin(configuredBin) {
    const candidates = [configuredBin];
    try {
        const realHome = os.userInfo().homedir;
        if (realHome) candidates.push(path.join(realHome, '.local/bin/agy'));
    } catch (_) {}
    candidates.push(path.join(HOME_DIR, '.local/bin/agy'));
    for (const c of candidates) {
        if (c && fs.existsSync(c)) return c;
    }
    return configuredBin || path.join(HOME_DIR, '.local/bin/agy');
}

function execAgyModels(agyBin, homeDir) {
    return new Promise((resolve) => {
        execFile(
            agyBin,
            ['models'],
            {
                timeout: AGY_DISCOVER_TIMEOUT_MS,
                env: {
                    ...process.env,
                    HOME: homeDir,
                    FORCE_COLOR: '0'
                },
                maxBuffer: 2 * 1024 * 1024
            },
            (err, stdout, stderr) => {
                resolve({
                    ok: !err,
                    stdout: String(stdout || ''),
                    stderr: String(stderr || ''),
                    error: err ? (err.message || String(err)) : null,
                    signal: err && err.signal ? String(err.signal) : null
                });
            }
        );
    });
}

function parseAgyModelsOutput(stdout) {
    const items = [];
    const seen = new Set();
    const lines = String(stdout || '').split(/\r?\n/);

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (/^Fetching\b/i.test(line)) continue;
        if (/Please sign in/i.test(line)) continue;
        if (!rawLine.includes('\t')) continue;

        const parts = rawLine.split('\t');
        const id = (parts[0] || '').trim();
        const name = (parts.slice(1).join('\t') || '').trim();

        if (!id || id.includes('...')) continue;
        if (/^Fetching\b/i.test(id) || /Please sign in/i.test(id)) continue;
        if (seen.has(id)) continue;

        seen.add(id);
        items.push({ id, name: name || id });
    }
    return items;
}

async function discoverAgyModels() {
    const listAccounts = typeof deps.listAccounts === 'function' ? deps.listAccounts : () => [];
    const agyBin = resolveAgyBin(deps.agyBin || path.join(HOME_DIR, '.local/bin/agy'));
    const isBinaryCrash = typeof deps.isBinaryCrash === 'function' ? deps.isBinaryCrash : () => false;
    const healBinaryCache = typeof deps.healBinaryCache === 'function' ? deps.healBinaryCache : async () => false;

    let accounts = [];
    try {
        accounts = (listAccounts() || []).filter((a) => a && a.ready && a.home);
    } catch (_) {
        accounts = [];
    }

    if (accounts.length === 0) {
        return {
            ok: false,
            allAccountsOk: false,
            error: 'ไม่มีบัญชี agy ที่พร้อมใช้งาน (ready)',
            byAccount: {},
            union: new Map(),
            accountErrors: {}
        };
    }

    const byAccount = {};
    const accountErrors = {};
    const union = new Map(); // id -> { id, name, accounts: [accId, ...] }

    const results = await Promise.all(accounts.map(async (acc) => {
        let res = await execAgyModels(agyBin, acc.home);
        // core dump จาก RAM page-cache เสียมักไม่มี stderr ให้จับ → ถือว่า crash เมื่อถูก signal ฆ่า
        // หรือล้มโดยไม่มีผลลัพธ์เลย แล้ว heal + ลองใหม่ได้สูงสุด 2 รอบ
        const looksCrashed = (r) => !r.ok && !/Please sign in/i.test(r.stdout + r.stderr)
            && (isBinaryCrash(r.stderr) || (r.signal && r.signal !== 'SIGTERM') || !r.stdout.trim());
        for (let attempt = 0; attempt < 2 && looksCrashed(res); attempt += 1) {
            try {
                await healBinaryCache(agyBin);
            } catch (_) {}
            res = await execAgyModels(agyBin, acc.home);
        }

        if (!res.ok) {
            return {
                acc,
                ok: false,
                error: (res.stderr || res.error || 'agy models failed').trim().slice(0, 200),
                models: []
            };
        }

        if (/Please sign in/i.test(res.stdout)) {
            return {
                acc,
                ok: false,
                error: 'บัญชีต้องเข้าสู่ระบบใหม่ (Please sign in)',
                models: []
            };
        }

        const models = parseAgyModelsOutput(res.stdout);
        if (models.length === 0) {
            return {
                acc,
                ok: false,
                error: 'ไม่พบรายการโมเดลจากผลลัพธ์ agy models',
                models: []
            };
        }

        return { acc, ok: true, error: null, models };
    }));

    let successCount = 0;
    for (const r of results) {
        if (!r.ok) {
            accountErrors[r.acc.id] = r.error;
            continue;
        }
        successCount += 1;
        byAccount[r.acc.id] = r.models;

        for (const m of r.models) {
            const existing = union.get(m.id);
            if (existing) {
                if (!existing.accounts.includes(r.acc.id)) {
                    existing.accounts.push(r.acc.id);
                }
                if (!existing.name && m.name) {
                    existing.name = m.name;
                }
            } else {
                union.set(m.id, {
                    id: m.id,
                    name: m.name,
                    accounts: [r.acc.id]
                });
            }
        }
    }

    const ok = successCount > 0 && union.size > 0;
    const allAccountsOk = successCount === accounts.length && union.size > 0;

    return {
        ok,
        allAccountsOk,
        error: ok ? null : (Object.values(accountErrors)[0] || 'สแกนโมเดล agy ไม่สำเร็จ'),
        byAccount,
        union,
        accountErrors
    };
}

// ── Classification: จำแนกโมเดลใหม่และประมาณคะแนน/ราคา ───────────────────────────
function averageSiblings(siblings) {
    if (!siblings || siblings.length === 0) return null;
    const sum = { code: 0, analysis: 0, chat: 0, cost: 0 };
    for (const f of siblings) {
        const q = sanitizeQ(f.q);
        sum.code += q.code;
        sum.analysis += q.analysis;
        sum.chat += q.chat;
        sum.cost += sanitizeCost(f.cost, 1);
    }
    const n = siblings.length;
    return {
        q: {
            code: Math.round(sum.code / n),
            analysis: Math.round(sum.analysis / n),
            chat: Math.round(sum.chat / n)
        },
        cost: Number((sum.cost / n).toFixed(2)),
        labels: siblings.map((s) => s.label || s.id)
    };
}

function classifyNewModel(id, name, effectiveFamilies) {
    const modelId = String(id || '').trim();
    const families = Array.isArray(effectiveFamilies)
        ? effectiveFamilies
        : getEffectiveFamilies(deps.families);
    const poolOf = typeof deps.poolOf === 'function' ? deps.poolOf : defaultPoolOf;
    const pool = poolOf(modelId);

    const match = modelId.match(VARIANT_SUFFIX_RE);
    const suffix = match ? match[1] : null;
    const prefixWithDash = match ? modelId.slice(0, modelId.length - suffix.length) : null;

    // 1. ตรวจว่าตรงกับตระกูลที่รู้จักอยู่แล้วหรือไม่
    for (const f of families) {
        if (!f) continue;

        // 1a. ตรงกับโมเดลเดี่ยว (เช่น orchestrator)
        if (f.model && f.model === modelId) {
            return {
                family: f.id,
                confidence: 95,
                status: 'active',
                suggested: {
                    q: sanitizeQ(f.q),
                    cost: sanitizeCost(f.cost, 1),
                    pool,
                    basis: `ตรงกับโมเดลมาตรฐานของตระกูล ${f.label || f.id}`
                }
            };
        }

        // 1b. ตรงกับ prefix ของตระกูลที่รู้จัก
        if (f.prefix && prefixWithDash && f.prefix === prefixWithDash) {
            const baseQ = sanitizeQ(f.q);
            const baseCost = sanitizeCost(f.cost, 1);

            if (STANDARD_EFFORTS.has(suffix)) {
                return {
                    family: f.id,
                    confidence: 90,
                    status: 'active',
                    suggested: {
                        q: baseQ,
                        cost: baseCost,
                        pool,
                        basis: `ระดับ effort มาตรฐาน (${suffix}) ของตระกูล ${f.label || f.id} ที่รู้จักอยู่แล้ว`
                    }
                };
            }

            // suffix แปลกใหม่ เช่น max → confidence 80 และเดาคะแนน q มากกว่า xhigh +2 (xhigh=+7 → max=+9 จากฐาน medium)
            const maxQ = {
                code: clampQ(baseQ.code + 9),
                analysis: clampQ(baseQ.analysis + 9),
                chat: clampQ(baseQ.chat + 9)
            };
            const maxCost = Number((baseCost * 1.35).toFixed(2));
            return {
                family: f.id,
                confidence: AUTO_ENABLE_CONFIDENCE,
                status: 'active',
                suggested: {
                    q: maxQ,
                    cost: maxCost,
                    pool,
                    basis: `ระดับ effort ใหม่ (${suffix}) ของตระกูล ${f.label || f.id} — ประมาณคะแนนสูงกว่า xhigh +2`
                }
            };
        }
    }

    // 2. โมเดลตระกูลใหม่ — ห้ามเปิดใช้อัตโนมัติเด็ดขาด (status: 'pending')
    // 2a. สาย Orchestrator (เช่น gemini-pro-orchestrator, gemini-pro-orchestrator-argon)
    if (modelId.startsWith('gemini-pro-orchestrator') || /orchestrator/i.test(modelId)) {
        const orch = families.find((f) => f && (f.id === 'gemini-orchestrator' || (f.model && f.model.includes('orchestrator'))));
        const baseQ = orch ? sanitizeQ(orch.q) : { code: 96, analysis: 96, chat: 90 };
        const baseCost = orch ? sanitizeCost(orch.cost, 2.4) : 2.4;
        const isArgon = /argon/i.test(modelId);
        const estQ = isArgon
            ? { code: clampQ(baseQ.code - 8), analysis: clampQ(baseQ.analysis - 6), chat: clampQ(baseQ.chat - 4) }
            : { code: clampQ(baseQ.code - 2), analysis: clampQ(baseQ.analysis - 2), chat: clampQ(baseQ.chat) };
        const refLabel = orch ? (orch.label || orch.id) : 'Orchestrator (Neon)';
        return {
            family: null,
            confidence: 50,
            status: 'pending',
            suggested: {
                q: estQ,
                cost: baseCost,
                pool,
                basis: isArgon
                    ? `โมเดล Orchestrator ตระกูลใหม่ (pool argon) ประมาณคะแนนลดหลั่นจาก ${refLabel}`
                    : `โมเดล Orchestrator ตระกูลใหม่ ประมาณคะแนนและราคาใกล้เคียง ${refLabel}`
            }
        };
    }

    // 2b. สาย gemini-4-* (เช่น gemini-4-carbon-*) เทียบกับพี่น้อง hydrogen / neon
    if (modelId.startsWith('gemini-4-')) {
        let siblings = families.filter((f) => f && (f.id === 'gemini-hydrogen' || f.id === 'gemini-neon'));
        if (siblings.length === 0) {
            siblings = families.filter((f) => f && f.prefix && f.prefix.startsWith('gemini-4-'));
        }
        const avg = averageSiblings(siblings);
        const estQ = avg ? avg.q : { code: 91, analysis: 92, chat: 90 };
        const estCost = avg ? avg.cost : 1.5;
        const refText = avg ? avg.labels.join(' / ') : 'Gemini 4 Hydrogen / Neon';
        return {
            family: null,
            confidence: 50,
            status: 'pending',
            suggested: {
                q: estQ,
                cost: estCost,
                pool,
                basis: `ตระกูลใหม่สาย gemini-4-* ประมาณคะแนนและราคาจากค่าเฉลี่ยของตระกูลพี่น้อง (${refText})`
            }
        };
    }

    // 2c. สาย claude-*
    if (modelId.startsWith('claude-')) {
        const siblings = families.filter((f) => f && f.engine === 'agy' && f.prefix && f.prefix.startsWith('claude-'));
        const avg = averageSiblings(siblings);
        const estQ = avg ? avg.q : { code: 92, analysis: 90, chat: 89 };
        const estCost = avg ? avg.cost : 1.8;
        const refText = avg ? avg.labels.join(' / ') : 'Claude Opus / Sonnet';
        return {
            family: null,
            confidence: 50,
            status: 'pending',
            suggested: {
                q: estQ,
                cost: estCost,
                pool,
                basis: `ตระกูลใหม่สาย claude-* ประมาณคะแนนและราคาจากตระกูลพี่น้อง (${refText})`
            }
        };
    }

    // 2d. สาย gemini-* อื่นๆ หรือ gpt-*
    if (modelId.startsWith('gemini-')) {
        const siblings = families.filter((f) => f && f.prefix && f.prefix.startsWith('gemini-'));
        const avg = averageSiblings(siblings);
        return {
            family: null,
            confidence: 45,
            status: 'pending',
            suggested: {
                q: avg ? avg.q : { code: 82, analysis: 83, chat: 84 },
                cost: avg ? avg.cost : 1.0,
                pool,
                basis: `ตระกูลใหม่สาย gemini-* ประมาณค่าจากตระกูลพี่น้อง Gemini ในระบบ`
            }
        };
    }

    if (modelId.startsWith('gpt-')) {
        const siblings = families.filter((f) => f && f.prefix && f.prefix.startsWith('gpt-'));
        const avg = averageSiblings(siblings);
        return {
            family: null,
            confidence: 45,
            status: 'pending',
            suggested: {
                q: avg ? avg.q : { code: 78, analysis: 79, chat: 80 },
                cost: avg ? avg.cost : 0.5,
                pool,
                basis: `ตระกูลใหม่สาย gpt-* ประมาณค่าจากตระกูลพี่น้อง GPT ในระบบ`
            }
        };
    }

    // 2e. ไม่ตรงกับตระกูลใดเลย → confidence 30
    return {
        family: null,
        confidence: 30,
        status: 'pending',
        suggested: {
            q: { code: 75, analysis: 75, chat: 78 },
            cost: 1.0,
            pool,
            basis: `โมเดลตระกูลใหม่ (${name || modelId}) ไม่ตรงกับตระกูลใดในระบบ ใช้ค่าประมาณกลางเพื่อรอผู้ใช้ตรวจสอบ`
        }
    };
}

// ── Effective Families & Usability (pure/sync สำหรับ Router) ────────────────────
function isModelUsableInReg(reg, modelId) {
    if (!reg || !reg.models) return true;
    const entry = reg.models[modelId];
    if (!entry) return true; // ไม่บล็อกของที่ไม่รู้จัก
    return entry.status === 'active';
}

function isModelUsable(modelId) {
    try {
        const reg = loadRegistry();
        return isModelUsableInReg(reg, modelId);
    } catch (_) {
        return true;
    }
}

function getEffectiveFamilies(baseFamilies) {
    const base = Array.isArray(baseFamilies) ? baseFamilies : [];
    try {
        const reg = loadRegistry();
        if (!reg || !reg.models) return base;

        const allEntries = Object.values(reg.models);
        const result = [];
        const seenFamilyIds = new Set();

        const processFamily = (f) => {
            if (!f || !Array.isArray(f.variants)) return;
            const keptVariants = [];

            for (const v of f.variants) {
                const mId = f.model || `${f.prefix || ''}${v}`;
                if (isModelUsableInReg(reg, mId)) {
                    keptVariants.push(v);
                }
            }

            // เติม variant ใหม่ที่ถูกเปิดใช้ (auto-active หรือ user-approved) ของตระกูลนี้
            if (f.prefix) {
                for (const entry of allEntries) {
                    if (!entry || entry.status !== 'active') continue;
                    if (!entry.id || !entry.id.startsWith(f.prefix)) continue;
                    if (entry.family && entry.family !== f.id) continue;
                    const suffix = entry.id.slice(f.prefix.length);
                    if (!suffix || keptVariants.includes(suffix)) continue;
                    keptVariants.push(suffix);
                }
            }

            if (keptVariants.length > 0) {
                seenFamilyIds.add(f.id);
                result.push({
                    ...f,
                    variants: keptVariants
                });
            }
        };

        for (const f of base) {
            processFamily(f);
        }

        for (const cf of (reg.customFamilies || [])) {
            if (!cf || seenFamilyIds.has(cf.id)) continue;
            processFamily(cf);
        }

        return result;
    } catch (_) {
        // Safe floor: ถ้า registry พังให้คืน baseFamilies เดิมเสมอ
        return base;
    }
}

// ── Alerts (JSONL + Acked JSON) ────────────────────────────────────────────────
function appendAlert({ kind, modelId = null, title, detail = '', confidence = null }) {
    const alert = {
        id: genAlertId(),
        at: new Date().toISOString(),
        kind,
        modelId,
        title: String(title || kind),
        detail: String(detail || ''),
        confidence: confidence === null || confidence === undefined ? null : Number(confidence),
        acked: false
    };

    try {
        const filePath = getAlertsFile();
        ensureParentDir(filePath);
        fs.appendFileSync(filePath, JSON.stringify(alert) + '\n', 'utf8');
    } catch (_) {}

    return alert;
}

function readAckedSet() {
    const ackFile = getAlertsAckFile();
    try {
        if (!fs.existsSync(ackFile)) return new Set();
        const raw = fs.readFileSync(ackFile, 'utf8');
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return new Set();
        return new Set(arr.map(String));
    } catch (_) {
        return new Set();
    }
}

function readAllAlertsRaw() {
    const filePath = getAlertsFile();
    try {
        if (!fs.existsSync(filePath)) return [];
        const raw = fs.readFileSync(filePath, 'utf8');
        const lines = raw.split(/\r?\n/);
        const alerts = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const parsed = JSON.parse(trimmed);
                if (parsed && parsed.id) alerts.push(parsed);
            } catch (_) {}
        }
        return alerts;
    } catch (_) {
        return [];
    }
}

function listAlerts({ unacked = false, limit = 50 } = {}) {
    try {
        const ackSet = readAckedSet();
        const raw = readAllAlertsRaw();
        const lim = Math.max(1, Math.min(500, Number(limit) || 50));

        const enriched = raw
            .map((a) => ({ ...a, acked: ackSet.has(String(a.id)) }))
            .reverse(); // ล่าสุดขึ้นก่อน

        const filtered = unacked ? enriched.filter((a) => !a.acked) : enriched;
        return filtered.slice(0, lim);
    } catch (_) {
        return [];
    }
}

function ackAlerts(ids) {
    try {
        const ackSet = readAckedSet();
        if (ids === 'all') {
            for (const a of readAllAlertsRaw()) {
                ackSet.add(String(a.id));
            }
        } else if (Array.isArray(ids)) {
            for (const id of ids) {
                if (id) ackSet.add(String(id));
            }
        } else if (typeof ids === 'string' && ids) {
            ackSet.add(ids);
        }

        const ackFile = getAlertsAckFile();
        atomicWriteJson(ackFile, [...ackSet]);
        return { ok: true, ackedCount: ackSet.size };
    } catch (err) {
        return { ok: false, error: err && err.message ? err.message : 'ack_failed' };
    }
}

// ── Telegram Notification ──────────────────────────────────────────────────────
function buildTelegramHtml(changes, reason) {
    const icons = {
        new_auto: '✅',
        new_pending: '🆕',
        missing: '⚠️',
        returned: '🔄',
        scan_failed: '🚨'
    };
    const lines = [
        `<b>🧠 Model Watchdog</b> (${escapeHtml(reason || 'scan')})`,
        ''
    ];

    const maxLines = 20;
    for (const c of changes.slice(0, maxLines)) {
        const icon = icons[c.kind] || '•';
        const idPart = c.modelId ? `<code>${escapeHtml(c.modelId)}</code>` : '';
        const titlePart = escapeHtml(c.title || c.kind);
        const detailPart = c.detail ? ` — ${escapeHtml(c.detail.slice(0, 140))}` : '';
        lines.push(`${icon} <b>${titlePart}</b>${idPart && !c.title.includes(c.modelId) ? ` (${idPart})` : ''}${detailPart}`);
    }
    if (changes.length > maxLines) {
        lines.push(`… และอีก ${changes.length - maxLines} รายการ`);
    }

    lines.push('');
    lines.push(`🔗 <a href="${DASHBOARD_URL}">เปิดหน้าควบคุม lab-dashboard</a>`);
    return lines.join('\n');
}

function sendTelegramSummary(changes, reason) {
    if (isNotifyDisabled() || !Array.isArray(changes) || changes.length === 0) {
        return Promise.resolve({ ok: true, skipped: true });
    }
    const html = buildTelegramHtml(changes, reason);
    return new Promise((resolve) => {
        execFile(
            'python3',
            [TELEGRAM_NOTIFY_SCRIPT, html],
            { timeout: 15000 },
            (err) => {
                resolve({ ok: !err, error: err ? err.message : null });
            }
        );
    });
}

// ── Main Scan (Discovery + Diff + Alerts + Telegram) ───────────────────────────
async function runScanInternal({ reason = 'manual' } = {}) {
    const now = new Date().toISOString();
    const reg = loadRegistry();
    const disc = await discoverAgyModels();
    const changes = [];

    // ถ้าสแกนล้มเหลว ห้ามเปลี่ยนสถานะโมเดลใดๆ เด็ดขาด
    if (!disc.ok) {
        reg.lastScanAt = now;
        reg.lastScanOk = false;

        const lastAlertMs = reg.lastScanFailedAlertAt ? Date.parse(reg.lastScanFailedAlertAt) : 0;
        const canAlert = !lastAlertMs || (Date.now() - lastAlertMs) >= SCAN_FAILED_ALERT_COOLDOWN_MS;
        if (canAlert) {
            const alert = appendAlert({
                kind: 'scan_failed',
                modelId: null,
                title: 'สแกนโมเดล agy ล้มเหลว',
                detail: disc.error || 'ไม่สามารถดึงรายการโมเดลจากบัญชี agy ได้ (คงสถานะโมเดลเดิมทั้งหมด)',
                confidence: null
            });
            changes.push(alert);
            reg.lastScanFailedAlertAt = now;
        }

        saveRegistry(reg);
        if (changes.length > 0) {
            await sendTelegramSummary(changes, reason);
        }
        return {
            ok: false,
            reason,
            error: disc.error || 'scan_failed',
            changes
        };
    }

    const effectiveFamilies = getEffectiveFamilies(deps.families);

    // 1. ตรวจสอบโมเดลที่พบในรอบนี้
    for (const [id, info] of disc.union.entries()) {
        const existing = reg.models[id];
        if (!existing) {
            const cls = classifyNewModel(id, info.name, effectiveFamilies);
            const isAuto = cls.confidence >= AUTO_ENABLE_CONFIDENCE && cls.status === 'active';
            const status = isAuto ? 'active' : 'pending';

            reg.models[id] = {
                id,
                name: info.name || id,
                engine: 'agy',
                family: cls.family,
                status,
                source: 'discovered',
                confidence: cls.confidence,
                suggested: cls.suggested,
                firstSeen: now,
                lastSeen: now,
                accounts: [...info.accounts],
                decidedBy: isAuto ? 'auto' : null,
                decidedAt: isAuto ? now : null,
                missedScans: 0
            };

            const alert = appendAlert({
                kind: isAuto ? 'new_auto' : 'new_pending',
                modelId: id,
                title: isAuto
                    ? `เปิดใช้โมเดลใหม่อัตโนมัติ: ${id}`
                    : `พบโมเดลตระกูลใหม่รออนุมัติ: ${id}`,
                detail: (cls.suggested && cls.suggested.basis) || info.name || id,
                confidence: cls.confidence
            });
            changes.push(alert);
        } else {
            existing.lastSeen = now;
            existing.accounts = [...info.accounts];
            existing.missedScans = 0;
            if (info.name && (!existing.name || existing.name === existing.id)) {
                existing.name = info.name;
            }

            if (existing.status === 'missing') {
                existing.status = 'active';
                const alert = appendAlert({
                    kind: 'returned',
                    modelId: id,
                    title: `โมเดลกลับมาใช้งานได้แล้ว: ${id}`,
                    detail: `พบกลับมาในบัญชี: ${info.accounts.join(', ')}`,
                    confidence: existing.confidence ?? 100
                });
                changes.push(alert);
            }
        }
    }

    // 2. ตรวจหาโมเดล active ของ agy ที่หายไป (เฉพาะเมื่อทุกบัญชี ready สแกนสำเร็จหมด)
    if (disc.allAccountsOk) {
        for (const entry of Object.values(reg.models)) {
            if (!entry || entry.engine !== 'agy') continue;
            if (entry.status !== 'active') continue;

            if (!disc.union.has(entry.id)) {
                entry.missedScans = (Number(entry.missedScans) || 0) + 1;
                if (entry.missedScans >= MISSING_CONSECUTIVE_SCANS) {
                    entry.status = 'missing';
                    const alert = appendAlert({
                        kind: 'missing',
                        modelId: entry.id,
                        title: `โมเดลหายจากระบบ: ${entry.id}`,
                        detail: `ไม่พบในผลสแกนที่สำเร็จจากทุกบัญชีติดต่อกัน ${entry.missedScans} รอบ`,
                        confidence: entry.confidence ?? 100
                    });
                    changes.push(alert);
                }
            }
        }
    }

    reg.lastScanAt = now;
    reg.lastScanOk = true;
    saveRegistry(reg);

    if (changes.length > 0) {
        await sendTelegramSummary(changes, reason);
    }

    return {
        ok: true,
        reason,
        discoveredCount: disc.union.size,
        allAccountsOk: disc.allAccountsOk,
        changes
    };
}

function scan(opts = {}) {
    if (scanInFlight) return scanInFlight;
    scanInFlight = runScanInternal(opts).finally(() => {
        scanInFlight = null;
    });
    return scanInFlight;
}

// ── User Actions: approve / reject / toggle ────────────────────────────────────
function approve(modelId, opts = {}) {
    const id = String(modelId || '').trim();
    const reg = loadRegistry();
    const entry = reg.models && reg.models[id];
    if (!entry) {
        return { ok: false, error: 'model_not_found' };
    }

    const now = new Date().toISOString();
    const baseSuggested = entry.suggested || {};
    const finalQ = opts.q ? sanitizeQ(opts.q, sanitizeQ(baseSuggested.q)) : sanitizeQ(baseSuggested.q);
    const finalCost = opts.cost !== undefined && opts.cost !== null
        ? sanitizeCost(opts.cost, sanitizeCost(baseSuggested.cost, 1))
        : sanitizeCost(baseSuggested.cost, 1);

    entry.status = 'active';
    entry.decidedBy = 'user';
    entry.decidedAt = now;
    entry.missedScans = 0;
    entry.suggested = {
        ...baseSuggested,
        q: finalQ,
        cost: finalCost
    };

    // ถ้าเป็นโมเดล agy ตระกูลใหม่ (ยังไม่อยู่ใน base families) → สร้าง/ขยาย customFamilies
    const baseFamilyIds = new Set((deps.families || []).map((f) => f && f.id).filter(Boolean));
    if (entry.engine === 'agy' && (!entry.family || !baseFamilyIds.has(entry.family))) {
        if (!Array.isArray(reg.customFamilies)) reg.customFamilies = [];

        const match = id.match(VARIANT_SUFFIX_RE);
        if (match) {
            const variant = match[1];
            const prefix = id.slice(0, id.length - variant.length);
            const famId = entry.family || deriveFamilyId(prefix);

            let cf = reg.customFamilies.find((f) => f && (f.prefix === prefix || f.id === famId));
            if (cf) {
                if (!Array.isArray(cf.variants)) cf.variants = [];
                if (!cf.variants.includes(variant)) cf.variants.push(variant);
                if (opts.q) cf.q = finalQ;
                if (opts.cost !== undefined && opts.cost !== null) cf.cost = finalCost;
            } else {
                cf = {
                    id: famId,
                    engine: 'agy',
                    label: deriveFamilyLabel(entry.name, prefix),
                    variants: [variant],
                    prefix,
                    q: finalQ,
                    cost: finalCost,
                    approvedAt: now
                };
                reg.customFamilies.push(cf);
            }
            entry.family = cf.id;
        } else {
            // โมเดลที่ไม่มี effort suffix (เช่น orchestrator)
            const famId = entry.family || deriveFamilyId(id);
            let cf = reg.customFamilies.find((f) => f && (f.model === id || f.id === famId));
            if (cf) {
                if (opts.q) cf.q = finalQ;
                if (opts.cost !== undefined && opts.cost !== null) cf.cost = finalCost;
            } else {
                cf = {
                    id: famId,
                    engine: 'agy',
                    label: entry.name || deriveFamilyLabel(null, id),
                    variants: [null],
                    model: id,
                    q: finalQ,
                    cost: finalCost,
                    approvedAt: now
                };
                reg.customFamilies.push(cf);
            }
            entry.family = cf.id;
        }
    }

    saveRegistry(reg);

    appendAlert({
        kind: 'approved',
        modelId: id,
        title: `อนุมัติโมเดล: ${id}`,
        detail: `ตระกูล ${entry.family || '-'} · q=${finalQ.code}/${finalQ.analysis}/${finalQ.chat} · cost=${finalCost}`,
        confidence: entry.confidence ?? 100
    });

    return {
        ok: true,
        model: entry,
        customFamilies: reg.customFamilies
    };
}

function reject(modelId) {
    const id = String(modelId || '').trim();
    const reg = loadRegistry();
    const entry = reg.models && reg.models[id];
    if (!entry) {
        return { ok: false, error: 'model_not_found' };
    }

    const now = new Date().toISOString();
    entry.status = 'rejected';
    entry.decidedBy = 'user';
    entry.decidedAt = now;
    saveRegistry(reg);

    appendAlert({
        kind: 'rejected',
        modelId: id,
        title: `ปฏิเสธโมเดล: ${id}`,
        detail: 'ผู้ใช้ปฏิเสธการใช้งานโมเดลนี้ใน Router',
        confidence: entry.confidence ?? null
    });

    return { ok: true, model: entry };
}

function toggle(modelId, enabled) {
    const id = String(modelId || '').trim();
    const reg = loadRegistry();
    const entry = reg.models && reg.models[id];
    if (!entry) {
        return { ok: false, error: 'model_not_found' };
    }

    const isEnabled = Boolean(enabled);
    const now = new Date().toISOString();
    entry.status = isEnabled ? 'active' : 'disabled';
    entry.decidedBy = 'user';
    entry.decidedAt = now;
    if (isEnabled) {
        entry.missedScans = 0;
    }
    saveRegistry(reg);

    return { ok: true, model: entry };
}

// ── Pareto / Standby: โมเดลที่แพงกว่าแต่ฉลาดน้อยกว่าในถังเดียวกัน → สำรองเท่านั้น ─────────
// คำนวณใหม่เฉพาะเมื่อ registry เปลี่ยน (loadRegistry คืน object เดิมถ้าไฟล์ไม่เปลี่ยน)
let paretoCache = { data: null, result: null };
function getPareto() {
    const reg = loadRegistry();
    if (paretoCache.data !== reg || !paretoCache.result) {
        paretoCache = { data: reg, result: pareto.computePareto(Object.values(reg.models || {})) };
    }
    return paretoCache.result;
}

/** model id ที่ router ควรเลื่อนไปท้ายคิว (ใช้เฉพาะตอน fallback) สำหรับงานประเภท qType */
function getStandbyIds(qType) {
    try {
        return pareto.standbyIdsFor(getPareto(), qType);
    } catch (_) {
        return new Set();
    }
}

function getSnapshot() {
    const reg = loadRegistry();
    const models = Object.values(reg.models || {});
    const pendingCount = models.filter((m) => m && m.status === 'pending').length;
    return {
        ok: true,
        lastScanAt: reg.lastScanAt || null,
        lastScanOk: reg.lastScanOk === undefined ? null : reg.lastScanOk,
        lastResearchAt: reg.lastResearchAt || null,
        lastResearchSummary: reg.lastResearchSummary || null,
        models,
        customFamilies: Array.isArray(reg.customFamilies) ? reg.customFamilies : [],
        pendingCount,
        pareto: getPareto()
    };
}

// ── External Multi-Source Research & Ranking ───────────────────────────────────
function applyResearchResultToEntry(entry, res) {
    if (!entry || !res) return entry;
    entry.confidence = res.confidence;
    entry.suggested = {
        ...(entry.suggested || {}),
        q: sanitizeQ(res.suggested && res.suggested.q, sanitizeQ(entry.suggested && entry.suggested.q)),
        cost: sanitizeCost(res.suggested && res.suggested.cost, sanitizeCost(entry.suggested && entry.suggested.cost, 1)),
        pool: (entry.suggested && entry.suggested.pool) || (res.suggested && res.suggested.pool) || defaultPoolOf(entry.id),
        basis: (res.suggested && res.suggested.basis) || (entry.suggested && entry.suggested.basis) || ''
    };
    entry.research = {
        confidence: res.confidence,
        meetsMinSources: Boolean(res.meetsMinSources),
        uniqueDomainCount: Number(res.uniqueDomainCount) || 0,
        agreement: res.agreement || 'low',
        verdict: res.verdict || '',
        breakdown: res.breakdown || null,
        conflictReason: res.conflictReason || null,
        pricing: res.pricing || null,
        effectiveQ: (res.suggested && res.suggested.effectiveQ) || entry.suggested.q,
        scores: res.scores || null,
        sources: Array.isArray(res.sources) ? res.sources : [],
        researchedAt: res.researchedAt || new Date().toISOString()
    };
    return entry;
}

async function researchModel(modelId, opts = {}) {
    if (!researcher) {
        return { ok: false, error: 'model_researcher_unavailable' };
    }
    const id = String(modelId || '').trim();
    const reg = loadRegistry();
    const entry = reg.models && reg.models[id];
    if (!entry) {
        return { ok: false, error: 'model_not_found' };
    }

    const res = await researcher.researchModel(entry, opts);
    applyResearchResultToEntry(entry, res);
    reg.lastResearchAt = new Date().toISOString();
    saveRegistry(reg);

    return {
        ok: true,
        model: entry,
        research: res
    };
}

async function researchAll(opts = {}) {
    if (!researcher) {
        return { ok: false, error: 'model_researcher_unavailable' };
    }
    const reg = loadRegistry();
    const entries = Object.values(reg.models || {});
    if (entries.length === 0) {
        return { ok: true, researchedCount: 0, meetsMinSourcesCount: 0, ranked: [], synthesis: null };
    }

    const evaluated = await researcher.researchModels(entries, opts);
    const byId = new Map(evaluated.map((r) => [r.id, r]));
    for (const entry of entries) {
        const r = byId.get(entry.id);
        if (r) applyResearchResultToEntry(entry, r);
    }

    const ranked = researcher.rankModels(evaluated, { sortBy: opts.sortBy || 'composite' });
    let synthesis = null;
    if (opts.useGemini) {
        synthesis = await researcher.synthesizeRankingWithGemini(ranked, opts);
    }

    const meetsMinSourcesCount = ranked.filter((m) => m.meetsMinSources).length;
    const now = new Date().toISOString();
    reg.lastResearchAt = now;
    reg.lastResearchSummary = {
        totalModels: ranked.length,
        meetsMinSourcesCount,
        avgConfidence: ranked.length > 0
            ? Number((ranked.reduce((s, m) => s + (m.confidence || 0), 0) / ranked.length).toFixed(1))
            : 0,
        top3: ranked.slice(0, 3).map((m) => ({
            rank: m.rank,
            id: m.id,
            name: m.name,
            confidence: m.confidence,
            avgQ: m.scores && m.scores.avgQ,
            cost: m.pricing && m.pricing.effectiveCost,
            sources: m.uniqueDomainCount
        })),
        geminiSynthesis: synthesis && synthesis.ok ? synthesis.summary : null
    };
    saveRegistry(reg);

    return {
        ok: true,
        researchedAt: now,
        researchedCount: ranked.length,
        meetsMinSourcesCount,
        summary: reg.lastResearchSummary,
        ranked,
        synthesis
    };
}

function getResearchRanking({ sortBy = 'composite' } = {}) {
    const reg = loadRegistry();
    const entries = Object.values(reg.models || {});
    if (!researcher) {
        return { ok: false, error: 'model_researcher_unavailable', ranked: [] };
    }

    const prepared = entries.map((e) => {
        const res = e.research || {};
        const baseQ = sanitizeQ(e.suggested && e.suggested.q);
        const effQ = res.effectiveQ ? sanitizeQ(res.effectiveQ, baseQ) : baseQ;
        const avgQ = (res.scores && Number.isFinite(res.scores.avgQ))
            ? res.scores.avgQ
            : Number((effQ.code * 0.4 + effQ.analysis * 0.35 + effQ.chat * 0.25).toFixed(1));
        const baseCost = sanitizeCost(e.suggested && e.suggested.cost, 1);
        const effCost = (res.pricing && Number.isFinite(res.pricing.effectiveCost)) ? res.pricing.effectiveCost : baseCost;
        const valueScore = (res.scores && Number.isFinite(res.scores.valueScore))
            ? res.scores.valueScore
            : Number((avgQ / Math.max(0.15, effCost)).toFixed(1));
        return {
            id: e.id,
            name: e.name,
            engine: e.engine,
            family: e.family,
            status: e.status,
            confidence: Number.isFinite(Number(e.confidence)) ? Number(e.confidence) : 25,
            meetsMinSources: Boolean(res.meetsMinSources),
            uniqueDomainCount: Number(res.uniqueDomainCount) || 0,
            agreement: res.agreement || 'low',
            verdict: res.verdict || (e.suggested && e.suggested.basis) || '',
            breakdown: res.breakdown || null,
            pricing: res.pricing || {
                inputUsdPer1M: null,
                outputUsdPer1M: null,
                costSource: 'baseline',
                baseCost,
                effectiveCost: effCost
            },
            suggested: {
                ...(e.suggested || {}),
                effectiveQ: effQ,
                effectiveCost: effCost
            },
            scores: { avgQ, valueScore },
            sources: Array.isArray(res.sources) ? res.sources : [],
            researchedAt: res.researchedAt || null
        };
    });

    const ranked = researcher.rankModels(prepared, { sortBy });
    return {
        ok: true,
        sortBy,
        lastResearchAt: reg.lastResearchAt || null,
        summary: reg.lastResearchSummary || null,
        ranked
    };
}

// ── Watchdog Scheduler ─────────────────────────────────────────────────────────
function startWatchdog({ intervalMs = 6 * 3600 * 1000, initialDelayMs = 90 * 1000 } = {}) {
    let stopped = false;
    let initialTimer = null;
    let intervalTimer = null;

    const trigger = (reason) => {
        if (stopped) return;
        scan({ reason }).catch(() => {});
    };

    initialTimer = setTimeout(() => {
        initialTimer = null;
        trigger('watchdog-initial');
    }, initialDelayMs);
    if (typeof initialTimer.unref === 'function') initialTimer.unref();

    intervalTimer = setInterval(() => {
        trigger('watchdog-periodic');
    }, intervalMs);
    if (typeof intervalTimer.unref === 'function') intervalTimer.unref();

    return function stopWatchdog() {
        stopped = true;
        if (initialTimer) {
            clearTimeout(initialTimer);
            initialTimer = null;
        }
        if (intervalTimer) {
            clearInterval(intervalTimer);
            intervalTimer = null;
        }
    };
}

module.exports = {
    AUTO_ENABLE_CONFIDENCE,
    init,
    loadRegistry,
    saveRegistry,
    discoverAgyModels,
    classifyNewModel,
    getEffectiveFamilies,
    isModelUsable,
    scan,
    approve,
    reject,
    toggle,
    listAlerts,
    ackAlerts,
    getSnapshot,
    researchModel,
    researchAll,
    getResearchRanking,
    getPareto,
    getStandbyIds,
    startWatchdog
};
