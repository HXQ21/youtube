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
res, samples = int(opt.get("res", 2048)), int(opt.get("samples", 384))
reset()
objs = import_set(d)
emitters(objs, sc["emit"])
lights(sc)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
log("thiết bị", gpu(scene))
scene.cycles.samples = samples

emit = set(sc["emit"])
targets = [objs[n] for n in sc["statics"] if n in objs and n not in emit]
log(f"{len(targets)} vật được nướng sáng, ảnh {res}x{res}, {samples} mẫu")

# one shared lightmap layout: a second UV map "bake" on every target, packed together
bpy.ops.object.select_all(action="DESELECT")
for o in targets:
    if not o.data.uv_layers:
        o.data.uv_layers.new(name="UVMap")
    uv = o.data.uv_layers.new(name="bake")
    o.data.uv_layers.active = uv
    o.select_set(True)
bpy.context.view_layer.objects.active = targets[0]
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0)
bpy.ops.uv.average_islands_scale()
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
px = px.reshape(-1, 4)
lum = px[:, :3].max(axis=1)
used = lum[lum > 1e-5]
top = float(np.percentile(used, 98)) if used.size else 1.0
s = 0.92 / max(top, 1e-4)
lin = np.clip(px[:, :3] * s, 0, 1)
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
