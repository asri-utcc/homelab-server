import React from 'react';
import { interpolate, spring } from 'remotion';
import { THAI_FONT_FAMILY } from '../../components/ThaiFontLoader';
import type { StudioScene } from '../types';
import {
  FitText,
  SAFE_BOTTOM,
  STAGE_H,
  STAGE_W,
  appear,
  clamp01,
  easeOutCubic,
  sceneTexts,
  stagger,
} from './kit';
import type { StyleDirectorDef, StyleShotArgs } from './types';

// ============================================================================
// SHARED HELPERS FOR BATCH J (look-30 Ink Wash, look-32 Headline Highlight)
// Pure, Deterministic, Inline SVG/CSS Only, Zero External Assets
// Safe stage bounds: x ∈ [54, 1026], y ∈ [112, CONTENT_BOTTOM (=1420)]
// ============================================================================

const CONTENT_BOTTOM = SAFE_BOTTOM - 120; // 1420
const SAFE_X = 54;
const SAFE_W = STAGE_W - SAFE_X * 2; // 972
const SAFE_TOP = 112;

const FONT_THAI = THAI_FONT_FAMILY;
const FONT_SERIF = "'Cormorant Garamond', 'Newsreader', Georgia, 'Times New Roman', serif";
const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

// Regex classifiers for intelligent shot inference
const J_INK_CULTURE_RE =
  /(?:ท่องเที่ยว|วัฒนธรรม|อาหาร|ประวัติศาสตร์|ตำนาน|ปรัชญา|ศิลปะ|ธรรมชาติ|ภูเขา|สายน้ำ|หมึก|พู่กัน|ชา|ญี่ปุ่น|จีน|เซน|บทนำ|เรื่องเล่า|เงียบสงบ|ภูมิปัญญา|travel|culture|heritage|zen|ink|nature)/i;
const J_NEWS_EVIDENCE_RE =
  /(?:ข่าว|อ้างอิง|หลักฐาน|พาดหัว|บทความ|รายงาน|เปิดเผย|เอกสาร|สื่อ|ประเด็น|ไฮไลต์|จับตา|ข้อเท็จจริง|ข้อมูลชี้|สรุป|news|report|evidence|headline|article|receipt|source|press)/i;

function hashJ(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function easeInOutCubicJ(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function easeOutQuartJ(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 4);
}

function haystackOfJ(scene: StudioScene): string {
  const t = sceneTexts(scene);
  const hl = Array.isArray(scene.highlight) ? scene.highlight.join(' ') : String(scene.highlight || '');
  return [
    t.badge,
    t.title,
    t.subtitle,
    hl,
    scene.source || '',
    ...t.bullets,
    scene.stat?.label || '',
    scene.stat?.delta || '',
    scene.quote?.text || '',
    scene.quote?.author || '',
    scene.compare?.leftTitle || '',
    scene.compare?.rightTitle || '',
  ].join(' ');
}

function extractPointsJ(scene: StudioScene, max = 4): string[] {
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

function extractStepObjectsJ(
  scene: StudioScene,
  fallbackLabels: string[],
  max = 4,
): Array<{ tag: string; text: string }> {
  const out: Array<{ tag: string; text: string }> = [];
  if (Array.isArray(scene.steps) && scene.steps.length > 0) {
    scene.steps.slice(0, max).forEach((s, idx) => {
      if (typeof s === 'string') {
        out.push({ tag: fallbackLabels[idx] || `ขั้นที่ ${idx + 1}`, text: s.trim() });
      } else if (s?.title) {
        const text = s.detail ? `${s.title} — ${s.detail}` : s.title;
        out.push({ tag: s.step || fallbackLabels[idx] || `ขั้นที่ ${idx + 1}`, text });
      }
    });
  } else {
    const pts = extractPointsJ(scene, max);
    pts.forEach((p, idx) => {
      out.push({ tag: fallbackLabels[idx] || `บทที่ ${idx + 1}`, text: p });
    });
  }
  if (out.length === 0) {
    const t = sceneTexts(scene);
    out.push({ tag: fallbackLabels[0] || 'ขั้นที่ 1', text: t.title || 'เริ่มต้นอย่างมีสมาธิ' });
  }
  return out;
}

function parseNumericJ(raw: string | number | undefined, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw || '').replace(/,/g, '');
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return fallback;
  const val = parseFloat(m[0]);
  return Number.isFinite(val) ? val : fallback;
}

function extractPrimaryMetricJ(
  scene: StudioScene,
  sceneIndex: number,
  defaultNum: number,
  defaultUnit: string,
): {
  big: string;
  prefix: string;
  suffix: string;
  unit: string;
  numeric: number;
  hasDecimal: boolean;
  isPureNumeric: boolean;
  label: string;
  delta: string;
  progress: number;
} {
  const t = sceneTexts(scene);
  if (scene.stat?.value !== undefined && String(scene.stat.value).trim()) {
    const rawVal = String(scene.stat.value).trim();
    const prefix = String(scene.stat.prefix || '').trim();
    const suffix = String(scene.stat.suffix || '').trim();
    const numeric = scene.stat.numericValue ?? parseNumericJ(rawVal, defaultNum);
    const hasDecimal = /\d+\.\d+/.test(rawVal);
    const isPureNumeric = /^[+-]?\d[\d,]*(?:\.\d+)?$/.test(rawVal);
    const effPrefix = prefix && !rawVal.startsWith(prefix) ? prefix : '';
    const effSuffix = suffix && !rawVal.endsWith(suffix) ? suffix : '';
    const big = `${effPrefix}${rawVal}${effSuffix}`.trim();
    const prog =
      typeof scene.stat.progress === 'number' && Number.isFinite(scene.stat.progress)
        ? clamp01(scene.stat.progress / 100)
        : numeric > 0 && numeric <= 100
          ? clamp01(numeric / 100)
          : 0.84;
    return {
      big,
      prefix,
      suffix,
      unit: String(scene.stat.unit || defaultUnit).trim(),
      numeric,
      hasDecimal,
      isPureNumeric,
      label: String(scene.stat.label || t.subtitle || t.title).trim(),
      delta: String(scene.stat.delta || '').trim(),
      progress: prog,
    };
  }
  if (t.numbers.length > 0) {
    const first = t.numbers[0];
    const numeric = parseNumericJ(first, defaultNum);
    const hasDecimal = /\d+\.\d+/.test(first);
    const prog = first.includes('%') ? clamp01(numeric / 100) : clamp01(Math.min(100, Math.max(28, numeric)) / 100);
    return {
      big: first,
      prefix: '',
      suffix: '',
      unit: defaultUnit,
      numeric,
      hasDecimal,
      isPureNumeric: false,
      label: t.subtitle || t.title,
      delta: '',
      progress: prog,
    };
  }
  const seeded = defaultNum + sceneIndex * 4;
  return {
    big: `${seeded}`,
    prefix: '',
    suffix: '',
    unit: defaultUnit,
    numeric: seeded,
    hasDecimal: false,
    isPureNumeric: true,
    label: t.subtitle || t.title,
    delta: '',
    progress: 0.82,
  };
}

function extractComparePairJ(
  scene: StudioScene,
  defaultLeft: string,
  defaultRight: string,
): { leftTitle: string; rightTitle: string; leftItems: string[]; rightItems: string[] } {
  const t = sceneTexts(scene);
  if (scene.compare) {
    const leftItems = (scene.compare.leftItems || []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, 3);
    const rightItems = (scene.compare.rightItems || []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, 3);
    return {
      leftTitle: String(scene.compare.leftTitle || scene.compare.leftLabel || defaultLeft).trim(),
      rightTitle: String(scene.compare.rightTitle || scene.compare.rightLabel || defaultRight).trim(),
      leftItems: leftItems.length > 0 ? leftItems : [t.subtitle || 'มุมมองเดิมก่อนตรวจสอบหลักฐาน'],
      rightItems: rightItems.length > 0 ? rightItems : [t.title || 'ข้อเท็จจริงที่พบจากรายงานล่าสุด'],
    };
  }
  const pts = extractPointsJ(scene, 4);
  if (pts.length >= 2) {
    const half = Math.ceil(pts.length / 2);
    return {
      leftTitle: defaultLeft,
      rightTitle: defaultRight,
      leftItems: pts.slice(0, Math.min(2, half)),
      rightItems: pts.slice(half, half + 2),
    };
  }
  return {
    leftTitle: defaultLeft,
    rightTitle: defaultRight,
    leftItems: [pts[0] || t.subtitle || 'ข้อความคาดการณ์ในระยะแรก'],
    rightItems: [t.title || 'หลักฐานยืนยันในรายงานฉบับล่าสุด'],
  };
}

function splitTitleColumnsJ(title: string): [string, string] {
  const clean = String(title || '').trim();
  if (!clean) return ['วิถีแห่งหมึก', 'บนกระดาษสา'];
  const tokens = clean.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const mid = Math.ceil(tokens.length / 2);
    return [tokens.slice(0, mid).join(' '), tokens.slice(mid).join(' ')];
  }
  // Single Thai continuous phrase without spaces: split at a real Thai word boundary near midpoint
  if (clean.length > 12) {
    const mid = Math.ceil(clean.length / 2);
    try {
      const Seg = (Intl as unknown as { Segmenter?: new (loc: string, opts: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string; index: number }> } }).Segmenter;
      if (Seg) {
        const words = Array.from(new Seg('th', { granularity: 'word' }).segment(clean), (s) => s.segment);
        if (words.length >= 2) {
          let acc = 0;
          let bestIdx = 1;
          let bestDiff = Infinity;
          for (let i = 0; i < words.length - 1; i++) {
            acc += words[i].length;
            const diff = Math.abs(acc - mid);
            if (diff < bestDiff) {
              bestDiff = diff;
              bestIdx = i + 1;
            }
          }
          return [words.slice(0, bestIdx).join(''), words.slice(bestIdx).join('')];
        }
      }
    } catch {
      // Fallback below if Intl.Segmenter is unavailable
    }
    let cut = mid;
    while (cut < clean.length - 2 && /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(clean[cut])) {
      cut += 1;
    }
    return [clean.slice(0, cut), clean.slice(cut)];
  }
  return [clean, ''];
}

function formatAnimatedStatJ(
  metric: ReturnType<typeof extractPrimaryMetricJ>,
  progress: number,
): string {
  if (!metric.isPureNumeric) {
    return metric.big;
  }
  const cur = metric.numeric * clamp01(progress);
  const formatted = metric.hasDecimal
    ? cur.toFixed(1)
    : Math.round(cur).toLocaleString('en-US');
  return `${metric.prefix}${formatted}${metric.suffix}`;
}

function pad2J(n: number): string {
  const c = Math.max(0, Math.min(99, Math.round(n)));
  return c < 10 ? `0${c}` : `${c}`;
}

// ============================================================================
// STYLE 1: look-30 — INK WASH (ภาพหมึกจีน)
// Hardcoded Palette:
//   Rice Paper: #EEEAE0
//   Ink: #1B1A18 (all washes are diluted #1B1A18 via opacity, NEVER separate grey)
//   Vermilion Seal Red: #B8352A (ONLY sun, square seal, and 1–2 tiny accents)
// ============================================================================

const INK_PAPER = '#EEEAE0';
const INK_MAIN = '#1B1A18';
const INK_RED = '#B8352A';

function inkRgba(alpha: number): string {
  return `rgba(27, 26, 24, ${clamp01(alpha).toFixed(3)})`;
}

/** Rice paper surface with procedural paper fibers & gentle grain (always on top or base) */
const InkWashPaperBase: React.FC<{ uid: string }> = ({ uid }) => {
  const fibers = Array.from({ length: 34 }, (_, i) => {
    const x1 = Math.round(hashJ(i * 11 + 3) * STAGE_W);
    const y1 = Math.round(hashJ(i * 17 + 7) * STAGE_H);
    const len = 36 + hashJ(i * 23 + 1) * 95;
    const angle = (hashJ(i * 31 + 5) - 0.5) * Math.PI;
    const x2 = x1 + Math.cos(angle) * len;
    const y2 = y1 + Math.sin(angle) * len;
    const cx = (x1 + x2) / 2 + (hashJ(i * 7 + 9) - 0.5) * 18;
    const cy = (y1 + y2) / 2 + (hashJ(i * 13 + 2) - 0.5) * 18;
    return { d: `M ${x1} ${y1} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`, op: 0.024 + hashJ(i * 5) * 0.026 };
  });

  const specks = Array.from({ length: 48 }, (_, i) => ({
    cx: Math.round(hashJ(i * 19 + 41) * STAGE_W),
    cy: Math.round(hashJ(i * 29 + 13) * STAGE_H),
    r: 0.9 + hashJ(i * 37 + 5) * 1.9,
    op: 0.022 + hashJ(i * 43 + 2) * 0.032,
  }));

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: INK_PAPER,
        backgroundImage: `radial-gradient(ellipse 920px 1120px at 48% 36%, rgba(255,252,244,0.45) 0%, rgba(238,234,224,0) 64%, rgba(27,26,24,0.055) 100%)`,
        overflow: 'hidden',
      }}
    >
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        <defs>
          <pattern id={`ink-grain-${uid}`} width="64" height="64" patternUnits="userSpaceOnUse">
            <circle cx="12" cy="18" r="0.9" fill={INK_MAIN} fillOpacity="0.03" />
            <circle cx="44" cy="11" r="1.1" fill={INK_MAIN} fillOpacity="0.025" />
            <circle cx="29" cy="48" r="0.85" fill={INK_MAIN} fillOpacity="0.032" />
            <circle cx="56" cy="52" r="1.0" fill={INK_MAIN} fillOpacity="0.022" />
            <path d="M 4 36 Q 18 33 32 37" stroke={INK_MAIN} strokeOpacity="0.022" strokeWidth="0.8" fill="none" />
          </pattern>
        </defs>
        <rect width={STAGE_W} height={STAGE_H} fill={`url(#ink-grain-${uid})`} />
        {fibers.map((f, idx) => (
          <path
            key={idx}
            d={f.d}
            stroke={INK_MAIN}
            strokeOpacity={f.op}
            strokeWidth={1.1}
            fill="none"
            strokeLinecap="round"
          />
        ))}
        {specks.map((s, idx) => (
          <circle key={idx} cx={s.cx} cy={s.cy} r={s.r} fill={INK_MAIN} fillOpacity={s.op} />
        ))}
      </svg>
    </div>
  );
};

/** Subtle translucent paper fiber overlay over ink washes so paper texture sits above ink */
const InkPaperGrainVeil: React.FC<{ uid: string }> = ({ uid }) => (
  <svg
    width={STAGE_W}
    height={STAGE_H}
    viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
    style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20 }}
  >
    <defs>
      <pattern id={`ink-veil-${uid}`} width="96" height="96" patternUnits="userSpaceOnUse">
        <path d="M 8 24 Q 26 20 42 26" stroke={INK_PAPER} strokeOpacity="0.22" strokeWidth="1.2" fill="none" />
        <path d="M 52 68 Q 70 74 88 66" stroke={INK_MAIN} strokeOpacity="0.024" strokeWidth="0.9" fill="none" />
        <circle cx="72" cy="22" r="1.1" fill={INK_PAPER} fillOpacity="0.18" />
        <circle cx="24" cy="76" r="0.9" fill={INK_MAIN} fillOpacity="0.024" />
      </pattern>
    </defs>
    <rect width={STAGE_W} height={STAGE_H} fill={`url(#ink-veil-${uid})`} />
  </svg>
);

/** Traditional carved vermilion square seal stamp (stamps at 112% tilt and settles) */
const VermilionSealStamp: React.FC<{
  localFrame: number;
  fps: number;
  delay: number;
  size?: number;
  style?: React.CSSProperties;
}> = ({ localFrame, fps, delay, size = 76, style }) => {
  const f = Math.max(0, localFrame - delay);
  const sp = spring({
    frame: f,
    fps,
    config: { damping: 13, stiffness: 210, mass: 0.72 },
  });
  const visible = localFrame >= delay;
  const scale = visible ? interpolate(sp, [0, 0.45, 1], [1.26, 1.12, 1.0]) : 1.26;
  const rotate = visible ? interpolate(sp, [0, 1], [-5.2, -1.6]) : -5.2;
  const opacity = visible ? clamp01(f / 3) : 0;

  return (
    <div
      style={{
        width: size,
        height: size,
        opacity,
        transform: `scale(${scale.toFixed(3)}) rotate(${rotate.toFixed(2)}deg)`,
        transformOrigin: 'center center',
        ...style,
      }}
    >
      <svg width={size} height={size} viewBox="0 0 80 80">
        {/* Slightly organic distressed seal base */}
        <rect
          x="4"
          y="4"
          width="72"
          height="72"
          rx="5"
          fill={INK_RED}
          fillOpacity="0.92"
        />
        {/* Inner carved white/paper frame */}
        <rect
          x="10"
          y="10"
          width="60"
          height="60"
          rx="2"
          fill="none"
          stroke={INK_PAPER}
          strokeWidth="2.6"
          strokeDasharray="116 3 44 2 72 3"
        />
        {/* Stylized carved seal-script calligraphic grid (non-linguistic geometric chop) */}
        <path
          d="M 21 23 H 59 M 40 23 V 59 M 24 34 H 36 V 47 H 24 Z M 45 33 H 57 M 45 43 H 57 M 51 33 V 57 M 22 57 H 38"
          fill="none"
          stroke={INK_PAPER}
          strokeWidth="3.2"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
        {/* Paper-grain distress specks inside seal */}
        <circle cx="17" cy="15" r="1.4" fill={INK_PAPER} fillOpacity="0.55" />
        <circle cx="64" cy="61" r="1.6" fill={INK_PAPER} fillOpacity="0.45" />
        <circle cx="58" cy="18" r="1.1" fill={INK_PAPER} fillOpacity="0.4" />
      </svg>
    </div>
  );
};

/** Vermilion ink sun blooming from center with wet-edge overshoot */
const VermilionInkSun: React.FC<{
  cx: number;
  cy: number;
  r: number;
  localFrame: number;
  fps: number;
  delay: number;
  uid: string;
}> = ({ cx, cy, r, localFrame, fps, delay, uid }) => {
  const sp = spring({
    frame: Math.max(0, localFrame - delay),
    fps,
    config: { damping: 12, stiffness: 115, mass: 1.0 },
  });
  const scale = localFrame < delay ? 0 : interpolate(sp, [0, 0.65, 1], [0.05, 1.1, 1.0]);
  const blotch = 1 + 0.015 * Math.sin(localFrame * 0.045);

  return (
    <g transform={`translate(${cx} ${cy}) scale(${(scale * blotch).toFixed(3)})`}>
      <defs>
        <radialGradient id={`sun-mottle-${uid}`} cx="44%" cy="42%" r="58%">
          <stop offset="0%" stopColor={INK_RED} stopOpacity="0.92" />
          <stop offset="72%" stopColor={INK_RED} stopOpacity="0.86" />
          <stop offset="92%" stopColor={INK_RED} stopOpacity="0.72" />
          <stop offset="100%" stopColor={INK_RED} stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Outer soft wet-ink halo */}
      <circle cx={0} cy={0} r={r * 1.12} fill={`url(#sun-mottle-${uid})`} opacity={0.42} />
      {/* Ragged organic sun disc */}
      <path
        d={`M ${-r} 0 C ${-r} ${-r * 0.62}, ${-r * 0.54} ${-r * 1.02}, 2 ${-r * 0.99} C ${r * 0.58} ${-r * 0.96}, ${r * 1.03} ${-r * 0.56}, ${r * 0.99} 3 C ${r * 0.96} ${r * 0.58}, ${r * 0.54} ${r * 1.02}, -3 ${r * 0.98} C ${-r * 0.58} ${r * 0.95}, ${-r * 1.02} ${r * 0.55}, ${-r} 0 Z`}
        fill={INK_RED}
        fillOpacity="0.88"
      />
      {/* Subtle mottled lighter rice-paper spots inside sun */}
      <circle cx={-r * 0.24} cy={-r * 0.18} r={r * 0.16} fill={INK_PAPER} fillOpacity="0.11" />
      <circle cx={r * 0.28} cy={r * 0.22} r={r * 0.12} fill={INK_PAPER} fillOpacity="0.09" />
    </g>
  );
};

// ----------------------------------------------------------------------------
// look-30 Shot 1: ink-landscape-title
// Self-painting 3-layer ink mountains (stroke-dashoffset + ragged ink spread)
// + dry-brush pine cliff + drifting river boat + red sun + 2-column vertical title + seal
// ----------------------------------------------------------------------------
const Look30InkLandscapeTitle: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const t = sceneTexts(scene);
  const uid = `l30-land-${sceneIndex}`;
  const [colA, colB] = splitTitleColumnsJ(t.title || 'วิถีแห่งหมึกและขุนเขา');

  // Ragged ink spread progression (left -> right for mountains, top -> bottom for cliff)
  const farSpread = easeOutCubic(clamp01((localFrame + 10) / 36));
  const midSpread = easeOutCubic(clamp01((localFrame - 4) / 40));
  const cliffSpread = easeOutCubic(clamp01((localFrame - 12) / 34));
  const pineGrow = easeOutCubic(clamp01((localFrame - 22) / 30));
  const riverGrow = easeOutCubic(clamp01((localFrame - 16) / 36));

  // Calm continuous drift for mist & sampan boat
  const driftPhase = localFrame / Math.max(1, durationFrames);
  const mistShift = Math.sin(localFrame * 0.025) * 18;
  const boatX = interpolate(driftPhase, [0, 1], [160, 420]);
  const boatBob = Math.sin(localFrame * 0.05) * 3.5;

  // Title vertical brush-wipe reveals (ink brushed top-to-bottom, not mere opacity fade)
  const col1Brush = easeOutCubic(clamp01((localFrame - 8) / 22));
  const col2Brush = easeOutCubic(clamp01((localFrame - 18) / 22));
  const subBrush = easeOutCubic(clamp01((localFrame - 28) / 18));

  const farRidgePath =
    'M -20 790 C 90 740 170 620 285 592 C 375 572 440 665 535 640 C 650 610 735 510 860 538 C 960 560 1030 640 1100 620';
  const farFillPath = `${farRidgePath} L 1100 1010 L -20 1010 Z`;

  const midRidgePath =
    'M -20 920 C 110 865 215 735 350 720 C 460 708 530 825 655 795 C 765 768 850 695 975 728 L 1100 760';
  const midFillPath = `${midRidgePath} L 1100 1160 L -20 1160 Z`;

  const cliffOutlinePath =
    'M 1090 690 C 995 705 920 755 865 820 C 820 872 795 930 748 975 C 708 1012 735 1070 800 1100 C 875 1136 965 1142 1090 1138';
  const cliffFillPath = `${cliffOutlinePath} L 1090 690 Z`;

  // Wet ink leading edge x positions
  const farWetX = -40 + farSpread * 1160;
  const midWetX = -40 + midSpread * 1160;

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden', background: INK_PAPER }}>
      <InkWashPaperBase uid={uid} />

      {/* Procedural Ink Wash Landscape SVG */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0 }}
      >
        <defs>
          {/* Mountain mist fade gradients (diluted #1B1A18 -> transparent rice paper) */}
          <linearGradient id={`far-wash-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={INK_MAIN} stopOpacity="0.20" />
            <stop offset="56%" stopColor={INK_MAIN} stopOpacity="0.11" />
            <stop offset="86%" stopColor={INK_MAIN} stopOpacity="0.02" />
            <stop offset="100%" stopColor={INK_PAPER} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`mid-wash-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={INK_MAIN} stopOpacity="0.40" />
            <stop offset="54%" stopColor={INK_MAIN} stopOpacity="0.22" />
            <stop offset="84%" stopColor={INK_MAIN} stopOpacity="0.04" />
            <stop offset="100%" stopColor={INK_PAPER} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`cliff-wash-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={INK_MAIN} stopOpacity="0.86" />
            <stop offset="58%" stopColor={INK_MAIN} stopOpacity="0.62" />
            <stop offset="100%" stopColor={INK_MAIN} stopOpacity="0.22" />
          </linearGradient>
          <linearGradient id={`wet-band-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={INK_MAIN} stopOpacity="0" />
            <stop offset="65%" stopColor={INK_MAIN} stopOpacity="0.16" />
            <stop offset="100%" stopColor={INK_MAIN} stopOpacity="0" />
          </linearGradient>

          {/* Ragged ink spread clip paths */}
          <clipPath id={`far-clip-${uid}`}>
            <path
              d={`M -30 480 L ${farWetX.toFixed(1)} 480 L ${(farWetX + 26).toFixed(1)} 580 L ${(farWetX - 18).toFixed(1)} 670 L ${(farWetX + 22).toFixed(1)} 780 L ${(farWetX - 14).toFixed(1)} 900 L ${(farWetX + 16).toFixed(1)} 1040 L -30 1040 Z`}
            />
          </clipPath>
          <clipPath id={`mid-clip-${uid}`}>
            <path
              d={`M -30 660 L ${midWetX.toFixed(1)} 660 L ${(midWetX - 20).toFixed(1)} 760 L ${(midWetX + 24).toFixed(1)} 870 L ${(midWetX - 16).toFixed(1)} 980 L ${(midWetX + 18).toFixed(1)} 1180 L -30 1180 Z`}
            />
          </clipPath>
          <clipPath id={`cliff-clip-${uid}`}>
            <rect x="640" y="670" width="460" height={Math.max(1, cliffSpread * 510)} />
          </clipPath>
        </defs>

        {/* Vermilion Sun above far right peaks */}
        <VermilionInkSun cx={852} cy={432} r={44} localFrame={localFrame} fps={fps} delay={16} uid={uid} />

        {/* Layer 1: Far Mountain Range */}
        <g clipPath={`url(#far-clip-${uid})`}>
          <path d={farFillPath} fill={`url(#far-wash-${uid})`} />
          {farSpread < 0.96 && (
            <rect x={farWetX - 68} y={500} width={78} height={510} fill={`url(#wet-band-${uid})`} />
          )}
        </g>
        {/* Self-drawing far mountain dry-brush ridge */}
        <path
          d={farRidgePath}
          fill="none"
          stroke={INK_MAIN}
          strokeOpacity="0.28"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeDasharray="1350"
          strokeDashoffset={1350 * (1 - farSpread)}
        />

        {/* Drifting mist band between Layer 1 & Layer 2 */}
        <g transform={`translate(${mistShift.toFixed(1)} 0)`} opacity={0.85}>
          <ellipse cx={390} cy={805} rx={360} ry={46} fill={INK_PAPER} fillOpacity="0.72" />
          <ellipse cx={760} cy={780} rx={300} ry={42} fill={INK_PAPER} fillOpacity="0.65" />
        </g>

        {/* Layer 2: Mid Mountain Range */}
        <g clipPath={`url(#mid-clip-${uid})`}>
          <path d={midFillPath} fill={`url(#mid-wash-${uid})`} />
          {midSpread < 0.96 && (
            <rect x={midWetX - 72} y={680} width={84} height={470} fill={`url(#wet-band-${uid})`} />
          )}
        </g>
        {/* Broken dry-brush mid ridge */}
        <path
          d={midRidgePath}
          fill="none"
          stroke={INK_MAIN}
          strokeOpacity="0.54"
          strokeWidth="4.6"
          strokeLinecap="round"
          strokeDasharray="1380"
          strokeDashoffset={1380 * (1 - midSpread)}
        />
        {/* Dry-brush internal texture strokes on mid peaks */}
        {[
          'M 275 748 Q 312 792 346 840',
          'M 332 732 Q 368 784 405 836',
          'M 642 802 Q 676 844 708 884',
          'M 880 726 Q 912 770 946 818',
        ].map((d, i) => {
          const strokeProg = easeOutCubic(clamp01((localFrame - 12 - i * 4) / 22));
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={INK_MAIN}
              strokeOpacity="0.28"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeDasharray="140"
              strokeDashoffset={140 * (1 - strokeProg)}
            />
          );
        })}

        {/* Lower mist ribbon separating mid mountains from river */}
        <g transform={`translate(${(-mistShift * 0.75).toFixed(1)} 0)`}>
          <ellipse cx={320} cy={1048} rx={420} ry={58} fill={INK_PAPER} fillOpacity="0.76" />
          <ellipse cx={740} cy={1075} rx={360} ry={52} fill={INK_PAPER} fillOpacity="0.68" />
        </g>

        {/* Layer 3: Foreground Dry-Brush Cliff (right side) */}
        <g clipPath={`url(#cliff-clip-${uid})`}>
          <path d={cliffFillPath} fill={`url(#cliff-wash-${uid})`} />
          {/* Slanted dry-brush rock strokes */}
          {Array.from({ length: 11 }, (_, i) => {
            const x1 = 768 + i * 26;
            const y1 = 945 - i * 18 + (i % 2) * 28;
            const len = 54 + (i % 3) * 26;
            const p = easeOutCubic(clamp01((localFrame - 16 - i * 2) / 18));
            return (
              <path
                key={i}
                d={`M ${x1} ${y1} L ${x1 + 16} ${y1 + len}`}
                stroke={INK_MAIN}
                strokeOpacity={0.52 + (i % 3) * 0.12}
                strokeWidth={2.6 + (i % 2) * 1.4}
                strokeLinecap="round"
                strokeDasharray="120"
                strokeDashoffset={120 * (1 - p)}
              />
            );
          })}
        </g>
        <path
          d={cliffOutlinePath}
          fill="none"
          stroke={INK_MAIN}
          strokeOpacity="0.86"
          strokeWidth="6.5"
          strokeLinecap="round"
          strokeDasharray="760"
          strokeDashoffset={760 * (1 - cliffSpread)}
        />

        {/* Gnarled Pine Tree on Cliff */}
        <g>
          {/* Trunk */}
          <path
            d="M 885 832 C 876 792 850 762 842 718 C 836 686 858 656 838 632"
            fill="none"
            stroke={INK_MAIN}
            strokeOpacity="0.88"
            strokeWidth="7.2"
            strokeLinecap="round"
            strokeDasharray="280"
            strokeDashoffset={280 * (1 - clamp01(pineGrow * 1.3))}
          />
          {/* Branches */}
          <path
            d="M 848 738 C 804 734 776 742 746 728"
            fill="none"
            stroke={INK_MAIN}
            strokeOpacity="0.84"
            strokeWidth="4.2"
            strokeLinecap="round"
            strokeDasharray="120"
            strokeDashoffset={120 * (1 - clamp01((pineGrow - 0.25) * 1.5))}
          />
          <path
            d="M 846 684 C 892 676 922 682 952 672"
            fill="none"
            stroke={INK_MAIN}
            strokeOpacity="0.82"
            strokeWidth="3.8"
            strokeLinecap="round"
            strokeDasharray="120"
            strokeDashoffset={120 * (1 - clamp01((pineGrow - 0.35) * 1.6))}
          />
          {/* Fanned pine needle clusters */}
          {[
            { cx: 748, cy: 726, rx: 46, ry: 18, d: 0.45 },
            { cx: 808, cy: 668, rx: 52, ry: 20, d: 0.55 },
            { cx: 850, cy: 626, rx: 58, ry: 22, d: 0.62 },
            { cx: 944, cy: 672, rx: 48, ry: 17, d: 0.7 },
          ].map((cl, idx) => {
            const np = easeOutCubic(clamp01((pineGrow - cl.d) / 0.35));
            return (
              <g key={idx} transform={`translate(${cl.cx} ${cl.cy}) scale(${np.toFixed(3)})`}>
                <ellipse cx={0} cy={0} rx={cl.rx} ry={cl.ry} fill={INK_MAIN} fillOpacity="0.72" />
                {Array.from({ length: 7 }, (_, j) => {
                  const ang = -2.7 + j * 0.44;
                  return (
                    <line
                      key={j}
                      x1={0}
                      y1={4}
                      x2={Math.cos(ang) * cl.rx * 1.1}
                      y2={Math.sin(ang) * cl.ry * 1.4}
                      stroke={INK_MAIN}
                      strokeOpacity="0.82"
                      strokeWidth="2.1"
                      strokeLinecap="round"
                    />
                  );
                })}
              </g>
            );
          })}

          {/* Tiny solitary traveler silhouette on the cliff with tiny vermilion sash */}
          <g opacity={clamp01((localFrame - 34) / 14)} transform="translate(808 866)">
            <circle cx={0} cy={-26} r={5.2} fill={INK_MAIN} fillOpacity="0.88" />
            <path d="M -8 -18 L 8 -18 L 12 12 L -10 12 Z" fill={INK_MAIN} fillOpacity="0.82" />
            {/* Tiny red sash accent */}
            <rect x={-7} y={-5} width={15} height={3.5} rx={1.5} fill={INK_RED} />
          </g>
        </g>

        {/* River: thin broken horizontal ink strokes (kept safely above y=1395) */}
        {[
          { x1: 72, x2: 330, y: 1176, op: 0.28 },
          { x1: 420, x2: 760, y: 1204, op: 0.22 },
          { x1: 118, x2: 495, y: 1246, op: 0.30 },
          { x1: 580, x2: 940, y: 1278, op: 0.24 },
          { x1: 180, x2: 590, y: 1326, op: 0.20 },
          { x1: 660, x2: 920, y: 1364, op: 0.16 },
        ].map((line, idx) => {
          const len = line.x2 - line.x1;
          const shift = Math.sin(localFrame * 0.025 + idx) * 8;
          return (
            <line
              key={idx}
              x1={line.x1 + shift}
              y1={line.y}
              x2={line.x2 + shift}
              y2={line.y}
              stroke={INK_MAIN}
              strokeOpacity={line.op}
              strokeWidth={1.9}
              strokeLinecap="round"
              strokeDasharray={`${len}`}
              strokeDashoffset={len * (1 - riverGrow)}
            />
          );
        })}

        {/* Small drifting river sampan boat */}
        <g
          transform={`translate(${boatX.toFixed(1)} ${(1228 + boatBob).toFixed(1)})`}
          opacity={clamp01((localFrame - 20) / 16)}
        >
          <path d="M -42 0 Q 0 15 44 -2 L 32 7 Q 0 18 -34 8 Z" fill={INK_MAIN} fillOpacity="0.78" />
          <path d="M -14 0 Q -2 -18 12 0 Z" fill={INK_MAIN} fillOpacity="0.58" />
          <line x1={-32} y1={-4} x2={-48} y2={16} stroke={INK_MAIN} strokeOpacity="0.65" strokeWidth="1.8" />
          <line x1={-54} y1={14} x2={58} y2={14} stroke={INK_MAIN} strokeOpacity="0.24" strokeWidth="1.5" />
        </g>
      </svg>

      {/* Upper-Left Open Sky: 2-Column Vertical Calligraphy Title + Subtitle + Red Seal */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X + 12,
          top: SAFE_TOP + 6,
          width: 660,
          maxHeight: 540,
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        {/* Quiet warm chapter line */}
        {t.badge && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              clipPath: `inset(0 ${Math.round((1 - col1Brush) * 100)}% 0 0)`,
            }}
          >
            <div style={{ width: 22, height: 1.5, background: inkRgba(0.38) }} />
            <FitText
              text={t.badge}
              baseSize={21}
              minSize={16}
              maxLines={1}
              color={inkRgba(0.58)}
              fontWeight={600}
              align="left"
              lineHeight={1.32}
              style={{ letterSpacing: '0.14em' }}
            />
          </div>
        )}

        {/* Two vertical-style ink columns side-by-side (Thai-safe FitText, never clipping vowels) */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 22 }}>
          {/* Column 1 */}
          <div
            style={{
              flex: colB ? '0 1 285px' : '0 1 560px',
              borderLeft: `2px solid ${inkRgba(0.22)}`,
              paddingLeft: 18,
              paddingTop: 6,
              paddingBottom: 6,
              clipPath: `inset(0 0 ${Math.round((1 - col1Brush) * 100)}% 0)`,
            }}
          >
            <FitText
              text={colA}
              baseSize={44}
              minSize={26}
              maxLines={4}
              color={INK_MAIN}
              fontWeight={700}
              align="left"
              lineHeight={1.38}
              style={{ letterSpacing: '0.01em' }}
            />
          </div>

          {/* Column 2 (offset slightly lower like classic scroll column rhythm) */}
          {colB && (
            <div
              style={{
                flex: '0 1 285px',
                marginTop: 34,
                borderLeft: `1.5px solid ${inkRgba(0.16)}`,
                paddingLeft: 18,
                paddingTop: 6,
                paddingBottom: 6,
                clipPath: `inset(0 0 ${Math.round((1 - col2Brush) * 100)}% 0)`,
              }}
            >
              <FitText
                text={colB}
                baseSize={42}
                minSize={24}
                maxLines={4}
                color={inkRgba(0.86)}
                fontWeight={600}
                align="left"
                lineHeight={1.38}
                style={{ letterSpacing: '0.01em' }}
              />
            </div>
          )}
        </div>

        {/* Quiet subtitle line with tiny red square lead + Square Red Seal beneath */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginTop: 4 }}>
          <VermilionSealStamp localFrame={localFrame} fps={fps} delay={34} size={74} style={{ flexShrink: 0 }} />

          {(t.subtitle || t.bullets[0]) && (
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                clipPath: `inset(0 ${Math.round((1 - subBrush) * 100)}% 0 0)`,
              }}
            >
              <div
                style={{
                  width: 9,
                  height: 9,
                  background: INK_RED,
                  marginTop: 12,
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <FitText
                  text={t.subtitle || t.bullets[0]}
                  baseSize={25}
                  minSize={18}
                  maxLines={3}
                  color={inkRgba(0.72)}
                  fontWeight={500}
                  align="left"
                  lineHeight={1.42}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <InkPaperGrainVeil uid={uid} />
    </div>
  );
};

// ----------------------------------------------------------------------------
// look-30 Shot 2: scroll-unroll-steps
// Unrolling hanging scroll with ink brush spine & brushstroke step markers
// ----------------------------------------------------------------------------
const Look30ScrollUnrollSteps: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  fps,
}) => {
  const t = sceneTexts(scene);
  const uid = `l30-scroll-${sceneIndex}`;
  const steps = extractStepObjectsJ(scene, ['บทที่ ๑', 'บทที่ ๒', 'บทที่ ๓', 'บทที่ ๔'], 4);

  const unroll = easeOutCubic(clamp01((localFrame + 4) / 30));
  const scrollTop = 310;
  const maxScrollH = CONTENT_BOTTOM - scrollTop - 30; // 1080
  const currentScrollH = Math.max(120, Math.round(maxScrollH * unroll));
  const spineDraw = easeOutCubic(clamp01((localFrame - 8) / 36));
  const headerBrush = easeOutCubic(clamp01(localFrame / 18));

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden', background: INK_PAPER }}>
      <InkWashPaperBase uid={uid} />

      {/* Header above the scroll (y: 116..288) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X + 10,
          top: SAFE_TOP + 6,
          width: SAFE_W - 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 18,
          zIndex: 12,
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            clipPath: `inset(0 ${Math.round((1 - headerBrush) * 100)}% 0 0)`,
          }}
        >
          {t.badge && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 8, height: 8, background: INK_RED }} />
              <FitText
                text={t.badge}
                baseSize={20}
                minSize={15}
                maxLines={1}
                color={inkRgba(0.58)}
                fontWeight={600}
                align="left"
                lineHeight={1.3}
              />
            </div>
          )}
          <FitText
            text={t.title || 'ลำดับขั้นแห่งการเดินทาง'}
            baseSize={44}
            minSize={26}
            maxLines={2}
            color={INK_MAIN}
            fontWeight={700}
            align="left"
            lineHeight={1.34}
          />
        </div>

        <VermilionSealStamp localFrame={localFrame} fps={fps} delay={28} size={66} style={{ flexShrink: 0 }} />
      </div>

      {/* Top Wooden Scroll Roller */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: scrollTop - 16,
          width: SAFE_W,
          height: 24,
          zIndex: 15,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {/* Left & Right lacquer end caps with subtle vermilion cord dot */}
        <div style={{ width: 22, height: 24, borderRadius: 4, background: INK_MAIN }} />
        <div
          style={{
            flex: 1,
            height: 16,
            background: `linear-gradient(180deg, ${inkRgba(0.92)} 0%, ${inkRgba(0.68)} 50%, ${inkRgba(0.95)} 100%)`,
          }}
        />
        <div style={{ width: 22, height: 24, borderRadius: 4, background: INK_MAIN }} />
      </div>

      {/* Unrolling Scroll Body (clipped dynamically by unroll height — never clips Thai inside completed scroll) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X + 20,
          top: scrollTop + 6,
          width: SAFE_W - 40,
          height: currentScrollH,
          overflow: 'hidden',
          background: 'rgba(247, 243, 234, 0.72)',
          borderLeft: `2px solid ${inkRgba(0.24)}`,
          borderRight: `2px solid ${inkRgba(0.24)}`,
          zIndex: 10,
        }}
      >
        {/* Inner silk double-line border + faint misty ink peaks at bottom of scroll */}
        <svg
          width={SAFE_W - 40}
          height={maxScrollH}
          viewBox={`0 0 ${SAFE_W - 40} ${maxScrollH}`}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          <rect
            x={14}
            y={14}
            width={SAFE_W - 68}
            height={maxScrollH - 28}
            fill="none"
            stroke={INK_MAIN}
            strokeOpacity="0.16"
            strokeWidth="1.5"
          />
          {/* Faint ink wash mountain silhouette along bottom of scroll */}
          <path
            d={`M 14 ${maxScrollH - 80} C 180 ${maxScrollH - 185} 340 ${maxScrollH - 120} 510 ${maxScrollH - 175} C 680 ${maxScrollH - 220} 810 ${maxScrollH - 130} ${SAFE_W - 54} ${maxScrollH - 155} L ${SAFE_W - 54} ${maxScrollH - 14} L 14 ${maxScrollH - 14} Z`}
            fill={INK_MAIN}
            fillOpacity="0.08"
          />
          {/* Continuous vertical brush spine connecting step brush-markers */}
          <path
            d={`M 96 92 C 88 260 106 430 94 610 C 86 760 102 890 96 ${maxScrollH - 110}`}
            fill="none"
            stroke={INK_MAIN}
            strokeOpacity="0.34"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeDasharray="1000"
            strokeDashoffset={1000 * (1 - spineDraw)}
          />
        </svg>

        {/* Steps list with brush-ring markers */}
        <div
          style={{
            position: 'relative',
            padding: '44px 44px 48px 44px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: steps.length >= 4 ? 26 : 44,
          }}
        >
          {steps.map((step, idx) => {
            const p = stagger(idx, localFrame, 9, 10, 18);
            const isLast = idx === steps.length - 1;
            return (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 28,
                  clipPath: `inset(0 ${Math.round((1 - p) * 100)}% 0 0)`,
                }}
              >
                {/* Ink brush circle node */}
                <div style={{ position: 'relative', width: 104, height: 104, flexShrink: 0 }}>
                  <svg width={104} height={104} viewBox="0 0 104 104">
                    {/* Diluted ink wash blotch */}
                    <circle cx={52} cy={52} r={44} fill={INK_MAIN} fillOpacity="0.06" />
                    {/* Brushstroke circle */}
                    <path
                      d="M 52 12 C 76 11 94 31 92 54 C 90 78 72 93 48 92 C 26 91 11 72 13 49 C 15 28 31 15 47 13"
                      fill="none"
                      stroke={INK_MAIN}
                      strokeOpacity="0.82"
                      strokeWidth="5.2"
                      strokeLinecap="round"
                      strokeDasharray="265"
                      strokeDashoffset={265 * (1 - p)}
                    />
                    {/* Numeral inside circle (ASCII digits safe in SVG) */}
                    <text
                      x="52"
                      y="59"
                      textAnchor="middle"
                      fill={INK_MAIN}
                      fontSize="26"
                      fontWeight="700"
                      fontFamily={FONT_SERIF}
                    >
                      {pad2J(idx + 1)}
                    </text>
                    {/* Tiny red vermilion dot accent on final/milestone node */}
                    {isLast && <circle cx={84} cy={22} r={6} fill={INK_RED} opacity={p} />}
                  </svg>
                </div>

                {/* Step text block */}
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    paddingTop: 6,
                    borderBottom: idx < steps.length - 1 ? `1px solid ${inkRgba(0.12)}` : 'none',
                    paddingBottom: idx < steps.length - 1 ? 22 : 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div
                      style={{
                        width: 7,
                        height: 7,
                        background: isLast ? INK_RED : inkRgba(0.45),
                        flexShrink: 0,
                      }}
                    />
                    <FitText
                      text={step.tag}
                      baseSize={22}
                      minSize={16}
                      maxLines={1}
                      color={isLast ? INK_RED : inkRgba(0.58)}
                      fontWeight={700}
                      align="left"
                      lineHeight={1.32}
                    />
                  </div>
                  <FitText
                    text={step.text}
                    baseSize={31}
                    minSize={21}
                    maxLines={3}
                    color={INK_MAIN}
                    fontWeight={600}
                    align="left"
                    lineHeight={1.38}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom Wooden Scroll Roller moving down as scroll unrolls */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X,
          top: scrollTop + currentScrollH + 2,
          width: SAFE_W,
          height: 28,
          zIndex: 16,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 5,
            background: INK_MAIN,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: 4, background: INK_RED }} />
        </div>
        <div
          style={{
            flex: 1,
            height: 20,
            background: `linear-gradient(180deg, ${inkRgba(0.82)} 0%, ${inkRgba(0.58)} 45%, ${inkRgba(0.95)} 100%)`,
          }}
        />
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 5,
            background: INK_MAIN,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: 4, background: INK_RED }} />
        </div>
      </div>

      <InkPaperGrainVeil uid={uid} />
    </div>
  );
};

// ----------------------------------------------------------------------------
// look-30 Shot 3: enso-stat
// Single-stroke Zen Ensō brush circle painted around a bold ink statistic
// ----------------------------------------------------------------------------
const Look30EnsoStat: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  fps,
}) => {
  const t = sceneTexts(scene);
  const uid = `l30-enso-${sceneIndex}`;
  const metric = extractPrimaryMetricJ(scene, sceneIndex, 88, '');

  const ensoProgress = easeOutQuartJ(clamp01((localFrame + 2) / 36));
  const numCountProgress = easeOutCubic(clamp01((localFrame - 10) / 28));
  const displayStat = formatAnimatedStatJ(metric, numCountProgress);
  const titleBrush = easeOutCubic(clamp01(localFrame / 18));
  const footerBrush = easeOutCubic(clamp01((localFrame - 22) / 20));
  const dividerProgress = easeOutCubic(clamp01((localFrame - 18) / 22));

  const cx = STAGE_W / 2; // 540
  const cy = 656;

  // Hand-drawn open Ensō circle paths (main thick wet stroke + split dry-brush hairs)
  const ensoMain =
    'M 498 398 C 650 384 794 494 804 646 C 814 796 700 924 544 926 C 392 928 274 812 276 660 C 278 524 374 426 480 406';
  const ensoDry1 =
    'M 526 388 C 668 386 798 498 814 642 C 824 786 716 914 562 934 C 414 944 282 830 268 680';
  const ensoDry2 =
    'M 474 416 C 362 444 286 544 290 668 C 294 788 392 904 522 912 C 656 920 774 824 788 688';

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden', background: INK_PAPER }}>
      <InkWashPaperBase uid={uid} />

      {/* Background faint mountain mist + Zen Ensō Circle SVG */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0 }}
      >
        <defs>
          <radialGradient id={`enso-halo-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="68%" stopColor={INK_MAIN} stopOpacity="0" />
            <stop offset="88%" stopColor={INK_MAIN} stopOpacity="0.065" />
            <stop offset="100%" stopColor={INK_MAIN} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Subtle misty distant horizon at lower safe area */}
        <path
          d="M 0 1350 C 190 1255 370 1310 560 1248 C 745 1188 890 1280 1080 1235 L 1080 1420 L 0 1420 Z"
          fill={INK_MAIN}
          fillOpacity="0.075"
        />

        {/* Diluted ink wash halo behind Ensō */}
        <circle cx={cx} cy={cy} r={308} fill={`url(#enso-halo-${uid})`} opacity={ensoProgress} />

        {/* Main thick Ensō brushstroke */}
        <path
          d={ensoMain}
          fill="none"
          stroke={INK_MAIN}
          strokeOpacity="0.86"
          strokeWidth="34"
          strokeLinecap="round"
          strokeDasharray="1740"
          strokeDashoffset={1740 * (1 - ensoProgress)}
        />
        {/* Dry-brush outer split bristle */}
        <path
          d={ensoDry1}
          fill="none"
          stroke={INK_MAIN}
          strokeOpacity="0.34"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray="1420"
          strokeDashoffset={1420 * (1 - clamp01(ensoProgress * 1.05))}
        />
        {/* Inner ink-bleed dry bristle */}
        <path
          d={ensoDry2}
          fill="none"
          stroke={INK_MAIN}
          strokeOpacity="0.24"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray="1280"
          strokeDashoffset={1280 * (1 - clamp01((ensoProgress - 0.08) / 0.92))}
        />
        {/* Subtle ink splatter dots near end of brush sweep */}
        {[
          { x: 454, y: 392, r: 4.5 },
          { x: 432, y: 406, r: 2.8 },
          { x: 486, y: 380, r: 3.2 },
        ].map((dot, idx) => (
          <circle
            key={idx}
            cx={dot.x}
            cy={dot.y}
            r={dot.r}
            fill={INK_MAIN}
            fillOpacity={ensoProgress > 0.88 ? 0.65 * clamp01((ensoProgress - 0.88) / 0.12) : 0}
          />
        ))}

        {/* Horizontal ink divider rule drawing from center outward */}
        <line
          x1={cx - 320 * dividerProgress}
          y1={1016}
          x2={cx + 320 * dividerProgress}
          y2={1016}
          stroke={INK_MAIN}
          strokeOpacity="0.24"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>

      {/* Top Header (y: 118..330) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X + 20,
          top: SAFE_TOP + 8,
          width: SAFE_W - 40,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          clipPath: `inset(0 ${Math.round((1 - titleBrush) * 50)}% 0 ${Math.round((1 - titleBrush) * 50)}%)`,
          zIndex: 10,
        }}
      >
        {t.badge && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 8, height: 8, background: INK_RED }} />
            <FitText
              text={t.badge}
              baseSize={22}
              minSize={16}
              maxLines={1}
              color={inkRgba(0.58)}
              fontWeight={600}
              align="center"
              lineHeight={1.32}
            />
          </div>
        )}
        <FitText
          text={t.title || 'ตัวเลขสำคัญที่ต้องจับตา'}
          baseSize={44}
          minSize={26}
          maxLines={2}
          color={INK_MAIN}
          fontWeight={700}
          align="center"
          lineHeight={1.34}
        />
      </div>

      {/* Giant Stat Inside Ensō Circle */}
      <div
        style={{
          position: 'absolute',
          left: cx - 220,
          top: cy - 110,
          width: 440,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          zIndex: 12,
          opacity: clamp01((localFrame - 6) / 14),
          transform: `scale(${(0.92 + 0.08 * numCountProgress).toFixed(3)})`,
        }}
      >
        <FitText
          text={displayStat}
          baseSize={118}
          minSize={54}
          maxLines={1}
          color={INK_MAIN}
          fontWeight={800}
          align="center"
          lineHeight={1.18}
          fontFamily={FONT_THAI}
        />
        {metric.unit && (
          <FitText
            text={metric.unit}
            baseSize={30}
            minSize={20}
            maxLines={1}
            color={inkRgba(0.68)}
            fontWeight={600}
            align="center"
            lineHeight={1.32}
          />
        )}
      </div>

      {/* Vermilion Seal Stamp tucked at lower-right edge of Ensō */}
      <VermilionSealStamp
        localFrame={localFrame}
        fps={fps}
        delay={32}
        size={78}
        style={{ position: 'absolute', left: 742, top: 822, zIndex: 14 }}
      />

      {/* Lower Editorial Context (y: 1044..1390) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X + 36,
          top: 1046,
          width: SAFE_W - 72,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          zIndex: 12,
          clipPath: `inset(0 0 ${Math.round((1 - footerBrush) * 100)}% 0)`,
        }}
      >
        <FitText
          text={metric.label || t.subtitle || t.title}
          baseSize={36}
          minSize={24}
          maxLines={2}
          color={INK_MAIN}
          fontWeight={700}
          align="center"
          lineHeight={1.38}
        />

        {(metric.delta || t.bullets[0]) && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 22px',
              borderTop: `1px solid ${inkRgba(0.18)}`,
              borderBottom: `1px solid ${inkRgba(0.18)}`,
              maxWidth: SAFE_W - 100,
            }}
          >
            <div style={{ width: 9, height: 9, background: INK_RED, flexShrink: 0 }} />
            <FitText
              text={metric.delta || t.bullets[0]}
              baseSize={26}
              minSize={19}
              maxLines={2}
              color={inkRgba(0.76)}
              fontWeight={600}
              align="center"
              lineHeight={1.36}
            />
          </div>
        )}
      </div>

      <InkPaperGrainVeil uid={uid} />
    </div>
  );
};

// ----------------------------------------------------------------------------
// look-30 Shot 4: seal-quote
// Calligraphic quote on rice paper with bamboo ink strokes & vermilion seal stamp
// ----------------------------------------------------------------------------
const Look30SealQuote: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  fps,
}) => {
  const t = sceneTexts(scene);
  const uid = `l30-quote-${sceneIndex}`;
  const quoteText = scene.quote?.text?.trim() || t.subtitle || t.bullets[0] || t.title || 'ความเรียบง่ายคือที่สุดของความงาม';
  const authorText =
    scene.quote?.author?.trim() ||
    scene.quote?.source?.trim() ||
    scene.source?.trim() ||
    (scene.quote?.text ? t.title : '') ||
    'บันทึกภูมิปัญญา';
  const roleText = scene.quote?.role?.trim() || '';

  const bambooGrow = easeOutCubic(clamp01((localFrame + 4) / 36));
  const marginLine = easeOutCubic(clamp01((localFrame - 4) / 26));
  const quoteBrush = easeOutCubic(clamp01((localFrame - 10) / 26));
  const authorBrush = easeOutCubic(clamp01((localFrame - 24) / 18));

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden', background: INK_PAPER }}>
      <InkWashPaperBase uid={uid} />

      {/* Ink Bamboo Branch (top-right) + Vertical Margin Brush Line + Subtle Horizon */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0 }}
      >
        {/* Soft misty mountains at bottom edge of safe zone */}
        <path
          d="M 0 1320 C 210 1235 420 1298 630 1245 C 820 1196 960 1265 1080 1225 L 1080 1420 L 0 1420 Z"
          fill={INK_MAIN}
          fillOpacity="0.08"
        />

        {/* Delicate Bamboo Stalks sweeping in from top-right */}
        <path
          d="M 1020 70 C 986 180 962 290 936 420"
          fill="none"
          stroke={INK_MAIN}
          strokeOpacity="0.42"
          strokeWidth="5.2"
          strokeLinecap="round"
          strokeDasharray="380"
          strokeDashoffset={380 * (1 - bambooGrow)}
        />
        <path
          d="M 964 240 C 890 258 830 288 776 330"
          fill="none"
          stroke={INK_MAIN}
          strokeOpacity="0.34"
          strokeWidth="3.0"
          strokeLinecap="round"
          strokeDasharray="240"
          strokeDashoffset={240 * (1 - clamp01((bambooGrow - 0.25) / 0.75))}
        />
        {/* Bamboo brush leaves */}
        {[
          { d: 'M 885 264 Q 820 228 772 246 Q 828 262 885 264 Z', delay: 0.35 },
          { d: 'M 848 282 Q 778 274 736 306 Q 796 302 848 282 Z', delay: 0.48 },
          { d: 'M 950 326 Q 886 334 848 374 Q 904 360 950 326 Z', delay: 0.58 },
          { d: 'M 978 182 Q 912 162 868 188 Q 924 196 978 182 Z', delay: 0.42 },
          { d: 'M 955 210 Q 1004 238 1044 276 Q 992 252 955 210 Z', delay: 0.52 },
        ].map((leaf, i) => {
          const lp = easeOutCubic(clamp01((bambooGrow - leaf.delay) / 0.35));
          return (
            <path
              key={i}
              d={leaf.d}
              fill={INK_MAIN}
              fillOpacity={0.38 * lp}
            />
          );
        })}

        {/* Vertical ink margin stroke framing the quote */}
        <line
          x1={92}
          y1={288}
          x2={92}
          y2={288 + 690 * marginLine}
          stroke={INK_MAIN}
          strokeOpacity="0.36"
          strokeWidth="4"
          strokeLinecap="round"
        />

        {/* Oversized calligraphic pale ink opening quote glyph */}
        <text
          x="122"
          y="392"
          fill={INK_MAIN}
          fillOpacity={0.11 * quoteBrush}
          fontSize="210"
          fontFamily={FONT_SERIF}
          fontWeight="700"
        >
          “
        </text>
      </svg>

      {/* Top Topic / Badge (y: 126..226) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X + 34,
          top: SAFE_TOP + 16,
          width: 720,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          zIndex: 10,
          clipPath: `inset(0 ${Math.round((1 - marginLine) * 100)}% 0 0)`,
        }}
      >
        <div style={{ width: 10, height: 10, background: INK_RED, flexShrink: 0 }} />
        <FitText
          text={t.badge || (scene.quote?.text ? t.title : 'คำคมและข้อคิด')}
          baseSize={25}
          minSize={18}
          maxLines={2}
          color={inkRgba(0.62)}
          fontWeight={600}
          align="left"
          lineHeight={1.35}
        />
      </div>

      {/* Main Quote Block (x: 132..980, y: 340..980) */}
      <div
        style={{
          position: 'absolute',
          left: 132,
          top: 356,
          width: 846,
          zIndex: 12,
          clipPath: `inset(0 0 ${Math.round((1 - quoteBrush) * 100)}% 0)`,
        }}
      >
        <FitText
          text={quoteText}
          baseSize={50}
          minSize={28}
          maxLines={6}
          color={INK_MAIN}
          fontWeight={700}
          align="left"
          lineHeight={1.48}
        />
      </div>

      {/* Attribution + Prominent Red Vermilion Seal Stamp (y: 1030..1310) */}
      <div
        style={{
          position: 'absolute',
          left: 132,
          top: 1038,
          width: 846,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 28,
          zIndex: 14,
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            clipPath: `inset(0 ${Math.round((1 - authorBrush) * 100)}% 0 0)`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 28, height: 2, background: INK_RED, flexShrink: 0 }} />
            <FitText
              text={authorText}
              baseSize={32}
              minSize={22}
              maxLines={2}
              color={INK_MAIN}
              fontWeight={700}
              align="left"
              lineHeight={1.35}
            />
          </div>
          {roleText && (
            <div style={{ paddingLeft: 40 }}>
              <FitText
                text={roleText}
                baseSize={23}
                minSize={17}
                maxLines={2}
                color={inkRgba(0.62)}
                fontWeight={500}
                align="left"
                lineHeight={1.35}
              />
            </div>
          )}
        </div>

        {/* Authoritative square vermilion seal pressing down */}
        <VermilionSealStamp localFrame={localFrame} fps={fps} delay={28} size={98} style={{ flexShrink: 0 }} />
      </div>

      <InkPaperGrainVeil uid={uid} />
    </div>
  );
};

// ============================================================================
// STYLE 2: look-32 — HEADLINE HIGHLIGHT (ไฮไลต์พาดหัว)
// Hardcoded Palette:
//   Dark Backdrop: #15181C
//   Blurred Wall Cards: #E9EAEC
//   Article Paper: #FCFCFA
//   Headline Ink: #16181B | Body Ink: #26292D | Hairline: #D9DBDE | UI Muted: #6A6F76
//   News Red: #C1272D (ONLY for news category tag)
//   Lime Highlighter: #C9F52A (double-pass: #B8E81A) with mix-blend-mode: multiply
//   Post Card: #FFFFFF | Verified Blue: #2F7BF5
// ============================================================================

const HL_BG = '#15181C';
const HL_BLUR_CARD = '#E9EAEC';
const HL_PAPER = '#FCFCFA';
const HL_INK = '#16181B';
const HL_BODY = '#26292D';
const HL_RULE = '#D9DBDE';
const HL_MUTED = '#6A6F76';
const HL_RED = '#C1272D';
const HL_LIME = '#C9F52A';
const HL_LIME_DEEP = '#B8E81A';
const HL_BLUE = '#2F7BF5';

/** Drifting wall of out-of-focus news article cards on near-black #15181C stage */
const BlurredArticleWallBackdrop: React.FC<{
  localFrame: number;
  parallaxX?: number;
  parallaxY?: number;
}> = ({ localFrame, parallaxX = 0, parallaxY = 0 }) => {
  const driftY = localFrame * -0.45 + parallaxY;
  const driftX = Math.sin(localFrame * 0.014) * 14 + parallaxX;

  const cards = [
    { x: -70, y: 40, w: 360, h: 490, rot: -5.2, imgH: 135 },
    { x: 330, y: -40, w: 390, h: 520, rot: -3.6, imgH: 150 },
    { x: 750, y: 55, w: 380, h: 480, rot: -4.8, imgH: 120 },
    { x: -50, y: 590, w: 375, h: 510, rot: -4.2, imgH: 145 },
    { x: 355, y: 540, w: 385, h: 530, rot: -3.2, imgH: 135 },
    { x: 770, y: 605, w: 365, h: 500, rot: -5.0, imgH: 155 },
    { x: -60, y: 1150, w: 385, h: 500, rot: -3.8, imgH: 140 },
    { x: 345, y: 1130, w: 390, h: 510, rot: -4.6, imgH: 130 },
    { x: 765, y: 1165, w: 375, h: 500, rot: -3.4, imgH: 145 },
  ];

  return (
    <div style={{ position: 'absolute', inset: 0, background: HL_BG, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          inset: -120,
          transform: `translate3d(${driftX.toFixed(1)}px, ${driftY.toFixed(1)}px, 0)`,
          filter: 'blur(7.5px)',
          opacity: 0.24,
        }}
      >
        {cards.map((c, idx) => (
          <div
            key={idx}
            style={{
              position: 'absolute',
              left: c.x + 120,
              top: c.y + 120,
              width: c.w,
              height: c.h,
              background: HL_BLUR_CARD,
              borderRadius: 6,
              padding: 24,
              transform: `rotate(${c.rot}deg)`,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            {/* Faux red news tag */}
            <div style={{ width: 72, height: 12, background: HL_RED, opacity: 0.72 }} />
            {/* Faux headline bars */}
            <div style={{ width: '92%', height: 22, background: '#3A3E45', borderRadius: 2 }} />
            <div style={{ width: '74%', height: 22, background: '#3A3E45', borderRadius: 2 }} />
            {/* Muted photo block */}
            <div style={{ width: '100%', height: c.imgH, background: '#B9BEC6', borderRadius: 3 }} />
            {/* Faux paragraph lines */}
            <div style={{ width: '100%', height: 10, background: '#A7ADB6', borderRadius: 2 }} />
            <div style={{ width: '96%', height: 10, background: '#A7ADB6', borderRadius: 2 }} />
            <div style={{ width: '82%', height: 10, background: '#A7ADB6', borderRadius: 2 }} />
          </div>
        ))}
      </div>

      {/* Deep editorial spotlight vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse 760px 840px at 50% 42%, rgba(21,24,28,0.16) 0%, rgba(12,14,17,0.72) 72%, rgba(8,10,12,0.92) 100%)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};

/** Authentic lime highlighter sweep with rough edge, chisel end, touchdown ink blot & multiply blend */
const LimeHighlighterSweep: React.FC<{
  progress: number;
  doublePass?: boolean;
  seed?: number;
  children: React.ReactNode;
}> = ({ progress, doublePass = false, seed = 1, children }) => {
  const p = easeOutQuartJ(clamp01(progress));
  const secondPass = doublePass ? easeOutQuartJ(clamp01((progress - 0.55) / 0.45)) : 0;
  const skew = -7 - (hashJ(seed * 13) * 4);

  return (
    <div style={{ position: 'relative', display: 'block', width: '100%' }}>
      {/* Text sits underneath visually; highlighter uses multiply so text stays crisp black */}
      <div style={{ position: 'relative', zIndex: 1, padding: '6px 12px' }}>{children}</div>

      {/* Highlighter ink layer (mix-blend-mode: multiply) */}
      <div
        style={{
          position: 'absolute',
          left: 2,
          right: 4,
          top: 3,
          bottom: 3,
          zIndex: 2,
          pointerEvents: 'none',
          mixBlendMode: 'multiply',
          transformOrigin: 'left center',
          transform: `scaleX(${p.toFixed(4)})`,
          opacity: p > 0.01 ? 1 : 0,
        }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 600 64"
          preserveAspectRatio="none"
          style={{ display: 'block', width: '100%', height: '100%' }}
        >
          {/* Chisel-cut organic rough marker body */}
          <path
            d={`M ${8 + Math.round(hashJ(seed) * 4)} 6 L 592 4 L 584 59 L 2 61 Z`}
            fill={HL_LIME}
          />
          {/* Touch-down darker ink drop on left */}
          <ellipse cx="14" cy="33" rx="11" ry="26" fill={HL_LIME_DEEP} fillOpacity="0.62" />
          {/* Faint marker bristle streaks */}
          <line x1="12" y1="18" x2="584" y2="16" stroke={HL_LIME_DEEP} strokeWidth="2.4" strokeOpacity="0.48" />
          <line x1="16" y1="46" x2="578" y2="48" stroke={HL_LIME_DEEP} strokeWidth="2.0" strokeOpacity="0.42" />
          {/* Chisel trailing tip shading */}
          <polygon points="576,4 596,4 586,60 570,60" fill={HL_LIME_DEEP} fillOpacity="0.4" />
        </svg>
      </div>

      {/* Optional double-pass darker lime stroke (#B8E81A) */}
      {doublePass && secondPass > 0.01 && (
        <div
          style={{
            position: 'absolute',
            left: 10,
            right: 22,
            top: 9,
            bottom: 7,
            zIndex: 3,
            pointerEvents: 'none',
            mixBlendMode: 'multiply',
            transformOrigin: 'left center',
            transform: `scaleX(${secondPass.toFixed(4)}) skewX(${skew.toFixed(1)}deg)`,
            background: HL_LIME_DEEP,
            opacity: 0.42,
            borderRadius: 2,
          }}
        />
      )}
    </div>
  );
};

/** Blue verified checkmark badge (#2F7BF5) */
const VerifiedBadgeIcon: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="12" r="11" fill={HL_BLUE} />
    <path
      d="M 7.2 12.2 L 10.4 15.4 L 16.8 8.8"
      fill="none"
      stroke="#FFFFFF"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Editorial Masthead bar (fictional newspaper, NEVER a real brand) */
const EditorialMasthead: React.FC<{
  category: string;
  edition?: string;
  compact?: boolean;
}> = ({ category, edition = 'EDITION NO. 42 · DESK REPORT', compact = false }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 8 : 12 }}>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: `2.5px solid ${HL_INK}`,
        paddingBottom: compact ? 8 : 12,
      }}
    >
      <div
        style={{
          fontFamily: FONT_SERIF,
          fontSize: compact ? 26 : 34,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          color: HL_INK,
          lineHeight: 1.1,
        }}
      >
        THE CHRONICLE DESK
      </div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 13,
          fontWeight: 600,
          color: HL_MUTED,
          letterSpacing: '0.06em',
        }}
      >
        {edition}
      </div>
    </div>

    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: `1px solid ${HL_RULE}`,
        paddingBottom: compact ? 8 : 10,
        gap: 12,
      }}
    >
      {/* News Red #C1272D used ONLY for news category tag */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          background: HL_RED,
          padding: '4px 12px',
          borderRadius: 2,
          maxWidth: 460,
        }}
      >
        <FitText
          text={category || 'รายงานพิเศษ'}
          baseSize={19}
          minSize={15}
          maxLines={1}
          color="#FFFFFF"
          fontWeight={700}
          align="left"
          lineHeight={1.3}
        />
      </div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 13,
          color: HL_MUTED,
          letterSpacing: '0.08em',
          flexShrink: 0,
        }}
      >
        ANALYSIS · VERIFIED
      </div>
    </div>
  </div>
);

// ----------------------------------------------------------------------------
// look-32 Shot 1: tilted-article-flyin
// 3D tilted newspaper article flying in on heavy spring + dolly glide + highlight + mini post pop
// ----------------------------------------------------------------------------
const Look32TiltedArticleFlyin: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const t = sceneTexts(scene);
  const halftoneId = `news-halftone-${sceneIndex}`;
  const pts = extractPointsJ(scene, 3);
  const keyHighlight =
    (Array.isArray(scene.highlight) ? scene.highlight[0] : String(scene.highlight || '').trim()) ||
    pts[0] ||
    t.subtitle ||
    t.title;
  const leadParagraph = t.subtitle || pts[0] || 'รายงานเชิงลึกรวบรวมข้อเท็จจริงและหลักฐานสำคัญไว้ครบถ้วนในหน้าเดียว';
  const evidenceText = pts[1] || scene.quote?.text || t.subtitle || t.title;

  // Heavy spring fly-in from bottom corner with 3D sway past rest
  const flySpring = spring({
    frame: localFrame,
    fps,
    config: { damping: 13, stiffness: 92, mass: 1.35 },
  });
  const swaySpring = spring({
    frame: Math.max(0, localFrame - 3),
    fps,
    config: { damping: 10, stiffness: 76, mass: 1.45 },
  });

  // Cinema dolly push-in (slow start -> long glide -> soft landing)
  const dollyP = easeInOutCubicJ(clamp01((localFrame - 16) / Math.max(24, durationFrames * 0.45)));

  const translateY = interpolate(flySpring, [0, 1], [680, 0]) - dollyP * 22;
  const translateX = interpolate(flySpring, [0, 1], [110, 0]);
  const rotateX = interpolate(swaySpring, [0, 1], [34, 4.5]) - dollyP * 1.5;
  const rotateY = interpolate(swaySpring, [0, 1], [-22, -4.2]) + dollyP * 1.2;
  const rotateZ = interpolate(swaySpring, [0, 1], [-9.5, -1.6]);
  const scale = interpolate(flySpring, [0, 1], [0.84, 1.0]) + dollyP * 0.04;
  const motionBlur = localFrame < 9 ? (1 - localFrame / 9) * 3.8 : 0;

  // Lime highlight sweeps across key sentence after landing
  const hl1 = clamp01((localFrame - 24) / 20);

  // Corner evidence post pops ~0.4s (12 frames) after highlight finishes
  const postDelay = 52;
  const postSpring = spring({
    frame: Math.max(0, localFrame - postDelay),
    fps,
    config: { damping: 12, stiffness: 170, mass: 0.9 },
  });
  const postTiltSpring = spring({
    frame: Math.max(0, localFrame - (postDelay + 3)),
    fps,
    config: { damping: 11, stiffness: 125, mass: 1.05 },
  });
  const postVisible = localFrame >= postDelay;
  const postScale = postVisible ? interpolate(postSpring, [0, 1], [0.64, 1.0]) : 0.64;
  const postY = postVisible ? interpolate(postSpring, [0, 1], [95, 0]) : 95;
  const postRot = postVisible ? interpolate(postTiltSpring, [0, 1], [9.5, 2.2]) : 9.5;

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden', background: HL_BG }}>
      <BlurredArticleWallBackdrop
        localFrame={localFrame}
        parallaxX={-translateX * 0.14}
        parallaxY={-dollyP * 18}
      />

      {/* 3D Perspective Stage strictly inside safe area */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X + 18,
          top: SAFE_TOP + 22,
          width: SAFE_W - 36,
          perspective: 1450,
          zIndex: 10,
        }}
      >
        <div
          style={{
            background: HL_PAPER,
            borderRadius: 6,
            padding: '34px 36px 40px 36px',
            boxShadow: '0 42px 92px rgba(0, 0, 0, 0.68), 0 8px 22px rgba(0, 0, 0, 0.35)',
            transform: `translate3d(${translateX.toFixed(1)}px, ${translateY.toFixed(1)}px, 0) scale(${scale.toFixed(4)}) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) rotateZ(${rotateZ.toFixed(2)}deg)`,
            transformStyle: 'preserve-3d',
            filter: motionBlur > 0.1 ? `blur(${motionBlur.toFixed(2)}px)` : 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          <EditorialMasthead category={t.badge || 'BREAKING ANALYSIS'} />

          {/* Newspaper Bold Headline */}
          <FitText
            text={t.title || 'ประเด็นสำคัญที่ถูกจับตามองมากที่สุดในเวลานี้'}
            baseSize={48}
            minSize={29}
            maxLines={3}
            color={HL_INK}
            fontWeight={800}
            align="left"
            lineHeight={1.32}
          />

          {/* Byline bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontFamily: FONT_MONO,
              fontSize: 15,
              color: HL_MUTED,
              borderTop: `1px solid ${HL_RULE}`,
              borderBottom: `1px solid ${HL_RULE}`,
              padding: '8px 0',
            }}
          >
            <span>BY RESEARCH DESK</span>
            <span>VERIFIED BRIEFING</span>
          </div>

          {/* Muted editorial documentary graphic block */}
          <div
            style={{
              width: '100%',
              height: 168,
              background: '#ECEEF1',
              borderRadius: 4,
              border: `1px solid ${HL_RULE}`,
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <svg width="100%" height="168" viewBox="0 0 840 168" preserveAspectRatio="none">
              <defs>
                <pattern id={halftoneId} width="16" height="16" patternUnits="userSpaceOnUse">
                  <circle cx="8" cy="8" r="1.3" fill="#8C929C" fillOpacity="0.28" />
                </pattern>
              </defs>
              <rect width="840" height="168" fill={`url(#${halftoneId})`} />
              <path
                d="M 40 132 L 175 112 L 310 122 L 455 74 L 610 86 L 785 38"
                fill="none"
                stroke={HL_INK}
                strokeWidth="3.2"
                strokeOpacity="0.72"
              />
              <path
                d="M 40 132 L 175 112 L 310 122 L 455 74 L 610 86 L 785 38 L 785 156 L 40 156 Z"
                fill={HL_INK}
                fillOpacity="0.06"
              />
              <circle cx="785" cy="38" r="6" fill={HL_INK} />
              <line x1="40" y1="154" x2="800" y2="154" stroke="#B6BCC6" strokeWidth="1.5" />
            </svg>
          </div>

          {/* Lead Paragraph with Lime Highlighter Sweep */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <LimeHighlighterSweep progress={hl1} doublePass seed={11}>
              <FitText
                text={keyHighlight}
                baseSize={30}
                minSize={21}
                maxLines={2}
                color={HL_INK}
                fontWeight={700}
                align="left"
                lineHeight={1.4}
              />
            </LimeHighlighterSweep>

            {leadParagraph !== keyHighlight && (
              <div style={{ paddingLeft: 12, paddingRight: 12 }}>
                <FitText
                  text={leadParagraph}
                  baseSize={25}
                  minSize={18}
                  maxLines={2}
                  color={HL_BODY}
                  fontWeight={500}
                  align="left"
                  lineHeight={1.42}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Overlapping Verified Evidence Post Card at bottom-right corner (safely <= CONTENT_BOTTOM) */}
      <div
        style={{
          position: 'absolute',
          left: 382,
          top: 1094,
          width: 632,
          zIndex: 20,
          opacity: postVisible ? clamp01((localFrame - postDelay) / 6) : 0,
          transform: `translate3d(0, ${postY.toFixed(1)}px, 0) scale(${postScale.toFixed(3)}) rotate(${postRot.toFixed(2)}deg)`,
          transformOrigin: 'bottom right',
        }}
      >
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 16,
            padding: '22px 26px',
            boxShadow: '0 28px 64px rgba(0, 0, 0, 0.58), 0 0 0 1px rgba(22, 24, 27, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                background: HL_INK,
                color: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: FONT_MONO,
                fontWeight: 800,
                fontSize: 16,
                flexShrink: 0,
              }}
            >
              CD
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ minWidth: 0 }}>
                  <FitText
                    text={scene.source || 'Chronicle Desk'}
                    baseSize={21}
                    minSize={15}
                    maxLines={1}
                    color={HL_INK}
                    fontWeight={800}
                    align="left"
                    lineHeight={1.3}
                  />
                </div>
                <VerifiedBadgeIcon size={20} />
              </div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 13, color: HL_MUTED }}>@chronicle_brief · VERIFIED</div>
            </div>
          </div>

          <FitText
            text={evidenceText}
            baseSize={26}
            minSize={19}
            maxLines={3}
            color={HL_BODY}
            fontWeight={600}
            align="left"
            lineHeight={1.38}
          />
        </div>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// look-32 Shot 2: highlight-sweep
// Dolly push-in into key article paragraph with line-by-line lime highlighter sweeps (scaleX origin left)
// ----------------------------------------------------------------------------
const Look32HighlightSweep: React.FC<StyleShotArgs> = ({
  scene,
  localFrame,
  durationFrames,
}) => {
  const t = sceneTexts(scene);
  const rawPts = extractPointsJ(scene, 4);
  const lines =
    rawPts.length >= 2
      ? rawPts
      : [
          t.subtitle || rawPts[0] || t.title,
          ...(t.title && t.subtitle ? [t.title] : ['รายละเอียดสำคัญที่ถูกเน้นย้ำในเอกสารฉบับล่าสุด']),
        ].slice(0, 3);

  // Smooth cinema dolly glide (slow start -> long glide -> soft landing)
  const dolly = easeInOutCubicJ(clamp01(localFrame / Math.max(28, durationFrames * 0.55)));
  const cardScale = 0.94 + dolly * 0.08;
  const cardY = interpolate(dolly, [0, 1], [42, -8]);
  const cardRotX = interpolate(dolly, [0, 1], [8.5, 3.2]);
  const cardRotY = interpolate(dolly, [0, 1], [-6.0, -2.0]);
  const cardRotZ = interpolate(dolly, [0, 1], [-2.2, -0.8]);

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden', background: HL_BG }}>
      <BlurredArticleWallBackdrop localFrame={localFrame} parallaxY={-dolly * 22} />

      <div
        style={{
          position: 'absolute',
          left: SAFE_X + 12,
          top: SAFE_TOP + 22,
          width: SAFE_W - 24,
          perspective: 1400,
          zIndex: 10,
        }}
      >
        <div
          style={{
            background: HL_PAPER,
            borderRadius: 6,
            padding: '32px 36px 38px 36px',
            boxShadow: '0 40px 90px rgba(0, 0, 0, 0.65)',
            transform: `translate3d(0, ${cardY.toFixed(1)}px, 0) scale(${cardScale.toFixed(4)}) rotateX(${cardRotX.toFixed(2)}deg) rotateY(${cardRotY.toFixed(2)}deg) rotateZ(${cardRotZ.toFixed(2)}deg)`,
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          <EditorialMasthead category={t.badge || 'KEY EXCERPT · จับใจความ'} compact />

          {/* Article Headline */}
          <FitText
            text={t.title || 'ข้อความสำคัญที่ต้องขีดเส้นใต้'}
            baseSize={42}
            minSize={26}
            maxLines={2}
            color={HL_INK}
            fontWeight={800}
            align="left"
            lineHeight={1.32}
          />

          {/* Subtle hairline before paragraph */}
          <div style={{ height: 1.5, background: HL_RULE }} />

          {/* Highlighted Body Lines — sequential line-by-line scaleX sweep with brief human pause */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {lines.map((line, idx) => {
              const startF = 12 + idx * 18;
              const sweepDur = 14;
              const prog = clamp01((localFrame - startF) / sweepDur);
              const isKeyLine = idx === lines.length - 1 || idx === 0;

              return (
                <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  <div
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 16,
                      fontWeight: 700,
                      color: HL_MUTED,
                      paddingTop: 12,
                      flexShrink: 0,
                      width: 30,
                    }}
                  >
                    {pad2J(idx + 1)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <LimeHighlighterSweep progress={prog} doublePass={isKeyLine} seed={idx + 5}>
                      <FitText
                        text={line}
                        baseSize={31}
                        minSize={21}
                        maxLines={3}
                        color={HL_BODY}
                        fontWeight={isKeyLine ? 700 : 600}
                        align="left"
                        lineHeight={1.42}
                      />
                    </LimeHighlighterSweep>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Editorial Margin Note Footer */}
          <div
            style={{
              marginTop: 8,
              paddingTop: 14,
              borderTop: `1px solid ${HL_RULE}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              opacity: appear(localFrame, 28, 14),
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 16, height: 16, background: HL_LIME, border: `1px solid ${HL_LIME_DEEP}` }} />
              <span style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: 700, color: HL_MUTED }}>
                HIGHLIGHTED PASSAGE · {lines.length} LINES
              </span>
            </div>
            <div style={{ maxWidth: 320 }}>
              <FitText
                text={scene.source || 'ARCHIVE COPY'}
                baseSize={17}
                minSize={14}
                maxLines={1}
                color={HL_MUTED}
                fontWeight={600}
                align="right"
                lineHeight={1.3}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// look-32 Shot 3: evidence-post-pop
// Background tilted article context + foreground Verified White Post Card popping with spring overshoot
// ----------------------------------------------------------------------------
const Look32EvidencePostPop: React.FC<StyleShotArgs> = ({
  scene,
  localFrame,
  fps,
}) => {
  const t = sceneTexts(scene);
  const pts = extractPointsJ(scene, 3);
  const postBody = scene.quote?.text?.trim() || t.subtitle || pts[0] || t.title;
  const authorName = scene.quote?.author?.trim() || scene.source?.trim() || 'ทีมข่าวตรวจสอบข้อเท็จจริง';
  const authorRole = scene.quote?.role?.trim() || '@verified_chronicle · แหล่งอ้างอิงยืนยันแล้ว';
  const keyTakeaway =
    (Array.isArray(scene.highlight) ? scene.highlight[0] : String(scene.highlight || '').trim()) ||
    pts[1] ||
    (scene.quote?.text ? t.subtitle : '') ||
    'ยืนยันข้อมูลจากแหล่งอ้างอิงหลัก';

  // Background context article enters swiftly and settles tilted left
  const bgSpring = spring({
    frame: localFrame,
    fps,
    config: { damping: 16, stiffness: 110, mass: 1.1 },
  });
  const bgY = interpolate(bgSpring, [0, 1], [120, 0]);
  const bgHl = clamp01((localFrame - 8) / 14);

  // Foreground Evidence Post pops with heavy spring overshoot (tilt settles 1 beat after scale)
  const popDelay = 14;
  const popScaleSp = spring({
    frame: Math.max(0, localFrame - popDelay),
    fps,
    config: { damping: 11, stiffness: 175, mass: 0.92 },
  });
  const popTiltSp = spring({
    frame: Math.max(0, localFrame - (popDelay + 4)),
    fps,
    config: { damping: 10, stiffness: 115, mass: 1.1 },
  });
  const postVisible = localFrame >= popDelay;
  const popScale = postVisible ? interpolate(popScaleSp, [0, 1], [0.68, 1.0]) : 0.68;
  const popY = postVisible ? interpolate(popScaleSp, [0, 1], [160, 0]) : 160;
  const popRot = postVisible ? interpolate(popTiltSp, [0, 1], [8.2, 1.6]) : 8.2;

  const takeawayHl = clamp01((localFrame - 34) / 16);

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden', background: HL_BG }}>
      <BlurredArticleWallBackdrop localFrame={localFrame} />

      {/* Background Recessed Article Sheet (upper-left tilt, y: 128..560) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X + 12,
          top: SAFE_TOP + 16,
          width: SAFE_W - 76,
          zIndex: 8,
          transform: `translate3d(0, ${bgY.toFixed(1)}px, 0) rotate(-3.2deg)`,
          opacity: 0.92,
        }}
      >
        <div
          style={{
            background: HL_PAPER,
            borderRadius: 6,
            padding: '26px 32px 34px 32px',
            boxShadow: '0 24px 56px rgba(0, 0, 0, 0.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <EditorialMasthead category={t.badge || 'SOURCE RECEIPT · หลักฐานอ้างอิง'} compact />
          <FitText
            text={t.title || 'ประเด็นอ้างอิงจากเอกสารข่าว'}
            baseSize={34}
            minSize={22}
            maxLines={2}
            color={HL_INK}
            fontWeight={800}
            align="left"
            lineHeight={1.32}
          />
          <LimeHighlighterSweep progress={bgHl} seed={21}>
            <div style={{ height: 18, width: '78%' }} />
          </LimeHighlighterSweep>
        </div>
      </div>

      {/* Foreground Verified White Evidence Post Card (y: 430..1360) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X + 24,
          top: 436,
          width: SAFE_W - 48,
          zIndex: 18,
          opacity: postVisible ? clamp01((localFrame - popDelay) / 6) : 0,
          transform: `translate3d(0, ${popY.toFixed(1)}px, 0) scale(${popScale.toFixed(4)}) rotate(${popRot.toFixed(2)}deg)`,
          transformOrigin: 'center center',
        }}
      >
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 22,
            padding: '38px 40px 36px 40px',
            boxShadow: '0 44px 100px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(22, 24, 27, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          {/* Post Header: Avatar + Author + Blue Verified Checkmark */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                background: HL_INK,
                color: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: FONT_MONO,
                fontSize: 22,
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              VR
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <FitText
                    text={authorName}
                    baseSize={30}
                    minSize={20}
                    maxLines={1}
                    color={HL_INK}
                    fontWeight={800}
                    align="left"
                    lineHeight={1.3}
                  />
                </div>
                <VerifiedBadgeIcon size={26} />
              </div>
              <FitText
                text={authorRole}
                baseSize={20}
                minSize={15}
                maxLines={1}
                color={HL_MUTED}
                fontWeight={500}
                align="left"
                lineHeight={1.32}
              />
            </div>
          </div>

          {/* Main Quoted Evidence Statement */}
          <div style={{ paddingTop: 4, paddingBottom: 4 }}>
            <FitText
              text={`“${postBody}”`}
              baseSize={40}
              minSize={24}
              maxLines={5}
              color={HL_INK}
              fontWeight={700}
              align="left"
              lineHeight={1.44}
            />
          </div>

          {/* Highlighted Takeaway Strip inside post */}
          {keyTakeaway && (
            <div
              style={{
                background: HL_PAPER,
                borderRadius: 10,
                padding: '12px 14px',
                border: `1px solid ${HL_RULE}`,
              }}
            >
              <LimeHighlighterSweep progress={takeawayHl} doublePass seed={33}>
                <FitText
                  text={keyTakeaway}
                  baseSize={26}
                  minSize={19}
                  maxLines={2}
                  color={HL_INK}
                  fontWeight={700}
                  align="left"
                  lineHeight={1.38}
                />
              </LimeHighlighterSweep>
            </div>
          )}

          {/* Post Footer Metadata */}
          <div
            style={{
              borderTop: `1px solid ${HL_RULE}`,
              paddingTop: 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontFamily: FONT_MONO,
              fontSize: 15,
              color: HL_MUTED,
            }}
          >
            <span>VERIFIED CITATION · PUBLIC RECORD</span>
            <span style={{ color: HL_BLUE, fontWeight: 700 }}>CONFIRMED ✓</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// look-32 Shot 4: clipping-compare
// Dual newspaper clippings comparison OR highlighted Stat + Delta evidence clippings
// ----------------------------------------------------------------------------
const Look32ClippingCompare: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  fps,
}) => {
  const t = sceneTexts(scene);
  const useStatMode = Boolean(scene.stat) && !scene.compare;
  const metric = extractPrimaryMetricJ(scene, sceneIndex, 74, '');
  const pair = extractComparePairJ(scene, 'ข้อมูลเดิม / ก่อนหน้า', 'ข้อเท็จจริงล่าสุด');
  const pts = extractPointsJ(scene, 3);

  const topHeaderP = appear(localFrame, 0, 14);
  const clip1Sp = spring({
    frame: Math.max(0, localFrame - 4),
    fps,
    config: { damping: 14, stiffness: 120, mass: 1.15 },
  });
  const clip2Sp = spring({
    frame: Math.max(0, localFrame - 16),
    fps,
    config: { damping: 13, stiffness: 130, mass: 1.1 },
  });

  const clip1Y = interpolate(clip1Sp, [0, 1], [160, 0]);
  const clip2Y = interpolate(clip2Sp, [0, 1], [220, 0]);
  const statCount = easeOutCubic(clamp01((localFrame - 10) / 26));
  const hlTop = clamp01((localFrame - 20) / 16);
  const hlBottom = clamp01((localFrame - 34) / 18);

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden', background: HL_BG }}>
      <BlurredArticleWallBackdrop localFrame={localFrame} />

      {/* Top Editorial Header on Dark Backdrop (y: 116..268) */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_X + 10,
          top: SAFE_TOP + 6,
          width: SAFE_W - 20,
          zIndex: 12,
          opacity: topHeaderP,
          transform: `translate3d(0, ${(1 - topHeaderP) * 18}px, 0)`,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ background: HL_RED, padding: '4px 12px', borderRadius: 2 }}>
            <FitText
              text={t.badge || (useStatMode ? 'DATA RECEIPT · ตัวเลขสำคัญ' : 'SIDE-BY-SIDE · เทียบหลักฐาน')}
              baseSize={19}
              minSize={15}
              maxLines={1}
              color="#FFFFFF"
              fontWeight={700}
              align="left"
              lineHeight={1.3}
            />
          </div>
        </div>
        <FitText
          text={t.title || 'เปรียบเทียบข้อเท็จจริงจากหลักฐาน'}
          baseSize={42}
          minSize={26}
          maxLines={2}
          color={HL_PAPER}
          fontWeight={800}
          align="left"
          lineHeight={1.32}
        />
      </div>

      {useStatMode ? (
        <>
          {/* STAT CLIPPING 1 (Upper Paper, tilted -1.6deg, y: 296..790) */}
          <div
            style={{
              position: 'absolute',
              left: SAFE_X + 18,
              top: 304,
              width: SAFE_W - 36,
              zIndex: 14,
              transform: `translate3d(0, ${clip1Y.toFixed(1)}px, 0) rotate(-1.6deg)`,
            }}
          >
            <div
              style={{
                background: HL_PAPER,
                borderRadius: 6,
                padding: '30px 36px 34px 36px',
                boxShadow: '0 34px 80px rgba(0, 0, 0, 0.62)',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: `2px solid ${HL_INK}`,
                  paddingBottom: 10,
                }}
              >
                <span style={{ fontFamily: FONT_SERIF, fontSize: 22, fontWeight: 800, color: HL_INK }}>
                  STATISTICAL CLIPPING
                </span>
                <span style={{ fontFamily: FONT_MONO, fontSize: 13, color: HL_MUTED }}>FIG. 01</span>
              </div>

              {/* Giant Stat slashed across with double-pass lime highlighter */}
              <LimeHighlighterSweep progress={hlTop} doublePass seed={41}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
                  <FitText
                    text={formatAnimatedStatJ(metric, statCount)}
                    baseSize={106}
                    minSize={54}
                    maxLines={1}
                    color={HL_INK}
                    fontWeight={900}
                    align="left"
                    lineHeight={1.16}
                  />
                  {metric.unit && (
                    <FitText
                      text={metric.unit}
                      baseSize={34}
                      minSize={22}
                      maxLines={1}
                      color={HL_BODY}
                      fontWeight={700}
                      align="left"
                      lineHeight={1.3}
                    />
                  )}
                </div>
              </LimeHighlighterSweep>

              <FitText
                text={metric.label || t.subtitle || t.title}
                baseSize={32}
                minSize={22}
                maxLines={2}
                color={HL_BODY}
                fontWeight={700}
                align="left"
                lineHeight={1.38}
              />
            </div>
          </div>

          {/* DELTA / EVIDENCE CLIPPING 2 (Lower White Post Card, tilted +1.5deg, y: 846..1370) */}
          <div
            style={{
              position: 'absolute',
              left: SAFE_X + 26,
              top: 846,
              width: SAFE_W - 52,
              zIndex: 18,
              opacity: clamp01((localFrame - 14) / 8),
              transform: `translate3d(0, ${clip2Y.toFixed(1)}px, 0) rotate(1.5deg)`,
            }}
          >
            <div
              style={{
                background: '#FFFFFF',
                borderRadius: 16,
                padding: '30px 34px 32px 34px',
                boxShadow: '0 36px 84px rgba(0, 0, 0, 0.66)',
                display: 'flex',
                flexDirection: 'column',
                gap: 18,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <VerifiedBadgeIcon size={24} />
                  <span style={{ fontFamily: FONT_MONO, fontSize: 15, fontWeight: 700, color: HL_INK }}>
                    DELTA &amp; VERIFICATION
                  </span>
                </div>
                <span style={{ fontFamily: FONT_MONO, fontSize: 13, color: HL_MUTED }}>CROSS-CHECKED</span>
              </div>

              <LimeHighlighterSweep progress={hlBottom} seed={47}>
                <FitText
                  text={metric.delta || t.subtitle || pts[0] || 'ตัวเลขเปลี่ยนแปลงอย่างมีนัยสำคัญ'}
                  baseSize={34}
                  minSize={22}
                  maxLines={2}
                  color={HL_INK}
                  fontWeight={800}
                  align="left"
                  lineHeight={1.38}
                />
              </LimeHighlighterSweep>

              {pts[0] && pts[0] !== metric.delta && (
                <div style={{ borderTop: `1px solid ${HL_RULE}`, paddingTop: 14 }}>
                  <FitText
                    text={pts[0]}
                    baseSize={25}
                    minSize={18}
                    maxLines={2}
                    color={HL_BODY}
                    fontWeight={500}
                    align="left"
                    lineHeight={1.4}
                  />
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* COMPARE CLIPPING 1 (Upper Paper — Before / Claim, tilted -1.7deg, y: 298..780) */}
          <div
            style={{
              position: 'absolute',
              left: SAFE_X + 16,
              top: 298,
              width: SAFE_W - 32,
              zIndex: 14,
              transform: `translate3d(0, ${clip1Y.toFixed(1)}px, 0) rotate(-1.7deg)`,
            }}
          >
            <div
              style={{
                background: HL_PAPER,
                borderRadius: 6,
                padding: '26px 32px 30px 32px',
                boxShadow: '0 30px 72px rgba(0, 0, 0, 0.58)',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: `2px solid ${HL_RULE}`,
                  paddingBottom: 10,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={pair.leftTitle}
                    baseSize={28}
                    minSize={20}
                    maxLines={1}
                    color={HL_MUTED}
                    fontWeight={800}
                    align="left"
                    lineHeight={1.3}
                  />
                </div>
                <span style={{ fontFamily: FONT_MONO, fontSize: 13, color: HL_MUTED, flexShrink: 0 }}>CLIPPING A</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {pair.leftItems.slice(0, 2).map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: '8px 10px',
                      background: 'rgba(217, 219, 222, 0.36)',
                      borderRadius: 4,
                    }}
                  >
                    <span style={{ fontFamily: FONT_MONO, fontSize: 16, fontWeight: 700, color: HL_MUTED, paddingTop: 4 }}>
                      —
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <FitText
                        text={item}
                        baseSize={27}
                        minSize={19}
                        maxLines={2}
                        color={HL_BODY}
                        fontWeight={600}
                        align="left"
                        lineHeight={1.38}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* COMPARE CLIPPING 2 (Lower Paper — Verified / Highlighted, tilted +1.6deg, y: 816..1380) */}
          <div
            style={{
              position: 'absolute',
              left: SAFE_X + 20,
              top: 816,
              width: SAFE_W - 40,
              zIndex: 18,
              opacity: clamp01((localFrame - 14) / 8),
              transform: `translate3d(0, ${clip2Y.toFixed(1)}px, 0) rotate(1.6deg)`,
            }}
          >
            <div
              style={{
                background: '#FFFFFF',
                borderRadius: 8,
                padding: '28px 34px 32px 34px',
                boxShadow: '0 38px 88px rgba(0, 0, 0, 0.68)',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: `2px solid ${HL_INK}`,
                  paddingBottom: 10,
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                  <VerifiedBadgeIcon size={24} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <FitText
                      text={pair.rightTitle}
                      baseSize={29}
                      minSize={20}
                      maxLines={1}
                      color={HL_INK}
                      fontWeight={800}
                      align="left"
                      lineHeight={1.3}
                    />
                  </div>
                </div>
                <span style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 700, color: HL_BLUE, flexShrink: 0 }}>
                  CLIPPING B
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {pair.rightItems.slice(0, 2).map((item, idx) => (
                  <LimeHighlighterSweep
                    key={idx}
                    progress={idx === 0 ? hlTop : hlBottom}
                    doublePass={idx === 0}
                    seed={60 + idx}
                  >
                    <FitText
                      text={item}
                      baseSize={29}
                      minSize={20}
                      maxLines={2}
                      color={HL_INK}
                      fontWeight={700}
                      align="left"
                      lineHeight={1.4}
                    />
                  </LimeHighlighterSweep>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ============================================================================
// EXPORTED REGISTRY DEFINITIONS — BATCH_J (look-30, look-32)
// ============================================================================

export const BATCH_J: StyleDirectorDef[] = [
  {
    styleId: 'look-30',
    caption: 'floating',
    shots: {
      'ink-landscape-title': Look30InkLandscapeTitle,
      'scroll-unroll-steps': Look30ScrollUnrollSteps,
      'enso-stat': Look30EnsoStat,
      'seal-quote': Look30SealQuote,
    },
    shotLabels: {
      'ink-landscape-title':
        'ทิวเขาหมึกจีน 3 ชั้นวาดตัวเองบนกระดาษสา พร้อมดวงอาทิตย์แดง หน้าผาต้นสน เรือลอยน้ำ หัวข้อแนวตั้ง 2 คอลัมน์ และตราประทับแดง',
      'scroll-unroll-steps':
        'ม้วนภาพพู่กันคลี่ลงบนกระดาษสาพร้อมเส้นหมึกเชื่อมลำดับขั้นตอนและหมุดวงกลมพู่กันทีละขั้น',
      'enso-stat':
        'วงเอนโซ (Ensō) ตวัดพู่กันหมึกดำรอบตัวเลขสถิติขนาดใหญ่ พร้อมตราประทับแดงและคำอธิบายด้านล่าง',
      'seal-quote':
        'คำคมบนกระดาษสาประดับกิ่งไผ่หมึกจางและตราประทับสีแดงกดลงท้ายประโยคอย่างสงบ',
    },
    infer: (scene) => {
      if (scene.quote?.text) {
        return 'seal-quote';
      }
      if (scene.stat) {
        return 'enso-stat';
      }
      if (Array.isArray(scene.steps) && scene.steps.length >= 3) {
        return 'scroll-unroll-steps';
      }
      const text = haystackOfJ(scene);
      if (J_INK_CULTURE_RE.test(text)) {
        return 'ink-landscape-title';
      }
      return null;
    },
  },
  {
    styleId: 'look-32',
    caption: 'bar',
    shots: {
      'tilted-article-flyin': Look32TiltedArticleFlyin,
      'highlight-sweep': Look32HighlightSweep,
      'evidence-post-pop': Look32EvidencePostPop,
      'clipping-compare': Look32ClippingCompare,
    },
    shotLabels: {
      'tilted-article-flyin':
        'หน้าบทความข่าวบินเข้าแบบเอียง 3D บนกำแพงบทความเบลอที่ลอยช้าๆ พร้อมไฮไลต์เขียวมะนาวและการ์ดโพสต์ยืนยันมุมล่างขวา',
      'highlight-sweep':
        'ดอลลี่ซูมเข้าหาย่อหน้าสำคัญของบทความแล้วปาดไฮไลต์เขียวมะนาวทีละบรรทัดจากซ้ายไปขวาด้วยโหมด multiply',
      'evidence-post-pop':
        'การ์ดโพสต์อ้างอิงสีขาวพร้อมเครื่องหมายยืนยันสีฟ้าเด้งขึ้นหน้าบทความด้วยสปริงเพื่อโชว์หลักฐานคำพูด',
      'clipping-compare':
        'ข่าวตัด 2 ชิ้นวางเอียงเปรียบเทียบกัน หรือการ์ดตัวเลขสถิติพร้อม delta ที่ถูกปาดไฮไลต์เขียวมะนาว',
    },
    infer: (scene) => {
      if (scene.quote?.text) {
        return 'evidence-post-pop';
      }
      if (scene.compare || scene.stat) {
        return 'clipping-compare';
      }
      const text = haystackOfJ(scene);
      if ((Array.isArray(scene.bullets) && scene.bullets.length >= 2) || J_NEWS_EVIDENCE_RE.test(text)) {
        return 'highlight-sweep';
      }
      return null;
    },
  },
];
