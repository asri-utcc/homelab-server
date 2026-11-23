import React from 'react';
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export interface CameraRigProps {
  children: React.ReactNode;
  /** Starting scale zoom factor (default 1) */
  zoomFrom?: number;
  /** Ending scale zoom factor (default 1.08) */
  zoomTo?: number;
  /** Horizontal pan in px: single number pans 0 -> panX, tuple pans [from, to] (default 0) */
  panX?: number | [number, number];
  /** Vertical pan in px: single number pans 0 -> panY, tuple pans [from, to] (default 0) */
  panY?: number | [number, number];
  /** Optional subtle camera roll in degrees [from, to] (default [0, 0]) */
  rotate?: [number, number];
  /** Start frame for the camera motion (default 0) */
  startFrame?: number;
  /** Duration of the Ken-Burns motion in frames (default composition durationInFrames) */
  durationFrames?: number;
  /** CSS transform-origin (default '50% 50%') */
  origin?: string;
  style?: React.CSSProperties;
}

function resolveRange(val: number | [number, number]): [number, number] {
  return Array.isArray(val) ? val : [0, val];
}

export const CameraRig: React.FC<CameraRigProps> = ({
  children,
  zoomFrom = 1,
  zoomTo = 1.08,
  panX = 0,
  panY = 0,
  rotate = [0, 0],
  startFrame = 0,
  durationFrames,
  origin = '50% 50%',
  style,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const dur = Math.max(1, durationFrames ?? durationInFrames);
  const progress = Easing.inOut(Easing.cubic)(
    interpolate(frame, [startFrame, startFrame + dur], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );

  const [xFrom, xTo] = resolveRange(panX);
  const [yFrom, yTo] = resolveRange(panY);

  const scale = interpolate(progress, [0, 1], [zoomFrom, zoomTo]);
  const tx = interpolate(progress, [0, 1], [xFrom, xTo]);
  const ty = interpolate(progress, [0, 1], [yFrom, yTo]);
  const rot = interpolate(progress, [0, 1], [rotate[0], rotate[1]]);

  const transform =
    Math.abs(rot) > 0.001
      ? `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${scale.toFixed(5)}) rotate(${rot.toFixed(3)}deg)`
      : `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${scale.toFixed(5)})`;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transformOrigin: origin,
          transform,
          willChange: 'transform',
        }}
      >
        {children}
      </div>
    </div>
  );
};
