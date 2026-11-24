'use strict';

/**
 * ai-router.js
 * -----------------------------------------------------------------------------
 * 🧠 AI Router (สมองกลาง) — เลือกโมเดล/บัญชีให้อัตโนมัติ
 * Design: docs/ai-router.md
 *
 *  1. classifyTask()    : Flash Low → {type, complexity 0–100, risk, parallelizable, subtasks} → tier ต่ำ/กลาง/สูง/สูงมาก
 *  2. MODEL_FAMILIES    : คะแนนความเก่งต่อประเภทงาน + ต้นทุนโควตา ของแต่ละโมเดล
 *  3. buildCandidates() : ให้คะแนนทุก (โมเดล × บัญชี × effort) ด้วย pace 5h/weekly, load balance, stickiness
 *                         (subscription เรียงตามคะแนน, DeepSeek ต่อท้ายเสมอ)
 *  4. planSubagents()   : งานที่แบ่งขนานได้ → แนบคำสั่งให้ agy/Claude Code แตก subagent เอง
 *
 * Used by gemini-manager.js (chat 'auto' model) and server.js (/api/ai-router/* for cron).
 */

const { execFile } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const est = require('./difficulty-estimator');

const HOME_DIR = os.homedir();
const AGY_BIN = process.env.AGY_BIN || path.join(HOME_DIR, '.local/bin/agy');
const PROFILES_DIR = path.join(HOME_DIR, '.agy-profiles');
const TOKEN_REL = '.gemini/antigravity-cli/antigravity-oauth-token';
const LOG_FILE = path.join(HOME_DIR, '.gemini/ai-router-log.jsonl');
const CLASSIFY_CWD = path.join(HOME_DIR, '.gemini/router-tmp');
const CLASSIFIER_MODEL = process.env.AI_ROUTER_CLASSIFIER_MODEL || 'gemini-3.8-flash-low';
const OUTCOMES_FILE = process.env.AI_ROUTER_OUTCOMES_FILE || path.join(HOME_DIR, '.gemini/ai-router-outcomes.jsonl');

const AUTO_MODEL_ID = 'auto';
const PRIMARY_THRESHOLD = 20;   // % ที่ต้องเหลือเพื่อเป็นตัวเลือกแรก
const MIN_THRESHOLD = 5;        // ต่ำกว่านี้ถือว่าหมด
const UNKNOWN_QUOTA_PCT = 50;   // อ่านโควตาไม่ได้ → ถือว่าเหลือครึ่ง
const QUOTA_TTL_MS = 90 * 1000;
const CLASSIFY_TTL_MS = 2 * 60 * 60 * 1000;
const DEEPSEEK_MIN_BALANCE = 0.1;

// ── ② แคตตาล็อกโมเดล (v3): คะแนนความเก่งต่อประเภทงาน + ต้นทุนโควตา ─────────────
// q = คุณภาพที่ effort "medium" (0–100)
// cost = ราคา output ต่อ 1M token ÷ $7.50 (Hydrogen = 1.0) — Google: "Quota is consumed proportionally
//        to the cost of the tokens" ดังนั้นราคา = อัตรากินโควตาจริง (ตารางราคาที่บังยีให้มา 2026-11-21)
// Router ให้คะแนนทุก (โมเดล × บัญชี × effort) แล้วเรียงเอง ไม่ใช้ตารางลำดับตายตัวแล้ว
const MODEL_FAMILIES = [
    { id: 'claude-opus', engine: 'agy', label: 'Claude Opus 5.5', variants: ['low', 'medium', 'high'], prefix: 'claude-opus-5-5-', q: { code: 97, analysis: 95, chat: 90 }, cost: 2.67 },
    { id: 'claude-sonnet', engine: 'agy', label: 'Claude Sonnet 5.5', variants: ['low', 'medium', 'high'], prefix: 'claude-sonnet-5-5-', q: { code: 90, analysis: 87, chat: 89 }, cost: 1.33 },
    // GPT-OSS 120B: อยู่ pool "Claude & GPT" เดียวกับ Claude บน agy (pool เล็ก) · ราคาตลาด ~$0.15/$0.60 (ประมาณการ
    // ไม่ได้อยู่ในตารางของบังยี) → กินโควตา pool นี้น้อยมาก เหมาะกับงานเบาที่อยากใช้ pool Claude & GPT แบบประหยัด
    { id: 'gpt-oss', engine: 'agy', label: 'GPT-OSS 120B', variants: ['medium'], prefix: 'gpt-oss-120b-', q: { code: 76, analysis: 78, chat: 80 }, cost: 0.08 },
    // ── Gemini (บทบาทตามตาราง Antigravity ที่บังยีให้มา 2026-11-21) ──
    // Neon: ตัวหลักที่ฉลาดและคุ้มค่าที่สุด · โค้ดซับซ้อนใกล้รุ่นท็อป · หลอนต่ำสุด · ปรับตามคำสั่งกลางทางได้ดี · pool Gemini
    { id: 'gemini-neon', engine: 'agy', label: 'Gemini 4 Neon', variants: ['low', 'medium', 'high', 'xhigh'], prefix: 'gemini-4-neon-', q: { code: 96, analysis: 96, chat: 92 }, cost: 2 },
    // Orchestrator (Neon): Neon วางแผน + โมเดลเร็วลงมือ ในแชทเดียว · ใช้เฉพาะงานใหญ่ที่แบ่งได้ (requires: parallel)
    { id: 'gemini-orchestrator', engine: 'agy', label: 'Orchestrator (Neon)', variants: [null], model: 'gemini-pro-orchestrator-neon', q: { code: 98, analysis: 98, chat: 90 }, cost: 2.4, requires: 'parallel', nativeTeam: true },
    // Hydrogen: ม้างานประจำวัน แทน Flash · เร็วกว่า Flash 2.5× · ประหยัดโทเคน · หลอนน้อยกว่า 5× · เก่งเทอร์มินัล/แก้โค้ดเร็ว
    { id: 'gemini-hydrogen', engine: 'agy', label: 'Gemini 4 Hydrogen', variants: ['low', 'medium', 'high', 'xhigh'], prefix: 'gemini-4-hydrogen-', q: { code: 87, analysis: 88, chat: 88 }, cost: 1 },
    // Argon: รุ่นก่อนหน้า (legacy) ราคาเท่า Neon แต่ด้อยกว่า · ประโยชน์เดียวคือ pool แยก (weekly อย่างเดียว) ไว้ระบายโควตาที่จะหมดอายุ
    { id: 'gemini-argon', engine: 'agy', label: 'Gemini 4 Argon', variants: ['low', 'medium', 'high'], prefix: 'gemini-4-argon-', q: { code: 82, analysis: 84, chat: 84 }, cost: 2 },
    // Flash 3.8: สายประหยัด · ช้ากว่า Hydrogen 2–2.5× ในงานซับซ้อน · agentic/terminal ต่ำกว่าตระกูล 4
    { id: 'gemini-flash', engine: 'agy', label: 'Gemini 3.8 Flash', variants: ['low', 'medium', 'high'], prefix: 'gemini-3.8-flash-', q: { code: 70, analysis: 72, chat: 80 }, cost: 0.5 },
    { id: 'claude-code-opus', engine: 'claude-code', label: 'Claude Code · Opus', variants: [null], model: 'claude-code-opus', q: { code: 98, analysis: 95, chat: 90 }, cost: 2.67 },
    { id: 'claude-code-sonnet', engine: 'claude-code', label: 'Claude Code · Sonnet', variants: [null], model: 'claude-code-sonnet', q: { code: 91, analysis: 87, chat: 89 }, cost: 1.33 },
    { id: 'claude-code-haiku', engine: 'claude-code', label: 'Claude Code · Haiku', variants: [null], model: 'claude-code-haiku', q: { code: 68, analysis: 66, chat: 78 }, cost: 0.15 }
];
const DEEPSEEK_MODELS = [
    { model: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', q: 86, vision: false },
    { model: 'deepseek-flash', label: 'DeepSeek V4.1 Flash', q: 74, vision: true }
];
const ROUTES = {
    families: MODEL_FAMILIES.map(({ id, engine, label, variants, q, cost }) => ({ id, engine, label, variants, q, cost })),
    paid: DEEPSEEK_MODELS.map(({ model, q }) => ({ model, q }))
};
const TYPES = ['code', 'analysis', 'chat', 'quick'];

// ระดับความสำคัญ/ความพยายาม 4 ขั้น
const TIERS = ['low', 'medium', 'high', 'xhigh'];
const TIER_TH = { low: 'ต่ำ', medium: 'กลาง', high: 'สูง', xhigh: 'สูงมาก' };
const TIER_TARGET_Q = { low: 72, medium: 84, high: 91, xhigh: 96 };
const EFFORT_Q = { low: -6, medium: 0, high: 4, xhigh: 7 };
const EFFORT_COST = { low: 0.6, medium: 1, high: 1.5, xhigh: 2.2 };

const MODEL_LABELS = {};
for (const f of MODEL_FAMILIES) {
    for (const v of f.variants) {
        const id = f.model || `${f.prefix}${v}`;
        MODEL_LABELS[id] = v ? `${f.label} (${v === 'xhigh' ? 'XHigh' : v[0].toUpperCase() + v.slice(1)})` : f.label;
    }
}
for (const d of DEEPSEEK_MODELS) MODEL_LABELS[d.model] = d.label;

let registry = null;
try {
    registry = require('./model-registry');
} catch (_) {
    registry = null;
}

let registryInitialized = false;
function ensureRegistryInit() {
    if (!registry || registryInitialized) return;
    registryInitialized = true;
    try {
        registry.init({
            families: MODEL_FAMILIES,
            deepseekModels: DEEPSEEK_MODELS.map((d) => ({ id: d.model, name: d.label, q: d.q })),
            claudeCodeModels: MODEL_FAMILIES.filter((f) => f.engine === 'claude-code').map((f) => ({ id: f.model, name: f.label })),
            listAccounts: listAgyAccounts,
            agyBin: AGY_BIN,
            healBinaryCache,
            isBinaryCrash,
            poolOf: agyPoolId
        });
    } catch (_) {}
}

function activeFamilies() {
    try {
        ensureRegistryInit();
        return registry ? registry.getEffectiveFamilies(MODEL_FAMILIES) : MODEL_FAMILIES;
    } catch (_) {
        return MODEL_FAMILIES;
    }
}

function modelUsable(id) {
    try {
        ensureRegistryInit();
        return !registry || registry.isModelUsable(id);
    } catch (_) {
        return true;
    }
}

/** โมเดลที่ถูกกลบ (Pareto) สำหรับงานประเภทนี้ → ใช้เฉพาะตอน fallback */
function standbyIds(qType) {
    try {
        ensureRegistryInit();
        return registry && typeof registry.getStandbyIds === 'function' ? registry.getStandbyIds(qType) : new Set();
    } catch (_) {
        return new Set();
    }
}

function getRoutes() {
    const fams = activeFamilies();
    return {
        families: fams.map(({ id, engine, label, variants, q, cost }) => ({ id, engine, label, variants, q, cost })),
        paid: DEEPSEEK_MODELS.filter((d) => modelUsable(d.model)).map(({ model, q }) => ({ model, q }))
    };
}

const CODE_HINT_RE = /code|โค้ด|bug|บั๊ก|แก้|fix|script|สคริปต์|deploy|config|\.js|\.py|function|error|api|sql|docker|pm2|git/i;
// Go / Bun runtime crash before the CLI even finishes starting — on this host that means a RAM bit flip in the
// page-cached binary (see homelab RAM notes). Evicting the file from page cache reloads it from disk.
const CRASH_RE = /unexpected fault address|fatal error: (fault|unexpected signal)|SIGSEGV|SIGBUS|SIGILL|segmentation (fault|violation)|illegal instruction|oh no: Bun has crashed|panic\(main thread\)|Segmentation fault at address|bun\.report\/\d+\.\d+|={20,}\r?\nBun v\d+\.\d+/i;
const AUTH_OR_BILLING_RE = /\b401\b|\b402\b|\b403\b|invalid_grant|please sign in|not logged in|run \/login|unauthori[sz]ed|forbidden|invalid.?api.?key|insufficient.?balance|payment.?required|subscription|upgrade|ineligible|credit balance/i;
const QUOTA_OR_LIMIT_RE = /\b429\b|quota|resource[_ ]?exhausted|exhausted|rate.?limit|too many requests|hit your limit|usage limit|limit reached|session limit|5-?hour\s+limit|out of (?:extra )?usage|resets?\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)|โควตา/i;
const RETRYABLE_ERR_RE = /\b429\b|\b402\b|\b403\b|\b401\b|quota|resource[_ ]?exhausted|exhausted|rate.?limit|too many requests|overloaded|capacity|insufficient.?balance|payment.?required|credit|please sign in|not logged in|run \/login|unauthori[sz]ed|forbidden|invalid.?api.?key|invalid_grant|subscription|upgrade|hit your limit|usage limit|limit reached|session limit|5-?hour\s+limit|out of (?:extra )?usage|expired|model.?not.?found|not.?available|ineligible|โควตา/i;

const AUTH_COOLDOWN_MS = 15 * 60 * 1000;
const QUOTA_COOLDOWN_MS = 3 * 60 * 1000;
const TRANSIENT_COOLDOWN_MS = 90 * 1000;
const failureCooldowns = new Map(); // groupKey -> { until, kind, reason }

function isBinaryCrash(text) {
    return CRASH_RE.test(String(text || ''));
}

function summarizeCrashError(stderrText, engine = 'cli', fallback = '') {
    const raw = String(stderrText || '');
    const panicLine = raw.match(/panic\([^)]+\):[^\r\n]+/i)
        || raw.match(/(?:Segmentation fault|fatal error:|unexpected fault address|SIGSEGV|SIGBUS|SIGILL)[^\r\n]*/i);
    const detail = panicLine ? panicLine[0].trim() : (String(fallback || '').replace(/=+/g, '').trim() || 'SIGSEGV / RAM page-cache');
    return `${engine} crashed (${detail.slice(0, 100)})`;
}

let lastHealAt = 0;
/** Drop a binary from page cache (posix_fadvise DONTNEED) so the next exec re-reads it from disk. */
function healBinaryCache(file = AGY_BIN) {
    lastHealAt = Date.now();
    return new Promise((resolve) => {
        const code = 'import os,sys\np=os.path.realpath(sys.argv[1])\nfd=os.open(p,os.O_RDONLY)\nos.posix_fadvise(fd,0,0,os.POSIX_FADV_DONTNEED)\nos.close(fd)';
        execFile('python3', ['-c', code, file], { timeout: 15000 }, (err) => {
            logDecision({ source: 'heal', prompt: file, decision: null, event: 'heal', extra: { ok: !err, error: err ? err.message : undefined } });
            resolve(!err);
        });
    });
}

/** Failures in the same group share a cause, so failover skips the rest of that group. */
function failureGroup(candidate, crashed) {
    if (candidate.engine !== 'agy') return candidate.engine;
    return crashed ? `agy@${candidate.account}` : `agy@${candidate.account}:${agyPoolId(candidate.model)}`;
}

function recordFailure(candidate, { crashed = false, errorText = '', outputText = '', stderrText = '' } = {}) {
    if (!candidate) return;
    const combined = [errorText, outputText, stderrText].filter(Boolean).join('\n');
    let kind = 'transient';
    let ttl = TRANSIENT_COOLDOWN_MS;
    if (AUTH_OR_BILLING_RE.test(combined)) {
        kind = 'auth';
        ttl = AUTH_COOLDOWN_MS;
    } else if (QUOTA_OR_LIMIT_RE.test(combined)) {
        kind = 'quota';
        ttl = QUOTA_COOLDOWN_MS;
    }
    const key = failureGroup(candidate, crashed);
    failureCooldowns.set(key, { until: Date.now() + ttl, kind, reason: combined.slice(0, 160) });
    if (candidate.engine === 'agy' && candidate.account) {
        quotaCache.delete(candidate.account);
    } else if (candidate.engine === 'claude-code' || candidate.engine === 'deepseek') {
        providerQuotaCache = null;
        quotaCache.delete('g1');
    }
}

function isInCooldown(candidate) {
    if (!candidate) return false;
    const now = Date.now();
    for (const key of [failureGroup(candidate, false), failureGroup(candidate, true)]) {
        const rec = failureCooldowns.get(key);
        if (!rec) continue;
        if (rec.until > now) return true;
        failureCooldowns.delete(key);
    }
    return false;
}

function clearCooldowns() {
    failureCooldowns.clear();
    quotaCache.clear();
    providerQuotaCache = null;
}

function getCooldowns() {
    const now = Date.now();
    const out = {};
    for (const [k, rec] of failureCooldowns.entries()) {
        if (rec.until > now) out[k] = { ...rec, remainingSec: Math.ceil((rec.until - now) / 1000) };
        else failureCooldowns.delete(k);
    }
    return out;
}

function engineOf(model) {
    if (model.startsWith('claude-code-')) return 'claude-code';
    if (model.startsWith('deepseek-')) return 'deepseek';
    return 'agy';
}

function modelLabel(model) {
    if (MODEL_LABELS[model]) return MODEL_LABELS[model];
    try {
        for (const f of activeFamilies()) {
            if (f.model && f.model === model) return f.label || model;
            if (f.prefix && model && model.startsWith(f.prefix)) {
                const v = model.slice(f.prefix.length);
                if (v) {
                    const pretty = v === 'xhigh' ? 'XHigh' : v[0].toUpperCase() + v.slice(1);
                    return `${f.label} (${pretty})`;
                }
                return f.label || model;
            }
        }
        if (registry) {
            ensureRegistryInit();
            const snap = registry.getSnapshot();
            const entry = snap && Array.isArray(snap.models) && snap.models.find((m) => m && m.id === model);
            if (entry && entry.name) return entry.name;
        }
    } catch (_) {}
    return model;
}

// ── บัญชี Google Antigravity ──────────────────────────────────────────────────
function readTokenEmail(home) {
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(home, TOKEN_REL), 'utf8'));
        return raw.id_token_email || null;
    } catch (_) {
        return null;
    }
}

/** บัญชีหลัก ($HOME) + ทุกโฟลเดอร์ใน ~/.agy-profiles/ ที่ล็อกอินแล้ว เรียงตามชื่อ */
function listAgyAccounts() {
    const accounts = [{ id: 'g1', label: 'Google#1', home: HOME_DIR }];
    try {
        const dirs = fs.readdirSync(PROFILES_DIR, { withFileTypes: true })
            .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
            .map((d) => d.name)
            .sort();
        for (const name of dirs) {
            const n = accounts.length + 1;
            accounts.push({ id: `g${n}`, label: `Google#${n}`, home: path.join(PROFILES_DIR, name), profile: name });
        }
    } catch (_) {}
    return accounts.map((a) => {
        const ready = fs.existsSync(path.join(a.home, TOKEN_REL));
        return { ...a, ready, email: ready ? readTokenEmail(a.home) : null };
    });
}

function getAgyAccountExact(id) {
    const all = listAgyAccounts();
    return all.find((a) => a.id === id) || all[0];
}

function getAgyAccount(id) {
    const all = listAgyAccounts();
    return all.find((a) => a.id === id && a.ready)
        || all.find((a) => a.ready)
        || all.find((a) => a.id === id)
        || all[0];
}

function agyTokenFile(account) {
    return path.join(account.home, TOKEN_REL);
}

function agyBrainDir(account) {
    return path.join(account.home, '.gemini/antigravity-cli/brain');
}

// ── ③ โควตา ───────────────────────────────────────────────────────────────────
let quotaProvider = null;         // injected: async ({ accountId }) => getQuotaSummary result
let providerQuotaProvider = null; // injected: async () => ({ deepseek, claudeWeb }) independent of g1
const quotaCache = new Map();     // accountId -> { at, data }
let providerQuotaCache = null;    // { at, data }

function setQuotaProvider(fn) {
    quotaProvider = fn;
}

function setProviderQuotaProvider(fn) {
    providerQuotaProvider = fn;
}

async function getAccountQuota(accountId) {
    const hit = quotaCache.get(accountId);
    if (hit && Date.now() - hit.at < QUOTA_TTL_MS) return hit.data;
    let data = null;
    try {
        data = quotaProvider ? await quotaProvider({ accountId }) : null;
    } catch (err) {
        data = { ok: false, error: err.message };
    }
    quotaCache.set(accountId, { at: Date.now(), data });
    return data;
}

async function getProviderQuotas(primaryAccountQuota = null) {
    if (providerQuotaCache && Date.now() - providerQuotaCache.at < QUOTA_TTL_MS) {
        return providerQuotaCache.data;
    }
    let data = null;
    if (providerQuotaProvider) {
        try {
            data = await providerQuotaProvider();
        } catch (_) {
            data = null;
        }
    }
    if (!data && primaryAccountQuota && (primaryAccountQuota.deepseek !== undefined || primaryAccountQuota.claudeWeb !== undefined)) {
        data = { deepseek: primaryAccountQuota.deepseek || null, claudeWeb: primaryAccountQuota.claudeWeb || null };
    }
    if (!data) {
        const g1q = await getAccountQuota('g1');
        data = {
            deepseek: (g1q && g1q.deepseek) || null,
            claudeWeb: (g1q && g1q.claudeWeb) || null
        };
    }
    providerQuotaCache = { at: Date.now(), data };
    return data;
}

function agyPoolId(model) {
    if (/argon/i.test(model)) return 'argon';
    if (/^(claude|gpt)/i.test(model)) return 'claude';
    return 'gemini';
}

const FALLBACK_UNKNOWN_PCT = 15; // ใช้เป็นตัวสำรอง tier 2 ไม่แซงหน้าบัญชีที่โควตาดี > 20%

/** % ที่เหลือของโมเดล agy ในบัญชีนี้; null = โมเดล/บัญชีนี้ใช้ไม่ได้ (ควรถูกข้าม) */
function agyRemainingPct(quota, model) {
    if (!quota || !quota.ok) {
        if (quota && quota.authError) return null;
        return FALLBACK_UNKNOWN_PCT;
    }
    const poolId = agyPoolId(model);
    const pool = (quota.pools || []).find((p) => p.id === poolId);
    if (pool) return pool.remainingPct;
    if ((quota.unavailablePools || []).some((p) => p.id === poolId)) return null;
    return FALLBACK_UNKNOWN_PCT;
}

/** % ที่เหลือของ Claude Pro (Claude Code CLI); null = ไม่ได้สมัคร / หมดสิทธิ์ / ยังไม่ได้ตั้งค่า */
function claudeProRemainingPct(cw) {
    if (!cw) return null;
    if (!cw.ok) {
        if (cw.configured === false || cw.unsubscribed || cw.authError) return null;
        if (cw.configured && cw.transient) return FALLBACK_UNKNOWN_PCT;
        return null;
    }
    if (cw.plan && /^(free|none)$/i.test(String(cw.plan).trim())) return null;
    const vals = [cw.fiveHour, cw.weekly].filter(Boolean).map((w) => w.remainingPct);
    return vals.length ? Math.min(...vals) : FALLBACK_UNKNOWN_PCT;
}

function deepseekUsable(ds) {
    if (!ds || !ds.ok) return false;
    return Boolean(ds.isAvailable) && parseFloat(ds.totalBalance || '0') > DEEPSEEK_MIN_BALANCE;
}

// ── ③ Budget & Pace Engine ────────────────────────────────────────────────────
// surplus = (% ที่เหลือ) − (% เวลาที่เหลือก่อนรีเซ็ต)
//   > 0 → ใช้ช้ากว่างบ (เหลือเฟือ) · < 0 → ใช้เร็วเกินงบ ต้องถนอม
// ใช้หน้าต่างที่ "ตึงที่สุด" (surplus ต่ำสุด) เป็นตัวตัดสิน
const WINDOW_MS = { '5h': 5 * 3600 * 1000, weekly: 7 * 24 * 3600 * 1000 };
const BOOST_SURPLUS = 0.2;
const CONSERVE_SURPLUS = -0.15;
const NEAR_RESET_FRAC = 0.2;
const NEAR_RESET_MIN_PCT = 20;
const EXPIRING_WINDOW_FRAC = 0.35; // โบนัส "ใช้หรือทิ้ง" เฉพาะช่วง 35% สุดท้ายของรอบรายสัปดาห์ (~2.5 วัน)
const FIVE_HOUR_CONSERVE_PCT = 15; // รอบ 5 ชม. ทำให้ถนอมเฉพาะตอนเหลือน้อยกว่านี้
const BUDGET_TH = { surge: '🟣 ใช้เต็มที่ (ใกล้รีเซ็ต)', boost: '🟢 ฟุ่มเฟือยได้', normal: '🔵 ปกติ', conserve: '🟡 ถนอม', critical: '🔴 ประหยัดสุด', unknown: '⚪ ไม่ทราบโควตา' };
// ลำดับความเข้มงวด: ตัวที่เข้มกว่าชนะเสมอ (มีหน้าต่างไหนวิกฤต → ทั้ง pool วิกฤต)
const MODE_RANK = { critical: 0, conserve: 1, normal: 2, boost: 3, surge: 4 };
const CRITICAL_SURPLUS = -0.35;
const FIVE_HOUR_CRITICAL_PCT = 8;
const SURGE_TIME_FRAC = 0.1;     // เหลือเวลา < 10% ของรอบ
const SURGE_MIN_PCT = 40;        // แต่ยังเหลือโควตา ≥ 40% → ใช้ให้หมดก่อนทิ้ง

function windowPace(name, w) {
    if (!w || typeof w.remainingPct !== 'number') return null;
    const R = w.remainingPct;
    const resetMs = w.resetTime ? Date.parse(w.resetTime) : NaN;
    // รอบที่ยังไม่เริ่มนับ (ไม่มีเวลารีเซ็ต + เต็ม) ไม่ใช่ข้อจำกัด
    if (Number.isNaN(resetMs) && R >= 99) return null;
    const len = WINDOW_MS[name] || WINDOW_MS['5h'];
    const timeLeftFrac = Number.isNaN(resetMs) ? 0.5 : Math.max(0, Math.min(1, (resetMs - Date.now()) / len));
    return {
        name,
        remainingPct: R,
        timeLeftFrac: Number(timeLeftFrac.toFixed(3)),
        hoursLeft: Number.isNaN(resetMs) ? null : Number(((resetMs - Date.now()) / 3600000).toFixed(1)),
        surplus: Number((R / 100 - timeLeftFrac).toFixed(3))
    };
}

function assessBudget(windows) {
    const paces = windows.map(([n, w]) => windowPace(n, w)).filter(Boolean);
    if (!paces.length) return { mode: 'normal', surplus: 0, remainingPct: 100, windows: [] };
    const remainingPct = Math.min(...paces.map((p) => p.remainingPct));
    // รอบ 5 ชม. สั้นและรีเซ็ตเร็ว: ถ้าใช้เร็วกว่างบแต่ยังเหลือ ≥ 15% ไม่นับเป็นข้อจำกัด
    // (ให้รอบรายสัปดาห์เป็นตัวตัดสิน) — ถนอมเพราะ 5 ชม. เฉพาะตอนเหลือ < 15% จริงๆ
    const relaxed = (p) => p.name === '5h' && p.remainingPct >= FIVE_HOUR_CONSERVE_PCT && p.surplus < 0;
    const modeOf = (p) => {
        if (p.name === '5h' && p.remainingPct < FIVE_HOUR_CRITICAL_PCT) return 'critical';
        if (p.name === '5h' && p.remainingPct < FIVE_HOUR_CONSERVE_PCT) return 'conserve';
        if (relaxed(p)) return 'normal';
        if (p.surplus < CRITICAL_SURPLUS || p.remainingPct < 8) return 'critical';
        if (p.surplus < CONSERVE_SURPLUS) return 'conserve';
        if (p.timeLeftFrac < SURGE_TIME_FRAC && p.remainingPct >= SURGE_MIN_PCT) return 'surge';
        if (p.surplus >= BOOST_SURPLUS) return 'boost';
        if (p.timeLeftFrac < NEAR_RESET_FRAC && p.remainingPct >= NEAR_RESET_MIN_PCT) return 'boost';
        return 'normal';
    };
    const modes = paces.map(modeOf);
    // หน้าต่างที่เข้มงวดสุดเป็นตัวกำหนด ยกเว้นไม่มีใครเข้มงวด → ใช้หน้าต่างที่ใจกว้างสุด (boost/surge)
    let mode = modes.reduce((a, b) => (MODE_RANK[b] < MODE_RANK[a] ? b : a), 'normal');
    if (mode === 'normal') mode = modes.reduce((a, b) => (MODE_RANK[b] > MODE_RANK[a] ? b : a), 'normal');
    // surplus ที่ใช้ให้คะแนน: ไม่นับรอบ 5 ชม. ที่ผ่อนปรน (ถ้ายังมีหน้าต่างอื่นให้ดู)
    const scored = paces.filter((p) => !relaxed(p));
    const pool = scored.length ? scored : paces.map((p) => (relaxed(p) ? { ...p, surplus: 0 } : p));
    const binding = pool.reduce((a, b) => (b.surplus < a.surplus ? b : a));
    const boostWin = paces.find((p, i) => modes[i] === mode && (mode === 'boost' || mode === 'surge'));
    const surplus = (mode === 'boost' || mode === 'surge') && boostWin ? Math.max(binding.surplus, Math.min(boostWin.surplus, BOOST_SURPLUS)) : binding.surplus;
    // "ใช้หรือทิ้ง": โควตารายสัปดาห์ที่จะหายไปเปล่าๆ ถ้าไม่ใช้ก่อนรีเซ็ต (ทุกโหมดยกเว้นถนอม/ประหยัดสุด)
    // = %เหลือ × สัดส่วนของรอบที่ผ่านไปแล้ว → ยิ่งเหลือเยอะและยิ่งใกล้รีเซ็ต ยิ่งควรรีบใช้
    let expiring = 0;
    if (mode !== 'conserve' && mode !== 'critical') {
        for (const p of paces) {
            if (p.name !== 'weekly' || p.timeLeftFrac >= EXPIRING_WINDOW_FRAC) continue;
            expiring = Math.max(expiring, (p.remainingPct / 100) * (1 - p.timeLeftFrac));
        }
    }
    return { mode, surplus: Number(surplus.toFixed(3)), expiring: Number(expiring.toFixed(3)), remainingPct, binding: binding.name, windows: paces };
}

/** งบของ pool agy (gemini / claude / argon) ในบัญชีหนึ่ง; null = ใช้ไม่ได้ */
function agyPoolBudget(quota, model) {
    if (!quota || !quota.ok) {
        if (quota && quota.authError) return null;
        return { mode: 'unknown', surplus: -0.1, remainingPct: FALLBACK_UNKNOWN_PCT, windows: [] };
    }
    const poolId = agyPoolId(model);
    const pool = (quota.pools || []).find((p) => p.id === poolId);
    if (!pool) {
        if ((quota.unavailablePools || []).some((p) => p.id === poolId)) return null;
        return { mode: 'unknown', surplus: -0.1, remainingPct: FALLBACK_UNKNOWN_PCT, windows: [] };
    }
    const windows = (pool.fiveHour || pool.weekly)
        ? [['5h', pool.fiveHour], ['weekly', pool.weekly]]
        : [['5h', { remainingPct: pool.remainingPct, resetTime: pool.resetTime }]];
    return assessBudget(windows);
}

function claudeProBudget(cw) {
    const pct = claudeProRemainingPct(cw);
    if (pct === null) return null;
    if (!cw || !cw.ok) return { mode: 'unknown', surplus: -0.1, remainingPct: pct, windows: [] };
    return assessBudget([['5h', cw.fiveHour], ['weekly', cw.weekly]]);
}

// ── Load balancer: งานที่เพิ่งส่งไปแต่ละ pool ใน 30 นาทีล่าสุด ────────────────────
const RECENT_WINDOW_MS = 30 * 60 * 1000;
const recentPicks = new Map(); // poolKey -> [ts]

function poolKey(c) {
    return c.engine === 'agy' ? `agy@${c.account}:${agyPoolId(c.model)}` : c.engine;
}

function recentLoad(key) {
    const now = Date.now();
    const list = (recentPicks.get(key) || []).filter((t) => now - t < RECENT_WINDOW_MS);
    recentPicks.set(key, list);
    return list.length;
}

function notePick(c) {
    if (!c || c.paid) return;
    const key = poolKey(c);
    recentLoad(key);
    recentPicks.get(key).push(Date.now());
}

// ── Scoring ───────────────────────────────────────────────────────────────────
const MODE_THRIFT = { surge: 0.1, boost: 0.25, normal: 1, conserve: 2.2, critical: 4, unknown: 1.3 };
const MODE_EFFORT_SHIFT = { surge: 2, boost: 1, normal: 0, conserve: -1, critical: -2, unknown: 0 };
const EXPIRING_WEIGHT = 40; // คะแนนพิเศษต่อสัดส่วนโควตาที่กำลังจะหมดอายุ
const MODE_SCORE_BONUS = { surge: 8, boost: 0, normal: 0, conserve: 0, critical: -10, unknown: 0 };

function pickEffort(family, tier, mode) {
    if (family.variants.length === 1) return family.variants[0];
    const shift = MODE_EFFORT_SHIFT[mode] || 0;
    const want = Math.max(0, Math.min(TIERS.length - 1, TIERS.indexOf(tier) + shift));
    // เลือก variant ที่ใกล้ระดับที่ต้องการที่สุด (ไม่เกินที่มี)
    let best = family.variants[0];
    for (const v of family.variants) {
        if (TIERS.indexOf(v) <= want) best = v;
    }
    return best;
}

function scoreCandidate({ family, effort, budget, qType, tier, sticky, load }) {
    const q = family.q[qType] + (effort ? (EFFORT_Q[effort] ?? 0) : 0);
    const target = TIER_TARGET_Q[tier];
    const under = Math.max(0, target - q) * 4;                       // อ่อนเกินงาน → โทษหนัก
    const costW = family.cost * (effort ? (EFFORT_COST[effort] ?? 1) : 1);
    const over = Math.max(0, q - target) * 0.6 * costW * (MODE_THRIFT[budget.mode] || 1); // เกินงาน → เปลืองโควตา
    const budgetScore = budget.surplus * 30 + (budget.remainingPct < PRIMARY_THRESHOLD ? -15 : 0) + (MODE_SCORE_BONUS[budget.mode] || 0)
        + (budget.expiring || 0) * EXPIRING_WEIGHT;
    const loadScore = -4 * Math.min(4, load);
    const stickyScore = sticky ? 6 : 0;
    const total = q * 0.5 + budgetScore + loadScore + stickyScore - under - over;
    return {
        total: Number(total.toFixed(1)),
        parts: { q, under: Number(under.toFixed(1)), over: Number(over.toFixed(1)), budget: Number(budgetScore.toFixed(1)), load: loadScore, sticky: stickyScore }
    };
}

/**
 * ผู้สมัครทุกตัว (โมเดล × บัญชี × effort) เรียงตามคะแนน · DeepSeek ต่อท้ายเสมอ
 */
async function buildCandidates(cls, { hasImages = false, sessionAccount = null, modeOverride = null } = {}) {
    const tier = cls.tier || 'medium';
    const qType = cls.type === 'quick' ? 'chat' : cls.type;
    const accounts = listAgyAccounts().filter((a) => a.ready);
    const quotas = {};
    const [, provQuotas] = await Promise.all([
        Promise.all(accounts.map(async (a) => { quotas[a.id] = await getAccountQuota(a.id); })),
        getProviderQuotas()
    ]);
    const deepseekInfo = (quotas.g1 && quotas.g1.deepseek) || (provQuotas && provQuotas.deepseek) || null;
    const claudeWebInfo = (quotas.g1 && quotas.g1.claudeWeb) || (provQuotas && provQuotas.claudeWeb) || null;

    const subs = [];
    const consider = (family, base, budget) => {
        if (!budget || budget.remainingPct <= MIN_THRESHOLD) return;
        if (modeOverride) budget = { ...budget, mode: modeOverride };
        const effort = pickEffort(family, tier, budget.mode);
        const model = family.model || `${family.prefix}${effort}`;
        if (!modelUsable(model)) return;
        const cand = { ...base, model, engine: family.engine };
        if (isInCooldown(cand)) return;
        const score = scoreCandidate({
            family, effort, budget, qType, tier,
            sticky: family.engine === 'agy' && sessionAccount && base.account === sessionAccount,
            load: recentLoad(poolKey(cand))
        });
        subs.push({ ...cand, family: family.id, nativeTeam: Boolean(family.nativeTeam), effort, remainingPct: budget.remainingPct, budget, score: score.total, scoreParts: score.parts });
    };

    const bigParallel = Boolean(cls.parallelizable) && (cls.complexity || 0) >= 70;
    for (const family of activeFamilies()) {
        if (family.requires === 'parallel' && !bigParallel) continue;
        if (family.engine === 'agy') {
            for (const acc of accounts) {
                const probeModel = family.model || `${family.prefix}${family.variants[0]}`;
                consider(family, { account: acc.id, accountLabel: acc.label, home: acc.home }, agyPoolBudget(quotas[acc.id], probeModel));
            }
        } else {
            consider(family, { account: 'claude-pro', accountLabel: 'Claude Pro' }, claudeProBudget(claudeWebInfo));
        }
    }
    subs.sort((a, b) => b.score - a.score);
    // Pareto: ตัวที่มีโมเดลถูกกว่า+ฉลาดกว่าในถังเดียวกัน → ย้ายไปท้ายคิว (ยังเป็น fallback ก่อน DeepSeek)
    const standby = standbyIds(qType);
    const primary = subs.filter((c) => !standby.has(c.model));
    const reserve = subs.filter((c) => standby.has(c.model)).map((c) => ({ ...c, standby: true }));
    const out = primary.length ? [...primary, ...reserve] : [...subs];

    if (deepseekUsable(deepseekInfo)) {
        const order = hasImages
            ? DEEPSEEK_MODELS.filter((d) => d.vision)
            : (TIERS.indexOf(tier) >= 2 ? DEEPSEEK_MODELS : [...DEEPSEEK_MODELS].reverse());
        for (const d of order) {
            if (!modelUsable(d.model)) continue;
            const dsCand = { model: d.model, engine: 'deepseek', account: 'deepseek', accountLabel: 'DeepSeek (จ่ายตามใช้)', balance: deepseekInfo.totalBalance, paid: true };
            if (isInCooldown(dsCand)) continue;
            out.push(dsCand);
        }
    }
    return out.map((c) => ({ ...c, label: modelLabel(c.model) }));
}

// ── ① คัดงาน (v4): rubric แยกมิติ + ตัวช่วยตรวจ + บริบทแชท + วงจรป้อนกลับ ───────────────
// รายละเอียด: difficulty-estimator.js และ docs/ai-router.md หัวข้อ "ตัวประเมินความยาก v4"
const classifyCache = new Map(); // hash -> { at, rubric }  (เก็บผลดิบของ AI; คะแนนสุดท้ายคำนวณใหม่ทุกครั้งจากตัวช่วยตรวจ+บริบท)
const GREETING_RE = /^(สวัสดี|หวัดดี|hello|hi|hey|ขอบคุณ|thanks?|thank you|ok|โอเค|ครับ|ค่ะ|ดีมาก|เยี่ยม)/i;
const TIER_TAG_RE = /#(สูงมาก|สูง|กลาง|ต่ำ|xhigh|high|medium|low)(?![\p{L}\p{M}\p{N}_])/iu;
const MODE_TAG_RE = /#(ประหยัดสุด|ประหยัด|ถนอม|เต็มที่|ฟุ่มเฟือย|critical|conserve|boost|surge)(?![\p{L}\p{M}\p{N}_])/iu;
const TEAM_TAG_RE = /#(ทีมข้ามค่าย|ข้ามค่าย|cross-team|team)(?![\p{L}\p{M}\p{N}_])/iu;
const SINGLE_TAG_RE = /#(เดี่ยว|single)(?![\p{L}\p{M}\p{N}_])/iu;
const TIER_FROM_TAG = { 'สูงมาก': 'xhigh', 'สูง': 'high', 'กลาง': 'medium', 'ต่ำ': 'low', xhigh: 'xhigh', high: 'high', medium: 'medium', low: 'low' };
const MODE_FROM_TAG = { 'ประหยัดสุด': 'critical', critical: 'critical', 'ประหยัด': 'conserve', 'ถนอม': 'conserve', conserve: 'conserve', 'ฟุ่มเฟือย': 'boost', boost: 'boost', 'เต็มที่': 'surge', surge: 'surge' };

const levelFromComplexity = est.levelFromComplexity;
const tierFromScores = est.tierFromScores;

/** ใช้กับทางลัด (quick) — รูปแบบเดิมที่ให้ complexity/risk ตรงๆ */
function normalizeClassification(obj) {
    const rubric = est.normalizeRubric(obj);
    if (!rubric) return null;
    const complexity = rubric.legacyComplexity !== undefined ? rubric.legacyComplexity : est.scoreRubric(rubric).llm;
    const risk = rubric.legacyRisk !== undefined ? rubric.legacyRisk : rubric.risk * 25;
    const parallelizable = rubric.parallel >= 2 && rubric.type !== 'quick';
    return {
        type: rubric.type,
        complexity: rubric.type === 'quick' ? Math.min(complexity, 20) : complexity,
        risk,
        level: rubric.type === 'quick' ? 1 : levelFromComplexity(complexity),
        needs_tools: rubric.needsTools,
        parallelizable,
        subtasks: parallelizable ? Math.max(2, Math.min(6, rubric.parallel)) : 0,
        tier: tierFromScores(rubric.type, complexity, risk, rubric.needsTools),
        reason: rubric.reason,
        estimator: est.RUBRIC_VERSION
    };
}

function runClassifierOnce(prompt, account, contextBlock = '') {
    return new Promise((resolve) => {
        try { fs.mkdirSync(CLASSIFY_CWD, { recursive: true }); } catch (_) {}
        const args = ['-p', est.buildRubricPrompt(prompt, contextBlock), '--model', CLASSIFIER_MODEL, '--disable-slash-commands', '--print-timeout', '40s'];
        execFile(AGY_BIN, args, {
            cwd: CLASSIFY_CWD,
            timeout: 50000,
            env: { ...process.env, HOME: account.home, FORCE_COLOR: '0' }
        }, (err, stdout, stderr) => {
            if (err) {
                const errText = String(stderr || err.message || '');
                console.error(`[AiRouter] classifier failed on ${account.label}: ${errText.slice(0, 200)}`);
                return resolve({ result: null, crashed: isBinaryCrash(stderr), errorText: errText });
            }
            resolve({ result: est.parseRubric(stdout), crashed: false, errorText: '' });
        });
    });
}

async function runClassifier(prompt, account, contextBlock = '') {
    let attempt = await runClassifierOnce(prompt, account, contextBlock);
    if (attempt.crashed) {
        await healBinaryCache(AGY_BIN);
        attempt = await runClassifierOnce(prompt, account, contextBlock);
    }
    if (!attempt.result && attempt.errorText) {
        recordFailure({ engine: 'agy', account: account.id, model: CLASSIFIER_MODEL }, {
            crashed: attempt.crashed,
            errorText: attempt.errorText
        });
    }
    return attempt.result;
}

/** prior ของห้องแชท: หน่วยความจำก่อน ไม่มีค่อยอ่านย้อนจาก log (รอดการรีสตาร์ต dashboard) */
function getSessionPrior(sessionId) {
    if (!sessionId) return null;
    let prior = est.getPrior(sessionId);
    if (prior) return prior;
    try {
        const stat = fs.statSync(LOG_FILE);
        const fd = fs.openSync(LOG_FILE, 'r');
        const size = Math.min(stat.size, 400 * 1024);
        const buf = Buffer.alloc(size);
        fs.readSync(fd, buf, 0, size, stat.size - size);
        fs.closeSync(fd);
        const now = Date.now();
        const records = [];
        for (const line of buf.toString('utf8').split('\n').reverse()) {
            if (!line.includes(sessionId)) continue;
            let e;
            try { e = JSON.parse(line); } catch (_) { continue; }
            if (e.event !== 'route' || e.sessionId !== sessionId || !e.classification || typeof e.classification.complexity !== 'number') continue;
            const at = Date.parse(e.ts);
            if (!(now - at < est.constants.SESSION_TTL_MS)) break;
            records.push({ at, complexity: e.classification.complexity, risk: e.classification.risk || 0, type: e.classification.type, effective: e.classification.complexity, observed: null });
            if (records.length >= 3) break;
        }
        if (records.length) {
            est.seedPrior(sessionId, records);
            prior = est.getPrior(sessionId);
        }
    } catch (_) {}
    return prior;
}

/**
 * ข้อความที่ตัดสินได้เลยโดยไม่เรียกตัวคัดงาน
 * - คำทักทาย/ขอบคุณสั้นๆ: เสมอ
 * - ข้อความสั้น ≤20 ตัวอักษร: เฉพาะเมื่อห้องแชทยังไม่มีประวัติ — ถ้ามีประวัติ ข้อความสั้นมักตอบ/เลือกต่อจากข้อเสนอก่อนหน้า
 *   ("เอาแบบที่ 2 เลยครับ" = งานที่ใหญ่ที่สุดของข้อเสนอ) ต้องดูบริบทก่อน (พบจากชุดทดสอบ holdout2 ข้อ h08)
 */
function isShortcutText(text, hasHistory = false) {
    const t = String(text || '').trim();
    if (CODE_HINT_RE.test(t)) return false;
    if (t.length <= 40 && GREETING_RE.test(t)) return true;
    return t.length <= 20 && !hasHistory;
}

/**
 * @param {string} prompt
 * @param {object} [opts]
 * @param {Array}  [opts.history]    ข้อความก่อนหน้าในห้องแชท [{role, content}]
 * @param {string} [opts.sessionId]  ใช้หา prior (ความยากของงานก่อนหน้า) สำหรับข้อความต่อเนื่อง
 * @param {boolean} [opts.hasImages]
 * @param {boolean} [opts.noCache]   ข้าม cache (ใช้ตอนวัดผล)
 */
async function classifyTask(prompt, opts = {}) {
    const text = String(prompt || '').trim();
    const { history = [], sessionId = null, hasImages = false, noCache = false } = opts;
    const heur = est.heuristics(text, { hasImages });
    const prior = getSessionPrior(sessionId);

    // 0. "ทำต่อเลย" ล้วนๆ → สืบทอดความยากจากงานก่อนหน้า (ไม่เรียก AI ไม่เสียโควตา ไม่เสียเวลา)
    if (prior && prior.complexity >= 30 && est.isPureContinuation(text)) {
        return { ...est.inheritedClassification(prior, heur), source: 'continuation' };
    }

    // 1. ทางลัด: ข้อความสั้น/ทักทาย
    if (isShortcutText(text, history.length > 0)) {
        return { ...normalizeClassification({ type: 'quick', complexity: 5, risk: 0 }), reason: 'ข้อความสั้น/ทักทาย (ทางลัด ไม่เรียกตัวคัดงาน)', source: 'shortcut' };
    }

    // 2. ตัวคัดงาน: ข้อความสั้น (≤300 ตัวอักษร) ส่งบริบทแชทไปด้วย; ข้อความยาวอธิบายตัวเองครบแล้ว
    const contextBlock = (history.length > 0 && text.length <= 300) ? est.buildContextBlock(history, prior) : '';
    const hash = crypto.createHash('sha1').update(`${est.RUBRIC_VERSION}|${CLASSIFIER_MODEL}|${text}|${contextBlock}`).digest('hex');
    const hit = !noCache && classifyCache.get(hash);
    let rubric = null;
    let source = 'classifier';
    if (hit && Date.now() - hit.at < CLASSIFY_TTL_MS) {
        rubric = hit.rubric;
        source = 'cache';
    } else {
        // ใช้บัญชี Google ที่ pool gemini เหลือมากสุดก่อน (กระจายโหลดด้วย)
        const accs = listAgyAccounts().filter((a) => a.ready);
        const ranked = [];
        for (const acc of accs) {
            if (isInCooldown({ engine: 'agy', account: acc.id, model: CLASSIFIER_MODEL })) continue;
            const pct = agyRemainingPct(await getAccountQuota(acc.id), CLASSIFIER_MODEL);
            if (pct === null || pct <= MIN_THRESHOLD) continue;
            ranked.push({ acc, pct });
        }
        ranked.sort((a, b) => b.pct - a.pct);
        for (const { acc } of ranked) {
            rubric = await runClassifier(text, acc, contextBlock);
            if (rubric) break;
        }
        if (rubric && !noCache) {
            classifyCache.set(hash, { at: Date.now(), rubric });
            if (classifyCache.size > 300) classifyCache.delete(classifyCache.keys().next().value);
        }
    }
    if (!rubric) source = 'fallback';
    const cls = est.finalize({ rubric, heur, prior, fallbackType: CODE_HINT_RE.test(text) ? 'code' : 'chat' });
    return { ...cls, source };
}

// ── ④ แผนแบ่ง Subagent (แนวทางที่ 1: ให้ agy / Claude Code แตกทีมเองภายในงานเดียว) ──
const SUBAGENT_MAX = { surge: 5, boost: 4, normal: 3, conserve: 2, critical: 0, unknown: 2 };

function planSubagents(cls, chosen) {
    if (!chosen || chosen.paid || !cls.parallelizable) return null;
    if (cls.type === 'quick' || cls.type === 'chat') return null;
    const mode = (chosen.budget && chosen.budget.mode) || 'normal';
    // Orchestrator แตกทีมเองอยู่แล้ว — ไม่ต้องแนบคำสั่ง
    if (chosen.nativeTeam) return { native: true, engine: chosen.engine, mode };
    if (cls.complexity < 40 && (cls.subtasks || 0) < 3) return null;
    const max = SUBAGENT_MAX[mode] === undefined ? 2 : SUBAGENT_MAX[mode];
    if (max < 2) return null;
    const count = Math.max(2, Math.min(max, cls.subtasks || 2));
    let model = 'flash';
    if (mode === 'conserve') model = 'flash_lite';
    else if (mode === 'surge' && cls.complexity >= 60) model = 'pro';
    else if (mode === 'boost' && cls.complexity >= 80) model = 'pro';
    return { count, model, engine: chosen.engine, mode };
}

function buildSubagentDirective(plan) {
    if (!plan || plan.native) return '';
    if (plan.engine === 'agy') {
        return [
            '[คำสั่งจากสมองกลาง (AI Router) — แบ่งงานให้ subagent]',
            `งานนี้แบ่งเป็นส่วนอิสระได้ ให้ใช้เครื่องมือ invoke_subagent แตกงานส่วนที่ไม่ขึ้นต่อกันให้ทำพร้อมกัน ไม่เกิน ${plan.count} ตัว`,
            `- ตั้งค่า Model ของ subagent เป็น "${plan.model}" (ผู้ใช้ขอเพื่อคุมโควตา)${plan.model === 'pro' ? '' : ' — ถ้าส่วนไหนต้องคิดลึกจริงๆ ให้ทำเองแทน'}`,
            '- subagent ทำงานอ่าน/ค้น/ตรวจสอบ/วิเคราะห์ ถ้าต้องให้ subagent แก้ไฟล์ ต้องแบ่งคนละไฟล์ ห้ามแก้ไฟล์เดียวกัน',
            '- ตัวหลักเป็นผู้ประสานงาน: รวมผล ตรวจทาน แก้ไขขั้นสุดท้าย แล้วสรุปตอบผู้ใช้',
            '- ข้อความทุกส่วนที่ผู้ใช้เห็น (รวมถึงสถานะระหว่างรอ subagent) เขียนเป็นภาษาไทย',
            '- ถ้างานจริงไม่ได้แบ่งได้อย่างที่คิด ให้ทำเองตามปกติ ไม่ต้องฝืนแตก subagent',
            '[จบคำสั่งสมองกลาง]'
        ].join('\n');
    }
    if (plan.engine === 'claude-code') {
        return [
            '[คำสั่งจากสมองกลาง (AI Router) — แบ่งงานให้ subagent]',
            `งานนี้แบ่งเป็นส่วนอิสระได้ ให้ใช้ Agent/Task tool รัน subagent ขนานกันไม่เกิน ${plan.count} ตัว สำหรับส่วนที่อ่าน/ค้น/ตรวจสอบได้อิสระ`,
            `- ให้ subagent ใช้ model "${plan.model === 'pro' ? 'sonnet' : 'haiku'}" (ผู้ใช้ขอเพื่อคุมโควตา — Haiku ถูกที่สุด เหมาะกับค้นไฟล์/สรุปโค้ด)`,
            '- การแก้ไฟล์ให้ตัวหลักทำเอง หรือแบ่งคนละไฟล์ ห้ามแก้ไฟล์เดียวกันพร้อมกัน',
            '- รวมผลแล้วสรุปตอบผู้ใช้เป็นภาษาไทย ถ้างานแบ่งไม่ได้จริงให้ทำเองตามปกติ',
            '[จบคำสั่งสมองกลาง]'
        ].join('\n');
    }
    return '';
}

// ── ⑤ แผนทีมข้ามค่าย (Architect: Claude Opus → Workers: Gemini G1/G2 → Reviewer: Claude Opus) ──
// Fallback หลักเมื่อ Claude Opus ไม่พร้อม/โควตาวิกฤติ: เปลี่ยนเป็น Gemini 4 Neon (ไม่ใช่ Hydrogen)
const CROSS_TEAM_MIN_COMPLEXITY = 65;
const WORKER_FAMILY_CHAINS = {
    neon: ['gemini-neon', 'gemini-hydrogen', 'gemini-argon', 'gemini-flash', 'claude-sonnet', 'claude-code-sonnet'],
    hydrogen: ['gemini-hydrogen', 'gemini-neon', 'gemini-flash', 'gemini-argon', 'claude-sonnet', 'claude-code-sonnet'],
    flash: ['gemini-flash', 'gemini-hydrogen', 'gemini-neon', 'claude-code-haiku'],
    argon: ['gemini-argon', 'gemini-neon', 'gemini-hydrogen', 'gemini-flash']
};
const WORKER_DEFAULT_TIER = { flash: 'low', hydrogen: 'medium', argon: 'medium', neon: 'high' };

function normalizeWorkerFamily(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (/neon/.test(s)) return 'neon';
    if (/hydrogen/.test(s)) return 'hydrogen';
    if (/flash/.test(s)) return 'flash';
    if (/argon/.test(s)) return 'argon';
    return 'neon';
}

function upgradeNeonRoleCandidate(cand, tier = 'high') {
    if (!cand || cand.family !== 'gemini-neon') return cand;
    const mode = (cand.budget && cand.budget.mode) || 'normal';
    let targetEffort = cand.effort || 'high';
    if (mode === 'critical') {
        targetEffort = targetEffort === 'low' ? 'medium' : targetEffort;
    } else if (mode === 'conserve') {
        targetEffort = TIERS.indexOf(targetEffort) < TIERS.indexOf('medium') ? 'medium' : targetEffort;
    } else {
        const minEffort = (tier === 'xhigh' || mode === 'surge' || mode === 'boost') ? 'xhigh' : 'high';
        if (TIERS.indexOf(targetEffort) < TIERS.indexOf(minEffort)) targetEffort = minEffort;
    }
    const model = `gemini-4-neon-${targetEffort}`;
    if (model === cand.model) return cand;
    if (!modelUsable(model)) return cand;
    return { ...cand, effort: targetEffort, model, label: modelLabel(model) };
}

/**
 * จัดลำดับผู้สมัครสำหรับบทบาท Architect / Reviewer:
 *   1. Claude Opus (Claude Code หรือ Antigravity) ที่ไม่ติด critical
 *   2. Fallback หลัก: Gemini 4 Neon (High/XHigh) ที่ไม่ติด critical (ตามที่บังยีระบุ)
 *   3. Claude Sonnet / Gemini Hydrogen ที่ไม่ติด critical
 *   4. Claude Opus / Gemini 4 Neon ที่ติด critical (ยังคงลำดับ Opus → Neon)
 *   5. อื่นๆ (ไม่รวม paid) → DeepSeek เป็นอันดับสุดท้าย
 */
function pickCrossRoleQueue(candidates, { tier = 'high' } = {}) {
    const list = (candidates || []).filter((c) => !c.nativeTeam);
    const isOpus = (c) => c.family === 'claude-code-opus' || c.family === 'claude-opus' || /opus/i.test(c.model || '');
    const isNeon = (c) => c.family === 'gemini-neon' || /neon/i.test(c.model || '');
    const isCritical = (c) => (c.budget && c.budget.mode === 'critical') || (typeof c.remainingPct === 'number' && c.remainingPct < 10);

    const tierOf = (c) => {
        if (c.paid) return 7;
        if (isOpus(c) && !isCritical(c)) return 1;
        if (isNeon(c) && !isCritical(c)) return 2;
        if ((c.family === 'claude-code-sonnet' || c.family === 'claude-sonnet' || c.family === 'gemini-hydrogen') && !isCritical(c)) return 3;
        if (isOpus(c)) return 4;
        if (isNeon(c)) return 5;
        return 6;
    };

    return list
        .map((c, idx) => {
            const adj = isNeon(c) ? upgradeNeonRoleCandidate(c, tier) : c;
            return { c: adj, tier: tierOf(adj), idx };
        })
        .sort((a, b) => (a.tier - b.tier) || ((b.c.score || 0) - (a.c.score || 0)) || (a.idx - b.idx))
        .map((x) => x.c);
}

/**
 * สร้างแผนทีมข้ามค่าย: เปิดใช้เมื่อเป็นงาน chat ที่ซับซ้อน >= 65
 * หรือเมื่อบังยีระบุแท็ก #ทีมข้ามค่าย (และปิดเมื่อระบุ #เดี่ยว)
 */
function planTeamPipeline(cls, candidates, overrides = {}, source = 'chat') {
    const hasSub = (candidates || []).some((c) => !c.paid);
    if (!hasSub || overrides.single) {
        return { enabled: false, reason: overrides.single ? 'ผู้ใช้ระบุ #เดี่ยว' : 'ไม่มีบัญชีรายเดือนพร้อมใช้', architects: [], reviewers: [], workerAccounts: [], maxParallelWorkers: 1 };
    }
    const tier = (overrides && overrides.tier) || cls.tier || 'medium';
    const roleQueue = pickCrossRoleQueue(candidates, { tier });
    // บัญชี Google ที่ pool gemini พร้อมใช้ เรียงตาม score สูงสุด (ใช้กระจายโหลด Worker G1/G2)
    const workerAccounts = [];
    const seenAcc = new Set();
    for (const c of (candidates || [])) {
        if (c.engine !== 'agy' || c.nativeTeam || agyPoolId(c.model) !== 'gemini' || seenAcc.has(c.account)) continue;
        seenAcc.add(c.account);
        workerAccounts.push({ account: c.account, accountLabel: c.accountLabel, home: c.home, remainingPct: c.remainingPct, budget: c.budget, score: c.score });
    }
    const hasHealthyWorkerAcc = workerAccounts.some((w) => !w.budget || w.budget.mode !== 'critical');

    const isDeepWork = cls.type === 'code' || cls.type === 'analysis';
    const autoEligible = source === 'chat'
        && isDeepWork
        && !['low', 'medium'].includes(tier)
        && overrides.mode !== 'critical'
        && workerAccounts.length > 0
        && hasHealthyWorkerAcc
        && (cls.complexity || 0) >= CROSS_TEAM_MIN_COMPLEXITY;

    const enabled = Boolean((overrides.team || autoEligible) && roleQueue.length > 0);
    if (!enabled) {
        return { enabled: false, reason: 'งานไม่ถึงเกณฑ์ทีมข้ามค่าย (รันตัวเดียวเพื่อความเร็ว)', architects: [], reviewers: [], workerAccounts, maxParallelWorkers: 1 };
    }

    return {
        enabled: true,
        reason: overrides.team ? 'เปิดใช้ตามแท็ก #ทีมข้ามค่าย' : `งานซับซ้อน (${cls.complexity}/100 · ${TIER_TH[tier] || tier})`,
        architects: roleQueue,
        reviewers: roleQueue,
        workerAccounts,
        maxParallelWorkers: Math.min(2, Math.max(1, workerAccounts.length))
    };
}

/**
 * จัดลำดับผู้สมัครสำหรับ Worker ย่อยใน Stage 2 (Neon / Hydrogen / Flash / Argon)
 * เรียงตามลำดับตระกูลที่ Architect ร้องขอก่อน (รุ่นที่ขอไม่โดนคะแนนรุ่นอื่นแซง)
 * ภายในตระกูลเดียวกันกระจายไปยัง preferredAccount (G1/G2) ที่ไม่ติด critical ก่อน
 */
async function buildWorkerCandidates(requestedFamily = 'neon', { preferredAccount = null, tier = null, qType = 'code', hasImages = false, modeOverride = null } = {}) {
    const reqKey = normalizeWorkerFamily(requestedFamily);
    const effTier = tier || WORKER_DEFAULT_TIER[reqKey] || 'high';
    const chain = WORKER_FAMILY_CHAINS[reqKey];
    const accounts = listAgyAccounts().filter((a) => a.ready);
    const quotas = {};
    const [, provQuotas] = await Promise.all([
        Promise.all(accounts.map(async (a) => { quotas[a.id] = await getAccountQuota(a.id); })),
        getProviderQuotas()
    ]);
    const deepseekInfo = (quotas.g1 && quotas.g1.deepseek) || (provQuotas && provQuotas.deepseek) || null;
    const claudeWebInfo = (quotas.g1 && quotas.g1.claudeWeb) || (provQuotas && provQuotas.claudeWeb) || null;

    const subs = [];
    const families = activeFamilies();
    for (let rank = 0; rank < chain.length; rank++) {
        const family = families.find((f) => f.id === chain[rank]);
        if (!family) continue;
        if (family.engine === 'agy') {
            for (const acc of accounts) {
                const probeModel = family.model || `${family.prefix}${family.variants[0]}`;
                let budget = agyPoolBudget(quotas[acc.id], probeModel);
                if (!budget || budget.remainingPct <= MIN_THRESHOLD) continue;
                if (modeOverride) budget = { ...budget, mode: modeOverride };
                const effort = pickEffort(family, effTier, budget.mode);
                const model = family.model || `${family.prefix}${effort}`;
                if (!modelUsable(model)) continue;
                const cand = { model, engine: family.engine, account: acc.id, accountLabel: acc.label, home: acc.home };
                if (isInCooldown(cand)) continue;
                const sc = scoreCandidate({
                    family, effort, budget, qType, tier: effTier,
                    sticky: Boolean(preferredAccount && acc.id === preferredAccount),
                    load: recentLoad(poolKey(cand))
                });
                const isCrit = budget.mode === 'critical' || budget.remainingPct < 10;
                const prefMatch = Boolean(preferredAccount && acc.id === preferredAccount && !isCrit);
                subs.push({
                    ...cand,
                    family: family.id,
                    effort,
                    remainingPct: budget.remainingPct,
                    budget,
                    score: sc.total,
                    _crit: isCrit ? 1 : 0,
                    _rank: rank,
                    _pref: prefMatch ? 0 : 1
                });
            }
        } else {
            let budget = claudeProBudget(claudeWebInfo);
            if (!budget || budget.remainingPct <= MIN_THRESHOLD) continue;
            if (modeOverride) budget = { ...budget, mode: modeOverride };
            const effort = pickEffort(family, effTier, budget.mode);
            const model = family.model || `${family.prefix}${effort}`;
            if (!modelUsable(model)) continue;
            const cand = { model, engine: family.engine, account: 'claude-pro', accountLabel: 'Claude Pro' };
            if (isInCooldown(cand)) continue;
            const sc = scoreCandidate({ family, effort, budget, qType, tier: effTier, sticky: false, load: recentLoad(poolKey(cand)) });
            const isCrit = budget.mode === 'critical' || budget.remainingPct < 10;
            subs.push({
                ...cand,
                family: family.id,
                effort,
                remainingPct: budget.remainingPct,
                budget,
                score: sc.total,
                _crit: isCrit ? 1 : 0,
                _rank: rank,
                _pref: 1
            });
        }
    }

    // เรียง: ไม่ critical ก่อน → ตระกูลที่ Architect ขอมาก่อน → บัญชีที่จัดสรร (G1/G2) → คะแนนรวม
    subs.sort((a, b) => (a._crit - b._crit) || (a._rank - b._rank) || (a._pref - b._pref) || (b.score - a.score));
    const out = subs.map(({ _crit, _rank, _pref, ...rest }) => rest);

    if (deepseekUsable(deepseekInfo)) {
        const order = hasImages ? DEEPSEEK_MODELS.filter((d) => d.vision) : DEEPSEEK_MODELS;
        for (const d of order) {
            if (!modelUsable(d.model)) continue;
            const dsCand = { model: d.model, engine: 'deepseek', account: 'deepseek', accountLabel: 'DeepSeek (จ่ายตามใช้)', balance: deepseekInfo.totalBalance, paid: true };
            if (!isInCooldown(dsCand)) out.push(dsCand);
        }
    }
    return out.map((c) => ({ ...c, label: modelLabel(c.model) }));
}

// ── รวมทุกขั้น ────────────────────────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {boolean} [opts.hasImages]
 * @param {string} [opts.source]  'chat' | 'cron' | ...
 * @param {number} [opts.minLevel] บังคับระดับความยากขั้นต่ำ (เช่น cron alert จริง)
 * @param {string} [opts.sessionAccount] บัญชี Google ที่ห้องแชทนี้ใช้อยู่ (ลดการสลับบัญชีกลางบทสนทนา)
 */
async function routeTask({ prompt, hasImages = false, source = 'chat', minLevel = 1, sessionAccount = null, history = [], sessionId = null } = {}) {
    const startedAt = Date.now();
    const text = String(prompt || '');
    let cls = await classifyTask(text, { history, sessionId, hasImages });

    // minLevel (cron alert) → ดันความยากขั้นต่ำ
    const minLv = Math.min(3, minLevel || 1);
    if (minLv > cls.level) {
        const complexity = Math.max(cls.complexity, { 2: 50, 3: 75 }[minLv]);
        const type = cls.type === 'quick' ? 'chat' : cls.type;
        cls = { ...cls, type, complexity, level: levelFromComplexity(complexity), tier: tierFromScores(type, complexity, cls.risk, cls.needs_tools, cls.quality_bar || 0) };
    }
    // แท็กกำหนดเองในข้อความ เช่น #สูงมาก #ประหยัด #ทีมข้ามค่าย #เดี่ยว
    const tierTag = text.match(TIER_TAG_RE);
    const modeTag = text.match(MODE_TAG_RE);
    const teamTag = text.match(TEAM_TAG_RE);
    const singleTag = text.match(SINGLE_TAG_RE);
    const overrides = {};
    if (tierTag) {
        overrides.tier = TIER_FROM_TAG[tierTag[1].toLowerCase()];
        cls = { ...cls, tier: overrides.tier, type: cls.type === 'quick' ? 'chat' : cls.type };
    }
    if (modeTag) overrides.mode = MODE_FROM_TAG[modeTag[1].toLowerCase()];
    if (teamTag) overrides.team = true;
    if (singleTag) overrides.single = true;

    const candidates = await buildCandidates(cls, { hasImages, sessionAccount, modeOverride: overrides.mode || null });
    const teamPlan = planTeamPipeline(cls, candidates, overrides, source);
    const chosen = candidates[0] || null;
    const subagents = teamPlan.enabled ? null : planSubagents(cls, chosen);
    if (!teamPlan.enabled) notePick(chosen);
    const decision = {
        ok: candidates.length > 0,
        routeKey: `${cls.type}:${cls.tier}`,
        classification: cls,
        overrides,
        candidates,
        chosen,
        subagents,
        teamPlan,
        promptSnippet: text.slice(0, 120),
        tookMs: Date.now() - startedAt
    };
    // จำงานนี้ไว้เป็น prior ของข้อความถัดไปในห้องเดียวกัน (ใช้ความยากสุดท้ายหลังแท็ก/เกณฑ์ขั้นต่ำ)
    if (sessionId && cls.type !== 'quick') est.noteRouted(sessionId, cls);
    logDecision({ source, prompt, decision, extra: sessionId ? { sessionId } : {} });
    return decision;
}

/** คำสั่งแนบหน้าพรอมต์ของผู้สมัครตัวนี้ (ไม่ถูกบันทึกลงประวัติแชท) */
function directiveFor(decision, candidate) {
    if (!decision || !decision.subagents || !candidate || candidate.paid) return '';
    const plan = candidate === decision.chosen
        ? decision.subagents
        : planSubagents(decision.classification, candidate);
    return buildSubagentDirective(plan);
}

function formatBudget(c) {
    if (c.paid) return `มีค่าใช้จ่าย · ยอด $${c.balance}`;
    const b = c.budget || {};
    const ws = (b.windows || []).map((w) => `${w.name === 'weekly' ? 'wk' : '5h'} ${w.remainingPct}%${w.hoursLeft !== null && w.hoursLeft !== undefined ? ` รีเซ็ตอีก ${w.hoursLeft >= 24 ? (w.hoursLeft / 24).toFixed(1) + ' วัน' : w.hoursLeft + ' ชม.'}` : ''}`);
    const head = ws.length ? ws.join(' · ') : `เหลือ ${c.remainingPct}%`;
    return `${head} · ${BUDGET_TH[b.mode] || BUDGET_TH.normal}`;
}

function formatBanner(decision, chosen, note = '') {
    const c = chosen || decision.chosen;
    if (!c) return '';
    const cls = decision.classification || {};
    const prefix = note ? `↪️ ${note} → ` : '🧠 Auto → ';
    const plan = c === decision.chosen ? decision.subagents : planSubagents(cls, c);
    const team = !plan ? '' : (plan.native
        ? ' · 🤝 Orchestrator วางแผน+แตกทีมเอง'
        : ` · 🤝 แตก subagent ≤${plan.count} ตัว${plan.engine === 'agy' ? ` (${plan.model})` : ''}`);
    const tags = [];
    if (decision.overrides && decision.overrides.tier) tags.push(`#${TIER_TH[decision.overrides.tier]}`);
    if (decision.overrides && decision.overrides.mode) tags.push({ surge: '#เต็มที่', boost: '#ฟุ่มเฟือย', conserve: '#ประหยัด', critical: '#ประหยัดสุด' }[decision.overrides.mode] || '');
    const why = cls.reason ? `: ${cls.reason}` : '';
    const hm = est.formatMinutes(cls.humanMinutes);
    const diff = `ยาก ${cls.complexity}/100${hm ? ` (≈${hm})` : ''}${cls.continuation && (cls.continuation.inherited || cls.continuation.applied) ? ' ↩ต่อเนื่อง' : ''}`;
    return `> ${prefix}**${c.label}** · ${c.accountLabel} (${formatBudget(c)}) — ${cls.type} · ${diff} · ระดับ ${TIER_TH[cls.tier] || cls.tier}${team}${tags.length ? ' · ' + tags.join(' ') : ''}${why}\n\n`;
}

function isRetryableFailure(errorText, outputText, stderrText = '') {
    const out = String(outputText || '').trim();
    const err = String(errorText || '');
    const stderr = String(stderrText || '');
    if (out.length > 400) return false;
    return RETRYABLE_ERR_RE.test(err) || RETRYABLE_ERR_RE.test(out) || RETRYABLE_ERR_RE.test(stderr) || (!out && !!(err || stderr));
}

function isQuotaOrLimitError(errorText, outputText = '', stderrText = '') {
    const err = String(errorText || '');
    const stderr = String(stderrText || '');
    const outTail = String(outputText || '').slice(-1500);
    return QUOTA_OR_LIMIT_RE.test(err) || QUOTA_OR_LIMIT_RE.test(stderr) || QUOTA_OR_LIMIT_RE.test(outTail);
}

/**
 * Pick ranked healthy alternative models for manual/auto handoff when a model stops mid-task.
 */
async function pickAlternativeCandidates({
    prompt = '',
    hasImages = false,
    excludeEngine = null,
    excludeModel = null,
    excludeAccount = null,
    sessionId = null,
    history = []
} = {}) {
    let cls;
    try {
        cls = await classifyTask(String(prompt || ''), { history, sessionId, hasImages });
    } catch (_) {
        cls = { type: CODE_HINT_RE.test(String(prompt || '')) ? 'code' : 'chat', complexity: 60, level: 2, tier: 'high' };
    }
    const candidates = await buildCandidates(cls, { hasImages });
    const exEng = excludeEngine || (excludeModel ? engineOf(excludeModel) : null);
    const exGroup = (exEng === 'agy' && excludeModel && excludeAccount)
        ? `agy@${excludeAccount}:${agyPoolId(excludeModel)}`
        : null;

    const filtered = candidates.filter((c) => {
        if (exEng === 'claude-code' && c.engine === 'claude-code') return false;
        if (exEng === 'deepseek' && c.engine === 'deepseek') return false;
        if (exGroup && c.engine === 'agy' && `agy@${c.account}:${agyPoolId(c.model)}` === exGroup) return false;
        if (excludeModel && c.model === excludeModel && (!excludeAccount || c.account === excludeAccount)) return false;
        return true;
    });

    return {
        ok: filtered.length > 0,
        classification: cls,
        candidates: filtered.map((c) => ({
            model: c.model,
            engine: c.engine,
            account: c.account,
            accountLabel: c.accountLabel,
            label: c.label,
            remainingPct: c.remainingPct ?? null,
            budget: c.budget || null,
            paid: Boolean(c.paid),
            balance: c.balance ?? null,
            budgetText: formatBudget(c)
        }))
    };
}

function formatTeamBanner(decision, { architect, workersLabel, reviewer } = {}) {
    const cls = (decision && decision.classification) || {};
    const tp = (decision && decision.teamPlan) || {};
    const arch = architect || (tp.architects && tp.architects[0]) || decision.chosen;
    const rev = reviewer || (tp.reviewers && tp.reviewers[0]) || arch;
    const archTxt = arch ? `**${arch.label}** (${arch.accountLabel})` : 'Claude Opus';
    const revTxt = rev ? `**${rev.label}** (${rev.accountLabel})` : archTxt;
    const workTxt = workersLabel || 'Gemini Neon / Hydrogen / Flash (G1+G2)';
    const tags = [];
    if (decision && decision.overrides) {
        if (decision.overrides.tier) tags.push(`#${TIER_TH[decision.overrides.tier]}`);
        if (decision.overrides.mode) tags.push({ surge: '#เต็มที่', boost: '#ฟุ่มเฟือย', conserve: '#ประหยัด', critical: '#ประหยัดสุด' }[decision.overrides.mode] || '');
        if (decision.overrides.team) tags.push('#ทีมข้ามค่าย');
    }
    const why = cls.reason ? `: ${cls.reason}` : '';
    return `> 🧠 Auto [Cross-Team] → 🏗️ วางแผน: ${archTxt} · ⚡ ทำ: **${workTxt}** · 🔍 ตรวจ: ${revTxt} — ${cls.type || 'code'} · ยาก ${cls.complexity || 75}/100 · ระดับ ${TIER_TH[cls.tier] || cls.tier || 'สูง'}${tags.filter(Boolean).length ? ' · ' + tags.filter(Boolean).join(' ') : ''}${why}\n\n`;
}

function logDecision({ source, prompt, decision, event = 'route', extra = {} }) {
    const tp = decision && decision.teamPlan;
    const entry = {
        ts: new Date().toISOString(),
        event,
        source,
        prompt: String(prompt || '').slice(0, 200),
        routeKey: decision && decision.routeKey,
        classification: decision && decision.classification,
        chosen: decision && decision.chosen ? { model: decision.chosen.model, account: decision.chosen.account, remainingPct: decision.chosen.remainingPct, budget: decision.chosen.budget && decision.chosen.budget.mode, score: decision.chosen.score } : null,
        candidates: decision && Array.isArray(decision.candidates) ? decision.candidates.slice(0, 8).map((c) => `${c.model}@${c.account}${c.score !== undefined ? '=' + c.score : ''}`) : undefined,
        subagents: decision && decision.subagents ? decision.subagents : undefined,
        teamPlan: tp && tp.enabled ? { enabled: true, reason: tp.reason, architect: tp.architects[0] && `${tp.architects[0].model}@${tp.architects[0].account}`, reviewer: tp.reviewers[0] && `${tp.reviewers[0].model}@${tp.reviewers[0].account}` } : undefined,
        overrides: decision && decision.overrides && Object.keys(decision.overrides).length ? decision.overrides : undefined,
        tookMs: decision && decision.tookMs,
        ...extra
    };
    fsp.appendFile(LOG_FILE, JSON.stringify(entry) + '\n').catch(() => {});
}

async function readLog(limit = 100) {
    try {
        const raw = await fsp.readFile(LOG_FILE, 'utf8');
        return raw.trim().split('\n').slice(-limit).map((l) => {
            try { return JSON.parse(l); } catch (_) { return null; }
        }).filter(Boolean).reverse();
    } catch (_) {
        return [];
    }
}

// ── ④ วงจรป้อนกลับ: บันทึกผลจริงเทียบกับที่ทำนาย ───────────────────────────────────────
/**
 * เรียกตอนงานจบ (gemini-manager.finish)
 * @param {object} o  { sessionId, decision, steps, durationMs, ok, aborted, model, account, team }
 */
function noteOutcome({ sessionId = null, decision = null, steps = 0, durationMs = 0, ok = true, aborted = false, model = null, account = null, team = false } = {}) {
    if (!decision || !decision.classification) return null;
    const cls = decision.classification;
    // ไม่นับงานที่ถูกยกเลิก/พังทันที (ไม่ได้ทำงานจริง) เป็นความยากที่สังเกตได้
    const meaningful = !aborted && (steps > 0 || durationMs >= 15000);
    const obs = meaningful ? est.observedComplexity(steps, durationMs) : null;
    if (sessionId && meaningful) est.noteObserved(sessionId, { steps, durationMs });
    const entry = {
        ts: new Date().toISOString(),
        sessionId,
        source: 'chat',
        prompt: String(decision.promptSnippet || '').slice(0, 120),
        predicted: {
            type: cls.type, tier: cls.tier, complexity: cls.complexity, risk: cls.risk,
            humanMinutes: cls.humanMinutes || null, llm: cls.llmComplexity === undefined ? null : cls.llmComplexity,
            heuristic: cls.heuristic ? cls.heuristic.score : null, continuation: Boolean(cls.continuation && (cls.continuation.inherited || cls.continuation.applied)),
            classifier: cls.source
        },
        observed: { steps, durationMs, complexity: obs, counted: meaningful },
        ok: Boolean(ok), aborted: Boolean(aborted), team: Boolean(team), model, account
    };
    fsp.appendFile(OUTCOMES_FILE, JSON.stringify(entry) + '\n').catch(() => {});
    return entry;
}

/** สรุปความแม่นของการทำนาย: ต่อระดับที่ทำนาย → ค่าที่สังเกตได้จริง (ใช้ปรับเกณฑ์ด้วยมือ ไม่ปรับอัตโนมัติ) */
async function calibrationReport(limit = 2000) {
    let rows = [];
    try {
        const raw = await fsp.readFile(OUTCOMES_FILE, 'utf8');
        rows = raw.trim().split('\n').slice(-limit).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
    } catch (_) {}
    const counted = rows.filter((r) => r.observed && r.observed.counted && r.observed.complexity !== null);
    const median = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); const m = Math.floor(b.length / 2); return b.length % 2 ? b[m] : Math.round((b[m - 1] + b[m]) / 2); };
    const mean = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
    const byTier = {};
    for (const tier of ['low', 'medium', 'high', 'xhigh']) {
        const g = counted.filter((r) => r.predicted.tier === tier);
        byTier[tier] = {
            n: g.length,
            medianSteps: median(g.map((r) => r.observed.steps)),
            medianMinutes: g.length ? Number((median(g.map((r) => r.observed.durationMs)) / 60000).toFixed(1)) : null,
            meanObservedComplexity: mean(g.map((r) => r.observed.complexity)),
            meanPredictedComplexity: mean(g.map((r) => r.predicted.complexity))
        };
    }
    const under = counted.filter((r) => r.observed.complexity >= 70 && r.predicted.complexity < 50);
    const over = counted.filter((r) => r.observed.complexity <= 30 && r.predicted.complexity >= 70);
    const bySource = {};
    for (const r of counted) {
        const k = r.predicted.classifier || 'unknown';
        (bySource[k] = bySource[k] || []).push(r.observed.complexity - r.predicted.complexity);
    }
    return {
        ok: true,
        outcomes: rows.length,
        counted: counted.length,
        byTier,
        underEstimated: { n: under.length, rate: counted.length ? Number((under.length / counted.length).toFixed(3)) : null, examples: under.slice(-5).map((r) => ({ prompt: r.prompt, predicted: r.predicted.complexity, observed: r.observed.complexity })) },
        overEstimated: { n: over.length, rate: counted.length ? Number((over.length / counted.length).toFixed(3)) : null, examples: over.slice(-5).map((r) => ({ prompt: r.prompt, predicted: r.predicted.complexity, observed: r.observed.complexity })) },
        meanErrorBySource: Object.fromEntries(Object.entries(bySource).map(([k, v]) => [k, { n: v.length, meanObservedMinusPredicted: mean(v) }])),
        note: 'observed complexity ประมาณจากจำนวนขั้นตอน+เวลา (ไม่ใช่ความยากจริง) — ใช้เป็นแนวโน้ม ต้องมีตัวอย่างหลักสิบขึ้นไปจึงน่าเชื่อถือ'
    };
}

module.exports = {
    AUTO_MODEL_ID,
    CROSS_TEAM_MIN_COMPLEXITY,
    get ROUTES() { return getRoutes(); },
    getRoutes,
    activeFamilies,
    modelUsable,
    MODEL_FAMILIES,
    DEEPSEEK_MODELS,
    modelRegistry: registry,
    routeTask,
    classifyTask,
    isShortcutText,
    buildCandidates,
    buildWorkerCandidates,
    normalizeWorkerFamily,
    planTeamPipeline,
    pickCrossRoleQueue,
    notePick,
    agyPoolId,
    formatBanner,
    formatTeamBanner,
    directiveFor,
    TIER_TH,
    QUOTA_OR_LIMIT_RE,
    isRetryableFailure,
    isQuotaOrLimitError,
    pickAlternativeCandidates,
    isBinaryCrash,
    summarizeCrashError,
    healBinaryCache,
    failureGroup,
    assessBudget,
    AGY_BIN,
    logDecision,
    noteOutcome,
    calibrationReport,
    readLog,
    listAgyAccounts,
    getAgyAccount,
    getAgyAccountExact,
    agyTokenFile,
    agyBrainDir,
    setQuotaProvider,
    setProviderQuotaProvider,
    recordFailure,
    isInCooldown,
    clearCooldowns,
    getCooldowns,
    modelLabel
};
