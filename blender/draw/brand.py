# The channel's NEW cast style (2026-11-24, the user asked for new characters), drawn after the user's own reference
# sheets in D:\AI repo\Youtube\brand\character (chef-turnaround / chef-expressions, stick-cast-lineup, stick-turnaround,
# stick-walk-34): big round head WITH hair and ears, rosy cheeks, dot eyes, a moustache for the master baker; a
# trapezoid shirt or jacket, apron, neckerchief; thin dark stick arms with round skin hands; short stick legs in
# rounded shoes; warm dark-brown ink. Same design space as toon.py: 600 x 1000 units, y DOWN, soles at y = 975, so the
# heights in people.SIZE (crown 1.68 m adult, 1.29 m kid) and the hand positions in metres still hold.
# The old bean-head style stays in toon.py (people.STYLE switches).
import math
from pen import rad, ell_pts, mix_hex

INK = "#3a2420"
SKINS = ["#f6c9a8", "#eab48e", "#d99a74", "#a8694a"]
BLUSH = "#f0938a"
MOUTH = "#7a2a2a"
TONGUE = "#e8707a"
OL = 7                    # outline width (the sheets use a thinner line than the old cast)

# body plan per build: head rx, ry, head centre y, neck y, torso bottom y, top / bottom half widths of the torso
BUILD = {
    "adult": dict(rx=128, ry=118, hc=320, neck=430, tb=735, tw0=96, tw1=110, leg=17, apron=80),
    "stout": dict(rx=134, ry=120, hc=322, neck=434, tb=745, tw0=110, tw1=140, leg=19, apron=95),
    "slim":  dict(rx=122, ry=114, hc=318, neck=424, tb=715, tw0=84, tw1=94, leg=15, apron=70),
    "kid":   dict(rx=120, ry=110, hc=487, neck=588, tb=820, tw0=80, tw1=88, leg=15, apron=50),
}


def _ink(p):
    p.ol = OL


def rrect(x0, y0, x1, y1, r, n=5):
    """rounded rectangle (y down)"""
    r = min(r, (x1 - x0) / 2, (y1 - y0) / 2)
    pts = []
    for cx, cy, a0 in ((x1 - r, y0 + r, -90), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180)):
        for i in range(n + 1):
            a = rad(a0 + 90 * i / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def trap(cx, y0, y1, w0, w1, r=40):
    """torso: trapezoid with rounded bottom corners"""
    pts = [(cx - w0, y0 + 6), (cx - w0 + 10, y0), (cx + w0 - 10, y0), (cx + w0, y0 + 6)]
    for cx2, a0, a1 in ((cx + w1 - r, 0, 90), (cx - w1 + r, 90, 180)):
        for i in range(7):
            a = rad(a0 + (a1 - a0) * i / 6)
            pts.append((cx2 + r * math.cos(a), y1 - r + r * math.sin(a)))
    return pts


def belly(cx, y0, y1, w0, w1, bulge=0.1, r=46):
    """rounded torso: shoulders w0, sides bowing out to w1 * (1 + bulge) low down, round bottom corners"""
    L, Rt = [], []
    n = 10
    for i in range(n + 1):
        t = i / n
        y = y0 + (y1 - r - y0) * t
        w = w0 + (w1 - w0) * t + w1 * bulge * math.sin(math.pi * min(1.0, t * 1.15))
        Rt.append((cx + w, y))
        L.append((cx - w, y))
    wb = Rt[-1][0] - cx
    bottom = [(cx + wb - r + r * math.cos(rad(a)), y1 - r + r * math.sin(rad(a))) for a in range(0, 91, 15)] +              [(cx - wb + r + r * math.cos(rad(a)), y1 - r + r * math.sin(rad(a))) for a in range(90, 181, 15)]
    sh = [(cx + w0 * 0.55, y0 - 8), (cx + w0 * 0.85, y0 - 2)]          # sloping shoulders
    Rt = sh + [(x, y + 18 * (1 - i / n) ** 2) for i, (x, y) in enumerate(Rt)]
    L = [(2 * cx - x, y) for x, y in Rt]
    return Rt + bottom + L[::-1]


def qcurve(a, c, b, n=12):
    return [((1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1])
            for t in (i / n for i in range(n + 1))]


# ---------------------------------------------------------------- face
def eyes(p, cx, ey, dx, kind, look=0.0, s=1.0):
    for side in (-1, 1):
        x = cx + side * dx + look * 6
        if kind == "dot":
            p.ell(x, ey, 12 * s, 16 * s, INK, 0)
            p.dot(x + 4 * s, ey - 6 * s, 4.5 * s, "#ffffff")
        elif kind == "blink":
            p.stroke([(x - 11 * s, ey), (x + 11 * s, ey)], 5 * s, INK)
        elif kind == "happy":
            p.arc(x, ey + 6 * s, 15 * s, 12 * s, 200, 340, 6 * s, INK)
        elif kind == "squeeze":
            p.stroke([(x - side * 10 * s, ey - 8 * s), (x + side * 8 * s, ey), (x - side * 10 * s, ey + 8 * s)], 5 * s, INK)
        elif kind == "wide":
            p.ell(x, ey, 20 * s, 23 * s, "#ffffff", 5 * s)
            p.ell(x + look * 4, ey + 3 * s, 9 * s, 10 * s, INK, 0)
        elif kind == "half":
            p.ell(x, ey + 2 * s, 9 * s, 8 * s, INK, 0)
            p.stroke([(x - 12 * s, ey - 4 * s), (x + 12 * s, ey - 4 * s)], 5 * s, INK)


def brows(p, cx, by, dx, kind, s=1.0):
    for side in (-1, 1):
        x = cx + side * dx
        if kind == "up":
            p.arc(x, by + 2 * s, 14 * s, 8 * s, 200, 340, 5 * s, INK)
        elif kind == "angry":
            p.stroke([(x - side * 16 * s, by - 6 * s), (x + side * 12 * s, by + 8 * s)], 7 * s, INK)
        elif kind == "worried":
            p.stroke([(x - side * 14 * s, by + 6 * s), (x + side * 12 * s, by - 6 * s)], 5 * s, INK)
        elif kind == "high":
            p.arc(x, by - 4 * s, 14 * s, 9 * s, 200, 340, 5 * s, INK)


def mouth(p, kind, mx, my, s=1.0, hidden_top=False):
    if kind == "smile":
        p.arc(mx, my - 8 * s, 18 * s, 14 * s, 25, 155, 5 * s, INK)
    elif kind == "flat":
        p.arc(mx, my - 20 * s, 14 * s, 22 * s, 70, 110, 5 * s, INK)
    elif kind == "frown":
        p.arc(mx, my + 10 * s, 16 * s, 10 * s, 200, 340, 5 * s, INK)
    elif kind in ("grin", "laugh"):
        w, h = (22, 18) if kind == "grin" else (28, 26)
        pts = [(mx - w * s, my - 4 * s)] + [(mx - w * s * math.cos(rad(a)), my - 4 * s + h * s * math.sin(rad(a))) for a in range(15, 166, 15)] + [(mx + w * s, my - 4 * s)]
        p.poly(pts, MOUTH, 5 * s)
        p.clip(pts, lambda: p.ell(mx, my + h * s * 0.9, w * s * 0.6, h * s * 0.45, TONGUE, 0))
        p.clip(pts, lambda: p.poly(rrect(mx - w * s, my - 6 * s, mx + w * s, my + 2 * s, 2), "#ffffff", 0))
    elif kind == "O":
        p.ell(mx, my + 2 * s, 13 * s, 17 * s, MOUTH, 5 * s)
        p.ell(mx, my + 10 * s, 8 * s, 6 * s, TONGUE, 0)
    elif kind == "wave":
        pts = [(mx - 18 * s + 36 * s * i / 8, my + 4 * s * math.sin(i * math.pi / 2)) for i in range(9)]
        p.stroke(pts, 5 * s, INK)


FACES = {   # eyes, brows, mouth
    "neutral": ("dot", None, "flat"),
    "listen": ("dot", "high", "flat"),
    "smile": ("dot", None, "smile"),
    "smile_closed": ("happy", None, "smile"),
    "relief": ("happy", None, "smile"),
    "relief_open": ("happy", None, "grin"),
    "grin": ("happy", None, "grin"),
    "laugh": ("squeeze", None, "laugh"),
    "shock": ("wide", "high", "O"),
    "whistle": ("dot", None, "O"),
    "nervous": ("dot", "worried", "wave"),
    "pained": ("squeeze", "worried", "frown"),
    "dazed": ("half", None, "wave"),
    "stern": ("half", "angry", "frown"),
    "lick": ("happy", None, "grin"),
}


def moustache(p, mx, my, w, col):
    for side in (-1, 1):
        pts = qcurve((mx, my - 4), (mx + side * w * 0.55, my - 22), (mx + side * w, my + 2), 8) + \
              qcurve((mx + side * w, my + 2), (mx + side * w * 0.8, my + 20), (mx + side * w * 0.45, my + 12), 6)[1:] + \
              qcurve((mx + side * w * 0.45, my + 12), (mx + side * w * 0.2, my + 6), (mx, my + 8), 5)[1:]
        p.poly(pts, col, 5)


# ---------------------------------------------------------------- hair + hats
def hair_back(p, o, cx, hc, rx, ry):
    if o.get("hat") == "bonnet":         # the bonnet's crown sits behind the head
        p.poly(ell_pts(cx, hc - 10, rx * 1.32, ry * 1.28, 150, 390, n=32), o.get("hatcol", "#e8cf8a"), OL)
    h = o.get("hair")
    if h == "bob":
        p.poly(ell_pts(cx, hc + 8, rx * 1.22, ry * 1.12, 160, 380, n=30) + [(cx + rx * 1.2, hc + ry * 0.75), (cx - rx * 1.2, hc + ry * 0.75)], o["haircol"], OL)


def hair_front(p, o, cx, hc, rx, ry):
    h, col = o.get("hair"), o.get("haircol", "#4a2c1c")
    if h == "sides":         # under a hat: hair shows at the temples (the chef sheet)
        for side in (-1, 1):
            p.poly([(cx + side * rx * 0.62, hc - ry * 0.78), (cx + side * rx * 1.02, hc - ry * 0.2), (cx + side * rx * 0.98, hc + ry * 0.05),
                    (cx + side * rx * 0.8, hc - ry * 0.25), (cx + side * rx * 0.66, hc - ry * 0.45)], col, 5)
    elif h == "messy":       # kid: a cap of hair with a jagged fringe
        top = ell_pts(cx, hc, rx * 1.04, ry * 1.04, 175, 365, n=24)
        fringe = [(cx + rx * 0.98, hc - ry * 0.05), (cx + rx * 0.62, hc - ry * 0.42), (cx + rx * 0.4, hc - ry * 0.22), (cx + rx * 0.12, hc - ry * 0.5),
                  (cx - rx * 0.15, hc - ry * 0.3), (cx - rx * 0.45, hc - ry * 0.52), (cx - rx * 0.7, hc - ry * 0.25), (cx - rx * 0.98, hc - ry * 0.02)]
        p.poly(top + fringe, col, OL)
    elif h == "bob":
        fr = ell_pts(cx, hc, rx * 1.03, ry * 1.03, 180, 360, n=24) + [(cx + rx * 0.95, hc - ry * 0.1), (cx + rx * 0.2, hc - ry * 0.5), (cx - rx * 0.5, hc - ry * 0.42), (cx - rx * 0.98, hc)]
        p.poly(fr, col, OL)
    elif h == "short":
        top = ell_pts(cx, hc, rx * 1.03, ry * 1.03, 180, 360, n=24)
        p.poly(top + [(cx + rx * 1.0, hc - ry * 0.3), (cx + rx * 0.3, hc - ry * 0.62), (cx - rx * 0.6, hc - ry * 0.5), (cx - rx * 1.0, hc - ry * 0.25)], col, OL)
    elif h == "bald":
        for side in (-1, 1):
            p.ell(cx + side * rx * 0.9, hc - ry * 0.2, rx * 0.22, ry * 0.3, col, 5)


def hat(p, o, cx, hc, rx, ry):
    h = o.get("hat")
    crown = hc - ry
    if h == "toque":         # tall pleated chef hat: band + puffs (outlined puffs first, then fills cover the inner lines)
        bw, by0, by1 = rx * 0.78, crown - 70, crown + 22
        puffs = [(cx - bw * 0.72, by0 - 18, 44), (cx - bw * 0.2, by0 - 40, 50), (cx + bw * 0.38, by0 - 34, 48), (cx + bw * 0.8, by0 - 10, 40)]
        for x, y, r in puffs:
            p.ell(x, y, r, r * 0.9, "#ffffff", OL)
        for x, y, r in puffs:
            p.ell(x, y, r - OL * 0.55, r * 0.9 - OL * 0.55, "#ffffff", 0)
        p.poly(rrect(cx - bw, by0, cx + bw, by1, 6), "#ffffff", OL)
        for k in (-0.45, 0, 0.45):
            p.stroke([(cx + bw * k, by0 + 10), (cx + bw * k, by1 - 8)], 3, "#d8d0c4")
    elif h == "softcap":     # baker's soft cloth cap
        p.ell(cx + 6, crown + 14, rx * 0.98, ry * 0.42, "#f8f5ee", OL)
        p.ell(cx, crown + 34, rx * 0.95, ry * 0.16, "#f8f5ee", OL)
    elif h == "tophat":
        p.ell(cx, crown + 20, rx * 1.15, 18, o.get("hatcol", "#2a2430"), OL)
        p.poly(rrect(cx - rx * 0.68, crown - 120, cx + rx * 0.68, crown + 22, 6), o.get("hatcol", "#2a2430"), OL)
        p.poly([(cx - rx * 0.68, crown - 10), (cx + rx * 0.68, crown - 10), (cx + rx * 0.68, crown + 8), (cx - rx * 0.68, crown + 8)], o.get("band", "#8a3a3a"), 0)
    elif h == "bonnet":      # 1830s bonnet: a deep brim around the face, ribbon under the chin
        col = o.get("hatcol", "#e8cf8a")
        rim = ell_pts(cx, hc - 4, rx * 1.18, ry * 1.14, 160, 380, n=30)
        p.stroke(rim, 30, INK)
        p.stroke(rim, 30 - 2 * OL, col)
        for side in (-1, 1):     # bow under the chin
            p.ell(cx + side * 16, hc + ry * 1.06, 16, 10, o.get("ribbon", "#c0504d"), 4, 0, 360, side * 20)
        p.ell(cx, hc + ry * 1.05, 14, 10, o.get("ribbon", "#c0504d"), 4)
    elif h == "flatcap":
        col = o.get("hatcol", "#6a4a32")
        p.poly(ell_pts(cx, crown + 26, rx * 1.02, ry * 0.5, 180, 360, n=20) + [(cx + rx * 1.25, crown + 30), (cx - rx * 0.95, crown + 30)], col, OL)


# ---------------------------------------------------------------- body
def outfit(who, v):
    skin = SKINS[v % 4]
    if who in ("chef", "baker") and v % 2 == 0:   # the master baker of the chef sheet
        return dict(build="stout", skin=skin if v else SKINS[0], hair="sides", haircol="#4a2c1c", hat="toque", moustache="#4a2c1c",
                    jacket="#fbf8f2", buttons2=True, apron="#fffdf8", neck="#d23a32", legs=INK, shoes="#2a1c18", nose=True)
    if who in ("baker", "chef"):                   # a younger journeyman baker: soft cap, no moustache, blue neckerchief
        return dict(build="adult", skin=SKINS[(v + 1) % 4], hair="sides", haircol="#2c1e18", hat="softcap", jacket="#f4efe4", buttons=True,
                    apron="#fbf8f0", neck="#3f6fb5", legs=INK, shoes="#2a1c18", nose=True)
    if who == "apprentice":                        # the kid of the cast lineup, in a work shirt and apron
        return dict(build="kid", skin=SKINS[v % 4], hair="messy", haircol="#5a3420", jacket="#efe6d2", apron="#f8f3e6", apron_short=True,
                    neck="#3f8a5a", legs=INK, shoes="#4a3020", shorts="#6a5a48")
    if who in ("paris", "towns"):                  # 1830s townsfolk
        if v % 2:
            return dict(build="slim", skin=skin, hair="bob", haircol=["#7a3a22", "#3a2418", "#a8763a"][v % 3], hat="bonnet",
                        hatcol=["#e8cf8a", "#d9b8c4", "#c8d6e0"][v % 3], ribbon=["#c0504d", "#3f6fb5", "#5d7a3a"][v % 3],
                        dress=["#d9a441", "#c25a7a", "#5a8fc2"][v % 3], shawl=["#2f5f6a", "#5d7a3a", "#8c3b4a"][v % 3], legs=INK, shoes="#3a2418")
        return dict(build="adult", skin=skin, hair="short", haircol="#2c1e18", hat="tophat" if who == "paris" else "flatcap",
                    jacket=["#2f3a52", "#4a2f3a", "#33453a"][v % 3], vest="#c9a24a", shirt="#f4efe4", trousers="#c9c2b0", legs=INK, shoes="#1e1612",
                    neck="#f4efe4", tails=True)
    if who == "officer":
        return dict(build="adult", skin=skin, hair="short", haircol="#2c1e18", hat="tophat", hatcol="#2a2a2a", jacket="#5b4f46", buttons=True,
                    trousers="#d8d2c2", legs=INK, shoes="#1e1612")
    return dict(build="adult", skin=skin, hair="short", haircol=["#5a3b2a", "#2a201a", "#b58a4a", "#7a3a2a"][v % 4], jacket="#f2ead8",
                shorts="#6e6e72", legs=INK, shoes="#f4f1ea")


def _arm(p, sh, hand, side, skin, sleeve):
    """thin dark stick arm from the shoulder to the hand with a soft elbow bend, round skin hand"""
    mx, my = (sh[0] + hand[0]) / 2, (sh[1] + hand[1]) / 2
    dx, dy = hand[0] - sh[0], hand[1] - sh[1]
    L = math.hypot(dx, dy) or 1
    bend = min(26, 0.18 * L)
    c = (mx + side * abs(dy) / L * bend, my + abs(dx) / L * bend * 0.6)
    pts = qcurve(sh, c, hand, 10)
    p.stroke(pts, 9, INK)
    if sleeve:                                 # a short sleeve cuff at the shoulder
        p.ell(sh[0] + (pts[2][0] - sh[0]) * 0.5, sh[1] + (pts[2][1] - sh[1]) * 0.5, 15, 15, sleeve, 5)
    p.ell(hand[0], hand[1], 13, 13, skin, 5)


def draw_front(p, o, expr="neutral", blink=False, hands=None, look=0.0, hold=None):
    _ink(p)
    B = BUILD[o.get("build", "adult")]
    cx, hc, rx, ry, neck, tb = 300, B["hc"], B["rx"], B["ry"], B["neck"], B["tb"]
    skin = o["skin"]
    dress = o.get("dress")
    sole = 975
    # back hair, legs, shoes
    hair_back(p, o, cx, hc, rx, ry)
    lx = B["tw1"] * 0.42
    hip = tb - 8
    for side in (-1, 1):
        x = cx + side * lx
        p.stroke([(x, hip), (x + side * 2, sole - 14)], B["leg"], o.get("legs", INK))
        p.poly(rrect(x - 22 + side * 6, sole - 22, x + 22 + side * 10, sole + 2, 11), o.get("shoes", "#2a1c18"), 5)
    # skirt / trousers / shorts
    if dress:
        p.poly(trap(cx, neck + 60, sole - 70, B["tw1"] * 0.9, B["tw1"] * 1.25, 20), dress, OL)
    elif o.get("trousers"):
        for side in (-1, 1):
            x = cx + side * lx
            p.poly(rrect(x - 19, tb - 30, x + 19, sole - 30, 8), o["trousers"], OL)
    elif o.get("shorts") and not o.get("apron"):
        p.poly(rrect(cx - B["tw1"] + 6, tb - 30, cx + B["tw1"] - 6, tb + 60, 10), o["shorts"], OL)
    # torso
    body = belly(cx, neck, tb, B["tw0"], B["tw1"], 0.14 if o.get("build") == "stout" else 0.06)
    if not dress:
        if o.get("tails"):           # tail coat: coat panels hang below the waist
            for side in (-1, 1):
                p.poly([(cx + side * 10, tb - 40), (cx + side * B["tw1"], tb - 40), (cx + side * B["tw1"] * 0.92, tb + 120), (cx + side * B["tw1"] * 0.45, tb + 120)], o["jacket"], OL)
        p.poly(body, o["jacket"], OL)
        if o.get("vest"):
            p.poly([(cx - 34, neck + 10), (cx + 34, neck + 10), (cx + 40, tb - 4), (cx, tb + 14), (cx - 40, tb - 4)], o["vest"], 5)
            p.poly([(cx - 34, neck + 4), (cx + 34, neck + 4), (cx, neck + 90)], o.get("shirt", "#f4efe4"), 4)
        if o.get("buttons2"):
            for row in range(3):
                for side in (-1, 1):
                    p.ell(cx + side * 22, neck + 70 + row * 34, 4.5, 4.5, "#e8e2d6", 2.5)
        elif o.get("buttons"):
            for row in range(4):
                p.ell(cx, neck + 60 + row * 36, 4.5, 4.5, "#e8e2d6", 2.5)
    else:
        p.poly(trap(cx, neck, neck + 150, B["tw0"], B["tw1"] * 0.92), dress, OL)
        if o.get("shawl"):
            p.poly([(cx - B["tw0"] - 6, neck + 4), (cx + B["tw0"] + 6, neck + 4), (cx + B["tw0"] * 0.6, neck + 78), (cx, neck + 112), (cx - B["tw0"] * 0.6, neck + 78)], o["shawl"], OL)
    if o.get("apron"):
        y0 = neck + 0.42 * (tb - neck)
        y1 = tb + B["apron"]
        w0, w1 = B["tw1"] * 0.98, B["tw1"] * 1.02
        p.poly(rrect(cx - w0, y0, cx + w1, y1, 26), o["apron"], OL)
        p.stroke([(cx - w0, y0 + 2), (cx + w1, y0 + 2)], 6, mix_hex(o["apron"], INK, 0.25))
        for k in range(5):           # a dusting of flour on the master's apron
            if o.get("hat") == "toque":
                p.dot(cx - 40 + 23 * k, y1 - 30 - 14 * (k % 2), 4, "#efe6d4")
    # neckerchief: triangle + knot + two tails
    if o.get("neck"):
        nc = o["neck"]
        k = rx / 128
        p.poly([(cx - 62 * k, neck - 8), (cx + 62 * k, neck - 8), (cx, neck + 40 * k)], nc, 5)
        p.poly([(cx - 4, neck + 10), (cx - 34 * k, neck + 52 * k), (cx - 10, neck + 56 * k)], nc, 4)
        p.poly([(cx + 4, neck + 10), (cx + 34 * k, neck + 52 * k), (cx + 10, neck + 56 * k)], nc, 4)
        p.ell(cx, neck + 12, 13 * k, 11 * k, nc, 4)
    # arms (default: hanging at the sides) + hands later, over the body
    shoulders = [(cx - B["tw0"] + 8, neck + 28), (cx + B["tw0"] - 8, neck + 28)]
    rest = [(cx - B["tw1"] * 1.12 - 16, tb - 40), (cx + B["tw1"] * 1.12 + 16, tb - 40)]
    hs = [(hands[i] if hands and hands[i] else rest[i]) for i in (0, 1)]
    # head: ears behind, face, cheeks, features
    for side in (-1, 1):
        p.ell(cx + side * rx * 0.98, hc + 8, 18, 22, skin, 5)
    p.ell(cx, hc, rx, ry, skin, OL)
    hair_front(p, o, cx, hc, rx, ry)
    kind_e, kind_b, kind_m = FACES.get(expr, FACES["neutral"])
    if blink and kind_e in ("dot", "wide", "half"):
        kind_e = "blink"
    ey, dx = hc - ry * 0.08, rx * 0.36
    for side in (-1, 1):
        p.ell(cx + side * rx * 0.58, hc + ry * 0.28, 20, 12, BLUSH, 0)
    eyes(p, cx, ey, dx, kind_e, look)
    if kind_b:
        brows(p, cx, ey - 32, dx, kind_b)
    elif o.get("moustache"):
        brows(p, cx, ey - 32, dx, "up")
    my = hc + ry * 0.5
    if o.get("nose"):
        p.ell(cx + look * 4, hc + ry * 0.16, 21, 18, mix_hex(skin, "#e0705a", 0.45), 5)
    if o.get("moustache"):
        mouth(p, kind_m, cx, my + 8)
        moustache(p, cx + look * 4, hc + ry * 0.36, 82, o["moustache"])
    else:
        mouth(p, kind_m, cx, my)
    if expr == "nervous":
        p.poly([(cx + rx * 0.78, hc - ry * 0.55), (cx + rx * 0.7, hc - ry * 0.3), (cx + rx * 0.86, hc - ry * 0.3)], "#8ac6ea", 3)
    hat(p, o, cx, hc, rx, ry)
    # arms + hands on top
    for i, side in ((0, -1), (1, 1)):
        _arm(p, shoulders[i], hs[i], side, skin, None)
    return hs


def draw_side(p, o, phase=0.0, expr="neutral", blink=False, stride=0.72):
    """walking, facing screen-right (mirror the pen for walking left); footfalls at phase 0 and 0.5"""
    _ink(p)
    B = BUILD[o.get("build", "adult")]
    cx, hc, rx, ry, neck, tb = 300, B["hc"], B["rx"], B["ry"], B["neck"], B["tb"]
    skin, sole, two = o["skin"], 975, math.pi * 2
    bob = 6 * math.cos(2 * two * phase)
    hc, neck, tb = hc + bob, neck + bob, tb + bob
    step = 120 * stride / 0.72
    legs = []
    for ph in (0.5, 0.0):            # far leg first
        s = math.sin(two * (phase + ph))
        fx = cx + step * 0.5 * math.cos(two * (phase + ph))
        lift = max(0.0, s) * 40
        legs.append((fx, sole - 4 - lift, ph))
    for fx, fy, ph in legs:
        col = mix_hex(o.get("legs", INK), "#000000", 0.3) if ph == 0.5 else o.get("legs", INK)
        p.stroke([(cx, tb - 8), (fx, fy - 14)], B["leg"], col)
        p.poly(rrect(fx - 16, fy - 22, fx + 30, fy + 2, 11), o.get("shoes", "#2a1c18"), 5)
    sw = math.sin(two * phase) * 38
    # far arm
    _arm(p, (cx - 4, neck + 30), (cx - sw, tb - 40), -1, skin, None)
    if o.get("dress"):
        p.poly(trap(cx, neck + 40, sole - 70, B["tw1"] * 0.6, B["tw1"] * 0.95, 20), o["dress"], OL)
    elif o.get("trousers"):
        p.poly(rrect(cx - 20, tb - 30, cx + 20, tb + 120, 8), o["trousers"], OL)
    elif o.get("shorts") and not o.get("apron"):
        p.poly(rrect(cx - B["tw1"] * 0.62, tb - 30, cx + B["tw1"] * 0.62, tb + 60, 10), o["shorts"], OL)
    p.poly(trap(cx, neck, tb, B["tw0"] * 0.8, B["tw1"] * 0.82), o.get("dress") or o["jacket"], OL)
    if o.get("apron"):
        p.poly(rrect(cx - B["tw1"] * 0.1, neck + 0.45 * (tb - neck), cx + B["tw1"] * 0.78, tb + (110 if not o.get("apron_short") else 50), 8), o["apron"], OL)
    if o.get("neck"):
        p.poly([(cx + 8, neck - 4), (cx + 54, neck - 2), (cx + 40, neck + 30)], o["neck"], 5)
    # head in profile: ear at the middle, eye and nose toward the front
    hair_back(p, o, cx - 10, hc, rx, ry)
    p.ell(cx, hc, rx, ry, skin, OL)
    if o.get("hair") in ("messy", "short", "bob", "sides"):
        p.poly(ell_pts(cx, hc, rx * 1.03, ry * 1.03, 150, 300, n=20) + [(cx + rx * 0.15, hc - ry * 0.6), (cx - rx * 0.2, hc - ry * 0.1), (cx - rx * 0.62, hc + ry * 0.3)], o.get("haircol", "#4a2c1c"), OL)
    p.ell(cx - rx * 0.1, hc + 10, 16, 20, skin, 5)
    p.ell(cx + rx * 0.98, hc + ry * 0.12, 16, 14, mix_hex(skin, "#d9785a", 0.35) if o.get("nose") else skin, 5)
    p.ell(cx + rx * 0.55, hc + ry * 0.3, 16, 10, BLUSH, 0)
    kind_e, kind_b, kind_m = FACES.get(expr, FACES["neutral"])
    ex = cx + rx * 0.58
    if blink:
        p.stroke([(ex - 9, hc - ry * 0.1), (ex + 9, hc - ry * 0.1)], 5, INK)
    else:
        p.ell(ex, hc - ry * 0.1, 8, 11, INK, 0)
    if o.get("moustache"):
        p.poly(qcurve((cx + rx * 0.8, hc + ry * 0.3), (cx + rx * 0.5, hc + ry * 0.24), (cx + rx * 0.35, hc + ry * 0.46), 6) +
               qcurve((cx + rx * 0.35, hc + ry * 0.46), (cx + rx * 0.6, hc + ry * 0.5), (cx + rx * 0.85, hc + ry * 0.4), 6)[1:], o["moustache"], 5)
    else:
        p.arc(cx + rx * 0.72, hc + ry * 0.38, 12, 9, 20, 150, 5, INK)
    hat(p, o, cx, hc, rx, ry)
    _arm(p, (cx + 4, neck + 30), (cx + sw, tb - 40), 1, skin, None)
