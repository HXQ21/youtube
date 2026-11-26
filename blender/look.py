# The final look in Blender (2026-11-26: the user dropped Seedance; Blender renders the picture, Remotion assembles).
# The channel look (skill cartoon-3d-short: "toon-shaded 3D sets with black ink lines"), applied to a set at render time
# by blender/shot.py for --quality final (or --look ink|toon on any quality):
#   ink   Freestyle lines on the set geometry only (the character cards already carry their own ink). Settings from the
#         three.js parity work (old blender/render.py, git 037249c^, FEEDBACK_LOG #15): ~4.2 px at 1920 high, near-black,
#         silhouettes + borders + creases at 130 deg, thinner with distance, faded on props right at the lens.
#   toon  ink + cel shading: every Principled material keeps its colour / texture, but the light on it is quantised into
#         lit / mid / shade bands (Shader to RGB -> constant colour ramp), so surfaces read as painted, not photographed.
import math
import bpy

INK_PX = 4.2           # line width in px at 1920 px frame height
INK_RGB = (0.012, 0.012, 0.012)
# never inked: invisible framing boxes, fire, glow and steam, glass, and the character cards (not in "Set" anyway)
SKIP = ("SUBJ-", "fire", "flame", "glow", "steam", "smoke", "light", "window_glass", "haze")


def log(*a):
    print("[look]", *a, flush=True)


def _emissive_or_clear(ob):
    """materials that are light sources or see-through do not get lines or bands"""
    for slot in ob.material_slots:
        m = slot.material
        if not m or not m.use_nodes:
            continue
        for n in m.node_tree.nodes:
            if n.type in ("EMISSION", "BSDF_TRANSPARENT", "BSDF_GLASS"):
                return True
            if n.type == "BSDF_PRINCIPLED":
                tw = n.inputs.get("Transmission Weight")
                if n.inputs["Alpha"].default_value < 0.6 or (tw is not None and tw.default_value > 0.5):
                    return True
                es = n.inputs.get("Emission Strength")
                if es is not None and es.default_value > 0.5 and not n.inputs["Emission Color"].is_linked \
                        and max(n.inputs["Emission Color"].default_value[:3]) > 0.05:
                    return True
    return False


def ink_targets(sc):
    s = bpy.data.collections.get("Set")
    objs = list(s.all_objects) if s else [ob for ob in sc.objects]
    out = []
    for ob in objs:
        if ob.type not in ("MESH", "CURVE") or ob.hide_render:
            continue
        low = ob.name.lower()
        if ob.name.startswith("SUBJ-") or any(k.lower() in low for k in SKIP[1:]):
            continue
        if ob.type == "MESH" and _emissive_or_clear(ob):
            continue
        out.append(ob)
    return out


def ink(sc, height, px=INK_PX):
    """Freestyle lines on a collection 'Ink' that holds the set objects worth outlining"""
    col = bpy.data.collections.get("Ink") or bpy.data.collections.new("Ink")
    if col.name not in sc.collection.children:
        sc.collection.children.link(col)
    for ob in list(col.objects):
        col.objects.unlink(ob)
    targets = ink_targets(sc)
    for ob in targets:
        col.objects.link(ob)          # a second collection link: the object still renders once
    r = sc.render
    r.use_freestyle = True
    r.line_thickness_mode = "ABSOLUTE"
    r.line_thickness = px * height / 1920
    vl = sc.view_layers[0]
    vl.use_freestyle = True
    fs = vl.freestyle_settings
    fs.crease_angle = math.radians(130)
    ls = fs.linesets[0] if fs.linesets else fs.linesets.new("ink")
    ls.select_by_collection = True
    ls.collection = col
    ls.select_silhouette = ls.select_border = ls.select_crease = ls.select_contour = ls.select_external_contour = True
    if ls.linestyle is None:
        ls.linestyle = bpy.data.linestyles.new("ink")
    st = ls.linestyle
    st.color = INK_RGB
    st.thickness = 1.0
    if not st.thickness_modifiers:      # thinner with distance (3.7 px at 3 m -> ~1.7 px at 40 m)
        tm = st.thickness_modifiers.new("far", "DISTANCE_FROM_CAMERA")
        tm.range_min, tm.range_max, tm.value_min, tm.value_max = 3.0, 40.0, 1.0, 0.45
        tm.mapping = "LINEAR"
    if not st.alpha_modifiers:          # no hard line on a prop right at the lens (the depth of field softens it)
        am = st.alpha_modifiers.new("near", "DISTANCE_FROM_CAMERA")
        am.range_min, am.range_max = 0.25, 0.6
        am.mapping = "LINEAR"
        am.blend = "MULTIPLY"
    return len(targets)


def _ink_mat():
    m = bpy.data.materials.get("look_ink_hull")
    if m is None:
        m = bpy.data.materials.new("look_ink_hull")
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = INK_RGB + (1,)
        nt.links.new(em.outputs[0], nt.nodes.new("ShaderNodeOutputMaterial").inputs[0])
        m.use_backface_culling = True
        if hasattr(m, "use_backface_culling_shadow"):
            m.use_backface_culling_shadow = True
    return m


def hull(sc, height, px=INK_PX):
    """an ink rim for the small hero props Freestyle leaves bare (the food: its tube and band meshes get no Freestyle
    lines in Blender 5.3, tested 2026-11-26): a slightly larger shell with flipped normals, black, front faces culled,
    so only its edge shows around the silhouette. Width = px at the object's distance from the active camera."""
    cam = sc.camera
    if cam is None:
        return 0
    ink = _ink_mat()
    fov = cam.data.angle_y if hasattr(cam.data, "angle_y") else 0.7
    n = 0
    for ob in ink_targets(sc):
        if ob.type not in ("MESH", "CURVE") or ob.name.endswith("_inkmesh"):
            continue
        # size in its own space (a variant hidden by a zero-scaled parent still has its real size)
        bb = ob.bound_box
        dims = max(max(c[i] for c in bb) - min(c[i] for c in bb) for i in range(3)) * max(abs(x) for x in ob.scale)
        if not (0.02 < dims < 0.45) or any(mo.type == "SOLIDIFY" and mo.name == "look_hull" for mo in ob.modifiers):
            continue
        d = max(0.2, (ob.matrix_world.translation - cam.matrix_world.translation).length)
        w = px / height * 2 * d * math.tan(fov / 2)
        if ob.data.users > 1:
            ob.data = ob.data.copy()
        ob.data.materials.append(ink)
        mo = ob.modifiers.new("look_hull", "SOLIDIFY")
        mo.thickness = w
        mo.offset = 1.0
        mo.use_flip_normals = True
        mo.use_rim = False
        mo.material_offset = len(ob.data.materials) - 1
        n += 1
    return n


def _cel(m, bands):
    """put the light on a Principled material through a constant ramp; colour and textures stay"""
    nt = m.node_tree
    if nt.nodes.get("look_cel"):
        return False
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None) \
        or next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
    if bsdf is None or out is None or not out.inputs["Surface"].is_linked or out.inputs["Surface"].links[0].from_node != bsdf:
        return False
    base = bsdf.inputs["Base Color"]
    # light only: a white diffuse with the same normal, quantised
    dif = nt.nodes.new("ShaderNodeBsdfDiffuse")
    dif.name = "look_cel"
    dif.inputs["Color"].default_value = (1, 1, 1, 1)
    if bsdf.inputs["Normal"].is_linked:
        nt.links.new(bsdf.inputs["Normal"].links[0].from_socket, dif.inputs["Normal"])
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    nt.links.new(dif.outputs[0], s2r.inputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.0, (bands[0],) * 3 + (1,)
    els[1].position, els[1].color = 0.18, (bands[1],) * 3 + (1,)
    e = els.new(0.55)
    e.color = (bands[2],) * 3 + (1,)
    nt.links.new(s2r.outputs["Color"], ramp.inputs["Fac"])
    # the light's colour (firelight orange, moonlight blue) survives: hue and saturation of the light, value 1
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    sep.mode = "HSV"
    nt.links.new(s2r.outputs["Color"], sep.inputs["Color"])
    tint = nt.nodes.new("ShaderNodeCombineColor")
    tint.mode = "HSV"
    nt.links.new(sep.outputs[0], tint.inputs[0])
    nt.links.new(sep.outputs[1], tint.inputs[1])
    tint.inputs[2].default_value = 1.0

    def mix(a, b):
        m = nt.nodes.new("ShaderNodeMix")
        m.data_type, m.blend_type = "RGBA", "MULTIPLY"
        m.inputs["Factor"].default_value = 1.0
        for sock, v in ((m.inputs["A"], a), (m.inputs["B"], b)):
            if v.is_output:                       # a node output: wire it
                nt.links.new(v, sock)
            elif v.is_linked:                     # an input (Base Color) fed by a texture: wire its source
                nt.links.new(v.links[0].from_socket, sock)
            else:                                 # an input with a plain colour: copy it
                sock.default_value = v.default_value
        return m.outputs["Result"]
    lit = mix(ramp.outputs["Color"], tint.outputs["Color"])
    col = mix(base, lit)
    emi = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(col, emi.inputs["Color"])
    nt.links.new(emi.outputs[0], out.inputs["Surface"])
    return True


def toon(sc, bands=(0.42, 0.72, 1.0)):
    """cel shading on the inked set objects' materials (the cards keep their own drawn shading)"""
    mats = {slot.material for ob in ink_targets(sc) for slot in ob.material_slots if slot.material and slot.material.use_nodes}
    return sum(_cel(m, bands) for m in mats)


def apply(sc, height, mode="ink"):
    if mode in ("none", "0", ""):
        return
    n = ink(sc, height)
    msg = f"viền mực Freestyle trên {n} vật, viền vỏ trên {hull(sc, height)} món nhỏ"
    if mode == "toon":
        msg += f", tô hai tông {toon(sc)} chất liệu"
    log(msg)
