import React from 'react';
import { interpolate, spring } from 'remotion';
import type { StudioScene } from '../types';
import { appear, clamp01, easeOutCubic, FitText, sceneTexts, STAGE_H, STAGE_W, stagger } from './kit';
import type { StyleDirectorDef, StyleShotArgs } from './types';

const FONT_THAI = "'Noto Sans Thai', 'Kanit', sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace";

// ============================================================================
// Shared helpers for Batch A (Data / UI styles: look-15, look-24, look-27)
// All primary visual content stays cleanly inside y <= 1360 to leave generous
// breathing room above the 1-2 line SubtitleBar.
// ============================================================================

function parseNum(raw: string | number | undefined, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw || '').replace(/,/g, '');
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return fallback;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function shortText(text: string, maxLen: number): string {
  const clean = String(text || '').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(1, maxLen - 1)).trim()}…`;
}

function getHighlightText(scene: StudioScene): string {
  if (!scene.highlight) return '';
  return Array.isArray(scene.highlight) ? String(scene.highlight[0] || '').trim() : String(scene.highlight).trim();
}

interface ChatMsg {
  side: 'left' | 'right';
  sender: string;
  text: string;
  time: string;
  isHero?: boolean;
}

function extractChatMessages(scene: StudioScene): ChatMsg[] {
  const txt = sceneTexts(scene);
  const pool: string[] = [];

  if (scene.compare) {
    const l = scene.compare.leftTitle ? `${scene.compare.leftTitle}: ${scene.compare.leftItems?.[0] || ''}`.trim() : '';
    const r = scene.compare.rightTitle ? `${scene.compare.rightTitle}: ${scene.compare.rightItems?.[0] || ''}`.trim() : '';
    if (l) pool.push(l);
    if (r) pool.push(r);
    if (scene.compare.rightItems?.[1]) pool.push(scene.compare.rightItems[1]);
  } else if (txt.bullets.length > 0) {
    for (const b of txt.bullets.slice(0, 3)) pool.push(b);
  } else if (txt.subtitle) {
    pool.push(txt.subtitle);
  }

  if (scene.stat?.value) {
    const statLine = `${scene.stat.value}${scene.stat.unit ? ` ${scene.stat.unit}` : ''}${scene.stat.delta ? ` · ${scene.stat.delta}` : ''}`.trim();
    if (statLine && !pool.includes(statLine)) pool.push(statLine);
  }

  const msgs: ChatMsg[] = [];
  const namesLeft = ['ผู้ถาม', 'ทีมวิเคราะห์', 'สมาชิก'];
  const namesRight = ['ผู้เชี่ยวชาญ', 'โฮสต์', 'สรุปหลัก'];

  if (txt.title) {
    msgs.push({
      side: 'left',
      sender: namesLeft[0],
      text: txt.title,
      time: '09:41',
    });
  }

  pool.slice(0, 3).forEach((line, idx) => {
    const side: 'left' | 'right' = idx % 2 === 0 ? 'right' : 'left';
    msgs.push({
      side,
      sender: side === 'right' ? namesRight[idx % namesRight.length] : namesLeft[(idx + 1) % namesLeft.length],
      text: line,
      time: `09:4${Math.min(9, 2 + idx)}`,
      isHero: idx === pool.slice(0, 3).length - 1,
    });
  });

  if (msgs.length < 2) {
    msgs.push({
      side: 'right',
      sender: namesRight[0],
      text: txt.subtitle || getHighlightText(scene) || txt.badge || 'ประเด็นสำคัญที่ต้องจับตา',
      time: '09:42',
      isHero: true,
    });
  }

  if (msgs.length > 0 && !msgs.some((m) => m.isHero)) {
    msgs[msgs.length - 1].isHero = true;
  }

  return msgs.slice(0, 4);
}

interface RankedItem {
  label: string;
  value: number;
  display: string;
  isHero: boolean;
}

function extractRankedItems(scene: StudioScene, count: number): RankedItem[] {
  const txt = sceneTexts(scene);
  const rawLabels: string[] = [];

  if (scene.compare) {
    if (scene.compare.rightTitle) rawLabels.push(scene.compare.rightTitle);
    if (scene.compare.leftTitle) rawLabels.push(scene.compare.leftTitle);
    for (const item of [...(scene.compare.rightItems || []), ...(scene.compare.leftItems || [])]) {
      if (item && !rawLabels.includes(item)) rawLabels.push(item);
    }
  } else if (Array.isArray(scene.steps) && scene.steps.length > 0) {
    for (const st of scene.steps) {
      const s = typeof st === 'string' ? st : st.title;
      if (s) rawLabels.push(s);
    }
  } else if (txt.bullets.length > 0) {
    for (const b of txt.bullets) rawLabels.push(b);
  }

  if (scene.stat?.label && rawLabels.length < count) rawLabels.unshift(scene.stat.label);
  if (txt.subtitle && rawLabels.length < count) rawLabels.push(txt.subtitle);
  if (txt.title && rawLabels.length < count && !rawLabels.includes(txt.title)) rawLabels.push(txt.title);

  const fallbackLabels = ['อันดับผู้นำหลัก', 'คู่แข่งอันดับรอง', 'กลุ่มเติบโตเร็ว', 'กลุ่มมาตรฐานเดิม', 'กลุ่มเริ่มต้น'];
  while (rawLabels.length < count) {
    rawLabels.push(fallbackLabels[rawLabels.length % fallbackLabels.length]);
  }

  // Strictly descending editorial bar widths (94 -> 78 -> 64 -> 51 -> 38) while preserving
  // real numeric badges from the scene so #1 is always visually longest and bars never invert.
  const rankedWidths = [94, 78, 64, 51, 38];
  const statDisplay = scene.stat?.value ? `${scene.stat.value}` : '';

  const items: RankedItem[] = rawLabels.slice(0, count).map((label, idx) => {
    const numToken = idx === 0 && statDisplay ? statDisplay : txt.numbers[idx];
    const barPct = rankedWidths[idx % rankedWidths.length];
    return {
      label: label.trim(),
      value: barPct,
      display: numToken || `${barPct}%`,
      isHero: idx === 0,
    };
  });

  return items;
}

interface VersusData {
  leftTitle: string;
  rightTitle: string;
  leftItems: string[];
  rightItems: string[];
  leftScore: number;
  rightScore: number;
  winner: 'left' | 'right';
  verdictSummary: string;
}

function extractVersusData(scene: StudioScene): VersusData {
  const txt = sceneTexts(scene);

  if (scene.compare) {
    const winner: 'left' | 'right' = scene.compare.winner === 'left' ? 'left' : 'right';
    const leftItems = (scene.compare.leftItems || []).filter(Boolean);
    const rightItems = (scene.compare.rightItems || []).filter(Boolean);
    return {
      leftTitle: scene.compare.leftTitle || 'ฝั่ง A',
      rightTitle: scene.compare.rightTitle || 'ฝั่ง B',
      leftItems: leftItems.length ? leftItems : ['แนวทางแบบดั้งเดิม'],
      rightItems: rightItems.length ? rightItems : ['แนวทางสมัยใหม่ที่เร็วกว่า'],
      leftScore: winner === 'left' ? 92 : 58,
      rightScore: winner === 'right' ? 94 : 62,
      winner,
      verdictSummary: txt.subtitle || (winner === 'right' ? rightItems[0] : leftItems[0]) || txt.title,
    };
  }

  let leftTitle = 'วิธีแบบเดิม';
  let rightTitle = getHighlightText(scene) || 'ระบบอัจฉริยะ';
  const splitMatch = txt.title.match(/(.+?)(?:\s+vs\.?\s+|\s+กับ\s+|\s+หรือ\s+|\s+เทียบ\s+)(.+)/i);
  if (splitMatch) {
    leftTitle = splitMatch[1].replace(/^เทียบให้ชัดระหว่าง|^ระหว่าง/g, '').trim() || leftTitle;
    rightTitle = splitMatch[2].trim() || rightTitle;
  } else if (scene.stat?.label) {
    leftTitle = 'ค่าเฉลี่ยทั่วไป';
    rightTitle = `${scene.stat.value} ${scene.stat.unit || ''}`.trim();
  } else if (Array.isArray(scene.steps) && scene.steps.length >= 2) {
    const s0 = typeof scene.steps[0] === 'string' ? scene.steps[0] : scene.steps[0].title;
    const s1 = typeof scene.steps[1] === 'string' ? scene.steps[1] : scene.steps[1].title;
    leftTitle = shortText(s0, 24);
    rightTitle = shortText(s1, 24);
  }

  const dedup = (arr: string[], titleToAvoid: string) => arr.filter((x) => x && x.trim() !== titleToAvoid.trim());

  let leftItems = dedup(
    txt.bullets.length >= 2 ? [txt.bullets[0], txt.bullets[2] || 'ต้นทุนเวลาและแรงงานสูงกว่า'] : [txt.subtitle || 'จุดเริ่มต้นก่อนปรับระบบ'],
    leftTitle,
  );
  let rightItems = dedup(
    txt.bullets.length >= 2 ? [txt.bullets[1], txt.subtitle || 'ผลลัพธ์คมชัดและวัดผลได้ทันที'] : [txt.title || 'ผลลัพธ์ที่โดดเด่นกว่าชัดเจน'],
    rightTitle,
  );

  if (leftItems.length === 0) leftItems = ['ขั้นตอนซับซ้อนและใช้เวลานาน'];
  if (rightItems.length === 0) rightItems = [txt.title || 'ผลลัพธ์รวดเร็วและแม่นยำกว่า'];

  return {
    leftTitle,
    rightTitle,
    leftItems,
    rightItems,
    leftScore: 61,
    rightScore: scene.stat?.numericValue ? Math.min(99, Math.max(76, parseNum(scene.stat.numericValue, 93))) : 93,
    winner: 'right',
    verdictSummary: scene.quote?.text || txt.subtitle || txt.bullets[0] || txt.title,
  };
}

// ============================================================================
// STYLE 1: look-15 — Text Thread (Receding light blue-grey grid + 3D chat UI)
// ============================================================================

const Look15GridBackdrop: React.FC<{ localFrame: number; tokens: any; dark?: boolean }> = ({ localFrame, tokens, dark }) => {
  const p = tokens?.palette || {};
  const floorTop = dark ? p.bg || '#131722' : '#F8FAFC';
  const floorMid = dark ? p.bg2 || '#1E2436' : p.accent || '#EDF1F7';
  const floorBot = dark ? '#0F172A' : p.accent2 || '#D2D9E5';
  const gridStroke = dark ? 'rgba(96,165,250,0.16)' : '#CBD5E1';
  const driftY = (localFrame * 1.4) % 90;

  return (
    <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <linearGradient id={`l15-bg-${dark ? 'd' : 'l'}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={floorTop} />
          <stop offset="45%" stopColor={floorMid} />
          <stop offset="100%" stopColor={floorBot} />
        </linearGradient>
        <radialGradient id={`l15-glow-${dark ? 'd' : 'l'}`} cx="50%" cy="32%" r="55%">
          <stop offset="0%" stopColor="#60A5FA" stopOpacity={dark ? '0.24' : '0.16'} />
          <stop offset="100%" stopColor="#60A5FA" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={STAGE_W} height={STAGE_H} fill={`url(#l15-bg-${dark ? 'd' : 'l'})`} />
      <rect width={STAGE_W} height={STAGE_H} fill={`url(#l15-glow-${dark ? 'd' : 'l'})`} />
      {[-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6].map((i) => (
        <line
          key={`v-${i}`}
          x1={540 + i * 74}
          y1={0}
          x2={540 + i * 195}
          y2={STAGE_H}
          stroke={gridStroke}
          strokeWidth={1.6}
          opacity={0.62}
        />
      ))}
      {Array.from({ length: 18 }).map((_, idx) => {
        const y = idx * 108 + driftY;
        return (
          <line
            key={`h-${idx}`}
            x1={0}
            y1={y}
            x2={STAGE_W}
            y2={y}
            stroke={gridStroke}
            strokeWidth={1.2 + idx * 0.08}
            opacity={0.38 + (idx / 18) * 0.35}
          />
        );
      })}
    </svg>
  );
};

/** look-15 / shot 1: chat-burst — alternating 3D chat bubbles popping in sequentially */
const Look15ChatBurst: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const txt = sceneTexts(scene);
  const msgs = extractChatMessages(scene);
  const pulse = 0.65 + Math.sin(localFrame * 0.16) * 0.35;
  const headerIn = appear(localFrame, 0, 14);
  const dotIdx = Math.floor(localFrame / 9) % 3;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <Look15GridBackdrop localFrame={localFrame} tokens={tokens} />

      {/* Floating top thread pill */}
      <div
        style={{
          position: 'absolute',
          top: 76,
          left: 56,
          right: 56,
          height: 86,
          borderRadius: 44,
          background: 'rgba(255,255,255,0.92)',
          border: '2px solid #CBD5E1',
          boxShadow: '0 16px 32px rgba(15,23,42,0.10)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 32px',
          opacity: headerIn,
          transform: `translateY(${(1 - headerIn) * -20}px)`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: 99,
              background: '#22C55E',
              boxShadow: `0 0 ${10 + pulse * 12}px rgba(34,197,94,0.85)`,
            }}
          />
          <span style={{ fontFamily: FONT_THAI, fontSize: 27, fontWeight: 800, color: '#0F172A' }}>
            {shortText(txt.badge || 'LIVE THREAD · ข้อความล่าสุด', 34)}
          </span>
        </div>
        <span style={{ fontFamily: FONT_MONO, fontSize: 23, fontWeight: 700, color: '#64748B' }}>
          {msgs.length} MSGS
        </span>
      </div>

      {/* Cascading alternating 3D chat bubbles cleanly inside y: 188..1340 */}
      <div
        style={{
          position: 'absolute',
          top: 188,
          left: 54,
          right: 54,
          height: 1152,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          gap: 24,
        }}
      >
        {msgs.map((m, idx) => {
          const sp = spring({
            frame: Math.max(0, localFrame - (4 + idx * 8)),
            fps,
            config: { damping: 14, stiffness: 150, mass: 0.9 },
          });
          const bob = Math.sin(localFrame * 0.08 + idx * 1.4) * 4;
          const isRight = m.side === 'right';
          const isHero = Boolean(m.isHero);

          return (
            <div
              key={idx}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: isRight ? 'flex-end' : 'flex-start',
                opacity: clamp01(sp * 1.4),
                transform: `translateY(${(1 - sp) * 40 + bob}px) scale(${0.86 + sp * 0.14})`,
              }}
            >
              <div
                style={{
                  position: 'relative',
                  maxWidth: isHero ? '92%' : '84%',
                  padding: isHero ? '26px 34px' : '22px 30px',
                  borderRadius: isRight ? '32px 32px 10px 32px' : '32px 32px 32px 10px',
                  background: isHero
                    ? 'linear-gradient(135deg, #1D4ED8 0%, #2563EB 65%, #3B82F6 100%)'
                    : isRight
                      ? '#2563EB'
                      : '#FFFFFF',
                  border: isHero ? '3px solid #93C5FD' : isRight ? '2px solid #3B82F6' : '2px solid #E2E8F0',
                  boxShadow: isRight
                    ? '0 20px 38px rgba(37,99,235,0.26)'
                    : '0 18px 34px rgba(15,23,42,0.11)',
                }}
              >
                {isHero && (
                  <div
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 19,
                      fontWeight: 800,
                      letterSpacing: 2,
                      color: '#BFDBFE',
                      marginBottom: 6,
                    }}
                  >
                    KEY MESSAGE · PINNED
                  </div>
                )}
                <FitText
                  text={m.text}
                  baseSize={isHero ? 38 : 32}
                  minSize={23}
                  maxLines={3}
                  align="left"
                  color={isRight || isHero ? '#FFFFFF' : '#0F172A'}
                  fontWeight={isHero ? 800 : 700}
                  lineHeight={1.34}
                />
              </div>
              <div
                style={{
                  marginTop: 6,
                  padding: '0 14px',
                  fontFamily: FONT_MONO,
                  fontSize: 19,
                  fontWeight: 700,
                  color: '#64748B',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span>{m.sender}</span>
                <span>·</span>
                <span>{m.time}</span>
                {isRight && <span style={{ color: '#2563EB' }}>✓✓</span>}
              </div>
            </div>
          );
        })}

        {/* Floating live typing pill */}
        <div
          style={{
            alignSelf: 'flex-start',
            marginTop: 2,
            opacity: appear(localFrame, 26, 12),
            transform: `translateY(${Math.sin(localFrame * 0.11) * 4}px)`,
          }}
        >
          <svg width={174} height={68} viewBox="0 0 186 74">
            <rect x={4} y={6} width={178} height={64} rx={32} fill="#FFFFFF" stroke="#CBD5E1" strokeWidth={2.5} />
            {[0, 1, 2].map((i) => (
              <circle
                key={i}
                cx={52 + i * 41}
                cy={38 + (i === dotIdx ? -8 : 0)}
                r={i === dotIdx ? 11 : 8.5}
                fill={i === dotIdx ? '#2563EB' : '#94A3B8'}
              />
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
};

/** look-15 / shot 2: typing-reveal — '...' indicator builds anticipation then reveals giant hero bubble */
const Look15TypingReveal: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const txt = sceneTexts(scene);
  const setupText = txt.subtitle || txt.bullets[0] || txt.badge || 'มีคำถามสำคัญที่หลายคนสงสัย...';
  const revealText = txt.title || txt.bullets[1] || 'คำตอบสำคัญอยู่ที่นี่';
  const subDetail = txt.bullets[1] || txt.bullets[0] || scene.stat?.delta || '';

  const promptIn = appear(localFrame, 2, 12);
  const revealStart = 18;
  const heroSpring = spring({
    frame: Math.max(0, localFrame - revealStart),
    fps,
    config: { damping: 13, stiffness: 145, mass: 0.9 },
  });
  const dotBounce = (i: number) => Math.sin(localFrame * 0.24 - i * 1.1) * 9;
  const rayRot = localFrame * 0.7;
  const badgePop = appear(localFrame, 28, 12);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <Look15GridBackdrop localFrame={localFrame} tokens={tokens} />

      {/* Top incoming prompt bubble */}
      <div
        style={{
          position: 'absolute',
          top: 96,
          left: 60,
          width: 790,
          opacity: promptIn,
          transform: `translateY(${(1 - promptIn) * -22}px)`,
        }}
      >
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 21,
            fontWeight: 800,
            color: '#64748B',
            marginBottom: 8,
            paddingLeft: 12,
          }}
        >
          INCOMING · {shortText(txt.badge || 'QUESTION', 26)}
        </div>
        <div
          style={{
            background: '#FFFFFF',
            border: '2.5px solid #CBD5E1',
            borderRadius: '34px 34px 34px 10px',
            padding: '24px 34px',
            boxShadow: '0 20px 38px rgba(15,23,42,0.10)',
          }}
        >
          <FitText text={setupText} baseSize={33} minSize={23} maxLines={3} align="left" color="#1E293B" fontWeight={700} />
        </div>
      </div>

      {/* Animated '...' typing pill */}
      <div
        style={{
          position: 'absolute',
          top: 374,
          right: 64,
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          opacity: appear(localFrame, 6, 10),
        }}
      >
        <span style={{ fontFamily: FONT_THAI, fontSize: 25, fontWeight: 700, color: '#2563EB' }}>
          {localFrame >= revealStart ? 'ส่งคำตอบแล้ว' : 'กำลังพิมพ์...'}
        </span>
        <svg width={212} height={82} viewBox="0 0 220 86">
          <rect x={4} y={6} width={212} height={74} rx={37} fill="#DBEAFE" stroke="#60A5FA" strokeWidth={2.5} />
          {[0, 1, 2].map((i) => (
            <circle
              key={i}
              cx={62 + i * 48}
              cy={43 + dotBounce(i)}
              r={12}
              fill={i === 1 ? '#1D4ED8' : '#2563EB'}
            />
          ))}
        </svg>
      </div>

      {/* Radiating starburst behind giant reveal bubble */}
      <svg
        width={STAGE_W}
        height={600}
        viewBox="0 0 1080 600"
        style={{ position: 'absolute', top: 455, left: 0, pointerEvents: 'none', opacity: clamp01(heroSpring) * 0.45 }}
      >
        <g transform={`translate(540, 300) rotate(${rayRot.toFixed(1)})`}>
          {Array.from({ length: 16 }).map((_, i) => (
            <rect
              key={i}
              x={-4}
              y={-285}
              width={8}
              height={105}
              rx={4}
              fill="#60A5FA"
              opacity={i % 2 === 0 ? 0.55 : 0.25}
              transform={`rotate(${i * 22.5})`}
            />
          ))}
        </g>
      </svg>

      {/* Giant Hero Reveal Bubble */}
      <div
        style={{
          position: 'absolute',
          top: 500,
          left: 60,
          right: 60,
          opacity: clamp01(heroSpring * 1.4),
          transform: `scale(${0.72 + heroSpring * 0.28}) translateY(${(1 - heroSpring) * 56 + Math.sin(localFrame * 0.08) * 6}px)`,
        }}
      >
        <div
          style={{
            background: 'linear-gradient(140deg, #1E3A8A 0%, #1D4ED8 45%, #2563EB 100%)',
            border: '4px solid #93C5FD',
            borderRadius: '44px 44px 14px 44px',
            padding: '40px 44px',
            boxShadow: '0 32px 64px rgba(29,78,216,0.34)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <div
              style={{
                padding: '7px 20px',
                borderRadius: 99,
                background: 'rgba(255,255,255,0.18)',
                border: '1.5px solid rgba(255,255,255,0.35)',
                fontFamily: FONT_MONO,
                fontSize: 21,
                fontWeight: 800,
                color: '#DBEAFE',
                letterSpacing: 1.5,
              }}
            >
              ★ REVEALED ANSWER
            </div>
            <span style={{ fontFamily: FONT_MONO, fontSize: 21, fontWeight: 700, color: '#BFDBFE' }}>JUST NOW ✓✓</span>
          </div>

          <FitText text={revealText} baseSize={52} minSize={30} maxLines={4} align="left" color="#FFFFFF" fontWeight={900} lineHeight={1.32} />

          {subDetail && subDetail !== setupText && (
            <div
              style={{
                marginTop: 24,
                padding: '18px 24px',
                borderRadius: 22,
                background: 'rgba(15,23,42,0.28)',
                border: '1.5px solid rgba(147,197,253,0.35)',
              }}
            >
              <FitText text={subDetail} baseSize={29} minSize={22} maxLines={2} align="left" color="#E0F2FE" fontWeight={600} />
            </div>
          )}
        </div>
      </div>

      {/* Animated SVG reaction badges strip cleanly inside y <= 1340 */}
      <div
        style={{
          position: 'absolute',
          top: 1244,
          left: 60,
          right: 60,
          display: 'flex',
          justifyContent: 'center',
          gap: 22,
          opacity: badgePop,
          transform: `translateY(${(1 - badgePop) * 28}px)`,
        }}
      >
        {[
          { label: 'ถูกใจ', count: 128 + Math.floor(localFrame * 1.6), color: '#EF4444', type: 'heart' },
          { label: 'แชร์ต่อ', count: 64 + Math.floor(localFrame * 0.8), color: '#2563EB', type: 'bolt' },
          { label: 'ปักหมุด', count: 42 + Math.floor(localFrame * 0.5), color: '#F59E0B', type: 'star' },
        ].map((r, idx) => (
          <div
            key={r.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 26px',
              borderRadius: 99,
              background: '#FFFFFF',
              border: '2px solid #CBD5E1',
              boxShadow: '0 14px 26px rgba(15,23,42,0.10)',
              transform: `translateY(${Math.sin(localFrame * 0.12 + idx * 1.5) * 5}px)`,
            }}
          >
            <svg width={30} height={30} viewBox="0 0 32 32">
              {r.type === 'heart' && (
                <path d="M16 28 C16 28 4 20 4 11.5 C4 7.4 7.3 4.5 11 4.5 C13.4 4.5 15.1 5.8 16 7.4 C16.9 5.8 18.6 4.5 21 4.5 C24.7 4.5 28 7.4 28 11.5 C28 20 16 28 16 28 Z" fill={r.color} />
              )}
              {r.type === 'bolt' && <polygon points="18,2 6,18 15,18 13,30 26,14 17,14" fill={r.color} />}
              {r.type === 'star' && <polygon points="16,2 20,11 30,12 22.5,19 24.5,29 16,24 7.5,29 9.5,19 2,12 12,11" fill={r.color} />}
            </svg>
            <span style={{ fontFamily: FONT_THAI, fontSize: 23, fontWeight: 800, color: '#1E293B' }}>{r.label}</span>
            <span style={{ fontFamily: FONT_MONO, fontSize: 23, fontWeight: 900, color: r.color }}>{r.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/** look-15 / shot 3: screenshot-zoom — smartphone zooming in on 1 highlighted message */
const Look15ScreenshotZoom: React.FC<StyleShotArgs> = ({ scene, localFrame, durationFrames, tokens }) => {
  const txt = sceneTexts(scene);
  const highlightMsg = scene.stat
    ? `${scene.stat.value} ${scene.stat.unit || ''} — ${txt.title}`
    : txt.title || txt.bullets[0] || 'ข้อความสำคัญที่ต้องสังเกต';
  const contextTop = txt.bullets[0] && txt.bullets[0] !== txt.title ? txt.bullets[0] : 'ส่งข้อมูลชุดล่าสุดมาให้ตรวจแล้วนะ';
  const contextBottom = scene.stat?.label || txt.subtitle || txt.bullets[1] || 'ตัวเลขนี้ยืนยันได้ชัดเจนเลย';

  const zoomP = easeOutCubic(clamp01(localFrame / Math.max(1, durationFrames * 0.52)));
  const continuousDrift = interpolate(localFrame, [0, Math.max(1, durationFrames)], [0, 0.04]);
  const phoneScale = 0.88 + zoomP * 0.12 + continuousDrift;
  const phoneY = interpolate(zoomP, [0, 1], [18, -8]);
  const hlSweep = easeOutCubic(clamp01((localFrame - 14) / 22));
  const calloutIn = appear(localFrame, 22, 14);
  const bracketPulse = 1 + Math.sin(localFrame * 0.14) * 0.025;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <Look15GridBackdrop localFrame={localFrame} tokens={tokens} dark />

      {/* Top focus HUD */}
      <div
        style={{
          position: 'absolute',
          top: 68,
          left: 60,
          right: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 4,
        }}
      >
        <div
          style={{
            padding: '9px 22px',
            borderRadius: 99,
            background: 'rgba(96,165,250,0.18)',
            border: '2px solid #60A5FA',
            fontFamily: FONT_MONO,
            fontSize: 21,
            fontWeight: 800,
            color: '#93C5FD',
            letterSpacing: 1.5,
          }}
        >
          ● SCREENSHOT ZOOM · {Math.round(phoneScale * 100)}%
        </div>
        <span style={{ fontFamily: FONT_THAI, fontSize: 23, fontWeight: 700, color: '#CBD5E1' }}>
          {shortText(txt.badge || 'HIGHLIGHT', 24)}
        </span>
      </div>

      {/* Smartphone Mockup sized cleanly to leave space for bottom callout (< y 1350) */}
      <div
        style={{
          position: 'absolute',
          top: 146,
          left: 110,
          width: 860,
          height: 946,
          transform: `translateY(${phoneY.toFixed(1)}px) scale(${phoneScale.toFixed(4)})`,
          transformOrigin: '50% 45%',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 62,
            background: 'linear-gradient(155deg, #334155 0%, #0F172A 45%, #1E293B 100%)',
            padding: 16,
            boxShadow: '0 36px 80px rgba(0,0,0,0.55), 0 0 0 2px rgba(148,163,184,0.35)',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: 48,
              background: '#F1F5F9',
              overflow: 'hidden',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Status Bar + Dynamic Island */}
            <div
              style={{
                height: 70,
                background: '#FFFFFF',
                borderBottom: '2px solid #E2E8F0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 34px',
                flexShrink: 0,
              }}
            >
              <span style={{ fontFamily: FONT_MONO, fontSize: 23, fontWeight: 800, color: '#0F172A' }}>9:41</span>
              <div style={{ width: 164, height: 32, borderRadius: 99, background: '#0F172A' }} />
              <svg width={74} height={24} viewBox="0 0 76 24">
                <rect x={2} y={14} width={7} height={8} rx={2} fill="#0F172A" />
                <rect x={12} y={10} width={7} height={12} rx={2} fill="#0F172A" />
                <rect x={22} y={6} width={7} height={16} rx={2} fill="#0F172A" />
                <rect x={38} y={5} width={32} height={16} rx={4} fill="none" stroke="#0F172A" strokeWidth={2.5} />
                <rect x={42} y={9} width={22} height={8} rx={2} fill="#22C55E" />
              </svg>
            </div>

            {/* Chat Thread inside Phone */}
            <div style={{ flex: 1, padding: '26px 32px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 20 }}>
              {/* Dimmed top message */}
              <div
                style={{
                  alignSelf: 'flex-start',
                  maxWidth: '78%',
                  background: '#FFFFFF',
                  borderRadius: '26px 26px 26px 8px',
                  padding: '18px 24px',
                  border: '2px solid #E2E8F0',
                  opacity: interpolate(zoomP, [0, 1], [0.85, 0.4]),
                }}
              >
                <FitText text={contextTop} baseSize={26} minSize={20} maxLines={2} align="left" color="#334155" fontWeight={700} />
              </div>

              {/* SPOTLIGHT HIGHLIGHTED MESSAGE */}
              <div
                style={{
                  position: 'relative',
                  alignSelf: 'stretch',
                  padding: '30px 34px',
                  borderRadius: 32,
                  background: '#FFFFFF',
                  border: '4px solid #2563EB',
                  boxShadow: '0 22px 48px rgba(37,99,235,0.34)',
                  transform: `scale(${(1 + zoomP * 0.03).toFixed(4)})`,
                  zIndex: 3,
                }}
              >
                <div style={{ position: 'relative', display: 'inline-block', marginBottom: 12, padding: '4px 16px' }}>
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: `${Math.round(hlSweep * 100)}%`,
                      background: '#FEF08A',
                      borderRadius: 10,
                    }}
                  />
                  <span style={{ position: 'relative', fontFamily: FONT_MONO, fontSize: 20, fontWeight: 900, color: '#1D4ED8', letterSpacing: 1.4 }}>
                    ★ HIGHLIGHTED MESSAGE
                  </span>
                </div>

                <FitText text={highlightMsg} baseSize={40} minSize={26} maxLines={4} align="left" color="#0F172A" fontWeight={900} lineHeight={1.34} />

                <svg
                  width="100%"
                  height="100%"
                  viewBox="0 0 760 320"
                  preserveAspectRatio="none"
                  style={{
                    position: 'absolute',
                    inset: -12,
                    width: 'calc(100% + 24px)',
                    height: 'calc(100% + 24px)',
                    pointerEvents: 'none',
                    transform: `scale(${bracketPulse.toFixed(4)})`,
                  }}
                >
                  <path d="M 38 6 L 6 6 L 6 38" fill="none" stroke="#F59E0B" strokeWidth={7} strokeLinecap="round" />
                  <path d="M 722 6 L 754 6 L 754 38" fill="none" stroke="#F59E0B" strokeWidth={7} strokeLinecap="round" />
                  <path d="M 38 314 L 6 314 L 6 282" fill="none" stroke="#F59E0B" strokeWidth={7} strokeLinecap="round" />
                  <path d="M 722 314 L 754 314 L 754 282" fill="none" stroke="#F59E0B" strokeWidth={7} strokeLinecap="round" />
                </svg>
              </div>

              {/* Dimmed outgoing reply */}
              <div
                style={{
                  alignSelf: 'flex-end',
                  maxWidth: '78%',
                  background: '#2563EB',
                  borderRadius: '26px 26px 8px 26px',
                  padding: '18px 24px',
                  opacity: interpolate(zoomP, [0, 1], [0.9, 0.5]),
                }}
              >
                <FitText text={scene.stat?.delta || 'บันทึกหลักฐานนี้ไว้เลย ✓'} baseSize={26} minSize={20} maxLines={2} align="left" color="#FFFFFF" fontWeight={700} />
              </div>

              {/* Phone bottom chat composer bar */}
              <div
                style={{
                  height: 64,
                  borderRadius: 32,
                  background: '#FFFFFF',
                  border: '2px solid #CBD5E1',
                  padding: '0 22px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ fontFamily: FONT_THAI, fontSize: 22, color: '#94A3B8', fontWeight: 600 }}>พิมพ์ข้อความตอบกลับ...</span>
                <div style={{ width: 42, height: 42, borderRadius: 99, background: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width={20} height={20} viewBox="0 0 24 24">
                    <path d="M 12 19 V 5 M 6 11 L 12 5 L 18 11" fill="none" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Floating Magnifier Takeaway Bar cleanly above SubtitleBar (y: 1188..1346) */}
      <div
        style={{
          position: 'absolute',
          top: 1188,
          left: 60,
          right: 60,
          height: 158,
          borderRadius: 30,
          background: 'rgba(15,23,42,0.94)',
          border: '2.5px solid #60A5FA',
          boxShadow: '0 22px 44px rgba(0,0,0,0.45)',
          padding: '20px 34px',
          display: 'flex',
          alignItems: 'center',
          gap: 22,
          opacity: calloutIn,
          transform: `translateY(${(1 - calloutIn) * 28}px)`,
        }}
      >
        <svg width={60} height={60} viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
          <circle cx={28} cy={28} r={18} fill="rgba(96,165,250,0.22)" stroke="#60A5FA" strokeWidth={5} />
          <line x1={41} y1={41} x2={56} y2={56} stroke="#F59E0B" strokeWidth={7} strokeLinecap="round" />
        </svg>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <FitText text={contextBottom} baseSize={30} minSize={22} maxLines={2} align="left" color="#F8FAFC" fontWeight={700} />
        </div>
      </div>
    </div>
  );
};

/** SVG geometric character avatar for group-chat */
const GroupAvatar: React.FC<{ bg: string; shirt: string; hair: string; size?: number }> = ({ bg, shirt, hair, size = 72 }) => (
  <svg width={size} height={size} viewBox="0 0 72 72" style={{ flexShrink: 0 }}>
    <circle cx={36} cy={36} r={35} fill={bg} stroke="#FFFFFF" strokeWidth={3} />
    <path d="M 14 64 C 16 48 26 44 36 44 C 46 44 56 48 58 64 Z" fill={shirt} />
    <circle cx={36} cy={29} r={13} fill="#FDE68A" />
    <path d="M 22 28 C 22 16 30 13 36 13 C 44 13 50 18 50 28 C 46 22 39 21 34 22 C 28 23 25 25 22 28 Z" fill={hair} />
    <circle cx={31.5} cy={30} r={2} fill="#1E293B" />
    <circle cx={40.5} cy={30} r={2} fill="#1E293B" />
    <path d="M 32 35 Q 36 38.5 40 35" fill="none" stroke="#92400E" strokeWidth={2} strokeLinecap="round" />
  </svg>
);

/** look-15 / shot 4: group-chat — multi-member room with SVG avatars, names & SVG reactions */
const Look15GroupChat: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const txt = sceneTexts(scene);
  const members = [
    { name: 'โฮสต์หลัก', role: 'HOST', bg: '#DBEAFE', shirt: '#2563EB', hair: '#1E293B', accent: '#2563EB' },
    { name: 'นักวิเคราะห์', role: 'DATA', bg: '#DCFCE7', shirt: '#16A34A', hair: '#7C2D12', accent: '#16A34A' },
    { name: 'โปรดิวเซอร์', role: 'LEAD', bg: '#FEF3C7', shirt: '#D97706', hair: '#312E81', accent: '#D97706' },
    { name: 'สรุปทีม', role: 'VIP', bg: '#FCE7F3', shirt: '#DB2777', hair: '#0F172A', accent: '#DB2777' },
  ];

  const lines: string[] = [txt.title];
  for (const b of txt.bullets) if (b && !lines.includes(b)) lines.push(b);
  if (txt.subtitle && lines.length < 4) lines.push(txt.subtitle);
  if (scene.quote?.text && lines.length < 4) lines.push(scene.quote.text);
  while (lines.length < 3) {
    lines.push(lines.length === 1 ? 'เห็นด้วยเลย จุดนี้สำคัญมาก' : 'แชร์ต่อให้ครบทีมได้เลย!');
  }

  const shown = lines.slice(0, 4);
  const pulse = 0.7 + Math.sin(localFrame * 0.14) * 0.3;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <Look15GridBackdrop localFrame={localFrame} tokens={tokens} />

      {/* Group Header Bar */}
      <div
        style={{
          position: 'absolute',
          top: 76,
          left: 52,
          right: 52,
          height: 118,
          borderRadius: 32,
          background: '#FFFFFF',
          border: '2.5px solid #CBD5E1',
          boxShadow: '0 18px 34px rgba(15,23,42,0.10)',
          padding: '0 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {members.map((m, idx) => (
              <div key={m.name} style={{ marginLeft: idx === 0 ? 0 : -18, zIndex: 4 - idx }}>
                <GroupAvatar bg={m.bg} shirt={m.shirt} hair={m.hair} size={58} />
              </div>
            ))}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <FitText
              text={shortText(txt.badge || 'ห้องคุยทีมงาน · GROUP CHAT', 30)}
              baseSize={29}
              minSize={22}
              maxLines={1}
              align="left"
              color="#0F172A"
              fontWeight={900}
            />
            <div style={{ fontFamily: FONT_THAI, fontSize: 20, fontWeight: 700, color: '#16A34A', marginTop: 2 }}>
              ● 4 คนกำลังออนไลน์และตอบกลับ
            </div>
          </div>
        </div>
      </div>

      {/* Group Messages cleanly inside y: 220..1345 */}
      <div
        style={{
          position: 'absolute',
          top: 220,
          left: 52,
          right: 52,
          height: 1125,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        {shown.map((msg, idx) => {
          const member = members[idx % members.length];
          const sp = spring({
            frame: Math.max(0, localFrame - (4 + idx * 8)),
            fps,
            config: { damping: 14, stiffness: 150 },
          });
          const isOwn = idx === shown.length - 1;
          const reactBounce = 1 + Math.sin(localFrame * 0.14 + idx * 1.2) * 0.08;
          const reactCount = 12 + idx * 7 + Math.floor(localFrame * 0.25);

          return (
            <div
              key={idx}
              style={{
                display: 'flex',
                flexDirection: isOwn ? 'row-reverse' : 'row',
                alignItems: 'flex-start',
                gap: 16,
                opacity: clamp01(sp * 1.35),
                transform: `translateX(${(1 - sp) * (isOwn ? 55 : -55)}px)`,
              }}
            >
              <div style={{ marginTop: 4, transform: `scale(${0.92 + pulse * 0.05})` }}>
                <GroupAvatar bg={member.bg} shirt={member.shirt} hair={member.hair} size={68} />
              </div>

              <div style={{ flex: 1, maxWidth: 820, position: 'relative' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: isOwn ? 'flex-end' : 'flex-start',
                    gap: 10,
                    marginBottom: 6,
                    padding: '0 8px',
                  }}
                >
                  <span style={{ fontFamily: FONT_THAI, fontSize: 22, fontWeight: 800, color: member.accent }}>{member.name}</span>
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 16,
                      fontWeight: 800,
                      color: '#FFFFFF',
                      background: member.accent,
                      padding: '2px 10px',
                      borderRadius: 99,
                    }}
                  >
                    {member.role}
                  </span>
                </div>

                <div
                  style={{
                    background: isOwn ? 'linear-gradient(135deg, #1D4ED8, #2563EB)' : '#FFFFFF',
                    border: isOwn ? '2.5px solid #93C5FD' : `2.5px solid ${member.bg}`,
                    borderLeft: isOwn ? undefined : `7px solid ${member.accent}`,
                    borderRadius: isOwn ? '28px 10px 28px 28px' : '10px 28px 28px 28px',
                    padding: '18px 26px 24px',
                    boxShadow: isOwn ? '0 18px 34px rgba(37,99,235,0.25)' : '0 14px 28px rgba(15,23,42,0.10)',
                  }}
                >
                  <FitText
                    text={msg}
                    baseSize={isOwn ? 32 : 29}
                    minSize={22}
                    maxLines={3}
                    align="left"
                    color={isOwn ? '#FFFFFF' : '#0F172A'}
                    fontWeight={700}
                  />
                </div>

                {/* SVG Reaction Pill */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: -14,
                    right: isOwn ? undefined : 20,
                    left: isOwn ? 20 : undefined,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 14px',
                    borderRadius: 99,
                    background: '#FFFFFF',
                    border: '2px solid #CBD5E1',
                    boxShadow: '0 8px 16px rgba(15,23,42,0.12)',
                    transform: `scale(${reactBounce.toFixed(3)})`,
                  }}
                >
                  <svg width={20} height={20} viewBox="0 0 24 24">
                    {idx % 3 === 0 ? (
                      <path d="M12 21 C12 21 3 15 3 8.8 C3 5.7 5.5 3.5 8.3 3.5 C10.1 3.5 11.4 4.5 12 5.7 C12.6 4.5 13.9 3.5 15.7 3.5 C18.5 3.5 21 5.7 21 8.8 C21 15 12 21 12 21 Z" fill="#EF4444" />
                    ) : idx % 3 === 1 ? (
                      <polygon points="12,2 15,9 22,9.5 16.5,14 18.2,21 12,17.2 5.8,21 7.5,14 2,9.5 9,9" fill="#F59E0B" />
                    ) : (
                      <path d="M7 22 H4 V10 H7 Z M10 10 L14 3 C15.2 3 16 4 16 5.5 L15 9 H20 C21.2 9 22 10 21.8 11.2 L20.4 19.2 C20.1 20.8 18.9 22 17.3 22 H10 Z" fill="#2563EB" />
                    )}
                  </svg>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 900, color: '#1E293B' }}>{reactCount}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-15 / shot 5: voice-note — animated waveform player + ticking timer + live transcript */
const Look15VoiceNote: React.FC<StyleShotArgs> = ({ scene, localFrame, durationFrames, fps, tokens }) => {
  const txt = sceneTexts(scene);
  const progress = clamp01(localFrame / Math.max(1, durationFrames));
  const totalSec = Math.max(8, Math.round(durationFrames / Math.max(1, fps)) + 9);
  const curSec = Math.min(totalSec, Math.floor(progress * totalSec));
  const formatTime = (s: number) => `0:${String(s).padStart(2, '0')}`;

  const playerSpring = spring({
    frame: localFrame,
    fps,
    config: { damping: 14, stiffness: 140 },
  });
  const cardIn = appear(localFrame, 10, 16);
  const ringPulse = (localFrame % 40) / 40;
  const barCount = 34;

  const transcriptMain = scene.quote?.text || txt.title || 'ข้อความเสียงสำคัญ';
  const transcriptSub = scene.quote?.author
    ? `— ${scene.quote.author}${scene.quote.role ? ` · ${scene.quote.role}` : ''}`
    : txt.subtitle || txt.bullets[0] || '';

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <Look15GridBackdrop localFrame={localFrame} tokens={tokens} />

      {/* Top Audio Sender Ring + Identity */}
      <div
        style={{
          position: 'absolute',
          top: 90,
          left: 60,
          right: 60,
          display: 'flex',
          alignItems: 'center',
          gap: 26,
          opacity: appear(localFrame, 0, 12),
        }}
      >
        <div style={{ position: 'relative', width: 126, height: 126, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width={126} height={126} viewBox="0 0 132 132" style={{ position: 'absolute', inset: 0 }}>
            <circle cx={66} cy={66} r={44 + ringPulse * 20} fill="none" stroke="#2563EB" strokeWidth={3} opacity={1 - ringPulse} />
            <circle cx={66} cy={66} r={48} fill="#DBEAFE" stroke="#2563EB" strokeWidth={4} />
            <rect x={56} y={40} width={20} height={32} rx={10} fill="#1D4ED8" />
            <path d="M 46 64 C 46 76 55 84 66 84 C 77 84 86 76 86 64" fill="none" stroke="#1D4ED8" strokeWidth={5} strokeLinecap="round" />
            <line x1={66} y1={84} x2={66} y2={96} stroke="#1D4ED8" strokeWidth={5} strokeLinecap="round" />
            <line x1={54} y1={96} x2={78} y2={96} stroke="#1D4ED8" strokeWidth={5} strokeLinecap="round" />
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 21, fontWeight: 800, color: '#2563EB', letterSpacing: 2 }}>
            ● VOICE MESSAGE · HD AUDIO
          </div>
          <FitText
            text={shortText(txt.badge || 'ข้อความเสียงล่าสุด', 30)}
            baseSize={36}
            minSize={25}
            maxLines={1}
            align="left"
            color="#0F172A"
            fontWeight={900}
          />
        </div>
      </div>

      {/* Giant 3D Voice-Note Waveform Bubble */}
      <div
        style={{
          position: 'absolute',
          top: 260,
          left: 58,
          right: 58,
          height: 320,
          borderRadius: '46px 46px 16px 46px',
          background: 'linear-gradient(135deg, #1E3A8A 0%, #2563EB 58%, #3B82F6 100%)',
          border: '3.5px solid #93C5FD',
          boxShadow: '0 30px 60px rgba(29,78,216,0.34)',
          padding: '34px 40px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          transform: `scale(${0.86 + playerSpring * 0.14})`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
          <svg width={92} height={92} viewBox="0 0 96 96" style={{ flexShrink: 0 }}>
            <circle cx={48} cy={48} r={46} fill="#FFFFFF" />
            <rect x={34} y={30} width={10} height={36} rx={4} fill="#1D4ED8" />
            <rect x={52} y={30} width={10} height={36} rx={4} fill="#1D4ED8" />
          </svg>

          <svg width={740} height={148} viewBox="0 0 740 156" style={{ flex: 1 }}>
            {Array.from({ length: barCount }).map((_, i) => {
              const frac = i / (barCount - 1);
              const played = frac <= progress;
              const baseAmp = 0.35 + 0.55 * Math.abs(Math.sin(i * 0.65 + 0.8));
              const liveWave = 0.55 + 0.45 * Math.sin(localFrame * 0.28 + i * 0.72);
              const h = Math.max(18, Math.round(138 * baseAmp * liveWave));
              const x = i * (740 / barCount) + 4;
              return (
                <rect
                  key={i}
                  x={x}
                  y={(156 - h) / 2}
                  width={12}
                  height={h}
                  rx={6}
                  fill={played ? '#FFFFFF' : 'rgba(191,219,254,0.42)'}
                />
              );
            })}
            <line
              x1={Math.round(progress * 730)}
              y1={6}
              x2={Math.round(progress * 730)}
              y2={150}
              stroke="#FDE047"
              strokeWidth={4}
              strokeLinecap="round"
            />
          </svg>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 29, fontWeight: 900, color: '#FFFFFF' }}>
            {formatTime(curSec)} <span style={{ color: '#93C5FD', fontWeight: 700 }}>/ {formatTime(totalSec)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span
              style={{
                padding: '6px 18px',
                borderRadius: 99,
                background: 'rgba(255,255,255,0.2)',
                fontFamily: FONT_MONO,
                fontSize: 21,
                fontWeight: 800,
                color: '#FFFFFF',
              }}
            >
              1.0×
            </span>
            <span style={{ fontFamily: FONT_MONO, fontSize: 21, fontWeight: 700, color: '#BFDBFE' }}>LIVE WAVE</span>
          </div>
        </div>
      </div>

      {/* Auto-Transcript Speech Card cleanly inside y: 632..1320 */}
      <div
        style={{
          position: 'absolute',
          top: 632,
          left: 58,
          right: 58,
          maxHeight: 690,
          borderRadius: 40,
          background: '#FFFFFF',
          border: '3px solid #CBD5E1',
          boxShadow: '0 24px 48px rgba(15,23,42,0.12)',
          padding: '38px 42px',
          opacity: cardIn,
          transform: `translateY(${(1 - cardIn) * 32}px)`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 21, fontWeight: 800, color: '#2563EB', letterSpacing: 1.5 }}>
            AUTO TRANSCRIPT · ถอดเสียงสด
          </span>
          <div style={{ width: 120, height: 8, borderRadius: 99, background: '#E2E8F0', overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(progress * 100)}%`, height: '100%', background: '#2563EB' }} />
          </div>
        </div>

        <FitText
          text={`“${transcriptMain}”`}
          baseSize={44}
          minSize={28}
          maxLines={5}
          align="left"
          color="#0F172A"
          fontWeight={800}
          lineHeight={1.36}
        />

        {transcriptSub && (
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: '2px solid #E2E8F0' }}>
            <FitText text={transcriptSub} baseSize={28} minSize={21} maxLines={2} align="left" color="#475569" fontWeight={700} />
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// STYLE 2: look-24 — Ranking Bars (Editorial White/Charcoal + Vivid Orange #FF5A36)
// ============================================================================

const BAR_COLORS_24 = ['#FF5A36', '#7F93B5', '#9DB89E', '#8AA7B3', '#B4A7C5'];

const Look24EditorialBackdrop: React.FC<{ localFrame: number }> = ({ localFrame }) => {
  const drift = (localFrame * 0.7) % 120;
  return (
    <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <linearGradient id="l24-stage" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="65%" stopColor="#F4F6FA" />
          <stop offset="100%" stopColor="#E9EEF5" />
        </linearGradient>
      </defs>
      <rect width={STAGE_W} height={STAGE_H} fill="url(#l24-stage)" />
      {[120, 300, 480, 660, 840, 960].map((x) => (
        <line key={`x-${x}`} x1={x} y1={0} x2={x} y2={STAGE_H} stroke="#E2E8F0" strokeWidth={1.2} opacity={0.7} />
      ))}
      <line x1={0} y1={66} x2={STAGE_W} y2={66} stroke="#FF5A36" strokeWidth={6} />
      <rect x={820 + Math.sin(drift * 0.05) * 18} y={66} width={160} height={6} fill="#111418" />
    </svg>
  );
};

/** look-24 / shot 1: race-bars — animated racing horizontal bar chart driven by scene data */
const Look24RaceBars: React.FC<StyleShotArgs> = ({ scene, localFrame, durationFrames }) => {
  const txt = sceneTexts(scene);
  const items = extractRankedItems(scene, 5);
  const raceT = easeOutCubic(clamp01(localFrame / Math.max(1, durationFrames * 0.56)));
  const liveOsc = (i: number) => Math.sin(localFrame * 0.1 + i * 1.3) * 1.3;
  const headerIn = appear(localFrame, 0, 14);
  const yearOrTick = 2022 + Math.min(4, Math.floor((localFrame / Math.max(1, durationFrames)) * 5));

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <Look24EditorialBackdrop localFrame={localFrame} />

      {/* Editorial Header */}
      <div
        style={{
          position: 'absolute',
          top: 90,
          left: 58,
          right: 58,
          opacity: headerIn,
          transform: `translateY(${(1 - headerIn) * -18}px)`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span
            style={{
              padding: '5px 16px',
              borderRadius: 8,
              background: '#111418',
              color: '#FFFFFF',
              fontFamily: FONT_MONO,
              fontSize: 19,
              fontWeight: 800,
              letterSpacing: 1.5,
            }}
          >
            RANKING RACE · LIVE
          </span>
          <span style={{ fontFamily: FONT_MONO, fontSize: 22, fontWeight: 900, color: '#FF5A36' }}>
            {shortText(txt.badge || `CYCLE ${yearOrTick}`, 24)}
          </span>
        </div>
        <FitText text={txt.title || 'อันดับข้อมูลสำคัญ'} baseSize={46} minSize={28} maxLines={2} align="left" color="#111418" fontWeight={900} />
      </div>

      {/* Percentage axis ticks */}
      <div
        style={{
          position: 'absolute',
          top: 294,
          left: 58,
          right: 58,
          height: 32,
          display: 'flex',
          justifyContent: 'space-between',
          borderBottom: '2px solid #CBD5E1',
        }}
      >
        {[0, 25, 50, 75, 100].map((pct) => (
          <span key={pct} style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 800, color: '#94A3B8' }}>
            {pct}%
          </span>
        ))}
      </div>

      {/* 5 Racing Horizontal Bars cleanly inside y: 344..1195 */}
      <div
        style={{
          position: 'absolute',
          top: 344,
          left: 58,
          right: 58,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        {items.map((item, i) => {
          const itemReveal = stagger(i, localFrame, 5, 2, 16);
          const startPct = Math.max(18, item.value * (i === 0 ? 0.34 : 0.56));
          const curPct = clamp01((startPct + (item.value - startPct) * raceT + liveOsc(i)) / 100) * 100;
          const color = BAR_COLORS_24[i % BAR_COLORS_24.length];
          const isHero = i === 0;

          return (
            <div
              key={i}
              style={{
                opacity: itemReveal,
                transform: `translateX(${(1 - itemReveal) * -28}px)`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      width: 44,
                      height: 34,
                      borderRadius: 10,
                      background: isHero ? '#FF5A36' : '#E2E8F0',
                      color: isHero ? '#FFFFFF' : '#334155',
                      fontFamily: FONT_MONO,
                      fontSize: 21,
                      fontWeight: 900,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    #{i + 1}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <FitText
                      text={item.label}
                      baseSize={isHero ? 30 : 26}
                      minSize={20}
                      maxLines={1}
                      align="left"
                      color={isHero ? '#111418' : '#334155'}
                      fontWeight={isHero ? 900 : 700}
                    />
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: isHero ? 34 : 28,
                    fontWeight: 900,
                    color: isHero ? '#FF5A36' : '#334155',
                    flexShrink: 0,
                  }}
                >
                  {raceT > 0.85 ? item.display : `${curPct.toFixed(0)}%`}
                </span>
              </div>

              <div
                style={{
                  width: '100%',
                  height: isHero ? 68 : 52,
                  borderRadius: 13,
                  background: '#E2E8F0',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    width: `${Math.max(12, curPct).toFixed(1)}%`,
                    height: '100%',
                    borderRadius: '0 13px 13px 0',
                    background: isHero ? 'linear-gradient(90deg, #FF5A36 0%, #FF7B54 100%)' : color,
                    position: 'relative',
                    boxShadow: isHero ? '0 8px 22px rgba(255,90,54,0.34)' : undefined,
                  }}
                >
                  {isHero && (
                    <div
                      style={{
                        position: 'absolute',
                        right: 12,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        padding: '4px 14px',
                        borderRadius: 8,
                        background: 'rgba(255,255,255,0.28)',
                        fontFamily: FONT_MONO,
                        fontSize: 19,
                        fontWeight: 900,
                        color: '#FFFFFF',
                      }}
                    >
                      LEADER
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Editorial Footnote + Watermark (y: 1218..1340) */}
      <div
        style={{
          position: 'absolute',
          top: 1218,
          left: 58,
          right: 58,
          paddingTop: 20,
          borderTop: '2.5px solid #CBD5E1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 22,
        }}
      >
        <div style={{ flex: 1 }}>
          <FitText
            text={txt.subtitle || scene.stat?.delta || 'อันดับ #1 ทิ้งห่างกลุ่มคู่แข่งอย่างชัดเจน'}
            baseSize={27}
            minSize={20}
            maxLines={2}
            align="left"
            color="#334155"
            fontWeight={700}
          />
        </div>
        <div style={{ fontFamily: FONT_MONO, fontSize: 88, fontWeight: 900, color: '#CBD5E1', lineHeight: 0.9, letterSpacing: -4 }}>
          {yearOrTick}
        </div>
      </div>
    </div>
  );
};

/** look-24 / shot 2: podium — 3D rising 1-2-3 award podium with SVG medals & sunburst */
const Look24Podium: React.FC<StyleShotArgs> = ({ scene, localFrame, fps }) => {
  const txt = sceneTexts(scene);
  const top3 = extractRankedItems(scene, 3);
  const order = [
    { rank: 2, item: top3[1], height: 325, color: '#7F93B5', medal: '#CBD5E1', medalRim: '#64748B', delay: 8 },
    { rank: 1, item: top3[0], height: 450, color: '#FF5A36', medal: '#FACC15', medalRim: '#CA8A04', delay: 14 },
    { rank: 3, item: top3[2], height: 245, color: '#9DB89E', medal: '#D97706', medalRim: '#92400E', delay: 2 },
  ];

  const rayAngle = localFrame * 0.8;
  const float1 = Math.sin(localFrame * 0.12) * 7;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <Look24EditorialBackdrop localFrame={localFrame} />

      {/* Rotating sunburst rays behind #1 crown */}
      <svg width={STAGE_W} height={660} viewBox="0 0 1080 660" style={{ position: 'absolute', top: 195, left: 0, pointerEvents: 'none' }}>
        <g transform={`translate(540, 330) rotate(${rayAngle.toFixed(1)})`} opacity={0.22}>
          {Array.from({ length: 18 }).map((_, i) => (
            <polygon key={i} points="0,0 -18,-320 18,-320" fill="#FF5A36" transform={`rotate(${i * 20})`} />
          ))}
        </g>
        {[120, 260, 410, 680, 820, 950].map((cx, i) => {
          const cy = ((localFrame * (1.8 + (i % 3) * 0.6) + i * 115) % 580) + 40;
          return (
            <rect
              key={cx}
              x={cx}
              y={cy}
              width={14}
              height={14}
              rx={3}
              fill={i % 2 === 0 ? '#FF5A36' : '#FACC15'}
              opacity={0.65}
              transform={`rotate(${localFrame * 3 + i * 40} ${cx + 7} ${cy + 7})`}
            />
          );
        })}
      </svg>

      {/* Header */}
      <div style={{ position: 'absolute', top: 88, left: 58, right: 58, textAlign: 'center' }}>
        <div
          style={{
            display: 'inline-block',
            padding: '7px 22px',
            borderRadius: 99,
            background: '#111418',
            color: '#FFFFFF',
            fontFamily: FONT_MONO,
            fontSize: 19,
            fontWeight: 800,
            letterSpacing: 2,
            marginBottom: 12,
          }}
        >
          TOP 3 PODIUM · {shortText(txt.badge || 'RANKING', 22)}
        </div>
        <FitText text={txt.title || '3 อันดับโดดเด่นที่สุด'} baseSize={46} minSize={28} maxLines={2} align="center" color="#111418" fontWeight={900} />
      </div>

      {/* 3 Podium Columns anchored cleanly at y = 1340 (well above SubtitleBar!) */}
      <div
        style={{
          position: 'absolute',
          left: 52,
          right: 52,
          top: 300,
          height: 1040,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 22,
        }}
      >
        {order.map((slot) => {
          const sp = spring({
            frame: Math.max(0, localFrame - slot.delay),
            fps,
            config: { damping: 14, stiffness: 125 },
          });
          const curH = Math.max(40, slot.height * sp);
          const isFirst = slot.rank === 1;

          return (
            <div
              key={slot.rank}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-end',
              }}
            >
              {/* Floating Medal + Label above pillar */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  marginBottom: 18,
                  opacity: clamp01(sp * 1.4),
                  transform: `translateY(${(1 - sp) * 36 + (isFirst ? float1 : 0)}px)`,
                }}
              >
                <svg width={isFirst ? 108 : 88} height={isFirst ? 108 : 88} viewBox="0 0 100 100">
                  <polygon points="32,58 22,94 40,86 48,62" fill={slot.color} />
                  <polygon points="68,58 78,94 60,86 52,62" fill={slot.color} />
                  <circle cx={50} cy={44} r={34} fill={slot.medal} stroke={slot.medalRim} strokeWidth={5} />
                  <circle cx={50} cy={44} r={25} fill="none" stroke="#FFFFFF" strokeWidth={2.5} opacity={0.7} />
                  <text x={50} y={55} textAnchor="middle" fill="#111418" fontSize={32} fontFamily={FONT_MONO} fontWeight={900}>
                    {slot.rank}
                  </text>
                </svg>

                <div
                  style={{
                    marginTop: 8,
                    padding: '12px 14px',
                    borderRadius: 18,
                    background: '#FFFFFF',
                    border: isFirst ? '3px solid #FF5A36' : '2px solid #CBD5E1',
                    boxShadow: isFirst ? '0 14px 30px rgba(255,90,54,0.22)' : '0 10px 20px rgba(15,23,42,0.08)',
                    width: '100%',
                    minHeight: 102,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                  }}
                >
                  <FitText
                    text={slot.item.label}
                    baseSize={isFirst ? 26 : 23}
                    minSize={18}
                    maxLines={3}
                    align="center"
                    color="#111418"
                    fontWeight={800}
                  />
                </div>
              </div>

              {/* Rising Pillar Block */}
              <div
                style={{
                  width: '100%',
                  height: curH,
                  borderRadius: '26px 26px 8px 8px',
                  background: isFirst
                    ? 'linear-gradient(180deg, #FF5A36 0%, #E03E1A 100%)'
                    : `linear-gradient(180deg, ${slot.color} 0%, #334155 140%)`,
                  boxShadow: isFirst ? '0 22px 44px rgba(255,90,54,0.34)' : '0 14px 26px rgba(15,23,42,0.14)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '24px 14px',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 12, background: 'rgba(255,255,255,0.28)' }} />
                <span style={{ fontFamily: FONT_MONO, fontSize: isFirst ? 76 : 58, fontWeight: 900, color: '#FFFFFF', lineHeight: 1 }}>
                  #{slot.rank}
                </span>
                <div
                  style={{
                    padding: '7px 18px',
                    borderRadius: 99,
                    background: 'rgba(17,20,24,0.24)',
                    fontFamily: FONT_MONO,
                    fontSize: isFirst ? 28 : 23,
                    fontWeight: 900,
                    color: '#FFFFFF',
                  }}
                >
                  {slot.item.display}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Floor baseline strictly at y = 1340 */}
      <div style={{ position: 'absolute', top: 1340, left: 48, right: 48, height: 8, borderRadius: 4, background: '#111418' }} />
    </div>
  );
};

/** look-24 / shot 3: top-list-scroll — #5 -> #1 rising countdown where #1 bursts with radial light */
const Look24TopListScroll: React.FC<StyleShotArgs> = ({ scene, localFrame, fps }) => {
  const txt = sceneTexts(scene);
  const items = extractRankedItems(scene, 5);
  const heroPop = spring({
    frame: Math.max(0, localFrame - 18),
    fps,
    config: { damping: 12, stiffness: 140 },
  });
  const burstRot = localFrame * 1.1;
  const glowPulse = 0.7 + Math.sin(localFrame * 0.16) * 0.3;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <Look24EditorialBackdrop localFrame={localFrame} />

      {/* Top Header */}
      <div style={{ position: 'absolute', top: 86, left: 56, right: 56 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 21, fontWeight: 900, color: '#FF5A36', letterSpacing: 1.5 }}>
            COUNTDOWN · #5 → #1
          </span>
          <span style={{ fontFamily: FONT_MONO, fontSize: 19, fontWeight: 800, color: '#64748B' }}>
            {shortText(txt.badge || 'TOP LIST', 22)}
          </span>
        </div>
        <FitText text={txt.title || 'จัดอันดับ 5 ประเด็นสำคัญ'} baseSize={44} minSize={27} maxLines={2} align="left" color="#111418" fontWeight={900} />
      </div>

      {/* #1 Radiant Light-Burst Aura */}
      <svg
        width={STAGE_W}
        height={380}
        viewBox="0 0 1080 380"
        style={{ position: 'absolute', top: 214, left: 0, pointerEvents: 'none', opacity: clamp01(heroPop) * 0.7 }}
      >
        <g transform={`translate(540, 190) rotate(${burstRot.toFixed(1)})`}>
          {Array.from({ length: 14 }).map((_, i) => (
            <polygon key={i} points="0,0 -14,-195 14,-195" fill={i % 2 === 0 ? '#FF5A36' : '#FACC15'} opacity={0.28} transform={`rotate(${i * (360 / 14)})`} />
          ))}
        </g>
      </svg>

      {/* #1 Hero Spotlight Card (y: 260..514) */}
      <div
        style={{
          position: 'absolute',
          top: 260,
          left: 56,
          right: 56,
          height: 254,
          borderRadius: 34,
          background: 'linear-gradient(135deg, #111418 0%, #1E293B 65%, #2B1713 100%)',
          border: '4px solid #FF5A36',
          boxShadow: `0 24px 54px rgba(255,90,54,${(0.28 + glowPulse * 0.18).toFixed(2)})`,
          padding: '26px 34px',
          display: 'flex',
          alignItems: 'center',
          gap: 26,
          opacity: clamp01(heroPop * 1.4),
          transform: `scale(${0.82 + heroPop * 0.18}) translateY(${(1 - heroPop) * 44}px)`,
        }}
      >
        <div
          style={{
            width: 112,
            height: 112,
            borderRadius: 26,
            background: '#FF5A36',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 12px 24px rgba(255,90,54,0.45)',
          }}
        >
          <svg width={40} height={30} viewBox="0 0 44 32">
            <polygon points="4,28 8,8 17,18 22,4 27,18 36,8 40,28" fill="#FACC15" />
          </svg>
          <span style={{ fontFamily: FONT_MONO, fontSize: 40, fontWeight: 900, color: '#FFFFFF', lineHeight: 1 }}>#1</span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 19, fontWeight: 800, color: '#FDBA74', letterSpacing: 2, marginBottom: 6 }}>
            ★ TOP RANKED WINNER · {items[0].display}
          </div>
          <FitText text={items[0].label} baseSize={36} minSize={24} maxLines={3} align="left" color="#FFFFFF" fontWeight={900} />
        </div>
      </div>

      {/* Rows #2 -> #5 rising cleanly inside y: 544..1326 */}
      <div
        style={{
          position: 'absolute',
          top: 544,
          left: 56,
          right: 56,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {items.slice(1).map((item, idx) => {
          const rank = idx + 2;
          const reverseOrder = 3 - idx;
          const rowIn = appear(localFrame, 2 + reverseOrder * 4, 14);
          const barW = easeOutCubic(clamp01((localFrame - (6 + reverseOrder * 4)) / 24)) * item.value;
          const accent = BAR_COLORS_24[(idx + 1) % BAR_COLORS_24.length];

          return (
            <div
              key={rank}
              style={{
                height: 178,
                borderRadius: 24,
                background: '#FFFFFF',
                border: '2px solid #CBD5E1',
                boxShadow: '0 12px 24px rgba(15,23,42,0.08)',
                padding: '18px 28px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                opacity: rowIn,
                transform: `translateY(${(1 - rowIn) * 56}px)`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 15,
                      background: accent,
                      color: '#FFFFFF',
                      fontFamily: FONT_MONO,
                      fontSize: 26,
                      fontWeight: 900,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    #{rank}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <FitText text={item.label} baseSize={29} minSize={21} maxLines={2} align="left" color="#111418" fontWeight={800} />
                  </div>
                </div>
                <span style={{ fontFamily: FONT_MONO, fontSize: 30, fontWeight: 900, color: '#334155', flexShrink: 0 }}>
                  {item.display}
                </span>
              </div>

              <div style={{ width: '100%', height: 16, borderRadius: 99, background: '#E2E8F0', overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(12, barW).toFixed(1)}%`, height: '100%', borderRadius: 99, background: accent }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-24 / shot 4: versus-gap — 2 architectural columns + dimension gap arrow with numeric delta */
const Look24VersusGap: React.FC<StyleShotArgs> = ({ scene, localFrame, fps }) => {
  const txt = sceneTexts(scene);
  const vs = extractVersusData(scene);

  const growA = easeOutCubic(clamp01((localFrame - 4) / 26));
  const growB = easeOutCubic(clamp01((localFrame - 10) / 30));
  const arrowPop = spring({
    frame: Math.max(0, localFrame - 20),
    fps,
    config: { damping: 14, stiffness: 150 },
  });

  const valA = Math.min(vs.leftScore, vs.rightScore);
  const valB = Math.max(vs.leftScore, vs.rightScore);
  const labelA = vs.winner === 'right' ? vs.leftTitle : vs.rightTitle;
  const labelB = vs.winner === 'right' ? vs.rightTitle : vs.leftTitle;

  const svgTop = 250;
  const localBaseY = 820; // absolute y = 1070
  const maxColH = 620;
  const hA = Math.round((valA / 100) * maxColH * growA);
  const hB = Math.round((valB / 100) * maxColH * growB);
  const topA = localBaseY - hA;
  const topB = localBaseY - hB;
  const gapDiff = Math.max(1, valB - valA);
  const gapText = txt.numbers[0] && scene.stat?.delta ? scene.stat.delta : `+${gapDiff}% GAP`;
  const pulse = 1 + Math.sin(localFrame * 0.14) * 0.04;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <Look24EditorialBackdrop localFrame={localFrame} />

      {/* Header */}
      <div style={{ position: 'absolute', top: 88, left: 58, right: 58 }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 20, fontWeight: 900, color: '#FF5A36', letterSpacing: 2, marginBottom: 8 }}>
          HEAD-TO-HEAD GAP ANALYSIS · {shortText(txt.badge || 'COMPARE', 22)}
        </div>
        <FitText text={txt.title || 'เทียบความต่างให้เห็นชัดเจน'} baseSize={46} minSize={28} maxLines={2} align="left" color="#111418" fontWeight={900} />
      </div>

      {/* Precision SVG Column Chart + Gap Measurement Arrow */}
      <svg width={STAGE_W} height={860} viewBox="0 0 1080 860" style={{ position: 'absolute', top: svgTop, left: 0 }}>
        {[170, 332, 495, 658, localBaseY].map((y, idx) => (
          <line
            key={y}
            x1={68}
            y1={y}
            x2={1012}
            y2={y}
            stroke={idx === 4 ? '#111418' : '#CBD5E1'}
            strokeWidth={idx === 4 ? 4 : 1.5}
            strokeDasharray={idx === 4 ? undefined : '6 8'}
          />
        ))}

        {/* Left Column */}
        <rect x={128} y={topA} width={280} height={Math.max(10, hA)} rx={18} fill="#7F93B5" />
        <text x={268} y={topA - 18} textAnchor="middle" fill="#475569" fontSize={44} fontFamily={FONT_MONO} fontWeight={900}>
          {Math.round(valA * growA)}%
        </text>

        {/* Right Column (Winner Orange) */}
        <rect x={672} y={topB} width={280} height={Math.max(10, hB)} rx={18} fill="#FF5A36" />
        <rect x={672} y={topB} width={280} height={Math.min(18, Math.max(0, hB))} rx={9} fill="rgba(255,255,255,0.28)" />
        <text x={812} y={topB - 18} textAnchor="middle" fill="#FF5A36" fontSize={50} fontFamily={FONT_MONO} fontWeight={900}>
          {Math.round(valB * growB)}%
        </text>

        {/* Double-Headed Gap Measurement Arrow */}
        {arrowPop > 0.05 && (
          <g opacity={clamp01(arrowPop)}>
            <line x1={408} y1={topA} x2={568} y2={topA} stroke="#111418" strokeWidth={2.5} strokeDasharray="6 6" />
            <line x1={512} y1={topB} x2={672} y2={topB} stroke="#FF5A36" strokeWidth={2.5} strokeDasharray="6 6" />

            <line x1={540} y1={topB + 12} x2={540} y2={topA - 12} stroke="#111418" strokeWidth={6} strokeLinecap="round" />
            <polygon points={`540,${topB} 524,${topB + 26} 556,${topB + 26}`} fill="#FF5A36" />
            <polygon points={`540,${topA} 524,${topA - 26} 556,${topA - 26}`} fill="#111418" />

            <g transform={`translate(540, ${((topA + topB) / 2).toFixed(1)}) scale(${(pulse * clamp01(arrowPop)).toFixed(3)})`}>
              <rect x={-126} y={-38} width={252} height={76} rx={38} fill="#111418" stroke="#FF5A36" strokeWidth={4} />
              <text x={0} y={11} textAnchor="middle" fill="#FFFFFF" fontSize={29} fontFamily={FONT_MONO} fontWeight={900}>
                {shortText(gapText, 14)}
              </text>
            </g>
          </g>
        )}
      </svg>

      {/* Column Labels cleanly below baseline (y: 1090..1185) */}
      <div
        style={{
          position: 'absolute',
          top: 1090,
          left: 88,
          right: 88,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 60,
        }}
      >
        <div style={{ flex: 1, textAlign: 'center' }}>
          <FitText text={labelA} baseSize={32} minSize={22} maxLines={2} align="center" color="#475569" fontWeight={800} />
        </div>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <FitText text={labelB} baseSize={34} minSize={23} maxLines={2} align="center" color="#FF5A36" fontWeight={900} />
        </div>
      </div>

      {/* Bottom Takeaway Strip strictly above SubtitleBar (y: 1212..1334) */}
      <div
        style={{
          position: 'absolute',
          top: 1212,
          left: 58,
          right: 58,
          height: 122,
          borderRadius: 24,
          background: '#111418',
          padding: '18px 30px',
          display: 'flex',
          alignItems: 'center',
          gap: 20,
        }}
      >
        <div style={{ width: 10, height: 64, borderRadius: 6, background: '#FF5A36', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <FitText text={vs.verdictSummary} baseSize={29} minSize={21} maxLines={2} align="left" color="#FFFFFF" fontWeight={700} />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// STYLE 3: look-27 — Versus (Sports Broadcast Blue #3D7BFF vs Orange #FF7A30)
// ============================================================================

const Look27ArenaBackdrop: React.FC<{ localFrame: number; tokens: any }> = ({ localFrame, tokens }) => {
  const p = tokens?.palette || {};
  const bg = p.accent === '#0B0D12' ? '#0B0D12' : p.bg || '#0B0D12';
  const blue = p.accent2 || '#3D7BFF';
  const orange = '#FF7A30';
  const breathe = 0.28 + Math.sin(localFrame * 0.08) * 0.06;

  return (
    <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <radialGradient id="l27-blue" cx="15%" cy="38%" r="58%">
          <stop offset="0%" stopColor={blue} stopOpacity={breathe.toFixed(2)} />
          <stop offset="100%" stopColor={bg} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="l27-orange" cx="85%" cy="46%" r="58%">
          <stop offset="0%" stopColor={orange} stopOpacity={breathe.toFixed(2)} />
          <stop offset="100%" stopColor={bg} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={STAGE_W} height={STAGE_H} fill={bg} />
      <rect width={STAGE_W} height={STAGE_H} fill="url(#l27-blue)" />
      <rect width={STAGE_W} height={STAGE_H} fill="url(#l27-orange)" />
      {[180, 360, 540, 720, 900].map((x) => (
        <line key={x} x1={x} y1={0} x2={x} y2={STAGE_H} stroke="rgba(255,255,255,0.04)" strokeWidth={1.5} />
      ))}
    </svg>
  );
};

/** look-27 / shot 1: split-duel — diagonal split arena slamming together with lightning + VS crest */
const Look27SplitDuel: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const txt = sceneTexts(scene);
  const vs = extractVersusData(scene);
  const blue = tokens?.palette?.accent2 || '#3D7BFF';
  const orange = '#FF7A30';

  const slam = spring({
    frame: localFrame,
    fps,
    config: { damping: 12, stiffness: 170, mass: 0.85 },
  });
  const vsPop = spring({
    frame: Math.max(0, localFrame - 10),
    fps,
    config: { damping: 11, stiffness: 190 },
  });
  const pulse = 1 + Math.sin(localFrame * 0.14) * 0.05;
  const sparkShift = (localFrame * 5) % 260;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <Look27ArenaBackdrop localFrame={localFrame} tokens={tokens} />

      {/* Diagonal Opposing Colored Arena Halves Slamming In */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        <g transform={`translate(${((1 - slam) * -280).toFixed(1)}, ${((1 - slam) * -120).toFixed(1)})`}>
          <polygon points="0,0 1080,0 1080,540 0,880" fill={blue} opacity={0.24} />
          <line x1={0} y1={880} x2={1080} y2={540} stroke={blue} strokeWidth={8} />
        </g>

        <g transform={`translate(${((1 - slam) * 280).toFixed(1)}, ${((1 - slam) * 120).toFixed(1)})`}>
          <polygon points="0,920 1080,580 1080,1400 0,1400" fill={orange} opacity={0.24} />
          <line x1={0} y1={920} x2={1080} y2={580} stroke={orange} strokeWidth={8} />
        </g>

        {/* Electric Lightning Seam & Moving Sparks */}
        <polyline
          points="0,900 220,816 285,834 540,730 790,626 845,648 1080,560"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={4}
          opacity={0.75 + Math.sin(localFrame * 0.4) * 0.25}
        />
        {[0, 1, 2, 3, 4].map((i) => {
          const t = (i * 0.2 + sparkShift / 1080) % 1;
          const sx = t * 1080;
          const sy = 900 - t * 340 + Math.sin(localFrame * 0.3 + i) * 14;
          return <circle key={i} cx={sx} cy={sy} r={6 + (i % 2) * 3} fill={i % 2 === 0 ? '#93C5FD' : '#FDBA74'} opacity={0.9} />;
        })}

        {/* Central Pulsing Hexagonal VS Crest */}
        <g transform={`translate(540, 730) scale(${(vsPop * pulse).toFixed(3)})`}>
          <polygon points="0,-102 90,-50 90,50 0,102 -90,50 -90,-50" fill="#0B0D12" stroke="#FFFFFF" strokeWidth={6} />
          <polygon points="0,-82 72,-40 72,40 0,82 -72,40 -72,-40" fill="none" stroke={blue} strokeWidth={3} opacity={0.7} />
          <text x={0} y={24} textAnchor="middle" fill="#FFFFFF" fontSize={70} fontFamily={FONT_MONO} fontWeight={900}>
            VS
          </text>
        </g>
      </svg>

      {/* Top-Left Contender A (Blue) */}
      <div
        style={{
          position: 'absolute',
          top: 90,
          left: 56,
          right: 56,
          opacity: clamp01(slam * 1.4),
          transform: `translateX(${(1 - slam) * -120}px)`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div
            style={{
              padding: '7px 20px',
              borderRadius: 99,
              background: 'rgba(61,123,255,0.24)',
              border: `2px solid ${blue}`,
              fontFamily: FONT_MONO,
              fontSize: 20,
              fontWeight: 900,
              color: '#93C5FD',
              letterSpacing: 2,
            }}
          >
            CONTENDER A · BLUE
          </div>
          <span style={{ fontFamily: FONT_MONO, fontSize: 19, fontWeight: 800, color: '#94A3B8' }}>
            {shortText(txt.badge || 'TALE OF THE TAPE', 24)}
          </span>
        </div>
        <FitText text={vs.leftTitle} baseSize={52} minSize={30} maxLines={2} align="left" color="#FFFFFF" fontWeight={900} />

        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 840 }}>
          {vs.leftItems.slice(0, 2).map((item, idx) => (
            <div
              key={idx}
              style={{
                padding: '14px 22px',
                borderRadius: 16,
                background: 'rgba(11,13,18,0.68)',
                borderLeft: `6px solid ${blue}`,
              }}
            >
              <FitText text={item} baseSize={29} minSize={21} maxLines={2} align="left" color="#E2E8F0" fontWeight={700} />
            </div>
          ))}
        </div>
      </div>

      {/* Bottom-Right Contender B (Orange) cleanly inside y: 882..1345 */}
      <div
        style={{
          position: 'absolute',
          top: 882,
          left: 56,
          right: 56,
          opacity: clamp01(slam * 1.4),
          transform: `translateX(${(1 - slam) * 120}px)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
        }}
      >
        <div
          style={{
            display: 'inline-block',
            padding: '7px 20px',
            borderRadius: 99,
            background: 'rgba(255,122,48,0.24)',
            border: `2px solid ${orange}`,
            fontFamily: FONT_MONO,
            fontSize: 20,
            fontWeight: 900,
            color: '#FDBA74',
            letterSpacing: 2,
            marginBottom: 12,
          }}
        >
          CONTENDER B · ORANGE
        </div>
        <FitText text={vs.rightTitle} baseSize={52} minSize={30} maxLines={2} align="right" color="#FFFFFF" fontWeight={900} />

        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 14, width: '100%', maxWidth: 840 }}>
          {vs.rightItems.slice(0, 2).map((item, idx) => (
            <div
              key={idx}
              style={{
                padding: '14px 22px',
                borderRadius: 16,
                background: 'rgba(11,13,18,0.68)',
                borderRight: `6px solid ${orange}`,
              }}
            >
              <FitText text={item} baseSize={29} minSize={21} maxLines={2} align="right" color="#FFF7ED" fontWeight={700} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/** look-27 / shot 2: scoreboard — mechanical split-flap scoreboard counting points row by row */
const Look27Scoreboard: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const txt = sceneTexts(scene);
  const vs = extractVersusData(scene);
  const blue = tokens?.palette?.accent2 || '#3D7BFF';
  const orange = '#FF7A30';

  const criteria = [
    { label: vs.rightItems[0] || txt.bullets[0] || 'ความเร็วและประสิทธิภาพ', win: vs.winner },
    { label: vs.leftItems[0] || txt.bullets[1] || 'ความคุ้มค่าและต้นทุน', win: vs.winner === 'right' ? 'left' : 'right' },
    { label: vs.rightItems[1] || txt.bullets[2] || 'ความแม่นยำและคุณภาพ', win: vs.winner },
    { label: txt.subtitle || 'ผลลัพธ์โดยรวมที่วัดได้', win: vs.winner },
  ] as const;

  let bluePts = 0;
  let orangePts = 0;
  criteria.forEach((c, idx) => {
    if (localFrame >= 10 + idx * 10) {
      if (c.win === 'left') bluePts += 1;
      else orangePts += 1;
    }
  });

  const flipPulse = (pts: number) => {
    const f = localFrame % 10;
    return pts > 0 && f < 4 ? 1 + (4 - f) * 0.03 : 1;
  };

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <Look27ArenaBackdrop localFrame={localFrame} tokens={tokens} />

      {/* Header */}
      <div style={{ position: 'absolute', top: 76, left: 54, right: 54, textAlign: 'center' }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 20, fontWeight: 900, color: '#94A3B8', letterSpacing: 3, marginBottom: 8 }}>
          LIVE MATCH SCOREBOARD · {shortText(txt.badge || 'ROUNDS', 20)}
        </div>
        <FitText text={txt.title || 'นับคะแนนเปรียบเทียบทีละข้อ'} baseSize={44} minSize={27} maxLines={2} align="center" color="#FFFFFF" fontWeight={900} />
      </div>

      {/* Dual Flip-Digit Score Panel (y: 238..506) */}
      <div
        style={{
          position: 'absolute',
          top: 238,
          left: 54,
          right: 54,
          height: 268,
          borderRadius: 32,
          background: '#111622',
          border: '3px solid #2D3748',
          boxShadow: '0 24px 54px rgba(0,0,0,0.55)',
          padding: '20px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 20,
        }}
      >
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <FitText text={vs.leftTitle} baseSize={28} minSize={20} maxLines={1} align="center" color="#93C5FD" fontWeight={800} />
          <div
            style={{
              width: 176,
              height: 162,
              borderRadius: 22,
              background: 'linear-gradient(180deg, #1E293B 0%, #0F172A 100%)',
              border: `3.5px solid ${blue}`,
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: `scaleY(${flipPulse(bluePts).toFixed(3)})`,
            }}
          >
            <span style={{ fontFamily: FONT_MONO, fontSize: 106, fontWeight: 900, color: '#FFFFFF', lineHeight: 1 }}>{bluePts}</span>
            <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 4, background: '#0B0D12' }} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, opacity: 0.55 + Math.sin(localFrame * 0.25) * 0.45 }}>
          <div style={{ width: 16, height: 16, borderRadius: 99, background: '#FFFFFF' }} />
          <div style={{ width: 16, height: 16, borderRadius: 99, background: '#FFFFFF' }} />
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <FitText text={vs.rightTitle} baseSize={28} minSize={20} maxLines={1} align="center" color="#FDBA74" fontWeight={800} />
          <div
            style={{
              width: 176,
              height: 162,
              borderRadius: 22,
              background: 'linear-gradient(180deg, #1E293B 0%, #0F172A 100%)',
              border: `3.5px solid ${orange}`,
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: `scaleY(${flipPulse(orangePts).toFixed(3)})`,
            }}
          >
            <span style={{ fontFamily: FONT_MONO, fontSize: 106, fontWeight: 900, color: '#FFFFFF', lineHeight: 1 }}>{orangePts}</span>
            <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 4, background: '#0B0D12' }} />
          </div>
        </div>
      </div>

      {/* 4 Round-by-Round Scoring Rows cleanly inside y: 536..1320 */}
      <div
        style={{
          position: 'absolute',
          top: 536,
          left: 54,
          right: 54,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {criteria.map((row, idx) => {
          const rowSpring = spring({
            frame: Math.max(0, localFrame - (6 + idx * 10)),
            fps,
            config: { damping: 14, stiffness: 155 },
          });
          const leftWins = row.win === 'left';
          const winColor = leftWins ? blue : orange;
          const barProg = easeOutCubic(clamp01((localFrame - (8 + idx * 10)) / 18));

          return (
            <div
              key={idx}
              style={{
                height: 180,
                borderRadius: 24,
                background: 'rgba(22,32,51,0.88)',
                border: `2.5px solid ${winColor}`,
                padding: '18px 26px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                opacity: clamp01(rowSpring * 1.4),
                transform: `translateY(${(1 - rowSpring) * 30}px)`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <span
                  style={{
                    padding: '4px 12px',
                    borderRadius: 8,
                    background: 'rgba(255,255,255,0.1)',
                    fontFamily: FONT_MONO,
                    fontSize: 19,
                    fontWeight: 900,
                    color: '#CBD5E1',
                    flexShrink: 0,
                  }}
                >
                  R{idx + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FitText text={row.label} baseSize={27} minSize={20} maxLines={2} align="center" color="#FFFFFF" fontWeight={800} />
                </div>
                <span
                  style={{
                    padding: '5px 14px',
                    borderRadius: 99,
                    background: winColor,
                    fontFamily: FONT_MONO,
                    fontSize: 18,
                    fontWeight: 900,
                    color: '#FFFFFF',
                    flexShrink: 0,
                  }}
                >
                  +1 PT
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ flex: 1, height: 20, borderRadius: 10, background: 'rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'flex-end', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.round((leftWins ? 88 : 48) * barProg)}%`, height: '100%', background: blue, opacity: leftWins ? 1 : 0.45 }} />
                </div>
                <div style={{ width: 6, height: 26, borderRadius: 3, background: '#FFFFFF' }} />
                <div style={{ flex: 1, height: 20, borderRadius: 10, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.round((leftWins ? 48 : 88) * barProg)}%`, height: '100%', background: orange, opacity: leftWins ? 0.45 : 1 }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-27 / shot 3: tug-of-war — braided rope with knot pulling dynamically toward winning side */
const Look27TugOfWar: React.FC<StyleShotArgs> = ({ scene, localFrame, durationFrames, tokens }) => {
  const txt = sceneTexts(scene);
  const vs = extractVersusData(scene);
  const blue = tokens?.palette?.accent2 || '#3D7BFF';
  const orange = '#FF7A30';
  const dir = vs.winner === 'right' ? 1 : -1;

  const tugProgress = easeOutCubic(clamp01(localFrame / Math.max(1, durationFrames * 0.58)));
  const struggle = Math.sin(localFrame * 0.24) * 18 + Math.sin(localFrame * 0.45) * 7;
  const knotX = 540 + dir * tugProgress * 220 + struggle;
  const winColor = dir > 0 ? orange : blue;
  const ropeShakeY = Math.sin(localFrame * 0.55) * 3;
  const winnerLabelShort = shortText(dir > 0 ? vs.rightTitle : vs.leftTitle, 20);

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <Look27ArenaBackdrop localFrame={localFrame} tokens={tokens} />

      {/* Top Header */}
      <div style={{ position: 'absolute', top: 82, left: 54, right: 54, textAlign: 'center' }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 20, fontWeight: 900, color: '#94A3B8', letterSpacing: 2.5, marginBottom: 8 }}>
          TUG OF WAR · ชั่งน้ำหนักความได้เปรียบ
        </div>
        <FitText text={txt.title || 'ฝั่งไหนดึงความได้เปรียบไปครอง'} baseSize={46} minSize={28} maxLines={2} align="center" color="#FFFFFF" fontWeight={900} />
      </div>

      {/* Opposing Corner Banners */}
      <div style={{ position: 'absolute', top: 274, left: 54, right: 54, display: 'flex', justifyContent: 'space-between', gap: 24 }}>
        <div
          style={{
            flex: 1,
            padding: '18px 22px',
            borderRadius: 22,
            background: 'rgba(61,123,255,0.18)',
            border: `3px solid ${blue}`,
            opacity: dir < 0 ? 1 : 0.75,
          }}
        >
          <div style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 900, color: '#93C5FD', marginBottom: 6 }}>◄◄ LEFT FORCE</div>
          <FitText text={vs.leftTitle} baseSize={31} minSize={21} maxLines={2} align="left" color="#FFFFFF" fontWeight={900} />
        </div>

        <div
          style={{
            flex: 1,
            padding: '18px 22px',
            borderRadius: 22,
            background: 'rgba(255,122,48,0.18)',
            border: `3px solid ${orange}`,
            opacity: dir > 0 ? 1 : 0.75,
          }}
        >
          <div style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 900, color: '#FDBA74', textAlign: 'right', marginBottom: 6 }}>RIGHT FORCE ►►</div>
          <FitText text={vs.rightTitle} baseSize={31} minSize={21} maxLines={2} align="right" color="#FFFFFF" fontWeight={900} />
        </div>
      </div>

      {/* Center Tug-of-War Rope Stage SVG */}
      <svg width={STAGE_W} height={390} viewBox="0 0 1080 390" style={{ position: 'absolute', top: 454, left: 0 }}>
        <rect x={60} y={102} width={960} height={172} rx={34} fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.12)" strokeWidth={2.5} />
        <rect x={60} y={102} width={480} height={172} rx={34} fill={blue} opacity={0.12} />
        <rect x={540} y={102} width={480} height={172} rx={34} fill={orange} opacity={0.12} />

        <line x1={540} y1={76} x2={540} y2={304} stroke="#FFFFFF" strokeWidth={3} strokeDasharray="8 8" opacity={0.55} />
        <text x={540} y={64} textAnchor="middle" fill="#94A3B8" fontSize={19} fontFamily={FONT_MONO} fontWeight={800}>
          CENTER LINE
        </text>

        <circle cx={88} cy={188} r={26} fill={blue} stroke="#FFFFFF" strokeWidth={4} />
        <circle cx={992} cy={188} r={26} fill={orange} stroke="#FFFFFF" strokeWidth={4} />

        <g transform={`translate(0, ${ropeShakeY.toFixed(1)})`}>
          <line x1={88} y1={188} x2={992} y2={188} stroke="#D97706" strokeWidth={22} strokeLinecap="round" />
          <line x1={88} y1={188} x2={992} y2={188} stroke="#FDE68A" strokeWidth={9} strokeDasharray="16 14" strokeDashoffset={-knotX * 0.6} strokeLinecap="round" />

          <g transform={`translate(${knotX.toFixed(1)}, 188)`}>
            <circle cx={0} cy={0} r={46 + Math.sin(localFrame * 0.25) * 6} fill={winColor} opacity={0.28} />
            <polygon points="-24,14 24,14 16,98 0,82 -16,98" fill={winColor} stroke="#FFFFFF" strokeWidth={3} />
            <rect x={-26} y={-24} width={52} height={48} rx={16} fill="#FFFFFF" stroke={winColor} strokeWidth={6} />
            <text x={0} y={8} textAnchor="middle" fill="#0B0D12" fontSize={22} fontFamily={FONT_MONO} fontWeight={900}>
              {dir > 0 ? '►' : '◄'}
            </text>
          </g>
        </g>

        <text x={540} y={352} textAnchor="middle" fill={winColor} fontSize={31} fontFamily={FONT_THAI} fontWeight={900}>
          {winnerLabelShort} ดึงได้เปรียบ +{Math.round(tugProgress * 34)}%
        </text>
      </svg>

      {/* Bottom Force Factors Cards cleanly inside y: 868..1336 */}
      <div style={{ position: 'absolute', top: 868, left: 54, right: 54, display: 'flex', gap: 24 }}>
        <div
          style={{
            flex: 1,
            minHeight: 446,
            borderRadius: 26,
            background: 'rgba(15,23,42,0.86)',
            border: `2.5px solid ${dir < 0 ? blue : 'rgba(61,123,255,0.35)'}`,
            padding: '24px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{ fontFamily: FONT_MONO, fontSize: 19, fontWeight: 900, color: '#93C5FD' }}>แรงดึงฝั่งซ้าย</div>
          {vs.leftItems.slice(0, 3).map((it, idx) => (
            <div key={idx} style={{ padding: '14px 18px', borderRadius: 16, background: 'rgba(61,123,255,0.14)' }}>
              <FitText text={`• ${it}`} baseSize={26} minSize={20} maxLines={3} align="left" color="#E2E8F0" fontWeight={700} />
            </div>
          ))}
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 446,
            borderRadius: 26,
            background: 'rgba(15,23,42,0.86)',
            border: `2.5px solid ${dir > 0 ? orange : 'rgba(255,122,48,0.35)'}`,
            padding: '24px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            boxShadow: dir > 0 ? '0 18px 40px rgba(255,122,48,0.22)' : undefined,
          }}
        >
          <div style={{ fontFamily: FONT_MONO, fontSize: 19, fontWeight: 900, color: '#FDBA74' }}>แรงดึงฝั่งขวา</div>
          {vs.rightItems.slice(0, 3).map((it, idx) => (
            <div key={idx} style={{ padding: '14px 18px', borderRadius: 16, background: 'rgba(255,122,48,0.16)' }}>
              <FitText text={`• ${it}`} baseSize={26} minSize={20} maxLines={3} align="left" color="#FFF7ED" fontWeight={700} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/** look-27 / shot 4: verdict — championship trophy/crown drops onto the winner with official stamp */
const Look27Verdict: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const txt = sceneTexts(scene);
  const vs = extractVersusData(scene);
  const blue = tokens?.palette?.accent2 || '#3D7BFF';
  const orange = '#FF7A30';
  const winColor = vs.winner === 'right' ? orange : blue;
  const winnerName = vs.winner === 'right' ? vs.rightTitle : vs.leftTitle;

  const dropSpring = spring({
    frame: localFrame,
    fps,
    config: { damping: 11, stiffness: 135, mass: 0.9 },
  });
  const stampSpring = spring({
    frame: Math.max(0, localFrame - 18),
    fps,
    config: { damping: 12, stiffness: 200 },
  });
  const trophyFloat = Math.sin(localFrame * 0.1) * 8;
  const beamAngle = Math.sin(localFrame * 0.05) * 10;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <Look27ArenaBackdrop localFrame={localFrame} tokens={tokens} />

      {/* Rotating Championship Spotlights + Falling Gold Confetti */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <g transform={`rotate(${beamAngle.toFixed(1)} 540 0)`} opacity={0.22}>
          <polygon points="440,0 640,0 920,1220 160,1220" fill="#FACC15" />
        </g>
        <g transform={`rotate(${(-beamAngle * 1.2).toFixed(1)} 540 0)`} opacity={0.18}>
          <polygon points="490,0 590,0 820,1300 260,1300" fill={winColor} />
        </g>
        {[110, 230, 350, 480, 620, 760, 890, 980].map((cx, i) => {
          const cy = ((localFrame * (2.6 + (i % 3) * 0.9) + i * 170) % 1280) + 40;
          return (
            <rect
              key={cx}
              x={cx}
              y={cy}
              width={14}
              height={22}
              rx={4}
              fill={i % 3 === 0 ? '#FACC15' : i % 3 === 1 ? winColor : '#FFFFFF'}
              opacity={0.72}
              transform={`rotate(${localFrame * 4 + i * 35} ${cx + 7} ${cy + 11})`}
            />
          );
        })}
      </svg>

      {/* Top Verdict Banner */}
      <div style={{ position: 'absolute', top: 80, left: 56, right: 56, textAlign: 'center' }}>
        <div
          style={{
            display: 'inline-block',
            padding: '7px 24px',
            borderRadius: 99,
            background: 'rgba(250,204,21,0.18)',
            border: '2px solid #FACC15',
            fontFamily: FONT_MONO,
            fontSize: 21,
            fontWeight: 900,
            color: '#FDE047',
            letterSpacing: 3,
            marginBottom: 12,
          }}
        >
          ★ FINAL VERDICT · คำตัดสิน
        </div>
        <FitText text={txt.title || 'บทสรุปผู้ชนะชัดเจน'} baseSize={46} minSize={28} maxLines={2} align="center" color="#FFFFFF" fontWeight={900} />
      </div>

      {/* Dropping Golden Trophy & Crown SVG */}
      <div
        style={{
          position: 'absolute',
          top: 254,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          transform: `translateY(${((1 - dropSpring) * -240 + trophyFloat).toFixed(1)}px) scale(${(0.75 + dropSpring * 0.25).toFixed(3)})`,
        }}
      >
        <svg width={388} height={388} viewBox="0 0 440 440">
          <defs>
            <linearGradient id="l27-gold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#FEF08A" />
              <stop offset="48%" stopColor="#FACC15" />
              <stop offset="100%" stopColor="#CA8A04" />
            </linearGradient>
          </defs>
          <circle cx={220} cy={210} r={175} fill="none" stroke="#FACC15" strokeWidth={3} strokeDasharray="12 10" opacity={0.48} />
          <circle cx={220} cy={210} r={140} fill="#FACC15" opacity={0.14} />
          <polygon points="158,92 172,46 202,72 220,30 238,72 268,46 282,92" fill="url(#l27-gold)" stroke="#FEF9C3" strokeWidth={4} strokeLinejoin="round" />
          <path d="M 134 134 C 76 134 74 228 144 238" fill="none" stroke="url(#l27-gold)" strokeWidth={18} strokeLinecap="round" />
          <path d="M 306 134 C 364 134 366 228 296 238" fill="none" stroke="url(#l27-gold)" strokeWidth={18} strokeLinecap="round" />
          <path d="M 132 114 H 308 L 288 238 C 282 276 254 298 220 298 C 186 298 158 276 152 238 Z" fill="url(#l27-gold)" stroke="#FEF9C3" strokeWidth={4} />
          <polygon points="220,156 232,188 266,190 239,210 248,244 220,225 192,244 201,210 174,190 208,188" fill="#FFFBEB" />
          <rect x={198} y={296} width={44} height={54} rx={8} fill="#CA8A04" />
          <rect x={144} y={346} width={152} height={28} rx={10} fill="url(#l27-gold)" />
          <rect x={118} y={372} width={204} height={42} rx={12} fill="#1E293B" stroke="#FACC15" strokeWidth={4} />
          <text x={220} y={401} textAnchor="middle" fill="#FDE047" fontSize={23} fontFamily={FONT_MONO} fontWeight={900} letterSpacing={3}>
            CHAMPION
          </text>
        </svg>
      </div>

      {/* Winner Showcase Plate + Official Slamming Stamp (y: 668..1190) */}
      <div
        style={{
          position: 'absolute',
          top: 668,
          left: 58,
          right: 58,
          borderRadius: 38,
          background: 'linear-gradient(155deg, #162033 0%, #0F172A 100%)',
          border: `4px solid ${winColor}`,
          boxShadow: '0 28px 64px rgba(0,0,0,0.55)',
          padding: '40px 42px 36px',
          opacity: appear(localFrame, 10, 14),
        }}
      >
        <div style={{ fontFamily: FONT_MONO, fontSize: 21, fontWeight: 900, color: winColor, letterSpacing: 2.5, marginBottom: 12 }}>
          WINNER SELECTED · {vs.winner === 'right' ? 'ORANGE' : 'BLUE'} SIDE
        </div>

        <FitText text={winnerName} baseSize={50} minSize={30} maxLines={2} align="left" color="#FFFFFF" fontWeight={900} />

        <div style={{ marginTop: 22, paddingTop: 20, borderTop: '2px solid rgba(255,255,255,0.14)' }}>
          <FitText text={vs.verdictSummary} baseSize={31} minSize={22} maxLines={4} align="left" color="#E2E8F0" fontWeight={700} lineHeight={1.36} />
        </div>

        <div
          style={{
            position: 'absolute',
            top: -32,
            right: 28,
            padding: '12px 28px',
            borderRadius: 16,
            border: '5px solid #FACC15',
            background: 'rgba(11,13,18,0.92)',
            boxShadow: '0 14px 28px rgba(0,0,0,0.45)',
            transform: `rotate(-9deg) scale(${(2.1 - stampSpring * 1.1).toFixed(3)})`,
            opacity: clamp01(stampSpring * 1.4),
          }}
        >
          <span style={{ fontFamily: FONT_THAI, fontSize: 30, fontWeight: 900, color: '#FACC15', letterSpacing: 1 }}>
            ฟันธง! ✓
          </span>
        </div>
      </div>

      {/* Bottom Score Strip strictly above SubtitleBar (y: 1228..1336) */}
      <div
        style={{
          position: 'absolute',
          top: 1228,
          left: 58,
          right: 58,
          height: 108,
          borderRadius: 24,
          background: 'rgba(255,255,255,0.06)',
          border: '2px solid rgba(255,255,255,0.14)',
          padding: '0 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontFamily: FONT_THAI, fontSize: 27, fontWeight: 800, color: '#93C5FD' }}>
          {shortText(vs.leftTitle, 18)} · {vs.leftScore}
        </span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 23, fontWeight: 900, color: '#FACC15' }}>FINAL</span>
        <span style={{ fontFamily: FONT_THAI, fontSize: 27, fontWeight: 800, color: '#FDBA74' }}>
          {shortText(vs.rightTitle, 18)} · {vs.rightScore}
        </span>
      </div>
    </div>
  );
};

// ============================================================================
// Exported Registry Definitions — BATCH_A (look-15, look-24, look-27)
// ============================================================================

export const BATCH_A: StyleDirectorDef[] = [
  {
    styleId: 'look-15',
    caption: 'bar',
    shots: {
      'chat-burst': Look15ChatBurst,
      'typing-reveal': Look15TypingReveal,
      'screenshot-zoom': Look15ScreenshotZoom,
      'group-chat': Look15GroupChat,
      'voice-note': Look15VoiceNote,
    },
    shotLabels: {
      'chat-burst': 'บับเบิลแชทเด้งรัวสลับซ้ายขวา',
      'typing-reveal': 'จุดกำลังพิมพ์ (...) แล้วเฉลยคำตอบ',
      'screenshot-zoom': 'ซูมหน้าจอโทรศัพท์ + ไฮไลต์ข้อความ',
      'group-chat': 'แชทกลุ่มหลายคนพร้อมอวาตาร์',
      'voice-note': 'ข้อความเสียงพร้อมคลื่นเสียงวิ่ง',
    },
    infer: (scene: StudioScene) => {
      const txt = sceneTexts(scene);
      const blob = `${txt.title} ${txt.subtitle} ${txt.bullets.join(' ')} ${txt.badge}`.toLowerCase();
      if (scene.visual === 'quote') return 'voice-note';
      if (scene.visual === 'stat') return 'screenshot-zoom';
      if (scene.visual === 'compare' || scene.visual === 'steps') return 'group-chat';
      if (scene.visual === 'bullets') return 'chat-burst';
      if (/ข้อความเสียง|อัดเสียง|โทร|voice|audio/.test(blob)) return 'voice-note';
      if (/ซูม|หลักฐาน|แคป|ไฮไลต์|สถิติ/.test(blob)) return 'screenshot-zoom';
      if (/กลุ่ม|ทีม|หลายคน|เพื่อน/.test(blob)) return 'group-chat';
      if (/\?|เฉลย|ความลับ|คำตอบ|สงสัย|รู้ไหม/.test(blob)) return 'typing-reveal';
      return null;
    },
  },
  {
    styleId: 'look-24',
    caption: 'bar',
    shots: {
      'race-bars': Look24RaceBars,
      podium: Look24Podium,
      'top-list-scroll': Look24TopListScroll,
      'versus-gap': Look24VersusGap,
    },
    shotLabels: {
      'race-bars': 'แท่งแนวนอนวิ่งแข่งตามตัวเลข',
      podium: 'แท่นอันดับ 1-2-3 พร้อมเหรียญรางวัล',
      'top-list-scroll': 'ลิสต์อันดับ #5→#1 ระเบิดแสงที่ #1',
      'versus-gap': '2 แท่งเทียบส่วนต่างพร้อมลูกศรวัด',
    },
    infer: (scene: StudioScene) => {
      const txt = sceneTexts(scene);
      const blob = `${txt.title} ${txt.subtitle} ${txt.bullets.join(' ')} ${txt.badge}`.toLowerCase();
      if (scene.visual === 'compare' || /\bvs\b|เทียบ|ต่าง|ช่องว่าง|ระหว่าง/.test(blob)) return 'versus-gap';
      if (txt.numbers.length >= 3 || scene.visual === 'stat' || /ตัวเลข|สถิติ|%|พุ่ง/.test(blob)) return 'race-bars';
      if (scene.visual === 'steps' || /อันดับ|ท็อป|top|3 ขั้นตอน|ผู้ชนะ|สูงสุด|โพเดียม/.test(blob)) return 'podium';
      if (scene.visual === 'bullets' || txt.bullets.length >= 3 || /รายการ|ลิสต์|ข้อ/.test(blob)) return 'top-list-scroll';
      return null;
    },
  },
  {
    styleId: 'look-27',
    caption: 'bar',
    shots: {
      'split-duel': Look27SplitDuel,
      scoreboard: Look27Scoreboard,
      'tug-of-war': Look27TugOfWar,
      verdict: Look27Verdict,
    },
    shotLabels: {
      'split-duel': 'แบ่งจอเฉียงปะทะกัน + สัญลักษณ์ VS',
      scoreboard: 'กระดานคะแนนแบบ flip นับทีละข้อ',
      'tug-of-war': 'ชักเย่อดึงเชือกชี้ฝั่งที่ชนะ',
      verdict: 'ตัดสินผู้ชนะพร้อมถ้วยรางวัลและตราประทับ',
    },
    infer: (scene: StudioScene) => {
      const txt = sceneTexts(scene);
      const blob = `${txt.title} ${txt.subtitle} ${txt.bullets.join(' ')} ${txt.badge}`.toLowerCase();
      if (scene.visual === 'quote' || /สรุป|ผู้ชนะ|ฟันธง|ตัดสิน|ปิดท้าย|verdict/.test(blob)) return 'verdict';
      if (scene.visual === 'compare' || /\bvs\b|เทียบ|ปะทะ|ระหว่าง/.test(blob)) return 'split-duel';
      if (scene.visual === 'stat' || txt.numbers.length >= 2 || /คะแนน|แต้ม|ตัวเลข|สถิติ/.test(blob)) return 'scoreboard';
      if (scene.visual === 'steps' || /น้ำหนัก|ดึง|ชักเย่อ|ได้เปรียบ|ขั้นตอน/.test(blob)) return 'tug-of-war';
      return null;
    },
  },
];
