'use strict';
// ทดสอบส่วนเชื่อมของ ai-router ที่ไม่ต้องเรียก AI:  node --test test/difficulty-router-glue.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
// เขียนผลทดสอบลงไฟล์ชั่วคราว ไม่ปนกับข้อมูลสอบเทียบจริงของระบบ
process.env.AI_ROUTER_OUTCOMES_FILE = require('node:path').join(require('node:os').tmpdir(), `ai-router-outcomes-test-${process.pid}.jsonl`);
const router = require('../ai-router');
const est = require('../difficulty-estimator');

test('isShortcutText: greetings always, short text only without history', () => {
    assert.equal(router.isShortcutText('สวัสดีครับ', false), true);
    assert.equal(router.isShortcutText('สวัสดีครับ', true), true);
    assert.equal(router.isShortcutText('ขอบคุณมากครับ', true), true);
    assert.equal(router.isShortcutText('สถานะ pm2', false), false, 'มีคำเกี่ยวกับโค้ด/ระบบ → ไม่ลัด');
    assert.equal(router.isShortcutText('ลองดูหน่อย', false), true);
    // ห้องที่มีประวัติ: ข้อความสั้นที่ไม่ใช่ทักทายต้องผ่านตัวคัดงานพร้อมบริบท
    assert.equal(router.isShortcutText('เอาแบบที่ 2 เลยครับ', true), false);
    assert.equal(router.isShortcutText('เอาแบบที่ 2 เลยครับ', false), true);
    assert.equal(router.isShortcutText('ได้เลย ลบเลย', true), false);
});

test('classifyTask: pure continuation inherits the prior without calling the model', async () => {
    est.clearSessions();
    est.seedPrior('glue-1', [{ at: Date.now(), complexity: 80, risk: 25, type: 'code', effective: 80, observed: null }]);
    const t0 = Date.now();
    const cls = await router.classifyTask('ทำต่อเลย', { sessionId: 'glue-1', history: [{ role: 'user', content: 'x' }] });
    assert.ok(Date.now() - t0 < 500, 'ต้องไม่เรียก AI');
    assert.equal(cls.source, 'continuation');
    assert.equal(cls.complexity, 74);
    assert.equal(cls.continuation.inherited, true);
    assert.equal(cls.type, 'code');
});

test('classifyTask: continuation without a meaningful prior falls through to the shortcut', async () => {
    est.clearSessions();
    est.seedPrior('glue-2', [{ at: Date.now(), complexity: 12, risk: 0, type: 'chat', effective: 12, observed: null }]);
    const cls = await router.classifyTask('ทำต่อเลย', { sessionId: 'glue-2' });
    assert.equal(cls.source, 'shortcut');
    assert.ok(cls.complexity <= 20);
});

test('noteOutcome feeds the next continuation (observed work raises the prior)', () => {
    est.clearSessions();
    const decision = { classification: { type: 'code', tier: 'low', complexity: 25, risk: 0, source: 'classifier' }, promptSnippet: 'x' };
    est.noteRouted('glue-3', decision.classification);
    const entry = router.noteOutcome({ sessionId: 'glue-3', decision, steps: 30, durationMs: 600000, ok: true, model: 'm', account: 'a' });
    assert.equal(entry.observed.complexity, 85);
    assert.equal(est.getPrior('glue-3').complexity, 85);
    // งานที่ถูกยกเลิก/ไม่ได้ทำงานจริงไม่นับเป็นความยากที่สังเกตได้
    est.clearSessions();
    est.noteRouted('glue-4', decision.classification);
    const e2 = router.noteOutcome({ sessionId: 'glue-4', decision, steps: 0, durationMs: 2000, ok: false, aborted: true });
    assert.equal(e2.observed.counted, false);
    assert.equal(est.getPrior('glue-4').complexity, 25);
});

test('formatBanner shows human time and continuation marker', () => {
    const decision = { classification: { type: 'code', complexity: 74, tier: 'high', humanMinutes: 240, reason: 'x', continuation: { inherited: true } }, overrides: {} };
    const c = { label: 'M', accountLabel: 'G1', remainingPct: 90, budget: { mode: 'normal', windows: [] }, model: 'm' };
    const b = router.formatBanner(decision, c);
    assert.ok(b.includes('ยาก 74/100 (≈4.0 ชม.) ↩ต่อเนื่อง'), b);
});
