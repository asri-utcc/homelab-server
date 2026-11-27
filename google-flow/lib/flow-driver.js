'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const sel = require('./flow-selectors');

const LAB_BROWSER_BIN = '/home/dev/.local/bin/lab-browser';
const LAB_BROWSER_LIB_CANDIDATES = [
  '/home/dev/.local/share/lab-browser/lib',
  '/home/dev/projects/homelab-server/lab-browser/lib',
];

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_CAPTURED_NETWORK_IMAGES = 20;

let cachedLabBrowserModules = null;

function loadLabBrowserModules() {
  if (cachedLabBrowserModules) return cachedLabBrowserModules;
  const errors = [];
  for (const dir of LAB_BROWSER_LIB_CANDIDATES) {
    try {
      const corePath = path.join(dir, 'browser-core.js');
      const authPath = path.join(dir, 'auth-store.js');
      const cfgPath = path.join(dir, 'config.js');
      if (fs.existsSync(corePath) && fs.existsSync(authPath)) {
        cachedLabBrowserModules = {
          libDir: dir,
          browserCore: require(corePath),
          authStore: require(authPath),
          config: fs.existsSync(cfgPath) ? require(cfgPath) : null,
        };
        return cachedLabBrowserModules;
      }
    } catch (err) {
      errors.push(`${dir}: ${err && err.message ? err.message : err}`);
    }
  }
  throw new Error(
    `Unable to load lab-browser modules from ${LAB_BROWSER_LIB_CANDIDATES.join(', ')}` +
    (errors.length ? ` (${errors.join('; ')})` : '')
  );
}

function isGoogleDomain(domain) {
  const clean = String(domain || '').replace(/^\./, '').toLowerCase();
  return (
    clean === 'google.com' ||
    clean.endsWith('.google.com') ||
    clean === 'labs.google' ||
    clean.endsWith('.labs.google') ||
    clean === 'flow.google' ||
    clean.endsWith('.flow.google') ||
    clean === 'googleusercontent.com' ||
    clean.endsWith('.googleusercontent.com')
  );
}

/**
 * Safely inspect shared-auth metadata without ever reading or printing cookie values/tokens.
 */
function inspectSharedAuth(authProfile = 'shared', deps = {}) {
  const authStore = deps.authStore || loadLabBrowserModules().authStore;
  const sum = authStore.summary(authProfile);
  const domainCounts = sum && sum.domainCounts ? sum.domainCounts : {};
  const googleDomains = [];
  let googleCookieCount = 0;

  for (const [domain, count] of Object.entries(domainCounts)) {
    if (isGoogleDomain(domain)) {
      googleDomains.push(domain);
      googleCookieCount += Number(count) || 0;
    }
  }
  googleDomains.sort();

  return {
    exists: Boolean(sum && sum.exists),
    authProfile: (sum && sum.profile) || authProfile,
    totalCookies: Number(sum && sum.cookieCount) || 0,
    googleCookieCount,
    googleDomains,
    updatedAt: (sum && sum.updatedAt) || null,
  };
}

function isPausedOrHandoffResponse(res) {
  if (!res || typeof res !== 'object') return false;
  if (res.paused === true) return true;
  if (res.handoff && typeof res.handoff === 'object') return true;
  if (typeof res.pauseReason === 'string' && res.pauseReason.trim()) return true;
  const errStr = String(res.error || '');
  if (/session is paused|SENSITIVE_(CAPTCHA|OTP|PASSWORD|PAYMENT)/i.test(errStr)) return true;
  return false;
}

function buildPausedResult(res, context = {}) {
  const handoff = (res && res.handoff && typeof res.handoff === 'object') ? res.handoff : null;
  const pauseReason = (res && res.pauseReason) || (handoff && handoff.kind ? `SENSITIVE_${handoff.kind}` : 'PAUSED');
  const needsLogin = Boolean(
    (handoff && (handoff.kind === 'PASSWORD' || handoff.kind === 'OTP' || handoff.kind === 'LOGIN')) ||
    /PASSWORD|OTP|LOGIN/i.test(String(pauseReason))
  );
  return {
    ok: false,
    exitCode: 2,
    mode: context.mode || 'session',
    ...(context.session ? { session: context.session } : {}),
    paused: true,
    needsLogin,
    pauseReason,
    handoff,
    url: (res && (res.finalUrl || res.url)) || context.url || null,
    step: context.step || null,
    message:
      (handoff && handoff.message) ||
      (res && res.error) ||
      'Browser Vision session paused or awaiting manual user action (Login/OTP/CAPTCHA). Resume in Browser Vision before retrying.',
  };
}

function buildBlockedResult(gate, context = {}) {
  return {
    ok: false,
    exitCode: 2,
    mode: context.mode || 'standalone',
    ...(context.session ? { session: context.session } : {}),
    blocked: true,
    paused: false,
    needsLogin: Boolean(gate.needsLogin),
    kind: gate.kind || 'GATE',
    reason: gate.reason || 'blocked',
    url: context.url || null,
    message: gate.message || 'Google Flow is blocked by a login or verification gate.',
  };
}

function decodeDataUrlToBuffer(dataUrl) {
  const s = String(dataUrl || '');
  const commaIdx = s.indexOf(',');
  if (commaIdx === -1) throw new Error('Invalid data URL');
  const header = s.slice(0, commaIdx);
  const payload = s.slice(commaIdx + 1);
  if (!/^data:image\/[a-zA-Z0-9.+-]+(?:;[^,]*)?$/i.test(header)) {
    throw new Error('Data URL is not an image');
  }
  return /;base64$/i.test(header)
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildImageRecord(outPath, validation, method) {
  const urls = sel.buildDashboardUrls(outPath);
  return {
    path: outPath,
    filename: path.basename(outPath),
    mime: validation.mime,
    width: validation.width,
    height: validation.height,
    sizeBytes: validation.sizeBytes,
    method,
    viewUrl: urls.viewUrl,
    downloadUrl: urls.downloadUrl,
  };
}

function defaultExecLabBrowser(args, opts = {}) {
  const bin = opts.labBrowserBin || LAB_BROWSER_BIN;
  const timeout = Number(opts.timeoutMs) || 60000;
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      {
        timeout,
        maxBuffer: 40 * 1024 * 1024, // allow base64 image payloads in eval fallback
        env: { ...process.env },
      },
      (err, stdout, stderr) => {
        const rawOut = String(stdout || '').trim();
        let parsed = null;
        if (rawOut) {
          try {
            parsed = JSON.parse(rawOut);
          } catch (_) {
            // Try last JSON object in stdout if warnings leaked before it
            const firstBrace = rawOut.indexOf('{');
            if (firstBrace !== -1) {
              try {
                parsed = JSON.parse(rawOut.slice(firstBrace));
              } catch (_2) {
                parsed = null;
              }
            }
          }
        }
        if (parsed && typeof parsed === 'object') {
          resolve(parsed);
          return;
        }
        if (err) {
          const msg = String(stderr || err.message || 'lab-browser command failed').trim();
          reject(new Error(`lab-browser ${args[0] || ''} ${args[1] || ''} failed: ${msg}`));
          return;
        }
        resolve({ ok: false, error: rawOut || String(stderr || 'Empty output from lab-browser').trim() });
      }
    );
  });
}

async function callSessionCmd(sessionName, subCmd, subArgs = [], extraFlags = [], deps = {}) {
  const runner = deps.runLabBrowser || defaultExecLabBrowser;
  const args = [
    'session',
    subCmd,
    ...subArgs,
    '--session',
    String(sessionName),
    '--shared-auth',
    ...extraFlags,
  ];
  return await runner(args, { timeoutMs: deps.cmdTimeoutMs || 60000, labBrowserBin: deps.labBrowserBin });
}

// =============================================================================
// Browser-side DOM inspection / evaluation snippets (serializable & safe)
// =============================================================================

const EVAL_PAGE_STATE_EXPR = `() => {
  const text = ((document.body && document.body.innerText) || '').slice(0, 4000);
  const newProj = document.querySelector('button.new-project-button');
  const promptEl = document.querySelector('div.ProseMirror[role="textbox"], div.ProseMirror[contenteditable="true"], [role="textbox"][contenteditable="true"], textarea');
  const genBtn = document.querySelector('button.generate-icon-button');
  const recaptchaIframes = Array.from(document.querySelectorAll('iframe[src*="recaptcha"]'));
  const visibleCaptcha = recaptchaIframes.some((f) => {
    const src = String(f.getAttribute('src') || '');
    if (src.includes('size=invisible')) return false;
    const r = f.getBoundingClientRect();
    const st = window.getComputedStyle(f);
    return r.width > 120 && r.height > 80 && st.visibility !== 'hidden' && st.display !== 'none';
  });
  const accountEl = document.querySelector('[aria-label*="Google"], [aria-label*="บัญชี Google"]');
  return {
    url: location.href,
    title: document.title || '',
    lang: document.documentElement.lang || '',
    text,
    hasNewProjectButton: Boolean(newProj),
    hasPromptTextbox: Boolean(promptEl),
    hasGenerateButton: Boolean(genBtn),
    hasWorkspaceControls: Boolean(newProj || promptEl || genBtn),
    visibleCaptcha,
    accountLabel: accountEl ? (accountEl.getAttribute('aria-label') || '') : '',
  };
}`;

const EVAL_COLLECT_IMAGES_EXPR = `() => {
  const list = [];
  const seen = new Set();
  const pushImg = (img, inImageTile) => {
    const src = img.currentSrc || img.src || img.getAttribute('src') || '';
    if (!src || seen.has(src)) return;
    seen.add(src);
    list.push({
      src,
      alt: img.alt || '',
      className: typeof img.className === 'string' ? img.className : '',
      naturalWidth: img.naturalWidth || 0,
      naturalHeight: img.naturalHeight || 0,
      width: Math.round(img.getBoundingClientRect().width || 0),
      height: Math.round(img.getBoundingClientRect().height || 0),
      complete: Boolean(img.complete),
      inImageTile: Boolean(inImageTile),
    });
  };
  document.querySelectorAll('flow-image-tile img').forEach((img) => pushImg(img, true));
  document.querySelectorAll('img').forEach((img) => pushImg(img, Boolean(img.closest && img.closest('flow-image-tile'))));

  const indicators = document.querySelectorAll(
    'mat-progress-spinner, mat-progress-bar, [role="progressbar"], [aria-busy="true"], flow-image-tile .loading, flow-image-tile .generating'
  );
  let isGenerating = false;
  for (const el of indicators) {
    const r = el.getBoundingClientRect();
    const st = window.getComputedStyle(el);
    if (r.width > 1 && r.height > 1 && st.display !== 'none' && st.visibility !== 'hidden') {
      isGenerating = true;
      break;
    }
  }
  return {
    url: location.href,
    isGenerating,
    images: list,
  };
}`;

const EVAL_INSPECT_DOM_EXPR = `() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = window.getComputedStyle(el);
    return r.width > 1 && r.height > 1 && st.display !== 'none' && st.visibility !== 'hidden';
  };
  const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
    .filter(visible)
    .slice(0, 80)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
      ariaLabel: el.getAttribute('aria-label') || '',
      role: el.getAttribute('role') || '',
      className: (typeof el.className === 'string' ? el.className : '').slice(0, 120),
      disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
    }));
  const inputs = Array.from(document.querySelectorAll('textarea, input, [role="textbox"], [contenteditable="true"]'))
    .filter(visible)
    .slice(0, 30)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      role: el.getAttribute('role') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      placeholder: el.getAttribute('placeholder') || '',
      contentEditable: el.getAttribute('contenteditable') || '',
      className: (typeof el.className === 'string' ? el.className : '').slice(0, 120),
    }));
  const images = Array.from(document.querySelectorAll('img'))
    .filter(visible)
    .slice(0, 60)
    .map((img) => ({
      src: (img.currentSrc || img.src || '').slice(0, 200),
      alt: img.alt || '',
      className: (typeof img.className === 'string' ? img.className : '').slice(0, 100),
      naturalWidth: img.naturalWidth || 0,
      naturalHeight: img.naturalHeight || 0,
      inImageTile: Boolean(img.closest && img.closest('flow-image-tile')),
    }));
  const dialogs = Array.from(document.querySelectorAll('mat-dialog-container, [role="dialog"]'))
    .filter(visible)
    .map((d) => ({
      tag: d.tagName.toLowerCase(),
      text: (d.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 300),
    }));
  return {
    url: location.href,
    title: document.title || '',
    lang: document.documentElement.lang || '',
    buttonCount: buttons.length,
    inputCount: inputs.length,
    imageCount: images.length,
    buttons,
    inputs,
    images,
    dialogs,
  };
}`;

function buildFetchImageEvalExpr(targetUrl) {
  const safeUrlJson = JSON.stringify(String(targetUrl));
  return `() => (async () => {
    const targetUrl = ${safeUrlJson};
    try {
      const res = await fetch(targetUrl, { credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsDataURL(blob);
      });
      return { ok: true, method: 'eval_fetch', dataUrl };
    } catch (fetchErr) {
      const imgs = Array.from(document.querySelectorAll('img'));
      const img = imgs.find((i) => (i.currentSrc || i.src) === targetUrl);
      if (!img || !img.naturalWidth || !img.naturalHeight) {
        return { ok: false, error: String(fetchErr && fetchErr.message ? fetchErr.message : fetchErr) };
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
        return {
          ok: true,
          method: 'eval_canvas',
          width: img.naturalWidth,
          height: img.naturalHeight,
          dataUrl: canvas.toDataURL('image/png'),
        };
      } catch (canvasErr) {
        return { ok: false, error: String(canvasErr && canvasErr.message ? canvasErr.message : canvasErr) };
      }
    }
  })()`;
}

async function evalExprInPage(page, expr) {
  return page.evaluate((code) => {
    const fn = (0, eval)(`(${code})`);
    return typeof fn === 'function' ? fn() : fn;
  }, expr);
}

// =============================================================================
// Mode A: Live Browser Vision (--session <bv_sess>)
// =============================================================================

async function statusViaSession(opts, deps = {}) {
  const session = opts.session;
  const authInfo = inspectSharedAuth('shared', deps);

  const st = await callSessionCmd(session, 'status', [], [], deps);
  if (isPausedOrHandoffResponse(st)) {
    return {
      ...buildPausedResult(st, { mode: 'session', session, step: 'status' }),
      authenticated: false,
      googleCookieCount: authInfo.googleCookieCount,
      googleDomains: authInfo.googleDomains,
    };
  }

  let currentUrl = st.url || null;
  if (!st.running || !sel.isFlowUrl(currentUrl)) {
    const opened = await callSessionCmd(
      session,
      'open',
      [opts.projectUrl || sel.FLOW_PRIMARY_URL],
      ['--wait', '3000'],
      deps
    );
    if (isPausedOrHandoffResponse(opened)) {
      return {
        ...buildPausedResult(opened, { mode: 'session', session, step: 'open' }),
        authenticated: false,
        googleCookieCount: authInfo.googleCookieCount,
        googleDomains: authInfo.googleDomains,
      };
    }
    if (!opened.ok) {
      return {
        ok: false,
        exitCode: 1,
        mode: 'session',
        session,
        authenticated: false,
        needsLogin: false,
        url: opened.finalUrl || opened.url || null,
        googleCookieCount: authInfo.googleCookieCount,
        error: opened.error || 'Failed to open Google Flow in Browser Vision session',
      };
    }
    currentUrl = opened.finalUrl || opened.url || currentUrl;
  }

  const evalRes = await callSessionCmd(session, 'eval', [EVAL_PAGE_STATE_EXPR], [], deps);
  if (isPausedOrHandoffResponse(evalRes)) {
    return {
      ...buildPausedResult(evalRes, { mode: 'session', session, step: 'eval_state' }),
      authenticated: false,
      googleCookieCount: authInfo.googleCookieCount,
      googleDomains: authInfo.googleDomains,
    };
  }

  const state = (evalRes && evalRes.result && typeof evalRes.result === 'object') ? evalRes.result : {};
  const finalUrl = state.url || currentUrl || sel.FLOW_PRIMARY_URL;
  const gate = sel.detectAuthOrGate(finalUrl, state.text || '', {
    hasWorkspaceControls: state.hasWorkspaceControls,
    visibleCaptcha: state.visibleCaptcha,
  });

  const authenticated = !gate.blocked && !gate.needsLogin && (
    sel.isFlowUrl(finalUrl) && (state.hasWorkspaceControls || authInfo.googleCookieCount > 0)
  );

  return {
    ok: true,
    exitCode: gate.blocked ? 2 : 0,
    mode: 'session',
    session,
    authenticated,
    needsLogin: gate.needsLogin || !authenticated,
    blocked: gate.blocked,
    gateKind: gate.kind,
    url: finalUrl,
    title: state.title || null,
    accountLabel: state.accountLabel || null,
    hasWorkspaceControls: Boolean(state.hasWorkspaceControls),
    googleCookieCount: authInfo.googleCookieCount,
    googleDomains: authInfo.googleDomains,
    ...(gate.message ? { message: gate.message } : {}),
  };
}

async function loginViaSession(opts, deps = {}) {
  const session = opts.session || 'default';
  const authInfo = inspectSharedAuth('shared', deps);

  const opened = await callSessionCmd(
    session,
    'open',
    [opts.projectUrl || sel.FLOW_PRIMARY_URL],
    ['--new-tab', '--wait', '3000'],
    deps
  );

  if (isPausedOrHandoffResponse(opened)) {
    return {
      ...buildPausedResult(opened, { mode: 'session', session, step: 'login_open' }),
      googleCookieCount: authInfo.googleCookieCount,
    };
  }

  if (!opened.ok) {
    return {
      ok: false,
      exitCode: 1,
      mode: 'session',
      session,
      error: opened.error || 'Failed to open Google Flow login page',
      googleCookieCount: authInfo.googleCookieCount,
    };
  }

  const finalUrl = opened.finalUrl || opened.url || sel.FLOW_PRIMARY_URL;
  const gate = sel.detectAuthOrGate(finalUrl, opened.text || '', {});
  const alreadySignedIn = !gate.blocked && sel.isFlowUrl(finalUrl);

  return {
    ok: true,
    exitCode: 0,
    mode: 'session',
    session,
    url: finalUrl,
    title: opened.title || null,
    authenticated: alreadySignedIn,
    needsLogin: gate.needsLogin,
    googleCookieCount: authInfo.googleCookieCount,
    message: alreadySignedIn
      ? 'Google Flow opened in Browser Vision and appears to be signed in.'
      : 'Google Flow login page is open in Browser Vision. Please sign in manually; cookies will sync to shared-auth automatically.',
  };
}

async function inspectViaSession(opts, deps = {}) {
  const session = opts.session;
  const targetUrl = opts.projectUrl || sel.FLOW_PRIMARY_URL;

  const st = await callSessionCmd(session, 'status', [], [], deps);
  if (isPausedOrHandoffResponse(st)) {
    return buildPausedResult(st, { mode: 'session', session, step: 'inspect_status' });
  }

  if (!st.running || opts.projectUrl || !sel.isFlowUrl(st.url)) {
    const opened = await callSessionCmd(session, 'open', [targetUrl], ['--wait', '3000'], deps);
    if (isPausedOrHandoffResponse(opened)) {
      return buildPausedResult(opened, { mode: 'session', session, step: 'inspect_open' });
    }
    if (!opened.ok) {
      return { ok: false, exitCode: 1, mode: 'session', session, error: opened.error || 'Failed to open Flow' };
    }
  }

  const domRes = await callSessionCmd(session, 'eval', [EVAL_INSPECT_DOM_EXPR], [], deps);
  if (isPausedOrHandoffResponse(domRes)) {
    return buildPausedResult(domRes, { mode: 'session', session, step: 'inspect_eval' });
  }

  const shotArgs = opts.out ? ['-o', sel.validateSafeOutputPath(opts.out)] : [];
  const shotRes = await callSessionCmd(session, 'shot', [], shotArgs, deps);
  if (isPausedOrHandoffResponse(shotRes)) {
    return buildPausedResult(shotRes, { mode: 'session', session, step: 'inspect_shot' });
  }

  const dom = (domRes && domRes.result && typeof domRes.result === 'object') ? domRes.result : {};
  return {
    ok: true,
    exitCode: 0,
    mode: 'session',
    session,
    url: dom.url || (shotRes && shotRes.url) || targetUrl,
    title: dom.title || null,
    lang: dom.lang || null,
    screenshotPath: (shotRes && shotRes.path) || null,
    buttonCount: dom.buttonCount || 0,
    inputCount: dom.inputCount || 0,
    imageCount: dom.imageCount || 0,
    buttons: dom.buttons || [],
    inputs: dom.inputs || [],
    images: dom.images || [],
    dialogs: dom.dialogs || [],
  };
}

async function saveImageViaSession(session, imgInfo, outPath, deps = {}) {
  const src = imgInfo.src;
  const targetOut = sel.validateSafeOutputPath(outPath);

  // Method 1: Try lab-browser session save-image (available in updated daemon)
  const saveRes = await callSessionCmd(session, 'save-image', [src], ['-o', targetOut], deps);
  if (isPausedOrHandoffResponse(saveRes)) {
    return { pausedResponse: buildPausedResult(saveRes, { mode: 'session', session, step: 'save_image' }) };
  }

  if (saveRes && saveRes.ok && saveRes.path && fs.existsSync(saveRes.path)) {
    const buf = fs.readFileSync(saveRes.path);
    const val = sel.validateImageBuffer(buf, { width: saveRes.width || imgInfo.naturalWidth, height: saveRes.height || imgInfo.naturalHeight });
    if (val.ok) {
      return { ok: true, path: saveRes.path, validation: val, method: 'session_save_image' };
    }
  }

  // Method 2: Fallback via session eval (fetch + FileReader or canvas) for running older daemons
  const evalExpr = buildFetchImageEvalExpr(src);
  const evalRes = await callSessionCmd(session, 'eval', [evalExpr], [], deps);
  if (isPausedOrHandoffResponse(evalRes)) {
    return { pausedResponse: buildPausedResult(evalRes, { mode: 'session', session, step: 'eval_save_image' }) };
  }

  const payload = evalRes && evalRes.result;
  if (!payload || !payload.ok || !payload.dataUrl) {
    throw new Error(
      `Failed to save image via session save-image (${(saveRes && saveRes.error) || 'unavailable'}) ` +
      `and eval fallback (${(payload && payload.error) || (evalRes && evalRes.error) || 'unknown error'})`
    );
  }

  const buf = decodeDataUrlToBuffer(payload.dataUrl);
  const val = sel.validateImageBuffer(buf, {
    width: payload.width || imgInfo.naturalWidth,
    height: payload.height || imgInfo.naturalHeight,
  });
  if (!val.ok) {
    throw new Error(`Invalid image from session eval fallback: ${val.message}`);
  }

  // Ensure file extension matches detected magic bytes if caller used default extension
  let finalPath = targetOut;
  const parsed = path.parse(targetOut);
  if (parsed.ext.toLowerCase() !== `.${val.ext}` && !deps.preserveExplicitExt) {
    finalPath = sel.validateSafeOutputPath(path.join(parsed.dir, `${parsed.name}.${val.ext}`));
  }
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.writeFileSync(finalPath, buf);

  return {
    ok: true,
    path: finalPath,
    validation: val,
    method: payload.method || 'eval_fetch',
  };
}

async function generateViaSession(prompt, opts, deps = {}) {
  const started = Date.now();
  const session = opts.session;
  const timeoutMs = Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = Number(deps.pollIntervalMs) || 2000;
  const desiredCount = opts.all ? Infinity : Math.max(1, Number(opts.count) || 1);

  // 1. Check session status first (abort immediately if already paused)
  const st = await callSessionCmd(session, 'status', [], [], deps);
  if (isPausedOrHandoffResponse(st)) {
    return buildPausedResult(st, { mode: 'session', session, step: 'status' });
  }

  // 2. Navigate to projectUrl or Flow entry
  const targetUrl = opts.projectUrl || sel.FLOW_PRIMARY_URL;
  const alreadyInProject = st.running && sel.isFlowProjectUrl(st.url) && !opts.projectUrl;
  if (!alreadyInProject) {
    const openFlags = ['--wait', '3000'];
    if (!st.running || !sel.isFlowUrl(st.url)) openFlags.unshift('--new-tab');
    const opened = await callSessionCmd(session, 'open', [targetUrl], openFlags, deps);
    if (isPausedOrHandoffResponse(opened)) {
      return buildPausedResult(opened, { mode: 'session', session, step: 'open' });
    }
    if (!opened.ok) {
      return { ok: false, exitCode: 1, mode: 'session', session, error: opened.error || 'Failed to open Google Flow' };
    }
  }

  // 3. Check auth/gate
  const stateRes = await callSessionCmd(session, 'eval', [EVAL_PAGE_STATE_EXPR], [], deps);
  if (isPausedOrHandoffResponse(stateRes)) {
    return buildPausedResult(stateRes, { mode: 'session', session, step: 'check_auth' });
  }
  const pageState = (stateRes && stateRes.result) || {};
  const gate = sel.detectAuthOrGate(pageState.url, pageState.text, {
    hasWorkspaceControls: pageState.hasWorkspaceControls,
    visibleCaptcha: pageState.visibleCaptcha,
  });
  if (gate.blocked) {
    return buildBlockedResult(gate, { mode: 'session', session, url: pageState.url });
  }

  // 4. Open a project if we are on the dashboard
  if (!pageState.hasPromptTextbox && pageState.hasNewProjectButton) {
    const clicked = await callSessionCmd(session, 'click', [sel.SELECTORS.newProjectButton[0]], ['--wait', '2500'], deps);
    if (isPausedOrHandoffResponse(clicked)) {
      return buildPausedResult(clicked, { mode: 'session', session, step: 'new_project' });
    }
    if (!clicked.ok) {
      return { ok: false, exitCode: 1, mode: 'session', session, error: clicked.error || 'Failed to click New Project' };
    }
  }

  // 5. Dismiss onboarding modal if visible
  const dismissExpr = `() => {
    const dlg = document.querySelector('mat-dialog-container, [role="dialog"]');
    if (!dlg) return { dismissed: false };
    const btns = Array.from(dlg.querySelectorAll('button'));
    const target = btns.find((b) => /เริ่มต้นใช้งาน|get started|got it|เข้าใจแล้ว|skip|ข้าม|close|ปิด/i.test((b.innerText || b.getAttribute('aria-label') || '')));
    if (target) { target.click(); return { dismissed: true }; }
    return { dismissed: false };
  }`;
  const dismissRes = await callSessionCmd(session, 'eval', [dismissExpr], [], deps);
  if (isPausedOrHandoffResponse(dismissRes)) {
    return buildPausedResult(dismissRes, { mode: 'session', session, step: 'dismiss_modal' });
  }

  // 6. Optional aspect ratio / model settings
  if (opts.aspect || opts.model) {
    const settingsRes = await callSessionCmd(session, 'click', [sel.SELECTORS.settingsTriggerButton[0]], ['--wait', '500'], deps);
    if (isPausedOrHandoffResponse(settingsRes)) {
      return buildPausedResult(settingsRes, { mode: 'session', session, step: 'open_settings' });
    }
    if (settingsRes.ok && opts.aspect) {
      const aspectExpr = `() => {
        const want = ${JSON.stringify(String(opts.aspect).trim())};
        const radios = Array.from(document.querySelectorAll('.cdk-overlay-container button[role="radio"], .cdk-overlay-container [role="radio"]'));
        const match = radios.find((el) => (el.innerText || el.getAttribute('aria-label') || '').includes(want));
        if (match) { match.click(); return { selected: want }; }
        return { selected: null };
      }`;
      const arRes = await callSessionCmd(session, 'eval', [aspectExpr], [], deps);
      if (isPausedOrHandoffResponse(arRes)) {
        return buildPausedResult(arRes, { mode: 'session', session, step: 'select_aspect' });
      }
    }
    await callSessionCmd(session, 'press', ['Escape'], [], deps).catch(() => {});
  }

  // 7. Snapshot existing images BEFORE generating
  const beforeSnap = await callSessionCmd(session, 'eval', [EVAL_COLLECT_IMAGES_EXPR], [], deps);
  if (isPausedOrHandoffResponse(beforeSnap)) {
    return buildPausedResult(beforeSnap, { mode: 'session', session, step: 'snapshot_before' });
  }
  const existingSrcs = new Set(
    ((beforeSnap && beforeSnap.result && beforeSnap.result.images) || [])
      .map((i) => i.src)
      .filter(Boolean)
  );

  // 8. Fill prompt into ProseMirror / textbox
  const promptExpr = `() => {
    const selectors = ${JSON.stringify(sel.SELECTORS.promptTextbox)};
    let el = null;
    for (const s of selectors) {
      const found = document.querySelector(s);
      if (found) { el = found; break; }
    }
    if (!el) return { ok: false, error: 'Prompt textbox not found' };
    el.focus();
    const promptText = ${JSON.stringify(String(prompt))};
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      el.value = promptText;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true, tag: el.tagName.toLowerCase() };
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
    try {
      document.execCommand('insertText', false, promptText);
    } catch (_) {
      el.textContent = promptText;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: promptText }));
    }
    return { ok: true, tag: el.tagName.toLowerCase(), length: (el.innerText || '').length };
  }`;
  const fillRes = await callSessionCmd(session, 'eval', [promptExpr], [], deps);
  if (isPausedOrHandoffResponse(fillRes)) {
    return buildPausedResult(fillRes, { mode: 'session', session, step: 'fill_prompt' });
  }
  if (!fillRes.ok || !fillRes.result || !fillRes.result.ok) {
    return {
      ok: false,
      exitCode: 1,
      mode: 'session',
      session,
      error: (fillRes && fillRes.result && fillRes.result.error) || (fillRes && fillRes.error) || 'Failed to enter prompt',
    };
  }

  // 9. Click Generate button
  const genClick = await callSessionCmd(session, 'click', [sel.SELECTORS.generateButton[0]], ['--wait', '1500'], deps);
  if (isPausedOrHandoffResponse(genClick)) {
    return buildPausedResult(genClick, { mode: 'session', session, step: 'click_generate' });
  }
  if (!genClick.ok) {
    return { ok: false, exitCode: 1, mode: 'session', session, error: genClick.error || 'Failed to click Generate button' };
  }

  // 10. Poll for newly generated images
  const deadline = Date.now() + timeoutMs;
  let newImages = [];
  let projectUrl = genClick.url || pageState.url || targetUrl;
  let firstFoundAt = null;

  while (Date.now() < deadline) {
    const poll = await callSessionCmd(session, 'eval', [EVAL_COLLECT_IMAGES_EXPR], [], deps);
    if (isPausedOrHandoffResponse(poll)) {
      return buildPausedResult(poll, { mode: 'session', session, step: 'poll_images' });
    }
    const data = (poll && poll.result) || {};
    if (data.url) projectUrl = data.url;
    const candidates = (data.images || []).filter(
      (img) => img.src && !existingSrcs.has(img.src) && img.complete && sel.isLikelyResultImage(img)
    );
    if (candidates.length > 0) {
      newImages = candidates;
      if (!firstFoundAt) firstFoundAt = Date.now();
      const settled = !data.isGenerating || (Date.now() - firstFoundAt >= 3000);
      if (!opts.all && candidates.length >= desiredCount && settled) break;
      if (opts.all && !data.isGenerating && Date.now() - firstFoundAt >= 2500) break;
    }
    await sleep(pollIntervalMs);
  }

  if (newImages.length === 0) {
    return {
      ok: false,
      exitCode: 1,
      mode: 'session',
      session,
      prompt,
      projectUrl,
      elapsedMs: Date.now() - started,
      error: `Timed out after ${timeoutMs}ms waiting for newly generated Google Flow images`,
    };
  }

  // 11. Download / save new images
  const toSave = opts.all ? newImages : newImages.slice(0, desiredCount);
  const savedImages = [];
  const ts = sel.formatTimestamp();

  for (let i = 0; i < toSave.length; i++) {
    const imgInfo = toSave[i];
    const proposedPath = sel.buildOutputPath(opts.out, prompt, i, 'png', {
      timestamp: ts,
      total: toSave.length,
    });
    const saved = await saveImageViaSession(session, imgInfo, proposedPath, {
      ...deps,
      preserveExplicitExt: Boolean(opts.out && /\.(png|jpe?g|webp)$/i.test(String(opts.out))),
    });
    if (saved.pausedResponse) return saved.pausedResponse;
    savedImages.push(buildImageRecord(saved.path, saved.validation, saved.method));
  }

  let debugScreenshot = null;
  if (opts.debugShot) {
    const dbgPath = sel.buildOutputPath(null, `${prompt}-debug`, 0, 'png', { timestamp: ts });
    const dbgRes = await callSessionCmd(session, 'shot', [], ['-o', dbgPath], deps).catch(() => null);
    if (dbgRes && dbgRes.ok && dbgRes.path) debugScreenshot = dbgRes.path;
  }

  return {
    ok: true,
    exitCode: 0,
    mode: 'session',
    session,
    prompt,
    projectUrl,
    aspect: opts.aspect || null,
    model: opts.model || null,
    elapsedMs: Date.now() - started,
    images: savedImages,
    ...(debugScreenshot ? { debugScreenshot } : {}),
  };
}

// =============================================================================
// Mode B: Standalone Headless (no --session, direct Playwright via lab-browser)
// =============================================================================

async function flushAuthStateSafely(sess, authStore) {
  if (!sess || !sess.context || !sess.authProfile || !authStore) return;
  try {
    const currentState = await sess.context.storageState();
    const init = sess.initialAuthState || {};
    authStore.sync(sess.authProfile, {
      cookies: Array.isArray(currentState.cookies) ? currentState.cookies : [],
      origins: Array.isArray(currentState.origins) ? currentState.origins : [],
      knownKeys: init.syncedKeys || [],
      knownFingerprints: init.syncedFingerprints || {},
      lastVersion: typeof init.version === 'number' ? init.version : null,
    });
  } catch (_) {
    // Non-fatal: never break main command result or leak cookies
  }
}

async function findFirstVisibleLocator(page, selectors, timeoutEachMs = 1500) {
  for (const s of selectors) {
    try {
      const loc = page.locator(s).first();
      const visible = await loc.isVisible({ timeout: timeoutEachMs }).catch(() => false);
      if (visible) return { selector: s, locator: loc };
    } catch (_) {
      // try next fallback selector
    }
  }
  return null;
}

async function statusStandalone(opts, deps = {}) {
  const mods = deps.browserCore && deps.authStore ? deps : loadLabBrowserModules();
  const authInfo = inspectSharedAuth('shared', mods);

  const sess = await mods.browserCore.openBrowserSession({
    authProfile: 'shared',
    viewport: '1440x900',
  });
  try {
    const page = sess.page;
    await page.goto(opts.projectUrl || sel.FLOW_PRIMARY_URL, {
      waitUntil: 'domcontentloaded',
      timeout: Math.min(Number(opts.timeoutMs) || 30000, 45000),
    });
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1200);

    const state = await page.evaluate((expr) => { const fn = (0, eval)(`(${expr})`); return typeof fn === 'function' ? fn() : fn; }, EVAL_PAGE_STATE_EXPR).catch(() => ({
      url: page.url(),
      title: '',
      text: '',
      hasWorkspaceControls: false,
      visibleCaptcha: false,
    }));

    const finalUrl = state.url || page.url();
    const gate = sel.detectAuthOrGate(finalUrl, state.text || '', {
      hasWorkspaceControls: state.hasWorkspaceControls,
      visibleCaptcha: state.visibleCaptcha,
    });

    const authenticated = !gate.blocked && !gate.needsLogin && (
      sel.isFlowUrl(finalUrl) && (state.hasWorkspaceControls || authInfo.googleCookieCount > 0)
    );

    await flushAuthStateSafely(sess, mods.authStore);

    return {
      ok: true,
      exitCode: gate.blocked ? 2 : 0,
      mode: 'standalone',
      authenticated,
      needsLogin: gate.needsLogin || !authenticated,
      blocked: gate.blocked,
      gateKind: gate.kind,
      url: finalUrl,
      title: state.title || null,
      accountLabel: state.accountLabel || null,
      hasWorkspaceControls: Boolean(state.hasWorkspaceControls),
      googleCookieCount: authInfo.googleCookieCount,
      googleDomains: authInfo.googleDomains,
      ...(gate.message ? { message: gate.message } : {}),
    };
  } finally {
    await sess.close();
  }
}

async function inspectStandalone(opts, deps = {}) {
  const mods = deps.browserCore && deps.authStore ? deps : loadLabBrowserModules();
  const sess = await mods.browserCore.openBrowserSession({
    authProfile: 'shared',
    viewport: '1440x900',
  });
  try {
    const page = sess.page;
    const targetUrl = opts.projectUrl || sel.FLOW_PRIMARY_URL;
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const dom = await page.evaluate((expr) => { const fn = (0, eval)(`(${expr})`); return typeof fn === 'function' ? fn() : fn; }, EVAL_INSPECT_DOM_EXPR);
    const shotPath = opts.out
      ? sel.validateSafeOutputPath(opts.out)
      : sel.buildOutputPath(null, 'inspect-flow', 0, 'png');
    fs.mkdirSync(path.dirname(shotPath), { recursive: true });
    await page.screenshot({ path: shotPath, fullPage: false });

    await flushAuthStateSafely(sess, mods.authStore);

    return {
      ok: true,
      exitCode: 0,
      mode: 'standalone',
      url: dom.url || page.url(),
      title: dom.title || null,
      lang: dom.lang || null,
      screenshotPath: shotPath,
      buttonCount: dom.buttonCount || 0,
      inputCount: dom.inputCount || 0,
      imageCount: dom.imageCount || 0,
      buttons: dom.buttons || [],
      inputs: dom.inputs || [],
      images: dom.images || [],
      dialogs: dom.dialogs || [],
    };
  } finally {
    await sess.close();
  }
}

async function tryDownloadViaUiButton(page, imgInfo, outPath) {
  // Locate the tile containing this image src, open its More Options menu, click Download
  const tile = page.locator('flow-image-tile').filter({
    has: page.locator(`img[src="${imgInfo.src.replace(/"/g, '\\"')}"]`),
  }).first();

  const tileVisible = await tile.isVisible({ timeout: 2000 }).catch(() => false);
  if (!tileVisible) return null;

  await tile.hover({ timeout: 2000 }).catch(() => {});

  // Check for direct download button inside tile or via "more options" menu
  let dlBtn = await findFirstVisibleLocator(tile, sel.SELECTORS.downloadButton, 600);
  if (!dlBtn) {
    const moreBtn = await findFirstVisibleLocator(tile, sel.SELECTORS.tileMoreOptionsButton, 1000);
    if (!moreBtn) return null;
    await moreBtn.locator.click({ timeout: 3000 });
    await page.waitForTimeout(400);
    dlBtn = await findFirstVisibleLocator(page, sel.SELECTORS.downloadButton, 1500);
  }
  if (!dlBtn) {
    await page.keyboard.press('Escape').catch(() => {});
    return null;
  }

  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 12000 }),
      dlBtn.locator.click({ timeout: 4000 }),
    ]);
    const tmpPath = `${outPath}.dl-${Date.now()}`;
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    await download.saveAs(tmpPath);
    const buf = fs.readFileSync(tmpPath);
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    const val = sel.validateImageBuffer(buf, { width: imgInfo.naturalWidth, height: imgInfo.naturalHeight });
    if (!val.ok) return null;
    return { buf, validation: val, method: 'browser_download' };
  } catch (_) {
    await page.keyboard.press('Escape').catch(() => {});
    return null;
  }
}

async function captureImageStandalone(page, context, imgInfo, networkCaptures, proposedPath, preserveExplicitExt = false) {
  let result = null;

  // Tier 1: UI Download button (waitForEvent('download'))
  try {
    result = await tryDownloadViaUiButton(page, imgInfo, proposedPath);
  } catch (_) {
    result = null;
  }

  // Tier 2: Authenticated context.request.get(imgSrc)
  if (!result && /^https?:\/\//i.test(imgInfo.src) && context && context.request && typeof context.request.get === 'function') {
    try {
      const res = await context.request.get(imgInfo.src, { timeout: 20000 });
      if (res && (typeof res.ok === 'function' ? res.ok() : res.status() < 400)) {
        const raw = await res.body();
        const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        const val = sel.validateImageBuffer(buf, { width: imgInfo.naturalWidth, height: imgInfo.naturalHeight });
        if (val.ok) result = { buf, validation: val, method: 'context_request' };
      }
    } catch (_) {
      result = null;
    }
  }

  // Tier 3: Network response buffer capture
  if (!result && networkCaptures && networkCaptures.size > 0) {
    let captured = networkCaptures.get(imgInfo.src);
    if (!captured) {
      // Match by URL path prefix (ignoring query/size suffix variance)
      const baseKey = imgInfo.src.split('=')[0].split('?')[0];
      for (const [k, v] of networkCaptures.entries()) {
        if (k.startsWith(baseKey) || baseKey.startsWith(k.split('=')[0])) {
          captured = v;
          break;
        }
      }
    }
    if (captured && captured.buffer) {
      const val = sel.validateImageBuffer(captured.buffer, { width: imgInfo.naturalWidth, height: imgInfo.naturalHeight });
      if (val.ok) result = { buf: captured.buffer, validation: val, method: 'network_capture' };
    }
  }

  // Tier 4: In-page fetch / <canvas> fallback
  if (!result) {
    const evalExpr = buildFetchImageEvalExpr(imgInfo.src);
    const fetched = await page.evaluate((expr) => { const fn = (0, eval)(`(${expr})`); return typeof fn === 'function' ? fn() : fn; }, evalExpr).catch(() => null);
    if (fetched && fetched.ok && fetched.dataUrl) {
      const buf = decodeDataUrlToBuffer(fetched.dataUrl);
      const val = sel.validateImageBuffer(buf, {
        width: fetched.width || imgInfo.naturalWidth,
        height: fetched.height || imgInfo.naturalHeight,
      });
      if (val.ok) {
        result = {
          buf,
          validation: val,
          method: fetched.method === 'eval_canvas' ? 'canvas_capture' : 'page_fetch',
        };
      }
    }
  }

  if (!result) {
    throw new Error(`Unable to download or capture valid image for ${imgInfo.src.slice(0, 120)}`);
  }

  let finalPath = sel.validateSafeOutputPath(proposedPath);
  const parsed = path.parse(finalPath);
  if (!preserveExplicitExt && parsed.ext.toLowerCase() !== `.${result.validation.ext}`) {
    finalPath = sel.validateSafeOutputPath(path.join(parsed.dir, `${parsed.name}.${result.validation.ext}`));
  }

  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.writeFileSync(finalPath, result.buf);

  return buildImageRecord(finalPath, result.validation, result.method);
}

async function generateStandalone(prompt, opts, deps = {}) {
  const started = Date.now();
  const timeoutMs = Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = Number(deps.pollIntervalMs) || 1500;
  const desiredCount = opts.all ? Infinity : Math.max(1, Number(opts.count) || 1);
  const mods = deps.browserCore && deps.authStore ? deps : loadLabBrowserModules();

  const sess = await mods.browserCore.openBrowserSession({
    authProfile: 'shared',
    viewport: '1440x900',
  });

  const networkCaptures = new Map();
  let generationStartedAt = 0;

  try {
    const page = sess.page;
    const context = sess.context;

    // Attach high-resolution image response listener
    if (typeof page.on === 'function') {
      page.on('response', async (res) => {
        try {
          if (!generationStartedAt) return;
          if (res.status() < 200 || res.status() >= 300) return;
          const headers = res.headers ? res.headers() : {};
          const ct = String(headers['content-type'] || '').toLowerCase();
          const rUrl = res.url();
          const isImageResp = ct.startsWith('image/') || rUrl.includes('/asb/');
          if (!isImageResp) return;
          const raw = await res.body().catch(() => null);
          if (!raw || raw.length < sel.MIN_IMAGE_BYTES) return;
          const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
          const magic = sel.detectImageMagic(buf);
          if (!magic) return;
          if (networkCaptures.size >= MAX_CAPTURED_NETWORK_IMAGES) {
            const oldestKey = networkCaptures.keys().next().value;
            networkCaptures.delete(oldestKey);
          }
          networkCaptures.set(rUrl, { buffer: buf, mime: magic.mime, ext: magic.ext, capturedAt: Date.now() });
        } catch (_) {
          // ignore transient response read failures
        }
      });
    }

    // 1. Navigate to Flow
    const targetUrl = opts.projectUrl || sel.FLOW_PRIMARY_URL;
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(timeoutMs, 45000) });
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // 2. Check auth/gate
    const pageState = await page.evaluate((expr) => { const fn = (0, eval)(`(${expr})`); return typeof fn === 'function' ? fn() : fn; }, EVAL_PAGE_STATE_EXPR).catch(() => ({
      url: page.url(),
      text: '',
      hasWorkspaceControls: false,
      visibleCaptcha: false,
    }));
    const gate = sel.detectAuthOrGate(pageState.url || page.url(), pageState.text || '', {
      hasWorkspaceControls: pageState.hasWorkspaceControls,
      visibleCaptcha: pageState.visibleCaptcha,
    });
    if (gate.blocked) {
      return buildBlockedResult(gate, { mode: 'standalone', url: pageState.url || page.url() });
    }

    // 3. Enter a project if on dashboard
    let promptLoc = await findFirstVisibleLocator(page, sel.SELECTORS.promptTextbox, 1500);
    if (!promptLoc) {
      const newProjBtn = await findFirstVisibleLocator(page, sel.SELECTORS.newProjectButton, 2500);
      if (newProjBtn) {
        await newProjBtn.locator.click({ timeout: 8000 });
        await page.waitForURL(/\/project\//i, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1500);
      }
    }

    // 4. Dismiss onboarding modal if visible
    const dismissBtn = await findFirstVisibleLocator(page, sel.SELECTORS.onboardingDismissButtons, 1000);
    if (dismissBtn) {
      await dismissBtn.locator.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
    }

    // 5. Optional: configure aspect ratio / model / count via settings trigger
    if (opts.aspect || opts.model || (opts.count && Number(opts.count) > 1)) {
      const settingsBtn = await findFirstVisibleLocator(page, sel.SELECTORS.settingsTriggerButton, 1500);
      if (settingsBtn) {
        await settingsBtn.locator.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(500);

        if (opts.aspect) {
          const wantAspect = String(opts.aspect).trim();
          await page.evaluate((want) => {
            const radios = Array.from(document.querySelectorAll('.cdk-overlay-container button[role="radio"], .cdk-overlay-container [role="radio"]'));
            const match = radios.find((el) => (el.innerText || el.getAttribute('aria-label') || '').includes(want));
            if (match) match.click();
          }, wantAspect).catch(() => {});
          await page.waitForTimeout(250);
        }

        if (opts.model) {
          const modelBtn = await findFirstVisibleLocator(page, sel.SELECTORS.modelSelectorButton, 1200);
          if (modelBtn) {
            await modelBtn.locator.click({ timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(300);
            const wantModel = String(opts.model).trim().toLowerCase();
            await page.evaluate((want) => {
              const items = Array.from(document.querySelectorAll('.cdk-overlay-container [role="option"], .cdk-overlay-container [role="menuitem"], .cdk-overlay-container button'));
              const match = items.find((el) => (el.innerText || '').toLowerCase().includes(want));
              if (match) match.click();
            }, wantModel).catch(() => {});
            await page.waitForTimeout(250);
          }
        }

        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
      }
    }

    // 6. Snapshot existing DOM image srcs BEFORE generating
    const beforeData = await page.evaluate((expr) => { const fn = (0, eval)(`(${expr})`); return typeof fn === 'function' ? fn() : fn; }, EVAL_COLLECT_IMAGES_EXPR).catch(() => ({ images: [] }));
    const existingSrcs = new Set((beforeData.images || []).map((i) => i.src).filter(Boolean));

    // 7. Enter prompt
    promptLoc = await findFirstVisibleLocator(page, sel.SELECTORS.promptTextbox, 3000);
    if (!promptLoc) {
      throw new Error('Could not locate Google Flow prompt input box');
    }
    await promptLoc.locator.click({ timeout: 5000 });
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    if (promptLoc.selector.startsWith('textarea')) {
      await promptLoc.locator.fill(String(prompt), { timeout: 5000 });
    } else if (page.keyboard && typeof page.keyboard.insertText === 'function') {
      await page.keyboard.insertText(String(prompt));
    } else {
      await promptLoc.locator.fill(String(prompt), { timeout: 5000 });
    }
    await page.waitForTimeout(400);

    // 8. Click Generate button
    const genBtn = await findFirstVisibleLocator(page, sel.SELECTORS.generateButton, 3000);
    if (!genBtn) {
      throw new Error('Could not locate Google Flow Generate button');
    }

    generationStartedAt = Date.now();
    networkCaptures.clear();
    await genBtn.locator.click({ timeout: 8000 });

    // 9. Poll for newly generated images
    const deadline = Date.now() + timeoutMs;
    let newImages = [];
    let firstFoundAt = null;

    while (Date.now() < deadline) {
      const snap = await page.evaluate((expr) => { const fn = (0, eval)(`(${expr})`); return typeof fn === 'function' ? fn() : fn; }, EVAL_COLLECT_IMAGES_EXPR).catch(() => ({ images: [] }));
      const candidates = (snap.images || []).filter(
        (img) => img.src && !existingSrcs.has(img.src) && img.complete && sel.isLikelyResultImage(img)
      );

      if (candidates.length > 0) {
        newImages = candidates;
        if (!firstFoundAt) firstFoundAt = Date.now();
        const settled = !snap.isGenerating || (Date.now() - firstFoundAt >= 3500);
        if (!opts.all && candidates.length >= desiredCount && settled) break;
        if (opts.all && !snap.isGenerating && Date.now() - firstFoundAt >= 2500) break;
      }

      // Periodically check if a visible gate/login redirect occurred
      const curUrl = page.url();
      const midGate = sel.detectAuthOrGate(curUrl, '', {});
      if (midGate.blocked) {
        return buildBlockedResult(midGate, { mode: 'standalone', url: curUrl });
      }

      await sleep(pollIntervalMs);
    }

    if (newImages.length === 0) {
      let debugScreenshot = null;
      if (opts.debugShot) {
        const dbgPath = sel.buildOutputPath(null, `${prompt}-timeout`, 0, 'png');
        fs.mkdirSync(path.dirname(dbgPath), { recursive: true });
        await page.screenshot({ path: dbgPath }).catch(() => {});
        debugScreenshot = dbgPath;
      }
      return {
        ok: false,
        exitCode: 1,
        mode: 'standalone',
        prompt,
        projectUrl: page.url(),
        elapsedMs: Date.now() - started,
        error: `Timed out after ${timeoutMs}ms waiting for newly generated Google Flow images`,
        ...(debugScreenshot ? { debugScreenshot } : {}),
      };
    }

    // 10. Download / save images via 4-tier cascade
    const toSave = opts.all ? newImages : newImages.slice(0, desiredCount);
    const savedImages = [];
    const ts = sel.formatTimestamp();
    const preserveExplicitExt = Boolean(opts.out && /\.(png|jpe?g|webp)$/i.test(String(opts.out)));

    for (let i = 0; i < toSave.length; i++) {
      const imgInfo = toSave[i];
      const proposedPath = sel.buildOutputPath(opts.out, prompt, i, 'png', {
        timestamp: ts,
        total: toSave.length,
      });
      const rec = await captureImageStandalone(
        page,
        context,
        imgInfo,
        networkCaptures,
        proposedPath,
        preserveExplicitExt
      );
      savedImages.push(rec);
    }

    let debugScreenshot = null;
    if (opts.debugShot) {
      const dbgPath = sel.buildOutputPath(null, `${prompt}-debug`, 0, 'png', { timestamp: ts });
      fs.mkdirSync(path.dirname(dbgPath), { recursive: true });
      await page.screenshot({ path: dbgPath }).catch(() => {});
      debugScreenshot = dbgPath;
    }

    await flushAuthStateSafely(sess, mods.authStore);

    return {
      ok: true,
      exitCode: 0,
      mode: 'standalone',
      prompt,
      projectUrl: page.url(),
      aspect: opts.aspect || null,
      model: opts.model || null,
      elapsedMs: Date.now() - started,
      images: savedImages,
      ...(debugScreenshot ? { debugScreenshot } : {}),
    };
  } finally {
    await sess.close();
  }
}

// =============================================================================
// Public Unified Driver API
// =============================================================================

async function checkStatus(opts = {}, deps = {}) {
  if (opts.session) return await statusViaSession(opts, deps);
  return await statusStandalone(opts, deps);
}

async function openLogin(opts = {}, deps = {}) {
  return await loginViaSession(opts, deps);
}

async function inspectFlow(opts = {}, deps = {}) {
  if (opts.session) return await inspectViaSession(opts, deps);
  return await inspectStandalone(opts, deps);
}

async function generateImages(prompt, opts = {}, deps = {}) {
  if (!String(prompt || '').trim()) {
    return { ok: false, exitCode: 1, error: 'Prompt is required for generate' };
  }
  if (opts.session) return await generateViaSession(prompt, opts, deps);
  return await generateStandalone(prompt, opts, deps);
}

module.exports = {
  LAB_BROWSER_BIN,
  DEFAULT_TIMEOUT_MS,
  loadLabBrowserModules,
  inspectSharedAuth,
  isPausedOrHandoffResponse,
  buildPausedResult,
  buildBlockedResult,
  decodeDataUrlToBuffer,
  checkStatus,
  openLogin,
  inspectFlow,
  generateImages,
  // Exported for unit testing
  _internal: {
    callSessionCmd,
    saveImageViaSession,
    captureImageStandalone,
    flushAuthStateSafely,
    EVAL_PAGE_STATE_EXPR,
    EVAL_COLLECT_IMAGES_EXPR,
    EVAL_INSPECT_DOM_EXPR,
  },
};
