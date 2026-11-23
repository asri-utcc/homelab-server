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
  THAI_LOOPED_FAMILY,
  ThaiFontLoader,
} from '../../components/ThaiFontLoader';
import {
  CountUp,
  FilmGrainVignette,
  LightLeakFlash,
  LightRays,
  ParticleField,
} from '../../components/fx';
import type { SubtitleCue, TransitionKind, WordBoundary } from '../../components/fx';
import scriptData from './script.json';

// ============================================================================
// TYPES & TIMELINE DEFAULT PROPS
// ============================================================================

export type CosmicTimelineScene = {
  id: string;
  index: number;
  badge: string;
  title: string;
  subtitle: string;
  source?: string;
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

export type CosmicPositivityProps = {
  title: string;
  fps: number;
  width?: number;
  height?: number;
  totalSec?: number;
  totalFrames: number;
  scenes: CosmicTimelineScene[];
  cues: SubtitleCue[];
};

type ScriptSceneMeta = {
  badge: string;
  title: string;
  subtitle: string;
  source: string;
};

const SCRIPT_META_BY_ID: Record<string, ScriptSceneMeta> = {};
for (const raw of scriptData.scenes) {
  SCRIPT_META_BY_ID[raw.id] = {
    badge: raw.badge,
    title: raw.title,
    subtitle: raw.subtitle,
    source: raw.source,
  };
}

function buildDefaultProps(): CosmicPositivityProps {
  const fps = scriptData.fps || 30;
  const defaultDur = 290;
  const scenes: CosmicTimelineScene[] = [];
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
      startSec,
      speechStartSec: startSec + 0.35,
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

export const DEFAULT_COSMIC_PROPS: CosmicPositivityProps = buildDefaultProps();

// ============================================================================
// COSMIC PALETTE, HIGHLIGHTS & TRANSITIONS
// ============================================================================

const COSMIC = {
  voidBg: '#060417',
  deepViolet: '#140C40',
  nebulaViolet: '#281A72',
  gold: '#FFD166',
  solarYellow: '#FACB22',
  starlight: '#FCFADA',
  cyan: '#3BE3C6',
  iceBlue: '#85C9FB',
  magenta: '#FF5FB2',
  coralAlert: '#FF5A44',
  glassBg: 'rgba(11, 8, 36, 0.86)',
  glassDeep: 'rgba(7, 5, 24, 0.92)',
  borderCyan: 'rgba(133, 201, 251, 0.38)',
  borderGold: 'rgba(255, 209, 102, 0.58)',
  borderMagenta: 'rgba(255, 95, 178, 0.48)',
  textLight: '#FFFFFF',
  textSoft: 'rgba(232, 242, 255, 0.88)',
};

const TITLE_HIGHLIGHTS: Record<string, string[]> = {
  s1_cosmic_hook: ['86,000 ล้านดวงดาว', 'จักรวาล'],
  s2_ras_filter: ['RAS', '11 ล้านบิต'],
  s3_wiseman_broaden: ['ขยายเรดาร์', 'มองข้าม'],
  s4_pfc_amygdala: ['สมองส่วนหน้า', 'Amygdala'],
  s5_dopamine_placebo: ['Dopamine', 'โชคดี'],
  s6_neuroplasticity: ['กฎ 20 วินาที', 'ความโชคดี'],
  s7_cosmic_cta: ['3 ขั้นตอน', 'คลื่นจักรวาล'],
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

const OVERLAP_HALF = 5;

// ============================================================================
// CRISP VECTOR ICONS (NO SYSTEM EMOJI FONT ARTIFACTS)
// ============================================================================

const SparkStarSvg: React.FC<{ size?: number; color?: string }> = ({
  size = 20,
  color = COSMIC.gold,
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0, display: 'block' }}>
    <polygon
      points="12,1 14.8,9.2 23,12 14.8,14.8 12,23 9.2,14.8 1,12 9.2,9.2"
      fill={color}
    />
    <circle cx={12} cy={12} r={2.4} fill={COSMIC.starlight} />
  </svg>
);

const CheckIconSvg: React.FC<{ size?: number; color?: string }> = ({
  size = 18,
  color = COSMIC.cyan,
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0, display: 'block' }}>
    <circle cx={12} cy={12} r={10} fill="none" stroke={color} strokeWidth={2.2} />
    <path
      d="M7.5 12.2 L10.7 15.4 L16.8 9.0"
      fill="none"
      stroke={color}
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const NeuroCardIconSvg: React.FC<{ kind: 'dopamine' | 'serotonin' | 'magnet' | 'velcro' | 'teflon' }> = ({
  kind,
}) => {
  if (kind === 'dopamine') {
    return (
      <svg width={30} height={30} viewBox="0 0 32 32">
        <polygon points="18,3 7,18 15,18 13,29 25,14 17,14" fill={COSMIC.gold} />
      </svg>
    );
  }
  if (kind === 'serotonin') {
    return (
      <svg width={30} height={30} viewBox="0 0 32 32">
        <path
          d="M4 12 Q10 6 16 12 T28 12"
          fill="none"
          stroke={COSMIC.cyan}
          strokeWidth={3}
          strokeLinecap="round"
        />
        <path
          d="M4 20 Q10 14 16 20 T28 20"
          fill="none"
          stroke={COSMIC.iceBlue}
          strokeWidth={2.6}
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (kind === 'magnet') {
    return (
      <svg width={30} height={30} viewBox="0 0 32 32">
        <circle cx={16} cy={16} r={11} fill="none" stroke={COSMIC.magenta} strokeWidth={2.2} strokeDasharray="5 4" />
        <circle cx={16} cy={16} r={6} fill={COSMIC.magenta} opacity={0.35} />
        <polygon points="16,8 18,14 24,16 18,18 16,24 14,18 8,16 14,14" fill={COSMIC.starlight} />
      </svg>
    );
  }
  if (kind === 'velcro') {
    return (
      <svg width={24} height={24} viewBox="0 0 24 24">
        <path
          d="M5 17 C5 11, 9 8, 9 13 M12 17 C12 9, 16 6, 16 12 M19 17 C19 11, 22 9, 22 13"
          fill="none"
          stroke={COSMIC.coralAlert}
          strokeWidth={2.3}
          strokeLinecap="round"
        />
        <line x1={3} y1={19} x2={21} y2={19} stroke={COSMIC.coralAlert} strokeWidth={2.2} strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width={24} height={24} viewBox="0 0 24 24">
      <path
        d="M12 3 C15.5 8, 18 11.5, 18 14.8 A6 6 0 1 1 6 14.8 C6 11.5, 8.5 8, 12 3 Z"
        fill="rgba(133, 201, 251, 0.28)"
        stroke={COSMIC.iceBlue}
        strokeWidth={2}
      />
      <path d="M9.5 14.5 A3 3 0 0 0 12.2 17.5" fill="none" stroke={COSMIC.starlight} strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  );
};

// ============================================================================
// THAI SEGMENTER + FAST KINETIC TITLE + KARAOKE SUBTITLES
// ============================================================================

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

const CosmicKineticTitle: React.FC<{
  text: string;
  startFrame: number;
  highlight?: string[];
  fontSize?: number;
  maxWidth?: number;
}> = ({ text, startFrame, highlight = [], fontSize = 44, maxWidth = 920 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const sortedKw = [...highlight]
    .map((h) => h.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

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
                config: { damping: 14, stiffness: 185, mass: 0.72 },
              });
        const y = interpolate(progress, [0, 1], [24, 0]);
        const opacity = interpolate(progress, [0, 0.55], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        const scale = interpolate(progress, [0, 1], [0.94, 1]);

        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              whiteSpace: 'pre',
              color: tok.isHl ? COSMIC.gold : COSMIC.textLight,
              opacity,
              transform: `translate3d(0, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(4)})`,
              textShadow: tok.isHl
                ? '0 0 18px rgba(255, 209, 102, 0.65), 0 4px 14px rgba(5, 4, 23, 0.78)'
                : '0 4px 16px rgba(5, 4, 23, 0.78)',
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

const CosmicKaraokeSubtitle: React.FC<{
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
    config: { damping: 16, stiffness: 185, mass: 0.7 },
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
          backgroundColor: 'rgba(8, 6, 26, 0.90)',
          color: '#FFFFFF',
          fontFamily: THAI_FONT_FAMILY,
          fontWeight: 700,
          fontSize: 34,
          lineHeight: 1.48,
          letterSpacing: 0.2,
          textAlign: 'center',
          padding: '16px 30px 18px 30px',
          borderRadius: 24,
          border: '1.5px solid rgba(133, 201, 251, 0.34)',
          boxShadow: '0 12px 30px rgba(4, 3, 18, 0.56)',
          maxWidth: 968,
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
                    ? COSMIC.gold
                    : isSpoken
                      ? '#FFFFFF'
                      : 'rgba(232, 242, 255, 0.64)',
                  backgroundColor: isCurrent ? 'rgba(255, 209, 102, 0.16)' : 'transparent',
                  borderRadius: isCurrent ? 8 : 0,
                  padding: isCurrent ? '2px 5px' : '0',
                  boxShadow: isCurrent ? '0 0 0 1px rgba(255, 209, 102, 0.4)' : 'none',
                  borderBottom:
                    !isCurrent && isKey ? '2px solid rgba(59, 227, 198, 0.7)' : undefined,
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

// ============================================================================
// SCENE 1: COSMIC BRAIN HOOK (86 BILLION NEURONS + "WHY AM I SO LUCKY?")
// ============================================================================

const BRAIN_STARS = Array.from({ length: 68 }, (_, i) => {
  const angle = random(`brain-ang-${i}`) * Math.PI * 2;
  const rx = 38 + random(`brain-rx-${i}`) * 145;
  const ry = 32 + random(`brain-ry-${i}`) * 104;
  const hemiShift = i % 2 === 0 ? -42 : 42;
  const cx = 440 + Math.cos(angle) * rx * 0.72 + hemiShift;
  const cy = 285 + Math.sin(angle) * ry * 0.82;
  const kind = i % 3 === 0 ? COSMIC.gold : i % 3 === 1 ? COSMIC.cyan : COSMIC.magenta;
  return {
    cx,
    cy,
    r: 3.0 + random(`brain-sz-${i}`) * 4.2,
    color: kind,
    phase: random(`brain-ph-${i}`) * Math.PI * 2,
    speed: 1.6 + random(`brain-sp-${i}`) * 2.2,
  };
});

const BRAIN_LINKS = BRAIN_STARS.slice(0, 48).map((st, i) => {
  const next = BRAIN_STARS[(i * 7 + 5) % BRAIN_STARS.length];
  return {
    x1: st.cx,
    y1: st.cy,
    x2: next.cx,
    y2: next.cy,
    color: i % 2 === 0 ? COSMIC.cyan : COSMIC.gold,
    phase: random(`link-ph-${i}`) * Math.PI * 2,
  };
});

const Scene1CosmicHook: React.FC<{ localFrame: number; durationFrames: number }> = ({
  localFrame,
}) => {
  const { fps } = useVideoConfig();
  const tSec = localFrame / Math.max(1, fps);

  const mantraIn = spring({
    frame: Math.max(0, localFrame - 20),
    fps,
    config: { damping: 12, stiffness: 165, mass: 0.75 },
  });
  const mantraScale = interpolate(mantraIn, [0, 1], [0.76, 1]);
  const mantraOp = interpolate(mantraIn, [0, 0.4], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const pulseCycle = ((localFrame - 20) % 52) / 52;
  const waveRadius = localFrame >= 20 ? 110 + pulseCycle * 255 : 110;
  const waveOpacity = localFrame >= 20 ? (1 - pulseCycle) * 0.56 : 0;

  const counterPop = spring({
    frame: Math.max(0, localFrame - 8),
    fps,
    config: { damping: 14, stiffness: 150, mass: 0.8 },
  });

  return (
    <div
      style={{
        width: 920,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
      }}
    >
      {/* Cosmic Brain Constellation SVG (Glow World Layered Lobes) */}
      <div style={{ position: 'relative', width: 880, height: 550 }}>
        <svg width={880} height={550} viewBox="0 0 880 550" style={{ overflow: 'visible' }}>
          <defs>
            <radialGradient id="s1-core-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FCFADA" stopOpacity="0.92" />
              <stop offset="28%" stopColor="#FFD166" stopOpacity="0.46" />
              <stop offset="62%" stopColor="#FF5FB2" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#140C40" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="s1-hemi-left" x1="15%" y1="5%" x2="85%" y2="95%">
              <stop offset="0%" stopColor="#3B2B9E" stopOpacity="0.92" />
              <stop offset="55%" stopColor="#1B1358" stopOpacity="0.90" />
              <stop offset="100%" stopColor="#112E52" stopOpacity="0.92" />
            </linearGradient>
            <linearGradient id="s1-hemi-right" x1="85%" y1="5%" x2="15%" y2="95%">
              <stop offset="0%" stopColor="#4F269E" stopOpacity="0.92" />
              <stop offset="55%" stopColor="#211259" stopOpacity="0.90" />
              <stop offset="100%" stopColor="#172052" stopOpacity="0.92" />
            </linearGradient>
            <pattern id="s1-dot-tex" width="16" height="16" patternUnits="userSpaceOnUse">
              <circle cx="8" cy="8" r="1.15" fill="#85C9FB" opacity="0.24" />
            </pattern>
          </defs>

          {/* Galactic Ambient Aura */}
          <circle cx={440} cy={292} r={268} fill="url(#s1-core-glow)" />

          {/* Concentric Rotating Cosmic Orbits */}
          <g transform={`rotate(${(tSec * 8).toFixed(2)} 440 292)`}>
            <ellipse
              cx={440}
              cy={292}
              rx={332}
              ry={128}
              fill="none"
              stroke={COSMIC.cyan}
              strokeWidth={2}
              strokeDasharray="10 12"
              strokeOpacity={0.44}
            />
          </g>
          <g transform={`rotate(${(-tSec * 6 - 24).toFixed(2)} 440 292)`}>
            <ellipse
              cx={440}
              cy={292}
              rx={310}
              ry={118}
              fill="none"
              stroke={COSMIC.magenta}
              strokeWidth={2}
              strokeDasharray="6 14"
              strokeOpacity={0.40}
            />
          </g>

          {/* Expanding Resonance Wave from Mantra */}
          {waveOpacity > 0.01 && (
            <>
              <circle
                cx={440}
                cy={292}
                r={waveRadius}
                fill="none"
                stroke={COSMIC.gold}
                strokeWidth={3.5}
                strokeOpacity={waveOpacity}
              />
              <circle
                cx={440}
                cy={292}
                r={Math.max(40, waveRadius - 42)}
                fill="none"
                stroke={COSMIC.cyan}
                strokeWidth={2.2}
                strokeOpacity={waveOpacity * 0.72}
              />
            </>
          )}

          {/* Glow-World Layered Cerebral Hemispheres (Lobed Gyri Contour + Crescent Highlight) */}
          <g>
            {/* Left Hemisphere */}
            <path
              d="M 434 152 C 392 140, 344 148, 308 172 C 266 196, 234 242, 232 294 C 230 338, 254 378, 294 402 C 330 422, 376 426, 412 418 C 428 414, 434 400, 434 382 Z"
              fill="url(#s1-hemi-left)"
              stroke={COSMIC.iceBlue}
              strokeWidth={2.4}
              strokeOpacity={0.68}
            />
            <path
              d="M 434 152 C 392 140, 344 148, 308 172 C 266 196, 234 242, 232 294 C 230 338, 254 378, 294 402 C 330 422, 376 426, 412 418 C 428 414, 434 400, 434 382 Z"
              fill="url(#s1-dot-tex)"
            />
            {/* Crescent Upper Highlight Left */}
            <path
              d="M 248 276 C 254 220, 296 174, 368 162 C 394 158, 414 162, 424 168"
              fill="none"
              stroke="#85C9FB"
              strokeWidth={5}
              strokeLinecap="round"
              strokeOpacity={0.28}
            />
            {/* Organic Cortical Fold Arcs Left */}
            <path
              d="M 272 262 C 306 244, 344 252, 368 278 M 288 336 C 324 316, 366 324, 396 352 M 316 198 C 344 218, 376 218, 404 202"
              fill="none"
              stroke={COSMIC.cyan}
              strokeWidth={2}
              strokeLinecap="round"
              strokeOpacity={0.32}
            />

            {/* Right Hemisphere */}
            <path
              d="M 446 152 C 488 140, 536 148, 572 172 C 614 196, 646 242, 648 294 C 650 338, 626 378, 586 402 C 550 422, 504 426, 468 418 C 452 414, 446 400, 446 382 Z"
              fill="url(#s1-hemi-right)"
              stroke={COSMIC.magenta}
              strokeWidth={2.4}
              strokeOpacity={0.68}
            />
            <path
              d="M 446 152 C 488 140, 536 148, 572 172 C 614 196, 646 242, 648 294 C 650 338, 626 378, 586 402 C 550 422, 504 426, 468 418 C 452 414, 446 400, 446 382 Z"
              fill="url(#s1-dot-tex)"
            />
            {/* Crescent Upper Highlight Right */}
            <path
              d="M 632 276 C 626 220, 584 174, 512 162 C 486 158, 466 162, 456 168"
              fill="none"
              stroke={COSMIC.magenta}
              strokeWidth={5}
              strokeLinecap="round"
              strokeOpacity={0.28}
            />
            {/* Organic Cortical Fold Arcs Right */}
            <path
              d="M 608 262 C 574 244, 536 252, 512 278 M 592 336 C 556 316, 514 324, 484 352 M 564 198 C 536 218, 504 218, 476 202"
              fill="none"
              stroke={COSMIC.gold}
              strokeWidth={2}
              strokeLinecap="round"
              strokeOpacity={0.32}
            />

            {/* Luminous Corpus Callosum Bridge + Brainstem */}
            <path
              d="M 420 402 L 430 448 L 450 448 L 460 402 Z"
              fill="#1E145A"
              stroke={COSMIC.gold}
              strokeWidth={1.8}
              strokeOpacity={0.55}
            />
            <rect
              x={404}
              y={270}
              width={72}
              height={32}
              rx={16}
              fill="rgba(255, 209, 102, 0.16)"
              stroke={COSMIC.gold}
              strokeWidth={1.5}
              strokeOpacity={0.55}
            />
          </g>

          {/* Neural Constellation Links */}
          {BRAIN_LINKS.map((lk, idx) => {
            const glow = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(tSec * 2.8 + lk.phase));
            return (
              <line
                key={idx}
                x1={lk.x1}
                y1={lk.y1}
                x2={lk.x2}
                y2={lk.y2}
                stroke={lk.color}
                strokeWidth={1.6}
                strokeOpacity={glow * 0.56}
              />
            );
          })}

          {/* 86-Billion Neuron Representative Star Nodes */}
          {BRAIN_STARS.map((st, idx) => {
            const twinkle = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(tSec * st.speed + st.phase));
            return (
              <g key={idx}>
                <circle
                  cx={st.cx}
                  cy={st.cy}
                  r={st.r * 1.9}
                  fill={st.color}
                  opacity={twinkle * 0.24}
                />
                <circle
                  cx={st.cx}
                  cy={st.cy}
                  r={st.r}
                  fill={st.color}
                  opacity={twinkle}
                />
              </g>
            );
          })}

          {/* Central Luminous Cosmic Brain Core */}
          <circle cx={440} cy={286} r={28} fill={COSMIC.gold} opacity={0.30} />
          <circle cx={440} cy={286} r={13} fill={COSMIC.starlight} opacity={0.96} />
        </svg>

        {/* Floating Cosmic Mantra Pill */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 22,
            transform: `translate(-50%, 0) scale(${mantraScale.toFixed(4)})`,
            opacity: mantraOp,
            background: 'rgba(18, 12, 54, 0.94)',
            border: `2px solid ${COSMIC.gold}`,
            borderRadius: 999,
            padding: '12px 34px',
            boxShadow: '0 0 28px rgba(255, 209, 102, 0.36)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            whiteSpace: 'nowrap',
          }}
        >
          <SparkStarSvg size={24} color={COSMIC.gold} />
          <span
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 32,
              fontWeight: 700,
              color: COSMIC.starlight,
              lineHeight: 1.4,
            }}
          >
            “ทำไมฉันโชคดีจัง?”
          </span>
        </div>
      </div>

      {/* Big CountUp Metric Card (synced to peak right around Cue 3: 86,000 ล้าน) */}
      <div
        style={{
          transform: `scale(${interpolate(counterPop, [0, 1], [0.9, 1]).toFixed(4)})`,
          opacity: interpolate(counterPop, [0, 0.5], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
          background: COSMIC.glassBg,
          border: `1.5px solid ${COSMIC.borderGold}`,
          borderRadius: 28,
          padding: '18px 46px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          boxShadow: '0 14px 36px rgba(4, 3, 18, 0.55)',
        }}
      >
        <div
          style={{
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 64,
            fontWeight: 700,
            color: COSMIC.gold,
            lineHeight: 1.25,
            textShadow: '0 0 24px rgba(255, 209, 102, 0.45)',
          }}
        >
          <CountUp
            from={0}
            to={86000}
            startFrame={16}
            durationFrames={118}
            format={(v) => Math.round(v).toLocaleString('en-US')}
            suffix=" ล้าน"
            popScale={1.12}
            popGlowColor="rgba(255, 209, 102, 0.65)"
          />
        </div>
        <div
          style={{
            fontFamily: THAI_LOOPED_FAMILY,
            fontSize: 27,
            fontWeight: 700,
            color: COSMIC.iceBlue,
            lineHeight: 1.4,
          }}
        >
          เซลล์ประสาทที่เชื่อมโยงกันเป็นจักรวาลในหัวคุณ
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// SCENE 2: RAS COSMIC ANTENNA (11 MILLION BITS -> 40 BITS)
// ============================================================================

const SENSORY_BITS = Array.from({ length: 42 }, (_, i) => {
  const isOpportunity = i % 4 === 0;
  return {
    lane: (random(`ras-lane-${i}`) - 0.5) * 620,
    phase: random(`ras-ph-${i}`),
    speed: 0.45 + random(`ras-sp-${i}`) * 0.45,
    r: isOpportunity ? 8.0 : 4.5 + random(`ras-r-${i}`) * 3.0,
    isOpportunity,
    color: isOpportunity
      ? COSMIC.gold
      : i % 3 === 0
        ? COSMIC.magenta
        : '#8B85C6',
  };
});

const Scene2RasFilter: React.FC<{ localFrame: number }> = ({ localFrame }) => {
  const { fps } = useVideoConfig();
  const tSec = localFrame / Math.max(1, fps);

  const funnelIn = spring({
    frame: localFrame,
    fps,
    config: { damping: 14, stiffness: 160, mass: 0.75 },
  });
  const dialAngle = interpolate(localFrame, [18, 120], [-64, 0], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        width: 920,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 18,
      }}
    >
      <svg width={880} height={540} viewBox="0 0 880 540" style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id="s2-funnel-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#85C9FB" stopOpacity="0.26" />
            <stop offset="52%" stopColor="#3BE3C6" stopOpacity="0.44" />
            <stop offset="100%" stopColor="#FFD166" stopOpacity="0.68" />
          </linearGradient>
          <radialGradient id="s2-ras-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FCFADA" stopOpacity="0.95" />
            <stop offset="40%" stopColor="#3BE3C6" stopOpacity="0.58" />
            <stop offset="100%" stopColor="#140C40" stopOpacity="0" />
          </radialGradient>
          <pattern id="s2-dot-tex" width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx="7" cy="7" r="1" fill="#85C9FB" opacity="0.25" />
          </pattern>
        </defs>

        {/* Top Sensory Data Rain (11,000,000 bits/sec) */}
        {SENSORY_BITS.map((bit, idx) => {
          const p = (tSec * bit.speed + bit.phase) % 1;
          const startX = 440 + bit.lane;
          if (!bit.isOpportunity) {
            const y = interpolate(p, [0, 0.52, 0.88], [22, 238, 286]);
            const x =
              p < 0.52
                ? interpolate(p, [0, 0.52], [startX, 440 + bit.lane * 0.36])
                : interpolate(p, [0.52, 0.88], [440 + bit.lane * 0.36, 440 + Math.sign(bit.lane || 1) * 345]);
            const op = p < 0.52 ? 0.72 : interpolate(p, [0.52, 0.88], [0.56, 0]);
            return <circle key={idx} cx={x} cy={y} r={bit.r} fill={bit.color} opacity={op} />;
          }
          const y = interpolate(p, [0, 0.5, 1], [20, 258, 466]);
          const x =
            p < 0.5
              ? interpolate(p, [0, 0.5], [startX, 440 + bit.lane * 0.08])
              : interpolate(p, [0.5, 1], [440 + bit.lane * 0.08, 440 + bit.lane * 0.04]);
          return (
            <g key={idx}>
              <circle cx={x} cy={y} r={bit.r * 2.2} fill={COSMIC.gold} opacity={0.30} />
              <circle cx={x} cy={y} r={bit.r} fill={COSMIC.starlight} opacity={0.98} />
            </g>
          );
        })}

        {/* Holographic RAS Funnel Geometry */}
        <g opacity={interpolate(funnelIn, [0, 0.6], [0, 1], { extrapolateRight: 'clamp' })}>
          <path
            d="M 135 88 L 745 88 L 510 258 L 496 436 L 384 436 L 370 258 Z"
            fill="url(#s2-funnel-grad)"
            stroke={COSMIC.iceBlue}
            strokeWidth={2.5}
            strokeOpacity={0.78}
          />
          <path
            d="M 135 88 L 745 88 L 510 258 L 496 436 L 384 436 L 370 258 Z"
            fill="url(#s2-dot-tex)"
          />
          {/* Left-side Glow World crescent highlight */}
          <path
            d="M 164 102 L 378 256 L 392 424"
            fill="none"
            stroke="#FCFADA"
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeOpacity={0.22}
          />
          {/* Top Rim Ellipse */}
          <ellipse
            cx={440}
            cy={88}
            rx={305}
            ry={30}
            fill="rgba(133, 201, 251, 0.16)"
            stroke={COSMIC.iceBlue}
            strokeWidth={2.5}
          />
          {/* RAS Gateway Ring */}
          <circle cx={440} cy={258} r={108} fill="url(#s2-ras-core)" />
          <g transform={`rotate(${(tSec * 22 + dialAngle).toFixed(2)} 440 258)`}>
            <circle
              cx={440}
              cy={258}
              r={82}
              fill="none"
              stroke={COSMIC.gold}
              strokeWidth={3.2}
              strokeDasharray="16 10"
            />
          </g>
          <g transform={`rotate(${(-tSec * 16).toFixed(2)} 440 258)`}>
            <circle
              cx={440}
              cy={258}
              r={62}
              fill="rgba(9, 7, 30, 0.90)"
              stroke={COSMIC.cyan}
              strokeWidth={2.5}
            />
          </g>
          <text
            x={440}
            y={252}
            textAnchor="middle"
            fill={COSMIC.gold}
            fontFamily={THAI_FONT_FAMILY}
            fontSize={30}
            fontWeight={700}
          >
            RAS
          </text>
          <text
            x={440}
            y={280}
            textAnchor="middle"
            fill={COSMIC.starlight}
            fontFamily={THAI_FONT_FAMILY}
            fontSize={18}
            fontWeight={700}
          >
            คลื่นโชคดี
          </text>

          {/* Clean Capsule Collector Pill (no text clipping on ellipse rim) */}
          <rect
            x={255}
            y={462}
            width={370}
            height={52}
            rx={26}
            fill="rgba(14, 11, 42, 0.94)"
            stroke={COSMIC.gold}
            strokeWidth={2.2}
          />
          <text
            x={440}
            y={496}
            textAnchor="middle"
            fill={COSMIC.starlight}
            fontFamily={THAI_FONT_FAMILY}
            fontSize={22}
            fontWeight={700}
          >
            จิตสำนึกโฟกัสโอกาสทอง
          </text>
        </g>
      </svg>

      {/* Dual KPI Cards */}
      <div style={{ display: 'flex', gap: 24, width: '100%', justifyContent: 'center' }}>
        <div
          style={{
            flex: 1,
            maxWidth: 410,
            background: COSMIC.glassBg,
            border: `1.5px solid ${COSMIC.borderMagenta}`,
            borderRadius: 24,
            padding: '16px 24px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontFamily: THAI_LOOPED_FAMILY, fontSize: 23, color: COSMIC.magenta, fontWeight: 700, lineHeight: 1.4 }}>
            ข้อมูลเข้าสมองทั้งหมด
          </div>
          <div style={{ fontFamily: THAI_FONT_FAMILY, fontSize: 42, color: '#FFFFFF', fontWeight: 700, lineHeight: 1.3 }}>
            11,000,000 <span style={{ fontSize: 24, color: COSMIC.textSoft }}>บิต/วิ</span>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            maxWidth: 410,
            background: COSMIC.glassBg,
            border: `2px solid ${COSMIC.gold}`,
            borderRadius: 24,
            padding: '16px 24px',
            textAlign: 'center',
            boxShadow: '0 0 26px rgba(255, 209, 102, 0.22)',
          }}
        >
          <div style={{ fontFamily: THAI_LOOPED_FAMILY, fontSize: 23, color: COSMIC.cyan, fontWeight: 700, lineHeight: 1.4 }}>
            RAS คัดส่งสู่จิตสำนึก
          </div>
          <div style={{ fontFamily: THAI_FONT_FAMILY, fontSize: 42, color: COSMIC.gold, fontWeight: 700, lineHeight: 1.3 }}>
            40–50 <span style={{ fontSize: 24, color: COSMIC.starlight }}>บิต/วิ</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// SCENE 3: WISEMAN $250 EXPERIMENT & fMRI BROADEN RADAR
// ============================================================================

const OPPORTUNITY_STARS = [
  { x: 668, y: 128, label: 'โอกาสงานใหม่', delay: 32 },
  { x: 726, y: 246, label: 'รับฟรี $250', delay: 44, hero: true },
  { x: 668, y: 368, label: 'คนช่วยสนับสนุน', delay: 56 },
  { x: 212, y: 368, label: 'ไอเดียแก้ปัญหา', delay: 68 },
  { x: 154, y: 246, label: 'จังหวะที่ใช่', delay: 80 },
  { x: 212, y: 128, label: 'คอนเนกชันดี', delay: 92 },
];

const Scene3WisemanBroaden: React.FC<{ localFrame: number }> = ({ localFrame }) => {
  const { fps } = useVideoConfig();

  const expandProgress = interpolate(localFrame, [18, 138], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const radarRadius = 74 + expandProgress * 156;
  const ringCircumference = 2 * Math.PI * 168;
  const dashOffset = ringCircumference * (1 - expandProgress);

  const newsPop = spring({
    frame: Math.max(0, localFrame - 24),
    fps,
    config: { damping: 14, stiffness: 165, mass: 0.72 },
  });

  return (
    <div
      style={{
        width: 920,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
      }}
    >
      <svg width={880} height={476} viewBox="0 0 880 476" style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id="s3-broaden-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#3BE3C6" stopOpacity="0.48" />
            <stop offset="55%" stopColor="#85C9FB" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#140C40" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Top Tunnel-Vision Reference Pill (clean contrast, zero cone overlap) */}
        <g opacity={interpolate(expandProgress, [0, 0.8], [1, 0.72], { extrapolateRight: 'clamp' })}>
          <rect
            x={250}
            y={8}
            width={380}
            height={36}
            rx={18}
            fill="rgba(34, 12, 28, 0.90)"
            stroke={COSMIC.coralAlert}
            strokeWidth={1.6}
          />
          <text
            x={440}
            y={32}
            textAnchor="middle"
            fill={COSMIC.coralAlert}
            fontFamily={THAI_FONT_FAMILY}
            fontSize={19}
            fontWeight={700}
          >
            เครียด: มุมมองแคบ (Tunnel Vision)
          </text>
        </g>

        {/* Constricted Tunnel Vision Cone */}
        <path
          d="M 440 246 L 392 56 L 488 56 Z"
          fill="rgba(255, 90, 68, 0.24)"
          stroke={COSMIC.coralAlert}
          strokeWidth={1.8}
          strokeDasharray="6 6"
          opacity={interpolate(expandProgress, [0, 0.75], [0.95, 0.30], { extrapolateRight: 'clamp' })}
        />

        {/* Expanding fMRI PPA Positive Field of View */}
        <circle cx={440} cy={246} r={radarRadius} fill="url(#s3-broaden-grad)" />
        <circle
          cx={440}
          cy={246}
          r={168}
          fill="none"
          stroke={COSMIC.cyan}
          strokeWidth={4}
          strokeDasharray={ringCircumference}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 440 246)"
        />
        <circle
          cx={440}
          cy={246}
          r={112}
          fill="none"
          stroke={COSMIC.iceBlue}
          strokeWidth={1.5}
          strokeDasharray="8 10"
          strokeOpacity={0.48 * expandProgress}
        />

        {/* Central Viewer Eye / Brain Core */}
        <circle cx={440} cy={246} r={55} fill="rgba(11, 8, 36, 0.94)" stroke={COSMIC.gold} strokeWidth={3} />
        <text
          x={440}
          y={241}
          textAnchor="middle"
          fill={COSMIC.gold}
          fontFamily={THAI_FONT_FAMILY}
          fontSize={22}
          fontWeight={700}
        >
          fMRI
        </text>
        <text
          x={440}
          y={267}
          textAnchor="middle"
          fill={COSMIC.starlight}
          fontFamily={THAI_FONT_FAMILY}
          fontSize={15.5}
          fontWeight={700}
        >
          PPA เปิดกว้าง
        </text>

        {/* Opportunity Stars Positioned Cleanly Outside Radar Ring (Zero Overlap) */}
        {OPPORTUNITY_STARS.map((st, idx) => {
          const lit = spring({
            frame: Math.max(0, localFrame - st.delay),
            fps,
            config: { damping: 12, stiffness: 170, mass: 0.7 },
          });
          const op = interpolate(lit, [0, 0.5], [0.16, 1], { extrapolateRight: 'clamp' });
          const sc = interpolate(lit, [0, 1], [0.72, 1]);
          const col = st.hero ? COSMIC.gold : COSMIC.cyan;
          return (
            <g
              key={idx}
              transform={`translate(${st.x} ${st.y}) scale(${sc.toFixed(3)})`}
              opacity={op}
            >
              <line
                x1={440 - st.x}
                y1={246 - st.y}
                x2={0}
                y2={0}
                stroke={col}
                strokeWidth={1.8}
                strokeDasharray="5 6"
                strokeOpacity={0.52}
              />
              <circle cx={0} cy={0} r={st.hero ? 22 : 14} fill={col} opacity={0.26} />
              <circle cx={0} cy={0} r={st.hero ? 10 : 6.5} fill={st.hero ? COSMIC.starlight : col} />
              <rect
                x={-88}
                y={st.hero ? 20 : 15}
                width={176}
                height={36}
                rx={18}
                fill="rgba(9, 7, 30, 0.94)"
                stroke={col}
                strokeWidth={st.hero ? 2.2 : 1.5}
              />
              <text
                x={0}
                y={st.hero ? 44 : 39}
                textAnchor="middle"
                fill={st.hero ? COSMIC.gold : COSMIC.textLight}
                fontFamily={THAI_FONT_FAMILY}
                fontSize={19}
                fontWeight={700}
              >
                {st.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Wiseman Newspaper Card (Clean Single-Line Quote, Zero Awkward Wrapping) */}
      <div
        style={{
          width: '94%',
          background: COSMIC.glassBg,
          border: `2px solid ${COSMIC.borderGold}`,
          borderRadius: 24,
          padding: '16px 26px',
          transform: `translate3d(0, ${interpolate(newsPop, [0, 1], [24, 0]).toFixed(1)}px, 0) scale(${interpolate(newsPop, [0, 1], [0.94, 1]).toFixed(4)})`,
          opacity: interpolate(newsPop, [0, 0.5], [0, 1], { extrapolateRight: 'clamp' }),
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          boxShadow: '0 12px 30px rgba(4, 3, 18, 0.52)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontFamily: THAI_LOOPED_FAMILY, fontSize: 22, color: COSMIC.cyan, fontWeight: 700, lineHeight: 1.4 }}>
            การทดลองหนังสือพิมพ์ · Richard Wiseman
          </div>
          <div
            style={{
              background: 'rgba(59, 227, 198, 0.16)',
              border: `1.5px solid ${COSMIC.cyan}`,
              borderRadius: 999,
              padding: '6px 16px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 21,
              fontWeight: 700,
              color: COSMIC.cyan,
              whiteSpace: 'nowrap',
              lineHeight: 1.35,
            }}
          >
            <CheckIconSvg size={18} color={COSMIC.cyan} />
            <span>คนคิดบวกเห็นทันที</span>
          </div>
        </div>
        <div style={{ fontFamily: THAI_FONT_FAMILY, fontSize: 25, color: COSMIC.starlight, fontWeight: 700, lineHeight: 1.42 }}>
          “หยุดนับรูป! บอกผู้ทดลองว่าเห็นข้อความนี้ รับ <span style={{ color: COSMIC.gold }}>$250</span>”
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// SCENE 4: PREFRONTAL CORTEX & rACC CALMS AMYGDALA (TALI SHAROT 2007)
// ============================================================================

const Scene4PfcAmygdala: React.FC<{ localFrame: number }> = ({ localFrame }) => {
  const { fps } = useVideoConfig();
  const tSec = localFrame / Math.max(1, fps);

  const beamProgress = interpolate(localFrame, [20, 145], [0, 1], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const jitterAmp = interpolate(beamProgress, [0, 0.45, 1], [10, 4.5, 0.6]);
  const amgJitterX = Math.sin(tSec * 28) * jitterAmp;
  const amgJitterY = Math.cos(tSec * 23) * jitterAmp * 0.6;

  const cortisolPct = Math.round(interpolate(beamProgress, [0, 1], [86, 24]));
  const clarityPct = Math.round(interpolate(beamProgress, [0, 1], [28, 92]));

  const barIn = spring({
    frame: Math.max(0, localFrame - 10),
    fps,
    config: { damping: 14, stiffness: 160, mass: 0.75 },
  });

  return (
    <div
      style={{
        width: 920,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 18,
      }}
    >
      <svg width={880} height={470} viewBox="0 0 880 470" style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id="s4-pfc-orb" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FCFADA" stopOpacity="0.95" />
            <stop offset="38%" stopColor="#3BE3C6" stopOpacity="0.72" />
            <stop offset="75%" stopColor="#85C9FB" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#140C40" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="s4-amg-hot" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFD9A0" stopOpacity="0.9" />
            <stop offset="45%" stopColor="#FF5A44" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#140C40" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="s4-amg-calm" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#E6F4FF" stopOpacity="0.88" />
            <stop offset="45%" stopColor="#85C9FB" stopOpacity="0.52" />
            <stop offset="100%" stopColor="#140C40" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Subtle Stylized Brain Cross-Section Frame Around PFC & Amygdala */}
        <path
          d="M 272 228 C 254 128, 336 40, 444 42 C 562 44, 640 128, 622 232 C 608 312, 558 378, 496 420 C 466 438, 412 438, 384 418 C 322 374, 286 308, 272 228 Z"
          fill="rgba(20, 12, 64, 0.42)"
          stroke="rgba(133, 201, 251, 0.22)"
          strokeWidth={2}
          strokeDasharray="8 10"
        />

        {/* Upper Orb: Prefrontal Cortex & rACC */}
        <circle cx={440} cy={112} r={140} fill="url(#s4-pfc-orb)" />
        <circle cx={440} cy={112} r={88} fill="rgba(8, 6, 28, 0.90)" stroke={COSMIC.cyan} strokeWidth={3} />
        <circle cx={440} cy={112} r={98} fill="none" stroke={COSMIC.gold} strokeWidth={1.6} strokeDasharray="8 8" strokeOpacity={0.75} />
        <text
          x={440}
          y={104}
          textAnchor="middle"
          fill={COSMIC.cyan}
          fontFamily={THAI_FONT_FAMILY}
          fontSize={24}
          fontWeight={700}
        >
          PFC &amp; rACC
        </text>
        <text
          x={440}
          y={132}
          textAnchor="middle"
          fill={COSMIC.starlight}
          fontFamily={THAI_FONT_FAMILY}
          fontSize={18}
          fontWeight={700}
        >
          ศูนย์เหตุผล &amp; อนาคต
        </text>

        {/* Top-Down Inhibitory Cosmic Wave (clean span from y=204 to y=282) */}
        {beamProgress > 0.02 && (
          <g>
            <line
              x1={440}
              y1={202}
              x2={440}
              y2={202 + beamProgress * 82}
              stroke={COSMIC.cyan}
              strokeWidth={18}
              strokeLinecap="round"
              strokeOpacity={0.28}
            />
            <line
              x1={440}
              y1={202}
              x2={440}
              y2={202 + beamProgress * 82}
              stroke={COSMIC.starlight}
              strokeWidth={5}
              strokeLinecap="round"
            />
            <circle
              cx={440}
              cy={204 + ((tSec * 1.4) % 1) * (beamProgress * 78)}
              r={9}
              fill={COSMIC.gold}
              opacity={0.94}
            />
          </g>
        )}

        {/* Lower Orb: Amygdala (transitions from alarmed red to calm sky blue) */}
        <g transform={`translate(${amgJitterX.toFixed(1)} ${amgJitterY.toFixed(1)})`}>
          <circle
            cx={440}
            cy={364}
            r={114}
            fill="url(#s4-amg-hot)"
            opacity={1 - beamProgress * 0.85}
          />
          <circle
            cx={440}
            cy={364}
            r={114}
            fill="url(#s4-amg-calm)"
            opacity={beamProgress}
          />
          <circle
            cx={440}
            cy={364}
            r={78}
            fill="rgba(10, 8, 32, 0.90)"
            stroke={beamProgress > 0.6 ? COSMIC.iceBlue : COSMIC.coralAlert}
            strokeWidth={3}
          />
          <text
            x={440}
            y={356}
            textAnchor="middle"
            fill={beamProgress > 0.6 ? COSMIC.iceBlue : COSMIC.coralAlert}
            fontFamily={THAI_FONT_FAMILY}
            fontSize={24}
            fontWeight={700}
          >
            Amygdala
          </text>
          <text
            x={440}
            y={386}
            textAnchor="middle"
            fill={COSMIC.starlight}
            fontFamily={THAI_FONT_FAMILY}
            fontSize={19}
            fontWeight={700}
          >
            {beamProgress > 0.6 ? 'สงบลง · ปลอดภัย' : 'ศูนย์เตือนภัยตื่นตัว'}
          </text>
        </g>

        {/* Connected Callout Line + Badge Explaining Mechanism */}
        <g opacity={interpolate(beamProgress, [0.15, 0.55], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}>
          <line
            x1={448}
            y1={244}
            x2={536}
            y2={244}
            stroke={COSMIC.cyan}
            strokeWidth={2}
            strokeDasharray="4 4"
          />
          <circle cx={448} cy={244} r={4.5} fill={COSMIC.gold} />
          <rect
            x={536}
            y={218}
            width={318}
            height={52}
            rx={20}
            fill="rgba(9, 7, 30, 0.92)"
            stroke={COSMIC.cyan}
            strokeWidth={1.8}
          />
          <text
            x={695}
            y={251}
            textAnchor="middle"
            fill={COSMIC.cyan}
            fontFamily={THAI_FONT_FAMILY}
            fontSize={20}
            fontWeight={700}
          >
            ส่งคลื่นดับความกลัวอัตโนมัติ
          </text>
        </g>
      </svg>

      {/* Dual Telemetry Progress Bars */}
      <div
        style={{
          width: '92%',
          background: COSMIC.glassBg,
          border: `1.5px solid ${COSMIC.borderCyan}`,
          borderRadius: 26,
          padding: '20px 30px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          opacity: interpolate(barIn, [0, 0.5], [0, 1], { extrapolateRight: 'clamp' }),
        }}
      >
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontFamily: THAI_FONT_FAMILY, fontSize: 25, fontWeight: 700, color: COSMIC.coralAlert }}>
              ฮอร์โมนเครียด (Cortisol)
            </span>
            <span style={{ fontFamily: THAI_FONT_FAMILY, fontSize: 25, fontWeight: 700, color: '#FFFFFF' }}>
              {cortisolPct}% ↓
            </span>
          </div>
          <div style={{ width: '100%', height: 16, borderRadius: 99, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
            <div
              style={{
                width: `${cortisolPct}%`,
                height: '100%',
                borderRadius: 99,
                background: 'linear-gradient(90deg, #FF5A44, #F28C5B)',
              }}
            />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontFamily: THAI_FONT_FAMILY, fontSize: 25, fontWeight: 700, color: COSMIC.cyan }}>
              พลังแก้ปัญหาเชิงสร้างสรรค์ (PFC)
            </span>
            <span style={{ fontFamily: THAI_FONT_FAMILY, fontSize: 25, fontWeight: 700, color: COSMIC.gold }}>
              {clarityPct}% ↑
            </span>
          </div>
          <div style={{ width: '100%', height: 16, borderRadius: 99, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
            <div
              style={{
                width: `${clarityPct}%`,
                height: '100%',
                borderRadius: 99,
                background: 'linear-gradient(90deg, #3BE3C6, #FFD166)',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// SCENE 5: COSMIC SYNAPSE & DOPAMINE PLACEBO REWARD
// ============================================================================

const NEURO_ORBS = Array.from({ length: 16 }, (_, i) => ({
  lane: (i - 7.5) * 28,
  phase: random(`dop-ph-${i}`),
  speed: 0.72 + random(`dop-sp-${i}`) * 0.45,
  color: i % 2 === 0 ? COSMIC.gold : COSMIC.cyan,
  r: i % 2 === 0 ? 8.5 : 6.5,
}));

const NEURO_CARDS: Array<{
  kind: 'dopamine' | 'serotonin' | 'magnet';
  name: string;
  desc: string;
  tag: string;
  color: string;
}> = [
  { kind: 'dopamine', name: 'Dopamine', desc: 'ปลุกแรงจูงใจ & ความตื่นตัว', tag: 'พลังลงมือทำ ↑', color: COSMIC.gold },
  { kind: 'serotonin', name: 'Serotonin', desc: 'ปรับอารมณ์นิ่ง สงบ มั่นคง', tag: 'ใจนิ่งเฉียบคม', color: COSMIC.cyan },
  { kind: 'magnet', name: 'Social Magnetism', desc: 'เปิดใจผู้คนให้อยากช่วยเหลือ', tag: 'ดึงดูดโอกาสดี', color: COSMIC.magenta },
];

const Scene5DopaminePlacebo: React.FC<{ localFrame: number }> = ({ localFrame }) => {
  const { fps } = useVideoConfig();
  const tSec = localFrame / Math.max(1, fps);

  const burst = spring({
    frame: Math.max(0, localFrame - 16),
    fps,
    config: { damping: 12, stiffness: 160, mass: 0.72 },
  });

  return (
    <div
      style={{
        width: 920,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 18,
      }}
    >
      <svg width={880} height={385} viewBox="0 0 880 385" style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id="s5-synapse-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FCFADA" stopOpacity="0.92" />
            <stop offset="35%" stopColor="#FFD166" stopOpacity="0.46" />
            <stop offset="70%" stopColor="#FF5FB2" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#140C40" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx={440} cy={205} r={190} fill="url(#s5-synapse-glow)" opacity={0.45 + 0.55 * burst} />

        {/* Left Rounded Presynaptic Neuron Bulb */}
        <path
          d="M 28 158 C 110 158, 175 128, 250 128 C 315 128, 354 156, 354 205 C 354 254, 315 282, 250 282 C 175 282, 110 252, 28 252 Z"
          fill="rgba(42, 30, 120, 0.92)"
          stroke={COSMIC.magenta}
          strokeWidth={2.8}
        />
        <path
          d="M 184 146 C 234 134, 294 140, 326 168"
          fill="none"
          stroke={COSMIC.magenta}
          strokeWidth={4}
          strokeLinecap="round"
          strokeOpacity={0.32}
        />
        <text x={198} y={198} textAnchor="middle" fill={COSMIC.starlight} fontFamily={THAI_FONT_FAMILY} fontSize={23} fontWeight={700}>
          ความเชื่อเชิงบวก
        </text>
        <text x={198} y={228} textAnchor="middle" fill={COSMIC.magenta} fontFamily={THAI_FONT_FAMILY} fontSize={19} fontWeight={700}>
          “เดี๋ยวก็มีเรื่องดีๆ”
        </text>

        {/* Right Rounded Postsynaptic Receptor Bulb */}
        <path
          d="M 852 158 C 770 158, 705 128, 630 128 C 565 128, 526 156, 526 205 C 526 254, 565 282, 630 282 C 705 282, 770 252, 852 252 Z"
          fill="rgba(16, 48, 86, 0.92)"
          stroke={COSMIC.cyan}
          strokeWidth={2.8}
        />
        <path
          d="M 696 146 C 646 134, 586 140, 554 168"
          fill="none"
          stroke={COSMIC.cyan}
          strokeWidth={4}
          strokeLinecap="round"
          strokeOpacity={0.32}
        />
        <text x={682} y={198} textAnchor="middle" fill={COSMIC.starlight} fontFamily={THAI_FONT_FAMILY} fontSize={23} fontWeight={700}>
          ตัวรับรางวัล
        </text>
        <text x={682} y={228} textAnchor="middle" fill={COSMIC.cyan} fontFamily={THAI_FONT_FAMILY} fontSize={19} fontWeight={700}>
          Placebo Response
        </text>

        {/* Neurotransmitter Orbs Firing Across Synaptic Cleft */}
        {NEURO_ORBS.map((orb, idx) => {
          const cycle = (tSec * orb.speed + orb.phase) % 1;
          const x = interpolate(cycle, [0, 1], [360, 520]);
          const y = 205 + orb.lane * 0.42 + Math.sin(cycle * Math.PI * 2 + idx) * 14;
          const op = Math.sin(cycle * Math.PI) * (0.3 + 0.7 * burst);
          return (
            <g key={idx} opacity={op}>
              <circle cx={x} cy={y} r={orb.r * 1.9} fill={orb.color} opacity={0.28} />
              <circle cx={x} cy={y} r={orb.r} fill={orb.color} />
            </g>
          );
        })}

        {/* Floating Cleft Label */}
        <rect x={346} y={40} width={188} height={40} rx={20} fill="rgba(9, 7, 30, 0.92)" stroke={COSMIC.gold} strokeWidth={1.8} />
        <text x={440} y={67} textAnchor="middle" fill={COSMIC.gold} fontFamily={THAI_FONT_FAMILY} fontSize={21} fontWeight={700}>
          ซิแนปส์จุดประกาย
        </text>
      </svg>

      {/* 3 Neurochemical Cards (Synced Along Narration) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '92%' }}>
        {NEURO_CARDS.map((card, idx) => {
          const cSpring = spring({
            frame: Math.max(0, localFrame - (18 + idx * 38)),
            fps,
            config: { damping: 14, stiffness: 170, mass: 0.7 },
          });
          const x = interpolate(cSpring, [0, 1], [42, 0]);
          const op = interpolate(cSpring, [0, 0.55], [0, 1], { extrapolateRight: 'clamp' });
          return (
            <div
              key={card.name}
              style={{
                opacity: op,
                transform: `translate3d(${x.toFixed(1)}px, 0, 0)`,
                background: COSMIC.glassBg,
                border: `1.8px solid ${card.color}`,
                borderRadius: 22,
                padding: '14px 26px',
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                boxShadow: '0 10px 26px rgba(4, 3, 18, 0.48)',
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 16,
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: `1.2px solid ${card.color}55`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <NeuroCardIconSvg kind={card.kind} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: THAI_FONT_FAMILY, fontSize: 28, fontWeight: 700, color: card.color, lineHeight: 1.35 }}>
                  {card.name}
                </div>
                <div style={{ fontFamily: THAI_LOOPED_FAMILY, fontSize: 23, fontWeight: 700, color: COSMIC.textLight, lineHeight: 1.4 }}>
                  {card.desc}
                </div>
              </div>
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: `1.5px solid ${card.color}`,
                  borderRadius: 999,
                  padding: '8px 18px',
                  fontFamily: THAI_FONT_FAMILY,
                  fontSize: 21,
                  fontWeight: 700,
                  color: card.color,
                  whiteSpace: 'nowrap',
                  lineHeight: 1.4,
                }}
              >
                {card.tag}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// SCENE 6: 20-SECOND MYELIN SUPERHIGHWAY (VELCRO VS TEFLON)
// ============================================================================

const Scene6Neuroplasticity: React.FC<{ localFrame: number; durationFrames: number }> = ({
  localFrame,
}) => {
  const { fps } = useVideoConfig();
  const tSec = localFrame / Math.max(1, fps);

  const chargeProgress = interpolate(localFrame, [20, 168], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const timerCircum = 2 * Math.PI * 102;
  const timerDash = timerCircum * (1 - chargeProgress);
  const myelinThickness = interpolate(chargeProgress, [0, 1], [4, 24]);

  return (
    <div
      style={{
        width: 920,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
      }}
    >
      {/* Top Velcro vs Teflon Comparison Cards */}
      <div style={{ display: 'flex', gap: 20, width: '94%', justifyContent: 'center' }}>
        <div
          style={{
            flex: 1,
            background: COSMIC.glassBg,
            border: `1.5px solid ${COSMIC.coralAlert}`,
            borderRadius: 22,
            padding: '16px 22px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 26,
              fontWeight: 700,
              color: COSMIC.coralAlert,
              lineHeight: 1.4,
            }}
          >
            <NeuroCardIconSvg kind="velcro" />
            <span>เรื่องร้าย = Velcro</span>
          </div>
          <div style={{ fontFamily: THAI_LOOPED_FAMILY, fontSize: 22, color: COSMIC.textSoft, fontWeight: 700, lineHeight: 1.4 }}>
            สมองจำติดหนึบแบบตีนตุ๊กแกทันที
          </div>
        </div>

        <div
          style={{
            flex: 1,
            background: COSMIC.glassBg,
            border: `1.5px solid ${COSMIC.iceBlue}`,
            borderRadius: 22,
            padding: '16px 22px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 26,
              fontWeight: 700,
              color: COSMIC.iceBlue,
              lineHeight: 1.4,
            }}
          >
            <NeuroCardIconSvg kind="teflon" />
            <span>เรื่องดี = Teflon</span>
          </div>
          <div style={{ fontFamily: THAI_LOOPED_FAMILY, fontSize: 22, color: COSMIC.textSoft, fontWeight: 700, lineHeight: 1.4 }}>
            ถ้าไม่ตั้งใจซึมซับ จะลื่นหลุดไป
          </div>
        </div>
      </div>

      {/* 20-Second Myelin Superhighway Animation */}
      <svg width={880} height={470} viewBox="0 0 880 470" style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id="s6-myelin-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3BE3C6" />
            <stop offset="50%" stopColor="#FFD166" />
            <stop offset="100%" stopColor="#FF5FB2" />
          </linearGradient>
        </defs>

        {/* Central 20-Second Ring (Optically Centered Text) */}
        <circle cx={440} cy={145} r={102} fill="rgba(10, 8, 34, 0.90)" stroke="rgba(255,255,255,0.14)" strokeWidth={12} />
        <circle
          cx={440}
          cy={145}
          r={102}
          fill="none"
          stroke={COSMIC.gold}
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={timerCircum}
          strokeDashoffset={timerDash}
          transform="rotate(-90 440 145)"
        />
        <text
          x={440}
          y={140}
          textAnchor="middle"
          fill={COSMIC.gold}
          fontFamily={THAI_FONT_FAMILY}
          fontSize={54}
          fontWeight={700}
        >
          {Math.round(chargeProgress * 20)}s
        </text>
        <text
          x={440}
          y={178}
          textAnchor="middle"
          fill={COSMIC.starlight}
          fontFamily={THAI_FONT_FAMILY}
          fontSize={21}
          fontWeight={700}
        >
          ซึมซับความโชคดี
        </text>

        {/* Growing Neural Axon Pathway + Thickening Myelin Sheath */}
        <path
          d="M 100 352 C 240 278, 340 418, 440 352 C 540 288, 640 418, 780 352"
          fill="none"
          stroke="url(#s6-myelin-grad)"
          strokeWidth={myelinThickness * 2.1}
          strokeLinecap="round"
          strokeOpacity={0.22 + chargeProgress * 0.28}
        />
        <path
          d="M 100 352 C 240 278, 340 418, 440 352 C 540 288, 640 418, 780 352"
          fill="none"
          stroke="url(#s6-myelin-grad)"
          strokeWidth={myelinThickness}
          strokeLinecap="round"
        />
        <path
          d="M 100 352 C 240 278, 340 418, 440 352 C 540 288, 640 418, 780 352"
          fill="none"
          stroke={COSMIC.starlight}
          strokeWidth={3.2}
          strokeDasharray="16 20"
          strokeDashoffset={-tSec * 120}
        />

        {/* Neuron Start & End Nodes */}
        <circle cx={100} cy={352} r={24} fill="#140C40" stroke={COSMIC.cyan} strokeWidth={4} />
        <circle cx={780} cy={352} r={28} fill="#140C40" stroke={COSMIC.gold} strokeWidth={4} />
        <circle cx={780} cy={352} r={12} fill={COSMIC.starlight} />

        {/* Myelin Caption Pill with Vector Star */}
        <rect x={165} y={415} width={550} height={48} rx={24} fill="rgba(9, 7, 30, 0.92)" stroke={COSMIC.gold} strokeWidth={1.8} />
        <polygon points="214,429 216.5,436.5 224,439 216.5,441.5 214,449 211.5,441.5 204,439 211.5,436.5" fill={COSMIC.gold} />
        <text x={452} y={447} textAnchor="middle" fill={COSMIC.gold} fontFamily={THAI_FONT_FAMILY} fontSize={24} fontWeight={700}>
          สร้างปลอกไมอีลิน = ทางด่วนความสุขถาวร
        </text>
      </svg>
    </div>
  );
};

// ============================================================================
// SCENE 7: 3-STEP COSMIC ALIGNMENT CTA & STILLNESS HOLD
// ============================================================================

const CTA_STEPS = [
  {
    num: '01',
    title: 'ตั้งคำถาม: “วันนี้ฉันโชคดีเรื่องอะไร?”',
    sub: 'เปิดเสาอากาศ RAS ให้มองหาโอกาสทันที',
    color: COSMIC.gold,
  },
  {
    num: '02',
    title: 'ซึมซับความรู้สึกดีให้นาน 20 วินาที',
    sub: 'เปลี่ยนความรู้สึกชั่วคราวเป็นปลอกไมอีลินถาวร',
    color: COSMIC.cyan,
  },
  {
    num: '03',
    title: 'พลิกมุมมองอุปสรรคให้ไว',
    sub: 'ให้สมองส่วนหน้า PFC ดับความกลัวของ Amygdala',
    color: COSMIC.magenta,
  },
];

const Scene7CosmicCta: React.FC<{ localFrame: number }> = ({ localFrame }) => {
  const { fps } = useVideoConfig();
  const tSec = localFrame / Math.max(1, fps);

  const orbBreath = 1 + 0.045 * Math.sin(tSec * 2.2);
  const exhaleRing = spring({
    frame: Math.max(0, localFrame - 16),
    fps,
    config: { damping: 16, stiffness: 120, mass: 0.9 },
  });

  const closingIn = spring({
    frame: Math.max(0, localFrame - 135),
    fps,
    config: { damping: 14, stiffness: 160, mass: 0.75 },
  });

  return (
    <div
      style={{
        width: 920,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 18,
      }}
    >
      {/* Top Radiant Cosmic Resonance Emblem (High-Contrast Vector Emblem) */}
      <svg width={440} height={206} viewBox="0 0 440 206" style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id="s7-orb-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FCFADA" stopOpacity="0.96" />
            <stop offset="34%" stopColor="#FFD166" stopOpacity="0.72" />
            <stop offset="68%" stopColor="#FF5FB2" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#140C40" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx={220} cy={103} r={100 * orbBreath} fill="url(#s7-orb-grad)" />
        <circle
          cx={220}
          cy={103}
          r={54 + exhaleRing * 52}
          fill="none"
          stroke={COSMIC.cyan}
          strokeWidth={2.2}
          strokeOpacity={0.58}
        />
        <circle
          cx={220}
          cy={103}
          r={46}
          fill="rgba(11, 8, 36, 0.92)"
          stroke={COSMIC.gold}
          strokeWidth={2.6}
        />
        <g transform={`rotate(${(tSec * 14).toFixed(2)} 220 103)`}>
          <circle
            cx={220}
            cy={103}
            r={58}
            fill="none"
            stroke={COSMIC.gold}
            strokeWidth={1.6}
            strokeDasharray="6 8"
            strokeOpacity={0.75}
          />
        </g>
        <polygon
          points="220,76 226,97 247,103 226,109 220,130 214,109 193,103 214,97"
          fill={COSMIC.gold}
        />
        <circle cx={220} cy={103} r={6} fill={COSMIC.starlight} />
      </svg>

      {/* 3 Orbital Action Cards (Staggered Across Narration) */}
      <div
        style={{
          width: '94%',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          perspective: 1200,
        }}
      >
        {CTA_STEPS.map((step, idx) => {
          const flip = spring({
            frame: Math.max(0, localFrame - (14 + idx * 42)),
            fps,
            config: { damping: 14, stiffness: 160, mass: 0.74 },
          });
          const rotX = interpolate(flip, [0, 1], [-65, 0]);
          const op = interpolate(flip, [0, 0.55], [0, 1], { extrapolateRight: 'clamp' });
          return (
            <div
              key={step.num}
              style={{
                opacity: op,
                transform: `rotateX(${rotX.toFixed(1)}deg)`,
                transformOrigin: '50% 0%',
                background: COSMIC.glassBg,
                border: `2px solid ${step.color}`,
                borderRadius: 24,
                padding: '16px 26px',
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                boxShadow: '0 12px 28px rgba(4, 3, 18, 0.5)',
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 18,
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: `1.5px solid ${step.color}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: THAI_FONT_FAMILY,
                  fontSize: 26,
                  fontWeight: 700,
                  color: step.color,
                  flexShrink: 0,
                }}
              >
                {step.num}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: THAI_FONT_FAMILY, fontSize: 28, fontWeight: 700, color: '#FFFFFF', lineHeight: 1.4 }}>
                  {step.title}
                </div>
                <div style={{ fontFamily: THAI_LOOPED_FAMILY, fontSize: 22, fontWeight: 700, color: step.color, lineHeight: 1.4 }}>
                  {step.sub}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Closing Cosmic Promise */}
      <div
        style={{
          marginTop: 6,
          opacity: interpolate(closingIn, [0, 0.6], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `scale(${interpolate(closingIn, [0, 1], [0.92, 1]).toFixed(4)})`,
          background: 'rgba(255, 209, 102, 0.14)',
          border: `1.5px solid ${COSMIC.gold}`,
          borderRadius: 999,
          padding: '10px 30px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 12,
          fontFamily: THAI_FONT_FAMILY,
          fontSize: 26,
          fontWeight: 700,
          color: COSMIC.starlight,
          lineHeight: 1.4,
        }}
      >
        <SparkStarSvg size={22} color={COSMIC.gold} />
        <span>จักรวาลใจดีกับสมองที่พร้อมเปิดรับเสมอ</span>
      </div>
    </div>
  );
};

// ============================================================================
// PERSISTENT NON-GHOSTING HUD (TOP CHAPTER BAR + SOURCE CITATION PILL)
// ============================================================================

const CosmicHudOverlay: React.FC<{
  activeScene: CosmicTimelineScene;
  sceneIdx: number;
  totalScenes: number;
}> = ({ activeScene, sceneIdx, totalScenes }) => {
  const meta = SCRIPT_META_BY_ID[activeScene.id];
  const badge = activeScene.badge || meta?.badge || `${String(sceneIdx + 1).padStart(2, '0')}`;
  const source = activeScene.source || meta?.source || '';

  return (
    <>
      {/* Top Safe Zone Chapter Bar (top: 156px >= 150px) */}
      <div
        style={{
          position: 'absolute',
          top: 156,
          left: 56,
          right: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pointerEvents: 'none',
          zIndex: 55,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            background: COSMIC.glassDeep,
            border: `1.5px solid ${COSMIC.borderCyan}`,
            borderRadius: 999,
            padding: '6px 20px',
          }}
        >
          <span
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 22,
              fontWeight: 700,
              color: COSMIC.gold,
              lineHeight: 1.4,
            }}
          >
            {badge} / {String(totalScenes).padStart(2, '0')}
          </span>
          <span
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 20,
              fontWeight: 700,
              color: COSMIC.iceBlue,
              lineHeight: 1.4,
            }}
          >
            · พลังจักรวาลในสมอง
          </span>
        </div>

        {/* Constellation Progress Dots */}
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
                  borderRadius: 99,
                  background: active
                    ? COSMIC.gold
                    : past
                      ? COSMIC.cyan
                      : 'rgba(255, 255, 255, 0.24)',
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Science Source Citation Pill (above KaraokeSubtitle) */}
      {source && (
        <div
          style={{
            position: 'absolute',
            bottom: 446,
            left: 56,
            right: 56,
            display: 'flex',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 55,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              background: COSMIC.glassDeep,
              border: `1.5px solid ${COSMIC.borderCyan}`,
              borderRadius: 999,
              padding: '7px 22px',
              boxShadow: '0 8px 24px rgba(4, 3, 18, 0.48)',
            }}
          >
            <svg width={15} height={15} viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
              <polygon points="8,0 10,6 16,8 10,10 8,16 6,10 0,8 6,6" fill="#3BE3C6" />
            </svg>
            <span
              style={{
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 21,
                fontWeight: 700,
                lineHeight: 1.4,
                color: COSMIC.iceBlue,
              }}
            >
              {source}
            </span>
          </div>
        </div>
      )}
    </>
  );
};

// ============================================================================
// SCENE CONTENT WRAPPER (CRISP NON-GHOSTING TRANSITION)
// ============================================================================

const CosmicSceneContent: React.FC<{
  scene: CosmicTimelineScene;
  sceneIdx: number;
  renderDuration: number;
  isFirst: boolean;
  isLast: boolean;
}> = ({ scene, sceneIdx, renderDuration, isFirst, isLast }) => {
  const localFrame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const meta = SCRIPT_META_BY_ID[scene.id];
  const title = scene.title || meta?.title || '';
  const subtitle = scene.subtitle || meta?.subtitle || '';

  const tKind = SCENE_TRANSITIONS[sceneIdx % SCENE_TRANSITIONS.length];

  // Flash-bridged dissolve: outgoing finishes by cutFrame (renderDuration - OVERLAP_HALF),
  // incoming enters from cutFrame (localFrame = OVERLAP_HALF), keeping backdrop + LightLeakFlash continuous
  // with zero diagram-on-diagram ghosting and zero black frames.
  const inRaw = isFirst
    ? 1
    : interpolate(localFrame, [OVERLAP_HALF - 1, OVERLAP_HALF + 6], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
  const outRaw = isLast
    ? 0
    : interpolate(localFrame, [renderDuration - OVERLAP_HALF - 6, renderDuration - OVERLAP_HALF + 1], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
  const inEase = Easing.inOut(Easing.cubic)(inRaw);
  const outEase = Easing.inOut(Easing.cubic)(outRaw);
  const opacity = inEase * (1 - outEase);

  const scale =
    tKind === 'zoomThrough'
      ? interpolate(inEase, [0, 1], [0.95, 1]) * interpolate(outEase, [0, 1], [1, 1.04])
      : interpolate(inEase, [0, 1], [1.02, 1]) * interpolate(outEase, [0, 1], [1, 1.02]);

  const subPop = spring({
    frame: Math.max(0, localFrame - 8),
    fps,
    config: { damping: 16, stiffness: 170, mass: 0.72 },
  });

  const renderHero = () => {
    switch (scene.id) {
      case 's1_cosmic_hook':
        return <Scene1CosmicHook localFrame={localFrame} durationFrames={renderDuration} />;
      case 's2_ras_filter':
        return <Scene2RasFilter localFrame={localFrame} />;
      case 's3_wiseman_broaden':
        return <Scene3WisemanBroaden localFrame={localFrame} />;
      case 's4_pfc_amygdala':
        return <Scene4PfcAmygdala localFrame={localFrame} />;
      case 's5_dopamine_placebo':
        return <Scene5DopaminePlacebo localFrame={localFrame} />;
      case 's6_neuroplasticity':
        return <Scene6Neuroplasticity localFrame={localFrame} durationFrames={renderDuration} />;
      case 's7_cosmic_cta':
      default:
        return <Scene7CosmicCta localFrame={localFrame} />;
    }
  };

  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `scale(${scale.toFixed(4)})`,
      }}
    >
      {/* Main Content Stage (Title + Subtitle + Hero Visual, strictly inside safe bounds) */}
      <div
        style={{
          position: 'absolute',
          top: 214,
          bottom: 510,
          left: 48,
          right: 48,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <CosmicKineticTitle
          text={title}
          startFrame={isFirst ? 2 : 5}
          highlight={TITLE_HIGHLIGHTS[scene.id] ?? []}
          fontSize={44}
          maxWidth={930}
        />

        <div
          style={{
            marginTop: 6,
            opacity: interpolate(subPop, [0, 0.6], [0, 1], { extrapolateRight: 'clamp' }),
            transform: `translate3d(0, ${interpolate(subPop, [0, 1], [12, 0]).toFixed(1)}px, 0)`,
            fontFamily: THAI_LOOPED_FAMILY,
            fontSize: 26,
            fontWeight: 700,
            color: COSMIC.textSoft,
            textAlign: 'center',
            lineHeight: 1.42,
            maxWidth: 880,
            paddingTop: 4,
            paddingBottom: 4,
          }}
        >
          {subtitle}
        </div>

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
    </AbsoluteFill>
  );
};

// ============================================================================
// SINGLE-PASS COSMIC NEBULA & STARFIELD BACKDROP
// ============================================================================

const COSMIC_STARS = Array.from({ length: 56 }, (_, i) => ({
  x: random(`cos-star-x-${i}`) * 1080,
  y: random(`cos-star-y-${i}`) * 1920,
  r: 0.9 + random(`cos-star-r-${i}`) * 2.1,
  phase: random(`cos-star-p-${i}`) * Math.PI * 2,
  speed: 1.1 + random(`cos-star-s-${i}`) * 2.2,
  tint: i % 5 === 0 ? '#FFD166' : i % 7 === 0 ? '#85C9FB' : '#FCFADA',
}));

const COSMIC_GRID_URI = (() => {
  const s = 180;
  const h = s / 2;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}' viewBox='0 0 ${s} ${s}'>` +
    `<circle cx='${h}' cy='${h}' r='64' fill='none' stroke='#85C9FB' stroke-width='0.9' stroke-dasharray='4 8' opacity='0.55'/>` +
    `<circle cx='${h}' cy='${h}' r='28' fill='none' stroke='#FFD166' stroke-width='0.8' opacity='0.45'/>` +
    `<line x1='${h}' y1='0' x2='${h}' y2='${s}' stroke='#85C9FB' stroke-width='0.6' opacity='0.28'/>` +
    `<line x1='0' y1='${h}' x2='${s}' y2='${h}' stroke='#85C9FB' stroke-width='0.6' opacity='0.28'/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
})();

const CosmicNebulaBackdrop: React.FC<{ progress: number }> = ({ progress }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const tSec = frame / Math.max(1, fps);

  const nebulaShiftY = interpolate(progress, [0, 1], [48, 36]);
  const magentaAlpha = interpolate(progress, [0, 0.5, 1], [0.18, 0.24, 0.20]);
  const goldAlpha = interpolate(progress, [0, 0.6, 1], [0.10, 0.18, 0.28]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        backgroundImage: [
          `radial-gradient(circle 620px at 50% ${nebulaShiftY.toFixed(1)}%, rgba(255, 209, 102, ${goldAlpha.toFixed(3)}) 0%, rgba(255, 95, 178, ${magentaAlpha.toFixed(3)}) 34%, rgba(59, 227, 198, 0.12) 60%, rgba(11, 8, 36, 0) 100%)`,
          `radial-gradient(circle 520px at 18% 24%, rgba(59, 227, 198, 0.15) 0%, rgba(20, 12, 64, 0) 75%)`,
          `radial-gradient(circle 520px at 84% 72%, rgba(255, 95, 178, 0.16) 0%, rgba(20, 12, 64, 0) 75%)`,
          `linear-gradient(180deg, rgba(6, 4, 23, 0.68) 0%, rgba(6, 4, 23, 0.12) 26%, rgba(6, 4, 23, 0.10) 64%, rgba(6, 4, 23, 0.72) 100%)`,
          `linear-gradient(180deg, #07051A 0%, #140C40 42%, #231462 74%, #0B0824 100%)`,
        ].join(', '),
      }}
    >
      {/* Subtle Cosmic Sacred Orbit Grid */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.08,
          backgroundImage: COSMIC_GRID_URI,
          backgroundRepeat: 'repeat',
          backgroundSize: '180px 180px',
          backgroundPosition: `${(tSec * 4).toFixed(1)}px ${(-tSec * 3).toFixed(1)}px`,
        }}
      />

      {/* Twinkling Deep Space Starfield */}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        {COSMIC_STARS.map((st, idx) => {
          const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(tSec * st.speed + st.phase));
          return (
            <circle
              key={idx}
              cx={st.x}
              cy={st.y}
              r={st.r}
              fill={st.tint}
              opacity={twinkle}
            />
          );
        })}
      </svg>
    </div>
  );
};

// ============================================================================
// ROOT COSMIC POSITIVITY COMPOSITION
// ============================================================================

export const CosmicPositivity: React.FC<CosmicPositivityProps> = (props) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const scenes = props.scenes && props.scenes.length > 0 ? props.scenes : DEFAULT_COSMIC_PROPS.scenes;
  const allCues = props.cues && props.cues.length > 0 ? props.cues : DEFAULT_COSMIC_PROPS.cues;
  const totalFrames = Math.max(90, props.totalFrames || durationInFrames);

  const cosmicProgress = interpolate(frame, [0, Math.max(1, totalFrames - 1)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const activeIdxRaw = scenes.findIndex((s) => frame >= s.startFrame && frame < s.endFrame);
  const activeIdx = activeIdxRaw >= 0 ? activeIdxRaw : scenes.length - 1;
  const activeScene = scenes[activeIdx];

  const cutFrames = scenes.slice(1).map((s) => s.startFrame);

  return (
    <AbsoluteFill style={{ backgroundColor: COSMIC.voidBg, overflow: 'hidden' }}>
      <ThaiFontLoader />

      {/* Continuous Living Cosmic Nebula + Rotating LightRays + Starlight Motes */}
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <CosmicNebulaBackdrop progress={cosmicProgress} />
        <LightRays
          count={8}
          color="#FFD166"
          intensity={interpolate(cosmicProgress, [0, 0.5, 1], [0.22, 0.34, 0.44])}
          originX={0.5}
          originY={interpolate(cosmicProgress, [0, 1], [0.48, 0.36])}
          rotationSpeed={2.2}
          blur={18}
          seed="cosmic-rays"
        />
        <ParticleField
          count={34}
          seed="cosmic-motes"
          color="#FFE8B6"
          drift={22}
          size={4.2}
          opacity={0.76}
          bokehRatio={0.32}
          blendMode="normal"
        />
      </AbsoluteFill>

      {/* Overlapping Cross-Faded Scene Sequences */}
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
            <CosmicSceneContent
              scene={scene}
              sceneIdx={idx}
              renderDuration={renderDur}
              isFirst={isFirst}
              isLast={isLast}
            />
          </Sequence>
        );
      })}

      {/* Persistent Non-Ghosting Chapter HUD & Source Pill */}
      {activeScene && (
        <CosmicHudOverlay
          activeScene={activeScene}
          sceneIdx={activeIdx}
          totalScenes={scenes.length}
        />
      )}

      {/* Light-Leak Flash Bridging Every Scene Cut */}
      <LightLeakFlash
        at={cutFrames}
        durationFrames={16}
        color="#FFD166"
        secondaryColor="#FF5FB2"
        intensity={0.62}
      />

      {/* Word-Level Karaoke Subtitles in Safe Zone (bottomOffset=275 >= 260) */}
      <CosmicKaraokeSubtitle
        cues={allCues}
        wordBoundaries={activeScene?.wordBoundaries}
        sceneSpeechStartSec={activeScene?.speechStartSec ?? activeScene?.startSec ?? 0}
        bottomOffset={275}
      />

      {/* Subtle Film Grain + Soft Cosmic Vignette */}
      <FilmGrainVignette
        grain={0.022}
        vignette={0.34}
        vignetteColor="#040312"
        updateEveryFrames={3}
      />
    </AbsoluteFill>
  );
};
