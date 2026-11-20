// Generic episode renderer: one composition for every dish, format and aspect ratio. Everything story-specific
// arrives as data (timeline.json built by scripts/food.mjs); scenes come from the registry in src/scenes.
// Post chain kept from the bridge short: ink -> lens blur (pre + main) -> bloom -> NEUTRAL tone map -> grade, MSAA 4.
import React, { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { AbsoluteFill, Audio, CalculateMetadataFunction, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import { EffectComposer } from "@react-three/postprocessing";
import { BlendFunction, BloomEffect, ToneMappingEffect, ToneMappingMode } from "postprocessing";
import { InkPass, noInkFallback } from "../videos/bridge/ink";
import { LensBlur } from "../videos/bridge/lensblur";
import { GradeEffect, GRADES } from "../videos/bridge/grade";
import { Stage, loadKit, makeEnv, Loaded, CAM_NEAR, CAM_FAR } from "./stage";
import { Host, frameState, shotAt, auditTimeline } from "./direct";
import type { Env, SceneInst, Timeline } from "./types";

/** `audio` (a file under public/) is only passed by the `studio` command so the live preview has sound; renders stay silent and are muxed later */
export type EpisodeProps = { timeline: Timeline; mode?: "preview" | "final"; audio?: string; audit?: boolean; legacy?: boolean };
export const calcEpisode: CalculateMetadataFunction<EpisodeProps> = ({ props }) => ({
  durationInFrames: props.timeline.totalFrames, fps: props.timeline.fps, width: props.timeline.width, height: props.timeline.height,
});

const PAPER = "#f3e7d3";

const useKit = (assets: Record<string, string>) => {
  const [kit, setKit] = useState<Loaded | null>(null);
  const [handle] = useState(() => delayRender("asset kit"));
  useEffect(() => { loadKit(assets).then((k) => { setKit(k); continueRender(handle); }); }, [handle, assets]);
  return kit;
};

const Inner: React.FC<{ tl: Timeline; env: Env }> = ({ tl, env }) => {
  const f = useCurrentFrame();
  const { camera, scene } = useThree();
  const { width, height } = useVideoConfig();
  const cam = camera as THREE.PerspectiveCamera;
  const stage = useMemo(() => new Stage(), []);
  const host = useMemo(() => new Host(env), [env]);
  const fx = useMemo(() => {
    const bloom = new BloomEffect({ blendFunction: BlendFunction.ADD, intensity: 0.5, luminanceThreshold: 1.0, luminanceSmoothing: 0.2, mipmapBlur: true, levels: 6, radius: 0.6 });
    // the glow keeps the same size relative to the frame at any output size: the MIP chain starts at a fixed base height
    const mip = bloom.mipmapBlurPass, setSize = mip.setSize.bind(mip), baseH = height >= width ? 1920 : 1440;
    mip.setSize = (w: number, h: number) => setSize(Math.round((baseH * w) / Math.max(h, 1)), baseH);
    return { ink: new InkPass(scene, cam), lens: new LensBlur({ maxCoC: 24, nearScale: 1.2 }), bloom, tone: new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }), grade: new GradeEffect(GRADES.day, 1) };
  }, [cam, scene, width, height]);
  useEffect(() => () => fx.ink.dispose(), [fx]);
  const post = useMemo(() => (
    <EffectComposer multisampling={4}>
      <primitive object={fx.ink} dispose={null} />
      <primitive object={fx.lens.pre} dispose={null} />
      <primitive object={fx.lens.main} dispose={null} />
      <primitive object={fx.bloom} dispose={null} />
      <primitive object={fx.tone} dispose={null} />
      <primitive object={fx.grade} dispose={null} />
    </EffectComposer>
  ), [fx]);

  const st = frameState(tl, host, f, width / height), { shot, inst, ctx } = st, c = st.cam, ref = st.ref;
  inst.update(ctx, c);
  const light = (shot.light as SceneInst["light"] | null) ?? inst.light;
  const { grade } = stage.apply(shot.id, light, c, ref, cam, scene);
  noInkFallback(host.root);
  const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
  const fp = new THREE.Vector3(...(c.focus ?? c.look)).sub(cam.position);
  fx.lens.focus = Math.max(0.03, fp.dot(fwd));
  fx.lens.cInf = c.cInf ?? 0;
  const tag = fx.grade as unknown as { _g?: string };
  if (tag._g !== grade) { fx.grade.set(GRADES[grade]); tag._g = grade; }
  return (
    <>
      <primitive object={stage.root} dispose={null} />
      <primitive object={host.root} dispose={null} />
      {post}
    </>
  );
};

// ---------------------------------------------------------------- 2D overlays (captions, labels, legend frame)
const FONT = "'Segoe UI', 'Noto Sans', 'Helvetica Neue', Arial, sans-serif"; // covers Latin diacritics incl. Vietnamese, Polish, Turkish
const captionLines = (tl: Timeline, maxChars: number) => {
  const lines: { s: number; e: number; text: string }[] = [];
  let cur: { s: number; e: number; text: string } | null = null;
  for (const w of tl.words) {
    if (cur && (cur.text.length + 1 + w.t.length > maxChars || w.s - cur.e > 0.7)) { lines.push(cur); cur = null; }
    if (!cur) cur = { s: w.s, e: w.e, text: w.t }; else { cur.text += " " + w.t; cur.e = w.e; }
    if (/[.!?]["')\]]?$/.test(w.t)) { lines.push(cur); cur = null; }
  }
  if (cur) lines.push(cur);
  return lines;
};
const Captions: React.FC<{ tl: Timeline }> = ({ tl }) => {
  const f = useCurrentFrame(), { width, height } = useVideoConfig(), portrait = height > width, t = f / tl.fps;
  const lines = useMemo(() => captionLines(tl, portrait ? 26 : 44), [tl, portrait]);
  const line = lines.find((l) => t >= l.s - 0.05 && t <= l.e + 0.2);
  if (!line) return null;
  const size = Math.round(portrait ? width * 0.058 : height * 0.058);
  // safe areas: portrait keeps clear of the Shorts UI (bottom ~20 %, right ~12 %); landscape sits above the player bar
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: portrait ? height * 0.24 : height * 0.085, paddingLeft: width * 0.08, paddingRight: width * (portrait ? 0.14 : 0.08) }}>
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: size, lineHeight: 1.22, color: "#fffdf7", textAlign: "center", WebkitTextStroke: `${Math.max(2, size * 0.11)}px #241726`, paintOrder: "stroke fill", letterSpacing: 0.2 }}>{line.text}</div>
    </AbsoluteFill>
  );
};
const Label: React.FC<{ text: string }> = ({ text }) => {
  const { width, height } = useVideoConfig(), size = Math.round(Math.min(width, height) * 0.04);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-start", padding: `${height * 0.08}px ${width * 0.07}px` }}>
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: size, color: "#241726", background: PAPER, border: `${Math.max(2, size * 0.09)}px solid #241726`, borderRadius: size * 0.3, padding: `${size * 0.25}px ${size * 0.6}px` }}>{text}</div>
    </AbsoluteFill>
  );
};
/** Storybook treatment for shots that illustrate a LEGEND: sepia picture + soft paper vignette, so a re-enactment of
 *  an unproven story never looks like documented history. */
const LegendFrame: React.FC<{ tag: boolean }> = ({ tag }) => {
  const { width, height } = useVideoConfig(), m = Math.min(width, height), size = Math.round(m * 0.034);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ boxShadow: `inset 0 0 ${m * 0.13}px ${m * 0.02}px ${PAPER}`, border: `${m * 0.018}px solid ${PAPER}`, borderRadius: m * 0.05 }} />
      {tag ? <div style={{ position: "absolute", top: height * 0.08, right: width * 0.07, fontFamily: FONT, fontStyle: "italic", fontWeight: 700, fontSize: size, color: "#5a3b2a", background: PAPER, borderRadius: size * 0.3, padding: `${size * 0.2}px ${size * 0.6}px` }}>legend</div> : null}
    </AbsoluteFill>
  );
};

/** `audit: true` (camcheck command): no picture; walks every frame, measures the camera against every character card and prints the report */
const Audit: React.FC<{ tl: Timeline; env: Env; legacy: boolean }> = ({ tl, env, legacy }) => {
  const { width, height } = useVideoConfig();
  const [handle] = useState(() => delayRender("camera audit", { timeoutInMilliseconds: 900000 }));
  useEffect(() => {
    const json = JSON.stringify(auditTimeline(tl, env, width / height, legacy)), N = 6000, n = Math.ceil(json.length / N);
    for (let i = 0; i < n; i++) console.log(`CAMAUDIT ${i + 1}/${n} ${json.slice(i * N, (i + 1) * N)}`);
    continueRender(handle);
  }, [tl, env, width, height, handle, legacy]);
  return <AbsoluteFill style={{ background: PAPER }} />;
};

export const FoodEpisode: React.FC<EpisodeProps> = ({ timeline: tl, mode = "preview", audio, audit, legacy }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const assets = useMemo(() => tl.assets ?? {}, [tl]);
  const kit = useKit(assets);
  const env = useMemo(() => (kit ? makeEnv(kit) : null), [kit]);
  if (!env) return null;
  if (audit) return <Audit tl={tl} env={env} legacy={!!legacy} />;
  const shot = shotAt(tl, f), i = tl.shots.indexOf(shot), next = tl.shots[i + 1], D = 7;
  // "dip": a short dip to paper colour around the cut into a shot marked transition: "dip"
  const dipIn = shot.transition === "dip" ? Math.max(0, 1 - (f - shot.a + 1) / D) : 0;
  const dipOut = next && next.transition === "dip" ? Math.max(0, 1 - (shot.b - f) / D) : 0;
  const dip = Math.max(dipIn, dipOut);
  // "flash" action: a 5-frame white flash on a punch word. "whip": the outgoing picture streaks away, the incoming one settles
  const fl = tl.events.find((e) => e.type === "action" && e.name === "flash" && f >= e.frame && f < e.frame + 5);
  const flash = fl ? [1, 0.8, 0.5, 0.28, 0.1][f - fl.frame] : 0;
  const WH = 4, whipIn = shot.transition === "whip" && f - shot.a < WH ? 1 - (f - shot.a) / WH : 0, whipOut = next && next.transition === "whip" && shot.b - f <= WH ? 1 - (shot.b - f - 1) / WH : 0, whip = Math.max(whipIn, whipOut);
  const filters = [shot.legend ? "sepia(0.6) saturate(0.85) contrast(0.96)" : "", whip > 0 ? `blur(${(whip * height * 0.02).toFixed(1)}px)` : ""].filter(Boolean).join(" ");
  const draft = mode !== "final" && (tl.timing === "estimated" || tl.placeholders.length > 0);
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <AbsoluteFill style={{ filter: filters || undefined, transform: whip > 0 ? `translateX(${((whipIn - whipOut) * 16).toFixed(2)}%) scale(${(1 + 0.34 * whip).toFixed(3)})` : undefined }}>
        <ThreeCanvas width={width} height={height} shadows gl={{ antialias: false, stencil: false, powerPreference: "high-performance", toneMappingExposure: 1.0 }} camera={{ fov: 35, near: CAM_NEAR, far: CAM_FAR }}>
          <Inner tl={tl} env={env} />
        </ThreeCanvas>
      </AbsoluteFill>
      {shot.legend ? <LegendFrame tag={tl.labels} /> : null}
      {tl.labels && shot.label ? <Label text={shot.label.text} /> : null}
      {dip > 0 ? <AbsoluteFill style={{ background: PAPER, opacity: dip }} /> : null}
      {flash > 0 ? <AbsoluteFill style={{ background: "#ffffff", opacity: flash }} /> : null}
      {audio ? <Audio src={staticFile(audio)} /> : null}
      {tl.captions ? <Captions tl={tl} /> : null}
      {draft ? <div style={{ position: "absolute", left: width * 0.03, bottom: height * 0.02, fontFamily: FONT, fontSize: Math.min(width, height) * 0.022, color: "#241726", background: "#ffffffb0", padding: "2px 10px", borderRadius: 6 }}>
        DRAFT{tl.timing === "estimated" ? " · estimated timing" : ""}{tl.placeholders.length ? " · placeholder assets" : ""}</div> : null}
    </AbsoluteFill>
  );
};
