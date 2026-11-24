import React from 'react';
import { interpolate, spring } from 'remotion';
import { THAI_FONT_FAMILY, THAI_HAND_FAMILY } from '../../components/ThaiFontLoader';
import { splitThaiWords } from '../families';
import type { StudioScene } from '../types';
import {
  FitText,
  SAFE_BOTTOM,
  STAGE_H,
  STAGE_W,
  clamp01,
  easeOutCubic,
  sceneTexts,
} from './kit';
import type { StyleDirectorDef, StyleShotArgs } from './types';

// ============================================================================
// SHARED HELPERS FOR BATCH O
// look-42: Magazine Layout and Note (หน้านิตยสารกับโน้ต)
// look-43: Blue Editorial (บลูเอดิทอเรียล)
// Pure, Deterministic, Inline SVG/CSS Only, Zero External Assets
// Safe stage bounds: x ∈ [54, 1026], y ∈ [112, CONTENT_BOTTOM (=1420)]
// ============================================================================

const CONTENT_BOTTOM = SAFE_BOTTOM - 120; // 1420
const SAFE_X = 54;
const SAFE_TOP = 112;
const SAFE_W = STAGE_W - SAFE_X * 2; // 972
const SAFE_H = CONTENT_BOTTOM - SAFE_TOP; // 1308

const FONT_THAI = THAI_FONT_FAMILY;
const FONT_SERIF_O = `'Noto Serif Thai', 'Bodoni Moda', Georgia, ${FONT_THAI}, serif`;
const FONT_HAND_O = THAI_HAND_FAMILY;
const FONT_EDITORIAL_SERIF_O = `'Instrument Serif', 'Noto Serif Thai', Georgia, ${FONT_THAI}, serif`;
const FONT_EDITORIAL_SANS_O = `'Schibsted Grotesk', ${FONT_THAI}, sans-serif`;
const FONT_MONO_O = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

// Hardcoded palettes from assets/styles_catalog.json & signatures.tsx
const LOOK42 = {
  paper: '#F4F5F7',
  paperCool: '#EAEDED',
  ink: '#1B1E25',
  inkBody: '#343A46',
  inkMuted: '#636B78',
  rule: 'rgba(27, 30, 37, 0.22)',
  ruleStrong: '#1B1E25',
  red: '#EF4444',
  redDeep: '#C42E26',
  duoDark: '#242E46',
  duoMid: '#4A5B7B',
  duoSoft: '#95A7C2',
  duoLight: '#E2E7EC',
} as const;

const LOOK43 = {
  blue: '#2433F0',
  white: '#F4F5FA',
  whiteSoft: 'rgba(244, 245, 250, 0.82)',
  rule: 'rgba(244, 245, 250, 0.55)',
  ruleLight: 'rgba(244, 245, 250, 0.28)',
} as const;

function seededHashO(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function haystackOfO(scene: StudioScene): string {
  const t = sceneTexts(scene);
  const hl = Array.isArray(scene.highlight) ? scene.highlight.join(' ') : String(scene.highlight || '');
  return [
    t.badge,
    t.title,
    t.subtitle,
    hl,
    ...t.bullets,
    scene.stat?.label || '',
    scene.stat?.delta || '',
    scene.quote?.text || '',
    scene.compare?.leftTitle || '',
    scene.compare?.rightTitle || '',
  ].join(' ');
}

function extractPointsO(scene: StudioScene, max = 4): string[] {
  const t = sceneTexts(scene);
  const out: string[] = [];

  if (Array.isArray(scene.steps) && scene.steps.length > 0) {
    for (const s of scene.steps) {
      if (typeof s === 'string') {
        if (s.trim()) out.push(s.trim());
      } else if (s?.title) {
        out.push(s.detail ? `${s.title} — ${s.detail}` : s.title);
      }
    }
  } else if (t.bullets.length > 0) {
    out.push(...t.bullets);
  } else if (scene.compare) {
    const combined = [...(scene.compare.leftItems || []), ...(scene.compare.rightItems || [])];
    for (const item of combined) {
      const clean = String(item || '').trim();
      if (clean) out.push(clean);
    }
  } else if (scene.stat) {
    if (scene.stat.label) out.push(scene.stat.label);
    if (scene.stat.delta) out.push(scene.stat.delta);
    if (t.subtitle) out.push(t.subtitle);
  } else if (scene.quote?.text) {
    out.push(scene.quote.text);
    if (scene.quote.author) out.push(`— ${scene.quote.author}`);
  } else if (t.subtitle) {
    out.push(t.subtitle);
  }

  if (out.length === 0 && t.title) out.push(t.title);
  return out.slice(0, max);
}

function parseNumericO(raw: string | number | undefined, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw || '').replace(/,/g, '');
  const m = s.match(/\d+(?:\.\d+)?/);
  if (!m) return fallback;
  const val = parseFloat(m[0]);
  return Number.isFinite(val) ? val : fallback;
}

function extractPrimaryMetricO(
  scene: StudioScene,
  fallbackNum = 92,
  fallbackUnit = '%',
): { big: string; unit: string; numeric: number; label: string; delta: string; progress: number } {
  const t = sceneTexts(scene);
  if (scene.stat?.value !== undefined && String(scene.stat.value).trim()) {
    const rawVal = String(scene.stat.value).trim();
    const prefix = String(scene.stat.prefix || '').trim();
    const suffix = String(scene.stat.suffix || '').trim();
    const effPrefix = prefix && !rawVal.startsWith(prefix) ? prefix : '';
    const effSuffix = suffix && !rawVal.endsWith(suffix) ? suffix : '';
    const big = `${effPrefix}${rawVal}${effSuffix}`.trim();
    const numeric = scene.stat.numericValue ?? parseNumericO(rawVal, fallbackNum);
    const prog =
      typeof scene.stat.progress === 'number' && Number.isFinite(scene.stat.progress)
        ? clamp01(scene.stat.progress / 100)
        : numeric > 0 && numeric <= 100
          ? clamp01(numeric / 100)
          : 0.86;
    return {
      big,
      unit: String(scene.stat.unit || '').trim(),
      numeric,
      label: String(scene.stat.label || t.subtitle || t.title).trim(),
      delta: String(scene.stat.delta || '').trim(),
      progress: prog,
    };
  }
  if (t.numbers.length > 0) {
    const first = t.numbers[0];
    const numeric = parseNumericO(first, fallbackNum);
    return {
      big: first,
      unit: '',
      numeric,
      label: t.subtitle || t.title,
      delta: t.badge || '',
      progress: numeric > 0 && numeric <= 100 ? clamp01(numeric / 100) : 0.82,
    };
  }
  return {
    big: `${fallbackNum}${fallbackUnit}`,
    unit: '',
    numeric: fallbackNum,
    label: t.title || t.subtitle || 'ตัวเลขสำคัญ',
    delta: t.badge || '',
    progress: 0.9,
  };
}

function extractHighlightO(scene: StudioScene): string {
  const t = sceneTexts(scene);
  if (Array.isArray(scene.highlight)) {
    const first = scene.highlight.map((s) => String(s || '').trim()).find(Boolean);
    if (first) return first;
  } else if (typeof scene.highlight === 'string' && scene.highlight.trim()) {
    return scene.highlight.trim();
  }
  if (t.badge) return t.badge;
  const words = splitThaiWords(t.title || t.subtitle || '');
  if (words.length >= 2) {
    return words.slice(Math.max(0, words.length - 2)).join('').trim();
  }
  return t.title || 'ประเด็นสำคัญ';
}

function splitHeadlineTwoLinesO(title: string, fallbackSecond = ''): [string, string] {
  const clean = String(title || '').trim();
  if (!clean) return [fallbackSecond || 'บทความพิเศษ', ''];
  if (clean.includes('\n')) {
    const parts = clean.split('\n').map((s) => s.trim()).filter(Boolean);
    return [parts[0] || clean, parts.slice(1).join(' ')];
  }
  const words = splitThaiWords(clean).filter((w) => w.length > 0);
  if (words.length <= 2 || clean.length <= 13) {
    return [clean, fallbackSecond];
  }
  const target = Math.floor(clean.length * 0.48);
  let bestIdx = 1;
  let bestDiff = Infinity;
  let acc = 0;
  for (let i = 0; i < words.length - 1; i++) {
    acc += words[i].length;
    const diff = Math.abs(acc - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i + 1;
    }
  }
  const line1 = words.slice(0, bestIdx).join('').trim();
  const line2 = words.slice(bestIdx).join('').trim();
  return [line1 || clean, line2 || fallbackSecond];
}

function tokenizeManifestoWordsO(text: string): string[] {
  const clean = String(text || '').trim();
  if (!clean) return [];
  const raw = splitThaiWords(clean);
  const merged: string[] = [];
  for (const tok of raw) {
    if (!tok) continue;
    // Keep spaces attached to previous token so spacing renders naturally
    if (/^\s+$/.test(tok)) {
      if (merged.length > 0) {
        merged[merged.length - 1] += ' ';
      }
      continue;
    }
    merged.push(tok);
  }
  // If overly fragmented (> 22 words), merge short pairs so choreography stays crisp
  if (merged.length > 22) {
    const compact: string[] = [];
    for (let i = 0; i < merged.length; i += 2) {
      compact.push(merged[i] + (merged[i + 1] || ''));
    }
    return compact;
  }
  return merged;
}

// ============================================================================
// LOOK-42: MAGAZINE LAYOUT AND NOTE — SHARED PRIMITIVES
// Cool off-white paper (#F4F5F7 / #EAEDED), near-black serif ink (#1B1E25),
// duotone dusk plate (#242E46 -> #E2E7EC), red ballpoint notes (#EF4444 / #C42E26)
// Zero drop shadows, zero curled corners, zero cream/sepia tones
// ============================================================================

const Look42PaperStage: React.FC<{
  sceneIndex: number;
  badge?: string;
  sectionLabel: string;
  localFrame: number;
  children: React.ReactNode;
}> = ({ sceneIndex, badge, sectionLabel, localFrame, children }) => {
  const ruleDraw = easeOutCubic(clamp01(localFrame / 14));
  const patternId = `look42-grain-${sceneIndex}`;
  const pageNo = String(sceneIndex + 1).padStart(2, '0');
  const issueText = badge ? badge : sectionLabel;

  // Deterministic paper fibers (fine archival hairlines across full page)
  const fibers = Array.from({ length: 26 }, (_, i) => {
    const x1 = Math.round(seededHashO(sceneIndex * 101 + i * 7 + 1) * STAGE_W);
    const y1 = Math.round(seededHashO(sceneIndex * 101 + i * 7 + 2) * STAGE_H);
    const len = 18 + Math.round(seededHashO(sceneIndex * 101 + i * 7 + 3) * 44);
    const ang = (seededHashO(sceneIndex * 101 + i * 7 + 4) - 0.5) * Math.PI;
    const x2 = Math.round(x1 + Math.cos(ang) * len);
    const y2 = Math.round(y1 + Math.sin(ang) * len);
    const op = 0.035 + seededHashO(sceneIndex * 101 + i * 7 + 5) * 0.045;
    return { x1, y1, x2, y2, op };
  });

  // Deterministic stipple dots inside tile pattern (zero flicker, lightweight)
  const grainDots = Array.from({ length: 34 }, (_, i) => {
    const cx = Math.round(seededHashO(i * 19 + 3) * 120);
    const cy = Math.round(seededHashO(i * 19 + 7) * 120);
    const r = 0.6 + seededHashO(i * 19 + 11) * 0.8;
    const op = 0.03 + seededHashO(i * 19 + 13) * 0.045;
    return { cx, cy, r, op };
  });

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: LOOK42.paper,
        backgroundImage: `linear-gradient(180deg, ${LOOK42.paper} 0%, ${LOOK42.paperCool} 100%)`,
        overflow: 'hidden',
      }}
    >
      {/* Subtle cool paper texture: deterministic dot pattern + delicate archival fibers */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        <defs>
          <pattern id={patternId} width="120" height="120" patternUnits="userSpaceOnUse">
            {grainDots.map((d, idx) => (
              <circle
                key={idx}
                cx={d.cx}
                cy={d.cy}
                r={d.r}
                fill={LOOK42.duoDark}
                fillOpacity={d.op.toFixed(3)}
              />
            ))}
          </pattern>
        </defs>
        <rect width={STAGE_W} height={STAGE_H} fill={`url(#${patternId})`} />
        {fibers.map((f, idx) => (
          <line
            key={idx}
            x1={f.x1}
            y1={f.y1}
            x2={f.x2}
            y2={f.y2}
            stroke={LOOK42.duoDark}
            strokeWidth={0.8}
            strokeOpacity={f.op.toFixed(3)}
          />
        ))}
      </svg>

      {/* Safe Editorial Stage: x ∈ [54, 1026], y ∈ [112, 1420] */}
      <div
        style={{
          position: 'absolute',
          top: SAFE_TOP,
          left: SAFE_X,
          width: SAFE_W,
          height: SAFE_H,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Top Magazine Folio + Thin Editorial Rule */}
        <div style={{ flexShrink: 0, marginBottom: 18 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 16,
              marginBottom: 8,
            }}
          >
            <div
              style={{
                fontFamily: FONT_THAI,
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: '0.06em',
                color: LOOK42.inkMuted,
                lineHeight: 1.35,
                maxWidth: 680,
              }}
            >
              {issueText}
            </div>
            <div
              style={{
                fontFamily: FONT_MONO_O,
                fontSize: 16,
                fontWeight: 600,
                letterSpacing: '0.12em',
                color: LOOK42.inkMuted,
                flexShrink: 0,
              }}
            >
              NO. {pageNo} · EDITORIAL
            </div>
          </div>
          <div
            style={{
              width: '100%',
              height: 2,
              backgroundColor: LOOK42.ruleStrong,
              transform: `scaleX(${ruleDraw.toFixed(4)})`,
              transformOrigin: 'left center',
            }}
          />
          <div
            style={{
              width: '100%',
              height: 1,
              marginTop: 3,
              backgroundColor: LOOK42.rule,
              transform: `scaleX(${ruleDraw.toFixed(4)})`,
              transformOrigin: 'left center',
            }}
          />
        </div>

        {/* Main shot content strictly contained inside remaining height */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

/** Line rise reveal with spring overshoot; removes overflow clip once settled so Thai vowels never clip */
const Look42MaskRise: React.FC<{
  localFrame: number;
  fps: number;
  delay?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ localFrame, fps, delay = 0, children, style }) => {
  const s = spring({
    frame: Math.max(0, localFrame - delay),
    fps,
    config: { damping: 14, stiffness: 170, mass: 0.9 },
  });
  const settled = localFrame >= delay + 26;
  const y = settled ? 0 : interpolate(s, [0, 1], [46, 0]);
  const visible = localFrame >= delay - 1;
  return (
    <div
      style={{
        overflow: settled ? 'visible' : 'hidden',
        paddingTop: 6,
        paddingBottom: 6,
        marginTop: -6,
        marginBottom: -6,
        ...style,
      }}
    >
      <div
        style={{
          visibility: visible ? 'visible' : 'hidden',
          transform: `translate3d(0, ${y.toFixed(2)}px, 0)`,
        }}
      >
        {children}
      </div>
    </div>
  );
};

/** Procedural Duotone Editorial Artwork (#242E46 -> #E2E7EC, dusk sea / sun / clouds / shimmer) */
const Look42DuotoneArt: React.FC<{
  width: number;
  height: number;
  localFrame: number;
  durationFrames: number;
  seed: number;
  variant?: 'sea' | 'arch' | 'horizon';
}> = ({ width, height, localFrame, durationFrames, seed, variant = 'sea' }) => {
  const reveal = easeOutCubic(clamp01((localFrame + 4) / 22));
  const zoomSettle = interpolate(easeOutCubic(clamp01(localFrame / 28)), [0, 1], [1.08, 1.0]);
  const slowDrift = interpolate(localFrame, [0, Math.max(1, durationFrames)], [0, -10], {
    extrapolateRight: 'clamp',
  });
  const clipTop = Math.max(0, (1 - reveal) * 100);
  const gradId = `look42-duo-sky-${seed}-${variant}`;
  const waterGradId = `look42-duo-water-${seed}-${variant}`;
  const grainId = `look42-duo-grain-${seed}-${variant}`;

  const stipple = Array.from({ length: 42 }, (_, i) => ({
    x: seededHashO(seed * 31 + i * 5 + 1) * 100,
    y: seededHashO(seed * 31 + i * 5 + 2) * 100,
    r: 0.45 + seededHashO(seed * 31 + i * 5 + 3) * 0.65,
    op: 0.14 + seededHashO(seed * 31 + i * 5 + 4) * 0.22,
  }));

  const shimmerLines = Array.from({ length: 14 }, (_, i) => {
    const t = i / 13;
    const y = height * (0.61 + t * 0.34);
    const w = width * (0.36 - t * 0.22 + seededHashO(seed + i * 11) * 0.08);
    const cx = width * 0.52 + (seededHashO(seed + i * 17) - 0.5) * 26;
    return { x: cx - w / 2, y, w, op: 0.55 - t * 0.32 };
  });

  return (
    <div
      style={{
        width,
        height,
        position: 'relative',
        overflow: 'hidden',
        clipPath: clipTop > 0.2 ? `inset(${clipTop.toFixed(2)}% 0% 0% 0%)` : 'none',
        backgroundColor: LOOK42.duoDark,
      }}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{
          display: 'block',
          transform: `scale(${zoomSettle.toFixed(4)}) translateY(${slowDrift.toFixed(2)}px)`,
          transformOrigin: 'center center',
        }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={LOOK42.duoDark} />
            <stop offset="48%" stopColor={LOOK42.duoMid} />
            <stop offset="100%" stopColor={LOOK42.duoLight} />
          </linearGradient>
          <linearGradient id={waterGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={LOOK42.duoSoft} />
            <stop offset="32%" stopColor={LOOK42.duoMid} />
            <stop offset="100%" stopColor={LOOK42.duoDark} />
          </linearGradient>
          <pattern id={grainId} width="100" height="100" patternUnits="userSpaceOnUse">
            {stipple.map((s, idx) => (
              <circle
                key={idx}
                cx={s.x}
                cy={s.y}
                r={s.r}
                fill={idx % 2 === 0 ? LOOK42.duoLight : LOOK42.duoDark}
                fillOpacity={s.op.toFixed(2)}
              />
            ))}
          </pattern>
        </defs>

        {/* Sky field */}
        <rect width={width} height={height} fill={`url(#${gradId})`} />

        {variant === 'sea' && (
          <>
            {/* Pale duotone dusk sun disk */}
            <circle cx={width * 0.52} cy={height * 0.42} r={Math.min(width, height) * 0.16} fill={LOOK42.duoLight} fillOpacity={0.92} />
            {/* Broken horizontal cloud strata across the sun */}
            <rect x={width * 0.08} y={height * 0.36} width={width * 0.56} height={10} rx={5} fill={LOOK42.duoDark} fillOpacity={0.42} />
            <rect x={width * 0.36} y={height * 0.43} width={width * 0.58} height={8} rx={4} fill={LOOK42.duoDark} fillOpacity={0.5} />
            <rect x={width * 0.14} y={height * 0.24} width={width * 0.42} height={7} rx={3.5} fill={LOOK42.duoLight} fillOpacity={0.28} />
            {/* Sea plane */}
            <rect x={0} y={height * 0.58} width={width} height={height * 0.42} fill={`url(#${waterGradId})`} />
            {/* Horizon hairline */}
            <line x1={0} y1={height * 0.58} x2={width} y2={height * 0.58} stroke={LOOK42.duoLight} strokeWidth={1.5} strokeOpacity={0.75} />
            {/* Shimmer path on water */}
            {shimmerLines.map((l, idx) => (
              <rect
                key={idx}
                x={l.x}
                y={l.y}
                width={l.w}
                height={3.2}
                rx={1.6}
                fill={LOOK42.duoLight}
                fillOpacity={l.op.toFixed(2)}
              />
            ))}
          </>
        )}

        {variant === 'arch' && (
          <>
            {/* Editorial architectural silhouette in duotone */}
            <circle cx={width * 0.72} cy={height * 0.28} r={Math.min(width, height) * 0.14} fill={LOOK42.duoLight} fillOpacity={0.86} />
            <path
              d={`M 0 ${height} L 0 ${height * 0.44} L ${width * 0.34} ${height * 0.34} L ${width * 0.34} ${height} Z`}
              fill={LOOK42.duoDark}
              fillOpacity={0.88}
            />
            <path
              d={`M ${width * 0.38} ${height} L ${width * 0.38} ${height * 0.52} Q ${width * 0.62} ${height * 0.22} ${width * 0.86} ${height * 0.52} L ${width * 0.86} ${height} Z`}
              fill={LOOK42.duoMid}
              fillOpacity={0.84}
            />
            <path
              d={`M ${width * 0.5} ${height} L ${width * 0.5} ${height * 0.62} Q ${width * 0.62} ${height * 0.45} ${width * 0.74} ${height * 0.62} L ${width * 0.74} ${height} Z`}
              fill={LOOK42.duoLight}
              fillOpacity={0.75}
            />
            <line x1={0} y1={height * 0.78} x2={width} y2={height * 0.78} stroke={LOOK42.duoLight} strokeWidth={1.2} strokeOpacity={0.45} />
          </>
        )}

        {variant === 'horizon' && (
          <>
            <circle cx={width * 0.34} cy={height * 0.48} r={Math.min(width, height) * 0.2} fill={LOOK42.duoLight} fillOpacity={0.88} />
            <path
              d={`M 0 ${height * 0.68} Q ${width * 0.28} ${height * 0.52} ${width * 0.55} ${height * 0.64} T ${width} ${height * 0.56} L ${width} ${height} L 0 ${height} Z`}
              fill={LOOK42.duoMid}
              fillOpacity={0.76}
            />
            <path
              d={`M 0 ${height * 0.78} Q ${width * 0.42} ${height * 0.64} ${width} ${height * 0.74} L ${width} ${height} L 0 ${height} Z`}
              fill={LOOK42.duoDark}
              fillOpacity={0.92}
            />
            <rect x={width * 0.48} y={height * 0.35} width={width * 0.44} height={6} rx={3} fill={LOOK42.duoLight} fillOpacity={0.4} />
          </>
        )}

        {/* Deterministic film grain stipple over duotone plate */}
        <rect width={width} height={height} fill={`url(#${grainId})`} />
      </svg>
    </div>
  );
};

/** Hand-drawn red ballpoint circle using stroke-dashoffset; scales cleanly to parent box */
const Look42RedCircleSvg: React.FC<{
  progress: number;
  strokeWidth?: number;
}> = ({ progress, strokeWidth = 4.2 }) => {
  const p = clamp01(progress);
  const d =
    'M 28 31 C 102 -2, 268 4, 298 46 C 314 86, 182 98, 56 88 C 6 82, 8 22, 98 11';
  const approxLen = 840;

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 320 100"
      preserveAspectRatio="none"
      style={{ display: 'block', overflow: 'visible', pointerEvents: 'none' }}
    >
      <path
        d={d}
        fill="none"
        stroke={LOOK42.red}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        strokeDasharray={approxLen}
        strokeDashoffset={(approxLen * (1 - p)).toFixed(2)}
      />
    </svg>
  );
};

/** Hand-drawn red ballpoint double underline using stroke-dashoffset */
const Look42RedUnderlineSvg: React.FC<{
  width: number;
  progress: number;
  double?: boolean;
}> = ({ width, progress, double = true }) => {
  const p1 = clamp01(progress * 1.45);
  const p2 = clamp01((progress - 0.38) / 0.62);
  const d1 = `M 2 9 Q ${(width * 0.34).toFixed(1)} 4, ${(width * 0.68).toFixed(1)} 9 T ${(width - 2).toFixed(1)} 7`;
  const d2 = `M ${(width * 0.08).toFixed(1)} 16 Q ${(width * 0.5).toFixed(1)} 12, ${(width * 0.92).toFixed(1)} 15`;
  const len1 = width + 40;
  const len2 = width + 40;
  return (
    <svg width={width} height={22} viewBox={`0 0 ${width} 22`} style={{ display: 'block', overflow: 'visible' }}>
      <path
        d={d1}
        fill="none"
        stroke={LOOK42.red}
        strokeWidth={3.6}
        strokeLinecap="round"
        strokeDasharray={len1}
        strokeDashoffset={(len1 * (1 - p1)).toFixed(2)}
      />
      {double && (
        <path
          d={d2}
          fill="none"
          stroke={LOOK42.redDeep}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeOpacity={0.85}
          strokeDasharray={len2}
          strokeDashoffset={(len2 * (1 - p2)).toFixed(2)}
        />
      )}
    </svg>
  );
};

/** Hand-drawn red looped arrow (shaft with small loop + flicked arrowhead) */
const Look42RedLoopedArrow: React.FC<{
  progress: number;
  variant?: 'up-left' | 'up-right' | 'left';
  width?: number;
  height?: number;
}> = ({ progress, variant = 'up-left', width = 220, height = 140 }) => {
  const pShaft = easeOutCubic(clamp01(progress / 0.78));
  const pHead = easeOutCubic(clamp01((progress - 0.72) / 0.28));

  let shaft = '';
  let head = '';
  if (variant === 'up-left') {
    shaft = 'M 196 122 C 152 128, 120 104, 128 84 C 134 68, 152 76, 144 92 C 132 114, 72 86, 26 24';
    head = 'M 52 24 L 24 22 L 30 50';
  } else if (variant === 'up-right') {
    shaft = 'M 24 122 C 74 128, 102 104, 94 82 C 88 66, 70 76, 78 92 C 92 112, 148 84, 194 24';
    head = 'M 168 24 L 196 22 L 190 50';
  } else {
    shaft = 'M 206 76 C 166 96, 134 78, 138 60 C 142 46, 156 54, 148 68 C 136 86, 78 72, 20 56';
    head = 'M 44 42 L 18 55 L 40 72';
  }

  return (
    <svg width={width} height={height} viewBox="0 0 220 140" style={{ overflow: 'visible', pointerEvents: 'none' }}>
      <path
        d={shaft}
        fill="none"
        stroke={LOOK42.red}
        strokeWidth={3.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={460}
        strokeDashoffset={(460 * (1 - pShaft)).toFixed(2)}
      />
      <path
        d={head}
        fill="none"
        stroke={LOOK42.red}
        strokeWidth={3.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={90}
        strokeDashoffset={(90 * (1 - pHead)).toFixed(2)}
      />
    </svg>
  );
};

/** Hand-drawn red checkmark via stroke-dashoffset */
const Look42RedCheckSvg: React.FC<{ progress: number; size?: number }> = ({ progress, size = 38 }) => {
  const p = easeOutCubic(clamp01(progress));
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={{ overflow: 'visible', flexShrink: 0 }}>
      <path
        d="M 6 22 L 16 32 L 35 9"
        fill="none"
        stroke={LOOK42.red}
        strokeWidth={4.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={64}
        strokeDashoffset={(64 * (1 - p)).toFixed(2)}
      />
    </svg>
  );
};

/** Handwritten red ballpoint margin note with directional stroke-reveal */
const Look42HandNote: React.FC<{
  text: string;
  localFrame: number;
  delay: number;
  dur?: number;
  baseSize?: number;
  tiltDeg?: number;
  align?: 'left' | 'center' | 'right';
  underlineWidth?: number;
}> = ({
  text,
  localFrame,
  delay,
  dur = 26,
  baseSize = 30,
  tiltDeg = -5,
  align = 'left',
  underlineWidth = 220,
}) => {
  const clean = String(text || '').trim();
  if (!clean) return null;
  const writeP = easeOutCubic(clamp01((localFrame - delay) / dur));
  const settled = writeP >= 0.99;
  const clipRight = Math.max(0, (1 - writeP) * 100);
  const underP = easeOutCubic(clamp01((localFrame - (delay + Math.round(dur * 0.65))) / 16));

  return (
    <div
      style={{
        transform: `rotate(${tiltDeg}deg)`,
        transformOrigin: align === 'right' ? 'right center' : 'left center',
      }}
    >
      <div
        style={{
          clipPath: settled ? 'none' : `inset(-18% ${clipRight.toFixed(2)}% -18% -4%)`,
          visibility: localFrame >= delay ? 'visible' : 'hidden',
        }}
      >
        <FitText
          text={clean}
          baseSize={baseSize}
          minSize={20}
          color={LOOK42.redDeep}
          fontFamily={FONT_HAND_O}
          fontWeight={600}
          align={align}
          lineHeight={1.42}
        />
      </div>
      <div style={{ marginTop: 2, display: 'flex', justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
        <Look42RedUnderlineSvg width={underlineWidth} progress={underP} double={false} />
      </div>
    </div>
  );
};

// ============================================================================
// LOOK-42 SHOTS (4 SHOTS)
// ============================================================================

/** Shot 1: mag-spread-headline — Two-line serif headline (line 2 italic indented) + red circled highlight + duotone spread + margin note */
const Look42MagSpreadHeadline: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const t = sceneTexts(scene);
  const [line1, line2] = splitHeadlineTwoLinesO(t.title, t.subtitle);
  const highlightWord = extractHighlightO(scene);
  const bodyPoints = extractPointsO(scene, 3);
  const captionText = scene.imageCaption || t.badge || 'ภาพประกอบบทความ · ฉบับพิเศษ';
  const marginNote = t.subtitle && t.subtitle !== line2 ? t.subtitle : highlightWord;

  const circleP = easeOutCubic(clamp01((localFrame - 20) / 22));
  const arrowP = clamp01((localFrame - 42) / 22);

  return (
    <Look42PaperStage
      sceneIndex={sceneIndex}
      badge={t.badge}
      sectionLabel="FEATURE ESSAY"
      localFrame={localFrame}
    >
      {/* Headline Block: Two-line serif (line 2 italic & indented) */}
      <div style={{ flexShrink: 0, marginBottom: 16 }}>
        <Look42MaskRise localFrame={localFrame} fps={fps} delay={0}>
          <FitText
            text={line1}
            baseSize={74}
            minSize={42}
            color={LOOK42.ink}
            fontFamily={FONT_SERIF_O}
            fontWeight={700}
            align="left"
            lineHeight={1.35}
            style={{ letterSpacing: '-0.02em' }}
          />
        </Look42MaskRise>

        {line2 && (
          <Look42MaskRise localFrame={localFrame} fps={fps} delay={7} style={{ paddingLeft: 64, marginTop: 4 }}>
            <FitText
              text={line2}
              baseSize={66}
              minSize={38}
              color={LOOK42.ink}
              fontFamily={FONT_SERIF_O}
              fontWeight={600}
              align="left"
              lineHeight={1.36}
              style={{ fontStyle: 'italic', letterSpacing: '-0.02em' }}
            />
          </Look42MaskRise>
        )}

        {/* Circled Highlight Keyword Pill on the Paper */}
        <div
          style={{
            marginTop: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 18,
          }}
        >
          <div style={{ width: 42, height: 1.5, backgroundColor: LOOK42.ruleStrong }} />
          <div style={{ position: 'relative', display: 'inline-block', padding: '10px 26px' }}>
            <Look42MaskRise localFrame={localFrame} fps={fps} delay={13}>
              <FitText
                text={highlightWord}
                baseSize={30}
                minSize={20}
                color={LOOK42.ink}
                fontFamily={FONT_SERIF_O}
                fontWeight={700}
                align="center"
                lineHeight={1.36}
              />
            </Look42MaskRise>
            <div style={{ position: 'absolute', inset: '-8px -18px' }}>
              <Look42RedCircleSvg progress={circleP} strokeWidth={3.8} />
            </div>
          </div>
        </div>
      </div>

      {/* Thin horizontal rule separating headline from 2-column magazine spread */}
      <div style={{ height: 1, backgroundColor: LOOK42.rule, marginBottom: 24, flexShrink: 0 }} />

      {/* Two-column editorial spread: Left Duotone Plate | Right Narrow Article Column */}
      <div
        style={{
          display: 'flex',
          gap: 32,
          alignItems: 'flex-start',
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Left Column: Duotone Artwork + Italic Caption */}
        <div style={{ width: 472, flexShrink: 0 }}>
          <Look42DuotoneArt
            width={472}
            height={520}
            localFrame={localFrame}
            durationFrames={durationFrames}
            seed={sceneIndex + 42}
            variant="sea"
          />
          <Look42MaskRise localFrame={localFrame} fps={fps} delay={18} style={{ marginTop: 12 }}>
            <FitText
              text={captionText}
              baseSize={21}
              minSize={16}
              color={LOOK42.inkMuted}
              fontFamily={FONT_SERIF_O}
              fontWeight={500}
              align="left"
              lineHeight={1.42}
              style={{ fontStyle: 'italic' }}
            />
          </Look42MaskRise>
        </div>

        {/* Right Column: Narrow Serif Body Column + Red Margin Note */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            height: '100%',
            paddingBottom: 8,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div
              style={{
                fontFamily: FONT_MONO_O,
                fontSize: 15,
                fontWeight: 700,
                letterSpacing: '0.14em',
                color: LOOK42.duoMid,
              }}
            >
              EDITOR&apos;S NOTE
            </div>
            {bodyPoints.map((pt, idx) => (
              <Look42MaskRise key={idx} localFrame={localFrame} fps={fps} delay={15 + idx * 6}>
                <div style={{ borderLeft: `2px solid ${LOOK42.rule}`, paddingLeft: 14 }}>
                  <FitText
                    text={pt}
                    baseSize={26}
                    minSize={18}
                    color={LOOK42.inkBody}
                    fontFamily={FONT_SERIF_O}
                    fontWeight={500}
                    align="left"
                    lineHeight={1.44}
                  />
                </div>
              </Look42MaskRise>
            ))}
          </div>

          {/* Red Handwritten Margin Note + Looped Arrow pointing across gutter to Duotone Plate */}
          <div style={{ position: 'relative', paddingTop: 28, paddingLeft: 18 }}>
            <div style={{ position: 'absolute', left: -124, top: -36 }}>
              <Look42RedLoopedArrow progress={arrowP} variant="up-left" width={190} height={120} />
            </div>
            <Look42HandNote
              text={marginNote}
              localFrame={localFrame}
              delay={28}
              dur={24}
              baseSize={28}
              tiltDeg={-5.5}
              align="left"
              underlineWidth={240}
            />
          </div>
        </div>
      </div>
    </Look42PaperStage>
  );
};

/** Shot 2: mag-column-notes — Article column bullets with big editorial numerals & red pen checkmarks/underlines */
const Look42MagColumnNotes: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const t = sceneTexts(scene);
  const points = extractPointsO(scene, 4);
  const noteSummary = extractHighlightO(scene);
  const arrowP = clamp01((localFrame - 46) / 20);

  return (
    <Look42PaperStage
      sceneIndex={sceneIndex}
      badge={t.badge}
      sectionLabel="FIELD NOTES"
      localFrame={localFrame}
    >
      {/* Editorial Article Header */}
      <div style={{ flexShrink: 0, marginBottom: 16 }}>
        <Look42MaskRise localFrame={localFrame} fps={fps} delay={0}>
          <FitText
            text={t.title || 'ประเด็นสำคัญจากบทความ'}
            baseSize={58}
            minSize={34}
            color={LOOK42.ink}
            fontFamily={FONT_SERIF_O}
            fontWeight={700}
            align="left"
            lineHeight={1.36}
            style={{ letterSpacing: '-0.02em' }}
          />
        </Look42MaskRise>
        {t.subtitle && (
          <Look42MaskRise localFrame={localFrame} fps={fps} delay={6} style={{ marginTop: 6 }}>
            <FitText
              text={t.subtitle}
              baseSize={26}
              minSize={18}
              color={LOOK42.inkMuted}
              fontFamily={FONT_SERIF_O}
              fontWeight={500}
              align="left"
              lineHeight={1.4}
              style={{ fontStyle: 'italic' }}
            />
          </Look42MaskRise>
        )}
      </div>

      <div style={{ height: 1, backgroundColor: LOOK42.rule, marginBottom: 18, flexShrink: 0 }} />

      {/* Numbered Column List with Sequential Red Pen Checkmarks & Underlines */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: points.length >= 4 ? 14 : 22,
          flex: 1,
          minHeight: 0,
        }}
      >
        {points.map((pt, idx) => {
          const itemDelay = 8 + idx * 8;
          const checkP = clamp01((localFrame - (itemDelay + 9)) / 12);
          const underP = clamp01((localFrame - (itemDelay + 12)) / 15);
          const numStr = String(idx + 1).padStart(2, '0');

          return (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 20,
                paddingBottom: points.length >= 4 ? 14 : 20,
                borderBottom: idx < points.length - 1 ? `1px solid ${LOOK42.rule}` : 'none',
              }}
            >
              {/* Margin Red Check + Big Serif Numeral */}
              <div
                style={{
                  width: 118,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  paddingTop: 4,
                }}
              >
                <Look42RedCheckSvg progress={checkP} size={34} />
                <div
                  style={{
                    fontFamily: FONT_SERIF_O,
                    fontSize: 48,
                    fontWeight: 700,
                    fontStyle: 'italic',
                    lineHeight: 1.1,
                    color: LOOK42.duoDark,
                    letterSpacing: '-0.03em',
                  }}
                >
                  {numStr}
                </div>
              </div>

              {/* Bullet Body + Red Pen Underline */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <Look42MaskRise localFrame={localFrame} fps={fps} delay={itemDelay}>
                  <FitText
                    text={pt}
                    baseSize={points.length >= 4 ? 30 : 34}
                    minSize={20}
                    color={LOOK42.ink}
                    fontFamily={FONT_SERIF_O}
                    fontWeight={600}
                    align="left"
                    lineHeight={1.4}
                  />
                </Look42MaskRise>
                <div style={{ marginTop: 4 }}>
                  <Look42RedUnderlineSvg width={Math.min(420, 180 + (idx % 2) * 90)} progress={underP} double={false} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Editorial Margin Strip: Mini Duotone Thumbnail + Red Handwritten Annotation */}
      <div
        style={{
          flexShrink: 0,
          marginTop: 14,
          paddingTop: 16,
          borderTop: `1.5px solid ${LOOK42.ruleStrong}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 28,
        }}
      >
        <div style={{ flexShrink: 0 }}>
          <Look42DuotoneArt
            width={210}
            height={118}
            localFrame={localFrame}
            durationFrames={durationFrames}
            seed={sceneIndex + 71}
            variant="horizon"
          />
        </div>
        <div style={{ flex: 1, minWidth: 0, position: 'relative', paddingLeft: 16 }}>
          <div style={{ position: 'absolute', right: 8, top: -74 }}>
            <Look42RedLoopedArrow progress={arrowP} variant="up-left" width={150} height={95} />
          </div>
          <Look42HandNote
            text={noteSummary}
            localFrame={localFrame}
            delay={34}
            dur={22}
            baseSize={28}
            tiltDeg={-3.5}
            align="left"
            underlineWidth={260}
          />
        </div>
      </div>
    </Look42PaperStage>
  );
};

/** Shot 3: mag-pull-stat — Giant pull-quote stat figure with red pen circle & handwritten margin arrow */
const Look42MagPullStat: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const t = sceneTexts(scene);
  const metric = extractPrimaryMetricO(scene);
  const points = extractPointsO(scene, 2);
  const statDisplay = metric.unit && !metric.big.includes(metric.unit)
    ? `${metric.big} ${metric.unit}`
    : metric.big;

  const circleP = easeOutCubic(clamp01((localFrame - 16) / 22));
  const arrowP = clamp01((localFrame - 34) / 22);
  const handNoteText =
    metric.delta || extractHighlightO(scene) || t.subtitle || 'ตัวเลขสำคัญประจำฉบับ';

  const bigFontSize =
    statDisplay.length <= 4 ? 148 : statDisplay.length <= 7 ? 118 : statDisplay.length <= 11 ? 88 : 66;

  return (
    <Look42PaperStage
      sceneIndex={sceneIndex}
      badge={t.badge}
      sectionLabel="DATA PULL-QUOTE"
      localFrame={localFrame}
    >
      {/* Upper Headline Context */}
      <div style={{ flexShrink: 0, marginBottom: 18 }}>
        <Look42MaskRise localFrame={localFrame} fps={fps} delay={0}>
          <FitText
            text={t.title || metric.label}
            baseSize={52}
            minSize={32}
            color={LOOK42.ink}
            fontFamily={FONT_SERIF_O}
            fontWeight={700}
            align="left"
            lineHeight={1.36}
          />
        </Look42MaskRise>
      </div>

      {/* Pull-Stat Centerpiece flanked by editorial rules + duotone plate accent */}
      <div
        style={{
          flexShrink: 0,
          borderTop: `2px solid ${LOOK42.ruleStrong}`,
          borderBottom: `2px solid ${LOOK42.ruleStrong}`,
          padding: '32px 0 36px 0',
          display: 'flex',
          alignItems: 'center',
          gap: 30,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: FONT_MONO_O,
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: '0.14em',
              color: LOOK42.duoMid,
              marginBottom: 12,
            }}
          >
            KEY FIGURE
          </div>

          {/* Giant Stat Figure with Hand-Drawn Red Circle */}
          <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', padding: '18px 34px 20px 18px' }}>
            <Look42MaskRise localFrame={localFrame} fps={fps} delay={5}>
              <div
                style={{
                  fontFamily: FONT_SERIF_O,
                  fontSize: bigFontSize,
                  fontWeight: 700,
                  fontStyle: 'italic',
                  color: LOOK42.ink,
                  lineHeight: 1.15,
                  letterSpacing: '-0.03em',
                }}
              >
                {statDisplay}
              </div>
            </Look42MaskRise>
            <div style={{ position: 'absolute', inset: '-10px -16px' }}>
              <Look42RedCircleSvg progress={circleP} strokeWidth={4.5} />
            </div>
          </div>

          <Look42MaskRise localFrame={localFrame} fps={fps} delay={13} style={{ marginTop: 18 }}>
            <FitText
              text={metric.label}
              baseSize={34}
              minSize={22}
              color={LOOK42.inkBody}
              fontFamily={FONT_SERIF_O}
              fontWeight={600}
              align="left"
              lineHeight={1.4}
            />
          </Look42MaskRise>
        </div>

        {/* Right Duotone Editorial Strip */}
        <div style={{ width: 256, flexShrink: 0 }}>
          <Look42DuotoneArt
            width={256}
            height={330}
            localFrame={localFrame}
            durationFrames={durationFrames}
            seed={sceneIndex + 83}
            variant="arch"
          />
        </div>
      </div>

      {/* Red Handwritten Margin Annotation + Looped Arrow pointing UP to the stat */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          paddingTop: 28,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, paddingLeft: 120 }}>
          <div style={{ marginTop: -26, flexShrink: 0 }}>
            <Look42RedLoopedArrow progress={arrowP} variant="up-left" width={190} height={126} />
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingTop: 18 }}>
            <Look42HandNote
              text={handNoteText}
              localFrame={localFrame}
              delay={24}
              dur={24}
              baseSize={34}
              tiltDeg={-5}
              align="left"
              underlineWidth={310}
            />
          </div>
        </div>

        {/* Editorial Footnote Columns */}
        <div
          style={{
            borderTop: `1px solid ${LOOK42.rule}`,
            paddingTop: 16,
            display: 'flex',
            gap: 28,
          }}
        >
          {(points.length > 0 ? points : [t.subtitle || t.title]).slice(0, 2).map((p, idx) => (
            <div key={idx} style={{ flex: 1, minWidth: 0 }}>
              <Look42MaskRise localFrame={localFrame} fps={fps} delay={22 + idx * 6}>
                <FitText
                  text={p}
                  baseSize={24}
                  minSize={18}
                  color={LOOK42.inkMuted}
                  fontFamily={FONT_SERIF_O}
                  fontWeight={500}
                  align="left"
                  lineHeight={1.42}
                />
              </Look42MaskRise>
            </div>
          ))}
        </div>
      </div>
    </Look42PaperStage>
  );
};

/** Shot 4: mag-quote-margin — Two-page editorial spread for quote OR compare with red margin commentary */
const Look42MagQuoteMargin: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const t = sceneTexts(scene);
  const hasCompare = Boolean(scene.compare);
  const redBarP = easeOutCubic(clamp01((localFrame - 12) / 22));
  const arrowP = clamp01((localFrame - 36) / 22);

  if (hasCompare && scene.compare) {
    const cmp = scene.compare;
    const leftItems = (cmp.leftItems || []).slice(0, 4);
    const rightItems = (cmp.rightItems || []).slice(0, 4);
    const winnerRight = cmp.winner !== 'left';
    const circleP = easeOutCubic(clamp01((localFrame - 24) / 20));
    const marginVerdict =
      t.subtitle || extractHighlightO(scene) || (winnerRight ? cmp.rightTitle : cmp.leftTitle);

    return (
      <Look42PaperStage
        sceneIndex={sceneIndex}
        badge={t.badge}
        sectionLabel="DOUBLE-PAGE SPREAD"
        localFrame={localFrame}
      >
        {/* Spread Headline */}
        <div style={{ flexShrink: 0, marginBottom: 16 }}>
          <Look42MaskRise localFrame={localFrame} fps={fps} delay={0}>
            <FitText
              text={t.title || `${cmp.leftTitle} vs ${cmp.rightTitle}`}
              baseSize={52}
              minSize={32}
              color={LOOK42.ink}
              fontFamily={FONT_SERIF_O}
              fontWeight={700}
              align="left"
              lineHeight={1.36}
            />
          </Look42MaskRise>
        </div>

        {/* Open 2-Page Magazine Spread with Center Gutter Crease */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            position: 'relative',
            borderTop: `1.5px solid ${LOOK42.ruleStrong}`,
            borderBottom: `1px solid ${LOOK42.rule}`,
            paddingTop: 22,
            paddingBottom: 20,
          }}
        >
          {/* Center Magazine Spine Gutter */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: '50%',
              width: 24,
              transform: 'translateX(-50%)',
              background:
                'linear-gradient(90deg, rgba(27,30,37,0) 0%, rgba(27,30,37,0.06) 48%, rgba(27,30,37,0.12) 50%, rgba(27,30,37,0.04) 54%, rgba(27,30,37,0) 100%)',
              pointerEvents: 'none',
            }}
          />

          {/* Left Page */}
          <div style={{ flex: 1, minWidth: 0, paddingRight: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ position: 'relative', paddingBottom: 12, borderBottom: `1px solid ${LOOK42.rule}` }}>
              <div style={{ fontFamily: FONT_MONO_O, fontSize: 14, color: LOOK42.inkMuted, letterSpacing: '0.12em' }}>
                VERSO · LEFT PAGE
              </div>
              <Look42MaskRise localFrame={localFrame} fps={fps} delay={6} style={{ marginTop: 6 }}>
                <FitText
                  text={cmp.leftTitle}
                  baseSize={34}
                  minSize={22}
                  color={LOOK42.ink}
                  fontFamily={FONT_SERIF_O}
                  fontWeight={700}
                  align="left"
                  lineHeight={1.36}
                />
              </Look42MaskRise>
              {!winnerRight && (
                <div style={{ position: 'absolute', inset: '14px -10px 2px -10px' }}>
                  <Look42RedCircleSvg progress={circleP} strokeWidth={3.6} />
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {leftItems.map((item, idx) => (
                <Look42MaskRise key={idx} localFrame={localFrame} fps={fps} delay={12 + idx * 5}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ fontFamily: FONT_SERIF_O, fontSize: 24, color: LOOK42.inkMuted, lineHeight: 1.4 }}>—</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <FitText
                        text={item}
                        baseSize={25}
                        minSize={18}
                        color={LOOK42.inkBody}
                        fontFamily={FONT_SERIF_O}
                        fontWeight={500}
                        align="left"
                        lineHeight={1.42}
                      />
                    </div>
                  </div>
                </Look42MaskRise>
              ))}
            </div>
          </div>

          {/* Right Page */}
          <div style={{ flex: 1, minWidth: 0, paddingLeft: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ position: 'relative', paddingBottom: 12, borderBottom: `1.5px solid ${LOOK42.ruleStrong}` }}>
              <div style={{ fontFamily: FONT_MONO_O, fontSize: 14, color: LOOK42.duoMid, letterSpacing: '0.12em' }}>
                RECTO · RIGHT PAGE
              </div>
              <Look42MaskRise localFrame={localFrame} fps={fps} delay={8} style={{ marginTop: 6 }}>
                <FitText
                  text={cmp.rightTitle}
                  baseSize={34}
                  minSize={22}
                  color={LOOK42.ink}
                  fontFamily={FONT_SERIF_O}
                  fontWeight={700}
                  align="left"
                  lineHeight={1.36}
                  style={{ fontStyle: 'italic' }}
                />
              </Look42MaskRise>
              {winnerRight && (
                <div style={{ position: 'absolute', inset: '14px -10px 2px -10px' }}>
                  <Look42RedCircleSvg progress={circleP} strokeWidth={3.6} />
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {rightItems.map((item, idx) => {
                const ckP = clamp01((localFrame - (20 + idx * 6)) / 11);
                return (
                  <Look42MaskRise key={idx} localFrame={localFrame} fps={fps} delay={14 + idx * 5}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      {winnerRight ? (
                        <Look42RedCheckSvg progress={ckP} size={26} />
                      ) : (
                        <span style={{ fontFamily: FONT_SERIF_O, fontSize: 24, color: LOOK42.inkMuted, lineHeight: 1.4 }}>•</span>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <FitText
                          text={item}
                          baseSize={25}
                          minSize={18}
                          color={LOOK42.ink}
                          fontFamily={FONT_SERIF_O}
                          fontWeight={600}
                          align="left"
                          lineHeight={1.42}
                        />
                      </div>
                    </div>
                  </Look42MaskRise>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom Margin Red Commentary */}
        <div
          style={{
            flexShrink: 0,
            paddingTop: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 24,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <Look42HandNote
              text={marginVerdict}
              localFrame={localFrame}
              delay={28}
              dur={22}
              baseSize={30}
              tiltDeg={-3.5}
              align="left"
              underlineWidth={320}
            />
          </div>
          <div style={{ flexShrink: 0, marginTop: -24 }}>
            <Look42RedLoopedArrow
              progress={arrowP}
              variant={winnerRight ? 'up-right' : 'up-left'}
              width={180}
              height={110}
            />
          </div>
        </div>
      </Look42PaperStage>
    );
  }

  // Quote Spread Layout with Red Margin Bar + Margin Annotation + Duotone Plate
  const quoteText = scene.quote?.text || t.title || t.subtitle || 'แนวคิดที่ตั้งใจคิด ย่อมคมชัดเสมอ';
  const authorLine = scene.quote?.author
    ? `— ${scene.quote.author}${scene.quote.role ? `, ${scene.quote.role}` : ''}`
    : t.subtitle && t.subtitle !== quoteText
      ? `— ${t.subtitle}`
      : `— ${t.badge || 'EDITORIAL ARCHIVE'}`;
  const marginNote = extractHighlightO(scene);

  return (
    <Look42PaperStage
      sceneIndex={sceneIndex}
      badge={t.badge}
      sectionLabel="PULL QUOTE & MARGIN"
      localFrame={localFrame}
    >
      {/* Main Pull Quote with Hand-Drawn Red Margin Bracket */}
      <div style={{ position: 'relative', paddingLeft: 40, paddingTop: 18, paddingBottom: 24, flexShrink: 0 }}>
        {/* Hand-drawn vertical red margin stroke */}
        <svg
          width={24}
          height={420}
          viewBox="0 0 24 420"
          style={{ position: 'absolute', left: 4, top: 14, height: '90%', overflow: 'visible' }}
        >
          <path
            d="M 10 8 C 6 120, 14 260, 9 404"
            fill="none"
            stroke={LOOK42.red}
            strokeWidth={4.2}
            strokeLinecap="round"
            strokeDasharray={420}
            strokeDashoffset={(420 * (1 - redBarP)).toFixed(2)}
          />
        </svg>

        {/* Oversized Editorial Opening Quotation Mark */}
        <div
          style={{
            fontFamily: FONT_SERIF_O,
            fontSize: 130,
            lineHeight: 0.72,
            color: LOOK42.duoDark,
            opacity: 0.16,
            marginBottom: -12,
            userSelect: 'none',
          }}
        >
          &ldquo;
        </div>

        <Look42MaskRise localFrame={localFrame} fps={fps} delay={3}>
          <FitText
            text={quoteText}
            baseSize={54}
            minSize={30}
            color={LOOK42.ink}
            fontFamily={FONT_SERIF_O}
            fontWeight={600}
            align="left"
            lineHeight={1.44}
            style={{ fontStyle: 'italic', letterSpacing: '-0.015em' }}
          />
        </Look42MaskRise>

        <Look42MaskRise localFrame={localFrame} fps={fps} delay={14} style={{ marginTop: 22 }}>
          <FitText
            text={authorLine}
            baseSize={26}
            minSize={18}
            color={LOOK42.inkMuted}
            fontFamily={FONT_SERIF_O}
            fontWeight={600}
            align="left"
            lineHeight={1.38}
          />
        </Look42MaskRise>
      </div>

      <div style={{ height: 1, backgroundColor: LOOK42.rule, marginBottom: 24, flexShrink: 0 }} />

      {/* Lower Two-Column Spread: Duotone Plate Left | Red Margin Commentary Right */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          gap: 32,
          alignItems: 'flex-start',
        }}
      >
        <div style={{ width: 430, flexShrink: 0 }}>
          <Look42DuotoneArt
            width={430}
            height={360}
            localFrame={localFrame}
            durationFrames={durationFrames}
            seed={sceneIndex + 99}
            variant="sea"
          />
          <div
            style={{
              marginTop: 10,
              fontFamily: FONT_MONO_O,
              fontSize: 14,
              letterSpacing: '0.1em',
              color: LOOK42.inkMuted,
            }}
          >
            FIG. 0{sceneIndex + 1} · DUOTONE ARCHIVE
          </div>
        </div>

        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            height: '100%',
            paddingTop: 6,
          }}
        >
          <div style={{ position: 'relative' }}>
            <div style={{ marginLeft: 18, marginBottom: 4 }}>
              <Look42RedLoopedArrow progress={arrowP} variant="up-left" width={175} height={106} />
            </div>
            <Look42HandNote
              text={marginNote}
              localFrame={localFrame}
              delay={22}
              dur={24}
              baseSize={32}
              tiltDeg={-5}
              align="left"
              underlineWidth={280}
            />
          </div>

          {t.bullets.length > 0 && t.bullets[0] !== quoteText && (
            <Look42MaskRise localFrame={localFrame} fps={fps} delay={20}>
              <div style={{ borderTop: `1px solid ${LOOK42.rule}`, paddingTop: 14 }}>
                <FitText
                  text={t.bullets[0]}
                  baseSize={24}
                  minSize={18}
                  color={LOOK42.inkBody}
                  fontFamily={FONT_SERIF_O}
                  fontWeight={500}
                  align="left"
                  lineHeight={1.42}
                />
              </div>
            </Look42MaskRise>
          )}
        </div>
      </div>
    </Look42PaperStage>
  );
};

// ============================================================================
// LOOK-43: BLUE EDITORIAL — SHARED PRIMITIVES
// Flat electric ultramarine blue (#2433F0), crisp white type (#F4F5FA),
// thin white rules at 55% opacity. NO gradients, NO glow, NO purple/navy, NO fades.
// Sliced horizontal bands lock together with 100% Thai vowel integrity!
// ============================================================================

const Look43BlueStage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      backgroundColor: LOOK43.blue,
      overflow: 'hidden',
    }}
  >
    {/* Safe Editorial Cover Bounds: x ∈ [54, 1026], y ∈ [112, 1420] */}
    <div
      style={{
        position: 'absolute',
        top: SAFE_TOP,
        left: SAFE_X,
        width: SAFE_W,
        height: SAFE_H,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {children}
    </div>
  </div>
);

/** Crisp thin white editorial rule drawing rapidly with deceleration */
const Look43RuleLine: React.FC<{
  localFrame: number;
  delay?: number;
  dur?: number;
  widthPct?: number;
  align?: 'left' | 'right';
  thickness?: number;
}> = ({ localFrame, delay = 0, dur = 12, widthPct = 100, align = 'left', thickness = 2 }) => {
  const p = easeOutCubic(clamp01((localFrame - delay) / dur));
  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: `${widthPct}%`,
          height: thickness,
          backgroundColor: LOOK43.rule,
          transform: `scaleX(${p.toFixed(4)})`,
          transformOrigin: align === 'right' ? 'right center' : 'left center',
        }}
      />
    </div>
  );
};

/**
 * Look43SlicedText — Signature horizontal razor-sliced editorial text.
 * - While animating: renders `slices` (3-5) alternating horizontal bands via clipPath inset
 *   with generous top/bottom vertical padding (PAD_Y=22px) so Thai upper tone marks & lower vowels
 *   are NEVER clipped mid-flight.
 * - Arrives in 2 editorial beats: flies in from alternating edges -> holds off-register briefly
 *   so razor cut is unmistakable -> snaps tightly together.
 * - Once locked (localFrame >= lockFrame): renders a SINGLE clean unclipped FitText with ZERO
 *   clipPath and ZERO overflow:hidden — 100% readable at rest and scene end!
 */
const Look43SlicedText: React.FC<{
  text: string;
  localFrame: number;
  durationFrames: number;
  fps: number;
  delay?: number;
  slices?: number;
  baseSize?: number;
  minSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
  letterSpacing?: string;
}> = ({
  text,
  localFrame,
  durationFrames,
  fps,
  delay = 2,
  slices = 4,
  baseSize = 84,
  minSize = 40,
  fontFamily = FONT_EDITORIAL_SERIF_O,
  fontWeight = 800,
  italic = false,
  align = 'left',
  lineHeight = 1.4,
  letterSpacing = '-0.025em',
}) => {
  const clean = String(text || '').trim();
  if (!clean) return null;

  const padY = 22;
  const maxLock = Math.max(12, Math.floor(durationFrames * 0.34));
  const lockFrame = Math.min(delay + 18, maxLock);
  const locked = localFrame >= lockFrame;

  const textStyle: React.CSSProperties = {
    fontStyle: italic ? 'italic' : 'normal',
    letterSpacing,
  };

  if (locked) {
    return (
      <div style={{ position: 'relative', width: '100%' }}>
        <FitText
          text={clean}
          baseSize={baseSize}
          minSize={minSize}
          color={LOOK43.white}
          fontFamily={fontFamily}
          fontWeight={fontWeight}
          align={align}
          lineHeight={lineHeight}
          style={textStyle}
        />
      </div>
    );
  }

  // Two-beat motion: fly in to off-register hold, then snap-lock together
  const elapsed = Math.max(0, localFrame - delay);
  const visible = localFrame >= delay - 1;
  const flySpring = spring({
    frame: elapsed,
    fps,
    config: { damping: 15, stiffness: 220, mass: 0.85 },
  });
  const lockBeatStart = Math.max(6, Math.round((lockFrame - delay) * 0.56));
  const lockSpring = spring({
    frame: Math.max(0, elapsed - lockBeatStart),
    fps,
    config: { damping: 18, stiffness: 280, mass: 0.7 },
  });

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        visibility: visible ? 'visible' : 'hidden',
        clipPath: 'inset(-24px 0px -24px 0px)',
      }}
    >
      {/* Invisible flow copy defines exact natural height for multi-line Thai text */}
      <div style={{ opacity: 0, pointerEvents: 'none' }} aria-hidden="true">
        <FitText
          text={clean}
          baseSize={baseSize}
          minSize={minSize}
          color={LOOK43.white}
          fontFamily={fontFamily}
          fontWeight={fontWeight}
          align={align}
          lineHeight={lineHeight}
          style={textStyle}
        />
      </div>

      {/* Alternating horizontal sliced bands with generous vertical headroom/footroom */}
      {Array.from({ length: slices }, (_, k) => {
        const dir = k % 2 === 0 ? -1 : 1;
        const bandH = 100 / slices;
        const topPct = k === 0 ? 0 : Math.max(0, k * bandH - 0.8);
        const bottomPct = k === slices - 1 ? 0 : Math.max(0, 100 - (k + 1) * bandH - 0.8);
        const offReg = 14 + (k % 2) * 6;
        const flyDist = 140 + k * 20;
        const afterFly = interpolate(flySpring, [0, 1], [flyDist, offReg]);
        const finalOffset = interpolate(lockSpring, [0, 1], [afterFly, 0]);

        return (
          <div
            key={k}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: -padY,
              bottom: -padY,
              paddingTop: padY,
              paddingBottom: padY,
              clipPath: `inset(${topPct.toFixed(2)}% -8% ${bottomPct.toFixed(2)}% -8%)`,
              transform: `translate3d(${(dir * finalOffset).toFixed(2)}px, 0, 0)`,
            }}
          >
            <FitText
              text={clean}
              baseSize={baseSize}
              minSize={minSize}
              color={LOOK43.white}
              fontFamily={fontFamily}
              fontWeight={fontWeight}
              align={align}
              lineHeight={lineHeight}
              style={textStyle}
            />
          </div>
        );
      })}
    </div>
  );
};

/** Slanted editorial wipe with crisp thin white leading edge; unclipped once settled */
const Look43SlantedWipe: React.FC<{
  localFrame: number;
  delay?: number;
  dur?: number;
  children: React.ReactNode;
}> = ({ localFrame, delay = 10, dur = 16, children }) => {
  const p = easeOutCubic(clamp01((localFrame - delay) / dur));
  const settled = p >= 0.99;
  const visible = localFrame >= delay;
  const edgeX = p * 116;
  const slant = 10;
  const clipPoly = `polygon(-10% -25%, ${edgeX.toFixed(2)}% -25%, ${(edgeX - slant).toFixed(2)}% 125%, -10% 125%)`;

  return (
    <div style={{ position: 'relative', visibility: visible ? 'visible' : 'hidden' }}>
      <div style={{ clipPath: settled ? 'none' : clipPoly }}>{children}</div>
      {!settled && visible && p > 0.02 && (
        <div
          style={{
            position: 'absolute',
            top: -8,
            bottom: -8,
            left: `${Math.min(100, edgeX - slant * 0.5).toFixed(2)}%`,
            width: 2,
            backgroundColor: LOOK43.white,
            transform: 'skewX(-12deg)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
};

/** Slide-out-from-under-rule editorial reveal; zero overflow:hidden once settled */
const Look43SlideOut: React.FC<{
  localFrame: number;
  fps: number;
  delay?: number;
  fromY?: number;
  children: React.ReactNode;
}> = ({ localFrame, fps, delay = 12, fromY = 42, children }) => {
  const s = spring({
    frame: Math.max(0, localFrame - delay),
    fps,
    config: { damping: 14, stiffness: 195, mass: 0.85 },
  });
  const settled = localFrame >= delay + 24;
  const y = settled ? 0 : interpolate(s, [0, 1], [fromY, 0]);
  const visible = localFrame >= delay;

  return (
    <div style={{ overflow: settled ? 'visible' : 'hidden', paddingTop: 6, paddingBottom: 6 }}>
      <div
        style={{
          visibility: visible ? 'visible' : 'hidden',
          transform: `translate3d(0, ${y.toFixed(2)}px, 0)`,
        }}
      >
        {children}
      </div>
    </div>
  );
};

// ============================================================================
// LOOK-43 SHOTS (4 SHOTS)
// ============================================================================

/** Shot 1: blue-sliced-title — Asymmetric magazine cover with scale-snap kicker, sliced hero title & slanted wipe */
const Look43BlueSlicedTitle: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const t = sceneTexts(scene);
  const [line1, line2] = splitHeadlineTwoLinesO(t.title, '');
  const kickerText = t.badge || `edition 0${sceneIndex + 1}`;
  const secondaryText = line2 || t.subtitle || extractHighlightO(scene);
  const closingPoint =
    (line2 && t.subtitle) ? t.subtitle : (t.bullets[0] || extractHighlightO(scene));

  // Scale-jump kicker: starts oversized then snaps sharply into crisp kicker size
  const snapP = spring({
    frame: Math.max(0, localFrame - 7),
    fps,
    config: { damping: 16, stiffness: 260, mass: 0.75 },
  });
  const kickerScale = localFrame < 7 ? 1.55 : interpolate(snapP, [0, 1], [1.55, 1]);

  return (
    <Look43BlueStage>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          paddingTop: 12,
          paddingBottom: 16,
        }}
      >
        {/* Top Kicker + Full-Width Thin White Rule */}
        <div style={{ flexShrink: 0 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              marginBottom: 14,
            }}
          >
            <div
              style={{
                transform: `scale(${kickerScale.toFixed(4)})`,
                transformOrigin: 'left bottom',
                maxWidth: 680,
              }}
            >
              <FitText
                text={kickerText}
                baseSize={34}
                minSize={22}
                color={LOOK43.white}
                fontFamily={FONT_EDITORIAL_SANS_O}
                fontWeight={900}
                align="left"
                lineHeight={1.36}
                style={{ letterSpacing: '-0.03em' }}
              />
            </div>
            <div
              style={{
                fontFamily: FONT_EDITORIAL_SERIF_O,
                fontStyle: 'italic',
                fontSize: 30,
                color: LOOK43.whiteSoft,
                flexShrink: 0,
              }}
            >
              vol. 0{sceneIndex + 1}
            </div>
          </div>
          <Look43RuleLine localFrame={localFrame} delay={2} dur={12} widthPct={100} />
        </div>

        {/* Hero Sliced Display Title (huge italic serif breaking rhythm) */}
        <div style={{ flexShrink: 0, marginTop: -8 }}>
          <Look43SlicedText
            text={line1}
            localFrame={localFrame}
            durationFrames={durationFrames}
            fps={fps}
            delay={4}
            slices={4}
            baseSize={96}
            minSize={48}
            fontFamily={FONT_EDITORIAL_SERIF_O}
            fontWeight={800}
            italic={true}
            align="left"
            lineHeight={1.38}
            letterSpacing="-0.03em"
          />
        </div>

        {/* Right-Aligned Short Rule + Slanted Wipe Secondary Display */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Look43RuleLine localFrame={localFrame} delay={14} dur={12} widthPct={66} align="right" />
          {secondaryText && secondaryText !== line1 && (
            <div style={{ paddingLeft: 120 }}>
              <Look43SlantedWipe localFrame={localFrame} delay={16} dur={16}>
                <FitText
                  text={secondaryText}
                  baseSize={56}
                  minSize={30}
                  color={LOOK43.white}
                  fontFamily={FONT_EDITORIAL_SANS_O}
                  fontWeight={900}
                  align="right"
                  lineHeight={1.38}
                  style={{ letterSpacing: '-0.035em' }}
                />
              </Look43SlantedWipe>
            </div>
          )}
        </div>

        {/* Lower Closing Statement + Closing Rule */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {closingPoint && closingPoint !== secondaryText && closingPoint !== line1 && (
            <div style={{ paddingRight: 80 }}>
              <Look43SlideOut localFrame={localFrame} fps={fps} delay={14}>
                <FitText
                  text={closingPoint}
                  baseSize={42}
                  minSize={24}
                  color={LOOK43.white}
                  fontFamily={FONT_EDITORIAL_SERIF_O}
                  fontWeight={700}
                  align="left"
                  lineHeight={1.4}
                  style={{ fontStyle: 'italic' }}
                />
              </Look43SlideOut>
            </div>
          )}
          <Look43RuleLine localFrame={localFrame} delay={18} dur={12} widthPct={100} />
        </div>
      </div>
    </Look43BlueStage>
  );
};

/** Shot 2: blue-cover-lines — Magazine cover masthead & asymmetric alternating cover-lines from bullets */
const Look43BlueCoverLines: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const t = sceneTexts(scene);
  const points = extractPointsO(scene, 4);
  const numerals = ['i.', 'ii.', 'iii.', 'iv.'];
  const ruleWidths = [84, 72, 92, 66];

  // Minimal editorial white barcode bars (deterministic pure SVG)
  const bars = Array.from({ length: 18 }, (_, i) => {
    const w = seededHashO(sceneIndex * 43 + i * 9) > 0.55 ? 4 : 2;
    return { x: i * 6.4, w };
  });

  return (
    <Look43BlueStage>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          paddingTop: 6,
          paddingBottom: 12,
        }}
      >
        {/* Magazine Cover Masthead */}
        <div style={{ flexShrink: 0 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 8,
            }}
          >
            <div
              style={{
                fontFamily: FONT_EDITORIAL_SANS_O,
                fontSize: 22,
                fontWeight: 900,
                letterSpacing: '0.06em',
                color: LOOK43.whiteSoft,
              }}
            >
              {t.badge || `blue editorial`}
            </div>
            <div
              style={{
                fontFamily: FONT_EDITORIAL_SERIF_O,
                fontStyle: 'italic',
                fontSize: 26,
                color: LOOK43.whiteSoft,
              }}
            >
              no. 0{sceneIndex + 1}
            </div>
          </div>

          <Look43RuleLine localFrame={localFrame} delay={0} dur={10} widthPct={100} />

          <div style={{ marginTop: 14, marginBottom: 12 }}>
            <Look43SlicedText
              text={t.title || 'ประเด็นเด่นประจำฉบับ'}
              localFrame={localFrame}
              durationFrames={durationFrames}
              fps={fps}
              delay={2}
              slices={4}
              baseSize={68}
              minSize={36}
              fontFamily={FONT_EDITORIAL_SERIF_O}
              fontWeight={800}
              italic={true}
              align="left"
              lineHeight={1.36}
            />
          </div>
          <Look43RuleLine localFrame={localFrame} delay={8} dur={12} widthPct={100} thickness={1.5} />
        </div>

        {/* Asymmetric Cover-Lines Stack (Alternating Left/Right, NOT a boxed Swiss grid) */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-evenly',
            paddingTop: 12,
            paddingBottom: 12,
          }}
        >
          {points.map((pt, idx) => {
            const isRight = idx % 2 === 1;
            const delay = 10 + idx * 7;
            return (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  paddingLeft: isRight ? 96 : 0,
                  paddingRight: isRight ? 0 : 72,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: isRight ? 'row-reverse' : 'row',
                    alignItems: 'baseline',
                    gap: 18,
                  }}
                >
                  <div
                    style={{
                      fontFamily: FONT_EDITORIAL_SERIF_O,
                      fontStyle: 'italic',
                      fontSize: 44,
                      fontWeight: 700,
                      color: LOOK43.whiteSoft,
                      lineHeight: 1.15,
                      flexShrink: 0,
                    }}
                  >
                    {numerals[idx] || `${idx + 1}.`}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {idx === 0 ? (
                      <Look43SlicedText
                        text={pt}
                        localFrame={localFrame}
                        durationFrames={durationFrames}
                        fps={fps}
                        delay={delay}
                        slices={3}
                        baseSize={points.length >= 4 ? 36 : 42}
                        minSize={22}
                        fontFamily={FONT_EDITORIAL_SANS_O}
                        fontWeight={900}
                        align="left"
                        lineHeight={1.38}
                      />
                    ) : (
                      <Look43SlantedWipe localFrame={localFrame} delay={delay} dur={14}>
                        <FitText
                          text={pt}
                          baseSize={points.length >= 4 ? 34 : 40}
                          minSize={22}
                          color={LOOK43.white}
                          fontFamily={idx % 2 === 1 ? FONT_EDITORIAL_SERIF_O : FONT_EDITORIAL_SANS_O}
                          fontWeight={idx % 2 === 1 ? 700 : 900}
                          align={isRight ? 'right' : 'left'}
                          lineHeight={1.38}
                          style={{
                            fontStyle: idx % 2 === 1 ? 'italic' : 'normal',
                            letterSpacing: '-0.025em',
                          }}
                        />
                      </Look43SlantedWipe>
                    )}
                  </div>
                </div>
                <Look43RuleLine
                  localFrame={localFrame}
                  delay={delay + 4}
                  dur={10}
                  widthPct={ruleWidths[idx] || 76}
                  align={isRight ? 'right' : 'left'}
                  thickness={1.5}
                />
              </div>
            );
          })}
        </div>

        {/* Cover Bottom Footnote + Minimal White Barcode */}
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 24,
            paddingTop: 12,
            borderTop: `1.5px solid ${LOOK43.rule}`,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <Look43SlideOut localFrame={localFrame} fps={fps} delay={24}>
              <FitText
                text={t.subtitle || extractHighlightO(scene)}
                baseSize={26}
                minSize={18}
                color={LOOK43.whiteSoft}
                fontFamily={FONT_EDITORIAL_SANS_O}
                fontWeight={800}
                align="left"
                lineHeight={1.38}
              />
            </Look43SlideOut>
          </div>
          <svg width={118} height={42} viewBox="0 0 118 42" style={{ flexShrink: 0 }}>
            {bars.map((b, i) => (
              <rect key={i} x={b.x} y={0} width={b.w} height={42} fill={LOOK43.white} fillOpacity={0.82} />
            ))}
          </svg>
        </div>
      </div>
    </Look43BlueStage>
  );
};

/** Shot 3: blue-big-number — Giant white stat figure sliced into 5 horizontal bands then locked + editorial label */
const Look43BlueBigNumber: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const t = sceneTexts(scene);
  const metric = extractPrimaryMetricO(scene);
  const statText = metric.unit && !metric.big.includes(metric.unit)
    ? `${metric.big} ${metric.unit}`
    : metric.big;

  const statBaseSize =
    statText.length <= 4 ? 200 : statText.length <= 7 ? 156 : statText.length <= 10 ? 116 : 86;

  return (
    <Look43BlueStage>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          paddingTop: 10,
          paddingBottom: 16,
        }}
      >
        {/* Top Editorial Kicker + Rule */}
        <div style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
            <div style={{ maxWidth: 740 }}>
              <Look43SlideOut localFrame={localFrame} fps={fps} delay={0}>
                <FitText
                  text={t.badge || t.title || 'key figure'}
                  baseSize={34}
                  minSize={22}
                  color={LOOK43.white}
                  fontFamily={FONT_EDITORIAL_SANS_O}
                  fontWeight={900}
                  align="left"
                  lineHeight={1.36}
                  style={{ letterSpacing: '-0.03em' }}
                />
              </Look43SlideOut>
            </div>
            <div
              style={{
                fontFamily: FONT_EDITORIAL_SERIF_O,
                fontStyle: 'italic',
                fontSize: 30,
                color: LOOK43.whiteSoft,
                flexShrink: 0,
              }}
            >
              fig. 0{sceneIndex + 1}
            </div>
          </div>
          <Look43RuleLine localFrame={localFrame} delay={2} dur={11} widthPct={100} />
        </div>

        {/* Centerpiece: Giant Sliced White Number (5 alternating horizontal slices -> snap lock) */}
        <div style={{ flexShrink: 0, paddingTop: 12, paddingBottom: 12 }}>
          <Look43SlicedText
            text={statText}
            localFrame={localFrame}
            durationFrames={durationFrames}
            fps={fps}
            delay={4}
            slices={5}
            baseSize={statBaseSize}
            minSize={62}
            fontFamily={FONT_EDITORIAL_SERIF_O}
            fontWeight={800}
            italic={true}
            align="center"
            lineHeight={1.25}
            letterSpacing="-0.04em"
          />
        </div>

        {/* Asymmetric Right-Aligned Short Rule + Stat Label & Delta */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 22 }}>
          <Look43RuleLine localFrame={localFrame} delay={15} dur={12} widthPct={72} align="right" />

          <div style={{ paddingLeft: 72 }}>
            <Look43SlantedWipe localFrame={localFrame} delay={17} dur={16}>
              <FitText
                text={metric.label}
                baseSize={52}
                minSize={28}
                color={LOOK43.white}
                fontFamily={FONT_EDITORIAL_SANS_O}
                fontWeight={900}
                align="right"
                lineHeight={1.38}
                style={{ letterSpacing: '-0.03em' }}
              />
            </Look43SlantedWipe>
          </div>

          {metric.delta && (
            <div style={{ paddingLeft: 140 }}>
              <Look43SlideOut localFrame={localFrame} fps={fps} delay={24}>
                <FitText
                  text={`— ${metric.delta}`}
                  baseSize={34}
                  minSize={22}
                  color={LOOK43.whiteSoft}
                  fontFamily={FONT_EDITORIAL_SERIF_O}
                  fontWeight={700}
                  align="right"
                  lineHeight={1.38}
                  style={{ fontStyle: 'italic' }}
                />
              </Look43SlideOut>
            </div>
          )}
        </div>

        {/* Closing Context Line + Full Rule */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Look43RuleLine localFrame={localFrame} delay={26} dur={12} widthPct={100} />
          {t.subtitle && t.subtitle !== metric.label && (
            <Look43SlideOut localFrame={localFrame} fps={fps} delay={28}>
              <FitText
                text={t.subtitle}
                baseSize={28}
                minSize={20}
                color={LOOK43.whiteSoft}
                fontFamily={FONT_EDITORIAL_SANS_O}
                fontWeight={800}
                align="left"
                lineHeight={1.38}
              />
            </Look43SlideOut>
          )}
        </div>
      </div>
    </Look43BlueStage>
  );
};

/** Shot 4: blue-manifesto-quote — Quote or Compare as an editorial manifesto rising word-by-word */
const Look43BlueManifestoQuote: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const t = sceneTexts(scene);

  // Compare Variant: Asymmetric Dual-Thesis Manifesto (no boxed grid, pure cover typography)
  if (scene.compare) {
    const cmp = scene.compare;
    const leftItems = (cmp.leftItems || []).slice(0, 3);
    const rightItems = (cmp.rightItems || []).slice(0, 3);

    return (
      <Look43BlueStage>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            paddingTop: 8,
            paddingBottom: 14,
          }}
        >
          {/* Top Kicker + Full Rule */}
          <div style={{ flexShrink: 0 }}>
            <Look43SlideOut localFrame={localFrame} fps={fps} delay={0}>
              <FitText
                text={t.title || `${cmp.leftTitle} / ${cmp.rightTitle}`}
                baseSize={42}
                minSize={26}
                color={LOOK43.white}
                fontFamily={FONT_EDITORIAL_SANS_O}
                fontWeight={900}
                align="left"
                lineHeight={1.36}
              />
            </Look43SlideOut>
            <div style={{ marginTop: 12 }}>
              <Look43RuleLine localFrame={localFrame} delay={2} dur={11} widthPct={100} />
            </div>
          </div>

          {/* Upper Left Thesis Block */}
          <div style={{ flexShrink: 0, paddingRight: 88, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Look43SlantedWipe localFrame={localFrame} delay={5} dur={14}>
              <FitText
                text={cmp.leftTitle}
                baseSize={44}
                minSize={26}
                color={LOOK43.whiteSoft}
                fontFamily={FONT_EDITORIAL_SERIF_O}
                fontWeight={700}
                align="left"
                lineHeight={1.36}
                style={{ fontStyle: 'italic' }}
              />
            </Look43SlantedWipe>
            <Look43RuleLine localFrame={localFrame} delay={8} dur={10} widthPct={56} align="left" thickness={1.5} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {leftItems.map((item, idx) => (
                <Look43SlideOut key={idx} localFrame={localFrame} fps={fps} delay={10 + idx * 5}>
                  <FitText
                    text={`— ${item}`}
                    baseSize={30}
                    minSize={20}
                    color={LOOK43.whiteSoft}
                    fontFamily={FONT_EDITORIAL_SANS_O}
                    fontWeight={700}
                    align="left"
                    lineHeight={1.4}
                  />
                </Look43SlideOut>
              ))}
            </div>
          </div>

          {/* Slanted Editorial Divider Line */}
          <div style={{ flexShrink: 0, padding: '6px 0' }}>
            <Look43RuleLine localFrame={localFrame} delay={18} dur={12} widthPct={100} thickness={2} />
          </div>

          {/* Lower Right Commanding Antithesis / Manifesto Block */}
          <div style={{ flexShrink: 0, paddingLeft: 76, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Look43SlicedText
              text={cmp.rightTitle}
              localFrame={localFrame}
              durationFrames={durationFrames}
              fps={fps}
              delay={10}
              slices={4}
              baseSize={58}
              minSize={32}
              fontFamily={FONT_EDITORIAL_SERIF_O}
              fontWeight={800}
              italic={true}
              align="right"
              lineHeight={1.36}
            />
            <Look43RuleLine localFrame={localFrame} delay={13} dur={10} widthPct={68} align="right" thickness={1.5} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {rightItems.map((item, idx) => (
                <Look43SlantedWipe key={idx} localFrame={localFrame} delay={15 + idx * 3} dur={10}>
                  <FitText
                    text={item}
                    baseSize={34}
                    minSize={22}
                    color={LOOK43.white}
                    fontFamily={FONT_EDITORIAL_SANS_O}
                    fontWeight={900}
                    align="right"
                    lineHeight={1.4}
                  />
                </Look43SlantedWipe>
              ))}
            </div>
          </div>

          <Look43RuleLine localFrame={localFrame} delay={22} dur={10} widthPct={100} thickness={1.5} />
        </div>
      </Look43BlueStage>
    );
  }

  // Manifesto Quote Variant — Words appear one-by-one on sharp editorial beats!
  const manifestoText = scene.quote?.text || t.title || t.subtitle || 'ประโยคที่คมที่สุด ไม่ต้องตะโกน';
  const words = tokenizeManifestoWordsO(manifestoText);
  const totalLen = manifestoText.length;
  const wordFontSize =
    totalLen <= 22 ? 84 : totalLen <= 40 ? 68 : totalLen <= 68 ? 56 : totalLen <= 100 ? 46 : 38;

  // Ensure ALL words land cleanly before the mid-point so the hold period is 100% readable
  const budgetFrames = Math.min(48, Math.max(18, Math.floor(durationFrames * 0.46)));
  const stepFrames = words.length > 1 ? Math.max(2, Math.floor(budgetFrames / words.length)) : 4;
  const attribution = scene.quote?.author
    ? `${scene.quote.author}${scene.quote.role ? ` · ${scene.quote.role}` : ''}`
    : t.subtitle && t.subtitle !== manifestoText
      ? t.subtitle
      : t.badge || `manifesto no. 0${sceneIndex + 1}`;
  const highlightWord = extractHighlightO(scene);

  return (
    <Look43BlueStage>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          paddingTop: 10,
          paddingBottom: 16,
        }}
      >
        {/* Top Kicker + Rule */}
        <div style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <div
              style={{
                fontFamily: FONT_EDITORIAL_SANS_O,
                fontSize: 24,
                fontWeight: 900,
                letterSpacing: '0.06em',
                color: LOOK43.whiteSoft,
              }}
            >
              {t.badge || 'manifesto'}
            </div>
            <div
              style={{
                fontFamily: FONT_EDITORIAL_SERIF_O,
                fontStyle: 'italic',
                fontSize: 28,
                color: LOOK43.whiteSoft,
              }}
            >
              0{sceneIndex + 1}
            </div>
          </div>
          <Look43RuleLine localFrame={localFrame} delay={0} dur={11} widthPct={100} />
        </div>

        {/* Word-by-Word Kinetic Manifesto Block (Zero fades, zero clipping at rest) */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            paddingTop: 18,
            paddingBottom: 18,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              rowGap: 8,
              columnGap: 6,
            }}
          >
            {words.map((word, idx) => {
              const beat = 3 + idx * stepFrames;
              const visible = localFrame >= beat;
              const s = spring({
                frame: Math.max(0, localFrame - beat),
                fps,
                config: { damping: 14, stiffness: 230, mass: 0.8 },
              });
              const settled = localFrame >= beat + 18;
              const y = settled ? 0 : interpolate(s, [0, 1], [34, 0]);
              const isEmphasis =
                idx === words.length - 1 ||
                (highlightWord && highlightWord.length >= 2 && word.includes(highlightWord));

              return (
                <span
                  key={idx}
                  style={{
                    display: 'inline-block',
                    visibility: visible ? 'visible' : 'hidden',
                    transform: `translate3d(0, ${y.toFixed(2)}px, 0)`,
                    fontFamily: isEmphasis ? FONT_EDITORIAL_SERIF_O : FONT_EDITORIAL_SANS_O,
                    fontStyle: isEmphasis ? 'italic' : 'normal',
                    fontSize: isEmphasis ? Math.round(wordFontSize * 1.1) : wordFontSize,
                    fontWeight: isEmphasis ? 800 : 900,
                    color: LOOK43.white,
                    lineHeight: 1.42,
                    letterSpacing: '-0.025em',
                    paddingTop: 2,
                    paddingBottom: 2,
                  }}
                >
                  {word}
                </span>
              );
            })}
          </div>
        </div>

        {/* Closing Rule + Right-Aligned Editorial Attribution */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Look43RuleLine
            localFrame={localFrame}
            delay={Math.min(34, 4 + words.length * stepFrames)}
            dur={12}
            widthPct={100}
          />
          <div style={{ paddingLeft: 120 }}>
            <Look43SlantedWipe
              localFrame={localFrame}
              delay={Math.min(36, 6 + words.length * stepFrames)}
              dur={14}
            >
              <FitText
                text={`— ${attribution}`}
                baseSize={34}
                minSize={22}
                color={LOOK43.white}
                fontFamily={FONT_EDITORIAL_SERIF_O}
                fontWeight={700}
                align="right"
                lineHeight={1.38}
                style={{ fontStyle: 'italic' }}
              />
            </Look43SlantedWipe>
          </div>
        </div>
      </div>
    </Look43BlueStage>
  );
};

// ============================================================================
// EXPORTED REGISTRY DEFINITIONS — BATCH_O (look-42, look-43)
// ============================================================================

export const BATCH_O: StyleDirectorDef[] = [
  {
    styleId: 'look-42',
    caption: 'bar',
    shots: {
      'mag-spread-headline': Look42MagSpreadHeadline,
      'mag-column-notes': Look42MagColumnNotes,
      'mag-pull-stat': Look42MagPullStat,
      'mag-quote-margin': Look42MagQuoteMargin,
    },
    shotLabels: {
      'mag-spread-headline': 'เลย์เอาต์หน้านิตยสารแบบ spread หัวข้อเซริฟขึ้นทีละบรรทัด พร้อมภาพดูโอโทนและปากกาแดงวงคำสำคัญ',
      'mag-column-notes': 'คอลัมน์บทความเรียงประเด็นสำคัญพร้อมเลขข้อใหญ่ เครื่องหมายถูกและขีดเส้นใต้ปากกาแดงไล่ทีละข้อ',
      'mag-pull-stat': 'ตัวเลขสถิติแบบ pull-quote ขนาดใหญ่กลางหน้านิตยสาร พร้อมวงกลมปากกาแดงและลูกศรโน้ตลายมือชี้ประกอบ',
      'mag-quote-margin': 'หน้าคู่สำหรับคำคมหรือเปรียบเทียบสองมุมมอง พร้อมแถบและหมายเหตุลายมือปากกาแดงที่ขอบกระดาษ',
    },
    infer: (scene) => {
      if (scene.stat) {
        return 'mag-pull-stat';
      }
      if (scene.compare || scene.quote?.text) {
        return 'mag-quote-margin';
      }
      if (
        (Array.isArray(scene.bullets) && scene.bullets.length >= 3) ||
        (Array.isArray(scene.steps) && scene.steps.length >= 3)
      ) {
        return 'mag-column-notes';
      }
      void haystackOfO(scene);
      return null;
    },
  },
  {
    styleId: 'look-43',
    caption: 'floating',
    shots: {
      'blue-sliced-title': Look43BlueSlicedTitle,
      'blue-cover-lines': Look43BlueCoverLines,
      'blue-big-number': Look43BlueBigNumber,
      'blue-manifesto-quote': Look43BlueManifestoQuote,
    },
    shotLabels: {
      'blue-sliced-title': 'ปกนิตยสารสีน้ำเงินอัลตรามารีนพร้อมหัวข้อขาวหนาที่ถูกหั่นเป็นแถบแนวนอนเลื่อนสวนกันแล้วประกบสนิท',
      'blue-cover-lines': 'ปกนิตยสารพร้อมหัว masthead และ cover-lines แบบอสมมาตรจากรายการประเด็นสำคัญคั่นด้วยเส้นขาวบาง',
      'blue-big-number': 'ตัวเลขสถิติสีขาวขนาดยักษ์หั่นเป็นแถบแนวนอนแล้วประกบเข้าล็อก พร้อมคำอธิบายสไตล์เอดิทอเรียล',
      'blue-manifesto-quote': 'ประโยคแถลงการณ์หรือข้อเปรียบเทียบบนพื้นน้ำเงินเรียบที่เผยทีละคำอย่างคมชัดและมั่นใจ',
    },
    infer: (scene) => {
      if (scene.stat) {
        return 'blue-big-number';
      }
      if (scene.compare || scene.quote?.text) {
        return 'blue-manifesto-quote';
      }
      if (
        (Array.isArray(scene.bullets) && scene.bullets.length >= 3) ||
        (Array.isArray(scene.steps) && scene.steps.length >= 3)
      ) {
        return 'blue-cover-lines';
      }
      return null;
    },
  },
];
