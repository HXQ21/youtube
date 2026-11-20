// "page": a document on a desk (chronicle, dictionary, cookbook, newspaper, letter). Used when the narration cites
//   written evidence. The pages carry ruled lines and drawings, never invented readable text.
//   params: kind = chronicle | dictionary | cookbook | newspaper | letter.   cams: main, macro, top.   action "mark": a highlight sweeps in.
// "factory": industrial croissants.   params: view = line | freezer.   cams: main, macro, wide.
//   Conveyor, machine and freezer come from the asset manifest (hatched placeholders until delivered).
import * as THREE from "three";
import { ctex } from "../videos/bridge/paint";
import { noChars, mat, gloss, glow, mesh, box, cyl, woodTex, checkTex, frame, drift, smooth, hash, actionT } from "../core/stage";
import { pastryGeo, pastry } from "./food";
import { twoTone } from "../videos/bridge/shade";
import { Person, cast } from "./people";
import type { CamState, Ctx, SceneDef, V3 } from "../core/types";

const INK = "#3a2a22";
const lines = (g: CanvasRenderingContext2D, r: () => number, x: number, y: number, w: number, n: number, gap: number, lw = 5) => {
  g.strokeStyle = INK; g.lineCap = "round";
  for (let i = 0; i < n; i++) { let cx = x; const yy = y + i * gap; while (cx < x + w - 20) { const len = 18 + r() * 70; g.globalAlpha = 0.55 + r() * 0.3; g.lineWidth = lw; g.beginPath(); g.moveTo(cx, yy); g.lineTo(Math.min(x + w, cx + len), yy); g.stroke(); cx += len + 12 + r() * 10; } }
  g.globalAlpha = 1;
};
const crescent = (g: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string) => {
  g.save(); g.translate(x, y); g.scale(s, s); g.fillStyle = fill; g.strokeStyle = INK; g.lineWidth = 6 / s; g.beginPath(); g.arc(0, 0, 100, Math.PI * 1.08, Math.PI * 1.92); g.quadraticCurveTo(0, -62, -95, -25); g.closePath(); g.fill(); g.stroke();
  for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(i * 30, -96 + Math.abs(i) * 9); g.lineTo(i * 26, -60 + Math.abs(i) * 6); g.stroke(); } g.restore();
};
const pageTex = (kind: string, side: number) => ctex(`page${kind}${side}`, 768, 1024, (g, r) => {
  g.fillStyle = kind === "chronicle" ? "#ead9b0" : kind === "newspaper" ? "#e9e3d2" : "#f4ecd8"; g.fillRect(0, 0, 768, 1024);
  if (kind === "chronicle") { if (!side) { g.fillStyle = "#a8322c"; g.fillRect(70, 90, 150, 170); g.strokeStyle = "#c9a23a"; g.lineWidth = 10; g.strokeRect(70, 90, 150, 170); lines(g, r, 250, 120, 440, 4, 44, 7); lines(g, r, 70, 310, 620, 14, 46, 7); } else { crescent(g, 384, 330, 1.7, "#e7bd76"); lines(g, r, 70, 520, 620, 9, 46, 7); } }
  else if (kind === "dictionary") { for (const x of [60, 410]) lines(g, r, x, 90, 300, 30, 30, 4); if (!side) { g.fillStyle = INK; g.fillRect(60, 372, 120, 10); } }
  else if (kind === "cookbook") { if (!side) { g.fillStyle = INK; g.fillRect(180, 110, 400, 12); crescent(g, 384, 330, 1.5, "#e19c3f"); lines(g, r, 80, 520, 600, 10, 42, 5); } else for (let i = 0; i < 6; i++) { g.fillStyle = INK; g.beginPath(); g.arc(100, 140 + i * 140, 14, 0, 7); g.fill(); lines(g, r, 140, 126 + i * 140, 540, 3, 30, 5); } }
  else if (kind === "newspaper") { g.fillStyle = INK; g.fillRect(60, 70, 648, 70); g.fillRect(60, 160, 648, 6); for (const x of [60, 282, 504]) lines(g, r, x, 210, 204, 26, 29, 4); }
  else { lines(g, r, 110, 200, 540, 15, 48, 5); g.fillStyle = "#a8322c"; g.beginPath(); g.arc(560, 880, 46, 0, 7); g.fill(); }
});

export const pageScene: SceneDef = {
  id: "page",
  build() {
    const root = new THREE.Group();
    root.add(mesh(new THREE.BoxGeometry(2.6, 0.05, 1.6), mat("#ffffff", { map: woodTex("desk", "#6a5546", "#46352a") }), [0, -0.025, 0]), box(3, 1.6, 0.1, mat("#8a6a52"), [0, -0.4, -1.1]));
    const kinds = ["chronicle", "dictionary", "cookbook", "newspaper", "letter"], docs: Record<string, THREE.Group> = {};
    for (const k of kinds) {
      const g = new THREE.Group(); docs[k] = g; root.add(g);
      const book = k === "chronicle" || k === "dictionary" || k === "cookbook";
      if (book) {
        g.add(box(0.5, 0.03, 0.34, mat(k === "chronicle" ? "#6a2f28" : k === "dictionary" ? "#2f3f5a" : "#3f5a3a"), [0, 0, 0]));
        for (const s of [0, 1]) { const pg = mesh(new THREE.BoxGeometry(0.235, 0.022, 0.32), [mat("#e9dcc0"), mat("#e9dcc0"), mat("#ffffff", { map: pageTex(k, s), key: `pg${k}${s}` }), mat("#e9dcc0"), mat("#e9dcc0"), mat("#e9dcc0")], [(s ? 1 : -1) * 0.119, 0.041, 0]); pg.rotation.z = (s ? -1 : 1) * 0.07; g.add(pg); }
      } else { const sh = mesh(new THREE.BoxGeometry(k === "newspaper" ? 0.46 : 0.3, 0.003, k === "newspaper" ? 0.6 : 0.4), [mat("#e9e3d2"), mat("#e9e3d2"), mat("#ffffff", { map: pageTex(k, 0), key: `pg${k}0` }), mat("#e9e3d2"), mat("#e9e3d2"), mat("#e9e3d2")], [0, 0.002, 0]); sh.rotation.y = 0.12; g.add(sh); }
    }
    const candle = new THREE.Group(); candle.position.set(-0.42, 0, -0.22); root.add(candle); candle.add(cyl(0.05, 0.06, 0.02, mat("#8a6a3a")), cyl(0.018, 0.018, 0.14, mat("#f3ead2"), [0, 0.02, 0]), mesh(new THREE.SphereGeometry(0.014, 12, 10), glow("#ffd27a", 3), [0, 0.18, 0], false));
    const quill = mesh(new THREE.ConeGeometry(0.012, 0.3, 8), mat("#f4f1ea"), [0.38, 0.03, 0.1]); quill.rotation.set(1.25, 0, -0.9); root.add(quill);
    const ink = cyl(0.03, 0.035, 0.05, gloss("#2a2a3a", 90), [0.44, 0, -0.14]); root.add(ink);
    const glasses = mesh(new THREE.TorusGeometry(0.028, 0.004, 8, 20).rotateX(Math.PI / 2), gloss("#c9a23a", 90), [0.36, 0.006, 0.2]); const g2 = glasses.clone(); g2.position.x += 0.07; root.add(glasses, g2);
    const mark = mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#ffd84a", transparent: true, opacity: 0.45, depthWrite: false }), [0, 0, 0], false); root.add(mark);
    const MARK: Record<string, [number, number, number, number]> = { chronicle: [0.119, 0.01, 0.15, 0.12], dictionary: [-0.16, -0.047, 0.1, 0.022], cookbook: [-0.119, -0.05, 0.16, 0.11], newspaper: [0, -0.1, 0.36, 0.08], letter: [0, -0.04, 0.22, 0.05] };
    const cam = (centre: V3, dir: V3, w: number, h: number, fov = 30, cInf = 12) => (c: Ctx): CamState => drift(frame(centre, w, h, dir, c.aspect, fov, 1.14, cInf), c.u, 0.07, 0.03);
    const cams: Record<string, (c: Ctx) => CamState> = {
      main: cam([0, 0.04, 0], [0.22, 0.75, 1], 0.72, 0.42),
      macro: (c) => { const m = MARK[(c.params.kind as string) ?? "dictionary"]; return cam([m[0], 0.05, m[1]], [0.15, 0.8, 1], Math.max(0.24, m[2] * 1.9), 0.16, 26, 16)(c); },
      top: cam([0, 0.03, 0], [0, 1, 0.08], 0.62, 0.44, 30, 2),
      low: cam([0, 0.05, 0], [0.35, 0.22, 1], 0.62, 0.3, 28, 14),
      dutch: (c) => ({ ...cam([0, 0.04, 0], [0.3, 0.7, 1], 0.6, 0.4, 30, 10)(c), roll: 0.13 }),
    };
    return {
      root, light: "interior", cams, shots: noChars({ main: "detail", macro: "detail", low: "detail", dutch: "detail", top: "top" }),
      update(c: Ctx) {
        const kind = (c.params.kind as string) ?? "dictionary";
        for (const [k, g] of Object.entries(docs)) g.visible = k === kind;
        candle.visible = kind === "chronicle" || kind === "letter"; quill.visible = ink.visible = kind !== "newspaper"; glasses.visible = g2.visible = kind === "dictionary" || kind === "newspaper";
        const m = MARK[kind], t0 = actionT(c, "mark", c.dur * 0.35), k = smooth((c.t - t0) / 0.5), book = kind === "chronicle" || kind === "dictionary" || kind === "cookbook";
        mark.visible = k > 0.001 && c.params.mark !== false; mark.scale.set(Math.max(0.001, m[2] * k), 1, m[3]); mark.position.set(m[0] - (m[2] * (1 - k)) / 2, book ? 0.056 : 0.0045, m[1]);
      },
    };
  },
};

const boxTex = () => ctex("frozenBox", 512, 384, (g) => { g.fillStyle = "#2f6fb5"; g.fillRect(0, 0, 512, 384); g.fillStyle = "#f4f7fb"; g.fillRect(0, 250, 512, 134); crescent(g, 256, 210, 1.25, "#e19c3f"); g.fillStyle = "#cfe3f4"; for (let i = 0; i < 14; i++) { g.beginPath(); g.arc(30 + (i * 37) % 480, 290 + (i * 53) % 80, 5, 0, 7); g.fill(); } });
export const factoryScene: SceneDef = {
  id: "factory",
  build(env) {
    const root = new THREE.Group(), line = new THREE.Group(), freezer = new THREE.Group(); root.add(line, freezer);
    const fl = checkTex("factory", "#c3c9cf", "#b3bac1", 8); fl.repeat.set(4, 3);
    root.add(mesh(new THREE.PlaneGeometry(30, 20).rotateX(-Math.PI / 2), mat("#ffffff", { map: fl, key: "factfloor" }), [0, 0, 0], false), box(30, 5, 0.2, mat("#dfe4e8"), [0, 0, -4.5]));
    // ---- production line
    for (let i = -3; i <= 3; i++) { const b = env.model("kenney-factory-kit/conveyor", { h: 0.85, fallback: [1.5, 0.85, 0.9] }); b.position.set(i * 1.5, 0, 0); line.add(b); }
    const machine = env.model("kenney-factory-kit/machine", { h: 2.1, fallback: [1.8, 2.1, 1.3] }); machine.position.set(-4.3, 0, -0.1); line.add(machine);
    const crate = env.model("kenney-factory-kit/crate", { h: 0.8, fallback: [0.9, 0.8, 0.9] }); crate.position.set(4.6, 0, 1.4); line.add(crate);
    const raw = pastryGeo({ kind: "croissant", bake: 0, len: 0.3, r: 0.055 }), rawMat = twoTone(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 6, specular: "#201810" }));
    const N = 16, belt = Array.from({ length: N }, () => { const m = mesh(raw, rawMat); line.add(m); return m; });
    for (const x of [-2, 2.5]) line.add(box(0.08, 3, 0.08, mat("#9aa4ad"), [x, 0, -1.2]), mesh(new THREE.BoxGeometry(1.2, 0.08, 0.3), glow("#f4f8ff", 1.6), [x, 3, -1.2], false));
    const workers = [new Person(line, "worker", 1), new Person(line, "worker", 2)];
    // ---- supermarket freezer aisle
    for (const x of [-1.6, 1.6]) { const fz = env.model("kenney-mini-shop/freezer", { h: 2.0, fallback: [3, 2.0, 0.9] }); fz.position.set(x, 0, -1.2); freezer.add(fz); }
    const bm = [mat("#2f6fb5"), mat("#2f6fb5"), mat("#f4f7fb"), mat("#f4f7fb"), mat("#ffffff", { map: boxTex(), key: "fbox" }), mat("#2f6fb5")];
    for (let i = 0; i < 10; i++) freezer.add(mesh(new THREE.BoxGeometry(0.34, 0.26, 0.12), bm, [-1.45 + (i % 5) * 0.72, 0.75 + Math.floor(i / 5) * 0.55, -0.62]));
    const hero = mesh(new THREE.BoxGeometry(0.34, 0.26, 0.12), bm, [0.25, 1.18, 0.55]); hero.rotation.set(-0.2, -0.35, 0.05); freezer.add(hero);
    const baked = pastry({ len: 0.2, r: 0.036 }, [0.75, 1.02, 0.6], 0.4); freezer.add(baked, box(0.6, 1.0, 0.45, mat("#d3dae0"), [0.6, 0, 0.6]));
    const shopper = new Person(freezer, "modern", 2), shopper2 = new Person(freezer, "modern", 5);
    const people = [...workers, shopper, shopper2]; let charsOn = true;
    const cam = (centre: V3, dir: V3, w: number, h: number, fov = 34, cInf = 8) => (c: Ctx): CamState => drift(frame(centre, w, h, dir, c.aspect, fov, 1.06, cInf), c.u, 0.06, 0.04);
    const cams: Record<string, (c: Ctx) => CamState> = {
      main: (c) => (c.params.view === "freezer" ? cam([0, 1.15, -0.3], [0.2, 0.08, 1], 5.4, 2.6)(c) : cam([0, 1.1, 0], [0.3, 0.16, 1], 8, 3)(c)),
      macro: (c) => (c.params.view === "freezer" ? cam([0.45, 1.15, 0.58], [0.15, 0.15, 1], 1.1, 0.6, 28, 14)(c) : cam([0.3, 0.95, 0], [0.5, 0.35, 1], 1.8, 0.7, 28, 14)(c)),
      wide: (c) => (c.params.view === "freezer" ? cam([0, 1.3, -0.3], [-0.3, 0.12, 1], 7, 3)(c) : cam([0, 1.5, 0], [-0.4, 0.17, 1], 11, 4, 36, 4)(c)),
    };
    return {
      root, light: "cool", cams, shots: { main: { kind: "wide", chars: true }, wide: { kind: "wide", chars: true }, macro: { kind: "food", chars: false } }, actors: () => cast(people.filter((x) => x.card.mesh.parent?.visible), charsOn),
      update(c: Ctx, cm: CamState) {
        const view = c.params.view === "freezer" ? "freezer" : "line"; line.visible = view === "line"; freezer.visible = view === "freezer";
        const span = 10.5, sp = 0.55;
        belt.forEach((m, i) => { const x = ((i * (span / N) + (c.f / c.fps) * sp) % span) - span / 2; m.position.set(x, 0.86, (i % 2 ? 0.14 : -0.14)); m.rotation.y = 0.5 + hash(i) * 0.3; });
        if (view === "line") { workers[0].pose(c.f, [-1.2, 0, -0.85], cm.pos, { expr: "neutral" }); workers[1].pose(c.f, [2.1, 0, -0.85], cm.pos, { expr: "smile" }); }
        else { shopper.pose(c.f, [-0.75, 0, 0.45], cm.pos, { expr: "grin", wave: 0.4 + 0.3 * Math.sin(c.t * 2) }); shopper2.pose(c.f, [-2.4, 0, 0.9], cm.pos, { expr: "neutral" }); }
        charsOn = c.chars; if (!c.chars) people.forEach((x) => x.hide());
      },
    };
  },
};
