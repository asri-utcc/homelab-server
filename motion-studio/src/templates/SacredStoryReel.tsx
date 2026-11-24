import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  random,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {
  ARABIC_FONT_FAMILY,
  THAI_FONT_FAMILY,
  THAI_LOOPED_FAMILY,
  ThaiFontLoader,
} from '../components/ThaiFontLoader';
import {
  ArabicText,
  CameraRig,
  CountUp,
  DawnSky,
  FilmGrainVignette,
  IslamicPattern,
  KaraokeSubtitle,
  KineticTitle,
  LightLeakFlash,
  LightRays,
  ParticleField,
  transitionStyle,
} from '../components/fx';
import type { SubtitleCue, TransitionKind, WordBoundary } from '../components/fx';

export type SkyMode = 'sunset' | 'night' | 'dawn';

export type SacredSceneKind =
  | 'hook'
  | 'evidence'
  | 'meaning'
  | 'icon'
  | 'stat'
  | 'reflection'
  | 'cta';

export type SacredIconName = 'moon' | 'stars' | 'hands' | 'mihrab' | 'clock' | 'door';

export type SacredScene = {
  id: string;
  index?: number;
  badge?: string;
  title: string;
  subtitle?: string;
  source?: string;
  arabic?: string;
  arabicMeaning?: string;
  narration?: string;
  kind?: SacredSceneKind;
  icon?: SacredIconName;
  highlight?: string | string[];
  statValue?: number;
  statPrefix?: string;
  statSuffix?: string;
  statLabel?: string;
  startSec?: number;
  speechStartSec?: number;
  speechDurSec?: number;
  endSec?: number;
  durationSec?: number;
  startFrame: number;
  durationFrames: number;
  endFrame: number;
  cues: SubtitleCue[];
  wordBoundaries?: WordBoundary[];
};

export type SacredStoryProps = {
  title?: string;
  fps: number;
  width?: number;
  height?: number;
  totalSec?: number;
  totalFrames: number;
  skyMode?: SkyMode;
  scenes: SacredScene[];
  cues?: SubtitleCue[];
};

export interface SacredScriptSubtitleInput {
  text: string;
  highlight?: string;
}

export interface SacredScriptSceneInput {
  id: string;
  badge?: string;
  title: string;
  subtitle?: string;
  source?: string;
  arabic?: string;
  arabicMeaning?: string;
  narration?: string;
  kind?: string;
  icon?: string;
  highlight?: string | string[];
  statValue?: number;
  statPrefix?: string;
  statSuffix?: string;
  statLabel?: string;
  padAfterSec?: number;
  subtitles?: SacredScriptSubtitleInput[];
}

export interface SacredScriptInput {
  title?: string;
  fps?: number;
  width?: number;
  height?: number;
  skyMode?: string;
  leadInSec?: number;
  holdEndSec?: number;
  scenes: SacredScriptSceneInput[];
}

const PALETTE = {
  bgDeep: '#0B1026',
  bgMid: '#1B1F4A',
  gold: '#FFD166',
  goldSoft: '#FFE6A7',
  cream: '#FFF4DC',
  accent2: '#F28C5B',
  glassBg: 'rgba(11, 16, 38, 0.72)',
  glassBorder: 'rgba(255, 209, 102, 0.52)',
  sourceBg: 'rgba(15, 22, 52, 0.82)',
} as const;

const OVERLAP_HALF = 7;

const VALID_KINDS = new Set<SacredSceneKind>([
  'hook',
  'evidence',
  'meaning',
  'icon',
  'stat',
  'reflection',
  'cta',
]);

const VALID_ICONS = new Set<SacredIconName>([
  'moon',
  'stars',
  'hands',
  'mihrab',
  'clock',
  'door',
]);

const VALID_SKY_MODES = new Set<SkyMode>(['sunset', 'night', 'dawn']);

function normalizeKind(raw?: string): SacredSceneKind | undefined {
  if (!raw) return undefined;
  const k = raw.trim().toLowerCase() as SacredSceneKind;
  return VALID_KINDS.has(k) ? k : undefined;
}

function normalizeIcon(raw?: string): SacredIconName | undefined {
  if (!raw) return undefined;
  const i = raw.trim().toLowerCase() as SacredIconName;
  return VALID_ICONS.has(i) ? i : undefined;
}

export function normalizeSkyMode(raw?: string, fallback: SkyMode = 'night'): SkyMode {
  if (!raw) return fallback;
  const m = raw.trim().toLowerCase() as SkyMode;
  return VALID_SKY_MODES.has(m) ? m : fallback;
}

/**
 * Estimates frame-accurate default props from a script.json object when a TTS
 * timeline.json has not yet been generated. Mirrors DhuhaBenefits' buildDefaultProps
 * while scaling each scene's duration proportionally to its narration length.
 */
export function buildSacredProps(
  scriptData: SacredScriptInput,
  options?: { defaultSkyMode?: SkyMode },
): SacredStoryProps {
  const fps = scriptData.fps || 30;
  const leadInSec = typeof scriptData.leadInSec === 'number' ? scriptData.leadInSec : 0.4;
  const holdEndSec = typeof scriptData.holdEndSec === 'number' ? scriptData.holdEndSec : 1.6;
  const rawScenes = Array.isArray(scriptData.scenes) ? scriptData.scenes : [];
  const scenes: SacredScene[] = [];
  const cues: SubtitleCue[] = [];

  let cursorSec = leadInSec;

  rawScenes.forEach((sc, idx) => {
    const narration = (sc.narration || sc.title || '').trim();
    // Thai narration averages ~14 chars/sec; clamp to a natural reading window
    const estimatedSpeechSec = Math.max(3.8, Math.min(18, narration.length / 13.5));
    const padAfter =
      idx === rawScenes.length - 1
        ? Math.max(sc.padAfterSec ?? 0.55, holdEndSec)
        : (sc.padAfterSec ?? 0.55);

    const startSec = idx === 0 ? 0 : cursorSec;
    const speechStartSec = cursorSec;
    const endSec = speechStartSec + estimatedSpeechSec + padAfter;

    const startFrame = Math.round(startSec * fps);
    const endFrame = Math.max(startFrame + 30, Math.round(endSec * fps));
    const durationFrames = endFrame - startFrame;

    const rawSubs =
      sc.subtitles && sc.subtitles.length > 0
        ? sc.subtitles
        : [{ text: sc.subtitle || sc.title, highlight: '' }];

    const speechStartFrame = Math.round(speechStartSec * fps);
    const speechEndFrame = Math.max(
      speechStartFrame + 15,
      Math.round((speechStartSec + estimatedSpeechSec) * fps),
    );
    const totalSubChars = rawSubs.reduce((acc, s) => acc + Math.max(1, s.text.length), 0);

    let cueCursor = speechStartFrame;
    const sceneCues: SubtitleCue[] = rawSubs.map((sub, sIdx) => {
      const weight = Math.max(1, sub.text.length) / Math.max(1, totalSubChars);
      const span = Math.max(12, Math.round((speechEndFrame - speechStartFrame) * weight));
      const cf0 = cueCursor;
      const cf1 = sIdx === rawSubs.length - 1 ? speechEndFrame : Math.min(speechEndFrame, cf0 + span);
      cueCursor = cf1;
      return {
        text: sub.text,
        highlight: sub.highlight,
        startFrame: cf0,
        endFrame: cf1,
      };
    });

    cues.push(...sceneCues);

    scenes.push({
      id: sc.id || `scene_${idx + 1}`,
      index: idx,
      badge: sc.badge || String(idx + 1).padStart(2, '0'),
      title: sc.title || '',
      subtitle: sc.subtitle || '',
      source: sc.source,
      arabic: typeof sc.arabic === 'string' && sc.arabic.trim() ? sc.arabic : undefined,
      arabicMeaning:
        typeof sc.arabicMeaning === 'string' && sc.arabicMeaning.trim()
          ? sc.arabicMeaning
          : undefined,
      narration,
      kind: normalizeKind(sc.kind),
      icon: normalizeIcon(sc.icon),
      highlight: sc.highlight,
      statValue: sc.statValue,
      statPrefix: sc.statPrefix,
      statSuffix: sc.statSuffix,
      statLabel: sc.statLabel,
      startSec: Number(startSec.toFixed(3)),
      speechStartSec: Number(speechStartSec.toFixed(3)),
      speechDurSec: Number(estimatedSpeechSec.toFixed(3)),
      endSec: Number(endSec.toFixed(3)),
      durationSec: Number((endSec - startSec).toFixed(3)),
      startFrame,
      durationFrames,
      endFrame,
      cues: sceneCues,
      wordBoundaries: [
        {
          type: 'SentenceBoundary',
          offsetSec: 0,
          durationSec: Number(estimatedSpeechSec.toFixed(3)),
          text: narration,
        },
      ],
    });

    cursorSec = endSec;
  });

  // Contiguous frames with zero gaps
  for (let i = 0; i < scenes.length - 1; i++) {
    scenes[i].endFrame = scenes[i + 1].startFrame;
    scenes[i].durationFrames = Math.max(1, scenes[i].endFrame - scenes[i].startFrame);
  }

  const totalFrames = scenes.length > 0 ? scenes[scenes.length - 1].endFrame : 300;
  return {
    title: scriptData.title || 'Sacred Story Reel',
    fps,
    width: scriptData.width || 1080,
    height: scriptData.height || 1920,
    totalSec: Number((totalFrames / fps).toFixed(3)),
    totalFrames,
    skyMode: normalizeSkyMode(scriptData.skyMode, options?.defaultSkyMode ?? 'night'),
    scenes,
    cues,
  };
}

export const DEFAULT_SACRED_PROPS: SacredStoryProps = buildSacredProps(
  {
    title: 'ช่วงเวลาอันจำเริญแห่งค่ำคืน',
    fps: 30,
    width: 1080,
    height: 1920,
    skyMode: 'night',
    leadInSec: 0.4,
    holdEndSec: 1.6,
    scenes: [
      {
        id: 's1_hook',
        badge: '01',
        kind: 'hook',
        icon: 'moon',
        title: 'หนึ่งส่วนสามสุดท้ายของค่ำคืน',
        subtitle: 'เวลาที่ประตูแห่งความเมตตาเปิดกว้าง',
        narration: 'ในยามดึกสงัดที่ผู้คนกำลังหลับใหล มีช่วงเวลาอันล้ำค่าที่สุดช่วงหนึ่งของค่ำคืน',
        subtitles: [
          {
            text: 'ในยามดึกสงัด มีช่วงเวลาอันล้ำค่าที่สุดของค่ำคืน',
            highlight: 'ช่วงเวลาอันล้ำค่าที่สุด',
          },
        ],
      },
      {
        id: 's2_evidence',
        badge: '02',
        kind: 'evidence',
        icon: 'stars',
        title: 'หะดีษเศาะฮีหฺแห่งยามค่ำคืน',
        subtitle: 'เสียงเรียกแห่งความเมตตาจากพระผู้อภิบาล',
        source: 'บันทึกโดย บุคอรี 1145 · มุสลิม 758',
        arabic: 'مَنْ يَدْعُونِي فَأَسْتَجِيبَ لَهُ مَنْ يَسْأَلُنِي فَأُعْطِيَهُ',
        arabicMeaning: '“ผู้ใดวิงวอนต่อข้า ข้าจะตอบรับเขา ผู้ใดขอต่อข้า ข้าจะประทานให้เขา”',
        narration: 'ผู้ใดวิงวอนต่อข้า ข้าจะตอบรับเขา ผู้ใดขอต่อข้า ข้าจะประทานให้เขา',
        subtitles: [
          {
            text: 'ผู้ใดวิงวอนต่อข้า ข้าจะตอบรับเขา',
            highlight: 'ข้าจะตอบรับเขา',
          },
        ],
      },
      {
        id: 's3_cta',
        badge: '03',
        kind: 'cta',
        icon: 'hands',
        title: 'ตื่นขึ้นมาสนทนากับอัลลอฮ์สักครู่',
        subtitle: 'เริ่มจากคืนนี้ เพียงสองร็อกอะฮ์และดุอาอ์จากหัวใจ',
        arabic: 'وَاللَّهُ أَعْلَمُ',
        arabicMeaning: 'วัลลอฮุอะอฺลัม — และอัลลอฮ์ทรงรอบรู้ยิ่ง',
        narration: 'คืนนี้ลองตื่นก่อนฟัจญ์สักสิบนาที ยกมือขอดุอาอ์จากหัวใจ วัลลอฮุอะอฺลัม',
        subtitles: [
          {
            text: 'คืนนี้ลองตื่นก่อนฟัจญ์สัก 10 นาที วัลลอฮุอะอฺลัม',
            highlight: 'วัลลอฮุอะอฺลัม',
          },
        ],
      },
    ],
  },
  { defaultSkyMode: 'night' },
);

function resolveSceneKind(scene: SacredScene, idx: number, totalScenes: number): SacredSceneKind {
  if (scene.kind && VALID_KINDS.has(scene.kind)) return scene.kind;
  if (scene.arabic && scene.arabic.trim().length > 0) return 'evidence';
  if (idx === 0) return 'hook';
  if (idx === totalScenes - 1) return 'cta';
  return 'meaning';
}

function resolveSceneIcon(scene: SacredScene, idx: number, kind: SacredSceneKind): SacredIconName {
  if (scene.icon && VALID_ICONS.has(scene.icon)) return scene.icon;
  const hay = `${scene.id} ${scene.title} ${scene.subtitle ?? ''}`.toLowerCase();
  if (/door|gate|ประตู|เปิด/.test(hay)) return 'door';
  if (/clock|time|นาที|เวลา|ส่วนสาม|1\/3|ฟัจญ์/.test(hay)) return 'clock';
  if (/hand|dua|ดุอา|วิงวอน|ขอ|อภัย/.test(hay)) return 'hands';
  if (/mihrab|salah|ละหมาด|ตะฮัจญุด|ร็อกอะฮ์|ซุญูด/.test(hay)) return 'mihrab';
  if (/moon|night|คืน|จันทร์|ดึก/.test(hay)) return 'moon';
  if (/star|sky|ดาว|ฟ้า/.test(hay)) return 'stars';

  if (kind === 'hook') return 'moon';
  if (kind === 'cta') return 'hands';
  if (kind === 'reflection') return 'mihrab';
  if (kind === 'stat') return 'clock';
  const cycle: SacredIconName[] = ['moon', 'stars', 'mihrab', 'hands', 'clock', 'door'];
  return cycle[idx % cycle.length];
}

function resolveTransitionKind(idx: number): TransitionKind {
  const order: TransitionKind[] = ['lightLeak', 'iris', 'fade'];
  return order[idx % order.length];
}

function renderSacredInline(text?: string): React.ReactNode {
  if (!text) return null;
  const parts = text.split(/([ﷺﷻ])/g);
  if (parts.length === 1) return text;
  return parts.map((part, idx) =>
    part === 'ﷺ' || part === 'ﷻ' ? (
      <span
        key={idx}
        dir="rtl"
        lang="ar"
        style={{
          fontFamily: ARABIC_FONT_FAMILY,
          unicodeBidi: 'isolate',
          display: 'inline-block',
          margin: '0 6px',
          color: PALETTE.gold,
          fontWeight: 700,
        }}
      >
        {part}
      </span>
    ) : (
      <React.Fragment key={idx}>{part}</React.Fragment>
    ),
  );
}

// ============================================================================
// Night Sky Backdrop (for skyMode === 'night')
// ============================================================================
const NIGHT_STAR_COUNT = 72;

const NightSkyBackdrop: React.FC<{ progress: number }> = ({ progress }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const tSec = frame / Math.max(1, fps);

  const p = Math.max(0, Math.min(1, progress));
  // Subtle indigo night -> deep pre-dawn twilight warmth at horizon
  const horizonGlowOpacity = interpolate(p, [0, 0.65, 1], [0.16, 0.28, 0.44], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const moonY = interpolate(Easing.inOut(Easing.quad)(p), [0, 1], [height * 0.16, height * 0.125]);
  const moonX = interpolate(p, [0, 1], [width * 0.78, width * 0.73]);
  const moonFloat = Math.sin(tSec * 0.7) * 5;

  const stars = React.useMemo(() => {
    return Array.from({ length: NIGHT_STAR_COUNT }, (_, i) => ({
      x: random(`sacred-star-x-${i}`) * width,
      y: random(`sacred-star-y-${i}`) * height * 0.72,
      r: 1.1 + random(`sacred-star-r-${i}`) * 2.4,
      phase: random(`sacred-star-p-${i}`) * Math.PI * 2,
      speed: 1.0 + random(`sacred-star-s-${i}`) * 2.1,
      baseAlpha: 0.35 + random(`sacred-star-a-${i}`) * 0.6,
      isGold: random(`sacred-star-c-${i}`) > 0.68,
    }));
  }, [width, height]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `linear-gradient(180deg, ${PALETTE.bgDeep} 0%, #111638 38%, ${PALETTE.bgMid} 74%, #25285C 100%)`,
        overflow: 'hidden',
      }}
    >
      {/* Subtle pre-dawn amber/indigo horizon glow */}
      <div
        style={{
          position: 'absolute',
          left: '-15%',
          right: '-15%',
          bottom: '-12%',
          height: '46%',
          borderRadius: '50%',
          opacity: horizonGlowOpacity,
          background:
            'radial-gradient(ellipse at 50% 85%, rgba(242, 140, 91, 0.38) 0%, rgba(255, 209, 102, 0.16) 36%, rgba(27, 31, 74, 0) 74%)',
          pointerEvents: 'none',
        }}
      />

      {/* Deterministic twinkling starfield */}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        <defs>
          <radialGradient id="sacred-moon-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFD166" stopOpacity="0.42" />
            <stop offset="45%" stopColor="#FFE6A7" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#FFD166" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="sacred-moon-fill" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFF4DC" />
            <stop offset="100%" stopColor="#FFD166" />
          </linearGradient>
        </defs>

        {stars.map((st, idx) => {
          const twinkle = 0.55 + 0.45 * Math.sin(tSec * st.speed + st.phase);
          const alpha = st.baseAlpha * twinkle;
          return (
            <circle
              key={idx}
              cx={st.x}
              cy={st.y}
              r={st.r}
              fill={st.isGold ? '#FFE6A7' : '#FFF4DC'}
              opacity={alpha}
            />
          );
        })}

        {/* Luminous Crescent Moon */}
        <g transform={`translate(${moonX.toFixed(1)}, ${(moonY + moonFloat).toFixed(1)})`}>
          <circle cx={0} cy={0} r={118} fill="url(#sacred-moon-halo)" />
          <path
            d="M 16 -40 A 42 42 0 1 0 16 40 A 32 32 0 1 1 16 -40 Z"
            fill="url(#sacred-moon-fill)"
            opacity={0.94}
          />
          {/* Small companion star */}
          <path
            d="M 28 -18 L 31 -10 L 39 -7 L 31 -4 L 28 4 L 25 -4 L 17 -7 L 25 -10 Z"
            fill="#FFF4DC"
            opacity={0.7 + 0.3 * Math.sin(tSec * 2.2)}
          />
        </g>
      </svg>
    </div>
  );
};

// ============================================================================
// Deterministic Gold Stroke-Draw Sacred SVG Icons (6 types, NO faces!)
// ============================================================================
const SacredSvgIcon: React.FC<{
  icon: SacredIconName;
  size?: number;
  startFrame?: number;
}> = ({ icon, size = 190, startFrame = 6 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const drawSpring = spring({
    fps,
    frame: Math.max(0, frame - startFrame),
    config: { damping: 18, stiffness: 52, mass: 1.05 },
  });
  const secondarySpring = spring({
    fps,
    frame: Math.max(0, frame - startFrame - 10),
    config: { damping: 20, stiffness: 60 },
  });
  const floatY = Math.sin((frame / Math.max(1, fps)) * 1.45) * 4;
  const glowPulse = 0.36 + 0.16 * Math.sin((frame / Math.max(1, fps)) * 2.1);

  const dash = (len: number, prog: number) => ({
    strokeDasharray: len,
    strokeDashoffset: len * (1 - Math.max(0, Math.min(1, prog))),
  });

  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `translateY(${floatY.toFixed(2)}px)`,
        filter: `drop-shadow(0 0 18px rgba(255, 209, 102, ${glowPulse.toFixed(3)}))`,
      }}
    >
      <svg width={size} height={size} viewBox="0 0 200 200" fill="none">
        <defs>
          <linearGradient id={`gold-stroke-${icon}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={PALETTE.cream} />
            <stop offset="55%" stopColor={PALETTE.gold} />
            <stop offset="100%" stopColor={PALETTE.accent2} />
          </linearGradient>
        </defs>

        {/* Soft outer aura ring */}
        <circle
          cx={100}
          cy={100}
          r={86}
          stroke={PALETTE.gold}
          strokeWidth={1.2}
          strokeOpacity={0.28 * drawSpring}
          strokeDasharray="5 9"
        />

        {icon === 'moon' && (
          <g stroke={`url(#gold-stroke-${icon})`} strokeLinecap="round" strokeLinejoin="round">
            <path
              d="M 118 36 A 64 64 0 1 0 154 146 A 50 50 0 1 1 118 36 Z"
              strokeWidth={4.2}
              fill="rgba(255, 209, 102, 0.08)"
              {...dash(420, drawSpring)}
            />
            <path
              d="M 142 54 L 146 66 L 158 70 L 146 74 L 142 86 L 138 74 L 126 70 L 138 66 Z"
              strokeWidth={2.8}
              fill="rgba(255, 244, 220, 0.25)"
              {...dash(110, secondarySpring)}
            />
            <circle cx={158} cy={104} r={3.5} fill={PALETTE.gold} opacity={secondarySpring} />
            <circle cx={124} cy={96} r={2.5} fill={PALETTE.cream} opacity={secondarySpring * 0.85} />
          </g>
        )}

        {icon === 'stars' && (
          <g stroke={`url(#gold-stroke-${icon})`} strokeLinecap="round" strokeLinejoin="round">
            {/* 8-pointed Rub el Hizb Islamic star */}
            <rect
              x={56}
              y={56}
              width={88}
              height={88}
              strokeWidth={3.6}
              fill="rgba(255, 209, 102, 0.06)"
              {...dash(360, drawSpring)}
            />
            <rect
              x={56}
              y={56}
              width={88}
              height={88}
              transform="rotate(45 100 100)"
              strokeWidth={3.6}
              fill="rgba(255, 209, 102, 0.06)"
              {...dash(360, secondarySpring)}
            />
            <circle
              cx={100}
              cy={100}
              r={18}
              strokeWidth={3}
              {...dash(120, secondarySpring)}
            />
            <circle cx={100} cy={100} r={5} fill={PALETTE.gold} opacity={secondarySpring} />
          </g>
        )}

        {icon === 'hands' && (
          <g stroke={`url(#gold-stroke-${icon})`} strokeLinecap="round" strokeLinejoin="round">
            {/* Abstract minimalist cupped palms raised in du'a (no face, no figure) */}
            <path
              d="M 42 138 C 44 108 58 88 78 82 C 88 79 94 86 94 98 L 94 134 C 84 148 60 152 42 138 Z"
              strokeWidth={3.8}
              fill="rgba(255, 209, 102, 0.07)"
              {...dash(280, drawSpring)}
            />
            <path
              d="M 158 138 C 156 108 142 88 122 82 C 112 79 106 86 106 98 L 106 134 C 116 148 140 152 158 138 Z"
              strokeWidth={3.8}
              fill="rgba(255, 209, 102, 0.07)"
              {...dash(280, drawSpring)}
            />
            {/* Rising light rays / du'a ascent */}
            <path d="M 100 72 L 100 36" strokeWidth={3.2} {...dash(44, secondarySpring)} />
            <path d="M 76 68 L 64 42" strokeWidth={2.6} {...dash(38, secondarySpring)} />
            <path d="M 124 68 L 136 42" strokeWidth={2.6} {...dash(38, secondarySpring)} />
            <circle cx={100} cy={28} r={4.5} fill={PALETTE.cream} opacity={secondarySpring} />
          </g>
        )}

        {icon === 'mihrab' && (
          <g stroke={`url(#gold-stroke-${icon})`} strokeLinecap="round" strokeLinejoin="round">
            {/* Pointed Islamic Mihrab arch + hanging luminous lantern */}
            <path
              d="M 48 164 L 48 96 C 48 64 74 42 100 30 C 126 42 152 64 152 96 L 152 164 Z"
              strokeWidth={4}
              fill="rgba(255, 209, 102, 0.07)"
              {...dash(460, drawSpring)}
            />
            <path
              d="M 64 164 L 64 100 C 64 76 82 58 100 48 C 118 58 136 76 136 100 L 136 164"
              strokeWidth={2.4}
              strokeOpacity={0.75}
              {...dash(340, secondarySpring)}
            />
            {/* Hanging lantern silhouette */}
            <line x1={100} y1={48} x2={100} y2={82} strokeWidth={2.4} {...dash(40, secondarySpring)} />
            <path
              d="M 90 92 L 100 82 L 110 92 L 106 114 L 94 114 Z"
              strokeWidth={3}
              fill="rgba(255, 209, 102, 0.22)"
              {...dash(110, secondarySpring)}
            />
            <circle cx={100} cy={100} r={4.5} fill={PALETTE.cream} opacity={secondarySpring} />
          </g>
        )}

        {icon === 'clock' && (
          <g stroke={`url(#gold-stroke-${icon})`} strokeLinecap="round" strokeLinejoin="round">
            {/* Night dial with the last third (120 deg arc) highlighted in gold */}
            <circle
              cx={100}
              cy={100}
              r={62}
              strokeWidth={3.4}
              strokeOpacity={0.55}
              {...dash(395, drawSpring)}
            />
            {/* Highlighted Last Third arc (from 8 o'clock to 12 o'clock) */}
            <path
              d="M 46.3 131 A 62 62 0 0 1 100 38"
              stroke={PALETTE.gold}
              strokeWidth={7}
              {...dash(150, secondarySpring)}
            />
            {/* Divider spokes into 3 equal thirds */}
            <line x1={100} y1={100} x2={100} y2={38} strokeWidth={2.6} {...dash(64, secondarySpring)} />
            <line x1={100} y1={100} x2={46.3} y2={131} strokeWidth={2.6} {...dash(64, secondarySpring)} />
            <line
              x1={100}
              y1={100}
              x2={153.7}
              y2={131}
              strokeWidth={2}
              strokeOpacity={0.45}
              {...dash(64, secondarySpring)}
            />
            <circle cx={100} cy={100} r={5.5} fill={PALETTE.cream} opacity={drawSpring} />
          </g>
        )}

        {icon === 'door' && (
          <g stroke={`url(#gold-stroke-${icon})`} strokeLinecap="round" strokeLinejoin="round">
            {/* Arched door of mercy opening to golden light */}
            <path
              d="M 52 164 L 52 88 A 48 48 0 0 1 148 88 L 148 164"
              strokeWidth={4}
              fill="rgba(255, 209, 102, 0.08)"
              {...dash(380, drawSpring)}
            />
            {/* Slightly ajar door leaf */}
            <path
              d="M 52 164 L 84 152 L 84 70 L 52 88 Z"
              strokeWidth={3}
              fill="rgba(11, 16, 38, 0.48)"
              {...dash(240, secondarySpring)}
            />
            {/* Light beam rays pouring through */}
            <line x1={104} y1={96} x2={134} y2={78} strokeWidth={2.6} {...dash(42, secondarySpring)} />
            <line x1={104} y1={112} x2={138} y2={112} strokeWidth={2.6} {...dash(42, secondarySpring)} />
            <line x1={104} y1={128} x2={134} y2={146} strokeWidth={2.6} {...dash(42, secondarySpring)} />
            <line x1={38} y1={164} x2={162} y2={164} strokeWidth={3.2} {...dash(130, drawSpring)} />
          </g>
        )}
      </svg>
    </div>
  );
};

// ============================================================================
// Evidence Card with Word-Synced Arabic RTL Highlighting + Meaning + Source
// ============================================================================
const EvidenceArabicCard: React.FC<{
  arabic: string;
  arabicMeaning?: string;
  source?: string;
  speechProgress: number;
  localFrame: number;
}> = ({ arabic, arabicMeaning, source, speechProgress, localFrame }) => {
  const { fps } = useVideoConfig();

  const cardSpring = spring({
    fps,
    frame: Math.max(0, localFrame - 5),
    config: { damping: 18, stiffness: 80, mass: 0.9 },
  });
  const cardScale = interpolate(cardSpring, [0, 1], [0.94, 1]);
  const cardY = interpolate(cardSpring, [0, 1], [24, 0]);

  const words = React.useMemo(
    () => arabic.trim().split(/\s+/).filter(Boolean),
    [arabic],
  );
  const clampedProg = Math.max(0, Math.min(1, speechProgress));

  const arabicFontSize = words.length > 16 ? 38 : words.length > 10 ? 44 : 50;

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 920,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 18,
        opacity: cardSpring,
        transform: `translateY(${cardY.toFixed(1)}px) scale(${cardScale.toFixed(4)})`,
      }}
    >
      {/* Frosted Glass Gold-Bordered Card */}
      <div
        style={{
          width: '100%',
          background: PALETTE.glassBg,
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderRadius: 28,
          border: `1.5px solid ${PALETTE.glassBorder}`,
          boxShadow:
            '0 22px 54px rgba(5, 8, 22, 0.56), inset 0 1px 0 rgba(255, 244, 220, 0.22)',
          padding: '30px 36px 28px',
          position: 'relative',
        }}
      >
        {/* Subtle gold accent bar at top */}
        <div
          style={{
            width: 88,
            height: 3,
            borderRadius: 99,
            margin: '0 auto 14px',
            background: `linear-gradient(90deg, transparent, ${PALETTE.gold}, transparent)`,
          }}
        />

        {/* Word-by-word RTL Arabic Highlighting */}
        <div
          dir="rtl"
          lang="ar"
          style={{
            direction: 'rtl',
            unicodeBidi: 'isolate',
            fontFamily: ARABIC_FONT_FAMILY,
            fontSize: arabicFontSize,
            fontWeight: 700,
            lineHeight: 1.75,
            textAlign: 'center',
            paddingTop: 10,
            paddingBottom: 14,
            paddingLeft: 8,
            paddingRight: 8,
            wordSpacing: '0.1em',
          }}
        >
          {words.map((word, wIdx) => {
            const threshold = wIdx / Math.max(1, words.length);
            const reached = clampedProg >= threshold;
            return (
              <React.Fragment key={`${word}-${wIdx}`}>
                <span
                  style={{
                    color: reached ? PALETTE.gold : 'rgba(255, 244, 220, 0.55)',
                    textShadow: reached
                      ? '0 0 22px rgba(255, 209, 102, 0.58), 0 3px 12px rgba(5, 8, 22, 0.7)'
                      : '0 2px 10px rgba(5, 8, 22, 0.5)',
                  }}
                >
                  {word}
                </span>
                {wIdx < words.length - 1 ? ' ' : ''}
              </React.Fragment>
            );
          })}
        </div>

        {/* Thai Meaning */}
        {arabicMeaning && (
          <>
            <div
              style={{
                height: 1,
                width: '72%',
                margin: '10px auto 16px',
                background:
                  'linear-gradient(90deg, transparent, rgba(255, 209, 102, 0.45), transparent)',
              }}
            />
            <div
              style={{
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 30,
                fontWeight: 700,
                lineHeight: 1.48,
                color: PALETTE.cream,
                textAlign: 'center',
                paddingTop: 8,
                paddingBottom: 8,
                textShadow: '0 2px 12px rgba(5, 8, 22, 0.65)',
              }}
            >
              {renderSacredInline(arabicMeaning)}
            </div>
          </>
        )}
      </div>

      {/* Source Citation Pill Always Beneath Card */}
      {source && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 24px',
            borderRadius: 999,
            background: PALETTE.sourceBg,
            border: '1px solid rgba(255, 209, 102, 0.42)',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 24,
            fontWeight: 700,
            lineHeight: 1.4,
            color: PALETTE.goldSoft,
            letterSpacing: '0.01em',
            boxShadow: '0 8px 24px rgba(5, 8, 22, 0.45)',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: PALETTE.gold,
              boxShadow: '0 0 10px rgba(255, 209, 102, 0.85)',
              flexShrink: 0,
            }}
          />
          <span>{renderSacredInline(source)}</span>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Single Scene Renderer (inside overlapped <Sequence>)
// ============================================================================
const SacredSceneView: React.FC<{
  scene: SacredScene;
  sceneIdx: number;
  totalScenes: number;
  renderStart: number;
  renderDuration: number;
  isFirst: boolean;
  isLast: boolean;
}> = ({ scene, sceneIdx, totalScenes, renderStart, renderDuration, isFirst, isLast }) => {
  const localFrame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const globalFrame = renderStart + localFrame;
  const kind = resolveSceneKind(scene, sceneIdx, totalScenes);
  const iconName = resolveSceneIcon(scene, sceneIdx, kind);
  const tKind = resolveTransitionKind(sceneIdx);

  const trans = transitionStyle(localFrame, renderDuration, tKind, fps, {
    skipIn: isFirst,
    skipOut: isLast,
    inFrames: 14,
    outFrames: 14,
  });

  // Compute speech progress inside this scene for Arabic word highlight
  const speechStartSec = scene.speechStartSec ?? scene.startSec ?? scene.startFrame / fps;
  let speechDurSec = scene.speechDurSec ?? 0;
  if (speechDurSec <= 0 && scene.wordBoundaries && scene.wordBoundaries.length > 0) {
    const lastWb = scene.wordBoundaries[scene.wordBoundaries.length - 1];
    const off = typeof lastWb.offsetSec === 'number' ? lastWb.offsetSec : 0;
    const dur = typeof lastWb.durationSec === 'number' ? lastWb.durationSec : 0.4;
    speechDurSec = Math.max(1.2, off + dur);
  }
  if (speechDurSec <= 0) {
    speechDurSec = Math.max(1.5, (scene.durationFrames / fps) * 0.78);
  }
  const speechStartFrame = speechStartSec * fps;
  const speechDurationFrames = Math.max(1, speechDurSec * fps);
  const speechProgress = (globalFrame - speechStartFrame) / speechDurationFrames;

  const subSpring = spring({
    fps,
    frame: Math.max(0, localFrame - 10),
    config: { damping: 18, stiffness: 80 },
  });

  // Optional stat number extraction for kind === 'stat'
  const statDisplay = React.useMemo(() => {
    if (typeof scene.statValue === 'number') {
      return {
        to: scene.statValue,
        prefix: scene.statPrefix || '',
        suffix: scene.statSuffix || '',
        label: scene.statLabel || '',
      };
    }
    const text = `${scene.title} ${scene.subtitle ?? ''}`;
    if (/หนึ่งในสาม|1\/3/.test(text)) {
      return { to: 3, prefix: '1/', suffix: '', label: 'ของค่ำคืน' };
    }
    const m = text.match(/\b(\d+)\b/);
    return {
      to: m ? Number(m[1]) : 3,
      prefix: scene.statPrefix || '',
      suffix: scene.statSuffix || '',
      label: scene.statLabel || '',
    };
  }, [scene.statValue, scene.statPrefix, scene.statSuffix, scene.statLabel, scene.title, scene.subtitle]);

  const badgeLabel = scene.badge || String(sceneIdx + 1).padStart(2, '0');

  return (
    <AbsoluteFill style={{ ...trans, overflow: 'hidden' }}>
      <CameraRig zoomFrom={1.0} zoomTo={1.06} durationFrames={renderDuration}>
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
          {/* Top Safe-Zone Header (top >= 150px) */}
          <div
            style={{
              position: 'absolute',
              top: 156,
              left: 68,
              right: 68,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 20px',
                borderRadius: 999,
                background: 'rgba(11, 16, 38, 0.68)',
                border: '1px solid rgba(255, 209, 102, 0.42)',
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 22,
                fontWeight: 700,
                lineHeight: 1.4,
                color: PALETTE.gold,
                letterSpacing: '0.06em',
              }}
            >
              <span>{badgeLabel}</span>
              <span style={{ opacity: 0.45 }}>/</span>
              <span style={{ color: PALETTE.cream, opacity: 0.8 }}>
                {String(totalScenes).padStart(2, '0')}
              </span>
            </div>

            {/* Scene Progress Dots */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              {Array.from({ length: totalScenes }, (_, dIdx) => {
                const isActive = dIdx === sceneIdx;
                const isDone = dIdx < sceneIdx;
                return (
                  <div
                    key={dIdx}
                    style={{
                      width: isActive ? 28 : 9,
                      height: 9,
                      borderRadius: 999,
                      background: isActive
                        ? PALETTE.gold
                        : isDone
                          ? 'rgba(255, 209, 102, 0.55)'
                          : 'rgba(255, 244, 220, 0.25)',
                      boxShadow: isActive ? '0 0 12px rgba(255, 209, 102, 0.8)' : 'none',
                    }}
                  />
                );
              })}
            </div>
          </div>

          {/* Main Stage (Strict Portrait Safe Zone: top 228px .. bottom 440px) */}
          <div
            style={{
              position: 'absolute',
              top: 228,
              bottom: 440,
              left: 64,
              right: 64,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 26,
            }}
          >
            {/* HOOK */}
            {kind === 'hook' && (
              <>
                <SacredSvgIcon icon={iconName} size={210} startFrame={4} />
                <KineticTitle
                  text={scene.title}
                  startFrame={6}
                  fontSize={64}
                  accent={PALETTE.gold}
                  accentSecondary={PALETTE.cream}
                  highlight={scene.highlight}
                  staggerFrames={2}
                  maxWidth={920}
                />
                {scene.subtitle && (
                  <div
                    style={{
                      opacity: subSpring,
                      transform: `translateY(${interpolate(subSpring, [0, 1], [16, 0]).toFixed(1)}px)`,
                      padding: '12px 28px',
                      borderRadius: 999,
                      background: 'rgba(11, 16, 38, 0.65)',
                      border: '1px solid rgba(255, 209, 102, 0.35)',
                      fontFamily: THAI_LOOPED_FAMILY,
                      fontSize: 30,
                      fontWeight: 700,
                      lineHeight: 1.42,
                      color: PALETTE.cream,
                      textAlign: 'center',
                    }}
                  >
                    {renderSacredInline(scene.subtitle)}
                  </div>
                )}
              </>
            )}

            {/* EVIDENCE */}
            {kind === 'evidence' && (
              <>
                <KineticTitle
                  text={scene.title}
                  startFrame={3}
                  fontSize={52}
                  accent={PALETTE.gold}
                  accentSecondary={PALETTE.cream}
                  highlight={scene.highlight}
                  staggerFrames={2}
                  maxWidth={920}
                />
                {scene.arabic ? (
                  <EvidenceArabicCard
                    arabic={scene.arabic}
                    arabicMeaning={scene.arabicMeaning || scene.subtitle}
                    source={scene.source}
                    speechProgress={speechProgress}
                    localFrame={localFrame}
                  />
                ) : (
                  <SacredSvgIcon icon={iconName} size={185} startFrame={6} />
                )}
              </>
            )}

            {/* STAT */}
            {kind === 'stat' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
                  <SacredSvgIcon icon={iconName} size={180} startFrame={4} />
                  <div
                    style={{
                      width: 224,
                      height: 224,
                      borderRadius: '50%',
                      background: PALETTE.glassBg,
                      border: `2px solid ${PALETTE.glassBorder}`,
                      boxShadow: '0 0 48px rgba(255, 209, 102, 0.22)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                    }}
                  >
                    <CountUp
                      from={0}
                      to={statDisplay.to}
                      startFrame={6}
                      durationFrames={36}
                      prefix={statDisplay.prefix}
                      suffix={statDisplay.suffix}
                      popScale={1.15}
                      popGlowColor={PALETTE.gold}
                      style={{
                        fontFamily: THAI_FONT_FAMILY,
                        fontSize: 78,
                        fontWeight: 700,
                        color: PALETTE.gold,
                        lineHeight: 1.2,
                      }}
                    />
                    {statDisplay.label && (
                      <div
                        style={{
                          fontFamily: THAI_FONT_FAMILY,
                          fontSize: 24,
                          fontWeight: 700,
                          lineHeight: 1.4,
                          color: PALETTE.cream,
                          paddingTop: 4,
                          paddingBottom: 4,
                        }}
                      >
                        {statDisplay.label}
                      </div>
                    )}
                  </div>
                </div>
                <KineticTitle
                  text={scene.title}
                  startFrame={8}
                  fontSize={54}
                  accent={PALETTE.gold}
                  accentSecondary={PALETTE.cream}
                  highlight={scene.highlight}
                  staggerFrames={2}
                  maxWidth={920}
                />
                {scene.subtitle && (
                  <div
                    style={{
                      opacity: subSpring,
                      background: PALETTE.glassBg,
                      border: '1px solid rgba(255, 209, 102, 0.32)',
                      borderRadius: 22,
                      padding: '16px 28px',
                      fontFamily: THAI_LOOPED_FAMILY,
                      fontSize: 28,
                      fontWeight: 700,
                      lineHeight: 1.48,
                      color: PALETTE.cream,
                      textAlign: 'center',
                      maxWidth: 880,
                    }}
                  >
                    {renderSacredInline(scene.subtitle)}
                  </div>
                )}
                {scene.source && (
                  <div
                    style={{
                      padding: '8px 22px',
                      borderRadius: 999,
                      background: PALETTE.sourceBg,
                      border: '1px solid rgba(255, 209, 102, 0.36)',
                      fontFamily: THAI_FONT_FAMILY,
                      fontSize: 23,
                      fontWeight: 700,
                      lineHeight: 1.4,
                      color: PALETTE.goldSoft,
                    }}
                  >
                    {renderSacredInline(scene.source)}
                  </div>
                )}
              </>
            )}

            {/* MEANING / ICON */}
            {(kind === 'meaning' || kind === 'icon') && (
              <>
                <SacredSvgIcon icon={iconName} size={220} startFrame={5} />
                <KineticTitle
                  text={scene.title}
                  startFrame={6}
                  fontSize={56}
                  accent={PALETTE.gold}
                  accentSecondary={PALETTE.cream}
                  highlight={scene.highlight}
                  staggerFrames={2}
                  maxWidth={920}
                />
                {scene.subtitle && (
                  <div
                    style={{
                      opacity: subSpring,
                      transform: `translateY(${interpolate(subSpring, [0, 1], [16, 0]).toFixed(1)}px)`,
                      background: PALETTE.glassBg,
                      border: '1px solid rgba(255, 209, 102, 0.32)',
                      borderRadius: 22,
                      padding: '18px 30px',
                      fontFamily: THAI_LOOPED_FAMILY,
                      fontSize: 30,
                      fontWeight: 700,
                      lineHeight: 1.48,
                      color: PALETTE.cream,
                      textAlign: 'center',
                      maxWidth: 880,
                    }}
                  >
                    {renderSacredInline(scene.subtitle)}
                  </div>
                )}
                {scene.source && (
                  <div
                    style={{
                      padding: '8px 22px',
                      borderRadius: 999,
                      background: PALETTE.sourceBg,
                      border: '1px solid rgba(255, 209, 102, 0.36)',
                      fontFamily: THAI_FONT_FAMILY,
                      fontSize: 23,
                      fontWeight: 700,
                      lineHeight: 1.4,
                      color: PALETTE.goldSoft,
                    }}
                  >
                    {renderSacredInline(scene.source)}
                  </div>
                )}
              </>
            )}

            {/* REFLECTION */}
            {kind === 'reflection' && (
              <>
                <SacredSvgIcon icon={iconName} size={180} startFrame={4} />
                <div
                  style={{
                    width: '100%',
                    maxWidth: 900,
                    background: PALETTE.glassBg,
                    backdropFilter: 'blur(14px)',
                    WebkitBackdropFilter: 'blur(14px)',
                    borderRadius: 28,
                    border: `1.5px solid rgba(255, 209, 102, 0.42)`,
                    padding: '30px 36px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 16,
                  }}
                >
                  <KineticTitle
                    text={scene.title}
                    startFrame={6}
                    fontSize={52}
                    accent={PALETTE.gold}
                    accentSecondary={PALETTE.cream}
                    highlight={scene.highlight}
                    staggerFrames={2}
                    maxWidth={840}
                  />
                  {scene.subtitle && (
                    <div
                      style={{
                        opacity: subSpring,
                        fontFamily: THAI_LOOPED_FAMILY,
                        fontSize: 30,
                        fontWeight: 700,
                        lineHeight: 1.5,
                        color: PALETTE.cream,
                        textAlign: 'center',
                        paddingTop: 8,
                        paddingBottom: 8,
                      }}
                    >
                      {renderSacredInline(scene.subtitle)}
                    </div>
                  )}
                </div>
                {scene.source && (
                  <div
                    style={{
                      padding: '8px 22px',
                      borderRadius: 999,
                      background: PALETTE.sourceBg,
                      border: '1px solid rgba(255, 209, 102, 0.36)',
                      fontFamily: THAI_FONT_FAMILY,
                      fontSize: 23,
                      fontWeight: 700,
                      lineHeight: 1.4,
                      color: PALETTE.goldSoft,
                    }}
                  >
                    {renderSacredInline(scene.source)}
                  </div>
                )}
              </>
            )}

            {/* CTA / OUTRO */}
            {kind === 'cta' && (
              <>
                <SacredSvgIcon icon={iconName} size={185} startFrame={4} />
                <KineticTitle
                  text={scene.title}
                  startFrame={6}
                  fontSize={56}
                  accent={PALETTE.gold}
                  accentSecondary={PALETTE.cream}
                  highlight={scene.highlight}
                  staggerFrames={2}
                  maxWidth={920}
                />
                {scene.subtitle && (
                  <div
                    style={{
                      opacity: subSpring,
                      fontFamily: THAI_LOOPED_FAMILY,
                      fontSize: 30,
                      fontWeight: 700,
                      lineHeight: 1.46,
                      color: PALETTE.cream,
                      textAlign: 'center',
                      paddingTop: 8,
                      paddingBottom: 8,
                      maxWidth: 880,
                    }}
                  >
                    {renderSacredInline(scene.subtitle)}
                  </div>
                )}
                <div
                  style={{
                    marginTop: 6,
                    padding: '14px 36px',
                    borderRadius: 24,
                    background: PALETTE.glassBg,
                    border: `1.5px solid ${PALETTE.glassBorder}`,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                  }}
                >
                  <ArabicText
                    text={scene.arabic || 'وَاللَّهُ أَعْلَمُ'}
                    fontSize={48}
                    color={PALETTE.gold}
                    startFrame={10}
                    durationFrames={30}
                  />
                  {scene.arabicMeaning && (
                    <div
                      style={{
                        fontFamily: THAI_FONT_FAMILY,
                        fontSize: 24,
                        fontWeight: 700,
                        lineHeight: 1.42,
                        color: PALETTE.cream,
                        opacity: 0.9,
                        paddingTop: 4,
                        paddingBottom: 8,
                      }}
                    >
                      {renderSacredInline(scene.arabicMeaning)}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </AbsoluteFill>
      </CameraRig>
    </AbsoluteFill>
  );
};

// ============================================================================
// Main Reusable Template Composition: SacredStoryReel
// ============================================================================
export const SacredStoryReel: React.FC<SacredStoryProps> = (props) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const scenes =
    props.scenes && props.scenes.length > 0 ? props.scenes : DEFAULT_SACRED_PROPS.scenes;
  const allCues =
    props.cues && props.cues.length > 0
      ? props.cues
      : scenes.flatMap((s) => s.cues || []);
  const totalFrames = Math.max(90, props.totalFrames || durationInFrames);
  const skyMode = normalizeSkyMode(props.skyMode, 'night');

  const clipProgress = interpolate(frame, [0, Math.max(1, totalFrames - 1)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Sky journey progress based on skyMode
  const dawnProgress =
    skyMode === 'sunset'
      ? interpolate(clipProgress, [0, 1], [0.72, 0.06])
      : interpolate(clipProgress, [0, 1], [0.04, 0.74]);

  const sunOriginY =
    skyMode === 'night'
      ? 0.16
      : interpolate(Easing.inOut(Easing.quad)(dawnProgress), [0, 1], [0.84, 0.24], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });

  const activeScene =
    scenes.find((s) => frame >= s.startFrame && frame < s.endFrame) ??
    scenes[scenes.length - 1];

  const cutFrames = scenes.slice(1).map((s) => s.startFrame);
  // Subtle opening flash on frame 0 for Hook + cut flashes between scenes
  const flashFrames = [2, ...cutFrames];

  return (
    <AbsoluteFill style={{ backgroundColor: PALETTE.bgDeep, overflow: 'hidden' }}>
      <ThaiFontLoader />

      {/* Layer 1: Continuous Sky Journey Backdrop */}
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        {skyMode === 'night' ? (
          <NightSkyBackdrop progress={clipProgress} />
        ) : (
          <DawnSky progress={dawnProgress} sunYStart={0.84} sunYEnd={0.24} showStars />
        )}

        <IslamicPattern
          opacity={0.06}
          color={PALETTE.goldSoft}
          tileSize={164}
          rotationSpeed={0.8}
        />

        <LightRays
          count={8}
          color={skyMode === 'night' ? '#FFE6A7' : '#FFD9A0'}
          intensity={skyMode === 'night' ? 0.22 : 0.38}
          originX={skyMode === 'night' ? 0.75 : 0.5}
          originY={sunOriginY}
          rotationSpeed={2.0}
          blur={18}
          seed="sacred-rays"
        />

        <ParticleField
          count={46}
          seed="sacred-motes"
          color="#FFE8B6"
          drift={22}
          size={4.2}
          opacity={0.78}
          bokehRatio={0.3}
          blendMode="screen"
        />
      </AbsoluteFill>

      {/* Layer 2: Edge Contrast Scrim for Crisp Typography */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'linear-gradient(180deg, rgba(11, 16, 38, 0.42) 0%, rgba(11, 16, 38, 0.14) 36%, rgba(11, 16, 38, 0.28) 70%, rgba(11, 16, 38, 0.68) 100%)',
        }}
      />

      {/* Layer 3: Overlapping Cross-Faded Scene Sequences (Zero Black Frames) */}
      {scenes.map((scene, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === scenes.length - 1;
        const renderStart = isFirst
          ? scene.startFrame
          : Math.max(0, scene.startFrame - OVERLAP_HALF);
        const renderEnd = isLast
          ? Math.max(totalFrames, scene.endFrame)
          : Math.min(totalFrames, scene.endFrame + OVERLAP_HALF);
        const renderDur = Math.max(2, renderEnd - renderStart);

        return (
          <Sequence key={scene.id || idx} from={renderStart} durationInFrames={renderDur}>
            <SacredSceneView
              scene={scene}
              sceneIdx={idx}
              totalScenes={scenes.length}
              renderStart={renderStart}
              renderDuration={renderDur}
              isFirst={isFirst}
              isLast={isLast}
            />
          </Sequence>
        );
      })}

      {/* Layer 4: Golden Light-Leak Flash Bridging Hook & Scene Cuts */}
      <LightLeakFlash
        at={flashFrames}
        durationFrames={20}
        color="#FFD9A0"
        secondaryColor={PALETTE.accent2}
        intensity={0.74}
      />

      {/* Layer 5: Karaoke Subtitles in Safe Zone (bottomOffset = 280 >= 260) */}
      <KaraokeSubtitle
        cues={allCues}
        wordBoundaries={activeScene?.wordBoundaries}
        sceneSpeechStartSec={activeScene?.speechStartSec ?? activeScene?.startSec ?? 0}
        accentColor={PALETTE.gold}
        bottomOffset={280}
        theme="dark"
      />

      {/* Layer 6: Cinema Film Grain + Soft Lens Vignette */}
      <FilmGrainVignette
        grain={0.045}
        vignette={0.46}
        vignetteColor="#050816"
        updateEveryFrames={2}
      />
    </AbsoluteFill>
  );
};
