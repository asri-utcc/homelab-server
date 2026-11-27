'use strict';
// Unit tests for dashboard-hub-manager.js:
//   node --test /home/dev/projects/lab-dashboard/test/dashboard-hub-manager.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const {
    createDashboardHubManager,
    sanitizeUrl,
    mapWmoCodeToThai,
    parseDockerLabelsToApp,
    enrichBuiltinApps,
    resolveRole,
    isFamilyAllowedRequest,
    checkFamilyPassword,
    upsertEnvText,
    validateFamilyPin,
    generateFamilyPin,
    DEFAULT_RUESO_COORDS,
} = require('../dashboard-hub-manager');

async function makeTempDir() {
    return fsp.mkdtemp(path.join(os.tmpdir(), 'hub-mgr-test-'));
}

const SAMPLE_LINKS = [
    { id: 'agent-hub', label: 'Homelab Agent Hub', icon: 'server', url: '/agent-hub' },
    { id: 'video-studio', label: 'Video Studio', icon: 'auto', url: '/video-studio' },
    { id: 'chat', label: 'AI Chat', icon: 'auto', url: '/gemini' },
    { id: 'energy', label: 'Energy', icon: 'activity', url: '#energy' },
    { id: 'terminal', label: 'Web Terminal', icon: 'terminal', url: '/terminal' },
    { id: 'homeassistant', label: 'Home Assistant', icon: 'home', url: 'https://homelab.tail285279.ts.net:8124/' },
    { id: 'kuma', label: 'Uptime Kuma', icon: 'activity', url: 'https://homelab.tail285279.ts.net:3001/' },
    { id: 'portainer', label: 'Portainer', icon: 'box', url: 'https://homelab.tail285279.ts.net/portainer/' },
    { id: 'onepercentbot', label: 'OnePercent Bot', icon: 'trending-up', url: 'https://homelab.tail285279.ts.net:6015/' },
];

function createFixtureDeps(tmpDir, overrides = {}) {
    let clock = 1795800000000;
    let idSeq = 1;
    const launcherFile = path.join(tmpDir, 'launcher-config.json');

    const mockContainers = [
        // Known builtin container without explicit opt-in -> should be deduplicated
        {
            Id: 'aaa111222333',
            Names: ['/lab-uptime-kuma'],
            State: 'running',
            Ports: [{ PublicPort: 3001, PrivatePort: 3001, Type: 'tcp' }],
            Labels: {},
        },
        // Known infra container -> should be skipped
        {
            Id: 'bbb111222333',
            Names: ['/lab-mongodb'],
            State: 'running',
            Ports: [{ PublicPort: 27017, PrivatePort: 27017, Type: 'tcp' }],
            Labels: {},
        },
        // Explicitly opted-in custom container with lab.dashboard.* labels
        {
            Id: 'ccc111222333',
            Names: ['/lab-grafana'],
            State: 'running',
            Ports: [{ PublicPort: 3005, PrivatePort: 3000, Type: 'tcp' }],
            Labels: {
                'lab.dashboard.enable': 'true',
                'lab.dashboard.name': 'Grafana Metrics',
                'lab.dashboard.url': 'https://homelab.tail285279.ts.net:3005/',
                'lab.dashboard.group': 'Monitoring',
                'lab.dashboard.emoji': '📊',
                'lab.dashboard.family': 'true',
                'lab.dashboard.description': 'System graphs',
            },
        },
        // Auto-discovered running web container without labels
        {
            Id: 'ddd111222333',
            Names: ['/immich-web'],
            State: 'running',
            Ports: [{ PublicPort: 2283, PrivatePort: 2283, Type: 'tcp' }],
            Labels: { 'org.opencontainers.image.title': 'Immich Photos' },
        },
        // Explicitly opted-out container
        {
            Id: 'eee111222333',
            Names: ['/internal-admin'],
            State: 'running',
            Ports: [{ PublicPort: 9999, PrivatePort: 9999, Type: 'tcp' }],
            Labels: { 'lab.dashboard.enable': 'false' },
        },
    ];

    const defaultDeps = {
        launcherFile,
        links: SAMPLE_LINKS,
        now: () => clock,
        advanceClock: (ms) => { clock += ms; },
        generateBookmarkId: () => `bm_test_${idSeq++}`,
        dockerReq: async () => ({ status: 200, data: mockContainers }),
        queryBotDb: async () => ({
            openPositions: 3,
            enabledBots: 5,
            todayPnlUsdt: 12.45,
            todayTrades: 4,
            todayWins: 3,
        }),
        fetch: async (url) => {
            if (String(url).includes('6015/api/health')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        overall: 'healthy',
                        components: { botManager: { ok: true, running: true, activeTraders: 3 } },
                    }),
                };
            }
            if (String(url).includes('api.open-meteo.com')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        current: {
                            temperature_2m: 29.4,
                            apparent_temperature: 33.1,
                            relative_humidity_2m: 78,
                            wind_speed_10m: 8.5,
                            rain: 0.4,
                            weather_code: 61,
                            is_day: 1,
                        },
                        daily: {
                            time: ['2026-11-27', '2026-11-28'],
                            weather_code: [61, 2],
                            temperature_2m_max: [31.5, 32.0],
                            temperature_2m_min: [24.0, 23.5],
                            precipitation_probability_max: [80, 30],
                        },
                    }),
                };
            }
            return { ok: false, status: 404, json: async () => ({}) };
        },
        buildSummary: async () => ({
            kuma: { total: 14, up: 14, down: 0 },
            docker: { total: 13, running: 13, stopped: 0 },
            pm2: { total: 4, online: 4 },
            energy: {
                realtime: { power_watts: 1250, voltage_volts: 221.2 },
                today: { energy_kwh: 18.4, cost_thb: 92.5 },
                this_month: { energy_kwh: 240.1, cost_thb: 1210.0 },
            },
            services: {
                items: [
                    { id: 'homeassistant', up: true, latencyMs: 14 },
                    { id: 'obsidian', up: true, latencyMs: 9 },
                ],
            },
        }),
        agentHubManager: {
            getHubStatus: async () => ({
                nodes: [
                    { nodeId: 'asridaytrade', online: true },
                    { nodeId: 'servergigi', online: false },
                ],
            }),
            listJobs: async () => ([
                { jobId: 'j1', status: 'rendering' },
                { jobId: 'j2', status: 'completed' },
            ]),
        },
        geminiManager: {
            listSessions: () => ({
                runningSessionIds: ['s1'],
                unreadSessionIds: ['s2', 's3'],
                sessions: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
            }),
        },
        audit: { liveRuns: () => [] },
        videoStudioManager: {
            listJobs: async () => ({
                jobs: [
                    { id: 'v1', status: 'done' },
                    { id: 'v2', status: 'rendering', alive: true },
                ],
            }),
        },
        ...overrides,
    };

    return defaultDeps;
}

test('sanitizeUrl allows safe protocols and blocks XSS vectors', () => {
    assert.equal(sanitizeUrl('https://example.com/app'), 'https://example.com/app');
    assert.equal(sanitizeUrl('http://192.168.1.10:8080/'), 'http://192.168.1.10:8080/');
    assert.equal(sanitizeUrl('/agent-hub'), '/agent-hub');
    assert.equal(sanitizeUrl('#energy'), '#energy');
    assert.equal(sanitizeUrl('\\\\192.168.1.123\\Share'), '\\\\192.168.1.123\\Share');

    assert.equal(sanitizeUrl('javascript:alert(1)'), '');
    assert.equal(sanitizeUrl('data:text/html,<script>alert(1)</script>'), '');
    assert.equal(sanitizeUrl('vbscript:msgbox(1)'), '');
    assert.equal(sanitizeUrl('file:///etc/passwd'), '');
    assert.equal(sanitizeUrl('//evil.com/phish'), '');
});

test('mapWmoCodeToThai maps weather codes accurately for day and night', () => {
    assert.equal(mapWmoCodeToThai(0, true).emoji, '☀️');
    assert.equal(mapWmoCodeToThai(0, false).emoji, '🌙');
    assert.equal(mapWmoCodeToThai(61, true).conditionTh, 'ฝนตกเล็กน้อย');
    assert.equal(mapWmoCodeToThai(95, true).emoji, '⛈️');
    assert.equal(mapWmoCodeToThai(999, true).conditionTh, 'สภาพอากาศทั่วไป');
});

test('discoverDockerApps discovers labeled and web-port containers while deduplicating builtins', async () => {
    const tmpDir = await makeTempDir();
    try {
        const deps = createFixtureDeps(tmpDir);
        const hub = createDashboardHubManager(deps);
        const apps = await hub.discoverDockerApps();

        const ids = apps.map((a) => a.id);
        assert.deepEqual(ids, ['docker-lab-grafana', 'docker-immich-web']);

        const grafana = apps.find((a) => a.id === 'docker-lab-grafana');
        assert.equal(grafana.label, 'Grafana Metrics');
        assert.equal(grafana.group, 'Monitoring');
        assert.equal(grafana.emoji, '📊');
        assert.equal(grafana.family, true);
        assert.equal(grafana.source, 'docker');
        assert.equal(grafana.containerState, 'running');

        const immich = apps.find((a) => a.id === 'docker-immich-web');
        assert.equal(immich.label, 'Immich Photos');
        assert.equal(immich.url, 'https://homelab.tail285279.ts.net:2283/');
    } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true });
    }
});

test('discoverDockerApps fails gracefully when Docker socket errors', async () => {
    const tmpDir = await makeTempDir();
    try {
        const deps = createFixtureDeps(tmpDir, {
            dockerReq: async () => { throw new Error('ENOENT docker.sock'); },
        });
        const hub = createDashboardHubManager(deps);
        const apps = await hub.discoverDockerApps();
        assert.deepEqual(apps, []);
    } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true });
    }
});

test('bookmarks CRUD and pinned launcher support builtin, docker-*, and bm_* IDs', async () => {
    const tmpDir = await makeTempDir();
    try {
        // Seed legacy launcher-config.json (only { pinned }) to verify backward compatibility
        await fsp.writeFile(
            path.join(tmpDir, 'launcher-config.json'),
            JSON.stringify({ pinned: ['agent-hub', 'energy'] })
        );

        const deps = createFixtureDeps(tmpDir);
        const hub = createDashboardHubManager(deps);

        // Create bookmark
        const created = await hub.createBookmark({
            label: 'Router Admin',
            url: 'http://192.168.1.1/',
            icon: 'shield',
            group: 'Network',
            openInWorkspace: true,
            family: false,
        });
        assert.equal(created.ok, true);
        assert.equal(created.bookmark.id, 'bm_test_1');
        assert.equal(created.bookmark.source, 'bookmark');
        assert.equal(created.bookmark.openInWorkspace, true);

        // Reject unsafe URL
        await assert.rejects(
            () => hub.createBookmark({ label: 'Bad', url: 'javascript:alert(1)' }),
            (err) => err && err.statusCode === 400
        );

        // Pin builtin + docker + bookmark
        const pinnedRes = await hub.setPinned(['agent-hub', 'docker-lab-grafana', 'bm_test_1', 'nonexistent']);
        assert.deepEqual(pinnedRes.pinned, ['agent-hub', 'docker-lab-grafana', 'bm_test_1']);

        // Update bookmark
        const updated = await hub.updateBookmark('bm_test_1', { label: 'Main Router', family: true });
        assert.equal(updated.bookmark.label, 'Main Router');
        assert.equal(updated.bookmark.family, true);

        // Delete bookmark -> should also unpin it
        const deleted = await hub.deleteBookmark('bm_test_1');
        assert.equal(deleted.ok, true);
        assert.equal(deleted.bookmarks.length, 0);

        const launcher = await hub.getLauncher();
        assert.deepEqual(launcher.pinned, ['agent-hub', 'docker-lab-grafana']);

        // Reset pinned
        const resetRes = await hub.setPinned(null, { reset: true });
        assert.deepEqual(resetRes.pinned, ['agent-hub', 'video-studio', 'chat', 'energy', 'terminal']);
    } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true });
    }
});

test('getBadges aggregates live metrics for Bot, Agent Hub, Kuma, Energy, AI, Video, Docker', async () => {
    const tmpDir = await makeTempDir();
    try {
        const deps = createFixtureDeps(tmpDir);
        const hub = createDashboardHubManager(deps);
        const res = await hub.getBadges();

        assert.equal(res.ok, true);
        assert.equal(res.badges.onepercentbot.openPositions, 3);
        assert.equal(res.badges.onepercentbot.todayPnlUsdt, 12.45);
        assert.equal(res.badges.onepercentbot.todayTrades, 4);
        assert.equal(res.badges.onepercentbot.todayWins, 3);
        assert.match(res.badges.onepercentbot.text, /3 ไม้/);
        assert.equal(res.badges.onepercentbot.tone, 'ok');

        assert.equal(res.badges['agent-hub'].online, 1);
        assert.equal(res.badges['agent-hub'].total, 2);
        assert.equal(res.badges['agent-hub'].activeJobs, 1);
        assert.equal(res.badges['agent-hub'].tone, 'info');

        assert.equal(res.badges.kuma.upCount, 14);
        assert.equal(res.badges.kuma.text, '14/14 UP');
        assert.equal(res.badges.kuma.tone, 'ok');

        assert.equal(res.badges.energy.watts, 1250);
        assert.match(res.badges.energy.text, /1,250W/);

        assert.equal(res.badges.chat.running, 1);
        assert.equal(res.badges.chat.unread, 2);

        assert.equal(res.badges['video-studio'].active, 1);
        assert.equal(res.badges.portainer.text, '13/13 รัน');
        assert.equal(res.badges['docker-lab-grafana'].text, 'RUNNING');
    } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true });
    }
});

test('collectBotBadge handles offline bot gracefully without throwing', async () => {
    const tmpDir = await makeTempDir();
    try {
        const deps = createFixtureDeps(tmpDir, {
            fetch: async () => { throw new Error('ECONNREFUSED'); },
            queryBotDb: async () => { throw new Error('mongo down'); },
        });
        const hub = createDashboardHubManager(deps);
        const badge = await hub.collectBotBadge();
        assert.equal(badge.up, false);
        assert.equal(badge.tone, 'err');
        assert.equal(badge.text, 'ออฟไลน์');
    } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true });
    }
});

test('getWeather fetches Rueso weather, caches within TTL, and serves stale on error', async () => {
    const tmpDir = await makeTempDir();
    try {
        let failFetch = false;
        let fetchCount = 0;
        const deps = createFixtureDeps(tmpDir, {
            fetch: async (url) => {
                fetchCount++;
                if (failFetch) throw new Error('network offline');
                assert.match(String(url), /latitude=6\.3917/);
                assert.match(String(url), /longitude=101\.5186/);
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        current: {
                            temperature_2m: 30.2,
                            apparent_temperature: 34.0,
                            relative_humidity_2m: 74,
                            wind_speed_10m: 9.2,
                            rain: 0,
                            weather_code: 2,
                            is_day: 1,
                        },
                        daily: {
                            time: ['2026-11-27'],
                            weather_code: [2],
                            temperature_2m_max: [32.1],
                            temperature_2m_min: [24.2],
                            precipitation_probability_max: [20],
                        },
                    }),
                };
            },
        });
        const hub = createDashboardHubManager(deps);

        const w1 = await hub.getWeather();
        assert.equal(w1.ok, true);
        assert.equal(w1.cached, false);
        assert.equal(w1.location.name, DEFAULT_RUESO_COORDS.name);
        assert.equal(w1.current.tempC, 30.2);
        assert.equal(w1.current.conditionTh, 'มีเมฆบางส่วน');
        assert.equal(fetchCount, 1);

        // Within 15-min TTL -> cached
        const w2 = await hub.getWeather();
        assert.equal(w2.cached, true);
        assert.equal(w2.stale, false);
        assert.equal(fetchCount, 1);

        // Advance past TTL and simulate network error -> stale fallback
        deps.advanceClock(20 * 60 * 1000);
        failFetch = true;
        const w3 = await hub.getWeather();
        assert.equal(w3.ok, true);
        assert.equal(w3.stale, true);
        assert.equal(w3.current.tempC, 30.2);
    } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true });
    }
});

test('Family / Guest Role is opt-in, restricts endpoints, and filters launcher items', async () => {
    const tmpDir = await makeTempDir();
    try {
        // Opt-in password check
        assert.equal(checkFamilyPassword('1234', {}), false);
        assert.equal(checkFamilyPassword('123', { DASH_FAMILY_PASS: '123' }), false);
        assert.equal(checkFamilyPassword('wrong', { DASH_FAMILY_PASS: 'home2026' }), false);
        assert.equal(checkFamilyPassword('home2026', { DASH_FAMILY_PASS: 'home2026' }), true);

        assert.equal(resolveRole({ user: 'family', role: 'family' }), 'family');
        assert.equal(resolveRole({ user: 'admin' }), 'admin');

        // Endpoint allowlist
        assert.equal(isFamilyAllowedRequest('GET', '/api/launcher'), true);
        assert.equal(isFamilyAllowedRequest('GET', '/api/weather'), true);
        assert.equal(isFamilyAllowedRequest('GET', '/api/overview'), true);
        assert.equal(isFamilyAllowedRequest('GET', '/api/energy/live'), true);
        // Query string stripping & cache-busted static assets
        assert.equal(isFamilyAllowedRequest('GET', '/?kiosk=1'), true);
        assert.equal(isFamilyAllowedRequest('GET', '/launcher-bar.css?v=20261127-hub1'), true);
        assert.equal(isFamilyAllowedRequest('GET', '/hub-workspace.js?v=20261127-hub1'), true);
        assert.equal(isFamilyAllowedRequest('GET', '/api/weather?force=1'), true);
        assert.equal(isFamilyAllowedRequest('GET', '/api/energy/history?range=24h'), true);
        assert.equal(isFamilyAllowedRequest('GET', '/api/docker?all=1'), false);
        assert.equal(isFamilyAllowedRequest('POST', '/api/bookmarks?x=1'), false);
        assert.equal(isFamilyAllowedRequest('PUT', '/api/launcher'), false);
        assert.equal(isFamilyAllowedRequest('POST', '/api/launcher/bookmarks'), false);
        assert.equal(isFamilyAllowedRequest('POST', '/api/terminal/exec'), false);
        assert.equal(isFamilyAllowedRequest('POST', '/api/docker/lab-caddy/restart'), false);
        assert.equal(isFamilyAllowedRequest('GET', '/api/ports'), false);

        const deps = createFixtureDeps(tmpDir);
        const hub = createDashboardHubManager(deps);
        await hub.createBookmark({ label: 'Kids TV', url: 'https://youtube.com', family: true });
        await hub.createBookmark({ label: 'Secret Admin', url: 'https://admin.local', family: false });

        const fam = await hub.getLauncher({ role: 'family' });
        assert.equal(fam.role, 'family');
        assert.equal(fam.apps.every((a) => a.family === true), true);
        assert.equal(fam.apps.some((a) => a.id === 'terminal'), false);
        assert.equal(fam.apps.some((a) => a.id === 'onepercentbot'), false);
        assert.equal(fam.apps.some((a) => a.id === 'homeassistant'), true);
        assert.equal(fam.apps.some((a) => a.id === 'docker-lab-grafana'), true);
        assert.equal(fam.bookmarks.length, 1);
        assert.equal(fam.bookmarks[0].label, 'Kids TV');
        assert.equal(fam.badges.onepercentbot, undefined);
        assert.ok(fam.badges.energy);
    } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true });
    }
});

test('parseDockerLabelsToApp skips non-web ports and stopped unlabelled containers', () => {
    const dbOnly = parseDockerLabelsToApp({
        Id: '111',
        Names: ['/redis-cache'],
        State: 'running',
        Ports: [{ PublicPort: 6379, PrivatePort: 6379, Type: 'tcp' }],
        Labels: {},
    });
    assert.equal(dbOnly, null);

    const stoppedUnlabelled = parseDockerLabelsToApp({
        Id: '222',
        Names: ['/old-app'],
        State: 'exited',
        Ports: [{ PublicPort: 8080, PrivatePort: 8080, Type: 'tcp' }],
        Labels: {},
    });
    assert.equal(stoppedUnlabelled, null);
});

test('builtin and docker apps default openInWorkspace to false while preserving embed', () => {
    const enriched = enrichBuiltinApps([
        { id: 'agent-hub', label: 'Agent Hub', url: '/agent-hub' },
        { id: 'video-studio', label: 'Video Studio', url: '/video-studio', openInWorkspace: true },
        { id: 'energy', label: 'Energy', url: '#energy' },
    ]);
    const agentHub = enriched.find((a) => a.id === 'agent-hub');
    assert.equal(agentHub.embed, true);
    assert.equal(agentHub.openInWorkspace, false);

    const videoStudio = enriched.find((a) => a.id === 'video-studio');
    assert.equal(videoStudio.embed, true);
    assert.equal(videoStudio.openInWorkspace, true);

    const energy = enriched.find((a) => a.id === 'energy');
    assert.equal(energy.embed, false);
    assert.equal(energy.openInWorkspace, false);

    const dockerDefault = parseDockerLabelsToApp({
        Id: '333',
        Names: ['/custom-web'],
        State: 'running',
        Ports: [{ PublicPort: 8088, PrivatePort: 8088, Type: 'tcp' }],
        Labels: { 'lab.dashboard.enable': 'true' },
    });
    assert.equal(dockerDefault.embed, true);
    assert.equal(dockerDefault.openInWorkspace, false);

    const dockerWorkspace = parseDockerLabelsToApp({
        Id: '444',
        Names: ['/custom-ws'],
        State: 'running',
        Ports: [{ PublicPort: 8089, PrivatePort: 8089, Type: 'tcp' }],
        Labels: {
            'lab.dashboard.enable': 'true',
            'lab.dashboard.workspace': 'true',
            'lab.dashboard.embed': 'false',
        },
    });
    assert.equal(dockerWorkspace.embed, false);
    assert.equal(dockerWorkspace.openInWorkspace, true);
});

test('upsertEnvText replaces existing, appends new, deletes null, preserves comments/order, handles export/duplicates, rejects newline', () => {
    const original = [
        '# Main Homelab Env',
        '',
        'DASH_AUTH_PASS=supersecret',
        'export DASH_FAMILY_USER=oldfam',
        'DASH_FAMILY_USER=dup_user',
        'DASH_FAMILY_PASS=9999',
        'OTHER_KEY=keep_me',
        '',
    ].join('\n');

    const updated = upsertEnvText(original, {
        DASH_FAMILY_USER: 'mom & dad',
        DASH_FAMILY_PASS: null,
        DASH_FAMILY_VER: '2',
    });

    const lines = updated.split('\n');
    assert.ok(lines.includes('# Main Homelab Env'));
    assert.ok(lines.includes('DASH_AUTH_PASS=supersecret'));
    assert.ok(lines.includes('OTHER_KEY=keep_me'));
    assert.ok(
        lines.includes('DASH_FAMILY_USER="mom & dad"') || lines.includes('export DASH_FAMILY_USER="mom & dad"'),
    );
    assert.ok(!lines.some((l) => l.includes('dup_user')));
    assert.ok(!lines.some((l) => l.startsWith('DASH_FAMILY_PASS=')));
    assert.ok(lines.includes('DASH_FAMILY_VER=2'));

    assert.throws(() => upsertEnvText(original, { DASH_FAMILY_PASS: '1234\n5678' }));
});

test('validateFamilyPin & generateFamilyPin enforce length, admin pass collision, and 6-digit numeric output', () => {
    const env = { DASH_AUTH_PASS: 'adminpass99' };

    const tooShort = validateFamilyPin('123', env);
    assert.equal(tooShort.ok, false);
    assert.ok(tooShort.error);

    const sameAsAdmin = validateFamilyPin('adminpass99', env);
    assert.equal(sameAsAdmin.ok, false);
    assert.ok(sameAsAdmin.error);

    const valid = validateFamilyPin('123456', env);
    assert.equal(valid.ok, true);

    for (let i = 0; i < 5; i++) {
        const pin = generateFamilyPin();
        assert.match(pin, /^\d{6}$/);
    }
});

test('setFamilyApps persists overrides in launcher-config.json and setPinned preserves familyApps', async () => {
    const tmpDir = await makeTempDir();
    try {
        const deps = createFixtureDeps(tmpDir);
        const mgr = createDashboardHubManager(deps);

        await mgr.setFamilyApps({ terminal: true, homeassistant: false });

        const launcher = await mgr.getLauncher({ role: 'admin' });
        const terminalApp = launcher.apps.find((a) => a.id === 'terminal');
        const haApp = launcher.apps.find((a) => a.id === 'homeassistant');
        assert.equal(terminalApp.family, true);
        assert.equal(haApp.family, false);

        // setPinned must not wipe familyApps
        await mgr.setPinned(['terminal']);
        const rawCfg = JSON.parse(await fsp.readFile(deps.launcherFile, 'utf8'));
        assert.deepEqual(rawCfg.pinned, ['terminal']);
        assert.deepEqual(rawCfg.familyApps, { terminal: true, homeassistant: false });
    } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true });
    }
});
