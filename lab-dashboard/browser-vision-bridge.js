'use strict';

/**
 * browser-vision-bridge.js
 * ------------------------
 * WebSocket (RFC 6455) + REST bridge between lab-dashboard and lab-browser
 * per-chat browser sessions (Live Browser Vision Co-Pilot).
 *
 * Zero external dependencies — Node.js built-ins only.
 */

const crypto = require('crypto');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { URL } = require('url');

const LAB_BROWSER_DIR = '/home/dev/.local/share/lab-browser';
const LAB_BROWSER_BIN = '/home/dev/.local/bin/lab-browser';

const WS_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_WS_MESSAGE_BYTES = 1024 * 1024;           // 1 MB max client WS message
const FRAME_DROP_HIGH_WATER_BYTES = 1536 * 1024;    // 1.5 MB backpressure drop threshold for video frames
const WS_PING_INTERVAL_MS = 25000;
const STREAM_CONNECT_RETRIES = 15;
const STREAM_CONNECT_DELAY_MS = 200;

const ALLOWED_CLIENT_MSG_TYPES = new Set([
    'input',
    'mouse',
    'key',
    'wheel',
    'inspect',
    'navigate',
    'back',
    'forward',
    'reload',
    'tab',
    'tabs',
    'new-tab',
    'close-tab',
    'pause',
    'resume',
    'resize',
    'viewport',
    'quality',
    'ping',
    'pong',
    'status',
]);

// ── Lazy loaders for lab-browser modules ─────────────────────────────────────
let _sessionClient = null;
let _authStore = null;

function getSessionClient() {
    if (_sessionClient) return _sessionClient;
    try {
        _sessionClient = require(path.join(LAB_BROWSER_DIR, 'lib', 'session-client.js'));
        return _sessionClient;
    } catch (_) {
        return null;
    }
}

function getAuthStore() {
    if (_authStore) return _authStore;
    try {
        _authStore = require(path.join(LAB_BROWSER_DIR, 'lib', 'auth-store.js'));
        return _authStore;
    } catch (_) {
        return null;
    }
}

// ── CONTRACT A: Deterministic per-chat browser session name ──────────────────
function toBrowserSessionName(chatSessionId) {
    const id = String(chatSessionId || '').trim();
    if (!id) {
        throw new Error('Missing chat session ID');
    }
    if (/^[A-Za-z0-9_-]+$/.test(id) && ('bv_' + id).length <= 32) {
        return 'bv_' + id;
    }
    const hash = crypto.createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 16);
    return 'bv_' + hash;
}

function resolveStreamSockPath(sessionName, sessionClient, ensureResult) {
    if (ensureResult) {
        if (ensureResult.streamSockPath) return ensureResult.streamSockPath;
        if (ensureResult.streamPath) return ensureResult.streamPath;
    }
    if (sessionClient && typeof sessionClient.getSessionPaths === 'function') {
        try {
            const paths = sessionClient.getSessionPaths(sessionName);
            if (paths && paths.streamSockPath) return paths.streamSockPath;
            if (paths && paths.streamPath) return paths.streamPath;
        } catch (_) { /* ignore */ }
    }
    return path.join(LAB_BROWSER_DIR, 'state', `${sessionName}.stream.sock`);
}

// ── RFC 6455 WebSocket Frame Encoder & Parser ────────────────────────────────
function encodeWsFrame(opcode, payload = Buffer.alloc(0)) {
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
    const len = data.length;
    const b0 = 0x80 | (opcode & 0x0f); // FIN=1, RSV=0

    let header;
    if (len < 126) {
        header = Buffer.allocUnsafe(2);
        header[0] = b0;
        header[1] = len; // MASK=0 (server-to-client)
    } else if (len <= 65535) {
        header = Buffer.allocUnsafe(4);
        header[0] = b0;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.allocUnsafe(10);
        header[0] = b0;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, data]);
}

function encodeCloseFrame(code = 1000, reason = '') {
    const reasonBuf = reason ? Buffer.from(String(reason), 'utf8') : Buffer.alloc(0);
    const body = Buffer.allocUnsafe(2 + reasonBuf.length);
    body.writeUInt16BE(code & 0xffff, 0);
    if (reasonBuf.length > 0) reasonBuf.copy(body, 2);
    return encodeWsFrame(0x8, body);
}

class WsFrameParser {
    constructor(handlers = {}, maxMessageBytes = MAX_WS_MESSAGE_BYTES) {
        this.onMessage = handlers.onMessage || (() => {});
        this.onPing = handlers.onPing || (() => {});
        this.onPong = handlers.onPong || (() => {});
        this.onClose = handlers.onClose || (() => {});
        this.onError = handlers.onError || (() => {});
        this.maxMessageBytes = maxMessageBytes;

        this.buf = Buffer.alloc(0);
        this.fragOpcode = null;
        this.fragChunks = [];
        this.fragBytes = 0;
        this.stopped = false;
    }

    push(chunk) {
        if (this.stopped || !chunk || chunk.length === 0) return;
        const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        this.buf = this.buf.length === 0 ? incoming : Buffer.concat([this.buf, incoming]);

        while (!this.stopped && this.buf.length >= 2) {
            const b0 = this.buf[0];
            const b1 = this.buf[1];
            const fin = Boolean(b0 & 0x80);
            const opcode = b0 & 0x0f;
            const masked = Boolean(b1 & 0x80);
            let len = b1 & 0x7f;
            let offset = 2;

            if (len === 126) {
                if (this.buf.length < 4) return;
                len = this.buf.readUInt16BE(2);
                offset = 4;
            } else if (len === 127) {
                if (this.buf.length < 10) return;
                const bigLen = this.buf.readBigUInt64BE(2);
                if (bigLen > BigInt(this.maxMessageBytes)) {
                    this.stopped = true;
                    this.onError(1009, 'Message too big');
                    return;
                }
                len = Number(bigLen);
                offset = 10;
            }

            if (len > this.maxMessageBytes) {
                this.stopped = true;
                this.onError(1009, 'Message too big');
                return;
            }

            const maskLen = masked ? 4 : 0;
            if (this.buf.length < offset + maskLen + len) return;

            let maskKey = null;
            if (masked) {
                maskKey = this.buf.subarray(offset, offset + 4);
                offset += 4;
            }

            const payload = Buffer.allocUnsafe(len);
            if (len > 0) {
                this.buf.copy(payload, 0, offset, offset + len);
                if (masked) {
                    for (let i = 0; i < len; i++) {
                        payload[i] ^= maskKey[i & 3];
                    }
                }
            }

            this.buf = this.buf.subarray(offset + len);

            // Control frames (0x8..0xF) may be interleaved between fragmented data frames
            if (opcode >= 0x8) {
                if (!fin || len > 125) {
                    this.stopped = true;
                    this.onError(1002, 'Invalid control frame');
                    return;
                }
                if (opcode === 0x8) {
                    const closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
                    const closeReason = payload.length > 2 ? payload.subarray(2).toString('utf8') : '';
                    this.stopped = true;
                    this.onClose(closeCode, closeReason);
                    return;
                }
                if (opcode === 0x9) {
                    this.onPing(payload);
                    continue;
                }
                if (opcode === 0xA) {
                    this.onPong(payload);
                    continue;
                }
                this.stopped = true;
                this.onError(1002, 'Unsupported control opcode');
                return;
            }

            // Data frames: 0x0 continuation, 0x1 text, 0x2 binary
            if (opcode === 0x1 || opcode === 0x2) {
                if (this.fragOpcode !== null) {
                    this.stopped = true;
                    this.onError(1002, 'Unexpected data frame during fragmentation');
                    return;
                }
                if (fin) {
                    this.onMessage(opcode, payload);
                } else {
                    this.fragOpcode = opcode;
                    this.fragChunks = [payload];
                    this.fragBytes = payload.length;
                }
            } else if (opcode === 0x0) {
                if (this.fragOpcode === null) {
                    this.stopped = true;
                    this.onError(1002, 'Unexpected continuation frame');
                    return;
                }
                this.fragBytes += payload.length;
                if (this.fragBytes > this.maxMessageBytes) {
                    this.stopped = true;
                    this.onError(1009, 'Message too big');
                    return;
                }
                this.fragChunks.push(payload);
                if (fin) {
                    const full = Buffer.concat(this.fragChunks, this.fragBytes);
                    const msgOpcode = this.fragOpcode;
                    this.fragOpcode = null;
                    this.fragChunks = [];
                    this.fragBytes = 0;
                    this.onMessage(msgOpcode, full);
                }
            } else {
                this.stopped = true;
                this.onError(1002, 'Unsupported opcode');
                return;
            }
        }
    }
}

// ── Stream Socket Connection Helpers ─────────────────────────────────────────
function connectUnixSocket(sockPath, timeoutMs = 1500) {
    return new Promise((resolve, reject) => {
        const sock = net.createConnection({ path: sockPath });
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            sock.destroy();
            reject(new Error('Stream socket connect timeout'));
        }, timeoutMs);

        sock.once('connect', () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(sock);
        });
        sock.once('error', (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            sock.destroy();
            reject(err);
        });
    });
}

function ensureDaemonViaCli(sessionName) {
    return new Promise((resolve, reject) => {
        execFile(
            LAB_BROWSER_BIN,
            ['session', 'status', '--session', sessionName, '--shared-auth'],
            { timeout: 20000, maxBuffer: 2 * 1024 * 1024 },
            (err, stdout, stderr) => {
                if (err) {
                    return reject(new Error(String(stderr || err.message || 'CLI fallback failed').trim()));
                }
                resolve(stdout);
            }
        );
    });
}

async function ensureAndConnectStream(sessionName, isAborted) {
    const sessionClient = getSessionClient();
    const initialPath = resolveStreamSockPath(sessionName, sessionClient, null);

    // Fast path: if stream socket already exists and accepts connections, connect directly
    if (fs.existsSync(initialPath)) {
        try {
            const sock = await connectUnixSocket(initialPath, 1200);
            return sock;
        } catch (_) {
            // Stale socket or daemon not ready — proceed to ensureDaemon
        }
    }

    if (isAborted()) throw new Error('Client disconnected');

    let ensureRes = null;
    let ensured = false;
    if (sessionClient && typeof sessionClient.ensureSessionDaemon === 'function') {
        try {
            ensureRes = await sessionClient.ensureSessionDaemon(sessionName, {
                authProfile: 'shared',
                idleTtlSec: 600,
            });
            ensured = true;
        } catch (_) {
            ensured = false;
        }
    }
    if (!ensured) {
        await ensureDaemonViaCli(sessionName);
    }

    const streamSockPath = resolveStreamSockPath(sessionName, sessionClient, ensureRes);
    let lastErr = null;
    for (let i = 0; i < STREAM_CONNECT_RETRIES; i++) {
        if (isAborted()) throw new Error('Client disconnected');
        try {
            return await connectUnixSocket(streamSockPath, 1500);
        } catch (err) {
            lastErr = err;
            await new Promise((r) => setTimeout(r, STREAM_CONNECT_DELAY_MS));
        }
    }
    throw lastErr || new Error(`Could not connect to browser stream socket (${streamSockPath})`);
}

function isFrameNdjsonLine(line) {
    if (line.startsWith('{"type":"frame"')) return true;
    const head = line.slice(0, 64);
    return /^\{[\s\S]{0,40}"type"\s*:\s*"frame"/.test(head);
}

// ── CONTRACT G: WebSocket Upgrade Handler ────────────────────────────────────
function writeHttpReject(socket, statusLine) {
    try {
        socket.end(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    } catch (_) { /* ignore */ }
    try { socket.destroy(); } catch (_) { /* ignore */ }
}

function attachUpgrade(server, { isAuthorized, log = console.log } = {}) {
    if (!server || typeof server.on !== 'function') return;

    server.on('upgrade', async (req, socket, head) => {
        let url;
        try {
            url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        } catch (_) {
            return writeHttpReject(socket, '400 Bad Request');
        }

        if (url.pathname !== '/ws/browser-vision') {
            return; // Not our WebSocket path
        }

        const upgradeHdr = String(req.headers.upgrade || '').toLowerCase();
        const wsKey = String(req.headers['sec-websocket-key'] || '').trim();
        const wsVersion = String(req.headers['sec-websocket-version'] || '').trim();
        if (req.method !== 'GET' || upgradeHdr !== 'websocket' || !wsKey || wsVersion !== '13') {
            return writeHttpReject(socket, '400 Bad Request');
        }

        try {
            const authed = typeof isAuthorized === 'function' ? await isAuthorized(req) : false;
            if (!authed) {
                return writeHttpReject(socket, '401 Unauthorized');
            }
        } catch (_) {
            return writeHttpReject(socket, '401 Unauthorized');
        }

        const chatId = (url.searchParams.get('chat') || '').trim();
        if (!chatId) {
            return writeHttpReject(socket, '400 Bad Request');
        }

        let sessionName;
        try {
            sessionName = toBrowserSessionName(chatId);
        } catch (_) {
            return writeHttpReject(socket, '400 Bad Request');
        }

        const acceptKey = crypto
            .createHash('sha1')
            .update(wsKey + WS_MAGIC_GUID, 'utf8')
            .digest('base64');

        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
        );
        socket.setNoDelay(true);

        let closed = false;
        let streamSock = null;
        const pendingClientLines = [];

        const sendWsFrameSafe = (frameBuf) => {
            if (closed || socket.destroyed || !socket.writable) return false;
            try {
                socket.write(frameBuf);
                return true;
            } catch (_) {
                cleanup();
                return false;
            }
        };

        const cleanup = (closeCode, closeReason) => {
            if (closed) return;
            closed = true;
            clearInterval(pingTimer);
            if (closeCode && !socket.destroyed && socket.writable) {
                try { socket.write(encodeCloseFrame(closeCode, closeReason || '')); } catch (_) {}
            }
            if (streamSock) {
                try { streamSock.destroy(); } catch (_) {}
                streamSock = null;
            }
            try { socket.end(); } catch (_) {}
            try { socket.destroy(); } catch (_) {}
        };

        const pingTimer = setInterval(() => {
            if (closed) return;
            sendWsFrameSafe(encodeWsFrame(0x9, Buffer.alloc(0)));
        }, WS_PING_INTERVAL_MS);
        if (typeof pingTimer.unref === 'function') pingTimer.unref();

        const forwardToDaemon = (line) => {
            if (closed) return;
            if (streamSock && !streamSock.destroyed && streamSock.writable) {
                try {
                    streamSock.write(line);
                } catch (_) {
                    cleanup(1011, 'Stream write failed');
                }
            } else if (pendingClientLines.length < 32) {
                pendingClientLines.push(line);
            }
        };

        const parser = new WsFrameParser({
            onMessage: (opcode, payload) => {
                if (closed) return;
                if (opcode !== 0x1) return; // Text frames only
                let msg;
                try {
                    msg = JSON.parse(payload.toString('utf8'));
                } catch (_) {
                    return;
                }
                if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
                if (typeof msg.type !== 'string' || !ALLOWED_CLIENT_MSG_TYPES.has(msg.type)) return;
                forwardToDaemon(JSON.stringify(msg) + '\n');
            },
            onPing: (payload) => {
                sendWsFrameSafe(encodeWsFrame(0xA, payload));
            },
            onPong: () => {
                // Keepalive acknowledged
            },
            onClose: (code) => {
                cleanup(code || 1000);
            },
            onError: (code, reason) => {
                cleanup(code || 1002, reason);
            },
        });

        socket.on('data', (chunk) => parser.push(chunk));
        socket.on('close', () => cleanup());
        socket.on('end', () => cleanup());
        socket.on('error', () => cleanup());

        if (head && head.length > 0) {
            parser.push(head);
        }

        try {
            streamSock = await ensureAndConnectStream(sessionName, () => closed);
        } catch (err) {
            if (!closed) {
                log(`[browser-vision] WS connect failed (${sessionName}): ${err.message}`);
                sendWsFrameSafe(encodeWsFrame(0x1, JSON.stringify({
                    type: 'error',
                    error: err.message || 'Failed to connect to browser stream',
                })));
                cleanup(1011, 'Stream unavailable');
            }
            return;
        }

        if (closed) {
            try { streamSock.destroy(); } catch (_) {}
            return;
        }

        // Flush any client messages buffered during daemon startup
        while (pendingClientLines.length > 0 && !closed && streamSock && streamSock.writable) {
            const line = pendingClientLines.shift();
            try { streamSock.write(line); } catch (_) { break; }
        }

        let ndjsonBuf = '';
        streamSock.on('data', (chunk) => {
            if (closed) return;
            ndjsonBuf += chunk.toString('utf8');
            let nlIdx;
            while ((nlIdx = ndjsonBuf.indexOf('\n')) !== -1) {
                const line = ndjsonBuf.slice(0, nlIdx).trim();
                ndjsonBuf = ndjsonBuf.slice(nlIdx + 1);
                if (!line) continue;

                // Backpressure: drop video frames (without JSON.parse) if WS send buffer > 1.5 MB
                if (socket.writableLength > FRAME_DROP_HIGH_WATER_BYTES && isFrameNdjsonLine(line)) {
                    continue;
                }
                sendWsFrameSafe(encodeWsFrame(0x1, line));
            }
        });

        streamSock.on('close', () => cleanup(1000, 'Browser stream closed'));
        streamSock.on('end', () => cleanup(1000, 'Browser stream ended'));
        streamSock.on('error', (err) => {
            if (!closed) {
                log(`[browser-vision] stream socket error (${sessionName}): ${err.message}`);
                cleanup(1011, 'Browser stream error');
            }
        });
    });
}

// ── CONTRACT H: REST API Handler ─────────────────────────────────────────────
function sanitizeAuthSummary(summary) {
    if (!summary || typeof summary !== 'object') {
        return {
            profile: 'shared',
            exists: false,
            domains: [],
            cookieCount: 0,
            originCount: 0,
            updatedAt: null,
        };
    }
    return {
        profile: String(summary.profile || 'shared'),
        exists: Boolean(summary.exists),
        domains: Array.isArray(summary.domains) ? summary.domains.map((d) => String(d)) : [],
        cookieCount: Number(summary.cookieCount) || 0,
        originCount: Number(summary.originCount) || 0,
        updatedAt: summary.updatedAt || null,
    };
}

function isNotRunningError(err) {
    const msg = String((err && err.message) || err || '');
    return /not running|ENOENT|ECONNREFUSED/i.test(msg);
}

async function handleApi(req, res, url, { sendJson, readJsonBody, isAuthorized } = {}) {
    const p = url.pathname;
    if (!p.startsWith('/api/browser-vision/')) return false;

    const authed = typeof isAuthorized === 'function' ? await isAuthorized(req) : false;
    if (!authed) {
        sendJson(res, 401, { ok: false, error: 'Unauthorized' });
        return true;
    }

    const sessionClient = getSessionClient();
    const authStore = getAuthStore();

    // GET /api/browser-vision/auth/status
    if (req.method === 'GET' && p === '/api/browser-vision/auth/status') {
        try {
            const raw = authStore && typeof authStore.summary === 'function'
                ? await authStore.summary('shared')
                : null;
            sendJson(res, 200, { ok: true, ...sanitizeAuthSummary(raw) });
        } catch (err) {
            sendJson(res, 500, { ok: false, error: err.message });
        }
        return true;
    }

    // POST /api/browser-vision/auth/clear
    if (req.method === 'POST' && p === '/api/browser-vision/auth/clear') {
        try {
            if (authStore && typeof authStore.clear === 'function') {
                await authStore.clear('shared');
            }
            const notifiedSessions = [];
            if (sessionClient && typeof sessionClient.listSessions === 'function') {
                const active = await sessionClient.listSessions().catch(() => []);
                for (const s of active) {
                    const sName = s && s.session;
                    if (!sName) continue;
                    const usesShared = s.authProfile === 'shared' || String(sName).startsWith('bv_');
                    if (!usesShared) continue;
                    try {
                        await sessionClient.sendSessionCommand(sName, 'auth-clear', [], { authProfile: 'shared' }, false);
                        notifiedSessions.push(sName);
                    } catch (_) { /* ignore individual session errors */ }
                }
            }
            sendJson(res, 200, { ok: true, cleared: true, notifiedSessions });
        } catch (err) {
            sendJson(res, 500, { ok: false, error: err.message });
        }
        return true;
    }

    // All remaining endpoints require session-client
    if (!sessionClient) {
        sendJson(res, 503, { ok: false, error: 'lab-browser session-client unavailable' });
        return true;
    }

    // GET /api/browser-vision/session?chat=<chatSessionId>
    if (req.method === 'GET' && p === '/api/browser-vision/session') {
        const chatId = (url.searchParams.get('chat') || '').trim();
        if (!chatId) {
            sendJson(res, 400, { ok: false, error: 'Missing query parameter: chat' });
            return true;
        }
        const session = toBrowserSessionName(chatId);
        try {
            const status = await sessionClient.sendSessionCommand(session, 'status', [], { authProfile: 'shared' }, false);
            sendJson(res, 200, { ok: true, session, alive: true, status });
        } catch (err) {
            if (isNotRunningError(err)) {
                sendJson(res, 200, { ok: true, session, alive: false, status: null });
            } else {
                sendJson(res, 500, { ok: false, session, error: err.message });
            }
        }
        return true;
    }

    // POST /api/browser-vision/start { chat, url? }
    if (req.method === 'POST' && p === '/api/browser-vision/start') {
        let body;
        try { body = await readJsonBody(req); } catch (err) {
            sendJson(res, 400, { ok: false, error: err.message });
            return true;
        }
        const chatId = String((body && body.chat) || '').trim();
        if (!chatId) {
            sendJson(res, 400, { ok: false, error: 'Missing required field: chat' });
            return true;
        }
        const session = toBrowserSessionName(chatId);
        const startOpts = { authProfile: 'shared', idleTtlSec: 600 };
        try {
            await sessionClient.ensureSessionDaemon(session, startOpts);
            let status = await sessionClient.sendSessionCommand(session, 'status', [], startOpts, true);
            let openResult = null;
            const targetUrl = body && typeof body.url === 'string' ? body.url.trim() : '';
            if (targetUrl) {
                const currentUrl = status && typeof status.url === 'string' ? status.url : '';
                const useNewTab = Boolean(currentUrl && currentUrl !== 'about:blank');
                openResult = await sessionClient.sendSessionCommand(
                    session,
                    'open',
                    [targetUrl],
                    { ...startOpts, newTab: useNewTab },
                    true
                );
                status = await sessionClient.sendSessionCommand(session, 'status', [], startOpts, true).catch(() => status);
            }
            sendJson(res, 200, { ok: true, session, alive: true, status, openResult });
        } catch (err) {
            sendJson(res, 500, { ok: false, session, error: err.message });
        }
        return true;
    }

    // POST /api/browser-vision/pause { chat, reason? }
    if (req.method === 'POST' && p === '/api/browser-vision/pause') {
        let body;
        try { body = await readJsonBody(req); } catch (err) {
            sendJson(res, 400, { ok: false, error: err.message });
            return true;
        }
        const chatId = String((body && body.chat) || '').trim();
        if (!chatId) {
            sendJson(res, 400, { ok: false, error: 'Missing required field: chat' });
            return true;
        }
        const session = toBrowserSessionName(chatId);
        const reason = body && body.reason ? String(body.reason) : 'user';
        try {
            const result = await sessionClient.sendSessionCommand(
                session,
                'pause',
                [reason],
                { authProfile: 'shared', reason },
                false
            );
            sendJson(res, 200, { ok: true, session, ...result });
        } catch (err) {
            const code = isNotRunningError(err) ? 404 : 500;
            sendJson(res, code, { ok: false, session, error: err.message });
        }
        return true;
    }

    // POST /api/browser-vision/resume { chat, note? }
    if (req.method === 'POST' && p === '/api/browser-vision/resume') {
        let body;
        try { body = await readJsonBody(req); } catch (err) {
            sendJson(res, 400, { ok: false, error: err.message });
            return true;
        }
        const chatId = String((body && body.chat) || '').trim();
        if (!chatId) {
            sendJson(res, 400, { ok: false, error: 'Missing required field: chat' });
            return true;
        }
        const session = toBrowserSessionName(chatId);
        const note = body && body.note ? String(body.note) : '';
        try {
            const result = await sessionClient.sendSessionCommand(
                session,
                'resume',
                note ? [note] : [],
                { authProfile: 'shared', note },
                false
            );
            sendJson(res, 200, { ok: true, session, ...result });
        } catch (err) {
            const code = isNotRunningError(err) ? 404 : 500;
            sendJson(res, code, { ok: false, session, error: err.message });
        }
        return true;
    }

    // POST /api/browser-vision/close { chat }
    if (req.method === 'POST' && p === '/api/browser-vision/close') {
        let body;
        try { body = await readJsonBody(req); } catch (err) {
            sendJson(res, 400, { ok: false, error: err.message });
            return true;
        }
        const chatId = String((body && body.chat) || '').trim();
        if (!chatId) {
            sendJson(res, 400, { ok: false, error: 'Missing required field: chat' });
            return true;
        }
        const session = toBrowserSessionName(chatId);
        try {
            const result = await sessionClient.sendSessionCommand(
                session,
                'close',
                [],
                { authProfile: 'shared' },
                false
            );
            sendJson(res, 200, { ok: true, session, closed: true, ...result });
        } catch (err) {
            if (isNotRunningError(err)) {
                sendJson(res, 200, { ok: true, session, closed: false, alreadyClosed: true });
            } else {
                sendJson(res, 500, { ok: false, session, error: err.message });
            }
        }
        return true;
    }

    sendJson(res, 404, { ok: false, error: 'Unknown browser-vision endpoint' });
    return true;
}

// ── Fire-and-forget cleanup when a chat session is deleted ───────────────────
function closeChatBrowser(chatSessionId) {
    if (!chatSessionId) return;
    let session;
    try {
        session = toBrowserSessionName(chatSessionId);
    } catch (_) {
        return;
    }
    const sessionClient = getSessionClient();
    if (!sessionClient || typeof sessionClient.sendSessionCommand !== 'function') return;
    Promise.resolve()
        .then(() => sessionClient.sendSessionCommand(session, 'close', [], { authProfile: 'shared' }, false))
        .catch(() => {});
}

module.exports = {
    LAB_BROWSER_DIR,
    LAB_BROWSER_BIN,
    ALLOWED_CLIENT_MSG_TYPES,
    toBrowserSessionName,
    attachUpgrade,
    handleApi,
    closeChatBrowser,
    encodeWsFrame,
    encodeCloseFrame,
    WsFrameParser,
};
