'use strict';

/**
 * model-researcher.js
 * -----------------------------------------------------------------------------
 * 🔎 External Multi-Source Model Researcher
 *
 * ค้นหาและเทียบข้อมูลโมเดล AI จากแหล่งข้อมูลภายนอกอิสระ (>= 3 โดเมน)
 * เพื่อประเมินความฉลาด (q), ต้นทุน (cost), และคะแนนความมั่นใจ (confidence) อย่างโปร่งใส
 *
 * - Zero external npm deps (ใช้ Node.js 24 native fetch, fs, path, url, child_process)
 * - ห้าม require('./ai-router') หรือ require('./model-registry') เพื่อกัน circular dependency
 * - ห้ามกุ URL เด็ดขาด: ทุกแหล่งอ้างอิงต้องมาจากผลลัพธ์จริงที่ดึงได้เท่านั้น
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const HOME_DIR = os.homedir();
const DEFAULT_CACHE_FILE = path.join(HOME_DIR, '.gemini', 'model-research-cache.json');
const DEFAULT_ENV_FILE = path.join(HOME_DIR, '.gemini', '.env');

const MIN_TRUSTED_SOURCES = 3;
const HYDROGEN_REF_OUTPUT_USD_PER_1M = 7.5;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 ชั่วโมง
const FETCH_TIMEOUT_MS = 12000;

const VARIANT_SUFFIX_RE = /-(low|medium|high|xhigh|max)$/;
const EFFORT_Q = { low: -6, medium: 0, high: 4, xhigh: 7, max: 9 };
const EFFORT_COST = { low: 0.6, medium: 1.0, high: 1.5, xhigh: 2.2, max: 2.7 };

const CATALOG_URLS = {
    openrouter: 'https://openrouter.ai/api/v1/models',
    litellm: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
    modelsdev: 'https://models.dev/api.json'
};

const OFFICIAL_OR_CATALOG_DOMAINS = new Set([
    'openrouter.ai',
    'github.com',
    'models.dev',
    'artificialanalysis.ai',
    'anthropic.com',
    'google.dev',
    'deepmind.google',
    'google.com',
    'openai.com',
    'deepseek.com',
    'huggingface.co',
    'lmsys.org',
    'lmarena.ai',
    'livebench.ai',
    'swebench.com',
    'together.ai',
    'fireworks.ai',
    'groq.com',
    'aws.amazon.com',
    'cloud.google.com',
    'azure.microsoft.com'
]);

const MULTI_PART_TLDS = new Set([
    'co.uk', 'org.uk', 'ac.uk', 'co.jp', 'co.th', 'in.th', 'ac.th', 'com.au', 'com.br', 'com.cn'
]);

// แคชในหน่วยความจำ (แคตตาล็อก + ผลค้นหารายตระกูล)
let memoryCatalogCache = { fetchedAt: 0, data: null };
const memoryFamilyCache = new Map(); // familyKey -> { fetchedAt, result }

// ── Utility helpers ────────────────────────────────────────────────────────────
function getCacheFilePath() {
    return process.env.MODEL_RESEARCH_CACHE_FILE || DEFAULT_CACHE_FILE;
}

function clamp(n, min, max) {
    const v = Number(n);
    if (!Number.isFinite(v)) return min;
    return Math.max(min, Math.min(max, v));
}

function clampQ(n, fallback = 75) {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.max(1, Math.min(100, Math.round(v)));
}

function roundCost(n, fallback = 1.0) {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) return fallback;
    return Number(v.toFixed(3));
}

/**
 * ตัด subdomain ทั่วไปออกเพื่อให้โดเมนหลักเดียวกันถูกนับเป็น 1 แหล่งอิสระอย่างซื่อสัตย์
 * เช่น docs.anthropic.com -> anthropic.com, raw.githubusercontent.com -> github.com
 */
function extractRootDomain(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    let host = '';
    try {
        const u = new URL(rawUrl.trim());
        host = (u.hostname || '').toLowerCase().replace(/^www\./, '');
    } catch (_) {
        // เผื่อส่งมาเป็น hostname เปล่า
        host = rawUrl.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
    }
    if (!host || !host.includes('.')) return host;
    if (host === 'raw.githubusercontent.com' || host.endsWith('.githubusercontent.com') || host === 'githubusercontent.com') {
        return 'github.com';
    }
    const parts = host.split('.').filter(Boolean);
    if (parts.length <= 2) return parts.join('.');
    const lastTwo = parts.slice(-2).join('.');
    if (MULTI_PART_TLDS.has(lastTwo) && parts.length >= 3) {
        return parts.slice(-3).join('.');
    }
    return lastTwo;
}

function isOfficialOrCatalogDomain(domain) {
    return OFFICIAL_OR_CATALOG_DOMAINS.has(String(domain || '').toLowerCase());
}

function splitModelEffort(modelId) {
    const id = String(modelId || '').trim();
    const m = id.match(VARIANT_SUFFIX_RE);
    if (!m) {
        return { baseId: id, effort: null };
    }
    return {
        baseId: id.slice(0, id.length - m[0].length),
        effort: m[1]
    };
}

function familyKeyOf(modelId) {
    return splitModelEffort(modelId).baseId.toLowerCase();
}

function readGeminiApiKey() {
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
        return process.env.GEMINI_API_KEY.trim();
    }
    try {
        if (!fs.existsSync(DEFAULT_ENV_FILE)) return null;
        const lines = fs.readFileSync(DEFAULT_ENV_FILE, 'utf8').split(/\r?\n/);
        for (const line of lines) {
            const m = line.match(/^\s*GEMINI_API_KEY\s*=\s*(.+?)\s*$/);
            if (m && m[1]) {
                return m[1].replace(/^["']|["']$/g, '').trim() || null;
            }
        }
    } catch (_) {}
    return null;
}

// ── File Cache ─────────────────────────────────────────────────────────────────
function loadDiskCache() {
    try {
        const file = getCacheFilePath();
        if (!fs.existsSync(file)) return { catalogs: null, families: {} };
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!parsed || typeof parsed !== 'object') return { catalogs: null, families: {} };
        return {
            catalogs: parsed.catalogs || null,
            families: (parsed.families && typeof parsed.families === 'object') ? parsed.families : {}
        };
    } catch (_) {
        return { catalogs: null, families: {} };
    }
}

function saveDiskCache(cacheObj) {
    try {
        const file = getCacheFilePath();
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
        fs.writeFileSync(tmp, JSON.stringify(cacheObj, null, 2) + '\n', 'utf8');
        fs.renameSync(tmp, file);
    } catch (_) {}
}

// ── Network helper ─────────────────────────────────────────────────────────────
async function fetchWithTimeout(url, opts = {}, fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('fetch is not available');
    }
    const controller = new AbortController();
    const timeoutMs = Number(opts.timeoutMs) || FETCH_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchImpl(url, {
            ...opts,
            signal: controller.signal,
            headers: {
                'User-Agent': 'HomelabModelResearcher/1.0 (+https://github.com/homelab)',
                'Accept': opts.accept || 'application/json, text/html;q=0.9, */*;q=0.8',
                ...(opts.headers || {})
            }
        });
        return res;
    } finally {
        clearTimeout(timer);
    }
}

// ── Structured Public Catalogs (OpenRouter, LiteLLM, Models.dev) ───────────────
async function fetchPublicCatalogs({ fetchImpl = globalThis.fetch, skipCache = false } = {}) {
    const now = Date.now();
    if (!skipCache && memoryCatalogCache.data && (now - memoryCatalogCache.fetchedAt) < CACHE_TTL_MS) {
        return memoryCatalogCache.data;
    }

    if (!skipCache) {
        const disk = loadDiskCache();
        if (disk.catalogs && disk.catalogs.fetchedAt && (now - disk.catalogs.fetchedAt) < CACHE_TTL_MS && disk.catalogs.data) {
            memoryCatalogCache = { fetchedAt: disk.catalogs.fetchedAt, data: disk.catalogs.data };
            return disk.catalogs.data;
        }
    }

    const result = {
        openrouter: [],
        litellm: {},
        modelsdev: [],
        errors: {}
    };

    const [orRes, llRes, mdRes] = await Promise.allSettled([
        fetchWithTimeout(CATALOG_URLS.openrouter, { timeoutMs: 12000 }, fetchImpl).then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))),
        fetchWithTimeout(CATALOG_URLS.litellm, { timeoutMs: 12000 }, fetchImpl).then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))),
        fetchWithTimeout(CATALOG_URLS.modelsdev, { timeoutMs: 12000 }, fetchImpl).then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    ]);

    // 1. OpenRouter
    if (orRes.status === 'fulfilled' && orRes.value && Array.isArray(orRes.value.data)) {
        result.openrouter = orRes.value.data.map((m) => {
            const promptPerTok = Number(m.pricing && m.pricing.prompt);
            const compPerTok = Number(m.pricing && m.pricing.completion);
            return {
                id: String(m.id || ''),
                name: String(m.name || m.id || ''),
                contextLength: Number(m.context_length) || null,
                inputUsdPer1M: Number.isFinite(promptPerTok) && promptPerTok >= 0 ? Number((promptPerTok * 1e6).toFixed(4)) : null,
                outputUsdPer1M: Number.isFinite(compPerTok) && compPerTok >= 0 ? Number((compPerTok * 1e6).toFixed(4)) : null,
                description: String(m.description || '').slice(0, 260)
            };
        });
    } else if (orRes.status === 'rejected') {
        result.errors.openrouter = String(orRes.reason && orRes.reason.message || orRes.reason);
    }

    // 2. LiteLLM
    if (llRes.status === 'fulfilled' && llRes.value && typeof llRes.value === 'object') {
        const entries = {};
        for (const [k, v] of Object.entries(llRes.value)) {
            if (!v || typeof v !== 'object' || k === 'sample_spec') continue;
            const inTok = Number(v.input_cost_per_token);
            const outTok = Number(v.output_cost_per_token);
            entries[k] = {
                id: k,
                provider: String(v.litellm_provider || ''),
                mode: String(v.mode || ''),
                contextLength: Number(v.max_input_tokens || v.max_tokens) || null,
                inputUsdPer1M: Number.isFinite(inTok) && inTok >= 0 ? Number((inTok * 1e6).toFixed(4)) : null,
                outputUsdPer1M: Number.isFinite(outTok) && outTok >= 0 ? Number((outTok * 1e6).toFixed(4)) : null
            };
        }
        result.litellm = entries;
    } else if (llRes.status === 'rejected') {
        result.errors.litellm = String(llRes.reason && llRes.reason.message || llRes.reason);
    }

    // 3. Models.dev
    if (mdRes.status === 'fulfilled' && mdRes.value && typeof mdRes.value === 'object') {
        const flat = [];
        for (const [provId, provObj] of Object.entries(mdRes.value)) {
            if (!provObj || typeof provObj !== 'object' || !provObj.models || typeof provObj.models !== 'object') continue;
            for (const [mKey, mObj] of Object.entries(provObj.models)) {
                if (!mObj || typeof mObj !== 'object') continue;
                const costObj = mObj.cost || {};
                const limitObj = mObj.limit || {};
                const inUsd = Number(costObj.input);
                const outUsd = Number(costObj.output);
                flat.push({
                    id: String(mObj.id || mKey),
                    provider: String(provId),
                    name: String(mObj.name || mObj.id || mKey),
                    contextLength: Number(limitObj.context) || null,
                    inputUsdPer1M: Number.isFinite(inUsd) && inUsd >= 0 ? Number(inUsd.toFixed(4)) : null,
                    outputUsdPer1M: Number.isFinite(outUsd) && outUsd >= 0 ? Number(outUsd.toFixed(4)) : null,
                    reasoning: Boolean(mObj.reasoning),
                    toolCall: Boolean(mObj.tool_call)
                });
            }
        }
        result.modelsdev = flat;
    } else if (mdRes.status === 'rejected') {
        result.errors.modelsdev = String(mdRes.reason && mdRes.reason.message || mdRes.reason);
    }

    memoryCatalogCache = { fetchedAt: now, data: result };
    const disk = loadDiskCache();
    disk.catalogs = { fetchedAt: now, data: result };
    saveDiskCache(disk);
    return result;
}

// ── Strict Model Descriptor & Matching (ไม่จับมั่วข้ามเวอร์ชัน) ─────────────────
function parseModelDescriptor(modelId, modelName = '') {
    const { baseId, effort } = splitModelEffort(modelId);
    const rawLower = baseId.toLowerCase();
    const nameLower = String(modelName || '').toLowerCase();
    const combined = `${rawLower} ${nameLower}`;

    let provider = 'unknown';
    if (rawLower.startsWith('claude') || combined.includes('claude')) provider = 'anthropic';
    else if (rawLower.startsWith('gemini') || combined.includes('gemini')) provider = 'google';
    else if (rawLower.startsWith('deepseek') || combined.includes('deepseek')) provider = 'deepseek';
    else if (rawLower.startsWith('gpt') || combined.includes('gpt')) provider = 'openai';

    // ดึงเลขเวอร์ชันที่แท้จริง (เช่น 5.5, 4, 3.8, 4.1) — ไม่รวมขนาดพารามิเตอร์อย่าง 120b
    let version = null;
    const claudeVer = rawLower.match(/claude-(?:opus|sonnet|haiku)-(\d+)[-.](\d+)/);
    if (claudeVer) {
        version = `${claudeVer[1]}.${claudeVer[2]}`;
    } else {
        const gemVer = rawLower.match(/gemini-(\d+(?:\.\d+)?)/);
        if (gemVer) {
            version = gemVer[1];
        } else {
            const dsVer = combined.match(/deepseek[- ]v(\d+(?:\.\d+)?)/);
            if (dsVer) version = dsVer[1];
        }
    }

    // ขนาดพารามิเตอร์ เช่น 120b
    const sizeMatch = rawLower.match(/\b(\d+b)\b/);
    const sizeToken = sizeMatch ? sizeMatch[1] : null;

    // โค้ดเนม / ระดับรุ่นเฉพาะตัว
    const CODENAMES = ['neon', 'hydrogen', 'argon', 'carbon', 'opus', 'sonnet', 'haiku', 'flash', 'pro', 'oss', 'orchestrator'];
    const codenames = [];
    for (const c of CODENAMES) {
        const re = new RegExp(`(?:^|[^a-z0-9])${c}(?:$|[^a-z0-9])`, 'i');
        if (re.test(rawLower) || (c === 'carbon' && re.test(nameLower)) || (c === 'neon' && re.test(nameLower))) {
            codenames.push(c);
        }
    }

    // สร้างคำค้นหาที่แม่นยำสำหรับเว็บเสิร์ช
    const prettyName = String(modelName || baseId)
        .replace(/\s*\((low|medium|high|xhigh|max)\)\s*$/i, '')
        .replace(/·/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return {
        id: modelId,
        baseId,
        effort,
        provider,
        version,
        sizeToken,
        codenames,
        prettyName,
        isCliAlias: rawLower.startsWith('claude-code-')
    };
}

function normalizeForMatch(str) {
    return String(str || '')
        .toLowerCase()
        .replace(/[_/:]+/g, '-')
        .replace(/\s+/g, '-');
}

function candidateMatchesDescriptor(candidateId, candidateName, desc) {
    const cand = `${normalizeForMatch(candidateId)} ${normalizeForMatch(candidateName)}`;
    const candRaw = `${String(candidateId || '').toLowerCase()} ${String(candidateName || '').toLowerCase()}`;

    // 1. Provider ต้องตรง
    if (desc.provider === 'anthropic' && !cand.includes('claude')) return false;
    if (desc.provider === 'google' && !cand.includes('gemini')) return false;
    if (desc.provider === 'deepseek' && !cand.includes('deepseek')) return false;
    if (desc.provider === 'openai' && !cand.includes('gpt')) return false;

    // 2. ขนาดพารามิเตอร์ (เช่น 120b) ต้องตรง
    if (desc.sizeToken && !new RegExp(`(?:^|[^a-z0-9])${desc.sizeToken}(?:$|[^a-z0-9])`).test(cand)) {
        return false;
    }

    // 3. โค้ดเนมหลักต้องตรงทุกตัว (ยกเว้น 'pro' เมื่อเป็น orchestrator ที่บางแหล่งเรียกสั้นลง)
    for (const code of desc.codenames) {
        if (code === 'pro' && desc.codenames.includes('orchestrator')) continue;
        const re = new RegExp(`(?:^|[^a-z0-9])${code}(?:$|[^a-z0-9])`);
        if (!re.test(cand)) return false;
    }

    // 4. เวอร์ชันต้องตรงเป๊ะ ห้ามจับข้ามเวอร์ชัน!
    if (desc.version) {
        const verDot = desc.version.replace(/-/g, '.');
        const verDash = verDot.replace(/\./g, '-');
        const verCompact = verDot.replace(/\./g, '');
        const hasExactVer = new RegExp(`(?:^|[^0-9.])(?:v)?(?:${escapeRegex(verDot)}|${escapeRegex(verDash)})(?:$|[^0-9.])`).test(candRaw)
            || (verDot.includes('.') && new RegExp(`(?:claude|gemini|deepseek)[ -]?${escapeRegex(verCompact)}(?:$|[^0-9])`).test(candRaw));
        if (!hasExactVer) return false;
    } else if (desc.isCliAlias) {
        // claude-code-opus / sonnet / haiku: ยอมรับเฉพาะรุ่นล่าสุดที่มีอยู่จริงในแคตตาล็อก (ไม่รับรุ่นเก่ามากๆ อย่าง 2.x/3.0)
        if (/\b(?:claude-?(?:2|3-0|3\.0|instant))\b/i.test(candRaw)) return false;
        // กันไม่ให้จับรุ่นที่ระบุ dated snapshot ซ้ำซ้อนเมื่อมีรุ่น canonical แต่ยังยอมรับถ้าตรง codename
    }

    // 5. กัน false positive เช่น deepseek-flash ไปจับ gemini-flash (ผ่านข้อ 1 แล้ว)
    // หรือ claude-opus-5-5 ไปจับรุ่นที่ไม่มี 5.5 (ผ่านข้อ 4 แล้ว)
    return true;
}

function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchFromCatalogs(desc, catalogs) {
    const sources = [];
    if (!catalogs) return sources;

    // 1. OpenRouter
    if (Array.isArray(catalogs.openrouter)) {
        const hits = catalogs.openrouter.filter((m) => candidateMatchesDescriptor(m.id, m.name, desc));
        if (hits.length > 0) {
            // เลือกรุ่นที่ชื่อตรงที่สุดและมีราคาครบ
            hits.sort((a, b) => {
                const aP = a.outputUsdPer1M != null ? 1 : 0;
                const bP = b.outputUsdPer1M != null ? 1 : 0;
                if (bP !== aP) return bP - aP;
                return a.id.length - b.id.length;
            });
            const best = hits[0];
            sources.push({
                provider: 'openrouter',
                domain: 'openrouter.ai',
                quality: 'catalog',
                title: `OpenRouter: ${best.name} (${best.id})`,
                url: `https://openrouter.ai/${best.id}`,
                snippet: best.description || `Context ${best.contextLength || '-'}, In $${best.inputUsdPer1M ?? '-'}/1M, Out $${best.outputUsdPer1M ?? '-'}/1M`,
                inputUsdPer1M: best.inputUsdPer1M,
                outputUsdPer1M: best.outputUsdPer1M,
                contextLength: best.contextLength,
                matchedId: best.id
            });
        }
    }

    // 2. LiteLLM (GitHub)
    if (catalogs.litellm && typeof catalogs.litellm === 'object') {
        const hits = Object.values(catalogs.litellm).filter((m) => candidateMatchesDescriptor(m.id, m.id, desc));
        if (hits.length > 0) {
            const canonicalProvRank = (m) => {
                const id = String(m.id || '').toLowerCase();
                if (!id.includes('/')) return 3;
                if (/^(gemini|google|anthropic|openai|deepseek)\//.test(id)) return 2;
                if (/^(vertex_ai|bedrock|azure|openrouter)\//.test(id)) return 1;
                return 0; // reseller / third-party wrapper เช่น kyma/
            };
            hits.sort((a, b) => {
                const aP = a.outputUsdPer1M != null ? 1 : 0;
                const bP = b.outputUsdPer1M != null ? 1 : 0;
                if (bP !== aP) return bP - aP;
                const aC = canonicalProvRank(a);
                const bC = canonicalProvRank(b);
                if (bC !== aC) return bC - aC;
                return a.id.length - b.id.length;
            });
            const best = hits[0];
            sources.push({
                provider: 'litellm',
                domain: 'github.com',
                quality: 'catalog',
                title: `LiteLLM Model Registry: ${best.id}`,
                url: 'https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json',
                snippet: `Provider: ${best.provider || '-'}, Context: ${best.contextLength || '-'}, In $${best.inputUsdPer1M ?? '-'}/1M, Out $${best.outputUsdPer1M ?? '-'}/1M`,
                inputUsdPer1M: best.inputUsdPer1M,
                outputUsdPer1M: best.outputUsdPer1M,
                contextLength: best.contextLength,
                matchedId: best.id
            });
        }
    }

    // 3. Models.dev
    if (Array.isArray(catalogs.modelsdev)) {
        const hits = catalogs.modelsdev.filter((m) => candidateMatchesDescriptor(m.id, m.name, desc));
        if (hits.length > 0) {
            hits.sort((a, b) => {
                const aP = a.outputUsdPer1M != null ? 1 : 0;
                const bP = b.outputUsdPer1M != null ? 1 : 0;
                if (bP !== aP) return bP - aP;
                // ให้ความสำคัญกับ official provider บน models.dev
                const aOwn = a.provider === desc.provider ? 1 : 0;
                const bOwn = b.provider === desc.provider ? 1 : 0;
                if (bOwn !== aOwn) return bOwn - aOwn;
                return a.id.length - b.id.length;
            });
            const best = hits[0];
            sources.push({
                provider: 'modelsdev',
                domain: 'models.dev',
                quality: 'catalog',
                title: `Models.dev: ${best.name} (${best.provider}/${best.id})`,
                url: 'https://models.dev/',
                snippet: `Provider: ${best.provider}, Context: ${best.contextLength || '-'}, In $${best.inputUsdPer1M ?? '-'}/1M, Out $${best.outputUsdPer1M ?? '-'}/1M`,
                inputUsdPer1M: best.inputUsdPer1M,
                outputUsdPer1M: best.outputUsdPer1M,
                contextLength: best.contextLength,
                matchedId: `${best.provider}/${best.id}`
            });
        }
    }

    return sources;
}

// ── Live Web Search Sources ────────────────────────────────────────────────────
function textMatchesDescriptorStrictly(text, desc) {
    const t = String(text || '').toLowerCase();
    if (!t) return false;

    // Provider keyword
    if (desc.provider === 'anthropic' && !t.includes('claude')) return false;
    if (desc.provider === 'google' && !t.includes('gemini')) return false;
    if (desc.provider === 'deepseek' && !t.includes('deepseek')) return false;
    if (desc.provider === 'openai' && !t.includes('gpt')) return false;

    // Size token (e.g. 120b)
    if (desc.sizeToken && !new RegExp(`\\b${escapeRegex(desc.sizeToken)}\\b`, 'i').test(t)) return false;

    // Codenames must appear
    for (const code of desc.codenames) {
        if (code === 'pro' && desc.codenames.includes('orchestrator')) continue;
        if (!new RegExp(`\\b${escapeRegex(code)}\\b`, 'i').test(t)) return false;
    }

    // Version must appear if specified
    if (desc.version) {
        const vDot = desc.version;
        const vDash = vDot.replace(/\./g, '-');
        const re = new RegExp(`(?:^|[^0-9.])v?(?:${escapeRegex(vDot)}|${escapeRegex(vDash)})(?:$|[^0-9.])`, 'i');
        if (!re.test(t)) return false;
    }

    return true;
}

function extractPricingFromText(text) {
    const s = String(text || '');
    // จับรูปแบบเช่น "$15 / 1M output", "$0.60 per million output tokens", "input $3, output $15"
    let inputUsdPer1M = null;
    let outputUsdPer1M = null;

    const outMatch = s.match(/(?:output|completion)[^$.\n]{0,24}\$(\d+(?:\.\d+)?)/i)
        || s.match(/\$(\d+(?:\.\d+)?)\s*(?:per\s*(?:1m|million)|\/\s*1?m)\s*(?:output|completion)/i);
    if (outMatch) {
        const val = Number(outMatch[1]);
        if (Number.isFinite(val) && val > 0 && val <= 500) outputUsdPer1M = val;
    }

    const inMatch = s.match(/(?:input|prompt)[^$.\n]{0,24}\$(\d+(?:\.\d+)?)/i)
        || s.match(/\$(\d+(?:\.\d+)?)\s*(?:per\s*(?:1m|million)|\/\s*1?m)\s*(?:input|prompt)/i);
    if (inMatch) {
        const val = Number(inMatch[1]);
        if (Number.isFinite(val) && val > 0 && val <= 500) inputUsdPer1M = val;
    }

    return { inputUsdPer1M, outputUsdPer1M };
}

function decodeHtmlEntities(str) {
    return String(str || '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractDuckDuckGoUrl(rawHref) {
    if (!rawHref) return null;
    let href = rawHref.replace(/&amp;/g, '&');
    if (href.startsWith('//')) href = `https:${href}`;
    try {
        const u = new URL(href, 'https://html.duckduckgo.com');
        const uddg = u.searchParams.get('uddg');
        if (uddg && /^https?:\/\//i.test(uddg)) return uddg;
        if (/^https?:\/\//i.test(u.href) && !u.hostname.includes('duckduckgo.com')) return u.href;
    } catch (_) {}
    return null;
}

async function searchDuckDuckGo(desc, { fetchImpl = globalThis.fetch } = {}) {
    const query = `"${desc.prettyName}" AI model benchmark pricing`;
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    try {
        const res = await fetchWithTimeout(url, {
            timeoutMs: 10000,
            accept: 'text/html,application/xhtml+xml'
        }, fetchImpl);
        if (!res.ok) return [];
        const html = await res.text();
        if (!html || /anomaly-modal|bot-detect|captcha/i.test(html)) return [];

        const results = [];
        const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        const snippetRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;

        const snippets = [];
        let sm;
        while ((sm = snippetRe.exec(html)) !== null) {
            snippets.push(decodeHtmlEntities(sm[1] || sm[2] || ''));
        }

        let lm;
        let idx = 0;
        while ((lm = linkRe.exec(html)) !== null && results.length < 8) {
            const targetUrl = extractDuckDuckGoUrl(lm[1]);
            const title = decodeHtmlEntities(lm[2]);
            const snippet = snippets[idx] || '';
            idx += 1;
            if (!targetUrl) continue;
            const domain = extractRootDomain(targetUrl);
            if (!domain || domain === 'duckduckgo.com') continue;

            const combinedText = `${title} ${snippet} ${targetUrl}`;
            if (!textMatchesDescriptorStrictly(combinedText, desc)) continue;

            const pricing = extractPricingFromText(`${title} ${snippet}`);
            results.push({
                provider: 'duckduckgo',
                domain,
                quality: isOfficialOrCatalogDomain(domain) ? 'official' : 'community',
                title: title.slice(0, 140),
                url: targetUrl,
                snippet: snippet.slice(0, 260),
                inputUsdPer1M: pricing.inputUsdPer1M,
                outputUsdPer1M: pricing.outputUsdPer1M
            });
        }
        return results;
    } catch (_) {
        return [];
    }
}

async function searchHackerNews(desc, { fetchImpl = globalThis.fetch } = {}) {
    const query = desc.prettyName;
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=8`;
    try {
        const res = await fetchWithTimeout(url, { timeoutMs: 8000 }, fetchImpl);
        if (!res.ok) return [];
        const data = await res.json();
        const hits = Array.isArray(data && data.hits) ? data.hits : [];
        const out = [];
        for (const h of hits) {
            const title = String(h.title || h.story_title || '').trim();
            const storyText = String(h.story_text || '').replace(/<[^>]+>/g, ' ').trim();
            const targetUrl = (h.url && /^https?:\/\//i.test(h.url))
                ? h.url
                : (h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : null);
            if (!targetUrl || !title) continue;
            if (!textMatchesDescriptorStrictly(`${title} ${storyText}`, desc)) continue;

            const domain = extractRootDomain(targetUrl);
            const pricing = extractPricingFromText(`${title} ${storyText}`);
            out.push({
                provider: 'hackernews',
                domain,
                quality: isOfficialOrCatalogDomain(domain) ? 'official' : 'community',
                title: title.slice(0, 140),
                url: targetUrl,
                snippet: (storyText || `Hacker News discussion (${h.points || 0} points, ${h.num_comments || 0} comments)`).slice(0, 240),
                inputUsdPer1M: pricing.inputUsdPer1M,
                outputUsdPer1M: pricing.outputUsdPer1M
            });
        }
        return out;
    } catch (_) {
        return [];
    }
}

async function searchHuggingFace(desc, { fetchImpl = globalThis.fetch } = {}) {
    const query = desc.baseId.replace(/^claude-code-/, 'claude-');
    const url = `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&limit=8&sort=downloads&direction=-1`;
    try {
        const res = await fetchWithTimeout(url, { timeoutMs: 8000 }, fetchImpl);
        if (!res.ok) return [];
        const arr = await res.json();
        if (!Array.isArray(arr)) return [];

        const matched = arr.filter((m) => m && m.id && candidateMatchesDescriptor(m.id, m.id, desc));
        if (matched.length === 0) return [];
        const best = matched[0];
        return [{
            provider: 'huggingface',
            domain: 'huggingface.co',
            quality: 'catalog',
            title: `Hugging Face: ${best.id}`,
            url: `https://huggingface.co/${best.id}`,
            snippet: `Open weights model · downloads: ${best.downloads || 0} · likes: ${best.likes || 0} · task: ${best.pipeline_tag || 'text-generation'}`,
            inputUsdPer1M: null,
            outputUsdPer1M: null,
            matchedId: best.id
        }];
    } catch (_) {
        return [];
    }
}

async function searchGeminiGrounding(desc, { fetchImpl = globalThis.fetch, apiKey = null } = {}) {
    const key = apiKey || readGeminiApiKey();
    if (!key) return [];
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
    const prompt = `Search for official specifications, benchmark capabilities, and API pricing (USD per 1M input/output tokens) for the AI model "${desc.prettyName}" (ID: ${desc.baseId}). Report only factual public information.`;
    try {
        const res = await fetchWithTimeout(endpoint, {
            method: 'POST',
            timeoutMs: 15000,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                tools: [{ google_search: {} }]
            })
        }, fetchImpl);
        if (!res.ok) return [];
        const data = await res.json();
        const cand = data && Array.isArray(data.candidates) && data.candidates[0];
        if (!cand) return [];

        const text = (cand.content && Array.isArray(cand.content.parts))
            ? cand.content.parts.map((p) => p.text || '').join(' ')
            : '';
        const chunks = (cand.groundingMetadata && Array.isArray(cand.groundingMetadata.groundingChunks))
            ? cand.groundingMetadata.groundingChunks
            : [];
        const pricing = extractPricingFromText(text);

        const out = [];
        for (const ch of chunks) {
            const web = ch && ch.web;
            if (!web || !web.uri || !/^https?:\/\//i.test(web.uri)) continue;
            const domain = extractRootDomain(web.uri);
            if (!domain) continue;
            out.push({
                provider: 'gemini-grounding',
                domain,
                quality: isOfficialOrCatalogDomain(domain) ? 'official' : 'community',
                title: String(web.title || domain).slice(0, 140),
                url: web.uri,
                snippet: text.slice(0, 240),
                inputUsdPer1M: pricing.inputUsdPer1M,
                outputUsdPer1M: pricing.outputUsdPer1M
            });
        }
        return out;
    } catch (_) {
        return [];
    }
}

// ── Deduplication, Agreement & Confidence Calculation ──────────────────────────
function deduplicateSourcesByDomain(sources) {
    const byDomain = new Map();
    const rankQuality = (s) => {
        let score = 0;
        if (s.quality === 'catalog') score += 4;
        else if (s.quality === 'official') score += 3;
        else score += 1;
        if (s.outputUsdPer1M != null) score += 3;
        if (s.inputUsdPer1M != null) score += 1;
        if (s.contextLength) score += 1;
        return score;
    };

    for (const s of (sources || [])) {
        if (!s || !s.url) continue;
        const domain = s.domain || extractRootDomain(s.url);
        if (!domain) continue;
        const normalized = { ...s, domain };
        const existing = byDomain.get(domain);
        if (!existing || rankQuality(normalized) > rankQuality(existing)) {
            byDomain.set(domain, normalized);
        }
    }
    return [...byDomain.values()];
}

function detectTierHint(text) {
    const t = String(text || '').toLowerCase();
    if (/\b(flagship|frontier|opus|orchestrator|most capable|highest intelligence)\b/.test(t)) return 'flagship';
    if (/\b(budget|mini|haiku|flash|lightweight|fast and cheap|small model|economy)\b/.test(t)) return 'economy';
    if (/\b(balanced|workhorse|sonnet|mid-tier|medium)\b/.test(t)) return 'balanced';
    return null;
}

function analyzeAgreement(uniqueSources) {
    const list = Array.isArray(uniqueSources) ? uniqueSources : [];
    const n = list.length;
    if (n === 0) {
        return { agreement: 'low', priceRatio: null, medianOutputUsd: null, medianInputUsd: null, conflictReason: null };
    }

    const outPrices = list
        .map((s) => Number(s.outputUsdPer1M))
        .filter((v) => Number.isFinite(v) && v > 0)
        .sort((a, b) => a - b);

    const inPrices = list
        .map((s) => Number(s.inputUsdPer1M))
        .filter((v) => Number.isFinite(v) && v > 0)
        .sort((a, b) => a - b);

    const median = (arr) => {
        if (arr.length === 0) return null;
        const mid = Math.floor(arr.length / 2);
        return arr.length % 2 === 1 ? arr[mid] : Number(((arr[mid - 1] + arr[mid]) / 2).toFixed(4));
    };

    const medianOutputUsd = median(outPrices);
    const medianInputUsd = median(inPrices);

    let priceRatio = null;
    if (outPrices.length >= 2) {
        priceRatio = Number((outPrices[outPrices.length - 1] / outPrices[0]).toFixed(2));
        if (priceRatio > 2.0) {
            return {
                agreement: 'conflict',
                priceRatio,
                medianOutputUsd,
                medianInputUsd,
                conflictReason: `ราคา output จากแหล่งอิสระต่างกัน ${priceRatio}x ($${outPrices[0]} vs $${outPrices[outPrices.length - 1]}/1M)`
            };
        }
    }

    // ตรวจความขัดแย้งของระดับรุ่น (flagship vs economy)
    const tiers = new Set(list.map((s) => detectTierHint(`${s.title || ''} ${s.snippet || ''}`)).filter(Boolean));
    if (tiers.has('flagship') && tiers.has('economy')) {
        return {
            agreement: 'conflict',
            priceRatio,
            medianOutputUsd,
            medianInputUsd,
            conflictReason: 'แหล่งข้อมูลระบุระดับรุ่นขัดแย้งกัน (flagship vs economy)'
        };
    }

    if (n >= MIN_TRUSTED_SOURCES) {
        if (priceRatio === null || priceRatio <= 1.35) {
            return { agreement: 'high', priceRatio, medianOutputUsd, medianInputUsd, conflictReason: null };
        }
        return { agreement: 'medium', priceRatio, medianOutputUsd, medianInputUsd, conflictReason: null };
    }

    if (n === 2) {
        return { agreement: 'medium', priceRatio, medianOutputUsd, medianInputUsd, conflictReason: null };
    }

    return { agreement: 'low', priceRatio, medianOutputUsd, medianInputUsd, conflictReason: null };
}

/**
 * สูตรคำนวณความมั่นใจแบบโปร่งใส (Transparent Confidence Score)
 */
function computeConfidenceScore({ uniqueSources = [], agreement = 'low', hasIntelligence = false, hasPricing = false } = {}) {
    const list = Array.isArray(uniqueSources) ? uniqueSources : [];
    const uniqueDomainCount = list.length;

    let base = 25;
    if (uniqueDomainCount === 1) base = 42;
    else if (uniqueDomainCount === 2) base = 58;
    else if (uniqueDomainCount === 3) base = 76;
    else if (uniqueDomainCount === 4) base = 84;
    else if (uniqueDomainCount >= 5) base = 90;

    let qualityRaw = 0;
    for (const s of list) {
        if (s.quality === 'catalog' || s.quality === 'official' || isOfficialOrCatalogDomain(s.domain)) {
            qualityRaw += 2.5;
        } else {
            qualityRaw += 1;
        }
    }
    const qualityBonus = Math.min(8, Math.round(qualityRaw));

    let agreementDelta = -4;
    if (agreement === 'high') agreementDelta = 8;
    else if (agreement === 'medium') agreementDelta = 2;
    else if (agreement === 'conflict') agreementDelta = -20;

    let completenessDelta = -8;
    if (hasIntelligence && hasPricing) completenessDelta = 4;
    else if (hasIntelligence || hasPricing) completenessDelta = -4;

    const raw = base + qualityBonus + agreementDelta + completenessDelta;
    const score = clamp(Math.round(raw), 10, 98);
    const meetsMinSources = uniqueDomainCount >= MIN_TRUSTED_SOURCES;

    let verdict = 'ไม่พบข้อมูลสาธารณะภายนอก (รุ่นใหม่/โค้ดเนมภายใน)';
    if (agreement === 'conflict') {
        verdict = 'ข้อมูลจากแหล่งภายนอกขัดแย้งกัน — ควรตรวจสอบด้วยตนเอง';
    } else if (meetsMinSources && score >= 80) {
        verdict = `น่าเชื่อถือสูง (${uniqueDomainCount} แหล่งอิสระสอดคล้องกัน)`;
    } else if (meetsMinSources) {
        verdict = `ผ่านเกณฑ์ขั้นต่ำ (${uniqueDomainCount} แหล่งอิสระ)`;
    } else if (uniqueDomainCount > 0) {
        verdict = `พบ ${uniqueDomainCount} แหล่งอิสระ (ยังไม่ถึงเกณฑ์ ≥${MIN_TRUSTED_SOURCES} แหล่ง)`;
    }

    return {
        score,
        meetsMinSources,
        uniqueDomainCount,
        agreement,
        verdict,
        breakdown: {
            base,
            qualityBonus,
            agreementDelta,
            completenessDelta,
            raw
        }
    };
}

// ── Estimate Suggested q & cost from External Evidence + Baseline ──────────────
function estimateMetricsFromEvidence(desc, uniqueSources, agreementInfo, baselineModel = null) {
    const baseQ = (baselineModel && baselineModel.suggested && baselineModel.suggested.q)
        ? {
            code: clampQ(baselineModel.suggested.q.code, 80),
            analysis: clampQ(baselineModel.suggested.q.analysis, 80),
            chat: clampQ(baselineModel.suggested.q.chat, 80)
        }
        : inferFallbackQ(desc);

    const baseCost = (baselineModel && baselineModel.suggested && Number.isFinite(Number(baselineModel.suggested.cost)))
        ? roundCost(baselineModel.suggested.cost, 1.0)
        : 1.0;

    let outputUsdPer1M = agreementInfo.medianOutputUsd;
    let inputUsdPer1M = agreementInfo.medianInputUsd;

    // คำนวณ cost เทียบ Hydrogen ($7.50 / 1M output = 1.0)
    let estimatedCost = baseCost;
    let costSource = 'baseline';
    if (outputUsdPer1M !== null && outputUsdPer1M > 0) {
        estimatedCost = roundCost(outputUsdPer1M / HYDROGEN_REF_OUTPUT_USD_PER_1M, baseCost);
        costSource = 'external';
    }

    // ปรับคะแนน q เล็กน้อยจากสัญญาณภายนอกเฉพาะกรณีที่ยังไม่มี baseline หรือเป็นรุ่นใหม่
    const q = { ...baseQ };
    const hasPricing = outputUsdPer1M !== null;
    const hasIntelligence = uniqueSources.some((s) => Boolean(s.snippet || s.contextLength || s.matchedId));

    // สำหรับรุ่นที่ยังไม่มี baseline ให้ประเมินจากราคา/บริบท/ระดับรุ่น
    if (!baselineModel && uniqueSources.length > 0) {
        const allText = uniqueSources.map((s) => `${s.title || ''} ${s.snippet || ''}`).join(' ');
        const tier = detectTierHint(allText);
        if (tier === 'flagship') {
            q.code = Math.max(q.code, 93);
            q.analysis = Math.max(q.analysis, 93);
            q.chat = Math.max(q.chat, 90);
        } else if (tier === 'economy') {
            q.code = Math.min(q.code, 76);
            q.analysis = Math.min(q.analysis, 76);
            q.chat = Math.min(q.chat, 82);
        }
    }

    return {
        baseQ: q,
        baseCost: estimatedCost,
        costSource,
        inputUsdPer1M,
        outputUsdPer1M,
        hasPricing,
        hasIntelligence
    };
}

function inferFallbackQ(desc) {
    if (desc.codenames.includes('orchestrator')) return { code: 95, analysis: 96, chat: 90 };
    if (desc.codenames.includes('opus') || desc.codenames.includes('neon')) return { code: 95, analysis: 94, chat: 91 };
    if (desc.codenames.includes('sonnet') || desc.codenames.includes('carbon')) return { code: 90, analysis: 89, chat: 89 };
    if (desc.codenames.includes('hydrogen') || desc.codenames.includes('pro')) return { code: 86, analysis: 87, chat: 86 };
    if (desc.codenames.includes('argon')) return { code: 82, analysis: 84, chat: 84 };
    if (desc.codenames.includes('flash') || desc.codenames.includes('haiku') || desc.codenames.includes('oss')) {
        return { code: 74, analysis: 75, chat: 80 };
    }
    return { code: 78, analysis: 78, chat: 80 };
}

function applyEffortAdjustment(baseQ, baseCost, effort) {
    if (!effort || !(effort in EFFORT_Q)) {
        return {
            effectiveQ: { ...baseQ },
            effectiveCost: roundCost(baseCost, 1.0)
        };
    }
    const dq = EFFORT_Q[effort] || 0;
    const cm = EFFORT_COST[effort] || 1.0;
    return {
        effectiveQ: {
            code: clampQ(baseQ.code + dq),
            analysis: clampQ(baseQ.analysis + dq),
            chat: clampQ(baseQ.chat + Math.round(dq * 0.7))
        },
        effectiveCost: roundCost(baseCost * cm, baseCost)
    };
}

// ── Core Research Functions ────────────────────────────────────────────────────
async function researchFamily(modelId, modelName, opts = {}) {
    const desc = parseModelDescriptor(modelId, modelName);
    const fKey = familyKeyOf(modelId);
    const now = Date.now();

    if (!opts.skipCache) {
        const mem = memoryFamilyCache.get(fKey);
        if (mem && (now - mem.fetchedAt) < CACHE_TTL_MS) {
            return mem.result;
        }
        const disk = loadDiskCache();
        const hit = disk.families && disk.families[fKey];
        if (hit && hit.fetchedAt && (now - hit.fetchedAt) < CACHE_TTL_MS && hit.result) {
            memoryFamilyCache.set(fKey, hit);
            return hit.result;
        }
    }

    const fetchImpl = opts.fetchImpl || globalThis.fetch;
    let catalogs = opts.catalogData || null;
    const rawSources = [];

    if (!opts.disableNetwork) {
        if (!catalogs) {
            catalogs = await fetchPublicCatalogs({ fetchImpl, skipCache: Boolean(opts.skipCache) });
        }
        rawSources.push(...matchFromCatalogs(desc, catalogs));

        const webTasks = [
            searchDuckDuckGo(desc, { fetchImpl }),
            searchHackerNews(desc, { fetchImpl }),
            searchHuggingFace(desc, { fetchImpl })
        ];
        if (opts.geminiApiKey || readGeminiApiKey()) {
            webTasks.push(searchGeminiGrounding(desc, { fetchImpl, apiKey: opts.geminiApiKey }));
        }

        const webSettled = await Promise.allSettled(webTasks);
        for (const r of webSettled) {
            if (r.status === 'fulfilled' && Array.isArray(r.value)) {
                rawSources.push(...r.value);
            }
        }
    } else if (catalogs) {
        rawSources.push(...matchFromCatalogs(desc, catalogs));
    }

    if (Array.isArray(opts.extraSources)) {
        rawSources.push(...opts.extraSources);
    }

    const uniqueSources = deduplicateSourcesByDomain(rawSources);
    const agreementInfo = analyzeAgreement(uniqueSources);

    const familyResult = {
        familyKey: fKey,
        prettyName: desc.prettyName,
        provider: desc.provider,
        version: desc.version,
        researchedAt: new Date(now).toISOString(),
        uniqueSources,
        agreementInfo
    };

    if (!opts.skipCache && !opts.extraSources) {
        memoryFamilyCache.set(fKey, { fetchedAt: now, result: familyResult });
        const disk = loadDiskCache();
        disk.families[fKey] = { fetchedAt: now, result: familyResult };
        saveDiskCache(disk);
    }

    return familyResult;
}

async function researchModel(modelInput, opts = {}) {
    const modelObj = typeof modelInput === 'string'
        ? { id: modelInput, name: modelInput }
        : (modelInput || {});
    const id = String(modelObj.id || '').trim();
    const name = String(modelObj.name || id);
    const desc = parseModelDescriptor(id, name);

    const famRes = await researchFamily(id, name, opts);
    const metrics = estimateMetricsFromEvidence(desc, famRes.uniqueSources, famRes.agreementInfo, modelObj);
    const conf = computeConfidenceScore({
        uniqueSources: famRes.uniqueSources,
        agreement: famRes.agreementInfo.agreement,
        hasIntelligence: metrics.hasIntelligence,
        hasPricing: metrics.hasPricing
    });

    const { effectiveQ, effectiveCost } = applyEffortAdjustment(metrics.baseQ, metrics.baseCost, desc.effort);
    const avgQ = Number((effectiveQ.code * 0.4 + effectiveQ.analysis * 0.35 + effectiveQ.chat * 0.25).toFixed(1));
    const valueScore = Number((avgQ / Math.max(0.15, effectiveCost)).toFixed(1));

    const basisParts = [
        `วิจัยภายนอก ${conf.uniqueDomainCount} แหล่งอิสระ (${conf.verdict})`,
        metrics.outputUsdPer1M != null
            ? `ราคาตลาด ~$${metrics.inputUsdPer1M ?? '?'}/$${metrics.outputUsdPer1M} ต่อ 1M tok (cost≈${metrics.baseCost})`
            : `ไม่พบราคาสาธารณะ ใช้ฐานอ้างอิง cost=${metrics.baseCost}`
    ];
    if (famRes.agreementInfo.conflictReason) {
        basisParts.push(`⚠️ ${famRes.agreementInfo.conflictReason}`);
    }

    return {
        id,
        name,
        engine: modelObj.engine || 'agy',
        family: modelObj.family || famRes.familyKey,
        status: modelObj.status || 'active',
        effort: desc.effort,
        confidence: conf.score,
        meetsMinSources: conf.meetsMinSources,
        uniqueDomainCount: conf.uniqueDomainCount,
        agreement: conf.agreement,
        verdict: conf.verdict,
        breakdown: conf.breakdown,
        conflictReason: famRes.agreementInfo.conflictReason || null,
        pricing: {
            inputUsdPer1M: metrics.inputUsdPer1M,
            outputUsdPer1M: metrics.outputUsdPer1M,
            costSource: metrics.costSource,
            baseCost: metrics.baseCost,
            effectiveCost
        },
        suggested: {
            q: metrics.baseQ,
            effectiveQ,
            cost: metrics.baseCost,
            effectiveCost,
            pool: (modelObj.suggested && modelObj.suggested.pool) || undefined,
            basis: basisParts.join(' · ')
        },
        scores: {
            avgQ,
            valueScore
        },
        sources: famRes.uniqueSources.map((s) => ({
            provider: s.provider,
            domain: s.domain,
            quality: s.quality,
            title: s.title,
            url: s.url,
            snippet: s.snippet,
            inputUsdPer1M: s.inputUsdPer1M ?? null,
            outputUsdPer1M: s.outputUsdPer1M ?? null
        })),
        researchedAt: famRes.researchedAt
    };
}

/**
 * วิจัยหลายโมเดลพร้อมกันโดยจัดกลุ่มตามตระกูล (Family Grouping) เพื่อไม่ยิงค้นหาซ้ำ
 */
async function researchModels(models, opts = {}) {
    const list = Array.isArray(models) ? models : [];
    if (list.length === 0) return [];

    // โหลดแคตตาล็อกครั้งเดียวล่วงหน้า
    let catalogData = opts.catalogData || null;
    if (!catalogData && !opts.disableNetwork) {
        catalogData = await fetchPublicCatalogs({
            fetchImpl: opts.fetchImpl || globalThis.fetch,
            skipCache: Boolean(opts.skipCache)
        });
    }

    // จัดกลุ่มตาม familyKey
    const familyGroups = new Map();
    for (const m of list) {
        const id = typeof m === 'string' ? m : (m && m.id);
        if (!id) continue;
        const fk = familyKeyOf(id);
        if (!familyGroups.has(fk)) familyGroups.set(fk, []);
        familyGroups.get(fk).push(m);
    }

    // ค้นหาทีละกลุ่ม (จำกัด concurrency = 3 เพื่อไม่โดน rate-limit)
    const keys = [...familyGroups.keys()];
    const famResults = new Map();
    const concurrency = Math.max(1, Math.min(5, Number(opts.concurrency) || 3));
    let cursor = 0;

    async function worker() {
        while (cursor < keys.length) {
            const idx = cursor++;
            const fk = keys[idx];
            const first = familyGroups.get(fk)[0];
            const id = typeof first === 'string' ? first : first.id;
            const name = typeof first === 'string' ? first : (first.name || first.id);
            const famRes = await researchFamily(id, name, { ...opts, catalogData });
            famResults.set(fk, famRes);
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, () => worker()));

    // ประกอบผลลัพธ์ของแต่ละโมเดล (พร้อมปรับ effort)
    const evaluated = [];
    for (const m of list) {
        const modelObj = typeof m === 'string' ? { id: m, name: m } : m;
        if (!modelObj || !modelObj.id) continue;
        const fk = familyKeyOf(modelObj.id);
        const famRes = famResults.get(fk);
        const desc = parseModelDescriptor(modelObj.id, modelObj.name || modelObj.id);
        const metrics = estimateMetricsFromEvidence(desc, famRes.uniqueSources, famRes.agreementInfo, modelObj);
        const conf = computeConfidenceScore({
            uniqueSources: famRes.uniqueSources,
            agreement: famRes.agreementInfo.agreement,
            hasIntelligence: metrics.hasIntelligence,
            hasPricing: metrics.hasPricing
        });
        const { effectiveQ, effectiveCost } = applyEffortAdjustment(metrics.baseQ, metrics.baseCost, desc.effort);
        const avgQ = Number((effectiveQ.code * 0.4 + effectiveQ.analysis * 0.35 + effectiveQ.chat * 0.25).toFixed(1));
        const valueScore = Number((avgQ / Math.max(0.15, effectiveCost)).toFixed(1));

        const basisParts = [
            `วิจัยภายนอก ${conf.uniqueDomainCount} แหล่งอิสระ (${conf.verdict})`,
            metrics.outputUsdPer1M != null
                ? `ราคาตลาด ~$${metrics.inputUsdPer1M ?? '?'}/$${metrics.outputUsdPer1M} ต่อ 1M tok (cost≈${metrics.baseCost})`
                : `ไม่พบราคาสาธารณะ ใช้ฐานอ้างอิง cost=${metrics.baseCost}`
        ];
        if (famRes.agreementInfo.conflictReason) {
            basisParts.push(`⚠️ ${famRes.agreementInfo.conflictReason}`);
        }

        evaluated.push({
            id: modelObj.id,
            name: modelObj.name || modelObj.id,
            engine: modelObj.engine || 'agy',
            family: modelObj.family || fk,
            status: modelObj.status || 'active',
            effort: desc.effort,
            confidence: conf.score,
            meetsMinSources: conf.meetsMinSources,
            uniqueDomainCount: conf.uniqueDomainCount,
            agreement: conf.agreement,
            verdict: conf.verdict,
            breakdown: conf.breakdown,
            conflictReason: famRes.agreementInfo.conflictReason || null,
            pricing: {
                inputUsdPer1M: metrics.inputUsdPer1M,
                outputUsdPer1M: metrics.outputUsdPer1M,
                costSource: metrics.costSource,
                baseCost: metrics.baseCost,
                effectiveCost
            },
            suggested: {
                q: metrics.baseQ,
                effectiveQ,
                cost: metrics.baseCost,
                effectiveCost,
                pool: (modelObj.suggested && modelObj.suggested.pool) || undefined,
                basis: basisParts.join(' · ')
            },
            scores: {
                avgQ,
                valueScore
            },
            sources: famRes.uniqueSources.map((s) => ({
                provider: s.provider,
                domain: s.domain,
                quality: s.quality,
                title: s.title,
                url: s.url,
                snippet: s.snippet,
                inputUsdPer1M: s.inputUsdPer1M ?? null,
                outputUsdPer1M: s.outputUsdPer1M ?? null
            })),
            researchedAt: famRes.researchedAt
        });
    }

    return evaluated;
}

// ── Ranking ────────────────────────────────────────────────────────────────────
function rankModels(evaluatedModels, { sortBy = 'composite' } = {}) {
    const list = (Array.isArray(evaluatedModels) ? evaluatedModels : []).map((m) => {
        const avgQ = Number(m.scores && m.scores.avgQ) || 75;
        const conf = Number(m.confidence) || 25;
        const effCost = Number(m.pricing && m.pricing.effectiveCost) || Number(m.suggested && m.suggested.cost) || 1;
        const valueNorm = Math.min(100, (avgQ / Math.max(0.2, effCost)) * 0.5);
        const compositeScore = Number((avgQ * 0.6 + conf * 0.3 + valueNorm * 0.1).toFixed(1));
        return {
            ...m,
            scores: {
                ...(m.scores || {}),
                avgQ,
                compositeScore
            }
        };
    });

    list.sort((a, b) => {
        if (sortBy === 'confidence') {
            return (b.confidence - a.confidence) || (b.scores.avgQ - a.scores.avgQ);
        }
        if (sortBy === 'intelligence') {
            return (b.scores.avgQ - a.scores.avgQ) || (b.confidence - a.confidence);
        }
        if (sortBy === 'value') {
            return ((b.scores.valueScore || 0) - (a.scores.valueScore || 0)) || (b.scores.avgQ - a.scores.avgQ);
        }
        if (sortBy === 'cost') {
            return ((a.pricing.effectiveCost || 0) - (b.pricing.effectiveCost || 0)) || (b.scores.avgQ - a.scores.avgQ);
        }
        // default: composite (ฉลาด + มั่นใจ + คุ้มค่า)
        return (b.scores.compositeScore - a.scores.compositeScore)
            || (b.confidence - a.confidence)
            || (b.scores.avgQ - a.scores.avgQ);
    });

    return list.map((m, idx) => ({ ...m, rank: idx + 1 }));
}

// ── Optional Gemini Synthesis (สังเคราะห์บทบาท/จุดเด่นจากผลวิจัยจริง) ─────────────
async function synthesizeRankingWithGemini(rankedModels, opts = {}) {
    if (typeof opts.geminiSynthesizer === 'function') {
        return opts.geminiSynthesizer(rankedModels, opts);
    }

    const compact = (rankedModels || []).map((m) => ({
        rank: m.rank,
        id: m.id,
        name: m.name,
        engine: m.engine,
        confidence: m.confidence,
        sources: m.uniqueDomainCount,
        meetsMinSources: m.meetsMinSources,
        avgQ: m.scores && m.scores.avgQ,
        cost: m.pricing && m.pricing.effectiveCost,
        outputUsdPer1M: m.pricing && m.pricing.outputUsdPer1M
    }));

    const prompt = [
        'คุณคือผู้เชี่ยวชาญประเมินโมเดล AI ช่วยสรุปการจัดอันดับโมเดลที่มีในระบบตอนนี้เป็นภาษาไทยแบบกระชับและตรงไปตรงมา',
        'กฎสำคัญ: อ้างอิงเฉพาะตัวเลขและข้อมูลจาก JSON ด้านล่าง ห้ามกุ URL หรือราคาเอง โมเดลที่ sources < 3 ให้ระบุชัดว่ายังไม่มีข้อมูลสาธารณะภายนอกครบ 3 แหล่ง',
        'ตอบเป็นย่อหน้าสั้นๆ 3-5 ข้อ: (1) ตัวท็อปสายโค้ด/งานซับซ้อน (2) ตัวคุ้มค่าสุดสำหรับงานประจำวัน (3) ตัวประหยัด/โควตาน้อย (4) ข้อควรระวังเรื่องความมั่นใจของรุ่นที่ยังหาแหล่งภายนอกได้น้อย',
        '',
        JSON.stringify(compact)
    ].join('\n');

    // 1. ลอง Gemini REST API ถ้ามี GEMINI_API_KEY
    const apiKey = opts.geminiApiKey || readGeminiApiKey();
    if (apiKey) {
        try {
            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
            const res = await fetchWithTimeout(endpoint, {
                method: 'POST',
                timeoutMs: 20000,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }]
                })
            }, opts.fetchImpl || globalThis.fetch);
            if (res.ok) {
                const data = await res.json();
                const text = data && data.candidates && data.candidates[0] && data.candidates[0].content
                    && Array.isArray(data.candidates[0].content.parts)
                    ? data.candidates[0].content.parts.map((p) => p.text || '').join('\n').trim()
                    : '';
                if (text) return { ok: true, via: 'gemini-api', model: 'gemini-2.5-flash', summary: text };
            }
        } catch (_) {}
    }

    // 2. Fallback: ลองเรียก agy CLI ด้วยโมเดล Gemini 4 รุ่นใหม่ (ถ้ามีและไม่ได้ปิดไว้)
    const agyBin = opts.agyBin || process.env.AGY_BIN || path.join(HOME_DIR, '.local/bin/agy');
    if (opts.allowAgyCli && fs.existsSync(agyBin)) {
        const model = opts.agyModel || 'gemini-4-hydrogen-low';
        return new Promise((resolve) => {
            execFile(
                agyBin,
                ['-m', model, '-p', prompt],
                { timeout: Number(opts.agyTimeoutMs) || 35000, maxBuffer: 2 * 1024 * 1024 },
                (err, stdout) => {
                    const out = String(stdout || '').trim();
                    if (!err && out) {
                        return resolve({ ok: true, via: 'agy-cli', model, summary: out });
                    }
                    return resolve({ ok: false, via: 'none', error: err ? err.message : 'empty_output', summary: null });
                }
            );
        });
    }

    return { ok: false, via: 'none', error: 'no_gemini_synthesizer_configured', summary: null };
}

function clearCaches() {
    memoryCatalogCache = { fetchedAt: 0, data: null };
    memoryFamilyCache.clear();
}

module.exports = {
    MIN_TRUSTED_SOURCES,
    HYDROGEN_REF_OUTPUT_USD_PER_1M,
    EFFORT_Q,
    EFFORT_COST,
    extractRootDomain,
    isOfficialOrCatalogDomain,
    splitModelEffort,
    familyKeyOf,
    parseModelDescriptor,
    candidateMatchesDescriptor,
    fetchPublicCatalogs,
    matchFromCatalogs,
    deduplicateSourcesByDomain,
    analyzeAgreement,
    computeConfidenceScore,
    researchFamily,
    researchModel,
    researchModels,
    rankModels,
    synthesizeRankingWithGemini,
    clearCaches
};
