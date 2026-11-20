// Types shared by the generic episode renderer and the scene library. The timeline itself is produced and
// validated by scripts/lib/timeline.mjs; the renderer only consumes it.
import * as THREE from "three";

export type V3 = [number, number, number];
export type CameraSpec = string | { from: string; to: string; ease?: "linear" | "smooth" | "out" };
export type TLShot = {
  id: string; scene: string; a: number; b: number; startSec: number; chapter: string; camera: CameraSpec; params: Record<string, unknown>;
  light: string | null; legend: boolean; static: boolean; transition: "cut" | "dip" | "whip"; claims: string[]; assets: string[];
  label: { text: string; claim: string } | null; seed: number;
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

/** camera for one frame; `focus` defaults to `look`; cInf = blur-disc radius (px at 1920 px frame height) at infinity, 0 = all sharp */
export type CamState = { pos: V3; look: V3; fov: number; roll?: number; focus?: V3; cInf?: number };
/** everything a scene may depend on: all of it derives from the absolute frame, so any frame re-renders identically */
export type Ctx = {
  f: number;          // absolute frame
  lf: number;         // frame inside the shot
  t: number;          // seconds inside the shot
  u: number;          // 0..1 through the shot (camera moves use this)
  p: number;          // action progress: u remapped by params.span [from, to], so one action can continue across several cuts
  dur: number;        // shot length in seconds
  fps: number; aspect: number; seed: number;
  params: Record<string, unknown>;
  /** "action" events of this shot, in seconds relative to the shot start (may be negative / past the end) */
  actions: { name: string; t: number }[];
  /** false when this camera is a 3D-only insert (top-down, aerial, extreme angle): scenes must hide their flat 2D characters */
  chars: boolean;
};
/** shot size of a named camera, and whether flat 2D characters may appear in it */
export type ShotKind = "wide" | "medium" | "closeup" | "food" | "detail" | "top";
export type ShotInfo = { kind: ShotKind; chars: boolean };
/** what the camera audit needs to know about one visible character card */
export type ActorInfo = {
  id: string; pos: V3;                 // feet, world space
  top: number; head: number;           // height of the crown and of the head centre above the feet (m)
  yaw: number; tilt: number;           // card rotation about Y; any rotation about X/Z (must stay 0: no leaning cards)
  sprite: "front" | "side";            // which drawing is on the card
  speed: number;                       // m/s over the ground (0 = standing)
  stepSpeed: number;                   // m/s the drawn walk cycle covers (0 = standing drawing)
};
export type LightName = "day" | "golden" | "interior" | "table" | "night" | "cool";
export interface SceneInst {
  root: THREE.Group;
  light: LightName;
  /** pose everything for this frame; `cam` is the camera already chosen for it (cards turn toward it) */
  update(c: Ctx, cam: CamState): void;
  /** named camera set-ups; "main" is required. Each must keep the subject framed for any aspect ratio. */
  cams: Record<string, (c: Ctx) => CamState>;
  /** size / character policy per named camera; cameras not listed count as { kind: "wide", chars: true } */
  shots?: Record<string, ShotInfo>;
  /** the character cards visible this frame (after update) */
  actors?: () => ActorInfo[];
}
export type Env = {
  /** model from the asset manifest ("assetId/modelName"); a labelled placeholder box when the file is missing */
  model(key: string, opt?: { h?: number; fallback?: V3 }): THREE.Object3D;
  has(key: string): boolean;
  /** image texture from the asset manifest (kind "texture", key "assetId/name"); null when the file is not there yet,
   *  so a scene can fall back to its painted canvas texture. `repeat` tiles it (walls, floors). */
  tex(key: string, opt?: { repeat?: [number, number] }): THREE.Texture | null;
  missing: Set<string>;
  /** this scene's set with lighting baked in Blender (asset keys "_baked/<scene>" + "_baked/<scene>-light"), or null */
  baked?(scene: string): { set: THREE.Object3D; light: THREE.Texture | null } | null;
};
export type SceneDef = { id: string; build(env: Env): SceneInst };
