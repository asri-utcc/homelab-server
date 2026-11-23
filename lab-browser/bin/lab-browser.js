#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const config = require('../lib/config');
const core = require('../lib/browser-core');
const { executeAction } = require('../lib/actions');
const sessionClient = require('../lib/session-client');

process.stdout.on('error', (err) => {
  if (err && err.code === 'EPIPE') process.exit(0);
});

const VALUE_FLAGS = new Set([
  'out', 'o',
  'viewport', 'v',
  'dpr',
  'wait', 'w',
  'wait-for',
  'wait-until',
  'timeout',
  'selector', 's',
  'clip',
  'format', 'f',
  'quality', 'q',
  'paper',
  'media',
  'max-chars',
  'max-links',
  'session',
  'auth-profile',
  'idle-ttl',
  'user-agent',
  'header', 'H',
  'delay',
  'days',
  'url',
]);

const BOOLEAN_FLAGS = new Set([
  'full-page', 'full',
  'mobile', 'tablet', 'laptop', 'desktop',
  'dark', 'light',
  'ignore-https-errors', 'insecure',
  'shot',
  'links',
  'elements',
  'persist',
  'shared-auth',
  'new-tab',
  'compact',
  'raw-text',
  'clear',
  'animations',
  'headful',
  'help', 'h',
]);

function parseCliArgs(argv) {
  const positionals = [];
  const opts = { headers: {} };
  let stopFlags = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (stopFlags) {
      positionals.push(token);
      continue;
    }
    if (token === '--') {
      stopFlags = true;
      continue;
    }
    if (!token.startsWith('-') || token === '-') {
      positionals.push(token);
      continue;
    }

    let key;
    let inlineVal;
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        key = token.slice(2, eq);
        inlineVal = token.slice(eq + 1);
      } else {
        key = token.slice(2);
      }
    } else {
      key = token.slice(1);
    }

    if (BOOLEAN_FLAGS.has(key) && inlineVal === undefined) {
      applyFlag(opts, key, true);
      continue;
    }
    if (VALUE_FLAGS.has(key)) {
      const val = inlineVal !== undefined ? inlineVal : argv[++i];
      if (val === undefined) throw new Error(`Option "--${key}" requires a value`);
      applyFlag(opts, key, val);
      continue;
    }
    throw new Error(`Unknown option "${token}" (run: lab-browser --help)`);
  }

  return { positionals, opts };
}

function applyFlag(opts, key, val) {
  switch (key) {
    case 'o':
    case 'out': opts.out = val; break;
    case 'v':
    case 'viewport': opts.viewport = val; break;
    case 'dpr': opts.dpr = val; break;
    case 'w':
    case 'wait': opts.waitMs = Number(val); break;
    case 'wait-for': opts.waitFor = val; break;
    case 'wait-until': opts.waitUntil = val; break;
    case 'timeout': opts.timeoutMs = Number(val); break;
    case 's':
    case 'selector': opts.selector = val; break;
    case 'clip': opts.clip = val; break;
    case 'f':
    case 'format': opts.format = val; break;
    case 'q':
    case 'quality': opts.quality = Number(val); break;
    case 'paper': opts.paper = val; break;
    case 'media': opts.media = val; break;
    case 'max-chars': opts.maxChars = Number(val); break;
    case 'max-links': opts.maxLinks = Number(val); break;
    case 'session': opts.session = val; break;
    case 'auth-profile': opts.authProfile = config.sanitizeAuthProfile(val); break;
    case 'idle-ttl': opts.idleTtlSec = Number(val); break;
    case 'user-agent': opts.userAgent = val; break;
    case 'delay': opts.delayMs = Number(val); break;
    case 'days': opts.days = Number(val); break;
    case 'url': opts.url = val; break;
    case 'H':
    case 'header': {
      const colon = String(val).indexOf(':');
      if (colon === -1) throw new Error(`Invalid --header "${val}" (expected "Name: Value")`);
      const hName = val.slice(0, colon).trim();
      const hVal = val.slice(colon + 1).trim();
      opts.headers[hName] = hVal;
      break;
    }
    case 'full':
    case 'full-page': opts.fullPage = true; break;
    case 'mobile': opts.mobile = true; break;
    case 'tablet': opts.tablet = true; break;
    case 'laptop': opts.laptop = true; break;
    case 'desktop': opts.desktop = true; break;
    case 'dark': opts.dark = true; break;
    case 'light': opts.light = true; break;
    case 'insecure':
    case 'ignore-https-errors': opts.ignoreHttpsErrors = true; break;
    case 'shot': opts.shot = true; break;
    case 'links': opts.links = true; break;
    case 'elements': opts.elements = true; break;
    case 'persist': opts.persist = true; break;
    case 'shared-auth': if (!opts.authProfile) opts.authProfile = 'shared'; break;
    case 'new-tab': opts.newTab = true; break;
    case 'compact': opts.compact = true; break;
    case 'raw-text': opts.rawText = true; break;
    case 'clear': opts.clear = true; break;
    case 'animations': opts.animations = true; break;
    case 'headful': opts.headful = true; break;
    case 'h':
    case 'help': opts.help = true; break;
    default: break;
  }
}

function printOutput(obj, opts = {}) {
  if (opts.rawText && obj && obj.ok) {
    if (typeof obj.text === 'string') {
      process.stdout.write(obj.text + '\n');
      return;
    }
    if (typeof obj.html === 'string') {
      process.stdout.write(obj.html + '\n');
      return;
    }
  }
  process.stdout.write(JSON.stringify(obj, null, opts.compact ? 0 : 2) + '\n');
}

function showHelp() {
  const help = `lab-browser — Local Headless Chromium Browser CLI for Homelab AI

One-shot commands (stateless, exits & frees RAM immediately):
  lab-browser view <url> [opts]       Visit page, extract title/headings/text/errors (+ --shot, --links)
  lab-browser shot <url> [opts]       Capture screenshot to /home/dev/.gemini/outputs/browser/ (or -o)
  lab-browser check <url> [opts]      Inspect HTTP status, console/page/network errors (+ --shot)
  lab-browser pdf <url> [opts]        Export webpage to PDF
  lab-browser links <url>             List links on page
  lab-browser html <url> [-s sel]     Extract rendered HTML
  lab-browser eval <url> <js>         Evaluate JS on rendered page

Persistent interactive session commands (keeps tabs/cookies/DOM open; auto-closes after 10m idle):
  lab-browser session open <url> [--new-tab]  Start/reuse session & open URL (+ interactive @eN elements)
  lab-browser session snapshot        List visible interactive @eN elements + page text
  lab-browser session click <target>  Click @eN, CSS selector, or text=...
  lab-browser session fill <target> <val>
  lab-browser session type <target> <txt>
  lab-browser session press <key>     Press key (Enter, Tab, Escape, PageDown...)
  lab-browser session select <target> <val>
  lab-browser session hover <target>
  lab-browser session scroll <down|up|top|bottom|px>
  lab-browser session wait <ms|sel>
  lab-browser session shot [opts]     Screenshot current session page
  lab-browser session text|html|links|errors|eval <js>|back|reload|tabs|tab <i>
  lab-browser session pause|resume|auth-sync|auth-clear
  lab-browser session status|list|close|kill-all

Maintenance:
  lab-browser doctor                  Verify Chromium, Thai fonts, output dir, RAM, active sessions
  lab-browser clean [--days 7]        Remove old screenshots/PDFs from outputs/browser

Common options:
  --full-page         Capture full scrollable page
  --mobile | --tablet | --laptop | --desktop | --viewport 1280x720
  --dark | --light    Preferred color scheme
  --wait 1500         Wait extra ms after load
  --wait-for "#app"   Wait for selector visible before reading/capturing
  --selector "#main"  Capture or extract only matching element
  --clip x,y,w,h      Crop screenshot region
  --format png|jpeg   Output image format (default: png)
  --insecure          Allow self-signed HTTPS certs (local homelab HTTPS)
  --session <name>    Session name (default: "default"); add --persist to keep cookies on disk
  --shared-auth       Share login cookies/storage across sessions (profile: "shared")
  --auth-profile <p>  Use named shared auth profile (cannot combine with --persist)
  --new-tab           Open URL in a new tab instead of replacing the current tab
  -o, --out <path>    Custom output file path
`;
  process.stdout.write(help);
}

async function runDoctor() {
  config.ensureDirs({ includeAuth: false });
  let executablePath = null;
  let launchOk = false;
  let browserVersion = null;
  let launchError = null;
  let thaiFontsCount = 0;

  try {
    executablePath = core.chromium.executablePath();
    const sess = await core.openBrowserSession({});
    try {
      browserVersion = sess.browser ? sess.browser.version() : 'unknown';
      launchOk = true;
    } finally {
      await sess.close();
    }
  } catch (err) {
    launchError = err.message;
  }

  try {
    const out = execSync('fc-list :lang=th 2>/dev/null | wc -l', { encoding: 'utf8' });
    thaiFontsCount = Number(out.trim()) || 0;
  } catch (_) {}

  const activeSessions = await sessionClient.listSessions();
  return {
    ok: launchOk,
    browsersPath: config.BROWSERS_PATH,
    executablePath,
    executableExists: executablePath ? fs.existsSync(executablePath) : false,
    browserVersion,
    launchError,
    outputDir: config.OUTPUT_DIR,
    thaiFontsInstalled: thaiFontsCount,
    freeMemMb: config.getFreeMemMb(),
    activeSessions: activeSessions.map((s) => ({ session: s.session, pid: s.pid, url: s.url })),
  };
}

function runClean(days = 7) {
  config.ensureDirs({ includeAuth: false });
  const cutoff = Date.now() - Math.max(0, Number(days)) * 86400 * 1000;
  const removed = [];
  for (const entry of fs.readdirSync(config.OUTPUT_DIR)) {
    const full = path.join(config.OUTPUT_DIR, entry);
    try {
      const st = fs.statSync(full);
      if (st.isFile() && st.mtimeMs < cutoff) {
        fs.unlinkSync(full);
        removed.push(entry);
      }
    } catch (_) {}
  }
  return { ok: true, action: 'clean', outputDir: config.OUTPUT_DIR, days, removedCount: removed.length, removed };
}

function resolveSessionOpts(sessName, opts) {
  const resolved = { ...opts };
  if (resolved.persist && resolved.authProfile) {
    throw new Error('--persist cannot be combined with --shared-auth');
  }
  if (!resolved.authProfile && !resolved.persist && sessName.startsWith('bv_')) {
    const envProfile = String(process.env.LAB_BROWSER_AUTH_PROFILE || '').trim();
    if (envProfile) {
      resolved.authProfile = config.sanitizeAuthProfile(envProfile);
    }
  }
  return resolved;
}

async function main() {
  const { positionals, opts } = parseCliArgs(process.argv.slice(2));
  if (opts.help || positionals.length === 0) {
    showHelp();
    return;
  }

  const [cmdRaw, ...rest] = positionals;
  const cmd = String(cmdRaw).toLowerCase();

  if (cmd === 'help') {
    showHelp();
    return;
  }

  if (cmd === 'doctor') {
    const res = await runDoctor();
    printOutput(res, opts);
    if (!res.ok) process.exitCode = 1;
    return;
  }

  if (cmd === 'clean') {
    printOutput(runClean(opts.days !== undefined ? opts.days : 7), opts);
    return;
  }

  if (cmd === 'session' || cmd === 's') {
    const sub = String(rest[0] || 'status').toLowerCase();
    const subArgs = rest.slice(1);
    const sessName = config.sanitizeSessionName(opts.session || 'default');

    if (sub === 'list' || sub === 'ls') {
      const sessions = await sessionClient.listSessions();
      printOutput({ ok: true, action: 'session_list', count: sessions.length, sessions }, opts);
      return;
    }
    if (sub === 'kill-all') {
      const closed = await sessionClient.killAllSessions();
      printOutput({ ok: true, action: 'session_kill_all', closed }, opts);
      return;
    }

    const sessionOpts = resolveSessionOpts(sessName, opts);
    const noAutoStart = new Set(['status', 'close', 'stop', 'quit', 'tabs', 'pause', 'resume', 'auth-sync', 'auth-clear']);
    const res = await sessionClient.sendSessionCommand(
      sessName,
      sub,
      subArgs,
      sessionOpts,
      !noAutoStart.has(sub)
    );
    printOutput(res, opts);
    if (!res.ok) process.exitCode = 1;
    return;
  }

  // If --session <name> was explicitly passed on top-level command, route through persistent session
  if (opts.session) {
    const sessName = config.sanitizeSessionName(opts.session);
    const sessionOpts = resolveSessionOpts(sessName, opts);
    const res = await sessionClient.sendSessionCommand(sessName, cmd, rest, sessionOpts, true);
    printOutput(res, opts);
    if (!res.ok) process.exitCode = 1;
    return;
  }

  // One-shot stateless execution (never reads or writes shared auth store)
  const oneShotOpts = { ...opts, authProfile: null };
  const session = await core.openBrowserSession(oneShotOpts);
  const telemetry = core.attachTelemetry(session.page);
  try {
    const res = await executeAction(session.page, telemetry, cmd, rest, { ...oneShotOpts, sessionMode: false });
    printOutput(res, opts);
  } finally {
    await session.close();
  }
}

main().catch((err) => {
  const payload = { ok: false, error: err && err.message ? err.message : String(err) };
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  process.exit(1);
});
