import { Composition } from "remotion";
import { BridgeShort, BRIDGE_FRAMES } from "./videos/bridge/Bridge";
import { FoodEpisode, calcEpisode, EpisodeProps } from "./core/Episode";
import type { Timeline } from "./core/types";
import { CastSheet, CastProps } from "./core/CastSheet";
import { BlenderExport, BlenderExportProps } from "./core/BlenderExport";

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
      {/* character sheet drawn by the episode character code (scripts/cast-sheet.mjs) */}
      <Composition id="CastSheet" component={CastSheet} durationInFrames={1} fps={30} width={1920} height={1080} defaultProps={{ who: "chef", v: 0 } as CastProps} />
      {/* hands a stretch of an episode to Blender (scripts/blender.mjs export) */}
      <Composition id="BlenderExport" component={BlenderExport} durationInFrames={1} fps={30} width={1080} height={1920}
        calculateMetadata={({ props }) => ({ width: props.timeline.width, height: props.timeline.height, fps: props.timeline.fps })}
        defaultProps={{ timeline: SAMPLE, a: 0, b: 0, sink: "" } as BlenderExportProps} />
      {/* the original bridge short, kept as the style reference */}
      <Composition id="BridgeShort" component={BridgeShort} durationInFrames={BRIDGE_FRAMES} fps={30} width={1080} height={1920} />
    </>
  );
};
