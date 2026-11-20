// "street": a bakery shopfront on a town street, with people.     "siege": a night camp below a city wall (legend scenes).
// street params: place = vienna | paris;  sign = text on the shop sign (only for documented shop names);  crowd = 0..6;  queue = 0..4
//   cams: main (street), shop, low, sign
// siege params: none.   cams: main, fire, wall.   Uses castle wall / tower models from the asset manifest (placeholders until delivered).
import * as THREE from "three";
import { facadeHD, cobbleHD, roofHD, rep, ctex } from "../videos/bridge/paint";
import { NOINK } from "../videos/bridge/ink";
import { noChars, mat, glow, mesh, box, cyl, woodTex, Card, frame, drift, hash, lerp, charCam } from "../core/stage";
import { loaf, pastry } from "./food";
import { Person, cast, canWalkSide } from "./people";
import type { CamState, Ctx, SceneDef, V3 } from "../core/types";

type B = { w: number; h: number; wall: string; shutter: string; timber?: boolean; roof: string };
const ROWS: Record<string, B[]> = {
  // steep-roofed, partly timber-framed houses
  vienna: [{ w: 6, h: 6.2, wall: "#e6d2a8", shutter: "#5a7a4a", timber: true, roof: "#b5553a" }, { w: 5, h: 7.4, wall: "#d9b98a", shutter: "#7a4a32", roof: "#a04a34" }, { w: 7, h: 6.4, wall: "#ecdcb8", shutter: "#3f6f8a", roof: "#b5553a" },
    { w: 5.5, h: 7.8, wall: "#d2c2a2", shutter: "#5a7a4a", timber: true, roof: "#9a4a36" }, { w: 6, h: 6.0, wall: "#e2c89a", shutter: "#7a4a32", roof: "#b5553a" }],
  // taller plaster fronts with rows of shuttered windows and slate roofs
  paris: [{ w: 6.5, h: 12.5, wall: "#e9dfc9", shutter: "#6f8296", roof: "#59616e" }, { w: 5.5, h: 14, wall: "#dccdb2", shutter: "#8a9aa0", roof: "#4f5762" }, { w: 7, h: 12, wall: "#efe6d2", shutter: "#5f7385", roof: "#59616e" },
    { w: 6, h: 13.5, wall: "#e2d6bf", shutter: "#7b8b93", roof: "#4f5762" }, { w: 6, h: 12.5, wall: "#d8cab0", shutter: "#6f8296", roof: "#59616e" }],
};
/** gable roof as an explicit prism (two slopes + two gable ends), ridge along z, flat normals, uv in metres */
const gable = (w: number, d: number, h: number) => {
  const a = w / 2, z = d / 2, s = Math.hypot(a, h), P: number[] = [], U: number[] = [];
  const tri = (p: number[][], uv: number[][]) => { for (let i = 0; i < 3; i++) { P.push(...p[i]); U.push(uv[i][0] / 3, uv[i][1] / 3); } };
  const quad = (p0: number[], p1: number[], p2: number[], p3: number[], uw: number, uh: number) => { tri([p0, p1, p2], [[0, 0], [uw, 0], [uw, uh]]); tri([p0, p2, p3], [[0, 0], [uw, uh], [0, uh]]); };
  quad([a, 0, z], [a, 0, -z], [0, h, -z], [0, h, z], d, s); quad([-a, 0, -z], [-a, 0, z], [0, h, z], [0, h, -z], d, s);
  tri([[-a, 0, z], [a, 0, z], [0, h, z]], [[0, 0], [w, 0], [a, h]]); tri([[a, 0, -z], [-a, 0, -z], [0, h, -z]], [[0, 0], [w, 0], [a, h]]);
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); g.computeVertexNormals(); return g;
};
const signTex = (text: string | null) => ctex("sign" + (text ?? ""), 1024, 320, (g) => {
  g.fillStyle = "#2f4a3a"; g.fillRect(0, 0, 1024, 320); g.strokeStyle = "#e8c45a"; g.lineWidth = 14; g.strokeRect(18, 18, 988, 284);
  if (text) { g.fillStyle = "#f3e2a8"; g.textAlign = "center"; g.textBaseline = "middle"; let px = 150; g.font = `700 ${px}px Georgia, 'Times New Roman', serif`; while (g.measureText(text).width > 900 && px > 40) { px -= 6; g.font = `700 ${px}px Georgia, 'Times New Roman', serif`; } g.fillText(text, 512, 166); }
  else { g.strokeStyle = "#f3e2a8"; g.lineWidth = 46; g.lineCap = "round"; g.beginPath(); g.arc(512, 250, 150, Math.PI * 1.12, Math.PI * 1.88); g.stroke(); } // a crescent roll emblem
});

export const streetScene: SceneDef = {
  id: "street",
  build(env) {
    const root = new THREE.Group();
    const cob = rep(cobbleHD(), 40, 34); root.add(mesh(new THREE.PlaneGeometry(240, 200).rotateX(-Math.PI / 2), mat("#ffffff", { map: cob, key: "cobble" }), [0, 0, 60], false));
    const rows: Record<string, THREE.Group> = {};
    for (const [place, list] of Object.entries(ROWS)) {
      const g = new THREE.Group(); rows[place] = g; root.add(g);
      const total = list.reduce((n, b) => n + b.w, 0); let x = -total / 2;
      list.forEach((b, i) => {
        const cx = x + b.w / 2; x += b.w;
        const shop = i === 2;
        // Every other house is set back 0.45 m. Flush fronts left a pixel-thin crack where two boxes meet; the ink pass
        // caught the side faces through it and drew a broken black dash up the seam. A real step gives one solid line.
        const zc = -7 - (i % 2 ? 0.45 : 0);
        g.add(mesh(new THREE.BoxGeometry(b.w, b.h, 6), [mat(b.wall), mat(b.wall), mat(b.wall), mat(b.wall), mat("#ffffff", { map: facadeHD(`${place}${i}`, b.w, b.h, { wall: b.wall, shutter: b.shutter, door: !shop, timber: b.timber }), key: `fac${place}${i}` }), mat(b.wall)], [cx, b.h / 2, zc]));
        if (place === "vienna") { const r = mesh(gable(b.w + 0.5, 6.6, b.w * 0.55), mat("#ffffff", { map: roofHD(b.roof), key: "roof" + b.roof, side: THREE.DoubleSide }), [cx, b.h, zc]); g.add(r); g.add(box(0.5, 1.4, 0.5, mat("#9a8a7a"), [cx + b.w * 0.25, b.h + b.w * 0.2, zc - 0.5])); }
        else { g.add(box(b.w + 0.2, 1.5, 6.2, mat(b.roof), [cx, b.h, zc])); for (let k = 0; k < 2; k++) g.add(box(0.5, 1.6, 0.6, mat("#b9a58f"), [cx - b.w * 0.25 + k * b.w * 0.5, b.h + 1.5, zc - 0.5])); }
      });
    }
    // shopfront (centre building, x in [-3.5, 3.5])
    // The shopfront stands 0.27 m proud of the house and the door and window have deep casings: a step of a few cm
    // (the old 0.14 m board, the 4 cm door) sat under the ink pass's depth threshold at 8-12 m, so their outlines came
    // and went along the edge (broken lines). Same front face as before (z 0.07 in shop space).
    const shop = new THREE.Group(); shop.position.set(0, 0, -3.8); root.add(shop);
    const wood = mat("#ffffff", { map: woodTex("shop", "#3d5a48", "#22382c") }), trim = mat("#22382c");
    shop.add(box(6.6, 3.3, 0.3, wood, [0, 0, -0.08]), mesh(new THREE.PlaneGeometry(3.0, 1.7), glow("#ffe9b8", 1.25), [-1.2, 1.75, 0.09], false), box(1.1, 2.3, 0.1, mat("#5a3b2a"), [2.2, 0, 0.06]), mesh(new THREE.PlaneGeometry(0.7, 0.8), glow("#ffe9b8", 1.1), [2.2, 1.6, 0.13], false));
    for (const x of [-2.78, 0.38]) shop.add(box(0.14, 1.95, 0.24, trim, [x, 0.8, 0.12]));            // window posts
    shop.add(box(0.07, 1.8, 0.08, trim, [-1.2, 0.88, 0.1]), box(3.3, 0.14, 0.24, trim, [-1.2, 2.6, 0.12])); // mullion, lintel
    for (const x of [1.58, 2.82]) shop.add(box(0.14, 2.45, 0.26, trim, [x, 0, 0.13]));                // door casing
    shop.add(box(1.4, 0.16, 0.26, trim, [2.2, 2.3, 0.13]));
    shop.add(box(3.2, 0.1, 0.5, mat("#22382c"), [-1.2, 0.8, 0.25]));
    const disp = new THREE.Group(); disp.position.set(-1.2, 0.9, 0.28); shop.add(disp);
    for (let i = 0; i < 6; i++) disp.add(i % 2 ? pastry({ len: 0.42, r: 0.075, kind: "kipferl" }, [-1.15 + i * 0.46, 0, 0], 0.2) : loaf("round", [-1.15 + i * 0.46, 0, 0], i));
    const awn = mesh(new THREE.BoxGeometry(6.8, 0.07, 1.5), mat("#c9423a"), [0, 3.25, 0.75]); awn.rotation.x = 0.32; shop.add(awn);
    const signs = new Map<string, THREE.Mesh>(); const signAt: V3 = [0, 4.05, 0.12];
    const steps = box(1.5, 0.16, 0.5, mat("#bfb3a0"), [2.2, 0, -3.6]); root.add(steps);
    // street dressing from the Fantasy Town kit (CC0); placeholders appear if a file is missing
    const lampA = env.model("kenney-fantasy-town/lantern", { h: 2.6 }); lampA.position.set(-5.5, 0, -2.6); const lampB = env.model("kenney-fantasy-town/lantern", { h: 2.6 }); lampB.position.set(5.2, 0, -2.6);
    const cart = env.model("kenney-fantasy-town/cart", { h: 1.5 }); cart.position.set(6.8, 0, 0.4); cart.rotation.y = -0.5;
    const stall = env.model("kenney-fantasy-town/stall-green", { h: 2.6 }); stall.position.set(-8, 0, -2.2); stall.rotation.y = 0.3;
    const fountain = env.model("kenney-fantasy-town/fountain-round", { h: 1.0 }); fountain.position.set(-10.5, 0, -2.4); // kept behind the walkers so it never sits half in frame right at the lens
    root.add(lampA, lampB, cart, stall, fountain);
    const walkers = [0, 1, 2, 3, 4, 5].map((i) => ({ towns: new Person(root, "towns", i), paris: new Person(root, "paris", i) }));
    const officer = new Person(root, "officer", 1);
    const queue = [0, 1, 2, 3].map((i) => ({ towns: new Person(root, "towns", i + 7), paris: new Person(root, "paris", i + 7) }));
    const people = [officer, ...walkers.flatMap((x) => [x.towns, x.paris]), ...queue.flatMap((x) => [x.towns, x.paris])]; let charsOn = true;
    const cam = (centre: V3, dir: V3, w: number, h: number, fov = 36, cInf = 6) => (c: Ctx): CamState => drift(frame(centre, w, h, dir, c.aspect, fov, 1.05, cInf), c.u, 0.05, 0.04);
    return {
      root, light: "day", actors: () => cast(people, charsOn),
      // Character cameras (charCam): eye level, no roll, in front of the cast. 3D-only set-ups (cam): cast hidden.
      cams: {
        main: charCam([0, 3.3, -4], 17, 7.4, { yaw: 10, pitch: 4.5, fov: 38, cInf: 3, portrait: [[0, 3.2, -4], 9.5, 9], ppitch: 2.5 }),
        wideL: charCam([-0.5, 3.2, -4], 15, 7.4, { yaw: 26, pitch: 5, fov: 38, cInf: 3, portrait: [[0, 3.1, -4], 9, 8.6], ppitch: 2.5 }),
        wideR: charCam([0.5, 3.2, -4], 15, 7.4, { yaw: -24, pitch: 5, fov: 38, cInf: 3, portrait: [[0, 3.1, -4], 9, 8.6], ppitch: 2.5 }),
        shop: charCam([0, 2.2, -3.9], 7.6, 4.6, { yaw: 7, pitch: 3, fov: 34, cInf: 5 }),
        low: charCam([0.5, 1.25, -1.2], 5.5, 2.5, { yaw: 24, pitch: 2, cInf: 10, portrait: [[0.3, 1.2, -0.6], 3.3, 2.6], pyaw: 16 }),
        door: charCam([2.3, 1.25, -3.2], 2.9, 2.6, { yaw: -14, pitch: 2, cInf: 9 }),
        face: charCam([2.2, 1.4, -2.9], 1.0, 1.0, { yaw: -10, pitch: 1, fov: 26, cInf: 12, push: 0.03 }),
        sign: cam([0, 3.7, -3.9], [0.1, -0.06, 1], 5, 2.2, 28, 8),
        high: cam([0, 2, -2.5], [0.25, 0.8, 1], 15, 10, 36, 2),
        skyline: cam([0, 7.5, -6.5], [0.3, -0.22, 1], 13, 8, 34, 2),
      },
      shots: { main: { kind: "wide", chars: true }, wideL: { kind: "wide", chars: true }, wideR: { kind: "wide", chars: true }, shop: { kind: "wide", chars: true }, low: { kind: "medium", chars: true },
        door: { kind: "medium", chars: true }, face: { kind: "closeup", chars: true }, sign: { kind: "detail", chars: false }, high: { kind: "top", chars: false }, skyline: { kind: "top", chars: false } },
      update(c: Ctx, cm: CamState) {
        const p = c.params as { place?: string; sign?: string; crowd?: number; queue?: number }, place = p.place === "vienna" ? "vienna" : "paris";
        for (const [k, g] of Object.entries(rows)) g.visible = k === place;
        const key = p.sign ?? "";
        if (!signs.has(key)) { const m = mesh(new THREE.PlaneGeometry(4.6, 1.4), mat("#ffffff", { map: signTex(p.sign ?? null), key: "sign" + key }), signAt, false); shop.add(m); signs.set(key, m); }
        for (const [k, m] of signs) m.visible = k === key;
        fountain.visible = stall.visible = place === "vienna";
        const n = p.crowd ?? 4, pick = (o: { towns: Person; paris: Person }) => { (place === "paris" ? o.towns : o.paris).hide(); return place === "paris" ? o.paris : o.towns; };
        // Who walks and who stands is decided by the drawing each character owns, not by the camera: only characters
        // without a dress have a profile walk, so they cross the street in profile; the others stand and chat (front).
        const tsec = c.f / c.fps, who = place === "paris" ? "paris" : "towns", STAND: V3[] = [[-3.4, 0, -2.4], [4.3, 0, -2.3], [-5.2, 0, -2.7]]; // by the house fronts, clear of the fountain, cart and walking lanes
        walkers.forEach((w, i) => { const P = pick(w); if (i >= n) return P.hide();
          if (!canWalkSide(who, P.v)) return P.pose(c.f, STAND[(i >> 1) % 3], cm.pos, { expr: i % 4 === 1 ? "smile" : "grin", look: i % 4 === 1 ? 1 : -1 });
          const dirn = i % 4 === 0 ? 1 : -1, speed = 0.95 + 0.2 * hash(i), span = 22, x0 = -11 + hash(i * 3) * span, x = ((x0 + dirn * speed * tsec + 11) % span + span) % span - 11;
          P.pose(c.f, [x, 0, -0.6 + (i % 3) * 1.3], cm.pos, { side: { dir: dirn as 1 | -1, dist: speed * tsec + hash(i) * 3, speed }, expr: i % 3 ? "neutral" : "smile" }); });
        const off = (p as { officer?: string }).officer; // "stand" | "walk": the unnamed ex-officer arriving at the shop
        // walking in: constant pace for the whole shot, profile drawing, steps tied to the distance covered (no sliding);
        // the cut to the next shot hides the change to the standing front drawing
        const walked = 1.5 * c.p, ospeed = 1.5 / Math.max(0.3, c.dur);
        if (!off) officer.hide(); else if (off === "walk") officer.pose(c.f, [lerp(3.9, 2.4, c.p), 0, -2.9], cm.pos, { side: { dir: -1, dist: walked, speed: ospeed }, expr: "neutral" });
        else officer.pose(c.f, [2.2, 0, -2.9], cm.pos, { expr: "smile", hands: [[-0.36 - 0.03 * Math.sin(c.t * 2), 1.1], [0.16, 0.9]] }); // presents his shop
        const q = p.queue ?? 0; queue.forEach((w, i) => { const P = pick(w); if (i >= q) return P.hide(); P.pose(c.f, [2.5 + i * 0.95, 0, -2.75 + (i % 2) * 0.2], cm.pos, { expr: i % 2 ? "smile" : "grin", look: -1, ...(i === 1 ? { hands: [null, [0.24, 0.98 + 0.03 * Math.sin(c.t * 1.7)]], hold: "kipferl" as const } : {}) }); });
        charsOn = c.chars; if (!c.chars) people.forEach((x) => x.hide());
      },
    };
  },
};

const flagTex = () => ctex("crescentFlag", 256, 384, (g) => { g.fillStyle = "#a8322c"; g.fillRect(0, 0, 256, 384); g.fillStyle = "#f1e3b0"; g.beginPath(); g.arc(128, 170, 70, 0, 7); g.fill(); g.fillStyle = "#a8322c"; g.beginPath(); g.arc(152, 160, 62, 0, 7); g.fill(); });
export const siegeScene: SceneDef = {
  id: "siege",
  build(env) {
    const root = new THREE.Group();
    root.add(mesh(new THREE.PlaneGeometry(120, 80).rotateX(-Math.PI / 2), mat("#5a6b4a"), [0, 0, -10], false));
    // city wall: castle-kit pieces when delivered, hatched placeholders otherwise
    for (let i = -3; i <= 3; i++) { const w = env.model("kenney-castle-kit/wall", { h: 7, fallback: [6.2, 7, 2] }); w.position.set(i * 6.2, 0, -26); root.add(w); }
    for (const x of [-21.5, 0, 21.5]) { const t = env.model("kenney-castle-kit/tower", { h: 11, fallback: [5, 11, 5] }); t.position.set(x, 0, -27); root.add(t); }
    for (const [x, z, r] of [[-7, -6, 0.5], [-1.5, -9, -0.2], [5, -5, -0.6], [10, -10, 0.2], [-12, -11, 0.9]] as const) { const t = env.model(`kenney-nature/${x > 4 ? "tent_smallOpen" : "tent_detailedOpen"}`, { h: 2.5 }); t.position.set(x, 0, z); t.rotation.y = r; root.add(t); }
    const fire = env.model("kenney-nature/campfire_logs", { h: 0.45 }); fire.position.set(1.2, 0, -2.5); root.add(fire);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex("flame", 128, 128, (g) => { const gr = g.createRadialGradient(64, 80, 4, 64, 70, 60); gr.addColorStop(0, "rgba(255,240,170,1)"); gr.addColorStop(0.5, "rgba(255,150,50,0.8)"); gr.addColorStop(1, "rgba(255,90,20,0)"); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }), transparent: true, depthWrite: false, fog: false, color: new THREE.Color(3, 2.2, 1.2) }));
    flame.position.set(1.2, 0.75, -2.5); flame.scale.set(1.3, 1.7, 1); flame.layers.set(NOINK); root.add(flame);
    for (const [x, z] of [[-5.5, -4], [3.8, -7.5], [8.5, -3.5]]) { root.add(cyl(0.05, 0.06, 3.6, mat("#6a4a30"), [x, 0, z])); root.add(mesh(new THREE.PlaneGeometry(0.9, 1.35), mat("#ffffff", { map: flagTex(), key: "cflag", side: THREE.DoubleSide }), [x + 0.5, 2.85, z])); }
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex("moon", 128, 128, (g) => { g.fillStyle = "#fdf6d8"; g.beginPath(); g.arc(64, 64, 54, 0, 7); g.fill(); }), fog: false, depthWrite: false, color: new THREE.Color(1.6, 1.6, 1.5) }));
    moon.position.set(-14, 26, -60); moon.scale.setScalar(7); moon.layers.set(NOINK); root.add(moon);
    const glowCard = new Card(root, 600, 600, { lit: false, shadow: false, unit: 0.006, baseline: 300 }); glowCard.mesh.visible = false;
    const cam = (centre: V3, dir: V3, w: number, h: number, fov = 36, cInf = 6) => (c: Ctx): CamState => drift(frame(centre, w, h, dir, c.aspect, fov, 1.05, cInf), c.u, 0.05, 0.04);
    return {
      root, light: "night", shots: noChars({ main: "wide", fire: "wide", wall: "wide" }),
      cams: { main: (c) => (c.aspect < 1 ? cam([1, 4, -12], [0.15, 0.12, 1], 17, 14, 38, 3)(c) : cam([0, 4.5, -12], [0.15, 0.12, 1], 34, 12, 38, 3)(c)), fire: cam([1.5, 1.3, -3.5], [0.3, 0.1, 1], 9, 4, 32, 8), wall: cam([0, 5, -26], [-0.2, 0.02, 1], 22, 10, 30, 2) },
      update(c: Ctx) { const k = 0.85 + 0.3 * hash(Math.floor(c.f / 3)); flame.scale.set(1.3 * k, 1.7 * (2 - k) * 0.9, 1); },
    };
  },
};
