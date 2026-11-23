import React, { useId } from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
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
  CameraRig,
  CountUp,
  FilmGrainVignette,
  LightLeakFlash,
  LightRays,
  ParticleField,
  transitionStyle,
} from '../../components/fx';
import type { SubtitleCue, TransitionKind } from '../../components/fx';
import scriptData from './script.json';

// ============================================================================
// TYPES & DEFAULT PROPS
// ============================================================================

export type CpuTimelineScene = {
  id: string;
  index: number;
  badge?: string;
  title?: string;
  subtitle?: string;
  narration?: string;
  startSec?: number;
  speechStartSec?: number;
  speechDurSec?: number;
  endSec?: number;
  startFrame: number;
  durationFrames: number;
  endFrame: number;
  cues: SubtitleCue[];
};

export type CpuHowItWorksProps = {
  title: string;
  fps: number;
  width?: number;
  height?: number;
  totalSec?: number;
  totalFrames: number;
  scenes: CpuTimelineScene[];
  cues: SubtitleCue[];
};

function buildDefaultProps(): CpuHowItWorksProps {
  const fps = scriptData.fps || 30;
  const defaultDur = 195;
  const scenes: CpuTimelineScene[] = [];
  const cues: SubtitleCue[] = [];
  let cursor = 0;

  scriptData.scenes.forEach((sc, idx) => {
    const startFrame = cursor;
    const endFrame = cursor + defaultDur;
    const rawSubs = sc.subtitles || [];
    const sceneCues: SubtitleCue[] = rawSubs.map((sub, sIdx) => {
      const slice = Math.floor((defaultDur - 24) / Math.max(1, rawSubs.length));
      const cf0 = startFrame + 10 + sIdx * slice;
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
      narration: sc.narration,
      startSec: startFrame / fps,
      speechStartSec: startFrame / fps + 0.35,
      speechDurSec: (defaultDur - 24) / fps,
      endSec: endFrame / fps,
      startFrame,
      durationFrames: defaultDur,
      endFrame,
      cues: sceneCues,
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

export const DEFAULT_CPU_PROPS: CpuHowItWorksProps = buildDefaultProps();

// ============================================================================
// EDITORIAL PALETTE & CONSTANTS
// ============================================================================

const PALETTE = {
  // Light Editorial Cover (Scene 1 Hook)
  ivoryTop: '#F6F1E7',
  ivoryMid: '#EFE7D6',
  ivoryBottom: '#E6DBC5',
  inkDark: '#171A26',
  inkMuted: '#4A4E5E',
  copperAccent: '#C96228',
  amberAccent: '#D97706',

  // Deep Midnight -> Warm Copper Horizon (Scenes 2-4)
  midnightTop: '#0C101E',
  midnightMid: '#151B2E',
  horizonWarm: '#5C342B',
  horizonCopper: '#A85C3A',
  creamWhite: '#FAF6EE',
  creamMuted: 'rgba(250, 246, 238, 0.68)',
  goldGlow: '#FFD166',
  copperLight: '#F2995A',
  logicCyan: '#7DE2D1',
} as const;

const OVERLAP_HALF = 4;

const SCENE_TRANSITIONS: TransitionKind[] = [
  'lightLeak',
  'zoomThrough',
  'lightLeak',
  'fade',
];

// ============================================================================
// UTILITY: QUADRATIC BEZIER POINT SAMPLING
// ============================================================================

function quadBezier(
  t: number,
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
): [number, number] {
  const mt = 1 - t;
  return [
    mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
    mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
  ];
}

// ============================================================================
// LAYER 1: CONTINUOUS HORIZON ATMOSPHERE (DARK SCENES 2-4)
// ============================================================================

const HorizonAtmosphere: React.FC<{ progress: number }> = ({ progress }) => {
  const glowRise = interpolate(progress, [0, 1], [0.06, 0.24], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const horizonOpacity = interpolate(progress, [0, 1], [0.55, 0.92], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${PALETTE.midnightTop} 0%, ${PALETTE.midnightMid} 44%, #3B2834 74%, #7A4735 90%, #A95F3C 100%)`,
      }}
    >
      {/* Subtle warm horizon bloom that gently lifts toward the climax */}
      <div
        style={{
          position: 'absolute',
          left: '-15%',
          right: '-15%',
          bottom: '-18%',
          height: '58%',
          opacity: horizonOpacity,
          background: `radial-gradient(ellipse 68% 62% at 50% ${Math.round(
            (0.9 - glowRise) * 100,
          )}%, rgba(212, 122, 68, 0.42) 0%, rgba(168, 92, 58, 0.18) 48%, rgba(12, 16, 30, 0) 78%)`,
        }}
      />
    </AbsoluteFill>
  );
};

// ============================================================================
// LAYER 5: BORDERLESS FLOATING CINEMA SUBTITLE (NO PILL BOX)
// ============================================================================

const CinemaSubtitle: React.FC<{
  cues: SubtitleCue[];
  isLightBackdrop: boolean;
}> = ({ cues, isLightBackdrop }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const active = cues.find((c) => frame >= c.startFrame && frame <= c.endFrame);
  if (!active) return null;

  const localFrame = frame - active.startFrame;
  const remaining = active.endFrame - frame;

  const enter = spring({
    frame: localFrame,
    fps,
    config: { damping: 18, stiffness: 200, mass: 0.7 },
  });
  const fadeOut = interpolate(remaining, [0, 5], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity =
    interpolate(localFrame, [0, 5], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }) * fadeOut;
  const translateY = interpolate(enter, [0, 1], [12, 0]);

  const baseColor = isLightBackdrop ? PALETTE.inkDark : PALETTE.creamWhite;
  const accentColor = isLightBackdrop ? PALETTE.copperAccent : PALETTE.goldGlow;
  const shadowStyle = isLightBackdrop
    ? '0 2px 12px rgba(246, 241, 231, 0.95)'
    : '0 3px 18px rgba(5, 8, 18, 0.9), 0 1px 4px rgba(0, 0, 0, 0.92)';

  const kw = active.highlight?.trim() ?? '';
  const hasKw = kw.length > 0 && active.text.includes(kw);

  const renderText = () => {
    if (!hasKw) return <span>{active.text}</span>;
    const parts = active.text.split(kw);
    return (
      <>
        {parts.map((part, idx) => (
          <React.Fragment key={idx}>
            {part}
            {idx < parts.length - 1 && (
              <span
                style={{
                  color: accentColor,
                  textShadow: isLightBackdrop
                    ? '0 2px 10px rgba(201, 98, 40, 0.18)'
                    : '0 0 18px rgba(255, 209, 102, 0.48), 0 3px 16px rgba(0, 0, 0, 0.85)',
                }}
              >
                {kw}
              </span>
            )}
          </React.Fragment>
        ))}
      </>
    );
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: 96,
        right: 96,
        bottom: 268,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 60,
      }}
    >
      <div
        style={{
          opacity,
          transform: `translate3d(0, ${translateY.toFixed(2)}px, 0)`,
          color: baseColor,
          fontFamily: THAI_FONT_FAMILY,
          fontWeight: 700,
          fontSize: active.text.length > 32 ? 38 : 42,
          lineHeight: 1.48,
          textAlign: 'center',
          textShadow: shadowStyle,
          maxWidth: 840,
          paddingTop: 8,
          paddingBottom: 8,
          wordBreak: 'keep-all',
        }}
      >
        {renderText()}
      </div>
    </div>
  );
};

// ============================================================================
// SCENE 1: EDITORIAL IVORY HOOK + FINE-LINE CPU SILICON AWAKENING
// ============================================================================

const Scene1Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  const chipSpring = spring({
    frame: Math.max(0, frame - 4),
    fps,
    config: { damping: 16, stiffness: 130, mass: 0.9 },
  });
  const chipScale = interpolate(chipSpring, [0, 1], [0.92, 1]);
  const chipOpacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Mouse click ripple triggering at frame 8
  const clickProgress = interpolate(frame, [8, 44], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const rippleR1 = interpolate(clickProgress, [0, 1], [12, 130]);
  const rippleOp1 = interpolate(clickProgress, [0, 0.18, 1], [0, 0.72, 0]);
  const rippleR2 = interpolate(
    interpolate(frame, [16, 56], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
    [0, 1],
    [10, 168],
  );
  const rippleOp2 = interpolate(
    interpolate(frame, [16, 56], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
    [0, 0.2, 1],
    [0, 0.45, 0],
  );

  // Subtle steady core breath
  const pulse = 0.7 + 0.3 * Math.sin((frame / fps) * Math.PI * 2.1);

  // Fine-line CPU draw-in
  const outlineLen = 1400;
  const outlineDraw = interpolate(frame, [2, 34], [outlineLen, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const cx = 450;
  const cy = 430;
  const boxSize = 320;
  const half = boxSize / 2;
  const pinCount = 7;

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${PALETTE.ivoryTop} 0%, ${PALETTE.ivoryMid} 58%, ${PALETTE.ivoryBottom} 100%)`,
      }}
    >
      {/* Warm Editorial Radial Glow Behind CPU */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '56%',
          width: 780,
          height: 780,
          transform: 'translate(-50%, -50%)',
          background:
            'radial-gradient(circle, rgba(217, 132, 60, 0.26) 0%, rgba(217, 132, 60, 0.09) 42%, rgba(246, 241, 231, 0) 72%)',
          pointerEvents: 'none',
        }}
      />

      {/* Open-space Editorial Title (y = 285..490) — Crisp Ink on Ivory, Zero Muddy Shadow */}
      <div
        style={{
          position: 'absolute',
          top: 285,
          left: 84,
          right: 84,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            opacity: interpolate(frame, [0, 12], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            transform: `translate3d(0, ${interpolate(
              spring({ frame, fps, config: { damping: 16, stiffness: 170, mass: 0.75 } }),
              [0, 1],
              [22, 0],
            ).toFixed(1)}px, 0)`,
            fontFamily: THAI_FONT_FAMILY,
            fontWeight: 700,
            fontSize: 64,
            lineHeight: 1.42,
            color: PALETTE.inkDark,
            paddingTop: 8,
            paddingBottom: 8,
          }}
        >
          คลิกแค่<span style={{ color: PALETTE.copperAccent }}>เสี้ยววินาที</span>
        </div>
        <div
          style={{
            marginTop: 6,
            opacity: interpolate(frame, [12, 26], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            transform: `translate3d(0, ${interpolate(frame, [12, 26], [14, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }).toFixed(1)}px, 0)`,
            fontFamily: THAI_FONT_FAMILY,
            fontWeight: 700,
            fontSize: 44,
            lineHeight: 1.44,
            color: PALETTE.inkMuted,
            paddingTop: 6,
            paddingBottom: 6,
          }}
        >
          ข้างใน <span style={{ color: PALETTE.copperAccent }}>ซีพียู</span> เกิดอะไรขึ้น?
        </div>
      </div>

      {/* Minimalist Fine-Line CPU Architectural Illustration (y = 520..1380) */}
      <div
        style={{
          position: 'absolute',
          top: 520,
          left: 90,
          width: 900,
          height: 860,
          opacity: chipOpacity,
          transform: `scale(${chipScale.toFixed(4)})`,
        }}
      >
        <svg width={900} height={860} viewBox="0 0 900 860">
          <defs>
            <radialGradient id={`s1-core-${uid}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FDE68A" stopOpacity="0.95" />
              <stop offset="35%" stopColor="#F59E0B" stopOpacity="0.48" />
              <stop offset="72%" stopColor="#C96228" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#C96228" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Click Spark & Ripples Entering From Top */}
          <line
            x1={cx}
            y1={120}
            x2={cx}
            y2={cy - half - 36}
            stroke={PALETTE.copperAccent}
            strokeWidth={2}
            strokeDasharray="6 8"
            opacity={0.45}
          />
          <circle
            cx={cx}
            cy={120}
            r={rippleR1}
            fill="none"
            stroke={PALETTE.copperAccent}
            strokeWidth={2}
            opacity={rippleOp1}
          />
          <circle
            cx={cx}
            cy={120}
            r={rippleR2}
            fill="none"
            stroke={PALETTE.amberAccent}
            strokeWidth={1.5}
            opacity={rippleOp2}
          />
          <circle cx={cx} cy={120} r={7} fill={PALETTE.copperAccent} opacity={0.9} />

          {/* Soft Core Glow */}
          <circle cx={cx} cy={cy} r={210 + pulse * 14} fill={`url(#s1-core-${uid})`} />

          {/* CPU Pins (4 sides, sequential warm lighting) */}
          {Array.from({ length: pinCount }, (_, i) => {
            const offset = -114 + i * 38;
            const pinReveal = interpolate(frame, [10 + i * 2, 20 + i * 2], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            const isLit = (Math.floor(frame / 4) + i) % 3 === 0;
            const pinColor = isLit ? PALETTE.copperAccent : '#33384D';
            const pinLen = 36 * pinReveal;

            return (
              <g key={i} strokeLinecap="round" strokeWidth={2.6}>
                {/* Top */}
                <line
                  x1={cx + offset}
                  y1={cy - half}
                  x2={cx + offset}
                  y2={cy - half - pinLen}
                  stroke={pinColor}
                  opacity={0.78}
                />
                {/* Bottom */}
                <line
                  x1={cx + offset}
                  y1={cy + half}
                  x2={cx + offset}
                  y2={cy + half + pinLen}
                  stroke={pinColor}
                  opacity={0.78}
                />
                {/* Left */}
                <line
                  x1={cx - half}
                  y1={cy + offset}
                  x2={cx - half - pinLen}
                  y2={cy + offset}
                  stroke={pinColor}
                  opacity={0.78}
                />
                {/* Right */}
                <line
                  x1={cx + half}
                  y1={cy + offset}
                  x2={cx + half + pinLen}
                  y2={cy + offset}
                  stroke={pinColor}
                  opacity={0.78}
                />
              </g>
            );
          })}

          {/* Outer CPU Substrate Package Frame */}
          <rect
            x={cx - half}
            y={cy - half}
            width={boxSize}
            height={boxSize}
            rx={28}
            fill="rgba(255, 252, 245, 0.55)"
            stroke={PALETTE.inkDark}
            strokeWidth={2.8}
            strokeDasharray={outlineLen}
            strokeDashoffset={outlineDraw}
          />

          {/* Chamfered Pin-1 Orientation Notch */}
          <path
            d={`M ${cx - half + 26} ${cy - half + 48} L ${cx - half + 48} ${cy - half + 26}`}
            stroke={PALETTE.copperAccent}
            strokeWidth={3}
            strokeLinecap="round"
          />

          {/* Inner Die Border */}
          <rect
            x={cx - 94}
            y={cy - 94}
            width={188}
            height={188}
            rx={18}
            fill="rgba(255, 248, 232, 0.72)"
            stroke={PALETTE.copperAccent}
            strokeWidth={2.2}
          />

          {/* Clean Quadrant Hairlines */}
          <line
            x1={cx - 72}
            y1={cy}
            x2={cx + 72}
            y2={cy}
            stroke={PALETTE.inkDark}
            strokeWidth={1.2}
            opacity={0.22}
          />
          <line
            x1={cx}
            y1={cy - 72}
            x2={cx}
            y2={cy + 72}
            stroke={PALETTE.inkDark}
            strokeWidth={1.2}
            opacity={0.22}
          />

          {/* Central Glowing Silicon Heart */}
          <circle
            cx={cx}
            cy={cy}
            r={24 + pulse * 4}
            fill="rgba(217, 119, 6, 0.16)"
            stroke={PALETTE.copperAccent}
            strokeWidth={2}
          />
          <circle cx={cx} cy={cy} r={8} fill={PALETTE.copperAccent} />

          {/* Tiny Quiet Architecture Marks */}
          <g
            fontFamily="monospace"
            fontSize={14}
            fontWeight={700}
            fill={PALETTE.inkMuted}
            textAnchor="middle"
            opacity={0.78}
          >
            <text x={cx - 42} y={cy - 36}>
              FETCH
            </text>
            <text x={cx + 42} y={cy - 36}>
              DECODE
            </text>
            <text x={cx - 42} y={cy + 48}>
              ALU
            </text>
            <text x={cx + 42} y={cy + 48}>
              CLOCK
            </text>
          </g>
        </svg>
      </div>
    </AbsoluteFill>
  );
};

// ============================================================================
// SCENE 2: FETCH — LUMINOUS PULSE FROM RAM TO INSTRUCTION REGISTER
// ============================================================================

const Scene2Fetch: React.FC = () => {
  const frame = useCurrentFrame();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  const reveal = interpolate(frame, [8, 26], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  // 3 data packets traveling smoothly along Bezier paths from RAM cell to IR
  const packets = [0, 1, 2].map((i) => {
    const startF = 2 + i * 16;
    const cycleLen = 48;
    const elapsed = frame - startF;
    const t = elapsed >= 0 ? (elapsed % cycleLen) / cycleLen : 0;
    const visible = elapsed >= 0 && t > 0 && t < 1;
    const laneOffset = (i - 1) * 28;
    const pos = quadBezier(
      t,
      [450 + laneOffset * 0.5, 250],
      [450 + laneOffset * 2.2, 430],
      [450 + laneOffset * 0.8, 595],
    );
    return { x: pos[0], y: pos[1], visible, alpha: Math.sin(t * Math.PI) };
  });

  const irGlow = interpolate(frame, [20, 46], [0.25, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      {/* Whisper-quiet Editorial Header */}
      <div
        style={{
          position: 'absolute',
          top: 280,
          left: 84,
          right: 84,
          textAlign: 'center',
          opacity: reveal,
          transform: `translate3d(0, ${((1 - reveal) * 18).toFixed(1)}px, 0)`,
        }}
      >
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: 21,
            fontWeight: 700,
            letterSpacing: 5,
            color: PALETTE.copperLight,
            marginBottom: 14,
          }}
        >
          01 · FETCH
        </div>
        <div
          style={{
            fontFamily: THAI_FONT_FAMILY,
            fontWeight: 700,
            fontSize: 50,
            lineHeight: 1.44,
            color: PALETTE.creamWhite,
            paddingTop: 8,
            paddingBottom: 8,
            textShadow: '0 6px 26px rgba(5, 8, 22, 0.65)',
          }}
        >
          <span style={{ color: PALETTE.goldGlow }}>ดึงคำสั่ง</span> จากหน่วยความจำ
        </div>
      </div>

      {/* Fine-Line RAM -> Bus -> Register Schematic */}
      <div
        style={{
          position: 'absolute',
          top: 470,
          left: 90,
          width: 900,
          height: 880,
          opacity: reveal,
        }}
      >
        <svg width={900} height={880} viewBox="0 0 900 880">
          <defs>
            <linearGradient id={`s2-cone-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={PALETTE.goldGlow} stopOpacity="0.16" />
              <stop offset="100%" stopColor={PALETTE.goldGlow} stopOpacity="0" />
            </linearGradient>
            <radialGradient id={`s2-orb-${uid}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
              <stop offset="40%" stopColor={PALETTE.goldGlow} stopOpacity="0.88" />
              <stop offset="100%" stopColor={PALETTE.goldGlow} stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Subtle Volumetric Spotlight Cone */}
          <polygon points="330,255 570,255 680,690 220,690" fill={`url(#s2-cone-${uid})`} />

          {/* Upper RAM Grid Label */}
          <text
            x={450}
            y={82}
            textAnchor="middle"
            fill={PALETTE.creamMuted}
            fontFamily="monospace"
            fontSize={18}
            letterSpacing={3}
          >
            RAM · MEMORY CELLS
          </text>

          {/* Minimalist 4x2 Hairline RAM Cells */}
          {Array.from({ length: 8 }, (_, idx) => {
            const col = idx % 4;
            const row = Math.floor(idx / 4);
            const cellW = 110;
            const cellH = 60;
            const gap = 16;
            const totalW = 4 * cellW + 3 * gap;
            const x = 450 - totalW / 2 + col * (cellW + gap);
            const y = 110 + row * (cellH + gap);
            const isTarget = idx === 5; // cell (1,1) directly above bus origin

            return (
              <g key={idx}>
                <rect
                  x={x}
                  y={y}
                  width={cellW}
                  height={cellH}
                  rx={12}
                  fill={isTarget ? 'rgba(255, 209, 102, 0.14)' : 'rgba(255, 255, 255, 0.02)'}
                  stroke={isTarget ? PALETTE.goldGlow : 'rgba(250, 246, 238, 0.25)'}
                  strokeWidth={isTarget ? 2.4 : 1.4}
                />
                <text
                  x={x + cellW / 2}
                  y={y + cellH / 2 + 6}
                  textAnchor="middle"
                  fill={isTarget ? PALETTE.goldGlow : 'rgba(250, 246, 238, 0.45)'}
                  fontFamily="monospace"
                  fontSize={isTarget ? 19 : 15}
                  fontWeight={isTarget ? 700 : 400}
                >
                  {isTarget ? '0x04' : `0x0${idx}`}
                </text>
              </g>
            );
          })}

          {/* Curved Hairline Data Bus Traces */}
          {[-1, 0, 1].map((lane) => (
            <path
              key={lane}
              d={`M ${450 + lane * 14} 252 Q ${450 + lane * 62} 430 ${450 + lane * 22} 595`}
              fill="none"
              stroke={lane === 0 ? PALETTE.goldGlow : 'rgba(250, 246, 238, 0.28)'}
              strokeWidth={lane === 0 ? 2.4 : 1.4}
              strokeDasharray={lane === 0 ? undefined : '6 8'}
              opacity={lane === 0 ? 0.72 : 0.55}
            />
          ))}

          {/* Moving Luminous Packets */}
          {packets.map(
            (pkt, i) =>
              pkt.visible && (
                <g key={i} opacity={pkt.alpha}>
                  <circle cx={pkt.x} cy={pkt.y} r={24} fill={`url(#s2-orb-${uid})`} />
                  <circle cx={pkt.x} cy={pkt.y} r={5.5} fill="#FFFFFF" />
                </g>
              ),
          )}

          {/* Lower CPU Instruction Register Slot */}
          <rect
            x={230}
            y={596}
            width={440}
            height={92}
            rx={20}
            fill="rgba(255, 209, 102, 0.08)"
            stroke={PALETTE.goldGlow}
            strokeWidth={2.2}
            opacity={0.45 + irGlow * 0.55}
          />
          <text
            x={450}
            y={633}
            textAnchor="middle"
            fill={PALETTE.creamMuted}
            fontFamily="monospace"
            fontSize={16}
            letterSpacing={2.5}
          >
            INSTRUCTION REGISTER
          </text>
          <text
            x={450}
            y={668}
            textAnchor="middle"
            fill={PALETTE.goldGlow}
            fontFamily="monospace"
            fontSize={28}
            fontWeight={700}
            letterSpacing={4}
            opacity={irGlow}
          >
            1011 · 0100
          </text>
        </svg>
      </div>
    </AbsoluteFill>
  );
};

// ============================================================================
// SCENE 3: DECODE — BINARY PRISM & CLEAN SPLIT PATHWAYS
// ============================================================================

const Scene3Decode: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  const reveal = interpolate(frame, [6, 22], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const row1Spring = spring({
    frame: Math.max(0, frame - 22),
    fps,
    config: { damping: 16, stiffness: 170, mass: 0.75 },
  });
  const row2Spring = spring({
    frame: Math.max(0, frame - 42),
    fps,
    config: { damping: 16, stiffness: 170, mass: 0.75 },
  });

  const diamondPulse = 0.8 + 0.2 * Math.sin((frame / fps) * Math.PI * 2);

  return (
    <AbsoluteFill>
      {/* Whisper-quiet Editorial Header */}
      <div
        style={{
          position: 'absolute',
          top: 280,
          left: 84,
          right: 84,
          textAlign: 'center',
          opacity: reveal,
          transform: `translate3d(0, ${((1 - reveal) * 18).toFixed(1)}px, 0)`,
        }}
      >
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: 21,
            fontWeight: 700,
            letterSpacing: 5,
            color: PALETTE.copperLight,
            marginBottom: 14,
          }}
        >
          02 · DECODE
        </div>
        <div
          style={{
            fontFamily: THAI_FONT_FAMILY,
            fontWeight: 700,
            fontSize: 50,
            lineHeight: 1.44,
            color: PALETTE.creamWhite,
            paddingTop: 8,
            paddingBottom: 8,
            textShadow: '0 6px 26px rgba(5, 8, 22, 0.65)',
          }}
        >
          แปลรหัส <span style={{ color: PALETTE.goldGlow }}>0 กับ 1</span> ให้เป็นคำสั่ง
        </div>
      </div>

      {/* Minimalist Control Unit Prism & Split Pills */}
      <div
        style={{
          position: 'absolute',
          top: 470,
          left: 90,
          width: 900,
          height: 880,
          opacity: reveal,
        }}
      >
        <svg width={900} height={880} viewBox="0 0 900 880">
          <defs>
            <radialGradient id={`s3-prism-${uid}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={PALETTE.goldGlow} stopOpacity="0.48" />
              <stop offset="52%" stopColor={PALETTE.copperLight} stopOpacity="0.16" />
              <stop offset="100%" stopColor={PALETTE.copperLight} stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Falling Binary Stream Entering Prism */}
          {['1', '0', '1', '1', '0', '1'].map((bit, i) => {
            const cycle = ((frame * 0.032 + i * 0.16) % 1);
            const y = 55 + cycle * 145;
            const alpha = Math.sin(cycle * Math.PI) * 0.88;
            const x = 450 + (i % 2 === 0 ? -18 : 18);
            return (
              <text
                key={i}
                x={x}
                y={y}
                textAnchor="middle"
                fill={bit === '1' ? PALETTE.goldGlow : PALETTE.logicCyan}
                fontFamily="monospace"
                fontSize={26}
                fontWeight={700}
                opacity={alpha}
              >
                {bit}
              </text>
            );
          })}

          {/* Prism Radial Aura */}
          <circle cx={450} cy={300} r={175 * diamondPulse} fill={`url(#s3-prism-${uid})`} />

          {/* Geometric Control Unit Prism (Diamond) */}
          <g transform="translate(450, 300)">
            <polygon
              points="0,-102 102,0 0,102 -102,0"
              fill="rgba(20, 26, 46, 0.55)"
              stroke={PALETTE.goldGlow}
              strokeWidth={2.4}
            />
            <polygon
              points="0,-68 68,0 0,68 -68,0"
              fill="none"
              stroke="rgba(255, 209, 102, 0.45)"
              strokeWidth={1.3}
            />
            <text
              x={0}
              y={-6}
              textAnchor="middle"
              fill={PALETTE.creamWhite}
              fontFamily="monospace"
              fontSize={16}
              letterSpacing={2}
            >
              CONTROL
            </text>
            <text
              x={0}
              y={18}
              textAnchor="middle"
              fill={PALETTE.goldGlow}
              fontFamily="monospace"
              fontSize={16}
              fontWeight={700}
              letterSpacing={2}
            >
              UNIT
            </text>
          </g>

          {/* Clean Hairline Split Connectors */}
          <path
            d="M 450 402 L 450 460 L 260 512"
            fill="none"
            stroke={PALETTE.goldGlow}
            strokeWidth={2}
            opacity={row1Spring * 0.78}
          />
          <path
            d="M 450 402 L 450 460 L 640 622"
            fill="none"
            stroke={PALETTE.logicCyan}
            strokeWidth={2}
            opacity={row2Spring * 0.72}
          />

          {/* Row 1: OPCODE -> บวกเลข (Minimalist Hairline Pill) */}
          <g
            transform={`translate(0, ${((1 - row1Spring) * 20).toFixed(1)})`}
            opacity={row1Spring}
          >
            <rect
              x={130}
              y={512}
              width={640}
              height={84}
              rx={42}
              fill="rgba(255, 209, 102, 0.08)"
              stroke={PALETTE.goldGlow}
              strokeWidth={1.8}
            />
            <text
              x={186}
              y={562}
              fill={PALETTE.goldGlow}
              fontFamily="monospace"
              fontSize={24}
              fontWeight={700}
              letterSpacing={2}
            >
              1011
            </text>
            <line
              x1={296}
              y1={536}
              x2={296}
              y2={572}
              stroke="rgba(255, 209, 102, 0.35)"
              strokeWidth={1.5}
            />
            <text
              x={330}
              y={564}
              fill={PALETTE.creamWhite}
              fontFamily={THAI_FONT_FAMILY}
              fontWeight={700}
              fontSize={31}
            >
              คำสั่ง · บวกเลข (ADD)
            </text>
          </g>

          {/* Row 2: OPERAND -> ย้ายข้อมูล (Minimalist Hairline Pill) */}
          <g
            transform={`translate(0, ${((1 - row2Spring) * 20).toFixed(1)})`}
            opacity={row2Spring}
          >
            <rect
              x={130}
              y={624}
              width={640}
              height={84}
              rx={42}
              fill="rgba(125, 226, 209, 0.07)"
              stroke={PALETTE.logicCyan}
              strokeWidth={1.8}
            />
            <text
              x={186}
              y={674}
              fill={PALETTE.logicCyan}
              fontFamily="monospace"
              fontSize={24}
              fontWeight={700}
              letterSpacing={2}
            >
              0100
            </text>
            <line
              x1={296}
              y1={648}
              x2={296}
              y2={684}
              stroke="rgba(125, 226, 209, 0.35)"
              strokeWidth={1.5}
            />
            <text
              x={330}
              y={676}
              fill={PALETTE.creamWhite}
              fontFamily={THAI_FONT_FAMILY}
              fontWeight={700}
              fontSize={31}
            >
              ข้อมูล · ย้ายค่าจากหน่วยความจำ
            </text>
          </g>
        </svg>
      </div>
    </AbsoluteFill>
  );
};

// ============================================================================
// SCENE 4: EXECUTE + CLOCK WAVEFORM + PURE EDITORIAL CLOSER
// ============================================================================

const Scene4ExecuteClock: React.FC<{ renderDuration: number }> = ({
  renderDuration,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  // Transition smoothly from Execute/Waveform (Act A) to Editorial Closer (Act B)
  // Synced to the final phrase ("วนซ้ำ 3 ขั้นตอนนี้...") around local frame 104
  const actSwitchFrame = Math.min(110, Math.max(82, Math.round(renderDuration * 0.41)));

  const actAIn = interpolate(frame, [6, 20], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const actAOut = interpolate(frame, [actSwitchFrame - 12, actSwitchFrame + 6], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const actAOpacity = actAIn * actAOut;

  const actBIn = interpolate(frame, [actSwitchFrame, actSwitchFrame + 20], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const actBRise = interpolate(frame, [actSwitchFrame, actSwitchFrame + 22], [22, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  // Build oscillating clock pulse waveform path (inspired by editorial waveform line)
  const wavePoints: string[] = [];
  const waveStart = 70;
  const waveEnd = 830;
  const baseWaveY = 470;
  const samples = 96;
  const phase = (frame / fps) * 7.5;

  let headX = waveEnd;
  let headY = baseWaveY;

  for (let i = 0; i <= samples; i += 1) {
    const u = i / samples;
    const x = waveStart + u * (waveEnd - waveStart);
    const envelope = Math.sin(u * Math.PI);
    const carrier = Math.sin(u * Math.PI * 10 - phase);
    const harmonic = 0.28 * Math.sin(u * Math.PI * 20 - phase * 1.5);
    const y = baseWaveY - (carrier + harmonic) * 44 * envelope;
    wavePoints.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    if (i === Math.round(samples * 0.68)) {
      headX = x;
      headY = y;
    }
  }
  const wavePath = wavePoints.join(' ');

  const starRot = (frame / fps) * 14;

  return (
    <AbsoluteFill>
      {/* ACT A: Header + ALU Core + Clock Waveform */}
      <div style={{ opacity: actAOpacity }}>
        <div
          style={{
            position: 'absolute',
            top: 280,
            left: 84,
            right: 84,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: 21,
              fontWeight: 700,
              letterSpacing: 5,
              color: PALETTE.copperLight,
              marginBottom: 14,
            }}
          >
            03 · EXECUTE
          </div>
          <div
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontWeight: 700,
              fontSize: 50,
              lineHeight: 1.44,
              color: PALETTE.creamWhite,
              paddingTop: 8,
              paddingBottom: 8,
              textShadow: '0 6px 26px rgba(5, 8, 22, 0.65)',
            }}
          >
            คำนวณตาม <span style={{ color: PALETTE.goldGlow }}>จังหวะนาฬิกา</span>
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            top: 470,
            left: 90,
            width: 900,
            height: 820,
          }}
        >
          <svg width={900} height={820} viewBox="0 0 900 820">
            <defs>
              <radialGradient id={`s4-alu-${uid}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={PALETTE.goldGlow} stopOpacity="0.44" />
                <stop offset="55%" stopColor={PALETTE.copperLight} stopOpacity="0.14" />
                <stop offset="100%" stopColor={PALETTE.copperLight} stopOpacity="0" />
              </radialGradient>
              <radialGradient id={`s4-dot-${uid}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
                <stop offset="45%" stopColor={PALETTE.goldGlow} stopOpacity="0.9" />
                <stop offset="100%" stopColor={PALETTE.goldGlow} stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* ALU Inputs & Core */}
            <g opacity={0.72}>
              <line
                x1={362}
                y1={56}
                x2={362}
                y2={115}
                stroke={PALETTE.goldGlow}
                strokeWidth={2}
              />
              <line
                x1={538}
                y1={56}
                x2={538}
                y2={115}
                stroke={PALETTE.logicCyan}
                strokeWidth={2}
              />
              <text
                x={362}
                y={40}
                textAnchor="middle"
                fill={PALETTE.goldGlow}
                fontFamily="monospace"
                fontSize={19}
                fontWeight={700}
              >
                A
              </text>
              <text
                x={538}
                y={40}
                textAnchor="middle"
                fill={PALETTE.logicCyan}
                fontFamily="monospace"
                fontSize={19}
                fontWeight={700}
              >
                B
              </text>
              <line
                x1={450}
                y1={275}
                x2={450}
                y2={355}
                stroke={PALETTE.goldGlow}
                strokeWidth={2}
                strokeDasharray="5 7"
                opacity={0.65}
              />
            </g>
            <circle cx={450} cy={195} r={160} fill={`url(#s4-alu-${uid})`} />
            <polygon
              points="310,115 415,115 450,165 485,115 590,115 530,275 370,275"
              fill="rgba(20, 26, 46, 0.56)"
              stroke={PALETTE.goldGlow}
              strokeWidth={2.4}
              strokeLinejoin="round"
            />
            <text
              x={450}
              y={235}
              textAnchor="middle"
              fill={PALETTE.goldGlow}
              fontFamily="monospace"
              fontSize={30}
              fontWeight={700}
              letterSpacing={4}
            >
              ALU · A + B
            </text>

            {/* Soft Wave Glow Underlay + Crisp Clock Pulse Line */}
            <path
              d={wavePath}
              fill="none"
              stroke={PALETTE.goldGlow}
              strokeWidth={10}
              strokeLinecap="round"
              opacity={0.18}
            />
            <path
              d={wavePath}
              fill="none"
              stroke={PALETTE.goldGlow}
              strokeWidth={3.2}
              strokeLinecap="round"
            />
            <circle cx={headX} cy={headY} r={22} fill={`url(#s4-dot-${uid})`} />
            <circle cx={headX} cy={headY} r={5} fill="#FFFFFF" />
          </svg>

          {/* Clean Tabular CountUp Under Waveform */}
          <div
            style={{
              position: 'absolute',
              top: 560,
              left: 0,
              right: 0,
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontFamily: 'monospace',
                fontWeight: 700,
                fontSize: 60,
                color: PALETTE.goldGlow,
                textShadow: '0 0 26px rgba(255, 209, 102, 0.38)',
              }}
            >
              <CountUp
                from={0}
                to={5.0}
                decimals={1}
                suffix=" GHz"
                startFrame={6}
                durationFrames={50}
                popScale={1.1}
                popGlowColor="rgba(255, 209, 102, 0.55)"
              />
            </div>
            <div
              style={{
                marginTop: 8,
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 26,
                color: PALETTE.creamMuted,
                letterSpacing: 0.6,
              }}
            >
              ~5,000,000,000 จังหวะต่อวินาที
            </div>
          </div>
        </div>
      </div>

      {/* ACT B: Pure Editorial Typographic Closer (Frame 18 inspiration) */}
      {actBIn > 0.01 && (
        <div
          style={{
            position: 'absolute',
            top: 560,
            left: 84,
            right: 84,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            opacity: actBIn,
            transform: `translate3d(0, ${actBRise.toFixed(1)}px, 0)`,
          }}
        >
          {/* Delicate Minimal Silicon Star Emblem */}
          <svg
            width={92}
            height={92}
            viewBox="-46 -46 92 92"
            style={{ marginBottom: 38 }}
          >
            <g transform={`rotate(${starRot.toFixed(2)})`}>
              <rect
                x={-22}
                y={-22}
                width={44}
                height={44}
                rx={6}
                fill="none"
                stroke={PALETTE.goldGlow}
                strokeWidth={1.8}
                opacity={0.78}
              />
              <rect
                x={-22}
                y={-22}
                width={44}
                height={44}
                rx={6}
                transform="rotate(45)"
                fill="none"
                stroke={PALETTE.copperLight}
                strokeWidth={1.5}
                opacity={0.62}
              />
              <circle cx={0} cy={0} r={5.5} fill={PALETTE.goldGlow} />
            </g>
          </svg>

          <div
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontWeight: 700,
              fontSize: 44,
              lineHeight: 1.5,
              color: PALETTE.creamWhite,
              paddingTop: 6,
              paddingBottom: 6,
              textShadow: '0 6px 24px rgba(5, 8, 22, 0.72)',
            }}
          >
            3 ขั้นตอนสั้นๆ ที่วนซ้ำ
          </div>
          <div
            style={{
              marginTop: 8,
              fontFamily: THAI_FONT_FAMILY,
              fontWeight: 700,
              fontSize: 52,
              lineHeight: 1.5,
              color: PALETTE.goldGlow,
              paddingTop: 8,
              paddingBottom: 8,
              textShadow:
                '0 0 26px rgba(255, 209, 102, 0.38), 0 6px 24px rgba(5, 8, 22, 0.72)',
            }}
          >
            หลายพันล้านครั้งใน 1 วินาที
          </div>
          <div
            style={{
              marginTop: 28,
              fontFamily: 'monospace',
              fontSize: 20,
              letterSpacing: 4,
              color: PALETTE.creamMuted,
              opacity: 0.78,
            }}
          >
            FETCH · DECODE · EXECUTE
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

// ============================================================================
// PER-SCENE WRAPPER WITH OVERLAPPING TRANSITIONS
// ============================================================================

const CpuSceneWrapper: React.FC<{
  scene: CpuTimelineScene;
  sceneIdx: number;
  renderDuration: number;
  isFirst: boolean;
  isLast: boolean;
}> = ({ scene, sceneIdx, renderDuration, isFirst, isLast }) => {
  const localFrame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const transitionKind = SCENE_TRANSITIONS[sceneIdx % SCENE_TRANSITIONS.length];
  const tStyle = transitionStyle(localFrame, renderDuration, transitionKind, fps, {
    inFrames: sceneIdx === 1 ? 10 : 14,
    outFrames: isFirst ? 10 : 14,
    skipIn: isFirst,
    skipOut: isLast,
  });

  const renderContent = () => {
    switch (scene.id) {
      case 's1_hook':
        return <Scene1Hook />;
      case 's2_fetch':
        return <Scene2Fetch />;
      case 's3_decode':
        return <Scene3Decode />;
      case 's4_execute_clock':
        return <Scene4ExecuteClock renderDuration={renderDuration} />;
      default:
        return <Scene1Hook />;
    }
  };

  return <AbsoluteFill style={{ ...tStyle }}>{renderContent()}</AbsoluteFill>;
};

// ============================================================================
// MAIN COMPOSITION
// ============================================================================

export const CpuHowItWorks: React.FC<CpuHowItWorksProps> = (props) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const scenes = props.scenes?.length ? props.scenes : DEFAULT_CPU_PROPS.scenes;
  const allCues = props.cues?.length ? props.cues : DEFAULT_CPU_PROPS.cues;
  const totalFrames = Math.max(90, props.totalFrames || durationInFrames);

  const horizonProgress = interpolate(
    frame,
    [scenes[1]?.startFrame ?? 120, totalFrames],
    [0, 1],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    },
  );

  const s1End = scenes[0]?.endFrame ?? 150;
  const isLightBackdrop = frame < s1End - 4;

  const cutFrames = scenes.slice(0, -1).map((s) => s.endFrame);

  return (
    <AbsoluteFill style={{ backgroundColor: PALETTE.midnightTop, overflow: 'hidden' }}>
      <ThaiFontLoader />

      {/* Layer 1: Continuous Living Atmospheric Backdrop inside subtle CameraRig */}
      <CameraRig zoomFrom={1.0} zoomTo={1.05} panY={[10, -14]} durationFrames={totalFrames}>
        <HorizonAtmosphere progress={horizonProgress} />
        <LightRays
          count={8}
          color="#FFD49E"
          intensity={0.18}
          originX={0.5}
          originY={0.18}
          rotationSpeed={1.6}
          seed="cpu-rays"
        />
        <ParticleField
          count={30}
          seed="cpu-motes"
          color="#FFE4B5"
          drift={20}
          size={2.6}
          opacity={0.36}
          bokehRatio={0.2}
        />
      </CameraRig>

      {/* Layer 2: Soft Readability Scrims (Zero Hard Edges) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'linear-gradient(180deg, rgba(8,11,22,0.34) 0%, rgba(8,11,22,0) 32%, rgba(8,11,22,0) 64%, rgba(8,11,22,0.42) 100%)',
        }}
      />

      {/* Layer 3: Overlapping Cross-Faded Scene Sequences */}
      {scenes.map((sc, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === scenes.length - 1;
        const renderStart = isFirst
          ? sc.startFrame
          : idx === 1
            ? Math.max(0, sc.startFrame - 2)
            : Math.max(0, sc.startFrame - OVERLAP_HALF);
        const renderEnd = isLast
          ? Math.max(totalFrames, sc.endFrame)
          : isFirst
            ? sc.endFrame
            : Math.min(totalFrames, sc.endFrame + OVERLAP_HALF);
        const renderDur = Math.max(24, renderEnd - renderStart);

        return (
          <Sequence key={sc.id} from={renderStart} durationInFrames={renderDur}>
            <CpuSceneWrapper
              scene={sc}
              sceneIdx={idx}
              renderDuration={renderDur}
              isFirst={isFirst}
              isLast={isLast}
            />
          </Sequence>
        );
      })}

      {/* Layer 4: Warm Copper-Gold Light Leak Bridging Scene Cuts */}
      <LightLeakFlash
        at={cutFrames}
        durationFrames={22}
        color="#FFD49E"
        secondaryColor="#D97A46"
        intensity={0.86}
      />

      {/* Layer 5: Borderless Floating Cinema Subtitles */}
      <CinemaSubtitle cues={allCues} isLightBackdrop={isLightBackdrop} />

      {/* Layer 6: Ultra-Subtle Cinema Film Grain & Soft Vignette */}
      <FilmGrainVignette
        grain={isLightBackdrop ? 0.022 : 0.032}
        vignette={isLightBackdrop ? 0.14 : 0.34}
        updateEveryFrames={2}
      />
    </AbsoluteFill>
  );
};
