'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const DEFAULT_PROFILE = 'shared';
const DEFAULT_TOMBSTONE_TTL_MS = 60 * 60 * 1000; // 1 hour
const SCHEMA_VERSION = 1;
const LOCK_TIMEOUT_MS = 3000;
const STALE_LOCK_MS = 10000;
const VALID_SAME_SITE = new Set(['Strict', 'Lax', 'None']);

const SLEEP_ARRAY = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(ms) {
  Atomics.wait(SLEEP_ARRAY, 0, 0, Math.max(1, ms));
}

function getProfilePath(profile = DEFAULT_PROFILE) {
  const clean = config.sanitizeAuthProfile(profile);
  return path.join(config.AUTH_DIR, `${clean}.json`);
}

function getLockPath(profile = DEFAULT_PROFILE) {
  const clean = config.sanitizeAuthProfile(profile);
  return path.join(config.AUTH_DIR, `${clean}.lock`);
}

function ensureAuthDir() {
  fs.mkdirSync(config.AUTH_DIR, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(config.AUTH_DIR, 0o700);
  } catch (_) {
    // ignore chmod errors
  }
}

function cookieKey(cookie) {
  if (!cookie || typeof cookie !== 'object') return '';
  const name = typeof cookie.name === 'string' ? cookie.name : '';
  const domain = typeof cookie.domain === 'string' ? cookie.domain.toLowerCase() : '';
  const cookiePath = typeof cookie.path === 'string' && cookie.path ? cookie.path : '/';
  if (!name || !domain) return '';
  return `${domain}\u001f${cookiePath}\u001f${name}`;
}

function normalizeCookie(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name : '';
  const domain = typeof raw.domain === 'string' ? raw.domain : '';
  if (!name || !domain) return null;

  const sameSite = VALID_SAME_SITE.has(raw.sameSite) ? raw.sameSite : 'Lax';
  const expires = typeof raw.expires === 'number' && Number.isFinite(raw.expires)
    ? raw.expires
    : -1;

  const cookie = {
    name,
    value: raw.value !== undefined && raw.value !== null ? String(raw.value) : '',
    domain,
    path: typeof raw.path === 'string' && raw.path ? raw.path : '/',
    expires,
    httpOnly: Boolean(raw.httpOnly),
    secure: Boolean(raw.secure),
    sameSite,
  };
  if (typeof raw.partitionKey === 'string' && raw.partitionKey) {
    cookie.partitionKey = raw.partitionKey;
  }
  return cookie;
}

function isCookieExpired(cookie, nowMs) {
  return typeof cookie.expires === 'number' && cookie.expires > 0 && cookie.expires * 1000 <= nowMs;
}

function cookieFingerprint(cookie) {
  if (!cookie || typeof cookie !== 'object') return '';
  const payload = JSON.stringify([
    cookie.value !== undefined && cookie.value !== null ? String(cookie.value) : '',
    typeof cookie.expires === 'number' && Number.isFinite(cookie.expires) ? cookie.expires : -1,
    Boolean(cookie.httpOnly),
    Boolean(cookie.secure),
    VALID_SAME_SITE.has(cookie.sameSite) ? cookie.sameSite : 'Lax',
    typeof cookie.partitionKey === 'string' ? cookie.partitionKey : '',
  ]);
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
}

function normalizeOrigin(raw, existing) {
  if (!raw || typeof raw !== 'object' || typeof raw.origin !== 'string' || !raw.origin) {
    return null;
  }
  const localStorage = Array.isArray(raw.localStorage)
    ? raw.localStorage
      .filter((item) => item && typeof item.name === 'string')
      .map((item) => ({
        name: item.name,
        value: item.value !== undefined && item.value !== null ? String(item.value) : '',
      }))
    : [];

  const result = {
    origin: raw.origin,
    localStorage,
  };
  if (Array.isArray(raw.indexedDB)) {
    result.indexedDB = raw.indexedDB;
  } else if (existing && Array.isArray(existing.indexedDB)) {
    result.indexedDB = existing.indexedDB;
  }
  return result;
}

function isOriginEmpty(originObj) {
  const hasLs = Array.isArray(originObj.localStorage) && originObj.localStorage.length > 0;
  const hasIdb = Array.isArray(originObj.indexedDB) && originObj.indexedDB.length > 0;
  return !hasLs && !hasIdb;
}

function createEmptyState(profile) {
  return {
    schemaVersion: SCHEMA_VERSION,
    profile,
    version: 0,
    updatedAt: null,
    clearedAtVersion: 0,
    cookies: [],
    origins: [],
    tombstones: {},
    cookieMeta: {},
  };
}

function quarantineCorruptFile(filePath, reason) {
  const ts = Date.now();
  let backupPath = `${filePath}.corrupt-${ts}`;
  if (fs.existsSync(backupPath)) {
    backupPath = `${filePath}.corrupt-${ts}-${crypto.randomBytes(3).toString('hex')}`;
  }
  try {
    fs.renameSync(filePath, backupPath);
    process.stderr.write(
      `[lab-browser] Warning: corrupt auth store moved to ${backupPath} (${reason})\n`
    );
  } catch (err) {
    process.stderr.write(
      `[lab-browser] Warning: failed to quarantine corrupt auth store ${filePath} (${err && err.message ? err.message : err})\n`
    );
  }
}

function readStateRaw(profile) {
  const clean = config.sanitizeAuthProfile(profile);
  const filePath = getProfilePath(clean);

  if (!fs.existsSync(filePath)) {
    return { exists: false, state: createEmptyState(clean), stat: null, corrupted: false };
  }

  let rawText;
  let stat = null;
  try {
    stat = fs.statSync(filePath);
    rawText = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { exists: false, state: createEmptyState(clean), stat: null, corrupted: false };
    }
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    quarantineCorruptFile(filePath, err && err.message ? err.message : 'invalid JSON');
    return { exists: false, state: createEmptyState(clean), stat: null, corrupted: true };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    quarantineCorruptFile(filePath, 'root JSON value is not an object');
    return { exists: false, state: createEmptyState(clean), stat: null, corrupted: true };
  }

  const state = createEmptyState(clean);
  state.version = Number.isInteger(parsed.version) && parsed.version >= 0 ? parsed.version : 0;
  state.updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null;
  state.clearedAtVersion = Number.isInteger(parsed.clearedAtVersion) && parsed.clearedAtVersion >= 0
    ? parsed.clearedAtVersion
    : 0;

  if (Array.isArray(parsed.cookies)) {
    const seen = new Map();
    for (const c of parsed.cookies) {
      const norm = normalizeCookie(c);
      if (!norm) continue;
      seen.set(cookieKey(norm), norm);
    }
    state.cookies = Array.from(seen.values());
  }

  if (Array.isArray(parsed.origins)) {
    const seenOrigins = new Map();
    for (const o of parsed.origins) {
      const norm = normalizeOrigin(o, null);
      if (!norm) continue;
      seenOrigins.set(norm.origin, norm);
    }
    state.origins = Array.from(seenOrigins.values());
  }

  if (parsed.tombstones && typeof parsed.tombstones === 'object' && !Array.isArray(parsed.tombstones)) {
    for (const [key, entry] of Object.entries(parsed.tombstones)) {
      if (!key || !entry || typeof entry !== 'object') continue;
      if (typeof entry.name !== 'string' || typeof entry.domain !== 'string') continue;
      const deletedAt = Number(entry.deletedAt);
      if (!Number.isFinite(deletedAt)) continue;
      state.tombstones[key] = {
        name: entry.name,
        domain: entry.domain,
        path: typeof entry.path === 'string' && entry.path ? entry.path : '/',
        deletedAt,
        deletedAtVersion: Number.isInteger(entry.deletedAtVersion) ? entry.deletedAtVersion : state.version,
      };
    }
  }

  if (parsed.cookieMeta && typeof parsed.cookieMeta === 'object' && !Array.isArray(parsed.cookieMeta)) {
    for (const [key, meta] of Object.entries(parsed.cookieMeta)) {
      if (!key || !meta || typeof meta !== 'object') continue;
      state.cookieMeta[key] = {
        updatedAt: Number.isFinite(Number(meta.updatedAt)) ? Number(meta.updatedAt) : 0,
        version: Number.isInteger(meta.version) ? meta.version : 0,
      };
    }
  }

  return { exists: true, state, stat, corrupted: false };
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

function withLock(profile, fn) {
  const clean = config.sanitizeAuthProfile(profile);
  ensureAuthDir();
  const lockPath = getLockPath(clean);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let acquired = false;

  while (!acquired) {
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      try {
        fs.writeSync(fd, `${process.pid}\n${Date.now()}\n`);
      } finally {
        fs.closeSync(fd);
      }
      acquired = true;
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;

      // Check for stale lock
      try {
        const st = fs.statSync(lockPath);
        const ageMs = Date.now() - st.mtimeMs;
        let stale = ageMs > STALE_LOCK_MS;
        if (!stale && ageMs > 1000) {
          const lockBody = fs.readFileSync(lockPath, 'utf8');
          const lockPid = Number(lockBody.split('\n')[0]);
          if (Number.isInteger(lockPid) && lockPid > 0 && !isPidAlive(lockPid)) {
            stale = true;
          }
        }
        if (stale) {
          try { fs.unlinkSync(lockPath); } catch (_) {}
          continue;
        }
      } catch (_) {
        // Lock disappeared between openSync and statSync; retry immediately
        continue;
      }

      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for auth store lock (${clean})`);
      }
      sleepSync(15);
    }
  }

  try {
    return fn();
  } finally {
    try { fs.unlinkSync(lockPath); } catch (_) {}
  }
}

function atomicWriteState(filePath, state) {
  ensureAuthDir();
  const tmpPath = `${filePath}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  const serialized = JSON.stringify(state, null, 2) + '\n';
  try {
    fs.writeFileSync(tmpPath, serialized, { mode: 0o600, encoding: 'utf8' });
    fs.renameSync(tmpPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    throw err;
  }
}

function toKeySet(knownKeys) {
  const set = new Set();
  if (!knownKeys) return set;
  if (knownKeys instanceof Set) {
    for (const k of knownKeys) {
      if (typeof k === 'string' && k) set.add(k);
    }
  } else if (Array.isArray(knownKeys)) {
    for (const k of knownKeys) {
      if (typeof k === 'string' && k) set.add(k);
    }
  } else if (typeof knownKeys === 'object') {
    for (const k of Object.keys(knownKeys)) {
      if (k) set.add(k);
    }
  }
  return set;
}

function toFingerprintMap(knownFingerprints) {
  if (!knownFingerprints) return null;
  if (knownFingerprints instanceof Map) {
    const obj = {};
    for (const [k, v] of knownFingerprints.entries()) {
      if (typeof k === 'string' && typeof v === 'string') obj[k] = v;
    }
    return obj;
  }
  if (typeof knownFingerprints === 'object' && !Array.isArray(knownFingerprints)) {
    const obj = {};
    for (const [k, v] of Object.entries(knownFingerprints)) {
      if (typeof k === 'string' && typeof v === 'string') obj[k] = v;
    }
    return obj;
  }
  return null;
}

function buildCursor(cookies) {
  const syncedKeys = [];
  const syncedFingerprints = {};
  for (const c of cookies) {
    const k = cookieKey(c);
    if (!k) continue;
    syncedKeys.push(k);
    syncedFingerprints[k] = cookieFingerprint(c);
  }
  return { syncedKeys, syncedFingerprints };
}

function pruneStateInPlace(state, nowMs, tombstoneTtlMs) {
  let pruned = false;

  const activeCookies = [];
  const activeKeys = new Set();
  for (const c of state.cookies) {
    if (isCookieExpired(c, nowMs)) {
      pruned = true;
      continue;
    }
    const k = cookieKey(c);
    activeCookies.push(c);
    activeKeys.add(k);
  }
  state.cookies = activeCookies;

  for (const k of Object.keys(state.cookieMeta)) {
    if (!activeKeys.has(k)) {
      delete state.cookieMeta[k];
    }
  }

  for (const [k, tomb] of Object.entries(state.tombstones)) {
    if (nowMs - tomb.deletedAt >= tombstoneTtlMs) {
      delete state.tombstones[k];
      pruned = true;
    }
  }

  return pruned;
}

function load(profile = DEFAULT_PROFILE, opts = {}) {
  const clean = config.sanitizeAuthProfile(profile);
  const nowMs = typeof opts.now === 'number' ? opts.now : Date.now();
  const tombstoneTtlMs = typeof opts.tombstoneTtlMs === 'number' && opts.tombstoneTtlMs > 0
    ? opts.tombstoneTtlMs
    : DEFAULT_TOMBSTONE_TTL_MS;

  const { exists, state, stat, corrupted } = readStateRaw(clean);
  pruneStateInPlace(state, nowMs, tombstoneTtlMs);
  const { syncedKeys, syncedFingerprints } = buildCursor(state.cookies);

  return {
    profile: clean,
    exists,
    corrupted,
    version: state.version,
    updatedAt: state.updatedAt,
    clearedAtVersion: state.clearedAtVersion,
    cookies: state.cookies,
    origins: state.origins,
    tombstones: state.tombstones,
    syncedKeys,
    syncedFingerprints,
    fileMode: stat ? (stat.mode & 0o777).toString(8).padStart(4, '0') : null,
    bytes: stat ? stat.size : 0,
  };
}

function computeSyncTransition(state, input, nowMs, tombstoneTtlMs) {
  let dirty = pruneStateInPlace(state, nowMs, tombstoneTtlMs);

  const storeMap = new Map();
  for (const c of state.cookies) {
    storeMap.set(cookieKey(c), c);
  }

  const originMap = new Map();
  for (const o of state.origins) {
    originMap.set(o.origin, o);
  }

  const knownSet = toKeySet(input.knownKeys || input.syncedKeys);
  const knownFp = toFingerprintMap(input.knownFingerprints || input.syncedFingerprints);
  const lastVersion = typeof input.lastVersion === 'number' && Number.isFinite(input.lastVersion)
    ? input.lastVersion
    : null;
  const wasClearedSinceLastSync = Boolean(
    state.clearedAtVersion > 0 && lastVersion !== null && lastVersion < state.clearedAtVersion
  );

  const nextVersionIfDirty = state.version + 1;
  const toAdd = [];
  const toClear = [];
  const clearKeys = new Set();

  const pushClear = (entry) => {
    const k = cookieKey(entry);
    if (!k || clearKeys.has(k)) return;
    clearKeys.add(k);
    toClear.push({
      name: entry.name,
      domain: entry.domain,
      path: entry.path || '/',
    });
  };

  const hasLiveCookies = Array.isArray(input.cookies);

  if (hasLiveCookies) {
    const liveMap = new Map();
    for (const rawCookie of input.cookies) {
      const norm = normalizeCookie(rawCookie);
      if (!norm) continue;
      if (isCookieExpired(norm, nowMs)) continue;
      liveMap.set(cookieKey(norm), norm);
    }

    // Pass 1: Compare live room cookies against store & tombstones
    for (const [key, liveCookie] of liveMap.entries()) {
      const liveFp = cookieFingerprint(liveCookie);
      const wasKnown = knownSet.has(key);
      const prevFp = knownFp ? knownFp[key] : undefined;
      const locallyModified = prevFp !== undefined ? liveFp !== prevFp : false;
      const tomb = state.tombstones[key];
      const storeCookie = storeMap.get(key);

      if (wasClearedSinceLastSync && wasKnown && !locallyModified) {
        pushClear(liveCookie);
        continue;
      }

      if (tomb) {
        const staleWithoutFp = wasKnown && prevFp === undefined && (
          lastVersion === null || lastVersion < (tomb.deletedAtVersion || Infinity)
        );
        if ((wasKnown && !locallyModified) || staleWithoutFp) {
          pushClear(liveCookie);
          continue;
        }
        // Fresh re-login: remove tombstone and upsert
        delete state.tombstones[key];
        storeMap.set(key, liveCookie);
        state.cookieMeta[key] = { updatedAt: nowMs, version: nextVersionIfDirty };
        dirty = true;
        continue;
      }

      if (storeCookie) {
        const storeFp = cookieFingerprint(storeCookie);
        if (liveFp === storeFp) {
          continue;
        }
        const metaVer = state.cookieMeta[key] ? state.cookieMeta[key].version : 0;
        const storeMovedAhead = lastVersion !== null && metaVer > lastVersion;
        if ((wasKnown && prevFp !== undefined && !locallyModified) || (wasKnown && prevFp === undefined && storeMovedAhead)) {
          // Store holds a newer value than this room's unmodified copy
          toAdd.push(storeCookie);
        } else {
          // Room updated the cookie value/attributes
          storeMap.set(key, liveCookie);
          state.cookieMeta[key] = { updatedAt: nowMs, version: nextVersionIfDirty };
          dirty = true;
        }
        continue;
      }

      // Brand-new cookie in this room
      storeMap.set(key, liveCookie);
      state.cookieMeta[key] = { updatedAt: nowMs, version: nextVersionIfDirty };
      dirty = true;
    }

    // Pass 2: Detect deletions (cookies previously known by this room that disappeared locally)
    for (const key of knownSet) {
      if (liveMap.has(key)) continue;
      const storeCookie = storeMap.get(key);
      if (!storeCookie) continue;

      storeMap.delete(key);
      delete state.cookieMeta[key];
      state.tombstones[key] = {
        name: storeCookie.name,
        domain: storeCookie.domain,
        path: storeCookie.path || '/',
        deletedAt: nowMs,
        deletedAtVersion: nextVersionIfDirty,
      };
      dirty = true;
    }

    // Pass 3: Pull incoming cookies from store that are missing in this room
    for (const [key, storeCookie] of storeMap.entries()) {
      if (!liveMap.has(key)) {
        toAdd.push(storeCookie);
      }
    }
  } else {
    // Pull-only sync (no live cookies uploaded)
    for (const [key, storeCookie] of storeMap.entries()) {
      const prevFp = knownFp ? knownFp[key] : undefined;
      if (!knownSet.has(key) || (prevFp !== undefined && prevFp !== cookieFingerprint(storeCookie))) {
        toAdd.push(storeCookie);
      }
    }
    for (const key of knownSet) {
      if (state.tombstones[key]) {
        pushClear(state.tombstones[key]);
      } else if (wasClearedSinceLastSync && !storeMap.has(key)) {
        // Store was cleared; caller should clear known cookies if needed
        const parts = key.split('\u001f');
        if (parts.length === 3) {
          pushClear({ domain: parts[0], path: parts[1], name: parts[2] });
        }
      }
    }
  }

  // Pass 4: Merge origins (localStorage / indexedDB) when provided
  if (Array.isArray(input.origins)) {
    for (const rawOrigin of input.origins) {
      if (!rawOrigin || typeof rawOrigin !== 'object' || typeof rawOrigin.origin !== 'string' || !rawOrigin.origin) {
        continue;
      }
      const existing = originMap.get(rawOrigin.origin) || null;
      const normalized = normalizeOrigin(rawOrigin, existing);
      if (!normalized) continue;

      if (isOriginEmpty(normalized)) {
        if (existing) {
          originMap.delete(normalized.origin);
          dirty = true;
        }
        continue;
      }

      if (!existing || JSON.stringify(existing) !== JSON.stringify(normalized)) {
        originMap.set(normalized.origin, normalized);
        dirty = true;
      }
    }
  }

  const nextCookies = Array.from(storeMap.values());
  const nextOrigins = Array.from(originMap.values());

  if (dirty) {
    state.version = nextVersionIfDirty;
    state.updatedAt = new Date(nowMs).toISOString();
    state.cookies = nextCookies;
    state.origins = nextOrigins;
  }

  return {
    dirty,
    state,
    toAdd,
    toClear,
    cookies: nextCookies,
    origins: nextOrigins,
  };
}

function sync(profile = DEFAULT_PROFILE, input = {}) {
  const clean = config.sanitizeAuthProfile(profile);
  const filePath = getProfilePath(clean);
  const opts = input && typeof input === 'object' ? input : {};
  const nowMs = typeof opts.now === 'number' ? opts.now : Date.now();
  const tombstoneTtlMs = typeof opts.tombstoneTtlMs === 'number' && opts.tombstoneTtlMs > 0
    ? opts.tombstoneTtlMs
    : DEFAULT_TOMBSTONE_TTL_MS;

  return withLock(clean, () => {
    const { state } = readStateRaw(clean);
    const transition = computeSyncTransition(state, opts, nowMs, tombstoneTtlMs);

    if (transition.dirty) {
      atomicWriteState(filePath, transition.state);
    }

    const { syncedKeys, syncedFingerprints } = buildCursor(transition.cookies);
    return {
      profile: clean,
      version: transition.state.version,
      updatedAt: transition.state.updatedAt,
      changed: transition.dirty,
      toAdd: transition.toAdd,
      toClear: transition.toClear,
      cookies: transition.cookies,
      origins: transition.origins,
      syncedKeys,
      syncedFingerprints,
      tombstoneCount: Object.keys(transition.state.tombstones).length,
    };
  });
}

function clear(profile = DEFAULT_PROFILE, opts = {}) {
  const clean = config.sanitizeAuthProfile(profile);
  const filePath = getProfilePath(clean);
  const nowMs = typeof opts.now === 'number' ? opts.now : Date.now();

  return withLock(clean, () => {
    const { state: prev } = readStateRaw(clean);
    const nextVersion = (Number.isInteger(prev.version) ? prev.version : 0) + 1;
    const updatedAt = new Date(nowMs).toISOString();

    const clearedState = createEmptyState(clean);
    clearedState.version = nextVersion;
    clearedState.updatedAt = updatedAt;
    clearedState.clearedAtVersion = nextVersion;

    atomicWriteState(filePath, clearedState);

    return {
      profile: clean,
      version: nextVersion,
      updatedAt,
      cleared: true,
      clearedCookies: prev.cookies.length,
      clearedOrigins: prev.origins.length,
    };
  });
}

function summary(profile = DEFAULT_PROFILE, opts = {}) {
  const loaded = load(profile, opts);
  const domainCounts = {};
  for (const c of loaded.cookies) {
    const normalizedDomain = String(c.domain || '').replace(/^\./, '').toLowerCase();
    if (!normalizedDomain) continue;
    domainCounts[normalizedDomain] = (domainCounts[normalizedDomain] || 0) + 1;
  }
  const domains = Object.keys(domainCounts).sort();
  const originUrls = loaded.origins.map((o) => o.origin).sort();

  return {
    profile: loaded.profile,
    exists: loaded.exists,
    version: loaded.version,
    updatedAt: loaded.updatedAt,
    cookieCount: loaded.cookies.length,
    originCount: loaded.origins.length,
    tombstoneCount: Object.keys(loaded.tombstones).length,
    domains,
    domainCounts,
    origins: originUrls,
    fileMode: loaded.fileMode,
    bytes: loaded.bytes,
  };
}

module.exports = {
  DEFAULT_PROFILE,
  DEFAULT_TOMBSTONE_TTL_MS,
  getProfilePath,
  cookieKey,
  cookieFingerprint,
  load,
  sync,
  clear,
  summary,
};
