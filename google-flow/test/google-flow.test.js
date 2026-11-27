'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sel = require('../lib/flow-selectors');
const driver = require('../lib/flow-driver');
const cli = require('../google-flow');

// Helper: build a valid minimal PNG buffer with arbitrary IHDR width x height
function makePngBuffer(width, height, extraPaddingBytes = 0) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrLen = Buffer.alloc(4);
  ihdrLen.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from('IHDR', 'ascii');
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // RGBA
  const crc = Buffer.alloc(4);
  const pad = extraPaddingBytes > 0 ? Buffer.alloc(extraPaddingBytes, 0x01) : Buffer.alloc(0);
  return Buffer.concat([sig, ihdrLen, ihdrType, ihdrData, crc, pad]);
}

// Helper: build a minimal JPEG buffer with SOF0 dimensions
function makeJpegBuffer(width, height) {
  const buf = Buffer.alloc(22);
  buf[0] = 0xff; buf[1] = 0xd8; // SOI
  buf[2] = 0xff; buf[3] = 0xc0; // SOF0
  buf.writeUInt16BE(11, 4);     // segment length
  buf[6] = 8;                   // precision
  buf.writeUInt16BE(height, 7);
  buf.writeUInt16BE(width, 9);
  buf[11] = 3;                  // components
  buf[20] = 0xff; buf[21] = 0xd9; // EOI
  return buf;
}

// Helper: build a minimal WEBP VP8X buffer with dimensions
function makeWebpVp8xBuffer(width, height) {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(22, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8X', 12, 'ascii');
  buf.writeUInt32LE(10, 16);
  const wMinus1 = width - 1;
  const hMinus1 = height - 1;
  buf[24] = wMinus1 & 0xff;
  buf[25] = (wMinus1 >> 8) & 0xff;
  buf[26] = (wMinus1 >> 16) & 0xff;
  buf[27] = hMinus1 & 0xff;
  buf[28] = (hMinus1 >> 8) & 0xff;
  buf[29] = (hMinus1 >> 16) & 0xff;
  return buf;
}

// =============================================================================
// 1. CLI Argument Parsing
// =============================================================================

test('parseCliArgs parses generate options, aliases, and flags', () => {
  const parsed = cli.parseCliArgs([
    'gen',
    '8-legged cute kitten',
    '--session', 'bv_sess_123',
    '--aspect', '1:1',
    '--count', '2',
    '--all',
    '--model', 'Nano Banana',
    '-o', '/tmp/kitten.png',
    '--project-url', 'https://flow.google.com/project/abc-123',
    '--timeout', '90000',
    '--debug-shot',
    '--compact',
  ]);

  assert.deepEqual(parsed.positionals, ['gen', '8-legged cute kitten']);
  assert.equal(parsed.opts.session, 'bv_sess_123');
  assert.equal(parsed.opts.aspect, '1:1');
  assert.equal(parsed.opts.count, 2);
  assert.equal(parsed.opts.all, true);
  assert.equal(parsed.opts.model, 'Nano Banana');
  assert.equal(parsed.opts.out, '/tmp/kitten.png');
  assert.equal(parsed.opts.projectUrl, 'https://flow.google.com/project/abc-123');
  assert.equal(parsed.opts.timeoutMs, 90000);
  assert.equal(parsed.opts.debugShot, true);
  assert.equal(parsed.opts.compact, true);
});

test('parseCliArgs rejects unknown flags and invalid values', () => {
  assert.throws(() => cli.parseCliArgs(['status', '--bogus']), /Unknown option/);
  assert.throws(() => cli.parseCliArgs(['generate', 'cat', '--aspect', 'wide']), /Invalid --aspect/);
  assert.throws(() => cli.parseCliArgs(['generate', 'cat', '--count', '0']), /Invalid --count/);
  assert.throws(() => cli.parseCliArgs(['generate', 'cat', '--timeout', '50']), /Invalid --timeout/);
});

// =============================================================================
// 2. Auth / Gate Detection
// =============================================================================

test('detectAuthOrGate flags Google Sign-In redirect as LOGIN', () => {
  const res = sel.detectAuthOrGate('https://accounts.google.com/v3/signin/identifier?continue=https://flow.google.com', '');
  assert.equal(res.blocked, true);
  assert.equal(res.needsLogin, true);
  assert.equal(res.kind, 'LOGIN');
});

test('detectAuthOrGate flags visible CAPTCHA, TOS, and region gates', () => {
  const cap = sel.detectAuthOrGate('https://flow.google.com/project/1', 'Please verify you are human');
  assert.equal(cap.blocked, true);
  assert.equal(cap.kind, 'CAPTCHA');

  const capFlag = sel.detectAuthOrGate('https://flow.google.com/project/1', '', { visibleCaptcha: true });
  assert.equal(capFlag.blocked, true);
  assert.equal(capFlag.kind, 'CAPTCHA');

  const tos = sel.detectAuthOrGate('https://flow.google.com/', 'Please accept Terms of Service to continue');
  assert.equal(tos.blocked, true);
  assert.equal(tos.kind, 'TOS');

  const region = sel.detectAuthOrGate('https://flow.google.com/', 'Google Flow is not available in your country yet');
  assert.equal(region.blocked, true);
  assert.equal(region.kind, 'REGION');
});

test('detectAuthOrGate allows authenticated Google Flow workspace with invisible reCAPTCHA', () => {
  const res = sel.detectAuthOrGate(
    'https://flow.google.com/project/2cf4b653-392a-4def-bbe5-5f72f9f3cfb7',
    'โปรเจ็กต์ใหม่ คุณต้องการสร้างอะไร เริ่มสร้าง',
    { hasWorkspaceControls: true, visibleCaptcha: false }
  );
  assert.equal(res.blocked, false);
  assert.equal(res.needsLogin, false);
  assert.equal(res.kind, null);
});

// =============================================================================
// 3. Slugify, Output Path & Path Traversal Guard, Dashboard URLs
// =============================================================================

test('slugifyPrompt handles ASCII, punctuation, and Thai-only prompts deterministically', () => {
  assert.equal(sel.slugifyPrompt('Cute 8-Legged Kitten!!'), 'cute-8-legged-kitten');
  const thai1 = sel.slugifyPrompt('ลูกแมว 8 ขา น่ารักมาก');
  const thai2 = sel.slugifyPrompt('ลูกแมว 8 ขา น่ารักมาก');
  assert.equal(thai1, thai2);
  assert.match(thai1, /^flow-8-[0-9a-f]{8}$/);
  assert.ok(sel.slugifyPrompt('a '.repeat(60)).length <= 48);
});

test('buildOutputPath builds safe default, numbered, and directory paths and blocks traversal', () => {
  const defPath = sel.buildOutputPath(null, '8-legged kitten', 0, 'webp', { timestamp: '20261128-020500' });
  assert.equal(defPath, '/home/dev/.gemini/outputs/google-flow/20261128-020500_8-legged-kitten.webp');

  const second = sel.buildOutputPath('/tmp/cat.png', 'cat', 1, 'png');
  assert.equal(second, '/tmp/cat_2.png');

  const inDir = sel.buildOutputPath('/tmp/', 'cat', 0, 'jpg', { timestamp: '20261128-020500' });
  assert.equal(inDir, '/tmp/20261128-020500_cat.jpg');

  // Path traversal & disallowed roots
  assert.throws(() => sel.buildOutputPath('/etc/passwd', 'cat', 0, 'png'), /Unsafe output path/);
  assert.throws(() => sel.buildOutputPath('/home/dev/.ssh/id_rsa', 'cat', 0, 'png'), /Unsafe output path/);
  assert.throws(() => sel.buildOutputPath('/home/dev/.gemini/../.bashrc', 'cat', 0, 'png'), /Unsafe output path/);
  assert.throws(() => sel.buildOutputPath('/tmp2/escape.png', 'cat', 0, 'png'), /Unsafe output path/);
  assert.throws(() => sel.buildOutputPath('/tmp/bad\0.png', 'cat', 0, 'png'), /null byte/);
});

test('buildDashboardUrls produces viewUrl and downloadUrl under homelab tailnet domain', () => {
  const filePath = '/home/dev/.gemini/outputs/google-flow/kitten.png';
  const urls = sel.buildDashboardUrls(filePath);
  assert.equal(
    urls.viewUrl,
    'https://homelab.tail285279.ts.net/api/gemini/local-image?path=%2Fhome%2Fdev%2F.gemini%2Foutputs%2Fgoogle-flow%2Fkitten.png'
  );
  assert.equal(
    urls.downloadUrl,
    'https://homelab.tail285279.ts.net/api/gemini/local-file?path=%2Fhome%2Fdev%2F.gemini%2Foutputs%2Fgoogle-flow%2Fkitten.png&download=1'
  );
});

// =============================================================================
// 4. Image Magic Bytes, Dimension Parsing & Min-Size Filtering
// =============================================================================

test('validateImageBuffer accepts valid PNG/JPEG/WEBP >= 256px and rejects HTML/tiny icons', () => {
  const pngOk = sel.validateImageBuffer(makePngBuffer(1024, 1024));
  assert.equal(pngOk.ok, true);
  assert.equal(pngOk.mime, 'image/png');
  assert.equal(pngOk.width, 1024);
  assert.equal(pngOk.height, 1024);

  const jpgOk = sel.validateImageBuffer(makeJpegBuffer(1280, 720));
  assert.equal(jpgOk.ok, true);
  assert.equal(jpgOk.mime, 'image/jpeg');
  assert.equal(jpgOk.width, 1280);
  assert.equal(jpgOk.height, 720);

  const webpOk = sel.validateImageBuffer(makeWebpVp8xBuffer(2400, 3200));
  assert.equal(webpOk.ok, true);
  assert.equal(webpOk.mime, 'image/webp');
  assert.equal(webpOk.width, 2400);
  assert.equal(webpOk.height, 3200);

  const htmlBad = sel.validateImageBuffer(Buffer.from('<html><body>Sign in</body></html>'));
  assert.equal(htmlBad.ok, false);
  assert.equal(htmlBad.reason, 'invalid_magic_bytes');

  const tinyPng = sel.validateImageBuffer(makePngBuffer(128, 128));
  assert.equal(tinyPng.ok, false);
  assert.equal(tinyPng.reason, 'image_too_small');

  // Small icon (32x32) rejected even if padded > 15KB
  const paddedIcon = sel.validateImageBuffer(makePngBuffer(32, 32, 20000));
  assert.equal(paddedIcon.ok, false);
  assert.equal(paddedIcon.reason, 'icon_dimension_rejected');
});

test('isLikelyResultImage filters out avatars, icons, and video thumbnails', () => {
  assert.equal(sel.isLikelyResultImage({
    src: 'https://flow.google.com/asb/abc123=s3200-rw',
    alt: 'การ์ดแสดงรูปภาพผู้ใช้',
    className: 'image',
    naturalWidth: 2400,
    naturalHeight: 3200,
    inImageTile: true,
  }), true);

  assert.equal(sel.isLikelyResultImage({
    src: 'https://lh3.googleusercontent.com/a/avatar123',
    naturalWidth: 512,
    naturalHeight: 512,
  }), false);

  assert.equal(sel.isLikelyResultImage({
    src: 'https://flow.google.com/asb/vid=s1024',
    alt: 'ภาพปกวิดีโอที่สร้างขึ้น',
    className: 'thumbnail',
    naturalWidth: 1024,
    naturalHeight: 576,
    inImageTile: false,
  }), false);
});

// =============================================================================
// 5. Driver & CLI Flow Simulations (Paused/NeedsLogin exit code 2, Mock Generate)
// =============================================================================

test('Session mode stops immediately with exit code 2 when paused/handoff is returned', async () => {
  const calls = [];
  const mockRunLabBrowser = async (args) => {
    calls.push(args);
    if (args[1] === 'status') {
      return { ok: true, running: true, url: 'https://flow.google.com/project/abc', paused: true, pauseReason: 'SENSITIVE_CAPTCHA', handoff: { kind: 'CAPTCHA', message: 'Paused for CAPTCHA' } };
    }
    throw new Error('Should not execute any command after paused');
  };

  let out = '';
  const cliRes = await cli.runCli(['generate', 'kitten', '--session', 'bv_test'], {
    runLabBrowser: mockRunLabBrowser,
    stdout: { write: (s) => { out += s; } },
  });

  assert.equal(cliRes.exitCode, 2);
  assert.equal(calls.length, 1);
  const parsed = JSON.parse(out);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.paused, true);
  assert.equal(parsed.handoff.kind, 'CAPTCHA');
});

test('Session mode generate falls back to session eval fetch when daemon lacks save-image', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gflow-sess-'));
  const outFile = path.join(tmpDir, 'kitten.png');
  const pngBuf = makePngBuffer(1024, 1024);
  const pngDataUrl = `data:image/png;base64,${pngBuf.toString('base64')}`;

  let evalCallCount = 0;
  const mockRunLabBrowser = async (args) => {
    const sub = args[1];
    if (sub === 'status') return { ok: true, running: true, url: 'https://flow.google.com/project/xyz' };
    if (sub === 'eval') {
      evalCallCount++;
      const expr = args[2] || '';
      if (expr.includes('hasWorkspaceControls')) {
        return { ok: true, result: { url: 'https://flow.google.com/project/xyz', title: 'Google Flow', text: 'คุณต้องการสร้างอะไร', hasWorkspaceControls: true, hasPromptTextbox: true, visibleCaptcha: false } };
      }
      if (expr.includes('mat-dialog-container')) return { ok: true, result: { dismissed: false } };
      if (expr.includes('insertText')) return { ok: true, result: { ok: true, tag: 'div', length: 12 } };
      if (expr.includes('FileReader')) return { ok: true, result: { ok: true, method: 'eval_fetch', dataUrl: pngDataUrl } };
      if (expr.includes('isGenerating')) {
        // First collect = before snapshot (1 old image), subsequent collect = old + new image
        if (evalCallCount <= 3) {
          return { ok: true, result: { url: 'https://flow.google.com/project/xyz', isGenerating: false, images: [{ src: 'https://flow.google.com/asb/OLD=s3200-rw', naturalWidth: 1024, naturalHeight: 1024, complete: true, inImageTile: true }] } };
        }
        return {
          ok: true,
          result: {
            url: 'https://flow.google.com/project/xyz',
            isGenerating: false,
            images: [
              { src: 'https://flow.google.com/asb/OLD=s3200-rw', naturalWidth: 1024, naturalHeight: 1024, complete: true, inImageTile: true },
              { src: 'https://flow.google.com/asb/NEW_CAT=s3200-rw', naturalWidth: 1024, naturalHeight: 1024, complete: true, inImageTile: true },
            ],
          },
        };
      }
    }
    if (sub === 'click') return { ok: true, url: 'https://flow.google.com/project/xyz' };
    if (sub === 'save-image') return { ok: false, error: 'Unknown action "save-image"' };
    return { ok: true };
  };

  let out = '';
  try {
    const cliRes = await cli.runCli(['generate', '8-legged kitten', '--session', 'bv_test', '-o', outFile], {
      runLabBrowser: mockRunLabBrowser,
      pollIntervalMs: 10,
      stdout: { write: (s) => { out += s; } },
    });

    assert.equal(cliRes.exitCode, 0);
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.mode, 'session');
    assert.equal(parsed.images.length, 1);
    assert.equal(parsed.images[0].path, outFile);
    assert.equal(parsed.images[0].mime, 'image/png');
    assert.equal(parsed.images[0].width, 1024);
    assert.equal(parsed.images[0].height, 1024);
    assert.equal(parsed.images[0].method, 'eval_fetch');
    assert.match(parsed.images[0].viewUrl, /local-image\?path=/);
    assert.match(parsed.images[0].downloadUrl, /local-file\?path=.*&download=1/);
    assert.ok(fs.existsSync(outFile));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Standalone mode returns exit code 2 on Google Sign-In redirect and closes browser', async () => {
  let closed = false;
  const mockPage = {
    url: () => 'https://accounts.google.com/v3/signin/identifier',
    goto: async () => {},
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    on: () => {},
    evaluate: async () => ({
      url: 'https://accounts.google.com/v3/signin/identifier',
      title: 'Sign in - Google Accounts',
      text: 'Sign in with Google',
      hasWorkspaceControls: false,
      visibleCaptcha: false,
    }),
  };

  const mockBrowserCore = {
    openBrowserSession: async () => ({
      page: mockPage,
      context: { storageState: async () => ({ cookies: [], origins: [] }) },
      authProfile: 'shared',
      close: async () => { closed = true; },
    }),
  };

  const mockAuthStore = {
    summary: () => ({ exists: true, profile: 'shared', cookieCount: 0, domainCounts: {} }),
    sync: () => {},
  };

  let out = '';
  const cliRes = await cli.runCli(['generate', 'kitten'], {
    browserCore: mockBrowserCore,
    authStore: mockAuthStore,
    stdout: { write: (s) => { out += s; } },
  });

  assert.equal(closed, true);
  assert.equal(cliRes.exitCode, 2);
  const parsed = JSON.parse(out);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.needsLogin, true);
  assert.equal(parsed.kind, 'LOGIN');
});

test('Standalone mode generate ignores pre-existing image, downloads new image via context.request, flushes auth & closes browser', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gflow-standalone-'));
  const outFile = path.join(tmpDir, 'result.webp');
  const webpBuf = makeWebpVp8xBuffer(2400, 3200);
  let closed = false;
  let authSynced = false;
  let collectCount = 0;

  const mockLocator = () => ({
    first: () => ({
      isVisible: async () => true,
      click: async () => {},
      fill: async () => {},
      hover: async () => {},
    }),
    filter: () => ({
      first: () => ({
        isVisible: async () => false,
      }),
    }),
  });

  const mockPage = {
    url: () => 'https://flow.google.com/project/demo-123',
    goto: async () => {},
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    on: () => {},
    locator: mockLocator,
    keyboard: {
      press: async () => {},
      insertText: async () => {},
    },
    evaluate: async (_fn, expr) => {
      if (typeof expr === 'string' && expr.includes('hasWorkspaceControls')) {
        return {
          url: 'https://flow.google.com/project/demo-123',
          title: 'Google Flow',
          text: 'คุณต้องการสร้างอะไร',
          hasWorkspaceControls: true,
          visibleCaptcha: false,
        };
      }
      if (typeof expr === 'string' && expr.includes('isGenerating')) {
        collectCount++;
        if (collectCount === 1) {
          return {
            url: 'https://flow.google.com/project/demo-123',
            isGenerating: false,
            images: [{ src: 'https://flow.google.com/asb/OLD_IMG=s3200-rw', naturalWidth: 2400, naturalHeight: 3200, complete: true, inImageTile: true }],
          };
        }
        return {
          url: 'https://flow.google.com/project/demo-123',
          isGenerating: false,
          images: [
            { src: 'https://flow.google.com/asb/OLD_IMG=s3200-rw', naturalWidth: 2400, naturalHeight: 3200, complete: true, inImageTile: true },
            { src: 'https://flow.google.com/asb/NEW_KITTEN=s3200-rw', naturalWidth: 2400, naturalHeight: 3200, complete: true, inImageTile: true },
          ],
        };
      }
      return {};
    },
  };

  const requestedUrls = [];
  const mockContext = {
    storageState: async () => ({ cookies: [], origins: [] }),
    request: {
      get: async (url) => {
        requestedUrls.push(url);
        return { ok: () => true, status: () => 200, body: async () => webpBuf };
      },
    },
  };

  const mockBrowserCore = {
    openBrowserSession: async () => ({
      page: mockPage,
      context: mockContext,
      authProfile: 'shared',
      initialAuthState: { syncedKeys: [], syncedFingerprints: {}, version: 1 },
      close: async () => { closed = true; },
    }),
  };

  const mockAuthStore = {
    summary: () => ({ exists: true, profile: 'shared', cookieCount: 10, domainCounts: { 'google.com': 10 } }),
    sync: () => { authSynced = true; },
  };

  let out = '';
  try {
    const cliRes = await cli.runCli(['image', '8-legged kitten', '-o', outFile], {
      browserCore: mockBrowserCore,
      authStore: mockAuthStore,
      pollIntervalMs: 10,
      stdout: { write: (s) => { out += s; } },
    });

    assert.equal(closed, true);
    assert.equal(authSynced, true);
    assert.equal(cliRes.exitCode, 0);
    assert.deepEqual(requestedUrls, ['https://flow.google.com/asb/NEW_KITTEN=s3200-rw']);
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.mode, 'standalone');
    assert.equal(parsed.images.length, 1);
    assert.equal(parsed.images[0].mime, 'image/webp');
    assert.equal(parsed.images[0].width, 2400);
    assert.equal(parsed.images[0].height, 3200);
    assert.equal(parsed.images[0].method, 'context_request');
    assert.ok(fs.existsSync(outFile));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('inspectSharedAuth never exposes cookie values or tokens', () => {
  const fakeAuthStore = {
    summary: () => ({
      exists: true,
      profile: 'shared',
      cookieCount: 12,
      updatedAt: '2026-11-28T00:00:00Z',
      domainCounts: {
        'google.com': 8,
        'accounts.google.com': 2,
        'example.com': 2,
      },
    }),
  };
  const info = driver.inspectSharedAuth('shared', { authStore: fakeAuthStore });
  assert.equal(info.googleCookieCount, 10);
  assert.deepEqual(info.googleDomains, ['accounts.google.com', 'google.com']);
  assert.equal(JSON.stringify(info).includes('cookieValue'), false);
});

test('saveImageViaSession Method 1 renames .png to .webp when WEBP bytes are saved and preserveExplicitExt is false', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gflow-m1-webp-'));
  const proposedPng = path.join(tmpDir, '20261128-020500_kitten.png');
  const expectedWebp = path.join(tmpDir, '20261128-020500_kitten.webp');
  const explicitPng = path.join(tmpDir, 'keep-me.png');
  const webpBuf = makeWebpVp8xBuffer(2400, 3200);

  const mockRunLabBrowser = async (args) => {
    assert.equal(args[1], 'save-image');
    const outIdx = args.indexOf('-o');
    const outTarget = args[outIdx + 1];
    fs.writeFileSync(outTarget, webpBuf);
    return {
      ok: true,
      path: outTarget,
      width: 2400,
      height: 3200,
      mime: 'image/webp',
    };
  };

  try {
    // Case 1: default extension -> renamed safely to .webp
    const res = await driver._internal.saveImageViaSession(
      'bv_test',
      { src: 'https://flow.google.com/asb/CAT=s3200-rw', naturalWidth: 2400, naturalHeight: 3200 },
      proposedPng,
      { runLabBrowser: mockRunLabBrowser, preserveExplicitExt: false }
    );

    assert.equal(res.ok, true);
    assert.equal(res.method, 'session_save_image');
    assert.equal(res.path, expectedWebp);
    assert.equal(res.validation.mime, 'image/webp');
    assert.equal(res.validation.ext, 'webp');
    assert.equal(fs.existsSync(expectedWebp), true);
    assert.equal(fs.existsSync(proposedPng), false);

    // Case 2: preserveExplicitExt: true -> keeps explicit .png path
    const resKeep = await driver._internal.saveImageViaSession(
      'bv_test',
      { src: 'https://flow.google.com/asb/CAT=s3200-rw', naturalWidth: 2400, naturalHeight: 3200 },
      explicitPng,
      { runLabBrowser: mockRunLabBrowser, preserveExplicitExt: true }
    );

    assert.equal(resKeep.ok, true);
    assert.equal(resKeep.method, 'session_save_image');
    assert.equal(resKeep.path, explicitPng);
    assert.equal(fs.existsSync(explicitPng), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Session mode generate uses language-agnostic selectors with fallbacks, supports --model, and renames WEBP output via Method 1', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gflow-sess-model-'));
  const webpBuf = makeWebpVp8xBuffer(2400, 3200);
  const clickedSelectors = [];
  let modelEvalCalled = false;
  let collectCount = 0;

  const mockRunLabBrowser = async (args) => {
    const sub = args[1];
    if (sub === 'status') return { ok: true, running: true, url: 'https://flow.google.com/project/en-demo' };
    if (sub === 'click') {
      const selector = args[2];
      clickedSelectors.push(selector);
      // Simulate first model selector failing so fallback selector is verified
      if (selector === '.cdk-overlay-container button[aria-haspopup="listbox"]') {
        return { ok: false, error: 'Timeout waiting for selector' };
      }
      return { ok: true, url: 'https://flow.google.com/project/en-demo' };
    }
    if (sub === 'press') return { ok: true };
    if (sub === 'eval') {
      const expr = args[2] || '';
      if (expr.includes('hasWorkspaceControls')) {
        return {
          ok: true,
          result: {
            url: 'https://flow.google.com/project/en-demo',
            title: 'Google Flow',
            text: 'What do you want to create',
            hasWorkspaceControls: true,
            hasPromptTextbox: true,
            visibleCaptcha: false,
          },
        };
      }
      if (expr.includes('mat-dialog-container')) return { ok: true, result: { dismissed: false } };
      if (expr.includes('role="radio"')) return { ok: true, result: { selected: '1:1' } };
      if (expr.includes('role="option"') && expr.includes('nano banana')) {
        modelEvalCalled = true;
        return { ok: true, result: { selected: 'nano banana' } };
      }
      if (expr.includes('insertText')) return { ok: true, result: { ok: true, tag: 'div', length: 16 } };
      if (expr.includes('isGenerating')) {
        collectCount++;
        if (collectCount === 1) {
          return { ok: true, result: { url: 'https://flow.google.com/project/en-demo', isGenerating: false, images: [] } };
        }
        return {
          ok: true,
          result: {
            url: 'https://flow.google.com/project/en-demo',
            isGenerating: false,
            images: [
              { src: 'https://flow.google.com/asb/EN_CAT=s3200-rw', naturalWidth: 2400, naturalHeight: 3200, complete: true, inImageTile: true },
            ],
          },
        };
      }
    }
    if (sub === 'save-image') {
      const outIdx = args.indexOf('-o');
      const outTarget = args[outIdx + 1];
      fs.mkdirSync(path.dirname(outTarget), { recursive: true });
      fs.writeFileSync(outTarget, webpBuf);
      return { ok: true, path: outTarget, width: 2400, height: 3200 };
    }
    return { ok: true };
  };

  let out = '';
  try {
    const cliRes = await cli.runCli(
      ['generate', '8-legged kitten', '--session', 'bv_en', '--aspect', '1:1', '--model', 'Nano Banana', '-o', `${tmpDir}/`],
      {
        runLabBrowser: mockRunLabBrowser,
        pollIntervalMs: 10,
        stdout: { write: (s) => { out += s; } },
      }
    );

    assert.equal(cliRes.exitCode, 0);
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.model, 'Nano Banana');
    assert.equal(modelEvalCalled, true);
    assert.equal(clickedSelectors[0], 'button.settings-trigger-button');
    assert.equal(clickedSelectors[1], '.cdk-overlay-container button[aria-haspopup="listbox"]');
    assert.ok(clickedSelectors.includes('button.generate-icon-button'));
    assert.equal(parsed.images.length, 1);
    assert.equal(parsed.images[0].method, 'session_save_image');
    assert.equal(parsed.images[0].mime, 'image/webp');
    assert.match(parsed.images[0].path, /\.webp$/);
    assert.equal(fs.existsSync(parsed.images[0].path), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
