"""Exposure check for one Blender guide (2026-11-25, FEEDBACK_LOG #24): Seedance follows the guide closely, so a
washed-out or crushed guide gives a washed-out or crushed paid clip. Measured on the story part at 2 fps.
    python scripts/qa/guide_check.py <guide.mp4> <story seconds> <day|night|golden>
Prints one JSON line: {"mean", "p10", "blown", "black", "sat", "warn": [...]}. Targets come from the channel
measurements in FEEDBACK_LOG #19 (day 0.49 mean / 0.20 p10, night 0.27 / 0.11, saturation ~0.35-0.5)."""
import json, subprocess, sys
import numpy as np

LIMITS = {   # mean (lo, hi), p10 min, blown max, black max, saturation max
    "day": ((0.35, 0.70), 0.08, 0.03, 0.10, 0.60),
    "golden": ((0.30, 0.70), 0.06, 0.03, 0.12, 0.65),
    "night": ((0.18, 0.45), 0.03, 0.02, 0.25, 0.60),
}


def main():
    video, sec, light = sys.argv[1], float(sys.argv[2]), sys.argv[3]
    light = light if light in LIMITS else "day"
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-t", f"{sec:.3f}", "-vf", "fps=2,scale=180:320", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         capture_output=True, check=True).stdout
    fr = np.frombuffer(raw, np.uint8).reshape(-1, 320, 180, 3).astype(np.float32) / 255
    g = fr.mean(axis=3)
    mx, mn = fr.max(axis=3), fr.min(axis=3)
    sat = np.where(mx > 1e-3, (mx - mn) / np.maximum(mx, 1e-3), 0)
    m = {"mean": float(g.mean()), "p10": float(np.percentile(g, 10)), "blown": float((g > 0.97).mean()),
         "black": float((g < 0.04).mean()), "sat": float(sat.mean())}
    (lo, hi), p10, blown, black, smax = LIMITS[light]
    warn = []
    if m["mean"] > hi: warn.append(f"quá sáng (trung bình {m['mean']:.2f} > {hi})")
    if m["mean"] < lo: warn.append(f"quá tối (trung bình {m['mean']:.2f} < {lo})")
    if m["blown"] > blown: warn.append(f"cháy trắng {m['blown'] * 100:.0f} % khung")
    if m["black"] > black: warn.append(f"đen kịt {m['black'] * 100:.0f} % khung")
    if m["p10"] < p10: warn.append(f"vùng tối mất chi tiết (p10 {m['p10']:.2f})")
    if m["sat"] > smax: warn.append(f"màu quá gắt (bão hòa {m['sat']:.2f})")
    print(json.dumps({**{k: round(v, 3) for k, v in m.items()}, "light": light, "warn": warn}))   # ASCII escapes: safe on any console code page


if __name__ == "__main__":
    main()
