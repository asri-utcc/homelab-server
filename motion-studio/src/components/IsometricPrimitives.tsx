import React from 'react';

/**
 * Pure Orthographic Isometric Projection (true 30° iso, zero perspective distortion —
 * faithfully implementing look-21 Isometric Flow & look-29 Exploded Teardown guardrails).
 */
const COS30 = Math.cos(Math.PI / 6); // ~0.8660254
const SIN30 = 0.5;

export function isoProject(x: number, y: number, z: number, cx = 540, cy = 960): [number, number] {
  const sx = cx + (x - y) * COS30;
  const sy = cy + (x + y) * SIN30 - z;
  return [sx, sy];
}

export function isoPoints(pts: Array<[number, number, number]>, cx = 540, cy = 960): string {
  return pts.map(([x, y, z]) => {
    const [sx, sy] = isoProject(x, y, z, cx, cy);
    return `${sx.toFixed(1)},${sy.toFixed(1)}`;
  }).join(' ');
}

interface IsoBoxProps {
  x: number;
  y: number;
  z?: number;
  dx: number;
  dy: number;
  dz: number;
  topColor: string;
  leftColor: string;
  rightColor: string;
  cx?: number;
  cy?: number;
  opacity?: number;
  stroke?: string;
  strokeWidth?: number;
}

/**
 * Crisp matte tactile isometric box (no fuzzy outlines, clean directional lighting from top-left).
 */
export const IsoBox: React.FC<IsoBoxProps> = ({
  x,
  y,
  z = 0,
  dx,
  dy,
  dz,
  topColor,
  leftColor,
  rightColor,
  cx = 540,
  cy = 960,
  opacity = 1,
  stroke = 'none',
  strokeWidth = 0,
}) => {
  const top = isoPoints(
    [
      [x, y, z + dz],
      [x + dx, y, z + dz],
      [x + dx, y + dy, z + dz],
      [x, y + dy, z + dz],
    ],
    cx,
    cy
  );
  // Left-front face (facing +y)
  const left = isoPoints(
    [
      [x, y + dy, z + dz],
      [x + dx, y + dy, z + dz],
      [x + dx, y + dy, z],
      [x, y + dy, z],
    ],
    cx,
    cy
  );
  // Right-front face (facing +x)
  const right = isoPoints(
    [
      [x + dx, y, z + dz],
      [x + dx, y + dy, z + dz],
      [x + dx, y + dy, z],
      [x + dx, y, z],
    ],
    cx,
    cy
  );

  return (
    <g opacity={opacity}>
      <polygon points={left} fill={leftColor} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <polygon points={right} fill={rightColor} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <polygon points={top} fill={topColor} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </g>
  );
};

interface IsoShadowProps {
  x: number;
  y: number;
  z?: number;
  dx: number;
  dy: number;
  cx?: number;
  cy?: number;
  offset?: number;
  opacity?: number;
}

export const IsoShadow: React.FC<IsoShadowProps> = ({
  x,
  y,
  z = 0.5,
  dx,
  dy,
  cx = 540,
  cy = 960,
  offset = 10,
  opacity = 0.14,
}) => {
  const pts = isoPoints(
    [
      [x + offset, y + offset, z],
      [x + dx + offset, y + offset, z],
      [x + dx + offset, y + dy + offset, z],
      [x + offset, y + dy + offset, z],
    ],
    cx,
    cy
  );
  return <polygon points={pts} fill="#1E293B" opacity={opacity} />;
};

interface IsoLabelPillProps {
  sx: number;
  sy: number;
  badge: string;
  title: string;
  sub?: string;
  badgeColor?: string;
  scale?: number;
  done?: boolean;
  fontFamily: string;
}

/**
 * Clean look-21 capsule label: colored number chip (or green check) + bold Thai label + small grey subtext.
 */
export const IsoLabelPill: React.FC<IsoLabelPillProps> = ({
  sx,
  sy,
  badge,
  title,
  sub,
  badgeColor = '#3B6CF6',
  scale = 1,
  done = false,
  fontFamily,
}) => {
  if (scale <= 0.01) return null;
  // Count base characters only (Thai combining vowels/tones have zero horizontal width)
  const baseTitleLen = title.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '').length;
  const baseSubLen = (sub || '').replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '').length;
  const w = Math.max(210, Math.max(baseTitleLen * 13.2, baseSubLen * 9.5) + 92);
  const h = sub ? 76 : 56;
  return (
    <g transform={`translate(${sx.toFixed(1)}, ${sy.toFixed(1)}) scale(${scale.toFixed(3)})`}>
      {/* Drop shadow */}
      <rect
        x={-w / 2}
        y={-h / 2 + 5}
        width={w}
        height={h}
        rx={20}
        fill="rgba(30, 41, 59, 0.13)"
      />
      {/* White capsule */}
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        rx={20}
        fill="#FFFFFF"
        stroke="#E2E8F0"
        strokeWidth={2}
      />
      {/* Number or Check chip */}
      <circle
        cx={-w / 2 + 32}
        cy={0}
        r={19}
        fill={done ? '#36C39A' : badgeColor}
      />
      <text
        x={-w / 2 + 32}
        y={done ? 7 : badge.length >= 3 ? 5 : 6}
        textAnchor="middle"
        fill="#FFFFFF"
        fontFamily={fontFamily}
        fontWeight={700}
        fontSize={done ? 22 : badge.length >= 3 ? 13 : 18}
      >
        {done ? '✓' : badge}
      </text>
      {/* Step Title */}
      <text
        x={-w / 2 + 64}
        y={sub ? -4 : 7}
        textAnchor="start"
        fill="#1E293B"
        fontFamily={fontFamily}
        fontWeight={700}
        fontSize={22}
      >
        {title}
      </text>
      {sub && (
        <text
          x={-w / 2 + 64}
          y={22}
          textAnchor="start"
          fill="#64748B"
          fontFamily={fontFamily}
          fontWeight={400}
          fontSize={16}
        >
          {sub}
        </text>
      )}
    </g>
  );
};
