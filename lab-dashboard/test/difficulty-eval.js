#!/usr/bin/env node
'use strict';

/**
 * วัดความแม่นของตัวประเมินความยาก (เรียกตัวคัดงานจริง = ใช้โควตา Flash เล็กน้อย)
 *
 *   # เก็บโค้ดเก่าไว้เทียบ (ก่อนแก้ v4):
 *   git -C ../homelab-server show <commit>:lab-dashboard/ai-router.js > /tmp/ai-router-old.js
 *
 *   node test/difficulty-eval.js run --engine old --out /tmp/e_old1.json
 *   node test/difficulty-eval.js run --engine new --out /tmp/e_new1.json [--concurrency 3] [--only c01,c02]
 *   CASES=test/difficulty-holdout2.json node test/difficulty-eval.js run --engine new --out /tmp/h2_new.json   # ชุดล็อกเฉลย ใช้ตัดสินครั้งเดียว
 *   AI_ROUTER_CLASSIFIER_MODEL=gemini-3.8-flash-medium node test/difficulty-eval.js run --engine new --out /tmp/e_newM.json
 *
 *   # รายงาน (ต่อกลุ่ม: label=ไฟล์รอบที่1,ไฟล์รอบที่2 — ใส่ 2 รอบเพื่อวัดความแกว่งระหว่างรอบ):
 *   node test/difficulty-eval.js report old=/tmp/e_old1.json,/tmp/e_old2.json new=/tmp/e_new1.json,/tmp/e_new2.json
 *
 * แต่ละ run เป็น process ใหม่ → cache ว่างเสมอ (รอบที่ 2 จึงไม่ได้ผลจาก cache)
 */

const fs = require('fs');
const path = require('path');

const CASES_FILE = path.resolve(process.env.CASES || path.join(__dirname, 'difficulty-cases.json'));
const OLD_MODULE = process.env.OLD_ROUTER || '/tmp/ai-router-old.js';

function loadCases(only) {
    const data = JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'));
    let cases = data.cases;
    if (only) {
        const ids = new Set(only.split(',').map((x) => x.trim()));
        cases = cases.filter((c) => ids.has(c.id));
    }
    return { cases, contexts: data.contexts };
}

function arg(name, dflt = null) {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

async function pool(items, size, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i], i);
        }
    }));
    return out;
}

async function run() {
    const engine = arg('engine', 'new');
    const outFile = arg('out');
    const concurrency = parseInt(arg('concurrency', '3'), 10);
    const { cases, contexts } = loadCases(arg('only'));
    let mod;
    let est = null;
    if (engine === 'old') {
        if (!fs.existsSync(OLD_MODULE)) throw new Error(`ไม่พบ ${OLD_MODULE} — สร้างด้วย git show ตามคำอธิบายหัวไฟล์`);
        mod = require(OLD_MODULE);
    } else {
        mod = require('../ai-router');
        est = require('../difficulty-estimator');
    }
    console.error(`[eval] engine=${engine} model=${process.env.AI_ROUTER_CLASSIFIER_MODEL || 'gemini-3.8-flash-low'} cases=${cases.length} concurrency=${concurrency}`);

    const t0 = Date.now();
    const results = await pool(cases, concurrency, async (c) => {
        const sid = `eval-${c.id}-${Date.now()}`;
        const history = c.history ? contexts[c.history] : [];
        if (est && c.prior) {
            est.seedPrior(sid, [{ at: Date.now(), complexity: c.prior.complexity, risk: c.prior.risk || 0, type: c.prior.type || 'code', effective: c.prior.complexity, observed: null }]);
        }
        const s = Date.now();
        let cls;
        try {
            cls = engine === 'old' ? await mod.classifyTask(c.prompt) : await mod.classifyTask(c.prompt, { history, sessionId: sid, noCache: true });
        } catch (e) {
            cls = { complexity: null, tier: null, type: null, source: 'error', reason: String(e.message || e) };
        }
        const r = {
            id: c.id, set: c.set || 'dev', headline: Boolean(c.headline), expect: c.expect,
            complexity: cls.complexity, tier: cls.tier, type: cls.type, source: cls.source,
            llm: cls.llmComplexity === undefined ? null : cls.llmComplexity,
            heur: cls.heuristic ? cls.heuristic.score : null,
            humanMinutes: cls.humanMinutes || null,
            continuation: cls.continuation ? (cls.continuation.inherited ? 'inherited' : (cls.continuation.applied ? 'applied' : '')) : '',
            parallelizable: Boolean(cls.parallelizable), parallelExpected: Boolean(c.parallel),
            ms: Date.now() - s
        };
        console.error(`[eval] ${c.id} ${String(r.complexity).padStart(3)} ${String(r.tier).padEnd(6)} ${r.source.padEnd(12)} ${r.ms}ms  want ${c.expect[0]}-${c.expect[1]}`);
        return r;
    });
    const payload = { engine, model: process.env.AI_ROUTER_CLASSIFIER_MODEL || 'gemini-3.8-flash-low', at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), results };
    if (outFile) fs.writeFileSync(outFile, JSON.stringify(payload, null, 1));
    else console.log(JSON.stringify(payload, null, 1));
    console.error(`[eval] done in ${payload.seconds}s${outFile ? ` → ${outFile}` : ''}`);
    process.exit(0);
}

function dist(r) {
    if (r.complexity === null) return null;
    if (r.complexity < r.expect[0]) return r.expect[0] - r.complexity;
    if (r.complexity > r.expect[1]) return r.complexity - r.expect[1];
    return 0;
}

function metrics(rows) {
    const valid = rows.filter((r) => r.complexity !== null);
    const n = valid.length;
    const inRange = valid.filter((r) => dist(r) === 0).length;
    const under = valid.filter((r) => r.complexity < r.expect[0]).length;
    const over = valid.filter((r) => r.complexity > r.expect[1]).length;
    const meanDist = n ? valid.reduce((a, r) => a + dist(r), 0) / n : null;
    const heads = valid.filter((r) => r.headline);
    const llmCalls = valid.filter((r) => ['classifier', 'cache'].includes(r.source));
    const meanMs = llmCalls.length ? Math.round(llmCalls.reduce((a, r) => a + r.ms, 0) / llmCalls.length) : null;
    return {
        n, inRange, inRangePct: n ? Math.round((inRange / n) * 100) : null, under, over,
        meanDist: meanDist === null ? null : Number(meanDist.toFixed(1)),
        headlinePass: heads.filter((r) => dist(r) === 0).length, headlineN: heads.length, meanLlmMs: meanMs
    };
}

function report() {
    const groups = process.argv.slice(3).map((a) => {
        const [label, files] = a.includes('=') ? a.split('=') : [path.basename(a), a];
        return { label, runs: files.split(',').map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))) };
    });
    const line = (cols) => cols.map((c, i) => String(c).padEnd(i === 0 ? 22 : 12)).join('');
    console.log(line(['กลุ่ม / รอบ', 'in-range', 'ต่ำเกิน', 'สูงเกิน', 'ห่างเฉลี่ย', 'headline', 'ms/AI']));
    for (const g of groups) {
        g.runs.forEach((run, i) => {
            for (const [name, filter] of [['ทั้งหมด', () => true], ['dev', (r) => r.set === 'dev'], ['holdout', (r) => r.set === 'holdout']]) {
                const m = metrics(run.results.filter(filter));
                console.log(line([`${g.label}#${i + 1} ${name}`, `${m.inRange}/${m.n} (${m.inRangePct}%)`, m.under, m.over, m.meanDist, m.headlineN ? `${m.headlinePass}/${m.headlineN}` : '-', m.meanLlmMs === null ? '-' : m.meanLlmMs]));
            }
        });
        if (g.runs.length >= 2) {
            const a = new Map(g.runs[0].results.map((r) => [r.id, r]));
            const diffs = g.runs[1].results.filter((r) => a.has(r.id) && r.complexity !== null && a.get(r.id).complexity !== null)
                .map((r) => ({ id: r.id, d: Math.abs(r.complexity - a.get(r.id).complexity), tierSame: r.tier === a.get(r.id).tier }));
            const mean = diffs.reduce((x, y) => x + y.d, 0) / (diffs.length || 1);
            const tierStable = diffs.filter((d) => d.tierSame).length;
            const worst = [...diffs].sort((x, y) => y.d - x.d).slice(0, 3).map((d) => `${d.id}:${d.d}`).join(' ');
            console.log(`  ↳ ${g.label} ความแกว่งระหว่างรอบ: ต่างกันเฉลี่ย ${mean.toFixed(1)} คะแนน · ระดับเดิม ${tierStable}/${diffs.length} · แกว่งสุด ${worst}`);
        }
        console.log('');
    }
    // ตารางรายข้อ (รอบแรกของแต่ละกลุ่ม)
    const ids = groups[0].runs[0].results.map((r) => r.id);
    console.log(line(['id (เฉลย)', ...groups.map((g) => g.label)]));
    for (const id of ids) {
        const base = groups[0].runs[0].results.find((r) => r.id === id);
        const cells = groups.map((g) => {
            const r = g.runs[0].results.find((x) => x.id === id);
            if (!r || r.complexity === null) return 'ERR';
            return `${r.complexity}${dist(r) === 0 ? '✓' : (r.complexity < r.expect[0] ? '↓' : '↑')}${r.tier ? '/' + r.tier[0] : ''}`;
        });
        console.log(line([`${id} ${base.expect[0]}-${base.expect[1]}${base.headline ? ' ★' : ''}${base.set === 'holdout' ? ' H' : ''}`, ...cells]));
    }
}

if (process.argv[2] === 'run') run().catch((e) => { console.error(e); process.exit(1); });
else if (process.argv[2] === 'report') report();
else console.error('usage: difficulty-eval.js run --engine old|new [--out f] | report label=f1,f2 ...');
