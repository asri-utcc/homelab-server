'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tokenUsage = require('../token-usage');

// 1. finalizeTokenUsage & mergeTokenUsages
{
    const a = tokenUsage.finalizeTokenUsage({
        inputTokens: 1000,
        cacheReadTokens: 2000,
        cacheWriteTokens: 500,
        outputTokens: 300,
        thinkingTokens: 120,
        contextTokens: 3500,
        calls: 1,
        costUsd: 0.015,
        source: 'claude-stream'
    });
    assert.strictEqual(a.totalTokens, 3800, 'totalTokens = input + cacheRead + cacheWrite + output (thinking is subset)');
    assert.strictEqual(a.thinkingTokens, 120);

    const b = tokenUsage.finalizeTokenUsage({
        inputTokens: 400,
        cacheReadTokens: 3500,
        outputTokens: 200,
        contextTokens: 3900,
        calls: 1,
        costUsd: 0.005,
        source: 'claude-stream'
    });

    const m = tokenUsage.mergeTokenUsages(a, b, 'cross-team');
    assert.strictEqual(m.inputTokens, 1400);
    assert.strictEqual(m.cacheReadTokens, 5500);
    assert.strictEqual(m.cacheWriteTokens, 500);
    assert.strictEqual(m.outputTokens, 500);
    assert.strictEqual(m.totalTokens, 7900);
    assert.strictEqual(m.contextTokens, 3900);
    assert.strictEqual(m.calls, 2);
    assert.strictEqual(m.costUsd, 0.02);
    assert.strictEqual(m.source, 'cross-team');
}

// 2. normalizeClaudeUsage
{
    const c = tokenUsage.normalizeClaudeUsage({
        input_tokens: 12,
        cache_read_input_tokens: 10000,
        cache_creation_input_tokens: 2000,
        output_tokens: 450,
        output_tokens_details: { thinking_tokens: 180 }
    }, 3, 0.042, 'claude-code-opus');
    assert.strictEqual(c.inputTokens, 12);
    assert.strictEqual(c.cacheReadTokens, 10000);
    assert.strictEqual(c.cacheWriteTokens, 2000);
    assert.strictEqual(c.outputTokens, 450);
    assert.strictEqual(c.thinkingTokens, 180);
    assert.strictEqual(c.totalTokens, 12462);
    assert.strictEqual(c.contextTokens, 12012);
    assert.strictEqual(c.calls, 3);
    assert.strictEqual(c.costUsd, 0.042);
}

// 3. normalizeDeepSeekUsage
{
    const d = tokenUsage.normalizeDeepSeekUsage({
        prompt_tokens: 5000,
        prompt_cache_hit_tokens: 4200,
        prompt_cache_miss_tokens: 800,
        completion_tokens: 600,
        completion_tokens_details: { reasoning_tokens: 350 }
    }, 'deepseek-v4-pro');
    assert.strictEqual(d.inputTokens, 800);
    assert.strictEqual(d.cacheReadTokens, 4200);
    assert.strictEqual(d.outputTokens, 600);
    assert.strictEqual(d.thinkingTokens, 350);
    assert.strictEqual(d.totalTokens, 5600);
    assert.strictEqual(d.contextTokens, 5000);
    assert.strictEqual(d.calls, 1);
}

// 4. readAgyTurnUsage with time-window filtering
{
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-test-'));
    const convId = 'conv-123';
    const logsDir = path.join(tmp, convId, '.system_generated', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const now = Date.now();
    const lines = [
        JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', created_at: new Date(now - 60000).toISOString(), model: 'gemini-4-hydrogen-high', input_tokens: 9999, cache_read_tokens: 0, output_tokens: 999 }),
        JSON.stringify({ step_index: 2, type: 'PLANNER_RESPONSE', created_at: new Date(now - 1000).toISOString(), model: 'gemini-4-hydrogen-high', input_tokens: 1500, cache_read_tokens: 5000, output_tokens: 250 }),
        JSON.stringify({ step_index: 3, type: 'PLANNER_RESPONSE', created_at: new Date(now).toISOString(), model: 'gemini-4-hydrogen-high', input_tokens: 700, cache_read_tokens: 6500, output_tokens: 150 })
    ];
    fs.writeFileSync(path.join(logsDir, 'transcript.jsonl'), lines.join('\n') + '\n');
    const u = tokenUsage.readAgyTurnUsage(now - 1500, convId, tmp);
    assert.ok(u, 'should read usage');
    assert.strictEqual(u.calls, 2, 'should exclude earlier turn outside cutoff');
    assert.strictEqual(u.inputTokens, 2200);
    assert.strictEqual(u.cacheReadTokens, 11500);
    assert.strictEqual(u.outputTokens, 400);
    assert.strictEqual(u.totalTokens, 14100);
    assert.strictEqual(u.contextTokens, 7200);
    assert.strictEqual(u.model, 'gemini-4-hydrogen-high');
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('✅ token-usage.test.js passed');
