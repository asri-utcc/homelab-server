'use strict';

const SAME_SITE_MAP = new Map([
  ['no_restriction', 'None'],
  ['none', 'None'],
  ['lax', 'Lax'],
  ['strict', 'Strict'],
  ['unspecified', 'Lax'],
]);

function normalizeSameSite(raw) {
  if (raw === null || raw === undefined || raw === '') return 'Lax';
  const key = String(raw).trim().toLowerCase();
  return SAME_SITE_MAP.get(key) || 'Lax';
}

function normalizeExpires(raw) {
  if (raw.session === true) return -1;
  if (typeof raw.expires === 'number' && Number.isFinite(raw.expires)) {
    return raw.expires;
  }
  if (typeof raw.expirationDate === 'number' && Number.isFinite(raw.expirationDate)) {
    return raw.expirationDate;
  }
  return -1;
}

function normalizeImportedCookie(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const domain = typeof raw.domain === 'string' ? raw.domain.trim() : '';
  if (!name || !domain) return null;

  const cookie = {
    name,
    value: raw.value !== undefined && raw.value !== null ? String(raw.value) : '',
    domain,
    path: typeof raw.path === 'string' && raw.path ? raw.path : '/',
    expires: normalizeExpires(raw),
    httpOnly: Boolean(raw.httpOnly),
    secure: Boolean(raw.secure),
    sameSite: normalizeSameSite(raw.sameSite),
  };

  if (typeof raw.partitionKey === 'string' && raw.partitionKey) {
    cookie.partitionKey = raw.partitionKey;
  }

  return cookie;
}

/**
 * Parse a cookie export JSON string (Playwright array, storageState { cookies },
 * or Cookie-Editor / EditThisCookie array) into normalized Playwright cookies.
 * @param {string} text
 * @returns {Array<object>}
 */
function parseCookieFile(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Cookie file is empty');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid cookie JSON: ${err.message}`);
  }

  let rawCookies;
  if (Array.isArray(parsed)) {
    rawCookies = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.cookies)) {
    rawCookies = parsed.cookies;
  } else {
    throw new Error('Unsupported cookie format: expected an array or { cookies: [...] }');
  }

  const result = [];
  for (const item of rawCookies) {
    const normalized = normalizeImportedCookie(item);
    if (normalized) result.push(normalized);
  }
  return result;
}

module.exports = {
  parseCookieFile,
  normalizeSameSite,
};
