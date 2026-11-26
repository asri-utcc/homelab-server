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
import { THAI_FONT_FAMILY, ThaiFontLoader } from '../../components/ThaiFontLoader';
import {
  CameraRig,
  CountUp,
  KaraokeSubtitle,
  KineticTitle,
  LightLeakFlash,
  transitionStyle,
} from '../../components/fx';
import type { SubtitleCue, TransitionKind, WordBoundary } from '../../components/fx';
import scriptData from './script.json';

// ============================================================================
// TYPES & TIMELINE DEFAULT PROPS
// ============================================================================

export type SignIconKind = 'throb' | 'temp' | 'bite' | 'gum' | 'pus' | 'dark';

export type SignChecklistItem = {
  icon: SignIconKind;
  label: string;
};

export type ProConItem = {
  type: 'pro' | 'con';
  text: string;
};

export type RootCanalTimelineScene = {
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
  wordBoundaries?: WordBoundary[];
};

export type RootCanalExplainerProps = {
  title: string;
  fps: number;
  width?: number;
  height?: number;
  totalSec?: number;
  totalFrames: number;
  scenes: RootCanalTimelineScene[];
  cues: SubtitleCue[];
};

// Extract static scene metadata & items from script.json (timeline.json does not carry items)
type RawScriptScene = (typeof scriptData.scenes)[number];

const SCRIPT_SCENE_BY_ID: Record<string, RawScriptScene> = {};
for (const raw of scriptData.scenes) {
  SCRIPT_SCENE_BY_ID[raw.id] = raw;
}

const DEFAULT_SIGN_ITEMS: SignChecklistItem[] = (() => {
  const s3 = SCRIPT_SCENE_BY_ID['s3_signs'];
  if (s3 && 'items' in s3 && Array.isArray(s3.items)) {
    return s3.items
      .filter((it): it is { icon: string; label: string } => 'icon' in it && 'label' in it)
      .map((it) => ({
        icon: it.icon as SignIconKind,
        label: it.label,
      }));
  }
  return [
    { icon: 'throb', label: 'ปวดฟันตุบๆ ตอนกลางคืน' },
    { icon: 'temp', label: 'เสียวร้อนเย็นค้างนาน' },
    { icon: 'bite', label: 'เจ็บเวลาเคี้ยวหรือกดฟัน' },
    { icon: 'gum', label: 'เหงือกบวมรอบซี่ฟัน' },
    { icon: 'pus', label: 'มีตุ่มหนองที่เหงือก' },
    { icon: 'dark', label: 'ฟันเปลี่ยนเป็นสีคล้ำ' },
  ];
})();

const DEFAULT_PROCON_ITEMS: { pros: string[]; cons: string[] } = (() => {
  const s7 = SCRIPT_SCENE_BY_ID['s7_proscons'];
  const pros: string[] = [];
  const cons: string[] = [];
  if (s7 && 'items' in s7 && Array.isArray(s7.items)) {
    for (const it of s7.items) {
      if ('type' in it && 'text' in it) {
        if (it.type === 'pro') pros.push(it.text);
        else if (it.type === 'con') cons.push(it.text);
      }
    }
  }
  return {
    pros: pros.length
      ? pros
      : [
          'เก็บฟันธรรมชาติไว้ได้',
          'หายปวด เคี้ยวได้ปกติ',
          'ไม่ต้องถอนใส่ฟันปลอม',
          'อัตราสำเร็จราว 9 ใน 10',
        ],
    cons: cons.length
      ? cons
      : [
          'ต้องมาทำหลายครั้ง',
          'อาจมีค่าใช้จ่ายทำครอบฟัน',
          'ฟันเปราะ อาจตึง 2–3 วัน',
          'มีโอกาสติดเชื้อซ้ำได้',
        ],
  };
})();

function buildDefaultProps(): RootCanalExplainerProps {
  const fps = scriptData.fps || 30;
  const leadInSec = scriptData.leadInSec ?? 0.35;
  const holdEndSec = scriptData.holdEndSec ?? 1.6;
  const scenes: RootCanalTimelineScene[] = [];
  const cues: SubtitleCue[] = [];
  let cursorSec = leadInSec;

  scriptData.scenes.forEach((sc, idx) => {
    const isLast = idx === scriptData.scenes.length - 1;
    const estSpeechDur = Math.max(5.5, sc.narration.length / 13.8);
    const padAfter = sc.padAfterSec ?? 0.35;
    const sceneStartSec = idx === 0 ? 0 : cursorSec;
    const speechStartSec = cursorSec;
    const sceneEndSec = cursorSec + estSpeechDur + padAfter + (isLast ? holdEndSec : 0);

    const startFrame = Math.round(sceneStartSec * fps);
    const endFrame = Math.round(sceneEndSec * fps);
    const durFrames = Math.max(90, endFrame - startFrame);

    const rawSubs = sc.subtitles || [];
    const speechStartFrame = Math.round(speechStartSec * fps);
    const speechFrames = Math.max(30, Math.round(estSpeechDur * fps));

    const weights = rawSubs.map((s) => Math.max(4, s.text.replace(/\s/g, '').length));
    const totalW = weights.reduce((a, b) => a + b, 0) || 1;

    let subCursor = speechStartFrame;
    const sceneCues: SubtitleCue[] = rawSubs.map((sub, sIdx) => {
      const span = Math.max(18, Math.round((weights[sIdx] / totalW) * speechFrames));
      const cf0 = subCursor;
      const cf1 =
        sIdx === rawSubs.length - 1
          ? Math.max(cf0 + 18, speechStartFrame + speechFrames)
          : cf0 + span;
      subCursor = cf1;
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
      startSec: sceneStartSec,
      speechStartSec,
      speechDurSec: estSpeechDur,
      endSec: sceneEndSec,
      startFrame,
      durationFrames: durFrames,
      endFrame,
      cues: sceneCues,
      wordBoundaries: [],
    });

    cursorSec = sceneEndSec;
  });

  // Contiguous frames with zero gaps
  for (let i = 0; i < scenes.length - 1; i += 1) {
    scenes[i].endFrame = scenes[i + 1].startFrame;
    scenes[i].durationFrames = Math.max(1, scenes[i].endFrame - scenes[i].startFrame);
  }

  const totalFrames = scenes.length ? scenes[scenes.length - 1].endFrame : 2700;

  return {
    title: scriptData.title,
    fps,
    width: scriptData.width || 1080,
    height: scriptData.height || 1920,
    totalSec: totalFrames / fps,
    totalFrames,
    scenes,
    cues,
  };
}

export const DEFAULT_ROOT_CANAL_PROPS: RootCanalExplainerProps = buildDefaultProps();

// ============================================================================
// CLINICAL FLAT CARTOON PALETTE (LOOK-2 + LOOK-29)
// ============================================================================

const PALETTE = {
  bgTop: '#E6F6F3',
  bgBottom: '#CDEDE7',
  bgShape: '#C1E6DF',
  bgFloor: '#B6E0D8',
  teal: '#1FA39A',
  tealDark: '#147D76',
  tealSoft: '#D4F2EC',
  navy: '#2B2452',
  navyMid: '#484074',
  tooth: '#FFFDF6',
  toothShadow: '#E9E1CF',
  dentin: '#F5E7C6',
  dentinShadow: '#E2CE9F',
  pulp: '#F28CA6',
  pulpDark: '#DA6987',
  vessel: '#E5484D',
  nerve: '#FFC845',
  germ: '#8BD346',
  germShadow: '#5FA12E',
  germLight: '#B4E878',
  pus: '#F3E3A0',
  pusShadow: '#DFC96E',
  gutta: '#F08A3C',
  guttaShadow: '#CE6D22',
  crown: '#DDE6EE',
  crownLight: '#F3F7FB',
  crownShadow: '#B8C8D7',
  alert: '#F0384F',
  alertDark: '#C62035',
  alertSoft: '#FDE4E8',
  gum: '#F499AF',
  gumDark: '#DC7590',
  bone: '#EFE2CC',
  boneDark: '#D8C5A6',
  skin: '#F7B797',
  skinShadow: '#E59676',
  hair: '#322664',
  white: '#FFFFFF',
  hardShadow: '#9FCFC7',
  hardShadowDark: '#1B1638',
} as const;

const DISCLAIMER_TEXT = 'ข้อมูลทั่วไป ไม่ใช่การวินิจฉัย ปรึกษาทันตแพทย์';
const OVERLAP_HALF = 6; // 12-frame total overlap between adjacent scenes

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

const blinkFactor = (frame: number, period = 90, offset = 0): number => {
  const m = (frame + offset) % period;
  if (m >= period - 5 && m <= period - 2) return 0.12;
  if (m === period - 6 || m === period - 1) return 0.55;
  return 1;
};

// ============================================================================
// BACKGROUND: FLAT CLINICAL CARTOON BACKDROP
// ============================================================================

const ClinicBackdrop: React.FC<{ frame: number }> = ({ frame }) => {
  const driftA = Math.sin(frame * 0.015) * 14;
  const driftB = Math.cos(frame * 0.012) * 12;

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${PALETTE.bgTop} 0%, ${PALETTE.bgBottom} 100%)`,
        overflow: 'hidden',
      }}
    >
      <svg
        width="1080"
        height="1920"
        viewBox="0 0 1080 1920"
        style={{ position: 'absolute', inset: 0 }}
      >
        {/* Subtle flat clinic geometric shapes (no blur, no gradients) */}
        <circle cx={140 + driftA} cy={310} r={160} fill={PALETTE.bgShape} opacity={0.45} />
        <circle cx={960 - driftB} cy={520} r={120} fill={PALETTE.bgShape} opacity={0.42} />
        <circle cx={110 - driftB * 0.6} cy={1280} r={140} fill={PALETTE.bgShape} opacity={0.42} />
        <circle cx={980 + driftA * 0.7} cy={1420} r={175} fill={PALETTE.bgShape} opacity={0.38} />

        {/* Subtle flat medical plus accents */}
        {[
          { x: 112, y: 690, s: 18, phase: 0.2 },
          { x: 966, y: 890, s: 22, phase: 1.4 },
          { x: 92, y: 1090, s: 15, phase: 2.8 },
          { x: 970, y: 260, s: 16, phase: 4.1 },
        ].map((p, i) => {
          const dy = Math.sin(frame * 0.05 + p.phase) * 7;
          return (
            <g key={i} transform={`translate(${p.x}, ${p.y + dy})`} opacity={0.5}>
              <rect x={-p.s} y={-p.s * 0.34} width={p.s * 2} height={p.s * 0.68} rx={4} fill={PALETTE.teal} />
              <rect x={-p.s * 0.34} y={-p.s} width={p.s * 0.68} height={p.s * 2} rx={4} fill={PALETTE.teal} />
            </g>
          );
        })}

        {/* Flat clinic floor strip in bottom safe area */}
        <rect x="0" y="1675" width="1080" height="245" fill={PALETTE.bgFloor} />
        <rect x="0" y="1675" width="1080" height="8" fill={PALETTE.hardShadow} />
      </svg>
    </AbsoluteFill>
  );
};

// ============================================================================
// SVG CHARACTER 1: TOOTH BUDDY (น้องฟัน)
// ============================================================================

type ToothBuddyMood = 'pain' | 'sad' | 'ok' | 'happy';

interface ToothBuddyProps {
  mood: ToothBuddyMood;
  crowned?: boolean;
  frame: number;
  scale?: number;
  thumbsUp?: boolean;
  x?: number;
  y?: number;
}

const ToothBuddy: React.FC<ToothBuddyProps> = ({
  mood,
  crowned = false,
  frame,
  scale = 1,
  thumbsUp = false,
}) => {
  const bobY =
    mood === 'pain'
      ? Math.sin(frame * 0.35) * 5
      : mood === 'happy'
        ? -Math.abs(Math.sin(frame * 0.14)) * 12
        : Math.sin(frame * 0.1) * 6;
  const shakeX = mood === 'pain' ? Math.sin(frame * 0.95) * 4.5 : 0;
  const eyeScaleY = blinkFactor(frame, 90, 12);
  const shadowScale = interpolate(bobY, [-12, 6], [0.88, 1.04], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const bodyPath =
    'M 86 58 C 118 42, 148 56, 160 66 C 172 56, 202 42, 234 58 C 276 78, 286 134, 266 196 C 254 234, 244 276, 224 282 C 204 288, 192 252, 178 234 C 170 224, 150 224, 142 234 C 128 252, 116 288, 96 282 C 76 276, 66 234, 54 196 C 34 134, 44 78, 86 58 Z';

  return (
    <svg
      width={320 * scale}
      height={340 * scale}
      viewBox="0 0 320 340"
      style={{ overflow: 'visible' }}
    >
      {/* Hard flat oval floor shadow */}
      <ellipse
        cx="160"
        cy="318"
        rx={94 * shadowScale}
        ry={16 * shadowScale}
        fill={PALETTE.hardShadow}
      />

      <g transform={`translate(${shakeX.toFixed(2)}, ${bobY.toFixed(2)})`}>
        {/* Cute stubby legs */}
        <path
          d="M 114 274 L 110 306 M 98 306 L 122 306"
          stroke={PALETTE.navy}
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d="M 206 274 L 210 306 M 198 306 L 222 306"
          stroke={PALETTE.navy}
          strokeWidth="10"
          strokeLinecap="round"
        />

        {/* Arms according to mood */}
        {mood === 'pain' && (
          <>
            {/* Both arms clutching sore cheeks */}
            <path
              d="M 58 178 Q 18 164 46 134"
              fill="none"
              stroke={PALETTE.navy}
              strokeWidth="10"
              strokeLinecap="round"
            />
            <circle cx="48" cy="132" r="10" fill={PALETTE.tooth} stroke={PALETTE.navy} strokeWidth="4" />
            <path
              d="M 262 178 Q 302 164 274 134"
              fill="none"
              stroke={PALETTE.navy}
              strokeWidth="10"
              strokeLinecap="round"
            />
            <circle cx="272" cy="132" r="10" fill={PALETTE.tooth} stroke={PALETTE.navy} strokeWidth="4" />
          </>
        )}

        {mood === 'sad' && (
          <>
            <path
              d="M 56 176 Q 34 210 46 232"
              fill="none"
              stroke={PALETTE.navy}
              strokeWidth="10"
              strokeLinecap="round"
            />
            <path
              d="M 264 176 Q 286 210 274 232"
              fill="none"
              stroke={PALETTE.navy}
              strokeWidth="10"
              strokeLinecap="round"
            />
          </>
        )}

        {mood === 'ok' && (
          <>
            <path
              d="M 56 172 Q 26 190 36 214"
              fill="none"
              stroke={PALETTE.navy}
              strokeWidth="10"
              strokeLinecap="round"
            />
            <path
              d="M 264 172 Q 294 190 284 214"
              fill="none"
              stroke={PALETTE.navy}
              strokeWidth="10"
              strokeLinecap="round"
            />
          </>
        )}

        {mood === 'happy' && (
          <>
            {/* Left cheerful arm raised */}
            <path
              d="M 56 170 Q 16 140 28 102"
              fill="none"
              stroke={PALETTE.navy}
              strokeWidth="10"
              strokeLinecap="round"
            />
            <circle cx="28" cy="98" r="11" fill={PALETTE.tooth} stroke={PALETTE.navy} strokeWidth="4" />
            {/* Right arm waving or thumbs-up */}
            <path
              d={thumbsUp ? 'M 264 170 Q 304 148 298 108' : 'M 264 170 Q 304 140 292 102'}
              fill="none"
              stroke={PALETTE.navy}
              strokeWidth="10"
              strokeLinecap="round"
            />
            {thumbsUp ? (
              <g transform="translate(298, 102) rotate(12)">
                {/* Clean cheerful cartoon thumbs-up silhouette */}
                <rect x="-15" y="-6" width="28" height="24" rx="9" fill={PALETTE.tooth} stroke={PALETTE.navy} strokeWidth="4" />
                <path
                  d="M -4 -6 C -6 -24, 6 -28, 10 -14 L 10 -6"
                  fill={PALETTE.tooth}
                  stroke={PALETTE.navy}
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <line x1="2" y1="2" x2="11" y2="2" stroke={PALETTE.navy} strokeWidth="2.5" strokeLinecap="round" />
                <line x1="2" y1="10" x2="11" y2="10" stroke={PALETTE.navy} strokeWidth="2.5" strokeLinecap="round" />
              </g>
            ) : (
              <circle cx="292" cy="98" r="11" fill={PALETTE.tooth} stroke={PALETTE.navy} strokeWidth="4" />
            )}
          </>
        )}

        {/* Tooth body hard offset silhouette */}
        <path d={bodyPath} fill={PALETTE.hardShadow} transform="translate(8, 8)" />

        {/* Tooth body main ivory shape */}
        <path d={bodyPath} fill={PALETTE.tooth} />

        {/* Flat right-side shading inside molar */}
        <path
          d="M 216 54 C 223 55, 229 56, 234 58 C 276 78, 286 134, 266 196 C 254 234, 244 276, 224 282 C 215 285, 207 278, 200 267 C 218 250, 234 216, 242 180 C 254 128, 244 82, 216 54 Z"
          fill={PALETTE.toothShadow}
        />

        {/* Subtle flat top shine pill */}
        <ellipse cx="108" cy="86" rx="22" ry="9" transform="rotate(-18 108 86)" fill={PALETTE.white} />

        {/* Crown cap when crowned */}
        {crowned && (
          <g>
            <path
              d="M 60 116 C 58 84, 72 60, 96 52 C 122 44, 146 54, 160 64 C 174 54, 198 44, 224 52 C 248 60, 262 84, 260 116 Q 210 128, 160 122 Q 110 128, 60 116 Z"
              fill={PALETTE.crown}
            />
            {/* Flat highlight band on left side of crown */}
            <path
              d="M 76 106 C 76 84, 88 68, 108 62 C 122 58, 134 62, 142 66 L 126 112 Q 98 112, 76 106 Z"
              fill={PALETTE.crownLight}
            />
            {/* Flat shaded side on right of crown */}
            <path
              d="M 224 52 C 248 60, 262 84, 260 116 Q 238 122, 216 123 C 228 96, 228 72, 214 52 Z"
              fill={PALETTE.crownShadow}
            />
            {/* Thin crisp seam line */}
            <path
              d="M 60 116 Q 110 128, 160 122 Q 210 128, 260 116"
              fill="none"
              stroke={PALETTE.navy}
              strokeWidth="3"
              strokeLinecap="round"
            />
            {/* Twinkling flat 4-point sparkles */}
            {[
              { cx: 74, cy: 42, phase: 0 },
              { cx: 248, cy: 48, phase: 2.1 },
              { cx: 162, cy: 26, phase: 4.0 },
            ].map((sp, i) => {
              const s = 0.65 + 0.35 * Math.sin(frame * 0.22 + sp.phase);
              return (
                <path
                  key={i}
                  d="M 0 -14 L 4 -4 L 14 0 L 4 4 L 0 14 L -4 4 L -14 0 L -4 -4 Z"
                  fill={i === 1 ? PALETTE.nerve : PALETTE.white}
                  stroke={PALETTE.navy}
                  strokeWidth="1.5"
                  transform={`translate(${sp.cx}, ${sp.cy}) scale(${s.toFixed(3)})`}
                />
              );
            })}
          </g>
        )}

        {/* Thin outer detail stroke */}
        <path
          d={bodyPath}
          fill="none"
          stroke={PALETTE.navy}
          strokeWidth="3.5"
          strokeLinejoin="round"
        />

        {/* FACIAL EXPRESSIONS */}
        {mood === 'pain' && (
          <g>
            {/* Swollen red cheek throb */}
            <circle
              cx="236"
              cy="176"
              r={20 + Math.sin(frame * 0.4) * 3.5}
              fill={PALETTE.alert}
              opacity={0.35}
            />
            <circle cx="94" cy="176" r="14" fill={PALETTE.pulp} opacity={0.6} />
            {/* Squeezed >< eyes */}
            <path
              d="M 102 142 L 128 154 L 102 164"
              fill="none"
              stroke={PALETTE.navy}
              strokeWidth="6.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M 218 142 L 192 154 L 218 164"
              fill="none"
              stroke={PALETTE.navy}
              strokeWidth="6.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Worried brows */}
            <path
              d="M 98 128 L 130 136"
              stroke={PALETTE.navy}
              strokeWidth="5"
              strokeLinecap="round"
            />
            <path
              d="M 222 128 L 190 136"
              stroke={PALETTE.navy}
              strokeWidth="5"
              strokeLinecap="round"
            />
            {/* Wavy aching mouth */}
            <path
              d="M 134 196 Q 146 184 160 192 Q 174 200 186 190"
              fill="none"
              stroke={PALETTE.navy}
              strokeWidth="6"
              strokeLinecap="round"
            />
            {/* Sweating teardrop */}
            <path
              d="M 76 112 Q 66 130 76 136 Q 86 130 76 112 Z"
              fill={PALETTE.teal}
              transform={`translate(0, ${(frame % 24) * 0.5})`}
            />
          </g>
        )}

        {mood === 'sad' && (
          <g>
            {/* Rosy cheeks */}
            <ellipse cx="96" cy="174" rx="14" ry="9" fill={PALETTE.pulp} opacity={0.55} />
            <ellipse cx="224" cy="174" rx="14" ry="9" fill={PALETTE.pulp} opacity={0.55} />
            {/* Dark oval blinking eyes */}
            <ellipse
              cx="118"
              cy="152"
              rx="10"
              ry={Math.max(2, 13 * eyeScaleY)}
              fill={PALETTE.navy}
            />
            <ellipse
              cx="202"
              cy="152"
              rx="10"
              ry={Math.max(2, 13 * eyeScaleY)}
              fill={PALETTE.navy}
            />
            {eyeScaleY > 0.5 && (
              <>
                <circle cx="114" cy="147" r="3.5" fill={PALETTE.white} />
                <circle cx="198" cy="147" r="3.5" fill={PALETTE.white} />
              </>
            )}
            {/* Sad brows */}
            <path d="M 100 132 L 128 124" stroke={PALETTE.navy} strokeWidth="4.5" strokeLinecap="round" />
            <path d="M 220 132 L 192 124" stroke={PALETTE.navy} strokeWidth="4.5" strokeLinecap="round" />
            {/* Teardrop */}
            <path
              d="M 216 168 Q 208 184 216 190 Q 224 184 216 168 Z"
              fill={PALETTE.teal}
              transform={`translate(0, ${Math.sin(frame * 0.16) * 4})`}
            />
            {/* Frown */}
            <path
              d="M 138 196 Q 160 180 182 196"
              fill="none"
              stroke={PALETTE.navy}
              strokeWidth="5.5"
              strokeLinecap="round"
            />
          </g>
        )}

        {mood === 'ok' && (
          <g>
            <ellipse cx="96" cy="174" rx="14" ry="9" fill={PALETTE.pulp} opacity={0.65} />
            <ellipse cx="224" cy="174" rx="14" ry="9" fill={PALETTE.pulp} opacity={0.65} />
            <ellipse
              cx="118"
              cy="150"
              rx="10"
              ry={Math.max(2, 13 * eyeScaleY)}
              fill={PALETTE.navy}
            />
            <ellipse
              cx="202"
              cy="150"
              rx="10"
              ry={Math.max(2, 13 * eyeScaleY)}
              fill={PALETTE.navy}
            />
            {eyeScaleY > 0.5 && (
              <>
                <circle cx="114" cy="145" r="3.5" fill={PALETTE.white} />
                <circle cx="198" cy="145" r="3.5" fill={PALETTE.white} />
              </>
            )}
            <path
              d="M 140 184 Q 160 200 180 184"
              fill="none"
              stroke={PALETTE.navy}
              strokeWidth="5.5"
              strokeLinecap="round"
            />
          </g>
        )}

        {mood === 'happy' && (
          <g>
            <ellipse cx="94" cy="174" rx="16" ry="10" fill={PALETTE.pulp} opacity={0.78} />
            <ellipse cx="226" cy="174" rx="16" ry="10" fill={PALETTE.pulp} opacity={0.78} />
            <ellipse
              cx="118"
              cy="152"
              rx="10.5"
              ry={Math.max(2, 13.5 * eyeScaleY)}
              fill={PALETTE.navy}
            />
            <ellipse
              cx="202"
              cy="152"
              rx="10.5"
              ry={Math.max(2, 13.5 * eyeScaleY)}
              fill={PALETTE.navy}
            />
            {eyeScaleY > 0.5 && (
              <>
                <circle cx="114" cy="147" r="4" fill={PALETTE.white} />
                <circle cx="198" cy="147" r="4" fill={PALETTE.white} />
              </>
            )}
            {/* Big joyful open smile */}
            <path
              d="M 130 176 Q 160 218 190 176 Z"
              fill={PALETTE.navy}
            />
            <path
              d="M 145 194 Q 160 206 175 194 Q 160 188 145 194 Z"
              fill={PALETTE.pulp}
            />
          </g>
        )}
      </g>
    </svg>
  );
};

// ============================================================================
// SVG CHARACTER 2: DENTIST CARTOON (คุณหมอฟัน - Look-2 Big Head Flat Style)
// ============================================================================

interface DentistCartoonProps {
  frame: number;
  pose?: 'point' | 'holdXray' | 'wave';
  scale?: number;
}

const DentistCartoon: React.FC<DentistCartoonProps> = ({
  frame,
  pose = 'point',
  scale = 1,
}) => {
  const breathe = Math.sin(frame * 0.1) * 3;
  const eyeScaleY = blinkFactor(frame, 96, 44);
  const waveAngle = pose === 'wave' ? 6 + Math.sin(frame * 0.24) * 14 : 0;
  const pointBob = pose === 'point' ? Math.sin(frame * 0.16) * 6 : 0;

  return (
    <svg
      width={280 * scale}
      height={390 * scale}
      viewBox="0 0 280 390"
      style={{ overflow: 'visible' }}
    >
      {/* Flat floor shadow */}
      <ellipse cx="140" cy="374" rx="82" ry="14" fill={PALETTE.hardShadow} />

      {/* Legs & Shoes */}
      <rect x="104" y="294" width="28" height="72" rx="12" fill={PALETTE.tealDark} />
      <rect x="148" y="294" width="28" height="72" rx="12" fill={PALETTE.teal} />
      <rect x="92" y="354" width="46" height="20" rx="10" fill={PALETTE.navy} />
      <rect x="144" y="354" width="46" height="20" rx="10" fill={PALETTE.navy} />

      <g transform={`translate(0, ${breathe.toFixed(2)})`}>
        {/* Left arm (resting / holding dental mirror) */}
        <path
          d="M 88 214 Q 54 246 66 286"
          fill="none"
          stroke={PALETTE.tealDark}
          strokeWidth="26"
          strokeLinecap="round"
        />
        {/* Left mitten hand */}
        <circle cx="68" cy="292" r="14" fill={PALETTE.skin} />

        {/* Scrubs Torso (flat with one shaded side — Look-2) */}
        <rect x="78" y="196" width="124" height="114" rx="30" fill={PALETTE.teal} />
        {/* Flat shaded left half of scrubs */}
        <path
          d="M 108 196 L 130 196 L 130 310 L 108 310 C 91 310 78 297 78 280 L 78 226 C 78 209 91 196 108 196 Z"
          fill={PALETTE.tealDark}
        />
        {/* V-neck collar */}
        <polygon points="116,196 164,196 140,232" fill={PALETTE.white} />
        <path
          d="M 116 196 L 140 232 L 164 196"
          fill="none"
          stroke={PALETTE.navy}
          strokeWidth="3"
          strokeLinejoin="round"
        />
        {/* Pocket + tiny mirror clip */}
        <rect x="150" y="248" width="32" height="30" rx="6" fill={PALETTE.tealDark} />
        <rect x="158" y="236" width="6" height="18" rx="3" fill={PALETTE.crown} />
        <circle cx="161" cy="232" r="7" fill={PALETTE.crownLight} stroke={PALETTE.navy} strokeWidth="2" />

        {/* Right arm (animated by pose) */}
        {pose === 'wave' && (
          <g transform={`translate(194, 214) rotate(${waveAngle.toFixed(1)})`}>
            <path
              d="M 0 0 Q 44 -14 62 -56"
              fill="none"
              stroke={PALETTE.teal}
              strokeWidth="25"
              strokeLinecap="round"
            />
            {/* Flat mitten hand waving cleanly outside the head */}
            <circle cx="65" cy="-64" r="15" fill={PALETTE.skin} />
            <circle cx="52" cy="-70" r="6" fill={PALETTE.skin} />
          </g>
        )}

        {pose === 'point' && (
          <g transform={`translate(0, ${pointBob.toFixed(2)})`}>
            <path
              d="M 192 216 Q 232 208 254 180"
              fill="none"
              stroke={PALETTE.teal}
              strokeWidth="25"
              strokeLinecap="round"
            />
            <circle cx="258" cy="176" r="14" fill={PALETTE.skin} />
            <rect
              x="256"
              y="162"
              width="20"
              height="9"
              rx="4.5"
              transform="rotate(-24 256 162)"
              fill={PALETTE.skin}
            />
          </g>
        )}

        {pose === 'holdXray' && (
          <g transform={`translate(0, ${Math.sin(frame * 0.14) * 4})`}>
            <path
              d="M 192 216 Q 228 214 246 196"
              fill="none"
              stroke={PALETTE.teal}
              strokeWidth="25"
              strokeLinecap="round"
            />
            <circle cx="250" cy="192" r="14" fill={PALETTE.skin} />
          </g>
        )}

        {/* Neck */}
        <rect x="124" y="170" width="32" height="32" rx="10" fill={PALETTE.skinShadow} />

        {/* Big Head (Look-2 proportions) */}
        <g>
          {/* Ears */}
          <circle cx="68" cy="126" r="15" fill={PALETTE.skinShadow} />
          <circle cx="212" cy="126" r="15" fill={PALETTE.skin} />
          {/* Head circle */}
          <rect x="72" y="50" width="136" height="136" rx="64" fill={PALETTE.skin} />
          {/* Flat shaded left cheek strip (Look-2) */}
          <path
            d="M 110 56 C 86 64 72 86 72 118 C 72 156 96 184 128 186 C 108 176 96 150 96 118 C 96 86 104 66 118 54 Z"
            fill={PALETTE.skinShadow}
          />
          {/* Side hair peeks */}
          <path d="M 72 104 Q 68 78 90 70 L 96 96 Z" fill={PALETTE.hair} />
          <path d="M 208 104 Q 212 78 190 70 L 184 96 Z" fill={PALETTE.hair} />

          {/* Surgical Cap */}
          <path
            d="M 68 92 C 66 42, 102 22, 140 22 C 178 22, 214 42, 212 92 Z"
            fill={PALETTE.teal}
          />
          {/* Flat shaded side of cap */}
          <path
            d="M 68 92 C 66 42, 102 22, 134 22 C 110 30, 96 56, 98 92 Z"
            fill={PALETTE.tealDark}
          />
          {/* Cap band */}
          <rect x="66" y="82" width="148" height="18" rx="9" fill={PALETTE.tealDark} />
          {/* Tiny white medical cross on cap */}
          <rect x="135" y="42" width="10" height="26" rx="3" fill={PALETTE.white} />
          <rect x="127" y="50" width="26" height="10" rx="3" fill={PALETTE.white} />

          {/* Small dark oval eyes + short brows (no realistic face) */}
          <ellipse cx="116" cy="118" rx="6.5" ry={Math.max(1.8, 8.5 * eyeScaleY)} fill={PALETTE.navy} />
          <ellipse cx="164" cy="118" rx="6.5" ry={Math.max(1.8, 8.5 * eyeScaleY)} fill={PALETTE.navy} />
          <path d="M 105 104 L 125 102" stroke={PALETTE.hair} strokeWidth="4.5" strokeLinecap="round" />
          <path d="M 155 102 L 175 104" stroke={PALETTE.hair} strokeWidth="4.5" strokeLinecap="round" />

          {/* Surgical Mask (clean medical look) */}
          <path
            d="M 74 128 L 94 138 M 206 128 L 186 138 M 76 154 L 94 160 M 204 154 L 186 160"
            stroke={PALETTE.navy}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <rect
            x="92"
            y="132"
            width="96"
            height="54"
            rx="18"
            fill={PALETTE.white}
            stroke={PALETTE.navy}
            strokeWidth="2.5"
          />
          {/* Flat mask folds */}
          <path
            d="M 106 148 L 174 148 M 106 162 L 174 162"
            stroke={PALETTE.tealSoft}
            strokeWidth="3.5"
            strokeLinecap="round"
          />
        </g>
      </g>
    </svg>
  );
};

// ============================================================================
// SVG CHARACTER 3: GERM (เชื้อโรคการ์ตูนกลมสีเขียวมีหนาม)
// ============================================================================

interface GermProps {
  seed: string;
  frame: number;
  size?: number;
  panicking?: boolean;
}

const Germ: React.FC<GermProps> = ({ seed, frame, size = 56, panicking = false }) => {
  const phase = random(`${seed}-phase`) * Math.PI * 2;
  const spikeCount = 7 + Math.floor(random(`${seed}-sp`) * 3);
  const bobX = Math.sin(frame * 0.14 + phase) * 4;
  const bobY = Math.cos(frame * 0.17 + phase) * 4;
  const rot = Math.sin(frame * 0.08 + phase) * 10;

  const spikes: React.ReactNode[] = [];
  for (let i = 0; i < spikeCount; i += 1) {
    const angle = (i / spikeCount) * Math.PI * 2;
    const x1 = 40 + Math.cos(angle) * 20;
    const y1 = 40 + Math.sin(angle) * 20;
    const x2 = 40 + Math.cos(angle) * 33;
    const y2 = 40 + Math.sin(angle) * 33;
    spikes.push(
      <g key={i}>
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={i > spikeCount / 2 ? PALETTE.germShadow : PALETTE.germ}
          strokeWidth="6.5"
          strokeLinecap="round"
        />
        <circle
          cx={x2}
          cy={y2}
          r="5"
          fill={i > spikeCount / 2 ? PALETTE.germShadow : PALETTE.germ}
        />
      </g>,
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      style={{
        overflow: 'visible',
        transform: `translate(${bobX.toFixed(1)}px, ${bobY.toFixed(1)}px) rotate(${rot.toFixed(1)}deg)`,
      }}
    >
      {spikes}
      {/* Main flat round germ body */}
      <circle cx="40" cy="40" r="24" fill={PALETTE.germ} />
      {/* Flat shaded crescent */}
      <path
        d="M 54 20 A 24 24 0 0 1 26 60 A 20 20 0 0 0 54 20 Z"
        fill={PALETTE.germShadow}
      />
      {/* Flat spot */}
      <circle cx="29" cy="28" r="5" fill={PALETTE.germLight} />
      {/* Thin outline */}
      <circle cx="40" cy="40" r="24" fill="none" stroke={PALETTE.navy} strokeWidth="2.5" />

      {/* Eyes & Expression */}
      <circle cx="32" cy="38" r="4" fill={PALETTE.navy} />
      <circle cx="48" cy="38" r="4" fill={PALETTE.navy} />
      <circle cx="31" cy="36.5" r="1.4" fill={PALETTE.white} />
      <circle cx="47" cy="36.5" r="1.4" fill={PALETTE.white} />

      {panicking ? (
        <circle cx="40" cy="50" r="5.5" fill={PALETTE.navy} />
      ) : (
        <>
          <path d="M 25 30 L 36 34" stroke={PALETTE.navy} strokeWidth="3" strokeLinecap="round" />
          <path d="M 55 30 L 44 34" stroke={PALETTE.navy} strokeWidth="3" strokeLinecap="round" />
          <path
            d="M 31 48 L 36 52 L 40 48 L 44 52 L 49 48"
            fill="none"
            stroke={PALETTE.navy}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
};

// ============================================================================
// SVG DIAGRAM: TOOTH CROSS SECTION (ภาพผ่าครึ่งฟัน — Look-2 + Look-29)
// ============================================================================

export type ToothLabelPart = 'enamel' | 'dentin' | 'pulp' | 'canals' | 'pus' | 'gutta' | 'crown';

export interface ToothLabelSpec {
  part: ToothLabelPart;
  text: string;
  side: 'left' | 'right';
  appearProgress: number;
}

interface ToothCrossSectionProps {
  infection: number; // 0..1
  cleaned: number; // 0..1
  filled: number; // 0..1
  crown: number; // 0..1
  explode: number; // 0..1
  frame: number;
  showFile?: boolean;
  showTempCap?: number; // 0..1
  labels?: ToothLabelSpec[];
  scale?: number;
}

const ANCHOR_POINTS: Record<ToothLabelPart, { x: number; y: number; ly: number }> = {
  enamel: { x: 250, y: 120, ly: 96 },
  dentin: { x: 382, y: 168, ly: 158 },
  pulp: { x: 310, y: 245, ly: 220 },
  canals: { x: 382, y: 378, ly: 368 },
  pus: { x: 224, y: 472, ly: 468 },
  gutta: { x: 388, y: 356, ly: 352 },
  crown: { x: 366, y: 112, ly: 92 },
};

const ToothCrossSection: React.FC<ToothCrossSectionProps> = ({
  infection,
  cleaned,
  filled,
  crown,
  explode,
  frame,
  showFile = false,
  showTempCap = 0,
  labels = [],
  scale = 1,
}) => {
  const inf = clamp01(infection);
  const cln = clamp01(cleaned);
  const fil = clamp01(filled);
  const crn = clamp01(crown);
  const exp = clamp01(explode);
  const tmpCap = clamp01(showTempCap);

  // Exploded offsets (Look-29 clean vertical separation)
  const enamelShiftY = -exp * 56;
  const dentinShiftY = -exp * 24;
  const boneShiftY = exp * 28;

  // Residual infection after cleaning
  const activeInf = clamp01(inf * (1 - cln));
  const pusScale = activeInf > 0.25 ? clamp01((activeInf - 0.25) / 0.75) : 0;

  // File motion inside left & right root canals
  const fileStrokeY = Math.sin(frame * 0.45) * 28;
  const activeCanalSide = Math.floor(frame / 36) % 2; // alternates between left & right root canal

  // Crown spring drop position
  const crownDropY = interpolate(crn, [0, 1], [-140, 0]);
  const crownOpacity = interpolate(crn, [0, 0.2], [0, 1], { extrapolateRight: 'clamp' });

  // Pulp color transitions from healthy pink -> inflamed red-violet -> clean hollow
  const pulpFill =
    cln > 0.35 ? PALETTE.tealSoft : activeInf > 0.4 ? '#D64C6D' : PALETTE.pulp;

  // Germs streaming down into pulp & canals
  const germPositions = [
    { seed: 'g1', x: 300, y: 122 + inf * 105, thr: 0.1 },
    { seed: 'g2', x: 325, y: 138 + inf * 115, thr: 0.22 },
    { seed: 'g3', x: 266, y: 196 + inf * 135, thr: 0.36 },
    { seed: 'g4', x: 354, y: 204 + inf * 140, thr: 0.48 },
    { seed: 'g5', x: 242, y: 262 + inf * 155, thr: 0.62 },
    { seed: 'g6', x: 378, y: 268 + inf * 150, thr: 0.74 },
  ];

  // Limit to maximum 3 labels strictly
  const safeLabels = labels.slice(0, 3);

  return (
    <div
      style={{
        position: 'relative',
        width: 620 * scale,
        height: 560 * scale,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <svg
        width={620 * scale}
        height={560 * scale}
        viewBox="0 0 620 560"
        style={{ overflow: 'visible' }}
      >
        <defs>
          {/* Clip path for gutta-percha rising fill inside canals */}
          <clipPath id="rc-canal-clip">
            <path d="M 262 214 C 242 222, 232 254, 230 302 L 222 444 C 222 458, 244 458, 250 442 L 266 322 C 272 288, 290 282, 310 282 C 330 282, 348 288, 354 322 L 370 442 C 376 458, 398 458, 398 444 L 390 302 C 388 254, 378 222, 358 214 C 338 206, 282 206, 262 214 Z" />
          </clipPath>
        </defs>

        {/* LAYER 1: JAWBONE & GINGIVA (GUM) */}
        <g transform={`translate(0, ${boneShiftY.toFixed(1)})`}>
          {/* Jawbone block */}
          <rect x="108" y="294" width="404" height="222" rx="34" fill={PALETTE.bone} />
          <path
            d="M 108 426 L 512 426 L 512 482 C 512 501 497 516 478 516 L 142 516 C 123 516 108 501 108 482 Z"
            fill={PALETTE.boneDark}
          />
          {/* Subtle flat porous bone dots */}
          {[
            [144, 344], [166, 386], [140, 444], [176, 472], [456, 348],
            [474, 396], [448, 456], [480, 480], [310, 476], [288, 442], [336, 446],
          ].map(([bx, by], idx) => (
            <circle key={idx} cx={bx} cy={by} r="6.5" fill={PALETTE.white} opacity={0.45} />
          ))}

          {/* Pink Gum (Gingiva) curving neatly around tooth neck */}
          <path
            d="M 102 272 C 134 252, 174 268, 200 284 L 420 284 C 446 268, 486 252, 518 272 L 518 320 C 482 326, 444 316, 420 310 L 200 310 C 176 316, 138 326, 102 320 Z"
            fill={PALETTE.gum}
          />
          <path
            d="M 102 302 C 138 312, 176 304, 200 298 L 420 298 C 444 304, 482 312, 518 302 L 518 320 C 482 326, 444 316, 420 310 L 200 310 C 176 316, 138 326, 102 320 Z"
            fill={PALETTE.gumDark}
          />
          <rect
            x="108"
            y="294"
            width="404"
            height="222"
            rx="34"
            fill="none"
            stroke={PALETTE.navy}
            strokeWidth="3"
          />
        </g>

        {/* APICAL PUS SAC AT ROOT TIP (when infected) */}
        {pusScale > 0.02 && (
          <g
            transform={`translate(234, ${(468 + boneShiftY * 0.4).toFixed(1)}) scale(${(
              pusScale *
              (1 + Math.sin(frame * 0.25) * 0.06)
            ).toFixed(3)})`}
          >
            <ellipse cx="0" cy="4" rx="44" ry="30" fill={PALETTE.alert} opacity={0.28} />
            <ellipse
              cx="0"
              cy="4"
              rx="32"
              ry="21"
              fill={PALETTE.pus}
              stroke={PALETTE.alert}
              strokeWidth="3.5"
            />
            <ellipse cx="-8" cy="-2" rx="10" ry="5" fill={PALETTE.white} opacity={0.7} />
          </g>
        )}

        {/* LAYER 2: OUTER ENAMEL SHELL + TWO ROOTS */}
        <g transform={`translate(0, ${enamelShiftY.toFixed(1)})`}>
          {/* Hard flat silhouette offset */}
          <path
            d="M 192 104 C 228 76, 278 88, 310 108 C 342 88, 392 76, 428 104 C 464 134, 466 218, 434 278 L 418 456 C 414 484, 366 488, 356 456 L 330 338 C 324 316, 296 316, 290 338 L 264 456 C 254 488, 206 484, 202 456 L 186 278 C 154 218, 156 134, 192 104 Z"
            fill={PALETTE.hardShadow}
            transform="translate(9, 9)"
            opacity={0.55}
          />
          {/* Enamel shell */}
          <path
            d="M 192 104 C 228 76, 278 88, 310 108 C 342 88, 392 76, 428 104 C 464 134, 466 218, 434 278 L 418 456 C 414 484, 366 488, 356 456 L 330 338 C 324 316, 296 316, 290 338 L 264 456 C 254 488, 206 484, 202 456 L 186 278 C 154 218, 156 134, 192 104 Z"
            fill={PALETTE.tooth}
            stroke={PALETTE.navy}
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
          {/* Flat enamel shade right side */}
          <path
            d="M 412 96 C 418 98, 423 101, 428 104 C 464 134, 466 218, 434 278 L 418 456 C 415 476, 394 484, 376 476 C 394 468, 400 448, 404 426 L 416 272 C 442 214, 442 140, 412 96 Z"
            fill={PALETTE.toothShadow}
          />
        </g>

        {/* LAYER 3: DENTIN (เนื้อฟัน) */}
        <g transform={`translate(0, ${dentinShiftY.toFixed(1)})`}>
          <path
            d="M 214 136 C 244 114, 282 126, 310 142 C 338 126, 376 114, 406 136 C 434 158, 436 226, 412 276 L 402 446 C 398 466, 370 468, 364 446 L 340 326 C 334 300, 286 300, 280 326 L 256 446 C 250 468, 222 466, 218 446 L 208 276 C 184 226, 186 158, 214 136 Z"
            fill={PALETTE.dentin}
            stroke={PALETTE.dentinShadow}
            strokeWidth="3"
          />
          {/* Flat dentin inner shadow */}
          <path
            d="M 386 126 C 394 129, 400 132, 406 136 C 434 158, 436 226, 412 276 L 402 446 C 399 461, 384 466, 374 460 C 386 452, 390 436, 392 418 L 398 274 C 418 224, 418 164, 386 126 Z"
            fill={PALETTE.dentinShadow}
          />
        </g>

        {/* DECAY CAVITY / ACCESS OPENING AT TOP CUSP */}
        {(inf > 0.05 || cln > 0.05 || fil > 0.05) && crn < 0.85 && (
          <g transform={`translate(0, ${(enamelShiftY * 0.5).toFixed(1)})`}>
            {cln > 0.1 || fil > 0.05 ? (
              /* Clean dentist-prepared access corridor */
              <rect
                x="284"
                y="94"
                width="52"
                height="122"
                rx="16"
                fill={fil > 0.7 ? PALETTE.tooth : PALETTE.tealSoft}
                stroke={PALETTE.navy}
                strokeWidth="2.5"
              />
            ) : (
              /* Dark spreading decay cavity from top */
              <path
                d={`M 278 96 Q 310 108 342 96 L ${326 + inf * 8} ${118 + inf * 96} Q 310 ${132 + inf * 96} ${294 - inf * 8} ${118 + inf * 96} Z`}
                fill="#523E3B"
              />
            )}
          </g>
        )}

        {/* LAYER 4: PULP CHAMBER & TWO ROOT CANALS */}
        <g>
          <path
            d="M 262 214 C 242 222, 232 254, 230 302 L 222 444 C 222 458, 244 458, 250 442 L 266 322 C 272 288, 290 282, 310 282 C 330 282, 348 288, 354 322 L 370 442 C 376 458, 398 458, 398 444 L 390 302 C 388 254, 378 222, 358 214 C 338 206, 282 206, 262 214 Z"
            fill={pulpFill}
            stroke={PALETTE.navy}
            strokeWidth="2.5"
          />

          {/* Blood vessels (red) & Nerves (yellow) when not yet cleaned out */}
          {cln < 0.75 && fil < 0.05 && (
            <g opacity={clamp01(1 - cln * 1.4)}>
              {/* Red blood vessels */}
              <path
                d="M 234 452 L 248 296 Q 258 246 306 238 Q 354 246 372 296 L 386 452"
                fill="none"
                stroke={PALETTE.vessel}
                strokeWidth="6"
                strokeLinecap="round"
              />
              {/* Yellow nerves */}
              <path
                d="M 244 452 L 258 300 Q 268 258 312 252 Q 356 258 364 300 L 378 452"
                fill="none"
                stroke={PALETTE.nerve}
                strokeWidth="5"
                strokeLinecap="round"
              />
            </g>
          )}

          {/* Antiseptic rinse wash bubbles during cleaning */}
          {cln > 0.08 && fil < 0.1 && (
            <g clipPath="url(#rc-canal-clip)">
              <rect
                x="200"
                y={interpolate(cln, [0, 1], [200, 200])}
                width="220"
                height={interpolate(cln, [0, 1], [40, 270])}
                fill="#7AE3DB"
                opacity={0.55}
              />
              {[0, 1, 2, 3, 4, 5].map((b) => {
                const bx = b % 2 === 0 ? 242 + (b * 7) % 18 : 368 + (b * 5) % 16;
                const by = 445 - ((frame * 4 + b * 48) % 230);
                return (
                  <circle
                    key={b}
                    cx={bx}
                    cy={by}
                    r={5 + (b % 3) * 2}
                    fill={PALETTE.white}
                    opacity={0.85}
                  />
                );
              })}
            </g>
          )}

          {/* GUTTA-PERCHA ORANGE FILL (fills from bottom apex up!) */}
          {fil > 0.02 && (
            <g clipPath="url(#rc-canal-clip)">
              <rect
                x="200"
                y={interpolate(fil, [0, 1], [462, 205])}
                width="220"
                height={interpolate(fil, [0, 1], [0, 265])}
                fill={PALETTE.gutta}
              />
              {/* Flat shading stripe inside gutta-percha */}
              <rect
                x="350"
                y={interpolate(fil, [0, 1], [462, 205])}
                width="65"
                height={interpolate(fil, [0, 1], [0, 265])}
                fill={PALETTE.guttaShadow}
                opacity={0.45}
              />
            </g>
          )}

          {/* Temporary medicine dressing cap (Step 4) */}
          {tmpCap > 0.05 && fil < 0.05 && (
            <g opacity={tmpCap}>
              <rect
                x="278"
                y="96"
                width="64"
                height="36"
                rx="14"
                fill={PALETTE.nerve}
                stroke={PALETTE.navy}
                strokeWidth="3"
              />
              <circle cx="310" cy="236" r="18" fill={PALETTE.teal} opacity={0.85} />
              <rect x="307" y="227" width="6" height="18" rx="2" fill={PALETTE.white} />
              <rect x="301" y="233" width="18" height="6" rx="2" fill={PALETTE.white} />
            </g>
          )}
        </g>

        {/* ENDODONTIC MICRO-FILE ANIMATION (Scene 5) */}
        {showFile && (
          <g
            transform={`translate(${activeCanalSide === 0 ? 256 : 364}, ${(fileStrokeY - 12).toFixed(1)}) rotate(${activeCanalSide === 0 ? 4 : -4} 0 210)`}
          >
            {/* Plastic handle */}
            <rect
              x="-14"
              y="18"
              width="28"
              height="48"
              rx="8"
              fill={PALETTE.teal}
              stroke={PALETTE.navy}
              strokeWidth="3"
            />
            <rect x="-14" y="34" width="28" height="8" fill={PALETTE.white} />
            {/* Thin tapered stainless file shaft */}
            <polygon points="-4,66 4,66 1.2,375 -1.2,375" fill={PALETTE.crownShadow} stroke={PALETTE.navy} strokeWidth="1.5" />
            {/* Tiny spiral flutes */}
            {[160, 195, 230, 265, 300, 335].map((fy) => (
              <line key={fy} x1="-4" y1={fy} x2="4" y2={fy + 7} stroke={PALETTE.navy} strokeWidth="2" />
            ))}
          </g>
        )}

        {/* GERMS INSIDE TOOTH (fade/shrink away sequentially as cleaned 0 -> 1) */}
        {inf > 0.08 &&
          germPositions.map((g, idx) => {
            const appeared = clamp01((inf - g.thr) * 4);
            const washThreshold = 0.12 + idx * 0.14;
            const remaining = clamp01(1 - (cln - washThreshold) * 5);
            const vis = appeared * remaining;
            if (vis <= 0.02) return null;
            const washLiftY = cln > washThreshold ? -(cln - washThreshold) * 140 : 0;
            return (
              <g
                key={g.seed}
                transform={`translate(${(g.x - 24).toFixed(1)}, ${(g.y - 24 + washLiftY).toFixed(1)}) scale(${vis.toFixed(3)})`}
              >
                <Germ seed={g.seed} frame={frame} size={48} panicking={cln > 0.15} />
              </g>
            );
          })}

        {/* LAYER 5: DENTAL CROWN DROPPING ONTO TOOTH (Scene 6) */}
        {crn > 0.01 && (
          <g
            transform={`translate(0, ${crownDropY.toFixed(1)})`}
            opacity={crownOpacity}
          >
            <path
              d="M 184 222 C 160 176, 162 118, 194 94 C 228 68, 278 80, 310 100 C 342 80, 392 68, 426 94 C 458 118, 460 176, 436 222 Q 372 242, 310 232 Q 248 242, 184 222 Z"
              fill={PALETTE.crown}
              stroke={PALETTE.navy}
              strokeWidth="4"
              strokeLinejoin="round"
            />
            {/* Flat glossy side stripe */}
            <path
              d="M 206 204 C 188 168, 190 128, 214 108 C 234 94, 256 96, 272 104 L 252 214 Q 226 214, 206 204 Z"
              fill={PALETTE.crownLight}
            />
            {/* Flat shaded right side */}
            <path
              d="M 412 88 C 446 112, 456 172, 436 222 Q 408 232, 382 234 C 402 184, 404 132, 394 86 Z"
              fill={PALETTE.crownShadow}
            />
            {/* Sparkles once seated */}
            {crn > 0.85 &&
              [
                [172, 76],
                [446, 82],
                [310, 56],
              ].map(([sx, sy], i) => {
                const spScale = 0.7 + 0.35 * Math.sin(frame * 0.25 + i * 2);
                return (
                  <path
                    key={i}
                    d="M 0 -16 L 4.5 -4.5 L 16 0 L 4.5 4.5 L 0 16 L -4.5 4.5 L -16 0 L -4.5 -4.5 Z"
                    fill={i === 2 ? PALETTE.nerve : PALETTE.white}
                    stroke={PALETTE.navy}
                    strokeWidth="1.5"
                    transform={`translate(${sx}, ${sy}) scale(${spScale.toFixed(2)})`}
                  />
                );
              })}
          </g>
        )}

        {/* LEADER LINES & ANCHOR DOTS FOR CAPSULE LABELS (max 3) */}
        {safeLabels.map((lbl, idx) => {
          const anchor = ANCHOR_POINTS[lbl.part];
          if (!anchor || lbl.appearProgress <= 0.02) return null;
          const p = clamp01(lbl.appearProgress);
          const ay =
            lbl.part === 'enamel'
              ? anchor.y + enamelShiftY
              : lbl.part === 'dentin'
                ? anchor.y + dentinShiftY
                : lbl.part === 'pus'
                  ? anchor.y + boneShiftY * 0.4
                  : anchor.y;
          const endX = lbl.side === 'left' ? 54 : 566;
          const lineEndX = interpolate(p, [0, 1], [anchor.x, endX]);
          const lineEndY = interpolate(p, [0, 1], [ay, anchor.ly]);
          return (
            <g key={`${lbl.part}-${idx}`}>
              <line
                x1={anchor.x}
                y1={ay}
                x2={lineEndX}
                y2={lineEndY}
                stroke={PALETTE.navy}
                strokeWidth="3"
                strokeLinecap="round"
              />
              <circle
                cx={anchor.x}
                cy={ay}
                r="7.5"
                fill={lbl.part === 'pus' ? PALETTE.alert : PALETTE.teal}
                stroke={PALETTE.white}
                strokeWidth="3"
              />
            </g>
          );
        })}
      </svg>

      {/* HTML CAPSULE LABELS (crisp Thai typography, zero clipping) */}
      {safeLabels.map((lbl, idx) => {
        const anchor = ANCHOR_POINTS[lbl.part];
        if (!anchor || lbl.appearProgress <= 0.05) return null;
        const p = clamp01(lbl.appearProgress);
        const isAlert = lbl.part === 'pus';
        const isOrange = lbl.part === 'gutta';
        const pillBg = isAlert ? PALETTE.alert : isOrange ? PALETTE.gutta : PALETTE.white;
        const pillFg = isAlert || isOrange ? PALETTE.white : PALETTE.navy;

        return (
          <div
            key={`pill-${lbl.part}-${idx}`}
            style={{
              position: 'absolute',
              top: anchor.ly * scale - 28,
              left: lbl.side === 'left' ? -72 : undefined,
              right: lbl.side === 'right' ? -72 : undefined,
              transform: `scale(${interpolate(p, [0, 1], [0.7, 1]).toFixed(3)})`,
              opacity: interpolate(p, [0, 0.4], [0, 1], { extrapolateRight: 'clamp' }),
              backgroundColor: pillBg,
              color: pillFg,
              fontFamily: THAI_FONT_FAMILY,
              fontWeight: 700,
              fontSize: 25,
              lineHeight: 1.4,
              padding: '8px 20px',
              borderRadius: 999,
              border: `3px solid ${PALETTE.navy}`,
              boxShadow: `5px 5px 0px ${PALETTE.hardShadow}`,
              whiteSpace: 'nowrap',
            }}
          >
            {lbl.text}
          </div>
        );
      })}
    </div>
  );
};

// ============================================================================
// SVG PROP: X-RAY CARD (ภาพเอกซเรย์การ์ตูน)
// ============================================================================

const XrayCard: React.FC<{ frame: number; scale?: number }> = ({ frame, scale = 1 }) => {
  const scanY = 38 + ((frame * 3.2) % 210);
  const targetPulse = 1 + Math.sin(frame * 0.28) * 0.14;

  return (
    <svg
      width={290 * scale}
      height={280 * scale}
      viewBox="0 0 290 280"
      style={{ overflow: 'visible' }}
    >
      {/* Hard flat offset shadow */}
      <rect x="14" y="14" width="268" height="258" rx="26" fill={PALETTE.hardShadow} />
      {/* Dark navy X-ray film */}
      <rect
        x="4"
        y="4"
        width="268"
        height="258"
        rx="26"
        fill={PALETTE.navy}
        stroke={PALETTE.navy}
        strokeWidth="4"
      />
      {/* Inner radiograph window */}
      <rect x="22" y="34" width="232" height="208" rx="16" fill="#1C173B" />

      {/* Header marker */}
      <text
        x="34"
        y="25"
        fill={PALETTE.tealSoft}
        fontSize="14"
        fontWeight="700"
        fontFamily={THAI_FONT_FAMILY}
      >
        DENTAL X-RAY
      </text>
      <circle cx="242" cy="19" r="5" fill={PALETTE.teal} />

      {/* Neighboring faint teeth silhouettes */}
      <rect x="34" y="72" width="46" height="96" rx="16" fill="#3B4F78" opacity={0.45} />
      <rect x="196" y="72" width="46" height="96" rx="16" fill="#3B4F78" opacity={0.45} />

      {/* Central X-ray molar silhouette */}
      <path
        d="M 100 66 C 118 54, 132 62, 138 68 C 144 62, 158 54, 176 66 C 192 80, 192 118, 178 144 L 172 212 C 170 224, 152 224, 148 212 L 140 164 L 136 164 L 128 212 C 124 224, 106 224, 104 212 L 98 144 C 84 118, 84 80, 100 66 Z"
        fill="#BCE9E2"
        opacity={0.92}
      />
      {/* Radiographic root canal lines */}
      <path
        d="M 116 208 L 122 128 Q 138 118 154 128 L 160 208"
        fill="none"
        stroke="#2B2452"
        strokeWidth="6"
        strokeLinecap="round"
      />

      {/* Red pulsing target at root apex infection */}
      <g transform={`translate(115, 214) scale(${targetPulse.toFixed(3)})`}>
        <circle cx="0" cy="0" r="18" fill="none" stroke={PALETTE.alert} strokeWidth="3.5" strokeDasharray="6 4" />
        <circle cx="0" cy="0" r="6" fill={PALETTE.alert} />
      </g>

      {/* Flat sweeping scan line */}
      <rect x="24" y={scanY} width="228" height="4" rx="2" fill={PALETTE.teal} opacity={0.85} />
    </svg>
  );
};

// ============================================================================
// SVG ICONS: 6 SYMPTOM SIGN ICONS (SignIcon)
// ============================================================================

const SignIcon: React.FC<{ icon: SignIconKind; frame: number; size?: number }> = ({
  icon,
  frame,
  size = 104,
}) => {
  const pulse = 1 + Math.sin(frame * 0.22) * 0.06;

  return (
    <svg width={size} height={size} viewBox="0 0 120 120" style={{ overflow: 'visible' }}>
      {/* Soft circle backdrop */}
      <circle cx="60" cy="60" r="52" fill={PALETTE.alertSoft} />
      <circle cx="60" cy="60" r="52" fill="none" stroke={PALETTE.navy} strokeWidth="2.5" />

      {icon === 'throb' && (
        <g>
          {/* Crescent moon */}
          <path d="M 88 22 A 14 14 0 1 0 102 38 A 11 11 0 1 1 88 22 Z" fill={PALETTE.nerve} stroke={PALETTE.navy} strokeWidth="2" />
          {/* Tooth */}
          <path
            d="M 38 40 C 48 32, 56 38, 60 42 C 64 38, 72 32, 82 40 C 92 48, 92 68, 84 82 L 78 98 C 76 102, 68 100, 65 92 L 60 82 L 55 92 C 52 100, 44 102, 42 98 L 36 82 C 28 68, 28 48, 38 40 Z"
            fill={PALETTE.tooth}
            stroke={PALETTE.navy}
            strokeWidth="3"
          />
          {/* Red lightning bolts */}
          <g transform={`translate(60, 60) scale(${pulse.toFixed(3)}) translate(-60, -60)`}>
            <polygon points="22,42 32,54 26,56 36,68 20,56 26,54" fill={PALETTE.alert} />
            <polygon points="98,48 88,60 94,62 84,74 100,62 94,60" fill={PALETTE.alert} />
          </g>
        </g>
      )}

      {icon === 'temp' && (
        <g>
          {/* Hot red left / Cold teal right split wave */}
          <path d="M 26 36 Q 36 28 30 46 Q 24 58 34 66" fill="none" stroke={PALETTE.alert} strokeWidth="5" strokeLinecap="round" />
          <path d="M 94 36 L 94 64 M 82 50 L 106 50 M 86 42 L 102 58 M 102 42 L 86 58" stroke={PALETTE.teal} strokeWidth="4" strokeLinecap="round" />
          {/* Sensitive Tooth */}
          <path
            d="M 42 44 C 50 36, 56 42, 60 46 C 64 42, 70 36, 78 44 C 86 52, 86 70, 78 82 L 74 96 C 72 100, 66 98, 63 90 L 60 82 L 57 90 C 54 98, 48 100, 46 96 L 42 82 C 34 70, 34 52, 42 44 Z"
            fill={PALETTE.tooth}
            stroke={PALETTE.navy}
            strokeWidth="3"
          />
          {/* Zing zig-zag */}
          <path d="M 52 60 L 60 54 L 68 60" fill="none" stroke={PALETTE.alert} strokeWidth="4" strokeLinecap="round" />
        </g>
      )}

      {icon === 'bite' && (
        <g>
          {/* Upper tooth pressing down */}
          <rect
            x="40"
            y={22 + Math.sin(frame * 0.25) * 3}
            width="40"
            height="32"
            rx="12"
            fill={PALETTE.tooth}
            stroke={PALETTE.navy}
            strokeWidth="3"
          />
          {/* Lower tooth */}
          <rect
            x="40"
            y="68"
            width="40"
            height="32"
            rx="12"
            fill={PALETTE.tooth}
            stroke={PALETTE.navy}
            strokeWidth="3"
          />
          {/* Red impact star */}
          <polygon
            points="60,48 65,56 76,55 68,62 73,72 60,66 47,72 52,62 44,55 55,56"
            fill={PALETTE.alert}
          />
        </g>
      )}

      {icon === 'gum' && (
        <g>
          {/* Tooth */}
          <path
            d="M 40 34 C 50 26, 56 32, 60 36 C 64 32, 70 26, 80 34 C 88 44, 86 68, 80 80 L 40 80 C 34 68, 32 44, 40 34 Z"
            fill={PALETTE.tooth}
            stroke={PALETTE.navy}
            strokeWidth="3"
          />
          {/* Swollen red-pink gum ridge */}
          <path
            d="M 20 82 Q 36 62 60 72 Q 84 62 100 82 L 96 96 Q 60 104 24 96 Z"
            fill={PALETTE.alert}
            stroke={PALETTE.navy}
            strokeWidth="3"
          />
          {/* Puff swelling highlight */}
          <ellipse cx="42" cy="80" rx="10" ry="5" fill={PALETTE.pulp} />
          <ellipse cx="78" cy="80" rx="10" ry="5" fill={PALETTE.pulp} />
        </g>
      )}

      {icon === 'pus' && (
        <g>
          {/* Tooth */}
          <path
            d="M 38 30 C 48 22, 56 28, 60 32 C 64 28, 72 22, 82 30 C 90 40, 88 64, 82 76 L 38 76 C 32 64, 30 40, 38 30 Z"
            fill={PALETTE.tooth}
            stroke={PALETTE.navy}
            strokeWidth="3"
          />
          {/* Gum */}
          <path d="M 22 76 Q 60 66 98 76 L 94 96 Q 60 104 26 96 Z" fill={PALETTE.gum} stroke={PALETTE.navy} strokeWidth="2.5" />
          {/* Cream pus pimple bump */}
          <circle
            cx="76"
            cy="82"
            r={13 * pulse}
            fill={PALETTE.pus}
            stroke={PALETTE.alert}
            strokeWidth="3.5"
          />
          <circle cx="72" cy="78" r="3.5" fill={PALETTE.white} />
        </g>
      )}

      {icon === 'dark' && (
        <g>
          {/* Half bright ivory, half darkened gray-brown tooth */}
          <path
            d="M 38 36 C 48 28, 56 34, 60 38 L 60 80 L 55 92 C 52 98, 44 100, 42 94 L 36 78 C 28 64, 28 44, 38 36 Z"
            fill={PALETTE.tooth}
          />
          <path
            d="M 60 38 C 64 34, 72 28, 82 36 C 92 44, 92 64, 84 78 L 78 94 C 76 100, 68 98, 65 92 L 60 80 Z"
            fill="#8D8296"
          />
          <path
            d="M 38 36 C 48 28, 56 34, 60 38 C 64 34, 72 28, 82 36 C 92 44, 92 64, 84 78 L 78 94 C 76 100, 68 98, 65 92 L 60 80 L 55 92 C 52 98, 44 100, 42 94 L 36 78 C 28 64, 28 44, 38 36 Z"
            fill="none"
            stroke={PALETTE.navy}
            strokeWidth="3"
          />
          <line x1="60" y1="38" x2="60" y2="80" stroke={PALETTE.navy} strokeWidth="2.5" strokeDasharray="4 4" />
        </g>
      )}
    </svg>
  );
};

// ============================================================================
// VERSUS BOARD (Scene 7: ข้อดี ✓ Teal VS ข้อจำกัด ✗ Red + CountUp 90%)
// ============================================================================

interface VersusBoardProps {
  pros: string[];
  cons: string[];
  frame: number;
  fps: number;
  durationFrames: number;
}

const VersusBoard: React.FC<VersusBoardProps> = ({
  pros,
  cons,
  frame,
  fps,
  durationFrames,
}) => {
  const halfMark = Math.round(durationFrames * 0.48);

  const heroPop = spring({
    frame: Math.max(0, frame - 8),
    fps,
    config: { damping: 14, stiffness: 180, mass: 0.7 },
  });

  const vsPop = spring({
    frame: Math.max(0, frame - 14),
    fps,
    config: { damping: 12, stiffness: 220, mass: 0.65 },
  });

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 24,
      }}
    >
      {/* HERO SUCCESS RATE CARD WITH CountUp 0 -> 90% */}
      <div
        style={{
          width: 940,
          backgroundColor: PALETTE.white,
          borderRadius: 28,
          border: `4px solid ${PALETTE.navy}`,
          boxShadow: `9px 9px 0px ${PALETTE.teal}`,
          padding: '20px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          transform: `scale(${interpolate(heroPop, [0, 1], [0.85, 1]).toFixed(4)})`,
          opacity: interpolate(heroPop, [0, 0.35], [0, 1], { extrapolateRight: 'clamp' }),
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontWeight: 700,
              fontSize: 30,
              lineHeight: 1.4,
              color: PALETTE.navy,
              paddingTop: 4,
              paddingBottom: 4,
            }}
          >
            อัตราสำเร็จโดยทั่วไปราว 9 ใน 10
          </div>
          {/* 10 Mini Flat Teeth Meter (9 teal + 1 muted) */}
          <div style={{ display: 'flex', gap: 9, alignItems: 'center', marginTop: 4 }}>
            {Array.from({ length: 10 }).map((_, idx) => {
              const filledTooth = idx < 9;
              const toothPop = spring({
                frame: Math.max(0, frame - (16 + idx * 3)),
                fps,
                config: { damping: 13, stiffness: 240, mass: 0.55 },
              });
              return (
                <svg
                  key={idx}
                  width="34"
                  height="38"
                  viewBox="0 0 36 40"
                  style={{ transform: `scale(${toothPop.toFixed(3)})` }}
                >
                  <path
                    d="M 8 6 C 13 3, 16 6, 18 8 C 20 6, 23 3, 28 6 C 33 10, 33 20, 29 28 L 26 36 C 25 38, 22 37, 20 33 L 18 29 L 16 33 C 14 37, 11 38, 10 36 L 7 28 C 3 20, 3 10, 8 6 Z"
                    fill={filledTooth ? PALETTE.teal : PALETTE.toothShadow}
                    stroke={PALETTE.navy}
                    strokeWidth="2.2"
                  />
                </svg>
              );
            })}
          </div>
        </div>

        {/* CountUp 0 -> 90% */}
        <div
          style={{
            backgroundColor: PALETTE.teal,
            color: PALETTE.white,
            borderRadius: 22,
            border: `3.5px solid ${PALETTE.navy}`,
            boxShadow: `5px 5px 0px ${PALETTE.navy}`,
            padding: '10px 26px',
            minWidth: 188,
            textAlign: 'center',
          }}
        >
          <CountUp
            from={0}
            to={90}
            startFrame={18}
            durationFrames={44}
            suffix="%"
            style={{
              fontSize: 64,
              fontWeight: 700,
              color: PALETTE.white,
              lineHeight: 1.2,
            }}
          />
        </div>
      </div>

      {/* SPLIT VERSUS COLUMNS */}
      <div
        style={{
          position: 'relative',
          width: 956,
          display: 'flex',
          gap: 28,
          alignItems: 'stretch',
        }}
      >
        {/* LEFT COLUMN: PROS (Teal ✓) */}
        <div
          style={{
            flex: 1,
            backgroundColor: PALETTE.white,
            borderRadius: 28,
            border: `4px solid ${PALETTE.navy}`,
            boxShadow: `8px 8px 0px ${PALETTE.teal}`,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              backgroundColor: PALETTE.teal,
              padding: '16px 22px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              borderBottom: `4px solid ${PALETTE.navy}`,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 999,
                backgroundColor: PALETTE.white,
                color: PALETTE.teal,
                fontWeight: 800,
                fontSize: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: `3px solid ${PALETTE.navy}`,
              }}
            >
              ✓
            </div>
            <span
              style={{
                fontFamily: THAI_FONT_FAMILY,
                fontWeight: 700,
                fontSize: 34,
                lineHeight: 1.4,
                color: PALETTE.white,
                paddingTop: 4,
                paddingBottom: 4,
              }}
            >
              ข้อดี
            </span>
          </div>

          <div
            style={{
              padding: '20px 18px 24px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              flex: 1,
            }}
          >
            {pros.map((text, idx) => {
              const start = 16 + idx * Math.max(18, Math.floor((halfMark - 24) / Math.max(1, pros.length)));
              const p = spring({
                frame: Math.max(0, frame - start),
                fps,
                config: { damping: 14, stiffness: 200, mass: 0.65 },
              });
              const active = frame >= start;
              return (
                <div
                  key={idx}
                  style={{
                    backgroundColor: PALETTE.tealSoft,
                    borderRadius: 18,
                    border: `2.5px solid ${PALETTE.navy}`,
                    boxShadow: `4px 4px 0px ${PALETTE.hardShadow}`,
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    transform: `translate3d(${interpolate(p, [0, 1], [-24, 0]).toFixed(1)}px, 0, 0) scale(${interpolate(p, [0, 1], [0.9, 1]).toFixed(3)})`,
                    opacity: active ? interpolate(p, [0, 0.35], [0, 1], { extrapolateRight: 'clamp' }) : 0.12,
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      width: 32,
                      height: 32,
                      borderRadius: 999,
                      backgroundColor: PALETTE.teal,
                      color: PALETTE.white,
                      fontWeight: 800,
                      fontSize: 20,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    ✓
                  </span>
                  <span
                    style={{
                      fontFamily: THAI_FONT_FAMILY,
                      fontWeight: 700,
                      fontSize: 26,
                      lineHeight: 1.42,
                      color: PALETTE.navy,
                      paddingTop: 4,
                      paddingBottom: 4,
                    }}
                  >
                    {text}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT COLUMN: CONS (Alert Red ✗) */}
        <div
          style={{
            flex: 1,
            backgroundColor: PALETTE.white,
            borderRadius: 28,
            border: `4px solid ${PALETTE.navy}`,
            boxShadow: `8px 8px 0px ${PALETTE.alert}`,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              backgroundColor: PALETTE.alert,
              padding: '16px 22px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              borderBottom: `4px solid ${PALETTE.navy}`,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 999,
                backgroundColor: PALETTE.white,
                color: PALETTE.alert,
                fontWeight: 800,
                fontSize: 26,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: `3px solid ${PALETTE.navy}`,
              }}
            >
              ✗
            </div>
            <span
              style={{
                fontFamily: THAI_FONT_FAMILY,
                fontWeight: 700,
                fontSize: 34,
                lineHeight: 1.4,
                color: PALETTE.white,
                paddingTop: 4,
                paddingBottom: 4,
              }}
            >
              ข้อจำกัด
            </span>
          </div>

          <div
            style={{
              padding: '20px 18px 24px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              flex: 1,
            }}
          >
            {cons.map((text, idx) => {
              const conBase = Math.max(24, halfMark - 12);
              const step = Math.max(12, Math.floor((durationFrames - conBase - 54) / Math.max(1, cons.length)));
              const start = conBase + idx * step;
              const p = spring({
                frame: Math.max(0, frame - start),
                fps,
                config: { damping: 14, stiffness: 200, mass: 0.65 },
              });
              const active = frame >= start;
              return (
                <div
                  key={idx}
                  style={{
                    backgroundColor: PALETTE.alertSoft,
                    borderRadius: 18,
                    border: `2.5px solid ${PALETTE.navy}`,
                    boxShadow: `4px 4px 0px ${PALETTE.hardShadow}`,
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    transform: `translate3d(${interpolate(p, [0, 1], [24, 0]).toFixed(1)}px, 0, 0) scale(${interpolate(p, [0, 1], [0.9, 1]).toFixed(3)})`,
                    opacity: active ? interpolate(p, [0, 0.35], [0, 1], { extrapolateRight: 'clamp' }) : 0.12,
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      width: 32,
                      height: 32,
                      borderRadius: 999,
                      backgroundColor: PALETTE.alert,
                      color: PALETTE.white,
                      fontWeight: 800,
                      fontSize: 19,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    ✗
                  </span>
                  <span
                    style={{
                      fontFamily: THAI_FONT_FAMILY,
                      fontWeight: 700,
                      fontSize: 26,
                      lineHeight: 1.42,
                      color: PALETTE.navy,
                      paddingTop: 4,
                      paddingBottom: 4,
                    }}
                  >
                    {text}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* CENTER VS BADGE */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 20,
            transform: `translateX(-50%) scale(${vsPop.toFixed(3)})`,
            width: 68,
            height: 68,
            borderRadius: 999,
            backgroundColor: PALETTE.nerve,
            border: `4px solid ${PALETTE.navy}`,
            boxShadow: `4px 4px 0px ${PALETTE.navy}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: THAI_FONT_FAMILY,
            fontWeight: 800,
            fontSize: 28,
            color: PALETTE.navy,
            zIndex: 10,
          }}
        >
          VS
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// SHARED HEADER BLOCK (y >= 170, KineticTitle + Flat Badge + Subtitle)
// ============================================================================

interface SceneHeaderProps {
  badge: string;
  title: string;
  subtitle?: string;
  isWarning?: boolean;
  frame: number;
  fps: number;
}

const SceneHeader: React.FC<SceneHeaderProps> = ({
  badge,
  title,
  subtitle,
  isWarning = false,
  frame,
  fps,
}) => {
  const badgePop = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 220, mass: 0.6 },
  });
  const cardPop = spring({
    frame: Math.max(0, frame - 3),
    fps,
    config: { damping: 15, stiffness: 190, mass: 0.7 },
  });

  const accentBg = isWarning ? PALETTE.alert : PALETTE.teal;

  return (
    <div
      style={{
        position: 'absolute',
        top: 210,
        left: 54,
        right: 54,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        zIndex: 20,
      }}
    >
      {/* Top Badge Pill */}
      <div
        style={{
          backgroundColor: accentBg,
          color: PALETTE.white,
          fontFamily: THAI_FONT_FAMILY,
          fontWeight: 700,
          fontSize: 23,
          lineHeight: 1.38,
          padding: '6px 24px',
          borderRadius: 999,
          border: `3px solid ${PALETTE.navy}`,
          boxShadow: `5px 5px 0px ${PALETTE.navy}`,
          marginBottom: -14,
          zIndex: 2,
          transform: `scale(${interpolate(badgePop, [0, 1], [0.7, 1]).toFixed(3)})`,
        }}
      >
        {badge}
      </div>

      {/* Main Flat Title Banner holding KineticTitle */}
      <div
        style={{
          width: '100%',
          maxWidth: 920,
          backgroundColor: PALETTE.navy,
          borderRadius: 28,
          border: `4px solid ${PALETTE.navy}`,
          boxShadow: `9px 9px 0px ${accentBg}`,
          padding: '16px 28px 10px 28px',
          transform: `translate3d(0, ${interpolate(cardPop, [0, 1], [18, 0]).toFixed(1)}px, 0) scale(${interpolate(cardPop, [0, 1], [0.94, 1]).toFixed(4)})`,
        }}
      >
        <KineticTitle
          text={title}
          startFrame={4}
          fontSize={50}
          color={PALETTE.white}
          accent={PALETTE.nerve}
          accentSecondary="#FFF3C4"
          staggerFrames={3}
          maxWidth={860}
        />
      </div>

      {/* Subtitle Pill */}
      {subtitle && (
        <div
          style={{
            marginTop: 10,
            backgroundColor: PALETTE.white,
            color: PALETTE.navy,
            fontFamily: THAI_FONT_FAMILY,
            fontWeight: 700,
            fontSize: 25,
            lineHeight: 1.4,
            padding: '6px 26px',
            borderRadius: 999,
            border: `3px solid ${PALETTE.navy}`,
            boxShadow: `5px 5px 0px ${PALETTE.hardShadow}`,
            transform: `scale(${interpolate(cardPop, [0, 1], [0.88, 1]).toFixed(3)})`,
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// STEP NUMBER BADGE PILL (for Scenes 4, 5, 6)
// ============================================================================

const StepPill: React.FC<{
  stepNum: string;
  label: string;
  active: boolean;
  frame: number;
  fps: number;
  startFrame: number;
}> = ({ stepNum, label, active, frame, fps, startFrame }) => {
  const pop = spring({
    frame: Math.max(0, frame - startFrame),
    fps,
    config: { damping: 13, stiffness: 210, mass: 0.65 },
  });
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        backgroundColor: active ? PALETTE.teal : PALETTE.white,
        color: active ? PALETTE.white : PALETTE.navy,
        borderRadius: 22,
        border: `3.5px solid ${PALETTE.navy}`,
        boxShadow: `6px 6px 0px ${active ? PALETTE.navy : PALETTE.hardShadow}`,
        padding: '10px 22px 10px 14px',
        transform: `scale(${interpolate(pop, [0, 1], [0.75, active ? 1.03 : 0.96]).toFixed(3)})`,
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 999,
          backgroundColor: active ? PALETTE.nerve : PALETTE.tealSoft,
          color: PALETTE.navy,
          border: `3px solid ${PALETTE.navy}`,
          fontFamily: THAI_FONT_FAMILY,
          fontWeight: 800,
          fontSize: 26,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {stepNum}
      </div>
      <span
        style={{
          fontFamily: THAI_FONT_FAMILY,
          fontWeight: 700,
          fontSize: 27,
          lineHeight: 1.4,
          paddingTop: 4,
          paddingBottom: 4,
        }}
      >
        {label}
      </span>
    </div>
  );
};

// ============================================================================
// WORD BOUNDARY TRIGGER HELPER (Scene 3 Checklist Sync)
// ============================================================================

function computeSignTriggerFrames(
  scene: RootCanalTimelineScene,
  fps: number,
  renderStartFrame: number,
  renderDur: number,
): number[] {
  const keywords = ['ปวด', 'เสียว', 'เคี้ยว', 'เหงือก', 'หนอง', 'สีคล้ำ'];
  const speechStart = scene.speechStartSec ?? scene.startSec ?? renderStartFrame / fps;
  const speechDur = scene.speechDurSec ?? Math.max(4, (renderDur - 30) / fps);
  const boundaries = scene.wordBoundaries ?? [];

  const triggers: number[] = [];

  for (let i = 0; i < keywords.length; i += 1) {
    const kw = keywords[i];
    let matchedLocal: number | null = null;

    for (const b of boundaries) {
      if (b.text && b.text.includes(kw)) {
        const rawOff =
          typeof b.offsetSec === 'number'
            ? b.offsetSec
            : typeof b.offset === 'number'
              ? b.offset > 10_000
                ? b.offset / 10_000_000
                : b.offset
              : 0;
        const globalFrame = Math.round((speechStart + rawOff) * fps);
        matchedLocal = Math.max(8, globalFrame - renderStartFrame);
        break;
      }
    }

    if (matchedLocal !== null) {
      triggers.push(matchedLocal);
    } else {
      // Proportional fallback synchronized to speech duration
      const frac = 0.12 + (i / keywords.length) * 0.74;
      const globalFrame = Math.round((speechStart + frac * speechDur) * fps);
      triggers.push(Math.max(10 + i * 10, globalFrame - renderStartFrame));
    }
  }

  return triggers;
}

// ============================================================================
// 8 SCENE IMPLEMENTATIONS
// ============================================================================

const Scene1Hook: React.FC<{ frame: number; fps: number; durationFrames: number }> = ({
  frame,
  fps,
  durationFrames,
}) => {
  const toothPop = spring({
    frame: Math.max(0, frame - 4),
    fps,
    config: { damping: 12, stiffness: 170, mass: 0.75 },
  });
  const lateHope = frame >= durationFrames * 0.68;
  const hopePop = spring({
    frame: Math.max(0, frame - Math.round(durationFrames * 0.66)),
    fps,
    config: { damping: 13, stiffness: 200, mass: 0.65 },
  });
  const boltPulse = 0.9 + Math.sin(frame * 0.35) * 0.14;

  return (
    <div
      style={{
        position: 'absolute',
        top: 472,
        left: 54,
        right: 54,
        bottom: 432,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Night-time flat window backdrop card */}
      <div
        style={{
          position: 'relative',
          width: 860,
          height: 670,
          backgroundColor: PALETTE.white,
          borderRadius: 40,
          border: `4px solid ${PALETTE.navy}`,
          boxShadow: `12px 12px 0px ${PALETTE.hardShadow}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {/* Flat night window on top-left corner */}
        <svg
          width="210"
          height="190"
          viewBox="0 0 210 190"
          style={{ position: 'absolute', top: 34, left: 36 }}
        >
          <rect x="6" y="6" width="198" height="178" rx="22" fill={PALETTE.navy} stroke={PALETTE.navy} strokeWidth="4" />
          <path d="M 80 42 A 28 28 0 1 0 110 82 A 22 22 0 1 1 80 42 Z" fill={PALETTE.nerve} />
          <circle cx="156" cy="54" r="5" fill={PALETTE.white} />
          <circle cx="140" cy="96" r="4" fill={PALETTE.nerve} />
          <circle cx="52" cy="126" r="4.5" fill={PALETTE.white} />
          {/* Window cross muntins */}
          <line x1="105" y1="6" x2="105" y2="184" stroke={PALETTE.tealSoft} strokeWidth="6" />
          <line x1="6" y1="95" x2="204" y2="95" stroke={PALETTE.tealSoft} strokeWidth="6" />
          <rect x="6" y="6" width="198" height="178" rx="22" fill="none" stroke={PALETTE.navy} strokeWidth="6" />
        </svg>

        {/* Hot & Cold sensitivity badge top-right */}
        <div
          style={{
            position: 'absolute',
            top: 44,
            right: 36,
            display: 'flex',
            gap: 12,
            transform: `scale(${spring({
              frame: Math.max(0, frame - 32),
              fps,
              config: { damping: 13, stiffness: 200 },
            }).toFixed(3)})`,
          }}
        >
          <div
            style={{
              backgroundColor: PALETTE.alertSoft,
              border: `3px solid ${PALETTE.navy}`,
              boxShadow: `4px 4px 0px ${PALETTE.alert}`,
              borderRadius: 18,
              padding: '8px 18px',
              fontFamily: THAI_FONT_FAMILY,
              fontWeight: 700,
              fontSize: 24,
              lineHeight: 1.4,
              color: PALETTE.alert,
            }}
          >
            ร้อน / เย็น เสียวแปล๊บ!
          </div>
        </div>

        {/* Pain lightning bolts radiating around ToothBuddy */}
        {!lateHope && (
          <svg
            width="640"
            height="460"
            viewBox="0 0 640 460"
            style={{ position: 'absolute', pointerEvents: 'none' }}
          >
            <g transform={`translate(110, 150) scale(${boltPulse.toFixed(3)})`}>
              <polygon
                points="20,0 56,36 32,42 64,84 14,48 36,42"
                fill={PALETTE.alert}
                stroke={PALETTE.navy}
                strokeWidth="3"
              />
            </g>
            <g transform={`translate(470, 140) scale(${boltPulse.toFixed(3)})`}>
              <polygon
                points="48,0 12,38 36,44 6,86 56,48 34,42"
                fill={PALETTE.alert}
                stroke={PALETTE.navy}
                strokeWidth="3"
              />
            </g>
            <g transform={`translate(496, 286) scale(${(1.06 - (boltPulse - 0.9)).toFixed(3)})`}>
              <polygon
                points="0,24 38,6 30,26 62,16 24,46 32,26"
                fill={PALETTE.nerve}
                stroke={PALETTE.navy}
                strokeWidth="3"
              />
            </g>
          </svg>
        )}

        {/* Hero ToothBuddy */}
        <div
          style={{
            marginTop: 58,
            transform: `scale(${interpolate(toothPop, [0, 1], [0.65, 1]).toFixed(4)})`,
          }}
        >
          <ToothBuddy mood={lateHope ? 'ok' : 'pain'} frame={frame} scale={1.42} />
        </div>

        {/* Hopeful teal shield banner popping in at end of hook */}
        {lateHope && (
          <div
            style={{
              position: 'absolute',
              bottom: 30,
              backgroundColor: PALETTE.teal,
              color: PALETTE.white,
              borderRadius: 999,
              border: `3.5px solid ${PALETTE.navy}`,
              boxShadow: `6px 6px 0px ${PALETTE.navy}`,
              padding: '10px 30px',
              fontFamily: THAI_FONT_FAMILY,
              fontWeight: 700,
              fontSize: 30,
              lineHeight: 1.4,
              transform: `scale(${interpolate(hopePop, [0, 1], [0.7, 1]).toFixed(3)})`,
            }}
          >
            ช่วยเก็บฟันแท้ซี่เดิมไว้ได้!
          </div>
        )}
      </div>
    </div>
  );
};

const Scene2What: React.FC<{ frame: number; fps: number; durationFrames: number }> = ({
  frame,
  fps,
  durationFrames,
}) => {
  // Exploded spring reveal early, then gently settles as germs invade down the root canals
  const explodeIn = spring({
    frame: Math.max(0, frame - 8),
    fps,
    config: { damping: 14, stiffness: 150, mass: 0.8 },
  });
  const explodeBack = interpolate(
    frame,
    [Math.round(durationFrames * 0.42), Math.round(durationFrames * 0.56)],
    [1, 0.25],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) },
  );
  const explodeVal = explodeIn * explodeBack;

  const infection = interpolate(
    frame,
    [Math.round(durationFrames * 0.34), Math.round(durationFrames * 0.86)],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) },
  );

  const l1 = spring({ frame: Math.max(0, frame - 18), fps, config: { damping: 14, stiffness: 200 } });
  const l2 = spring({
    frame: Math.max(0, frame - Math.round(durationFrames * 0.32)),
    fps,
    config: { damping: 14, stiffness: 200 },
  });
  const l3 = spring({
    frame: Math.max(0, frame - Math.round(durationFrames * 0.62)),
    fps,
    config: { damping: 14, stiffness: 200 },
  });

  return (
    <div
      style={{
        position: 'absolute',
        top: 472,
        left: 44,
        right: 44,
        bottom: 432,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Flat clinical illustration frame */}
      <div
        style={{
          position: 'relative',
          width: 960,
          height: 730,
          backgroundColor: PALETTE.white,
          borderRadius: 38,
          border: `4px solid ${PALETTE.navy}`,
          boxShadow: `12px 12px 0px ${PALETTE.hardShadow}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ToothCrossSection
          infection={infection}
          cleaned={0}
          filled={0}
          crown={0}
          explode={explodeVal}
          frame={frame}
          scale={1.14}
          labels={[
            { part: 'pulp', text: 'โพรงประสาท', side: 'left', appearProgress: l1 },
            { part: 'canals', text: 'คลองรากฟัน', side: 'right', appearProgress: l2 },
            { part: 'pus', text: 'หนองปลายราก', side: 'left', appearProgress: l3 },
          ]}
        />

        {/* Mini floating germs hovering near top decay */}
        {infection > 0.12 && (
          <div style={{ position: 'absolute', top: 36, right: 54 }}>
            <Germ seed="s2-hover-a" frame={frame} size={62} />
          </div>
        )}
        {infection > 0.35 && (
          <div style={{ position: 'absolute', top: 56, left: 58 }}>
            <Germ seed="s2-hover-b" frame={frame} size={52} />
          </div>
        )}
      </div>
    </div>
  );
};

const Scene3Signs: React.FC<{
  scene: RootCanalTimelineScene;
  frame: number;
  fps: number;
  renderStartFrame: number;
  durationFrames: number;
}> = ({ scene, frame, fps, renderStartFrame, durationFrames }) => {
  const triggerFrames = computeSignTriggerFrames(scene, fps, renderStartFrame, durationFrames);

  return (
    <div
      style={{
        position: 'absolute',
        top: 472,
        left: 52,
        right: 52,
        bottom: 435,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* 2 x 3 Flat Cartoon Checklist Grid */}
      <div
        style={{
          width: 966,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 22,
        }}
      >
        {DEFAULT_SIGN_ITEMS.slice(0, 6).map((item, idx) => {
          const trig = triggerFrames[idx] ?? 12 + idx * 24;
          const nextTrig = triggerFrames[idx + 1] ?? durationFrames;
          const pop = spring({
            frame: Math.max(0, frame - trig),
            fps,
            config: { damping: 12, stiffness: 210, mass: 0.65 },
          });
          const appeared = frame >= trig;
          const isCurrent = frame >= trig && frame < nextTrig;

          return (
            <div
              key={item.icon}
              style={{
                position: 'relative',
                backgroundColor: isCurrent ? '#FFF6F7' : PALETTE.white,
                borderRadius: 28,
                border: `4px solid ${isCurrent ? PALETTE.alert : PALETTE.navy}`,
                boxShadow: `8px 8px 0px ${isCurrent ? PALETTE.alert : PALETTE.hardShadow}`,
                padding: '20px 18px 18px 18px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                minHeight: 242,
                transform: `scale(${
                  appeared
                    ? interpolate(pop, [0, 1], [0.72, isCurrent ? 1.03 : 1]).toFixed(4)
                    : '0.86'
                })`,
                opacity: appeared ? interpolate(pop, [0, 0.3], [0, 1], { extrapolateRight: 'clamp' }) : 0.16,
              }}
            >
              {/* Number badge */}
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  left: 14,
                  width: 38,
                  height: 38,
                  borderRadius: 999,
                  backgroundColor: isCurrent ? PALETTE.alert : PALETTE.navy,
                  color: PALETTE.white,
                  fontFamily: THAI_FONT_FAMILY,
                  fontWeight: 700,
                  fontSize: 20,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {idx + 1}
              </div>

              {/* Alert check tick */}
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 14,
                  width: 34,
                  height: 34,
                  borderRadius: 999,
                  backgroundColor: PALETTE.alert,
                  color: PALETTE.white,
                  fontWeight: 800,
                  fontSize: 21,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: `2.5px solid ${PALETTE.navy}`,
                }}
              >
                !
              </div>

              <SignIcon icon={item.icon} frame={frame} size={104} />

              <div
                style={{
                  fontFamily: THAI_FONT_FAMILY,
                  fontWeight: 700,
                  fontSize: 28,
                  lineHeight: 1.4,
                  color: PALETTE.navy,
                  textAlign: 'center',
                  paddingTop: 6,
                  paddingBottom: 6,
                  paddingLeft: 6,
                  paddingRight: 6,
                }}
              >
                {item.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Scene4Step12: React.FC<{ frame: number; fps: number; durationFrames: number }> = ({
  frame,
  fps,
  durationFrames,
}) => {
  const step2Start = Math.round(durationFrames * 0.56);
  const syringeStart = Math.round(durationFrames * 0.24);
  const damStart = Math.round(durationFrames * 0.4);

  const dentistPop = spring({ frame: Math.max(0, frame - 4), fps, config: { damping: 14, stiffness: 170 } });
  const xrayPop = spring({ frame: Math.max(0, frame - 10), fps, config: { damping: 13, stiffness: 190 } });
  const syrPop = spring({ frame: Math.max(0, frame - syringeStart), fps, config: { damping: 13, stiffness: 200 } });
  const damPop = spring({ frame: Math.max(0, frame - damStart), fps, config: { damping: 13, stiffness: 200 } });
  const drillPop = spring({ frame: Math.max(0, frame - step2Start), fps, config: { damping: 13, stiffness: 200 } });

  const isStep2 = frame >= step2Start;

  return (
    <div
      style={{
        position: 'absolute',
        top: 472,
        left: 52,
        right: 52,
        bottom: 432,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
      }}
    >
      {/* Top Step Pills: 1 & 2 */}
      <div style={{ display: 'flex', gap: 18, justifyContent: 'center', width: '100%' }}>
        <StepPill
          stepNum="1"
          label="ตรวจ เอกซเรย์ & ยาชา"
          active={!isStep2}
          frame={frame}
          fps={fps}
          startFrame={6}
        />
        <StepPill
          stepNum="2"
          label="เปิดทางเข้าโพรงฟัน"
          active={isStep2}
          frame={frame}
          fps={fps}
          startFrame={step2Start - 4}
        />
      </div>

      {/* Upper Stage: Dentist + X-Ray Card */}
      <div
        style={{
          width: 956,
          backgroundColor: PALETTE.white,
          borderRadius: 34,
          border: `4px solid ${PALETTE.navy}`,
          boxShadow: `10px 10px 0px ${PALETTE.hardShadow}`,
          padding: '18px 34px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-around',
        }}
      >
        <div
          style={{
            transform: `translate3d(${interpolate(dentistPop, [0, 1], [-40, 0]).toFixed(1)}px, 0, 0)`,
          }}
        >
          <DentistCartoon frame={frame} pose="holdXray" scale={0.88} />
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            transform: `scale(${interpolate(xrayPop, [0, 1], [0.78, 1]).toFixed(3)})`,
          }}
        >
          <XrayCard frame={frame} scale={1.0} />
          <div
            style={{
              backgroundColor: PALETTE.tealSoft,
              border: `3px solid ${PALETTE.navy}`,
              borderRadius: 999,
              padding: '6px 22px',
              fontFamily: THAI_FONT_FAMILY,
              fontWeight: 700,
              fontSize: 24,
              lineHeight: 1.4,
              color: PALETTE.navy,
            }}
          >
            ตรวจเช็กรากฟันด้วยเอกซเรย์
          </div>
        </div>
      </div>

      {/* Lower Row: 3 Mini Flat Procedure Cards (Anesthesia, Rubber Dam, Access Opening) */}
      <div
        style={{
          width: 956,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 18,
        }}
      >
        {/* Card A: Anesthesia */}
        <div
          style={{
            backgroundColor: PALETTE.white,
            borderRadius: 24,
            border: `3.5px solid ${PALETTE.navy}`,
            boxShadow: `6px 6px 0px ${PALETTE.hardShadow}`,
            padding: '16px 14px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            transform: `scale(${interpolate(syrPop, [0, 1], [0.75, 1]).toFixed(3)})`,
            opacity: frame >= syringeStart ? interpolate(syrPop, [0, 0.3], [0, 1], { extrapolateRight: 'clamp' }) : 0.2,
          }}
        >
          <svg width="110" height="92" viewBox="0 0 110 92">
            {/* Cute flat syringe */}
            <g transform="rotate(-24 55 46)">
              <rect x="26" y="34" width="52" height="22" rx="6" fill={PALETTE.tealSoft} stroke={PALETTE.navy} strokeWidth="3" />
              <rect x="38" y="37" width="26" height="16" rx="3" fill={PALETTE.teal} />
              <rect x="12" y="42" width="16" height="6" rx="2" fill={PALETTE.navy} />
              <rect x="8" y="34" width="6" height="22" rx="3" fill={PALETTE.navy} />
              <line x1="78" y1="45" x2="100" y2="45" stroke={PALETTE.navy} strokeWidth="3.5" strokeLinecap="round" />
            </g>
            {/* Soothing sparkle */}
            <path d="M 88 18 L 91 25 L 98 28 L 91 31 L 88 38 L 85 31 L 78 28 L 85 25 Z" fill={PALETTE.nerve} />
          </svg>
          <div
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontWeight: 700,
              fontSize: 25,
              lineHeight: 1.4,
              color: PALETTE.navy,
              textAlign: 'center',
              paddingTop: 4,
              paddingBottom: 4,
            }}
          >
            ฉีดยาชาให้สบาย
          </div>
        </div>

        {/* Card B: Rubber Dam */}
        <div
          style={{
            backgroundColor: PALETTE.white,
            borderRadius: 24,
            border: `3.5px solid ${PALETTE.navy}`,
            boxShadow: `6px 6px 0px ${PALETTE.hardShadow}`,
            padding: '16px 14px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            transform: `scale(${interpolate(damPop, [0, 1], [0.75, 1]).toFixed(3)})`,
            opacity: frame >= damStart ? interpolate(damPop, [0, 0.3], [0, 1], { extrapolateRight: 'clamp' }) : 0.2,
          }}
        >
          <svg width="110" height="92" viewBox="0 0 110 92">
            {/* Rubber dam teal sheet + metallic U-frame */}
            <rect x="16" y="10" width="78" height="72" rx="12" fill={PALETTE.teal} stroke={PALETTE.navy} strokeWidth="3" />
            <path d="M 22 14 L 22 76 L 88 76 L 88 14" fill="none" stroke={PALETTE.crown} strokeWidth="5" strokeLinecap="round" />
            {/* Isolated clean tooth poking through */}
            <circle cx="55" cy="46" r="22" fill={PALETTE.tooth} stroke={PALETTE.navy} strokeWidth="3" />
            <circle cx="55" cy="46" r="24" fill="none" stroke={PALETTE.crownShadow} strokeWidth="4" strokeDasharray="10 6" />
          </svg>
          <div
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontWeight: 700,
              fontSize: 24,
              lineHeight: 1.4,
              color: PALETTE.navy,
              textAlign: 'center',
              paddingTop: 4,
              paddingBottom: 4,
            }}
          >
            แผ่นยางกันน้ำลาย
          </div>
        </div>

        {/* Card C: Step 2 Open Access */}
        <div
          style={{
            backgroundColor: isStep2 ? PALETTE.tealSoft : PALETTE.white,
            borderRadius: 24,
            border: `3.5px solid ${isStep2 ? PALETTE.teal : PALETTE.navy}`,
            boxShadow: `6px 6px 0px ${isStep2 ? PALETTE.teal : PALETTE.hardShadow}`,
            padding: '16px 14px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            transform: `scale(${interpolate(drillPop, [0, 1], [0.75, isStep2 ? 1.04 : 1]).toFixed(3)})`,
            opacity: frame >= step2Start ? interpolate(drillPop, [0, 0.3], [0, 1], { extrapolateRight: 'clamp' }) : 0.2,
          }}
        >
          <svg width="110" height="92" viewBox="0 0 110 92">
            {/* Tooth top */}
            <path
              d="M 26 44 C 36 32, 48 36, 55 40 C 62 36, 74 32, 84 44 C 90 56, 86 78, 78 86 L 32 86 C 24 78, 20 56, 26 44 Z"
              fill={PALETTE.tooth}
              stroke={PALETTE.navy}
              strokeWidth="3"
            />
            {/* Clean opened channel */}
            <rect x="46" y="38" width="18" height="36" rx="8" fill={PALETTE.pulp} stroke={PALETTE.navy} strokeWidth="2.5" />
            {/* Tiny dental handpiece hovering gently */}
            <g transform={`translate(0, ${(Math.sin(frame * 0.4) * 3).toFixed(1)})`}>
              <rect x="49" y="10" width="12" height="16" rx="4" fill={PALETTE.crownShadow} stroke={PALETTE.navy} strokeWidth="2.5" />
              <line x1="55" y1="26" x2="55" y2="44" stroke={PALETTE.navy} strokeWidth="3.5" strokeLinecap="round" />
            </g>
          </svg>
          <div
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontWeight: 700,
              fontSize: 24,
              lineHeight: 1.4,
              color: PALETTE.navy,
              textAlign: 'center',
              paddingTop: 4,
              paddingBottom: 4,
            }}
          >
            กรอเปิดโพรงฟัน
          </div>
        </div>
      </div>
    </div>
  );
};

const Scene5Step34: React.FC<{ frame: number; fps: number; durationFrames: number }> = ({
  frame,
  fps,
  durationFrames,
}) => {
  const step4Start = Math.round(durationFrames * 0.64);
  const cleaned = interpolate(frame, [14, step4Start], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
  const tempCap = interpolate(frame, [step4Start, step4Start + 24], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const visitsPop = spring({
    frame: Math.max(0, frame - (step4Start + 6)),
    fps,
    config: { damping: 12, stiffness: 200, mass: 0.65 },
  });
  const isStep4 = frame >= step4Start;

  return (
    <div
      style={{
        position: 'absolute',
        top: 472,
        left: 52,
        right: 52,
        bottom: 432,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
      }}
    >
      {/* Top Step Pills: 3 & 4 */}
      <div style={{ display: 'flex', gap: 18, justifyContent: 'center', width: '100%' }}>
        <StepPill
          stepNum="3"
          label="ตะไบ & ล้างคลองราก"
          active={!isStep4}
          frame={frame}
          fps={fps}
          startFrame={4}
        />
        <StepPill
          stepNum="4"
          label="ใส่ยา ปิดชั่วคราว"
          active={isStep4}
          frame={frame}
          fps={fps}
          startFrame={step4Start - 4}
        />
      </div>

      {/* Main Cutaway Cleaning Stage */}
      <div
        style={{
          position: 'relative',
          width: 956,
          height: 645,
          backgroundColor: PALETTE.white,
          borderRadius: 36,
          border: `4px solid ${PALETTE.navy}`,
          boxShadow: `12px 12px 0px ${PALETTE.hardShadow}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ToothCrossSection
          infection={1}
          cleaned={cleaned}
          filled={0}
          crown={0}
          explode={0}
          frame={frame}
          showFile={!isStep4}
          showTempCap={tempCap}
          scale={1.08}
          labels={[
            {
              part: 'canals',
              text: isStep4 ? 'คลองรากสะอาดแล้ว' : 'น้ำยาฆ่าเชื้อล้างราก',
              side: 'right',
              appearProgress: spring({ frame: Math.max(0, frame - 22), fps, config: { damping: 14, stiffness: 190 } }),
            },
          ]}
        />

        {/* Progress Clean Meter Pill (top-left inside frame) */}
        <div
          style={{
            position: 'absolute',
            top: 28,
            left: 30,
            backgroundColor: PALETTE.tealSoft,
            border: `3px solid ${PALETTE.navy}`,
            borderRadius: 20,
            padding: '10px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            width: 268,
          }}
        >
          <span
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontWeight: 700,
              fontSize: 22,
              lineHeight: 1.38,
              color: PALETTE.navy,
              whiteSpace: 'nowrap',
            }}
          >
            ความสะอาดคลองราก
          </span>
          <div
            style={{
              width: '100%',
              height: 16,
              borderRadius: 999,
              backgroundColor: PALETTE.white,
              border: `2.5px solid ${PALETTE.navy}`,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.round(cleaned * 100)}%`,
                height: '100%',
                backgroundColor: PALETTE.teal,
              }}
            />
          </div>
        </div>

        {/* 1-3 Visits Badge (bottom-right inside frame) */}
        <div
          style={{
            position: 'absolute',
            bottom: 28,
            right: 30,
            backgroundColor: PALETTE.nerve,
            color: PALETTE.navy,
            borderRadius: 24,
            border: `3.5px solid ${PALETTE.navy}`,
            boxShadow: `6px 6px 0px ${PALETTE.navy}`,
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            transform: `scale(${interpolate(visitsPop, [0, 1], [0.6, 1]).toFixed(3)})`,
            opacity: isStep4 ? 1 : 0,
          }}
        >
          <svg width="36" height="36" viewBox="0 0 36 36">
            <rect x="3" y="6" width="30" height="27" rx="6" fill={PALETTE.white} stroke={PALETTE.navy} strokeWidth="2.5" />
            <rect x="3" y="6" width="30" height="10" rx="5" fill={PALETTE.teal} stroke={PALETTE.navy} strokeWidth="2.5" />
            <path d="M 11 23 L 16 28 L 25 19" fill="none" stroke={PALETTE.navy} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontWeight: 800,
              fontSize: 29,
              lineHeight: 1.38,
              paddingTop: 4,
              paddingBottom: 4,
            }}
          >
            ปกติ 1–3 ครั้ง
          </span>
        </div>
      </div>
    </div>
  );
};

const Scene6Step56: React.FC<{ frame: number; fps: number; durationFrames: number }> = ({
  frame,
  fps,
  durationFrames,
}) => {
  const step6Start = Math.round(durationFrames * 0.48);

  // Orange gutta-percha fills smoothly bottom-to-top in first half
  const filled = interpolate(frame, [14, step6Start - 6], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  // Dental crown drops cleanly onto tooth with spring in second half
  const crownSpring = spring({
    frame: Math.max(0, frame - step6Start),
    fps,
    config: { damping: 12, stiffness: 150, mass: 0.9 },
  });
  const crown = frame >= step6Start ? crownSpring : 0;

  const guttaLbl = spring({
    frame: Math.max(0, frame - 24),
    fps,
    config: { damping: 14, stiffness: 200 },
  });
  const crownLbl = spring({
    frame: Math.max(0, frame - (step6Start + 10)),
    fps,
    config: { damping: 14, stiffness: 200 },
  });
  const tipPop = spring({
    frame: Math.max(0, frame - (step6Start + 22)),
    fps,
    config: { damping: 13, stiffness: 190 },
  });

  const isStep6 = frame >= step6Start;

  return (
    <div
      style={{
        position: 'absolute',
        top: 472,
        left: 52,
        right: 52,
        bottom: 432,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
      }}
    >
      {/* Top Step Pills: 5 & 6 */}
      <div style={{ display: 'flex', gap: 18, justifyContent: 'center', width: '100%' }}>
        <StepPill
          stepNum="5"
          label="อุดกัตตาเปอร์ชา"
          active={!isStep6}
          frame={frame}
          fps={fps}
          startFrame={4}
        />
        <StepPill
          stepNum="6"
          label="บูรณะ & ครอบฟัน"
          active={isStep6}
          frame={frame}
          fps={fps}
          startFrame={step6Start - 4}
        />
      </div>

      {/* Main Cutaway Fill + Crown Stage */}
      <div
        style={{
          position: 'relative',
          width: 956,
          height: 645,
          backgroundColor: PALETTE.white,
          borderRadius: 36,
          border: `4px solid ${PALETTE.navy}`,
          boxShadow: `12px 12px 0px ${PALETTE.hardShadow}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ToothCrossSection
          infection={0}
          cleaned={1}
          filled={filled}
          crown={crown}
          explode={0}
          frame={frame}
          scale={1.08}
          labels={[
            { part: 'gutta', text: 'กัตตาเปอร์ชา', side: 'right', appearProgress: guttaLbl },
            { part: 'crown', text: 'ครอบฟันแข็งแรง', side: 'left', appearProgress: isStep6 ? crownLbl : 0 },
          ]}
        />

        {/* Back-tooth fragility tip card */}
        <div
          style={{
            position: 'absolute',
            bottom: 24,
            left: 28,
            backgroundColor: PALETTE.tealSoft,
            borderRadius: 20,
            border: `3px solid ${PALETTE.navy}`,
            boxShadow: `5px 5px 0px ${PALETTE.teal}`,
            padding: '10px 20px',
            fontFamily: THAI_FONT_FAMILY,
            fontWeight: 700,
            fontSize: 23,
            lineHeight: 1.4,
            color: PALETTE.navy,
            transform: `scale(${interpolate(tipPop, [0, 1], [0.75, 1]).toFixed(3)})`,
            opacity: frame >= step6Start + 20 ? 1 : 0,
          }}
        >
          ฟันหลังควรทำครอบ ป้องกันฟันแตก
        </div>
      </div>
    </div>
  );
};

const Scene7ProsCons: React.FC<{ frame: number; fps: number; durationFrames: number }> = ({
  frame,
  fps,
  durationFrames,
}) => {
  return (
    <div
      style={{
        position: 'absolute',
        top: 472,
        left: 50,
        right: 50,
        bottom: 432,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <VersusBoard
        pros={DEFAULT_PROCON_ITEMS.pros}
        cons={DEFAULT_PROCON_ITEMS.cons}
        frame={frame}
        fps={fps}
        durationFrames={durationFrames}
      />
    </div>
  );
};

const Scene8CareCta: React.FC<{ frame: number; fps: number; durationFrames: number }> = ({
  frame,
  fps,
  durationFrames,
}) => {
  const charPop = spring({ frame: Math.max(0, frame - 4), fps, config: { damping: 13, stiffness: 170 } });
  const ctaStart = Math.round(durationFrames * 0.45);
  const ctaPop = spring({ frame: Math.max(0, frame - ctaStart), fps, config: { damping: 12, stiffness: 195 } });

  const tips = [
    { num: '1', text: 'เลี่ยงเคี้ยวของแข็งจนกว่าจะครอบเสร็จ', delay: 12 },
    { num: '2', text: 'แปรงฟันและใช้ไหมขัดฟันทุกวัน', delay: 34 },
    { num: '3', text: 'ไปพบทันตแพทย์ตามนัดสม่ำเสมอ', delay: 56 },
  ];

  return (
    <div
      style={{
        position: 'absolute',
        top: 472,
        left: 52,
        right: 52,
        bottom: 436,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
      }}
    >
      {/* Happy Crowned ToothBuddy + Waving DentistCartoon */}
      <div
        style={{
          width: 956,
          backgroundColor: PALETTE.white,
          borderRadius: 34,
          border: `4px solid ${PALETTE.navy}`,
          boxShadow: `10px 10px 0px ${PALETTE.hardShadow}`,
          padding: '14px 36px',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-evenly',
          transform: `scale(${interpolate(charPop, [0, 1], [0.85, 1]).toFixed(3)})`,
        }}
      >
        <ToothBuddy mood="happy" crowned thumbsUp frame={frame} scale={0.94} />
        <DentistCartoon frame={frame} pose="wave" scale={0.82} />
      </div>

      {/* 3 Aftercare Tips */}
      <div style={{ width: 956, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {tips.map((tip) => {
          const p = spring({
            frame: Math.max(0, frame - tip.delay),
            fps,
            config: { damping: 14, stiffness: 200 },
          });
          return (
            <div
              key={tip.num}
              style={{
                backgroundColor: PALETTE.white,
                borderRadius: 20,
                border: `3px solid ${PALETTE.navy}`,
                boxShadow: `6px 6px 0px ${PALETTE.hardShadow}`,
                padding: '10px 22px',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                transform: `translate3d(${interpolate(p, [0, 1], [-28, 0]).toFixed(1)}px, 0, 0)`,
                opacity: interpolate(p, [0, 0.35], [0, 1], { extrapolateRight: 'clamp' }),
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 999,
                  backgroundColor: PALETTE.teal,
                  color: PALETTE.white,
                  border: `2.5px solid ${PALETTE.navy}`,
                  fontFamily: THAI_FONT_FAMILY,
                  fontWeight: 800,
                  fontSize: 22,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                ✓
              </div>
              <span
                style={{
                  fontFamily: THAI_FONT_FAMILY,
                  fontWeight: 700,
                  fontSize: 28,
                  lineHeight: 1.4,
                  color: PALETTE.navy,
                  paddingTop: 4,
                  paddingBottom: 4,
                }}
              >
                {tip.text}
              </span>
            </div>
          );
        })}
      </div>

      {/* CTA Banner + Prominent Medical Disclaimer */}
      <div
        style={{
          width: 956,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          transform: `scale(${interpolate(ctaPop, [0, 1], [0.85, 1]).toFixed(3)})`,
          opacity: frame >= ctaStart ? 1 : 0.2,
        }}
      >
        <div
          style={{
            width: '100%',
            backgroundColor: PALETTE.teal,
            color: PALETTE.white,
            borderRadius: 24,
            border: `4px solid ${PALETTE.navy}`,
            boxShadow: `8px 8px 0px ${PALETTE.navy}`,
            padding: '14px 26px',
            textAlign: 'center',
            fontFamily: THAI_FONT_FAMILY,
            fontWeight: 700,
            fontSize: 33,
            lineHeight: 1.42,
          }}
        >
          ปวดฟันอย่ารอ ยิ่งรักษาเร็วยิ่งเก็บฟันได้!
        </div>

        <div
          style={{
            backgroundColor: PALETTE.tooth,
            color: PALETTE.navy,
            borderRadius: 999,
            border: `2.5px solid ${PALETTE.navy}`,
            padding: '8px 28px',
            fontFamily: THAI_FONT_FAMILY,
            fontWeight: 700,
            fontSize: 23,
            lineHeight: 1.4,
            textAlign: 'center',
          }}
        >
          {DISCLAIMER_TEXT}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// SCENE WRAPPER WITH TRANSITION + CAMERA RIG
// ============================================================================

const SCENE_TRANSITIONS: Record<string, TransitionKind> = {
  s1_hook: 'zoomThrough',
  s2_what: 'iris',
  s3_signs: 'zoomThrough',
  s4_step12: 'iris',
  s5_step34: 'zoomThrough',
  s6_step56: 'iris',
  s7_proscons: 'zoomThrough',
  s8_care_cta: 'iris',
};

const RootCanalSceneWrapper: React.FC<{
  scene: RootCanalTimelineScene;
  renderStartFrame: number;
  renderDuration: number;
  isFirst: boolean;
  isLast: boolean;
}> = ({ scene, renderStartFrame, renderDuration, isFirst, isLast }) => {
  const localFrame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fallbackMeta = SCRIPT_SCENE_BY_ID[scene.id];
  const badge = scene.badge || fallbackMeta?.badge || '';
  const title = scene.title || fallbackMeta?.title || '';
  const subtitle = scene.subtitle || fallbackMeta?.subtitle || '';

  const transitionKind: TransitionKind = SCENE_TRANSITIONS[scene.id] ?? 'zoomThrough';
  const tStyle = transitionStyle(localFrame, renderDuration, transitionKind, fps, {
    inFrames: 12,
    outFrames: 12,
    skipIn: isFirst,
    skipOut: isLast,
  });

  const isWarning = scene.id === 's1_hook' || scene.id === 's3_signs';

  const renderSceneBody = () => {
    switch (scene.id) {
      case 's1_hook':
        return <Scene1Hook frame={localFrame} fps={fps} durationFrames={renderDuration} />;
      case 's2_what':
        return <Scene2What frame={localFrame} fps={fps} durationFrames={renderDuration} />;
      case 's3_signs':
        return (
          <Scene3Signs
            scene={scene}
            frame={localFrame}
            fps={fps}
            renderStartFrame={renderStartFrame}
            durationFrames={renderDuration}
          />
        );
      case 's4_step12':
        return <Scene4Step12 frame={localFrame} fps={fps} durationFrames={renderDuration} />;
      case 's5_step34':
        return <Scene5Step34 frame={localFrame} fps={fps} durationFrames={renderDuration} />;
      case 's6_step56':
        return <Scene6Step56 frame={localFrame} fps={fps} durationFrames={renderDuration} />;
      case 's7_proscons':
        return <Scene7ProsCons frame={localFrame} fps={fps} durationFrames={renderDuration} />;
      case 's8_care_cta':
      default:
        return <Scene8CareCta frame={localFrame} fps={fps} durationFrames={renderDuration} />;
    }
  };

  return (
    <AbsoluteFill style={{ ...tStyle }}>
      {/* SceneHeader stays anchored cleanly below top disclaimer inside safe zone */}
      <SceneHeader
        badge={badge}
        title={title}
        subtitle={subtitle}
        isWarning={isWarning}
        frame={localFrame}
        fps={fps}
      />
      {/* Gentle continuous CameraRig push-in (1.0 -> 1.055) on main illustration stage */}
      <CameraRig
        zoomFrom={1.0}
        zoomTo={1.055}
        panY={[6, -6]}
        durationFrames={renderDuration}
        origin="50% 54%"
      >
        {renderSceneBody()}
      </CameraRig>
    </AbsoluteFill>
  );
};

// ============================================================================
// MAIN COMPOSITION
// ============================================================================

export const RootCanalExplainer: React.FC<RootCanalExplainerProps> = (props) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const scenes = props.scenes?.length ? props.scenes : DEFAULT_ROOT_CANAL_PROPS.scenes;
  const allCues = props.cues?.length ? props.cues : DEFAULT_ROOT_CANAL_PROPS.cues;
  const totalFrames = Math.max(90, props.totalFrames || durationInFrames);

  const cutFrames = scenes.slice(0, -1).map((s) => s.endFrame);
  const activeScene =
    scenes.find((s) => frame >= s.startFrame && frame < s.endFrame) ?? scenes[scenes.length - 1];

  return (
    <AbsoluteFill style={{ backgroundColor: PALETTE.bgTop, overflow: 'hidden' }}>
      <ThaiFontLoader />

      {/* Layer 1: Flat Clinical Mint Backdrop */}
      <ClinicBackdrop frame={frame} />

      {/* Layer 2: Overlapping Scene Sequences (12-frame transitions) */}
      {scenes.map((sc, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === scenes.length - 1;
        const renderStart = isFirst ? sc.startFrame : Math.max(0, sc.startFrame - OVERLAP_HALF);
        const renderEnd = isLast
          ? Math.max(totalFrames, sc.endFrame)
          : Math.min(totalFrames, sc.endFrame + OVERLAP_HALF);
        const renderDur = Math.max(24, renderEnd - renderStart);

        return (
          <Sequence key={sc.id} from={renderStart} durationInFrames={renderDur}>
            <RootCanalSceneWrapper
              scene={sc}
              renderStartFrame={renderStart}
              renderDuration={renderDur}
              isFirst={isFirst}
              isLast={isLast}
            />
          </Sequence>
        );
      })}

      {/* Layer 3: Subtle Bright LightLeakFlash bridging cuts (low intensity 0.35) */}
      <LightLeakFlash
        at={cutFrames}
        durationFrames={16}
        color="#FFFFFF"
        secondaryColor="#BCE9E2"
        intensity={0.35}
      />

      {/* Layer 4: Persistent Top Medical Disclaimer Pill inside Safe Zone (top >= 150) */}
      <div
        style={{
          position: 'absolute',
          top: 150,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
          zIndex: 55,
        }}
      >
        <div
          style={{
            backgroundColor: 'rgba(255, 253, 246, 0.92)',
            color: PALETTE.navy,
            fontFamily: THAI_FONT_FAMILY,
            fontWeight: 700,
            fontSize: 19,
            lineHeight: 1.38,
            padding: '4px 18px',
            borderRadius: 999,
            border: `2px solid ${PALETTE.navy}`,
          }}
        >
          {DISCLAIMER_TEXT}
        </div>
      </div>

      {/* Layer 5: KaraokeSubtitle (theme 'light', bottomOffset 280 -> Safe Zone >= 260) */}
      <KaraokeSubtitle
        cues={allCues}
        wordBoundaries={activeScene?.wordBoundaries}
        sceneSpeechStartSec={activeScene?.speechStartSec ?? activeScene?.startSec ?? 0}
        accentColor={PALETTE.nerve}
        bottomOffset={280}
        theme="light"
      />
    </AbsoluteFill>
  );
};
