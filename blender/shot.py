# Lay out one AI segment of an episode in Blender (2026-11-24, no three.js): open the location's set file, move the
# camera along the storyboard path, stand the Grease Pencil cast on their marks with their poses, render a quick
# layout "guide" that Seedance re-renders. Blender only has to get the composition right (VISUAL_DENSITY.md).
#   blender -b blender/sets/<scene>.blend --python blender/shot.py -- --timeline tl.json --segment '<json>' --out <dir>
#           [--quality draft|preview|final] [--frames a-b]   (a-b = timeline frames, for a quick look at a few frames)
# Set contract (blender/sets/<scene>.blend): geometry + lights in collection "Set"; cameras "CAM-<name>" (custom props
# kind, chars); character stand points "MARK-<role>" (empties, +Y = facing); action anchors "ACT-<name>".
# Characters and actions: blender/sets/<scene>.py (optional) with
#   CAST = [("baker", "baker", 0), ...]                       id, who, variant
#   def pose(ctx, shot, marks, acts, cam_pos) -> {id: {"at": (x, y, z), "o": {...pose options...}} | None}
import json, math, os, sys, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "draw"))
import bpy
from mathutils import Vector, Quaternion
sys.path.insert(0, HERE)
from people import pose_key
# Blender 5.3's F12/background Eevee draws live Grease Pencil over every mesh, so each pose is baked once to a cached
# transparent PNG (kit.card_png) and shown on an upright lit card plane that occludes and casts shadows.
from kit import card_png, card_mat, CARD_X, CARD_Z0, CARD_Z1


def log(*a):
    print("[shot]", *a, flush=True)


def opts():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = {}
    for i in range(len(a) - 1):
        if a[i].startswith("--"):
            o[a[i][2:]] = a[i + 1]
    return o


EASE = {"linear": lambda u: u, "smooth": lambda u: u * u * (3 - 2 * u), "out": lambda u: 1 - (1 - u) ** 3}


def cam_spec(c):
    return (c, c, "smooth") if isinstance(c, str) else (c["from"], c["to"], c.get("ease", "smooth"))


ON_TWOS = 2


class Cast:
    """one character: an empty that stands on its mark and turns to the camera, with one card plane per distinct pose
    parented to it; each frame shows exactly one card (hide_render keyed with constant interpolation)"""
    def __init__(self, cid, who, v, coll):
        self.cid, self.who, self.v, self.coll = cid, who, v, coll
        self.root = bpy.data.objects.new(f"CAST-{cid}", None)
        coll.objects.link(self.root)
        self.cards, self.shown = {}, {}       # pose key -> plane; frame -> pose key (None = off screen)

    def card(self, key, f, o):
        if key in self.cards:
            return self.cards[key]
        path = card_png(self.who, self.v, f, **o)
        me = bpy.data.meshes.new(f"{self.cid}-{len(self.cards):03d}")
        me.from_pydata([(-CARD_X, 0, CARD_Z0), (CARD_X, 0, CARD_Z0), (CARD_X, 0, CARD_Z1), (-CARD_X, 0, CARD_Z1)], [], [(0, 1, 2, 3)])
        uv = me.uv_layers.new(name="UVMap")
        for li, c in zip(me.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            uv.data[li.index].uv = c
        me.materials.append(card_mat(path))
        ob = bpy.data.objects.new(me.name, me)
        self.coll.objects.link(ob)
        ob.parent = self.root
        ob["card"] = path
        self.cards[key] = ob
        return ob

    def show(self, fr, f, q, cam_pos):
        if q is None:
            self.shown[fr] = None
            return
        prev = self.shown.get(fr - 1)
        if prev is not None and fr % ON_TWOS:   # 2D animation "on twos": the drawing changes every other frame
            key = prev
        else:
            key, _ = pose_key(self.who, self.v, f, q.get("o", {}))
            self.card(key, f, q.get("o", {}))
        self.shown[fr] = key
        at = Vector(q["at"])
        d = Vector(cam_pos) - at
        self.root.location = at
        self.root.rotation_euler = (0.0, 0.0, math.atan2(d.x, -d.y))   # the card's front (-Y) turns toward the camera
        self.root.keyframe_insert("location", frame=fr)
        self.root.keyframe_insert("rotation_euler", frame=fr)

    def finish(self):
        for key, ob in self.cards.items():
            for fr, k in sorted(self.shown.items()):
                ob.hide_render = ob.hide_viewport = k != key
                ob.keyframe_insert("hide_render", frame=fr)
                ob.keyframe_insert("hide_viewport", frame=fr)


def main():
    o = opts()
    tl = json.load(open(o["timeline"], encoding="utf-8"))
    seg = json.loads(o["segment"])
    out, quality = o["out"], o.get("quality", "draft")
    sc = bpy.context.scene
    scene_id = os.path.splitext(os.path.basename(bpy.data.filepath))[0]
    cams = {ob.name[4:]: ob for ob in sc.objects if ob.type == "CAMERA" and ob.name.startswith("CAM-")}
    marks = {ob.name[5:]: ob.matrix_world.copy() for ob in sc.objects if ob.name.startswith("MARK-")}
    acts = {ob.name[4:]: ob.matrix_world.translation.copy() for ob in sc.objects if ob.name.startswith("ACT-")}
    if not cams:
        raise SystemExit(f"{scene_id}.blend has no CAM-<name> camera")
    mod = None
    mpath = o.get("setmod") or os.path.join(HERE, "sets", f"{scene_id}.py")
    if os.path.exists(mpath):
        spec = importlib.util.spec_from_file_location(f"set_{scene_id}", mpath)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    else:
        log(f"chưa có blender/sets/{scene_id}.py: dựng bố cục không có nhân vật")
    shots = [s for s in tl["shots"] if s["id"] in seg["shots"]]
    fps, a, b = tl["fps"], seg["a"], seg["b"]
    if o.get("frames"):
        fa, fb = (int(x) for x in o["frames"].split("-"))
        a, b = max(a, fa), min(b, fb + 1)
    # the render camera follows the storyboard path between the set's CAM- objects
    rc = bpy.data.objects.new("RCAM", bpy.data.cameras.new("RCAM"))
    sc.collection.objects.link(rc)
    sc.camera = rc
    rc.rotation_mode = "QUATERNION"
    rc.data.sensor_fit = "VERTICAL"
    rc.data.dof.use_dof = True
    coll = bpy.data.collections.new("Cast")
    sc.collection.children.link(coll)
    people = {}
    if mod:
        for cid, who, v in mod.CAST:
            people[cid] = Cast(cid, who, v, coll)
    for f in range(a, b):
        s = next(x for x in shots if x["a"] <= f < x["b"])
        lf, dur = f - s["a"], (s["b"] - s["a"]) / fps
        u = lf / max(1, s["b"] - s["a"] - 1)
        span = (s.get("params") or {}).get("span")
        p = span[0] + (span[1] - span[0]) * u if span else u
        fr = f - seg["a"] + 1
        c_from, c_to, ease = cam_spec(s["camera"])
        A, B = cams.get(c_from), cams.get(c_to)
        if A is None or B is None:
            raise SystemExit(f"shot {s['id']}: camera {c_from}/{c_to} is not in {scene_id}.blend (have: {', '.join(sorted(cams))})")
        k = EASE.get(ease, EASE["smooth"])(u)
        la, qa_, _ = A.matrix_world.decompose()
        lb, qb, _ = B.matrix_world.decompose()
        rc.location = la.lerp(lb, k)
        rc.rotation_quaternion = qa_.slerp(qb, k)
        rc.data.lens = A.data.lens + (B.data.lens - A.data.lens) * k
        rc.data.sensor_height = A.data.sensor_height
        rc.data.dof.focus_distance = A.data.dof.focus_distance + (B.data.dof.focus_distance - A.data.dof.focus_distance) * k
        rc.data.dof.aperture_fstop = A.data.dof.aperture_fstop + (B.data.dof.aperture_fstop - A.data.dof.aperture_fstop) * k
        for key in ("location", "rotation_quaternion"):
            rc.keyframe_insert(key, frame=fr)
        for key in ("lens", "dof.focus_distance", "dof.aperture_fstop"):
            rc.data.keyframe_insert(key, frame=fr)
        if not people:
            continue
        acts_t = [{"name": e["name"], "t": e["sec"] - s["startSec"]} for e in tl["events"] if e["type"] == "action" and e["shot"] == s["id"]]
        ctx = {"f": f, "lf": lf, "t": lf / fps, "u": u, "p": p, "dur": dur, "fps": fps, "params": s.get("params") or {}, "actions": acts_t,
               "chars": bool(A.get("chars", True))}
        cam_pos = tuple(rc.location)
        poses = mod.pose(ctx, s, marks, acts, cam_pos) if ctx["chars"] else {}
        for cid, c in people.items():
            c.show(fr, f, poses.get(cid), cam_pos)
    for c in people.values():
        c.finish()
    # quick layout render: Eevee, few samples; no ink, no grade (Seedance paints the final look)
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            sc.render.engine = eng
            break
        except Exception:
            continue
    samples, pct = {"draft": (8, 50), "preview": (16, 100), "final": (32, 100)}.get(quality, (8, 50))
    sc.eevee.taa_render_samples = samples
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = tl["width"], tl["height"], pct
    sc.render.fps = fps
    sc.frame_start, sc.frame_end = a - seg["a"] + 1, b - seg["a"]
    sc.render.image_settings.file_format = "PNG"
    sc.render.filepath = os.path.join(out, "f####")
    sc.frame_set(sc.frame_start)
    log(f"{scene_id}: {seg['id']} khung {a}-{b - 1}, {len(people)} nhân vật, {sum(len(c.cards) for c in people.values())} thẻ tư thế, {quality}")
    bpy.ops.render.render(animation=True)
    log("xong")


main()
