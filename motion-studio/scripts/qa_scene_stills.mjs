#!/usr/bin/env node
/**
 * QA: render one still per scene (at ~60% of each scene) from a props.json,
 * optionally overriding the style, then build a contact sheet with ffmpeg.
 * Usage: node scripts/qa_scene_stills.mjs <props.json> <outDir> [--style look-8] [--at 0.6]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

const BASE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME_BIN =
  process.env.MOTION_CHROME_BIN ||
  '/home/dev/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';

const [propsPath, outDir, ...rest] = process.argv.slice(2);
if (!propsPath || !outDir) {
  console.error('usage: qa_scene_stills.mjs <props.json> <outDir> [--style id] [--at 0.6] [--scale 0.5]');
  process.exit(2);
}
let style = null;
let at = 0.6;
let scale = 0.5;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--style') style = rest[++i];
  else if (rest[i] === '--at') at = Number(rest[++i]);
  else if (rest[i] === '--scale') scale = Number(rest[++i]);
}
const props = JSON.parse(fs.readFileSync(propsPath, 'utf8'));
if (style) {
  const presets = JSON.parse(fs.readFileSync(path.join(BASE, 'assets', 'studio_style_presets.json'), 'utf8')).presets;
  const list = Array.isArray(presets) ? presets : Object.values(presets);
  const p = list.find((x) => x.id === style);
  if (!p) throw new Error(`unknown style ${style}`);
  props.styleId = style;
  props.style = p.tokens;
  props.tokens = p.tokens;
}
fs.mkdirSync(outDir, { recursive: true });
const chromiumOptions = { gl: 'angle' };
const serveUrl = await bundle({ entryPoint: path.join(BASE, 'src', 'index.ts') });
const composition = await selectComposition({ serveUrl, id: 'StudioEngine', inputProps: props, browserExecutable: CHROME_BIN, chromiumOptions });
const files = [];
for (const [i, sc] of props.scenes.entries()) {
  const frame = Math.round(sc.startFrame + (sc.endFrame - sc.startFrame) * at);
  const out = path.join(outDir, `scene_${String(i + 1).padStart(2, '0')}.png`);
  await renderStill({ composition, serveUrl, output: out, frame, inputProps: props, scale, browserExecutable: CHROME_BIN, chromiumOptions });
  files.push(out);
  console.error(`[qa] scene ${i + 1} frame ${frame} -> ${out}`);
}
const cols = Math.min(4, files.length);
const sheet = path.join(outDir, 'contact.jpg');
const inputs = files.flatMap((f) => ['-i', f]);
const filter = `${files.map((_, i) => `[${i}:v]scale=360:-1[v${i}]`).join(';')};${files.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${files.length}:layout=${files
  .map((_, i) => `${(i % cols) * 360}_${Math.floor(i / cols) * 640}`)
  .join('|')}:fill=white`;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-q:v', '3', sheet]);
console.log(sheet);

if (serveUrl.startsWith(os.tmpdir())) fs.rmSync(serveUrl, { recursive: true, force: true });
