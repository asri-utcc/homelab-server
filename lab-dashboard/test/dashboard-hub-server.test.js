'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const {
    createDashboardHubManager,
    checkFamilyPassword,
    isFamilyAllowedRequest,
    resolveRole,
} = require('../dashboard-hub-manager');

const SERVER_SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function extractSessionHelpers(src) {
    // Verify server.js defines makeSession, verifySession, signToken
    const fnSrc = `
        const crypto = require('crypto');
        ${src.match(/function signToken[\s\S]*?^}/m)[0]}
        ${src.match(/function makeSession[\s\S]*?^}/m)[0]}
        ${src.match(/function verifySession[\s\S]*?^}/m)[0]}
        return { signToken, makeSession, verifySession };
    `;
    return new Function('require', fnSrc)(require);
}

test('server.js wires all dashboard-hub-manager endpoints and role checks', () => {
    const requiredSnippets = [
        "require('./dashboard-hub-manager')",
        'createDashboardHubManager(',
        "p === '/api/launcher'",
        "p === '/api/launcher/badges'",
        "p === '/api/launcher/discovered'",
        "p === '/api/bookmarks'",
        "p.startsWith('/api/bookmarks/')",
        "p === '/api/weather'",
        'checkFamilyPassword(password, env)',
        'isFamilyAllowedRequest(',
        'dashboardHubManager.resetCache()',
        "'X-Auth-Role': role",
    ];
    for (const snip of requiredSnippets) {
        assert.ok(SERVER_SRC.includes(snip), `server.js missing expected wiring: ${snip}`);
    }
});

test('makeSession & verifySession keep 4-part admin backward compatibility and sign 5-part family tokens', () => {
    const { signToken, makeSession, verifySession } = extractSessionHelpers(SERVER_SRC);
    const secret = crypto.randomBytes(24).toString('base64url');

    // Existing 4-part admin token format (backward compat for already logged-in browsers)
    const exp = Date.now() + 60_000;
    const legacyPayload = `${Buffer.from('admin').toString('base64url')}.${exp}.abc123xyz`;
    const legacyToken = `${legacyPayload}.${signToken(legacyPayload, secret)}`;
    const legacySess = verifySession(legacyToken, secret);
    assert.ok(legacySess);
    assert.equal(legacySess.user, 'admin');
    assert.equal(legacySess.role, 'admin');
    assert.equal(resolveRole(legacySess), 'admin');

    // New admin session stays 4-part
    const adminRes = makeSession('admin', 60_000, secret, 'admin');
    assert.equal(adminRes.token.split('.').length, 4);
    const verifiedAdmin = verifySession(adminRes.token, secret);
    assert.equal(verifiedAdmin.user, 'admin');
    assert.equal(verifiedAdmin.role, 'admin');

    // Family session is 5-part and tamper-proof
    const famRes = makeSession('family', 60_000, secret, 'family');
    assert.equal(famRes.token.split('.').length, 5);
    const verifiedFam = verifySession(famRes.token, secret);
    assert.equal(verifiedFam.user, 'family');
    assert.equal(verifiedFam.role, 'family');
    assert.equal(resolveRole(verifiedFam), 'family');

    // Tampering role from family to admin invalidates signature
    const parts = famRes.token.split('.');
    parts[3] = 'admin';
    assert.equal(verifySession(parts.join('.'), secret), null);
});

test('HTTP integration harness: launcher, badges, discovered, bookmarks CRUD, weather, and family guard', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lab-hub-srv-'));
    const launcherFile = path.join(tmpDir, 'launcher-config.json');

    const mgr = createDashboardHubManager({
        launcherFile,
        links: [
            { id: 'agent-hub', label: 'Homelab Agent Hub', icon: 'server', url: '/agent-hub' },
            { id: 'homeassistant', label: 'Home Assistant', icon: 'home', url: 'https://homelab.tail285279.ts.net:8124/' },
            { id: 'energy', label: 'Energy', icon: 'activity', url: '#energy' },
            { id: 'terminal', label: 'Terminal', icon: 'terminal', url: '/terminal' },
        ],
        dockerReq: async () => ({
            status: 200,
            data: [
                {
                    Id: 'c1',
                    Names: ['/lab-jellyfin'],
                    State: 'running',
                    Ports: [{ PublicPort: 8096, Type: 'tcp' }],
                    Labels: {
                        'lab.dashboard.enable': 'true',
                        'lab.dashboard.name': 'Jellyfin Media',
                        'lab.dashboard.family': 'true',
                    },
                },
            ],
        }),
        buildSummary: async () => ({
            kuma: { total: 5, up: 5, down: 0 },
            docker: { total: 10, running: 10, stopped: 0 },
            pm2: { total: 4, online: 4 },
            energy: { realtime: { power_watts: 420 }, today: { energy_kwh: 5.5, cost_thb: 25 } },
        }),
        fetch: async (url) => {
            if (String(url).includes('open-meteo.com')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        current: {
                            temperature_2m: 31.2,
                            apparent_temperature: 35.1,
                            relative_humidity_2m: 74,
                            wind_speed_10m: 8.5,
                            rain: 0,
                            weather_code: 2,
                            is_day: 1,
                        },
                        daily: {
                            time: ['2026-11-27', '2026-11-28', '2026-11-29'],
                            weather_code: [2, 61, 3],
                            temperature_2m_max: [33, 31, 32],
                            temperature_2m_min: [24, 23, 24],
                            precipitation_probability_max: [30, 75, 40],
                        },
                    }),
                };
            }
            return { ok: false, status: 503, json: async () => ({}) };
        },
        execFileAsync: async () => ({ code: 1, stdout: '', stderr: '' }),
    });

    const srv = http.createServer(async (req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        const p = u.pathname;
        const roleHeader = req.headers['x-test-role'] || 'admin';
        const sess = { user: roleHeader, role: roleHeader };

        const send = (code, obj) => {
            res.writeHead(code, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(obj));
        };
        const readBody = () => new Promise((resolve) => {
            let s = '';
            req.on('data', (c) => { s += c; });
            req.on('end', () => resolve(s ? JSON.parse(s) : {}));
        });

        if (resolveRole(sess) === 'family' && !isFamilyAllowedRequest(req.method, p)) {
            return send(403, { ok: false, error: 'Forbidden', role: 'family' });
        }

        try {
            if (req.method === 'GET' && p === '/api/launcher') {
                return send(200, await mgr.getLauncher({ session: sess }));
            }
            if (req.method === 'GET' && p === '/api/launcher/badges') {
                return send(200, await mgr.getBadges());
            }
            if (req.method === 'GET' && p === '/api/launcher/discovered') {
                const items = await mgr.discoverDockerApps();
                return send(200, { ok: true, items, count: items.length });
            }
            if (req.method === 'GET' && p === '/api/bookmarks') {
                return send(200, await mgr.listBookmarks({ session: sess }));
            }
            if (req.method === 'POST' && p === '/api/bookmarks') {
                return send(201, await mgr.createBookmark(await readBody()));
            }
            if (req.method === 'PUT' && p.startsWith('/api/bookmarks/')) {
                return send(200, await mgr.updateBookmark(p.slice('/api/bookmarks/'.length), await readBody()));
            }
            if (req.method === 'DELETE' && p.startsWith('/api/bookmarks/')) {
                return send(200, await mgr.deleteBookmark(p.slice('/api/bookmarks/'.length)));
            }
            if (req.method === 'GET' && p === '/api/weather') {
                return send(200, await mgr.getWeather());
            }
            return send(404, { ok: false });
        } catch (err) {
            return send(err.statusCode || 500, { ok: false, error: err.message });
        }
    });

    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const port = srv.address().port;
    const reqJson = async (method, urlPath, body, role = 'admin') => {
        const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'x-test-role': role,
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, data: await res.json() };
    };

    try {
        // 1. Admin creates bookmark
        const created = await reqJson('POST', '/api/bookmarks', {
            label: 'Router Admin',
            url: 'http://192.168.1.1/',
            emoji: '📡',
            group: 'Network',
            openInWorkspace: true,
        });
        assert.equal(created.status, 201);
        assert.equal(created.data.bookmark.label, 'Router Admin');
        const bmId = created.data.bookmark.id;

        // 2. Admin updates bookmark
        const updated = await reqJson('PUT', `/api/bookmarks/${bmId}`, { label: 'Main Router', family: true });
        assert.equal(updated.status, 200);
        assert.equal(updated.data.bookmark.label, 'Main Router');
        assert.equal(updated.data.bookmark.family, true);

        // 3. Admin gets launcher (includes docker discovered + bookmark + badges)
        const launcher = await reqJson('GET', '/api/launcher');
        assert.equal(launcher.status, 200);
        assert.ok(launcher.data.apps.some((a) => a.id === 'docker-lab-jellyfin'));
        assert.ok(launcher.data.apps.some((a) => a.id === bmId));
        assert.equal(launcher.data.badges.energy.watts, 420);

        // 4. Weather endpoint returns Rueso data
        const weather = await reqJson('GET', '/api/weather', null, 'family');
        assert.equal(weather.status, 200);
        assert.equal(weather.data.location.name, 'อ.รือเสาะ จ.นราธิวาส');
        assert.equal(weather.data.current.tempC, 31.2);

        // 5. Family role is blocked from mutating bookmarks and sees filtered launcher
        const famMutate = await reqJson('POST', '/api/bookmarks', { label: 'Bad', url: 'https://example.com' }, 'family');
        assert.equal(famMutate.status, 403);
        const famLauncher = await reqJson('GET', '/api/launcher', null, 'family');
        assert.equal(famLauncher.status, 200);
        assert.equal(famLauncher.data.role, 'family');
        assert.ok(!famLauncher.data.apps.some((a) => a.id === 'terminal'));
        assert.ok(famLauncher.data.apps.some((a) => a.id === 'homeassistant'));

        // 6. Admin deletes bookmark
        const del = await reqJson('DELETE', `/api/bookmarks/${bmId}`);
        assert.equal(del.status, 200);
        assert.equal(del.data.ok, true);
        assert.equal(del.data.id, bmId);

        // 7. Family password opt-in check
        assert.equal(checkFamilyPassword('1234', {}), false);
        assert.equal(checkFamilyPassword('family123', { DASH_FAMILY_PASS: 'family123' }), true);
    } finally {
        srv.close();
        await fsp.rm(tmpDir, { recursive: true, force: true });
    }
});

test('makeSession & verifySession embed ~ver in family nonce, omit ~ in admin nonce, and reject role tampering', () => {
    const { makeSession, verifySession } = extractSessionHelpers(SERVER_SRC);
    const secret = crypto.randomBytes(24).toString('base64url');

    const famRes = makeSession('family', 60_000, secret, 'family', '3');
    const famParts = famRes.token.split('.');
    assert.equal(famParts.length, 5);
    assert.ok(famParts[2].endsWith('~3'), `expected family nonce to end with ~3, got ${famParts[2]}`);

    const verifiedFam = verifySession(famRes.token, secret);
    assert.ok(verifiedFam);
    assert.equal(verifiedFam.role, 'family');
    assert.equal(verifiedFam.ver, '3');

    // Tampering role invalidates signature
    const tampered = [...famParts];
    tampered[3] = 'admin';
    assert.equal(verifySession(tampered.join('.'), secret), null);

    const adminRes = makeSession('admin', 60_000, secret, 'admin', '3');
    const adminParts = adminRes.token.split('.');
    assert.equal(adminParts.length, 4);
    assert.ok(!adminParts[2].includes('~'), `expected admin nonce without ~, got ${adminParts[2]}`);
});

test('server.js GET /api/settings/family supports reveal=1 (pinPlain) and pinMasked', () => {
    const startIdx = SERVER_SRC.indexOf("if (req.method === 'GET' && p === '/api/settings/family')");
    const endIdx = SERVER_SRC.indexOf("if (req.method === 'POST' && p === '/api/settings/family')", startIdx);
    assert.ok(startIdx !== -1 && endIdx > startIdx, 'server.js missing GET /api/settings/family handler');
    const handlerSrc = SERVER_SRC.slice(startIdx, endIdx);
    const requiredSnippets = [
        'requireAdminSession(req, res)',
        "url.searchParams.get('reveal') === '1'",
        'pinMasked',
        'pinPlain',
    ];
    for (const snip of requiredSnippets) {
        assert.ok(handlerSrc.includes(snip), `GET /api/settings/family missing expected wiring: ${snip}`);
    }
});
