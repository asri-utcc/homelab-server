import React, { useId } from 'react';
import { Easing, Img, interpolate, spring, useVideoConfig } from 'remotion';
import { THAI_FONT_FAMILY } from '../components/ThaiFontLoader';
import {
  ResolvedStyleTokens,
  StudioScene,
  StudioStepItem,
  hexToRgba,
  normalizeSceneVisual,
} from './types';

interface SceneVisualProps {
  scene: StudioScene;
  tokens: ResolvedStyleTokens;
  localFrame: number;
  durationFrames: number;
  compact?: boolean;
}

// ============================================================================
// BUILT-IN CRISP VECTOR ICONS (Zero Emoji Artifacts)
// ============================================================================

function inferIconName(scene: StudioScene): string {
  if (scene.icon && scene.icon.trim()) return scene.icon.trim().toLowerCase();
  const blob = `${scene.title} ${scene.subtitle || ''} ${scene.badge || ''}`.toLowerCase();
  if (/cpu|ชิป|ซีพียู|คอม|ประมวล/.test(blob)) return 'cpu';
  if (/สมอง|คิด|จิต|brain|ai|ปัญญา/.test(blob)) return 'brain';
  if (/ไฟ|พลัง|เร็ว|bolt|energy|power/.test(blob)) return 'bolt';
  if (/โลก|อินเทอร์เน็ต|เครือข่าย|globe|map/.test(blob)) return 'globe';
  if (/ปลอดภัย|เกราะ|ป้องกัน|shield|security/.test(blob)) return 'shield';
  if (/กราฟ|สถิติ|เติบโต|ยอด|chart|data|เปอร์เซ็นต์/.test(blob)) return 'chart';
  if (/เวลา|วินาที|นาที|ชั่วโมง|clock|time/.test(blob)) return 'clock';
  if (/พุ่ง|อนาคต|เริ่ม|rocket|launch/.test(blob)) return 'rocket';
  if (/ชั้น|ระบบ|โครงสร้าง|layer|stack/.test(blob)) return 'layers';
  if (/เป้า|จุดหมาย|แม่น|target|goal/.test(blob)) return 'target';
  if (/ธรรมชาติ|เขียว|ต้นไม้|leaf|eco/.test(blob)) return 'leaf';
  if (/โค้ด|โปรแกรม|code|dev/.test(blob)) return 'code';
  if (/ใจ|สุขภาพ|รัก|heart|health/.test(blob)) return 'heart';
  if (/อ่าน|เรียน|หนังสือ|ความรู้|book|learn/.test(blob)) return 'book';
  if (/กล้อง|วิดีโอ|คลิป|ภาพ|camera|video|studio/.test(blob)) return 'camera';
  if (/เงิน|ต้นทุน|ราคา|บาท|money|finance/.test(blob)) return 'money';
  if (/ถูก|สำเร็จ|ผ่าน|check|done/.test(blob)) return 'check';
  if (/ไอเดีย|คิด|หลอดไฟ|idea|light/.test(blob)) return 'lightbulb';
  return 'spark';
}

export const StudioVectorIcon: React.FC<{
  name: string;
  size?: number;
  color: string;
  secondary?: string;
}> = ({ name, size = 120, color, secondary = color }) => {
  const stroke = {
    stroke: color,
    strokeWidth: 2.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  const renderGlyph = () => {
    switch (name) {
      case 'cpu':
        return (
          <>
            <rect x="7" y="7" width="10" height="10" rx="2" fill={hexToRgba(color, 0.16)} {...stroke} />
            <rect x="10" y="10" width="4" height="4" rx="0.8" fill={secondary} />
            <path d="M9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4" {...stroke} />
          </>
        );
      case 'brain':
        return (
          <>
            <path
              d="M12 5a3.5 3.5 0 0 0-6.5 1.8A3.2 3.2 0 0 0 4 9.8a3.4 3.4 0 0 0 1.3 6.2A3.2 3.2 0 0 0 12 19V5z"
              fill={hexToRgba(color, 0.16)}
              {...stroke}
            />
            <path
              d="M12 5a3.5 3.5 0 0 1 6.5 1.8A3.2 3.2 0 0 1 20 9.8a3.4 3.4 0 0 1-1.3 6.2A3.2 3.2 0 0 1 12 19V5z"
              fill={hexToRgba(secondary, 0.16)}
              {...stroke}
            />
            <path d="M8.5 9.5c1 0 1.5.8 1.5 1.5M15.5 9.5c-1 0-1.5.8-1.5 1.5M8 14c1 .4 2 .2 2.5-.5M16 14c-1 .4-2 .2-2.5-.5" {...stroke} />
          </>
        );
      case 'bolt':
        return (
          <polygon
            points="13,2 4.5,13.5 11.5,13.5 10.5,22 19.5,10.5 12.5,10.5"
            fill={hexToRgba(color, 0.24)}
            stroke={color}
            strokeWidth={2.2}
            strokeLinejoin="round"
          />
        );
      case 'globe':
        return (
          <>
            <circle cx="12" cy="12" r="9" fill={hexToRgba(color, 0.14)} {...stroke} />
            <ellipse cx="12" cy="12" rx="4.2" ry="9" {...stroke} />
            <path d="M3.5 9h17M3.5 15h17" {...stroke} stroke={secondary} />
          </>
        );
      case 'shield':
        return (
          <>
            <path
              d="M12 3l7.5 3.2v5.4c0 4.6-3.1 8.2-7.5 9.6-4.4-1.4-7.5-5-7.5-9.6V6.2L12 3z"
              fill={hexToRgba(color, 0.16)}
              {...stroke}
            />
            <path d="M9 12.2l2.2 2.2 4.3-4.4" {...stroke} stroke={secondary} strokeWidth={2.5} />
          </>
        );
      case 'chart':
        return (
          <>
            <path d="M4 20h16" {...stroke} />
            <rect x="5.5" y="13" width="3" height="7" rx="1" fill={hexToRgba(secondary, 0.45)} stroke={secondary} strokeWidth={1.8} />
            <rect x="10.5" y="9" width="3" height="11" rx="1" fill={hexToRgba(color, 0.45)} stroke={color} strokeWidth={1.8} />
            <rect x="15.5" y="5" width="3" height="15" rx="1" fill={hexToRgba(color, 0.8)} stroke={color} strokeWidth={1.8} />
          </>
        );
      case 'clock':
        return (
          <>
            <circle cx="12" cy="12" r="9" fill={hexToRgba(color, 0.14)} {...stroke} />
            <path d="M12 7v5.2l3.8 2.3" {...stroke} stroke={secondary} strokeWidth={2.4} />
            <circle cx="12" cy="12" r="1.2" fill={color} />
          </>
        );
      case 'rocket':
        return (
          <>
            <path
              d="M14.5 4.5C17 3.5 19.5 3.8 20.2 4.5c.7.7 1 3.2 0 5.7-1.2 3-3.6 5.5-6.6 6.8l-3.6-3.6c1.3-3 3.8-5.4 6.8-6.6z"
              fill={hexToRgba(color, 0.18)}
              {...stroke}
            />
            <circle cx="15" cy="9" r="1.6" fill={secondary} />
            <path d="M10 13.4L6.2 14l-1.7 3.8 3.8-1.7.6-3.8" {...stroke} stroke={secondary} />
          </>
        );
      case 'layers':
        return (
          <>
            <polygon points="12,3 21,7.8 12,12.6 3,7.8" fill={hexToRgba(color, 0.22)} {...stroke} />
            <polyline points="3,12.2 12,17 21,12.2" {...stroke} stroke={secondary} />
            <polyline points="3,16.4 12,21.2 21,16.4" {...stroke} />
          </>
        );
      case 'target':
        return (
          <>
            <circle cx="12" cy="12" r="9" fill={hexToRgba(color, 0.1)} {...stroke} />
            <circle cx="12" cy="12" r="5.5" {...stroke} stroke={secondary} />
            <circle cx="12" cy="12" r="2.2" fill={color} />
          </>
        );
      case 'leaf':
        return (
          <>
            <path
              d="M19.5 4.5C12 4.5 6 8.8 5.5 16.5c7.7-.5 14-4.5 14-12z"
              fill={hexToRgba(color, 0.2)}
              {...stroke}
            />
            <path d="M5 19.5c2.2-3.5 5.4-6.4 9.5-8.5" {...stroke} stroke={secondary} />
          </>
        );
      case 'code':
        return (
          <>
            <polyline points="8.5,7 3.5,12 8.5,17" {...stroke} />
            <polyline points="15.5,7 20.5,12 15.5,17" {...stroke} />
            <line x1="13.5" y1="5" x2="10.5" y2="19" {...stroke} stroke={secondary} />
          </>
        );
      case 'heart':
        return (
          <path
            d="M12 20.2s-7.5-4.6-8.8-9.3C2.2 7.2 4.8 4.2 8.2 4.2c1.8 0 3.1 1 3.8 2.2.7-1.2 2-2.2 3.8-2.2 3.4 0 6 3 5 6.7-1.3 4.7-8.8 9.3-8.8 9.3z"
            fill={hexToRgba(color, 0.2)}
            {...stroke}
          />
        );
      case 'book':
        return (
          <>
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v16.5H6.5A2.5 2.5 0 0 0 4 22V5.5z" fill={hexToRgba(color, 0.16)} {...stroke} />
            <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v16.5h5.5A2.5 2.5 0 0 1 20 22V5.5z" fill={hexToRgba(secondary, 0.14)} {...stroke} />
          </>
        );
      case 'camera':
        return (
          <>
            <rect x="3" y="6.5" width="13.5" height="11" rx="2.4" fill={hexToRgba(color, 0.18)} {...stroke} />
            <polygon points="16.5,10 21.5,7.5 21.5,16.5 16.5,14" fill={hexToRgba(secondary, 0.26)} {...stroke} stroke={secondary} />
            <circle cx="9.7" cy="12" r="2.2" fill={secondary} />
          </>
        );
      case 'money':
        return (
          <>
            <circle cx="12" cy="12" r="9" fill={hexToRgba(color, 0.16)} {...stroke} />
            <path d="M12 6.5v11M14.8 9.2c0-1.1-1.2-2-2.8-2s-2.8.8-2.8 2c0 2.6 5.6 1.4 5.6 4.4 0 1.2-1.2 2.2-2.8 2.2s-2.8-.9-2.8-2" {...stroke} stroke={secondary} />
          </>
        );
      case 'check':
        return (
          <>
            <circle cx="12" cy="12" r="9" fill={hexToRgba(color, 0.18)} {...stroke} />
            <path d="M8 12.4l2.8 2.8 5.6-5.8" {...stroke} stroke={secondary} strokeWidth={2.6} />
          </>
        );
      case 'lightbulb':
        return (
          <>
            <path
              d="M9 17.5h6M9.8 20.5h4.4M12 3.5a6 6 0 0 0-3.8 10.6c.7.6 1.1 1.4 1.2 2.4h5.2c.1-1 .5-1.8 1.2-2.4A6 6 0 0 0 12 3.5z"
              fill={hexToRgba(color, 0.18)}
              {...stroke}
            />
            <path d="M12 7v3M10.5 8.5h3" {...stroke} stroke={secondary} />
          </>
        );
      case 'star':
        return (
          <polygon
            points="12,2.5 14.9,8.7 21.5,9.5 16.6,14 17.9,20.6 12,17.3 6.1,20.6 7.4,14 2.5,9.5 9.1,8.7"
            fill={hexToRgba(color, 0.22)}
            stroke={color}
            strokeWidth={2.2}
            strokeLinejoin="round"
          />
        );
      case 'spark':
      default:
        return (
          <>
            <polygon
              points="12,2 14.8,9.2 22,12 14.8,14.8 12,22 9.2,14.8 2,12 9.2,9.2"
              fill={hexToRgba(color, 0.24)}
              stroke={color}
              strokeWidth={2.1}
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="2.6" fill={secondary} />
          </>
        );
    }
  };

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block', flexShrink: 0 }}>
      {renderGlyph()}
    </svg>
  );
};

// ============================================================================
// HELPER: PARSE NUMERIC VALUE FOR STAT COUNT-UP
// ============================================================================

function parseStatNumeric(scene: StudioScene): {
  target: number | null;
  decimals: number;
  prefix: string;
  suffix: string;
  rawDisplay: string;
} {
  const st = scene.stat;
  if (!st) return { target: null, decimals: 0, prefix: '', suffix: '', rawDisplay: '100%' };
  const rawStr = String(st.value ?? '');
  if (typeof st.numericValue === 'number' && Number.isFinite(st.numericValue)) {
    const dec = String(st.numericValue).includes('.') ? String(st.numericValue).split('.')[1].length : 0;
    return {
      target: st.numericValue,
      decimals: Math.min(2, dec),
      prefix: st.prefix ?? '',
      suffix: st.suffix ?? '',
      rawDisplay: rawStr,
    };
  }
  const m = /^([^0-9-]*)(-?[0-9][0-9,]*(?:\.[0-9]+)?)(.*)$/.exec(rawStr.trim());
  if (m) {
    const cleaned = m[2].replace(/,/g, '');
    const num = Number(cleaned);
    if (Number.isFinite(num)) {
      const dec = cleaned.includes('.') ? cleaned.split('.')[1].length : 0;
      return {
        target: num,
        decimals: Math.min(2, dec),
        prefix: st.prefix ?? m[1],
        suffix: st.suffix ?? m[3],
        rawDisplay: rawStr,
      };
    }
  }
  return { target: null, decimals: 0, prefix: '', suffix: '', rawDisplay: rawStr };
}

// ============================================================================
// VISUAL RENDERER (ALL 8 VISUAL TYPES)
// ============================================================================

export const SceneVisual: React.FC<SceneVisualProps> = ({
  scene,
  tokens,
  localFrame,
  durationFrames,
  compact = false,
}) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const { fps } = useVideoConfig();
  const { palette, isLight, motionIntensity, springConfig, cardRadius } = tokens;
  const fontBody = THAI_FONT_FAMILY;

  let visualType = normalizeSceneVisual(scene);
  // Spec requirement: if visual is 'image' and imageUrl is empty, fallback to 'icon'
  if (visualType === 'image' && (!scene.imageUrl || !scene.imageUrl.trim())) {
    visualType = 'icon';
  }

  const travel = 26 * motionIntensity;
  const tSec = localFrame / Math.max(1, fps);

  // --------------------------------------------------------------------------
  // 1. ICON (also fallback for empty imageUrl)
  // --------------------------------------------------------------------------
  const renderIconVisual = () => {
    const iconName = inferIconName(scene);
    const enter = spring({
      frame: Math.max(0, localFrame - 3),
      fps,
      config: springConfig,
    });
    const scale = interpolate(enter, [0, 1], [0.76, 1]);
    const floatY = Math.sin(tSec * 2.4 * motionIntensity) * (7 * motionIntensity);
    const ringSize = compact ? 250 : 340;
    const iconSize = compact ? 104 : 142;

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: compact ? 20 : 30,
          padding: compact ? '12px 18px' : '22px 26px',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: ringSize,
            height: ringSize,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `translate3d(0, ${floatY.toFixed(1)}px, 0) scale(${scale.toFixed(4)})`,
          }}
        >
          <svg
            width={ringSize}
            height={ringSize}
            viewBox="0 0 340 340"
            style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
          >
            <defs>
              <radialGradient id={`icon-aura-${uid}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={palette.accent} stopOpacity={isLight ? 0.24 : 0.34} />
                <stop offset="58%" stopColor={palette.accent2} stopOpacity={0.1} />
                <stop offset="100%" stopColor={palette.accent} stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx={170} cy={170} r={160} fill={`url(#icon-aura-${uid})`} />
            <g transform={`rotate(${(tSec * 16 * motionIntensity).toFixed(2)} 170 170)`}>
              <circle
                cx={170}
                cy={170}
                r={142}
                fill="none"
                stroke={palette.accent}
                strokeWidth={2.2}
                strokeDasharray="14 14"
                strokeOpacity={0.55}
              />
              <circle cx={170} cy={28} r={6} fill={palette.accent} />
            </g>
            <g transform={`rotate(${(-tSec * 11 * motionIntensity).toFixed(2)} 170 170)`}>
              <circle
                cx={170}
                cy={170}
                r={112}
                fill={hexToRgba(palette.surface, isLight ? 0.88 : 0.72)}
                stroke={palette.border}
                strokeWidth={2}
              />
              <circle cx={282} cy={170} r={5} fill={palette.accent2} />
            </g>
          </svg>
          <div style={{ position: 'relative', zIndex: 2 }}>
            <StudioVectorIcon
              name={iconName}
              size={iconSize}
              color={palette.accent}
              secondary={palette.accent2}
            />
          </div>
        </div>

        {(scene.subtitle || scene.bullets?.[0]) && (
          <div
            style={{
              maxWidth: 740,
              textAlign: 'center',
              fontFamily: fontBody,
              fontSize: compact ? 28 : 34,
              fontWeight: 700,
              lineHeight: 1.48,
              color: palette.fg,
              paddingTop: 8,
              paddingBottom: 8,
              opacity: interpolate(enter, [0, 0.7], [0, 1], { extrapolateRight: 'clamp' }),
            }}
          >
            {scene.subtitle || scene.bullets?.[0]}
          </div>
        )}
      </div>
    );
  };

  // --------------------------------------------------------------------------
  // 2. TITLE (Hero Focal Crest + Takeaway + Tag Pills)
  // --------------------------------------------------------------------------
  if (visualType === 'title') {
    const enter = spring({ frame: Math.max(0, localFrame - 4), fps, config: springConfig });
    const tagEnter = spring({ frame: Math.max(0, localFrame - 12), fps, config: springConfig });
    const iconName = inferIconName(scene);
    const chips = (scene.bullets || []).slice(0, 3);
    const pulse = 1 + Math.sin(tSec * 2.6 * motionIntensity) * (0.03 * motionIntensity);

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: compact ? 18 : 28,
          padding: compact ? '14px 20px' : '24px 32px',
        }}
      >
        {/* Hero Crest Emblem */}
        <div
          style={{
            position: 'relative',
            width: compact ? 186 : 240,
            height: compact ? 186 : 240,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `scale(${(interpolate(enter, [0, 1], [0.8, 1]) * pulse).toFixed(4)})`,
          }}
        >
          <svg
            width={compact ? 186 : 240}
            height={compact ? 186 : 240}
            viewBox="0 0 240 240"
            style={{ position: 'absolute', inset: 0 }}
          >
            <circle
              cx={120}
              cy={120}
              r={108}
              fill={hexToRgba(palette.accent, isLight ? 0.12 : 0.18)}
              stroke={palette.accent}
              strokeWidth={2.5}
              strokeDasharray="8 10"
              strokeOpacity={0.68}
            />
            <circle
              cx={120}
              cy={120}
              r={84}
              fill={hexToRgba(palette.surface, isLight ? 0.94 : 0.85)}
              stroke={palette.border}
              strokeWidth={2}
            />
          </svg>
          <div style={{ position: 'relative', zIndex: 2 }}>
            <StudioVectorIcon
              name={iconName}
              size={compact ? 84 : 112}
              color={palette.accent}
              secondary={palette.accent2}
            />
          </div>
        </div>

        {/* Accent Divider Line */}
        <div
          style={{
            width: Math.round(interpolate(enter, [0, 1], [20, 180])),
            height: 5,
            borderRadius: 99,
            background: `linear-gradient(90deg, ${palette.accent} 0%, ${palette.accent2} 100%)`,
          }}
        />

        {/* Subtitle / Hook Statement */}
        {scene.subtitle && (
          <div
            style={{
              maxWidth: 780,
              textAlign: 'center',
              fontFamily: fontBody,
              fontSize: compact ? 30 : 36,
              fontWeight: 700,
              lineHeight: 1.48,
              color: palette.fg,
              paddingTop: 8,
              paddingBottom: 8,
              opacity: interpolate(enter, [0, 0.75], [0, 1], { extrapolateRight: 'clamp' }),
              transform: `translate3d(0, ${interpolate(enter, [0, 1], [travel, 0]).toFixed(1)}px, 0)`,
            }}
          >
            {scene.subtitle}
          </div>
        )}

        {/* Optional Key Highlight Pills */}
        {chips.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 14,
              maxWidth: 820,
              opacity: interpolate(tagEnter, [0, 0.7], [0, 1], { extrapolateRight: 'clamp' }),
              transform: `translate3d(0, ${interpolate(tagEnter, [0, 1], [18 * motionIntensity, 0]).toFixed(1)}px, 0)`,
            }}
          >
            {chips.map((item, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 22px',
                  borderRadius: 999,
                  backgroundColor: hexToRgba(palette.surface, isLight ? 0.96 : 0.78),
                  border: `2px solid ${hexToRgba(idx % 2 === 0 ? palette.accent : palette.accent2, 0.55)}`,
                  color: palette.fg,
                  fontFamily: THAI_FONT_FAMILY,
                  fontSize: compact ? 22 : 25,
                  fontWeight: 700,
                  lineHeight: 1.4,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    backgroundColor: idx % 2 === 0 ? palette.accent : palette.accent2,
                    flexShrink: 0,
                  }}
                />
                <span>{item}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // 3. BULLETS (Staggered High-Contrast Insight Cards)
  // --------------------------------------------------------------------------
  if (visualType === 'bullets') {
    const items = (scene.bullets && scene.bullets.length > 0
      ? scene.bullets
      : [scene.subtitle || scene.title]
    ).slice(0, 5);
    const dense = items.length >= 4 || compact;

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: dense ? 16 : 22,
          padding: compact ? '12px 14px' : '18px 20px',
        }}
      >
        {items.map((text, idx) => {
          const delay = 4 + idx * 7;
          const sp = spring({
            frame: Math.max(0, localFrame - delay),
            fps,
            config: springConfig,
          });
          const xShift = interpolate(sp, [0, 1], [-travel * 1.15, 0]);
          const op = interpolate(sp, [0, 0.55], [0, 1], { extrapolateRight: 'clamp' });
          const chipColor = idx % 2 === 0 ? palette.accent : palette.accent2;
          const chipText = idx % 2 === 0 ? palette.accentOnFill : isLight ? '#FFFFFF' : '#0F172A';

          return (
            <div
              key={idx}
              style={{
                opacity: op,
                transform: `translate3d(${xShift.toFixed(1)}px, 0, 0)`,
                display: 'flex',
                alignItems: 'center',
                gap: 20,
                padding: dense ? '16px 22px' : '22px 26px',
                borderRadius: Math.max(12, cardRadius - 4),
                backgroundColor: hexToRgba(palette.surface, isLight ? 0.94 : 0.78),
                border: `2px solid ${hexToRgba(palette.border, isLight ? 0.9 : 0.7)}`,
                borderLeft: `8px solid ${chipColor}`,
                boxShadow: isLight
                  ? '0 8px 20px rgba(15, 23, 42, 0.06)'
                  : '0 10px 26px rgba(2, 6, 23, 0.34)',
              }}
            >
              <div
                style={{
                  width: dense ? 46 : 54,
                  height: dense ? 46 : 54,
                  borderRadius: 14,
                  backgroundColor: chipColor,
                  color: chipText,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: THAI_FONT_FAMILY,
                  fontSize: dense ? 22 : 25,
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                {String(idx + 1).padStart(2, '0')}
              </div>
              <div
                style={{
                  flex: 1,
                  fontFamily: fontBody,
                  fontSize: dense ? 27 : 32,
                  fontWeight: 700,
                  lineHeight: 1.46,
                  color: palette.fg,
                  paddingTop: 6,
                  paddingBottom: 6,
                  overflowWrap: 'break-word',
                }}
              >
                {text}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // 4. STAT (Hero Animated Metric + SVG Radial Gauge + Delta Pill)
  // --------------------------------------------------------------------------
  if (visualType === 'stat') {
    const st = scene.stat || {
      value: '100%',
      label: scene.subtitle || scene.title,
      progress: 85,
    };
    const parsed = parseStatNumeric(scene);
    const countFrames = Math.max(16, Math.min(40, Math.round(durationFrames * 0.45)));
    const rawT = interpolate(localFrame, [4, 4 + countFrames], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    const eased = Easing.out(Easing.cubic)(rawT);

    const displayNumber =
      parsed.target !== null
        ? `${parsed.prefix}${(parsed.target * eased).toLocaleString('en-US', {
            minimumFractionDigits: parsed.decimals,
            maximumFractionDigits: parsed.decimals,
          })}${parsed.suffix}`
        : parsed.rawDisplay;

    const pop = spring({ frame: Math.max(0, localFrame - 3), fps, config: springConfig });
    const pct = Math.max(12, Math.min(100, st.progress ?? 84));
    const gaugeSize = compact ? 300 : 390;
    const radius = 152;
    const circ = 2 * Math.PI * radius;
    const dashOffset = circ * (1 - (pct / 100) * eased);

    const numFontSize =
      displayNumber.length >= 9 ? (compact ? 54 : 66) : displayNumber.length >= 6 ? (compact ? 66 : 82) : compact ? 82 : 102;

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: compact ? 16 : 24,
          padding: compact ? '12px 18px' : '18px 24px',
        }}
      >
        {/* Radial Progress Gauge + Animated Counter */}
        <div
          style={{
            position: 'relative',
            width: gaugeSize,
            height: gaugeSize,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `scale(${interpolate(pop, [0, 1], [0.84, 1]).toFixed(4)})`,
          }}
        >
          <svg width={gaugeSize} height={gaugeSize} viewBox="0 0 360 360" style={{ position: 'absolute', inset: 0 }}>
            <defs>
              <linearGradient id={`stat-ring-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={palette.accent} />
                <stop offset="100%" stopColor={palette.accent2} />
              </linearGradient>
            </defs>
            <circle
              cx={180}
              cy={180}
              r={radius}
              fill={hexToRgba(palette.surface, isLight ? 0.9 : 0.7)}
              stroke={hexToRgba(palette.border, 0.55)}
              strokeWidth={18}
            />
            <circle
              cx={180}
              cy={180}
              r={radius}
              fill="none"
              stroke={`url(#stat-ring-${uid})`}
              strokeWidth={18}
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 180 180)"
            />
          </svg>

          <div
            style={{
              position: 'relative',
              zIndex: 2,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              padding: '0 24px',
            }}
          >
            <div
              style={{
                fontFamily: THAI_FONT_FAMILY,
                fontSize: numFontSize,
                fontWeight: 800,
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1.15,
                color: palette.accent,
                paddingTop: 6,
                paddingBottom: 6,
              }}
            >
              {displayNumber}
            </div>
            {st.unit && (
              <div
                style={{
                  fontFamily: THAI_FONT_FAMILY,
                  fontSize: compact ? 24 : 28,
                  fontWeight: 700,
                  lineHeight: 1.4,
                  color: palette.muted,
                  marginTop: 2,
                }}
              >
                {st.unit}
              </div>
            )}
          </div>
        </div>

        {/* Stat Label */}
        <div
          style={{
            maxWidth: 780,
            textAlign: 'center',
            fontFamily: fontBody,
            fontSize: compact ? 29 : 35,
            fontWeight: 700,
            lineHeight: 1.46,
            color: palette.fg,
            paddingTop: 6,
            paddingBottom: 6,
          }}
        >
          {st.label}
        </div>

        {/* Delta / Trend Pill */}
        {st.delta && (
          <div
            style={{
              padding: '10px 26px',
              borderRadius: 999,
              backgroundColor: hexToRgba(palette.accent, isLight ? 0.14 : 0.22),
              border: `2px solid ${hexToRgba(palette.accent, 0.6)}`,
              color: palette.accent,
              fontFamily: THAI_FONT_FAMILY,
              fontSize: compact ? 23 : 26,
              fontWeight: 700,
              lineHeight: 1.4,
            }}
          >
            {st.delta}
          </div>
        )}
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // 5. STEPS (Connected Numbered Vertical Pipeline)
  // --------------------------------------------------------------------------
  if (visualType === 'steps') {
    const rawSteps: Array<string | StudioStepItem> =
      scene.steps && scene.steps.length > 0
        ? scene.steps
        : (scene.bullets || [scene.subtitle || scene.title]);
    const steps: StudioStepItem[] = rawSteps.slice(0, 4).map((s, idx) =>
      typeof s === 'string'
        ? { step: String(idx + 1), title: s }
        : { step: s.step || String(idx + 1), title: s.title, detail: s.detail },
    );

    const lineProgress = interpolate(localFrame, [6, 6 + steps.length * 10], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    });

    const dense = steps.length >= 4 || compact;

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: compact ? '10px 12px' : '16px 18px',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: dense ? 16 : 22,
          }}
        >
          {/* Animated Vertical Spine Connector (aligned cleanly from first to last step circle) */}
          <div
            style={{
              position: 'absolute',
              left: compact ? 27 : 31,
              top: compact ? 29 : 33,
              bottom: compact ? 29 : 33,
              width: 5,
              borderRadius: 99,
              backgroundColor: hexToRgba(palette.border, 0.5),
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: '100%',
                height: `${(lineProgress * 100).toFixed(1)}%`,
                background: `linear-gradient(180deg, ${palette.accent} 0%, ${palette.accent2} 100%)`,
              }}
            />
          </div>

          {steps.map((item, idx) => {
            const delay = 4 + idx * 8;
            const sp = spring({ frame: Math.max(0, localFrame - delay), fps, config: springConfig });
            const op = interpolate(sp, [0, 0.55], [0, 1], { extrapolateRight: 'clamp' });
            const ty = interpolate(sp, [0, 1], [travel, 0]);
            const isFinal = idx === steps.length - 1;
            const nodeBg = isFinal ? palette.accent2 : palette.accent;
            const nodeFg = isFinal ? (isLight ? '#FFFFFF' : '#0F172A') : palette.accentOnFill;

            return (
              <div
                key={idx}
                style={{
                  position: 'relative',
                  zIndex: 2,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 20,
                  opacity: op,
                  transform: `translate3d(0, ${ty.toFixed(1)}px, 0)`,
                }}
              >
                <div
                  style={{
                    width: compact ? 58 : 66,
                    height: compact ? 58 : 66,
                    borderRadius: '50%',
                    backgroundColor: nodeBg,
                    color: nodeFg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: THAI_FONT_FAMILY,
                    fontSize: compact ? 24 : 28,
                    fontWeight: 800,
                    flexShrink: 0,
                    boxShadow: `0 6px 18px ${hexToRgba(nodeBg, 0.35)}`,
                    border: `4px solid ${palette.surface}`,
                  }}
                >
                  {item.step}
                </div>

                <div
                  style={{
                    flex: 1,
                    padding: dense ? '14px 20px' : '18px 24px',
                    borderRadius: Math.max(12, cardRadius - 4),
                    backgroundColor: hexToRgba(palette.surface, isLight ? 0.95 : 0.8),
                    border: `2px solid ${hexToRgba(isFinal ? palette.accent2 : palette.border, 0.8)}`,
                  }}
                >
                  <div
                    style={{
                      fontFamily: THAI_FONT_FAMILY,
                      fontSize: dense ? 26 : 30,
                      fontWeight: 700,
                      lineHeight: 1.44,
                      color: palette.fg,
                      paddingTop: 4,
                      paddingBottom: 4,
                    }}
                  >
                    {item.title}
                  </div>
                  {item.detail && (
                    <div
                      style={{
                        fontFamily: fontBody,
                        fontSize: dense ? 20 : 23,
                        fontWeight: 400,
                        lineHeight: 1.44,
                        color: palette.muted,
                        marginTop: 4,
                        paddingBottom: 4,
                      }}
                    >
                      {item.detail}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // 6. COMPARE (Side-by-Side A vs B Cards + Animated VS Badge)
  // --------------------------------------------------------------------------
  if (visualType === 'compare') {
    const cmp = scene.compare || {
      leftTitle: 'แบบเดิม',
      leftItems: scene.bullets?.slice(0, 2) || ['ใช้เวลานาน', 'ขั้นตอนซับซ้อน'],
      rightTitle: 'แบบใหม่',
      rightItems: scene.bullets?.slice(2, 4) || ['รวดเร็วกว่า', 'คุมคุณภาพได้สม่ำเสมอ'],
      winner: 'right' as const,
    };

    const leftSp = spring({ frame: Math.max(0, localFrame - 3), fps, config: springConfig });
    const rightSp = spring({ frame: Math.max(0, localFrame - 9), fps, config: springConfig });
    const vsSp = spring({ frame: Math.max(0, localFrame - 12), fps, config: springConfig });

    const rightWins = cmp.winner !== 'left';

    const renderCol = (
      title: string,
      items: string[],
      isWinner: boolean,
      sp: number,
      fromDir: -1 | 1,
    ) => (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: compact ? 12 : 16,
          padding: compact ? '20px 24px' : '26px 28px',
          borderRadius: Math.max(14, cardRadius - 2),
          backgroundColor: isWinner
            ? hexToRgba(palette.accent, isLight ? 0.12 : 0.18)
            : hexToRgba(palette.surface, isLight ? 0.92 : 0.72),
          border: `2.5px solid ${isWinner ? palette.accent : palette.border}`,
          opacity: interpolate(sp, [0, 0.55], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `translate3d(${(interpolate(sp, [0, 1], [fromDir * travel * 1.2, 0])).toFixed(1)}px, 0, 0)`,
        }}
      >
        <div
          style={{
            padding: '10px 16px',
            borderRadius: 12,
            backgroundColor: isWinner ? palette.accent : hexToRgba(palette.muted, 0.2),
            color: isWinner ? palette.accentOnFill : palette.fg,
            fontFamily: THAI_FONT_FAMILY,
            fontSize: compact ? 25 : 29,
            fontWeight: 800,
            lineHeight: 1.4,
            textAlign: 'center',
          }}
        >
          {title}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 10 : 14, marginTop: 4 }}>
          {items.slice(0, 4).map((txt, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <svg
                width={24}
                height={24}
                viewBox="0 0 24 24"
                style={{ flexShrink: 0, marginTop: 7 }}
              >
                {isWinner ? (
                  <>
                    <circle cx={12} cy={12} r={10} fill={hexToRgba(palette.accent, 0.2)} />
                    <path
                      d="M7.5 12.2l3 3 6-6"
                      fill="none"
                      stroke={palette.accent}
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </>
                ) : (
                  <>
                    <circle cx={12} cy={12} r={10} fill={hexToRgba(palette.muted, 0.18)} />
                    <path
                      d="M8.5 12h7"
                      fill="none"
                      stroke={palette.muted}
                      strokeWidth={2.4}
                      strokeLinecap="round"
                    />
                  </>
                )}
              </svg>
              <div
                style={{
                  fontFamily: fontBody,
                  fontSize: compact ? 23 : 26,
                  fontWeight: isWinner ? 700 : 400,
                  lineHeight: 1.46,
                  color: isWinner ? palette.fg : palette.muted,
                  paddingTop: 3,
                  paddingBottom: 3,
                }}
              >
                {txt}
              </div>
            </div>
          ))}
        </div>
      </div>
    );

    return (
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 36,
          padding: compact ? '12px 6px' : '18px 8px',
        }}
      >
        {renderCol(cmp.leftTitle, cmp.leftItems, !rightWins, leftSp, -1)}
        {renderCol(cmp.rightTitle, cmp.rightItems, rightWins, rightSp, 1)}

        {/* Central VS Emblem */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: `translate(-50%, -50%) scale(${interpolate(vsSp, [0, 1], [0.4, 1]).toFixed(4)})`,
            width: 58,
            height: 58,
            borderRadius: '50%',
            backgroundColor: palette.accent2,
            color: isLight ? '#FFFFFF' : '#0F172A',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: THAI_FONT_FAMILY,
            fontSize: 21,
            fontWeight: 900,
            letterSpacing: 1,
            border: `4px solid ${palette.bg}`,
            boxShadow: `0 10px 24px ${hexToRgba('#000000', 0.28)}`,
            zIndex: 5,
          }}
        >
          VS
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // 7. QUOTE (Editorial Pull-Quote with Oversized SVG Glyph)
  // --------------------------------------------------------------------------
  if (visualType === 'quote') {
    const q = scene.quote || {
      text: scene.subtitle || scene.narration || scene.title,
      author: scene.source || 'บทสรุปสำคัญ',
    };
    const sp = spring({ frame: Math.max(0, localFrame - 4), fps, config: springConfig });
    const ty = interpolate(sp, [0, 1], [travel, 0]);
    const op = interpolate(sp, [0, 0.55], [0, 1], { extrapolateRight: 'clamp' });

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: compact ? '16px 20px' : '24px 32px',
          opacity: op,
          transform: `translate3d(0, ${ty.toFixed(1)}px, 0)`,
        }}
      >
        <div
          style={{
            width: '100%',
            padding: compact ? '28px 30px' : '40px 42px',
            borderRadius: cardRadius,
            backgroundColor: hexToRgba(palette.surface, isLight ? 0.95 : 0.78),
            border: `2px solid ${hexToRgba(palette.accent, 0.45)}`,
            borderLeft: `10px solid ${palette.accent}`,
            display: 'flex',
            flexDirection: 'column',
            gap: compact ? 16 : 24,
            boxShadow: isLight
              ? '0 14px 34px rgba(15, 23, 42, 0.08)'
              : '0 18px 44px rgba(2, 6, 23, 0.42)',
          }}
        >
          {/* Decorative SVG Quote Mark */}
          <svg width={compact ? 52 : 68} height={compact ? 42 : 54} viewBox="0 0 68 54">
            <path
              d="M15.4 54C6.8 54 0 47.2 0 38.2 0 23.6 10.6 9.8 25.4 0l5.6 8.2C22 14.4 16.8 20.6 15.8 27.6c8.4 1.2 14.4 7 14.4 14.6C30.2 49 23.6 54 15.4 54zm37.2 0C44 54 37.2 47.2 37.2 38.2 37.2 23.6 47.8 9.8 62.6 0l5.4 8.2c-9 6.2-14.2 12.4-15.2 19.4 8.4 1.2 14.4 7 14.4 14.6 0 6.8-6.6 11.8-14.6 11.8z"
              fill={palette.accent}
              opacity={0.88}
            />
          </svg>

          <div
            style={{
              fontFamily: fontBody,
              fontSize: q.text.length > 90 ? (compact ? 29 : 34) : compact ? 34 : 42,
              fontWeight: 700,
              lineHeight: 1.54,
              color: palette.fg,
              paddingTop: 8,
              paddingBottom: 8,
            }}
          >
            {q.text}
          </div>

          <div
            style={{
              height: 2,
              width: 120,
              backgroundColor: palette.accent2,
              opacity: 0.7,
            }}
          />

          {(q.author || q.source) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {q.author && (
                <div
                  style={{
                    fontFamily: THAI_FONT_FAMILY,
                    fontSize: compact ? 24 : 28,
                    fontWeight: 700,
                    lineHeight: 1.4,
                    color: palette.accent,
                  }}
                >
                  — {q.author}
                </div>
              )}
              {(q.role || q.source) && (
                <div
                  style={{
                    fontFamily: THAI_FONT_FAMILY,
                    fontSize: compact ? 20 : 22,
                    fontWeight: 400,
                    lineHeight: 1.4,
                    color: palette.muted,
                  }}
                >
                  {q.role || q.source}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // 8. IMAGE (Remotion <Img> with Ken-Burns Motion & Credit Stamp)
  // --------------------------------------------------------------------------
  if (visualType === 'image' && scene.imageUrl) {
    const enter = spring({ frame: Math.max(0, localFrame - 2), fps, config: springConfig });
    const kenBurns = interpolate(
      localFrame,
      [0, Math.max(1, durationFrames)],
      [1.0, 1.0 + 0.08 * motionIntensity],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
    );

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: compact ? '8px 10px' : '14px 16px',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: compact ? 420 : 600,
            borderRadius: cardRadius,
            overflow: 'hidden',
            border: `3px solid ${palette.border}`,
            backgroundColor: palette.surface,
            transform: `scale(${interpolate(enter, [0, 1], [0.92, 1]).toFixed(4)})`,
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.34)',
          }}
        >
          <Img
            src={scene.imageUrl}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: `scale(${kenBurns.toFixed(4)})`,
            }}
          />
          {scene.imageCredit && (
            <div
              style={{
                position: 'absolute',
                right: 18,
                bottom: 18,
                padding: '6px 14px',
                borderRadius: 10,
                backgroundColor: 'rgba(15, 23, 42, 0.82)',
                color: '#F1F5F9',
                fontFamily: THAI_FONT_FAMILY,
                fontSize: 20,
                lineHeight: 1.4,
              }}
            >
              {scene.imageCredit}
            </div>
          )}
        </div>

        {(scene.imageCaption || scene.subtitle) && (
          <div
            style={{
              fontFamily: fontBody,
              fontSize: compact ? 25 : 29,
              fontWeight: 700,
              lineHeight: 1.46,
              color: palette.fg,
              textAlign: 'center',
              paddingTop: 6,
              paddingBottom: 6,
            }}
          >
            {scene.imageCaption || scene.subtitle}
          </div>
        )}
      </div>
    );
  }

  return renderIconVisual();
};
