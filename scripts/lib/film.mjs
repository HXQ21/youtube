// The film pipeline after three.js (2026-11-24): Blender lays out each stretch of the film (a "guide"), Seedance 2.0
// Mini re-renders it into the final look, Remotion lays the clips on the voice timeline with the 2D layer.
// This module is the pure logic (no Blender, no network): how the timeline is cut into AI segments, the identity of a
// segment (so a clip made for an older cut is never used), which picture covers which frames, and the Seedance prompt.
// scripts/film.mjs runs the steps.
import crypto from "node:crypto";
import { ConfigError } from "./config.mjs";

/** Seedance 2.0 Mini (Dreamina CLI): one clip is 4..15 s, in whole seconds */
export const AI_MIN_SEC = 4, AI_MAX_SEC = 15;

/** what must not be mixed inside one AI clip: the set, the city / era, and legend vs documented history
 *  (2026-11-24 review: s02 had mixed Vienna and Paris only because both are "street"; s07 mixed the legend page with
 *  the documentary page) */
export const storyKey = (s) => {
  const p = s.params ?? {};
  return JSON.stringify([s.scene, !!s.legend, p.place ?? null, p.era ?? null, p.who ?? null]);
};

/** Cut the film into AI segments: a new segment at every change of set, city, era or legend status, never inside a
 *  shot, at most 15 s each; a stretch shorter than 4 s is generated at 4 s (the Blender guide is padded to the same
 *  length, so the clip's first seconds keep the guide's timing). Segments are numbered s01, s02... */
export const planSegments = (tl, { maxSec = AI_MAX_SEC, minSec = AI_MIN_SEC } = {}) => {
  const fps = tl.fps, maxF = maxSec * fps, out = [];
  let cur = null;
  const close = () => { if (cur) { out.push(cur); cur = null; } };
  for (const s of tl.shots) {
    const len = s.b - s.a, key = storyKey(s);
    if (len > maxF) throw new ConfigError(`Shot ${s.id} dài ${(len / fps).toFixed(1)}s, vượt ${maxSec}s của một clip Seedance: tách shot này trong storyboard`);
    if (cur && (cur.key !== key || s.b - cur.a > maxF)) close();
    if (!cur) cur = { key, scene: s.scene, a: s.a, b: s.b, shots: [s.id] };
    else { cur.b = s.b; cur.shots.push(s.id); }
  }
  close();
  return out.map((g, i) => {
    const sec = (g.b - g.a) / fps;
    return { id: `s${String(i + 1).padStart(2, "0")}`, scene: g.scene, a: g.a, b: g.b, sec: +sec.toFixed(3), genSec: Math.min(maxSec, Math.max(minSec, Math.ceil(sec - 1e-6))), shots: g.shots };
  });
};

/** identity of a segment's content: its shots (camera, params, legend, length) and the timed events inside it, in
 *  frames relative to the segment start. Moving an emphasis word inside the segment changes it; edits elsewhere in
 *  the film do not, so approved clips of untouched segments stay valid. */
export const segmentKey = (tl, g) => {
  const shots = tl.shots.filter((s) => g.shots.includes(s.id)).map((s) => [s.id, s.scene, s.a - g.a, s.b - g.a, s.camera, s.params ?? {}, !!s.legend, s.light ?? null]);
  const events = (tl.events ?? []).filter((e) => e.frame >= g.a && e.frame < g.b).map((e) => [e.type, e.name ?? null, e.frame - g.a]);
  return crypto.createHash("sha1").update(JSON.stringify({ w: tl.width, h: tl.height, fps: tl.fps, gen: g.genSec, shots, events })).digest("hex").slice(0, 16);
};

/** the picture for each segment. choose(g) returns { src, kind } or null; picturesFor only places it on the timeline */
export const picturesFor = (segments, choose) => segments.map((g) => {
  const c = choose(g);
  return c ? { src: c.src, from: g.a, frames: g.b - g.a, start: 0, segment: g.id, kind: c.kind, approved: !!c.approved } : null;
});

/** which clip a segment may use. manifests: { ai, guide } = the sidecar JSON of ai/sNN.mp4 and guide/sNN.mp4 (or
 *  null). Final: only an AI clip the user approved for this exact segment key. Preview: the newest matching clip,
 *  else the matching guide. Anything made for another key is stale and never used. */
export const chooseClip = (g, key, manifests, final) => {
  const ai = manifests.ai, guide = manifests.guide;
  if (ai && ai.key === key && (ai.approved || !final)) return { src: `ai/${g.id}.mp4`, kind: "ai", approved: !!ai.approved };
  if (!final && guide && guide.key === key) return { src: `guide/${g.id}.mp4`, kind: "guide" };
  return null;
};

/** cast sheets for the people on screen (cast = shot.py's cast.json: [{who, v, frames}]), most screen time first, one
 *  sheet per character type: the exact variant when it has a sheet, else any sheet of that type */
export const pickCastSheets = (cast, sheets, max = 3) => {
  const ok = sheets.filter((f) => /^[a-z]+-v\d+\.png$/.test(f)), files = [], missing = [];
  const order = [...(cast ?? [])].sort((x, y) => y.frames - x.frames);
  for (const who of [...new Set(order.map((c) => c.who))]) {
    const f = order.filter((c) => c.who === who).map((c) => `${who}-v${c.v}.png`).find((x) => ok.includes(x)) ?? ok.find((x) => x.startsWith(`${who}-v`));
    if (f) files.push(f); else missing.push(who);
  }
  return { files: files.slice(0, max), missing };
};

// ---------------------------------------------------------------- Seedance prompt
// Only what the picture model needs: subject, action, place, camera, references, what may change. Editing notes,
// captions, emphasis words, signs and the legend sepia stay in Remotion (2026-11-24 review: s06 got the editor's
// "Danger" emphasis and the sepia request, which Remotion then applied a second time).
// the channel look (SKILL.md: "toon-shaded 3D sets with black ink lines"): the guides carry no ink (Blender only lays
// out), so the prompt has to ask for it, or Seedance paints a plain 3D cartoon (#24)
export const AI_LOOK = "Re-render this layout as a polished stylised 3D cartoon film shot in a toon-shaded world: every object and the set have bold near-black ink outlines "
  + "on their silhouettes and main edges, like the characters, with two-tone cel shading. Warm motivated light from the visible sources (oven fire, windows, lamps) "
  + "with soft shadows and gentle bounce light, cooler shade, clean hand-painted materials (wood grain, brick, plaster, stone, flour, copper), "
  + "rich but natural colours, light atmosphere and depth. Not photorealistic: no grime, no film grain, no lens flares. Full natural colour (no sepia, no vignette).";
export const AI_KEEP = "Keep exactly: the camera path and timing of the reference video, the composition, every object's position, the characters' positions, poses, actions "
  + "and expressions. The flat 2D stick-figure characters stay flat 2D cartoon cards with bold ink outlines, drawn exactly like the character reference sheets (one sheet per character type); "
  + "do not turn them into 3D people. No text, letters, logos or captions anywhere, and no extra characters. Keep any cut exactly where it is.";

const ITEMS = { croissant: "a golden croissant", kipferl: "a crescent-shaped Viennese kipferl bread roll", cut: "a croissant broken in half showing its flaky layered inside",
  cutk: "a kipferl broken in half showing its dense bread crumb", pair: "a kipferl and a croissant side by side" };
const BACKDROPS = { cafe: "on a cafe table", bakery: "on a bakery counter", plain: "on a plain warm-coloured surface" };
const BAKER = { knead: "kneads dough on the bench", peel: "slides a long wooden peel into the oven; the hands, the peel and the bread move together",
  listen: "freezes and listens, startled", serve: "hands pastries over the counter to customers", idle: "works at the bench" };
const STEPS = { butter: "a slab of butter is laid on a sheet of dough and the dough is folded over it", layers: "a cut through laminated dough shows the butter layers multiplying",
  bake: "a tray of croissants rises and turns golden in the oven" };
const ERA = { old: "in the late 1600s", 1839: "in 1839" };

/** plain English for one shot, from its structured params (never the Vietnamese editor note) */
export const shotText = (s) => {
  const p = s.params ?? {}, era = ERA[p.era] ? ` ${ERA[p.era]}` : "";
  if (s.scene === "pastry") return `Close-up of ${ITEMS[p.item] ?? "a pastry"} ${BACKDROPS[p.backdrop] ?? ""}${p.steam === 0 ? "" : ", a little steam rising"}`.trim();
  if (s.scene === "bakery") return `Inside a small bakery${era}${p.who === "paris" ? " in Paris" : p.who === "towns" ? " in Vienna" : ""}: the baker ${BAKER[p.action] ?? BAKER.idle}${p.customers ? `, ${p.customers} customers at the counter` : ""}`;
  if (s.scene === "street") {
    const city = p.place === "vienna" ? "an old Vienna street" : "a Paris street in 1839";
    const bits = [p.officer === "walk" ? "an officer walks into frame" : p.officer ? "an officer stands in the street" : "", p.sign ? "a bakery shop front with a hanging sign" : "",
      p.queue ? "customers queue at the shop" : "", p.crowd ? "people walk by" : ""].filter(Boolean);
    return `${city[0].toUpperCase()}${city.slice(1)}${bits.length ? `: ${bits.join(", ")}` : ""}`;
  }
  if (s.scene === "lamination") return `Close-up on a floured work surface: ${STEPS[p.step] ?? "croissant dough is laminated with butter"}`;
  if (s.scene === "page") return "Close-up of an old chronicle book page on a desk (no readable writing)";
  return `A shot in the ${s.scene} set`;
};

/** what each reference is for (BytePlus: give every reference one role) */
export const REF_ROLES = (sheets) => "Use the reference video only for layout, timing, camera motion and what every object and character does."
  + (sheets ? " Use the reference images only for how the characters look (one design sheet per character type): copy their design, not the sheet's poses, labels or background." : "");

/** the Seedance prompt for one segment: what happens (from structured params), the clip length, the references, the look, the rules */
export const aiPrompt = (seg, shotsById, fps = 30, sheets = false) => {
  const shots = seg.shots.map((id) => shotsById[id]).filter(Boolean);
  const parts = shots.map((s, i) => `${shots.length > 1 ? `Shot ${i + 1} (${((s.b - s.a) / fps).toFixed(1)} s): ` : ""}${shotText(s)}${s.ai ? `. ${s.ai}` : ""}.`);
  const hold = seg.genSec > seg.sec + 0.05 ? ` The story lasts the first ${seg.sec.toFixed(1)} s; after that the reference holds the last shot, keep it calm and continuous.` : "";
  return [parts.join(" "), `The clip is ${seg.genSec} s.${hold}`, REF_ROLES(sheets), AI_LOOK, AI_KEEP].join(" ");
};
