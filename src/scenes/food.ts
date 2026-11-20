// Procedural food + tableware used by several scenes. The dish must read by silhouette and surface, so the pastry
// is real geometry (rolled segments, taper, crescent curve, baked colour gradient), not a renamed primitive.
import * as THREE from "three";
import { twoTone } from "../videos/bridge/shade";
import { ctex } from "../videos/bridge/paint";
import { NOINK } from "../videos/bridge/ink";
import { mat, gloss, mesh, cyl, hash } from "../core/stage";
import type { V3 } from "../core/types";

const C = (hex: string) => new THREE.Color(hex);
const pastryMats = new Map<string, THREE.Material>();
const pastryMat = (shine: number) => {
  const k = String(shine);
  if (!pastryMats.has(k)) pastryMats.set(k, twoTone(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: shine, specular: shine > 20 ? "#6a4a22" : "#201810" })));
  return pastryMats.get(k)!;
};

export type PastryKind = "croissant" | "kipferl" | "dough";
const PAL: Record<PastryKind, { top: string; mid: string; low: string; edge: string; shine: number }> = {
  croissant: { top: "#a9591a", mid: "#dc9a42", low: "#f4d28e", edge: "#8f4712", shine: 46 },
  kipferl: { top: "#c98c40", mid: "#e7bd76", low: "#f3dcaa", edge: "#b5762c", shine: 14 },   // a bread roll: paler, matte, smooth
  dough: { top: "#f1dfb8", mid: "#f4e5c4", low: "#f6ead0", edge: "#e6d2a6", shine: 6 },
};
export type PastryOpts = { kind?: PastryKind; len?: number; r?: number; curve?: number; segs?: number; from?: number; to?: number; bake?: number };
/** Rolled crescent. `curve` = half-angle of the arc in degrees (0 = straight), `segs` = visible wraps (odd),
 *  `from`/`to` in [-1, 1] cut the pastry (a cut end gets a crumb face from pastryCut), `bake` 0..1 blends dough -> baked colour. */
export const pastryGeo = (o: PastryOpts = {}) => {
  const kind = o.kind ?? "croissant", len = o.len ?? 0.17, r0 = o.r ?? (kind === "kipferl" ? 0.021 : 0.031), curve = THREE.MathUtils.degToRad(o.curve ?? (kind === "kipferl" ? 82 : 64));
  const N = o.segs ?? (kind === "kipferl" ? 5 : 7), M = (N - 1) / 2, from = o.from ?? -1, to = o.to ?? 1, bake = o.bake ?? 1, flat = kind === "kipferl" ? 0.9 : 0.8;
  const P = PAL[kind], D = PAL.dough, mixc = (a: string, b: string) => C(a).lerp(C(b), bake);
  const cTop = mixc(D.top, P.top), cMid = mixc(D.mid, P.mid), cLow = mixc(D.low, P.low), cEdge = mixc(D.edge, P.edge);
  const Rc = curve > 0.01 ? len / 2 / curve : 1e6, AR = 22, stepK = kind === "kipferl" ? 0.07 : 0.15;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const rad = (s: number, k: number) => {
    const a = Math.abs(k) / Math.max(1, M), seg = r0 * (1 - stepK * Math.abs(k)) * (1 - 0.5 * a ** 2.2);
    const q = (s * M + 0.5 - k) - 0.5, bulge = 0.92 + 0.08 * Math.cos(q * Math.PI * 1.6) - 0.05 * Math.sign(k) * q; // each wrap is fatter toward the centre
    return Math.max(0.0012, seg * bulge * Math.min(1, (1 - Math.abs(s)) / 0.07) ** 0.55);
  };
  let rings = 0;
  const ring = (s: number, k: number) => {
    const phi = s * curve, cx = Rc * Math.sin(phi), cz = Rc * (1 - Math.cos(phi)), nx = -Math.sin(phi), nz = Math.cos(phi), r = rad(s, k);
    const q = Math.abs((s * M + 0.5 - k) - 0.5) * 2; // 0 mid-wrap .. 1 at its edges
    for (let j = 0; j < AR; j++) {
      const a = (j / AR) * Math.PI * 2, sn = Math.sin(a), y = Math.max(sn, -0.5) * r * flat + 0.5 * r * flat, n = Math.cos(a) * r;
      pos.push(cx + nx * n, y, cz + nz * n);
      const up = Math.max(0, sn), c = cLow.clone().lerp(cMid, Math.min(1, 0.35 + up * 1.4)).lerp(cTop, up ** 1.5 * 0.9).lerp(cEdge, 0.55 * q ** 3 * (0.3 + up) + 0.25 * Math.abs(s) ** 3);
      col.push(c.r, c.g, c.b);
    }
    rings++;
  };
  for (let k = -M; k <= M; k++) {
    const sa = Math.max(from, (k - 0.5) / M), sb = Math.min(to, (k + 0.5) / M);
    if (sb <= sa) continue;
    const start = rings, n = 12;
    for (let j = 0; j <= n; j++) ring(Math.max(-0.999, Math.min(0.999, sa + ((sb - sa) * j) / n)), k);
    if (start > 0) for (let j = 0; j < AR; j++) { const a = (start - 1) * AR + j, b = (start - 1) * AR + ((j + 1) % AR), c = start * AR + j, d = start * AR + ((j + 1) % AR); idx.push(a, c, b, b, c, d); } // step face between wraps
    for (let i = start; i < rings - 1; i++) for (let j = 0; j < AR; j++) { const a = i * AR + j, b = i * AR + ((j + 1) % AR), c = (i + 1) * AR + j, d = (i + 1) * AR + ((j + 1) % AR); idx.push(a, c, b, b, c, d); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  g.userData = { r0, flat, curve, Rc, shine: P.shine * bake };
  return g;
};
export const pastry = (o: PastryOpts = {}, p: V3 = [0, 0, 0], rotY = 0) => {
  const g = pastryGeo(o), m = mesh(g, pastryMat(Math.round(g.userData.shine)), p); m.rotation.y = rotY; return m;
};
/** crumb face for a pastry cut at s = 0: croissant = open honeycomb of thin sheets, kipferl = fine even bread crumb */
const crumbTex = (kind: PastryKind) => ctex("crumb" + kind, 512, 512, (g, r) => {
  g.fillStyle = kind === "kipferl" ? "#f3e2b4" : "#f8e7b6"; g.fillRect(0, 0, 512, 512);
  if (kind === "kipferl") { for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(190,150,80,${0.15 + r() * 0.2})`; g.beginPath(); g.arc(r() * 512, r() * 512, 1.5 + r() * 3, 0, 7); g.fill(); } }
  else for (let i = 0; i < 70; i++) { // large irregular cells following the spiral of the roll
    const a = r() * 6.28, d = 30 + r() * 190, x = 256 + Math.cos(a) * d, y = 256 + Math.sin(a) * d * 0.85, w = 14 + r() * 34, h = 7 + r() * 16;
    g.save(); g.translate(x, y); g.rotate(a + 1.57 + (r() - 0.5) * 0.6);
    g.fillStyle = "#d9b06a"; g.beginPath(); g.ellipse(0, 0, w, h, 0, 0, 7); g.fill();
    g.fillStyle = "#c08f45"; g.beginPath(); g.ellipse(2, 2, w * 0.7, h * 0.6, 0, 0, 7); g.fill(); g.restore();
  }
  g.strokeStyle = kind === "kipferl" ? "#c98c40" : "#b4611b"; g.lineWidth = 34; g.beginPath(); g.ellipse(256, 256, 240, 240, 0, 0, 7); g.stroke();
});
export const pastryCut = (kind: PastryKind, r: number, flat: number, p: V3, faceX: 1 | -1) => {
  const m = mesh(new THREE.CircleGeometry(1, 32), mat("#ffffff", { map: crumbTex(kind), key: "crumb" + kind, side: THREE.DoubleSide }), p, false);
  m.scale.set(r, r * flat, 1); m.rotation.y = (faceX * Math.PI) / 2; m.position.y = p[1] + r * flat * 0.52; return m;
};
/** a croissant cut in two halves that can slide apart (`gap` metres) to show the layers */
export const cutPastry = (kind: PastryKind = "croissant") => {
  const grp = new THREE.Group(), a = new THREE.Group(), b = new THREE.Group();
  const ga = pastryGeo({ kind, to: 0 }), gb = pastryGeo({ kind, from: 0 }), r = ga.userData.r0 * 0.985, fl = ga.userData.flat;
  a.add(mesh(ga, pastryMat(Math.round(ga.userData.shine))), pastryCut(kind, r, fl, [0, 0, 0], 1));
  b.add(mesh(gb, pastryMat(Math.round(gb.userData.shine))), pastryCut(kind, r, fl, [0, 0, 0], -1));
  grp.add(a, b);
  // `open` 0..1: the halves slide apart and turn their cut faces toward the viewer (+z) so the crumb is readable
  return { grp, set: (open: number) => { const gap = 0.01 + 0.03 * open; a.position.set(-gap / 2, 0, 0.012 * open); b.position.set(gap / 2, 0, 0.012 * open); a.rotation.y = -0.85 * open; b.rotation.y = 0.85 * open; } };
};

export const plate = (r = 0.13, color = "#f7f3ea") => {
  const pts = [[0, 0], [r * 0.6, 0], [r * 0.66, 0.004], [r * 0.95, 0.016], [r, 0.02], [r * 0.985, 0.024], [r * 0.64, 0.01], [0, 0.008]].map(([x, y]) => new THREE.Vector2(x, y));
  return mesh(new THREE.LatheGeometry(pts, 48), gloss(color, 70, "#9a9a9a"));
};
export const cup = (p: V3 = [0, 0, 0], coffee = "#3a2216") => {
  const g = new THREE.Group(); g.position.set(...p);
  const body = [[0.022, 0], [0.03, 0.004], [0.04, 0.06], [0.041, 0.064], [0.037, 0.062], [0.027, 0.008], [0, 0.008]].map(([x, y]) => new THREE.Vector2(x, y));
  g.add(mesh(new THREE.LatheGeometry(body, 36), gloss("#f7f3ea", 70, "#9a9a9a")), mesh(new THREE.CircleGeometry(0.0365, 32).rotateX(-Math.PI / 2), gloss(coffee, 90, "#aa8866"), [0, 0.054, 0], false));
  const handle = mesh(new THREE.TorusGeometry(0.016, 0.0045, 10, 20, Math.PI), gloss("#f7f3ea", 70, "#9a9a9a"), [0.04, 0.033, 0]); handle.rotation.z = -Math.PI / 2; g.add(handle);
  const saucer = plate(0.07); g.add(saucer); g.children[0].position.y = 0.012; g.children[1].position.y += 0.012; handle.position.y += 0.012;
  return g;
};
/** bread shapes for shelves and baskets (period-neutral round loaf, long loaf, small roll) */
export const loaf = (kind: "round" | "long" | "roll", p: V3 = [0, 0, 0], rotY = 0) => {
  const [sx, sy, sz] = kind === "round" ? [0.11, 0.065, 0.11] : kind === "long" ? [0.21, 0.045, 0.06] : [0.05, 0.035, 0.045];
  const g = new THREE.SphereGeometry(1, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), col: number[] = [], P = g.attributes.position;
  for (let i = 0; i < P.count; i++) { const y = P.getY(i), c = C("#e9c27a").lerp(C("#a8601f"), Math.max(0, y) ** 1.3); col.push(c.r, c.g, c.b); }
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const m = mesh(g, pastryMat(10), p); m.scale.set(sx, sy, sz); m.position.y += sy * 0.38; m.rotation.y = rotY; return m;
};
/** generic breakfast sandwich on a split croissant (no brand): egg, cheese, sausage */
export const croissantSandwich = (p: V3 = [0, 0, 0]) => {
  const g = new THREE.Group(); g.position.set(...p);
  const bottom = pastry({ curve: 30, len: 0.15 }); bottom.scale.y = 0.42;
  const sausage = cyl(0.045, 0.045, 0.012, mat("#7a4a2c"), [0, 0.022, 0.012]), egg = cyl(0.05, 0.05, 0.01, mat("#f6d55c"), [0, 0.034, 0.012]);
  const cheese = mesh(new THREE.BoxGeometry(0.09, 0.004, 0.09), gloss("#f4a62a", 30), [0, 0.046, 0.012]); cheese.rotation.y = 0.5;
  const top = pastry({ curve: 30, len: 0.15 }); top.scale.y = 0.72; top.position.y = 0.048;
  g.add(bottom, sausage, egg, cheese, top); return g;
};
export const tray = (w = 0.5, d = 0.34, color = "#4a4a52") => { const g = new THREE.Group(); g.add(mesh(new THREE.BoxGeometry(w, 0.008, d), gloss(color, 40, "#888"), [0, 0.004, 0])); return g; };

/** flakes scattered around a point; `fall` 0..1 animates them dropping and settling */
export const flakes = (n: number, spread: number, seed: number) => {
  const geo = new THREE.TetrahedronGeometry(0.0028), m = mat("#e3a548"), inst = new THREE.InstancedMesh(geo, m, n), d = new THREE.Object3D();
  inst.castShadow = true; inst.receiveShadow = true;
  const set = (fall: number, y0 = 0.0015) => {
    for (let i = 0; i < n; i++) {
      const a = hash(seed + i) * 6.283, rr = Math.sqrt(hash(seed + i * 7.3)) * spread, t = Math.min(1, Math.max(0, fall * 1.6 - hash(seed + i * 3.1) * 0.6)), sc = 0.6 + hash(seed + i * 5) * 1.4;
      d.position.set(Math.cos(a) * rr * (0.35 + 0.65 * t), y0 + (1 - t) ** 2 * 0.09 * (0.4 + hash(i + seed)), Math.sin(a) * rr * (0.35 + 0.65 * t));
      d.rotation.set(hash(i) * 6 + t * 5, hash(i + 9) * 6, hash(i + 17) * 6 + t * 4); d.scale.setScalar(t > 0 ? sc : 0); d.updateMatrix(); inst.setMatrixAt(i, d.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
  };
  set(1);
  return { inst, set };
};

/** soft rising steam: sprites on the no-ink layer, driven by the absolute frame only */
export const steam = (n = 7, height = 0.16, width = 0.035) => {
  const tex = ctex("steam", 128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, "rgba(255,255,255,0.55)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
  const grp = new THREE.Group(), sp: THREE.Sprite[] = [];
  for (let i = 0; i < n; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, color: "#fff6e8" })); s.layers.set(NOINK); sp.push(s); grp.add(s); }
  const set = (f: number, amount = 1) => sp.forEach((s, i) => {
    const t = ((f / 75 + i / n + hash(i) * 0.3) % 1 + 1) % 1;
    s.position.set(Math.sin(t * 5 + i * 2.1) * width * (0.3 + t), t * height, Math.cos(t * 4 + i) * width * 0.4);
    s.scale.setScalar(width * (0.9 + t * 2.4)); (s.material as THREE.SpriteMaterial).opacity = amount * Math.sin(t * Math.PI) ** 1.2 * 0.5;
  });
  return { grp, set };
};
