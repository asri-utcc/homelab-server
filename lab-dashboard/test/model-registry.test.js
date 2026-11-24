'use strict';
// ทดสอบ model-registry (Discovery + Diff + Alerts) แบบไม่เรียก agy จริง ไม่ส่ง Telegram:  node --test test/model-registry.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ตั้ง env ก่อน require เสมอ (path อ่านตอนเรียกใช้ แต่ NO_NOTIFY กันพลาดไว้ก่อน)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'model-registry-test-'));
process.env.MODEL_REGISTRY_FILE = path.join(tmp, 'model-registry.json');
process.env.MODEL_ALERTS_FILE = path.join(tmp, 'model-alerts.jsonl');
process.env.MODEL_ALERTS_ACK_FILE = path.join(tmp, 'model-alerts-acked.json');
process.env.MODEL_REGISTRY_NO_NOTIFY = '1';

// agy ปลอม: FAKE_FAIL=1 → exit 1, ไม่งั้น echo โมเดลจาก FAKE_MODELS (คั่นแต่ละโมเดลด้วย ';' และ id/name ด้วย ':')
const fakeAgy = path.join(tmp, 'agy');
fs.writeFileSync(fakeAgy, `#!/bin/bash
if [ "$FAKE_FAIL" = "1" ]; then echo "boom" >&2; exit 1; fi
echo "Fetching available models..."
IFS=';' read -ra ITEMS <<< "$FAKE_MODELS"
for it in "\${ITEMS[@]}"; do
  id="\${it%%:*}"; name="\${it#*:}"
  printf '%s\\t%s\\n' "$id" "$name"
done
`);
fs.chmodSync(fakeAgy, 0o755);

const reg = require('../model-registry');

const FAMILIES = [
    { id: 'neon', engine: 'agy', label: 'Gemini 4 Neon', variants: ['low', 'medium', 'high', 'xhigh'], prefix: 'gemini-4-neon-', q: { code: 90, analysis: 90, chat: 90 }, cost: 2 },
    { id: 'hydrogen', engine: 'agy', label: 'Gemini 4 Hydrogen', variants: ['low', 'medium', 'high'], prefix: 'gemini-4-hydrogen-', q: { code: 80, analysis: 80, chat: 82 }, cost: 1 },
    { id: 'orchestrator', engine: 'agy', label: 'Gemini Orchestrator', variants: [null], model: 'gemini-orchestrator', q: { code: 85, analysis: 88, chat: 85 }, cost: 2 }
];
const BASE_IDS = ['gemini-4-neon-low', 'gemini-4-neon-medium', 'gemini-4-neon-high', 'gemini-4-neon-xhigh',
    'gemini-4-hydrogen-low', 'gemini-4-hydrogen-medium', 'gemini-4-hydrogen-high', 'gemini-orchestrator'];

const fakeList = (ids) => ids.map((id) => `${id}:${id} name`).join(';');
const setModels = (ids) => { process.env.FAKE_FAIL = ''; process.env.FAKE_MODELS = fakeList(ids); };

let n = 0;
// registry/alerts ใหม่ทุกเคส เพื่อไม่ให้เคสกระทบกัน
function fresh() {
    n += 1;
    process.env.MODEL_REGISTRY_FILE = path.join(tmp, `reg-${n}.json`);
    process.env.MODEL_ALERTS_FILE = path.join(tmp, `alerts-${n}.jsonl`);
    process.env.MODEL_ALERTS_ACK_FILE = path.join(tmp, `acked-${n}.json`);
    reg.init({
        families: FAMILIES,
        deepseekModels: [],
        claudeCodeModels: [],
        listAccounts: () => [{ id: 'acc1', label: 'acc1', home: tmp, ready: true }],
        agyBin: fakeAgy
    });
    setModels(BASE_IDS);
}
const statusOf = (id) => (reg.getSnapshot().models.find((m) => m.id === id) || {}).status;
const alertsOf = (kind) => reg.listAlerts({ limit: 500 }).filter((a) => a.kind === kind);

test('seed จาก families → ทุก variant เป็น active', () => {
    fresh();
    const snap = reg.getSnapshot();
    assert.equal(snap.models.length, BASE_IDS.length);
    for (const id of BASE_IDS) assert.equal(statusOf(id), 'active', id);
    assert.equal(snap.pendingCount, 0);
});

test('scan เจอ gemini-4-neon-max → active, confidence>=80, alert new_auto', async () => {
    fresh();
    setModels([...BASE_IDS, 'gemini-4-neon-max']);
    const r = await reg.scan();
    assert.equal(r.ok, true);
    const m = reg.getSnapshot().models.find((x) => x.id === 'gemini-4-neon-max');
    assert.ok(m);
    assert.equal(m.status, 'active');
    assert.ok(m.confidence >= reg.AUTO_ENABLE_CONFIDENCE);
    assert.ok(r.changes.some((a) => a.kind === 'new_auto' && a.modelId === 'gemini-4-neon-max'));
    const neon = reg.getEffectiveFamilies(FAMILIES).find((f) => f.id === 'neon');
    assert.ok(neon.variants.includes('max'));
});

test('scan เจอ gemini-4-carbon-medium → pending, confidence<80, มี suggested.q และ basis', async () => {
    fresh();
    setModels([...BASE_IDS, 'gemini-4-carbon-medium']);
    const r = await reg.scan();
    const m = reg.getSnapshot().models.find((x) => x.id === 'gemini-4-carbon-medium');
    assert.ok(m);
    assert.equal(m.status, 'pending');
    assert.ok(m.confidence < reg.AUTO_ENABLE_CONFIDENCE);
    assert.ok(m.suggested && m.suggested.q && Number.isFinite(m.suggested.q.code));
    assert.ok(typeof m.suggested.basis === 'string' && m.suggested.basis.length > 0);
    assert.ok(r.changes.some((a) => a.kind === 'new_pending' && a.modelId === 'gemini-4-carbon-medium'));
    assert.equal(reg.isModelUsable('gemini-4-carbon-medium'), false);
    assert.equal(reg.getSnapshot().pendingCount, 1);
});

test('approve carbon → getEffectiveFamilies มีตระกูลใหม่ที่มี variant medium', async () => {
    fresh();
    setModels([...BASE_IDS, 'gemini-4-carbon-medium']);
    await reg.scan();
    const r = reg.approve('gemini-4-carbon-medium');
    assert.equal(r.ok, true);
    assert.equal(statusOf('gemini-4-carbon-medium'), 'active');
    const fam = reg.getEffectiveFamilies(FAMILIES).find((f) => f.prefix === 'gemini-4-carbon-');
    assert.ok(fam, 'ต้องมีตระกูล carbon');
    assert.ok(fam.variants.includes('medium'));
    assert.ok(alertsOf('approved').length >= 1);
});

test('active หาย 2 รอบติดกัน → missing (ใช้ไม่ได้) แล้วกลับมา → active + alert returned', async () => {
    fresh();
    const without = BASE_IDS.filter((id) => id !== 'gemini-4-hydrogen-low');
    setModels(without);
    await reg.scan();
    assert.equal(statusOf('gemini-4-hydrogen-low'), 'active', 'รอบแรกยังไม่ missing');
    await reg.scan();
    assert.equal(statusOf('gemini-4-hydrogen-low'), 'missing');
    assert.equal(reg.isModelUsable('gemini-4-hydrogen-low'), false);
    assert.equal(alertsOf('missing').length, 1);
    const hy = reg.getEffectiveFamilies(FAMILIES).find((f) => f.id === 'hydrogen');
    assert.ok(!hy.variants.includes('low'));

    setModels(BASE_IDS);
    await reg.scan();
    assert.equal(statusOf('gemini-4-hydrogen-low'), 'active');
    assert.equal(reg.isModelUsable('gemini-4-hydrogen-low'), true);
    assert.equal(alertsOf('returned').length, 1);
});

test('สแกนล้มเหลว (agy exit 1) → ไม่เปลี่ยนสถานะใดเลย และ scan_failed ไม่เกิน 1 ครั้งใน 12 ชม.', async () => {
    fresh();
    const before = JSON.parse(JSON.stringify(reg.getSnapshot().models));
    process.env.FAKE_FAIL = '1';
    const r1 = await reg.scan();
    const r2 = await reg.scan();
    const r3 = await reg.scan();
    assert.equal(r1.ok, false);
    assert.deepEqual(reg.getSnapshot().models, before);
    assert.equal(reg.getSnapshot().lastScanOk, false);
    assert.equal(r2.ok, false);
    assert.equal(r3.ok, false);
    assert.equal(alertsOf('scan_failed').length, 1);
    assert.equal(alertsOf('missing').length, 0);
});

test('toggle disabled → getEffectiveFamilies ไม่มี variant นั้น และเปิดกลับได้', () => {
    fresh();
    assert.equal(reg.toggle('gemini-4-neon-xhigh', false).ok, true);
    assert.equal(statusOf('gemini-4-neon-xhigh'), 'disabled');
    assert.equal(reg.isModelUsable('gemini-4-neon-xhigh'), false);
    let neon = reg.getEffectiveFamilies(FAMILIES).find((f) => f.id === 'neon');
    assert.ok(!neon.variants.includes('xhigh'));
    assert.deepEqual(neon.variants, ['low', 'medium', 'high']);

    reg.toggle('gemini-4-neon-xhigh', true);
    neon = reg.getEffectiveFamilies(FAMILIES).find((f) => f.id === 'neon');
    assert.ok(neon.variants.includes('xhigh'));
});

test('ไฟล์ registry JSON พัง → ไม่ throw และ seed ใหม่', () => {
    fresh();
    const file = process.env.MODEL_REGISTRY_FILE;
    assert.ok(fs.existsSync(file));
    fs.writeFileSync(file, '{ this is not json');
    // cache อิง mtime → ดันเวลาให้ต่างจากที่ cache ไว้แน่นอน
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(file, future, future);

    let snap;
    assert.doesNotThrow(() => { snap = reg.getSnapshot(); });
    assert.equal(snap.models.length, BASE_IDS.length);
    for (const id of BASE_IDS) assert.equal(statusOf(id), 'active', id);
    assert.doesNotThrow(() => reg.getEffectiveFamilies(FAMILIES));
    assert.equal(reg.isModelUsable('gemini-4-neon-high'), true);
    // ไฟล์ที่พังถูกสำรองไว้ และไฟล์ใหม่อ่านได้
    assert.ok(fs.readdirSync(tmp).some((f) => f.startsWith(path.basename(file) + '.corrupt-')));
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, 'utf8')));
});

test('ackAlerts แล้ว listAlerts({unacked:true}) ต้องว่าง', async () => {
    fresh();
    setModels([...BASE_IDS, 'gemini-4-neon-max', 'gemini-4-carbon-low']);
    await reg.scan();
    const unacked = reg.listAlerts({ unacked: true });
    assert.ok(unacked.length >= 2);

    // ack ทีละ id → เหลือที่ไม่ได้ ack
    reg.ackAlerts([unacked[0].id]);
    assert.equal(reg.listAlerts({ unacked: true }).length, unacked.length - 1);

    reg.ackAlerts('all');
    assert.deepEqual(reg.listAlerts({ unacked: true }), []);
    // alert ยังอยู่ในไฟล์ (ack ไม่ลบ jsonl)
    assert.ok(reg.listAlerts({ limit: 500 }).length >= unacked.length);
});

test('agy crash เงียบ (ไม่มี stderr) → heal แล้วลองใหม่ สแกนสำเร็จ', async () => {
    fresh();
    const marker = path.join(tmp, `crash-marker-${n}`);
    const flaky = path.join(tmp, `agy-flaky-${n}`);
    // ครั้งแรกถูก SIGSEGV ฆ่าโดยไม่มี output (เหมือน core dump) ครั้งที่สองปกติ
    fs.writeFileSync(flaky, `#!/bin/bash
if [ ! -f "${marker}" ]; then touch "${marker}"; kill -SEGV $$; fi
printf 'gemini-4-neon-low\\tNeon Low\\n'
`);
    fs.chmodSync(flaky, 0o755);
    let heals = 0;
    reg.init({
        families: FAMILIES, deepseekModels: [], claudeCodeModels: [],
        listAccounts: () => [{ id: 'acc1', label: 'acc1', home: tmp, ready: true }],
        agyBin: flaky,
        isBinaryCrash: () => false,
        healBinaryCache: async () => { heals += 1; return true; }
    });
    const d = await reg.discoverAgyModels();
    assert.equal(d.ok, true);
    assert.equal(heals, 1);
    assert.ok(d.union.has('gemini-4-neon-low'));
});

test('researchModel และ researchAll อัปเดต confidence, research metadata และจัดอันดับได้ถูกต้อง (offline mock)', async () => {
    fresh();
    const mockCatalogs = {
        openrouter: [
            { id: 'google/gemini-4-neon', name: 'Gemini 4 Neon', inputUsdPer1M: 3.0, outputUsdPer1M: 15.0, contextLength: 1000000, description: 'Flagship Gemini 4 Neon' }
        ],
        litellm: {
            'gemini-4-neon': { id: 'gemini-4-neon', provider: 'google', inputUsdPer1M: 3.0, outputUsdPer1M: 15.0, contextLength: 1000000 }
        },
        modelsdev: [
            { id: 'gemini-4-neon', provider: 'google', name: 'Gemini 4 Neon', inputUsdPer1M: 3.0, outputUsdPer1M: 15.0, contextLength: 1000000 }
        ]
    };

    const extraSources = [
        { domain: 'google.dev', url: 'https://ai.google.dev/gemini-api/docs/models', tier: 'official', inputUsdPer1M: 3.0, outputUsdPer1M: 15.0, contextLength: 1000000 },
        { domain: 'artificialanalysis.ai', url: 'https://artificialanalysis.ai/models/gemini-4-neon', tier: 'benchmark', inputUsdPer1M: 3.0, outputUsdPer1M: 15.0, contextLength: 1000000 }
    ];

    const single = await reg.researchModel('gemini-4-neon-high', {
        disableNetwork: true,
        skipCache: true,
        catalogData: mockCatalogs,
        extraSources
    });
    assert.equal(single.ok, true);
    assert.equal(single.model.research.meetsMinSources, true);
    assert.equal(single.model.research.uniqueDomainCount, 5);
    assert.ok(single.model.confidence >= 85);

    const all = await reg.researchAll({
        disableNetwork: true,
        skipCache: true,
        catalogData: mockCatalogs,
        extraSources,
        sortBy: 'confidence'
    });
    assert.equal(all.ok, true);
    assert.equal(all.researchedCount, BASE_IDS.length);
    assert.equal(all.meetsMinSourcesCount, 4); // 4 neon variants
    assert.ok(all.ranked[0].id.startsWith('gemini-4-neon-'));

    const ranking = reg.getResearchRanking({ sortBy: 'confidence' });
    assert.equal(ranking.ok, true);
    assert.equal(ranking.ranked.length, BASE_IDS.length);
    assert.ok(ranking.ranked[0].confidence > ranking.ranked[ranking.ranked.length - 1].confidence);
});

test('seed DeepSeek: รายการ builtin (decidedBy=auto) ที่มี q=80 ค้างอยู่ต้องถูก refresh เป็น 74', () => {
    n += 1;
    process.env.MODEL_REGISTRY_FILE = path.join(tmp, `reg-${n}.json`);
    process.env.MODEL_ALERTS_FILE = path.join(tmp, `alerts-${n}.jsonl`);
    process.env.MODEL_ALERTS_ACK_FILE = path.join(tmp, `acked-${n}.json`);
    reg.init({
        families: FAMILIES,
        deepseekModels: [{ model: 'deepseek-flash', label: 'DeepSeek Flash' }],
        claudeCodeModels: [],
        listAccounts: () => [{ id: 'acc1', label: 'acc1', home: tmp, ready: true }],
        agyBin: fakeAgy
    });
    let m = reg.getSnapshot().models.find((x) => x.id === 'deepseek-flash');
    assert.equal(m.suggested.q.code, 80);

    reg.init({
        families: FAMILIES,
        deepseekModels: [{ model: 'deepseek-flash', label: 'DeepSeek Flash', q: 74 }],
        claudeCodeModels: [],
        listAccounts: () => [{ id: 'acc1', label: 'acc1', home: tmp, ready: true }],
        agyBin: fakeAgy
    });
    m = reg.getSnapshot().models.find((x) => x.id === 'deepseek-flash');
    assert.equal(m.suggested.q.code, 74);
    assert.equal(m.suggested.q.analysis, 74);
    assert.equal(m.suggested.q.chat, 74);
});

test('seed DeepSeek: รายการที่ผู้ใช้ override (decidedBy=user) ต้องไม่ถูกทับ', () => {
    n += 1;
    process.env.MODEL_REGISTRY_FILE = path.join(tmp, `reg-${n}.json`);
    process.env.MODEL_ALERTS_FILE = path.join(tmp, `alerts-${n}.jsonl`);
    process.env.MODEL_ALERTS_ACK_FILE = path.join(tmp, `acked-${n}.json`);
    reg.init({
        families: FAMILIES,
        deepseekModels: [{ model: 'deepseek-flash', label: 'DeepSeek Flash', q: 80 }],
        claudeCodeModels: [],
        listAccounts: () => [{ id: 'acc1', label: 'acc1', home: tmp, ready: true }],
        agyBin: fakeAgy
    });
    reg.approve('deepseek-flash', { q: { code: 91, analysis: 92, chat: 93 } });

    reg.init({
        families: FAMILIES,
        deepseekModels: [{ model: 'deepseek-flash', label: 'DeepSeek Flash', q: 74 }],
        claudeCodeModels: [],
        listAccounts: () => [{ id: 'acc1', label: 'acc1', home: tmp, ready: true }],
        agyBin: fakeAgy
    });
    const m = reg.getSnapshot().models.find((x) => x.id === 'deepseek-flash');
    assert.equal(m.decidedBy, 'user');
    assert.equal(m.suggested.q.code, 91);
    assert.equal(m.suggested.q.analysis, 92);
    assert.equal(m.suggested.q.chat, 93);
});

test('ai-router: ensureRegistryInit ส่ง q ของ DeepSeek (74/86) เข้า registry.init จริงและอัปเดตค่า 80 เดิม', () => {
    n += 1;
    const regFile = path.join(tmp, `reg-${n}.json`);
    process.env.MODEL_REGISTRY_FILE = regFile;
    process.env.MODEL_ALERTS_FILE = path.join(tmp, `alerts-${n}.jsonl`);
    process.env.MODEL_ALERTS_ACK_FILE = path.join(tmp, `acked-${n}.json`);

    reg.init({
        families: FAMILIES,
        deepseekModels: [
            { model: 'deepseek-flash', label: 'DeepSeek Flash', q: 80 },
            { model: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', q: 80 }
        ],
        claudeCodeModels: [],
        listAccounts: () => [{ id: 'acc1', label: 'acc1', home: tmp, ready: true }],
        agyBin: fakeAgy
    });
    let snap = reg.getSnapshot();
    assert.equal(snap.models.find((x) => x.id === 'deepseek-flash').suggested.q.code, 80);
    assert.equal(snap.models.find((x) => x.id === 'deepseek-v4-pro').suggested.q.code, 80);

    const routerPath = require.resolve('../ai-router');
    delete require.cache[routerPath];
    const aiRouter = require('../ai-router');
    aiRouter.activeFamilies();

    snap = reg.getSnapshot();
    const flash = snap.models.find((x) => x.id === 'deepseek-flash');
    const pro = snap.models.find((x) => x.id === 'deepseek-v4-pro');
    assert.equal(flash.suggested.q.code, 74);
    assert.equal(flash.suggested.q.analysis, 74);
    assert.equal(flash.suggested.q.chat, 74);
    assert.equal(pro.suggested.q.code, 86);
    assert.equal(pro.suggested.q.analysis, 86);
    assert.equal(pro.suggested.q.chat, 86);
});
