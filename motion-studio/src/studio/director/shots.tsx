/**
 * Illustrated shot compositions. Each shot stages the scene as its own drawn moment:
 * the data (bullets / stat / steps / compare / quote) lives INSIDE the drawing —
 * on speech bubbles, sticky notes, a whiteboard, a held paper, a phone screen, stair risers —
 * instead of glass cards floating over a fixed background.
 */
import React from 'react';
import { StudioScene, StudioStepItem } from '../types';
import {
  DoodleDefs,
  DoodleTheme,
  DrawCtx,
  HandText,
  Person,
  Prop,
  ThoughtCloud,
  bubblePath,
  clamp01,
  easeOutCubic,
  hash01,
  jit,
  popIn,
  wobLine,
  wobRect,
} from './doodleKit';
import { Mood, PropName, ShotPlan, parseCrowdRatio } from './plan';

export interface ShotArgs {
  ctx: DrawCtx;
  scene: StudioScene;
  plan: ShotPlan;
  dur: number;
}

const W = 1080;
const H = 1920;

// ============================================================================
// SHARED PIECES
// ============================================================================

export const Svg: React.FC<{ theme: DoodleTheme; children: React.ReactNode; style?: React.CSSProperties }> = ({ theme, children, style }) => (
  <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, overflow: 'visible', ...style }}>
    <DoodleDefs theme={theme} />
    {children}
  </svg>
);

function moodAt(plan: ShotPlan, t: number, dur: number): Mood {
  return t < dur * 0.36 ? plan.startMood : plan.mood;
}

function bulletsOf(scene: StudioScene, max = 4): string[] {
  if (scene.bullets && scene.bullets.length) return scene.bullets.slice(0, max).map((b) => String(b));
  if (scene.steps && scene.steps.length) {
    return scene.steps.slice(0, max).map((s) => (typeof s === 'string' ? s : s.title));
  }
  return [];
}

function stepsOf(scene: StudioScene): StudioStepItem[] {
  const raw = scene.steps && scene.steps.length ? scene.steps : (scene.bullets || []).map((b) => String(b));
  return raw.slice(0, 4).map((item, idx) =>
    typeof item === 'string' ? { step: String(idx + 1), title: item } : { step: item.step || String(idx + 1), title: item.title, detail: item.detail },
  );
}

function highlightOf(scene: StudioScene): string {
  const h = scene.highlight;
  if (Array.isArray(h)) return h[0] || '';
  return h || '';
}

function statText(scene: StudioScene): { value: string; label: string } | null {
  if (!scene.stat) return null;
  const v = String(scene.stat.value ?? '').trim();
  if (!v) return null;
  const unit = scene.stat.unit && !v.includes(scene.stat.unit) && scene.stat.unit.length <= 6 ? ` ${scene.stat.unit}` : '';
  return { value: `${v}${unit}`, label: scene.stat.label || '' };
}

/** Pick props for a slot type from the plan (with sensible fallbacks) */
function pickProps(plan: ShotPlan, allowed: PropName[], fallback: PropName[], n: number): PropName[] {
  const out = plan.props.filter((p) => allowed.includes(p));
  for (const f of fallback) if (out.length < n && !out.includes(f)) out.push(f);
  return out.slice(0, n);
}

const WALL_PROPS: PropName[] = ['clock', 'calendar', 'window', 'chart', 'bulb'];
const DESK_PROPS: PropName[] = ['mug', 'cup-tower', 'money', 'phone', 'book', 'trophy', 'plant', 'robot', 'resume', 'briefcase', 'rocket'];
const FLOAT_PROPS: PropName[] = ['question', 'bulb', 'heart', 'fire', 'star', 'money', 'robot', 'rocket', 'check', 'cross', 'chart', 'clock', 'phone', 'trophy'];

/** Room / outdoor backdrop */
const Backdrop: React.FC<{ ctx: DrawCtx; env: 'indoor' | 'outdoor'; floorY: number; k?: number }> = ({ ctx, env, floorY, k = 0 }) => {
  const { theme } = ctx;
  const sil = theme.mode === 'silhouette';
  if (env === 'outdoor') {
    return (
      <g>
        <rect x={0} y={0} width={W} height={H} fill={sil ? 'url(#dd-dusk)' : theme.sky} />
        {!sil && <rect x={0} y={floorY - 260} width={W} height={260} fill={theme.skyLow} opacity={0.6} />}
        {!sil &&
          [
            [190, 420, 1],
            [820, 520, 0.8],
            [520, 360, 0.6],
          ].map(([cx, cy, sc], i) => (
            <g key={i} transform={`translate(${cx + Math.sin((ctx.t + i * 40) * 0.01) * 20} ${cy}) scale(${sc})`}>
              <path d="M -110 30 Q -120 -20 -70 -24 Q -50 -70 0 -56 Q 40 -86 80 -40 Q 130 -36 116 30 Z" fill="#FFFFFF" stroke={theme.ink} strokeWidth={theme.sw.fine} strokeLinejoin="round" />
            </g>
          ))}
        <path d={`M 0 ${floorY - 90} Q 270 ${floorY - 190} 540 ${floorY - 110} Q 800 ${floorY - 40} ${W} ${floorY - 150} L ${W} ${floorY} L 0 ${floorY} Z`} fill={sil ? '#2A1B33' : theme.ground} stroke={sil ? 'none' : theme.ink} strokeWidth={theme.sw.fine} opacity={sil ? 1 : 0.85} />
        <rect x={0} y={floorY} width={W} height={H - floorY} fill={theme.groundFront} />
        <path d={wobLine(ctx, 0, floorY, W, floorY, k + 5, 3)} stroke={theme.ink} strokeWidth={theme.sw.prop} fill="none" />
      </g>
    );
  }
  return (
    <g>
      <rect x={0} y={0} width={W} height={H} fill={sil ? '#2A1B33' : 'url(#dd-room)'} />
      {sil && <rect x={0} y={0} width={W} height={H} fill="url(#dd-room)" opacity={0.9} />}
      <rect x={0} y={floorY} width={W} height={H - floorY} fill={theme.floorFront} />
      <path d={wobLine(ctx, 0, floorY, W, floorY, k + 5, 3)} stroke={sil ? theme.rim || theme.ink : theme.ink} strokeWidth={sil ? 2.5 : theme.sw.prop} fill="none" opacity={sil ? 0.6 : 1} />
    </g>
  );
};

const Grain: React.FC<{ theme: DoodleTheme }> = ({ theme }) =>
  theme.grain > 0 ? <rect x={0} y={0} width={W} height={H} fill="url(#dd-grain)" opacity={theme.grain * 2.2} style={{ mixBlendMode: 'multiply' }} /> : null;

/** Silhouette look: hanging lamp cone + window glow */
const MoodLight: React.FC<{ ctx: DrawCtx; x?: number }> = ({ ctx, x = 540 }) => {
  const { theme } = ctx;
  if (theme.mode !== 'silhouette') return null;
  return (
    <g>
      <path d={`M ${x} 0 L ${x} 220`} stroke="#0B0810" strokeWidth={4} />
      <path d={`M ${x - 60} 270 L ${x - 30} 220 L ${x + 30} 220 L ${x + 60} 270 Z`} fill="#0B0810" stroke={theme.rim} strokeWidth={2} />
      <path d={`M ${x - 60} 270 L ${x - 330} 1300 L ${x + 330} 1300 L ${x + 60} 270 Z`} fill="url(#dd-lamp)" opacity={0.55} />
      {Array.from({ length: 14 }).map((_, i) => (
        <circle key={i} cx={x - 200 + hash01(i * 3.3) * 400} cy={360 + ((hash01(i * 7.1) * 900 + ctx.t * (0.6 + hash01(i) * 0.8)) % 900)} r={1.5 + hash01(i * 2.2) * 2} fill={theme.lamp} opacity={0.5} />
      ))}
    </g>
  );
};

/** Hand-lettered scene caption (badge tag + title) */
export const Caption: React.FC<{ ctx: DrawCtx; scene: StudioScene; dark?: boolean }> = ({ ctx, scene }) => {
  const { theme, t } = ctx;
  const sil = theme.mode === 'silhouette';
  const reveal = clamp01((t - 2) / 16);
  const badge = (scene.badge || '').trim();
  const tagPop = popIn(t, 0, 10);
  return (
    <>
      <Svg theme={theme}>
        {badge && (
          <g transform={`translate(540 104) scale(${tagPop}) rotate(${-2 + jit(ctx, 3, 0.6)})`}>
            <path d={wobRect(ctx, -Math.min(420, 40 + badge.length * 15), -30, Math.min(840, 80 + badge.length * 30), 60, 10, 11)} fill={sil ? '#1A1220' : theme.accent} stroke={sil ? theme.rim : theme.ink} strokeWidth={sil ? 2 : theme.sw.fine} />
          </g>
        )}
        <path
          d={wobLine(ctx, 150, 330, 150 + 780 * easeOutCubic(clamp01((t - 10) / 14)), 326, 21, 2.5)}
          stroke={sil ? theme.rim : theme.accent}
          strokeWidth={sil ? 4 : theme.sw.prop}
          strokeLinecap="round"
          fill="none"
          opacity={sil ? 0.9 : 0.85}
        />
      </Svg>
      {badge && (
        <HandText
          x={140}
          y={78}
          w={800}
          h={52}
          text={badge}
          max={30}
          min={20}
          color={sil ? theme.textInk : '#F7F1E6'}
          font={theme.bodyFont}
          reveal={tagPop > 0.6 ? 1 : 0}
        />
      )}
      <HandText
        x={60}
        y={140}
        w={960}
        h={178}
        text={scene.title}
        max={82}
        min={40}
        color={theme.captionColor}
        font={theme.captionFont}
        weight={700}
        reveal={reveal}
        lineHeight={1.22}
        shadow={sil ? `0 0 18px ${theme.rim}88, 0 2px 0 #000` : undefined}
      />
    </>
  );
};

/** Sticky note with handwritten text */
const Sticky: React.FC<{ ctx: DrawCtx; x: number; y: number; w: number; h: number; text: string; color: string; rot: number; k: number; appear: number; textColor?: string }> = ({
  ctx,
  x,
  y,
  w,
  h,
  text,
  color,
  rot,
  k,
  appear,
  textColor,
}) => {
  const { theme } = ctx;
  const sc = appear;
  if (sc <= 0) return null;
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, transform: `rotate(${rot}deg) scale(${sc})`, transformOrigin: '50% 0%' }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <path d={wobRect(ctx, 0, 0, w, h, 6, k)} fill={color} stroke={theme.mode === 'silhouette' ? theme.rim : theme.ink} strokeWidth={theme.mode === 'silhouette' ? 2 : theme.sw.fine} />
        <rect x={w / 2 - 44} y={-14} width={88} height={30} fill={theme.mode === 'silhouette' ? '#3B2C46' : '#E8DDBF'} opacity={0.85} transform={`rotate(${jit(ctx, k, 4)} ${w / 2} 0)`} />
      </svg>
      <HandText x={16} y={22} w={w - 32} h={h - 38} text={text} max={40} min={20} color={textColor || theme.textInk} font={theme.bodyFont} />
    </div>
  );
};

const STICKY_COLORS = ['#F6E7A8', '#F3C9B8', '#CFE3D6', '#D9D3EE'];

/** Speech bubble with handwritten text */
const Bubble: React.FC<{
  ctx: DrawCtx;
  x: number;
  y: number;
  w: number;
  h: number;
  tx: number;
  ty: number;
  text: string;
  k: number;
  appear: number;
  accent?: string;
  max?: number;
  reveal?: number;
}> = ({ ctx, x, y, w, h, tx, ty, text, k, appear, accent, max = 44, reveal = 1 }) => {
  const { theme } = ctx;
  if (appear <= 0) return null;
  const sil = theme.mode === 'silhouette';
  const ox = (tx - x) / w;
  const oy = (ty - y) / h;
  return (
    <div style={{ position: 'absolute', inset: 0, transform: `scale(${appear})`, transformOrigin: `${x + w * clamp01(ox)}px ${y + h * clamp01(oy)}px` }}>
      <Svg theme={theme}>
        <path d={bubblePath(ctx, x, y, w, h, tx, ty, k)} fill={theme.bubbleFill} stroke={sil ? theme.rim : theme.ink} strokeWidth={sil ? 3 : theme.sw.prop} strokeLinejoin="round" />
        {accent && <path d={wobRect(ctx, x + 14, y + 14, 14, h - 28, 6, k + 40)} fill={accent} stroke="none" />}
      </Svg>
      <HandText x={x + 34} y={y + 18} w={w - 62} h={h - 36} text={text} max={max} min={20} color={theme.bubbleText} font={theme.bodyFont} reveal={reveal} align={text.includes('\n') ? 'left' : 'center'} />
    </div>
  );
};

// ============================================================================
// SHOT 1 — POV DESK (classic "life as..." framing)
// ============================================================================

const ShotPovDesk: React.FC<ShotArgs> = ({ ctx, scene, plan, dur }) => {
  const { theme, t } = ctx;
  const mood = moodAt(plan, t, dur);
  const deskY = 1170;
  const bullets = bulletsOf(scene, 4);
  const stat = statText(scene);
  const wallProps = pickProps(plan, WALL_PROPS, ['clock', 'calendar'], 2);
  const deskProps = pickProps(plan, DESK_PROPS, ['mug', 'cup-tower'], 2);
  const useNotes = bullets.length > 0;
  const notePos: Array<[number, number, number]> = [
    [44, 380, -4],
    [726, 372, 3],
    [44, 690, 2],
    [726, 690, -3],
  ];
  const pose = plan.pose === 'cheer' && t < dur * 0.36 ? 'type' : plan.pose;
  const happyEnd = plan.mood === 'happy' && t > dur * 0.36;

  return (
    <>
      <Svg theme={theme}>
        <Backdrop ctx={ctx} env={plan.env} floorY={deskY + 70} />
        <MoodLight ctx={ctx} />
        {!useNotes && !stat && !scene.subtitle && wallProps[0] && <Prop ctx={ctx} name={wallProps[0]} x={190} y={500} s={1.1} k={1} label={String(plan.day)} />}
        {!useNotes && wallProps[1] && <Prop ctx={ctx} name={wallProps[1]} x={880} y={500} s={1.05} k={2} label={String(plan.day)} />}
        <Person ctx={ctx} x={540} y={905} s={1.32} role="hero" pose={pose} mood={mood} facing={0} k={10} />
        {/* desk */}
        <path d={`M -20 ${deskY} L 1100 ${deskY - 8} L 1100 ${deskY + 70} L -20 ${deskY + 70} Z`} fill={theme.floor} stroke={theme.mode === 'silhouette' ? 'none' : theme.ink} strokeWidth={theme.sw.prop} />
        {theme.mode === 'silhouette' && <ellipse cx={540} cy={deskY + 20} rx={330} ry={38} fill={theme.lamp} opacity={0.18} />}
        {pose === 'type' || pose === 'think' || pose === 'facepalm' ? <Prop ctx={ctx} name="laptop" x={540} y={deskY - 30} s={1.05} k={3} /> : null}
        {deskProps[0] && <Prop ctx={ctx} name={deskProps[0]} x={170} y={deskY - 40} s={0.95} k={4} label="3" />}
        {deskProps[1] && <Prop ctx={ctx} name={deskProps[1]} x={900} y={deskY - 40} s={0.95} k={5} label={String(Math.min(4, plan.day % 5))} />}
        {happyEnd &&
          [0, 1, 2, 3, 4, 5].map((i) => {
            const p = popIn(t, dur * 0.4 + i * 3, 10);
            return <Prop key={i} ctx={ctx} name="star" x={140 + i * 160} y={360 + (i % 2) * 120 - p * 20} s={0.45 * p} k={40 + i} />;
          })}
        <Grain theme={theme} />
      </Svg>
      {useNotes &&
        bullets.map((b, i) => (
          <Sticky key={i} ctx={ctx} x={notePos[i][0]} y={notePos[i][1]} w={310} h={250} text={b} color={theme.mode === 'silhouette' ? '#2A1E30' : STICKY_COLORS[i % 4]} rot={notePos[i][2]} k={60 + i * 7} appear={popIn(t, 8 + i * Math.max(6, Math.floor(dur * 0.12)), 12)} />
        ))}
      {!useNotes && stat && (
        <Sticky ctx={ctx} x={44} y={380} w={330} h={280} text={`${stat.value}\n${stat.label}`} color={theme.mode === 'silhouette' ? '#2A1E30' : '#F6E7A8'} rot={-3} k={70} appear={popIn(t, 10, 12)} />
      )}
      {!useNotes && !stat && scene.subtitle && (
        <Sticky ctx={ctx} x={44} y={380} w={320} h={250} text={scene.subtitle} color={theme.mode === 'silhouette' ? '#2A1E30' : '#F6E7A8'} rot={-3} k={72} appear={popIn(t, 10, 12)} />
      )}
    </>
  );
};

// ============================================================================
// SHOT 2 — INTERVIEW / DIALOGUE (two characters + speech bubbles)
// ============================================================================

const ShotInterview: React.FC<ShotArgs> = ({ ctx, scene, plan, dur }) => {
  const { theme, t } = ctx;
  const mood = moodAt(plan, t, dur);
  const other = plan.cast.find((c) => c !== 'hero') || 'interviewer';
  const tableY = 1240;
  let leftText = scene.subtitle || scene.title;
  let rightText = highlightOf(scene) || '...';
  let leftAccent: string | undefined;
  let rightAccent: string | undefined;
  if (scene.compare) {
    const c = scene.compare;
    leftText = `✗ ${c.leftTitle || ''}\n${(c.leftItems || []).slice(0, 2).join('\n')}`;
    rightText = `✓ ${c.rightTitle || ''}\n${(c.rightItems || []).slice(0, 2).join('\n')}`;
    leftAccent = theme.accent;
    rightAccent = theme.good;
  } else if (scene.quote?.text) {
    rightText = scene.quote.text;
  } else if (bulletsOf(scene).length) {
    rightText = bulletsOf(scene, 3).map((b) => `• ${b}`).join('\n');
    leftText = scene.subtitle || scene.title;
  } else if (statText(scene)) {
    const st = statText(scene)!;
    rightText = `${st.value} ${st.label}`;
  }
  const otherMood: Mood = t < dur * 0.5 ? 'think' : plan.mood === 'happy' ? 'happy' : plan.mood === 'panic' ? 'smug' : 'confident';
  const tableProps = pickProps(plan, ['resume', 'mug', 'phone', 'money', 'book', 'chart', 'laptop'], ['resume', 'mug'], 2);
  return (
    <>
      <Svg theme={theme}>
        <Backdrop ctx={ctx} env={plan.env} floorY={tableY + 60} />
        <MoodLight ctx={ctx} x={540} />
        {theme.mode !== 'silhouette' && <Prop ctx={ctx} name="window" x={540} y={960} s={0.7} k={1} />}
        {theme.mode === 'silhouette' && <Prop ctx={ctx} name="window" x={540} y={900} s={0.95} k={1} />}
        <Person ctx={ctx} x={265} y={1052} s={1.02} role={other} pose={t > dur * 0.5 ? 'think' : 'hold'} mood={otherMood} facing={1} k={20} />
        <Person ctx={ctx} x={815} y={1052} s={1.02} role="hero" pose={plan.pose === 'think' ? 'think' : t > dur * 0.5 ? 'shrug' : 'stand'} mood={mood} facing={-1} k={30} />
        <path d={`M -20 ${tableY} L 1100 ${tableY + 6} L 1100 ${tableY + 60} L -20 ${tableY + 60} Z`} fill={theme.floor} stroke={theme.mode === 'silhouette' ? 'none' : theme.ink} strokeWidth={theme.sw.prop} />
        {tableProps[0] && <Prop ctx={ctx} name={tableProps[0]} x={250} y={tableY - 20} s={0.7} rot={-8} k={4} />}
        {tableProps[1] && <Prop ctx={ctx} name={tableProps[1]} x={880} y={tableY - 34} s={0.75} k={5} />}
        <Grain theme={theme} />
      </Svg>
      <Bubble ctx={ctx} x={40} y={352} w={640} h={scene.compare ? 250 : 176} tx={260} ty={846} text={leftText} k={80} appear={popIn(t, 6, 12)} accent={leftAccent} reveal={clamp01((t - 8) / 14)} />
      <Bubble ctx={ctx} x={380} y={scene.compare ? 622 : 552} w={660} h={scene.compare ? 196 : 266} tx={820} ty={848} text={rightText} k={90} appear={popIn(t, Math.floor(dur * 0.4), 12)} accent={rightAccent} reveal={clamp01((t - dur * 0.4 - 2) / 14)} />
    </>
  );
};

// ============================================================================
// SHOT 3 — WHITEBOARD / PRESENTER
// ============================================================================

const ShotWhiteboard: React.FC<ShotArgs> = ({ ctx, scene, plan, dur }) => {
  const { theme, t } = ctx;
  const sil = theme.mode === 'silhouette';
  const mood = moodAt(plan, t, dur);
  const floorY = 1390;
  const bx = 56;
  const by = 360;
  const bw = 730;
  const bh = 760;
  const stat = statText(scene);
  const items = bulletsOf(scene, 4);
  const floorProp = pickProps(plan, ['plant', 'briefcase', 'trophy', 'robot', 'money', 'rocket'], ['plant'], 1)[0];
  const step = Math.max(6, Math.floor((dur * 0.7) / Math.max(1, items.length)));

  let content: React.ReactNode = null;
  if (scene.compare) {
    const c = scene.compare;
    content = (
      <>
        <HandText x={bx + 30} y={by + 40} w={bw / 2 - 50} h={70} text={`✗ ${c.leftTitle || ''}`} max={40} color={theme.accent} font={theme.bodyFont} reveal={clamp01((t - 6) / 10)} />
        <HandText x={bx + bw / 2 + 20} y={by + 40} w={bw / 2 - 50} h={70} text={`✓ ${c.rightTitle || ''}`} max={40} color={theme.good} font={theme.bodyFont} reveal={clamp01((t - dur * 0.4) / 10)} />
        <HandText x={bx + 30} y={by + 130} w={bw / 2 - 50} h={bh - 190} text={(c.leftItems || []).slice(0, 3).join('\n\n')} max={32} color={theme.textInk} font={theme.bodyFont} valign="top" reveal={clamp01((t - 10) / 16)} />
        <HandText x={bx + bw / 2 + 20} y={by + 130} w={bw / 2 - 50} h={bh - 190} text={(c.rightItems || []).slice(0, 3).join('\n\n')} max={32} color={theme.textInk} font={theme.bodyFont} valign="top" reveal={clamp01((t - dur * 0.4 - 4) / 16)} />
      </>
    );
  } else if (items.length) {
    const rowH = Math.min(170, (bh - 80) / items.length);
    content = (
      <>
        {items.map((b, i) => (
          <HandText key={i} x={bx + 110} y={by + 40 + i * rowH} w={bw - 150} h={rowH - 14} text={b} max={40} color={theme.textInk} font={theme.bodyFont} align="left" reveal={clamp01((t - 6 - i * step) / 12)} />
        ))}
      </>
    );
  } else if (stat) {
    content = (
      <>
        <HandText x={bx + 30} y={by + 70} w={bw - 60} h={260} text={stat.value} max={170} color={theme.accent} font={theme.captionFont} reveal={clamp01((t - 6) / 12)} />
        <HandText x={bx + 40} y={by + 340} w={bw - 80} h={150} text={stat.label} max={46} color={theme.textInk} font={theme.bodyFont} reveal={clamp01((t - 14) / 14)} />
      </>
    );
  } else {
    content = <HandText x={bx + 40} y={by + 60} w={bw - 80} h={bh - 260} text={scene.quote?.text || scene.subtitle || scene.title} max={56} color={theme.textInk} font={theme.bodyFont} reveal={clamp01((t - 6) / 18)} />;
  }

  return (
    <>
      <Svg theme={theme}>
        <Backdrop ctx={ctx} env="indoor" floorY={floorY} />
        <MoodLight ctx={ctx} x={420} />
        {/* easel legs */}
        <path d={`M ${bx + 120} ${by + bh} L ${bx + 70} ${floorY + 30} M ${bx + bw - 120} ${by + bh} L ${bx + bw - 70} ${floorY + 30}`} stroke={theme.ink} strokeWidth={theme.sw.prop * 1.4} strokeLinecap="round" />
        <path d={wobRect(ctx, bx, by, bw, bh, 14, 3)} fill={theme.board} stroke={sil ? theme.rim : theme.ink} strokeWidth={sil ? 3 : theme.sw.prop * 1.3} />
        <path d={wobRect(ctx, bx + 40, by + bh - 6, bw - 80, 26, 6, 9)} fill={theme.floor} stroke={theme.ink} strokeWidth={theme.sw.fine} />
        {scene.compare && <path d={wobLine(ctx, bx + bw / 2, by + 40, bx + bw / 2, by + bh - 40, 7, 3)} stroke={theme.ink} strokeWidth={theme.sw.fine} fill="none" />}
        {!scene.compare && items.length > 0 &&
          items.map((_, i) => {
            const rowH = Math.min(170, (bh - 80) / items.length);
            const cy = by + 40 + i * rowH + (rowH - 14) / 2;
            const on = t > 10 + i * step;
            return (
              <g key={i}>
                <path d={wobRect(ctx, bx + 36, cy - 24, 48, 48, 6, 30 + i)} fill="none" stroke={theme.ink} strokeWidth={theme.sw.fine} />
                {on && <path d={`M ${bx + 42} ${cy} L ${bx + 58} ${cy + 18} L ${bx + 92} ${cy - 30}`} fill="none" stroke={theme.good} strokeWidth={theme.sw.prop * 1.2} strokeLinecap="round" strokeLinejoin="round" />}
              </g>
            );
          })}
        {!scene.compare && !items.length && stat && <g opacity={0.9}><Prop ctx={ctx} name="chart" x={bx + bw / 2} y={by + bh - 150} s={0.9} k={8} /></g>}
        {floorProp && <Prop ctx={ctx} name={floorProp} x={110} y={floorY + 10} s={0.8} k={6} />}
        <Person ctx={ctx} x={905} y={1060} s={0.98} role="hero" pose="present" mood={mood} facing={-1} legs k={40} />
        <Grain theme={theme} />
      </Svg>
      {content}
    </>
  );
};

// ============================================================================
// SHOT 4 — CLOSE-UP REACTION + THOUGHT CLOUD
// ============================================================================

const ShotCloseup: React.FC<ShotArgs> = ({ ctx, scene, plan, dur }) => {
  const { theme, t } = ctx;
  const sil = theme.mode === 'silhouette';
  const mood = moodAt(plan, t, dur);
  const stat = statText(scene);
  const floats = pickProps(plan, FLOAT_PROPS, ['question', 'bulb'], 2);
  const burst = mood === 'shock' || mood === 'panic' || mood === 'happy';
  const cloudText = stat ? stat.value : highlightOf(scene) || scene.subtitle || '';
  const cloudSub = stat ? stat.label : highlightOf(scene) && scene.subtitle ? scene.subtitle : '';
  const cp = popIn(t, 8, 14);
  return (
    <>
      <Svg theme={theme}>
        <rect x={0} y={0} width={W} height={H} fill={sil ? '#2A1B33' : 'url(#dd-room)'} />
        {burst &&
          Array.from({ length: 22 }).map((_, i) => {
            const a = (i / 22) * Math.PI * 2 + jit(ctx, i, 0.03);
            const r1 = 360 + (i % 2) * 40;
            return (
              <path
                key={i}
                d={`M ${540 + Math.cos(a) * r1} ${1000 + Math.sin(a) * r1} L ${540 + Math.cos(a) * 1400} ${1000 + Math.sin(a) * 1400}`}
                stroke={sil ? theme.rim : mood === 'happy' ? theme.good : theme.accent}
                strokeWidth={i % 2 ? 6 : 12}
                opacity={sil ? 0.25 : 0.22}
              />
            );
          })}
        {floats.map((p, i) => (
          <Prop key={p} ctx={ctx} name={p} x={i === 0 ? 150 : 930} y={860 + Math.sin(t * 0.12 + i) * 16} s={0.75 * popIn(t, 14 + i * 5, 12)} rot={i === 0 ? -12 : 12} k={50 + i} />
        ))}
        <Person ctx={ctx} x={540} y={1300} s={2.45} role="hero" pose={plan.pose === 'facepalm' && t > dur * 0.36 ? 'facepalm' : plan.pose === 'think' ? 'think' : 'stand'} mood={mood} facing={0} k={60} />
        {cloudText && cp > 0 && (
          <g transform={`translate(540 520) scale(${cp}) translate(-540 -520)`}>
            <ThoughtCloud ctx={ctx} x={110} y={330} w={860} h={360} tx={540} ty={770} k={70} fill={theme.bubbleFill} />
          </g>
        )}
        <Grain theme={theme} />
      </Svg>
      {cloudText && cp > 0.5 && (
        <>
          <HandText x={220} y={cloudSub ? 370 : 380} w={640} h={cloudSub ? 190 : 280} text={cloudText} max={stat ? 150 : 72} color={stat ? theme.accent : theme.bubbleText} font={theme.captionFont} reveal={clamp01((t - 12) / 10)} />
          {cloudSub && <HandText x={230} y={560} w={620} h={100} text={cloudSub} max={40} color={theme.bubbleText} font={theme.bodyFont} reveal={clamp01((t - 18) / 12)} />}
        </>
      )}
    </>
  );
};

// ============================================================================
// SHOT 5 — CROWD (x out of 100)
// ============================================================================

const MiniHead: React.FC<{ ctx: DrawCtx; x: number; y: number; r: number; hit: boolean; dim: number; k: number; happy: boolean }> = ({ ctx, x, y, r, hit, dim, k, happy }) => {
  const { theme } = ctx;
  const sil = theme.mode === 'silhouette';
  const fill = hit ? (sil ? theme.rim! : theme.accent) : sil ? '#0B0810' : theme.skin;
  const eye = hit && !sil ? '#FFFFFF' : sil ? '#FFFFFF' : theme.ink;
  return (
    <g transform={`translate(${x + jit(ctx, k, 1.2)} ${y + jit(ctx, k + 3, 1.2)})`} opacity={hit ? 1 : dim}>
      <path d={`M ${-r * 1.05} ${r * 1.9} Q ${-r} ${r * 0.9} 0 ${r * 0.85} Q ${r} ${r * 0.9} ${r * 1.05} ${r * 1.9} Z`} fill={hit ? fill : sil ? '#0B0810' : theme.garments.friend} stroke={sil ? 'none' : theme.ink} strokeWidth={theme.sw.fine * 0.8} />
      <circle cx={0} cy={0} r={r} fill={fill} stroke={sil ? 'none' : theme.ink} strokeWidth={theme.sw.fine} />
      <circle cx={-r * 0.36} cy={-r * 0.05} r={r * 0.11} fill={eye} />
      <circle cx={r * 0.36} cy={-r * 0.05} r={r * 0.11} fill={eye} />
      {hit && happy && <path d={`M ${-r * 0.4} ${r * 0.3} Q 0 ${r * 0.7} ${r * 0.4} ${r * 0.3}`} fill="none" stroke={eye} strokeWidth={theme.sw.fine * 0.8} strokeLinecap="round" />}
    </g>
  );
};

const ShotCrowd: React.FC<ShotArgs> = ({ ctx, scene, plan, dur }) => {
  const { theme, t } = ctx;
  const sil = theme.mode === 'silhouette';
  const ratio = parseCrowdRatio(scene) || { hit: 1, of: 40 };
  const big = ratio.of > 40;
  const cols = big ? 10 : 8;
  const rows = big ? 10 : 5;
  const total = cols * rows;
  const hits = Math.max(1, Math.min(total, Math.round((ratio.hit / ratio.of) * total)));
  const cell = big ? 80 : 108;
  const gx = (W - cols * cell) / 2 + cell / 2;
  const gy = 400;
  const r = big ? 24 : 35;
  // deterministic scattered hit positions
  const order = Array.from({ length: total }, (_, i) => i).sort((a, b) => hash01(a * 9.7 + 3) - hash01(b * 9.7 + 3));
  const hitSet = new Set(order.slice(0, hits));
  const firstHit = order[0];
  const dimP = clamp01((t - dur * 0.32) / 14);
  const dim = 1 - dimP * 0.68;
  const stat = statText(scene);
  const label = stat ? String(scene.stat?.value ?? stat.value) : `${ratio.hit} / ${ratio.of}`;
  const reveal = Math.floor(clamp01(t / (dur * 0.28)) * total);
  const fh = { x: gx + (firstHit % cols) * cell, y: gy + Math.floor(firstHit / cols) * cell };
  const circleP = clamp01((t - dur * 0.36) / 12);
  const bottom = gy + rows * cell;
  return (
    <>
      <Svg theme={theme}>
        <rect x={0} y={0} width={W} height={H} fill={sil ? '#2A1B33' : 'url(#dd-room)'} />
        <MoodLight ctx={ctx} />
        {Array.from({ length: total }).map((_, i) => {
          if (i > reveal) return null;
          const cx = gx + (i % cols) * cell;
          const cy = gy + Math.floor(i / cols) * cell;
          return <MiniHead key={i} ctx={ctx} x={cx} y={cy} r={r} hit={hitSet.has(i) && dimP > 0} dim={dim} k={i * 3} happy={plan.mood === 'happy' || plan.mood === 'smug'} />;
        })}
        {circleP > 0 && (
          <g>
            <path
              d={`M ${fh.x + 58} ${fh.y - 10} A 58 58 0 1 1 ${fh.x + 58 * Math.cos(-0.17 + circleP * 6.1)} ${fh.y + 58 * Math.sin(-0.17 + circleP * 6.1)}`}
              fill="none"
              stroke={sil ? theme.lamp : theme.accent}
              strokeWidth={theme.sw.prop * 1.2}
              strokeLinecap="round"
            />
            <path d={wobLine(ctx, 540, bottom + 30, fh.x + (fh.x < 540 ? 40 : -40), fh.y + 70, 9, 3)} stroke={sil ? theme.lamp : theme.ink} strokeWidth={theme.sw.fine * 1.2} fill="none" strokeDasharray="14 12" opacity={circleP} />
          </g>
        )}
        <Grain theme={theme} />
      </Svg>
      <HandText x={60} y={bottom + 20} w={960} h={170} text={label} max={140} color={sil ? theme.lamp || theme.accent : theme.accent} font={theme.captionFont} reveal={clamp01((t - dur * 0.34) / 10)} shadow={sil ? `0 0 22px ${theme.rim}` : undefined} />
      <HandText x={90} y={bottom + 186} w={900} h={96} text={stat?.label || scene.subtitle || ''} max={44} color={theme.captionColor} font={theme.bodyFont} reveal={clamp01((t - dur * 0.42) / 12)} />
    </>
  );
};

// ============================================================================
// SHOT 6 — SPLIT PANELS (wrong vs right, same character twice)
// ============================================================================

const ShotSplit: React.FC<ShotArgs> = ({ ctx, scene, plan, dur }) => {
  const { theme, t } = ctx;
  const sil = theme.mode === 'silhouette';
  const c = scene.compare || {
    leftTitle: 'ก่อน',
    leftItems: bulletsOf(scene, 2).slice(0, 1),
    rightTitle: 'หลัง',
    rightItems: bulletsOf(scene, 2).slice(1),
  };
  const winnerLeft = c.winner === 'left';
  const panels = [
    { y: 352, title: c.leftTitle || '', items: c.leftItems || [], good: winnerLeft, appear: popIn(t, 4, 12) },
    { y: 880, title: c.rightTitle || '', items: c.rightItems || [], good: !winnerLeft, appear: popIn(t, Math.floor(dur * 0.38), 12) },
  ];
  const ph = 500;
  return (
    <>
      <Svg theme={theme}>
        <rect x={0} y={0} width={W} height={H} fill={sil ? '#170F1D' : theme.wallLow} />
        <Grain theme={theme} />
      </Svg>
      {panels.map((p, i) => {
        if (p.appear <= 0) return null;
        const tint = p.good ? theme.good : theme.accent;
        const pm: Mood = p.good ? (t > dur * 0.5 ? 'happy' : 'confident') : 'panic';
        const ox = 0;
        return (
          <div key={i} style={{ position: 'absolute', inset: 0, transform: `translateX(${(1 - Math.min(1, p.appear)) * (i ? 300 : -300)}px)`, opacity: Math.min(1, p.appear) }}>
            <Svg theme={theme}>
              <defs>
                <clipPath id={`dd-panel-${i}`}>
                  <rect x={40} y={p.y} width={1000} height={ph} rx={10} />
                </clipPath>
              </defs>
              <g clipPath={`url(#dd-panel-${i})`}>
                <rect x={40} y={p.y} width={1000} height={ph} fill={sil ? '#2A1B33' : theme.wall} />
                <rect x={40} y={p.y} width={1000} height={ph} fill={tint} opacity={sil ? 0.12 : 0.13} />
                <rect x={40} y={p.y + ph - 110} width={1000} height={110} fill={theme.floor} />
                <Person ctx={ctx} x={250 + ox} y={p.y + 300} s={0.85} role="hero" pose={p.good ? (t > dur * 0.55 ? 'cheer' : 'stand') : 'facepalm'} mood={pm} facing={1} k={100 + i * 20} />
                <Prop ctx={ctx} name={p.good ? 'check' : 'cross'} x={445} y={p.y + 120} s={0.8 * popIn(t, (i ? dur * 0.38 : 4) + 8, 10)} k={120 + i} />
              </g>
              <path d={wobRect(ctx, 40, p.y, 1000, ph, 10, 140 + i * 9)} fill="none" stroke={sil ? tint : theme.ink} strokeWidth={sil ? 4 : theme.sw.prop * 1.3} />
              <path d={wobRect(ctx, 520, p.y + 40, 480, 74, 10, 150 + i * 9)} fill={tint} stroke={sil ? 'none' : theme.ink} strokeWidth={theme.sw.fine} />
            </Svg>
            <HandText x={536} y={p.y + 44} w={450} h={66} text={`${p.good ? '✓' : '✗'} ${p.title}`} max={40} color={sil ? '#170F1D' : '#FBF7EE'} font={theme.bodyFont} />
            <HandText x={540} y={p.y + 132} w={460} h={ph - 160} text={p.items.slice(0, 3).map((s) => `• ${s}`).join('\n')} max={36} color={theme.textInk} font={theme.bodyFont} align="left" valign="top" reveal={clamp01((t - (i ? dur * 0.38 : 4) - 6) / 14)} />
          </div>
        );
      })}
    </>
  );
};

// ============================================================================
// SHOT 7 — STAIRS (steps: the character climbs each labelled step)
// ============================================================================

const ShotStairs: React.FC<ShotArgs> = ({ ctx, scene, plan, dur }) => {
  const { theme, t } = ctx;
  const sil = theme.mode === 'silhouette';
  const steps = stepsOf(scene);
  if (steps.length < 2) return <ShotWhiteboard ctx={ctx} scene={scene} plan={plan} dur={dur} />;
  const n = steps.length;
  const stepW = Math.floor(940 / n);
  const groundY = 1420;
  const base = 250;
  const rise = Math.min(200, Math.floor(520 / Math.max(1, n - 1)));
  const x0 = 70;
  const blocks = steps.map((s, i) => ({ s, x: x0 + i * stepW, top: groundY - base - i * rise }));
  const prog = clamp01((t - dur * 0.08) / (dur * 0.75));
  const pos = prog * (n - 1);
  const cur = Math.floor(pos);
  const frac = pos - cur;
  const hop = Math.sin(clamp01(frac * 1.6) * Math.PI) * 70;
  const b0 = blocks[Math.min(cur, n - 1)];
  const b1 = blocks[Math.min(cur + 1, n - 1)];
  const sc = n >= 4 ? 0.5 : 0.6;
  const fx = b0.x + stepW / 2 + (b1.x - b0.x) * clamp01(frac * 1.6);
  const fy = b0.top + (b1.top - b0.top) * clamp01(frac * 1.6) - hop;
  const atTop = prog >= 0.98;
  return (
    <>
      <Svg theme={theme}>
        <Backdrop ctx={ctx} env={plan.env} floorY={groundY} />
        <MoodLight ctx={ctx} x={760} />
        {blocks.map((b, i) => (
          <g key={i} opacity={popIn(t, i * 4, 10) > 0 ? 1 : 0}>
            <path d={wobRect(ctx, b.x, b.top, stepW, groundY - b.top + 4, 6, 200 + i * 7)} fill={i % 2 ? theme.floor : theme.floorFront} stroke={sil ? theme.rim : theme.ink} strokeWidth={sil ? 2.5 : theme.sw.prop} />
            <circle cx={b.x + 48} cy={b.top + 52} r={30} fill={i <= cur || atTop ? theme.accent : theme.paper} stroke={theme.ink} strokeWidth={theme.sw.fine} />
          </g>
        ))}
        <Prop ctx={ctx} name={plan.props.includes('rocket') ? 'rocket' : 'trophy'} x={blocks[n - 1].x + stepW / 2} y={blocks[n - 1].top - 130} s={0.8 * (atTop ? popIn(t, dur * 0.84, 10) : 0.55)} k={230} />
        <Person ctx={ctx} x={fx} y={fy - 336 * sc} s={sc} role="hero" pose={atTop ? 'cheer' : frac > 0.05 && frac < 0.6 ? 'wave' : 'point'} mood={atTop ? 'happy' : 'confident'} facing={1} legs k={240} />
        <Grain theme={theme} />
      </Svg>
      {blocks.map((b, i) => (
        <React.Fragment key={i}>
          <HandText x={b.x + 18} y={b.top + 30} w={60} h={46} text={String(b.s.step).slice(0, 3)} max={30} min={16} color={i <= cur || atTop ? '#FFFFFF' : theme.ink} font={theme.bodyFont} />
          <HandText x={b.x + 12} y={b.top + 92} w={stepW - 24} h={Math.min(groundY - b.top - 104, 240)} text={b.s.detail ? `${b.s.title}\n${b.s.detail}` : b.s.title} max={36} min={20} color={theme.textInk} font={theme.bodyFont} valign="top" reveal={clamp01((t - i * 5 - 4) / 10)} />
        </React.Fragment>
      ))}
    </>
  );
};

// ============================================================================
// SHOT 8 — HELD PAPER (true first-person: our own hands hold the page)
// ============================================================================

const PovHands: React.FC<{ ctx: DrawCtx; lx: number; ly: number; rx: number; ry: number }> = ({ ctx, lx, ly, rx, ry }) => {
  const { theme } = ctx;
  const sil = theme.mode === 'silhouette';
  const sleeve = sil ? theme.ink : theme.garments.hero;
  const lw = theme.body === 'stick' ? 26 : 120;
  const arm = (x1: number, y1: number, x2: number, y2: number, k: number) => (
    <g key={k}>
      <path d={`M ${x1} ${y1} Q ${(x1 + x2) / 2 + jit(ctx, k, 4)} ${(y1 + y2) / 2 + 40} ${x2} ${y2}`} stroke={sil ? theme.rim : theme.ink} strokeWidth={lw + (sil ? 6 : theme.sw.char * 1.6)} strokeLinecap="round" fill="none" />
      <path d={`M ${x1} ${y1} Q ${(x1 + x2) / 2 + jit(ctx, k, 4)} ${(y1 + y2) / 2 + 40} ${x2} ${y2}`} stroke={theme.body === 'stick' ? theme.ink : sleeve} strokeWidth={lw} strokeLinecap="round" fill="none" />
      <circle cx={x2} cy={y2} r={theme.body === 'stick' ? 44 : 64} fill={sil ? theme.ink : theme.mode === 'ink' ? '#FFFFFF' : theme.skin} stroke={sil ? theme.rim : theme.ink} strokeWidth={sil ? 3 : theme.sw.char} />
    </g>
  );
  return (
    <g>
      {arm(-80, 2000, lx, ly, 1)}
      {arm(1160, 2000, rx, ry, 2)}
    </g>
  );
};

const ShotHeldPaper: React.FC<ShotArgs> = ({ ctx, scene, plan, dur }) => {
  const { theme, t } = ctx;
  const sil = theme.mode === 'silhouette';
  const items = bulletsOf(scene, 4);
  const bob = Math.sin(t * 0.09) * 8;
  const enter = easeOutCubic(clamp01(t / 14));
  const py = 400 + (1 - enter) * 700 + bob;
  const px = 150;
  const pw = 780;
  const ph = 900;
  const bgProps = pickProps(plan, [...WALL_PROPS, ...DESK_PROPS], ['window', 'plant'], 2);
  const step = Math.max(6, Math.floor((dur * 0.65) / Math.max(1, items.length)));
  const isResume = plan.props.includes('resume');
  return (
    <>
      <Svg theme={theme}>
        <Backdrop ctx={ctx} env={plan.env} floorY={1250} />
        <g opacity={0.55}>
          {bgProps[0] && <Prop ctx={ctx} name={bgProps[0]} x={170} y={560} s={1.1} k={1} label={String(plan.day)} />}
          {bgProps[1] && <Prop ctx={ctx} name={bgProps[1]} x={920} y={1180} s={1} k={2} />}
        </g>
        <rect x={0} y={0} width={W} height={H} fill={sil ? '#000000' : theme.wallLow} opacity={0.35} />
        <g transform={`rotate(${-2 + Math.sin(t * 0.05)} 540 ${py + ph / 2})`}>
          <path d={wobRect(ctx, px, py, pw, ph, 8, 10)} fill={theme.paper} stroke={sil ? theme.rim : theme.ink} strokeWidth={sil ? 3 : theme.sw.prop} />
          {Array.from({ length: 9 }).map((_, i) => (
            <path key={i} d={wobLine(ctx, px + 40, py + 200 + i * 80, px + pw - 40, py + 200 + i * 80, 20 + i, 1.5)} stroke={theme.paperLine} strokeWidth={3} fill="none" />
          ))}
          <path d={wobLine(ctx, px + 110, py + 30, px + 110, py + ph - 30, 40, 1.5)} stroke={theme.accent} strokeWidth={3} opacity={0.5} fill="none" />
          {items.map((_, i) => {
            const cy = py + 220 + i * 165;
            const on = t > 14 + i * step + 6;
            return on ? <path key={i} d={`M ${px + 50} ${cy + 10} L ${px + 70} ${cy + 32} L ${px + 102} ${cy - 18}`} fill="none" stroke={theme.good} strokeWidth={theme.sw.prop * 1.2} strokeLinecap="round" strokeLinejoin="round" /> : null;
          })}
        </g>
        <PovHands ctx={ctx} lx={px + 10} ly={py + ph - 120} rx={px + pw - 10} ry={py + ph - 160} />
        <Grain theme={theme} />
      </Svg>
      <div style={{ position: 'absolute', inset: 0, transform: `rotate(${-2 + Math.sin(t * 0.05)}deg)`, transformOrigin: `540px ${py + ph / 2}px` }}>
        <HandText x={px + 130} y={py + 50} w={pw - 170} h={110} text={isResume ? `RESUME · ${scene.subtitle || ''}` : scene.subtitle || highlightOf(scene) || ''} max={44} color={theme.accent} font={theme.captionFont} align="left" reveal={clamp01((t - 10) / 12)} />
        {items.length > 0 ? (
          items.map((b, i) => (
            <HandText key={i} x={px + 130} y={py + 180 + i * 165} w={pw - 170} h={150} text={b} max={38} color={theme.textInk} font={theme.bodyFont} align="left" reveal={clamp01((t - 14 - i * step) / 12)} />
          ))
        ) : (
          <HandText x={px + 130} y={py + 190} w={pw - 170} h={ph - 260} text={scene.quote?.text || scene.imageCaption || scene.narration || ''} max={50} color={theme.textInk} font={theme.bodyFont} align="left" valign="top" reveal={clamp01((t - 12) / (dur * 0.5))} />
        )}
      </div>
    </>
  );
};

// ============================================================================
// SHOT 9 — DOOR (hook: stepping into the moment)
// ============================================================================

const ShotDoor: React.FC<ShotArgs> = ({ ctx, scene, plan, dur }) => {
  const { theme, t } = ctx;
  const sil = theme.mode === 'silhouette';
  const mood = moodAt(plan, t, dur);
  const open = easeOutCubic(clamp01((t - 6) / 18));
  const dx = 250;
  const dy = 490;
  
  const dw = 480;
  const dh = 880;
  const inside = plan.cast.find((c) => c !== 'hero') || (plan.props.includes('resume') || plan.props.includes('chair') ? 'interviewer' : 'boss');
  const stat = statText(scene);
  return (
    <>
      <Svg theme={theme}>
        <Backdrop ctx={ctx} env="indoor" floorY={dy + dh} />
        {/* interior light */}
        <defs>
          <clipPath id="dd-door-in">
            <rect x={dx} y={dy} width={dw} height={dh} />
          </clipPath>
        </defs>
        <g clipPath="url(#dd-door-in)">
          <rect x={dx} y={dy} width={dw} height={dh} fill={sil ? '#FFD7A0' : '#F6EBC8'} />
          <rect x={dx} y={dy + dh - 200} width={dw} height={200} fill={sil ? '#B3687C' : theme.floor} />
          <g opacity={open}>
            <Person ctx={ctx} x={dx + dw / 2} y={dy + 520} s={0.62} role={inside} pose="hold" mood="smug" facing={0} k={300} />
            <path d={`M ${dx + 40} ${dy + 640} L ${dx + dw - 40} ${dy + 640} L ${dx + dw - 40} ${dy + 700} L ${dx + 40} ${dy + 700} Z`} fill={sil ? '#2A1B33' : theme.floorFront} stroke={theme.ink} strokeWidth={theme.sw.fine} />
          </g>
        </g>
        {/* light spill on floor */}
        <path d={`M ${dx} ${dy + dh} L ${dx + dw} ${dy + dh} L ${dx + dw + 240 * open} 1920 L ${dx - 200 * open} 1920 Z`} fill={sil ? '#FFD7A0' : '#F6EBC8'} opacity={0.35 * open} />
        {/* door panel swinging open (hinge on left) */}
        <g transform={`translate(${dx} 0) scale(${1 - open * 0.82} 1) translate(${-dx} 0)`}>
          <path d={wobRect(ctx, dx, dy, dw, dh, 4, 8)} fill={sil ? '#1A1220' : '#8E6F55'} stroke={sil ? theme.rim : theme.ink} strokeWidth={sil ? 3 : theme.sw.prop} />
          <circle cx={dx + dw - 50} cy={dy + dh / 2} r={16} fill={sil ? theme.rim : '#E4C46A'} stroke={theme.ink} strokeWidth={theme.sw.fine} />
          <path d={wobRect(ctx, dx + 60, dy + 70, dw - 120, 300, 6, 9)} fill="none" stroke={theme.ink} strokeWidth={theme.sw.fine} opacity={0.6} />
        </g>
        <path d={wobRect(ctx, dx - 22, dy - 22, dw + 44, dh + 22, 4, 12)} fill="none" stroke={sil ? theme.rim : theme.ink} strokeWidth={sil ? 4 : theme.sw.prop * 1.5} />
        {/* sign plate */}
        <path d={wobRect(ctx, 200, 350, 680, 104, 10, 14)} fill={theme.paper} stroke={sil ? theme.rim : theme.ink} strokeWidth={sil ? 2.5 : theme.sw.prop} />
        <Person ctx={ctx} x={880} y={1250} s={1.1} role="hero" pose={mood === 'panic' || mood === 'shock' ? 'shrug' : 'stand'} mood={mood} facing={-1} legs k={320} />
        <Grain theme={theme} />
      </Svg>
      <HandText x={226} y={356} w={628} h={92} text={stat ? `${stat.value} ${stat.label}` : scene.subtitle || highlightOf(scene) || ''} max={40} color={theme.textInk} font={theme.bodyFont} reveal={clamp01((t - 4) / 12)} />
    </>
  );
};

// ============================================================================
// SHOT 10 — PHONE (first-person: reading a chat on our phone)
// ============================================================================

const ShotPhone: React.FC<ShotArgs> = ({ ctx, scene, plan, dur }) => {
  const { theme, t } = ctx;
  const sil = theme.mode === 'silhouette';
  const enter = easeOutCubic(clamp01(t / 12));
  const px = 210;
  const py = 380 + (1 - enter) * 600;
  const pw = 660;
  const ph = 1060;
  const msgs: Array<{ text: string; me: boolean }> = [];
  if (scene.subtitle) msgs.push({ text: scene.subtitle, me: false });
  if (scene.quote?.text) msgs.push({ text: scene.quote.text, me: true });
  bulletsOf(scene, 3).forEach((b, i) => msgs.push({ text: b, me: i % 2 === 1 }));
  if (scene.compare) {
    msgs.push({ text: `${scene.compare.leftTitle || ''}?`, me: false });
    msgs.push({ text: `${scene.compare.rightTitle || ''} ✓`, me: true });
  }
  const hl = highlightOf(scene);
  if (hl && msgs.length < 4) msgs.push({ text: `${hl} !!`, me: true });
  const shown = msgs.slice(0, 4);
  const gap = Math.max(8, Math.floor((dur * 0.7) / Math.max(1, shown.length)));
  const bgProps = pickProps(plan, [...WALL_PROPS], ['clock'], 1);
  let yy = py + 190;
  const layout = shown.map((m, i) => {
    const h = Math.min(220, 70 + Math.ceil(m.text.length / 16) * 44);
    const item = { ...m, y: yy, h, appear: popIn(t, 10 + i * gap, 10) };
    yy += h + 26;
    return item;
  });
  return (
    <>
      <Svg theme={theme}>
        <Backdrop ctx={ctx} env={plan.env} floorY={1300} />
        <MoodLight ctx={ctx} x={820} />
        {bgProps[0] && <g opacity={0.6}><Prop ctx={ctx} name={bgProps[0]} x={150} y={420} s={0.9} k={1} label={String(plan.day)} /></g>}
        <rect x={0} y={0} width={W} height={H} fill={sil ? '#000000' : theme.wallLow} opacity={0.3} />
        <g transform={`rotate(${3 + Math.sin(t * 0.06) * 0.8} 540 ${py + ph / 2})`}>
          <path d={wobRect(ctx, px, py, pw, ph, 64, 3)} fill="#2B2B2E" stroke={sil ? theme.rim : theme.ink} strokeWidth={sil ? 3 : theme.sw.prop * 1.2} />
          <rect x={px + 28} y={py + 40} width={pw - 56} height={ph - 80} rx={40} fill={sil ? '#1A1220' : theme.paper} />
          <rect x={px + 28} y={py + 40} width={pw - 56} height={110} rx={40} fill={theme.accent} opacity={0.9} />
          <circle cx={px + 100} cy={py + 95} r={30} fill={theme.paper} stroke={theme.ink} strokeWidth={theme.sw.fine} />
          {layout.map((m, i) =>
            m.appear > 0 ? (
              <g key={i} transform={`translate(${m.me ? px + pw - 60 : px + 60} ${m.y}) scale(${m.appear}) translate(${m.me ? -(px + pw - 60) : -(px + 60)} ${-m.y})`}>
                <path d={wobRect(ctx, m.me ? px + 170 : px + 60, m.y, pw - 230, m.h, 26, 30 + i * 5, 1.5)} fill={m.me ? (sil ? '#3B2C46' : theme.good) : sil ? '#2A1E30' : '#FFFFFF'} stroke={sil ? theme.rim : theme.ink} strokeWidth={sil ? 2 : theme.sw.fine} />
              </g>
            ) : null,
          )}
        </g>
        <g>
          <path d={`M 1180 2000 Q 980 1700 ${px + pw - 20} ${py + ph - 260}`} stroke={sil ? theme.rim : theme.ink} strokeWidth={(theme.body === 'stick' ? 26 : 130) + (sil ? 6 : theme.sw.char * 1.6)} strokeLinecap="round" fill="none" />
          <path d={`M 1180 2000 Q 980 1700 ${px + pw - 20} ${py + ph - 260}`} stroke={theme.body === 'stick' ? theme.ink : sil ? theme.ink : theme.garments.hero} strokeWidth={theme.body === 'stick' ? 26 : 130} strokeLinecap="round" fill="none" />
          <circle cx={px + pw - 10} cy={py + ph - 270} r={theme.body === 'stick' ? 46 : 70} fill={sil ? theme.ink : theme.mode === 'ink' ? '#FFFFFF' : theme.skin} stroke={sil ? theme.rim : theme.ink} strokeWidth={sil ? 3 : theme.sw.char} />
        </g>
        <Grain theme={theme} />
      </Svg>
      <div style={{ position: 'absolute', inset: 0, transform: `rotate(${3 + Math.sin(t * 0.06) * 0.8}deg)`, transformOrigin: `540px ${py + ph / 2}px` }}>
        <HandText x={px + 150} y={py + 60} w={pw - 220} h={70} text={scene.badge || ''} max={34} color="#FFFFFF" font={theme.bodyFont} align="left" />
        {layout.map((m, i) =>
          m.appear > 0.7 ? (
            <HandText key={i} x={(m.me ? px + 170 : px + 60) + 22} y={m.y + 10} w={pw - 230 - 44} h={m.h - 20} text={m.text} max={34} min={18} color={m.me && !sil ? '#FFFFFF' : theme.textInk} font={theme.bodyFont} align="left" />
          ) : null,
        )}
      </div>
    </>
  );
};

// ============================================================================
// DISPATCH
// ============================================================================

export const SHOT_COMPONENTS: Record<ShotPlan['shot'], React.FC<ShotArgs>> = {
  'pov-desk': ShotPovDesk,
  interview: ShotInterview,
  whiteboard: ShotWhiteboard,
  closeup: ShotCloseup,
  crowd: ShotCrowd,
  split: ShotSplit,
  stairs: ShotStairs,
  'held-paper': ShotHeldPaper,
  door: ShotDoor,
  phone: ShotPhone,
};
