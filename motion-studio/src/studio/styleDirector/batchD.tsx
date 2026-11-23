import React from 'react';
import { interpolate, spring } from 'remotion';
import { THAI_FONT_FAMILY } from '../../components/ThaiFontLoader';
import type { StudioScene } from '../types';
import { FitText as BaseFitText, SAFE_BOTTOM, STAGE_H, STAGE_W, appear, sceneTexts, stagger } from './kit';
import type { FitTextProps } from './kit';
import type { StyleDirectorDef, StyleShotArgs } from './types';

const CONTENT_BOTTOM = SAFE_BOTTOM - 120; // 1420 — keep all cards/text strictly above subtitle zone (y≈1440–1600)

/**
 * Thai-safe proportional font-size wrapper around kit FitText.
 * Prevents kit's computeTitleSize() 40–44px floor from inflating small card/bullet text
 * when Thai sentences exceed 34 characters.
 */
function computeSafeFontSizeD(text: string, baseSize: number, minSize: number): number {
  const len = String(text || '').trim().length;
  let size = baseSize;
  if (baseSize >= 70) {
    if (len > 14) size = Math.round(baseSize * 0.56);
    else if (len > 9) size = Math.round(baseSize * 0.72);
    else if (len > 6) size = Math.round(baseSize * 0.86);
  } else if (baseSize >= 46) {
    if (len > 55) size = baseSize - 14;
    else if (len > 40) size = baseSize - 9;
    else if (len > 28) size = baseSize - 4;
  } else {
    if (len > 95) size = baseSize - 6;
    else if (len > 65) size = baseSize - 4;
    else if (len > 44) size = baseSize - 2;
    else if (len > 30) size = baseSize - 1;
  }
  return Math.max(minSize, Math.min(baseSize, size));
}

const FitText: React.FC<FitTextProps> = ({
  text,
  baseSize = 48,
  minSize = 24,
  lineHeight = 1.3,
  style,
  ...rest
}) => {
  const safeSize = computeSafeFontSizeD(text, baseSize, minSize);
  return (
    <BaseFitText
      text={text}
      baseSize={baseSize}
      minSize={minSize}
      lineHeight={Math.max(1.28, lineHeight)}
      style={{ fontSize: safeSize, ...style }}
      {...rest}
    />
  );
};

// ============================================================================
// SHARED CONTENT EXTRACTION HELPERS (Batch D — Pure, Deterministic, Zero Deps)
// ============================================================================

const YEAR_OR_DATE_RE_D =
  /(?:1[5-9]\d{2}|20\d{2}|25\d{2}|พ\.ศ\.\s*\d+|ค\.ศ\.\s*\d+|ปี\s*\d+|วันที่\s*\d+|ศตวรรษ|ยุค|ล้านปี|พันล้านปี|แสนปี|หมื่นปี)/i;
const STEP_RE_D =
  /(?:ขั้นตอน|สเต็ป|ลำดับ|วิธี|เส้นทาง|กลยุทธ์|แผน|ภารกิจ|เช็กพอยต์|ด่าน|เฟส|จาก.+สู่|step|phase|route)/i;
const SUMMARY_RE_D =
  /(?:สรุป|สำคัญ|ไฮไลต์|ประโยคจำ|จำไว้|หัวใจ|แก่น|บทเรียน|จารึก|อนุสาวรีย์|คำคม|มรดก|บทสรุป)/i;
const COMPARE_RE_D =
  /(?:เทียบ|เปรียบเทียบ|ปะทะ|สงคราม|รบ|สองฝ่าย|แย่งชิง|ฝ่าย.+ฝ่าย|ตอนนั้น|ตอนนี้|อดีต|ปัจจุบัน|ต่างกัน|ตรงข้าม|vs)/i;

function haystackOfD(scene: StudioScene): string {
  const t = sceneTexts(scene);
  const hl = Array.isArray(scene.highlight) ? scene.highlight.join(' ') : String(scene.highlight || '');
  const cmp = scene.compare
    ? [
        scene.compare.leftTitle,
        scene.compare.rightTitle,
        ...(scene.compare.leftItems || []),
        ...(scene.compare.rightItems || []),
      ].join(' ')
    : '';
  return [
    t.badge,
    t.title,
    t.subtitle,
    hl,
    ...t.bullets,
    scene.stat?.label || '',
    scene.stat?.delta || '',
    scene.quote?.text || '',
    cmp,
  ].join(' ');
}

function extractPointsD(scene: StudioScene, max = 4): string[] {
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

function extractShortPointsD(scene: StudioScene, max = 4): string[] {
  const t = sceneTexts(scene);
  const out: string[] = [];

  if (Array.isArray(scene.steps) && scene.steps.length > 0) {
    for (const s of scene.steps) {
      const txt = typeof s === 'string' ? s.trim() : String(s?.title || '').trim();
      if (txt) out.push(txt);
    }
  } else if (t.bullets.length > 0) {
    out.push(...t.bullets);
  } else if (scene.stat) {
    const valStr = `${scene.stat.prefix || ''}${scene.stat.value ?? ''}${scene.stat.suffix || ''}`.trim();
    if (valStr && scene.stat.unit) out.push(`${valStr} ${scene.stat.unit}`.trim());
    if (scene.stat.label) out.push(scene.stat.label);
    if (scene.stat.delta) out.push(scene.stat.delta);
  } else if (scene.quote?.text) {
    out.push(scene.quote.text);
    if (scene.quote.author) out.push(scene.quote.author);
  } else if (t.subtitle) {
    out.push(t.subtitle);
  }

  if (out.length === 0 && t.title) out.push(t.title);
  return out.slice(0, max);
}

function extractPrimaryMetricD(scene: StudioScene, sceneIndex: number): { big: string; unit: string; label: string } {
  const t = sceneTexts(scene);
  if (scene.stat?.value !== undefined && String(scene.stat.value).trim()) {
    const prefix = String(scene.stat.prefix || '');
    const suffix = String(scene.stat.suffix || '');
    const raw = String(scene.stat.value).trim();
    const big = `${prefix}${raw}${suffix}`;
    return {
      big,
      unit: String(scene.stat.unit || scene.stat.delta || '').trim(),
      label: String(scene.stat.label || t.subtitle || t.title).trim(),
    };
  }
  const bigTimeMatch = haystackOfD(scene).match(/\d+(?:[.,]\d+)?\s*(?:พันล้านปี|ล้านปี|แสนปี|หมื่นปี|ปีแสง|ล้าน|เท่า|%)/);
  if (bigTimeMatch) {
    return {
      big: bigTimeMatch[0].trim(),
      unit: t.badge || 'สเกลสำคัญ',
      label: t.subtitle || t.title,
    };
  }
  const yearMatch = haystackOfD(scene).match(/(?:1[5-9]\d{2}|20\d{2}|25\d{2})/);
  if (yearMatch) {
    return {
      big: yearMatch[0],
      unit: t.badge || 'จุดเปลี่ยนประวัติศาสตร์',
      label: t.subtitle || t.title,
    };
  }
  if (t.numbers.length > 0) {
    return {
      big: t.numbers[0],
      unit: t.badge || `เป้าหมาย ${sceneIndex + 1}`,
      label: t.subtitle || t.title,
    };
  }
  const hl = Array.isArray(scene.highlight) ? scene.highlight[0] : scene.highlight;
  if (hl && String(hl).trim().length <= 14) {
    return {
      big: String(hl).trim(),
      unit: t.badge || 'ข้อมูลหลัก',
      label: t.subtitle || t.title,
    };
  }
  return {
    big: String(sceneIndex + 1).padStart(2, '0'),
    unit: t.badge || 'ข้อมูลสำคัญ',
    label: t.subtitle || t.title,
  };
}

function extractStepLabelD(scene: StudioScene, idx: number, prefix = '0'): string {
  if (Array.isArray(scene.steps) && scene.steps[idx] && typeof scene.steps[idx] !== 'string') {
    const s = scene.steps[idx] as { step?: string };
    if (s.step && s.step.trim()) return s.step.trim();
  }
  const pt = extractShortPointsD(scene, 4)[idx] || '';
  const m = pt.match(/(?:1[5-9]\d{2}|20\d{2}|25\d{2}|พ\.ศ\.\s*\d+|ค\.ศ\.\s*\d+|ปี\s*\d+|ขั้นที่\s*\d+)/);
  if (m) return m[0];
  return prefix === '0' ? String(idx + 1).padStart(2, '0') : `${prefix}${idx + 1}`;
}

function extractEraEntriesD(scene: StudioScene, max = 4): Array<{ tag: string; text: string }> {
  const out: Array<{ tag: string; text: string }> = [];
  if (Array.isArray(scene.steps) && scene.steps.length > 0) {
    scene.steps.slice(0, max).forEach((s, i) => {
      if (typeof s === 'string') {
        const m = s.match(/^(?:(?:พ\.ศ\.|ค\.ศ\.)?\s*\d{2,4}|\d+(?:[.,]\d+)?\s*(?:พันล้านปี|ล้านปี|ปี))/);
        out.push({
          tag: m ? m[0].trim() : `ยุค ${String(i + 1).padStart(2, '0')}`,
          text: s.trim(),
        });
      } else {
        const txt = s.detail ? `${s.title} — ${s.detail}` : s.title;
        out.push({
          tag: s.step?.trim() || `ยุค ${String(i + 1).padStart(2, '0')}`,
          text: txt.trim(),
        });
      }
    });
    return out;
  }

  const pts = extractPointsD(scene, max);
  pts.forEach((pt, i) => {
    const m = pt.match(/(?:พ\.ศ\.\s*\d+|ค\.ศ\.\s*\d+|1[5-9]\d{2}|20\d{2}|25\d{2}|\d+(?:[.,]\d+)?\s*(?:พันล้านปี|ล้านปี|แสนปี|ปี))/);
    out.push({
      tag: m ? m[0].trim() : `ช่วงที่ ${String(i + 1).padStart(2, '0')}`,
      text: pt,
    });
  });
  return out;
}

function extractCompareSidesD(scene: StudioScene): {
  leftTitle: string;
  rightTitle: string;
  leftItems: string[];
  rightItems: string[];
  winner?: 'left' | 'right';
} {
  if (scene.compare) {
    return {
      leftTitle: scene.compare.leftTitle || scene.compare.leftLabel || 'ฝ่ายที่ 1',
      rightTitle: scene.compare.rightTitle || scene.compare.rightLabel || 'ฝ่ายที่ 2',
      leftItems: (scene.compare.leftItems || []).slice(0, 3),
      rightItems: (scene.compare.rightItems || []).slice(0, 3),
      winner: scene.compare.winner,
    };
  }
  const pts = extractShortPointsD(scene, 4);
  const mid = Math.max(1, Math.ceil(pts.length / 2));
  const leftItems = pts.slice(0, mid);
  const rightItems = pts.slice(mid);
  return {
    leftTitle: 'แนวรุกฝั่งซ้าย',
    rightTitle: 'แนวต้านฝั่งขวา',
    leftItems: leftItems.length > 0 ? leftItems : [sceneTexts(scene).title],
    rightItems: rightItems.length > 0 ? rightItems : [sceneTexts(scene).subtitle || 'จุดเปลี่ยนยุทธศาสตร์'],
  };
}

function extractQuoteD(scene: StudioScene): { main: string; sub: string; badge: string } {
  const t = sceneTexts(scene);
  if (scene.quote?.text) {
    return {
      main: scene.quote.text.trim(),
      sub: [scene.quote.author, scene.quote.role || scene.quote.source].filter(Boolean).join(' • '),
      badge: t.badge || 'จารึกบทสรุป',
    };
  }
  const hl = Array.isArray(scene.highlight) ? scene.highlight[0] : scene.highlight;
  const pts = extractShortPointsD(scene, 2);
  return {
    main: t.title || pts[0] || '',
    sub: t.subtitle || (hl ? String(hl) : pts[0] || ''),
    badge: t.badge || 'บทสรุปประวัติศาสตร์',
  };
}

function pickHexD(candidate: unknown, fallback: string): string {
  if (typeof candidate === 'string' && /^#[0-9a-fA-F]{6}$/.test(candidate.trim())) {
    return candidate.trim();
  }
  return fallback;
}

// ============================================================================
// STYLE 1: look-3 — HOLOGRAM (โฮโลแกรม)
// World: Deep command chamber, luminous blue-cyan holographic projections,
// wireframe geometry, volumetric emitter cones, scanlines & tactical HUD.
// ============================================================================

const HOLO_BG_STARS: ReadonlyArray<[number, number, number]> = [
  [92, 148, 1.8],
  [215, 290, 2.2],
  [880, 175, 2.0],
  [990, 340, 1.6],
  [125, 640, 1.7],
  [960, 710, 2.1],
  [140, 1180, 1.9],
  [930, 1260, 2.0],
  [310, 1460, 1.5],
  [790, 1495, 1.8],
];

const HoloBackdropD: React.FC<{
  localFrame: number;
  bgBase?: string;
  glowX?: number;
  glowY?: number;
  showFloorGrid?: boolean;
}> = ({ localFrame, bgBase = '#060D1E', glowX = 540, glowY = 720, showFloorGrid = true }) => {
  const scanY = ((localFrame * 9) % (STAGE_H + 160)) - 80;
  const gridShift = (localFrame * 0.9) % 48;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(circle at ${glowX}px ${glowY}px, rgba(0, 229, 255, 0.22) 0%, rgba(14, 116, 184, 0.14) 36%, ${bgBase} 74%, #030712 100%)`,
      }}
    >
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {/* Fine vertical/horizontal holographic grid */}
        {Array.from({ length: 13 }).map((_, i) => (
          <line key={`v-${i}`} x1={i * 90} y1={0} x2={i * 90} y2={STAGE_H} stroke="#0EA5E9" strokeWidth={1} opacity={0.08} />
        ))}
        {Array.from({ length: 22 }).map((_, i) => (
          <line key={`h-${i}`} x1={0} y1={i * 90} x2={STAGE_W} y2={i * 90} stroke="#0EA5E9" strokeWidth={1} opacity={0.07} />
        ))}

        {/* Perspective floor projection wireframe */}
        {showFloorGrid ? (
          <g opacity={0.22}>
            {Array.from({ length: 9 }).map((_, i) => {
              const topX = 240 + i * 75;
              const botX = -180 + i * 180;
              return <line key={`pf-${i}`} x1={topX} y1={1240} x2={botX} y2={1820} stroke="#38BDF8" strokeWidth={1.5} />;
            })}
            {[0, 1, 2, 3, 4, 5, 6].map((i) => {
              const y = 1255 + i * 72 + gridShift * 0.45;
              return <line key={`ph-${i}`} x1={0} y1={y} x2={STAGE_W} y2={y} stroke="#00E5FF" strokeWidth={1.2} opacity={0.55 - i * 0.06} />;
            })}
          </g>
        ) : null}

        {/* Ambient floating hologram data motes */}
        {HOLO_BG_STARS.map(([x, y, r], i) => {
          const op = 0.28 + 0.42 * Math.sin(localFrame * 0.09 + i * 1.4);
          return <circle key={i} cx={x} cy={y} r={r} fill="#67E8F9" opacity={op} />;
        })}

        {/* Corner HUD brackets */}
        <g stroke="#38BDF8" strokeWidth={2.5} fill="none" opacity={0.55}>
          <path d="M 38 86 L 38 42 L 82 42" />
          <path d="M 1042 86 L 1042 42 L 998 42" />
          <path d={`M 38 ${CONTENT_BOTTOM - 34} L 38 ${CONTENT_BOTTOM} L 82 ${CONTENT_BOTTOM}`} />
          <path d={`M 1042 ${CONTENT_BOTTOM - 34} L 1042 ${CONTENT_BOTTOM} L 998 ${CONTENT_BOTTOM}`} />
        </g>

        {/* Sweeping holographic scanline beam */}
        <rect x={0} y={scanY} width={STAGE_W} height={4} fill="#67E8F9" opacity={0.24} />
        <rect x={0} y={scanY - 26} width={STAGE_W} height={26} fill="#00E5FF" opacity={0.05} />
      </svg>

      {/* Subtle CRT / hologram horizontal scanline overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(103, 232, 249, 0.055) 0px, rgba(103, 232, 249, 0.055) 1px, transparent 1px, transparent 5px)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};

/** look-3 Shot 1: holo-table — โต๊ะฉายโฮโลแกรม 3 มิติหมุนได้พร้อมโนดประเด็นลอยรอบแกน */
const HoloTableShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const t = sceneTexts(scene);
  const points = extractShortPointsD(scene, 4);
  const bgBase = pickHexD(tokens?.palette?.bg, '#060D1E');
  const fgColor = pickHexD(tokens?.palette?.fg, '#F0F9FF');

  const tableP = spring({ frame: localFrame, fps, config: { damping: 16, stiffness: 120 } });
  const titleP = appear(localFrame, 2, 14);
  const rotRad = localFrame * 0.036;
  const cx = 540;
  const coreCy = 665;

  // 3D wireframe octahedron vertices projected into 2D
  const ringR = 154;
  const tiltY = 0.44;
  const eqPts: Array<[number, number]> = [0, 1, 2, 3].map((k) => {
    const a = rotRad + (k * Math.PI) / 2;
    return [cx + Math.cos(a) * ringR, coreCy + Math.sin(a) * ringR * tiltY];
  });
  const topPole: [number, number] = [cx, coreCy - 172];
  const botPole: [number, number] = [cx, coreCy + 172];

  // Inner counter-rotating cube prism vertices
  const innerR = 80;
  const innerTop: Array<[number, number]> = [0, 1, 2, 3].map((k) => {
    const a = -rotRad * 1.3 + (k * Math.PI) / 2 + Math.PI / 4;
    return [cx + Math.cos(a) * innerR, coreCy - 50 + Math.sin(a) * innerR * tiltY];
  });
  const innerBot: Array<[number, number]> = [0, 1, 2, 3].map((k) => {
    const a = -rotRad * 1.3 + (k * Math.PI) / 2 + Math.PI / 4;
    return [cx + Math.cos(a) * innerR, coreCy + 50 + Math.sin(a) * innerR * tiltY];
  });

  // Floating satellite node slots positioned around the 3D hologram (all strictly above CONTENT_BOTTOM=1420)
  const nodeLayout: Array<{
    boxX: number;
    boxY: number;
    boxW: number;
    anchorX: number;
    anchorY: number;
    align: 'left' | 'right';
  }> =
    points.length <= 2
      ? [
          { boxX: 54, boxY: 430, boxW: 370, anchorX: cx - 125, anchorY: coreCy - 90, align: 'left' },
          { boxX: 656, boxY: 810, boxW: 370, anchorX: cx + 125, anchorY: coreCy + 80, align: 'right' },
        ]
      : points.length === 3
        ? [
            { boxX: 50, boxY: 395, boxW: 360, anchorX: cx - 125, anchorY: coreCy - 100, align: 'left' },
            { boxX: 670, boxY: 445, boxW: 360, anchorX: cx + 130, anchorY: coreCy - 60, align: 'right' },
            { boxX: 180, boxY: 1175, boxW: 720, anchorX: cx, anchorY: coreCy + 170, align: 'left' },
          ]
        : [
            { boxX: 48, boxY: 370, boxW: 356, anchorX: cx - 125, anchorY: coreCy - 105, align: 'left' },
            { boxX: 676, boxY: 370, boxW: 356, anchorX: cx + 125, anchorY: coreCy - 105, align: 'right' },
            { boxX: 48, boxY: 910, boxW: 356, anchorX: cx - 115, anchorY: coreCy + 115, align: 'left' },
            { boxX: 676, boxY: 910, boxW: 356, anchorX: cx + 115, anchorY: coreCy + 115, align: 'right' },
          ];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <HoloBackdropD localFrame={localFrame} bgBase={bgBase} glowX={cx} glowY={coreCy + 110} showFloorGrid />

      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <filter id="holo-tbl-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="8" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="holo-tbl-beam" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#00E5FF" stopOpacity="0.42" />
            <stop offset="55%" stopColor="#38BDF8" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#00E5FF" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="holo-tbl-lens" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#E0F2FE" stopOpacity="0.95" />
            <stop offset="45%" stopColor="#00E5FF" stopOpacity="0.65" />
            <stop offset="100%" stopColor="#0369A1" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Holographic projector table base pedestal */}
        <g transform={`translate(${cx}, 1145) scale(${interpolate(tableP, [0, 1], [0.85, 1])})`} opacity={tableP}>
          {/* Heavy metallic table rim */}
          <ellipse cx={0} cy={52} rx={365} ry={88} fill="#071326" stroke="#1E40AF" strokeWidth={3} opacity={0.92} />
          <ellipse cx={0} cy={30} rx={340} ry={78} fill="#0B1E3B" stroke="#0EA5E9" strokeWidth={3} />
          <ellipse cx={0} cy={14} rx={290} ry={62} fill="#082038" stroke="#38BDF8" strokeWidth={2.5} strokeDasharray="18 10" />
          {/* Emitter aperture glowing lens */}
          <ellipse cx={0} cy={10} rx={195} ry={40} fill="url(#holo-tbl-lens)" filter="url(#holo-tbl-glow)" />
          <ellipse cx={0} cy={10} rx={118} ry={22} fill="none" stroke="#E0F2FE" strokeWidth={2.5} opacity={0.9} />
          {/* Mechanical struts along rim */}
          {[-260, -140, 140, 260].map((sx, idx) => (
            <rect key={idx} x={sx - 10} y={24} width={20} height={36} rx={4} fill="#0EA5E9" opacity={0.45} />
          ))}
        </g>

        {/* Upward volumetric holographic light cone */}
        <polygon
          points={`${cx - 185},1150 ${cx + 185},1150 ${cx + 355},430 ${cx - 355},430`}
          fill="url(#holo-tbl-beam)"
          opacity={tableP * 0.92}
        />

        {/* Rotating tilted orbital meridian rings around 3D hologram */}
        <g transform={`translate(${cx}, ${coreCy}) scale(${tableP})`}>
          <ellipse
            cx={0}
            cy={0}
            rx={242}
            ry={88}
            fill="none"
            stroke="#00E5FF"
            strokeWidth={2}
            strokeDasharray="14 10"
            transform={`rotate(${-14 + Math.sin(localFrame * 0.04) * 5})`}
            opacity={0.62}
          />
          <ellipse
            cx={0}
            cy={0}
            rx={218}
            ry={76}
            fill="none"
            stroke="#38BDF8"
            strokeWidth={2.5}
            strokeDasharray="65 25"
            transform={`rotate(${16 + localFrame * 0.4})`}
            opacity={0.75}
          />
          <circle cx={0} cy={0} r={195} fill="none" stroke="#0284C7" strokeWidth={1.2} strokeDasharray="4 8" opacity={0.5} />
        </g>

        {/* 3D Rotating Wireframe Octahedron + Inner Prism */}
        <g opacity={tableP}>
          {/* Shaded translucent holo facets */}
          <polygon
            points={`${topPole[0]},${topPole[1]} ${eqPts[0][0]},${eqPts[0][1]} ${eqPts[1][0]},${eqPts[1][1]}`}
            fill="rgba(0, 229, 255, 0.14)"
          />
          <polygon
            points={`${botPole[0]},${botPole[1]} ${eqPts[2][0]},${eqPts[2][1]} ${eqPts[3][0]},${eqPts[3][1]}`}
            fill="rgba(56, 189, 248, 0.12)"
          />
          {/* Outer octahedron wireframe edges */}
          {eqPts.map((pt, i) => {
            const next = eqPts[(i + 1) % 4];
            return (
              <g key={`oct-${i}`}>
                <line x1={topPole[0]} y1={topPole[1]} x2={pt[0]} y2={pt[1]} stroke="#67E8F9" strokeWidth={2.6} filter="url(#holo-tbl-glow)" />
                <line x1={botPole[0]} y1={botPole[1]} x2={pt[0]} y2={pt[1]} stroke="#38BDF8" strokeWidth={2.2} />
                <line x1={pt[0]} y1={pt[1]} x2={next[0]} y2={next[1]} stroke="#00E5FF" strokeWidth={3} filter="url(#holo-tbl-glow)" />
                <circle cx={pt[0]} cy={pt[1]} r={6} fill="#E0F2FE" filter="url(#holo-tbl-glow)" />
              </g>
            );
          })}
          <circle cx={topPole[0]} cy={topPole[1]} r={7} fill="#E0F2FE" filter="url(#holo-tbl-glow)" />
          <circle cx={botPole[0]} cy={botPole[1]} r={7} fill="#00E5FF" filter="url(#holo-tbl-glow)" />

          {/* Inner counter-rotating prism */}
          {innerTop.map((pt, i) => {
            const nextT = innerTop[(i + 1) % 4];
            const bot = innerBot[i];
            const nextB = innerBot[(i + 1) % 4];
            return (
              <g key={`in-${i}`} stroke="#FBBF24" strokeWidth={1.6} opacity={0.78}>
                <line x1={pt[0]} y1={pt[1]} x2={nextT[0]} y2={nextT[1]} />
                <line x1={bot[0]} y1={bot[1]} x2={nextB[0]} y2={nextB[1]} />
                <line x1={pt[0]} y1={pt[1]} x2={bot[0]} y2={bot[1]} />
              </g>
            );
          })}
          {/* Vertical laser core axis */}
          <line x1={cx} y1={440} x2={cx} y2={1140} stroke="#A5F3FC" strokeWidth={1.5} strokeDasharray="6 6" opacity={0.48} />
        </g>

        {/* Holographic leader callout lines from 3D projection to floating bullet nodes */}
        {points.map((_, i) => {
          const slot = nodeLayout[i];
          if (!slot) return null;
          const p = stagger(i, localFrame, 7, 10, 14);
          const edgeX = slot.boxX < cx - 80 ? slot.boxX + slot.boxW : slot.boxX > cx + 80 ? slot.boxX : cx;
          const edgeY = slot.boxY + 62;
          return (
            <g key={`lead-${i}`} opacity={p * 0.85}>
              <polyline
                points={`${slot.anchorX},${slot.anchorY} ${(slot.anchorX + edgeX) / 2},${edgeY} ${edgeX},${edgeY}`}
                fill="none"
                stroke="#00E5FF"
                strokeWidth={2}
                strokeDasharray="6 5"
              />
              <circle cx={slot.anchorX} cy={slot.anchorY} r={6} fill="#00E5FF" filter="url(#holo-tbl-glow)" />
              <circle cx={edgeX} cy={edgeY} r={4.5} fill="#E0F2FE" />
            </g>
          );
        })}
      </svg>

      {/* Top HUD Header */}
      <div
        style={{
          position: 'absolute',
          top: 76,
          left: 68,
          right: 68,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          opacity: titleP,
          transform: `translateY(${interpolate(titleP, [0, 1], [-22, 0])}px)`,
        }}
      >
        <div
          style={{
            padding: '7px 24px',
            borderRadius: 6,
            border: '1.5px solid rgba(0, 229, 255, 0.65)',
            background: 'rgba(6, 28, 56, 0.72)',
            color: '#67E8F9',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 2,
          }}
        >
          ◈ {t.badge || 'HOLO-PROJECTION // 3D PLAN'}
        </div>
        <div style={{ width: '100%', textShadow: '0 0 28px rgba(0, 229, 255, 0.55)' }}>
          <FitText text={t.title} baseSize={56} minSize={34} maxLines={2} color={fgColor} fontWeight={800} />
        </div>
        {t.subtitle ? (
          <div style={{ maxWidth: 880 }}>
            <FitText text={t.subtitle} baseSize={29} minSize={21} maxLines={2} color="#BAE6FD" fontWeight={600} />
          </div>
        ) : null}
      </div>

      {/* Floating holographic satellite nodes */}
      {points.map((pt, i) => {
        const slot = nodeLayout[i];
        if (!slot) return null;
        const p = stagger(i, localFrame, 7, 10, 14);
        const bob = Math.sin(localFrame * 0.08 + i * 1.5) * 6;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: slot.boxX,
              top: slot.boxY + bob,
              width: slot.boxW,
              padding: '16px 20px',
              borderRadius: 14,
              background: 'rgba(6, 24, 52, 0.82)',
              border: '1.5px solid rgba(0, 229, 255, 0.68)',
              boxShadow: '0 0 24px rgba(0, 229, 255, 0.22), inset 0 0 14px rgba(56, 189, 248, 0.12)',
              opacity: p,
              transform: `scale(${interpolate(p, [0, 1], [0.86, 1])})`,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: slot.align === 'right' ? 'flex-end' : 'flex-start',
                gap: 8,
                marginBottom: 6,
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 19,
                fontWeight: 800,
                color: '#00E5FF',
                letterSpacing: 1.2,
              }}
            >
              <span>NODE 0{i + 1}</span>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: '#67E8F9', boxShadow: '0 0 8px #00E5FF' }} />
            </div>
            <FitText text={pt} baseSize={22} minSize={16} maxLines={4} lineHeight={1.3} color="#F0F9FF" fontWeight={700} align={slot.align} />
          </div>
        );
      })}

      {/* Bottom table telemetry status bar (strictly above CONTENT_BOTTOM=1420) */}
      <div
        style={{
          position: 'absolute',
          top: CONTENT_BOTTOM - 54,
          left: 110,
          right: 110,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 22px',
          borderRadius: 10,
          border: '1px solid rgba(56, 189, 248, 0.35)',
          background: 'rgba(6, 20, 44, 0.78)',
          opacity: appear(localFrame, 12, 14),
          fontFamily: THAI_FONT_FAMILY,
          fontSize: 19,
          fontWeight: 700,
          color: '#7DD3FC',
        }}
      >
        <span>SYS: HOLO-DECK ONLINE</span>
        <span>NODES: {points.length} ACTIVE</span>
        <span>SYNC: 99.8%</span>
      </div>
    </div>
  );
};

/** look-3 Shot 2: mission-route — เส้นทางภารกิจโฮโลแกรมที่เช็กพอยต์สว่างขึ้นทีละขั้น */
const MissionRouteShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const t = sceneTexts(scene);
  const points = extractPointsD(scene, 4);
  const bgBase = pickHexD(tokens?.palette?.bg, '#050C1B');
  const fgColor = pickHexD(tokens?.palette?.fg, '#F0F9FF');

  const routeP = appear(localFrame, 4, 40);
  const titleP = appear(localFrame, 0, 14);
  const pathLen = 1480;

  // Waypoint coordinates along a stepped tactical holographic vector path (strictly above CONTENT_BOTTOM=1420)
  const waypoints: Array<{ x: number; y: number; side: 'right' | 'left' }> =
    points.length <= 2
      ? [
          { x: 255, y: 600, side: 'right' },
          { x: 825, y: 1060, side: 'left' },
        ]
      : points.length === 3
        ? [
            { x: 235, y: 495, side: 'right' },
            { x: 835, y: 825, side: 'left' },
            { x: 245, y: 1155, side: 'right' },
          ]
        : [
            { x: 225, y: 445, side: 'right' },
            { x: 845, y: 695, side: 'left' },
            { x: 225, y: 945, side: 'right' },
            { x: 845, y: 1195, side: 'left' },
          ];

  // Construct clean angular tactical polyline connecting waypoints
  const routeD = waypoints
    .map((wp, idx) => {
      if (idx === 0) return `M ${wp.x} ${wp.y}`;
      const prev = waypoints[idx - 1];
      const midY = (prev.y + wp.y) / 2;
      return `L ${prev.x} ${midY - 30} L ${wp.x} ${midY + 30} L ${wp.x} ${wp.y}`;
    })
    .join(' ');

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <HoloBackdropD localFrame={localFrame} bgBase={bgBase} glowX={540} glowY={840} showFloorGrid={false} />

      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <filter id="holo-rte-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="8" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="holo-rte-line" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00E5FF" />
            <stop offset="60%" stopColor="#38BDF8" />
            <stop offset="100%" stopColor="#FBBF24" />
          </linearGradient>
        </defs>

        {/* Background holographic topographic contour grid rings */}
        {[240, 410, 580].map((r, idx) => (
          <ellipse
            key={idx}
            cx={540}
            cy={880}
            rx={r}
            ry={r * 0.68}
            fill="none"
            stroke="#0EA5E9"
            strokeWidth={1.2}
            strokeDasharray="10 14"
            opacity={0.18}
          />
        ))}

        {/* Inactive dotted base track */}
        <path d={routeD} fill="none" stroke="#0EA5E9" strokeWidth={5} strokeDasharray="10 12" opacity={0.28} />

        {/* Glowing active mission route */}
        <path
          d={routeD}
          fill="none"
          stroke="url(#holo-rte-line)"
          strokeWidth={10}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={pathLen}
          strokeDashoffset={pathLen * (1 - routeP)}
          filter="url(#holo-rte-glow)"
        />
        <path
          d={routeD}
          fill="none"
          stroke="#E0F2FE"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={pathLen}
          strokeDashoffset={pathLen * (1 - routeP)}
        />

        {/* Hexagonal Checkpoint Beacons lighting up one by one */}
        {waypoints.map((wp, i) => {
          const cpSpring = spring({
            frame: Math.max(0, localFrame - (6 + i * 10)),
            fps,
            config: { damping: 14, stiffness: 150 },
          });
          const pulseR = 54 + ((localFrame * 1.4 + i * 18) % 36);
          const pulseOp = Math.max(0, 1 - (pulseR - 54) / 36) * 0.5 * cpSpring;
          const isFinal = i === waypoints.length - 1;
          const strokeCol = isFinal ? '#FBBF24' : '#00E5FF';
          const hexPts = [0, 1, 2, 3, 4, 5]
            .map((k) => {
              const a = (k * Math.PI) / 3 - Math.PI / 6;
              return `${Math.cos(a) * 44},${Math.sin(a) * 44}`;
            })
            .join(' ');
          const connEndX = wp.side === 'right' ? wp.x + 76 : wp.x - 76;

          return (
            <g key={`wp-${i}`}>
              {/* Connector stub to card */}
              <line
                x1={wp.x}
                y1={wp.y}
                x2={connEndX}
                y2={wp.y}
                stroke={strokeCol}
                strokeWidth={2.5}
                opacity={cpSpring * 0.85}
              />
              <g transform={`translate(${wp.x}, ${wp.y}) scale(${cpSpring})`}>
                {/* Expanding holographic ping ring */}
                <circle r={pulseR} fill="none" stroke={strokeCol} strokeWidth={2} opacity={pulseOp} />
                <polygon points={hexPts} fill="#061A38" stroke={strokeCol} strokeWidth={4} filter="url(#holo-rte-glow)" />
                <circle r={26} fill={strokeCol} opacity={0.18} />
                <text
                  x={0}
                  y={9}
                  textAnchor="middle"
                  fill="#FFFFFF"
                  fontFamily={THAI_FONT_FAMILY}
                  fontSize={24}
                  fontWeight={800}
                >
                  {extractStepLabelD(scene, i)}
                </text>
              </g>
            </g>
          );
        })}
      </svg>

      {/* Top Tactical Mission Header */}
      <div
        style={{
          position: 'absolute',
          top: 76,
          left: 64,
          right: 64,
          opacity: titleP,
          transform: `translateY(${interpolate(titleP, [0, 1], [-18, 0])}px)`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
            paddingBottom: 10,
            borderBottom: '1.5px solid rgba(0, 229, 255, 0.35)',
          }}
        >
          <span
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 22,
              fontWeight: 800,
              color: '#00E5FF',
              letterSpacing: 1.5,
            }}
          >
            ▸ {t.badge || 'MISSION ROUTE // STEP SEQUENCE'}
          </span>
          <span
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 20,
              fontWeight: 700,
              color: '#FBBF24',
            }}
          >
            {points.length} CHECKPOINTS
          </span>
        </div>
        <FitText text={t.title} baseSize={54} minSize={32} maxLines={2} color={fgColor} fontWeight={800} align="left" />
      </div>

      {/* Checkpoint Tactical Callout Cards */}
      {points.map((pt, i) => {
        const wp = waypoints[i];
        if (!wp) return null;
        const p = stagger(i, localFrame, 10, 8, 14);
        const isRight = wp.side === 'right';
        const isFinal = i === points.length - 1;
        return (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: wp.y - 72,
                left: isRight ? wp.x + 76 : 58,
                width: isRight ? STAGE_W - wp.x - 134 : wp.x - 134,
                minHeight: 118,
                padding: '16px 22px',
                borderRadius: 16,
                background: isFinal ? 'rgba(34, 24, 8, 0.84)' : 'rgba(6, 24, 52, 0.84)',
                border: `1.5px solid ${isFinal ? 'rgba(251, 191, 36, 0.78)' : 'rgba(0, 229, 255, 0.62)'}`,
                boxShadow: isFinal ? '0 0 24px rgba(251, 191, 36, 0.22)' : '0 0 24px rgba(0, 229, 255, 0.18)',
                opacity: p,
                transform: `translateX(${interpolate(p, [0, 1], [isRight ? 36 : -36, 0])}px)`,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: isRight ? 'flex-start' : 'flex-end',
                  gap: 8,
                  marginBottom: 6,
                  fontFamily: THAI_FONT_FAMILY,
                  fontSize: 19,
                  fontWeight: 800,
                  color: isFinal ? '#FBBF24' : '#67E8F9',
                  letterSpacing: 1,
                }}
              >
                <span>{isFinal ? '★ TARGET REACHED' : `CHECKPOINT 0${i + 1}`}</span>
              </div>
              <FitText
                text={pt}
                baseSize={23}
                minSize={17}
                maxLines={4}
                lineHeight={1.3}
                color="#F8FAFC"
                fontWeight={700}
                align={isRight ? 'left' : 'right'}
              />
            </div>
        );
      })}

      {/* Bottom Progress Bar safely above CONTENT_BOTTOM=1420 */}
      <div
        style={{
          position: 'absolute',
          top: CONTENT_BOTTOM - 28,
          left: 64,
          right: 64,
          opacity: appear(localFrame, 10, 14),
        }}
      >
        <div
          style={{
            height: 12,
            borderRadius: 99,
            background: 'rgba(14, 165, 233, 0.18)',
            border: '1px solid rgba(56, 189, 248, 0.45)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.round(routeP * 100)}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #00E5FF 0%, #38BDF8 60%, #FBBF24 100%)',
              boxShadow: '0 0 16px #00E5FF',
            }}
          />
        </div>
      </div>
    </div>
  );
};

/** look-3 Shot 3: radar-scan — เรดาร์โฮโลแกรมกวาดคลื่นตรวจจับเป้าหมายและตัวเลขสำคัญ */
const RadarScanShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const t = sceneTexts(scene);
  const metric = extractPrimaryMetricD(scene, sceneIndex);
  const points = extractShortPointsD(scene, 3);
  const bgBase = pickHexD(tokens?.palette?.bg, '#040B1A');
  const fgColor = pickHexD(tokens?.palette?.fg, '#F0F9FF');

  const scopeP = spring({ frame: localFrame, fps, config: { damping: 15, stiffness: 120 } });
  const titleP = appear(localFrame, 2, 14);
  const sweepDeg = (localFrame * 3.1) % 360;
  const cx = 540;
  const cy = 585;
  const maxR = 285;

  const progressVal =
    typeof scene.stat?.progress === 'number'
      ? Math.max(8, Math.min(100, scene.stat.progress))
      : 78;
  const ringCircumference = 2 * Math.PI * (maxR + 18);
  const progressP = appear(localFrame, 8, 28);

  // Target radar blips positioned within the circular scope
  const blips: ReadonlyArray<{ angle: number; dist: number; code: string }> = [
    { angle: -42, dist: 190, code: 'T-01' },
    { angle: 128, dist: 208, code: 'T-02' },
    { angle: 224, dist: 178, code: 'T-03' },
  ];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <HoloBackdropD localFrame={localFrame} bgBase={bgBase} glowX={cx} glowY={cy} showFloorGrid={false} />

      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <filter id="holo-rdr-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="8" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="holo-rdr-wedge" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#00E5FF" stopOpacity="0.52" />
            <stop offset="100%" stopColor="#00E5FF" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="holo-rdr-bg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#082F49" stopOpacity="0.72" />
            <stop offset="75%" stopColor="#041528" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#020814" stopOpacity="0.2" />
          </radialGradient>
        </defs>

        <g transform={`translate(${cx}, ${cy}) scale(${scopeP})`}>
          {/* Radar Dish Fill */}
          <circle r={maxR} fill="url(#holo-rdr-bg)" stroke="#00E5FF" strokeWidth={3} opacity={0.9} />

          {/* Concentric range rings */}
          {[88, 165, 240].map((r) => (
            <circle key={r} r={r} fill="none" stroke="#38BDF8" strokeWidth={1.6} strokeDasharray="8 8" opacity={0.42} />
          ))}

          {/* Degree perimeter ticks */}
          {Array.from({ length: 36 }).map((_, i) => {
            const deg = i * 10;
            const rad = (deg * Math.PI) / 180;
            const inner = i % 3 === 0 ? maxR - 18 : maxR - 9;
            return (
              <line
                key={i}
                x1={Math.cos(rad) * inner}
                y1={Math.sin(rad) * inner}
                x2={Math.cos(rad) * maxR}
                y2={Math.sin(rad) * maxR}
                stroke="#67E8F9"
                strokeWidth={i % 3 === 0 ? 2.5 : 1.2}
                opacity={i % 3 === 0 ? 0.85 : 0.45}
              />
            );
          })}

          {/* Crosshairs */}
          <line x1={-maxR} y1={0} x2={maxR} y2={0} stroke="#38BDF8" strokeWidth={1.4} opacity={0.38} />
          <line x1={0} y1={-maxR} x2={0} y2={maxR} stroke="#38BDF8" strokeWidth={1.4} opacity={0.38} />

          {/* Animated progress arc around outer perimeter */}
          <circle
            r={maxR + 18}
            fill="none"
            stroke="#0EA5E9"
            strokeWidth={6}
            opacity={0.2}
          />
          <circle
            r={maxR + 18}
            fill="none"
            stroke="#00E5FF"
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={ringCircumference}
            strokeDashoffset={ringCircumference * (1 - (progressVal / 100) * progressP)}
            transform="rotate(-90)"
            filter="url(#holo-rdr-glow)"
          />

          {/* Rotating Radar Sweep Wedge */}
          <g transform={`rotate(${sweepDeg})`}>
            <path
              d={`M 0 0 L 0 ${-maxR} A ${maxR} ${maxR} 0 0 1 ${Math.sin((52 * Math.PI) / 180) * maxR} ${-Math.cos((52 * Math.PI) / 180) * maxR} Z`}
              fill="url(#holo-rdr-wedge)"
            />
            <line x1={0} y1={0} x2={0} y2={-maxR} stroke="#E0F2FE" strokeWidth={3.5} filter="url(#holo-rdr-glow)" />
          </g>

          {/* Detected Target Blips */}
          {blips.map((b, i) => {
            const rad = (b.angle * Math.PI) / 180;
            const bx = Math.cos(rad) * b.dist;
            const by = Math.sin(rad) * b.dist;
            const ping = ((localFrame * 0.08 + i * 0.7) % 1);
            return (
              <g key={b.code} transform={`translate(${bx}, ${by})`}>
                <circle r={12 + ping * 24} fill="none" stroke="#FBBF24" strokeWidth={2} opacity={(1 - ping) * 0.85} />
                <circle r={7} fill="#FBBF24" filter="url(#holo-rdr-glow)" />
                <path d="M -16 -10 L -16 -16 L -10 -16 M 10 -16 L 16 -16 L 16 -10 M -16 10 L -16 16 L -10 16 M 10 16 L 16 16 L 16 10" stroke="#FBBF24" strokeWidth={2} fill="none" />
                <text x={22} y={5} fill="#FDE68A" fontFamily={THAI_FONT_FAMILY} fontSize={18} fontWeight={800}>
                  {b.code}
                </text>
              </g>
            );
          })}

          {/* Center Core Lock Ring behind primary number */}
          <circle r={138} fill="rgba(4, 18, 38, 0.86)" stroke="#00E5FF" strokeWidth={3} filter="url(#holo-rdr-glow)" />
          <circle r={124} fill="none" stroke="#67E8F9" strokeWidth={1.5} strokeDasharray="10 6" opacity={0.75} />
        </g>
      </svg>

      {/* Top Radar Header */}
      <div
        style={{
          position: 'absolute',
          top: 72,
          left: 64,
          right: 64,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          opacity: titleP,
        }}
      >
        <div
          style={{
            padding: '6px 22px',
            borderRadius: 6,
            border: '1.5px solid rgba(251, 191, 36, 0.7)',
            background: 'rgba(28, 22, 6, 0.75)',
            color: '#FDE68A',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 21,
            fontWeight: 800,
            letterSpacing: 1.5,
          }}
        >
          ◎ {t.badge || 'RADAR LOCK // KEY METRIC DETECTED'}
        </div>
        <FitText text={t.title} baseSize={52} minSize={32} maxLines={2} color={fgColor} fontWeight={800} />
      </div>

      {/* Central Locked Metric inside Radar Core */}
      <div
        style={{
          position: 'absolute',
          top: cy - 96,
          left: cx - 134,
          width: 268,
          height: 192,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          opacity: scopeP,
          transform: `scale(${interpolate(scopeP, [0, 1], [0.7, 1])})`,
          textShadow: '0 0 28px rgba(0, 229, 255, 0.75)',
        }}
      >
        <FitText text={metric.big} baseSize={64} minSize={32} maxLines={2} color="#FFFFFF" fontWeight={900} />
        {metric.unit ? (
          <FitText text={metric.unit} baseSize={22} minSize={16} maxLines={2} lineHeight={1.28} color="#67E8F9" fontWeight={700} />
        ) : null}
      </div>

      {/* Bottom Target Telemetry Readout Cards (strictly above CONTENT_BOTTOM=1420) */}
      <div
        style={{
          position: 'absolute',
          top: 930,
          left: 60,
          right: 60,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {points.slice(0, 3).map((pt, i) => {
          const p = stagger(i, localFrame, 7, 10, 14);
          const sigBars = 3 + ((i + 1) % 3);
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                minHeight: 78,
                padding: '14px 20px',
                borderRadius: 14,
                background: 'rgba(6, 22, 46, 0.84)',
                border: '1.5px solid rgba(0, 229, 255, 0.5)',
                boxShadow: '0 0 18px rgba(0, 229, 255, 0.14)',
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [24, 0])}px)`,
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  padding: '6px 12px',
                  borderRadius: 8,
                  background: 'rgba(251, 191, 36, 0.16)',
                  border: '1px solid rgba(251, 191, 36, 0.7)',
                  color: '#FDE68A',
                  fontFamily: THAI_FONT_FAMILY,
                  fontSize: 20,
                  fontWeight: 800,
                }}
              >
                T-0{i + 1}
              </div>
              <div style={{ flex: 1 }}>
                <FitText text={pt} baseSize={22} minSize={17} maxLines={3} lineHeight={1.28} color="#F0F9FF" fontWeight={700} align="left" />
              </div>
              {/* Mini live signal bars */}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 26, flexShrink: 0 }}>
                {[0, 1, 2, 3].map((b) => (
                  <div
                    key={b}
                    style={{
                      width: 6,
                      height: 8 + b * 5,
                      borderRadius: 2,
                      background: b < sigBars ? '#00E5FF' : 'rgba(56, 189, 248, 0.22)',
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-3 Shot 4: hud-briefing — ร่างโฮโลแกรมบรรยายสรุปข้างแผงข้อมูล HUD */
const HudBriefingShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const t = sceneTexts(scene);
  const points = extractPointsD(scene, 3);
  const bgBase = pickHexD(tokens?.palette?.bg, '#050C1C');
  const fgColor = pickHexD(tokens?.palette?.fg, '#F0F9FF');

  const holoP = spring({ frame: localFrame, fps, config: { damping: 16, stiffness: 115 } });
  const titleP = appear(localFrame, 2, 14);
  const flicker = 0.88 + 0.12 * Math.sin(localFrame * 0.45);
  const armWave = Math.sin(localFrame * 0.09) * 5;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <HoloBackdropD localFrame={localFrame} bgBase={bgBase} glowX={260} glowY={920} showFloorGrid />

      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <filter id="holo-hud-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="8" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="holo-hud-avatar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#A5F3FC" stopOpacity="0.92" />
            <stop offset="55%" stopColor="#00E5FF" stopOpacity="0.58" />
            <stop offset="100%" stopColor="#0284C7" stopOpacity="0.16" />
          </linearGradient>
          <linearGradient id="holo-hud-cone" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#00E5FF" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#00E5FF" stopOpacity="0" />
          </linearGradient>
          <pattern id="holo-hud-scan" width="8" height="8" patternUnits="userSpaceOnUse">
            <line x1="0" y1="4" x2="8" y2="4" stroke="#030B18" strokeWidth="2.5" opacity="0.55" />
          </pattern>
        </defs>

        {/* Left Holographic Emitter Pad */}
        <g transform="translate(245, 1345)" opacity={holoP}>
          <ellipse cx={0} cy={22} rx={182} ry={40} fill="#071832" stroke="#0EA5E9" strokeWidth={3} />
          <ellipse cx={0} cy={8} rx={142} ry={28} fill="#00E5FF" opacity={0.35} filter="url(#holo-hud-glow)" />
          <ellipse cx={0} cy={8} rx={96} ry={18} fill="none" stroke="#E0F2FE" strokeWidth={2.5} />
        </g>

        {/* Volumetric beam rising around holographic presenter */}
        <polygon
          points="105,1350 385,1350 445,480 55,480"
          fill="url(#holo-hud-cone)"
          opacity={holoP * 0.72}
        />

        {/* Holographic Presenter / Briefing Avatar Silhouette (gesturing toward HUD panels) */}
        <g transform={`translate(245, ${625 + Math.sin(localFrame * 0.06) * 6}) scale(${holoP * 0.94})`} opacity={flicker}>
          {/* Halo telemetry ring behind head */}
          <circle cx={0} cy={-35} r={88} fill="none" stroke="#38BDF8" strokeWidth={2} strokeDasharray="12 8" opacity={0.65} />

          {/* Head */}
          <ellipse cx={0} cy={-38} rx={52} ry={62} fill="url(#holo-hud-avatar)" stroke="#A5F3FC" strokeWidth={3} filter="url(#holo-hud-glow)" />
          {/* Futuristic HUD Visor strip */}
          <path d="M -38 -48 Q 0 -58, 38 -48 L 32 -32 Q 0 -40, -32 -32 Z" fill="#E0F2FE" opacity={0.85} />
          {/* Neck */}
          <rect x={-18} y={20} width={36} height={30} rx={10} fill="url(#holo-hud-avatar)" />

          {/* Torso & Coat Silhouette */}
          <path
            d="M -98 118 C -96 62, -55 46, 0 46 C 55 46, 98 62, 108 118 L 122 390 L 68 690 L 14 690 L 4 440 L -8 440 L -18 690 L -74 690 L -96 390 Z"
            fill="url(#holo-hud-avatar)"
            stroke="#67E8F9"
            strokeWidth={3}
            filter="url(#holo-hud-glow)"
          />

          {/* Gesturing Right Arm pointing toward HUD Panels */}
          <g transform={`translate(82, 125) rotate(${-18 + armWave})`}>
            <path
              d="M -10 -16 L 118 -32 C 134 -34, 142 -12, 124 -6 L 4 22 Z"
              fill="url(#holo-hud-avatar)"
              stroke="#A5F3FC"
              strokeWidth={3}
            />
            {/* Glowing laser pointer spark from fingertip */}
            <circle cx={134} cy={-18} r={8} fill="#FBBF24" filter="url(#holo-hud-glow)" />
          </g>

          {/* Wireframe rib telemetry overlays on torso */}
          <path d="M -68 150 L 68 150 M -74 220 L 74 220 M -78 290 L 78 290 M 0 60 L 0 385" stroke="#E0F2FE" strokeWidth={1.6} opacity={0.45} />
          {/* Scanline mask over silhouette */}
          <rect x={-130} y={-110} width={310} height={820} fill="url(#holo-hud-scan)" opacity={0.55} />
        </g>

        {/* Data beam connecting gesturing hand to HUD panels */}
        <line
          x1={432}
          y1={752}
          x2={472}
          y2={752}
          stroke="#FBBF24"
          strokeWidth={3}
          strokeDasharray="6 6"
          opacity={holoP * 0.9}
        />
      </svg>

      {/* Top Briefing Title Banner */}
      <div
        style={{
          position: 'absolute',
          top: 72,
          left: 60,
          right: 60,
          opacity: titleP,
          transform: `translateY(${interpolate(titleP, [0, 1], [-16, 0])}px)`,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '7px 20px',
            borderRadius: 6,
            background: 'rgba(0, 229, 255, 0.14)',
            border: '1.5px solid rgba(0, 229, 255, 0.65)',
            color: '#67E8F9',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 21,
            fontWeight: 800,
            marginBottom: 14,
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: 99, background: '#FBBF24', boxShadow: '0 0 10px #FBBF24' }} />
          <span>{t.badge || 'HOLO-BRIEFING // LIVE TRANSMISSION'}</span>
        </div>
        <FitText text={t.title} baseSize={54} minSize={34} maxLines={2} color={fgColor} fontWeight={800} align="left" />
        {t.subtitle ? (
          <div style={{ marginTop: 8 }}>
            <FitText text={t.subtitle} baseSize={28} minSize={21} maxLines={2} color="#93C5FD" fontWeight={600} align="left" />
          </div>
        ) : null}
      </div>

      {/* Right Floating Translucent HUD Data Panels (strictly above CONTENT_BOTTOM=1420) */}
      <div
        style={{
          position: 'absolute',
          top: 390,
          left: 468,
          right: 52,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {/* Main HUD Data Header Strip */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 18px',
            borderRadius: 10,
            background: 'rgba(0, 229, 255, 0.14)',
            border: '1px solid rgba(0, 229, 255, 0.5)',
            opacity: appear(localFrame, 6, 12),
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 20,
            fontWeight: 800,
            color: '#67E8F9',
          }}
        >
          <span>BRIEFING DATA STREAM</span>
          <span>CH-03</span>
        </div>

        {points.map((pt, i) => {
          const p = stagger(i, localFrame, 8, 10, 14);
          return (
            <div
              key={i}
              style={{
                minHeight: 96,
                padding: '14px 20px',
                borderRadius: 16,
                background: 'rgba(6, 22, 48, 0.84)',
                border: '1.5px solid rgba(0, 229, 255, 0.6)',
                borderLeft: '6px solid #00E5FF',
                boxShadow: '0 0 24px rgba(0, 229, 255, 0.16)',
                opacity: p,
                transform: `translateX(${interpolate(p, [0, 1], [44, 0])}px)`,
              }}
            >
              <div
                style={{
                  fontFamily: THAI_FONT_FAMILY,
                  fontSize: 18,
                  fontWeight: 800,
                  color: '#FBBF24',
                  marginBottom: 6,
                  letterSpacing: 1.2,
                }}
              >
                ▸ DATA PANEL 0{i + 1}
              </div>
              <FitText text={pt} baseSize={24} minSize={18} maxLines={4} lineHeight={1.3} color="#F8FAFC" fontWeight={700} align="left" />
            </div>
          );
        })}

        {/* Live Voice Equalizer Waveform Bar inside HUD footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 20px',
            borderRadius: 12,
            background: 'rgba(6, 20, 42, 0.78)',
            border: '1px solid rgba(56, 189, 248, 0.42)',
            opacity: appear(localFrame, 16, 14),
          }}
        >
          <span style={{ fontFamily: THAI_FONT_FAMILY, fontSize: 19, fontWeight: 700, color: '#7DD3FC' }}>
            VOICE LINK
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 34 }}>
            {Array.from({ length: 16 }).map((_, idx) => {
              const h = 8 + Math.abs(Math.sin(localFrame * 0.24 + idx * 0.75)) * 24;
              return (
                <div
                  key={idx}
                  style={{
                    width: 6,
                    height: h,
                    borderRadius: 3,
                    background: idx % 4 === 0 ? '#FBBF24' : '#00E5FF',
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// STYLE 2: look-4 — RED RELIEF (แผนที่นูนสีแดง)
// World: Tactile embossed red/terracotta relief map with shadow-emboss depth,
// brass/gold campaign arrows, carved stela monuments & unrolling era scrolls.
// ============================================================================

const RedReliefBackdropD: React.FC<{
  localFrame: number;
  bgBase?: string;
  warmth?: 'crimson' | 'terracotta' | 'obsidian';
}> = ({ localFrame, bgBase = '#1A0C0E', warmth = 'crimson' }) => {
  const drift = Math.sin(localFrame * 0.025) * 6;
  const topTint =
    warmth === 'terracotta'
      ? '#4A1D16'
      : warmth === 'obsidian'
        ? '#2A1215'
        : '#3E1115';

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(circle at 50% 34%, ${topTint} 0%, ${bgBase} 62%, #100708 100%)`,
      }}
    >
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <filter id="red-bg-emboss" x="-15%" y="-15%" width="130%" height="130%">
            <feDropShadow dx="10" dy="14" stdDeviation="8" floodColor="#090203" floodOpacity="0.65" />
          </filter>
        </defs>

        {/* Subtle cartographic latitude & longitude lines */}
        {Array.from({ length: 9 }).map((_, i) => (
          <line key={`lon-${i}`} x1={i * 135} y1={0} x2={i * 135} y2={STAGE_H} stroke="#E07A5F" strokeWidth={1} opacity={0.11} />
        ))}
        {Array.from({ length: 14 }).map((_, i) => (
          <line key={`lat-${i}`} x1={0} y1={i * 140} x2={STAGE_W} y2={i * 140} stroke="#E07A5F" strokeWidth={1} opacity={0.11} />
        ))}

        {/* Background subtle embossed topographic contour waves */}
        <g transform={`translate(0, ${drift})`} opacity={0.34} filter="url(#red-bg-emboss)">
          <path
            d="M -60 440 C 210 380, 420 510, 680 430 C 870 375, 980 460, 1140 420 L 1140 1920 L -60 1920 Z"
            fill="#5B1918"
            stroke="#C25943"
            strokeWidth={2}
          />
          <path
            d="M -60 760 C 240 690, 480 845, 760 740 C 920 680, 1020 770, 1140 735 L 1140 1920 L -60 1920 Z"
            fill="#481414"
            stroke="#B94836"
            strokeWidth={2}
          />
          <path
            d="M -60 1120 C 280 1050, 520 1205, 810 1110 C 960 1060, 1040 1140, 1140 1105 L 1140 1920 L -60 1920 Z"
            fill="#350E0F"
            stroke="#9B372B"
            strokeWidth={2}
          />
        </g>

        {/* Faint ornamental compass rose watermark top-right */}
        <g transform="translate(945, 195)" opacity={0.2}>
          <circle r={66} fill="none" stroke="#F59E0B" strokeWidth={1.5} strokeDasharray="5 5" />
          <circle r={44} fill="none" stroke="#F59E0B" strokeWidth={1} />
          <polygon points="0,-60 10,-10 60,0 10,10 0,60 -10,10 -60,0 -10,-10" fill="#F59E0B" />
        </g>

        {/* Antique double cartographic border frame */}
        <rect x={28} y={32} width={STAGE_W - 56} height={STAGE_H - 64} rx={8} fill="none" stroke="#B45309" strokeWidth={2} opacity={0.35} />
        <rect x={38} y={42} width={STAGE_W - 76} height={STAGE_H - 84} rx={4} fill="none" stroke="#E07A5F" strokeWidth={1} opacity={0.28} />
      </svg>
    </div>
  );
};

/** look-4 Shot 1: relief-map — แผนที่นูนสีแดงพร้อมหมุดปักตำแหน่งและลูกศรกวาดข้ามอาณาเขต */
const ReliefMapShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const t = sceneTexts(scene);
  const points = extractShortPointsD(scene, 3);
  const fgColor = pickHexD(tokens?.palette?.fg, '#FDF6EC');

  const mapP = spring({ frame: localFrame, fps, config: { damping: 16, stiffness: 110 } });
  const arrowP = appear(localFrame, 8, 34);
  const pinDrop = spring({ frame: Math.max(0, localFrame - 16), fps, config: { damping: 12, stiffness: 170 } });
  const titleP = appear(localFrame, 2, 14);
  const arrowLen = 740;
  const pinX = 768;
  const pinY = 588;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <RedReliefBackdropD localFrame={localFrame} warmth="terracotta" />

      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          {/* Directional shadow emboss filter for sculpted relief topography */}
          <filter id="red-map-emboss" x="-20%" y="-20%" width="145%" height="145%">
            <feDropShadow dx="12" dy="16" stdDeviation="10" floodColor="#120404" floodOpacity="0.72" />
          </filter>
          <filter id="red-map-pin-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="10" stdDeviation="7" floodColor="#0F0303" floodOpacity="0.8" />
          </filter>
          <linearGradient id="red-map-tier1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#B93829" />
            <stop offset="100%" stopColor="#7C1D1A" />
          </linearGradient>
          <linearGradient id="red-map-tier2" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#D6523C" />
            <stop offset="100%" stopColor="#99231D" />
          </linearGradient>
          <linearGradient id="red-map-tier3" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#EA7355" />
            <stop offset="100%" stopColor="#B83227" />
          </linearGradient>
          <linearGradient id="red-map-arrow" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#FEF08A" />
          </linearGradient>
        </defs>

        {/* Sculpted Multi-Layer Red Terracotta Relief Landmass */}
        <g transform={`translate(0, ${interpolate(mapP, [0, 1], [44, -48])})`} opacity={mapP}>
          {/* Tier 0: Coastal continental shelf */}
          <path
            d="M 95 795 C 125 620, 260 470, 445 450 C 605 432, 745 415, 885 480 C 995 530, 1020 695, 955 835 C 885 985, 695 1045, 515 1030 C 310 1012, 75 940, 95 795 Z"
            fill="#5C1615"
            stroke="#9F3328"
            strokeWidth={3}
            filter="url(#red-map-emboss)"
          />
          {/* Tier 1: Mid-elevation crimson plateau */}
          <path
            d="M 160 770 C 195 625, 315 510, 485 492 C 625 478, 740 468, 845 525 C 930 572, 938 710, 875 815 C 805 930, 645 975, 495 960 C 325 942, 132 885, 160 770 Z"
            fill="url(#red-map-tier1)"
            stroke="#E57A60"
            strokeWidth={2.5}
            filter="url(#red-map-emboss)"
          />
          {/* Tier 2: High terracotta highland */}
          <path
            d="M 245 755 C 280 645, 385 552, 525 540 C 640 530, 735 528, 800 582 C 858 630, 845 735, 785 805 C 715 885, 580 905, 460 885 C 335 865, 218 835, 245 755 Z"
            fill="url(#red-map-tier2)"
            stroke="#F29B7E"
            strokeWidth={2}
            filter="url(#red-map-emboss)"
          />
          {/* Tier 3: Sculpted mountain peak ridge */}
          <path
            d="M 380 715 C 425 635, 525 588, 635 595 C 720 600, 770 650, 730 725 C 685 805, 550 825, 460 795 C 390 772, 355 755, 380 715 Z"
            fill="url(#red-map-tier3)"
            stroke="#FBD3C2"
            strokeWidth={2}
            filter="url(#red-map-emboss)"
          />

          {/* Topographic mountain ridge hatch marks */}
          <path d="M 465 660 L 505 630 L 548 665 M 575 645 L 615 615 L 655 650" fill="none" stroke="#450A0A" strokeWidth={3} strokeLinecap="round" opacity={0.45} />
          <path d="M 290 795 L 325 768 L 360 795" fill="none" stroke="#450A0A" strokeWidth={2.5} strokeLinecap="round" opacity={0.4} />

          {/* Starting origin fort marker */}
          <g transform="translate(262, 835)">
            <circle r={20} fill="#2A0B0B" stroke="#F59E0B" strokeWidth={4} />
            <circle r={8} fill="#FEF08A" />
          </g>

          {/* Sweeping brass-gold campaign arrow across territory */}
          <path
            d="M 272 824 C 375 685, 535 615, 738 598"
            fill="none"
            stroke="#2B0707"
            strokeWidth={22}
            strokeLinecap="round"
            strokeDasharray={arrowLen}
            strokeDashoffset={arrowLen * (1 - arrowP)}
            opacity={0.45}
            transform="translate(4, 9)"
          />
          <path
            d="M 272 824 C 375 685, 535 615, 738 598"
            fill="none"
            stroke="url(#red-map-arrow)"
            strokeWidth={14}
            strokeLinecap="round"
            strokeDasharray={arrowLen}
            strokeDashoffset={arrowLen * (1 - arrowP)}
          />
          {/* Arrowhead at destination */}
          <g transform={`translate(744, 598) rotate(-8) scale(${appear(localFrame, 28, 12)})`}>
            <polygon points="18,0 -22,-22 -12,0 -22,22" fill="#FEF08A" stroke="#92400E" strokeWidth={3} />
          </g>

          {/* Ground ripple beneath map pin */}
          <ellipse
            cx={pinX}
            cy={pinY + 8}
            rx={28 + ((localFrame * 1.1) % 30)}
            ry={11 + ((localFrame * 0.45) % 12)}
            fill="none"
            stroke="#FEF08A"
            strokeWidth={2.5}
            opacity={Math.max(0, 1 - ((localFrame * 1.1) % 30) / 30) * pinDrop}
          />

          {/* 3D Sculpted Map Pin dropping into target location */}
          <g
            transform={`translate(${pinX}, ${pinY - interpolate(pinDrop, [0, 1], [120, 0])}) scale(${pinDrop})`}
            filter="url(#red-map-pin-shadow)"
          >
            <path
              d="M 0 0 C -26 -38, -44 -64, -44 -92 C -44 -117, -24 -136, 0 -136 C 24 -136, 44 -117, 44 -92 C 44 -64, 26 -38, 0 0 Z"
              fill="#F59E0B"
              stroke="#FEF3C7"
              strokeWidth={4}
            />
            <circle cx={0} cy={-92} r={19} fill="#7F1D1D" stroke="#FDE68A" strokeWidth={3} />
            <circle cx={0} cy={-92} r={7} fill="#FEF08A" />
          </g>
        </g>
      </svg>

      {/* Top Carved Cartographic Header */}
      <div
        style={{
          position: 'absolute',
          top: 74,
          left: 64,
          right: 64,
          opacity: titleP,
          transform: `translateY(${interpolate(titleP, [0, 1], [-18, 0])}px)`,
        }}
      >
        <div
          style={{
            display: 'inline-block',
            padding: '8px 24px',
            borderRadius: 6,
            background: 'linear-gradient(135deg, #991B1B 0%, #7F1D1D 100%)',
            border: '1.5px solid #F59E0B',
            boxShadow: '0 6px 18px rgba(0, 0, 0, 0.45)',
            color: '#FDE68A',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: 1.4,
            marginBottom: 14,
          }}
        >
          ✦ {t.badge || 'RED RELIEF ATLAS // แผนที่นูนภูมิศาสตร์'}
        </div>
        <div style={{ textShadow: '0 6px 18px rgba(10, 2, 2, 0.85)' }}>
          <FitText text={t.title} baseSize={54} minSize={32} maxLines={2} color={fgColor} fontWeight={800} align="left" />
        </div>
        {t.subtitle ? (
          <div style={{ marginTop: 8 }}>
            <FitText text={t.subtitle} baseSize={28} minSize={20} maxLines={2} color="#F5D0C5" fontWeight={600} align="left" />
          </div>
        ) : null}
      </div>

      {/* Bottom Embossed Cartographic Field Legend (strictly above CONTENT_BOTTOM=1420) */}
      <div
        style={{
          position: 'absolute',
          top: 985,
          left: 60,
          right: 60,
          padding: '16px 24px',
          borderRadius: 18,
          background: 'linear-gradient(160deg, rgba(46, 15, 16, 0.94) 0%, rgba(26, 9, 10, 0.96) 100%)',
          border: '2px solid rgba(224, 122, 95, 0.65)',
          boxShadow: '0 16px 36px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(254, 240, 138, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingBottom: 10,
            borderBottom: '1px solid rgba(245, 158, 11, 0.35)',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 20,
            fontWeight: 800,
            color: '#F59E0B',
            letterSpacing: 1.2,
          }}
        >
          <span>พิกัดสำคัญบนแผนที่</span>
          <span>14°N • 100°E</span>
        </div>

        {points.slice(0, 3).map((pt, i) => {
          const p = stagger(i, localFrame, 7, 12, 14);
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                opacity: p,
                transform: `translateX(${interpolate(p, [0, 1], [-26, 0])}px)`,
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 10,
                  flexShrink: 0,
                  background: 'linear-gradient(135deg, #DC2626 0%, #991B1B 100%)',
                  border: '1.5px solid #FDE68A',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: THAI_FONT_FAMILY,
                  fontSize: 22,
                  fontWeight: 900,
                  color: '#FEF3C7',
                }}
              >
                {String.fromCharCode(65 + i)}
              </div>
              <div style={{ flex: 1 }}>
                <FitText text={pt} baseSize={22} minSize={17} maxLines={3} lineHeight={1.28} color="#FDF6EC" fontWeight={700} align="left" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-4 Shot 2: battle-arrows — ลูกศรสองฝ่ายปะทะกันบนแผนที่นูนสำหรับเปรียบเทียบ */
const BattleArrowsShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const t = sceneTexts(scene);
  const cmp = extractCompareSidesD(scene);
  const fgColor = pickHexD(tokens?.palette?.fg, '#FDF6EC');

  const clashP = spring({ frame: Math.max(0, localFrame - 12), fps, config: { damping: 12, stiffness: 180 } });
  const leftArrowP = appear(localFrame, 4, 24);
  const rightArrowP = appear(localFrame, 6, 24);
  const titleP = appear(localFrame, 0, 14);
  const shockR = 46 + ((localFrame * 2.2) % 64);
  const shockOp = Math.max(0, 1 - (shockR - 46) / 64) * 0.65 * clashP;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <RedReliefBackdropD localFrame={localFrame} warmth="obsidian" />

      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <filter id="red-btl-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="6" dy="10" stdDeviation="8" floodColor="#090202" floodOpacity="0.75" />
          </filter>
          <linearGradient id="red-btl-left" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#991B1B" />
            <stop offset="100%" stopColor="#EF4444" />
          </linearGradient>
          <linearGradient id="red-btl-right" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0%" stopColor="#B45309" />
            <stop offset="100%" stopColor="#FBBF24" />
          </linearGradient>
        </defs>

        {/* Left Crimson Embossed Relief Territory */}
        <path
          d="M 0 340 L 505 340 C 460 440, 520 530, 470 630 C 430 700, 465 735, 0 735 Z"
          fill="#691818"
          stroke="#DC2626"
          strokeWidth={3}
          filter="url(#red-btl-shadow)"
          opacity={0.82}
        />
        {/* Right Brass-Slate Embossed Relief Territory */}
        <path
          d="M 1080 340 L 575 340 C 610 440, 555 530, 610 630 C 645 700, 615 735, 1080 735 Z"
          fill="#2B241A"
          stroke="#D97706"
          strokeWidth={3}
          filter="url(#red-btl-shadow)"
          opacity={0.86}
        />

        {/* Jagged battle frontline fault dividing left & right */}
        <polyline
          points="540,330 518,410 558,485 526,560 554,640 532,730"
          fill="none"
          stroke="#FDE68A"
          strokeWidth={3}
          strokeDasharray="12 8"
          opacity={0.55}
        />

        {/* Opposing Sweeping Curved Tactical Arrows (Left Crimson vs Right Gold) */}
        <g filter="url(#red-btl-shadow)">
          {/* Left Army Arrow */}
          <path
            d="M 88 645 C 185 510, 310 500, 445 548"
            fill="none"
            stroke="url(#red-btl-left)"
            strokeWidth={36}
            strokeLinecap="round"
            strokeDasharray={520}
            strokeDashoffset={520 * (1 - leftArrowP)}
          />
          <g transform={`translate(458, 552) rotate(18) scale(${appear(localFrame, 14, 10)})`}>
            <polygon points="34,0 -26,-34 -12,0 -26,34" fill="#EF4444" stroke="#FEE2E2" strokeWidth={3} />
          </g>

          {/* Right Army Arrow */}
          <path
            d="M 992 645 C 895 510, 770 500, 635 548"
            fill="none"
            stroke="url(#red-btl-right)"
            strokeWidth={36}
            strokeLinecap="round"
            strokeDasharray={520}
            strokeDashoffset={520 * (1 - rightArrowP)}
          />
          <g transform={`translate(622, 552) rotate(162) scale(${appear(localFrame, 16, 10)})`}>
            <polygon points="34,0 -26,-34 -12,0 -26,34" fill="#FBBF24" stroke="#FEF9C3" strokeWidth={3} />
          </g>
        </g>

        {/* Central Impact Shockwave & VS Brass Medallion */}
        <g transform="translate(540, 560)">
          <circle r={shockR} fill="none" stroke="#FEF08A" strokeWidth={3} opacity={shockOp} />
          <g transform={`scale(${clashP})`}>
            <circle r={56} fill="#1E0B0B" stroke="#F59E0B" strokeWidth={5} filter="url(#red-btl-shadow)" />
            <circle r={44} fill="none" stroke="#EF4444" strokeWidth={2} strokeDasharray="6 4" />
            <text
              x={0}
              y={13}
              textAnchor="middle"
              fill="#FEF3C7"
              fontFamily={THAI_FONT_FAMILY}
              fontSize={36}
              fontWeight={900}
            >
              VS
            </text>
          </g>
        </g>
      </svg>

      {/* Top Title Header */}
      <div
        style={{
          position: 'absolute',
          top: 72,
          left: 60,
          right: 60,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          opacity: titleP,
        }}
      >
        <div
          style={{
            padding: '7px 24px',
            borderRadius: 6,
            background: 'rgba(153, 27, 27, 0.85)',
            border: '1.5px solid #F59E0B',
            color: '#FDE68A',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 21,
            fontWeight: 800,
            letterSpacing: 1.5,
          }}
        >
          ⚔ {t.badge || 'TACTICAL COMPARISON // ศึกเทียบสองฝ่าย'}
        </div>
        <FitText text={t.title} baseSize={50} minSize={30} maxLines={2} color={fgColor} fontWeight={800} />
      </div>

      {/* Left Side War-Room Plaque */}
      <div
        style={{
          position: 'absolute',
          top: 740,
          left: 48,
          width: 472,
          minHeight: 240,
          padding: '16px 20px',
          borderRadius: 18,
          background: 'linear-gradient(170deg, rgba(98, 22, 22, 0.92) 0%, rgba(42, 11, 12, 0.96) 100%)',
          border: `2.5px solid ${cmp.winner === 'left' ? '#FBBF24' : '#EF4444'}`,
          boxShadow: '0 14px 32px rgba(0, 0, 0, 0.55)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: 10,
            borderBottom: '1.5px solid rgba(239, 68, 68, 0.45)',
          }}
        >
          <FitText text={cmp.leftTitle} baseSize={28} minSize={20} maxLines={2} lineHeight={1.28} color="#FCA5A5" fontWeight={800} align="left" />
          {cmp.winner === 'left' ? <span style={{ fontSize: 28, color: '#FBBF24' }}>★</span> : null}
        </div>
        {cmp.leftItems.map((item, i) => {
          const p = stagger(i, localFrame, 7, 12, 14);
          return (
            <div
              key={i}
              style={{
                padding: '12px 14px',
                borderRadius: 12,
                background: 'rgba(20, 6, 7, 0.55)',
                borderLeft: '4px solid #EF4444',
                opacity: p,
                transform: `translateX(${interpolate(p, [0, 1], [-20, 0])}px)`,
              }}
            >
              <FitText text={item} baseSize={21} minSize={16} maxLines={3} lineHeight={1.28} color="#FDF6EC" fontWeight={700} align="left" />
            </div>
          );
        })}
      </div>

      {/* Right Side War-Room Plaque */}
      <div
        style={{
          position: 'absolute',
          top: 740,
          left: 560,
          width: 472,
          minHeight: 240,
          padding: '16px 20px',
          borderRadius: 18,
          background: 'linear-gradient(170deg, rgba(58, 42, 22, 0.92) 0%, rgba(28, 20, 12, 0.96) 100%)',
          border: `2.5px solid ${cmp.winner === 'right' ? '#FEF08A' : '#F59E0B'}`,
          boxShadow: '0 14px 32px rgba(0, 0, 0, 0.55)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: 10,
            borderBottom: '1.5px solid rgba(245, 158, 11, 0.45)',
          }}
        >
          <FitText text={cmp.rightTitle} baseSize={28} minSize={20} maxLines={2} lineHeight={1.28} color="#FDE68A" fontWeight={800} align="left" />
          {cmp.winner === 'right' ? <span style={{ fontSize: 28, color: '#FEF08A' }}>★</span> : null}
        </div>
        {cmp.rightItems.map((item, i) => {
          const p = stagger(i, localFrame, 7, 14, 14);
          return (
            <div
              key={i}
              style={{
                padding: '12px 14px',
                borderRadius: 12,
                background: 'rgba(20, 14, 7, 0.55)',
                borderLeft: '4px solid #F59E0B',
                opacity: p,
                transform: `translateX(${interpolate(p, [0, 1], [20, 0])}px)`,
              }}
            >
              <FitText text={item} baseSize={21} minSize={16} maxLines={3} lineHeight={1.28} color="#FDF6EC" fontWeight={700} align="left" />
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-4 Shot 3: era-scroll — ไทม์ไลน์ม้วนคัมภีร์และแผ่นศิลาจารึกปีที่คลี่ออกทีละยุค */
const EraScrollShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const t = sceneTexts(scene);
  const entries = extractEraEntriesD(scene, 4);
  const fgColor = pickHexD(tokens?.palette?.fg, '#FDF6EC');

  const unrollP = spring({ frame: localFrame, fps, config: { damping: 18, stiffness: 90 } });
  const titleP = appear(localFrame, 0, 14);
  const scrollTop = 320;
  const maxScrollH = CONTENT_BOTTOM - scrollTop - 32;
  const currentScrollH = interpolate(unrollP, [0, 1], [140, maxScrollH]);
  const bottomRodY = scrollTop + currentScrollH;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <RedReliefBackdropD localFrame={localFrame} warmth="crimson" />

      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <filter id="red-scr-shadow" x="-15%" y="-15%" width="130%" height="130%">
            <feDropShadow dx="0" dy="14" stdDeviation="12" floodColor="#090202" floodOpacity="0.72" />
          </filter>
          <linearGradient id="red-scr-parchment" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#DEC7A3" />
            <stop offset="12%" stopColor="#F5E9D3" />
            <stop offset="88%" stopColor="#F3E5CC" />
            <stop offset="100%" stopColor="#D6BC95" />
          </linearGradient>
          <linearGradient id="red-scr-rod" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#B45309" />
            <stop offset="45%" stopColor="#78350F" />
            <stop offset="100%" stopColor="#451A03" />
          </linearGradient>
        </defs>

        {/* Unrolling Parchment / Stone Chronicle Sheet */}
        <g filter="url(#red-scr-shadow)">
          <rect
            x={94}
            y={scrollTop}
            width={892}
            height={currentScrollH}
            rx={6}
            fill="url(#red-scr-parchment)"
            stroke="#92400E"
            strokeWidth={3}
          />
          {/* Engraved inner crimson ornamental frame */}
          <rect
            x={116}
            y={scrollTop + 22}
            width={848}
            height={Math.max(40, currentScrollH - 44)}
            fill="none"
            stroke="#991B1B"
            strokeWidth={2}
            opacity={0.45}
          />
        </g>

        {/* Upper Wooden & Brass Scroll Roller */}
        <g transform={`translate(0, ${scrollTop})`} filter="url(#red-scr-shadow)">
          <rect x={60} y={-22} width={960} height={44} rx={22} fill="url(#red-scr-rod)" stroke="#F59E0B" strokeWidth={2.5} />
          <rect x={44} y={-28} width={34} height={56} rx={10} fill="#D97706" stroke="#FEF3C7" strokeWidth={2} />
          <rect x={1002} y={-28} width={34} height={56} rx={10} fill="#D97706" stroke="#FEF3C7" strokeWidth={2} />
        </g>

        {/* Lower Descending Scroll Roller */}
        <g transform={`translate(0, ${bottomRodY})`} filter="url(#red-scr-shadow)">
          <rect x={60} y={-22} width={960} height={44} rx={22} fill="url(#red-scr-rod)" stroke="#F59E0B" strokeWidth={2.5} />
          <rect x={44} y={-28} width={34} height={56} rx={10} fill="#D97706" stroke="#FEF3C7" strokeWidth={2} />
          <rect x={1002} y={-28} width={34} height={56} rx={10} fill="#D97706" stroke="#FEF3C7" strokeWidth={2} />
        </g>

        {/* Engraved vertical crimson timeline spine inside the scroll */}
        <line
          x1={232}
          y1={scrollTop + 62}
          x2={232}
          y2={Math.max(scrollTop + 70, bottomRodY - 62)}
          stroke="#991B1B"
          strokeWidth={5}
          strokeLinecap="round"
          opacity={0.75}
        />
      </svg>

      {/* Top Crimson Embossed Title Header above Scroll */}
      <div
        style={{
          position: 'absolute',
          top: 72,
          left: 64,
          right: 64,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          opacity: titleP,
        }}
      >
        <div
          style={{
            padding: '6px 22px',
            borderRadius: 6,
            background: '#991B1B',
            border: '1.5px solid #F59E0B',
            color: '#FEF3C7',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 21,
            fontWeight: 800,
            letterSpacing: 1.4,
          }}
        >
          ❖ {t.badge || 'HISTORICAL CHRONICLE // จารึกกาลเวลา'}
        </div>
        <FitText text={t.title} baseSize={50} minSize={30} maxLines={2} color={fgColor} fontWeight={800} />
      </div>

      {/* Era Entries rendered inside the unrolling scroll (clipped to scroll height, above SAFE_BOTTOM) */}
      <div
        style={{
          position: 'absolute',
          top: scrollTop + 42,
          left: 130,
          width: 820,
          height: Math.max(0, currentScrollH - 84),
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-around',
          gap: 16,
        }}
      >
        {entries.map((entry, i) => {
          const p = stagger(i, localFrame, 9, 10, 14);
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 24,
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [24, 0])}px)`,
              }}
            >
              {/* Wax Seal / Stone Year Stamp aligned on spine */}
              <div
                style={{
                  width: 196,
                  flexShrink: 0,
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, #991B1B 0%, #7F1D1D 100%)',
                  border: '2px solid #D97706',
                  boxShadow: '0 6px 14px rgba(69, 10, 10, 0.35)',
                  textAlign: 'center',
                }}
              >
                <FitText text={entry.tag} baseSize={22} minSize={16} maxLines={2} lineHeight={1.28} color="#FEF3C7" fontWeight={900} />
              </div>

              {/* Historical chronicle text on warm parchment */}
              <div
                style={{
                  flex: 1,
                  padding: '14px 20px',
                  borderRadius: 12,
                  background: 'rgba(120, 53, 15, 0.08)',
                  borderLeft: '4px solid #991B1B',
                }}
              >
                <FitText text={entry.text} baseSize={25} minSize={18} maxLines={4} lineHeight={1.3} color="#2A120E" fontWeight={800} align="left" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-4 Shot 4: monument — อนุสาวรีย์และเสาศิลาจารึกประโยคสำคัญสำหรับบทสรุป */
const MonumentShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps }) => {
  const q = extractQuoteD(scene);
  const t = sceneTexts(scene);
  const pts = extractShortPointsD(scene, 2);

  const riseP = spring({ frame: localFrame, fps, config: { damping: 16, stiffness: 95 } });
  const textP = appear(localFrame, 10, 18);
  const gleamX = interpolate((localFrame * 14) % 900, [0, 900], [-220, 1100]);
  const torchGlow = 0.72 + 0.28 * Math.sin(localFrame * 0.16);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <RedReliefBackdropD localFrame={localFrame} warmth="crimson" />

      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <filter id="red-mon-shadow" x="-20%" y="-20%" width="145%" height="145%">
            <feDropShadow dx="12" dy="18" stdDeviation="14" floodColor="#090202" floodOpacity="0.82" />
          </filter>
          <linearGradient id="red-mon-stone" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8E2A23" />
            <stop offset="50%" stopColor="#631A17" />
            <stop offset="100%" stopColor="#3B0F0E" />
          </linearGradient>
          <linearGradient id="red-mon-tablet" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2E0F0F" />
            <stop offset="100%" stopColor="#1B0809" />
          </linearGradient>
          <radialGradient id="red-mon-torch" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.55" />
            <stop offset="60%" stopColor="#DC2626" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#1A0C0E" stopOpacity="0" />
          </radialGradient>
          <clipPath id="red-mon-clip">
            <rect x={165} y={405} width={750} height={685} rx={12} />
          </clipPath>
        </defs>

        {/* Warm dramatic uplighting glow behind monument */}
        <circle cx={540} cy={1310} r={440} fill="url(#red-mon-torch)" opacity={torchGlow} />

        {/* Towering Sculpted Red-Stone Monument / Stela Pillar */}
        <g transform={`translate(0, ${interpolate(riseP, [0, 1], [110, 0])})`} opacity={riseP} filter="url(#red-mon-shadow)">
          {/* Pyramidion / Obelisk Crown Capstone */}
          <polygon points="540,148 845,305 235,305" fill="#9E3128" stroke="#E07A5F" strokeWidth={2.5} />
          <polygon points="540,148 845,305 540,305" fill="#5D1816" opacity={0.45} />

          {/* Carved Cornice Molding */}
          <rect x={175} y={305} width={730} height={38} rx={4} fill="#7F1D1D" stroke="#F59E0B" strokeWidth={2.5} />
          <rect x={135} y={343} width={810} height={24} rx={4} fill="#5C1514" stroke="#E07A5F" strokeWidth={2} />

          {/* Main Stone Pillar Shaft */}
          <rect x={132} y={367} width={816} height={770} rx={6} fill="url(#red-mon-stone)" stroke="#C25943" strokeWidth={3} />

          {/* Recessed Engraved Tablet Face */}
          <rect x={165} y={405} width={750} height={685} rx={12} fill="url(#red-mon-tablet)" stroke="#D97706" strokeWidth={3} />
          <rect x={182} y={422} width={716} height={651} rx={8} fill="none" stroke="#991B1B" strokeWidth={2} />

          {/* Subtle chiseled light gleam sweeping diagonally across stone plaque */}
          <g clipPath="url(#red-mon-clip)">
            <polygon
              points={`${gleamX},390 ${gleamX + 110},390 ${gleamX - 70},1110 ${gleamX - 180},1110`}
              fill="#FEF08A"
              opacity={0.07}
            />
          </g>

          {/* Ornamental Brass Laurel Crest inside Tablet Top */}
          <g transform="translate(540, 488)">
            <path d="M -95 10 C -65 -14, -28 -18, 0 -4 C 28 -18, 65 -14, 95 10" fill="none" stroke="#F59E0B" strokeWidth={4} strokeLinecap="round" />
            <circle cx={0} cy={-4} r={12} fill="#F59E0B" />
            <circle cx={-55} cy={-4} r={5} fill="#FDE68A" />
            <circle cx={55} cy={-4} r={5} fill="#FDE68A" />
          </g>

          {/* Stepped Monument Plinth & Pedestal Base (strictly above CONTENT_BOTTOM=1420) */}
          <rect x={102} y={1137} width={876} height={46} rx={4} fill="#7F1D1D" stroke="#F59E0B" strokeWidth={2.5} />
          <rect x={76} y={1183} width={928} height={156} rx={6} fill="#4A1212" stroke="#B94836" strokeWidth={3} />
          <rect x={54} y={1339} width={972} height={76} rx={6} fill="#310B0C" stroke="#991B1B" strokeWidth={2.5} />

          {/* Left & Right Ceremonial Braziers on Pedestal */}
          {[148, 932].map((bx, idx) => (
            <g key={idx} transform={`translate(${bx}, 1134)`}>
              <path d="M -28 0 L 28 0 L 18 28 L -18 28 Z" fill="#B45309" stroke="#FDE68A" strokeWidth={2} />
              <path
                d={`M 0 ${-48 - (idx % 2) * 4 + Math.sin(localFrame * 0.25 + idx) * 6} C 18 -26, 22 -8, 0 0 C -22 -8, -18 -26, 0 ${-48 + Math.sin(localFrame * 0.25 + idx) * 6} Z`}
                fill="#F59E0B"
                opacity={0.9}
              />
              <path d="M 0 -28 C 8 -16, 10 -6, 0 0 C -10 -6, -8 -16, 0 -28 Z" fill="#FEF9C3" />
            </g>
          ))}
        </g>
      </svg>

      {/* Engraved Badge Ribbon */}
      <div
        style={{
          position: 'absolute',
          top: 528,
          left: 200,
          right: 200,
          display: 'flex',
          justifyContent: 'center',
          opacity: textP,
        }}
      >
        <div
          style={{
            padding: '7px 24px',
            borderRadius: 6,
            background: 'rgba(180, 83, 9, 0.28)',
            border: '1.5px solid #F59E0B',
            color: '#FDE68A',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: 1.6,
          }}
        >
          {q.badge}
        </div>
      </div>

      {/* Engraved Main Monument Quote / Summary */}
      <div
        style={{
          position: 'absolute',
          top: 590,
          left: 205,
          right: 205,
          height: 356,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 18,
          opacity: textP,
          transform: `translateY(${interpolate(textP, [0, 1], [24, 0])}px)`,
          textShadow: '0 4px 12px rgba(0, 0, 0, 0.85)',
        }}
      >
        <FitText text={`“${q.main}”`} baseSize={52} minSize={28} maxLines={4} lineHeight={1.3} color="#FEF3C7" fontWeight={800} />
      </div>

      {/* Attribution / Secondary Key Line inside Tablet Bottom */}
      <div
        style={{
          position: 'absolute',
          top: 966,
          left: 198,
          right: 198,
          opacity: appear(localFrame, 16, 14),
        }}
      >
        <FitText
          text={q.sub || t.subtitle || pts[0] || ''}
          baseSize={20}
          minSize={15}
          maxLines={3}
          lineHeight={1.28}
          color="#F59E0B"
          fontWeight={700}
        />
      </div>

      {/* Stepped Pedestal Base Inscription Plaque (above SAFE_BOTTOM=1540) */}
      <div
        style={{
          position: 'absolute',
          top: 1208,
          left: 118,
          right: 118,
          minHeight: 112,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: appear(localFrame, 18, 16),
        }}
      >
        <FitText
          text={pts[1] || t.title || q.main}
          baseSize={26}
          minSize={18}
          maxLines={2}
          lineHeight={1.28}
          color="#F5E6D3"
          fontWeight={700}
        />
      </div>
    </div>
  );
};

// ============================================================================
// STYLE 3: look-6 — DEEP TIME (กาลเวลาอันยาวนาน)
// World: Deep cosmic space, spiral galaxies, astronomical dials & glowing
// planetary orbits paired with tactile geological Earth strata cross-sections.
// ============================================================================

const DEEP_STARS_D: ReadonlyArray<[number, number, number, number, string]> = [
  [78, 118, 2.2, 0.85, '#F8FAFC'],
  [186, 224, 1.5, 0.6, '#BAE6FD'],
  [310, 92, 2.6, 0.9, '#FEF3C7'],
  [468, 165, 1.4, 0.55, '#E2E8F0'],
  [650, 84, 2.3, 0.8, '#BAE6FD'],
  [815, 190, 1.9, 0.7, '#FDE68A'],
  [962, 112, 2.5, 0.9, '#FFFFFF'],
  [1018, 295, 1.6, 0.65, '#CBD5E1'],
  [96, 445, 2.0, 0.7, '#FDE68A'],
  [940, 488, 2.2, 0.75, '#BAE6FD'],
  [142, 725, 1.7, 0.6, '#FFFFFF'],
  [986, 792, 2.1, 0.8, '#FDE68A'],
  [84, 1020, 1.8, 0.65, '#BAE6FD'],
  [952, 1085, 2.4, 0.8, '#FFFFFF'],
  [168, 1345, 1.9, 0.65, '#FEF3C7'],
  [892, 1390, 2.0, 0.7, '#BAE6FD'],
  [412, 1465, 1.6, 0.55, '#FFFFFF'],
  [698, 1490, 1.8, 0.6, '#FDE68A'],
  [255, 590, 1.5, 0.5, '#E0F2FE'],
  [785, 625, 1.7, 0.55, '#FEF08A'],
];

const DeepTimeBackdropD: React.FC<{
  localFrame: number;
  bgBase?: string;
  nebulaX?: number;
  nebulaY?: number;
  accentTone?: 'indigo' | 'amber' | 'teal';
}> = ({ localFrame, bgBase = '#0B0E14', nebulaX = 540, nebulaY = 640, accentTone = 'indigo' }) => {
  const neb1 =
    accentTone === 'amber'
      ? 'rgba(217, 119, 6, 0.22)'
      : accentTone === 'teal'
        ? 'rgba(14, 165, 233, 0.22)'
        : 'rgba(99, 102, 241, 0.22)';
  const neb2 =
    accentTone === 'amber'
      ? 'rgba(97, 56, 33, 0.26)'
      : accentTone === 'teal'
        ? 'rgba(99, 102, 241, 0.16)'
        : 'rgba(245, 158, 11, 0.14)';

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(circle at ${nebulaX}px ${nebulaY}px, ${neb1} 0%, ${neb2} 38%, ${bgBase} 74%, #06070B 100%)`,
      }}
    >
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {/* Twinkling deep-space starfield */}
        {DEEP_STARS_D.map(([x, y, r, baseOp, col], i) => {
          const tw = 0.45 + 0.55 * Math.sin(localFrame * 0.07 + i * 1.9);
          return <circle key={i} cx={x} cy={y} r={r} fill={col} opacity={baseOp * tw} />;
        })}

        {/* Documentary deep-time precision edge scale ticks */}
        <g stroke="#64748B" strokeWidth={1.4} opacity={0.34}>
          {Array.from({ length: 18 }).map((_, i) => {
            const y = 120 + i * 80;
            const len = i % 4 === 0 ? 22 : 10;
            return (
              <g key={i}>
                <line x1={22} y1={y} x2={22 + len} y2={y} />
                <line x1={STAGE_W - 22 - len} y1={y} x2={STAGE_W - 22} y2={y} />
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
};

/** look-6 Shot 1: cosmic-zoom — ซูมจักรวาลจากกาแล็กซีสู่ดาวเคราะห์และจุดข้อมูลสำคัญ */
const CosmicZoomShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const t = sceneTexts(scene);
  const points = extractShortPointsD(scene, 3);
  const bgBase = pickHexD(tokens?.palette?.bg, '#0B0E14');
  const fgColor = pickHexD(tokens?.palette?.fg, '#F2F4F8');

  const zoomP = spring({ frame: localFrame, fps, config: { damping: 18, stiffness: 85 } });
  const reticleP = appear(localFrame, 12, 16);
  const titleP = appear(localFrame, 2, 14);
  const galRot = localFrame * 0.25;
  const cx = 540;
  const cy = 560;
  const targetX = cx + 46;
  const targetY = cy - 24;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <DeepTimeBackdropD localFrame={localFrame} bgBase={bgBase} nebulaX={cx} nebulaY={cy} accentTone="teal" />

      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <filter id="dt-zoom-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="10" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="dt-zoom-galaxy" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FEF3C7" stopOpacity="0.65" />
            <stop offset="32%" stopColor="#6366F1" stopOpacity="0.34" />
            <stop offset="68%" stopColor="#0EA5E9" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#0B0E14" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="dt-zoom-planet" cx="35%" cy="32%" r="68%">
            <stop offset="0%" stopColor="#60A5FA" />
            <stop offset="48%" stopColor="#1D4ED8" />
            <stop offset="82%" stopColor="#0F2547" />
            <stop offset="100%" stopColor="#060D1C" />
          </radialGradient>
          <clipPath id="dt-zoom-planet-clip">
            <circle cx={cx} cy={cy} r={178} />
          </clipPath>
        </defs>

        {/* Outer Spiral Galaxy Layer zooming smoothly */}
        <g
          transform={`translate(${cx}, ${cy}) scale(${interpolate(zoomP, [0, 1], [0.72, 0.96])}) rotate(${galRot})`}
          opacity={0.78}
        >
          <ellipse cx={0} cy={0} rx={480} ry={255} fill="url(#dt-zoom-galaxy)" />
          {/* Logarithmic spiral arms */}
          <path
            d="M 0 0 C 90 -40, 210 -120, 380 -95 C 455 -84, 480 -15, 430 48"
            fill="none"
            stroke="#93C5FD"
            strokeWidth={7}
            strokeLinecap="round"
            opacity={0.35}
            filter="url(#dt-zoom-glow)"
          />
          <path
            d="M 0 0 C -90 40, -210 120, -380 95 C -455 84, -480 15, -430 -48"
            fill="none"
            stroke="#A5B4FC"
            strokeWidth={7}
            strokeLinecap="round"
            opacity={0.35}
            filter="url(#dt-zoom-glow)"
          />
          <path
            d="M 0 0 C 55 80, 145 165, 295 160"
            fill="none"
            stroke="#FDE68A"
            strokeWidth={4}
            strokeLinecap="round"
            opacity={0.28}
          />
          <path
            d="M 0 0 C -55 -80, -145 -165, -295 -160"
            fill="none"
            stroke="#FDE68A"
            strokeWidth={4}
            strokeLinecap="round"
            opacity={0.28}
          />
        </g>

        {/* Telescopic Optical Zoom Rings */}
        <g transform={`translate(${cx}, ${cy})`} opacity={0.55}>
          <circle r={300} fill="none" stroke="#94A3B8" strokeWidth={1.2} strokeDasharray="10 12" />
          <circle r={238} fill="none" stroke="#38BDF8" strokeWidth={1.6} strokeDasharray="48 18" transform={`rotate(${-localFrame * 0.4})`} />
        </g>

        {/* Illuminated Planet Sphere emerging into optical focus */}
        <g transform={`translate(${cx}, ${cy}) scale(${interpolate(zoomP, [0, 1], [0.42, 1])}) translate(${-cx}, ${-cy})`}>
          {/* Atmospheric limb halo */}
          <circle cx={cx} cy={cy} r={192} fill="#38BDF8" opacity={0.18} filter="url(#dt-zoom-glow)" />
          <circle cx={cx} cy={cy} r={178} fill="url(#dt-zoom-planet)" stroke="#7DD3FC" strokeWidth={2.5} />

          {/* Continents & swirling cloud bands clipped to planet sphere */}
          <g clipPath="url(#dt-zoom-planet-clip)">
            <path
              d={`M ${cx - 120} ${cy - 75} C ${cx - 45} ${cy - 115}, ${cx + 40} ${cy - 70}, ${cx + 75} ${cy - 15} C ${cx + 95} ${cy + 25}, ${cx + 25} ${cy + 85}, ${cx - 35} ${cy + 65} C ${cx - 95} ${cy + 45}, ${cx - 155} ${cy - 20}, ${cx - 120} ${cy - 75} Z`}
              fill="#5B8C5A"
              opacity={0.68}
            />
            <path
              d={`M ${cx + 80} ${cy + 55} C ${cx + 135} ${cy + 30}, ${cx + 185} ${cy + 80}, ${cx + 155} ${cy + 145} C ${cx + 115} ${cy + 185}, ${cx + 45} ${cy + 150}, ${cx + 80} ${cy + 55} Z`}
              fill="#8D6E48"
              opacity={0.55}
            />
            {/* Cloud wisps */}
            <path
              d={`M ${cx - 190} ${cy - 45} Q ${cx - 20} ${cy - 75}, ${cx + 170} ${cy - 35}`}
              fill="none"
              stroke="#E0F2FE"
              strokeWidth={14}
              strokeLinecap="round"
              opacity={0.22}
            />
            <path
              d={`M ${cx - 150} ${cy + 95} Q ${cx + 10} ${cy + 65}, ${cx + 185} ${cy + 105}`}
              fill="none"
              stroke="#E0F2FE"
              strokeWidth={10}
              strokeLinecap="round"
              opacity={0.18}
            />
            {/* Deep crescent terminator shadow */}
            <circle cx={cx + 66} cy={cy + 38} r={186} fill="#040812" opacity={0.44} />
          </g>

          {/* Tilted Planetary Orbital Ring */}
          <ellipse
            cx={cx}
            cy={cy}
            rx={262}
            ry={58}
            fill="none"
            stroke="#FDE68A"
            strokeWidth={2.5}
            strokeDasharray="16 8"
            transform={`rotate(-16 ${cx} ${cy})`}
            opacity={0.55}
          />
        </g>

        {/* Precision Data Point Lock on Planet Surface + Leader Beam to Data Panel */}
        <g opacity={reticleP}>
          <circle cx={targetX} cy={targetY} r={10} fill="#F59E0B" filter="url(#dt-zoom-glow)" />
          <circle cx={targetX} cy={targetY} r={24 + Math.sin(localFrame * 0.14) * 5} fill="none" stroke="#FDE68A" strokeWidth={2.5} />
          <path
            d={`M ${targetX - 34} ${targetY} L ${targetX - 16} ${targetY} M ${targetX + 16} ${targetY} L ${targetX + 34} ${targetY} M ${targetX} ${targetY - 34} L ${targetX} ${targetY - 16} M ${targetX} ${targetY + 16} L ${targetX} ${targetY + 34}`}
            stroke="#FEF08A"
            strokeWidth={2.2}
          />
          <polyline
            points={`${targetX},${targetY + 34} ${targetX},${cy + 215} ${cx},${cy + 268} ${cx},895`}
            fill="none"
            stroke="#F59E0B"
            strokeWidth={2.5}
            strokeDasharray="8 6"
          />
          <circle cx={cx} cy={895} r={6} fill="#FEF08A" />
        </g>
      </svg>

      {/* Top Deep-Space Documentary Title */}
      <div
        style={{
          position: 'absolute',
          top: 72,
          left: 68,
          right: 68,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          opacity: titleP,
        }}
      >
        <div
          style={{
            padding: '7px 24px',
            borderRadius: 999,
            border: '1.5px solid rgba(245, 158, 11, 0.65)',
            background: 'rgba(17, 22, 34, 0.8)',
            color: '#FDE68A',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 21,
            fontWeight: 800,
            letterSpacing: 1.5,
          }}
        >
          ✦ {t.badge || 'COSMIC ZOOM // GALAXY → PLANET → DATA'}
        </div>
        <FitText text={t.title} baseSize={54} minSize={32} maxLines={2} color={fgColor} fontWeight={800} />
      </div>

      {/* Bottom Locked Data Focus Module (strictly above CONTENT_BOTTOM=1420) */}
      <div
        style={{
          position: 'absolute',
          top: 905,
          left: 64,
          right: 64,
          padding: '18px 24px',
          borderRadius: 20,
          background: 'linear-gradient(160deg, rgba(20, 27, 42, 0.92) 0%, rgba(11, 14, 22, 0.96) 100%)',
          border: '1.5px solid rgba(245, 158, 11, 0.58)',
          boxShadow: '0 16px 40px rgba(0, 0, 0, 0.65)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          opacity: reticleP,
        }}
      >
        {t.subtitle ? (
          <div style={{ paddingBottom: 8, borderBottom: '1px solid rgba(148, 163, 184, 0.25)' }}>
            <FitText text={t.subtitle} baseSize={22} minSize={17} maxLines={2} lineHeight={1.28} color="#FDE68A" fontWeight={700} align="left" />
          </div>
        ) : null}

        {points.slice(0, 3).map((pt, i) => {
          const p = stagger(i, localFrame, 7, 14, 14);
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [18, 0])}px)`,
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 99,
                  flexShrink: 0,
                  background: i === 0 ? '#F59E0B' : '#38BDF8',
                  boxShadow: i === 0 ? '0 0 12px #F59E0B' : '0 0 12px #38BDF8',
                }}
              />
              <div style={{ flex: 1 }}>
                <FitText text={pt} baseSize={22} minSize={17} maxLines={3} lineHeight={1.28} color="#F1F5F9" fontWeight={700} align="left" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-6 Shot 2: strata-layers — ชั้นหินธรณีวิทยาที่แต่ละประเด็นคือหนึ่งยุคสมัย */
const StrataLayersShot: React.FC<StyleShotArgs> = ({ scene, localFrame, tokens }) => {
  const t = sceneTexts(scene);
  const entries = extractEraEntriesD(scene, 4);
  const bgBase = pickHexD(tokens?.palette?.bg, '#0D1017');
  const fgColor = pickHexD(tokens?.palette?.fg, '#F8FAFC');
  const titleP = appear(localFrame, 0, 14);

  // Geological strata palettes from upper younger sediment down to deep ancient bedrock
  const strataStyles: ReadonlyArray<{
    fillTop: string;
    fillBot: string;
    rim: string;
    tagBg: string;
    depth: string;
  }> = [
    { fillTop: '#B8733A', fillBot: '#945728', rim: '#E6B17A', tagBg: '#5C2F12', depth: '0.2 km' },
    { fillTop: '#8C472B', fillBot: '#6B331D', rim: '#D48A6A', tagBg: '#471F11', depth: '1.8 km' },
    { fillTop: '#5E342A', fillBot: '#43241E', rim: '#B07465', tagBg: '#2D1510', depth: '4.5 km' },
    { fillTop: '#2E3A47', fillBot: '#1E2732', rim: '#7C93AA', tagBg: '#121922', depth: '9.2 km' },
  ];

  const bandStartY = 365;
  const bandSpan = Math.floor((CONTENT_BOTTOM - 16 - bandStartY) / Math.max(1, entries.length));

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <DeepTimeBackdropD localFrame={localFrame} bgBase={bgBase} nebulaX={540} nebulaY={220} accentTone="amber" />

      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          {strataStyles.map((st, idx) => (
            <linearGradient key={idx} id={`dt-str-grad-${idx}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={st.fillTop} />
              <stop offset="100%" stopColor={st.fillBot} />
            </linearGradient>
          ))}
        </defs>

        {/* Distant mountain horizon ridge separating starry sky from Earth crust */}
        <path
          d="M 0 355 L 140 302 L 295 340 L 475 280 L 660 336 L 845 292 L 1080 350 L 1080 400 L 0 400 Z"
          fill="#261C19"
          stroke="#8C583A"
          strokeWidth={2}
          opacity={0.92}
        />

        {/* Organic Wavy Geological Rock Strata Layers */}
        {entries.map((_, i) => {
          const st = strataStyles[i % strataStyles.length];
          const p = stagger(i, localFrame, 8, 6, 16);
          const y0 = bandStartY + i * bandSpan;
          const y1 = i === entries.length - 1 ? STAGE_H : y0 + bandSpan + 28;
          const wave = i % 2 === 0 ? 18 : -18;
          const slideY = interpolate(p, [0, 1], [60, 0]);
          const d = `M 0 ${y0} C 260 ${y0 + wave}, 520 ${y0 - wave}, 810 ${y0 + wave * 0.7} C 940 ${y0 + wave * 0.3}, 1020 ${y0 - wave * 0.4}, ${STAGE_W} ${y0} L ${STAGE_W} ${y1} L 0 ${y1} Z`;

          return (
            <g key={i} transform={`translate(0, ${slideY})`} opacity={p}>
              <path d={d} fill={`url(#dt-str-grad-${i % strataStyles.length})`} />
              {/* Highlighted sedimentary bedding line along top contour */}
              <path
                d={`M 0 ${y0} C 260 ${y0 + wave}, 520 ${y0 - wave}, 810 ${y0 + wave * 0.7} C 940 ${y0 + wave * 0.3}, 1020 ${y0 - wave * 0.4}, ${STAGE_W} ${y0}`}
                fill="none"
                stroke={st.rim}
                strokeWidth={4}
                opacity={0.72}
              />
              {/* Subtle sedimentary rock fissure striations */}
              <path
                d={`M 65 ${y0 + bandSpan * 0.62} Q 340 ${y0 + bandSpan * 0.56}, 640 ${y0 + bandSpan * 0.64} T 1015 ${y0 + bandSpan * 0.6}`}
                fill="none"
                stroke="#0F0B0A"
                strokeWidth={2}
                strokeDasharray="24 18 8 14"
                opacity={0.28}
              />
              {/* Embedded spiral ammonite fossil / mineral crystal icon on right edge */}
              <g transform={`translate(992, ${y0 + bandSpan * 0.52})`} opacity={0.42}>
                {i % 2 === 0 ? (
                  <path
                    d="M 0 0 C 12 -12, 28 -4, 24 12 C 20 28, -4 30, -14 16 C -22 4, -14 -18, 6 -22"
                    fill="none"
                    stroke="#FDE68A"
                    strokeWidth={3}
                    strokeLinecap="round"
                  />
                ) : (
                  <polygon points="0,-24 14,-6 8,22 -10,22 -16,-4" fill="none" stroke="#BAE6FD" strokeWidth={3} />
                )}
              </g>
            </g>
          );
        })}

        {/* Vertical geological depth drill-core gauge on far left */}
        <line x1={46} y1={bandStartY + 12} x2={46} y2={CONTENT_BOTTOM - 16} stroke="#FDE68A" strokeWidth={2.5} strokeDasharray="6 6" opacity={0.55} />
      </svg>

      {/* Top Starry Sky Title Header */}
      <div
        style={{
          position: 'absolute',
          top: 66,
          left: 64,
          right: 64,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          opacity: titleP,
        }}
      >
        <div
          style={{
            padding: '6px 22px',
            borderRadius: 999,
            background: 'rgba(140, 71, 43, 0.45)',
            border: '1.5px solid #D4A373',
            color: '#FDE68A',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 21,
            fontWeight: 800,
            letterSpacing: 1.4,
          }}
        >
          ▤ {t.badge || 'GEOLOGICAL STRATA // ชั้นหินกาลเวลา'}
        </div>
        <FitText text={t.title} baseSize={52} minSize={30} maxLines={2} color={fgColor} fontWeight={800} />
      </div>

      {/* Text Content anchored cleanly inside each geological stratum band (strictly above CONTENT_BOTTOM=1420) */}
      {entries.map((entry, i) => {
        const st = strataStyles[i % strataStyles.length];
        const p = stagger(i, localFrame, 8, 8, 16);
        const y0 = bandStartY + i * bandSpan;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              top: y0 + 20,
              left: 74,
              right: 92,
              minHeight: bandSpan - 28,
              display: 'flex',
              alignItems: 'center',
              gap: 22,
              opacity: p,
              transform: `translateY(${interpolate(p, [0, 1], [30, 0])}px)`,
            }}
          >
            {/* Era Depth Badge */}
            <div
              style={{
                width: 190,
                flexShrink: 0,
                padding: '10px 14px',
                borderRadius: 12,
                background: st.tagBg,
                border: `1.5px solid ${st.rim}`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <FitText text={entry.tag} baseSize={22} minSize={16} maxLines={2} lineHeight={1.28} color="#FEF3C7" fontWeight={900} />
              <span style={{ fontFamily: THAI_FONT_FAMILY, fontSize: 16, fontWeight: 700, color: st.rim }}>
                DEPTH {st.depth}
              </span>
            </div>

            {/* Era Description inside rock band */}
            <div style={{ flex: 1, textShadow: '0 3px 10px rgba(0, 0, 0, 0.6)' }}>
              <FitText text={entry.text} baseSize={24} minSize={17} maxLines={3} lineHeight={1.3} color="#FFFBF5" fontWeight={800} align="left" />
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** look-6 Shot 3: clock-spiral — เกลียวเวลาขนาดมหึมาสำหรับตัวเลขใหญ่และสเกลนับล้านปี */
const ClockSpiralShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const t = sceneTexts(scene);
  const metric = extractPrimaryMetricD(scene, sceneIndex);
  const points = extractShortPointsD(scene, 3);
  const bgBase = pickHexD(tokens?.palette?.bg, '#090C12');
  const fgColor = pickHexD(tokens?.palette?.fg, '#F8FAFC');

  const spiralP = appear(localFrame, 2, 36);
  const coreP = spring({ frame: Math.max(0, localFrame - 6), fps, config: { damping: 14, stiffness: 120 } });
  const titleP = appear(localFrame, 0, 14);
  const cx = 540;
  const cy = 625;

  // Generate smooth Archimedean time spiral SVG path (3.2 full turns)
  const spiralSamples = 110;
  const spiralPts: Array<[number, number]> = [];
  for (let i = 0; i <= spiralSamples; i++) {
    const u = i / spiralSamples;
    const angle = u * Math.PI * 2 * 3.15 - Math.PI / 2;
    const radius = 48 + u * 292;
    spiralPts.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
  const spiralD = spiralPts.map(([x, y], idx) => `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const spiralLen = 4200;

  const handDeg = localFrame * 1.6;
  const slowHandDeg = localFrame * 0.28;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <DeepTimeBackdropD localFrame={localFrame} bgBase={bgBase} nebulaX={cx} nebulaY={cy} accentTone="amber" />

      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <filter id="dt-clk-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="9" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="dt-clk-spiral" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FEF08A" />
            <stop offset="48%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#38BDF8" />
          </linearGradient>
          <radialGradient id="dt-clk-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.45" />
            <stop offset="65%" stopColor="#1E293B" stopOpacity="0.72" />
            <stop offset="100%" stopColor="#090C12" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Outer Astrolabe Dial Frame */}
        <g transform={`translate(${cx}, ${cy})`}>
          <circle r={352} fill="url(#dt-clk-core)" opacity={0.75} />
          <circle r={346} fill="none" stroke="#F59E0B" strokeWidth={2.5} opacity={0.45} />
          <circle r={326} fill="none" stroke="#94A3B8" strokeWidth={1.2} strokeDasharray="6 10" opacity={0.45} />
          {/* 24 Astronomical Clock Dial Ticks */}
          {Array.from({ length: 24 }).map((_, i) => {
            const rad = (i * 15 * Math.PI) / 180;
            const inner = i % 2 === 0 ? 324 : 334;
            return (
              <line
                key={i}
                x1={Math.cos(rad) * inner}
                y1={Math.sin(rad) * inner}
                x2={Math.cos(rad) * 346}
                y2={Math.sin(rad) * 346}
                stroke={i % 6 === 0 ? '#FEF08A' : '#94A3B8'}
                strokeWidth={i % 6 === 0 ? 3.5 : 1.5}
              />
            );
          })}
          {/* Sweeping Cosmic Clock Hands behind center medal */}
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={-285}
            stroke="#FDE68A"
            strokeWidth={3}
            strokeLinecap="round"
            opacity={0.45}
            transform={`rotate(${handDeg})`}
          />
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={-210}
            stroke="#38BDF8"
            strokeWidth={5}
            strokeLinecap="round"
            opacity={0.5}
            transform={`rotate(${slowHandDeg})`}
          />
        </g>

        {/* Luminous Archimedean Time Spiral Path */}
        <path
          d={spiralD}
          fill="none"
          stroke="url(#dt-clk-spiral)"
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={spiralLen}
          strokeDashoffset={spiralLen * (1 - spiralP)}
          filter="url(#dt-clk-glow)"
          opacity={0.88}
        />

        {/* Epoch Milestone Beads along Spiral Arms */}
        {[28, 56, 82, 106].map((idx, k) => {
          const pt = spiralPts[idx];
          if (!pt) return null;
          const bp = stagger(k, localFrame, 7, 10, 12);
          return (
            <g key={k} transform={`translate(${pt[0]}, ${pt[1]}) scale(${bp})`}>
              <circle r={13} fill="#0F172A" stroke="#FEF08A" strokeWidth={3.5} filter="url(#dt-clk-glow)" />
              <circle r={5} fill="#F59E0B" />
            </g>
          );
        })}

        {/* Central Astrolabe Scale Medallion */}
        <g transform={`translate(${cx}, ${cy}) scale(${coreP})`}>
          <circle r={168} fill="rgba(11, 15, 24, 0.92)" stroke="#F59E0B" strokeWidth={4} filter="url(#dt-clk-glow)" />
          <circle r={150} fill="none" stroke="#FDE68A" strokeWidth={1.5} strokeDasharray="10 8" opacity={0.6} />
        </g>
      </svg>

      {/* Top Documentary Header */}
      <div
        style={{
          position: 'absolute',
          top: 66,
          left: 64,
          right: 64,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          opacity: titleP,
        }}
      >
        <div
          style={{
            padding: '6px 22px',
            borderRadius: 999,
            background: 'rgba(245, 158, 11, 0.18)',
            border: '1.5px solid #F59E0B',
            color: '#FEF3C7',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 21,
            fontWeight: 800,
            letterSpacing: 1.5,
          }}
        >
          ◷ {t.badge || 'DEEP TIME SPIRAL // สเกลกาลเวลา'}
        </div>
        <FitText text={t.title} baseSize={50} minSize={30} maxLines={2} color={fgColor} fontWeight={800} />
      </div>

      {/* Central Hero Number / Time Scale inside Spiral Core */}
      <div
        style={{
          position: 'absolute',
          top: cy - 118,
          left: cx - 156,
          width: 312,
          height: 236,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          opacity: coreP,
          transform: `scale(${interpolate(coreP, [0, 1], [0.72, 1])})`,
          textShadow: '0 0 28px rgba(245, 158, 11, 0.65)',
        }}
      >
        <FitText text={metric.big} baseSize={68} minSize={32} maxLines={2} color="#FEF3C7" fontWeight={900} />
        {metric.unit ? (
          <FitText text={metric.unit} baseSize={25} minSize={18} maxLines={2} color="#F59E0B" fontWeight={700} />
        ) : null}
      </div>

      {/* Bottom Epoch Scale Milestone Cards (strictly above CONTENT_BOTTOM=1420) */}
      {(() => {
        const hasMetricSub = Boolean(metric.label && metric.label !== t.title);
        return (
          <div
            style={{
              position: 'absolute',
              top: 990,
              left: 58,
              right: 58,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {hasMetricSub ? (
              <div style={{ textAlign: 'center', marginBottom: 2, opacity: appear(localFrame, 10, 14) }}>
                <FitText text={metric.label} baseSize={23} minSize={17} maxLines={2} lineHeight={1.28} color="#FDE68A" fontWeight={700} />
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
              {points.slice(0, 3).map((pt, i) => {
                const p = stagger(i, localFrame, 7, 14, 14);
                return (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      minHeight: 196,
                      padding: '14px 16px',
                      borderRadius: 16,
                      background: 'rgba(17, 22, 34, 0.88)',
                      border: '1.5px solid rgba(245, 158, 11, 0.45)',
                      borderTop: `4px solid ${i === 0 ? '#FEF08A' : i === 1 ? '#F59E0B' : '#38BDF8'}`,
                      display: 'flex',
                      flexDirection: 'column',
                      opacity: p,
                      transform: `translateY(${interpolate(p, [0, 1], [22, 0])}px)`,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: THAI_FONT_FAMILY,
                        fontSize: 18,
                        fontWeight: 800,
                        color: '#94A3B8',
                        marginBottom: 6,
                        flexShrink: 0,
                      }}
                    >
                      EPOCH 0{i + 1}
                    </div>
                    <FitText
                      text={pt}
                      baseSize={20}
                      minSize={15}
                      maxLines={4}
                      lineHeight={1.28}
                      color="#F8FAFC"
                      fontWeight={700}
                      align="left"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

/** look-6 Shot 4: planet-orbit — ระบบดาวเคราะห์โคจรรอบดวงอาทิตย์โดยแต่ละดวงติดป้ายประเด็นสำคัญ */
const PlanetOrbitShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const t = sceneTexts(scene);
  const points = extractShortPointsD(scene, 4);
  const bgBase = pickHexD(tokens?.palette?.bg, '#070A12');
  const fgColor = pickHexD(tokens?.palette?.fg, '#F8FAFC');

  const sunP = spring({ frame: localFrame, fps, config: { damping: 16, stiffness: 110 } });
  const titleP = appear(localFrame, 0, 14);
  const sunX = 540;
  const sunY = 400;
  const coronaPulse = 1 + 0.04 * Math.sin(localFrame * 0.11);

  // Orbit definitions sweeping gracefully below the sun with generous vertical spacing so Thai labels never overlap
  const orbitSpecs: ReadonlyArray<{
    rx: number;
    ry: number;
    baseDeg: number;
    radius: number;
    col1: string;
    col2: string;
    hasRing?: boolean;
    labelSide: 'right' | 'left';
  }> = [
    { rx: 335, ry: 240, baseDeg: 136, radius: 34, col1: '#F87171', col2: '#991B1B', labelSide: 'right' },
    { rx: 425, ry: 445, baseDeg: 54, radius: 42, col1: '#38BDF8', col2: '#1D4ED8', labelSide: 'left' },
    { rx: 465, ry: 645, baseDeg: 122, radius: 46, col1: '#FBBF24', col2: '#B45309', hasRing: true, labelSide: 'right' },
    { rx: 495, ry: 845, baseDeg: 62, radius: 38, col1: '#A78BFA', col2: '#4C1D95', labelSide: 'left' },
  ];

  // Compute live animated positions for active planets
  const activeOrbits = points.map((pt, i) => {
    const spec = orbitSpecs[i % orbitSpecs.length];
    const oscDeg = Math.sin(localFrame * 0.032 + i * 1.4) * 5.5;
    const rad = ((spec.baseDeg + oscDeg) * Math.PI) / 180;
    const px = sunX + Math.cos(rad) * spec.rx;
    const py = sunY + Math.sin(rad) * spec.ry;
    return { pt, spec, px, py };
  });

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <DeepTimeBackdropD localFrame={localFrame} bgBase={bgBase} nebulaX={sunX} nebulaY={sunY} accentTone="indigo" />

      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <filter id="dt-orb-glow" x="-35%" y="-35%" width="170%" height="170%">
            <feGaussianBlur stdDeviation="12" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="dt-orb-sun" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFBEB" />
            <stop offset="42%" stopColor="#FBBF24" />
            <stop offset="78%" stopColor="#EA580C" />
            <stop offset="100%" stopColor="#9A3412" stopOpacity="0" />
          </radialGradient>
          {orbitSpecs.map((spec, idx) => (
            <radialGradient key={idx} id={`dt-orb-pl-${idx}`} cx="32%" cy="30%" r="70%">
              <stop offset="0%" stopColor={spec.col1} />
              <stop offset="100%" stopColor={spec.col2} />
            </radialGradient>
          ))}
        </defs>

        {/* Concentric Elliptical Orbit Tracks */}
        {activeOrbits.map(({ spec }, i) => (
          <ellipse
            key={`track-${i}`}
            cx={sunX}
            cy={sunY}
            rx={spec.rx}
            ry={spec.ry}
            fill="none"
            stroke="#94A3B8"
            strokeWidth={1.8}
            strokeDasharray="10 10"
            opacity={0.34}
          />
        ))}

        {/* Radiant Central Sun / Star */}
        <g transform={`translate(${sunX}, ${sunY}) scale(${sunP * coronaPulse})`}>
          <circle r={148} fill="url(#dt-orb-sun)" opacity={0.45} filter="url(#dt-orb-glow)" />
          <circle r={76} fill="#FEF3C7" filter="url(#dt-orb-glow)" />
          <circle r={66} fill="#F59E0B" opacity={0.65} />
          <circle r={44} fill="#FFFBEB" />
        </g>

        {/* Orbiting Illustrated Planets + Astrolabe Leader Lines */}
        {activeOrbits.map(({ spec, px, py }, i) => {
          const p = stagger(i, localFrame, 8, 6, 14);
          const lineEndX = spec.labelSide === 'right' ? px + 88 : px - 88;
          return (
            <g key={`pl-${i}`} opacity={p}>
              <line x1={px} y1={py} x2={lineEndX} y2={py} stroke={spec.col1} strokeWidth={2.5} strokeDasharray="6 4" />
              <circle cx={lineEndX} cy={py} r={5} fill="#F8FAFC" />

              <g transform={`translate(${px}, ${py}) scale(${p})`}>
                {/* Optional planetary ring behind/across gas giant */}
                {spec.hasRing ? (
                  <ellipse
                    cx={0}
                    cy={0}
                    rx={spec.radius * 1.95}
                    ry={spec.radius * 0.45}
                    fill="none"
                    stroke="#FDE68A"
                    strokeWidth={6}
                    transform="rotate(-18)"
                    opacity={0.78}
                  />
                ) : null}
                <circle r={spec.radius + 8} fill={spec.col1} opacity={0.2} filter="url(#dt-orb-glow)" />
                <circle r={spec.radius} fill={`url(#dt-orb-pl-${i % orbitSpecs.length})`} stroke="#F8FAFC" strokeWidth={2} />
                <text
                  x={0}
                  y={9}
                  textAnchor="middle"
                  fill="#FFFFFF"
                  fontFamily={THAI_FONT_FAMILY}
                  fontSize={24}
                  fontWeight={900}
                >
                  0{i + 1}
                </text>
              </g>
            </g>
          );
        })}
      </svg>

      {/* Top Orrery Documentary Title Header */}
      <div
        style={{
          position: 'absolute',
          top: 64,
          left: 64,
          right: 64,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          opacity: titleP,
        }}
      >
        <div
          style={{
            padding: '6px 22px',
            borderRadius: 999,
            background: 'rgba(99, 102, 241, 0.22)',
            border: '1.5px solid rgba(165, 180, 252, 0.65)',
            color: '#E0E7FF',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 21,
            fontWeight: 800,
            letterSpacing: 1.5,
          }}
        >
          ◎ {t.badge || 'PLANETARY ORBIT // วงโคจรประเด็นสำคัญ'}
        </div>
        <FitText text={t.title} baseSize={52} minSize={30} maxLines={2} color={fgColor} fontWeight={800} />
      </div>

      {/* Orbiting Planet Label Plaques (all strictly above CONTENT_BOTTOM=1420) */}
      {activeOrbits.map(({ pt, spec, px, py }, i) => {
        const p = stagger(i, localFrame, 8, 8, 14);
        const isRight = spec.labelSide === 'right';
        const boxLeft = isRight ? Math.min(STAGE_W - 496, px + 88) : Math.max(52, px - 88 - 444);
        const boxTop = Math.min(CONTENT_BOTTOM - 178, Math.max(500, py - 64));
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: boxLeft,
              top: boxTop,
              width: 444,
              minHeight: 112,
              padding: '14px 18px',
              borderRadius: 16,
              background: 'rgba(13, 18, 32, 0.88)',
              border: `1.5px solid ${spec.col1}`,
              boxShadow: `0 10px 26px rgba(0, 0, 0, 0.55)`,
              opacity: p,
              transform: `translateX(${interpolate(p, [0, 1], [isRight ? 28 : -28, 0])}px)`,
            }}
          >
            <div
              style={{
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 18,
                fontWeight: 800,
                color: spec.col1,
                marginBottom: 6,
                textAlign: isRight ? 'left' : 'right',
                letterSpacing: 1,
              }}
            >
              ORBIT 0{i + 1}
            </div>
            <FitText
              text={pt}
              baseSize={22}
              minSize={17}
              maxLines={3}
              lineHeight={1.28}
              color="#F8FAFC"
              fontWeight={700}
              align={isRight ? 'left' : 'right'}
            />
          </div>
        );
      })}
    </div>
  );
};

// ============================================================================
// EXPORT BATCH_D: look-3 (Hologram), look-4 (Red Relief), look-6 (Deep Time)
// ============================================================================

export const BATCH_D: StyleDirectorDef[] = [
  {
    styleId: 'look-3',
    shots: {
      'holo-table': HoloTableShot,
      'mission-route': MissionRouteShot,
      'radar-scan': RadarScanShot,
      'hud-briefing': HudBriefingShot,
    },
    shotLabels: {
      'holo-table': 'โต๊ะฉายโฮโลแกรม 3 มิติหมุนได้พร้อมโนดประเด็นลอยรอบแกน',
      'mission-route': 'เส้นทางภารกิจโฮโลแกรมที่จุดเช็กพอยต์สว่างขึ้นทีละด่าน',
      'radar-scan': 'จอเรดาร์โฮโลแกรมกวาดคลื่นตรวจจับเป้าหมายและตัวเลขสำคัญ',
      'hud-briefing': 'เงาร่างโฮโลแกรมบรรยายสรุปข้างแผงข้อมูล HUD ลอยกลางอากาศ',
    },
    infer: (scene) => {
      const text = haystackOfD(scene);
      if (STEP_RE_D.test(text) || (Array.isArray(scene.steps) && scene.steps.length > 0)) {
        return 'mission-route';
      }
      if (scene.stat || /(?:%|เท่า|ล้าน|อันดับ|เป้า|ตรวจจับ|สแกน|ตัวเลข|\d+\+)/.test(text)) {
        return 'radar-scan';
      }
      if (SUMMARY_RE_D.test(text) || scene.quote?.text || /(?:บรรยาย|รายงาน|วิเคราะห์|คำแนะนำ)/.test(text)) {
        return 'hud-briefing';
      }
      if ((Array.isArray(scene.bullets) && scene.bullets.length >= 2) || /(?:แผน|กลยุทธ์|โครงสร้าง|ระบบ|โมเดล)/.test(text)) {
        return 'holo-table';
      }
      return null;
    },
  },
  {
    styleId: 'look-4',
    shots: {
      'relief-map': ReliefMapShot,
      'battle-arrows': BattleArrowsShot,
      'era-scroll': EraScrollShot,
      monument: MonumentShot,
    },
    shotLabels: {
      'relief-map': 'แผนที่นูนสีแดงพร้อมหมุดปักตำแหน่งและลูกศรกวาดข้ามอาณาเขต',
      'battle-arrows': 'ลูกศรสองฝ่ายปะทะกันบนแผนที่นูนสำหรับเปรียบเทียบ',
      'era-scroll': 'ม้วนคัมภีร์และแผ่นศิลาจารึกปีคลี่ออกตามลำดับเหตุการณ์',
      monument: 'อนุสาวรีย์และเสาศิลาจารึกประโยคสำคัญสำหรับบทสรุป',
    },
    infer: (scene) => {
      const text = haystackOfD(scene);
      if (scene.compare || COMPARE_RE_D.test(text)) {
        return 'battle-arrows';
      }
      if (SUMMARY_RE_D.test(text) || scene.quote?.text) {
        return 'monument';
      }
      if (YEAR_OR_DATE_RE_D.test(text) || STEP_RE_D.test(text) || (Array.isArray(scene.steps) && scene.steps.length > 0)) {
        return 'era-scroll';
      }
      if (scene.stat || /(?:แผนที่|อาณาจักร|ดินแดน|ภูมิภาค|บุก|ขยาย|เส้นทาง|เมือง|โลก)/.test(text)) {
        return 'relief-map';
      }
      return null;
    },
  },
  {
    styleId: 'look-6',
    shots: {
      'cosmic-zoom': CosmicZoomShot,
      'strata-layers': StrataLayersShot,
      'clock-spiral': ClockSpiralShot,
      'planet-orbit': PlanetOrbitShot,
    },
    shotLabels: {
      'cosmic-zoom': 'ซูมจักรวาลจากกาแล็กซีสู่ดาวเคราะห์และจุดข้อมูลสำคัญ',
      'strata-layers': 'ชั้นหินธรณีวิทยาที่แต่ละประเด็นคือหนึ่งยุคสมัย',
      'clock-spiral': 'เกลียวเวลาขนาดมหึมาสำหรับตัวเลขใหญ่และสเกลนับล้านปี',
      'planet-orbit': 'ระบบดาวเคราะห์โคจรรอบดวงอาทิตย์โดยแต่ละดวงติดป้ายประเด็นสำคัญ',
    },
    infer: (scene) => {
      const text = haystackOfD(scene);
      if (scene.stat || /(?:พันล้าน|ล้านปี|แสนปี|หมื่นปี|ปีแสง|%|เท่า|อันดับ|\d+\s*ปี)/.test(text)) {
        return 'clock-spiral';
      }
      if (
        STEP_RE_D.test(text) ||
        (Array.isArray(scene.steps) && scene.steps.length > 0) ||
        /(?:ชั้นหิน|ยุค|ฟอสซิล|วิวัฒนาการ|ธรณี|เปลือกโลก|ไดโนเสาร์)/.test(text)
      ) {
        return 'strata-layers';
      }
      if (
        (Array.isArray(scene.bullets) && scene.bullets.length >= 2) ||
        /(?:ดาวเคราะห์|วงโคจร|ระบบสุริยะ|องค์ประกอบ|ปัจจัย)/.test(text)
      ) {
        return 'planet-orbit';
      }
      if (YEAR_OR_DATE_RE_D.test(text) || /(?:จักรวาล|กาแล็กซี|อวกาศ|โลก|ซูม|บิ๊กแบง|กำเนิด)/.test(text)) {
        return 'cosmic-zoom';
      }
      return null;
    },
  },
];
