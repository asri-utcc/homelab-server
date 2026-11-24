'use strict';
// ทดสอบ model-researcher (domain dedup, strict matching, confidence formula, conflict detection, family grouping, ranking) แบบ 100% offline:
// node --test test/model-researcher.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'model-researcher-test-'));
process.env.MODEL_RESEARCH_CACHE_FILE = path.join(tmp, 'research-cache.json');

const researcher = require('../model-researcher');

test('extractRootDomain ตัด subdomain และรวม raw.githubusercontent.com เป็น github.com', () => {
    assert.equal(researcher.extractRootDomain('https://docs.anthropic.com/en/docs/models'), 'anthropic.com');
    assert.equal(researcher.extractRootDomain('https://www.anthropic.com/pricing'), 'anthropic.com');
    assert.equal(researcher.extractRootDomain('https://raw.githubusercontent.com/BerriAI/litellm/main/file.json'), 'github.com');
    assert.equal(researcher.extractRootDomain('https://github.com/BerriAI/litellm'), 'github.com');
    assert.equal(researcher.extractRootDomain('https://openrouter.ai/openai/gpt-oss-120b'), 'openrouter.ai');
    assert.equal(researcher.extractRootDomain('https://models.dev/'), 'models.dev');
    assert.equal(researcher.extractRootDomain('https://news.ycombinator.com/item?id=123'), 'ycombinator.com');
});

test('deduplicateSourcesByDomain นับ docs.anthropic.com + anthropic.com เป็น 1 แหล่งอิสระ', () => {
    const dedup = researcher.deduplicateSourcesByDomain([
        { url: 'https://docs.anthropic.com/models', quality: 'official', title: 'Docs', outputUsdPer1M: 15 },
        { url: 'https://www.anthropic.com/pricing', quality: 'official', title: 'Pricing' },
        { url: 'https://openrouter.ai/anthropic/claude', quality: 'catalog', title: 'OR', outputUsdPer1M: 15 },
        { url: 'https://raw.githubusercontent.com/BerriAI/litellm/main/prices.json', quality: 'catalog', title: 'LiteLLM', outputUsdPer1M: 15 }
    ]);
    assert.equal(dedup.length, 3);
    const domains = new Set(dedup.map((s) => s.domain));
    assert.ok(domains.has('anthropic.com'));
    assert.ok(domains.has('openrouter.ai'));
    assert.ok(domains.has('github.com'));
});

test('candidateMatchesDescriptor ไม่จับมั่วข้ามเวอร์ชัน (เช่น Gemini 1.5/2.0 ห้ามตรงกับ Gemini 4 Neon)', () => {
    const descNeon = researcher.parseModelDescriptor('gemini-4-neon-medium', 'Gemini 4 Neon (Medium)');
    assert.equal(researcher.candidateMatchesDescriptor('google/gemini-2.0-flash', 'Gemini 2.0 Flash', descNeon), false);
    assert.equal(researcher.candidateMatchesDescriptor('google/gemini-1.5-pro', 'Gemini 1.5 Pro', descNeon), false);
    assert.equal(researcher.candidateMatchesDescriptor('google/gemini-4-hydrogen', 'Gemini 4 Hydrogen', descNeon), false);
    assert.equal(researcher.candidateMatchesDescriptor('google/gemini-4-neon', 'Gemini 4 Neon', descNeon), true);

    const descOpus = researcher.parseModelDescriptor('claude-opus-5-5-high', 'Claude Opus 5.5 (High)');
    assert.equal(researcher.candidateMatchesDescriptor('anthropic/claude-3.5-sonnet', 'Claude 3.5 Sonnet', descOpus), false);
    assert.equal(researcher.candidateMatchesDescriptor('anthropic/claude-4-opus', 'Claude 4 Opus', descOpus), false);
    assert.equal(researcher.candidateMatchesDescriptor('anthropic/claude-opus-5.5', 'Claude Opus 5.5', descOpus), true);

    const descGptOss = researcher.parseModelDescriptor('gpt-oss-120b-medium', 'GPT-OSS 120B (Medium)');
    assert.equal(researcher.candidateMatchesDescriptor('openai/gpt-oss-120b', 'OpenAI: gpt-oss-120b', descGptOss), true);
    assert.equal(researcher.candidateMatchesDescriptor('openai/gpt-oss-20b', 'OpenAI: gpt-oss-20b', descGptOss), false);
});

test('computeConfidenceScore แยกชัดเจนระหว่าง 0 แหล่ง vs >=3 แหล่งสอดคล้อง vs ขัดแย้งกัน', () => {
    const zero = researcher.computeConfidenceScore({
        uniqueSources: [],
        agreement: 'low',
        hasIntelligence: false,
        hasPricing: false
    });
    assert.equal(zero.meetsMinSources, false);
    assert.ok(zero.score <= 25, `0 sources score should be low, got ${zero.score}`);

    const threeAgreed = researcher.computeConfidenceScore({
        uniqueSources: [
            { domain: 'openrouter.ai', quality: 'catalog', outputUsdPer1M: 0.6 },
            { domain: 'deepseek.com', quality: 'official', outputUsdPer1M: 0.6 },
            { domain: 'artificialanalysis.ai', quality: 'official', outputUsdPer1M: 0.6 }
        ],
        agreement: 'high',
        hasIntelligence: true,
        hasPricing: true
    });
    assert.equal(threeAgreed.meetsMinSources, true);
    assert.equal(threeAgreed.independentSourceCount, 3);
    assert.ok(threeAgreed.score >= 85, `3 independent agreed sources should score high, got ${threeAgreed.score}`);
    assert.equal(threeAgreed.breakdown.base, 76);
    assert.equal(threeAgreed.breakdown.agreementDelta, 8);
    assert.equal(threeAgreed.breakdown.completenessDelta, 4);

    const conflicted = researcher.computeConfidenceScore({
        uniqueSources: [
            { domain: 'openrouter.ai', quality: 'catalog', outputUsdPer1M: 0.5 },
            { domain: 'deepseek.com', quality: 'official', outputUsdPer1M: 5.0 },
            { domain: 'artificialanalysis.ai', quality: 'official', outputUsdPer1M: 1.0 }
        ],
        agreement: 'conflict',
        hasIntelligence: true,
        hasPricing: true
    });
    assert.ok(conflicted.score < threeAgreed.score - 20, 'conflict must drop confidence sharply');
    assert.equal(conflicted.breakdown.agreementDelta, -20);
});

test('computeConfidenceScore นับ 3 แคตตาล็อกรวบรวมเป็น 1 แหล่งอิสระ และให้ confidence ต่ำกว่ากรณีที่มีเว็บผู้ผลิตเพิ่ม', () => {
    const threeCatalogsOnly = researcher.computeConfidenceScore({
        uniqueSources: [
            { provider: 'openrouter', domain: 'openrouter.ai', quality: 'catalog', outputUsdPer1M: 0.6 },
            { provider: 'litellm', domain: 'github.com', quality: 'catalog', url: 'https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json', outputUsdPer1M: 0.6 },
            { provider: 'modelsdev', domain: 'models.dev', quality: 'catalog', outputUsdPer1M: 0.6 }
        ],
        agreement: 'high',
        hasIntelligence: true,
        hasPricing: true
    });

    assert.equal(threeCatalogsOnly.uniqueDomainCount, 3, 'ยังเก็บจำนวนโดเมนจริงครบ 3 สำหรับแสดงผล');
    assert.equal(threeCatalogsOnly.independentSourceCount, 1, '3 แคตตาล็อกรวบรวมต้องนับเป็น 1 แหล่งอิสระ');
    assert.equal(threeCatalogsOnly.catalogOnly, true);
    assert.equal(threeCatalogsOnly.meetsMinSources, false, 'มีแต่แคตตาล็อกต้องยังไม่ผ่านเกณฑ์ >= 3 แหล่งอิสระ');
    assert.equal(threeCatalogsOnly.breakdown.base, 42);
    assert.ok(threeCatalogsOnly.score <= 55, `catalog-only confidence must be capped at medium (<=55), got ${threeCatalogsOnly.score}`);

    const catalogsPlusVendor = researcher.computeConfidenceScore({
        uniqueSources: [
            { provider: 'openrouter', domain: 'openrouter.ai', quality: 'catalog', outputUsdPer1M: 0.6 },
            { provider: 'litellm', domain: 'github.com', quality: 'catalog', outputUsdPer1M: 0.6 },
            { provider: 'modelsdev', domain: 'models.dev', quality: 'catalog', outputUsdPer1M: 0.6 },
            { domain: 'deepseek.com', quality: 'official', outputUsdPer1M: 0.6 }
        ],
        agreement: 'high',
        hasIntelligence: true,
        hasPricing: true
    });

    assert.equal(catalogsPlusVendor.uniqueDomainCount, 4);
    assert.equal(catalogsPlusVendor.independentSourceCount, 2, '3 แคตตาล็อก + เว็บผู้ผลิต 1 แห่ง = 2 แหล่งอิสระ');
    assert.equal(catalogsPlusVendor.catalogOnly, false);
    assert.equal(catalogsPlusVendor.meetsMinSources, false);
    assert.ok(
        threeCatalogsOnly.score < catalogsPlusVendor.score,
        `3 catalogs only (${threeCatalogsOnly.score}) must score lower than catalogs + vendor (${catalogsPlusVendor.score})`
    );

    const catalogsPlusTwoIndependent = researcher.computeConfidenceScore({
        uniqueSources: [
            { provider: 'openrouter', domain: 'openrouter.ai', quality: 'catalog', outputUsdPer1M: 0.6 },
            { provider: 'litellm', domain: 'github.com', quality: 'catalog', outputUsdPer1M: 0.6 },
            { provider: 'modelsdev', domain: 'models.dev', quality: 'catalog', outputUsdPer1M: 0.6 },
            { domain: 'deepseek.com', quality: 'official', outputUsdPer1M: 0.6 },
            { domain: 'artificialanalysis.ai', quality: 'official', outputUsdPer1M: 0.6 }
        ],
        agreement: 'high',
        hasIntelligence: true,
        hasPricing: true
    });

    assert.equal(catalogsPlusTwoIndependent.independentSourceCount, 3);
    assert.equal(catalogsPlusTwoIndependent.meetsMinSources, true);
    assert.ok(catalogsPlusTwoIndependent.score > catalogsPlusVendor.score);
    assert.ok(catalogsPlusTwoIndependent.score >= 85);

    // repo ทางการของผู้ผลิตบน github.com ที่ไม่ใช่ LiteLLM ต้องไม่ถูกยุบรวมเข้ากลุ่มแคตตาล็อก
    const officialGithub = researcher.countIndependentSources([
        { provider: 'openrouter', domain: 'openrouter.ai', quality: 'catalog' },
        { domain: 'github.com', quality: 'official', url: 'https://github.com/deepseek-ai/DeepSeek-V3' }
    ]);
    assert.equal(officialGithub.independentCount, 2);
});

test('analyzeAgreement ตรวจจับราคาขัดแย้ง >2x ได้ถูกต้อง', () => {
    const ok = researcher.analyzeAgreement([
        { domain: 'openrouter.ai', outputUsdPer1M: 0.60 },
        { domain: 'github.com', outputUsdPer1M: 0.65 },
        { domain: 'models.dev', outputUsdPer1M: 0.60 }
    ]);
    assert.equal(ok.agreement, 'high');
    assert.equal(ok.medianOutputUsd, 0.60);

    const bad = researcher.analyzeAgreement([
        { domain: 'openrouter.ai', outputUsdPer1M: 0.60 },
        { domain: 'github.com', outputUsdPer1M: 3.00 },
        { domain: 'models.dev', outputUsdPer1M: 0.60 }
    ]);
    assert.equal(bad.agreement, 'conflict');
    assert.ok(bad.conflictReason && bad.conflictReason.includes('5x'));
});

test('researchModels จัดกลุ่มตามตระกูล (Family Grouping) และปรับคะแนนตาม effort suffix', async () => {
    researcher.clearCaches();
    const mockCatalogs = {
        openrouter: [{ id: 'openai/gpt-oss-120b', name: 'OpenAI GPT-OSS 120B', inputUsdPer1M: 0.15, outputUsdPer1M: 0.60, contextLength: 131072, description: 'Open-weight 120B model' }],
        litellm: { 'gpt-oss-120b': { id: 'gpt-oss-120b', provider: 'openai', inputUsdPer1M: 0.15, outputUsdPer1M: 0.60, contextLength: 131072 } },
        modelsdev: [{ id: 'gpt-oss-120b', provider: 'openai', name: 'GPT-OSS 120B', inputUsdPer1M: 0.15, outputUsdPer1M: 0.60, contextLength: 131072 }]
    };

    const models = [
        { id: 'gpt-oss-120b-low', name: 'GPT-OSS 120B (Low)', engine: 'agy', suggested: { q: { code: 76, analysis: 78, chat: 80 }, cost: 0.08 } },
        { id: 'gpt-oss-120b-high', name: 'GPT-OSS 120B (High)', engine: 'agy', suggested: { q: { code: 76, analysis: 78, chat: 80 }, cost: 0.08 } },
        { id: 'gemini-4-unknown-medium', name: 'Gemini 4 Unknown (Medium)', engine: 'agy', suggested: { q: { code: 90, analysis: 90, chat: 90 }, cost: 1.5 } }
    ];

    const res = await researcher.researchModels(models, { disableNetwork: true, skipCache: true, catalogData: mockCatalogs });
    assert.equal(res.length, 3);

    const low = res.find((m) => m.id === 'gpt-oss-120b-low');
    const high = res.find((m) => m.id === 'gpt-oss-120b-high');
    const unk = res.find((m) => m.id === 'gemini-4-unknown-medium');

    assert.equal(low.uniqueDomainCount, 3);
    assert.equal(low.sources.length, 3, 'ยังเก็บรายชื่อทั้ง 3 แคตตาล็อกไว้แสดงผลครบ');
    assert.equal(low.independentSourceCount, 1, '3 แคตตาล็อกนับเป็น 1 แหล่งอิสระ');
    assert.equal(low.meetsMinSources, false);
    assert.equal(high.uniqueDomainCount, 3);
    assert.equal(high.independentSourceCount, 1);
    assert.ok(high.scores.avgQ > low.scores.avgQ, 'high effort should have higher effective avgQ than low');
    assert.ok(high.pricing.effectiveCost > low.pricing.effectiveCost, 'high effort should have higher effective cost than low');
    assert.equal(unk.meetsMinSources, false);
    assert.equal(unk.uniqueDomainCount, 0);
    assert.ok(low.confidence <= 55, `catalog-only confidence should be capped at medium, got ${low.confidence}`);
    assert.ok(low.confidence > unk.confidence + 30, 'catalog-verified model must have higher confidence than 0-source model');

    // เมื่อมีเว็บผู้ผลิตเพิ่มเข้ามา ต้องได้ confidence สูงกว่ากรณีมีเฉพาะ 3 แคตตาล็อก
    const withVendor = await researcher.researchModel(models[0], {
        disableNetwork: true,
        skipCache: true,
        catalogData: mockCatalogs,
        extraSources: [
            { provider: 'official', domain: 'openai.com', quality: 'official', title: 'OpenAI GPT-OSS 120B', url: 'https://openai.com/gpt-oss-120b', outputUsdPer1M: 0.60 }
        ]
    });
    assert.equal(withVendor.sources.length, 4);
    assert.equal(withVendor.independentSourceCount, 2);
    assert.ok(withVendor.confidence > low.confidence, `with vendor (${withVendor.confidence}) must exceed catalogs-only (${low.confidence})`);

    const ranked = researcher.rankModels(res, { sortBy: 'confidence' });
    assert.equal(ranked[0].rank, 1);
    assert.ok(ranked[0].id.startsWith('gpt-oss-120b-'));
    assert.equal(ranked[2].id, 'gemini-4-unknown-medium');
});

test('rankModels: Claude+Gemini จัดอันดับรวมกันตามต้นทุน, DeepSeek แยกกลุ่มไม่มีอันดับ', () => {
    const mk = (id, engine, cost, avgQ) => ({ id, engine, confidence: 80, scores: { avgQ }, pricing: { effectiveCost: cost } });
    const ranked = researcher.rankModels([
        mk('deepseek-flash', 'deepseek', 0.05, 74),
        mk('gemini-4-neon-high', 'agy', 2, 96),
        mk('claude-code-haiku', 'claude-code', 0.15, 68),
        mk('claude-sonnet-5-5-low', 'agy', 1.33, 90)
    ], { sortBy: 'cost' });
    assert.deepEqual(ranked.map((m) => m.id), ['claude-code-haiku', 'claude-sonnet-5-5-low', 'gemini-4-neon-high', 'deepseek-flash']);
    assert.deepEqual(ranked.map((m) => m.rank), [1, 2, 3, null]);
    assert.equal(ranked[3].billing, 'pay-per-use');
    assert.equal(ranked[3].outsideRanking, true);
});
