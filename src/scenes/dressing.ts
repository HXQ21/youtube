// Set dressing shared by the scenes: clean painted textures and storytelling props for the "real-material world,
// flat cartoon people" look (skill/cartoon-3d-short/huong-dan/04-mau-sac-anh-sang.md, core elements 1, 3 and 5).
// Level: a stylised game world, not a photo: simple rounded shapes, clean hand-painted texture, no grime.
// Everything is procedural (canvas textures, primitive geometry): no download, no credits.
import * as THREE from "three";
import { ctex } from "../videos/bridge/paint";
import { NOINK } from "../videos/bridge/ink";
import { mat, gloss, mesh, cyl, box, woodTex, hash } from "../core/stage";
import { loaf } from "./food";
import type { V3 } from "../core/types";

// ---------------------------------------------------------------- textures (white-ish base: tint with the material colour)
/** lime plaster: soft cloudy variation and faint trowel strokes, no stains */
export const plasterTex = (key = "plaster") => {
  const t = ctex(key, 512, 512, (g, r) => {
    g.fillStyle = "#f4efe6"; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 90; i++) {
      const x = r() * 512, y = r() * 512, rad = 30 + r() * 110, warm = r() < 0.5;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, warm ? "rgba(214,190,150,0.045)" : "rgba(255,255,255,0.06)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    g.strokeStyle = "rgba(170,150,120,0.05)"; g.lineWidth = 3;
    for (let i = 0; i < 26; i++) { const x = r() * 512, y = r() * 512, l = 40 + r() * 90; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y + (r() - 0.5) * 14, x + l, y + (r() - 0.5) * 8); g.stroke(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
};
/** large stone floor slabs with grout and gentle colour variation */
export const stoneFloorTex = (key = "stonefloor") => {
  const t = ctex(key, 512, 512, (g, r) => {
    g.fillStyle = "#9a8a72"; g.fillRect(0, 0, 512, 512);
    const n = 4, s = 512 / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = 0.93 + r() * 0.14, w = Math.round(206 * v), h = Math.round(188 * v), b = Math.round(160 * v);
      g.fillStyle = `rgb(${w},${h},${b})`; g.fillRect(x * s + 3, y * s + 3, s - 6, s - 6);
      for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(${r() < 0.5 ? "255,250,240" : "120,105,90"},${0.05 + r() * 0.08})`; g.beginPath(); g.arc(x * s + 6 + r() * (s - 12), y * s + 6 + r() * (s - 12), 2 + r() * 9, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect(x * s + 3, y * s + 3, s - 6, 4);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
};
/** burlap flour sack with a faded stamp (a generic word, never a brand or a documented name) */
export const sackTex = (label = "FARINE", key = "sack") => ctex(`${key}-${label}`, 256, 256, (g, r) => {
  g.fillStyle = "#e3d4b2"; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 256; i += 3) { g.fillStyle = `rgba(150,120,80,${0.08 + r() * 0.06})`; g.fillRect(i, 0, 1, 256); g.fillRect(0, i, 256, 1); }
  for (let i = 0; i < 30; i++) { g.fillStyle = "rgba(255,255,255,0.18)"; g.beginPath(); g.arc(r() * 256, r() * 256, 3 + r() * 10, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = "rgba(160,52,40,0.75)"; g.fillRect(36, 96, 184, 8); g.fillRect(36, 160, 184, 8);
  g.fillStyle = "rgba(52,70,120,0.8)"; g.font = "bold 40px Georgia, serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(label, 128, 133);
});
/** woven wicker */
export const wickerTex = () => {
  const t = ctex("wicker", 256, 256, (g) => {
    g.fillStyle = "#b58449"; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 16) for (let x = 0; x < 256; x += 16) {
      const o = (x / 16 + y / 16) % 2; g.fillStyle = o ? "#c99a5c" : "#9c6d38"; g.fillRect(x + 1, y + 1, 14, 14);
      g.fillStyle = "rgba(255,240,200,0.25)"; o ? g.fillRect(x + 2, y + 3, 12, 3) : g.fillRect(x + 3, y + 2, 3, 12);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 1); return t;
};

// ---------------------------------------------------------------- props
/** a plump tied flour sack (lathe, so the stamp wraps round it) */
export const sack = (p: V3, s = 1, rotY = 0, label = "FARINE") => {
  const prof = [[0, 0], [0.19, 0], [0.26, 0.04], [0.285, 0.18], [0.27, 0.34], [0.2, 0.47], [0.11, 0.53], [0.075, 0.56], [0.1, 0.6], [0.05, 0.64], [0, 0.645]].map(([x, y]) => new THREE.Vector2(x, y));
  const m = mesh(new THREE.LatheGeometry(prof, 28), mat("#ffffff", { map: sackTex(label), key: `sack-${label}` }), p);
  m.scale.set(s, s, s * 0.82); m.rotation.y = rotY; return m;
};
/** a copper pan hanging on a peg (the pan faces the room) */
export const copperPan = (p: V3, r = 0.13) => {
  const g = new THREE.Group(); g.position.set(...p);
  const cu = gloss("#c0683a", 90, "#ffd2a8");
  const body = cyl(r, r * 0.86, r * 0.45, cu, [0, -r, 0], 28); body.rotation.x = Math.PI / 2; body.position.set(0, -r, r * 0.25); g.add(body);
  const bottom = mesh(new THREE.CircleGeometry(r * 0.86, 28), mat("#8a4a2a"), [0, -r, 0.005]); g.add(bottom);
  const handle = mesh(new THREE.BoxGeometry(0.03, r * 1.5, 0.02), mat("#3a2a20"), [0, r * 0.25, 0.03]); g.add(handle);
  g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 8).rotateX(Math.PI / 2), mat("#2a2a2a"), [0, r, 0.03]));
  return g;
};
/** wooden rolling pin lying along x */
export const rollingPin = (p: V3, rotY = 0) => {
  const g = new THREE.Group(); g.position.set(...p); g.rotation.y = rotY;
  const wood = mat("#ffffff", { map: woodTex("pin", "#c99a63", "#8a5a30") });
  g.add(mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.36, 18).rotateZ(Math.PI / 2), wood, [0, 0.032, 0]));
  for (const x of [-0.23, 0.23]) g.add(mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.11, 10).rotateZ(Math.PI / 2), wood, [x, 0.032, 0]));
  return g;
};
/** wicker basket of loaves */
export const breadBasket = (p: V3, r = 0.24, seed = 1) => {
  const g = new THREE.Group(); g.position.set(...p);
  g.add(cyl(r, r * 0.82, r * 0.6, mat("#ffffff", { map: wickerTex(), key: "wicker" }), [0, 0, 0], 24));
  g.add(cyl(r * 1.02, r * 1.02, 0.03, mat("#8a5a2c"), [0, r * 0.58, 0], 24));
  for (let i = 0; i < 4; i++) { const a = i * 1.7 + seed; g.add(loaf(i % 2 ? "long" : "round", [Math.cos(a) * r * 0.4, r * 0.55, Math.sin(a) * r * 0.4], a)); }
  return g;
};
/** a soft additive beam of light from a window to the floor (an effect: never baked, never exported to Blender) */
export const lightShaft = (from: V3, to: V3, width = 1.3, color = "#ffe2b0", opacity = 0.16, face: V3 = [0, 0, 1]) => {
  const tex = ctex("shaft", 64, 256, (g) => {
    const along = g.createLinearGradient(0, 0, 0, 256); along.addColorStop(0, "rgba(255,255,255,1)"); along.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = along; g.fillRect(0, 0, 64, 256);
    g.globalCompositeOperation = "destination-in";
    const across = g.createLinearGradient(0, 0, 64, 0); across.addColorStop(0, "rgba(0,0,0,0)"); across.addColorStop(0.5, "rgba(0,0,0,1)"); across.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = across; g.fillRect(0, 0, 64, 256);
  });
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), len = a.distanceTo(b);
  const geo = new THREE.PlaneGeometry(width, len); geo.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  m.position.copy(a);
  // the plane holds the beam direction and turns its face toward `face` (the audience side, +z by default)
  const dir = b.clone().sub(a).normalize(), up = dir.clone().negate();            // the plane's +y points back to the window
  const side = new THREE.Vector3().crossVectors(up, new THREE.Vector3(...face)).normalize();
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  const normal = new THREE.Vector3().crossVectors(side, up).normalize();
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, normal));
  m.layers.set(NOINK); m.renderOrder = 2; m.userData.fx = true; m.castShadow = false; m.receiveShadow = false;
  return m;
};

// ---------------------------------------------------------------- more period props (bakery and kitchens)
const plankMat = () => mat("#ffffff", { map: woodTex("plank", "#8a6040", "#5a3a22") });
const timberMat = () => mat("#ffffff", { map: woodTex("timber", "#6e4b30", "#432a18") });
/** wood wainscot along a wall: panel + top rail. `along` = "x" (back wall) or "z" (side wall), `at` = the wall face */
export const wainscot = (along: "x" | "z", from: number, to: number, at: number, inward: 1 | -1, h = 0.95) => {
  const g = new THREE.Group(), len = to - from, mid = (from + to) / 2, w = plankMat(), rail = timberMat();
  const box3 = (sx: number, sy: number, sz: number, m: THREE.Material, x: number, y: number, z: number) => g.add(mesh(new THREE.BoxGeometry(sx, sy, sz), m, [x, y, z]));
  if (along === "x") { box3(len, h, 0.04, w, mid, h / 2, at + inward * 0.02); box3(len, 0.07, 0.07, rail, mid, h, at + inward * 0.035); for (let x = from + 0.6; x < to - 0.3; x += 0.9) box3(0.05, h - 0.1, 0.055, rail, x, h / 2, at + inward * 0.03); }
  else { box3(0.04, h, len, w, at + inward * 0.02, h / 2, mid); box3(0.07, 0.07, len, rail, at + inward * 0.035, h, mid); for (let z = from + 0.6; z < to - 0.3; z += 0.9) box3(0.055, h - 0.1, 0.05, rail, at + inward * 0.03, h / 2, z); }
  return g;
};
/** exposed timber framing on a back wall (posts, a wall plate, one brace): x positions of the posts, wall face z */
export const timberFrame = (posts: number[], z: number, y0: number, y1: number, brace?: [number, number, number, number]) => {
  const g = new THREE.Group(), m = timberMat();
  for (const x of posts) g.add(mesh(new THREE.BoxGeometry(0.16, y1 - y0, 0.06), m, [x, (y0 + y1) / 2, z + 0.03]));
  g.add(mesh(new THREE.BoxGeometry(Math.max(...posts) - Math.min(...posts) + 0.16, 0.16, 0.06), m, [(Math.max(...posts) + Math.min(...posts)) / 2, y1, z + 0.03]));
  if (brace) { const [xa, ya, xb, yb] = brace, len = Math.hypot(xb - xa, yb - ya); const b = mesh(new THREE.BoxGeometry(len, 0.13, 0.05), m, [(xa + xb) / 2, (ya + yb) / 2, z + 0.03]); b.rotation.z = Math.atan2(yb - ya, xb - xa); g.add(b); }
  return g;
};
/** a stack of split firewood beside an oven (logs along z) */
export const logStack = (p: V3, rows = 4, perRow = 3, len = 0.5, r = 0.065) => {
  const g = new THREE.Group(); g.position.set(...p);
  const bark = mat("#6b4a30"), cut = mat("#d9b27a");
  for (let row = 0; row < rows; row++) for (let i = 0; i < perRow - (row % 2 ? 1 : 0); i++) {
    const x = (i - (perRow - 1) / 2) * r * 2.05 + (row % 2 ? r : 0), y = r + row * r * 1.75;
    const log = mesh(new THREE.CylinderGeometry(r * (0.9 + ((i + row) % 3) * 0.06), r, len, 9).rotateX(Math.PI / 2), [bark, cut, cut], [x, y, 0]); g.add(log);
  }
  return g;
};
/** wooden kneading trough on legs (pétrin), long side along z */
export const kneadingTrough = (p: V3, len = 1.3, wid = 0.5) => {
  const g = new THREE.Group(); g.position.set(...p); const w = plankMat(), leg = timberMat();
  g.add(mesh(new THREE.BoxGeometry(wid, 0.06, len), w, [0, 0.5, 0]));
  for (const s of [-1, 1]) { const side = mesh(new THREE.BoxGeometry(0.05, 0.3, len), w, [s * (wid / 2 + 0.01), 0.66, 0]); side.rotation.z = -s * 0.25; g.add(side); }
  for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(wid + 0.1, 0.3, 0.05), w, [0, 0.66, s * len / 2]));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(mesh(new THREE.BoxGeometry(0.07, 0.5, 0.07), leg, [sx * (wid / 2 - 0.06), 0.25, sz * (len / 2 - 0.08)]));
  g.add(mesh(new THREE.BoxGeometry(wid * 0.7, 0.04, len * 0.6), mat("#ead9b6"), [0, 0.54, 0]));   // a slab of dough resting in it
  return g;
};
/** long-handled wooden oven peel hanging blade-up on a side wall (wall face at x, inward +1 / -1) */
export const wallPeel = (x: number, z: number, top: number, inward: 1 | -1, len = 1.6) => {
  const g = new THREE.Group(), w = mat("#ffffff", { map: woodTex("peel", "#c39a66", "#8a6236") });
  g.add(mesh(new THREE.BoxGeometry(0.02, 0.36, 0.3), w, [x + inward * 0.03, top - 0.18, z]));
  g.add(mesh(new THREE.CylinderGeometry(0.016, 0.016, len, 8), w, [x + inward * 0.03, top - 0.36 - len / 2, z]));
  return g;
};
/** a bread basket hanging on a rope from a beam */
export const hangingBasket = (x: number, z: number, beamY: number, drop = 0.6, seed = 3) => {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, drop, 6), mat("#5a4632"), [x, beamY - drop / 2, z]));
  const b = breadBasket([x, beamY - drop - 0.14, z], 0.2, seed); g.add(b);
  return g;
};
/** a bowl of flour */
export const flourBowl = (p: V3, r = 0.09) => {
  const g = new THREE.Group(); g.position.set(...p);
  g.add(cyl(r, r * 0.62, r * 0.75, gloss("#d9cdb8", 40, "#888"), [0, 0, 0], 24));
  const heap = mesh(new THREE.SphereGeometry(r * 0.9, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat("#fbf7ee"), [0, r * 0.62, 0]); heap.scale.y = 0.45; g.add(heap);
  return g;
};
/** spilled flour on the floor (surface paint: an effect, not baked or exported) */
export const flourDust = (p: V3, r = 0.45, seed = 1) => {
  const tex = ctex(`dust${seed}`, 256, 256, (g, rnd) => {
    for (let i = 0; i < 90; i++) { const x = 128 + (rnd() - 0.5) * 190, y = 128 + (rnd() - 0.5) * 190, rr = 3 + rnd() * 16; const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, "rgba(255,252,244,0.16)"); gr.addColorStop(1, "rgba(255,252,244,0)"); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, color: "#f3ece0" }));
  m.position.set(p[0], p[1] + 0.002, p[2]); m.userData.fx = true; m.receiveShadow = false; m.castShadow = false;
  return m;
};

// ---------------------------------------------------------------- accent colours, foreground pieces, floating specks
// (FEEDBACK_LOG #14: our sets were one brown-beige family; RicksClips keeps 2-3 saturated accents in every frame,
// a big object right in front of the lens, and something drifting in the air)
/** a check pattern (cloth) */
const checkCloth = (a: string, b: string, key: string) => {
  const t = ctex(key, 256, 256, (g) => {
    g.fillStyle = b; g.fillRect(0, 0, 256, 256);
    g.fillStyle = a; for (let i = 0; i < 256; i += 32) { g.globalAlpha = 0.55; g.fillRect(i, 0, 16, 256); g.fillRect(0, i, 256, 16); }
    g.globalAlpha = 1; for (let y = 0; y < 256; y += 32) for (let x = 0; x < 256; x += 32) g.fillRect(x, y, 16, 16);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
};
/** an oak barrel with iron hoops, optionally covered with a checked cloth and a jug on top */
export const barrel = (p: V3, h = 0.95, r = 0.33, o: { cloth?: string; jug?: string } = {}) => {
  const g = new THREE.Group(); g.position.set(...p);
  const prof = [[0, 0], [r * 0.86, 0], [r, h * 0.5], [r * 0.86, h], [0, h]].map(([x, y]) => new THREE.Vector2(x, y));
  const stave = woodTex("barrel", "#a8743f", "#6a4524"); stave.wrapS = stave.wrapT = THREE.RepeatWrapping; stave.repeat.set(3, 1);
  g.add(mesh(new THREE.LatheGeometry(prof, 30), mat("#ffffff", { map: stave, key: "barrel" })));
  for (const y of [0.12, 0.88]) { const k = 1 - Math.abs(y - 0.5) * 0.28; g.add(cyl(r * k * 1.015, r * k * 1.015, 0.045, mat("#3c3634"), [0, h * y - 0.022, 0], 30)); }
  if (o.cloth) { // a square cloth over the lid, its corners falling down the sides
    const c = mesh(new THREE.CylinderGeometry(r * 1.06, r * 1.18, 0.16, 4, 1, true), mat("#ffffff", { map: checkCloth(o.cloth, "#f6efe2", "check-" + o.cloth), key: "check-" + o.cloth, side: THREE.DoubleSide }), [0, h - 0.07, 0]);
    c.rotation.y = Math.PI / 4; g.add(c); g.add(mesh(new THREE.CircleGeometry(r * 0.88, 30).rotateX(-Math.PI / 2), mat("#ffffff", { map: checkCloth(o.cloth, "#f6efe2", "check-" + o.cloth), key: "check-" + o.cloth }), [0, h + 0.004, 0]));
  }
  if (o.jug) g.add(enamelJug([r * 0.25, h, -r * 0.1], 0.13, o.jug));
  return g;
};
/** an enamel jug (bright blue, white rim): a small saturated accent */
export const enamelJug = (p: V3, s = 0.13, color = "#2f6fb0") => {
  const g = new THREE.Group(); g.position.set(...p);
  const prof = [[0, 0], [s * 0.55, 0], [s * 0.62, s * 0.5], [s * 0.42, s * 1.05], [s * 0.36, s * 1.3], [s * 0.42, s * 1.38]].map(([x, y]) => new THREE.Vector2(x, y));
  g.add(mesh(new THREE.LatheGeometry(prof, 24), gloss(color, 70, "#ffffff")));
  g.add(mesh(new THREE.TorusGeometry(s * 0.42, s * 0.04, 6, 24).rotateX(Math.PI / 2), mat("#f4f1ea"), [0, s * 1.38, 0]));
  const handle = mesh(new THREE.TorusGeometry(s * 0.3, s * 0.05, 6, 16, Math.PI), gloss(color, 70, "#ffffff"), [s * 0.55, s * 0.8, 0]); handle.rotation.z = -Math.PI / 2; g.add(handle);
  return g;
};
/** a woven runner rug with coloured stripes (red, ochre, blue) */
export const rug = (p: V3, w = 1.1, l = 2.2, rotY = 0) => {
  const t = ctex("rug", 256, 512, (g, rnd) => {
    g.fillStyle = "#9b2f2a"; g.fillRect(0, 0, 256, 512);
    const bands = ["#d9a441", "#2f4f7a", "#f1e4c8", "#d9a441", "#2f4f7a"];
    bands.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, 40 + i * 92, 256, 18); g.fillRect(0, 70 + i * 92, 256, 6); });
    g.strokeStyle = "#f1e4c8"; g.lineWidth = 6; g.strokeRect(14, 14, 228, 484);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(0,0,0,${0.05 * rnd()})`; g.fillRect(rnd() * 256, rnd() * 512, 2, 2); }
  });
  const m = mesh(new THREE.BoxGeometry(w, 0.012, l), mat("#ffffff", { map: t, key: "rug" }), [p[0], p[1] + 0.006, p[2]]);
  m.rotation.y = rotY; return m;
};
/** bundles of dried herbs (green) and a braid of onions (gold) hanging from a beam */
export const herbBundles = (x: number, z: number, beamY: number, n = 3, spread = 0.35) => {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const xi = x + (i - (n - 1) / 2) * spread, drop = 0.28 + hash(i + x) * 0.18, onion = i % 3 === 2;
    g.add(mesh(new THREE.CylinderGeometry(0.006, 0.006, drop, 5), mat("#5a4632"), [xi, beamY - drop / 2, z]));
    if (onion) for (let k = 0; k < 5; k++) g.add(mesh(new THREE.SphereGeometry(0.045, 12, 8), gloss("#c98a3a", 30, "#ffe0a0"), [xi + (k % 2 ? 0.035 : -0.035), beamY - drop - k * 0.07, z]));
    else { const b = mesh(new THREE.ConeGeometry(0.075, 0.34, 9), mat(["#5d8a3a", "#7a9a3a", "#4f7a46"][i % 3]), [xi, beamY - drop - 0.17, z]); g.add(b);
      g.add(box(0.05, 0.03, 0.05, mat("#b03a2e"), [xi, beamY - drop + 0.0, z])); }
  }
  return g;
};
/** floating specks: flour dust in a sunbeam, or sparks over a fire (sprites: exported to Blender per frame) */
export const specks = (n: number, size: V3, o: { color?: string; rise?: number; s?: number; glow?: boolean } = {}) => {
  const tex = ctex(o.glow ? "spark" : "speck", 64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 1, 32, 32, 30); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,0.6)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
  const grp = new THREE.Group(), sp: THREE.Sprite[] = [], s0 = o.s ?? 0.02, rise = o.rise ?? 0.08;
  for (let i = 0; i < n; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, color: o.color ?? "#fff6e0", blending: o.glow ? THREE.AdditiveBlending : THREE.NormalBlending })); s.layers.set(NOINK); sp.push(s); grp.add(s); }
  const set = (f: number, amount = 1) => sp.forEach((s, i) => {
    const t = ((f / (o.glow ? 40 : 160) + hash(i * 7.3)) % 1 + 1) % 1, a = hash(i) * 6.28;
    s.position.set((hash(i * 3.1) - 0.5) * size[0] + Math.sin(f / 50 + a) * 0.05, (o.glow ? t : hash(i * 5.7)) * size[1] + (o.glow ? 0 : Math.sin(f / 70 + a) * rise), (hash(i * 1.9) - 0.5) * size[2]);
    s.scale.setScalar(s0 * (0.6 + hash(i * 2.3) * 0.8)); (s.material as THREE.SpriteMaterial).opacity = amount * (o.glow ? (1 - t) : 0.35 + 0.35 * Math.sin(f / 30 + a));
  });
  return { grp, set };
};
