'use strict';
// รัน: node --test test/difficulty-estimator.test.js   (ไม่เรียก AI ไม่ใช้โควตา)
const test = require('node:test');
const assert = require('node:assert/strict');
const est = require('../difficulty-estimator');

test('scoreFromMinutes: monotonic and hits the anchors', () => {
    for (const [m, s] of est.TIME_ANCHORS) assert.equal(Math.round(est.scoreFromMinutes(m)), s, `anchor ${m}`);
    let prev = -1;
    for (const m of [0.5, 1, 2, 5, 10, 30, 60, 100, 240, 500, 1000, 5000]) {
        const v = est.scoreFromMinutes(m);
        assert.ok(v >= prev, `monotonic at ${m}`);
        prev = v;
    }
    assert.equal(est.scoreFromMinutes(0), null);
    assert.equal(est.scoreFromMinutes('x'), null);
});

test('tierFromScores: same bands as v3 when quality=0, quality bumps the tier', () => {
    assert.equal(est.tierFromScores('quick', 90, 90, true), 'low');
    assert.equal(est.tierFromScores('chat', 34, 0, false), 'low');
    assert.equal(est.tierFromScores('chat', 35, 0, false), 'medium');
    assert.equal(est.tierFromScores('chat', 59, 0, false), 'medium');
    assert.equal(est.tierFromScores('chat', 60, 0, false), 'high');
    assert.equal(est.tierFromScores('chat', 82, 0, false), 'xhigh');
    assert.equal(est.tierFromScores('code', 30, 0, true), 'medium');           // +5 tools
    assert.equal(est.tierFromScores('chat', 55, 0, false, 2), 'high');         // 55 + 6 = 61
    assert.equal(est.tierFromScores('chat', 55, 0, false, 0), 'medium');
});

test('heuristics: tiny messages are capped, big evidence sets a floor', () => {
    const hi = est.heuristics('สวัสดี');
    assert.equal(hi.tinyCap, 20);
    assert.ok(hi.score <= 25);

    const big = est.heuristics('แก้ ai-router.js, gemini-manager.js และ server.js ให้รองรับระบบใหม่ทั้งระบบ แล้วเขียนเทสต์ครอบคลุม');
    assert.ok(big.signals.fileRefs >= 3);
    assert.ok(big.floor >= 50);
    assert.equal(big.tinyCap, null);

    const list = est.heuristics('ทำตามนี้\n1) เพิ่มหน้า\n2) เพิ่ม API\n3) เพิ่ม config\n4) เขียนเอกสาร');
    assert.ok(list.signals.enumerations >= 4);
    assert.ok(list.floor >= 50);
});

test('heuristics: node.js is not a file, questions are damped, risk words counted', () => {
    assert.equal(est.heuristics('Node.js คืออะไร').signals.fileRefs, 0);
    const q = est.heuristics('อธิบายความต่างระหว่าง WireGuard กับ Tailscale แบบละเอียด');
    assert.equal(q.signals.questionOnly, true);
    assert.equal(q.qualityLevel, 1);
    const r = est.heuristics('restart แล้วลบฐานข้อมูล mongo บน production');
    assert.ok(r.signals.riskHits >= 3);
    assert.ok(r.risk >= 60);
});

test('heuristics: quality demand levels', () => {
    assert.equal(est.heuristics('ทำให้รอบคอบสุดๆ อย่าให้พลาด').qualityLevel, 2);
    assert.equal(est.heuristics('ช่วยดูให้ละเอียดหน่อย').qualityLevel, 1);
    assert.equal(est.heuristics('ช่วยดูหน่อย').qualityLevel, 0);
});

test('isPureContinuation: pure follow-ups yes, new content no', () => {
    for (const t of ['ทำต่อเลย', 'ลุยเลย', 'ได้เลย', 'โอเค', 'แนวทางที่ 1', 'ตามนั้นเลย', 'เริ่มได้เลยครับ', 'ok', 'go ahead', 'ทำต่อเลย!']) {
        assert.equal(est.isPureContinuation(t), true, t);
    }
    for (const t of ['ได้เลย ลบเลย', 'ครับ ช่วยแก้ server.js หน่อย', 'สวัสดี', 'ช่วยสร้างหน้าใหม่', 'ทำต่อเลยเอาให้จบทำให้รอบคอบหน่อยนะตรวจสอบดีๆอย่าให้พลาดรอบคอบสุดๆ', '']) {
        assert.equal(est.isPureContinuation(t), false, t);
    }
});

test('observedComplexity: steps and duration thresholds', () => {
    assert.equal(est.observedComplexity(0, 5000), 10);
    assert.equal(est.observedComplexity(2, 5000), 30);
    assert.equal(est.observedComplexity(8, 5000), 50);
    assert.equal(est.observedComplexity(20, 5000), 70);
    assert.equal(est.observedComplexity(40, 5000), 85);
    assert.equal(est.observedComplexity(0, 20 * 60e3), Math.round(85 * 0.9));
});

test('session memory: prior decays, observed work raises it, TTL expires', () => {
    est.clearSessions();
    const t0 = 1_000_000;
    assert.equal(est.getPrior('s1', t0), null);
    est.noteRouted('s1', { complexity: 80, risk: 20, type: 'code' }, t0);
    assert.equal(est.getPrior('s1', t0 + 1000).complexity, 80);
    est.noteRouted('s1', { complexity: 10, risk: 0, type: 'chat' }, t0 + 2000);
    // งานเล็กล่าสุดไม่ล้างงานใหญ่ก่อนหน้า: 80 × 0.92 = 74
    assert.equal(est.getPrior('s1', t0 + 3000).complexity, 74);
    assert.equal(est.getPrior('s1', t0 + 3000).type, 'code');
    // งานเล็กที่ใช้จริง 30 ขั้นตอน → ความยากที่สังเกตได้ 85 → prior ขึ้น
    est.noteObserved('s1', { steps: 30, durationMs: 10_000 });
    assert.equal(est.getPrior('s1', t0 + 4000).complexity, 85);
    assert.equal(est.getPrior('s1', t0 + est.constants.SESSION_TTL_MS + 5000), null);
    // ห้องอื่นไม่ปนกัน
    assert.equal(est.getPrior('other', t0), null);
});

test('parseRubric: valid dims, clamps, legacy format, garbage', () => {
    const ok = est.parseRubric('xx {"type":"code","scope":3,"depth":2,"unknowns":2,"steps":2,"risk":1,"quality_bar":0,"human_minutes":45,"parallel":0,"depends_on_previous":false,"needs_tools":true,"reason":"ทดสอบ"} yy');
    assert.equal(ok.type, 'code');
    assert.equal(ok.scope, 3);
    assert.equal(ok.humanMinutes, 45);
    assert.equal(ok.needsTools, true);

    const clamped = est.parseRubric('{"type":"code","scope":9,"depth":-3,"unknowns":"2","steps":2.6,"risk":7,"quality_bar":5,"human_minutes":99999}');
    assert.equal(clamped.scope, 4);
    assert.equal(clamped.depth, 0);
    assert.equal(clamped.unknowns, 2);
    assert.equal(clamped.steps, 3);
    assert.equal(clamped.risk, 4);
    assert.equal(clamped.quality, 2);
    assert.equal(clamped.humanMinutes, 5000);

    const legacy = est.parseRubric('{"type":"analysis","complexity":70,"risk":40,"needs_tools":true,"parallelizable":true,"subtasks":3,"reason":"x"}');
    assert.equal(legacy.legacyComplexity, 70);
    assert.equal(legacy.legacyRisk, 40);
    assert.equal(est.scoreRubric(legacy).llm, 70);

    assert.equal(est.parseRubric('ไม่ใช่ json'), null);
    assert.equal(est.parseRubric('{"type":"banana","scope":1}'), null);
    assert.equal(est.parseRubric('{"type":"code"}'), null);
});

test('scoreRubric: anchor examples land in the intended bands', () => {
    const bands = [[0, 12], [15, 30], [45, 65], [40, 58], [70, 88], [82, 98]];
    est.ANCHOR_EXAMPLES.forEach(([task, scored], i) => {
        const r = est.normalizeRubric(scored);
        const v = est.scoreRubric(r).llm;
        assert.ok(v >= bands[i][0] && v <= bands[i][1], `anchor ${i} "${task}" scored ${v}, expected ${bands[i]}`);
    });
});

test('combine: asymmetric pull, floors, tiny cap, continuation', () => {
    const quiet = { score: 10, floor: 0, tinyCap: null };
    // ตัวช่วยตรวจที่ต่ำกว่า AI ต้องไม่ดึงคะแนนของ AI ลง (สเกลคนละแบบ — ดูหมายเหตุใน difficulty-estimator.js)
    assert.equal(est.combine({ llm: 80, heur: quiet }), 80);
    // ...แต่ถ้าสูงกว่า AI ดันขึ้นบางส่วน: 40 + 0.35×(80-40) = 54
    assert.equal(est.combine({ llm: 40, heur: { score: 80, floor: 0, tinyCap: null } }), 54);
    // หลักฐานแข็งดันขึ้น
    assert.equal(est.combine({ llm: 25, heur: { score: 30, floor: 60, tinyCap: null } }), 60);
    // tiny cap
    assert.equal(est.combine({ llm: 50, heur: { score: 5, floor: 0, tinyCap: 20 } }), 20);
    // ...แต่ไม่ใช้ตอนเป็นข้อความต่อเนื่องที่มี prior
    assert.ok(est.combine({ llm: 10, heur: { score: 5, floor: 0, tinyCap: 20 }, dependsOnPrevious: true, prior: { complexity: 80 } }) >= 68);
    // ต่อเนื่องแต่ prior เล็ก → ไม่ดันขึ้น
    assert.ok(est.combine({ llm: 20, heur: quiet, dependsOnPrevious: true, prior: { complexity: 25 } }) <= 22);
    // AI ไม่ตอบ
    assert.ok(est.combine({ llm: null, heur: { score: 60, floor: 0, tinyCap: null } }) >= 50);
});

test('finalize + inheritedClassification: fields stay compatible with the router', () => {
    const heur = est.heuristics('ต่อเลย');
    const prior = { complexity: 80, risk: 25, type: 'code', ageMs: 5 * 60e3 };
    const inh = est.inheritedClassification(prior, heur);
    assert.equal(inh.complexity, 74);
    assert.equal(inh.type, 'code');
    assert.equal(inh.continuation.inherited, true);
    for (const k of ['type', 'complexity', 'risk', 'level', 'needs_tools', 'parallelizable', 'subtasks', 'tier', 'reason']) assert.ok(k in inh, k);
    // 74 + risk 25×0.25 + 5 (code+tools) = 85.25 → xhigh ตามเกณฑ์เดิมของ v3
    assert.equal(inh.tier, 'xhigh');

    const rubric = est.normalizeRubric({ type: 'code', scope: 1, depth: 1, unknowns: 1, steps: 1, risk: 0, quality_bar: 2, human_minutes: 5, parallel: 0, depends_on_previous: true, needs_tools: true, reason: 'x' });
    const cont = est.finalize({ rubric, heur: est.heuristics('ทำต่อเลยรอบคอบสุดๆ'), prior });
    assert.ok(cont.complexity >= 68, `continuation floor, got ${cont.complexity}`);
    assert.equal(cont.continuation.applied, true);
    assert.equal(cont.quality_bar, 2);

    const quick = est.finalize({ rubric: est.normalizeRubric({ type: 'quick', scope: 4, depth: 4, unknowns: 4, steps: 4, human_minutes: 900, risk: 0 }), heur: est.heuristics('สถานะ') });
    assert.ok(quick.complexity <= 20);
    assert.equal(quick.tier, 'low');
    assert.equal(quick.parallelizable, false);

    const fb = est.finalize({ rubric: null, heur: est.heuristics('แก้ server.js'), fallbackType: 'code' });
    assert.equal(fb.type, 'code');
    assert.equal(fb.llmComplexity, null);
});

test('buildContextBlock / buildRubricPrompt', () => {
    const hist = [
        { role: 'user', content: 'ช่วยสร้างหน้า energy' },
        { role: 'assistant', content: '> 🧠 Auto → **X** · Google#1\n\nได้ค่ะ เสนอ 2 แบบ ต้องการแบบไหนคะ' }
    ];
    const ctx = est.buildContextBlock(hist, { observed: { steps: 14, durationMs: 9 * 60000 } });
    assert.ok(ctx.includes('User: ช่วยสร้างหน้า energy'));
    assert.ok(!ctx.includes('🧠 Auto'), 'router banner must be stripped');
    assert.ok(ctx.includes('14 tool steps'));
    assert.equal(est.buildContextBlock([], null), '');
    const p = est.buildRubricPrompt('ทำต่อเลย', ctx);
    assert.ok(p.includes('CONVERSATION SO FAR'));
    assert.ok(p.includes('depends_on_previous'));
    assert.ok(est.buildRubricPrompt('x', '').indexOf('CONVERSATION SO FAR') === -1);
});
