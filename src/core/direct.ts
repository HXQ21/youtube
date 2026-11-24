// Direction layer: picks the scene + camera for a frame, applies the camera rules for flat 2D characters, and
// audits every frame of every camera path. Shared by the renderer (Episode.tsx) and the `camcheck` command, so the
// audit measures exactly what gets rendered.
//
// CAMERA RULES FOR 2D CHARACTERS (cards are yaw-only billboards with one FRONT drawing and one SIDE walking drawing):
//   1. roll = 0 whenever a camera may show characters (horizon stays level, cards never look tilted)
//   2. elevation toward a character's head within +-12 deg by default; a set-up declared `drama: true` (low hero
//      angle, high reveal, POV) may go to +-18 deg. Past 20 deg a card is foreshortened and reads as a sheet of paper.
//      These rules protect the cards only: the story picks the camera (low, POV, fly-through, aerial), camcheck verifies
//   3. never across the stage line: all character cameras sit on the audience (+z) side, so a front drawing is
//      never asked to stand in for a back or 3/4-rear view
//   4. cards stay upright with feet on the ground; a camera is never fixed by leaning the card
//   5. top-down / aerial / dutch / orbit set-ups are declared `chars: false`: scenes hide the characters there
//   6. impact shakes translate the camera only (no rotational shake)
import * as THREE from "three";
import { SCENES } from "../scenes";
import { mixCam, smooth, easeOut, CARDS } from "./stage";
import { TONE } from "../videos/bridge/shade";
import type { ActorInfo, CamState, Ctx, Env, SceneInst, ShotInfo, Timeline, TLShot } from "./types";

export const shotAt = (tl: Timeline, f: number) => tl.shots.find((s) => f >= s.a && f < s.b) ?? tl.shots[tl.shots.length - 1];
const DEFAULT: ShotInfo = { kind: "wide", chars: true };

export class Host {
  root = new THREE.Group();
  private built = new Map<string, SceneInst>();
  constructor(private env: Env) {}
  get(id: string): SceneInst {
    let s = this.built.get(id);
    if (!s) {
      const def = SCENES[id];
      if (!def) throw new Error(`Scene "${id}" is not registered in src/scenes/index.ts. Registered: ${Object.keys(SCENES).join(", ")}`);
      s = def.build(this.env); this.built.set(id, s); this.root.add(s.root);
      nameMeshes(s.root);
      const bk = this.env.baked?.(id), fix = bk ? applyBaked(s.root, bk.set, bk.light) : null;
      // scenes recolour or swap materials in update() (era, place...): re-apply the baked twins after every update
      if (fix) { const inst = s, up = inst.update.bind(inst); inst.update = (c, cam) => { up(c, cam); fix(); }; }
    }
    for (const [k, v] of this.built) v.root.visible = k === id;
    return s;
  }
}

/** stable names m0, m1, ... for the meshes of a scene (traversal order, cards skipped): the Blender export and the
 *  baked set refer to meshes by these names */
export const nameMeshes = (root: THREE.Object3D) => { let i = 0; root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !CARDS.has(o) && !o.userData.fx) o.name = `m${i++}`; }); };
/** Swap in a set whose lighting was baked in Blender: every lit mesh that has a baked twin gets the twin's geometry
 *  (with the lightmap UVs) and an unlit material = its own colour/texture x the baked light. Scene code keeps
 *  driving visibility, so props a scene toggles still work; moving props were never baked and stay toon-shaded. */
const applyBaked = (root: THREE.Object3D, set: THREE.Object3D, light: THREE.Texture | null): (() => void) | null => {
  if (!light) return null;
  const lm = light.clone(); lm.flipY = false; lm.channel = 1; lm.needsUpdate = true;
  const k = Math.PI * Number(set.userData.lmScale ?? 1), twins = new Map<string, THREE.Mesh>();
  set.updateMatrixWorld(true); set.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry.getAttribute("uv1")) twins.set(m.name.replace(/[._]\d+$/, ""), m); });
  const conv = new Map<THREE.Material, THREE.MeshBasicMaterial>(), baked = new Set<THREE.Material>(), toon = set.userData.lmStyle === "toon";
  const bake = (src: THREE.Material): THREE.Material => {
    if (baked.has(src) || (src as THREE.MeshBasicMaterial).isMeshBasicMaterial) return src;
    let m = conv.get(src);
    if (!m) {
      const s = src as THREE.MeshLambertMaterial;
      m = new THREE.MeshBasicMaterial({ side: s.side, transparent: s.transparent, lightMap: lm, lightMapIntensity: k });
      m.color = s.color; // shared: a scene that recolours its material at run time recolours the baked twin too
      if (toon) bakedToon(m, Number(set.userData.lmScale ?? 1));
      conv.set(src, m); baked.add(m);
    }
    const s = src as THREE.MeshLambertMaterial; if (m.map !== s.map) { m.map = s.map; m.needsUpdate = true; } m.opacity = s.opacity;
    return m;
  };
  const swapped: THREE.Mesh[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh, t = m.isMesh ? twins.get(m.name) : undefined; if (!t) return;
    // painted per vertex (loaves, pastry): the baked twin has no vertex colours, so keep the original toon mesh
    if ((Array.isArray(m.material) ? m.material : [m.material]).some((x) => (x as THREE.MeshLambertMaterial).vertexColors)) return;
    m.geometry = t.geometry; swapped.push(m);
    const local = m.parent ? m.parent.matrixWorld.clone().invert().multiply(t.matrixWorld) : t.matrixWorld.clone();
    local.decompose(m.position, m.quaternion, m.scale); m.receiveShadow = false;
  });
  const fix = () => { for (const m of swapped) m.material = Array.isArray(m.material) ? m.material.map(bake) : bake(m.material); };
  fix();
  return fix;
};

/** Baked light drawn in the channel's two-tone palette (same uniforms as shade.ts, so every light preset applies):
 *  the lightmap says how much light a texel gets (1 = full sun); in sun it takes the lit colour, in shadow the shade
 *  colour plus the cool lift, both scaled by the baked amount (contact darkening, bounce), tinted by the light's colour. */
const bakedToon = (m: THREE.MeshBasicMaterial, lmK: number) => {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, TONE, { uLmK: { value: lmK } });
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uLitCol; uniform vec3 uShadeCol; uniform vec3 uShadeLift; uniform float uSat; uniform float uLmK;")
      .replace("vec3 outgoingLight = reflectedLight.indirectDiffuse;", `
  vec3 Lb = texture2D( lightMap, vLightMapUv ).rgb * uLmK;
  float lb = max( Lb.r, max( Lb.g, Lb.b ) );
  float t = smoothstep( 0.32, 0.62, lb );                                   // in sun or not
  vec3 tint = mix( vec3( 1.0 ), Lb / max( lb, 1e-4 ), 0.28 );
  float shK = clamp( lb / 0.22, 0.4, 1.3 ), litK = clamp( lb, 0.75, 1.12 );
  vec3 alb = max( mix( vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), diffuseColor.rgb, uSat ), 0.0 );
  vec3 outgoingLight = alb * mix( uShadeCol * shK, uLitCol * litK, t ) * tint + uShadeLift * ( 1.0 - t ) * shK;`);
  };
  m.customProgramCacheKey = () => "bakedToon1";
};

/** "kick" actions: a short decaying camera shake on an impact word. Translation only: a rotational shake tilts every character card. */
const shake = (c: CamState, x: Ctx, legacy = false): CamState => {
  let k = 0, ph = 0;
  for (const a of x.actions) if (a.name === "kick") { const dt = x.t - a.t; if (dt >= 0 && dt < 0.45) { k = Math.max(k, (1 - dt / 0.45) ** 2); ph = dt; } }
  if (!k) return c;
  const d = Math.hypot(c.pos[0] - c.look[0], c.pos[1] - c.look[1], c.pos[2] - c.look[2]) * 0.014 * k, dx = Math.sin(ph * 70) * d, dy = Math.cos(ph * 53) * d;
  if (legacy) return { ...c, pos: [c.pos[0] + dx, c.pos[1] + dy, c.pos[2]], roll: (c.roll ?? 0) + Math.sin(ph * 61) * 0.014 * k }; // the pre-fix shake, for the "before" audit only
  return { ...c, pos: [c.pos[0] + dx, c.pos[1] + dy, c.pos[2]], look: [c.look[0] + dx, c.look[1] + dy, c.look[2]] };
};
const camFor = (inst: SceneInst, shot: TLShot, c: Ctx): CamState => {
  const get = (n: string) => (inst.cams[n] ?? inst.cams.main)(c), spec = shot.camera;
  if (typeof spec === "string") return get(spec);
  const t = spec.ease === "linear" ? c.u : spec.ease === "out" ? easeOut(c.u) : smooth(c.u);
  return mixCam(get(spec.from), get(spec.to), t);
};
export const camLabel = (shot: TLShot) => (typeof shot.camera === "string" ? shot.camera : `${shot.camera.from} -> ${shot.camera.to}`);
export const shotInfo = (inst: SceneInst, shot: TLShot): ShotInfo => {
  const of = (n: string) => inst.shots?.[n] ?? DEFAULT, spec = shot.camera;
  if (typeof spec === "string") return of(spec);
  const a = of(spec.from), b = of(spec.to);
  return { kind: b.kind, chars: a.chars && b.chars, drama: !!(a.drama || b.drama) }; // a move through a 3D-only set-up hides the characters for the whole move
};

export type FrameState = { shot: TLShot; inst: SceneInst; ctx: Ctx; cam: CamState; ref: CamState; info: ShotInfo };
/** everything about one frame, as a pure function of the frame number (frames can be asked in any order) */
export const frameState = (tl: Timeline, host: Host, f: number, aspect: number, legacy = false): FrameState => {
  const shot = shotAt(tl, f), inst = host.get(shot.scene), lf = f - shot.a, n = shot.b - shot.a, info = shotInfo(inst, shot);
  const span = (Array.isArray(shot.params.span) ? shot.params.span : [0, 1]) as [number, number];
  const actions = tl.events.filter((e) => e.type === "action" && e.shot === shot.id).map((e) => ({ name: e.name, t: (e.frame - shot.a) / tl.fps }));
  const mk = (frame: number): Ctx => { const u = n > 1 ? frame / (n - 1) : 0; return { f: shot.a + frame, lf: frame, t: frame / tl.fps, u, p: span[0] + (span[1] - span[0]) * u, dur: n / tl.fps, fps: tl.fps, aspect, seed: shot.seed, params: shot.params, actions, chars: info.chars }; };
  const ctx = mk(lf);
  let cam = shake(camFor(inst, shot, ctx), ctx, legacy);
  if (info.chars && !legacy) cam = { ...cam, roll: 0 };
  return { shot, inst, ctx, cam, ref: camFor(inst, shot, mk(0)), info };
};

// ------------------------------------------------------------------------------------------------ audit
const deg = THREE.MathUtils.radToDeg;
export type Issue = { level: "error" | "warn"; code: string; msg: string; first: number; last: number; frames: number };
export type ActorAudit = { id: string; sprite: string; moving: boolean; frames: number; screenH: [number, number]; pitch: [number, number]; visible: [number, number]; headOut: number; cut: number; occluded: number; edge: number; minDist: number; slip: number };
export type ShotAudit = { id: string; scene: string; camera: string; kind: string; chars: boolean; a: number; b: number; sec: number; roll: number; camJump: number; mainActor: string | null; actors: ActorAudit[]; issues: Issue[] };
export const RULES = { rollDeg: 0.3, pitchWarn: 12, pitchDrama: 18, pitchErr: 20, edgeDeg: 12, cutLo: 0.15, cutHi: 0.8, slideMs: 0.15, slipRel: 0.15, jumpDeg: 3, minDist: 0.6, mediumMinH: 0.28, closeMinH: 0.6 };

/** Walk every frame of the film, pose the scene exactly like the renderer and measure each visible character card. */
export const auditTimeline = (tl: Timeline, env: Env, aspect: number, legacy = false): { rules: typeof RULES; shots: ShotAudit[] } => {
  const host = new Host(env), camObj = new THREE.PerspectiveCamera(), ray = new THREE.Raycaster();
  const v = new THREE.Vector3(), w = new THREE.Vector3(), fwdPrev = new THREE.Vector3(), fwd = new THREE.Vector3(), posPrev = new THREE.Vector3();
  const visibleChain = (o: THREE.Object3D | null) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
  const out: ShotAudit[] = [];
  let cur: ShotAudit | null = null;
  const acc = new Map<string, { a: ActorAudit; lastSprite: string; switches: number; area: number }>();
  const issue = (s: ShotAudit, level: Issue["level"], code: string, msg: string, f: number) => {
    const i = s.issues.find((x) => x.code === code && x.msg === msg);
    if (i) { i.last = f; i.frames++; if (level === "error") i.level = "error"; } else s.issues.push({ level, code, msg, first: f, last: f, frames: 1 });
  };
  const close = () => {
    if (!cur) return;
    const s = cur, n = s.b - s.a;
    let main: { a: ActorAudit; area: number } | null = null;
    for (const x of acc.values()) { s.actors.push(x.a); if (!main || x.area > main.area) main = x; if (x.switches > 0) issue(s, "error", "SPRITE_SWITCH", `${x.a.id}: hình vẽ đổi ${x.switches} lần trong một shot`, s.a); }
    if (main && main.area > 0) {
      const m = main.a; s.mainActor = m.id;
      // someone walking across the frame is expected to enter and leave through its edges: only a standing lead is held to the framing rules
      if (m.moving) { /* crossing the frame */ }
      else if (m.headOut / m.frames > 0.25) issue(s, "error", "HEAD_OUT", `${m.id}: đầu nhân vật chính ra ngoài khung ${m.headOut}/${m.frames} frame`, s.a);
      else if (s.kind !== "closeup" && m.cut / m.frames > 0.4) issue(s, "warn", "CUT", `${m.id}: nhân vật chính bị cắt ở mép khung ${m.cut}/${m.frames} frame`, s.a);
      if (m.occluded / m.frames > 0.25) issue(s, "error", "OCCLUDED", `${m.id}: mặt nhân vật chính bị che ${m.occluded}/${m.frames} frame`, s.a);
      if (s.kind === "medium" && m.screenH[1] < RULES.mediumMinH) issue(s, "warn", "SMALL", `${m.id}: trung cảnh nhưng nhân vật chỉ cao ${(m.screenH[1] * 100).toFixed(0)}% khung`, s.a);
      if (s.kind === "closeup" && m.screenH[1] < RULES.closeMinH) issue(s, "warn", "SMALL", `${m.id}: cận cảnh nhưng nhân vật chỉ cao ${(m.screenH[1] * 100).toFixed(0)}% khung`, s.a);
    }
    void n; out.push(s); cur = null; acc.clear();
  };
  for (let f = 0; f < tl.totalFrames; f++) {
    const st = frameState(tl, host, f, aspect, legacy);
    st.inst.update(st.ctx, st.cam);
    if (!cur || cur.id !== st.shot.id) { close(); cur = { id: st.shot.id, scene: st.shot.scene, camera: camLabel(st.shot), kind: st.info.kind, chars: st.info.chars, a: st.shot.a, b: st.shot.b, sec: +(st.shot.a / tl.fps).toFixed(2), roll: 0, camJump: 0, mainActor: null, actors: [], issues: [] }; }
    const s = cur;
    host.root.updateMatrixWorld(true);
    camObj.fov = st.cam.fov; camObj.aspect = aspect; camObj.near = 0.02; camObj.far = 4000;
    camObj.position.set(...st.cam.pos); camObj.up.set(0, 1, 0); camObj.lookAt(...st.cam.look); if (st.cam.roll) camObj.rotateZ(st.cam.roll);
    camObj.updateProjectionMatrix(); camObj.updateMatrixWorld(true);
    camObj.getWorldDirection(fwd);
    const kicking = st.ctx.actions.some((a) => a.name === "kick" && st.ctx.t - a.t >= -0.04 && st.ctx.t - a.t < 0.5);
    if (f > st.shot.a && !kicking) { const j = Math.max(deg(fwd.angleTo(fwdPrev)), (camObj.position.distanceTo(posPrev) / Math.max(0.05, camObj.position.distanceTo(v.set(...st.cam.look)))) * 57); s.camJump = Math.max(s.camJump, +j.toFixed(2)); if (j > RULES.jumpDeg) issue(s, "warn", "CAM_JUMP", "máy quay nhảy đột ngột giữa hai frame liền nhau", f); }
    fwdPrev.copy(fwd); posPrev.copy(camObj.position);
    const roll = Math.abs(deg(st.cam.roll ?? 0)); s.roll = Math.max(s.roll, +roll.toFixed(2));
    const actors: ActorInfo[] = st.inst.actors?.() ?? [];
    if (!st.info.chars && actors.length) issue(s, "error", "CHARS_IN_3D_ONLY", "góc máy chỉ dành cho bối cảnh 3D nhưng vẫn còn nhân vật 2D", f);
    for (const A of actors) {
      const feet = v.set(...A.pos).clone().project(camObj), top = w.set(A.pos[0], A.pos[1] + A.top, A.pos[2]).clone().project(camObj), head = new THREE.Vector3(A.pos[0], A.pos[1] + A.head, A.pos[2]);
      const hN = head.clone().project(camObj);
      if (hN.z > 1 || feet.z > 1) continue; // behind the camera
      // screen box of the card (0.56 m wide), in NDC
      const hw = Math.abs(top.y - feet.y) * (0.56 / A.top) / aspect / 2, x0 = feet.x - hw, x1 = feet.x + hw, y0 = Math.min(feet.y, top.y), y1 = Math.max(feet.y, top.y);
      const ov = Math.max(0, Math.min(1, x1) - Math.max(-1, x0)) * Math.max(0, Math.min(1, y1) - Math.max(-1, y0)), area = (x1 - x0) * (y1 - y0), vis = area > 0 ? ov / area : 0;
      if (vis < 0.05) continue;
      const screenH = (y1 - y0) / 2, dist = camObj.position.distanceTo(head);
      const pitch = deg(Math.atan2(st.cam.pos[1] - (A.pos[1] + A.head), Math.hypot(st.cam.pos[0] - A.pos[0], st.cam.pos[2] - A.pos[2])));
      const az = Math.atan2(st.cam.pos[0] - A.pos[0], st.cam.pos[2] - A.pos[2]), edge = Math.abs(deg(Math.atan2(Math.sin(az - A.yaw), Math.cos(az - A.yaw))));
      const headIn = Math.abs(hN.x) < 0.97 && Math.abs(hN.y) < 0.97;
      let occ = false;
      if (headIn) { ray.set(camObj.position, head.clone().sub(camObj.position).normalize()); ray.far = dist - 0.15;
        for (const h of ray.intersectObject(st.inst.root, true)) { const m = (h.object as THREE.Mesh).material as THREE.Material | THREE.Material[]; const mm = Array.isArray(m) ? m[0] : m; if (visibleChain(h.object) && mm && !(mm.transparent && mm.opacity < 0.9)) { occ = true; break; } } }
      let e = acc.get(A.id);
      if (!e) { e = { a: { id: A.id, sprite: A.sprite, moving: A.speed > 0, frames: 0, screenH: [9, 0], pitch: [99, -99], visible: [9, 0], headOut: 0, cut: 0, occluded: 0, edge: 0, minDist: 1e9, slip: 0 }, lastSprite: A.sprite, switches: 0, area: 0 }; acc.set(A.id, e); }
      const a = e.a; a.frames++; e.area += ov;
      a.screenH = [Math.min(a.screenH[0], +screenH.toFixed(3)), Math.max(a.screenH[1], +screenH.toFixed(3))];
      a.pitch = [Math.min(a.pitch[0], +pitch.toFixed(1)), Math.max(a.pitch[1], +pitch.toFixed(1))];
      a.visible = [Math.min(a.visible[0], +vis.toFixed(2)), Math.max(a.visible[1], +vis.toFixed(2))];
      a.edge = Math.max(a.edge, +edge.toFixed(1)); a.minDist = Math.min(a.minDist, +dist.toFixed(2));
      if (!headIn) a.headOut++; if (vis > RULES.cutLo && vis < RULES.cutHi) a.cut++; if (occ) a.occluded++;
      if (A.sprite !== e.lastSprite) { e.switches++; e.lastSprite = A.sprite; }
      const slip = A.sprite === "side" ? Math.abs(A.speed - A.stepSpeed) : A.speed; a.slip = Math.max(a.slip, +slip.toFixed(2));
      const big = screenH >= 0.05 && vis >= 0.25;
      if (big && roll > RULES.rollDeg) issue(s, "error", "ROLL", `máy quay nghiêng ${roll.toFixed(1)} độ khi có nhân vật 2D trong khung`, f);
      if (big && Math.abs(pitch) > RULES.pitchErr) issue(s, "error", "PITCH", `${A.id}: nhìn ${pitch > 0 ? "từ trên xuống" : "từ dưới lên"} quá dốc (vượt ${RULES.pitchErr} độ), thẻ nhân vật trông như tờ giấy`, f);
      else if (big && Math.abs(pitch) > (st.info.drama ? RULES.pitchDrama : RULES.pitchWarn)) issue(s, "warn", "PITCH", `${A.id}: góc nhìn lệch tầm mắt hơn ${st.info.drama ? RULES.pitchDrama : RULES.pitchWarn} độ`, f);
      if (big && edge > RULES.edgeDeg) issue(s, "error", "EDGE", `${A.id}: thẻ nhân vật không quay về máy quay (lệch ${edge.toFixed(0)} độ), lộ cạnh`, f);
      if (Math.abs(A.tilt) > 0.001 || Math.abs(A.pos[1]) > 0.01) issue(s, "error", "FLOAT", `${A.id}: nhân vật nghiêng hoặc rời mặt đất`, f);
      if (dist < RULES.minDist) issue(s, "error", "THROUGH", `${A.id}: máy quay đi sát hoặc xuyên qua nhân vật (${dist.toFixed(2)} m)`, f);
      if (big && A.sprite === "front" && A.speed > RULES.slideMs) issue(s, "error", "SLIDE", `${A.id}: hình chính diện nhưng đang trượt ngang ${A.speed.toFixed(1)} m/s`, f);
      if (big && A.sprite === "side" && A.speed > 0 && Math.abs(A.speed - A.stepSpeed) / A.speed > RULES.slipRel) issue(s, "warn", "SLIDE", `${A.id}: bước chân không khớp tốc độ di chuyển`, f);
      // a flat card only distorts under a wide lens near the frame edges (heroCam shoots wide on purpose, FEEDBACK_LOG #14)
      if (big && screenH > 0.5 && (dist < 1.3 || st.cam.fov > 62 || (st.cam.fov > 38 && Math.abs(feet.x) > 0.55))) issue(s, "warn", "DISTORT", `${A.id}: cận cảnh bằng ống kính rộng hoặc quá gần (${dist.toFixed(1)} m, fov ${st.cam.fov})`, f);
    }
  }
  close();
  return { rules: RULES, shots: out };
};
