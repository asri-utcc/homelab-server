import React from 'react';
import { interpolate, spring } from 'remotion';
import { THAI_FONT_FAMILY } from '../../components/ThaiFontLoader';
import type { StudioScene } from '../types';
import {
  FitText,
  SAFE_BOTTOM,
  STAGE_H,
  STAGE_W,
  appear,
  clamp01,
  easeOutCubic,
  sceneTexts,
  stagger,
} from './kit';
import type { StyleDirectorDef, StyleShotArgs } from './types';

// ============================================================================
// SHARED HELPERS FOR BATCH L (look-35 Screen-Recording Zoom, look-37 Glow Orb)
// Pure, Deterministic, Inline SVG/CSS Only, Zero External Assets
// Safe stage bounds: x ∈ [54, 1026], y ∈ [112, CONTENT_BOTTOM (=1420)]
// ============================================================================

const CONTENT_BOTTOM = SAFE_BOTTOM - 120; // 1420
const SAFE_X = 54;
const SAFE_TOP = 112;
const SAFE_W = STAGE_W - SAFE_X * 2; // 972

const FONT_THAI = THAI_FONT_FAMILY;
const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

// Hardcoded palettes from assets/styles_catalog.json (never overridden by tokens)
const LOOK35 = {
  mintBase: '#E3EFE9',
  mintGlowLeft: '#B8D7D6',
  mintGlowBottom: '#9CC4BD',
  windowBg: '#1B1C20',
  titleBar: '#212227',
  panel: '#26272C',
  panelAlt: '#2A2B31',
  border: '#33353B',
  text: '#ECEEF1',
  muted: '#9A9FA8',
  blue: '#3D7BFA',
  blueTop: '#4F8BFF',
  blueBottom: '#2B68E6',
  playhead: '#FF5A4E',
  success: '#22C55E',
  pillBg: '#FFFFFF',
  pillInk: '#15171A',
} as const;

const LOOK37 = {
  bg: '#070304',
  halo: '#13050B',
  orbWhite: '#FBF6F8',
  orbPink: '#F696DE',
  orbEdge: '#531829',
  line: '#F6EFF2',
} as const;

// Regex classifiers for intelligent shot inference
const L35_SUCCESS_RE = /(?:สำเร็จ|เสร็จ|เรียบร้อย|ผลลัพธ์|ผ่าน|ยืนยัน|บันทึกแล้ว|เผยแพร่|done|success|complete|publish)/i;
const L35_CLICK_RE = /(?:คลิก|กด|ปุ่ม|ตั้งค่า|เมนู|หน้าจอ|ซอฟต์แวร์|โปรแกรม|แอป|เลือก|เปิด|เข้า|click|button|menu|setting|screen)/i;

function seededHashL(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function haystackOfL(scene: StudioScene): string {
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

function extractPointsL(scene: StudioScene, max = 4): string[] {
  const t = sceneTexts(scene);
  const out: string[] = [];

  if (Array.isArray(scene.steps) && scene.steps.length > 0) {
    for (const s of scene.steps) {
      if (typeof s === 'string') {
        if (s.trim()) out.push(s.trim());
      } else if (s?.title) {
        out.push(s.detail ? `${s.title} — ${s.detail}` : s.title);
      }
    }
  } else if (t.bullets.length > 0) {
    out.push(...t.bullets);
  } else if (scene.compare) {
    const combined = [...(scene.compare.leftItems || []), ...(scene.compare.rightItems || [])];
    for (const item of combined) {
      const clean = String(item || '').trim();
      if (clean) out.push(clean);
    }
  } else if (scene.stat) {
    if (scene.stat.label) out.push(scene.stat.label);
    if (scene.stat.delta) out.push(scene.stat.delta);
    if (t.subtitle) out.push(t.subtitle);
  } else if (scene.quote?.text) {
    out.push(scene.quote.text);
    if (scene.quote.author) out.push(`— ${scene.quote.author}`);
  } else if (t.subtitle) {
    out.push(t.subtitle);
  }

  if (out.length === 0 && t.title) out.push(t.title);
  return out.slice(0, max);
}

function extractStepObjectsL(
  scene: StudioScene,
  fallbackLabels: string[],
  max = 4,
): Array<{ tag: string; title: string; detail: string }> {
  const out: Array<{ tag: string; title: string; detail: string }> = [];
  if (Array.isArray(scene.steps) && scene.steps.length > 0) {
    scene.steps.slice(0, max).forEach((s, idx) => {
      if (typeof s === 'string') {
        out.push({ tag: fallbackLabels[idx] || `0${idx + 1}`, title: s.trim(), detail: '' });
      } else if (s?.title) {
        out.push({
          tag: s.step || fallbackLabels[idx] || `0${idx + 1}`,
          title: String(s.title).trim(),
          detail: String(s.detail || '').trim(),
        });
      }
    });
  } else {
    const pts = extractPointsL(scene, max);
    pts.forEach((p, idx) => {
      out.push({ tag: fallbackLabels[idx] || `0${idx + 1}`, title: p, detail: '' });
    });
  }
  if (out.length === 0) {
    const t = sceneTexts(scene);
    out.push({ tag: '01', title: t.title || 'เริ่มต้นใช้งาน', detail: t.subtitle || '' });
  }
  return out;
}

function parseNumericL(raw: string | number | undefined, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw || '').replace(/,/g, '');
  const m = s.match(/\d+(?:\.\d+)?/);
  if (!m) return fallback;
  const val = parseFloat(m[0]);
  return Number.isFinite(val) ? val : fallback;
}

function extractPrimaryMetricL(
  scene: StudioScene,
  fallbackNum = 100,
  fallbackUnit = '%',
): { big: string; unit: string; numeric: number; label: string; delta: string; progress: number } {
  const t = sceneTexts(scene);
  if (scene.stat?.value !== undefined && String(scene.stat.value).trim()) {
    const rawVal = String(scene.stat.value).trim();
    const prefix = String(scene.stat.prefix || '').trim();
    const suffix = String(scene.stat.suffix || '').trim();
    const effPrefix = prefix && !rawVal.startsWith(prefix) ? prefix : '';
    const effSuffix = suffix && !rawVal.endsWith(suffix) ? suffix : '';
    const big = `${effPrefix}${rawVal}${effSuffix}`.trim();
    const numeric = scene.stat.numericValue ?? parseNumericL(rawVal, fallbackNum);
    const prog =
      typeof scene.stat.progress === 'number' && Number.isFinite(scene.stat.progress)
        ? clamp01(scene.stat.progress / 100)
        : numeric > 0 && numeric <= 100
          ? clamp01(numeric / 100)
          : 0.88;
    return {
      big,
      unit: String(scene.stat.unit || '').trim(),
      numeric,
      label: String(scene.stat.label || t.subtitle || t.title).trim(),
      delta: String(scene.stat.delta || '').trim(),
      progress: prog,
    };
  }
  if (t.numbers.length > 0) {
    const first = t.numbers[0];
    const numeric = parseNumericL(first, fallbackNum);
    return {
      big: first,
      unit: '',
      numeric,
      label: t.subtitle || t.title,
      delta: t.badge || '',
      progress: numeric > 0 && numeric <= 100 ? clamp01(numeric / 100) : 0.84,
    };
  }
  return {
    big: `${fallbackNum}${fallbackUnit}`,
    unit: '',
    numeric: fallbackNum,
    label: t.title || t.subtitle || 'เสร็จสมบูรณ์',
    delta: t.badge || '',
    progress: 0.92,
  };
}

function formatTimecodeL(frame: number, fps: number): string {
  const safeFps = Math.max(1, fps || 30);
  const totalSec = Math.max(0, Math.floor(frame / safeFps));
  const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const secs = String(totalSec % 60).padStart(2, '0');
  const remFrames = String(Math.max(0, Math.floor(frame) % safeFps)).padStart(2, '0');
  return `${mins}:${secs}:${remFrames}`;
}

function quadBezierL(
  t: number,
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
): [number, number] {
  const u = clamp01(t);
  const inv = 1 - u;
  const x = inv * inv * p0[0] + 2 * inv * u * p1[0] + u * u * p2[0];
  const y = inv * inv * p0[1] + 2 * inv * u * p1[1] + u * u * p2[1];
  return [x, y];
}

// ============================================================================
// LOOK-35: SCREEN-RECORDING ZOOM — SHARED UI PRIMITIVES
// Mint backdrop (#E3EFE9 + #B8D7D6/#9CC4BD + deterministic feTurbulence grain)
// Crisp dark-mode app window (#1B1C20, #212227, #26272C–#2A2B31, #33353B)
// ============================================================================

const Look35MintBackdrop: React.FC<{
  filterId: string;
  localFrame: number;
  fps: number;
}> = ({ filterId, localFrame, fps }) => {
  const tc = formatTimecodeL(localFrame, fps);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: LOOK35.mintBase,
        backgroundImage: [
          `radial-gradient(circle at 14% 12%, rgba(255, 255, 255, 0.72) 0%, rgba(227, 239, 233, 0) 48%)`,
          `radial-gradient(circle at 86% 24%, ${LOOK35.mintGlowLeft} 0%, rgba(184, 215, 214, 0) 54%)`,
          `radial-gradient(circle at 52% 88%, ${LOOK35.mintGlowBottom} 0%, rgba(156, 196, 189, 0) 58%)`,
        ].join(', '),
        overflow: 'hidden',
      }}
    >
      {/* Deterministic film grain strictly on the backdrop (UI stays razor sharp) */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.065,
          mixBlendMode: 'multiply',
          pointerEvents: 'none',
        }}
      >
        <defs>
          <filter id={filterId} x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.82"
              numOctaves={3}
              seed={35}
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>
        <rect width={STAGE_W} height={STAGE_H} filter={`url(#${filterId})`} />
      </svg>

      {/* Subtle screen-recording top bar metadata inside safe bounds */}
      <div
        style={{
          position: 'absolute',
          top: SAFE_TOP - 4,
          left: SAFE_X,
          right: SAFE_X,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 14px',
            borderRadius: 999,
            background: 'rgba(255, 255, 255, 0.62)',
            border: '1px solid rgba(27, 28, 32, 0.08)',
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: LOOK35.playhead,
              opacity: 0.55 + 0.45 * Math.sin((localFrame / Math.max(1, fps)) * Math.PI * 2),
            }}
          />
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: '#2B3338',
            }}
          >
            REC · 1080P
          </span>
        </div>
        <div
          style={{
            padding: '6px 14px',
            borderRadius: 999,
            background: 'rgba(255, 255, 255, 0.56)',
            border: '1px solid rgba(27, 28, 32, 0.08)',
            fontFamily: FONT_MONO,
            fontSize: 15,
            fontWeight: 600,
            color: '#3B454B',
          }}
        >
          {tc}
        </div>
      </div>
    </div>
  );
};

const Look35CursorAndRipple: React.FC<{
  x: number;
  y: number;
  clickFrame: number;
  localFrame: number;
  fps: number;
  size?: number;
}> = ({ x, y, clickFrame, localFrame, fps, size = 34 }) => {
  const dt = localFrame - clickFrame;
  const isClicking = dt >= 0 && dt <= 10;
  const pressScale = isClicking
    ? interpolate(dt, [0, 3, 10], [1, 0.84, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : 1;
  const pressDrop = isClicking
    ? interpolate(dt, [0, 3, 10], [0, 3.5, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : 0;

  const rippleProg =
    dt >= 0
      ? spring({
          frame: dt,
          fps,
          config: { damping: 18, stiffness: 120, mass: 0.8 },
        })
      : 0;
  const rippleOpacity =
    dt >= 0 ? interpolate(dt, [0, 4, 24], [0.95, 0.82, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 0;
  const ripple2Opacity =
    dt >= 3 ? interpolate(dt, [3, 9, 28], [0.55, 0.42, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 0;

  return (
    <>
      {dt >= 0 && rippleOpacity > 0.01 && (
        <div
          style={{
            position: 'absolute',
            left: x,
            top: y,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            zIndex: 40,
          }}
        >
          <div
            style={{
              width: 24 + rippleProg * 88,
              height: 24 + rippleProg * 88,
              borderRadius: 999,
              border: '3px solid rgba(255, 255, 255, 0.95)',
              boxShadow: '0 0 18px rgba(61, 123, 250, 0.55)',
              opacity: rippleOpacity,
            }}
          />
        </div>
      )}
      {dt >= 3 && ripple2Opacity > 0.01 && (
        <div
          style={{
            position: 'absolute',
            left: x,
            top: y,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            zIndex: 39,
          }}
        >
          <div
            style={{
              width: 32 + rippleProg * 124,
              height: 32 + rippleProg * 124,
              borderRadius: 999,
              border: '1.8px solid rgba(255, 255, 255, 0.65)',
              opacity: ripple2Opacity,
            }}
          />
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          left: x,
          top: y,
          transform: `translate(-4px, ${-3 + pressDrop}px) scale(${pressScale})`,
          transformOrigin: '4px 3px',
          pointerEvents: 'none',
          zIndex: 50,
          filter: 'drop-shadow(0 6px 10px rgba(0, 0, 0, 0.45))',
        }}
      >
        <svg width={size} height={size * 1.15} viewBox="0 0 28 32" fill="none">
          <path
            d="M3.2 2.4L23.6 15.2C24.7 15.9 24.4 17.6 23.1 17.8L14.9 19.2L10.3 26.8C9.6 27.9 7.9 27.5 7.8 26.2L5.6 17.9L2.2 4.1C2 3 2.3 1.8 3.2 2.4Z"
            fill="#111216"
            stroke="#FFFFFF"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </>
  );
};

const Look35WindowTitleBar: React.FC<{
  workspaceLabel: string;
  rightBadge?: string;
}> = ({ workspaceLabel, rightBadge }) => (
  <div
    style={{
      height: 48,
      backgroundColor: LOOK35.titleBar,
      borderBottom: `1px solid ${LOOK35.border}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 18px',
      flexShrink: 0,
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <div style={{ width: 12, height: 12, borderRadius: 999, background: '#FF5F56' }} />
      <div style={{ width: 12, height: 12, borderRadius: 999, background: '#FFBD2E' }} />
      <div style={{ width: 12, height: 12, borderRadius: 999, background: '#27C93F' }} />
    </div>
    <div
      style={{
        padding: '4px 16px',
        borderRadius: 7,
        backgroundColor: LOOK35.panel,
        border: `1px solid ${LOOK35.border}`,
        fontFamily: FONT_MONO,
        fontSize: 13,
        fontWeight: 600,
        color: LOOK35.muted,
        letterSpacing: '0.03em',
      }}
    >
      {workspaceLabel}
    </div>
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: 12,
        fontWeight: 600,
        color: LOOK35.muted,
        minWidth: 54,
        textAlign: 'right',
      }}
    >
      {rightBadge || 'v2.4'}
    </div>
  </div>
);

const Look35StepPill: React.FC<{
  stepNum: string;
  text: string;
  enterFrame: number;
  localFrame: number;
  fps: number;
  isCheck?: boolean;
  bottomY?: number;
}> = ({ stepNum, text, enterFrame, localFrame, fps, isCheck = false, bottomY = 1235 }) => {
  const dt = localFrame - enterFrame;
  const pop =
    dt >= 0
      ? spring({
          frame: dt,
          fps,
          config: { damping: 14, stiffness: 170, mass: 0.75 },
        })
      : 0;
  const badgePop =
    dt >= 3
      ? spring({
          frame: dt - 3,
          fps,
          config: { damping: 12, stiffness: 210, mass: 0.65 },
        })
      : 0;
  const scale = interpolate(pop, [0, 1], [0.76, 1]);
  const ty = interpolate(pop, [0, 1], [28, 0]);
  const opacity = clamp01(pop * 2.5);

  if (opacity <= 0.01) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: bottomY,
        left: SAFE_X,
        width: SAFE_W,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 60,
      }}
    >
      <div
        style={{
          maxWidth: 920,
          backgroundColor: LOOK35.pillBg,
          borderRadius: 999,
          padding: '16px 28px 16px 18px',
          boxShadow: '0 22px 52px rgba(15, 25, 32, 0.24), 0 4px 14px rgba(15, 25, 32, 0.12)',
          border: '1px solid rgba(255, 255, 255, 0.9)',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          opacity,
          transform: `translateY(${ty}px) scale(${scale})`,
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            backgroundColor: isCheck ? LOOK35.success : LOOK35.pillInk,
            color: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: FONT_MONO,
            fontSize: 19,
            fontWeight: 800,
            flexShrink: 0,
            transform: `scale(${interpolate(badgePop, [0, 1], [0.5, 1])})`,
          }}
        >
          {isCheck ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 12.5L10 17.5L19 7.5"
                stroke="#FFFFFF"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            stepNum
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <FitText
            text={text}
            baseSize={30}
            minSize={20}
            maxLines={2}
            lineHeight={1.32}
            color={LOOK35.pillInk}
            fontWeight={700}
            align="left"
          />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// LOOK-35 SHOT 1: window-zoom-click
// Full dark-mode app window -> smooth spring zoom 1 -> 1.8 to blue #3D7BFA btn
// Curved SVG cursor glides via easeOutCubic -> clicks at ~60% with ripple
// ============================================================================

const Look35WindowZoomClick: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const t = sceneTexts(scene);
  const pts = extractPointsL(scene, 4);
  const highlightStr = typeof (scene as StudioScene & { highlight?: unknown }).highlight === 'string'
    ? String((scene as StudioScene & { highlight?: unknown }).highlight).trim()
    : '';
  const buttonLabel = highlightStr && highlightStr.length <= 22
    ? highlightStr
    : t.title && t.title.length <= 20
      ? t.title
      : 'บันทึกและเผยแพร่';
  const pillText = t.title || t.subtitle || (t.badge ? `${t.badge} · ${buttonLabel}` : `คลิก ${buttonLabel}`);
  const sidebarItems = [
    pts[0] || 'แดชบอร์ดหลัก',
    pts[1] || 'จัดการโปรเจกต์',
    pts[2] || 'ตั้งค่าระบบ',
    pts[3] || 'ส่งออกงาน',
  ];

  // Key timing beats (deterministic, scaled to durationFrames)
  const safeDur = Math.max(45, durationFrames || 120);
  const clickFrame = Math.round(safeDur * 0.6);
  const moveStart = Math.round(safeDur * 0.1);
  const moveDur = Math.max(18, clickFrame - moveStart - 3);
  const zoomStart = Math.round(safeDur * 0.16);
  const pillEnter = Math.min(safeDur - 12, clickFrame + 7);

  // Camera zoom spring (1 -> 1.42) lagging 1 beat behind cursor, smooth damped landing
  const zoomSpring =
    localFrame >= zoomStart
      ? spring({
          frame: localFrame - zoomStart,
          fps,
          config: { damping: 24, stiffness: 58, mass: 1.15 },
        })
      : 0;
  const zoomP = clamp01(zoomSpring);
  const camScale = interpolate(zoomP, [0, 1], [1, 1.42]);

  // Window geometry in world space: x ∈ [80, 1000], y ∈ [360, 840]
  // Button center in world space: (820, 760)
  // At scale=1.42: button lands near (700, 910), keeping window edges well-framed above y=1420
  const targetTx = 700 - 1.42 * 820; // -464.4
  const targetTy = 910 - 1.42 * 760; // -169.2
  const camTx = interpolate(zoomP, [0, 1], [0, targetTx]);
  const camTy = interpolate(zoomP, [0, 1], [0, targetTy]);

  // Curved cursor path (quadratic Bezier, easeOutCubic)
  const moveProg = easeOutCubic((localFrame - moveStart) / moveDur);
  const [curX, curY] = quadBezierL(moveProg, [365, 485], [515, 705], [866, 774]);

  // Button hover + physical press response at clickFrame
  const isHovered = moveProg > 0.88;
  const clickDt = localFrame - clickFrame;
  const btnScale =
    clickDt >= 0 && clickDt <= 12
      ? interpolate(clickDt, [0, 3, 12], [1, 0.95, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
      : 1;
  const hasClicked = clickDt >= 2;

  // Timeline playhead drift
  const playheadPct = interpolate(localFrame, [0, safeDur], [22, 74], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden', fontFamily: FONT_THAI }}>
      <Look35MintBackdrop filterId={`l35-grain-zoom-${sceneIndex}`} localFrame={localFrame} fps={fps} />

      {/* Camera stage clipped cleanly above subtitle zone (y ≤ CONTENT_BOTTOM) */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: STAGE_W,
          height: CONTENT_BOTTOM,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: STAGE_W,
            height: CONTENT_BOTTOM,
            transformOrigin: '0 0',
            transform: `translate3d(${camTx.toFixed(2)}px, ${camTy.toFixed(2)}px, 0) scale(${camScale.toFixed(4)})`,
          }}
        >
          {/* Dark-mode Desktop App Window */}
          <div
            style={{
              position: 'absolute',
              left: 80,
              top: 360,
              width: 920,
              height: 480,
              backgroundColor: LOOK35.windowBg,
              borderRadius: 20,
              border: `1.5px solid ${LOOK35.border}`,
              boxShadow: '0 34px 80px rgba(15, 25, 32, 0.34), 0 10px 24px rgba(15, 25, 32, 0.18)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Look35WindowTitleBar workspaceLabel={t.badge ? `STUDIO · ${t.badge.slice(0, 18)}` : 'STUDIO WORKSPACE'} rightBadge="60 FPS" />

            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              {/* Sidebar */}
              <div
                style={{
                  width: 224,
                  backgroundColor: LOOK35.titleBar,
                  borderRight: `1px solid ${LOOK35.border}`,
                  padding: '16px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                    fontWeight: 700,
                    color: LOOK35.muted,
                    letterSpacing: '0.1em',
                    padding: '2px 10px 6px',
                  }}
                >
                  WORKSPACE
                </div>
                {sidebarItems.map((item, idx) => {
                  const active = idx === 0;
                  return (
                    <div
                      key={idx}
                      style={{
                        padding: '9px 12px',
                        borderRadius: 10,
                        backgroundColor: active ? LOOK35.panelAlt : 'transparent',
                        border: active ? `1px solid ${LOOK35.border}` : '1px solid transparent',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          backgroundColor: active ? LOOK35.blue : '#4E525B',
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <FitText
                          text={item}
                          baseSize={16}
                          minSize={13}
                          maxLines={1}
                          lineHeight={1.32}
                          color={active ? LOOK35.text : LOOK35.muted}
                          fontWeight={active ? 700 : 500}
                          align="left"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Main Workspace Panel */}
              <div
                style={{
                  flex: 1,
                  padding: '20px 24px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  backgroundColor: LOOK35.windowBg,
                }}
              >
                {/* Top Preview / Parameter Card */}
                <div
                  style={{
                    backgroundColor: LOOK35.panel,
                    border: `1px solid ${LOOK35.border}`,
                    borderRadius: 14,
                    padding: '16px 20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <FitText
                        text={t.subtitle || t.title || 'พร้อมดำเนินการขั้นตอนถัดไป'}
                        baseSize={20}
                        minSize={15}
                        maxLines={2}
                        lineHeight={1.32}
                        color={LOOK35.text}
                        fontWeight={600}
                        align="left"
                      />
                    </div>
                    <div
                      style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        backgroundColor: hasClicked ? 'rgba(34, 197, 94, 0.16)' : 'rgba(61, 123, 250, 0.16)',
                        color: hasClicked ? '#4ADE80' : '#7AA8FF',
                        fontFamily: FONT_MONO,
                        fontSize: 12,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {hasClicked ? 'ACTIVE' : 'READY'}
                    </div>
                  </div>

                  {/* Mini Timeline with Red Playhead (#FF5A4E) */}
                  <div
                    style={{
                      position: 'relative',
                      height: 62,
                      backgroundColor: LOOK35.windowBg,
                      borderRadius: 10,
                      border: `1px solid ${LOOK35.border}`,
                      padding: '10px 12px',
                      overflow: 'hidden',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 8, height: 16, marginBottom: 8 }}>
                      <div style={{ width: '38%', borderRadius: 4, background: '#2E3B56', border: '1px solid #3D7BFA66' }} />
                      <div style={{ width: '28%', borderRadius: 4, background: '#2C313A' }} />
                      <div style={{ width: '24%', borderRadius: 4, background: '#2E3B56', border: '1px solid #3D7BFA44' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, height: 14 }}>
                      <div style={{ width: '22%', borderRadius: 4, background: '#262930' }} />
                      <div style={{ width: '54%', borderRadius: 4, background: '#31343D' }} />
                    </div>
                    {/* Playhead */}
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: `${playheadPct}%`,
                        width: 2,
                        backgroundColor: LOOK35.playhead,
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: -5,
                          width: 12,
                          height: 8,
                          borderRadius: '0 0 4px 4px',
                          backgroundColor: LOOK35.playhead,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Bottom Action Footer with Target Blue Button (#3D7BFA) */}
                <div
                  style={{
                    backgroundColor: LOOK35.panelAlt,
                    border: `1px solid ${LOOK35.border}`,
                    borderRadius: 14,
                    padding: '14px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 14,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: LOOK35.muted, letterSpacing: '0.06em' }}>
                      OUTPUT · MP4 H.264
                    </span>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 13, color: LOOK35.text, fontWeight: 600 }}>
                      1080 × 1920 · 24.8 MB
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        padding: '12px 18px',
                        borderRadius: 10,
                        backgroundColor: LOOK35.panel,
                        border: `1px solid ${LOOK35.border}`,
                        fontFamily: FONT_THAI,
                        fontSize: 15,
                        fontWeight: 600,
                        color: LOOK35.muted,
                      }}
                    >
                      ยกเลิก
                    </div>

                    {/* Hero Target Blue Button (#3D7BFA) centered around world (820, 760) */}
                    <div
                      style={{
                        minWidth: 210,
                        maxWidth: 280,
                        padding: '12px 22px',
                        borderRadius: 11,
                        background: isHovered
                          ? `linear-gradient(180deg, #3A77F5 0%, #245EDB 100%)`
                          : `linear-gradient(180deg, ${LOOK35.blueTop} 0%, ${LOOK35.blue} 55%, ${LOOK35.blueBottom} 100%)`,
                        boxShadow: hasClicked
                          ? '0 0 0 3px rgba(61, 123, 250, 0.45), 0 8px 22px rgba(61, 123, 250, 0.5)'
                          : '0 6px 18px rgba(61, 123, 250, 0.36)',
                        border: '1px solid rgba(255, 255, 255, 0.22)',
                        transform: `scale(${btnScale})`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                      }}
                    >
                      <FitText
                        text={buttonLabel}
                        baseSize={18}
                        minSize={13}
                        maxLines={1}
                        lineHeight={1.32}
                        color="#FFFFFF"
                        fontWeight={700}
                        align="center"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Cursor + Click Ripple in world space so it stays locked to button */}
          <Look35CursorAndRipple
            x={curX}
            y={curY}
            clickFrame={clickFrame}
            localFrame={localFrame}
            fps={fps}
            size={30}
          />
        </div>
      </div>

      {/* Floating White Step Pill (pops up after click, safely above y=1420) */}
      <Look35StepPill
        stepNum={String(sceneIndex + 1)}
        text={pillText}
        enterFrame={pillEnter}
        localFrame={localFrame}
        fps={fps}
        bottomY={1225}
      />
    </div>
  );
};

// ============================================================================
// LOOK-35 SHOT 2: step-click-path
// Steps rendered as numbered dark-UI rows -> cursor glides & clicks each step
// ============================================================================

const Look35StepClickPath: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const t = sceneTexts(scene);
  const steps = extractStepObjectsL(scene, ['01', '02', '03', '04'], 4);
  const count = Math.max(1, steps.length);
  const safeDur = Math.max(50, durationFrames || 120);

  // Schedule click frame for each step evenly between 18% and 78% of duration
  const startBeat = Math.round(safeDur * 0.18);
  const endBeat = Math.round(safeDur * 0.78);
  const clickFrames = steps.map((_, idx) =>
    count === 1 ? Math.round(safeDur * 0.5) : Math.round(startBeat + (idx / (count - 1)) * (endBeat - startBeat)),
  );

  // Row geometry inside the dark app window (window sits at x=64, y=268, w=952)
  const winLeft = 64;
  const winTop = 276;
  const winW = 952;
  const rowGap = 16;
  const rowHeight = count >= 4 ? 156 : count === 3 ? 190 : 210;
  const listTop = winTop + 86;

  // Target button coordinates in screen space for each step row
  const targets: Array<[number, number]> = steps.map((_, idx) => [
    winLeft + winW - 110,
    listTop + idx * (rowHeight + rowGap) + rowHeight * 0.5,
  ]);

  // Compute cursor position gliding smoothly between consecutive targets
  let curX = winLeft + 180;
  let curY = listTop - 16;
  let activeClickFrame = clickFrames[0];
  let activeIdx = 0;

  if (localFrame <= clickFrames[0]) {
    const moveDur = Math.max(10, clickFrames[0] - 4);
    const p = easeOutCubic((localFrame - 4) / moveDur);
    const mid: [number, number] = [(curX + targets[0][0]) * 0.52, Math.min(curY, targets[0][1]) + 46];
    [curX, curY] = quadBezierL(p, [curX, curY], mid, targets[0]);
    activeClickFrame = clickFrames[0];
    activeIdx = 0;
  } else {
    let found = false;
    for (let i = 0; i < count - 1; i++) {
      if (localFrame > clickFrames[i] && localFrame <= clickFrames[i + 1]) {
        const holdEnd = clickFrames[i] + Math.min(8, Math.floor((clickFrames[i + 1] - clickFrames[i]) * 0.35));
        const p = easeOutCubic((localFrame - holdEnd) / Math.max(6, clickFrames[i + 1] - holdEnd));
        const p0 = targets[i];
        const p2 = targets[i + 1];
        const ctrl: [number, number] = [p0[0] - 58, (p0[1] + p2[1]) * 0.5];
        [curX, curY] = quadBezierL(p, p0, ctrl, p2);
        activeClickFrame = localFrame - clickFrames[i] < 12 ? clickFrames[i] : clickFrames[i + 1];
        activeIdx = localFrame >= clickFrames[i + 1] - 3 ? i + 1 : i;
        found = true;
        break;
      }
    }
    if (!found) {
      [curX, curY] = targets[count - 1];
      activeClickFrame = clickFrames[count - 1];
      activeIdx = count - 1;
    }
  }

  const completedCount = clickFrames.filter((cf) => localFrame >= cf).length;
  const headerAppear = appear(localFrame, 0, 14);
  const activeStep = steps[Math.min(count - 1, Math.max(0, completedCount - 1))] || steps[0];

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden', fontFamily: FONT_THAI }}>
      <Look35MintBackdrop filterId={`l35-grain-steps-${sceneIndex}`} localFrame={localFrame} fps={fps} />

      {/* Top Crisp Title on Mint Backdrop (y: 162..258) */}
      <div
        style={{
          position: 'absolute',
          top: 164,
          left: SAFE_X,
          width: SAFE_W,
          opacity: headerAppear,
          transform: `translateY(${(1 - headerAppear) * 14}px)`,
        }}
      >
        <FitText
          text={t.title || 'ลำดับขั้นตอนการใช้งาน'}
          baseSize={44}
          minSize={26}
          maxLines={2}
          lineHeight={1.3}
          color={LOOK35.pillInk}
          fontWeight={800}
          align="center"
        />
      </div>

      {/* Dark-mode Workflow Window */}
      <div
        style={{
          position: 'absolute',
          left: winLeft,
          top: winTop,
          width: winW,
          backgroundColor: LOOK35.windowBg,
          borderRadius: 22,
          border: `1.5px solid ${LOOK35.border}`,
          boxShadow: '0 32px 72px rgba(15, 25, 32, 0.30), 0 8px 22px rgba(15, 25, 32, 0.16)',
          overflow: 'hidden',
        }}
      >
        <Look35WindowTitleBar
          workspaceLabel={`WORKFLOW · ${completedCount}/${count} STEPS`}
          rightBadge={`${Math.round((completedCount / count) * 100)}%`}
        />

        {/* Progress Track Bar */}
        <div style={{ height: 4, backgroundColor: LOOK35.panel, width: '100%' }}>
          <div
            style={{
              height: '100%',
              width: `${(completedCount / count) * 100}%`,
              background: `linear-gradient(90deg, ${LOOK35.blue}, #60A5FA)`,
            }}
          />
        </div>

        {/* Numbered Interactive Step Rows */}
        <div style={{ padding: '26px 26px 28px', display: 'flex', flexDirection: 'column', gap: rowGap }}>
          {steps.map((st, idx) => {
            const cf = clickFrames[idx];
            const dt = localFrame - cf;
            const isClicked = dt >= 0;
            const isJustClicked = dt >= 0 && dt <= 12;
            const pressScale = isJustClicked
              ? interpolate(dt, [0, 3, 12], [1, 0.95, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
              : 1;
            const rowIn = stagger(idx, localFrame, 5, 2, 12);

            return (
              <div
                key={idx}
                style={{
                  minHeight: rowHeight - 28,
                  padding: '18px 20px',
                  borderRadius: 16,
                  backgroundColor: isClicked ? LOOK35.panelAlt : LOOK35.panel,
                  border: isClicked ? `1.5px solid ${LOOK35.blue}` : `1px solid ${LOOK35.border}`,
                  boxShadow: isClicked ? '0 0 0 3px rgba(61, 123, 250, 0.18)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 18,
                  opacity: rowIn,
                  transform: `translateY(${(1 - rowIn) * 16}px)`,
                }}
              >
                {/* Step Number Badge */}
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    backgroundColor: isClicked ? LOOK35.blue : '#1F2026',
                    border: isClicked ? '1px solid rgba(255,255,255,0.25)' : `1px solid ${LOOK35.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: FONT_MONO,
                    fontSize: 20,
                    fontWeight: 800,
                    color: isClicked ? '#FFFFFF' : LOOK35.muted,
                    flexShrink: 0,
                  }}
                >
                  {isClicked ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M5 12.5L10 17.5L19 7.5"
                        stroke="#FFFFFF"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    st.tag
                  )}
                </div>

                {/* Step Thai Text */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <FitText
                    text={st.title}
                    baseSize={27}
                    minSize={19}
                    maxLines={2}
                    lineHeight={1.32}
                    color={LOOK35.text}
                    fontWeight={700}
                    align="left"
                  />
                  {st.detail ? (
                    <FitText
                      text={st.detail}
                      baseSize={20}
                      minSize={15}
                      maxLines={1}
                      lineHeight={1.32}
                      color={LOOK35.muted}
                      fontWeight={500}
                      align="left"
                    />
                  ) : null}
                </div>

                {/* Right-side Clickable UI Action Chip */}
                <div
                  style={{
                    width: 122,
                    padding: '11px 14px',
                    borderRadius: 10,
                    background: isClicked
                      ? `linear-gradient(180deg, ${LOOK35.blueTop} 0%, ${LOOK35.blue} 100%)`
                      : '#2E3038',
                    border: isClicked ? '1px solid rgba(255,255,255,0.22)' : `1px solid ${LOOK35.border}`,
                    transform: `scale(${pressScale})`,
                    textAlign: 'center',
                    fontFamily: FONT_MONO,
                    fontSize: 14,
                    fontWeight: 700,
                    color: isClicked ? '#FFFFFF' : LOOK35.muted,
                    flexShrink: 0,
                  }}
                >
                  {isClicked ? 'DONE ✓' : `STEP ${idx + 1}`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Animated Cursor + Click Ripple moving across step targets */}
      <Look35CursorAndRipple
        x={curX}
        y={curY}
        clickFrame={activeClickFrame}
        localFrame={localFrame}
        fps={fps}
        size={34}
      />

      {/* Bottom Floating Status Pill (well within y ≤ 1420) */}
      <Look35StepPill
        stepNum={String(Math.max(1, completedCount || activeIdx + 1))}
        text={
          completedCount >= count
            ? t.subtitle || `ครบทั้ง ${count} ขั้นตอนเรียบร้อย`
            : activeStep.title
        }
        enterFrame={6}
        localFrame={localFrame}
        fps={fps}
        isCheck={completedCount >= count}
        bottomY={1265}
      />
    </div>
  );
};

// ============================================================================
// LOOK-35 SHOT 3: toggle-before-after
// Settings panel comparing Left (OFF) -> Right (ON) as cursor flips the switch
// ============================================================================

const Look35ToggleBeforeAfter: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const t = sceneTexts(scene);
  const pts = extractPointsL(scene, 4);

  const leftTitle = scene.compare?.leftTitle || 'โหมดเดิม (ปิด)';
  const rightTitle = scene.compare?.rightTitle || 'โหมดใหม่ (เปิด)';
  const leftItems =
    scene.compare?.leftItems && scene.compare.leftItems.length > 0
      ? scene.compare.leftItems.slice(0, 3)
      : pts.slice(0, 2).length > 0
        ? pts.slice(0, 2)
        : ['ทำงานด้วยมือทีละขั้น'];
  const rightItems =
    scene.compare?.rightItems && scene.compare.rightItems.length > 0
      ? scene.compare.rightItems.slice(0, 3)
      : pts.slice(2, 4).length > 0
        ? pts.slice(2, 4)
        : [t.subtitle || t.title || 'ทำงานอัตโนมัติรวดเร็ว'];

  const safeDur = Math.max(50, durationFrames || 120);
  const toggleFrame = Math.round(safeDur * 0.46);
  const moveStart = Math.round(safeDur * 0.1);
  const moveDur = Math.max(14, toggleFrame - moveStart - 2);

  // Switch spring (0 = OFF, 1 = ON)
  const toggleSpring =
    localFrame >= toggleFrame
      ? spring({
          frame: localFrame - toggleFrame,
          fps,
          config: { damping: 15, stiffness: 190, mass: 0.75 },
        })
      : 0;
  const isOn = toggleSpring > 0.5;

  // Cursor glides to toggle switch center at (878, 434)
  const moveProg = easeOutCubic((localFrame - moveStart) / moveDur);
  const [curX, curY] = quadBezierL(moveProg, [340, 560], [640, 485], [878, 434]);

  const headerIn = appear(localFrame, 0, 14);
  const winIn = appear(localFrame, 3, 16);

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden', fontFamily: FONT_THAI }}>
      <Look35MintBackdrop filterId={`l35-grain-toggle-${sceneIndex}`} localFrame={localFrame} fps={fps} />

      {/* Title on Mint Backdrop */}
      <div
        style={{
          position: 'absolute',
          top: 164,
          left: SAFE_X,
          width: SAFE_W,
          opacity: headerIn,
          transform: `translateY(${(1 - headerIn) * 14}px)`,
        }}
      >
        <FitText
          text={t.title || 'เปรียบเทียบการตั้งค่า'}
          baseSize={44}
          minSize={26}
          maxLines={2}
          lineHeight={1.3}
          color={LOOK35.pillInk}
          fontWeight={800}
          align="center"
        />
      </div>

      {/* Dark-mode Settings Window */}
      <div
        style={{
          position: 'absolute',
          left: 64,
          top: 284,
          width: 952,
          backgroundColor: LOOK35.windowBg,
          borderRadius: 22,
          border: `1.5px solid ${LOOK35.border}`,
          boxShadow: '0 32px 76px rgba(15, 25, 32, 0.32), 0 8px 22px rgba(15, 25, 32, 0.16)',
          overflow: 'hidden',
          opacity: winIn,
          transform: `translateY(${(1 - winIn) * 18}px)`,
        }}
      >
        <Look35WindowTitleBar workspaceLabel="PREFERENCES · FEATURE TOGGLE" rightBadge={isOn ? 'ON' : 'OFF'} />

        <div style={{ padding: '26px 26px 28px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {/* Master Toggle Switch Row */}
          <div
            style={{
              backgroundColor: LOOK35.panel,
              border: isOn ? `1.5px solid ${LOOK35.blue}` : `1px solid ${LOOK35.border}`,
              borderRadius: 18,
              padding: '22px 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 20,
              boxShadow: isOn ? '0 0 0 3px rgba(61, 123, 250, 0.18)' : 'none',
            }}
          >
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    padding: '3px 10px',
                    borderRadius: 999,
                    backgroundColor: isOn ? 'rgba(61, 123, 250, 0.2)' : 'rgba(255, 90, 78, 0.18)',
                    color: isOn ? '#7AA8FF' : '#FF867D',
                    fontFamily: FONT_MONO,
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                  }}
                >
                  {isOn ? 'ENABLED · ON' : 'DISABLED · OFF'}
                </span>
              </div>
              <FitText
                text={isOn ? rightTitle : leftTitle}
                baseSize={30}
                minSize={20}
                maxLines={2}
                lineHeight={1.3}
                color={LOOK35.text}
                fontWeight={700}
                align="left"
              />
            </div>

            {/* Interactive Pill Toggle Switch */}
            <div
              style={{
                width: 112,
                height: 60,
                borderRadius: 999,
                backgroundColor: isOn ? LOOK35.blue : '#3A3D47',
                border: isOn ? '1.5px solid rgba(255,255,255,0.22)' : `1.5px solid ${LOOK35.border}`,
                padding: 6,
                position: 'relative',
                flexShrink: 0,
                boxShadow: isOn ? '0 0 24px rgba(61, 123, 250, 0.5)' : 'inset 0 2px 6px rgba(0,0,0,0.45)',
              }}
            >
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 999,
                  backgroundColor: '#FFFFFF',
                  boxShadow: '0 4px 10px rgba(0, 0, 0, 0.35)',
                  transform: `translateX(${interpolate(toggleSpring, [0, 1], [0, 52])}px)`,
                }}
              />
            </div>
          </div>

          {/* Left (Before/OFF) vs Right (After/ON) Settings Columns */}
          <div style={{ display: 'flex', gap: 18 }}>
            {/* Left Card (OFF) */}
            <div
              style={{
                flex: 1,
                backgroundColor: LOOK35.panel,
                border: !isOn ? `1.5px solid rgba(255, 90, 78, 0.65)` : `1px solid ${LOOK35.border}`,
                borderRadius: 18,
                padding: '22px 20px',
                opacity: interpolate(toggleSpring, [0, 1], [1, 0.45]),
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#FF867D',
                    letterSpacing: '0.08em',
                  }}
                >
                  BEFORE · OFF
                </span>
                <div style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: LOOK35.playhead }} />
              </div>

              <FitText
                text={leftTitle}
                baseSize={28}
                minSize={20}
                maxLines={2}
                lineHeight={1.3}
                color={LOOK35.text}
                fontWeight={700}
                align="left"
              />

              <div style={{ height: 1, backgroundColor: LOOK35.border }} />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {leftItems.map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: 16,
                        color: LOOK35.playhead,
                        fontWeight: 800,
                        marginTop: 4,
                        flexShrink: 0,
                      }}
                    >
                      ×
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <FitText
                        text={item}
                        baseSize={23}
                        minSize={16}
                        maxLines={3}
                        lineHeight={1.35}
                        color={LOOK35.muted}
                        fontWeight={500}
                        align="left"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Card (ON) */}
            <div
              style={{
                flex: 1,
                backgroundColor: isOn ? LOOK35.panelAlt : LOOK35.panel,
                border: isOn ? `1.5px solid ${LOOK35.blue}` : `1px solid ${LOOK35.border}`,
                borderRadius: 18,
                padding: '22px 20px',
                opacity: interpolate(toggleSpring, [0, 1], [0.42, 1]),
                transform: `scale(${interpolate(toggleSpring, [0, 1], [0.97, 1])})`,
                boxShadow: isOn ? '0 14px 36px rgba(61, 123, 250, 0.22)' : 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#7AA8FF',
                    letterSpacing: '0.08em',
                  }}
                >
                  AFTER · ON
                </span>
                <div style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: LOOK35.blue }} />
              </div>

              <FitText
                text={rightTitle}
                baseSize={28}
                minSize={20}
                maxLines={2}
                lineHeight={1.3}
                color="#FFFFFF"
                fontWeight={800}
                align="left"
              />

              <div style={{ height: 1, backgroundColor: isOn ? 'rgba(61, 123, 250, 0.4)' : LOOK35.border }} />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {rightItems.map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: 16,
                        color: '#4ADE80',
                        fontWeight: 800,
                        marginTop: 4,
                        flexShrink: 0,
                      }}
                    >
                      ✓
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <FitText
                        text={item}
                        baseSize={23}
                        minSize={16}
                        maxLines={3}
                        lineHeight={1.35}
                        color={LOOK35.text}
                        fontWeight={600}
                        align="left"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Cursor & Click Ripple on Toggle */}
      <Look35CursorAndRipple
        x={curX}
        y={curY}
        clickFrame={toggleFrame}
        localFrame={localFrame}
        fps={fps}
        size={34}
      />

      {/* Bottom Floating Pill */}
      <Look35StepPill
        stepNum={isOn ? 'ON' : 'OFF'}
        text={t.subtitle || (isOn ? `เปิดใช้งาน ${rightTitle}` : `เปลี่ยนจาก ${leftTitle} เป็น ${rightTitle}`)}
        enterFrame={toggleFrame + 6}
        localFrame={localFrame}
        fps={fps}
        isCheck={isOn}
        bottomY={1260}
      />
    </div>
  );
};

// ============================================================================
// LOOK-35 SHOT 4: success-toast
// Dark app window behind + elevated Success Toast / Modal with animated check
// ============================================================================

const Look35SuccessToast: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const t = sceneTexts(scene);
  const safeDur = Math.max(45, durationFrames || 120);
  const hasStat = Boolean(scene.stat && String(scene.stat.value ?? '').trim());
  const hasQuote = Boolean(scene.quote?.text);
  const metric = extractPrimaryMetricL(scene, 100, '%');

  const toastSpring = spring({
    frame: Math.max(0, localFrame - 6),
    fps,
    config: { damping: 14, stiffness: 155, mass: 0.8 },
  });
  const checkDraw = easeOutCubic((localFrame - 14) / 16);
  const progressPct = interpolate(easeOutCubic(localFrame / Math.max(20, safeDur * 0.42)), [0, 1], [18, 100]);
  const ringExpand =
    localFrame >= 16
      ? spring({
          frame: localFrame - 16,
          fps,
          config: { damping: 18, stiffness: 90 },
        })
      : 0;
  const ringOpacity =
    localFrame >= 16
      ? interpolate(localFrame - 16, [0, 6, 30], [0.8, 0.5, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 0;

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden', fontFamily: FONT_THAI }}>
      <Look35MintBackdrop filterId={`l35-grain-toast-${sceneIndex}`} localFrame={localFrame} fps={fps} />

      {/* Background Dark-Mode App Window (slightly receded to frame the Toast) */}
      <div
        style={{
          position: 'absolute',
          left: 74,
          top: 224,
          width: 932,
          height: 820,
          backgroundColor: LOOK35.windowBg,
          borderRadius: 22,
          border: `1.5px solid ${LOOK35.border}`,
          boxShadow: '0 28px 68px rgba(15, 25, 32, 0.28)',
          overflow: 'hidden',
          opacity: 0.92,
        }}
      >
        <Look35WindowTitleBar workspaceLabel="STUDIO · STATUS MONITOR" rightBadge="100%" />

        {/* Subtle workspace skeleton bars */}
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 18, opacity: 0.42 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1, height: 110, borderRadius: 14, backgroundColor: LOOK35.panel, border: `1px solid ${LOOK35.border}` }} />
            <div style={{ flex: 1, height: 110, borderRadius: 14, backgroundColor: LOOK35.panel, border: `1px solid ${LOOK35.border}` }} />
          </div>
          <div style={{ height: 180, borderRadius: 14, backgroundColor: LOOK35.panel, border: `1px solid ${LOOK35.border}` }} />
          <div style={{ height: 22, borderRadius: 999, backgroundColor: LOOK35.panel, overflow: 'hidden' }}>
            <div style={{ width: `${progressPct}%`, height: '100%', backgroundColor: LOOK35.blue }} />
          </div>
        </div>
      </div>

      {/* Hero Success Toast Modal (centered cleanly inside y ∈ [330, 1140]) */}
      <div
        style={{
          position: 'absolute',
          top: 344,
          left: 110,
          width: 860,
          backgroundColor: LOOK35.panelAlt,
          borderRadius: 26,
          border: `1.5px solid ${LOOK35.border}`,
          boxShadow: '0 36px 90px rgba(10, 14, 20, 0.56), 0 0 0 1px rgba(255,255,255,0.06)',
          padding: '44px 42px 38px',
          transform: `translateY(${interpolate(toastSpring, [0, 1], [44, 0])}px) scale(${interpolate(toastSpring, [0, 1], [0.9, 1])})`,
          opacity: clamp01(toastSpring * 2),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 24,
        }}
      >
        {/* Top Accent Line */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 48,
            right: 48,
            height: 4,
            borderRadius: '0 0 6px 6px',
            background: `linear-gradient(90deg, ${LOOK35.blue}, ${LOOK35.success})`,
          }}
        />

        {/* Animated Success Check Circle */}
        <div style={{ position: 'relative', width: 108, height: 108, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {ringOpacity > 0.01 && (
            <div
              style={{
                position: 'absolute',
                width: 108 + ringExpand * 56,
                height: 108 + ringExpand * 56,
                borderRadius: 999,
                border: `2.5px solid ${LOOK35.success}`,
                opacity: ringOpacity,
              }}
            />
          )}
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: 999,
              background: 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)',
              boxShadow: '0 14px 36px rgba(34, 197, 94, 0.42)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <path
                d="M11 25L20 34L37 15"
                stroke="#FFFFFF"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="48"
                strokeDashoffset={48 * (1 - checkDraw)}
              />
            </svg>
          </div>
        </div>

        {/* Status Kicker */}
        <div
          style={{
            padding: '5px 16px',
            borderRadius: 999,
            backgroundColor: 'rgba(34, 197, 94, 0.14)',
            border: '1px solid rgba(34, 197, 94, 0.36)',
            fontFamily: FONT_MONO,
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: '#4ADE80',
          }}
        >
          COMPLETED · SUCCESS
        </div>

        {/* Body Content: Stat / Quote / Default Title */}
        {hasStat ? (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'center',
                gap: 10,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <span
                style={{
                  fontFamily: FONT_THAI,
                  fontSize: metric.big.length > 7 ? 72 : 96,
                  fontWeight: 900,
                  color: '#FFFFFF',
                  lineHeight: 1.08,
                  letterSpacing: '-0.02em',
                }}
              >
                {metric.big}
              </span>
              {metric.unit ? (
                <span style={{ fontFamily: FONT_THAI, fontSize: 38, fontWeight: 700, color: '#7AA8FF' }}>
                  {metric.unit}
                </span>
              ) : null}
            </div>
            <FitText
              text={metric.label || t.title}
              baseSize={34}
              minSize={22}
              maxLines={2}
              lineHeight={1.34}
              color={LOOK35.text}
              fontWeight={700}
              align="center"
            />
            {metric.delta ? (
              <div
                style={{
                  padding: '6px 18px',
                  borderRadius: 999,
                  backgroundColor: 'rgba(61, 123, 250, 0.18)',
                  border: `1px solid rgba(61, 123, 250, 0.45)`,
                }}
              >
                <FitText
                  text={metric.delta}
                  baseSize={22}
                  minSize={16}
                  maxLines={1}
                  lineHeight={1.3}
                  color="#93B8FF"
                  fontWeight={700}
                  align="center"
                />
              </div>
            ) : null}
          </div>
        ) : hasQuote ? (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                width: '100%',
                borderLeft: `4px solid ${LOOK35.blue}`,
                paddingLeft: 24,
                paddingTop: 4,
                paddingBottom: 4,
              }}
            >
              <FitText
                text={`“${scene.quote?.text}”`}
                baseSize={36}
                minSize={22}
                maxLines={4}
                lineHeight={1.4}
                color={LOOK35.text}
                fontWeight={700}
                align="left"
              />
            </div>
            {scene.quote?.author ? (
              <FitText
                text={`— ${scene.quote.author}`}
                baseSize={24}
                minSize={17}
                maxLines={1}
                lineHeight={1.32}
                color={LOOK35.muted}
                fontWeight={600}
                align="center"
              />
            ) : null}
          </div>
        ) : (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <FitText
              text={t.title || 'ดำเนินการสำเร็จเรียบร้อย'}
              baseSize={42}
              minSize={26}
              maxLines={2}
              lineHeight={1.32}
              color="#FFFFFF"
              fontWeight={800}
              align="center"
            />
            {t.subtitle ? (
              <FitText
                text={t.subtitle}
                baseSize={26}
                minSize={18}
                maxLines={2}
                lineHeight={1.36}
                color={LOOK35.muted}
                fontWeight={500}
                align="center"
              />
            ) : null}
          </div>
        )}

        {/* Completion Progress Bar & Confirm Chip */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: FONT_MONO, fontSize: 13, color: LOOK35.muted }}>
            <span>STATUS</span>
            <span>{Math.round(progressPct)}%</span>
          </div>
          <div style={{ width: '100%', height: 10, borderRadius: 999, backgroundColor: LOOK35.windowBg, overflow: 'hidden' }}>
            <div
              style={{
                width: `${progressPct}%`,
                height: '100%',
                borderRadius: 999,
                background: `linear-gradient(90deg, ${LOOK35.blue}, ${LOOK35.success})`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Bottom Floating White Notification Toast Pill (safely within y ≤ 1420) */}
      <Look35StepPill
        stepNum="✓"
        text={t.subtitle || t.badge || t.title || 'บันทึกผลลัพธ์เรียบร้อย'}
        enterFrame={18}
        localFrame={localFrame}
        fps={fps}
        isCheck
        bottomY={1245}
      />
    </div>
  );
};

// ============================================================================
// LOOK-37: GLOW ORB — SHARED MINIMAL PRIMITIVES
// Ground #070304, Deep Rose Halo #13050B, Orb #FBF6F8 -> #F696DE -> #531829
// Thin outline circles & typography in #F6EFF2, calm minimal composition
// ============================================================================

interface SeededCircleL {
  baseX: number;
  baseY: number;
  r: number;
  depth: number; // 0.35..1.0
  strokeW: number;
  opacity: number;
}

function buildSeededOutlineCirclesL(seedBase: number, count = 7): SeededCircleL[] {
  // Deliberately distributed near frame edges so some clip frame borders
  // while leaving the central text corridor calm and unobstructed
  const anchors: Array<[number, number, number]> = [
    [95, 195, 175],
    [995, 240, 210],
    [-25, 640, 150],
    [1105, 760, 190],
    [115, 1340, 160],
    [1010, 1460, 225],
    [540, 88, 120],
  ];

  return anchors.slice(0, count).map((a, idx) => {
    const h1 = seededHashL(seedBase * 31 + idx * 17 + 3);
    const h2 = seededHashL(seedBase * 31 + idx * 17 + 7);
    const h3 = seededHashL(seedBase * 31 + idx * 17 + 11);
    const depth = 0.38 + h3 * 0.62;
    return {
      baseX: a[0] + (h1 - 0.5) * 90,
      baseY: a[1] + (h2 - 0.5) * 85,
      r: a[2] * (0.78 + h3 * 0.42),
      depth,
      strokeW: 0.9 + depth * 0.75,
      opacity: 0.08 + depth * 0.16,
    };
  });
}

const Look37AmbientStage: React.FC<{
  sceneIndex: number;
  localFrame: number;
  durationFrames: number;
  orbCx?: number;
  orbCy?: number;
  circleCount?: number;
}> = ({ sceneIndex, localFrame, durationFrames, orbCx = 540, orbCy = 680, circleCount = 7 }) => {
  const safeDur = Math.max(45, durationFrames || 120);
  const driftT = easeOutCubic(localFrame / (safeDur * 0.88));
  const circles = buildSeededOutlineCirclesL(37 + sceneIndex * 13, circleCount);

  return (
    <div style={{ position: 'absolute', inset: 0, backgroundColor: LOOK37.bg, overflow: 'hidden' }}>
      {/* Parallax thin outline circles drifting gently toward the orb */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        {circles.map((c, idx) => {
          const pull = 28 * c.depth * driftT;
          const dx = orbCx - c.baseX;
          const dy = orbCy - c.baseY;
          const dist = Math.max(1, Math.hypot(dx, dy));
          const cx = c.baseX + (dx / dist) * pull;
          const cy = c.baseY + (dy / dist) * pull;
          return (
            <circle
              key={idx}
              cx={cx}
              cy={cy}
              r={c.r}
              fill="none"
              stroke={LOOK37.line}
              strokeWidth={c.strokeW}
              opacity={c.opacity}
            />
          );
        })}
      </svg>
    </div>
  );
};

const Look37GlowingOrb: React.FC<{
  cx: number;
  cy: number;
  radius: number;
  localFrame: number;
  durationFrames: number;
  fps: number;
  filterId: string;
  phaseOffset?: number;
  dimmed?: boolean;
  showExhaleRing?: boolean;
  hollowCenter?: boolean;
}> = ({
  cx,
  cy,
  radius,
  localFrame,
  durationFrames,
  fps,
  filterId,
  phaseOffset = 0,
  dimmed = false,
  showExhaleRing = false,
  hollowCenter = false,
}) => {
  const safeFps = Math.max(1, fps || 30);
  const safeDur = Math.max(45, durationFrames || 120);

  // One deep breath on spring (~10% overshoot), then steady calm sin breathing
  const introBreath = spring({
    frame: localFrame,
    fps: safeFps,
    config: { damping: 11, stiffness: 82, mass: 1.0 },
  });
  const introScale = interpolate(introBreath, [0, 1], [0.84, 1]);
  const breath = 1 + 0.04 * Math.sin((localFrame / safeFps) * Math.PI * 2 * 0.4 + phaseOffset);
  const orbScale = introScale * breath;

  // Halo lags gently behind orb breath
  const haloFrame = Math.max(0, localFrame - 4);
  const haloBreath = 1 + 0.045 * Math.sin((haloFrame / safeFps) * Math.PI * 2 * 0.4 + phaseOffset);
  const haloScale = introScale * haloBreath;

  // Optional secondary beat: rim lifts off into one calm orbit ring near ~66%
  const exhaleStart = Math.round(safeDur * 0.64);
  const exhaleSpring =
    showExhaleRing && localFrame >= exhaleStart
      ? spring({
          frame: localFrame - exhaleStart,
          fps: safeFps,
          config: { damping: 16, stiffness: 75, mass: 1.0 },
        })
      : 0;

  const haloR = radius * 2.55;
  const dia = radius * 2;

  return (
    <div style={{ position: 'absolute', left: cx, top: cy, pointerEvents: 'none' }}>
      {/* Deep Rose Halo (#13050B) dying out completely before frame corners */}
      <div
        style={{
          position: 'absolute',
          left: -haloR,
          top: -haloR,
          width: haloR * 2,
          height: haloR * 2,
          borderRadius: 999,
          background: dimmed
            ? `radial-gradient(circle, rgba(83, 24, 41, 0.56) 0%, rgba(19, 5, 11, 0.72) 44%, rgba(7, 3, 4, 0) 74%)`
            : `radial-gradient(circle, rgba(246, 150, 222, 0.34) 0%, rgba(83, 24, 41, 0.52) 34%, ${LOOK37.halo} 58%, rgba(7, 3, 4, 0) 76%)`,
          filter: 'blur(26px)',
          transform: `scale(${haloScale.toFixed(4)})`,
        }}
      />

      {/* Fine dither grain restricted strictly inside the glow halo (prevents banding) */}
      <svg
        width={haloR * 1.5}
        height={haloR * 1.5}
        viewBox="0 0 300 300"
        style={{
          position: 'absolute',
          left: -haloR * 0.75,
          top: -haloR * 0.75,
          borderRadius: 999,
          opacity: 0.04,
          mixBlendMode: 'screen',
        }}
      >
        <defs>
          <filter id={filterId}>
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={37} />
          </filter>
          <clipPath id={`${filterId}-clip`}>
            <circle cx="150" cy="150" r="145" />
          </clipPath>
        </defs>
        <rect width="300" height="300" filter={`url(#${filterId})`} clipPath={`url(#${filterId}-clip)`} />
      </svg>

      {/* Main Luminous Orb Body */}
      <div
        style={{
          position: 'absolute',
          left: -radius,
          top: -radius,
          width: dia,
          height: dia,
          borderRadius: 999,
          background: dimmed
            ? `radial-gradient(circle at 38% 34%, #E7B2D7 0%, #A94B80 42%, ${LOOK37.orbEdge} 82%, #240912 100%)`
            : hollowCenter
              ? `radial-gradient(circle at 50% 50%, #240814 0%, #3A0E21 38%, ${LOOK37.orbEdge} 62%, ${LOOK37.orbPink} 86%, ${LOOK37.orbWhite} 100%)`
              : `radial-gradient(circle at 38% 34%, ${LOOK37.orbWhite} 0%, #FBD6F1 26%, ${LOOK37.orbPink} 58%, #9A3768 82%, ${LOOK37.orbEdge} 100%)`,
          boxShadow: dimmed
            ? `inset 0 0 18px rgba(246, 239, 242, 0.25), 0 0 42px rgba(83, 24, 41, 0.55)`
            : `inset 0 0 22px rgba(251, 246, 248, 0.62), 0 0 72px rgba(246, 150, 222, 0.44), 0 0 130px rgba(83, 24, 41, 0.62)`,
          border: `1.4px solid rgba(251, 246, 248, ${dimmed ? 0.35 : 0.72})`,
          transform: `scale(${orbScale.toFixed(4)})`,
        }}
      />

      {/* Exhale Lift-off Orbit Ring */}
      {showExhaleRing && exhaleSpring > 0.01 && (
        <div
          style={{
            position: 'absolute',
            left: -radius,
            top: -radius,
            width: dia,
            height: dia,
            borderRadius: 999,
            border: `1.5px solid ${LOOK37.line}`,
            opacity: interpolate(exhaleSpring, [0, 0.2, 1], [0, 0.68, 0.34]),
            transform: `scale(${interpolate(exhaleSpring, [0, 1], [1.02, 1.88]).toFixed(4)})`,
          }}
        />
      )}
    </div>
  );
};

// ============================================================================
// LOOK-37 SHOT 1: breathing-orb-line
// Calm glowing breathing orb above center + crisp single-line text below
// ============================================================================

const Look37BreathingOrbLine: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const t = sceneTexts(scene);
  const mainLine = t.title || t.subtitle || 'แสงสว่างจากความสงบ';
  const subLine = t.subtitle && t.subtitle !== mainLine ? t.subtitle : '';

  // Masked upward reveal (no fade-only flatness) with tightening tracking
  const textSpring = spring({
    frame: Math.max(0, localFrame - 10),
    fps: Math.max(1, fps || 30),
    config: { damping: 16, stiffness: 120, mass: 0.85 },
  });
  const textRise = interpolate(textSpring, [0, 1], [76, 0]);
  const tracking = interpolate(textSpring, [0, 1], [0.04, -0.02]);

  const subSpring = spring({
    frame: Math.max(0, localFrame - 22),
    fps: Math.max(1, fps || 30),
    config: { damping: 18, stiffness: 115, mass: 0.85 },
  });

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden', fontFamily: FONT_THAI }}>
      <Look37AmbientStage
        sceneIndex={sceneIndex}
        localFrame={localFrame}
        durationFrames={durationFrames}
        orbCx={540}
        orbCy={640}
        circleCount={7}
      />

      {/* Glowing Breathing Orb slightly above center */}
      <Look37GlowingOrb
        cx={540}
        cy={640}
        radius={166}
        localFrame={localFrame}
        durationFrames={durationFrames}
        fps={fps}
        filterId={`l37-dither-hero-${sceneIndex}`}
        showExhaleRing
      />

      {/* Calm Single-Line Headline (~6% frame height, masked upward rise) */}
      <div
        style={{
          position: 'absolute',
          top: 970,
          left: SAFE_X + 16,
          width: SAFE_W - 32,
          paddingTop: 6,
          paddingBottom: 6,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            transform: `translateY(${textRise.toFixed(2)}px)`,
          }}
        >
          <FitText
            text={mainLine}
            baseSize={64}
            minSize={32}
            maxLines={2}
            lineHeight={1.32}
            color={LOOK37.line}
            fontWeight={500}
            align="center"
            style={{ letterSpacing: `${tracking.toFixed(3)}em` }}
          />
        </div>
      </div>

      {/* Optional delicate secondary line (only if distinct, well above y=1420) */}
      {subLine ? (
        <div
          style={{
            position: 'absolute',
            top: 1140,
            left: SAFE_X + 64,
            width: SAFE_W - 128,
            overflow: 'hidden',
          }}
        >
          <div style={{ transform: `translateY(${interpolate(subSpring, [0, 1], [48, 0]).toFixed(2)}px)` }}>
            <FitText
              text={subLine}
              baseSize={28}
              minSize={20}
              maxLines={2}
              lineHeight={1.4}
              color="rgba(246, 239, 242, 0.58)"
              fontWeight={400}
              align="center"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
};

// ============================================================================
// LOOK-37 SHOT 2: orbit-rings-points
// Bullets arranged as minimal glowing orbital tags around the breathing orb
// ============================================================================

const Look37OrbitRingsPoints: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const t = sceneTexts(scene);
  const pts = extractPointsL(scene, 4);
  const safePts = pts.length > 0 ? pts : [t.title || 'จุดสมดุล', 'ความชัดเจน', 'จังหวะที่พอดี'];
  const safeFps = Math.max(1, fps || 30);

  const orbCx = 540;
  const orbCy = 700;
  const orbits = [188, 286, 386];

  // Clean non-overlapping node & tag slots strictly inside x ∈ [64, 1016], y ∈ [290, 1370]
  const slots4: Array<{
    dotX: number;
    dotY: number;
    cardX: number;
    cardY: number;
    cardW: number;
    align: 'left' | 'right';
  }> = [
    { dotX: 374, dotY: 518, cardX: 64, cardY: 322, cardW: 410, align: 'left' },
    { dotX: 742, dotY: 500, cardX: 606, cardY: 322, cardW: 410, align: 'right' },
    { dotX: 344, dotY: 896, cardX: 64, cardY: 1110, cardW: 410, align: 'left' },
    { dotX: 740, dotY: 890, cardX: 606, cardY: 1110, cardW: 410, align: 'right' },
  ];

  const slots3: Array<{
    dotX: number;
    dotY: number;
    cardX: number;
    cardY: number;
    cardW: number;
    align: 'left' | 'right';
  }> = [
    { dotX: 368, dotY: 526, cardX: 64, cardY: 328, cardW: 420, align: 'left' },
    { dotX: 786, dotY: 640, cardX: 590, cardY: 420, cardW: 426, align: 'right' },
    { dotX: 432, dotY: 966, cardX: 250, cardY: 1140, cardW: 580, align: 'left' },
  ];

  const activeSlots = safePts.length <= 3 ? slots3 : slots4;
  const titleSpring = spring({
    frame: localFrame,
    fps: safeFps,
    config: { damping: 17, stiffness: 120 },
  });

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden', fontFamily: FONT_THAI }}>
      <Look37AmbientStage
        sceneIndex={sceneIndex}
        localFrame={localFrame}
        durationFrames={durationFrames}
        orbCx={orbCx}
        orbCy={orbCy}
        circleCount={6}
      />

      {/* Minimal Title Header (y: 132..246) */}
      <div
        style={{
          position: 'absolute',
          top: 136,
          left: SAFE_X + 20,
          width: SAFE_W - 40,
          transform: `translateY(${interpolate(titleSpring, [0, 1], [24, 0])}px)`,
        }}
      >
        <FitText
          text={t.title || 'องค์ประกอบสำคัญ'}
          baseSize={46}
          minSize={28}
          maxLines={2}
          lineHeight={1.32}
          color={LOOK37.line}
          fontWeight={500}
          align="center"
        />
      </div>

      {/* Concentric Orbit Rings + Leader Hairlines + Glowing Orbital Nodes */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        {orbits.map((r, i) => {
          const ringPop = spring({
            frame: Math.max(0, localFrame - i * 5),
            fps: safeFps,
            config: { damping: 18, stiffness: 90 },
          });
          return (
            <circle
              key={i}
              cx={orbCx}
              cy={orbCy}
              r={r * interpolate(ringPop, [0, 1], [0.75, 1])}
              fill="none"
              stroke={LOOK37.line}
              strokeWidth={1.15}
              opacity={0.14 + (2 - i) * 0.07}
            />
          );
        })}

        {safePts.map((_, idx) => {
          const slot = activeSlots[idx % activeSlots.length];
          const p = spring({
            frame: Math.max(0, localFrame - (8 + idx * 8)),
            fps: safeFps,
            config: { damping: 15, stiffness: 135 },
          });
          const anchorX = slot.cardX + slot.cardW * 0.5;
          const anchorY = slot.cardY < orbCy ? slot.cardY + 96 : slot.cardY;
          const lx = interpolate(p, [0, 1], [slot.dotX, anchorX]);
          const ly = interpolate(p, [0, 1], [slot.dotY, anchorY]);
          return (
            <g key={idx}>
              <line
                x1={slot.dotX}
                y1={slot.dotY}
                x2={lx}
                y2={ly}
                stroke={LOOK37.line}
                strokeWidth={1.1}
                opacity={0.36 * clamp01(p)}
              />
              <circle
                cx={slot.dotX}
                cy={slot.dotY}
                r={12 * p}
                fill={LOOK37.orbPink}
                opacity={0.28}
              />
              <circle
                cx={slot.dotX}
                cy={slot.dotY}
                r={5.5 * p}
                fill={LOOK37.orbWhite}
              />
            </g>
          );
        })}
      </svg>

      {/* Central Breathing Glow Orb */}
      <Look37GlowingOrb
        cx={orbCx}
        cy={orbCy}
        radius={108}
        localFrame={localFrame}
        durationFrames={durationFrames}
        fps={fps}
        filterId={`l37-dither-orbit-${sceneIndex}`}
      />

      {/* Orbital Point Tags (HTML overlays with Thai-safe FitText) */}
      {safePts.map((pt, idx) => {
        const slot = activeSlots[idx % activeSlots.length];
        const pop = spring({
          frame: Math.max(0, localFrame - (10 + idx * 8)),
          fps: safeFps,
          config: { damping: 15, stiffness: 150, mass: 0.78 },
        });
        const scale = interpolate(pop, [0, 1], [0.82, 1]);
        const ty = interpolate(pop, [0, 1], [16, 0]);
        return (
          <div
            key={idx}
            style={{
              position: 'absolute',
              left: slot.cardX,
              top: slot.cardY,
              width: slot.cardW,
              padding: '16px 20px',
              borderRadius: 18,
              backgroundColor: 'rgba(19, 5, 11, 0.86)',
              border: '1px solid rgba(246, 239, 242, 0.24)',
              boxShadow: '0 14px 36px rgba(7, 3, 4, 0.65)',
              transform: `translateY(${ty.toFixed(2)}px) scale(${scale.toFixed(4)})`,
              opacity: clamp01(pop * 2),
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 999,
                border: `1px solid ${LOOK37.orbPink}`,
                backgroundColor: 'rgba(246, 150, 222, 0.14)',
                color: LOOK37.line,
                fontFamily: FONT_MONO,
                fontSize: 13,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: 4,
              }}
            >
              0{idx + 1}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <FitText
                text={pt}
                baseSize={25}
                minSize={18}
                maxLines={3}
                lineHeight={1.36}
                color={LOOK37.line}
                fontWeight={500}
                align="left"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ============================================================================
// LOOK-37 SHOT 3: orb-stat
// Luminous metric number nestled inside the breathing glow orb + progress arc
// ============================================================================

const Look37OrbStat: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const t = sceneTexts(scene);
  const metric = extractPrimaryMetricL(scene, 98, '%');
  const safeFps = Math.max(1, fps || 30);

  const orbCx = 540;
  const orbCy = 640;
  const orbR = 224;
  const arcR = 264;
  const arcCircumference = 2 * Math.PI * arcR;

  const numSpring = spring({
    frame: Math.max(0, localFrame - 6),
    fps: safeFps,
    config: { damping: 16, stiffness: 110 },
  });
  const arcProg = easeOutCubic((localFrame - 4) / Math.max(24, durationFrames * 0.52)) * metric.progress;

  const labelSpring = spring({
    frame: Math.max(0, localFrame - 14),
    fps: safeFps,
    config: { damping: 16, stiffness: 120 },
  });

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden', fontFamily: FONT_THAI }}>
      <Look37AmbientStage
        sceneIndex={sceneIndex}
        localFrame={localFrame}
        durationFrames={durationFrames}
        orbCx={orbCx}
        orbCy={orbCy}
        circleCount={7}
      />

      {/* Glowing Eclipse-Core Orb so #F6EFF2 numeral shines cleanly inside the orb light */}
      <Look37GlowingOrb
        cx={orbCx}
        cy={orbCy}
        radius={orbR}
        localFrame={localFrame}
        durationFrames={durationFrames}
        fps={fps}
        filterId={`l37-dither-stat-${sceneIndex}`}
        hollowCenter
        showExhaleRing
      />

      {/* Thin Orbital Progress Ring Around the Orb */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        <circle
          cx={orbCx}
          cy={orbCy}
          r={arcR}
          fill="none"
          stroke={LOOK37.line}
          strokeWidth={1.2}
          opacity={0.18}
        />
        <circle
          cx={orbCx}
          cy={orbCy}
          r={arcR}
          fill="none"
          stroke={LOOK37.orbPink}
          strokeWidth={2.8}
          strokeLinecap="round"
          strokeDasharray={arcCircumference}
          strokeDashoffset={arcCircumference * (1 - clamp01(arcProg))}
          transform={`rotate(-90 ${orbCx} ${orbCy})`}
          opacity={0.88}
        />
      </svg>

      {/* Primary Stat Value inside Orb Light */}
      <div
        style={{
          position: 'absolute',
          left: orbCx - 210,
          top: orbCy - 105,
          width: 420,
          height: 210,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `scale(${interpolate(numSpring, [0, 1], [0.84, 1]).toFixed(4)})`,
        }}
      >
        <div
          style={{
            fontFamily: FONT_THAI,
            fontSize: metric.big.length > 7 ? 68 : metric.big.length > 4 ? 92 : 114,
            fontWeight: 700,
            color: LOOK37.line,
            lineHeight: 1.05,
            letterSpacing: '-0.03em',
            fontVariantNumeric: 'tabular-nums',
            textShadow: '0 6px 28px rgba(19, 5, 11, 0.92), 0 0 36px rgba(246, 150, 222, 0.45)',
            textAlign: 'center',
          }}
        >
          {metric.big}
        </div>
        {metric.unit ? (
          <div style={{ marginTop: 4 }}>
            <FitText
              text={metric.unit}
              baseSize={30}
              minSize={20}
              maxLines={1}
              lineHeight={1.3}
              color="rgba(246, 239, 242, 0.82)"
              fontWeight={500}
              align="center"
            />
          </div>
        ) : null}
      </div>

      {/* Label & Optional Delta below Orb (y: 970..1340, safely above y=1420) */}
      <div
        style={{
          position: 'absolute',
          top: 978,
          left: SAFE_X + 24,
          width: SAFE_W - 48,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 18,
          transform: `translateY(${interpolate(labelSpring, [0, 1], [32, 0]).toFixed(2)}px)`,
        }}
      >
        <FitText
          text={metric.label || t.title}
          baseSize={46}
          minSize={26}
          maxLines={2}
          lineHeight={1.34}
          color={LOOK37.line}
          fontWeight={500}
          align="center"
        />

        <div style={{ width: 96, height: 1, backgroundColor: 'rgba(246, 239, 242, 0.28)' }} />

        {metric.delta ? (
          <div
            style={{
              padding: '8px 22px',
              borderRadius: 999,
              backgroundColor: 'rgba(246, 150, 222, 0.12)',
              border: '1px solid rgba(246, 150, 222, 0.4)',
            }}
          >
            <FitText
              text={metric.delta}
              baseSize={24}
              minSize={18}
              maxLines={1}
              lineHeight={1.3}
              color={LOOK37.line}
              fontWeight={500}
              align="center"
            />
          </div>
        ) : t.subtitle && t.subtitle !== metric.label ? (
          <FitText
            text={t.subtitle}
            baseSize={26}
            minSize={19}
            maxLines={2}
            lineHeight={1.4}
            color="rgba(246, 239, 242, 0.62)"
            fontWeight={400}
            align="center"
          />
        ) : null}
      </div>
    </div>
  );
};

// ============================================================================
// LOOK-37 SHOT 4: twin-orb-compare
// Twin breathing orbs for compare (contrasting pair) or quote (resonant pair)
// ============================================================================

const Look37TwinOrbCompare: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
}) => {
  const t = sceneTexts(scene);
  const safeFps = Math.max(1, fps || 30);
  const isQuoteMode = Boolean(scene.quote?.text) && !scene.compare;

  const contentSpring = spring({
    frame: Math.max(0, localFrame - 10),
    fps: safeFps,
    config: { damping: 16, stiffness: 120 },
  });

  if (isQuoteMode) {
    const quoteText = String(scene.quote?.text || t.title || '').trim();
    const author = String(scene.quote?.author || scene.quote?.source || t.subtitle || '').trim();

    return (
      <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden', fontFamily: FONT_THAI }}>
        <Look37AmbientStage
          sceneIndex={sceneIndex}
          localFrame={localFrame}
          durationFrames={durationFrames}
          orbCx={540}
          orbCy={490}
          circleCount={7}
        />

        {/* Intersecting Orbit Circles behind Twin Orbs */}
        <svg
          width={STAGE_W}
          height={STAGE_H}
          viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          <circle cx={442} cy={472} r={168} fill="none" stroke={LOOK37.line} strokeWidth={1.1} opacity={0.22} />
          <circle cx={644} cy={504} r={138} fill="none" stroke={LOOK37.line} strokeWidth={1.1} opacity={0.18} />
        </svg>

        {/* Twin Resonant Orbs */}
        <Look37GlowingOrb
          cx={442}
          cy={472}
          radius={116}
          localFrame={localFrame}
          durationFrames={durationFrames}
          fps={fps}
          filterId={`l37-dither-q1-${sceneIndex}`}
          phaseOffset={0}
        />
        <Look37GlowingOrb
          cx={644}
          cy={504}
          radius={84}
          localFrame={localFrame}
          durationFrames={durationFrames}
          fps={fps}
          filterId={`l37-dither-q2-${sceneIndex}`}
          phaseOffset={Math.PI * 0.65}
          dimmed
        />

        {/* Minimalist Quote Typography Block (y: 720..1310, safely above y=1420) */}
        <div
          style={{
            position: 'absolute',
            top: 728,
            left: SAFE_X + 36,
            width: SAFE_W - 72,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 28,
            transform: `translateY(${interpolate(contentSpring, [0, 1], [38, 0]).toFixed(2)}px)`,
          }}
        >
          <div style={{ width: 64, height: 1.5, backgroundColor: LOOK37.orbPink, opacity: 0.75 }} />

          <FitText
            text={`“${quoteText}”`}
            baseSize={48}
            minSize={26}
            maxLines={5}
            lineHeight={1.42}
            color={LOOK37.line}
            fontWeight={500}
            align="center"
          />

          {author ? (
            <FitText
              text={`— ${author}`}
              baseSize={26}
              minSize={19}
              maxLines={2}
              lineHeight={1.36}
              color="rgba(246, 239, 242, 0.62)"
              fontWeight={400}
              align="center"
            />
          ) : null}
        </div>
      </div>
    );
  }

  // Compare mode (with full fallback if scene.compare is missing)
  const pts = extractPointsL(scene, 4);
  const leftTitle = scene.compare?.leftTitle || 'ก่อนเปลี่ยนมุมมอง';
  const rightTitle = scene.compare?.rightTitle || 'หลังเปลี่ยนมุมมอง';
  const leftItems =
    scene.compare?.leftItems && scene.compare.leftItems.length > 0
      ? scene.compare.leftItems.slice(0, 3)
      : pts.slice(0, 2).length > 0
        ? pts.slice(0, 2)
        : [t.subtitle || 'จังหวะที่เร่งรีบ'];
  const rightItems =
    scene.compare?.rightItems && scene.compare.rightItems.length > 0
      ? scene.compare.rightItems.slice(0, 3)
      : pts.slice(2, 4).length > 0
        ? pts.slice(2, 4)
        : [t.title || 'ความสงบและชัดเจน'];

  const pulseT = (localFrame / Math.max(1, durationFrames)) % 1;
  const [pulseX, pulseY] = quadBezierL(easeOutCubic(pulseT), [300, 560], [540, 460], [780, 520]);

  return (
    <div style={{ position: 'relative', width: STAGE_W, height: STAGE_H, overflow: 'hidden', fontFamily: FONT_THAI }}>
      <Look37AmbientStage
        sceneIndex={sceneIndex}
        localFrame={localFrame}
        durationFrames={durationFrames}
        orbCx={540}
        orbCy={540}
        circleCount={7}
      />

      {/* Minimal Header (y: 132..246) */}
      <div
        style={{
          position: 'absolute',
          top: 136,
          left: SAFE_X + 20,
          width: SAFE_W - 40,
        }}
      >
        <FitText
          text={t.title || `${leftTitle} · ${rightTitle}`}
          baseSize={44}
          minSize={26}
          maxLines={2}
          lineHeight={1.32}
          color={LOOK37.line}
          fontWeight={500}
          align="center"
        />
      </div>

      {/* Connecting Resonance Arc between Twin Orbs */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        <path
          d="M 300 560 Q 540 460 780 520"
          fill="none"
          stroke={LOOK37.line}
          strokeWidth={1.2}
          strokeDasharray="4 6"
          opacity={0.34}
        />
        <circle cx={pulseX} cy={pulseY} r={4.5} fill={LOOK37.orbWhite} opacity={0.85} />
      </svg>

      {/* Left Orb (quieter rose-plum) & Right Orb (brighter radiant glow) */}
      <Look37GlowingOrb
        cx={300}
        cy={560}
        radius={104}
        localFrame={localFrame}
        durationFrames={durationFrames}
        fps={fps}
        filterId={`l37-dither-c1-${sceneIndex}`}
        phaseOffset={0}
        dimmed
      />
      <Look37GlowingOrb
        cx={780}
        cy={520}
        radius={130}
        localFrame={localFrame}
        durationFrames={durationFrames}
        fps={fps}
        filterId={`l37-dither-c2-${sceneIndex}`}
        phaseOffset={Math.PI * 0.5}
        showExhaleRing
      />

      {/* Two Minimal Comparison Columns below Orbs (y: 758..1360, strictly ≤ 1420) */}
      <div
        style={{
          position: 'absolute',
          top: 760,
          left: SAFE_X,
          width: SAFE_W,
          display: 'flex',
          gap: 24,
          transform: `translateY(${interpolate(contentSpring, [0, 1], [30, 0]).toFixed(2)}px)`,
        }}
      >
        {/* Left Column */}
        <div
          style={{
            flex: 1,
            padding: '24px 22px',
            borderRadius: 20,
            backgroundColor: 'rgba(19, 5, 11, 0.72)',
            border: '1px solid rgba(246, 239, 242, 0.16)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <FitText
            text={leftTitle}
            baseSize={30}
            minSize={20}
            maxLines={2}
            lineHeight={1.32}
            color="rgba(246, 239, 242, 0.76)"
            fontWeight={600}
            align="center"
          />
          <div style={{ height: 1, backgroundColor: 'rgba(246, 239, 242, 0.14)' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {leftItems.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    backgroundColor: 'rgba(246, 239, 242, 0.42)',
                    marginTop: 12,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={item}
                    baseSize={24}
                    minSize={17}
                    maxLines={3}
                    lineHeight={1.38}
                    color="rgba(246, 239, 242, 0.7)"
                    fontWeight={400}
                    align="left"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column */}
        <div
          style={{
            flex: 1,
            padding: '24px 22px',
            borderRadius: 20,
            backgroundColor: 'rgba(83, 24, 41, 0.28)',
            border: '1px solid rgba(246, 150, 222, 0.38)',
            boxShadow: '0 14px 40px rgba(83, 24, 41, 0.24)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <FitText
            text={rightTitle}
            baseSize={30}
            minSize={20}
            maxLines={2}
            lineHeight={1.32}
            color={LOOK37.line}
            fontWeight={600}
            align="center"
          />
          <div style={{ height: 1, backgroundColor: 'rgba(246, 150, 222, 0.32)' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {rightItems.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    backgroundColor: LOOK37.orbPink,
                    boxShadow: '0 0 10px rgba(246, 150, 222, 0.8)',
                    marginTop: 12,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText
                    text={item}
                    baseSize={24}
                    minSize={17}
                    maxLines={3}
                    lineHeight={1.38}
                    color={LOOK37.line}
                    fontWeight={500}
                    align="left"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// EXPORTED REGISTRY DEFINITIONS — BATCH_L (look-35, look-37)
// ============================================================================

export const BATCH_L: StyleDirectorDef[] = [
  {
    styleId: 'look-35',
    caption: 'bar',
    shots: {
      'window-zoom-click': Look35WindowZoomClick,
      'step-click-path': Look35StepClickPath,
      'toggle-before-after': Look35ToggleBeforeAfter,
      'success-toast': Look35SuccessToast,
    },
    shotLabels: {
      'window-zoom-click': 'หน้าต่างแอปโหมดมืดเต็มบานบนฉากหลังมิ้นต์ กล้องร่อนซูมเข้าปุ่มน้ำเงินพร้อมเคอร์เซอร์คลิกและวงกระเพื่อม',
      'step-click-path': 'รายการองค์ประกอบ UI ที่มีหมายเลขขั้นตอน โดยเคอร์เซอร์ไล่คลิกเปิดทีละขั้นพร้อมแถบความคืบหน้า',
      'toggle-before-after': 'แผงตั้งค่าเปรียบเทียบก่อน-หลังพร้อมสวิตช์ที่เคอร์เซอร์คลิกเลื่อนจากปิดเป็นเปิด',
      'success-toast': 'หน้าต่างแจ้งเตือนสำเร็จ (Success Toast) พร้อมไอคอนเครื่องหมายถูกแอนิเมชันและตัวเลขหรือข้อความสรุป',
    },
    infer: (scene) => {
      if (Array.isArray(scene.steps) && scene.steps.length >= 2) {
        return 'step-click-path';
      }
      if (scene.compare) {
        return 'toggle-before-after';
      }
      const text = haystackOfL(scene);
      if (scene.stat || scene.quote?.text || L35_SUCCESS_RE.test(text)) {
        return 'success-toast';
      }
      if (L35_CLICK_RE.test(text)) {
        return 'window-zoom-click';
      }
      return null;
    },
  },
  {
    styleId: 'look-37',
    caption: 'floating',
    shots: {
      'breathing-orb-line': Look37BreathingOrbLine,
      'orbit-rings-points': Look37OrbitRingsPoints,
      'orb-stat': Look37OrbStat,
      'twin-orb-compare': Look37TwinOrbCompare,
    },
    shotLabels: {
      'breathing-orb-line': 'ลูกแก้วเรืองแสงหายใจช้าๆ บนพื้นมืดพร้อมวงกลมเส้นบางและข้อความบรรทัดเดียวอย่างมินิมอล',
      'orbit-rings-points': 'ลูกแก้วกลางเฟรมรายล้อมด้วยวงโคจรเส้นบางและป้ายประเด็นสำคัญบนจุดโคจร',
      'orb-stat': 'ตัวเลขสถิติหลักลอยอยู่ในแสงลูกแก้วพร้อมวงแหวนความคืบหน้าและป้ายคำอธิบายด้านล่าง',
      'twin-orb-compare': 'ลูกแก้วเรืองแสงคู่สำหรับเปรียบเทียบสองมุมมองหรือแสดงคำคมสำคัญอย่างสงบ',
    },
    infer: (scene) => {
      if (scene.compare || scene.quote?.text) {
        return 'twin-orb-compare';
      }
      if (scene.stat) {
        return 'orb-stat';
      }
      if (Array.isArray(scene.bullets) && scene.bullets.length >= 3) {
        return 'orbit-rings-points';
      }
      return null;
    },
  },
];
