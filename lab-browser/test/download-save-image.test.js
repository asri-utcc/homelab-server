'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const core = require('../lib/browser-core');
const { executeAction } = require('../lib/actions');

// Minimal valid 1x1 PNG (67 bytes)
const PNG_1X1_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG_1X1_BUF = Buffer.from(PNG_1X1_BASE64, 'base64');
const JPEG_MAGIC_BUF = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const WEBP_MAGIC_BUF = Buffer.from([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x24, 0x00, 0x00, 0x00, // size
  0x57, 0x45, 0x42, 0x50, // WEBP
  0x56, 0x50, 0x38, 0x20, // VP8
]);
const GIF_MAGIC_BUF = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
  0x02, 0x00, // width = 2
  0x03, 0x00, // height = 3
]);

function makeMockTelemetry() {
  return {
    clear() {},
    summary() {
      return {
        consoleErrorCount: 0,
        pageErrorCount: 0,
        failedRequestCount: 0,
        consoleErrors: [],
        pageErrors: [],
        failedRequests: [],
      };
    },
  };
}

test('browser-core: buildContextOptions enables acceptDownloads', () => {
  const { ctxOpts } = core.buildContextOptions({}, '130.0.0.0');
  assert.equal(ctxOpts.acceptDownloads, true);
});

test('browser-core: validateSafeOutputPath permits allowed roots and blocks traversal/outside paths', () => {
  assert.equal(
    core.validateSafeOutputPath('/home/dev/.gemini/outputs/browser/test.png'),
    '/home/dev/.gemini/outputs/browser/test.png'
  );
  assert.equal(
    core.validateSafeOutputPath('/home/dev/projects/tmp-img/a.jpg'),
    '/home/dev/projects/tmp-img/a.jpg'
  );
  assert.equal(
    core.validateSafeOutputPath('/tmp/lab-browser-safe.webp'),
    '/tmp/lab-browser-safe.webp'
  );

  // Blocked paths & path traversal attempts
  assert.throws(() => core.validateSafeOutputPath('/etc/passwd'), /unsafe output path/i);
  assert.throws(() => core.validateSafeOutputPath('/tmp/../etc/passwd'), /unsafe output path/i);
  assert.throws(() => core.validateSafeOutputPath('/home/dev/.gemini/../.ssh/id_rsa'), /unsafe output path/i);
  assert.throws(() => core.validateSafeOutputPath('/tmp2/evil.png'), /unsafe output path/i);
  assert.throws(() => core.validateSafeOutputPath('/home/dev/.gemini'), /unsafe output path/i);
  assert.throws(() => core.validateSafeOutputPath(''), /non-empty string/i);
  assert.throws(() => core.validateSafeOutputPath('/tmp/bad\0.png'), /null byte/i);
});

test('browser-core: detectImageMagic identifies PNG/JPEG/WEBP/GIF and rejects invalid HTML/text', () => {
  assert.deepEqual(core.detectImageMagic(PNG_1X1_BUF), { mime: 'image/png', ext: 'png' });
  assert.deepEqual(core.detectImageMagic(JPEG_MAGIC_BUF), { mime: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(core.detectImageMagic(WEBP_MAGIC_BUF), { mime: 'image/webp', ext: 'webp' });
  assert.deepEqual(core.detectImageMagic(GIF_MAGIC_BUF), { mime: 'image/gif', ext: 'gif' });

  assert.equal(core.detectImageMagic(Buffer.from('<!DOCTYPE html><html><body>Error 403</body></html>')), null);
  assert.equal(core.detectImageMagic(Buffer.from('{"error":"unauthorized"}')), null);
  assert.equal(core.detectImageMagic(Buffer.from('ab')), null);
  assert.equal(core.detectImageMagic(null), null);
});

test('actions: download waits for download event, saves file, notifies AI action, and returns metadata', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-browser-dl-'));
  const outPath = path.join(tmpDir, 'cat8legs.png');
  const aiEvents = [];

  try {
    let clicked = false;
    const mockLocator = {
      async waitFor() {},
      async boundingBox() { return { x: 10, y: 20, width: 100, height: 40 }; },
      async evaluate() { return 'Download'; },
      async click() { clicked = true; },
    };

    const mockDownload = {
      suggestedFilename() { return '../unsafe/cat_8_legs.png'; },
      async saveAs(dest) {
        fs.writeFileSync(dest, PNG_1X1_BUF);
      },
    };

    const mockPage = {
      url() { return 'https://labs.google/fx/tools/flow'; },
      locator() { return { first: () => mockLocator }; },
      async waitForEvent(eventName) {
        assert.equal(eventName, 'download');
        return mockDownload;
      },
      mouse: { async move() {} },
    };

    const res = await executeAction(mockPage, makeMockTelemetry(), 'download', ['@e7'], {
      out: outPath,
      timeoutMs: 5000,
      onAiAction: (evt) => aiEvents.push(evt),
    });

    assert.equal(clicked, true);
    assert.equal(res.ok, true);
    assert.equal(res.action, 'download');
    assert.equal(res.path, outPath);
    assert.equal(res.suggestedFilename, '../unsafe/cat_8_legs.png');
    assert.equal(res.sizeBytes, PNG_1X1_BUF.length);
    assert.equal(res.url, 'https://labs.google/fx/tools/flow');
    assert.equal(typeof res.elapsedMs, 'number');
    assert.equal(fs.existsSync(outPath), true);
    assert.equal(aiEvents.length, 1);
    assert.equal(aiEvents[0].action, 'click');

    // Reject unsafe output path before clicking
    await assert.rejects(
      () => executeAction(mockPage, makeMockTelemetry(), 'download', ['@e7'], { out: '/etc/evil.png' }),
      /unsafe output path/i
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('actions: save-image handles data:image/png URL directly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-browser-img-'));
  const outPath = path.join(tmpDir, 'from-data.png');

  try {
    const dataUrl = `data:image/png;base64,${PNG_1X1_BASE64}`;
    const mockPage = {
      url() { return 'https://example.test/'; },
    };

    const res = await executeAction(mockPage, makeMockTelemetry(), 'save-image', [dataUrl], {
      out: outPath,
    });

    assert.equal(res.ok, true);
    assert.equal(res.action, 'save-image');
    assert.equal(res.path, outPath);
    assert.equal(res.mime, 'image/png');
    assert.equal(res.ext, 'png');
    assert.equal(res.sizeBytes, PNG_1X1_BUF.length);
    assert.equal(res.width, 1);
    assert.equal(res.height, 1);
    assert.equal(Buffer.compare(fs.readFileSync(outPath), PNG_1X1_BUF), 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('actions: save-image fetches https URL via context.request.get and rejects HTML error bodies', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-browser-img-'));
  const outPath = path.join(tmpDir, 'from-https.jpg');

  try {
    let requestedUrl = null;
    const mockPage = {
      url() { return 'https://labs.google/fx/tools/flow'; },
      context() {
        return {
          request: {
            async get(url) {
              requestedUrl = url;
              if (url.includes('html-error')) {
                return {
                  ok: () => true,
                  status: () => 200,
                  body: async () => Buffer.from('<html><body>Login Required</body></html>'),
                };
              }
              return {
                ok: () => true,
                status: () => 200,
                body: async () => JPEG_MAGIC_BUF,
              };
            },
          },
        };
      },
    };

    const res = await executeAction(
      mockPage,
      makeMockTelemetry(),
      'save-image',
      ['https://lh3.googleusercontent.com/sample-image'],
      { out: outPath, timeoutMs: 5000 }
    );

    assert.equal(requestedUrl, 'https://lh3.googleusercontent.com/sample-image');
    assert.equal(res.ok, true);
    assert.equal(res.action, 'save-image');
    assert.equal(res.path, outPath);
    assert.equal(res.mime, 'image/jpeg');
    assert.equal(res.ext, 'jpg');
    assert.equal(res.sizeBytes, JPEG_MAGIC_BUF.length);
    assert.equal(res.sourceUrl, 'https://lh3.googleusercontent.com/sample-image');

    await assert.rejects(
      () => executeAction(
        mockPage,
        makeMockTelemetry(),
        'save-image',
        ['https://lh3.googleusercontent.com/html-error'],
        { out: path.join(tmpDir, 'bad.jpg') }
      ),
      /not a valid image/i
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('actions: save-image extracts image from element locator (img src and canvas fallback)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-browser-img-'));
  const outPath1 = path.join(tmpDir, 'locator-img.png');
  const outPath2 = path.join(tmpDir, 'locator-canvas-fallback.png');

  try {
    // Case 1: <img> element whose src is fetched via context.request.get
    const mockImgLocator = {
      async waitFor() {},
      async evaluate() {
        return {
          tag: 'img',
          sourceUrl: 'https://storage.googleapis.com/flow-out/cat.png',
          width: 1024,
          height: 1024,
        };
      },
    };

    const mockPage1 = {
      url() { return 'https://labs.google/fx/tools/flow'; },
      locator() { return { first: () => mockImgLocator }; },
      context() {
        return {
          request: {
            async get() {
              return {
                ok: () => true,
                status: () => 200,
                body: async () => PNG_1X1_BUF,
              };
            },
          },
        };
      },
    };

    const res1 = await executeAction(mockPage1, makeMockTelemetry(), 'save-image', ['img.result'], {
      out: outPath1,
    });
    assert.equal(res1.ok, true);
    assert.equal(res1.mime, 'image/png');
    assert.equal(res1.width, 1024);
    assert.equal(res1.height, 1024);
    assert.equal(res1.sourceUrl, 'https://storage.googleapis.com/flow-out/cat.png');

    // Case 2: <img> whose fetch fails, falling back to in-page canvas draw
    let evalCall = 0;
    const mockFallbackLocator = {
      async waitFor() {},
      async evaluate() {
        evalCall++;
        if (evalCall === 1) {
          return {
            tag: 'img',
            sourceUrl: 'https://restricted.example/cat.png',
            width: 512,
            height: 512,
          };
        }
        return {
          dataUrl: `data:image/png;base64,${PNG_1X1_BASE64}`,
          width: 512,
          height: 512,
        };
      },
    };

    const mockPage2 = {
      url() { return 'https://labs.google/fx/tools/flow'; },
      locator() { return { first: () => mockFallbackLocator }; },
      context() {
        return {
          request: {
            async get() {
              throw new Error('403 Forbidden');
            },
          },
        };
      },
      async evaluate() {
        throw new Error('CORS blocked');
      },
    };

    const res2 = await executeAction(mockPage2, makeMockTelemetry(), 'save-image', ['@e12'], {
      out: outPath2,
    });
    assert.equal(res2.ok, true);
    assert.equal(res2.mime, 'image/png');
    assert.equal(res2.width, 512);
    assert.equal(res2.height, 512);
    assert.equal(fs.existsSync(outPath2), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
