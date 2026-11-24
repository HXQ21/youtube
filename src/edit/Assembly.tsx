// The film assembly (2026-11-24, no three.js): the picture comes from finished clips (Blender layout renders or the
// Seedance re-renders made from them); this composition only lays them on the voice timeline and draws the 2D layer:
// transitions (cut / dip / whip / dissolve + flash events), the legend storybook frame, place-and-date labels,
// captions (Shorts: 1-3 word chunks; long: lines) and a DRAFT badge. Sound is mixed separately and muxed later.
import React, { useMemo } from "react";
import { AbsoluteFill, Audio, CalculateMetadataFunction, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { captionChunks, captionLines } from "./captions";
import type { Picture, Timeline, TLShot } from "./types";

export type AssemblyProps = { timeline: Timeline; pictures: Picture[]; mode?: "preview" | "final"; audio?: string };
export const calcAssembly: CalculateMetadataFunction<AssemblyProps> = ({ props }) => ({
  durationInFrames: props.timeline.totalFrames, fps: props.timeline.fps, width: props.timeline.width, height: props.timeline.height,
});

const PAPER = "#f3e7d3", INK = "#241726";
const FONT = "'Segoe UI', 'Noto Sans', 'Helvetica Neue', Arial, sans-serif";
const DIP = 7, WHIP = 4, DISSOLVE = 12;
const src = (s: string) => (/^https?:/.test(s) ? s : staticFile(s));
export const shotAt = (tl: Timeline, f: number): TLShot => tl.shots.find((s) => f >= s.a && f < s.b) ?? tl.shots[tl.shots.length - 1];

/** opacity of picture `p` at frame f: 1 inside it; a dissolve into / out of it overlaps the neighbour by DISSOLVE frames */
const pictureAlpha = (tl: Timeline, p: Picture, f: number) => {
  const end = p.from + p.frames, into = shotAt(tl, p.from), after = tl.shots.find((s) => s.a === end);
  if (into.transition === "dissolve" && f < p.from + DISSOLVE / 2) return Math.max(0, Math.min(1, (f - (p.from - DISSOLVE / 2)) / DISSOLVE));
  if (after?.transition === "dissolve" && f >= end - DISSOLVE / 2) return Math.max(0, Math.min(1, 1 - (f - (end - DISSOLVE / 2)) / DISSOLVE));
  return 1;
};

const Captions: React.FC<{ tl: Timeline }> = ({ tl }) => {
  const f = useCurrentFrame(), { width, height } = useVideoConfig(), portrait = height > width, t = f / tl.fps, short = tl.format === "short";
  const caps = useMemo(() => (short ? captionChunks(tl.words) : captionLines(tl.words, portrait ? 26 : 44)), [tl, short, portrait]);
  const c = caps.find((x) => t >= x.s - 0.03 && t < x.e);
  if (!c) return null;
  const size = Math.round((portrait ? width : height) * (short ? 0.082 : 0.058));
  const pop = short ? Math.min(1, (t - c.s + 0.03) / 0.08) : 1;   // a quick pop-in for each chunk
  // safe areas: portrait keeps clear of the Shorts UI (bottom ~20 %, right ~12 %); landscape sits above the player bar
  return (
    <AbsoluteFill style={{ justifyContent: short ? "center" : "flex-end", alignItems: "center", paddingTop: short ? height * 0.3 : 0,
      paddingBottom: short ? 0 : portrait ? height * 0.24 : height * 0.085, paddingLeft: width * 0.08, paddingRight: width * (portrait ? 0.14 : 0.08) }}>
      <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: size, lineHeight: 1.15, color: "#fffdf7", textAlign: "center", transform: `scale(${(0.86 + 0.14 * pop).toFixed(3)})`,
        WebkitTextStroke: `${Math.max(2, size * 0.12)}px ${INK}`, paintOrder: "stroke fill", letterSpacing: 0.3 }}>{c.text}</div>
    </AbsoluteFill>
  );
};

const Label: React.FC<{ text: string }> = ({ text }) => {
  const { width, height } = useVideoConfig(), size = Math.round(Math.min(width, height) * 0.04);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-start", padding: `${height * 0.08}px ${width * 0.07}px` }}>
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: size, color: INK, background: PAPER, border: `${Math.max(2, size * 0.09)}px solid ${INK}`, borderRadius: size * 0.3, padding: `${size * 0.25}px ${size * 0.6}px` }}>{text}</div>
    </AbsoluteFill>
  );
};

/** storybook treatment for shots that illustrate a LEGEND, so a re-enactment of an unproven story never looks like documented history */
const LegendFrame: React.FC<{ tag: boolean }> = ({ tag }) => {
  const { width, height } = useVideoConfig(), m = Math.min(width, height), size = Math.round(m * 0.034);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ boxShadow: `inset 0 0 ${m * 0.13}px ${m * 0.02}px ${PAPER}`, border: `${m * 0.018}px solid ${PAPER}`, borderRadius: m * 0.05 }} />
      {tag ? <div style={{ position: "absolute", top: height * 0.08, right: width * 0.07, fontFamily: FONT, fontStyle: "italic", fontWeight: 700, fontSize: size, color: "#5a3b2a", background: PAPER, borderRadius: size * 0.3, padding: `${size * 0.2}px ${size * 0.6}px` }}>legend</div> : null}
    </AbsoluteFill>
  );
};

export const FoodAssembly: React.FC<AssemblyProps> = ({ timeline: tl, pictures, mode = "preview", audio }) => {
  const f = useCurrentFrame(), { width, height } = useVideoConfig();
  const shot = shotAt(tl, f), i = tl.shots.indexOf(shot), next = tl.shots[i + 1];
  const dip = Math.max(shot.transition === "dip" ? Math.max(0, 1 - (f - shot.a + 1) / DIP) : 0, next && next.transition === "dip" ? Math.max(0, 1 - (shot.b - f) / DIP) : 0);
  const fl = tl.events.find((e) => e.type === "action" && e.name === "flash" && f >= e.frame && f < e.frame + 5);
  const flash = fl ? [1, 0.8, 0.5, 0.28, 0.1][f - fl.frame] : 0;
  const whipIn = shot.transition === "whip" && f - shot.a < WHIP ? 1 - (f - shot.a) / WHIP : 0;
  const whipOut = next && next.transition === "whip" && shot.b - f <= WHIP ? 1 - (shot.b - f - 1) / WHIP : 0, whip = Math.max(whipIn, whipOut);
  const filters = [shot.legend ? "sepia(0.6) saturate(0.85) contrast(0.96)" : "", whip > 0 ? `blur(${(whip * height * 0.02).toFixed(1)}px)` : ""].filter(Boolean).join(" ");
  const draft = mode !== "final" && (tl.timing === "estimated" || tl.placeholders.length > 0 || pictures.length === 0);
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <AbsoluteFill style={{ filter: filters || undefined, transform: whip > 0 ? `translateX(${((whipIn - whipOut) * 16).toFixed(2)}%) scale(${(1 + 0.34 * whip).toFixed(3)})` : undefined }}>
        {pictures.map((p, k) => {
          const pre = shotAt(tl, p.from).transition === "dissolve" ? DISSOLVE / 2 : 0, post = tl.shots.find((s) => s.a === p.from + p.frames)?.transition === "dissolve" ? DISSOLVE / 2 : 0;
          const a = Math.max(0, p.from - pre), dur = p.frames + (p.from - a) + post;
          return (
            <Sequence key={k} from={a} durationInFrames={dur} layout="none">
              <AbsoluteFill style={{ opacity: pictureAlpha(tl, p, f) }}>
                <OffthreadVideo src={src(p.src)} startFrom={Math.max(0, (p.start ?? 0) - (p.from - a))} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </AbsoluteFill>
            </Sequence>
          );
        })}
      </AbsoluteFill>
      {shot.legend ? <LegendFrame tag={tl.labels} /> : null}
      {tl.labels && shot.label ? <Label text={shot.label.text} /> : null}
      {dip > 0 ? <AbsoluteFill style={{ background: PAPER, opacity: dip }} /> : null}
      {flash > 0 ? <AbsoluteFill style={{ background: "#ffffff", opacity: flash }} /> : null}
      {audio ? <Audio src={staticFile(audio)} /> : null}
      {tl.captions ? <Captions tl={tl} /> : null}
      {draft ? <div style={{ position: "absolute", left: width * 0.03, bottom: height * 0.02, fontFamily: FONT, fontSize: Math.min(width, height) * 0.022, color: INK, background: "#ffffffb0", padding: "2px 10px", borderRadius: 6 }}>
        DRAFT{tl.timing === "estimated" ? " · estimated timing" : ""}{tl.placeholders.length ? " · placeholder assets" : ""}{pictures.length === 0 ? " · no picture yet" : ""}</div> : null}
    </AbsoluteFill>
  );
};
