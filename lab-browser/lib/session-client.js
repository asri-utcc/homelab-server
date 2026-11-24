'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const config = require('./config');

const DAEMON_ENTRY = path.join(config.BASE_DIR, 'lib', 'session-daemon.js');

function getSessionPaths(sessionName) {
  const name = config.sanitizeSessionName(sessionName);
  return {
    name,
    sockPath: path.join(config.STATE_DIR, `${name}.sock`),
    streamSockPath: path.join(config.STATE_DIR, `${name}.stream.sock`),
    metaPath: path.join(config.STATE_DIR, `${name}.json`),
  };
}

function getStreamSocketPath(sessionName) {
  return getSessionPaths(sessionName).streamSockPath;
}

function sendRawSocket(sockPath, payload, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: sockPath });
    let buffer = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(`Browser session timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.on('connect', () => {
      socket.write(JSON.stringify(payload) + '\n');
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const idx = buffer.indexOf('\n');
      if (idx !== -1) {
        const line = buffer.slice(0, idx).trim();
        settled = true;
        clearTimeout(timer);
        socket.end();
        try {
          resolve(JSON.parse(line));
        } catch (err) {
          reject(new Error(`Invalid response from browser daemon: ${err.message}`));
        }
      }
    });

    socket.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function isDaemonAlive(sockPath) {
  if (!fs.existsSync(sockPath)) return false;
  try {
    const res = await sendRawSocket(sockPath, { cmd: 'ping' }, 2000);
    return Boolean(res && res.ok && res.pong);
  } catch (_) {
    return false;
  }
}

function resolveCapLimits(opts = {}) {
  const parseLimit = (optVal, envVal, fallback, min) => {
    if (optVal !== undefined && optVal !== null && Number.isFinite(Number(optVal)) && Number(optVal) >= min) {
      return Math.floor(Number(optVal));
    }
    if (envVal !== undefined && envVal !== null && String(envVal).trim() !== '') {
      const n = Number(envVal);
      if (Number.isFinite(n) && n >= min) return Math.floor(n);
    }
    return fallback;
  };
  return {
    maxBrowsers: parseLimit(
      opts.maxChatBrowsers,
      process.env.LAB_BROWSER_MAX_CHAT_BROWSERS,
      config.MAX_CHAT_BROWSERS,
      1
    ),
    minFreeMb: parseLimit(
      opts.minFreeMb,
      process.env.LAB_BROWSER_MIN_FREE_MB,
      config.MIN_FREE_MB_FOR_CHAT_BROWSER,
      0
    ),
  };
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

async function waitForDaemonExit(sockPath, pid, maxWaitMs = 3000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const pidGone = !pid || !isPidAlive(pid);
    const sockGone = !sockPath || !fs.existsSync(sockPath);
    if (pidGone && sockGone) return true;
    if (pidGone && !(await isDaemonAlive(sockPath))) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !(await isDaemonAlive(sockPath));
}

async function enforceChatBrowserCap(opts = {}) {
  const { maxBrowsers, minFreeMb } = resolveCapLimits(opts);
  const excludeSession = opts.excludeSession ? String(opts.excludeSession) : null;

  const allSessions = await listSessions();
  const chatSessions = allSessions.filter(
    (s) => typeof s.session === 'string' && s.session.startsWith('bv_') && s.session !== excludeSession
  );

  let activeCount = chatSessions.length;
  let freeMb = config.getFreeMemMb();
  const needsEviction = () => activeCount >= maxBrowsers || (freeMb !== null && freeMb < minFreeMb);

  if (!needsEviction()) {
    return { ok: true, evicted: [], activeCount, maxBrowsers, freeMb, minFreeMb };
  }

  // Only evict sessions with 0 viewers and not busy running an AI command
  const candidates = chatSessions.filter((s) => {
    const viewers = Number(s.viewers ?? s.subscribers ?? 0) || 0;
    const aiBusy = Boolean(s.aiBusy) || s.statusAvailable === false;
    return viewers === 0 && !aiBusy;
  });

  const activityTs = (s) => {
    const t = Date.parse(s.lastActivityAt || s.startedAt || '');
    return Number.isFinite(t) ? t : 0;
  };
  candidates.sort((a, b) => activityTs(a) - activityTs(b));

  const evicted = [];
  for (const cand of candidates) {
    if (!needsEviction()) break;
    try {
      await sendRawSocket(cand.socketPath, { cmd: 'close' }, 5000);
    } catch (_) {
      if (cand.pid) {
        try { process.kill(cand.pid, 'SIGTERM'); } catch (_) {}
      }
    }
    await waitForDaemonExit(cand.socketPath, cand.pid, 3000);
    evicted.push(cand.session);
    activeCount = Math.max(0, activeCount - 1);
    freeMb = config.getFreeMemMb();
  }

  if (needsEviction()) {
    const reasons = [];
    if (activeCount >= maxBrowsers) {
      reasons.push(`active chat browser limit reached (${activeCount}/${maxBrowsers})`);
    }
    if (freeMb !== null && freeMb < minFreeMb) {
      reasons.push(`available RAM too low (${freeMb} MB free, minimum ${minFreeMb} MB required)`);
    }
    throw new Error(
      `Cannot launch new chat browser session: ${reasons.join(' and ')}; no idle unviewed chat browser sessions are available to evict. Close an unused Browser Vision room or wait for active AI tasks to complete.`
    );
  }

  return { ok: true, evicted, activeCount, maxBrowsers, freeMb, minFreeMb };
}

async function ensureSessionDaemon(sessionName, opts = {}) {
  const authProfile = opts.authProfile ? config.sanitizeAuthProfile(opts.authProfile) : null;
  if (opts.persist && authProfile) {
    throw new Error('--persist cannot be combined with --shared-auth');
  }

  config.ensureDirs({ includeAuth: Boolean(authProfile) });
  const { name, sockPath, streamSockPath, metaPath } = getSessionPaths(sessionName);

  if (await isDaemonAlive(sockPath)) {
    return { sockPath, streamSockPath, started: false };
  }

  // Clean stale files if previous daemon crashed
  try { if (fs.existsSync(sockPath)) fs.unlinkSync(sockPath); } catch (_) {}
  try { if (fs.existsSync(streamSockPath)) fs.unlinkSync(streamSockPath); } catch (_) {}
  try { if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath); } catch (_) {}

  // Enforce per-chat browser LRU cap and RAM floor before spawning a new bv_* daemon
  if (name.startsWith('bv_')) {
    await enforceChatBrowserCap({
      excludeSession: name,
      maxChatBrowsers: opts.maxChatBrowsers,
      minFreeMb: opts.minFreeMb,
    });
  }

  const logPath = path.join(config.STATE_DIR, `${name}.daemon.log`);
  const logFd = fs.openSync(logPath, 'a', 0o600);

  const daemonEnv = {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: config.BROWSERS_PATH,
    LAB_BROWSER_DAEMON_OPTS: JSON.stringify({
      session: name,
      idleTtlSec: opts.idleTtlSec || config.DEFAULT_IDLE_TTL_SEC,
      persist: Boolean(opts.persist),
      authProfile,
      mobile: Boolean(opts.mobile),
      tablet: Boolean(opts.tablet),
      laptop: Boolean(opts.laptop),
      desktop: Boolean(opts.desktop),
      viewport: opts.viewport,
      dpr: opts.dpr,
      dark: Boolean(opts.dark),
      light: Boolean(opts.light),
      ignoreHttpsErrors: Boolean(opts.ignoreHttpsErrors),
      userAgent: opts.userAgent,
      headers: opts.headers,
      headful: Boolean(opts.headful),
    }),
  };

  const child = spawn(process.execPath, [DAEMON_ENTRY], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: daemonEnv,
  });
  child.unref();
  fs.closeSync(logFd);

  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await isDaemonAlive(sockPath)) {
      return { sockPath, streamSockPath, started: true };
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  let tail = '';
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    tail = content.slice(-400).trim();
  } catch (_) {}
  throw new Error(`Failed to start browser session "${name}"${tail ? `: ${tail}` : ''}`);
}

function forceKillProcessTree(rootPid) {
  if (!Number.isInteger(rootPid) || rootPid <= 1) return false;
  let killedAny = false;
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('ps', ['-eo', 'pid,ppid'], { encoding: 'utf8', timeout: 2000 });
    const children = new Map();
    for (const line of out.trim().split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const p = Number(parts[0]), pp = Number(parts[1]);
      if (!children.has(pp)) children.set(pp, []);
      children.get(pp).push(p);
    }
    const order = [];
    const stack = [rootPid];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      order.push(cur);
      for (const c of (children.get(cur) || [])) stack.push(c);
    }
    for (const pid of order.reverse()) {
      try { process.kill(pid, 'SIGKILL'); killedAny = true; } catch (_) {}
    }
  } catch (_) {
    try { process.kill(rootPid, 'SIGKILL'); killedAny = true; } catch (__) {}
  }
  return killedAny;
}

async function forceCloseSessionDaemon(sessionName) {
  const { name, sockPath, streamSockPath, metaPath } = getSessionPaths(sessionName);
  let metaPid = 0;
  try {
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      metaPid = Number(meta && meta.pid) || 0;
    }
  } catch (_) {}

  let politeRes = null;
  if (fs.existsSync(sockPath)) {
    try {
      politeRes = await sendRawSocket(sockPath, { cmd: 'close' }, 3500);
    } catch (_) {}
  }

  const exitedCleanly = await waitForDaemonExit(sockPath, metaPid, 1500);
  let forceKilled = false;
  if (!exitedCleanly && metaPid && isPidAlive(metaPid)) {
    forceKilled = forceKillProcessTree(metaPid);
  }

  try { if (fs.existsSync(sockPath)) fs.unlinkSync(sockPath); } catch (_) {}
  try { if (fs.existsSync(streamSockPath)) fs.unlinkSync(streamSockPath); } catch (_) {}
  try { if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath); } catch (_) {}

  if (!politeRes && !metaPid && !forceKilled) {
    throw new Error(`Browser session "${name}" is not running (start it with: lab-browser session open <url>)`);
  }
  return { ok: true, closed: true, forceKilled, ...(politeRes || {}) };
}

async function sendSessionCommand(sessionName, cmd, args = [], opts = {}, autoStart = true) {
  if (cmd === 'close') {
    return forceCloseSessionDaemon(sessionName);
  }
  const { name, sockPath } = getSessionPaths(sessionName);
  const alive = await isDaemonAlive(sockPath);
  if (!alive) {
    if (!autoStart) {
      throw new Error(`Browser session "${name}" is not running (start it with: lab-browser session open <url>)`);
    }
    await ensureSessionDaemon(name, opts);
  }
  const timeoutMs = Math.max(45000, (Number(opts.timeoutMs) || config.DEFAULT_TIMEOUT_MS) + 15000);
  return sendRawSocket(sockPath, { cmd, args, opts }, timeoutMs);
}

async function listSessions() {
  config.ensureDirs({ includeAuth: false });
  const files = fs.readdirSync(config.STATE_DIR).filter((f) => f.endsWith('.json'));
  const sessions = [];
  for (const file of files) {
    const metaPath = path.join(config.STATE_DIR, file);
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const alive = await isDaemonAlive(meta.socketPath);
      if (alive) {
        const st = await sendRawSocket(meta.socketPath, { cmd: 'status' }, 3000).catch(() => null);
        sessions.push({ ...meta, alive: true, statusAvailable: Boolean(st), ...(st || {}) });
      } else {
        try { fs.unlinkSync(metaPath); } catch (_) {}
        try { if (meta.socketPath && fs.existsSync(meta.socketPath)) fs.unlinkSync(meta.socketPath); } catch (_) {}
        const staleStream = meta.streamSocketPath || (meta.session ? path.join(config.STATE_DIR, `${meta.session}.stream.sock`) : null);
        try { if (staleStream && fs.existsSync(staleStream)) fs.unlinkSync(staleStream); } catch (_) {}
      }
    } catch (_) {
      // skip corrupt metadata
    }
  }
  return sessions;
}

async function killAllSessions() {
  const active = await listSessions();
  const closed = [];
  for (const s of active) {
    try {
      await sendRawSocket(s.socketPath, { cmd: 'close' }, 3000);
      closed.push(s.session);
    } catch (_) {
      if (s.pid) {
        try { process.kill(s.pid, 'SIGTERM'); closed.push(s.session); } catch (_) {}
      }
    }
  }
  return closed;
}

module.exports = {
  getSessionPaths,
  getStreamSocketPath,
  isDaemonAlive,
  enforceChatBrowserCap,
  ensureSessionDaemon,
  sendSessionCommand,
  listSessions,
  killAllSessions,
};
