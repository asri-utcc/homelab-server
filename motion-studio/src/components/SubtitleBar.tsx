import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { THAI_FONT_FAMILY } from './ThaiFontLoader';

export interface SubtitleCue {
  text: string;
  highlight?: string;
  startFrame: number;
  endFrame: number;
}

interface SubtitleBarProps {
  cues: SubtitleCue[];
  theme?: 'light' | 'dark';
  accentColor?: string;
  bottomOffset?: number;
}

export const SubtitleBar: React.FC<SubtitleBarProps> = ({
  cues,
  theme = 'light',
  accentColor = '#3B6CF6',
  bottomOffset = 225,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const active = cues.find((c) => frame >= c.startFrame && frame <= c.endFrame);
  if (!active) return null;

  const localFrame = frame - active.startFrame;
  const pop = spring({
    frame: localFrame,
    fps,
    config: { damping: 16, stiffness: 220, mass: 0.7 },
  });
  const translateY = interpolate(pop, [0, 1], [18, 0]);
  const scale = interpolate(pop, [0, 1], [0.94, 1]);

  const bg = theme === 'light' ? 'rgba(26, 35, 50, 0.92)' : 'rgba(15, 23, 42, 0.90)';
  const fg = '#FFFFFF';
  const hiColor = theme === 'light' ? '#FDE047' : '#FACC15';

  const renderText = () => {
    const kw = active.highlight?.trim();
    if (!kw || !active.text.includes(kw)) {
      return <span>{active.text}</span>;
    }
    const parts = active.text.split(kw);
    return (
      <>
        {parts.map((part, idx) => (
          <React.Fragment key={idx}>
            {part}
            {idx < parts.length - 1 && (
              <span
                style={{
                  color: hiColor,
                  textDecoration: 'none',
                  borderBottom: `4px solid ${accentColor}`,
                  paddingBottom: 2,
                }}
              >
                {kw}
              </span>
            )}
          </React.Fragment>
        ))}
      </>
    );
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: 54,
        right: 54,
        bottom: bottomOffset,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 50,
      }}
    >
      <div
        style={{
          transform: `translateY(${translateY}px) scale(${scale})`,
          backgroundColor: bg,
          color: fg,
          fontFamily: THAI_FONT_FAMILY,
          fontWeight: 700,
          fontSize: 40,
          lineHeight: 1.48,
          letterSpacing: 0.2,
          textAlign: 'center',
          padding: '18px 34px 20px 34px',
          borderRadius: 24,
          boxShadow: '0 14px 36px rgba(15, 23, 42, 0.24)',
          border: '2px solid rgba(255, 255, 255, 0.14)',
          maxWidth: 960,
          wordBreak: 'keep-all',
        }}
      >
        {renderText()}
      </div>
    </div>
  );
};
