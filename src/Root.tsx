import { Composition } from "remotion";
import { FoodEpisode, calcEpisode, EpisodeProps } from "./core/Episode";
import type { Timeline } from "./core/types";
import { CastSheet, CastProps } from "./core/CastSheet";
import { FoodAssembly, calcAssembly, AssemblyProps } from "./edit/Assembly";

// Built-in 5 s sample so Remotion Studio opens without arguments. Real episodes pass their timeline as props:
//   node scripts/food.mjs render --episode <slug> --format short|long
const SAMPLE: Timeline = {
  version: 1, slug: "sample", format: "short", timing: "estimated", locale: "en-US", fps: 30, width: 1080, height: 1920, aspectRatio: "9:16", totalFrames: 150, durationSec: 5,
  captions: false, labels: false, chapters: [], segments: [], words: [], events: [], placeholders: [], assets: {},
  shots: [{ id: "sample", scene: "pastry", a: 0, b: 150, startSec: 0, chapter: "c", camera: "main", params: {}, light: null, legend: false, static: false, transition: "cut", claims: [], assets: [], label: null, seed: 1 }],
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* every food-history episode, Short or Long, any aspect ratio: size and length come from the timeline */}
      <Composition id="FoodEpisode" component={FoodEpisode} calculateMetadata={calcEpisode} durationInFrames={150} fps={30} width={1080} height={1920}
        defaultProps={{ timeline: SAMPLE, mode: "preview" } as EpisodeProps} />
      {/* the film from finished clips (Blender layout renders / Seedance re-renders) + the 2D layer: transitions, legend frame,
          labels, captions. No three.js (2026-11-24). */}
      <Composition id="FoodAssembly" component={FoodAssembly} calculateMetadata={calcAssembly} durationInFrames={150} fps={30} width={1080} height={1920}
        defaultProps={{ timeline: SAMPLE as unknown as AssemblyProps["timeline"], pictures: [], mode: "preview" } as AssemblyProps} />
      {/* character sheet drawn by the episode character code (scripts/cast-sheet.mjs) */}
      <Composition id="CastSheet" component={CastSheet} durationInFrames={1} fps={30} width={1920} height={1080} defaultProps={{ who: "chef", v: 0 } as CastProps} />
    </>
  );
};
