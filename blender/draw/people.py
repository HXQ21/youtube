# The food-story cast on top of toon.py (port of src/scenes/people.ts): outfits per role, the baker's cap and apron,
# a held roll, and Person - one Grease Pencil character in a Blender scene whose drawing follows its pose each frame.
# Unnamed, representative people only: bakers, customers, workers. Never a portrait of a real historical person.
# FRONT drawing for anyone who stands, works or talks; SIDE drawing only for someone crossing the frame (the stride is
# tied to the ground speed, so feet do not slide; walking left is the same drawing mirrored).
import math
from pen import Pen, INK
from toon import SKINS, body_front, body_side
import brand

STYLE = "brand"   # "brand" = the new cast after brand/character sheets (2026-11-24); "toon" = the old bean-head cast

SU = 0.00216                     # metres per design unit
STRIDE = 0.72
STEP_M = 2 * 370 * SU * STRIDE   # ground covered by one full walk cycle of the side drawing
SIZE = {"adult": (1.68, 1.44), "stout": (1.68, 1.44), "slim": (1.68, 1.44), "kid": (1.29, 1.07)}   # crown, head centre above the feet (m)
COATS = ["#3f6fb5", "#8c3b4a", "#5d7a3a", "#b5653f", "#2f5f6a", "#7b5ac9"]


def outfit_for(who, v):
    skin = SKINS[v % 4]
    if who == "baker":   # a coloured neckerchief on every working outfit (FEEDBACK_LOG #14)
        o = dict(jacket="#f3efe4", pants="#6a5a4a", boots="#4a3426", skin=skin, build="stout" if v % 2 else "adult", neck=["#c8402f", "#3f6fb5", "#d9a441"][v % 3])
        if v % 3 == 1:
            o["moustache"] = "#4a3426"
        return o
    if who == "chef":    # classic baker from the channel's character sheet: toque, double-breasted jacket, apron, red neckerchief
        return dict(jacket="#fbf8f0", pants="#4a4650", boots="#3a2a20", skin=skin, build="stout", moustache="#4a2f20", hat="toque", neck="#d23a32",
                    apron="#fffdf6", flour=True, buttons2=True, bigMoustache=True)
    if who == "apprentice":
        return dict(jacket="#e9e2d0", pants="#5a5046", boots="#4a3426", skin=skin, build="kid", neck="#3f8a5a")
    if who == "towns":   # early-modern townsfolk: caps and bonnets, no top hats
        if v % 2:
            return dict(jacket=COATS[v % 6], pants="#3b3f52", boots="#4a3426", skin=skin, hat="bonnet", dress=["#a8763a", "#8a5a6a", "#56708a"][v % 3])
        return dict(jacket=COATS[(v + 2) % 6], pants="#4a4238", boots="#3a2a20", skin=skin, hat="cap", cap="#6a4a32")
    if who == "paris":   # 1830s-1840s Paris street: top hats and bonnets
        if v % 2:
            return dict(jacket=COATS[(v + 1) % 6], pants="#3b3f52", boots="#4a3426", skin=skin, hat="bonnet", dress=["#d9a441", "#c25a7a", "#5a8fc2"][v % 3])
        return dict(jacket=["#2f3a52", "#4a2f3a", "#33453a"][v % 3], pants="#c9c2b0", boots="#2a2a2a", skin=skin, hat="tophat")
    if who == "officer":  # a generic 1830s army officer (representative figure, not a portrait)
        return dict(jacket="#5b4f46", pants="#d8d2c2", boots="#2a2a2a", skin=skin, hat="shako", buttons="#e8c45a", belt=None, build="adult")
    if who == "worker":
        return dict(jacket="#eef3f6", pants="#9fb0bd", boots="#f4f1ea", skin=skin, hat="cap", cap="#eef3f6")
    return dict(jacket=["#e2453c", "#2f8f9d", "#f0b429", "#6c5ce7"][v % 4], pants="#3b4a6a", boots="#f4f1ea", skin=skin, hat="hair",
                hair=["#5a3b2a", "#2a201a", "#b58a4a", "#7a3a2a"][v % 4])


def build_of(who, v):
    o = brand.outfit(who, v) if STYLE == "brand" else outfit_for(who, v)
    return o.get("build") or "adult"


def can_walk_side(who, v):
    return not outfit_for(who, v).get("dress")


def baker_extras(p, stout):
    """soft cloth cap + apron for bakers (drawn over the standard body)"""
    p.rot = None
    w = 78 if stout else 66
    p.poly([(300 - w, 462), (300 + w, 462), (300 + w + 6, 668), (300 - w - 6, 668)], "#fbf8f0", 7)
    p.stroke([(300 - w, 462), (300 - 40, 428)], 7)
    p.stroke([(300 + w, 462), (300 + 40, 428)], 7)
    p.ell(300, 206, 96, 46, "#fbf8f0", 8)
    p.ell(300, 176, 80, 52, "#fbf8f0", 8, 180, 360)


def draw_person(p, who, v, **o):
    of = outfit_for(who, v)
    o.setdefault("mode", "stand")
    body_front(p, of, seed=v * 3 + 1, **o)
    if who == "baker" and not o.get("tilt"):
        baker_extras(p, of.get("build") == "stout")


def to_canvas(h):
    return (300 + h[0] / SU, 975 - h[1] / SU)


def held_roll(p, x, y, croissant):
    pts = [(x + 30 * math.cos(math.pi * (1.15 + 0.7 * i / 14)), y + 26 + 30 * math.sin(math.pi * (1.15 + 0.7 * i / 14))) for i in range(15)]
    p.stroke(pts, 24 if croissant else 19, INK)
    p.stroke(pts, 17 if croissant else 12, "#d98f3c" if croissant else "#e6b56a")
    if croissant:
        for k in (4, 7, 10):
            p.stroke([(pts[k][0] - 4, pts[k][1] - 7), (pts[k][0] + 4, pts[k][1] + 7)], 2.5, "#8a4f22")
    p.dot(x, y, 12)


def pose_key(who, v, f, o):
    """the drawing for this pose: (key, primitives function). Same key = same picture (drawn once, reused)."""
    blink = (f + v * 37) % 113 < 4
    if o.get("side"):
        sd = o["side"]
        phase = round(((sd["dist"] / STEP_M) % 1 + 1) % 1 * 24) / 24
        key = f"{STYLE}|side|{who}|{v}|{phase}|{sd['dir']}|{int(blink)}"

        def draw():
            p = Pen(mirror=sd["dir"] < 0)
            if STYLE == "brand":
                brand.draw_side(p, brand.outfit(who, v), phase=phase, expr=o.get("expr", "neutral"), blink=blink, stride=STRIDE)
                return p.prims
            body_side(p, outfit_for(who, v), mode="march", phase=phase, stride=STRIDE, stomp=0.75, expr=o.get("expr", "neutral"), blink=blink, seed=v * 3 + 1)
            return p.prims
        return key, draw
    wave = round(o["wave"] * 6) / 6 if o.get("wave") is not None else None
    walking = o.get("walk") is not None
    phase = round((o["walk"] % 1) * 12) / 12 if walking else 0
    hands = [tuple(round(c) for c in to_canvas(h)) if h else None for h in o["hands"]] if o.get("hands") else None
    key = f"{STYLE}|front|{who}|{v}|{o.get('expr', 'neutral')}|{int(blink)}|{wave}|{o.get('look', 0)}|{phase}|{walking}|{hands}|{o.get('hold')}"

    def draw():
        p = Pen()
        if STYLE == "brand":
            hs = brand.draw_front(p, brand.outfit(who, v), expr=o.get("expr", "neutral"), blink=blink, hands=hands, look=o.get("look", 0))
            if o.get("hold") and hands and hands[1]:
                held_roll(p, hs[1][0], hs[1][1], o["hold"] == "croissant")
            return p.prims
        draw_person(p, who, v, expr=o.get("expr", "neutral"), blink=blink, mode="stroll" if walking else "stand", phase=phase, wave=wave, look=o.get("look", 0), hands=hands)
        if o.get("hold") and hands and hands[1]:
            held_roll(p, hands[1][0], hands[1][1], o["hold"] == "croissant")
        return p.prims
    return key, draw
