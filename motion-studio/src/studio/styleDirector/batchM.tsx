import React from 'react';
import { interpolate, spring } from 'remotion';
import { THAI_FONT_FAMILY } from '../../components/ThaiFontLoader';
import type { StudioScene } from '../types';
import {
  FitText,
  SAFE_BOTTOM,
  STAGE_H,
  STAGE_W,
  clamp01,
  easeOutCubic,
  sceneTexts,
  stagger,
} from './kit';
import type { StyleDirectorDef, StyleShotArgs } from './types';

// ============================================================================
// SHARED HELPERS FOR BATCH M (look-38 Frosted Glass UI, look-39 Apple One-Take)
// Pure, Deterministic, Inline SVG/CSS Only, Zero External Assets
// Safe stage bounds: x ∈ [54, 1026], y ∈ [112, CONTENT_BOTTOM (=1420)]
// ============================================================================

const CONTENT_BOTTOM = SAFE_BOTTOM - 120; // 1420
const SAFE_X = 54;
const SAFE_TOP = 112;

const FONT_THAI = THAI_FONT_FAMILY;
const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

// Hardcoded palettes from assets/styles_catalog.json & signatures.tsx
// Note: look-38 catalog swaps color labels/hexes; mapped strictly by visual semantics
const LOOK38 = {
  deepSky: '#071622',
  navy: '#0E2A3D',
  teal: '#1F5A6E',
  coral: '#FF8A5C',
  rose: '#E3558A',
  ink: '#F8F9FB',
  inkMuted: 'rgba(248, 249, 251, 0.72)',
  inkSubtle: 'rgba(248, 249, 251, 0.54)',
  accent: '#FF8A5C',
  accent2: '#9FD8FF',
  glassSmoke: 'rgba(9, 25, 38, 0.56)',
  glassBorder: 'rgba(255, 255, 255, 0.35)',
  glassTopRim: 'rgba(255, 255, 255, 0.48)',
  glassInnerGlow: 'rgba(159, 216, 255, 0.16)',
  textShadow: '0 2px 12px rgba(6, 18, 28, 0.52)',
} as const;

const LOOK39 = {
  ground: '#EEEEEC',
  ink: '#111113',
  inkMuted: 'rgba(17, 17, 19, 0.62)',
  inkFaint: 'rgba(17, 17, 19, 0.42)',
  paper: '#FBFBF9',
  paperSub: '#F4F4F1',
  hairline: 'rgba(17, 17, 19, 0.10)',
  redDot: '#FF3B30',
  tileBlueTop: '#EAF2FE',
  tileBlueBottom: '#D6E7FC',
  tileBlueBorder: 'rgba(17, 17, 19, 0.06)',
} as const;

function seededHashM(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function haystackOfM(scene: StudioScene): string {
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

function splitGraphemesM(text: string): string[] {
  const clean = String(text || '');
  if (!clean) return [];
  const IntlAny = Intl as unknown as {
    Segmenter?: new (
      locale?: string,
      options?: { granularity: 'grapheme' | 'word' | 'sentence' },
    ) => { segment: (input: string) => Iterable<{ segment: string }> };
  };
  if (typeof IntlAny.Segmenter === 'function') {
    try {
      const seg = new IntlAny.Segmenter('th', { granularity: 'grapheme' });
      const out: string[] = [];
      for (const part of seg.segment(clean)) {
        out.push(part.segment);
      }
      if (out.length > 0) return out;
    } catch {
      // Fallback below
    }
  }
  // Deterministic Thai-safe grapheme grouping fallback (attaches combining marks to base char)
  const chars = Array.from(clean);
  const grouped: string[] = [];
  const THAI_MARK_RE = /^[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\uFE0F\u200D]$/;
  for (const ch of chars) {
    if (grouped.length > 0 && THAI_MARK_RE.test(ch)) {
      grouped[grouped.length - 1] += ch;
    } else {
      grouped.push(ch);
    }
  }
  return grouped;
}

function extractPointsM(scene: StudioScene, max = 4): Array<{ title: string; detail: string }> {
  const t = sceneTexts(scene);
  const out: Array<{ title: string; detail: string }> = [];

  if (Array.isArray(scene.steps) && scene.steps.length > 0) {
    for (const s of scene.steps) {
      if (typeof s === 'string') {
        const clean = s.trim();
        if (clean) out.push({ title: clean, detail: '' });
      } else if (s?.title) {
        out.push({
          title: String(s.title).trim(),
          detail: String(s.detail || '').trim(),
        });
      }
    }
  } else if (t.bullets.length > 0) {
    for (const b of t.bullets) {
      const parts = b.split(/\s+[—–-]\s+|:\s+/);
      if (parts.length >= 2 && parts[0].length <= 36) {
        out.push({ title: parts[0].trim(), detail: parts.slice(1).join(' — ').trim() });
      } else {
        out.push({ title: b, detail: '' });
      }
    }
  } else if (scene.compare) {
    const leftItems = (scene.compare.leftItems || []).map((x) => String(x || '').trim()).filter(Boolean);
    const rightItems = (scene.compare.rightItems || []).map((x) => String(x || '').trim()).filter(Boolean);
    for (const item of leftItems) out.push({ title: item, detail: scene.compare.leftTitle || '' });
    for (const item of rightItems) out.push({ title: item, detail: scene.compare.rightTitle || '' });
  } else if (scene.stat) {
    if (scene.stat.label) out.push({ title: scene.stat.label, detail: scene.stat.delta || '' });
    if (t.subtitle) out.push({ title: t.subtitle, detail: '' });
  } else if (scene.quote?.text) {
    out.push({ title: scene.quote.text, detail: scene.quote.author ? `— ${scene.quote.author}` : '' });
  } else if (t.subtitle) {
    out.push({ title: t.subtitle, detail: '' });
  }

  if (out.length === 0 && t.title) {
    out.push({ title: t.title, detail: t.subtitle || '' });
  }
  return out.slice(0, max);
}

function parseNumericM(raw: string | number | undefined, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw || '').replace(/,/g, '');
  const m = s.match(/\d+(?:\.\d+)?/);
  if (!m) return fallback;
  const val = parseFloat(m[0]);
  return Number.isFinite(val) ? val : fallback;
}

function extractPrimaryMetricM(
  scene: StudioScene,
  fallbackNum = 98,
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
    const numeric = scene.stat.numericValue ?? parseNumericM(rawVal, fallbackNum);
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
    const numeric = parseNumericM(first, fallbackNum);
    return {
      big: first,
      unit: '',
      numeric,
      label: t.subtitle || t.title,
      delta: t.badge || '',
      progress: numeric > 0 && numeric <= 100 ? clamp01(numeric / 100) : 0.84,
    };
  }
  return {
    big: `${fallbackNum}${fallbackUnit}`,
    unit: '',
    numeric: fallbackNum,
    label: t.subtitle || t.title || 'ผลลัพธ์สำคัญ',
    delta: t.badge || '',
    progress: 0.9,
  };
}

function formatAnimatedStatM(rawBig: string, numeric: number, progress: number): string {
  const p = clamp01(progress);
  if (p >= 0.995) return rawBig;
  const match = rawBig.match(/\d[\d,]*(?:\.\d+)?/);
  if (!match || match.index === undefined) return rawBig;
  const token = match[0];
  const hasComma = token.includes(',');
  const dotIdx = token.indexOf('.');
  const decimals = dotIdx >= 0 ? token.length - dotIdx - 1 : 0;
  const current = numeric * p;
  let formatted = decimals > 0 ? current.toFixed(decimals) : String(Math.round(current));
  if (hasComma) {
    const parts = formatted.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    formatted = parts.join('.');
  }
  return `${rawBig.slice(0, match.index)}${formatted}${rawBig.slice(match.index + token.length)}`;
}

function extractCompareSidesM(scene: StudioScene): {
  isQuote: boolean;
  quoteText: string;
  quoteAuthor: string;
  leftTitle: string;
  leftItems: string[];
  rightTitle: string;
  rightItems: string[];
} {
  const t = sceneTexts(scene);
  if (scene.compare) {
    const leftItems = (scene.compare.leftItems || []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3);
    const rightItems = (scene.compare.rightItems || []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3);
    return {
      isQuote: false,
      quoteText: '',
      quoteAuthor: '',
      leftTitle: String(scene.compare.leftTitle || 'รูปแบบเดิม').trim(),
      leftItems: leftItems.length > 0 ? leftItems : [t.subtitle || t.title || 'ประเด็นฝั่งแรก'],
      rightTitle: String(scene.compare.rightTitle || 'รูปแบบใหม่').trim(),
      rightItems: rightItems.length > 0 ? rightItems : [t.bullets[0] || t.title || 'ประเด็นฝั่งเปรียบเทียบ'],
    };
  }
  if (scene.quote?.text) {
    return {
      isQuote: true,
      quoteText: String(scene.quote.text).trim(),
      quoteAuthor: String(scene.quote.author || t.badge || t.title || '').trim(),
      leftTitle: '',
      leftItems: [],
      rightTitle: '',
      rightItems: [],
    };
  }
  const pts = extractPointsM(scene, 4);
  const mid = Math.max(1, Math.ceil(pts.length / 2));
  const left = pts.slice(0, mid).map((p) => p.title);
  const right = pts.slice(mid).map((p) => p.title);
  return {
    isQuote: false,
    quoteText: '',
    quoteAuthor: '',
    leftTitle: t.badge || 'ประเด็นหลัก',
    leftItems: left.length > 0 ? left : [t.title || 'มุมมองที่หนึ่ง'],
    rightTitle: 'ผลลัพธ์ที่ได้',
    rightItems: right.length > 0 ? right : [t.subtitle || t.title || 'มุมมองที่สอง'],
  };
}

function extractHighlightTextM(scene: StudioScene): string {
  if (!scene.highlight) return '';
  if (Array.isArray(scene.highlight)) {
    return scene.highlight.map((x) => String(x || '').trim()).filter(Boolean).join(' · ');
  }
  return String(scene.highlight).trim();
}

function computeTypingTimelineM(
  graphemes: string[],
  startFrame: number,
  maxTypingFrames: number,
): { charEndFrames: number[]; finishFrame: number } {
  if (graphemes.length === 0) {
    return { charEndFrames: [], finishFrame: startFrame };
  }
  const rawDurations: number[] = [];
  let rawTotal = 0;
  for (let i = 0; i < graphemes.length; i++) {
    const g = graphemes[i];
    const jitter = (seededHashM(i * 19.7 + 7.3) - 0.5) * 0.45;
    const isPauseChar = g === ' ' || g === '—' || g === ':' || g === ',' || g === '·';
    const d = (isPauseChar ? 2.6 : 1.3) + jitter;
    rawDurations.push(Math.max(0.75, d));
    rawTotal += Math.max(0.75, d);
  }
  const scale = rawTotal > maxTypingFrames ? maxTypingFrames / rawTotal : 1;
  const charEndFrames: number[] = [];
  let acc = startFrame;
  for (let i = 0; i < rawDurations.length; i++) {
    acc += rawDurations[i] * scale;
    charEndFrames.push(acc);
  }
  return { charEndFrames, finishFrame: acc };
}

// ============================================================================
// LOOK-38: FROSTED GLASS UI (UI กระจกฝ้า)
// Defocused procedural dusk backdrop + smoked frosted glass surfaces
// ============================================================================

interface Look38BokehSpec {
  id: number;
  x: number;
  y: number;
  r: number;
  color: string;
  alpha: number;
  speedX: number;
  speedY: number;
  isCityLight: boolean;
}

function buildLook38BokehM(sceneIndex: number): Look38BokehSpec[] {
  const baseSeed = (sceneIndex + 1) * 53.7;
  const specs: Look38BokehSpec[] = [];

  // 7 large uneven out-of-focus bokeh orbs across sky & horizon
  const bigColors = [
    LOOK38.coral,
    LOOK38.accent2,
    LOOK38.rose,
    '#FFD4B8',
    LOOK38.teal,
    LOOK38.coral,
    LOOK38.accent2,
  ];
  for (let i = 0; i < 7; i++) {
    const h1 = seededHashM(baseSeed + i * 11.3 + 1);
    const h2 = seededHashM(baseSeed + i * 17.9 + 2);
    const h3 = seededHashM(baseSeed + i * 23.1 + 3);
    const h4 = seededHashM(baseSeed + i * 31.7 + 4);
    specs.push({
      id: i,
      x: 70 + h1 * (STAGE_W - 140),
      y: 130 + h2 * 1080,
      r: 86 + h3 * 138,
      color: bigColors[i % bigColors.length],
      alpha: 0.10 + h4 * 0.12,
      speedX: (h3 - 0.45) * 7.5,
      speedY: (h4 - 0.55) * 4.5,
      isCityLight: false,
    });
  }

  // 14 smaller out-of-focus city lights clustered organically along the dusk horizon
  const cityColors = ['#FFB58A', '#FFE3C6', '#FF8A5C', '#9FD8FF', '#F39BB9'];
  for (let i = 0; i < 14; i++) {
    const h1 = seededHashM(baseSeed + 200 + i * 13.7);
    const h2 = seededHashM(baseSeed + 200 + i * 29.3);
    const h3 = seededHashM(baseSeed + 200 + i * 41.1);
    const clusterCenter = i < 7 ? 310 : 760;
    const spread = (h1 - 0.5) * 460;
    specs.push({
      id: 100 + i,
      x: Math.max(40, Math.min(STAGE_W - 40, clusterCenter + spread)),
      y: 890 + h2 * 310,
      r: 14 + h3 * 30,
      color: cityColors[i % cityColors.length],
      alpha: 0.16 + h2 * 0.22,
      speedX: (h1 - 0.5) * 3.8,
      speedY: -1.4 - h3 * 1.6,
      isCityLight: true,
    });
  }

  return specs;
}

const Look38DuskBackdrop: React.FC<{ localFrame: number; fps: number; sceneIndex: number }> = ({
  localFrame,
  fps,
  sceneIndex,
}) => {
  const safeFps = Math.max(1, fps || 30);
  const sec = localFrame / safeFps;
  const driftX = sec * 4.2;
  const driftY = sec * -2.6;
  const bokehs = React.useMemo(() => buildLook38BokehM(sceneIndex), [sceneIndex]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        backgroundColor: LOOK38.deepSky,
        backgroundImage: [
          // Soft coral dusk horizon glow
          `radial-gradient(ellipse 76% 36% at ${52 + driftX * 0.12}% ${60 + driftY * 0.08}%, rgba(255, 138, 92, 0.44) 0%, rgba(227, 85, 138, 0.22) 42%, rgba(14, 42, 61, 0) 76%)`,
          // Upper-left teal atmospheric field
          `radial-gradient(ellipse 68% 44% at ${24 - driftX * 0.08}% ${22 + driftY * 0.06}%, rgba(31, 90, 110, 0.72) 0%, rgba(31, 90, 110, 0.28) 46%, rgba(14, 42, 61, 0) 80%)`,
          // Mid-right rose dusk wash
          `radial-gradient(ellipse 58% 34% at ${82 + driftX * 0.09}% ${46 - driftY * 0.05}%, rgba(227, 85, 138, 0.30) 0%, rgba(227, 85, 138, 0.10) 48%, rgba(14, 42, 61, 0) 78%)`,
          // High cool sky highlight
          `radial-gradient(ellipse 52% 28% at ${70 - driftX * 0.06}% ${14 + driftY * 0.04}%, rgba(159, 216, 255, 0.16) 0%, rgba(14, 42, 61, 0) 72%)`,
          // Base twilight sky-to-dark-ground gradient (bottom fifth dark & calm for subtitles)
          `linear-gradient(180deg, #091B29 0%, #12364A 24%, #1F5A6E 46%, #143244 66%, #091926 82%, #050E16 100%)`,
        ].join(', '),
      }}
    >
      {/* Deterministic defocused bokeh circles & horizon city lights (pure radial gradients, zero blur filter) */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        <defs>
          {bokehs.map((b) => (
            <radialGradient key={`bg-${b.id}`} id={`l38-bokeh-${sceneIndex}-${b.id}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={b.color} stopOpacity={b.isCityLight ? b.alpha * 1.15 : b.alpha * 0.72} />
              <stop offset="56%" stopColor={b.color} stopOpacity={b.isCityLight ? b.alpha * 0.55 : b.alpha * 0.52} />
              <stop offset="82%" stopColor={b.color} stopOpacity={b.isCityLight ? b.alpha * 0.18 : b.alpha * 0.36} />
              <stop offset="100%" stopColor={b.color} stopOpacity={0} />
            </radialGradient>
          ))}
          {/* Subtle static micro-dither pattern to prevent 8-bit video gradient banding */}
          <pattern id={`l38-grain-${sceneIndex}`} width="6" height="6" patternUnits="userSpaceOnUse">
            <rect x="0" y="0" width="1.5" height="1.5" fill="#FFFFFF" fillOpacity="0.022" />
            <rect x="3" y="2" width="1.5" height="1.5" fill="#000000" fillOpacity="0.028" />
            <rect x="1" y="4" width="1.5" height="1.5" fill="#9FD8FF" fillOpacity="0.018" />
            <rect x="4" y="5" width="1.5" height="1.5" fill="#FFFFFF" fillOpacity="0.016" />
          </pattern>
        </defs>
        {bokehs.map((b) => {
          const cx = b.x + b.speedX * sec;
          const cy = b.y + b.speedY * sec;
          return (
            <circle
              key={`c-${b.id}`}
              cx={cx}
              cy={cy}
              r={b.r}
              fill={`url(#l38-bokeh-${sceneIndex}-${b.id})`}
            />
          );
        })}
        <rect x={0} y={0} width={STAGE_W} height={STAGE_H} fill={`url(#l38-grain-${sceneIndex})`} />
      </svg>

      {/* Soft lens corner vignette + dark bottom fifth guard */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          backgroundImage: [
            'radial-gradient(ellipse 84% 72% at 50% 42%, rgba(5, 14, 22, 0) 46%, rgba(5, 14, 22, 0.58) 100%)',
            'linear-gradient(180deg, rgba(5, 14, 22, 0.24) 0%, rgba(5, 14, 22, 0) 14%, rgba(5, 14, 22, 0) 70%, rgba(4, 11, 18, 0.72) 86%, rgba(4, 10, 16, 0.90) 100%)',
          ].join(', '),
        }}
      />
    </div>
  );
};

function look38GlassSurfaceStyle(radius: number, emphasis: 'normal' | 'bright' | 'subtle' = 'normal'): React.CSSProperties {
  const topWhite = emphasis === 'bright' ? 0.20 : emphasis === 'subtle' ? 0.12 : 0.16;
  const midWhite = emphasis === 'bright' ? 0.13 : emphasis === 'subtle' ? 0.08 : 0.11;
  const botWhite = emphasis === 'bright' ? 0.08 : 0.05;
  const smokeAlpha = emphasis === 'bright' ? 0.48 : emphasis === 'subtle' ? 0.58 : 0.54;

  return {
    borderRadius: radius,
    backgroundColor: `rgba(9, 25, 38, ${smokeAlpha})`,
    backgroundImage: [
      // Specular top-left glass reflection sheen
      `linear-gradient(142deg, rgba(255, 255, 255, ${topWhite}) 0%, rgba(255, 255, 255, ${midWhite}) 40%, rgba(159, 216, 255, ${botWhite}) 74%, rgba(255, 138, 92, 0.06) 100%)`,
      // Soft dusk color bleed echoed inside frosted glass
      'radial-gradient(ellipse 72% 85% at 14% 0%, rgba(159, 216, 255, 0.16) 0%, rgba(159, 216, 255, 0) 64%)',
      'radial-gradient(ellipse 66% 78% at 88% 100%, rgba(255, 138, 92, 0.14) 0%, rgba(255, 138, 92, 0) 64%)',
    ].join(', '),
    border: `1px solid ${LOOK38.glassBorder}`,
    boxShadow: [
      `inset 1px 1px 0 ${LOOK38.glassTopRim}`,
      `inset 0 18px 34px -18px ${LOOK38.glassInnerGlow}`,
      'inset 0 -1px 0 rgba(255, 255, 255, 0.12)',
      '0 24px 56px rgba(3, 10, 18, 0.46)',
      '0 6px 18px rgba(3, 10, 18, 0.28)',
    ].join(', '),
  };
}

const Look38SearchIcon: React.FC<{ size?: number; color?: string }> = ({ size = 34, color = LOOK38.ink }) => (
  <svg width={size} height={size} viewBox="0 0 28 28" fill="none" style={{ flexShrink: 0 }}>
    <circle cx="12.5" cy="12.5" r="7.5" stroke={color} strokeWidth="2.4" strokeOpacity="0.92" />
    <path d="M18.2 18.2L23.5 23.5" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeOpacity="0.92" />
  </svg>
);

const Look38RowIconGlyph: React.FC<{ index: number; active: boolean }> = ({ index, active }) => {
  const stroke = active ? LOOK38.accent2 : LOOK38.ink;
  const kind = index % 4;
  return (
    <div
      style={{
        width: 52,
        height: 52,
        borderRadius: 14,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? 'rgba(159, 216, 255, 0.22)' : 'rgba(255, 255, 255, 0.12)',
        border: `1px solid ${active ? 'rgba(159, 216, 255, 0.52)' : 'rgba(255, 255, 255, 0.24)'}`,
        boxShadow: 'inset 1px 1px 0 rgba(255, 255, 255, 0.34)',
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        {kind === 0 && (
          <>
            <path d="M12 4L14.4 9.2L20 10L16 14L17 19.6L12 16.9L7 19.6L8 14L4 10L9.6 9.2L12 4Z" stroke={stroke} strokeWidth="1.9" strokeLinejoin="round" />
          </>
        )}
        {kind === 1 && (
          <>
            <rect x="4" y="5" width="16" height="14" rx="3" stroke={stroke} strokeWidth="1.9" />
            <path d="M8 10H16M8 14H13" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" />
          </>
        )}
        {kind === 2 && (
          <>
            <circle cx="12" cy="12" r="7.5" stroke={stroke} strokeWidth="1.9" />
            <path d="M12 8.5V12.5L14.8 14.2" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" />
          </>
        )}
        {kind === 3 && (
          <>
            <path d="M5 12.5L9.5 17L19 7.5" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
      </svg>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Look38 Shot 1: 'glass-search-type'
// Wide frosted search bar (~85% width, radius 48px), spring settle from 0.9,
// human-cadence grapheme typing, solid->blinking cursor, unfolding preview pane
// ----------------------------------------------------------------------------
const Look38GlassSearchType: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, durationFrames, fps }) => {
  const t = sceneTexts(scene);
  const safeFps = Math.max(1, fps || 30);
  const query = t.title || t.subtitle || t.badge || 'ค้นหาไอเดียสำคัญ';
  const graphemes = React.useMemo(() => splitGraphemesM(query), [query]);

  // Settle on frame 0 from scale 0.90 with soft spring overshoot (never blank on frame 0)
  const entrySp = spring({
    frame: localFrame,
    fps: safeFps,
    config: { damping: 12, stiffness: 155, mass: 0.9 },
  });
  const barScale = interpolate(entrySp, [0, 1], [0.9, 1]);
  const barYShift = interpolate(entrySp, [0, 1], [28, 0]);

  // Typing timeline (~1.3 frames per grapheme, capped to finish before hold)
  const maxTypingFrames = Math.max(22, Math.min(72, Math.floor(durationFrames * 0.54)));
  const timeline = React.useMemo(
    () => computeTypingTimelineM(graphemes, 6, maxTypingFrames),
    [graphemes, maxTypingFrames],
  );

  let typedCount = 0;
  for (let i = 0; i < timeline.charEndFrames.length; i++) {
    if (localFrame >= timeline.charEndFrames[i]) typedCount = i + 1;
    else break;
  }
  const isTyping = localFrame >= 6 && typedCount < graphemes.length;
  const typedText = graphemes.slice(0, typedCount).join('');

  // Cursor solid while typing, blinks smoothly when idle
  const idleFrames = Math.max(0, localFrame - timeline.finishFrame);
  const cursorVisible = isTyping || localFrame < 6 || Math.floor(idleFrames / 14) % 2 === 0;

  // Dynamic font size proportional to query length so Thai text never overflows or clips
  const gLen = graphemes.length;
  const queryFontSize = gLen > 42 ? 30 : gLen > 30 ? 35 : gLen > 20 ? 40 : 46;

  // Supporting preview card unfolds smoothly beneath the bar once typing nears completion
  const subPoints = extractPointsM(scene, 2);
  const hlText = extractHighlightTextM(scene);
  const hasPreview = Boolean(t.subtitle || hlText || subPoints.length > 0);
  const unfoldStart = Math.max(18, Math.floor(timeline.finishFrame - 4));
  const unfoldSp = spring({
    frame: Math.max(0, localFrame - unfoldStart),
    fps: safeFps,
    config: { damping: 13, stiffness: 150, mass: 0.92 },
  });

  // Search bar glides gently upward when preview unfolds
  const glideUp = hasPreview ? interpolate(unfoldSp, [0, 1], [0, -110]) : 0;
  const barWidth = Math.round(STAGE_W * 0.85); // 918px (strictly within SAFE_W=972)
  const barLeft = Math.round((STAGE_W - barWidth) / 2); // 81px

  const badgeSp = spring({
    frame: Math.max(0, localFrame - 3),
    fps: safeFps,
    config: { damping: 14, stiffness: 170, mass: 0.85 },
  });

  const retSp = spring({
    frame: Math.max(0, localFrame - Math.floor(timeline.finishFrame + 4)),
    fps: safeFps,
    config: { damping: 12, stiffness: 210, mass: 0.75 },
  });

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <Look38DuskBackdrop localFrame={localFrame} fps={safeFps} sceneIndex={sceneIndex} />

      {/* Safe stage container: x ∈ [54, 1026], y ∈ [112, 1420] */}
      <div
        style={{
          position: 'absolute',
          left: barLeft,
          top: SAFE_TOP + 120,
          width: barWidth,
          maxHeight: CONTENT_BOTTOM - (SAFE_TOP + 120),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          transform: `translateY(${Math.round(barYShift + glideUp + 170)}px)`,
        }}
      >
        {/* Optional top frosted context chip */}
        {t.badge ? (
          <div
            style={{
              alignSelf: 'flex-start',
              marginBottom: 20,
              padding: '10px 24px',
              ...look38GlassSurfaceStyle(999, 'subtle'),
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              transform: `scale(${interpolate(badgeSp, [0, 1], [0.88, 1])}) translateY(${interpolate(badgeSp, [0, 1], [14, 0])}px)`,
            }}
          >
            <div
              style={{
                width: 9,
                height: 9,
                borderRadius: 999,
                backgroundColor: LOOK38.coral,
                boxShadow: '0 0 10px rgba(255, 138, 92, 0.8)',
              }}
            />
            <FitText
              text={t.badge}
              baseSize={24}
              minSize={18}
              maxLines={1}
              lineHeight={1.38}
              color={LOOK38.ink}
              fontWeight={600}
              align="left"
              style={{ textShadow: LOOK38.textShadow }}
            />
          </div>
        ) : null}

        {/* Primary Frosted Glass Search Bar (85% width, 48px radius) */}
        <div
          style={{
            width: '100%',
            minHeight: 118,
            padding: '26px 32px',
            boxSizing: 'border-box',
            ...look38GlassSurfaceStyle(48, 'bright'),
            display: 'flex',
            alignItems: 'center',
            gap: 22,
            transform: `scale(${barScale})`,
            transformOrigin: 'center center',
            zIndex: 2,
          }}
        >
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: 999,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(159, 216, 255, 0.16)',
              border: '1px solid rgba(255, 255, 255, 0.28)',
            }}
          >
            <Look38SearchIcon size={28} color={LOOK38.ink} />
          </div>

          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: FONT_THAI,
              fontSize: queryFontSize,
              fontWeight: 600,
              lineHeight: 1.4,
              color: LOOK38.ink,
              textShadow: LOOK38.textShadow,
              wordBreak: 'keep-all',
              overflowWrap: 'break-word',
              paddingTop: 2,
              paddingBottom: 2,
            }}
          >
            <span>{typedText || '\u200B'}</span>
            <span
              style={{
                display: 'inline-block',
                width: 4,
                height: Math.round(queryFontSize * 0.96),
                marginLeft: 4,
                borderRadius: 3,
                verticalAlign: 'middle',
                backgroundColor: LOOK38.ink,
                boxShadow: '0 0 12px rgba(159, 216, 255, 0.85)',
                opacity: cursorVisible ? 1 : 0,
                transform: 'translateY(-2px)',
              }}
            />
          </div>

          {/* Return keycap pops in once typing finishes */}
          <div
            style={{
              flexShrink: 0,
              padding: '10px 18px',
              borderRadius: 16,
              backgroundColor: 'rgba(255, 255, 255, 0.16)',
              border: '1px solid rgba(255, 255, 255, 0.34)',
              color: LOOK38.ink,
              fontFamily: FONT_MONO,
              fontSize: 24,
              fontWeight: 700,
              transform: `scale(${interpolate(retSp, [0, 1], [0.5, 1])})`,
              opacity: clamp01(retSp * 1.4),
            }}
          >
            ↵
          </div>
        </div>

        {/* Unfolding Frosted Glass Context Card beneath search bar */}
        {hasPreview ? (
          <div
            style={{
              marginTop: 22,
              width: '100%',
              padding: '28px 34px',
              boxSizing: 'border-box',
              ...look38GlassSurfaceStyle(26, 'normal'),
              transformOrigin: 'top center',
              transform: `translateY(${interpolate(unfoldSp, [0, 1], [-36, 0])}px) scaleY(${interpolate(unfoldSp, [0, 1], [0.06, 1])})`,
              opacity: localFrame >= unfoldStart ? 1 : 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            {t.subtitle ? (
              <FitText
                text={t.subtitle}
                baseSize={34}
                minSize={22}
                maxLines={3}
                lineHeight={1.42}
                color={LOOK38.ink}
                fontWeight={500}
                align="left"
                style={{ textShadow: LOOK38.textShadow }}
              />
            ) : null}

            {hlText ? (
              <div
                style={{
                  alignSelf: 'flex-start',
                  padding: '8px 18px',
                  borderRadius: 14,
                  backgroundColor: 'rgba(255, 138, 92, 0.20)',
                  border: '1px solid rgba(255, 138, 92, 0.48)',
                }}
              >
                <FitText
                  text={hlText}
                  baseSize={24}
                  minSize={18}
                  maxLines={2}
                  lineHeight={1.38}
                  color={LOOK38.ink}
                  fontWeight={600}
                  align="left"
                />
              </div>
            ) : null}

            {!t.subtitle && subPoints.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {subPoints.map((pt, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 999,
                        backgroundColor: idx === 0 ? LOOK38.accent2 : LOOK38.coral,
                        marginTop: 14,
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <FitText
                        text={pt.title}
                        baseSize={30}
                        minSize={21}
                        maxLines={2}
                        lineHeight={1.38}
                        color={LOOK38.ink}
                        fontWeight={500}
                        align="left"
                        style={{ textShadow: LOOK38.textShadow }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Look38 Shot 2: 'glass-results-select'
// Search bar glides up, radius-22 glass panel unfolds with ~9% overshoot,
// rows drop in 3f staggered with ~10% overshoot, elastic highlight bar stretches
// (stiff leading spring, soft trailing spring), ends with press pulse + return key
// ----------------------------------------------------------------------------
const Look38GlassResultsSelect: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, durationFrames, fps }) => {
  const t = sceneTexts(scene);
  const safeFps = Math.max(1, fps || 30);
  const rows = extractPointsM(scene, 4);
  const query = t.title || t.badge || 'ผลลัพธ์ที่แนะนำ';

  const barWidth = Math.round(STAGE_W * 0.85); // 918px
  const barLeft = Math.round((STAGE_W - barWidth) / 2); // 81px

  // Phase 1: search bar starts centered and glides up quickly
  const glideSp = spring({
    frame: Math.max(0, localFrame - 4),
    fps: safeFps,
    config: { damping: 14, stiffness: 145, mass: 0.9 },
  });
  const searchBarY = interpolate(glideSp, [0, 1], [430, 168]);
  const barScale = interpolate(
    spring({ frame: localFrame, fps: safeFps, config: { damping: 12, stiffness: 170, mass: 0.85 } }),
    [0, 1],
    [0.92, 1],
  );

  // Phase 2: results panel unfolds from behind search bar (~9% overshoot)
  const panelDelay = 8;
  const panelSp = spring({
    frame: Math.max(0, localFrame - panelDelay),
    fps: safeFps,
    config: { damping: 12.5, stiffness: 155, mass: 0.9 },
  });

  // Row geometry: strictly fits above CONTENT_BOTTOM = 1420
  const rowCount = Math.max(1, rows.length);
  const rowHeight = rowCount >= 4 ? 176 : rowCount === 3 ? 198 : 216;
  const rowGap = 12;
  const panelPadY = 20;
  const panelPadX = 14; // Spec: highlight inset 14px, corner radius 14px smaller feel

  // Elastic highlight travels from row 0 -> targetRow
  const targetRow = rowCount > 1 ? Math.min(rowCount - 1, Math.max(1, rowCount - 1)) : 0;
  const travelStart = Math.min(Math.floor(durationFrames * 0.36), 34);

  // Stiff spring for leading (bottom) edge, softer spring for trailing (top) edge -> elastic stretch!
  const leadSp = spring({
    frame: Math.max(0, localFrame - travelStart),
    fps: safeFps,
    config: { damping: 18, stiffness: 260, mass: 0.78 },
  });
  const trailSp = spring({
    frame: Math.max(0, localFrame - (travelStart + 3)),
    fps: safeFps,
    config: { damping: 15, stiffness: 125, mass: 1.05 },
  });

  const startTop = panelPadY;
  const endTop = panelPadY + targetRow * (rowHeight + rowGap);
  const hlTop = interpolate(trailSp, [0, 1], [startTop, endTop]);
  const hlBottom = interpolate(leadSp, [0, 1], [startTop + rowHeight, endTop + rowHeight]);
  const hlHeight = Math.max(rowHeight, hlBottom - hlTop);

  // Selection press pulse + return button pop-in once highlight lands
  const selectFrame = travelStart + 18;
  const pressElapsed = localFrame - selectFrame;
  const pressPulse =
    pressElapsed >= 0 && pressElapsed <= 14
      ? 1 - 0.022 * Math.sin(clamp01(pressElapsed / 14) * Math.PI)
      : 1;
  const returnPop = spring({
    frame: Math.max(0, localFrame - (selectFrame + 2)),
    fps: safeFps,
    config: { damping: 11, stiffness: 220, mass: 0.75 },
  });

  const activeIndex = leadSp > 0.55 ? targetRow : 0;

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <Look38DuskBackdrop localFrame={localFrame} fps={safeFps} sceneIndex={sceneIndex} />

      {/* Search bar + unfolding results panel stacked in a flex column to guarantee zero overlap */}
      <div
        style={{
          position: 'absolute',
          left: barLeft,
          top: searchBarY,
          width: barWidth,
          maxHeight: CONTENT_BOTTOM - searchBarY,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* Search bar gliding up */}
        <div
          style={{
            width: '100%',
            minHeight: 108,
            padding: '22px 30px',
            boxSizing: 'border-box',
            ...look38GlassSurfaceStyle(48, 'bright'),
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            transform: `scale(${barScale})`,
            zIndex: 4,
          }}
        >
          <Look38SearchIcon size={30} color={LOOK38.accent2} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <FitText
              text={query}
              baseSize={38}
              minSize={24}
              maxLines={2}
              lineHeight={1.36}
              color={LOOK38.ink}
              fontWeight={600}
              align="left"
              style={{ textShadow: LOOK38.textShadow }}
            />
          </div>
          <div
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              backgroundColor: 'rgba(159, 216, 255, 0.16)',
              border: '1px solid rgba(159, 216, 255, 0.36)',
              fontFamily: FONT_MONO,
              fontSize: 20,
              fontWeight: 700,
              color: LOOK38.accent2,
              flexShrink: 0,
            }}
          >
            {rowCount} รายการ
          </div>
        </div>

        {/* Results Frosted Glass Panel (radius 22px) unfolding beneath search bar */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            padding: `${panelPadY}px ${panelPadX}px`,
            boxSizing: 'border-box',
            ...look38GlassSurfaceStyle(22, 'normal'),
            transformOrigin: 'top center',
            transform: `translateY(${interpolate(panelSp, [0, 1], [-42, 0])}px) scaleY(${interpolate(panelSp, [0, 1], [0.05, 1])})`,
            opacity: localFrame >= panelDelay ? 1 : 0,
            zIndex: 2,
          }}
        >
        {/* Elastic stretching highlight pill (inset 14px, radius 14px) */}
        <div
          style={{
            position: 'absolute',
            left: panelPadX,
            right: panelPadX,
            top: hlTop,
            height: hlHeight,
            borderRadius: 14,
            backgroundImage:
              'linear-gradient(125deg, rgba(255, 255, 255, 0.22) 0%, rgba(159, 216, 255, 0.18) 65%, rgba(255, 138, 92, 0.14) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.42)',
            boxShadow:
              'inset 1px 1px 0 rgba(255, 255, 255, 0.46), 0 10px 26px rgba(4, 14, 24, 0.32)',
            transform: `scale(${pressPulse})`,
            transformOrigin: 'center center',
            pointerEvents: 'none',
          }}
        />

        {/* Staggered Rows (3f apart, ~10% spring overshoot, aligned left) */}
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: rowGap }}>
          {rows.map((row, idx) => {
            const rowDelay = panelDelay + 4 + idx * 3;
            const rowSp = spring({
              frame: Math.max(0, localFrame - rowDelay),
              fps: safeFps,
              config: { damping: 11.5, stiffness: 175, mass: 0.85 },
            });
            const rowY = interpolate(rowSp, [0, 1], [-38, 0]);
            const rowScale = interpolate(rowSp, [0, 1], [0.94, 1]);
            const isSelected = idx === activeIndex;
            const isFinalSelected = idx === targetRow && localFrame >= selectFrame;

            return (
              <div
                key={idx}
                style={{
                  height: rowHeight,
                  padding: '0 22px',
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 20,
                  transform: `translateY(${rowY}px) scale(${isFinalSelected ? rowScale * pressPulse : rowScale})`,
                  opacity: localFrame >= rowDelay ? 1 : 0,
                }}
              >
                <Look38RowIconGlyph index={idx} active={isSelected} />

                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <FitText
                    text={row.title}
                    baseSize={rowCount >= 4 ? 32 : 36}
                    minSize={21}
                    maxLines={2}
                    lineHeight={1.36}
                    color={LOOK38.ink}
                    fontWeight={isSelected ? 700 : 600}
                    align="left"
                    style={{ textShadow: LOOK38.textShadow }}
                  />
                  {row.detail ? (
                    <FitText
                      text={row.detail}
                      baseSize={24}
                      minSize={18}
                      maxLines={1}
                      lineHeight={1.36}
                      color={LOOK38.inkMuted}
                      fontWeight={500}
                      align="left"
                    />
                  ) : null}
                </div>

                {/* Return keycap pops in on final selected row */}
                {idx === targetRow ? (
                  <div
                    style={{
                      flexShrink: 0,
                      padding: '10px 18px',
                      borderRadius: 12,
                      backgroundColor: 'rgba(255, 138, 92, 0.24)',
                      border: '1px solid rgba(255, 138, 92, 0.65)',
                      color: LOOK38.ink,
                      fontFamily: FONT_MONO,
                      fontSize: 22,
                      fontWeight: 700,
                      boxShadow: '0 4px 14px rgba(255, 138, 92, 0.28)',
                      transform: `scale(${interpolate(returnPop, [0, 1], [0.2, 1])})`,
                      opacity: localFrame >= selectFrame ? clamp01(returnPop * 1.3) : 0,
                    }}
                  >
                    ↵ เลือก
                  </div>
                ) : (
                  <div
                    style={{
                      flexShrink: 0,
                      fontFamily: FONT_MONO,
                      fontSize: 22,
                      fontWeight: 600,
                      color: LOOK38.inkSubtle,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    0{idx + 1}
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </div>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Look38 Shot 3: 'glass-stat-card'
// Frosted glass hero card with animated count-up stat, progress bar & label
// ----------------------------------------------------------------------------
const Look38GlassStatCard: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, durationFrames, fps }) => {
  const t = sceneTexts(scene);
  const safeFps = Math.max(1, fps || 30);
  const metric = extractPrimaryMetricM(scene, 98, '%');

  const cardWidth = Math.round(STAGE_W * 0.85); // 918px
  const cardLeft = Math.round((STAGE_W - cardWidth) / 2);

  const cardSp = spring({
    frame: localFrame,
    fps: safeFps,
    config: { damping: 12.5, stiffness: 145, mass: 0.92 },
  });
  const countDur = Math.max(24, Math.min(54, Math.floor(durationFrames * 0.52)));
  const countProg = easeOutCubic(clamp01((localFrame - 4) / countDur));
  const animatedBig = formatAnimatedStatM(metric.big, metric.numeric, countProg);

  const barSp = spring({
    frame: Math.max(0, localFrame - 10),
    fps: safeFps,
    config: { damping: 16, stiffness: 120, mass: 1 },
  });
  const fillPct = Math.round(clamp01(metric.progress * barSp) * 100);

  const subCardSp = spring({
    frame: Math.max(0, localFrame - 16),
    fps: safeFps,
    config: { damping: 13.5, stiffness: 155, mass: 0.88 },
  });

  const extraNote = t.bullets[0] || (t.subtitle && t.subtitle !== metric.label ? t.subtitle : '');

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <Look38DuskBackdrop localFrame={localFrame} fps={safeFps} sceneIndex={sceneIndex} />

      <div
        style={{
          position: 'absolute',
          left: cardLeft,
          top: 230,
          width: cardWidth,
          maxHeight: CONTENT_BOTTOM - 230,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        {/* Main Frosted Glass Metric Card */}
        <div
          style={{
            width: '100%',
            padding: '44px 44px 48px',
            boxSizing: 'border-box',
            ...look38GlassSurfaceStyle(36, 'bright'),
            display: 'flex',
            flexDirection: 'column',
            gap: 28,
            transform: `scale(${interpolate(cardSp, [0, 1], [0.9, 1])}) translateY(${interpolate(cardSp, [0, 1], [34, 0])}px)`,
          }}
        >
          {/* Card top bar: icon + badge/title + live indicator */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  backgroundColor: 'rgba(255, 138, 92, 0.22)',
                  border: '1px solid rgba(255, 138, 92, 0.55)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M5 17L10 12L13.5 15.5L19 8" stroke={LOOK38.coral} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M15 8H19V12" stroke={LOOK38.coral} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <FitText
                  text={t.badge || t.title || 'ข้อมูลสำคัญ'}
                  baseSize={30}
                  minSize={20}
                  maxLines={2}
                  lineHeight={1.36}
                  color={LOOK38.inkMuted}
                  fontWeight={600}
                  align="left"
                />
              </div>
            </div>

            {metric.delta ? (
              <div
                style={{
                  padding: '8px 18px',
                  borderRadius: 999,
                  backgroundColor: 'rgba(159, 216, 255, 0.18)',
                  border: '1px solid rgba(159, 216, 255, 0.45)',
                  flexShrink: 0,
                  maxWidth: 280,
                }}
              >
                <FitText
                  text={metric.delta}
                  baseSize={24}
                  minSize={17}
                  maxLines={1}
                  lineHeight={1.35}
                  color={LOOK38.accent2}
                  fontWeight={700}
                  align="center"
                />
              </div>
            ) : null}
          </div>

          {/* Big Animated Count-Up Number */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 10, paddingBottom: 6 }}>
            <div style={{ width: '100%' }}>
              <FitText
                text={animatedBig}
                baseSize={124}
                minSize={58}
                maxLines={1}
                lineHeight={1.2}
                color={LOOK38.ink}
                fontWeight={800}
                align="center"
                style={{
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '-0.02em',
                  textShadow: '0 8px 28px rgba(4, 16, 28, 0.52)',
                }}
              />
            </div>

            {metric.unit ? (
              <FitText
                text={metric.unit}
                baseSize={34}
                minSize={22}
                maxLines={1}
                lineHeight={1.38}
                color={LOOK38.coral}
                fontWeight={700}
                align="center"
                style={{ textShadow: LOOK38.textShadow }}
              />
            ) : null}
          </div>

          {/* Glass Progress Bar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              style={{
                width: '100%',
                height: 14,
                borderRadius: 999,
                backgroundColor: 'rgba(255, 255, 255, 0.12)',
                border: '1px solid rgba(255, 255, 255, 0.22)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${fillPct}%`,
                  height: '100%',
                  borderRadius: 999,
                  backgroundImage: `linear-gradient(90deg, ${LOOK38.coral} 0%, ${LOOK38.accent2} 100%)`,
                  boxShadow: '0 0 18px rgba(159, 216, 255, 0.55)',
                }}
              />
            </div>
          </div>

          {/* Stat Label */}
          <FitText
            text={metric.label}
            baseSize={36}
            minSize={22}
            maxLines={3}
            lineHeight={1.4}
            color={LOOK38.ink}
            fontWeight={600}
            align="center"
            style={{ textShadow: LOOK38.textShadow }}
          />
        </div>

        {/* Optional Supporting Secondary Frosted Bar */}
        {extraNote ? (
          <div
            style={{
              width: '100%',
              padding: '24px 34px',
              boxSizing: 'border-box',
              ...look38GlassSurfaceStyle(24, 'subtle'),
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              transform: `translateY(${interpolate(subCardSp, [0, 1], [28, 0])}px) scale(${interpolate(subCardSp, [0, 1], [0.94, 1])})`,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                backgroundColor: LOOK38.accent2,
                boxShadow: '0 0 12px rgba(159, 216, 255, 0.85)',
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <FitText
                text={extraNote}
                baseSize={28}
                minSize={20}
                maxLines={2}
                lineHeight={1.4}
                color={LOOK38.ink}
                fontWeight={500}
                align="left"
                style={{ textShadow: LOOK38.textShadow }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Look38 Shot 4: 'glass-compare-panes'
// Two frosted glass panes for compare or quote (full readable Thai width)
// ----------------------------------------------------------------------------
const Look38GlassComparePanes: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps }) => {
  const t = sceneTexts(scene);
  const safeFps = Math.max(1, fps || 30);
  const sides = extractCompareSidesM(scene);

  const paneWidth = Math.round(STAGE_W * 0.85); // 918px
  const paneLeft = Math.round((STAGE_W - paneWidth) / 2);

  const headerSp = spring({
    frame: localFrame,
    fps: safeFps,
    config: { damping: 13, stiffness: 160, mass: 0.88 },
  });
  const pane1Sp = spring({
    frame: Math.max(0, localFrame - 5),
    fps: safeFps,
    config: { damping: 12.5, stiffness: 150, mass: 0.9 },
  });
  const pane2Sp = spring({
    frame: Math.max(0, localFrame - 12),
    fps: safeFps,
    config: { damping: 12.5, stiffness: 148, mass: 0.92 },
  });

  if (sides.isQuote) {
    return (
      <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
        <Look38DuskBackdrop localFrame={localFrame} fps={safeFps} sceneIndex={sceneIndex} />

        <div
          style={{
            position: 'absolute',
            left: paneLeft,
            top: 240,
            width: paneWidth,
            maxHeight: CONTENT_BOTTOM - 240,
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          {/* Quote Main Frosted Glass Pane */}
          <div
            style={{
              width: '100%',
              padding: '44px 44px 48px',
              boxSizing: 'border-box',
              ...look38GlassSurfaceStyle(32, 'bright'),
              display: 'flex',
              flexDirection: 'column',
              gap: 22,
              transform: `scale(${interpolate(pane1Sp, [0, 1], [0.91, 1])}) translateY(${interpolate(pane1Sp, [0, 1], [30, 0])}px)`,
            }}
          >
            <div
              style={{
                fontFamily: FONT_THAI,
                fontSize: 82,
                lineHeight: 0.8,
                fontWeight: 800,
                color: LOOK38.coral,
                opacity: 0.86,
              }}
            >
              “
            </div>
            <FitText
              text={sides.quoteText}
              baseSize={42}
              minSize={24}
              maxLines={6}
              lineHeight={1.44}
              color={LOOK38.ink}
              fontWeight={600}
              align="left"
              style={{ textShadow: LOOK38.textShadow }}
            />
            <div
              style={{
                height: 2,
                width: '100%',
                backgroundImage: `linear-gradient(90deg, ${LOOK38.coral} 0%, ${LOOK38.accent2} 55%, rgba(255,255,255,0) 100%)`,
                opacity: 0.65,
              }}
            />
          </div>

          {/* Second Frosted Pane: Author / Supporting Context */}
          <div
            style={{
              width: '100%',
              padding: '28px 38px',
              boxSizing: 'border-box',
              ...look38GlassSurfaceStyle(24, 'normal'),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 18,
              transform: `translateY(${interpolate(pane2Sp, [0, 1], [34, 0])}px) scale(${interpolate(pane2Sp, [0, 1], [0.93, 1])})`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1, minWidth: 0 }}>
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  backgroundColor: LOOK38.accent2,
                  boxShadow: '0 0 14px rgba(159, 216, 255, 0.8)',
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <FitText
                  text={sides.quoteAuthor || t.title || 'ข้อคิดสำคัญ'}
                  baseSize={30}
                  minSize={20}
                  maxLines={2}
                  lineHeight={1.38}
                  color={LOOK38.ink}
                  fontWeight={600}
                  align="left"
                  style={{ textShadow: LOOK38.textShadow }}
                />
                {t.subtitle ? (
                  <FitText
                    text={t.subtitle}
                    baseSize={24}
                    minSize={18}
                    maxLines={2}
                    lineHeight={1.38}
                    color={LOOK38.inkMuted}
                    fontWeight={500}
                    align="left"
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <Look38DuskBackdrop localFrame={localFrame} fps={safeFps} sceneIndex={sceneIndex} />

      <div
        style={{
          position: 'absolute',
          left: paneLeft,
          top: 150,
          width: paneWidth,
          maxHeight: CONTENT_BOTTOM - 150,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* Top Frosted Header Pill */}
        {t.title ? (
          <div
            style={{
              width: '100%',
              padding: '20px 32px',
              boxSizing: 'border-box',
              ...look38GlassSurfaceStyle(40, 'subtle'),
              transform: `scale(${interpolate(headerSp, [0, 1], [0.92, 1])})`,
            }}
          >
            <FitText
              text={t.title}
              baseSize={36}
              minSize={22}
              maxLines={2}
              lineHeight={1.36}
              color={LOOK38.ink}
              fontWeight={700}
              align="center"
              style={{ textShadow: LOOK38.textShadow }}
            />
          </div>
        ) : null}

        {/* Pane 1 (Left / Before) */}
        <div
          style={{
            width: '100%',
            padding: '30px 36px',
            boxSizing: 'border-box',
            ...look38GlassSurfaceStyle(26, 'normal'),
            borderColor: 'rgba(159, 216, 255, 0.36)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            transform: `translateY(${interpolate(pane1Sp, [0, 1], [-26, 0])}px) scale(${interpolate(pane1Sp, [0, 1], [0.94, 1])})`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                padding: '6px 16px',
                borderRadius: 999,
                backgroundColor: 'rgba(159, 216, 255, 0.18)',
                border: '1px solid rgba(159, 216, 255, 0.45)',
                fontFamily: FONT_MONO,
                fontSize: 20,
                fontWeight: 700,
                color: LOOK38.accent2,
                flexShrink: 0,
              }}
            >
              A
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <FitText
                text={sides.leftTitle}
                baseSize={32}
                minSize={21}
                maxLines={1}
                lineHeight={1.36}
                color={LOOK38.accent2}
                fontWeight={700}
                align="left"
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sides.leftItems.map((item, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    backgroundColor: LOOK38.accent2,
                    marginTop: 14,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={item}
                    baseSize={28}
                    minSize={19}
                    maxLines={2}
                    lineHeight={1.38}
                    color={LOOK38.ink}
                    fontWeight={500}
                    align="left"
                    style={{ textShadow: LOOK38.textShadow }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pane 2 (Right / After — coral highlighted frosted pane) */}
        <div
          style={{
            width: '100%',
            padding: '30px 36px',
            boxSizing: 'border-box',
            ...look38GlassSurfaceStyle(26, 'bright'),
            borderColor: 'rgba(255, 138, 92, 0.48)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            transform: `translateY(${interpolate(pane2Sp, [0, 1], [34, 0])}px) scale(${interpolate(pane2Sp, [0, 1], [0.94, 1])})`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                padding: '6px 16px',
                borderRadius: 999,
                backgroundColor: 'rgba(255, 138, 92, 0.22)',
                border: '1px solid rgba(255, 138, 92, 0.62)',
                fontFamily: FONT_MONO,
                fontSize: 20,
                fontWeight: 700,
                color: LOOK38.coral,
                flexShrink: 0,
              }}
            >
              B
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <FitText
                text={sides.rightTitle}
                baseSize={32}
                minSize={21}
                maxLines={1}
                lineHeight={1.36}
                color={LOOK38.coral}
                fontWeight={700}
                align="left"
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sides.rightItems.map((item, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    backgroundColor: LOOK38.coral,
                    marginTop: 14,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={item}
                    baseSize={28}
                    minSize={19}
                    maxLines={2}
                    lineHeight={1.38}
                    color={LOOK38.ink}
                    fontWeight={600}
                    align="left"
                    style={{ textShadow: LOOK38.textShadow }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// LOOK-39: APPLE ONE-TAKE (ช็อตเดียวแบบ Apple)
// Flat #EEEEEC ground, #111113 ink, #FBFBF9 paper carrier morphing continuously
// without cuts or crossfades, ONE #FF3B30 red accent dot, soft layered shadows
// ============================================================================

function look39LayeredShadow(elevation: number): string {
  const e = clamp01(elevation);
  if (e <= 0.01) return 'none';
  return [
    `0 ${(2 * e).toFixed(1)}px ${(6 * e).toFixed(1)}px rgba(17, 17, 19, ${(0.065 * e).toFixed(3)})`,
    `0 ${(16 * e).toFixed(1)}px ${(36 * e).toFixed(1)}px rgba(17, 17, 19, ${(0.075 * e).toFixed(3)})`,
    `0 ${(40 * e).toFixed(1)}px ${(84 * e).toFixed(1)}px rgba(17, 17, 19, ${(0.06 * e).toFixed(3)})`,
  ].join(', ');
}

/** Mask-reveal wrapper with Thai-safe vertical buffer so tone marks & vowels never clip */
const Look39MaskReveal: React.FC<{
  progress: number;
  offsetY?: number;
  children: React.ReactNode;
}> = ({ progress, offsetY = 48, children }) => {
  const p = clamp01(progress);
  const ty = (1 - p) * offsetY;
  return (
    <div style={{ overflow: 'hidden', paddingTop: 6, paddingBottom: 8 }}>
      <div style={{ transform: `translateY(${ty.toFixed(1)}px)` }}>{children}</div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Look39 Shot 1: 'one-take-hero-morph'
// Red dot expands into dark capsule pill -> inner paper expands thinning dark rim
// (color change by shape, zero crossfade!) -> full keynote carrier card ->
// bold dark headline mask-reveals while single red focal dot lands beside it
// ----------------------------------------------------------------------------
const Look39OneTakeHeroMorph: React.FC<StyleShotArgs> = ({ scene, localFrame, fps }) => {
  const t = sceneTexts(scene);
  const safeFps = Math.max(1, fps || 30);

  // Continuous spring phases:
  // 1) Dot -> dark capsule pill (frames 0..14)
  const pillSp = spring({
    frame: localFrame,
    fps: safeFps,
    config: { damping: 12, stiffness: 165, mass: 0.85 },
  });
  // Subtle tactile click press around frame 11..17
  const clickT = clamp01((localFrame - 10) / 8);
  const clickDip = localFrame >= 10 && localFrame <= 18 ? 1 - 0.045 * Math.sin(clickT * Math.PI) : 1;

  // 2) Capsule -> full white keynote card (frames 16..42, ~5% overshoot)
  const cardSp = spring({
    frame: Math.max(0, localFrame - 16),
    fps: safeFps,
    config: { damping: 15.5, stiffness: 130, mass: 0.96 },
  });

  // 3) Inner paper flood expanding outward from center so dark rim thins to 0 (color via shape)
  const paperFloodSp = spring({
    frame: Math.max(0, localFrame - 18),
    fps: safeFps,
    config: { damping: 17, stiffness: 140, mass: 0.9 },
  });

  // 4) Content mask-reveal trails carrier morph by ~3 frames
  const titleReveal = spring({
    frame: Math.max(0, localFrame - 24),
    fps: safeFps,
    config: { damping: 14, stiffness: 160, mass: 0.85 },
  });
  const subReveal = spring({
    frame: Math.max(0, localFrame - 30),
    fps: safeFps,
    config: { damping: 15, stiffness: 150, mass: 0.88 },
  });

  // Continuous morph geometry of single carrier object
  const wPill = interpolate(pillSp, [0, 1], [68, 360]);
  const hPill = interpolate(pillSp, [0, 1], [68, 92]);
  const rPill = interpolate(pillSp, [0, 1], [34, 46]);

  const cardW = interpolate(cardSp, [0, 1], [wPill, 908]);
  const cardH = interpolate(cardSp, [0, 1], [hPill, 760]);
  const cardR = interpolate(cardSp, [0, 1], [rPill, 44]);
  const cardCenterY = interpolate(cardSp, [0, 1], [720, 740]);

  const cardLeft = (STAGE_W - cardW) / 2;
  const cardTop = cardCenterY - cardH / 2;

  // Dark rim thickness shrinks continuously to 0 as inner paper expands
  const darkRim = Math.max(0, interpolate(paperFloodSp, [0, 1], [Math.min(cardW, cardH) * 0.5, 0]));
  const paperVisibleScale = clamp01(paperFloodSp);

  // Single red focal dot glides continuously from capsule-left to hero card top-left / badge anchor
  const dotSize = interpolate(cardSp, [0, 1], [28, 22]);
  const dotX = interpolate(
    cardSp,
    [0, 1],
    [cardLeft + 46, cardLeft + 58],
  );
  const dotY = interpolate(
    cardSp,
    [0, 1],
    [cardCenterY, cardTop + 62],
  );

  const hlText = extractHighlightTextM(scene);
  const firstBullet = t.bullets[0] || '';
  const pillCaption = t.badge || 'เริ่มต้น';

  return (
    <div
      style={{
        position: 'relative',
        width: STAGE_W,
        height: STAGE_H,
        overflow: 'hidden',
        backgroundColor: LOOK39.ground,
      }}
    >
      {/* Single Continuous Carrier Object */}
      <div
        style={{
          position: 'absolute',
          left: cardLeft,
          top: cardTop,
          width: cardW,
          height: cardH,
          borderRadius: cardR,
          backgroundColor: LOOK39.ink,
          boxShadow: look39LayeredShadow(interpolate(cardSp, [0, 1], [0.42, 1])),
          transform: `scale(${clickDip})`,
          transformOrigin: 'center center',
          overflow: 'hidden',
        }}
      >
        {/* Early dark-capsule label (naturally covered as inner paper expands outward) */}
        {paperFloodSp < 0.45 ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              paddingLeft: 76,
              paddingRight: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: clamp01(1 - paperFloodSp * 2.6),
            }}
          >
            <FitText
              text={pillCaption}
              baseSize={28}
              minSize={20}
              maxLines={1}
              lineHeight={1.35}
              color={LOOK39.paper}
              fontWeight={700}
              align="center"
            />
          </div>
        ) : null}

        {/* Inner #FBFBF9 paper expands outward from center to thin out the dark rim */}
        <div
          style={{
            position: 'absolute',
            left: darkRim,
            right: darkRim,
            top: darkRim,
            bottom: darkRim,
            borderRadius: Math.max(8, cardR - darkRim * 0.4),
            backgroundColor: LOOK39.paper,
            opacity: paperVisibleScale > 0.01 ? 1 : 0,
          }}
        />

        {/* Settled Keynote Card Content (trails morph by ~3f) */}
        {cardSp > 0.55 ? (
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              padding: '48px 54px 52px',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 24,
            }}
          >
            {/* Header row leaving space for the travelling red focal dot */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 38 }}>
              <Look39MaskReveal progress={titleReveal} offsetY={28}>
                <FitText
                  text={t.badge || 'KEYNOTE'}
                  baseSize={24}
                  minSize={18}
                  maxLines={1}
                  lineHeight={1.36}
                  color={LOOK39.inkMuted}
                  fontWeight={700}
                  align="left"
                  style={{ letterSpacing: '0.02em' }}
                />
              </Look39MaskReveal>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 20,
                  fontWeight: 600,
                  color: LOOK39.inkFaint,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                01
              </div>
            </div>

            {/* Allowed subtle soft-blue content tile inside carrier card */}
            <div
              style={{
                width: '100%',
                padding: '38px 36px',
                boxSizing: 'border-box',
                borderRadius: 28,
                backgroundImage: `linear-gradient(145deg, ${LOOK39.tileBlueTop} 0%, ${LOOK39.tileBlueBottom} 100%)`,
                border: `1px solid ${LOOK39.tileBlueBorder}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 18,
              }}
            >
              <Look39MaskReveal progress={titleReveal} offsetY={56}>
                <FitText
                  text={t.title || t.subtitle || 'การทำงานต่อเนื่องในช็อตเดียว'}
                  baseSize={54}
                  minSize={30}
                  maxLines={3}
                  lineHeight={1.36}
                  color={LOOK39.ink}
                  fontWeight={800}
                  align="left"
                  style={{ letterSpacing: '-0.02em' }}
                />
              </Look39MaskReveal>

              {t.subtitle ? (
                <Look39MaskReveal progress={subReveal} offsetY={36}>
                  <FitText
                    text={t.subtitle}
                    baseSize={30}
                    minSize={20}
                    maxLines={3}
                    lineHeight={1.4}
                    color={LOOK39.inkMuted}
                    fontWeight={500}
                    align="left"
                  />
                </Look39MaskReveal>
              ) : null}
            </div>

            {/* Bottom keynote strip inside carrier */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Look39MaskReveal progress={subReveal} offsetY={26}>
                  <FitText
                    text={hlText || firstBullet || 'ออกแบบให้ทุกจังหวะเชื่อมต่อกันอย่างไร้รอยต่อ'}
                    baseSize={26}
                    minSize={19}
                    maxLines={2}
                    lineHeight={1.38}
                    color={LOOK39.ink}
                    fontWeight={600}
                    align="left"
                  />
                </Look39MaskReveal>
              </div>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 999,
                  backgroundColor: LOOK39.ink,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transform: `scale(${clamp01(subReveal)})`,
                }}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M5 10H15M11 6L15 10L11 14" stroke={LOOK39.paper} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* THE SINGLE #FF3B30 RED FOCAL DOT — persists through every morph state */}
      <div
        style={{
          position: 'absolute',
          left: dotX - dotSize / 2,
          top: dotY - dotSize / 2,
          width: dotSize,
          height: dotSize,
          borderRadius: 999,
          backgroundColor: LOOK39.redDot,
          transform: `scale(${clickDip})`,
          pointerEvents: 'none',
          zIndex: 10,
        }}
      />
    </div>
  );
};

// ----------------------------------------------------------------------------
// Look39 Shot 2: 'one-take-feature-list'
// Compact pill morphs smoothly into a tall vertical carrier list card;
// bullets mask-reveal cleanly; ONE #FF3B30 red dot glides down row by row
// ----------------------------------------------------------------------------
const Look39OneTakeFeatureList: React.FC<StyleShotArgs> = ({ scene, localFrame, durationFrames, fps }) => {
  const t = sceneTexts(scene);
  const safeFps = Math.max(1, fps || 30);
  const rows = extractPointsM(scene, 4);
  const rowCount = Math.max(1, rows.length);

  // Carrier morph: compact capsule -> tall feature list panel (continuous spring)
  const morphSp = spring({
    frame: Math.max(0, localFrame - 3),
    fps: safeFps,
    config: { damping: 14.5, stiffness: 138, mass: 0.94 },
  });

  const headerH = 190;
  const rowH = rowCount >= 4 ? 176 : rowCount === 3 ? 204 : 226;
  const padTop = 44;
  const padBottom = 42;
  const finalH = Math.min(CONTENT_BOTTOM - 170, padTop + headerH + rowCount * rowH + padBottom);
  const finalW = 916;

  const cardW = interpolate(morphSp, [0, 1], [340, finalW]);
  const cardH = interpolate(morphSp, [0, 1], [96, finalH]);
  const cardR = interpolate(morphSp, [0, 1], [48, 42]);
  const centerY = interpolate(morphSp, [0, 1], [680, 170 + finalH / 2]);
  const cardLeft = (STAGE_W - cardW) / 2;
  const cardTop = centerY - cardH / 2;

  // Travelling single red dot steps smoothly down each row
  const stepStart = 20;
  const stepWindow = Math.max(14, Math.min(20, Math.floor((durationFrames * 0.56) / Math.max(1, rowCount))));
  let currentDotRowOffset = 0;
  for (let i = 1; i < rowCount; i++) {
    const segSp = spring({
      frame: Math.max(0, localFrame - (stepStart + i * stepWindow)),
      fps: safeFps,
      config: { damping: 15, stiffness: 175, mass: 0.86 },
    });
    currentDotRowOffset += segSp;
  }

  const firstRowCenterY = cardTop + padTop + headerH + rowH / 2;
  const dotTargetY = firstRowCenterY + currentDotRowOffset * rowH;
  const dotY = interpolate(morphSp, [0, 1], [centerY, dotTargetY]);
  const dotX = interpolate(morphSp, [0, 1], [cardLeft + 52, cardLeft + 62]);
  const activeRowIdx = Math.min(rowCount - 1, Math.round(currentDotRowOffset));

  const titleReveal = spring({
    frame: Math.max(0, localFrame - 12),
    fps: safeFps,
    config: { damping: 15, stiffness: 165, mass: 0.86 },
  });

  return (
    <div
      style={{
        position: 'relative',
        width: STAGE_W,
        height: STAGE_H,
        overflow: 'hidden',
        backgroundColor: LOOK39.ground,
      }}
    >
      {/* Morphing Carrier Panel */}
      <div
        style={{
          position: 'absolute',
          left: cardLeft,
          top: cardTop,
          width: cardW,
          height: cardH,
          borderRadius: cardR,
          backgroundColor: LOOK39.paper,
          boxShadow: look39LayeredShadow(interpolate(morphSp, [0, 1], [0.45, 1])),
          overflow: 'hidden',
          padding: `${padTop}px 48px ${padBottom}px`,
          boxSizing: 'border-box',
        }}
      >
        {morphSp > 0.45 ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header block */}
            <div
              style={{
                height: headerH,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 10,
                borderBottom: `1.5px solid ${LOOK39.hairline}`,
                boxSizing: 'border-box',
                paddingBottom: 18,
              }}
            >
              {t.badge ? (
                <Look39MaskReveal progress={titleReveal} offsetY={22}>
                  <FitText
                    text={t.badge}
                    baseSize={24}
                    minSize={18}
                    maxLines={1}
                    lineHeight={1.35}
                    color={LOOK39.inkMuted}
                    fontWeight={600}
                    align="left"
                  />
                </Look39MaskReveal>
              ) : null}
              <Look39MaskReveal progress={titleReveal} offsetY={44}>
                <FitText
                  text={t.title || t.subtitle || 'จุดเด่นสำคัญ'}
                  baseSize={44}
                  minSize={26}
                  maxLines={2}
                  lineHeight={1.36}
                  color={LOOK39.ink}
                  fontWeight={800}
                  align="left"
                  style={{ letterSpacing: '-0.02em' }}
                />
              </Look39MaskReveal>
            </div>

            {/* Feature Rows */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {rows.map((row, idx) => {
                const rowSp = spring({
                  frame: Math.max(0, localFrame - (16 + idx * 5)),
                  fps: safeFps,
                  config: { damping: 14, stiffness: 165, mass: 0.85 },
                });
                const isActive = idx === activeRowIdx;
                return (
                  <div
                    key={idx}
                    style={{
                      height: rowH,
                      boxSizing: 'border-box',
                      paddingLeft: 44,
                      paddingRight: 8,
                      borderBottom: idx < rowCount - 1 ? `1px solid ${LOOK39.hairline}` : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 18,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Look39MaskReveal progress={rowSp} offsetY={34}>
                        <FitText
                          text={row.title}
                          baseSize={rowCount >= 4 ? 32 : 36}
                          minSize={21}
                          maxLines={2}
                          lineHeight={1.38}
                          color={isActive ? LOOK39.ink : LOOK39.inkMuted}
                          fontWeight={isActive ? 700 : 600}
                          align="left"
                        />
                        {row.detail ? (
                          <FitText
                            text={row.detail}
                            baseSize={24}
                            minSize={18}
                            maxLines={1}
                            lineHeight={1.36}
                            color={LOOK39.inkFaint}
                            fontWeight={500}
                            align="left"
                          />
                        ) : null}
                      </Look39MaskReveal>
                    </div>

                    <div
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: 24,
                        fontWeight: 700,
                        fontVariantNumeric: 'tabular-nums',
                        color: isActive ? LOOK39.ink : LOOK39.inkFaint,
                        flexShrink: 0,
                      }}
                    >
                      0{idx + 1}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {/* THE SINGLE #FF3B30 RED FOCAL DOT gliding smoothly down each feature row */}
      <div
        style={{
          position: 'absolute',
          left: dotX - 10,
          top: dotY - 10,
          width: 20,
          height: 20,
          borderRadius: 999,
          backgroundColor: LOOK39.redDot,
          pointerEvents: 'none',
          zIndex: 10,
        }}
      />
    </div>
  );
};

// ----------------------------------------------------------------------------
// Look39 Shot 3: 'one-take-stat-reveal'
// Carrier card morphs smoothly into a sculptural keynote mega-pill showing the
// animated tabular-nums count-up stat, single red dot anchored beside it
// ----------------------------------------------------------------------------
const Look39OneTakeStatReveal: React.FC<StyleShotArgs> = ({ scene, localFrame, durationFrames, fps }) => {
  const t = sceneTexts(scene);
  const safeFps = Math.max(1, fps || 30);
  const metric = extractPrimaryMetricM(scene, 99, '%');

  // Phase 1: initial card settles -> Phase 2: contracts continuously into bold sculptural pill
  const entrySp = spring({
    frame: localFrame,
    fps: safeFps,
    config: { damping: 13, stiffness: 155, mass: 0.9 },
  });
  const pillMorphSp = spring({
    frame: Math.max(0, localFrame - 12),
    fps: safeFps,
    config: { damping: 15, stiffness: 130, mass: 0.95 },
  });

  const w0 = interpolate(entrySp, [0, 1], [680, 820]);
  const h0 = interpolate(entrySp, [0, 1], [620, 720]);
  const r0 = interpolate(entrySp, [0, 1], [48, 44]);

  const pillW = interpolate(pillMorphSp, [0, 1], [w0, 916]);
  const pillH = interpolate(pillMorphSp, [0, 1], [h0, 410]);
  const pillR = interpolate(pillMorphSp, [0, 1], [r0, 175]);
  const pillCenterY = interpolate(pillMorphSp, [0, 1], [730, 680]);
  const pillLeft = (STAGE_W - pillW) / 2;
  const pillTop = pillCenterY - pillH / 2;

  const countDur = Math.max(24, Math.min(54, Math.floor(durationFrames * 0.54)));
  const countProg = easeOutCubic(clamp01((localFrame - 14) / countDur));
  const animatedBig = formatAnimatedStatM(metric.big, metric.numeric, countProg);

  const headerReveal = spring({
    frame: Math.max(0, localFrame - 16),
    fps: safeFps,
    config: { damping: 15, stiffness: 155, mass: 0.88 },
  });
  const footerReveal = spring({
    frame: Math.max(0, localFrame - 22),
    fps: safeFps,
    config: { damping: 15, stiffness: 150, mass: 0.9 },
  });

  // Single red focal dot glides from top center of card to anchor beside the mega-pill label
  const dotX = interpolate(pillMorphSp, [0, 1], [STAGE_W / 2, pillLeft + 84]);
  const dotY = interpolate(pillMorphSp, [0, 1], [pillTop + 74, pillCenterY]);

  return (
    <div
      style={{
        position: 'relative',
        width: STAGE_W,
        height: STAGE_H,
        overflow: 'hidden',
        backgroundColor: LOOK39.ground,
      }}
    >
      {/* Top keynote title above the pill */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X + 24,
          right: SAFE_X + 24,
          top: 196,
        }}
      >
        <Look39MaskReveal progress={headerReveal} offsetY={40}>
          <FitText
            text={t.title || t.badge || 'ตัวชี้วัดหลัก'}
            baseSize={46}
            minSize={26}
            maxLines={2}
            lineHeight={1.36}
            color={LOOK39.ink}
            fontWeight={800}
            align="center"
            style={{ letterSpacing: '-0.02em' }}
          />
        </Look39MaskReveal>
      </div>

      {/* Sculptural Morphing Carrier Mega-Pill */}
      <div
        style={{
          position: 'absolute',
          left: pillLeft,
          top: pillTop,
          width: pillW,
          height: pillH,
          borderRadius: pillR,
          backgroundColor: LOOK39.paper,
          boxShadow: look39LayeredShadow(1),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px 112px 32px 124px',
          boxSizing: 'border-box',
          gap: 10,
        }}
      >
        <div style={{ width: '100%' }}>
          <FitText
            text={animatedBig}
            baseSize={132}
            minSize={58}
            maxLines={1}
            lineHeight={1.18}
            color={LOOK39.ink}
            fontWeight={800}
            align="center"
            style={{
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.03em',
            }}
          />
        </div>
        {metric.unit ? (
          <FitText
            text={metric.unit}
            baseSize={34}
            minSize={22}
            maxLines={1}
            lineHeight={1.36}
            color={LOOK39.inkMuted}
            fontWeight={700}
            align="center"
          />
        ) : null}
      </div>

      {/* Bottom stat label + delta pill cleanly above CONTENT_BOTTOM (1420) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X + 36,
          right: SAFE_X + 36,
          top: 940,
          maxHeight: CONTENT_BOTTOM - 940,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
        }}
      >
        <Look39MaskReveal progress={footerReveal} offsetY={34}>
          <FitText
            text={metric.label}
            baseSize={38}
            minSize={24}
            maxLines={3}
            lineHeight={1.4}
            color={LOOK39.ink}
            fontWeight={700}
            align="center"
          />
        </Look39MaskReveal>

        {metric.delta ? (
          <div
            style={{
              padding: '12px 28px',
              borderRadius: 999,
              backgroundColor: LOOK39.ink,
              transform: `scale(${interpolate(footerReveal, [0, 1], [0.85, 1])})`,
              opacity: clamp01(footerReveal),
            }}
          >
            <FitText
              text={metric.delta}
              baseSize={26}
              minSize={19}
              maxLines={1}
              lineHeight={1.35}
              color={LOOK39.paper}
              fontWeight={700}
              align="center"
            />
          </div>
        ) : null}
      </div>

      {/* THE SINGLE #FF3B30 RED FOCAL DOT */}
      <div
        style={{
          position: 'absolute',
          left: dotX - 13,
          top: dotY - 13,
          width: 26,
          height: 26,
          borderRadius: 999,
          backgroundColor: LOOK39.redDot,
          pointerEvents: 'none',
          zIndex: 10,
        }}
      />
    </div>
  );
};

// ----------------------------------------------------------------------------
// Look39 Shot 4: 'one-take-split-compare'
// One unified carrier card physically splits continuously via spring into TWO
// cards for compare or quote, with the single #FF3B30 red focal dot gliding
// from the seam onto the primary card
// ----------------------------------------------------------------------------
const Look39OneTakeSplitCompare: React.FC<StyleShotArgs> = ({ scene, localFrame, fps }) => {
  const t = sceneTexts(scene);
  const safeFps = Math.max(1, fps || 30);
  const sides = extractCompareSidesM(scene);

  // Entry spring for unified carrier
  const entrySp = spring({
    frame: localFrame,
    fps: safeFps,
    config: { damping: 13.5, stiffness: 155, mass: 0.9 },
  });
  // Split spring separates ONE carrier into TWO cards smoothly
  const splitSp = spring({
    frame: Math.max(0, localFrame - 12),
    fps: safeFps,
    config: { damping: 15.5, stiffness: 122, mass: 0.96 },
  });
  // Content reveals 3f after split initiates
  const contentSp = spring({
    frame: Math.max(0, localFrame - 18),
    fps: safeFps,
    config: { damping: 15, stiffness: 150, mass: 0.9 },
  });

  const cardW = 916;
  const cardLeft = (STAGE_W - cardW) / 2;
  const entryScale = interpolate(entrySp, [0, 1], [0.92, 1]);

  if (sides.isQuote) {
    const topCardH = 540;
    const botCardH = 220;
    const topCardTop = interpolate(splitSp, [0, 1], [420, 270]);
    const botCardTop = interpolate(splitSp, [0, 1], [420 + topCardH - botCardH, 848]);
    const topBottomRadius = interpolate(splitSp, [0, 1], [12, 38]);
    const botTopRadius = interpolate(splitSp, [0, 1], [12, 34]);

    const dotX = interpolate(splitSp, [0, 1], [STAGE_W / 2, cardLeft + 56]);
    const dotY = interpolate(splitSp, [0, 1], [topCardTop + topCardH, botCardTop + botCardH / 2]);

    return (
      <div
        style={{
          position: 'relative',
          width: STAGE_W,
          height: STAGE_H,
          overflow: 'hidden',
          backgroundColor: LOOK39.ground,
        }}
      >
        {/* Top Split Card: Quote */}
        <div
          style={{
            position: 'absolute',
            left: cardLeft,
            top: topCardTop,
            width: cardW,
            height: topCardH,
            borderTopLeftRadius: 42,
            borderTopRightRadius: 42,
            borderBottomLeftRadius: topBottomRadius,
            borderBottomRightRadius: topBottomRadius,
            backgroundColor: LOOK39.paper,
            boxShadow: look39LayeredShadow(1),
            padding: '48px 54px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 20,
            transform: `scale(${entryScale})`,
          }}
        >
          <div style={{ fontFamily: FONT_THAI, fontSize: 72, lineHeight: 0.8, fontWeight: 800, color: LOOK39.inkFaint }}>
            “
          </div>
          <Look39MaskReveal progress={contentSp} offsetY={40}>
            <FitText
              text={sides.quoteText}
              baseSize={42}
              minSize={24}
              maxLines={5}
              lineHeight={1.44}
              color={LOOK39.ink}
              fontWeight={700}
              align="left"
            />
          </Look39MaskReveal>
        </div>

        {/* Bottom Split Card: Attribution */}
        <div
          style={{
            position: 'absolute',
            left: cardLeft,
            top: botCardTop,
            width: cardW,
            height: botCardH,
            borderTopLeftRadius: botTopRadius,
            borderTopRightRadius: botTopRadius,
            borderBottomLeftRadius: 42,
            borderBottomRightRadius: 42,
            backgroundImage: `linear-gradient(145deg, ${LOOK39.tileBlueTop} 0%, ${LOOK39.tileBlueBottom} 100%)`,
            boxShadow: look39LayeredShadow(interpolate(splitSp, [0, 1], [0.2, 0.9])),
            padding: '30px 48px 30px 92px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 8,
            transform: `scale(${entryScale})`,
          }}
        >
          <Look39MaskReveal progress={contentSp} offsetY={28}>
            <FitText
              text={sides.quoteAuthor || t.title || 'ประเด็นสำคัญ'}
              baseSize={32}
              minSize={22}
              maxLines={2}
              lineHeight={1.38}
              color={LOOK39.ink}
              fontWeight={800}
              align="left"
            />
            {t.subtitle ? (
              <FitText
                text={t.subtitle}
                baseSize={24}
                minSize={18}
                maxLines={2}
                lineHeight={1.38}
                color={LOOK39.inkMuted}
                fontWeight={500}
                align="left"
              />
            ) : null}
          </Look39MaskReveal>
        </div>

        {/* Single Red Focal Dot */}
        <div
          style={{
            position: 'absolute',
            left: dotX - 11,
            top: dotY - 11,
            width: 22,
            height: 22,
            borderRadius: 999,
            backgroundColor: LOOK39.redDot,
            pointerEvents: 'none',
            zIndex: 10,
          }}
        />
      </div>
    );
  }

  // Compare Mode: Top card & Bottom card split cleanly from one unified center seam
  const hasHeader = Boolean(t.title);
  const topCardH = 440;
  const botCardH = 460;
  const seamY = hasHeader ? 750 : 690;

  const topCardTop = interpolate(splitSp, [0, 1], [seamY - topCardH, hasHeader ? 300 : 210]);
  const botCardTop = interpolate(splitSp, [0, 1], [seamY, hasHeader ? 780 : 700]);
  const innerRadius = interpolate(splitSp, [0, 1], [0, 38]);

  // Single red dot glides from split seam onto the highlighted bottom (B) card header
  const dotX = interpolate(splitSp, [0, 1], [STAGE_W / 2, cardLeft + 56]);
  const dotY = interpolate(splitSp, [0, 1], [seamY, botCardTop + 56]);

  return (
    <div
      style={{
        position: 'relative',
        width: STAGE_W,
        height: STAGE_H,
        overflow: 'hidden',
        backgroundColor: LOOK39.ground,
      }}
    >
      {/* Clean keynote header above split cards */}
      {hasHeader ? (
        <div
          style={{
            position: 'absolute',
            left: SAFE_X + 24,
            right: SAFE_X + 24,
            top: 148,
          }}
        >
          <Look39MaskReveal progress={entrySp} offsetY={34}>
            <FitText
              text={t.title}
              baseSize={44}
              minSize={26}
              maxLines={2}
              lineHeight={1.36}
              color={LOOK39.ink}
              fontWeight={800}
              align="center"
              style={{ letterSpacing: '-0.02em' }}
            />
          </Look39MaskReveal>
        </div>
      ) : null}

      {/* Card 1 (Before / Left) */}
      <div
        style={{
          position: 'absolute',
          left: cardLeft,
          top: topCardTop,
          width: cardW,
          height: topCardH,
          borderTopLeftRadius: 42,
          borderTopRightRadius: 42,
          borderBottomLeftRadius: innerRadius,
          borderBottomRightRadius: innerRadius,
          backgroundColor: LOOK39.paperSub,
          border: `1.5px solid ${LOOK39.hairline}`,
          boxShadow: look39LayeredShadow(interpolate(splitSp, [0, 1], [0.5, 0.72])),
          padding: '34px 44px',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          transform: `scale(${entryScale})`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <FitText
            text={sides.leftTitle}
            baseSize={34}
            minSize={22}
            maxLines={1}
            lineHeight={1.36}
            color={LOOK39.inkMuted}
            fontWeight={700}
            align="left"
          />
          <div
            style={{
              padding: '6px 16px',
              borderRadius: 999,
              backgroundColor: 'rgba(17, 17, 19, 0.07)',
              fontFamily: FONT_MONO,
              fontSize: 20,
              fontWeight: 700,
              color: LOOK39.inkMuted,
              flexShrink: 0,
            }}
          >
            01
          </div>
        </div>
        <div style={{ height: 1, backgroundColor: LOOK39.hairline }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {sides.leftItems.map((item, idx) => (
            <Look39MaskReveal key={idx} progress={stagger(idx, Math.max(0, localFrame - 14), 4, 0, 14)} offsetY={24}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    backgroundColor: LOOK39.inkFaint,
                    marginTop: 14,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={item}
                    baseSize={28}
                    minSize={19}
                    maxLines={2}
                    lineHeight={1.38}
                    color={LOOK39.inkMuted}
                    fontWeight={500}
                    align="left"
                  />
                </div>
              </div>
            </Look39MaskReveal>
          ))}
        </div>
      </div>

      {/* Card 2 (After / Right — elevated paper with allowed soft-blue accent pill) */}
      <div
        style={{
          position: 'absolute',
          left: cardLeft,
          top: botCardTop,
          width: cardW,
          height: botCardH,
          borderTopLeftRadius: innerRadius,
          borderTopRightRadius: innerRadius,
          borderBottomLeftRadius: 42,
          borderBottomRightRadius: 42,
          backgroundColor: LOOK39.paper,
          boxShadow: look39LayeredShadow(1),
          padding: '36px 44px',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          transform: `scale(${entryScale})`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingLeft: 32 }}>
          <FitText
            text={sides.rightTitle}
            baseSize={34}
            minSize={22}
            maxLines={1}
            lineHeight={1.36}
            color={LOOK39.ink}
            fontWeight={800}
            align="left"
          />
          <div
            style={{
              padding: '6px 16px',
              borderRadius: 999,
              backgroundImage: `linear-gradient(135deg, ${LOOK39.tileBlueTop} 0%, ${LOOK39.tileBlueBottom} 100%)`,
              fontFamily: FONT_MONO,
              fontSize: 20,
              fontWeight: 700,
              color: LOOK39.ink,
              flexShrink: 0,
            }}
          >
            02
          </div>
        </div>
        <div style={{ height: 1, backgroundColor: LOOK39.hairline }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {sides.rightItems.map((item, idx) => (
            <Look39MaskReveal key={idx} progress={stagger(idx, Math.max(0, localFrame - 18), 4, 0, 14)} offsetY={24}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    backgroundColor: LOOK39.ink,
                    marginTop: 14,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={item}
                    baseSize={29}
                    minSize={20}
                    maxLines={2}
                    lineHeight={1.38}
                    color={LOOK39.ink}
                    fontWeight={600}
                    align="left"
                  />
                </div>
              </div>
            </Look39MaskReveal>
          ))}
        </div>
      </div>

      {/* THE SINGLE #FF3B30 RED FOCAL DOT */}
      <div
        style={{
          position: 'absolute',
          left: dotX - 10,
          top: dotY - 10,
          width: 20,
          height: 20,
          borderRadius: 999,
          backgroundColor: LOOK39.redDot,
          pointerEvents: 'none',
          zIndex: 10,
        }}
      />
    </div>
  );
};

// ============================================================================
// EXPORTED REGISTRY DEFINITIONS — BATCH_M (look-38, look-39)
// ============================================================================

const L38_SEARCH_RE = /(?:ค้นหา|พิมพ์|หา|เลือก|แอป|เครื่องมือ|วิธี|ขั้นตอน|search|query|type|app|tool)/i;
const L39_LIST_RE = /(?:ฟีเจอร์|คุณสมบัติ|จุดเด่น|ขั้นตอน|รายการ|feature|step|list)/i;

export const BATCH_M: StyleDirectorDef[] = [
  {
    styleId: 'look-38',
    caption: 'floating',
    shots: {
      'glass-search-type': Look38GlassSearchType,
      'glass-results-select': Look38GlassResultsSelect,
      'glass-stat-card': Look38GlassStatCard,
      'glass-compare-panes': Look38GlassComparePanes,
    },
    shotLabels: {
      'glass-search-type': 'ช่องค้นหากระจกฝ้ากว้างบนฉากพลบค่ำหลุดโฟกัส เด้งเข้าพร้อมพิมพ์ข้อความทีละตัวอักษรและเคอร์เซอร์กะพริบ',
      'glass-results-select': 'ช่องค้นหาร่อนขึ้นพร้อมแผงผลลัพธ์กระจกฝ้าคลี่ลงมา แถวรายการตกลงทีละขั้นและแถบไฮไลต์ยืดเลือกพร้อมปุ่ม return',
      'glass-stat-card': 'การ์ดกระจกฝ้าแสดงตัวเลขสถิติหลักนับขึ้นพร้อมแถบความคืบหน้าเรืองแสงและคำอธิบาย',
      'glass-compare-panes': 'แผงกระจกฝ้าคู่สำหรับเปรียบเทียบสองมุมมองหรือแสดงคำคมสำคัญอย่างนุ่มนวล',
    },
    infer: (scene) => {
      if (scene.stat) {
        return 'glass-stat-card';
      }
      if (scene.compare || scene.quote?.text) {
        return 'glass-compare-panes';
      }
      if (
        (Array.isArray(scene.bullets) && scene.bullets.length >= 3) ||
        (Array.isArray(scene.steps) && scene.steps.length >= 2)
      ) {
        return 'glass-results-select';
      }
      const text = haystackOfM(scene);
      if (L38_SEARCH_RE.test(text) && scene.bullets && scene.bullets.length >= 2) {
        return 'glass-results-select';
      }
      return null;
    },
  },
  {
    styleId: 'look-39',
    caption: 'bar',
    shots: {
      'one-take-hero-morph': Look39OneTakeHeroMorph,
      'one-take-feature-list': Look39OneTakeFeatureList,
      'one-take-stat-reveal': Look39OneTakeStatReveal,
      'one-take-split-compare': Look39OneTakeSplitCompare,
    },
    shotLabels: {
      'one-take-hero-morph': 'จุดแดงขยายเป็นแคปซูลแล้วเปลี่ยนรูปเป็นการ์ดคีย์โน้ตต่อเนื่องช็อตเดียว พร้อมหัวข้อเผยขึ้นผ่านมาสก์',
      'one-take-feature-list': 'การ์ดพาหะยืดเป็นแผงรายการจุดเด่นพร้อมจุดแดงหนึ่งจุดเคลื่อนไล่ลงตามแต่ละแถวอย่างนุ่มนวล',
      'one-take-stat-reveal': 'การ์ดหดรูปต่อเนื่องเป็นพิลล์ใหญ่แสดงตัวเลขสถิตินับขึ้นแบบตารางพร้อมจุดแดงโฟกัส',
      'one-take-split-compare': 'การ์ดพาหะใบเดียวแยกออกเป็นสองใบอย่างต่อเนื่องสำหรับเปรียบเทียบสองฝั่งหรือแสดงคำคม',
    },
    infer: (scene) => {
      if (scene.stat) {
        return 'one-take-stat-reveal';
      }
      if (scene.compare || scene.quote?.text) {
        return 'one-take-split-compare';
      }
      if (
        (Array.isArray(scene.bullets) && scene.bullets.length >= 3) ||
        (Array.isArray(scene.steps) && scene.steps.length >= 2)
      ) {
        return 'one-take-feature-list';
      }
      const text = haystackOfM(scene);
      if (L39_LIST_RE.test(text) && scene.bullets && scene.bullets.length >= 2) {
        return 'one-take-feature-list';
      }
      return null;
    },
  },
];
