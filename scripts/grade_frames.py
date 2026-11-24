# Apply the three.js colour grade (src/videos/bridge/grade.ts GradeEffect) to rendered frames, so a Blender render
# ends with exactly the same look as the episode renderer.
#   python scripts/grade_frames.py <scene.json> <in_dir> <out_dir>
# scene.json comes from `scripts/blender.mjs export` and carries `grade` (the FOOD_GRADES preset of the shot's light).
# The math mirrors the GLSL: on display-encoded (sRGB) values
#   1. per-channel monotone cubic Hermite curve through 7 knots at x = 0, .1, .25, .5, .75, .9, 1 (Fritsch-Carlson tangents)
#   2. saturation around Y' (Rec.709), blended shadows / mids / highlights
#   3. split tone: zero-luma (Cb, Cr) offsets per zone
#   4. vignette x (1 - k * smoothstep(r0, 1, r)), r = elliptical radius, corners = 1
# Before the grade, a bloom like the episode's BloomEffect (glow around fire, windows, lamps): the brightest parts are
# blurred at three sizes (relative to the frame height, so it looks the same at any size) and added back.
import json, os, sys
import numpy as np
from PIL import Image, ImageFilter

KX = np.array([0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0])
W = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
E_CB = np.array([0.0, -0.18733, 1.8556], dtype=np.float32)
E_CR = np.array([1.5748, -0.46813, 0.0], dtype=np.float32)


def mono_tangents(ky):
    n = len(KX)
    h = [KX[k + 1] - KX[k] for k in range(n - 1)]
    d = [(ky[k + 1] - ky[k]) / h[k] for k in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = d[0], d[-1]
    for k in range(1, n - 1):
        if d[k - 1] * d[k] <= 0:
            m[k] = 0.0
            continue
        w1, w2 = 2 * h[k] + h[k - 1], h[k] + 2 * h[k - 1]
        m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k])
    return m


def curve(v, ky, km):
    v = np.clip(v, 0, 1)
    out = np.empty_like(v)
    for k in range(len(KX) - 1):
        x0, x1 = KX[k], KX[k + 1]
        sel = (v >= x0) & ((v < x1) if k < len(KX) - 2 else (v <= x1))
        if not sel.any():
            continue
        hh = x1 - x0
        t = (v[sel] - x0) / hh
        t2, t3 = t * t, t * t * t
        out[sel] = (2 * t3 - 3 * t2 + 1) * ky[k] + (t3 - 2 * t2 + t) * hh * km[k] + (-2 * t3 + 3 * t2) * ky[k + 1] + (t3 - t2) * hh * km[k + 1]
    return out


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def bloom(a, threshold=0.8, intensity=0.45):
    """three.js BloomEffect (intensity .5, luminance threshold 1.0 before tone mapping), in display space"""
    h = a.shape[0]
    y = a @ W
    k = np.clip((y - threshold) / (1 - threshold), 0, 1)[..., None]
    hi = Image.fromarray((np.clip(a * k, 0, 1) * 255).astype(np.uint8))
    acc = np.zeros_like(a)
    for frac, wgt in ((0.006, 0.5), (0.018, 0.35), (0.045, 0.25)):
        acc += wgt * np.asarray(hi.filter(ImageFilter.GaussianBlur(max(1, h * frac))), dtype=np.float32) / 255.0
    return np.clip(a + intensity * acc, 0, 1)


def grade(img, g):
    a = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    a = bloom(a)
    ky, km = g["ky"], mono_tangents(g["ky"])
    c = curve(a, ky, km)
    y = c @ W
    wS = 1 - smoothstep(0.0, 0.55, y)
    wH = smoothstep(0.45, 1.0, y)
    wM = 1 - wS - wH
    s0, s1, s2 = g["sat"]
    s = s1 + (s0 - s1) * wS + (s2 - s1) * wH
    c = y[..., None] + s[..., None] * (c - y[..., None])
    tint = lambda cbcr: cbcr[0] * E_CB + cbcr[1] * E_CR
    c = c + wS[..., None] * tint(g["tintS"]) + wM[..., None] * tint(g["tintM"]) + wH[..., None] * tint(g["tintH"])
    h, w = y.shape
    yy, xx = np.mgrid[0:h, 0:w]
    px, py = (xx + 0.5) / w * 2 - 1, (yy + 0.5) / h * 2 - 1
    r = np.sqrt(px * px + py * py) * 0.70710678
    k, r0 = g["vig"]
    c = c * (1 - k * smoothstep(r0, 1.0, r))[..., None]
    return Image.fromarray((np.clip(c, 0, 1) * 255 + 0.5).astype(np.uint8))


def main():
    scene, src, dst = sys.argv[1:4]
    g = json.load(open(scene, encoding="utf-8")).get("grade")
    if not g:
        raise SystemExit("scene.json has no grade: re-run `blender.mjs export`")
    os.makedirs(dst, exist_ok=True)
    files = sorted(f for f in os.listdir(src) if f.lower().endswith(".png"))
    for f in files:
        grade(Image.open(os.path.join(src, f)), g).save(os.path.join(dst, f))
    print(f"graded {len(files)} frames with '{g.get('key')}'")


if __name__ == "__main__":
    main()
