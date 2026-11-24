import React from 'react';
import { Composition } from 'remotion';
import {
  DEFAULT_SOLAR_PROPS,
  SolarPanelExplainer,
  SolarTimelineProps,
} from './projects/solar-explainer/SolarPanelExplainer';
import {
  DEFAULT_STORY_PROPS,
  StorytellingProps,
  StorytellingTemplate,
} from './templates/StorytellingTemplate';
import {
  DEFAULT_DHUHA_PROPS,
  DhuhaBenefits,
  DhuhaBenefitsProps,
} from './projects/dhuha-benefits/DhuhaBenefits';
import {
  CosmicPositivity,
  CosmicPositivityProps,
  DEFAULT_COSMIC_PROPS,
} from './projects/cosmic-positivity/CosmicPositivity';
import {
  CpuHowItWorks,
  CpuHowItWorksProps,
  DEFAULT_CPU_PROPS,
} from './projects/cpu-how-it-works/CpuHowItWorks';
import {
  DEFAULT_STUDIO_PROPS,
  StudioEngine,
  StudioProps,
} from './studio/StudioEngine';
import {
  SacredStoryProps,
  SacredStoryReel,
} from './templates/SacredStoryReel';
import {
  DEFAULT_LAST_THIRD_PROPS,
  LastThirdNight,
} from './projects/last-third-night/LastThirdNight';

type SolarCompProps = SolarTimelineProps & Record<string, unknown>;
type StoryCompProps = StorytellingProps & Record<string, unknown>;

const SolarPanelExplainerComp = SolarPanelExplainer as unknown as React.FC<SolarCompProps>;
const StorytellingTemplateComp = StorytellingTemplate as unknown as React.FC<StoryCompProps>;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="SolarPanelExplainer"
        component={SolarPanelExplainerComp}
        durationInFrames={DEFAULT_SOLAR_PROPS.totalFrames}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={DEFAULT_SOLAR_PROPS as SolarCompProps}
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.max(90, props.totalFrames || DEFAULT_SOLAR_PROPS.totalFrames),
          fps: props.fps || 30,
          width: 1080,
          height: 1920,
        })}
      />
      <Composition
        id="StorytellingVertical"
        component={StorytellingTemplateComp}
        durationInFrames={DEFAULT_STORY_PROPS.totalFrames}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={DEFAULT_STORY_PROPS as StoryCompProps}
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.max(90, props.totalFrames || 300),
          fps: 30,
          width: 1080,
          height: 1920,
        })}
      />
      <Composition
        id="DhuhaBenefits"
        component={DhuhaBenefits}
        durationInFrames={DEFAULT_DHUHA_PROPS.totalFrames}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={DEFAULT_DHUHA_PROPS}
        calculateMetadata={({ props }: { props: DhuhaBenefitsProps }) => ({
          durationInFrames: Math.max(90, props.totalFrames || DEFAULT_DHUHA_PROPS.totalFrames),
          fps: props.fps || 30,
          width: 1080,
          height: 1920,
        })}
      />
      <Composition
        id="CosmicPositivity"
        component={CosmicPositivity}
        durationInFrames={DEFAULT_COSMIC_PROPS.totalFrames}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={DEFAULT_COSMIC_PROPS}
        calculateMetadata={({ props }: { props: CosmicPositivityProps }) => ({
          durationInFrames: Math.max(90, props.totalFrames || DEFAULT_COSMIC_PROPS.totalFrames),
          fps: props.fps || 30,
          width: 1080,
          height: 1920,
        })}
      />
      <Composition
        id="CpuHowItWorks"
        component={CpuHowItWorks}
        durationInFrames={DEFAULT_CPU_PROPS.totalFrames}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={DEFAULT_CPU_PROPS}
        calculateMetadata={({ props }: { props: CpuHowItWorksProps }) => ({
          durationInFrames: Math.max(90, props.totalFrames || DEFAULT_CPU_PROPS.totalFrames),
          fps: props.fps || 30,
          width: 1080,
          height: 1920,
        })}
      />
      <Composition
        id="StudioEngine"
        component={StudioEngine}
        durationInFrames={DEFAULT_STUDIO_PROPS.totalFrames}
        fps={DEFAULT_STUDIO_PROPS.fps || 30}
        width={1080}
        height={1920}
        defaultProps={DEFAULT_STUDIO_PROPS}
        calculateMetadata={({ props }: { props: StudioProps }) => ({
          durationInFrames: Math.max(90, props.totalFrames || DEFAULT_STUDIO_PROPS.totalFrames),
          fps: props.fps || 30,
          width: 1080,
          height: 1920,
        })}
      />
      <Composition
        id="LastThirdNight"
        component={LastThirdNight}
        durationInFrames={DEFAULT_LAST_THIRD_PROPS.totalFrames}
        fps={DEFAULT_LAST_THIRD_PROPS.fps || 30}
        width={1080}
        height={1920}
        defaultProps={DEFAULT_LAST_THIRD_PROPS}
        calculateMetadata={({ props }: { props: SacredStoryProps }) => ({
          durationInFrames: Math.max(
            90,
            props.totalFrames || DEFAULT_LAST_THIRD_PROPS.totalFrames,
          ),
          fps: props.fps || 30,
          width: 1080,
          height: 1920,
        })}
      />
      <Composition
        id="SacredStoryReel"
        component={SacredStoryReel}
        durationInFrames={DEFAULT_LAST_THIRD_PROPS.totalFrames}
        fps={DEFAULT_LAST_THIRD_PROPS.fps || 30}
        width={1080}
        height={1920}
        defaultProps={DEFAULT_LAST_THIRD_PROPS}
        calculateMetadata={({ props }: { props: SacredStoryProps }) => ({
          durationInFrames: Math.max(
            90,
            props.totalFrames || DEFAULT_LAST_THIRD_PROPS.totalFrames,
          ),
          fps: props.fps || 30,
          width: 1080,
          height: 1920,
        })}
      />
    </>
  );
};
