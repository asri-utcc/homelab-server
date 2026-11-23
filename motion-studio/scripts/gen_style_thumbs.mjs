#!/usr/bin/env node
/**
 * Generate 9:16 style preview thumbnails from the real Remotion `StudioEngine`
 * composition using a single webpack bundle + per-style `renderStill`.
 *
 * Usage:
 *   node scripts/gen_style_thumbs.mjs [--only <id>] [--force] [--custom-only] [--frame <n>] [--scale <float>]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE = path.resolve(__dirname, '..');

const PRESETS_PATH = path.join(BASE, 'assets', 'studio_style_presets.json');
const CUSTOM_PATH = path.join(BASE, 'assets', 'studio_custom_styles.json');
const OUT_DIR = '/home/dev/.gemini/outputs/video-studio/style-thumbs';
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');
const DEFAULT_CHROME_BIN =
  '/home/dev/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';
const CHROME_BIN = process.env.MOTION_CHROME_BIN || DEFAULT_CHROME_BIN;

const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;
const BASE_WIDTH = 1080;
const BASE_HEIGHT = 1920;

const FAMILY_LABELS = {
  'glow-world': 'โลกเรืองแสง · Glow',
  'editorial-paper': 'งานพิมพ์ · Editorial',
  'data-board': 'แดชบอร์ด · Data',
  'kinetic-type': 'ไทโปโมชัน · Kinetic',
  'iso-3d': 'ไอโซเมตริก · Iso 3D',
  'documentary-card': 'สารคดี · Documentary',
};

function parseArgs(argv) {
  const opts = {
    only: [],
    force: false,
    customOnly: false,
    frame: 50,
    scale: 1 / 3,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--force') {
      opts.force = true;
    } else if (arg === '--custom-only') {
      opts.customOnly = true;
    } else if (arg === '--only') {
      const val = argv[++i];
      if (!val) throw new Error('Missing value for --only');
      for (const part of val.split(',')) {
        const trimmed = part.trim();
        if (trimmed) opts.only.push(trimmed);
      }
    } else if (arg.startsWith('--only=')) {
      const val = arg.slice('--only='.length);
      for (const part of val.split(',')) {
        const trimmed = part.trim();
        if (trimmed) opts.only.push(trimmed);
      }
    } else if (arg === '--frame') {
      const val = Number(argv[++i]);
      if (!Number.isInteger(val) || val < 0) {
        throw new Error(`Invalid --frame value: ${argv[i]}`);
      }
      opts.frame = val;
    } else if (arg.startsWith('--frame=')) {
      const val = Number(arg.slice('--frame='.length));
      if (!Number.isInteger(val) || val < 0) {
        throw new Error(`Invalid --frame value: ${arg}`);
      }
      opts.frame = val;
    } else if (arg === '--scale') {
      const val = Number(argv[++i]);
      if (!Number.isFinite(val) || val <= 0 || val > 2) {
        throw new Error(`Invalid --scale value: ${argv[i]}`);
      }
      opts.scale = val;
    } else if (arg.startsWith('--scale=')) {
      const val = Number(arg.slice('--scale='.length));
      if (!Number.isFinite(val) || val <= 0 || val > 2) {
        throw new Error(`Invalid --scale value: ${arg}`);
      }
      opts.scale = val;
    } else if (arg === '-h' || arg === '--help') {
      console.error(
        'Usage: gen_style_thumbs.mjs [--only <id>] [--force] [--custom-only] [--frame <n>] [--scale <float>]',
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return opts;
}

function readStyleFile(filePath, isCustom = false) {
  const result = new Map();
  if (!fs.existsSync(filePath)) return result;

  const rawText = fs.readFileSync(filePath, 'utf8').trim();
  if (!rawText) return result;
  const parsed = JSON.parse(rawText);

  const addItem = (fallbackId, item) => {
    if (!item || typeof item !== 'object') return;
    const id = String(item.id || fallbackId || '').trim();
    if (!id) return;
    result.set(id, { ...item, id, _isCustom: isCustom });
  };

  if (Array.isArray(parsed)) {
    for (const item of parsed) addItem(null, item);
  } else if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.presets)) {
      for (const item of parsed.presets) addItem(null, item);
    } else if (parsed.presets && typeof parsed.presets === 'object') {
      for (const [k, v] of Object.entries(parsed.presets)) addItem(k, v);
    } else if (Array.isArray(parsed.styles)) {
      for (const item of parsed.styles) addItem(null, item);
    } else {
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v === 'object' && ('tokens' in v || 'palette' in v || 'thName' in v)) {
          addItem(k, v);
        }
      }
    }
  }

  return result;
}

function buildInputProps(style, frame) {
  const id = style.id;
  const thName = String(style.thName || style.name || style.enName || id).trim();
  const enName = String(style.enName || style.name || id).trim();
  const summary = String(style.summary || '').trim();
  const category = String(style.category || '').trim();
  const numLabel =
    typeof style.num === 'number' && Number.isFinite(style.num)
      ? `#${String(style.num).padStart(2, '0')}`
      : style._isCustom
        ? 'CUSTOM'
        : 'STYLE';

  const rawTokens = style.tokens && typeof style.tokens === 'object' ? style.tokens : {};
  const family = String(rawTokens.family || 'editorial-paper');
  const styleTokens = {
    ...rawTokens,
    id,
    name: enName || thName,
    family,
  };

  const totalFrames = Math.max(120, frame + 40);
  const badge = enName && enName !== thName ? `${numLabel} · ${enName}` : `${numLabel} · ${family}`;
  const subtitle = summary || enName || 'ตัวอย่างโทนสี ฟอนต์ และเลย์เอาต์สไตล์ภาพ 9:16';

  const familyLabel = FAMILY_LABELS[family] || family;
  const bullets = [];
  if (enName && enName !== thName) bullets.push(enName);
  if (familyLabel) bullets.push(familyLabel);
  if (category && bullets.length < 3) bullets.push(category);
  if (bullets.length < 2) bullets.push('แนวตั้ง 9:16 คมชัด');

  const cueText = summary
    ? `${thName} — ${summary}`
    : `ตัวอย่างสไตล์ ${thName} (${enName})`;

  const scene = {
    id: 'scene-1',
    index: 0,
    badge,
    title: thName,
    subtitle,
    highlight: thName.length <= 18 ? thName : undefined,
    visual: 'title',
    icon: 'spark',
    bullets: bullets.slice(0, 3),
    stat: {
      value: '9:16',
      numericValue: 9,
      unit: 'HD',
      label: enName || thName,
      delta: familyLabel,
      progress: 88,
    },
    startFrame: 0,
    endFrame: totalFrames,
    durationFrames: totalFrames,
    cues: [
      {
        text: cueText,
        highlight: thName,
        startFrame: 0,
        endFrame: totalFrames,
      },
    ],
  };

  return {
    title: thName,
    fps: 30,
    width: BASE_WIDTH,
    height: BASE_HEIGHT,
    totalSec: totalFrames / 30,
    totalFrames,
    styleId: id,
    styleName: thName,
    tokens: styleTokens,
    style: styleTokens,
    scenes: [scene],
    cues: scene.cues,
  };
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return { updatedAt: null, items: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.items && typeof parsed.items === 'object') {
      return parsed;
    }
  } catch (err) {
    console.error(`[thumbs] Warning: failed to parse existing manifest.json: ${err.message}`);
  }
  return { updatedAt: null, items: {} };
}

function writeManifestAtomic(manifest) {
  const tmpPath = path.join(OUT_DIR, `.manifest.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, MANIFEST_PATH);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const catalog = new Map();
  if (!opts.customOnly) {
    for (const [id, st] of readStyleFile(PRESETS_PATH, false)) {
      catalog.set(id, st);
    }
  }
  for (const [id, st] of readStyleFile(CUSTOM_PATH, true)) {
    catalog.set(id, st);
  }

  const rendered = [];
  const skipped = [];
  const failed = [];
  const targets = [];

  if (opts.only.length > 0) {
    const seen = new Set();
    for (const rawId of opts.only) {
      if (seen.has(rawId)) continue;
      seen.add(rawId);
      if (!SAFE_ID_RE.test(rawId)) {
        failed.push({ id: rawId, error: 'Invalid style id format' });
        continue;
      }
      const st = catalog.get(rawId);
      if (!st) {
        failed.push({ id: rawId, error: 'Style not found in catalog' });
        continue;
      }
      targets.push(st);
    }
  } else {
    for (const [id, st] of catalog.entries()) {
      if (!SAFE_ID_RE.test(id)) {
        failed.push({ id, error: 'Invalid style id format' });
        continue;
      }
      targets.push(st);
    }
  }

  const outWidth = Math.round(BASE_WIDTH * opts.scale);
  const outHeight = Math.round(BASE_HEIGHT * opts.scale);
  const manifest = loadManifest();
  const toRender = [];

  for (const st of targets) {
    const finalPath = path.join(OUT_DIR, `${st.id}.jpg`);
    if (!opts.force && fs.existsSync(finalPath)) {
      const stat = fs.statSync(finalPath);
      if (stat.size > 0) {
        skipped.push(st.id);
        if (!manifest.items[st.id]) {
          manifest.items[st.id] = {
            file: `${st.id}.jpg`,
            mtime: Math.floor(stat.mtimeMs),
            width: outWidth,
            height: outHeight,
          };
        }
        continue;
      }
    }
    toRender.push(st);
  }

  let serveUrl = null;
  try {
    if (toRender.length > 0) {
      if (!fs.existsSync(CHROME_BIN)) {
        throw new Error(`chrome-headless-shell not found at ${CHROME_BIN}`);
      }
      console.error(
        `[thumbs] Bundling Remotion StudioEngine once for ${toRender.length} style(s) (frame=${opts.frame}, scale=${opts.scale.toFixed(4)})...`,
      );
      serveUrl = await bundle({
        entryPoint: path.join(BASE, 'src', 'index.ts'),
        onProgress: (p) => {
          if (p === 100) console.error('[thumbs] Bundle ready (100%)');
        },
      });

      const chromiumOptions = { gl: 'angle' };

      for (let i = 0; i < toRender.length; i++) {
        const st = toRender[i];
        const finalPath = path.join(OUT_DIR, `${st.id}.jpg`);
        const tmpPath = path.join(OUT_DIR, `.${st.id}.${process.pid}.${Date.now()}.tmp.jpg`);
        try {
          const inputProps = buildInputProps(st, opts.frame);
          const composition = await selectComposition({
            serveUrl,
            id: 'StudioEngine',
            inputProps,
            browserExecutable: CHROME_BIN,
            chromiumOptions,
          });

          await renderStill({
            composition,
            serveUrl,
            output: tmpPath,
            frame: opts.frame,
            inputProps,
            imageFormat: 'jpeg',
            jpegQuality: 82,
            scale: opts.scale,
            browserExecutable: CHROME_BIN,
            chromiumOptions,
          });

          fs.renameSync(tmpPath, finalPath);
          const stat = fs.statSync(finalPath);
          manifest.items[st.id] = {
            file: `${st.id}.jpg`,
            mtime: Math.floor(stat.mtimeMs),
            width: outWidth,
            height: outHeight,
          };
          rendered.push(st.id);
          console.error(
            `[thumbs] (${i + 1}/${toRender.length}) Rendered ${st.id}.jpg (${stat.size} bytes)`,
          );
        } catch (err) {
          try {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
          } catch {
            // ignore cleanup error
          }
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[thumbs] Failed ${st.id}: ${msg}`);
          failed.push({ id: st.id, error: msg });
        }
      }
    }
  } finally {
    if (serveUrl && serveUrl.startsWith(os.tmpdir())) {
      try {
        fs.rmSync(serveUrl, { recursive: true, force: true });
      } catch {
        // ignore temp cleanup error
      }
    }
  }

  manifest.updatedAt = new Date().toISOString();
  writeManifestAtomic(manifest);

  const summary = {
    ok: failed.length === 0,
    rendered,
    skipped,
    failed,
  };
  process.stdout.write(JSON.stringify(summary) + '\n');
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[thumbs] Fatal error: ${msg}`);
  process.stdout.write(
    JSON.stringify({ ok: false, rendered: [], skipped: [], failed: [{ id: '*', error: msg }] }) +
      '\n',
  );
  process.exit(1);
});
