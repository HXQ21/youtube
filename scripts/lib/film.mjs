// The film pipeline after three.js (2026-11-24): Blender lays out each stretch of the film (a "guide"), Seedance 2.0
// Mini re-renders it into the final look, Remotion lays the clips on the voice timeline with the 2D layer.
// This module is the pure logic (no Blender, no network): how the timeline is cut into AI segments, which picture
// covers which frames, and the Seedance prompt for a segment. scripts/film.mjs runs the steps.
import { ConfigError } from "./config.mjs";

/** Seedance 2.0 Mini (Dreamina CLI): one clip is 4..15 s, in whole seconds */
export const AI_MIN_SEC = 4, AI_MAX_SEC = 15;

/** Cut the film into AI segments: never across a change of location (scene), never inside a shot, at most 15 s each;
 *  a stretch shorter than 4 s is generated at 4 s and trimmed. Segments are numbered s01, s02... */
export const planSegments = (tl, { maxSec = AI_MAX_SEC, minSec = AI_MIN_SEC } = {}) => {
  const fps = tl.fps, maxF = maxSec * fps, out = [];
  let cur = null;
  const close = () => { if (cur) { out.push(cur); cur = null; } };
  for (const s of tl.shots) {
    const len = s.b - s.a;
    if (len > maxF) throw new ConfigError(`Shot ${s.id} dài ${(len / fps).toFixed(1)}s, vượt ${maxSec}s của một clip Seedance: tách shot này trong storyboard`);
    if (cur && (cur.scene !== s.scene || s.b - cur.a > maxF)) close();
    if (!cur) cur = { scene: s.scene, a: s.a, b: s.b, shots: [s.id] };
    else { cur.b = s.b; cur.shots.push(s.id); }
  }
  close();
  return out.map((g, i) => {
    const sec = (g.b - g.a) / fps;
    return { id: `s${String(i + 1).padStart(2, "0")}`, scene: g.scene, a: g.a, b: g.b, sec: +sec.toFixed(3), genSec: Math.min(maxSec, Math.max(minSec, Math.ceil(sec - 1e-6))), shots: g.shots };
  });
};

/** the picture for each segment: the Seedance clip when it exists, otherwise the Blender guide; null when neither */
export const picturesFor = (segments, have) => segments.map((g) => {
  const file = [`ai/${g.id}.mp4`, `guide/${g.id}.mp4`].find(have);
  return file ? { src: file, from: g.a, frames: g.b - g.a, start: 0, segment: g.id, kind: file.startsWith("ai/") ? "ai" : "guide" } : null;
});

// the look the channel wants from Seedance (VISUAL_DENSITY.md): a stylised cartoon game world, not a photo
export const AI_LOOK = "Re-render this layout as a polished stylised 3D cartoon film shot: warm motivated light from the visible sources (oven fire, windows, lamps) "
  + "with soft shadows and gentle bounce light, cooler shade, clean hand-painted materials (wood grain, brick, plaster, stone, flour, copper), "
  + "rich but natural colours, light atmosphere and depth. Not photorealistic: no grime, no film grain, no lens flares.";
export const AI_KEEP = "Keep exactly: the camera path and timing, the composition, every object's position, the characters' positions, poses, actions "
  + "and expressions. The flat 2D stick-figure characters stay flat 2D cartoon cards with bold ink outlines, drawn like the reference sheet; "
  + "do not turn them into 3D people. Do not add text, logos or extra characters. Keep any cut exactly where it is.";

/** the Seedance prompt for one segment: what happens (storyboard notes), then the look, then what must not change */
export const aiPrompt = (seg, shotsById, sceneDesc = "") => {
  const notes = seg.shots.map((id) => shotsById[id]?.note).filter(Boolean).map((n) => n.replace(/\s+/g, " ").trim());
  return [sceneDesc, notes.length ? `Shots: ${notes.join(" | ")}.` : "", AI_LOOK, AI_KEEP].filter(Boolean).join(" ");
};
