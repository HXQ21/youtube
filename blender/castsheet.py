# Character sheet drawn by Blender Grease Pencil, with the SAME layout as the old src/core/CastSheet.tsx (1920 x 1080,
# cells 600 x 1000 design units at 0.42, 7 per row): row 1 = 7 expressions, row 2 = knead / peel / offer / cheeks
# hands + side walk at phase 0, 0.25, 0.5. Used to check the Grease Pencil cast against out/_cast_ref/<who>-v<v>.png.
#   blender -b --python blender/castsheet.py -- --who baker --v 0 --out out/_cast_gp/baker-v0.png
# Inside a running Blender (MCP): import castsheet; castsheet.build("baker", 0); castsheet.render(path)
import bpy, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, "draw")):
    if p not in sys.path:
        sys.path.insert(0, p)

import people                            # noqa: E402
from people import pose_key, SU, STEP_M  # noqa: E402
from gpwrite import new_character, write, hex_lin   # noqa: E402

W, H, K, GX, GY, CW, CH = 1920, 1080, 0.42, 18, 60, 600, 1000
BG, LABEL = "#f6efe2", "#5a4a3a"
M_PER_PX = SU / K                        # world metres per sheet pixel


def px_to_world(X, Y):
    return ((X - W / 2) * M_PER_PX, (H / 2 - Y) * M_PER_PX)


def cells(who, v):
    """(label, primitives function) per cell, through people.pose_key: the SAME code the scenes use (people.STYLE)"""
    F = 50                               # a frame with the eyes open

    def cell(label, **pose):
        _, draw = pose_key(who, v, F, pose)
        return label, draw

    def face(expr):
        return cell(expr, expr=expr)

    def hands(label, h, expr, hold=False):
        return cell(label, expr=expr, hands=h, hold="croissant" if hold else None)

    def walk(phase):
        return cell(f"walk {phase:g}", side=dict(dist=phase * STEP_M, dir=1))

    return [
        [face("neutral"), face("smile"), face("grin"), face("shock"), face("nervous"), face("stern"), face("laugh")],
        [hands("knead", [(-0.12, 1.0), (0.12, 1.0)], "neutral"), hands("peel", [(0.1, 0.98), (0.34, 0.94)], "smile_closed"),
         hands("offer", [(-0.2, 1.02), (0.42, 1.4)], "smile", True), hands("cheeks", [(-0.3, 1.3), (0.3, 1.3)], "shock"),
         walk(0), walk(0.25), walk(0.5)],
    ]


def _flat_mat(name, hexc):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = hex_lin(hexc)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def _text(col, body, X, Y, size_px, mat):
    cu = bpy.data.curves.new("lbl", "FONT")
    cu.body = body
    cu.size = size_px * M_PER_PX * 1.36      # Blender font size ~ em; canvas px size ~ cap+descender
    ob = bpy.data.objects.new("lbl_" + body, cu)
    x, z = px_to_world(X, Y)
    ob.location = (x, 0.05, z)
    ob.rotation_euler = (math.pi / 2, 0, 0)  # text lies in XZ, readable from -Y
    cu.materials.append(mat)
    col.objects.link(ob)
    return ob


def build(who="baker", v=0):
    """a fresh scene 'CastSheet' with one Grease Pencil object per cell and an orthographic camera"""
    sc = bpy.data.scenes.get("CastSheet")
    if sc is not None:
        for ob in list(sc.collection.all_objects):
            bpy.data.objects.remove(ob, do_unlink=True)
    else:
        sc = bpy.data.scenes.new("CastSheet")
    col = sc.collection
    lab = _flat_mat("castLabel", LABEL)
    title = _flat_mat("castTitle", "#3a2a20")
    counts = {}
    for r, row in enumerate(cells(who, v)):
        for i, (label, draw) in enumerate(row):
            prims = draw()
            ob = new_character(f"cast_{r}_{i}", col)
            write(ob.data.layers[0].frames.new(1).drawing, prims)
            ox, oy = GX + i * (CW * K + GX), GY + r * (CH * K + GY)
            x, z = px_to_world(ox + 300 * K, oy + 975 * K)   # design (300, 975) = feet = object origin
            ob.location = (x, 0, z)
            counts[label] = len(prims)
            _text(col, label, ox + 8, oy - 14, 22, lab)
    _text(col, f"{who} v{v}: drawn by Blender Grease Pencil (blender/draw, style {people.STYLE})", 18, H - 22, 30, title)

    cam = bpy.data.cameras.new("castCam")
    cam.type = "ORTHO"
    cam.ortho_scale = W * M_PER_PX
    cob = bpy.data.objects.new("castCam", cam)
    cob.location = (0, -10, 0)
    cob.rotation_euler = (math.pi / 2, 0, 0)            # looks along +Y at the drawings (they face -Y)
    col.objects.link(cob)
    sc.camera = cob

    world = bpy.data.worlds.get("castWorld") or bpy.data.worlds.new("castWorld")
    world.use_nodes = True
    nt = world.node_tree
    bgn = nt.nodes.get("Background")
    if bgn is None:
        nt.nodes.clear()
        bgn = nt.nodes.new("ShaderNodeBackground")
        nt.links.new(bgn.outputs[0], nt.nodes.new("ShaderNodeOutputWorld").inputs[0])
    bgn.inputs["Color"].default_value = hex_lin(BG)
    bgn.inputs["Strength"].default_value = 1.0
    sc.world = world

    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"       # hex colours come back exactly
    sc.view_settings.look = "None"
    sc.view_settings.exposure, sc.view_settings.gamma = 0.0, 1.0
    sc.frame_start = sc.frame_end = sc.frame_current = 1
    sc.eevee.taa_render_samples = 16
    sc.render.filter_size = 0.6                        # canvas-sharp edges (the 1.5 px default softens the ink)
    return sc, counts


def render(path, sc=None):
    sc = sc or bpy.data.scenes["CastSheet"]
    sc.render.filepath = os.path.abspath(path)
    sc.render.image_settings.file_format = "PNG"
    os.makedirs(os.path.dirname(sc.render.filepath), exist_ok=True)
    win = bpy.context.window
    old = win.scene if win else None
    if win:
        win.scene = sc
    try:
        bpy.ops.render.render(write_still=True, scene=sc.name)
    finally:
        if win and old:
            win.scene = old
    return sc.render.filepath


def single(sc, px=1200):
    """keep only the first cell (neutral face, front, full body) on the plain sheet colour, no labels: the Seedance
    character reference. The BytePlus Seedance 2.0 prompt guide warns that multi-pose / multi-view sheets are read as
    several people (duplicated characters, ID drift): one clean full-body image per character instead."""
    for ob in list(sc.collection.all_objects):
        if ob.name not in ("cast_0_0", "castCam"):
            bpy.data.objects.remove(ob, do_unlink=True)
    cx, cy, w, h = GX + CW * K / 2, GY + CH * K / 2 - 10, CW * K + 70, (CW * K + 70) * 1.5
    cob = sc.objects["castCam"]
    cob.data.ortho_scale = h * M_PER_PX                 # the larger (vertical) side of a 2:3 frame
    x, z = px_to_world(cx, cy)
    cob.location = (x, -10, z)
    sc.render.resolution_x, sc.render.resolution_y = round(px * w / h), px
    return sc


if __name__ == "__main__":
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opt = {a[i][2:]: a[i + 1] for i in range(0, len(a) - 1) if a[i].startswith("--")}
    who, v = opt.get("who", "baker"), int(opt.get("v", 0))
    sc, _ = build(who, v)
    if opt.get("single") == "1":
        single(sc)
    if bpy.context.window is None:
        bpy.context.window_manager.windows  # background: render the CastSheet scene directly
    render(opt.get("out", os.path.join(HERE, "..", "out", "_cast_gp", f"{who}-v{v}.png")), sc)
