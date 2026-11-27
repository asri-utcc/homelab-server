'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const bridge = require('../browser-vision-bridge');

function buildClientWsFrame(opcode, payload, { fin = true, masked = true, maskKey = Buffer.from([0x11, 0x22, 0x33, 0x44]) } = {}) {
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
    const len = data.length;
    const b0 = (fin ? 0x80 : 0x00) | (opcode & 0x0f);
    const maskBit = masked ? 0x80 : 0x00;

    let header;
    if (len < 126) {
        header = Buffer.allocUnsafe(2);
        header[0] = b0;
        header[1] = maskBit | len;
    } else if (len <= 65535) {
        header = Buffer.allocUnsafe(4);
        header[0] = b0;
        header[1] = maskBit | 126;
        header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.allocUnsafe(10);
        header[0] = b0;
        header[1] = maskBit | 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }

    if (!masked) {
        return Buffer.concat([header, data]);
    }

    const maskedData = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) {
        maskedData[i] = data[i] ^ maskKey[i & 3];
    }
    return Buffer.concat([header, maskKey, maskedData]);
}

test('CONTRACT A: toBrowserSessionName handles valid IDs, 32-char boundary, and fallback hash', () => {
    assert.equal(bridge.toBrowserSessionName('sess_1795474757000_ab12'), 'bv_sess_1795474757000_ab12');
    assert.equal(bridge.toBrowserSessionName('  room-A_1  '), 'bv_room-A_1');

    // Exact 32-char limit: 'bv_' (3) + 29 valid chars = 32 chars
    const maxDirect = 'a'.repeat(29);
    const directName = bridge.toBrowserSessionName(maxDirect);
    assert.equal(directName, 'bv_' + maxDirect);
    assert.equal(directName.length, 32);

    // 30+ chars falls back to sha256 prefix (<= 32 chars)
    const tooLong = 'a'.repeat(30);
    const hashedLong = bridge.toBrowserSessionName(tooLong);
    const expectedHash = 'bv_' + crypto.createHash('sha256').update(tooLong, 'utf8').digest('hex').slice(0, 16);
    assert.equal(hashedLong, expectedHash);
    assert.ok(hashedLong.length <= 32);
    assert.match(hashedLong, /^bv_[0-9a-f]{16}$/);

    // Invalid characters fall back deterministically to sha256 prefix
    const special = 'room:1/2@host#ไทย';
    const hashedSpecial1 = bridge.toBrowserSessionName(special);
    const hashedSpecial2 = bridge.toBrowserSessionName(special);
    assert.equal(hashedSpecial1, hashedSpecial2);
    assert.ok(hashedSpecial1.length <= 32);
    assert.match(hashedSpecial1, /^bv_[0-9a-f]{16}$/);

    // Empty/missing IDs throw
    assert.throws(() => bridge.toBrowserSessionName(''), /Missing chat session ID/);
    assert.throws(() => bridge.toBrowserSessionName('   '), /Missing chat session ID/);
    assert.throws(() => bridge.toBrowserSessionName(null), /Missing chat session ID/);
});

test('WS encode/decode: small, masked, 126-length, 127-length, and close frames', () => {
    // 1. Small unmasked server frame (< 126)
    const smallServer = bridge.encodeWsFrame(0x1, 'hello');
    assert.equal(smallServer[0], 0x81);
    assert.equal(smallServer[1], 5);

    const parsed = [];
    const closed = [];
    const errors = [];
    const parser = new bridge.WsFrameParser({
        onMessage: (op, buf) => parsed.push({ op, text: buf.toString('utf8') }),
        onClose: (code, reason) => closed.push({ code, reason }),
        onError: (code, reason) => errors.push({ code, reason }),
    });

    parser.push(smallServer);
    assert.deepEqual(parsed, [{ op: 0x1, text: 'hello' }]);

    // 2. Masked client frame (< 126)
    parser.push(buildClientWsFrame(0x1, 'masked-msg', { masked: true }));
    assert.equal(parsed[1].text, 'masked-msg');

    // 3. Length 126 (16-bit extended payload: 126..65535)
    const msg126 = 'x'.repeat(126);
    const frame126 = bridge.encodeWsFrame(0x1, msg126);
    assert.equal(frame126[1], 126);
    assert.equal(frame126.readUInt16BE(2), 126);
    parser.push(buildClientWsFrame(0x1, msg126, { masked: true }));
    assert.equal(parsed[2].text, msg126);

    const msg500 = 'y'.repeat(500);
    parser.push(bridge.encodeWsFrame(0x1, msg500));
    assert.equal(parsed[3].text, msg500);

    // 4. Length 127 (64-bit extended payload: > 65535, within 1MB limit)
    const msg70k = 'z'.repeat(70000);
    const frame127 = bridge.encodeWsFrame(0x1, msg70k);
    assert.equal(frame127[1], 127);
    assert.equal(Number(frame127.readBigUInt64BE(2)), 70000);
    parser.push(buildClientWsFrame(0x1, msg70k, { masked: true }));
    assert.equal(parsed[4].text.length, 70000);
    assert.equal(parsed[4].text, msg70k);

    // 5. Close frame encode/decode
    const closeFrame = bridge.encodeCloseFrame(1008, 'policy');
    parser.push(closeFrame);
    assert.deepEqual(closed, [{ code: 1008, reason: 'policy' }]);
    assert.deepEqual(errors, []);
});

test('WS WsFrameParser: fragmented frames + interleaved control frame + partial chunks', () => {
    const messages = [];
    const pings = [];
    const pongs = [];
    const errors = [];

    const parser = new bridge.WsFrameParser({
        onMessage: (op, buf) => messages.push({ op, text: buf.toString('utf8') }),
        onPing: (buf) => pings.push(buf.toString('utf8')),
        onPong: (buf) => pongs.push(buf.toString('utf8')),
        onError: (code, reason) => errors.push({ code, reason }),
    });

    const f1 = buildClientWsFrame(0x1, 'part1-', { fin: false, masked: true });
    const ping = buildClientWsFrame(0x9, 'hb', { fin: true, masked: true });
    const f2 = buildClientWsFrame(0x0, 'part2-', { fin: false, masked: true });
    const pong = buildClientWsFrame(0xA, 'ok', { fin: true, masked: true });
    const f3 = buildClientWsFrame(0x0, 'part3', { fin: true, masked: true });

    const combined = Buffer.concat([f1, ping, f2, pong, f3]);
    // Feed in small irregular slices to verify partial frame reassembly
    for (let i = 0; i < combined.length; i += 3) {
        parser.push(combined.subarray(i, i + 3));
    }

    assert.deepEqual(messages, [{ op: 0x1, text: 'part1-part2-part3' }]);
    assert.deepEqual(pings, ['hb']);
    assert.deepEqual(pongs, ['ok']);
    assert.deepEqual(errors, []);
});

test('WS WsFrameParser: rejects messages exceeding 1MB (both single frame and fragmented)', () => {
    const errorsSingle = [];
    const p1 = new bridge.WsFrameParser({
        onError: (code, reason) => errorsSingle.push({ code, reason }),
    });
    const over1Mb = Buffer.alloc(1024 * 1024 + 1, 0x61);
    p1.push(buildClientWsFrame(0x1, over1Mb, { masked: true }));
    assert.equal(errorsSingle.length, 1);
    assert.equal(errorsSingle[0].code, 1009);
    assert.equal(p1.stopped, true);

    const errorsFrag = [];
    const p2 = new bridge.WsFrameParser({
        onError: (code, reason) => errorsFrag.push({ code, reason }),
    });
    const halfMb = Buffer.alloc(600 * 1024, 0x62);
    p2.push(buildClientWsFrame(0x1, halfMb, { fin: false, masked: true }));
    p2.push(buildClientWsFrame(0x0, halfMb, { fin: true, masked: true }));
    assert.equal(errorsFrag.length, 1);
    assert.equal(errorsFrag[0].code, 1009);
    assert.equal(p2.stopped, true);
});

test('WS attachUpgrade: 401 when unauthorized, 101 when authorized, closes with 1009 on >1MB frame', async () => {
    const chatId = 'unit_ws_1mb';
    const sessionName = bridge.toBrowserSessionName(chatId);
    const stateDir = path.join(bridge.LAB_BROWSER_DIR, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    const mockSockPath = path.join(stateDir, `${sessionName}.stream.sock`);
    try { if (fs.existsSync(mockSockPath)) fs.unlinkSync(mockSockPath); } catch (_) {}

    const daemonClients = new Set();
    const mockDaemon = net.createServer((conn) => {
        daemonClients.add(conn);
        conn.write(JSON.stringify({ type: 'hello', session: sessionName, url: 'about:blank' }) + '\n');
        conn.on('close', () => daemonClients.delete(conn));
    });
    await new Promise((resolve) => mockDaemon.listen(mockSockPath, resolve));

    const httpServer = http.createServer((req, res) => {
        res.writeHead(404);
        res.end();
    });
    bridge.attachUpgrade(httpServer, {
        isAuthorized: async (req) => req.headers['x-test-auth'] === 'valid',
        log: () => {},
    });
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const port = httpServer.address().port;

    try {
        // 1. Unauthorized upgrade -> 401
        const unauthRes = await new Promise((resolve, reject) => {
            const key = crypto.randomBytes(16).toString('base64');
            const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
                sock.write(
                    `GET /ws/browser-vision?chat=${chatId} HTTP/1.1\r\n` +
                    `Host: 127.0.0.1:${port}\r\n` +
                    'Upgrade: websocket\r\n' +
                    'Connection: Upgrade\r\n' +
                    `Sec-WebSocket-Key: ${key}\r\n` +
                    'Sec-WebSocket-Version: 13\r\n\r\n'
                );
            });
            let data = '';
            sock.on('data', (c) => { data += c.toString('utf8'); });
            sock.on('end', () => resolve(data));
            sock.on('close', () => resolve(data));
            sock.on('error', reject);
        });
        assert.match(unauthRes, /^HTTP\/1\.1 401 Unauthorized/);

        // 2. Authorized upgrade -> 101 + hello + closes with 1009 when client sends >1MB frame
        const wsResult = await new Promise((resolve, reject) => {
            const key = crypto.randomBytes(16).toString('base64');
            const expectedAccept = crypto
                .createHash('sha1')
                .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', 'utf8')
                .digest('base64');

            const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
                sock.write(
                    `GET /ws/browser-vision?chat=${chatId} HTTP/1.1\r\n` +
                    `Host: 127.0.0.1:${port}\r\n` +
                    'Upgrade: websocket\r\n' +
                    'Connection: Upgrade\r\n' +
                    `Sec-WebSocket-Key: ${key}\r\n` +
                    'Sec-WebSocket-Version: 13\r\n' +
                    'X-Test-Auth: valid\r\n\r\n'
                );
            });

            let rawBuf = Buffer.alloc(0);
            let handshakeDone = false;
            let sentBigFrame = false;
            const serverMsgs = [];
            const closeEvents = [];

            const clientParser = new bridge.WsFrameParser({
                onMessage: (_op, payload) => {
                    serverMsgs.push(JSON.parse(payload.toString('utf8')));
                    if (!sentBigFrame) {
                        sentBigFrame = true;
                        const bigPayload = Buffer.alloc(1024 * 1024 + 64, 0x41);
                        sock.write(buildClientWsFrame(0x1, bigPayload, { masked: true }));
                    }
                },
                onClose: (code, reason) => {
                    closeEvents.push({ code, reason });
                    sock.destroy();
                },
            }, 4 * 1024 * 1024);

            sock.on('data', (chunk) => {
                if (!handshakeDone) {
                    rawBuf = Buffer.concat([rawBuf, chunk]);
                    const sep = rawBuf.indexOf('\r\n\r\n');
                    if (sep === -1) return;
                    const hdr = rawBuf.subarray(0, sep).toString('utf8');
                    assert.match(hdr, /^HTTP\/1\.1 101 Switching Protocols/);
                    assert.ok(hdr.includes(`Sec-WebSocket-Accept: ${expectedAccept}`));
                    handshakeDone = true;
                    const rest = rawBuf.subarray(sep + 4);
                    if (rest.length > 0) clientParser.push(rest);
                } else {
                    clientParser.push(chunk);
                }
            });
            sock.on('close', () => resolve({ handshakeDone, serverMsgs, closeEvents }));
            sock.on('error', reject);
        });

        assert.equal(wsResult.handshakeDone, true);
        assert.equal(wsResult.serverMsgs[0].type, 'hello');
        assert.equal(wsResult.serverMsgs[0].session, sessionName);
        assert.equal(wsResult.closeEvents.length, 1);
        assert.equal(wsResult.closeEvents[0].code, 1009);
    } finally {
        for (const c of daemonClients) {
            try { c.destroy(); } catch (_) {}
        }
        await new Promise((resolve) => httpServer.close(resolve));
        await new Promise((resolve) => mockDaemon.close(resolve));
        try { if (fs.existsSync(mockSockPath)) fs.unlinkSync(mockSockPath); } catch (_) {}
    }
});

test('isSensitiveAlertUrl & stripUrlSecrets detect login/auth/captcha/otp URLs and strip secrets', () => {
    const sensitiveCases = [
        'https://accounts.google.com/v3/signin/identifier?client_id=abc&token=secret',
        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?code=123',
        'https://login.live.com/login.srf?wa=wsignin1.0',
        'https://appleid.apple.com/auth/authorize',
        'https://www.tiktok.com/login/phone-or-email/email',
        'https://www.facebook.com/login/?next=https%3A%2F%2Ffacebook.com',
        'https://www.instagram.com/accounts/login/',
        'https://example.org/oauth/authorize?state=xyz',
        'https://example.org/security/2fa/verify',
        'https://example.org/auth/otp',
        'https://example.org/challenge/captcha',
        'https://example.org/signin',
    ];
    for (const u of sensitiveCases) {
        assert.equal(bridge.isSensitiveAlertUrl(u), true, `Expected sensitive: ${u}`);
    }

    const normalCases = [
        'https://example.com/',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://github.com/openai/codex',
        'https://www.tiktok.com/@creator',
        'about:blank',
        '',
        null,
        'not-a-url',
    ];
    for (const u of normalCases) {
        assert.equal(bridge.isSensitiveAlertUrl(u), false, `Expected non-sensitive: ${u}`);
    }

    const stripped = bridge.stripUrlSecrets('https://accounts.google.com/v3/signin?access_token=TOPSECRET&session=999#hashsecret');
    assert.equal(stripped.safeUrl, 'https://accounts.google.com/v3/signin');
    assert.equal(stripped.domain, 'accounts.google.com');
    assert.ok(!stripped.safeUrl.includes('TOPSECRET'));
    assert.ok(!stripped.safeUrl.includes('hashsecret'));
});

test('GET /api/browser-vision/alerts requires auth, classifies sessions, and strips query secrets', async () => {
    const callAlerts = async ({ authed = true, sessions = [] } = {}) => {
        let statusCode = null;
        let payload = null;
        const handled = await bridge.handleApi(
            { method: 'GET', headers: {} },
            {},
            new URL('http://localhost/api/browser-vision/alerts'),
            {
                isAuthorized: async () => authed,
                sendJson: (_res, code, body) => { statusCode = code; payload = body; },
                readJsonBody: async () => ({}),
                sessionClient: {
                    listSessions: async () => sessions,
                },
            }
        );
        return { handled, statusCode, payload };
    };

    // 1. Unauthorized -> 401
    const unauth = await callAlerts({ authed: false });
    assert.equal(unauth.handled, true);
    assert.equal(unauth.statusCode, 401);
    assert.equal(unauth.payload.ok, false);

    // 2. Authorized -> classifies paused, sensitive URL, social upload, skips normal & dead sessions
    const mockSessions = [
        {
            session: 'bv_sess_chat_captcha',
            alive: true,
            paused: true,
            pauseReason: 'sensitive_captcha',
            url: 'https://www.tiktok.com/login?token=LEAK_ME_NOT&code=42',
            lastActivityAt: '2026-11-27T15:00:00.000Z',
        },
        {
            session: 'bv_sess_chat_login',
            alive: true,
            paused: false,
            url: 'https://accounts.google.com/v3/signin?client_secret=HIDE_THIS',
            lastActivityAt: '2026-11-27T15:01:00.000Z',
        },
        {
            session: 'bv_sess_chat_otp',
            alive: true,
            paused: true,
            pauseReason: 'otp',
            url: 'https://bank.example.com/confirm',
            lastActivityAt: '2026-11-27T15:02:00.000Z',
        },
        {
            session: 'bv_labweb_soc_tiktok',
            alive: true,
            paused: false,
            url: 'https://www.tiktok.com/creator-center/upload?session_key=XYZ',
            lastActivityAt: '2026-11-27T15:03:00.000Z',
        },
        {
            session: 'bv_sess_normal',
            alive: true,
            paused: false,
            url: 'https://example.com/article/123',
        },
        {
            session: 'bv_sess_dead',
            alive: false,
            paused: true,
            pauseReason: 'login',
            url: 'https://accounts.google.com/signin',
        },
    ];

    const res = await callAlerts({ authed: true, sessions: mockSessions });
    assert.equal(res.handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.count, 4);
    assert.equal(res.payload.alerts.length, 4);
    assert.ok(typeof res.payload.updatedAt === 'string' && res.payload.updatedAt.length > 0);

    const bySession = Object.fromEntries(res.payload.alerts.map((a) => [a.sessionName, a]));

    // Captcha chat session
    assert.equal(bySession.bv_sess_chat_captcha.kind, 'captcha');
    assert.equal(bySession.bv_sess_chat_captcha.chatId, 'sess_chat_captcha');
    assert.equal(bySession.bv_sess_chat_captcha.browserVisionUrl, '/gemini?session=sess_chat_captcha&bv=1');
    assert.equal(bySession.bv_sess_chat_captcha.url, 'https://www.tiktok.com/login');
    assert.ok(!JSON.stringify(bySession.bv_sess_chat_captcha).includes('LEAK_ME_NOT'));

    // Google login URL without explicit pause
    assert.equal(bySession.bv_sess_chat_login.kind, 'login');
    assert.equal(bySession.bv_sess_chat_login.chatId, 'sess_chat_login');
    assert.equal(bySession.bv_sess_chat_login.domain, 'accounts.google.com');
    assert.ok(!JSON.stringify(bySession.bv_sess_chat_login).includes('HIDE_THIS'));

    // OTP pause
    assert.equal(bySession.bv_sess_chat_otp.kind, 'otp');
    assert.match(bySession.bv_sess_chat_otp.title, /OTP/);

    // Social upload standalone session
    assert.equal(bySession.bv_labweb_soc_tiktok.kind, 'social_upload');
    assert.equal(bySession.bv_labweb_soc_tiktok.chatId, null);
    assert.equal(bySession.bv_labweb_soc_tiktok.platform, 'tiktok');
    assert.equal(bySession.bv_labweb_soc_tiktok.sourceType, 'social');
    assert.equal(bySession.bv_labweb_soc_tiktok.browserVisionUrl, '/lab-browser?profile=soc_tiktok');
    assert.ok(!JSON.stringify(bySession.bv_labweb_soc_tiktok).includes('session_key'));

    // Normal & dead sessions excluded
    assert.equal(bySession.bv_sess_normal, undefined);
    assert.equal(bySession.bv_sess_dead, undefined);
});
