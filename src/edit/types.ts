// Timeline types for the 2D assembly (no three.js). The timeline is built and validated by scripts/lib/timeline.mjs.
export type CameraSpec = string | { from: string; to: string; ease?: "linear" | "smooth" | "out" };
export type Transition = "cut" | "dip" | "whip" | "dissolve";
export type TLShot = {
  id: string; scene: string; a: number; b: number; startSec: number; chapter: string; camera: CameraSpec; params: Record<string, unknown>;
  light: string | null; legend: boolean; static: boolean; transition: Transition; claims: string[]; assets: string[];
  label: { text: string; claim: string } | null; seed: number; note?: string | null;
};
export type TLEvent = { type: "sfx" | "action"; name: string; shot: string; sec: number; frame: number; gainDb: number; durSec: number | null };
export type Timeline = {
  version: number; slug: string; format: "short" | "long"; timing: "aligned" | "estimated"; locale: string;
  fps: number; width: number; height: number; aspectRatio: string; totalFrames: number; durationSec: number;
  captions: boolean; labels: boolean;
  chapters: { id: string; title: string; startSec: number; endSec: number; startFrame: number; endFrame: number }[];
  segments: { id: string; chapter: string; text: string; startSec: number; endSec: number; startFrame: number; endFrame: number }[];
  words: { t: string; s: number; e: number }[];
  shots: TLShot[]; events: TLEvent[]; placeholders: string[]; assets?: Record<string, string>;
};
/** one finished picture clip laid on the film: `src` is a file under public/ (staticFile) or an http(s) URL; it covers
 *  timeline frames [from, from + frames), starting `start` frames into the clip (Blender guide renders or Seedance clips) */
export type Picture = { src: string; from: number; frames: number; start?: number };
