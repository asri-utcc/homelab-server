import React from 'react';
import { THAI_FONT_FAMILY } from '../../components/ThaiFontLoader';
import { computeTitleSize, splitThaiWords } from '../families';
import type { StudioScene } from '../types';

export const STAGE_W = 1080;
export const STAGE_H = 1920;
export const SAFE_BOTTOM = 1540;

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

/** Smooth 0..1 easeOutCubic reveal starting at `delay` over `dur` frames */
export function appear(localFrame: number, delay = 0, dur = 14): number {
  if (dur <= 0) return localFrame >= delay ? 1 : 0;
  return easeOutCubic((localFrame - delay) / dur);
}

/** Staggered item reveal helper (0..1) */
export function stagger(i: number, localFrame: number, step = 6, baseDelay = 4, dur = 14): number {
  return appear(localFrame, baseDelay + i * step, dur);
}

export interface SceneTexts {
  title: string;
  subtitle: string;
  bullets: string[];
  numbers: string[];
  badge: string;
}

const NUMBER_RE =
  /\d+(?:[.,]\d+)?(?:\s*(?:%|฿|บาท|ล้าน|แสน|หมื่น|พัน|เท่า|[xX]|[KMB]\b|วัน|ปี|เดือน|สัปดาห์|ชม\.|ชั่วโมง|นาที|วินาที|คน|ข้อ|อันดับ))?/g;

/** Extract normalized text chunks & numeric tokens from any StudioScene */
export function sceneTexts(scene: StudioScene): SceneTexts {
  const title = String(scene.title || '').trim();
  const subtitle = String(scene.subtitle || '').trim();
  const badge = String(scene.badge || '').trim();

  const bullets: string[] = [];
  if (Array.isArray(scene.bullets) && scene.bullets.length > 0) {
    for (const b of scene.bullets) {
      const s = String(b || '').trim();
      if (s) bullets.push(s);
    }
  } else if (Array.isArray(scene.steps) && scene.steps.length > 0) {
    for (const st of scene.steps) {
      const s = typeof st === 'string' ? st.trim() : String(st?.title || '').trim();
      if (s) bullets.push(s);
    }
  } else if (scene.compare) {
    const items = [...(scene.compare.leftItems || []), ...(scene.compare.rightItems || [])];
    for (const item of items) {
      const s = String(item || '').trim();
      if (s) bullets.push(s);
    }
  } else if (scene.quote?.text) {
    const q = String(scene.quote.text).trim();
    if (q) bullets.push(q);
  }

  const haystackParts: string[] = [];
  if (scene.stat) {
    const v = String(scene.stat.value ?? '').trim();
    const unit = String(scene.stat.unit ?? '').trim();
    if (v) haystackParts.push(unit && !v.includes(unit) ? `${v}${unit}` : v);
    if (scene.stat.label) haystackParts.push(String(scene.stat.label));
    if (scene.stat.delta) haystackParts.push(String(scene.stat.delta));
  }
  haystackParts.push(title, subtitle, ...bullets);
  if (scene.highlight) {
    haystackParts.push(Array.isArray(scene.highlight) ? scene.highlight.join(' ') : String(scene.highlight));
  }

  const numbers: string[] = [];
  const seen = new Set<string>();
  const matches = haystackParts.join(' ').match(NUMBER_RE) || [];
  for (const m of matches) {
    const clean = m.trim();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      numbers.push(clean);
    }
  }

  return { title, subtitle, bullets, numbers, badge };
}

export interface FitTextProps {
  text: string;
  baseSize?: number;
  minSize?: number;
  maxLines?: number;
  color?: string;
  fontWeight?: number | string;
  fontFamily?: string;
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
  style?: React.CSSProperties;
}

/**
 * Thai-safe auto-sizing text block using computeTitleSize + splitThaiWords.
 * Inserts zero-width spaces between Thai word segments so lines wrap cleanly
 * without clipping upper/lower Thai vowels.
 */
export const FitText: React.FC<FitTextProps> = ({
  text,
  baseSize = 48,
  minSize = 24,
  maxLines,
  color = '#FFFFFF',
  fontWeight = 800,
  fontFamily = THAI_FONT_FAMILY,
  align = 'center',
  lineHeight = 1.32,
  style,
}) => {
  const clean = String(text || '').trim();
  if (!clean) return null;

  const computed = Math.max(minSize, computeTitleSize(clean, baseSize));
  const words = splitThaiWords(clean);
  const wrapped = words.length > 1 ? words.join('\u200B') : clean;

  const clampStyle: React.CSSProperties = maxLines
    ? {
        display: '-webkit-box',
        WebkitLineClamp: maxLines,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }
    : {};

  return (
    <div
      style={{
        fontFamily,
        fontSize: computed,
        fontWeight,
        color,
        textAlign: align,
        lineHeight,
        wordBreak: 'keep-all',
        overflowWrap: 'break-word',
        paddingTop: 2,
        paddingBottom: 2,
        ...clampStyle,
        ...style,
      }}
    >
      {wrapped}
    </div>
  );
};
