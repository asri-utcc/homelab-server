'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Normalize/finalize a token usage object so totalTokens is always consistent.
 * Note: For both Claude and DeepSeek, outputTokens already includes thinking/reasoning tokens,
 * so totalTokens = inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens.
 */
function finalizeTokenUsage(u) {
    if (!u || typeof u !== 'object') return null;
    const inputTokens = Math.max(0, Number(u.inputTokens || 0));
    const cacheReadTokens = Math.max(0, Number(u.cacheReadTokens || 0));
    const cacheWriteTokens = Math.max(0, Number(u.cacheWriteTokens || 0));
    const outputTokens = Math.max(0, Number(u.outputTokens || 0));
    const thinkingTokens = Math.max(0, Number(u.thinkingTokens || 0));
    const contextTokens = Math.max(0, Number(u.contextTokens || 0));
    const calls = Math.max(0, Number(u.calls || 0));
    const totalTokens = inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens;
    const out = {
        inputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        outputTokens,
        thinkingTokens,
        totalTokens,
        contextTokens,
        calls,
        source: u.source || 'unknown'
    };
    if (typeof u.costUsd === 'number' && Number.isFinite(u.costUsd) && u.costUsd >= 0) {
        out.costUsd = Number(u.costUsd.toFixed(6));
    }
    if (u.model) out.model = String(u.model);
    return out;
}

/**
 * Sum two tokenUsage objects into a new finalized tokenUsage object.
 */
function mergeTokenUsages(base, add, sourceOverride = null) {
    if (!add && !base) return null;
    if (!add) return finalizeTokenUsage(base);
    if (!base) return finalizeTokenUsage(sourceOverride ? { ...add, source: sourceOverride } : add);
    const merged = {
        inputTokens: (base.inputTokens || 0) + (add.inputTokens || 0),
        cacheReadTokens: (base.cacheReadTokens || 0) + (add.cacheReadTokens || 0),
        cacheWriteTokens: (base.cacheWriteTokens || 0) + (add.cacheWriteTokens || 0),
        outputTokens: (base.outputTokens || 0) + (add.outputTokens || 0),
        thinkingTokens: (base.thinkingTokens || 0) + (add.thinkingTokens || 0),
        contextTokens: Math.max(base.contextTokens || 0, add.contextTokens || 0),
        calls: (base.calls || 0) + (add.calls || 0),
        source: sourceOverride || add.source || base.source || 'merged'
    };
    if (typeof base.costUsd === 'number' || typeof add.costUsd === 'number') {
        merged.costUsd = (base.costUsd || 0) + (add.costUsd || 0);
    }
    return finalizeTokenUsage(merged);
}

/**
 * Read per-turn token usage from an Antigravity (agy) brain transcript.jsonl.
 * Filters PLANNER_RESPONSE / token-bearing rows created at or after sinceMs.
 */
function readAgyTurnUsage(sinceMs = 0, agyConversationId = null, brainDir = null) {
    try {
        if (!brainDir || !fs.existsSync(brainDir)) return null;
        let targetDir = null;
        if (agyConversationId && fs.existsSync(path.join(brainDir, agyConversationId))) {
            targetDir = path.join(brainDir, agyConversationId);
        } else {
            const subdirs = fs.readdirSync(brainDir)
                .map((d) => path.join(brainDir, d))
                .filter((p) => {
                    try { return fs.statSync(p).isDirectory(); } catch (_) { return false; }
                });
            if (!subdirs.length) return null;
            subdirs.sort((a, b) => {
                try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch (_) { return 0; }
            });
            targetDir = subdirs[0];
        }

        const logsDir = path.join(targetDir, '.system_generated/logs');
        const compactFile = path.join(logsDir, 'transcript.jsonl');
        const fullFile = path.join(logsDir, 'transcript_full.jsonl');
        const tFile = fs.existsSync(compactFile) ? compactFile : fullFile;
        if (!fs.existsSync(tFile)) return null;

        const stat = fs.statSync(tFile);
        if (!stat.size) return null;
        const maxRead = 512 * 1024;
        const readSize = Math.min(stat.size, maxRead);
        const buf = Buffer.alloc(readSize);
        const fd = fs.openSync(tFile, 'r');
        try {
            fs.readSync(fd, buf, 0, readSize, Math.max(0, stat.size - readSize));
        } finally {
            fs.closeSync(fd);
        }

        const lines = buf.toString('utf8').split('\n');
        if (stat.size > readSize && lines.length > 0) lines.shift();

        const cutoffMs = sinceMs ? (sinceMs - 3000) : 0;
        let inputTokens = 0;
        let cacheReadTokens = 0;
        let cacheWriteTokens = 0;
        let outputTokens = 0;
        let thinkingTokens = 0;
        let contextTokens = 0;
        let calls = 0;
        let lastModel = null;

        for (const rawLine of lines) {
            const raw = rawLine.trim();
            if (!raw) continue;
            let obj;
            try { obj = JSON.parse(raw); } catch (_) { continue; }
            const ts = obj.created_at ? new Date(obj.created_at).getTime() : 0;
            if (cutoffMs && ts && ts < cutoffMs) continue;

            const hasTok = obj.input_tokens !== undefined || obj.output_tokens !== undefined || obj.cache_read_tokens !== undefined;
            if (!hasTok) continue;

            const inp = Number(obj.input_tokens || 0);
            const cr = Number(obj.cache_read_tokens || 0);
            const cw = Number(obj.cache_creation_tokens || obj.cache_write_tokens || 0);
            const out = Number(obj.output_tokens || 0);
            const thk = Number(obj.thinking_tokens || obj.thought_tokens || 0);

            inputTokens += inp;
            cacheReadTokens += cr;
            cacheWriteTokens += cw;
            outputTokens += out;
            thinkingTokens += thk;
            contextTokens = inp + cr + cw;
            calls++;
            if (obj.model) lastModel = String(obj.model);
        }

        if (calls === 0) return null;
        return finalizeTokenUsage({
            inputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            outputTokens,
            thinkingTokens,
            contextTokens,
            calls,
            model: lastModel,
            source: 'agy-transcript'
        });
    } catch (_) {
        return null;
    }
}

/**
 * Convert an Anthropic/Claude usage object into our normalized delta shape.
 */
function normalizeClaudeUsage(u, calls = 1, costUsd = null, model = null) {
    if (!u || typeof u !== 'object') return null;
    const inputTokens = Number(u.input_tokens || 0);
    const cacheReadTokens = Number(u.cache_read_input_tokens || 0);
    const cacheWriteTokens = Number(u.cache_creation_input_tokens || 0);
    const outputTokens = Number(u.output_tokens || 0);
    const thinkingTokens = Number((u.output_tokens_details && u.output_tokens_details.thinking_tokens) || u.thinking_tokens || 0);
    return finalizeTokenUsage({
        inputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        outputTokens,
        thinkingTokens,
        contextTokens: inputTokens + cacheReadTokens + cacheWriteTokens,
        calls,
        costUsd,
        model,
        source: 'claude-stream'
    });
}

/**
 * Convert a DeepSeek/OpenAI usage object into our normalized shape.
 */
function normalizeDeepSeekUsage(u, model = null) {
    if (!u || typeof u !== 'object') return null;
    const promptTokens = Number(u.prompt_tokens || 0);
    const cacheReadTokens = Number(u.prompt_cache_hit_tokens || 0);
    const inputTokens = u.prompt_cache_miss_tokens !== undefined
        ? Number(u.prompt_cache_miss_tokens || 0)
        : Math.max(0, promptTokens - cacheReadTokens);
    const outputTokens = Number(u.completion_tokens || 0);
    const thinkingTokens = Number((u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0);
    return finalizeTokenUsage({
        inputTokens,
        cacheReadTokens,
        cacheWriteTokens: 0,
        outputTokens,
        thinkingTokens,
        contextTokens: promptTokens,
        calls: 1,
        model,
        source: 'deepseek-api'
    });
}

module.exports = {
    finalizeTokenUsage,
    mergeTokenUsages,
    readAgyTurnUsage,
    normalizeClaudeUsage,
    normalizeDeepSeekUsage
};
