# The channel's flat 2D cast, drawn with the Grease Pencil pen (blender/draw/pen.py). A faithful port of the parts of
# src/videos/bridge/toon.ts the food episodes use: superellipse bean heads, bean torsos, single-stroke limbs with ink-dot
# hands, thick-thin plum outline weighted away from the light, painted crescents (now cel steps), deadpan faces, hats.
# Design space 600 x 1000 units, y DOWN, soles at y = 975. Not ported (bridge short only): rifle, sword, held props,
# the swing / push / sit / fall poses and the 2D effects.
import math
from pen import INK, rad, ell_pts

SKIN = "#ffe2c2"
WHITE = "#ffffff"
MOUTH = "#5a1e28"
TONGUE = "#e86e78"
SH_SKIN = (0.96, 0.86, 0.84)
SH_CLOTH = (0.64, 0.66, 0.74)
SH_FELT = (0.62, 0.62, 0.7)
SKINS = [SKIN, "#f5c9a0", "#ecd0b6", "#c99067"]


def clamp(x, a, b):
    return max(a, min(b, x))


def _rgb(c):
    n = int(c[1:], 16)
    return (n >> 16) & 255, (n >> 8) & 255, n & 255


def mul(c, m):
    r, g, b = _rgb(c)
    ch = lambda v, k: f"{min(255, round(v * k)):02x}"
    return f"#{ch(r, m[0])}{ch(g, m[1])}{ch(b, m[2])}"


def shade(c, k):
    return mul(c, (k, k, k))


def mix(a, b, t):
    A, B = _rgb(a), _rgb(b)
    return "#" + "".join(f"{round(x * (1 - t) + y * t):02x}" for x, y in zip(A, B))


def rnd(seed, k):
    x = math.sin(seed * 127.1 + k * 311.7) * 43758.5453
    return x - math.floor(x)


def rot_pts(pts, a, cx, cy):
    c, s = math.cos(a), math.sin(a)
    return [(cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c) for x, y in pts]


def rot_about(q, a, c):
    return rot_pts([q], a, c[0], c[1])[0]


def lerp2(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def curve(a, k, b, n=10):
    c = (2 * k[0] - (a[0] + b[0]) / 2, 2 * k[1] - (a[1] + b[1]) / 2)
    out = []
    for i in range(n + 1):
        t = i / n
        s = 1 - t
        out.append((s * s * a[0] + 2 * s * t * c[0] + t * t * b[0], s * s * a[1] + 2 * s * t * c[1] + t * t * b[1]))
    return out


def _sign(x):
    return (x > 0) - (x < 0)


def taper(p, a, b, wa, wb, col=INK):
    dx, dy = b[0] - a[0], b[1] - a[1]
    l = math.hypot(dx, dy) or 1
    nx, ny = -dy / l, dx / l
    p.poly([(a[0] + nx * wa / 2, a[1] + ny * wa / 2), (b[0] + nx * wb / 2, b[1] + ny * wb / 2),
            (b[0] - nx * wb / 2, b[1] - ny * wb / 2), (a[0] - nx * wa / 2, a[1] - ny * wa / 2)], col, 0)
    p.dot(a[0], a[1], wa / 2, col)
    p.dot(b[0], b[1], wb / 2, col)


# ---------------- contours
def blob(a, b, nTop, nBot, egg, asym, rot, noise, seed):
    return dict(a=a, b=b, nTop=nTop, nBot=nBot, egg=egg, asym=asym, rot=rot, noise=noise, seed=seed)


def blob_pts(cx, cy, B, n=72):
    ph = [rnd(B["seed"], k) * math.pi * 2 for k in (11, 12, 13)]
    pts = []
    for i in range(n):
        t = i / n * math.pi * 2
        c, s = math.cos(t), math.sin(t)
        e = 2 / (B["nTop"] if s < 0 else B["nBot"])
        X = _sign(c) * abs(c) ** e
        Y = _sign(s) * abs(s) ** e
        X *= (1 + B["egg"] * Y) * (1 + B["asym"] * _sign(X))
        r = 1 + B["noise"] * (math.cos(2 * t + ph[0]) + 0.7 * math.cos(3 * t + ph[1]) + 0.5 * math.cos(4 * t + ph[2]))
        x, y = B["a"] * X * r, B["b"] * Y * r
        pts.append((cx + x * math.cos(B["rot"]) - y * math.sin(B["rot"]), cy + x * math.sin(B["rot"]) + y * math.cos(B["rot"])))
    return pts


def head_blob(seed, a=118, facing=0):
    return blob(a, a * (0.94 + 0.08 * (rnd(seed, 1) - 0.5)), 1.75 + 0.3 * (rnd(seed, 2) - 0.5), 2.3 + 0.3 * (rnd(seed, 3) - 0.5),
                -0.12 + 0.06 * (rnd(seed, 4) - 0.5), (0.06 + 0.04 * rnd(seed, 5)) * (facing or (-1 if rnd(seed, 6) < 0.5 else 1)),
                rad(8 * (rnd(seed, 7) - 0.5)), 0.008, seed)


def thick_angle(light):
    return math.atan2(-math.sin(light) + 0.8, -math.cos(light))


DEF_LIGHT = rad(-120)

# ---------------- faces
FACE = {
    "neutral": (("lid", "lid"), (0, -1), "dash"),
    "stern": (("lid", "lid"), (3, -2), "frown"),
    "grin": (("happy", "happy"), (-3, -3), "grin"),
    "laugh": (("squeeze", "squeeze"), (-4, -4), "laugh"),
    "whistle": (("dash", "dash"), (-2, -4), "o"),
    "nervous": (("small", "small"), (-3, 2), "wave"),
    "shock": (("shock", "shock"), (-7, -6), "O"),
    "relief": (("happy", "happy"), (-2, 1), "smileWide"),
    "relief_open": (("happy", "happy"), (-2, 1), "grin"),
    "dazed": (("spiral", "spiral"), (-3, 2), "wave"),
    "pained": (("squeeze", "lid"), (-3, 2), "teeth"),
    "smile": (("dot", "dot"), (0, -1), "smirk"),
    "smile_closed": (("happy", "happy"), (0, -1), "smile"),
    "lick": (("dot", "dot"), (0, -1), "lick"),
}


def half_lid(k):
    return "lid" if k in ("dot", "small") else "slit" if k == "lid" else "shockHalf" if k == "shock" else k


def eye_kind(k, lid):
    if lid >= 1 and k not in ("happy", "squeeze", "spiral"):
        return "dash"
    return half_lid(k) if lid > 0 else k


def lid_of(b):
    return 1 if b is True else (float(b) if b else 0)


def eye(p, kind, x, ey, u, side, look, skin):
    lx, lw = x + look * 3 * u, 3.8 * u
    if kind == "dot":
        p.ell(lx, ey, 3.8 * u, 5.5 * u, INK, 0)
    elif kind == "small":
        p.ell(lx, ey, 3 * u, 4.4 * u, INK, 0)
    elif kind == "lid":
        p.ell(lx, ey - u, 7 * u, 6 * u, INK, 0, 0, 180)
        p.stroke([(x - 9 * u, ey - u), (x + 9 * u, ey - u)], lw)
    elif kind == "slit":
        p.ell(lx, ey, 7 * u, 2.6 * u, INK, 0, 0, 180)
        p.stroke([(x - 9 * u, ey), (x + 9 * u, ey)], lw)
    elif kind == "happy":
        p.arc(x, ey + 3 * u, 8 * u, 6 * u, 200, 340, lw)
    elif kind == "dash":
        p.stroke([(x - 8.5 * u, ey), (x + 8.5 * u, ey)], lw)
    elif kind == "squeeze":
        p.stroke([(x + 6 * u * side, ey - 5 * u), (x - 6 * u * side, ey), (x + 6 * u * side, ey + 5 * u)], lw)
    elif kind in ("shock", "shockHalf"):
        p.ell(x, ey, 11 * u, 11 * u, WHITE, 2.6 * u)
        p.dot(lx - side * 1.5 * u, ey + 1.5 * u, 3 * u)
        if kind == "shockHalf":
            p.ell(x, ey, 11 * u, 11 * u, skin, 0, 180, 360)
            p.stroke([(x - 11 * u, ey), (x + 11 * u, ey)], 2.6 * u)
    else:
        s = [(x + math.cos(t * 0.9) * t * 0.55 * u, ey + math.sin(t * 0.9) * t * 0.55 * u) for t in range(1, 15)]
        p.stroke(s, 2.4 * u)


def dmouth(p, mx, y, rx, ry, u, tongue=False):
    p.ell(mx, y, rx, ry, MOUTH, 0, 0, 180)
    p.clip([(mx - rx, y), (mx + rx, y), (mx + rx, y + 3 * u), (mx - rx, y + 3 * u)], lambda: p.ell(mx, y, rx, ry, WHITE, 0, 0, 180))
    if tongue:
        p.ell(mx + 2 * u, y + 0.62 * ry, 0.4 * rx, 0.28 * ry, TONGUE, 0)
    p.ell(mx, y, rx, ry, None, 3 * u, 0, 180)


def mouth(p, kind, mx, my, u, k=1):
    mw = 4 * u
    if kind == "dash":
        p.stroke([(mx - 5.5 * u * k, my), (mx + 5.5 * u * k, my - 0.8 * u)], mw)
    elif kind == "frown":
        p.arc(mx, my + 3 * u, 6.5 * u * k, 3.5 * u, 200, 340, mw)
    elif kind == "smirk":
        p.arc(mx + u, my - 3 * u, 7 * u * k, 4 * u, 10, 150, mw)
    elif kind == "smile":
        p.arc(mx, my - 3 * u, 8 * u * k, 4.5 * u, 20, 160, mw)
    elif kind == "smileWide":
        p.arc(mx, my - 4 * u, 11 * u * k, 6 * u, 15, 165, mw)
    elif kind == "grin":
        dmouth(p, mx, my - u, 12 * u * k, 8 * u, u)
    elif kind == "laugh":
        dmouth(p, mx, my, 16 * u * k, 11 * u, u, True)
    elif kind == "o":
        p.ell(mx + 4 * u, my, 3.5 * u, 4 * u, MOUTH, 2.8 * u)
    elif kind == "O":
        p.ell(mx, my + 2 * u, 9 * u * k, 11 * u, MOUTH, 3.2 * u)
    elif kind == "wave":
        p.stroke([(mx - 9 * u * k + i * 1.5 * u * k, my + 1.5 * u * math.sin(i * 1.3)) for i in range(13)], 3 * u)
    elif kind == "teeth":
        p.poly([(mx - 12 * u * k, my - 4 * u), (mx + 12 * u * k, my - 4 * u), (mx + 11 * u * k, my + 4 * u), (mx - 11 * u * k, my + 4 * u)], WHITE, 3 * u)
        for j in (-1, 0, 1):
            p.stroke([(mx + j * 6 * u * k, my - 4 * u), (mx + j * 6 * u * k, my + 4 * u)], 1.5 * u)
    elif kind == "lick":
        p.arc(mx, my - 3 * u, 8 * u * k, 4.5 * u, 20, 160, mw)
        p.ell(mx + 6 * u * k, my + 3 * u, 3.6 * u, 4.6 * u, TONGUE, 2.4 * u)


def face_front(p, cx, cy, W, expr, facing, look, lid, brim, skin, moustache=None, stout=False, big=False):
    u = W / 100
    eyes, brow, mk = FACE[expr]
    fx = cx + 7 * u * facing
    ex = (12 if eyes[0] == "shock" else 13) * u
    ey = cy
    for side in (-1, 1):
        x = fx + side * ex
        front = (side == facing) if facing else (side > 0)
        kind = eye_kind(eyes[1 if front else 0], lid)
        eye(p, kind, x, ey, u, side, look, skin)
        dI, dO = brow
        by = ey - (17 if brim else 20) * u
        if kind in ("shock", "shockHalf"):
            p.arc(x, by - 6 * u, 9 * u, 3 * u, 200, 340, 4 * u)
        else:
            taper(p, (x - side * 8.5 * u, by + dI * u), (x + side * 8.5 * u, by + dO * u), 5 * u, 2.5 * u)
    mx, my = cx + 8 * u * facing, cy + 20 * u
    mouth(p, mk, mx, my, u)
    if moustache and big:
        for s in (-1, 1):
            p.poly([(mx, cy + 11 * u), (mx + s * 10 * u, cy + 8.5 * u), (mx + s * 21 * u, cy + 11 * u), (mx + s * 27 * u, cy + 6 * u), (mx + s * 26 * u, cy + 13 * u),
                    (mx + s * 17 * u, cy + 18 * u), (mx + s * 6 * u, cy + 17 * u), (mx, cy + 15 * u)], moustache, 2.2 * u)
    elif moustache:
        for s in (-1, 1):
            taper(p, (mx + s * 1.5 * u, cy + 12.5 * u), (mx + s * (19 if stout else 15) * u, cy + (10.5 if stout else 15) * u), (5.5 if stout else 4.5) * u, 1.6 * u, moustache)
    if expr == "nervous":
        p.ell(cx + 40 * u * (facing or 1), cy - 22 * u, 3 * u, 5 * u, "#9fd4ff", 2 * u)


def face_side(p, hx, hy, W, expr, lid, brim, skin, moustache=None, stout=False, big=False):
    u = W / 100
    eyes, brow, mk = FACE[expr]
    ex, ey = hx + 27 * u, hy
    kind = eye_kind(eyes[1], lid)
    eye(p, kind, ex, ey, u, 1, 0.6, skin)
    by = ey - (17 if brim else 20) * u
    dI, dO = brow
    if kind in ("shock", "shockHalf"):
        p.arc(ex, by - 6 * u, 9 * u, 3 * u, 200, 340, 4 * u)
    else:
        taper(p, (ex + 8 * u, by + dI * u), (ex - 7 * u, by - u + dO * u), 5 * u, 2.5 * u)
    p.stroke([(hx + 44 * u, hy + 4 * u), (hx + 47.5 * u, hy + 9 * u), (hx + 43 * u, hy + 10 * u)], 3 * u)
    mouth(p, mk, hx + 33 * u, hy + 21 * u, u, 0.62)
    if moustache and big:
        p.poly([(hx + 44 * u, hy + 12 * u), (hx + 34 * u, hy + 10 * u), (hx + 24 * u, hy + 13 * u), (hx + 18 * u, hy + 8 * u), (hx + 20 * u, hy + 16 * u),
                (hx + 30 * u, hy + 19 * u), (hx + 42 * u, hy + 17 * u)], moustache, 2.2 * u)
    elif moustache:
        taper(p, (hx + 41 * u, hy + 13.5 * u), (hx + 25 * u, hy + (11.5 if stout else 16) * u), (5.5 if stout else 4.5) * u, 1.6 * u, moustache)
    if expr == "nervous":
        p.ell(hx - 30 * u, hy - 24 * u, 3 * u, 5 * u, "#9fd4ff", 2 * u)


# ---------------- hats
BONNET, BONNET_BRIM = "#e9cf8f", "#d6b46a"


def hat_behind(p, o, H, cx, hc, light, thick, ow, side):
    if o.get("hat") != "bonnet":
        return
    bb = blob_pts(cx - (12 if side else 0) * (H["a"] / 50), hc - 0.07 * 2 * H["b"], dict(H, a=H["a"] * 1.17, b=H["b"] * 1.13, asym=0, egg=0.04, seed=H["seed"] + 3))
    p.shadedFill(bb, BONNET, mul(BONNET, SH_CLOTH), light, H["a"] * 1.17)
    p.inkRing(bb, ow * 0.85, thick)


def hat_on(p, o, hp, H, cx, hc, light, seed, facing, side):
    hat = o.get("hat")
    W, HH = 2 * H["a"], 2 * H["b"]
    u, crown, ow = W / 100, hc - H["b"], 0.85 * 5 * (2 * H["a"] / 100)
    a = H["rot"] + rad(4 * (rnd(seed, 20) - 0.5))
    R = lambda pts: rot_pts(pts, a, cx, hc)
    deg = a * 180 / math.pi

    def sag(yb, wb):
        return [(cx + wb * (2 * (i / 12) - 1), yb + 3 * u * (1 - (2 * (i / 12) - 1) ** 2)) for i in range(13)]

    if hat in ("shako", "shako_tall"):
        tall = hat == "shako_tall"
        yb, ht, wb, wt = crown + 0.25 * HH, (0.66 if tall else 0.56) * HH, 46 * u, 52 * u
        body = R(list(reversed(sag(yb, wb))) + [(cx - wt, yb - ht), (cx + wt, yb - ht)])
        p.shadedFill(body, "#3a3d47", "#24262d", light, wt, 0.4)
        if tall:
            p.clip(body, lambda: p.band(R([(cx - wt - 5 * u, yb - ht + 0.07 * HH), (cx + wt + 5 * u, yb - ht + 0.07 * HH)]), "#e8c45a", 0.06 * HH, 1.5 * u))
        p.poly(body, None, ow)
        if side:
            p.poly(R([(cx + 36 * u, yb - u), (cx + 60 * u, yb + 8 * u), (cx + 34 * u, yb + 6 * u)]), "#16171b", 2.5 * u)
            tx, ty = R([(cx + 24 * u, yb - ht - 6 * u)])[0]
            p.ell(tx, ty, 7 * u, 7 * u, "#2b7a4b", 2.5 * u)
        else:
            px, py = R([(cx + 3 * u * facing, yb + 3 * u)])[0]
            p.ell(px, py, 34 * u, 0.045 * HH, "#16171b", 2.5 * u, 0, 180, deg)
            bx, by = R([(cx, yb - 0.45 * ht)])[0]
            p.ell(bx, by, 7 * u, 6 * u, "#e8c45a" if tall else "#c9ccd2", 2 * u, 0, 360, deg)
            p.arc(bx, by, 3.5 * u, 2.8 * u, 200, 500, 1.6 * u)
            tx, ty = R([(cx, yb - ht - 6 * u)])[0]
            p.ell(tx, ty, 7 * u, 7 * u, "#2b7a4b", 2.5 * u)
    elif hat in ("cap", "hair"):
        cut = crown + (0.3 if hat == "cap" else 0.42) * HH
        keep = lambda x, y: y < cut or (side and hat == "hair" and x < cx - 6 * u and y < hc + 0.42 * H["b"])
        n = len(hp)
        start = next((i for i, (x, y) in enumerate(hp) if keep(x, y) and not keep(*hp[(i + n - 1) % n])), 0)
        arc = [(cx + (x - cx) * 1.03, hc + (y - hc) * 1.03) for x, y in hp[start:] + hp[:start] if keep(x, y)]
        if len(arc) < 3:
            return
        if hat == "hair":
            (x0, y0), (x1, y1) = arc[-1], arc[0]
            for i in range(1, 6):
                arc.append((x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6 + (4 * u if i % 2 else 0)))
        col = o["cap"] if hat == "cap" else o["hair"]
        p.shadedFill(arc, col, mul(col, SH_FELT), light, H["a"], 0.35)
        p.poly(arc, None, ow)
        if hat == "hair":
            s = -1 if side else (facing or 1)
            p.stroke([(cx + s * 10 * u, cut - 30 * u), (cx + s * 2 * u, cut - 12 * u)], 1.2 * u)
        if hat == "cap":
            if side:
                p.poly(R([(cx + 40 * u, cut - 2 * u), (cx + 74 * u, cut + 4 * u), (cx + 40 * u, cut + 6 * u)]), shade(col, 0.8), ow)
            else:
                s = facing or (-1 if rnd(seed, 21) < 0.5 else 1)
                px, py = R([(cx + s * 4 * u, cut + 1.5 * u)])[0]
                p.ell(px, py, 32 * u, 0.06 * HH, shade(col, 0.8), ow, 0, 180, deg)
    elif hat == "toque":
        yb, bh = crown + 0.12 * HH, 0.3 * HH
        wb = (0.4 if side else 0.36) * W
        top, col = yb - bh, "#fbf8f0"
        dark = mul(col, (0.86, 0.86, 0.92))
        band = R([(cx - wb, yb + 2 * u), (cx + wb, yb + 2 * u), (cx + wb * 1.06, top), (cx - wb * 1.06, top)])
        puffs = ([(-0.24, -0.04, 0.32, 0.24), (0.2, -0.02, 0.32, 0.24), (-0.02, -0.24, 0.36, 0.27)] if side
                 else [(-0.33, -0.03, 0.3, 0.24), (0.33, -0.03, 0.3, 0.24), (0, -0.23, 0.37, 0.28)])
        for dx, dy, rx, ry in puffs:
            px, py = R([(cx + dx * W, top + dy * HH)])[0]
            pts = ell_pts(px, py, rx * W, ry * HH, 0, 360, deg)
            p.shadedFill(pts, col, dark, light, rx * W)
            p.poly(pts, None, ow)
        p.shadedFill(band, col, dark, light, wb, 0.3)
        p.poly(band, None, ow)
        p.stroke(R([(cx - wb * 0.5, yb - 0.04 * HH), (cx - wb * 0.45, top + 0.06 * HH)]), 1.3 * u)
        p.stroke(R([(cx + wb * 0.4, yb - 0.04 * HH), (cx + wb * 0.45, top + 0.06 * HH)]), 1.3 * u)
    elif hat == "tophat":
        yb, ht, wb, wt, col = crown + 0.22 * HH, 0.8 * HH, 0.31 * W, 0.33 * W, "#2e2a36"
        body = R(list(reversed(sag(yb, wb))) + [(cx - wt, yb - ht), (cx + wt, yb - ht)])
        p.shadedFill(body, col, mul(col, SH_FELT), light, wt, 0.4)
        p.clip(body, lambda: p.band(R([(cx - wt - 4 * u, yb - 0.13 * HH), (cx + wt + 4 * u, yb - 0.13 * HH)]), shade(o["jacket"], 0.9), 0.14 * HH, 0.8 * u))
        p.poly(body, None, ow)
        bx, by = R([(cx, yb + u)])[0]
        p.ell(bx, by, 0.45 * W, 0.05 * HH, "#1d1b22", ow, 0, 360, deg)
    elif hat == "bonnet":
        bx, by = R([(cx + (6 * u if side else 0), crown + 0.16 * HH)])[0]
        p.arc(bx, by, 0.5 * W, 0.2 * HH, 200, 340, 7 * u, BONNET_BRIM)
        p.arc(bx, by, 0.5 * W + 3.5 * u, 0.2 * HH + 3.5 * u, 200, 340, 1.2 * u)
        cy = hc + H["b"] * 0.98
        p.stroke([(cx - 14 * u, cy - 4 * u), (cx, cy + 2 * u), (cx + 14 * u, cy - 4 * u)], 2 * u, BONNET_BRIM)


# ---------------- bodies
BUILD = {"adult": (118, 1.1, 1.4, 0.8), "stout": (118, 1.15, 1.32, 0.92), "kid": (112, 0.85, 1.0, 0.72)}   # a, torso, legs, tw


def foot_stroke(p, a, b, w, col):
    if col != INK:
        p.stroke([a, b], w + 3, INK)
    p.stroke([a, b], w, col)


def _brim(o):
    h = o.get("hat")
    return bool(h) and h not in ("hair", "bonnet", "cap", "toque")


def body_front(p, o, phase=0.0, expr="neutral", mode="stand", look=0.0, blink=False, lift=60, tilt=0.0, headTilt=0.0, wave=None,
               hands=None, light=DEF_LIGHT, facing=0, seed=1):
    ba, btorso, blegs, btw = BUILD[o.get("build") or "adult"]
    skin, two, lid = o.get("skin") or SKIN, math.pi * 2, lid_of(blink)
    H = head_blob(seed, ba, facing)
    W, HH = 2 * H["a"], 2 * H["b"]
    u = W / 100
    tall, sole = (1 + btorso + blegs) * HH, 975
    bob = 0.025 * tall * math.cos(2 * two * phase) if mode == "march" else 0.015 * tall * math.cos(2 * two * phase) if mode == "stroll" else 0
    torsoBot = sole - blegs * HH + bob
    chin = torsoBot - btorso * HH
    hc = chin - H["b"]
    hipY = torsoBot - 0.12 * HH
    thick, ow = thick_angle(light), 5 * u
    legCol, armCol, footCol = mix(o["pants"], INK, 0.55), mix(o["jacket"], INK, 0.5), o["boots"]
    legW, footW = 5.8 * u, 7.5 * u
    # ---- legs + feet (not rotated)
    p.rot = None
    if o.get("dress"):
        for side in (-1, 1):
            fx, fy = 300 + side * 12 * u, sole - 4 * u
            p.stroke([(fx, sole - 0.4 * HH), (fx + side * u, fy)], legW, legCol)
            foot_stroke(p, (fx - side * 3 * u, fy), (fx + side * 12 * u, fy + u), footW, footCol)
    else:
        L = lift * 1.25 if mode == "march" else lift * 0.55 if mode == "stroll" else 0
        for side, ph in ((-1, 0), (1, 0.5)):
            up = max(0.0, math.sin(two * (phase + ph))) * L
            hx, fx, fy = 300 + side * 15 * u, 300 + side * 22 * u, sole - 4 * u - up
            k = ((hx + fx) / 2 + side * (1.5 * u + up * 0.16), (hipY + fy) / 2 - up * 0.08)
            p.stroke(curve((hx, hipY), k, (fx, fy)), legW, legCol)
            foot_stroke(p, (fx - side * 3 * u, fy), (fx + side * 13 * u, fy + 0.5 * u), footW, footCol)
    # ---- upper body: rotates about the hips
    sway = 1.6 * math.sin(two * phase) if mode == "march" else 1.0 * math.sin(two * phase) if mode == "stroll" else 0
    A = tilt + sway
    p.rot = [rad(A), 300, hipY] if A else None
    dress = bool(o.get("dress"))
    T = blob((btw / 2) * W / 1.06, 0.5 * (torsoBot - (chin - 0.25 * HH)), 2.2, 2.6, 0.17 if o.get("build") == "stout" else 0.12, 0.04 * facing, 0, 0.006, seed + 7)
    tcx = 300 + 3 * u * facing
    tp = blob_pts(tcx, torsoBot - T["b"], T)
    sh = lambda side: (tcx + side * 0.85 * T["a"], chin + 0.12 * HH)

    def hang(side, fwd):
        S = sh(side)
        ex = tcx + side * (1.12 * T["a"] + 4 * u)
        hx = ex + side * 3 * u - side * 6 * u * max(0, fwd) + side * 4 * u * max(0, -fwd)
        return [S, (ex, S[1] + 0.48 * HH), (hx, chin + 1.04 * HH - abs(fwd) * 9 * u)]

    sw = math.sin(two * phase) if mode in ("march", "stroll") else 0
    arms = []
    if hands and mode in ("stand", "stroll"):
        for i, side in ((0, -1), (1, 1)):
            Ht = hands[i]
            if not Ht:
                arms.append((hang(side, side * sw), False))
                continue
            S = sh(side)
            d = math.hypot(Ht[0] - S[0], Ht[1] - S[1])
            bend = max(4 * u, 0.6 * HH - 0.5 * d)
            arms.append(([S, ((S[0] + Ht[0]) / 2 + side * bend, (S[1] + Ht[1]) / 2 + 0.3 * bend), tuple(Ht)], True))
    else:
        arms.append((hang(-1, -sw), False))
        if wave is not None:
            S = sh(1)
            arms.append(([S, (tcx + 1.1 * T["a"] + 10 * u + 3 * u * wave, S[1] - 0.22 * HH), (tcx + 1.18 * T["a"] + 16 * u + 12 * u * wave, S[1] - 0.6 * HH)], False))
        else:
            arms.append((hang(1, sw), False))

    def draw_arm(a):
        p.stroke(curve(a[0], a[1], a[2]), 5.2 * u, armCol)
        p.dot(a[2][0], a[2][1], 5.5 * u)

    for a, front in arms:
        if not front:
            draw_arm(a)
    if dress:
        D = blob(0.5 * W * 0.98, 0.5 * ((sole - 0.35 * HH) - (chin - 0.2 * HH)), 2.0, 3.0, 0.35, 0.03 * facing, 0, 0.006, seed + 9)
        dp = blob_pts(300, sole - 0.35 * HH - D["b"], D)
        p.gradFill(dp, o["dress"], mul(o["dress"], SH_CLOTH), light)
        p.inkRing(dp, ow, thick)
        Sw = blob(0.37 * W, 0.3 * HH, 2.2, 2.4, 0.1, 0, 0, 0.006, seed + 8)
        sp = blob_pts(300, chin + 0.12 * HH, Sw)
        p.gradFill(sp, o["jacket"], mul(o["jacket"], SH_CLOTH), light)
        p.inkRing(sp, ow * 0.9, thick)
    else:
        p.gradFill(tp, o["jacket"], mul(o["jacket"], SH_CLOTH), light)

        def clothing():
            if o.get("belt"):
                for s in (-1, 1):
                    p.band([(tcx - s * 0.75 * T["a"], chin - 0.05 * HH), (tcx + s * 0.8 * T["a"], torsoBot - 0.1 * HH)], o["belt"], 5.5 * u, 1.8 * u)
            if o.get("buttons2"):
                for i in range(3):
                    for s in (-1, 1):
                        x, y = tcx + 2 * u * facing + s * 10 * u, chin + 0.16 * HH + i * 0.16 * HH
                        p.dot(x, y, 2.4 * u + 0.8 * u, INK)
                        p.dot(x, y, 2.4 * u, o.get("buttons") or "#e9e4d6")
            else:
                for i in range(4):
                    y = chin + 0.12 * HH + i * 0.2 * HH
                    p.dot(tcx + 2 * u * facing, y, 2.2 * u + 0.8 * u, INK)
                    p.dot(tcx + 2 * u * facing, y, 2.2 * u, o.get("buttons") or shade(o["jacket"], 0.7))

        p.clip(tp, clothing)
        p.inkRing(tp, ow, thick)
        if o.get("apron"):
            ay, aw, bw, by = chin + 0.5 * HH, 0.92 * T["a"], 1.0 * T["a"], torsoBot + 0.42 * HH
            ap = [(tcx - aw, ay), (tcx + aw, ay), (tcx + bw, by), (tcx - bw, by)]
            p.gradFill(ap, o["apron"], mul(o["apron"], (0.86, 0.86, 0.92)), light)
            p.poly(ap, None, ow * 0.8)
            p.stroke([(tcx - aw - 2 * u, ay + 2 * u), (tcx + aw + 2 * u, ay + 2 * u)], 2.2 * u)
            if o.get("flour"):
                for i in range(9):
                    p.dot(tcx + (rnd(seed, 40 + i) - 0.5) * 1.6 * aw, ay + (0.45 + 0.5 * rnd(seed, 60 + i)) * (by - ay), (1.2 + 1.6 * rnd(seed, 80 + i)) * u, "#e6dccb")
        if o.get("neck"):
            ny, nc = chin + 0.06 * HH, tcx + 2 * u * facing
            p.poly([(nc - 20 * u, ny - 3 * u), (nc + 20 * u, ny - 3 * u), (nc + 3 * u, ny + 0.2 * HH), (nc - 3 * u, ny + 0.2 * HH)], o["neck"], 2.2 * u)
            p.ell(nc, ny + 2 * u, 6 * u, 5 * u, shade(o["neck"], 0.85), 2 * u)
    for a, front in arms:
        if front:
            draw_arm(a)
    # ---- head: rotates with the body, plus its own tilt about the chin
    Ah = A + headTilt
    cpx, cpy = rot_about((300, chin), rad(A), (300, hipY))
    p.rot = [rad(Ah), 300, chin, cpx - 300, cpy - chin] if Ah else None
    hat_behind(p, o, H, 300, hc, light, thick, ow, False)
    hp = blob_pts(300, hc, H)
    p.shadedFill(hp, skin, mul(skin, SH_SKIN), light, H["a"])
    p.inkRing(hp, ow, thick)
    hat_on(p, o, hp, H, 300, hc, light, seed, facing, False)
    face_front(p, 300, hc, W, expr, facing, look, lid, _brim(o), skin, o.get("moustache"), o.get("build") == "stout", bool(o.get("bigMoustache")))
    p.rot = None


def ik(hip, ank, l1, l2):
    dx, dy = ank[0] - hip[0], ank[1] - hip[1]
    d = clamp(math.hypot(dx, dy), 1, l1 + l2 - 0.01)
    A = math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1))
    k = math.atan2(dy, dx) - A
    return (hip[0] + l1 * math.cos(k), hip[1] + l1 * math.sin(k))


def body_side(p, o, phase=0.0, expr="neutral", mode="march", blink=False, stomp=1.0, stride=1.0, light=DEF_LIGHT, seed=1):
    """side view facing screen-right; march footfalls land at phase 0 (near foot) and 0.5 (far foot)"""
    ba, btorso, blegs, btw = BUILD[o.get("build") or "adult"]
    skin, two, lid = o.get("skin") or SKIN, math.pi * 2, lid_of(blink)
    H = dict(head_blob(seed, ba, 1), asym=0.12, rot=rad(3 + 3 * (rnd(seed, 7) - 0.5)))
    W, HH = 2 * H["a"], 2 * H["b"]
    u, sole = W / 100, 975
    ankY = sole - 4 * u
    thick, ow = thick_angle(light), 5 * u
    legLen = (blegs + 0.12) * HH - 4 * u
    l1 = l2 = legLen / 2
    nearCol, farCol, footCol = mix(o["pants"], INK, 0.55), mix(o["pants"], INK, 0.75), o["boots"]
    legs = []
    hipY, lean, nearFwd = ankY - legLen * 0.995, 0.0, 0.0
    if mode == "march":
        S, liftH = 370 * stride, max(22, 40 + 70 * (stomp - 1))

        def st(ph):
            c = ((phase + ph) % 1 + 1) % 1
            if c < 0.5:
                s = c / 0.5
                return dict(x=S / 2 - S * s, h=0, stance=True, s=s)
            s = (c - 0.5) / 0.5
            return dict(x=-S / 2 + S * s - (S / math.pi) * math.sin(2 * math.pi * s), h=liftH * math.sin(math.pi * s), stance=False, s=s)

        nL, fL = st(0), st(0.5)
        stance = nL if nL["stance"] else fL
        Leff = legLen * (1 - 0.035 * math.sin(math.pi * stance["s"]))
        hipY = ankY - math.sqrt(max(1, Leff * Leff - stance["x"] ** 2))
        for L, near in ((fL, False), (nL, True)):
            legs.append(((300 + L["x"], ankY - L["h"]), 0 if L["stance"] else rad(35 * math.sin(math.pi * L["s"]) * (1 - 1.6 * L["s"])), near))
        lean = 4 + 3 * math.cos(2 * two * phase)
        nearFwd = nL["x"] / (S / 2)
    else:
        legs += [((300 - 4 * u, ankY), 0, False), ((300 + 4 * u, ankY), 0, True)]
    torsoBot = hipY + 0.12 * HH
    chin = torsoBot - btorso * HH
    hc = chin - H["b"]
    hip = (300, hipY)
    p.rot = None
    for ank, pitch, near in legs:
        knee = ik(hip, ank, l1, l2)
        hp0 = (300 + (0 if near else -5 * u), hipY)
        p.stroke([hp0, knee, ank], 5.8 * u, nearCol if near else farCol)
        c, s = math.cos(pitch), math.sin(pitch)
        foot_stroke(p, (ank[0] - 3 * u * c, ank[1] - 3 * u * s), (ank[0] + 13 * u * c, ank[1] + 13 * u * s + 0.5 * u), 7.5 * u,
                    footCol if near else (INK if footCol == INK else shade(footCol, 0.82)))
    p.rot = [rad(lean), 300, hipY] if lean else None
    T = blob((0.36 if o.get("build") == "stout" else 0.31) * W, 0.5 * (torsoBot - (chin - 0.25 * HH)), 2.2, 2.5, 0.1, 0.06, 0, 0.006, seed + 7)
    tcx = 300 + 2 * u
    tp = blob_pts(tcx, torsoBot - T["b"], T)
    armCol, farArm = mix(o["jacket"], INK, 0.5), mix(o["jacket"], INK, 0.68)
    S, aLen = (tcx + 0.05 * T["a"], chin + 0.14 * HH), 0.95 * HH

    def swing_arm(ang):
        e = (S[0] + math.sin(ang) * aLen * 0.5, S[1] + math.cos(ang) * aLen * 0.5)
        a2 = ang + rad(16) * (1 if ang >= 0 else -1)
        return [S, e, (e[0] + math.sin(a2) * aLen * 0.5, e[1] + math.cos(a2) * aLen * 0.5)]

    near = swing_arm(rad(-30) * nearFwd)
    far = swing_arm(rad(30) * nearFwd) if mode == "march" else None
    if far:
        p.stroke(curve(far[0], far[1], far[2]), 5.2 * u, farArm)
        p.dot(far[2][0], far[2][1], 5.5 * u)
    p.gradFill(tp, o["jacket"], mul(o["jacket"], SH_CLOTH), light)

    def clothing():
        if o.get("belt"):
            p.band([(tcx - 0.65 * T["a"], chin - 0.05 * HH), (tcx + 0.75 * T["a"], torsoBot - 0.1 * HH)], o["belt"], 5.5 * u, 1.8 * u)
        if not o.get("dress"):
            for i in range(3):
                y = chin + 0.16 * HH + i * 0.24 * HH
                p.dot(tcx + 0.8 * T["a"], y, 3 * u, INK)
                p.dot(tcx + 0.8 * T["a"], y, 2.2 * u, o.get("buttons") or shade(o["jacket"], 0.7))

    p.clip(tp, clothing)
    p.inkRing(tp, ow, thick)
    if o.get("apron"):
        ay, by = chin + 0.5 * HH, torsoBot + 0.42 * HH
        ap = [(tcx + 0.15 * T["a"], ay), (tcx + 1.02 * T["a"], ay), (tcx + 1.1 * T["a"] + 2 * u, by), (tcx + 0.25 * T["a"], by)]
        p.gradFill(ap, o["apron"], mul(o["apron"], (0.86, 0.86, 0.92)), light)
        p.poly(ap, None, ow * 0.8)
        p.stroke([(tcx - 0.9 * T["a"], ay + 2 * u), (tcx + 1.02 * T["a"], ay + 2 * u)], 2.2 * u)
    if o.get("neck"):
        p.poly([(tcx + 0.2 * T["a"], chin + 0.02 * HH), (tcx + 0.95 * T["a"], chin + 0.02 * HH), (tcx + 0.85 * T["a"], chin + 0.2 * HH)], o["neck"], 2.2 * u)
    p.stroke(curve(near[0], near[1], near[2]), 5.2 * u, armCol)
    p.dot(near[2][0], near[2][1], 5.5 * u)
    hx = 300 + 4 * u
    hat_behind(p, o, H, hx, hc, light, thick, ow, True)
    hp = blob_pts(hx, hc, H)
    p.shadedFill(hp, skin, mul(skin, SH_SKIN), light, H["a"])
    p.inkRing(hp, ow, thick)
    hat_on(p, o, hp, H, hx, hc, light, seed, 1, True)
    face_side(p, hx, hc, W, expr, lid, _brim(o), skin, o.get("moustache"), o.get("build") == "stout", bool(o.get("bigMoustache")))
    p.rot = None
