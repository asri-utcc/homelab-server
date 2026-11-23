import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { ThaiFontLoader, THAI_FONT_FAMILY } from '../../components/ThaiFontLoader';
import { SubtitleBar, SubtitleCue } from '../../components/SubtitleBar';
import { IsoBox, IsoLabelPill, IsoShadow, isoPoints, isoProject } from '../../components/IsometricPrimitives';

export interface TimelineScene {
  id: string;
  index: number;
  badge: string;
  title: string;
  subtitle: string;
  startFrame: number;
  durationFrames: number;
  endFrame: number;
  cues: SubtitleCue[];
}

export interface SolarTimelineProps {
  title: string;
  fps: number;
  totalFrames: number;
  scenes: TimelineScene[];
  cues: SubtitleCue[];
}

// Default fallback timeline (overridden cleanly by real TTS timeline.json via --props)
export const DEFAULT_SOLAR_PROPS: SolarTimelineProps = {
  title: 'แผงโซล่าเซลล์ทำงานยังไง?',
  fps: 30,
  totalFrames: 1500,
  cues: [],
  scenes: [
    { id: 'start_sun', index: 0, badge: '01', title: 'จุดเริ่มต้น: แสงแดดสู่แผงโซล่าเซลล์', subtitle: 'เริ่มจากตรงไหน?', startFrame: 0, durationFrames: 225, endFrame: 225, cues: [] },
    { id: 'how_silicon', index: 1, badge: '02', title: 'หลักการทำงาน: ชั้นซิลิคอนสร้างไฟ DC', subtitle: 'ทำงานยังไงข้างในแผง?', startFrame: 225, durationFrames: 285, endFrame: 510, cues: [] },
    { id: 'next_combiner', index: 2, badge: '03', title: 'ไปไหนต่อ (1): ตู้ป้องกัน & เบรกเกอร์ DC', subtitle: 'ปลอดภัยก่อนเข้าตัวแปลงไฟ', startFrame: 510, durationFrames: 240, endFrame: 750, cues: [] },
    { id: 'next_inverter', index: 3, badge: '04', title: 'ไปไหนต่อ (2): อินเวอร์เตอร์ แปลง DC → AC', subtitle: 'หัวใจสำคัญของระบบ', startFrame: 750, durationFrames: 270, endFrame: 1020, cues: [] },
    { id: 'end_destination', index: 4, badge: '05', title: 'จบที่ไหน: ตู้เมนบ้าน · แบตเตอรี่ · การไฟฟ้า', subtitle: '3 ปลายทางของพลังงานสะอาด', startFrame: 1020, durationFrames: 285, endFrame: 1305, cues: [] },
    { id: 'recap_end', index: 5, badge: '✓', title: 'สรุปเส้นทางพลังงานโซล่าเซลล์ครบวงจร', subtitle: 'เริ่มจากแดด จบที่ประหยัดค่าไฟ', startFrame: 1305, durationFrames: 195, endFrame: 1500, cues: [] },
  ],
};

// Palette strictly aligned with look-21 Isometric Flow + solar physical accents
const C = {
  bgTop: '#EEF2F7',
  bgBot: '#E2E9F2',
  slabTop: '#F8FAFC',
  slabLeft: '#DCE5F0',
  slabRight: '#CBD7E6',
  slateDark: '#1E293B',
  slateMid: '#3A4458',
  slateLight: '#64748B',
  mint: '#36C39A',
  mintDark: '#239E7A',
  mintLight: '#67DBB8',
  blue: '#3B6CF6',
  blueDark: '#254EC4',
  blueLight: '#6D93FA',
  coral: '#FF6A4D',
  coralDark: '#D94B30',
  coralLight: '#FF947D',
  sun: '#F59E0B',
  sunLight: '#FCD34D',
  panelCell: '#1E3A8A',
  panelCellHi: '#2563EB',
  white: '#FFFFFF',
};

const STEPS_NAV = [
  { num: '1', label: 'แดด→แผง' },
  { num: '2', label: 'ซิลิคอน DC' },
  { num: '3', label: 'ตู้ป้องกัน' },
  { num: '4', label: 'อินเวอร์เตอร์' },
  { num: '5', label: 'ปลายทาง' },
];

/** Rounded orthographic white diorama base slab (signature look-21 look) */
const DioramaSlab: React.FC<{ cx: number; cy: number; size?: number; thickness?: number }> = ({
  cx,
  cy,
  size = 330,
  thickness = 28,
}) => {
  const half = size / 2;
  return (
    <g>
      {/* Soft ground ambient shadow */}
      <polygon
        points={isoPoints(
          [
            [-half + 14, -half + 14, -thickness - 8],
            [half + 14, -half + 14, -thickness - 8],
            [half + 14, half + 14, -thickness - 8],
            [-half + 14, half + 14, -thickness - 8],
          ],
          cx,
          cy
        )}
        fill="#1E293B"
        opacity={0.09}
      />
      <IsoBox
        x={-half}
        y={-half}
        z={-thickness}
        dx={size}
        dy={size}
        dz={thickness}
        topColor={C.slabTop}
        leftColor={C.slabLeft}
        rightColor={C.slabRight}
        cx={cx}
        cy={cy}
        stroke="#DCE5F0"
        strokeWidth={1.5}
      />
    </g>
  );
};

/** Helper to sample point along a polyline of 2D coordinates */
function samplePolyline(pts: Array<[number, number]>, t: number): [number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy);
    segLens.push(len);
    total += len;
  }
  let target = clamped * total;
  for (let i = 0; i < segLens.length; i++) {
    if (target <= segLens[i] || i === segLens.length - 1) {
      const f = segLens[i] > 0 ? target / segLens[i] : 0;
      return [
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f,
      ];
    }
    target -= segLens[i];
  }
  return pts[pts.length - 1];
}

/** Animated glowing particles traveling along an isometric conduit */
const FlowParticles: React.FC<{
  pts: Array<[number, number]>;
  frame: number;
  count?: number;
  speed?: number;
  color: string;
  radius?: number;
  progress?: number;
}> = ({ pts, frame, count = 6, speed = 0.015, color, radius = 8, progress = 1 }) => {
  if (progress <= 0.05) return null;
  return (
    <g>
      {Array.from({ length: count }).map((_, i) => {
        const rawT = ((frame * speed + i / count) % 1);
        if (rawT > progress) return null;
        const [x, y] = samplePolyline(pts, rawT);
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={radius * 1.8} fill={color} opacity={0.22} />
            <circle cx={x} cy={y} r={radius} fill={color} stroke="#FFFFFF" strokeWidth={2.5} />
          </g>
        );
      })}
    </g>
  );
};

// ============================================================================
// SCENE 1: START — SUNLIGHT HITS SOLAR PANEL ON ROOFTOP
// ============================================================================
const Scene1StartSun: React.FC<{ localFrame: number; fps: number }> = ({ localFrame, fps }) => {
  const cx = 540;
  const cy = 1040;
  const slabSpring = spring({ frame: localFrame, fps, config: { damping: 14, stiffness: 130 } });
  const houseSpring = spring({ frame: Math.max(0, localFrame - 6), fps, config: { damping: 13, stiffness: 150 } });
  const panelSpring = spring({ frame: Math.max(0, localFrame - 18), fps, config: { damping: 12, stiffness: 165 } });
  const sunSpring = spring({ frame: Math.max(0, localFrame - 24), fps, config: { damping: 14, stiffness: 140 } });
  const labelSpring = spring({ frame: Math.max(0, localFrame - 34), fps, config: { damping: 13, stiffness: 180 } });

  const houseZ = interpolate(houseSpring, [0, 1], [-120, 0]);
  const panelLift = interpolate(panelSpring, [0, 1], [140, 0]);

  // Sun position top-left of diorama
  const sunX = 240;
  const sunY = 560;
  const sunPulse = 1 + 0.05 * Math.sin(localFrame * 0.14);

  // Solar panel roof vertices in iso space
  const panelTargetPoints: Array<[number, number]> = [
    isoProject(-40, -60, 158, cx, cy),
    isoProject(20, -20, 152, cx, cy),
    isoProject(75, 25, 146, cx, cy),
    isoProject(-10, 40, 144, cx, cy),
  ];

  const [lblX, lblY] = isoProject(20, -100, 235, cx, cy);
  const [wattsX, wattsY] = isoProject(120, 80, 110, cx, cy);

  return (
    <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
      <g transform={`translate(0, ${interpolate(slabSpring, [0, 1], [60, 0]).toFixed(1)})`}>
        <DioramaSlab cx={cx} cy={cy} size={380} thickness={30} />

        {/* Subtle garden strip & path on diorama */}
        <IsoBox x={-165} y={105} z={0} dx={330} dy={55} dz={4} topColor="#D5EFE6" leftColor="#B7E2D4" rightColor="#9FD6C4" cx={cx} cy={cy} />
        {/* Miniature cute rounded trees */}
        {[[-135, 125], [125, -125], [-135, -110]].map(([tx, ty], i) => {
          const tSp = spring({ frame: Math.max(0, localFrame - 14 - i * 4), fps, config: { damping: 13, stiffness: 170 } });
          const [sx, sy] = isoProject(tx, ty, 38, cx, cy);
          return (
            <g key={i} transform={`translate(${sx},${sy}) scale(${tSp}) translate(${-sx},${-sy})`}>
              <IsoBox x={tx - 5} y={ty - 5} z={0} dx={10} dy={10} dz={24} topColor="#7C5E4A" leftColor="#634A39" rightColor="#503B2D" cx={cx} cy={cy} />
              <circle cx={sx} cy={sy - 10} r={24} fill={C.mint} />
              <circle cx={sx - 6} cy={sy - 16} r={14} fill={C.mintLight} opacity={0.65} />
            </g>
          );
        })}

        {/* Modern Isometric House */}
        <g opacity={houseSpring > 0.05 ? 1 : 0}>
          <IsoShadow x={-95} y={-95} dx={190} dy={180} cx={cx} cy={cy} offset={14} opacity={0.14} />
          {/* Slate foundation plinth (drawn FIRST so white walls rise cleanly above it) */}
          <IsoBox
            x={-97}
            y={-97}
            z={houseZ}
            dx={194}
            dy={184}
            dz={16}
            topColor={C.slateMid}
            leftColor={C.slateMid}
            rightColor={C.slateDark}
            cx={cx}
            cy={cy}
          />
          {/* Main crisp white house body */}
          <IsoBox
            x={-95}
            y={-95}
            z={houseZ + 16}
            dx={190}
            dy={180}
            dz={104}
            topColor="#FFFFFF"
            leftColor="#F1F5F9"
            rightColor="#DCE5F0"
            cx={cx}
            cy={cy}
          />
          {/* Warm glowing windows on right face */}
          {[[-55, 34], [15, 34]].map(([wy, wz], idx) => (
            <polygon
              key={idx}
              points={isoPoints(
                [
                  [96, wy, houseZ + wz],
                  [96, wy + 42, houseZ + wz],
                  [96, wy + 42, houseZ + wz + 46],
                  [96, wy, houseZ + wz + 46],
                ],
                cx,
                cy
              )}
              fill={localFrame > 45 ? '#FDE68A' : '#94A3B8'}
              stroke={C.slateMid}
              strokeWidth={3}
            />
          ))}
          {/* Front door on left face */}
          <polygon
            points={isoPoints(
              [
                [-20, 86, houseZ + 16],
                [26, 86, houseZ + 16],
                [26, 86, houseZ + 80],
                [-20, 86, houseZ + 80],
              ],
              cx,
              cy
            )}
            fill={C.coral}
            stroke={C.slateMid}
            strokeWidth={3}
          />
          {/* Crisp flat modern roof cap */}
          <IsoBox
            x={-105}
            y={-105}
            z={houseZ + 120}
            dx={210}
            dy={200}
            dz={14}
            topColor="#FFFFFF"
            leftColor="#E2E8F0"
            rightColor="#CBD5E1"
            cx={cx}
            cy={cy}
          />
        </g>

        {/* Rooftop Solar Panel Array (pops down neatly with spring!) */}
        <g opacity={panelSpring > 0.05 ? 1 : 0}>
          {/* Aluminum mounting rails */}
          <IsoBox x={-72} y={-72} z={134 + panelLift} dx={148} dy={144} dz={10} topColor="#94A3B8" leftColor="#64748B" rightColor="#475569" cx={cx} cy={cy} />
          {/* Solar panel frame */}
          <IsoBox x={-78} y={-78} z={144 + panelLift} dx={160} dy={156} dz={12} topColor={C.panelCell} leftColor="#334155" rightColor="#1E293B" cx={cx} cy={cy} stroke="#E2E8F0" strokeWidth={2.5} />
          {/* 4x4 Silicon cell grid with animated sunlight glint */}
          {[0, 1, 2, 3].map((r) =>
            [0, 1, 2, 3].map((col) => {
              const cellX = -70 + r * 37;
              const cellY = -70 + col * 36;
              const shimmer = Math.sin(localFrame * 0.16 - r * 0.6 - col * 0.5);
              const cellColor = shimmer > 0.45 ? C.panelCellHi : C.panelCell;
              return (
                <polygon
                  key={`${r}-${col}`}
                  points={isoPoints(
                    [
                      [cellX, cellY, 157 + panelLift],
                      [cellX + 33, cellY, 157 + panelLift],
                      [cellX + 33, cellY + 32, 157 + panelLift],
                      [cellX, cellY + 32, 157 + panelLift],
                    ],
                    cx,
                    cy
                  )}
                  fill={cellColor}
                  stroke="#93C5FD"
                  strokeWidth={1.2}
                />
              );
            })
          )}
        </g>

        {/* Glowing Sun + Animated Photon Rays striking the Solar Panel */}
        <g opacity={sunSpring}>
          {/* Soft concentric sun halo */}
          <circle cx={sunX} cy={sunY} r={104 * sunPulse} fill={C.sunLight} opacity={0.18} />
          <circle cx={sunX} cy={sunY} r={74 * sunPulse} fill={C.sunLight} opacity={0.34} />
          <circle cx={sunX} cy={sunY} r={52} fill={C.sun} stroke="#FEF3C7" strokeWidth={5} />

          {/* Sunbeam paths + animated photon packets hitting panel */}
          {panelTargetPoints.map(([tx, ty], idx) => {
            const beamProgress = interpolate(localFrame - 28 - idx * 4, [0, 18], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            const ex = sunX + (tx - sunX) * beamProgress;
            const ey = sunY + (ty - sunY) * beamProgress;
            const photonT = ((localFrame * 0.028 + idx * 0.27) % 1);
            const px = sunX + (tx - sunX) * photonT;
            const py = sunY + (ty - sunY) * photonT;
            return (
              <g key={idx}>
                <line
                  x1={sunX + 32}
                  y1={sunY + 32}
                  x2={ex}
                  y2={ey}
                  stroke={C.sun}
                  strokeWidth={4}
                  strokeDasharray="12 10"
                  opacity={0.55}
                />
                {beamProgress > 0.7 && (
                  <g>
                    <circle cx={px} cy={py} r={14} fill={C.sunLight} opacity={0.45} />
                    <circle cx={px} cy={py} r={7} fill="#FFFFFF" stroke={C.sun} strokeWidth={3} />
                  </g>
                )}
              </g>
            );
          })}
        </g>

        {/* Clean look-21 Floating Labels */}
        <IsoLabelPill
          sx={lblX + 90}
          sy={lblY - 30}
          badge="01"
          title="แผงโซล่าเซลล์รับแสงแดด"
          sub="จุดเริ่มต้น · พลังงานแสงอาทิตย์"
          badgeColor={C.sun}
          scale={labelSpring}
          fontFamily={THAI_FONT_FAMILY}
        />
        <IsoLabelPill
          sx={wattsX + 25}
          sy={wattsY + 175}
          badge="☀"
          title="รับรังสีแสงอาทิตย์"
          sub="Photovoltaic Effect"
          badgeColor={C.blue}
          scale={spring({ frame: Math.max(0, localFrame - 52), fps, config: { damping: 14, stiffness: 170 } })}
          fontFamily={THAI_FONT_FAMILY}
        />
      </g>
    </svg>
  );
};

// ============================================================================
// SCENE 2: HOW IT WORKS — EXPLODED SILICON LAYER TEARDOWN (look-29 + look-21)
// ============================================================================
const Scene2HowSilicon: React.FC<{ localFrame: number; fps: number }> = ({ localFrame, fps }) => {
  const cx = 480;
  const cy = 1130;
  const expand = spring({ frame: Math.max(0, localFrame - 8), fps, config: { damping: 14, stiffness: 110 } });

  const layers = [
    { name: 'กระจกนิรภัยกันกระแทก', sub: 'Tempered Glass', baseZ: 300, dz: 10, top: '#E0F2FE', left: '#BAE6FD', right: '#7DD3FC', badge: '#0284C7', op: 0.85 },
    { name: 'ซิลิคอนชั้นบน (N-Type)', sub: 'มีอิเล็กตรอนอิสระ (e⁻)', baseZ: 215, dz: 24, top: '#3B82F6', left: '#2563EB', right: '#1D4ED8', badge: C.blue, op: 1 },
    { name: 'รอยต่อ P-N Junction', sub: 'สนามไฟฟ้าแยกประจุ', baseZ: 148, dz: 14, top: '#FCD34D', left: '#F59E0B', right: '#D97706', badge: C.sun, op: 1 },
    { name: 'ซิลิคอนชั้นล่าง (P-Type)', sub: 'ประจุบวก (+) ดึงอิเล็กตรอน', baseZ: 68, dz: 26, top: '#FF6A4D', left: '#E05236', right: '#C23D23', badge: C.coral, op: 1 },
    { name: 'แผ่นฐานโลหะนำไฟฟ้า', sub: 'Back Contact', baseZ: 0, dz: 14, top: '#CBD5E1', left: '#94A3B8', right: '#64748B', badge: C.slateMid, op: 1 },
  ];

  // Electron external circuit loop points (shows DC flowing ONE direction!)
  const [nEdgeX, nEdgeY] = isoProject(90, 20, 225 * expand + 12, cx, cy);
  const [pEdgeX, pEdgeY] = isoProject(90, 20, 78 * expand + 12, cx, cy);
  const circuitPts: Array<[number, number]> = [
    [nEdgeX, nEdgeY],
    [nEdgeX + 125, nEdgeY - 35],
    [nEdgeX + 125, pEdgeY + 20],
    [pEdgeX, pEdgeY],
  ];

  const circuitProgress = interpolate(localFrame - 58, [0, 35], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const dcBadgeSpring = spring({ frame: Math.max(0, localFrame - 95), fps, config: { damping: 13, stiffness: 170 } });

  return (
    <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
      {/* Soft base slab */}
      <DioramaSlab cx={cx + 55} cy={cy + 35} size={340} thickness={22} />

      {/* Vertical dashed alignment guides (classic look-29 Exploded Teardown detail) */}
      {[[-95, -95], [95, -95], [-95, 95], [95, 95]].map(([gx, gy], idx) => {
        const [x1, y1] = isoProject(gx, gy, 0, cx, cy);
        const [x2, y2] = isoProject(gx, gy, 330 * expand, cx, cy);
        return (
          <line key={idx} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#94A3B8" strokeWidth={2} strokeDasharray="6 6" opacity={0.6} />
        );
      })}

      {/* Render exploded layers from bottom to top for correct painter's order */}
      {[...layers].reverse().map((ly, revIdx) => {
        const z = ly.baseZ * expand;
        const calloutSpring = spring({
          frame: Math.max(0, localFrame - 16 - revIdx * 8),
          fps,
          config: { damping: 14, stiffness: 170 },
        });
        const [anchorX, anchorY] = isoProject(-92, 0, z + ly.dz / 2, cx, cy);
        const labelX = 110;
        const labelY = anchorY - 4;
        return (
          <g key={ly.name}>
            <IsoBox
              x={-90}
              y={-90}
              z={z}
              dx={180}
              dy={180}
              dz={ly.dz}
              topColor={ly.top}
              leftColor={ly.left}
              rightColor={ly.right}
              cx={cx}
              cy={cy}
              opacity={ly.op}
            />
            {/* Callout leader line & clean label on left */}
            {calloutSpring > 0.05 && (
              <g opacity={calloutSpring}>
                <line x1={anchorX} y1={anchorY} x2={anchorX - 55} y2={labelY} stroke={ly.badge} strokeWidth={3} />
                <circle cx={anchorX} cy={anchorY} r={5} fill={ly.badge} />
                <rect x={labelX - 45} y={labelY - 26} width={295} height={54} rx={14} fill="#FFFFFF" stroke="#E2E8F0" strokeWidth={2} />
                <rect x={labelX - 45} y={labelY - 26} width={10} height={54} rx={4} fill={ly.badge} />
                <text x={labelX - 24} y={labelY - 2} fill={C.slateDark} fontFamily={THAI_FONT_FAMILY} fontWeight={700} fontSize={19}>
                  {ly.name}
                </text>
                <text x={labelX - 24} y={labelY + 20} fill={C.slateLight} fontFamily={THAI_FONT_FAMILY} fontWeight={400} fontSize={15}>
                  {ly.sub}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* Animated Sunlight Photons striking down onto N-Type layer */}
      {[-45, 0, 45].map((px, i) => {
        const t = ((localFrame * 0.032 + i * 0.33) % 1);
        const [sx1, sy1] = isoProject(px - 60, -70, 460, cx, cy);
        const [sx2, sy2] = isoProject(px, 0, 235 * expand, cx, cy);
        const cxP = sx1 + (sx2 - sx1) * t;
        const cyP = sy1 + (sy2 - sy1) * t;
        return (
          <g key={i}>
            <line x1={sx1} y1={sy1} x2={sx2} y2={sy2} stroke={C.sun} strokeWidth={3.5} strokeDasharray="10 8" opacity={0.5} />
            <circle cx={cxP} cy={cyP} r={11} fill={C.sunLight} opacity={0.5} />
            <circle cx={cxP} cy={cyP} r={6} fill="#FFFFFF" stroke={C.sun} strokeWidth={3} />
          </g>
        );
      })}

      {/* Animated Free Electrons (e⁻) jumping and flowing in ONE direction (DC!) */}
      {circuitProgress > 0.05 && (
        <g>
          <polyline
            points={circuitPts.map((p) => p.join(',')).join(' ')}
            fill="none"
            stroke={C.slateMid}
            strokeWidth={10}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points={circuitPts.map((p) => p.join(',')).join(' ')}
            fill="none"
            stroke={C.coral}
            strokeWidth={5}
            strokeDasharray="14 10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <FlowParticles pts={circuitPts} frame={localFrame} count={5} speed={0.02} color={C.coral} radius={10} progress={circuitProgress} />
        </g>
      )}

      {/* DC Output Badge on right */}
      <IsoLabelPill
        sx={780}
        sy={870}
        badge="DC"
        title="ไฟฟ้ากระแสตรง"
        sub="อิเล็กตรอนไหลทิศทางเดียว →"
        badgeColor={C.coral}
        scale={dcBadgeSpring}
        fontFamily={THAI_FONT_FAMILY}
      />
    </svg>
  );
};

// ============================================================================
// SCENE 3: NEXT STEP 1 — DC CABLE → COMBINER & SURGE PROTECTION BOX
// ============================================================================
const Scene3Combiner: React.FC<{ localFrame: number; fps: number }> = ({ localFrame, fps }) => {
  const cx = 540;
  const cy = 1030;
  const slabSp = spring({ frame: localFrame, fps, config: { damping: 14, stiffness: 135 } });
  const boxSp = spring({ frame: Math.max(0, localFrame - 12), fps, config: { damping: 13, stiffness: 160 } });
  const cableProg = interpolate(localFrame - 18, [0, 35], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const switchOn = localFrame > 68;
  const switchSpring = spring({ frame: Math.max(0, localFrame - 68), fps, config: { damping: 12, stiffness: 220 } });
  const shieldSpring = spring({ frame: Math.max(0, localFrame - 82), fps, config: { damping: 13, stiffness: 180 } });

  // Mini solar panel (left-front-side, clearly visible!) -> DC Combiner Box (center) -> Exit cable to Inverter (right-front)
  const pPanel = isoProject(-155, -25, 38, cx, cy);
  const pMid1 = isoProject(-110, 15, 12, cx, cy);
  const pBoxIn = isoProject(-35, 15, 12, cx, cy);
  const pBoxOut = isoProject(45, 15, 12, cx, cy);
  const pExit = isoProject(175, 15, 12, cx, cy);
  const fullCable: Array<[number, number]> = [pPanel, pMid1, pBoxIn, pBoxOut, pExit];

  const boxZ = interpolate(boxSp, [0, 1], [-90, 0]);
  const [boxTopX, boxTopY] = isoProject(10, 0, 185, cx, cy);

  return (
    <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
      <g transform={`translate(0, ${interpolate(slabSp, [0, 1], [50, 0]).toFixed(1)})`}>
        <DioramaSlab cx={cx} cy={cy} size={410} thickness={28} />

        {/* Miniature source solar panel clearly visible on left */}
        <IsoShadow x={-190} y={-75} dx={82} dy={82} cx={cx} cy={cy} offset={8} />
        <IsoBox x={-190} y={-75} z={0} dx={82} dy={82} dz={32} topColor="#E2E8F0" leftColor="#CBD5E1" rightColor="#94A3B8" cx={cx} cy={cy} />
        <IsoBox x={-187} y={-72} z={32} dx={76} dy={76} dz={10} topColor={C.panelCell} leftColor="#1E293B" rightColor="#0F172A" cx={cx} cy={cy} stroke="#93C5FD" strokeWidth={1.5} />

        {/* DC Conduit track */}
        <polyline
          points={fullCable.map((p) => p.join(',')).join(' ')}
          fill="none"
          stroke={C.slateMid}
          strokeWidth={18}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points={fullCable.map((p) => p.join(',')).join(' ')}
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={4}
          strokeDasharray="14 14"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <FlowParticles pts={fullCable} frame={localFrame} count={7} speed={0.017} color={C.coral} radius={9} progress={cableProg} />

        {/* Hero DC Combiner & Surge Protection Box */}
        <g opacity={boxSp > 0.05 ? 1 : 0}>
          <IsoShadow x={-48} y={-48} dx={110} dy={110} cx={cx} cy={cy} offset={14} opacity={0.16} />
          {/* Pedestal wall */}
          <IsoBox x={-48} y={-48} z={boxZ} dx={110} dy={110} dz={145} topColor="#FFFFFF" leftColor="#EDF2F8" rightColor="#D8E2EE" cx={cx} cy={cy} />
          {/* Coral DC Accent Header Band */}
          <IsoBox x={-50} y={-50} z={boxZ + 125} dx={114} dy={114} dz={22} topColor={C.coral} leftColor={C.coral} rightColor={C.coralDark} cx={cx} cy={cy} />

          {/* Front Panel Display / Breaker Switches on right-front face */}
          <polygon
            points={isoPoints(
              [
                [63, -32, boxZ + 26],
                [63, 44, boxZ + 26],
                [63, 44, boxZ + 112],
                [63, -32, boxZ + 112],
              ],
              cx,
              cy
            )}
            fill={C.slateDark}
          />
          {/* Animated DC Breaker Switch */}
          {(() => {
            const [swX, swY] = isoProject(64, -4, boxZ + 66, cx, cy);
            const leverDy = interpolate(switchSpring, [0, 1], [14, -14]);
            return (
              <g>
                <rect x={swX - 18} y={swY - 26} width={36} height={52} rx={8} fill="#334155" stroke="#94A3B8" strokeWidth={2} />
                <rect x={swX - 12} y={swY + leverDy - 9} width={24} height={18} rx={5} fill={switchOn ? C.mint : C.coral} />
                {/* Status LED */}
                <circle cx={swX + 26} cy={swY - 26} r={8} fill={switchOn ? C.mint : '#64748B'} stroke="#FFFFFF" strokeWidth={2} />
              </g>
            );
          })()}

          {/* Lightning Shield Emblem floating cleanly upper-left with generous width */}
          {shieldSpring > 0.05 && (
            <g transform={`translate(245, 650) scale(${shieldSpring})`}>
              <rect x={-160} y={-48} width={320} height={96} rx={22} fill="#FFFFFF" stroke={C.coral} strokeWidth={3} />
              <circle cx={-112} cy={0} r={28} fill="#FEF3C7" />
              <text x={-112} y={10} textAnchor="middle" fontSize={30}>⚡</text>
              <text x={-70} y={-6} fill={C.slateDark} fontFamily={THAI_FONT_FAMILY} fontWeight={700} fontSize={21}>กันไฟกระชาก SPD</text>
              <text x={-70} y={22} fill={C.slateLight} fontFamily={THAI_FONT_FAMILY} fontWeight={400} fontSize={16}>ป้องกันฟ้าผ่า & ตัดไฟฉุกเฉิน</text>
            </g>
          )}
        </g>

        {/* Labels */}
        <IsoLabelPill
          sx={740}
          sy={695}
          badge="03"
          title="ตู้ป้องกันไฟ DC"
          sub="DC Breaker + Surge Protection"
          badgeColor={C.coral}
          done={switchOn}
          scale={spring({ frame: Math.max(0, localFrame - 24), fps, config: { damping: 14, stiffness: 170 } })}
          fontFamily={THAI_FONT_FAMILY}
        />
        <IsoLabelPill
          sx={pExit[0] - 40}
          sy={pExit[1] + 95}
          badge="→"
          title="ส่งไฟ DC ปลอดภัย"
          sub="มุ่งหน้าสู่อินเวอร์เตอร์"
          badgeColor={C.blue}
          scale={spring({ frame: Math.max(0, localFrame - 95), fps, config: { damping: 14, stiffness: 170 } })}
          fontFamily={THAI_FONT_FAMILY}
        />
      </g>
    </svg>
  );
};

// ============================================================================
// SCENE 4: NEXT STEP 2 — INVERTER (DC STRAIGHT LINE → AC 220V 50Hz SINE WAVE!)
// ============================================================================
const Scene4Inverter: React.FC<{ localFrame: number; fps: number }> = ({ localFrame, fps }) => {
  const cx = 540;
  const cy = 1090;
  const invSpring = spring({ frame: Math.max(0, localFrame - 6), fps, config: { damping: 13, stiffness: 145 } });
  const waveProg = interpolate(localFrame - 28, [0, 45], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const kpiSpring = spring({ frame: Math.max(0, localFrame - 82), fps, config: { damping: 13, stiffness: 175 } });

  const invZ = interpolate(invSpring, [0, 1], [-120, 0]);

  // Left DC input conduit -> Inverter -> Right AC output conduit
  const dcInPts: Array<[number, number]> = [
    isoProject(-185, 0, 14, cx, cy),
    isoProject(-65, 0, 14, cx, cy),
  ];
  const acOutPts: Array<[number, number]> = [
    isoProject(65, 0, 14, cx, cy),
    isoProject(190, 0, 14, cx, cy),
  ];

  // Live animated oscilloscope waveform panel ABOVE the inverter (huge, crystal-clear visual teaching!)
  const oscX = 120;
  const oscY = 520;
  const oscW = 840;
  const oscH = 220;

  // Generate AC 50Hz sine wave SVG path (clean amplitude with generous padding above caption)
  const sinePoints: string[] = [];
  const startX = oscX + oscW * 0.52;
  const endX = oscX + oscW - 44;
  const midY = oscY + oscH * 0.51;
  const samples = 80;
  for (let i = 0; i <= samples; i++) {
    const frac = i / samples;
    if (frac > waveProg) break;
    const x = startX + (endX - startX) * frac;
    const y = midY - Math.sin(frac * Math.PI * 6 - localFrame * 0.28) * 36;
    sinePoints.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }

  return (
    <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
      {/* Live Waveform Conversion Monitor Card (DC ━━━ → AC ∿∿∿) */}
      <g transform={`translate(0, ${interpolate(invSpring, [0, 1], [-30, 0]).toFixed(1)})`}>
        <rect x={oscX} y={oscY + 8} width={oscW} height={oscH} rx={28} fill="rgba(15, 23, 42, 0.14)" />
        <rect x={oscX} y={oscY} width={oscW} height={oscH} rx={28} fill={C.slateDark} stroke="#334155" strokeWidth={3} />

        {/* Subtle grid lines inside oscilloscope */}
        {[0.28, 0.54, 0.80].map((f, i) => (
          <line key={i} x1={oscX + 28} y1={oscY + oscH * f} x2={oscX + oscW - 28} y2={oscY + oscH * f} stroke="#334155" strokeWidth={1.5} strokeDasharray="6 6" />
        ))}
        {/* Center divider */}
        <line x1={oscX + oscW * 0.48} y1={oscY + 26} x2={oscX + oscW * 0.48} y2={oscY + oscH - 26} stroke="#475569" strokeWidth={2} />

        {/* Left: Flat Straight DC Line */}
        <text x={oscX + 44} y={oscY + 46} fill={C.coralLight} fontFamily={THAI_FONT_FAMILY} fontWeight={700} fontSize={23}>
          ขาเข้า: ไฟฟ้ากระแสตรง (DC)
        </text>
        <line
          x1={oscX + 44}
          y1={midY - 26}
          x2={oscX + oscW * 0.43}
          y2={midY - 26}
          stroke={C.coral}
          strokeWidth={8}
          strokeLinecap="round"
        />
        {/* Animated DC pulse dot */}
        <circle
          cx={oscX + 44 + ((localFrame * 7) % (oscW * 0.43 - 44))}
          cy={midY - 26}
          r={10}
          fill="#FFFFFF"
          stroke={C.coral}
          strokeWidth={4}
        />
        <text x={oscX + 44} y={oscY + oscH - 26} fill="#94A3B8" fontFamily={THAI_FONT_FAMILY} fontSize={18}>
          กระแสไหลตรงคงที่ · ใช้กับไฟบ้านตรงๆ ยังไม่ได้
        </text>

        {/* Center conversion badge */}
        <circle cx={oscX + oscW * 0.48} cy={midY} r={28} fill={C.blue} stroke="#FFFFFF" strokeWidth={3} />
        <text x={oscX + oscW * 0.48} y={midY + 9} textAnchor="middle" fill="#FFFFFF" fontFamily={THAI_FONT_FAMILY} fontWeight={700} fontSize={26}>→</text>

        {/* Right: Smooth AC 220V 50Hz Sine Wave */}
        <text x={startX} y={oscY + 46} fill={C.mintLight} fontFamily={THAI_FONT_FAMILY} fontWeight={700} fontSize={23}>
          ขาออก: ไฟฟ้ากระแสสลับ (AC 220V)
        </text>
        {sinePoints.length > 1 && (
          <polyline
            points={sinePoints.join(' ')}
            fill="none"
            stroke={C.mint}
            strokeWidth={8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        <text x={startX} y={oscY + oscH - 26} fill="#94A3B8" fontFamily={THAI_FONT_FAMILY} fontSize={18}>
          คลื่นไซน์ 50 เฮิรตซ์ · พร้อมจ่ายให้เครื่องใช้ไฟฟ้า
        </text>
      </g>

      {/* Isometric Diorama with Hero Inverter Block */}
      <DioramaSlab cx={cx} cy={cy} size={390} thickness={28} />

      {/* Left DC Conduit */}
      <polyline points={dcInPts.map((p) => p.join(',')).join(' ')} fill="none" stroke={C.slateMid} strokeWidth={18} strokeLinecap="round" />
      <FlowParticles pts={dcInPts} frame={localFrame} count={4} speed={0.025} color={C.coral} radius={9} />

      {/* Right AC Conduit */}
      <polyline points={acOutPts.map((p) => p.join(',')).join(' ')} fill="none" stroke={C.slateMid} strokeWidth={18} strokeLinecap="round" />
      <FlowParticles pts={acOutPts} frame={localFrame} count={4} speed={0.025} color={C.blue} radius={9} progress={waveProg} />

      {/* Hero Isometric Solar Inverter */}
      <g opacity={invSpring > 0.05 ? 1 : 0}>
        <IsoShadow x={-64} y={-64} dx={128} dy={128} cx={cx} cy={cy} offset={16} opacity={0.16} />
        {/* White sleek inverter enclosure */}
        <IsoBox x={-64} y={-64} z={invZ} dx={128} dy={128} dz={175} topColor="#FFFFFF" leftColor="#EEF2F7" rightColor="#DCE5F0" cx={cx} cy={cy} />
        {/* Vivid Cobalt Blue header top */}
        <IsoBox x={-66} y={-66} z={invZ + 150} dx={132} dy={132} dz={26} topColor={C.blue} leftColor={C.blue} rightColor={C.blueDark} cx={cx} cy={cy} />
        {/* Cooling fins on left face */}
        {[24, 48, 72, 96, 120].map((fz) => (
          <polygon
            key={fz}
            points={isoPoints(
              [
                [-46, 65, invZ + fz],
                [46, 65, invZ + fz],
                [46, 65, invZ + fz + 8],
                [-46, 65, invZ + fz + 8],
              ],
              cx,
              cy
            )}
            fill="#94A3B8"
          />
        ))}
        {/* Digital OLED screen on right face */}
        <polygon
          points={isoPoints(
            [
              [65, -42, invZ + 52],
              [65, 42, invZ + 52],
              [65, 42, invZ + 122],
              [65, -42, invZ + 122],
            ],
            cx,
            cy
          )}
          fill={C.slateDark}
          stroke={C.blueLight}
          strokeWidth={2.5}
        />
        {/* Live green pulsing status dot */}
        {(() => {
          const [dx, dy] = isoProject(66, 0, invZ + 88, cx, cy);
          return (
            <g>
              <circle cx={dx} cy={dy} r={14 + 3 * Math.sin(localFrame * 0.25)} fill={C.mint} opacity={0.35} />
              <circle cx={dx} cy={dy} r={8} fill={C.mint} />
            </g>
          );
        })()}
      </g>

      {/* Clean KPI Badges beneath diorama */}
      {[
        { x: 255, y: 1360, badge: 'V', title: '220 โวลต์', sub: 'แรงดันไฟบ้าน', col: C.blue },
        { x: 540, y: 1360, badge: 'Hz', title: '50 เฮิรตซ์', sub: 'ความถี่มาตรฐาน', col: C.mint },
        { x: 825, y: 1360, badge: '★', title: 'หัวใจระบบ', sub: 'แปลง DC → AC', col: C.coral },
      ].map((k, idx) => (
        <IsoLabelPill
          key={k.title}
          sx={k.x}
          sy={k.y}
          badge={k.badge}
          title={k.title}
          sub={k.sub}
          badgeColor={k.col}
          scale={spring({ frame: Math.max(0, localFrame - 76 - idx * 8), fps, config: { damping: 14, stiffness: 185 } })}
          fontFamily={THAI_FONT_FAMILY}
        />
      ))}
    </svg>
  );
};

// ============================================================================
// SCENE 5: FINAL DESTINATION — MDB → HOME LOADS + BATTERY + UTILITY GRID!
// ============================================================================
const Scene5Destination: React.FC<{ localFrame: number; fps: number }> = ({ localFrame, fps }) => {
  const cx = 540;
  const cy = 980;
  const slabSp = spring({ frame: localFrame, fps, config: { damping: 14, stiffness: 130 } });
  const mdbSp = spring({ frame: Math.max(0, localFrame - 6), fps, config: { damping: 13, stiffness: 165 } });
  const homeSp = spring({ frame: Math.max(0, localFrame - 24), fps, config: { damping: 13, stiffness: 165 } });
  const battSp = spring({ frame: Math.max(0, localFrame - 62), fps, config: { damping: 13, stiffness: 165 } });
  const gridSp = spring({ frame: Math.max(0, localFrame - 102), fps, config: { damping: 13, stiffness: 165 } });

  // Center MDB Hub -> 3 clean branches!
  const pMdb = isoProject(-60, -60, 12, cx, cy);
  const branchHome: Array<[number, number]> = [pMdb, isoProject(-145, 75, 12, cx, cy)];
  const branchBatt: Array<[number, number]> = [pMdb, isoProject(30, 115, 12, cx, cy)];
  const branchGrid: Array<[number, number]> = [pMdb, isoProject(135, -75, 12, cx, cy)];

  // Battery charge level 1..5 bars animated
  const chargeBars = Math.min(5, Math.max(1, Math.floor(interpolate(localFrame - 70, [0, 80], [1, 5.9], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }))));

  return (
    <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
      <g transform={`translate(0, ${interpolate(slabSp, [0, 1], [50, 0]).toFixed(1)})`}>
        <DioramaSlab cx={cx} cy={cy} size={430} thickness={28} />

        {/* 3 Distribution Conduits */}
        {[
          { pts: branchHome, col: C.blue, active: homeSp > 0.2 },
          { pts: branchBatt, col: C.mint, active: battSp > 0.2 },
          { pts: branchGrid, col: C.coral, active: gridSp > 0.2 },
        ].map((br, i) => (
          <g key={i}>
            <polyline points={br.pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={C.slateMid} strokeWidth={16} strokeLinecap="round" />
            <polyline points={br.pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="#FFFFFF" strokeWidth={3.5} strokeDasharray="12 12" strokeLinecap="round" />
            {br.active && <FlowParticles pts={br.pts} frame={localFrame} count={4} speed={0.022} color={br.col} radius={8} />}
          </g>
        ))}

        {/* CENTER HUB: MDB Main Breaker Panel */}
        <g opacity={mdbSp > 0.05 ? 1 : 0}>
          <IsoShadow x={-95} y={-95} dx={78} dy={78} cx={cx} cy={cy} offset={10} />
          <IsoBox x={-95} y={-95} z={interpolate(mdbSp, [0, 1], [-80, 0])} dx={78} dy={78} dz={95} topColor={C.blue} leftColor="#EEF2F7" rightColor="#CBD5E1" cx={cx} cy={cy} />
          <IsoLabelPill
            sx={390}
            sy={650}
            badge="MDB"
            title="ตู้เมนจ่ายไฟบ้าน"
            sub="กระจายไฟ AC 220V"
            badgeColor={C.blue}
            scale={mdbSp}
            fontFamily={THAI_FONT_FAMILY}
          />
        </g>

        {/* DESTINATION 1: Home Appliances (Air-Con + Lights) */}
        <g opacity={homeSp > 0.05 ? 1 : 0}>
          <IsoShadow x={-195} y={40} dx={100} dy={95} cx={cx} cy={cy} offset={10} />
          <IsoBox x={-195} y={40} z={interpolate(homeSp, [0, 1], [-80, 0])} dx={100} dy={95} dz={86} topColor="#FFFFFF" leftColor="#EDF2F8" rightColor="#D6E0EC" cx={cx} cy={cy} />
          {/* Coral Roof Accent */}
          <IsoBox x={-200} y={35} z={interpolate(homeSp, [0, 1], [-80, 0]) + 86} dx={110} dy={105} dz={14} topColor={C.blue} leftColor={C.blue} rightColor={C.blueDark} cx={cx} cy={cy} />
          {/* Warm glowing lit window */}
          <polygon
            points={isoPoints(
              [
                [-94, 58, 28],
                [-94, 114, 28],
                [-94, 114, 72],
                [-94, 58, 72],
              ],
              cx,
              cy
            )}
            fill="#FDE047"
            stroke={C.slateMid}
            strokeWidth={2.5}
          />
          <IsoLabelPill
            sx={245}
            sy={1240}
            badge="1"
            title="เครื่องใช้ไฟฟ้าในบ้าน"
            sub="แอร์ · ตู้เย็น · ทีวี ใช้ได้ทันที"
            badgeColor={C.blue}
            done={localFrame > 55}
            scale={homeSp}
            fontFamily={THAI_FONT_FAMILY}
          />
        </g>

        {/* DESTINATION 2: Hybrid Battery Storage */}
        <g opacity={battSp > 0.05 ? 1 : 0}>
          <IsoShadow x={-5} y={85} dx={76} dy={76} cx={cx} cy={cy} offset={10} />
          <IsoBox x={-5} y={85} z={interpolate(battSp, [0, 1], [-80, 0])} dx={76} dy={76} dz={118} topColor={C.mint} leftColor="#F8FAFC" rightColor="#DCE5F0" cx={cx} cy={cy} />
          {/* Animated 5 charging LED bars on right face */}
          {[0, 1, 2, 3, 4].map((b) => (
            <polygon
              key={b}
              points={isoPoints(
                [
                  [72, 100, 18 + b * 18],
                  [72, 146, 18 + b * 18],
                  [72, 146, 30 + b * 18],
                  [72, 100, 30 + b * 18],
                ],
                cx,
                cy
              )}
              fill={b < chargeBars ? C.mint : '#CBD5E1'}
            />
          ))}
          <IsoLabelPill
            sx={735}
            sy={1345}
            badge="2"
            title="แบตเตอรี่สำรองไฟ"
            sub="เก็บไฟส่วนเกินไว้ใช้กลางคืน"
            badgeColor={C.mint}
            done={chargeBars >= 5}
            scale={battSp}
            fontFamily={THAI_FONT_FAMILY}
          />
        </g>

        {/* DESTINATION 3: Two-way Meter & Utility Power Grid */}
        <g opacity={gridSp > 0.05 ? 1 : 0}>
          <IsoShadow x={105} y={-115} dx={74} dy={74} cx={cx} cy={cy} offset={10} />
          {/* Meter kiosk + utility tower */}
          <IsoBox x={105} y={-115} z={interpolate(gridSp, [0, 1], [-80, 0])} dx={74} dy={74} dz={68} topColor={C.coral} leftColor="#F8FAFC" rightColor="#DCE5F0" cx={cx} cy={cy} />
          {/* Steel utility pylon mast rising cleanly */}
          <IsoBox x={134} y={-86} z={interpolate(gridSp, [0, 1], [-80, 0]) + 68} dx={16} dy={16} dz={95} topColor="#64748B" leftColor="#475569" rightColor="#334155" cx={cx} cy={cy} />
          <IsoBox x={108} y={-86} z={interpolate(gridSp, [0, 1], [-80, 0]) + 145} dx={68} dy={14} dz={8} topColor="#94A3B8" leftColor="#64748B" rightColor="#475569" cx={cx} cy={cy} />
          <IsoLabelPill
            sx={825}
            sy={780}
            badge="3"
            title="ส่งคืนการไฟฟ้า"
            sub="ผ่านมิเตอร์ 2 ทิศทาง (On-Grid)"
            badgeColor={C.coral}
            done={localFrame > 140}
            scale={gridSp}
            fontFamily={THAI_FONT_FAMILY}
          />
        </g>
      </g>
    </svg>
  );
};

// ============================================================================
// SCENE 6: FULL END-TO-END RECAP FLOW (Classic look-21 Isometric Zig-Zag Loop!)
// ============================================================================
const Scene6Recap: React.FC<{ localFrame: number; fps: number }> = ({ localFrame, fps }) => {
  const cx = 540;
  const cy = 990;
  const slabSp = spring({ frame: localFrame, fps, config: { damping: 14, stiffness: 130 } });

  const nodes = [
    { id: '1', label: '1. แดด → แผงโซล่า', sub: 'สร้างไฟ DC', x: -165, y: -155, col: C.sun, top: C.panelCell, dz: 56 },
    { id: '2', label: '2. ตู้ป้องกัน DC', sub: 'กันฟ้าผ่า/เบรกเกอร์', x: 55, y: -145, col: C.coral, top: C.coral, dz: 68 },
    { id: '3', label: '3. อินเวอร์เตอร์', sub: 'แปลง DC → AC 220V', x: -45, y: 35, col: C.blue, top: C.blue, dz: 82 },
    { id: '4', label: '4. ตู้เมน + บ้าน/แบต/กริด', sub: 'ใช้งานจริง & ประหยัดค่าไฟ', x: 125, y: 110, col: C.mint, top: C.mint, dz: 76 },
  ];

  // Wide signature look-21 zig-zag road/conduit connecting all 4 major blocks clearly
  const roadPts: Array<[number, number]> = [
    isoProject(-130, -120, 8, cx, cy),
    isoProject(90, -110, 8, cx, cy),
    isoProject(-10, 70, 8, cx, cy),
    isoProject(160, 145, 8, cx, cy),
  ];

  const badgePositions: Array<[number, number]> = [
    [275, 650],
    [805, 735],
    [260, 1130],
    [765, 1315],
  ];

  const summaryBannerSp = spring({ frame: Math.max(0, localFrame - 68), fps, config: { damping: 14, stiffness: 170 } });

  return (
    <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
      <g transform={`translate(0, ${interpolate(slabSp, [0, 1], [45, 0]).toFixed(1)})`}>
        <DioramaSlab cx={cx} cy={cy} size={430} thickness={28} />

        {/* Signature look-21 Dark Slate Zig-Zag Road with White Dashed Center Line */}
        <polyline points={roadPts.map((p) => p.join(',')).join(' ')} fill="none" stroke={C.slateMid} strokeWidth={24} strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={roadPts.map((p) => p.join(',')).join(' ')} fill="none" stroke="#FFFFFF" strokeWidth={4} strokeDasharray="16 14" strokeLinecap="round" strokeLinejoin="round" />
        <FlowParticles pts={roadPts} frame={localFrame} count={8} speed={0.016} color={C.mint} radius={9} />

        {/* 4 Isometric Station Blocks popping in sequence */}
        {nodes.map((nd, idx) => {
          const sp = spring({ frame: Math.max(0, localFrame - idx * 10), fps, config: { damping: 13, stiffness: 175 } });
          const done = localFrame > 45 + idx * 12;
          const z = interpolate(sp, [0, 1], [-80, 0]);
          const [bx, by] = badgePositions[idx];
          return (
            <g key={nd.id} opacity={sp > 0.05 ? 1 : 0}>
              <IsoShadow x={nd.x} y={nd.y} dx={68} dy={68} cx={cx} cy={cy} offset={10} />
              <IsoBox x={nd.x} y={nd.y} z={z} dx={68} dy={68} dz={nd.dz} topColor={nd.top} leftColor="#F8FAFC" rightColor="#DCE5F0" cx={cx} cy={cy} />
              <IsoLabelPill
                sx={bx}
                sy={by}
                badge={nd.id}
                title={nd.label}
                sub={nd.sub}
                badgeColor={nd.col}
                done={done}
                scale={sp}
                fontFamily={THAI_FONT_FAMILY}
              />
            </g>
          );
        })}

        {/* Clean completion badge banner */}
        {summaryBannerSp > 0.05 && (
          <g transform={`translate(540, 520) scale(${summaryBannerSp})`}>
            <rect x={-350} y={-44} width={700} height={88} rx={24} fill={C.slateDark} />
            <circle cx={-300} cy={0} r={22} fill={C.mint} />
            <text x={-300} y={8} textAnchor="middle" fill="#FFFFFF" fontFamily={THAI_FONT_FAMILY} fontWeight={700} fontSize={24}>✓</text>
            <text x={-262} y={9} fill="#FFFFFF" fontFamily={THAI_FONT_FAMILY} fontWeight={700} fontSize={28}>
              แดด → DC → ป้องกัน → AC 220V → ใช้ไฟฟรี!
            </text>
          </g>
        )}
      </g>
    </svg>
  );
};

// ============================================================================
// MAIN COMPOSITION
// ============================================================================
export const SolarPanelExplainer: React.FC<SolarTimelineProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scenes = props.scenes?.length ? props.scenes : DEFAULT_SOLAR_PROPS.scenes;
  const activeScene =
    scenes.find((s) => frame >= s.startFrame && frame < s.endFrame) || scenes[scenes.length - 1];
  const localFrame = Math.max(0, frame - activeScene.startFrame);

  // Subtle title pop on every scene change
  const headerSpring = spring({
    frame: localFrame,
    fps,
    config: { damping: 16, stiffness: 200 },
  });

  // Active step index (0..4; recap marks all 5 complete!)
  const activeNavIdx = Math.min(4, activeScene.index);
  const allComplete = activeScene.id === 'recap_end';

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${C.bgTop} 0%, ${C.bgBot} 100%)`,
        fontFamily: THAI_FONT_FAMILY,
        overflow: 'hidden',
      }}
    >
      <ThaiFontLoader />

      {/* Fine subtle architectural dot texture (prevents gradient banding, true look-21 tactile feel) */}
      <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0, opacity: 0.35 }}>
        <defs>
          <pattern id="bg-dots" width="32" height="32" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.4" fill="#94A3B8" />
          </pattern>
        </defs>
        <rect width="1080" height="1920" fill="url(#bg-dots)" />
      </svg>

      {/* TOP SAFE ZONE: 5-Step Journey Stepper + Dynamic Scene Headline */}
      <div
        style={{
          position: 'absolute',
          top: 120,
          left: 52,
          right: 52,
          zIndex: 40,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
        }}
      >
        {/* 5-Stage Journey Tracker Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            backgroundColor: 'rgba(255,255,255,0.90)',
            border: '2px solid #DCE5F0',
            borderRadius: 24,
            padding: '14px 22px',
            boxShadow: '0 8px 24px rgba(30, 41, 59, 0.08)',
          }}
        >
          {STEPS_NAV.map((st, idx) => {
            const done = allComplete || idx < activeNavIdx;
            const current = !allComplete && idx === activeNavIdx;
            const chipBg = done ? C.mint : current ? C.blue : '#CBD5E1';
            return (
              <div key={st.num} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    backgroundColor: chipBg,
                    color: '#FFFFFF',
                    fontWeight: 700,
                    fontSize: 18,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: current ? 'scale(1.12)' : 'scale(1)',
                  }}
                >
                  {done ? '✓' : st.num}
                </div>
                <span
                  style={{
                    fontSize: 20,
                    fontWeight: current || done ? 700 : 400,
                    color: current ? C.slateDark : done ? C.mintDark : C.slateLight,
                    lineHeight: 1.4,
                  }}
                >
                  {st.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Scene Category Tag + Main Thai Headline */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            transform: `translateY(${interpolate(headerSpring, [0, 1], [16, 0])}px)`,
            opacity: interpolate(headerSpring, [0, 1], [0.4, 1]),
            paddingTop: 6,
          }}
        >
          <div
            style={{
              backgroundColor: allComplete ? C.mint : C.blue,
              color: '#FFFFFF',
              fontSize: 23,
              fontWeight: 700,
              padding: '8px 24px 10px 24px',
              borderRadius: 999,
              lineHeight: 1.35,
              marginBottom: 12,
              boxShadow: '0 6px 16px rgba(59, 108, 246, 0.22)',
            }}
          >
            {activeScene.subtitle}
          </div>
          <div
            style={{
              fontSize: 48,
              fontWeight: 700,
              color: C.slateDark,
              lineHeight: 1.38,
              paddingTop: 4,
              paddingBottom: 4,
              maxWidth: 960,
            }}
          >
            {activeScene.title}
          </div>
        </div>
      </div>

      {/* CENTER STAGE: Scene-specific Orthographic Isometric Art */}
      {activeScene.id === 'start_sun' && <Scene1StartSun localFrame={localFrame} fps={fps} />}
      {activeScene.id === 'how_silicon' && <Scene2HowSilicon localFrame={localFrame} fps={fps} />}
      {activeScene.id === 'next_combiner' && <Scene3Combiner localFrame={localFrame} fps={fps} />}
      {activeScene.id === 'next_inverter' && <Scene4Inverter localFrame={localFrame} fps={fps} />}
      {activeScene.id === 'end_destination' && <Scene5Destination localFrame={localFrame} fps={fps} />}
      {activeScene.id === 'recap_end' && <Scene6Recap localFrame={localFrame} fps={fps} />}

      {/* SYNCED THAI SUBTITLE BAR (Safe Zone above TikTok/Reels bottom UI) */}
      <SubtitleBar cues={props.cues || []} theme="light" accentColor={C.blue} bottomOffset={200} />

      {/* Subtle Bottom Progress Line */}
      <div
        style={{
          position: 'absolute',
          left: 64,
          right: 64,
          bottom: 136,
          height: 8,
          backgroundColor: 'rgba(148, 163, 184, 0.28)',
          borderRadius: 999,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${Math.min(100, (frame / Math.max(1, props.totalFrames || 1500)) * 100).toFixed(2)}%`,
            height: '100%',
            background: `linear-gradient(90deg, ${C.sun}, ${C.coral}, ${C.blue}, ${C.mint})`,
            borderRadius: 999,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
