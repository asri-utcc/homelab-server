'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const config = require('../lib/config');
const authStore = require('../lib/auth-store');

const TEST_PROFILE = 'qa_test';

function cleanupProfile() {
    const filePath = authStore.getProfilePath(TEST_PROFILE);
    const lockPath = filePath.replace(/\.json$/, '.lock');
    for (const p of [filePath, lockPath]) {
        try {
            if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch (_) {}
    }
}

test.beforeEach(() => {
    cleanupProfile();
});

test.after(() => {
    try {
        authStore.clear(TEST_PROFILE);
    } catch (_) {}
    cleanupProfile();
});

test('auth-store: load returns empty state when profile does not exist', () => {
    const loaded = authStore.load(TEST_PROFILE);
    assert.equal(loaded.profile, TEST_PROFILE);
    assert.equal(loaded.exists, false);
    assert.equal(loaded.version, 0);
    assert.deepEqual(loaded.cookies, []);
    assert.deepEqual(loaded.origins, []);
    assert.deepEqual(loaded.tombstones, {});
});

test('auth-store: incremental merge across rooms & domains with 0600 file permissions', () => {
    const t0 = 1_700_000_000_000;
    const cookieA = {
        name: 'sid_a',
        value: 'token-alpha',
        domain: 'alpha.example.test',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
    };
    const cookieB = {
        name: 'sid_b',
        value: 'token-beta',
        domain: 'beta.example.test',
        path: '/',
        httpOnly: false,
        secure: true,
        sameSite: 'Strict',
    };

    // Room 1 saves cookieA
    const r1Sync1 = authStore.sync(TEST_PROFILE, {
        cookies: [cookieA],
        knownKeys: [],
        knownFingerprints: {},
        now: t0,
    });
    assert.equal(r1Sync1.changed, true);
    assert.equal(r1Sync1.cookies.length, 1);

    // File must exist with 0600 permissions and directory with 0700
    const profilePath = authStore.getProfilePath(TEST_PROFILE);
    const fileMode = fs.statSync(profilePath).mode & 0o777;
    const dirMode = fs.statSync(config.AUTH_DIR).mode & 0o777;
    assert.equal(fileMode, 0o600);
    assert.equal(dirMode, 0o700);

    // Room 2 saves cookieB without knowing cookieA -> must merge, not clobber cookieA
    const r2Sync1 = authStore.sync(TEST_PROFILE, {
        cookies: [cookieB],
        knownKeys: [],
        knownFingerprints: {},
        now: t0 + 1000,
    });
    assert.equal(r2Sync1.changed, true);
    assert.equal(r2Sync1.cookies.length, 2);
    assert.equal(r2Sync1.toAdd.length, 1);
    assert.equal(r2Sync1.toAdd[0].name, 'sid_a');

    // Room 1 syncs again -> receives cookieB in toAdd
    const r1Sync2 = authStore.sync(TEST_PROFILE, {
        cookies: [cookieA],
        knownKeys: r1Sync1.syncedKeys,
        knownFingerprints: r1Sync1.syncedFingerprints,
        lastVersion: r1Sync1.version,
        now: t0 + 2000,
    });
    assert.equal(r1Sync2.changed, false);
    assert.equal(r1Sync2.toAdd.length, 1);
    assert.equal(r1Sync2.toAdd[0].name, 'sid_b');
    assert.equal(r1Sync2.cookies.length, 2);

    // Room 1 updates sid_a -> Room 2 (holding unmodified sid_a) gets updated value instead of clobbering
    const cookieAUpdated = { ...cookieA, value: 'token-alpha-v2' };
    const r1Sync3 = authStore.sync(TEST_PROFILE, {
        cookies: [cookieAUpdated, cookieB],
        knownKeys: r1Sync2.syncedKeys,
        knownFingerprints: r1Sync2.syncedFingerprints,
        lastVersion: r1Sync2.version,
        now: t0 + 3000,
    });
    assert.equal(r1Sync3.changed, true);

    const r2Sync2 = authStore.sync(TEST_PROFILE, {
        cookies: [cookieA, cookieB],
        knownKeys: r2Sync1.syncedKeys,
        knownFingerprints: r2Sync1.syncedFingerprints,
        lastVersion: r2Sync1.version,
        now: t0 + 4000,
    });
    assert.equal(r2Sync2.toAdd.length, 1);
    assert.equal(r2Sync2.toAdd[0].name, 'sid_a');
    assert.equal(r2Sync2.toAdd[0].value, 'token-alpha-v2');
});

test('auth-store: tombstone deletion prevents resurrection across rooms and expires/clears on re-login', () => {
    const t0 = 1_700_001_000_000;
    const cookie = {
        name: 'auth_session',
        value: 'v1',
        domain: 'app.example.test',
        path: '/',
        httpOnly: true,
        secure: true,
    };

    const r1Start = authStore.sync(TEST_PROFILE, {
        cookies: [cookie],
        knownKeys: [],
        knownFingerprints: {},
        now: t0,
    });
    const r2Start = authStore.sync(TEST_PROFILE, {
        cookies: [cookie],
        knownKeys: r1Start.syncedKeys,
        knownFingerprints: r1Start.syncedFingerprints,
        lastVersion: r1Start.version,
        now: t0 + 500,
    });

    // Room 1 logs out (auth_session removed locally)
    const r1Logout = authStore.sync(TEST_PROFILE, {
        cookies: [],
        knownKeys: r1Start.syncedKeys,
        knownFingerprints: r1Start.syncedFingerprints,
        lastVersion: r1Start.version,
        now: t0 + 1000,
    });
    assert.equal(r1Logout.changed, true);
    assert.equal(r1Logout.cookies.length, 0);
    assert.equal(r1Logout.tombstoneCount, 1);

    // Room 2 still holds unmodified stale cookie -> must get toClear and NOT resurrect in store
    const r2Stale = authStore.sync(TEST_PROFILE, {
        cookies: [cookie],
        knownKeys: r2Start.syncedKeys,
        knownFingerprints: r2Start.syncedFingerprints,
        lastVersion: r2Start.version,
        now: t0 + 2000,
    });
    assert.equal(r2Stale.changed, false);
    assert.equal(r2Stale.cookies.length, 0);
    assert.equal(r2Stale.toClear.length, 1);
    assert.deepEqual(r2Stale.toClear[0], {
        name: 'auth_session',
        domain: 'app.example.test',
        path: '/',
    });

    // Fresh re-login with new value clears tombstone and stores cookie
    const r1Relogin = authStore.sync(TEST_PROFILE, {
        cookies: [{ ...cookie, value: 'v2-fresh' }],
        knownKeys: r1Logout.syncedKeys,
        knownFingerprints: r1Logout.syncedFingerprints,
        lastVersion: r1Logout.version,
        now: t0 + 3000,
    });
    assert.equal(r1Relogin.changed, true);
    assert.equal(r1Relogin.tombstoneCount, 0);
    assert.equal(r1Relogin.cookies.length, 1);
    assert.equal(r1Relogin.cookies[0].value, 'v2-fresh');
});

test('auth-store: origins merge without clobbering other origins or existing indexedDB', () => {
    const t0 = 1_700_002_000_000;

    // Room 1 writes origin A with localStorage + indexedDB
    const s1 = authStore.sync(TEST_PROFILE, {
        origins: [
            {
                origin: 'https://spa1.example.test',
                localStorage: [{ name: 'jwt', value: 'abc' }],
                indexedDB: [{ name: 'authDb', data: [{ k: 1 }] }],
            },
        ],
        now: t0,
    });
    assert.equal(s1.origins.length, 1);
    assert.equal(s1.origins[0].indexedDB.length, 1);

    // Room 2 writes origin B -> origin A must stay intact
    const s2 = authStore.sync(TEST_PROFILE, {
        origins: [
            {
                origin: 'https://spa2.example.test',
                localStorage: [{ name: 'theme', value: 'dark' }],
            },
        ],
        now: t0 + 1000,
    });
    assert.equal(s2.origins.length, 2);
    const spa1 = s2.origins.find((o) => o.origin === 'https://spa1.example.test');
    const spa2 = s2.origins.find((o) => o.origin === 'https://spa2.example.test');
    assert.ok(spa1 && spa2);
    assert.equal(spa1.indexedDB.length, 1);

    // Room 2 updates origin A's localStorage without passing indexedDB -> existing indexedDB must not be wiped
    const s3 = authStore.sync(TEST_PROFILE, {
        origins: [
            {
                origin: 'https://spa1.example.test',
                localStorage: [{ name: 'jwt', value: 'abc-refreshed' }],
            },
        ],
        now: t0 + 2000,
    });
    const spa1After = s3.origins.find((o) => o.origin === 'https://spa1.example.test');
    assert.equal(spa1After.localStorage[0].value, 'abc-refreshed');
    assert.equal(spa1After.indexedDB.length, 1);
});

test('auth-store: summary hides cookie values and clear propagates to stale rooms', () => {
    const t0 = 1_700_003_000_000;
    const cookie = {
        name: 'secret_cookie',
        value: 'super-secret-token-value',
        domain: '.portal.example.test',
        path: '/',
    };

    const s1 = authStore.sync(TEST_PROFILE, {
        cookies: [cookie],
        knownKeys: [],
        knownFingerprints: {},
        now: t0,
    });

    const sum = authStore.summary(TEST_PROFILE);
    assert.equal(sum.exists, true);
    assert.equal(sum.cookieCount, 1);
    assert.deepEqual(sum.domains, ['portal.example.test']);
    assert.equal(sum.fileMode, '0600');
    assert.equal(JSON.stringify(sum).includes('super-secret-token-value'), false);

    const cleared = authStore.clear(TEST_PROFILE, { now: t0 + 1000 });
    assert.equal(cleared.cleared, true);
    assert.equal(cleared.clearedCookies, 1);

    // Room holding unmodified cookie from pre-clear version gets toClear
    const staleAfterClear = authStore.sync(TEST_PROFILE, {
        cookies: [cookie],
        knownKeys: s1.syncedKeys,
        knownFingerprints: s1.syncedFingerprints,
        lastVersion: s1.version,
        now: t0 + 2000,
    });
    assert.equal(staleAfterClear.cookies.length, 0);
    assert.equal(staleAfterClear.toClear.length, 1);
    assert.equal(staleAfterClear.toClear[0].name, 'secret_cookie');
});
