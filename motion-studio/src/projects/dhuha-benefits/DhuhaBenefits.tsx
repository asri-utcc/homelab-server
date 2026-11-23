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
  THAI_FONT_FAMILY,
  ThaiFontLoader,
} from '../../components/ThaiFontLoader';
import {
  ArabicText,
  CountUp,
  FilmGrainVignette,
  LightLeakFlash,
  LightRays,
  ParticleField,
  transitionStyle,
} from '../../components/fx';
import type { SubtitleCue, TransitionKind, WordBoundary } from '../../components/fx';
import scriptData from './script.json';

export type DhuhaTimelineScene = {
  id: string;
  index: number;
  badge: string;
  title: string;
  subtitle: string;
  source?: string;
  arabic?: string;
  arabicMeaning?: string;
  narration?: string;
  startSec?: number;
  speechStartSec?: number;
  speechDurSec?: number;
  endSec?: number;
  startFrame: number;
  durationFrames: number;
  endFrame: number;
  cues: SubtitleCue[];
  wordBoundaries?: WordBoundary[];
};

export type DhuhaBenefitsProps = {
  title: string;
  fps: number;
  width?: number;
  height?: number;
  totalSec?: number;
  totalFrames: number;
  scenes: DhuhaTimelineScene[];
  cues: SubtitleCue[];
};

type ScriptSceneMeta = {
  source: string;
  arabic?: string;
  arabicMeaning?: string;
  title: string;
  subtitle: string;
  badge: string;
};

const SCRIPT_META_BY_ID: Record<string, ScriptSceneMeta> = {};
for (const raw of scriptData.scenes) {
  SCRIPT_META_BY_ID[raw.id] = {
    source: raw.source,
    arabic: 'arabic' in raw && typeof raw.arabic === 'string' ? raw.arabic : undefined,
    arabicMeaning:
      'arabicMeaning' in raw && typeof raw.arabicMeaning === 'string'
        ? raw.arabicMeaning
        : undefined,
    title: raw.title,
    subtitle: raw.subtitle,
    badge: raw.badge,
  };
}

function buildDefaultProps(): DhuhaBenefitsProps {
  const fps = scriptData.fps || 30;
  const defaultDur = 265;
  const scenes: DhuhaTimelineScene[] = [];
  const cues: SubtitleCue[] = [];
  let cursor = 0;

  scriptData.scenes.forEach((sc, idx) => {
    const startFrame = cursor;
    const endFrame = cursor + defaultDur;
    const startSec = startFrame / fps;
    const rawSubs = sc.subtitles || [];
    const sceneCues: SubtitleCue[] = rawSubs.map((sub, sIdx) => {
      const slice = Math.floor((defaultDur - 24) / Math.max(1, rawSubs.length));
      const cf0 = startFrame + 12 + sIdx * slice;
      const cf1 = sIdx === rawSubs.length - 1 ? endFrame - 12 : cf0 + slice;
      return {
        text: sub.text,
        highlight: sub.highlight,
        startFrame: cf0,
        endFrame: cf1,
      };
    });
    cues.push(...sceneCues);
    scenes.push({
      id: sc.id,
      index: idx,
      badge: sc.badge,
      title: sc.title,
      subtitle: sc.subtitle,
      source: sc.source,
      arabic: 'arabic' in sc && typeof sc.arabic === 'string' ? sc.arabic : undefined,
      arabicMeaning:
        'arabicMeaning' in sc && typeof sc.arabicMeaning === 'string'
          ? sc.arabicMeaning
          : undefined,
      startSec,
      speechStartSec: startSec + 0.4,
      speechDurSec: (defaultDur - 24) / fps,
      endSec: endFrame / fps,
      startFrame,
      durationFrames: defaultDur,
      endFrame,
      cues: sceneCues,
      wordBoundaries: [
        {
          type: 'SentenceBoundary',
          offsetSec: 0,
          durationSec: (defaultDur - 24) / fps,
          text: sc.narration,
        },
      ],
    });
    cursor = endFrame;
  });

  return {
    title: scriptData.title,
    fps,
    width: scriptData.width || 1080,
    height: scriptData.height || 1920,
    totalSec: cursor / fps,
    totalFrames: cursor,
    scenes,
    cues,
  };
}

export const DEFAULT_DHUHA_PROPS: DhuhaBenefitsProps = buildDefaultProps();

const PALETTE = {
  gold: '#FFD166',
  goldLight: '#FFE6A7',
  goldCream: '#FFF4DC',
  coral: '#F28C5B',
  emerald: '#4ADEA8',
  glassBg: 'rgba(10, 15, 36, 0.78)',
  glassDeep: 'rgba(8, 12, 30, 0.86)',
  glassBorder: 'rgba(255, 217, 160, 0.34)',
  glassBorderStrong: 'rgba(255, 209, 102, 0.72)',
  textLight: '#FFFFFF',
  textSoft: 'rgba(255, 244, 220, 0.88)',
};

const TITLE_HIGHLIGHTS: Record<string, string[]> = {
  s1_joints_360: ['360 ข้อต่อ', 'เศาะดะเกาะฮ์'],
  s2_two_rakaat: ['2 ร็อกอะฮ์', '360 ข้อต่อ'],
  s3_qudsi_shield: ['4 ร็อกอะฮ์', 'ดูแลตลอดวัน'],
  s4_three_wasiyyah: ['คำสั่งเสีย 3 ประการ'],
  s5_awwabin: ['อัลเอาวาบีน'],
  s6_time_rakaat: ['เวลา', 'จำนวนร็อกอะฮ์'],
  s7_challenge_cta: ['ชาเลนจ์ 7 วัน', 'หัวใจที่สงบ'],
};

const SCENE_TRANSITIONS: TransitionKind[] = [
  'lightLeak',
  'zoomThrough',
  'lightLeak',
  'zoomThrough',
  'lightLeak',
  'zoomThrough',
  'lightLeak',
];

const OVERLAP_HALF = 7;

type ThaiSegmenterLike = {
  segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }>;
};

const THAI_WORD_SEGMENTER: ThaiSegmenterLike | null = (() => {
  const IntlObj = Intl as unknown as {
    Segmenter?: new (
      locale: string,
      options?: { granularity?: 'grapheme' | 'word' | 'sentence' },
    ) => ThaiSegmenterLike;
  };
  return typeof IntlObj.Segmenter === 'function'
    ? new IntlObj.Segmenter('th', { granularity: 'word' })
    : null;
})();

function segmentThaiWords(input: string): string[] {
  if (!input) return [];
  if (THAI_WORD_SEGMENTER) {
    const out: string[] = [];
    for (const part of THAI_WORD_SEGMENTER.segment(input)) {
      if (part.segment) out.push(part.segment);
    }
    return out;
  }
  return input.split(/(\s+)/).filter(Boolean);
}

/** High-speed Kinetic Title (zero per-word CSS filter:blur/drop-shadow for smooth CPU rendering) */
const DhuhaKineticTitle: React.FC<{
  text: string;
  startFrame: number;
  highlight?: string[];
  fontSize?: number;
  maxWidth?: number;
}> = ({ text, startFrame, highlight = [], fontSize = 48, maxWidth = 930 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const sortedKw = [...highlight].map((h) => h.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  let spans: Array<{ text: string; isHl: boolean }> = [{ text, isHl: false }];
  for (const kw of sortedKw) {
    const next: Array<{ text: string; isHl: boolean }> = [];
    for (const sp of spans) {
      if (sp.isHl || !sp.text.includes(kw)) {
        next.push(sp);
        continue;
      }
      const parts = sp.text.split(kw);
      parts.forEach((p, idx) => {
        if (p) next.push({ text: p, isHl: false });
        if (idx < parts.length - 1) next.push({ text: kw, isHl: true });
      });
    }
    spans = next;
  }

  const tokens: Array<{ text: string; isHl: boolean; isWs: boolean }> = [];
  for (const sp of spans) {
    for (const piece of segmentThaiWords(sp.text)) {
      tokens.push({ text: piece, isHl: sp.isHl, isWs: /^\s+$/.test(piece) });
    }
  }

  let wordIdx = 0;
  return (
    <div
      style={{
        width: '100%',
        maxWidth,
        margin: '0 auto',
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'baseline',
        fontFamily: THAI_FONT_FAMILY,
        fontSize,
        fontWeight: 700,
        lineHeight: 1.44,
        paddingTop: 12,
        paddingBottom: 12,
        textAlign: 'center',
        overflow: 'visible',
      }}
    >
      {tokens.map((tok, i) => {
        if (tok.isWs) {
          return (
            <span key={i} style={{ whiteSpace: 'pre' }}>
              {tok.text}
            </span>
          );
        }
        const delay = startFrame + wordIdx * 2;
        wordIdx += 1;
        const progress =
          frame < delay
            ? 0
            : spring({
                frame: Math.max(0, frame - delay),
                fps,
                config: { damping: 14, stiffness: 175, mass: 0.72 },
              });
        const y = interpolate(progress, [0, 1], [28, 0]);
        const opacity = interpolate(progress, [0, 0.55], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        const scale = interpolate(progress, [0, 1], [0.93, 1]);

        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              whiteSpace: 'pre',
              color: tok.isHl ? '#FFD166' : '#FFFFFF',
              opacity,
              transform: `translate3d(0, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(4)})`,
              textShadow: tok.isHl
                ? '0 0 18px rgba(255, 209, 102, 0.6), 0 4px 14px rgba(5, 8, 22, 0.65)'
                : '0 4px 16px rgba(5, 8, 22, 0.65)',
              paddingTop: 6,
              paddingBottom: 6,
              marginTop: -6,
              marginBottom: -6,
              lineHeight: 1.44,
            }}
          >
            {tok.text}
          </span>
        );
      })}
    </div>
  );
};

/** High-speed Word-by-Word Karaoke Subtitle Bar (zero backdropFilter to avoid CPU blur & Chromium headless tiling) */
const DhuhaKaraokeSubtitle: React.FC<{
  cues: SubtitleCue[];
  wordBoundaries?: WordBoundary[];
  sceneSpeechStartSec: number;
  bottomOffset?: number;
}> = ({ cues, wordBoundaries, sceneSpeechStartSec, bottomOffset = 275 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const activeCue = cues.find((c) => frame >= c.startFrame && frame <= c.endFrame);
  if (!activeCue) return null;

  const localFrame = frame - activeCue.startFrame;
  const dur = Math.max(6, activeCue.endFrame - activeCue.startFrame);
  const pop = spring({
    frame: localFrame,
    fps,
    config: { damping: 16, stiffness: 180, mass: 0.7 },
  });
  const exitOp = interpolate(localFrame, [Math.max(1, dur - 6), dur], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const boxOpacity =
    interpolate(pop, [0, 0.55], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) *
    exitOp;
  const translateY = interpolate(pop, [0, 1], [14, 0]);
  const scale = interpolate(pop, [0, 1], [0.97, 1]);

  // Thai word-by-word karaoke timing with fallback when edge-tts emits SentenceBoundary
  const tokens = segmentThaiWords(activeCue.text);
  const wordTokens = tokens.filter((t) => t.trim().length > 0);
  const totalChars = Math.max(1, wordTokens.reduce((s, t) => s + t.length, 0));

  const realWords = (wordBoundaries ?? []).filter(
    (b): b is WordBoundary & { offsetSec: number } =>
      b.type !== 'SentenceBoundary' && typeof b.offsetSec === 'number',
  );
  const currentSec = frame / Math.max(1, fps);
  let activeWordIndex = 0;

  if (realWords.length >= 2) {
    const cueStartSec = activeCue.startFrame / Math.max(1, fps);
    const cueEndSec = activeCue.endFrame / Math.max(1, fps);
    const cueWords = realWords.filter((b) => {
      const abs = sceneSpeechStartSec + b.offsetSec;
      return abs >= cueStartSec - 0.15 && abs <= cueEndSec + 0.15;
    });
    if (cueWords.length > 0) {
      let matched = 0;
      for (let i = 0; i < cueWords.length; i += 1) {
        const w = cueWords[i];
        if (w && currentSec >= sceneSpeechStartSec + w.offsetSec) matched = i;
      }
      activeWordIndex = Math.min(
        wordTokens.length - 1,
        Math.round((matched / Math.max(1, cueWords.length - 1)) * Math.max(0, wordTokens.length - 1)),
      );
    }
  } else {
    const progress = Math.max(0, Math.min(0.999, localFrame / Math.max(1, dur)));
    const targetChar = progress * totalChars;
    let acc = 0;
    for (let i = 0; i < wordTokens.length; i += 1) {
      acc += wordTokens[i].length;
      if (acc >= targetChar) {
        activeWordIndex = i;
        break;
      }
    }
  }

  const hl = (activeCue.highlight ?? '').trim();
  let wordCounter = 0;

  return (
    <div
      style={{
        position: 'absolute',
        left: 48,
        right: 48,
        bottom: bottomOffset,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 60,
      }}
    >
      <div
        style={{
          opacity: boxOpacity,
          transform: `translate3d(0, ${translateY.toFixed(1)}px, 0) scale(${scale.toFixed(4)})`,
          backgroundColor: 'rgba(8, 12, 30, 0.88)',
          color: '#FFFFFF',
          fontFamily: THAI_FONT_FAMILY,
          fontWeight: 700,
          fontSize: 34,
          lineHeight: 1.48,
          letterSpacing: 0.2,
          textAlign: 'center',
          padding: '16px 30px 18px 30px',
          borderRadius: 24,
          border: '1.5px solid rgba(255, 217, 160, 0.28)',
          boxShadow: '0 12px 28px rgba(4, 8, 24, 0.45)',
          maxWidth: 972,
          wordBreak: 'keep-all',
        }}
      >
        <div
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            paddingTop: 6,
            paddingBottom: 6,
          }}
        >
          {tokens.map((tok, idx) => {
            if (!tok.trim()) {
              return (
                <span key={idx} style={{ whiteSpace: 'pre' }}>
                  {tok}
                </span>
              );
            }
            const wIdx = wordCounter;
            wordCounter += 1;
            const isCurrent = wIdx === activeWordIndex;
            const isSpoken = wIdx < activeWordIndex;
            const isKey = hl.length > 0 && (hl.includes(tok) || tok.includes(hl));
            return (
              <span
                key={idx}
                style={{
                  display: 'inline',
                  color: isCurrent
                    ? '#FFD166'
                    : isSpoken
                      ? '#FFFFFF'
                      : 'rgba(255, 255, 255, 0.62)',
                  backgroundColor: isCurrent ? 'rgba(255, 209, 102, 0.16)' : 'transparent',
                  borderRadius: isCurrent ? 8 : 0,
                  padding: isCurrent ? '2px 5px' : '0',
                  boxShadow: isCurrent ? '0 0 0 1px rgba(255, 209, 102, 0.36)' : 'none',
                  borderBottom:
                    !isCurrent && isKey ? '2px solid rgba(255, 209, 102, 0.55)' : undefined,
                }}
              >
                {tok}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/** Subtle golden ornamental divider used inside calligraphy cards */
const GoldDivider: React.FC<{ width?: number }> = ({ width = 220 }) => (
  <svg width={width} height={16} viewBox={`0 0 ${width} 16`} style={{ display: 'block' }}>
    <defs>
      <linearGradient id="divGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#FFD9A0" stopOpacity="0" />
        <stop offset="50%" stopColor="#FFD166" stopOpacity="0.95" />
        <stop offset="100%" stopColor="#FFD9A0" stopOpacity="0" />
      </linearGradient>
    </defs>
    <line x1={0} y1={8} x2={width / 2 - 12} y2={8} stroke="url(#divGrad)" strokeWidth={1.6} />
    <polygon
      points={`${width / 2},2 ${width / 2 + 6},8 ${width / 2},14 ${width / 2 - 6},8`}
      fill="#FFD166"
    />
    <line x1={width / 2 + 12} y1={8} x2={width} y2={8} stroke="url(#divGrad)" strokeWidth={1.6} />
  </svg>
);

/** Reusable Arabic Calligraphy Glass Card (never clips diacritics or Thai vowels) */
const CalligraphyCard: React.FC<{
  arabic: string;
  meaning?: string;
  fontSize?: number;
  startFrame?: number;
}> = ({ arabic, meaning, fontSize = 42, startFrame = 18 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cardSpring = spring({
    frame: Math.max(0, frame - Math.max(0, startFrame - 6)),
    fps,
    config: { damping: 16, stiffness: 150, mass: 0.8 },
  });
  const y = interpolate(cardSpring, [0, 1], [28, 0]);
  const opacity = interpolate(cardSpring, [0, 0.7], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const meaningOpacity = interpolate(frame, [startFrame + 16, startFrame + 34], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 910,
        opacity,
        transform: `translate3d(0, ${y.toFixed(2)}px, 0)`,
        background:
          'linear-gradient(155deg, rgba(12, 18, 42, 0.86) 0%, rgba(20, 22, 50, 0.80) 100%)',
        borderRadius: 28,
        border: `1.5px solid ${PALETTE.glassBorder}`,
        boxShadow:
          '0 18px 46px rgba(5, 8, 22, 0.42), inset 0 1px 0 rgba(255, 244, 220, 0.22)',
        padding: '18px 34px 20px 34px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        overflow: 'visible',
      }}
    >
      <ArabicText
        text={arabic}
        fontSize={fontSize}
        color={PALETTE.goldCream}
        glow="rgba(255, 209, 102, 0.52)"
        startFrame={startFrame}
        durationFrames={36}
        maxWidth={840}
      />
      {meaning && (
        <>
          <GoldDivider width={200} />
          <div
            style={{
              opacity: meaningOpacity,
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 27,
              fontWeight: 700,
              lineHeight: 1.5,
              color: PALETTE.textSoft,
              textAlign: 'center',
              paddingTop: 4,
              paddingBottom: 4,
              textShadow: '0 2px 10px rgba(5, 8, 22, 0.6)',
            }}
          >
            {meaning}
          </div>
        </>
      )}
    </div>
  );
};

// ============================================================================
// SCENE 1: 360 JOINTS CONSTELLATION (Abstract Faceless Sacred Starlight Form)
// ============================================================================

interface ConstellationPoint {
  x: number;
  y: number;
  r: number;
  order: number;
  isMajor: boolean;
  phase: number;
}

function buildConstellationPoints(): ConstellationPoint[] {
  const pts: ConstellationPoint[] = [];
  const cx = 390;

  // Abstract sacred silhouette zones (strictly faceless luminous constellation)
  const addCluster = (
    count: number,
    seedPrefix: string,
    gen: (i: number, u: number, v: number) => [number, number],
  ) => {
    for (let i = 0; i < count; i += 1) {
      const u = random(`${seedPrefix}-u-${i}`);
      const v = random(`${seedPrefix}-v-${i}`);
      const [x, y] = gen(i, u, v);
      pts.push({
        x,
        y,
        r: 1.8 + random(`${seedPrefix}-r-${i}`) * 2.4,
        order: random(`${seedPrefix}-o-${i}`),
        isMajor: false,
        phase: random(`${seedPrefix}-p-${i}`) * Math.PI * 2,
      });
    }
  };

  // Crown halo ring (abstract ring of light — zero facial features)
  addCluster(36, 'halo', (i, u) => {
    const ang = (i / 36) * Math.PI * 2 + (u - 0.5) * 0.14;
    const rad = 36 + (u - 0.5) * 14;
    return [cx + Math.cos(ang) * rad, 92 + Math.sin(ang) * rad];
  });

  // Shoulders & upper chest nebula
  addCluster(72, 'torso-up', (_i, u, v) => {
    const t = v; // 0 top, 1 mid
    const halfW = interpolate(t, [0, 0.3, 1], [78, 92, 54]);
    return [cx + (u * 2 - 1) * halfW, 146 + t * 142];
  });

  // Lower torso & core axis
  addCluster(54, 'torso-low', (_i, u, v) => {
    const halfW = interpolate(v, [0, 1], [54, 46]);
    return [cx + (u * 2 - 1) * halfW, 288 + v * 92];
  });

  // Left graceful arm arc (open posture of gratitude)
  addCluster(52, 'arm-l', (_i, u, v) => {
    const x = interpolate(v, [0, 0.5, 1], [cx - 82, cx - 150, cx - 122]) + (u - 0.5) * 24;
    const y = interpolate(v, [0, 0.5, 1], [164, 245, 326]) + (u - 0.5) * 18;
    return [x, y];
  });

  // Right graceful arm arc
  addCluster(52, 'arm-r', (_i, u, v) => {
    const x = interpolate(v, [0, 0.5, 1], [cx + 82, cx + 150, cx + 122]) + (u - 0.5) * 24;
    const y = interpolate(v, [0, 0.5, 1], [164, 245, 326]) + (u - 0.5) * 18;
    return [x, y];
  });

  // Left & Right standing light pillars
  addCluster(42, 'leg-l', (_i, u, v) => [
    cx - 28 - v * 12 + (u - 0.5) * 24,
    380 + v * 165,
  ]);
  addCluster(42, 'leg-r', (_i, u, v) => [
    cx + 28 + v * 12 + (u - 0.5) * 24,
    380 + v * 165,
  ]);

  // 10 major glowing geometric constellation hubs (total = 360 exact points!)
  const hubs: Array<[number, number]> = [
    [cx, 92],
    [cx, 152],
    [cx - 86, 174],
    [cx + 86, 174],
    [cx, 236],
    [cx - 144, 250],
    [cx + 144, 250],
    [cx, 336],
    [cx - 34, 462],
    [cx + 34, 462],
  ];
  hubs.forEach(([x, y], idx) => {
    pts.push({
      x,
      y,
      r: 5.2,
      order: idx / hubs.length,
      isMajor: true,
      phase: idx * 0.7,
    });
  });

  return pts;
}

const CONSTELLATION_360 = buildConstellationPoints();

const CONSTELLATION_EDGES: Array<[number, number]> = [
  [350, 351],
  [351, 352],
  [351, 353],
  [351, 354],
  [352, 355],
  [353, 356],
  [354, 357],
  [352, 354],
  [353, 354],
  [357, 358],
  [357, 359],
];

const Scene1Joints360: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tSec = frame / Math.max(1, fps);

  const revealProgress = Easing.out(Easing.cubic)(
    interpolate(frame, [10, 96], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const pulseGlow = 0.75 + 0.25 * Math.sin(tSec * 2.8);

  const cardPop = spring({
    frame: Math.max(0, frame - 8),
    fps,
    config: { damping: 14, stiffness: 150, mass: 0.75 },
  });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
        width: '100%',
      }}
    >
      {/* 360-Star Constellation Visual */}
      <svg width={780} height={580} viewBox="0 0 780 580" style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id="s1Aura" cx="50%" cy="46%" r="50%">
            <stop offset="0%" stopColor="#FFD9A0" stopOpacity="0.34" />
            <stop offset="50%" stopColor="#F28C5B" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#0B1026" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="s1Star" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="45%" stopColor="#FFD166" stopOpacity="0.92" />
            <stop offset="100%" stopColor="#FFD166" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Ambient celestial aura */}
        <circle cx={390} cy={290} r={270} fill="url(#s1Aura)" opacity={pulseGlow} />

        {/* Rotating sacred astrolabe rings */}
        <g transform={`rotate(${(tSec * 5).toFixed(2)} 390 290)`} opacity={0.28}>
          <circle
            cx={390}
            cy={290}
            r={238}
            fill="none"
            stroke="#FFD9A0"
            strokeWidth={1.3}
            strokeDasharray="6 12"
          />
        </g>
        <g transform={`rotate(${(-tSec * 3.5).toFixed(2)} 390 290)`} opacity={0.22}>
          <circle
            cx={390}
            cy={290}
            r={272}
            fill="none"
            stroke="#FFE6A7"
            strokeWidth={1}
            strokeDasharray="2 14"
          />
        </g>

        {/* Constellation filaments linking major joint hubs */}
        <g opacity={interpolate(revealProgress, [0.15, 0.85], [0, 0.42], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}>
          {CONSTELLATION_EDGES.map(([aIdx, bIdx], idx) => {
            const a = CONSTELLATION_360[aIdx];
            const b = CONSTELLATION_360[bIdx];
            return (
              <line
                key={idx}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#FFE6A7"
                strokeWidth={1.6}
                strokeDasharray="4 6"
              />
            );
          })}
        </g>

        {/* All 360 deterministic golden joint star-points */}
        {CONSTELLATION_360.map((pt, idx) => {
          const lit = interpolate(
            revealProgress,
            [pt.order * 0.85, pt.order * 0.85 + 0.14],
            [0, 1],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          );
          if (lit <= 0.01) return null;
          const twinkle = 0.65 + 0.35 * Math.sin(tSec * 3.2 + pt.phase);
          const floatY = Math.sin(tSec * 1.4 + pt.phase) * 2.5;
          return (
            <g key={idx} opacity={lit * (pt.isMajor ? 1 : twinkle)}>
              {pt.isMajor && (
                <circle
                  cx={pt.x}
                  cy={pt.y + floatY}
                  r={pt.r * 3.2}
                  fill="url(#s1Star)"
                  opacity={0.55 * twinkle}
                />
              )}
              <circle
                cx={pt.x}
                cy={pt.y + floatY}
                r={pt.r}
                fill={pt.isMajor ? '#FFF9EB' : '#FFD9A0'}
              />
            </g>
          );
        })}
      </svg>

      {/* Big CountUp Counter Card (0 → 360) */}
      <div
        style={{
          transform: `scale(${interpolate(cardPop, [0, 1], [0.9, 1]).toFixed(4)})`,
          opacity: interpolate(cardPop, [0, 0.6], [0, 1], { extrapolateRight: 'clamp' }),
          background: PALETTE.glassBg,
          borderRadius: 30,
          border: `1.5px solid ${PALETTE.glassBorderStrong}`,
          boxShadow:
            '0 20px 50px rgba(5, 8, 22, 0.45), 0 0 36px rgba(255, 209, 102, 0.16)',
          padding: '16px 46px 20px 46px',
          display: 'flex',
          alignItems: 'center',
          gap: 28,
        }}
      >
        <CountUp
          from={0}
          to={360}
          startFrame={10}
          durationFrames={86}
          popScale={1.15}
          popGlowColor="#FFD166"
          style={{
            fontSize: 96,
            fontWeight: 700,
            lineHeight: 1.1,
            color: PALETTE.gold,
            textShadow: '0 0 30px rgba(255, 209, 102, 0.65)',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 34,
              fontWeight: 700,
              color: PALETTE.goldCream,
              lineHeight: 1.4,
            }}
          >
            ข้อต่อในร่างกายมนุษย์
          </div>
          <div
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 25,
              fontWeight: 700,
              color: PALETTE.goldLight,
              lineHeight: 1.44,
            }}
          >
            ทุกข้อมีหน้าที่ทำเศาะดะเกาะฮ์ทุกเช้า
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// SCENE 2: 360 DOTS CONVERGING INTO ONE RADIANT ORB (2 RAKAAT DHUHA)
// ============================================================================

const SWIRL_MOTES = Array.from({ length: 120 }, (_, i) => {
  const angle = (i / 120) * Math.PI * 2 + random(`s2-a-${i}`) * 0.4;
  const dist = 140 + random(`s2-d-${i}`) * 235;
  return {
    angle,
    dist,
    size: 2.2 + random(`s2-s-${i}`) * 3.0,
    delay: random(`s2-dl-${i}`) * 0.25,
    spin: 1.8 + random(`s2-sp-${i}`) * 1.4,
  };
});

const Scene2TwoRakaat: React.FC<{ arabic?: string; arabicMeaning?: string }> = ({
  arabic,
  arabicMeaning,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tSec = frame / Math.max(1, fps);

  const convergeT = Easing.inOut(Easing.cubic)(
    interpolate(frame, [8, 92], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );

  const orbScale = spring({
    frame: Math.max(0, frame - 68),
    fps,
    config: { damping: 12, stiffness: 130, mass: 0.8 },
  });

  const cx = 420;
  const cy = 215;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 18,
        width: '100%',
      }}
    >
      <svg width={840} height={445} viewBox="0 0 840 445" style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id="s2Orb" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="32%" stopColor="#FFF4DC" stopOpacity="0.96" />
            <stop offset="68%" stopColor="#FFD166" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#F28C5B" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="s2Arch" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FFE6A7" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#FFD166" stopOpacity="0.22" />
          </linearGradient>
        </defs>

        {/* Sacred Islamic Mihrab Arch Framing */}
        <path
          d="M 210 420 L 210 210 Q 210 68 420 26 Q 630 68 630 210 L 630 420"
          fill="rgba(12, 18, 42, 0.34)"
          stroke="url(#s2Arch)"
          strokeWidth={2.4}
        />
        <path
          d="M 232 420 L 232 214 Q 232 90 420 50 Q 608 90 608 214 L 608 420"
          fill="none"
          stroke="#FFD9A0"
          strokeWidth={1.1}
          strokeDasharray="6 8"
          opacity={0.45}
        />

        {/* Abstract geometric prayer mat (sajjadah) pedestal at base */}
        <g opacity={0.85}>
          <polygon
            points="272,418 568,418 538,376 302,376"
            fill="rgba(255, 209, 102, 0.14)"
            stroke="#FFD9A0"
            strokeWidth={1.6}
          />
          <polygon
            points="318,408 522,408 504,386 336,386"
            fill="none"
            stroke="#FFE6A7"
            strokeWidth={1}
            opacity={0.65}
          />
        </g>

        {/* Two luminous rings symbolizing 2 Rakaat */}
        <g opacity={interpolate(orbScale, [0, 1], [0.15, 0.92])}>
          <circle
            cx={cx}
            cy={cy}
            r={96 + Math.sin(tSec * 2.2) * 4}
            fill="none"
            stroke="#FFD166"
            strokeWidth={2.4}
          />
          <circle
            cx={cx}
            cy={cy}
            r={126 - Math.sin(tSec * 2.2) * 4}
            fill="none"
            stroke="#FFE6A7"
            strokeWidth={1.6}
            strokeDasharray="10 8"
            opacity={0.78}
          />
        </g>

        {/* 120 swirling golden motes (representing 360 joints) coalescing into 1 luminous orb */}
        {SWIRL_MOTES.map((m, idx) => {
          const localP = interpolate(convergeT, [m.delay, Math.min(1, m.delay + 0.75)], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          const curDist = m.dist * (1 - localP);
          const curAng = m.angle + localP * m.spin * Math.PI + tSec * 0.45;
          const x = cx + Math.cos(curAng) * curDist;
          const y = cy + Math.sin(curAng) * curDist * 0.72;
          const op = interpolate(localP, [0, 0.8, 1], [0.92, 0.95, 0]);
          if (op <= 0.01) return null;
          return (
            <circle key={idx} cx={x} cy={y} r={m.size * (1 - localP * 0.35)} fill="#FFE6A7" opacity={op} />
          );
        })}

        {/* Central Coalesced Orb of Light */}
        <circle
          cx={cx}
          cy={cy}
          r={48 + convergeT * 68 + orbScale * 18}
          fill="url(#s2Orb)"
          opacity={0.35 + convergeT * 0.65}
        />
        <circle
          cx={cx}
          cy={cy}
          r={24 + convergeT * 36}
          fill="#FFF9EB"
          opacity={0.85}
        />

        {/* Crisp "2 ร็อกอะฮ์" emblem inside the glowing orb */}
        <g opacity={interpolate(orbScale, [0.1, 0.9], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}>
          <text
            x={cx}
            y={cy - 10}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#1B1638"
            fontFamily={THAI_FONT_FAMILY}
            fontWeight={700}
            fontSize={58}
          >
            2
          </text>
          <text
            x={cx}
            y={cy + 34}
            textAnchor="middle"
            fill="#1B1638"
            fontFamily={THAI_FONT_FAMILY}
            fontWeight={700}
            fontSize={22}
          >
            ร็อกอะฮ์
          </text>
        </g>

        {/* Left & Right equivalence pills */}
        <g opacity={interpolate(frame, [26, 46], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}>
          <rect
            x={30}
            y={184}
            width={162}
            height={66}
            rx={20}
            fill="rgba(10, 15, 36, 0.72)"
            stroke="rgba(255, 217, 160, 0.45)"
            strokeWidth={1.5}
          />
          <text
            x={111}
            y={212}
            textAnchor="middle"
            fill="#FFD166"
            fontFamily={THAI_FONT_FAMILY}
            fontWeight={700}
            fontSize={26}
          >
            360 ข้อต่อ
          </text>
          <text
            x={111}
            y={238}
            textAnchor="middle"
            fill="#FFF4DC"
            fontFamily={THAI_FONT_FAMILY}
            fontWeight={700}
            fontSize={18}
          >
            เศาะดะเกาะฮ์ทุกวัน
          </text>
        </g>

        <g opacity={interpolate(frame, [72, 92], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}>
          <rect
            x={648}
            y={184}
            width={166}
            height={66}
            rx={20}
            fill="rgba(10, 15, 36, 0.72)"
            stroke="rgba(74, 222, 168, 0.65)"
            strokeWidth={1.6}
          />
          <text
            x={731}
            y={212}
            textAnchor="middle"
            fill="#4ADEA8"
            fontFamily={THAI_FONT_FAMILY}
            fontWeight={700}
            fontSize={25}
          >
            เพียงพอแล้ว
          </text>
          <text
            x={731}
            y={238}
            textAnchor="middle"
            fill="#FFF4DC"
            fontFamily={THAI_FONT_FAMILY}
            fontWeight={700}
            fontSize={18}
          >
            แทนทั้งหมด
          </text>
        </g>
      </svg>

      {arabic && (
        <CalligraphyCard
          arabic={arabic}
          meaning={arabicMeaning}
          fontSize={40}
          startFrame={24}
        />
      )}
    </div>
  );
};

// ============================================================================
// SCENE 3: HADITH QUDSI — PROTECTIVE DOME OF LIGHT FROM DAWN TO DUSK
// ============================================================================

const Scene3QudsiShield: React.FC<{ arabic?: string; arabicMeaning?: string }> = ({
  arabic,
  arabicMeaning,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tSec = frame / Math.max(1, fps);

  const arcDraw = Easing.inOut(Easing.quad)(
    interpolate(frame, [10, 125], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );

  // Sun travels along the semi-elliptical dome path from left (dawn) to right (dusk)
  const cx = 420;
  const baseY = 365;
  const rx = 310;
  const ry = 275;
  const theta = interpolate(arcDraw, [0, 1], [Math.PI, 0]);
  const sunX = cx + Math.cos(theta) * rx;
  const sunY = baseY - Math.sin(theta) * ry;

  // Approximate semi-ellipse arc length for strokeDashoffset
  const arcLen = 960;
  const dashOffset = arcLen * (1 - arcDraw);
  const shieldPulse = 0.72 + 0.28 * Math.sin(tSec * 2.4);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 18,
        width: '100%',
      }}
    >
      <svg width={840} height={445} viewBox="0 0 840 445" style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id="s3DomeFill" cx="50%" cy="85%" r="68%">
            <stop offset="0%" stopColor="#FFD166" stopOpacity="0.34" />
            <stop offset="55%" stopColor="#F28C5B" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#FFD9A0" stopOpacity="0.02" />
          </radialGradient>
          <linearGradient id="s3ArcGrad" x1="0%" y1="100%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F28C5B" />
            <stop offset="50%" stopColor="#FFF4DC" />
            <stop offset="100%" stopColor="#FFD166" />
          </linearGradient>
          <radialGradient id="s3SunOrb" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="45%" stopColor="#FFD166" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#F28C5B" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Protective luminous dome fill */}
        <path
          d={`M ${cx - rx} ${baseY} A ${rx} ${ry} 0 0 1 ${cx + rx} ${baseY} Z`}
          fill="url(#s3DomeFill)"
          opacity={arcDraw * shieldPulse}
        />

        {/* Inner concentric sacred protective arch */}
        <path
          d={`M ${cx - rx + 42} ${baseY} A ${rx - 42} ${ry - 38} 0 0 1 ${cx + rx - 42} ${baseY}`}
          fill="none"
          stroke="#FFE6A7"
          strokeWidth={1.3}
          strokeDasharray="6 10"
          opacity={0.45 * arcDraw}
        />

        {/* Horizon ground line */}
        <line
          x1={60}
          y1={baseY}
          x2={780}
          y2={baseY}
          stroke="rgba(255, 217, 160, 0.45)"
          strokeWidth={2}
        />

        {/* 4 glowing vertical light pillars inside the dome (representing 4 Rakaat) */}
        {[0, 1, 2, 3].map((pIdx) => {
          const px = cx - 108 + pIdx * 72;
          const pSpring = spring({
            frame: Math.max(0, frame - (16 + pIdx * 10)),
            fps,
            config: { damping: 14, stiffness: 140 },
          });
          const pH = 128 * pSpring;
          return (
            <g key={pIdx} opacity={pSpring * 0.92}>
              <rect
                x={px - 10}
                y={baseY - pH}
                width={20}
                height={pH}
                rx={10}
                fill="rgba(255, 217, 160, 0.25)"
                stroke="#FFD166"
                strokeWidth={1.6}
              />
              <circle cx={px} cy={baseY - pH - 12} r={5} fill="#FFF4DC" />
            </g>
          );
        })}

        {/* Animated Solar Dome Arc */}
        <path
          d={`M ${cx - rx} ${baseY} A ${rx} ${ry} 0 0 1 ${cx + rx} ${baseY}`}
          fill="none"
          stroke="url(#s3ArcGrad)"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={arcLen}
          strokeDashoffset={dashOffset}
        />

        {/* Traveling radiant Sun orb */}
        <circle cx={sunX} cy={sunY} r={46} fill="url(#s3SunOrb)" opacity={0.85} />
        <circle cx={sunX} cy={sunY} r={16} fill="#FFFFFF" />

        {/* Central Dome Protection Label */}
        <g opacity={interpolate(frame, [52, 74], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}>
          <rect
            x={cx - 170}
            y={146}
            width={340}
            height={60}
            rx={30}
            fill="rgba(10, 15, 36, 0.76)"
            stroke="#FFD166"
            strokeWidth={1.6}
          />
          <text
            x={cx}
            y={178}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#FFF4DC"
            fontFamily={THAI_FONT_FAMILY}
            fontWeight={700}
            fontSize={25}
          >
            โดมแห่งความคุ้มครองตลอดวัน
          </text>
        </g>

        {/* Dawn (Start) & Dusk (End) Axis Markers */}
        <g>
          <circle cx={cx - rx} cy={baseY} r={8} fill="#F28C5B" stroke="#FFF4DC" strokeWidth={2} />
          <text
            x={cx - rx}
            y={baseY + 34}
            textAnchor="middle"
            fill="#FFE6A7"
            fontFamily={THAI_FONT_FAMILY}
            fontWeight={700}
            fontSize={24}
          >
            ต้นวัน
          </text>
          <text
            x={cx - rx}
            y={baseY + 62}
            textAnchor="middle"
            fill="#FFF4DC"
            fontFamily={THAI_FONT_FAMILY}
            fontWeight={700}
            fontSize={20}
            opacity={0.85}
          >
            4 ร็อกอะฮ์
          </text>
        </g>

        <g>
          <circle cx={cx + rx} cy={baseY} r={8} fill="#FFD166" stroke="#FFF4DC" strokeWidth={2} />
          <text
            x={cx + rx}
            y={baseY + 34}
            textAnchor="middle"
            fill="#FFD166"
            fontFamily={THAI_FONT_FAMILY}
            fontWeight={700}
            fontSize={24}
          >
            ท้ายวัน
          </text>
          <text
            x={cx + rx}
            y={baseY + 62}
            textAnchor="middle"
            fill="#FFF4DC"
            fontFamily={THAI_FONT_FAMILY}
            fontWeight={700}
            fontSize={20}
            opacity={0.85}
          >
            อัลลอฮ์ ﷻ ดูแล
          </text>
        </g>
      </svg>

      {arabic && (
        <CalligraphyCard
          arabic={arabic}
          meaning={arabicMeaning}
          fontSize={38}
          startFrame={20}
        />
      )}
    </div>
  );
};

// ============================================================================
// SCENE 4: 3 WASIYYAH FLIPPING CARDS (Bukhari 1981 · Muslim 721)
// ============================================================================

const WASIYYAH_ITEMS = [
  {
    num: '01',
    title: 'ถือศีลอด 3 วันทุกเดือน',
    desc: 'ซุนนะฮ์อัยยามุลบีฎ ฝึกความอดทนและขอบคุณ',
    icon: 'crescent' as const,
    delay: 14,
    isHero: false,
  },
  {
    num: '02',
    title: 'ละหมาดฎุฮา 2 ร็อกอะฮ์',
    desc: 'เติมพลังศรัทธายามสาย — กิจวัตรที่ไม่เคยละทิ้ง',
    icon: 'sun' as const,
    delay: 54,
    isHero: true,
  },
  {
    num: '03',
    title: 'ละหมาดวิตรฺก่อนนอน',
    desc: 'ปิดท้ายค่ำคืนอย่างสงบและอบอุ่นหัวใจ',
    icon: 'star' as const,
    delay: 98,
    isHero: false,
  },
];

const WasiyyahIcon: React.FC<{ kind: 'crescent' | 'sun' | 'star' }> = ({ kind }) => {
  if (kind === 'sun') {
    return (
      <svg width={62} height={62} viewBox="0 0 62 62">
        <circle cx={31} cy={31} r={14} fill="#FFD166" />
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4;
          return (
            <line
              key={i}
              x1={31 + Math.cos(a) * 19}
              y1={31 + Math.sin(a) * 19}
              x2={31 + Math.cos(a) * 27}
              y2={31 + Math.sin(a) * 27}
              stroke="#FFF4DC"
              strokeWidth={3}
              strokeLinecap="round"
            />
          );
        })}
      </svg>
    );
  }
  if (kind === 'crescent') {
    return (
      <svg width={62} height={62} viewBox="0 0 62 62">
        <path
          d="M 38 14 A 18 18 0 1 0 47 45 A 14 14 0 1 1 38 14 Z"
          fill="#FFE6A7"
        />
        <circle cx={44} cy={22} r={2.8} fill="#FFF4DC" />
      </svg>
    );
  }
  return (
    <svg width={62} height={62} viewBox="0 0 62 62">
      <polygon
        points="31,10 36,24 51,24 39,33 43,48 31,39 19,48 23,33 11,24 26,24"
        fill="none"
        stroke="#FFE6A7"
        strokeWidth={2.8}
        strokeLinejoin="round"
      />
      <circle cx={31} cy={30} r={5} fill="#FFD166" />
    </svg>
  );
};

const Scene4ThreeWasiyyah: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tSec = frame / Math.max(1, fps);

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 910,
        display: 'flex',
        flexDirection: 'column',
        gap: 26,
        paddingTop: 12,
      }}
    >
      {WASIYYAH_ITEMS.map((item) => {
        const flip = spring({
          frame: Math.max(0, frame - item.delay),
          fps,
          config: { damping: 14, stiffness: 130, mass: 0.85 },
        });
        const scaleY = interpolate(flip, [0, 1], [0.76, 1]);
        const scaleX = interpolate(flip, [0, 1], [0.94, 1]);
        const y = interpolate(flip, [0, 1], [44, 0]);
        const op = interpolate(flip, [0, 0.45], [0, 1], { extrapolateRight: 'clamp' });
        const heroPulse = item.isHero ? 1 + 0.014 * Math.sin(tSec * 3.0) : 1;

        return (
          <div
            key={item.num}
            style={{
              opacity: op,
              transform: `translateY(${y.toFixed(1)}px) scale(${(scaleX * heroPulse).toFixed(4)}, ${(scaleY * heroPulse).toFixed(4)})`,
              transformOrigin: '50% 0%',
              background: item.isHero
                ? 'linear-gradient(135deg, rgba(34, 28, 66, 0.90) 0%, rgba(74, 48, 32, 0.86) 100%)'
                : PALETTE.glassBg,
              borderRadius: 28,
              border: item.isHero
                ? '2.5px solid #FFD166'
                : `1.5px solid ${PALETTE.glassBorder}`,
              boxShadow: item.isHero
                ? '0 22px 54px rgba(5, 8, 22, 0.5), 0 0 38px rgba(255, 209, 102, 0.34)'
                : '0 16px 36px rgba(5, 8, 22, 0.36)',
              padding: '24px 32px',
              display: 'flex',
              alignItems: 'center',
              gap: 24,
            }}
          >
            {/* Medallion Icon */}
            <div
              style={{
                width: 88,
                height: 88,
                borderRadius: 24,
                flexShrink: 0,
                background: item.isHero
                  ? 'linear-gradient(135deg, rgba(255, 209, 102, 0.32), rgba(242, 140, 91, 0.25))'
                  : 'rgba(255, 244, 220, 0.08)',
                border: `1.5px solid ${item.isHero ? '#FFD166' : 'rgba(255, 217, 160, 0.3)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <WasiyyahIcon kind={item.icon} />
            </div>

            {/* Text Column */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span
                  style={{
                    fontFamily: THAI_FONT_FAMILY,
                    fontSize: 20,
                    fontWeight: 700,
                    color: item.isHero ? '#141836' : PALETTE.gold,
                    background: item.isHero ? '#FFD166' : 'rgba(255, 209, 102, 0.16)',
                    borderRadius: 999,
                    padding: '4px 14px',
                    lineHeight: 1.35,
                  }}
                >
                  {item.isHero ? `ข้อที่ ${item.num} · หัวใจยามเช้า` : `ข้อที่ ${item.num}`}
                </span>
              </div>
              <div
                style={{
                  fontFamily: THAI_FONT_FAMILY,
                  fontSize: 38,
                  fontWeight: 700,
                  color: item.isHero ? '#FFF4DC' : '#FFFFFF',
                  lineHeight: 1.4,
                  paddingTop: 2,
                  paddingBottom: 2,
                }}
              >
                {item.title}
              </div>
              <div
                style={{
                  fontFamily: THAI_FONT_FAMILY,
                  fontSize: 24,
                  fontWeight: 700,
                  color: PALETTE.textSoft,
                  lineHeight: 1.44,
                }}
              >
                {item.desc}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ============================================================================
// SCENE 5: SALAT AL-AWWABIN (Mid-Morning Radiance + Rotating Geometric Star)
// ============================================================================

const Scene5Awwabin: React.FC<{ arabic?: string; arabicMeaning?: string }> = ({
  arabic,
  arabicMeaning,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tSec = frame / Math.max(1, fps);

  const starScale = spring({
    frame: Math.max(0, frame - 8),
    fps,
    config: { damping: 15, stiffness: 120 },
  });

  const cx = 420;
  const cy = 205;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 18,
        width: '100%',
      }}
    >
      <svg width={840} height={425} viewBox="0 0 840 425" style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id="s5Sun" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.98" />
            <stop offset="35%" stopColor="#FFD9A0" stopOpacity="0.72" />
            <stop offset="70%" stopColor="#F28C5B" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#F28C5B" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="s5Dune1" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#E69B56" stopOpacity="0.52" />
            <stop offset="100%" stopColor="#2A1E45" stopOpacity="0.78" />
          </linearGradient>
          <linearGradient id="s5Dune2" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#C47842" stopOpacity="0.62" />
            <stop offset="100%" stopColor="#14132C" stopOpacity="0.88" />
          </linearGradient>
        </defs>

        {/* Concentric glowing spiritual ripples returning to center */}
        {[0, 1, 2, 3].map((ringIdx) => {
          const phase = (tSec * 0.45 + ringIdx * 0.25) % 1;
          const r = 64 + phase * 180;
          const op = (1 - phase) * 0.45;
          return (
            <circle
              key={ringIdx}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke="#FFE6A7"
              strokeWidth={1.8}
              opacity={op}
            />
          );
        })}

        {/* Warm solar radiance */}
        <circle cx={cx} cy={cy} r={195} fill="url(#s5Sun)" />

        {/* Slowly rotating 8-pointed Rub el Hizb sacred star */}
        <g
          transform={`translate(${cx}, ${cy}) scale(${starScale.toFixed(4)}) rotate(${(tSec * 9).toFixed(2)})`}
        >
          <rect
            x={-84}
            y={-84}
            width={168}
            height={168}
            rx={6}
            fill="rgba(16, 20, 48, 0.34)"
            stroke="#FFD166"
            strokeWidth={2.6}
          />
          <rect
            x={-84}
            y={-84}
            width={168}
            height={168}
            rx={6}
            fill="rgba(16, 20, 48, 0.24)"
            stroke="#FFF4DC"
            strokeWidth={2.2}
            transform="rotate(45)"
          />
          <rect
            x={-52}
            y={-52}
            width={104}
            height={104}
            fill="none"
            stroke="#FFE6A7"
            strokeWidth={1.5}
            opacity={0.78}
          />
          <rect
            x={-52}
            y={-52}
            width={104}
            height={104}
            fill="none"
            stroke="#FFE6A7"
            strokeWidth={1.5}
            opacity={0.78}
            transform="rotate(45)"
          />
          <circle cx={0} cy={0} r={24} fill="#FFF4DC" opacity={0.95} />
          <circle cx={0} cy={0} r={12} fill="#FFD166" />
        </g>

        {/* Minimalist golden desert dunes horizon (evoking mid-morning warmth) */}
        <path
          d="M 20 400 Q 210 318 420 358 Q 640 398 820 332 L 820 420 L 20 420 Z"
          fill="url(#s5Dune1)"
        />
        <path
          d="M 20 412 Q 250 368 480 384 Q 680 398 820 366 L 820 422 L 20 422 Z"
          fill="url(#s5Dune2)"
        />

        {/* Mid-morning warm sun badge */}
        <g opacity={interpolate(frame, [26, 48], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}>
          <rect
            x={210}
            y={356}
            width={420}
            height={52}
            rx={26}
            fill="rgba(10, 15, 36, 0.78)"
            stroke="rgba(255, 209, 102, 0.55)"
            strokeWidth={1.5}
          />
          <text
            x={420}
            y={383}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#FFE6A7"
            fontFamily={THAI_FONT_FAMILY}
            fontWeight={700}
            fontSize={23}
          >
            เวลาดีที่สุด · ยามสายเมื่อแดดเริ่มอุ่น
          </text>
        </g>
      </svg>

      {arabic && (
        <CalligraphyCard
          arabic={arabic}
          meaning={arabicMeaning}
          fontSize={62}
          startFrame={18}
        />
      )}
    </div>
  );
};

// ============================================================================
// SCENE 6: DHUHA TIME DIAL + 2 / 4 / 8 RAKAAT SELECTOR
// ============================================================================

const RAKAAT_OPTIONS = [
  { num: '2', label: 'เริ่มต้นง่ายที่สุด', note: 'ใช้เวลา 3–5 นาที', delay: 78, highlight: true },
  { num: '4', label: 'เพิ่มความจำเริญ', note: 'หะดีษกุดซีย์ดูแลทั้งวัน', delay: 96, highlight: false },
  { num: '8', label: 'ตามซุนนะฮ์เต็มอิ่ม', note: 'ทำทีละ 2 ร็อกอะฮ์', delay: 114, highlight: false },
];

const Scene6TimeRakaat: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const dialProgress = Easing.out(Easing.cubic)(
    interpolate(frame, [10, 95], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );

  const cx = 430;
  const cy = 350;
  const R = 258;

  // Angles in radians (Math.PI = left horizon sunrise, 0 = right zenith/Dhuhr)
  const startAngle = Math.PI * 0.86; // ~15-20 min after sunrise
  const endAngle = Math.PI * 0.10; // ~10 min before Dhuhr
  const peakAngle = Math.PI * 0.34; // Best time (mid-morning heat)
  const curSunAngle = interpolate(dialProgress, [0, 1], [startAngle, peakAngle]);

  const pt = (ang: number, rad = R) => ({
    x: cx + Math.cos(ang) * rad,
    y: cy - Math.sin(ang) * rad,
  });

  const pStart = pt(startAngle);
  const pEnd = pt(endAngle);
  const pBest0 = pt(Math.PI * 0.48);
  const pBest1 = pt(Math.PI * 0.22);
  const pSun = pt(curSunAngle);

  const activeArcPath = `M ${pStart.x.toFixed(1)} ${pStart.y.toFixed(1)} A ${R} ${R} 0 0 1 ${pEnd.x.toFixed(1)} ${pEnd.y.toFixed(1)}`;
  const bestArcPath = `M ${pBest0.x.toFixed(1)} ${pBest0.y.toFixed(1)} A ${R} ${R} 0 0 1 ${pBest1.x.toFixed(1)} ${pBest1.y.toFixed(1)}`;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 24,
        width: '100%',
      }}
    >
      {/* Astronomical Dhuha Solar Dial */}
      <svg width={860} height={445} viewBox="0 0 860 445" style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id="s6Glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="45%" stopColor="#FFD166" stopOpacity="0.92" />
            <stop offset="100%" stopColor="#FFD166" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Frosted semi-circular dial plate */}
        <path
          d={`M ${cx - R - 26} ${cy} A ${R + 26} ${R + 26} 0 0 1 ${cx + R + 26} ${cy} Z`}
          fill="rgba(10, 15, 36, 0.56)"
          stroke="rgba(255, 217, 160, 0.26)"
          strokeWidth={1.6}
        />

        {/* Tick marks around arc */}
        {Array.from({ length: 19 }, (_, idx) => {
          const ang = Math.PI - (idx / 18) * Math.PI;
          const p0 = pt(ang, R - 18);
          const p1 = pt(ang, R - (idx % 3 === 0 ? 34 : 26));
          return (
            <line
              key={idx}
              x1={p0.x}
              y1={p0.y}
              x2={p1.x}
              y2={p1.y}
              stroke="rgba(255, 244, 220, 0.42)"
              strokeWidth={idx % 3 === 0 ? 2.4 : 1.3}
            />
          );
        })}

        {/* Full base morning-to-noon track */}
        <path
          d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`}
          fill="none"
          stroke="rgba(255, 255, 255, 0.16)"
          strokeWidth={16}
          strokeLinecap="round"
        />

        {/* Active Dhuha Window Arc */}
        <path
          d={activeArcPath}
          fill="none"
          stroke="#FFD166"
          strokeWidth={16}
          strokeLinecap="round"
          opacity={0.92}
        />

        {/* Peak Best-Time Sector */}
        <path
          d={bestArcPath}
          fill="none"
          stroke="#4ADEA8"
          strokeWidth={18}
          strokeLinecap="round"
          opacity={interpolate(dialProgress, [0.45, 1], [0, 0.95], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })}
        />

        {/* Horizon baseline */}
        <line x1={88} y1={cy} x2={772} y2={cy} stroke="rgba(255, 217, 160, 0.55)" strokeWidth={2} />

        {/* Animated Sun marker on dial */}
        <circle cx={pSun.x} cy={pSun.y} r={38} fill="url(#s6Glow)" />
        <circle cx={pSun.x} cy={pSun.y} r={14} fill="#FFFFFF" stroke="#FFD166" strokeWidth={3} />

        {/* Center Readout inside the dial */}
        <text
          x={cx}
          y={cy - 110}
          textAnchor="middle"
          fill="#4ADEA8"
          fontFamily={THAI_FONT_FAMILY}
          fontWeight={700}
          fontSize={24}
        >
          ช่วงเวลาละหมาดฎุฮา
        </text>
        <text
          x={cx}
          y={cy - 64}
          textAnchor="middle"
          fill="#FFF4DC"
          fontFamily={THAI_FONT_FAMILY}
          fontWeight={700}
          fontSize={38}
        >
          สายๆ ของทุกวัน
        </text>
        <text
          x={cx}
          y={cy - 22}
          textAnchor="middle"
          fill="#FFE6A7"
          fontFamily={THAI_FONT_FAMILY}
          fontWeight={700}
          fontSize={22}
        >
          แถบสีเขียว = เวลาประเสริฐที่สุด (แดดอุ่น)
        </text>

        {/* Left Start Callout (high-contrast glass pill over bright morning sky) */}
        <circle cx={pStart.x} cy={pStart.y} r={8} fill="#FFD166" stroke="#101632" strokeWidth={2.5} />
        <rect
          x={44}
          y={cy + 14}
          width={280}
          height={72}
          rx={18}
          fill="rgba(10, 15, 36, 0.72)"
          stroke="rgba(255, 209, 102, 0.45)"
          strokeWidth={1.4}
        />
        <text
          x={184}
          y={cy + 42}
          textAnchor="middle"
          fill="#FFD166"
          fontFamily={THAI_FONT_FAMILY}
          fontWeight={700}
          fontSize={23}
        >
          เริ่ม: หลังตะวันขึ้น
        </text>
        <text
          x={184}
          y={cy + 71}
          textAnchor="middle"
          fill="#FFF4DC"
          fontFamily={THAI_FONT_FAMILY}
          fontWeight={700}
          fontSize={21}
        >
          +15 ถึง 20 นาที
        </text>

        {/* Right End Callout (high-contrast glass pill over bright morning sky) */}
        <circle cx={pEnd.x} cy={pEnd.y} r={8} fill="#F28C5B" stroke="#101632" strokeWidth={2.5} />
        <rect
          x={536}
          y={cy + 14}
          width={280}
          height={72}
          rx={18}
          fill="rgba(10, 15, 36, 0.72)"
          stroke="rgba(255, 176, 136, 0.5)"
          strokeWidth={1.4}
        />
        <text
          x={676}
          y={cy + 42}
          textAnchor="middle"
          fill="#FFB48A"
          fontFamily={THAI_FONT_FAMILY}
          fontWeight={700}
          fontSize={23}
        >
          สิ้นสุด: ก่อนซุฮรี
        </text>
        <text
          x={676}
          y={cy + 71}
          textAnchor="middle"
          fill="#FFF4DC"
          fontFamily={THAI_FONT_FAMILY}
          fontWeight={700}
          fontSize={21}
        >
          ประมาณ 10 นาที
        </text>
      </svg>

      {/* 2 · 4 · 8 Rakaat Pills */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 20,
          width: '100%',
          maxWidth: 910,
        }}
      >
        {RAKAAT_OPTIONS.map((opt) => {
          const pop = spring({
            frame: Math.max(0, frame - opt.delay),
            fps,
            config: { damping: 13, stiffness: 170, mass: 0.7 },
          });
          return (
            <div
              key={opt.num}
              style={{
                flex: 1,
                opacity: interpolate(pop, [0, 0.5], [0, 1], { extrapolateRight: 'clamp' }),
                transform: `translate3d(0, ${interpolate(pop, [0, 1], [32, 0]).toFixed(1)}px, 0) scale(${interpolate(pop, [0, 1], [0.9, 1]).toFixed(4)})`,
                background: opt.highlight
                  ? 'linear-gradient(155deg, rgba(46, 36, 78, 0.90) 0%, rgba(86, 56, 30, 0.86) 100%)'
                  : PALETTE.glassBg,
                borderRadius: 26,
                border: opt.highlight
                  ? '2.5px solid #FFD166'
                  : `1.5px solid ${PALETTE.glassBorder}`,
                boxShadow: opt.highlight
                  ? '0 16px 38px rgba(5, 8, 22, 0.45), 0 0 28px rgba(255, 209, 102, 0.3)'
                  : '0 14px 30px rgba(5, 8, 22, 0.34)',
                padding: '20px 16px 22px 16px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontFamily: THAI_FONT_FAMILY,
                  fontSize: 64,
                  fontWeight: 700,
                  lineHeight: 1.05,
                  color: opt.highlight ? '#FFD166' : '#FFF4DC',
                  textShadow: opt.highlight ? '0 0 22px rgba(255, 209, 102, 0.6)' : undefined,
                }}
              >
                {opt.num}
              </div>
              <div
                style={{
                  fontFamily: THAI_FONT_FAMILY,
                  fontSize: 23,
                  fontWeight: 700,
                  color: '#FFE6A7',
                  lineHeight: 1.35,
                }}
              >
                ร็อกอะฮ์
              </div>
              <div
                style={{
                  fontFamily: THAI_FONT_FAMILY,
                  fontSize: 21,
                  fontWeight: 700,
                  color: '#FFFFFF',
                  lineHeight: 1.4,
                  paddingTop: 4,
                }}
              >
                {opt.label}
              </div>
              <div
                style={{
                  fontFamily: THAI_FONT_FAMILY,
                  fontSize: 18,
                  fontWeight: 700,
                  color: PALETTE.textSoft,
                  lineHeight: 1.4,
                }}
              >
                {opt.note}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// SCENE 7: 7-DAY STREAK RING CTA + WALLAHU A'LAM
// ============================================================================

const Scene7ChallengeCTA: React.FC<{ arabic?: string }> = ({ arabic }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tSec = frame / Math.max(1, fps);

  const cx = 400;
  const cy = 248;
  const ringR = 186;
  const circumference = 2 * Math.PI * ringR;

  // Sweep ring lighting up day 1 -> day 7 sequentially
  const streakProgress = Easing.inOut(Easing.quad)(
    interpolate(frame, [14, 140], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );

  const completedDays = Math.min(7, Math.floor(streakProgress * 7.25));
  const glowPulse = 0.8 + 0.2 * Math.sin(tSec * 3.0);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 18,
        width: '100%',
      }}
    >
      <svg width={800} height={496} viewBox="0 0 800 496" style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id="s7CenterGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFD166" stopOpacity="0.34" />
            <stop offset="65%" stopColor="#F28C5B" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#0B1026" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="s7RingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFD166" />
            <stop offset="50%" stopColor="#FFF4DC" />
            <stop offset="100%" stopColor="#4ADEA8" />
          </linearGradient>
        </defs>

        {/* Central luminous backdrop */}
        <circle cx={cx} cy={cy} r={225} fill="url(#s7CenterGlow)" opacity={glowPulse} />
        <circle
          cx={cx}
          cy={cy}
          r={ringR - 22}
          fill="rgba(10, 15, 36, 0.62)"
          stroke="rgba(255, 217, 160, 0.28)"
          strokeWidth={1.6}
        />

        {/* Track ring */}
        <circle
          cx={cx}
          cy={cy}
          r={ringR}
          fill="none"
          stroke="rgba(255, 244, 220, 0.16)"
          strokeWidth={14}
        />

        {/* Illuminated 7-day progress ring */}
        <circle
          cx={cx}
          cy={cy}
          r={ringR}
          fill="none"
          stroke="url(#s7RingGrad)"
          strokeWidth={14}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - streakProgress)}
          transform={`rotate(-90 ${cx} ${cy})`}
        />

        {/* 7 Day Streak Nodes around the circle */}
        {Array.from({ length: 7 }, (_, i) => {
          const dayNum = i + 1;
          const angle = -Math.PI / 2 + (i / 7) * Math.PI * 2;
          const nx = cx + Math.cos(angle) * ringR;
          const ny = cy + Math.sin(angle) * ringR;
          const triggerFrame = 18 + i * 17;
          const lit = spring({
            frame: Math.max(0, frame - triggerFrame),
            fps,
            config: { damping: 11, stiffness: 200, mass: 0.6 },
          });
          const isLit = frame >= triggerFrame;
          const nodeScale = isLit ? 0.85 + lit * 0.25 : 0.85;

          const cosA = Math.cos(angle);
          const sinA = Math.sin(angle);
          const labelAnchor: 'start' | 'end' | 'middle' =
            i === 0 ? 'middle' : cosA > 0.25 ? 'start' : cosA < -0.25 ? 'end' : 'middle';
          const labelX =
            i === 0 ? 0 : cosA > 0.25 ? cosA * 38 + 4 : cosA < -0.25 ? cosA * 38 - 4 : cosA * 46;
          const labelY = i === 0 ? -46 : sinA * 48;

          return (
            <g
              key={dayNum}
              transform={`translate(${nx.toFixed(1)}, ${ny.toFixed(1)}) scale(${nodeScale.toFixed(3)})`}
            >
              {isLit && (
                <circle r={34} fill="#FFD166" opacity={0.22 * glowPulse} />
              )}
              <circle
                r={25}
                fill={isLit ? '#FFD166' : 'rgba(14, 20, 46, 0.88)'}
                stroke={isLit ? '#FFF4DC' : 'rgba(255, 217, 160, 0.45)'}
                strokeWidth={2.4}
              />
              {isLit ? (
                <path
                  d="M -9 1 L -2.5 7.5 L 10 -6.5"
                  fill="none"
                  stroke="#121736"
                  strokeWidth={3.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : (
                <text
                  x={0}
                  y={2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#FFE6A7"
                  fontFamily={THAI_FONT_FAMILY}
                  fontWeight={700}
                  fontSize={21}
                >
                  {dayNum}
                </text>
              )}
              {/* Outer day label (positioned cleanly outside circle with high-contrast stroke halo) */}
              <text
                x={labelX}
                y={labelY}
                textAnchor={labelAnchor}
                dominantBaseline="central"
                fill={isLit ? '#FFF4DC' : 'rgba(255, 244, 220, 0.78)'}
                stroke="rgba(10, 15, 36, 0.72)"
                strokeWidth={4}
                paintOrder="stroke"
                fontFamily={THAI_FONT_FAMILY}
                fontWeight={700}
                fontSize={19}
              >
                วันที่ {dayNum}
              </text>
            </g>
          );
        })}

        {/* Inner CTA Emblem */}
        <text
          x={cx}
          y={cy - 60}
          textAnchor="middle"
          fill="#4ADEA8"
          fontFamily={THAI_FONT_FAMILY}
          fontWeight={700}
          fontSize={23}
        >
          STREAK {completedDays} / 7 วัน
        </text>
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fill="#FFD166"
          fontFamily={THAI_FONT_FAMILY}
          fontWeight={700}
          fontSize={48}
        >
          2 ร็อกอะฮ์
        </text>
        <text
          x={cx}
          y={cy + 42}
          textAnchor="middle"
          fill="#FFF4DC"
          fontFamily={THAI_FONT_FAMILY}
          fontWeight={700}
          fontSize={22}
        >
          เริ่มพรุ่งนี้เช้า
        </text>
        <text
          x={cx}
          y={cy + 70}
          textAnchor="middle"
          fill="#FFE6A7"
          fontFamily={THAI_FONT_FAMILY}
          fontWeight={700}
          fontSize={20}
        >
          แค่ 3–5 นาทีทุกวัน
        </text>
      </svg>

      {arabic && (
        <CalligraphyCard
          arabic={arabic}
          meaning="“เพื่อหัวใจที่สงบและวันที่เปี่ยมความจำเริญ · วัลลอฮุอะอฺลัม”"
          fontSize={52}
          startFrame={26}
        />
      )}
    </div>
  );
};

// ============================================================================
// PER-SCENE WRAPPER WITH TRANSITION + SAFE-ZONE LAYOUT + ON-SCREEN SOURCE
// ============================================================================

const DhuhaSceneContent: React.FC<{
  scene: DhuhaTimelineScene;
  sceneIdx: number;
  totalScenes: number;
  renderDuration: number;
  isFirst: boolean;
  isLast: boolean;
}> = ({ scene, sceneIdx, totalScenes, renderDuration, isFirst, isLast }) => {
  const localFrame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const meta = SCRIPT_META_BY_ID[scene.id];
  const sourceText = scene.source || meta?.source || '';
  const arabicText = scene.arabic || meta?.arabic;
  const arabicMeaning = scene.arabicMeaning || meta?.arabicMeaning;
  const badge = scene.badge || meta?.badge || `0${sceneIdx + 1}`;
  const title = scene.title || meta?.title || '';
  const subtitle = scene.subtitle || meta?.subtitle || '';

  const transitionKind = SCENE_TRANSITIONS[sceneIdx % SCENE_TRANSITIONS.length];
  const tStyle = transitionStyle(localFrame, renderDuration, transitionKind, fps, {
    inFrames: 14,
    outFrames: 14,
    skipIn: isFirst,
    skipOut: isLast,
  });

  const titleStart = isFirst ? 4 : 8;
  const subtitleOpacity = interpolate(localFrame, [titleStart + 10, titleStart + 24], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const renderHero = () => {
    switch (scene.id) {
      case 's1_joints_360':
        return <Scene1Joints360 />;
      case 's2_two_rakaat':
        return <Scene2TwoRakaat arabic={arabicText} arabicMeaning={arabicMeaning} />;
      case 's3_qudsi_shield':
        return <Scene3QudsiShield arabic={arabicText} arabicMeaning={arabicMeaning} />;
      case 's4_three_wasiyyah':
        return <Scene4ThreeWasiyyah />;
      case 's5_awwabin':
        return <Scene5Awwabin arabic={arabicText} arabicMeaning={arabicMeaning} />;
      case 's6_time_rakaat':
        return <Scene6TimeRakaat />;
      case 's7_challenge_cta':
        return <Scene7ChallengeCTA arabic={arabicText} />;
      default:
        return <Scene1Joints360 />;
    }
  };

  return (
    <AbsoluteFill style={{ ...tStyle }}>
      {/* Top Safe-Zone Chapter Header (y = 156..206, strictly >= 150px from top) */}
      <div
        style={{
          position: 'absolute',
          top: 156,
          left: 64,
          right: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            background: PALETTE.glassBg,
            border: `1.5px solid ${PALETTE.glassBorder}`,
            borderRadius: 999,
            padding: '8px 22px',
          }}
        >
          <span
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 22,
              fontWeight: 700,
              color: PALETTE.gold,
              lineHeight: 1.3,
            }}
          >
            {badge} / 0{totalScenes}
          </span>
          <span
            style={{
              width: 1.5,
              height: 18,
              background: 'rgba(255, 217, 160, 0.35)',
            }}
          />
          <span
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 22,
              fontWeight: 700,
              color: PALETTE.goldCream,
              lineHeight: 1.35,
            }}
          >
            ประโยชน์ของการละหมาดฎุฮา
          </span>
        </div>

        {/* 7-step Dawn Progress Dots */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {Array.from({ length: totalScenes }, (_, idx) => {
            const active = idx === sceneIdx;
            const past = idx < sceneIdx;
            return (
              <div
                key={idx}
                style={{
                  width: active ? 28 : 10,
                  height: 10,
                  borderRadius: 999,
                  background: active
                    ? '#FFD166'
                    : past
                      ? 'rgba(255, 209, 102, 0.65)'
                      : 'rgba(255, 244, 220, 0.25)',
                  boxShadow: active ? '0 0 12px rgba(255, 209, 102, 0.8)' : undefined,
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Main Content Stage (y = 222..1405 — zero overlap with Top Safe Zone, Source Pill, or Subtitle) */}
      <div
        style={{
          position: 'absolute',
          top: 222,
          bottom: 515,
          left: 56,
          right: 56,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
        }}
      >
        {/* Title & Subtitle Block */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            width: '100%',
          }}
        >
          <DhuhaKineticTitle
            text={title}
            startFrame={titleStart}
            highlight={TITLE_HIGHLIGHTS[scene.id]}
            fontSize={48}
            maxWidth={930}
          />
          <div
            style={{
              opacity: subtitleOpacity,
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 27,
              fontWeight: 700,
              lineHeight: 1.45,
              color: PALETTE.goldCream,
              background: 'rgba(10, 15, 36, 0.44)',
              border: '1px solid rgba(255, 217, 160, 0.24)',
              borderRadius: 999,
              padding: '6px 26px 8px 26px',
              textAlign: 'center',
              textShadow: '0 2px 10px rgba(5, 8, 22, 0.65)',
            }}
          >
            {subtitle}
          </div>
        </div>

        {/* Centerpiece Visual Stage */}
        <div
          style={{
            flex: 1,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {renderHero()}
        </div>
      </div>

      {/* Mandatory Authentic Source Citation Pill (positioned cleanly above KaraokeSubtitle) */}
      {sourceText && (
        <div
          style={{
            position: 'absolute',
            bottom: 446,
            left: 56,
            right: 56,
            display: 'flex',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              background: PALETTE.glassDeep,
              border: '1.5px solid rgba(255, 209, 102, 0.48)',
              borderRadius: 999,
              padding: '8px 24px 9px 22px',
              boxShadow: '0 8px 24px rgba(5, 8, 22, 0.4)',
            }}
          >
            <svg width={16} height={16} viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
              <polygon points="8,0 10,6 16,8 10,10 8,16 6,10 0,8 6,6" fill="#FFD166" />
            </svg>
            <span
              style={{
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 22,
                fontWeight: 700,
                lineHeight: 1.4,
                color: PALETTE.goldLight,
                letterSpacing: 0.2,
              }}
            >
              {sourceText}
            </span>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

// ============================================================================
// FAST SINGLE-PASS DAWN SKY + CACHED ISLAMIC LATTICE BACKDROP
// ============================================================================

const DAWN_STOPS: Array<[number, number, number]> = [
  [11, 16, 38],    // 0.00 Pre-dawn deep indigo (#0B1026)
  [59, 42, 107],   // 0.25 Twilight violet (#3B2A6B)
  [242, 140, 91],  // 0.50 Sunrise amber coral (#F28C5B)
  [255, 217, 160], // 0.75 Warm morning gold (#FFD9A0)
  [255, 244, 220], // 1.00 Bright Dhuha cream (#FFF4DC)
];

function sampleDawnColor(tRaw: number, alpha = 1): string {
  const t = Math.max(0, Math.min(1, tRaw));
  const scaled = t * (DAWN_STOPS.length - 1);
  const idx = Math.min(DAWN_STOPS.length - 2, Math.floor(scaled));
  const localT = scaled - idx;
  const c0 = DAWN_STOPS[idx];
  const c1 = DAWN_STOPS[idx + 1];
  const r = Math.round(c0[0] + (c1[0] - c0[0]) * localT);
  const g = Math.round(c0[1] + (c1[1] - c0[1]) * localT);
  const b = Math.round(c0[2] + (c1[2] - c0[2]) * localT);
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

const PREDAWN_STARS = Array.from({ length: 42 }, (_, i) => ({
  x: random(`dhuha-star-x-${i}`) * 1080,
  y: random(`dhuha-star-y-${i}`) * 1160,
  r: 0.9 + random(`dhuha-star-r-${i}`) * 1.9,
  phase: random(`dhuha-star-p-${i}`) * Math.PI * 2,
  speed: 1.1 + random(`dhuha-star-s-${i}`) * 2.1,
}));

const ISLAMIC_TILE_SIZE = 164;
const ISLAMIC_LATTICE_URI = (() => {
  const s = ISLAMIC_TILE_SIZE;
  const h = s / 2;
  const sqHalf = s * 0.275;
  const diagR = sqHalf * Math.SQRT2;
  const innerSqHalf = sqHalf * 0.52;
  const innerDiagR = innerSqHalf * Math.SQRT2;
  const cornerR = s * 0.16;
  const c = '#FFE6A7';
  const sw = 1.2;
  const outerSq = `${h - sqHalf},${h - sqHalf} ${h + sqHalf},${h - sqHalf} ${h + sqHalf},${h + sqHalf} ${h - sqHalf},${h + sqHalf}`;
  const rotSq = `${h},${h - diagR} ${h + diagR},${h} ${h},${h + diagR} ${h - diagR},${h}`;
  const innerSq = `${h - innerSqHalf},${h - innerSqHalf} ${h + innerSqHalf},${h - innerSqHalf} ${h + innerSqHalf},${h + innerSqHalf} ${h - innerSqHalf},${h + innerSqHalf}`;
  const innerRot = `${h},${h - innerDiagR} ${h + innerDiagR},${h} ${h},${h + innerDiagR} ${h - innerDiagR},${h}`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}' viewBox='0 0 ${s} ${s}'>` +
    `<polygon points='${outerSq}' fill='none' stroke='${c}' stroke-width='${sw}'/>` +
    `<polygon points='${rotSq}' fill='none' stroke='${c}' stroke-width='${sw}'/>` +
    `<polygon points='${innerSq}' fill='none' stroke='${c}' stroke-width='${(sw * 0.78).toFixed(2)}' opacity='0.72'/>` +
    `<polygon points='${innerRot}' fill='none' stroke='${c}' stroke-width='${(sw * 0.78).toFixed(2)}' opacity='0.72'/>` +
    `<circle cx='${h}' cy='${h}' r='${(s * 0.032).toFixed(1)}' fill='${c}' opacity='0.65'/>` +
    `<line x1='${h}' y1='0' x2='${h}' y2='${(h - diagR).toFixed(1)}' stroke='${c}' stroke-width='${(sw * 0.8).toFixed(2)}' opacity='0.65'/>` +
    `<line x1='${h}' y1='${(h + diagR).toFixed(1)}' x2='${h}' y2='${s}' stroke='${c}' stroke-width='${(sw * 0.8).toFixed(2)}' opacity='0.65'/>` +
    `<line x1='0' y1='${h}' x2='${(h - diagR).toFixed(1)}' y2='${h}' stroke='${c}' stroke-width='${(sw * 0.8).toFixed(2)}' opacity='0.65'/>` +
    `<line x1='${(h + diagR).toFixed(1)}' y1='${h}' x2='${s}' y2='${h}' stroke='${c}' stroke-width='${(sw * 0.8).toFixed(2)}' opacity='0.65'/>` +
    `<polygon points='0,${-cornerR} ${cornerR},0 0,${cornerR} ${-cornerR},0' fill='none' stroke='${c}' stroke-width='${(sw * 0.8).toFixed(2)}' opacity='0.65'/>` +
    `<polygon points='${s},${-cornerR} ${s + cornerR},0 ${s},${cornerR} ${s - cornerR},0' fill='none' stroke='${c}' stroke-width='${(sw * 0.8).toFixed(2)}' opacity='0.65'/>` +
    `<polygon points='0,${s - cornerR} ${cornerR},${s} 0,${s + cornerR} ${-cornerR},${s}' fill='none' stroke='${c}' stroke-width='${(sw * 0.8).toFixed(2)}' opacity='0.65'/>` +
    `<polygon points='${s},${s - cornerR} ${s + cornerR},${s} ${s},${s + cornerR} ${s - cornerR},${s}' fill='none' stroke='${c}' stroke-width='${(sw * 0.8).toFixed(2)}' opacity='0.65'/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
})();

const DhuhaDawnBackdrop: React.FC<{ progress: number; sunOriginY: number }> = ({
  progress,
  sunOriginY,
}) => {
  const frame = useCurrentFrame();
  const { width, fps } = useVideoConfig();
  const p = Math.max(0, Math.min(1, progress));
  const tSec = frame / Math.max(1, fps);

  // Darken zenith/horizon slightly to integrate top/bottom contrast scrim into a single CSS gradient pass
  const zenith = sampleDawnColor(p * 0.32);
  const upperMid = sampleDawnColor(Math.min(1, p * 0.62 + 0.06));
  const lowerMid = sampleDawnColor(Math.min(1, p * 0.85 + 0.14));
  const horizon = sampleDawnColor(Math.min(1, p * 0.72 + 0.14));

  const sunPctY = (sunOriginY * 100).toFixed(2);
  const sunIntensity = interpolate(p, [0, 0.18, 0.55, 1], [0.24, 0.68, 0.92, 0.96], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const starOpacity = interpolate(p, [0, 0.22, 0.5], [0.85, 0.42, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        backgroundImage: [
          // Single unified solar core + corona + warm atmospheric bloom
          `radial-gradient(circle 660px at 50% ${sunPctY}%, rgba(255,255,255,${(0.95 * sunIntensity).toFixed(3)}) 0%, rgba(255,244,220,${(0.84 * sunIntensity).toFixed(3)}) 11%, rgba(255,217,160,${(0.46 * sunIntensity).toFixed(3)}) 28%, rgba(242,140,91,${(0.18 * sunIntensity).toFixed(3)}) 58%, rgba(242,140,91,0) 100%)`,
          // Integrated dawn sky + soft top/bottom readability scrim in one pass
          `linear-gradient(180deg, rgba(8,12,30,0.58) 0%, rgba(10,15,36,0.16) 24%, rgba(10,15,36,0.08) 58%, rgba(8,12,30,0.48) 84%, rgba(7,10,26,0.72) 100%)`,
          `linear-gradient(180deg, ${zenith} 0%, ${upperMid} 34%, ${lowerMid} 68%, ${horizon} 100%)`,
        ].join(', '),
      }}
    >
      {starOpacity > 0.01 && (
        <svg
          width={width}
          height={1200}
          viewBox={`0 0 ${width} 1200`}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            opacity: starOpacity,
            pointerEvents: 'none',
          }}
        >
          {PREDAWN_STARS.map((st, idx) => {
            const twinkle = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(tSec * st.speed + st.phase));
            const heightFade = Math.max(0, 1 - st.y / 1180);
            return (
              <circle
                key={idx}
                cx={st.x}
                cy={st.y}
                r={st.r}
                fill="#FFF4DC"
                opacity={twinkle * heightFade}
              />
            );
          })}
        </svg>
      )}
    </div>
  );
};

// ============================================================================
// ROOT DHUHA BENEFITS COMPOSITION
// ============================================================================

export const DhuhaBenefits: React.FC<DhuhaBenefitsProps> = (props) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const scenes = props.scenes && props.scenes.length > 0 ? props.scenes : DEFAULT_DHUHA_PROPS.scenes;
  const allCues = props.cues && props.cues.length > 0 ? props.cues : DEFAULT_DHUHA_PROPS.cues;
  const totalFrames = Math.max(90, props.totalFrames || durationInFrames);

  // Sky gracefully journeys from pre-dawn indigo (0.04) through twilight coral to radiant morning gold (0.76)
  // Keeping top at 0.76 guarantees crisp luxury contrast throughout every scene!
  const skyProgress = interpolate(frame, [0, Math.max(1, totalFrames - 1)], [0.04, 0.76], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Sun rises organically in sync with DawnSky
  const sunOriginY = interpolate(
    Easing.inOut(Easing.quad)(skyProgress),
    [0, 1],
    [0.84, 0.24],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // Active scene lookup for KaraokeSubtitle wordBoundaries + speechStartSec
  const activeScene =
    scenes.find((s) => frame >= s.startFrame && frame < s.endFrame) ??
    scenes[scenes.length - 1];

  // Cut frames between consecutive scenes for golden LightLeakFlash transitions
  const cutFrames = scenes.slice(1).map((s) => s.startFrame);

  return (
    <AbsoluteFill style={{ backgroundColor: '#0B1026', overflow: 'hidden' }}>
      <ThaiFontLoader />

      {/* Continuous Living Backdrop (single-pass CSS DawnSky + cached 164px Islamic lattice tile) */}
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <DhuhaDawnBackdrop progress={skyProgress} sunOriginY={sunOriginY} />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            opacity: 0.085,
            backgroundImage: ISLAMIC_LATTICE_URI,
            backgroundRepeat: 'repeat',
            backgroundSize: `${ISLAMIC_TILE_SIZE}px ${ISLAMIC_TILE_SIZE}px`,
            backgroundPosition: 'center center',
          }}
        />
        <LightRays
          count={8}
          color="#FFD9A0"
          intensity={interpolate(skyProgress, [0.04, 0.35, 0.76], [0.22, 0.44, 0.56])}
          originX={0.5}
          originY={sunOriginY}
          rotationSpeed={2.4}
          blur={18}
          seed="dhuha-rays"
        />
        <ParticleField
          count={32}
          seed="dhuha-motes"
          color="#FFE8B6"
          drift={24}
          size={4.4}
          opacity={0.78}
          bokehRatio={0.3}
          blendMode="normal"
        />
      </AbsoluteFill>

      {/* Overlapping Cross-Faded Scenes (zero black frames between cuts!) */}
      {scenes.map((scene, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === scenes.length - 1;
        const renderStart = isFirst ? scene.startFrame : Math.max(0, scene.startFrame - OVERLAP_HALF);
        const renderEnd = isLast
          ? Math.max(totalFrames, scene.endFrame)
          : Math.min(totalFrames, scene.endFrame + OVERLAP_HALF);
        const renderDur = Math.max(2, renderEnd - renderStart);

        return (
          <Sequence key={scene.id} from={renderStart} durationInFrames={renderDur}>
            <DhuhaSceneContent
              scene={scene}
              sceneIdx={idx}
              totalScenes={scenes.length}
              renderDuration={renderDur}
              isFirst={isFirst}
              isLast={isLast}
            />
          </Sequence>
        );
      })}

      {/* Golden Light-Leak Flash Seamlessly Bridging Every Scene Cut */}
      <LightLeakFlash
        at={cutFrames}
        durationFrames={20}
        color="#FFD9A0"
        secondaryColor="#F28C5B"
        intensity={0.78}
      />

      {/* Global Karaoke Subtitle Bar (Safe Zone bottom >= 260px: bottomOffset=275) */}
      <DhuhaKaraokeSubtitle
        cues={allCues}
        wordBoundaries={activeScene?.wordBoundaries}
        sceneSpeechStartSec={activeScene?.speechStartSec ?? activeScene?.startSec ?? 0}
        bottomOffset={275}
      />

      {/* Cinema Film Grain + Soft Lens Vignette */}
      <FilmGrainVignette
        grain={0.045}
        vignette={0.44}
        vignetteColor="#050816"
        updateEveryFrames={2}
      />
    </AbsoluteFill>
  );
};
