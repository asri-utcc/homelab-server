import React from 'react';
import { interpolate, spring } from 'remotion';
import { THAI_FONT_FAMILY } from '../../components/ThaiFontLoader';
import { StudioVectorIcon } from '../sceneVisuals';
import {
  contrastRatio,
  hexToRgba,
  normalizeHex,
  relativeLuminance,
  shadeHex,
  type StudioScene,
  type StudioStepItem,
} from '../types';
import {
  appear,
  clamp01,
  easeOutCubic,
  FitText,
  SAFE_BOTTOM,
  sceneTexts,
  STAGE_H,
  STAGE_W,
  stagger,
} from './kit';
import type { StyleShotArgs } from './types';

// ============================================================================
// PUBLIC LABELS & SCENE-TO-DATA-SHOT MAPPER
// ============================================================================

export const DATA_SHOT_LABELS: Record<string, string> = {
  'data-counter': 'ตัวเลขสถิติ (Counter)',
  'data-steps': 'ลำดับขั้นตอน (Steps)',
  'data-versus': 'เปรียบเทียบซ้าย-ขวา (Versus)',
  'data-list': 'รายการประเด็น (List)',
  'data-quote': 'คำคมเน้นข้อความ (Quote)',
  'data-chart': 'กราฟข้อมูล (Chart)',
};

const RATIO_IDIOM_RE = /\b24\s*\/\s*7\b/g;

function extractMeaningfulNumbers(scene: StudioScene): string[] {
  const t = sceneTexts(scene);
  if (t.numbers.length === 0) return [];
  const rawBlob = [t.title, t.subtitle, ...t.bullets].join(' ');
  const has247 = RATIO_IDIOM_RE.test(rawBlob);
  RATIO_IDIOM_RE.lastIndex = 0;
  if (!has247) return t.numbers;
  // Filter out standalone "24" and "7" caused solely by "24/7" idiom
  const cleanedBlob = rawBlob.replace(RATIO_IDIOM_RE, ' ');
  return t.numbers.filter((tok) => {
    if (tok === '24' || tok === '7') {
      return new RegExp(`(?<!\\d)${tok}(?!\\d)`).test(cleanedBlob);
    }
    return true;
  });
}

export function dataShotForScene(scene: StudioScene): string | null {
  const rawVisual =
    typeof scene.visual === 'string'
      ? scene.visual.trim().toLowerCase()
      : scene.visual && typeof scene.visual === 'object' && typeof scene.visual.type === 'string'
        ? scene.visual.type.trim().toLowerCase()
        : '';

  if (rawVisual === 'stat') return 'data-counter';
  if (rawVisual === 'steps') return 'data-steps';
  if (rawVisual === 'compare') return 'data-versus';
  if (rawVisual === 'bullets') return 'data-list';
  if (rawVisual === 'quote') return 'data-quote';
  if (rawVisual === 'chart') return 'data-chart';

  // Fallback to actual structured fields present on the scene
  if (scene.stat && scene.stat.value !== undefined && String(scene.stat.value).trim() !== '') {
    return 'data-counter';
  }
  if (Array.isArray(scene.steps) && scene.steps.length > 0) {
    return 'data-steps';
  }
  if (
    scene.compare &&
    ((Array.isArray(scene.compare.leftItems) && scene.compare.leftItems.length > 0) ||
      (Array.isArray(scene.compare.rightItems) && scene.compare.rightItems.length > 0) ||
      Boolean(scene.compare.leftTitle) ||
      Boolean(scene.compare.rightTitle))
  ) {
    return 'data-versus';
  }
  if (scene.quote && typeof scene.quote.text === 'string' && scene.quote.text.trim().length > 0) {
    return 'data-quote';
  }
  if (Array.isArray(scene.bullets) && scene.bullets.length > 0) {
    return 'data-list';
  }

  // Text containing multiple quantitative numbers -> data-chart
  const meaningfulNums = extractMeaningfulNumbers(scene);
  if (meaningfulNums.length >= 2) {
    return 'data-chart';
  }

  return null;
}

// ============================================================================
// DETERMINISTIC HELPERS, THEME RESOLVER & THAI WORD SEGMENTER
// ============================================================================

interface ShotTheme {
  bg: string;
  bg2: string;
  cardBg: string;
  cardBgElevated: string;
  fg: string;
  muted: string;
  accent: string;
  accent2: string;
  accentOnFill: string;
  accent2OnFill: string;
  border: string;
  isLight: boolean;
  fontFamily: string;
  cardRadius: number;
  glowIntensity: number;
}

function getVariant(props: StyleShotArgs): number {
  const raw = (props as StyleShotArgs & { variant?: number }).variant;
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.abs(Math.floor(raw)) : 0;
}

function seeded(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function resolveShotTheme(tokens: any): ShotTheme {
  const p = tokens?.palette || {};
  const bg = normalizeHex(p.bg, '#131722');
  const isLight = typeof tokens?.isLight === 'boolean' ? tokens.isLight : relativeLuminance(bg) > 0.42;

  const bg2 = normalizeHex(
    p.bg2 || p.bgSecondary,
    isLight ? shadeHex(bg, 0.92) : shadeHex(bg, 1.32),
  );
  const cardBg = normalizeHex(
    p.cardBg || p.surface,
    isLight ? '#FFFFFF' : shadeHex(bg, 1.28),
  );
  const cardBgElevated = isLight ? shadeHex(cardBg, 0.97) : shadeHex(cardBg, 1.24);

  let fg = normalizeHex(p.fg || p.text, isLight ? '#171A26' : '#F1F5F9');
  if (contrastRatio(fg, bg) < 4.2) {
    fg = isLight ? '#141724' : '#F1F5F9';
  }

  let muted = normalizeHex(p.muted, isLight ? '#52586B' : '#94A3B8');
  if (contrastRatio(muted, bg) < 2.8) {
    muted = isLight ? '#475569' : '#A6B4D0';
  }

  let accent = normalizeHex(p.accentReadable || p.accent, '#F3F5F7');
  if (contrastRatio(accent, bg) < 2.8) {
    accent = isLight ? '#1E293B' : '#F3F5F7';
  }

  let accent2 = normalizeHex(p.accent2, isLight ? shadeHex(accent, 0.8) : shadeHex(accent, 0.88));
  if (contrastRatio(accent2, bg) < 2.5) {
    accent2 = accent;
  }

  const accentOnFill =
    typeof p.accentOnFill === 'string' && p.accentOnFill.startsWith('#')
      ? p.accentOnFill
      : relativeLuminance(accent) > 0.44
        ? '#0F172A'
        : '#FFFFFF';

  const accent2OnFill = relativeLuminance(accent2) > 0.44 ? '#0F172A' : '#FFFFFF';

  const border = normalizeHex(
    p.border,
    isLight ? shadeHex(bg, 0.82) : shadeHex(bg, 1.85),
  );

  const rawFont =
    typeof tokens?.typography?.fontFamily === 'string' && tokens.typography.fontFamily.trim().length > 0
      ? tokens.typography.fontFamily.trim()
      : THAI_FONT_FAMILY;
  const fontFamily = rawFont.includes('Noto') ? rawFont : `${rawFont}, ${THAI_FONT_FAMILY}`;

  const cardRadius =
    typeof tokens?.cardRadius === 'number' && Number.isFinite(tokens.cardRadius)
      ? Math.max(12, Math.min(32, tokens.cardRadius))
      : 22;

  const glowIntensity =
    typeof tokens?.glowIntensity === 'number' && Number.isFinite(tokens.glowIntensity)
      ? clamp01(tokens.glowIntensity)
      : isLight
        ? 0.14
        : 0.42;

  return {
    bg,
    bg2,
    cardBg,
    cardBgElevated,
    fg,
    muted,
    accent,
    accent2,
    accentOnFill,
    accent2OnFill,
    border,
    isLight,
    fontFamily,
    cardRadius,
    glowIntensity,
  };
}

interface SegmentLike {
  segment: string;
}

interface SegmenterCtorLike {
  new (locale: string, options: { granularity: 'word' | 'grapheme' | 'sentence' }): {
    segment(input: string): Iterable<SegmentLike>;
  };
}

function segmentThaiWords(text: string): string[] {
  const clean = String(text || '').trim();
  if (!clean) return [];
  try {
    const IntlAny = Intl as unknown as { Segmenter?: SegmenterCtorLike };
    if (typeof Intl !== 'undefined' && typeof IntlAny.Segmenter === 'function') {
      const seg = new IntlAny.Segmenter('th', { granularity: 'word' });
      const out: string[] = [];
      for (const part of seg.segment(clean)) {
        if (part.segment) out.push(part.segment);
      }
      if (out.length > 0) return out;
    }
  } catch {
    // fallback below
  }
  return clean.split(/(\s+)/).filter((s) => s.length > 0);
}

function inferBadgeIcon(scene: StudioScene, fallback: string): string {
  if (scene.icon && scene.icon.trim()) return scene.icon.trim().toLowerCase();
  const blob = `${scene.title || ''} ${scene.subtitle || ''} ${scene.badge || ''}`.toLowerCase();
  if (/กราฟ|สถิติ|ตลาด|chart|market|data/.test(blob)) return 'chart';
  if (/ขั้นตอน|กลไก|ระบบ|api|cpu|step/.test(blob)) return 'cpu';
  if (/ปลอดภัย|เกราะ|กฎ|risk|shield|stop/.test(blob)) return 'shield';
  if (/เงิน|บาท|ดอลลาร์|กำไร|ทุน|money/.test(blob)) return 'money';
  if (/ไว|เร็ว|ไฟ|bolt|vs/.test(blob)) return 'bolt';
  if (/เวลา|24|clock/.test(blob)) return 'clock';
  return fallback;
}

// ============================================================================
// SHARED STUDIO STAGE BACKDROP & HEADER
// ============================================================================

const ShotBackdrop: React.FC<{
  theme: ShotTheme;
  localFrame: number;
  fps: number;
  sceneIndex: number;
  variant: number;
  diagonalSplit?: boolean;
}> = ({ theme, localFrame, fps, sceneIndex, variant, diagonalSplit = false }) => {
  const t = localFrame / Math.max(1, fps);
  const uid = `ds-bg-${sceneIndex}-${variant}`;
  const orb1X = 180 + Math.sin(t * 0.65 + sceneIndex) * 56;
  const orb1Y = 390 + Math.cos(t * 0.52 + variant) * 44;
  const orb2X = 890 + Math.cos(t * 0.58 + sceneIndex * 1.3) * 60;
  const orb2Y = 1220 + Math.sin(t * 0.48 + variant) * 52;
  const gridShiftY = (localFrame * 0.35) % 64;

  return (
    <svg
      width={STAGE_W}
      height={STAGE_H}
      viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <defs>
        <linearGradient id={`${uid}-grad`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={theme.bg} />
          <stop offset="55%" stopColor={theme.bg2} />
          <stop offset="100%" stopColor={theme.bg} />
        </linearGradient>
        <radialGradient id={`${uid}-orb1`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={theme.accent} stopOpacity={theme.isLight ? 0.14 : 0.18 + theme.glowIntensity * 0.12} />
          <stop offset="100%" stopColor={theme.accent} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}-orb2`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={theme.accent2} stopOpacity={theme.isLight ? 0.12 : 0.14 + theme.glowIntensity * 0.1} />
          <stop offset="100%" stopColor={theme.accent2} stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width={STAGE_W} height={STAGE_H} fill={`url(#${uid}-grad)`} />

      {/* Ambient moving grid */}
      <g opacity={theme.isLight ? 0.16 : 0.13} stroke={theme.border} strokeWidth={1.1}>
        {Array.from({ length: 18 }, (_, i) => {
          const x = i * 64;
          return <line key={`vx-${i}`} x1={x} y1={0} x2={x} y2={STAGE_H} />;
        })}
        {Array.from({ length: 32 }, (_, i) => {
          const y = i * 64 + gridShiftY - 64;
          return <line key={`hy-${i}`} x1={0} y1={y} x2={STAGE_W} y2={y} />;
        })}
      </g>

      {/* Breathing ambient studio orbs */}
      <circle cx={orb1X} cy={orb1Y} r={390} fill={`url(#${uid}-orb1)`} />
      <circle cx={orb2X} cy={orb2Y} r={420} fill={`url(#${uid}-orb2)`} />

      {/* Subtle architectural corner marks */}
      {!diagonalSplit && (
        <g stroke={hexToRgba(theme.accent, theme.isLight ? 0.35 : 0.28)} strokeWidth={2.2} fill="none">
          <path d="M 44 76 L 44 48 L 76 48" />
          <path d="M 1036 76 L 1036 48 L 1004 48" />
          <path d={`M 44 ${SAFE_BOTTOM - 44} L 44 ${SAFE_BOTTOM - 16} L 76 ${SAFE_BOTTOM - 16}`} />
          <path d={`M 1036 ${SAFE_BOTTOM - 44} L 1036 ${SAFE_BOTTOM - 16} L 1004 ${SAFE_BOTTOM - 16}`} />
        </g>
      )}
    </svg>
  );
};

const ShotHeader: React.FC<{
  scene: StudioScene;
  theme: ShotTheme;
  localFrame: number;
  align?: 'center' | 'left';
  defaultIcon: string;
  showSubtitle?: boolean;
}> = ({ scene, theme, localFrame, align = 'center', defaultIcon, showSubtitle = false }) => {
  const t = sceneTexts(scene);
  const titleText = t.title || scene.title || 'ข้อมูลสำคัญ';
  const enter = appear(localFrame, 0, 14);
  const barW = Math.round(32 + 96 * easeOutCubic(clamp01((localFrame + 2) / 18)));
  const pulse = 0.65 + 0.35 * Math.sin(localFrame * 0.16);
  const iconName = inferBadgeIcon(scene, defaultIcon);

  return (
    <div
      style={{
        position: 'absolute',
        top: 84,
        left: 64,
        right: 64,
        zIndex: 8,
        display: 'flex',
        flexDirection: 'column',
        alignItems: align === 'center' ? 'center' : 'flex-start',
        gap: 14,
        opacity: 0.25 + enter * 0.75,
        transform: `translate3d(0, ${((1 - enter) * 16).toFixed(1)}px, 0)`,
      }}
    >
      {t.badge ? (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 20px',
            borderRadius: 999,
            backgroundColor: hexToRgba(theme.cardBg, theme.isLight ? 0.92 : 0.82),
            border: `1.8px solid ${hexToRgba(theme.accent, 0.45)}`,
            boxShadow: `0 6px 20px ${hexToRgba(theme.accent, theme.isLight ? 0.08 : 0.14)}`,
          }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              backgroundColor: theme.accent,
              opacity: pulse,
              boxShadow: `0 0 10px ${theme.accent}`,
            }}
          />
          <StudioVectorIcon name={iconName} size={20} color={theme.accent} secondary={theme.accent2} />
          <span
            style={{
              fontFamily: theme.fontFamily,
              fontSize: 20,
              fontWeight: 800,
              letterSpacing: 1.6,
              color: theme.accent,
              lineHeight: 1.2,
              textTransform: 'uppercase',
            }}
          >
            {t.badge}
          </span>
        </div>
      ) : null}

      <div style={{ width: '100%', maxWidth: 940 }}>
        <FitText
          text={titleText}
          baseSize={54}
          minSize={34}
          maxLines={2}
          color={theme.fg}
          fontWeight={800}
          fontFamily={theme.fontFamily}
          align={align}
          lineHeight={1.26}
        />
      </div>

      <div
        style={{
          width: barW,
          height: 5,
          borderRadius: 99,
          background: `linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent2} 100%)`,
          boxShadow: `0 0 14px ${hexToRgba(theme.accent, 0.45)}`,
        }}
      />

      {showSubtitle && t.subtitle ? (
        <div style={{ width: '100%', maxWidth: 840 }}>
          <FitText
            text={t.subtitle}
            baseSize={26}
            minSize={20}
            maxLines={2}
            color={theme.muted}
            fontWeight={600}
            fontFamily={theme.fontFamily}
            align={align}
            lineHeight={1.36}
          />
        </div>
      ) : null}
    </div>
  );
};

// ============================================================================
// 1. DATA-COUNTER: Odometer Number + Expanding Ring/Gauge + Burst Particles
// ============================================================================

interface ParsedStat {
  target: number | null;
  decimals: number;
  prefix: string;
  suffix: string;
  rawDisplay: string;
  unit: string;
  label: string;
  delta: string;
  progress: number;
}

function parseCounterStat(scene: StudioScene): ParsedStat {
  const t = sceneTexts(scene);
  const st = scene.stat;
  const fallbackLabel = t.subtitle || t.bullets[0] || t.title || 'สถิติสำคัญ';

  if (st) {
    const rawStr = String(st.value ?? '').trim();
    const unit = String(st.unit ?? '').trim();
    const label = String(st.label || fallbackLabel).trim();
    const delta = String(st.delta ?? '').trim();
    const progress =
      typeof st.progress === 'number' && Number.isFinite(st.progress)
        ? Math.max(15, Math.min(100, st.progress))
        : 84;

    if (typeof st.numericValue === 'number' && Number.isFinite(st.numericValue)) {
      const dec = String(st.numericValue).includes('.') ? String(st.numericValue).split('.')[1].length : 0;
      return {
        target: st.numericValue,
        decimals: Math.min(2, dec),
        prefix: st.prefix ?? '',
        suffix: st.suffix ?? '',
        rawDisplay: rawStr || String(st.numericValue),
        unit,
        label,
        delta,
        progress,
      };
    }

    const m = /^([^0-9-]*)(-?[0-9][0-9,]*(?:\.[0-9]+)?)(.*)$/.exec(rawStr);
    if (m) {
      const cleaned = m[2].replace(/,/g, '');
      const num = Number(cleaned);
      if (Number.isFinite(num)) {
        const dec = cleaned.includes('.') ? cleaned.split('.')[1].length : 0;
        const pctHint = m[3].includes('%') ? Math.max(15, Math.min(100, num)) : progress;
        return {
          target: num,
          decimals: Math.min(2, dec),
          prefix: st.prefix ?? m[1],
          suffix: st.suffix ?? m[3],
          rawDisplay: rawStr,
          unit,
          label,
          delta,
          progress: pctHint,
        };
      }
    }

    return {
      target: null,
      decimals: 0,
      prefix: '',
      suffix: '',
      rawDisplay: rawStr || '100%',
      unit,
      label,
      delta,
      progress,
    };
  }

  // Fallback when scene.stat is missing: extract first number from text
  if (t.numbers.length > 0) {
    const rawStr = t.numbers[0];
    const m = /^([^0-9-]*)(-?[0-9][0-9,]*(?:\.[0-9]+)?)(.*)$/.exec(rawStr.trim());
    if (m) {
      const cleaned = m[2].replace(/,/g, '');
      const num = Number(cleaned);
      if (Number.isFinite(num)) {
        const dec = cleaned.includes('.') ? cleaned.split('.')[1].length : 0;
        return {
          target: num,
          decimals: Math.min(2, dec),
          prefix: m[1],
          suffix: m[3],
          rawDisplay: rawStr,
          unit: '',
          label: fallbackLabel,
          delta: t.bullets[1] || '',
          progress: m[3].includes('%') ? Math.max(15, Math.min(100, num)) : 82,
        };
      }
    }
  }

  return {
    target: 100,
    decimals: 0,
    prefix: '',
    suffix: '%',
    rawDisplay: '100%',
    unit: '',
    label: fallbackLabel,
    delta: '',
    progress: 86,
  };
}

const OdometerDigits: React.FC<{
  valueStr: string;
  rolling: boolean;
  rollPhase: number;
  fontSize: number;
  color: string;
  fontFamily: string;
}> = ({ valueStr, rolling, rollPhase, fontSize, color, fontFamily }) => {
  const chars = Array.from(valueStr);
  const slotH = Math.round(fontSize * 1.14);

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily,
        fontSize,
        fontWeight: 900,
        color,
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {chars.map((ch, idx) => {
        const isDigit = ch >= '0' && ch <= '9';
        if (!isDigit || !rolling) {
          return (
            <span
              key={idx}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: slotH,
                minWidth: isDigit ? fontSize * 0.6 : undefined,
              }}
            >
              {ch}
            </span>
          );
        }
        const digit = Number(ch);
        const prevDigit = (digit + 9) % 10;
        const frac = (rollPhase * (idx + 1.5)) % 1;
        const yOff = (1 - frac) * slotH * 0.32;
        return (
          <span
            key={idx}
            style={{
              position: 'relative',
              display: 'inline-block',
              height: slotH,
              minWidth: fontSize * 0.6,
              overflow: 'hidden',
              textAlign: 'center',
            }}
          >
            <span
              style={{
                display: 'block',
                height: slotH,
                lineHeight: `${slotH}px`,
                transform: `translate3d(0, ${yOff.toFixed(1)}px, 0)`,
              }}
            >
              {ch}
            </span>
            <span
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: -slotH,
                height: slotH,
                lineHeight: `${slotH}px`,
                opacity: 0.45,
                transform: `translate3d(0, ${yOff.toFixed(1)}px, 0)`,
              }}
            >
              {prevDigit}
            </span>
          </span>
        );
      })}
    </div>
  );
};

const DataCounterShot: React.FC<StyleShotArgs> = (props) => {
  const { scene, sceneIndex, localFrame, durationFrames, fps, tokens } = props;
  const variant = getVariant(props);
  const altLayout = variant % 2 === 1;
  const theme = resolveShotTheme(tokens);
  const st = parseCounterStat(scene);
  const uid = `dc-${sceneIndex}-${variant}`;

  const countStart = 6;
  const countDur = Math.max(22, Math.min(46, Math.round(durationFrames * 0.42)));
  const rawCountT = clamp01((localFrame - countStart) / countDur);
  const countT = easeOutCubic(rawCountT);
  const isCounting = rawCountT > 0 && rawCountT < 0.995;

  const displayStr =
    st.target !== null
      ? `${st.prefix}${(st.target * countT).toLocaleString('en-US', {
          minimumFractionDigits: st.decimals,
          maximumFractionDigits: st.decimals,
        })}${st.suffix}`
      : st.rawDisplay;

  const completeFrame = countStart + countDur;
  const burstFrames = localFrame - completeFrame;
  const burstProgress = clamp01(burstFrames / 28);
  const burstPop =
    burstFrames >= 0
      ? 1 +
        0.09 *
          Math.sin(clamp01(burstFrames / 12) * Math.PI) *
          (1 - clamp01(burstFrames / 18))
      : 1;

  const enterSp = spring({
    frame: Math.max(0, localFrame - 2),
    fps,
    config: { damping: 14, stiffness: 150, mass: 0.85 },
  });
  const labelEnter = appear(localFrame, 12, 16);
  const deltaEnter = appear(localFrame, 20, 16);

  const digitFontSize =
    displayStr.length >= 10 ? 74 : displayStr.length >= 7 ? 94 : displayStr.length >= 5 ? 116 : 136;

  // Deterministic celebration burst particles
  const particles = Array.from({ length: 18 }, (_, i) => {
    const angle = (i / 18) * Math.PI * 2 + seeded(sceneIndex * 31 + variant * 13 + i) * 0.28;
    const distBase = 230 + seeded(sceneIndex * 47 + i * 7) * 145;
    const size = 7 + seeded(sceneIndex * 19 + i * 11) * 11;
    const shape = i % 3; // 0 circle, 1 diamond, 2 spark line
    return { angle, distBase, size, shape, useAlt: i % 2 === 1 };
  });

  const cx = STAGE_W / 2;
  const cy = altLayout ? 790 : 810;

  // Variant 0: Full 360 orbital radial gauge
  const rMain = 252;
  const circ = 2 * Math.PI * rMain;
  const targetRatio = st.progress / 100;
  const activeRatio = targetRatio * countT;
  const dashOffset = circ * (1 - activeRatio);
  const tipAngleRad = (-90 + activeRatio * 360) * (Math.PI / 180);
  const tipX = cx + Math.cos(tipAngleRad) * rMain;
  const tipY = cy + Math.sin(tipAngleRad) * rMain;

  // Variant 1: 220-deg cockpit speedometer arc
  const arcR = 300;
  const startDeg = 160;
  const sweepDeg = 220;
  const arcLen = (sweepDeg / 360) * 2 * Math.PI * arcR;
  const arcDashOffset = arcLen * (1 - activeRatio);
  const polarPt = (deg: number, radius: number): [number, number] => {
    const rad = (deg * Math.PI) / 180;
    return [cx + Math.cos(rad) * radius, cy + Math.sin(rad) * radius];
  };
  const [aStartX, aStartY] = polarPt(startDeg, arcR);
  const [aEndX, aEndY] = polarPt(startDeg + sweepDeg, arcR);
  const arcPath = `M ${aStartX.toFixed(1)} ${aStartY.toFixed(1)} A ${arcR} ${arcR} 0 1 1 ${aEndX.toFixed(1)} ${aEndY.toFixed(1)}`;
  const [needleX, needleY] = polarPt(startDeg + sweepDeg * activeRatio, arcR);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <ShotBackdrop theme={theme} localFrame={localFrame} fps={fps} sceneIndex={sceneIndex} variant={variant} />
      <ShotHeader scene={scene} theme={theme} localFrame={localFrame} align="center" defaultIcon="chart" />

      {/* SVG Gauge + Expanding Ripples + Completion Particle Burst */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0 }}
      >
        <defs>
          <linearGradient id={`${uid}-ring`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={theme.accent} />
            <stop offset="100%" stopColor={theme.accent2} />
          </linearGradient>
          <radialGradient id={`${uid}-core`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={theme.accent} stopOpacity={theme.isLight ? 0.14 : 0.22} />
            <stop offset="70%" stopColor={theme.cardBg} stopOpacity={0.9} />
            <stop offset="100%" stopColor={theme.cardBg} stopOpacity={0.96} />
          </radialGradient>
        </defs>

        {/* Expanding ambient sonar rings during count-up */}
        {[0, 1, 2].map((ri) => {
          const phase = ((localFrame * 0.018 + ri * 0.33) % 1);
          const rr = (altLayout ? 240 : 250) + phase * 195;
          const op = (1 - phase) * (theme.isLight ? 0.18 : 0.22);
          return (
            <circle
              key={ri}
              cx={cx}
              cy={cy}
              r={rr}
              fill="none"
              stroke={theme.accent}
              strokeWidth={1.6}
              opacity={op}
            />
          );
        })}

        {!altLayout ? (
          <g transform={`translate(${cx}, ${cy}) scale(${(0.84 + 0.16 * enterSp) * burstPop}) translate(${-cx}, ${-cy})`}>
            {/* Rotating outer ticks */}
            <g transform={`rotate(${(localFrame * 0.35).toFixed(2)} ${cx} ${cy})`} opacity={0.45}>
              {Array.from({ length: 48 }, (_, ti) => {
                const a = (ti / 48) * Math.PI * 2;
                const major = ti % 6 === 0;
                const r1 = rMain + 26;
                const r2 = rMain + (major ? 44 : 34);
                return (
                  <line
                    key={ti}
                    x1={cx + Math.cos(a) * r1}
                    y1={cy + Math.sin(a) * r1}
                    x2={cx + Math.cos(a) * r2}
                    y2={cy + Math.sin(a) * r2}
                    stroke={major ? theme.accent : theme.muted}
                    strokeWidth={major ? 3 : 1.6}
                    strokeLinecap="round"
                  />
                );
              })}
            </g>

            {/* Core studio disc */}
            <circle
              cx={cx}
              cy={cy}
              r={rMain - 14}
              fill={`url(#${uid}-core)`}
              stroke={hexToRgba(theme.border, 0.85)}
              strokeWidth={2.5}
            />

            {/* Track circle */}
            <circle
              cx={cx}
              cy={cy}
              r={rMain}
              fill="none"
              stroke={hexToRgba(theme.border, 0.55)}
              strokeWidth={24}
            />

            {/* Active progress arc */}
            <circle
              cx={cx}
              cy={cy}
              r={rMain}
              fill="none"
              stroke={`url(#${uid}-ring)`}
              strokeWidth={24}
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />

            {/* Glowing arc head orb */}
            {activeRatio > 0.01 && (
              <g>
                <circle cx={tipX} cy={tipY} r={22} fill={theme.accent} opacity={0.28} />
                <circle cx={tipX} cy={tipY} r={10} fill={theme.accent} stroke={theme.bg} strokeWidth={3} />
              </g>
            )}
          </g>
        ) : (
          <g transform={`translate(${cx}, ${cy}) scale(${(0.86 + 0.14 * enterSp) * burstPop}) translate(${-cx}, ${-cy})`}>
            {/* Architectural speedometer ticks */}
            {Array.from({ length: 23 }, (_, ti) => {
              const deg = startDeg + (ti / 22) * sweepDeg;
              const major = ti % 4 === 0;
              const [x1, y1] = polarPt(deg, arcR + 24);
              const [x2, y2] = polarPt(deg, arcR + (major ? 46 : 34));
              return (
                <line
                  key={ti}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={ti / 22 <= activeRatio ? theme.accent : theme.border}
                  strokeWidth={major ? 3.5 : 2}
                  strokeLinecap="round"
                  opacity={ti / 22 <= activeRatio ? 0.92 : 0.45}
                />
              );
            })}

            {/* Background arch track */}
            <path
              d={arcPath}
              fill="none"
              stroke={hexToRgba(theme.border, 0.55)}
              strokeWidth={28}
              strokeLinecap="round"
            />
            {/* Glowing active arch */}
            <path
              d={arcPath}
              fill="none"
              stroke={`url(#${uid}-ring)`}
              strokeWidth={28}
              strokeLinecap="round"
              strokeDasharray={arcLen}
              strokeDashoffset={arcDashOffset}
            />
            {/* Active tip indicator */}
            {activeRatio > 0.01 && (
              <g>
                <circle cx={needleX} cy={needleY} r={24} fill={theme.accent} opacity={0.28} />
                <circle cx={needleX} cy={needleY} r={11} fill={theme.accent} stroke={theme.bg} strokeWidth={3} />
              </g>
            )}
          </g>
        )}

        {/* Completion shockwave & particle burst */}
        {burstFrames >= 0 && burstProgress < 1 && (
          <g>
            <circle
              cx={cx}
              cy={cy}
              r={(altLayout ? 270 : rMain) + easeOutCubic(burstProgress) * 165}
              fill="none"
              stroke={theme.accent}
              strokeWidth={6 * (1 - burstProgress)}
              opacity={(1 - burstProgress) * 0.72}
            />
            {particles.map((pt, idx) => {
              const dist = (altLayout ? 210 : 240) + easeOutCubic(burstProgress) * pt.distBase;
              const px = cx + Math.cos(pt.angle) * dist;
              const py = cy + Math.sin(pt.angle) * dist;
              const op = Math.sin(burstProgress * Math.PI) * 0.95;
              const color = pt.useAlt ? theme.accent2 : theme.accent;
              if (pt.shape === 0) {
                return <circle key={idx} cx={px} cy={py} r={pt.size * 0.55} fill={color} opacity={op} />;
              }
              if (pt.shape === 1) {
                const s = pt.size * 0.65;
                return (
                  <polygon
                    key={idx}
                    points={`${px},${py - s} ${px + s},${py} ${px},${py + s} ${px - s},${py}`}
                    fill={color}
                    opacity={op}
                  />
                );
              }
              const dx = Math.cos(pt.angle) * pt.size * 1.4;
              const dy = Math.sin(pt.angle) * pt.size * 1.4;
              return (
                <line
                  key={idx}
                  x1={px - dx}
                  y1={py - dy}
                  x2={px + dx}
                  y2={py + dy}
                  stroke={color}
                  strokeWidth={3.2}
                  strokeLinecap="round"
                  opacity={op}
                />
              );
            })}
          </g>
        )}
      </svg>

      {/* Center Odometer Display */}
      <div
        style={{
          position: 'absolute',
          top: altLayout ? 660 : 652,
          left: 110,
          right: 110,
          height: 310,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          zIndex: 6,
          transform: `scale(${((0.86 + 0.14 * enterSp) * burstPop).toFixed(4)})`,
        }}
      >
        {altLayout ? (
          <div
            style={{
              padding: '30px 44px',
              borderRadius: theme.cardRadius + 6,
              backgroundColor: hexToRgba(theme.cardBg, theme.isLight ? 0.95 : 0.88),
              border: `2.5px solid ${hexToRgba(theme.accent, 0.5)}`,
              boxShadow: `0 22px 54px ${hexToRgba('#000000', theme.isLight ? 0.12 : 0.44)}`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
              minWidth: 520,
              maxWidth: 840,
            }}
          >
            <OdometerDigits
              valueStr={displayStr}
              rolling={isCounting}
              rollPhase={localFrame * 0.27}
              fontSize={digitFontSize}
              color={theme.accent}
              fontFamily={theme.fontFamily}
            />
            {st.unit ? (
              <div
                style={{
                  padding: '6px 22px',
                  borderRadius: 999,
                  backgroundColor: hexToRgba(theme.accent, 0.14),
                  color: theme.muted,
                  fontFamily: theme.fontFamily,
                  fontSize: 26,
                  fontWeight: 800,
                  letterSpacing: 1.5,
                }}
              >
                {st.unit}
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <OdometerDigits
              valueStr={displayStr}
              rolling={isCounting}
              rollPhase={localFrame * 0.27}
              fontSize={digitFontSize}
              color={theme.accent}
              fontFamily={theme.fontFamily}
            />
            {st.unit ? (
              <div
                style={{
                  fontFamily: theme.fontFamily,
                  fontSize: 30,
                  fontWeight: 800,
                  letterSpacing: 2,
                  color: theme.muted,
                  paddingTop: 4,
                }}
              >
                {st.unit}
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Bottom Metric Label + Progress/Delta Card (strictly above SAFE_BOTTOM) */}
      <div
        style={{
          position: 'absolute',
          top: altLayout ? 1050 : 1135,
          left: 72,
          right: 72,
          maxHeight: SAFE_BOTTOM - 1080,
          zIndex: 7,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 18,
          opacity: labelEnter,
          transform: `translate3d(0, ${((1 - labelEnter) * 26).toFixed(1)}px, 0)`,
        }}
      >
        <div
          style={{
            width: '100%',
            padding: '26px 34px',
            borderRadius: theme.cardRadius,
            backgroundColor: hexToRgba(theme.cardBg, theme.isLight ? 0.94 : 0.84),
            border: `2px solid ${hexToRgba(theme.border, 0.85)}`,
            boxShadow: `0 16px 40px ${hexToRgba('#000000', theme.isLight ? 0.08 : 0.34)}`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <FitText
            text={st.label}
            baseSize={36}
            minSize={24}
            maxLines={2}
            color={theme.fg}
            fontWeight={800}
            fontFamily={theme.fontFamily}
            align="center"
            lineHeight={1.38}
          />

          {/* Horizontal progress bar for Variant 1 */}
          {altLayout && (
            <div
              style={{
                width: '100%',
                height: 14,
                borderRadius: 99,
                backgroundColor: hexToRgba(theme.border, 0.55),
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${(activeRatio * 100).toFixed(1)}%`,
                  height: '100%',
                  borderRadius: 99,
                  background: `linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent2} 100%)`,
                }}
              />
            </div>
          )}

          {st.delta ? (
            <div
              style={{
                opacity: deltaEnter,
                padding: '10px 26px',
                borderRadius: 999,
                backgroundColor: hexToRgba(theme.accent, theme.isLight ? 0.14 : 0.18),
                border: `1.8px solid ${hexToRgba(theme.accent, 0.55)}`,
              }}
            >
              <FitText
                text={st.delta}
                baseSize={25}
                minSize={19}
                maxLines={1}
                color={theme.accent}
                fontWeight={800}
                fontFamily={theme.fontFamily}
                align="center"
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 2. DATA-STEPS: Vertical / Serpentine Pipeline + Traveling Light Pulse
// ============================================================================

function normalizeSteps(scene: StudioScene): StudioStepItem[] {
  if (Array.isArray(scene.steps) && scene.steps.length > 0) {
    return scene.steps.slice(0, 5).map((s, idx) =>
      typeof s === 'string'
        ? { step: String(idx + 1).padStart(2, '0'), title: s.trim() || `ขั้นตอนที่ ${idx + 1}` }
        : {
            step: s.step ? String(s.step) : String(idx + 1).padStart(2, '0'),
            title: String(s.title || `ขั้นตอนที่ ${idx + 1}`).trim(),
            detail: s.detail ? String(s.detail).trim() : undefined,
          },
    );
  }
  const t = sceneTexts(scene);
  if (t.bullets.length > 0) {
    return t.bullets.slice(0, 4).map((b, idx) => {
      const colonIdx = b.indexOf(':');
      if (colonIdx > 1 && colonIdx < 36) {
        return {
          step: String(idx + 1).padStart(2, '0'),
          title: b.slice(0, colonIdx).trim(),
          detail: b.slice(colonIdx + 1).trim(),
        };
      }
      return { step: String(idx + 1).padStart(2, '0'), title: b };
    });
  }
  return [
    { step: '01', title: t.title || 'เริ่มต้นระบบ', detail: t.subtitle || undefined },
    { step: '02', title: t.subtitle || 'ดำเนินการตามลำดับ', detail: 'ทำงานอัตโนมัติและตรวจสอบผลลัพธ์' },
  ];
}

const DataStepsShot: React.FC<StyleShotArgs> = (props) => {
  const { scene, sceneIndex, localFrame, durationFrames, fps, tokens } = props;
  const variant = getVariant(props);
  const serpentine = variant % 2 === 1;
  const theme = resolveShotTheme(tokens);
  const steps = normalizeSteps(scene);
  const uid = `ds-steps-${sceneIndex}-${variant}`;

  const stageTop = 344;
  const stageBottom = 1468;
  const stageHeight = stageBottom - stageTop;
  const count = steps.length;
  const rowHeight = Math.min(256, Math.floor((stageHeight - (count - 1) * 24) / Math.max(1, count)));
  const totalBlockH = count * rowHeight + (count - 1) * 24;
  const startY = stageTop + Math.max(0, Math.floor((stageHeight - totalBlockH) / 2));

  // Node center positions
  const nodes = steps.map((_, idx) => {
    const cy = startY + idx * (rowHeight + 24) + rowHeight / 2;
    const cx = serpentine ? (idx % 2 === 0 ? 180 : 900) : 138;
    return { cx, cy };
  });

  // Build SVG path through nodes
  let pathD = '';
  if (nodes.length === 1) {
    pathD = `M ${nodes[0].cx} ${nodes[0].cy - 40} L ${nodes[0].cx} ${nodes[0].cy + 40}`;
  } else if (!serpentine) {
    pathD = `M ${nodes[0].cx} ${nodes[0].cy} L ${nodes[nodes.length - 1].cx} ${nodes[nodes.length - 1].cy}`;
  } else {
    pathD = `M ${nodes[0].cx} ${nodes[0].cy}`;
    for (let i = 1; i < nodes.length; i++) {
      const prev = nodes[i - 1];
      const curr = nodes[i];
      const midY = (prev.cy + curr.cy) / 2;
      pathD += ` C ${prev.cx} ${midY}, ${curr.cx} ${midY}, ${curr.cx} ${curr.cy}`;
    }
  }

  // Approximate path length for dash animation
  let approxLen = 100;
  if (nodes.length > 1) {
    approxLen = 0;
    for (let i = 1; i < nodes.length; i++) {
      const dx = nodes[i].cx - nodes[i - 1].cx;
      const dy = nodes[i].cy - nodes[i - 1].cy;
      approxLen += Math.hypot(dx, dy) * (serpentine ? 1.24 : 1);
    }
  }

  const drawDur = Math.max(24, Math.min(54, Math.round(durationFrames * 0.45)));
  const lineProgress = easeOutCubic(clamp01((localFrame - 5) / drawDur));

  // Continuous traveling light pulse along pipeline (0..1)
  const pulseCycle = 68;
  const pulseT = localFrame < 8 ? 0 : ((localFrame - 8) % pulseCycle) / pulseCycle;

  // Compute exact (x, y) of traveling pulse along segments
  const samplePulsePoint = (tVal: number): { x: number; y: number } => {
    if (nodes.length <= 1) return { x: nodes[0]?.cx ?? 138, y: nodes[0]?.cy ?? 700 };
    const segCount = nodes.length - 1;
    const scaled = clamp01(tVal) * segCount;
    const segIdx = Math.min(segCount - 1, Math.floor(scaled));
    const u = scaled - segIdx;
    const p0 = nodes[segIdx];
    const p3 = nodes[segIdx + 1];
    if (!serpentine) {
      return {
        x: p0.cx + (p3.cx - p0.cx) * u,
        y: p0.cy + (p3.cy - p0.cy) * u,
      };
    }
    const midY = (p0.cy + p3.cy) / 2;
    const inv = 1 - u;
    const x =
      inv * inv * inv * p0.cx +
      3 * inv * inv * u * p0.cx +
      3 * inv * u * u * p3.cx +
      u * u * u * p3.cx;
    const y =
      inv * inv * inv * p0.cy +
      3 * inv * inv * u * midY +
      3 * inv * u * u * midY +
      u * u * u * p3.cy;
    return { x, y };
  };

  const pulsePt = samplePulsePoint(pulseT);
  const trail1 = samplePulsePoint(Math.max(0, pulseT - 0.04));
  const trail2 = samplePulsePoint(Math.max(0, pulseT - 0.08));

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <ShotBackdrop theme={theme} localFrame={localFrame} fps={fps} sceneIndex={sceneIndex} variant={variant} />
      <ShotHeader
        scene={scene}
        theme={theme}
        localFrame={localFrame}
        align={serpentine ? 'center' : 'left'}
        defaultIcon="cpu"
        showSubtitle={count <= 3}
      />

      {/* Pipeline SVG Layer */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0, zIndex: 3 }}
      >
        <defs>
          <linearGradient id={`${uid}-pipe`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={theme.accent} />
            <stop offset="100%" stopColor={theme.accent2} />
          </linearGradient>
          <radialGradient id={`${uid}-pulse`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={theme.accent} stopOpacity="1" />
            <stop offset="45%" stopColor={theme.accent2} stopOpacity="0.55" />
            <stop offset="100%" stopColor={theme.accent} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Base dim track */}
        <path
          d={pathD}
          fill="none"
          stroke={hexToRgba(theme.border, 0.55)}
          strokeWidth={10}
          strokeLinecap="round"
        />

        {/* Animated drawn active pipeline */}
        <path
          d={pathD}
          fill="none"
          stroke={`url(#${uid}-pipe)`}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={approxLen}
          strokeDashoffset={approxLen * (1 - lineProgress)}
        />

        {/* Subtle glowing bloom behind active line */}
        <path
          d={pathD}
          fill="none"
          stroke={theme.accent}
          strokeWidth={18}
          strokeLinecap="round"
          opacity={theme.isLight ? 0.14 : 0.22}
          strokeDasharray={approxLen}
          strokeDashoffset={approxLen * (1 - lineProgress)}
        />

        {/* Traveling light comet */}
        {localFrame >= 8 && lineProgress > 0.2 && (
          <g>
            <circle cx={trail2.x} cy={trail2.y} r={12} fill={theme.accent} opacity={0.22} />
            <circle cx={trail1.x} cy={trail1.y} r={16} fill={theme.accent} opacity={0.42} />
            <circle cx={pulsePt.x} cy={pulsePt.y} r={34} fill={`url(#${uid}-pulse)`} />
            <circle cx={pulsePt.x} cy={pulsePt.y} r={10} fill={theme.accentOnFill === '#0F172A' ? '#FFFFFF' : theme.accent} stroke={theme.accent} strokeWidth={3} />
          </g>
        )}
      </svg>

      {/* Step Nodes & Cards */}
      {steps.map((item, idx) => {
        const node = nodes[idx];
        const delay = 5 + idx * 8;
        const sp = spring({
          frame: Math.max(0, localFrame - delay),
          fps,
          config: { damping: 15, stiffness: 165, mass: 0.8 },
        });
        const op = clamp01(sp * 1.4);
        const isFinal = idx === count - 1;
        const nodeT = count > 1 ? idx / (count - 1) : 0;
        const distToPulse = Math.abs(pulseT - nodeT);
        const lit = localFrame >= 8 ? clamp01(1 - distToPulse * 5.2) : 0;

        const onRightSide = serpentine && idx % 2 === 1;
        const slideFrom = serpentine ? (onRightSide ? 64 : -64) : 48;
        const tx = interpolate(sp, [0, 1], [slideFrom, 0]);

        const cardLeft = serpentine ? (onRightSide ? 66 : 264) : 226;
        const cardWidth = serpentine ? 750 : 788;
        const cardTop = node.cy - rowHeight / 2;
        const badgeColor = isFinal ? theme.accent2 : theme.accent;
        const badgeText = isFinal ? theme.accent2OnFill : theme.accentOnFill;
        const compactText = count >= 4;

        return (
          <React.Fragment key={idx}>
            {/* Step Node Circle */}
            <div
              style={{
                position: 'absolute',
                left: node.cx - 46,
                top: node.cy - 46,
                width: 92,
                height: 92,
                borderRadius: '50%',
                backgroundColor: badgeColor,
                color: badgeText,
                border: `5px solid ${theme.bg}`,
                boxShadow: `0 0 ${Math.round(16 + lit * 28)}px ${hexToRgba(badgeColor, 0.35 + lit * 0.45)}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: theme.fontFamily,
                fontSize: 32,
                fontWeight: 900,
                zIndex: 6,
                opacity: op,
                transform: `scale(${(0.65 + 0.35 * sp + lit * 0.08).toFixed(4)})`,
              }}
            >
              {item.step || String(idx + 1).padStart(2, '0')}
            </div>

            {/* Step Content Card */}
            <div
              style={{
                position: 'absolute',
                left: cardLeft,
                top: cardTop,
                width: cardWidth,
                height: rowHeight,
                zIndex: 5,
                borderRadius: theme.cardRadius,
                backgroundColor: hexToRgba(theme.cardBg, theme.isLight ? 0.95 : 0.86),
                border: `2.2px solid ${hexToRgba(lit > 0.3 || isFinal ? theme.accent : theme.border, 0.45 + lit * 0.5)}`,
                borderLeft: onRightSide ? undefined : `8px solid ${badgeColor}`,
                borderRight: onRightSide ? `8px solid ${badgeColor}` : undefined,
                boxShadow: `0 14px 36px ${hexToRgba('#000000', theme.isLight ? 0.08 : 0.34)}`,
                padding: compactText ? '18px 28px' : '24px 32px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: compactText ? 8 : 12,
                opacity: op,
                transform: `translate3d(${tx.toFixed(1)}px, 0, 0)`,
              }}
            >
              <FitText
                text={item.title}
                baseSize={compactText ? 34 : 38}
                minSize={24}
                maxLines={2}
                color={theme.fg}
                fontWeight={800}
                fontFamily={theme.fontFamily}
                align={onRightSide ? 'right' : 'left'}
                lineHeight={1.3}
              />
              {item.detail ? (
                <FitText
                  text={item.detail}
                  baseSize={compactText ? 25 : 28}
                  minSize={20}
                  maxLines={2}
                  color={theme.muted}
                  fontWeight={500}
                  fontFamily={theme.fontFamily}
                  align={onRightSide ? 'right' : 'left'}
                  lineHeight={1.38}
                />
              ) : null}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};

// ============================================================================
// 3. DATA-VERSUS: Diagonal Split + Sliding Sides + Central VS + Winner Glow
// ============================================================================

function normalizeCompare(scene: StudioScene): {
  leftTitle: string;
  leftItems: string[];
  rightTitle: string;
  rightItems: string[];
  winner: 'left' | 'right';
} {
  if (scene.compare) {
    const c = scene.compare;
    const t = sceneTexts(scene);
    return {
      leftTitle: String(c.leftTitle || c.leftLabel || 'แบบเดิม').trim(),
      leftItems:
        Array.isArray(c.leftItems) && c.leftItems.length > 0
          ? c.leftItems.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4)
          : [t.subtitle || 'ข้อจำกัดเดิม'],
      rightTitle: String(c.rightTitle || c.rightLabel || 'แบบใหม่').trim(),
      rightItems:
        Array.isArray(c.rightItems) && c.rightItems.length > 0
          ? c.rightItems.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4)
          : [t.title || 'ทางเลือกที่ดีกว่า'],
      winner: c.winner === 'left' ? 'left' : 'right',
    };
  }
  const t = sceneTexts(scene);
  const mid = Math.ceil(t.bullets.length / 2);
  const left = t.bullets.slice(0, mid);
  const right = t.bullets.slice(mid);
  return {
    leftTitle: 'แบบเดิม',
    leftItems: left.length > 0 ? left : ['ต้องทำเองทุกขั้นตอน', 'เสี่ยงพลาดจากอารมณ์'],
    rightTitle: 'แบบใหม่',
    rightItems: right.length > 0 ? right : [t.subtitle || 'ทำงานเป็นระบบอัตโนมัติ', 'แม่นยำและสม่ำเสมอ'],
    winner: 'right',
  };
}

const DataVersusShot: React.FC<StyleShotArgs> = (props) => {
  const { scene, sceneIndex, localFrame, fps, tokens } = props;
  const variant = getVariant(props);
  const stackedDiagonal = variant % 2 === 1;
  const theme = resolveShotTheme(tokens);
  const cmp = normalizeCompare(scene);
  const uid = `ds-vs-${sceneIndex}-${variant}`;

  const rightWins = cmp.winner !== 'left';

  const leftSp = spring({
    frame: Math.max(0, localFrame - 3),
    fps,
    config: { damping: 14, stiffness: 155, mass: 0.85 },
  });
  const rightSp = spring({
    frame: Math.max(0, localFrame - 8),
    fps,
    config: { damping: 14, stiffness: 155, mass: 0.85 },
  });
  const vsSp = spring({
    frame: Math.max(0, localFrame - 12),
    fps,
    config: { damping: 11, stiffness: 210, mass: 0.7 },
  });
  const slashT = easeOutCubic(clamp01((localFrame - 2) / 16));
  const glowPulse = 0.72 + 0.28 * Math.sin(localFrame * 0.14);

  const renderItemRow = (txt: string, i: number, isWinner: boolean, baseDelay: number, compact: boolean) => {
    const it = appear(localFrame, baseDelay + i * 6, 12);
    return (
      <div
        key={i}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
          opacity: it,
          transform: `translate3d(0, ${((1 - it) * 14).toFixed(1)}px, 0)`,
        }}
      >
        <svg width={28} height={28} viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 6 }}>
          {isWinner ? (
            <>
              <circle cx={12} cy={12} r={11} fill={hexToRgba(theme.accent, 0.22)} />
              <path
                d="M7.2 12.2l3.2 3.2 6.4-6.6"
                fill="none"
                stroke={theme.accent}
                strokeWidth={2.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          ) : (
            <>
              <circle cx={12} cy={12} r={11} fill={hexToRgba(theme.muted, 0.2)} />
              <path
                d="M8.5 8.5l7 7M15.5 8.5l-7 7"
                fill="none"
                stroke={theme.muted}
                strokeWidth={2.4}
                strokeLinecap="round"
              />
            </>
          )}
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FitText
            text={txt}
            baseSize={compact ? 27 : 30}
            minSize={20}
            maxLines={3}
            color={isWinner ? theme.fg : theme.muted}
            fontWeight={isWinner ? 700 : 500}
            fontFamily={theme.fontFamily}
            align="left"
            lineHeight={1.38}
          />
        </div>
      </div>
    );
  };

  const renderPanel = (
    title: string,
    items: string[],
    isWinner: boolean,
    sp: number,
    fromX: number,
    boxStyle: React.CSSProperties,
    compact: boolean,
  ) => {
    const tx = interpolate(sp, [0, 1], [fromX, 0]);
    const op = clamp01(sp * 1.45);
    return (
      <div
        style={{
          position: 'absolute',
          ...boxStyle,
          borderRadius: theme.cardRadius + 4,
          backgroundColor: isWinner
            ? hexToRgba(theme.cardBg, theme.isLight ? 0.97 : 0.92)
            : hexToRgba(theme.cardBg, theme.isLight ? 0.86 : 0.68),
          border: isWinner
            ? `3px solid ${theme.accent}`
            : `2px solid ${hexToRgba(theme.border, 0.75)}`,
          boxShadow: isWinner
            ? `0 0 ${Math.round(32 + glowPulse * 26)}px ${hexToRgba(theme.accent, theme.isLight ? 0.24 : 0.32)}, 0 22px 48px ${hexToRgba('#000000', theme.isLight ? 0.12 : 0.48)}`
            : `0 14px 32px ${hexToRgba('#000000', theme.isLight ? 0.07 : 0.3)}`,
          padding: compact ? '26px 26px' : '30px 32px',
          display: 'flex',
          flexDirection: 'column',
          gap: compact ? 18 : 20,
          opacity: op,
          transform: `translate3d(${tx.toFixed(1)}px, 0, 0)`,
          zIndex: isWinner ? 6 : 5,
        }}
      >
        {/* Header strip */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 18px',
            borderRadius: Math.max(10, theme.cardRadius - 8),
            backgroundColor: isWinner ? theme.accent : hexToRgba(theme.muted, 0.18),
          }}
        >
          <div style={{ flex: 1 }}>
            <FitText
              text={title}
              baseSize={compact ? 30 : 34}
              minSize={22}
              maxLines={2}
              color={isWinner ? theme.accentOnFill : theme.fg}
              fontWeight={800}
              fontFamily={theme.fontFamily}
              align="center"
              lineHeight={1.28}
            />
          </div>
          {isWinner ? (
            <StudioVectorIcon name="star" size={26} color={theme.accentOnFill} secondary={theme.accentOnFill} />
          ) : null}
        </div>

        {/* Items */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 16 : 18 }}>
          {items.map((txt, i) => renderItemRow(txt, i, isWinner, isWinner ? 14 : 10, compact))}
        </div>
      </div>
    );
  };

  // Diagonal split SVG coordinates
  const slashX1 = stackedDiagonal ? 0 : 620;
  const slashY1 = stackedDiagonal ? 980 : 0;
  const slashX2 = stackedDiagonal ? STAGE_W : 460;
  const slashY2 = stackedDiagonal ? 860 : STAGE_H;

  const vsCx = STAGE_W / 2;
  const vsCy = stackedDiagonal ? 920 : 905;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <ShotBackdrop theme={theme} localFrame={localFrame} fps={fps} sceneIndex={sceneIndex} variant={variant} diagonalSplit />

      {/* Full-frame Diagonal Split Atmosphere */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0, zIndex: 2 }}
      >
        <defs>
          <linearGradient id={`${uid}-win-bg`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={theme.accent} stopOpacity={theme.isLight ? 0.13 : 0.18} />
            <stop offset="100%" stopColor={theme.accent2} stopOpacity={theme.isLight ? 0.04 : 0.07} />
          </linearGradient>
        </defs>

        {/* Winner half subtle luminous tint */}
        {!stackedDiagonal ? (
          <polygon
            points={
              rightWins
                ? `${slashX1},0 ${STAGE_W},0 ${STAGE_W},${STAGE_H} ${slashX2},${STAGE_H}`
                : `0,0 ${slashX1},0 ${slashX2},${STAGE_H} 0,${STAGE_H}`
            }
            fill={`url(#${uid}-win-bg)`}
            opacity={0.7 + 0.3 * glowPulse}
          />
        ) : (
          <polygon
            points={
              rightWins
                ? `0,${slashY1} ${STAGE_W},${slashY2} ${STAGE_W},${STAGE_H} 0,${STAGE_H}`
                : `0,0 ${STAGE_W},0 ${STAGE_W},${slashY2} 0,${slashY1}`
            }
            fill={`url(#${uid}-win-bg)`}
            opacity={0.7 + 0.3 * glowPulse}
          />
        )}

        {/* Animated Diagonal Energy Seam */}
        <line
          x1={slashX1}
          y1={slashY1}
          x2={slashX1 + (slashX2 - slashX1) * slashT}
          y2={slashY1 + (slashY2 - slashY1) * slashT}
          stroke={theme.accent}
          strokeWidth={14}
          opacity={0.18}
        />
        <line
          x1={slashX1}
          y1={slashY1}
          x2={slashX1 + (slashX2 - slashX1) * slashT}
          y2={slashY1 + (slashY2 - slashY1) * slashT}
          stroke={theme.accent}
          strokeWidth={3.2}
          strokeDasharray="16 10"
          opacity={0.78}
        />
      </svg>

      <ShotHeader scene={scene} theme={theme} localFrame={localFrame} align="center" defaultIcon="bolt" />

      {!stackedDiagonal ? (
        <>
          {renderPanel(
            cmp.leftTitle,
            cmp.leftItems,
            !rightWins,
            leftSp,
            -180,
            { top: 410, left: 44, width: 472, minHeight: 880, maxHeight: 1060, overflow: 'hidden' },
            true,
          )}
          {renderPanel(
            cmp.rightTitle,
            cmp.rightItems,
            rightWins,
            rightSp,
            180,
            { top: 382, right: 44, width: 472, minHeight: 908, maxHeight: 1088, overflow: 'hidden' },
            true,
          )}
        </>
      ) : (
        <>
          {renderPanel(
            cmp.leftTitle,
            cmp.leftItems,
            !rightWins,
            leftSp,
            -200,
            { top: 356, left: 64, right: 92, height: 496, overflow: 'hidden' },
            false,
          )}
          {renderPanel(
            cmp.rightTitle,
            cmp.rightItems,
            rightWins,
            rightSp,
            200,
            { top: 984, left: 92, right: 64, height: 492, overflow: 'hidden' },
            false,
          )}
        </>
      )}

      {/* Central Animated VS Medallion */}
      <div
        style={{
          position: 'absolute',
          left: vsCx - 58,
          top: vsCy - 58,
          width: 116,
          height: 116,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `scale(${interpolate(vsSp, [0, 1], [0.2, 1]).toFixed(4)})`,
          opacity: clamp01(vsSp * 1.5),
        }}
      >
        <svg width={116} height={116} viewBox="0 0 116 116" style={{ position: 'absolute', inset: 0 }}>
          <g transform={`rotate(${(localFrame * 1.1).toFixed(1)} 58 58)`}>
            <circle
              cx={58}
              cy={58}
              r={53}
              fill="none"
              stroke={theme.accent}
              strokeWidth={3}
              strokeDasharray="10 8"
              opacity={0.75}
            />
          </g>
          <circle
            cx={58}
            cy={58}
            r={44}
            fill={theme.accent}
            stroke={theme.bg}
            strokeWidth={6}
          />
        </svg>
        <span
          style={{
            position: 'relative',
            zIndex: 2,
            fontFamily: theme.fontFamily,
            fontSize: 34,
            fontWeight: 900,
            letterSpacing: 1.5,
            color: theme.accentOnFill,
          }}
        >
          VS
        </span>
      </div>
    </div>
  );
};

// ============================================================================
// 4. DATA-LIST: Isometric / Cascading Stack Cards + Giant Index Numbers
// ============================================================================

function normalizeListItems(scene: StudioScene): Array<{ head?: string; body: string }> {
  const t = sceneTexts(scene);
  const raw =
    Array.isArray(scene.bullets) && scene.bullets.length > 0
      ? scene.bullets
      : t.bullets.length > 0
        ? t.bullets
        : [t.subtitle || t.title || 'ประเด็นสำคัญ'];

  return raw
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((text) => {
      const colonIdx = text.indexOf(':');
      if (colonIdx > 1 && colonIdx < 38 && colonIdx < text.length - 4) {
        return {
          head: text.slice(0, colonIdx).trim(),
          body: text.slice(colonIdx + 1).trim(),
        };
      }
      return { body: text };
    });
}

const DataListShot: React.FC<StyleShotArgs> = (props) => {
  const { scene, sceneIndex, localFrame, fps, tokens } = props;
  const variant = getVariant(props);
  const cascadeMode = variant % 2 === 1;
  const theme = resolveShotTheme(tokens);
  const items = normalizeListItems(scene);

  const count = items.length;
  const stageTop = 352;
  const stageBottom = 1474;
  const availH = stageBottom - stageTop;
  const gap = count >= 4 ? 26 : 34;
  const cardH = Math.min(278, Math.floor((availH - (count - 1) * gap) / Math.max(1, count)));
  const totalH = count * cardH + (count - 1) * gap;
  const startY = stageTop + Math.max(0, Math.floor((availH - totalH) / 2));

  const slabEdge = theme.isLight ? shadeHex(theme.border, 0.88) : shadeHex(theme.cardBg, 0.65);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <ShotBackdrop theme={theme} localFrame={localFrame} fps={fps} sceneIndex={sceneIndex} variant={variant} />
      <ShotHeader
        scene={scene}
        theme={theme}
        localFrame={localFrame}
        align={cascadeMode ? 'left' : 'center'}
        defaultIcon="layers"
        showSubtitle={count <= 3}
      />

      {/* Decorative background isometric depth rails */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}
      >
        {!cascadeMode ? (
          <g opacity={0.22} stroke={theme.accent} strokeWidth={1.6}>
            <line x1={96} y1={350} x2={96} y2={1470} strokeDasharray="8 10" />
            <line x1={984} y1={350} x2={984} y2={1470} strokeDasharray="8 10" />
          </g>
        ) : (
          <g opacity={0.26}>
            <line
              x1={84}
              y1={startY}
              x2={84}
              y2={startY + totalH}
              stroke={theme.accent}
              strokeWidth={4}
              strokeLinecap="round"
            />
          </g>
        )}
      </svg>

      {items.map((item, idx) => {
        const enter = stagger(idx, localFrame, 8, 4, 16);
        const sp = spring({
          frame: Math.max(0, localFrame - (4 + idx * 8)),
          fps,
          config: { damping: 14, stiffness: 160, mass: 0.82 },
        });
        const floatY = Math.sin(localFrame * 0.08 + idx * 1.2 + sceneIndex) * 4;
        const yPos = startY + idx * (cardH + gap);
        const numLabel = String(idx + 1).padStart(2, '0');
        const chipBg = idx % 2 === 0 ? theme.accent : theme.accent2;
        const chipFg = idx % 2 === 0 ? theme.accentOnFill : theme.accent2OnFill;

        // Variant 0: Isometric floating slab deck with 3D extrusion bevel
        // Variant 1: Alternating stepped ribbon stack
        const cardLeft = !cascadeMode
          ? 74 + idx * 14
          : idx % 2 === 0
            ? 112
            : 162;
        const cardWidth = !cascadeMode ? 912 - idx * 14 : 848;
        const riseY = interpolate(sp, [0, 1], [68, 0]);
        const tiltDeg = !cascadeMode ? interpolate(sp, [0, 1], [-4.5, -1.2]) : 0;

        return (
          <div
            key={idx}
            style={{
              position: 'absolute',
              left: cardLeft,
              top: yPos,
              width: cardWidth,
              height: cardH,
              zIndex: 5 + idx,
              opacity: clamp01(enter * 1.25),
              transform: `translate3d(0, ${(riseY + floatY).toFixed(1)}px, 0) skewY(${tiltDeg.toFixed(2)}deg)`,
            }}
          >
            {/* Isometric extruded 3D underside slab */}
            {!cascadeMode && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  transform: 'translate3d(12px, 14px, 0)',
                  borderRadius: theme.cardRadius,
                  backgroundColor: slabEdge,
                  border: `1.5px solid ${hexToRgba(theme.accent, 0.35)}`,
                }}
              />
            )}

            {/* Main Card Surface */}
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                borderRadius: theme.cardRadius,
                backgroundColor: hexToRgba(theme.cardBg, theme.isLight ? 0.96 : 0.9),
                border: `2.2px solid ${hexToRgba(idx === 0 ? theme.accent : theme.border, 0.85)}`,
                borderLeft: `10px solid ${chipBg}`,
                boxShadow: `0 16px 36px ${hexToRgba('#000000', theme.isLight ? 0.1 : 0.4)}`,
                padding: count >= 4 ? '18px 28px' : '24px 32px',
                display: 'flex',
                alignItems: 'center',
                gap: 26,
                overflow: 'hidden',
              }}
            >
              {/* Giant subtle watermark numeral in background */}
              <div
                style={{
                  position: 'absolute',
                  right: 22,
                  bottom: -18,
                  fontFamily: theme.fontFamily,
                  fontSize: count >= 4 ? 128 : 156,
                  fontWeight: 900,
                  color: hexToRgba(theme.accent, theme.isLight ? 0.08 : 0.07),
                  lineHeight: 1,
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}
              >
                {numLabel}
              </div>

              {/* Bold Foreground Index Block */}
              <div
                style={{
                  width: count >= 4 ? 84 : 96,
                  height: count >= 4 ? 84 : 96,
                  borderRadius: Math.max(14, theme.cardRadius - 4),
                  backgroundColor: chipBg,
                  color: chipFg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: theme.fontFamily,
                  fontSize: count >= 4 ? 38 : 44,
                  fontWeight: 900,
                  flexShrink: 0,
                  boxShadow: `0 10px 24px ${hexToRgba(chipBg, 0.3)}`,
                }}
              >
                {numLabel}
              </div>

              {/* Card Text */}
              <div
                style={{
                  position: 'relative',
                  zIndex: 2,
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {item.head ? (
                  <>
                    <FitText
                      text={item.head}
                      baseSize={count >= 4 ? 32 : 36}
                      minSize={24}
                      maxLines={1}
                      color={theme.accent}
                      fontWeight={800}
                      fontFamily={theme.fontFamily}
                      align="left"
                      lineHeight={1.25}
                    />
                    <FitText
                      text={item.body}
                      baseSize={count >= 4 ? 26 : 30}
                      minSize={21}
                      maxLines={2}
                      color={theme.fg}
                      fontWeight={600}
                      fontFamily={theme.fontFamily}
                      align="left"
                      lineHeight={1.38}
                    />
                  </>
                ) : (
                  <FitText
                    text={item.body}
                    baseSize={count >= 4 ? 30 : 35}
                    minSize={22}
                    maxLines={3}
                    color={theme.fg}
                    fontWeight={700}
                    fontFamily={theme.fontFamily}
                    align="left"
                    lineHeight={1.38}
                  />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ============================================================================
// 5. DATA-QUOTE: Giant Quote Marks + Thai Word-by-Word Reveal + Highlight Underline
// ============================================================================

function computeHighlightFlags(words: string[], scene: StudioScene): boolean[] {
  const flags = words.map(() => false);
  const fullText = words.join('');
  const rawHighlights: string[] = [];

  if (Array.isArray(scene.highlight)) {
    for (const h of scene.highlight) {
      const s = String(h || '').trim();
      if (s) rawHighlights.push(s);
    }
  } else if (typeof scene.highlight === 'string' && scene.highlight.trim()) {
    rawHighlights.push(scene.highlight.trim());
  }
  const extraHw = (scene as StudioScene & { highlightWord?: string }).highlightWord;
  if (typeof extraHw === 'string' && extraHw.trim() && !rawHighlights.includes(extraHw.trim())) {
    rawHighlights.push(extraHw.trim());
  }

  // Build character start/end ranges for every segmented word
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const w of words) {
    ranges.push({ start: cursor, end: cursor + w.length });
    cursor += w.length;
  }

  let matchedAny = false;
  const fullLower = fullText.toLowerCase();

  for (const phrase of rawHighlights) {
    const target = phrase.toLowerCase();
    let from = 0;
    while (from < fullLower.length) {
      const idx = fullLower.indexOf(target, from);
      if (idx === -1) break;
      const end = idx + target.length;
      for (let i = 0; i < ranges.length; i++) {
        if (ranges[i].end > idx && ranges[i].start < end && words[i].trim().length > 0) {
          flags[i] = true;
          matchedAny = true;
        }
      }
      from = end;
    }
  }

  // If verbatim highlight wasn't in quote text, match meaningful sub-words of highlight
  if (!matchedAny && rawHighlights.length > 0) {
    const subWords = rawHighlights
      .flatMap((h) => segmentThaiWords(h))
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length >= 3);
    for (let i = 0; i < words.length; i++) {
      const wl = words[i].trim().toLowerCase();
      if (wl.length >= 3 && subWords.some((sw) => wl.includes(sw) || sw.includes(wl))) {
        flags[i] = true;
        matchedAny = true;
      }
    }
  }

  // Final graceful fallback: underline the closing punchline words (last 3 non-space words)
  if (!matchedAny) {
    let remaining = 3;
    for (let i = words.length - 1; i >= 0 && remaining > 0; i--) {
      if (words[i].trim().length > 0) {
        flags[i] = true;
        remaining--;
      }
    }
  }

  return flags;
}

const DataQuoteShot: React.FC<StyleShotArgs> = (props) => {
  const { scene, sceneIndex, localFrame, durationFrames, fps, tokens } = props;
  const variant = getVariant(props);
  const editorialLeft = variant % 2 === 1;
  const theme = resolveShotTheme(tokens);
  const t = sceneTexts(scene);

  const quoteText = String(scene.quote?.text || t.subtitle || scene.narration || t.title || 'ความคิดเปลี่ยน ชีวิตเปลี่ยน').trim();
  const author = String(scene.quote?.author || scene.source || '').trim();
  const role = String(scene.quote?.role || scene.quote?.source || '').trim();

  const words = segmentThaiWords(quoteText);
  const hlFlags = computeHighlightFlags(words, scene);
  const nonSpaceCount = Math.max(1, words.filter((w) => w.trim().length > 0).length);

  // Reveal words briskly across first ~52% of scene duration
  const revealSpan = Math.max(24, Math.min(72, Math.round(durationFrames * 0.52)));
  const stepPerWord = revealSpan / nonSpaceCount;

  const quoteFontSize =
    quoteText.length > 105 ? 42 : quoteText.length > 72 ? 48 : quoteText.length > 42 ? 56 : 64;

  const markFloat = Math.sin(localFrame * 0.08 + sceneIndex) * 8;
  const cardEnter = appear(localFrame, 2, 16);
  const authorEnter = appear(localFrame, Math.min(durationFrames - 18, Math.round(12 + revealSpan * 0.65)), 16);
  const dividerW = Math.round(180 * easeOutCubic(clamp01((localFrame - 10) / 26)));

  let nonSpaceCursor = 0;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <ShotBackdrop theme={theme} localFrame={localFrame} fps={fps} sceneIndex={sceneIndex} variant={variant} />
      <ShotHeader
        scene={scene}
        theme={theme}
        localFrame={localFrame}
        align={editorialLeft ? 'left' : 'center'}
        defaultIcon="spark"
      />

      {/* Giant Sculptural Quotation Marks */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none' }}
      >
        {/* Opening giant quote glyph */}
        <g
          transform={`translate(${editorialLeft ? 730 : 62}, ${(editorialLeft ? 375 : 395) + markFloat}) scale(3.2)`}
          opacity={theme.isLight ? 0.14 : 0.16}
        >
          <path
            d="M15.4 54C6.8 54 0 47.2 0 38.2 0 23.6 10.6 9.8 25.4 0l5.6 8.2C22 14.4 16.8 20.6 15.8 27.6c8.4 1.2 14.4 7 14.4 14.6C30.2 49 23.6 54 15.4 54zm37.2 0C44 54 37.2 47.2 37.2 38.2 37.2 23.6 47.8 9.8 62.6 0l5.4 8.2c-9 6.2-14.2 12.4-15.2 19.4 8.4 1.2 14.4 7 14.4 14.6 0 6.8-6.6 11.8-14.6 11.8z"
            fill={editorialLeft ? 'none' : theme.accent}
            stroke={theme.accent}
            strokeWidth={editorialLeft ? 2.2 : 0}
          />
        </g>

        {/* Closing giant quote glyph */}
        <g
          transform={`translate(${editorialLeft ? 830 : 815}, ${(editorialLeft ? 1310 : 1265) - markFloat}) scale(2.8) rotate(180 34 27)`}
          opacity={theme.isLight ? 0.12 : 0.14}
        >
          <path
            d="M15.4 54C6.8 54 0 47.2 0 38.2 0 23.6 10.6 9.8 25.4 0l5.6 8.2C22 14.4 16.8 20.6 15.8 27.6c8.4 1.2 14.4 7 14.4 14.6C30.2 49 23.6 54 15.4 54zm37.2 0C44 54 37.2 47.2 37.2 38.2 37.2 23.6 47.8 9.8 62.6 0l5.4 8.2c-9 6.2-14.2 12.4-15.2 19.4 8.4 1.2 14.4 7 14.4 14.6 0 6.8-6.6 11.8-14.6 11.8z"
            fill={theme.accent2}
          />
        </g>
      </svg>

      {/* Main Quote Stage Container (strictly above SAFE_BOTTOM) */}
      <div
        style={{
          position: 'absolute',
          top: 390,
          left: 68,
          right: 68,
          height: 1055,
          zIndex: 6,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: editorialLeft ? 'stretch' : 'center',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            padding: editorialLeft ? '54px 52px 54px 62px' : '64px 54px',
            borderRadius: theme.cardRadius + 8,
            backgroundColor: hexToRgba(theme.cardBg, theme.isLight ? 0.94 : 0.84),
            border: `2.2px solid ${hexToRgba(theme.accent, 0.36)}`,
            borderLeft: editorialLeft ? `12px solid ${theme.accent}` : `2.2px solid ${hexToRgba(theme.accent, 0.36)}`,
            boxShadow: `0 24px 60px ${hexToRgba('#000000', theme.isLight ? 0.1 : 0.44)}`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: editorialLeft ? 'flex-start' : 'center',
            gap: 34,
            opacity: 0.25 + cardEnter * 0.75,
            transform: `translate3d(0, ${((1 - cardEnter) * 24).toFixed(1)}px, 0)`,
          }}
        >
          {/* Accent quote badge icon */}
          <svg width={64} height={50} viewBox="0 0 68 54">
            <path
              d="M15.4 54C6.8 54 0 47.2 0 38.2 0 23.6 10.6 9.8 25.4 0l5.6 8.2C22 14.4 16.8 20.6 15.8 27.6c8.4 1.2 14.4 7 14.4 14.6C30.2 49 23.6 54 15.4 54zm37.2 0C44 54 37.2 47.2 37.2 38.2 37.2 23.6 47.8 9.8 62.6 0l5.4 8.2c-9 6.2-14.2 12.4-15.2 19.4 8.4 1.2 14.4 7 14.4 14.6 0 6.8-6.6 11.8-14.6 11.8z"
              fill={theme.accent}
            />
          </svg>

          {/* Word-by-word Thai-safe animated quote text */}
          <div
            style={{
              width: '100%',
              fontFamily: theme.fontFamily,
              fontSize: quoteFontSize,
              fontWeight: 800,
              lineHeight: 1.56,
              color: theme.fg,
              textAlign: editorialLeft ? 'left' : 'center',
              wordBreak: 'keep-all',
              overflowWrap: 'break-word',
              paddingTop: 10,
              paddingBottom: 10,
            }}
          >
            {words.map((w, idx) => {
              if (/^\s+$/.test(w)) {
                return <React.Fragment key={idx}>{w}</React.Fragment>;
              }
              const myOrder = nonSpaceCursor++;
              const wDelay = 6 + myOrder * stepPerWord;
              const wProg = appear(localFrame, wDelay, 9);
              const isHl = hlFlags[idx];
              const ulProg = isHl ? appear(localFrame, wDelay + 4, 12) : 0;
              const sep = idx > 0 && !/^\s+$/.test(words[idx - 1]) ? '\u200B' : null;

              return (
                <React.Fragment key={idx}>
                  {sep}
                  <span
                    style={{
                      position: 'relative',
                      display: 'inline-block',
                      whiteSpace: w.length <= 22 ? 'nowrap' : 'normal',
                      opacity: wProg,
                      transform: `translate3d(0, ${((1 - wProg) * 14).toFixed(1)}px, 0)`,
                      color: isHl ? theme.accent : theme.fg,
                      paddingBottom: 4,
                    }}
                  >
                    {w}
                    {isHl ? (
                      <span
                        style={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          bottom: 2,
                          height: 7,
                          borderRadius: 99,
                          backgroundColor: theme.accent,
                          opacity: 0.78,
                          transformOrigin: 'left center',
                          transform: `scaleX(${ulProg.toFixed(4)})`,
                        }}
                      />
                    ) : null}
                  </span>
                </React.Fragment>
              );
            })}
          </div>

          {/* Animated signature divider */}
          <div
            style={{
              width: dividerW,
              height: 4,
              borderRadius: 99,
              background: `linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent2} 100%)`,
              opacity: 0.85,
            }}
          />

          {/* Attribution Block */}
          {(author || role) && (
            <div
              style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: editorialLeft ? 'flex-end' : 'center',
                gap: 6,
                opacity: authorEnter,
                transform: `translate3d(0, ${((1 - authorEnter) * 14).toFixed(1)}px, 0)`,
              }}
            >
              {author ? (
                <FitText
                  text={`— ${author}`}
                  baseSize={30}
                  minSize={22}
                  maxLines={1}
                  color={theme.accent}
                  fontWeight={800}
                  fontFamily={theme.fontFamily}
                  align={editorialLeft ? 'right' : 'center'}
                />
              ) : null}
              {role ? (
                <FitText
                  text={role}
                  baseSize={23}
                  minSize={18}
                  maxLines={1}
                  color={theme.muted}
                  fontWeight={500}
                  fontFamily={theme.fontFamily}
                  align={editorialLeft ? 'right' : 'center'}
                />
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 6. DATA-CHART: Animated Bar / Line-Area Chart + Axes + Peak Highlight
// ============================================================================

interface ChartDatum {
  rawVal: number;
  scaledVal: number;
  display: string;
  label: string;
}

function parseMagnitudeNumber(token: string): number | null {
  const m = /(-?[0-9][0-9,]*(?:\.[0-9]+)?)/.exec(token);
  if (!m) return null;
  const base = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;
  const lower = token.toLowerCase();
  let mult = 1;
  if (lower.includes('ล้าน') || /\bm\b/.test(lower)) mult = 1e6;
  else if (lower.includes('แสน')) mult = 1e5;
  else if (lower.includes('หมื่น')) mult = 1e4;
  else if (lower.includes('พัน') || /\bk\b/.test(lower)) mult = 1e3;
  else if (/\bb\b/.test(lower)) mult = 1e9;
  return Math.abs(base * mult);
}

function buildChartSeries(scene: StudioScene, sceneIndex: number, variant: number): ChartDatum[] {
  const t = sceneTexts(scene);
  const meaningful = extractMeaningfulNumbers(scene);
  const parsed: Array<{ val: number; display: string }> = [];

  for (const tok of meaningful.slice(0, 6)) {
    const val = parseMagnitudeNumber(tok);
    if (val !== null && val > 0) {
      parsed.push({ val, display: tok });
    }
  }

  let points: Array<{ val: number; display: string; label: string }> = [];

  if (parsed.length >= 3) {
    points = parsed.slice(0, 5).map((p, i) => ({
      val: p.val,
      display: p.display,
      label: `จุดที่ ${i + 1}`,
    }));
  } else if (parsed.length > 0) {
    // Build a deterministic 5-point upward trajectory culminating at the real scene numbers
    const anchor = parsed[parsed.length - 1];
    const hasPct = anchor.display.includes('%');
    const ratios = [0.26, 0.42, 0.61, 0.81, 1.0];
    points = ratios.map((r, i) => {
      if (i === 4) {
        return { val: anchor.val, display: anchor.display, label: 'เป้าหมาย' };
      }
      const jitter = 0.92 + seeded(sceneIndex * 41 + variant * 19 + i * 7) * 0.16;
      const v = Math.max(1, Math.round(anchor.val * r * jitter));
      const disp = hasPct
        ? `${Math.min(99, v)}%`
        : v >= 1e9
          ? `${(v / 1e9).toFixed(1)}B`
          : v >= 1e6
            ? `${(v / 1e6).toFixed(1)}M`
            : v >= 1e3
              ? `${(v / 1e3).toFixed(0)}K`
              : String(v);
      return { val: v, display: disp, label: `ระยะ ${i + 1}` };
    });
  } else {
    // Pure deterministic upward trend from sceneIndex seed
    const baseLevels = [24, 38, 52, 71, 92];
    points = baseLevels.map((b, i) => {
      const v = Math.round(b + (seeded(sceneIndex * 53 + variant * 23 + i * 11) - 0.3) * 14);
      const clamped = Math.max(14, Math.min(99, v));
      return {
        val: clamped,
        display: `${clamped}%`,
        label: `Q${i + 1}`,
      };
    });
  }

  // Softly compress huge dynamic ranges so all bars remain readable while keeping exact ordering
  const minV = Math.min(...points.map((p) => p.val));
  const maxV = Math.max(...points.map((p) => p.val), 1);
  const useLog = maxV / Math.max(1e-6, minV) > 25;

  const rawScaled = points.map((p) => (useLog ? Math.log10(p.val + 1) : p.val));
  const maxScaled = Math.max(...rawScaled, 1);

  return points.map((p, idx) => ({
    rawVal: p.val,
    scaledVal: clamp01(rawScaled[idx] / maxScaled),
    display: p.display,
    label: p.label,
  }));
}

const DataChartShot: React.FC<StyleShotArgs> = (props) => {
  const { scene, sceneIndex, localFrame, durationFrames, fps, tokens } = props;
  const variant = getVariant(props);
  const lineMode = variant % 2 === 1;
  const theme = resolveShotTheme(tokens);
  const t = sceneTexts(scene);
  const uid = `ds-chart-${sceneIndex}-${variant}`;

  const data = buildChartSeries(scene, sceneIndex, variant);
  let peakIdx = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i].rawVal >= data[peakIdx].rawVal) peakIdx = i;
  }

  const cardTop = 368;
  const cardLeft = 56;
  const cardW = STAGE_W - 112;
  const cardH = 850;

  // Inner SVG chart coordinates
  const chartW = 900;
  const chartH = 660;
  const padL = 78;
  const padR = 46;
  const padT = 112;
  const padB = 96;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;
  const baseY = padT + plotH;

  const axisProg = easeOutCubic(clamp01((localFrame - 2) / 16));
  const lineDrawProg = easeOutCubic(clamp01((localFrame - 8) / Math.max(24, Math.min(46, durationFrames * 0.44))));
  const peakPulse = 0.72 + 0.28 * Math.sin(localFrame * 0.16);
  const footerEnter = appear(localFrame, 18, 16);

  const count = data.length;
  const stepX = plotW / Math.max(1, count);

  const pts = data.map((d, i) => {
    const x = padL + stepX * i + stepX / 2;
    const h = Math.max(36, d.scaledVal * (plotH - 26));
    const y = baseY - h;
    return { x, y, h, datum: d };
  });

  // Polyline & area path for line mode
  const polylinePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath =
    pts.length > 0
      ? `${polylinePath} L ${pts[pts.length - 1].x.toFixed(1)} ${baseY} L ${pts[0].x.toFixed(1)} ${baseY} Z`
      : '';

  let pathLen = 120;
  for (let i = 1; i < pts.length; i++) {
    pathLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }

  const peakPt = pts[peakIdx] || pts[0];
  const captionSummary = t.subtitle || t.bullets[0] || `จุดสูงสุด ${peakPt?.datum.display || ''}`;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <ShotBackdrop theme={theme} localFrame={localFrame} fps={fps} sceneIndex={sceneIndex} variant={variant} />
      <ShotHeader scene={scene} theme={theme} localFrame={localFrame} align="center" defaultIcon="chart" />

      {/* Main Chart Card */}
      <div
        style={{
          position: 'absolute',
          top: cardTop,
          left: cardLeft,
          width: cardW,
          height: cardH,
          zIndex: 5,
          borderRadius: theme.cardRadius + 4,
          backgroundColor: hexToRgba(theme.cardBg, theme.isLight ? 0.96 : 0.88),
          border: `2.2px solid ${hexToRgba(theme.border, 0.85)}`,
          boxShadow: `0 22px 54px ${hexToRgba('#000000', theme.isLight ? 0.1 : 0.42)}`,
          padding: '28px 34px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* Top live legend strip */}
        <div
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 4,
                backgroundColor: theme.accent,
              }}
            />
            <span
              style={{
                fontFamily: theme.fontFamily,
                fontSize: 22,
                fontWeight: 700,
                color: theme.muted,
              }}
            >
              {lineMode ? 'แนวโน้มการเติบโต' : 'เปรียบเทียบค่าข้อมูล'}
            </span>
          </div>

          {peakPt ? (
            <div
              style={{
                padding: '6px 18px',
                borderRadius: 999,
                backgroundColor: hexToRgba(theme.accent, theme.isLight ? 0.14 : 0.2),
                border: `1.5px solid ${hexToRgba(theme.accent, 0.55)}`,
                fontFamily: theme.fontFamily,
                fontSize: 21,
                fontWeight: 800,
                color: theme.accent,
              }}
            >
              สูงสุด: {peakPt.datum.display}
            </div>
          ) : null}
        </div>

        {/* SVG Chart */}
        <svg width={chartW} height={chartH} viewBox={`0 0 ${chartW} ${chartH}`} style={{ overflow: 'visible' }}>
          <defs>
            <linearGradient id={`${uid}-bar-peak`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={theme.accent} />
              <stop offset="100%" stopColor={theme.accent2} stopOpacity="0.72" />
            </linearGradient>
            <linearGradient id={`${uid}-bar-std`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={theme.accent2} stopOpacity="0.65" />
              <stop offset="100%" stopColor={theme.border} stopOpacity="0.35" />
            </linearGradient>
            <linearGradient id={`${uid}-area`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={theme.accent} stopOpacity={theme.isLight ? 0.28 : 0.34} />
              <stop offset="100%" stopColor={theme.accent} stopOpacity="0.02" />
            </linearGradient>
            <clipPath id={`${uid}-clip`}>
              <rect x={padL - 20} y={0} width={(plotW + 40) * lineDrawProg} height={chartH} />
            </clipPath>
          </defs>

          {/* Horizontal Gridlines & Y Ticks */}
          {[0, 0.25, 0.5, 0.75, 1].map((g, gi) => {
            const gy = baseY - g * (plotH - 26);
            return (
              <g key={gi} opacity={axisProg * 0.75}>
                <line
                  x1={padL}
                  y1={gy}
                  x2={padL + plotW}
                  y2={gy}
                  stroke={theme.border}
                  strokeWidth={g === 0 ? 2.6 : 1.4}
                  strokeDasharray={g === 0 ? undefined : '8 8'}
                />
                <text
                  x={padL - 16}
                  y={gy + 7}
                  textAnchor="end"
                  fill={theme.muted}
                  fontSize={18}
                  fontWeight={700}
                  fontFamily={theme.fontFamily}
                >
                  {Math.round(g * 100)}
                </text>
              </g>
            );
          })}

          {/* Animated Y & X Axes */}
          <line
            x1={padL}
            y1={baseY}
            x2={padL}
            y2={baseY - plotH * axisProg}
            stroke={theme.muted}
            strokeWidth={3}
            strokeLinecap="round"
          />
          <line
            x1={padL}
            y1={baseY}
            x2={padL + plotW * axisProg}
            y2={baseY}
            stroke={theme.muted}
            strokeWidth={3}
            strokeLinecap="round"
          />

          {!lineMode ? (
            /* Variant 0: Animated Vertical Bar Chart + Subtle Trendline */
            <g>
              {pts.map((p, idx) => {
                const barProg = stagger(idx, localFrame, 6, 8, 22);
                const isPeak = idx === peakIdx;
                const barW = Math.min(96, stepX * 0.58);
                const curH = p.h * barProg;
                const curY = baseY - curH;

                return (
                  <g key={idx}>
                    {isPeak && barProg > 0.6 && (
                      <rect
                        x={p.x - barW / 2 - 8}
                        y={curY - 8}
                        width={barW + 16}
                        height={curH + 8}
                        rx={18}
                        fill={theme.accent}
                        opacity={0.14 * peakPulse}
                      />
                    )}
                    <rect
                      x={p.x - barW / 2}
                      y={curY}
                      width={barW}
                      height={Math.max(4, curH)}
                      rx={14}
                      fill={isPeak ? `url(#${uid}-bar-peak)` : `url(#${uid}-bar-std)`}
                      stroke={isPeak ? theme.accent : hexToRgba(theme.border, 0.7)}
                      strokeWidth={isPeak ? 2.5 : 1.2}
                    />

                    {/* Value Label above bar */}
                    <g opacity={clamp01((barProg - 0.35) * 1.8)}>
                      {isPeak ? (
                        (() => {
                          const pillW = Math.max(112, Math.min(210, p.datum.display.length * 16 + 34));
                          return (
                            <rect
                              x={p.x - pillW / 2}
                              y={curY - 56}
                              width={pillW}
                              height={38}
                              rx={19}
                              fill={theme.accent}
                            />
                          );
                        })()
                      ) : null}
                      <text
                        x={p.x}
                        y={curY - (isPeak ? 30 : 18)}
                        textAnchor="middle"
                        fill={isPeak ? theme.accentOnFill : theme.fg}
                        fontSize={isPeak ? 23 : 22}
                        fontWeight={800}
                        fontFamily={theme.fontFamily}
                      >
                        {p.datum.display}
                      </text>
                    </g>

                    {/* X Axis Label */}
                    <text
                      x={p.x}
                      y={baseY + 42}
                      textAnchor="middle"
                      fill={isPeak ? theme.accent : theme.muted}
                      fontSize={22}
                      fontWeight={isPeak ? 800 : 600}
                      fontFamily={theme.fontFamily}
                    >
                      {p.datum.label}
                    </text>
                  </g>
                );
              })}

              {/* Overlay dashed trend curve */}
              {pts.length >= 2 && (
                <path
                  d={polylinePath}
                  fill="none"
                  stroke={theme.accent}
                  strokeWidth={3.5}
                  strokeDasharray="10 8"
                  opacity={lineDrawProg * 0.55}
                />
              )}
            </g>
          ) : (
            /* Variant 1: Kinetic Area & Line Chart + Peak Callout */
            <g>
              {/* Clipped Area Fill */}
              <g clipPath={`url(#${uid}-clip)`}>
                <path d={areaPath} fill={`url(#${uid}-area)`} />
              </g>

              {/* Main Drawn Line */}
              <path
                d={polylinePath}
                fill="none"
                stroke={theme.accent}
                strokeWidth={7}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={pathLen}
                strokeDashoffset={pathLen * (1 - lineDrawProg)}
              />

              {/* Peak Vertical Drop Line */}
              {peakPt && lineDrawProg > 0.7 && (
                <line
                  x1={peakPt.x}
                  y1={peakPt.y}
                  x2={peakPt.x}
                  y2={baseY}
                  stroke={theme.accent}
                  strokeWidth={2.4}
                  strokeDasharray="6 6"
                  opacity={0.75}
                />
              )}

              {/* Data Nodes & Labels */}
              {pts.map((p, idx) => {
                const nodeProg = stagger(idx, localFrame, 6, 10, 14);
                const isPeak = idx === peakIdx;
                return (
                  <g key={idx}>
                    {isPeak && nodeProg > 0.5 && (
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={26 + peakPulse * 10}
                        fill={theme.accent}
                        opacity={0.22 * peakPulse}
                      />
                    )}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={(isPeak ? 13 : 9) * nodeProg}
                      fill={isPeak ? theme.accent : theme.cardBg}
                      stroke={theme.accent}
                      strokeWidth={4}
                    />
                    <g opacity={nodeProg}>
                      {isPeak ? (
                        (() => {
                          const pillW = Math.max(116, Math.min(214, p.datum.display.length * 16 + 36));
                          return (
                            <rect
                              x={p.x - pillW / 2}
                              y={p.y - 64}
                              width={pillW}
                              height={40}
                              rx={20}
                              fill={theme.accent}
                            />
                          );
                        })()
                      ) : null}
                      <text
                        x={p.x}
                        y={p.y - (isPeak ? 37 : 22)}
                        textAnchor="middle"
                        fill={isPeak ? theme.accentOnFill : theme.fg}
                        fontSize={isPeak ? 23 : 22}
                        fontWeight={800}
                        fontFamily={theme.fontFamily}
                      >
                        {p.datum.display}
                      </text>
                    </g>
                    <text
                      x={p.x}
                      y={baseY + 42}
                      textAnchor="middle"
                      fill={isPeak ? theme.accent : theme.muted}
                      fontSize={22}
                      fontWeight={isPeak ? 800 : 600}
                      fontFamily={theme.fontFamily}
                    >
                      {p.datum.label}
                    </text>
                  </g>
                );
              })}
            </g>
          )}
        </svg>
      </div>

      {/* Bottom Takeaway Strip (above SAFE_BOTTOM = 1540) */}
      <div
        style={{
          position: 'absolute',
          top: cardTop + cardH + 28,
          left: 64,
          right: 64,
          maxHeight: SAFE_BOTTOM - (cardTop + cardH + 44),
          zIndex: 6,
          padding: '22px 30px',
          borderRadius: theme.cardRadius,
          backgroundColor: hexToRgba(theme.cardBg, theme.isLight ? 0.94 : 0.82),
          border: `2px solid ${hexToRgba(theme.accent, 0.36)}`,
          opacity: footerEnter,
          transform: `translate3d(0, ${((1 - footerEnter) * 18).toFixed(1)}px, 0)`,
        }}
      >
        <FitText
          text={captionSummary}
          baseSize={30}
          minSize={22}
          maxLines={2}
          color={theme.fg}
          fontWeight={700}
          fontFamily={theme.fontFamily}
          align="center"
          lineHeight={1.38}
        />
      </div>
    </div>
  );
};

// ============================================================================
// EXPORTED SHOT REGISTRY
// ============================================================================

export const DATA_SHOTS: Record<string, React.FC<StyleShotArgs>> = {
  'data-counter': DataCounterShot,
  'data-steps': DataStepsShot,
  'data-versus': DataVersusShot,
  'data-list': DataListShot,
  'data-quote': DataQuoteShot,
  'data-chart': DataChartShot,
};
