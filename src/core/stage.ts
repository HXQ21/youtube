// Shared look for every episode: the repo's signature pieces (two-tone world shading, lit character cards, ink,
// lens blur, grade) are imported from the bridge reference implementation unchanged; this file adds what the
// bridge kept inside its story-specific world.ts: a light rig that works from a 15 cm pastry to a street,
// light presets for interiors / tabletops / night, cached materials, cards, an asset loader and aspect-aware cameras.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { staticFile } from "remotion";
import { TONE, CHAR, twoTone, untone } from "../videos/bridge/shade";
import { LIGHTS, LightPreset } from "../videos/bridge/lights";
import { NOINK } from "../videos/bridge/ink";
import { cardShade, CARD_K } from "../videos/bridge/cardshade";
import { Pen } from "../videos/bridge/toon";
import { ctex, cloudHD } from "../videos/bridge/paint";
import type { CamState, Ctx, Env, LightName, ShotInfo, ShotKind, V3 } from "./types";

// ---------------------------------------------------------------- light presets
type Sky = { c: [string, string, string, string, string]; e: [number, number, number, number, number]; bounce: V3; sat: number; grade: string }; // grade = key of FOOD_GRADES (grade.ts)
const L = (o: Partial<LightPreset>): LightPreset => ({ ...LIGHTS.day, ...o });
// Low-key look (2026-11-23, FOOD_GRADES in grade.ts, fitted to the reference colour statistics): deeper, near-neutral
// slate shade with only a faint cool lift, a warm key, a lower sun for longer shadows, world saturation just under 1. The bridge short keeps its own LIGHTS untouched.
export const FOOD_LIGHTS: Record<LightName, LightPreset> = {
  day: L({ el: 36, lit: [1.66, 1.52, 1.3], shade: [0.27, 0.27, 0.32], lift: [0.014, 0.018, 0.03] }),
  golden: LIGHTS.golden,
  // warm room lit through a window on screen-left: bakery, café, kitchen
  interior: L({ az: -62, el: 36, lit: [1.66, 1.42, 1.1], shade: [0.34, 0.3, 0.31], lift: [0.014, 0.014, 0.022], term: 0.25, charTint: [1.0, 0.92, 0.84], charShade: 0.9,
    fog: "#c9a47e", fogNear: 40, fogFar: 260, sunCol: "#ffe2bd", sunI: 2.6 }),
  // food close-ups: large soft key from upper back-left, bright warm shade so colours and glaze stay readable
  table: L({ az: -38, el: 52, lit: [1.66, 1.5, 1.3], shade: [0.42, 0.39, 0.42], lift: [0.02, 0.02, 0.03], lambert: 0.45, term: 0.3, charTint: [1.0, 0.94, 0.88], charShade: 0.92,
    fog: "#e8d5bb", fogNear: 30, fogFar: 200, sunCol: "#fff0dc", sunI: 2.8 }),
  // moonlit night for legend scenes
  night: L({ az: 118, el: 34, lit: [0.5, 0.6, 0.92], shade: [0.09, 0.11, 0.23], lift: [0.02, 0.03, 0.07], term: 0.15, charTint: [0.7, 0.8, 1.0], charShade: 0.8, sideTint: [0.8, 0.84, 1.0],
    fog: "#1b2347", fogNear: 18, fogFar: 170, sunCol: "#a9c0ff", sunI: 2.0 }),
  // flat cool overhead light: factory floor, supermarket
  cool: L({ az: 25, el: 68, lit: [1.48, 1.48, 1.46], shade: [0.32, 0.34, 0.4], lift: [0.015, 0.02, 0.035], term: 0.3, charTint: [0.96, 0.98, 1.0], charShade: 0.92,
    fog: "#d6dee7", fogNear: 40, fogFar: 300, sunCol: "#f2f6ff", sunI: 2.6 }),
};
export const FOOD_SKY: Record<LightName, Sky> = {
  day: { c: ["#b8d0ec", "#9cbfea", "#6a9fe0", "#4f8cdb", "#3373cc"], e: [0, 3, 8, 16, 40], bounce: [0, 0, 0], sat: 0.95, grade: "cine" },
  golden: { c: ["#ffc47c", "#f7ae78", "#e8967c", "#c4848e", "#8a6f8a"], e: [0, 4, 10, 20, 40], bounce: [0.04, 0.02, 0], sat: 0.98, grade: "cineWarm" },
  interior: { c: ["#d9b78f", "#cfa67c", "#b98e68", "#9a7354", "#6f5240"], e: [0, 6, 14, 26, 50], bounce: [0.05, 0.03, 0.01], sat: 0.95, grade: "cineWarm" },
  table: { c: ["#f0dcc0", "#ead1b0", "#dfc19c", "#cfae88", "#b99672"], e: [0, 6, 14, 26, 50], bounce: [0.05, 0.035, 0.015], sat: 1.02, grade: "cineTable" },
  night: { c: ["#2a3566", "#222b58", "#1a2149", "#12183a", "#0a0e2a"], e: [0, 4, 10, 22, 45], bounce: [0, 0, 0], sat: 0.9, grade: "cineNight" },
  cool: { c: ["#dfe6ee", "#d3dce6", "#c4cfdb", "#b3c0cf", "#9fadbf"], e: [0, 6, 14, 26, 50], bounce: [0, 0, 0], sat: 0.92, grade: "cine" },
};

export const CAM_NEAR = 0.02, CAM_FAR = 4000;
// ---------------------------------------------------------------- stage: sky + sun + two-tone uniforms
export class Stage {
  root = new THREE.Group();
  private hemi = new THREE.HemisphereLight("#cfe6ff", "#6c5c8c", 1.1);
  private sun = new THREE.DirectionalLight("#fff0d6", 2.6);
  private fog = new THREE.Fog("#bccbec", 25, 420);
  private skyMat: THREE.ShaderMaterial; private sky: THREE.Mesh;
  private sunDirs = new Map<string, THREE.Vector3>();
  private cloudG = new THREE.Group();
  constructor() {
    for (let i = 0; i < 8; i++) { // painted cloud cards far out, for exterior day / golden light only
      const a = (i / 8) * Math.PI * 2 + 0.4, d = 900 + (i % 3) * 130, w = 300 + (i % 4) * 70;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: cloudHD(i % 4), transparent: true, depthWrite: false, fog: false }));
      m.position.set(Math.cos(a) * d, 170 + (i % 4) * 70, Math.sin(a) * d); m.scale.set(w, w / 2, 1); m.layers.set(NOINK); m.renderOrder = -0.8; m.frustumCulled = false; this.cloudG.add(m);
    }
    this.root.add(this.cloudG);
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { c0: { value: new THREE.Color() }, c1: { value: new THREE.Color() }, c2: { value: new THREE.Color() }, c3: { value: new THREE.Color() }, c4: { value: new THREE.Color() }, e: { value: new THREE.Vector4() } },
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform vec3 c0, c1, c2, c3, c4; uniform vec4 e; varying vec3 vP;
        void main(){ float el = asin(clamp(normalize(vP).y, -1.0, 1.0));
          vec3 c = mix(c0, c1, smoothstep(0.0, e.x, el)); c = mix(c, c2, smoothstep(e.x, e.y, el));
          c = mix(c, c3, smoothstep(e.y, e.z, el)); c = mix(c, c4, smoothstep(e.z, e.w, el)); gl_FragColor = vec4(c, 1.0); }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.skyMat);
    this.sky.renderOrder = -1; this.sky.frustumCulled = false; this.sky.layers.set(NOINK);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(4096, 4096);
    this.root.add(this.sky, this.hemi, this.sun, this.sun.target);
  }
  /** Set camera + lights for this frame. The sun is camera-relative and frozen per shot (`ref` = the shot's first
   *  camera), exactly like the bridge rig, so a moving camera never drags the shadows around. */
  apply(shotId: string, light: LightName, c: CamState, ref: CamState, cam: THREE.PerspectiveCamera, scene: THREE.Scene) {
    const P = FOOD_LIGHTS[light], K = FOOD_SKY[light];
    const pos = new THREE.Vector3(...c.pos), look = new THREE.Vector3(...c.look), dist = Math.max(0.05, pos.distanceTo(look));
    cam.position.copy(pos); cam.up.set(0, 1, 0); cam.lookAt(look); if (c.roll) cam.rotateZ(c.roll);
    // near/far stay CONSTANT for the whole film: the lens-blur and ink passes linearise depth with the values the
    // composer captured when it was created, so changing them per shot blurred every wide shot after a close-up
    cam.fov = c.fov; cam.near = CAM_NEAR; cam.far = CAM_FAR;
    cam.updateProjectionMatrix(); cam.updateMatrixWorld(); cam.layers.enable(NOINK);
    let dir = this.sunDirs.get(shotId + light);
    if (!dir) {
      const fx = ref.look[0] - ref.pos[0], fz = ref.look[2] - ref.pos[2], n = Math.hypot(fx, fz) || 1, az = THREE.MathUtils.degToRad(P.az), el = THREE.MathUtils.degToRad(P.el);
      const ux = fx / n, uz = fz / n, hx = ux * Math.cos(az) - uz * Math.sin(az), hz = uz * Math.cos(az) + ux * Math.sin(az);
      dir = new THREE.Vector3(hx * Math.cos(el), Math.sin(el), hz * Math.cos(el)).normalize();
      this.sunDirs.set(shotId + light, dir);
    }
    this.hemi.color.set(P.sky); this.hemi.groundColor.set(P.ground); this.hemi.intensity = P.hemiI;
    this.sun.color.set(P.sunCol); this.sun.intensity = P.sunI;
    // shadow frustum scaled to the shot: a pastry close-up gets millimetre shadows, a street gets a 60 m box
    const R = THREE.MathUtils.clamp(dist * 1.25 + 0.3, 0.5, 95), sc = this.sun.shadow.camera;
    this.sun.position.copy(look).addScaledVector(dir, R * 6); this.sun.target.position.copy(look);
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = R * 0.5; sc.far = R * 12; sc.updateProjectionMatrix();
    this.sun.shadow.bias = P.bias; this.sun.shadow.normalBias = P.normalBias * (R / 12);
    TONE.uLitCol.value.set(...P.lit); TONE.uShadeCol.value.set(...P.shade); TONE.uShadeLift.value.set(...P.lift);
    TONE.uLambert.value = P.lambert; TONE.uSideK.value = P.sideK; TONE.uTerm.value = P.term; TONE.uBounce.value.set(...K.bounce); TONE.uSat.value = K.sat;
    CHAR.uCharTint.value.set(...P.charTint); CHAR.uCharShade.value = P.charShade; CHAR.uGrad.value = P.charGrad; CHAR.uBodyGrad.value = P.bodyGrad; CHAR.uSideTint.value.set(...P.sideTint);
    const su = this.skyMat.uniforms;
    K.c.forEach((h, i) => untone(h, su["c" + i].value));
    const e = K.e.map((d) => THREE.MathUtils.degToRad(d)); su.e.value.set(e[1], e[2], e[3], e[4]);
    this.sky.position.copy(pos); this.sky.scale.setScalar(cam.far * 0.9);
    this.cloudG.visible = light === "day" || light === "golden"; this.cloudG.position.set(pos.x, 0, pos.z);
    for (const m of this.cloudG.children as THREE.Mesh[]) { m.lookAt(pos.x, m.position.y * 0.6, pos.z); (m.material as THREE.MeshBasicMaterial).color.setRGB(...(light === "golden" ? [1.25, 0.95, 0.8] : [1.12, 1.12, 1.12]) as [number, number, number]); }
    // fog distances are authored for street scale; scale them down with the shot so close-ups keep a hint of depth haze only far behind
    const fs = Math.max(1, 12 / Math.max(dist, 0.2)) > 1 && dist < 12 ? dist / 12 : 1;
    untone(P.fog, this.fog.color); this.fog.near = Math.max(P.fogNear * fs, dist * 3); this.fog.far = Math.max(P.fogFar * fs, dist * 30);
    scene.fog = this.fog; scene.background = null;
    return { dist, grade: K.grade };
  }
}

// ---------------------------------------------------------------- materials
const mats = new Map<string, THREE.Material>();
/** cached two-tone Lambert material (the repo's world shading). `opts.map` = painted canvas texture. */
export const mat = (color: string, opts: { map?: THREE.Texture; key?: string; side?: THREE.Side; flat?: boolean } = {}) => {
  const key = `${color}|${opts.key ?? opts.map?.uuid ?? ""}|${opts.side ?? 0}|${opts.flat ? 1 : 0}`;
  let m = mats.get(key);
  if (!m) { m = twoTone(new THREE.MeshLambertMaterial({ color, map: opts.map ?? null, side: opts.side ?? THREE.FrontSide, flatShading: !!opts.flat })); mats.set(key, m); }
  return m as THREE.MeshLambertMaterial;
};
/** glossy variant (glaze, broth, glass, metal): Phong specular kept by the two-tone patch */
export const gloss = (color: string, shininess = 60, specular = "#8a7a6a", opts: { map?: THREE.Texture; transparent?: boolean; opacity?: number } = {}) => {
  const key = `g|${color}|${shininess}|${specular}|${opts.map?.uuid ?? ""}|${opts.opacity ?? 1}`;
  let m = mats.get(key);
  if (!m) { m = twoTone(new THREE.MeshPhongMaterial({ color, shininess, specular, map: opts.map ?? null, transparent: !!opts.transparent, opacity: opts.opacity ?? 1 })); mats.set(key, m); }
  return m as THREE.MeshPhongMaterial;
};
/** self-lit colour that lands on screen as the given sRGB value after the Neutral tone map (fire, glow, screens) */
export const glow = (color: string, k = 1) => { const c = untone(color); c.multiplyScalar(k); return new THREE.MeshBasicMaterial({ color: c, toneMapped: true, fog: false }); };

/** fire seen through an oven mouth: dark top, glowing bed (multiply its colour per frame for flicker) */
export const fireMat = () => new THREE.MeshBasicMaterial({ fog: false, map: ctex("fire", 64, 128, (g) => { const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, "#2a120c"); gr.addColorStop(0.45, "#7a2a10"); gr.addColorStop(0.8, "#ff8a2a"); gr.addColorStop(1, "#ffe08a"); g.fillStyle = gr; g.fillRect(0, 0, 64, 128); }) });
export const flicker = (m: THREE.Material, f: number) => { const k = 1.15 + 0.35 * hash(Math.floor(f / 3)); (m as THREE.MeshBasicMaterial).color.setRGB(1.5 * k, 1.25 * k, 1.0 * k); };
export const mesh = (g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], p: V3 = [0, 0, 0], shadow = true) => {
  const o = new THREE.Mesh(g, m); o.position.set(...p); o.castShadow = shadow; o.receiveShadow = true; return o;
};
export const box = (w: number, h: number, d: number, m: THREE.Material, p: V3 = [0, 0, 0]) => mesh(new THREE.BoxGeometry(w, h, d), m, [p[0], p[1] + h / 2, p[2]]);
export const cyl = (r0: number, r1: number, h: number, m: THREE.Material, p: V3 = [0, 0, 0], seg = 28) => mesh(new THREE.CylinderGeometry(r0, r1, h, seg), m, [p[0], p[1] + h / 2, p[2]]);

// simple painted textures (canvas, cached)
export const woodTex = (key: string, base: string, grain: string) => ctex("wood" + key, 512, 512, (g, r) => {
  g.fillStyle = base; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 70; i++) { g.strokeStyle = grain; g.globalAlpha = 0.12 + r() * 0.2; g.lineWidth = 1 + r() * 3; const y = r() * 512; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(170, y + r() * 14 - 7, 340, y + r() * 14 - 7, 512, y + r() * 8 - 4); g.stroke(); }
  g.globalAlpha = 1;
});
export const checkTex = (key: string, a: string, b: string, n = 8) => ctex("check" + key, 512, 512, (g) => {
  const s = 512 / n; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { g.fillStyle = (x + y) % 2 ? a : b; g.fillRect(x * s, y * s, s, s); }
});
export const brickTex = (key: string, cols: string[], mortar: string) => ctex("brick" + key, 512, 512, (g, r) => {
  g.fillStyle = mortar; g.fillRect(0, 0, 512, 512);
  const bh = 512 / 8, bw = 512 / 4;
  for (let y = 0; y < 8; y++) for (let x = -1; x < 5; x++) { g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillRect(x * bw + (y % 2 ? bw / 2 : 0) + 4, y * bh + 4, bw - 8, bh - 8); }
});

// ---------------------------------------------------------------- character / drawing cards
export const SU = 0.00216; // metres per design unit (1000 units = 2.16 m card, soles at y = 975)
/** every live card by its mesh (the Blender export finds character cards through this, without touching mesh userData) */
export const CARDS = new WeakMap<THREE.Object3D, Card>();
/** A lit flat card with its own canvas. `draw(key, fn)` repaints only when the key changes. Yaw-only billboard. */
export class Card {
  mesh: THREE.Mesh; private cv: HTMLCanvasElement; private tex: THREE.CanvasTexture; private key = ""; private k: number;
  constructor(parent: THREE.Object3D, readonly w = 600, readonly h = 1000, opts: { res?: number; unit?: number; baseline?: number; lit?: boolean; shadow?: boolean } = {}) {
    const res = opts.res ?? 1, unit = opts.unit ?? SU, baseline = opts.baseline ?? 975;
    this.k = res; this.cv = document.createElement("canvas"); this.cv.width = w * res; this.cv.height = h * res;
    this.tex = new THREE.CanvasTexture(this.cv); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    const geo = new THREE.PlaneGeometry(w * unit, h * unit); geo.translate(0, (baseline - h / 2) * unit, 0);
    const lit = opts.lit ?? true;
    const m = lit ? cardShade(new THREE.MeshLambertMaterial({ map: this.tex, alphaTest: 0.5, side: THREE.DoubleSide })) : new THREE.MeshBasicMaterial({ map: this.tex, alphaTest: 0.5, side: THREE.DoubleSide });
    m.alphaToCoverage = false;
    this.mesh = new THREE.Mesh(geo, m);
    this.mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: this.tex, alphaTest: 0.5, side: THREE.DoubleSide });
    this.mesh.onBeforeRender = (r) => { const rt = r.getRenderTarget(); CARD_K.uPx.value = (rt ? rt.height : r.domElement.height) / 1920; };
    this.mesh.castShadow = opts.shadow ?? true; this.mesh.receiveShadow = lit; this.mesh.renderOrder = 1; this.mesh.layers.set(NOINK);
    parent.add(this.mesh); CARDS.set(this.mesh, this);
  }
  /** what is painted on the card right now (same key = same picture) */
  get drawKey() { return this.key; }
  /** the card picture as PNG (Blender export) */
  png(): Promise<Blob> { return new Promise((ok, no) => this.cv.toBlob((b) => (b ? ok(b) : no(new Error("card png"))), "image/png")); }
  draw(key: string, fn: (p: Pen, g: CanvasRenderingContext2D) => void) {
    if (key === this.key) return;
    this.key = key;
    const g = this.cv.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.cv.width, this.cv.height); g.setTransform(this.k, 0, 0, this.k, 0, 0);
    fn(new Pen(g), g); this.tex.needsUpdate = true;
  }
  /** turn the card toward the camera about the vertical axis */
  face(camPos: V3) { const p = this.mesh.getWorldPosition(new THREE.Vector3()); this.mesh.rotation.y = Math.atan2(camPos[0] - p.x, camPos[2] - p.z); }
}

// ---------------------------------------------------------------- asset kit
const toonify = (o: THREE.Object3D) => o.traverse((x) => {
  const m = x as THREE.Mesh; if (!m.isMesh) return;
  const conv = (src: THREE.Material) => { const s = src as THREE.MeshStandardMaterial; return mat("#" + (s.color ?? new THREE.Color("#ffffff")).getHexString(), { map: s.map ?? undefined, key: "kit" + (s.map?.uuid ?? "") + (s.name ?? "") }); };
  m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
  m.castShadow = true; m.receiveShadow = true;
});
export type Loaded = Map<string, THREE.Object3D | THREE.Texture>;
/** keys under "_baked/" are sets whose lighting was baked in Blender (scripts/blender.mjs bake): loaded as they are, no toon materials */
export const BAKED = "_baked/";
const IMAGE = /\.(png|jpe?g|webp)$/i;
/** load every model and image texture listed in the timeline's asset map (key "assetId/name" -> public path). Missing files resolve to nothing. */
export const loadKit = async (assets: Record<string, string>): Promise<Loaded> => {
  const loader = new GLTFLoader(), texLoader = new THREE.TextureLoader(), out: Loaded = new Map();
  await Promise.all(Object.entries(assets).map(async ([key, file]) => {
    try {
      if (IMAGE.test(file)) { const t = await texLoader.loadAsync(staticFile(file)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; out.set(key, t); }
      else { const g = await loader.loadAsync(staticFile(file)); if (!key.startsWith(BAKED)) toonify(g.scene); else Object.assign(g.scene.userData, g.userData ?? {}); out.set(key, g.scene); }
    } catch { /* reported as missing below */ }
  }));
  return out;
};
const phTex = () => ctex("placeholder", 256, 256, (g) => { g.fillStyle = "#c9c2cf"; g.fillRect(0, 0, 256, 256); g.strokeStyle = "#8a7f96"; g.lineWidth = 14; for (let i = -256; i < 512; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 256, 256); g.stroke(); } });
export const makeEnv = (kit: Loaded): Env => {
  const missing = new Set<string>();
  return {
    missing, has: (key) => kit.has(key),
    tex(key, opt = {}) {
      const src = kit.get(key);
      if (!(src instanceof THREE.Texture)) return null;
      if (!opt.repeat) return src;
      const t = src.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...opt.repeat); t.needsUpdate = true; return t;
    },
    baked(scene) {
      const set = kit.get(BAKED + scene), light = kit.get(BAKED + scene + "-light");
      return set instanceof THREE.Object3D ? { set, light: light instanceof THREE.Texture ? light : null } : null;
    },
    model(key, opt = {}) {
      const got = kit.get(key), src = got instanceof THREE.Object3D ? got : undefined;
      if (!src) { // hatched grey box = "asset not delivered yet"; the episode shows a DRAFT badge whenever one is on screen
        missing.add(key);
        const [w, h, d] = opt.fallback ?? [1, opt.h ?? 1, 1], o = box(w, opt.h ?? h, d, mat("#ffffff", { map: phTex(), key: "ph" }));
        const grp = new THREE.Group(); grp.add(o); grp.userData.placeholder = true; return grp;
      }
      const o = src.clone(true), grp = new THREE.Group(); grp.add(o);
      const bb = new THREE.Box3().setFromObject(o);
      o.position.y -= bb.min.y; // base on the ground
      if (opt.h) grp.scale.setScalar(opt.h / Math.max(1e-4, bb.max.y - bb.min.y));
      return grp;
    },
  };
};

// ---------------------------------------------------------------- cameras
export const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
export const easeOut = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
/** deterministic hash noise in [0, 1) */
export const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
/** Frame a subject box (centre, width, height in metres) from direction `dir` (subject -> camera) so that it fits
 *  BOTH the frame width and height at this aspect ratio: the same set-up works for 9:16, 16:9, 1:1... */
export const frame = (centre: V3, w: number, h: number, dir: V3, aspect: number, fov = 32, margin = 1.12, cInf = 10): CamState => {
  const t = Math.tan(THREE.MathUtils.degToRad(fov) / 2), d = Math.max(h / 2 / t, w / 2 / (t * aspect)) * margin, n = Math.hypot(...dir) || 1;
  return { pos: [centre[0] + (dir[0] / n) * d, centre[1] + (dir[1] / n) * d, centre[2] + (dir[2] / n) * d], look: centre, fov, cInf };
};
export const mixCam = (a: CamState, b: CamState, t: number): CamState => ({ pos: lerp3(a.pos, b.pos, t), look: lerp3(a.look, b.look, t), fov: lerp(a.fov, b.fov, t),
  roll: lerp(a.roll ?? 0, b.roll ?? 0, t), focus: lerp3(a.focus ?? a.look, b.focus ?? b.look, t), cInf: lerp(a.cInf ?? 0, b.cInf ?? 0, t) });
/** slow push-in / drift so no shot is a frozen frame: moves the camera `k` of the way toward the subject and sideways */
export const drift = (c: CamState, u: number, k = 0.06, side = 0.03): CamState => {
  const d: V3 = [c.look[0] - c.pos[0], c.look[1] - c.pos[1], c.look[2] - c.pos[2]], s = smooth(u), len = Math.hypot(...d);
  const rx = -d[2] / (Math.hypot(d[0], d[2]) || 1), rz = d[0] / (Math.hypot(d[0], d[2]) || 1);
  return { ...c, pos: [c.pos[0] + d[0] * k * s + rx * len * side * (s - 0.5), c.pos[1] + d[1] * k * s, c.pos[2] + d[2] * k * s + rz * len * side * (s - 0.5)] };
};
/** shot table for scenes that never contain 2D characters (free camera: top-down, orbit, dutch are all fine there) */
export const noChars = (kinds: Record<string, ShotKind>): Record<string, ShotInfo> => Object.fromEntries(Object.entries(kinds).map(([k, kind]) => [k, { kind, chars: false }]));
export const dirOf = (yawDeg: number, pitchDeg: number): V3 => { const y = THREE.MathUtils.degToRad(yawDeg), p = THREE.MathUtils.degToRad(pitchDeg); return [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)]; };
/** Camera for shots that show flat 2D characters. By construction: level horizon (no roll), on the audience side of the
 *  stage (|yaw| <= 40 deg, so the front drawing is always what we should see), a longish lens (default 30 deg) so
 *  close-ups do not distort. Elevation is up to +-18 deg (PITCH_MAX): the story picks low hero angles or high reveals;
 *  beyond +-12 declare the set-up `drama: true` in the scene's `shots` so camcheck accepts it (FEEDBACK_LOG #17).
 *  `portrait` = [centre, w, h] to re-frame for vertical video. */
export const charCam = (centre: V3, w: number, h: number, o: { yaw?: number; pitch?: number; fov?: number; cInf?: number; push?: number; side?: number; margin?: number; portrait?: [V3, number, number]; pyaw?: number; ppitch?: number } = {}) => (c: Ctx): CamState => {
  // vertical video frames the same width from much farther away, so a set-up may give its own yaw / pitch for portrait
  // (a strong side angle would push the camera through a side wall, a high aim point would look down on the cast)
  const tall = c.aspect < 1, yaw = Math.max(-40, Math.min(40, (tall ? o.pyaw : undefined) ?? o.yaw ?? 0)), pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, (tall ? o.ppitch : undefined) ?? o.pitch ?? 4)), [C, W, H] = tall && o.portrait ? o.portrait : [centre, w, h];
  return drift(frame(C, W, H, dirOf(yaw, pitch), c.aspect, o.fov ?? 30, o.margin ?? 1.08, o.cInf ?? 8), c.u, o.push ?? 0.04, o.side ?? 0.02);
};
/** The channel's default for character shots since FEEDBACK_LOG #14 (RicksClips study): the same safety rules as
 *  charCam (level, near eye level, audience side) but a WIDE lens from CLOSE (fov 50-60 deg, 2-4 m), a strong 3/4
 *  angle and a bigger push, so floor, walls and ceiling converge and the room has depth; the lead fills 35-60% of the
 *  frame height. Flat cards do not distort under a wide lens as long as they stay away from the frame edges (camcheck
 *  DISTORT). Pair every hero set-up with a foreground piece (a prop 1-2 m from the lens at a frame edge). */
export const heroCam = (centre: V3, w: number, h: number, o: Parameters<typeof charCam>[3] = {}) =>
  charCam(centre, w, h, { fov: 54, cInf: 6, push: 0.08, side: 0.035, margin: 1.04, yaw: -32, pitch: 2, ...o });

// ---------------------------------------------------------------- story cameras (FEEDBACK_LOG #17)
/** max elevation from eye level for any camera that shows 2D characters (camcheck errors past RULES.pitchErr = 20) */
export const PITCH_MAX = 18;
/** Low hero angle: heroCam from below the lead's head, looking up, for power, threat, triumph. Aim `centre` near head
 *  height: the lens then sits about 15-18 deg below the head (pitch -9 toward the centre, steeper toward the head).
 *  Declare it in the scene's `shots` as { kind, chars: true, drama: true }. */
export const lowCam = (centre: V3, w: number, h: number, o: Parameters<typeof charCam>[3] = {}) =>
  heroCam(centre, w, h, { pitch: -9, ppitch: -9, push: 0.08, ...o });
/** High reveal: above the cast looking down (pitch +14), for "look how many / how small". drama: true. */
export const highCam = (centre: V3, w: number, h: number, o: Parameters<typeof charCam>[3] = {}) =>
  heroCam(centre, w, h, { pitch: 14, ppitch: 14, push: 0.08, ...o });
/** Point of view: the camera sits at a character's eyes (`eye`, world space) and looks at `target`, with a small push
 *  toward it. The viewer's own card must be hidden by the scene for this shot. Others seen from eye height stay level. */
export const povCam = (eye: V3, target: V3, o: { fov?: number; push?: number; cInf?: number } = {}) => (c: Ctx): CamState =>
  drift({ pos: eye, look: target, fov: o.fov ?? 50, cInf: o.cInf ?? 6 }, c.u, o.push ?? 0.1, 0.01);
/** A camera path through several set-ups in one shot: fly-in from the sky to a door, through a window into the room,
 *  following an object to the next subject. Keys are camera functions (any of the above) and the shot's progress u is
 *  spread evenly over the legs, eased at both ends of the whole move (`ease: "out"` = fast start that settles). When a
 *  key shows characters and another does not, declare the set-up with the stricter policy (scene `shots`). */
export const pathCam = (keys: ((c: Ctx) => CamState)[], o: { ease?: "smooth" | "out" | "linear" } = {}) => (c: Ctx): CamState => {
  const n = keys.length - 1;
  if (n < 1) return keys[0](c);
  const u = o.ease === "linear" ? c.u : o.ease === "out" ? easeOut(c.u) : smooth(c.u), x = Math.min(n - 1e-6, u * n), i = Math.floor(x);
  const at = (k: number) => keys[k]({ ...c, u: k / n });
  return mixCam(at(i), at(i + 1), x - i); // linear inside a leg, so the move never stops at a key; the ends are eased above
};
export const actionT = (c: Ctx, name: string, fallback: number) => c.actions.find((a) => a.name === name)?.t ?? fallback;
