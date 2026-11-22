'use strict';
// ทดสอบตรรกะจัดคิว Worker (ข้ามข้อที่พึ่งข้อที่ล้มเป็นทอด + ส่งสถานะให้ Reviewer) โดยไม่เรียก AI จริง:
//   node --test test/cross-team-wave.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-team-wave-'));
process.env.AI_ROUTER_OUTCOMES_FILE = path.join(tmp, 'outcomes.jsonl');

const ct = require('../cross-team-orchestrator');

const makeAbortCtx = () => ({
    aborted: false,
    register() {},
    unregister() {},
    registerHandle() {},
    unregisterHandle() {}
});

const buildFakeWorkers = async () => ([
    { model: 'gemini-4-neon-high', account: 'g1', label: 'Gemini 4 Neon (High)', accountLabel: 'Google#1', engine: 'agy' }
]);

const makeWaveOpts = (overrides = {}) => ({
    plan: { summary: 'test plan', architecture_notes: '', acceptance_criteria: [] },
    originalPrompt: 'x',
    imagePaths: [],
    cwd: tmp,
    mode: 'exec',
    decision: null,
    workerAccounts: [{ account: 'g1', score: 1 }],
    maxParallelWorkers: 1,
    onThoughtEvent: () => {},
    abortCtx: makeAbortCtx(),
    claimedBrains: new Set(),
    buildWorkersFn: buildFakeWorkers,
    ...overrides
});

test('t1 ล้ม → t2 (depends t1) และ t3 (depends t2) ถูก skipped เป็นทอดโดยไม่เรียก runner ซ้ำ', async () => {
    const called = [];
    const events = [];
    // ตั้งใจวาง t3 ไว้หน้า t2 เพื่อยืนยันว่าลูปข้ามเป็นทอดไม่ขึ้นกับลำดับในอาร์เรย์และไม่ติด safety valve
    const tasks = [
        { id: 't1', title: 'เขียนคอมโพเนนต์', model: 'neon', access: 'write', files: [path.join(tmp, 'a.tsx')], depends_on: [], instructions: 'write a.tsx' },
        { id: 't3', title: 'QA และพรีวิว', model: 'flash', access: 'read', files: [path.join(tmp, 'out.mp4')], depends_on: ['t2'], instructions: 'qa' },
        { id: 't2', title: 'เรนเดอร์คลิป', model: 'hydrogen', access: 'write', files: [path.join(tmp, 'out.mp4')], depends_on: ['t1'], instructions: 'render' }
    ];

    const runner = async (_c, o) => {
        const m = o.rolePrefix.match(/Worker\[([^\]]+)\]/);
        const id = m ? m[1] : 'unknown';
        called.push(id);
        return { ok: false, output: 'partial output', error: 'timeout (idle 600s)', stepsCount: 3 };
    };

    const { results } = await ct.runWorkerWave(tasks, makeWaveOpts({
        onThoughtEvent: (kind, text) => events.push({ kind, text }),
        runner
    }));

    assert.deepEqual(called, ['t1'], 'runner ต้องถูกเรียกเฉพาะ t1 เท่านั้น ห้ามเรียก t2/t3');

    const byId = new Map(results.map((r) => [r.task.id, r]));
    assert.equal(results.length, 3);

    const r1 = byId.get('t1');
    assert.equal(r1.ok, false);
    assert.equal(r1.skipped, false);
    assert.match(r1.error, /timeout \(idle 600s\)/);

    const r2 = byId.get('t2');
    assert.equal(r2.ok, false);
    assert.equal(r2.skipped, true);
    assert.equal(r2.aborted, false);
    assert.equal(r2.output, '');
    assert.equal(r2.candidate, null);
    assert.deepEqual(r2.tried, []);
    assert.equal(r2.stepsCount, 0);
    assert.equal(r2.durationMs, 0);
    assert.match(r2.error, /ข้ามเพราะข้อ t1 ไม่สำเร็จ/);

    const r3 = byId.get('t3');
    assert.equal(r3.ok, false);
    assert.equal(r3.skipped, true);
    assert.equal(r3.candidate, null);
    assert.match(r3.error, /ข้ามเพราะข้อ t2 ไม่สำเร็จ/);

    assert.ok(events.some((e) => e.kind === 'status' && e.text.includes('⏭️ Worker[t2]') && e.text.includes('t1')));
    assert.ok(events.some((e) => e.kind === 'status' && e.text.includes('⏭️ Worker[t3]') && e.text.includes('t2')));
});

test('t1 สำเร็จ → t2 (depends t1) รันตามปกติ', async () => {
    const called = [];
    const tasks = [
        { id: 't1', title: 'ขั้นที่ 1', model: 'neon', access: 'write', files: [path.join(tmp, 'f1.js')], depends_on: [], instructions: 'step 1' },
        { id: 't2', title: 'ขั้นที่ 2', model: 'hydrogen', access: 'write', files: [path.join(tmp, 'f2.js')], depends_on: ['t1'], instructions: 'step 2' }
    ];

    const runner = async (_c, o) => {
        const id = o.rolePrefix.match(/Worker\[([^\]]+)\]/)[1];
        called.push(id);
        return { ok: true, output: `done ${id}`, stepsCount: 1 };
    };

    const { results } = await ct.runWorkerWave(tasks, makeWaveOpts({ runner }));
    assert.deepEqual(called, ['t1', 't2']);
    assert.equal(results.length, 2);
    assert.equal(results[0].ok, true);
    assert.equal(results[0].skipped, false);
    assert.equal(results[1].ok, true);
    assert.equal(results[1].skipped, false);
});

test('ข้อที่อิสระยังรันได้ตามปกติแม้มีข้ออื่นล้ม และข้อที่พึ่งหลายตัวจะถูกข้ามเฉพาะเมื่อ dep ครบและมีตัวล้ม', async () => {
    const called = [];
    const tasks = [
        { id: 't1', title: 'งานล้ม', model: 'neon', access: 'write', files: [path.join(tmp, 'x1.js')], depends_on: [], instructions: 'fail' },
        { id: 't2', title: 'พึ่ง t1', model: 'hydrogen', access: 'write', files: [path.join(tmp, 'x2.js')], depends_on: ['t1'], instructions: 'dep t1' },
        { id: 't3', title: 'งานอิสระ', model: 'flash', access: 'read', files: [path.join(tmp, 'x3.js')], depends_on: [], instructions: 'indep' },
        { id: 't4', title: 'พึ่งทั้ง t1 และ t3', model: 'neon', access: 'write', files: [path.join(tmp, 'x4.js')], depends_on: ['t1', 't3'], instructions: 'dep both' }
    ];

    const runner = async (_c, o) => {
        const id = o.rolePrefix.match(/Worker\[([^\]]+)\]/)[1];
        called.push(id);
        if (id === 't1') {
            return { ok: false, output: 'failed mid-way', error: 'timeout (hard 1800s)', stepsCount: 2 };
        }
        await new Promise((r) => setTimeout(r, 20));
        return { ok: true, output: `ok ${id}`, stepsCount: 1 };
    };

    const { results } = await ct.runWorkerWave(tasks, makeWaveOpts({
        workerAccounts: [{ account: 'g1', score: 2 }, { account: 'g2', score: 1 }],
        maxParallelWorkers: 2,
        runner
    }));

    assert.deepEqual([...called].sort(), ['t1', 't3'], 'ต้องรันเฉพาะ t1 และ t3 ห้ามรัน t2/t4');
    const byId = new Map(results.map((r) => [r.task.id, r]));
    assert.equal(byId.get('t1').ok, false);
    assert.equal(byId.get('t1').skipped, false);
    assert.equal(byId.get('t2').skipped, true);
    assert.equal(byId.get('t3').ok, true);
    assert.equal(byId.get('t3').skipped, false);
    assert.equal(byId.get('t4').skipped, true);
    assert.match(byId.get('t4').error, /ข้ามเพราะข้อ t1 ไม่สำเร็จ/);
});

test('buildReviewerPrompt ส่งสถานะ ok/skipped/stepsCount/durationMs/error และกฎ rework ต่อจากจุดที่ค้าง', () => {
    const prompt = ct.buildReviewerPrompt({
        originalPrompt: 'สร้างคลิปทดสอบ',
        history: [],
        plan: { summary: 'แผนทดสอบ', acceptance_criteria: ['มีไฟล์คลิปสมบูรณ์'] },
        workerResults: [
            {
                task: { id: 't1', title: 'เขียนสคริปต์', model: 'neon', access: 'write', files: ['/tmp/a.tsx'] },
                ok: true,
                skipped: false,
                output: 'เขียนเสร็จแล้ว',
                error: null,
                candidate: { label: 'Gemini 4 Neon (High)', accountLabel: 'Google#1' },
                stepsCount: 4,
                durationMs: 12300
            },
            {
                task: { id: 't2', title: 'เรนเดอร์', model: 'hydrogen', access: 'write', files: ['/tmp/out.mp4'] },
                ok: false,
                skipped: false,
                output: '',
                error: 'Gemini 4 Hydrogen (High) หยุดกลางทางหลังใช้เครื่องมือไป 7 ขั้น (timeout (idle 600s))',
                candidate: { label: 'Gemini 4 Hydrogen (High)', accountLabel: 'Google#2' },
                stepsCount: 7,
                durationMs: 605000
            },
            {
                task: { id: 't3', title: 'พรีวิว QA', model: 'flash', access: 'read', files: ['/tmp/out.mp4'] },
                ok: false,
                skipped: true,
                output: '',
                error: 'ข้ามเพราะข้อ t2 ไม่สำเร็จ',
                candidate: null,
                stepsCount: 0,
                durationMs: 0
            }
        ],
        changesSummary: 'git status: clean',
        cwd: tmp,
        mode: 'exec',
        reworkRound: 0
    });

    assert.match(prompt, /ok=true · skipped=false · stepsCount=4 · durationMs=12300/);
    assert.match(prompt, /ok=false · skipped=false · stepsCount=7 · durationMs=605000 · error=.*timeout \(idle 600s\)/);
    assert.match(prompt, /ok=false · skipped=true · stepsCount=0 · durationMs=0 · error=ข้ามเพราะข้อ t2 ไม่สำเร็จ/);
    assert.match(prompt, /⏭️ ถูกข้าม/);
    assert.match(prompt, /rework_tasks/);
    assert.match(prompt, /ต่อจากจุดที่ค้าง/);
});

test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
