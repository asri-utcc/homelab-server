'use strict';

const fs = require('fs');
const path = require('path');

const BASE_DIR = '/home/dev/.local/share/lab-browser';
const STATE_DIR = path.join(BASE_DIR, 'state');
const PROFILES_DIR = path.join(BASE_DIR, 'profiles');
const AUTH_DIR = path.join(BASE_DIR, 'auth');
const OUTPUT_DIR = '/home/dev/.gemini/outputs/browser';
const BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/home/dev/.cache/ms-playwright';

function parseEnvInt(raw, fallback, min = 0) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.floor(n);
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_IDLE_TTL_SEC = 600; // 10 minutes
const DEFAULT_MAX_CHARS = 12000;
const MAX_CHAT_BROWSERS = parseEnvInt(process.env.LAB_BROWSER_MAX_CHAT_BROWSERS, 5, 1);
const MIN_FREE_MB_FOR_CHAT_BROWSER = parseEnvInt(process.env.LAB_BROWSER_MIN_FREE_MB, 1200, 0);

const VIEWPORT_PRESETS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  laptop: { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  tablet: { width: 768, height: 1024, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const BLOCKED_SCHEMES = new Set([
  'file:',
  'javascript:',
  'data:',
  'chrome:',
  'chrome-extension:',
  'about:',
  'view-source:',
  'vbscript:',
]);

function ensureDirs(opts = {}) {
  for (const dir of [STATE_DIR, PROFILES_DIR, OUTPUT_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (opts.includeAuth !== false) {
    fs.mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(AUTH_DIR, 0o700);
    } catch (_) {
      // ignore chmod errors
    }
  }
}

function sanitizeSessionName(name) {
  const raw = String(name || 'default').trim() || 'default';
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(raw)) {
    throw new Error(`Invalid session name "${raw}" (allowed: a-z, A-Z, 0-9, _, -, max 32 chars)`);
  }
  return raw;
}

function sanitizeAuthProfile(name) {
  const raw = String(name || 'shared').trim() || 'shared';
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(raw)) {
    throw new Error(`Invalid auth profile "${raw}" (allowed: a-z, A-Z, 0-9, _, -, max 32 chars)`);
  }
  return raw;
}

function isLocalLikeHost(candidate) {
  return /^(localhost|127\.0\.0\.1|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[a-z0-9-]+\.local(?::|\/|$)|[a-z0-9-]+:\d+)/i.test(candidate);
}

function normalizeUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    throw new Error('Missing URL');
  }
  const lower = trimmed.toLowerCase();
  for (const scheme of BLOCKED_SCHEMES) {
    if (lower.startsWith(scheme)) {
      throw new Error(`Blocked URL scheme "${scheme}" — only http:// and https:// are permitted`);
    }
  }
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
    ? trimmed
    : `${isLocalLikeHost(trimmed) ? 'http' : 'https'}://${trimmed}`;

  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch (_) {
    throw new Error(`Invalid URL: "${trimmed}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported URL protocol "${parsed.protocol}" — only http:// and https:// are permitted`);
  }
  return parsed.toString();
}

function parseViewport(opts = {}) {
  let base = { ...VIEWPORT_PRESETS.desktop };
  if (opts.mobile) base = { ...VIEWPORT_PRESETS.mobile };
  else if (opts.tablet) base = { ...VIEWPORT_PRESETS.tablet };
  else if (opts.laptop) base = { ...VIEWPORT_PRESETS.laptop };
  else if (opts.desktop) base = { ...VIEWPORT_PRESETS.desktop };

  if (opts.viewport) {
    const m = String(opts.viewport).match(/^(\d{2,5})x(\d{2,5})$/i);
    if (!m) {
      throw new Error(`Invalid --viewport "${opts.viewport}" (expected WxH, e.g. 1440x900)`);
    }
    base.width = Math.max(200, Math.min(4096, Number(m[1])));
    base.height = Math.max(200, Math.min(4096, Number(m[2])));
  }
  if (opts.dpr !== undefined) {
    const dpr = Number(opts.dpr);
    if (!Number.isFinite(dpr) || dpr < 0.5 || dpr > 4) {
      throw new Error(`Invalid --dpr "${opts.dpr}" (expected 0.5..4)`);
    }
    base.deviceScaleFactor = dpr;
  }
  return base;
}

function formatTimestamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function urlSlug(urlStr) {
  try {
    const u = new URL(urlStr);
    const decodedPath = (() => {
      try {
        return decodeURIComponent(u.pathname);
      } catch (_) {
        return u.pathname;
      }
    })();
    const asciiPath = decodedPath === '/' ? '' : decodedPath.replace(/[^\x20-\x7E]/g, '');
    const raw = `${u.hostname}${asciiPath}`;
    return raw.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || u.hostname || 'page';
  } catch (_) {
    return 'page';
  }
}

function resolveOutputPath(outArg, urlStr, ext = 'png') {
  ensureDirs({ includeAuth: false });
  if (outArg) {
    const resolved = path.resolve(String(outArg));
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    return resolved;
  }
  const cleanExt = String(ext || 'png').replace(/^\./, '').toLowerCase();
  const filename = `${formatTimestamp()}_${urlSlug(urlStr)}.${cleanExt}`;
  return path.join(OUTPUT_DIR, filename);
}

function getFreeMemMb() {
  try {
    const info = fs.readFileSync('/proc/meminfo', 'utf8');
    const avail = info.match(/^MemAvailable:\s+(\d+)\s+kB/m);
    if (avail) return Math.round(Number(avail[1]) / 1024);
  } catch (_) {
    // ignore on non-Linux
  }
  return null;
}

module.exports = {
  BASE_DIR,
  STATE_DIR,
  PROFILES_DIR,
  AUTH_DIR,
  OUTPUT_DIR,
  BROWSERS_PATH,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_IDLE_TTL_SEC,
  DEFAULT_MAX_CHARS,
  MAX_CHAT_BROWSERS,
  MIN_FREE_MB_FOR_CHAT_BROWSER,
  VIEWPORT_PRESETS,
  ensureDirs,
  sanitizeSessionName,
  sanitizeAuthProfile,
  normalizeUrl,
  parseViewport,
  resolveOutputPath,
  getFreeMemMb,
};
