import React, { useId } from 'react';
import { useVideoConfig } from 'remotion';
import {
  hexToRgba,
  relativeLuminance,
  type ResolvedStyleTokens,
  type StudioScene,
  type StudioVectorBg,
  type StudioVectorElement,
  type StudioVectorSpec,
  type StudioVectorTextZone,
} from '../types';
import {
  FitText,
  SAFE_BOTTOM,
  STAGE_H,
  STAGE_W,
  appear,
  clamp01,
  easeOutCubic,
  sceneTexts,
} from './kit';

export interface DynamicMotionStageProps {
  scene: StudioScene;
  sceneIndex?: number;
  localFrame: number;
  durationFrames: number;
  fps?: number;
  tokens: ResolvedStyleTokens;
  styleId?: string;
}

const MAX_ELEMENTS = 48;
const MAX_POINTS = 40;
const MAX_GROUP_DEPTH = 2;
const COORD_MIN = -200;
const COORD_MAX = 2120;

const PATH_D_RE = /^[MLHVCSQTAZmlhvcsqtaz0-9eE ,.\-]{1,4000}$/;
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGBA_COLOR_RE =
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/;

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return v < min ? min : v > max ? max : v;
}

function finiteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function sanitizeColor(
  raw: unknown,
  tokens: ResolvedStyleTokens,
  fallback: string,
): string {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw !== 'string') return '#888';
  const s = raw.trim();
  if (!s) return fallback;
  if (s === 'none' || s === 'transparent') return s;

  const paletteMap = tokens?.palette as Record<string, string> | undefined;
  if (paletteMap && Object.prototype.hasOwnProperty.call(paletteMap, s)) {
    const mapped = paletteMap[s];
    if (typeof mapped === 'string' && HEX_COLOR_RE.test(mapped.trim())) {
      return mapped.trim();
    }
  }

  if (HEX_COLOR_RE.test(s) || RGBA_COLOR_RE.test(s)) {
    return s;
  }
  return '#888';
}

function isBgLight(bg: StudioVectorBg | undefined, tokens: ResolvedStyleTokens): boolean {
  const firstRaw = bg?.colors?.[0];
  const resolved = sanitizeColor(firstRaw, tokens, tokens.palette.bg);
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(resolved)) {
    return relativeLuminance(resolved) >= 0.48;
  }
  return tokens.isLight;
}

function sanitizePoints(points: unknown): Array<[number, number]> {
  if (!Array.isArray(points)) return [];
  const out: Array<[number, number]> = [];
  const limit = Math.min(points.length, MAX_POINTS);
  for (let i = 0; i < limit; i++) {
    const pt = points[i];
    if (Array.isArray(pt) && pt.length >= 2) {
      const px = clampNum(pt[0], COORD_MIN, COORD_MAX, NaN);
      const py = clampNum(pt[1], COORD_MIN, COORD_MAX, NaN);
      if (Number.isFinite(px) && Number.isFinite(py)) {
        out.push([px, py]);
      }
    }
  }
  return out;
}

function elementCenter(el: StudioVectorElement, pts: Array<[number, number]>): [number, number] {
  switch (el.kind) {
    case 'rect': {
      const x = clampNum(el.x, COORD_MIN, COORD_MAX, 0);
      const y = clampNum(el.y, COORD_MIN, COORD_MAX, 0);
      const w = clampNum(el.w, 0, COORD_MAX, 0);
      const h = clampNum(el.h, 0, COORD_MAX, 0);
      return [x + w / 2, y + h / 2];
    }
    case 'circle':
    case 'ellipse': {
      return [
        clampNum(el.x, COORD_MIN, COORD_MAX, STAGE_W / 2),
        clampNum(el.y, COORD_MIN, COORD_MAX, STAGE_H / 2),
      ];
    }
    case 'polygon':
    case 'line': {
      if (pts.length > 0) {
        let sx = 0;
        let sy = 0;
        for (const [px, py] of pts) {
          sx += px;
          sy += py;
        }
        return [sx / pts.length, sy / pts.length];
      }
      const x1 = clampNum(el.x1 ?? el.x, COORD_MIN, COORD_MAX, STAGE_W / 2);
      const y1 = clampNum(el.y1 ?? el.y, COORD_MIN, COORD_MAX, STAGE_H / 2);
      const x2 = clampNum(
        el.x2 ?? (typeof el.w === 'number' ? x1 + el.w : x1),
        COORD_MIN,
        COORD_MAX,
        x1,
      );
      const y2 = clampNum(
        el.y2 ?? (typeof el.h === 'number' ? y1 + el.h : y1),
        COORD_MIN,
        COORD_MAX,
        y1,
      );
      return [(x1 + x2) / 2, (y1 + y2) / 2];
    }
    case 'group':
    case 'path':
    default: {
      const cx =
        typeof el.x === 'number' && Number.isFinite(el.x)
          ? clampNum(el.x, COORD_MIN, COORD_MAX, STAGE_W / 2)
          : STAGE_W / 2;
      const cy =
        typeof el.y === 'number' && Number.isFinite(el.y)
          ? clampNum(el.y, COORD_MIN, COORD_MAX, STAGE_H / 2)
          : STAGE_H / 2;
      return [cx, cy];
    }
  }
}

interface ComputedAnim {
  opacityMul: number;
  tx: number;
  ty: number;
  scale: number;
  rotate: number;
  drawProgress: number | null;
}

function computeAnim(
  el: StudioVectorElement,
  localFrame: number,
  fps: number,
): ComputedAnim {
  const anim = el.anim;
  const baseRotate = clampNum(el.rotate, -360, 360, 0);
  if (!anim) {
    return {
      opacityMul: 1,
      tx: 0,
      ty: 0,
      scale: 1,
      rotate: baseRotate,
      drawProgress: null,
    };
  }

  const safeFps = Math.max(1, finiteOr(fps, 30));
  const enter = anim.enter || 'none';
  const delaySec = clampNum(anim.delay, 0, 3, 0);
  const durSec = clampNum(anim.dur, 0.2, 2, 0.5);
  const delayFrames = delaySec * safeFps;
  const durFrames = Math.max(1, durSec * safeFps);

  const rawP = clamp01((localFrame - delayFrames) / durFrames);
  const p = enter === 'none' ? 1 : easeOutCubic(rawP);

  let opacityMul = 1;
  let tx = 0;
  let ty = 0;
  let scale = 1;
  let drawProgress: number | null = null;

  switch (enter) {
    case 'fade':
      opacityMul = p;
      break;
    case 'pop': {
      opacityMul = clamp01(rawP * 2.2);
      // Smooth easeOutBack-like pop without CSS or spring side effects
      const inv = rawP - 1;
      const back = 1 + 2.1 * inv * inv * inv + 1.1 * inv * inv;
      scale = rawP <= 0 ? 0.001 : Math.max(0.001, back);
      break;
    }
    case 'slide-up':
      opacityMul = p;
      ty += (1 - p) * 72;
      break;
    case 'slide-left':
      opacityMul = p;
      tx += (1 - p) * 90;
      break;
    case 'slide-right':
      opacityMul = p;
      tx -= (1 - p) * 90;
      break;
    case 'draw':
      opacityMul = rawP <= 0 ? 0 : clamp01(rawP * 4);
      drawProgress = p;
      break;
    case 'none':
    default:
      opacityMul = 1;
      break;
  }

  const loop = anim.loop || 'none';
  let rotate = baseRotate;
  if (loop !== 'none') {
    const amp = clampNum(anim.loopAmp, 0, 60, 12);
    const speed = clampNum(anim.loopSpeed, 0.2, 3, 1);
    const tSec = Math.max(0, (localFrame - delayFrames) / safeFps);
    const blend = enter === 'none' ? 1 : p;

    switch (loop) {
      case 'float':
        ty += Math.sin(tSec * speed * Math.PI) * amp * blend;
        break;
      case 'pulse': {
        const delta = Math.min(0.28, (amp / 100) * 0.65);
        scale *= 1 + Math.sin(tSec * speed * Math.PI * 1.2) * delta * blend;
        break;
      }
      case 'spin': {
        const degPerSec = 36 * speed * Math.max(0.4, amp > 0 ? amp / 20 : 1);
        rotate += tSec * degPerSec;
        break;
      }
      case 'sway': {
        const maxDeg = Math.min(28, amp * 0.55);
        rotate += Math.sin(tSec * speed * Math.PI) * maxDeg * blend;
        break;
      }
      case 'orbit':
        tx += Math.cos(tSec * speed * Math.PI) * amp * blend;
        ty += Math.sin(tSec * speed * Math.PI) * amp * blend;
        break;
      default:
        break;
    }
  }

  return {
    opacityMul: clamp01(opacityMul),
    tx: finiteOr(tx, 0),
    ty: finiteOr(ty, 0),
    scale: Math.max(0.001, finiteOr(scale, 1)),
    rotate: finiteOr(rotate, 0),
    drawProgress,
  };
}

function buildTransform(
  cx: number,
  cy: number,
  anim: ComputedAnim,
): string | undefined {
  const parts: string[] = [];
  if (Math.abs(anim.tx) > 0.01 || Math.abs(anim.ty) > 0.01) {
    parts.push(`translate(${anim.tx.toFixed(2)} ${anim.ty.toFixed(2)})`);
  }
  const hasPivotOp = Math.abs(anim.rotate) > 0.01 || Math.abs(anim.scale - 1) > 0.001;
  if (hasPivotOp) {
    parts.push(`translate(${cx.toFixed(2)} ${cy.toFixed(2)})`);
    if (Math.abs(anim.rotate) > 0.01) {
      parts.push(`rotate(${anim.rotate.toFixed(2)})`);
    }
    if (Math.abs(anim.scale - 1) > 0.001) {
      parts.push(`scale(${anim.scale.toFixed(4)})`);
    }
    parts.push(`translate(${(-cx).toFixed(2)} ${(-cy).toFixed(2)})`);
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function renderElement(
  el: StudioVectorElement,
  key: string,
  depth: number,
  localFrame: number,
  fps: number,
  tokens: ResolvedStyleTokens,
): React.ReactNode {
  if (!el || typeof el !== 'object' || typeof el.kind !== 'string') return null;

  const baseOpacity = clampNum(el.opacity, 0, 1, 1);
  const anim = computeAnim(el, localFrame, fps);
  const finalOpacity = clamp01(baseOpacity * anim.opacityMul);

  const pts = el.kind === 'polygon' || el.kind === 'line' ? sanitizePoints(el.points) : [];
  const [cx, cy] = elementCenter(el, pts);
  const transform = buildTransform(cx, cy, anim);

  const isStrokeOnlyKind = el.kind === 'line';
  const fill = sanitizeColor(
    el.fill,
    tokens,
    isStrokeOnlyKind ? 'none' : el.stroke ? 'none' : tokens.palette.accent,
  );
  const stroke = sanitizeColor(
    el.stroke,
    tokens,
    isStrokeOnlyKind ? tokens.palette.accent : 'none',
  );
  const strokeWidth = clampNum(el.strokeWidth, 0, 40, isStrokeOnlyKind ? 4 : stroke !== 'none' ? 2 : 0);

  const drawProps =
    anim.drawProgress !== null
      ? {
          pathLength: 1000,
          strokeDasharray: 1000,
          strokeDashoffset: Number((1000 * (1 - clamp01(anim.drawProgress))).toFixed(2)),
        }
      : {};

  switch (el.kind) {
    case 'group': {
      const children =
        depth < MAX_GROUP_DEPTH && Array.isArray(el.children)
          ? el.children.slice(0, MAX_ELEMENTS)
          : [];
      return (
        <g key={key} opacity={finalOpacity} transform={transform}>
          {children.map((child, idx) =>
            renderElement(
              child,
              `${key}-${child?.id || idx}`,
              depth + 1,
              localFrame,
              fps,
              tokens,
            ),
          )}
        </g>
      );
    }

    case 'rect': {
      const x = clampNum(el.x, COORD_MIN, COORD_MAX, 0);
      const y = clampNum(el.y, COORD_MIN, COORD_MAX, 0);
      const w = clampNum(el.w, 0, COORD_MAX, 100);
      const h = clampNum(el.h, 0, COORD_MAX, 100);
      const rx = clampNum(el.rx ?? el.r, 0, 600, 0);
      const ry = clampNum(el.ry ?? el.rx ?? el.r, 0, 600, rx);
      return (
        <rect
          key={key}
          x={x}
          y={y}
          width={w}
          height={h}
          rx={rx}
          ry={ry}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={finalOpacity}
          transform={transform}
          {...drawProps}
        />
      );
    }

    case 'circle': {
      const x = clampNum(el.x, COORD_MIN, COORD_MAX, STAGE_W / 2);
      const y = clampNum(el.y, COORD_MIN, COORD_MAX, STAGE_H / 2);
      const r = clampNum(el.r, 0, 1200, 40);
      return (
        <circle
          key={key}
          cx={x}
          cy={y}
          r={r}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={finalOpacity}
          transform={transform}
          {...drawProps}
        />
      );
    }

    case 'ellipse': {
      const x = clampNum(el.x, COORD_MIN, COORD_MAX, STAGE_W / 2);
      const y = clampNum(el.y, COORD_MIN, COORD_MAX, STAGE_H / 2);
      const rx = clampNum(el.rx ?? el.r, 0, 1200, 60);
      const ry = clampNum(el.ry ?? el.r, 0, 1200, 40);
      return (
        <ellipse
          key={key}
          cx={x}
          cy={y}
          rx={rx}
          ry={ry}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={finalOpacity}
          transform={transform}
          {...drawProps}
        />
      );
    }

    case 'path': {
      if (typeof el.d !== 'string') return null;
      const d = el.d.trim();
      if (!d || !PATH_D_RE.test(d)) return null;
      return (
        <path
          key={key}
          d={d}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={finalOpacity}
          transform={transform}
          {...drawProps}
        />
      );
    }

    case 'polygon': {
      if (pts.length < 3) return null;
      const ptsAttr = pts.map(([px, py]) => `${px},${py}`).join(' ');
      return (
        <polygon
          key={key}
          points={ptsAttr}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          opacity={finalOpacity}
          transform={transform}
          {...drawProps}
        />
      );
    }

    case 'line': {
      if (pts.length > 2) {
        const ptsAttr = pts.map(([px, py]) => `${px},${py}`).join(' ');
        return (
          <polyline
            key={key}
            points={ptsAttr}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={finalOpacity}
            transform={transform}
            {...drawProps}
          />
        );
      }
      let x1: number;
      let y1: number;
      let x2: number;
      let y2: number;
      if (pts.length === 2) {
        [x1, y1] = pts[0];
        [x2, y2] = pts[1];
      } else {
        x1 = clampNum(el.x1 ?? el.x, COORD_MIN, COORD_MAX, 0);
        y1 = clampNum(el.y1 ?? el.y, COORD_MIN, COORD_MAX, 0);
        x2 = clampNum(
          el.x2 ?? (typeof el.w === 'number' ? x1 + el.w : x1 + 100),
          COORD_MIN,
          COORD_MAX,
          x1 + 100,
        );
        y2 = clampNum(
          el.y2 ?? (typeof el.h === 'number' ? y1 + el.h : y1),
          COORD_MIN,
          COORD_MAX,
          y1,
        );
      }
      return (
        <line
          key={key}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          opacity={finalOpacity}
          transform={transform}
          {...drawProps}
        />
      );
    }

    default:
      return null;
  }
}

function getZoneBox(zone: StudioVectorTextZone | undefined): {
  top: number;
  maxHeight: number;
} {
  switch (zone) {
    case 'middle':
      return { top: 760, maxHeight: 340 };
    case 'bottom':
      return { top: 1180, maxHeight: Math.min(320, SAFE_BOTTOM - 1180) };
    case 'top':
    default:
      return { top: 180, maxHeight: 340 };
  }
}

function renderBackgroundDef(
  bg: StudioVectorBg | undefined,
  gradId: string,
  tokens: ResolvedStyleTokens,
): { defNode: React.ReactNode; fillAttr: string } {
  const rawColors = Array.isArray(bg?.colors) ? bg.colors.slice(0, 3) : [];
  const colors = rawColors.map((c, idx) =>
    sanitizeColor(c, tokens, idx === 0 ? tokens.palette.bg : tokens.palette.bg2),
  );
  if (colors.length === 0) {
    colors.push(tokens.palette.bg);
  }
  const type = bg?.type || (colors.length > 1 ? 'linear' : 'solid');

  if (type === 'solid' || colors.length === 1) {
    return { defNode: null, fillAttr: colors[0] };
  }

  const stops = colors.map((color, idx) => {
    const offset = colors.length === 1 ? 0 : (idx / (colors.length - 1)) * 100;
    return <stop key={idx} offset={`${offset.toFixed(1)}%`} stopColor={color} />;
  });

  if (type === 'radial') {
    return {
      defNode: (
        <radialGradient id={gradId} cx="50%" cy="45%" r="70%">
          {stops}
        </radialGradient>
      ),
      fillAttr: `url(#${gradId})`,
    };
  }

  // Linear gradient with angle 0..360 (CSS-like: 0 = bottom-to-top, 180 = top-to-bottom)
  const angleDeg = clampNum(bg?.angle, 0, 360, 180);
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  const x1 = 50 - Math.cos(rad) * 50;
  const y1 = 50 - Math.sin(rad) * 50;
  const x2 = 50 + Math.cos(rad) * 50;
  const y2 = 50 + Math.sin(rad) * 50;

  return {
    defNode: (
      <linearGradient
        id={gradId}
        x1={`${x1.toFixed(1)}%`}
        y1={`${y1.toFixed(1)}%`}
        x2={`${x2.toFixed(1)}%`}
        y2={`${y2.toFixed(1)}%`}
      >
        {stops}
      </linearGradient>
    ),
    fillAttr: `url(#${gradId})`,
  };
}

export const DynamicMotionStage: React.FC<DynamicMotionStageProps> = ({
  scene,
  localFrame,
  fps: fpsProp,
  tokens,
}) => {
  const videoConfig = useVideoConfig();
  const fps = finiteOr(fpsProp, videoConfig.fps || 30);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const gradId = `dms-bg-${uid}`;

  const spec: StudioVectorSpec | undefined = scene.vector;
  const elements = Array.isArray(spec?.elements)
    ? spec.elements.slice(0, MAX_ELEMENTS)
    : [];

  const { defNode, fillAttr } = renderBackgroundDef(spec?.bg, gradId, tokens);
  const lightBg = isBgLight(spec?.bg, tokens);
  const texts = sceneTexts(scene);
  const zoneBox = getZoneBox(spec?.textZone);

  const textAppear = appear(localFrame, 3, 14);
  const subAppear = appear(localFrame, 9, 14);

  const scrimBg = lightBg
    ? 'rgba(255, 255, 255, 0.78)'
    : 'rgba(8, 12, 24, 0.68)';
  const scrimBorder = hexToRgba(tokens.palette.accent, lightBg ? 0.32 : 0.42);
  const titleColor = lightBg ? '#0F172A' : '#FFFFFF';
  const subColor = lightBg ? '#334155' : 'rgba(241, 245, 249, 0.92)';

  const hasText = Boolean(texts.badge || texts.title || texts.subtitle);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        width: STAGE_W,
        height: STAGE_H,
        overflow: 'hidden',
      }}
    >
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0, display: 'block' }}
      >
        {defNode ? <defs>{defNode}</defs> : null}
        <rect x={0} y={0} width={STAGE_W} height={STAGE_H} fill={fillAttr} />
        {elements.map((el, idx) =>
          renderElement(
            el,
            `el-${el?.id || idx}`,
            0,
            localFrame,
            fps,
            tokens,
          ),
        )}
      </svg>

      {hasText ? (
        <div
          style={{
            position: 'absolute',
            left: 56,
            right: 56,
            top: zoneBox.top,
            maxHeight: zoneBox.maxHeight,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: '24px 32px',
            borderRadius: 28,
            backgroundColor: scrimBg,
            border: `2px solid ${scrimBorder}`,
            boxShadow: lightBg
              ? '0 14px 36px rgba(15, 23, 42, 0.12)'
              : '0 18px 46px rgba(2, 6, 23, 0.48)',
            opacity: textAppear,
            transform: `translate3d(0, ${((1 - textAppear) * 20).toFixed(1)}px, 0)`,
          }}
        >
          {texts.badge ? (
            <div
              style={{
                padding: '6px 20px',
                borderRadius: 999,
                backgroundColor: hexToRgba(tokens.palette.accent, lightBg ? 0.16 : 0.24),
                border: `1.5px solid ${hexToRgba(tokens.palette.accent, 0.6)}`,
              }}
            >
              <FitText
                text={texts.badge}
                baseSize={26}
                minSize={20}
                maxLines={1}
                color={lightBg ? tokens.palette.accentReadable : '#FFFFFF'}
                fontWeight={700}
              />
            </div>
          ) : null}

          {texts.title ? (
            <FitText
              text={texts.title}
              baseSize={54}
              minSize={30}
              maxLines={3}
              color={titleColor}
              fontWeight={800}
              align="center"
              lineHeight={1.28}
            />
          ) : null}

          {texts.subtitle ? (
            <div
              style={{
                width: '100%',
                opacity: subAppear,
                transform: `translate3d(0, ${((1 - subAppear) * 12).toFixed(1)}px, 0)`,
              }}
            >
              <FitText
                text={texts.subtitle}
                baseSize={32}
                minSize={22}
                maxLines={2}
                color={subColor}
                fontWeight={500}
                align="center"
                lineHeight={1.34}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
