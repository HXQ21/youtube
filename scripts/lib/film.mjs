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
 *  null). 2026-11-26 the user dropped Seedance ("loại bỏ seedance sử dụng blender"): the picture is Blender's own
 *  render, so AI clips are never used. Final: only a guide rendered at --quality final (ink look, blender/look.py) for
 *  this exact segment key. Preview: any matching guide. Anything made for another key is stale and never used. */
export const chooseClip = (g, key, manifests, final) => {
  const guide = manifests.guide;
  if (!guide || guide.key !== key) return null;
  if (guide.quality === "final") return { src: `guide/${g.id}.mp4`, kind: "blender" };
  return final ? null : { src: `guide/${g.id}.mp4`, kind: "guide" };
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
// Only what the picture model needs. Editing notes, captions, emphasis words, signs and the legend sepia stay in
// Remotion (2026-11-24 review: s06 got the editor's "Danger" emphasis and the sepia request twice).
//
// Prompt v3 (2026-11-25) follows the official BytePlus "Dreamina Seedance 2.0 series prompt guide"
// (docs.byteplus.com/en/docs/ModelArk/seedance-2-0-prompt-guide, updated 2026-11-24):
// - Task type. An OMNI-REFERENCE task ("Refer to the camera movement ... in Video 1 to generate ..."), never edit
//   wording. In an edit task "parts not mentioned remain unchanged by default". v1/v2 opened with "Repaint this shot"
//   and listed what to keep from "the reference video", which reads as an edit. s01-s07 (754 credits, #25) came back
//   as near-copies of the guide.
// - Bind every reference inline: each asset gets one role, at the place it is used. The CLI turns {{res:<id>}} into
//   the asset mention. The most important asset comes first.
// - Define each character once by 2-3 stable features from its image, then use the same label every time.
// - Order: references, subjects, then Shot 1 / Shot 2 (camera move, action, place), lighting and colour, visual
//   style, image quality, constraints.
// - No exact timings ("0-3 s" is unstable): no seconds per shot.
// - One camera move per shot, in standard terms.
// - Slow, gentle, continuous movements named by body part.
// - Explicit style words against drift.
// - The guide's own anti-subtitle, logo, watermark and twin constraints.
// - One single full-body image per character (out/_cast_brand/single), not multi-pose sheets: the guide says
//   multi-view references cause duplicated characters and ID drift.
// - 4-5 assets in total, not the maximum.
export const PROMPT_VERSION = 3;

export const AI_STYLE = "Visual style: a 2D hand-drawn cartoon look on toon-shaded 3D sets, with bold near-black ink outlines on every object, "
  + "two-tone cel shading, soft painted shadows, and hand-painted textures (wood grain, brick, plaster, cobbles, flour, golden crust).";
export const AI_STYLE_PEOPLE = "The characters are flat 2D cartoon figures with ink outlines, drawn like their reference images, never 3D or realistic people.";
export const AI_QUALITY = "Image quality: HD, rich detail, clean crisp lines, full natural colour.";
export const AI_RULES = "Movements are slow, smooth and continuous, with no stutter or flicker. "
  + "Keep it subtitle-free: avoid generating any text, letters or subtitles; do not generate a logo or a watermark.";
export const AI_RULES_PEOPLE = "Faces and outfits stay stable without deformation. "
  + "Characters with identical appearance are prohibited: do not generate duplicates or a twin effect, and do not add extra people.";
export const AI_RULES_FOOD = "Every shot is redrawn in this style, the last one too. No people and no hands appear.";
/** sets where people can be on screen */
const PEOPLE_SETS = new Set(["bakery", "street"]);

/** stable features per character image (out/_cast_brand/single/<who>-v<v>.png): label + 2-3 features the eye can check */
export const CAST_LOOK = {
  "baker-v0": ["the baker", "a round man in a tall white chef's toque, with a black handlebar moustache, a red neckerchief and a white jacket and apron"],
  "baker-v1": ["the journeyman", "a man in a flat white baker's cap, with a blue neckerchief and a white jacket and apron"],
  "apprentice-v2": ["the apprentice", "a small boy with brown hair, a cream shirt with a green neckerchief and a white apron"],
  "officer-v1": ["the officer", "a man in a black top hat with a red band and a long buttoned grey-brown coat"],
  "paris-v1": ["the woman in pink", "a woman in a pink bonnet and pink dress with a green shawl"],
  "paris-v2": ["the gentleman", "a man in a black top hat, a dark green tailcoat and a mustard waistcoat"],
  "paris-v3": ["the woman in yellow", "a woman in a yellow bonnet and mustard dress with a teal shawl"],
  "towns-v4": ["the townsman", "a man in a brown flat cap, a plum coat and a mustard waistcoat"],
  "towns-v5": ["the townswoman", "a woman in a light-blue bonnet and blue dress with a maroon shawl"],
};
const castKey = (file) => String(file).replace(/^.*[\\/]/, "").replace(/\.png$/, "");
/** the label a shot uses for a character type: the defined one when that type has a reference, else a plain noun */
const labelFor = (who, chars) => { const k = chars.map((c) => castKey(c.file)).find((x) => x.startsWith(`${who}-`) && CAST_LOOK[x]); return k ? CAST_LOOK[k][0] : null; };

// concrete surfaces and the set's own colours (s01 v3 test, 2026-11-25: with only "on a cafe table" Seedance swapped the
// red cafe for a wooden table and dropped the plate's blue rim; the guide says to describe what must stay)
const ITEMS = { croissant: "a golden croissant with a flaky, layered, glossy crust",
  kipferl: "a crescent-shaped Viennese kipferl bread roll with a smooth, lightly dusted crust",
  cut: "a croissant broken in half, its flaky honeycomb layers showing inside, a few crumbs around it",
  cutk: "a kipferl broken in half showing its dense, soft bread crumb", pair: "a kipferl and a croissant side by side" };
const PLATE = "on a white plate with a blue rim";
const BACKDROPS = { cafe: `${PLATE}, on a cream marble bistro table in a Paris cafe, with a red banquette and a warm wall behind`,
  bakery: `${PLATE}, on a floured wooden board in a bakery, with a brick wall, a warm oven glow and bread shelves behind`,
  plain: `${PLATE}, on linen in front of a warm brown paper backdrop` };
const BAKER = { knead: "presses and folds the dough on the bench with both hands in a slow, steady rhythm",
  peel: "slowly slides a long wooden peel into the oven mouth with both hands; the peel and the bread on it move with his hands",
  listen: "stops working, lifts his head and turns it slightly toward the door, shoulders tense and still",
  serve: "gently hands pastries across the counter to the customers", idle: "works calmly at the bench" };
const STEPS = { butter: "a slab of butter is laid on a sheet of dough and the dough is slowly folded over it",
  layers: "a cut through laminated dough shows the butter layers multiplying",
  bake: "a tray of croissants slowly rises and turns golden in the oven" };
const ERA = { old: "in the late 1600s", 1839: "in 1839" };

/** one standard camera term per shot (the guide video carries the exact path) */
const CAMS = {
  macro: "Extreme close-up, slow push-in", heroUp: "Low-angle close-up, slow push-in", top: "Top-down shot, slow push-in",
  orbit: "Close-up, slow orbit around the food", dutch: "Tilted close-up, fixed camera",
  wideL: "Wide shot, slow lateral drift", wideR: "Wide shot, slow lateral drift", main: "Wide shot, slow push-in",
  baker: "Close-up on the face, slow push-in", face: "Close-up on the face, slow push-in", helper: "Medium shot, fixed camera",
  oven: "Medium shot beside the oven, fixed camera", door: "Medium shot of the shop door", sign: "Detail shot of the shop sign, slow push-in",
  shop: "Wide shot of the shop front", skyline: "Low-angle wide shot of the rooftops, slow tilt", low: "Low-angle close-up, slow push-in",
};
const CAM_PLACES = { door: "the shop door", face: "a close-up of the face", sign: "the shop sign", shop: "the shop front", wideL: "a wide view", wideR: "a wide view", main: "a wide view" };
export const camText = (cam) => {
  if (cam && typeof cam === "object" && cam.from) return `Slow camera move from ${CAM_PLACES[cam.from] ?? "a wide view"} to ${CAM_PLACES[cam.to] ?? "a closer view"}`;
  return CAMS[cam] ?? "Fixed camera";
};

/** light and colour per set, the element the guide ranks highest for quality */
export const lightText = (scene, light) => {
  if (scene === "bakery") return light === "night"
    ? "Lighting and colour: night, warm orange firelight from the brick oven pooling on the floor and faces, cool blue shade in the corners, soft cast shadows."
    : "Lighting and colour: warm morning daylight through the shop window, soft cast shadows, cosy warm tones.";
  if (scene === "street") return light === "golden"
    ? "Lighting and colour: golden late-afternoon sun, long soft shadows on the cobbles, warm facades and cool blue shade."
    : "Lighting and colour: bright morning sun, soft shadows on the cobbles, clear blue sky, warm stone colours.";
  if (scene === "pastry") return "Lighting and colour: soft warm window light from the side, gentle highlights on the crust, warm shadows.";
  if (scene === "lamination") return "Lighting and colour: warm kitchen light from above, soft shadows on the floured bench.";
  if (scene === "page") return "Lighting and colour: warm desk-lamp light on the old paper, soft vignette.";
  return "Lighting and colour: warm, soft, motivated light with soft shadows.";
};

/** plain English for one shot, from its structured params (never the Vietnamese editor note). `chars` = the character
 *  references, so a character with a reference is called by its defined label */
export const shotText = (s, chars = []) => {
  const p = s.params ?? {}, era = ERA[p.era] ? ` ${ERA[p.era]}` : "";
  const baker = labelFor("baker", chars) ?? "the baker", officer = labelFor("officer", chars) ?? "an officer";
  if (s.scene === "pastry") return [ITEMS[p.item] ?? "a pastry", BACKDROPS[p.backdrop], p.steam === 0 ? "" : "a thin wisp of steam slowly rising"].filter(Boolean).join(", ");
  if (s.scene === "bakery") return `inside a small bakery${era}${p.who === "paris" ? " in Paris" : p.who === "towns" ? " in Vienna" : ""}, ${baker} ${BAKER[p.action] ?? BAKER.idle}${p.customers ? `, ${p.customers} customers wait at the counter` : ""}`;
  if (s.scene === "street") {
    const crowd = labelFor(p.place === "vienna" ? "towns" : "paris", chars);
    const city = p.place === "vienna" ? "an old Vienna street" : "a Paris street in 1839";
    const bits = [p.officer === "walk" ? `${officer} walks slowly into frame` : p.officer ? `${officer} stands still in the street, looking ahead` : "", p.sign ? "a bakery shop front with a hanging sign" : "",
      p.queue ? "customers queue calmly at the shop" : "", p.crowd ? `townsfolk${crowd ? `, among them ${crowd},` : ""} walk slowly past` : ""].filter(Boolean);
    return `${city}${bits.length ? `, ${bits.join(", ")}` : ""}`;
  }
  if (s.scene === "lamination") return `a floured work surface, ${STEPS[p.step] ?? "croissant dough is laminated with butter"}`;
  if (s.scene === "page") return "an old chronicle book page on a desk, its writing too small to read";
  return `a shot in the ${s.scene} set`;
};

/** the references, in the order of importance (the guide: what must be followed most precisely comes first).
 *  refs = { video: mention, chars: [{ file, tag }], style: mention|null }; a mention is "{{res:<id>}}" for the CLI or
 *  "Video 1" / "Image 1" when no id is known yet (tests, dry runs) */
export const refLines = (refs, people = true) => {
  const lines = [`Refer to the camera movement, the shot timing and where ${people ? "everyone stands and moves" : "everything stands"} in ${refs.video} to generate a new, fully redrawn video; take only motion and layout from it, not its plain flat colours or bare surfaces.`];
  for (const c of refs.chars ?? []) {
    const look = CAST_LOOK[castKey(c.file)];
    lines.push(look ? `Define ${look[1]} in ${c.tag} as ${look[0]}.` : `Use the character in ${c.tag} as a reference for how that character looks.`);
  }
  if (refs.style) lines.push(`Use ${refs.style} as the visual style reference: match its ink outlines, cel shading, light and colour, not its layout.`);
  return lines.join(" ");
};

/** the Seedance prompt for one segment (formula of the official guide): references, shots, light, style, quality, rules.
 *  `refs` as in refLines; the default mentions fit a call without uploads */
export const aiPrompt = (seg, shotsById, fps = 30, refs = { video: "Video 1", chars: [], style: null }) => {
  const shots = seg.shots.map((id) => shotsById[id]).filter(Boolean), chars = refs.chars ?? [];
  const one = shots.length === 1;
  const parts = shots.map((s, i) => `${one ? "" : `Shot ${i + 1}: `}${camText(s.camera)}, ${shotText(s, chars)}${s.ai ? `. ${s.ai}` : ""}.`);
  // the guide is padded to genSec by holding its last frame: say so in words, not seconds
  if (seg.genSec > seg.sec + 0.05) parts.push(`${one ? "The shot" : `Shot ${shots.length}`} ends in a calm, slow hold.`);
  const light = [...new Set(shots.map((s) => lightText(s.scene, s.light)))].join(" ");
  const people = chars.length > 0 || shots.some((s) => PEOPLE_SETS.has(s.scene));
  return [refLines({ ...refs, chars }, people), parts.join(" "), light, AI_STYLE, ...(people ? [AI_STYLE_PEOPLE] : []), AI_QUALITY, AI_RULES,
    people ? AI_RULES_PEOPLE : AI_RULES_FOOD].join(" ");
};
