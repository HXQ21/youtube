// "lamination": what makes a croissant a croissant, shown as work on a floured table.
// params.step = butter | fold | roll | layers | cut | shape | bake
//   butter: a butter slab is locked into the dough        fold: the letter fold (thirds)
//   roll: rolling pin lengthens and thins the slab          layers: cross-section, butter layers multiply 1 -> 3 -> 9 -> 27 with each fold
//   cut: the sheet is cut into long triangles               shape: a triangle is rolled from base to tip, then bent into a crescent
//   bake: tray in the oven, dough turns golden and puffs
// cams: main, top, macro, side
import * as THREE from "three";
import { ctex } from "../videos/bridge/paint";
import { noChars, mat, gloss, fireMat, flicker, mesh, box, cyl, woodTex, brickTex, frame, drift, smooth, lerp, hash } from "../core/stage";
import { pastryGeo, steam } from "./food";
import { twoTone } from "../videos/bridge/shade";
import type { CamState, Ctx, SceneDef, V3 } from "../core/types";

const DOUGH = "#f1dfb6", BUTTER = "#f7d84a";
const layerTex = (n: number) => ctex("layers" + n, 1024, 256, (g) => {
  g.fillStyle = DOUGH; g.fillRect(0, 0, 1024, 256);
  const h = 256 / (2 * n + 1);
  for (let i = 0; i < n; i++) { g.fillStyle = BUTTER; g.fillRect(0, h * (2 * i + 1), 1024, h); if (n <= 9) { g.strokeStyle = "rgba(60,40,20,0.55)"; g.lineWidth = n <= 3 ? 5 : 3; g.strokeRect(-9, h * (2 * i + 1), 1042, h); } }
});
const pivot = (parent: THREE.Object3D, x: number, y: number) => { const g = new THREE.Group(); g.position.set(x, y, 0); parent.add(g); return g; };

export const laminationScene: SceneDef = {
  id: "lamination",
  build() {
    const root = new THREE.Group(), dough = mat(DOUGH), butter = gloss(BUTTER, 40, "#aa9a55");
    root.add(mesh(new THREE.BoxGeometry(2.6, 0.05, 1.5), mat("#ffffff", { map: woodTex("bench", "#7d6048", "#5a4030") }), [0, -0.025, 0]));
    // bench body below the top, set back 4 cm: low cameras (side, layer, bake) used to see empty background under the table edge
    root.add(box(2.56, 0.9, 1.4, mat("#6b4f3a"), [0, -0.95, -0.04]));
    // flour dusting: a few pale discs
    const flour = new THREE.Group(); root.add(flour);
    for (let i = 0; i < 46; i++) { const d = mesh(new THREE.CircleGeometry(0.003 + hash(i) * 0.009, 12).rotateX(-Math.PI / 2), mat("#b9a88e"), [(hash(i * 3) - 0.5) * 1.1, 0.0006 + i * 0.00002, (hash(i * 7) - 0.5) * 0.6], false); flour.add(d); }
    root.add(box(3, 1.6, 0.1, mat("#d3b08a"), [0, -0.4, -1.1]));
    const jar = cyl(0.05, 0.05, 0.12, gloss("#e9e2d2", 60), [-0.55, 0, -0.5]); root.add(jar, cyl(0.07, 0.085, 0.2, mat("#c9b28a"), [0.62, 0, -0.55]));
    const steps: Record<string, THREE.Group> = {};
    const G = (k: string) => { const g = new THREE.Group(); steps[k] = g; root.add(g); return g; };
    const T = 0.012;

    // ---- butter: slab + two flaps that close over the butter
    const sButter = G("butter");
    sButter.add(box(0.2, T, 0.24, dough));
    const flapL = pivot(sButter, -0.1, T), flapR = pivot(sButter, 0.1, T);
    flapL.add(mesh(new THREE.BoxGeometry(0.1, T, 0.24), dough, [-0.05, -T / 2, 0])); flapR.add(mesh(new THREE.BoxGeometry(0.1, T, 0.24), dough, [0.05, -T / 2, 0]));
    const slab = box(0.18, 0.012, 0.2, butter); sButter.add(slab);

    // ---- fold: three panels, the outer two fold over the middle (letter fold)
    const sFold = G("fold");
    sFold.add(box(0.14, T, 0.24, dough));
    const fL = pivot(sFold, -0.07, T), fR = pivot(sFold, 0.07, T);
    fL.add(mesh(new THREE.BoxGeometry(0.14, T, 0.24), dough, [-0.07, -T / 2, 0])); fR.add(mesh(new THREE.BoxGeometry(0.14, T, 0.24), dough, [0.07, -T / 2, 0]));

    // ---- roll: slab + rolling pin
    const sRoll = G("roll");
    const sheet = box(0.5, 0.01, 0.24, dough); sRoll.add(sheet);
    const pin = new THREE.Group(); const wood = mat("#ffffff", { map: woodTex("pin", "#c99a66", "#8a5a30") });
    const barrel = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 24).rotateX(Math.PI / 2), wood); pin.add(barrel);
    for (const z of [-0.2, 0.2]) pin.add(mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.1, 14).rotateX(Math.PI / 2), mat("#8a5a30"), [0, 0, z]));
    sRoll.add(pin);

    // ---- layers: a block seen from the side; the stripe count triples with every fold
    const sLayers = G("layers");
    const NL = [1, 3, 9, 27], blocks = NL.map((n) => { const b = mesh(new THREE.BoxGeometry(0.36, 0.09, 0.2), [dough, dough, dough, dough, mat("#ffffff", { map: layerTex(n), key: "lay" + n }), dough], [0, 0.045, 0]); sLayers.add(b); return b; });

    // ---- cut: five long triangles separating, a knife travelling along the cuts
    const sCut = G("cut");
    const tri = (() => { const s = new THREE.Shape(); s.moveTo(-0.05, 0); s.lineTo(0.05, 0); s.lineTo(0, 0.22); s.closePath(); return new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, 0, 0.11); })();
    const tris = [0, 1, 2, 3, 4].map((i) => { const m = mesh(tri, dough); if (i % 2) m.rotation.y = Math.PI; sCut.add(m); return m; });
    const knife = new THREE.Group(); knife.add(mesh(new THREE.BoxGeometry(0.004, 0.04, 0.24), gloss("#d3d9df", 120, "#ffffff"), [0, 0.03, 0]), mesh(new THREE.BoxGeometry(0.018, 0.03, 0.11), mat("#4a3426"), [0, 0.035, 0.17])); sCut.add(knife);

    // ---- shape: triangle -> roll -> crescent
    const sShape = G("shape");
    const flatTri = mesh(tri, dough); sShape.add(flatTri);
    const rollGeo = pastryGeo({ kind: "dough", curve: 2, bake: 0 }), rawMat = twoTone(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 6, specular: "#201810" }));
    const straight = mesh(rollGeo, rawMat), bent = mesh(pastryGeo({ kind: "croissant", bake: 0 }), rawMat); sShape.add(straight, bent);

    // ---- bake: oven mouth, tray, six pastries going from raw to golden
    const sBake = G("bake");
    const brick = mat("#ffffff", { map: brickTex("oven", ["#b0614a", "#9c5440", "#bb6d52", "#a65a45"], "#d8c7b0") });
    sBake.add(box(1.5, 0.75, 0.12, brick, [0, 0, -0.42]), box(0.34, 0.75, 0.7, brick, [-0.58, 0, -0.1]), box(0.34, 0.75, 0.7, brick, [0.58, 0, -0.1]), box(1.5, 0.3, 0.7, brick, [0, 0.45, -0.1]));
    const fire = mesh(new THREE.PlaneGeometry(0.82, 0.45), fireMat(), [0, 0.225, -0.35], false); sBake.add(fire);
    sBake.add(box(0.7, 0.01, 0.44, gloss("#3d3d45", 50, "#999"), [0, 0, 0.02]));
    const bakeGeos = [0, 0.25, 0.5, 0.75, 1].map((b) => pastryGeo({ bake: b, len: 0.19, r: 0.034 }));
    const bakeMats = [0, 0.25, 0.5, 0.75, 1].map((b) => twoTone(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 4 + 42 * b, specular: b > 0.4 ? "#6a4a22" : "#201810" })));
    const buns = [0, 1, 2, 3, 4, 5].map((i) => { const m = mesh(bakeGeos[0], bakeMats[0], [-0.22 + (i % 3) * 0.22, 0.012, -0.07 + Math.floor(i / 3) * 0.19]); m.rotation.y = 0.15 * (i % 2 ? 1 : -1); sBake.add(m); return m; });
    const st = steam(8, 0.2, 0.09); st.grp.position.set(0, 0.06, 0.02); sBake.add(st.grp);

    const cam = (centre: V3, dir: V3, w: number, h: number, fov = 30, cInf = 12) => (c: Ctx): CamState => drift(frame(centre, w, h, dir, c.aspect, fov, 1.14, cInf), c.u, 0.07, 0.035);
    const cams: Record<string, (c: Ctx) => CamState> = {
      main: (c) => (c.params.step === "bake" ? cam([0, 0.16, 0], [0.12, 0.5, 1], 0.82, 0.5, 30, 6)(c) : c.params.step === "layers" ? cam([0, 0.05, 0], [0.12, 0.2, 1], 0.46, 0.16, 26, 8)(c) : cam([0, 0.03, 0], [0.3, 0.72, 1], 0.5, 0.3)(c)),
      top: cam([0, 0.02, 0], [0, 1, 0.1], 0.62, 0.34, 30, 2),
      macro: (c) => (c.params.step === "bake" ? cam([0, 0.04, 0.02], [0.2, 0.4, 1], 0.5, 0.2, 26, 16)(c) : cam([0, 0.03, 0], [0.2, 0.45, 1], 0.32, 0.14, 26, 16)(c)),
      side: cam([0, 0.045, 0], [0, 0.08, 1], 0.46, 0.14, 24, 6),
      // close, low cross-section: the striped front face fills the frame, the top face stays a thin sliver (27 layers stay readable)
      layer: cam([0, 0.045, 0], [0.06, 0.14, 1], 0.3, 0.1, 24, 10),
      low: (c) => (c.params.step === "bake" ? cam([0, 0.1, 0.02], [0.3, 0.12, 1], 0.7, 0.3, 28, 12)(c) : cam([0, 0.035, 0], [0.35, 0.2, 1], 0.42, 0.16, 28, 14)(c)),
      ots: cam([0, 0.03, 0], [-0.7, 0.5, 0.8], 0.46, 0.26, 30, 12),
      dutch: (c) => ({ ...cam([0, 0.03, 0], [0.4, 0.6, 1], 0.44, 0.26, 30, 10)(c), roll: -0.14 }),
    };
    return {
      root, light: "table", cams, shots: noChars({ main: "detail", macro: "detail", side: "detail", layer: "detail", low: "detail", ots: "detail", dutch: "detail", top: "top" }),
      update(c: Ctx) {
        const step = (c.params.step as string) ?? "fold", u = c.p;
        for (const [k, g] of Object.entries(steps)) g.visible = k === step;
        flour.visible = step !== "bake" && step !== "layers";
        if (step === "butter") { slab.position.y = T + 0.006 + (1 - smooth(u / 0.35)) * 0.16; const k = smooth((u - 0.42) / 0.5); flapL.rotation.z = -Math.PI * 0.985 * k; flapR.rotation.z = Math.PI * 0.985 * smooth((u - 0.5) / 0.45); flapR.position.y = T + 0.013 * smooth((u - 0.5) / 0.45); }
        if (step === "fold") { const a = smooth((u - 0.08) / 0.38), b = smooth((u - 0.52) / 0.38); fL.rotation.z = -Math.PI * 0.99 * a; fR.rotation.z = Math.PI * 0.99 * b; fR.position.y = T + T * 1.05 * b; }
        if (step === "roll") { const k = smooth(u), sw = Math.sin(c.t * 2.6); sheet.scale.set(lerp(0.55, 1.05, k), lerp(2.2, 1, k), 1); sheet.position.y = 0.005 * lerp(2.2, 1, k); pin.position.set(sw * 0.2 * lerp(0.6, 1, k), 0.03 + 0.01 * lerp(2.2, 1, k), 0); barrel.rotation.z = -pin.position.x / 0.03; }
        if (step === "layers") { const i = Math.min(3, Math.floor(u * 4)), p = (u * 4) % 1; blocks.forEach((b, j) => { b.visible = j === i; const sq = j === i ? 1 - 0.18 * Math.max(0, 1 - p / 0.18) : 1; b.scale.set(1 + (1 - sq) * 0.6, sq, 1); b.position.y = 0.045 * sq; }); }
        if (step === "cut") { const n = tris.length; tris.forEach((m, i) => { const done = smooth((u * (n + 1) - i) / 1.0), base = (i - (n - 1) / 2) * 0.052; m.position.set(base + (i - (n - 1) / 2) * 0.03 * done, 0, i % 2 ? 0.0 : 0); }); const ki = Math.min(n - 1, Math.floor(u * (n + 1))), kp = (u * (n + 1)) % 1; knife.position.set((ki - (n - 1) / 2) * 0.052 + 0.026, 0, lerp(-0.2, 0.2, kp)); knife.rotation.y = ki % 2 ? 0.22 : -0.22; knife.visible = u < 0.9; }
        if (step === "shape") {
          const a = smooth(u / 0.55), b = smooth((u - 0.6) / 0.35);
          flatTri.scale.set(1, 1, Math.max(0.001, 1 - a)); flatTri.position.z = 0.11 * a * 1; flatTri.visible = a < 0.995;
          straight.visible = b < 0.5 && a > 0.03; straight.scale.set(lerp(0.75, 1, a), lerp(0.25, 1, a), lerp(0.25, 1, a)); straight.position.set(0, 0, -0.1 + 0.2 * a);
          bent.visible = b >= 0.5; bent.position.set(0, 0, 0.06); bent.scale.setScalar(1);
          straight.rotation.x = -a * 7;
        }
        if (step === "bake") { const k = smooth((u - 0.08) / 0.8), i = Math.min(4, Math.round(k * 4)); buns.forEach((m, j) => { m.geometry = bakeGeos[i]; m.material = bakeMats[i]; m.scale.setScalar(lerp(0.84, 1, smooth((k - 0.1) / 0.6)) * (1 + 0.012 * Math.sin(c.f * 0.2 + j))); });
          flicker(fire.material as THREE.Material, c.f); st.set(c.f, 0.4 + 0.6 * k); }
      },
    };
  },
};
