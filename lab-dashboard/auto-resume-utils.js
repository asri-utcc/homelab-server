'use strict';

const MAX_RESET_WINDOW_MS = 8 * 24 * 3600 * 1000;
const DEFAULT_BUFFER_MS = 45 * 1000;

/**
 * Parse a quota reset timestamp or relative duration from error/CLI text.
 * Pure function (uses passed `now` instead of wall-clock Date.now()).
 *
 * @param {string} text
 * @param {number} [now=Date.now()]
 * @returns {{ resumeAt: number, source: 'error_text' } | null}
 */
function parseResetTimeFromText(text, now = Date.now()) {
    const raw = String(text || '');
    if (!raw) return null;
    const bufferMs = DEFAULT_BUFFER_MS;

    // 1) Explicit ISO timestamp
    const isoMatch = raw.match(/resets?(?:\s+at)?\s+(\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)/i);
    if (isoMatch) {
        const ms = Date.parse(isoMatch[1]);
        if (!Number.isNaN(ms) && ms > now && (ms - now) <= MAX_RESET_WINDOW_MS) {
            return { resumeAt: ms + bufferMs, source: 'error_text' };
        }
    }

    // 2) Relative duration: "try again in 45 minutes" / "resets in 2 hours 15 minutes" / "Resets in 5d 3h" / "resets in 125h"
    const relMatch = raw.match(
        /(?:resets?|try again|wait|available)\s+(?:in\s+)?(?:(\d+)\s*(?:days?|d|วัน)[\s,]*)?(?:(\d+)\s*(?:hours?|hrs?|hr|h|ชม\.?|ชั่วโมง)[\s,]*)?(?:(\d+)\s*(?:minutes?|mins?|min|m|นาที)[\s,]*)?(?:(\d+)\s*(?:seconds?|secs?|sec|s|วินาที))?/i
    );
    if (relMatch && (relMatch[1] || relMatch[2] || relMatch[3] || relMatch[4])) {
        const days = Number(relMatch[1] || 0);
        const hours = Number(relMatch[2] || 0);
        const mins = Number(relMatch[3] || 0);
        const secs = Number(relMatch[4] || 0);
        const ms = ((days * 86400) + (hours * 3600) + (mins * 60) + secs) * 1000;
        if (ms >= 5000 && ms <= MAX_RESET_WINDOW_MS) {
            return { resumeAt: now + ms + bufferMs, source: 'error_text' };
        }
    }

    // 3) Clock time: "resets 6am (Asia/Bangkok)" or "resets 14:30" or "resets at 11:15pm"
    const clkMatch = raw.match(
        /resets?(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?(?!\d|-)\s*(am|pm)?(?!\s*(?:days?|d|วัน|hours?|hrs?|hr|h|minutes?|mins?|min|m|seconds?|secs?|sec|s))(?:\s*\(([^)]+)\))?/i
    );
    if (clkMatch) {
        let hour = Number(clkMatch[1]);
        const min = Number(clkMatch[2] || 0);
        const ampm = clkMatch[3] ? clkMatch[3].toLowerCase() : null;
        const tz = clkMatch[4] ? clkMatch[4].trim() : '';
        if (ampm === 'pm' && hour < 12) hour += 12;
        if (ampm === 'am' && hour === 12) hour = 0;
        if (hour >= 0 && hour <= 23 && min >= 0 && min <= 59) {
            const d = new Date(now);
            if (/utc|gmt/i.test(tz)) {
                d.setUTCHours(hour, min, 0, 0);
            } else {
                d.setHours(hour, min, 0, 0);
            }
            let targetMs = d.getTime();
            if (targetMs <= now) targetMs += 24 * 3600 * 1000;
            if (targetMs > now && (targetMs - now) <= 25 * 3600 * 1000) {
                return { resumeAt: targetMs + bufferMs, source: 'error_text' };
            }
        }
    }

    return null;
}

function finiteNumberOrNull(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function laterResetTime(a, b) {
    if (!a && !b) return null;
    if (!a) return b;
    if (!b) return a;
    const msA = Date.parse(a);
    const msB = Date.parse(b);
    if (!Number.isNaN(msA) && !Number.isNaN(msB)) {
        return msA >= msB ? a : b;
    }
    if (!Number.isNaN(msA)) return a;
    if (!Number.isNaN(msB)) return b;
    return b || a;
}

/**
 * Evaluate quota usability across fiveHour and weekly windows.
 *
 * @param {object|null|undefined} windows
 * @param {number} [thresholdPct=5]
 * @returns {{ usable: boolean, exhaustedWindow: '5h'|'weekly'|null, resetTime: string|null, remainingPct: number|null }}
 */
function windowState(windows, thresholdPct = 5) {
    if (!windows || typeof windows !== 'object') {
        return { usable: false, exhaustedWindow: null, resetTime: null, remainingPct: null };
    }

    const fh = windows.fiveHour && typeof windows.fiveHour === 'object' ? windows.fiveHour : null;
    const wk = windows.weekly && typeof windows.weekly === 'object' ? windows.weekly : null;
    const fhPct = fh ? finiteNumberOrNull(fh.remainingPct) : null;
    const wkPct = wk ? finiteNumberOrNull(wk.remainingPct) : null;

    // Fallback when neither fiveHour nor weekly has numeric remainingPct
    if (fhPct === null && wkPct === null) {
        const basePct = finiteNumberOrNull(windows.remainingPct);
        const baseReset = windows.resetTime || null;
        if (basePct === null) {
            return { usable: false, exhaustedWindow: null, resetTime: baseReset, remainingPct: null };
        }
        if (basePct <= thresholdPct) {
            return { usable: false, exhaustedWindow: '5h', resetTime: baseReset, remainingPct: basePct };
        }
        return { usable: true, exhaustedWindow: null, resetTime: baseReset, remainingPct: basePct };
    }

    const fhExhausted = fhPct !== null && fhPct <= thresholdPct;
    const wkExhausted = wkPct !== null && wkPct <= thresholdPct;
    const pcts = [fhPct, wkPct].filter((v) => v !== null);
    const minPct = Math.min(...pcts);

    const fhReset = (fh && fh.resetTime) || null;
    const wkReset = (wk && wk.resetTime) || null;

    if (fhExhausted && wkExhausted) {
        return {
            usable: false,
            exhaustedWindow: 'weekly',
            resetTime: laterResetTime(fhReset, wkReset) || windows.resetTime || null,
            remainingPct: minPct,
        };
    }
    if (wkExhausted) {
        return {
            usable: false,
            exhaustedWindow: 'weekly',
            resetTime: wkReset || windows.resetTime || null,
            remainingPct: minPct,
        };
    }
    if (fhExhausted) {
        return {
            usable: false,
            exhaustedWindow: '5h',
            resetTime: fhReset || windows.resetTime || null,
            remainingPct: minPct,
        };
    }

    return {
        usable: true,
        exhaustedWindow: null,
        resetTime: laterResetTime(fhReset, wkReset) || windows.resetTime || null,
        remainingPct: minPct,
    };
}

/**
 * Evaluate an AGY pool object. Missing pool is treated as unusable.
 *
 * @param {object|null|undefined} pool
 * @param {number} [thresholdPct=5]
 */
function poolWindowState(pool, thresholdPct = 5) {
    if (!pool || typeof pool !== 'object') {
        return { usable: false, exhaustedWindow: null, resetTime: null, remainingPct: null, missing: true };
    }
    return windowState(pool, thresholdPct);
}

/**
 * Determine whether auto-resume should start a fresh CLI conversation
 * instead of resuming a huge history context.
 *
 * @param {{ historyChars?: number, threshold?: number }} [opts]
 * @returns {boolean}
 */
function shouldUseFreshConversation({ historyChars = 0, threshold = 150000 } = {}) {
    return Number(historyChars || 0) > Number(threshold);
}

/**
 * Build a compact digest of recent conversation messages for fresh-conversation resume.
 *
 * @param {Array<{ role?: string, content?: string, text?: string }>} messages
 * @param {{ maxItems?: number, perItem?: number, maxChars?: number }} [opts]
 * @returns {string}
 */
function buildRecentHistoryDigest(messages, { maxItems = 6, perItem = 600, maxChars = 4000 } = {}) {
    if (!Array.isArray(messages) || messages.length === 0) return '';
    const recent = messages.slice(-Math.max(1, maxItems));
    const lines = [];
    for (const m of recent) {
        if (!m || typeof m !== 'object') continue;
        const label = (m.role === 'assistant' || m.role === 'model') ? '[ผู้ช่วย]' : '[ผู้ใช้]';
        const rawText = String(m.content ?? m.text ?? '').replace(/\s+/g, ' ').trim();
        if (!rawText) continue;
        const clipped = rawText.length > perItem ? rawText.slice(0, perItem) : rawText;
        lines.push(`${label} ${clipped}`);
    }
    if (lines.length === 0) return '';
    const joined = lines.join('\n');
    return joined.length > maxChars ? joined.slice(0, maxChars) : joined;
}

module.exports = {
    parseResetTimeFromText,
    windowState,
    poolWindowState,
    shouldUseFreshConversation,
    buildRecentHistoryDigest,
};
