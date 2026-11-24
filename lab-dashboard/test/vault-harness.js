'use strict';

/**
 * test/vault-harness.js
 * -----------------------------------------------------------------------------
 * Standalone localhost-only HTTP harness for testing /3d-vault & /api/3d-vault/*
 * without touching or restarting PM2 lab-dashboard.
 *
 * Usage:
 *   VAULT_DIR=/tmp/vt PORT=18099 node test/vault-harness.js
 */

const http = require('http');
const fsp = require('fs/promises');
const path = require('path');

const vaultManager = require('../asset-vault-manager');

const HOST = '127.0.0.1';
const PORT = parseInt(process.env.PORT || '18099', 10);
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json',
    '.woff2': 'font/woff2',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.obj': 'text/plain; charset=utf-8',
    '.stl': 'model/stl',
    '.ply': 'application/octet-stream',
};

function sendJson(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    res.end(body);
}

function readJsonBody(req, maxBytes = 64 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        let done = false;

        req.on('data', (chunk) => {
            if (done) return;
            total += chunk.length;
            if (total > maxBytes) {
                done = true;
                req.destroy();
                const err = new Error('Request body too large');
                err.statusCode = 413;
                reject(err);
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => {
            if (done) return;
            done = true;
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw.trim()) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch (_) {
                const err = new Error('Invalid JSON payload');
                err.statusCode = 400;
                reject(err);
            }
        });

        req.on('error', (err) => {
            if (done) return;
            done = true;
            reject(err);
        });
    });
}

async function serveStatic(req, res, pathname) {
    let decoded;
    try {
        decoded = decodeURIComponent(String(pathname || '/'));
    } catch (_) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('bad request');
        return;
    }

    if (decoded.includes('\0') || decoded.includes('..')) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('forbidden');
        return;
    }

    const rel = decoded === '/' ? '/3d-vault.html' : decoded;
    const segments = rel.split('/').filter(Boolean);
    if (segments.some((s) => s === '..' || s.startsWith('.'))) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('forbidden');
        return;
    }

    const filePath = path.resolve(PUBLIC_DIR, ...segments);
    const pubPrefix = PUBLIC_DIR.endsWith(path.sep) ? PUBLIC_DIR : PUBLIC_DIR + path.sep;
    if (!filePath.startsWith(pubPrefix)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('forbidden');
        return;
    }

    try {
        const st = await fsp.stat(filePath);
        if (!st.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('not found');
            return;
        }
        const data = await fsp.readFile(filePath);
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
            'Content-Length': data.length,
            'Cache-Control': 'no-cache',
        });
        if (req.method === 'HEAD') {
            res.end();
        } else {
            res.end(data);
        }
    } catch (_) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
    }
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || HOST}`);
    try {
        const handled = await vaultManager.handleRequest(req, res, url, {
            readJsonBody,
            sendJson,
            serveStatic,
        });
        if (handled) return;
        await serveStatic(req, res, url.pathname);
    } catch (err) {
        if (!res.headersSent) {
            sendJson(res, err.statusCode || 500, { ok: false, error: err.message });
        } else if (!res.writableEnded) {
            res.end();
        }
    }
});

server.listen(PORT, HOST, () => {
    console.log(`3D Vault harness listening on http://${HOST}:${PORT} (VAULT_DIR=${vaultManager.VAULT_DIR})`);
});

function shutdown() {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
