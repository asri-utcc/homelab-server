'use strict';

const core = require('./browser-core');
const config = require('./config');

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
