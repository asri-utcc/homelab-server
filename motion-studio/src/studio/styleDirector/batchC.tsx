import React from 'react';
import { interpolate, spring } from 'remotion';
import { THAI_FONT_FAMILY } from '../../components/ThaiFontLoader';
import type { StudioScene } from '../types';
import { FitText, SAFE_BOTTOM, STAGE_H, STAGE_W, appear, sceneTexts, stagger } from './kit';
import type { StyleDirectorDef, StyleShotArgs } from './types';

// ============================================================================
// SHARED CONTENT EXTRACTION HELPERS (Pure, Deterministic, Zero External Assets)
// ============================================================================

const YEAR_OR_DATE_RE =
  /(?:19\d{2}|20\d{2}|25\d{2}|พ\.ศ\.\s*\d+|ค\.ศ\.\s*\d+|ปี\s*\d+|วันที่\s*\d+|เดือน|ศตวรรษ|ยุค)/i;
const STEP_RE = /(?:ขั้นตอน|สเต็ป|ลำดับ|วิธี|เส้นทาง|จาก.+สู่|step)/i;
const SUMMARY_RE = /(?:สรุป|สำคัญ|ไฮไลต์|ประโยคจำ|จำไว้|หัวใจ|แก่น|บทเรียน)/i;
const COMPARE_RE = /(?:เทียบ|ตอนนั้น|ตอนนี้|อดีต|ปัจจุบัน|แบบเดิม|สมัยก่อน|เปลี่ยนไป|ต่างกัน|vs)/i;

function haystackOf(scene: StudioScene): string {
  const t = sceneTexts(scene);
  const hl = Array.isArray(scene.highlight) ? scene.highlight.join(' ') : String(scene.highlight || '');
  return [t.badge, t.title, t.subtitle, hl, ...t.bullets, scene.stat?.label || '', scene.quote?.text || ''].join(' ');
}

function extractPoints(scene: StudioScene, max = 4): string[] {
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

function extractShortPoints(scene: StudioScene, max = 4): string[] {
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
    if (scene.stat.unit) out.push(`${scene.stat.value} ${scene.stat.unit}`.trim());
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

function extractPrimaryMetric(scene: StudioScene, sceneIndex: number): { big: string; unit: string } {
  if (scene.stat?.value !== undefined && String(scene.stat.value).trim()) {
    return {
      big: String(scene.stat.value).trim(),
      unit: String(scene.stat.unit || scene.stat.delta || '').trim(),
    };
  }
  const t = sceneTexts(scene);
  const yearMatch = haystackOf(scene).match(/(?:19\d{2}|20\d{2}|25\d{2})/);
  if (yearMatch) {
    return { big: yearMatch[0], unit: 'จุดเปลี่ยนสำคัญ' };
  }
  if (t.numbers.length > 0) {
    return { big: t.numbers[0], unit: t.badge || `ซีน ${sceneIndex + 1}` };
  }
  const hl = Array.isArray(scene.highlight) ? scene.highlight[0] : scene.highlight;
  if (hl && String(hl).trim().length <= 14) {
    return { big: String(hl).trim(), unit: t.badge || 'ประเด็นหลัก' };
  }
  return { big: String(sceneIndex + 1).padStart(2, '0'), unit: t.badge || 'หัวใจสำคัญ' };
}

function extractHighlightPhrase(scene: StudioScene): string {
  const hl = Array.isArray(scene.highlight) ? scene.highlight[0] : scene.highlight;
  if (hl && String(hl).trim()) return String(hl).trim();
  const t = sceneTexts(scene);
  if (t.numbers[0]) return t.numbers[0];
  return t.title.slice(0, 26);
}

function extractStepLabel(scene: StudioScene, idx: number): string {
  if (Array.isArray(scene.steps) && scene.steps[idx] && typeof scene.steps[idx] !== 'string') {
    const s = scene.steps[idx] as { step?: string };
    if (s.step) return s.step;
  }
  const pt = extractShortPoints(scene, 4)[idx] || '';
  const m = pt.match(/(?:19\d{2}|20\d{2}|25\d{2}|ปี\s*\d+|ขั้นที่\s*\d+)/);
  if (m) return m[0];
  return String(idx + 1).padStart(2, '0');
}

// ============================================================================
// STYLE 1: look-1 — GLOW WORLD (โลกเรืองแสง)
// ============================================================================

const STAR_COORDS: ReadonlyArray<[number, number, number, number]> = [
  [84, 140, 2.2, 0.7],
  [210, 96, 1.8, 0.5],
  [360, 175, 2.6, 0.8],
  [540, 88, 2.0, 0.6],
  [730, 145, 2.5, 0.75],
  [920, 118, 2.2, 0.65],
  [995, 240, 1.8, 0.5],
  [125, 310, 1.9, 0.55],
  [885, 340, 2.4, 0.7],
  [65, 580, 2.0, 0.55],
  [1010, 560, 2.5, 0.75],
  [150, 820, 1.8, 0.5],
  [945, 860, 2.1, 0.65],
  [90, 1140, 2.4, 0.7],
  [980, 1180, 1.9, 0.6],
  [230, 1380, 2.1, 0.55],
  [840, 1410, 2.3, 0.7],
  [480, 1480, 1.7, 0.45],
  [670, 1510, 2.0, 0.5],
  [310, 420, 1.6, 0.45],
  [780, 460, 1.7, 0.5],
  [420, 1220, 1.8, 0.5],
];

const GlowBackdrop: React.FC<{ localFrame: number; glowX?: number; glowY?: number; hue?: 'cyan' | 'violet' | 'gold' }> = ({
  localFrame,
  glowX = 540,
  glowY = 640,
  hue = 'cyan',
}) => {
  const mainGlow =
    hue === 'gold'
      ? 'rgba(250, 204, 21, 0.24)'
      : hue === 'violet'
        ? 'rgba(168, 85, 247, 0.28)'
        : 'rgba(56, 189, 248, 0.26)';
  const secGlow =
    hue === 'gold'
      ? 'rgba(56, 189, 248, 0.16)'
      : hue === 'violet'
        ? 'rgba(59, 227, 198, 0.16)'
        : 'rgba(168, 85, 247, 0.20)';

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(circle at ${glowX}px ${glowY}px, ${mainGlow} 0%, ${secGlow} 36%, #090C22 72%, #050714 100%)`,
      }}
    >
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {STAR_COORDS.map(([x, y, r, baseOp], i) => {
          const twinkle = 0.45 + 0.55 * Math.sin(localFrame * 0.08 + i * 1.7);
          return <circle key={i} cx={x} cy={y} r={r} fill="#E0F2FE" opacity={baseOp * twinkle} />;
        })}
      </svg>
    </div>
  );
};

/** look-1 Shot 1: glow-portal — ประตูวงแหวนแสงที่ข้อความลอยออกมา */
const GlowPortalShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps }) => {
  const t = sceneTexts(scene);
  const points = extractShortPoints(scene, 3);
  const portalScale = spring({ frame: localFrame, fps, config: { damping: 15, stiffness: 120 } });
  const ringRot1 = localFrame * 0.45;
  const ringRot2 = -localFrame * 0.7;
  const pulse = 1 + 0.035 * Math.sin(localFrame * 0.12);
  const titleP = appear(localFrame, 6, 16);
  const subP = appear(localFrame, 16, 16);
  const cx = 540;
  const cy = 540;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <GlowBackdrop localFrame={localFrame} glowX={cx} glowY={cy} hue="violet" />

      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <filter id="glow-portal-blur" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="10" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="portal-core-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFBEB" stopOpacity="0.95" />
            <stop offset="28%" stopColor="#38BDF8" stopOpacity="0.65" />
            <stop offset="65%" stopColor="#8B5CF6" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#090C22" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="portal-beam-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.32" />
            <stop offset="55%" stopColor="#A855F7" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#090C22" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Light cone emerging downward from portal */}
        <polygon
          points={`${cx - 170},${cy + 40} ${cx + 170},${cy + 40} ${cx + 430},${SAFE_BOTTOM - 40} ${cx - 430},${SAFE_BOTTOM - 40}`}
          fill="url(#portal-beam-grad)"
          opacity={portalScale * 0.9}
        />

        {/* Portal core radiance */}
        <circle cx={cx} cy={cy} r={340 * portalScale * pulse} fill="url(#portal-core-grad)" />

        {/* Outer rotating dashed rune ring */}
        <g transform={`translate(${cx}, ${cy}) scale(${portalScale}) rotate(${ringRot1})`}>
          <circle
            cx={0}
            cy={0}
            r={308}
            fill="none"
            stroke="#A855F7"
            strokeWidth={3}
            strokeDasharray="18 14 4 14"
            opacity={0.75}
          />
          <circle
            cx={0}
            cy={0}
            r={272}
            fill="none"
            stroke="#38BDF8"
            strokeWidth={6}
            strokeDasharray="140 36 80 36"
            filter="url(#glow-portal-blur)"
            opacity={0.92}
          />
        </g>

        {/* Counter-rotating inner ring */}
        <g transform={`translate(${cx}, ${cy}) scale(${portalScale}) rotate(${ringRot2})`}>
          <circle
            cx={0}
            cy={0}
            r={215}
            fill="none"
            stroke="#FACC15"
            strokeWidth={4}
            strokeDasharray="95 28 45 28"
            filter="url(#glow-portal-blur)"
            opacity={0.88}
          />
          <circle cx={0} cy={0} r={162} fill="none" stroke="#3BE3C6" strokeWidth={2.5} opacity={0.75} />
        </g>

        {/* Rising luminous motes */}
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
          const x = 180 + i * 102 + Math.sin(localFrame * 0.05 + i) * 18;
          const y = 1360 - ((localFrame * (1.8 + (i % 3) * 0.6) + i * 130) % 720);
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={3 + (i % 3) * 1.5}
              fill={i % 2 === 0 ? '#FACC15' : '#38BDF8'}
              opacity={0.55}
            />
          );
        })}
      </svg>

      {/* Top badge above portal */}
      {t.badge ? (
        <div
          style={{
            position: 'absolute',
            top: 112,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            opacity: appear(localFrame, 2, 12),
          }}
        >
          <div
            style={{
              padding: '10px 28px',
              borderRadius: 999,
              border: '1.5px solid rgba(56, 189, 248, 0.55)',
              background: 'rgba(15, 23, 56, 0.65)',
              color: '#7DD3FC',
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: 1.5,
            }}
          >
            ✦ {t.badge}
          </div>
        </div>
      ) : null}

      {/* Title emerging from the portal aperture */}
      <div
        style={{
          position: 'absolute',
          top: 410,
          left: 90,
          right: 90,
          transform: `translateY(${interpolate(titleP, [0, 1], [65, 0])}px) scale(${interpolate(titleP, [0, 1], [0.84, 1])})`,
          opacity: titleP,
          textShadow: '0 0 36px rgba(56, 189, 248, 0.7), 0 6px 24px rgba(5, 7, 20, 0.9)',
        }}
      >
        <FitText text={t.title} baseSize={66} minSize={40} maxLines={3} color="#FFFFFF" fontWeight={800} />
      </div>

      {/* Subtitle / floating light shards exiting portal below */}
      <div
        style={{
          position: 'absolute',
          top: 905,
          left: 84,
          right: 84,
          maxHeight: SAFE_BOTTOM - 930,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
          opacity: subP,
        }}
      >
        {t.subtitle ? (
          <div style={{ maxWidth: 880, marginBottom: 8 }}>
            <FitText text={t.subtitle} baseSize={34} minSize={24} maxLines={2} color="#CBD5F5" fontWeight={600} />
          </div>
        ) : null}

        {points.slice(0, 3).map((pt, i) => {
          const p = stagger(i, localFrame, 7, 18, 16);
          const accent = i % 2 === 0 ? '#38BDF8' : '#FACC15';
          return (
            <div
              key={i}
              style={{
                width: '100%',
                maxWidth: 860,
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                padding: '18px 28px',
                borderRadius: 999,
                background: 'linear-gradient(90deg, rgba(56,189,248,0.14) 0%, rgba(168,85,247,0.16) 100%)',
                border: `1.5px solid ${accent}88`,
                boxShadow: `0 0 24px ${accent}33`,
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [34, 0])}px)`,
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: accent,
                  boxShadow: `0 0 14px ${accent}`,
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <FitText text={pt} baseSize={31} minSize={22} maxLines={2} color="#F8FAFC" fontWeight={700} align="left" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-1 Shot 2: constellation — bullets กลายเป็นดาวที่ลากเส้นเชื่อมกันเป็นกลุ่มดาว */
const ConstellationShot: React.FC<StyleShotArgs> = ({ scene, localFrame }) => {
  const t = sceneTexts(scene);
  const points = extractShortPoints(scene, 4);
  const nodes: Array<{ x: number; y: number; side: 'right' | 'left' }> =
    points.length <= 2
      ? [
          { x: 240, y: 610, side: 'right' },
          { x: 820, y: 1090, side: 'left' },
        ]
      : points.length === 3
        ? [
            { x: 215, y: 515, side: 'right' },
            { x: 850, y: 860, side: 'left' },
            { x: 240, y: 1245, side: 'right' },
          ]
        : [
            { x: 200, y: 470, side: 'right' },
            { x: 860, y: 740, side: 'left' },
            { x: 220, y: 1040, side: 'right' },
            { x: 840, y: 1325, side: 'left' },
          ];

  const headerP = appear(localFrame, 0, 14);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <GlowBackdrop localFrame={localFrame} glowX={540} glowY={840} hue="cyan" />

      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <filter id="constellation-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="7" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Faint celestial meridian arcs */}
        <circle cx={540} cy={900} r={460} fill="none" stroke="#38BDF8" strokeOpacity={0.1} strokeDasharray="6 10" />
        <circle cx={540} cy={900} r={280} fill="none" stroke="#A855F7" strokeOpacity={0.12} strokeDasharray="4 12" />

        {/* Animated constellation lines connecting stars */}
        {nodes.slice(0, -1).map((from, i) => {
          const to = nodes[i + 1];
          const len = Math.hypot(to.x - from.x, to.y - from.y);
          const lineP = stagger(i, localFrame, 9, 10, 18);
          return (
            <g key={i}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="#38BDF8"
                strokeWidth={5}
                strokeDasharray={len}
                strokeDashoffset={len * (1 - lineP)}
                filter="url(#constellation-glow)"
                opacity={0.75}
              />
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="#E0F2FE"
                strokeWidth={2}
                strokeDasharray={len}
                strokeDashoffset={len * (1 - lineP)}
              />
            </g>
          );
        })}

        {/* Glowing star nodes */}
        {nodes.map((n, i) => {
          const p = stagger(i, localFrame, 8, 6, 14);
          const starColor = i % 2 === 0 ? '#FACC15' : '#3BE3C6';
          const pulse = 1 + 0.1 * Math.sin(localFrame * 0.12 + i * 1.4);
          return (
            <g key={i} transform={`translate(${n.x}, ${n.y}) scale(${p})`}>
              <circle r={48 * pulse} fill={starColor} opacity={0.14} />
              <circle r={26} fill="none" stroke={starColor} strokeWidth={2} strokeDasharray="6 6" opacity={0.75} />
              {/* 4-point star flare */}
              <path
                d="M 0 -24 L 6 -6 L 24 0 L 6 6 L 0 24 L -6 6 L -24 0 L -6 -6 Z"
                fill={starColor}
                filter="url(#constellation-glow)"
              />
              <circle r={6} fill="#FFFFFF" />
            </g>
          );
        })}
      </svg>

      {/* Celestial Title Header */}
      <div
        style={{
          position: 'absolute',
          top: 108,
          left: 72,
          right: 72,
          opacity: headerP,
          transform: `translateY(${interpolate(headerP, [0, 1], [-22, 0])}px)`,
        }}
      >
        <div
          style={{
            textAlign: 'center',
            color: '#7DD3FC',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 2,
            marginBottom: 10,
          }}
        >
          ★ {t.badge || 'CONSTELLATION MAP'}
        </div>
        <FitText text={t.title} baseSize={54} minSize={34} maxLines={2} color="#FFFFFF" fontWeight={800} />
      </div>

      {/* Star labels positioned organically beside each star node */}
      {points.map((pt, i) => {
        const n = nodes[i];
        if (!n) return null;
        const p = stagger(i, localFrame, 8, 10, 16);
        const isRight = n.side === 'right';
        const accent = i % 2 === 0 ? '#FACC15' : '#3BE3C6';
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              top: n.y - 78,
              left: isRight ? n.x + 68 : 66,
              width: isRight ? STAGE_W - n.x - 134 : n.x - 148,
              opacity: p,
              transform: `translateX(${interpolate(p, [0, 1], [isRight ? 28 : -28, 0])}px)`,
              borderLeft: isRight ? `4px solid ${accent}` : 'none',
              borderRight: isRight ? 'none' : `4px solid ${accent}`,
              paddingLeft: isRight ? 22 : 0,
              paddingRight: isRight ? 0 : 22,
            }}
          >
            <div
              style={{
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 21,
                fontWeight: 800,
                color: accent,
                textAlign: isRight ? 'left' : 'right',
                marginBottom: 4,
              }}
            >
              STAR 0{i + 1}
            </div>
            <FitText
              text={pt}
              baseSize={34}
              minSize={23}
              maxLines={3}
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

/** look-1 Shot 3: orb-core — ลูกแก้วกลางจอที่มีวงโคจรของคีย์เวิร์ด */
const OrbCoreShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps }) => {
  const t = sceneTexts(scene);
  const metric = extractPrimaryMetric(scene, sceneIndex);
  const satellites = extractShortPoints(scene, 4);
  const orbSpring = spring({ frame: localFrame, fps, config: { damping: 14, stiffness: 115 } });
  const cx = 540;
  const cy = 820;
  const orbitAngle = localFrame * 0.028;

  const satSlots: Array<{ x: number; y: number; color: string }> = [
    { x: 110, y: 420, color: '#38BDF8' },
    { x: 580, y: 460, color: '#FACC15' },
    { x: 96, y: 1170, color: '#3BE3C6' },
    { x: 570, y: 1210, color: '#C084FC' },
  ];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <GlowBackdrop localFrame={localFrame} glowX={cx} glowY={cy} hue="gold" />

      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <filter id="orb-core-glow" x="-35%" y="-35%" width="170%" height="170%">
            <feGaussianBlur stdDeviation="11" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="orb-sphere-grad" cx="38%" cy="32%" r="65%">
            <stop offset="0%" stopColor="#FFFDE7" />
            <stop offset="28%" stopColor="#FACC15" />
            <stop offset="68%" stopColor="#2563EB" />
            <stop offset="100%" stopColor="#1E1B4B" />
          </radialGradient>
        </defs>

        {/* Three tilted elliptical orbit tracks */}
        <g transform={`translate(${cx}, ${cy}) scale(${orbSpring})`}>
          <ellipse rx={410} ry={150} transform="rotate(-24)" fill="none" stroke="#38BDF8" strokeWidth={2.5} strokeOpacity={0.55} />
          <ellipse rx={430} ry={165} transform="rotate(26)" fill="none" stroke="#A855F7" strokeWidth={2.5} strokeOpacity={0.55} />
          <ellipse rx={340} ry={340} fill="none" stroke="#FACC15" strokeWidth={1.8} strokeDasharray="8 12" strokeOpacity={0.35} />

          {/* Moving orbital electron dots */}
          {[0, 1, 2].map((i) => {
            const ang = orbitAngle + i * 2.1;
            const rot = i === 0 ? -24 : i === 1 ? 26 : 0;
            const rx = i === 0 ? 410 : i === 1 ? 430 : 340;
            const ry = i === 0 ? 150 : i === 1 ? 165 : 340;
            const px = Math.cos(ang) * rx;
            const py = Math.sin(ang) * ry;
            return (
              <g key={i} transform={`rotate(${rot})`}>
                <circle cx={px} cy={py} r={11} fill={i === 1 ? '#FACC15' : '#3BE3C6'} filter="url(#orb-core-glow)" />
                <circle cx={px} cy={py} r={4} fill="#FFFFFF" />
              </g>
            );
          })}

          {/* Central glowing orb sphere */}
          <circle r={195} fill="#38BDF8" opacity={0.18} filter="url(#orb-core-glow)" />
          <circle r={172} fill="url(#orb-sphere-grad)" stroke="#7DD3FC" strokeWidth={3} />
          <ellipse cx={-48} cy={-64} rx={52} ry={26} transform="rotate(-28 -48 -64)" fill="#FFFFFF" opacity={0.28} />
        </g>

        {/* Tether lines from orb to satellite keyword pills */}
        {satellites.slice(0, 4).map((_, i) => {
          const slot = satSlots[i];
          const p = stagger(i, localFrame, 7, 14, 14);
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={slot.x + 200}
              y2={slot.y + 52}
              stroke={slot.color}
              strokeWidth={1.8}
              strokeDasharray="6 6"
              opacity={p * 0.48}
            />
          );
        })}
      </svg>

      {/* Top Title */}
      <div
        style={{
          position: 'absolute',
          top: 108,
          left: 72,
          right: 72,
          opacity: appear(localFrame, 0, 14),
        }}
      >
        <FitText text={t.title} baseSize={54} minSize={34} maxLines={2} color="#FFFFFF" fontWeight={800} />
      </div>

      {/* Central Orb Value */}
      <div
        style={{
          position: 'absolute',
          left: cx - 165,
          top: cy - 110,
          width: 330,
          height: 220,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `scale(${orbSpring})`,
          textShadow: '0 4px 20px rgba(9, 12, 34, 0.85)',
        }}
      >
        <FitText text={metric.big} baseSize={88} minSize={42} maxLines={1} color="#FFFFFF" fontWeight={900} />
        {metric.unit ? (
          <div style={{ marginTop: 4, maxWidth: 280 }}>
            <FitText text={metric.unit} baseSize={26} minSize={18} maxLines={2} color="#FEF08A" fontWeight={700} />
          </div>
        ) : null}
      </div>

      {/* Orbiting Keyword Satellites */}
      {satellites.slice(0, 4).map((pt, i) => {
        const slot = satSlots[i];
        const p = stagger(i, localFrame, 7, 14, 15);
        const bob = Math.sin(localFrame * 0.08 + i * 1.5) * 6;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: slot.x,
              top: slot.y + bob,
              width: 405,
              padding: '16px 22px',
              borderRadius: 24,
              background: 'rgba(13, 18, 46, 0.84)',
              border: `2px solid ${slot.color}99`,
              boxShadow: `0 0 26px ${slot.color}33`,
              opacity: p,
              transform: `scale(${interpolate(p, [0, 1], [0.88, 1])})`,
            }}
          >
            <FitText text={pt} baseSize={27} minSize={20} maxLines={3} color="#F8FAFC" fontWeight={700} align="left" />
          </div>
        );
      })}
    </div>
  );
};

/** look-1 Shot 4: light-path — เส้นทางแสงคดเคี้ยวจากล่างขึ้นบนพร้อม checkpoint */
const LightPathShot: React.FC<StyleShotArgs> = ({ scene, localFrame }) => {
  const t = sceneTexts(scene);
  const points = extractShortPoints(scene, 4);
  const pathProgress = appear(localFrame, 2, 42);
  const pathLength = 1520;

  // Checkpoints ascending from bottom to top, seated directly along the S-curve
  const checkpoints: Array<{ x: number; y: number; side: 'right' | 'left' }> =
    points.length <= 2
      ? [
          { x: 295, y: 1255, side: 'right' },
          { x: 765, y: 810, side: 'left' },
        ]
      : points.length === 3
        ? [
            { x: 295, y: 1275, side: 'right' },
            { x: 770, y: 880, side: 'left' },
            { x: 405, y: 555, side: 'right' },
          ]
        : [
            { x: 315, y: 1320, side: 'right' },
            { x: 675, y: 1015, side: 'left' },
            { x: 755, y: 760, side: 'left' },
            { x: 385, y: 525, side: 'right' },
          ];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <GlowBackdrop localFrame={localFrame} glowX={540} glowY={340} hue="cyan" />

      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <filter id="light-path-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="9" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="path-stroke-grad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#A855F7" />
            <stop offset="50%" stopColor="#38BDF8" />
            <stop offset="100%" stopColor="#FACC15" />
          </linearGradient>
        </defs>

        {/* Summit beacon rays */}
        <circle cx={540} cy={350} r={110} fill="#FACC15" opacity={0.14 * pathProgress} filter="url(#light-path-glow)" />
        <path
          d="M 540 315 L 550 342 L 578 350 L 550 358 L 540 385 L 530 358 L 502 350 L 530 342 Z"
          fill="#FACC15"
          opacity={appear(localFrame, 10, 14)}
          filter="url(#light-path-glow)"
        />

        {/* Winding glowing S-curve light path from bottom to top */}
        <path
          d="M 540 1480 C 170 1380, 170 1200, 540 1070 C 900 940, 900 760, 540 640 C 210 530, 320 420, 540 350"
          fill="none"
          stroke="url(#path-stroke-grad)"
          strokeWidth={14}
          strokeLinecap="round"
          strokeDasharray={pathLength}
          strokeDashoffset={pathLength * (1 - pathProgress)}
          filter="url(#light-path-glow)"
          opacity={0.85}
        />
        <path
          d="M 540 1480 C 170 1380, 170 1200, 540 1070 C 900 940, 900 760, 540 640 C 210 530, 320 420, 540 350"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={pathLength}
          strokeDashoffset={pathLength * (1 - pathProgress)}
        />

        {/* Checkpoint lantern nodes */}
        {checkpoints.map((cp, i) => {
          const p = stagger(i, localFrame, 8, 8, 14);
          const col = i === checkpoints.length - 1 ? '#FACC15' : i % 2 === 0 ? '#38BDF8' : '#3BE3C6';
          return (
            <g key={i} transform={`translate(${cp.x}, ${cp.y}) scale(${p})`}>
              <circle r={46} fill={col} opacity={0.18} />
              <circle r={30} fill="#0B112B" stroke={col} strokeWidth={4} filter="url(#light-path-glow)" />
              <text
                x={0}
                y={9}
                textAnchor="middle"
                fill="#FFFFFF"
                fontFamily={THAI_FONT_FAMILY}
                fontSize={24}
                fontWeight={800}
              >
                {extractStepLabel(scene, i)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Top Summit Title */}
      <div
        style={{
          position: 'absolute',
          top: 102,
          left: 72,
          right: 72,
          opacity: appear(localFrame, 0, 14),
        }}
      >
        <FitText text={t.title} baseSize={54} minSize={34} maxLines={2} color="#FFFFFF" fontWeight={800} />
      </div>

      {/* Checkpoint Labels */}
      {points.map((pt, i) => {
        const cp = checkpoints[i];
        if (!cp) return null;
        const p = stagger(i, localFrame, 8, 10, 15);
        const isRight = cp.side === 'right';
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              top: cp.y - 54,
              left: isRight ? cp.x + 62 : 66,
              width: isRight ? STAGE_W - cp.x - 126 : cp.x - 128,
              padding: '14px 22px',
              borderRadius: 20,
              background: 'rgba(12, 18, 44, 0.78)',
              border: '1.5px solid rgba(125, 211, 252, 0.45)',
              opacity: p,
              transform: `translateY(${interpolate(p, [0, 1], [22, 0])}px)`,
            }}
          >
            <FitText
              text={pt}
              baseSize={30}
              minSize={21}
              maxLines={3}
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
// STYLE 2: look-31 — PAPER DESK (เอกสารบนโต๊ะ)
// ============================================================================

const WoodDeskBackdrop: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      background: 'linear-gradient(155deg, #C79B6B 0%, #AD7E4E 48%, #8F6339 100%)',
    }}
  >
    <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
      {/* Subtle wood plank seams & warm organic grain */}
      {[180, 420, 680, 920].map((x, i) => (
        <line key={i} x1={x} y1={0} x2={x} y2={STAGE_H} stroke="#6E4826" strokeWidth={2} opacity={0.18} />
      ))}
      {[120, 290, 510, 740, 980, 1220, 1460, 1710].map((y, i) => (
        <path
          key={i}
          d={`M 0 ${y} Q 320 ${y + (i % 2 === 0 ? 18 : -16)}, 680 ${y + 6} T ${STAGE_W} ${y - 8}`}
          fill="none"
          stroke="#5C3A1B"
          strokeWidth={2.5}
          opacity={0.12}
        />
      ))}
      {/* Soft warm overhead desk-lamp light pool */}
      <defs>
        <radialGradient id="desk-lamp-light" cx="35%" cy="22%" r="75%">
          <stop offset="0%" stopColor="#FFF7E6" stopOpacity="0.26" />
          <stop offset="65%" stopColor="#FFF7E6" stopOpacity="0" />
          <stop offset="100%" stopColor="#2B1808" stopOpacity="0.34" />
        </radialGradient>
      </defs>
      <rect width={STAGE_W} height={STAGE_H} fill="url(#desk-lamp-light)" />
    </svg>
  </div>
);

/** look-31 Shot 1: desk-overhead — โต๊ะที่มีกระดาษ ปากกา แก้วกาแฟ และมือ SVG วางเอกสาร */
const DeskOverheadShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps }) => {
  const t = sceneTexts(scene);
  const points = extractPoints(scene, 3);
  const placeP = spring({ frame: localFrame, fps, config: { damping: 16, stiffness: 110 } });
  const paperY = interpolate(placeP, [0, 1], [150, 0]);
  const paperRot = interpolate(placeP, [0, 1], [4.5, -1.6]);
  const handX = interpolate(appear(localFrame, 0, 24), [0, 1], [140, 0]);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <WoodDeskBackdrop />

      {/* Desk props: top-right coffee mug & top-left fountain pen */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {/* Coffee mug top-right */}
        <g transform="translate(925, 195)">
          <ellipse cx={16} cy={22} rx={96} ry={96} fill="rgba(35,20,8,0.28)" />
          {/* Mug handle */}
          <rect x={68} y={-20} width={52} height={40} rx={20} fill="#F5EFE6" stroke="#D6CBB8" strokeWidth={4} />
          {/* Outer ceramic rim */}
          <circle r={92} fill="#FAF6EE" stroke="#DDD2BE" strokeWidth={5} />
          {/* Rich coffee inside */}
          <circle r={72} fill="#3E2517" />
          <circle r={66} fill="none" stroke="#6F4730" strokeWidth={3} opacity={0.5} />
          {/* Latte foam swirl */}
          <path d="M -22 -14 C -4 -30, 26 -18, 18 6 C 12 22, -16 20, -18 4" fill="none" stroke="#D7B797" strokeWidth={5} strokeLinecap="round" opacity={0.65} />
        </g>

        {/* Fountain pen resting along left edge */}
        <g transform="translate(82, 1180) rotate(-14)">
          <rect x={6} y={10} width={28} height={310} rx={14} fill="rgba(35,20,8,0.26)" />
          <rect x={0} y={0} width={28} height={260} rx={12} fill="#1F3B2E" />
          <rect x={0} y={76} width={28} height={14} fill="#D4AF37" />
          <rect x={11} y={14} width={6} height={74} rx={3} fill="#E7C86E" />
          <polygon points="2,260 26,260 14,312" fill="#D4AF37" />
          <circle cx={14} cy={282} r={3} fill="#1F3B2E" />
        </g>
      </svg>

      {/* Main tactile paper sheet being placed on the desk */}
      <div
        style={{
          position: 'absolute',
          top: 250,
          left: 112,
          width: 856,
          minHeight: 1080,
          maxHeight: 1220,
          background: '#FFFDF7',
          borderRadius: 10,
          boxShadow: '14px 26px 48px rgba(32, 18, 6, 0.34), 0 2px 6px rgba(32, 18, 6, 0.16)',
          padding: '62px 64px 58px 64px',
          transform: `translateY(${paperY}px) rotate(${paperRot}deg)`,
          borderTop: '14px solid #2D684C',
          overflow: 'hidden',
        }}
      >
        {/* Subtle ruled notebook lines */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'repeating-linear-gradient(to bottom, transparent, transparent 58px, rgba(45,104,76,0.08) 58px, rgba(45,104,76,0.08) 60px)',
            pointerEvents: 'none',
          }}
        />

        {/* Brass paperclip at top-left */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 26,
          }}
        >
          <div
            style={{
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 22,
              fontWeight: 800,
              color: '#2D684C',
              letterSpacing: 1.5,
              padding: '6px 16px',
              background: '#E8F3EC',
              borderRadius: 6,
            }}
          >
            {t.badge || 'BRIEFING MEMO'}
          </div>
          <div style={{ fontFamily: THAI_FONT_FAMILY, fontSize: 20, fontWeight: 700, color: '#8A7E6E' }}>
            DOC · 0{scene.index !== undefined ? scene.index + 1 : 1}
          </div>
        </div>

        {/* Document Title */}
        <div style={{ position: 'relative', marginBottom: 26 }}>
          <FitText text={t.title} baseSize={54} minSize={34} maxLines={3} color="#1E1B18" fontWeight={800} align="left" />
        </div>

        <div style={{ height: 3, width: 120, background: '#C85A32', marginBottom: 32, borderRadius: 2 }} />

        {/* Document Body / Bullets */}
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {points.map((pt, i) => {
            const p = stagger(i, localFrame, 7, 12, 14);
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 20,
                  opacity: p,
                  transform: `translateY(${interpolate(p, [0, 1], [16, 0])}px)`,
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: '#2D684C',
                    color: '#FFFDF7',
                    fontFamily: THAI_FONT_FAMILY,
                    fontSize: 22,
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: 4,
                  }}
                >
                  {i + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <FitText text={pt} baseSize={33} minSize={22} maxLines={3} color="#2D2823" fontWeight={600} align="left" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Illustrated SVG Hand resting/placing bottom-right corner of the paper */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        <g transform={`translate(${810 + handX}, ${1260 + paperY * 0.6}) rotate(-18)`}>
          {/* Soft hand shadow */}
          <path
            d="M 10 38 C -15 24, -18 -8, 12 -14 L 88 -10 C 110 -8, 130 6, 152 24 L 285 95 L 220 215 L 70 128 C 36 108, 18 76, 10 38 Z"
            fill="rgba(30,16,6,0.22)"
            transform="translate(10, 16)"
          />
          {/* Sleeve cuff */}
          <path d="M 155 40 L 315 118 L 245 245 L 92 152 Z" fill="#2D684C" />
          <path d="M 150 38 L 176 51 L 116 164 L 90 150 Z" fill="#FAF6EE" />
          {/* Hand & thumb holding the paper edge */}
          <path
            d="M 12 36 C -16 24, -20 -6, 12 -12 L 88 -10 C 112 -8, 132 8, 156 38 L 106 146 C 68 126, 26 84, 12 36 Z"
            fill="#F1C39B"
            stroke="#C7926A"
            strokeWidth={3}
          />
          {/* Fingernail detail */}
          <ellipse cx={10} cy={12} rx={12} ry={8} fill="#FAE2CC" opacity={0.8} />
        </g>
      </svg>
    </div>
  );
};

/** look-31 Shot 2: sticky-wall — โพสต์อิทหลายสีแปะทีละใบจาก bullets */
const StickyWallShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps }) => {
  const t = sceneTexts(scene);
  const points = extractShortPoints(scene, 4);
  const headerP = appear(localFrame, 0, 14);

  const notePalettes = [
    { bg: '#FEF08A', fold: '#EAB308', pin: '#DC2626', rot: -2.8 },
    { bg: '#FECDD3', fold: '#FB7185', pin: '#2563EB', rot: 2.4 },
    { bg: '#BBF7D0', fold: '#4ADE80', pin: '#D97706', rot: -1.8 },
    { bg: '#BAE6FD', fold: '#38BDF8', pin: '#7C3AED', rot: 2.6 },
  ];

  const isTwoCol = points.length >= 3;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      {/* Corkboard / warm kraft mat background */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle at 50% 35%, #D9B78C 0%, #C49D6E 62%, #A67E51 100%)',
        }}
      >
        <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
          {/* Cork speckles */}
          {STAR_COORDS.map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y} r={r * 1.6} fill="#7C5630" opacity={0.18} />
          ))}
          {/* Wooden corkboard inner border */}
          <rect x={28} y={28} width={STAGE_W - 56} height={STAGE_H - 56} rx={18} fill="none" stroke="#7A522C" strokeWidth={14} opacity={0.45} />
        </svg>
      </div>

      {/* Top Kraft Tape Title Banner */}
      <div
        style={{
          position: 'absolute',
          top: 104,
          left: 88,
          right: 88,
          padding: '28px 42px',
          background: '#FFFDF7',
          borderRadius: 6,
          boxShadow: '0 14px 30px rgba(45, 28, 10, 0.24)',
          transform: `rotate(-0.8deg) translateY(${interpolate(headerP, [0, 1], [-28, 0])}px)`,
          opacity: headerP,
        }}
      >
        {/* Translucent masking tape strips on top corners */}
        <div
          style={{
            position: 'absolute',
            top: -18,
            left: 38,
            width: 110,
            height: 34,
            background: 'rgba(254, 243, 199, 0.78)',
            transform: 'rotate(-8deg)',
            border: '1px solid rgba(180,150,100,0.25)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: -18,
            right: 38,
            width: 110,
            height: 34,
            background: 'rgba(254, 243, 199, 0.78)',
            transform: 'rotate(7deg)',
            border: '1px solid rgba(180,150,100,0.25)',
          }}
        />
        <FitText text={t.title} baseSize={50} minSize={32} maxLines={2} color="#1E1B18" fontWeight={800} />
      </div>

      {/* Sticky Notes Grid / Stack */}
      <div
        style={{
          position: 'absolute',
          top: 360,
          left: 72,
          right: 72,
          height: SAFE_BOTTOM - 380,
          display: 'grid',
          gridTemplateColumns: isTwoCol ? '1fr 1fr' : '1fr',
          gap: 36,
          alignContent: 'center',
        }}
      >
        {points.map((pt, i) => {
          const pal = notePalettes[i % notePalettes.length];
          const pop = spring({ frame: Math.max(0, localFrame - (6 + i * 7)), fps, config: { damping: 14, stiffness: 150 } });
          return (
            <div
              key={i}
              style={{
                position: 'relative',
                minHeight: isTwoCol ? 420 : 340,
                padding: '54px 36px 40px 36px',
                background: pal.bg,
                boxShadow: '10px 18px 28px rgba(45, 25, 8, 0.28)',
                transform: `scale(${pop}) rotate(${pal.rot}deg)`,
                opacity: pop,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              {/* Pushpin at top center */}
              <div
                style={{
                  position: 'absolute',
                  top: 14,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: pal.pin,
                  boxShadow: '0 4px 8px rgba(0,0,0,0.35), inset -3px -3px 6px rgba(0,0,0,0.25)',
                }}
              />
              <div>
                <div
                  style={{
                    fontFamily: THAI_FONT_FAMILY,
                    fontSize: 24,
                    fontWeight: 900,
                    color: '#44403C',
                    marginBottom: 12,
                  }}
                >
                  NOTE #{i + 1}
                </div>
                <FitText
                  text={pt}
                  baseSize={isTwoCol ? 36 : 42}
                  minSize={24}
                  maxLines={5}
                  color="#1C1917"
                  fontWeight={700}
                  align="left"
                />
              </div>
              {/* Folded corner accent */}
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  bottom: 0,
                  width: 44,
                  height: 44,
                  background: `linear-gradient(135deg, ${pal.fold} 50%, rgba(166,126,81,0.5) 50%)`,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-31 Shot 3: folder-open — แฟ้มเปิดออกแล้วเห็นเอกสารมีหัวเรื่อง */
const FolderOpenShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps }) => {
  const t = sceneTexts(scene);
  const points = extractPoints(scene, 3);
  const metric = scene.stat ? extractPrimaryMetric(scene, sceneIndex) : null;
  const openP = spring({ frame: localFrame, fps, config: { damping: 16, stiffness: 115 } });
  const docSlideY = interpolate(openP, [0, 1], [180, 0]);
  const frontFlapDrop = interpolate(openP, [0, 1], [0, 68]);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <WoodDeskBackdrop />

      {/* Manila Folder Back Flap + Index Tab */}
      <div
        style={{
          position: 'absolute',
          top: 190,
          left: 68,
          right: 68,
          height: 1280,
        }}
      >
        {/* Top-left Folder Tab */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 24,
            width: 390,
            height: 78,
            background: '#DFB674',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 24,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 28,
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 24,
            fontWeight: 800,
            color: '#4A3419',
            boxShadow: '0 -4px 14px rgba(32,18,6,0.12)',
          }}
        >
          📁 {t.badge || `FILE #0${sceneIndex + 1}`}
        </div>

        {/* Back Folder Body */}
        <div
          style={{
            position: 'absolute',
            top: 64,
            left: 0,
            right: 0,
            bottom: 0,
            background: '#D9AE6B',
            borderRadius: 22,
            boxShadow: '0 26px 52px rgba(32, 18, 6, 0.38)',
          }}
        />

        {/* Inner Crisp White Dossier Sheet sliding out */}
        <div
          style={{
            position: 'absolute',
            top: 108,
            left: 38,
            right: 38,
            height: 1020,
            background: '#FFFDF8',
            borderRadius: 10,
            padding: '54px 54px 48px 54px',
            boxShadow: '0 14px 32px rgba(35, 20, 8, 0.24)',
            transform: `translateY(${docSlideY}px)`,
            overflow: 'hidden',
          }}
        >
          {/* Red-green stamp badge top-right */}
          <div
            style={{
              position: 'absolute',
              top: 26,
              right: 34,
              padding: '7px 16px',
              border: '3px solid #B91C1C',
              borderRadius: 8,
              color: '#B91C1C',
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 19,
              fontWeight: 900,
              transform: 'rotate(6deg)',
              opacity: appear(localFrame, 12, 12),
            }}
          >
            KEY DOSSIER
          </div>

          <div style={{ maxWidth: 560, paddingTop: 14, marginBottom: 26 }}>
            <FitText text={t.title} baseSize={48} minSize={32} maxLines={3} color="#1E1B18" fontWeight={800} align="left" />
          </div>

          {metric ? (
            <div
              style={{
                marginBottom: 26,
                padding: '22px 28px',
                borderRadius: 14,
                background: '#EDF5F0',
                borderLeft: '8px solid #2D684C',
                display: 'flex',
                alignItems: 'baseline',
                gap: 18,
              }}
            >
              <FitText text={metric.big} baseSize={72} minSize={44} maxLines={1} color="#2D684C" fontWeight={900} align="left" />
              <FitText text={metric.unit} baseSize={30} minSize={20} maxLines={2} color="#3B352E" fontWeight={700} align="left" />
            </div>
          ) : null}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {points.map((pt, i) => {
              const p = stagger(i, localFrame, 7, 14, 14);
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 16,
                    paddingBottom: 16,
                    borderBottom: '1.5px dashed #DDD2C0',
                    opacity: p,
                  }}
                >
                  <span style={{ color: '#2D684C', fontSize: 28, fontWeight: 900, lineHeight: 1.2 }}>▸</span>
                  <div style={{ flex: 1 }}>
                    <FitText text={pt} baseSize={32} minSize={22} maxLines={3} color="#2D2823" fontWeight={600} align="left" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Front Folder Pocket Flap (lower portion overlapping bottom of document) */}
        <div
          style={{
            position: 'absolute',
            left: -6,
            right: -6,
            bottom: -frontFlapDrop * 0.2,
            height: 290 - frontFlapDrop * 0.5,
            background: 'linear-gradient(180deg, #EBC788 0%, #DCA95F 100%)',
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            borderBottomLeftRadius: 24,
            borderBottomRightRadius: 24,
            boxShadow: '0 -12px 24px rgba(45, 25, 8, 0.22)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 48px',
          }}
        >
          <div style={{ fontFamily: THAI_FONT_FAMILY, fontSize: 24, fontWeight: 800, color: '#5A3E1B' }}>
            CASE FILE · ARCHIVE
          </div>
          <div
            style={{
              width: 140,
              height: 12,
              borderRadius: 6,
              background: 'rgba(90, 62, 27, 0.22)',
            }}
          />
        </div>
      </div>
    </div>
  );
};

/** look-31 Shot 4: highlight-doc — หน้าเอกสารที่ปากกาไฮไลต์ลากผ่านคำสำคัญ */
const HighlightDocShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame }) => {
  const t = sceneTexts(scene);
  const hlPhrase = extractHighlightPhrase(scene);
  const isQuote = Boolean(scene.quote?.text);
  const rawPoints = extractPoints(scene, 3);
  const bodyPoints = isQuote
    ? [scene.quote?.author ? `ผู้กล่าว: ${scene.quote.author}` : '', scene.quote?.role || scene.source || ''].filter(Boolean)
    : rawPoints;
  const sweep1 = appear(localFrame, 6, 22);
  const sweep2 = appear(localFrame, 18, 22);
  const penX = interpolate(sweep1, [0, 1], [160, 845]);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <WoodDeskBackdrop />

      {/* Full-width close-up printed editorial document */}
      <div
        style={{
          position: 'absolute',
          top: 96,
          left: 58,
          right: 58,
          height: SAFE_BOTTOM - 124,
          background: '#FFFDF7',
          borderRadius: 8,
          boxShadow: '0 24px 56px rgba(32, 18, 6, 0.36)',
          padding: '58px 66px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          overflow: 'hidden',
        }}
      >
        <div>
          {/* Editorial double top rule */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              borderBottom: '3px solid #1E1B18',
              paddingBottom: 14,
              marginBottom: 34,
              fontFamily: THAI_FONT_FAMILY,
              fontSize: 22,
              fontWeight: 700,
              color: '#6B6257',
            }}
          >
            <span>{t.badge || 'EDITORIAL NOTE'}</span>
            <span>หน้า 0{sceneIndex + 1}</span>
          </div>

          {/* Title */}
          <div style={{ marginBottom: 36 }}>
            <FitText text={t.title} baseSize={54} minSize={34} maxLines={3} color="#1E1B18" fontWeight={800} align="left" />
          </div>

          {/* Highlighted key sentence / phrase with animated neon yellow marker band */}
          <div style={{ position: 'relative', marginBottom: 42, padding: '20px 24px' }}>
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 6,
                bottom: 6,
                width: `${sweep1 * 100}%`,
                background: 'rgba(253, 224, 71, 0.72)',
                borderRadius: 8,
                transform: 'rotate(-0.5deg)',
              }}
            />
            <div style={{ position: 'relative' }}>
              <FitText
                text={scene.quote?.text || hlPhrase}
                baseSize={isQuote ? 42 : 44}
                minSize={26}
                maxLines={4}
                color="#141210"
                fontWeight={800}
                align="left"
              />
            </div>
          </div>

          {/* Supporting document points with secondary mint highlight */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
            {bodyPoints.slice(0, 3).map((pt, i) => {
              const p = stagger(i, localFrame, 7, 14, 14);
              const isHighlighted = i === 0 && !isQuote;
              return (
                <div key={i} style={{ position: 'relative', opacity: p, padding: '8px 14px' }}>
                  {isHighlighted ? (
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 2,
                        bottom: 2,
                        width: `${sweep2 * 96}%`,
                        background: 'rgba(187, 247, 208, 0.65)',
                        borderRadius: 6,
                      }}
                    />
                  ) : null}
                  <div style={{ position: 'relative', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                    <span style={{ color: '#2D684C', fontWeight: 900, fontSize: 28 }}>—</span>
                    <div style={{ flex: 1 }}>
                      <FitText text={pt} baseSize={33} minSize={22} maxLines={3} color="#2D2823" fontWeight={600} align="left" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Subtle printed editorial footer & decorative margin lines */}
        <div
          style={{
            borderTop: '1.5px solid #DDD2C0',
            paddingTop: 22,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 21,
            fontWeight: 700,
            color: '#8A7E6E',
          }}
        >
          <span>★ KEY TAKEAWAY · สรุปสาระสำคัญ</span>
          <span style={{ color: '#2D684C' }}>HIGHLIGHTED</span>
        </div>
      </div>

      {/* Illustrated SVG Highlighter Marker Pen resting right beside the highlighted band */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        <g transform={`translate(${penX}, 472) rotate(-28)`}>
          {/* Pen shadow */}
          <rect x={16} y={18} width={280} height={58} rx={16} fill="rgba(30,18,8,0.22)" />
          {/* Chisel felt tip */}
          <polygon points="-24,36 10,12 10,46" fill="#FDE047" stroke="#CA8A04" strokeWidth={2} />
          {/* Tapered collar */}
          <polygon points="10,12 46,4 46,54 10,46" fill="#1E293B" />
          {/* Bright highlighter body */}
          <rect x={46} y={2} width={220} height={54} rx={12} fill="#FACC15" stroke="#CA8A04" strokeWidth={3} />
          <rect x={78} y={14} width={120} height={14} rx={7} fill="#FEF9C3" opacity={0.8} />
          {/* End cap */}
          <rect x={256} y={4} width={34} height={50} rx={8} fill="#1E293B" />
        </g>
      </svg>
    </div>
  );
};

// ============================================================================
// STYLE 3: look-36 — TIMELINE (ไทม์ไลน์)
// ============================================================================

const TimelineGridBackdrop: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      background: 'linear-gradient(170deg, #091022 0%, #101B36 55%, #0A1226 100%)',
    }}
  >
    <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
      {Array.from({ length: 13 }).map((_, i) => (
        <line key={`v-${i}`} x1={i * 90} y1={0} x2={i * 90} y2={STAGE_H} stroke="#38BDF8" strokeOpacity={0.07} />
      ))}
      {Array.from({ length: 22 }).map((_, i) => (
        <line key={`h-${i}`} x1={0} y1={i * 90} x2={STAGE_W} y2={i * 90} stroke="#38BDF8" strokeOpacity={0.07} />
      ))}
    </svg>
  </div>
);

/** look-36 Shot 1: horizontal-track — เส้นเวลาแนวนอนที่กล้องเลื่อนผ่านจุดปี/ขั้น */
const HorizontalTrackShot: React.FC<StyleShotArgs> = ({ scene, localFrame, durationFrames }) => {
  const t = sceneTexts(scene);
  const points = extractShortPoints(scene, 3);
  const railY = 890;
  const railP = appear(localFrame, 2, 26);
  const panX = interpolate(localFrame, [0, Math.max(1, durationFrames)], [28, -28]);

  const xs = points.length === 1 ? [540] : points.length === 2 ? [310, 770] : [200, 540, 880];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <TimelineGridBackdrop />

      {/* Top Header */}
      <div
        style={{
          position: 'absolute',
          top: 108,
          left: 72,
          right: 72,
          opacity: appear(localFrame, 0, 14),
        }}
      >
        <div
          style={{
            display: 'inline-block',
            padding: '8px 22px',
            borderRadius: 999,
            background: 'rgba(56, 189, 248, 0.16)',
            border: '1.5px solid rgba(56, 189, 248, 0.5)',
            color: '#7DD3FC',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 22,
            fontWeight: 700,
            marginBottom: 14,
          }}
        >
          ⏱ {t.badge || 'TIMELINE TRACK'}
        </div>
        <FitText text={t.title} baseSize={52} minSize={34} maxLines={2} color="#F8FAFC" fontWeight={800} align="left" />
      </div>

      {/* Horizontal panning timeline track + nodes */}
      <div style={{ position: 'absolute', inset: 0, transform: `translateX(${panX}px)` }}>
        <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
          {/* Background track */}
          <line x1={40} y1={railY} x2={STAGE_W - 40} y2={railY} stroke="#334155" strokeWidth={8} strokeLinecap="round" />
          {/* Ruler ticks */}
          {Array.from({ length: 25 }).map((_, i) => (
            <line
              key={i}
              x1={60 + i * 40}
              y1={railY - (i % 4 === 0 ? 16 : 8)}
              x2={60 + i * 40}
              y2={railY + (i % 4 === 0 ? 16 : 8)}
              stroke="#64748B"
              strokeWidth={2}
              opacity={0.55}
            />
          ))}
          {/* Animated active glowing progress bar */}
          <line
            x1={40}
            y1={railY}
            x2={40 + (STAGE_W - 80) * railP}
            y2={railY}
            stroke="#38BDF8"
            strokeWidth={8}
            strokeLinecap="round"
          />

          {/* Stem connectors & glowing nodes */}
          {points.map((_, i) => {
            const nx = xs[i] ?? 540;
            const above = i % 2 === 0;
            const p = stagger(i, localFrame, 8, 8, 14);
            const col = i === 0 ? '#38BDF8' : i === 1 ? '#F59E0B' : '#34D399';
            return (
              <g key={i} opacity={p}>
                <line x1={nx} y1={railY} x2={nx} y2={above ? railY - 125 : railY + 125} stroke={col} strokeWidth={3.5} />
                <circle cx={nx} cy={railY} r={24} fill="#0F172A" stroke={col} strokeWidth={5} />
                <circle cx={nx} cy={railY} r={9} fill={col} />
              </g>
            );
          })}
        </svg>

        {/* Alternating milestone cards above & below the horizontal rail */}
        {points.map((pt, i) => {
          const nx = xs[i] ?? 540;
          const above = i % 2 === 0;
          const p = stagger(i, localFrame, 8, 10, 15);
          const col = i === 0 ? '#38BDF8' : i === 1 ? '#F59E0B' : '#34D399';
          const cardW = points.length === 1 ? 780 : points.length === 2 ? 450 : 330;
          const left = Math.max(44, Math.min(STAGE_W - cardW - 44, nx - cardW / 2));
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left,
                top: above ? railY - 430 : railY + 126,
                width: cardW,
                padding: '26px 28px',
                borderRadius: 20,
                background: 'rgba(22, 32, 56, 0.94)',
                border: `2px solid ${col}88`,
                boxShadow: `0 16px 36px rgba(0, 0, 0, 0.45)`,
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [above ? 24 : -24, 0])}px)`,
              }}
            >
              <div
                style={{
                  display: 'inline-block',
                  padding: '4px 14px',
                  borderRadius: 8,
                  background: `${col}26`,
                  color: col,
                  fontFamily: THAI_FONT_FAMILY,
                  fontSize: 22,
                  fontWeight: 800,
                  marginBottom: 12,
                }}
              >
                {extractStepLabel(scene, i)}
              </div>
              <FitText
                text={pt}
                baseSize={points.length === 1 ? 38 : points.length === 2 ? 34 : 30}
                minSize={21}
                maxLines={4}
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
};

/** look-36 Shot 2: vertical-scroll — ไทม์ไลน์แนวตั้งที่เลื่อนขึ้นพร้อมไอคอน */
const VerticalScrollShot: React.FC<StyleShotArgs> = ({ scene, localFrame, durationFrames }) => {
  const t = sceneTexts(scene);
  const points = extractPoints(scene, 4);
  const spineX = 166;
  const spineTop = 360;
  const spineBottom = 1410;
  const beamP = appear(localFrame, 2, 34);
  const scrollDrift = interpolate(localFrame, [0, Math.max(1, durationFrames)], [22, -16]);
  const count = Math.max(1, points.length);
  const rowStep = count <= 2 ? 360 : count === 3 ? 310 : 255;

  const renderNodeIcon = (idx: number, color: string) => {
    const k = idx % 4;
    if (k === 0) {
      return <path d="M 0 -16 L 4 -4 L 16 0 L 4 4 L 0 16 L -4 4 L -16 0 L -4 -4 Z" fill={color} />;
    }
    if (k === 1) {
      return (
        <g stroke={color} strokeWidth={3.5} fill="none" strokeLinecap="round">
          <circle r={14} />
          <path d="M 0 -8 L 0 2 L 7 6" />
        </g>
      );
    }
    if (k === 2) {
      return <path d="M -12 2 L -3 11 L 14 -10" fill="none" stroke={color} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />;
    }
    return <path d="M -10 14 L -10 -14 L 12 -6 L -10 2" fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />;
  };

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <TimelineGridBackdrop />

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 100,
          left: 72,
          right: 72,
          opacity: appear(localFrame, 0, 14),
        }}
      >
        <div
          style={{
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 22,
            fontWeight: 700,
            color: '#34D399',
            letterSpacing: 1.5,
            marginBottom: 8,
          }}
        >
          ▼ {t.badge || 'STEP-BY-STEP TIMELINE'}
        </div>
        <FitText text={t.title} baseSize={50} minSize={32} maxLines={2} color="#F8FAFC" fontWeight={800} align="left" />
      </div>

      {/* Scrolling vertical timeline */}
      <div style={{ position: 'absolute', inset: 0, transform: `translateY(${scrollDrift}px)` }}>
        <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
          <line x1={spineX} y1={spineTop} x2={spineX} y2={spineBottom} stroke="#334155" strokeWidth={6} strokeLinecap="round" />
          <line
            x1={spineX}
            y1={spineTop}
            x2={spineX}
            y2={spineTop + (spineBottom - spineTop) * beamP}
            stroke="#38BDF8"
            strokeWidth={6}
            strokeLinecap="round"
          />

          {points.map((_, i) => {
            const ny = 450 + i * rowStep;
            const p = stagger(i, localFrame, 7, 6, 14);
            const col = i % 3 === 0 ? '#38BDF8' : i % 3 === 1 ? '#F59E0B' : '#34D399';
            return (
              <g key={i} transform={`translate(${spineX}, ${ny}) scale(${p})`}>
                <line x1={38} y1={0} x2={86} y2={0} stroke={col} strokeWidth={3} strokeDasharray="5 4" />
                <circle r={38} fill="#0F172A" stroke={col} strokeWidth={4} />
                {renderNodeIcon(i, col)}
              </g>
            );
          })}
        </svg>

        {points.map((pt, i) => {
          const ny = 450 + i * rowStep;
          const p = stagger(i, localFrame, 7, 9, 15);
          const col = i % 3 === 0 ? '#38BDF8' : i % 3 === 1 ? '#F59E0B' : '#34D399';
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: ny - 76,
                left: 256,
                right: 70,
                padding: '22px 28px',
                borderRadius: 20,
                background: 'rgba(22, 32, 56, 0.92)',
                borderLeft: `6px solid ${col}`,
                borderTop: '1px solid rgba(148, 163, 184, 0.2)',
                borderRight: '1px solid rgba(148, 163, 184, 0.2)',
                borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
                opacity: p,
                transform: `translateX(${interpolate(p, [0, 1], [36, 0])}px)`,
              }}
            >
              <div style={{ fontFamily: THAI_FONT_FAMILY, fontSize: 20, fontWeight: 800, color: col, marginBottom: 6 }}>
                STEP {extractStepLabel(scene, i)}
              </div>
              <FitText text={pt} baseSize={31} minSize={21} maxLines={3} color="#F8FAFC" fontWeight={700} align="left" />
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-36 Shot 3: milestone-zoom — ซูมไปที่จุดเดียว เห็นวันที่ใหญ่ + เหตุการณ์ */
const MilestoneZoomShot: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps }) => {
  const t = sceneTexts(scene);
  const metric = extractPrimaryMetric(scene, sceneIndex);
  const detail = scene.stat?.label || scene.quote?.text || t.subtitle || extractPoints(scene, 1)[0] || '';
  const zoomP = spring({ frame: localFrame, fps, config: { damping: 14, stiffness: 110 } });
  const bezelRot = localFrame * 0.35;
  const cx = 540;
  const cy = 740;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <TimelineGridBackdrop />

      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <radialGradient id="milestone-spot" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.28" />
            <stop offset="60%" stopColor="#F59E0B" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#091022" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Horizontal timeline rail passing through the zoomed milestone */}
        <line x1={0} y1={cy} x2={STAGE_W} y2={cy} stroke="#334155" strokeWidth={8} />
        <line x1={0} y1={cy} x2={cx} y2={cy} stroke="#38BDF8" strokeWidth={8} />

        {/* Spotlight glow */}
        <circle cx={cx} cy={cy} r={390 * zoomP} fill="url(#milestone-spot)" />

        {/* Rotating precision chronometer rings */}
        <g transform={`translate(${cx}, ${cy}) scale(${zoomP}) rotate(${bezelRot})`}>
          <circle r={310} fill="none" stroke="#38BDF8" strokeWidth={2.5} strokeDasharray="10 18" opacity={0.55} />
          <circle r={262} fill="none" stroke="#F59E0B" strokeWidth={4} strokeDasharray="110 40 50 40" opacity={0.85} />
        </g>

        <g transform={`translate(${cx}, ${cy}) scale(${zoomP})`}>
          <circle r={224} fill="#0D1730" stroke="#38BDF8" strokeWidth={5} />
          {/* Pointer stem down to event summary */}
          <line x1={0} y1={224} x2={0} y2={326} stroke="#F59E0B" strokeWidth={4} />
          <circle cx={0} cy={326} r={8} fill="#F59E0B" />
        </g>
      </svg>

      {/* Top Event Title */}
      <div
        style={{
          position: 'absolute',
          top: 112,
          left: 76,
          right: 76,
          opacity: appear(localFrame, 0, 14),
        }}
      >
        <div
          style={{
            textAlign: 'center',
            color: '#F59E0B',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 23,
            fontWeight: 800,
            letterSpacing: 2,
            marginBottom: 10,
          }}
        >
          ● MILESTONE FOCUS · {t.badge || `0${sceneIndex + 1}`}
        </div>
        <FitText text={t.title} baseSize={52} minSize={34} maxLines={2} color="#F8FAFC" fontWeight={800} />
      </div>

      {/* Giant Date / Metric inside the zoomed node */}
      <div
        style={{
          position: 'absolute',
          left: cx - 210,
          top: cy - 130,
          width: 420,
          height: 260,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `scale(${zoomP})`,
        }}
      >
        <FitText text={metric.big} baseSize={112} minSize={48} maxLines={1} color="#FFFFFF" fontWeight={900} />
        {metric.unit ? (
          <div style={{ marginTop: 6, maxWidth: 340 }}>
            <FitText text={metric.unit} baseSize={28} minSize={20} maxLines={2} color="#7DD3FC" fontWeight={700} />
          </div>
        ) : null}
      </div>

      {/* Event Description Panel below the focal ring */}
      {detail ? (
        <div
          style={{
            position: 'absolute',
            top: 1076,
            left: 96,
            right: 96,
            maxHeight: SAFE_BOTTOM - 1096,
            padding: '28px 36px',
            borderRadius: 24,
            background: 'rgba(22, 32, 56, 0.92)',
            border: '2px solid rgba(245, 158, 11, 0.55)',
            opacity: appear(localFrame, 14, 16),
            transform: `translateY(${interpolate(appear(localFrame, 14, 16), [0, 1], [24, 0])}px)`,
          }}
        >
          <FitText text={detail} baseSize={34} minSize={23} maxLines={4} color="#F8FAFC" fontWeight={700} />
        </div>
      ) : null}
    </div>
  );
};

/** look-36 Shot 4: then-vs-now — ซ้าย 'ตอนนั้น' ซีเปีย / ขวา 'ตอนนี้' สีสด */
const ThenVsNowShot: React.FC<StyleShotArgs> = ({ scene, localFrame, fps }) => {
  const t = sceneTexts(scene);
  const allPts = extractShortPoints(scene, 4);

  const leftTitle = scene.compare?.leftTitle || 'ตอนนั้น';
  const rightTitle = scene.compare?.rightTitle || 'ตอนนี้';
  const leftItems =
    scene.compare?.leftItems && scene.compare.leftItems.length > 0
      ? scene.compare.leftItems.slice(0, 3)
      : allPts.slice(0, Math.max(1, Math.ceil(allPts.length / 2)));
  const rightItems =
    scene.compare?.rightItems && scene.compare.rightItems.length > 0
      ? scene.compare.rightItems.slice(0, 3)
      : allPts.slice(Math.ceil(allPts.length / 2)).length > 0
        ? allPts.slice(Math.ceil(allPts.length / 2))
        : [t.subtitle || t.title];

  const splitP = spring({ frame: localFrame, fps, config: { damping: 15, stiffness: 120 } });

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      {/* LEFT HALF: Sepia / Vintage "ตอนนั้น" */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: STAGE_W / 2,
          background: 'linear-gradient(180deg, #2B2016 0%, #3E2E1F 52%, #241A11 100%)',
        }}
      >
        {/* Subtle vintage horizontal scanlines */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'repeating-linear-gradient(to bottom, rgba(232,213,183,0.04) 0px, rgba(232,213,183,0.04) 2px, transparent 2px, transparent 10px)',
          }}
        />
      </div>

      {/* RIGHT HALF: Vivid Modern "ตอนนี้" */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: STAGE_W / 2,
          background: 'linear-gradient(180deg, #091B38 0%, #0E2F59 52%, #07162E 100%)',
        }}
      >
        <svg width={STAGE_W / 2} height={STAGE_H} viewBox={`0 0 ${STAGE_W / 2} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <line key={i} x1={i * 90} y1={0} x2={i * 90} y2={STAGE_H} stroke="#38BDF8" strokeOpacity={0.12} />
          ))}
        </svg>
      </div>

      {/* Center Vertical Time-Bridge Divider */}
      <div
        style={{
          position: 'absolute',
          top: 310,
          bottom: STAGE_H - SAFE_BOTTOM + 20,
          left: STAGE_W / 2 - 3,
          width: 6,
          background: 'linear-gradient(180deg, #D4B483 0%, #38BDF8 50%, #34D399 100%)',
        }}
      />

      {/* Central Transition Arrow Emblem */}
      <div
        style={{
          position: 'absolute',
          left: STAGE_W / 2 - 42,
          top: 720,
          width: 84,
          height: 84,
          borderRadius: '50%',
          background: '#0F172A',
          border: '4px solid #38BDF8',
          boxShadow: '0 0 28px rgba(56, 189, 248, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#FFFFFF',
          fontFamily: THAI_FONT_FAMILY,
          fontSize: 34,
          fontWeight: 900,
          transform: `scale(${splitP})`,
          zIndex: 5,
        }}
      >
        →
      </div>

      {/* Top Unified Title */}
      <div
        style={{
          position: 'absolute',
          top: 98,
          left: 56,
          right: 56,
          padding: '22px 32px',
          borderRadius: 22,
          background: 'rgba(12, 16, 30, 0.82)',
          border: '1.5px solid rgba(255,255,255,0.18)',
          opacity: appear(localFrame, 0, 14),
        }}
      >
        <FitText text={t.title} baseSize={46} minSize={30} maxLines={2} color="#FFFFFF" fontWeight={800} />
      </div>

      {/* Left Column Content ("ตอนนั้น") */}
      <div
        style={{
          position: 'absolute',
          top: 360,
          left: 36,
          width: STAGE_W / 2 - 88,
          maxHeight: SAFE_BOTTOM - 380,
          display: 'flex',
          flexDirection: 'column',
          gap: 30,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <svg width={38} height={38} viewBox="0 0 38 38">
            <circle cx={19} cy={19} r={16} fill="none" stroke="#D4B483" strokeWidth={3} />
            <path d="M 19 10 L 19 19 L 25 23" fill="none" stroke="#D4B483" strokeWidth={3} strokeLinecap="round" />
          </svg>
          <FitText text={leftTitle} baseSize={38} minSize={24} maxLines={1} color="#E8D5B7" fontWeight={800} align="left" />
        </div>
        {leftItems.map((item, i) => {
          const p = stagger(i, localFrame, 7, 8, 14);
          return (
            <div
              key={i}
              style={{
                padding: '28px 24px',
                borderRadius: 18,
                background: 'rgba(232, 213, 183, 0.1)',
                border: '1.5px solid rgba(212, 180, 131, 0.35)',
                opacity: p,
                transform: `translateX(${interpolate(p, [0, 1], [-24, 0])}px)`,
              }}
            >
              <FitText text={item} baseSize={33} minSize={22} maxLines={4} color="#EADBC4" fontWeight={600} align="left" />
            </div>
          );
        })}
      </div>

      {/* Right Column Content ("ตอนนี้") */}
      <div
        style={{
          position: 'absolute',
          top: 360,
          left: STAGE_W / 2 + 52,
          width: STAGE_W / 2 - 88,
          maxHeight: SAFE_BOTTOM - 380,
          display: 'flex',
          flexDirection: 'column',
          gap: 30,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <svg width={38} height={38} viewBox="0 0 38 38">
            <path d="M 21 4 L 9 21 L 19 21 L 17 34 L 29 17 L 19 17 Z" fill="#34D399" />
          </svg>
          <FitText text={rightTitle} baseSize={38} minSize={24} maxLines={1} color="#38BDF8" fontWeight={800} align="left" />
        </div>
        {rightItems.map((item, i) => {
          const p = stagger(i, localFrame, 7, 12, 14);
          return (
            <div
              key={i}
              style={{
                padding: '28px 24px',
                borderRadius: 18,
                background: 'rgba(56, 189, 248, 0.15)',
                border: '1.5px solid rgba(52, 211, 153, 0.55)',
                boxShadow: '0 8px 24px rgba(56, 189, 248, 0.14)',
                opacity: p,
                transform: `translateX(${interpolate(p, [0, 1], [24, 0])}px)`,
              }}
            >
              <FitText text={item} baseSize={33} minSize={22} maxLines={4} color="#FFFFFF" fontWeight={700} align="left" />
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// EXPORT BATCH_C: look-1 (Glow World), look-31 (Paper Desk), look-36 (Timeline)
// ============================================================================

export const BATCH_C: StyleDirectorDef[] = [
  {
    styleId: 'look-1',
    shots: {
      'glow-portal': GlowPortalShot,
      constellation: ConstellationShot,
      'orb-core': OrbCoreShot,
      'light-path': LightPathShot,
    },
    shotLabels: {
      'glow-portal': 'ประตูวงแหวนแสงที่ข้อความลอยออกมา',
      constellation: 'กลุ่มดาวเชื่อมเส้นโนดจากประเด็นสำคัญ',
      'orb-core': 'ลูกแก้วพลังงานกลางจอพร้อมวงโคจรคีย์เวิร์ด',
      'light-path': 'เส้นทางแสงคดเคี้ยวจากล่างขึ้นบนพร้อมจุดเช็กพอยต์',
    },
    infer: (scene) => {
      const text = haystackOf(scene);
      if (STEP_RE.test(text) || (Array.isArray(scene.steps) && scene.steps.length > 0)) {
        return 'light-path';
      }
      if (scene.stat || /(?:%|เท่า|ล้าน|อันดับ|\d+\+)/.test(text)) {
        return 'orb-core';
      }
      if ((Array.isArray(scene.bullets) && scene.bullets.length >= 2) || /(?:เชื่อม|ระบบ|โครงสร้าง|องค์ประกอบ)/.test(text)) {
        return 'constellation';
      }
      if (/(?:เปิด|เริ่ม|ประตู|ความลับ|ไอเดีย|เปลี่ยน)/.test(text)) {
        return 'glow-portal';
      }
      return null;
    },
  },
  {
    styleId: 'look-31',
    shots: {
      'desk-overhead': DeskOverheadShot,
      'sticky-wall': StickyWallShot,
      'folder-open': FolderOpenShot,
      'highlight-doc': HighlightDocShot,
    },
    shotLabels: {
      'desk-overhead': 'มุมมองโต๊ะจากด้านบนพร้อมเอกสาร ปากกา แก้วกาแฟ และมือวางกระดาษ',
      'sticky-wall': 'บอร์ดโพสต์อิทหลายสีแปะทีละใบจากประเด็นสำคัญ',
      'folder-open': 'แฟ้มเอกสารเปิดกางเผยหน้าเอกสารและหัวเรื่องด้านใน',
      'highlight-doc': 'หน้าเอกสารซูมใกล้พร้อมปากกาไฮไลต์ลากผ่านคำสำคัญ',
    },
    infer: (scene) => {
      const text = haystackOf(scene);
      if (SUMMARY_RE.test(text) || scene.quote?.text) {
        return 'highlight-doc';
      }
      if (scene.stat || /(?:แฟ้ม|หลักฐาน|สถิติ|ตัวเลข|ข้อมูล)/.test(text)) {
        return 'folder-open';
      }
      if ((Array.isArray(scene.bullets) && scene.bullets.length >= 2) || /(?:ประเด็น|รายการ|เช็กลิสต์|โน้ต)/.test(text)) {
        return 'sticky-wall';
      }
      if (STEP_RE.test(text) || /(?:โต๊ะ|เอกสาร|เริ่ม)/.test(text)) {
        return 'desk-overhead';
      }
      return null;
    },
  },
  {
    styleId: 'look-36',
    shots: {
      'horizontal-track': HorizontalTrackShot,
      'vertical-scroll': VerticalScrollShot,
      'milestone-zoom': MilestoneZoomShot,
      'then-vs-now': ThenVsNowShot,
    },
    shotLabels: {
      'horizontal-track': 'เส้นเวลาแนวนอนที่กล้องเลื่อนผ่านจุดปีและเหตุการณ์',
      'vertical-scroll': 'ไทม์ไลน์แนวตั้งเลื่อนขึ้นพร้อมไอคอนแต่ละขั้น',
      'milestone-zoom': 'ซูมโฟกัสหมุดเหตุการณ์สำคัญพร้อมตัวเลข/วันที่ใหญ่',
      'then-vs-now': 'เทียบซ้ายตอนนั้นโทนซีเปียกับขวาตอนนี้โทนสีสด',
    },
    infer: (scene) => {
      const text = haystackOf(scene);
      if (scene.compare || COMPARE_RE.test(text)) {
        return 'then-vs-now';
      }
      if (STEP_RE.test(text) || (Array.isArray(scene.steps) && scene.steps.length > 0)) {
        return 'vertical-scroll';
      }
      if (YEAR_OR_DATE_RE.test(text)) {
        return scene.stat || /(?:จุดเปลี่ยน|สำคัญ|ประวัติศาสตร์)/.test(text) ? 'milestone-zoom' : 'horizontal-track';
      }
      if (scene.stat) {
        return 'milestone-zoom';
      }
      return null;
    },
  },
];
