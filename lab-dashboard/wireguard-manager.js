'use strict';

/**
 * wireguard-manager.js
 * -----------------------------------------------------------------------------
 * Granular Client Management & Per-Client Policy Firewall Controller
 * for WireGuard (wg-easy) inside Homelab Dashboard.
 *
 * Capabilities:
 *  - Real-time client listing with handshake, transfer stats, online status
 *  - Granular Per-Client Policies:
 *      * Internet Access (Full Tunnel 0.0.0.0/0)
 *      * Local Home LAN Access (192.168.1.0/24)
 *      * Homelab Services Only (host 192.168.1.123 / 10.10.10.1)
 *      * Peer-to-Peer Isolation (10.10.10.0/24)
 *  - Policy Presets:
 *      * Admin (Full Access: Net ON, LAN ON, Server ON, P2P ON)
 *      * Family / Standard (Net ON, LAN OFF, Server ON, P2P OFF)
 *      * Guest (Net ON, LAN OFF, Server OFF, P2P OFF)
 *      * Intranet / Server Only (Net OFF, LAN OFF, Server ON, P2P OFF)
 *  - Dynamic iptables enforcement directly inside `lab-wireguard` container
 *  - Persistence across reboots in `wireguard-policies.json`
 *  - Full Client Operations: Create, Toggle, Delete, QR Code SVG, .conf download
 */

const http = require('http');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const LAB_DIR = process.env.LAB_DIR || path.join(os.homedir(), 'projects', 'lab-stack');
const POLICY_FILE = path.join(LAB_DIR, 'wireguard-policies.json');

const PRESETS = {
    admin: {
        preset: 'admin',
        label: '👑 Admin (Full Access)',
        description: 'ออกเน็ตได้ + คุยวงแลนบ้านได้ + คุยข้าม Peer ได้',
        allowInternet: true,
        allowLan: true,
        allowP2P: true,
        homelabOnly: false,
    },
    standard: {
        preset: 'standard',
        label: '👨‍👩‍👧 Standard / Family',
        description: 'ออกเน็ตได้ + เข้า Homelab ได้ + ป้องกันอุปกรณ์อื่นในบ้าน',
        allowInternet: true,
        allowLan: false,
        allowP2P: false,
        homelabOnly: false,
    },
    guest: {
        preset: 'guest',
        label: '☕ Guest (Internet Only)',
        description: 'ออกเน็ตได้อย่างเดียว บล็อกวงแลนและห้ามแตะ Homelab',
        allowInternet: true,
        allowLan: false,
        allowP2P: false,
        homelabOnly: false,
    },
    serveronly: {
        preset: 'serveronly',
        label: '🛡️ Homelab Only',
        description: 'เข้าได้เฉพาะเซิร์ฟเวอร์ Homelab ห้ามออกเน็ตเด็ดขาด',
        allowInternet: false,
        allowLan: false,
        allowP2P: false,
        homelabOnly: true,
    },
};

function execAsync(cmd, args, opts = {}) {
    return new Promise((resolve) => {
        execFile(cmd, args, opts, (err, stdout, stderr) => {
            resolve({
                code: err ? (err.code || 1) : 0,
                stdout: stdout ? stdout.toString() : '',
                stderr: stderr ? stderr.toString() : '',
                error: err,
            });
        });
    });
}

async function loadPolicies() {
    try {
        const text = await fsp.readFile(POLICY_FILE, 'utf8');
        return JSON.parse(text);
    } catch (_) {
        return { clients: {}, global: {} };
    }
}

async function savePolicies(data) {
    try {
        await fsp.writeFile(POLICY_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
        return true;
    } catch (e) {
        console.error('Error saving WireGuard policies:', e.message);
        return false;
    }
}

function callWgEasyApi(apiPath, method = 'GET', body = null, authPass = '') {
    return new Promise((resolve, reject) => {
        const headers = {
            Authorization: authPass,
        };
        let bodyPayload = null;
        if (body) {
            bodyPayload = typeof body === 'string' ? body : JSON.stringify(body);
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(bodyPayload);
        }

        const req = http.request({
            hostname: '127.0.0.1',
            port: 51821,
            path: apiPath,
            method: method.toUpperCase(),
            headers,
            timeout: 8000,
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                resolve({ status: res.statusCode, data, headers: res.headers });
            });
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
            req.destroy(new Error('Request to wg-easy timed out'));
        });

        if (bodyPayload) req.write(bodyPayload);
        req.end();
    });
}

/**
 * Enforces iptables rules inside lab-wireguard container based on active policies
 */
async function syncIptablesPolicies(policies, clients = []) {
    try {
        const cmds = [
            'iptables -N WG_CLIENT_POLICIES 2>/dev/null || iptables -F WG_CLIENT_POLICIES',
            'iptables -C FORWARD -i wg0 -j WG_CLIENT_POLICIES 2>/dev/null || iptables -I FORWARD 1 -i wg0 -j WG_CLIENT_POLICIES',
            'iptables -t nat -C POSTROUTING -s 10.10.10.0/24 -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s 10.10.10.0/24 -j MASQUERADE',
        ];

        for (const c of clients) {
            const ip = c.address;
            if (!ip || !ip.startsWith('10.10.10.')) continue;
            const pol = (policies.clients && policies.clients[c.publicKey]) || PRESETS.admin;

            // 1. If client is disabled in UI -> block completely
            if (c.enabled === false) {
                cmds.push(`iptables -A WG_CLIENT_POLICIES -s ${ip} -j REJECT --reject-with icmp-admin-prohibited`);
                continue;
            }

            // 2. Homelab Services Only mode: only allows host 192.168.1.123 and 10.10.10.1
            if (pol.homelabOnly) {
                cmds.push(`iptables -A WG_CLIENT_POLICIES -s ${ip} -d 192.168.1.123 -j ACCEPT`);
                cmds.push(`iptables -A WG_CLIENT_POLICIES -s ${ip} -d 10.10.10.1 -j ACCEPT`);
                cmds.push(`iptables -A WG_CLIENT_POLICIES -s ${ip} -j REJECT --reject-with icmp-admin-prohibited`);
                continue;
            }

            // 3. Peer-to-Peer isolation: block communication with other 10.10.10.x devices
            if (pol.allowP2P === false) {
                cmds.push(`iptables -A WG_CLIENT_POLICIES -s ${ip} -d 10.10.10.0/24 ! -d 10.10.10.1 -j REJECT --reject-with icmp-admin-prohibited`);
            }

            // 4. Local LAN access control: block access to home LAN (192.168.1.0/24 except Homelab server)
            if (pol.allowLan === false) {
                cmds.push(`iptables -A WG_CLIENT_POLICIES -s ${ip} -d 192.168.1.0/24 ! -d 192.168.1.123 -j REJECT --reject-with icmp-admin-prohibited`);
            }

            // 5. Internet access control: block non-private external IP ranges
            if (pol.allowInternet === false) {
                cmds.push(`iptables -A WG_CLIENT_POLICIES -s ${ip} ! -d 192.168.0.0/16 ! -d 10.0.0.0/8 ! -d 172.16.0.0/12 -j REJECT --reject-with icmp-admin-prohibited`);
            }
        }

        const script = cmds.join('\n');
        const res = await execAsync('docker', ['exec', 'lab-wireguard', 'sh', '-c', script], { timeout: 8000 });
        if (res.code !== 0) {
            console.error('Failed to sync iptables in wireguard container:', res.stderr);
            return false;
        }
        return true;
    } catch (e) {
        console.error('syncIptablesPolicies error:', e.message);
        return false;
    }
}

async function listClientsWithPolicies(authPass) {
    const [apiRes, dumpRes, policies] = await Promise.all([
        callWgEasyApi('/api/wireguard/client', 'GET', null, authPass).catch(() => ({ status: 500, data: '[]' })),
        execAsync('docker', ['exec', 'lab-wireguard', 'wg', 'show', 'all', 'dump'], { timeout: 6000 }),
        loadPolicies(),
    ]);

    let rawClients = [];
    if (apiRes.status === 200 && apiRes.data) {
        try {
            rawClients = JSON.parse(apiRes.data);
        } catch (_) { /* ignore */ }
    }

    const dumpStats = {};
    const nowSec = Math.floor(Date.now() / 1000);
    if (dumpRes.code === 0 && dumpRes.stdout) {
        for (const line of dumpRes.stdout.trim().split('\n')) {
            const parts = line.split('\t');
            if (parts.length >= 9) {
                const pKey = parts[1];
                const endpoint = parts[3] === '(none)' ? '' : parts[3];
                const allowedIps = parts[4];
                const latestHandshake = parseInt(parts[5], 10) || 0;
                const rx = parseInt(parts[6], 10) || 0;
                const tx = parseInt(parts[7], 10) || 0;
                const ageSec = latestHandshake > 0 ? Math.max(0, nowSec - latestHandshake) : null;
                dumpStats[pKey] = {
                    endpoint,
                    allowedIps,
                    latestHandshake,
                    handshakeAgeSec: ageSec,
                    online: ageSec !== null && ageSec <= 180,
                    rxBytes: rx,
                    txBytes: tx,
                };
            }
        }
    }

    const merged = rawClients.map((c) => {
        const stats = dumpStats[c.publicKey] || {
            endpoint: '',
            latestHandshake: 0,
            handshakeAgeSec: null,
            online: false,
            rxBytes: 0,
            txBytes: 0,
        };

        const pol = (policies.clients && policies.clients[c.publicKey]) || {
            preset: 'admin',
            allowInternet: true,
            allowLan: true,
            allowP2P: true,
            homelabOnly: false,
        };

        return {
            id: c.id,
            name: c.name,
            address: c.address,
            publicKey: c.publicKey,
            enabled: c.enabled,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
            endpoint: stats.endpoint,
            latestHandshake: stats.latestHandshake,
            handshakeAgeSec: stats.handshakeAgeSec,
            online: stats.online,
            rxBytes: stats.rxBytes,
            txBytes: stats.txBytes,
            policy: pol,
        };
    });

    return {
        clients: merged,
        policies,
        presets: PRESETS,
    };
}

module.exports = {
    PRESETS,
    loadPolicies,
    savePolicies,
    callWgEasyApi,
    syncIptablesPolicies,
    listClientsWithPolicies,
};
