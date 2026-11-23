import React, { useId } from 'react';
import { Img, interpolate, spring, useVideoConfig } from 'remotion';
import { THAI_FONT_FAMILY } from '../components/ThaiFontLoader';
import { StudioVectorIcon } from './sceneVisuals';
import {
  computeTitleSize,
  FamilySceneRendererProps,
  renderHighlightedText,
  splitThaiWords,
} from './families';
import {
  SceneVisualType,
  StudioScene,
  StudioStepItem,
  normalizeSceneVisual,
} from './types';

// ============================================================================
// FLAT CARTOON (THE INFOGRAPHICS SHOW STYLE — PURE FLAT VECTOR SVG)
// ============================================================================

export type CartoonPose = 'present' | 'point' | 'shocked' | 'happy' | 'think';

interface CharacterPalette {
  name: string;
  skin: string;
  skinShade: string;
  hair: string;
  hairShade: string;
  hairHighlight: string;
  suit: string;
  suitShade: string;
  lapel: string;
  shirt: string;
  tie: string;
  pants: string;
  pantsShade: string;
  shoes: string;
  hairStyle: 'founder' | 'bob' | 'spiky';
  glasses?: boolean;
}

const CHARACTER_VARIANTS: readonly CharacterPalette[] = [
  {
    name: 'founder',
    skin: '#F7B797',
    skinShade: '#E59676',
    hair: '#322664',
    hairShade: '#211847',
    hairHighlight: '#5A4EA8',
    suit: '#4D4A91',
    suitShade: '#352A6E',
    lapel: '#625EAC',
    shirt: '#FFFFFF',
    tie: '#DF1690',
    pants: '#352A6E',
    pantsShade: '#261D54',
    shoes: '#2B2452',
    hairStyle: 'founder',
  },
  {
    name: 'strategist',
    skin: '#F5C4A1',
    skinShade: '#DFA079',
    hair: '#3E2723',
    hairShade: '#281815',
    hairHighlight: '#744F44',
    suit: '#1D8FA3',
    suitShade: '#146B7A',
    lapel: '#30ABD5',
    shirt: '#FFFDF5',
    tie: '#FF5C77',
    pants: '#2B2452',
    pantsShade: '#1E183D',
    shoes: '#1D183B',
    hairStyle: 'bob',
  },
  {
    name: 'analyst',
    skin: '#E8A882',
    skinShade: '#CF8963',
    hair: '#221E42',
    hairShade: '#15122B',
    hairHighlight: '#4E478C',
    suit: '#F29F05',
    suitShade: '#CC7D00',
    lapel: '#FFB830',
    shirt: '#FFFFFF',
    tie: '#30ABD5',
    pants: '#3B3873',
    pantsShade: '#2B2859',
    shoes: '#2B2452',
    hairStyle: 'spiky',
    glasses: true,
  },
];

const STICKY_COLORS = [
  { bg: '#FFF08A', fold: '#E6CF4C', tag: '#D97706' },
  { bg: '#FFC6E0', fold: '#E89AC0', tag: '#DF1690' },
  { bg: '#B7F4E8', fold: '#7CDCC9', tag: '#0F8A7B' },
  { bg: '#FFD6A5', fold: '#E6AE70', tag: '#D95D24' },
];

const OUTLINE = '#2B2452';
const CRASH_RED = '#F0384F';
const WALL_SHADOW = '#B4CAE0';
const FLOOR_SHADOW = '#1F87AD';

export function inferCartoonPose(scene: StudioScene, visual: SceneVisualType): CartoonPose {
  const blob = [
    scene.title,
    scene.subtitle || '',
    scene.narration || '',
    scene.badge || '',
    scene.stat?.delta || '',
    scene.stat?.label || '',
    scene.quote?.text || '',
  ].join(' ');

  if (
    /ตก|ลด|ดิ่ง|วิกฤต|พัง|ขาดทุน|ล้ม|หายนะ|อันตราย|เสี่ยง|พลาด|ช็อก|ผิดพลาด|crash|drop|crisis|fail|shock|down|loss|-\d+%/i.test(
      blob,
    )
  ) {
    return 'shocked';
  }
  if (
    /ขึ้น|พุ่ง|สำเร็จ|รวย|เติบโต|โตไว|ชนะ|ยอดเยี่ยม|กำไร|ปัง|เจ๋ง|สุข|ประหยัด|grow|win|success|profit|best|great|\+\d+%/i.test(
      blob,
    )
  ) {
    return 'happy';
  }
  if (
    /ทำไม|อะไร|ยังไง|อย่างไร|ถ้าหาก|สมมติ|คิด|สงสัย|ความลับ|เบื้องหลัง|why|how|what if|think|secret|\?/i.test(
      blob,
    )
  ) {
    return 'think';
  }
  if (visual === 'stat' || visual === 'steps' || visual === 'bullets') {
    return 'point';
  }
  return 'present';
}

function inferIconKeyword(scene: StudioScene): string {
  if (scene.icon && scene.icon.trim()) return scene.icon.trim().toLowerCase();
  const blob = `${scene.title} ${scene.subtitle || ''}`.toLowerCase();
  if (/กราฟ|สถิติ|ยอด|chart|data|ขาย|เงิน/.test(blob)) return 'chart';
  if (/สมอง|คิด|ai|ไอเดีย/.test(blob)) return 'brain';
  if (/พุ่ง|เริ่ม|เร็ว|rocket/.test(blob)) return 'rocket';
  if (/เวลา|ชั่วโมง|นาที|clock/.test(blob)) return 'clock';
  if (/เงิน|บาท|ราคา|ต้นทุน|กำไร/.test(blob)) return 'money';
  if (/โลก|เมือง|เครือข่าย/.test(blob)) return 'globe';
  if (/เป้า|จุดหมาย|สำเร็จ/.test(blob)) return 'target';
  return 'lightbulb';
}

// ============================================================================
// 1. FLAT OFFICE BACKGROUND (Pure Flat SVG: Wall, City Window, Clock, Plant, Floor)
// ============================================================================

interface FlatOfficeProps {
  frame: number;
  wallColor: string;
  wallLowerColor: string;
  floorColor: string;
  showDesk: boolean;
  showPlant: boolean;
}

const FlatOffice: React.FC<FlatOfficeProps> = ({
  frame,
  wallColor,
  wallLowerColor,
  floorColor,
  showDesk,
  showPlant,
}) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const cloudShift = (frame * 0.45) % 520;
  const leafSway = Math.sin(frame * 0.08) * 3.5;
  const minuteDeg = (frame * 1.4) % 360;
  const hourDeg = (240 + frame * 0.12) % 360;

  return (
    <svg
      width={1080}
      height={1920}
      viewBox="0 0 1080 1920"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <defs>
        <clipPath id={`win-clip-${uid}`}>
          <rect x={74} y={348} width={468} height={224} rx={12} />
        </clipPath>
      </defs>

      {/* Upper wall */}
      <rect x={0} y={0} width={1080} height={1095} fill={wallColor} />

      {/* Lower wall wainscoting band */}
      <rect x={0} y={1095} width={1080} height={265} fill={wallLowerColor} />
      <rect x={0} y={1090} width={1080} height={10} fill="#B8CFE5" />
      {/* Subtle flat vertical wall panel lines */}
      {[180, 360, 540, 720, 900].map((lx) => (
        <rect key={lx} x={lx} y={1100} width={4} height={255} fill="#C3D8EC" />
      ))}

      {/* Baseboard */}
      <rect x={0} y={1342} width={1080} height={18} fill="#FFFFFF" />
      <rect x={0} y={1342} width={1080} height={4} fill="#B4CAE0" />

      {/* Office Window (Left-Upper Wall: Flat Sky + Clouds + Flat City Skyline) */}
      <g>
        {/* Hard flat offset shadow */}
        <rect x={80} y={354} width={480} height={238} rx={18} fill={WALL_SHADOW} />
        {/* Outer frame */}
        <rect x={68} y={342} width={480} height={238} rx={18} fill={OUTLINE} />
        {/* Sky inside window */}
        <rect x={74} y={348} width={468} height={224} rx={12} fill="#9ADCF5" />

        <g clipPath={`url(#win-clip-${uid})`}>
          {/* Flat sun */}
          <circle cx={484} cy={396} r={26} fill="#FFF08A" />

          {/* Flat drifting clouds */}
          <g transform={`translate(${((cloudShift - 80) % 560) - 60}, 0)`}>
            <rect x={110} y={376} width={78} height={22} rx={11} fill="#FFFFFF" />
            <circle cx={136} cy={376} r={16} fill="#FFFFFF" />
            <circle cx={160} cy={374} r={12} fill="#FFFFFF" />
          </g>
          <g transform={`translate(${((cloudShift + 210) % 560) - 60}, 0)`}>
            <rect x={280} y={404} width={64} height={18} rx={9} fill="#FFFFFF" />
            <circle cx={304} cy={404} r={13} fill="#FFFFFF" />
          </g>

          {/* Far background skyline (pale periwinkle) */}
          <rect x={78} y={472} width={58} height={106} fill="#9BB9E8" />
          <rect x={152} y={448} width={68} height={130} fill="#9BB9E8" />
          <rect x={268} y={456} width={74} height={122} fill="#9BB9E8" />
          <rect x={392} y={440} width={64} height={138} fill="#9BB9E8" />
          <rect x={478} y={468} width={68} height={110} fill="#9BB9E8" />

          {/* Midground city buildings (lavender & indigo) */}
          <rect x={92} y={482} width={64} height={96} fill="#7675B8" />
          <rect x={144} y={482} width={12} height={96} fill="#5E5DA0" />

          <rect x={176} y={432} width={80} height={146} fill="#5B589E" />
          <rect x={240} y={432} width={16} height={146} fill="#444182" />
          {/* Rooftop antenna */}
          <rect x={212} y={406} width={4} height={26} fill="#444182" />
          <circle cx={214} cy={404} r={4} fill="#DF1690" />

          <rect x={278} y={468} width={88} height={110} fill="#8282C4" />
          <rect x={350} y={468} width={16} height={110} fill="#6767AB" />

          <rect x={380} y={448} width={72} height={130} fill="#4D4A91" />
          <rect x={438} y={448} width={14} height={130} fill="#352A6E" />

          <rect x={464} y={492} width={76} height={86} fill="#706FB3" />

          {/* Flat lit building windows */}
          {[
            [104, 496], [124, 496], [104, 518], [124, 518], [104, 540], [124, 540],
            [190, 448], [212, 448], [190, 470], [212, 470], [190, 492], [212, 492],
            [190, 514], [212, 514], [190, 536], [212, 536],
            [292, 484], [316, 484], [292, 506], [316, 506], [292, 528], [316, 528],
            [394, 464], [416, 464], [394, 486], [416, 486], [394, 508], [416, 508],
            [478, 508], [500, 508], [478, 530], [500, 530],
          ].map(([wx, wy], i) => (
            <rect
              key={i}
              x={wx}
              y={wy}
              width={12}
              height={14}
              rx={2}
              fill={i % 5 === 0 ? '#FFF08A' : '#CBEBFB'}
            />
          ))}

          {/* Diagonal flat glass reflection band */}
          <polygon
            points="110,348 160,348 96,572 74,572"
            fill="#FFFFFF"
            opacity={0.28}
          />
          <polygon
            points="178,348 198,348 134,572 114,572"
            fill="#FFFFFF"
            opacity={0.2}
          />
        </g>

        {/* Window Mullion Crossbars */}
        <rect x={305} y={348} width={6} height={224} fill={OUTLINE} />
        <rect x={74} y={460} width={468} height={6} fill={OUTLINE} />
        {/* Window Sill */}
        <rect x={58} y={572} width={500} height={14} rx={7} fill="#FFFFFF" stroke={OUTLINE} strokeWidth={4} />
      </g>

      {/* Wall Shelf + Flat Books + Mini Plant (Upper Right Wall) */}
      <g>
        {/* Wall Clock */}
        <circle cx={936} cy={418} r={52} fill={WALL_SHADOW} transform="translate(7, 7)" />
        <circle cx={936} cy={418} r={52} fill="#FFFFFF" stroke={OUTLINE} strokeWidth={6} />
        <circle cx={936} cy={418} r={40} fill="#F4F9FD" />
        {/* Clock ticks */}
        {[0, 90, 180, 270].map((deg) => (
          <line
            key={deg}
            x1={936}
            y1={383}
            x2={936}
            y2={391}
            stroke={OUTLINE}
            strokeWidth={4}
            strokeLinecap="round"
            transform={`rotate(${deg} 936 418)`}
          />
        ))}
        {/* Hour hand */}
        <line
          x1={936}
          y1={418}
          x2={936}
          y2={396}
          stroke={OUTLINE}
          strokeWidth={5}
          strokeLinecap="round"
          transform={`rotate(${hourDeg} 936 418)`}
        />
        {/* Minute hand */}
        <line
          x1={936}
          y1={418}
          x2={936}
          y2={386}
          stroke="#DF1690"
          strokeWidth={4}
          strokeLinecap="round"
          transform={`rotate(${minuteDeg} 936 418)`}
        />
        <circle cx={936} cy={418} r={5} fill={OUTLINE} />

        {/* Small floating office shelf */}
        <rect x={596} y={528} width={250} height={14} rx={6} fill={WALL_SHADOW} transform="translate(6, 6)" />
        <rect x={596} y={528} width={250} height={14} rx={6} fill="#625EAC" />
        {/* Flat books on shelf */}
        <rect x={614} y={462} width={22} height={66} rx={3} fill="#DF1690" />
        <rect x={638} y={474} width={20} height={54} rx={3} fill="#30ABD5" />
        <rect x={660} y={454} width={24} height={74} rx={3} fill="#F29F05" />
        <rect x={686} y={470} width={18} height={58} rx={3} fill="#4D4A91" />
        {/* Tiny succulent pot on shelf */}
        <path d="M 768 502 L 806 502 L 800 528 L 774 528 Z" fill="#E87A4B" />
        <ellipse cx={787} cy={494} rx={12} ry={16} fill="#39B56A" />
        <ellipse cx={775} cy={498} rx={9} ry={12} fill="#279152" transform="rotate(-24 775 498)" />
        <ellipse cx={799} cy={498} rx={9} ry={12} fill="#279152" transform="rotate(24 799 498)" />
      </g>

      {/* BRIGHT FLAT CYAN FLOOR (y = 1360..1920 — Bottom 320px stays clean for subtitles) */}
      <rect x={0} y={1360} width={1080} height={560} fill={floorColor} />
      {/* Hard flat floor top shadow strip */}
      <rect x={0} y={1360} width={1080} height={14} fill="#2494BB" />
      {/* Flat lighter-cyan floor highlight stripes (classic flat cartoon office floor) */}
      <rect x={0} y={1428} width={1080} height={24} fill="#49BFE5" />
      <rect x={0} y={1544} width={1080} height={18} fill="#49BFE5" />
      <rect x={0} y={1686} width={1080} height={22} fill="#49BFE5" />
      <rect x={0} y={1824} width={1080} height={16} fill="#49BFE5" />

      {/* Office Side Desk with Coffee Mug & Document Stack */}
      {showDesk && (
        <g transform="translate(650, 1230)">
          {/* Floor shadow */}
          <ellipse cx={125} cy={156} rx={124} ry={14} fill={FLOOR_SHADOW} />
          {/* Desk legs */}
          <rect x={22} y={24} width={14} height={132} rx={4} fill="#352A6E" />
          <rect x={214} y={24} width={14} height={132} rx={4} fill="#352A6E" />
          {/* Drawer unit */}
          <rect x={136} y={24} width={76} height={88} rx={6} fill="#FFFFFF" stroke={OUTLINE} strokeWidth={4} />
          <line x1={136} y1={68} x2={212} y2={68} stroke={OUTLINE} strokeWidth={3} />
          <rect x={162} y={42} width={24} height={6} rx={3} fill="#30ABD5" />
          <rect x={162} y={86} width={24} height={6} rx={3} fill="#30ABD5" />
          {/* Desk tabletop */}
          <rect x={0} y={8} width={250} height={20} rx={7} fill="#625EAC" />
          <rect x={0} y={20} width={250} height={8} rx={3} fill="#4D4A91" />
          {/* Stack of papers */}
          <rect x={24} y={-8} width={72} height={16} rx={3} fill="#FFFFFF" stroke={OUTLINE} strokeWidth={3} />
          <rect x={30} y={-18} width={62} height={12} rx={3} fill="#FFF08A" stroke={OUTLINE} strokeWidth={3} />
          {/* Coffee mug */}
          <rect x={126} y={-24} width={28} height={32} rx={5} fill="#DF1690" />
          <path
            d="M 154 -18 C 166 -18 166 -2 154 -2"
            fill="none"
            stroke="#DF1690"
            strokeWidth={5}
            strokeLinecap="round"
          />
          <rect x={126} y={-24} width={10} height={32} rx={3} fill="#F24BB1" />
          {/* Flat laptop silhouette */}
          <polygon points="172,8 228,8 238,-36 184,-36" fill="#4D4A91" />
          <rect x={162} y={2} width={74} height={7} rx={3} fill="#2B2452" />
        </g>
      )}

      {/* Potted Office Plant (Right Edge) */}
      {showPlant && (
        <g transform="translate(946, 1295)">
          {/* Floor shadow */}
          <ellipse cx={10} cy={92} rx={48} ry={11} fill={FLOOR_SHADOW} />
          {/* Swaying leaves */}
          <g transform={`rotate(${leafSway.toFixed(2)} 6 12)`}>
            <path d="M 4 12 C -40 -26 -46 -88 -8 -108 C 8 -72 14 -24 6 12 Z" fill="#279152" />
            <path d="M 8 12 C 48 -30 56 -92 18 -114 C 0 -74 -2 -26 6 12 Z" fill="#39B56A" />
            <path d="M 6 12 C -12 -44 -8 -116 6 -138 C 22 -106 20 -40 8 12 Z" fill="#4CD07D" />
            <path d="M 4 14 C -54 0 -64 -44 -34 -56 C -14 -36 -4 -8 4 14 Z" fill="#39B56A" />
            <path d="M 8 14 C 60 -2 68 -42 38 -54 C 20 -34 12 -8 8 14 Z" fill="#279152" />
          </g>
          {/* Terracotta pot (two flat tones, hard shade) */}
          <polygon points="-28,12 40,12 30,86 -18,86" fill="#E87A4B" />
          <polygon points="8,12 40,12 30,86 8,86" fill="#CC5F35" />
          <rect x={-34} y={2} width={80} height={14} rx={5} fill="#F28D61" />
          <rect x={8} y={2} width={38} height={14} rx={4} fill="#D96B3F" />
        </g>
      )}
    </svg>
  );
};

// ============================================================================
// 2. FLAT CHARACTER (Big-Headed Vector Presenter with Parametric Arms & Poses)
// ============================================================================

export interface FlatCharacterProps {
  pose: CartoonPose;
  x: number;
  y: number;
  scale?: number;
  frame: number;
  fps?: number;
  variant?: number;
  facing?: 'right' | 'left';
}

export const FlatCharacter: React.FC<FlatCharacterProps> = ({
  pose,
  x,
  y,
  scale = 1,
  frame,
  fps = 30,
  variant = 0,
  facing = 'right',
}) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const pal = CHARACTER_VARIANTS[Math.abs(variant) % CHARACTER_VARIANTS.length];

  const enterSp = spring({
    frame,
    fps,
    config: { damping: 13, stiffness: 170, mass: 0.8 },
  });

  const enterX = interpolate(enterSp, [0, 1], [facing === 'right' ? -120 : 120, 0]);
  const enterScale = interpolate(enterSp, [0, 1], [0.85, 1]);

  // Subtle idle breathing / bobbing
  const bobY =
    pose === 'shocked'
      ? -Math.abs(Math.sin(frame * 0.32)) * 10
      : pose === 'happy'
        ? -Math.abs(Math.sin(frame * 0.22)) * 7
        : Math.sin(frame * 0.14) * 3.5;

  // Periodic natural blinking (not when shocked)
  const blinkCycle = frame % 78;
  const isBlinking = pose !== 'shocked' && blinkCycle >= 72 && blinkCycle <= 75;

  // Expressive talking mouth cycle
  const talkOpen = pose === 'present' || pose === 'point' ? Math.sin(frame * 0.35) > 0.25 : false;

  // Parametric arm angles (degrees relative to shoulder, pointing down = 0)
  const gestureWave = Math.sin(frame * 0.18);
  let leftArmDeg = 22 + gestureWave * 6;
  let rightArmDeg = -46 + gestureWave * 10;

  if (pose === 'point') {
    leftArmDeg = 18;
    rightArmDeg = -132 + Math.sin(frame * 0.2) * 6;
  } else if (pose === 'shocked') {
    leftArmDeg = 148 + Math.sin(frame * 0.45) * 8;
    rightArmDeg = -148 - Math.sin(frame * 0.45) * 8;
  } else if (pose === 'happy') {
    leftArmDeg = 136 + Math.sin(frame * 0.26) * 9;
    rightArmDeg = -136 - Math.sin(frame * 0.26) * 9;
  } else if (pose === 'think') {
    leftArmDeg = 32;
    rightArmDeg = -112 + Math.sin(frame * 0.12) * 3;
  }

  const flipX = facing === 'left' ? -1 : 1;

  // Sweat drop bounce for shocked pose
  const sweatY = -Math.abs(Math.sin(frame * 0.28)) * 14;

  return (
    <g
      transform={`translate(${(x + enterX).toFixed(1)}, ${y.toFixed(1)}) scale(${(
        scale *
        enterScale *
        flipX
      ).toFixed(4)}, ${(scale * enterScale).toFixed(4)})`}
    >
      <defs>
        <clipPath id={`head-clip-${uid}`}>
          <circle cx={0} cy={-246} r={58} />
        </clipPath>
        <clipPath id={`torso-clip-${uid}`}>
          <rect x={-46} y={-182} width={92} height={116} rx={28} />
        </clipPath>
      </defs>

      {/* Flat hard ellipse ground shadow on cyan floor */}
      <ellipse cx={6} cy={4} rx={58} ry={13} fill={FLOOR_SHADOW} />

      <g transform={`translate(0, ${bobY.toFixed(1)})`}>
        {/* LEGS */}
        <rect x={-30} y={-76} width={22} height={74} rx={10} fill={pal.pantsShade} />
        <rect x={8} y={-76} width={22} height={74} rx={10} fill={pal.pants} />
        {/* Flat oval shoes */}
        <path d="M -34 -6 L -2 -6 C 8 -6 10 4 -2 4 L -34 4 Z" fill={pal.shoes} />
        <path d="M 6 -6 L 38 -6 C 48 -6 50 4 38 4 L 6 4 Z" fill={pal.shoes} />

        {/* BACK ARM (Left side of body) */}
        <g transform={`translate(-38, -162) rotate(${leftArmDeg.toFixed(1)})`}>
          <rect x={-11} y={0} width={22} height={72} rx={11} fill={pal.suitShade} />
          {/* Mitten hand */}
          <circle cx={0} cy={76} r={13} fill={pal.skinShade} />
          <ellipse cx={10} cy={72} rx={6} ry={4} fill={pal.skinShade} />
        </g>

        {/* TORSO (Flat suit + shaded side + white shirt + tie) */}
        <g>
          <rect x={-46} y={-182} width={92} height={116} rx={28} fill={pal.suit} />
          {/* Flat single-side shadow inside torso */}
          <g clipPath={`url(#torso-clip-${uid})`}>
            <rect x={-46} y={-182} width={34} height={120} fill={pal.suitShade} />
          </g>
          {/* White V-shirt */}
          <polygon points="-18,-182 18,-182 4,-128" fill={pal.shirt} />
          {/* Tie / Scarf */}
          <polygon points="0,-176 8,-168 3,-156 -3,-156 -8,-168" fill={pal.tie} />
          <polygon points="-4,-158 4,-158 10,-108 0,-96 -10,-108" fill={pal.tie} />
          {/* Lapels (lighter flat tone + thin detail stroke) */}
          <polygon
            points="-22,-182 -6,-182 0,-134 -24,-150"
            fill={pal.lapel}
            stroke={OUTLINE}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <polygon
            points="22,-182 6,-182 0,-134 24,-150"
            fill={pal.lapel}
            stroke={OUTLINE}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          {/* Jacket pocket square */}
          <polygon points="18,-140 32,-140 28,-148 20,-146" fill={pal.shirt} />
        </g>

        {/* NECK */}
        <rect x={-12} y={-196} width={24} height={22} rx={8} fill={pal.skinShade} />

        {/* HEAD (Big round head, flat back-side shade, simple eyes/nose/mouth) */}
        <g>
          {/* Ear */}
          <circle cx={-56} cy={-242} r={11} fill={pal.skin} />
          <path
            d="M -58 -246 C -54 -245 -54 -239 -58 -238"
            fill="none"
            stroke={OUTLINE}
            strokeWidth={2.2}
            strokeLinecap="round"
          />

          {/* Base head circle */}
          <circle cx={0} cy={-246} r={58} fill={pal.skin} />

          {/* Flat back-of-head shadow crescent (no gradient!) */}
          <g clipPath={`url(#head-clip-${uid})`}>
            <path
              d="M -62 -310 L -18 -310 C -36 -265 -36 -222 -14 -182 L -62 -182 Z"
              fill={pal.skinShade}
            />
          </g>

          {/* Hair Variants */}
          {pal.hairStyle === 'founder' && (
            <g>
              <path
                d="M -58 -254 C -60 -296 -26 -314 14 -310 C 42 -308 58 -292 60 -272 C 42 -278 14 -276 -16 -274 C -34 -273 -46 -262 -52 -246 Z"
                fill={pal.hair}
              />
              {/* Darker hair layer */}
              <path
                d="M -58 -254 C -58 -284 -36 -304 -8 -308 C -26 -292 -34 -272 -48 -248 Z"
                fill={pal.hairShade}
              />
              {/* Single bright highlight strand */}
              <path
                d="M -12 -296 C 6 -300 24 -298 38 -290"
                fill="none"
                stroke={pal.hairHighlight}
                strokeWidth={5}
                strokeLinecap="round"
              />
            </g>
          )}

          {pal.hairStyle === 'bob' && (
            <g>
              {/* Back ponytail/bob */}
              <ellipse cx={-56} cy={-264} rx={22} ry={28} fill={pal.hairShade} />
              <path
                d="M -58 -244 C -62 -296 -24 -316 18 -310 C 48 -306 62 -284 58 -262 C 36 -272 10 -274 -18 -268 C -36 -264 -46 -252 -52 -236 Z"
                fill={pal.hair}
              />
              <path
                d="M -10 -298 C 12 -302 32 -296 44 -284"
                fill="none"
                stroke={pal.hairHighlight}
                strokeWidth={5}
                strokeLinecap="round"
              />
            </g>
          )}

          {pal.hairStyle === 'spiky' && (
            <g>
              <path
                d="M -56 -252 C -58 -294 -30 -316 2 -312 L 16 -324 L 26 -308 L 46 -314 L 58 -278 C 36 -282 8 -280 -22 -274 C -40 -270 -48 -258 -54 -244 Z"
                fill={pal.hair}
              />
              <path
                d="M -6 -298 C 12 -302 26 -298 38 -292"
                fill="none"
                stroke={pal.hairHighlight}
                strokeWidth={4.5}
                strokeLinecap="round"
              />
            </g>
          )}

          {/* EYES */}
          {pose === 'shocked' ? (
            <>
              {/* Wide popped eyes! */}
              <circle cx={10} cy={-244} r={11} fill="#FFFFFF" stroke={OUTLINE} strokeWidth={2.5} />
              <circle cx={38} cy={-244} r={11} fill="#FFFFFF" stroke={OUTLINE} strokeWidth={2.5} />
              <circle cx={12} cy={-244} r={4} fill={OUTLINE} />
              <circle cx={40} cy={-244} r={4} fill={OUTLINE} />
            </>
          ) : isBlinking ? (
            <>
              <line x1={4} y1={-244} x2={16} y2={-244} stroke={OUTLINE} strokeWidth={3.5} strokeLinecap="round" />
              <line x1={32} y1={-244} x2={44} y2={-244} stroke={OUTLINE} strokeWidth={3.5} strokeLinecap="round" />
            </>
          ) : (
            <>
              <ellipse cx={10} cy={-244} rx={5.2} ry={6.8} fill={OUTLINE} />
              <ellipse cx={38} cy={-244} rx={5.2} ry={6.8} fill={OUTLINE} />
              <circle cx={11.5} cy={-246.5} r={1.8} fill="#FFFFFF" />
              <circle cx={39.5} cy={-246.5} r={1.8} fill="#FFFFFF" />
            </>
          )}

          {/* Optional glasses for variant 2 */}
          {pal.glasses && (
            <g fill="none" stroke={OUTLINE} strokeWidth={3}>
              <circle cx={10} cy={-244} r={13} />
              <circle cx={38} cy={-244} r={13} />
              <line x1={23} y1={-244} x2={25} y2={-244} />
              <line x1={-3} y1={-246} x2={-48} y2={-248} strokeWidth={2.5} />
            </g>
          )}

          {/* EYEBROWS */}
          {pose === 'shocked' ? (
            <>
              <path d="M 0 -264 Q 10 -272 20 -264" fill="none" stroke={OUTLINE} strokeWidth={4} strokeLinecap="round" />
              <path d="M 28 -264 Q 38 -272 48 -264" fill="none" stroke={OUTLINE} strokeWidth={4} strokeLinecap="round" />
            </>
          ) : pose === 'think' ? (
            <>
              <line x1={2} y1={-258} x2={18} y2={-260} stroke={OUTLINE} strokeWidth={4} strokeLinecap="round" />
              <path d="M 30 -262 Q 38 -268 46 -260" fill="none" stroke={OUTLINE} strokeWidth={4} strokeLinecap="round" />
            </>
          ) : (
            <>
              <path d="M 2 -260 Q 10 -264 18 -260" fill="none" stroke={OUTLINE} strokeWidth={3.8} strokeLinecap="round" />
              <path d="M 30 -260 Q 38 -264 46 -260" fill="none" stroke={OUTLINE} strokeWidth={3.8} strokeLinecap="round" />
            </>
          )}

          {/* Small flat nose line */}
          <path
            d="M 26 -242 L 30 -231 L 24 -229"
            fill="none"
            stroke={OUTLINE}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* MOUTH */}
          {pose === 'shocked' ? (
            <ellipse cx={24} cy={-211} rx={11} ry={14} fill={OUTLINE} />
          ) : pose === 'happy' ? (
            <path
              d="M 10 -218 Q 24 -202 39 -218 Z"
              fill="#FFFFFF"
              stroke={OUTLINE}
              strokeWidth={3}
              strokeLinejoin="round"
            />
          ) : pose === 'think' ? (
            <path
              d="M 14 -213 Q 24 -216 34 -212"
              fill="none"
              stroke={OUTLINE}
              strokeWidth={3.2}
              strokeLinecap="round"
            />
          ) : talkOpen ? (
            <ellipse cx={24} cy={-214} rx={8} ry={6.5} fill={OUTLINE} />
          ) : (
            <path
              d="M 13 -216 Q 24 -208 35 -216"
              fill="none"
              stroke={OUTLINE}
              strokeWidth={3.2}
              strokeLinecap="round"
            />
          )}

          {/* Subtle rosy flat cheek dot */}
          <ellipse cx={-2} cy={-228} rx={7} ry={4} fill="#F2948A" opacity={0.45} />
          <ellipse cx={45} cy={-228} rx={6} ry={3.5} fill="#F2948A" opacity={0.45} />
        </g>

        {/* FRONT ARM (Right side of body, pointing / gesturing / waving / thinking) */}
        <g transform={`translate(34, -160) rotate(${rightArmDeg.toFixed(1)})`}>
          <rect x={-11} y={0} width={22} height={74} rx={11} fill={pal.suit} />
          {/* Shirt cuff */}
          <rect x={-10} y={64} width={20} height={8} rx={3} fill={pal.shirt} />
          {/* Mitten hand */}
          <circle cx={0} cy={80} r={13} fill={pal.skin} />
          <ellipse cx={-10} cy={75} rx={6} ry={4} fill={pal.skin} />
          {/* Optional wooden/indigo pointer stick when pointing */}
          {pose === 'point' && (
            <line
              x1={4}
              y1={84}
              x2={36}
              y2={138}
              stroke={OUTLINE}
              strokeWidth={4.5}
              strokeLinecap="round"
            />
          )}
        </g>

        {/* EMOTION EFFECTS (Sweat drops / Sparkles / Question Mark) */}
        {pose === 'shocked' && (
          <g transform={`translate(0, ${sweatY.toFixed(1)})`}>
            {/* Blue sweat drop */}
            <path
              d="M -66 -292 C -74 -278 -74 -268 -66 -268 C -58 -268 -58 -278 -66 -292 Z"
              fill="#30ABD5"
            />
            {/* Red shock lines */}
            <line x1={62} y1={-304} x2={82} y2={-318} stroke={CRASH_RED} strokeWidth={5} strokeLinecap="round" />
            <line x1={70} y1={-284} x2={92} y2={-288} stroke={CRASH_RED} strokeWidth={5} strokeLinecap="round" />
            <line x1={46} y1={-316} x2={56} y2={-336} stroke={CRASH_RED} strokeWidth={5} strokeLinecap="round" />
          </g>
        )}

        {pose === 'happy' && (
          <g>
            {/* Flat yellow star bursts */}
            <polygon
              points="74,-314 78,-302 90,-298 78,-294 74,-282 70,-294 58,-298 70,-302"
              fill="#FFD43B"
              transform={`scale(${(0.88 + Math.sin(frame * 0.25) * 0.14).toFixed(3)})`}
              style={{ transformOrigin: '74px -298px' }}
            />
            <polygon
              points="-72,-304 -69,-295 -60,-292 -69,-289 -72,-280 -75,-289 -84,-292 -75,-295"
              fill="#DF1690"
            />
          </g>
        )}

        {pose === 'think' && (
          <g transform={`translate(66, ${(-308 + Math.sin(frame * 0.14) * 5).toFixed(1)})`}>
            <circle cx={0} cy={0} r={22} fill="#FFFFFF" stroke={OUTLINE} strokeWidth={4} />
            <circle cx={-18} cy={22} r={7} fill="#FFFFFF" stroke={OUTLINE} strokeWidth={3} />
            <text
              x={0}
              y={8}
              textAnchor="middle"
              fill="#DF1690"
              fontSize={28}
              fontWeight={900}
              fontFamily="sans-serif"
            >
              ?
            </text>
          </g>
        )}
      </g>
    </g>
  );
};

// ============================================================================
// 3. WHITEBOARD CONTENT HELPERS (stat / bullets / steps / compare / title / icon / image)
// ============================================================================

function parseNumericStat(scene: StudioScene): {
  num: number | null;
  prefix: string;
  suffix: string;
  rawStr: string;
} {
  const st = scene.stat;
  if (!st) return { num: null, prefix: '', suffix: '', rawStr: '100%' };
  const rawStr = String(st.value ?? '');
  if (typeof st.numericValue === 'number' && Number.isFinite(st.numericValue)) {
    return {
      num: st.numericValue,
      prefix: st.prefix || '',
      suffix: st.suffix || '',
      rawStr,
    };
  }
  const m = /^([^0-9.-]*)(-?[0-9]+(?:\.[0-9]+)?)(.*)$/.exec(rawStr.trim());
  if (m) {
    return {
      num: parseFloat(m[2]),
      prefix: st.prefix ?? m[1],
      suffix: st.suffix ?? m[3],
      rawStr,
    };
  }
  return { num: null, prefix: st.prefix || '', suffix: st.suffix || '', rawStr };
}

const WhiteboardStatChart: React.FC<{
  scene: StudioScene;
  isCrash: boolean;
  localFrame: number;
  fps: number;
  fontFamily: string;
}> = ({ scene, isCrash, localFrame, fps, fontFamily }) => {
  const stat = scene.stat;
  const parsed = parseNumericStat(scene);

  const countProgress = interpolate(localFrame, [4, 34], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const displayValue =
    parsed.num !== null
      ? `${parsed.prefix}${
          Number.isInteger(parsed.num)
            ? Math.round(parsed.num * countProgress).toLocaleString('en-US')
            : (parsed.num * countProgress).toFixed(1)
        }${parsed.suffix}`
      : parsed.rawStr;

  // Stroke dashoffset draw animation for zigzag line graph
  const climbDraw = interpolate(localFrame, [4, 32], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const crashDraw = interpolate(localFrame, [34, 54], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Upward path (500px total approx)
  const upPath = 'M 40 245 L 145 190 L 240 212 L 355 128 L 465 72';
  const upLen = 540;

  // Crash path (if shocked, drops sharply from peak as fat red zigzag arrow!)
  const crashPath = 'M 465 72 L 555 178 L 620 142 L 735 256';
  const crashLen = 360;

  // Positive continuation path
  const positivePath = 'M 465 72 L 570 96 L 680 42 L 775 24';
  const positiveLen = 380;

  const boardLabel = (stat?.unit || scene.badge || 'STATS').slice(0, 22);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        padding: '38px 32px 32px 32px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      {/* Top row: Header Tag + Big Animated Number */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '7px 20px',
            borderRadius: 12,
            backgroundColor: isCrash ? CRASH_RED : '#30ABD5',
            color: '#FFFFFF',
            fontFamily,
            fontSize: 23,
            fontWeight: 800,
            letterSpacing: 0.5,
          }}
        >
          <span>{boardLabel}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <span
            style={{
              fontFamily,
              fontSize: 64,
              fontWeight: 900,
              lineHeight: 1.0,
              color: isCrash ? CRASH_RED : '#2B2452',
            }}
          >
            {displayValue}
          </span>
          {stat?.delta && (
            <span
              style={{
                padding: '6px 14px',
                borderRadius: 10,
                backgroundColor: isCrash ? '#FFE3E7' : '#D9F7EE',
                color: isCrash ? CRASH_RED : '#0E7A65',
                fontFamily,
                fontSize: 22,
                fontWeight: 800,
              }}
            >
              {stat.delta}
            </span>
          )}
        </div>
      </div>

      {/* SVG Zigzag Line Graph */}
      <div style={{ position: 'relative', flex: 1, width: '100%', marginTop: 4 }}>
        <svg viewBox="0 0 840 285" width="100%" height="100%" style={{ overflow: 'visible' }}>
          {/* Flat horizontal chart guide lines */}
          {[50, 115, 180, 245].map((gy) => (
            <line
              key={gy}
              x1={32}
              y1={gy}
              x2={810}
              y2={gy}
              stroke="#DCE7F3"
              strokeWidth={3}
              strokeDasharray="10 8"
            />
          ))}
          {/* X/Y Axes */}
          <line x1={34} y1={24} x2={34} y2={260} stroke={OUTLINE} strokeWidth={5} strokeLinecap="round" />
          <line x1={34} y1={260} x2={812} y2={260} stroke={OUTLINE} strokeWidth={5} strokeLinecap="round" />

          {/* Initial Climbing Zigzag Line */}
          <path
            d={upPath}
            fill="none"
            stroke="#30ABD5"
            strokeWidth={11}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={upLen}
            strokeDashoffset={(upLen * (1 - climbDraw)).toFixed(1)}
          />

          {/* Data dots along climb */}
          {[
            [145, 190, 10],
            [240, 212, 16],
            [355, 128, 22],
            [465, 72, 28],
          ].map(([cx, cy, delay], idx) => {
            const dotSp = spring({
              frame: Math.max(0, localFrame - delay),
              fps,
              config: { damping: 12, stiffness: 240, mass: 0.6 },
            });
            return (
              <circle
                key={idx}
                cx={cx}
                cy={cy}
                r={(10 * dotSp).toFixed(1)}
                fill="#FFFFFF"
                stroke="#2B2452"
                strokeWidth={5}
              />
            );
          })}

          {isCrash ? (
            <>
              {/* Fat Red Crash Zigzag Arrow */}
              <path
                d={crashPath}
                fill="none"
                stroke={CRASH_RED}
                strokeWidth={14}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={crashLen}
                strokeDashoffset={(crashLen * (1 - crashDraw)).toFixed(1)}
              />
              {crashDraw > 0.85 && (
                <polygon
                  points="750,270 706,258 742,226"
                  fill={CRASH_RED}
                />
              )}
              {/* Flat Whiteboard Crack Lines */}
              {localFrame >= 32 && (
                <path
                  d="M 520 2 L 502 48 L 528 84 L 496 138 L 516 172"
                  fill="none"
                  stroke={OUTLINE}
                  strokeWidth={4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </>
          ) : (
            <>
              {/* Positive Continuing Line */}
              <path
                d={positivePath}
                fill="none"
                stroke="#DF1690"
                strokeWidth={12}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={positiveLen}
                strokeDashoffset={(positiveLen * (1 - crashDraw)).toFixed(1)}
              />
              {crashDraw > 0.85 && (
                <polygon
                  points="800,16 756,12 772,46"
                  fill="#DF1690"
                />
              )}
            </>
          )}
        </svg>
      </div>

      {/* Stat Label Footer */}
      {stat?.label && (
        <div
          style={{
            fontFamily,
            fontSize: 25,
            fontWeight: 700,
            color: '#464173',
            lineHeight: 1.38,
            textAlign: 'right',
            paddingLeft: 120,
          }}
        >
          {stat.label}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 4. MAIN LAYOUT: FlatCartoonLayout
// ============================================================================

export const FlatCartoonLayout: React.FC<FamilySceneRendererProps> = ({
  scene,
  sceneIndex,
  totalScenes,
  tokens,
  localFrame,
}) => {
  const { fps } = useVideoConfig();
  const { palette, springConfig, typography } = tokens;
  const fontFamily = typography?.fontFamily || THAI_FONT_FAMILY;

  const visual = normalizeSceneVisual(scene);
  const pose = inferCartoonPose(scene, visual);
  const isCrashStat = visual === 'stat' && pose === 'shocked';

  // Alternate character variant per scene so the video feels lively & varied
  const charVariant = sceneIndex % CHARACTER_VARIANTS.length;
  const secondVariant = (sceneIndex + 1) % CHARACTER_VARIANTS.length;

  const headSp = spring({ frame: localFrame, fps, config: springConfig });
  const boardSp = spring({ frame: Math.max(0, localFrame - 4), fps, config: springConfig });

  // Board tilt when crashing in shocked stat scene (swings from left pin!)
  const crashSwing =
    isCrashStat && localFrame >= 32
      ? interpolate(
          spring({
            frame: localFrame - 32,
            fps,
            config: { damping: 7, stiffness: 120, mass: 1.1 },
          }),
          [0, 1],
          [0, 3.6],
        )
      : 0;

  // Right pin falls off when board cracks (drops past bottom of board to floor)
  const pinDropY =
    isCrashStat && localFrame >= 32
      ? interpolate(localFrame, [32, 54], [0, 680], { extrapolateRight: 'clamp' })
      : 0;

  const titleSize = computeTitleSize(scene.title, 48);
  const titleWordsCount = splitThaiWords(scene.title).length;
  const isCompactTitle = titleWordsCount > 12;

  const stepsNormalized: StudioStepItem[] = (scene.steps || []).slice(0, 4).map((item, idx) =>
    typeof item === 'string'
      ? { step: String(idx + 1).padStart(2, '0'), title: item }
      : {
          step: item.step || String(idx + 1).padStart(2, '0'),
          title: item.title,
          detail: item.detail,
        },
  );

  // Determine character poses for compare mode (two characters facing each other)
  const compareWinner = scene.compare?.winner || 'right';
  const leftCharPose: CartoonPose = compareWinner === 'left' ? 'happy' : 'shocked';
  const rightCharPose: CartoonPose = compareWinner === 'right' ? 'happy' : 'think';

  const isQuote = visual === 'quote';
  const isCompare = visual === 'compare';

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        width: 1080,
        height: 1920,
        overflow: 'hidden',
        fontFamily,
      }}
    >
      {/* LAYER 0: Pure Flat SVG Office Scene */}
      <FlatOffice
        frame={localFrame + sceneIndex * 37}
        wallColor={palette.bg}
        wallLowerColor={palette.bg2}
        floorColor={palette.accent}
        showDesk={!isCompare && visual !== 'title'}
        showPlant={!isCompare}
      />

      {/* LAYER 1: Top Header Strip + Flat Caption Title Card (y = 92 .. 325) */}
      <div
        style={{
          position: 'absolute',
          top: 92,
          left: 68,
          right: 68,
          zIndex: 15,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          opacity: interpolate(headSp, [0, 0.45], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `translate3d(0, ${interpolate(headSp, [0, 1], [-22, 0]).toFixed(1)}px, 0)`,
        }}
      >
        {/* Top pill badges row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 22px',
              borderRadius: 999,
              backgroundColor: OUTLINE,
              color: '#FFFFFF',
              boxShadow: `6px 6px 0px ${WALL_SHADOW}`,
            }}
          >
            <span
              style={{
                width: 11,
                height: 11,
                borderRadius: '50%',
                backgroundColor: palette.accent,
              }}
            />
            <span
              style={{
                fontFamily,
                fontSize: 23,
                fontWeight: 800,
                lineHeight: 1.35,
                letterSpacing: 0.4,
              }}
            >
              {scene.badge || `SCENE ${String(sceneIndex + 1).padStart(2, '0')}`}
            </span>
          </div>

          <div
            style={{
              padding: '7px 18px',
              borderRadius: 999,
              backgroundColor: '#FFFFFF',
              border: `4px solid ${OUTLINE}`,
              color: OUTLINE,
              fontFamily,
              fontSize: 21,
              fontWeight: 800,
              boxShadow: `5px 5px 0px ${WALL_SHADOW}`,
            }}
          >
            {String(sceneIndex + 1).padStart(2, '0')} / {String(totalScenes).padStart(2, '0')}
          </div>
        </div>

        {/* Crisp Flat White Title Card with Hard Blue Shadow */}
        <div
          style={{
            backgroundColor: '#FFFFFF',
            border: `5px solid ${OUTLINE}`,
            borderRadius: 22,
            padding: isCompactTitle ? '16px 26px' : '20px 30px',
            boxShadow: `10px 10px 0px ${WALL_SHADOW}`,
          }}
        >
          <div
            style={{
              fontFamily,
              fontSize: isCompactTitle ? Math.max(36, titleSize - 6) : titleSize,
              fontWeight: typography?.titleWeight || 800,
              lineHeight: 1.36,
              color: palette.fg,
              wordBreak: 'keep-all',
              paddingTop: 2,
              paddingBottom: 2,
            }}
          >
            {renderHighlightedText(scene.title, scene.highlight, palette.accent2, {
              backgroundColor: '#FFF08A',
              padding: '0 8px',
              borderRadius: 8,
            })}
          </div>
        </div>
      </div>

      {/* LAYER 2: WHITEBOARD OR SPEECH BUBBLE STAGE (y = 602 .. 1072) */}
      {isQuote ? (
        /* SPEECH BUBBLE STAGE FOR QUOTE VISUAL */
        <div
          style={{
            position: 'absolute',
            left: 72,
            top: 596,
            width: 936,
            height: 416,
            zIndex: 18,
            transform: `scale(${interpolate(boardSp, [0, 1], [0.88, 1]).toFixed(4)})`,
            opacity: interpolate(boardSp, [0, 0.5], [0, 1], { extrapolateRight: 'clamp' }),
          }}
        >
          {/* Pure SVG Flat Speech Bubble Frame + Hard Shadow + Tail pointing to Character */}
          <svg
            width={936}
            height={490}
            viewBox="0 0 936 490"
            style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
          >
            {/* Hard flat offset shadow */}
            <g transform="translate(12, 12)">
              <rect x={4} y={4} width={928} height={404} rx={36} fill={WALL_SHADOW} />
              <polygon points="246,404 330,404 218,472" fill={WALL_SHADOW} />
            </g>
            {/* Main flat bubble */}
            <rect
              x={4}
              y={4}
              width={928}
              height={404}
              rx={36}
              fill="#FFFFFF"
              stroke={OUTLINE}
              strokeWidth={7}
            />
            {/* Bubble tail pointing down-left toward character */}
            <polygon
              points="248,402 328,402 218,470"
              fill="#FFFFFF"
              stroke={OUTLINE}
              strokeWidth={7}
              strokeLinejoin="round"
            />
            {/* Mask inner seam cleanly inside the tail opening */}
            <rect x={252} y={396} width={72} height={16} fill="#FFFFFF" />
            {/* Decorative big quote mark */}
            <text
              x={44}
              y={110}
              fill="#30ABD5"
              fontSize={116}
              fontWeight={900}
              fontFamily="Georgia, serif"
              opacity={0.35}
            >
              “
            </text>
          </svg>

          {/* Quote text inside speech bubble */}
          <div
            style={{
              position: 'relative',
              zIndex: 2,
              width: '100%',
              height: 404,
              padding: '38px 56px 32px 56px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 20,
            }}
          >
            <div
              style={{
                fontFamily,
                fontSize: (scene.quote?.text || scene.subtitle || '').length > 90 ? 34 : 40,
                fontWeight: 800,
                lineHeight: 1.44,
                color: OUTLINE,
                wordBreak: 'keep-all',
              }}
            >
              “{scene.quote?.text || scene.subtitle || scene.title}”
            </div>
            {(scene.quote?.author || scene.source) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '7px 18px',
                    borderRadius: 12,
                    backgroundColor: '#DF1690',
                    color: '#FFFFFF',
                    fontFamily,
                    fontSize: 23,
                    fontWeight: 800,
                  }}
                >
                  {scene.quote?.author || scene.source}
                </span>
                {scene.quote?.role && (
                  <span
                    style={{
                      fontFamily,
                      fontSize: 22,
                      fontWeight: 700,
                      color: '#5A5882',
                    }}
                  >
                    {scene.quote.role}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* OFFICE WHITEBOARD STAGE (stat / bullets / steps / compare / title / icon / image) */
        <div
          style={{
            position: 'absolute',
            left: 72,
            top: 604,
            width: 936,
            height: 468,
            zIndex: 18,
            transformOrigin: '48px 24px',
            transform: `scale(${interpolate(boardSp, [0, 1], [0.92, 1]).toFixed(4)}) rotate(${crashSwing.toFixed(2)}deg)`,
            opacity: interpolate(boardSp, [0, 0.45], [0, 1], { extrapolateRight: 'clamp' }),
          }}
        >
          {/* SVG Whiteboard Backing + Pins + Marker Tray */}
          <svg
            width={936}
            height={486}
            viewBox="0 0 936 486"
            style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
          >
            {/* Hard flat offset shadow */}
            <rect x={14} y={14} width={926} height={460} rx={22} fill={WALL_SHADOW} />
            {/* Main Whiteboard Panel */}
            <rect
              x={4}
              y={4}
              width={926}
              height={460}
              rx={22}
              fill="#FFFFFF"
              stroke={OUTLINE}
              strokeWidth={7}
            />
            {/* Top Mounting Pins */}
            <circle cx={42} cy={28} r={10} fill="#30ABD5" stroke={OUTLINE} strokeWidth={4} />
            <g transform={`translate(0, ${pinDropY.toFixed(1)})`}>
              <circle
                cx={892}
                cy={28}
                r={10}
                fill={isCrashStat && localFrame >= 32 ? CRASH_RED : '#30ABD5'}
                stroke={OUTLINE}
                strokeWidth={4}
              />
            </g>

            {/* Bottom Marker Tray */}
            <rect x={540} y={456} width={280} height={18} rx={6} fill="#625EAC" stroke={OUTLINE} strokeWidth={4} />
            {/* Cyan & Magenta Markers + Yellow Eraser */}
            <rect x={568} y={448} width={68} height={10} rx={4} fill="#30ABD5" stroke={OUTLINE} strokeWidth={2.5} />
            <rect x={648} y={448} width={68} height={10} rx={4} fill="#DF1690" stroke={OUTLINE} strokeWidth={2.5} />
            <rect x={738} y={442} width={58} height={16} rx={4} fill="#FFF08A" stroke={OUTLINE} strokeWidth={2.5} />
          </svg>

          {/* Dynamic Whiteboard Visual Content */}
          <div style={{ position: 'relative', zIndex: 2, width: '100%', height: 460 }}>
            {/* 1. STAT VISUAL */}
            {visual === 'stat' && (
              <WhiteboardStatChart
                scene={scene}
                isCrash={isCrashStat}
                localFrame={localFrame}
                fps={fps}
                fontFamily={fontFamily}
              />
            )}

            {/* 2. BULLETS VISUAL (Colorful Sticky-Note Cards Popping In One by One) */}
            {visual === 'bullets' && (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  padding: '32px 34px 28px 34px',
                  display: 'grid',
                  gridTemplateColumns: (scene.bullets || []).length <= 2 ? '1fr' : '1fr 1fr',
                  gap: 20,
                  alignContent: 'center',
                }}
              >
                {(scene.bullets || [scene.subtitle || scene.title]).slice(0, 4).map((b, idx) => {
                  const noteSp = spring({
                    frame: Math.max(0, localFrame - (6 + idx * 9)),
                    fps,
                    config: { damping: 12, stiffness: 200, mass: 0.7 },
                  });
                  const col = STICKY_COLORS[idx % STICKY_COLORS.length];
                  const tilt = idx % 2 === 0 ? -1.4 : 1.4;
                  return (
                    <div
                      key={idx}
                      style={{
                        position: 'relative',
                        backgroundColor: col.bg,
                        border: `4px solid ${OUTLINE}`,
                        borderRadius: 14,
                        padding: '20px 22px 18px 22px',
                        boxShadow: `6px 6px 0px #CBD9E8`,
                        transform: `scale(${interpolate(noteSp, [0, 1], [0.65, 1]).toFixed(4)}) rotate(${tilt}deg)`,
                        opacity: interpolate(noteSp, [0, 0.4], [0, 1], { extrapolateRight: 'clamp' }),
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 14,
                      }}
                    >
                      {/* Flat top pin dot */}
                      <span
                        style={{
                          flexShrink: 0,
                          width: 36,
                          height: 36,
                          borderRadius: '50%',
                          backgroundColor: col.tag,
                          color: '#FFFFFF',
                          fontFamily,
                          fontSize: 20,
                          fontWeight: 900,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: `3px solid ${OUTLINE}`,
                        }}
                      >
                        {idx + 1}
                      </span>
                      <span
                        style={{
                          fontFamily,
                          fontSize: (scene.bullets || []).length > 2 ? 25 : 30,
                          fontWeight: 700,
                          lineHeight: 1.4,
                          color: OUTLINE,
                          wordBreak: 'keep-all',
                        }}
                      >
                        {b}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 3. STEPS VISUAL (Flat Step Cards + Bold SVG Arrows) */}
            {visual === 'steps' && (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  padding: '28px 34px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  gap: 14,
                }}
              >
                {stepsNormalized.map((st, idx) => {
                  const stSp = spring({
                    frame: Math.max(0, localFrame - (5 + idx * 10)),
                    fps,
                    config: { damping: 14, stiffness: 200, mass: 0.7 },
                  });
                  const badgeBg = idx === 0 ? '#30ABD5' : idx === 1 ? '#DF1690' : '#F29F05';
                  return (
                    <React.Fragment key={idx}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 18,
                          backgroundColor: '#F3F8FD',
                          border: `4px solid ${OUTLINE}`,
                          borderRadius: 16,
                          padding: '12px 20px',
                          boxShadow: `5px 5px 0px #D4E2F0`,
                          transform: `translate3d(${interpolate(stSp, [0, 1], [-40, 0]).toFixed(1)}px, 0, 0)`,
                          opacity: interpolate(stSp, [0, 0.45], [0, 1], { extrapolateRight: 'clamp' }),
                        }}
                      >
                        <div
                          style={{
                            flexShrink: 0,
                            width: 52,
                            height: 52,
                            borderRadius: 14,
                            backgroundColor: badgeBg,
                            border: `3.5px solid ${OUTLINE}`,
                            color: '#FFFFFF',
                            fontFamily,
                            fontSize: 24,
                            fontWeight: 900,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {st.step}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontFamily,
                              fontSize: 27,
                              fontWeight: 800,
                              color: OUTLINE,
                              lineHeight: 1.32,
                            }}
                          >
                            {st.title}
                          </div>
                          {st.detail && (
                            <div
                              style={{
                                fontFamily,
                                fontSize: 21,
                                fontWeight: 600,
                                color: '#5A5882',
                                lineHeight: 1.34,
                              }}
                            >
                              {st.detail}
                            </div>
                          )}
                        </div>
                      </div>
                      {idx < stepsNormalized.length - 1 && (
                        <div style={{ display: 'flex', justifyContent: 'center', margin: '-6px 0' }}>
                          <svg width={36} height={22} viewBox="0 0 36 22">
                            <path
                              d="M 18 2 L 18 14 M 10 10 L 18 19 L 26 10"
                              fill="none"
                              stroke={OUTLINE}
                              strokeWidth={4.5}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            )}

            {/* 4. COMPARE VISUAL (Split Whiteboard + VS Badge) */}
            {visual === 'compare' && scene.compare && (
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  height: '100%',
                  padding: '44px 28px 26px 28px',
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 26,
                }}
              >
                {/* Left Column */}
                <div
                  style={{
                    backgroundColor: compareWinner === 'left' ? '#E6F7FC' : '#F4F6FA',
                    border: `4px solid ${compareWinner === 'left' ? '#30ABD5' : '#94A3B8'}`,
                    borderRadius: 16,
                    padding: '18px 20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      display: 'inline-block',
                      alignSelf: 'flex-start',
                      padding: '5px 14px',
                      borderRadius: 10,
                      backgroundColor: compareWinner === 'left' ? '#30ABD5' : '#64748B',
                      color: '#FFFFFF',
                      fontFamily,
                      fontSize: 24,
                      fontWeight: 800,
                    }}
                  >
                    {scene.compare.leftTitle}
                  </div>
                  {(scene.compare.leftItems || []).slice(0, 3).map((item, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        fontFamily,
                        fontSize: 23,
                        fontWeight: 700,
                        lineHeight: 1.38,
                        color: OUTLINE,
                      }}
                    >
                      <span style={{ color: compareWinner === 'left' ? '#0E8A6E' : CRASH_RED, fontWeight: 900 }}>
                        {compareWinner === 'left' ? '✓' : '✕'}
                      </span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>

                {/* Right Column */}
                <div
                  style={{
                    backgroundColor: compareWinner === 'right' ? '#FFF1F7' : '#F4F6FA',
                    border: `4px solid ${compareWinner === 'right' ? '#DF1690' : '#94A3B8'}`,
                    borderRadius: 16,
                    padding: '18px 20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      display: 'inline-block',
                      alignSelf: 'flex-start',
                      padding: '5px 14px',
                      borderRadius: 10,
                      backgroundColor: compareWinner === 'right' ? '#DF1690' : '#64748B',
                      color: '#FFFFFF',
                      fontFamily,
                      fontSize: 24,
                      fontWeight: 800,
                    }}
                  >
                    {scene.compare.rightTitle}
                  </div>
                  {(scene.compare.rightItems || []).slice(0, 3).map((item, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        fontFamily,
                        fontSize: 23,
                        fontWeight: 700,
                        lineHeight: 1.38,
                        color: OUTLINE,
                      }}
                    >
                      <span style={{ color: compareWinner === 'right' ? '#0E8A6E' : CRASH_RED, fontWeight: 900 }}>
                        {compareWinner === 'right' ? '✓' : '✕'}
                      </span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>

                {/* Center Flat VS Badge */}
                <div
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    backgroundColor: '#FFF08A',
                    border: `5px solid ${OUTLINE}`,
                    color: OUTLINE,
                    fontFamily,
                    fontSize: 24,
                    fontWeight: 900,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: `4px 4px 0px ${WALL_SHADOW}`,
                  }}
                >
                  VS
                </div>
              </div>
            )}

            {/* 5. TITLE VISUAL (Mini Chart + Topic Illustration + Summary Subtitle) */}
            {visual === 'title' && (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  padding: '28px 34px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 28,
                }}
              >
                {/* Left Flat Mini Chart + Icon Box */}
                <div
                  style={{
                    flexShrink: 0,
                    width: 240,
                    height: 240,
                    borderRadius: 24,
                    backgroundColor: '#E3EDF6',
                    border: `4px solid ${OUTLINE}`,
                    boxShadow: `6px 6px 0px #CFE0F0`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                  }}
                >
                  <svg viewBox="0 0 220 220" width={220} height={220}>
                    {/* Rising flat bars */}
                    <rect x={28} y={134} width={34} height={60} rx={6} fill="#30ABD5" />
                    <rect x={76} y={96} width={34} height={98} rx={6} fill="#625EAC" />
                    <rect x={124} y={62} width={34} height={132} rx={6} fill="#DF1690" />
                    {/* Upward zigzag arrow */}
                    <path
                      d="M 28 118 L 82 82 L 122 92 L 176 34"
                      fill="none"
                      stroke={OUTLINE}
                      strokeWidth={7}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <polygon points="186,24 156,28 176,50" fill={OUTLINE} />
                    {/* Flat sticky corner */}
                    <rect x={156} y={136} width={44} height={44} rx={6} fill="#FFF08A" stroke={OUTLINE} strokeWidth={3} transform="rotate(6 178 158)" />
                  </svg>
                </div>

                {/* Right Text & Bullet Tags */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18 }}>
                  {scene.subtitle && (
                    <div
                      style={{
                        fontFamily,
                        fontSize: 32,
                        fontWeight: 800,
                        lineHeight: 1.4,
                        color: OUTLINE,
                        wordBreak: 'keep-all',
                      }}
                    >
                      {scene.subtitle}
                    </div>
                  )}
                  {scene.bullets && scene.bullets.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                      {scene.bullets.slice(0, 3).map((b, i) => (
                        <span
                          key={i}
                          style={{
                            padding: '8px 18px',
                            borderRadius: 12,
                            backgroundColor: STICKY_COLORS[i % STICKY_COLORS.length].bg,
                            border: `3.5px solid ${OUTLINE}`,
                            fontFamily,
                            fontSize: 22,
                            fontWeight: 800,
                            color: OUTLINE,
                          }}
                        >
                          {b}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 6. ICON VISUAL */}
            {visual === 'icon' && (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  padding: '28px 36px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 32,
                }}
              >
                <div
                  style={{
                    flexShrink: 0,
                    width: 220,
                    height: 220,
                    borderRadius: 28,
                    backgroundColor: '#FFF08A',
                    border: `5px solid ${OUTLINE}`,
                    boxShadow: `8px 8px 0px ${WALL_SHADOW}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <StudioVectorIcon
                    name={inferIconKeyword(scene)}
                    size={134}
                    color={OUTLINE}
                    secondary="#DF1690"
                  />
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div
                    style={{
                      fontFamily,
                      fontSize: 33,
                      fontWeight: 800,
                      color: OUTLINE,
                      lineHeight: 1.4,
                    }}
                  >
                    {scene.subtitle || scene.title}
                  </div>
                  {scene.bullets && scene.bullets.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {scene.bullets.slice(0, 3).map((b, idx) => (
                        <div
                          key={idx}
                          style={{
                            fontFamily,
                            fontSize: 24,
                            fontWeight: 700,
                            color: '#4D4A91',
                          }}
                        >
                          • {b}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 7. IMAGE VISUAL */}
            {visual === 'image' && (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  padding: '22px 26px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    borderRadius: 14,
                    overflow: 'hidden',
                    border: `4px solid ${OUTLINE}`,
                    backgroundColor: '#E3EDF6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {scene.imageUrl ? (
                    <Img
                      src={scene.imageUrl}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <StudioVectorIcon name="camera" size={110} color={OUTLINE} secondary="#30ABD5" />
                  )}
                </div>
                {(scene.imageCaption || scene.subtitle) && (
                  <div
                    style={{
                      fontFamily,
                      fontSize: 23,
                      fontWeight: 700,
                      color: OUTLINE,
                      textAlign: 'center',
                    }}
                  >
                    {scene.imageCaption || scene.subtitle}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* LAYER 3: FLUTTERING STICKY NOTES ON CRASH + CAPTION CARD FOR TITLE */}
      {isCrashStat && localFrame >= 34 && (
        <svg
          width={1080}
          height={1920}
          viewBox="0 0 1080 1920"
          style={{ position: 'absolute', inset: 0, zIndex: 22, pointerEvents: 'none' }}
        >
          {[
            { x: 640, y: 1020, dx: -35, dy: 270, rot: -26, c: '#FFF08A', delay: 34 },
            { x: 760, y: 1010, dx: 45, dy: 300, rot: 32, c: '#FFC6E0', delay: 37 },
            { x: 850, y: 1030, dx: -20, dy: 250, rot: -18, c: '#B7F4E8', delay: 40 },
          ].map((n, i) => {
            const p = interpolate(localFrame, [n.delay, n.delay + 22], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            const nx = n.x + n.dx * p + Math.sin(p * Math.PI * 2) * 16;
            const ny = n.y + n.dy * p;
            return (
              <g
                key={i}
                transform={`translate(${nx.toFixed(1)}, ${ny.toFixed(1)}) rotate(${(
                  n.rot * p
                ).toFixed(1)})`}
              >
                <rect x={0} y={0} width={58} height={58} rx={6} fill={n.c} stroke={OUTLINE} strokeWidth={3.5} />
                <line x1={10} y1={20} x2={46} y2={20} stroke={OUTLINE} strokeWidth={2.5} opacity={0.45} />
                <line x1={10} y1={34} x2={38} y2={34} stroke={OUTLINE} strokeWidth={2.5} opacity={0.45} />
              </g>
            );
          })}
        </svg>
      )}

      {/* Prominent White Caption Card for Title Visual (Bottom-Right above floor safe zone, clear of plant) */}
      {visual === 'title' && (
        <div
          style={{
            position: 'absolute',
            left: 416,
            right: 176,
            top: 1138,
            zIndex: 24,
            backgroundColor: '#FFFFFF',
            border: `5px solid ${OUTLINE}`,
            borderRadius: 22,
            padding: '22px 28px',
            boxShadow: `10px 10px 0px #2494BB`,
            transform: `scale(${interpolate(boardSp, [0, 1], [0.85, 1]).toFixed(4)})`,
          }}
        >
          <div
            style={{
              fontFamily,
              fontSize: 22,
              fontWeight: 800,
              color: '#DF1690',
              letterSpacing: 1,
              marginBottom: 6,
            }}
          >
            {scene.badge || 'STORY EPISODE'}
          </div>
          <div
            style={{
              fontFamily,
              fontSize: 32,
              fontWeight: 900,
              color: OUTLINE,
              lineHeight: 1.32,
              wordBreak: 'keep-all',
            }}
          >
            {scene.source || scene.highlight || 'การ์ตูนแบนเล่าเรื่องสนุก'}
          </div>
        </div>
      )}

      {/* LAYER 4: FOREGROUND FLAT CARTOON CHARACTER(S) — Strictly above y = 1420 (Subtitles safe!) */}
      <svg
        width={1080}
        height={1920}
        viewBox="0 0 1080 1920"
        style={{ position: 'absolute', inset: 0, zIndex: 25, pointerEvents: 'none' }}
      >
        {isCompare ? (
          <>
            <FlatCharacter
              pose={leftCharPose}
              x={238}
              y={1402}
              scale={1.06}
              frame={localFrame}
              fps={fps}
              variant={charVariant}
              facing="right"
            />
            <FlatCharacter
              pose={rightCharPose}
              x={842}
              y={1402}
              scale={1.06}
              frame={localFrame}
              fps={fps}
              variant={secondVariant}
              facing="left"
            />
          </>
        ) : (
          <FlatCharacter
            pose={pose}
            x={248}
            y={1402}
            scale={1.15}
            frame={localFrame}
            fps={fps}
            variant={charVariant}
            facing="right"
          />
        )}
      </svg>
    </div>
  );
};
