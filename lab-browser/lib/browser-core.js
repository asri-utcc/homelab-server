'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('./config');
const authStore = require('./auth-store');

// Ensure Playwright always discovers the shared server browser cache regardless of $HOME
process.env.PLAYWRIGHT_BROWSERS_PATH = config.BROWSERS_PATH;

const { chromium } = require('playwright-core');

const LAUNCH_ARGS = [
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
  '--lang=th-TH',
  '--js-flags=--max-old-space-size=512',
  '--renderer-process-limit=2',
  '--disable-gpu',
];

let cachedChromiumVersion = undefined;

function parseMajorVersion(version) {
  if (version === undefined || version === null) return null;
  const str = String(version).trim();
  if (!str) return null;
  const fullMatch = str.match(/(\d+)\.\d+\.\d+\.\d+/);
  if (fullMatch) return fullMatch[1];
  const simpleMatch = str.match(/(\d+)/);
  return simpleMatch ? simpleMatch[1] : null;
}

function detectChromiumVersion() {
  if (cachedChromiumVersion !== undefined) return cachedChromiumVersion;
  try {
    const execPath = chromium.executablePath();
    const out = execFileSync(execPath, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const m = out.match(/(\d+\.\d+\.\d+\.\d+)/);
    cachedChromiumVersion = m ? m[1] : (out || null);
  } catch (err) {
    process.stderr.write(
      `[lab-browser] Warning: failed to detect Chromium version from executable (${err && err.message ? err.message : err})\n`
    );
    cachedChromiumVersion = null;
  }
  return cachedChromiumVersion;
}

function buildUa(version, isMobile = false) {
  const major = parseMajorVersion(version) || parseMajorVersion(detectChromiumVersion());
  if (!major) return undefined;
  if (isMobile) {
    return `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Mobile Safari/537.36`;
  }
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

async function launchWithFallback(fn, baseOpts = {}) {
  if (baseOpts.headless === false) {
    return await fn(baseOpts);
  }
  const primaryOpts = { channel: 'chromium', ...baseOpts };
  try {
    return await fn(primaryOpts);
  } catch (err) {
    process.stderr.write(
      `[lab-browser] Warning: Chromium channel "chromium" launch failed (${err && err.message ? err.message : err}); falling back to default headless shell\n`
    );
    const fallbackOpts = { ...baseOpts };
    delete fallbackOpts.channel;
    return await fn(fallbackOpts);
  }
}

function checkRamGuard() {
  const freeMb = config.getFreeMemMb();
  if (freeMb !== null && freeMb < 250) {
    throw new Error(`Insufficient free RAM (${freeMb} MB available) to launch Chromium safely`);
  }
  return freeMb;
}

function buildContextOptions(opts = {}, browserVersion = null) {
  const vp = config.parseViewport(opts);
  const headers = {
    'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
    ...(opts.headers || {}),
  };

  const userAgent = opts.userAgent || buildUa(browserVersion, vp.isMobile);

  const ctxOpts = {
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    ...(userAgent ? { userAgent } : {}),
    locale: opts.locale || 'th-TH',
    timezoneId: opts.timezone || 'Asia/Bangkok',
    ignoreHTTPSErrors: Boolean(opts.ignoreHttpsErrors),
    extraHTTPHeaders: headers,
  };

  if (opts.dark) ctxOpts.colorScheme = 'dark';
  else if (opts.light) ctxOpts.colorScheme = 'light';

  return { ctxOpts, viewportMeta: vp };
}

async function applyStealthInit(context) {
  await context.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    } catch (_) {
      // ignore read-only environments
    }
  });
}

async function openBrowserSession(opts = {}) {
  const hasPersist = Boolean(opts.persistProfile || opts.persist);
  const authProfile = opts.authProfile ? config.sanitizeAuthProfile(opts.authProfile) : null;
  if (hasPersist && authProfile) {
    throw new Error('--persist cannot be combined with --shared-auth');
  }

  config.ensureDirs({ includeAuth: Boolean(authProfile) });
  checkRamGuard();
  config.parseViewport(opts);

  const headless = !opts.headful;

  if (opts.persistProfile) {
    const profileDir = path.join(config.PROFILES_DIR, config.sanitizeSessionName(opts.persistProfile));
    fs.mkdirSync(profileDir, { recursive: true });
    const detectedVersion = detectChromiumVersion();
    const { ctxOpts, viewportMeta } = buildContextOptions(opts, detectedVersion);
    const context = await launchWithFallback(
      (launchOpts) => chromium.launchPersistentContext(profileDir, launchOpts),
      {
        headless,
        args: LAUNCH_ARGS,
        ...ctxOpts,
      }
    );
    await applyStealthInit(context);
    const page = context.pages()[0] || await context.newPage();
    return {
      browser: null,
      context,
      page,
      viewportMeta,
      authProfile: null,
      close: async () => {
        await context.close().catch(() => {});
      },
    };
  }

  const browser = await launchWithFallback(
    (launchOpts) => chromium.launch(launchOpts),
    {
      headless,
      args: LAUNCH_ARGS,
    }
  );

  try {
    const browserVersion = typeof browser.version === 'function' ? browser.version() : null;
    const { ctxOpts, viewportMeta } = buildContextOptions(opts, browserVersion);
    let context;
    let initialAuthState = null;

    if (authProfile) {
      initialAuthState = authStore.load(authProfile);
      const storageState = {
        cookies: Array.isArray(initialAuthState.cookies) ? initialAuthState.cookies : [],
        origins: Array.isArray(initialAuthState.origins) ? initialAuthState.origins : [],
      };
      try {
        context = await browser.newContext({ ...ctxOpts, storageState });
      } catch (err) {
        process.stderr.write(
          `[lab-browser] Warning: failed to apply full storageState for auth profile "${authProfile}" (${err && err.message ? err.message : err}); retrying without origins\n`
        );
        try {
          context = await browser.newContext({
            ...ctxOpts,
            storageState: { cookies: storageState.cookies, origins: [] },
          });
        } catch (err2) {
          process.stderr.write(
            `[lab-browser] Warning: failed to apply cookie storageState for auth profile "${authProfile}" (${err2 && err2.message ? err2.message : err2}); falling back to empty context\n`
          );
          context = await browser.newContext(ctxOpts);
        }
      }
    } else {
      context = await browser.newContext(ctxOpts);
    }

    await applyStealthInit(context);
    const page = await context.newPage();
    return {
      browser,
      context,
      page,
      viewportMeta,
      authProfile,
      ...(initialAuthState ? { initialAuthState } : {}),
      close: async () => {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
      },
    };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

function attachTelemetry(page) {
  const MAX_ITEMS = 100;
  const telemetry = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    failedRequests: [],
  };

  const pushBounded = (arr, item) => {
    if (arr.length < MAX_ITEMS) arr.push(item);
  };

  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error') {
      pushBounded(telemetry.consoleErrors, msg.text());
    } else if (type === 'warning') {
      pushBounded(telemetry.consoleWarnings, msg.text());
    }
  });

  page.on('pageerror', (err) => {
    pushBounded(telemetry.pageErrors, err ? (err.message || String(err)) : 'Unknown page error');
  });

  page.on('requestfailed', (req) => {
    const failure = req.failure();
    pushBounded(telemetry.failedRequests, {
      url: req.url(),
      method: req.method(),
      reason: failure ? failure.errorText : 'failed',
    });
  });

  page.on('response', (res) => {
    if (res.status() >= 400) {
      pushBounded(telemetry.failedRequests, {
        url: res.url(),
        method: res.request().method(),
        status: res.status(),
      });
    }
  });

  telemetry.clear = () => {
    telemetry.consoleErrors.length = 0;
    telemetry.consoleWarnings.length = 0;
    telemetry.pageErrors.length = 0;
    telemetry.failedRequests.length = 0;
  };

  telemetry.summary = () => ({
    consoleErrorCount: telemetry.consoleErrors.length,
    pageErrorCount: telemetry.pageErrors.length,
    failedRequestCount: telemetry.failedRequests.length,
    consoleErrors: telemetry.consoleErrors.slice(0, 20),
    pageErrors: telemetry.pageErrors.slice(0, 20),
    failedRequests: telemetry.failedRequests.slice(0, 20),
  });

  return telemetry;
}

async function waitForPageReady(page, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) || config.DEFAULT_TIMEOUT_MS;
  const idleWaitMs = opts.idleWaitMs !== undefined ? Number(opts.idleWaitMs) : 4500;

  if (idleWaitMs > 0) {
    await page.waitForLoadState('networkidle', { timeout: Math.min(idleWaitMs, timeoutMs) }).catch(() => {});
  }
  if (opts.waitFor) {
    await page.waitForSelector(String(opts.waitFor), { state: 'visible', timeout: Math.min(15000, timeoutMs) });
  }
  if (opts.waitMs && Number(opts.waitMs) > 0) {
    await page.waitForTimeout(Math.min(Number(opts.waitMs), 30000));
  }
  await page.evaluate(() => Promise.race([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    new Promise((r) => setTimeout(r, 2000)),
  ])).catch(() => {});
}

async function navigateAndSettle(page, rawUrl, opts = {}) {
  const url = config.normalizeUrl(rawUrl);
  const timeoutMs = Number(opts.timeoutMs) || config.DEFAULT_TIMEOUT_MS;
  const waitUntil = opts.waitUntil || 'domcontentloaded';
  const started = Date.now();

  const response = await page.goto(url, { waitUntil, timeout: timeoutMs });
  await waitForPageReady(page, opts);

  return {
    requestedUrl: url,
    finalUrl: page.url(),
    status: response ? response.status() : null,
    elapsedMs: Date.now() - started,
  };
}

function resolveTargetLocator(page, target) {
  const raw = String(target || '').trim();
  if (!raw) throw new Error('Missing target selector or @ref');
  const refMatch = raw.match(/^@?(e\d+)$/i);
  if (refMatch) {
    return page.locator(`[data-lab-ref="${refMatch[1].toLowerCase()}"]`).first();
  }
  return page.locator(raw).first();
}

async function extractSnapshot(page, opts = {}) {
  const maxChars = Number(opts.maxChars) || config.DEFAULT_MAX_CHARS;
  const withElements = Boolean(opts.withElements);
  const withLinks = Boolean(opts.withLinks);
  const maxLinks = Number(opts.maxLinks) || 60;

  return page.evaluate(({ maxChars: mc, withElements: we, withLinks: wl, maxLinks: ml }) => {
    const title = document.title || '';
    const url = location.href;
    const lang = document.documentElement.lang || '';
    const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';

    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || '').replace(/\s+/g, ' ').trim(),
      }))
      .filter((h) => h.text)
      .slice(0, 40);

    const rawText = (document.body && document.body.innerText) ? document.body.innerText : '';
    const cleanText = rawText
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const textTruncated = cleanText.length > mc;
    const text = textTruncated ? cleanText.slice(0, mc) + '\n...[truncated]' : cleanText;

    let elements;
    if (we) {
      // Clear stale markers before re-indexing
      document.querySelectorAll('[data-lab-ref]').forEach((el) => el.removeAttribute('data-lab-ref'));
      const candidates = Array.from(document.querySelectorAll(
        'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [tabindex]:not([tabindex="-1"])'
      ));
      elements = [];
      let idx = 1;
      for (const el of candidates) {
        if (elements.length >= 150) break;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (rect.width < 2 || rect.height < 2 || style.visibility === 'hidden' || style.display === 'none') {
          continue;
        }
        const refId = `e${idx++}`;
        el.setAttribute('data-lab-ref', refId);
        const tag = el.tagName.toLowerCase();
        const label = (
          el.getAttribute('aria-label') ||
          el.innerText ||
          el.getAttribute('placeholder') ||
          el.getAttribute('title') ||
          el.getAttribute('name') ||
          ''
        ).replace(/\s+/g, ' ').trim().slice(0, 80);
        const item = {
          ref: `@${refId}`,
          tag,
        };
        if (tag === 'input') item.type = el.getAttribute('type') || 'text';
        const role = el.getAttribute('role');
        if (role) item.role = role;
        if (label) item.label = label;
        const nameAttr = el.getAttribute('name');
        if (nameAttr) item.name = nameAttr;
        const href = el.getAttribute('href');
        if (href) item.href = href.slice(0, 140);
        if ((tag === 'input' || tag === 'textarea' || tag === 'select') && el.type !== 'password') {
          const val = String(el.value || '').trim();
          if (val) item.value = val.slice(0, 60);
        }
        if (el.disabled) item.disabled = true;
        elements.push(item);
      }
    }

    let links;
    if (wl) {
      const seen = new Set();
      links = [];
      for (const a of document.querySelectorAll('a[href]')) {
        if (links.length >= ml) break;
        const href = a.href;
        if (!href || seen.has(href)) continue;
        seen.add(href);
        const linkText = (a.innerText || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 100);
        links.push({ text: linkText, href });
      }
    }

    return {
      title,
      url,
      lang,
      metaDescription: metaDesc.slice(0, 300),
      headings,
      text,
      textLength: cleanText.length,
      textTruncated,
      ...(elements !== undefined ? { elements } : {}),
      ...(links !== undefined ? { links } : {}),
    };
  }, { maxChars, withElements, withLinks, maxLinks });
}

function parseClip(clipStr) {
  const parts = String(clipStr).split(',').map((v) => Number(v.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error(`Invalid --clip "${clipStr}" (expected x,y,width,height)`);
  }
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

async function captureScreenshot(page, urlForSlug, opts = {}) {
  const format = String(opts.format || 'png').toLowerCase() === 'jpg'
    ? 'jpeg'
    : (String(opts.format || 'png').toLowerCase() === 'jpeg' ? 'jpeg' : 'png');
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const outPath = config.resolveOutputPath(opts.out, urlForSlug || page.url(), ext);

  const shotOpts = {
    path: outPath,
    type: format,
    animations: opts.animations ? 'allow' : 'disabled',
  };
  if (format === 'jpeg') {
    const q = opts.quality !== undefined ? Number(opts.quality) : 88;
    shotOpts.quality = Math.max(10, Math.min(100, q));
  }

  if (opts.selector) {
    const loc = resolveTargetLocator(page, opts.selector);
    await loc.waitFor({ state: 'visible', timeout: Number(opts.timeoutMs) || 15000 });
    await loc.screenshot(shotOpts);
  } else {
    shotOpts.fullPage = Boolean(opts.fullPage);
    if (opts.clip && !shotOpts.fullPage) {
      shotOpts.clip = parseClip(opts.clip);
    }
    await page.screenshot(shotOpts);
  }

  const stat = fs.statSync(outPath);
  const dims = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    scrollHeight: document.documentElement ? document.documentElement.scrollHeight : window.innerHeight,
  })).catch(() => ({}));

  return {
    path: outPath,
    bytes: stat.size,
    format,
    fullPage: Boolean(opts.fullPage && !opts.selector),
    selector: opts.selector || null,
    ...dims,
  };
}

async function capturePdf(page, urlForSlug, opts = {}) {
  const outPath = config.resolveOutputPath(opts.out, urlForSlug || page.url(), 'pdf');
  await page.emulateMedia({ media: opts.media === 'print' ? 'print' : 'screen' });
  await page.pdf({
    path: outPath,
    format: opts.paper || 'A4',
    printBackground: true,
    margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
  });
  const stat = fs.statSync(outPath);
  return { path: outPath, bytes: stat.size, paper: opts.paper || 'A4' };
}

module.exports = {
  chromium,
  buildUa,
  launchWithFallback,
  buildContextOptions,
  openBrowserSession,
  attachTelemetry,
  waitForPageReady,
  navigateAndSettle,
  resolveTargetLocator,
  extractSnapshot,
  captureScreenshot,
  capturePdf,
};
