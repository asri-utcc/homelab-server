'use strict';
// ทดสอบตัวจับเวลาของด่านทีมข้ามค่าย (ไม่เรียก AI ไม่ใช้โควตา):  node --test test/cross-team-watchdog.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// agy ปลอม: พฤติกรรมเลือกด้วย FAKE_MODE ตอนรัน (ต้องตั้ง AGY_BIN ก่อน require เพราะโมดูลอ่านตอนโหลด)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-agy-'));
const fake = path.join(tmp, 'agy');
fs.writeFileSync(fake, `#!/bin/bash
case "$FAKE_MODE" in
  chatty)  for i in 1 2 3 4 5 6 7 8 9 10; do echo "ขั้นตอน $i"; sleep 0.2; done; echo '{"direct_answer":false,"tasks":[]}'; exit 0 ;;
  silent)  exec sleep 4 ;;
  forever) while true; do echo tick; sleep 0.2; done ;;
  busy-child) python3 -c "import time; t=time.time()
while time.time()-t<2.5: pass"; echo '{"direct_answer":false,"tasks":[]}'; exit 0 ;;
  idle-child) sleep 2.789; echo '{"direct_answer":false,"tasks":[]}'; exit 0 ;;
esac
`, { mode: 0o755 });
process.env.AGY_BIN = fake;
process.env.CROSS_TEAM_CPU_SAMPLE_MS = '200'; // ทดสอบเร็ว (ใช้จริง 5 วินาที)
process.env.AI_ROUTER_OUTCOMES_FILE = path.join(tmp, 'outcomes.jsonl');
const ct = require('../cross-team-orchestrator');

const abortCtx = { aborted: false, register() {}, unregister() {}, registerHandle() {}, unregisterHandle() {} };
const run = (mode, opts) => {
    process.env.FAKE_MODE = mode;
    const t0 = Date.now();
    return ct.runAgySubprocess({ engine: 'agy', model: 'm', home: tmp }, { prompt: 'x', cwd: tmp, readOnly: true, mode: 'chat', onThoughtEvent() {}, abortCtx, claimedBrains: new Set(), ...opts })
        .then((r) => ({ ...r, ms: Date.now() - t0 }));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('makeWatchdog: idle fires without touch, touch extends it, stop cancels', async () => {
    const fired = [];
    const wd = ct.makeWatchdog({ hardMs: 2000, idleMs: 150, onFire: (f) => fired.push(f.kind) });
    await sleep(100); wd.touch();
    await sleep(100); wd.touch();
    await sleep(100);
    assert.deepEqual(fired, [], 'ยังมีความคืบหน้า ต้องไม่ยิง');
    await sleep(120);
    assert.deepEqual(fired, ['idle']);

    const fired2 = [];
    const wd2 = ct.makeWatchdog({ hardMs: 150, idleMs: 1000, onFire: (f) => fired2.push(f.kind) });
    const keep = setInterval(() => wd2.touch(), 30);
    await sleep(250);
    clearInterval(keep);
    assert.deepEqual(fired2, ['hard'], 'เพดานรวมต้องยิงแม้ยังคืบหน้า');

    const fired3 = [];
    const wd3 = ct.makeWatchdog({ hardMs: 100, idleMs: 50, onFire: (f) => fired3.push(f.kind) });
    wd3.stop();
    await sleep(160);
    assert.deepEqual(fired3, []);
});

test('stage limits: hard caps exceed the old fixed 240s and idle limits do not exceed the old stall tolerance', () => {
    assert.ok(ct.STAGE_TIMEOUT_MS.architect > 240_000);
    assert.ok(ct.STAGE_IDLE_MS.architect <= 240_000);
    for (const k of ['architect', 'worker', 'reviewer']) assert.ok(ct.STAGE_IDLE_MS[k] < ct.STAGE_TIMEOUT_MS[k], k);
});

test('agy runner: a run that keeps producing output survives longer than the idle limit (the Architect bug)', async () => {
    const r = await run('chatty', { timeoutMs: 6000, idleMs: 700 });   // รวม ~2 วินาที > idle 0.7 วินาที
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 200));
    assert.ok(r.ms > 1500, `ran ${r.ms}ms`);
    assert.ok(r.output.includes('direct_answer'));
});

test('agy runner: a silent run is cut at the idle limit, not the hard cap', async () => {
    const r = await run('silent', { timeoutMs: 6000, idleMs: 600 });
    assert.equal(r.ok, false);
    assert.match(r.error, /timeout \(idle 1s\)|timeout \(idle 0s\)/);
    assert.ok(r.ms < 2500, `cut after ${r.ms}ms`);
});

test('agy runner: endless output is cut at the hard cap', async () => {
    const r = await run('forever', { timeoutMs: 1500, idleMs: 800 });
    assert.equal(r.ok, false);
    assert.match(r.error, /timeout \(hard 2s\)|timeout \(hard 1s\)/);
    assert.ok(r.ms >= 1400 && r.ms < 4500, `cut after ${r.ms}ms`);
});

test('runWithFailover passes idleMs to the runner and reports steps on failure', async () => {
    const seen = [];
    const runner = async (c, o) => { seen.push(o.idleMs); return { ok: false, output: 'x'.repeat(500), error: 'timeout (idle 240s)', crashed: false, stepsCount: 26 }; };
    const r = await ct.runWithFailover([{ model: 'm', engine: 'agy', account: 'g1', label: 'M', accountLabel: 'G1' }], {
        stageName: 'architect', prompt: 'p', cwd: tmp, readOnly: true, mode: 'chat', timeoutMs: 1000, idleMs: 321,
        rolePrefix: 'r', decision: {}, originalPrompt: 'p', onThoughtEvent() {}, abortCtx, claimedBrains: new Set(), runner
    });
    assert.deepEqual(seen, [321]);
    assert.equal(r.ok, false);
    assert.equal(r.stepsCount, 26);
});

test('treeCpuSeconds: sees CPU of busy child processes, not idle ones', async () => {
    const { spawn } = require('node:child_process');
    const before = ct.treeCpuSeconds(process.pid);
    const busy = spawn('python3', ['-c', 'import time\nt=time.time()\nwhile time.time()-t<1.2: pass']);
    await new Promise((r) => busy.on('close', r));
    const afterBusy = ct.treeCpuSeconds(process.pid);
    assert.ok(afterBusy - before >= 0.8, `busy child should add >=0.8s CPU, added ${(afterBusy - before).toFixed(2)}`);
    const idle = spawn('sleep', ['1']);
    const mid = ct.treeCpuSeconds(process.pid);
    await new Promise((r) => idle.on('close', r));
    const afterIdle = ct.treeCpuSeconds(process.pid);
    assert.ok(afterIdle - mid < 0.2, `idle child should add ~0 CPU, added ${(afterIdle - mid).toFixed(2)}`);
});

test('agy runner: a long command that uses CPU but prints nothing is NOT cut at the idle limit (the render bug)', async () => {
    const r = await run('busy-child', { timeoutMs: 8000, idleMs: 700 });   // เงียบ ~2.5 วินาที > idle 0.7 วินาที แต่ลูกใช้ CPU
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 220));
    assert.ok(r.ms > 2000, `ran ${r.ms}ms`);
});

test('agy runner: a silent child that uses no CPU is still cut at the idle limit', async () => {
    const r = await run('idle-child', { timeoutMs: 8000, idleMs: 700 });
    assert.equal(r.ok, false);
    assert.match(r.error, /timeout \(idle/);
    // ฆ่าทั้งต้นไม้: ถ้าฆ่าแค่ bash ตัว sleep ลูกจะถือท่อไว้จนจบเอง (~2.8 วินาที) และยังรันอยู่หลังด่านจบ
    assert.ok(r.ms < 2000, `cut after ${r.ms}ms — child should have been killed with its parent`);
    const { spawnSync } = require('node:child_process');
    // นับเฉพาะโปรเซสที่ชื่อคำสั่งคือ sleep จริง (ไม่ใช่ shell/node ที่บังเอิญมีข้อความนี้อยู่ในบรรทัดคำสั่ง)
    const left = spawnSync('pgrep', ['-x', 'sleep', '-a']).stdout.toString().split('\n').filter((l) => /\bsleep 2\.789$/.test(l.trim()));
    assert.deepEqual(left, [], `orphaned child still running: ${left.join(' | ')}`);
});

test('stage limits after the render-timeout fix: workers get 10 min idle / 30 min hard', () => {
    assert.equal(ct.STAGE_IDLE_MS.worker, 600_000);
    assert.equal(ct.STAGE_TIMEOUT_MS.worker, 1_800_000);
});

test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
