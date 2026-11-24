import React from 'react';
import { interpolate, spring } from 'remotion';
import { IsoBox, IsoShadow, isoProject } from '../../components/IsometricPrimitives';
import { THAI_FONT_FAMILY } from '../../components/ThaiFontLoader';
import type { StudioScene } from '../types';
import {
  appear,
  clamp01,
  easeOutCubic,
  FitText,
  SAFE_BOTTOM,
  sceneTexts,
  STAGE_H,
  STAGE_W,
  stagger,
} from './kit';
import type { StyleDirectorDef, StyleShotArgs } from './types';

// ============================================================================
// Shared deterministic helpers
// ============================================================================

function hashSeed(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function sceneHaystack(scene: StudioScene): string {
  const t = sceneTexts(scene);
  return [t.badge, t.title, t.subtitle, ...t.bullets, ...t.numbers].join(' ').toLowerCase();
}

function parsePrimaryNumber(scene: StudioScene): {
  value: number;
  raw: string;
  prefix: string;
  suffix: string;
  isPercent: boolean;
} {
  if (scene.stat) {
    const rawStr = String(scene.stat.value ?? '').trim();
    const num =
      typeof scene.stat.numericValue === 'number' && !Number.isNaN(scene.stat.numericValue)
        ? scene.stat.numericValue
        : parseFloat(rawStr.replace(/[^0-9.]/g, '')) || 0;
    const prefix = scene.stat.prefix || (rawStr.startsWith('฿') ? '฿' : rawStr.startsWith('$') ? '$' : '');
    const suffix =
      scene.stat.suffix ||
      (rawStr.endsWith('%') ? '%' : rawStr.endsWith('+') ? '+' : scene.stat.unit ? ` ${scene.stat.unit}` : '');
    return {
      value: num > 0 ? num : 46,
      raw: rawStr || String(num),
      prefix,
      suffix,
      isPercent: rawStr.includes('%') || suffix.includes('%'),
    };
  }
  const t = sceneTexts(scene);
  if (t.numbers.length > 0) {
    const first = t.numbers[0];
    const num = parseFloat(first.replace(/,/g, '').replace(/[^0-9.]/g, '')) || 0;
    const isPercent = first.includes('%');
    const prefix = first.includes('฿') ? '฿' : first.includes('$') ? '$' : '';
    const suffix = isPercent
      ? '%'
      : first.includes('ล้าน')
        ? ' ล้าน'
        : first.includes('บาท')
          ? ' บาท'
          : first.includes('เท่า')
            ? ' เท่า'
            : '';
    return {
      value: num > 0 ? num : 100,
      raw: first,
      prefix,
      suffix,
      isPercent,
    };
  }
  return { value: 100000, raw: '฿100,000', prefix: '฿', suffix: '', isPercent: false };
}

function getFallbackItems(scene: StudioScene, fallback: string[]): string[] {
  const t = sceneTexts(scene);
  if (t.bullets.length > 0) return t.bullets.slice(0, 4);
  const out: string[] = [];
  if (t.subtitle) out.push(t.subtitle);
  if (scene.stat?.label) out.push(scene.stat.label);
  if (scene.stat?.delta) out.push(scene.stat.delta);
  if (out.length === 0) return fallback;
  return out.slice(0, 4);
}

function isNegativeMood(scene: StudioScene): boolean {
  const h = sceneHaystack(scene);
  return /หนี้|ขาดทุน|ติดลบ|เกินงบ|แพง|รั่ว|แตก|เสี่ยง|เสีย|ลดลง|พลาด|วิกฤต|over/.test(h);
}

function truncateText(str: string, maxChars: number): string {
  const s = String(str || '').trim();
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars - 1)}…`;
}

// Shared banknote isometric brick renderer for look-11
const BillBrick: React.FC<{
  bx: number;
  by: number;
  bz: number;
  dx?: number;
  dy?: number;
  dz?: number;
  cx: number;
  cy: number;
  opacity?: number;
}> = ({ bx, by, bz, dx = 128, dy = 82, dz = 32, cx, cy, opacity = 1 }) => {
  const [b1x, b1y] = isoProject(bx + dx * 0.36, by, bz + dz, cx, cy);
  const [b2x, b2y] = isoProject(bx + dx * 0.64, by, bz + dz, cx, cy);
  const [b3x, b3y] = isoProject(bx + dx * 0.64, by + dy, bz + dz, cx, cy);
  const [b4x, b4y] = isoProject(bx + dx * 0.36, by + dy, bz + dz, cx, cy);
  const [s3x, s3y] = isoProject(bx + dx * 0.64, by + dy, bz, cx, cy);
  const [s4x, s4y] = isoProject(bx + dx * 0.36, by + dy, bz, cx, cy);

  return (
    <g opacity={opacity}>
      <IsoBox
        x={bx}
        y={by}
        z={bz}
        dx={dx}
        dy={dy}
        dz={dz}
        cx={cx}
        cy={cy}
        topColor="#C5DFC8"
        leftColor="#9BC4A2"
        rightColor="#7BA884"
        stroke="#5B8564"
        strokeWidth={1.2}
      />
      <polygon points={`${b1x},${b1y} ${b2x},${b2y} ${b3x},${b3y} ${b4x},${b4y}`} fill="#FFFFFF" opacity={0.96} />
      <polygon points={`${b4x},${b4y} ${b3x},${b3y} ${s3x},${s3y} ${s4x},${s4y}`} fill="#E2E8F0" opacity={0.96} />
    </g>
  );
};

// ============================================================================
// LOOK-11: MONEY STACK (7 distinct 3D shots)
// ============================================================================

const MoneyCashTowerShot: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
  tokens,
  variant = 0,
}) => {
  const t = sceneTexts(scene);
  const primary = parsePrimaryNumber(scene);
  const v = Math.max(0, Math.floor(variant || 0));
  const mirrored = v % 2 === 1;
  const altPalette = v >= 2;
  const accent = altPalette ? '#0D9488' : '#059669';
  const accentSoft = altPalette ? '#14B8A6' : '#10B981';
  const bgTop = tokens?.isLight ? tokens.palette.bg : altPalette ? '#F0FDF9' : '#F4F6F8';

  const headerIn = appear(localFrame, 0, 14);
  const animShift = (v % 3) * 3;
  const countProgress = easeOutCubic(clamp01((localFrame - 4 - animShift) / Math.max(24, durationFrames * 0.55)));
  const currentNum = Math.round(primary.value * countProgress);
  const formattedVal = `${primary.prefix}${currentNum.toLocaleString('en-US')}${primary.suffix}`;

  // Determine tower height (5..8 layers) proportional to value or progress, adjusted by variant
  const baseLayers =
    typeof scene.stat?.progress === 'number'
      ? Math.max(4, Math.min(8, Math.round((scene.stat.progress / 100) * 8)))
      : Math.max(5, Math.min(8, 4 + Math.round(Math.log10(Math.max(10, primary.value)))));
  const targetLayers = Math.max(4, Math.min(8, baseLayers + (mirrored ? 1 : 0) - (altPalette ? 1 : 0)));

  const visibleLayers = Math.max(1, Math.min(targetLayers, Math.ceil(countProgress * targetLayers)));
  const cx = mirrored ? 610 : 465;
  const cy = mirrored ? 1025 : 1045;
  const floatBob = Math.sin(localFrame * 0.1 + v * 1.4) * 4;
  const slots: Array<[number, number]> = mirrored
    ? [
        [-138, -108],
        [12, -108],
        [-138, -14],
        [12, -14],
        [-138, 80],
        [12, 80],
      ]
    : [
        [-142, -126],
        [8, -126],
        [-142, -32],
        [8, -32],
        [-142, 62],
        [8, 62],
      ];

  const bullets = getFallbackItems(scene, [t.subtitle || 'สะสมมูลค่าเติบโตเป็นชั้น']).slice(0, 2);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}>
        <defs>
          <linearGradient id={`m11-tower-bg-${sceneIndex}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={bgTop} />
            <stop offset="65%" stopColor="#E6EAEE" />
            <stop offset="100%" stopColor="#D4DCE5" />
          </linearGradient>
          <radialGradient id={`m11-tower-spot-${sceneIndex}`} cx={mirrored ? '58%' : '45%'} cy="55%" r="48%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#E2E8F0" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width={STAGE_W} height={STAGE_H} fill={`url(#m11-tower-bg-${sceneIndex})`} />
        <rect width={STAGE_W} height={STAGE_H} fill={`url(#m11-tower-spot-${sceneIndex})`} />

        {/* Subtle isometric studio floor lines */}
        <g opacity={0.28} stroke="#94A3B8" strokeWidth={1.2}>
          {Array.from({ length: 11 }, (_, i) => {
            const o = (i - 5) * 95;
            const [x1, y1] = isoProject(o, -380, -20, cx, cy);
            const [x2, y2] = isoProject(o, 380, -20, cx, cy);
            const [x3, y3] = isoProject(-380, o, -20, cx, cy);
            const [x4, y4] = isoProject(380, o, -20, cx, cy);
            return (
              <g key={i}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} />
                <line x1={x3} y1={y3} x2={x4} y2={y4} />
              </g>
            );
          })}
        </g>

        {/* Grounded studio shadow under pallet */}
        <IsoShadow x={-172} y={-144} dx={344} dy={288} cx={cx} cy={cy + 28} opacity={0.22} />

        {/* Dark-slate 3D Shipping Pallet */}
        <IsoBox
          x={-172}
          y={-144}
          z={-16}
          dx={58}
          dy={288}
          dz={16}
          cx={cx}
          cy={cy}
          topColor="#334155"
          leftColor="#1E293B"
          rightColor="#0F172A"
        />
        <IsoBox
          x={114}
          y={-144}
          z={-16}
          dx={58}
          dy={288}
          dz={16}
          cx={cx}
          cy={cy}
          topColor="#334155"
          leftColor="#1E293B"
          rightColor="#0F172A"
        />
        <IsoBox
          x={-172}
          y={-144}
          z={0}
          dx={344}
          dy={288}
          dz={24}
          cx={cx}
          cy={cy}
          topColor="#475569"
          leftColor="#334155"
          rightColor="#1E293B"
          stroke="#0F172A"
          strokeWidth={1.2}
        />

        {/* Isometric Cash Tower */}
        {Array.from({ length: visibleLayers }, (_, layerIdx) => {
          const layerDelay = 4 + animShift + layerIdx * 5;
          const dropSp = spring({
            frame: Math.max(0, localFrame - layerDelay),
            fps,
            config: { damping: 14, stiffness: 150, mass: 0.9 },
          });
          const zBase = 24 + layerIdx * 36;
          const zOffset = (1 - dropSp) * 140;
          const isTop = layerIdx === visibleLayers - 1;
          const activeSlots = altPalette && layerIdx >= visibleLayers - 2 ? slots.slice(0, 4) : slots;

          return (
            <g key={layerIdx}>
              {activeSlots.map(([sx, sy], sIdx) => {
                const stepLift = mirrored && sIdx % 2 === 1 ? 14 : 0;
                const extraBob = isTop && sIdx === activeSlots.length - 1 ? Math.max(0, 12 + floatBob) : 0;
                return (
                  <BillBrick
                    key={`b-${layerIdx}-${sIdx}`}
                    bx={sx}
                    by={sy}
                    bz={zBase + zOffset + stepLift + extraBob}
                    cx={cx}
                    cy={cy}
                    opacity={clamp01(dropSp * 1.4)}
                  />
                );
              })}
            </g>
          );
        })}

        {/* Vertical height ruler gauge (swaps side when mirrored) */}
        {(() => {
          const gaugeX = mirrored ? 185 : 875;
          const bottomY = 1110;
          const maxH = 380;
          const fillH = maxH * (visibleLayers / 8) * clamp01(countProgress * 1.15);
          return (
            <g opacity={appear(localFrame, 8, 16)}>
              <line x1={gaugeX} y1={bottomY - maxH} x2={gaugeX} y2={bottomY} stroke="#94A3B8" strokeWidth={4} strokeLinecap="round" />
              <line
                x1={gaugeX}
                y1={bottomY - fillH}
                x2={gaugeX}
                y2={bottomY}
                stroke={accentSoft}
                strokeWidth={8}
                strokeLinecap="round"
              />
              {[0, 0.25, 0.5, 0.75, 1].map((frac, idx) => {
                const ty = bottomY - maxH * frac;
                return (
                  <g key={idx}>
                    <line x1={gaugeX - 12} y1={ty} x2={gaugeX + 12} y2={ty} stroke="#64748B" strokeWidth={2.5} />
                    <text
                      x={mirrored ? gaugeX - 24 : gaugeX + 24}
                      y={ty + 7}
                      textAnchor={mirrored ? 'end' : 'start'}
                      fill="#475569"
                      fontSize={20}
                      fontFamily="monospace"
                      fontWeight={700}
                    >
                      {Math.round(frac * 100)}%
                    </text>
                  </g>
                );
              })}
              {/* Floating level pointer */}
              <polygon
                points={
                  mirrored
                    ? `${gaugeX + 28},${bottomY - fillH - 10} ${gaugeX + 10},${bottomY - fillH} ${gaugeX + 28},${bottomY - fillH + 10}`
                    : `${gaugeX - 28},${bottomY - fillH - 10} ${gaugeX - 10},${bottomY - fillH} ${gaugeX - 28},${bottomY - fillH + 10}`
                }
                fill={accent}
              />
            </g>
          );
        })()}
      </svg>

      {/* Top Title Header */}
      <div
        style={{
          position: 'absolute',
          top: 96,
          left: 64,
          right: 64,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
          opacity: headerIn,
          transform: `translateY(${(1 - headerIn) * 24}px)`,
        }}
      >
        {t.badge && (
          <div
            style={{
              padding: '8px 22px',
              borderRadius: 999,
              background: '#0F172A',
              color: '#4ADE80',
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 1.5,
            }}
          >
            {t.badge}
          </div>
        )}
        <FitText text={t.title} baseSize={54} minSize={34} maxLines={3} color="#0F172A" fontWeight={900} />
      </div>

      {/* Bottom Counter & Bullet Strip (strictly above SAFE_BOTTOM = 1540) */}
      <div
        style={{
          position: 'absolute',
          top: 1215,
          left: 64,
          right: 64,
          maxHeight: SAFE_BOTTOM - 1225,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
          opacity: appear(localFrame, 10, 14),
        }}
      >
        <div
          style={{
            background: '#FFFFFF',
            border: '2px solid #CBD5E1',
            borderRadius: 28,
            padding: '18px 42px',
            boxShadow: '0 14px 36px rgba(15, 23, 42, 0.10)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: 18,
              fontWeight: 800,
              letterSpacing: 3,
              color: '#64748B',
            }}
          >
            {scene.stat?.label ? truncateText(scene.stat.label, 34) : 'STACK VALUE'}
          </div>
          <div
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 64,
              fontWeight: 900,
              color: accent,
              lineHeight: 1.15,
            }}
          >
            {formattedVal}
          </div>
        </div>

        {bullets.length > 0 && (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
            {bullets.map((b, i) => (
              <div
                key={i}
                style={{
                  background: 'rgba(15,23,42,0.06)',
                  border: '1.5px solid rgba(15,23,42,0.12)',
                  borderRadius: 16,
                  padding: '8px 20px',
                  fontFamily: THAI_FONT_FAMILY,
                  fontSize: 24,
                  fontWeight: 700,
                  color: '#1E293B',
                  opacity: stagger(i, localFrame, 6, 12, 12),
                }}
              >
                {truncateText(b, 34)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const MoneyCoinRainShot: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  variant = 0,
}) => {
  const t = sceneTexts(scene);
  const primary = parsePrimaryNumber(scene);
  const v = Math.max(0, Math.floor(variant || 0));
  const mirrored = v % 2 === 1;
  const wideJar = v >= 2;
  const targetPct =
    typeof scene.stat?.progress === 'number'
      ? clamp01(scene.stat.progress / 100)
      : primary.isPercent
        ? clamp01(primary.value / 100)
        : 0.72;

  const animShift = (v % 3) * 3;
  const fillProgress = easeOutCubic(clamp01((localFrame - 4 - animShift) / Math.max(26, durationFrames * 0.62)));
  const currentPct = Math.round(targetPct * 100 * fillProgress);

  const jarW = wideJar ? 460 : 420;
  const jarX = mirrored ? 360 - (wideJar ? 20 : 0) : 330 - (wideJar ? 20 : 0);
  const jarCenterX = jarX + jarW / 2;
  const jarTop = 605;
  const jarBottom = 1185;
  const jarInnerH = jarBottom - jarTop - 40;
  const fillH = jarInnerH * targetPct * fillProgress;
  const fillY = jarBottom - 18 - fillH;

  // Deterministic falling coins (kept strictly below top header y >= 370)
  const coinCount = mirrored ? 16 : 12;
  const fallingCoins = Array.from({ length: coinCount }, (_, i) => {
    const speed = (mirrored ? 15 : 13) + (i % 4) * 3.5;
    const laneX = jarX + 55 + hashSeed(i * 17 + 3 + v * 29) * (jarW - 110);
    const startY = 395 - (i % 3) * 18;
    const travelRange = Math.max(160, fillY - startY + 20);
    const y = startY + ((localFrame * speed + i * 53 + v * 37) % travelRange);
    const spin = Math.cos(localFrame * 0.22 + i * 1.1 + v * 0.8);
    const rx = Math.max(8, Math.abs(spin) * 26);
    return { x: laneX, y, rx, key: i };
  });

  // Settled coin rows inside the jar
  const settledRows = Math.floor(fillH / 26);
  const items = getFallbackItems(scene, [t.subtitle || 'เหรียญสะสมต่อเนื่อง']).slice(0, 3);
  const headerIn = appear(localFrame, 0, 14);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}>
        <defs>
          <linearGradient id={`m11-coin-bg-${sceneIndex}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={wideJar ? '#FFFBEB' : '#F8FAFC'} />
            <stop offset="68%" stopColor="#ECEFF4" />
            <stop offset="100%" stopColor="#DDE4EC" />
          </linearGradient>
          <linearGradient id={`m11-gold-${sceneIndex}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FEF08A" />
            <stop offset="45%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#B45309" />
          </linearGradient>
          <linearGradient id={`m11-glass-${sceneIndex}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.62" />
            <stop offset="22%" stopColor="#E0F2FE" stopOpacity="0.18" />
            <stop offset="78%" stopColor="#BAE6FD" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.52" />
          </linearGradient>
          <clipPath id={`m11-jar-clip-${sceneIndex}`}>
            <rect x={jarX + 14} y={jarTop + 18} width={jarW - 28} height={jarBottom - jarTop - 28} rx={44} />
          </clipPath>
        </defs>

        <rect width={STAGE_W} height={STAGE_H} fill={`url(#m11-coin-bg-${sceneIndex})`} />

        {/* Studio pedestal shadow */}
        <ellipse cx={jarCenterX} cy={jarBottom + 22} rx={jarW * 0.58} ry={34} fill="#0F172A" opacity={0.16} />

        {/* Falling 3D Gold Coins above & entering jar */}
        {fallingCoins.map((c) => (
          <g key={c.key} transform={`translate(${c.x.toFixed(1)}, ${c.y.toFixed(1)})`}>
            <ellipse cx={4} cy={5} rx={c.rx} ry={16} fill="#92400E" opacity={0.5} />
            <ellipse
              cx={0}
              cy={0}
              rx={c.rx}
              ry={16}
              fill={`url(#m11-gold-${sceneIndex})`}
              stroke="#D97706"
              strokeWidth={2}
            />
            {c.rx > 16 && (
              <text x={0} y={6} textAnchor="middle" fill="#78350F" fontSize={16} fontWeight={900}>
                ฿
              </text>
            )}
          </g>
        ))}

        {/* Jar back wall */}
        <rect
          x={jarX}
          y={jarTop}
          width={jarW}
          height={jarBottom - jarTop}
          rx={56}
          fill="#FFFFFF"
          fillOpacity={0.32}
          stroke="#94A3B8"
          strokeWidth={4}
        />

        {/* Settled gold coin pile clipped inside jar */}
        <g clipPath={`url(#m11-jar-clip-${sceneIndex})`}>
          <rect
            x={jarX}
            y={fillY}
            width={jarW}
            height={jarBottom - fillY + 20}
            fill="#F59E0B"
            opacity={0.28}
          />
          {Array.from({ length: Math.min(22, settledRows + 1) }, (_, row) => {
            const ry = jarBottom - 26 - row * 26;
            const cols = wideJar ? 8 : 7;
            return (
              <g key={row}>
                {Array.from({ length: cols }, (_, col) => {
                  const jitter = (hashSeed(row * 31 + col * 13 + v * 19) - 0.5) * 14;
                  const cxCoin = jarX + 46 + col * 54 + jitter;
                  return (
                    <g key={col}>
                      <ellipse cx={cxCoin} cy={ry + 6} rx={27} ry={10} fill="#B45309" />
                      <ellipse
                        cx={cxCoin}
                        cy={ry}
                        rx={27}
                        ry={10}
                        fill={`url(#m11-gold-${sceneIndex})`}
                        stroke="#FDE047"
                        strokeWidth={1.2}
                      />
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>

        {/* Glass front reflection & rim */}
        <rect
          x={jarX}
          y={jarTop}
          width={jarW}
          height={jarBottom - jarTop}
          rx={56}
          fill={`url(#m11-glass-${sceneIndex})`}
          stroke="#CBD5E1"
          strokeWidth={3.5}
        />
        {/* Vertical glass specular highlight */}
        <rect
          x={mirrored ? jarX + jarW - 48 : jarX + 26}
          y={jarTop + 48}
          width={22}
          height={jarBottom - jarTop - 105}
          rx={11}
          fill="#FFFFFF"
          opacity={0.55}
        />
        {/* Jar metal neck collar */}
        <rect x={jarX + 44} y={jarTop - 32} width={jarW - 88} height={42} rx={14} fill="#CBD5E1" stroke="#64748B" strokeWidth={2.5} />
        <ellipse cx={jarCenterX} cy={jarTop - 28} rx={(jarW - 96) / 2} ry={14} fill="#94A3B8" stroke="#475569" strokeWidth={2} />

        {/* Graduated % measurement ticks (swaps side when mirrored) */}
        {[25, 50, 75, 100].map((pct) => {
          const ty = jarBottom - 18 - jarInnerH * (pct / 100);
          return mirrored ? (
            <g key={pct}>
              <line x1={jarX - 18} y1={ty} x2={jarX + 24} y2={ty} stroke="#475569" strokeWidth={3} />
              <text x={jarX - 28} y={ty + 7} textAnchor="end" fill="#334155" fontSize={22} fontFamily="monospace" fontWeight={800}>
                {pct}%
              </text>
            </g>
          ) : (
            <g key={pct}>
              <line x1={jarX + jarW - 24} y1={ty} x2={jarX + jarW + 18} y2={ty} stroke="#475569" strokeWidth={3} />
              <text x={jarX + jarW + 28} y={ty + 7} fill="#334155" fontSize={22} fontFamily="monospace" fontWeight={800}>
                {pct}%
              </text>
            </g>
          );
        })}

        {/* Floating current % indicator pill tracking fill level */}
        {mirrored ? (
          <g transform={`translate(${jarX + jarW + 18}, ${Math.max(jarTop + 40, Math.min(jarBottom - 50, fillY))})`}>
            <rect x={13} y={-34} width={182} height={68} rx={22} fill="#0F172A" />
            <polygon points="14,-10 -4,0 14,10" fill="#0F172A" />
            <text x={104} y={11} textAnchor="middle" fill="#FDE047" fontSize={36} fontFamily={THAI_FONT_FAMILY} fontWeight={900}>
              {currentPct}%
            </text>
          </g>
        ) : (
          <g transform={`translate(${jarX - 18}, ${Math.max(jarTop + 40, Math.min(jarBottom - 50, fillY))})`}>
            <rect x={-195} y={-34} width={182} height={68} rx={22} fill="#0F172A" />
            <polygon points="-14,-10 4,0 -14,10" fill="#0F172A" />
            <text x={-104} y={11} textAnchor="middle" fill="#FDE047" fontSize={36} fontFamily={THAI_FONT_FAMILY} fontWeight={900}>
              {currentPct}%
            </text>
          </g>
        )}
      </svg>

      {/* Top Headline */}
      <div
        style={{
          position: 'absolute',
          top: 96,
          left: 64,
          right: 64,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          opacity: headerIn,
          transform: `translateY(${(1 - headerIn) * 22}px)`,
        }}
      >
        {t.badge && (
          <div
            style={{
              padding: '7px 20px',
              borderRadius: 999,
              background: '#FEF3C7',
              border: '2px solid #F59E0B',
              color: '#92400E',
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 22,
              fontWeight: 800,
            }}
          >
            {t.badge}
          </div>
        )}
        <FitText text={t.title} baseSize={54} minSize={34} maxLines={3} color="#0F172A" fontWeight={900} />
      </div>

      {/* Bottom Summary Strip (strictly above subtitle bar y <= 1375) */}
      <div
        style={{
          position: 'absolute',
          top: 1235,
          left: 64,
          right: 64,
          maxHeight: 150,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {items.slice(0, 1).map((item, i) => (
          <div
            key={i}
            style={{
              width: '100%',
              maxWidth: 880,
              background: '#FFFFFF',
              border: '2px solid #E2E8F0',
              borderLeft: '8px solid #F59E0B',
              borderRadius: 20,
              padding: '16px 28px',
              boxShadow: '0 8px 24px rgba(15,23,42,0.07)',
              opacity: stagger(i, localFrame, 8, 12, 14),
              transform: `translateY(${(1 - stagger(i, localFrame, 8, 12, 14)) * 18}px)`,
            }}
          >
            <FitText text={item} baseSize={30} minSize={22} maxLines={2} color="#1E293B" fontWeight={700} align="left" />
          </div>
        ))}
      </div>
    </div>
  );
};

const MoneyPiggyBankShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, variant = 0 }) => {
  const t = sceneTexts(scene);
  const primary = parsePrimaryNumber(scene);
  const stressed = isNegativeMood(scene);
  const v = Math.max(0, Math.floor(variant || 0));
  const mirrored = v % 2 === 1;
  const goldEdition = v >= 2 && !stressed;

  const pop = spring({
    frame: Math.max(0, localFrame - (v % 3) * 3),
    fps,
    config: { damping: 12, stiffness: 140, mass: 0.9 },
  });

  // Breathing / swelling animation
  const swell = stressed
    ? 1 + 0.06 * Math.sin(localFrame * 0.25 + v) + clamp01(localFrame / 60) * 0.08
    : 1 + 0.035 * Math.sin(localFrame * 0.14 + v * 1.1);
  const shakeX = stressed ? Math.sin(localFrame * 0.9) * 4 : 0;
  const tiltDeg = mirrored ? 3.5 : v >= 2 ? -3 : 0;

  // Coin dropping into piggy slot
  const coinCycle = ((localFrame + v * 11) * 0.045) % 1;
  const coinY = interpolate(coinCycle, [0, 0.75, 1], [410, 685, 700]);
  const coinOpacity = coinCycle < 0.72 ? 1 : 1 - (coinCycle - 0.72) / 0.28;

  const crackReveal = stressed ? clamp01((localFrame - 14) / 22) : 0;
  const headerIn = appear(localFrame, 0, 14);
  const items = getFallbackItems(scene, [t.subtitle || 'ออมสม่ำเสมอสร้างฐานการเงิน']).slice(0, 3);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}>
        <defs>
          <linearGradient id={`m11-pig-bg-${sceneIndex}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stressed ? '#FFF1F2' : goldEdition ? '#FFFBEB' : '#F4F7FA'} />
            <stop offset="100%" stopColor={stressed ? '#FFE4E6' : goldEdition ? '#FEF3C7' : '#DCE4EE'} />
          </linearGradient>
          <radialGradient id={`m11-pig-body-${sceneIndex}`} cx="38%" cy="32%" r="68%">
            <stop offset="0%" stopColor={stressed ? '#FECDD3' : goldEdition ? '#FEF08A' : '#FDA4AF'} />
            <stop offset="52%" stopColor={stressed ? '#F43F5E' : goldEdition ? '#F59E0B' : '#FB7185'} />
            <stop offset="100%" stopColor={stressed ? '#9F1239' : goldEdition ? '#B45309' : '#BE123C'} />
          </radialGradient>
          <linearGradient id={`m11-pig-coin-${sceneIndex}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FEF08A" />
            <stop offset="100%" stopColor="#D97706" />
          </linearGradient>
        </defs>

        <rect width={STAGE_W} height={STAGE_H} fill={`url(#m11-pig-bg-${sceneIndex})`} />

        {/* Soft studio floor shadow */}
        <ellipse cx={540} cy={1025} rx={265 * swell} ry={38} fill="#0F172A" opacity={0.16} />

        {/* Dropping coin into slot (positive savings mood) */}
        {!stressed && (
          <g transform={`translate(540, ${(coinY - 45).toFixed(1)})`} opacity={coinOpacity}>
            <circle cx={0} cy={0} r={34} fill={`url(#m11-pig-coin-${sceneIndex})`} stroke="#B45309" strokeWidth={3} />
            <text x={0} y={11} textAnchor="middle" fill="#78350F" fontSize={30} fontWeight={900}>
              ฿
            </text>
          </g>
        )}

        {/* 3D Ceramic Piggy Bank (mirrors facing direction on odd variants, keeps text upright) */}
        <g
          transform={`translate(${(540 + shakeX).toFixed(1)}, 805) rotate(${tiltDeg}) scale(${(
            (mirrored ? -1 : 1) *
            pop *
            swell
          ).toFixed(4)}, ${(pop * swell).toFixed(4)})`}
        >
          {/* Back legs */}
          <rect x={-155} y={118} width={62} height={92} rx={24} fill={goldEdition ? '#92400E' : '#9F1239'} />
          <rect x={78} y={118} width={62} height={92} rx={24} fill={goldEdition ? '#92400E' : '#9F1239'} />

          {/* Curly tail */}
          <path
            d="M 228 -18 C 282 -44, 294 26, 256 36 C 232 42, 236 6, 266 10"
            fill="none"
            stroke={goldEdition ? '#D97706' : '#E11D48'}
            strokeWidth={14}
            strokeLinecap="round"
          />

          {/* Main 3D spherical body */}
          <ellipse cx={0} cy={0} rx={242} ry={182} fill={`url(#m11-pig-body-${sceneIndex})`} />

          {/* Glossy ceramic top highlight */}
          <ellipse cx={-62} cy={-86} rx={96} ry={34} fill="#FFFFFF" opacity={0.34} transform="rotate(-14 -62 -86)" />

          {/* Coin slot on back */}
          <rect
            x={-52}
            y={-158}
            width={104}
            height={18}
            rx={9}
            fill={goldEdition ? '#451A03' : '#4C0519'}
            stroke={goldEdition ? '#FDE68A' : '#FDA4AF'}
            strokeWidth={2.5}
          />

          {/* Cute 3D Ear */}
          <path
            d="M -145 -112 C -175 -195, -88 -205, -72 -136 Z"
            fill={goldEdition ? '#F59E0B' : '#FB7185'}
            stroke={goldEdition ? '#B45309' : '#BE123C'}
            strokeWidth={4}
          />
          <path d="M -132 -122 C -148 -166, -104 -172, -94 -134 Z" fill={goldEdition ? '#FEF3C7' : '#FECDD3'} />

          {/* Snout */}
          <g transform="translate(-236, 10)">
            <ellipse
              cx={0}
              cy={0}
              rx={48}
              ry={66}
              fill={goldEdition ? '#D97706' : '#F43F5E'}
              stroke={goldEdition ? '#92400E' : '#9F1239'}
              strokeWidth={4}
            />
            <ellipse cx={-6} cy={0} rx={36} ry={52} fill={goldEdition ? '#FDE68A' : '#FDA4AF'} />
            <ellipse cx={-16} cy={-14} rx={8} ry={15} fill={goldEdition ? '#78350F' : '#881337'} />
            <ellipse cx={8} cy={-14} rx={8} ry={15} fill={goldEdition ? '#78350F' : '#881337'} />
          </g>

          {/* Eye */}
          <circle cx={-152} cy={-38} r={16} fill="#1E293B" />
          <circle cx={-157} cy={-44} r={5.5} fill="#FFFFFF" />

          {/* Front legs */}
          <rect
            x={-122}
            y={128}
            width={66}
            height={94}
            rx={26}
            fill={goldEdition ? '#D97706' : '#E11D48'}
            stroke={goldEdition ? '#92400E' : '#9F1239'}
            strokeWidth={3}
          />
          <rect
            x={108}
            y={128}
            width={66}
            height={94}
            rx={26}
            fill={goldEdition ? '#D97706' : '#E11D48'}
            stroke={goldEdition ? '#92400E' : '#9F1239'}
            strokeWidth={3}
          />

          {/* Value Emblem on Piggy Side (un-flipped so text always reads left-to-right) */}
          <g transform={mirrored ? 'scale(-1, 1)' : undefined}>
            <text
              x={mirrored ? -26 : 26}
              y={22}
              textAnchor="middle"
              fill="#FFFFFF"
              fontSize={52}
              fontFamily={THAI_FONT_FAMILY}
              fontWeight={900}
              opacity={0.94}
            >
              {primary.raw}
            </text>
          </g>

          {/* Animated stress crack lines when mood is negative */}
          {stressed && crackReveal > 0.05 && (
            <g stroke="#4C0519" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" fill="none">
              <path
                d="M -18 -142 L 6 -92 L -22 -48 L 16 4 L -10 56"
                strokeDasharray={260}
                strokeDashoffset={260 * (1 - crackReveal)}
              />
              <path
                d="M -22 -48 L -66 -22 L -84 12"
                strokeDasharray={120}
                strokeDashoffset={120 * (1 - crackReveal)}
              />
            </g>
          )}
        </g>

        {/* Sparkles (positive) or Warning pulses (negative) */}
        {Array.from({ length: 6 }, (_, i) => {
          const ang = (i / 6) * Math.PI * 2 + localFrame * 0.03 + v * 0.6;
          const r = 325 + Math.sin(localFrame * 0.12 + i + v) * 14;
          const sx = 540 + Math.cos(ang) * r;
          const sy = 840 + Math.sin(ang) * (r * 0.68);
          return (
            <circle
              key={i}
              cx={sx}
              cy={sy}
              r={stressed ? 7 : 9}
              fill={stressed ? '#EF4444' : '#F59E0B'}
              opacity={0.35 + 0.45 * Math.abs(Math.sin(localFrame * 0.1 + i))}
            />
          );
        })}
      </svg>

      {/* Top Headline */}
      <div
        style={{
          position: 'absolute',
          top: 96,
          left: 64,
          right: 64,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          opacity: headerIn,
          transform: `translateY(${(1 - headerIn) * 22}px)`,
        }}
      >
        <div
          style={{
            padding: '7px 22px',
            borderRadius: 999,
            background: stressed ? '#DC2626' : '#059669',
            color: '#FFFFFF',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 22,
            fontWeight: 800,
          }}
        >
          {t.badge || (stressed ? 'ALERT · เงินออมรับแรงกดดัน' : 'SAVINGS · สะสมอย่างมั่นคง')}
        </div>
        <FitText text={t.title} baseSize={54} minSize={34} maxLines={3} color="#0F172A" fontWeight={900} />
      </div>

      {/* Bottom Cards (strictly above SAFE_BOTTOM = 1540 and below piggy bank) */}
      <div
        style={{
          position: 'absolute',
          top: 1095,
          left: 64,
          right: 64,
          maxHeight: SAFE_BOTTOM - 1095,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {items.slice(0, 3).map((item, i) => (
          <div
            key={i}
            style={{
              width: '100%',
              maxWidth: 880,
              background: '#FFFFFF',
              borderRadius: 20,
              padding: '11px 24px',
              border: `2px solid ${stressed ? '#FECDD3' : '#CBD5E1'}`,
              boxShadow: '0 10px 26px rgba(15,23,42,0.08)',
              opacity: stagger(i, localFrame, 8, 10, 14),
            }}
          >
            <FitText text={item} baseSize={26} minSize={18} maxLines={2} color="#1E293B" fontWeight={700} align="center" />
          </div>
        ))}
      </div>
    </div>
  );
};

function segmentThaiWordsForPit(text: string): string[] {
  const clean = String(text || '').trim();
  if (!clean) return [];
  try {
    const IntlAny = Intl as unknown as {
      Segmenter?: new (
        locale: string,
        options: { granularity: 'word' | 'grapheme' | 'sentence' },
      ) => { segment(input: string): Iterable<{ segment: string }> };
    };
    if (typeof Intl !== 'undefined' && typeof IntlAny.Segmenter === 'function') {
      const seg = new IntlAny.Segmenter('th', { granularity: 'word' });
      const out: string[] = [];
      for (const part of seg.segment(clean)) {
        if (part.segment) out.push(part.segment);
      }
      if (out.length > 0) return out;
    }
  } catch {
    // fallback below
  }
  return clean.split(/(\s+)/).filter((s) => s.length > 0);
}

function wrapThaiLinesForPit(text: string, maxCharsPerLine: number): string[] {
  const words = segmentThaiWordsForPit(text);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if (!current) {
      current = w.trimStart();
    } else if (current.length + w.length <= maxCharsPerLine) {
      current += w;
    } else {
      lines.push(current.trimEnd());
      current = w.trimStart();
    }
  }
  if (current.trim()) lines.push(current.trimEnd());
  return lines;
}

const MoneyDebtPitShot: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
  variant = 0,
}) => {
  const t = sceneTexts(scene);
  const v = Math.max(0, Math.floor(variant || 0));
  const mirrored = v % 2 === 1;
  const amberGlow = v >= 2;
  const rawSteps = getFallbackItems(scene, ['หยุดสร้างหนี้เพิ่ม', 'จัดลำดับดอกเบี้ยสูง', 'สร้างกองเงินสำรอง'])
    .map((s) => String(s || '').trim())
    .filter((s) => s.length > 0)
    .slice(0, 3);
  const steps = rawSteps.length > 0 ? rawSteps : [t.subtitle || t.title || 'ตั้งหลักใหม่'];
  const animShift = (v % 3) * 3;
  const climbProgress = easeOutCubic(clamp01((localFrame - 6 - animShift) / Math.max(28, durationFrames * 0.65)));
  const cx = mirrored ? 655 : 425;
  const cy = 1090;
  const headerIn = appear(localFrame, 0, 14);

  const stepCount = steps.length;
  const stairCount = Math.max(3, stepCount);
  const stepZ = amberGlow ? 124 : 114;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}>
        <defs>
          <linearGradient id={`m11-pit-sky-${sceneIndex}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F1F5F9" />
            <stop offset="100%" stopColor="#CBD5E1" />
          </linearGradient>
          <linearGradient id={`m11-pit-deep-${sceneIndex}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1E293B" />
            <stop offset="55%" stopColor="#0F172A" />
            <stop offset="100%" stopColor="#020617" />
          </linearGradient>
          <radialGradient id={`m11-pit-red-${sceneIndex}`} cx="50%" cy="88%" r="48%">
            <stop offset="0%" stopColor={amberGlow ? '#F97316' : '#EF4444'} stopOpacity="0.42" />
            <stop offset="100%" stopColor={amberGlow ? '#F97316' : '#EF4444'} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Upper light ground & deep dark pit cutaway */}
        <rect x={0} y={0} width={STAGE_W} height={470} fill={`url(#m11-pit-sky-${sceneIndex})`} />
        <rect x={0} y={470} width={STAGE_W} height={STAGE_H - 470} fill={`url(#m11-pit-deep-${sceneIndex})`} />
        <rect x={0} y={470} width={STAGE_W} height={1060} fill={`url(#m11-pit-red-${sceneIndex})`} />

        {/* Cutaway ground rim bevel */}
        <polygon points="0,470 1080,470 1000,535 80,535" fill="#475569" />
        <line x1={0} y1={470} x2={1080} y2={470} stroke="#FFFFFF" strokeWidth={4} opacity={0.8} />

        {/* Pit inner depth walls */}
        <polygon points="80,535 200,1370 80,1480 0,1480 0,470" fill="#1E293B" opacity={0.7} />
        <polygon points="1000,535 880,1370 1000,1480 1080,1480 1080,470" fill="#0F172A" opacity={0.85} />

        {/* Depth ruler markers (swaps wall when mirrored) */}
        {['0m', '-20m', '-40m', '-60m'].map((lbl, idx) => {
          const ly = 580 + idx * 230;
          return mirrored ? (
            <g key={lbl} opacity={0.55}>
              <line x1={958} y1={ly} x2={1004} y2={ly} stroke="#94A3B8" strokeWidth={2.5} />
              <text x={948} y={ly + 7} textAnchor="end" fill="#94A3B8" fontSize={20} fontFamily="monospace" fontWeight={700}>
                {lbl}
              </text>
            </g>
          ) : (
            <g key={lbl} opacity={0.55}>
              <line x1={76} y1={ly} x2={122} y2={ly} stroke="#94A3B8" strokeWidth={2.5} />
              <text x={132} y={ly + 7} fill="#94A3B8" fontSize={20} fontFamily="monospace" fontWeight={700}>
                {lbl}
              </text>
            </g>
          );
        })}

        {/* Pass 1: Isometric Cash-Brick Staircase climbing OUT of the pit */}
        {Array.from({ length: stairCount }, (_, i) => {
          const stepSp = spring({
            frame: Math.max(0, localFrame - animShift - i * 8),
            fps,
            config: { damping: 14, stiffness: 140 },
          });
          const bx = mirrored ? 85 - i * 92 : -195 + i * 96;
          const by = 110 - i * 86;
          const baseZ = i * stepZ;
          const liftZ = (1 - stepSp) * -120;

          return (
            <g key={`stair-${i}`} opacity={clamp01(stepSp * 1.3)}>
              {/* Support column down to pit floor */}
              <IsoBox
                x={bx + 8}
                y={by + 8}
                z={-120}
                dx={118}
                dy={72}
                dz={Math.max(12, baseZ + 120 + liftZ)}
                cx={cx}
                cy={cy}
                topColor="#334155"
                leftColor="#1E293B"
                rightColor="#0F172A"
              />
              {/* 3 green cash bricks forming the stair tread */}
              <BillBrick bx={bx} by={by} bz={baseZ + liftZ} cx={cx} cy={cy} />
              <BillBrick bx={bx} by={by} bz={baseZ + 34 + liftZ} cx={cx} cy={cy} />
              <BillBrick bx={bx} by={by} bz={baseZ + 68 + liftZ} cx={cx} cy={cy} />
            </g>
          );
        })}

        {/* Pass 2: Foreground Step Badge Pills (exact count of steps, word-wrapped in Thai) */}
        {steps.map((stepText, i) => {
          const stairIdx = stepCount === 1 ? 1 : i;
          const stepSp = spring({
            frame: Math.max(0, localFrame - animShift - stairIdx * 8),
            fps,
            config: { damping: 14, stiffness: 140 },
          });
          const bx = mirrored ? 85 - stairIdx * 92 : -195 + stairIdx * 96;
          const by = 110 - stairIdx * 86;
          const baseZ = stairIdx * stepZ;
          const liftZ = (1 - stepSp) * -120;
          const [topSx, topSy] = isoProject(mirrored ? bx + 8 : bx + 124, by + 44, baseZ + 82 + liftZ, cx, cy);
          const pillW = stepCount === 1 ? 460 : 390;
          const pillX = mirrored ? 48 : stepCount === 1 ? 568 : 638;
          const pillY = stepCount === 1 ? 920 : Math.max(575, Math.min(1170, 1085 - i * 195));

          const labelText = `${i + 1}. ${stepText}`;
          let fontSize = 22;
          let lines = wrapThaiLinesForPit(labelText, Math.floor((pillW - 36) / 11.5));
          if (lines.length > 2) {
            fontSize = 19;
            lines = wrapThaiLinesForPit(labelText, Math.floor((pillW - 36) / 10));
          }
          if (lines.length > 3) {
            fontSize = 17;
            lines = wrapThaiLinesForPit(labelText, Math.floor((pillW - 36) / 9));
          }
          const lineHeight = Math.round(fontSize * 1.35);
          const pillH = Math.max(60, lines.length * lineHeight + 24);
          const firstBaselineY = pillY - ((lines.length - 1) * lineHeight) / 2 + fontSize * 0.35;

          return (
            <g key={`pill-${i}`} opacity={clamp01(stepSp * 1.3)}>
              <line
                x1={topSx}
                y1={topSy}
                x2={mirrored ? pillX + pillW - 8 : pillX - 10}
                y2={pillY}
                stroke="#4ADE80"
                strokeWidth={2.5}
                strokeDasharray="6 6"
              />
              <circle cx={topSx} cy={topSy} r={6} fill="#4ADE80" />
              <rect
                x={pillX - 8}
                y={pillY - pillH / 2}
                width={pillW}
                height={pillH}
                rx={18}
                fill="#0F172A"
                stroke="#4ADE80"
                strokeWidth={2.2}
              />
              <text
                x={pillX + 14}
                y={firstBaselineY}
                fill="#F8FAFC"
                fontSize={fontSize}
                fontFamily={THAI_FONT_FAMILY}
                fontWeight={700}
              >
                {lines.map((line, li) => (
                  <tspan key={li} x={pillX + 14} dy={li === 0 ? 0 : lineHeight}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}

        {/* Animated upward glowing escape arrow following the staircase */}
        {(() => {
          const progIdx = climbProgress * (stairCount - 1);
          const ax = (mirrored ? 85 - progIdx * 92 : -195 + progIdx * 96) + 64;
          const ay = 110 - progIdx * 86 + 42;
          const az = progIdx * (stepZ + 4) + 145;
          const [sx, sy] = isoProject(ax, ay, az, cx, cy);
          const pulse = 1 + 0.14 * Math.sin(localFrame * 0.2);
          return (
            <g transform={`translate(${sx.toFixed(1)}, ${sy.toFixed(1)}) scale(${pulse.toFixed(3)})`}>
              <circle cx={0} cy={0} r={28} fill="#4ADE80" opacity={0.28} />
              <circle cx={0} cy={0} r={18} fill="#22C55E" stroke="#FFFFFF" strokeWidth={3} />
              <path d="M 0 -9 L 8 3 L 3 3 L 3 10 L -3 10 L -3 3 L -8 3 Z" fill="#FFFFFF" />
            </g>
          );
        })()}
      </svg>

      {/* Top Title in Light Zone */}
      <div
        style={{
          position: 'absolute',
          top: 96,
          left: 64,
          right: 64,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          opacity: headerIn,
        }}
      >
        <div
          style={{
            padding: '6px 22px',
            borderRadius: 999,
            background: '#EF4444',
            color: '#FFFFFF',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 22,
            fontWeight: 800,
          }}
        >
          {t.badge || 'CLIMB OUT · ก้าวออกจากหลุม'}
        </div>
        <FitText text={t.title} baseSize={54} minSize={34} maxLines={3} color="#0F172A" fontWeight={900} />
      </div>

      {/* Bottom Pit Caption Strip (strictly above subtitle bar y <= 1375) */}
      <div
        style={{
          position: 'absolute',
          top: 1275,
          left: 72,
          right: 72,
          maxHeight: 105,
          display: 'flex',
          justifyContent: 'center',
          opacity: appear(localFrame, 12, 16),
        }}
      >
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.90)',
            border: '2px solid rgba(239, 68, 68, 0.55)',
            borderRadius: 20,
            padding: '14px 32px',
            maxWidth: 880,
          }}
        >
          <FitText
            text={t.subtitle || 'ไต่บันไดทีละขั้นจากฐานลึกสู่ความมั่นคงทางการเงิน'}
            baseSize={26}
            minSize={20}
            maxLines={2}
            color="#F8FAFC"
            fontWeight={700}
          />
        </div>
      </div>
    </div>
  );
};

// Shared gold bullion isometric bar renderer for look-11 gold-vault & money-scale
const GoldBar: React.FC<{
  bx: number;
  by: number;
  bz: number;
  dx?: number;
  dy?: number;
  dz?: number;
  cx: number;
  cy: number;
  opacity?: number;
}> = ({ bx, by, bz, dx = 92, dy = 44, dz = 26, cx, cy, opacity = 1 }) => (
  <g opacity={opacity}>
    <IsoBox
      x={bx}
      y={by}
      z={bz}
      dx={dx}
      dy={dy}
      dz={dz}
      cx={cx}
      cy={cy}
      topColor="#FEF08A"
      leftColor="#F59E0B"
      rightColor="#B45309"
      stroke="#92400E"
      strokeWidth={1.3}
    />
  </g>
);

const MoneyGoldVaultShot: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
  variant = 0,
}) => {
  const t = sceneTexts(scene);
  const v = Math.max(0, Math.floor(variant || 0));
  const openRight = v % 2 === 1;
  const headerIn = appear(localFrame, 0, 14);

  // Phase 1: wheel spins to unlock; Phase 2: circular vault door swings open revealing gold bullion shelves
  const unlockProg = easeOutCubic(clamp01((localFrame - 4) / 22));
  const openProg = spring({
    frame: Math.max(0, localFrame - 16),
    fps,
    config: { damping: 16, stiffness: 95, mass: 1.1 },
  });
  const wheelAngle = unlockProg * 210 + (openRight ? -20 : 20);
  const doorScaleX = interpolate(openProg, [0, 1], [1, 0.24]);
  const doorShiftX = interpolate(openProg, [0, 1], [0, openRight ? 228 : -228]);
  const goldGlow = 0.22 + openProg * 0.52 + Math.sin(localFrame * 0.14) * 0.06;

  const vaultCx = 540;
  const vaultCy = 808;
  const items = getFallbackItems(scene, [
    t.subtitle || 'ตั้งกฎเหล็กปกป้องเงินทุนก่อนสร้างกำไร',
    'แยกสิทธิ์และควบคุมความเสี่ยงอย่างเป็นระบบ',
  ]).slice(0, 3);

  const goldCx = 540;
  const goldCy = 888;
  const goldBars: Array<[number, number, number]> = [
    // Bottom shelf
    [-95, -24, 0],
    [10, -24, 0],
    [-95, 32, 0],
    [10, 32, 0],
    // Middle tier stacked
    [-85, -16, 28],
    [16, -16, 28],
    [-42, 34, 28],
    // Top crown bar
    [-42, 4, 56],
  ];

  const isUnlocked = localFrame >= 20;
  const totalSecProg = clamp01(localFrame / Math.max(30, durationFrames * 0.5));

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}>
        <defs>
          <linearGradient id={`m11-vault-bg-${sceneIndex}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F1F5F9" />
            <stop offset="60%" stopColor="#E2E8F0" />
            <stop offset="100%" stopColor="#CBD5E1" />
          </linearGradient>
          <radialGradient id={`m11-vault-goldglow-${sceneIndex}`} cx="50%" cy="50%" r="52%">
            <stop offset="0%" stopColor="#FDE047" stopOpacity="0.88" />
            <stop offset="55%" stopColor="#F59E0B" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`m11-vault-steel-${sceneIndex}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#475569" />
            <stop offset="48%" stopColor="#334155" />
            <stop offset="100%" stopColor="#0F172A" />
          </linearGradient>
          <linearGradient id={`m11-vault-door-${sceneIndex}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#94A3B8" />
            <stop offset="50%" stopColor="#475569" />
            <stop offset="100%" stopColor="#1E293B" />
          </linearGradient>
          <clipPath id={`m11-vault-inner-clip-${sceneIndex}`}>
            <circle cx={vaultCx} cy={vaultCy} r={214} />
          </clipPath>
        </defs>

        <rect width={STAGE_W} height={STAGE_H} fill={`url(#m11-vault-bg-${sceneIndex})`} />

        {/* Studio ground shadow */}
        <ellipse cx={540} cy={1108} rx={310} ry={40} fill="#0F172A" opacity={0.18} />

        {/* Armored 3D Vault Outer Frame */}
        <rect
          x={222}
          y={468}
          width={636}
          height={636}
          rx={52}
          fill={`url(#m11-vault-steel-${sceneIndex})`}
          stroke="#0F172A"
          strokeWidth={6}
        />
        {/* Inner metallic bevel */}
        <rect
          x={252}
          y={494}
          width={576}
          height={584}
          rx={38}
          fill="#1E293B"
          stroke="#64748B"
          strokeWidth={3}
        />

        {/* Corner steel bolts */}
        {[
          [282, 524],
          [798, 524],
          [282, 1046],
          [798, 1046],
        ].map(([bx, by], i) => (
          <g key={i}>
            <circle cx={bx} cy={by} r={12} fill="#64748B" stroke="#0F172A" strokeWidth={2.5} />
            <line x1={bx - 6} y1={by} x2={bx + 6} y2={by} stroke="#0F172A" strokeWidth={2.5} />
          </g>
        ))}

        {/* Status LED Bar at top of vault (clear above circular rim) */}
        <rect x={428} y={512} width={224} height={36} rx={18} fill="#0F172A" stroke="#475569" strokeWidth={2} />
        <circle cx={456} cy={530} r={8} fill={isUnlocked ? '#22C55E' : '#F59E0B'} />
        <text
          x={552}
          y={537}
          textAnchor="middle"
          fill={isUnlocked ? '#4ADE80' : '#FDE047'}
          fontSize={18}
          fontFamily="monospace"
          fontWeight={800}
          letterSpacing={2}
        >
          {isUnlocked ? 'SECURED' : 'VERIFYING'}
        </text>

        {/* Circular Vault Opening Rim */}
        <circle cx={vaultCx} cy={vaultCy} r={232} fill="#0F172A" stroke="#64748B" strokeWidth={8} />
        <circle cx={vaultCx} cy={vaultCy} r={216} fill="#020617" />

        {/* Inside Vault Chamber: Golden light + Shelved Isometric Gold Bars */}
        <g clipPath={`url(#m11-vault-inner-clip-${sceneIndex})`}>
          <circle cx={vaultCx} cy={vaultCy} r={230} fill={`url(#m11-vault-goldglow-${sceneIndex})`} opacity={goldGlow} />

          {/* Interior steel shelves */}
          <rect x={315} y={915} width={450} height={18} rx={4} fill="#334155" stroke="#64748B" strokeWidth={2} />
          <rect x={335} y={741} width={410} height={14} rx={4} fill="#334155" stroke="#475569" strokeWidth={1.5} opacity={0.7} />

          {/* Upper shelf mini gold bars */}
          {[-72, 8].map((gx, i) => (
            <GoldBar
              key={`top-gold-${i}`}
              bx={gx}
              by={-20}
              bz={0}
              dx={76}
              dy={36}
              dz={22}
              cx={goldCx}
              cy={737}
              opacity={clamp01(openProg * 1.4)}
            />
          ))}

          {/* Main lower shelf isometric gold bullion stack */}
          {goldBars.map(([gx, gy, gz], idx) => (
            <GoldBar
              key={`gold-${idx}`}
              bx={gx}
              by={gy}
              bz={gz}
              cx={goldCx}
              cy={goldCy}
              opacity={clamp01(openProg * 1.5 - idx * 0.04)}
            />
          ))}

          {/* Deterministic gold sparkles */}
          {Array.from({ length: 6 }, (_, i) => {
            const sx = 390 + hashSeed(i * 23 + v * 11) * 300;
            const sy = 650 + hashSeed(i * 41 + 7) * 240;
            const spAlpha = openProg * (0.35 + 0.55 * Math.abs(Math.sin(localFrame * 0.16 + i * 1.3)));
            return (
              <g key={i} transform={`translate(${sx.toFixed(1)}, ${sy.toFixed(1)})`} opacity={spAlpha}>
                <path d="M 0 -12 L 3 -3 L 12 0 L 3 3 L 0 12 L -3 3 L -12 0 L -3 -3 Z" fill="#FEF9C3" />
              </g>
            );
          })}
        </g>

        {/* Heavy Hinge Assembly */}
        <rect
          x={openRight ? 764 : 292}
          y={712}
          width={24}
          height={146}
          rx={8}
          fill="#64748B"
          stroke="#0F172A"
          strokeWidth={3}
        />

        {/* Circular Vault Door swinging open with 3D perspective compression */}
        <g
          transform={`translate(${(vaultCx + doorShiftX).toFixed(1)}, ${vaultCy}) scale(${doorScaleX.toFixed(4)}, 1)`}
        >
          {/* Steel door thickness rim */}
          <circle cx={openRight ? -18 : 18} cy={0} r={220} fill="#1E293B" stroke="#0F172A" strokeWidth={4} />
          {/* Door front plate */}
          <circle cx={0} cy={0} r={216} fill={`url(#m11-vault-door-${sceneIndex})`} stroke="#CBD5E1" strokeWidth={5} />
          <circle cx={0} cy={0} r={178} fill="none" stroke="#94A3B8" strokeWidth={3} strokeDasharray="16 12" />

          {/* Locking bolts around rim */}
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2;
            const boltRetract = unlockProg * 16;
            const r1 = 186 - boltRetract;
            const r2 = 218 - boltRetract;
            return (
              <line
                key={i}
                x1={Math.cos(a) * r1}
                y1={Math.sin(a) * r1}
                x2={Math.cos(a) * r2}
                y2={Math.sin(a) * r2}
                stroke="#E2E8F0"
                strokeWidth={14}
                strokeLinecap="round"
              />
            );
          })}

          {/* Rotating spoke wheel */}
          <g transform={`rotate(${wheelAngle.toFixed(1)})`}>
            <circle cx={0} cy={0} r={96} fill="none" stroke="#E2E8F0" strokeWidth={18} />
            <circle cx={0} cy={0} r={96} fill="none" stroke="#475569" strokeWidth={4} />
            {[0, 60, 120, 180, 240, 300].map((deg) => (
              <line
                key={deg}
                x1={0}
                y1={0}
                x2={Math.cos((deg * Math.PI) / 180) * 92}
                y2={Math.sin((deg * Math.PI) / 180) * 92}
                stroke="#CBD5E1"
                strokeWidth={12}
                strokeLinecap="round"
              />
            ))}
            <circle cx={0} cy={0} r={34} fill="#F59E0B" stroke="#FEF08A" strokeWidth={5} />
            <circle cx={0} cy={0} r={14} fill="#78350F" />
          </g>
        </g>

        {/* Subtle progress ring indicator bottom-right of vault */}
        <g opacity={appear(localFrame, 10, 14)}>
          <rect x={252} y={1064} width={576} height={8} rx={4} fill="#0F172A" />
          <rect x={252} y={1064} width={576 * totalSecProg} height={8} rx={4} fill="#10B981" />
        </g>
      </svg>

      {/* Top Headline */}
      <div
        style={{
          position: 'absolute',
          top: 96,
          left: 64,
          right: 64,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          opacity: headerIn,
          transform: `translateY(${(1 - headerIn) * 22}px)`,
        }}
      >
        <div
          style={{
            padding: '7px 22px',
            borderRadius: 999,
            background: '#0F172A',
            border: '2px solid #F59E0B',
            color: '#FDE047',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 22,
            fontWeight: 800,
          }}
        >
          {t.badge || 'VAULT · กฎเหล็กปกป้องพอร์ต'}
        </div>
        <FitText text={t.title} baseSize={54} minSize={34} maxLines={3} color="#0F172A" fontWeight={900} />
      </div>

      {/* Bottom Security Rules Strip (strictly above subtitle bar y <= 1375) */}
      <div
        style={{
          position: 'absolute',
          top: 1142,
          left: 64,
          right: 64,
          maxHeight: 235,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {items.slice(0, 2).map((item, i) => (
          <div
            key={i}
            style={{
              width: '100%',
              maxWidth: 880,
              background: '#FFFFFF',
              border: '2px solid #CBD5E1',
              borderLeft: '8px solid #F59E0B',
              borderRadius: 18,
              padding: '13px 26px',
              boxShadow: '0 10px 24px rgba(15,23,42,0.08)',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              opacity: stagger(i, localFrame, 8, 12, 14),
              transform: `translateY(${(1 - stagger(i, localFrame, 8, 12, 14)) * 16}px)`,
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: '#FEF3C7',
                border: '2px solid #F59E0B',
                color: '#B45309',
                fontFamily: 'monospace',
                fontSize: 18,
                fontWeight: 900,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {i + 1}
            </div>
            <div style={{ flex: 1 }}>
              <FitText text={item} baseSize={28} minSize={20} maxLines={2} color="#0F172A" fontWeight={700} align="left" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const MoneyScaleShot: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  fps,
  variant = 0,
}) => {
  const t = sceneTexts(scene);
  const v = Math.max(0, Math.floor(variant || 0));
  const headerIn = appear(localFrame, 0, 14);

  const cmp = scene.compare;
  const fallbackItems = getFallbackItems(scene, [t.subtitle || 'ฝั่งต้นทุนและข้อจำกัด', 'ฝั่งผลตอบแทนและความได้เปรียบ']);
  const leftTitle = cmp?.leftTitle || cmp?.leftLabel || 'ฝั่งซ้าย';
  const rightTitle = cmp?.rightTitle || cmp?.rightLabel || 'ฝั่งขวา';
  const leftItems = (cmp?.leftItems && cmp.leftItems.length > 0 ? cmp.leftItems : [fallbackItems[0] || 'ข้อจำกัดเดิม']).slice(0, 2);
  const rightItems = (
    cmp?.rightItems && cmp.rightItems.length > 0
      ? cmp.rightItems
      : [fallbackItems[1] || fallbackItems[0] || 'โอกาสใหม่ที่คุ้มกว่า']
  ).slice(0, 2);

  // Determine heavier side for balance beam tilt
  const winner: 'left' | 'right' =
    cmp?.winner || (v % 2 === 1 ? 'left' : rightItems.length >= leftItems.length ? 'right' : 'left');
  const targetTiltDeg = winner === 'right' ? 11.5 : -11.5;

  const tiltSp = spring({
    frame: Math.max(0, localFrame - 6),
    fps,
    config: { damping: 9, stiffness: 75, mass: 1.1 },
  });
  const idleSway = Math.sin(localFrame * 0.09 + v) * 1.3;
  const beamDeg = targetTiltDeg * tiltSp + idleSway;
  const beamRad = (beamDeg * Math.PI) / 180;

  const pivotX = 540;
  const pivotY = 665;
  const armHalf = 290;
  const leftHookX = pivotX - Math.cos(beamRad) * armHalf;
  const leftHookY = pivotY - Math.sin(beamRad) * armHalf;
  const rightHookX = pivotX + Math.cos(beamRad) * armHalf;
  const rightHookY = pivotY + Math.sin(beamRad) * armHalf;

  const chainLen = 185;
  const leftPanX = leftHookX;
  const leftPanY = leftHookY + chainLen;
  const rightPanX = rightHookX;
  const rightPanY = rightHookY + chainLen;

  const leftBricks = winner === 'left' ? 4 : 2;
  const rightBricks = winner === 'right' ? 4 : 2;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}>
        <defs>
          <linearGradient id={`m11-scale-bg-${sceneIndex}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F8FAFC" />
            <stop offset="65%" stopColor="#E8EEF4" />
            <stop offset="100%" stopColor="#D6E0EA" />
          </linearGradient>
          <linearGradient id={`m11-scale-pillar-${sceneIndex}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#475569" />
            <stop offset="50%" stopColor="#1E293B" />
            <stop offset="100%" stopColor="#0F172A" />
          </linearGradient>
          <linearGradient id={`m11-scale-brass-${sceneIndex}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FEF08A" />
            <stop offset="50%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#B45309" />
          </linearGradient>
        </defs>

        <rect width={STAGE_W} height={STAGE_H} fill={`url(#m11-scale-bg-${sceneIndex})`} />

        {/* Subtle isometric floor grid */}
        <g opacity={0.22} stroke="#94A3B8" strokeWidth={1.2}>
          {Array.from({ length: 9 }, (_, i) => {
            const o = (i - 4) * 105;
            const [x1, y1] = isoProject(o, -320, 0, 540, 1085);
            const [x2, y2] = isoProject(o, 320, 0, 540, 1085);
            const [x3, y3] = isoProject(-320, o, 0, 540, 1085);
            const [x4, y4] = isoProject(320, o, 0, 540, 1085);
            return (
              <g key={i}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} />
                <line x1={x3} y1={y3} x2={x4} y2={y4} />
              </g>
            );
          })}
        </g>

        {/* Ground shadow & Isometric Pedestal Base */}
        <IsoShadow x={-130} y={-95} dx={260} dy={190} cx={540} cy={1108} opacity={0.22} />
        <IsoBox
          x={-130}
          y={-95}
          z={0}
          dx={260}
          dy={190}
          dz={34}
          cx={540}
          cy={1088}
          topColor="#475569"
          leftColor="#334155"
          rightColor="#0F172A"
          stroke="#0F172A"
          strokeWidth={1.5}
        />
        <IsoBox
          x={-72}
          y={-52}
          z={34}
          dx={144}
          dy={104}
          dz={24}
          cx={540}
          cy={1088}
          topColor="#64748B"
          leftColor="#475569"
          rightColor="#1E293B"
        />

        {/* Central Pillar */}
        <rect x={518} y={660} width={44} height={385} rx={12} fill={`url(#m11-scale-pillar-${sceneIndex})`} />
        <rect x={532} y={672} width={8} height={360} rx={4} fill="#94A3B8" opacity={0.35} />

        {/* Balance Beam */}
        <line
          x1={leftHookX}
          y1={leftHookY}
          x2={rightHookX}
          y2={rightHookY}
          stroke={`url(#m11-scale-brass-${sceneIndex})`}
          strokeWidth={22}
          strokeLinecap="round"
        />
        <line
          x1={leftHookX}
          y1={leftHookY}
          x2={rightHookX}
          y2={rightHookY}
          stroke="#78350F"
          strokeWidth={3}
          strokeLinecap="round"
          opacity={0.45}
        />

        {/* Center Pivot Fulcrum */}
        <polygon points={`${pivotX},${pivotY - 46} ${pivotX - 24},${pivotY + 12} ${pivotX + 24},${pivotY + 12}`} fill="#0F172A" />
        <circle cx={pivotX} cy={pivotY} r={26} fill={`url(#m11-scale-brass-${sceneIndex})`} stroke="#78350F" strokeWidth={4} />
        <circle cx={pivotX} cy={pivotY} r={9} fill="#0F172A" />

        {/* Left Suspension Chains & Pan */}
        <line x1={leftHookX} y1={leftHookY} x2={leftPanX - 115} y2={leftPanY} stroke="#64748B" strokeWidth={4} />
        <line x1={leftHookX} y1={leftHookY} x2={leftPanX + 115} y2={leftPanY} stroke="#64748B" strokeWidth={4} />
        <circle cx={leftHookX} cy={leftHookY} r={10} fill="#F59E0B" stroke="#78350F" strokeWidth={2.5} />
        <ellipse cx={leftPanX} cy={leftPanY + 12} rx={138} ry={34} fill="#1E293B" />
        <ellipse cx={leftPanX} cy={leftPanY} rx={138} ry={34} fill="#CBD5E1" stroke="#475569" strokeWidth={3.5} />
        {/* Left side cash stack */}
        {Array.from({ length: leftBricks }, (_, i) => (
          <BillBrick
            key={`lbrick-${i}`}
            bx={-62}
            by={-36}
            bz={i * 28}
            dx={116}
            dy={70}
            dz={26}
            cx={leftPanX}
            cy={leftPanY + 6}
            opacity={appear(localFrame, 8 + i * 4, 12)}
          />
        ))}

        {/* Right Suspension Chains & Pan */}
        <line x1={rightHookX} y1={rightHookY} x2={rightPanX - 115} y2={rightPanY} stroke="#64748B" strokeWidth={4} />
        <line x1={rightHookX} y1={rightHookY} x2={rightPanX + 115} y2={rightPanY} stroke="#64748B" strokeWidth={4} />
        <circle cx={rightHookX} cy={rightHookY} r={10} fill="#F59E0B" stroke="#78350F" strokeWidth={2.5} />
        <ellipse cx={rightPanX} cy={rightPanY + 12} rx={138} ry={34} fill="#0F172A" />
        <ellipse cx={rightPanX} cy={rightPanY} rx={138} ry={34} fill="#FEF3C7" stroke="#D97706" strokeWidth={3.5} />
        {/* Right side gold/cash stack */}
        {Array.from({ length: rightBricks }, (_, i) =>
          i % 2 === 1 ? (
            <GoldBar
              key={`rgold-${i}`}
              bx={-52}
              by={-28}
              bz={i * 28}
              dx={104}
              dy={56}
              dz={25}
              cx={rightPanX}
              cy={rightPanY + 6}
              opacity={appear(localFrame, 8 + i * 4, 12)}
            />
          ) : (
            <BillBrick
              key={`rbrick-${i}`}
              bx={-62}
              by={-36}
              bz={i * 28}
              dx={116}
              dy={70}
              dz={26}
              cx={rightPanX}
              cy={rightPanY + 6}
              opacity={appear(localFrame, 8 + i * 4, 12)}
            />
          )
        )}

        {/* VS Badge above fulcrum */}
        <g transform={`translate(${pivotX}, 548)`} opacity={appear(localFrame, 6, 12)}>
          <rect x={-48} y={-28} width={96} height={56} rx={28} fill="#0F172A" stroke="#F59E0B" strokeWidth={3} />
          <text x={0} y={11} textAnchor="middle" fill="#FDE047" fontSize={28} fontFamily="monospace" fontWeight={900}>
            VS
          </text>
        </g>
      </svg>

      {/* Top Headline */}
      <div
        style={{
          position: 'absolute',
          top: 96,
          left: 64,
          right: 64,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          opacity: headerIn,
          transform: `translateY(${(1 - headerIn) * 22}px)`,
        }}
      >
        <div
          style={{
            padding: '7px 22px',
            borderRadius: 999,
            background: '#0F172A',
            color: '#FDE047',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 22,
            fontWeight: 800,
          }}
        >
          {t.badge || 'COMPARE · ชั่งน้ำหนักให้ชัด'}
        </div>
        <FitText text={t.title} baseSize={54} minSize={34} maxLines={3} color="#0F172A" fontWeight={900} />
      </div>

      {/* Bottom 2-Column Compare Cards (strictly above subtitle bar y <= 1375) */}
      <div
        style={{
          position: 'absolute',
          top: 1126,
          left: 56,
          right: 56,
          maxHeight: 250,
          display: 'flex',
          gap: 20,
          opacity: appear(localFrame, 10, 14),
        }}
      >
        {/* Left Card */}
        <div
          style={{
            flex: 1,
            background: '#FFFFFF',
            borderRadius: 22,
            border: `2.5px solid ${winner === 'left' ? '#059669' : '#CBD5E1'}`,
            borderTop: `8px solid ${winner === 'left' ? '#059669' : '#64748B'}`,
            padding: '14px 20px',
            boxShadow: '0 10px 26px rgba(15,23,42,0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <FitText
            text={leftTitle}
            baseSize={28}
            minSize={20}
            maxLines={1}
            color={winner === 'left' ? '#059669' : '#334155'}
            fontWeight={900}
            align="center"
          />
          {leftItems.map((it, idx) => (
            <FitText
              key={idx}
              text={`• ${it}`}
              baseSize={22}
              minSize={18}
              maxLines={2}
              color="#334155"
              fontWeight={700}
              align="left"
            />
          ))}
        </div>

        {/* Right Card */}
        <div
          style={{
            flex: 1,
            background: '#FFFFFF',
            borderRadius: 22,
            border: `2.5px solid ${winner === 'right' ? '#059669' : '#CBD5E1'}`,
            borderTop: `8px solid ${winner === 'right' ? '#059669' : '#D97706'}`,
            padding: '14px 20px',
            boxShadow: '0 10px 26px rgba(15,23,42,0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <FitText
            text={rightTitle}
            baseSize={28}
            minSize={20}
            maxLines={1}
            color={winner === 'right' ? '#059669' : '#B45309'}
            fontWeight={900}
            align="center"
          />
          {rightItems.map((it, idx) => (
            <FitText
              key={idx}
              text={`• ${it}`}
              baseSize={22}
              minSize={18}
              maxLines={2}
              color="#334155"
              fontWeight={700}
              align="left"
            />
          ))}
        </div>
      </div>
    </div>
  );
};

const MoneyCashConveyorShot: React.FC<StyleShotArgs> = ({
  scene,
  sceneIndex,
  localFrame,
  durationFrames,
  fps,
  variant = 0,
}) => {
  const t = sceneTexts(scene);
  const v = Math.max(0, Math.floor(variant || 0));
  const reverseDir = v % 2 === 1;
  const headerIn = appear(localFrame, 0, 14);

  // Extract station labels from steps[].title or bullets
  const rawStations: string[] = [];
  if (Array.isArray(scene.steps) && scene.steps.length > 0) {
    for (const st of scene.steps) {
      const label = typeof st === 'string' ? st.trim() : String(st?.title || '').trim();
      if (label) rawStations.push(label);
    }
  }
  const stations =
    rawStations.length > 0
      ? rawStations.slice(0, 4)
      : getFallbackItems(scene, ['รับสัญญาณตลาด', 'คำนวณเงื่อนไข', 'ส่งคำสั่งอัตโนมัติ']).slice(0, 4);
  const stationCount = Math.max(2, Math.min(4, stations.length));

  const cx = 540;
  const cy = 835;
  const beltMin = -310;
  const beltMax = 310;
  const beltLen = beltMax - beltMin;
  const beltSpeed = 6.5;

  // Which station is currently highlighted along the scene timeline
  const flowProg = clamp01(localFrame / Math.max(24, durationFrames * 0.72));
  const activeStationIdx = Math.min(stationCount - 1, Math.floor(flowProg * stationCount));

  // Moving banknote bundles riding along the isometric conveyor belt
  const movingPacks = Array.from({ length: 4 }, (_, i) => {
    const rawOffset = (localFrame * beltSpeed + i * (beltLen / 4)) % beltLen;
    const pos = reverseDir ? beltMax - rawOffset : beltMin + rawOffset;
    return { pos, key: i };
  });

  // Moving belt slats
  const slatCount = 14;
  const slats = Array.from({ length: slatCount }, (_, i) => {
    const rawOffset = (localFrame * beltSpeed + i * (beltLen / slatCount)) % beltLen;
    return reverseDir ? beltMax - rawOffset : beltMin + rawOffset;
  });

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}>
        <defs>
          <linearGradient id={`m11-conv-bg-${sceneIndex}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F1F5F9" />
            <stop offset="65%" stopColor="#E2E8F0" />
            <stop offset="100%" stopColor="#CBD5E1" />
          </linearGradient>
        </defs>

        <rect width={STAGE_W} height={STAGE_H} fill={`url(#m11-conv-bg-${sceneIndex})`} />

        {/* Subtle factory floor isometric grid */}
        <g opacity={0.24} stroke="#94A3B8" strokeWidth={1.2}>
          {Array.from({ length: 11 }, (_, i) => {
            const o = (i - 5) * 95;
            const [x1, y1] = isoProject(o, -380, -45, cx, cy);
            const [x2, y2] = isoProject(o, 380, -45, cx, cy);
            const [x3, y3] = isoProject(-380, o, -45, cx, cy);
            const [x4, y4] = isoProject(380, o, -45, cx, cy);
            return (
              <g key={i}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} />
                <line x1={x3} y1={y3} x2={x4} y2={y4} />
              </g>
            );
          })}
        </g>

        {/* Ground shadow under conveyor bed */}
        <IsoShadow x={beltMin - 20} y={-88} dx={beltLen + 40} dy={176} cx={cx} cy={cy + 62} opacity={0.2} />

        {/* Conveyor Support Legs */}
        {[-250, 0, 230].map((lx, idx) => (
          <IsoBox
            key={`leg-${idx}`}
            x={lx}
            y={-64}
            z={-55}
            dx={34}
            dy={128}
            dz={55}
            cx={cx}
            cy={cy}
            topColor="#475569"
            leftColor="#334155"
            rightColor="#0F172A"
          />
        ))}

        {/* Conveyor Metallic Frame & Belt Surface */}
        <IsoBox
          x={beltMin - 24}
          y={-82}
          z={0}
          dx={beltLen + 48}
          dy={164}
          dz={34}
          cx={cx}
          cy={cy}
          topColor="#334155"
          leftColor="#1E293B"
          rightColor="#0F172A"
          stroke="#0F172A"
          strokeWidth={1.5}
        />
        {/* Moving rubber belt inner track */}
        <IsoBox
          x={beltMin - 12}
          y={-62}
          z={34}
          dx={beltLen + 24}
          dy={124}
          dz={6}
          cx={cx}
          cy={cy}
          topColor="#1E293B"
          leftColor="#0F172A"
          rightColor="#020617"
        />

        {/* Animated Belt Slats */}
        {slats.map((sx, idx) => {
          const [p1x, p1y] = isoProject(sx, -58, 41, cx, cy);
          const [p2x, p2y] = isoProject(sx, 58, 41, cx, cy);
          return <line key={`slat-${idx}`} x1={p1x} y1={p1y} x2={p2x} y2={p2y} stroke="#475569" strokeWidth={3} />;
        })}

        {/* Rotating Side Rollers along conveyor edge */}
        {[-280, -140, 0, 140, 280].map((rx, idx) => {
          const [rcx, rcy] = isoProject(rx, 82, 16, cx, cy);
          const rot = (localFrame * (reverseDir ? -10 : 10) + idx * 35) % 360;
          return (
            <g key={`roller-${idx}`} transform={`translate(${rcx.toFixed(1)}, ${rcy.toFixed(1)})`}>
              <circle cx={0} cy={0} r={11} fill="#94A3B8" stroke="#0F172A" strokeWidth={2.5} />
              <line
                x1={Math.cos((rot * Math.PI) / 180) * -7}
                y1={Math.sin((rot * Math.PI) / 180) * -7}
                x2={Math.cos((rot * Math.PI) / 180) * 7}
                y2={Math.sin((rot * Math.PI) / 180) * 7}
                stroke="#0F172A"
                strokeWidth={2.5}
              />
            </g>
          );
        })}

        {/* Banknote Bundles travelling on belt */}
        {movingPacks.map((p) => (
          <BillBrick
            key={`pack-${p.key}`}
            bx={p.pos - 52}
            by={-36}
            bz={42}
            dx={104}
            dy={72}
            dz={28}
            cx={cx}
            cy={cy}
          />
        ))}

        {/* Overhead Automated Processing Stations (Arches + Status LEDs + Callout Pills) */}
        {Array.from({ length: stationCount }, (_, i) => {
          const frac = stationCount === 1 ? 0.5 : i / (stationCount - 1);
          const stX = beltMin + 70 + frac * (beltLen - 140);
          const isActive = i <= activeStationIdx;
          const sp = spring({
            frame: Math.max(0, localFrame - 4 - i * 6),
            fps,
            config: { damping: 14, stiffness: 150 },
          });

          const [postBackX, postBackY] = isoProject(stX, -76, 138, cx, cy);
          const [postFrontX, postFrontY] = isoProject(stX, 76, 138, cx, cy);
          const [baseBackX, baseBackY] = isoProject(stX, -76, 34, cx, cy);
          const [baseFrontX, baseFrontY] = isoProject(stX, 76, 34, cx, cy);
          const midTopX = (postBackX + postFrontX) / 2;
          const midTopY = (postBackY + postFrontY) / 2;

          // Alternate callouts cleanly above & below conveyor so labels never collide
          const placeAbove = i % 2 === 0;
          const pillW = 352;
          const pillH = 66;
          const pillX = Math.max(44, Math.min(STAGE_W - pillW - 44, midTopX - pillW / 2));
          const pillY = placeAbove ? 470 + (i >= 2 ? 78 : 0) : 1075 + (i >= 3 ? 78 : 0);
          const anchorY = placeAbove ? pillY + pillH : pillY;

          return (
            <g key={`station-${i}`} opacity={clamp01(sp * 1.3)}>
              {/* Scanner Gate Frame */}
              <line x1={baseBackX} y1={baseBackY} x2={postBackX} y2={postBackY} stroke="#475569" strokeWidth={10} strokeLinecap="round" />
              <line x1={baseFrontX} y1={baseFrontY} x2={postFrontX} y2={postFrontY} stroke="#334155" strokeWidth={10} strokeLinecap="round" />
              <line
                x1={postBackX}
                y1={postBackY}
                x2={postFrontX}
                y2={postFrontY}
                stroke={isActive ? '#059669' : '#64748B'}
                strokeWidth={14}
                strokeLinecap="round"
              />
              {/* Laser scan curtain when active */}
              {isActive && (
                <polygon
                  points={`${postBackX},${postBackY + 6} ${postFrontX},${postFrontY + 6} ${baseFrontX},${baseFrontY} ${baseBackX},${baseBackY}`}
                  fill="#10B981"
                  opacity={0.14 + 0.08 * Math.sin(localFrame * 0.25 + i)}
                />
              )}
              {/* Connector dashed line to label pill */}
              <line
                x1={midTopX}
                y1={midTopY}
                x2={pillX + pillW / 2}
                y2={anchorY}
                stroke={isActive ? '#059669' : '#64748B'}
                strokeWidth={2.5}
                strokeDasharray="6 6"
              />
              {/* Station number badge on gate */}
              <circle cx={midTopX} cy={midTopY} r={18} fill={isActive ? '#10B981' : '#334155'} stroke="#FFFFFF" strokeWidth={3} />
              <text x={midTopX} y={midTopY + 6} textAnchor="middle" fill="#FFFFFF" fontSize={16} fontFamily="monospace" fontWeight={900}>
                {i + 1}
              </text>

              {/* Station Label Pill */}
              <rect
                x={pillX}
                y={pillY}
                width={pillW}
                height={pillH}
                rx={18}
                fill="#FFFFFF"
                stroke={isActive ? '#10B981' : '#94A3B8'}
                strokeWidth={3}
              />
              <rect x={pillX + 10} y={pillY + 13} width={40} height={40} rx={12} fill={isActive ? '#059669' : '#334155'} />
              <text
                x={pillX + 30}
                y={pillY + 40}
                textAnchor="middle"
                fill="#FFFFFF"
                fontSize={20}
                fontFamily="monospace"
                fontWeight={900}
              >
                {`0${i + 1}`}
              </text>
              <text
                x={pillX + 62}
                y={pillY + 41}
                fill="#0F172A"
                fontSize={21}
                fontFamily={THAI_FONT_FAMILY}
                fontWeight={800}
              >
                {truncateText(stations[i] || `สถานี ${i + 1}`, 21)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Top Headline */}
      <div
        style={{
          position: 'absolute',
          top: 96,
          left: 64,
          right: 64,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          opacity: headerIn,
          transform: `translateY(${(1 - headerIn) * 22}px)`,
        }}
      >
        <div
          style={{
            padding: '7px 22px',
            borderRadius: 999,
            background: '#059669',
            color: '#FFFFFF',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 22,
            fontWeight: 800,
          }}
        >
          {t.badge || 'AUTO FLOW · ระบบทำงานเป็นขั้นตอน'}
        </div>
        <FitText text={t.title} baseSize={54} minSize={34} maxLines={3} color="#0F172A" fontWeight={900} />
      </div>

      {/* Bottom Summary Strip (strictly above subtitle bar y <= 1375) */}
      <div
        style={{
          position: 'absolute',
          top: 1260,
          left: 64,
          right: 64,
          maxHeight: 115,
          display: 'flex',
          justifyContent: 'center',
          opacity: appear(localFrame, 12, 16),
        }}
      >
        <div
          style={{
            background: '#0F172A',
            border: '2px solid #10B981',
            borderRadius: 20,
            padding: '14px 32px',
            maxWidth: 880,
          }}
        >
          <FitText
            text={t.subtitle || stations.join(' → ')}
            baseSize={26}
            minSize={20}
            maxLines={2}
            color="#F8FAFC"
            fontWeight={700}
          />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// LOOK-13: RECEIPT (4 distinct 3D shots)
// ============================================================================

function buildSerratedPath(rx: number, ry: number, rw: number, rh: number, teeth = 22): string {
  const toothW = rw / teeth;
  let d = `M ${rx} ${ry} L ${rx + rw} ${ry} L ${rx + rw} ${ry + rh}`;
  for (let i = teeth; i >= 1; i--) {
    const tx = rx + i * toothW;
    d += ` L ${(tx - toothW * 0.5).toFixed(1)} ${(ry + rh - 14).toFixed(1)} L ${(tx - toothW).toFixed(1)} ${(ry + rh).toFixed(1)}`;
  }
  return `${d} Z`;
}

const ReceiptPrintShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, durationFrames }) => {
  const t = sceneTexts(scene);
  const items = getFallbackItems(scene, [
    'รายการค่าใช้จ่ายหลัก',
    'ต้นทุนแฝงรายเดือน',
    'สรุปยอดที่ต้องตรวจสอบ',
  ]).slice(0, 4);

  const feedProg = easeOutCubic(clamp01((localFrame - 4) / Math.max(28, durationFrames * 0.65)));
  const maxFeed = 920;
  const feedH = 260 + feedProg * (maxFeed - 260);
  const rx = 210;
  const rw = 660;
  const ry = 438;
  const zig = buildSerratedPath(rx, ry, rw, feedH, 24);
  const ledBlink = Math.sin(localFrame * 0.35) > 0 ? 1 : 0.35;
  const headerIn = appear(localFrame, 0, 14);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}>
        <defs>
          <radialGradient id={`r13-print-bg-${sceneIndex}`} cx="50%" cy="22%" r="76%">
            <stop offset="0%" stopColor="#172540" />
            <stop offset="55%" stopColor="#0C1322" />
            <stop offset="100%" stopColor="#06090F" />
          </radialGradient>
          <linearGradient id={`r13-paper-${sceneIndex}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#DCE3EC" />
            <stop offset="7%" stopColor="#FFFFFF" />
            <stop offset="90%" stopColor="#F8FAFC" />
            <stop offset="100%" stopColor="#E2E8F0" />
          </linearGradient>
          <clipPath id={`r13-feed-clip-${sceneIndex}`}>
            <rect x={rx} y={ry} width={rw} height={feedH - 16} />
          </clipPath>
        </defs>

        <rect width={STAGE_W} height={STAGE_H} fill={`url(#r13-print-bg-${sceneIndex})`} />

        {/* Sleek Charcoal 3D Thermal POS Printer */}
        <g transform="translate(540, 385)">
          <ellipse cx={0} cy={80} rx={400} ry={30} fill="#000000" opacity={0.58} />
          <rect x={-390} y={-76} width={780} height={148} rx={28} fill="#1E2430" stroke="#475569" strokeWidth={2.5} />
          <rect x={-356} y={-60} width={712} height={72} rx={16} fill="#090D16" stroke="#334155" strokeWidth={1.5} />
          <line x1={-315} y1={-44} x2={160} y2={-44} stroke="rgba(255,255,255,0.18)" strokeWidth={6} strokeLinecap="round" />
          <circle cx={312} cy={-24} r={8} fill="#22C55E" opacity={ledBlink} />
          <circle cx={280} cy={-24} r={7} fill="#38BDF8" opacity={0.85} />
          <text x={-328} y={-16} fill="#94A3B8" fontSize={19} fontFamily="monospace" fontWeight={700} letterSpacing={3}>
            THERMAL POS · 80MM
          </text>
          <rect x={-342} y={36} width={684} height={24} rx={12} fill="#020617" stroke="#334155" strokeWidth={2} />
        </g>

        {/* Receipt Paper Shadow & Sheet */}
        <rect x={rx + 18} y={ry + 12} width={rw} height={feedH - 12} fill="rgba(0,0,0,0.48)" />
        <path d={zig} fill={`url(#r13-paper-${sceneIndex})`} stroke="#CBD5E1" strokeWidth={2} />
        <rect x={rx} y={ry} width={rw} height={26} fill="rgba(15,23,42,0.16)" />

        {/* Clipped Receipt Contents revealing line by line */}
        <g clipPath={`url(#r13-feed-clip-${sceneIndex})`}>
          <text
            x={540}
            y={ry + 78}
            textAnchor="middle"
            fill="#0F172A"
            fontSize={32}
            fontFamily="monospace"
            fontWeight={900}
            letterSpacing={3}
          >
            {truncateText(t.badge || 'STUDIO RECEIPT', 26)}
          </text>
          <text x={540} y={ry + 114} textAnchor="middle" fill="#64748B" fontSize={19} fontFamily="monospace">
            ITEMIZED BREAKDOWN · #{String(sceneIndex + 1).padStart(2, '0')}
          </text>
          <line
            x1={rx + 36}
            y1={ry + 140}
            x2={rx + rw - 36}
            y2={ry + 140}
            stroke="#94A3B8"
            strokeWidth={2.5}
            strokeDasharray="10 8"
          />

          {items.map((item, idx) => {
            const iy = ry + 206 + idx * 124;
            const rowRev = stagger(idx, localFrame, 9, 8, 12);
            const syntheticNum = t.numbers[idx] || `${((idx + 1) * 1250).toLocaleString('en-US')}.00`;
            return (
              <g key={idx} opacity={rowRev}>
                <text
                  x={rx + 40}
                  y={iy}
                  fill="#0284C7"
                  fontSize={22}
                  fontFamily="monospace"
                  fontWeight={800}
                >
                  {`0${idx + 1}`}
                </text>
                <text
                  x={rx + 88}
                  y={iy}
                  fill="#0F172A"
                  fontSize={26}
                  fontFamily={THAI_FONT_FAMILY}
                  fontWeight={700}
                >
                  {truncateText(item, 24)}
                </text>
                <text
                  x={rx + rw - 40}
                  y={iy + 38}
                  textAnchor="end"
                  fill="#475569"
                  fontSize={22}
                  fontFamily="monospace"
                  fontWeight={800}
                >
                  {syntheticNum}
                </text>
                <line
                  x1={rx + 40}
                  y1={iy + 58}
                  x2={rx + rw - 40}
                  y2={iy + 58}
                  stroke="#E2E8F0"
                  strokeWidth={2}
                />
              </g>
            );
          })}

          {/* Barcode at bottom */}
          <g transform={`translate(${rx + 115}, ${ry + 735})`}>
            {Array.from({ length: 42 }, (_, i) => (
              <rect
                key={i}
                x={i * 10.2}
                y={0}
                width={hashSeed(i * 13 + 7) > 0.52 ? 6.2 : 2.8}
                height={76}
                fill="#0F172A"
              />
            ))}
            <text x={215} y={104} textAnchor="middle" fill="#64748B" fontSize={18} fontFamily="monospace" letterSpacing={5}>
              8 850123 004829
            </text>
          </g>
        </g>
      </svg>

      {/* Top Title above POS Printer */}
      <div
        style={{
          position: 'absolute',
          top: 90,
          left: 64,
          right: 64,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          opacity: headerIn,
          transform: `translateY(${(1 - headerIn) * 20}px)`,
        }}
      >
        <FitText text={t.title} baseSize={52} minSize={32} maxLines={3} color="#F8FAFC" fontWeight={900} />
      </div>
    </div>
  );
};

const ReceiptItemizedZoomShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame }) => {
  const t = sceneTexts(scene);
  const items = getFallbackItems(scene, [
    'รายการพื้นฐานทั่วไป',
    'จุดที่ใช้จ่ายสูงผิดปกติ',
    'ค่าธรรมเนียมและส่วนต่าง',
  ]).slice(0, 3);
  const focusIdx = items.length >= 2 ? 1 : 0;
  const primary = parsePrimaryNumber(scene);

  const circleProg = easeOutCubic(clamp01((localFrame - 14) / 22));
  const calloutIn = appear(localFrame, 22, 14);
  const headerIn = appear(localFrame, 0, 14);
  const tilt = -3.5 + Math.sin(localFrame * 0.04) * 1.2;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}>
        <defs>
          <radialGradient id={`r13-zoom-bg-${sceneIndex}`} cx="50%" cy="48%" r="72%">
            <stop offset="0%" stopColor="#1E293B" />
            <stop offset="100%" stopColor="#06090F" />
          </radialGradient>
        </defs>

        <rect width={STAGE_W} height={STAGE_H} fill={`url(#r13-zoom-bg-${sceneIndex})`} />

        {/* Subtle desk grid lines */}
        <g opacity={0.14} stroke="#38BDF8" strokeWidth={1.2}>
          {Array.from({ length: 12 }, (_, i) => (
            <line key={i} x1={0} y1={320 + i * 105} x2={STAGE_W} y2={320 + i * 105} />
          ))}
        </g>

        {/* Tilted Macro Receipt Sheet */}
        <g transform={`translate(540, 825) rotate(${tilt.toFixed(2)})`}>
          {/* Drop Shadow */}
          <rect x={-410} y={-405} width={840} height={840} rx={12} fill="rgba(0,0,0,0.52)" />
          {/* Paper Sheet */}
          <rect x={-425} y={-420} width={850} height={840} rx={8} fill="#F8FAFC" stroke="#CBD5E1" strokeWidth={2.5} />

          {/* Receipt Macro Header */}
          <text x={-375} y={-350} fill="#64748B" fontSize={22} fontFamily="monospace" fontWeight={700} letterSpacing={3}>
            MACRO AUDIT · LINE ITEMS
          </text>
          <line x1={-375} y1={-322} x2={375} y2={-322} stroke="#94A3B8" strokeWidth={2.5} strokeDasharray="10 8" />

          {/* Line Items */}
          {items.map((item, idx) => {
            const isFocus = idx === focusIdx;
            const yPos = -215 + idx * 215;
            const rowPrice = isFocus
              ? primary.raw
              : t.numbers[idx] || `${((idx + 1) * 890).toLocaleString('en-US')}.00`;
            return (
              <g key={idx}>
                {isFocus && (
                  <rect
                    x={-392}
                    y={yPos - 74}
                    width={784}
                    height={146}
                    rx={16}
                    fill="#FEF2F2"
                    stroke="#FECACA"
                    strokeWidth={2}
                  />
                )}
                <text
                  x={-368}
                  y={yPos - 14}
                  fill={isFocus ? '#DC2626' : '#64748B'}
                  fontSize={22}
                  fontFamily="monospace"
                  fontWeight={800}
                >
                  {`ITEM 0${idx + 1}`}
                </text>
                <text
                  x={-368}
                  y={yPos + 34}
                  fill={isFocus ? '#0F172A' : '#475569'}
                  fontSize={isFocus ? 34 : 28}
                  fontFamily={THAI_FONT_FAMILY}
                  fontWeight={isFocus ? 900 : 600}
                >
                  {truncateText(item, 22)}
                </text>
                <text
                  x={362}
                  y={yPos + 30}
                  textAnchor="end"
                  fill={isFocus ? '#DC2626' : '#334155'}
                  fontSize={isFocus ? 42 : 30}
                  fontFamily="monospace"
                  fontWeight={900}
                >
                  {rowPrice}
                </text>

                {/* Hand-drawn Animated Red Marker Circle around Focus Price */}
                {isFocus && (
                  <ellipse
                    cx={260}
                    cy={yPos + 14}
                    rx={142}
                    ry={52}
                    fill="none"
                    stroke="#EF4444"
                    strokeWidth={7}
                    strokeLinecap="round"
                    strokeDasharray={700}
                    strokeDashoffset={700 * (1 - circleProg)}
                  />
                )}
              </g>
            );
          })}

          {/* Red pen annotation arrow & badge */}
          <g opacity={calloutIn} transform={`translate(180, ${-215 + focusIdx * 215 + 108})`}>
            <path d="M 65 -42 Q 115 -10 75 26" fill="none" stroke="#EF4444" strokeWidth={5} strokeLinecap="round" />
            <rect x={-165} y={18} width={330} height={60} rx={18} fill="#DC2626" />
            <text x={0} y={56} textAnchor="middle" fill="#FFFFFF" fontSize={26} fontFamily={THAI_FONT_FAMILY} fontWeight={800}>
              จุดแพงที่สุดที่ต้องโฟกัส!
            </text>
          </g>
        </g>
      </svg>

      {/* Top Headline */}
      <div
        style={{
          position: 'absolute',
          top: 96,
          left: 64,
          right: 64,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          opacity: headerIn,
        }}
      >
        <div
          style={{
            padding: '7px 22px',
            borderRadius: 999,
            background: 'rgba(239,68,68,0.18)',
            border: '2px solid #EF4444',
            color: '#FCA5A5',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 22,
            fontWeight: 800,
          }}
        >
          {t.badge || 'ZOOM · ตรวจสอบรายการสำคัญ'}
        </div>
        <FitText text={t.title} baseSize={54} minSize={34} maxLines={3} color="#F8FAFC" fontWeight={900} />
      </div>

      {/* Bottom Note (strictly above subtitle bar y <= 1375) */}
      <div
        style={{
          position: 'absolute',
          top: 1300,
          left: 72,
          right: 72,
          maxHeight: 80,
          display: 'flex',
          justifyContent: 'center',
          opacity: calloutIn,
        }}
      >
        <FitText
          text={t.subtitle || 'แยกดูทีละบรรทัดจะเห็นต้นทุนที่กินงบมากที่สุดทันที'}
          baseSize={28}
          minSize={20}
          maxLines={2}
          color="#BAE6FD"
          fontWeight={700}
        />
      </div>
    </div>
  );
};

const ReceiptTotalStampShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps }) => {
  const t = sceneTexts(scene);
  const primary = parsePrimaryNumber(scene);
  const overBudget = isNegativeMood(scene);
  const stampText = overBudget ? 'OVER BUDGET' : 'PAID';
  const stampColor = overBudget ? '#DC2626' : '#059669';

  const stampFrame = Math.max(0, localFrame - 16);
  const stampSpring = spring({
    frame: stampFrame,
    fps,
    config: { damping: 11, stiffness: 220, mass: 0.7 },
  });
  const stampScale = localFrame < 16 ? 2.4 : interpolate(stampSpring, [0, 1], [2.4, 1]);
  const stampOpacity = localFrame < 16 ? 0 : clamp01(stampSpring * 2.5);

  // Subtle impact shake right after stamp hits
  const shakeAmt = localFrame >= 18 && localFrame <= 26 ? Math.sin(localFrame * 3.1) * (26 - localFrame) * 0.9 : 0;

  const rx = 140;
  const rw = 800;
  const ry = 385;
  const rh = 960;
  const zig = buildSerratedPath(rx, ry, rw, rh, 26);
  const headerIn = appear(localFrame, 0, 14);
  const summaryLines = getFallbackItems(scene, [t.subtitle || 'ยอดสุทธิรวมทุกรายการ']).slice(0, 2);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}>
        <defs>
          <radialGradient id={`r13-stamp-bg-${sceneIndex}`} cx="50%" cy="35%" r="72%">
            <stop offset="0%" stopColor="#172540" />
            <stop offset="100%" stopColor="#06090F" />
          </radialGradient>
        </defs>

        <rect width={STAGE_W} height={STAGE_H} fill={`url(#r13-stamp-bg-${sceneIndex})`} />

        <g transform={`translate(${shakeAmt.toFixed(1)}, ${(shakeAmt * 0.6).toFixed(1)})`}>
          {/* Cast shadow */}
          <rect x={rx + 20} y={ry + 16} width={rw} height={rh - 16} fill="rgba(0,0,0,0.52)" />
          {/* Giant Crisp Thermal Receipt */}
          <path d={zig} fill="#FFFFFF" stroke="#CBD5E1" strokeWidth={2.5} />

          {/* Summary Rows */}
          <text x={rx + 48} y={ry + 84} fill="#64748B" fontSize={22} fontFamily="monospace" fontWeight={700} letterSpacing={3}>
            FINAL STATEMENT · SUMMARY
          </text>
          <line x1={rx + 48} y1={ry + 110} x2={rx + rw - 48} y2={ry + 110} stroke="#94A3B8" strokeWidth={2.5} strokeDasharray="10 8" />

          {summaryLines.map((line, i) => (
            <g key={i} opacity={stagger(i, localFrame, 6, 4, 12)}>
              <text
                x={rx + 48}
                y={ry + 185 + i * 78}
                fill="#334155"
                fontSize={28}
                fontFamily={THAI_FONT_FAMILY}
                fontWeight={700}
              >
                {`• ${truncateText(line, 34)}`}
              </text>
            </g>
          ))}

          {/* Double Total Divider */}
          <line x1={rx + 48} y1={ry + 335} x2={rx + rw - 48} y2={ry + 335} stroke="#0F172A" strokeWidth={4} />
          <line x1={rx + 48} y1={ry + 349} x2={rx + rw - 48} y2={ry + 349} stroke="#0F172A" strokeWidth={4} />

          {/* Giant TOTAL Line */}
          <text x={rx + 48} y={ry + 448} fill="#0F172A" fontSize={44} fontFamily="monospace" fontWeight={900}>
            TOTAL
          </text>
          <text
            x={rx + rw - 48}
            y={ry + 454}
            textAnchor="end"
            fill={overBudget ? '#DC2626' : '#0284C7'}
            fontSize={68}
            fontFamily={THAI_FONT_FAMILY}
            fontWeight={900}
          >
            {primary.raw}
          </text>

          <line x1={rx + 48} y1={ry + 498} x2={rx + rw - 48} y2={ry + 498} stroke="#CBD5E1" strokeWidth={2.5} strokeDasharray="10 8" />

          {/* Rubber Ink Stamp slamming onto the receipt */}
          <g
            transform={`translate(540, ${ry + 685}) rotate(-11) scale(${stampScale.toFixed(3)})`}
            opacity={stampOpacity}
          >
            <rect
              x={-250}
              y={-76}
              width={500}
              height={152}
              rx={20}
              fill={overBudget ? 'rgba(220,38,38,0.08)' : 'rgba(5,150,105,0.08)'}
              stroke={stampColor}
              strokeWidth={11}
            />
            <rect
              x={-232}
              y={-58}
              width={464}
              height={116}
              rx={12}
              fill="none"
              stroke={stampColor}
              strokeWidth={3.5}
              strokeDasharray="12 6"
            />
            <text
              x={0}
              y={22}
              textAnchor="middle"
              fill={stampColor}
              fontSize={overBudget ? 58 : 74}
              fontFamily="monospace"
              fontWeight={900}
              letterSpacing={6}
            >
              {stampText}
            </text>
          </g>
        </g>
      </svg>

      {/* Top Headline */}
      <div
        style={{
          position: 'absolute',
          top: 96,
          left: 64,
          right: 64,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          opacity: headerIn,
        }}
      >
        <FitText text={t.title} baseSize={54} minSize={34} maxLines={3} color="#F8FAFC" fontWeight={900} />
      </div>
    </div>
  );
};

const ReceiptCrumpleShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, durationFrames }) => {
  const t = sceneTexts(scene);
  const lesson = scene.quote?.text || t.subtitle || t.bullets[0] || 'ตัดรายจ่ายที่ไม่จำเป็นออกจากชีวิตทันที';

  // Parabolic arc of crumpled receipt paper ball into the wastebin
  const arcT = clamp01((localFrame - 4) / Math.max(24, durationFrames * 0.48));
  const ballX = interpolate(arcT, [0, 1], [190, 540]);
  const ballY = interpolate(arcT, [0, 0.45, 1], [670, 490, 910]);
  const ballRot = arcT * 420 + Math.sin(localFrame * 0.08) * 6;
  const landed = arcT >= 0.98;
  const binBounce = landed ? Math.sin(Math.min(Math.PI, (localFrame - durationFrames * 0.5) * 0.35)) * 6 : 0;

  const headerIn = appear(localFrame, 0, 14);
  const lessonIn = appear(localFrame, 14, 16);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}>
        <defs>
          <radialGradient id={`r13-crumple-bg-${sceneIndex}`} cx="50%" cy="62%" r="70%">
            <stop offset="0%" stopColor="#1B2844" />
            <stop offset="100%" stopColor="#06090F" />
          </radialGradient>
          <linearGradient id={`r13-bin-${sceneIndex}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#334155" />
            <stop offset="45%" stopColor="#1E293B" />
            <stop offset="100%" stopColor="#0F172A" />
          </linearGradient>
        </defs>

        <rect width={STAGE_W} height={STAGE_H} fill={`url(#r13-crumple-bg-${sceneIndex})`} />

        {/* Subtle dashed motion arc trail */}
        <path
          d="M 190 670 Q 360 430 540 890"
          fill="none"
          stroke="#38BDF8"
          strokeWidth={3.5}
          strokeDasharray="10 12"
          opacity={0.4}
        />

        {/* Floor Shadow */}
        <ellipse cx={540} cy={1295} rx={210} ry={32} fill="#000000" opacity={0.55} />

        {/* Wastebin back rim */}
        <g transform={`translate(540, ${(1070 + binBounce).toFixed(1)})`}>
          <ellipse cx={0} cy={-160} rx={182} ry={38} fill="#090D16" stroke="#475569" strokeWidth={5} />
        </g>

        {/* Faceted 3D Crumpled Receipt Paper Ball */}
        <g transform={`translate(${ballX.toFixed(1)}, ${ballY.toFixed(1)}) rotate(${ballRot.toFixed(1)})`}>
          <polygon points="-62,-28 -18,-72 48,-54 74,-8 44,58 -24,68 -68,24" fill="#E2E8F0" stroke="#94A3B8" strokeWidth={2.5} />
          <polygon points="-62,-28 -18,-72 6,-8 -32,18" fill="#FFFFFF" />
          <polygon points="-18,-72 48,-54 6,-8" fill="#F1F5F9" />
          <polygon points="48,-54 74,-8 22,22 6,-8" fill="#CBD5E1" />
          <polygon points="6,-8 22,22 -24,68 -32,18" fill="#E2E8F0" />
          {/* Skewed thermal ink lines on crumpled facets */}
          <line x1={-32} y1={-38} x2={16} y2={-46} stroke="#475569" strokeWidth={3} />
          <line x1={-16} y1={-14} x2={34} y2={-22} stroke="#475569" strokeWidth={3} />
          <line x1={-36} y1={24} x2={12} y2={14} stroke="#DC2626" strokeWidth={3.5} />
        </g>

        {/* Sleek 3D Mesh Wastebin Front Body */}
        <g transform={`translate(540, ${(1070 + binBounce).toFixed(1)})`}>
          <path
            d="M -182 -160 L -132 205 Q 0 238 132 205 L 182 -160 Q 0 -122 -182 -160 Z"
            fill={`url(#r13-bin-${sceneIndex})`}
            stroke="#64748B"
            strokeWidth={3.5}
          />
          {/* Diagonal wire-mesh crosshatch */}
          {[-110, -55, 0, 55, 110].map((xOff, i) => (
            <line
              key={i}
              x1={xOff}
              y1={-136}
              x2={xOff * 0.72}
              y2={212}
              stroke="#475569"
              strokeWidth={2.2}
              opacity={0.7}
            />
          ))}
          {[-60, 25, 110].map((yOff, i) => (
            <path
              key={i}
              d={`M ${-166 + i * 14} ${yOff} Q 0 ${yOff + 26} ${166 - i * 14} ${yOff}`}
              fill="none"
              stroke="#475569"
              strokeWidth={2.2}
              opacity={0.7}
            />
          ))}
          {/* Front Metallic Rim Highlight */}
          <path d="M -182 -160 Q 0 -122 182 -160" fill="none" stroke="#94A3B8" strokeWidth={6} strokeLinecap="round" />
        </g>
      </svg>

      {/* Top Title + Lesson Card */}
      <div
        style={{
          position: 'absolute',
          top: 96,
          left: 64,
          right: 64,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 18,
          opacity: headerIn,
        }}
      >
        <div
          style={{
            padding: '7px 22px',
            borderRadius: 999,
            background: 'rgba(56,189,248,0.16)',
            border: '2px solid #38BDF8',
            color: '#7DD3FC',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 22,
            fontWeight: 800,
          }}
        >
          {t.badge || 'KEY LESSON · ตัดสิ่งที่ไม่จำเป็น'}
        </div>
        <FitText text={t.title} baseSize={54} minSize={34} maxLines={3} color="#FFFFFF" fontWeight={900} />

        <div
          style={{
            marginTop: 8,
            background: 'rgba(15, 23, 42, 0.78)',
            border: '2px solid rgba(56, 189, 248, 0.45)',
            borderRadius: 24,
            padding: '20px 34px',
            maxWidth: 880,
            opacity: lessonIn,
            transform: `translateY(${(1 - lessonIn) * 18}px)`,
          }}
        >
          <FitText text={lesson} baseSize={32} minSize={22} maxLines={3} color="#E0F2FE" fontWeight={700} />
        </div>
      </div>

      {/* Bottom Tag (strictly above subtitle bar y <= 1375) */}
      {t.bullets.length > 1 && (
        <div
          style={{
            position: 'absolute',
            top: 1330,
            left: 72,
            right: 72,
            maxHeight: 54,
            display: 'flex',
            justifyContent: 'center',
            opacity: appear(localFrame, 18, 14),
          }}
        >
          <FitText text={t.bullets[1]} baseSize={24} minSize={18} maxLines={1} color="#94A3B8" fontWeight={700} />
        </div>
      )}
    </div>
  );
};

// ============================================================================
// LOOK-14: ICEBERG (4 distinct 3D shots)
// ============================================================================

const IcebergRevealShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame }) => {
  const t = sceneTexts(scene);
  const wave = Math.sin(localFrame * 0.07) * 9;
  const waterY = 635;
  const reveal = appear(localFrame, 4, 22);
  const headerIn = appear(localFrame, 0, 14);

  const layers = getFallbackItems(scene, [
    'ชั้นที่ 1 · โครงสร้างเบื้องหลัง',
    'ชั้นที่ 2 · กระบวนการที่ซ่อนอยู่',
    'ชั้นที่ 3 · รากฐานที่แท้จริง',
  ]).slice(0, 3);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}>
        <defs>
          <linearGradient id={`i14-rev-sky-${sceneIndex}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#EFF8FE" />
            <stop offset="100%" stopColor="#CBE7F8" />
          </linearGradient>
          <linearGradient id={`i14-rev-sea-${sceneIndex}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#26A9DB" />
            <stop offset="30%" stopColor="#0C6EA8" />
            <stop offset="68%" stopColor="#074173" />
            <stop offset="100%" stopColor="#041F3D" />
          </linearGradient>
        </defs>

        {/* Above water sky & below water abyss */}
        <rect x={0} y={0} width={STAGE_W} height={waterY} fill={`url(#i14-rev-sky-${sceneIndex})`} />
        <rect x={0} y={waterY} width={STAGE_W} height={STAGE_H - waterY} fill={`url(#i14-rev-sea-${sceneIndex})`} />

        {/* Underwater sunlight shafts */}
        <g opacity={0.16}>
          <polygon points="140,635 320,635 190,1540 10,1540" fill="#BAE6FD" />
          <polygon points="520,635 720,635 580,1540 390,1540" fill="#7DD3FC" />
          <polygon points="840,635 980,635 880,1540 740,1540" fill="#38BDF8" />
        </g>

        {/* Above-water Faceted Snow Tip */}
        <g>
          <polygon points="275,638 415,430 475,638" fill="#FFFFFF" />
          <polygon points="415,430 528,510 475,638" fill="#DFF2FD" />
          <polygon points="528,510 605,638 475,638" fill="#B6E1F8" />
          <polygon points="275,638 345,525 415,430" fill="#F8FCFF" />
        </g>

        {/* Massive Underwater Faceted Glacial Iceberg */}
        <g opacity={0.35 + reveal * 0.65} transform={`translate(0, ${(1 - reveal) * 45})`}>
          <polygon points="275,638 475,638 395,860 150,805" fill="#A5E3FA" />
          <polygon points="475,638 605,638 730,835 510,895" fill="#7DD3FC" />
          <polygon points="475,638 510,895 395,860" fill="#BAE6FD" />
          <polygon points="150,805 395,860 325,1135 115,1035" fill="#5AC5F5" />
          <polygon points="395,860 510,895 495,1180 325,1135" fill="#7DD3FC" />
          <polygon points="510,895 730,835 760,1060 495,1180" fill="#38BDF8" />
          <polygon points="115,1035 325,1135 415,1420 245,1300" fill="#2098D4" />
          <polygon points="325,1135 495,1180 415,1420" fill="#38BDF8" />
          <polygon points="495,1180 760,1060 600,1335 415,1420" fill="#0E77B5" />
          <polyline
            points="415,430 475,638 510,895 495,1180 415,1420"
            fill="none"
            stroke="rgba(255,255,255,0.48)"
            strokeWidth={2.5}
          />
        </g>

        {/* Rising underwater bubbles */}
        {Array.from({ length: 12 }, (_, i) => {
          const bx = 90 + hashSeed(i * 19 + 5) * 900;
          const by = 1480 - ((localFrame * (2.5 + (i % 3)) + i * 90) % 820);
          return <circle key={i} cx={bx} cy={by} r={3 + (i % 4) * 2} fill="#E0F2FE" opacity={0.42} />;
        })}

        {/* Animated Waterline */}
        <path
          d={`M 0 ${waterY + wave} Q 270 ${waterY - 16 - wave} 540 ${waterY + wave} T 1080 ${waterY + wave}`}
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={6}
        />
        <path
          d={`M 0 ${waterY + 13 + wave} Q 270 ${waterY - 3 - wave} 540 ${waterY + 13 + wave} T 1080 ${waterY + 13 + wave}`}
          fill="none"
          stroke="#BAE6FD"
          strokeWidth={2.5}
          opacity={0.75}
        />

        {/* Visible Tip Label */}
        <g opacity={appear(localFrame, 8, 12)}>
          <rect x={635} y={488} width={385} height={60} rx={30} fill="#0F172A" />
          <text x={827} y={526} textAnchor="middle" fill="#FFFFFF" fontSize={24} fontFamily={THAI_FONT_FAMILY} fontWeight={800}>
            สิ่งที่มองเห็น (10%)
          </text>
        </g>

        {/* Underwater Depth Layer Callout Pills (strictly y < 1510) */}
        {layers.map((label, idx) => {
          const ly = 845 + idx * 235;
          const rev = stagger(idx, localFrame, 9, 10, 14);
          return (
            <g key={idx} opacity={rev} transform={`translate(${(1 - rev) * 36}, 0)`}>
              <line
                x1={420}
                y1={ly}
                x2={550}
                y2={ly}
                stroke="#BAE6FD"
                strokeWidth={2.5}
                strokeDasharray="8 8"
              />
              <circle cx={420} cy={ly} r={8} fill="#FFFFFF" />
              <rect x={552} y={ly - 42} width={476} height={84} rx={22} fill="rgba(255,255,255,0.95)" />
              <text
                x={580}
                y={ly + 8}
                fill="#0C4A6E"
                fontSize={26}
                fontFamily={THAI_FONT_FAMILY}
                fontWeight={800}
              >
                {truncateText(label, 24)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Top Arctic Sky Headline */}
      <div
        style={{
          position: 'absolute',
          top: 92,
          left: 64,
          right: 64,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          opacity: headerIn,
        }}
      >
        {t.badge && (
          <div
            style={{
              padding: '6px 20px',
              borderRadius: 999,
              background: '#0C4A6E',
              color: '#E0F2FE',
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 22,
              fontWeight: 800,
            }}
          >
            {t.badge}
          </div>
        )}
        <FitText text={t.title} baseSize={54} minSize={34} maxLines={3} color="#0F172A" fontWeight={900} />
      </div>
    </div>
  );
};

const IcebergDiveDownShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, durationFrames }) => {
  const t = sceneTexts(scene);
  const layers = getFallbackItems(scene, [
    'ชั้นตื้น · อาการที่เห็นชัด',
    'ชั้นกลาง · ระบบและเงื่อนไข',
    'ชั้นลึก · ต้นตอที่ซ่อนอยู่',
  ]).slice(0, 4);

  const diveProg = easeOutCubic(clamp01(localFrame / Math.max(30, durationFrames * 0.78)));
  const panY = interpolate(diveProg, [0, 1], [0, -140]);
  const gaugeY = interpolate(diveProg, [0, 1], [430, 1340]);
  const currentDepthM = Math.round(diveProg * 300);
  const headerIn = appear(localFrame, 0, 14);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}>
        <defs>
          <linearGradient id={`i14-dive-sea-${sceneIndex}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0E6B94" />
            <stop offset="30%" stopColor="#094D7C" />
            <stop offset="68%" stopColor="#052E54" />
            <stop offset="100%" stopColor="#02152A" />
          </linearGradient>
        </defs>

        <rect width={STAGE_W} height={STAGE_H} fill={`url(#i14-dive-sea-${sceneIndex})`} />

        {/* Panning underwater iceberg cliff wall & light rays */}
        <g transform={`translate(0, ${panY.toFixed(1)})`}>
          {/* Subtle overhead shimmering water surface */}
          <path
            d={`M 0 330 Q 270 ${315 + Math.sin(localFrame * 0.08) * 10} 540 330 T 1080 330`}
            fill="none"
            stroke="#BAE6FD"
            strokeWidth={4}
            opacity={0.32}
          />

          {/* Colossal submerged iceberg cliff on right-center */}
          <polygon points="340,265 980,265 940,680 410,620" fill="#7DD3FC" opacity={0.35} />
          <polygon points="410,620 940,680 860,1150 320,1040" fill="#38BDF8" opacity={0.28} />
          <polygon points="320,1040 860,1150 680,1620 450,1520" fill="#0E77B5" opacity={0.32} />
          <polyline
            points="410,620 620,760 540,1120 680,1620"
            fill="none"
            stroke="rgba(186,230,253,0.4)"
            strokeWidth={2.5}
          />
        </g>

        {/* Left-edge Depth Meter Gauge */}
        <g>
          <line x1={108} y1={390} x2={108} y2={1410} stroke="rgba(186,230,253,0.35)" strokeWidth={5} strokeLinecap="round" />
          <line x1={108} y1={390} x2={108} y2={gaugeY} stroke="#7DD3FC" strokeWidth={7} strokeLinecap="round" />
          {[0, 100, 200, 300].map((m, i) => {
            const ty = 430 + i * 310;
            return (
              <g key={m}>
                <line x1={88} y1={ty} x2={126} y2={ty} stroke="#BAE6FD" strokeWidth={3} />
                <text x={78} y={ty + 7} textAnchor="end" fill="#BAE6FD" fontSize={19} fontFamily="monospace" fontWeight={700}>
                  -{m}m
                </text>
              </g>
            );
          })}
          {/* Animated submarine/diver depth tracker dot */}
          <circle cx={108} cy={gaugeY} r={16} fill="#38BDF8" stroke="#FFFFFF" strokeWidth={4} />
          <rect x={136} y={gaugeY - 22} width={114} height={44} rx={14} fill="#0284C7" />
          <text x={193} y={gaugeY + 7} textAnchor="middle" fill="#FFFFFF" fontSize={20} fontFamily="monospace" fontWeight={900}>
            -{currentDepthM}m
          </text>
        </g>

        {/* Rising bubbles */}
        {Array.from({ length: 14 }, (_, i) => {
          const bx = 260 + hashSeed(i * 23 + 11) * 760;
          const by = 1520 - ((localFrame * (3.5 + (i % 3)) + i * 80) % 1120);
          return <circle key={i} cx={bx} cy={by} r={3 + (i % 3) * 2.5} fill="#E0F2FE" opacity={0.35} />;
        })}
      </svg>

      {/* Top Compact Header */}
      <div
        style={{
          position: 'absolute',
          top: 90,
          left: 64,
          right: 64,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          opacity: headerIn,
        }}
      >
        <div
          style={{
            padding: '6px 20px',
            borderRadius: 999,
            background: 'rgba(125,211,252,0.2)',
            border: '2px solid #7DD3FC',
            color: '#E0F2FE',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 22,
            fontWeight: 800,
          }}
        >
          {t.badge || 'DEEP DIVE · ดำดิ่งทีละชั้น'}
        </div>
        <FitText text={t.title} baseSize={50} minSize={32} maxLines={3} color="#FFFFFF" fontWeight={900} />
      </div>

      {/* Depth Layer Cards lighting up as dive descends (strictly y < 1540) */}
      <div
        style={{
          position: 'absolute',
          top: 410,
          left: 272,
          right: 60,
          maxHeight: SAFE_BOTTOM - 420,
          display: 'flex',
          flexDirection: 'column',
          gap: 32,
        }}
      >
        {layers.map((layer, idx) => {
          const rev = stagger(idx, localFrame, 10, 8, 16);
          const depthLabel = `DEPTH 0${idx + 1} · -${(idx + 1) * 75}m`;
          return (
            <div
              key={idx}
              style={{
                background: 'rgba(4, 31, 61, 0.78)',
                border: '2px solid rgba(125, 211, 252, 0.55)',
                borderLeft: '8px solid #38BDF8',
                borderRadius: 22,
                padding: '22px 28px',
                boxShadow: '0 14px 36px rgba(2, 16, 36, 0.45)',
                opacity: rev,
                transform: `translateY(${(1 - rev) * 28}px)`,
              }}
            >
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: 18,
                  fontWeight: 800,
                  color: '#7DD3FC',
                  letterSpacing: 2,
                  marginBottom: 8,
                }}
              >
                {depthLabel}
              </div>
              <FitText text={layer} baseSize={32} minSize={22} maxLines={2} color="#F0F9FF" fontWeight={800} align="left" />
            </div>
          );
        })}
      </div>
    </div>
  );
};

const IcebergHiddenLabelsShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame }) => {
  const t = sceneTexts(scene);
  const items = getFallbackItems(scene, [
    'ปัจจัยที่มองไม่เห็นจากผิวน้ำ',
    'กลไกการทำงานใต้ฐาน',
    'ต้นทุนเวลาและความพยายาม',
  ]).slice(0, 3);

  const sonarR = 90 + ((localFrame * 7) % 340);
  const sonarOp = Math.max(0, 0.45 * (1 - (sonarR - 90) / 340));
  const headerIn = appear(localFrame, 0, 14);

  // Anchor points on the x-ray iceberg for 3 labels (safely above subtitle bar)
  const anchors: Array<{ ax: number; ay: number; bx: number; by: number; alignRight: boolean }> = [
    { ax: 495, ay: 650, bx: 74, by: 565, alignRight: false },
    { ax: 620, ay: 890, bx: 586, by: 835, alignRight: true },
    { ax: 470, ay: 1125, bx: 74, by: 1095, alignRight: false },
  ];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}>
        <defs>
          <radialGradient id={`i14-xray-bg-${sceneIndex}`} cx="50%" cy="52%" r="68%">
            <stop offset="0%" stopColor="#0C4A6E" />
            <stop offset="65%" stopColor="#062847" />
            <stop offset="100%" stopColor="#021224" />
          </radialGradient>
        </defs>

        <rect width={STAGE_W} height={STAGE_H} fill={`url(#i14-xray-bg-${sceneIndex})`} />

        {/* Subtle sonar coordinate grid */}
        <g stroke="#38BDF8" strokeOpacity={0.12} strokeWidth={1.2}>
          <circle cx={540} cy={920} r={220} fill="none" />
          <circle cx={540} cy={920} r={390} fill="none" />
          <line x1={540} y1={420} x2={540} y2={1460} />
          <line x1={120} y1={920} x2={960} y2={920} />
        </g>

        {/* Animated sonar ping ring */}
        <circle cx={540} cy={920} r={sonarR} fill="none" stroke="#7DD3FC" strokeWidth={3} opacity={sonarOp} />

        {/* X-Ray Wireframe Low-Poly Iceberg Core */}
        <g stroke="#7DD3FC" strokeWidth={2.5} strokeLinejoin="round">
          {/* Small above-water tip */}
          <polygon points="445,540 530,415 615,540" fill="rgba(240,249,255,0.22)" />
          {/* Submerged glowing facets */}
          <polygon points="445,540 615,540 735,765 555,830 335,755" fill="rgba(56,189,248,0.16)" />
          <polygon points="335,755 555,830 495,1120 295,995" fill="rgba(14,165,233,0.20)" />
          <polygon points="555,830 735,765 765,1035 495,1120" fill="rgba(2,132,199,0.24)" />
          <polygon points="295,995 495,1120 535,1375 375,1255" fill="rgba(7,89,133,0.32)" />
          <polygon points="495,1120 765,1035 645,1275 535,1375" fill="rgba(3,105,161,0.32)" />
          {/* Internal ridge lines */}
          <line x1={530} y1={415} x2={555} y2={830} stroke="#E0F2FE" strokeWidth={2} />
          <line x1={555} y1={830} x2={495} y2={1120} stroke="#E0F2FE" strokeWidth={2} />
          <line x1={495} y1={1120} x2={535} y2={1375} stroke="#E0F2FE" strokeWidth={2} />
        </g>

        {/* Waterline dashed reference */}
        <line x1={64} y1={540} x2={1016} y2={540} stroke="#BAE6FD" strokeWidth={2.5} strokeDasharray="12 10" opacity={0.65} />

        {/* Precision Leader Lines & Glowing Nodes */}
        {items.map((_, idx) => {
          const a = anchors[idx];
          const rev = stagger(idx, localFrame, 10, 10, 14);
          const targetX = a.alignRight ? a.bx : a.bx + 420;
          return (
            <g key={idx} opacity={rev}>
              <line
                x1={a.ax}
                y1={a.ay}
                x2={targetX}
                y2={a.by + 48}
                stroke="#7DD3FC"
                strokeWidth={3}
                strokeDasharray="8 6"
              />
              <circle cx={a.ax} cy={a.ay} r={14} fill="#38BDF8" opacity={0.35} />
              <circle cx={a.ax} cy={a.ay} r={7} fill="#FFFFFF" />
            </g>
          );
        })}
      </svg>

      {/* Top Headline */}
      <div
        style={{
          position: 'absolute',
          top: 96,
          left: 64,
          right: 64,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          opacity: headerIn,
        }}
      >
        <div
          style={{
            padding: '6px 22px',
            borderRadius: 999,
            background: 'rgba(56,189,248,0.18)',
            border: '2px solid #7DD3FC',
            color: '#E0F2FE',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 22,
            fontWeight: 800,
          }}
        >
          {t.badge || 'X-RAY SCAN · สิ่งที่ซ่อนอยู่'}
        </div>
        <FitText text={t.title} baseSize={54} minSize={34} maxLines={3} color="#FFFFFF" fontWeight={900} />
      </div>

      {/* Floating Annotation Cards positioned cleanly left/right (y < 1540) */}
      {items.map((item, idx) => {
        const a = anchors[idx];
        const rev = stagger(idx, localFrame, 10, 10, 14);
        return (
          <div
            key={idx}
            style={{
              position: 'absolute',
              top: a.by,
              left: a.bx,
              width: 420,
              background: 'rgba(2, 24, 48, 0.90)',
              border: '2px solid #38BDF8',
              borderRadius: 20,
              padding: '16px 22px',
              boxShadow: '0 12px 30px rgba(0, 0, 0, 0.42)',
              opacity: rev,
              transform: `scale(${0.92 + rev * 0.08})`,
            }}
          >
            <div style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 800, color: '#7DD3FC', marginBottom: 4 }}>
              HIDDEN #{idx + 1}
            </div>
            <FitText text={item} baseSize={27} minSize={20} maxLines={3} color="#F0F9FF" fontWeight={700} align="left" />
          </div>
        );
      })}
    </div>
  );
};

const IcebergTipOnlyShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps }) => {
  const t = sceneTexts(scene);
  const waterY = 1125;
  const wave = Math.sin(localFrame * 0.065) * 8;
  const qBob = Math.sin(localFrame * 0.14) * 10;
  const qPop = spring({
    frame: Math.max(0, localFrame - 10),
    fps,
    config: { damping: 12, stiffness: 150 },
  });
  const headerIn = appear(localFrame, 0, 14);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}>
        <defs>
          <linearGradient id={`i14-tip-sky-${sceneIndex}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F5FBFF" />
            <stop offset="55%" stopColor="#DDF1FC" />
            <stop offset="100%" stopColor="#B8E0F7" />
          </linearGradient>
          <linearGradient id={`i14-tip-sea-${sceneIndex}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1D95C9" />
            <stop offset="50%" stopColor="#084C7F" />
            <stop offset="100%" stopColor="#031D38" />
          </linearGradient>
        </defs>

        {/* Wide Open Arctic Sky */}
        <rect x={0} y={0} width={STAGE_W} height={waterY} fill={`url(#i14-tip-sky-${sceneIndex})`} />
        {/* Deep Calm Ocean below */}
        <rect x={0} y={waterY} width={STAGE_W} height={STAGE_H - waterY} fill={`url(#i14-tip-sea-${sceneIndex})`} />

        {/* Subtle drifting arctic clouds */}
        <g opacity={0.55} fill="#FFFFFF">
          <ellipse cx={210 + localFrame * 0.35} cy={595} rx={125} ry={28} />
          <ellipse cx={860 - localFrame * 0.25} cy={670} rx={145} ry={30} />
        </g>

        {/* Faint mysterious silhouette hinting at massive unseen base below */}
        <polygon points="340,1125 740,1125 890,1540 190,1540" fill="#031930" opacity={0.34} />

        {/* Small Crisp Faceted Snow Tip poking above water */}
        <g>
          <polygon points="365,1128 520,865 575,1128" fill="#FFFFFF" />
          <polygon points="520,865 655,965 575,1128" fill="#DFF2FD" />
          <polygon points="655,965 735,1128 575,1128" fill="#B6E1F8" />
          <polygon points="365,1128 438,990 520,865" fill="#F8FCFF" />
        </g>

        {/* Tiny Explorer Figure standing on the summit with red parka */}
        <g transform="translate(520, 865)">
          {/* Shadow */}
          <ellipse cx={0} cy={4} rx={16} ry={5} fill="#64748B" opacity={0.4} />
          {/* Legs */}
          <line x1={-5} y1={0} x2={-7} y2={-22} stroke="#0F172A" strokeWidth={5} strokeLinecap="round" />
          <line x1={5} y1={0} x2={7} y2={-22} stroke="#0F172A" strokeWidth={5} strokeLinecap="round" />
          {/* Red Arctic Parka */}
          <path d="M -13 -20 L 13 -20 L 9 -48 L -9 -48 Z" fill="#EF4444" />
          {/* Head */}
          <circle cx={0} cy={-58} r={10} fill="#1E293B" />
          {/* Floating Question Mark above explorer */}
          <g transform={`translate(34, ${(-92 + qBob).toFixed(1)}) scale(${qPop.toFixed(3)})`}>
            <circle cx={0} cy={0} r={34} fill="#0F172A" />
            <text x={0} y={13} textAnchor="middle" fill="#7DD3FC" fontSize={40} fontFamily={THAI_FONT_FAMILY} fontWeight={900}>
              ?
            </text>
          </g>
        </g>

        {/* Gentle Animated Waterline */}
        <path
          d={`M 0 ${waterY + wave} Q 270 ${waterY - 14 - wave} 540 ${waterY + wave} T 1080 ${waterY + wave}`}
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={6}
        />
        <path
          d={`M 0 ${waterY + 14 + wave} Q 270 ${waterY - 2 - wave} 540 ${waterY + 14 + wave} T 1080 ${waterY + 14 + wave}`}
          fill="none"
          stroke="#BAE6FD"
          strokeWidth={2.5}
          opacity={0.75}
        />

        {/* Gentle drifting snowflakes */}
        {Array.from({ length: 14 }, (_, i) => {
          const sx = (hashSeed(i * 29 + 3) * STAGE_W + localFrame * 0.8) % STAGE_W;
          const sy = (hashSeed(i * 41 + 7) * 980 + localFrame * 1.4) % 1020;
          return <circle key={i} cx={sx} cy={sy} r={3 + (i % 3)} fill="#FFFFFF" opacity={0.75} />;
        })}
      </svg>

      {/* Big Question / Headline in Open Arctic Sky */}
      <div
        style={{
          position: 'absolute',
          top: 120,
          left: 72,
          right: 72,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 18,
          opacity: headerIn,
          transform: `translateY(${(1 - headerIn) * 24}px)`,
        }}
      >
        <div
          style={{
            padding: '8px 24px',
            borderRadius: 999,
            background: '#0F172A',
            color: '#7DD3FC',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 22,
            fontWeight: 800,
          }}
        >
          {t.badge || 'TIP OF THE ICEBERG · แค่ยอดที่เห็น'}
        </div>
        <FitText text={t.title} baseSize={58} minSize={36} maxLines={3} color="#0F172A" fontWeight={900} />
        {t.subtitle && (
          <div style={{ maxWidth: 860, marginTop: 6 }}>
            <FitText text={t.subtitle} baseSize={32} minSize={22} maxLines={3} color="#334155" fontWeight={600} />
          </div>
        )}
      </div>

      {/* Subtle Bottom Teaser Strip Underwater (strictly above subtitle bar) */}
      <div
        style={{
          position: 'absolute',
          top: 1265,
          left: 80,
          right: 80,
          maxHeight: 105,
          display: 'flex',
          justifyContent: 'center',
          opacity: appear(localFrame, 14, 16),
        }}
      >
        <div
          style={{
            background: 'rgba(3, 29, 56, 0.72)',
            border: '2px solid rgba(125, 211, 252, 0.42)',
            borderRadius: 22,
            padding: '16px 32px',
          }}
        >
          <FitText
            text={t.bullets[0] || 'แต่ความจริงอีก 90% ยังซ่อนอยู่ใต้ผิวน้ำ...'}
            baseSize={30}
            minSize={22}
            maxLines={2}
            color="#E0F2FE"
            fontWeight={700}
          />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// StyleDirector Definitions Export (BATCH_B)
// ============================================================================

export const BATCH_B: StyleDirectorDef[] = [
  {
    styleId: 'look-11',
    shots: {
      'cash-tower': MoneyCashTowerShot,
      'coin-rain': MoneyCoinRainShot,
      'piggy-bank': MoneyPiggyBankShot,
      'debt-pit': MoneyDebtPitShot,
      'gold-vault': MoneyGoldVaultShot,
      'money-scale': MoneyScaleShot,
      'cash-conveyor': MoneyCashConveyorShot,
    },
    shotLabels: {
      'cash-tower': 'กองธนบัตรซ้อนสูง',
      'coin-rain': 'เหรียญทองโปรยลงโถ',
      'piggy-bank': 'กระปุกออมสิน',
      'debt-pit': 'หลุมหนี้กับบันไดกองเงิน',
      'gold-vault': 'ตู้เซฟประตูกลมกับแท่งทอง',
      'money-scale': 'ตาชั่งสองแขนเทียบมูลค่า',
      'cash-conveyor': 'สายพานโรงงานคัดแยกธนบัตร',
    },
    infer: (scene) => {
      const h = sceneHaystack(scene);
      const vis = typeof scene.visual === 'string' ? scene.visual : scene.visual?.type;
      if (vis === 'compare' || /เทียบ|vs|ต่าง/.test(h)) return 'money-scale';
      if (vis === 'steps' || /ขั้น|กลไก|อัตโนมัติ|ระบบ/.test(h)) return 'cash-conveyor';
      if (/ปลอดภัย|กฎ|ป้องกัน|เกราะ|สิทธิ์/.test(h)) return 'gold-vault';
      if (/หนี้|ติดลบ|ขาดทุน|ดอกเบี้ย|จ่ายเกิน|ผ่อน|หลุม/.test(h)) return 'debt-pit';
      if (/ออม|เก็บเงิน|กระปุก|ฉุกเฉิน|สำรอง|ประหยัด/.test(h)) return 'piggy-bank';
      if (/เหรียญ|สะสม|ปันผล|%|เปอร์เซ็นต์|ทีละนิด|ทุกวัน/.test(h)) return 'coin-rain';
      if (vis === 'stat' || /ล้าน|แสน|หมื่น|พัน|บาท|รายได้|กำไร|มูลค่า|กอง/.test(h)) return 'cash-tower';
      return null;
    },
  },
  {
    styleId: 'look-13',
    shots: {
      'receipt-print': ReceiptPrintShot,
      'itemized-zoom': ReceiptItemizedZoomShot,
      'total-stamp': ReceiptTotalStampShot,
      crumple: ReceiptCrumpleShot,
    },
    shotLabels: {
      'receipt-print': 'เครื่องพิมพ์ใบเสร็จ',
      'itemized-zoom': 'ซูมรายการวงปากกาแดง',
      'total-stamp': 'ยอดรวมพร้อมตราประทับ',
      crumple: 'ขยำใบเสร็จลงถัง',
    },
    infer: (scene) => {
      const h = sceneHaystack(scene);
      if (scene.visual === 'quote' || /ทิ้ง|ขยำ|เลิก|ตัดทิ้ง|บทเรียน|สรุป|ข้อคิด|พลาด/.test(h)) return 'crumple';
      if (scene.visual === 'stat' || /รวม|ทั้งหมด|สุทธิ|จ่ายแล้ว|เกินงบ|total|paid/.test(h)) return 'total-stamp';
      if (scene.visual === 'compare' || /แพง|หนักสุด|แฝง|จุด|เทียบ|สูงสุด/.test(h)) return 'itemized-zoom';
      if (scene.visual === 'bullets' || scene.visual === 'steps' || /ค่าใช้จ่าย|บิล|ใบเสร็จ|รายการ|ขั้นตอน/.test(h)) {
        return 'receipt-print';
      }
      return null;
    },
  },
  {
    styleId: 'look-14',
    shots: {
      'iceberg-reveal': IcebergRevealShot,
      'dive-down': IcebergDiveDownShot,
      'hidden-labels': IcebergHiddenLabelsShot,
      'tip-only': IcebergTipOnlyShot,
    },
    shotLabels: {
      'iceberg-reveal': 'ผิวน้ำแบ่งจอเผยฐานใต้น้ำ',
      'dive-down': 'ดำดิ่งเปิดชั้นความลึก',
      'hidden-labels': 'ชี้ป้ายส่วนที่ซ่อนอยู่',
      'tip-only': 'ยอดน้ำแข็งเหนือผิวน้ำ',
    },
    infer: (scene) => {
      const h = sceneHaystack(scene);
      if (/ทำไม|จริงหรือ|สงสัย|คำถาม|แค่ยอด|ผิวเผิน|มองเห็น|ภายนอก|\?/.test(h)) return 'tip-only';
      if (scene.visual === 'steps' || /ชั้น|ระดับ|ลึก|ขั้นตอน|สเต็ป|เจาะลึก|ลงลึก/.test(h)) return 'dive-down';
      if (scene.visual === 'bullets' || /รายละเอียด|องค์ประกอบ|สาเหตุ|ปัจจัย|รายการ/.test(h)) return 'hidden-labels';
      if (/ซ่อน|เบื้องหลัง|ความลับ|ภูเขาน้ำแข็ง|แท้จริง|ใต้น้ำ/.test(h)) return 'iceberg-reveal';
      return null;
    },
  },
];
