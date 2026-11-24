# Shared helpers for the Blender side of the pipeline (run inside Blender: blender -b --python <script> -- <dir>).
# <dir> holds what scripts/blender.mjs export wrote: set.glb, scene.json, cards/*.png.
# three.js is Y-up, Blender is Z-up: a three.js point (x, y, z) is (x, -z, y) in Blender (the glTF importer does the
# same for the set), and a three.js world matrix M becomes C @ M @ C^-1.
import bpy, json, math, os, sys
from mathutils import Matrix, Vector

C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
CI = C.inverted()


def log(*a):
    print("[cb]", *a, flush=True)


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    d = a[0]
    opt = {}
    for i in range(1, len(a) - 1):
        if a[i].startswith("--"):
            opt[a[i][2:]] = a[i + 1]
    with open(os.path.join(d, "scene.json"), encoding="utf-8") as f:
        sc = json.load(f)
    return d, sc, opt


def v3(p):
    return Vector((p[0], -p[2], p[1]))


def mat4(m):
    # three.js toArray() is column-major
    M = Matrix(((m[0], m[4], m[8], m[12]), (m[1], m[5], m[9], m[13]), (m[2], m[6], m[10], m[14]), (m[3], m[7], m[11], m[15])))
    return C @ M @ CI


def hexcol(h, k=1.0):
    h = h.lstrip("#")
    s = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in s]
    return (lin[0] * k, lin[1] * k, lin[2] * k, 1.0)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_set(d):
    bpy.ops.import_scene.gltf(filepath=os.path.join(d, "set.glb"))
    return {o.name.split(".")[0]: o for o in bpy.context.scene.objects if o.type == "MESH"}


def base_color(o):
    m = o.active_material
    if not m:
        return (0.8, 0.8, 0.8, 1)
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                return tuple(n.inputs["Base Color"].default_value)
            if n.type == "RGB":
                return tuple(n.outputs[0].default_value)
    return tuple(m.diffuse_color)


def emitters(objs, names, strength=6.0, normalize=False):
    """unlit three.js materials (windows, lamp glass, fire) become real light sources. Their imported colour is
    already above white (the renderer pre-brightens glow colours); normalize=True keeps only the hue, so a render
    shows a warm window instead of a clipped white one"""
    for n in names:
        o = objs.get(n)
        if not o:
            continue
        col = base_color(o)
        if normalize:
            mx = max(col[:3]) or 1.0
            col = (col[0] / mx, col[1] / mx, col[2] / mx, 1.0)
        # a painted glow (the oven fire is a dark-to-orange gradient image): keep the picture, not just the flat colour,
        # otherwise the fire renders as a white panel
        img = None
        src = o.active_material
        if src and src.use_nodes:
            img = next((x.image for x in src.node_tree.nodes if x.type == "TEX_IMAGE" and x.image), None)
        m = bpy.data.materials.new(f"emit_{n}")
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        e = nt.nodes.new("ShaderNodeEmission")
        e.inputs["Color"].default_value = col
        e.inputs["Strength"].default_value = strength
        if img is not None:
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = img
            nt.links.new(t.outputs["Color"], e.inputs["Color"])
            e.inputs["Strength"].default_value = strength * (1.6 if normalize else 1.0)
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(e.outputs[0], out.inputs[0])
        o.data.materials.clear()
        o.data.materials.append(m)


def lights(sc, sun_k=1.5, world_k=0.55, opt=None):
    """sun frozen for the shot (same direction as the three.js rig) + the hemisphere colour as the world"""
    L = sc["light"]
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = L["sunI"] * sun_k
    # warm / cool as the three.js two-tone palette: the sun takes the hue of the preset's lit colour, the world (sky
    # fill) the hue of its shade colour, so the light temperature matches the episode renderer
    lit, shade = L.get("lit"), L.get("shade")
    # the sun keeps the lit hue, but softened (--sunsat): in Blender the warm walls bounce it again, so the full hue
    # turned the whole frame orange (FEEDBACK_LOG #15)
    k = float(opt.get("sunsat", 0.6)) if opt else 0.6
    sun.color = tuple(1 - k + k * c / max(lit) for c in lit) if lit else hexcol(L["sunCol"])[:3]
    sun.angle = math.radians(3.0)
    so = bpy.data.objects.new("sun", sun)
    bpy.context.scene.collection.objects.link(so)
    so.rotation_mode = "QUATERNION"
    so.rotation_quaternion = (-v3(L["sunDir"])).to_track_quat("-Z", "Y")
    w = bpy.data.worlds.new("world")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    # three.js tints the shaded side by shade/lit, which is COOL against the warm lit side (interior: lit 1.66/1.42/1.1,
    # shade .34/.30/.31 -> ratio .20/.21/.28, bluish). The fill light takes that ratio, so shadows cool down like in the
    # episode renderer and the colours keep apart (the shade hue alone was a neutral pink: everything went one orange)
    wc = float((opt or {}).get("worldcool", 0.6))      # 0 = shade hue (old), 1 = full shade/lit ratio (walls went grey)
    if shade and lit and wc > 0:
        q = [s / l for s, l in zip(shade, lit)]
        q = [x / max(q) for x in q]
        h = [x / max(shade) for x in shade]
        bg.inputs["Color"].default_value = tuple((1 - wc) * a + wc * b for a, b in zip(h, q)) + (1.0,)
    else:
        bg.inputs["Color"].default_value = (tuple(c / max(shade) for c in shade) + (1.0,)) if shade else hexcol(L["sky"])
    bg.inputs["Strength"].default_value = L["hemiI"] * world_k
    return so


def gpu(scene):
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for t in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
        try:
            prefs.compute_device_type = t
        except Exception:
            continue
        prefs.get_devices()
        devs = [x for x in prefs.devices if x.type == t]
        if devs:
            for x in prefs.devices:
                x.use = x.type == t
            scene.cycles.device = "GPU"
            return t
    scene.cycles.device = "CPU"
    return "CPU"
