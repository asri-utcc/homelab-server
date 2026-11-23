import type { SubtitleCue } from '../components/SubtitleBar';
import type { WordBoundary } from '../components/fx/KaraokeSubtitle';

export type { SubtitleCue, WordBoundary };

export type LayoutFamily =
  | 'glow-world'
  | 'editorial-paper'
  | 'data-board'
  | 'kinetic-type'
  | 'iso-3d'
  | 'documentary-card'
  | 'flat-cartoon';

export type BgTreatment =
  | 'gradient'
  | 'grid'
  | 'paper'
  | 'starfield'
  | 'noise'
  | 'spotlight'
  | 'flat';

export type SceneVisualType =
  | 'title'
  | 'bullets'
  | 'stat'
  | 'steps'
  | 'compare'
  | 'quote'
  | 'image'
  | 'icon';

export type TransitionType =
  | 'fade'
  | 'slide'
  | 'zoom'
  | 'wipe'
  | 'lightLeak'
  | 'iris'
  | 'spring'
  | 'cut';

export type SubtitleMode = 'floating' | 'bar' | 'karaoke' | 'none';

export interface StylePalette {
  bg: string;
  bg2?: string;
  bgSecondary?: string;
  surface?: string;
  cardBg?: string;
  fg?: string;
  text?: string;
  muted?: string;
  accent: string;
  accent2?: string;
  border?: string;
}

export interface StyleSubtitleConfig {
  mode: SubtitleMode;
  accentColor?: string;
  theme?: 'light' | 'dark';
}

export interface StyleTokens {
  id?: string;
  name?: string;
  family: LayoutFamily;
  palette: StylePalette;
  bgTreatment?: BgTreatment;
  motionIntensity?: number;
  transition?: TransitionType;
  subtitle?: StyleSubtitleConfig;
  cardRadius?: number;
  vignette?: number;
  grain?: number;
  glowIntensity?: number;
  // Optional compatibility fields for preset catalogs (studio_style_presets.json)
  typography?: {
    fontFamily?: string;
    titleWeight?: number;
    subtitleStyle?: string;
    useLoopedThai?: boolean;
  };
  motion?: {
    springDamping?: number;
    springStiffness?: number;
    transitionType?: string;
    parallaxStrength?: number;
    glowIntensity?: number;
  };
  background?: {
    pattern?: string;
    vignette?: number;
    grain?: number;
  };
  promptHints?: string;
}

export interface ResolvedStyleTokens {
  family: LayoutFamily;
  palette: {
    bg: string;
    bg2: string;
    surface: string;
    fg: string;
    muted: string;
    accent: string;
    accent2: string;
    accentReadable: string;
    accentOnFill: string;
    border: string;
  };
  isLight: boolean;
  bgTreatment: BgTreatment;
  motionIntensity: number;
  springConfig: {
    damping: number;
    stiffness: number;
    mass: number;
  };
  transition: TransitionType;
  subtitle: {
    mode: SubtitleMode;
    accentColor: string;
    theme: 'light' | 'dark';
  };
  cardRadius: number;
  vignette: number;
  grain: number;
  glowIntensity: number;
  useLoopedThai: boolean;
  typography: {
    fontFamily: string;
    titleWeight: number;
  };
}

export interface StudioStatData {
  value: string | number;
  numericValue?: number;
  prefix?: string;
  suffix?: string;
  unit?: string;
  label: string;
  delta?: string;
  progress?: number; // 0..100
}

export interface StudioStepItem {
  step?: string;
  title: string;
  detail?: string;
}

export interface StudioCompareData {
  leftTitle: string;
  leftItems: string[];
  rightTitle: string;
  rightItems: string[];
  leftLabel?: string;
  rightLabel?: string;
  winner?: 'left' | 'right';
}

export interface StudioQuoteData {
  text: string;
  author?: string;
  role?: string;
  source?: string;
}

export interface StudioScene {
  id: string;
  index?: number;
  badge?: string;
  title: string;
  subtitle?: string;
  highlight?: string | string[];
  narration?: string;
  source?: string;
  startFrame: number;
  endFrame: number;
  durationFrames?: number;
  speechStartSec?: number;
  cues?: SubtitleCue[];
  wordBoundaries?: WordBoundary[];

  // Optional per-scene layout family override (defaults to props.style.family)
  family?: LayoutFamily;

  // Visual type & data
  visual?: SceneVisualType | { type: SceneVisualType; [key: string]: unknown };
  bullets?: string[];
  stat?: StudioStatData;
  steps?: Array<string | StudioStepItem>;
  compare?: StudioCompareData;
  quote?: StudioQuoteData;
  imageUrl?: string;
  imageCaption?: string;
  imageCredit?: string;
  icon?: string;
}

export type StudioProps = {
  title: string;
  fps?: number;
  width?: number;
  height?: number;
  totalFrames: number;
  styleId?: string;
  style: StyleTokens;
  scenes: StudioScene[];
  cues?: SubtitleCue[];
};

// ============================================================================
// COLOR & CONTRAST UTILITIES (Deterministic, Zero External Deps)
// ============================================================================

const HEX6_RE = /^#([0-9a-fA-F]{6})$/;
const HEX3_RE = /^#([0-9a-fA-F]{3})$/;

export function normalizeHex(color: string | undefined, fallback: string): string {
  if (!color || typeof color !== 'string') return fallback;
  const trimmed = color.trim();
  if (HEX6_RE.test(trimmed)) return trimmed.toUpperCase();
  const m3 = HEX3_RE.exec(trimmed);
  if (m3) {
    const [r, g, b] = m3[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback;
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = normalizeHex(hex, '#1E293B').slice(1);
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  const clamped = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${clamped.toFixed(3)})`;
}

export function shadeHex(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const nr = factor >= 1 ? r + (255 - r) * (factor - 1) : r * factor;
  const ng = factor >= 1 ? g + (255 - g) * (factor - 1) : g * factor;
  const nb = factor >= 1 ? b + (255 - b) * (factor - 1) : b * factor;
  const toHex = (v: number) => clampByte(v).toString(16).padStart(2, '0');
  return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`.toUpperCase();
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const chan = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ============================================================================
// STYLE TOKENS NORMALIZATION & RESOLUTION
// ============================================================================

const VALID_FAMILIES: readonly LayoutFamily[] = [
  'glow-world',
  'editorial-paper',
  'data-board',
  'kinetic-type',
  'iso-3d',
  'documentary-card',
  'flat-cartoon',
];

const VALID_BG_TREATMENTS: readonly BgTreatment[] = [
  'gradient',
  'grid',
  'paper',
  'starfield',
  'noise',
  'spotlight',
  'flat',
];

const VALID_TRANSITIONS: readonly TransitionType[] = [
  'fade',
  'slide',
  'zoom',
  'wipe',
  'lightLeak',
  'iris',
  'spring',
  'cut',
];

const VALID_VISUALS: readonly SceneVisualType[] = [
  'title',
  'bullets',
  'stat',
  'steps',
  'compare',
  'quote',
  'image',
  'icon',
];

function defaultBgForFamily(family: LayoutFamily): BgTreatment {
  switch (family) {
    case 'glow-world':
      return 'starfield';
    case 'editorial-paper':
      return 'paper';
    case 'data-board':
      return 'grid';
    case 'kinetic-type':
      return 'spotlight';
    case 'iso-3d':
      return 'grid';
    case 'documentary-card':
      return 'noise';
    case 'flat-cartoon':
      return 'flat';
  }
}

function mapPatternToBgTreatment(pattern: string | undefined, isLight: boolean, family: LayoutFamily): BgTreatment {
  switch (pattern) {
    case 'flat':
      return 'flat';
    case 'grid':
    case 'lines':
      return 'grid';
    case 'radial':
      return family === 'glow-world' ? 'starfield' : 'spotlight';
    case 'noise':
      return 'noise';
    case 'dots':
      return isLight ? 'paper' : 'starfield';
    case 'none':
      return family === 'flat-cartoon' ? 'flat' : 'gradient';
    default:
      return defaultBgForFamily(family);
  }
}

function mapSubtitleMode(raw?: StyleTokens): SubtitleMode {
  const direct = raw?.subtitle?.mode;
  if (direct === 'floating' || direct === 'bar' || direct === 'karaoke' || direct === 'none') {
    return direct;
  }
  switch (raw?.typography?.subtitleStyle) {
    case 'minimal':
      return 'floating';
    case 'pill':
    case 'bold-bar':
      return 'bar';
    case 'karaoke':
      return 'karaoke';
    case 'none':
      return 'none';
    default:
      return raw?.family === 'flat-cartoon' ? 'bar' : 'floating';
  }
}

export function normalizeSceneVisual(scene: StudioScene): SceneVisualType {
  if (typeof scene.visual === 'string' && VALID_VISUALS.includes(scene.visual)) {
    return scene.visual;
  }
  if (scene.visual && typeof scene.visual === 'object' && typeof scene.visual.type === 'string') {
    const t = scene.visual.type as SceneVisualType;
    if (VALID_VISUALS.includes(t)) return t;
  }
  if (scene.stat) return 'stat';
  if (scene.compare) return 'compare';
  if (scene.steps && scene.steps.length > 0) return 'steps';
  if (scene.quote) return 'quote';
  if (scene.imageUrl) return 'image';
  if (scene.bullets && scene.bullets.length > 0) return 'bullets';
  if (scene.icon) return 'icon';
  return 'title';
}

export function resolveStyleTokens(raw?: Partial<StyleTokens> | ResolvedStyleTokens): ResolvedStyleTokens {
  const family: LayoutFamily =
    raw?.family && VALID_FAMILIES.includes(raw.family) ? raw.family : 'editorial-paper';

  const p = (raw?.palette || {}) as Partial<StylePalette>;
  const bg = normalizeHex(
    p.bg,
    family === 'flat-cartoon'
      ? '#E3EDF6'
      : family === 'editorial-paper'
        ? '#F6F1E7'
        : '#0E1226',
  );
  const isLight = family === 'flat-cartoon' ? true : relativeLuminance(bg) > 0.42;

  const bg2 = normalizeHex(
    p.bg2 || p.bgSecondary,
    family === 'flat-cartoon'
      ? '#CFE0F0'
      : isLight
        ? shadeHex(bg, 0.93)
        : shadeHex(bg, 1.18),
  );
  const surface = normalizeHex(
    p.surface || p.cardBg,
    isLight ? '#FFFFFF' : shadeHex(bg, 1.22),
  );
  let fg = normalizeHex(
    p.fg || p.text,
    family === 'flat-cartoon' ? '#2B2452' : isLight ? '#171A26' : '#F8FAFC',
  );
  // Enforce strong readability if fg/bg contrast is weak
  if (contrastRatio(fg, bg) < 4.5) {
    fg = family === 'flat-cartoon' ? '#2B2452' : isLight ? '#141724' : '#F8FAFC';
  }

  let muted = normalizeHex(
    p.muted,
    family === 'flat-cartoon' ? '#5A5882' : isLight ? '#52586B' : '#A6B4D0',
  );
  if (contrastRatio(muted, bg) < 3.0) {
    muted = family === 'flat-cartoon' ? '#4C4875' : isLight ? '#4A5164' : '#B5C2DC';
  }

  const accentRaw = normalizeHex(
    p.accent,
    family === 'flat-cartoon' ? '#30ABD5' : isLight ? '#C96228' : '#3BE3C6',
  );
  const accent2Raw = normalizeHex(
    p.accent2,
    family === 'flat-cartoon' ? '#DF1690' : isLight ? '#2563EB' : '#FFD166',
  );

  // Ensure readable accent color against bg & surface (protects against dark-on-dark presets
  // and keeps flat-cartoon colors from falling back to editorial brick-orange)
  let accentReadable = accentRaw;
  if (contrastRatio(accentReadable, bg) < 3.2) {
    if (contrastRatio(accent2Raw, bg) >= 3.2) {
      accentReadable = accent2Raw;
    } else if (family === 'flat-cartoon') {
      accentReadable = '#352A6E';
    } else {
      accentReadable = isLight ? '#C2531F' : '#FFD166';
    }
  }
  const accent2 =
    contrastRatio(accent2Raw, bg) >= 2.6
      ? accent2Raw
      : family === 'flat-cartoon'
        ? '#DF1690'
        : isLight
          ? '#2563EB'
          : '#3BE3C6';

  const accentOnFill = relativeLuminance(accentReadable) > 0.44 ? '#0F172A' : '#FFFFFF';
  const border = normalizeHex(
    p.border,
    family === 'flat-cartoon' ? '#2B2452' : isLight ? '#D9CEBC' : '#2D3A64',
  );

  const bgTreatment: BgTreatment =
    raw?.bgTreatment && VALID_BG_TREATMENTS.includes(raw.bgTreatment)
      ? raw.bgTreatment
      : mapPatternToBgTreatment((raw as StyleTokens | undefined)?.background?.pattern, isLight, family);

  const rawIntensity =
    typeof raw?.motionIntensity === 'number' && Number.isFinite(raw.motionIntensity)
      ? raw.motionIntensity
      : typeof (raw as StyleTokens | undefined)?.motion?.parallaxStrength === 'number'
        ? 0.6 + ((raw as StyleTokens).motion!.parallaxStrength ?? 0.4) * 0.7
        : 1.0;
  const motionIntensity = Math.max(0.25, Math.min(1.6, rawIntensity));

  const m = (raw as StyleTokens | undefined)?.motion;
  const damping = m?.springDamping ?? (family === 'flat-cartoon' ? 14 : Math.round(18 - (motionIntensity - 0.8) * 5));
  const stiffness = m?.springStiffness ?? (family === 'flat-cartoon' ? 180 : Math.round(140 + motionIntensity * 45));

  const rawTrans = raw?.transition || (m?.transitionType as TransitionType | undefined);
  const transition: TransitionType =
    rawTrans && VALID_TRANSITIONS.includes(rawTrans)
      ? rawTrans
      : family === 'glow-world'
        ? 'lightLeak'
        : family === 'kinetic-type'
          ? 'slide'
          : family === 'flat-cartoon'
            ? 'spring'
            : 'fade';

  const subMode = mapSubtitleMode(raw as StyleTokens | undefined);
  const subAccent = normalizeHex(raw?.subtitle?.accentColor, accentReadable);
  const subTheme: 'light' | 'dark' = raw?.subtitle?.theme ?? (isLight ? 'light' : 'dark');

  const cardRadius =
    typeof raw?.cardRadius === 'number'
      ? raw.cardRadius
      : family === 'editorial-paper'
        ? 14
        : family === 'kinetic-type'
          ? 16
          : family === 'data-board' || family === 'flat-cartoon'
            ? 20
            : family === 'documentary-card'
              ? 22
              : 28;

  const vignette =
    typeof raw?.vignette === 'number'
      ? raw.vignette
      : typeof (raw as StyleTokens | undefined)?.background?.vignette === 'number'
        ? (raw as StyleTokens).background!.vignette!
        : family === 'flat-cartoon'
          ? 0
          : isLight
            ? 0.14
            : 0.42;

  const grain =
    typeof raw?.grain === 'number'
      ? raw.grain
      : typeof (raw as StyleTokens | undefined)?.background?.grain === 'number'
        ? (raw as StyleTokens).background!.grain!
        : family === 'flat-cartoon'
          ? 0
          : family === 'editorial-paper' || family === 'documentary-card'
            ? 0.14
            : 0.06;

  const glowIntensity =
    typeof raw?.glowIntensity === 'number'
      ? raw.glowIntensity
      : typeof m?.glowIntensity === 'number'
        ? m.glowIntensity
        : family === 'flat-cartoon'
          ? 0
          : family === 'glow-world'
            ? 0.78
            : isLight
              ? 0.08
              : 0.32;

  const useLoopedThai = false;
  const rawTypo = (raw as StyleTokens | undefined)?.typography;
  const fontFamily =
    rawTypo?.fontFamily && rawTypo.fontFamily.trim().length > 0
      ? rawTypo.fontFamily
      : "'Noto Sans Thai', 'Noto Looped Thai', sans-serif";
  const titleWeight =
    typeof rawTypo?.titleWeight === 'number' && Number.isFinite(rawTypo.titleWeight)
      ? rawTypo.titleWeight
      : 800;

  return {
    family,
    palette: {
      bg,
      bg2,
      surface,
      fg,
      muted,
      accent: family === 'flat-cartoon' ? accentRaw : accentReadable,
      accent2,
      accentReadable,
      accentOnFill,
      border,
    },
    isLight,
    bgTreatment,
    motionIntensity,
    springConfig: {
      damping: Math.max(8, Math.min(30, damping)),
      stiffness: Math.max(70, Math.min(320, stiffness)),
      mass: 0.78,
    },
    transition,
    subtitle: {
      mode: subMode,
      accentColor: subAccent,
      theme: subTheme,
    },
    cardRadius,
    vignette: Math.max(0, Math.min(1, vignette)),
    grain: Math.max(0, Math.min(1, grain)),
    glowIntensity: Math.max(0, Math.min(1, glowIntensity)),
    useLoopedThai,
    typography: {
      fontFamily,
      titleWeight,
    },
  };
}

// ============================================================================
// DEFAULT PROPS (3 scenes, 240 frames, family 'editorial-paper')
// ============================================================================

export const DEFAULT_STYLE_TOKENS: StyleTokens = {
  id: 'editorial-paper-default',
  name: 'Editorial Paper',
  family: 'editorial-paper',
  palette: {
    bg: '#F6F1E7',
    bg2: '#EAE0CE',
    surface: '#FFFDF8',
    fg: '#171A26',
    muted: '#575B6B',
    accent: '#C96228',
    accent2: '#2B5B84',
    border: '#D6C8B0',
  },
  bgTreatment: 'paper',
  motionIntensity: 1.0,
  transition: 'fade',
  subtitle: {
    mode: 'floating',
    accentColor: '#C96228',
    theme: 'light',
  },
  cardRadius: 14,
  vignette: 0.14,
  grain: 0.14,
  glowIntensity: 0.06,
};

export const DEFAULT_STUDIO_PROPS: StudioProps = {
  title: 'สร้างคลิปอธิบายระดับสตูดิโอด้วย StudioEngine',
  fps: 30,
  width: 1080,
  height: 1920,
  totalFrames: 240,
  styleId: 'look-31',
  style: DEFAULT_STYLE_TOKENS,
  scenes: [
    {
      id: 'scene-1',
      index: 0,
      badge: '01 · แนวคิดหลัก',
      title: 'เปลี่ยนไอเดียให้เป็นคลิปสวยคมในไม่กี่นาที',
      subtitle: 'ขับเคลื่อนด้วยข้อมูล JSON รองรับ 46 สไตล์ภาพและภาษาไทยเต็มรูปแบบ',
      highlight: 'คลิปสวยคม',
      visual: 'title',
      icon: 'spark',
      bullets: ['รองรับ 6 ตระกูลเลย์เอาต์', 'ซิงก์เสียงพากย์อัตโนมัติ'],
      startFrame: 0,
      endFrame: 80,
      durationFrames: 80,
      cues: [
        {
          text: 'เปลี่ยนไอเดียของคุณให้กลายเป็นคลิปเล่าเรื่องระดับสตูดิโอ',
          highlight: 'ระดับสตูดิโอ',
          startFrame: 6,
          endFrame: 74,
        },
      ],
    },
    {
      id: 'scene-2',
      index: 1,
      badge: '02 · จุดเด่นสำคัญ',
      title: 'ควบคุมสไตล์และจังหวะภาพได้ครบในที่เดียว',
      highlight: 'ควบคุมสไตล์',
      visual: 'bullets',
      bullets: [
        'ตัวอักษรไทยคมชัด สระและวรรณยุกต์ไม่ขาดขอบ',
        'สลับ 6 เลย์เอาต์และ 8 รูปแบบภาพประกอบได้ทันที',
        'จัดระยะปลอดภัยแนวตั้ง 9:16 พร้อมลง Reels และ Shorts',
      ],
      startFrame: 80,
      endFrame: 160,
      durationFrames: 80,
      cues: [
        {
          text: 'ครบทั้งฟอนต์ไทย สไตล์ภาพ และระยะปลอดภัยแนวตั้ง',
          highlight: 'ระยะปลอดภัยแนวตั้ง',
          startFrame: 86,
          endFrame: 154,
        },
      ],
    },
    {
      id: 'scene-3',
      index: 2,
      badge: '03 · พลังคลังสไตล์',
      title: 'ครอบคลุมสไตล์งานโมชันยอดนิยม',
      highlight: 'สไตล์งานโมชัน',
      visual: 'stat',
      stat: {
        value: '46+',
        numericValue: 46,
        suffix: '+',
        unit: 'สไตล์ภาพ',
        label: 'คลังสไตล์พร้อมใช้งานและเรียนรู้เพิ่มได้เอง',
        delta: '6 ตระกูลเลย์เอาต์',
        progress: 92,
      },
      startFrame: 160,
      endFrame: 240,
      durationFrames: 80,
      cues: [
        {
          text: 'เลือกใช้ได้ทันทีกว่า 46 สไตล์ พร้อมปรับแต่งได้ตามใจ',
          highlight: '46 สไตล์',
          startFrame: 166,
          endFrame: 234,
        },
      ],
    },
  ],
  cues: [
    {
      text: 'เปลี่ยนไอเดียของคุณให้กลายเป็นคลิปเล่าเรื่องระดับสตูดิโอ',
      highlight: 'ระดับสตูดิโอ',
      startFrame: 6,
      endFrame: 74,
    },
    {
      text: 'ครบทั้งฟอนต์ไทย สไตล์ภาพ และระยะปลอดภัยแนวตั้ง',
      highlight: 'ระยะปลอดภัยแนวตั้ง',
      startFrame: 86,
      endFrame: 154,
    },
    {
      text: 'เลือกใช้ได้ทันทีกว่า 46 สไตล์ พร้อมปรับแต่งได้ตามใจ',
      highlight: '46 สไตล์',
      startFrame: 166,
      endFrame: 234,
    },
  ],
};
