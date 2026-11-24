'use strict';
// ทดสอบ Pareto / Standby:  node --test test/model-pareto.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../public/model-pareto');

const mk = (id, pool, cost, q, extra = {}) => ({
    id, engine: 'agy', status: 'active', confidence: 98, source: 'builtin',
    suggested: { pool, cost, q: { code: q[0], analysis: q[1], chat: q[2] } }, ...extra
});

test('แพงกว่าและแพ้ทุกด้านในถังเดียวกัน → standby พร้อมบอกตัวที่กลบ', () => {
    const p = P.computePareto([
        mk('cheap-smart', 'gemini', 1, [90, 90, 90]),
        mk('pricey-dumb', 'gemini', 2, [80, 80, 80])
    ]);
    assert.equal(p['cheap-smart'].tier, 'frontier');
    assert.equal(p['pricey-dumb'].tier, 'standby');
    assert.equal(p['pricey-dumb'].dominatedBy.code, 'cheap-smart');
    assert.deepEqual([...P.standbyIdsFor(p, 'code')], ['pricey-dumb']);
});

test('ยังชนะบางด้าน → standby เฉพาะด้านที่แพ้', () => {
    const p = P.computePareto([
        mk('a', 'claude', 1, [90, 90, 90]),
        mk('b', 'claude', 2, [97, 85, 85])
    ]);
    assert.equal(p.b.tier, 'partial');
    assert.deepEqual(p.b.standbyTypes, ['analysis', 'chat']);
    assert.equal(P.standbyIdsFor(p, 'code').has('b'), false);
    assert.equal(P.standbyIdsFor(p, 'chat').has('b'), true);
});

test('แพ้ข้ามถังเท่านั้น → separate-pool ไม่ถูกลด', () => {
    const p = P.computePareto([
        mk('neon', 'gemini', 1, [95, 95, 95]),
        mk('argon', 'argon', 2, [85, 85, 85])
    ]);
    assert.equal(p.argon.tier, 'separate-pool');
    assert.equal(P.standbyIdsFor(p, 'code').size, 0);
});

test('ตัวกลบที่ความมั่นใจต่ำ (<76) กลบใครไม่ได้', () => {
    const p = P.computePareto([
        mk('unverified', 'gemini', 1, [99, 99, 99], { confidence: 13 }),
        mk('verified', 'gemini', 2, [90, 90, 90])
    ]);
    assert.equal(p.verified.tier, 'frontier');
});

test('Orchestrator เทียบกันเอง · DeepSeek และโมเดลที่ไม่ active อยู่นอกการคำนวณ', () => {
    const p = P.computePareto([
        mk('gemini-4-carbon-high', 'gemini', 1, [99, 99, 99]),
        mk('gemini-pro-orchestrator-neon', 'gemini', 2, [90, 90, 90]),
        { ...mk('deepseek-flash', 'deepseek', 5, [10, 10, 10]), engine: 'deepseek' },
        mk('off', 'gemini', 5, [10, 10, 10], { status: 'disabled' })
    ]);
    assert.equal(p['gemini-pro-orchestrator-neon'].tier, 'frontier');
    assert.equal(p['deepseek-flash'].tier, 'outside');
    assert.equal(p.off.tier, 'outside');
});

test('ใช้ผลวิจัย (effectiveQ/effectiveCost) ก่อนค่าแนะนำ · ราคาและคะแนนเท่ากัน → ไม่มีใครถูกกลบ', () => {
    const a = mk('a', 'gemini', 1, [90, 90, 90]);
    const b = mk('b', 'gemini', 3, [50, 50, 50], { research: { effectiveQ: { code: 90, analysis: 90, chat: 90 }, pricing: { effectiveCost: 1 } } });
    const p = P.computePareto([a, b]);
    assert.equal(p.a.tier, 'frontier');
    assert.equal(p.b.tier, 'frontier');
});
