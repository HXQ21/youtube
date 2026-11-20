// Hands one stretch of an episode to Blender (scripts/blender.mjs export). Walks frames a..b with the SAME direction
// code the renderer uses (frameState + scene.update) and POSTs to the local sink started by the script:
//   set.glb        the shot's set: every mesh that is visible at some frame of the clip, named m<i> (traversal order)
//   cards/c<n>.png every distinct picture painted on a character card during the clip
//   scene.json     per frame: camera, the world matrix + visibility of every mesh that moves, and the cards on screen
//                  (picture + world matrix); plus the light preset and the frozen sun direction of the shot
// Matrices are three.js world matrices (Y up); the Blender scripts convert them to Z up.
import { useEffect, useState } from "react";
import * as THREE from "three";
import { AbsoluteFill, continueRender, delayRender, useVideoConfig } from "remotion";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { loadKit, makeEnv, CARDS, FOOD_LIGHTS, FOOD_SKY } from "./stage";
import { Host, frameState } from "./direct";
import type { Timeline } from "./types";

export type BlenderExportProps = { timeline: Timeline; a: number; b: number; sink: string };

const visibleChain = (o: THREE.Object3D | null) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
const same = (p: number[] | null, q: number[] | null) => { if (!p || !q) return p === q; for (let i = 0; i < 16; i++) if (Math.abs(p[i] - q[i]) > 1e-6) return false; return true; };
const r6 = (m: number[]) => m.map((x) => Math.round(x * 1e6) / 1e6);

export const BlenderExport: React.FC<BlenderExportProps> = ({ timeline: tl, a, b, sink }) => {
  const { width, height } = useVideoConfig();
  const [handle] = useState(() => delayRender("blender export", { timeoutInMilliseconds: 900000 }));
  useEffect(() => {
    const post = async (name: string, body: Blob | string) => { const r = await fetch(`${sink}/${name}`, { method: "POST", body }); if (!r.ok) throw new Error(`sink ${name}: ${r.status}`); };
    (async () => {
      const env = makeEnv(await loadKit(tl.assets ?? {})), host = new Host(env), aspect = width / height;
      const first = frameState(tl, host, a, aspect), sceneId = first.shot.scene;
      first.inst.update(first.ctx, first.cam);
      const root = first.inst.root; root.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [], cards: THREE.Mesh[] = [];
      root.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; if (CARDS.has(m)) cards.push(m); else meshes.push(m); });
      meshes.forEach((m, i) => { m.name = `m${i}`; });
      const track: (number[] | null)[][] = meshes.map(() => []);
      const cardFiles = new Map<string, string>(), cardTrack: ({ file: string; m: number[] } | null)[][] = cards.map(() => []);
      const box = cards.map((c) => { c.geometry.computeBoundingBox(); const bb = c.geometry.boundingBox!; return [bb.min.x, bb.min.y, bb.max.x, bb.max.y]; });
      const frames: { f: number; shot: string; cam: unknown }[] = [];
      for (let f = a; f <= b; f++) {
        const st = frameState(tl, host, f, aspect);
        if (st.shot.scene !== sceneId) throw new Error(`frame ${f}: the clip must stay in one scene (${sceneId}), found ${st.shot.scene}`);
        st.inst.update(st.ctx, st.cam); root.updateMatrixWorld(true);
        frames.push({ f, shot: st.shot.id, cam: st.cam });
        meshes.forEach((m, i) => track[i].push(visibleChain(m) ? r6(m.matrixWorld.toArray()) : null));
        for (let i = 0; i < cards.length; i++) {
          const c = cards[i], card = CARDS.get(c)!;
          if (!visibleChain(c)) { cardTrack[i].push(null); continue; }
          let file = cardFiles.get(card.drawKey);
          if (!file) { file = `cards/c${cardFiles.size}.png`; cardFiles.set(card.drawKey, file); await post(file, await card.png()); }
          cardTrack[i].push({ file, m: r6(c.matrixWorld.toArray()) });
        }
      }
      // static = same matrix on every frame; dynamic = moves or blinks in/out; never shown = left out of the set
      const dynamic: Record<string, (number[] | null)[]> = {}, statics: string[] = [], ever = new Set<THREE.Mesh>();
      meshes.forEach((m, i) => {
        const t = track[i]; if (t.every((x) => x === null)) return;
        ever.add(m); if (t.every((x) => same(x, t[0]))) statics.push(m.name); else dynamic[m.name] = t;
      });
      // set.glb at the first frame's pose: every mesh shown at some point, no cards
      first.inst.update(first.ctx, first.cam); root.updateMatrixWorld(true);
      const keep = new Map<THREE.Object3D, boolean>(); root.traverse((o) => keep.set(o, o.visible));
      root.traverse((o) => { const m = o as THREE.Mesh; o.visible = m.isMesh ? ever.has(m) : true; });
      cards.forEach((c) => { c.visible = false; });
      const glb = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true }) as ArrayBuffer;
      for (const [o, v] of keep) o.visible = v;
      await post("set.glb", new Blob([glb]));
      // light: the preset and the sun direction frozen for this shot, exactly as Stage.apply computes it
      const light = (first.shot.light ?? first.inst.light) as keyof typeof FOOD_LIGHTS, P = FOOD_LIGHTS[light], K = FOOD_SKY[light], ref = first.ref;
      const fx = ref.look[0] - ref.pos[0], fz = ref.look[2] - ref.pos[2], n = Math.hypot(fx, fz) || 1, az = THREE.MathUtils.degToRad(P.az), el = THREE.MathUtils.degToRad(P.el);
      const ux = fx / n, uz = fz / n, hx = ux * Math.cos(az) - uz * Math.sin(az), hz = uz * Math.cos(az) + ux * Math.sin(az);
      const sunDir = new THREE.Vector3(hx * Math.cos(el), Math.sin(el), hz * Math.cos(el)).normalize().toArray();
      // emitters: meshes with an unlit material (windows, lamp glass, fire) light the room in Blender
      const emit = meshes.filter((m) => ever.has(m) && (Array.isArray(m.material) ? m.material : [m.material]).some((x) => (x as THREE.MeshBasicMaterial).isMeshBasicMaterial)).map((m) => m.name);
      const json = {
        version: 1, scene: sceneId, fps: tl.fps, width, height, a, b, frames,
        light: { name: light, ...P, skyGrad: K.c, sunDir }, emit, statics, dynamic,
        cards: cards.map((c, i) => ({ id: `card${i}`, box: box[i], track: cardTrack[i] })).filter((c) => c.track.some((x) => x)),
      };
      await post("scene.json", JSON.stringify(json));
      continueRender(handle);
    })().catch((e) => { console.error(`BLENDER_EXPORT_ERROR ${e?.stack ?? e}`); continueRender(handle); });
  }, [tl, a, b, sink, width, height, handle]);
  return <AbsoluteFill style={{ background: "#f3e7d3" }} />;
};
