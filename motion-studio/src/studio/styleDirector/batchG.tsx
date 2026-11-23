import React from 'react';
import { interpolate, spring } from 'remotion';
import { THAI_FONT_FAMILY } from '../../components/ThaiFontLoader';
import type { StudioScene } from '../types';
import { FitText, SAFE_BOTTOM, STAGE_H, STAGE_W, appear, clamp01, easeOutCubic, sceneTexts, stagger } from './kit';
import type { StyleDirectorDef, StyleShotArgs } from './types';

// ============================================================================
// SHARED HELPERS FOR BATCH G (look-22, look-23, look-25)
// Pure, Deterministic, Inline SVG/CSS Only, Zero External Assets
// ============================================================================

const FONT_THAI = THAI_FONT_FAMILY;
const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

const STEP_RE = /(?:ขั้นตอน|สเต็ป|ลำดับ|วิธี|เส้นทาง|จาก.+สู่|step)/i;
const SUMMARY_RE = /(?:สรุป|สำคัญ|ไฮไลต์|ประโยคจำ|จำไว้|หัวใจ|แก่น|บทเรียน|หลักฐาน|ยืนยัน)/i;
const COMPARE_RE = /(?:เทียบ|ก่อน|หลัง|ตอนนั้น|ตอนนี้|อดีต|ปัจจุบัน|แบบเดิม|เปลี่ยนไป|ต่างกัน|vs|before|after)/i;
const MONEY_RE = /(?:บาท|฿|ยอดขาย|รายได้|กำไร|ออเดอร์|ขายได้|โอน|ชำระ|เงินเข้า|ล้าน|แสน|หมื่น)/i;
const ALERT_SHORT_RE = /(?:ด่วน|เตือน|สั่น|นาฬิกา|ทันที|สั้น|เด้ง|ปิง)/i;
const DASHBOARD_RE = /(?:แดชบอร์ด|ระบบ|กราฟ|สถิติ|ภาพรวม|วิเคราะห์|มอนิเตอร์|เรียลไทม์)/i;
const NOTIF_STACK_RE = /(?:แจ้งเตือน|ไหลเข้า|สมัคร|ล็อกสกรีน|กองแจ้งเตือน|ข้อความเข้า)/i;
const GRAPH_RE = /(?:กราฟ|ยอด|สถิติ|เพิ่มขึ้น|ลดลง|เติบโต|%|เท่า|ตัวเลข)/i;
const PERSON_RE = /(?:คน|ตัวคุณ|นิสัย|ชีวิต|สุขภาพ|บุคลิก|คิด|ใจ|ตัวเอง|ร่างกาย|ใบหน้า)/i;
const ROOM_RE = /(?:ห้อง|โต๊ะ|จัด|ระเบียบ|รก|พื้นที่|สภาพแวดล้อม|บ้าน|ออฟฟิศ)/i;
const VIRAL_RE = /(?:แชร์|ไวรัล|เข้าถึง|ยอดวิว|กระจาย|เครือข่าย|รีโพสต์|ล้าน|แสน)/i;
const COMMENT_RE = /(?:คอมเมนต์|ความเห็น|เสียงสะท้อน|ถกเถียง|ชาวเน็ต|รีวิว|ตอบกลับ|พูดถึง)/i;
const POST_RE = /(?:โพสต์|ประกาศ|เปิดเผย|แคป|สกรีนช็อต|โซเชียล)/i;

interface PaletteG {
  bg: string;
  bg2: string;
  surface: string;
  fg: string;
  muted: string;
  accent: string;
  accent2: string;
  border: string;
}

function resolvePaletteG(tokens: any, fallback: PaletteG): PaletteG {
  const p = tokens?.palette || {};
  return {
    bg: typeof p.bg === 'string' && p.bg ? p.bg : fallback.bg,
    bg2: typeof p.bg2 === 'string' && p.bg2 ? p.bg2 : typeof p.bgSecondary === 'string' && p.bgSecondary ? p.bgSecondary : fallback.bg2,
    surface: typeof p.surface === 'string' && p.surface ? p.surface : typeof p.cardBg === 'string' && p.cardBg ? p.cardBg : fallback.surface,
    fg: typeof p.fg === 'string' && p.fg ? p.fg : typeof p.text === 'string' && p.text ? p.text : fallback.fg,
    muted: typeof p.muted === 'string' && p.muted ? p.muted : fallback.muted,
    accent: typeof p.accent === 'string' && p.accent ? p.accent : fallback.accent,
    accent2: typeof p.accent2 === 'string' && p.accent2 ? p.accent2 : fallback.accent2,
    border: typeof p.border === 'string' && p.border ? p.border : fallback.border,
  };
}

function shortTextG(input: string, maxChars: number): string {
  const s = String(input || '').trim();
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(4, maxChars - 1)).trim()}…`;
}

function haystackOfG(scene: StudioScene): string {
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

function extractPointsG(scene: StudioScene, max = 4): string[] {
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

function extractShortPointsG(scene: StudioScene, max = 4): string[] {
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

function parseNumericG(raw: string | number | undefined, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw || '').replace(/,/g, '');
  const m = s.match(/\d+(?:\.\d+)?/);
  if (!m) return fallback;
  const base = parseFloat(m[0]);
  if (!Number.isFinite(base)) return fallback;
  if (/[Mm]|ล้าน/.test(s)) return Math.round(base * 1000000);
  if (/แสน/.test(s)) return Math.round(base * 100000);
  if (/หมื่น/.test(s)) return Math.round(base * 10000);
  if (/[Kk]|พัน/.test(s)) return Math.round(base * 1000);
  return base;
}

function formatNumG(n: number): string {
  const rounded = Math.round(n);
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function extractPrimaryMetricG(
  scene: StudioScene,
  sceneIndex: number,
  fallbackNum = 12840,
): { big: string; unit: string; numeric: number; prefix: string; suffix: string; delta: string } {
  if (scene.stat?.value !== undefined && String(scene.stat.value).trim()) {
    const rawVal = String(scene.stat.value).trim();
    return {
      big: rawVal,
      unit: String(scene.stat.unit || scene.stat.label || '').trim(),
      numeric: scene.stat.numericValue ?? parseNumericG(rawVal, fallbackNum),
      prefix: String(scene.stat.prefix || '').trim(),
      suffix: String(scene.stat.suffix || scene.stat.unit || '').trim(),
      delta: String(scene.stat.delta || '+42%').trim(),
    };
  }
  const t = sceneTexts(scene);
  if (t.numbers.length > 0) {
    const first = t.numbers[0];
    return {
      big: first,
      unit: t.badge || `ซีน ${sceneIndex + 1}`,
      numeric: parseNumericG(first, fallbackNum),
      prefix: first.includes('฿') ? '฿' : '',
      suffix: first.includes('%') ? '%' : '',
      delta: '+38%',
    };
  }
  const seeded = fallbackNum + sceneIndex * 1450;
  return {
    big: formatNumG(seeded),
    unit: t.badge || 'ยอดสะสมล่าสุด',
    numeric: seeded,
    prefix: '฿',
    suffix: '',
    delta: '+28%',
  };
}

function extractHighlightPhraseG(scene: StudioScene): string {
  const hl = Array.isArray(scene.highlight) ? scene.highlight[0] : scene.highlight;
  if (hl && String(hl).trim()) return String(hl).trim();
  const t = sceneTexts(scene);
  if (t.numbers[0]) return t.numbers[0];
  if (scene.quote?.text) return shortTextG(scene.quote.text, 34);
  return shortTextG(t.title || 'ประเด็นสำคัญที่ต้องจับตา', 30);
}

interface BeforeAfterPair {
  leftTitle: string;
  rightTitle: string;
  leftItems: string[];
  rightItems: string[];
}

function extractBeforeAfterG(scene: StudioScene): BeforeAfterPair {
  const t = sceneTexts(scene);
  if (scene.compare) {
    const leftItems = (scene.compare.leftItems || []).map((s) => String(s || '').trim()).filter(Boolean);
    const rightItems = (scene.compare.rightItems || []).map((s) => String(s || '').trim()).filter(Boolean);
    return {
      leftTitle: String(scene.compare.leftTitle || scene.compare.leftLabel || 'ก่อนเปลี่ยน').trim(),
      rightTitle: String(scene.compare.rightTitle || scene.compare.rightLabel || 'หลังเปลี่ยน').trim(),
      leftItems: leftItems.length > 0 ? leftItems.slice(0, 4) : ['วิธีเดิมที่ช้าและซับซ้อน', 'เสียเวลาจัดการซ้ำซ้อน'],
      rightItems: rightItems.length > 0 ? rightItems.slice(0, 4) : ['ระบบใหม่ที่กระชับชัดเจน', 'เห็นผลลัพธ์เร็วขึ้นทันที'],
    };
  }

  const pts = extractShortPointsG(scene, 6);
  if (pts.length >= 2) {
    const mid = Math.ceil(pts.length / 2);
    return {
      leftTitle: 'ก่อนหน้า (BEFORE)',
      rightTitle: 'หลังเปลี่ยน (AFTER)',
      leftItems: pts.slice(0, mid),
      rightItems: pts.slice(mid),
    };
  }

  const single = pts[0] || t.subtitle || 'จุดเริ่มต้นก่อนปรับปรุง';
  return {
    leftTitle: 'ก่อนหน้า (BEFORE)',
    rightTitle: 'หลังเปลี่ยน (AFTER)',
    leftItems: [shortTextG(single, 44), 'ยังขาดระบบที่ชัดเจน'],
    rightItems: [shortTextG(t.title || 'ผลลัพธ์หลังปรับเปลี่ยน', 44), scene.stat?.delta ? `ดีขึ้น ${scene.stat.delta}` : 'เห็นความเปลี่ยนแปลงชัดเจน'],
  };
}

// Fictional personas & brand handles ONLY (zero real people's names)
const FICTIONAL_STORES = [
  { name: 'Korn Craft', handle: '@korncraft', amount: '฿1,290', color: '#10B981', tag: 'ออเดอร์ใหม่' },
  { name: 'Ploy Studio', handle: '@ploystudio', amount: '฿2,450', color: '#06B6D4', tag: 'ชำระสำเร็จ' },
  { name: 'Nida Market', handle: '@nidamkt', amount: '฿890', color: '#F59E0B', tag: 'สมัครสมาชิก' },
  { name: 'Tonkla Shop', handle: '@tonklashop', amount: '฿3,600', color: '#8B5CF6', tag: 'โอนเข้าบัญชี' },
];

const FICTIONAL_USERS = [
  { name: 'นนท์ ภัทรพงศ์', handle: '@nont_notes', initials: 'นภ', bg: '#0EA5E9', role: 'นักวิเคราะห์อิสระ' },
  { name: 'แพรวา สุขสันต์', handle: '@praewa_lab', initials: 'พส', bg: '#10B981', role: 'ผู้ใช้งานจริง' },
  { name: 'ต้นกล้า มีสุข', handle: '@tonkla_th', initials: 'ตม', bg: '#F59E0B', role: 'เจ้าของร้านออนไลน์' },
  { name: 'มิ้นท์ กุลธิดา', handle: '@mint_daily', initials: 'มก', bg: '#EC4899', role: 'ครีเอเตอร์สายข้อมูล' },
  { name: 'กรณ์ วรวิทย์', handle: '@korn_dev', initials: 'กว', bg: '#8B5CF6', role: 'สมาชิกชุมชน' },
];

// ============================================================================
// STYLE 1: look-22 — NOTIFICATION STACK (กองแจ้งเตือน)
// ============================================================================

const NotifBackdrop: React.FC<{ localFrame: number; pal: PaletteG; glowColor?: string; glowY?: number }> = ({
  localFrame,
  pal,
  glowColor = '#10B981',
  glowY = 620,
}) => {
  const drift = (localFrame * 0.45) % 48;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(circle at 540px ${glowY}px, ${glowColor}28 0%, ${pal.bg2} 44%, ${pal.bg} 100%)`,
        overflow: 'hidden',
      }}
    >
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0, opacity: 0.22 }}>
        <defs>
          <pattern id="g22Grid" width="48" height="48" patternUnits="userSpaceOnUse" patternTransform={`translate(0 ${drift.toFixed(1)})`}>
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#334155" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={STAGE_W} height={STAGE_H} fill="url(#g22Grid)" />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(180deg, rgba(11,17,32,0.5) 0%, rgba(11,17,32,0) 24%, rgba(11,17,32,0.85) 100%)',
        }}
      />
    </div>
  );
};

const NotifAppIconSvg: React.FC<{ kind: number; color: string; size?: number }> = ({ kind, color, size = 46 }) => {
  const k = kind % 4;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: `linear-gradient(145deg, ${color}, ${color}BB)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: `0 6px 14px ${color}44`,
      }}
    >
      <svg width={Math.round(size * 0.56)} height={Math.round(size * 0.56)} viewBox="0 0 24 24" fill="none">
        {k === 0 && (
          <>
            <path d="M6 8h12l-1 11H7L6 8Z" stroke="#FFF" strokeWidth="2.2" strokeLinejoin="round" />
            <path d="M9 8V6a3 3 0 0 1 6 0v2" stroke="#FFF" strokeWidth="2.2" strokeLinecap="round" />
          </>
        )}
        {k === 1 && (
          <>
            <circle cx="12" cy="12" r="8" stroke="#FFF" strokeWidth="2.2" />
            <path d="M12 7v10M9.5 10c0-1.1 1.1-2 2.5-2s2.5.9 2.5 2-1.1 1.8-2.5 2-2.5.9-2.5 2 1.1 2 2.5 2 2.5-.9 2.5-2" stroke="#FFF" strokeWidth="2" strokeLinecap="round" />
          </>
        )}
        {k === 2 && (
          <>
            <circle cx="10" cy="8.5" r="3.5" stroke="#FFF" strokeWidth="2.2" />
            <path d="M4.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" stroke="#FFF" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M18 8v6M15 11h6" stroke="#FFF" strokeWidth="2.2" strokeLinecap="round" />
          </>
        )}
        {k === 3 && (
          <>
            <path d="M12 4a5 5 0 0 0-5 5v3.5L5.5 15h13L17 12.5V9a5 5 0 0 0-5-5Z" stroke="#FFF" strokeWidth="2.2" strokeLinejoin="round" />
            <path d="M10 18a2 2 0 0 0 4 0" stroke="#FFF" strokeWidth="2.2" strokeLinecap="round" />
          </>
        )}
      </svg>
    </div>
  );
};

/** look-22 / shot 1: lockscreen-flood — phone lock screen with notifications stacking up + running counter */
const Look22LockscreenFlood: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const pal = resolvePaletteG(tokens, {
    bg: '#0B1120',
    bg2: '#1E293B',
    surface: '#162033',
    fg: '#F8FAFC',
    muted: '#94A3B8',
    accent: '#10B981',
    accent2: '#06B6D4',
    border: '#334155',
  });
  const txt = sceneTexts(scene);
  const pts = extractShortPointsG(scene, 4);
  const metric = extractPrimaryMetricG(scene, sceneIndex, 48);

  const items = [0, 1, 2, 3].map((i) => {
    const store = FICTIONAL_STORES[(i + sceneIndex) % FICTIONAL_STORES.length];
    const body = pts[i] || (i === 0 ? txt.title : i === 1 ? txt.subtitle || 'มีรายการใหม่เข้ามาอย่างต่อเนื่อง' : `${store.tag} · ${store.amount}`);
    const times = ['เมื่อสักครู่', '1 นาทีที่แล้ว', '3 นาทีที่แล้ว', '5 นาทีที่แล้ว'];
    return {
      title: store.name,
      tag: store.tag,
      amount: store.amount,
      color: store.color,
      body: shortTextG(body, 56),
      time: times[i],
    };
  });

  const phoneEnter = spring({ frame: localFrame, fps, config: { damping: 16, stiffness: 130 } });
  const headerP = appear(localFrame, 2, 14);

  // Count how many notifications have arrived
  let activeCount = 0;
  let shakeOffset = 0;
  for (let i = 0; i < items.length; i++) {
    const delay = 8 + i * 13;
    if (localFrame >= delay) {
      activeCount += 1;
      const dt = localFrame - delay;
      if (dt < 10) {
        shakeOffset += Math.sin(dt * 1.9) * (1 - dt / 10) * 5;
      }
    }
  }
  const badgeScale = spring({
    frame: Math.max(0, localFrame - (8 + Math.max(0, activeCount - 1) * 13)),
    fps,
    config: { damping: 10, stiffness: 240 },
  });

  const displayTotal = Math.max(activeCount, Math.round(interpolate(clamp01(localFrame / 58), [0, 1], [1, Math.min(99, Math.max(4, activeCount * 7))])));

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <NotifBackdrop localFrame={localFrame} pal={pal} glowColor="#10B981" glowY={680} />

      {/* Top Headline Header */}
      <div
        style={{
          position: 'absolute',
          top: 62,
          left: 64,
          right: 64,
          opacity: headerP,
          transform: `translateY(${((1 - headerP) * -18).toFixed(1)}px)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          zIndex: 5,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '7px 20px',
            borderRadius: 99,
            background: 'rgba(16,185,129,0.16)',
            border: '1.5px solid rgba(16,185,129,0.55)',
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: 99, background: '#10B981', boxShadow: '0 0 10px #10B981' }} />
          <span style={{ fontFamily: FONT_THAI, fontSize: 22, fontWeight: 700, color: '#6EE7B7' }}>
            {shortTextG(txt.badge || 'แจ้งเตือนไหลเข้าต่อเนื่อง', 28)}
          </span>
        </div>
        <FitText text={txt.title || 'ยอดแจ้งเตือนพุ่งไม่หยุด'} baseSize={48} minSize={30} maxLines={2} color="#F8FAFC" />
      </div>

      {/* Smartphone Lockscreen Mockup (y: 268..1368) */}
      <div
        style={{
          position: 'absolute',
          top: 268,
          left: 140,
          width: 800,
          height: 1100,
          transform: `translateX(${shakeOffset.toFixed(1)}px) translateY(${((1 - phoneEnter) * 70).toFixed(1)}px) scale(${(0.92 + phoneEnter * 0.08).toFixed(4)})`,
          zIndex: 4,
        }}
      >
        {/* Floating Unread Counter Badge */}
        <div
          style={{
            position: 'absolute',
            top: -22,
            right: -18,
            zIndex: 12,
            padding: '12px 24px',
            borderRadius: 99,
            background: 'linear-gradient(135deg, #EF4444, #DC2626)',
            border: '3px solid #FEE2E2',
            boxShadow: '0 14px 32px rgba(239,68,68,0.48)',
            transform: `scale(${(0.85 + badgeScale * 0.15).toFixed(3)})`,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontFamily: FONT_MONO, fontSize: 30, fontWeight: 900, color: '#FFFFFF' }}>+{displayTotal}</span>
          <span style={{ fontFamily: FONT_THAI, fontSize: 22, fontWeight: 700, color: '#FEE2E2' }}>ใหม่</span>
        </div>

        {/* Outer Titanium Bezel */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 64,
            background: 'linear-gradient(145deg, #475569 0%, #0F172A 48%, #334155 100%)',
            padding: 16,
            boxShadow: '0 40px 90px rgba(0,0,0,0.65), 0 0 0 2px rgba(148,163,184,0.3)',
          }}
        >
          {/* Lock Screen Wallpaper */}
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: 50,
              background: 'radial-gradient(circle at 30% 18%, #0F4C5C 0%, #0E2A5A 46%, #090D1A 100%)',
              position: 'relative',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              padding: '24px 28px 28px',
            }}
          >
            {/* Dynamic Island & Status */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: 22, fontWeight: 700, color: '#E2E8F0' }}>5G</span>
              <div style={{ width: 174, height: 34, borderRadius: 99, background: '#020617', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 14 }}>
                <div style={{ width: 12, height: 12, borderRadius: 99, background: '#10B981', opacity: 0.7 + 0.3 * Math.sin(localFrame * 0.2) }} />
              </div>
              <svg width={56} height={22} viewBox="0 0 56 22">
                <rect x={2} y={4} width={44} height={14} rx={4} fill="none" stroke="#E2E8F0" strokeWidth={2} />
                <rect x={6} y={7} width={34} height={8} rx={2} fill="#10B981" />
                <rect x={48} y={8} width={4} height={6} rx={1} fill="#E2E8F0" />
              </svg>
            </div>

            {/* Lock Icon + Clock */}
            <div style={{ textAlign: 'center', marginBottom: 22 }}>
              <svg width={26} height={30} viewBox="0 0 26 30" style={{ display: 'inline-block', marginBottom: 4 }}>
                <path d="M7 13V9a6 6 0 0 1 12 0v4" fill="none" stroke="#94A3B8" strokeWidth="2.5" strokeLinecap="round" />
                <rect x="4" y="13" width="18" height="14" rx="4" fill="#94A3B8" />
              </svg>
              <div style={{ fontFamily: FONT_MONO, fontSize: 96, fontWeight: 800, color: '#F8FAFC', lineHeight: 0.95, letterSpacing: -2 }}>
                09:41
              </div>
              <div style={{ fontFamily: FONT_THAI, fontSize: 23, fontWeight: 600, color: '#CBD5E1', marginTop: 6 }}>
                วันอังคาร · {shortTextG(metric.unit || 'สรุปรายการล่าสุด', 24)}
              </div>
            </div>

            {/* Stacking Notification Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
              {items.map((item, idx) => {
                const delay = 8 + idx * 13;
                const sp = spring({ frame: Math.max(0, localFrame - delay), fps, config: { damping: 14, stiffness: 170 } });
                const op = clamp01((localFrame - delay) / 6);
                const yOff = interpolate(sp, [0, 1], [-52, 0]);
                const sc = interpolate(sp, [0, 1], [0.9, 1]);
                return (
                  <div
                    key={idx}
                    style={{
                      opacity: op,
                      transform: `translateY(${yOff.toFixed(1)}px) scale(${sc.toFixed(4)})`,
                      borderRadius: 24,
                      background: 'rgba(15, 23, 42, 0.78)',
                      border: `1.5px solid ${idx === 0 ? `${item.color}99` : 'rgba(148,163,184,0.28)'}`,
                      padding: '16px 20px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                      boxShadow: idx === 0 ? `0 14px 30px rgba(0,0,0,0.4), 0 0 24px ${item.color}22` : '0 10px 22px rgba(0,0,0,0.32)',
                    }}
                  >
                    <NotifAppIconSvg kind={idx} color={item.color} size={52} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontFamily: FONT_THAI, fontSize: 23, fontWeight: 800, color: '#F8FAFC' }}>{item.title}</span>
                          <span
                            style={{
                              fontFamily: FONT_THAI,
                              fontSize: 17,
                              fontWeight: 700,
                              color: item.color,
                              background: `${item.color}22`,
                              padding: '2px 10px',
                              borderRadius: 99,
                            }}
                          >
                            {item.tag}
                          </span>
                        </div>
                        <span style={{ fontFamily: FONT_THAI, fontSize: 18, color: '#94A3B8' }}>{item.time}</span>
                      </div>
                      <FitText text={item.body} baseSize={24} minSize={19} maxLines={2} color="#E2E8F0" fontWeight={600} align="left" lineHeight={1.25} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom Home Indicator */}
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
              <div style={{ width: 210, height: 7, borderRadius: 99, background: 'rgba(248,250,252,0.45)' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Metric Strip above SAFE_BOTTOM (y: 1396..1492) */}
      <div
        style={{
          position: 'absolute',
          top: 1398,
          left: 90,
          right: 90,
          height: 92,
          borderRadius: 22,
          background: 'rgba(15,23,42,0.88)',
          border: '1.5px solid rgba(51,65,85,0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 32px',
          opacity: appear(localFrame, 18, 14),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 14, height: 14, borderRadius: 99, background: '#10B981', boxShadow: '0 0 12px #10B981' }} />
          <span style={{ fontFamily: FONT_THAI, fontSize: 26, fontWeight: 700, color: '#CBD5E1' }}>
            {shortTextG(txt.subtitle || 'สถานะแจ้งเตือนอัตโนมัติทำงานตลอด 24 ชม.', 36)}
          </span>
        </div>
        <span style={{ fontFamily: FONT_MONO, fontSize: 32, fontWeight: 900, color: '#34D399' }}>
          {metric.prefix}{metric.big}
        </span>
      </div>
    </div>
  );
};

/** look-22 / shot 2: cash-register — sales notifications + animated POS total counting up */
const Look22CashRegister: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, durationFrames, fps, tokens }) => {
  const pal = resolvePaletteG(tokens, {
    bg: '#09111E',
    bg2: '#132238',
    surface: '#162033',
    fg: '#F8FAFC',
    muted: '#94A3B8',
    accent: '#10B981',
    accent2: '#F59E0B',
    border: '#334155',
  });
  const txt = sceneTexts(scene);
  const metric = extractPrimaryMetricG(scene, sceneIndex, 48500);
  const pts = extractShortPointsG(scene, 4);

  const countP = easeOutCubic(clamp01((localFrame - 6) / Math.max(24, durationFrames * 0.58)));
  const currentTotal = Math.round(metric.numeric * countP);
  const posSpring = spring({ frame: localFrame, fps, config: { damping: 15, stiffness: 130 } });
  const receiptSlide = easeOutCubic(clamp01((localFrame - 10) / 28));

  const salesRows = [0, 1, 2, 3].map((i) => {
    const st = FICTIONAL_STORES[(i + sceneIndex) % FICTIONAL_STORES.length];
    return {
      label: shortTextG(pts[i] || `${st.name} · ${st.tag}`, 34),
      amount: st.amount,
      color: st.color,
      store: st.name,
    };
  });

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <NotifBackdrop localFrame={localFrame} pal={pal} glowColor="#10B981" glowY={480} />

      {/* Top Title */}
      <div
        style={{
          position: 'absolute',
          top: 64,
          left: 64,
          right: 64,
          textAlign: 'center',
          opacity: appear(localFrame, 2, 12),
        }}
      >
        <div
          style={{
            display: 'inline-block',
            padding: '6px 20px',
            borderRadius: 99,
            background: 'rgba(16,185,129,0.16)',
            border: '1.5px solid #10B981',
            fontFamily: FONT_THAI,
            fontSize: 22,
            fontWeight: 700,
            color: '#6EE7B7',
            marginBottom: 12,
          }}
        >
          {shortTextG(txt.badge || 'ยอดเงินเข้าแบบเรียลไทม์', 28)}
        </div>
        <FitText text={txt.title || 'เครื่องคิดเงินเด้งยอดขายรัวๆ'} baseSize={50} minSize={30} maxLines={2} color="#F8FAFC" />
      </div>

      {/* Digital POS Cash Register Terminal (y: 256..772) */}
      <div
        style={{
          position: 'absolute',
          top: 256,
          left: 84,
          right: 84,
          transform: `translateY(${((1 - posSpring) * 48).toFixed(1)}px) scale(${(0.94 + posSpring * 0.06).toFixed(4)})`,
        }}
      >
        {/* Thermal Receipt Ribbon Emerging Above Terminal */}
        <div
          style={{
            width: 440,
            margin: '0 auto -14px',
            background: '#F8FAFC',
            borderRadius: '14px 14px 0 0',
            padding: '16px 24px 24px',
            boxShadow: '0 -10px 28px rgba(0,0,0,0.35)',
            transform: `translateY(${((1 - receiptSlide) * 60).toFixed(1)}px)`,
            opacity: receiptSlide,
            border: '1px solid #CBD5E1',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px dashed #CBD5E1', paddingBottom: 8, marginBottom: 8 }}>
            <span style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 800, color: '#0F172A' }}>POS RECEIPT #22</span>
            <span style={{ fontFamily: FONT_THAI, fontSize: 18, fontWeight: 700, color: '#059669' }}>อนุมัติแล้ว ✓</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: FONT_THAI, fontSize: 20, fontWeight: 700, color: '#334155' }}>
            <span>{shortTextG(metric.unit || 'ยอดสุทธิวันนี้', 20)}</span>
            <span style={{ fontFamily: FONT_MONO, color: '#059669' }}>{metric.delta}</span>
          </div>
        </div>

        {/* Anodized Terminal Body */}
        <div
          style={{
            borderRadius: 34,
            background: 'linear-gradient(160deg, #334155 0%, #1E293B 45%, #0F172A 100%)',
            padding: 24,
            border: '2px solid rgba(148,163,184,0.35)',
            boxShadow: '0 32px 68px rgba(0,0,0,0.58)',
            position: 'relative',
            zIndex: 2,
          }}
        >
          {/* LED Display Screen */}
          <div
            style={{
              borderRadius: 22,
              background: 'linear-gradient(180deg, #022C22 0%, #052E16 100%)',
              border: '3px solid #065F46',
              padding: '26px 32px',
              boxShadow: 'inset 0 8px 24px rgba(0,0,0,0.65), 0 0 36px rgba(16,185,129,0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 99,
                    background: '#34D399',
                    boxShadow: '0 0 14px #34D399',
                    opacity: 0.55 + 0.45 * Math.sin(localFrame * 0.25),
                  }}
                />
                <span style={{ fontFamily: FONT_MONO, fontSize: 21, fontWeight: 800, color: '#6EE7B7', letterSpacing: 1.5 }}>
                  TOTAL REVENUE · LIVE
                </span>
              </div>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 22,
                  fontWeight: 800,
                  color: '#022C22',
                  background: '#34D399',
                  padding: '4px 14px',
                  borderRadius: 99,
                }}
              >
                {metric.delta}
              </span>
            </div>

            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 94,
                fontWeight: 900,
                color: '#6EE7B7',
                textAlign: 'right',
                letterSpacing: -2,
                textShadow: '0 0 26px rgba(52,211,153,0.45)',
                lineHeight: 1.05,
              }}
            >
              {metric.prefix || '฿'}
              {formatNumG(currentTotal)}
              {metric.suffix && !metric.suffix.includes('฿') && metric.suffix.length <= 4 ? metric.suffix : ''}
            </div>
          </div>

          {/* Terminal Keypad Strip */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, padding: '0 8px' }}>
            <div style={{ display: 'flex', gap: 10 }}>
              {['PAY', 'QR', 'CARD', 'AUTO'].map((k, idx) => (
                <div
                  key={k}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 10,
                    background: idx === 0 ? '#10B981' : '#0F172A',
                    border: '1px solid #475569',
                    fontFamily: FONT_MONO,
                    fontSize: 18,
                    fontWeight: 800,
                    color: idx === 0 ? '#022C22' : '#94A3B8',
                  }}
                >
                  {k}
                </div>
              ))}
            </div>
            <span style={{ fontFamily: FONT_THAI, fontSize: 22, fontWeight: 700, color: '#CBD5E1' }}>
              {shortTextG(txt.subtitle || 'รับยอดอัตโนมัติ', 24)}
            </span>
          </div>
        </div>
      </div>

      {/* Floating +฿ Coin Particles SVG */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {[0, 1, 2, 3, 4].map((i) => {
          const p = clamp01(((localFrame + i * 14) % 56) / 56);
          const x = 150 + i * 195 + Math.sin(p * 6 + i) * 18;
          const y = 780 - p * 180;
          const op = Math.sin(p * Math.PI) * 0.75;
          return (
            <g key={i} opacity={op}>
              <circle cx={x} cy={y} r={18} fill="#10B981" fillOpacity={0.22} stroke="#34D399" strokeWidth={2} />
              <text x={x} y={y + 7} textAnchor="middle" fill="#6EE7B7" fontSize="20" fontWeight="900" fontFamily={FONT_MONO}>
                ฿
              </text>
            </g>
          );
        })}
      </svg>

      {/* Incoming Sales Alert Cards (y: 816..1476) */}
      <div
        style={{
          position: 'absolute',
          top: 818,
          left: 84,
          right: 84,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        {salesRows.map((row, idx) => {
          const d = 12 + idx * 10;
          const sp = spring({ frame: Math.max(0, localFrame - d), fps, config: { damping: 14, stiffness: 170 } });
          const op = clamp01((localFrame - d) / 7);
          return (
            <div
              key={idx}
              style={{
                opacity: op,
                transform: `translateX(${((1 - sp) * (idx % 2 === 0 ? -56 : 56)).toFixed(1)}px) scale(${(0.94 + sp * 0.06).toFixed(4)})`,
                borderRadius: 22,
                background: 'rgba(22, 32, 51, 0.92)',
                border: `1.5px solid ${idx === 0 ? '#10B981' : '#334155'}`,
                padding: '18px 24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                boxShadow: '0 14px 28px rgba(0,0,0,0.35)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1, minWidth: 0 }}>
                <NotifAppIconSvg kind={1} color={row.color} size={48} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: FONT_THAI, fontSize: 19, fontWeight: 700, color: '#94A3B8', marginBottom: 2 }}>
                    {row.store} · เงินเข้าสำเร็จ
                  </div>
                  <FitText text={row.label} baseSize={26} minSize={20} maxLines={1} color="#F8FAFC" fontWeight={700} align="left" />
                </div>
              </div>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 30,
                  fontWeight: 900,
                  color: '#34D399',
                  background: 'rgba(16,185,129,0.14)',
                  border: '1px solid rgba(52,211,153,0.4)',
                  padding: '8px 18px',
                  borderRadius: 14,
                  flexShrink: 0,
                }}
              >
                +{row.amount}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** look-22 / shot 3: wrist-buzz — smartwatch vibrating with a concise notification */
const Look22WristBuzz: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const pal = resolvePaletteG(tokens, {
    bg: '#0B1120',
    bg2: '#172554',
    surface: '#162033',
    fg: '#F8FAFC',
    muted: '#94A3B8',
    accent: '#06B6D4',
    accent2: '#10B981',
    border: '#334155',
  });
  const txt = sceneTexts(scene);
  const pts = extractShortPointsG(scene, 2);
  const metric = extractPrimaryMetricG(scene, sceneIndex, 12);

  // Damped haptic vibration burst at frames 12..34 and subtle repeat at 52..66
  const buzz1 = localFrame >= 12 && localFrame <= 36 ? Math.sin((localFrame - 12) * 1.9) * Math.exp(-(localFrame - 12) * 0.1) * 10 : 0;
  const buzz2 = localFrame >= 52 && localFrame <= 72 ? Math.sin((localFrame - 52) * 1.9) * Math.exp(-(localFrame - 52) * 0.12) * 7 : 0;
  const buzzX = buzz1 + buzz2;
  const buzzRot = (buzz1 + buzz2) * 0.25;

  const watchPop = spring({ frame: localFrame, fps, config: { damping: 14, stiffness: 120 } });
  const cardPop = spring({ frame: Math.max(0, localFrame - 12), fps, config: { damping: 13, stiffness: 180 } });
  const wavePhase = (localFrame * 0.08) % 1;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <NotifBackdrop localFrame={localFrame} pal={pal} glowColor="#06B6D4" glowY={780} />

      {/* Top Context Pill */}
      <div
        style={{
          position: 'absolute',
          top: 66,
          left: 64,
          right: 64,
          textAlign: 'center',
          opacity: appear(localFrame, 2, 12),
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 22px',
            borderRadius: 99,
            background: 'rgba(6,182,212,0.16)',
            border: '1.5px solid #22D3EE',
            fontFamily: FONT_THAI,
            fontSize: 23,
            fontWeight: 700,
            color: '#67E8F9',
          }}
        >
          <span>⚡</span>
          <span>{shortTextG(txt.badge || 'แจ้งเตือนด่วนบนข้อมือ', 30)}</span>
        </div>
      </div>

      {/* Haptic Vibration Arcs (SVG behind Watch) */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0 }}>
        {[0, 1, 2].map((ring) => {
          const p = (wavePhase + ring * 0.33) % 1;
          const op = (1 - p) * 0.65;
          const dx = 285 + p * 145;
          return (
            <g key={ring} opacity={op}>
              <path
                d={`M ${540 - dx} 610 Q ${540 - dx - 52} 775 ${540 - dx} 940`}
                fill="none"
                stroke="#22D3EE"
                strokeWidth={5 - ring}
                strokeLinecap="round"
              />
              <path
                d={`M ${540 + dx} 610 Q ${540 + dx + 52} 775 ${540 + dx} 940`}
                fill="none"
                stroke="#22D3EE"
                strokeWidth={5 - ring}
                strokeLinecap="round"
              />
            </g>
          );
        })}
      </svg>

      {/* Smartwatch Assembly (centered around y: 775) */}
      <div
        style={{
          position: 'absolute',
          top: 196,
          left: 240,
          width: 600,
          height: 1120,
          transform: `translateX(${buzzX.toFixed(1)}px) rotate(${buzzRot.toFixed(2)}deg) scale(${(0.88 + watchPop * 0.12).toFixed(4)})`,
          transformOrigin: '50% 50%',
        }}
      >
        {/* Top & Bottom Silicone Watch Straps (SVG) */}
        <svg width={600} height={1120} viewBox="0 0 600 1120" style={{ position: 'absolute', inset: 0 }}>
          <defs>
            <linearGradient id="strapGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#1E293B" />
              <stop offset="50%" stopColor="#334155" />
              <stop offset="100%" stopColor="#0F172A" />
            </linearGradient>
          </defs>
          {/* Upper Strap */}
          <path d="M 165 20 L 435 20 L 455 280 L 145 280 Z" rx={24} fill="url(#strapGrad)" stroke="#475569" strokeWidth="3" />
          {[75, 130, 185].map((y) => (
            <rect key={y} x="276" y={y} width="48" height="14" rx="7" fill="#0B1120" />
          ))}
          {/* Lower Strap */}
          <path d="M 145 840 L 455 840 L 435 1100 L 165 1100 Z" fill="url(#strapGrad)" stroke="#475569" strokeWidth="3" />
          {[915, 970, 1025].map((y) => (
            <rect key={y} x="276" y={y} width="48" height="14" rx="7" fill="#0B1120" />
          ))}
          {/* Digital Crown & Side Button */}
          <rect x="546" y="425" width="32" height="96" rx="12" fill="#64748B" stroke="#94A3B8" strokeWidth="3" />
          <rect x="546" y="575" width="20" height="118" rx="8" fill="#475569" stroke="#94A3B8" strokeWidth="2" />
        </svg>

        {/* Titanium Watch Case */}
        <div
          style={{
            position: 'absolute',
            top: 256,
            left: 52,
            width: 496,
            height: 608,
            borderRadius: 112,
            background: 'linear-gradient(145deg, #64748B 0%, #1E293B 45%, #0F172A 100%)',
            padding: 20,
            boxShadow: '0 36px 80px rgba(0,0,0,0.65), 0 0 0 2px rgba(148,163,184,0.4)',
          }}
        >
          {/* OLED Watch Screen */}
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: 94,
              background: 'radial-gradient(circle at 50% 25%, #0F2942 0%, #020617 78%)',
              padding: '34px 32px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {/* Top Watch Time + Status */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: 22, fontWeight: 700, color: '#22D3EE' }}>● LIVE</span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 26, fontWeight: 800, color: '#E2E8F0' }}>09:41</span>
            </div>

            {/* Notification Alert Card inside Watch */}
            <div
              style={{
                transform: `scale(${(0.84 + cardPop * 0.16).toFixed(4)})`,
                opacity: clamp01((localFrame - 10) / 8),
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 16,
              }}
            >
              <NotifAppIconSvg kind={3} color="#06B6D4" size={68} />
              <div style={{ fontFamily: FONT_THAI, fontSize: 21, fontWeight: 700, color: '#67E8F9', letterSpacing: 0.5 }}>
                แจ้งเตือนสำคัญ · {metric.big}
              </div>
              <FitText
                text={txt.title || pts[0] || 'ข้อความสั้นที่ต้องรีบเช็ก'}
                baseSize={38}
                minSize={25}
                maxLines={3}
                color="#FFFFFF"
                lineHeight={1.24}
              />
              {txt.subtitle ? (
                <FitText text={shortTextG(txt.subtitle, 46)} baseSize={23} minSize={18} maxLines={2} color="#CBD5E1" fontWeight={600} />
              ) : null}
            </div>

            {/* Watch Action Pill */}
            <div
              style={{
                borderRadius: 99,
                background: 'linear-gradient(90deg, #06B6D4, #10B981)',
                padding: '14px 20px',
                textAlign: 'center',
                fontFamily: FONT_THAI,
                fontSize: 24,
                fontWeight: 800,
                color: '#022C22',
                boxShadow: '0 8px 22px rgba(6,182,212,0.35)',
              }}
            >
              แตะเพื่อดูทันที
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Summary Strip above SAFE_BOTTOM (y: 1368..1492) */}
      <div
        style={{
          position: 'absolute',
          top: 1368,
          left: 80,
          right: 80,
          display: 'flex',
          gap: 16,
          opacity: appear(localFrame, 20, 14),
        }}
      >
        {(pts.length > 0 ? pts : [txt.subtitle || 'รับรู้ทุกความเคลื่อนไหวในเสี้ยววินาที']).slice(0, 2).map((pt, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              borderRadius: 20,
              background: 'rgba(15,23,42,0.88)',
              border: '1.5px solid rgba(34,211,238,0.35)',
              padding: '16px 20px',
            }}
          >
            <FitText text={shortTextG(pt, 48)} baseSize={24} minSize={19} maxLines={2} color="#E2E8F0" fontWeight={700} align="center" />
          </div>
        ))}
      </div>
    </div>
  );
};

/** look-22 / shot 4: dashboard-ping — desktop sales dashboard with live toast pings */
const Look22DashboardPing: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, durationFrames, fps, tokens }) => {
  const pal = resolvePaletteG(tokens, {
    bg: '#0A0F1E',
    bg2: '#162033',
    surface: '#111827',
    fg: '#F8FAFC',
    muted: '#94A3B8',
    accent: '#10B981',
    accent2: '#38BDF8',
    border: '#334155',
  });
  const txt = sceneTexts(scene);
  const metric = extractPrimaryMetricG(scene, sceneIndex, 18420);
  const pts = extractShortPointsG(scene, 4);

  const chartDraw = easeOutCubic(clamp01((localFrame - 6) / Math.max(20, durationFrames * 0.48)));
  const dashIn = spring({ frame: localFrame, fps, config: { damping: 16, stiffness: 120 } });

  const chartPts = [
    [30, 230],
    [125, 210],
    [220, 224],
    [315, 168],
    [410, 142],
    [505, 108],
    [600, 74],
    [695, 42],
  ];
  const linePath = chartPts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
  const areaPath = `${linePath} L 695 256 L 30 256 Z`;
  const totalLen = 820;

  const toasts = [0, 1, 2].map((i) => {
    const st = FICTIONAL_STORES[(i + sceneIndex) % FICTIONAL_STORES.length];
    return {
      title: st.name,
      tag: st.tag,
      amount: st.amount,
      color: st.color,
      text: shortTextG(pts[i] || `${st.tag}เข้ามาใหม่ ${st.amount}`, 42),
    };
  });

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <NotifBackdrop localFrame={localFrame} pal={pal} glowColor="#38BDF8" glowY={560} />

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 62,
          left: 60,
          right: 60,
          opacity: appear(localFrame, 2, 12),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 18px',
              borderRadius: 99,
              background: 'rgba(56,189,248,0.16)',
              border: '1.5px solid #38BDF8',
              fontFamily: FONT_MONO,
              fontSize: 20,
              fontWeight: 800,
              color: '#7DD3FC',
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 99, background: '#10B981' }} />
            DASHBOARD LIVE FEED
          </div>
          <span style={{ fontFamily: FONT_THAI, fontSize: 22, fontWeight: 700, color: '#94A3B8' }}>
            {shortTextG(txt.badge || 'อัปเดตสด', 22)}
          </span>
        </div>
        <FitText text={txt.title || 'แดชบอร์ดยอดขายเด้งแจ้งเตือนสด'} baseSize={48} minSize={30} maxLines={2} color="#F8FAFC" align="left" />
      </div>

      {/* Desktop Monitor Window (y: 256..1180) */}
      <div
        style={{
          position: 'absolute',
          top: 256,
          left: 48,
          right: 48,
          height: 890,
          borderRadius: 28,
          background: '#0F172A',
          border: '2px solid #334155',
          boxShadow: '0 36px 84px rgba(0,0,0,0.62)',
          overflow: 'hidden',
          transform: `translateY(${((1 - dashIn) * 44).toFixed(1)}px) scale(${(0.95 + dashIn * 0.05).toFixed(4)})`,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Window Chrome */}
        <div
          style={{
            height: 58,
            background: '#1E293B',
            borderBottom: '1.5px solid #334155',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
          }}
        >
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ width: 14, height: 14, borderRadius: 99, background: '#EF4444' }} />
            <div style={{ width: 14, height: 14, borderRadius: 99, background: '#F59E0B' }} />
            <div style={{ width: 14, height: 14, borderRadius: 99, background: '#10B981' }} />
          </div>
          <div style={{ padding: '6px 26px', borderRadius: 10, background: '#0F172A', fontFamily: FONT_MONO, fontSize: 18, color: '#94A3B8' }}>
            analytics.store.local/live-orders
          </div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 800, color: '#34D399' }}>● SYNC</div>
        </div>

        {/* Dashboard Body */}
        <div style={{ flex: 1, padding: 26, position: 'relative', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {/* 3 KPI Cards */}
          <div style={{ display: 'flex', gap: 16 }}>
            {[
              { label: shortTextG(metric.unit || 'ยอดรวมวันนี้', 16), val: `${metric.prefix}${metric.big}`, sub: metric.delta, col: '#10B981' },
              { label: 'ออเดอร์ใหม่', val: `+${14 + Math.round(chartDraw * 28)}`, sub: 'กำลังไหลเข้า', col: '#38BDF8' },
              { label: 'อัตราปิดการขาย', val: '94.2%', sub: 'สูงกว่าค่าเฉลี่ย', col: '#F59E0B' },
            ].map((kpi, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  borderRadius: 18,
                  background: '#162033',
                  border: '1.5px solid #293548',
                  padding: '16px 20px',
                }}
              >
                <div style={{ fontFamily: FONT_THAI, fontSize: 19, fontWeight: 700, color: '#94A3B8' }}>{kpi.label}</div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 38, fontWeight: 900, color: kpi.col, marginTop: 4 }}>{kpi.val}</div>
                <div style={{ fontFamily: FONT_THAI, fontSize: 18, fontWeight: 600, color: '#CBD5E1', marginTop: 2 }}>{kpi.sub}</div>
              </div>
            ))}
          </div>

          {/* Live Revenue Sparkline Chart */}
          <div
            style={{
              borderRadius: 20,
              background: '#131C2E',
              border: '1.5px solid #293548',
              padding: '18px 22px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontFamily: FONT_THAI, fontSize: 22, fontWeight: 700, color: '#E2E8F0' }}>กราฟยอดเข้าแบบเรียลไทม์</span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 19, color: '#38BDF8' }}>24H STREAM</span>
            </div>
            <svg width={880} height={268} viewBox="0 0 740 268" style={{ width: '100%', height: 248 }}>
              <defs>
                <linearGradient id="dashArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10B981" stopOpacity="0.38" />
                  <stop offset="100%" stopColor="#10B981" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {[50, 115, 180, 245].map((y) => (
                <line key={y} x1="20" y1={y} x2="720" y2={y} stroke="#1E293B" strokeWidth="2" />
              ))}
              <path d={areaPath} fill="url(#dashArea)" opacity={chartDraw} />
              <path
                d={linePath}
                fill="none"
                stroke="#10B981"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={totalLen}
                strokeDashoffset={totalLen * (1 - chartDraw)}
              />
              {chartDraw > 0.85 && (
                <>
                  <circle cx={695} cy={42} r={14} fill="#10B981" opacity={0.28 + 0.2 * Math.sin(localFrame * 0.25)} />
                  <circle cx={695} cy={42} r={7} fill="#6EE7B7" stroke="#022C22" strokeWidth={2.5} />
                </>
              )}
            </svg>
          </div>

          {/* Floating Toast Pings sliding from right */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {toasts.map((toast, idx) => {
              const d = 14 + idx * 12;
              const sp = spring({ frame: Math.max(0, localFrame - d), fps, config: { damping: 14, stiffness: 175 } });
              const op = clamp01((localFrame - d) / 6);
              const barPct = clamp01(1 - Math.max(0, localFrame - d) / 90) * 100;
              return (
                <div
                  key={idx}
                  style={{
                    opacity: op,
                    transform: `translateX(${((1 - sp) * 140).toFixed(1)}px)`,
                    borderRadius: 18,
                    background: 'rgba(30, 41, 59, 0.96)',
                    border: `1.5px solid ${toast.color}99`,
                    padding: '14px 20px',
                    position: 'relative',
                    overflow: 'hidden',
                    boxShadow: `0 12px 26px rgba(0,0,0,0.45), 0 0 18px ${toast.color}22`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 14,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
                    <NotifAppIconSvg kind={idx} color={toast.color} size={42} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontFamily: FONT_THAI, fontSize: 21, fontWeight: 800, color: '#F8FAFC' }}>{toast.title}</span>
                        <span style={{ fontFamily: FONT_THAI, fontSize: 17, fontWeight: 700, color: toast.color }}>{toast.tag}</span>
                      </div>
                      <FitText text={toast.text} baseSize={22} minSize={18} maxLines={1} color="#CBD5E1" fontWeight={600} align="left" />
                    </div>
                  </div>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 24, fontWeight: 900, color: '#34D399', flexShrink: 0 }}>{toast.amount}</span>
                  {/* Countdown Progress Strip */}
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      bottom: 0,
                      height: 4,
                      width: `${barPct.toFixed(1)}%`,
                      background: toast.color,
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Monitor Stand + Bottom Takeaway above SAFE_BOTTOM (y: 1146..1490) */}
      <svg width={STAGE_W} height={110} viewBox="0 0 1080 110" style={{ position: 'absolute', top: 1146, left: 0 }}>
        <rect x="470" y="0" width="140" height="58" fill="#1E293B" stroke="#334155" strokeWidth="2" />
        <rect x="350" y="56" width="380" height="22" rx="11" fill="#334155" stroke="#475569" strokeWidth="2" />
      </svg>
      <div
        style={{
          position: 'absolute',
          top: 1264,
          left: 64,
          right: 64,
          borderRadius: 22,
          background: 'rgba(15,23,42,0.9)',
          border: '1.5px solid #334155',
          padding: '22px 28px',
          opacity: appear(localFrame, 24, 14),
        }}
      >
        <FitText
          text={txt.subtitle || pts[3] || 'ทุกการแจ้งเตือนรวมไว้บนหน้าจอเดียว ตรวจสอบได้ทันที'}
          baseSize={28}
          minSize={22}
          maxLines={2}
          color="#E2E8F0"
          fontWeight={700}
        />
      </div>
    </div>
  );
};

// ============================================================================
// STYLE 2: look-23 — BEFORE AND AFTER SLIDER (สไลเดอร์ก่อน-หลัง)
// ============================================================================

const SliderStudioBackdrop: React.FC<{ pal: PaletteG }> = ({ pal }) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      background: `radial-gradient(circle at 25% 22%, rgba(244,63,94,0.14) 0%, transparent 45%), radial-gradient(circle at 78% 30%, rgba(16,185,129,0.16) 0%, transparent 48%), linear-gradient(180deg, ${pal.bg2} 0%, ${pal.bg} 100%)`,
    }}
  >
    <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0, opacity: 0.16 }}>
      <defs>
        <pattern id="g23Ticks" width="60" height="60" patternUnits="userSpaceOnUse">
          <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#475569" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={STAGE_W} height={STAGE_H} fill="url(#g23Ticks)" />
    </svg>
  </div>
);

/** look-23 / shot 1: split-slider — sweeping vertical divider line comparing before (left) vs after (right) */
const Look23SplitSlider: React.FC<StyleShotArgs> = ({ scene, localFrame, durationFrames, fps, tokens }) => {
  const pal = resolvePaletteG(tokens, {
    bg: '#0F172A',
    bg2: '#1E293B',
    surface: '#162033',
    fg: '#F8FAFC',
    muted: '#94A3B8',
    accent: '#10B981',
    accent2: '#F43F5E',
    border: '#334155',
  });
  const txt = sceneTexts(scene);
  const pair = extractBeforeAfterG(scene);

  // Sweeping divider: starts at 78%, glides left to 22%, settles smoothly at 50%
  const tNorm = clamp01(localFrame / Math.max(36, durationFrames * 0.72));
  let splitPct = 50;
  if (tNorm < 0.35) {
    splitPct = interpolate(easeOutCubic(tNorm / 0.35), [0, 1], [78, 22]);
  } else if (tNorm < 0.75) {
    splitPct = interpolate(easeOutCubic((tNorm - 0.35) / 0.4), [0, 1], [22, 50]);
  } else {
    splitPct = 50 + Math.sin((localFrame - durationFrames * 0.5) * 0.08) * 2.2;
  }

  const headerP = appear(localFrame, 2, 12);
  const frameSpring = spring({ frame: localFrame, fps, config: { damping: 16, stiffness: 125 } });
  const stageW = 960;
  const dividerX = (splitPct / 100) * stageW;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <SliderStudioBackdrop pal={pal} />

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 62,
          left: 60,
          right: 60,
          textAlign: 'center',
          opacity: headerP,
          transform: `translateY(${((1 - headerP) * -16).toFixed(1)}px)`,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            padding: '7px 22px',
            borderRadius: 99,
            background: 'rgba(238,241,246,0.12)',
            border: '1.5px solid rgba(238,241,246,0.35)',
            fontFamily: FONT_THAI,
            fontSize: 22,
            fontWeight: 700,
            color: '#E2E8F0',
            marginBottom: 12,
          }}
        >
          <span style={{ color: '#FDA4AF' }}>ก่อน</span>
          <span>⇄</span>
          <span style={{ color: '#6EE7B7' }}>หลัง</span>
          <span>· {shortTextG(txt.badge || 'เปรียบเทียบชัดเจน', 22)}</span>
        </div>
        <FitText text={txt.title || 'เปรียบเทียบก่อนและหลังในภาพเดียว'} baseSize={48} minSize={30} maxLines={2} color="#F8FAFC" />
      </div>

      {/* Main Split Comparison Viewport (y: 266..1326) */}
      <div
        style={{
          position: 'absolute',
          top: 266,
          left: 60,
          width: stageW,
          height: 1060,
          borderRadius: 34,
          overflow: 'hidden',
          border: '2px solid #475569',
          boxShadow: '0 36px 84px rgba(0,0,0,0.58)',
          transform: `scale(${(0.95 + frameSpring * 0.05).toFixed(4)})`,
        }}
      >
        {/* UNDERLAY: AFTER SIDE (Right / Full Canvas revealed to the right of divider) */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(155deg, #064E3B 0%, #0F2942 52%, #0F172A 100%)',
            padding: '38px 34px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div
              style={{
                padding: '10px 24px',
                borderRadius: 99,
                background: 'rgba(16,185,129,0.22)',
                border: '2px solid #34D399',
                fontFamily: FONT_THAI,
                fontSize: 25,
                fontWeight: 800,
                color: '#6EE7B7',
              }}
            >
              ✓ {shortTextG(pair.rightTitle, 20)}
            </div>
          </div>

          {/* Right-aligned AFTER cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22, paddingLeft: 480 }}>
            {pair.rightItems.slice(0, 4).map((item, i) => {
              const p = stagger(i, localFrame, 6, 8, 14);
              return (
                <div
                  key={i}
                  style={{
                    opacity: p,
                    transform: `translateX(${((1 - p) * 28).toFixed(1)}px)`,
                    borderRadius: 22,
                    background: 'rgba(6, 78, 59, 0.52)',
                    border: '1.5px solid rgba(52, 211, 153, 0.55)',
                    padding: '22px 24px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 16,
                    boxShadow: '0 14px 28px rgba(0,0,0,0.28)',
                  }}
                >
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 99,
                      background: '#10B981',
                      color: '#022C22',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 22,
                      fontWeight: 900,
                      flexShrink: 0,
                      marginTop: 2,
                    }}
                  >
                    ✓
                  </div>
                  <FitText text={shortTextG(item, 68)} baseSize={27} minSize={20} maxLines={3} color="#ECFDF5" fontWeight={700} align="left" />
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 20, fontWeight: 700, color: '#6EE7B7', letterSpacing: 1.5 }}>
              AFTER · OPTIMIZED STATE
            </div>
          </div>
        </div>

        {/* OVERLAY: BEFORE SIDE clipped to 0..splitPct% */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            clipPath: `inset(0 ${(100 - splitPct).toFixed(2)}% 0 0)`,
            background: 'linear-gradient(155deg, #2A1624 0%, #1E1B2E 52%, #111827 100%)',
            padding: '38px 34px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div
              style={{
                padding: '10px 24px',
                borderRadius: 99,
                background: 'rgba(244,63,94,0.2)',
                border: '2px solid #FB7185',
                fontFamily: FONT_THAI,
                fontSize: 25,
                fontWeight: 800,
                color: '#FDA4AF',
              }}
            >
              ✕ {shortTextG(pair.leftTitle, 20)}
            </div>
          </div>

          {/* Left-aligned BEFORE cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22, paddingRight: 480 }}>
            {pair.leftItems.slice(0, 4).map((item, i) => {
              const p = stagger(i, localFrame, 6, 4, 14);
              return (
                <div
                  key={i}
                  style={{
                    opacity: p,
                    transform: `translateX(${((1 - p) * -28).toFixed(1)}px)`,
                    borderRadius: 22,
                    background: 'rgba(51, 24, 40, 0.65)',
                    border: '1.5px solid rgba(251, 113, 133, 0.45)',
                    padding: '22px 24px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 16,
                    boxShadow: '0 14px 28px rgba(0,0,0,0.32)',
                  }}
                >
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 99,
                      background: 'rgba(244,63,94,0.28)',
                      border: '2px solid #FB7185',
                      color: '#FDA4AF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 20,
                      fontWeight: 900,
                      flexShrink: 0,
                      marginTop: 2,
                    }}
                  >
                    ✕
                  </div>
                  <FitText text={shortTextG(item, 68)} baseSize={27} minSize={20} maxLines={3} color="#FFE4E6" fontWeight={700} align="left" />
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 20, fontWeight: 700, color: '#FDA4AF', letterSpacing: 1.5 }}>
              BEFORE · OLD STATE
            </div>
          </div>
        </div>

        {/* Vertical Glowing Divider Line + Draggable Knob Handle */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${dividerX.toFixed(1)}px`,
            width: 6,
            marginLeft: -3,
            background: '#FFFFFF',
            boxShadow: '0 0 24px rgba(255,255,255,0.85), 0 0 8px rgba(16,185,129,0.6)',
            zIndex: 10,
          }}
        >
          {/* Ruler ticks along divider */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 84,
              height: 84,
              borderRadius: 99,
              background: '#FFFFFF',
              border: '4px solid #0F172A',
              boxShadow: '0 14px 36px rgba(0,0,0,0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width={44} height={28} viewBox="0 0 44 28" fill="none">
              <path d="M15 5 L5 14 L15 23" stroke="#0F172A" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M29 5 L39 14 L29 23" stroke="#0F172A" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </div>

      {/* Bottom Summary Bar above SAFE_BOTTOM (y: 1364..1484) */}
      <div
        style={{
          position: 'absolute',
          top: 1364,
          left: 60,
          right: 60,
          borderRadius: 22,
          background: 'rgba(15,23,42,0.9)',
          border: '1.5px solid #334155',
          padding: '20px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          opacity: appear(localFrame, 16, 14),
        }}
      >
        <FitText
          text={txt.subtitle || 'เลื่อนเทียบความต่างให้เห็นชัดเจนในเฟรมเดียว'}
          baseSize={27}
          minSize={20}
          maxLines={2}
          color="#E2E8F0"
          fontWeight={700}
          align="left"
        />
        <span style={{ fontFamily: FONT_MONO, fontSize: 24, fontWeight: 900, color: '#34D399', marginLeft: 20, flexShrink: 0 }}>
          {Math.round(splitPct)}%
        </span>
      </div>
    </div>
  );
};

/** look-23 / shot 2: room-makeover — SVG room transforming from messy to tidy via animated wipe */
const Look23RoomMakeover: React.FC<StyleShotArgs> = ({ scene, localFrame, durationFrames, tokens }) => {
  const pal = resolvePaletteG(tokens, {
    bg: '#0F172A',
    bg2: '#1E293B',
    surface: '#162033',
    fg: '#F8FAFC',
    muted: '#94A3B8',
    accent: '#10B981',
    accent2: '#F59E0B',
    border: '#334155',
  });
  const txt = sceneTexts(scene);
  const pair = extractBeforeAfterG(scene);

  // Wipe reveals tidy room from left->right (starts 15% -> sweeps to 86%)
  const wipeP = easeOutCubic(clamp01((localFrame - 10) / Math.max(28, durationFrames * 0.56)));
  const revealPct = interpolate(wipeP, [0, 1], [14, 88]);
  const roomW = 960;
  const roomH = 660;
  const dividerX = (revealPct / 100) * roomW;

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <SliderStudioBackdrop pal={pal} />

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 62,
          left: 60,
          right: 60,
          textAlign: 'center',
          opacity: appear(localFrame, 2, 12),
        }}
      >
        <div
          style={{
            display: 'inline-block',
            padding: '6px 22px',
            borderRadius: 99,
            background: 'rgba(16,185,129,0.16)',
            border: '1.5px solid #34D399',
            fontFamily: FONT_THAI,
            fontSize: 22,
            fontWeight: 700,
            color: '#6EE7B7',
            marginBottom: 12,
          }}
        >
          {shortTextG(txt.badge || 'เปลี่ยนความวุ่นวายเป็นระเบียบ', 30)}
        </div>
        <FitText text={txt.title || 'จัดระบบใหม่ เห็นความต่างทันที'} baseSize={48} minSize={30} maxLines={2} color="#F8FAFC" />
      </div>

      {/* Room Makeover Illustrated Stage (y: 256..916) */}
      <div
        style={{
          position: 'absolute',
          top: 256,
          left: 60,
          width: roomW,
          height: roomH,
          borderRadius: 30,
          overflow: 'hidden',
          border: '2px solid #475569',
          boxShadow: '0 32px 76px rgba(0,0,0,0.58)',
        }}
      >
        {/* LAYER 1 (Underlay): MESSY ROOM (Before) */}
        <svg width={roomW} height={roomH} viewBox="0 0 960 660" style={{ position: 'absolute', inset: 0 }}>
          {/* Dim dusty wall & floor */}
          <rect width="960" height="440" fill="#2B212E" />
          <rect y="440" width="960" height="220" fill="#1F1822" />
          <line x1="0" y1="440" x2="960" y2="440" stroke="#473346" strokeWidth="4" />

          {/* Dim flickering lamp */}
          <line x1="480" y1="0" x2="480" y2="75" stroke="#64748B" strokeWidth="4" />
          <path d="M440 75 L520 75 L500 105 L460 105 Z" fill="#475569" />
          <polygon points="460,105 500,105 620,380 340,380" fill="#F43F5E" opacity={0.07 + 0.03 * Math.sin(localFrame * 0.5)} />

          {/* Crooked Wall Frame */}
          <g transform="translate(115, 110) rotate(-9)">
            <rect width="150" height="110" rx="6" fill="#3B2B3D" stroke="#9F1239" strokeWidth="5" />
            <path d="M25 80 L60 40 L95 70 L125 30" fill="none" stroke="#FDA4AF" strokeWidth="4" />
          </g>

          {/* Cluttered Sticky Notes on Wall */}
          {[
            [680, 120, -14, '#FB7185'],
            [745, 145, 11, '#FBBF24'],
            [710, 195, -7, '#F472B6'],
            [795, 175, 16, '#FB923C'],
          ].map(([x, y, rot, col], i) => (
            <rect key={i} x={Number(x)} y={Number(y)} width="48" height="48" rx="4" fill={String(col)} transform={`rotate(${rot} ${x} ${y})`} opacity="0.85" />
          ))}

          {/* Cluttered Desk */}
          <rect x="220" y="340" width="520" height="24" rx="6" fill="#4B3832" />
          <rect x="255" y="364" width="22" height="146" fill="#3B2A26" />
          <rect x="683" y="364" width="22" height="146" fill="#3B2A26" />

          {/* Crooked Monitor with Error X */}
          <g transform="translate(385, 195) rotate(4)">
            <rect width="190" height="122" rx="10" fill="#1E293B" stroke="#64748B" strokeWidth="5" />
            <rect x="12" y="12" width="166" height="98" rx="4" fill="#3F1D2E" />
            <path d="M76 42 L114 80 M114 42 L76 80" stroke="#FB7185" strokeWidth="7" strokeLinecap="round" />
            <rect x="80" y="122" width="30" height="24" fill="#475569" />
          </g>

          {/* Piles of Chaotic Papers & Spilled Mug */}
          <rect x="240" y="302" width="76" height="38" rx="3" fill="#CBD5E1" transform="rotate(-6 278 320)" />
          <rect x="252" y="286" width="72" height="22" rx="3" fill="#E2E8F0" transform="rotate(8 288 296)" />
          <rect x="615" y="305" width="70" height="35" rx="3" fill="#94A3B8" transform="rotate(9 650 322)" />
          {/* Spilled coffee */}
          <ellipse cx="628" cy="346" rx="36" ry="8" fill="#78350F" />
          <rect x="590" y="316" width="28" height="24" rx="5" fill="#E2E8F0" transform="rotate(72 604 328)" />

          {/* Tangled Cables under desk */}
          <path d="M310 365 C340 460, 420 420, 460 490 C500 540, 580 440, 650 510" fill="none" stroke="#94A3B8" strokeWidth="5" strokeDasharray="10 6" />
          <path d="M350 365 C390 490, 480 410, 560 495" fill="none" stroke="#FB7185" strokeWidth="4" />

          {/* Overflowing Trash Bin */}
          <polygon points="105,430 185,430 172,540 118,540" fill="#475569" stroke="#64748B" strokeWidth="3" />
          <circle cx="132" cy="422" r="18" fill="#CBD5E1" />
          <circle cx="158" cy="416" r="20" fill="#E2E8F0" />
          <circle cx="145" cy="400" r="14" fill="#94A3B8" />

          {/* Scattered Floor Papers */}
          <rect x="290" y="535" width="64" height="38" rx="3" fill="#CBD5E1" transform="rotate(-14 322 554)" />
          <rect x="520" y="555" width="70" height="40" rx="3" fill="#E2E8F0" transform="rotate(12 555 575)" />
          <rect x="760" y="510" width="62" height="36" rx="3" fill="#94A3B8" transform="rotate(-8 791 528)" />

          {/* Corner Badge */}
          <rect x="740" y="24" width="196" height="48" rx="24" fill="rgba(244,63,94,0.28)" stroke="#FB7185" strokeWidth="2" />
          <text x="838" y="56" textAnchor="middle" fill="#FFE4E6" fontSize="22" fontWeight="800" fontFamily={FONT_THAI}>
            ✕ ก่อนจัดระบบ
          </text>
        </svg>

        {/* LAYER 2 (Overlay): TIDY ROOM (After) clipped to revealPct */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            clipPath: `inset(0 ${(100 - revealPct).toFixed(2)}% 0 0)`,
          }}
        >
          <svg width={roomW} height={roomH} viewBox="0 0 960 660" style={{ position: 'absolute', inset: 0 }}>
            {/* Clean bright slate-teal wall & warm wood floor */}
            <defs>
              <linearGradient id="tidyWall" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0F2942" />
                <stop offset="100%" stopColor="#163A56" />
              </linearGradient>
              <linearGradient id="tidyFloor" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1E293B" />
                <stop offset="100%" stopColor="#0F172A" />
              </linearGradient>
            </defs>
            <rect width="960" height="440" fill="url(#tidyWall)" />
            <rect y="440" width="960" height="220" fill="url(#tidyFloor)" />
            <line x1="0" y1="440" x2="960" y2="440" stroke="#38BDF8" strokeWidth="3" strokeOpacity="0.45" />

            {/* Clean Pendant Light with Warm Glow */}
            <line x1="480" y1="0" x2="480" y2="68" stroke="#94A3B8" strokeWidth="4" />
            <path d="M435 68 L525 68 L508 98 L452 98 Z" fill="#10B981" />
            <polygon points="452,98 508,98 660,420 300,420" fill="#34D399" opacity="0.09" />

            {/* Straight Framed Art */}
            <rect x="110" y="108" width="154" height="112" rx="10" fill="#0F172A" stroke="#34D399" strokeWidth="4" />
            <circle cx="160" cy="152" r="22" fill="#10B981" opacity="0.85" />
            <path d="M130 196 L176 156 L210 184 L242 146" fill="none" stroke="#6EE7B7" strokeWidth="5" strokeLinecap="round" />

            {/* Neat Wall Shelf with Books */}
            <rect x="676" y="182" width="196" height="14" rx="5" fill="#334155" />
            <rect x="692" y="128" width="24" height="54" rx="4" fill="#38BDF8" />
            <rect x="720" y="136" width="22" height="46" rx="4" fill="#10B981" />
            <rect x="746" y="122" width="26" height="60" rx="4" fill="#F59E0B" />
            <rect x="776" y="138" width="22" height="44" rx="4" fill="#A78BFA" />
            <circle cx="836" cy="158" r="20" fill="#10B981" opacity="0.9" />

            {/* Clean Minimalist Desk */}
            <rect x="220" y="340" width="520" height="22" rx="8" fill="#E2E8F0" />
            <rect x="255" y="362" width="18" height="148" rx="4" fill="#94A3B8" />
            <rect x="687" y="362" width="18" height="148" rx="4" fill="#94A3B8" />

            {/* Centered Ultrawide Monitor with Success Check */}
            <rect x="355" y="182" width="250" height="132" rx="14" fill="#0F172A" stroke="#38BDF8" strokeWidth="4" />
            <rect x="368" y="195" width="224" height="106" rx="8" fill="#064E3B" />
            <circle cx="480" cy="248" r="30" fill="#10B981" />
            <path d="M466 248 L476 258 L496 238" fill="none" stroke="#022C22" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="464" y="314" width="32" height="26" fill="#94A3B8" />
            <rect x="430" y="334" width="100" height="8" rx="4" fill="#CBD5E1" />

            {/* Neat Keyboard & Notebook */}
            <rect x="255" y="324" width="76" height="16" rx="4" fill="#38BDF8" />
            <rect x="632" y="312" width="54" height="28" rx="6" fill="#10B981" />

            {/* Potted Monstera Plant on Left */}
            <polygon points="106,462 184,462 172,542 118,542" fill="#D97706" />
            <ellipse cx="145" cy="422" rx="34" ry="44" fill="#10B981" />
            <ellipse cx="116" cy="436" rx="22" ry="30" fill="#059669" transform="rotate(-24 116 436)" />
            <ellipse cx="174" cy="436" rx="22" ry="30" fill="#34D399" transform="rotate(24 174 436)" />

            {/* Clean Floor Rug */}
            <ellipse cx="480" cy="560" rx="240" ry="38" fill="#1E3A5F" stroke="#38BDF8" strokeWidth="2" strokeOpacity="0.4" />

            {/* Animated Sparkles */}
            {[
              [290, 145],
              [625, 130],
              [190, 340],
              [785, 360],
            ].map(([sx, sy], i) => {
              const s = 0.7 + 0.4 * Math.sin(localFrame * 0.16 + i * 1.4);
              return (
                <g key={i} transform={`translate(${sx} ${sy}) scale(${s.toFixed(2)})`}>
                  <path d="M0 -14 L3 -3 L14 0 L3 3 L0 14 L-3 3 L-14 0 L-3 -3 Z" fill="#6EE7B7" />
                </g>
              );
            })}

            {/* Corner Badge */}
            <rect x="24" y="24" width="196" height="48" rx="24" fill="rgba(16,185,129,0.28)" stroke="#34D399" strokeWidth="2" />
            <text x="122" y="56" textAnchor="middle" fill="#ECFDF5" fontSize="22" fontWeight="800" fontFamily={FONT_THAI}>
              ✓ หลังจัดระบบ
            </text>
          </svg>
        </div>

        {/* Glowing Sweep Line */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${dividerX.toFixed(1)}px`,
            width: 5,
            marginLeft: -2.5,
            background: '#6EE7B7',
            boxShadow: '0 0 22px #34D399',
          }}
        />
      </div>

      {/* Side-by-Side Before vs After Breakdown Cards (y: 952..1486) */}
      <div
        style={{
          position: 'absolute',
          top: 952,
          left: 60,
          right: 60,
          display: 'flex',
          gap: 24,
        }}
      >
        {/* Before Card */}
        <div
          style={{
            flex: 1,
            borderRadius: 26,
            background: 'rgba(42, 22, 36, 0.88)',
            border: '1.5px solid rgba(251, 113, 133, 0.45)',
            padding: '24px 26px',
            opacity: appear(localFrame, 8, 14),
          }}
        >
          <div style={{ fontFamily: FONT_THAI, fontSize: 24, fontWeight: 800, color: '#FDA4AF', marginBottom: 14 }}>
            ✕ {shortTextG(pair.leftTitle, 22)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {pair.leftItems.slice(0, 3).map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ color: '#FB7185', fontWeight: 900, fontSize: 22 }}>•</span>
                <FitText text={shortTextG(item, 54)} baseSize={25} minSize={19} maxLines={2} color="#FFE4E6" fontWeight={600} align="left" />
              </div>
            ))}
          </div>
        </div>

        {/* After Card */}
        <div
          style={{
            flex: 1,
            borderRadius: 26,
            background: 'rgba(6, 78, 59, 0.72)',
            border: '1.5px solid rgba(52, 211, 153, 0.55)',
            padding: '24px 26px',
            opacity: appear(localFrame, 16, 14),
          }}
        >
          <div style={{ fontFamily: FONT_THAI, fontSize: 24, fontWeight: 800, color: '#6EE7B7', marginBottom: 14 }}>
            ✓ {shortTextG(pair.rightTitle, 22)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {pair.rightItems.slice(0, 3).map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ color: '#34D399', fontWeight: 900, fontSize: 22 }}>✓</span>
                <FitText text={shortTextG(item, 54)} baseSize={25} minSize={19} maxLines={2} color="#ECFDF5" fontWeight={700} align="left" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/** look-23 / shot 3: graph-flip — chart before (declining red) vs after (rising emerald) */
const Look23GraphFlip: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, durationFrames, fps, tokens }) => {
  const pal = resolvePaletteG(tokens, {
    bg: '#0F172A',
    bg2: '#1E293B',
    surface: '#162033',
    fg: '#F8FAFC',
    muted: '#94A3B8',
    accent: '#10B981',
    accent2: '#F43F5E',
    border: '#334155',
  });
  const txt = sceneTexts(scene);
  const pair = extractBeforeAfterG(scene);
  const metric = extractPrimaryMetricG(scene, sceneIndex, 240);

  const beforeGrow = easeOutCubic(clamp01((localFrame - 4) / 22));
  const afterGrow = easeOutCubic(clamp01((localFrame - 18) / Math.max(22, durationFrames * 0.42)));
  const badgePop = spring({ frame: Math.max(0, localFrame - 24), fps, config: { damping: 12, stiffness: 180 } });

  const beforeBars = [210, 175, 130, 92];
  const afterBars = [125, 195, 268, 342];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <SliderStudioBackdrop pal={pal} />

      {/* Header */}
      <div style={{ position: 'absolute', top: 62, left: 60, right: 60, textAlign: 'center', opacity: appear(localFrame, 2, 12) }}>
        <div
          style={{
            display: 'inline-block',
            padding: '6px 22px',
            borderRadius: 99,
            background: 'rgba(16,185,129,0.16)',
            border: '1.5px solid #34D399',
            fontFamily: FONT_MONO,
            fontSize: 21,
            fontWeight: 800,
            color: '#6EE7B7',
            marginBottom: 12,
          }}
        >
          PERFORMANCE FLIP · {metric.delta}
        </div>
        <FitText text={txt.title || 'กราฟพลิกจากขาลงเป็นขาขึ้น'} baseSize={48} minSize={30} maxLines={2} color="#F8FAFC" />
      </div>

      {/* Main Chart Board (y: 266..1016) */}
      <div
        style={{
          position: 'absolute',
          top: 266,
          left: 56,
          right: 56,
          height: 740,
          borderRadius: 30,
          background: 'rgba(15, 23, 42, 0.92)',
          border: '2px solid #334155',
          boxShadow: '0 32px 76px rgba(0,0,0,0.58)',
          padding: '28px 30px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        {/* Top Legend Row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 14, height: 14, borderRadius: 4, background: '#FB7185' }} />
            <span style={{ fontFamily: FONT_THAI, fontSize: 24, fontWeight: 800, color: '#FDA4AF' }}>
              {shortTextG(pair.leftTitle, 18)}
            </span>
          </div>
          <div
            style={{
              padding: '8px 20px',
              borderRadius: 99,
              background: '#10B981',
              color: '#022C22',
              fontFamily: FONT_MONO,
              fontSize: 26,
              fontWeight: 900,
              transform: `scale(${(0.85 + badgePop * 0.15).toFixed(3)})`,
            }}
          >
            {metric.prefix}{metric.big} ({metric.delta})
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 14, height: 14, borderRadius: 4, background: '#34D399' }} />
            <span style={{ fontFamily: FONT_THAI, fontSize: 24, fontWeight: 800, color: '#6EE7B7' }}>
              {shortTextG(pair.rightTitle, 18)}
            </span>
          </div>
        </div>

        {/* SVG Split Bar & Trend Graph */}
        <svg width={908} height={540} viewBox="0 0 908 540" style={{ width: '100%', height: 540 }}>
          {/* Grid lines */}
          {[90, 190, 290, 390, 480].map((y) => (
            <line key={y} x1="20" y1={y} x2="888" y2={y} stroke="#1E293B" strokeWidth="2" />
          ))}
          {/* Center Transformation Divider */}
          <line x1="454" y1="30" x2="454" y2="495" stroke="#64748B" strokeWidth="3" strokeDasharray="10 8" />
          <circle cx="454" cy="260" r="32" fill="#0F172A" stroke="#38BDF8" strokeWidth="4" />
          <path d="M442 260 L466 260 M458 250 L468 260 L458 270" fill="none" stroke="#38BDF8" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />

          {/* BEFORE Bars (Left) */}
          {beforeBars.map((h, i) => {
            const curH = h * beforeGrow;
            const x = 52 + i * 92;
            const y = 480 - curH;
            return (
              <g key={`b-${i}`}>
                <rect x={x} y={y} width="58" height={curH} rx="10" fill="#F43F5E" fillOpacity={0.35 + i * 0.12} stroke="#FB7185" strokeWidth="2.5" />
                <text x={x + 29} y="516" textAnchor="middle" fill="#94A3B8" fontSize="19" fontFamily={FONT_MONO}>
                  T-{4 - i}
                </text>
              </g>
            );
          })}
          {/* Downward dashed trend line */}
          <path
            d="M 81 248 Q 220 295 357 368"
            fill="none"
            stroke="#FDA4AF"
            strokeWidth="4"
            strokeDasharray="8 6"
            opacity={beforeGrow}
          />

          {/* AFTER Bars (Right) */}
          {afterBars.map((h, i) => {
            const delayP = easeOutCubic(clamp01((localFrame - (16 + i * 5)) / 18));
            const curH = h * delayP;
            const x = 516 + i * 92;
            const y = 480 - curH;
            return (
              <g key={`a-${i}`}>
                <rect x={x} y={y} width="58" height={curH} rx="10" fill="#10B981" fillOpacity={0.55 + i * 0.14} stroke="#6EE7B7" strokeWidth="2.5" />
                <text x={x + 29} y="516" textAnchor="middle" fill="#6EE7B7" fontSize="19" fontWeight="700" fontFamily={FONT_MONO}>
                  T+{i + 1}
                </text>
              </g>
            );
          })}
          {/* Rising glowing Bezier trend line */}
          <path
            d="M 545 335 Q 680 230 821 108"
            fill="none"
            stroke="#34D399"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray="420"
            strokeDashoffset={420 * (1 - afterGrow)}
          />
          {afterGrow > 0.8 && (
            <>
              <circle cx="821" cy="108" r="18" fill="#10B981" opacity={0.3 + 0.2 * Math.sin(localFrame * 0.25)} />
              <circle cx="821" cy="108" r="8" fill="#ECFDF5" stroke="#10B981" strokeWidth="3" />
            </>
          )}
        </svg>
      </div>

      {/* Bottom Comparison Takeaways (y: 1044..1486) */}
      <div style={{ position: 'absolute', top: 1044, left: 56, right: 56, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div
          style={{
            borderRadius: 22,
            background: 'rgba(51, 24, 40, 0.78)',
            border: '1.5px solid rgba(251,113,133,0.45)',
            padding: '20px 26px',
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            opacity: appear(localFrame, 12, 14),
          }}
        >
          <span style={{ fontFamily: FONT_THAI, fontSize: 22, fontWeight: 800, color: '#FDA4AF', padding: '6px 14px', borderRadius: 12, background: 'rgba(244,63,94,0.2)', flexShrink: 0 }}>
            ก่อนหน้า
          </span>
          <FitText text={shortTextG(pair.leftItems[0] || 'แนวโน้มลดลงและเสียโอกาส', 62)} baseSize={27} minSize={20} maxLines={2} color="#FFE4E6" fontWeight={700} align="left" />
        </div>
        <div
          style={{
            borderRadius: 22,
            background: 'rgba(6, 78, 59, 0.72)',
            border: '1.5px solid rgba(52,211,153,0.55)',
            padding: '20px 26px',
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            opacity: appear(localFrame, 22, 14),
          }}
        >
          <span style={{ fontFamily: FONT_THAI, fontSize: 22, fontWeight: 800, color: '#022C22', padding: '6px 14px', borderRadius: 12, background: '#34D399', flexShrink: 0 }}>
            หลังเปลี่ยน
          </span>
          <FitText text={shortTextG(pair.rightItems[0] || txt.subtitle || 'กราฟพุ่งขึ้นชัดเจนอย่างต่อเนื่อง', 62)} baseSize={27} minSize={20} maxLines={2} color="#ECFDF5" fontWeight={700} align="left" />
        </div>
      </div>
    </div>
  );
};

/** look-23 / shot 4: mirror-portrait — character silhouette before/after inside a split mirror with callout arrows */
const Look23MirrorPortrait: React.FC<StyleShotArgs> = ({ scene, localFrame, fps, tokens }) => {
  const pal = resolvePaletteG(tokens, {
    bg: '#0F172A',
    bg2: '#1E293B',
    surface: '#162033',
    fg: '#F8FAFC',
    muted: '#94A3B8',
    accent: '#38BDF8',
    accent2: '#10B981',
    border: '#334155',
  });
  const txt = sceneTexts(scene);
  const pair = extractBeforeAfterG(scene);
  const mirrorPop = spring({ frame: localFrame, fps, config: { damping: 16, stiffness: 120 } });
  const arrowP = easeOutCubic(clamp01((localFrame - 16) / 24));

  const callouts = [
    { side: 'left', y: 495, label: shortTextG(pair.leftItems[0] || 'สับสน เหนื่อยล้า', 28) },
    { side: 'left', y: 805, label: shortTextG(pair.leftItems[1] || 'ทำซ้ำแบบเดิม', 28) },
    { side: 'right', y: 495, label: shortTextG(pair.rightItems[0] || 'โฟกัสชัดเจนขึ้น', 28) },
    { side: 'right', y: 805, label: shortTextG(pair.rightItems[1] || 'มั่นใจและเป็นระบบ', 28) },
  ];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <SliderStudioBackdrop pal={pal} />

      {/* Header */}
      <div style={{ position: 'absolute', top: 62, left: 60, right: 60, textAlign: 'center', opacity: appear(localFrame, 2, 12) }}>
        <div
          style={{
            display: 'inline-block',
            padding: '6px 22px',
            borderRadius: 99,
            background: 'rgba(56,189,248,0.16)',
            border: '1.5px solid #38BDF8',
            fontFamily: FONT_THAI,
            fontSize: 22,
            fontWeight: 700,
            color: '#7DD3FC',
            marginBottom: 12,
          }}
        >
          {shortTextG(txt.badge || 'ภาพสะท้อนการเปลี่ยนแปลง', 28)}
        </div>
        <FitText text={txt.title || 'ตัวคุณก่อนเปลี่ยน vs หลังเปลี่ยน'} baseSize={48} minSize={30} maxLines={2} color="#F8FAFC" />
      </div>

      {/* Central Arched Mirror + Split Silhouettes (y: 266..1180) */}
      <div
        style={{
          position: 'absolute',
          top: 266,
          left: 0,
          width: STAGE_W,
          height: 920,
          transform: `scale(${(0.94 + mirrorPop * 0.06).toFixed(4)})`,
        }}
      >
        <svg width={STAGE_W} height={920} viewBox="0 0 1080 920" style={{ position: 'absolute', inset: 0 }}>
          <defs>
            <clipPath id="mirrorArch">
              <path d="M 270 300 A 270 270 0 0 1 810 300 L 810 860 L 270 860 Z" />
            </clipPath>
          </defs>

          {/* Mirror Outer Bezel */}
          <path d="M 256 300 A 284 284 0 0 1 824 300 L 824 874 L 256 874 Z" fill="#1E293B" stroke="#64748B" strokeWidth="6" />

          {/* Split Mirror Interior */}
          <g clipPath="url(#mirrorArch)">
            {/* Left Half (BEFORE - dim slate/crimson) */}
            <rect x="270" y="20" width="270" height="840" fill="#231928" />
            {/* Right Half (AFTER - luminous teal/emerald) */}
            <rect x="540" y="20" width="270" height="840" fill="#0B2E3B" />

            {/* Subtle Mirror Glass Sheen */}
            <polygon points="310,60 390,60 280,460 270,380" fill="#FFFFFF" opacity="0.06" />
            <polygon points="650,60 720,60 560,640 540,560" fill="#FFFFFF" opacity="0.07" />

            {/* Left Silhouette: Slouched / Stressed */}
            <g transform="translate(0, 26)">
              {/* Tangled Stress Scribble above head */}
              <path
                d="M 380 235 C 350 195, 420 180, 405 220 C 390 250, 460 235, 445 198 C 435 170, 480 185, 465 225"
                fill="none"
                stroke="#FB7185"
                strokeWidth="5"
                strokeLinecap="round"
                opacity="0.85"
              />
              {/* Head tilted down */}
              <circle cx="445" cy="340" r="64" fill="#475569" stroke="#FB7185" strokeWidth="3" />
              {/* Slouched Shoulders & Torso */}
              <path
                d="M 320 560 C 335 450, 395 418, 468 422 L 540 426 L 540 860 L 315 860 Z"
                fill="#334155"
                stroke="#FB7185"
                strokeWidth="3"
              />
            </g>

            {/* Right Silhouette: Upright / Confident */}
            <g>
              {/* Clarity Radiating Aura behind head */}
              {[0, 1, 2, 3, 4].map((ray) => {
                const ang = (-60 + ray * 30) * (Math.PI / 180);
                const x1 = 620 + Math.cos(ang) * 90;
                const y1 = 290 + Math.sin(ang) * 90;
                const x2 = 620 + Math.cos(ang) * 130;
                const y2 = 290 + Math.sin(ang) * 130;
                return (
                  <line
                    key={ray}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="#34D399"
                    strokeWidth="5"
                    strokeLinecap="round"
                    opacity={0.55 + 0.35 * Math.sin(localFrame * 0.14 + ray)}
                  />
                );
              })}
              {/* Upright Head */}
              <circle cx="620" cy="300" r="66" fill="#0F766E" stroke="#6EE7B7" strokeWidth="4" />
              {/* Confident Upright Shoulders & Torso */}
              <path
                d="M 540 388 L 635 388 C 712 392, 756 444, 768 548 L 775 860 L 540 860 Z"
                fill="#115E59"
                stroke="#6EE7B7"
                strokeWidth="4"
              />
            </g>

            {/* Center Mirror Split Line */}
            <line x1="540" y1="20" x2="540" y2="860" stroke="#F8FAFC" strokeWidth="4" />
          </g>

          {/* Left / Right Labels inside Mirror Top */}
          <rect x="305" y="70" width="190" height="44" rx="22" fill="rgba(244,63,94,0.28)" stroke="#FB7185" strokeWidth="2" />
          <text x="400" y="99" textAnchor="middle" fill="#FFE4E6" fontSize="22" fontWeight="800" fontFamily={FONT_THAI}>
            ก่อนหน้า
          </text>
          <rect x="585" y="70" width="190" height="44" rx="22" fill="rgba(16,185,129,0.28)" stroke="#34D399" strokeWidth="2" />
          <text x="680" y="99" textAnchor="middle" fill="#ECFDF5" fontSize="22" fontWeight="800" fontFamily={FONT_THAI}>
            หลังเปลี่ยน
          </text>

          {/* Animated Callout Arrows pointing at the Silhouettes */}
          <path
            d="M 218 260 Q 300 260 365 320"
            fill="none"
            stroke="#FB7185"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="220"
            strokeDashoffset={220 * (1 - arrowP)}
          />
          <path
            d="M 218 570 Q 290 570 355 540"
            fill="none"
            stroke="#FB7185"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="220"
            strokeDashoffset={220 * (1 - arrowP)}
          />
          <path
            d="M 862 260 Q 780 260 700 300"
            fill="none"
            stroke="#34D399"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="220"
            strokeDashoffset={220 * (1 - arrowP)}
          />
          <path
            d="M 862 570 Q 790 570 725 535"
            fill="none"
            stroke="#34D399"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="220"
            strokeDashoffset={220 * (1 - arrowP)}
          />
        </svg>

        {/* Callout Label Chips on Left & Right Margins */}
        {callouts.map((c, idx) => {
          const p = stagger(idx, localFrame, 6, 12, 14);
          const isLeft = c.side === 'left';
          return (
            <div
              key={idx}
              style={{
                position: 'absolute',
                top: c.y - 266,
                left: isLeft ? 28 : undefined,
                right: isLeft ? undefined : 28,
                width: 224,
                borderRadius: 18,
                background: isLeft ? 'rgba(51, 24, 40, 0.92)' : 'rgba(6, 78, 59, 0.92)',
                border: `1.5px solid ${isLeft ? '#FB7185' : '#34D399'}`,
                padding: '14px 16px',
                opacity: p,
                transform: `translateX(${((1 - p) * (isLeft ? -24 : 24)).toFixed(1)}px)`,
                boxShadow: '0 12px 26px rgba(0,0,0,0.45)',
              }}
            >
              <FitText text={c.label} baseSize={22} minSize={18} maxLines={3} color={isLeft ? '#FFE4E6' : '#ECFDF5'} fontWeight={700} align="center" />
            </div>
          );
        })}
      </div>

      {/* Bottom Takeaway Bar above SAFE_BOTTOM (y: 1236..1474) */}
      <div
        style={{
          position: 'absolute',
          top: 1236,
          left: 60,
          right: 60,
          borderRadius: 24,
          background: 'rgba(15,23,42,0.92)',
          border: '1.5px solid #334155',
          padding: '24px 30px',
          opacity: appear(localFrame, 20, 14),
          textAlign: 'center',
        }}
      >
        <div style={{ fontFamily: FONT_THAI, fontSize: 21, fontWeight: 700, color: '#6EE7B7', marginBottom: 6 }}>
          จุดเปลี่ยนที่มองเห็นได้ชัด
        </div>
        <FitText
          text={txt.subtitle || `${pair.leftTitle} → ${pair.rightTitle}`}
          baseSize={30}
          minSize={22}
          maxLines={2}
          color="#F8FAFC"
          fontWeight={800}
        />
      </div>
    </div>
  );
};

// ============================================================================
// STYLE 3: look-25 — SOCIAL POST RECEIPT (โพสต์โซเชียลเป็นหลักฐาน)
// ============================================================================

const SocialEvidenceBackdrop: React.FC<{ pal: PaletteG; cork?: boolean }> = ({ pal, cork = false }) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      background: cork
        ? 'radial-gradient(circle at 50% 35%, #2D241E 0%, #1C1613 62%, #0F0C0A 100%)'
        : `radial-gradient(circle at 50% 25%, rgba(56,189,248,0.16) 0%, ${pal.bg2} 45%, ${pal.bg} 100%)`,
    }}
  >
    <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0, opacity: cork ? 0.22 : 0.16 }}>
      <defs>
        <pattern id={cork ? 'g25Cork' : 'g25Grid'} width="44" height="44" patternUnits="userSpaceOnUse">
          {cork ? (
            <>
              <circle cx="10" cy="12" r="2" fill="#A16207" />
              <circle cx="32" cy="28" r="1.5" fill="#78350F" />
              <circle cx="22" cy="40" r="1.8" fill="#92400E" />
            </>
          ) : (
            <path d="M 44 0 L 0 0 0 44" fill="none" stroke="#475569" strokeWidth="1" />
          )}
        </pattern>
      </defs>
      <rect width={STAGE_W} height={STAGE_H} fill={`url(#${cork ? 'g25Cork' : 'g25Grid'})`} />
    </svg>
  </div>
);

const FictionalAvatarSvg: React.FC<{ initials: string; bg: string; size?: number }> = ({ initials, bg, size = 64 }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: 999,
      background: `linear-gradient(145deg, ${bg}, ${bg}CC)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      border: '3px solid rgba(255,255,255,0.85)',
      boxShadow: '0 6px 16px rgba(0,0,0,0.22)',
      fontFamily: FONT_THAI,
      fontSize: Math.round(size * 0.36),
      fontWeight: 900,
      color: '#FFFFFF',
    }}
  >
    {initials}
  </div>
);

const VerifiedCheckSvg: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="12" r="10" fill="#0EA5E9" />
    <path d="M7.5 12.2 L10.5 15.2 L16.5 9.2" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** look-25 / shot 1: post-card — social post card with avatar, handle, text, and rising like/share counters */
const Look25PostCard: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, durationFrames, fps, tokens }) => {
  const pal = resolvePaletteG(tokens, {
    bg: '#0F172A',
    bg2: '#1E293B',
    surface: '#FFFFFF',
    fg: '#F8FAFC',
    muted: '#94A3B8',
    accent: '#0EA5E9',
    accent2: '#F43F5E',
    border: '#334155',
  });
  const txt = sceneTexts(scene);
  const pts = extractPointsG(scene, 3);
  const metric = extractPrimaryMetricG(scene, sceneIndex, 14200);
  const user = FICTIONAL_USERS[sceneIndex % FICTIONAL_USERS.length];

  const cardSpring = spring({ frame: localFrame, fps, config: { damping: 14, stiffness: 130 } });
  const countP = easeOutCubic(clamp01((localFrame - 10) / Math.max(24, durationFrames * 0.55)));
  const likeTarget = Math.max(1240, Math.min(98000, Math.round(metric.numeric * 0.72) + 840));
  const shareTarget = Math.max(320, Math.round(likeTarget * 0.28));
  const commentTarget = Math.max(95, Math.round(likeTarget * 0.11));

  const likes = Math.round(likeTarget * countP);
  const shares = Math.round(shareTarget * countP);
  const comments = Math.round(commentTarget * countP);
  const heartPulse = 1 + (localFrame > 14 ? 0.14 * Math.abs(Math.sin(localFrame * 0.22)) : 0);

  const postBody = scene.quote?.text || txt.title || pts[0] || 'หลักฐานจากโพสต์จริงที่ยืนยันข้อมูลนี้ได้ชัดเจน';
  const postSub = txt.subtitle || (pts[0] && pts[0] !== postBody ? pts[0] : pts[1] || '');

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <SocialEvidenceBackdrop pal={pal} />

      {/* Top Receipt Tag */}
      <div
        style={{
          position: 'absolute',
          top: 68,
          left: 64,
          right: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          opacity: appear(localFrame, 2, 12),
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 22px',
            borderRadius: 99,
            background: 'rgba(14,165,233,0.18)',
            border: '1.5px solid #38BDF8',
            fontFamily: FONT_THAI,
            fontSize: 22,
            fontWeight: 800,
            color: '#7DD3FC',
          }}
        >
          <span>🧾</span>
          <span>{shortTextG(txt.badge || 'หลักฐานจากโพสต์โซเชียล', 26)}</span>
        </div>
        <span style={{ fontFamily: FONT_MONO, fontSize: 21, fontWeight: 700, color: '#94A3B8' }}>
          RECEIPT #{String(sceneIndex + 1).padStart(2, '0')}
        </span>
      </div>

      {/* Main White Social Post Card (y: 196..1180) */}
      <div
        style={{
          position: 'absolute',
          top: 196,
          left: 64,
          right: 64,
          borderRadius: 34,
          background: '#FFFFFF',
          border: '2px solid #E2E8F0',
          boxShadow: '0 40px 90px rgba(0,0,0,0.58), 0 0 0 1px rgba(255,255,255,0.6)',
          padding: '38px 40px 32px',
          transform: `translateY(${((1 - cardSpring) * 64).toFixed(1)}px) scale(${(0.93 + cardSpring * 0.07).toFixed(4)})`,
          display: 'flex',
          flexDirection: 'column',
          gap: 26,
        }}
      >
        {/* Author Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <FictionalAvatarSvg initials={user.initials} bg={user.bg} size={76} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: FONT_THAI, fontSize: 30, fontWeight: 800, color: '#0F172A' }}>{user.name}</span>
                <VerifiedCheckSvg size={26} />
              </div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 22, fontWeight: 600, color: '#64748B', marginTop: 2 }}>
                {user.handle} · {user.role}
              </div>
            </div>
          </div>
          <div
            style={{
              padding: '8px 20px',
              borderRadius: 99,
              background: '#0F172A',
              fontFamily: FONT_THAI,
              fontSize: 20,
              fontWeight: 700,
              color: '#F8FAFC',
            }}
          >
            ติดตาม
          </div>
        </div>

        {/* Post Main Body Text */}
        <div style={{ padding: '4px 0' }}>
          <FitText text={postBody} baseSize={44} minSize={28} maxLines={4} color="#0F172A" fontWeight={800} align="left" lineHeight={1.32} />
        </div>

        {/* Attached Quote / Evidence Card inside Post */}
        {(postSub || pts.length > 0) && (
          <div
            style={{
              borderRadius: 22,
              background: '#F1F5F9',
              border: '2px solid #CBD5E1',
              borderLeft: '8px solid #0EA5E9',
              padding: '22px 26px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ fontFamily: FONT_THAI, fontSize: 20, fontWeight: 800, color: '#0284C7' }}>
              ประเด็นอ้างอิงในโพสต์
            </div>
            <FitText
              text={shortTextG(postSub || pts[0], 110)}
              baseSize={28}
              minSize={21}
              maxLines={3}
              color="#1E293B"
              fontWeight={700}
              align="left"
            />
          </div>
        )}

        {/* Timestamp & Views Meta */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #E2E8F0', paddingBottom: 18 }}>
          <span style={{ fontFamily: FONT_THAI, fontSize: 21, fontWeight: 600, color: '#64748B' }}>09:41 น. · โพสต์สาธารณะ</span>
          <span style={{ fontFamily: FONT_MONO, fontSize: 21, fontWeight: 800, color: '#0F172A' }}>
            {formatNumG(Math.round(likes * 4.8))} VIEWS
          </span>
        </div>

        {/* Animated Engagement Bar (Heart / Repost / Comment) */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 12px' }}>
          {/* Likes */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <svg width={40} height={40} viewBox="0 0 24 24" style={{ transform: `scale(${heartPulse.toFixed(3)})` }}>
              <path
                d="M12 21s-7-4.35-9.33-8.36C.77 9.4 2.4 5 6.5 5c2.2 0 3.7 1.2 4.5 2.4C11.8 6.2 13.3 5 15.5 5c4.1 0 5.73 4.4 3.83 7.64C19 16.65 12 21 12 21Z"
                fill="#F43F5E"
              />
            </svg>
            <div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 32, fontWeight: 900, color: '#E11D48', lineHeight: 1 }}>{formatNumG(likes)}</div>
              <div style={{ fontFamily: FONT_THAI, fontSize: 18, fontWeight: 700, color: '#64748B' }}>ถูกใจ</div>
            </div>
          </div>

          {/* Shares / Reposts */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <svg width={40} height={40} viewBox="0 0 24 24" fill="none">
              <path d="M17 2l4 4-4 4" stroke="#10B981" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" stroke="#10B981" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M7 22l-4-4 4-4" stroke="#10B981" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" stroke="#10B981" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
            <div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 32, fontWeight: 900, color: '#059669', lineHeight: 1 }}>{formatNumG(shares)}</div>
              <div style={{ fontFamily: FONT_THAI, fontSize: 18, fontWeight: 700, color: '#64748B' }}>แชร์ต่อ</div>
            </div>
          </div>

          {/* Comments */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <svg width={38} height={38} viewBox="0 0 24 24" fill="none">
              <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.7-.3-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5Z" stroke="#0EA5E9" strokeWidth="2.4" strokeLinejoin="round" />
            </svg>
            <div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 32, fontWeight: 900, color: '#0284C7', lineHeight: 1 }}>{formatNumG(comments)}</div>
              <div style={{ fontFamily: FONT_THAI, fontSize: 18, fontWeight: 700, color: '#64748B' }}>คอมเมนต์</div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Context Banner safely above SAFE_BOTTOM (y: 1260..1474) */}
      <div
        style={{
          position: 'absolute',
          top: Math.min(1260, SAFE_BOTTOM - 260),
          left: 64,
          right: 64,
          borderRadius: 24,
          background: 'rgba(15, 23, 42, 0.9)',
          border: '1.5px solid rgba(56,189,248,0.45)',
          padding: '22px 28px',
          opacity: appear(localFrame, 18, 14),
          display: 'flex',
          alignItems: 'center',
          gap: 18,
        }}
      >
        <div style={{ padding: '10px 18px', borderRadius: 14, background: 'rgba(14,165,233,0.2)', fontFamily: FONT_MONO, fontSize: 24, fontWeight: 900, color: '#7DD3FC', flexShrink: 0 }}>
          {metric.big}
        </div>
        <FitText
          text={shortTextG(pts[1] || txt.subtitle || 'เสียงตอบรับจริงบนโซเชียลที่ยืนยันได้ด้วยตัวเลข', 68)}
          baseSize={26}
          minSize={20}
          maxLines={2}
          color="#E2E8F0"
          fontWeight={700}
          align="left"
        />
      </div>
    </div>
  );
};

/** look-25 / shot 2: screenshot-evidence — pinned post screenshot on an evidence board with animated yellow highlighter */
const Look25ScreenshotEvidence: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const pal = resolvePaletteG(tokens, {
    bg: '#1C1613',
    bg2: '#2D241E',
    surface: '#FFFBEB',
    fg: '#F8FAFC',
    muted: '#D6D3D1',
    accent: '#FDE047',
    accent2: '#EF4444',
    border: '#57534E',
  });
  const txt = sceneTexts(scene);
  const keyPhrase = extractHighlightPhraseG(scene);
  const pts = extractShortPointsG(scene, 3);
  const user = FICTIONAL_USERS[(sceneIndex + 1) % FICTIONAL_USERS.length];

  const pinSpring = spring({ frame: localFrame, fps, config: { damping: 13, stiffness: 140 } });
  const highlightSweep = easeOutCubic(clamp01((localFrame - 16) / 22));
  const notePop = spring({ frame: Math.max(0, localFrame - 24), fps, config: { damping: 14, stiffness: 160 } });

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <SocialEvidenceBackdrop pal={pal} cork />

      {/* Red Evidence String SVG connecting top corners to pin */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <line x1="80" y1="115" x2="540" y2="235" stroke="#DC2626" strokeWidth="4" strokeOpacity="0.85" />
        <line x1="1000" y1="130" x2="540" y2="235" stroke="#DC2626" strokeWidth="4" strokeOpacity="0.85" />
        <circle cx="80" cy="115" r="10" fill="#EF4444" />
        <circle cx="1000" cy="130" r="10" fill="#EF4444" />
      </svg>

      {/* Top Exhibit Stamp */}
      <div
        style={{
          position: 'absolute',
          top: 64,
          left: 110,
          right: 110,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          opacity: appear(localFrame, 2, 12),
        }}
      >
        <div
          style={{
            padding: '8px 22px',
            borderRadius: 10,
            background: '#FEF08A',
            color: '#422006',
            fontFamily: FONT_MONO,
            fontSize: 22,
            fontWeight: 900,
            letterSpacing: 1.5,
            boxShadow: '0 8px 18px rgba(0,0,0,0.4)',
          }}
        >
          EXHIBIT #{String(sceneIndex + 1).padStart(2, '0')}
        </div>
        <div
          style={{
            padding: '8px 20px',
            borderRadius: 10,
            border: '3px solid #EF4444',
            color: '#FCA5A5',
            fontFamily: FONT_THAI,
            fontSize: 22,
            fontWeight: 800,
          }}
        >
          หลักฐานแคปจริง
        </div>
      </div>

      {/* Pinned Screenshot Paper Card (y: 230..1080) */}
      <div
        style={{
          position: 'absolute',
          top: 230,
          left: 72,
          right: 72,
          transform: `rotate(-1.8deg) translateY(${((1 - pinSpring) * 48).toFixed(1)}px) scale(${(0.93 + pinSpring * 0.07).toFixed(4)})`,
          transformOrigin: '50% 0%',
        }}
      >
        {/* 3D Red Pushpin SVG */}
        <svg width={64} height={64} viewBox="0 0 64 64" style={{ position: 'absolute', top: -28, left: '50%', marginLeft: -32, zIndex: 12 }}>
          <ellipse cx="36" cy="48" rx="18" ry="8" fill="rgba(0,0,0,0.4)" />
          <circle cx="32" cy="24" r="20" fill="#DC2626" stroke="#FCA5A5" strokeWidth="3" />
          <circle cx="26" cy="18" r="6" fill="#FEE2E2" opacity="0.65" />
        </svg>

        {/* Polaroid / Screenshot Frame */}
        <div
          style={{
            borderRadius: 20,
            background: '#FFFFFF',
            padding: '44px 38px 36px',
            boxShadow: '0 36px 80px rgba(0,0,0,0.65)',
            border: '2px solid #E5E7EB',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          {/* Screenshot Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '2px solid #F1F5F9', paddingBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <FictionalAvatarSvg initials={user.initials} bg={user.bg} size={64} />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: FONT_THAI, fontSize: 27, fontWeight: 800, color: '#0F172A' }}>{user.name}</span>
                  <VerifiedCheckSvg size={22} />
                </div>
                <span style={{ fontFamily: FONT_MONO, fontSize: 20, color: '#64748B' }}>{user.handle}</span>
              </div>
            </div>
            <span style={{ fontFamily: FONT_MONO, fontSize: 19, color: '#94A3B8' }}>CAPTURED · 09:41</span>
          </div>

          {/* Context line above */}
          <FitText
            text={shortTextG(txt.subtitle || pts[0] || 'ข้อความจากโพสต์ต้นฉบับที่ถูกบันทึกไว้เป็นหลักฐาน', 66)}
            baseSize={28}
            minSize={20}
            maxLines={2}
            color="#64748B"
            fontWeight={600}
            align="left"
          />

          {/* HIGHLIGHTED KEY PHRASE with Sweeping Yellow Marker */}
          <div style={{ position: 'relative', padding: '18px 22px', borderRadius: 14, background: '#FFFBEB', border: '2px dashed #F59E0B' }}>
            {/* Animated Highlighter Marker Bar */}
            <div
              style={{
                position: 'absolute',
                left: 12,
                top: 12,
                bottom: 12,
                width: `calc(${(highlightSweep * 100).toFixed(1)}% - 24px)`,
                background: 'rgba(253, 224, 71, 0.72)',
                borderRadius: 8,
                zIndex: 1,
              }}
            />
            <div style={{ position: 'relative', zIndex: 2 }}>
              <FitText text={txt.title || keyPhrase} baseSize={44} minSize={28} maxLines={3} color="#0F172A" fontWeight={900} align="left" lineHeight={1.3} />
            </div>
          </div>

          {/* Supporting excerpt */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6 }}>
            <span style={{ fontFamily: FONT_THAI, fontSize: 22, fontWeight: 700, color: '#475569' }}>
              จุดเน้น: {shortTextG(keyPhrase, 30)}
            </span>
            <span style={{ fontFamily: FONT_MONO, fontSize: 20, fontWeight: 800, color: '#DC2626' }}>● VERIFIED CLIP</span>
          </div>
        </div>
      </div>

      {/* Pinned Yellow Sticky Note Annotation below Screenshot (y: 1126..1470) */}
      <div
        style={{
          position: 'absolute',
          top: 1126,
          left: 110,
          right: 110,
          borderRadius: 18,
          background: 'linear-gradient(155deg, #FEF08A 0%, #FDE047 100%)',
          padding: '26px 32px',
          boxShadow: '0 24px 48px rgba(0,0,0,0.52)',
          transform: `rotate(1.2deg) translateY(${((1 - notePop) * 40).toFixed(1)}px) scale(${(0.92 + notePop * 0.08).toFixed(4)})`,
          opacity: clamp01((localFrame - 22) / 10),
        }}
      >
        <div style={{ fontFamily: FONT_THAI, fontSize: 21, fontWeight: 800, color: '#854D0E', marginBottom: 6 }}>
          📌 บันทึกจากหลักฐานนี้
        </div>
        <FitText
          text={shortTextG(pts[1] || pts[0] || txt.subtitle || 'ประโยคนี้ชี้ชัดถึงข้อเท็จจริงที่เกิดขึ้นจริง', 88)}
          baseSize={30}
          minSize={22}
          maxLines={3}
          color="#422006"
          fontWeight={800}
          align="left"
        />
      </div>
    </div>
  );
};

/** look-25 / shot 3: comment-storm — comments pouring in under the original post */
const Look25CommentStorm: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, fps, tokens }) => {
  const pal = resolvePaletteG(tokens, {
    bg: '#0F172A',
    bg2: '#1E293B',
    surface: '#162033',
    fg: '#F8FAFC',
    muted: '#94A3B8',
    accent: '#38BDF8',
    accent2: '#F43F5E',
    border: '#334155',
  });
  const txt = sceneTexts(scene);
  const pts = extractShortPointsG(scene, 4);
  const author = FICTIONAL_USERS[sceneIndex % FICTIONAL_USERS.length];

  const comments = [0, 1, 2, 3].map((i) => {
    const u = FICTIONAL_USERS[(sceneIndex + i + 1) % FICTIONAL_USERS.length];
    const fallbacks = [
      'จริงมาก เจอกับตัวมาแล้วเหมือนกัน!',
      'เห็นตัวเลขนี้แล้วชัดเจนเลย แชร์เก็บไว้แล้ว',
      'ประเด็นนี้หลายคนมองข้ามไปจริงๆ',
      'สรุปได้ตรงจุดมาก ขอบคุณที่เอาหลักฐานมาให้ดู',
    ];
    return {
      user: u,
      text: shortTextG(pts[i] || fallbacks[i], 68),
      likes: 124 + i * 67 + sceneIndex * 19,
      mins: `${i + 1} นาที`,
    };
  });

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <SocialEvidenceBackdrop pal={pal} />

      {/* Top Live Discussion Badge */}
      <div
        style={{
          position: 'absolute',
          top: 58,
          left: 60,
          right: 60,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          opacity: appear(localFrame, 2, 12),
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '7px 20px',
            borderRadius: 99,
            background: 'rgba(244,63,94,0.2)',
            border: '1.5px solid #FB7185',
            fontFamily: FONT_THAI,
            fontSize: 22,
            fontWeight: 800,
            color: '#FDA4AF',
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: 99, background: '#FB7185' }} />
          คอมเมนต์หลั่งไหล
        </div>
        <span style={{ fontFamily: FONT_MONO, fontSize: 21, fontWeight: 800, color: '#7DD3FC' }}>
          +{18 + Math.min(82, Math.floor(localFrame * 1.4))} REPLIES
        </span>
      </div>

      {/* Compact Original Post Anchor (y: 132..424) */}
      <div
        style={{
          position: 'absolute',
          top: 132,
          left: 60,
          right: 60,
          borderRadius: 28,
          background: '#FFFFFF',
          padding: '24px 30px',
          boxShadow: '0 22px 50px rgba(0,0,0,0.48)',
          opacity: appear(localFrame, 2, 14),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
          <FictionalAvatarSvg initials={author.initials} bg={author.bg} size={54} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: FONT_THAI, fontSize: 24, fontWeight: 800, color: '#0F172A' }}>{author.name}</span>
              <VerifiedCheckSvg size={20} />
            </div>
            <span style={{ fontFamily: FONT_MONO, fontSize: 18, color: '#64748B' }}>{author.handle} · โพสต์ต้นทาง</span>
          </div>
        </div>
        <FitText text={txt.title || 'ประเด็นร้อนที่คนแห่เข้ามาคอมเมนต์'} baseSize={36} minSize={24} maxLines={2} color="#0F172A" fontWeight={800} align="left" />
      </div>

      {/* Thread Connector Line */}
      <div style={{ position: 'absolute', top: 416, left: 108, width: 4, height: 1040, background: 'linear-gradient(180deg, #38BDF8 0%, rgba(56,189,248,0.08) 100%)' }} />

      {/* Cascading Comment Stream (y: 454..1480) */}
      <div
        style={{
          position: 'absolute',
          top: 454,
          left: 60,
          right: 60,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {comments.map((c, idx) => {
          const d = 10 + idx * 12;
          const sp = spring({ frame: Math.max(0, localFrame - d), fps, config: { damping: 14, stiffness: 165 } });
          const op = clamp01((localFrame - d) / 7);
          return (
            <div
              key={idx}
              style={{
                opacity: op,
                transform: `translateY(${((1 - sp) * 64).toFixed(1)}px) scale(${(0.94 + sp * 0.06).toFixed(4)})`,
                marginLeft: idx % 2 === 1 ? 36 : 0,
                borderRadius: 24,
                background: 'rgba(22, 32, 51, 0.94)',
                border: `1.5px solid ${idx === 0 ? '#38BDF8' : '#334155'}`,
                padding: '20px 24px',
                display: 'flex',
                gap: 18,
                alignItems: 'flex-start',
                boxShadow: '0 16px 34px rgba(0,0,0,0.4)',
              }}
            >
              <FictionalAvatarSvg initials={c.user.initials} bg={c.user.bg} size={58} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontFamily: FONT_THAI, fontSize: 23, fontWeight: 800, color: '#F8FAFC' }}>{c.user.name}</span>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 18, color: '#94A3B8' }}>{c.user.handle}</span>
                  </div>
                  <span style={{ fontFamily: FONT_THAI, fontSize: 18, color: '#64748B' }}>{c.mins}</span>
                </div>
                <FitText text={c.text} baseSize={27} minSize={20} maxLines={2} color="#E2E8F0" fontWeight={600} align="left" lineHeight={1.28} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 10 }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 19, fontWeight: 800, color: '#FB7185' }}>♥ {c.likes}</span>
                  <span style={{ fontFamily: FONT_THAI, fontSize: 18, fontWeight: 700, color: '#38BDF8' }}>ตอบกลับ</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating Heart Reactions along Right Margin */}
      <svg width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {[0, 1, 2, 3].map((i) => {
          const p = clamp01(((localFrame + i * 16) % 64) / 64);
          const x = 995 + Math.sin(p * 6 + i) * 16;
          const y = 1420 - p * 460;
          const op = Math.sin(p * Math.PI) * 0.8;
          return (
            <text key={i} x={x} y={y} textAnchor="middle" fill={i % 2 === 0 ? '#FB7185' : '#38BDF8'} fontSize="30" opacity={op}>
              {i % 2 === 0 ? '♥' : '💬'}
            </text>
          );
        })}
      </svg>
    </div>
  );
};

/** look-25 / shot 4: viral-meter — post propagating through a sharing tree/network with reach counter */
const Look25ViralMeter: React.FC<StyleShotArgs> = ({ scene, sceneIndex, localFrame, durationFrames, fps, tokens }) => {
  const pal = resolvePaletteG(tokens, {
    bg: '#090F1E',
    bg2: '#162033',
    surface: '#111827',
    fg: '#F8FAFC',
    muted: '#94A3B8',
    accent: '#38BDF8',
    accent2: '#10B981',
    border: '#334155',
  });
  const txt = sceneTexts(scene);
  const metric = extractPrimaryMetricG(scene, sceneIndex, 285000);
  const pts = extractShortPointsG(scene, 2);

  const tier1P = easeOutCubic(clamp01((localFrame - 8) / 18));
  const tier2P = easeOutCubic(clamp01((localFrame - 20) / 22));
  const reachP = easeOutCubic(clamp01((localFrame - 6) / Math.max(26, durationFrames * 0.56)));
  const reachTarget = Math.max(12500, metric.numeric);
  const currentReach = Math.round(reachTarget * reachP);
  const rootPop = spring({ frame: localFrame, fps, config: { damping: 14, stiffness: 140 } });

  const rootX = 540;
  const rootY = 120;
  const tier1 = [
    { x: 220, y: 340, initials: 'พส', col: '#10B981' },
    { x: 540, y: 365, initials: 'ตม', col: '#38BDF8' },
    { x: 860, y: 340, initials: 'มก', col: '#F59E0B' },
  ];
  const tier2 = [
    { x: 110, y: 585, parent: 0, col: '#34D399' },
    { x: 295, y: 605, parent: 0, col: '#34D399' },
    { x: 455, y: 615, parent: 1, col: '#7DD3FC' },
    { x: 625, y: 615, parent: 1, col: '#7DD3FC' },
    { x: 785, y: 605, parent: 2, col: '#FBBF24' },
    { x: 970, y: 585, parent: 2, col: '#FBBF24' },
  ];

  return (
    <div style={{ position: 'absolute', inset: 0, width: STAGE_W, height: STAGE_H, overflow: 'hidden' }}>
      <SocialEvidenceBackdrop pal={pal} />

      {/* Header */}
      <div style={{ position: 'absolute', top: 58, left: 60, right: 60, textAlign: 'center', opacity: appear(localFrame, 2, 12) }}>
        <div
          style={{
            display: 'inline-block',
            padding: '6px 22px',
            borderRadius: 99,
            background: 'rgba(56,189,248,0.18)',
            border: '1.5px solid #38BDF8',
            fontFamily: FONT_MONO,
            fontSize: 21,
            fontWeight: 800,
            color: '#7DD3FC',
            marginBottom: 10,
          }}
        >
          VIRAL PROPAGATION NETWORK
        </div>
        <FitText text={txt.title || 'โพสต์เดียวแพร่กระจายสู่คนนับแสน'} baseSize={46} minSize={28} maxLines={2} color="#F8FAFC" />
      </div>

      {/* Viral Sharing Tree SVG (y: 244..950) */}
      <div style={{ position: 'absolute', top: 244, left: 0, width: STAGE_W, height: 700 }}>
        <svg width={STAGE_W} height={700} viewBox="0 0 1080 700">
          {/* Tier 0 -> Tier 1 Curved Paths */}
          {tier1.map((n, i) => (
            <g key={`e1-${i}`}>
              <path
                d={`M ${rootX} ${rootY + 55} C ${rootX} ${rootY + 170}, ${n.x} ${n.y - 120}, ${n.x} ${n.y}`}
                fill="none"
                stroke={n.col}
                strokeWidth="4.5"
                strokeDasharray="480"
                strokeDashoffset={480 * (1 - tier1P)}
                opacity="0.85"
              />
            </g>
          ))}

          {/* Tier 1 -> Tier 2 Curved Paths */}
          {tier2.map((n, i) => {
            const p = tier1[n.parent];
            return (
              <path
                key={`e2-${i}`}
                d={`M ${p.x} ${p.y + 38} C ${p.x} ${p.y + 130}, ${n.x} ${n.y - 110}, ${n.x} ${n.y}`}
                fill="none"
                stroke={n.col}
                strokeWidth="3.5"
                strokeDasharray="360"
                strokeDashoffset={360 * (1 - tier2P)}
                opacity="0.72"
              />
            );
          })}

          {/* Tier 2 Reach Nodes */}
          {tier2.map((n, i) => {
            const np = clamp01((localFrame - (24 + i * 3)) / 10);
            return (
              <g key={`n2-${i}`} transform={`translate(${n.x} ${n.y}) scale(${(0.4 + np * 0.6).toFixed(3)})`} opacity={np}>
                <circle r="38" fill="#0F172A" stroke={n.col} strokeWidth="3.5" />
                <circle r="16" fill={n.col} fillOpacity="0.28" />
                <text y="7" textAnchor="middle" fill="#F8FAFC" fontSize="20" fontWeight="800" fontFamily={FONT_MONO}>
                  +{12 + i * 7}K
                </text>
              </g>
            );
          })}

          {/* Tier 1 Sharer Nodes */}
          {tier1.map((n, i) => {
            const np = clamp01((localFrame - (12 + i * 4)) / 10);
            return (
              <g key={`n1-${i}`} transform={`translate(${n.x} ${n.y}) scale(${(0.5 + np * 0.5).toFixed(3)})`} opacity={np}>
                <circle r="54" fill={n.col} fillOpacity="0.18" />
                <circle r="42" fill="#1E293B" stroke={n.col} strokeWidth="4" />
                <text y="10" textAnchor="middle" fill="#FFFFFF" fontSize="26" fontWeight="900" fontFamily={FONT_THAI}>
                  {n.initials}
                </text>
              </g>
            );
          })}

          {/* Root Origin Post Mini-Card */}
          <g transform={`translate(${rootX} ${rootY}) scale(${(0.85 + rootPop * 0.15).toFixed(3)})`}>
            <rect x="-175" y="-64" width="350" height="128" rx="24" fill="#FFFFFF" stroke="#38BDF8" strokeWidth="5" />
            <circle cx="-122" cy="-16" r="22" fill="#0EA5E9" />
            <text x="-122" y="-8" textAnchor="middle" fill="#FFFFFF" fontSize="18" fontWeight="900" fontFamily={FONT_THAI}>
              นภ
            </text>
            <rect x="-86" y="-32" width="160" height="14" rx="7" fill="#0F172A" />
            <rect x="-86" y="-8" width="110" height="10" rx="5" fill="#94A3B8" />
            <rect x="-144" y="20" width="288" height="24" rx="12" fill="#E0F2FE" />
            <text x="0" y="38" textAnchor="middle" fill="#0369A1" fontSize="17" fontWeight="800" fontFamily={FONT_THAI}>
              โพสต์ต้นทาง · กำลังแชร์ต่อ
            </text>
          </g>
        </svg>
      </div>

      {/* Viral Reach Meter Dashboard Card (y: 954..1484) */}
      <div
        style={{
          position: 'absolute',
          top: 954,
          left: 60,
          right: 60,
          borderRadius: 30,
          background: 'rgba(15, 23, 42, 0.94)',
          border: '2px solid #38BDF8',
          boxShadow: '0 28px 64px rgba(0,0,0,0.58), 0 0 36px rgba(56,189,248,0.18)',
          padding: '30px 34px',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          opacity: appear(localFrame, 10, 14),
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontFamily: FONT_THAI, fontSize: 25, fontWeight: 800, color: '#7DD3FC' }}>
            การเข้าถึงสะสม (TOTAL REACH)
          </span>
          <span style={{ fontFamily: FONT_MONO, fontSize: 24, fontWeight: 900, color: '#34D399' }}>{metric.delta}</span>
        </div>

        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 84,
            fontWeight: 900,
            color: '#F8FAFC',
            lineHeight: 1,
            letterSpacing: -2,
          }}
        >
          {formatNumG(currentReach)}
          <span style={{ fontFamily: FONT_THAI, fontSize: 30, fontWeight: 700, color: '#94A3B8', marginLeft: 14 }}>คน</span>
        </div>

        {/* Animated Reach Meter Bar */}
        <div style={{ height: 22, borderRadius: 99, background: '#1E293B', overflow: 'hidden', border: '1px solid #334155' }}>
          <div
            style={{
              height: '100%',
              width: `${(reachP * 92).toFixed(1)}%`,
              borderRadius: 99,
              background: 'linear-gradient(90deg, #0EA5E9 0%, #10B981 60%, #F59E0B 100%)',
              boxShadow: '0 0 20px rgba(16,185,129,0.55)',
            }}
          />
        </div>

        <FitText
          text={shortTextG(txt.subtitle || pts[0] || 'แรงส่งจากการแชร์ต่อทำให้ข้อความนี้เข้าถึงผู้ชมจำนวนมาก', 74)}
          baseSize={26}
          minSize={20}
          maxLines={2}
          color="#CBD5E1"
          fontWeight={700}
          align="left"
        />
      </div>
    </div>
  );
};

// ============================================================================
// EXPORTED REGISTRY DEFINITIONS — BATCH_G (look-22, look-23, look-25)
// ============================================================================

export const BATCH_G: StyleDirectorDef[] = [
  {
    styleId: 'look-22',
    shots: {
      'lockscreen-flood': Look22LockscreenFlood,
      'cash-register': Look22CashRegister,
      'wrist-buzz': Look22WristBuzz,
      'dashboard-ping': Look22DashboardPing,
    },
    shotLabels: {
      'lockscreen-flood': 'หน้าจอล็อกสมาร์ตโฟนที่มีแจ้งเตือนเด้งซ้อนเข้ามาทีละใบพร้อมตัวนับยอด',
      'cash-register': 'แจ้งเตือนยอดขายและเงินเข้าเด้งรัวพร้อมเครื่องคิดเงินที่ตัวเลขยอดรวมวิ่งขึ้น',
      'wrist-buzz': 'สมาร์ตวอตช์สั่นแจ้งเตือนข้อความสั้นและด่วนบนข้อมือ',
      'dashboard-ping': 'แดชบอร์ดยอดขายบนจอเดสก์ท็อปที่มีป๊อปอัปแจ้งเตือนเด้งเข้ามุมจอ',
    },
    infer: (scene) => {
      const text = haystackOfG(scene);
      const t = sceneTexts(scene);
      if (scene.stat || MONEY_RE.test(text)) {
        return 'cash-register';
      }
      if (ALERT_SHORT_RE.test(text) || (t.title.length <= 28 && t.bullets.length <= 1 && !scene.steps)) {
        return 'wrist-buzz';
      }
      if (DASHBOARD_RE.test(text) || STEP_RE.test(text) || (Array.isArray(scene.bullets) && scene.bullets.length >= 3)) {
        return 'dashboard-ping';
      }
      if (NOTIF_STACK_RE.test(text)) {
        return 'lockscreen-flood';
      }
      return null;
    },
  },
  {
    styleId: 'look-23',
    shots: {
      'split-slider': Look23SplitSlider,
      'room-makeover': Look23RoomMakeover,
      'graph-flip': Look23GraphFlip,
      'mirror-portrait': Look23MirrorPortrait,
    },
    shotLabels: {
      'split-slider': 'เส้นแบ่งสไลเดอร์เลื่อนกวาดซ้าย-ขวาเทียบก่อนหน้ากับหลังเปลี่ยน',
      'room-makeover': 'ห้องทำงานภาพประกอบ SVG ที่เปลี่ยนจากรกวุ่นวายเป็นระเบียบเรียบร้อย',
      'graph-flip': 'กราฟแท่งและเส้นแนวโน้มที่พลิกจากขาลงก่อนหน้าเป็นขาขึ้นหลังเปลี่ยน',
      'mirror-portrait': 'ซิลลูเอตตัวละครในกระจกเทียบก่อนและหลังพร้อมลูกศรชี้จุดเปลี่ยน',
    },
    infer: (scene) => {
      const text = haystackOfG(scene);
      if (scene.stat || GRAPH_RE.test(text)) {
        return 'graph-flip';
      }
      if (ROOM_RE.test(text)) {
        return 'room-makeover';
      }
      if (PERSON_RE.test(text)) {
        return 'mirror-portrait';
      }
      if (scene.compare || COMPARE_RE.test(text)) {
        return 'split-slider';
      }
      return null;
    },
  },
  {
    styleId: 'look-25',
    shots: {
      'post-card': Look25PostCard,
      'screenshot-evidence': Look25ScreenshotEvidence,
      'comment-storm': Look25CommentStorm,
      'viral-meter': Look25ViralMeter,
    },
    shotLabels: {
      'post-card': 'การ์ดโพสต์โซเชียลพร้อมอวาตาร์ ชื่อผู้โพสต์ และยอดไลก์/แชร์ที่วิ่งขึ้น',
      'screenshot-evidence': 'ภาพแคปโพสต์ปักหมุดบนบอร์ดหลักฐานพร้อมปากกาไฮไลต์ขีดทับประโยคสำคัญ',
      'comment-storm': 'คอมเมนต์จากผู้ใช้หลั่งไหลเข้ามาต่อเนื่องใต้โพสต์ต้นทาง',
      'viral-meter': 'แผนผังเครือข่ายการแชร์ต่อของโพสต์พร้อมตัวเลขการเข้าถึง (Reach)',
    },
    infer: (scene) => {
      const text = haystackOfG(scene);
      if (scene.quote?.text || SUMMARY_RE.test(text)) {
        return 'screenshot-evidence';
      }
      if (scene.stat || VIRAL_RE.test(text)) {
        return 'viral-meter';
      }
      if (COMMENT_RE.test(text) || (Array.isArray(scene.bullets) && scene.bullets.length >= 3)) {
        return 'comment-storm';
      }
      if (POST_RE.test(text)) {
        return 'post-card';
      }
      return null;
    },
  },
];
