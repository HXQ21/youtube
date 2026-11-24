# Inheritance layer (2026-11-24): rebuild in Blender what the episode renderer draws OUTSIDE the exported set, so a
# Blender render keeps everything the three.js look had before any upgrade is layered on top:
#   sky      the Stage sky gradient (5 colours by elevation) for camera rays; the scene is still lit by the world fill
#   clouds   the painted cloud cards (day / golden exteriors), facing the camera, unlit, never casting shadows
#   sprites  steam / smoke sprites frame by frame (position, size, opacity), always facing the camera
#   decals   painted surface effects (flour on the floor)
#   cards    the character-card shading of cardshade.ts: the far side from the sun a little darker (head charGrad,
#            torso bodyGrad), tinted toward sideTint, the cast-shadow floor charShade is left to Blender's real shadows
import math, os
import bpy
from mathutils import Vector
from common import log, v3, mat4, hexcol


def _srgb_to_lin(h):
    return hexcol(h)


def sky(sc, strength=1.68):
    """camera rays see the Stage gradient; lighting keeps the world fill colour already set by common.lights()"""
    s = sc.get("sky")
    if not s:
        return False
    w = bpy.context.scene.world
    nt = w.node_tree
    bg = next(x for x in nt.nodes if x.type == "BACKGROUND")
    out = next(x for x in nt.nodes if x.type == "OUTPUT_WORLD")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    asin = nt.nodes.new("ShaderNodeMath"); asin.operation = "ARCSINE"; asin.use_clamp = False
    nt.links.new(sep.outputs["Z"], asin.inputs[0])
    norm = nt.nodes.new("ShaderNodeMath"); norm.operation = "DIVIDE"; norm.use_clamp = True
    nt.links.new(asin.outputs[0], norm.inputs[0]); norm.inputs[1].default_value = math.pi / 2
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    els = s["e"]
    cr = ramp.color_ramp
    while len(cr.elements) < len(els):
        cr.elements.new(0.5)
    for el, (deg, col) in zip(cr.elements, zip(els, s["c"])):
        el.position = max(0.0, min(1.0, deg / 90.0))
        el.color = _srgb_to_lin(col)
    nt.links.new(norm.outputs[0], ramp.inputs[0])
    skybg = nt.nodes.new("ShaderNodeBackground")
    nt.links.new(ramp.outputs["Color"], skybg.inputs["Color"])
    skybg.inputs["Strength"].default_value = strength
    lp = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
    nt.links.new(bg.outputs[0], mix.inputs[1])
    nt.links.new(skybg.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return True


def _unlit_alpha_mat(name, img, tint=(1, 1, 1), opacity=1.0, emission=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    mul = nt.nodes.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"; mul.inputs[0].default_value = 1.0
    nt.links.new(tex.outputs["Color"], mul.inputs[6]); mul.inputs[7].default_value = (tint[0], tint[1], tint[2], 1)
    em = nt.nodes.new("ShaderNodeEmission"); em.inputs["Strength"].default_value = emission
    nt.links.new(mul.outputs[2], em.inputs["Color"])
    op = nt.nodes.new("ShaderNodeValue"); op.name = "opacity"; op.outputs[0].default_value = opacity
    a = nt.nodes.new("ShaderNodeMath"); a.operation = "MULTIPLY"
    nt.links.new(tex.outputs["Alpha"], a.inputs[0]); nt.links.new(op.outputs[0], a.inputs[1])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(a.outputs[0], mix.inputs[0]); nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(em.outputs[0], mix.inputs[2])
    out = nt.nodes.new("ShaderNodeOutputMaterial"); nt.links.new(mix.outputs[0], out.inputs[0])
    if hasattr(m, "surface_render_method"):
        m.surface_render_method = "BLENDED"
    m.use_backface_culling = False
    return m, op


def _quad(name, w, h):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0), (-w / 2, h / 2, 0)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    for li, (u, v) in zip(range(4), ((0, 0), (1, 0), (1, 1), (0, 1))):
        uv.data[li].uv = (u, v)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.visible_shadow = False
    return o


def _face_camera(o, cam):
    c = o.constraints.new("TRACK_TO")
    c.target = cam
    c.track_axis = "TRACK_Z"
    c.up_axis = "UP_Y"


def clouds(sc, d, cam):
    n = 0
    for i, c in enumerate(sc.get("clouds", [])):
        if not c.get("tex"):
            continue
        img = bpy.data.images.load(os.path.join(d, c["tex"]), check_existing=True)
        o = _quad(f"cloud{i}", c["w"], c["w"] / 2)
        o.location = v3(c["pos"])
        m, _ = _unlit_alpha_mat(f"cloud{i}", img, tint=c.get("tint", (1, 1, 1)), emission=1.0)
        o.data.materials.append(m)
        _face_camera(o, cam)
        n += 1
    return n


def sprites(sc, d, cam):
    n = 0
    for sp in sc.get("sprites", []):
        first = next((t for t in sp["track"] if t), None)
        if not first or not first.get("tex"):
            continue
        img = bpy.data.images.load(os.path.join(d, first["tex"]), check_existing=True)
        o = _quad(sp["id"], 1.0, 1.0)
        col = hexcol(first["c"])
        m, op = _unlit_alpha_mat(sp["id"], img, tint=col[:3], emission=1.2)
        o.data.materials.append(m)
        _face_camera(o, cam)
        for i, t in enumerate(sp["track"]):
            f = i + 1
            if t:
                o.location = v3(t["p"])
                o.scale = (t["s"][0], t["s"][1], 1)
                op.outputs[0].default_value = t["o"]
            else:
                op.outputs[0].default_value = 0.0
            o.keyframe_insert("location", frame=f)
            o.keyframe_insert("scale", frame=f)
            op.outputs[0].keyframe_insert("default_value", frame=f)
        n += 1
    return n


def decals(sc, d):
    n = 0
    for i, dc in enumerate(sc.get("decals", [])):
        if not dc.get("tex"):
            continue
        x0, y0, z0, x1, y1, z1 = dc["box"]
        ext = sorted(((x1 - x0, "x"), (y1 - y0, "y"), (z1 - z0, "z")), reverse=True)
        axes = {ext[0][1], ext[1][1]}
        if axes == {"x", "z"}:
            pts = [(x0, 0, z1), (x1, 0, z1), (x1, 0, z0), (x0, 0, z0)]
        elif axes == {"x", "y"}:
            pts = [(x0, y0, 0), (x1, y0, 0), (x1, y1, 0), (x0, y1, 0)]
        else:
            pts = [(0, y0, z1), (0, y0, z0), (0, y1, z0), (0, y1, z1)]
        me = bpy.data.meshes.new(f"decal{i}")
        me.from_pydata([v3(p) for p in pts], [], [(0, 1, 2, 3)])
        uv = me.uv_layers.new(name="UVMap")
        for li, (u, v) in zip(range(4), ((0, 0), (1, 0), (1, 1), (0, 1))):
            uv.data[li].uv = (u, v)
        o = bpy.data.objects.new(f"decal{i}", me)
        bpy.context.scene.collection.objects.link(o)
        o.matrix_world = mat4(dc["m"])
        o.location.z += 0.002
        o.visible_shadow = False
        img = bpy.data.images.load(os.path.join(d, dc["tex"]), check_existing=True)
        m, _ = _unlit_alpha_mat(f"decal{i}", img, tint=hexcol(dc["c"])[:3], opacity=dc.get("o", 1.0), emission=0.55)
        o.data.materials.append(m)
        n += 1
    return n


def card_shading(nt, tex, bsdf_color_out, sc, cam_obj):
    """cardshade.ts in nodes: darken the side of the card away from the sun. Returns the shaded colour socket."""
    L = sc["light"]
    sun = v3(L["sunDir"]).normalized()
    # camera right vector at the first frame decides which screen side faces the sun (frozen per shot, like three.js)
    right = (cam_obj.matrix_world.to_3x3() @ Vector((1, 0, 0))).normalized()
    side_x = sun.dot(right)
    side = (1 if side_x >= 0 else -1) * min(1.0, abs(side_x) / 0.35)
    g_head = min(L.get("charGrad", 0.07) * 5.5, 0.4)
    g_body = L.get("bodyGrad", 0.2) * 1.6
    uvn = nt.nodes.new("ShaderNodeTexCoord")
    sepu = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(uvn.outputs["UV"], sepu.inputs[0])
    # head zone: v > ~.58 (adult chin); t = (u - .5) / halfwidth * side, -1 .. 1, +1 = edge facing the sun
    head = nt.nodes.new("ShaderNodeMapRange"); head.inputs["From Min"].default_value = 0.565; head.inputs["From Max"].default_value = 0.6
    nt.links.new(sepu.outputs["Y"], head.inputs["Value"])
    du = nt.nodes.new("ShaderNodeMath"); du.operation = "SUBTRACT"; nt.links.new(sepu.outputs["X"], du.inputs[0]); du.inputs[1].default_value = 0.5
    hw = nt.nodes.new("ShaderNodeMapRange"); hw.inputs["To Min"].default_value = 0.15; hw.inputs["To Max"].default_value = 0.2
    nt.links.new(head.outputs[0], hw.inputs["Value"])
    uu = nt.nodes.new("ShaderNodeMath"); uu.operation = "DIVIDE"; uu.use_clamp = False
    nt.links.new(du.outputs[0], uu.inputs[0]); nt.links.new(hw.outputs[0], uu.inputs[1])
    t = nt.nodes.new("ShaderNodeMath"); t.operation = "MULTIPLY"; nt.links.new(uu.outputs[0], t.inputs[0]); t.inputs[1].default_value = -side
    dark = nt.nodes.new("ShaderNodeMapRange"); dark.interpolation_type = "SMOOTHSTEP"
    dark.inputs["From Min"].default_value = -0.15; dark.inputs["From Max"].default_value = 0.9
    nt.links.new(t.outputs[0], dark.inputs["Value"])
    g = nt.nodes.new("ShaderNodeMapRange"); g.inputs["To Min"].default_value = g_body; g.inputs["To Max"].default_value = g_head
    nt.links.new(head.outputs[0], g.inputs["Value"])
    gd = nt.nodes.new("ShaderNodeMath"); gd.operation = "MULTIPLY"; nt.links.new(g.outputs[0], gd.inputs[0]); nt.links.new(dark.outputs[0], gd.inputs[1])
    k = nt.nodes.new("ShaderNodeMath"); k.operation = "SUBTRACT"; k.inputs[0].default_value = 1.0; nt.links.new(gd.outputs[0], k.inputs[1])
    # far side also leans toward sideTint (lavender), half strength like the shader
    st = L.get("sideTint", [1, 1, 1])
    tintmix = nt.nodes.new("ShaderNodeMix"); tintmix.data_type = "RGBA"; tintmix.blend_type = "MULTIPLY"
    half = nt.nodes.new("ShaderNodeMath"); half.operation = "MULTIPLY"; nt.links.new(dark.outputs[0], half.inputs[0]); half.inputs[1].default_value = 0.5
    nt.links.new(half.outputs[0], tintmix.inputs[0]); nt.links.new(bsdf_color_out, tintmix.inputs[6]); tintmix.inputs[7].default_value = (st[0], st[1], st[2], 1)
    shade = nt.nodes.new("ShaderNodeMix"); shade.data_type = "RGBA"; shade.blend_type = "MULTIPLY"; shade.inputs[0].default_value = 1.0
    nt.links.new(tintmix.outputs[2], shade.inputs[6])
    kc = nt.nodes.new("ShaderNodeCombineXYZ")
    for ax in ("X", "Y", "Z"):
        nt.links.new(k.outputs[0], kc.inputs[ax])
    nt.links.new(kc.outputs[0], shade.inputs[7])
    return shade.outputs[2]


def inherit(sc, d, cam):
    s = sky(sc)
    nc, ns, nd = clouds(sc, d, cam), sprites(sc, d, cam), decals(sc, d)
    log(f"kế thừa: trời {'có' if s else 'không'}, mây {nc}, hơi nóng {ns}, vệt bề mặt {nd}")
