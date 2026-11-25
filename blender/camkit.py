# Camera intelligence for the Blender sets, ported from the three.js renderer (2026-11-25, FEEDBACK_LOG #27):
#   src/core/stage.ts  frame, charCam, heroCam, lowCam, highCam, povCam (build cameras that frame a subject box)
#   src/core/direct.ts auditTimeline RULES (pitch, edge distortion, camera jump) and the level horizon for 2D cards
# Two halves:
#   builder: make_cam(...) + hero_cam/char_cam/... give a set builder (Blender MCP, blender/scenes/*.py) a CAM- object
#            that frames a subject box at the render aspect, with the 2D-safe limits built in;
#   runtime: blender/shot.py levels the horizon when characters are on screen, dollies each shot back just enough to
#            keep every subject inside the frame (what frame() guaranteed in three.js), and audits pitch, edges, jumps.
# Blender is Z-up. "facing" is the direction from the stage toward the audience (the side the cards face), default -Y.
import math
from mathutils import Vector, Quaternion
from bpy_extras.object_utils import world_to_camera_view

# = RULES in src/core/direct.ts (keep in step)
PITCH_WARN, PITCH_DRAMA, PITCH_ERR = 12.0, 18.0, 20.0
EDGE_FOV, JUMP_DEG, MIN_DIST = 38.0, 3.0, 0.6
YAW_MAX = 40.0
HEAD, CROWN = 1.44, 1.68          # head centre and crown above the feet (people.SIZE, adult)
SAFE = 0.03                       # keep subjects this far inside the frame edges (share of the frame)
FIT_MAX = 1.6                     # never dolly a shot back more than this factor of its subject distance


# ---------------------------------------------------------------- builder half
def dir_of(yaw, pitch, facing=(0.0, -1.0, 0.0)):
    """direction subject -> camera: `yaw` degrees around the audience axis (positive = to the audience's right),
    `pitch` degrees above the subject (three.js dirOf)"""
    f = Vector((facing[0], facing[1], 0.0)).normalized()
    r = Quaternion((0.0, 0.0, 1.0), math.radians(yaw)) @ f
    p = math.radians(pitch)
    return Vector((r.x * math.cos(p), r.y * math.cos(p), math.sin(p))).normalized()


def frame(centre, w, h, dirv, aspect, fov=32.0, margin=1.12):
    """camera position that fits a subject box (centre, width, height in metres) in BOTH frame width and height at
    this aspect ratio, seen from direction `dirv`; vertical field of view `fov` degrees (three.js frame)"""
    t = math.tan(math.radians(fov) / 2)
    d = max(h / 2 / t, w / 2 / (t * aspect)) * margin
    c = Vector(centre)
    return c + Vector(dirv).normalized() * d, c


def char_cam(centre, w, h, aspect, yaw=0.0, pitch=4.0, fov=30.0, margin=1.08, facing=(0.0, -1.0, 0.0), portrait=None, pyaw=None, ppitch=None):
    """a camera for shots with flat 2D characters: level, on the audience side (|yaw| <= 40), elevation within
    +-PITCH_DRAMA. `portrait` = (centre, w, h) re-frames vertical video (three.js charCam). Returns (pos, look, fov)."""
    tall = aspect < 1
    yaw = max(-YAW_MAX, min(YAW_MAX, pyaw if (tall and pyaw is not None) else yaw))
    pitch = max(-PITCH_DRAMA, min(PITCH_DRAMA, ppitch if (tall and ppitch is not None) else pitch))
    if tall and portrait:
        centre, w, h = portrait
    pos, look = frame(centre, w, h, dir_of(yaw, pitch, facing), aspect, fov, margin)
    return pos, look, fov


def hero_cam(centre, w, h, aspect, **o):
    """the channel's default for character shots (FEEDBACK_LOG #14): wide lens from close, strong 3/4 angle"""
    return char_cam(centre, w, h, aspect, **{"fov": 54.0, "margin": 1.04, "yaw": -32.0, "pitch": 2.0, **o})


def low_cam(centre, w, h, aspect, **o):
    """low hero angle (power, threat, triumph); mark the CAM drama=True"""
    return hero_cam(centre, w, h, aspect, **{"pitch": -9.0, "ppitch": -9.0, **o})


def high_cam(centre, w, h, aspect, **o):
    """high reveal (how many, how small); mark the CAM drama=True"""
    return hero_cam(centre, w, h, aspect, **{"pitch": 14.0, "ppitch": 14.0, **o})


def pov_cam(eye, target, fov=50.0):
    """point of view from a character's eyes toward `target` (hide that character's card in the shot)"""
    return Vector(eye), Vector(target), fov


def aim(pos, look):
    """rotation that looks from pos to look with a level horizon (no roll)"""
    return (Vector(look) - Vector(pos)).to_track_quat("-Z", "Y")


def make_cam(bpy, col, name, pos, look, fov, chars=True, drama=False, push=None, side=None, fstop=5.6, sensor=24.0, subject=None):
    """create or update CAM-<name>: vertical fov, aimed at `look`, focus on `look`, the 2D policy in custom props.
    `subject` = (centre, w, h) is stored so a later re-frame (other aspect) can rebuild the camera."""
    full = name if name.startswith("CAM-") else f"CAM-{name}"
    ob = bpy.data.objects.get(full)
    if ob is None:
        ob = bpy.data.objects.new(full, bpy.data.cameras.new(full))
        col.objects.link(ob)
    cd = ob.data
    cd.sensor_fit, cd.sensor_height = "VERTICAL", sensor
    cd.lens = sensor / 2 / math.tan(math.radians(fov) / 2)
    ob.location = Vector(pos)
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = aim(pos, look)
    cd.dof.use_dof = True
    cd.dof.focus_distance = (Vector(look) - Vector(pos)).length
    cd.dof.aperture_fstop = fstop
    ob["chars"], ob["drama"] = bool(chars), bool(drama)
    if push is not None:
        ob["push"] = float(push)
    if side is not None:
        ob["side"] = float(side)
    if subject:
        ob["subj_c"], ob["subj_w"], ob["subj_h"] = list(subject[0]), float(subject[1]), float(subject[2])
    return ob


# ---------------------------------------------------------------- runtime half (blender/shot.py)
def level(q):
    """the same view direction with the horizon level: flat 2D cards must never be seen with a rolled camera"""
    return (q @ Vector((0.0, 0.0, -1.0))).to_track_quat("-Z", "Y")


def _inside(p, m=SAFE):
    return p.z > 0 and m <= p.x <= 1 - m and m <= p.y <= 1 - m


def subjects_ok(sc, cam, subs, people_at):
    """True when every subject box and every visible character's face and the top of its drawing (hat, raised hands)
    sit inside the safe frame. subs: mesh objects; people_at: [(base, cid, head height, top height)] on screen now"""
    for ob in subs:
        for c in ob.bound_box:
            if not _inside(world_to_camera_view(sc, cam, ob.matrix_world @ Vector(c))):
                return False
    for base, _cid, head_h, top_h in people_at:
        face = world_to_camera_view(sc, cam, base + Vector((0.0, 0.0, head_h)))
        if face.z <= 0 or not (-0.15 <= face.x <= 1.15 and -0.15 <= face.y <= 1.15):
            continue        # a character far outside the frame is simply not in this shot
        crown = world_to_camera_view(sc, cam, base + Vector((0.0, 0.0, top_h)))
        if not _inside(face) or crown.y > 1 - SAFE:
            return False
    return True


def pitch_deg(cam_pos, base, head_h=HEAD):
    """elevation of the camera above a character's head, degrees (positive = looking down on the card)"""
    head = base + Vector((0.0, 0.0, head_h))
    return math.degrees(math.atan2(cam_pos.z - head.z, math.hypot(cam_pos.x - head.x, cam_pos.y - head.y)))


def vfov(cam):
    d = cam.data
    return math.degrees(2 * math.atan(d.sensor_height / 2 / d.lens))
