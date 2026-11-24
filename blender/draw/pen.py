# The character pen, drawn with Blender Grease Pencil (2026-11-24: Blender draws the 2D cast, three.js is gone).
# Same drawing calls as the old canvas Pen (src/videos/bridge/toon.ts): poly / ell / line / stroke / arc / dot / clip /
# shadedFill / gradFill / inkRing / band, in the same design space (600 x 1000 units, y DOWN, soles at y = 975).
# The pen only RECORDS primitives; blender/draw/gpwrite.py turns them into Grease Pencil strokes. Two primitives:
#   ("fill", pts, colour)                         a filled polygon, no outline
#   ("line", pts, colour, widths, closed, cap)    a stroke; widths = one per point (full width, design units)
# Soft painted gradients become stacked flat fills (cel steps), clips become polygon clips: both stay vector.
import math

INK = "#241726"


def rad(d):
    return d * math.pi / 180.0


def ell_pts(cx, cy, rx, ry, a0=0.0, a1=360.0, rot=0.0, n=48):
    r, out = rad(rot), []
    for i in range(n + 1):
        a = rad(a0 + (a1 - a0) * i / n)
        x, y = rx * math.cos(a), ry * math.sin(a)
        out.append((cx + x * math.cos(r) - y * math.sin(r), cy + x * math.sin(r) + y * math.cos(r)))
    return out


# ---------------------------------------------------------------- polygon helpers
def _area(pts):
    return 0.5 * sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))


def hull(pts):
    """convex hull (monotone chain), counter-clockwise in math orientation"""
    p = sorted(set((round(x, 6), round(y, 6)) for x, y in pts))
    if len(p) < 3:
        return p
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for q in p:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], q) <= 0:
            lo.pop()
        lo.append(q)
    for q in reversed(p):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], q) <= 0:
            hi.pop()
        hi.append(q)
    return lo[:-1] + hi[:-1]


def clip_poly(subject, convex):
    """Sutherland-Hodgman: the part of any polygon inside a convex polygon"""
    if len(convex) < 3 or len(subject) < 3:
        return []
    cv = convex if _area(convex) > 0 else list(reversed(convex))
    out = list(subject)
    for i in range(len(cv)):
        a, b = cv[i], cv[(i + 1) % len(cv)]
        inside = lambda q: (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]) >= 0
        def cut(p, q):
            dx, dy = q[0] - p[0], q[1] - p[1]
            den = (b[0] - a[0]) * dy - (b[1] - a[1]) * dx
            if abs(den) < 1e-12:
                return q
            t = ((b[0] - a[0]) * (a[1] - p[1]) - (b[1] - a[1]) * (a[0] - p[0])) / den
            return (p[0] + t * dx, p[1] + t * dy)
        src, out = out, []
        if not src:
            break
        prev = src[-1]
        for cur in src:
            if inside(cur):
                if not inside(prev):
                    out.append(cut(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(cut(prev, cur))
            prev = cur
    return out


def clip_line(pts, convex):
    """the pieces of a polyline inside a convex polygon (Cyrus-Beck per segment)"""
    cv = convex if _area(convex) > 0 else list(reversed(convex))
    pieces, cur = [], []
    for i in range(len(pts) - 1):
        p, q = pts[i], pts[i + 1]
        t0, t1, ok = 0.0, 1.0, True
        for j in range(len(cv)):
            a, b = cv[j], cv[(j + 1) % len(cv)]
            nx, ny = -(b[1] - a[1]), b[0] - a[0]             # inward normal for a CCW polygon
            den = nx * (q[0] - p[0]) + ny * (q[1] - p[1])
            num = nx * (p[0] - a[0]) + ny * (p[1] - a[1])
            if abs(den) < 1e-12:
                if num < 0:
                    ok = False
                    break
                continue
            t = -num / den
            if den > 0:
                t0 = max(t0, t)
            else:
                t1 = min(t1, t)
            if t0 > t1:
                ok = False
                break
        if not ok:
            if cur:
                pieces.append(cur)
                cur = []
            continue
        A = (p[0] + t0 * (q[0] - p[0]), p[1] + t0 * (q[1] - p[1]))
        B = (p[0] + t1 * (q[0] - p[0]), p[1] + t1 * (q[1] - p[1]))
        if not cur:
            cur = [A]
        elif math.hypot(cur[-1][0] - A[0], cur[-1][1] - A[1]) > 1e-6:
            pieces.append(cur)
            cur = [A]
        cur.append(B)
        if t1 < 1.0:
            pieces.append(cur)
            cur = []
    if len(cur) > 1:
        pieces.append(cur)
    return [x for x in pieces if len(x) > 1]


def _hex(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def mix_hex(a, b, t):
    A, B = _hex(a), _hex(b)
    return "#" + "".join(f"{round((x * (1 - t) + y * t) * 255):02x}" for x, y in zip(A, B))


# ---------------------------------------------------------------- the pen
class Pen:
    BANDS = 6          # steps a soft gradient becomes (plus the flat base); 3-4 showed as diagonal stripes on dresses

    def __init__(self, mirror=False):
        self.ol = 12
        self.rot = None       # [angle, cx, cy] (+ optional dx, dy) rotation about (cx, cy), like the canvas Pen
        self.mirror = mirror  # drawn mirrored about x = 300 (walking left)
        self.prims = []
        self._clip = None     # convex clip polygon in final coordinates

    def P(self, x, y):
        if self.rot:
            r = self.rot
            a, cx, cy = r[0], r[1], r[2]
            dx = r[3] if len(r) > 3 else 0
            dy = r[4] if len(r) > 4 else 0
            c, s = math.cos(a), math.sin(a)
            x, y = cx + (x - cx) * c - (y - cy) * s + dx, cy + (x - cx) * s + (y - cy) * c + dy
        return (600 - x, y) if self.mirror else (x, y)

    def _T(self, pts):
        return [self.P(x, y) for x, y in pts]

    # -- raw primitives (final coordinates)
    def _fill(self, pts, col):
        if self._clip is not None:
            pts = clip_poly(pts, self._clip)
        if len(pts) >= 3:
            self.prims.append(("fill", pts, col))

    def _line(self, pts, col, w, closed=False, cap="round"):
        ws = w if isinstance(w, list) else [w] * len(pts)
        if self._clip is not None:
            for piece in clip_line(pts + ([pts[0]] if closed else []), self._clip):
                self.prims.append(("line", piece, col, [ws[0]] * len(piece), False, cap))
            return
        if len(pts) >= 2:
            self.prims.append(("line", pts, col, ws, closed, cap))

    # -- canvas Pen API
    def poly(self, pts, fill, ol=None):
        w = self.ol if ol is None else ol
        t = self._T(pts)
        if fill:
            self._fill(t, fill)
        if w:
            self._line(t, INK, w, closed=True)

    def ell(self, cx, cy, rx, ry, fill, ol=None, a0=0, a1=360, rot=0):
        self.poly(ell_pts(cx, cy, rx, ry, a0, a1, rot), fill, ol)

    def line(self, pts, fill, w, ink=True):
        t = self._T(pts)
        if ink:
            self._line(t, INK, w + 2 * self.ol * 0.9)
        self._line(t, fill, w)

    def stroke(self, pts, w, fill=INK):
        self._line(self._T(pts), fill, w)

    def arc(self, cx, cy, rx, ry, a0, a1, w, fill=INK):
        pts = [(cx + rx * math.cos(rad(a0 + (a1 - a0) * i / 24)), cy + ry * math.sin(rad(a0 + (a1 - a0) * i / 24))) for i in range(25)]
        self.stroke(pts, w, fill)

    def dot(self, cx, cy, r, fill=INK):
        x, y = self.P(cx, cy)
        self._fill(ell_pts(x, y, r, r, n=20)[:-1], fill)

    def clip(self, pts, fn):
        old, self._clip = self._clip, hull(self._T(pts))
        fn()
        self._clip = old

    def shadedFill(self, pts, base, shadow, light, R, shift=0.45, r0=1.05, r1=1.25):
        """canvas: radial gradient about a point shifted toward the light, base up to r0*R, ramp to shadow at r1*R.
        Here: k flat rings, each coloured at the MIDDLE of its part of the ramp (no darker-than-canvas bias)."""
        n = len(pts)
        cx, cy = sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n
        gx, gy = self.P(cx + math.cos(light) * shift * R, cy + math.sin(light) * shift * R)
        t = self._T(pts)
        self._fill(t, shadow)                                  # beyond r1
        k = self.BANDS
        for j in range(k - 1, -2, -1):                         # outer ring first; j = -1 is the flat base disk
            rr = (r0 + (r1 - r0) * (j + 1) / k) * R
            part = clip_poly(t, ell_pts(gx, gy, rr, rr, n=40)[:-1])
            if len(part) >= 3:
                self._fill(part, base if j < 0 else mix_hex(base, shadow, (j + 0.5) / k))

    def gradFill(self, pts, base, shadow, light, flat=0.22):
        """canvas: linear gradient lit edge -> far edge, base up to `flat`, then a ramp to shadow.
        Here: k flat bands across the ramp, each coloured at the middle of its stretch."""
        dx, dy, n = math.cos(light), math.sin(light), len(pts)
        cx, cy = sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n
        ds = [x * dx + y * dy for x, y in pts]
        lo, hi, dc = min(ds), max(ds), cx * dx + cy * dy
        A = self.P(cx + dx * (hi - dc), cy + dy * (hi - dc))      # lit edge
        B = self.P(cx + dx * (lo - dc), cy + dy * (lo - dc))      # far edge
        t = self._T(pts)
        ux, uy = B[0] - A[0], B[1] - A[1]
        L = math.hypot(ux, uy) or 1.0
        ux, uy = ux / L, uy / L
        px, py = -uy, ux
        big = 4000.0
        k = self.BANDS
        self._fill(t, mix_hex(base, shadow, (k - 0.5) / k))   # the band at the far edge covers the whole shape
        for j in range(k - 2, -2, -1):                         # nearer bands on top; j = -1 is the flat base
            f = flat + (1.0 - flat) * (j + 1) / k
            ex, ey = A[0] + ux * f * L, A[1] + uy * f * L
            half = [(A[0] - ux * big + px * big, A[1] - uy * big + py * big), (A[0] - ux * big - px * big, A[1] - uy * big - py * big),
                    (ex - px * big, ey - py * big), (ex + px * big, ey + py * big)]
            part = clip_poly(t, half)
            if len(part) >= 3:
                self._fill(part, base if j < 0 else mix_hex(base, shadow, (j + 0.5) / k))

    def inkRing(self, pts, w0, thick, k=0.45, col=INK):
        n = len(pts)
        cx, cy = sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n
        ws = [w0 * (1 + k * math.cos(math.atan2(q[1] - cy, q[0] - cx) - thick)) for q in pts]
        t = self._T(pts)
        if self._clip is None:
            self.prims.append(("line", t, col, ws, True, "round"))
        else:
            self._line(t, col, ws, closed=True)

    def band(self, pts, fill, w, rim, cap="butt"):
        c = "flat" if cap == "butt" else "round"
        t = self._T(pts)
        self._line(t, INK, w + 2 * rim, cap=c)
        self._line(t, fill, w, cap=c)
