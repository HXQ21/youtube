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
#   def frame(ctx, shot, fr)   optional, called every frame (also without characters): key set variants at render frame fr
# A single storyboard camera name X moves from CAM-X to CAM-XEnd when the set has both.
import json, math, os, sys, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "draw"))
import bpy
from mathutils import Vector, Quaternion
from bpy_extras.object_utils import world_to_camera_view
sys.path.insert(0, HERE)
from people import pose_key, SIZE, build_of
# Blender 5.3's F12/background Eevee draws live Grease Pencil over every mesh, so each pose is baked once to a cached
# transparent PNG (kit.card_png) and shown on an upright lit card plane that occludes and casts shadows.
from kit import card_png, card_mat, CARD_X, CARD_Z0, CARD_Z1
import camkit   # camera intelligence ported from three.js: level horizon, fit subjects, audit (#27)


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


def cam_spec(c, cams):
    """storyboard camera -> (from, to, ease). A single name X moves to CAM-XEnd when the set has one (e.g. orbit ->
    orbitEnd), so a storyboard written for three.js (one moving camera per name) still moves in Blender"""
    if isinstance(c, str):
        return (c, c + "End" if c + "End" in cams else c, "smooth")
    return (c["from"], c["to"], c.get("ease", "smooth"))


ON_TWOS = 1          # characters change pose every frame (2 read as stutter next to a moving camera, #23)
DRIFT_PUSH, DRIFT_SIDE = 0.08, 0.03


class Cast:
    """one character: an empty that stands on its mark and turns to the camera, with one card plane per distinct pose
    parented to it; each frame shows exactly one card (hide_render keyed with constant interpolation)"""
    def __init__(self, cid, who, v, coll):
        self.cid, self.who, self.v, self.coll = cid, who, v, coll
        self.root = bpy.data.objects.new(f"CAST-{cid}", None)
        coll.objects.link(self.root)
        self.cards, self.shown = {}, {}       # pose key -> plane; frame -> pose key (None = off screen)
        self.tops = {}                        # pose key -> top of the drawing above the feet (m): hats, raised hands
        self.crown, self.head = SIZE.get(build_of(who, v), SIZE["adult"])

    def top(self, fr):
        """highest drawn point of this frame's card (a toque or raised hands reach above the head)"""
        return max(self.crown, self.tops.get(self.shown.get(fr), self.crown))

    def check_points(self, fr):
        """(feet, face, top) heights the framing checks use for this frame"""
        return 0.0, self.head, self.top(fr)

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
        self.tops[key] = card_top(path)
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


def card_top(path):
    """height above the feet of the highest opaque pixel of a card PNG (card frame CARD_Z0..CARD_Z1)"""
    import numpy as np
    img = bpy.data.images.load(path, check_existing=True)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    rows = np.where(px.reshape(h, w, 4)[:, :, 3].max(axis=1) > 0.5)[0]       # row 0 is the bottom in Blender
    return CARD_Z0 + (rows.max() + 1) / h * (CARD_Z1 - CARD_Z0) if len(rows) else CARD_Z1


def framing(sc, cam, people, frames, out):
    """the subject must stay inside the frame (three.js stage.ts frame() did this by construction; hand-placed Blender
    cameras do not, #24). Subjects: objects named SUBJ-* (or custom prop subject=1), else the small object under the
    frame centre at the focus distance; plus each visible character's head. Writes frame_check.json, returns issues."""
    issues, dg = [], None
    def box_out(ob):
        # how much of the projected bounding box lies outside the frame, as a share of its size (0 = all inside)
        pts = [world_to_camera_view(sc, cam, ob.matrix_world @ Vector(c)) for c in ob.bound_box]
        pts = [p for p in pts if p.z > 0]
        if len(pts) < 8:
            return 1.0
        x0, x1 = min(p.x for p in pts), max(p.x for p in pts)
        y0, y1 = min(p.y for p in pts), max(p.y for p in pts)
        w, h = max(1e-6, x1 - x0), max(1e-6, y1 - y0)
        return max((max(0, -x0) + max(0, x1 - 1)) / w, (max(0, -y0) + max(0, y1 - 1)) / h)
    tagged = [ob for ob in sc.objects if ob.type == "MESH" and (ob.name.startswith("SUBJ-") or ob.get("subject"))]
    for fr in frames:
        sc.frame_set(fr)
        dg = bpy.context.evaluated_depsgraph_get()
        subs = [ob for ob in tagged if not ob.hide_render and min(ob.matrix_world.to_scale()) > 1e-3]
        if not subs:
            mw = cam.matrix_world
            hit, loc, _n, _i, ob, _m = sc.ray_cast(dg, mw.translation, (mw.to_quaternion() @ Vector((0, 0, -1))).normalized())
            if hit and ob and ob.type == "MESH" and max(ob.dimensions) < 1.5 and not (ob.parent and ob.parent.name.startswith("CAST-")):
                subs = [ob]
        for ob in subs:
            o = box_out(ob)
            if o > 0.15:
                issues.append({"fr": fr, "what": "món/vật chính bị cắt", "name": ob.name, "out": round(o, 2)})
        for c in people.values():
            key = c.shown.get(fr)
            if key is None:
                continue
            base = c.root.matrix_world.translation
            _feet, head_h, top_h = c.check_points(fr)
            face = world_to_camera_view(sc, cam, base + Vector((0, 0, head_h)))    # head centre for this build
            crown = world_to_camera_view(sc, cam, base + Vector((0, 0, top_h)))     # top of the drawing (hat included)
            on = face.z > 0 and 0.0 <= face.x <= 1.0 and 0.0 <= face.y <= 1.0
            if on and crown.y > 1.0:
                issues.append({"fr": fr, "what": "đầu nhân vật bị cắt ở mép trên", "name": c.cid, "out": round(crown.y - 1.0, 2)})
            elif face.z > 0 and 0.0 <= face.y <= 1.0 and (-0.06 < face.x < 0.0 or 1.0 < face.x < 1.06):
                issues.append({"fr": fr, "what": "mặt nhân vật lọt ở mép khung", "name": c.cid, "out": round(min(abs(face.x), abs(face.x - 1)), 2)})
    json.dump(issues, open(os.path.join(out, "frame_check.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return issues


def fit_shots(sc, rc, people, frame_shot):
    """three.js frame() guaranteed the subject fits; hand-placed Blender cameras do not. Per shot, dolly the camera
    back along its own view axis by the smallest factor (up to camkit.FIT_MAX) that keeps every SUBJ- object and every
    visible character's head inside the safe frame on sampled frames; the cards are turned to the new camera.
    Returns {shot id: factor (1.0 = untouched) or None (could not fit)}."""
    view = bpy.context.view_layer
    tagged = [ob for ob in sc.objects if ob.type == "MESH" and (ob.name.startswith("SUBJ-") or ob.get("subject"))]
    by_shot = {}
    for fr, sid in sorted(frame_shot.items()):
        by_shot.setdefault(sid, []).append(fr)
    def state(fr):
        sc.frame_set(fr)
        q = rc.rotation_quaternion.copy()
        return rc.location.copy(), q @ Vector((0.0, 0.0, -1.0)), (rc.data.dof.focus_distance if rc.data.dof.focus_distance > 0.05 else 3.0)
    def ok_at(fr, f):
        loc, fwd, dist = state(fr)
        rc.location = loc - fwd * dist * (f - 1.0)
        view.update()
        subs = [ob for ob in tagged if not ob.hide_render and min(ob.matrix_world.to_scale()) > 1e-3]
        ppl = [(c.root.matrix_world.translation.copy(), c.cid, c.head, c.top(fr)) for c in people.values() if c.shown.get(fr) is not None]
        return camkit.subjects_ok(sc, rc, subs, ppl)
    out = {}
    for sid, frs in by_shot.items():
        sample = sorted(set(frs[::4] + [frs[-1]]))
        steps = [1.0 + 0.08 * i for i in range(int((camkit.FIT_MAX - 1.0) / 0.08) + 1)]
        f = next((x for x in steps if all(ok_at(fr, x) for fr in sample)), None)
        out[sid] = f
        if not f or f <= 1.0:
            continue
        for fr in frs:
            loc, fwd, dist = state(fr)
            rc.location = loc - fwd * dist * (f - 1.0)
            rc.keyframe_insert("location", frame=fr)
            rc.data.dof.focus_distance = dist * f
            rc.data.keyframe_insert("dof.focus_distance", frame=fr)
            view.update()
            for c in people.values():
                if c.shown.get(fr) is None:
                    continue
                d = rc.location - c.root.location
                c.root.rotation_euler = (0.0, 0.0, math.atan2(d.x, -d.y))
                c.root.keyframe_insert("rotation_euler", frame=fr)
    return out


def audit(sc, rc, people, frame_shot, frame_cam, out):
    """camcheck for Blender (src/core/direct.ts RULES): elevation over a visible character's head (warn past 12
    degrees, 18 for drama set-ups, error past 20), a big card near the frame edge under a wide lens (DISTORT), and a
    camera that jumps between two frames of the same shot (CAM_JUMP). Writes camera_audit.json."""
    rows, prev = [], None
    for fr in sorted(frame_shot):
        sc.frame_set(fr)
        pos, fwd = rc.matrix_world.translation.copy(), (rc.matrix_world.to_quaternion() @ Vector((0.0, 0.0, -1.0)))
        if prev and prev[0] == frame_shot[fr]:
            ang = math.degrees(prev[1].angle(fwd, 0.0))
            if ang > camkit.JUMP_DEG:
                rows.append({"fr": fr, "level": "warn", "code": "CAM_JUMP", "who": frame_shot[fr], "value": round(ang, 1)})
        prev = (frame_shot[fr], fwd)
        chars, drama = frame_cam.get(fr, (True, False))
        if not chars:
            continue
        limit = camkit.PITCH_DRAMA if drama else camkit.PITCH_WARN
        for c in people.values():
            if c.shown.get(fr) is None:
                continue
            base = c.root.matrix_world.translation
            face = world_to_camera_view(sc, rc, base + Vector((0.0, 0.0, c.head)))
            if face.z <= 0 or not (0.0 <= face.x <= 1.0 and 0.0 <= face.y <= 1.0):
                continue
            p = camkit.pitch_deg(pos, base, c.head)
            if abs(p) > camkit.PITCH_ERR:
                rows.append({"fr": fr, "level": "error", "code": "PITCH", "who": c.cid, "value": round(p, 1)})
            elif abs(p) > limit:
                rows.append({"fr": fr, "level": "warn", "code": "PITCH", "who": c.cid, "value": round(p, 1)})
            # OCCLUDED: something stands between the lens and the face (three.js camcheck OCCLUDED)
            head_w = base + Vector((0.0, 0.0, c.head))
            ray = head_w - pos
            hit, _loc, _n, _i, hob, _m = sc.ray_cast(bpy.context.evaluated_depsgraph_get(), pos, ray.normalized(), distance=max(0.0, ray.length - 0.15))
            if hit and hob is not None and not (hob.parent and hob.parent.name.startswith("CAST-")):   # people in front of people are fine
                rows.append({"fr": fr, "level": "warn", "code": "OCCLUDED", "who": c.cid, "value": hob.name})
            # MIN_DIST: a flat card closer than 0.6 m to the lens reads as a cardboard cut-out
            if ray.length < camkit.MIN_DIST:
                rows.append({"fr": fr, "level": "warn", "code": "MIN_DIST", "who": c.cid, "value": round(ray.length, 2)})
            feet = world_to_camera_view(sc, rc, base)
            crown = world_to_camera_view(sc, rc, base + Vector((0.0, 0.0, c.top(fr))))
            if crown.y - feet.y > 0.5 and camkit.vfov(rc) > camkit.EDGE_FOV and (face.x < 0.12 or face.x > 0.88):
                rows.append({"fr": fr, "level": "warn", "code": "DISTORT", "who": c.cid, "value": round(face.x, 2)})
    # one row per (code, who, shot) keeps the report readable
    seen, uniq = set(), []
    for r in rows:
        k = (r["code"], r["who"], frame_shot.get(r["fr"]))
        if k not in seen:
            seen.add(k)
            uniq.append(r)
    json.dump(uniq, open(os.path.join(out, "camera_audit.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return uniq


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
    # a segment shorter than the clip Seedance makes (4 s minimum) is rendered to the full clip length: the last shot
    # holds (camera at its end, cyclic actions keep going), so the AI clip's first seconds keep the guide's timing
    b = max(b, a + round(float(seg.get("genSec", 0)) * fps))
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
        for cid, who, v in getattr(mod, "CAST", []):
            people[cid] = Cast(cid, who, v, coll)
    frame_shot, frame_cam = {}, {}
    for f in range(a, b):
        s = next((x for x in shots if x["a"] <= f < x["b"]), shots[-1])     # past the story: hold the last shot
        lf, dur = f - s["a"], (s["b"] - s["a"]) / fps
        u = min(1.0, lf / max(1, s["b"] - s["a"] - 1))
        span = (s.get("params") or {}).get("span")
        p = span[0] + (span[1] - span[0]) * u if span else u
        fr = f - seg["a"] + 1
        c_from, c_to, ease = cam_spec(s["camera"], cams)
        A, B = cams.get(c_from), cams.get(c_to)
        if A is None or B is None:
            raise SystemExit(f"shot {s['id']}: camera {c_from}/{c_to} is not in {scene_id}.blend (have: {', '.join(sorted(cams))})")
        k = EASE.get(ease, EASE["smooth"])(u)
        la, qa_, _ = A.matrix_world.decompose()
        lb, qb, _ = B.matrix_world.decompose()
        rc.location = la.lerp(lb, k)
        rc.rotation_quaternion = qa_.slerp(qb, k)
        if people and A.get("chars", True):
            rc.rotation_quaternion = camkit.level(rc.rotation_quaternion)     # flat cards: never a rolled camera
        frame_shot[fr] = s["id"]
        frame_cam[fr] = (bool(A.get("chars", True)), bool(A.get("drama", False) or B.get("drama", False)))
        if A is B and not s.get("static"):
            # one camera and no CAM-<name>End: a slow push-in and sideways drift so the shot is never a frozen frame
            # (like three.js stage.ts drift; here 8 % toward the subject, 3 % sideways). The CAM's custom props push/side tune it.
            d = A.data.dof.focus_distance if A.data.dof.focus_distance > 0.05 else 3.0
            fwd, right = qa_ @ Vector((0.0, 0.0, -1.0)), qa_ @ Vector((1.0, 0.0, 0.0))
            sm = EASE["smooth"](u)
            rc.location = la + fwd * (d * float(A.get("push", DRIFT_PUSH)) * sm) + right * (d * float(A.get("side", DRIFT_SIDE)) * (sm - 0.5))
        rc.data.lens = A.data.lens + (B.data.lens - A.data.lens) * k
        rc.data.sensor_height = A.data.sensor_height
        rc.data.dof.focus_distance = A.data.dof.focus_distance + (B.data.dof.focus_distance - A.data.dof.focus_distance) * k
        rc.data.dof.aperture_fstop = A.data.dof.aperture_fstop + (B.data.dof.aperture_fstop - A.data.dof.aperture_fstop) * k
        if A is B and not s.get("static"):
            rc.data.dof.focus_distance = max(0.05, rc.data.dof.focus_distance - d * float(A.get("push", DRIFT_PUSH)) * sm)   # keep the subject sharp
        for key in ("location", "rotation_quaternion"):
            rc.keyframe_insert(key, frame=fr)
        for key in ("lens", "dof.focus_distance", "dof.aperture_fstop"):
            rc.data.keyframe_insert(key, frame=fr)
        if not mod:
            continue
        acts_t = [{"name": e["name"], "t": e["sec"] - s["startSec"]} for e in tl["events"] if e["type"] == "action" and e["shot"] == s["id"]]
        ctx = {"f": f, "fr": fr, "lf": lf, "t": lf / fps, "u": u, "p": p, "dur": dur, "fps": fps, "params": s.get("params") or {}, "actions": acts_t,
               "chars": bool(A.get("chars", True))}
        if hasattr(mod, "frame"):        # every frame, with or without characters: the set keys its own variants (items, backdrops, place)
            mod.frame(ctx, s, fr)
        if not people:
            continue
        cam_pos = tuple(rc.location)
        poses = mod.pose(ctx, s, marks, acts, cam_pos) if ctx["chars"] and hasattr(mod, "pose") else {}
        for cid, c in people.items():
            c.show(fr, f, poses.get(cid), cam_pos)
    for c in people.values():
        c.finish()
    # who is actually on screen in this segment: film.mjs sends their cast sheets (not a fixed sheet) to Seedance
    os.makedirs(out, exist_ok=True)
    seen = [{"id": c.cid, "who": c.who, "v": c.v, "frames": sum(1 for k in c.shown.values() if k is not None)} for c in people.values()]
    json.dump([x for x in seen if x["frames"]], open(os.path.join(out, "cast.json"), "w", encoding="utf-8"), indent=1)
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
    if o.get("nofit") != "1":
        fits = fit_shots(sc, rc, people, frame_shot)
        for sid, f in fits.items():
            if f is None:
                log(f"CHÚ Ý khung hình: shot {sid}: lùi máy tới {camkit.FIT_MAX:.1f} lần vẫn chưa giữ được món hoặc đầu nhân vật trong khung; sửa máy trong bối cảnh")
            elif f > 1.0:
                log(f"shot {sid}: máy lùi {f:.2f} lần để giữ món và đầu nhân vật trong khung")
    aud = audit(sc, rc, people, frame_shot, frame_cam, out)
    errs = [x for x in aud if x["level"] == "error"]
    if aud:
        log(f"CHÚ Ý máy quay: {len(errs)} lỗi, {len(aud) - len(errs)} cảnh báo: " + "; ".join(sorted({f'{x["code"]} {x["who"]}' for x in aud})[:6]))
    sc.render.fps = fps
    sc.frame_start, sc.frame_end = a - seg["a"] + 1, b - seg["a"]
    sc.render.image_settings.file_format = "PNG"
    sc.render.filepath = os.path.join(out, "f####")
    story_end = min(seg["b"], b) - seg["a"]        # the padded tail is not checked
    chk = framing(sc, rc, people, list(range(sc.frame_start, story_end + 1, 6)) or [sc.frame_start], out)
    if chk:
        names = sorted({f'{i["what"]} ({i["name"]})' for i in chk})
        log(f"CHÚ Ý khung hình: {len(chk)} lần kiểm có lỗi: {'; '.join(names[:6])}")
    sc.frame_set(sc.frame_start)
    log(f"{scene_id}: {seg['id']} khung {a}-{b - 1}, {len(people)} nhân vật, {sum(len(c.cards) for c in people.values())} thẻ tư thế, {quality}")
    bpy.ops.render.render(animation=True)
    log("xong")


main()
