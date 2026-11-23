import React, { useId } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';

export interface IslamicPatternProps {
  /** Pattern visibility opacity 0..1 (default 0.08) */
  opacity?: number;
  /** Rotation angle in degrees. If omitted, rotates gently over time (default auto-rotate) */
  rotate?: number;
  /** Stroke & accent color (default '#FFD9A0') */
  color?: string;
  /** Repeating geometric tile size in px (default 160) */
  tileSize?: number;
  /** Line stroke thickness (default 1.2) */
  strokeWidth?: number;
  /** Auto-rotation speed in degrees/sec when rotate prop is omitted (default 1.2) */
  rotationSpeed?: number;
  style?: React.CSSProperties;
}

export const IslamicPattern: React.FC<IslamicPatternProps> = ({
  opacity = 0.08,
  rotate,
  color = '#FFD9A0',
  tileSize = 160,
  strokeWidth = 1.2,
  rotationSpeed = 1.2,
  style,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  const tSec = frame / Math.max(1, fps);
  const angleDeg = typeof rotate === 'number' ? rotate : tSec * rotationSpeed;

  // Oversize canvas so rotating pattern never reveals empty corners
  const diag = Math.ceil(Math.hypot(width, height) * 1.15);
  const offsetX = (width - diag) / 2;
  const offsetY = (height - diag) / 2;

  const patternId = `islamic-star-8-${uid}`;
  const s = tileSize;
  const h = s / 2;
  const sqHalf = s * 0.275; // Half-side of outer axis-aligned square
  const diagR = sqHalf * Math.SQRT2; // Vertex distance of 45-degree rotated square
  const innerSqHalf = sqHalf * 0.52;
  const innerDiagR = innerSqHalf * Math.SQRT2;

  const outerSquare = `${h - sqHalf},${h - sqHalf} ${h + sqHalf},${h - sqHalf} ${h + sqHalf},${h + sqHalf} ${h - sqHalf},${h + sqHalf}`;
  const rotatedSquare = `${h},${h - diagR} ${h + diagR},${h} ${h},${h + diagR} ${h - diagR},${h}`;

  const innerSquare = `${h - innerSqHalf},${h - innerSqHalf} ${h + innerSqHalf},${h - innerSqHalf} ${h + innerSqHalf},${h + innerSqHalf} ${h - innerSqHalf},${h + innerSqHalf}`;
  const innerRotated = `${h},${h - innerDiagR} ${h + innerDiagR},${h} ${h},${h + innerDiagR} ${h - innerDiagR},${h}`;

  // Corner quarter-stars create a continuous interlocking tessellation across tiles
  const cornerR = s * 0.16;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        opacity: Math.max(0, Math.min(1, opacity)),
        ...style,
      }}
    >
      <svg
        width={diag}
        height={diag}
        viewBox={`0 0 ${diag} ${diag}`}
        style={{
          position: 'absolute',
          left: offsetX,
          top: offsetY,
          transform: `rotate(${angleDeg.toFixed(3)}deg)`,
          transformOrigin: '50% 50%',
        }}
      >
        <defs>
          <pattern
            id={patternId}
            width={s}
            height={s}
            patternUnits="userSpaceOnUse"
          >
            {/* Primary 8-pointed Rub el Hizb star */}
            <polygon
              points={outerSquare}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
            />
            <polygon
              points={rotatedSquare}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
            />

            {/* Inner 8-pointed star rosette */}
            <polygon
              points={innerSquare}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth * 0.78}
              opacity={0.72}
            />
            <polygon
              points={innerRotated}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth * 0.78}
              opacity={0.72}
            />

            {/* Center medallion dot */}
            <circle cx={h} cy={h} r={s * 0.032} fill={color} opacity={0.65} />

            {/* Interlocking tile-edge lattice connectors */}
            <line
              x1={h}
              y1={0}
              x2={h}
              y2={h - diagR}
              stroke={color}
              strokeWidth={strokeWidth * 0.8}
              opacity={0.65}
            />
            <line
              x1={h}
              y1={h + diagR}
              x2={h}
              y2={s}
              stroke={color}
              strokeWidth={strokeWidth * 0.8}
              opacity={0.65}
            />
            <line
              x1={0}
              y1={h}
              x2={h - diagR}
              y2={h}
              stroke={color}
              strokeWidth={strokeWidth * 0.8}
              opacity={0.65}
            />
            <line
              x1={h + diagR}
              y1={h}
              x2={s}
              y2={h}
              stroke={color}
              strokeWidth={strokeWidth * 0.8}
              opacity={0.65}
            />

            {/* Corner octagram bridges */}
            <polygon
              points={`0,${-cornerR} ${cornerR},0 0,${cornerR} ${-cornerR},0`}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth * 0.8}
              opacity={0.65}
            />
            <polygon
              points={`${s},${-cornerR} ${s + cornerR},0 ${s},${cornerR} ${s - cornerR},0`}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth * 0.8}
              opacity={0.65}
            />
            <polygon
              points={`0,${s - cornerR} ${cornerR},${s} 0,${s + cornerR} ${-cornerR},${s}`}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth * 0.8}
              opacity={0.65}
            />
            <polygon
              points={`${s},${s - cornerR} ${s + cornerR},${s} ${s},${s + cornerR} ${s - cornerR},${s}`}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth * 0.8}
              opacity={0.65}
            />
          </pattern>
        </defs>

        <rect width={diag} height={diag} fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
};
