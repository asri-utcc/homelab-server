'use strict';

const fs = require('fs');
const path = require('path');
const core = require('./browser-core');
const config = require('./config');

function formatTimestamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function sanitizeFilename(rawName, fallback = 'download.bin') {
  const base = path.basename(String(rawName || '').trim());
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 120);
  return cleaned || fallback;
}

function decodeDataImageUrl(dataUrl) {
  const s = String(dataUrl || '');
  const commaIdx = s.indexOf(',');
  if (commaIdx === -1) {
    throw new Error('Invalid data:image URL');
  }
  const header = s.slice(0, commaIdx);
  const payload = s.slice(commaIdx + 1);
  if (!/^data:image\/[a-zA-Z0-9.+-]+(?:;[^,]*)?$/i.test(header)) {
    throw new Error('Invalid data:image URL');
  }
  const isBase64 = /;base64$/i.test(header);
  return isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');
}

function parseImageDimensions(buf, ext) {
  if (!Buffer.isBuffer(buf)) return { width: null, height: null };
  if (ext === 'png' && buf.length >= 24 && buf.toString('ascii', 12, 16) === 'IHDR') {
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  }
  if (ext === 'gif' && buf.length >= 10) {
    return {
      width: buf.readUInt16LE(6),
      height: buf.readUInt16LE(8),
    };
  }
  return { width: null, height: null };
}

async function fetchImageViaContextRequest(page, url, timeoutMs) {
  const ctx = typeof page.context === 'function' ? page.context() : null;
  if (!ctx || !ctx.request || typeof ctx.request.get !== 'function') {
    throw new Error('Browser context request API unavailable');
  }
  const res = await ctx.request.get(url, { timeout: timeoutMs });
  if (!res || (typeof res.ok === 'function' ? !res.ok() : (res.status && res.status() >= 400))) {
    const status = res && typeof res.status === 'function' ? res.status() : 'unknown';
    throw new Error(`HTTP ${status} while fetching image from ${url}`);
  }
  const body = await res.body();
  return Buffer.isBuffer(body) ? body : Buffer.from(body);
}

async function fetchImageViaPageEval(page, url) {
  const dataUrl = await page.evaluate(async (targetUrl) => {
    const res = await fetch(targetUrl, { credentials: 'include' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} while fetching ${targetUrl}`);
    }
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('FileReader failed to read image blob'));
      reader.readAsDataURL(blob);
    });
  }, url);
  return decodeDataImageUrl(dataUrl);
}

async function captureLocatorImageViaCanvas(loc) {
  const res = await loc.evaluate((el) => {
    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'canvas') {
      return {
        dataUrl: el.toDataURL('image/png'),
        width: el.width || null,
        height: el.height || null,
      };
    }
    const img = tag === 'img' ? el : (typeof el.querySelector === 'function' ? el.querySelector('img') : null);
    if (!img) {
      throw new Error('Element has no <img> or <canvas> to draw');
    }
    const width = img.naturalWidth || img.width || 0;
    const height = img.naturalHeight || img.height || 0;
    if (!width || !height) {
      throw new Error('Image has zero dimensions');
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx2d = canvas.getContext('2d');
    ctx2d.drawImage(img, 0, 0, width, height);
    return {
      dataUrl: canvas.toDataURL('image/png'),
      width,
      height,
    };
  });
  return {
    buf: decodeDataImageUrl(res.dataUrl),
    width: res.width || null,
    height: res.height || null,
  };
}

const AI_ACTION_VERBS = {
  click: 'คลิก',
  hover: 'ชี้',
  fill: 'กรอก',
  type: 'พิมพ์',
  select: 'เลือก',
};

async function notifyAiAction(page, loc, action, target, opts) {
  if (!opts || typeof opts.onAiAction !== 'function') return;
  try {
    const box = await loc.boundingBox({ timeout: 2000 });
    if (!box) return;
    const cx = Math.round(box.x + box.width / 2);
    const cy = Math.round(box.y + box.height / 2);

    let shortDesc = '';
    try {
      shortDesc = await loc.evaluate((el) => {
        const txt = (
          el.getAttribute('aria-label') ||
          el.innerText ||
          el.getAttribute('placeholder') ||
          el.getAttribute('title') ||
          el.getAttribute('name') ||
          ''
        ).replace(/\s+/g, ' ').trim();
        return txt.slice(0, 40);
      }, undefined, { timeout: 1000 });
    } catch (_) {
      shortDesc = '';
    }

    const shortTarget = shortDesc || String(target || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const verb = AI_ACTION_VERBS[action] || action;
    const label = `กำลัง${verb}: ${shortTarget}`;

    opts.onAiAction({
      action,
      x: cx,
      y: cy,
      box: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      },
      label,
      target: String(target || ''),
    });

    if (opts.visual) {
      await page.mouse.move(cx, cy, { steps: 8 }).catch(() => {});
    }
  } catch (_) {
    // Best-effort AI telemetry — never break the underlying action
  }
}

async function executeAction(page, telemetry, cmd, args = [], opts = {}) {
  const started = Date.now();
  const timeoutMs = Number(opts.timeoutMs) || config.DEFAULT_TIMEOUT_MS;

  switch (cmd) {
    case 'open':
    case 'visit':
    case 'navigate': {
      const targetUrl = args[0] || opts.url;
      if (!targetUrl) throw new Error(`"${cmd}" requires a <url>`);
      telemetry.clear();
      const nav = await core.navigateAndSettle(page, targetUrl, opts);
      const snap = await core.extractSnapshot(page, {
        maxChars: opts.maxChars,
        withElements: opts.withElements !== undefined ? opts.withElements : Boolean(opts.sessionMode),
        withLinks: Boolean(opts.links),
      });
      const result = { ok: true, action: cmd, ...nav, ...snap, errors: telemetry.summary() };
      if (opts.shot) {
        result.screenshot = await core.captureScreenshot(page, nav.finalUrl, opts);
      }
      return result;
    }

    case 'view':
    case 'read': {
      let nav = null;
      if (args[0]) {
        telemetry.clear();
        nav = await core.navigateAndSettle(page, args[0], opts);
      }
      const snap = await core.extractSnapshot(page, {
        maxChars: opts.maxChars,
        withElements: Boolean(opts.elements),
        withLinks: Boolean(opts.links),
      });
      const result = {
        ok: true,
        action: 'view',
        ...(nav || { finalUrl: page.url(), elapsedMs: Date.now() - started }),
        ...snap,
        errors: telemetry.summary(),
      };
      if (opts.shot) {
        result.screenshot = await core.captureScreenshot(page, page.url(), opts);
      }
      return result;
    }

    case 'shot':
    case 'capture':
    case 'screenshot': {
      let nav = null;
      if (args[0]) {
        telemetry.clear();
        nav = await core.navigateAndSettle(page, args[0], opts);
      } else {
        await core.waitForPageReady(page, opts);
      }
      const title = await page.title().catch(() => '');
      const screenshot = await core.captureScreenshot(page, page.url(), opts);
      return {
        ok: true,
        action: 'shot',
        finalUrl: page.url(),
        status: nav ? nav.status : null,
        title,
        screenshot,
        errors: telemetry.summary(),
        elapsedMs: nav ? nav.elapsedMs : (Date.now() - started),
      };
    }

    case 'check': {
      let nav = null;
      if (args[0]) {
        telemetry.clear();
        nav = await core.navigateAndSettle(page, args[0], opts);
      }
      const title = await page.title().catch(() => '');
      const errors = telemetry.summary();
      const result = {
        ok: true,
        action: 'check',
        finalUrl: page.url(),
        status: nav ? nav.status : null,
        title,
        healthy: (!nav || (nav.status && nav.status < 400)) &&
          errors.consoleErrorCount === 0 &&
          errors.pageErrorCount === 0 &&
          errors.failedRequestCount === 0,
        errors,
        elapsedMs: nav ? nav.elapsedMs : (Date.now() - started),
      };
      if (opts.shot) {
        result.screenshot = await core.captureScreenshot(page, page.url(), opts);
      }
      return result;
    }

    case 'pdf': {
      let nav = null;
      if (args[0]) {
        telemetry.clear();
        nav = await core.navigateAndSettle(page, args[0], opts);
      }
      const title = await page.title().catch(() => '');
      const pdf = await core.capturePdf(page, page.url(), opts);
      return {
        ok: true,
        action: 'pdf',
        finalUrl: page.url(),
        status: nav ? nav.status : null,
        title,
        pdf,
        elapsedMs: nav ? nav.elapsedMs : (Date.now() - started),
      };
    }

    case 'snapshot':
    case 'inspect': {
      if (args[0]) {
        telemetry.clear();
        await core.navigateAndSettle(page, args[0], opts);
      }
      const snap = await core.extractSnapshot(page, {
        maxChars: opts.maxChars || 6000,
        withElements: true,
        withLinks: Boolean(opts.links),
      });
      return {
        ok: true,
        action: 'snapshot',
        ...snap,
        errors: telemetry.summary(),
        elapsedMs: Date.now() - started,
      };
    }

    case 'links': {
      if (args[0]) {
        telemetry.clear();
        await core.navigateAndSettle(page, args[0], opts);
      }
      const snap = await core.extractSnapshot(page, {
        maxChars: 1000,
        withLinks: true,
        maxLinks: Number(opts.maxLinks) || 100,
      });
      return {
        ok: true,
        action: 'links',
        url: snap.url,
        title: snap.title,
        count: snap.links.length,
        links: snap.links,
        elapsedMs: Date.now() - started,
      };
    }

    case 'text': {
      if (args[0]) {
        telemetry.clear();
        await core.navigateAndSettle(page, args[0], opts);
      }
      if (opts.selector) {
        const loc = core.resolveTargetLocator(page, opts.selector);
        await loc.waitFor({ state: 'visible', timeout: timeoutMs });
        const text = (await loc.innerText()).trim();
        return { ok: true, action: 'text', url: page.url(), selector: opts.selector, text };
      }
      const snap = await core.extractSnapshot(page, { maxChars: opts.maxChars });
      return {
        ok: true,
        action: 'text',
        url: snap.url,
        title: snap.title,
        text: snap.text,
        textLength: snap.textLength,
        textTruncated: snap.textTruncated,
      };
    }

    case 'html': {
      if (args[0]) {
        telemetry.clear();
        await core.navigateAndSettle(page, args[0], opts);
      }
      const maxChars = Number(opts.maxChars) || 40000;
      let html;
      if (opts.selector) {
        const loc = core.resolveTargetLocator(page, opts.selector);
        await loc.waitFor({ state: 'visible', timeout: timeoutMs });
        html = await loc.evaluate((el) => el.outerHTML);
      } else {
        html = await page.content();
      }
      const truncated = html.length > maxChars;
      return {
        ok: true,
        action: 'html',
        url: page.url(),
        length: html.length,
        truncated,
        html: truncated ? html.slice(0, maxChars) : html,
      };
    }

    case 'eval': {
      let expr;
      const hasExplicitUrlArg = args.length >= 2 && (!opts.sessionMode || /^https?:\/\//i.test(args[0]));
      if (hasExplicitUrlArg) {
        telemetry.clear();
        await core.navigateAndSettle(page, args[0], opts);
        expr = args.slice(1).join(' ');
      } else if (opts.url) {
        telemetry.clear();
        await core.navigateAndSettle(page, opts.url, opts);
        expr = args.join(' ');
      } else {
        expr = args.join(' ');
      }
      if (!expr) throw new Error('"eval" requires a JS expression');
      const value = await page.evaluate((code) => {
        const trimmed = code.trim();
        if (/^(\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>|^function\s*\(/.test(trimmed)) {
          const fn = (0, eval)(`(${trimmed})`);
          return fn();
        }
        return (0, eval)(trimmed);
      }, expr);
      return { ok: true, action: 'eval', url: page.url(), result: value };
    }

    case 'click': {
      const target = args[0];
      if (!target) throw new Error('"click" requires <selector|@eN>');
      const loc = core.resolveTargetLocator(page, target);
      await loc.waitFor({ state: 'visible', timeout: timeoutMs });
      await notifyAiAction(page, loc, 'click', target, opts);
      await loc.click({ timeout: timeoutMs });
      await core.waitForPageReady(page, { ...opts, idleWaitMs: opts.idleWaitMs ?? 2500 });
      return {
        ok: true,
        action: 'click',
        target,
        url: page.url(),
        title: await page.title().catch(() => ''),
        elapsedMs: Date.now() - started,
      };
    }

    case 'hover': {
      const target = args[0];
      if (!target) throw new Error('"hover" requires <selector|@eN>');
      const loc = core.resolveTargetLocator(page, target);
      await loc.waitFor({ state: 'visible', timeout: timeoutMs });
      await notifyAiAction(page, loc, 'hover', target, opts);
      await loc.hover({ timeout: timeoutMs });
      if (opts.waitMs) await page.waitForTimeout(Number(opts.waitMs));
      return { ok: true, action: 'hover', target, url: page.url() };
    }

    case 'fill': {
      const [target, ...rest] = args;
      if (!target) throw new Error('"fill" requires <selector|@eN> <value>');
      const value = rest.join(' ');
      const loc = core.resolveTargetLocator(page, target);
      await loc.waitFor({ state: 'visible', timeout: timeoutMs });
      await notifyAiAction(page, loc, 'fill', target, opts);
      await loc.fill(value, { timeout: timeoutMs });
      return { ok: true, action: 'fill', target, filledLength: value.length, url: page.url() };
    }

    case 'type': {
      const [target, ...rest] = args;
      if (!target) throw new Error('"type" requires <selector|@eN> <text>');
      const text = rest.join(' ');
      const loc = core.resolveTargetLocator(page, target);
      await loc.waitFor({ state: 'visible', timeout: timeoutMs });
      await notifyAiAction(page, loc, 'type', target, opts);
      await loc.click({ timeout: timeoutMs });
      await loc.pressSequentially(text, { delay: Number(opts.delayMs) || 25 });
      return { ok: true, action: 'type', target, typedLength: text.length, url: page.url() };
    }

    case 'press': {
      const key = args[0];
      if (!key) throw new Error('"press" requires <key> (e.g. Enter, Tab, Escape)');
      await page.keyboard.press(key);
      await core.waitForPageReady(page, { ...opts, idleWaitMs: opts.idleWaitMs ?? 2000 });
      return {
        ok: true,
        action: 'press',
        key,
        url: page.url(),
        title: await page.title().catch(() => ''),
      };
    }

    case 'select': {
      const [target, value] = args;
      if (!target || value === undefined) throw new Error('"select" requires <selector|@eN> <value>');
      const loc = core.resolveTargetLocator(page, target);
      await loc.waitFor({ state: 'visible', timeout: timeoutMs });
      await notifyAiAction(page, loc, 'select', target, opts);
      const selected = await loc.selectOption(value, { timeout: timeoutMs });
      return { ok: true, action: 'select', target, selected };
    }

    case 'scroll': {
      const dir = String(args[0] || 'down').toLowerCase();
      const pos = await page.evaluate((d) => {
        const vh = window.innerHeight || 800;
        if (d === 'top') window.scrollTo(0, 0);
        else if (d === 'bottom') window.scrollTo(0, document.documentElement.scrollHeight);
        else if (d === 'up') window.scrollBy(0, -Math.round(vh * 0.8));
        else if (d === 'down') window.scrollBy(0, Math.round(vh * 0.8));
        else {
          const px = Number(d);
          if (Number.isFinite(px)) window.scrollBy(0, px);
        }
        return {
          scrollX: Math.round(window.scrollX),
          scrollY: Math.round(window.scrollY),
          scrollHeight: document.documentElement.scrollHeight,
          viewportHeight: vh,
        };
      }, dir);
      return { ok: true, action: 'scroll', direction: dir, ...pos };
    }

    case 'wait': {
      const arg = args[0];
      if (!arg) {
        await core.waitForPageReady(page, opts);
        return { ok: true, action: 'wait', url: page.url() };
      }
      if (/^\d+$/.test(arg)) {
        await page.waitForTimeout(Math.min(Number(arg), 30000));
        return { ok: true, action: 'wait', waitedMs: Math.min(Number(arg), 30000) };
      }
      await page.waitForSelector(arg, { state: 'visible', timeout: timeoutMs });
      return { ok: true, action: 'wait', selector: arg, visible: true };
    }

    case 'back': {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await core.waitForPageReady(page, opts);
      return { ok: true, action: 'back', url: page.url(), title: await page.title().catch(() => '') };
    }

    case 'reload': {
      telemetry.clear();
      await page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await core.waitForPageReady(page, opts);
      return { ok: true, action: 'reload', url: page.url(), title: await page.title().catch(() => '') };
    }

    case 'download': {
      const target = args[0];
      if (!target) throw new Error('"download" requires <selector|@eN>');
      if (opts.out) core.validateSafeOutputPath(opts.out);

      const loc = core.resolveTargetLocator(page, target);
      await loc.waitFor({ state: 'visible', timeout: timeoutMs });
      await notifyAiAction(page, loc, 'click', target, opts);

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: timeoutMs }),
        loc.click({ timeout: timeoutMs }),
      ]);

      const suggestedFilename = (
        download && typeof download.suggestedFilename === 'function'
          ? download.suggestedFilename()
          : ''
      ) || 'download.bin';
      const safeName = sanitizeFilename(suggestedFilename, 'download.bin');
      const outPath = opts.out
        ? core.validateSafeOutputPath(opts.out)
        : core.validateSafeOutputPath(path.join(config.OUTPUT_DIR, 'downloads', `${formatTimestamp()}_${safeName}`));

      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      await download.saveAs(outPath);
      const stat = fs.statSync(outPath);

      return {
        ok: true,
        action: 'download',
        path: outPath,
        suggestedFilename,
        sizeBytes: stat.size,
        url: page.url(),
        elapsedMs: Date.now() - started,
      };
    }

    case 'save-image': {
      const target = args[0];
      if (!target) throw new Error('"save-image" requires <selector|@eN|url>');
      if (opts.out) core.validateSafeOutputPath(opts.out);

      const trimmedTarget = String(target).trim();
      const isDirectUrl = /^(https?:\/\/|blob:|data:image\/)/i.test(trimmedTarget);

      let buf = null;
      let width = null;
      let height = null;
      let sourceUrl = null;

      if (isDirectUrl) {
        sourceUrl = trimmedTarget;
        if (/^data:image\//i.test(sourceUrl)) {
          buf = decodeDataImageUrl(sourceUrl);
        } else if (/^blob:/i.test(sourceUrl)) {
          buf = await fetchImageViaPageEval(page, sourceUrl);
        } else {
          const hasContextRequest = Boolean(
            typeof page.context === 'function' &&
            page.context() &&
            page.context().request &&
            typeof page.context().request.get === 'function'
          );
          if (hasContextRequest) {
            buf = await fetchImageViaContextRequest(page, sourceUrl, timeoutMs);
          } else {
            buf = await fetchImageViaPageEval(page, sourceUrl);
          }
        }
      } else {
        const loc = core.resolveTargetLocator(page, trimmedTarget);
        await loc.waitFor({ state: 'visible', timeout: timeoutMs });

        const info = await loc.evaluate((el) => {
          const tag = String(el.tagName || '').toLowerCase();
          if (tag === 'canvas') {
            return {
              tag: 'canvas',
              width: el.width || null,
              height: el.height || null,
              dataUrl: el.toDataURL('image/png'),
              sourceUrl: null,
            };
          }
          const img = tag === 'img' ? el : (typeof el.querySelector === 'function' ? el.querySelector('img') : null);
          if (img) {
            return {
              tag: 'img',
              sourceUrl: img.currentSrc || img.src || (typeof img.getAttribute === 'function' ? img.getAttribute('src') : null) || null,
              width: img.naturalWidth || img.width || null,
              height: img.naturalHeight || img.height || null,
            };
          }
          const bg = (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function')
            ? (window.getComputedStyle(el).backgroundImage || '')
            : '';
          const bgMatch = bg.match(/url\(["']?([^"')]+)["']?\)/i);
          const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
          return {
            tag,
            sourceUrl: bgMatch ? bgMatch[1] : null,
            width: rect ? Math.round(rect.width) || null : null,
            height: rect ? Math.round(rect.height) || null : null,
          };
        });

        width = info && info.width ? Number(info.width) : null;
        height = info && info.height ? Number(info.height) : null;

        if (info && info.tag === 'canvas' && info.dataUrl) {
          buf = decodeDataImageUrl(info.dataUrl);
          sourceUrl = 'canvas';
        } else if (info && info.sourceUrl) {
          sourceUrl = String(info.sourceUrl).trim();
          if (!/^(https?:\/\/|blob:|data:)/i.test(sourceUrl)) {
            try {
              sourceUrl = new URL(sourceUrl, page.url()).toString();
            } catch (_) {
              // keep original sourceUrl
            }
          }

          let fetchErr = null;
          try {
            if (/^data:image\//i.test(sourceUrl)) {
              buf = decodeDataImageUrl(sourceUrl);
            } else if (/^blob:/i.test(sourceUrl)) {
              buf = await fetchImageViaPageEval(page, sourceUrl);
            } else if (/^https?:\/\//i.test(sourceUrl)) {
              try {
                buf = await fetchImageViaContextRequest(page, sourceUrl, timeoutMs);
              } catch (reqErr) {
                fetchErr = reqErr;
                buf = await fetchImageViaPageEval(page, sourceUrl);
              }
            }
          } catch (err) {
            fetchErr = err;
            buf = null;
          }

          // Fallback: draw rendered element onto an in-page <canvas> if fetch failed or returned non-image
          if (!buf || !core.detectImageMagic(buf)) {
            try {
              const canvasCap = await captureLocatorImageViaCanvas(loc);
              if (canvasCap && core.detectImageMagic(canvasCap.buf)) {
                buf = canvasCap.buf;
                if (!width && canvasCap.width) width = canvasCap.width;
                if (!height && canvasCap.height) height = canvasCap.height;
              }
            } catch (canvasErr) {
              if (!buf && fetchErr) {
                throw new Error(
                  `Failed to fetch image from "${sourceUrl}" (${fetchErr.message}); canvas fallback also failed (${canvasErr.message})`
                );
              }
            }
          }
        } else {
          throw new Error(`Element "${trimmedTarget}" is not a <canvas> and has no image src`);
        }
      }

      const detected = core.detectImageMagic(buf);
      if (!detected) {
        const snippet = Buffer.isBuffer(buf)
          ? buf.slice(0, 80).toString('utf8').replace(/\s+/g, ' ').trim()
          : '';
        throw new Error(
          `Response is not a valid image (expected PNG/JPEG/WEBP/GIF, got ${buf ? buf.length : 0} bytes` +
          (snippet ? ` starting with "${snippet.slice(0, 48)}"` : '') +
          ')'
        );
      }

      if (width === null || height === null) {
        const parsedDims = parseImageDimensions(buf, detected.ext);
        if (width === null && parsedDims.width !== null) width = parsedDims.width;
        if (height === null && parsedDims.height !== null) height = parsedDims.height;
      }

      const outPath = opts.out
        ? core.validateSafeOutputPath(opts.out)
        : core.validateSafeOutputPath(path.join(config.OUTPUT_DIR, `${formatTimestamp()}_image.${detected.ext}`));

      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, buf);

      const reportedSourceUrl = (sourceUrl && sourceUrl.startsWith('data:') && sourceUrl.length > 256)
        ? `${sourceUrl.slice(0, 64)}...[truncated]`
        : sourceUrl;

      return {
        ok: true,
        action: 'save-image',
        path: outPath,
        mime: detected.mime,
        ext: detected.ext,
        sizeBytes: buf.length,
        width,
        height,
        sourceUrl: reportedSourceUrl,
        elapsedMs: Date.now() - started,
      };
    }

    case 'errors': {
      const summary = telemetry.summary();
      if (opts.clear) telemetry.clear();
      return { ok: true, action: 'errors', url: page.url(), ...summary };
    }

    default:
      throw new Error(`Unknown action "${cmd}"`);
  }
}

module.exports = { executeAction };
