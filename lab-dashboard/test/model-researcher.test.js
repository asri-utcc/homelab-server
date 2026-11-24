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
            { domain: 'github.com', quality: 'catalog', outputUsdPer1M: 0.6 },
            { domain: 'models.dev', quality: 'catalog', outputUsdPer1M: 0.6 }
        ],
        agreement: 'high',
        hasIntelligence: true,
        hasPricing: true
    });
    assert.equal(threeAgreed.meetsMinSources, true);
    assert.ok(threeAgreed.score >= 85, `3 agreed catalog sources should score high, got ${threeAgreed.score}`);
    assert.equal(threeAgreed.breakdown.base, 76);
    assert.equal(threeAgreed.breakdown.agreementDelta, 8);
    assert.equal(threeAgreed.breakdown.completenessDelta, 4);

    const conflicted = researcher.computeConfidenceScore({
        uniqueSources: [
            { domain: 'openrouter.ai', quality: 'catalog', outputUsdPer1M: 0.5 },
            { domain: 'github.com', quality: 'catalog', outputUsdPer1M: 5.0 },
            { domain: 'models.dev', quality: 'catalog', outputUsdPer1M: 1.0 }
        ],
        agreement: 'conflict',
        hasIntelligence: true,
        hasPricing: true
    });
    assert.ok(conflicted.score < threeAgreed.score - 20, 'conflict must drop confidence sharply');
    assert.equal(conflicted.breakdown.agreementDelta, -20);
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

    assert.equal(low.meetsMinSources, true);
    assert.equal(low.uniqueDomainCount, 3);
    assert.equal(high.uniqueDomainCount, 3);
    assert.ok(high.scores.avgQ > low.scores.avgQ, 'high effort should have higher effective avgQ than low');
    assert.ok(high.pricing.effectiveCost > low.pricing.effectiveCost, 'high effort should have higher effective cost than low');
    assert.equal(unk.meetsMinSources, false);
    assert.equal(unk.uniqueDomainCount, 0);
    assert.ok(low.confidence > unk.confidence + 40, '3-source verified model must have much higher confidence than 0-source model');

    const ranked = researcher.rankModels(res, { sortBy: 'confidence' });
    assert.equal(ranked[0].rank, 1);
    assert.ok(ranked[0].id.startsWith('gpt-oss-120b-'));
    assert.equal(ranked[2].id, 'gemini-4-unknown-medium');
});
