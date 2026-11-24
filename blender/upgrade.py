# Blender-side "upgrade layer" (2026-11-24): the scene code is the blueprint (layout, camera, characters, rules); this
# layer gives the imported set what the three.js toon look never needed, at the channel's level of realism
# (VISUAL_DENSITY.md: a stylised game world, not a photo):
#   1. rounded edges on boxy props (bevel) and smooth shading on curved ones
#   2. surface relief from the painted texture itself (brick mortar, wood grain, stone joints) + faint fine noise,
#      and a sensible roughness floor
#   3. real lights at every glowing source (window, fire, lamp) so light pools fall on the room
#   4. a light atmosphere (volume) so beams and depth read
# Everything is automatic and keyed off geometry / materials; options: --bevel 0 to skip, --relief 0.0..1, --atmo density.
import math
import bpy
from mathutils import Vector
from common import log


def _bevel_and_smooth(objs, emit, opt):
    if float(opt.get("bevel", 1)) <= 0:
        return 0
    n = 0
    for name, o in objs.items():
        if name in emit or o.type != "MESH":
            continue
        me = o.data
        polys = len(me.polygons)
        dims = sorted(x for x in o.dimensions if x > 1e-4)
        if not dims:
            continue
        if polys > 60:                                   # curved geometry (lathe, cylinders, spheres): smooth it
            if hasattr(me, "set_sharp_from_angle"):
                me.set_sharp_from_angle(angle=math.radians(40))
            me.polygons.foreach_set("use_smooth", [True] * polys)
        if polys <= 400 and dims[0] > 0.015 and max(dims) < 30:   # boxy props: rounded edges (not the floor or walls)
            b = o.modifiers.new("bevel", "BEVEL")
            b.width = min(0.02, dims[0] * 0.12)
            b.segments = 2
            b.limit_method = "ANGLE"
            b.angle_limit = math.radians(50)
            n += 1
    return n


def _relief(mats, opt):
    k = float(opt.get("relief", 1.0))
    if k <= 0:
        return 0
    n = 0
    for m in mats:
        if not m or not m.use_nodes:
            continue
        nt = m.node_tree
        bsdf = next((x for x in nt.nodes if x.type == "BSDF_PRINCIPLED"), None)
        if not bsdf or bsdf.inputs["Normal"].is_linked:
            continue
        r = bsdf.inputs["Roughness"]
        if not r.is_linked:
            r.default_value = max(0.45, r.default_value)
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.35 * k
        bump.inputs["Distance"].default_value = 0.01
        height = None
        base = bsdf.inputs["Base Color"]
        if base.is_linked and base.links[0].from_node.type == "TEX_IMAGE":
            # painted texture -> height: darker = deeper (mortar, grain, joints)
            bw = nt.nodes.new("ShaderNodeRGBToBW")
            nt.links.new(base.links[0].from_node.outputs["Color"], bw.inputs[0])
            height = bw.outputs[0]
        noise = nt.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 55.0
        noise.inputs["Detail"].default_value = 4.0
        if height is not None:
            add = nt.nodes.new("ShaderNodeMath")
            add.operation = "MULTIPLY_ADD"
            nt.links.new(noise.outputs["Fac"], add.inputs[0])
            add.inputs[1].default_value = 0.15
            nt.links.new(height, add.inputs[2])
            nt.links.new(add.outputs[0], bump.inputs["Height"])
        else:
            nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
            bump.inputs["Strength"].default_value = 0.12 * k
        nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        n += 1
    return n


def _lights_at_emitters(objs, emit, opt):
    """an area light in front of every flat glowing panel (window, fire), a point light inside every glowing box (lamp)"""
    k = float(opt.get("lamp", 0.5))     # 1.0 lit the room deep orange from the fire (FEEDBACK_LOG #15)
    made = 0
    others = [o for n, o in objs.items() if n not in emit and o.type == "MESH" and max(o.dimensions) < 30]
    centre = sum((o.matrix_world @ (sum((Vector(b) for b in o.bound_box), Vector()) / 8) for o in others), Vector()) / max(len(others), 1)
    for name in emit:
        o = objs.get(name)
        if not o or o.type != "MESH":
            continue
        mw = o.matrix_world
        pts = [mw @ v.co for v in o.data.vertices]
        c = sum(pts, Vector()) / max(len(pts), 1)
        dims = sorted(o.dimensions)
        col = (1.0, 0.85, 0.6)
        m = o.active_material
        if m and m.use_nodes:
            e = next((x for x in m.node_tree.nodes if x.type == "EMISSION"), None)
            if e is not None and not e.inputs["Color"].is_linked:
                cc = e.inputs["Color"].default_value
                mx = max(cc[0], cc[1], cc[2]) or 1
                col = (cc[0] / mx, cc[1] / mx, cc[2] / mx)
            elif e is not None:                                       # a painted glow (fire): warm, not deep orange
                col = (1.0, 0.72, 0.48)
        if dims[0] < 0.02 and len(o.data.polygons):                   # a flat panel: area light facing out of the panel
            nrm = (mw.to_3x3() @ o.data.polygons[0].normal).normalized()
            if nrm.dot(centre - c) < 0:                                 # face into the room (toward the set's centre)
                nrm = -nrm
            ld = bpy.data.lights.new(f"L_{name}", "AREA")
            ld.shape = "RECTANGLE"
            big = sorted(o.dimensions, reverse=True)
            ld.size, ld.size_y = max(big[0], 0.05), max(big[1], 0.05)
            area = ld.size * ld.size_y
            ld.energy = area * 120.0 * k
            lo = bpy.data.objects.new(f"L_{name}", ld)
            lo.location = c + nrm * 0.03
            lo.rotation_mode = "QUATERNION"
            lo.rotation_quaternion = nrm.to_track_quat("-Z", "Y")
        else:                                                         # a glowing box or blob: a point light inside
            ld = bpy.data.lights.new(f"L_{name}", "POINT")
            ld.shadow_soft_size = max(0.05, dims[-1] * 0.4)
            ld.energy = 60.0 * k
            lo = bpy.data.objects.new(f"L_{name}", ld)
            lo.location = c
        ld.color = col
        bpy.context.scene.collection.objects.link(lo)
        made += 1
    return made


def _atmosphere(objs, emit, sc, opt):
    """a light haze in a box around the set (not the whole sky: a world volume swallowed the sun)"""
    interior = sc["light"].get("name") in ("interior", "table", "night")
    dens = float(opt.get("atmo", 0.004 if interior else 0.0015))   # .009 washed the room out (FEEDBACK_LOG #14)
    if dens <= 0:
        return 0.0
    others = [o for n, o in objs.items() if n not in emit and o.type == "MESH" and max(o.dimensions) < 30]
    if not others:
        return 0.0
    pts = [o.matrix_world @ Vector(b) for o in others for b in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    bpy.ops.mesh.primitive_cube_add(size=1, location=(lo + hi) / 2)
    box = bpy.context.active_object
    box.name = "atmosphere"
    box.scale = hi - lo
    m = bpy.data.materials.new("atmosphere")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = dens
    vol.inputs["Anisotropy"].default_value = 0.6
    vol.inputs["Color"].default_value = (1.0, 0.98, 0.95, 1)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(vol.outputs[0], out.inputs["Volume"])
    box.data.materials.append(m)
    box.visible_shadow = False
    return dens


def upgrade(objs, sc, opt):
    emit = set(sc.get("emit", []))
    nb = _bevel_and_smooth(objs, emit, opt)
    mats = {s.material for o in objs.values() if o.type == "MESH" and o.name.split(".")[0] not in emit for s in o.material_slots}
    nr = _relief(mats, opt)
    nl = _lights_at_emitters(objs, emit, opt)
    da = _atmosphere(objs, emit, sc, opt)
    log(f"nâng cấp: bo cạnh {nb} vật, lồi lõm {nr} vật liệu, {nl} đèn tại nguồn sáng, sương {da}")
