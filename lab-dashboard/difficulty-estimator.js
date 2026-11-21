'use strict';

/**
 * difficulty-estimator.js
 * -----------------------------------------------------------------------------
 * ตัวประเมินความยากของงาน (v4) ของสมองกลาง (AI Router) — ส่วนที่เป็นฟังก์ชันล้วน ไม่เรียก AI
 *
 * ปัญหาของ v2/v3: ตัวคัดงานเห็นข้อความเดียว และให้เลข 0–100 ก้อนเดียวตามความรู้สึก
 *   → "ทำต่อเลย / เริ่มทำงานได้เลย" ที่หมายถึงงานใหญ่ ถูกให้ 25/100 และคะแนนแกว่งระหว่างรอบ
 *
 * v4 แก้ 5 จุด (ที่มา: docs/ai-router.md หัวข้อ "ตัวประเมินความยาก v4"):
 *   1. rubric แยกมิติ (scope/depth/unknowns/steps/risk) + เวลาที่ผู้เชี่ยวชาญใช้ (สเกล log แบบ METR)
 *      พร้อมตัวอย่างอ้างอิงที่มีคะแนนกำกับ → AI ตอบเป็นจำนวนเต็มหยาบๆ แล้วคำนวณคะแนนรวม "ในโค้ด"
 *   2. ตัวช่วยตรวจจากข้อความ (จำนวนไฟล์ รายการหลายข้อ คำบอกขอบเขต/ความเสี่ยง) ผสมกับคะแนนของ AI
 *      แบบไม่สมมาตร: ประเมินต่ำเกินเสียหายกว่าสูงเกิน (คะแนนส่วน "อ่อนเกินงาน" ในสมองกลางหนัก ×4)
 *   3. บริบทแชท: ข้อความต่อเนื่อง ("ทำต่อเลย") สืบทอดความยากของงานก่อนหน้า
 *   4. วงจรป้อนกลับ: จำนวนขั้นตอน/เวลาที่ใช้จริง → ความยากที่สังเกตได้ → ใช้เป็น prior ของข้อความถัดไป
 *      และบันทึกเทียบกับที่ทำนายไว้เพื่อปรับเกณฑ์ (GET /api/ai-router/calibration)
 *   5. ทุกมิติถูก log ไว้ ดูความแกว่งรายมิติได้
 */

const RUBRIC_VERSION = 'v4';

// ── เวลามนุษย์ (นาที) → คะแนน 0–100 (ประมาณเชิงเส้นบนสเกล log2) ───────────────────
const TIME_ANCHORS = [[1, 5], [5, 20], [15, 35], [30, 45], [60, 58], [120, 70], [240, 80], [480, 90], [960, 98]];

function scoreFromMinutes(minutes) {
    const m = Number(minutes);
    if (!Number.isFinite(m) || m <= 0) return null;
    if (m <= TIME_ANCHORS[0][0]) return TIME_ANCHORS[0][1];
    const last = TIME_ANCHORS[TIME_ANCHORS.length - 1];
    if (m >= last[0]) return last[1];
    for (let i = 1; i < TIME_ANCHORS.length; i++) {
        const [m1, s1] = TIME_ANCHORS[i - 1];
        const [m2, s2] = TIME_ANCHORS[i];
        if (m <= m2) {
            const t = (Math.log2(m) - Math.log2(m1)) / (Math.log2(m2) - Math.log2(m1));
            return s1 + (s2 - s1) * t;
        }
    }
    return last[1];
}

// ── ระดับความพยายามจากคะแนน (เกณฑ์เดิมของ v2/v3 — ไม่เปลี่ยน เพื่อให้เทียบกันได้) ──────
const QUALITY_TIER_WEIGHT = 3; // quality_bar 0..2 → +0..6 คะแนนในการจัดระดับ

function tierFromScores(type, complexity, risk, needsTools, quality = 0) {
    if (type === 'quick') return 'low';
    const s = complexity + risk * 0.25 + (type === 'code' && needsTools ? 5 : 0) + (quality || 0) * QUALITY_TIER_WEIGHT;
    if (s < 35) return 'low';
    if (s < 60) return 'medium';
    if (s < 82) return 'high';
    return 'xhigh';
}

function levelFromComplexity(c) {
    return c < 35 ? 1 : (c < 70 ? 2 : 3);
}

function clampInt(v, lo, hi, dflt) {
    const n = Math.round(Number(v));
    return Number.isNaN(n) ? dflt : Math.max(lo, Math.min(hi, n));
}

// ── ตัวช่วยตรวจจากข้อความ (ทันที ไม่เสียโควตา) ───────────────────────────────────
const FILE_REF_RE = /(?:[\w.~-]+\/)*[\w-]+(?:\.[\w-]+)*\.(?:js|mjs|ts|tsx|jsx|py|html|css|json|md|sh|yml|yaml|sql|conf|service|env|toml|ini)\b/gi;
const NOT_A_FILE_RE = /^(?:node|next|vue|react|express|three|chart|d3)\.js$/i;
const ENUM_LINE_RE = /^\s*(?:\d{1,2}[.)]\s|\(\d{1,2}\)|[-*•]\s|ข้อ\s*\d+)/;
const ENUM_INLINE_RE = /\(\d{1,2}\)/g;
const STEP_WORD_RE = /(?:แล้ว(?:ก็)?|จากนั้น|หลังจากนั้น|พร้อม(?:ทั้ง)?|นอกจากนี้|ด้วย|ต่อไป|\bthen\b|\balso\b|\bafter that\b)/gi;
const SCOPE_RE = /(?:ทั้งระบบ|ทั้งหมด|ทุกหน้า|ทุกไฟล์|ทุกที่|ทุกส่วน|ทั้งโปรเจค|ทั้งเว็บ|ทั้งแอป|หลายไฟล์|หลายหน้า|ใหม่ทั้งหมด|รีแฟกเตอร์|refactor|สถาปัตยกรรม|architecture|migrate|ย้ายระบบ|ออกแบบ(?:ใหม่|ระบบ)?|สร้าง(?:ระบบ|หน้า|ฟีเจอร์|สกิล|เว็บ|แอป|เอกสาร)|ระบบใหม่|\bbuild\b|\bimplement\b|\bintegrate\b|เชื่อมต่อ|end-to-end|pipeline|multi-agent|ข้ามค่าย|from scratch|full-?stack|ทดสอบ(?:ทั้ง|ให้ครบ)|เขียนเทสต์|เอกสาร)/gi;
const RISK_RE = /(?:production|\bprod\b|restart|รีสตาร์ท|รีสตาร์ต|ลบ|\bdelete\b|\brm\b|\bdrop\b|truncate|ฐานข้อมูล|database|mongo|firewall|iptables|wireguard|\bufw\b|\bssh\b|sudo|\bdeploy\b|--force|force push|ปิดระบบ|shutdown|reboot|รีบูต|เงิน|\btrade\b|เทรด|credential|รหัสผ่าน|password|\btoken\b|\bsecret\b)/gi;
const QUALITY_RE = /(?:รอบคอบ|ละเอียด|ให้ดีที่สุด|อย่าให้พลาด|สุดความสามารถ|ตรวจสอบดีๆ|ตรวจดีๆ|ครบถ้วน|สมบูรณ์|ไม่ให้พลาด|thorough|carefully|double-?check)/gi;
const QUALITY_STRONG_RE = /(?:รอบคอบสุด|สุดความสามารถ|อย่าให้พลาด|ละเอียดที่สุด|ดีที่สุด|ตรวจสอบดีๆ)/i;
const ACTION_RE = /(?:แก้|สร้าง|เพิ่ม|ลบ|ปรับ|เขียน|ทำให้|เปลี่ยน|ติดตั้ง|ย้าย|แยก|รวม|ตั้งค่า|ทดสอบ|เชื่อม|\bimplement\b|\bfix\b|\bcreate\b|\badd\b|\bwrite\b|\bbuild\b|\brefactor\b|\bdeploy\b|\bupdate\b|\bremove\b|\bchange\b|\binstall\b|\bmigrate\b)/gi;
const QUESTION_START_RE = /^(?:อธิบาย|คืออะไร|ทำไม|ช่วยสรุป|สรุป|ขอถาม|ถามหน่อย|เป็นไปได้ไหม|\bwhat\b|\bwhy\b|\bhow\b|\bexplain\b)/i;

function uniqueMatches(re, text, normalize = (s) => s.toLowerCase()) {
    const set = new Set();
    for (const m of String(text).matchAll(re)) set.add(normalize(m[0]));
    return set;
}

/**
 * @returns {{score:number, risk:number, floor:number, tinyCap:number|null, qualityLevel:number, signals:object}}
 */
function heuristics(text, { hasImages = false } = {}) {
    const t = String(text || '');
    const len = t.length;
    const fileRefs = [...uniqueMatches(FILE_REF_RE, t)].filter((f) => !NOT_A_FILE_RE.test(f)).length;
    const bulletLines = t.split('\n').filter((l) => ENUM_LINE_RE.test(l)).length;
    const inlineEnums = (t.match(ENUM_INLINE_RE) || []).length;
    const enumerations = bulletLines + inlineEnums;
    const stepWords = (t.match(STEP_WORD_RE) || []).length;
    const scopeHits = uniqueMatches(SCOPE_RE, t).size;
    const riskHits = uniqueMatches(RISK_RE, t).size;
    const qualityHits = uniqueMatches(QUALITY_RE, t).size;
    const actionVerbs = uniqueMatches(ACTION_RE, t).size;
    const trimmed = t.trim();
    const questionOnly = actionVerbs === 0 && (QUESTION_START_RE.test(trimmed) || /(?:ไหม|มั้ย|หรือเปล่า|\?)\s*$/.test(trimmed));

    const lenScore = Math.max(0, Math.min(1, (Math.log(len + 1) - Math.log(40)) / (Math.log(1500) - Math.log(40)))) * 20;
    let score = 10
        + lenScore
        + Math.min(20, fileRefs * 7)
        + Math.min(15, enumerations * 4)
        + Math.min(8, stepWords * 2)
        + Math.min(25, scopeHits * 10)
        + (actionVerbs > 0 ? 8 : 0)
        + (hasImages ? 4 : 0);
    if (questionOnly) score *= 0.7;
    score = Math.max(0, Math.min(100, score));

    // พื้นขั้นต่ำจากหลักฐานแข็ง (ไม่ให้ AI ประเมินต่ำกว่านี้ถ้าข้อความบอกชัดว่างานใหญ่)
    let floor = 0;
    if (fileRefs >= 3) floor = Math.max(floor, 50);
    if (scopeHits >= 2 && len >= 150) floor = Math.max(floor, 60);
    if (enumerations >= 4) floor = Math.max(floor, 50);

    // ข้อความสั้นมากและไม่มีคำสั่งลงมือ → ไม่ควรเกิน 20
    const tinyCap = (len <= 25 && actionVerbs === 0 && fileRefs === 0) ? 20 : null;

    const qualityLevel = QUALITY_STRONG_RE.test(t) || qualityHits >= 2 ? 2 : (qualityHits >= 1 ? 1 : 0);
    const risk = Math.min(100, riskHits * 20);
    return {
        score: Math.round(score),
        risk,
        floor,
        tinyCap,
        qualityLevel,
        signals: { len, fileRefs, enumerations, stepWords, scopeHits, riskHits, qualityHits, actionVerbs, questionOnly }
    };
}

// ── ข้อความต่อเนื่อง ("ทำต่อเลย") ───────────────────────────────────────────────
const CONT_START_RE = /^(?:ได้เลย|โอเค(?:เลย)?|ok(?:ay)?|ตกลง|ทำต่อ(?:เลย)?|ต่อเลย|ต่อ|ลุยเลย|ลุย|เริ่ม(?:ทำ)?(?:งาน)?(?:ได้)?เลย|ลงมือ(?:ได้)?เลย|ทำเลย|จัดไป|เอาเลย|เอาตามนั้น|ตามนั้น(?:เลย)?|ใช่|yes|go(?: ahead)?|proceed|continue|do it|ครับ|ค่ะ|คับ|แนวทางที่\s*\d+|ข้อ\s*\d+|แบบที่\s*\d+|เลือก(?:แบบ|ข้อ)?\s*\d+)/i;

/** ข้อความสั้นที่ขึ้นต้นด้วยคำสั่งต่อเนื่อง และไม่มีเนื้องานใหม่ (ไม่มีคำสั่งลงมือ/ไฟล์) */
function isPureContinuation(text) {
    const t = String(text || '').trim().replace(/[!.\s]+$/, '');
    if (!t || t.length > 80 || !CONT_START_RE.test(t)) return false;
    const h = heuristics(t);
    return h.signals.actionVerbs === 0 && h.signals.fileRefs === 0;
}

// ── หน่วยความจำรายห้องแชท (prior จากงานก่อนหน้า + ความยากที่สังเกตได้จริง) ─────────────
const SESSION_TTL_MS = 8 * 3600 * 1000;
const SESSION_KEEP = 3;
const PRIOR_DECAY = 0.92;
const sessionRecords = new Map(); // sid -> [{at, complexity, risk, type, effective, observed}]

function observedComplexity(steps, durationMs) {
    const s = Number(steps) || 0;
    const d = Number(durationMs) || 0;
    const stepsScore = s === 0 ? 10 : (s <= 3 ? 30 : (s <= 10 ? 50 : (s <= 25 ? 70 : 85)));
    const durScore = d < 30e3 ? 10 : (d < 120e3 ? 30 : (d < 300e3 ? 50 : (d < 900e3 ? 70 : 85)));
    return Math.round(Math.max(stepsScore, durScore * 0.9));
}

function noteRouted(sessionId, cls, now = Date.now()) {
    if (!sessionId || !cls) return;
    const list = (sessionRecords.get(sessionId) || []).filter((r) => now - r.at < SESSION_TTL_MS);
    list.unshift({ at: now, complexity: cls.complexity, risk: cls.risk || 0, type: cls.type, effective: cls.complexity, observed: null });
    sessionRecords.set(sessionId, list.slice(0, SESSION_KEEP));
    if (sessionRecords.size > 400) sessionRecords.delete(sessionRecords.keys().next().value);
}

function noteObserved(sessionId, { steps = 0, durationMs = 0 } = {}) {
    const list = sessionRecords.get(sessionId);
    if (!list || !list.length) return null;
    const obs = observedComplexity(steps, durationMs);
    const rec = list[0];
    rec.observed = { steps, durationMs, complexity: obs };
    rec.effective = Math.max(rec.complexity, obs);
    return obs;
}

/** prior = งานสำคัญล่าสุดของห้องนี้ (ถ่วงน้ำหนักลดลงตามลำดับเก่า) */
function getPrior(sessionId, now = Date.now()) {
    const list = (sessionRecords.get(sessionId) || []).filter((r) => now - r.at < SESSION_TTL_MS);
    if (!list.length) return null;
    let best = null;
    list.forEach((r, i) => {
        const weighted = r.effective * Math.pow(PRIOR_DECAY, i);
        if (!best || weighted > best.complexity) {
            best = { complexity: Math.round(weighted), risk: r.risk, type: r.type, ageMs: now - r.at, observed: r.observed };
        }
    });
    return best;
}

function seedPrior(sessionId, records) {
    if (!sessionId || !Array.isArray(records) || !records.length) return;
    sessionRecords.set(sessionId, records.slice(0, SESSION_KEEP));
}

function clearSessions() {
    sessionRecords.clear();
}

// ── บริบทแชทสำหรับตัวคัดงาน ─────────────────────────────────────────────────────
function clip(s, head, tail) {
    const str = String(s || '').replace(/\s+/g, ' ').trim();
    if (str.length <= head + tail + 20) return str;
    return `${str.slice(0, head)} … ${tail ? str.slice(-tail) : ''}`.trim();
}

function stripBanner(content) {
    return String(content || '').split('\n').filter((l) => !/^\s*>/.test(l)).join('\n');
}

function buildContextBlock(history, prior) {
    const msgs = (Array.isArray(history) ? history : [])
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
        .slice(-6);
    if (!msgs.length) return '';
    const lines = msgs.map((m) => (m.role === 'user'
        ? `User: ${clip(m.content, 450, 150)}`
        : `Assistant: ${clip(stripBanner(m.content), 250, 450)}`));
    if (prior && prior.observed && prior.observed.steps !== undefined) {
        const mins = Math.max(0.1, (prior.observed.durationMs || 0) / 60000);
        lines.push(`[Observed fact] The most recent task in this chat ran ${prior.observed.steps} tool steps over ${mins.toFixed(1)} minutes.`);
    }
    return lines.join('\n').slice(0, 3600);
}

// ── ตัวคัดงาน: prompt แบบ rubric + ตัวอย่างอ้างอิง ────────────────────────────────
const ANCHOR_EXAMPLES = [
    ['สถานะ pm2 ตอนนี้เป็นไงบ้าง',
        { type: 'quick', scope: 0, depth: 0, unknowns: 0, steps: 1, risk: 0, quality_bar: 0, human_minutes: 1, parallel: 0, depends_on_previous: false, needs_tools: true, reason: 'ดูสถานะอย่างเดียว' }],
    ['เปลี่ยนสีปุ่มส่งในหน้าแชทเป็นสีเขียว',
        { type: 'code', scope: 1, depth: 1, unknowns: 1, steps: 1, risk: 1, quality_bar: 0, human_minutes: 5, parallel: 0, depends_on_previous: false, needs_tools: true, reason: 'แก้ CSS จุดเดียว' }],
    ['เพิ่มตัวเลือกเปิด/ปิดเสียงเตือนในหน้าตั้งค่า แล้วให้ทุกหน้าอ่านค่านี้',
        { type: 'code', scope: 3, depth: 2, unknowns: 2, steps: 2, risk: 1, quality_bar: 0, human_minutes: 45, parallel: 0, depends_on_previous: false, needs_tools: true, reason: 'แตะหลายไฟล์แต่รูปแบบชัดเจน' }],
    ['ตรวจสุขภาพ docker, pm2, disk, home assistant แล้วสรุปปัญหาที่เจอ',
        { type: 'analysis', scope: 1, depth: 2, unknowns: 3, steps: 2, risk: 0, quality_bar: 0, human_minutes: 30, parallel: 4, depends_on_previous: false, needs_tools: true, reason: 'ตรวจ 4 ระบบอิสระต่อกัน' }],
    ['แยก engine ออกจาก gemini-manager.js เป็นโมดูลใหม่ แก้ทุกจุดที่เรียก และทดสอบแชททั้งระบบ',
        { type: 'code', scope: 3, depth: 3, unknowns: 3, steps: 3, risk: 3, quality_bar: 1, human_minutes: 240, parallel: 0, depends_on_previous: false, needs_tools: true, reason: 'รีแฟกเตอร์ไฟล์ใหญ่ที่ทุกอย่างพึ่งพา' }],
    ['สร้างระบบแจ้งเตือนใหม่ทั้งระบบ มีหน้าตั้งค่า คิวส่งซ้ำ rate limit เอกสาร และเทสต์',
        { type: 'code', scope: 4, depth: 3, unknowns: 3, steps: 4, risk: 2, quality_bar: 0, human_minutes: 600, parallel: 3, depends_on_previous: false, needs_tools: true, reason: 'ระบบใหม่ครบ backend+หน้าเว็บ+เอกสาร+เทสต์' }]
];

function buildRubricPrompt(prompt, contextBlock = '') {
    const lines = [
        'You are the difficulty estimator of an AI task router for a homelab server (Node.js dashboard, Python scripts, Docker, PM2, Home Assistant). Do NOT use any tools. Read the TASK and reply with ONLY one line of JSON.',
        '',
        'Score each dimension with an INTEGER on its anchored scale:',
        '- scope (how much must change or be touched): 0=nothing changes (answer only) · 1=one small spot (a line, a label, a setting) · 2=one file or one feature · 3=several files/components · 4=new subsystem or cross-system change',
        '- depth (reasoning needed): 0=lookup · 1=routine · 2=some design choices · 3=hard debugging / trade-offs / unknown root cause · 4=research-grade or novel design',
        '- unknowns (must be discovered first): 0=none · 1=a little · 2=explore a few files · 3=explore a lot · 4=must investigate the whole system',
        '- steps (tool actions expected): 0=none · 1=1-3 · 2=4-10 · 3=11-30 · 4=30+',
        '- risk (damage if done wrong on a running system): 0=none · 1=cosmetic · 2=one service could break · 3=several services or data loss possible · 4=core services, credentials or money at stake',
        '- quality_bar: 0=normal · 1=user asks for care/thoroughness · 2=user demands exhaustive, double-checked work',
        '- human_minutes: realistic minutes for an experienced engineer who already knows this system (e.g. 2, 15, 45, 120, 480)',
        '- parallel: number of truly independent pieces that separate agents could do at the same time (0 if the work cannot be split)',
        '- depends_on_previous: true only if the TASK cannot be understood without the earlier conversation (e.g. "continue", "do option 1", "yes, go")',
        '- type: code=write/fix/refactor code or edit config; analysis=plan, design, investigate, compare, debug a system; chat=general Q&A or explanation; quick=greeting, one-liner, simple status check',
        '- needs_tools: true if the task needs to read/run/edit things on the machine',
        '- reason: one short Thai sentence',
        '',
        'Be calibrated: most chat and status requests are 1-15 minutes, do not inflate them. But do not under-estimate: building a whole page, feature or system (backend + UI + docs + tests) takes hours, and research or comparison work that needs reading about several options usually takes 45-120 minutes.',
        '',
        'Scored examples:'
    ];
    for (const [task, scored] of ANCHOR_EXAMPLES) {
        lines.push(`TASK: ${task}`, `JSON: ${JSON.stringify(scored)}`);
    }
    lines.push('');
    if (contextBlock) {
        lines.push(
            'CONVERSATION SO FAR (most recent last). Score ONLY the final TASK. If the TASK refers to earlier work ("continue", "do it", "that one", "start"), judge the size of the work it refers to, and set depends_on_previous=true.',
            '"""', contextBlock, '"""', ''
        );
    }
    lines.push('TASK:', '"""', String(prompt).slice(0, 4000), '"""', 'JSON:');
    return lines.join('\n');
}

const VALID_TYPES = ['code', 'analysis', 'chat', 'quick'];

/** แปลงผลของ AI เป็น rubric ที่ตรวจสอบแล้ว (รองรับรูปแบบเก่า v2 ที่ให้ complexity ตรงๆ) */
function normalizeRubric(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const type = VALID_TYPES.includes(obj.type) ? obj.type : null;
    if (!type) return null;
    const hasDims = ['scope', 'depth', 'unknowns', 'steps'].every((k) => obj[k] !== undefined);
    if (!hasDims && obj.complexity === undefined && obj.level === undefined) return null;
    const out = {
        type,
        needsTools: Boolean(obj.needs_tools),
        parallel: clampInt(obj.parallel !== undefined ? obj.parallel : obj.subtasks, 0, 6, 0),
        dependsOnPrevious: obj.depends_on_previous === true || obj.depends_on_previous === 'true',
        reason: String(obj.reason || '').slice(0, 160)
    };
    if (hasDims) {
        out.scope = clampInt(obj.scope, 0, 4, 2);
        out.depth = clampInt(obj.depth, 0, 4, 2);
        out.unknowns = clampInt(obj.unknowns, 0, 4, 2);
        out.steps = clampInt(obj.steps, 0, 4, 2);
        out.risk = clampInt(obj.risk, 0, 4, 1);
        out.quality = clampInt(obj.quality_bar, 0, 2, 0);
        const hm = Number(obj.human_minutes);
        out.humanMinutes = Number.isFinite(hm) && hm > 0 ? Math.min(hm, 5000) : null;
    } else {
        // รูปแบบเก่า: complexity 0–100 / risk 0–100 ตรงๆ
        out.legacyComplexity = obj.complexity !== undefined
            ? clampInt(obj.complexity, 0, 100, 50)
            : ({ 1: 25, 2: 55, 3: 80 }[clampInt(obj.level, 1, 3, 2)]);
        out.legacyRisk = clampInt(obj.risk, 0, 100, 20);
    }
    return out;
}

function parseRubric(text) {
    const m = String(text || '').match(/\{[^{}]*"type"[^{}]*\}/);
    if (!m) return null;
    try {
        return normalizeRubric(JSON.parse(m[0]));
    } catch (_) {
        return null;
    }
}

/** คะแนนความยากจาก rubric (คำนวณในโค้ด ไม่ใช่ให้ AI เดา) */
function scoreRubric(r) {
    if (r.legacyComplexity !== undefined) {
        return { llm: r.legacyComplexity, dimScore: null, timeScore: null, risk100: r.legacyRisk };
    }
    const dimScore = ((r.scope * 1.0 + r.depth * 1.2 + r.unknowns * 0.8 + r.steps * 1.0) / (4 * 4.0)) * 100;
    const timeScore = r.humanMinutes ? scoreFromMinutes(r.humanMinutes) : null;
    const llm = timeScore === null ? dimScore : 0.5 * dimScore + 0.5 * timeScore;
    return { llm: Math.round(llm), dimScore: Math.round(dimScore), timeScore: timeScore === null ? null : Math.round(timeScore), risk100: r.risk * 25 };
}

// ── ผสมคะแนน AI + ตัวช่วยตรวจ + บริบท (ไม่สมมาตร: ตัวช่วยตรวจดันขึ้นได้ แต่ไม่ดึงลง) ──
// ตัวช่วยตรวจดูแค่ผิวข้อความ (ความยาว/จำนวนไฟล์) สเกลจึงต่ำกว่า AI เสมอสำหรับงานที่สั้นแต่ยาก
// (วัดแล้ว: c17 AI=75 แต่ตัวช่วยตรวจ=36 → เฉลี่ยแล้วเหลือ 67) → ห้ามเอามาเฉลี่ยดึงลง
// ใช้ได้แค่ 2 ทาง: ดันขึ้นเมื่อสูงกว่า AI (W_HEUR_UP) และเป็นพื้นขั้นต่ำเมื่อมีหลักฐานแข็ง (floor)
const W_HEUR_UP = 0.35;
const CONTINUATION_KEEP = 0.85; // ข้อความที่พึ่งบริบท สืบทอด ≥ 85% ของงานก่อนหน้า
const INHERIT_KEEP = 0.92;      // "ทำต่อเลย" ล้วนๆ สืบทอด 92%

function combine({ llm = null, heur, dependsOnPrevious = false, prior = null }) {
    let c;
    if (llm === null) c = 0.6 * heur.score + 0.4 * 50;
    else c = llm + W_HEUR_UP * Math.max(0, heur.score - llm);
    c = Math.max(c, heur.floor);
    const continuing = Boolean(dependsOnPrevious && prior);
    if (heur.tinyCap !== null && !continuing) c = Math.min(c, heur.tinyCap);
    if (continuing) c = Math.max(c, prior.complexity * CONTINUATION_KEEP);
    return Math.max(0, Math.min(100, Math.round(c)));
}

function ageText(ms) {
    const m = Math.round(ms / 60000);
    return m < 60 ? `${m} นาทีที่แล้ว` : `${(m / 60).toFixed(1)} ชม.ที่แล้ว`;
}

/** "ทำต่อเลย" ล้วนๆ: สืบทอดจาก prior โดยไม่เรียก AI */
function inheritedClassification(prior, heur) {
    const type = prior.type === 'analysis' ? 'analysis' : 'code';
    const complexity = Math.round(prior.complexity * INHERIT_KEEP);
    const risk = Math.round(prior.risk || 0);
    const quality = heur.qualityLevel;
    return {
        type,
        complexity,
        risk,
        level: levelFromComplexity(complexity),
        needs_tools: type === 'code',
        parallelizable: false,
        subtasks: 0,
        tier: tierFromScores(type, complexity, risk, type === 'code', quality),
        reason: `ต่อเนื่องจากงานก่อนหน้า (ยาก ${prior.complexity}/100 · ${ageText(prior.ageMs)})`,
        quality_bar: quality,
        humanMinutes: null,
        llmComplexity: null,
        heuristic: { score: heur.score, floor: heur.floor, signals: heur.signals },
        rubric: null,
        continuation: { inherited: true, priorComplexity: prior.complexity },
        estimator: RUBRIC_VERSION
    };
}

/**
 * รวมทุกอย่างเป็นผลการจัดระดับสุดท้าย
 * @param {object} p
 * @param {object|null} p.rubric       ผลจาก normalizeRubric (null = AI ไม่ตอบ)
 * @param {object} p.heur              ผลจาก heuristics()
 * @param {object|null} p.prior        ผลจาก getPrior()
 * @param {string} [p.fallbackType]    ชนิดงานเมื่อ AI ไม่ตอบ
 */
function finalize({ rubric, heur, prior = null, fallbackType = 'chat' }) {
    const scored = rubric ? scoreRubric(rubric) : null;
    const type = rubric ? rubric.type : fallbackType;
    const depends = Boolean(rubric && rubric.dependsOnPrevious);
    let complexity = combine({ llm: scored ? scored.llm : null, heur, dependsOnPrevious: depends, prior });
    if (type === 'quick') complexity = Math.min(complexity, 20);

    const llmRisk = scored ? scored.risk100 : 30;
    const risk = Math.max(0, Math.min(100, Math.round(Math.max(llmRisk, heur.risk * 0.7))));
    const quality = Math.max(rubric && rubric.quality !== undefined ? rubric.quality : 0, heur.qualityLevel);
    const needsTools = rubric ? rubric.needsTools : type === 'code';
    const parallelizable = Boolean(rubric && rubric.parallel >= 2) && type !== 'quick';
    const continuationApplied = Boolean(depends && prior);

    return {
        type,
        complexity,
        risk,
        level: type === 'quick' ? 1 : levelFromComplexity(complexity),
        needs_tools: needsTools,
        parallelizable,
        subtasks: parallelizable ? clampInt(rubric.parallel, 2, 6, 2) : 0,
        tier: tierFromScores(type, complexity, risk, needsTools, quality),
        reason: rubric ? rubric.reason : 'ตัวคัดงานไม่ตอบ ใช้ตัวช่วยตรวจจากข้อความอย่างเดียว',
        quality_bar: quality,
        humanMinutes: rubric && rubric.humanMinutes ? rubric.humanMinutes : null,
        llmComplexity: scored ? scored.llm : null,
        heuristic: { score: heur.score, floor: heur.floor, signals: heur.signals },
        rubric: rubric && rubric.scope !== undefined
            ? { scope: rubric.scope, depth: rubric.depth, unknowns: rubric.unknowns, steps: rubric.steps, risk: rubric.risk, quality: rubric.quality, dimScore: scored.dimScore, timeScore: scored.timeScore }
            : null,
        continuation: { inherited: false, applied: continuationApplied, priorComplexity: prior ? prior.complexity : null },
        estimator: RUBRIC_VERSION
    };
}

function formatMinutes(min) {
    if (!min) return '';
    if (min < 60) return `${Math.round(min)} นาที`;
    const h = min / 60;
    return h < 10 ? `${h.toFixed(1)} ชม.` : `${Math.round(h)} ชม.`;
}

module.exports = {
    RUBRIC_VERSION,
    TIME_ANCHORS,
    scoreFromMinutes,
    tierFromScores,
    levelFromComplexity,
    heuristics,
    isPureContinuation,
    observedComplexity,
    noteRouted,
    noteObserved,
    getPrior,
    seedPrior,
    clearSessions,
    buildContextBlock,
    buildRubricPrompt,
    ANCHOR_EXAMPLES,
    normalizeRubric,
    parseRubric,
    scoreRubric,
    combine,
    inheritedClassification,
    finalize,
    formatMinutes,
    constants: { W_HEUR_UP, CONTINUATION_KEEP, INHERIT_KEEP, SESSION_TTL_MS }
};
