#!/usr/bin/env node
/**
 * lab-dashboard — แดชบอร์ดควบคุม home-lab แบบรวมศูนย์
 * ---------------------------------------------------------------
 * รวมข้อมูลจากทุกบริการมาไว้ในหน้าเดียว (ไม่ต้องกดลิ้งค์ไป login ทีละเว็บ)
 *
 *   Host    : /proc, /sys  (CPU, RAM, disk, temp, net, load, uptime)
 *   Docker  : Docker API ผ่าน unix socket + `docker stats --no-stream`
 *   PM2     : `pm2 jlist`
 *   Kuma    : อ่าน kuma.db (SQLite) ผ่าน `docker exec`
 *   MongoDB : `mongosh` ผ่าน `docker exec` (ใช้ env ของคอนเทนเนอร์)
 *   Health  : HTTP/TCP probe ทุก service
 *
 * ควบคุมได้: start / stop / restart ของ container และ process ของ PM2
 *   (จำกัดเฉพาะรายการใน allowlist)
 *
 * ไม่มี npm dependency — ใช้ Node built-in ทั้งหมด
 */
'use strict';

const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const fsp = require('fs/promises');
const cronManager = require('./cron-manager');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { URL } = require('url');
const crypto = require('crypto');
const wgManager = require('./wireguard-manager');
const geminiManager = require('./gemini-manager');

// ── config ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.DASHBOARD_PORT || '8090', 10);
const HOST = process.env.DASHBOARD_HOST || '0.0.0.0';
const LAB_DIR = process.env.LAB_DIR || path.join(os.homedir(), 'projects', 'lab-stack');
const ENV_FILE = path.join(LAB_DIR, '.env');
const PM2_BIN = process.env.PM2_BIN || path.join(os.homedir(), '.local/pm2/node_modules/.bin/pm2');
const DOCKER_SOCK = process.env.DOCKER_SOCK || '/var/run/docker.sock';
const PUBLIC_DIR = path.join(__dirname, 'public');
const TAIL_HOST = process.env.TAIL_HOST || 'homelab.tail285279.ts.net';
const ALLOWED_CONTAINERS = (process.env.ALLOWED_CONTAINERS || 'lab-').split(',').filter(Boolean);
const ALLOWED_PM2 = (process.env.ALLOWED_PM2 || 'pm2-ui,onepercentbot,lab-dashboard').split(',').filter(Boolean);

// ── helpers ───────────────────────────────────────────────────────────────────
const log = (...a) => console.log(new Date().toISOString(), ...a);

function execAsync(cmd, args = [], opts = {}) {
    return new Promise((resolve) => {
        execFile(cmd, args, { timeout: opts.timeout || 15000, maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
            resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), err });
        });
    });
}

async function sh(cmd, args, opts) {
    const r = await execAsync(cmd, args, opts);
    if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')} → ${r.stderr.trim() || r.code}`);
    return r.stdout;
}

const cache = new Map();
async function cached(key, ttlMs, producer) {
    const hit = cache.get(key);
    const now = Date.now();
    if (hit && now - hit.at < ttlMs) return hit.value;
    try {
        const value = await producer();
        cache.set(key, { at: now, value });
        return value;
    } catch (e) {
        if (hit) return hit.value;              // ใช้ค่าเก่าแทนถ้าดึงใหม่ไม่ได้
        cache.set(key, { at: now - ttlMs / 2, value: { error: String(e.message || e) } });
        return { error: String(e.message || e) };
    }
}

// ── Docker API (unix socket) ─────────────────────────────────────────────────
function dockerReq(method, apiPath, body) {
    return new Promise((resolve, reject) => {
        const payload = body === undefined ? null : JSON.stringify(body);
        const req = http.request({
            socketPath: DOCKER_SOCK,
            path: apiPath,
            method,
            headers: Object.assign(
                { 'Content-Type': 'application/json' },
                payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}
            ),
            timeout: 10000,
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString();
                let data = text;
                try { data = text ? JSON.parse(text) : null; } catch (_) { /* keep text */ }
                resolve({ status: res.statusCode, data });
            });
        });
        req.on('timeout', () => req.destroy(new Error('docker timeout')));
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

// ── host metrics ─────────────────────────────────────────────────────────────
let lastCpu = null;

function readCpuTimes() {
    const text = fs.readFileSync('/proc/stat', 'utf8');
    const cores = [];
    let total = null;
    for (const line of text.split('\n')) {
        if (!line.startsWith('cpu')) continue;
        const parts = line.trim().split(/\s+/);
        const label = parts[0];
        const nums = parts.slice(1).map(Number);
        const t = nums.reduce((a, b) => a + b, 0);
        const idle = (nums[3] || 0) + (nums[4] || 0);   // idle + iowait
        if (label === 'cpu') total = { t, idle };
        else cores.push({ t, idle });
    }
    return { total, cores };
}

function cpuUsage(prev, cur) {
    if (!prev || !cur) return null;
    const dt = cur.t - prev.t;
    const di = cur.idle - prev.idle;
    if (dt <= 0) return null;
    return Math.max(0, Math.min(100, ((dt - di) / dt) * 100));
}

async function hostMetrics() {
    const { total, cores } = readCpuTimes();
    const cpuPct = cpuUsage(lastCpu && lastCpu.total, total);
    const corePct = cores.map((c, i) => cpuUsage(lastCpu && lastCpu.cores[i], c));
    lastCpu = { total, cores, at: Date.now() };

    const meminfo = Object.fromEntries(
        fs.readFileSync('/proc/meminfo', 'utf8')
            .split('\n').filter(Boolean)
            .map((l) => { const [k, v] = l.split(':'); return [k.trim(), parseInt(v, 10) * 1024]; })
    );
    const memTotal = meminfo.MemTotal || 0;
    const memAvail = meminfo.MemAvailable || meminfo.MemFree || 0;
    const memUsed = memTotal - memAvail;

    const mountDevs = {};
    try {
        for (const line of fs.readFileSync('/proc/mounts', 'utf8').split('\n')) {
            const [dev, mnt] = line.trim().split(/\s+/);
            if (dev && mnt && dev.startsWith('/dev/')) mountDevs[mnt] = dev.replace(/^\/dev\//, '');
        }
    } catch (_) { /* ignore */ }

    const diskIo = {};
    try {
        for (const line of fs.readFileSync('/proc/diskstats', 'utf8').split('\n')) {
            const p = line.trim().split(/\s+/);
            if (p.length >= 10) {
                diskIo[p[2]] = {
                    readBytes: (Number(p[5]) || 0) * 512,
                    writeBytes: (Number(p[9]) || 0) * 512,
                };
            }
        }
    } catch (_) { /* ignore */ }

    const disks = ['/', '/var', '/home'].map((mount, idx) => {
        try {
            const st = fs.statfsSync(mount);
            const size = st.blocks * st.bsize;
            const avail = st.bavail * st.bsize;
            const used = size - st.bfree * st.bsize;
            const device = mountDevs[mount] || `disk${idx + 1}`;
            const io = diskIo[device] || { readBytes: 0, writeBytes: 0 };
            return {
                mount, device, size, used, avail,
                usedPct: size ? +(used / size * 100).toFixed(1) : 0,
                fstype: st.type === 61267 ? 'ext4' : String(st.type),
                readBytes: io.readBytes,
                writeBytes: io.writeBytes,
            };
        } catch (e) { return { mount, error: String(e.message) }; }
    });

    const temps = [];
    try {
        for (const hw of fs.readdirSync('/sys/class/hwmon')) {
            const base = `/sys/class/hwmon/${hw}`;
            const chip = (() => { try { return fs.readFileSync(`${base}/name`, 'utf8').trim(); } catch (_) { return hw; } })();
            for (const f of fs.readdirSync(base)) {
                if (!/^temp\d+_input$/.test(f)) continue;
                const labelFile = `${base}/${f.replace('_input', '_label')}`;
                let label = `${chip} ${f.match(/\d+/)[0]}`;
                try { label = fs.readFileSync(labelFile, 'utf8').trim(); } catch (_) { /* default */ }
                const raw = parseInt(fs.readFileSync(`${base}/${f}`, 'utf8'), 10);
                if (Number.isFinite(raw)) temps.push({ label, celsius: +(raw / 1000).toFixed(1) });
            }
        }
    } catch (_) { /* no hwmon */ }
    try {
        for (const zone of fs.readdirSync('/sys/class/thermal')) {
            if (!zone.startsWith('thermal_zone')) continue;
            const p = `/sys/class/thermal/${zone}/temp`;
            if (!fs.existsSync(p)) continue;
            const raw = parseInt(fs.readFileSync(p, 'utf8'), 10);
            if (Number.isFinite(raw) && raw > 1000) {
                let type = zone;
                try { type = fs.readFileSync(`/sys/class/thermal/${zone}/type`, 'utf8').trim(); } catch (_) { /* default */ }
                temps.push({ label: type, celsius: +(raw / 1000).toFixed(1) });
            }
        }
    } catch (_) { /* no thermal */ }

    const net = { rx: 0, tx: 0, iface: {} };
    try {
        const lines = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2);
        for (const line of lines) {
            const m = line.match(/^\s*([^:]+):\s*(.*)$/);
            if (!m) continue;
            const iface = m[1].trim();
            if (iface === 'lo') continue;
            const nums = m[2].trim().split(/\s+/).map(Number);
            net.iface[iface] = { rx: nums[0] || 0, tx: nums[8] || 0 };
            net.rx += nums[0] || 0;
            net.tx += nums[8] || 0;
        }
    } catch (_) { /* no net */ }

    const load = fs.readFileSync('/proc/loadavg', 'utf8').split(/\s+/).map(Number);
    const upSec = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(/\s+/)[0]);
    const failed = (await execAsync('systemctl', ['--failed', '--no-legend', '--plain'])).stdout
        .split('\n').map((l) => l.trim()).filter(Boolean);

    return {
        hostname: os.hostname(),
        kernel: os.release(),
        platform: `${os.type()} ${os.release()}`,
        uptimeSec: Math.round(upSec),
        load: [load[0], load[1], load[2]],
        cpu: { pct: cpuPct === null ? 0 : +cpuPct.toFixed(1), cores: corePct.map((c) => (c === null ? 0 : +c.toFixed(1))), count: cores.length || os.cpus().length },
        mem: { total: memTotal, used: memUsed, avail: memAvail, pct: memTotal ? +(memUsed / memTotal * 100).toFixed(1) : 0 },
        disks,
        temps,
        net,
        failedUnits: failed,
    };
}

// ── docker ───────────────────────────────────────────────────────────────────
async function dockerContainers() {
    const list = await dockerReq('GET', '/containers/json?all=1');
    const items = Array.isArray(list.data) ? list.data : [];
    const statsRaw = await sh('docker', ['stats', '--no-stream', '--format', '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}']);
    const stats = {};
    for (const line of statsRaw.split('\n')) {
        const [name, cpu, mem, memPct] = line.split('|');
        if (!name) continue;
        stats[name] = {
            cpu: parseFloat(String(cpu || '0').replace('%', '')) || 0,
            mem: String(mem || '').trim(),
            memPct: parseFloat(String(memPct || '0').replace('%', '')) || 0,
        };
    }
    return items.map((c) => {
        const name = (c.Names && c.Names[0] || '').replace(/^\//, '');
        const st = stats[name] || {};
        return {
            id: c.Id.slice(0, 12),
            name,
            image: c.Image,
            state: c.State || 'unknown',
            status: c.Status || '',
            created: c.Created ? Math.round((Date.now() - c.Created * 1000) / 1000) : null,
            ports: (c.Ports || []).filter((p) => p.PublicPort).map((p) => `${p.IP || ''}:${p.PublicPort}→${p.PrivatePort}/${p.Type}`),
            cpu: st.cpu || 0,
            mem: st.mem || '',
            memPct: st.memPct || 0,
        };
    });
}

async function dockerAction(name, action) {
    if (!ALLOWED_CONTAINERS.some((p) => name.startsWith(p))) throw new Error('Container not in allowlist');
    if (!['start', 'stop', 'restart'].includes(action)) throw new Error('Unsupported action');
    const list = await dockerReq('GET', '/containers/json?all=1');
    const found = (list.data || []).find((c) => (c.Names || []).some((n) => n.replace(/^\//, '') === name));
    if (!found) throw new Error('Container not found');
    const r = await dockerReq('POST', `/containers/${found.Id}/${action}`, {});
    if (r.status >= 400) throw new Error(`docker ${action} → ${r.status} ${JSON.stringify(r.data)}`);
    return { ok: true, name, action };
}

// ── pm2 ──────────────────────────────────────────────────────────────────────
async function pm2Processes() {
    const raw = await sh(PM2_BIN, ['jlist'], { timeout: 20000 });
    const list = JSON.parse(raw || '[]');
    return list.map((p) => ({
        name: p.name,
        pid: p.pid,
        status: p.pm2_env.status,
        uptimeSec: p.pm2_env.pm_uptime ? Math.round((Date.now() - p.pm2_env.pm_uptime) / 1000) : null,
        cpu: p.monit ? p.monit.cpu : 0,
        mem: p.monit ? p.monit.memory : 0,
        restarts: p.pm2_env.restart_time,
        script: p.pm2_env.pm_exec_path,
    }));
}

async function pm2Action(name, action) {
    if (!ALLOWED_PM2.includes(name)) throw new Error('Process not in allowlist');
    if (!['start', 'stop', 'restart', 'restart ecosystem'].includes(action)) throw new Error('Unsupported action');
    const args = action === 'restart ecosystem' ? ['restart', 'ecosystem.config.js', '--update-env'] : [action, name];
    const r = await execAsync(PM2_BIN, args, { cwd: LAB_DIR, timeout: 30000 });
    if (r.code !== 0) throw new Error(r.stderr.trim() || `pm2 ${action} failed`);
    return { ok: true, name, action };
}

// ── uptime kuma (อ่าน SQLite ผ่านคอนเทนเนอร์) ────────────────────────────────
async function kumaMonitors() {
    const script = `
      const sqlite3 = require('/app/node_modules/@louislam/sqlite3');
      const db = new sqlite3.Database('/app/data/kuma.db', sqlite3.OPEN_READONLY);
      db.all("select id,name,type,url,hostname,port,docker_container,interval from monitor", (e, mons) => {
        if (e) { console.log(JSON.stringify({error:String(e)})); db.close(); return; }
        db.all("select monitor_id,time,status,msg,ping from heartbeat order by time desc limit 400", (e2, hbs) => {
          if (e2) { console.log(JSON.stringify({error:String(e2)})); db.close(); return; }
          console.log(JSON.stringify({monitors:mons, heartbeats:hbs}));
          db.close();
        });
      });
    `;
    const out = await sh('docker', ['exec', 'lab-uptime-kuma', 'node', '-e', script], { timeout: 20000 });
    const data = JSON.parse(out.trim().split('\n').pop());
    if (data.error) throw new Error(data.error);
    const byMonitor = new Map();
    for (const hb of data.heartbeats || []) {
        if (!byMonitor.has(hb.monitor_id)) byMonitor.set(hb.monitor_id, []);
        byMonitor.get(hb.monitor_id).push(hb);
    }
    return (data.monitors || []).map((m) => {
        const list = byMonitor.get(m.id) || [];
        const up = list.filter((h) => h.status === 1).length;
        const pings = list.map((h) => h.ping).filter((p) => Number.isFinite(p) && p > 0);
        return {
            id: m.id,
            name: m.name,
            type: m.type,
            target: m.url || (m.docker_container ? `docker://${m.docker_container}` : '') || (m.hostname ? (m.port ? `${m.hostname}:${m.port}` : m.hostname) : ''),
            interval: m.interval,
            status: list.length ? (list[0].status === 1 ? 'up' : 'down') : 'unknown',
            uptime: list.length ? +((up / list.length) * 100).toFixed(1) : null,
            avgPing: pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : null,
            lastCheck: list.length ? (list[0].time ? (String(list[0].time).includes('T') ? String(list[0].time) : String(list[0].time).replace(' ', 'T') + 'Z') : null) : null,
            lastMsg: list.length ? (list[0].msg || '') : '',
        };
    });
}

// ── mongodb ──────────────────────────────────────────────────────────────────
async function mongoStats() {
    const script = `const s=db.stats();print(JSON.stringify({collections:db.getCollectionNames().length,objects:String(s.objects),dataSize:String(s.dataSize),storageSize:String(s.storageSize),indexSize:String(s.indexSize),names:db.getCollectionNames()}))`;
    const out = await sh('docker', ['exec', 'lab-mongodb', 'sh', '-c',
        `mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --quiet --eval '${script}'`],
        { timeout: 20000 });
    const line = out.trim().split('\n').pop();
    const d = JSON.parse(line);
    return {
        collections: d.collections,
        objects: Number(d.objects),
        dataSize: Number(d.dataSize),
        storageSize: Number(d.storageSize),
        indexSize: Number(d.indexSize),
        names: d.names || [],
    };
}

// ── service health probes ────────────────────────────────────────────────────
const SERVICE_TARGETS = [
    { id: 'caddy', name: 'Caddy (Reverse Proxy)', url: `https://${TAIL_HOST}/`, probe: { host: '127.0.0.1', port: 8080, path: '/', hostHeader: TAIL_HOST, ok: [200, 301, 302, 307, 308, 401] } },
    { id: 'cockpit', name: 'Cockpit & Terminal', url: `https://${TAIL_HOST}/os/`, probe: { host: '127.0.0.1', port: 9090, path: '/os/', tls: true, ok: [200, 302] } },
    { id: 'wireguard', name: 'WireGuard VPN UI', url: `https://${TAIL_HOST}:51821/`, probe: { host: '127.0.0.1', port: 51821, path: '/', ok: [200, 302] } },
    { id: 'emqx', name: 'EMQX Dashboard', url: `https://${TAIL_HOST}:18083/`, probe: { host: '127.0.0.1', port: 18083, path: '/', ok: [200, 302] } },
    { id: 'emqx-mqtt', name: 'EMQX MQTT Broker', url: `https://${TAIL_HOST}:18083/`, probe: { tcp: 1883, ok: [0] } },
    { id: 'portainer', name: 'Portainer', url: `https://${TAIL_HOST}/portainer/`, probe: { host: '127.0.0.1', port: 9000, path: '/api/system/status', ok: [200] } },
    { id: 'mongo-express', name: 'Mongo Express', url: `https://${TAIL_HOST}/mongo/`, probe: { host: '127.0.0.1', port: 8081, path: '/mongo/', ok: [200, 401, 302] } },
    { id: 'mongodb', name: 'MongoDB', url: 'mongodb://127.0.0.1:27017', probe: { tcp: 27017, ok: [0] } },
    { id: 'uptime-kuma', name: 'Uptime Kuma', url: `https://${TAIL_HOST}:3001/`, probe: { host: '127.0.0.1', port: 3001, path: '/', ok: [200, 302] } },
    { id: 'pm2-ui', name: 'PM2 Web UI', url: `https://${TAIL_HOST}:8082/`, probe: { host: '172.17.0.1', port: 8082, path: '/', ok: [200, 302] } },
    { id: 'filebrowser', name: 'File Browser (Web)', url: `https://${TAIL_HOST}/files/`, probe: { host: '127.0.0.1', port: 8088, path: '/files/', ok: [200, 301, 302] } },
    { id: 'samba', name: 'Samba SMB (Storage)', url: `\\\\192.168.1.123\\Homelab-Storage`, probe: { tcp: 445, ok: [0] } },
    { id: 'homeassistant', name: 'Home Assistant', url: `https://${TAIL_HOST}:8124/`, probe: { host: '127.0.0.1', port: 8123, path: '/', ok: [200, 301, 302, 405] } },
    { id: 'zigbee2mqtt', name: 'Zigbee2MQTT (Zigbee Hub)', url: `https://${TAIL_HOST}:8099/`, probe: { host: '127.0.0.1', port: 8099, path: '/', ok: [200, 301, 302] } },
    { id: 'onepercentbot', name: 'OnePercent Trading Bot', url: `https://${TAIL_HOST}:6015/`, probe: { host: '127.0.0.1', port: 6015, path: '/', ok: [200, 301, 302] } },
    { id: 'ddpm', name: 'DDPM LoRa (ปภ.)', url: `http://${TAIL_HOST}:3000/`, probe: { host: '127.0.0.1', port: 3000, path: '/', ok: [200, 304] } },
];

function probe(target) {
    return new Promise((resolve) => {
        const started = Date.now();
        const done = (up, detail) => resolve({ up, detail, latencyMs: Date.now() - started });
        if (!target) return done(false, 'no target');
        try {
            if (target.tcp) {
                const sock = net.connect(target.tcp, target.host || '127.0.0.1');
                sock.setTimeout(3000);
                sock.on('connect', () => { sock.destroy(); done(true, 'open'); });
                sock.on('timeout', () => { sock.destroy(); done(false, 'timeout'); });
                sock.on('error', (e) => done(false, e.code || e.message));
                return;
            }
            const mod = target.tls ? https : http;
            const req = mod.request({
                host: target.host || '127.0.0.1', port: target.port, path: target.path,
                method: 'GET', timeout: 4000,
                rejectUnauthorized: false,
                headers: target.hostHeader ? { Host: target.hostHeader } : {},
            }, (res) => {
                res.resume();
                const ok = Array.isArray(target.ok) ? target.ok.includes(res.statusCode) : res.statusCode < 500;
                done(ok, `HTTP ${res.statusCode}`);
            });
            req.on('timeout', () => { req.destroy(); done(false, 'timeout'); });
            req.on('error', (e) => done(false, e.code || e.message));
            req.end();
        } catch (e) {
            done(false, String(e.message || e));
        }
    });
}

// ── tailscale serve & funnel manager ─────────────────────────────────────────
const PROTECTED_TS_PORTS = [443, 3001, 8082, 51821, 18083];
const FUNNEL_ALLOWED_PORTS = [443, 8443, 10000];

const KNOWN_LOCAL_PORTS = {
    22: { label: 'OpenSSH Server', system: true, category: 'system' },
    80: { label: 'Caddy HTTP Redirect', system: true, category: 'core' },
    443: { label: 'Caddy HTTPS Reverse Proxy', system: true, category: 'core' },
    1883: { label: 'EMQX — MQTT over TCP', system: false, category: 'emqx' },
    8883: { label: 'EMQX — MQTT over SSL/TLS', system: false, category: 'emqx' },
    8084: { label: 'EMQX — MQTT over WSS', system: false, category: 'emqx' },
    8085: { label: 'EMQX — MQTT over WebSocket (WS)', system: false, category: 'emqx' },
    18083: { label: 'EMQX Dashboard Web UI', system: true, category: 'emqx' },
    51820: { label: 'WireGuard VPN (UDP Tunnel)', system: false, category: 'wireguard' },
    51821: { label: 'WireGuard Web UI (wg-easy)', system: true, category: 'wireguard' },
    8080: { label: 'Caddy (Reverse Proxy / Dashboard)', system: true, category: 'core' },
    8083: { label: 'Caddy Auth Proxy (PM2 Web UI)', system: true, category: 'core' },
    8090: { label: 'lab-dashboard (Direct HTTP)', system: true, category: 'core' },
    8082: { label: 'pm2-ui (Direct Unauthenticated)', system: true, category: 'core' },
    3001: { label: 'Uptime Kuma', system: true, category: 'core' },
    9000: { label: 'Portainer (HTTP)', system: true, category: 'core' },
    8081: { label: 'Mongo Express', system: true, category: 'core' },
    9090: { label: 'Cockpit & Web Terminal (HTTPS)', system: true, category: 'core' },
    27017: { label: 'MongoDB Database', system: true, category: 'core' },
    41641: { label: 'Tailscale WireGuard Engine (UDP)', system: true, category: 'system' },
};

function normalizeTargetUrl(raw) {
    const s = String(raw || '').trim();
    if (!s) throw new Error('Target is required');
    if (/^\d{1,5}$/.test(s)) {
        const p = parseInt(s, 10);
        if (p < 1 || p > 65535) throw new Error('Invalid port number');
        return `http://127.0.0.1:${p}`;
    }
    if (/^(127\.0\.0\.1|localhost|172\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+):\d{1,5}(\/.*)?$/.test(s)) {
        return `http://${s}`;
    }
    if (/^https?(\+insecure)?:\/\/(127\.0\.0\.1|localhost|172\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d{1,5})?(\/.*)?$/.test(s)) {
        return s;
    }
    throw new Error('Target must be a local port (e.g. 4000) or local URL (e.g. http://127.0.0.1:4000)');
}

async function probeProxyTarget(targetStr) {
    try {
        const clean = String(targetStr || '').replace(/^https\+insecure:\/\//, 'https://');
        const u = new URL(clean.startsWith('http') ? clean : `http://127.0.0.1:${clean}`);
        const port = parseInt(u.port || (u.protocol === 'https:' ? '443' : '80'), 10);
        return await probe({
            host: u.hostname || '127.0.0.1',
            port,
            path: u.pathname || '/',
            tls: u.protocol === 'https:',
            ok: [200, 201, 204, 301, 302, 303, 307, 308, 401, 403, 404],
        });
    } catch (e) {
        return { up: false, detail: String(e.message || e), latencyMs: 0 };
    }
}

async function discoverLocalPorts() {
    const res = await execAsync('ss', ['-tlnH']);
    const seen = new Map();
    for (const line of res.stdout.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) continue;
        const local = parts[3];
        if (local.includes('%tailscale0')) continue;
        const m = local.match(/^(.*):(\d+)$/);
        if (!m) continue;
        let addr = m[1].replace(/^\[|\]$/g, '');
        const port = parseInt(m[2], 10);
        if (!port || port === 22 || port === 27017 || port === 80 || port === 443) continue;
        const connectHost = (addr === '0.0.0.0' || addr === '*' || addr === '::') ? '127.0.0.1' : addr;
        const key = `${connectHost}:${port}`;
        if (seen.has(key)) continue;
        const known = KNOWN_LOCAL_PORTS[port];
        const proto = port === 9090 ? 'https+insecure' : 'http';
        seen.set(key, {
            address: connectHost,
            port,
            targetUrl: `${proto}://${connectHost}:${port}`,
            label: known ? known.label : `Local App (${connectHost}:${port})`,
            system: Boolean(known && known.system),
        });
    }
    return Array.from(seen.values()).sort((a, b) => Number(a.system) - Number(b.system) || a.port - b.port);
}

async function tailscaleStatus() {
    const [stRes, serveRes, localPorts] = await Promise.all([
        execAsync('tailscale', ['status', '--json'], { timeout: 8000 }),
        execAsync('tailscale', ['serve', 'status', '--json'], { timeout: 8000 }),
        discoverLocalPorts(),
    ]);

    const st = stRes.code === 0 ? JSON.parse(stRes.stdout || '{}') : {};
    const srv = serveRes.code === 0 ? JSON.parse(serveRes.stdout || '{}') : {};

    const self = st.Self || {};
    const dnsName = String(self.DNSName || TAIL_HOST).replace(/\.$/, '');
    const caps = Array.isArray(self.Capabilities) ? self.Capabilities : [];
    const capMap = self.CapMap || {};
    const canFunnel = caps.includes('funnel') || ('funnel' in capMap);

    const web = srv.Web || {};
    const allowFunnel = srv.AllowFunnel || {};
    const routeItems = [];

    for (const [hostPort, cfg] of Object.entries(web)) {
        const portMatch = hostPort.match(/:(\d+)$/);
        const extPort = portMatch ? parseInt(portMatch[1], 10) : 443;
        const isFunnel = Boolean(allowFunnel[hostPort]);
        const isProtected = PROTECTED_TS_PORTS.includes(extPort);
        const canToggleFunnel = FUNNEL_ALLOWED_PORTS.includes(extPort);
        const handlers = (cfg && cfg.Handlers) || {};

        for (const [mountPath, h] of Object.entries(handlers)) {
            const target = h.Proxy || h.Path || h.Text || '';
            const targetPortMatch = String(target).match(/:(\d+)(\/|$)/);
            const targetPort = targetPortMatch ? parseInt(targetPortMatch[1], 10) : null;
            const known = targetPort && KNOWN_LOCAL_PORTS[targetPort];
            const health = await probeProxyTarget(target);
            const extBase = extPort === 443 ? `https://${dnsName}` : `https://${dnsName}:${extPort}`;
            const externalUrl = `${extBase}${mountPath === '/' ? '/' : mountPath}`;

            routeItems.push({
                id: `${extPort}:${mountPath}`,
                hostPort,
                port: extPort,
                path: mountPath,
                mode: isFunnel ? 'funnel' : 'serve',
                funnel: isFunnel,
                protected: isProtected,
                canToggleFunnel,
                externalUrl,
                target,
                targetPort,
                serviceLabel: known ? known.label : 'Custom Project / Service',
                targetUp: health.up,
                targetDetail: health.detail,
                latencyMs: health.latencyMs,
            });
        }
    }

    routeItems.sort((a, b) => Number(b.funnel) - Number(a.funnel) || a.port - b.port);

    const funnelCount = routeItems.filter((r) => r.funnel).length;
    const serveCount = routeItems.length - funnelCount;

    return {
        version: st.Version || '',
        backendState: st.BackendState || 'Unknown',
        online: Boolean(self.Online),
        dnsName,
        tailscaleIPs: self.TailscaleIPs || [],
        relay: self.Relay || '',
        canFunnel,
        funnelAllowedPorts: FUNNEL_ALLOWED_PORTS,
        protectedPorts: PROTECTED_TS_PORTS,
        totalRoutes: routeItems.length,
        funnelCount,
        serveCount,
        routes: routeItems,
        localPorts,
    };
}

async function tailscaleAction(body = {}) {
    const action = String(body.action || '');
    const unlockSystem = Boolean(body.unlockSystem);

    if (action === 'panic-off') {
        const serveRes = await execAsync('tailscale', ['serve', 'status', '--json'], { timeout: 8000 });
        const srv = serveRes.code === 0 ? JSON.parse(serveRes.stdout || '{}') : {};
        const allowFunnel = srv.AllowFunnel || {};
        const web = srv.Web || {};
        const turnedOff = [];

        for (const [hostPort, enabled] of Object.entries(allowFunnel)) {
            if (!enabled) continue;
            const m = hostPort.match(/:(\d+)$/);
            const port = m ? parseInt(m[1], 10) : 443;
            const handlers = (web[hostPort] && web[hostPort].Handlers) || {};
            await execAsync('tailscale', ['funnel', `--https=${port}`, 'off'], { timeout: 10000 });
            for (const [mountPath, h] of Object.entries(handlers)) {
                if (h.Proxy) {
                    const args = ['serve', '--bg', `--https=${port}`, '--yes'];
                    if (mountPath && mountPath !== '/') args.push(`--set-path=${mountPath}`);
                    args.push(h.Proxy);
                    await execAsync('tailscale', args, { timeout: 10000 });
                }
            }
            turnedOff.push(port);
        }
        cache.delete('tailscale');
        return { ok: true, action, turnedOff };
    }

    const port = parseInt(body.port, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
        throw new Error('Invalid HTTPS port (must be 1–65535)');
    }
    if (PROTECTED_TS_PORTS.includes(port) && !unlockSystem) {
        throw new Error(`Port ${port} is protected by System Safety Lock. Unlock system ports first if you really want to modify it.`);
    }

    const mountPath = String(body.path || '/').trim() || '/';
    if (!mountPath.startsWith('/') || /\s/.test(mountPath)) {
        throw new Error('Mount path must start with "/" and contain no spaces');
    }

    if (action === 'remove') {
        await execAsync('tailscale', ['funnel', `--https=${port}`, 'off'], { timeout: 10000 });
        await execAsync('tailscale', ['serve', `--https=${port}`, 'off'], { timeout: 10000 });
        if (mountPath !== '/') {
            await execAsync('tailscale', ['serve', `--https=${port}`, `--set-path=${mountPath}`, 'off'], { timeout: 10000 });
        }
        cache.delete('tailscale');
        return { ok: true, action: 'remove', port, path: mountPath };
    }

    if (action === 'deploy' || action === 'set-mode') {
        const mode = body.mode === 'funnel' ? 'funnel' : 'serve';
        if (mode === 'funnel' && !FUNNEL_ALLOWED_PORTS.includes(port)) {
            throw new Error(`Tailscale Funnel only supports HTTPS ports ${FUNNEL_ALLOWED_PORTS.join(', ')}. Use 8443 or 10000 for public access, or choose Tailnet Only mode.`);
        }
        const target = normalizeTargetUrl(body.target);

        if (action === 'set-mode' && mode === 'serve') {
            await execAsync('tailscale', ['funnel', `--https=${port}`, 'off'], { timeout: 10000 });
        }

        const args = [mode, '--bg', `--https=${port}`, '--yes'];
        if (mountPath !== '/') args.push(`--set-path=${mountPath}`);
        args.push(target);

        const r = await execAsync('tailscale', args, { timeout: 15000 });
        if (r.code !== 0) {
            throw new Error(r.stderr.trim() || r.stdout.trim() || `tailscale ${mode} failed`);
        }
        cache.delete('tailscale');
        return { ok: true, action, mode, port, path: mountPath, target };
    }

    throw new Error(`Unsupported tailscale action: ${action}`);
}

// ── WireGuard & EMQX telemetry ──────────────────────────────────────────────
async function wireguardStats() {
    const [dumpRes, cfgRes] = await Promise.all([
        execAsync('docker', ['exec', 'lab-wireguard', 'wg', 'show', 'all', 'dump'], { timeout: 6000 }),
        execAsync('docker', ['exec', 'lab-wireguard', 'cat', '/etc/wireguard/wg0.json'], { timeout: 5000 }),
    ]);
    let clientMeta = {};
    if (cfgRes.code === 0 && cfgRes.stdout.trim()) {
        try {
            const parsed = JSON.parse(cfgRes.stdout);
            const clients = parsed.clients || {};
            for (const c of Object.values(clients)) {
                if (c && c.publicKey) clientMeta[c.publicKey] = c;
            }
        } catch (_) { /* ignore */ }
    }

    if (dumpRes.code !== 0) {
        return {
            up: false,
            interface: 'wg0',
            listenPort: 51820,
            subnet: '10.10.10.0/24',
            uiUrl: `https://${TAIL_HOST}:51821/`,
            lanEndpoint: '192.168.1.123:51820',
            tailscaleEndpoint: '100.93.214.79:51820',
            peers: [],
            totalPeers: Object.keys(clientMeta).length,
            activePeers: 0,
            rxBytes: 0,
            txBytes: 0,
        };
    }

    let pubKey = '';
    let listenPort = 51820;
    const peers = [];
    let totalRx = 0;
    let totalTx = 0;
    const nowSec = Math.floor(Date.now() / 1000);

    for (const line of dumpRes.stdout.trim().split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split('\t');
        if (parts.length === 5) {
            pubKey = parts[2] || '';
            listenPort = parseInt(parts[3], 10) || 51820;
        } else if (parts.length >= 9) {
            const pKey = parts[1];
            const endpoint = parts[3] === '(none)' ? '' : parts[3];
            const allowedIps = parts[4];
            const latestHandshake = parseInt(parts[5], 10) || 0;
            const rx = parseInt(parts[6], 10) || 0;
            const tx = parseInt(parts[7], 10) || 0;
            totalRx += rx;
            totalTx += tx;
            const ageSec = latestHandshake > 0 ? Math.max(0, nowSec - latestHandshake) : null;
            const meta = clientMeta[pKey] || {};
            peers.push({
                name: meta.name || `Peer ${pKey.slice(0, 6)}`,
                publicKey: pKey,
                address: meta.address || allowedIps,
                allowedIps,
                endpoint,
                latestHandshake,
                handshakeAgeSec: ageSec,
                online: ageSec !== null && ageSec <= 180,
                rxBytes: rx,
                txBytes: tx,
            });
        }
    }

    let clientsData = { clients: [], policies: {}, presets: wgManager.PRESETS };
    try {
        const env = await readEnv();
        clientsData = await wgManager.listClientsWithPolicies(env.DASH_AUTH_PASS || '');
    } catch (_) { /* ignore */ }

    return {
        up: true,
        interface: 'wg0',
        publicKey: pubKey,
        listenPort,
        subnet: '10.10.10.0/24',
        uiUrl: `https://${TAIL_HOST}:51821/`,
        lanEndpoint: `192.168.1.123:${listenPort}`,
        ddnsEndpoint: `asri-minipc.thaiddns.com:${listenPort}`,
        tailscaleEndpoint: `100.93.214.79:${listenPort}`,
        peers,
        clients: clientsData.clients || [],
        policies: clientsData.policies || {},
        presets: clientsData.presets || wgManager.PRESETS,
        totalPeers: Math.max(peers.length, Object.keys(clientMeta).length, (clientsData.clients || []).length),
        activePeers: (clientsData.clients || []).filter((p) => p.online).length,
        rxBytes: totalRx,
        txBytes: totalTx,
    };
}

async function emqxStats() {
    const [stRes, statsRes] = await Promise.all([
        execAsync('docker', ['exec', 'lab-emqx', 'emqx', 'ctl', 'status'], { timeout: 8000 }),
        execAsync('docker', ['exec', 'lab-emqx', 'emqx', 'ctl', 'broker', 'stats'], { timeout: 8000 }),
    ]);

    const statusLine = (stRes.stdout || '').trim().split('\n')[0] || '';
    const running = stRes.code === 0 && /is started/i.test(statusLine);
    const kv = {};
    for (const line of (statsRes.stdout || '').split('\n')) {
        const m = line.match(/^([a-z0-9_.]+)\s*:\s*(\d+)/i);
        if (m) kv[m[1]] = parseInt(m[2], 10);
    }

    return {
        up: running,
        statusText: statusLine || (running ? 'Running' : 'Offline'),
        uiUrl: `https://${TAIL_HOST}:18083/`,
        connections: kv['connections.count'] || 0,
        connectionsMax: kv['connections.max'] || 0,
        liveConnections: kv['live_connections.count'] || 0,
        topics: kv['topics.count'] || 0,
        subscriptions: kv['subscriptions.count'] || 0,
        retained: kv['retained.count'] || 0,
        sessions: kv['sessions.count'] || 0,
        endpoints: [
            { label: 'MQTT TCP (LAN)', url: 'mqtt://192.168.1.123:1883', port: 1883, proto: 'tcp' },
            { label: 'MQTT TCP (Tailscale)', url: 'mqtt://100.93.214.79:1883', port: 1883, proto: 'tcp' },
            { label: 'MQTT TCP (WireGuard)', url: 'mqtt://10.10.10.1:1883', port: 1883, proto: 'tcp' },
            { label: 'MQTT SSL/TLS', url: 'mqtts://192.168.1.123:8883', port: 8883, proto: 'tcp' },
            { label: 'MQTT WebSocket (WS)', url: 'ws://192.168.1.123:8085/mqtt', port: 8085, proto: 'tcp' },
            { label: 'MQTT Secure WS (WSS)', url: 'wss://192.168.1.123:8084/mqtt', port: 8084, proto: 'tcp' },
        ],
    };
}

// ── Server Port & Firewall Management (ss + ufw) ─────────────────────────────
const PROTECTED_FIREWALL_PORTS = [22, 80, 443, 8080, 8082, 8083, 8090, 9090, 41641];

const PORT_SERVICE_CATALOG = {
    '22/tcp': { name: 'OpenSSH Server', category: 'system', protected: true, desc: 'Remote SSH administration' },
    '80/tcp': { name: 'Caddy HTTP', category: 'core', protected: true, desc: 'HTTP ingress & redirect' },
    '443/tcp': { name: 'Caddy HTTPS', category: 'core', protected: true, desc: 'Primary HTTPS reverse proxy' },
    '1883/tcp': { name: 'EMQX MQTT (TCP)', category: 'emqx', protected: false, desc: 'Standard MQTT broker port for IoT/apps' },
    '8883/tcp': { name: 'EMQX MQTTS (SSL/TLS)', category: 'emqx', protected: false, desc: 'Encrypted MQTT over TLS' },
    '8085/tcp': { name: 'EMQX MQTT WebSocket (WS)', category: 'emqx', protected: false, desc: 'MQTT over WebSocket (mapped from 8083)' },
    '8084/tcp': { name: 'EMQX MQTT WSS', category: 'emqx', protected: false, desc: 'Encrypted MQTT over WebSocket' },
    '18083/tcp': { name: 'EMQX Dashboard Web UI', category: 'emqx', protected: true, desc: 'EMQX management console (Tailscale :18083)' },
    '51820/udp': { name: 'WireGuard VPN Tunnel', category: 'wireguard', protected: false, desc: 'Encrypted UDP VPN tunnel (10.10.10.0/24)' },
    '51821/tcp': { name: 'WireGuard Web UI (wg-easy)', category: 'wireguard', protected: true, desc: 'WireGuard client & QR manager (Tailscale :51821)' },
    '3001/tcp': { name: 'Uptime Kuma', category: 'core', protected: true, desc: 'Service uptime monitoring' },
    '8080/tcp': { name: 'Caddy Internal HTTP', category: 'core', protected: true, desc: 'Loopback target for Tailscale Serve' },
    '8081/tcp': { name: 'Mongo Express', category: 'core', protected: true, desc: 'MongoDB web admin UI' },
    '8082/tcp': { name: 'PM2 Web UI', category: 'core', protected: true, desc: 'Node.js process manager UI' },
    '8083/tcp': { name: 'Caddy Auth Proxy (PM2)', category: 'core', protected: true, desc: 'Session auth gateway for PM2 Web UI' },
    '8090/tcp': { name: 'Home-lab Dashboard', category: 'core', protected: true, desc: 'Central control panel backend' },
    '9000/tcp': { name: 'Portainer CE', category: 'core', protected: true, desc: 'Docker container management UI' },
    '9090/tcp': { name: 'Cockpit & Web Terminal', category: 'core', protected: true, desc: 'Linux OS & PTY terminal service' },
    '27017/tcp': { name: 'MongoDB Server', category: 'core', protected: true, desc: 'Document database engine' },
    '41641/udp': { name: 'Tailscale WireGuard Engine', category: 'system', protected: true, desc: 'Tailscale mesh tunnel port' },
};

function parseUfwNumbered(raw) {
    const active = /Status:\s*active/i.test(raw);
    const rules = [];
    for (const line of String(raw || '').split('\n')) {
        const m = line.match(/^\[\s*(\d+)\]\s+(.+?)\s+(ALLOW IN|DENY IN|REJECT IN|LIMIT IN|ALLOW OUT|DENY OUT)\s+(.+?)(?:\s+#\s*(.*))?$/);
        if (!m) continue;
        const num = parseInt(m[1], 10);
        const to = m[2].trim();
        const action = m[3].trim();
        const from = m[4].trim();
        const comment = (m[5] || '').trim();
        const v6 = to.includes('(v6)') || from.includes('(v6)');
        const cleanTo = to.replace(/\s*\(v6\)/g, '').trim();
        const portMatch = cleanTo.match(/^(\d+)(?:\/(tcp|udp))?$/i);
        const port = portMatch ? parseInt(portMatch[1], 10) : null;
        const proto = portMatch && portMatch[2] ? portMatch[2].toLowerCase() : 'any';
        const isProtected = cleanTo.includes('tailscale0') ||
            from.includes('172.16.0.0/12') ||
            (port !== null && PROTECTED_FIREWALL_PORTS.includes(port));

        rules.push({
            num,
            to: cleanTo,
            rawTo: to,
            port,
            proto,
            action,
            from: from.replace(/\s*\(v6\)/g, '').trim(),
            comment,
            v6,
            protected: isProtected,
        });
    }
    return { active, rules };
}

async function portManagerStatus() {
    const [ssRes, estRes, ufwRes] = await Promise.all([
        execAsync('sudo', ['-n', 'ss', '-tulpnH'], { timeout: 6000 }),
        execAsync('sudo', ['-n', 'ss', '-tanH', 'state', 'established'], { timeout: 5000 }),
        execAsync('sudo', ['-n', 'ufw', 'status', 'numbered'], { timeout: 6000 }),
    ]);

    const { active: ufwActive, rules: ufwRules } = parseUfwNumbered(ufwRes.stdout);

    // Count active TCP connections per local port
    const connCounts = {};
    for (const line of (estRes.stdout || '').split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) continue;
        const m = parts[2].match(/:(\d+)$/);
        if (m) {
            const p = parseInt(m[1], 10);
            connCounts[p] = (connCounts[p] || 0) + 1;
        }
    }

    // Parse listening TCP/UDP sockets
    const byPortProto = new Map();
    for (const line of (ssRes.stdout || '').split('\n')) {
        if (!line.trim()) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const proto = parts[0].toLowerCase();
        if (proto !== 'tcp' && proto !== 'udp') continue;
        const local = parts[4];
        const m = local.match(/^(.*):(\d+)$/);
        if (!m) continue;
        const rawAddr = m[1];
        const port = parseInt(m[2], 10);
        if (!port || port === 68 || port === 546) continue; // skip DHCP client ports

        const isTailscaleBind = rawAddr.includes('%tailscale0') || rawAddr.startsWith('100.') || rawAddr.startsWith('[fd7a:');
        if (isTailscaleBind && port > 32768) continue; // skip ephemeral tailscale ports

        let addr = rawAddr.replace(/%.*$/, '').replace(/^\[|\]$/g, '');
        if (addr === '*' || addr === '::') addr = '0.0.0.0';
        if (addr === '::1') addr = '127.0.0.1';

        const procMatch = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
        const procName = procMatch ? procMatch[1] : 'kernel/system';
        const pid = procMatch ? parseInt(procMatch[2], 10) : null;

        const key = `${port}/${proto}`;
        const existing = byPortProto.get(key);
        const scopeRank = (a) => (a === '0.0.0.0' ? 4 : a.startsWith('192.168.') ? 3 : a.startsWith('100.') ? 2 : a.startsWith('172.') ? 1 : 0);

        if (!existing || scopeRank(addr) > scopeRank(existing.bindAddr)) {
            const catEntry = PORT_SERVICE_CATALOG[key] || {};
            const knownLocal = KNOWN_LOCAL_PORTS[port] || {};
            let scope = 'local';
            if (addr === '0.0.0.0') scope = 'public';
            else if (addr.startsWith('192.168.')) scope = 'lan';
            else if (addr.startsWith('100.')) scope = 'tailscale';
            else if (addr.startsWith('172.')) scope = 'docker';

            // Match UFW rule for this port/proto
            const matchingRules = ufwRules.filter((r) => !r.v6 && r.port === port && (r.proto === proto || r.proto === 'any'));
            let firewallState = 'BLOCKED';
            let firewallSource = 'Default Deny';
            if (scope === 'local') {
                firewallState = 'LOOPBACK';
                firewallSource = '127.0.0.1 Only';
            } else if (scope === 'tailscale') {
                firewallState = 'TAILNET';
                firewallSource = 'tailscale0';
            } else if (matchingRules.length > 0) {
                const top = matchingRules[0];
                if (top.action.startsWith('ALLOW')) firewallState = 'ALLOW';
                else if (top.action.startsWith('LIMIT')) firewallState = 'LIMIT';
                else firewallState = 'DENY';
                firewallSource = top.from;
            }

            byPortProto.set(key, {
                key,
                port,
                proto,
                bindAddr: addr,
                scope,
                serviceName: catEntry.name || knownLocal.label || `Service (${procName})`,
                category: catEntry.category || knownLocal.category || 'custom',
                description: catEntry.desc || `Process: ${procName}`,
                process: procName,
                pid,
                connections: connCounts[port] || 0,
                firewallState,
                firewallSource,
                protected: Boolean(catEntry.protected || PROTECTED_FIREWALL_PORTS.includes(port)),
            });
        }
    }

    const listeners = Array.from(byPortProto.values()).sort((a, b) => {
        const catOrder = { wireguard: 0, emqx: 1, core: 2, system: 3, custom: 4 };
        return (catOrder[a.category] ?? 9) - (catOrder[b.category] ?? 9) || a.port - b.port;
    });

    // Quick preset cards for WireGuard & EMQX
    const presetDefs = [
        { id: 'wg-51820', port: 51820, proto: 'udp', title: 'WireGuard VPN Tunnel', subtitle: 'UDP :51820 · VPN 10.10.10.0/24', category: 'wireguard' },
        { id: 'emqx-1883', port: 1883, proto: 'tcp', title: 'EMQX — MQTT TCP', subtitle: 'TCP :1883 · Standard IoT Broker', category: 'emqx' },
        { id: 'emqx-8883', port: 8883, proto: 'tcp', title: 'EMQX — MQTTS (TLS)', subtitle: 'TCP :8883 · Encrypted MQTT', category: 'emqx' },
        { id: 'emqx-8085', port: 8085, proto: 'tcp', title: 'EMQX — WebSocket (WS)', subtitle: 'TCP :8085 · Browser / Web MQTT', category: 'emqx' },
        { id: 'emqx-8084', port: 8084, proto: 'tcp', title: 'EMQX — Secure WS (WSS)', subtitle: 'TCP :8084 · Encrypted Web MQTT', category: 'emqx' },
    ];

    const presets = presetDefs.map((p) => {
        const rule = ufwRules.find((r) => !r.v6 && r.port === p.port && (r.proto === p.proto || r.proto === 'any'));
        const isOpen = Boolean(rule && (rule.action.startsWith('ALLOW') || rule.action.startsWith('LIMIT')));
        const scopeLabel = !rule ? 'Closed (Blocked)' : rule.from === 'Anywhere' ? 'Open (All Interfaces)' : `Restricted (${rule.from})`;
        return {
            ...p,
            open: isOpen,
            action: rule ? rule.action : 'DENY IN',
            from: rule ? rule.from : 'None',
            scopeLabel,
        };
    });

    return {
        ufwActive,
        totalListeners: listeners.length,
        openFirewallPorts: listeners.filter((l) => l.firewallState === 'ALLOW' || l.firewallState === 'LIMIT').length,
        presets,
        listeners,
        rules: ufwRules.filter((r) => !r.v6), // show IPv4 rules cleanly (UFW manages v6 in tandem)
        allRulesCount: ufwRules.length,
    };
}

async function deleteUfwRulesForPort(port, proto) {
    const ufwRes = await execAsync('sudo', ['-n', 'ufw', 'status', 'numbered'], { timeout: 6000 });
    const { rules } = parseUfwNumbered(ufwRes.stdout);
    const matching = rules
        .filter((r) => r.port === port && (r.proto === proto || r.proto === 'any'))
        .sort((a, b) => b.num - a.num); // delete from highest number down so indices don't shift
    for (const r of matching) {
        await execAsync('sudo', ['-n', 'ufw', '--force', 'delete', String(r.num)], { timeout: 8000 });
    }
}

async function portManagerAction(body = {}) {
    const action = String(body.action || '');
    const unlockSystem = Boolean(body.unlockSystem);

    if (action === 'test-port') {
        const host = String(body.host || '127.0.0.1').trim();
        const port = parseInt(body.port, 10);
        const proto = String(body.proto || 'tcp').toLowerCase();
        if (!port || port < 1 || port > 65535) throw new Error('Invalid port number (1–65535)');
        if (!/^(127\.0\.0\.1|localhost|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|100\.\d+\.\d+\.\d+|172\.\d+\.\d+\.\d+)$/.test(host)) {
            throw new Error('Host must be a local, LAN, or VPN IP address');
        }
        if (proto === 'udp') {
            const ssRes = await execAsync('sudo', ['-n', 'ss', '-ulpnH', `sport = :${port}`], { timeout: 5000 });
            const up = Boolean(ssRes.stdout && ssRes.stdout.trim());
            return { ok: true, up, latencyMs: 1, detail: up ? `UDP :${port} listener active` : `No UDP listener on :${port}` };
        }
        const r = await probe({ host, port, tcp: port });
        return { ok: true, ...r };
    }

    if (action === 'set-port-mode') {
        const port = parseInt(body.port, 10);
        const proto = String(body.proto || 'tcp').toLowerCase();
        const mode = String(body.mode || 'allow-any'); // 'allow-any' | 'allow-lan' | 'allow-wg' | 'limit' | 'close'
        const comment = String(body.comment || (PORT_SERVICE_CATALOG[`${port}/${proto}`]?.name) || `Port ${port}/${proto}`).slice(0, 48);

        if (!port || port < 1 || port > 65535) throw new Error('Invalid port number');
        if (!['tcp', 'udp'].includes(proto)) throw new Error('Protocol must be tcp or udp');
        if (port === 22 || port === 41641) {
            throw new Error(`Port ${port} (SSH / Tailscale) is permanently protected to prevent remote lockout.`);
        }
        if (PROTECTED_FIREWALL_PORTS.includes(port) && !unlockSystem) {
            throw new Error(`Port ${port} is protected by System Safety Lock. Unlock system ports first if you want to modify it.`);
        }

        await deleteUfwRulesForPort(port, proto);

        if (mode === 'allow-any') {
            await sh('sudo', ['-n', 'ufw', 'allow', `${port}/${proto}`, 'comment', comment]);
        } else if (mode === 'allow-lan') {
            await sh('sudo', ['-n', 'ufw', 'allow', 'from', '192.168.1.0/24', 'to', 'any', 'port', String(port), 'proto', proto, 'comment', `${comment} (LAN)`]);
            await sh('sudo', ['-n', 'ufw', 'allow', 'from', '10.10.10.0/24', 'to', 'any', 'port', String(port), 'proto', proto, 'comment', `${comment} (WireGuard)`]);
        } else if (mode === 'limit') {
            await sh('sudo', ['-n', 'ufw', 'limit', `${port}/${proto}`, 'comment', comment]);
        } else if (mode === 'deny') {
            await sh('sudo', ['-n', 'ufw', 'deny', `${port}/${proto}`, 'comment', `${comment} (Blocked)`]);
        }
        // mode === 'close' simply leaves the port without an allow rule (blocked by default deny incoming)
        cache.delete('ports');
        return { ok: true, port, proto, mode };
    }

    if (action === 'batch-emqx') {
        const mode = String(body.mode || 'allow-any'); // 'allow-any' | 'allow-lan' | 'close'
        const emqxPorts = [
            { port: 1883, proto: 'tcp', comment: 'EMQX MQTT TCP' },
            { port: 8883, proto: 'tcp', comment: 'EMQX MQTT SSL/TLS' },
            { port: 8085, proto: 'tcp', comment: 'EMQX MQTT WebSocket' },
            { port: 8084, proto: 'tcp', comment: 'EMQX MQTT WSS' },
        ];
        for (const item of emqxPorts) {
            await portManagerAction({ action: 'set-port-mode', port: item.port, proto: item.proto, mode, comment: item.comment, unlockSystem: true });
        }
        cache.delete('ports');
        return { ok: true, action: 'batch-emqx', mode };
    }

    if (action === 'delete-rule') {
        const num = parseInt(body.num, 10);
        if (!num || num < 1) throw new Error('Invalid UFW rule number');
        const ufwRes = await execAsync('sudo', ['-n', 'ufw', 'status', 'numbered'], { timeout: 6000 });
        const { rules } = parseUfwNumbered(ufwRes.stdout);
        const targetRule = rules.find((r) => r.num === num);
        if (!targetRule) throw new Error(`Rule #${num} not found`);
        if (targetRule.port === 22 || targetRule.to.includes('tailscale0')) {
            throw new Error('Cannot delete SSH or Tailscale rule — protected against lockout.');
        }
        if (targetRule.protected && !unlockSystem) {
            throw new Error(`Rule #${num} (${targetRule.to}) is protected by System Safety Lock.`);
        }
        await sh('sudo', ['-n', 'ufw', '--force', 'delete', String(num)]);
        cache.delete('ports');
        return { ok: true, deleted: num };
    }

    throw new Error(`Unsupported port action: ${action}`);
}

// ── Web Terminal Instant Command Runner ──────────────────────────────────────
const TERMINAL_MACROS = {
    'wg-status': { label: 'WireGuard Status', cmd: 'docker exec lab-wireguard wg show' },
    'emqx-status': { label: 'EMQX Broker Status', cmd: 'docker exec lab-emqx emqx ctl status && docker exec lab-emqx emqx ctl broker stats' },
    'ufw-status': { label: 'UFW Firewall Rules', cmd: 'sudo -n ufw status numbered' },
    'ss-ports': { label: 'Listening Ports (ss)', cmd: 'sudo -n ss -tulpn' },
    'docker-ps': { label: 'Docker Containers', cmd: 'docker ps --format "table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}"' },
    'ts-status': { label: 'Tailscale Status', cmd: 'tailscale status && echo "---" && tailscale serve status' },
    'pm2-list': { label: 'PM2 Processes', cmd: '/home/dev/.local/pm2/node_modules/.bin/pm2 list' },
    'net-addr': { label: 'Network Interfaces & Routes', cmd: 'ip -br addr && echo "--- ROUTES ---" && ip route' },
    'sys-res': { label: 'Memory & Disk Usage', cmd: 'free -h && echo "--- DISK ---" && df -h / /var /home' },
    'sys-failed': { label: 'Systemd Failed Units', cmd: 'systemctl --failed --no-pager' },
};

async function terminalExec(body = {}) {
    const macroId = String(body.macro || '').trim();
    const rawCmd = macroId && TERMINAL_MACROS[macroId] ? TERMINAL_MACROS[macroId].cmd : String(body.command || '').trim();
    if (!rawCmd) throw new Error('Command is empty');
    let cwd = String(body.cwd || os.homedir()).trim() || os.homedir();
    if (!fs.existsSync(cwd)) cwd = os.homedir();
    const started = Date.now();
    // Wrap command to capture ending working directory
    const wrappedCmd = rawCmd + '\n__AGY_CWD__=$PWD\necho "__AGY_CWD_START__${__AGY_CWD__}__AGY_CWD_END__"';
    const res = await execAsync('bash', ['-c', wrappedCmd], {
        cwd,
        timeout: 25000,
        env: { ...process.env, PATH: `${process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'}:/home/dev/.local/pm2/node_modules/.bin`, TERM: 'xterm-256color' },
    });
    let stdout = res.stdout;
    let nextCwd = cwd;
    const cwdMatch = stdout.match(/__AGY_CWD_START__(.*?)__AGY_CWD_END__/);
    if (cwdMatch) {
        if (cwdMatch[1] && fs.existsSync(cwdMatch[1])) {
            nextCwd = cwdMatch[1];
        }
        stdout = stdout.replace(/__AGY_CWD_START__.*?__AGY_CWD_END__\r?\n?/, '');
    }
    return {
        ok: true,
        command: rawCmd,
        code: res.code,
        stdout: stdout.slice(0, 64000),
        stderr: res.stderr.slice(0, 32000),
        cwd: nextCwd,
        homeDir: os.homedir(),
        durationMs: Date.now() - started,
        ranAt: new Date().toISOString(),
    };
}

// ── summary assembly ─────────────────────────────────────────────────────────
const LINKS = [
    { id: 'terminal', label: 'Web Terminal (Cockpit)', icon: 'terminal', url: '/terminal' },
    { id: 'ports', label: 'Port & Firewall Manager', icon: 'shield', url: '#sec-ports' },
    { id: 'wireguard', label: 'WireGuard VPN UI', icon: 'shield', url: `https://${TAIL_HOST}:51821/` },
    { id: 'emqx', label: 'EMQX Dashboard', icon: 'activity', url: `https://${TAIL_HOST}:18083/` },
    { id: 'cockpit', label: 'Cockpit OS', icon: 'server', url: `https://${TAIL_HOST}/os/` },
    { id: 'portainer', label: 'Portainer', icon: 'box', url: `https://${TAIL_HOST}/portainer/` },
    { id: 'mongo', label: 'Mongo Express', icon: 'db', url: `https://${TAIL_HOST}/mongo/` },
    { id: 'kuma', label: 'Uptime Kuma', icon: 'activity', url: `https://${TAIL_HOST}:3001/` },
    { id: 'pm2', label: 'PM2 Web UI', icon: 'activity', url: `https://${TAIL_HOST}:8082/` },
    { id: 'filebrowser', label: 'File Browser (Web)', icon: 'folder', url: `https://${TAIL_HOST}/files/` },
    { id: 'samba', label: 'Samba Storage (SMB)', icon: 'hard-drive', url: `\\\\192.168.1.123\\Homelab-Storage` },
    { id: 'homeassistant', label: 'Home Assistant', icon: 'home', url: `https://${TAIL_HOST}:8124/` },
    { id: 'zigbee2mqtt', label: 'Zigbee2MQTT', icon: 'box', url: `https://${TAIL_HOST}:8099/` },
    { id: 'onepercentbot', label: 'OnePercent Bot (Spot)', icon: 'trending-up', url: `https://${TAIL_HOST}:6015/` },
    { id: 'ddpm', label: 'DDPM LoRa (ปภ.)', icon: 'activity', url: `http://${TAIL_HOST}:3000/` },
];

async function energyMetrics() {
    try {
        const out = await sh('python3', ['/home/dev/projects/get-energy.py', '--json'], { timeout: 3500 });
        return JSON.parse(out);
    } catch (e) {
        return { error: String(e.message || e) };
    }
}

async function buildSummary() {
    const [host, containers, pm2, kuma, mongo, probes, tailscale, wireguard, emqx, ports, energy] = await Promise.all([
        cached('host', 2000, hostMetrics),
        cached('containers', 8000, dockerContainers),
        cached('pm2', 8000, pm2Processes),
        cached('kuma', 15000, kumaMonitors),
        cached('mongo', 20000, mongoStats),
        cached('probes', 10000, async () => {
            const list = await Promise.all(SERVICE_TARGETS.map(async (t) => {
                const r = await probe(t.probe);
                return { id: t.id, name: t.name, url: t.url, up: r.up, detail: r.detail, latencyMs: r.latencyMs };
            }));
            return list;
        }),
        cached('tailscale', 4000, tailscaleStatus),
        cached('wireguard', 5000, wireguardStats),
        cached('emqx', 5000, emqxStats),
        cached('ports', 4000, portManagerStatus),
        cached('energy', 6000, energyMetrics),
    ]);

    const upCount = (probes || []).filter((s) => s.up).length;
    const running = (containers || []).filter((c) => c.state === 'running').length;
    const kumaUp = (kuma || []).filter((m) => m.status === 'up').length;

    return {
        generatedAt: new Date().toISOString(),
        links: LINKS,
        host,
        docker: {
            total: (containers || []).length,
            running,
            stopped: (containers || []).length - running,
            items: containers || [],
        },
        pm2: {
            total: (pm2 || []).length,
            online: (pm2 || []).filter((p) => p.status === 'online').length,
            items: pm2 || [],
        },
        kuma: {
            total: (kuma || []).length,
            up: kumaUp,
            down: (kuma || []).length - kumaUp,
            items: kuma || [],
        },
        mongo: mongo || {},
        services: { total: (probes || []).length, up: upCount, down: (probes || []).length - upCount, items: probes || [] },
        tailscale: tailscale || {},
        wireguard: wireguard || {},
        emqx: emqx || {},
        ports: ports || {},
        energy: energy || {},
    };
}

// ═════════════════════════════════════════════════════════════════════════════
// ระบบล็อกอิน — แทน HTTP Basic Auth (dialog ของเบราว์เซอร์ ซึ่งแต่งสไตล์ไม่ได้)
// ═════════════════════════════════════════════════════════════════════════════
//   · หน้า login ธีม Tactical ที่ /login  (public/login.html)
//   · session cookie แบบลงลายเซ็นด้วย HMAC-SHA256 — stateless ไม่ต้องมี DB
//   · Caddy เรียก /auth ผ่าน forward_auth ก่อนส่งต่อ request ไปยังปลายทาง
//   · รหัสผ่านเทียบกับ DASH_AUTH_PASS ใน .env (ไฟล์เดียวกับที่ compose ใช้)
const SESSION_COOKIE = 'lab_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;          // 12 ชั่วโมง
const SESSION_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000; // 30 วัน (ติ๊ก "remember me")
const LOGIN_MAX_FAILS = 5;                            // ล้มเหลวกี่ครั้งแล้วล็อก
const LOGIN_BLOCK_MS = 5 * 60 * 1000;                 // ล็อกนานเท่าไร
const LOGIN_BODY_LIMIT = 8 * 1024;

// ── อ่าน .env ────────────────────────────────────────────────────────────────
function parseEnvText(text) {
    const out = {};
    for (const raw of String(text).split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const i = line.indexOf('=');
        if (i < 1) continue;
        const key = line.slice(0, i).trim();
        let val = line.slice(i + 1).trim();
        if (val.length >= 2 && ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))) {
            val = val.slice(1, -1);
        }
        out[key] = val;
    }
    return out;
}

let envCache = { mtimeMs: -1, data: null };

async function readEnv() {
    try {
        const st = await fsp.stat(ENV_FILE);
        if (!envCache.data || st.mtimeMs !== envCache.mtimeMs) {
            envCache.data = parseEnvText(await fsp.readFile(ENV_FILE, 'utf8'));
            envCache.mtimeMs = st.mtimeMs;
        }
    } catch (_) { /* ไม่มีไฟล์ .env — ใช้ค่าที่แคชไว้หรือค่าว่าง */ }
    return envCache.data || {};
}

let secretPromise = null;

async function sessionSecret() {
    const env = await readEnv();
    if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 16) return env.SESSION_SECRET;
    if (secretPromise) return secretPromise;
    secretPromise = (async () => {
        const secret = crypto.randomBytes(32).toString('base64url');
        try {
            await fsp.appendFile(ENV_FILE, `\nSESSION_SECRET=${secret}\n`, { mode: 0o600 });
            envCache = { mtimeMs: -1, data: null };
            log('สร้าง SESSION_SECRET ใหม่ที่', ENV_FILE);
        } catch (e) {
            log('บันทึก SESSION_SECRET ไม่สำเร็จ (จะใช้ค่าชั่วคราว):', e.message);
        }
        return secret;
    })();
    return secretPromise;
}

// ── token ────────────────────────────────────────────────────────────────────
function signToken(payload, secret) {
    return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function makeSession(user, ttlMs, secret) {
    const exp = Date.now() + ttlMs;
    const payload = [
        Buffer.from(String(user), 'utf8').toString('base64url'),
        String(exp),
        crypto.randomBytes(9).toString('base64url'),
    ].join('.');
    return { token: `${payload}.${signToken(payload, secret)}`, exp };
}

function verifySession(token, secret) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 4) return null;
    const payload = `${parts[0]}.${parts[1]}.${parts[2]}`;
    const want = signToken(payload, secret);
    const got = Buffer.from(String(parts[3]), 'utf8');
    const exp = Buffer.from(want, 'utf8');
    if (got.length !== exp.length || !crypto.timingSafeEqual(got, exp)) return null;
    const until = Number(parts[1]);
    if (!Number.isFinite(until) || until <= Date.now()) return null;
    let user = '';
    try { user = Buffer.from(parts[0], 'base64url').toString('utf8'); } catch (_) { return null; }
    return { user, exp: until };
}

// ── cookie ───────────────────────────────────────────────────────────────────
function parseCookies(req) {
    const out = {};
    const raw = req.headers.cookie;
    if (!raw) return out;
    for (const part of String(raw).split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const k = part.slice(0, i).trim();
        if (k) {
            try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { out[k] = part.slice(i + 1).trim(); }
        }
    }
    return out;
}

function isSecureReq(req) {
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    if (proto) return proto === 'https';
    return Boolean(req.socket && req.socket.encrypted);
}

function sessionCookie(token, ttlMs, secure) {
    const bits = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(ttlMs / 1000)}`];
    if (secure) bits.push('Secure');
    return bits.join('; ');
}

function clearCookie() {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ── รหัสผ่าน ─────────────────────────────────────────────────────────────────
async function checkPassword(candidate) {
    if (typeof candidate !== 'string' || !candidate) return false;
    const env = await readEnv();
    const expected = env.DASH_AUTH_PASS || '';
    if (!expected) return false;
    // เทียบผ่าน sha256 เพื่อให้ความยาวเท่ากันเสมอ (ไม่รั่วความยาวรหัส)
    const a = crypto.createHash('sha256').update(candidate, 'utf8').digest();
    const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
    return crypto.timingSafeEqual(a, b);
}

// ── จำกัดความถี่การล้มเหลว ────────────────────────────────────────────────────
const loginFails = new Map();

function clientIp(req) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
    return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function loginBlockedMs(ip) {
    const rec = loginFails.get(ip);
    if (!rec) return 0;
    if (rec.until > Date.now()) return rec.until - Date.now();
    if (rec.until) loginFails.delete(ip);
    return 0;
}

function noteLoginFail(ip) {
    const rec = loginFails.get(ip) || { n: 0, until: 0 };
    rec.n += 1;
    if (rec.n >= LOGIN_MAX_FAILS) {
        rec.n = 0;
        rec.until = Date.now() + LOGIN_BLOCK_MS;
        log(`ล็อกการล็อกอินชั่วคราว ${LOGIN_BLOCK_MS / 60000} นาที (IP ${ip})`);
    }
    loginFails.set(ip, rec);
}

setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of loginFails) if (rec.until && rec.until <= now) loginFails.delete(ip);
}, 5 * 60 * 1000).unref();

// ── ตัวช่วย ──────────────────────────────────────────────────────────────────
function safeRedirect(target) {
    const s = String(target || '');
    if (!s || !s.startsWith('/')) return '/';
    if (s.startsWith('//')) return '/';            // กัน open redirect
    if (/[\r\n\t]/.test(s)) return '/';
    return s;
}

function readBody(req, limit = LOGIN_BODY_LIMIT) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function wantsJson(req) {
    const accept = String(req.headers.accept || '');
    return accept.includes('application/json') || req.headers['x-requested-with'] === 'fetch';
}

async function currentSession(req) {
    const secret = await sessionSecret();
    if (!secret) return null;
    return verifySession(parseCookies(req)[SESSION_COOKIE], secret);
}

// ── endpoint ของระบบล็อกอิน ───────────────────────────────────────────────────
async function serveLoginPage(req, res, url) {
    const rd = safeRedirect(url.searchParams.get('rd') || '/');
    const sess = await currentSession(req);
    if (sess) {                       // มี session อยู่แล้ว → ไปที่ปลายทางเลย
        res.writeHead(302, { Location: rd, 'Cache-Control': 'no-store' });
        res.end();
        return;
    }
    try {
        const html = await fsp.readFile(path.join(PUBLIC_DIR, 'login.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'SAMEORIGIN' });
        res.end(html);
    } catch (_) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('login page not found');
    }
}

async function handleLogin(req, res, url) {
    if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('method not allowed');
        return;
    }
    const form = new URLSearchParams(await readBody(req));
    const password = form.get('password') || '';
    const remember = form.get('remember') === '1' || form.get('remember') === 'on';
    const rd = safeRedirect(form.get('rd') || url.searchParams.get('rd') || '/');
    const asJson = wantsJson(req);
    const ip = clientIp(req);

    const blocked = loginBlockedMs(ip);
    if (blocked > 0) {
        const secs = Math.ceil(blocked / 1000);
        if (asJson) return sendJson(res, 429, { error: `Too many attempts. Try again in ${secs} seconds.` });
        res.writeHead(302, { Location: `/login?err=blocked&rd=${encodeURIComponent(rd)}`, 'Cache-Control': 'no-store' });
        res.end();
        return;
    }

    const ok = await checkPassword(password);
    if (!ok) {
        noteLoginFail(ip);
        await new Promise((r) => setTimeout(r, 350));   // หน่วงช้าอัตโนมัติ
        if (asJson) return sendJson(res, 401, { error: 'Invalid access key.' });
        res.writeHead(302, { Location: `/login?err=1&rd=${encodeURIComponent(rd)}`, 'Cache-Control': 'no-store' });
        res.end();
        return;
    }

    loginFails.delete(ip);
    const env = await readEnv();
    const user = env.DASH_AUTH_USER || 'admin';
    const secret = await sessionSecret();
    const ttl = remember ? SESSION_REMEMBER_MS : SESSION_TTL_MS;
    const { token } = makeSession(user, ttl, secret);
    const cookie = sessionCookie(token, ttl, isSecureReq(req));

    if (asJson) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookie, 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: true, user, redirect: rd, expiresAt: new Date(Date.now() + ttl).toISOString() }));
        return;
    }
    res.writeHead(302, { Location: rd, 'Set-Cookie': cookie, 'Cache-Control': 'no-store' });
    res.end();
}

function handleLogout(req, res) {
    res.writeHead(302, { Location: '/login', 'Set-Cookie': clearCookie(), 'Cache-Control': 'no-store' });
    res.end();
}

// ปลายทางของ forward_auth — ตัดสินว่าให้ผ่านไหม
async function handleAuthCheck(req, res) {
    const uri = safeRedirect(req.headers['x-forwarded-uri'] || '/');
    // Allow PWA assets and favicon publicly so Android/Chrome PWA install scanner can fetch them
    if (uri === '/manifest.json' || uri === '/sw.js' || uri.startsWith('/icons/') || uri === '/favicon.ico') {
        res.writeHead(200, {
            'X-Auth-User': 'public',
            'Cache-Control': 'no-store',
            'Content-Type': 'text/plain; charset=utf-8',
        });
        res.end('ok');
        return;
    }
    const sess = await currentSession(req);
    if (!sess) {
        const uri = safeRedirect(req.headers['x-forwarded-uri'] || '/');
        res.writeHead(302, {
            Location: `/login?rd=${encodeURIComponent(uri)}`,
            'Cache-Control': 'no-store',
            'Content-Type': 'text/plain; charset=utf-8',
        });
        res.end('redirecting to sign-in');
        return;
    }
    res.writeHead(200, {
        'X-Auth-User': sess.user,
        'X-Auth-Expires': new Date(sess.exp).toISOString(),
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
    });
    res.end('ok');
}

async function sessionInfo(req) {
    const sess = await currentSession(req);
    const env = await readEnv();
    return {
        authenticated: !!sess,
        user: sess ? sess.user : null,
        expiresAt: sess ? new Date(sess.exp).toISOString() : null,
        site: TAIL_HOST,
    };
}

// ── HTTP layer ───────────────────────────────────────────────────────────────
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json',
};

function sendJson(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
}

function readJsonBody(req, maxBytes = 64 * 1024) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', (chunk) => {
            raw += chunk;
            if (raw.length > maxBytes) {
                req.destroy();
                reject(new Error('Request body too large'));
            }
        });
        req.on('end', () => {
            if (!raw.trim()) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch (_) {
                reject(new Error('Invalid JSON payload'));
            }
        });
        req.on('error', reject);
    });
}

async function serveStatic(req, res, pathname) {
    let rel = pathname === '/' ? '/index.html' : pathname;
    const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[\\/])+/, ''));
    if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('forbidden'); return; }
    try {
        const data = await fsp.readFile(file);
        const headers = {
            'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
            'Cache-Control': rel === '/sw.js' ? 'no-cache, no-store, must-revalidate' : 'no-cache'
        };
        if (rel === '/sw.js') {
            headers['Service-Worker-Allowed'] = '/';
        }
        res.writeHead(200, headers);
        res.end(data);
    } catch (_) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
    }
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;

    try {
        // ── ระบบล็อกอิน (session cookie) — ต้องอยู่ก่อน catch-all ของ /api/* ──
        if (p === '/login') return await serveLoginPage(req, res, url);
        if (p === '/api/login') return await handleLogin(req, res, url);
        if (p === '/api/logout') return handleLogout(req, res);
        if (p === '/auth') return await handleAuthCheck(req, res);
        if (p === '/api/session') return sendJson(res, 200, await sessionInfo(req));

        if (p === '/api/summary') {
            return sendJson(res, 200, await buildSummary());
        }
        if (p === '/api/energy') {
            return sendJson(res, 200, await cached('energy', 6000, energyMetrics));
        }
        if (p === '/api/health') {
            return sendJson(res, 200, { ok: true, uptimeSec: Math.round(process.uptime()) });
        }
        if (req.method === 'POST' && p.startsWith('/api/containers/')) {
            const [, , , name, action] = p.split('/');
            return sendJson(res, 200, await dockerAction(decodeURIComponent(name), action));
        }
        if (req.method === 'POST' && p.startsWith('/api/pm2/')) {
            const [, , , name, action] = p.split('/');
            return sendJson(res, 200, await pm2Action(decodeURIComponent(name), action));
        }
        if (req.method === 'POST' && p === '/api/tailscale/action') {
            const body = await readJsonBody(req);
            return sendJson(res, 200, await tailscaleAction(body));
        }
        if (req.method === 'POST' && p === '/api/tailscale/test-target') {
            const body = await readJsonBody(req);
            const normalizedTarget = normalizeTargetUrl(body.target);
            const r = await probeProxyTarget(normalizedTarget);
            return sendJson(res, 200, { ok: true, normalizedTarget, ...r });
        }
        if (p === '/api/ports') {
            return sendJson(res, 200, await portManagerStatus());
        }
        if (req.method === 'POST' && p === '/api/ports/action') {
            const body = await readJsonBody(req);
            return sendJson(res, 200, await portManagerAction(body));
        }
        if (req.method === 'POST' && p === '/api/terminal/exec') {
            const body = await readJsonBody(req);
            return sendJson(res, 200, await terminalExec(body));
        }
        if (p === '/terminal' || p === '/terminal/') {
            return await serveStatic(req, res, '/terminal.html');
        }
        if (p === '/quota' || p === '/quota/') {
            return await serveStatic(req, res, '/quota.html');
        }
        if (p === '/cron' || p === '/cron/') {
            return await serveStatic(req, res, '/cron.html');
        }
        if (p === '/api/cron') {
            if (req.method === 'GET') {
                return sendJson(res, 200, { ok: true, jobs: await cronManager.listJobs() });
            }
            if (req.method === 'POST') {
                const body = await readJsonBody(req);
                try {
                    return sendJson(res, 200, await cronManager.addOrUpdateJob(body));
                } catch (err) {
                    return sendJson(res, 400, { ok: false, error: err.message });
                }
            }
        }
        if (req.method === 'POST' && p === '/api/cron/toggle') {
            const body = await readJsonBody(req);
            try {
                return sendJson(res, 200, await cronManager.toggleJob(body.id));
            } catch (err) {
                return sendJson(res, 400, { ok: false, error: err.message });
            }
        }
        if (req.method === 'POST' && p === '/api/cron/delete') {
            const body = await readJsonBody(req);
            try {
                return sendJson(res, 200, await cronManager.deleteJob(body.id));
            } catch (err) {
                return sendJson(res, 400, { ok: false, error: err.message });
            }
        }
        if (req.method === 'POST' && p === '/api/cron/run') {
            const body = await readJsonBody(req);
            try {
                return sendJson(res, 200, await cronManager.runJobNow(body.id));
            } catch (err) {
                return sendJson(res, 400, { ok: false, error: err.message });
            }
        }
        if (req.method === 'GET' && p === '/api/stt/health') {
            return new Promise((resolve) => {
                const proxyReq = http.get('http://127.0.0.1:8096/health', { timeout: 2500 }, (pRes) => {
                    let data = '';
                    pRes.on('data', (c) => { data += c; });
                    pRes.on('end', () => {
                        try {
                            sendJson(res, pRes.statusCode || 200, JSON.parse(data));
                        } catch {
                            sendJson(res, 502, { ok: false, error: 'Invalid STT response' });
                        }
                        resolve();
                    });
                });
                proxyReq.on('error', (err) => {
                    sendJson(res, 503, { ok: false, error: err.message });
                    resolve();
                });
            });
        }
        if (req.method === 'POST' && p === '/api/stt/transcribe') {
            const chunks = [];
            let totalBytes = 0;
            const MAX_STT_BYTES = 25 * 1024 * 1024;
            for await (const chunk of req) {
                totalBytes += chunk.length;
                if (totalBytes > MAX_STT_BYTES) {
                    return sendJson(res, 413, { ok: false, error: 'Audio payload too large' });
                }
                chunks.push(chunk);
            }
            const audioBuf = Buffer.concat(chunks);
            const lang = encodeURIComponent((url.searchParams.get('lang') || 'th').trim());
            return new Promise((resolve) => {
                const proxyReq = http.request(
                    `http://127.0.0.1:8096/transcribe?lang=${lang}`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': req.headers['content-type'] || 'audio/webm',
                            'Content-Length': String(audioBuf.length)
                        },
                        timeout: 60000
                    },
                    (pRes) => {
                        const resChunks = [];
                        pRes.on('data', (c) => resChunks.push(c));
                        pRes.on('end', () => {
                            const raw = Buffer.concat(resChunks).toString('utf8');
                            try {
                                sendJson(res, pRes.statusCode || 200, JSON.parse(raw));
                            } catch {
                                sendJson(res, 502, { ok: false, error: raw || 'Invalid STT response' });
                            }
                            resolve();
                        });
                    }
                );
                proxyReq.on('error', (err) => {
                    sendJson(res, 503, { ok: false, error: `STT service unavailable: ${err.message}` });
                    resolve();
                });
                proxyReq.on('timeout', () => {
                    proxyReq.destroy(new Error('STT request timeout'));
                });
                proxyReq.end(audioBuf);
            });
        }
        if (p === '/api/gemini/quota') {
            return sendJson(res, 200, await geminiManager.getQuotaSummary());
        }
        // ── Gemini AI Assistant Endpoints ────────────────────────────
        if (p === '/api/gemini/status') {
            return sendJson(res, 200, await geminiManager.getStatus());
        }
        if (req.method === 'POST' && p === '/api/gemini/config') {
            const body = await readJsonBody(req);
            return sendJson(res, 200, await geminiManager.setApiKey(body.apiKey));
        }
        if (p === '/api/gemini/history') {
            return sendJson(res, 200, await geminiManager.loadHistory());
        }
        if (req.method === 'POST' && p === '/api/gemini/history') {
            const body = await readJsonBody(req);
            await geminiManager.saveHistory(body.messages || []);
            return sendJson(res, 200, { ok: true });
        }
        if (req.method === 'POST' && p === '/api/gemini/clear-history') {
            return sendJson(res, 200, await geminiManager.clearHistory());
        }
        if (p === '/api/gemini/memory') {
            return sendJson(res, 200, await geminiManager.getMemory());
        }
        if (req.method === 'POST' && p === '/api/gemini/memory') {
            const body = await readJsonBody(req);
            return sendJson(res, 200, await geminiManager.saveMemory(body.memory));
        }
        if (req.method === 'POST' && p === '/api/gemini/memory/add') {
            const body = await readJsonBody(req);
            return sendJson(res, 200, await geminiManager.appendMemory(body.fact || ''));
        }
        // ── Autonomous Task Queue Endpoints ─────────────────────────
        if (p === '/api/gemini/queue') {
            if (req.method === 'GET') {
                return sendJson(res, 200, { queue: geminiManager.getQueue() });
            }
            if (req.method === 'POST') {
                const body = await readJsonBody(req);
                try {
                    const result = await geminiManager.enqueueTask(body);
                    return sendJson(res, 200, result);
                } catch (err) {
                    return sendJson(res, 400, { error: err.message });
                }
            }
        }
        if (req.method === 'POST' && p === '/api/gemini/queue/update') {
            const body = await readJsonBody(req);
            try {
                const result = await geminiManager.updateQueueTask(body.id, body);
                return sendJson(res, 200, result);
            } catch (err) {
                return sendJson(res, 400, { error: err.message });
            }
        }
        if (req.method === 'POST' && p === '/api/gemini/queue/remove') {
            const body = await readJsonBody(req);
            try {
                const result = await geminiManager.removeQueueTask(body.id);
                return sendJson(res, 200, result);
            } catch (err) {
                return sendJson(res, 400, { error: err.message });
            }
        }
        if (req.method === 'POST' && p === '/api/gemini/queue/reorder') {
            const body = await readJsonBody(req);
            const result = await geminiManager.reorderQueue(body.id, body.direction);
            return sendJson(res, 200, result);
        }
        if (req.method === 'POST' && p === '/api/gemini/queue/clear') {
            const result = await geminiManager.clearQueue();
            return sendJson(res, 200, result);
        }

        if (req.method === 'POST' && p === '/api/gemini/upload-image') {
            const body = await readJsonBody(req, 12 * 1024 * 1024);
            try {
                const result = await geminiManager.saveUploadedImage(body.dataUrl, body.filename);
                return sendJson(res, 200, result);
            } catch (err) {
                return sendJson(res, 400, { error: err.message });
            }
        }
        if (req.method === 'GET' && p.startsWith('/api/gemini/uploads/')) {
            const fname = path.basename(p.slice('/api/gemini/uploads/'.length));
            const filePath = path.join(geminiManager.UPLOADS_DIR, fname);
            try {
                const data = await fsp.readFile(filePath);
                const ext = path.extname(fname).toLowerCase();
                const mime = ext === '.png' ? 'image/png'
                    : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg'
                    : ext === '.webp' ? 'image/webp'
                    : ext === '.gif' ? 'image/gif' : 'application/octet-stream';
                res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' });
                res.end(data);
                return;
            } catch (_) {
                return sendJson(res, 404, { error: 'Image not found' });
            }
        }

        if (req.method === 'GET' && p === '/api/gemini/local-image') {
            const rawPath = (url.searchParams.get('path') || '').replace(/^file:\/\//i, '');
            if (!rawPath) return sendJson(res, 400, { error: 'Missing path' });
            const resolved = path.resolve(rawPath);
            const allowedRoots = ['/home/dev/projects', '/home/dev/.gemini', '/tmp'];
            const isAllowed = allowedRoots.some((root) => resolved === root || resolved.startsWith(root + '/'));
            const ext = path.extname(resolved).toLowerCase();
            const allowedExts = {
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.webp': 'image/webp',
                '.gif': 'image/gif',
                '.svg': 'image/svg+xml'
            };
            if (!isAllowed || !allowedExts[ext]) {
                return sendJson(res, 403, { error: 'Forbidden image path' });
            }
            try {
                const st = await fsp.stat(resolved);
                if (!st.isFile() || st.size > 25 * 1024 * 1024) {
                    return sendJson(res, 404, { error: 'Image not available' });
                }
                const data = await fsp.readFile(resolved);
                res.writeHead(200, { 'Content-Type': allowedExts[ext], 'Cache-Control': 'public, max-age=3600' });
                res.end(data);
                return;
            } catch (_) {
                return sendJson(res, 404, { error: 'Image not found' });
            }
        }

        if (req.method === 'POST' && p === '/api/gemini/abort') {
            return sendJson(res, 200, geminiManager.abortActive());
        }
        if (p === '/api/gemini/job') {
            return sendJson(res, 200, geminiManager.getActiveJob());
        }
        if (req.method === 'POST' && p === '/api/gemini/chat') {
            const body = await readJsonBody(req);
            const images = Array.isArray(body.images) ? body.images : [];
            const prompt = (body.prompt || '').trim() || (images.length > 0 ? 'ช่วยดูและวิเคราะห์รูปภาพที่แนบมานี้หน่อย' : '');
            if (!prompt) {
                return sendJson(res, 400, { error: 'Prompt cannot be empty' });
            }

            res.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            });

            // Prevent proxy/Caddy/browser idle timeouts with periodic keepalive comments
            const keepaliveTimer = setInterval(() => {
                if (res.writableEnded || res.destroyed) {
                    clearInterval(keepaliveTimer);
                    return;
                }
                try {
                    res.write(': keepalive\n\n');
                } catch (_) {
                    clearInterval(keepaliveTimer);
                }
            }, 8000);

            const sendEvent = (type, data) => {
                if (res.writableEnded) return;
                res.write(`data: ${JSON.stringify(data)}\n\n`);
            };

            const cleanup = () => {
                clearInterval(keepaliveTimer);
            };
            res.on('close', cleanup);
            res.on('finish', cleanup);

            try {
                geminiManager.executePrompt(
                    {
                        jobId: body.jobId,
                        prompt,
                        images,
                        mode: body.mode || 'chat',
                        cwd: body.cwd,
                        model: body.model,
                        resetSession: Boolean(body.resetSession)
                    },
                    (type, text) => {
                        sendEvent('chunk', { type, text });
                    },
                    (exitCode, error) => {
                        cleanup();
                        sendEvent('done', { exitCode, error });
                        res.end();
                    }
                );
            } catch (err) {
                cleanup();
                sendEvent('error', { error: err.message });
                res.end();
            }
            return;
        }
        if (p === '/gemini' || p === '/gemini/') {
            return await serveStatic(req, res, '/gemini.html');
        }
        // ── WireGuard Client & Policy Management Endpoints ───────────
        if (p === '/api/wireguard/clients') {
            const env = await readEnv();
            const data = await wgManager.listClientsWithPolicies(env.DASH_AUTH_PASS || '');
            return sendJson(res, 200, data);
        }
        if (req.method === 'POST' && p === '/api/wireguard/client') {
            const body = await readJsonBody(req);
            const env = await readEnv();
            const authPass = env.DASH_AUTH_PASS || '';
            const r = await wgManager.callWgEasyApi('/api/wireguard/client', 'POST', { name: body.name }, authPass);
            if (r.status === 200) {
                try {
                    const cd = await wgManager.listClientsWithPolicies(authPass);
                    const target = (cd.clients || []).find((c) => c.name === body.name);
                    if (target) {
                        const policies = await wgManager.loadPolicies();
                        policies.clients = policies.clients || {};
                        const presetKey = body.preset || 'admin';
                        policies.clients[target.publicKey] = {
                            ...(wgManager.PRESETS[presetKey] || wgManager.PRESETS.admin),
                            name: target.name,
                            ip: target.address,
                            updatedAt: new Date().toISOString(),
                        };
                        await wgManager.savePolicies(policies);
                        await wgManager.syncIptablesPolicies(policies, cd.clients);
                    }
                } catch (_) { /* ignore */ }
            }
            cache.clear();
            let parsed = {};
            try { parsed = JSON.parse(r.data || '{}'); } catch (_) { parsed = { raw: r.data }; }
            return sendJson(res, r.status, parsed);
        }
        if (req.method === 'DELETE' && p.startsWith('/api/wireguard/client/')) {
            const clientId = p.split('/')[4];
            const env = await readEnv();
            const authPass = env.DASH_AUTH_PASS || '';
            const r = await wgManager.callWgEasyApi(`/api/wireguard/client/${clientId}`, 'DELETE', null, authPass);
            const cd = await wgManager.listClientsWithPolicies(authPass);
            const policies = await wgManager.loadPolicies();
            await wgManager.syncIptablesPolicies(policies, cd.clients);
            cache.clear();
            let parsed = {};
            try { parsed = JSON.parse(r.data || '{}'); } catch (_) { parsed = { raw: r.data }; }
            return sendJson(res, r.status, parsed);
        }
        if (req.method === 'POST' && p.includes('/toggle')) {
            const parts = p.split('/');
            const clientId = parts[4];
            const body = await readJsonBody(req);
            const env = await readEnv();
            const authPass = env.DASH_AUTH_PASS || '';
            const act = body.enabled ? 'enable' : 'disable';
            const r = await wgManager.callWgEasyApi(`/api/wireguard/client/${clientId}/${act}`, 'POST', null, authPass);
            const cd = await wgManager.listClientsWithPolicies(authPass);
            const policies = await wgManager.loadPolicies();
            await wgManager.syncIptablesPolicies(policies, cd.clients);
            cache.clear();
            let parsed = {};
            try { parsed = JSON.parse(r.data || '{}'); } catch (_) { parsed = { raw: r.data }; }
            return sendJson(res, r.status, parsed);
        }
        if (req.method === 'POST' && p === '/api/wireguard/policy') {
            const body = await readJsonBody(req);
            const env = await readEnv();
            const authPass = env.DASH_AUTH_PASS || '';
            const policies = await wgManager.loadPolicies();
            policies.clients = policies.clients || {};
            policies.clients[body.publicKey] = {
                preset: body.preset || 'custom',
                allowInternet: Boolean(body.allowInternet),
                allowLan: Boolean(body.allowLan),
                allowP2P: Boolean(body.allowP2P),
                homelabOnly: Boolean(body.homelabOnly),
                name: body.name || '',
                ip: body.address || '',
                updatedAt: new Date().toISOString(),
            };
            await wgManager.savePolicies(policies);
            const cd = await wgManager.listClientsWithPolicies(authPass);
            await wgManager.syncIptablesPolicies(policies, cd.clients);
            cache.clear();
            return sendJson(res, 200, { ok: true, policies });
        }
        if (p.startsWith('/api/wireguard/client/') && p.endsWith('/qrcode.svg')) {
            const clientId = p.split('/')[4];
            const env = await readEnv();
            const r = await wgManager.callWgEasyApi(`/api/wireguard/client/${clientId}/qrcode.svg`, 'GET', null, env.DASH_AUTH_PASS || '');
            res.writeHead(r.status, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
            res.end(r.data);
            return;
        }
        if (p.startsWith('/api/wireguard/client/') && p.endsWith('/configuration')) {
            const clientId = p.split('/')[4];
            const env = await readEnv();
            const r = await wgManager.callWgEasyApi(`/api/wireguard/client/${clientId}/configuration`, 'GET', null, env.DASH_AUTH_PASS || '');
            res.writeHead(r.status, {
                'Content-Type': 'text/plain',
                'Content-Disposition': `attachment; filename="wg-${clientId.slice(0, 8)}.conf"`,
                'Cache-Control': 'no-store',
            });
            res.end(r.data);
            return;
        }

        if (req.method === 'POST' && p === '/api/refresh') {
            cache.clear();
            return sendJson(res, 200, { ok: true });
        }
        if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' });
        return await serveStatic(req, res, p);
    } catch (e) {
        return sendJson(res, 500, { error: String(e.message || e) });
    }
});

server.listen(PORT, HOST, () => {
    log(`lab-dashboard listening on ${HOST}:${PORT}`);
    // Sync initial WireGuard client policies with iptables
    (async () => {
        try {
            const env = await readEnv();
            const cd = await wgManager.listClientsWithPolicies(env.DASH_AUTH_PASS || '');
            if (cd && cd.clients && cd.clients.length) {
                await wgManager.syncIptablesPolicies(cd.policies, cd.clients);
                log('Initial WireGuard client policies successfully synced with iptables');
            }
        } catch (e) {
            log('Notice: Initial WireGuard policy sync skipped:', e.message);
        }
    })();
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
// ไม่ให้ error ประเภทไหนทำให้แดชบอร์ดล่ม (pm2 จะ restart อยู่ดี แต่ผู้ใช้จะเห็นหน้าจอว่าง)
process.on('uncaughtException', (e) => log('uncaughtException:', e && e.stack ? e.stack : e));
process.on('unhandledRejection', (e) => log('unhandledRejection:', e && e.stack ? e.stack : e));
