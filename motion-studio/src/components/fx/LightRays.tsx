import React, { useId } from 'react';
import { random, useCurrentFrame, useVideoConfig } from 'remotion';

export interface LightRaysProps {
  /** Number of volumetric god-ray beams (default 12) */
  count?: number;
  /** Primary ray color (default '#FFD9A0') */
  color?: string;
  /** Overall opacity intensity 0..1 (default 0.45) */
  intensity?: number;
  /** Horizontal ray origin: 0..1 fraction of width, or pixels if > 1 (default 0.5) */
  originX?: number;
  /** Vertical ray origin: 0..1 fraction of height, or pixels if > 1 (default 0.28) */
  originY?: number;
  /** Slow rotation velocity in degrees per second (default 3.2) */
  rotationSpeed?: number;
  /** Gaussian blur radius in px (default 16) */
  blur?: number;
  /** Deterministic seed for beam variation (default 'god-rays') */
  seed?: string;
  style?: React.CSSProperties;
}

function resolveCoord(value: number, axisSize: number): number {
  return value <= 1 ? value * axisSize : value;
}

export const LightRays: React.FC<LightRaysProps> = ({
  count = 12,
  color = '#FFD9A0',
  intensity = 0.45,
  originX = 0.5,
  originY = 0.28,
  rotationSpeed = 3.2,
  blur = 16,
  seed = 'god-rays',
  style,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  // Feathered multi-layer volumetric beams avoid costly 5M-pixel CPU feGaussianBlur per frame
  const svgW = Math.max(128, Math.round(width / 2));
  const svgH = Math.max(128, Math.round(height / 2));
  const scaleX = svgW / Math.max(1, width);
  const scaleY = svgH / Math.max(1, height);
  const scaleAvg = (scaleX + scaleY) * 0.5;

  const ox = resolveCoord(originX, width) * scaleX;
  const oy = resolveCoord(originY, height) * scaleY;
  const maxLen = Math.hypot(svgW, svgH) * 1.3;
  const softness = Math.max(0.6, Math.min(2.2, blur / 16));
  const tSec = frame / Math.max(1, fps);
  const baseRotationDeg = tSec * rotationSpeed;

  const rayCount = Math.max(1, Math.round(count));
  const gradId = `light-rays-grad-${uid}`;
  const coreId = `light-rays-core-${uid}`;

  const makeWedge = (centerDeg: number, spreadDeg: number, rayLen: number): string => {
    const a1 = ((centerDeg - spreadDeg) * Math.PI) / 180;
    const a2 = ((centerDeg + spreadDeg) * Math.PI) / 180;
    const innerR = 8 * scaleAvg;
    const ix1 = ox + Math.cos(a1) * innerR;
    const iy1 = oy + Math.sin(a1) * innerR;
    const ix2 = ox + Math.cos(a2) * innerR;
    const iy2 = oy + Math.sin(a2) * innerR;
    const x1 = ox + Math.cos(a1) * rayLen;
    const y1 = oy + Math.sin(a1) * rayLen;
    const x2 = ox + Math.cos(a2) * rayLen;
    const y2 = oy + Math.sin(a2) * rayLen;
    return `${ix1.toFixed(1)},${iy1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)} ${ix2.toFixed(1)},${iy2.toFixed(1)}`;
  };

  const rays = Array.from({ length: rayCount }, (_, i) => {
    const slotAngle = (360 / rayCount) * i;
    const jitter = (random(`${seed}-ang-${i}`) - 0.5) * (180 / rayCount) * 0.45;
    const centerDeg = slotAngle + jitter + baseRotationDeg;
    const halfSpreadDeg = 2.6 + random(`${seed}-spread-${i}`) * 5.8;
    const lengthScale = 0.72 + random(`${seed}-len-${i}`) * 0.32;
    const rayLen = maxLen * lengthScale;

    const phase = random(`${seed}-phase-${i}`) * Math.PI * 2;
    const pulseSpeed = 0.65 + random(`${seed}-spd-${i}`) * 0.9;
    const pulse = 0.55 + 0.45 * Math.sin(tSec * pulseSpeed + phase);
    const weight = 0.55 + random(`${seed}-w-${i}`) * 0.45;

    return {
      outerPoints: makeWedge(centerDeg, halfSpreadDeg * (1.65 * softness), rayLen),
      corePoints: makeWedge(centerDeg, halfSpreadDeg * 0.78, rayLen * 0.92),
      opacity: Math.max(0, Math.min(1, pulse * weight)),
    };
  });

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        opacity: Math.max(0, Math.min(1, intensity * 0.82)),
        ...style,
      }}
    >
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        preserveAspectRatio="none"
        style={{ display: 'block', width: '100%', height: '100%' }}
      >
        <defs>
          <radialGradient
            id={gradId}
            gradientUnits="userSpaceOnUse"
            cx={ox}
            cy={oy}
            r={maxLen * 0.85}
          >
            <stop offset="0%" stopColor={color} stopOpacity="0.92" />
            <stop offset="38%" stopColor={color} stopOpacity="0.46" />
            <stop offset="76%" stopColor={color} stopOpacity="0.11" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
          <radialGradient
            id={coreId}
            gradientUnits="userSpaceOnUse"
            cx={ox}
            cy={oy}
            r={Math.min(svgW, svgH) * 0.34}
          >
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
            <stop offset="40%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
        </defs>

        <g>
          {rays.map((ray, idx) => (
            <React.Fragment key={idx}>
              <polygon
                points={ray.outerPoints}
                fill={`url(#${gradId})`}
                opacity={ray.opacity * 0.34}
              />
              <polygon
                points={ray.corePoints}
                fill={`url(#${gradId})`}
                opacity={ray.opacity * 0.52}
              />
            </React.Fragment>
          ))}
        </g>

        <circle
          cx={ox}
          cy={oy}
          r={Math.min(svgW, svgH) * 0.34}
          fill={`url(#${coreId})`}
        />
      </svg>
    </div>
  );
};
