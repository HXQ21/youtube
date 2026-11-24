# Render a whole exported shot in Blender (Eevee): the set with real light (sun, sky, glowing windows and fire,
# soft shadows, ambient occlusion), the moving props animated frame by frame, and the 2D character cards as flat
# picture planes that cast shadows, driven by the same per-frame pictures and matrices the video uses.
#   blender -b --python blender/render.py -- <dir> [--samples 64]
# Out: <dir>/frames/f0001.png ... (scripts/blender.mjs render joins them into blender.mp4)
import os, sys, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, math
from mathutils import Vector
from common import args, log, reset, import_set, emitters, lights, v3, mat4
from upgrade import upgrade
from inherit import inherit, card_shading

d, sc, opt = args()
N = len(sc["frames"])
reset()
objs = import_set(d)
emitters(objs, sc["emit"], strength=float(opt.get("glow", 1.0)), normalize=True)
lights(sc, world_k=float(opt.get("sky", 1.3)), opt=opt)
# the set in its own collection, so the ink lines (Freestyle) draw the set only: the cards already carry their ink
set_coll = bpy.data.collections.new("Set")
bpy.context.scene.collection.children.link(set_coll)
for o in objs.values():
    for c in list(o.users_collection):
        c.objects.unlink(o)
    set_coll.objects.link(o)
# Blender upgrade layer: rounded edges, relief from the painted textures, real lights at glowing sources, atmosphere
if str(opt.get("upgrade", "1")) != "0":
    upgrade(objs, sc, opt)
scene = bpy.context.scene
scene.frame_start, scene.frame_end = 1, N
scene.render.fps = sc["fps"]
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = sc["width"], sc["height"], 100

# --- moving props: world matrix + visibility per frame
for name, track in sc["dynamic"].items():
    o = objs.get(name)
    if not o:
        continue
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
    o.rotation_mode = "QUATERNION"
    for i, m in enumerate(track):
        f = i + 1
        o.hide_render = m is None
        o.keyframe_insert("hide_render", frame=f)
        if m is not None:
            o.matrix_world = mat4(m)
            for p in ("location", "rotation_quaternion", "scale"):
                o.keyframe_insert(p, frame=f)

# --- character cards: a picture plane per card, an image sequence per card
for c in sc["cards"]:
    x0, y0, x1, y1 = c["box"]
    me = bpy.data.meshes.new(c["id"])
    me.from_pydata([v3((x0, y0, 0)), v3((x1, y0, 0)), v3((x1, y1, 0)), v3((x0, y1, 0))], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    for li, (u, v) in zip(range(4), ((0, 0), (1, 0), (1, 1), (0, 1))):
        uv.data[li].uv = (u, v)
    o = bpy.data.objects.new(c["id"], me)
    scene.collection.objects.link(o)
    o.rotation_mode = "QUATERNION"
    seq = os.path.join(d, "seq", c["id"])
    shutil.rmtree(seq, ignore_errors=True)
    os.makedirs(seq)
    blank = next(x for x in c["track"] if x)["file"]
    for i, t in enumerate(c["track"]):
        f = i + 1
        shutil.copyfile(os.path.join(d, (t or {"file": blank})["file"]), os.path.join(seq, f"{f:04d}.png"))
        o.hide_render = t is None
        o.keyframe_insert("hide_render", frame=f)
        if t:
            o.matrix_world = mat4(t["m"])
            for p in ("location", "rotation_quaternion", "scale"):
                o.keyframe_insert(p, frame=f)
    img = bpy.data.images.load(os.path.join(seq, "0001.png"))
    img.source = "SEQUENCE"
    m = bpy.data.materials.new(c["id"])
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Smart"
    tex.image_user.frame_duration = N
    tex.image_user.frame_start = 1
    tex.image_user.use_auto_refresh = True
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.9
    # cards take the preset's character tint, like the three.js card shader (cardshade.ts uCharTint)
    tint = nt.nodes.new("ShaderNodeMix"); tint.name = "chartint"
    tint.data_type = "RGBA"; tint.blend_type = "MULTIPLY"; tint.inputs[0].default_value = 1.0
    ct = sc["light"].get("charTint", [1, 1, 1])
    nt.links.new(tex.outputs["Color"], tint.inputs[6]); tint.inputs[7].default_value = (ct[0], ct[1], ct[2], 1.0)
    nt.links.new(tint.outputs[2], bsdf.inputs["Base Color"])
    if "Emission Color" in bsdf.inputs:
        nt.links.new(tint.outputs[2], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = float(opt.get("cardglow", 0.75))
    clip = nt.nodes.new("ShaderNodeMath")
    clip.operation = "GREATER_THAN"
    clip.inputs[1].default_value = 0.5
    nt.links.new(tex.outputs["Alpha"], clip.inputs[0])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(clip.outputs[0], mix.inputs[0])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(bsdf.outputs[0], mix.inputs[2])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(mix.outputs[0], out.inputs[0])
    if hasattr(m, "surface_render_method"):
        m.surface_render_method = "DITHERED"
    if hasattr(m, "blend_method"):
        try:
            m.blend_method = "CLIP"
        except Exception:
            pass
    m.use_backface_culling = False
    me.materials.append(m)

# --- camera: the video's camera path, frame by frame (vertical fov, depth of field from the lens-blur setting)
cd = bpy.data.cameras.new("cam")
cd.sensor_fit = "VERTICAL"
cd.sensor_height = 24.0
cd.clip_start, cd.clip_end = 0.02, 4000
cam = bpy.data.objects.new("cam", cd)
scene.collection.objects.link(cam)
scene.camera = cam
cam.rotation_mode = "QUATERNION"
cd.dof.use_dof = True
for i, fr in enumerate(sc["frames"]):
    f, c = i + 1, fr["cam"]
    pos, look = v3(c["pos"]), v3(c["look"])
    focus = v3(c.get("focus") or c["look"])
    cam.location = pos
    cam.rotation_quaternion = (look - pos).to_track_quat("-Z", "Y")
    half = math.radians(c["fov"]) / 2
    cd.lens = (cd.sensor_height / 2) / math.tan(half)
    s = max(0.05, (focus - pos).length)
    cd.dof.focus_distance = s
    # blur-disc radius at infinity, in px of a 1920 px frame -> aperture diameter -> f-stop
    coc = max(0.01, float(c.get("cInf") or 0.01)) * 2
    A = coc * s * 2 * math.tan(half) / 1920
    cd.dof.aperture_fstop = max(0.5, min(64.0, (cd.lens / 1000) / max(A, 1e-6)))
    cam.keyframe_insert("location", frame=f)
    cam.keyframe_insert("rotation_quaternion", frame=f)
    cd.keyframe_insert("lens", frame=f)
    cd.dof.keyframe_insert("focus_distance", frame=f)
    cd.dof.keyframe_insert("aperture_fstop", frame=f)

# --- inherited from the episode renderer: sky gradient, clouds, steam sprites, floor decals, card shading
scene.frame_set(1)
inherit(sc, d, cam)
for c in sc["cards"]:
    o = bpy.data.objects.get(c["id"])
    if not o or not o.active_material:
        continue
    nt = o.active_material.node_tree
    tn = nt.nodes.get("chartint")
    bsdf = next((x for x in nt.nodes if x.type == "BSDF_PRINCIPLED"), None)
    if tn and bsdf:
        shaded = card_shading(nt, None, tn.outputs[2], sc, cam)
        nt.links.new(shaded, bsdf.inputs["Base Color"])
        if "Emission Color" in bsdf.inputs:
            nt.links.new(shaded, bsdf.inputs["Emission Color"])

# --- engine
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try:
        scene.render.engine = eng
        break
    except Exception:
        continue
ee = scene.eevee
ee.taa_render_samples = int(opt.get("samples", 64))
for k, v in (("use_raytracing", str(opt.get("rt", "1")) != "0"), ("use_shadows", True), ("use_gtao", True), ("use_bloom", True), ("use_soft_shadows", True)):
    if hasattr(ee, k):
        setattr(ee, k, v)
if hasattr(ee, "ray_tracing_options"):
    ee.ray_tracing_options.resolution_scale = "1"
# the episode look: the same tone map as the three.js renderer (Khronos PBR Neutral; Standard on older Blender),
# then scripts/grade_frames.py applies the shot's FOOD_GRADES preset to every frame (blender.mjs render)
for vt in ("Khronos PBR Neutral", "Standard"):
    try:
        scene.view_settings.view_transform = vt
        break
    except Exception:
        continue
try:
    scene.view_settings.look = "None"
    scene.view_settings.exposure = float(opt.get("exposure", -0.75))
except Exception:
    pass
log("tô màu:", scene.view_settings.view_transform)
try:
    scene.render.use_freestyle = True
    scene.render.line_thickness_mode = "ABSOLUTE"
    # same weight as the three.js ink pass (src/videos/bridge/ink.ts: ~5 px near, thinner far, near-black, creases at
    # ~50 deg): the old 1.6 px lines in a dark brown were a third of that, so the Blender frame looked washed (FEEDBACK_LOG #15)
    scene.render.line_thickness = float(opt.get("ink", 4.2)) * sc["height"] / 1920
    fs = bpy.context.view_layer.freestyle_settings
    ls = fs.linesets[0] if fs.linesets else fs.linesets.new("ink")
    ls.select_by_collection = True
    ls.collection = set_coll
    ls.select_silhouette = ls.select_border = ls.select_crease = True
    fs.crease_angle = math.radians(130)
    bpy.context.view_layer.use_freestyle = True
    if ls.linestyle is None:
        ls.linestyle = bpy.data.linestyles.new("ink")
    ls.linestyle.color = (0.012, 0.012, 0.012)
    ls.linestyle.thickness = 1.0
    if not ls.linestyle.thickness_modifiers:        # thinner with distance, like the three.js pass (3.7 px at 3 m -> 1.5 px at 90 m)
        tm = ls.linestyle.thickness_modifiers.new("far", "DISTANCE_FROM_CAMERA")
        tm.range_min, tm.range_max, tm.value_min, tm.value_max = 3.0, 40.0, 1.0, 0.45
        tm.mapping = "LINEAR"
    if not ls.linestyle.alpha_modifiers:            # no sharp lines on a foreground prop the lens blur has softened
        am = ls.linestyle.alpha_modifiers.new("near", "DISTANCE_FROM_CAMERA")
        am.range_min, am.range_max = 1.6, 2.6
        am.mapping = "LINEAR"
        am.blend = "MULTIPLY"
        if hasattr(am, "value_min"):
            am.value_min, am.value_max = 0.0, 1.0
    log("viền mực Freestyle: bật")
except Exception as e:
    log("không bật được Freestyle:", e)
fdir = os.path.join(d, "frames")
shutil.rmtree(fdir, ignore_errors=True)
os.makedirs(fdir)
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = os.path.join(fdir, "f####")
scene.frame_step = int(opt.get("step", 1))   # --step K: every K-th frame only (quick look; blender.mjs render needs 1)
log(f"render {scene.render.engine} {sc['width']}x{sc['height']} {N} frame")
bpy.ops.render.render(animation=True)
log("render xong")
