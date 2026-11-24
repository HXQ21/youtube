# Pen primitives -> Grease Pencil strokes (Blender 5.3 Grease Pencil v3), written in bulk through the drawing's
# attributes (fast enough for one drawing per pose per frame). The drawing lies in the object's XZ plane, feet at the
# origin, so the character faces -Y; scenes turn the object toward the camera about Z.
#   fill  -> a closed stroke with the "fill" material, its own fill_id (Blender 5 draws a fill per fill_id) and
#            fill_color (per-stroke colour, overrides the material)
#   line  -> a stroke with the "ink" material; colour per point (vertex_color), radius = half the width
# Colours: hex sRGB -> linear (Grease Pencil stores linear colour).
import bpy

SU = 0.00216
DEPTH_STEP = 0.004      # each later primitive sits this much nearer the viewer (-Y), so with stroke_depth_order "3D" the
                        # drawing order holds. Must exceed the thickest stroke radius (~0.03 m): a thick stroke's depth pokes
                        # through a fill drawn just in front of it. Drawings are baked to PNG cards with an ortho lens, so the
                        # ~0.4 m spread never shows.
LINE_K = 1.12   # Grease Pencil draws a radius-r stroke ~1 px thinner than a canvas line of width 2r (measured on the cast sheet)


def _lin(v):
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def hex_lin(h, a=1.0):
    h = h.lstrip("#")
    return (_lin(int(h[0:2], 16) / 255), _lin(int(h[2:4], 16) / 255), _lin(int(h[4:6], 16) / 255), a)


def ensure_materials(gp):
    """index 0 = fill (no outline), index 1 = ink (line only); colours come from the strokes"""
    if len(gp.materials) >= 2 and gp.materials[0].name.startswith("gpFill"):
        return
    for name, fill, stroke in (("gpFill", True, False), ("gpInk", False, True)):
        m = bpy.data.materials.get(name)
        if m is None:
            m = bpy.data.materials.new(name)
            bpy.data.materials.create_gpencil_data(m)
            g = m.grease_pencil
            g.show_fill, g.show_stroke = fill, stroke
            g.color = (1, 1, 1, 1)
            g.fill_color = (1, 1, 1, 1)
        gp.materials.append(m)


def _attr(d, name, typ, dom):
    a = d.attributes.get(name)
    return a if a is not None else d.attributes.new(name, typ, dom)


def write(d, prims):
    """append the primitives to drawing `d` as strokes, in drawing order (later = on top)"""
    prims = [q for q in prims if len(q[1]) >= (3 if q[0] == "fill" else 2)]
    if not prims:
        return 0
    base = len(d.strokes)
    d.add_strokes([len(q[1]) for q in prims])
    pos, rad, col, opa = [], [], [], []
    mi, cyc, fcol, fid, cap = [], [], [], [], []
    fill_no = 0
    for k, q in enumerate(prims):
        pts = q[1]
        dy = -k * DEPTH_STEP
        for x, y in pts:
            pos += ((x - 300) * SU, dy, (975 - y) * SU)
        opa += [1.0] * len(pts)
        if q[0] == "fill":
            fill_no += 1
            rad += [0.0004] * len(pts)
            col += [0.0, 0.0, 0.0, 0.0] * len(pts)
            mi.append(0); cyc.append(True); fcol += hex_lin(q[2]); fid.append(fill_no); cap.append(0)
        else:
            _, _, c, ws, closed, cp = q
            rad += [max(w, 0.2) * 0.5 * SU * LINE_K for w in ws]
            col += hex_lin(c) * len(pts)
            mi.append(1); cyc.append(bool(closed)); fcol += (0.0, 0.0, 0.0, 0.0); fid.append(0); cap.append(1 if cp == "flat" else 0)

    if base:
        raise ValueError("gpwrite.write expects a fresh drawing")

    def put(name, typ, dom, key, vals):
        _attr(d, name, typ, dom).data.foreach_set(key, vals)

    put("position", "FLOAT_VECTOR", "POINT", "vector", pos)
    put("radius", "FLOAT", "POINT", "value", rad)
    put("opacity", "FLOAT", "POINT", "value", opa)
    put("vertex_color", "FLOAT_COLOR", "POINT", "color", col)
    put("material_index", "INT", "CURVE", "value", mi)
    put("cyclic", "BOOLEAN", "CURVE", "value", cyc)
    put("fill_color", "FLOAT_COLOR", "CURVE", "color", fcol)
    put("fill_id", "INT", "CURVE", "value", fid)
    for nm in ("start_cap", "end_cap"):
        try:
            put(nm, "INT8", "CURVE", "value", cap)
        except Exception:
            pass
    d.tag_positions_changed()
    return len(prims)


def new_character(name, collection, lights=False):
    """an empty Grease Pencil character object (one layer), feet at the origin, facing -Y"""
    gp = bpy.data.grease_pencils.new(name)
    gp.stroke_depth_order = "3D"     # "2D" draws the card over every mesh, even one standing in front of it
    ensure_materials(gp)
    layer = gp.layers.new("cast")
    layer.use_lights = lights
    ob = bpy.data.objects.new(name, gp)
    collection.objects.link(ob)
    return ob
