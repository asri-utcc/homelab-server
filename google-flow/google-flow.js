#!/usr/bin/env node
'use strict';

const sel = require('./lib/flow-selectors');
const driver = require('./lib/flow-driver');

process.stdout.on('error', (err) => {
  if (err && err.code === 'EPIPE') process.exit(0);
});

const VALUE_FLAGS = new Set([
  'session',
  'aspect',
  'count',
  'model',
  'out', 'o',
  'project-url',
  'timeout',
]);

const BOOLEAN_FLAGS = new Set([
  'all',
  'debug-shot',
  'compact',
  'help', 'h',
]);

function parseCliArgs(argv) {
  const positionals = [];
  const opts = {};
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
      if (val === undefined) {
        throw new Error(`Option "--${key}" requires a value`);
      }
      applyFlag(opts, key, val);
      continue;
    }

    throw new Error(`Unknown option "${token}" (run: google-flow --help)`);
  }

  return { positionals, opts };
}

function applyFlag(opts, key, val) {
  switch (key) {
    case 'session':
      opts.session = String(val).trim();
      break;
    case 'aspect': {
      const aspect = String(val).trim();
      if (!/^\d+:\d+$/.test(aspect)) {
        throw new Error(`Invalid --aspect "${aspect}" (expected ratio like 1:1, 16:9, 9:16, 4:3, 3:4)`);
      }
      opts.aspect = aspect;
      break;
    }
    case 'count': {
      const n = Number(val);
      if (!Number.isInteger(n) || n < 1 || n > 10) {
        throw new Error(`Invalid --count "${val}" (expected integer 1..10)`);
      }
      opts.count = n;
      break;
    }
    case 'model':
      opts.model = String(val).trim();
      break;
    case 'o':
    case 'out':
      opts.out = String(val).trim();
      break;
    case 'project-url':
      opts.projectUrl = String(val).trim();
      break;
    case 'timeout': {
      const ms = Number(val);
      if (!Number.isFinite(ms) || ms < 1000 || ms > 600000) {
        throw new Error(`Invalid --timeout "${val}" (expected 1000..600000 ms)`);
      }
      opts.timeoutMs = Math.floor(ms);
      break;
    }
    case 'all':
      opts.all = true;
      break;
    case 'debug-shot':
      opts.debugShot = true;
      break;
    case 'compact':
      opts.compact = true;
      break;
    case 'h':
    case 'help':
      opts.help = true;
      break;
    default:
      break;
  }
}

function formatHelp() {
  return `google-flow — Homelab CLI for Google Flow AI Image Generation & Download

Usage:
  google-flow status [--session <bv_sess>] [--project-url <url>] [--compact]
      Check shared Google auth cookie count (safe, no values printed) and live Google Flow access.

  google-flow login [--session <bv_sess>] [--compact]
      Open https://labs.google/fx/tools/flow in Browser Vision (--new-tab --shared-auth)
      for one-time manual Google sign-in.

  google-flow generate "<prompt>" [options]    (aliases: gen, image)
      Generate image(s) on Google Flow and save full-resolution file(s) to
      ${sel.DEFAULT_OUTPUT_DIR}/

  google-flow inspect [--session <bv_sess>] [--project-url <url>] [-o <shot.png>] [--compact]
      Dump visible buttons, prompt inputs, image tiles, and capture a screenshot
      for recalibrating selectors if Google updates the Flow UI.

Options:
  --session <bv_sess>    Run inside an active Browser Vision session (live view; stops immediately on paused/handoff)
                         Omit to run in standalone headless mode with shared-auth (frees RAM on exit)
  --aspect <ratio>       Aspect ratio (16:9, 4:3, 1:1, 3:4, 9:16)
  --count <n>            Number of newly generated images to save (default: 1)
  --all                  Save all newly generated images from the generation batch
  --model <name>         Model name hint (e.g. "Nano Banana")
  -o, --out <path>       Custom output file or directory (allowed roots: /home/dev/.gemini, /home/dev/projects, /tmp)
  --project-url <url>    Reuse a specific Google Flow project URL (https://flow.google.com/project/<uuid>)
  --timeout <ms>         Generation timeout in milliseconds (default: ${driver.DEFAULT_TIMEOUT_MS})
  --debug-shot           Capture a debug screenshot after generation
  --compact              Print single-line compact JSON
  -h, --help             Show this help message

Exit codes:
  0  Success
  2  Login required, session paused, or manual handoff (OTP/CAPTCHA/TOS/Region)
  1  Other error
`;
}

function printJson(payload, compact = false, stream = process.stdout) {
  const clean = { ...payload };
  delete clean.exitCode;
  stream.write(JSON.stringify(clean, null, compact ? 0 : 2) + '\n');
}

async function runCli(argv, deps = {}) {
  const drv = deps.driver || driver;
  const stdout = deps.stdout || process.stdout;
  const { positionals, opts } = parseCliArgs(argv);

  if (opts.help || positionals.length === 0) {
    stdout.write(formatHelp());
    return { exitCode: 0, help: true };
  }

  const cmd = String(positionals[0]).toLowerCase();
  const rest = positionals.slice(1);

  if (cmd === 'help') {
    stdout.write(formatHelp());
    return { exitCode: 0, help: true };
  }

  let result;
  if (cmd === 'status') {
    result = await drv.checkStatus(opts, deps);
  } else if (cmd === 'login') {
    result = await drv.openLogin(opts, deps);
  } else if (cmd === 'inspect') {
    result = await drv.inspectFlow(opts, deps);
  } else if (cmd === 'generate' || cmd === 'gen' || cmd === 'image') {
    const prompt = rest.join(' ').trim();
    if (!prompt) {
      throw new Error('Usage: google-flow generate "<prompt>" [options]');
    }
    result = await drv.generateImages(prompt, opts, deps);
  } else {
    throw new Error(`Unknown command "${positionals[0]}" (run: google-flow --help)`);
  }

  const exitCode = typeof result.exitCode === 'number'
    ? result.exitCode
    : (result.ok ? 0 : (result.paused || result.needsLogin || result.blocked ? 2 : 1));

  printJson(result, Boolean(opts.compact), stdout);
  return { exitCode, result };
}

if (require.main === module) {
  runCli(process.argv.slice(2))
    .then(({ exitCode }) => {
      if (exitCode) process.exitCode = exitCode;
    })
    .catch((err) => {
      const payload = {
        ok: false,
        error: err && err.message ? err.message : String(err),
      };
      process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
      process.exit(1);
    });
}

module.exports = {
  parseCliArgs,
  formatHelp,
  runCli,
};
