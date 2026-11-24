# Bake the light of a set in Cycles (sun + sky + glowing windows/fire, with bounce light and soft shadows) into ONE
# lightmap shared by every static mesh, then export those meshes with a second UV set for it.
#   blender -b --python blender/bake.py -- <dir> [--res 2048] [--samples 384]
# Out: <dir>/set-baked.glb (meshes m<i> with TEXCOORD_1) + <dir>/lightmap.png (sRGB, scaled; scene extra lmScale)
# The three.js renderer swaps these in (src/core/direct.ts applyBaked): colour/texture x baked light, unlit.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, math
import numpy as np
from common import args, log, reset, import_set, emitters, lights, gpu

d, sc, opt = args()
res, samples = int(opt.get("res", 2048)), int(opt.get("samples", 1024))
reset()
objs = import_set(d)
emitters(objs, sc["emit"])
lights(sc, world_k=float(opt.get("sky", 0.5 if opt.get("style", "toon") == "toon" else 1.6)))
scene = bpy.context.scene
scene.render.engine = "CYCLES"
log("thiết bị", gpu(scene))
scene.cycles.samples = samples

emit = set(sc["emit"])
targets = [objs[n] for n in sc["statics"] if n in objs and n not in emit]
log(f"{len(targets)} vật được nướng sáng, ảnh {res}x{res}, {samples} mẫu")

# one shared lightmap layout: a second UV map "bake" on every target, packed together.
# A huge flat ground (a street is a 240 x 200 m plane) would take almost the whole map, so it is cut along the
# rectangle the shot can actually see (the other props + the camera path, plus a margin): only that cell gets
# lightmap space, the far cells reuse its edge texels (no shadows reach that far anyway).
import bmesh
from mathutils import Vector
from common import v3

def area(o):
    s = o.matrix_world.to_scale()
    return sum(p.area for p in o.data.polygons) * abs(s.x * s.y * s.z) ** (2 / 3)

grounds = [o for o in targets if area(o) > 3000 and o.dimensions.z < 0.05 * max(o.dimensions)]
for o in targets:
    if not o.data.uv_layers:
        o.data.uv_layers.new(name="UVMap")
    o.data.uv_layers.active = o.data.uv_layers.new(name="bake")
crop = None
if grounds:
    pts = [o.matrix_world @ Vector(c) for o in targets if o not in grounds for c in o.bound_box]
    pts += [v3(f["cam"]["pos"]) for f in sc["frames"]]
    m = 3.0
    crop = (min(p.x for p in pts) - m, max(p.x for p in pts) + m, min(p.y for p in pts) - m, max(p.y for p in pts) + m)
    log(f"mặt đất lớn: {', '.join(o.name for o in grounds)}; chỉ nướng vùng {crop[1] - crop[0]:.0f} x {crop[3] - crop[2]:.0f} m")
    for o in grounds:
        bm = bmesh.new(); bm.from_mesh(o.data)
        inv = o.matrix_world.inverted()
        for co, no in (((crop[0], 0, 0), (1, 0, 0)), ((crop[1], 0, 0), (1, 0, 0)), ((0, crop[2], 0), (0, 1, 0)), ((0, crop[3], 0), (0, 1, 0))):
            geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
            bmesh.ops.bisect_plane(bm, geom=geom, plane_co=inv @ Vector(co), plane_no=(inv.to_3x3().transposed().inverted() @ Vector(no)).normalized())
        bm.to_mesh(o.data); bm.free()
others = [o for o in targets if o not in grounds]
bpy.ops.object.select_all(action="DESELECT")
for o in others:
    o.select_set(True)
bpy.context.view_layer.objects.active = others[0]
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0)
bpy.ops.uv.average_islands_scale()
bpy.ops.object.mode_set(mode="OBJECT")
# texel density of the unwrapped props (UV length per metre), so the ground cell gets the same density
uva, wa = 0.0, 0.0
for o in others:
    uv = o.data.uv_layers["bake"].data
    for p in o.data.polygons:
        co = [uv[i].uv for i in p.loop_indices]
        uva += abs(sum(co[i].x * co[(i + 1) % len(co)].y - co[(i + 1) % len(co)].x * co[i].y for i in range(len(co)))) / 2
    wa += area(o)
k = math.sqrt(uva / max(wa, 1e-6))
for o in grounds:
    uv = o.data.uv_layers["bake"].data
    for p in o.data.polygons:
        for li, vi in zip(p.loop_indices, p.vertices):
            w = o.matrix_world @ o.data.vertices[vi].co
            x, y = min(max(w.x, crop[0]), crop[1]), min(max(w.y, crop[2]), crop[3])
            uv[li].uv = ((x - crop[0]) * k, (y - crop[2]) * k)
bpy.ops.object.select_all(action="DESELECT")
for o in targets:
    o.select_set(True)
bpy.context.view_layer.objects.active = targets[0]
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.select_all(action="SELECT")
bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
bpy.ops.object.mode_set(mode="OBJECT")

img = bpy.data.images.new("lightmap", res, res, alpha=False, float_buffer=True)
for o in targets:
    for slot in o.material_slots:
        m = slot.material
        if not m:
            continue
        if not m.use_nodes:
            m.use_nodes = True
        nt = m.node_tree
        n = nt.nodes.get("bake_target") or nt.nodes.new("ShaderNodeTexImage")
        n.name = "bake_target"
        n.image = img
        uvn = nt.nodes.get("bake_uv") or nt.nodes.new("ShaderNodeUVMap")
        uvn.name = "bake_uv"
        uvn.uv_map = "bake"
        nt.links.new(uvn.outputs[0], n.inputs[0])
        nt.nodes.active = n

scene.render.bake.use_pass_direct = True
scene.render.bake.use_pass_indirect = True
scene.render.bake.use_pass_color = False
scene.render.bake.margin = 6
bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=6, use_clear=True)
log("nướng xong")

# scale so the brightest 2 % of texels sit near white, store sRGB-encoded 8-bit, keep the scale for three.js
px = np.empty(res * res * 4, dtype=np.float32)
img.pixels.foreach_get(px)
px = px.reshape(res, res, 4)
# de-noise: a small separable blur (5 taps, twice), weighted by coverage so empty texels around islands do not
# darken their edges; the bake margin keeps islands from bleeding into each other at this radius
cov = (px[:, :, :3].max(axis=2) > 1e-6).astype(np.float32)[:, :, None]
def blur(a):
    k = np.array([1, 4, 6, 4, 1], dtype=np.float32) / 16
    for ax in (0, 1):
        a = sum(np.roll(a, s - 2, axis=ax) * k[s] for s in range(5))
    return a
rad = int(opt.get("denoise", 2))
if rad > 0:
    col, w = px[:, :, :3] * cov, cov
    for _ in range(rad):
        col, w = blur(col), blur(w)
    px[:, :, :3] = np.where(cov > 0, col / np.maximum(w, 1e-6), 0)
px = px.reshape(-1, 4)
lum = px[:, :3].max(axis=1)
used = lum[lum > 1e-5]
top = float(np.percentile(used, 98)) if used.size else 1.0
style = opt.get("style", "toon")
if style == "toon":
    # the channel's look: store only HOW MUCH light reaches each texel (1.0 = a face in full sun; soft shadows,
    # bounce, contact darkening, warm glow from windows). The renderer turns it into the scene's two-tone palette
    # (shade colour + cool lift in shadow, lit colour in sun), so colours stay exactly as the toon shading draws them.
    s = 0.5 / max(top, 1e-4)
else:
    s = 0.92 / max(top, 1e-4)
lin = np.clip(px[:, :3] * s, 0, 1)
scene["lmStyle"] = style
img.filepath_raw = os.path.join(d, "lightmap-raw.exr")
img.file_format = "OPEN_EXR"
img.save()
enc = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
out = np.concatenate([enc, np.ones((enc.shape[0], 1), dtype=np.float32)], axis=1).astype(np.float32)
img8 = bpy.data.images.new("lightmap8", res, res, alpha=False, float_buffer=False)
img8.pixels.foreach_set(out.ravel())
img8.filepath_raw = os.path.join(d, "lightmap.png")
img8.file_format = "PNG"
img8.save()
scene["lmScale"] = 1.0 / s
log(f"lightmap.png (thang {1.0 / s:.3f})")

bpy.ops.object.select_all(action="DESELECT")
for o in targets:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(d, "set-baked.glb"), export_format="GLB", use_selection=True, export_extras=True,
                          export_texcoords=True, export_normals=True, export_materials="EXPORT", export_yup=True)
log("set-baked.glb")
