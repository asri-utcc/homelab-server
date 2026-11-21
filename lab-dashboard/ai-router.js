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

const HOME_DIR = os.homedir();
const AGY_BIN = process.env.AGY_BIN || path.join(HOME_DIR, '.local/bin/agy');
const PROFILES_DIR = path.join(HOME_DIR, '.agy-profiles');
const TOKEN_REL = '.gemini/antigravity-cli/antigravity-oauth-token';
const LOG_FILE = path.join(HOME_DIR, '.gemini/ai-router-log.jsonl');
const CLASSIFY_CWD = path.join(HOME_DIR, '.gemini/router-tmp');
const CLASSIFIER_MODEL = 'gemini-3.8-flash-low';

const AUTO_MODEL_ID = 'auto';
const PRIMARY_THRESHOLD = 20;   // % ที่ต้องเหลือเพื่อเป็นตัวเลือกแรก
const MIN_THRESHOLD = 5;        // ต่ำกว่านี้ถือว่าหมด
const UNKNOWN_QUOTA_PCT = 50;   // อ่านโควตาไม่ได้ → ถือว่าเหลือครึ่ง
const QUOTA_TTL_MS = 90 * 1000;
const CLASSIFY_TTL_MS = 2 * 60 * 60 * 1000;
const DEEPSEEK_MIN_BALANCE = 0.1;

// ── ② แคตตาล็อกโมเดล (v2): คะแนนความเก่งต่อประเภทงาน + ต้นทุนโควตา ─────────────
// q = คุณภาพที่ effort "medium" (0–100) · cost = น้ำหนักการกินโควตา (1 = เบา)
// Router ให้คะแนนทุก (โมเดล × บัญชี × effort) แล้วเรียงเอง ไม่ใช้ตารางลำดับตายตัวแล้ว
const MODEL_FAMILIES = [
    { id: 'claude-opus', engine: 'agy', label: 'Claude Opus 5.5', variants: ['low', 'medium', 'high'], prefix: 'claude-opus-5-5-', q: { code: 97, analysis: 94, chat: 90 }, cost: 3 },
    { id: 'claude-sonnet', engine: 'agy', label: 'Claude Sonnet 5.5', variants: ['low', 'medium', 'high'], prefix: 'claude-sonnet-5-5-', q: { code: 91, analysis: 87, chat: 88 }, cost: 2 },
    { id: 'gemini-hydrogen', engine: 'agy', label: 'Gemini 4 Hydrogen', variants: ['low', 'medium', 'high', 'xhigh'], prefix: 'gemini-4-hydrogen-', q: { code: 86, analysis: 95, chat: 89 }, cost: 2 },
    { id: 'gemini-flash', engine: 'agy', label: 'Gemini 3.8 Flash', variants: ['low', 'medium', 'high'], prefix: 'gemini-3.8-flash-', q: { code: 72, analysis: 74, chat: 82 }, cost: 1 },
    { id: 'claude-code-opus', engine: 'claude-code', label: 'Claude Code · Opus', variants: [null], model: 'claude-code-opus', q: { code: 98, analysis: 94, chat: 90 }, cost: 3 },
    { id: 'claude-code-sonnet', engine: 'claude-code', label: 'Claude Code · Sonnet', variants: [null], model: 'claude-code-sonnet', q: { code: 92, analysis: 87, chat: 88 }, cost: 2 },
    { id: 'claude-code-haiku', engine: 'claude-code', label: 'Claude Code · Haiku', variants: [null], model: 'claude-code-haiku', q: { code: 72, analysis: 70, chat: 80 }, cost: 1 }
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

const CODE_HINT_RE = /code|โค้ด|bug|บั๊ก|แก้|fix|script|สคริปต์|deploy|config|\.js|\.py|function|error|api|sql|docker|pm2|git/i;
// Go runtime crash before the CLI even starts — on this host that means a RAM bit flip in the
// page-cached binary (see homelab RAM notes). Evicting the file from page cache reloads it from disk.
const CRASH_RE = /unexpected fault address|fatal error: (fault|unexpected signal)|SIGSEGV|SIGBUS|SIGILL|segmentation (fault|violation)|illegal instruction/i;
const AUTH_OR_BILLING_RE = /\b401\b|\b402\b|\b403\b|invalid_grant|please sign in|not logged in|run \/login|unauthori[sz]ed|forbidden|invalid.?api.?key|insufficient.?balance|payment.?required|subscription|upgrade|ineligible|credit balance/i;
const QUOTA_OR_LIMIT_RE = /\b429\b|quota|resource[_ ]?exhausted|exhausted|rate.?limit|too many requests|hit your limit|usage limit|limit reached|โควตา/i;
const RETRYABLE_ERR_RE = /\b429\b|\b402\b|\b403\b|\b401\b|quota|resource[_ ]?exhausted|exhausted|rate.?limit|too many requests|overloaded|capacity|insufficient.?balance|payment.?required|credit|please sign in|not logged in|run \/login|unauthori[sz]ed|forbidden|invalid.?api.?key|invalid_grant|subscription|upgrade|hit your limit|usage limit|limit reached|expired|model.?not.?found|not.?available|ineligible|โควตา/i;

const AUTH_COOLDOWN_MS = 15 * 60 * 1000;
const QUOTA_COOLDOWN_MS = 3 * 60 * 1000;
const TRANSIENT_COOLDOWN_MS = 90 * 1000;
const failureCooldowns = new Map(); // groupKey -> { until, kind, reason }

function isBinaryCrash(text) {
    return CRASH_RE.test(String(text || ''));
}

let lastHealAt = 0;
/** Drop a binary from page cache (posix_fadvise DONTNEED) so the next exec re-reads it from disk. */
function healBinaryCache(file = AGY_BIN) {
    lastHealAt = Date.now();
    return new Promise((resolve) => {
        const code = 'import os,sys\nfd=os.open(sys.argv[1],os.O_RDONLY)\nos.posix_fadvise(fd,0,0,os.POSIX_FADV_DONTNEED)\nos.close(fd)';
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
    return MODEL_LABELS[model] || model;
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
const NEAR_RESET_MIN_PCT = 30;
const BUDGET_TH = { boost: '🟢 ฟุ่มเฟือยได้', normal: '🔵 ปกติ', conserve: '🟡 ถนอม', unknown: '⚪ ไม่ทราบโควตา' };

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
    const binding = paces.reduce((a, b) => (b.surplus < a.surplus ? b : a));
    const remainingPct = Math.min(...paces.map((p) => p.remainingPct));
    // แต่ละหน้าต่างตัดสินโหมดของตัวเอง: หน้าต่างไหนใช้เกินงบ → ถนอมทั้ง pool
    // ไม่มีหน้าต่างไหนเกินงบ + มีหน้าต่างที่เหลือเฟือ/ใกล้รีเซ็ตแต่ยังเหลือเยอะ → ฟุ่มเฟือยได้
    const modeOf = (p) => {
        if (p.surplus < CONSERVE_SURPLUS) return 'conserve';
        if (p.surplus >= BOOST_SURPLUS) return 'boost';
        if (p.timeLeftFrac < NEAR_RESET_FRAC && p.remainingPct >= NEAR_RESET_MIN_PCT) return 'boost';
        return 'normal';
    };
    const modes = paces.map(modeOf);
    let mode = 'normal';
    if (modes.includes('conserve')) mode = 'conserve';
    else if (modes.includes('boost')) mode = 'boost';
    const boostWin = paces.find((p, i) => modes[i] === 'boost');
    // โหมด boost ใช้ surplus ของหน้าต่างที่เหลือเฟือ (ไม่ให้ 5h ที่เพิ่งเริ่มกดคะแนนลง)
    const surplus = mode === 'boost' && boostWin ? Math.max(binding.surplus, Math.min(boostWin.surplus, BOOST_SURPLUS)) : binding.surplus;
    return { mode, surplus: Number(surplus.toFixed(3)), remainingPct, binding: binding.name, windows: paces };
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
const MODE_THRIFT = { boost: 0.25, normal: 1, conserve: 2.2, unknown: 1.3 };

function pickEffort(family, tier, mode) {
    if (family.variants.length === 1) return family.variants[0];
    const shift = mode === 'boost' ? 1 : (mode === 'conserve' ? -1 : 0);
    const want = Math.max(0, Math.min(TIERS.length - 1, TIERS.indexOf(tier) + shift));
    // เลือก variant ที่ใกล้ระดับที่ต้องการที่สุด (ไม่เกินที่มี)
    let best = family.variants[0];
    for (const v of family.variants) {
        if (TIERS.indexOf(v) <= want) best = v;
    }
    return best;
}

function scoreCandidate({ family, effort, budget, qType, tier, sticky, load }) {
    const q = family.q[qType] + (effort ? EFFORT_Q[effort] : 0);
    const target = TIER_TARGET_Q[tier];
    const under = Math.max(0, target - q) * 4;                       // อ่อนเกินงาน → โทษหนัก
    const costW = family.cost * (effort ? EFFORT_COST[effort] : 1);
    const over = Math.max(0, q - target) * 0.6 * costW * (MODE_THRIFT[budget.mode] || 1); // เกินงาน → เปลืองโควตา
    const budgetScore = budget.surplus * 30 + (budget.remainingPct < PRIMARY_THRESHOLD ? -15 : 0);
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
        const cand = { ...base, model, engine: family.engine };
        if (isInCooldown(cand)) return;
        const score = scoreCandidate({
            family, effort, budget, qType, tier,
            sticky: family.engine === 'agy' && sessionAccount && base.account === sessionAccount,
            load: recentLoad(poolKey(cand))
        });
        subs.push({ ...cand, family: family.id, effort, remainingPct: budget.remainingPct, budget, score: score.total, scoreParts: score.parts });
    };

    for (const family of MODEL_FAMILIES) {
        if (family.engine === 'agy') {
            for (const acc of accounts) {
                const probeModel = `${family.prefix}${family.variants[0]}`;
                consider(family, { account: acc.id, accountLabel: acc.label, home: acc.home }, agyPoolBudget(quotas[acc.id], probeModel));
            }
        } else {
            consider(family, { account: 'claude-pro', accountLabel: 'Claude Pro' }, claudeProBudget(claudeWebInfo));
        }
    }
    subs.sort((a, b) => b.score - a.score);
    const out = [...subs];

    if (deepseekUsable(deepseekInfo)) {
        const order = hasImages
            ? DEEPSEEK_MODELS.filter((d) => d.vision)
            : (TIERS.indexOf(tier) >= 2 ? DEEPSEEK_MODELS : [...DEEPSEEK_MODELS].reverse());
        for (const d of order) {
            const dsCand = { model: d.model, engine: 'deepseek', account: 'deepseek', accountLabel: 'DeepSeek (จ่ายตามใช้)', balance: deepseekInfo.totalBalance, paid: true };
            if (isInCooldown(dsCand)) continue;
            out.push(dsCand);
        }
    }
    return out.map((c) => ({ ...c, label: modelLabel(c.model) }));
}

// ── ① คัดงาน (v2): ความยาก 0–100 · ความเสี่ยง · แบ่งงานขนานได้ไหม ────────────────
const classifyCache = new Map(); // hash -> { at, result }
const CLASSIFIER_VERSION = 'v2';
const GREETING_RE = /^(สวัสดี|หวัดดี|hello|hi|hey|ขอบคุณ|thanks?|thank you|ok|โอเค|ครับ|ค่ะ|ดีมาก|เยี่ยม)/i;
const TIER_TAG_RE = /#(สูงมาก|สูง|กลาง|ต่ำ|xhigh|high|medium|low)(?![\p{L}\p{M}\p{N}_])/iu;
const MODE_TAG_RE = /#(ประหยัด|ถนอม|เต็มที่|ฟุ่มเฟือย|conserve|boost)(?![\p{L}\p{M}\p{N}_])/iu;
const TIER_FROM_TAG = { 'สูงมาก': 'xhigh', 'สูง': 'high', 'กลาง': 'medium', 'ต่ำ': 'low', xhigh: 'xhigh', high: 'high', medium: 'medium', low: 'low' };
const MODE_FROM_TAG = { 'ประหยัด': 'conserve', 'ถนอม': 'conserve', conserve: 'conserve', 'เต็มที่': 'boost', 'ฟุ่มเฟือย': 'boost', boost: 'boost' };

function buildClassifierPrompt(prompt) {
    return [
        'You are a task router. Do NOT use any tools. Analyse the task below and reply with ONLY one line of JSON:',
        '{"type":"code|analysis|chat|quick","complexity":0-100,"risk":0-100,"needs_tools":true|false,"parallelizable":true|false,"subtasks":0-6,"reason":"<short Thai reason>"}',
        'type: code=write/fix/refactor code or edit config files; analysis=plan, design, investigate, compare, research, debug a system;',
        'chat=general Q&A or explanation; quick=greeting, one-liner, simple status check (e.g. electricity usage today).',
        'complexity: 0-20 trivial, 21-45 simple, 46-70 moderate/multi-step, 71-90 hard multi-file or deep reasoning, 91-100 very hard/critical.',
        'risk: how much damage a mistake could do to a running production system (0 none, 100 could break core services or data).',
        'parallelizable: true only if the work splits into 2+ independent pieces (e.g. investigate several services, read many files, compare several options) that separate agents could do at the same time.',
        'subtasks: how many independent pieces (0 if not parallelizable).',
        'TASK:',
        '"""',
        String(prompt).slice(0, 4000),
        '"""'
    ].join('\n');
}

function clampInt(v, lo, hi, dflt) {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? dflt : Math.max(lo, Math.min(hi, n));
}

function levelFromComplexity(c) {
    return c < 35 ? 1 : (c < 70 ? 2 : 3);
}

function tierFromScores(type, complexity, risk, needsTools) {
    if (type === 'quick') return 'low';
    const s = complexity + risk * 0.25 + (type === 'code' && needsTools ? 5 : 0);
    if (s < 35) return 'low';
    if (s < 60) return 'medium';
    if (s < 82) return 'high';
    return 'xhigh';
}

function normalizeClassification(obj) {
    const type = TYPES.includes(obj.type) ? obj.type : null;
    if (!type) return null;
    // รองรับผลแบบเก่า (level 1–3) ด้วย
    const complexity = obj.complexity !== undefined
        ? clampInt(obj.complexity, 0, 100, 50)
        : ({ 1: 25, 2: 55, 3: 80 }[clampInt(obj.level, 1, 3, 2)]);
    const risk = clampInt(obj.risk, 0, 100, 20);
    const needsTools = Boolean(obj.needs_tools);
    const parallelizable = Boolean(obj.parallelizable) && type !== 'quick';
    return {
        type,
        complexity: type === 'quick' ? Math.min(complexity, 20) : complexity,
        risk,
        level: type === 'quick' ? 1 : levelFromComplexity(complexity),
        needs_tools: needsTools,
        parallelizable,
        subtasks: parallelizable ? clampInt(obj.subtasks, 2, 6, 2) : 0,
        tier: tierFromScores(type, complexity, risk, needsTools),
        reason: String(obj.reason || '').slice(0, 160)
    };
}

function parseClassification(text) {
    const m = String(text || '').match(/\{[^{}]*"type"[^{}]*\}/);
    if (!m) return null;
    try {
        return normalizeClassification(JSON.parse(m[0]));
    } catch (_) {
        return null;
    }
}

function runClassifierOnce(prompt, account) {
    return new Promise((resolve) => {
        try { fs.mkdirSync(CLASSIFY_CWD, { recursive: true }); } catch (_) {}
        const args = ['-p', buildClassifierPrompt(prompt), '--model', CLASSIFIER_MODEL, '--disable-slash-commands', '--print-timeout', '40s'];
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
            resolve({ result: parseClassification(stdout), crashed: false, errorText: '' });
        });
    });
}

async function runClassifier(prompt, account) {
    let attempt = await runClassifierOnce(prompt, account);
    if (attempt.crashed) {
        await healBinaryCache(AGY_BIN);
        attempt = await runClassifierOnce(prompt, account);
    }
    if (!attempt.result && attempt.errorText) {
        recordFailure({ engine: 'agy', account: account.id, model: CLASSIFIER_MODEL }, {
            crashed: attempt.crashed,
            errorText: attempt.errorText
        });
    }
    return attempt.result;
}

async function classifyTask(prompt) {
    const text = String(prompt || '').trim();
    if ((text.length <= 20 && !CODE_HINT_RE.test(text)) || (text.length <= 40 && GREETING_RE.test(text) && !CODE_HINT_RE.test(text))) {
        return { ...normalizeClassification({ type: 'quick', complexity: 5, risk: 0 }), reason: 'ข้อความสั้น/ทักทาย (ทางลัด ไม่เรียกตัวคัดงาน)', source: 'shortcut' };
    }
    const hash = crypto.createHash('sha1').update(CLASSIFIER_VERSION + text).digest('hex');
    const hit = classifyCache.get(hash);
    if (hit && Date.now() - hit.at < CLASSIFY_TTL_MS) return { ...hit.result, source: 'cache' };

    // ตัวคัดงานใช้บัญชี Google ที่ pool gemini เหลือมากสุดก่อน (กระจายโหลดด้วย)
    const accs = listAgyAccounts().filter((a) => a.ready);
    const ranked = [];
    for (const acc of accs) {
        if (isInCooldown({ engine: 'agy', account: acc.id, model: CLASSIFIER_MODEL })) continue;
        const pct = agyRemainingPct(await getAccountQuota(acc.id), CLASSIFIER_MODEL);
        if (pct === null || pct <= MIN_THRESHOLD) continue;
        ranked.push({ acc, pct });
    }
    ranked.sort((a, b) => b.pct - a.pct);
    let result = null;
    for (const { acc } of ranked) {
        result = await runClassifier(text, acc);
        if (result) break;
    }
    if (!result) {
        const fbType = CODE_HINT_RE.test(text) ? 'code' : 'chat';
        return { ...normalizeClassification({ type: fbType, complexity: 55, risk: 30, needs_tools: fbType === 'code' }), reason: 'ตัวคัดงานไม่ตอบ ใช้ค่าเริ่มต้น', source: 'fallback' };
    }
    classifyCache.set(hash, { at: Date.now(), result });
    if (classifyCache.size > 300) classifyCache.delete(classifyCache.keys().next().value);
    return { ...result, source: 'classifier' };
}

// ── ④ แผนแบ่ง Subagent (แนวทางที่ 1: ให้ agy / Claude Code แตกทีมเองภายในงานเดียว) ──
const SUBAGENT_MAX = { boost: 4, normal: 3, conserve: 2, unknown: 2 };

function planSubagents(cls, chosen) {
    if (!chosen || chosen.paid || !cls.parallelizable) return null;
    if (cls.type === 'quick' || cls.type === 'chat') return null;
    if (cls.complexity < 40 && (cls.subtasks || 0) < 3) return null;
    const mode = (chosen.budget && chosen.budget.mode) || 'normal';
    const count = Math.max(2, Math.min(SUBAGENT_MAX[mode] || 2, cls.subtasks || 2));
    let model = 'flash';
    if (mode === 'conserve') model = 'flash_lite';
    else if (mode === 'boost' && cls.complexity >= 80) model = 'pro';
    return { count, model, engine: chosen.engine, mode };
}

function buildSubagentDirective(plan) {
    if (!plan) return '';
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
            '- การแก้ไฟล์ให้ตัวหลักทำเอง หรือแบ่งคนละไฟล์ ห้ามแก้ไฟล์เดียวกันพร้อมกัน',
            '- รวมผลแล้วสรุปตอบผู้ใช้เป็นภาษาไทย ถ้างานแบ่งไม่ได้จริงให้ทำเองตามปกติ',
            '[จบคำสั่งสมองกลาง]'
        ].join('\n');
    }
    return '';
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
async function routeTask({ prompt, hasImages = false, source = 'chat', minLevel = 1, sessionAccount = null } = {}) {
    const startedAt = Date.now();
    const text = String(prompt || '');
    let cls = await classifyTask(text);

    // minLevel (cron alert) → ดันความยากขั้นต่ำ
    const minLv = Math.min(3, minLevel || 1);
    if (minLv > cls.level) {
        const complexity = Math.max(cls.complexity, { 2: 50, 3: 75 }[minLv]);
        const type = cls.type === 'quick' ? 'chat' : cls.type;
        cls = { ...cls, type, complexity, level: levelFromComplexity(complexity), tier: tierFromScores(type, complexity, cls.risk, cls.needs_tools) };
    }
    // แท็กกำหนดเองในข้อความ เช่น #สูงมาก #ประหยัด
    const tierTag = text.match(TIER_TAG_RE);
    const modeTag = text.match(MODE_TAG_RE);
    const overrides = {};
    if (tierTag) {
        overrides.tier = TIER_FROM_TAG[tierTag[1].toLowerCase()];
        cls = { ...cls, tier: overrides.tier, type: cls.type === 'quick' ? 'chat' : cls.type };
    }
    if (modeTag) overrides.mode = MODE_FROM_TAG[modeTag[1].toLowerCase()];

    const candidates = await buildCandidates(cls, { hasImages, sessionAccount, modeOverride: overrides.mode || null });
    const chosen = candidates[0] || null;
    const subagents = planSubagents(cls, chosen);
    notePick(chosen);
    const decision = {
        ok: candidates.length > 0,
        routeKey: `${cls.type}:${cls.tier}`,
        classification: cls,
        overrides,
        candidates,
        chosen,
        subagents,
        tookMs: Date.now() - startedAt
    };
    logDecision({ source, prompt, decision });
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
    const team = plan ? ` · 🤝 แตก subagent ≤${plan.count} ตัว${plan.engine === 'agy' ? ` (${plan.model})` : ''}` : '';
    const tags = [];
    if (decision.overrides && decision.overrides.tier) tags.push(`#${TIER_TH[decision.overrides.tier]}`);
    if (decision.overrides && decision.overrides.mode) tags.push(decision.overrides.mode === 'boost' ? '#เต็มที่' : '#ประหยัด');
    const why = cls.reason ? `: ${cls.reason}` : '';
    return `> ${prefix}**${c.label}** · ${c.accountLabel} (${formatBudget(c)}) — ${cls.type} · ยาก ${cls.complexity}/100 · ระดับ ${TIER_TH[cls.tier] || cls.tier}${team}${tags.length ? ' · ' + tags.join(' ') : ''}${why}\n\n`;
}

function isRetryableFailure(errorText, outputText, stderrText = '') {
    const out = String(outputText || '').trim();
    const err = String(errorText || '');
    const stderr = String(stderrText || '');
    if (out.length > 400) return false;
    return RETRYABLE_ERR_RE.test(err) || RETRYABLE_ERR_RE.test(out) || RETRYABLE_ERR_RE.test(stderr) || (!out && !!(err || stderr));
}

function logDecision({ source, prompt, decision, event = 'route', extra = {} }) {
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

module.exports = {
    AUTO_MODEL_ID,
    ROUTES,
    routeTask,
    classifyTask,
    buildCandidates,
    formatBanner,
    directiveFor,
    TIER_TH,
    isRetryableFailure,
    isBinaryCrash,
    healBinaryCache,
    failureGroup,
    AGY_BIN,
    logDecision,
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
