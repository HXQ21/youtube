// Character sheet rendered by the SAME drawing code the episodes use (toon.ts via people.ts): front expressions,
// working hands, and the side walk cycle. Used to check a new or changed cast member against its reference sheet.
//   node scripts/cast-sheet.mjs --who chef [--v 0]
import { useEffect, useRef, useState } from "react";
import { AbsoluteFill, continueRender, delayRender } from "remotion";
import { Pen, bodySide, Expr } from "../videos/bridge/toon";
import { drawPerson, outfitFor, heldRoll, Who } from "../scenes/people";

export type CastProps = { who: Who; v: number };
const SU = 0.00216, toC = (h: [number, number]): [number, number] => [300 + h[0] / SU, 975 - h[1] / SU];
type Cell = { label: string; draw: (p: Pen) => void };

export const CastSheet: React.FC<CastProps> = ({ who, v }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [handle] = useState(() => delayRender("cast sheet"));
  useEffect(() => {
    const cv = ref.current!, g = cv.getContext("2d")!, of = outfitFor(who, v);
    g.fillStyle = "#f6efe2"; g.fillRect(0, 0, cv.width, cv.height);
    const face = (expr: Expr, extra = {}): Cell => ({ label: expr, draw: (p) => drawPerson(p, { who, v, expr, mode: "stand", ...extra }) });
    const hands = (label: string, h: [[number, number] | null, [number, number] | null], expr: Expr, hold?: boolean): Cell => ({ label, draw: (p) => {
      const hh = h.map((x) => (x ? toC(x) : null)) as [[number, number] | null, [number, number] | null];
      drawPerson(p, { who, v, expr, mode: "stand", hands: hh });
      if (hold && hh[1]) heldRoll(p, hh[1][0], hh[1][1], true);
    } });
    const walk = (phase: number): Cell => ({ label: `walk ${phase}`, draw: (p) => bodySide(p, of, { mode: "march", phase, stride: 0.72, stomp: 0.75, expr: "neutral", seed: v * 3 + 1 }) });
    const rows: Cell[][] = [
      [face("neutral"), face("smile" as Expr), face("grin"), face("shock"), face("nervous"), face("stern"), face("laugh")],
      [hands("knead", [[-0.12, 1.0], [0.12, 1.0]], "neutral"), hands("peel", [[0.1, 0.98], [0.34, 0.94]], "smile_closed" as Expr), hands("offer", [[-0.2, 1.02], [0.42, 1.4]], "smile" as Expr, true),
        hands("cheeks", [[-0.3, 1.3], [0.3, 1.3]], "shock"), walk(0), walk(0.25), walk(0.5)],
    ];
    const cw = 600, ch = 1000, k = 0.42, gx = 18, gy = 60;
    rows.forEach((row, r) => row.forEach((c, i) => {
      g.save(); g.translate(gx + i * (cw * k + gx), gy + r * (ch * k + gy)); g.scale(k, k); c.draw(new Pen(g)); g.restore();
      g.fillStyle = "#5a4a3a"; g.font = "bold 22px Segoe UI, sans-serif"; g.fillText(c.label, gx + i * (cw * k + gx) + 8, gy + r * (ch * k + gy) - 14);
    }));
    g.fillStyle = "#3a2a20"; g.font = "bold 30px Segoe UI, sans-serif"; g.fillText(`${who} v${v}: drawn by toon.ts (the video's own character code)`, 18, cv.height - 22);
    continueRender(handle);
  }, [who, v, handle]);
  return <AbsoluteFill style={{ background: "#f6efe2" }}><canvas ref={ref} width={1920} height={1080} style={{ width: "100%", height: "100%" }} /></AbsoluteFill>;
};
