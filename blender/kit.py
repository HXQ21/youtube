# Small builder kit for Blender-made scenes (2026-11-24: Blender lays out the composition, Seedance re-renders the look).
# Main colours + simple light only: flat Principled colours, a few procedural cues (brick, planks) so Seedance can read
# what a surface is. Blender is Z-up, metres. Characters are Grease Pencil drawings (blender/draw) turned to the camera.
import bpy, bmesh, math, os, sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (HERE, os.path.join(HERE, "draw")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from gpwrite import new_character, write, hex_lin     # noqa: E402
from pen import Pen                                   # noqa: E402
from people import pose_key, SIZE, build_of           # noqa: E402

SHARED = os.path.normpath(os.path.join(HERE, "..", "public", "assets", "shared"))


# ---------------------------------------------------------------- scene + collections
def fresh_scene(name):
    sc = bpy.data.scenes.get(name)
    if sc is not None:
        for ob in list(sc.collection.all_objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        for c in list(sc.collection.children_recursive):
            bpy.data.collections.remove(c)
    else:
        sc = bpy.data.scenes.new(name)
    return sc


def coll(sc, name):
    c = bpy.data.collections.new(name)
    sc.collection.children.link(c)
    return c


# ---------------------------------------------------------------- materials
def mat(name, hexc, rough=0.7, metal=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = hex_lin(hexc)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = hex_lin(emit)
        b.inputs["Emission Strength"].default_value = strength
        b.inputs["Base Color"].default_value = (0, 0, 0, 1)     # pure glow: not washed out by the light beside it
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(b.outputs[0], o.inputs[0])
    m.diffuse_color = hex_lin(hexc)
    return m


def bsdf(m):
    return next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def pattern_mat(name, a, b, mortar, scale=4.0, brick_w=0.5, row_h=0.25, rough=0.85, offset=0.5, plane="XZ"):
    """brick / plank cue: Blender's Brick texture between two colours with a mortar (or seam) colour, on Object
    coordinates (Brick is a 2D pattern; plane "XZ" = walls facing Y, "YZ" = walls facing X, "XY" = floors)."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new("ShaderNodeTexCoord")
    br = nt.nodes.new("ShaderNodeTexBrick")
    br.offset = offset
    br.inputs["Color1"].default_value = hex_lin(a)
    br.inputs["Color2"].default_value = hex_lin(b)
    br.inputs["Mortar"].default_value = hex_lin(mortar)
    br.inputs["Scale"].default_value = scale
    br.inputs["Mortar Size"].default_value = 0.025
    br.inputs["Brick Width"].default_value = brick_w
    br.inputs["Row Height"].default_value = row_h
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Rotation"].default_value = {"XZ": (math.pi / 2, 0, 0), "YZ": (math.pi / 2, 0, math.pi / 2), "XY": (0, 0, 0)}[plane]
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], br.inputs["Vector"])
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bs.inputs["Roughness"].default_value = rough
    nt.links.new(br.outputs["Color"], bs.inputs["Base Color"])
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(bs.outputs[0], o.inputs[0])
    m.diffuse_color = hex_lin(a)
    return m


# ---------------------------------------------------------------- meshes
def _ob(col, name, me, m=None, bevel=0.0):
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    if m is not None:
        me.materials.append(m)
    if bevel > 0:
        md = ob.modifiers.new("bevel", "BEVEL")
        md.width, md.segments, md.limit_method = bevel, 2, "ANGLE"
    return ob


def box(col, name, x0, x1, y0, y1, z0, z1, m=None, bevel=0.012):
    """axis-aligned box between the given bounds (object origin at its centre, so Object texture coords are local)"""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * (x1 - x0), v.co.y * (y1 - y0), v.co.z * (z1 - z0)))
    bm.to_mesh(me)
    bm.free()
    ob = _ob(col, name, me, m, bevel)
    ob.location = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    return ob


def cyl(col, name, x, y, z0, z1, r, m=None, seg=20, axis="Z", r2=None, bevel=0.0):
    """cylinder (or cone when r2 is given) standing on z0 (axis Z), or lying along X / Y centred on (x, y, z0) with
    length z1 - z0"""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    L = z1 - z0
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=L)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = _ob(col, name, me, m, bevel)
    if axis == "Z":
        ob.location = (x, y, z0 + L / 2)
    elif axis == "X":
        ob.location, ob.rotation_euler = (x, y, z0), (0, math.pi / 2, 0)
    else:
        ob.location, ob.rotation_euler = (x, y, z0), (math.pi / 2, 0, 0)
    return ob


def blob(col, name, loc, size, m=None, seg=16):
    """squashed sphere: loaves, dough, sacks, pots"""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(8, seg // 2), radius=0.5)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = _ob(col, name, me, m)
    ob.location, ob.scale = loc, size
    return ob


def pole(col, name, a, b, r, m=None, seg=10):
    """a round rod from point a to point b"""
    a, b = Vector(a), Vector(b)
    d = b - a
    ob = cyl(col, name, 0, 0, 0, d.length, r, m, seg)
    ob.location = (a + b) / 2
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = d.to_track_quat("Z", "Y")
    return ob


def glb(col, path, loc, rot_z=0.0, scale=1.0, name=None):
    """import a CC0 glb (Kenney) into the collection"""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SHARED, path))
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None]
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        col.objects.link(o)
    for r in roots:
        r.location, r.rotation_euler, r.scale = loc, (0, 0, rot_z), (scale, scale, scale)
        if name:
            r.name = name
    return roots


# ---------------------------------------------------------------- lights
def light(col, name, kind, loc, hexc, energy, size=0.2, rot=None, spot=None):
    ld = bpy.data.lights.new(name, kind)
    ld.color = hex_lin(hexc)[:3]
    ld.energy = energy
    if kind in ("POINT", "SPOT"):
        ld.shadow_soft_size = size
    elif kind == "AREA":
        ld.shape, ld.size = "RECTANGLE", size if not isinstance(size, tuple) else size[0]
        if isinstance(size, tuple):
            ld.size_y = size[1]
    elif kind == "SUN":
        ld.angle = size
    if spot:
        ld.spot_size, ld.spot_blend = spot
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    if rot:
        ob.rotation_euler = rot
    col.objects.link(ob)
    return ob


def aim(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = d.to_track_quat("-Z", "Y")


# ---------------------------------------------------------------- characters
def face_angle(loc, toward):
    """Z rotation that turns a drawing (facing -Y) toward a point"""
    dx, dy = toward[0] - loc[0], toward[1] - loc[1]
    return math.atan2(dx, -dy)


def actor_gp(col, name, who, v, loc, toward, frame=1, lights=True, **pose):
    """the character as a live Grease Pencil object. NOTE (Blender 5.3, 2026-11-24): the F12 render draws Grease Pencil
    over every mesh, even one in front of it (the viewport is right), so scenes use actor() cards instead."""
    ob = new_character(name, col, lights=lights)
    _, draw = pose_key(who, v, frame, pose)
    write(ob.data.layers[0].frames.new(frame).drawing, draw())
    ob.location = loc
    ob.rotation_euler = (0, 0, face_angle(loc, toward))
    ob["who"], ob["v"] = who, v
    return ob


# card frame in drawing metres (x across, z up from the soles): the 600 x 1000 design box plus a margin
CARD_X, CARD_Z0, CARD_Z1, CARD_PX = 0.8, -0.08, 2.2, 1800
CARD_DIR = os.path.normpath(os.path.join(HERE, "..", "out", "_cache", "cards"))


def card_png(who, v, frame=1, **pose):
    """draw one pose with Grease Pencil and render it once to a transparent PNG (cached by pose key)"""
    import hashlib
    key, draw = pose_key(who, v, frame, pose)
    path = os.path.join(CARD_DIR, hashlib.sha1(key.encode()).hexdigest()[:16] + ".png")
    if os.path.exists(path):
        return path
    sc = fresh_scene("_card_bake")
    ob = new_character("_card", sc.collection, lights=False)
    write(ob.data.layers[0].frames.new(1).drawing, draw())
    cd = bpy.data.cameras.get("_card_cam") or bpy.data.cameras.new("_card_cam")
    cd.type, cd.sensor_fit = "ORTHO", "VERTICAL"
    cd.ortho_scale = CARD_Z1 - CARD_Z0
    cam = bpy.data.objects.new("_card_cam", cd)
    cam.location = (0, -5, (CARD_Z0 + CARD_Z1) / 2)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    sc.collection.objects.link(cam)
    sc.camera = cam
    r = sc.render
    r.engine = "BLENDER_EEVEE"
    r.resolution_y = CARD_PX
    r.resolution_x = round(CARD_PX * 2 * CARD_X / (CARD_Z1 - CARD_Z0))
    r.resolution_percentage = 100
    r.film_transparent = True
    r.filter_size = 0.6
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.eevee.taa_render_samples = 8
    sc.frame_start = sc.frame_end = sc.frame_current = 1
    os.makedirs(CARD_DIR, exist_ok=True)
    r.filepath = path
    win = bpy.context.window
    old = win.scene if win else None
    try:
        bpy.ops.render.render(write_still=True, scene=sc.name)
    finally:
        if win and old:
            win.scene = old
    return path


def card_mat(path):
    """lit card material: the drawing as base colour, a little self-glow so faces stay readable in dark corners, alpha
    cut-out (the card shades and casts a real shadow in its own shape)"""
    name = "card_" + os.path.basename(path)
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    img = bpy.data.images.load(path, check_existing=True)
    tx = nt.nodes.new("ShaderNodeTexImage")
    tx.image, tx.interpolation, tx.extension = img, "Cubic", "CLIP"
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Roughness"].default_value = 0.9
    nt.links.new(tx.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(tx.outputs["Alpha"], b.inputs["Alpha"])
    nt.links.new(tx.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 0.25
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(b.outputs[0], o.inputs[0])
    for attr, val in (("surface_render_method", "DITHERED"), ("use_transparent_shadow", True), ("use_backface_culling", False)):
        try:
            setattr(m, attr, val)
        except Exception:
            pass
    return m


def actor(col, name, who, v, loc, toward, frame=1, **pose):
    """one character standing at loc (feet): its Grease Pencil drawing on an upright card turned about Z toward
    `toward` (the camera). pose: expr, hands=[(x, y) | None, (x, y) | None] in metres from the feet in the drawing
    plane, hold, walk, look"""
    path = card_png(who, v, frame, **pose)
    me = bpy.data.meshes.new(name)
    me.from_pydata([(-CARD_X, 0, CARD_Z0), (CARD_X, 0, CARD_Z0), (CARD_X, 0, CARD_Z1), (-CARD_X, 0, CARD_Z1)], [], [(0, 1, 2, 3)])
    me.uv_layers.new(name="UVMap")
    for li, uv in zip(me.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        me.uv_layers[0].data[li.index].uv = uv
    me.materials.append(card_mat(path))
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (0, 0, face_angle(loc, toward))
    ob["who"], ob["v"], ob["card"] = who, v, path
    return ob


def hand_world(ob, h):
    """world position of a hand given in drawing metres (x right, y up from the feet)"""
    return ob.matrix_basis @ Vector((h[0], 0.0, h[1]))     # matrix_basis: fresh even before the depsgraph updates


def shadow_disc(col, name, loc, r, m):
    """soft contact shadow under a card (Grease Pencil does not cast a readable floor shadow)"""
    ob = cyl(col, name, loc[0], loc[1], 0.003, 0.006, r, m, seg=24)
    ob.scale = (1.0, 0.55, 1.0)
    ob.visible_shadow = False
    return ob


# ---------------------------------------------------------------- cameras
def camera(col, name, loc, target, fov=55.0, sensor_fit="VERTICAL"):
    cd = bpy.data.cameras.new(name)
    cd.sensor_fit = sensor_fit
    cd.angle = math.radians(fov)
    cd.clip_start, cd.clip_end = 0.05, 200
    ob = bpy.data.objects.new(name, cd)
    ob.location = loc
    col.objects.link(ob)
    d = Vector(target) - Vector(loc)
    # level camera (no roll): yaw from xy, pitch from z
    yaw = math.atan2(d.x, d.y)
    pitch = math.atan2(d.z, math.hypot(d.x, d.y))
    ob.rotation_mode = "XYZ"
    ob.rotation_euler = (math.pi / 2 + pitch, 0, -yaw)
    cd.dof.use_dof = True                       # focus on the aim point; f/5.6 keeps the set readable, only the lens-side
    cd.dof.focus_distance = d.length            # foreground prop goes soft
    cd.dof.aperture_fstop = 5.6
    return ob


def head_elevation(cam, actor_ob):
    """degrees from the lens to the character's head centre (card rule: <= 12, drama <= 18)"""
    hc = SIZE[build_of(actor_ob.get("who", "baker"), actor_ob.get("v", 0))][1]
    h = actor_ob.location + Vector((0, 0, hc))
    d = h - cam.location
    return math.degrees(math.atan2(d.z, math.hypot(d.x, d.y)))


def render_setup(sc, w=1080, h=1920, samples=32):
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
    sc.render.filter_size = 1.0
    sc.view_settings.view_transform = "Khronos PBR Neutral"
    sc.view_settings.look = "None"
    sc.eevee.taa_render_samples = samples
    try:
        sc.eevee.use_shadows = True
    except Exception:
        pass
    sc.frame_start = sc.frame_end = sc.frame_current = 1


def render_still(sc, cam, path):
    sc.camera = cam
    sc.render.filepath = os.path.abspath(path)
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 90
    os.makedirs(os.path.dirname(sc.render.filepath), exist_ok=True)
    win = bpy.context.window
    old = win.scene if win else None
    if win:
        win.scene = sc
    try:
        bpy.ops.render.render(write_still=True, scene=sc.name)
    finally:
        if win and old and old != sc:
            win.scene = old
    return sc.render.filepath


# ---------------------------------------------------------------- set files (episode pipeline contract)
def prism(col, name, profile, y0, y1, m=None, axis="Y", bevel=0.0):
    """a 2D profile [(u, z), ...] extruded between y0 and y1 along Y (u = x), or along X (axis "X": u = y)"""
    me = bpy.data.meshes.new(name)
    n = len(profile)
    if axis == "Y":
        verts = [(u, y0, z) for u, z in profile] + [(u, y1, z) for u, z in profile]
    else:
        verts = [(y0, u, z) for u, z in profile] + [(y1, u, z) for u, z in profile]
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    me.from_pydata(verts, [], faces)
    me.validate()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return _ob(col, name, me, m, bevel)


def text(col, name, body, loc, rot, size, m, align="CENTER", extrude=0.01):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.size, cu.extrude, cu.align_x, cu.align_y = body, size, extrude, align, "CENTER"
    for fn in ("C:/Windows/Fonts/georgiab.ttf", "C:/Windows/Fonts/georgia.ttf"):
        if os.path.exists(fn):
            cu.font = bpy.data.fonts.load(fn, check_existing=True)
            break
    cu.materials.append(m)
    ob = bpy.data.objects.new(name, cu)
    ob.location, ob.rotation_euler = loc, rot
    col.objects.link(ob)
    return ob


def subject_box(col, name, x0, x1, y0, y1, z0, z1, parent=None):
    """SUBJ-<name>: a fully transparent box around the hero object (food shapes are curves, the framing check in
    blender/shot.py measures meshes named SUBJ-*). It renders as nothing and casts no shadow."""
    m = bpy.data.materials.get("subject_clear")
    if m is None:
        m = bpy.data.materials.new("subject_clear")
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        nt.links.new(tr.outputs[0], nt.nodes.new("ShaderNodeOutputMaterial").inputs[0])
        for attr, val in (("surface_render_method", "BLENDED"), ("use_transparent_shadow", True)):
            try:
                setattr(m, attr, val)
            except Exception:
                pass
    ob = box(col, f"SUBJ-{name}", x0, x1, y0, y1, z0, z1, m, 0)
    ob.visible_shadow = False
    ob.visible_diffuse = ob.visible_glossy = False
    if parent is not None:
        ob.parent = parent
    return ob


def set_cams(sc, cams, col_name="Cams"):
    """CAM-<name> cameras with custom props kind / chars (cams: name -> dict(loc, aim, fov, kind, chars))"""
    C = coll(sc, col_name)
    out = {}
    for k, v in cams.items():
        cam = camera(C, f"CAM-{k}", v["loc"], v["aim"], v.get("fov", 55))
        cam.data.name = f"CAM-{k}"
        cam["kind"], cam["chars"] = v.get("kind", "medium"), bool(v.get("chars", True))
        if v.get("fstop"):
            cam.data.dof.aperture_fstop = v["fstop"]
        for prop in ("push", "side"):                 # blender/shot.py drift of a single-name camera
            if v.get(prop) is not None:
                cam[prop] = float(v[prop])
        out[k] = cam
    return out


def set_marks(sc, marks, acts, col_name="Marks"):
    """MARK-<role> (feet; local +Y = facing direction given as (fx, fy)) and ACT-<name> anchors"""
    M = coll(sc, col_name)
    for role, (loc, f) in marks.items():
        ob = bpy.data.objects.new(f"MARK-{role}", None)
        ob.empty_display_type, ob.empty_display_size = "SINGLE_ARROW", 0.5
        ob.location, ob.rotation_euler = loc, (0, 0, math.atan2(-f[0], f[1]))
        M.objects.link(ob)
    for k, loc in acts.items():
        ob = bpy.data.objects.new(f"ACT-{k}", None)
        ob.empty_display_type, ob.empty_display_size = "SPHERE", 0.08
        ob.location = loc
        M.objects.link(ob)
    return M


def world(name, top, strength=1.0):
    w = bpy.data.worlds.get(name) or bpy.data.worlds.new(name)
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = hex_lin(top) if isinstance(top, str) else top
    bg.inputs["Strength"].default_value = strength
    nt.links.new(bg.outputs[0], nt.nodes.new("ShaderNodeOutputWorld").inputs[0])
    return w


def save_scene(sc, path):
    """write only this scene (and what it uses) to a .blend"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # also every world: the unused ones (bk_world_night, st_world_golden) are what the set module switches to, and
    # libraries.write only follows what the scene uses (FEEDBACK: the night world was missing from bakery.blend)
    bpy.data.libraries.write(path, {sc, *bpy.data.worlds}, fake_user=True, path_remap="RELATIVE_ALL", compress=True)
    return path
