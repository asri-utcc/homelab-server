import React from 'react';
import { interpolate, spring } from 'remotion';
import { THAI_FONT_FAMILY } from '../../components/ThaiFontLoader';
import { splitThaiWords } from '../families';
import type { StudioScene } from '../types';
import {
  FitText,
  SAFE_BOTTOM,
  STAGE_H,
  STAGE_W,
  clamp01,
  sceneTexts,
} from './kit';
import type { StyleDirectorDef, StyleShotArgs } from './types';

// ============================================================================
// SHARED HELPERS FOR BATCH Q
// look-45: Swiss Grid (กริดสวิส — International Typographic Style)
// Pure, Deterministic, Inline SVG/CSS Only, Zero External Assets
// Strictly 3 colors: Paper #F0F0E8, Ink #101010, Signal Red #F03820
// Zero opacity fade-in, zero gradients, zero shadows, zero glow, zero grain
// Safe stage bounds: x ∈ [54, 1026], y ∈ [112, CONTENT_BOTTOM (=1420)]
// Modular 4-column square grid: x ∈ [110, 970] (4 × 215px), y = 125 + r × 215px
// Bottom fifth (y > 1415): empty modular grid
// ============================================================================

const CONTENT_BOTTOM = SAFE_BOTTOM - 120; // 1420
const SAFE_X = 54;
const SAFE_TOP = 112;

const L45_MARGIN_X = 110; // x ∈ [110, 970], width = 860 = 4 × 215
const L45_GRID_W = STAGE_W - L45_MARGIN_X * 2; // 860
const L45_CELL = 215; // exact square module (860 / 4)
const L45_TOP_Y = 125; // row 0..6 => y = 125..1415 (<= CONTENT_BOTTOM 1420)

const L45_V_LINES = [0, 1, 2, 3, 4].map((c) => L45_MARGIN_X + c * L45_CELL);
// [110, 325, 540, 755, 970]
const L45_H_LINES = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((r) => L45_TOP_Y + r * L45_CELL);
// [125, 340, 555, 770, 985, 1200, 1415, 1630, 1845]

const L45 = {
  paper: '#F0F0E8',
  ink: '#101010',
  red: '#F03820',
  ink60: 'rgba(16, 16, 16, 0.6)',
  gridLine: 'rgba(16, 16, 16, 0.24)',
} as const;

const FONT_SWISS_Q = `'Public Sans', ${THAI_FONT_FAMILY}, sans-serif`;

// Spring presets tuned for International Typographic snap
// ~9% overshoot (ζ ≈ 0.608): circle rook steps & red field edge snaps
const L45_ROOK_SPRING = { stiffness: 340, damping: 20, mass: 0.8 };
// ~8% overshoot (ζ ≈ 0.627): headline row push-out from left margin
const L45_PUSH_SPRING = { stiffness: 320, damping: 20.3, mass: 0.82 };
// Crisp drop for grid-anchored captions (~4% overshoot)
const L45_DROP_SPRING = { stiffness: 360, damping: 24, mass: 0.78 };

function colX(col: number): number {
  return L45_MARGIN_X + col * L45_CELL;
}

function rowY(row: number): number {
  return L45_TOP_Y + row * L45_CELL;
}

function easeOutQuartQ(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 4);
}

function padTwoQ(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function haystackOfQ(scene: StudioScene): string {
  const t = sceneTexts(scene);
  const hl = Array.isArray(scene.highlight) ? scene.highlight.join(' ') : String(scene.highlight || '');
  return [
    t.badge,
    t.title,
    t.subtitle,
    hl,
    ...t.bullets,
    scene.stat?.label || '',
    scene.stat?.delta || '',
    scene.quote?.text || '',
    scene.compare?.leftTitle || '',
    scene.compare?.rightTitle || '',
  ].join(' ');
}

function parseNumericQ(raw: string | number | undefined, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw || '').replace(/,/g, '');
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return fallback;
  const val = parseFloat(m[0]);
  return Number.isFinite(val) ? val : fallback;
}

interface L45ListItem {
  num: string;
  title: string;
  detail: string;
}

function extractListItemsQ(scene: StudioScene, max = 4): L45ListItem[] {
  const t = sceneTexts(scene);
  const out: L45ListItem[] = [];

  if (Array.isArray(scene.steps) && scene.steps.length > 0) {
    scene.steps.forEach((s, idx) => {
      if (typeof s === 'string') {
        const clean = s.trim();
        if (clean) out.push({ num: padTwoQ(idx + 1), title: clean, detail: '' });
      } else if (s?.title) {
        const numRaw = String(s.step || '').trim();
        const num = numRaw && numRaw.length <= 3 ? numRaw.padStart(2, '0') : padTwoQ(idx + 1);
        out.push({
          num,
          title: String(s.title).trim(),
          detail: String(s.detail || '').trim(),
        });
      }
    });
  } else if (t.bullets.length > 0) {
    t.bullets.forEach((b, idx) => {
      out.push({ num: padTwoQ(idx + 1), title: b, detail: '' });
    });
  } else if (scene.compare) {
    const combined = [...(scene.compare.leftItems || []), ...(scene.compare.rightItems || [])];
    combined.forEach((item, idx) => {
      const clean = String(item || '').trim();
      if (clean) out.push({ num: padTwoQ(idx + 1), title: clean, detail: '' });
    });
  } else if (t.subtitle) {
    out.push({ num: '01', title: t.subtitle, detail: '' });
  }

  if (out.length === 0 && t.title) {
    out.push({ num: '01', title: t.title, detail: '' });
  }
  return out.slice(0, max);
}

interface L45MetricInfo {
  big: string;
  prefix: string;
  suffix: string;
  numeric: number;
  decimals: number;
  hasNumber: boolean;
  unit: string;
  label: string;
  delta: string;
}

function extractPrimaryMetricQ(scene: StudioScene): L45MetricInfo {
  const t = sceneTexts(scene);
  if (scene.stat?.value !== undefined && String(scene.stat.value).trim()) {
    const rawVal = String(scene.stat.value).trim();
    const rawPrefix = String(scene.stat.prefix || '').trim();
    const rawSuffix = String(scene.stat.suffix || '').trim();
    const effPrefix = rawPrefix && !rawVal.startsWith(rawPrefix) ? rawPrefix : '';
    const effSuffix = rawSuffix && !rawVal.endsWith(rawSuffix) ? rawSuffix : '';
    const full = `${effPrefix}${rawVal}${effSuffix}`.trim();
    const numMatch = full.match(/^([^\d-]*)(-?\d[\d,]*(?:\.\d+)?)(.*)$/);
    if (numMatch) {
      const numStr = numMatch[2].replace(/,/g, '');
      const decIdx = numStr.indexOf('.');
      const decimals = decIdx >= 0 ? numStr.length - decIdx - 1 : 0;
      return {
        big: full,
        prefix: numMatch[1],
        suffix: numMatch[3],
        numeric: parseFloat(numStr),
        decimals,
        hasNumber: true,
        unit: String(scene.stat.unit || '').trim(),
        label: String(scene.stat.label || t.subtitle || t.title).trim(),
        delta: String(scene.stat.delta || '').trim(),
      };
    }
    return {
      big: full,
      prefix: '',
      suffix: '',
      numeric: scene.stat.numericValue ?? parseNumericQ(rawVal, 100),
      decimals: 0,
      hasNumber: false,
      unit: String(scene.stat.unit || '').trim(),
      label: String(scene.stat.label || t.subtitle || t.title).trim(),
      delta: String(scene.stat.delta || '').trim(),
    };
  }

  if (t.numbers.length > 0) {
    const first = t.numbers[0];
    const numMatch = first.match(/^([^\d-]*)(-?\d[\d,]*(?:\.\d+)?)(.*)$/);
    if (numMatch) {
      const numStr = numMatch[2].replace(/,/g, '');
      const decIdx = numStr.indexOf('.');
      return {
        big: first,
        prefix: numMatch[1],
        suffix: numMatch[3],
        numeric: parseFloat(numStr),
        decimals: decIdx >= 0 ? numStr.length - decIdx - 1 : 0,
        hasNumber: true,
        unit: '',
        label: t.subtitle || t.title,
        delta: t.badge,
      };
    }
  }

  return {
    big: '100%',
    prefix: '',
    suffix: '%',
    numeric: 100,
    decimals: 0,
    hasNumber: true,
    unit: 'INDEX',
    label: t.subtitle || t.title,
    delta: t.badge,
  };
}

/**
 * Split Thai/Latin text into 2 or 3 balanced rows using splitThaiWords so
 * no Thai word is broken mid-syllable and no row is an awkward orphan.
 */
function splitIntoRowsQ(text: string, maxRows: 2 | 3 = 3): string[] {
  const clean = String(text || '').trim().replace(/\s+/g, ' ');
  if (!clean) return [''];

  const rawTokens = splitThaiWords(clean);
  const words: string[] = [];
  for (const tok of rawTokens) {
    if (!tok) continue;
    if (/^\s+$/.test(tok)) {
      if (words.length > 0 && !words[words.length - 1].endsWith(' ')) {
        words[words.length - 1] += ' ';
      }
    } else {
      words.push(tok);
    }
  }

  if (words.length <= 1) return [clean];

  const desiredRows = clean.length <= 14 ? 2 : maxRows;
  const rowCount = Math.min(desiredRows, words.length);
  if (rowCount <= 1) return [clean];

  const totalLen = words.reduce((acc, w) => acc + w.length, 0);
  const targetLen = totalLen / rowCount;

  const rows: string[] = [];
  let current = '';
  let remainingLen = totalLen;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const rowsLeft = rowCount - rows.length;
    const wordsLeft = words.length - i;

    if (rowsLeft <= 1) {
      current += w;
      continue;
    }

    if (current.length > 0 && wordsLeft <= rowsLeft) {
      rows.push(current.trim());
      current = w;
      remainingLen -= w.length;
      continue;
    }

    const dynamicTarget = remainingLen / rowsLeft;
    const nextLen = current.length + w.length;

    if (
      current.length > 0 &&
      nextLen > dynamicTarget * 1.12 &&
      Math.abs(current.length - targetLen) <= Math.abs(nextLen - targetLen)
    ) {
      rows.push(current.trim());
      current = w;
    } else {
      current += w;
    }
    remainingLen -= w.length;
  }

  if (current.trim()) rows.push(current.trim());
  return rows.slice(0, maxRows);
}

// ============================================================================
// CORE SWISS GRID PRIMITIVES (ZERO OPACITY FADE-IN)
// ============================================================================

/**
 * 4-column modular square grid (2px lines edge-to-edge) on #F0F0E8 paper.
 * Already halfway drawn on frame 0; vertical lines drop down and horizontal
 * lines sweep across, staggered 2 frames apart, settling completely by f20.
 */
const Look45SwissGrid: React.FC<{ localFrame: number }> = ({ localFrame }) => {
  return (
    <svg
      width={STAGE_W}
      height={STAGE_H}
      viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: STAGE_W,
        height: STAGE_H,
        pointerEvents: 'none',
        zIndex: 1,
      }}
    >
      {/* Flat paper base — zero gradient, zero grain */}
      <rect x={0} y={0} width={STAGE_W} height={STAGE_H} fill={L45.paper} />

      {/* 5 Vertical 2px grid lines dropping top-to-bottom (pre-rolled at f0) */}
      {L45_V_LINES.map((x, i) => {
        const p = easeOutQuartQ((localFrame + 9 - i * 2) / 14);
        const h = p * STAGE_H;
        return (
          <rect
            key={`v-${i}`}
            x={x - 1}
            y={0}
            width={2}
            height={h}
            fill={L45.gridLine}
          />
        );
      })}

      {/* 9 Horizontal 2px grid lines sweeping left-to-right (pre-rolled at f0) */}
      {L45_H_LINES.map((y, j) => {
        const p = easeOutQuartQ((localFrame + 9 - j * 2) / 14);
        const w = p * STAGE_W;
        return (
          <rect
            key={`h-${j}`}
            x={0}
            y={y - 1}
            width={w}
            height={2}
            fill={L45.gridLine}
          />
        );
      })}
    </svg>
  );
};

interface L45RookWaypoint {
  col: number;
  row: number;
  startFrame: number;
}

interface Look45RookCircleProps {
  localFrame: number;
  fps: number;
  filterId: string;
  waypoints: L45RookWaypoint[];
  expandStartFrame: number;
  finalCenter: { x: number; y: number };
  finalModules?: 1 | 2;
  zIndex?: number;
}

/**
 * Pure black (#101010) Swiss circle that rook-steps orthogonally cell-to-cell
 * on ~9% overshoot springs with directional single-axis SVG feGaussianBlur,
 * then pulls back ~10% and expands into its final 1- or 2-module form on a
 * grid intersection (settled by ~f70). Zero opacity fade-in.
 */
const Look45RookCircle: React.FC<Look45RookCircleProps> = ({
  localFrame,
  fps,
  filterId,
  waypoints,
  expandStartFrame,
  finalCenter,
  finalModules = 2,
  zIndex = 3,
}) => {
  const baseR = L45_CELL / 2; // 107.5px (1 module diameter = 215px)
  const targetR = finalModules === 2 ? L45_CELL : L45_CELL / 2; // 215px or 107.5px

  const evalState = (f: number): { cx: number; cy: number; r: number } => {
    const clampedF = Math.max(0, f);
    const first = waypoints[0];
    let cx = colX(first.col) + baseR;
    let cy = rowY(first.row) + baseR;

    for (let i = 1; i < waypoints.length; i++) {
      const prev = waypoints[i - 1];
      const curr = waypoints[i];
      if (clampedF >= curr.startFrame) {
        const s = spring({
          frame: clampedF - curr.startFrame,
          fps,
          config: L45_ROOK_SPRING,
        });
        const dx = (curr.col - prev.col) * L45_CELL;
        const dy = (curr.row - prev.row) * L45_CELL;
        cx += dx * s;
        cy += dy * s;
      }
    }

    let r = baseR;
    const pullbackDur = 5;
    const expandFrame = expandStartFrame + pullbackDur;

    if (clampedF >= expandStartFrame && clampedF < expandFrame) {
      const t = clamp01((clampedF - expandStartFrame) / pullbackDur);
      const pull = Math.sin(t * Math.PI * 0.5);
      r = baseR * (1 - 0.1 * pull); // pulls back 10%
    } else if (clampedF >= expandFrame) {
      const sExp = spring({
        frame: clampedF - expandFrame,
        fps,
        config: L45_ROOK_SPRING,
      });
      const pullR = baseR * 0.9;
      r = pullR + (targetR - pullR) * sExp;
      cx = cx + (finalCenter.x - cx) * sExp;
      cy = cy + (finalCenter.y - cy) * sExp;
    }

    return { cx, cy, r: Math.max(1, r) };
  };

  const now = evalState(localFrame);
  const prev = evalState(localFrame - 1);

  const vx = Math.abs(now.cx - prev.cx);
  const vy = Math.abs(now.cy - prev.cy);
  const vr = Math.abs(now.r - prev.r);

  // Axis-locked directional motion blur proportional to velocity
  const blurX = vx > 0.35 ? Math.min(26, vx * 0.32) : vr > 0.6 ? Math.min(10, vr * 0.18) : 0;
  const blurY = vy > 0.35 ? Math.min(26, vy * 0.32) : vr > 0.6 ? Math.min(10, vr * 0.18) : 0;
  const useBlur = blurX > 0.3 || blurY > 0.3;

  return (
    <svg
      width={STAGE_W}
      height={STAGE_H}
      viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: STAGE_W,
        height: STAGE_H,
        pointerEvents: 'none',
        zIndex,
      }}
    >
      {useBlur ? (
        <defs>
          <filter id={filterId} x="-35%" y="-35%" width="170%" height="170%">
            <feGaussianBlur
              in="SourceGraphic"
              stdDeviation={`${blurX.toFixed(2)} ${blurY.toFixed(2)}`}
            />
          </filter>
        </defs>
      ) : null}
      <circle
        cx={now.cx}
        cy={now.cy}
        r={now.r}
        fill={L45.ink}
        filter={useBlur ? `url(#${filterId})` : undefined}
      />
    </svg>
  );
};

interface Look45RedFieldProps {
  localFrame: number;
  fps: number;
  originCol: number;
  originRow: number;
  targetLeft: number;
  targetTop: number;
  targetRight: number;
  targetBottom: number;
  startFrame: number;
  zIndex?: number;
}

/**
 * Signal-red (#F03820) field blooming out of the cell where the circle stops:
 * 1) expands inside the stop cell behind the circle
 * 2) snaps horizontal edges across columns onto grid lines (~9% overshoot)
 * 3) snaps vertical edges along rows onto grid lines (~9% overshoot)
 * Can bleed cleanly to top (0) or right (STAGE_W). Zero opacity fade-in.
 */
const Look45RedField: React.FC<Look45RedFieldProps> = ({
  localFrame,
  fps,
  originCol,
  originRow,
  targetLeft,
  targetTop,
  targetRight,
  targetBottom,
  startFrame,
  zIndex = 2,
}) => {
  if (localFrame < startFrame) return null;

  const cellLeft = colX(originCol);
  const cellRight = colX(originCol + 1);
  const cellTop = rowY(originRow);
  const cellBottom = rowY(originRow + 1);
  const cellCx = (cellLeft + cellRight) / 2;
  const cellCy = (cellTop + cellBottom) / 2;

  // Step 1: bloom out of stop cell center to fill the stop cell
  const sCell = spring({
    frame: Math.max(0, localFrame - startFrame),
    fps,
    config: L45_ROOK_SPRING,
  });

  // Step 2: snap horizontal edges across columns
  const hStart = startFrame + 5;
  const sHoriz =
    localFrame >= hStart
      ? spring({
          frame: localFrame - hStart,
          fps,
          config: L45_ROOK_SPRING,
        })
      : 0;

  // Step 3: snap vertical edges along rows
  const vStart = startFrame + 10;
  const sVert =
    localFrame >= vStart
      ? spring({
          frame: localFrame - vStart,
          fps,
          config: L45_ROOK_SPRING,
        })
      : 0;

  const baseLeft = cellCx + (cellLeft - cellCx) * sCell;
  const baseRight = cellCx + (cellRight - cellCx) * sCell;
  const baseTop = cellCy + (cellTop - cellCy) * sCell;
  const baseBottom = cellCy + (cellBottom - cellCy) * sCell;

  const rawLeft = baseLeft + (targetLeft - cellLeft) * sHoriz;
  const rawRight = baseRight + (targetRight - cellRight) * sHoriz;
  const rawTop = baseTop + (targetTop - cellTop) * sVert;
  const rawBottom = baseBottom + (targetBottom - cellBottom) * sVert;

  const left = Math.max(0, Math.min(STAGE_W, rawLeft));
  const right = Math.max(left, Math.min(STAGE_W, rawRight));
  const top = Math.max(0, Math.min(STAGE_H, rawTop));
  const bottom = Math.max(top, Math.min(STAGE_H, rawBottom));

  const width = right - left;
  const height = bottom - top;
  if (width <= 0.5 || height <= 0.5) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width,
        height,
        backgroundColor: L45.red,
        pointerEvents: 'none',
        zIndex,
      }}
    />
  );
};

interface Look45PushOutRowProps {
  localFrame: number;
  fps: number;
  delay: number;
  left: number;
  top: number;
  width: number;
  height: number;
  alignItems?: 'flex-start' | 'center' | 'flex-end';
  paddingBottom?: number;
  paddingTop?: number;
  zIndex?: number;
  children: React.ReactNode;
}

/**
 * Flush-left Swiss text row pushed out of its left margin grid line.
 * Overshoots ~8% rightward then locks cleanly onto the left margin line.
 * Clipped ONLY at the left margin (never clips upper/lower Thai vowels).
 * Zero opacity fade-in.
 */
const Look45PushOutRow: React.FC<Look45PushOutRowProps> = ({
  localFrame,
  fps,
  delay,
  left,
  top,
  width,
  height,
  alignItems = 'flex-end',
  paddingBottom = 14,
  paddingTop = 0,
  zIndex = 5,
  children,
}) => {
  const active = localFrame >= delay;
  const s = active
    ? spring({
        frame: localFrame - delay,
        fps,
        config: L45_PUSH_SPRING,
      })
    : 0;

  // Starts fully hidden behind left margin line, overshoots ~8% right, locks at 0
  const rawTx = active ? (s - 1) * width : -(width + 32);
  const tx = Math.min(68, rawTx);

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width,
        height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: alignItems,
        paddingBottom,
        paddingTop,
        boxSizing: 'border-box',
        // Clip strictly on left edge (0px); keep vertical & overshoot headroom open for Thai vowels
        clipPath: 'inset(-42px -96px -42px 0px)',
        pointerEvents: 'none',
        zIndex,
      }}
    >
      <div
        style={{
          width: '100%',
          transform: `translateX(${tx.toFixed(2)}px)`,
          textAlign: 'left',
        }}
      >
        {children}
      </div>
    </div>
  );
};

interface Look45GridDropBlockProps {
  localFrame: number;
  fps: number;
  delay: number;
  left: number;
  top: number;
  width: number;
  height: number;
  zIndex?: number;
  children: React.ReactNode;
}

/**
 * Drops a block down cleanly from a horizontal grid line via top-edge clip.
 * Zero opacity fade-in.
 */
const Look45GridDropBlock: React.FC<Look45GridDropBlockProps> = ({
  localFrame,
  fps,
  delay,
  left,
  top,
  width,
  height,
  zIndex = 5,
  children,
}) => {
  const active = localFrame >= delay;
  const s = active
    ? spring({
        frame: localFrame - delay,
        fps,
        config: L45_DROP_SPRING,
      })
    : 0;

  const ty = active ? (s - 1) * (height + 16) : -(height + 32);

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width,
        height,
        boxSizing: 'border-box',
        clipPath: 'inset(0px -16px -24px -16px)',
        pointerEvents: 'none',
        zIndex,
      }}
    >
      <div
        style={{
          width: '100%',
          transform: `translateY(${ty.toFixed(2)}px)`,
          textAlign: 'left',
        }}
      >
        {children}
      </div>
    </div>
  );
};

interface Look45NumberedCaptionProps {
  localFrame: number;
  fps: number;
  delay: number;
  left: number;
  top: number;
  width: number;
  height?: number;
  num: string;
  label: string;
  baseSize?: number;
  minSize?: number;
  maxLines?: number;
  zIndex?: number;
}

/**
 * Small Swiss caption dropped from a horizontal grid line:
 * weight 600, full-ink (#101010) tabular number + 60% ink words.
 */
const Look45NumberedCaption: React.FC<Look45NumberedCaptionProps> = ({
  localFrame,
  fps,
  delay,
  left,
  top,
  width,
  height = L45_CELL,
  num,
  label,
  baseSize = 28,
  minSize = 20,
  maxLines = 3,
  zIndex = 5,
}) => {
  return (
    <Look45GridDropBlock
      localFrame={localFrame}
      fps={fps}
      delay={delay}
      left={left}
      top={top}
      width={width}
      height={height}
      zIndex={zIndex}
    >
      <div
        style={{
          paddingTop: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          textAlign: 'left',
        }}
      >
        <div
          style={{
            fontFamily: FONT_SWISS_Q,
            fontSize: Math.max(20, Math.round(baseSize * 0.88)),
            fontWeight: 600,
            color: L45.ink,
            letterSpacing: '-0.02em',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1.1,
            textAlign: 'left',
          }}
        >
          {num}
        </div>
        {label ? (
          <FitText
            text={label}
            baseSize={baseSize}
            minSize={minSize}
            maxLines={maxLines}
            color={L45.ink60}
            fontFamily={FONT_SWISS_Q}
            fontWeight={600}
            align="left"
            lineHeight={1.28}
            style={{ letterSpacing: '-0.015em' }}
          />
        ) : null}
      </div>
    </Look45GridDropBlock>
  );
};

/**
 * Crisp 2px full-ink structural accent rule that draws left-to-right or top-to-bottom.
 */
const Look45AccentRule: React.FC<{
  localFrame: number;
  delay: number;
  dur?: number;
  left: number;
  top: number;
  length: number;
  orientation: 'h' | 'v';
  zIndex?: number;
}> = ({ localFrame, delay, dur = 12, left, top, length, orientation, zIndex = 4 }) => {
  const p = easeOutQuartQ((localFrame - delay) / dur);
  if (p <= 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: orientation === 'v' ? left - 1 : left,
        top: orientation === 'h' ? top - 1 : top,
        width: orientation === 'h' ? length * p : 2,
        height: orientation === 'v' ? length * p : 2,
        backgroundColor: L45.ink,
        pointerEvents: 'none',
        zIndex,
      }}
    />
  );
};

// ============================================================================
// SHOT 1: 'swiss-manifesto-title' — แถลงการณ์กริดสวิส 3 แถว + พื้นแดง + วงกลม
// ============================================================================

const Look45SwissManifestoTitle: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  fps,
}) => {
  const t = sceneTexts(scene);
  const titleRows = splitIntoRowsQ(t.title || t.subtitle || 'SWISS GRID', 3);
  const badgeClean = t.badge || `SECTION ${padTwoQ(sceneIndex + 1)}`;
  const primaryCaption = t.subtitle || t.bullets[0] || '';
  const secondaryCaption =
    (t.subtitle ? t.bullets[0] : t.bullets[1]) || t.numbers[0] || `NO. ${padTwoQ(sceneIndex + 1)}`;

  // Rook path: orthogonal cell-to-cell moves ending at (3, 1), then expands to 2-module circle at (colX(3), rowY(1))
  const rookWaypoints: L45RookWaypoint[] = [
    { col: 0, row: 0, startFrame: 0 },
    { col: 2, row: 0, startFrame: 3 },
    { col: 2, row: 1, startFrame: 10 },
    { col: 3, row: 1, startFrame: 17 },
  ];

  // Align title rows cleanly onto rows 2, 3, 4 (row 2 prints directly across the red field!)
  const startRow = titleRows.length === 2 ? 3 : 2;
  const maxRowLen = titleRows.reduce((m, r) => Math.max(m, r.length), 0);
  const rowBaseSize = maxRowLen > 20 ? 64 : maxRowLen > 14 ? 76 : 88;

  return (
    <div
      style={{
        position: 'relative',
        width: STAGE_W,
        height: STAGE_H,
        overflow: 'hidden',
        backgroundColor: L45.paper,
      }}
    >
      {/* 1. 4-column modular 2px grid (halfway drawn on frame 0) */}
      <Look45SwissGrid localFrame={localFrame} />

      {/* 2. Signal-red field blooming out of (3,1), bleeding top & right, snapping to x=540 & y=770 */}
      <Look45RedField
        localFrame={localFrame}
        fps={fps}
        originCol={3}
        originRow={1}
        targetLeft={colX(2)}
        targetTop={0}
        targetRight={STAGE_W}
        targetBottom={rowY(3)}
        startFrame={18}
        zIndex={2}
      />

      {/* 3. Black rook circle stepping cell-to-cell with motion blur, then expanding to 2 modules */}
      <Look45RookCircle
        localFrame={localFrame}
        fps={fps}
        filterId={`l45-title-blur-${sceneIndex}`}
        waypoints={rookWaypoints}
        expandStartFrame={46}
        finalCenter={{ x: colX(3), y: rowY(1) }}
        finalModules={2}
        zIndex={3}
      />

      {/* 4. Top-left numbered caption dropped from rowY(0) = 125 */}
      <Look45NumberedCaption
        localFrame={localFrame}
        fps={fps}
        delay={26}
        left={colX(0)}
        top={rowY(0)}
        width={L45_CELL * 2 - 20}
        height={L45_CELL}
        num={padTwoQ(sceneIndex + 1)}
        label={badgeClean}
        baseSize={28}
        minSize={20}
        maxLines={2}
        zIndex={5}
      />

      {/* 5. Flush-left headline rows pushed out of left margin x=110 (staggered 6f, ~8% overshoot) */}
      {titleRows.map((rowText, idx) => (
        <Look45PushOutRow
          key={`row-${idx}`}
          localFrame={localFrame}
          fps={fps}
          delay={22 + idx * 6}
          left={colX(0)}
          top={rowY(startRow + idx)}
          width={L45_GRID_W}
          height={L45_CELL}
          alignItems="flex-end"
          paddingBottom={14}
          zIndex={5}
        >
          <FitText
            text={rowText}
            baseSize={rowBaseSize}
            minSize={40}
            maxLines={2}
            color={L45.ink}
            fontFamily={FONT_SWISS_Q}
            fontWeight={800}
            align="left"
            lineHeight={1.16}
            style={{ letterSpacing: '-0.02em' }}
          />
        </Look45PushOutRow>
      ))}

      {/* 6. Crisp full-ink horizontal rule on rowY(5) = 1200 before footer captions */}
      <Look45AccentRule
        localFrame={localFrame}
        delay={38}
        dur={12}
        left={colX(0)}
        top={rowY(5)}
        length={L45_GRID_W}
        orientation="h"
        zIndex={4}
      />

      {/* 7. Bottom metadata captions dropped from rowY(5) = 1200 (strictly above rowY(6) = 1415) */}
      <Look45NumberedCaption
        localFrame={localFrame}
        fps={fps}
        delay={40}
        left={colX(0)}
        top={rowY(5)}
        width={L45_CELL * 3 - 24}
        height={L45_CELL}
        num="01"
        label={primaryCaption || t.title}
        baseSize={28}
        minSize={20}
        maxLines={3}
        zIndex={5}
      />

      <Look45NumberedCaption
        localFrame={localFrame}
        fps={fps}
        delay={46}
        left={colX(3)}
        top={rowY(5)}
        width={L45_CELL}
        height={L45_CELL}
        num="02"
        label={secondaryCaption}
        baseSize={24}
        minSize={18}
        maxLines={3}
        zIndex={5}
      />
    </div>
  );
};

// ============================================================================
// SHOT 2: 'swiss-numbered-list' — รายการลำดับ 01/02/03 บนกริดโมดูล
// ============================================================================

const Look45SwissNumberedList: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  fps,
}) => {
  const t = sceneTexts(scene);
  const items = extractListItemsQ(scene, 4);
  const badgeClean = t.badge || `INDEX ${padTwoQ(sceneIndex + 1)}`;

  // Rook path along top rows ending at cell (3, 0), locking cleanly as a 1-module circle
  const rookWaypoints: L45RookWaypoint[] = [
    { col: 0, row: 1, startFrame: 0 },
    { col: 3, row: 1, startFrame: 4 },
    { col: 3, row: 0, startFrame: 12 },
  ];

  // Header sits in row 0 (y=125..340), items occupy rows 1..4 (y=340..1200), footer in row 5 (y=1200..1415)
  const footerCaption = t.subtitle || `${padTwoQ(items.length)} ITEMS · ${badgeClean}`;

  return (
    <div
      style={{
        position: 'relative',
        width: STAGE_W,
        height: STAGE_H,
        overflow: 'hidden',
        backgroundColor: L45.paper,
      }}
    >
      {/* 1. 4-column modular 2px grid */}
      <Look45SwissGrid localFrame={localFrame} />

      {/* 2. Red field blooming from (3,0), covering cols 2-3 + top & right bleed (x=540..1080, y=0..340) */}
      <Look45RedField
        localFrame={localFrame}
        fps={fps}
        originCol={3}
        originRow={0}
        targetLeft={colX(2)}
        targetTop={0}
        targetRight={STAGE_W}
        targetBottom={rowY(1)}
        startFrame={15}
        zIndex={2}
      />

      {/* 3. Black circle rook-stepping into cell (3,0), pullback 10% and locking as exact 1-module circle */}
      <Look45RookCircle
        localFrame={localFrame}
        fps={fps}
        filterId={`l45-list-blur-${sceneIndex}`}
        waypoints={rookWaypoints}
        expandStartFrame={46}
        finalCenter={{ x: colX(3) + L45_CELL / 2, y: rowY(0) + L45_CELL / 2 }}
        finalModules={1}
        zIndex={3}
      />

      {/* 4. Top-row headline pushed out of left margin x=110 (cols 0..2, never overlaps circle in col 3) */}
      <Look45PushOutRow
        localFrame={localFrame}
        fps={fps}
        delay={20}
        left={colX(0)}
        top={rowY(0)}
        width={L45_CELL * 3 - 20}
        height={L45_CELL}
        alignItems="flex-end"
        paddingBottom={16}
        zIndex={5}
      >
        <FitText
          text={t.title || badgeClean}
          baseSize={52}
          minSize={30}
          maxLines={2}
          color={L45.ink}
          fontFamily={FONT_SWISS_Q}
          fontWeight={800}
          align="left"
          lineHeight={1.18}
          style={{ letterSpacing: '-0.02em' }}
        />
      </Look45PushOutRow>

      {/* Bold structural baseline rule under header on rowY(1) = 340 */}
      <Look45AccentRule
        localFrame={localFrame}
        delay={22}
        dur={12}
        left={colX(0)}
        top={rowY(1)}
        length={L45_GRID_W}
        orientation="h"
        zIndex={4}
      />

      {/* 5. Numbered list rows on exact square modules (rows 1..4) */}
      {items.map((item, idx) => {
        const yTop = rowY(1 + idx);
        const rowDelay = 24 + idx * 6;
        const hasDetail = Boolean(item.detail);

        return (
          <React.Fragment key={`item-${idx}`}>
            {/* Tabular index number dropping cleanly from horizontal grid line rowY(1 + idx) */}
            <Look45GridDropBlock
              localFrame={localFrame}
              fps={fps}
              delay={rowDelay}
              left={colX(0)}
              top={yTop}
              width={L45_CELL - 16}
              height={L45_CELL}
              zIndex={5}
            >
              <div
                style={{
                  paddingTop: 22,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  textAlign: 'left',
                }}
              >
                <div
                  style={{
                    fontFamily: FONT_SWISS_Q,
                    fontSize: 74,
                    fontWeight: 800,
                    color: L45.ink,
                    letterSpacing: '-0.02em',
                    fontVariantNumeric: 'tabular-nums',
                    lineHeight: 0.96,
                    textAlign: 'left',
                  }}
                >
                  {item.num}
                </div>
                <div
                  style={{
                    width: 44,
                    height: 4,
                    backgroundColor: idx === 0 ? L45.red : L45.ink,
                  }}
                />
              </div>
            </Look45GridDropBlock>

            {/* Item body pushed out from colX(1) = 325, staggered 6f, ~8% overshoot */}
            <Look45PushOutRow
              localFrame={localFrame}
              fps={fps}
              delay={rowDelay + 2}
              left={colX(1)}
              top={yTop}
              width={L45_CELL * 3}
              height={L45_CELL}
              alignItems="center"
              paddingBottom={8}
              paddingTop={8}
              zIndex={5}
            >
              <div
                style={{
                  paddingLeft: 18,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: hasDetail ? 8 : 0,
                  textAlign: 'left',
                }}
              >
                <FitText
                  text={item.title}
                  baseSize={hasDetail ? 36 : 38}
                  minSize={24}
                  maxLines={hasDetail ? 2 : 3}
                  color={L45.ink}
                  fontFamily={FONT_SWISS_Q}
                  fontWeight={800}
                  align="left"
                  lineHeight={1.24}
                  style={{ letterSpacing: '-0.02em' }}
                />
                {hasDetail ? (
                  <FitText
                    text={item.detail}
                    baseSize={25}
                    minSize={19}
                    maxLines={2}
                    color={L45.ink60}
                    fontFamily={FONT_SWISS_Q}
                    fontWeight={600}
                    align="left"
                    lineHeight={1.28}
                    style={{ letterSpacing: '-0.015em' }}
                  />
                ) : null}
              </div>
            </Look45PushOutRow>
          </React.Fragment>
        );
      })}

      {/* 6. Structural rule & footer caption in row 5 (y=1200..1415), empty grid below 1415 */}
      <Look45AccentRule
        localFrame={localFrame}
        delay={42}
        dur={12}
        left={colX(0)}
        top={rowY(5)}
        length={L45_GRID_W}
        orientation="h"
        zIndex={4}
      />

      <Look45NumberedCaption
        localFrame={localFrame}
        fps={fps}
        delay={44}
        left={colX(0)}
        top={rowY(5)}
        width={L45_CELL * 3 - 20}
        height={L45_CELL}
        num={padTwoQ(sceneIndex + 1)}
        label={footerCaption}
        baseSize={26}
        minSize={20}
        maxLines={2}
        zIndex={5}
      />

      <Look45NumberedCaption
        localFrame={localFrame}
        fps={fps}
        delay={48}
        left={colX(3)}
        top={rowY(5)}
        width={L45_CELL}
        height={L45_CELL}
        num={padTwoQ(items.length)}
        label="POINTS"
        baseSize={24}
        minSize={18}
        maxLines={2}
        zIndex={5}
      />
    </div>
  );
};

// ============================================================================
// SHOT 3: 'swiss-kpi-field' — ตัวเลขใหญ่ในพื้นแดง + วงกลม + คำอธิบาย
// ============================================================================

const Look45SwissKpiField: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  fps,
}) => {
  const t = sceneTexts(scene);
  const metric = extractPrimaryMetricQ(scene);
  const badgeClean = t.badge || metric.unit || `DATA ${padTwoQ(sceneIndex + 1)}`;

  // Rook path: ends at (2, 2) so red field blooms out of it, then expands to 2-module circle at (colX(3), rowY(1))
  const rookWaypoints: L45RookWaypoint[] = [
    { col: 0, row: 0, startFrame: 0 },
    { col: 3, row: 0, startFrame: 3 },
    { col: 3, row: 2, startFrame: 10 },
    { col: 2, row: 2, startFrame: 17 },
  ];

  // Crisp tabular count-up while pushing out (locks to exact string at f42)
  const countProgress = easeOutQuartQ((localFrame - 22) / 20);
  let displayBig = metric.big;
  if (metric.hasNumber && countProgress < 1) {
    const val = metric.numeric * countProgress;
    const formatted =
      metric.decimals > 0
        ? val.toFixed(metric.decimals)
        : Math.round(val).toString();
    displayBig = `${metric.prefix}${formatted}${metric.suffix}`;
  }

  const bigLen = metric.big.length;
  const bigFontSize = bigLen <= 4 ? 210 : bigLen <= 6 ? 168 : bigLen <= 9 ? 124 : 92;

  return (
    <div
      style={{
        position: 'relative',
        width: STAGE_W,
        height: STAGE_H,
        overflow: 'hidden',
        backgroundColor: L45.paper,
      }}
    >
      {/* 1. 4-column modular 2px grid */}
      <Look45SwissGrid localFrame={localFrame} />

      {/* 2. Large signal-red KPI field spanning x=110..1080 (right bleed), y=340..985 (rows 1..3) */}
      <Look45RedField
        localFrame={localFrame}
        fps={fps}
        originCol={2}
        originRow={2}
        targetLeft={colX(0)}
        targetTop={rowY(1)}
        targetRight={STAGE_W}
        targetBottom={rowY(4)}
        startFrame={18}
        zIndex={2}
      />

      {/* 3. Black circle rook-stepping and expanding into 2-module circle at (colX(3), rowY(1)) = (755, 340) */}
      <Look45RookCircle
        localFrame={localFrame}
        fps={fps}
        filterId={`l45-kpi-blur-${sceneIndex}`}
        waypoints={rookWaypoints}
        expandStartFrame={46}
        finalCenter={{ x: colX(3), y: rowY(1) }}
        finalModules={2}
        zIndex={3}
      />

      {/* 4. Top-left numbered caption in cols 0..1 (x=110..520, y=125..340 — clear of circle) */}
      <Look45NumberedCaption
        localFrame={localFrame}
        fps={fps}
        delay={24}
        left={colX(0)}
        top={rowY(0)}
        width={L45_CELL * 2 - 20}
        height={L45_CELL}
        num={padTwoQ(sceneIndex + 1)}
        label={badgeClean}
        baseSize={28}
        minSize={20}
        maxLines={2}
        zIndex={5}
      />

      {/* 5. Small unit / delta indicator inside red field row 1 left (x=110..520, y=340..555 — clear of circle) */}
      {metric.unit || metric.delta ? (
        <Look45GridDropBlock
          localFrame={localFrame}
          fps={fps}
          delay={28}
          left={colX(0)}
          top={rowY(1)}
          width={L45_CELL * 2 - 20}
          height={L45_CELL}
          zIndex={5}
        >
          <div
            style={{
              paddingTop: 22,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              textAlign: 'left',
            }}
          >
            <div
              style={{
                fontFamily: FONT_SWISS_Q,
                fontSize: 28,
                fontWeight: 800,
                color: L45.ink,
                letterSpacing: '-0.02em',
                textAlign: 'left',
              }}
            >
              {metric.unit || 'METRIC'}
            </div>
            {metric.delta ? (
              <FitText
                text={metric.delta}
                baseSize={28}
                minSize={20}
                maxLines={2}
                color={L45.ink}
                fontFamily={FONT_SWISS_Q}
                fontWeight={600}
                align="left"
                lineHeight={1.24}
                style={{ letterSpacing: '-0.015em' }}
              />
            ) : null}
          </div>
        </Look45GridDropBlock>
      ) : null}

      {/* 6. Monumental KPI number pushed out of left margin x=110 across rows 2..3 (y=555..985) */}
      <Look45PushOutRow
        localFrame={localFrame}
        fps={fps}
        delay={24}
        left={colX(0)}
        top={rowY(2)}
        width={L45_GRID_W}
        height={L45_CELL * 2}
        alignItems="flex-end"
        paddingBottom={20}
        zIndex={5}
      >
        <FitText
          text={displayBig}
          baseSize={bigFontSize}
          minSize={64}
          maxLines={1}
          color={L45.ink}
          fontFamily={FONT_SWISS_Q}
          fontWeight={800}
          align="left"
          lineHeight={1.0}
          style={{
            letterSpacing: '-0.02em',
            fontVariantNumeric: 'tabular-nums',
          }}
        />
      </Look45PushOutRow>

      {/* 7. Scene headline on paper row 4 (y=985..1200) pushed out from left margin x=110 */}
      <Look45PushOutRow
        localFrame={localFrame}
        fps={fps}
        delay={32}
        left={colX(0)}
        top={rowY(4)}
        width={L45_GRID_W}
        height={L45_CELL}
        alignItems="flex-end"
        paddingBottom={16}
        zIndex={5}
      >
        <FitText
          text={t.title || metric.label}
          baseSize={50}
          minSize={28}
          maxLines={2}
          color={L45.ink}
          fontFamily={FONT_SWISS_Q}
          fontWeight={800}
          align="left"
          lineHeight={1.2}
          style={{ letterSpacing: '-0.02em' }}
        />
      </Look45PushOutRow>

      {/* Bold rule separating headline and explanation on rowY(5) = 1200 */}
      <Look45AccentRule
        localFrame={localFrame}
        delay={38}
        dur={12}
        left={colX(0)}
        top={rowY(5)}
        length={L45_GRID_W}
        orientation="h"
        zIndex={4}
      />

      {/* 8. Explanatory captions dropped from rowY(5) = 1200 (strictly above rowY(6) = 1415) */}
      <Look45NumberedCaption
        localFrame={localFrame}
        fps={fps}
        delay={40}
        left={colX(0)}
        top={rowY(5)}
        width={L45_CELL * 3 - 24}
        height={L45_CELL}
        num="01"
        label={metric.label}
        baseSize={28}
        minSize={20}
        maxLines={3}
        zIndex={5}
      />

      <Look45NumberedCaption
        localFrame={localFrame}
        fps={fps}
        delay={46}
        left={colX(3)}
        top={rowY(5)}
        width={L45_CELL}
        height={L45_CELL}
        num="02"
        label={metric.delta || metric.unit || metric.big}
        baseSize={24}
        minSize={18}
        maxLines={3}
        zIndex={5}
      />
    </div>
  );
};

// ============================================================================
// SHOT 4: 'swiss-two-column-compare' — สองคอลัมน์แบ่งเส้นกริด หรือ คำคมสวิส
// ============================================================================

const Look45SwissTwoColumnCompare: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  fps,
}) => {
  const t = sceneTexts(scene);
  const badgeClean = t.badge || `EDITION ${padTwoQ(sceneIndex + 1)}`;

  // ── MODE A: Two-Column Grid Comparison ───────────────────────────────────
  if (scene.compare) {
    const cmp = scene.compare;
    const leftTitle = String(cmp.leftTitle || cmp.leftLabel || 'A').trim();
    const rightTitle = String(cmp.rightTitle || cmp.rightLabel || 'B').trim();
    const leftItems = (cmp.leftItems || []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3);
    const rightItems = (cmp.rightItems || []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3);
    const winner = cmp.winner === 'left' ? 'left' : 'right';
    const rowCount = Math.max(leftItems.length, rightItems.length, 1);

    const rookWaypoints: L45RookWaypoint[] = [
      { col: 0, row: 1, startFrame: 0 },
      { col: 3, row: 1, startFrame: 4 },
      { col: 3, row: 0, startFrame: 12 },
    ];

    const redLeft = winner === 'left' ? colX(0) : colX(2);
    const redRight = winner === 'left' ? colX(2) : STAGE_W;

    return (
      <div
        style={{
          position: 'relative',
          width: STAGE_W,
          height: STAGE_H,
          overflow: 'hidden',
          backgroundColor: L45.paper,
        }}
      >
        <Look45SwissGrid localFrame={localFrame} />

        {/* Red field highlights the winning column header band (row 1: y=340..555) */}
        <Look45RedField
          localFrame={localFrame}
          fps={fps}
          originCol={winner === 'left' ? 1 : 3}
          originRow={1}
          targetLeft={redLeft}
          targetTop={rowY(1)}
          targetRight={redRight}
          targetBottom={rowY(2)}
          startFrame={16}
          zIndex={2}
        />

        {/* Black circle rook-steps and locks cleanly as 1-module circle in cell (3, 0) */}
        <Look45RookCircle
          localFrame={localFrame}
          fps={fps}
          filterId={`l45-cmp-blur-${sceneIndex}`}
          waypoints={rookWaypoints}
          expandStartFrame={46}
          finalCenter={{ x: colX(3) + L45_CELL / 2, y: rowY(0) + L45_CELL / 2 }}
          finalModules={1}
          zIndex={3}
        />

        {/* Row 0: Scene Title in cols 0..2 (clear of black circle in col 3) */}
        <Look45PushOutRow
          localFrame={localFrame}
          fps={fps}
          delay={20}
          left={colX(0)}
          top={rowY(0)}
          width={L45_CELL * 3 - 20}
          height={L45_CELL}
          alignItems="flex-end"
          paddingBottom={16}
          zIndex={5}
        >
          <FitText
            text={t.title || `${leftTitle} / ${rightTitle}`}
            baseSize={50}
            minSize={28}
            maxLines={2}
            color={L45.ink}
            fontFamily={FONT_SWISS_Q}
            fontWeight={800}
            align="left"
            lineHeight={1.18}
            style={{ letterSpacing: '-0.02em' }}
          />
        </Look45PushOutRow>

        {/* Strong vertical center grid divider (x = 540, rows 1..5) */}
        <Look45AccentRule
          localFrame={localFrame}
          delay={18}
          dur={14}
          left={colX(2)}
          top={rowY(1)}
          length={L45_CELL * 4}
          orientation="v"
          zIndex={4}
        />

        {/* Strong horizontal top & bottom rules framing the comparison block */}
        <Look45AccentRule
          localFrame={localFrame}
          delay={20}
          dur={12}
          left={colX(0)}
          top={rowY(1)}
          length={L45_GRID_W}
          orientation="h"
          zIndex={4}
        />

        {/* Row 1: Left Column Header (cols 0..1) */}
        <Look45PushOutRow
          localFrame={localFrame}
          fps={fps}
          delay={24}
          left={colX(0)}
          top={rowY(1)}
          width={L45_CELL * 2 - 20}
          height={L45_CELL}
          alignItems="flex-end"
          paddingBottom={18}
          zIndex={5}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left' }}>
            <div
              style={{
                fontFamily: FONT_SWISS_Q,
                fontSize: 24,
                fontWeight: 600,
                color: L45.ink,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              01
            </div>
            <FitText
              text={leftTitle}
              baseSize={44}
              minSize={26}
              maxLines={2}
              color={L45.ink}
              fontFamily={FONT_SWISS_Q}
              fontWeight={800}
              align="left"
              lineHeight={1.18}
              style={{ letterSpacing: '-0.02em' }}
            />
          </div>
        </Look45PushOutRow>

        {/* Row 1: Right Column Header (cols 2..3) */}
        <Look45PushOutRow
          localFrame={localFrame}
          fps={fps}
          delay={30}
          left={colX(2)}
          top={rowY(1)}
          width={L45_CELL * 2}
          height={L45_CELL}
          alignItems="flex-end"
          paddingBottom={18}
          zIndex={5}
        >
          <div
            style={{
              paddingLeft: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              textAlign: 'left',
            }}
          >
            <div
              style={{
                fontFamily: FONT_SWISS_Q,
                fontSize: 24,
                fontWeight: 600,
                color: L45.ink,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              02
            </div>
            <FitText
              text={rightTitle}
              baseSize={44}
              minSize={26}
              maxLines={2}
              color={L45.ink}
              fontFamily={FONT_SWISS_Q}
              fontWeight={800}
              align="left"
              lineHeight={1.18}
              style={{ letterSpacing: '-0.02em' }}
            />
          </div>
        </Look45PushOutRow>

        {/* Rows 2..4: Paired left & right items on exact grid rows */}
        {Array.from({ length: rowCount }).map((_, idx) => {
          const yTop = rowY(2 + idx);
          const itemDelay = 30 + idx * 6;
          const lText = leftItems[idx] || '';
          const rText = rightItems[idx] || '';

          return (
            <React.Fragment key={`cmp-row-${idx}`}>
              {lText ? (
                <Look45GridDropBlock
                  localFrame={localFrame}
                  fps={fps}
                  delay={itemDelay}
                  left={colX(0)}
                  top={yTop}
                  width={L45_CELL * 2 - 20}
                  height={L45_CELL}
                  zIndex={5}
                >
                  <div
                    style={{
                      paddingTop: 22,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      textAlign: 'left',
                    }}
                  >
                    <div
                      style={{
                        fontFamily: FONT_SWISS_Q,
                        fontSize: 22,
                        fontWeight: 600,
                        color: L45.ink,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {`01.${idx + 1}`}
                    </div>
                    <FitText
                      text={lText}
                      baseSize={28}
                      minSize={20}
                      maxLines={3}
                      color={winner === 'left' ? L45.ink : L45.ink60}
                      fontFamily={FONT_SWISS_Q}
                      fontWeight={winner === 'left' ? 800 : 600}
                      align="left"
                      lineHeight={1.26}
                      style={{ letterSpacing: '-0.015em' }}
                    />
                  </div>
                </Look45GridDropBlock>
              ) : null}

              {rText ? (
                <Look45GridDropBlock
                  localFrame={localFrame}
                  fps={fps}
                  delay={itemDelay + 3}
                  left={colX(2)}
                  top={yTop}
                  width={L45_CELL * 2}
                  height={L45_CELL}
                  zIndex={5}
                >
                  <div
                    style={{
                      paddingTop: 22,
                      paddingLeft: 18,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      textAlign: 'left',
                    }}
                  >
                    <div
                      style={{
                        fontFamily: FONT_SWISS_Q,
                        fontSize: 22,
                        fontWeight: 600,
                        color: L45.ink,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {`02.${idx + 1}`}
                    </div>
                    <FitText
                      text={rText}
                      baseSize={28}
                      minSize={20}
                      maxLines={3}
                      color={winner === 'right' ? L45.ink : L45.ink60}
                      fontFamily={FONT_SWISS_Q}
                      fontWeight={winner === 'right' ? 800 : 600}
                      align="left"
                      lineHeight={1.26}
                      style={{ letterSpacing: '-0.015em' }}
                    />
                  </div>
                </Look45GridDropBlock>
              ) : null}
            </React.Fragment>
          );
        })}

        {/* Row 5: Footer caption above rowY(6)=1415 */}
        <Look45AccentRule
          localFrame={localFrame}
          delay={44}
          dur={12}
          left={colX(0)}
          top={rowY(5)}
          length={L45_GRID_W}
          orientation="h"
          zIndex={4}
        />

        <Look45NumberedCaption
          localFrame={localFrame}
          fps={fps}
          delay={46}
          left={colX(0)}
          top={rowY(5)}
          width={L45_CELL * 3 - 20}
          height={L45_CELL}
          num={padTwoQ(sceneIndex + 1)}
          label={t.subtitle || badgeClean}
          baseSize={26}
          minSize={20}
          maxLines={2}
          zIndex={5}
        />

        <Look45NumberedCaption
          localFrame={localFrame}
          fps={fps}
          delay={50}
          left={colX(3)}
          top={rowY(5)}
          width={L45_CELL}
          height={L45_CELL}
          num="VS"
          label={winner === 'left' ? leftTitle : rightTitle}
          baseSize={24}
          minSize={18}
          maxLines={2}
          zIndex={5}
        />
      </div>
    );
  }

  // ── MODE B: Swiss Typographic Quotation ──────────────────────────────────
  const quoteText = String(scene.quote?.text || t.subtitle || t.title).trim();
  const quoteAuthor = String(scene.quote?.author || scene.source || t.title).trim();
  const quoteRole = String(scene.quote?.role || scene.quote?.source || badgeClean).trim();
  const quoteRows = splitIntoRowsQ(quoteText, 3);
  const longestQuoteRow = quoteRows.reduce((m, r) => Math.max(m, r.length), 0);
  const quoteBaseSize = longestQuoteRow > 34 ? 46 : longestQuoteRow > 24 ? 54 : 62;

  const rookWaypoints: L45RookWaypoint[] = [
    { col: 0, row: 0, startFrame: 0 },
    { col: 2, row: 0, startFrame: 3 },
    { col: 2, row: 1, startFrame: 10 },
    { col: 3, row: 1, startFrame: 17 },
  ];

  return (
    <div
      style={{
        position: 'relative',
        width: STAGE_W,
        height: STAGE_H,
        overflow: 'hidden',
        backgroundColor: L45.paper,
      }}
    >
      <Look45SwissGrid localFrame={localFrame} />

      {/* Red field covering cols 2-3 + top & right bleed (x=540..1080, y=0..555) */}
      <Look45RedField
        localFrame={localFrame}
        fps={fps}
        originCol={3}
        originRow={1}
        targetLeft={colX(2)}
        targetTop={0}
        targetRight={STAGE_W}
        targetBottom={rowY(2)}
        startFrame={18}
        zIndex={2}
      />

      {/* 2-module Black Circle centered on grid intersection (colX(3), rowY(1)) = (755, 340) */}
      <Look45RookCircle
        localFrame={localFrame}
        fps={fps}
        filterId={`l45-quote-blur-${sceneIndex}`}
        waypoints={rookWaypoints}
        expandStartFrame={46}
        finalCenter={{ x: colX(3), y: rowY(1) }}
        finalModules={2}
        zIndex={3}
      />

      {/* Row 0 left: Numbered caption dropped from rowY(0) = 125 */}
      <Look45NumberedCaption
        localFrame={localFrame}
        fps={fps}
        delay={24}
        left={colX(0)}
        top={rowY(0)}
        width={L45_CELL * 2 - 20}
        height={L45_CELL}
        num={padTwoQ(sceneIndex + 1)}
        label={badgeClean}
        baseSize={28}
        minSize={20}
        maxLines={2}
        zIndex={5}
      />

      {/* Row 1 left: Bold geometric Swiss quote mark pushed out from left margin x=110 */}
      <Look45PushOutRow
        localFrame={localFrame}
        fps={fps}
        delay={20}
        left={colX(0)}
        top={rowY(1)}
        width={L45_CELL * 2 - 20}
        height={L45_CELL}
        alignItems="flex-end"
        paddingBottom={8}
        zIndex={5}
      >
        <div
          style={{
            fontFamily: FONT_SWISS_Q,
            fontSize: 164,
            fontWeight: 800,
            color: L45.red,
            lineHeight: 0.72,
            letterSpacing: '-0.02em',
            textAlign: 'left',
          }}
        >
          “
        </div>
      </Look45PushOutRow>

      {/* Rows 2..4: Flush-left quotation rows pushed out from x=110 (staggered 6f, ~8% overshoot) */}
      {quoteRows.map((rowText, idx) => (
        <Look45PushOutRow
          key={`qrow-${idx}`}
          localFrame={localFrame}
          fps={fps}
          delay={24 + idx * 6}
          left={colX(0)}
          top={rowY(2 + idx)}
          width={L45_GRID_W}
          height={L45_CELL}
          alignItems="flex-end"
          paddingBottom={16}
          zIndex={5}
        >
          <FitText
            text={rowText}
            baseSize={quoteBaseSize}
            minSize={30}
            maxLines={3}
            color={L45.ink}
            fontFamily={FONT_SWISS_Q}
            fontWeight={800}
            align="left"
            lineHeight={1.2}
            style={{ letterSpacing: '-0.02em' }}
          />
        </Look45PushOutRow>
      ))}

      {/* Strong horizontal rule at rowY(5) = 1200 */}
      <Look45AccentRule
        localFrame={localFrame}
        delay={40}
        dur={12}
        left={colX(0)}
        top={rowY(5)}
        length={L45_GRID_W}
        orientation="h"
        zIndex={4}
      />

      {/* Row 5: Attribution dropped cleanly from rowY(5) = 1200 */}
      <Look45GridDropBlock
        localFrame={localFrame}
        fps={fps}
        delay={42}
        left={colX(0)}
        top={rowY(5)}
        width={L45_CELL * 3 - 24}
        height={L45_CELL}
        zIndex={5}
      >
        <div
          style={{
            paddingTop: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            textAlign: 'left',
          }}
        >
          <FitText
            text={`— ${quoteAuthor}`}
            baseSize={34}
            minSize={22}
            maxLines={2}
            color={L45.ink}
            fontFamily={FONT_SWISS_Q}
            fontWeight={800}
            align="left"
            lineHeight={1.24}
            style={{ letterSpacing: '-0.02em' }}
          />
          {quoteRole ? (
            <FitText
              text={quoteRole}
              baseSize={24}
              minSize={18}
              maxLines={2}
              color={L45.ink60}
              fontFamily={FONT_SWISS_Q}
              fontWeight={600}
              align="left"
              lineHeight={1.28}
              style={{ letterSpacing: '-0.015em' }}
            />
          ) : null}
        </div>
      </Look45GridDropBlock>

      <Look45NumberedCaption
        localFrame={localFrame}
        fps={fps}
        delay={48}
        left={colX(3)}
        top={rowY(5)}
        width={L45_CELL}
        height={L45_CELL}
        num={padTwoQ(sceneIndex + 1)}
        label="QUOTE"
        baseSize={24}
        minSize={18}
        maxLines={2}
        zIndex={5}
      />
    </div>
  );
};

// Keep SAFE_X / SAFE_TOP / CONTENT_BOTTOM referenced cleanly for contract visibility
void SAFE_X;
void SAFE_TOP;
void CONTENT_BOTTOM;
void interpolate;

// ============================================================================
// EXPORTED REGISTRY DEFINITIONS — BATCH_Q (look-45)
// ============================================================================

const L45_LIST_RE = /(?:ขั้นตอน|รายการ|หลักการ|step|list|principle)/i;

export const BATCH_Q: StyleDirectorDef[] = [
  {
    styleId: 'look-45',
    caption: 'bar',
    shots: {
      'swiss-manifesto-title': Look45SwissManifestoTitle,
      'swiss-numbered-list': Look45SwissNumberedList,
      'swiss-kpi-field': Look45SwissKpiField,
      'swiss-two-column-compare': Look45SwissTwoColumnCompare,
    },
    shotLabels: {
      'swiss-manifesto-title':
        'โปสเตอร์แถลงการณ์กริดสวิส 4 คอลัมน์ พื้นแดงงอกตามเส้นกริด วงกลมดำก้าวแบบเรือพร้อมโมชันเบลอ และหัวข้อชิดซ้าย 2–3 แถวพิมพ์ทับพื้นแดง',
      'swiss-numbered-list':
        'รายการลำดับหมายเลข 01/02/03 หล่นจากเส้นกริดโมดูล พร้อมข้อความชิดซ้ายดันออกจากเส้นคอลัมน์และวงกลมดำล็อกบนกริด',
      'swiss-kpi-field':
        'ตัวเลขสถิติขนาดยักษ์ชิดซ้ายบนพื้นแดงสัญญาณ พร้อมวงกลมสองโมดูลบนจุดตัดกริดและคำอธิบายแบบตัวเลขหมึกเต็ม',
      'swiss-two-column-compare':
        'ตารางเปรียบเทียบสองคอลัมน์แบ่งด้วยเส้นกริดกลางพร้อมพื้นแดงเน้นฝั่งเด่น หรือจัดวางคำคมแถลงการณ์บนกริดสวิส',
    },
    infer: (scene) => {
      if (scene.stat) {
        return 'swiss-kpi-field';
      }
      if (scene.compare || scene.quote?.text) {
        return 'swiss-two-column-compare';
      }
      if (
        (Array.isArray(scene.bullets) && scene.bullets.length >= 3) ||
        (Array.isArray(scene.steps) && scene.steps.length >= 2)
      ) {
        return 'swiss-numbered-list';
      }
      const text = haystackOfQ(scene);
      if (L45_LIST_RE.test(text) && scene.bullets && scene.bullets.length >= 2) {
        return 'swiss-numbered-list';
      }
      return null;
    },
  },
];
