// The repo's flat 2D cast (toon.ts: bean heads, stick limbs, thick-thin ink) dressed for food stories.
// Unnamed, representative people only: bakers, customers, workers. Never a portrait of a real historical person.
//
// Two drawings exist per character and nothing else is faked from them:
//   FRONT (bodyFront): standing, facing the viewer. Used for anyone who stands, works or talks.
//   SIDE  (bodySide):  walking in profile. Used ONLY for someone crossing the frame; the stride of the drawn walk
//                      cycle is tied to the ground speed, so feet do not slide. Walking left is the same drawing
//                      mirrored (walkers carry nothing, so no tool changes hand).
// There is no back view and no 3/4 view: cameras must stay in front of the cast (see src/core/direct.ts).
// The drawing is chosen by what the character DOES in the shot, never by where the camera is, so it cannot flip
// back and forth when a camera crosses some angle, and any frame renders the same on its own.
import * as THREE from "three";
import { Pen, bodyFront, bodySide, Outfit, Expr, SKINS, FrontOpts, INK } from "../videos/bridge/toon";
import { Card } from "../core/stage";
import type { ActorInfo, V3 } from "../core/types";

export type Who = "baker" | "chef" | "apprentice" | "towns" | "paris" | "worker" | "modern" | "officer";
const COATS = ["#3f6fb5", "#8c3b4a", "#5d7a3a", "#b5653f", "#2f5f6a", "#7b5ac9"];
export const outfitFor = (who: Who, v: number): Outfit => {
  const skin = SKINS[v % 4];
  switch (who) {
    case "baker": return { jacket: "#f3efe4", pants: "#6a5a4a", boots: "#4a3426", skin, build: v % 2 ? "stout" : "adult", ...(v % 3 === 1 ? { moustache: "#4a3426" } : {}) };
    // classic baker from the channel's character sheet (references/own/characters/chef-*.png): tall toque, double-breasted
    // white jacket, long apron with flour, red neckerchief, big moustache, sturdy build
    case "chef": return { jacket: "#fbf8f0", pants: "#4a4650", boots: "#3a2a20", skin, build: "stout", moustache: "#4a2f20", hat: "toque", neck: "#d23a32", apron: "#fffdf6", flour: true, buttons2: true, bigMoustache: true };
    case "apprentice": return { jacket: "#e9e2d0", pants: "#5a5046", boots: "#4a3426", skin, build: "kid" };
    // early-modern townsfolk: caps and bonnets, no top hats
    case "towns": return v % 2 ? { jacket: COATS[v % 6], pants: "#3b3f52", boots: "#4a3426", skin, hat: "bonnet", dress: ["#a8763a", "#8a5a6a", "#56708a"][v % 3] } : { jacket: COATS[(v + 2) % 6], pants: "#4a4238", boots: "#3a2a20", skin, hat: "cap", cap: "#6a4a32" };
    // 1830s-1840s Paris street: top hats and bonnets
    case "paris": return v % 2 ? { jacket: COATS[(v + 1) % 6], pants: "#3b3f52", boots: "#4a3426", skin, hat: "bonnet", dress: ["#d9a441", "#c25a7a", "#5a8fc2"][v % 3] } : { jacket: ["#2f3a52", "#4a2f3a", "#33453a"][v % 3], pants: "#c9c2b0", boots: "#2a2a2a", skin, hat: "tophat" };
    // a generic 1830s army officer (representative figure, not a portrait): plain dark coat, shako
    case "officer": return { jacket: "#5b4f46", pants: "#d8d2c2", boots: "#2a2a2a", skin, hat: "shako", buttons: "#e8c45a", belt: null, build: "adult" };
    case "worker": return { jacket: "#eef3f6", pants: "#9fb0bd", boots: "#f4f1ea", skin, hat: "cap", cap: "#eef3f6" };
    default: return { jacket: ["#e2453c", "#2f8f9d", "#f0b429", "#6c5ce7"][v % 4], pants: "#3b4a6a", boots: "#f4f1ea", skin, hat: "hair", hair: ["#5a3b2a", "#2a201a", "#b58a4a", "#7a3a2a"][v % 4] };
  }
};
/** the side drawing has no skirt, so only characters without a dress may walk in profile */
export const canWalkSide = (who: Who, v: number) => !outfitFor(who, v).dress;
/** soft cloth cap + apron for bakers (drawn over the standard body; period-neutral working clothes) */
const bakerExtras = (p: Pen, stout: boolean) => {
  p.rot = null;
  const w = stout ? 78 : 66;
  p.poly([[300 - w, 462], [300 + w, 462], [300 + w + 6, 668], [300 - w - 6, 668]], "#fbf8f0", 7);
  p.stroke([[300 - w, 462], [300 - 40, 428]], 7); p.stroke([[300 + w, 462], [300 + 40, 428]], 7);
  p.ell(300, 206, 96, 46, "#fbf8f0", 8); p.ell(300, 176, 80, 52, "#fbf8f0", 8, 180, 360);
};
export type PersonOpts = FrontOpts & { v?: number; who?: Who };
export const drawPerson = (p: Pen, o: PersonOpts) => {
  const who = o.who ?? "towns", v = o.v ?? 0, of = outfitFor(who, v);
  bodyFront(p, of, { mode: "stand", seed: v * 3 + 1, ...o });
  if (who === "baker" && !o.tilt) bakerExtras(p, of.build === "stout");
};

const SU = 0.00216, STRIDE = 0.72;                 // metres per design unit; walking stride as a multiple of the 0.8 m step
const STEP_M = 2 * 370 * SU * STRIDE;              // ground covered by ONE full walk cycle of the side drawing (two steps)
const SIZE: Record<string, { top: number; head: number }> = { adult: { top: 1.68, head: 1.44 }, stout: { top: 1.68, head: 1.44 }, kid: { top: 1.29, head: 1.07 } };

export type Pose = { expr?: Expr; wave?: number; look?: number; scale?: number;
  /** LEGACY (pre-fix): front drawing stepping on the spot while the card moves `moving` m/s. Slides; kept only for the before/after audit. */
  walk?: number; moving?: number;
  /** walking in profile across the frame: `dir` +1 = toward +x (screen right for a camera in front), `dist` = metres walked so far (drives the step cycle, so feet stay planted) and `speed` in m/s */
  side?: { dir: 1 | -1; dist: number; speed: number };
  /** working hands on the FRONT drawing: [screen-left, screen-right] hand as [metres right of the body centre, metres
   *  above the ground], null = that arm hangs. Scenes animate these to knead, push a peel, hand something over. */
  hands?: [Hand | null, Hand | null];
  /** something held in the screen-right hand (drawn on the card) */
  hold?: "kipferl" | "croissant" };
export type Hand = [number, number];
const toCanvas = (h: Hand): [number, number] => [300 + h[0] / SU, 975 - h[1] / SU];
/** a small crescent roll held in the hand, drawn flat like the cast */
export const heldRoll = (p: Pen, x: number, y: number, croissant: boolean) => {
  const pts: [number, number][] = []; for (let i = 0; i <= 14; i++) { const a = Math.PI * (1.15 + 0.7 * i / 14); pts.push([x + 30 * Math.cos(a), y + 26 + 30 * Math.sin(a)]); }
  p.stroke(pts, croissant ? 24 : 19, INK); p.stroke(pts, croissant ? 17 : 12, croissant ? "#d98f3c" : "#e6b56a");
  if (croissant) for (const k of [4, 7, 10]) p.stroke([[pts[k][0] - 4, pts[k][1] - 7], [pts[k][0] + 4, pts[k][1] + 7]], 2.5, "#8a4f22");
  p.dot(x, y, 12);
};
/** one character card with pose state; call `pose` every frame (repaints only when the pose key changes) */
export class Person {
  card: Card; private last: ActorInfo | null = null;
  constructor(parent: import("three").Object3D, readonly who: Who, readonly v: number) { this.card = new Card(parent, 600, 1000); }
  pose(f: number, pos: V3, cam: V3, o: Pose = {}) {
    const blink = (f + this.v * 37) % 113 < 4, of = outfitFor(this.who, this.v), sz = SIZE[of.build ?? "adult"], scale = o.scale ?? 1;
    if (o.side) {
      const phase = Math.round((((o.side.dist / STEP_M) % 1) + 1) % 1 * 24) / 24, dir = o.side.dir;
      this.card.draw(`side|${this.who}|${this.v}|${phase}|${dir}|${blink ? 1 : 0}`, (p, g) => {
        if (dir < 0) { g.translate(600, 0); g.scale(-1, 1); }   // mirrored drawing = walking left
        bodySide(p, of, { mode: "march", phase, stride: STRIDE, stomp: 0.75, expr: o.expr ?? "neutral", blink, seed: this.v * 3 + 1 });
      });
    } else {
      const wave = o.wave !== undefined ? Math.round(o.wave * 6) / 6 : undefined, walking = o.walk !== undefined, phase = walking ? Math.round((o.walk! % 1) * 12) / 12 : 0;
      const hands = o.hands ? o.hands.map((h) => (h ? toCanvas(h).map(Math.round) as [number, number] : null)) as FrontOpts["hands"] : undefined;
      this.card.draw(`front|${this.who}|${this.v}|${o.expr ?? "neutral"}|${blink ? 1 : 0}|${wave}|${o.look ?? 0}|${phase}|${walking}|${JSON.stringify(hands)}|${o.hold}`, (p) => {
        drawPerson(p, { who: this.who, v: this.v, expr: o.expr ?? "neutral", blink, mode: walking ? "stroll" : "stand", phase, wave, look: o.look ?? 0, hands });
        if (o.hold && hands?.[1]) heldRoll(p, hands[1][0], hands[1][1], o.hold === "croissant");
      });
    }
    const m = this.card.mesh; m.position.set(...pos); m.scale.setScalar(scale); m.visible = true; this.card.face(cam);
    this.last = { id: `${this.who}${this.v}`, pos, top: sz.top * scale, head: sz.head * scale, yaw: m.rotation.y, tilt: Math.abs(m.rotation.x) + Math.abs(m.rotation.z), sprite: o.side ? "side" : "front",
      speed: o.side ? o.side.speed : o.moving ?? 0, stepSpeed: o.side ? o.side.speed : 0 };
  }
  hide() { this.card.mesh.visible = false; this.last = null; }
  /** world position of a hand given as [metres right, metres up] on this card (call after pose: the card must already face the camera) */
  handWorld(h: Hand): V3 { const m = this.card.mesh; m.updateMatrixWorld(true); const v = m.localToWorld(new THREE.Vector3(h[0], h[1], 0)); return [v.x, v.y, v.z]; }
  get info() { return this.card.mesh.visible ? this.last : null; }
}
/** actors() helper for scenes: also applies the "3D-only camera" rule */
export const cast = (people: Person[], chars: boolean): ActorInfo[] => {
  if (!chars) { people.forEach((p) => p.hide()); return []; }
  return people.map((p) => p.info).filter((x): x is ActorInfo => !!x);
};
