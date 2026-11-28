'use strict';
// ทดสอบระบบตั้งค่าสมองกลาง AI, Weekly Limit ของ Gemini, โหมดประหยัด, Gate ก่อนปล่อย Worker และ Burn-Rate Alert:
//   node --test test/ai-router-brain-config.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-router-brain-'));
process.env.AI_ROUTER_CONFIG_FILE = path.join(tmp, 'ai-router-config.json');
process.env.AI_ROUTER_OUTCOMES_FILE = path.join(tmp, 'outcomes.jsonl');

const router = require('../ai-router');
const est = require('../difficulty-estimator');
const ct = require('../cross-team-orchestrator');

const makeAbortCtx = () => ({
    aborted: false,
    register() {},
    unregister() {},
    registerHandle() {},
    unregisterHandle() {}
});

test.beforeEach(() => {
    router.resetConfig();
    router.clearCooldowns();
    router.setTelegramNotifier(null);
    router.setQuotaProvider(null);
});

test('config store: ค่าเริ่มต้นตรงตามแผน + clamp/validate + persist + reset', () => {
    const def = router.getConfig();
    assert.equal(def.crossTeamEnabled, true);
    assert.equal(def.crossTeamMinComplexity, 85);
    assert.equal(def.crossTeamMaxWorkers, 3);
    assert.equal(def.crossTeamWorkerDefaultModel, 'hydrogen');
    assert.equal(def.crossTeamAllowNeonWorkers, false);
    assert.equal(def.geminiUseWeeklyLimit, true);
    assert.equal(def.geminiWeeklySoftGate, true);
    assert.equal(def.economyMode, 'balanced');
    assert.equal(def.continuationMaxComplexity, 74);
    assert.equal(def.burnAlertDropPct, 30);

    const updated = router.updateConfig({
        crossTeamMinComplexity: 150, // clamp -> 100
        crossTeamMaxWorkers: 0,       // clamp -> 1
        crossTeamWorkerDefaultModel: 'invalid-model', // fallback -> balanced/prev ('hydrogen')
        fiveHourConservePct: 10,
        fiveHourCriticalPct: 20,      // must be <= conserve - 2 -> 8
        economyMode: 'economy'
    });
    assert.equal(updated.crossTeamMinComplexity, 100);
    assert.equal(updated.crossTeamMaxWorkers, 1);
    assert.equal(updated.crossTeamWorkerDefaultModel, 'hydrogen');
    assert.equal(updated.fiveHourConservePct, 10);
    assert.equal(updated.fiveHourCriticalPct, 8);
    assert.equal(updated.economyMode, 'economy');
    assert.equal(router.CROSS_TEAM_MIN_COMPLEXITY, 100);

    // persisted to file
    const disk = JSON.parse(fs.readFileSync(process.env.AI_ROUTER_CONFIG_FILE, 'utf8'));
    assert.equal(disk.crossTeamMinComplexity, 100);

    const reset = router.resetConfig();
    assert.equal(reset.crossTeamMinComplexity, 85);
    assert.equal(reset.economyMode, 'balanced');
});

test('planTeamPipeline: เกณฑ์เริ่มต้น >= 85, ปรับเกณฑ์ได้, ปิดอัตโนมัติได้ และ #ทีมข้ามค่าย override ได้', () => {
    const cls80 = { type: 'code', complexity: 80, tier: 'high', risk: 20 };
    const cls87 = { type: 'code', complexity: 87, tier: 'xhigh', risk: 20 };
    const cands = [
        { engine: 'claude-code', family: 'claude-code-opus', model: 'claude-code-opus', account: 'claude-pro', accountLabel: 'Claude Pro', remainingPct: 80, budget: { mode: 'normal', windows: [] }, score: 90 },
        { engine: 'agy', family: 'gemini-hydrogen', model: 'gemini-4-hydrogen-medium', account: 'g1', accountLabel: 'Google#1', remainingPct: 80, budget: { mode: 'normal', windows: [] }, score: 85 }
    ];

    // 80 < 85 -> single agent
    const p80 = router.planTeamPipeline(cls80, cands, {}, 'chat');
    assert.equal(p80.enabled, false);
    assert.match(p80.reason, /80\/85/);

    // 87 >= 85 -> cross-team enabled
    const p87 = router.planTeamPipeline(cls87, cands, {}, 'chat');
    assert.equal(p87.enabled, true);
    assert.equal(p87.maxWorkers, 4, 'xhigh ขยายได้ +1 จาก 3 เป็น 4');

    // lower threshold to 75 -> 80 becomes eligible
    router.updateConfig({ crossTeamMinComplexity: 75 });
    const p80At75 = router.planTeamPipeline(cls80, cands, {}, 'chat');
    assert.equal(p80At75.enabled, true);
    assert.equal(p80At75.maxWorkers, 3);

    // disable auto cross-team, #ทีมข้ามค่าย still works
    router.updateConfig({ crossTeamEnabled: false });
    assert.equal(router.planTeamPipeline(cls87, cands, {}, 'chat').enabled, false);
    assert.equal(router.planTeamPipeline(cls80, cands, { team: true }, 'chat').enabled, true);
});

test('Gemini weekly limit + soft gate: นับ weekly ใน agyPoolBudget และงดทีมเมื่อ weekly ต่ำกว่าแผน', () => {
    const resetFar = new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString(); // timeLeftFrac ~0.86
    const quota = {
        ok: true,
        pools: [{
            id: 'gemini',
            remainingPct: 25,
            fiveHour: { remainingPct: 90, resetTime: new Date(Date.now() + 4 * 3600 * 1000).toISOString() },
            weekly: { remainingPct: 25, resetTime: resetFar } // surplus = 0.25 - 0.86 = -0.61 -> critical
        }]
    };
    const bOn = router.agyPoolBudget(quota, 'gemini-4-hydrogen-medium');
    assert.equal(bOn.binding, 'weekly');
    assert.equal(bOn.mode, 'critical');

    // Soft gate blocks auto cross-team when weekly behind pace
    const cls90 = { type: 'code', complexity: 90, tier: 'xhigh' };
    const cands = [
        { engine: 'claude-code', family: 'claude-code-opus', model: 'claude-code-opus', account: 'claude-pro', accountLabel: 'Claude Pro', remainingPct: 80, budget: { mode: 'normal', windows: [] }, score: 90 },
        { engine: 'agy', family: 'gemini-hydrogen', model: 'gemini-4-hydrogen-medium', account: 'g1', accountLabel: 'Google#1', remainingPct: 70, budget: { mode: 'conserve', windows: [{ name: 'weekly', surplus: -0.22 }] }, score: 75 }
    ];
    const blocked = router.planTeamPipeline(cls90, cands, {}, 'chat');
    assert.equal(blocked.enabled, false);
    assert.match(blocked.reason, /Weekly/);

    // Disable geminiUseWeeklyLimit -> ignores weekly
    router.updateConfig({ geminiUseWeeklyLimit: false });
    const bOff = router.agyPoolBudget(quota, 'gemini-4-hydrogen-medium');
    assert.equal(bOff.binding, '5h');
    assert.notEqual(bOff.mode, 'critical');
});

test('continuationMaxComplexity: จำกัดเพดานคำสั่งต่อเนื่อง ("ทำต่อเลย") จาก prior 95 เหลือ 74 และคง prior 80 -> 74', async () => {
    est.clearSessions();
    est.seedPrior('cap-95', [{ at: Date.now(), complexity: 95, risk: 25, type: 'code', effective: 95, observed: null }]);
    const cls95 = await router.classifyTask('ทำต่อเลย', { sessionId: 'cap-95', history: [{ role: 'user', content: 'x' }] });
    assert.equal(cls95.source, 'continuation');
    assert.equal(cls95.complexity, 74);
    assert.equal(cls95.continuation.cappedFrom, 87);

    est.clearSessions();
    est.seedPrior('cap-80', [{ at: Date.now(), complexity: 80, risk: 25, type: 'code', effective: 80, observed: null }]);
    const cls80 = await router.classifyTask('ทำต่อเลย', { sessionId: 'cap-80', history: [{ role: 'user', content: 'x' }] });
    assert.equal(cls80.complexity, 74);
    assert.equal(cls80.continuation.cappedFrom, undefined);
});

test('economyMode: balanced/economy เลือก Hydrogen/Flash เหนือ Neon สำหรับงานระดับ medium', async () => {
    const healthyQuota = {
        ok: true,
        account: 'g1',
        accountLabel: 'Google#1',
        pools: [{
            id: 'gemini',
            remainingPct: 90,
            fiveHour: { remainingPct: 90, resetTime: new Date(Date.now() + 4 * 3600 * 1000).toISOString() },
            weekly: { remainingPct: 90, resetTime: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString() }
        }]
    };
    router.setQuotaProvider(async () => healthyQuota);

    router.updateConfig({ economyMode: 'balanced' });
    const candsMed = await router.buildCandidates({ type: 'code', complexity: 50, tier: 'medium' });
    const topAgyMed = candsMed.find((c) => c.engine === 'agy' && agyIsGemini(c.model));
    assert.ok(topAgyMed, 'ต้องมีผู้สมัคร Gemini');
    assert.match(topAgyMed.model, /hydrogen|flash/i, `คาดหวัง Hydrogen/Flash แต่งาน medium ได้ ${topAgyMed.model}`);

    function agyIsGemini(m) {
        return /hydrogen|flash|neon/i.test(m) && !/orchestrator/i.test(m);
    }
});

test('sanitizeTasks: คุมจำนวน Worker สูงสุดและกันไม่ให้ Worker ใช้ Neon เมื่อปิด allowNeonWorkers', () => {
    const raw = [
        { id: 't1', title: '1', model: 'neon', access: 'write', files: ['a.js'], instructions: 'do 1' },
        { id: 't2', title: '2', model: 'flash', access: 'read', files: ['b.js'], instructions: 'do 2' },
        { id: 't3', title: '3', model: 'neon', access: 'write', files: ['c.js'], instructions: 'do 3' },
        { id: 't4', title: '4', model: 'hydrogen', access: 'write', files: ['d.js'], instructions: 'do 4' }
    ];
    const tasks = ct.sanitizeTasks(raw, { cwd: tmp, mode: 'exec', maxTasks: 3, allowNeonWorkers: false, defaultWorkerModel: 'hydrogen' });
    assert.equal(tasks.length, 3);
    assert.equal(tasks[0].model, 'hydrogen');
    assert.equal(tasks[1].model, 'flash');
    assert.equal(tasks[2].model, 'hydrogen');

    const tasksNeon = ct.sanitizeTasks(raw, { cwd: tmp, mode: 'exec', maxTasks: 4, allowNeonWorkers: true, defaultWorkerModel: 'hydrogen' });
    assert.equal(tasksNeon.length, 4);
    assert.equal(tasksNeon[0].model, 'neon');
});

test('runWorkerWave: ตรวจโควตาสดก่อนปล่อย Worker — สลับบัญชีเมื่อต่ำกว่าเกณฑ์ และลดรุ่นเมื่อต่ำทุกบัญชี', async () => {
    const picked = [];
    const thoughts = [];
    const buildFakeWorkers = async (model, opts) => {
        picked.push({ model, account: opts.preferredAccount, modeOverride: opts.modeOverride });
        return [{ model: `gemini-4-${model}-medium`, account: opts.preferredAccount || 'g1', label: model, accountLabel: opts.preferredAccount || 'G1', engine: 'agy' }];
    };
    const runner = async () => ({ ok: true, output: 'ok', stepsCount: 1 });

    // Case 1: g1 drops to 10% (< 20%), g2 has 75% -> switches to g2
    await ct.runWorkerWave(
        [{ id: 't1', title: 'งาน 1', model: 'hydrogen', access: 'write', files: ['a.js'], depends_on: [], instructions: 'go' }],
        {
            plan: { summary: 's', architecture_notes: '', acceptance_criteria: [] },
            originalPrompt: 'x',
            imagePaths: [],
            cwd: tmp,
            mode: 'exec',
            decision: null,
            workerAccounts: [{ account: 'g1', score: 90 }, { account: 'g2', score: 80 }],
            maxParallelWorkers: 1,
            minWorkerQuotaPct: 20,
            onThoughtEvent: (_k, txt) => thoughts.push(txt),
            abortCtx: makeAbortCtx(),
            claimedBrains: new Set(),
            buildWorkersFn: buildFakeWorkers,
            checkQuotaFn: async (accId) => ({
                ok: true,
                pools: [{ id: 'gemini', remainingPct: accId === 'g1' ? 10 : 75 }]
            }),
            runner
        }
    );
    assert.equal(picked[0].account, 'g2');
    assert.ok(thoughts.some((t) => t.includes('สลับไป @G2')));

    // Case 2: both accounts low (12% and 10% < 20%) -> downgrades hydrogen -> flash + modeOverride='conserve'
    picked.length = 0;
    thoughts.length = 0;
    await ct.runWorkerWave(
        [{ id: 't1', title: 'งาน 1', model: 'hydrogen', access: 'write', files: ['a.js'], depends_on: [], instructions: 'go' }],
        {
            plan: { summary: 's', architecture_notes: '', acceptance_criteria: [] },
            originalPrompt: 'x',
            imagePaths: [],
            cwd: tmp,
            mode: 'exec',
            decision: null,
            workerAccounts: [{ account: 'g1', score: 90 }, { account: 'g2', score: 80 }],
            maxParallelWorkers: 1,
            minWorkerQuotaPct: 20,
            onThoughtEvent: (_k, txt) => thoughts.push(txt),
            abortCtx: makeAbortCtx(),
            claimedBrains: new Set(),
            buildWorkersFn: buildFakeWorkers,
            checkQuotaFn: async (accId) => ({
                ok: true,
                pools: [{ id: 'gemini', remainingPct: accId === 'g1' ? 12 : 10 }]
            }),
            runner
        }
    );
    assert.equal(picked[0].model, 'flash');
    assert.equal(picked[0].modeOverride, 'conserve');
    assert.ok(thoughts.some((t) => t.includes('ลดรุ่น Worker')));
});

test('burn-rate alert: ยิงแจ้งเตือน Telegram เมื่อโควตาลด >= 30% และไม่ยิงซ้ำในหน้าต่างเดียวกัน', () => {
    const alerts = [];
    router.setTelegramNotifier(async (msg) => { alerts.push(msg); });
    const t0 = Date.now();
    const makeQ = (pct) => ({
        ok: true,
        accountLabel: 'Google#1',
        pools: [{ id: 'gemini', name: 'Gemini', fiveHour: { remainingPct: pct, resetTime: '2026-11-28T18:00:00Z' } }]
    });

    router.recordQuotaSnapshot('g1', makeQ(90), t0);
    assert.equal(alerts.length, 0);

    router.recordQuotaSnapshot('g1', makeQ(70), t0 + 10 * 60000); // -20%
    assert.equal(alerts.length, 0);

    router.recordQuotaSnapshot('g1', makeQ(55), t0 + 20 * 60000); // -35% -> fires once!
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /Google#1/);
    assert.match(alerts[0], /-35%/);

    router.recordQuotaSnapshot('g1', makeQ(40), t0 + 30 * 60000); // same window -> deduped
    assert.equal(alerts.length, 1);

    const status = router.getBurnRateStatus(t0 + 30 * 60000);
    assert.ok(status.some((s) => s.key === 'g1:gemini:5h' && s.dropPct === 50));
});

test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
