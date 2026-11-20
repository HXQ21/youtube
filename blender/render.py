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

d, sc, opt = args()
N = len(sc["frames"])
reset()
objs = import_set(d)
emitters(objs, sc["emit"])
lights(sc)
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
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if "Emission Color" in bsdf.inputs:
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 0.35
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

# --- engine
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try:
        scene.render.engine = eng
        break
    except Exception:
        continue
ee = scene.eevee
ee.taa_render_samples = int(opt.get("samples", 64))
for k, v in (("use_raytracing", True), ("use_shadows", True), ("use_gtao", True), ("use_bloom", True), ("use_soft_shadows", True)):
    if hasattr(ee, k):
        setattr(ee, k, v)
if hasattr(ee, "ray_tracing_options"):
    ee.ray_tracing_options.resolution_scale = "1"
try:
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
except Exception:
    pass
fdir = os.path.join(d, "frames")
shutil.rmtree(fdir, ignore_errors=True)
os.makedirs(fdir)
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = os.path.join(fdir, "f####")
log(f"render {scene.render.engine} {sc['width']}x{sc['height']} {N} frame")
bpy.ops.render.render(animation=True)
log("render xong")
