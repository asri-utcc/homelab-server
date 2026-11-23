import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { ThaiFontLoader, THAI_FONT_FAMILY } from '../components/ThaiFontLoader';
import { SubtitleBar, SubtitleCue } from '../components/SubtitleBar';

export interface StoryCardScene {
  id: string;
  headline: string;
  highlightWord?: string;
  imageUrl?: string;
  imageCredit?: string;
  startFrame: number;
  endFrame: number;
}

export interface StorytellingProps {
  title: string;
  totalFrames: number;
  scenes: StoryCardScene[];
  cues: SubtitleCue[];
}

export const DEFAULT_STORY_PROPS: StorytellingProps = {
  title: 'เรื่องเล่า 60 วินาที',
  totalFrames: 300,
  cues: [],
  scenes: [
    {
      id: 'hook',
      headline: 'เรื่องเล่าชวนรู้ใน 60 วินาที',
      highlightWord: '60 วินาที',
      startFrame: 0,
      endFrame: 300,
    },
  ],
};

/**
 * Reusable vertical 9:16 Documentary Storytelling Template (The Story Room style):
 * Dark map/editorial background + tilted white-bordered photo cards + yellow keyword headline + Thai subtitles.
 */
export const StorytellingTemplate: React.FC<StorytellingProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scenes = props.scenes?.length ? props.scenes : DEFAULT_STORY_PROPS.scenes;
  const active = scenes.find((s) => frame >= s.startFrame && frame < s.endFrame) || scenes[scenes.length - 1];
  const localFrame = Math.max(0, frame - active.startFrame);
  const dur = Math.max(1, active.endFrame - active.startFrame);

  const bgZoom = interpolate(localFrame, [0, dur], [1.0, 1.08]);
  const cardPop = spring({ frame: localFrame, fps, config: { damping: 14, stiffness: 165 } });
  const tilt = scenes.indexOf(active) % 2 === 0 ? -2.2 : 2.2;

  return (
    <AbsoluteFill style={{ backgroundColor: '#0F172A', fontFamily: THAI_FONT_FAMILY, overflow: 'hidden' }}>
      <ThaiFontLoader />
      {/* Subtle animated topographic grid background */}
      <div
        style={{
          position: 'absolute',
          inset: -60,
          background: 'radial-gradient(circle at 50% 35%, #1E293B 0%, #0F172A 75%)',
          transform: `scale(${bgZoom})`,
        }}
      />
      {/* Top Editorial Headline (Safe Zone top: 155px) */}
      <div
        style={{
          position: 'absolute',
          top: 155,
          left: 56,
          right: 56,
          textAlign: 'center',
          color: '#FFFFFF',
          fontSize: 60,
          fontWeight: 700,
          lineHeight: 1.38,
          textShadow: '0 6px 20px rgba(0,0,0,0.55)',
        }}
      >
        {active.highlightWord && active.headline.includes(active.highlightWord) ? (
          active.headline.split(active.highlightWord).map((part, idx, arr) => (
            <React.Fragment key={idx}>
              {part}
              {idx < arr.length - 1 && <span style={{ color: '#FACC15' }}>{active.highlightWord}</span>}
            </React.Fragment>
          ))
        ) : (
          active.headline
        )}
      </div>

      {/* Tilted Photo Evidence Card */}
      {active.imageUrl && (
        <div
          style={{
            position: 'absolute',
            top: 480,
            left: 90,
            right: 90,
            height: 760,
            backgroundColor: '#FFFFFF',
            padding: 16,
            borderRadius: 24,
            boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
            transform: `scale(${interpolate(cardPop, [0, 1], [0.75, 1])}) rotate(${tilt}deg)`,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Img
            src={active.imageUrl}
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 14 }}
          />
          {active.imageCredit && (
            <div
              style={{
                position: 'absolute',
                right: 28,
                bottom: 28,
                backgroundColor: 'rgba(15,23,42,0.78)',
                color: '#E2E8F0',
                fontSize: 20,
                padding: '6px 14px',
                borderRadius: 10,
              }}
            >
              {active.imageCredit}
            </div>
          )}
        </div>
      )}

      <SubtitleBar cues={props.cues || []} theme="dark" accentColor="#FACC15" bottomOffset={230} />
    </AbsoluteFill>
  );
};
