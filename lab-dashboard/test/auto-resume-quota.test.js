'use strict';
// ทดสอบ pure helpers สำหรับระบบ auto-resume quota:  node --test test/auto-resume-quota.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parseResetTimeFromText,
    windowState,
    poolWindowState,
    shouldUseFreshConversation,
    buildRecentHistoryDigest,
} = require('../auto-resume-utils');

const NOW = Date.UTC(2026, 10, 27, 10, 0, 0); // 2026-11-27T10:00:00.000Z
const BUFFER_MS = 45 * 1000;

test('parseResetTimeFromText: ISO timestamp within 8 days', () => {
    const targetIso = '2026-11-28T12:30:00Z';
    const expectedMs = Date.parse(targetIso) + BUFFER_MS;
    const res = parseResetTimeFromText(`Quota exhausted, resets at ${targetIso}`, NOW);
    assert.deepEqual(res, { resumeAt: expectedMs, source: 'error_text' });

    const tooFarIso = '2026-12-10T00:00:00Z'; // > 8 days
    assert.equal(parseResetTimeFromText(`resets at ${tooFarIso}`, NOW), null);
});

test('parseResetTimeFromText: relative durations including hours/minutes, days, 125h, and >8d rejection', () => {
    // 2 hours 15 minutes
    const r1 = parseResetTimeFromText('Limit reached, resets in 2 hours 15 minutes.', NOW);
    assert.equal(r1.source, 'error_text');
    assert.equal(r1.resumeAt, NOW + ((2 * 3600 + 15 * 60) * 1000) + BUFFER_MS);

    // 5d 3h
    const r2 = parseResetTimeFromText('Resets in 5d 3h', NOW);
    assert.equal(r2.source, 'error_text');
    const expected5d3h = (5 * 86400 + 3 * 3600) * 1000;
    assert.ok(Math.abs((r2.resumeAt - NOW) - (expected5d3h + BUFFER_MS)) <= 1000);

    // 2 days 4 hours
    const r3 = parseResetTimeFromText('resets in 2 days 4 hours', NOW);
    assert.equal(r3.resumeAt, NOW + ((2 * 86400 + 4 * 3600) * 1000) + BUFFER_MS);

    // 125h (approx 5.2 days, within 8-day cap)
    const r4 = parseResetTimeFromText('try again in 125h', NOW);
    assert.equal(r4.source, 'error_text');
    assert.equal(r4.resumeAt, NOW + (125 * 3600 * 1000) + BUFFER_MS);

    // 9d (> 8 days) must return null
    assert.equal(parseResetTimeFromText('resets in 9d', NOW), null);
    assert.equal(parseResetTimeFromText('resets 9d', NOW), null);
});

test('parseResetTimeFromText: clock time "resets 6am"', () => {
    const res = parseResetTimeFromText('Quota exceeded, resets 6am (UTC)', NOW);
    assert.ok(res);
    assert.equal(res.source, 'error_text');
    // NOW is 10:00 UTC on Nov 27, so next 6am UTC is Nov 28 06:00 UTC
    const expected = Date.UTC(2026, 10, 28, 6, 0, 0) + BUFFER_MS;
    assert.equal(res.resumeAt, expected);
});

test('poolWindowState & windowState: fiveHour healthy + weekly exhausted => unusable weekly', () => {
    const pool = {
        id: 'claude',
        fiveHour: { remainingPct: 80, resetTime: '2026-11-27T15:00:00Z' },
        weekly: { remainingPct: 0, resetTime: '2026-12-02T00:00:00Z' },
    };
    const st = poolWindowState(pool);
    assert.equal(st.usable, false);
    assert.equal(st.exhaustedWindow, 'weekly');
    assert.equal(st.resetTime, '2026-12-02T00:00:00Z');
    assert.equal(st.remainingPct, 0);
});

test('poolWindowState & windowState: both windows exhausted => picks later resetTime and weekly', () => {
    const pool = {
        id: 'claude',
        fiveHour: { remainingPct: 0, resetTime: '2026-11-27T15:00:00Z' },
        weekly: { remainingPct: 2, resetTime: '2026-12-03T04:00:00Z' },
    };
    const st = poolWindowState(pool);
    assert.equal(st.usable, false);
    assert.equal(st.exhaustedWindow, 'weekly');
    assert.equal(st.resetTime, '2026-12-03T04:00:00Z');
    assert.equal(st.remainingPct, 0);

    // Even if fiveHour resetTime is somehow later, picks the later one
    const stLaterFh = windowState({
        fiveHour: { remainingPct: 1, resetTime: '2026-12-05T00:00:00Z' },
        weekly: { remainingPct: 3, resetTime: '2026-12-01T00:00:00Z' },
    });
    assert.equal(stLaterFh.usable, false);
    assert.equal(stLaterFh.exhaustedWindow, 'weekly');
    assert.equal(stLaterFh.resetTime, '2026-12-05T00:00:00Z');
});

test('poolWindowState: undefined/null pool => usable false with missing:true', () => {
    const st1 = poolWindowState(undefined);
    assert.equal(st1.usable, false);
    assert.equal(st1.missing, true);
    assert.equal(st1.exhaustedWindow, null);

    const st2 = poolWindowState(null);
    assert.equal(st2.usable, false);
    assert.equal(st2.missing, true);
});

test('poolWindowState: both windows healthy => usable true', () => {
    const pool = {
        id: 'gemini',
        fiveHour: { remainingPct: 75, resetTime: '2026-11-27T15:00:00Z' },
        weekly: { remainingPct: 40, resetTime: '2026-12-02T00:00:00Z' },
    };
    const st = poolWindowState(pool);
    assert.equal(st.usable, true);
    assert.equal(st.exhaustedWindow, null);
    assert.equal(st.remainingPct, 40);
});

test('shouldUseFreshConversation: triggers only above threshold (default 150000)', () => {
    assert.equal(shouldUseFreshConversation({ historyChars: 0 }), false);
    assert.equal(shouldUseFreshConversation({ historyChars: 150000 }), false);
    assert.equal(shouldUseFreshConversation({ historyChars: 150001 }), true);
    assert.equal(shouldUseFreshConversation({ historyChars: 500, threshold: 400 }), true);
});

test('buildRecentHistoryDigest: formats last maxItems, collapses whitespace, and caps lengths', () => {
    assert.equal(buildRecentHistoryDigest(null), '');
    assert.equal(buildRecentHistoryDigest([]), '');

    const msgs = [];
    for (let i = 1; i <= 8; i++) {
        msgs.push({
            role: i % 2 === 1 ? 'user' : 'assistant',
            content: `msg-${i}   with\n\nwhitespace ` + 'x'.repeat(700),
        });
    }
    const digest = buildRecentHistoryDigest(msgs);
    const lines = digest.split('\n');
    assert.equal(lines.length, 6);
    assert.ok(lines[0].startsWith('[ผู้ใช้] msg-3 with whitespace '));
    assert.ok(lines[1].startsWith('[ผู้ช่วย] msg-4 with whitespace '));
    for (const line of lines) {
        // prefix '[ผู้ใช้] ' (10 chars) or '[ผู้ช่วย] ' (11 chars) + max 600 chars
        assert.ok(line.length <= 611, `line too long: ${line.length}`);
    }

    const capped = buildRecentHistoryDigest(msgs, { maxItems: 6, perItem: 600, maxChars: 1200 });
    assert.ok(capped.length <= 1200);
});
