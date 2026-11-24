// Captions from the word timings of the voice.
//   chunks (Shorts, decided 2026-11-24): 1-3 words at a time, cut at punctuation and at pauses, so the eye keeps up with a
//            muted viewer and names / dates are readable
//   lines  (long format): up to `maxChars` characters per line, cut at sentence ends and pauses
import type { Timeline } from "./types";

export type Cap = { s: number; e: number; text: string };
const END = /[.!?…]["')\]]?$/, BREAK = /[,;:—–]["')\]]?$/;

export const captionChunks = (words: Timeline["words"], maxWords = 3, maxChars = 18, gap = 0.35): Cap[] => {
  const out: Cap[] = [];
  let cur: (Cap & { n: number }) | null = null;
  for (const w of words) {
    if (cur && (cur.n >= maxWords || cur.text.length + 1 + w.t.length > maxChars || w.s - cur.e > gap)) { out.push(cur); cur = null; }
    if (!cur) cur = { s: w.s, e: w.e, text: w.t, n: 1 };
    else { cur.text += " " + w.t; cur.e = w.e; cur.n += 1; }
    if (END.test(w.t) || BREAK.test(w.t)) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  // hold each chunk until the next one starts (no flicker in between), at most 0.4 s past its last word
  return out.map((c, i) => ({ s: c.s, e: Math.min(out[i + 1]?.s ?? c.e + 0.4, c.e + 0.4), text: c.text }));
};

export const captionLines = (words: Timeline["words"], maxChars: number): Cap[] => {
  const lines: Cap[] = [];
  let cur: Cap | null = null;
  for (const w of words) {
    if (cur && (cur.text.length + 1 + w.t.length > maxChars || w.s - cur.e > 0.7)) { lines.push(cur); cur = null; }
    if (!cur) cur = { s: w.s, e: w.e, text: w.t }; else { cur.text += " " + w.t; cur.e = w.e; }
    if (END.test(w.t)) { lines.push(cur); cur = null; }
  }
  if (cur) lines.push(cur);
  return lines.map((l) => ({ ...l, e: l.e + 0.2 }));
};
