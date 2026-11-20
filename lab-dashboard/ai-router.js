'use strict';

/**
 * ai-router.js
 * -----------------------------------------------------------------------------
 * 🧠 AI Router (สมองกลาง) — เลือกโมเดล/บัญชีให้อัตโนมัติ
 * Design: docs/ai-router.md
 *
 *  1. classifyTask()    : Gemini 3.8 Flash Low อ่านงาน → {type, level, needs_tools, reason}
 *  2. ROUTES            : type:level → รายชื่อโมเดลเรียงจากเก่งไปหาด้อย
 *  3. buildCandidates() : ขยายเป็นทุกบัญชี + กรองตามโควตา (subscription ก่อน, DeepSeek สุดท้าย)
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

// ── ② ตารางเส้นทาง: เรียงจากเก่ง → ด้อย (DeepSeek ถูกย้ายไปท้ายสุดเสมอ) ─────────
const ROUTES = {
    'code:3': ['claude-opus-5-5-high', 'claude-code-opus', 'gemini-4-hydrogen-high', 'claude-sonnet-5-5-high', 'deepseek-v4-pro'],
    'code:2': ['claude-sonnet-5-5-high', 'gemini-4-hydrogen-medium', 'claude-code-sonnet', 'claude-opus-5-5-medium', 'deepseek-v4-pro'],
    'code:1': ['claude-sonnet-5-5-medium', 'gemini-3.8-flash-high', 'claude-code-sonnet', 'deepseek-flash'],
    'analysis:3': ['gemini-4-hydrogen-xhigh', 'claude-opus-5-5-high', 'claude-code-opus', 'gemini-4-argon-high', 'deepseek-v4-pro'],
    'analysis:2': ['gemini-4-hydrogen-high', 'claude-sonnet-5-5-high', 'claude-code-sonnet', 'deepseek-v4-pro'],
    'analysis:1': ['gemini-4-hydrogen-medium', 'gemini-3.8-flash-high', 'claude-code-haiku', 'deepseek-flash'],
    'chat:3': ['gemini-4-hydrogen-high', 'claude-sonnet-5-5-medium', 'claude-code-sonnet', 'deepseek-v4-pro'],
    'chat:2': ['gemini-3.8-flash-medium', 'gemini-4-hydrogen-low', 'claude-sonnet-5-5-low', 'claude-code-haiku', 'deepseek-flash'],
    'chat:1': ['gemini-3.8-flash-low', 'gemini-3.8-flash-medium', 'claude-code-haiku', 'deepseek-flash'],
    'quick:1': ['gemini-3.8-flash-low', 'gemini-3.8-flash-medium', 'claude-code-haiku', 'deepseek-flash']
};
const TYPES = ['code', 'analysis', 'chat', 'quick'];

const MODEL_LABELS = {
    'claude-opus-5-5-high': 'Claude Opus 5.5 (High)',
    'claude-opus-5-5-medium': 'Claude Opus 5.5 (Medium)',
    'claude-sonnet-5-5-high': 'Claude Sonnet 5.5 (High)',
    'claude-sonnet-5-5-medium': 'Claude Sonnet 5.5 (Medium)',
    'claude-sonnet-5-5-low': 'Claude Sonnet 5.5 (Low)',
    'gemini-4-hydrogen-xhigh': 'Gemini 4 Hydrogen (XHigh)',
    'gemini-4-hydrogen-high': 'Gemini 4 Hydrogen (High)',
    'gemini-4-hydrogen-medium': 'Gemini 4 Hydrogen (Medium)',
    'gemini-4-hydrogen-low': 'Gemini 4 Hydrogen (Low)',
    'gemini-4-argon-high': 'Gemini 4 Argon (High)',
    'gemini-3.8-flash-high': 'Gemini 3.8 Flash (High)',
    'gemini-3.8-flash-medium': 'Gemini 3.8 Flash (Medium)',
    'gemini-3.8-flash-low': 'Gemini 3.8 Flash (Low)',
    'claude-code-opus': 'Claude Code · Opus',
    'claude-code-sonnet': 'Claude Code · Sonnet',
    'claude-code-haiku': 'Claude Code · Haiku',
    'deepseek-v4-pro': 'DeepSeek V4 Pro',
    'deepseek-flash': 'DeepSeek V4.1 Flash'
};

const CODE_HINT_RE = /code|โค้ด|bug|บั๊ก|แก้|fix|script|สคริปต์|deploy|config|\.js|\.py|function|error|api|sql|docker|pm2|git/i;
// Go runtime crash before the CLI even starts — on this host that means a RAM bit flip in the
// page-cached binary (see homelab RAM notes). Evicting the file from page cache reloads it from disk.
const CRASH_RE = /unexpected fault address|fatal error: (fault|unexpected signal)|SIGSEGV|SIGBUS|SIGILL|segmentation (fault|violation)|illegal instruction/i;
const RETRYABLE_ERR_RE = /\b429\b|quota|resource[_ ]?exhausted|exhausted|rate.?limit|too many requests|overloaded|capacity|insufficient.?balance|credit|please sign in|unauthori[sz]ed|\b401\b|usage limit|limit reached|โควตา/i;

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

function getAgyAccount(id) {
    const all = listAgyAccounts();
    return all.find((a) => a.id === id) || all[0];
}

function agyTokenFile(account) {
    return path.join(account.home, TOKEN_REL);
}

function agyBrainDir(account) {
    return path.join(account.home, '.gemini/antigravity-cli/brain');
}

// ── ③ โควตา ───────────────────────────────────────────────────────────────────
let quotaProvider = null;   // injected: async ({ accountId }) => getQuotaSummary result
const quotaCache = new Map(); // accountId -> { at, data }

function setQuotaProvider(fn) {
    quotaProvider = fn;
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

function agyPoolId(model) {
    if (/argon/i.test(model)) return 'argon';
    if (/^(claude|gpt)/i.test(model)) return 'claude';
    return 'gemini';
}

/** % ที่เหลือของโมเดล agy ในบัญชีนี้; null = โมเดลนี้ไม่มีในบัญชี */
function agyRemainingPct(quota, model) {
    if (!quota || !quota.ok) return UNKNOWN_QUOTA_PCT;
    const poolId = agyPoolId(model);
    const pool = (quota.pools || []).find((p) => p.id === poolId);
    if (pool) return pool.remainingPct;
    if ((quota.unavailablePools || []).some((p) => p.id === poolId)) return null;
    return UNKNOWN_QUOTA_PCT;
}

function claudeProRemainingPct(cw) {
    if (!cw || !cw.ok) return UNKNOWN_QUOTA_PCT;
    const vals = [cw.fiveHour, cw.weekly].filter(Boolean).map((w) => w.remainingPct);
    return vals.length ? Math.min(...vals) : UNKNOWN_QUOTA_PCT;
}

function deepseekUsable(ds) {
    if (!ds || !ds.ok) return false;
    return Boolean(ds.isAvailable) && parseFloat(ds.totalBalance || '0') > DEEPSEEK_MIN_BALANCE;
}

/**
 * รายชื่อผู้สมัครเรียงตามลำดับที่ควรลอง:
 *   (เหลือ > 20%) → (เหลือ 5–20%) → DeepSeek (ถ้ามียอดเงิน)
 */
async function buildCandidates(routeKey, { hasImages = false } = {}) {
    const row = ROUTES[routeKey] || ROUTES['chat:2'];
    const accounts = listAgyAccounts().filter((a) => a.ready);
    const quotas = {};
    await Promise.all(accounts.map(async (a) => { quotas[a.id] = await getAccountQuota(a.id); }));
    const primaryQuota = quotas.g1 || (await getAccountQuota('g1'));

    const subs = [];
    const paid = [];
    for (const model of row) {
        const engine = engineOf(model);
        if (engine === 'agy') {
            for (const acc of accounts) {
                const pct = agyRemainingPct(quotas[acc.id], model);
                if (pct === null) continue;
                subs.push({ model, engine, account: acc.id, accountLabel: acc.label, home: acc.home, remainingPct: pct });
            }
        } else if (engine === 'claude-code') {
            subs.push({ model, engine, account: 'claude-pro', accountLabel: 'Claude Pro', remainingPct: claudeProRemainingPct(primaryQuota && primaryQuota.claudeWeb) });
        } else {
            paid.push(hasImages ? 'deepseek-flash' : model);
        }
    }

    const tier1 = subs.filter((c) => c.remainingPct > PRIMARY_THRESHOLD);
    const tier2 = subs.filter((c) => c.remainingPct > MIN_THRESHOLD && c.remainingPct <= PRIMARY_THRESHOLD);
    const out = [...tier1, ...tier2];

    if (deepseekUsable(primaryQuota && primaryQuota.deepseek)) {
        const ds = primaryQuota.deepseek;
        for (const model of [...new Set(paid.length ? paid : ['deepseek-flash'])]) {
            out.push({ model, engine: 'deepseek', account: 'deepseek', accountLabel: 'DeepSeek (จ่ายตามใช้)', balance: ds.totalBalance, paid: true });
        }
    }
    return out.map((c) => ({ ...c, label: modelLabel(c.model) }));
}

// ── ① คัดงาน ──────────────────────────────────────────────────────────────────
const classifyCache = new Map(); // hash -> { at, result }

function buildClassifierPrompt(prompt) {
    return [
        'You are a task router. Do NOT use any tools. Classify the task below and reply with ONLY one line of JSON:',
        '{"type":"code|analysis|chat|quick","level":1|2|3,"needs_tools":true|false,"reason":"<short Thai reason>"}',
        'type: code=write/fix/refactor code or edit config files; analysis=plan, design, investigate, compare, research, debug a system;',
        'chat=general Q&A or explanation; quick=greeting, one-liner, simple status check (e.g. electricity usage today).',
        'level: 1=trivial, 2=moderate, 3=hard/multi-step/multi-file.',
        'TASK:',
        '"""',
        String(prompt).slice(0, 4000),
        '"""'
    ].join('\n');
}

function parseClassification(text) {
    const m = String(text || '').match(/\{[^{}]*"type"[^{}]*\}/);
    if (!m) return null;
    try {
        const obj = JSON.parse(m[0]);
        const type = TYPES.includes(obj.type) ? obj.type : null;
        const level = Math.max(1, Math.min(3, parseInt(obj.level, 10) || 0));
        if (!type || !level) return null;
        return {
            type,
            level: type === 'quick' ? 1 : level,
            needs_tools: Boolean(obj.needs_tools),
            reason: String(obj.reason || '').slice(0, 160)
        };
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
                console.error(`[AiRouter] classifier failed on ${account.label}: ${String(stderr || err.message).slice(0, 200)}`);
                return resolve({ result: null, crashed: isBinaryCrash(stderr) });
            }
            resolve({ result: parseClassification(stdout), crashed: false });
        });
    });
}

async function runClassifier(prompt, account) {
    const first = await runClassifierOnce(prompt, account);
    if (!first.crashed) return first.result;
    await healBinaryCache(AGY_BIN);
    return (await runClassifierOnce(prompt, account)).result;
}

async function classifyTask(prompt) {
    const text = String(prompt || '').trim();
    if (text.length <= 40 && !CODE_HINT_RE.test(text)) {
        return { type: 'quick', level: 1, needs_tools: false, reason: 'ข้อความสั้น (ทางลัด ไม่เรียกตัวคัดงาน)', source: 'shortcut' };
    }
    const hash = crypto.createHash('sha1').update(text).digest('hex');
    const hit = classifyCache.get(hash);
    if (hit && Date.now() - hit.at < CLASSIFY_TTL_MS) return { ...hit.result, source: 'cache' };

    // ใช้บัญชี Google ตัวแรกที่ pool gemini ยังไม่หมด
    let result = null;
    for (const acc of listAgyAccounts().filter((a) => a.ready)) {
        const pct = agyRemainingPct(await getAccountQuota(acc.id), CLASSIFIER_MODEL);
        if (pct !== null && pct <= MIN_THRESHOLD) continue;
        result = await runClassifier(text, acc);
        if (result) break;
    }
    if (!result) {
        return { type: 'chat', level: 2, needs_tools: false, reason: 'ตัวคัดงานไม่ตอบ ใช้ค่าเริ่มต้น', source: 'fallback' };
    }
    classifyCache.set(hash, { at: Date.now(), result });
    if (classifyCache.size > 300) classifyCache.delete(classifyCache.keys().next().value);
    return { ...result, source: 'classifier' };
}

// ── รวมทุกขั้น ────────────────────────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {boolean} [opts.hasImages]
 * @param {string} [opts.source]  'chat' | 'cron' | ...
 * @param {number} [opts.minLevel] บังคับระดับความยากขั้นต่ำ (เช่น cron alert จริง)
 */
async function routeTask({ prompt, hasImages = false, source = 'chat', minLevel = 1 } = {}) {
    const startedAt = Date.now();
    const classification = await classifyTask(prompt);
    const level = Math.max(classification.level, Math.min(3, minLevel || 1));
    const type = classification.type === 'quick' && level > 1 ? 'chat' : classification.type;
    const routeKey = `${type}:${type === 'quick' ? 1 : level}`;
    const candidates = await buildCandidates(routeKey, { hasImages });
    const decision = {
        ok: candidates.length > 0,
        routeKey,
        classification: { ...classification, type, level },
        candidates,
        chosen: candidates[0] || null,
        tookMs: Date.now() - startedAt
    };
    logDecision({ source, prompt, decision });
    return decision;
}

function formatBanner(decision, chosen, note = '') {
    const c = chosen || decision.chosen;
    if (!c) return '';
    const cls = decision.classification || {};
    const quota = c.paid
        ? `มีค่าใช้จ่าย · ยอด $${c.balance}`
        : `เหลือ ${c.remainingPct}%`;
    const why = cls.reason ? `: ${cls.reason}` : '';
    const prefix = note ? `↪️ ${note} → ` : '🧠 Auto → ';
    return `> ${prefix}**${c.label}** · ${c.accountLabel} (${quota}) — ${cls.type} ระดับ ${cls.level}${why}\n\n`;
}

function isRetryableFailure(errorText, outputText) {
    const out = String(outputText || '').trim();
    const err = String(errorText || '');
    if (out.length > 400) return false;
    return RETRYABLE_ERR_RE.test(err) || RETRYABLE_ERR_RE.test(out) || (!out && !!err);
}

function logDecision({ source, prompt, decision, event = 'route', extra = {} }) {
    const entry = {
        ts: new Date().toISOString(),
        event,
        source,
        prompt: String(prompt || '').slice(0, 200),
        routeKey: decision && decision.routeKey,
        classification: decision && decision.classification,
        chosen: decision && decision.chosen ? { model: decision.chosen.model, account: decision.chosen.account, remainingPct: decision.chosen.remainingPct } : null,
        candidates: decision && Array.isArray(decision.candidates) ? decision.candidates.map((c) => `${c.model}@${c.account}`) : undefined,
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
    isRetryableFailure,
    isBinaryCrash,
    healBinaryCache,
    failureGroup,
    AGY_BIN,
    logDecision,
    readLog,
    listAgyAccounts,
    getAgyAccount,
    agyTokenFile,
    agyBrainDir,
    setQuotaProvider,
    modelLabel
};
