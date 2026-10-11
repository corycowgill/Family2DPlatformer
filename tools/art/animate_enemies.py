"""Hand-keyed enemy animation.

The extracted sheet pose of each enemy (see extract_enemies.py) is cut into rigid parts
by hand-picked boxes (sprite pixel coords); every frame re-poses the parts (offset and
rotsprite rotation about a pivot), adds procedural pieces where the sheet has none
(rotor blur, turnstile bars, rat / pigeon legs, rope), and the shared rig outline pass
(rig.Canvas.finish) redraws one clean silhouette outline plus contours between parts
that overlap. Anims a kind does not define here keep the legacy frames.

Frame sizes are unchanged (src/game/enemies/enemyArt.ts ENEMY_FRAME_SIZE); sprites stay
bottom-centre anchored. Per-atlas timing goes into `meta.anims` (see ENEMY_META).
"""
from __future__ import annotations

import math

import numpy as np

from rig import OUTLINE, Canvas, bottom_anchor, ik2, rot_sprite, strip_outline


# ---------------------------------------------------------------- generic part rig
class PartRig:
    """parts: [(name, dict(boxes=[(x0,y0,x1,y1) inclusive], pivot=(x,y), depth=int))] in
    priority order; pixels in no box belong to `default` (depth 0 unless given)."""

    def __init__(self, sp: np.ndarray, size: tuple[int, int], parts: list, default: str = 'body',
                 default_depth: int = 10, sep: set = frozenset(), dx: int = 0, strip: bool = True):
        self.fw, self.fh = size
        base = strip_outline(sp) if strip else sp.copy()
        h, w = base.shape[:2]
        self.w, self.h = w, h
        self.ox = int(round(self.fw / 2 - w / 2)) + dx
        self.oy = self.fh - h
        yy, xx = np.mgrid[0:h, 0:w]
        taken = np.zeros((h, w), bool)
        self.img: dict[str, np.ndarray] = {}
        self.pivot: dict[str, tuple[float, float]] = {}
        self.depth: dict[str, int] = {}
        self.label: dict[str, int] = {}
        for i, (name, spec) in enumerate(parts):
            m = np.zeros((h, w), bool)
            for (x0, y0, x1, y1) in spec.get('boxes', []):
                m |= (xx >= x0) & (xx <= x1) & (yy >= y0) & (yy <= y1)
            for (x0, y0, x1, y1) in spec.get('minus', []):
                m &= ~((xx >= x0) & (xx <= x1) & (yy >= y0) & (yy <= y1))
            if 'mask' in spec:
                m &= spec['mask'](base, xx, yy)
            m &= ~taken & (base[..., 3] > 0)
            taken |= m
            o = np.zeros_like(base)
            o[m] = base[m]
            self.img[name] = o
            self.pivot[name] = spec.get('pivot', (w / 2, h / 2))
            self.depth[name] = spec.get('depth', 20 + i)
            self.label[name] = i + 1
        o = np.zeros_like(base)
        m = ~taken & (base[..., 3] > 0)
        o[m] = base[m]
        self.img[default] = o
        self.pivot[default] = (w / 2, h - 1)
        self.depth[default] = default_depth
        self.label[default] = len(parts) + 1
        self.sep = {frozenset(p) for p in sep}
        self.next_label = len(parts) + 2

    def draw(self, pose: dict, extras: list = (), ground: bool = True, recolor=None,
             override: dict | None = None) -> np.ndarray:
        """pose: {part: (dx, dy[, rot_deg_ccw])}; '_all': (dx, dy) shifts everything.
        extras: [(depth, label_name, fn(cv, ox, oy, label))] procedural pieces.
        override: {part: rgba sprite} replaces a part's pixels for this frame."""
        cv = Canvas(self.fw, self.fh)
        ax, ay = pose.get('_all', (0, 0))
        ox, oy = self.ox + ax, self.oy + ay
        items = []
        for name in self.img:
            if pose.get(name) == 'hide':
                continue
            items.append((pose.get(name + '@', self.depth[name]), 'part', name))
        labels = dict(self.label)
        nl = self.next_label
        for d, lname, fn in extras:
            if lname not in labels:
                labels[lname] = nl
                nl += 1
            items.append((d, 'fn', (lname, fn)))
        items.sort(key=lambda t: t[0])
        depth_of_label = {}
        for d, kind, obj in items:
            if kind == 'part':
                name = obj
                lab = labels[name]
                depth_of_label[lab] = d
                sp = (override or {}).get(name, self.img[name])
                t = pose.get(name, (0, 0, 0))
                dx, dy = t[0], t[1]
                rot = t[2] if len(t) > 2 else 0
                px, py = self.pivot[name]
                if rot:
                    rs, npv = rot_sprite(sp, rot, (px, py))
                    cv.sprite(rs, ox + px + dx, oy + py + dy, lab, anchor=npv)
                else:
                    cv.sprite(sp, ox + dx, oy + dy, lab)
            else:
                lname, fn = obj
                lab = labels[lname]
                depth_of_label[lab] = d
                fn(cv, ox, oy, lab)
        # contour only between explicitly separated part pairs
        rank = {lab: r for r, lab in enumerate(sorted(depth_of_label, key=lambda l: depth_of_label[l]))}
        cv.depth = {lab: rank[lab] + 1 for lab in rank}
        name_of = {v: k for k, v in labels.items()}
        merge = set()
        labs = list(rank)
        for a in labs:
            for b in labs:
                if a < b and frozenset((name_of[a], name_of[b])) not in self.sep:
                    merge.add((a, b))
        img = cv.finish(merge=merge)
        if recolor:
            img = recolor(img)
        return bottom_anchor(img) if ground else img


def capsule_fn(pts, radii, colour):
    def fn(cv, ox, oy, lab):
        P = [(x + ox, y + oy) for x, y in pts]
        cv.capsules(P, radii, colour if callable(colour) else (lambda *a: colour), lab)
    return fn


def disc_fn(x, y, r, colour):
    def fn(cv, ox, oy, lab):
        cv.disc(x + ox, y + oy, r, colour if callable(colour) else (lambda *a: colour), lab)
    return fn


def poly_fn(pts, colour):
    def fn(cv, ox, oy, lab):
        cv.poly([(x + ox, y + oy) for x, y in pts], colour, lab)
    return fn


def shade3(main, light, shade):
    def col(t, nx, ny, rel):
        if (ny < -0.5 or nx > 0.6) and rel > 0.35:
            return light
        if (ny > 0.5 or nx < -0.6) and rel > 0.35:
            return shade
        return main
    return col


def flash(img, k=0.75):
    out = img.copy()
    m = out[..., 3] > 0
    out[m, :3] = (out[m, :3] * (1 - k) + 255 * k).astype(np.uint8)
    return out


def tint(img, c=(255, 60, 60), k=0.45):
    out = img.copy()
    m = out[..., 3] > 0
    out[m, :3] = (out[m, :3] * (1 - k) + np.array(c) * k).astype(np.uint8)
    return out


def shift(img, dx, dy):
    out = np.zeros_like(img)
    h, w = img.shape[:2]
    ys0, ys1 = max(0, dy), min(h, h + dy)
    xs0, xs1 = max(0, dx), min(w, w + dx)
    if ys1 > ys0 and xs1 > xs0:
        out[ys0:ys1, xs0:xs1] = img[ys0 - dy:ys1 - dy, xs0 - dx:xs1 - dx]
    return out


def recolor_box(img_part, box, fn):
    """Apply fn(rgb)->rgb|None to the opaque pixels of a part inside box (part coords)."""
    out = img_part.copy()
    x0, y0, x1, y1 = box
    for y in range(max(0, y0), min(out.shape[0], y1 + 1)):
        for x in range(max(0, x0), min(out.shape[1], x1 + 1)):
            if out[y, x, 3]:
                r = fn(tuple(int(v) for v in out[y, x, :3]))
                if r is not None:
                    out[y, x, :3] = r
    return out


def lum(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def hit_pair(img):
    """Hit: white flash, then a red-tinted frame nudged 1px back."""
    return [flash(img), shift(tint(img), -1, 0)]


# ---------------------------------------------------------------- coneGuy
def cone_guy(small, size, legacy):
    sp = small['idle'][0]
    rig = PartRig(sp, size, [
        ('foot_b', dict(boxes=[(3, 25, 11, 27)], depth=5)),
        ('foot_f', dict(boxes=[(13, 25, 22, 27)], depth=6)),
    ], default='cone', default_depth=10, sep={('cone', 'foot_f'), ('cone', 'foot_b')})
    pv = (12, 25)
    rig.pivot['cone'] = pv
    # closed eyes: the "C C" eye box takes the cone's orange, with a dark lid line
    cone = rig.img['cone']
    orange = tuple(int(v) for v in cone[16, 9, :3])
    shut = cone.copy()
    for y in range(15, 19):
        for x in range(12, 19):
            if shut[y, x, 3]:
                shut[y, x, :3] = OUTLINE if (y == 17 and x in (13, 14, 16, 17)) else orange

    def P(cr=0, cdy=0, fb=(0, 0), ff=(0, 0), cdx=0):
        return {'cone': (cdx, cdy, cr), 'foot_b': fb, 'foot_f': ff}
    out = {}
    out['idle'] = [rig.draw(P()), rig.draw(P(cdy=1)), rig.draw(P()), rig.draw(P(), override={'cone': shut})]
    # waddle: rock onto one foot, the other steps forward
    out['move'] = [
        rig.draw(P(cr=6, cdy=0, fb=(1, -2), ff=(0, 0))),
        rig.draw(P(cr=3, cdy=1, fb=(2, -1), ff=(0, 0))),
        rig.draw(P(cr=0, cdy=0, fb=(2, 0), ff=(0, 0))),
        rig.draw(P(cr=-6, cdy=0, fb=(2, 0), ff=(1, -2))),
        rig.draw(P(cr=-3, cdy=1, fb=(2, 0), ff=(2, -1))),
        rig.draw(P(cr=0, cdy=0, fb=(0, 0), ff=(0, 0))),
    ]
    out['attack'] = [rig.draw(P(cdy=2, cr=4, cdx=-1)), rig.draw(P(cr=-10, cdx=1, ff=(2, -1))),
                     rig.draw(P(cr=-14, cdx=1, ff=(2, -2), fb=(1, 0)))]
    out['hit'] = hit_pair(rig.draw(P(cr=8, cdx=-1)))
    # hidden in the cone (stomped shell): feet tucked, eyes shut, wobble
    out['shell'] = [rig.draw({'cone': (0, 1, 0), 'foot_b': 'hide', 'foot_f': 'hide'}, override={'cone': shut}),
                    rig.draw({'cone': (0, 1, 8), 'foot_b': 'hide', 'foot_f': 'hide'}, override={'cone': shut}),
                    rig.draw({'cone': (0, 1, 0), 'foot_b': 'hide', 'foot_f': 'hide'}, override={'cone': shut}),
                    rig.draw({'cone': (0, 1, -8), 'foot_b': 'hide', 'foot_f': 'hide'}, override={'cone': shut})]
    return out


# ---------------------------------------------------------------- raccoon
def raccoon(small, size, legacy):
    """Waddle on four stubby legs, head bobbing, ringed tail swishing, lid shield bobbing.
    Raccoon.ts crops the frame at 68% width when the lid is knocked off, so the lid only
    ever moves right / vertically and the raccoon never crosses that line."""
    sp = small['idle'][0]
    rig = PartRig(sp, size, [
        ('speck', dict(boxes=[(5, 3, 10, 9)])),
        ('shield', dict(boxes=[(27, 0, 37, 22)], pivot=(29, 14), depth=30)),
        ('head', dict(boxes=[(14, 3, 26, 14)], minus=[(14, 11, 16, 14)], pivot=(20, 14), depth=15)),
        ('tail', dict(boxes=[(0, 16, 11, 23)], pivot=(10, 19), depth=5)),
        ('leg_f', dict(boxes=[(22, 20, 27, 24)], pivot=(24, 20), depth=12)),
        ('leg_h', dict(boxes=[(12, 21, 18, 24)], pivot=(15, 21), depth=12)),
    ], default='body', default_depth=10,
        sep={('shield', 'head'), ('shield', 'body'), ('shield', 'leg_f'), ('tail', 'body'), ('head', 'body')})

    def P(b=(0, 0), h=(0, 0), s=(0, 0, 0), t=0, lf=(0, 0), lh=(0, 0)):
        return {'speck': 'hide', 'body': b, 'head': h, 'shield': s, 'tail': (b[0], b[1], t),
                'leg_f': lf, 'leg_h': lh}
    out = {}
    out['idle'] = [rig.draw(P(t=6)), rig.draw(P(b=(0, 1), h=(0, 1), s=(0, 1, 0), t=0)),
                   rig.draw(P(t=-6)), rig.draw(P(b=(0, 1), h=(0, 1), s=(0, 1, 0), t=0))]
    # 6-frame waddle: diagonal legs step (front lifts while hind plants), body rocks
    out['move'] = [
        rig.draw(P(b=(0, 0), h=(0, -1), s=(0, -1, 2), t=10, lf=(1, -2), lh=(-1, 0))),
        rig.draw(P(b=(0, 1), h=(0, 0), s=(0, 0, 0), t=5, lf=(2, -1), lh=(-2, 0))),
        rig.draw(P(b=(0, 1), h=(0, 1), s=(0, 1, -2), t=-2, lf=(1, 0), lh=(-1, 0))),
        rig.draw(P(b=(0, 0), h=(0, -1), s=(0, -1, 2), t=-10, lf=(-1, 0), lh=(1, -2))),
        rig.draw(P(b=(0, 1), h=(0, 0), s=(0, 0, 0), t=-5, lf=(-2, 0), lh=(2, -1))),
        rig.draw(P(b=(0, 1), h=(0, 1), s=(0, 1, -2), t=2, lf=(-1, 0), lh=(1, 0))),
    ]
    # telegraphed charge: crouch behind the lid, then shove it forward
    out['attack'] = [
        rig.draw(P(b=(-1, 1), h=(-1, 2), s=(0, 1, 0), t=-8, lf=(-1, 0), lh=(-1, 0))),
        rig.draw(P(b=(0, 0), h=(0, 0), s=(2, -1, -4), t=14, lf=(1, -1), lh=(-2, 0))),
        rig.draw(P(b=(0, 0), h=(0, 0), s=(3, 0, -2), t=10, lf=(2, 0), lh=(-2, 0))),
    ]
    out['hit'] = hit_pair(rig.draw(P(b=(-1, 0), h=(-2, -1), s=(0, 0, 6), t=-14)))
    return out


# ---------------------------------------------------------------- turnstileBot
STEEL = ((205, 210, 222), (238, 242, 248), (140, 146, 162))


def turnstile_bars(theta: float, hub=(15.0, 18.0), R=9.0, tilt=3.4, front=True):
    """Three turnstile bars rotating about a vertical axis (seen from the side): bar k at
    angle theta + 120k projects to x = R cos, y = tilt sin; bars with sin > 0 face the
    camera and are drawn in front of the body."""
    def fn(cv, ox, oy, lab):
        hx, hy = hub[0] + ox, hub[1] + oy
        bars = []
        for k in range(3):
            a = math.radians(theta + 120 * k)
            bars.append((math.sin(a), math.cos(a)))
        for s, c in sorted(bars):
            if (s > 0) != front:
                continue
            ex, ey = hx + R * c, hy + tilt * s
            cv.capsules([(hx, hy), (ex, ey)], 0.95, shade3(*STEEL), lab)
            cv.disc(ex, ey, 1.45, shade3((236, 92, 60), (255, 150, 110), (170, 50, 40)), lab)
        if front:
            cv.disc(hx, hy, 1.6, shade3(*STEEL), lab)
    return fn


def turnstile_bot(small, size, legacy):
    sp = small['idle'][0]
    rig = PartRig(sp, size, [
        ('beacon', dict(boxes=[(19, 0, 28, 8)], depth=40)),
        ('head', dict(boxes=[(9, 2, 18, 12)], pivot=(14, 12), depth=20)),
        ('leg_b', dict(boxes=[(0, 20, 10, 28), (5, 13, 10, 19)], pivot=(8, 14), depth=8)),
        ('leg_f', dict(boxes=[(18, 19, 28, 29), (22, 15, 25, 18)], pivot=(21, 17), depth=9)),
    ], default='body', default_depth=15,
        sep={('head', 'body'), ('leg_b', 'body'), ('leg_f', 'body'), ('bars_f', 'body'), ('bars_f', 'head'),
             ('bars_b', 'body'), ('bars_f', 'leg_f'), ('bars_f', 'leg_b'), ('bars_b', 'leg_b')})
    head = rig.img['head']
    # eye light off (blink): the orange eye goes dark grey
    eye_off = recolor_box(head, (11, 4, 13, 8), lambda c: (70, 64, 70) if c[0] > 150 and c[2] < 120 else None)

    def P(body=(0, 0), head=(0, 0, 0), lb=(0, 0, 0), lf=(0, 0, 0), beacon=(0, 0), theta=90.0, hub_dy=0):
        bx, by = body
        pose = {'body': body, 'head': (head[0] + bx, head[1] + by, head[2]), 'leg_b': lb, 'leg_f': lf,
                'beacon': (beacon[0] + bx, beacon[1] + by)}
        hub = (15.0 + bx, 18.0 + by + hub_dy)
        extras = [(14, 'bars_b', turnstile_bars(theta, hub, front=False)),
                  (30, 'bars_f', turnstile_bars(theta, hub, front=True))]
        return pose, extras
    out = {}

    def D(args, **kw):
        pose, extras = args
        return rig.draw(pose, extras, **kw)
    out['idle'] = [D(P()), D(P(body=(0, 1), beacon=(0, -1))), D(P(beacon=(0, -1))),
                   rig.draw(*P(body=(0, 1)), override={'head': eye_off})]
    # robot march: lift a leg, plant it with a stomp (body dips), bars sway with the gait
    out['move'] = [
        D(P(body=(0, 0), lb=(0, -2, -6), lf=(0, 0, 0), head=(0, 0, -2), theta=80, beacon=(0, 0))),
        D(P(body=(0, -1), lb=(1, -3, -8), lf=(0, 0, 0), head=(0, 0, -3), theta=84, beacon=(0, 1))),
        D(P(body=(0, 1), lb=(1, 0, 0), lf=(0, 0, 0), head=(0, 1, 0), theta=88, beacon=(0, 1))),
        D(P(body=(0, 0), lb=(0, 0, 0), lf=(0, -2, 6), head=(0, 0, 2), theta=92, beacon=(0, 0))),
        D(P(body=(0, -1), lb=(0, 0, 0), lf=(1, -3, 8), head=(0, 0, 3), theta=96, beacon=(0, -1))),
        D(P(body=(0, 1), lb=(0, 0, 0), lf=(1, 0, 0), head=(0, 1, 0), theta=92, beacon=(0, -1))),
    ]
    # turnstile spin: the bars sweep a full 120-degree period over 4 frames (seamless loop)
    out['attack'] = [D(P(body=(0, 1), theta=t, head=(0, 0, 0), beacon=(0, -1 - (i % 2))))
                     for i, t in enumerate((0, 30, 60, 90))]
    out['hit'] = hit_pair(D(P(body=(-1, 0), head=(-1, -1, 8), theta=70)))
    return out


# ---------------------------------------------------------------- rotors
def rotor_fn(cx, cy, L, phase, colour=((196, 202, 214), (236, 240, 248), (120, 126, 140))):
    """Edge-on spinning rotor: blade projected length L*|cos(phase)| plus a faint blur
    tip on the long frames; a dark hub dot."""
    def fn(cv, ox, oy, lab):
        x, y = cx + ox, cy + oy
        half = max(0.6, L * abs(math.cos(math.radians(phase))) / 2)
        cv.capsules([(x - half, y), (x + half, y)], 0.62, shade3(*colour), lab, cover=0.45)
        cv.disc(x, y + 0.6, 0.9, lambda *a: (70, 74, 88), lab)
    return fn


def lens_fn(x, y, on: float):
    """Glowing light: on=0 dark, 1 lit, 2 flare (bigger, white core)."""
    def fn(cv, ox, oy, lab):
        if on <= 0:
            cv.disc(x + ox, y + oy, 1.0, lambda *a: (110, 22, 30), lab)
            return
        r = 1.15 if on < 2 else 1.9
        cv.disc(x + ox, y + oy, r, lambda t, nx, ny, rel: (255, 236, 236) if rel < 0.45 else (238, 40, 48), lab)
    return fn


# ---------------------------------------------------------------- securityDrone
def security_drone(small, size, legacy):
    sp = small['idle'][0]
    rig = PartRig(sp, size, [], default='body', default_depth=10)

    def F(dy=0, phase=0, lens=1, belly=1, dx=0, rot=0):
        pose = {'body': (dx, dy, rot)}
        ex = [(20, 'rotor_l', rotor_fn(4.0 + dx, 8.6 + dy, 9, phase)),
              (20, 'rotor_r', rotor_fn(26.0 + dx, 8.6 + dy, 9, phase + 60)),
              (21, 'lens', lens_fn(18.2 + dx, 4.2 + dy, lens)),
              (21, 'belly', lens_fn(16.2 + dx, 15.2 + dy, belly))]
        return rig.draw(pose, ex, ground=False)
    out = {}
    # hover (the bob itself is done in code): rotors at 45-degree steps, belly light pulses
    out['idle'] = [F(0, 0, 1, 1), F(0, 45, 1, 0), F(0, 90, 1, 1), F(0, 135, 1, 0)]
    out['move'] = [F(0, 0, 1, 1, rot=-4), F(0, 45, 1, 0, rot=-5), F(0, 90, 1, 1, rot=-4), F(0, 135, 1, 0, rot=-3)]
    # shot: lens charges (blink), flares, recoil
    out['attack'] = [F(0, 0, 0, 1), F(-1, 60, 2, 1), F(-1, 120, 2, 1, dx=-1), F(0, 180, 1, 1)]
    out['hit'] = hit_pair(F(0, 30, 0, 0, rot=10))
    return {k: [bottom_anchor(f) for f in v] for k, v in out.items()}


# ---------------------------------------------------------------- windowWasher
def window_washer(small, size, legacy):
    """Hanging on the rope: squeegee arm wipes back and forth, the bucket sways on its
    handle, boots dangle. Code bobs him on the rope and shakes him (setAngle) before he
    drops the bucket, so the frames stay level and keep the boots on the bottom row."""
    sp = small['idle'][0]
    rig = PartRig(sp, size, [
        ('arm_r', dict(boxes=[(27, 13, 35, 20), (26, 16, 28, 20)], pivot=(27, 17), depth=30)),
        ('bucket', dict(boxes=[(0, 21, 10, 31)], pivot=(6, 21), depth=25)),
        ('arm_l', dict(boxes=[(3, 0, 11, 20)], pivot=(7, 15), depth=24)),
        ('head', dict(boxes=[(13, 3, 29, 15)], pivot=(21, 15), depth=20)),
        ('leg_b', dict(boxes=[(10, 28, 17, 37)], pivot=(14, 28), depth=5)),
        ('leg_f', dict(boxes=[(18, 28, 26, 36)], pivot=(21, 28), depth=6)),
    ], default='body', default_depth=10,
        sep={('arm_r', 'body'), ('arm_r', 'head'), ('bucket', 'body'), ('bucket', 'arm_l'), ('leg_b', 'leg_f'),
             ('arm_l', 'body')})

    def P(arm=0, bucket=0, lb=0, lf=0, head=(0, 0), arm_d=(0, 0), body=(0, 0)):
        bx, by = body
        return {'arm_r': (arm_d[0] + bx, arm_d[1] + by, arm), 'bucket': (bx, by, bucket), 'head': (head[0] + bx, head[1] + by),
                'leg_b': (lb, 0), 'leg_f': (lf, 0), 'body': body, 'arm_l': body}
    wipe = [0, 10, 18, 10, 0, -8]
    sway = [4, 6, 4, 0, -3, 0]
    legs = [(0, 0), (1, 0), (1, 1), (0, 1), (-1, 0), (-1, -1)]
    out = {}
    out['idle'] = [rig.draw(P(arm=wipe[i], bucket=sway[i], lb=legs[i][0], lf=legs[i][1],
                              head=(0, 1 if i in (2, 3) else 0))) for i in range(6)]
    out['move'] = out['idle'][::2] + out['idle'][1::2][::-1]
    # telegraph + drop: arm flails up, bucket swings out, boots kick
    out['attack'] = [rig.draw(P(arm=25, bucket=-12, lb=-1, lf=1, head=(0, -1))),
                     rig.draw(P(arm=-15, bucket=14, lb=1, lf=-1, head=(0, 0))),
                     rig.draw(P(arm=30, bucket=-18, lb=-1, lf=1, head=(0, -1))),
                     rig.draw(P(arm=-10, bucket=10, lb=0, lf=0))]
    out['hit'] = hit_pair(rig.draw(P(arm=35, bucket=-10, lb=-1, lf=1, head=(-1, 0))))
    return out


# ---------------------------------------------------------------- pigeon
LEG_PINK = ((214, 80, 92), (240, 130, 140), (150, 44, 60))


def bird_leg(hip, foot, lift=0.0, toe=2.2):
    """Thin bird leg (hip -> foot on the ground) with a forward toe."""
    def fn(cv, ox, oy, lab):
        hx, hy = hip[0] + ox, hip[1] + oy
        fx, fy = foot[0] + ox, foot[1] + oy - lift
        cv.capsules([(hx, hy), (fx, fy)], 0.5, shade3(*LEG_PINK), lab, cover=0.45)
        cv.capsules([(fx - 0.8, fy), (fx + toe, fy)], 0.5, shade3(*LEG_PINK), lab, cover=0.45)
    return fn


def pigeon(small, size, legacy):
    sp = small['idle'][0]
    rig = PartRig(sp, size, [
        ('speck', dict(boxes=[(6, 0, 11, 3)])),
        ('legs', dict(boxes=[(5, 16, 15, 19)])),
        ('head', dict(boxes=[(12, 0, 19, 6)], pivot=(14, 7), depth=30)),
        ('tail', dict(boxes=[(0, 11, 6, 15)], pivot=(6, 13), depth=5)),
    ], default='body', default_depth=10, sep={('head', 'body')})
    head = rig.img['head']
    blink = recolor_box(head, (16, 2, 17, 3), lambda c: (120, 128, 150) if lum(c) < 90 or c[0] > 150 else None)
    # the walking pigeon keeps its body 1px higher so the legs show
    ground = 18.6

    def F(head=(0, 0), body=(0, 0), tail=0, near=(0.0, 0.0), far=(0.0, 0.0), blink_=False):
        bx, by = body
        pose = {'speck': 'hide', 'legs': 'hide', 'body': (bx, by - 1), 'head': (head[0] + bx, head[1] + by - 1),
                'tail': (bx, by - 1, tail)}
        ex = [(4, 'leg_far', bird_leg((11.2 + bx, 15.0 + by - 1), (12.0 + far[0], ground), far[1])),
              (12, 'leg_near', bird_leg((9.2 + bx, 15.0 + by - 1), (9.5 + near[0], ground), near[1]))]
        return rig.draw(pose, ex, override={'head': blink} if blink_ else None)
    out = {}
    out['idle'] = [F(), F(head=(0, 1), body=(0, 0), tail=4), F(head=(1, 0)), F(blink_=True)]
    # head-bob walk: thrust forward with each step, then hold still in the world
    # (moves back against the body) while the body catches up
    hb = [0, 2, 1, 0, 2, 1]
    near = [(1, 0), (0, 0), (-1, 0), (-1, 1.5), (1, 1.5), (2, 0)]
    far = [near[(i + 3) % 6] for i in range(6)]
    bob = [0, 0, 1, 0, 0, 1]
    out['move'] = [F(head=(hb[i], 0), body=(0, bob[i]), tail=(-4 if bob[i] else 3), near=near[i], far=far[i])
                   for i in range(6)]
    # flapping hop-flight: wings up / level / down / level (loops while airborne)
    fly = small['fly'][0]
    fr = PartRig(fly, size, [
        ('wing_b', dict(boxes=[(2, 0, 10, 7)], pivot=(9, 7), depth=5)),
        ('wing_f', dict(boxes=[(11, 0, 14, 5)], pivot=(13, 6), depth=30)),
    ], default='body', default_depth=10, sep={('wing_f', 'body'), ('wing_b', 'body')})

    def W(a, dy=0):
        return fr.draw({'wing_b': (0, dy, a), 'wing_f': (0, dy, a * 0.8), 'body': (0, dy)}, ground=True)
    out['attack'] = [W(0), W(55), W(105), W(55)]
    out['hit'] = hit_pair(F(head=(-1, -1), tail=8))
    return out


# ---------------------------------------------------------------- rat
RAT_PINK = ((214, 140, 146), (240, 186, 190), (160, 96, 106))
RAT_FUR = ((92, 92, 104), (126, 126, 140), (62, 62, 74))
RAT_TAIL = ((176, 124, 132), (204, 160, 166), (128, 86, 96))


def rat_tail(base, phase, length=9.0, amp=1.3):
    """Thin tail trailing left from `base` with a travelling wave."""
    def fn(cv, ox, oy, lab):
        pts = []
        for i in range(7):
            t = i / 6
            x = base[0] - t * length
            y = base[1] + 0.6 * t + amp * t * math.sin(phase + t * 3.2)
            pts.append((x + ox, y + oy))
        cv.capsules(pts, [0.5, 0.48, 0.46, 0.44, 0.42, 0.4], shade3(*RAT_TAIL), lab, cover=0.4)
    return fn


def rat_leg(hip, foot_dx, lift, ground=14.6, length=3.0):
    def fn(cv, ox, oy, lab):
        hx, hy = hip[0] + ox, hip[1] + oy
        fx, fy = hip[0] + foot_dx + ox, ground - lift + oy
        cv.capsules([(hx, hy), (fx, fy)], 0.6, shade3(*RAT_FUR), lab, cover=0.45)
        cv.capsules([(fx - 0.3, fy + 0.2), (fx + 1.2, fy + 0.2)], 0.55, shade3(*RAT_PINK), lab, cover=0.45)
    return fn


def rat(small, size, legacy):
    sp = small['idle'][1]
    rig = PartRig(sp, size, [
        ('legs', dict(boxes=[(5, 11, 16, 15), (17, 8, 21, 11)])),
        ('tail', dict(boxes=[(0, 11, 5, 15)])),
        ('head', dict(boxes=[(16, 0, 25, 7)], pivot=(17, 6), depth=30)),
    ], default='body', default_depth=10, sep={('leg_nf', 'body'), ('leg_nh', 'body')})

    def F(body=(0, 0), head=(0, 0, 0), tail=0.0, nf=(0, 0), ff=(0, 0), nh=(0, 0), fh=(0, 0), stretch=0):
        bx, by = body
        pose = {'legs': 'hide', 'tail': 'hide', 'body': body, 'head': (head[0] + bx + stretch, head[1] + by, head[2])}
        ex = [(4, 'leg_fh', rat_leg((9.5 + bx, 12.0 + by), fh[0] - 0.5, fh[1])),
              (4, 'leg_ff', rat_leg((17.0 + bx + stretch, 10.5 + by), ff[0] - 0.5, ff[1])),
              (5, 'tailp', rat_tail((7.0 + bx, 11.5 + by), tail)),
              (12, 'leg_nh', rat_leg((8.5 + bx, 12.2 + by), nh[0], nh[1])),
              (12, 'leg_nf', rat_leg((16.0 + bx + stretch, 10.8 + by), nf[0], nf[1]))]
        return rig.draw(pose, ex)
    out = {}
    out['idle'] = [F(tail=0.0), F(body=(0, 1), head=(0, 1, 0), tail=1.2), F(head=(1, 0, 0), tail=2.4),
                   F(body=(0, 1), head=(1, 1, -6), tail=3.6)]
    # gallop-scurry: gather (legs bunched, back up) / extend (reach), the tail ripples
    out['move'] = [
        F(body=(0, -1), head=(0, 0, 0), tail=0.0, nf=(-2, 0), ff=(-1, 0), nh=(2, 0), fh=(3, 0)),
        F(body=(0, 0), head=(1, 1, -4), tail=1.0, nf=(1, 1), ff=(2, 1), nh=(-1, 0), fh=(0, 0), stretch=1),
        F(body=(0, 0), head=(1, 0, 0), tail=2.0, nf=(3, 0), ff=(3, 0), nh=(-3, 1), fh=(-2, 1), stretch=1),
        F(body=(0, -1), head=(0, -1, 4), tail=3.0, nf=(0, 0), ff=(1, 0), nh=(0, 1.5), fh=(1, 1.5)),
    ]
    # crouch, then lunge (stretched, all feet off the ground but the hind toes)
    out['attack'] = [
        F(body=(-1, 1), head=(0, 1, -6), tail=0.5, nf=(-1, 0), ff=(0, 0), nh=(1, 0), fh=(2, 0)),
        F(body=(0, -2), head=(1, -1, 6), tail=2.0, nf=(3, 2), ff=(4, 2), nh=(-4, 0), fh=(-3, 0), stretch=1),
        F(body=(1, -2), head=(1, 0, 3), tail=3.0, nf=(3, 1), ff=(4, 1), nh=(-4, 0), fh=(-3, 0), stretch=1),
    ]
    out['hit'] = hit_pair(F(body=(-1, 0), head=(-1, -1, 10), tail=1.5))
    return out


# ---------------------------------------------------------------- gnat (robo-fly)
def gnat(small, size, legacy):
    sp = small['idle'][0]
    rig = PartRig(sp, size, [
        ('wing', dict(boxes=[(0, 0, 11, 7)], minus=[(5, 7, 11, 7)], pivot=(9, 7), depth=30)),
        ('wing2', dict(boxes=[(10, 0, 14, 5)], pivot=(12, 6), depth=5)),
        ('legs', dict(boxes=[(3, 11, 16, 15)], pivot=(10, 11), depth=8)),
    ], default='body', default_depth=10, sep={('wing', 'body')})

    def F(w=0, legs=(0, 0), body=(0, 0)):
        return rig.draw({'wing': (body[0], body[1], w), 'wing2': (body[0], body[1], w * 0.7), 'body': body, 'legs': legs})
    out = {}
    # wing buzz: up / back / down-back / back (fast loop), legs dangle
    out['idle'] = [F(0), F(35, (0, 0)), F(60, (1, 0)), F(35, (1, 0))]
    out['move'] = [F(-10, (-1, 0)), F(30, (-1, 0)), F(60, (0, 0)), F(30, (0, 0))]
    out['attack'] = [F(0, (-1, 0), (-1, 0)), F(45, (-2, 0), (1, 0)), F(70, (-2, 0), (1, 0))]
    out['hit'] = hit_pair(F(80, (1, 0), (-1, 0)))
    return out


# ---------------------------------------------------------------- wasp (hover drone)
def thruster_fn(cx, top, w, length, phase):
    """Thruster flame: red outer cone, orange mid, white-hot core near the nozzle;
    `phase` flickers the width / core length (the tip stays put)."""
    def fn(cv, ox, oy, lab):
        x0, y0 = cx + ox, top + oy
        ww = w * (1.0 + 0.12 * math.sin(phase))
        core = 0.35 + 0.15 * math.cos(phase)
        pts = [(x0 - ww / 2, y0), (x0 + ww / 2, y0), (x0 + ww * 0.42, y0 + length * 0.35),
               (x0 + ww * 0.16, y0 + length * 0.8), (x0, y0 + length), (x0 - ww * 0.16, y0 + length * 0.8),
               (x0 - ww * 0.42, y0 + length * 0.35)]

        def col(x, y):
            t = (y - y0) / length
            d = abs(x - x0) / (ww / 2 * (1 - 0.7 * t) + 1e-3)
            if t < core and d < 0.45:
                return (255, 240, 220)
            if d < 0.7 and t < 0.75:
                return (255, 120, 70)
            return (226, 34, 46) if t < 0.85 else (160, 20, 34)
        cv.poly(pts, col, lab)
    return fn


def wasp(small, size, legacy):
    sp = small['idle'][0]
    rig = PartRig(sp, size, [
        ('flame', dict(boxes=[(6, 11, 16, 20)])),
    ], default='body', default_depth=10)

    def F(phase=0.0, eye=1, side=1, body=(0, 0), rot=0):
        bx, by = body
        ex = [(5, 'flame_p', thruster_fn(11.5 + bx, 10.6 + by, 8.0, 9.9, phase)),
              (20, 'eye', lens_fn(19.2 + bx, 7.4 + by, eye)),
              (20, 'side', lens_fn(3.0 + bx, 7.2 + by, side))]
        return rig.draw({'flame': 'hide', 'body': (bx, by, rot)}, ex)
    out = {}
    out['idle'] = [F(0, 1, 1), F(2.1, 1, 0), F(4.2, 1, 1), F(1.0, 1, 0)]
    out['move'] = [F(0, 1, 1, rot=-5), F(2.1, 1, 0, rot=-6), F(4.2, 1, 1, rot=-5), F(1.0, 1, 0, rot=-4)]
    out['attack'] = [F(0, 0, 1), F(2.0, 2, 1, body=(-1, 0)), F(4.0, 2, 1, body=(-1, 0))]
    out['hit'] = hit_pair(F(3.0, 0, 0, rot=12))
    return out


# ---------------------------------------------------------------- overseer
def overseer(small, size, legacy):
    """Tentacle sway: rows below the pod are shifted sideways by a wave travelling down
    each tentacle (left / right / centre stalk out of phase, amplitude growing toward the
    tips; the stalk tip swings as one piece). The red core pulses."""
    sp = small['idle'][0]
    base = sp  # thin dark tentacles ARE outline pixels: warp the outlined sprite as is
    h, w = base.shape[:2]
    y0, cx = 44, w / 2

    def frame(phase, amp=2.4, glow=1.0, flare=0.0):
        out = np.zeros_like(base)
        out[:y0] = base[:y0]
        for y in range(y0, h):
            s = (y - y0) / (h - 1 - y0)
            for x in range(w):
                rel = (x - cx) / (w / 2)
                side = 0.0 if rel < -0.2 else (1.6 if rel > 0.2 else 0.8)
                a = amp * (0.45 if abs(rel) < 0.2 else 1.0)
                se = min(s, 0.72) if abs(rel) < 0.2 else s  # the stalk tip swings rigidly
                dx = a * (se ** 1.15) * math.sin(phase + side - 3.2 * se)
                dx += flare * s * (1 if rel > 0.2 else -1 if rel < -0.2 else 0)
                sx = int(round(x - dx))
                if 0 <= sx < w and base[y, sx, 3]:
                    out[y, x] = base[y, sx]
        # red core pulse (pod only)
        if glow != 1.0:
            pod = out[:y0]
            m = (pod[..., 3] > 0) & (pod[..., 0] > 150) & (pod[..., 1] < 110)
            v = pod[m, :3].astype(np.float32)
            v = v * glow if glow < 1 else v + (255 - v) * (glow - 1) * np.array([0.25, 0.55, 0.55])
            pod[m, :3] = np.clip(v, 0, 255).astype(np.uint8)
        cv = Canvas(*size)
        cv.sprite(out, int(round(size[0] / 2 - w / 2)), size[1] - h - 1, 1)
        return bottom_anchor(cv.finish(outer=False, contour=False))
    out = {}
    P = [0, math.pi / 2, math.pi, 3 * math.pi / 2]
    out['idle'] = [frame(p, 1.8, g) for p, g in zip(P, (1.0, 1.12, 1.0, 0.85))]
    out['move'] = [frame(p, 3.0, g) for p, g in zip(P + [p + math.pi / 4 for p in P][:0], (1.0, 1.1, 1.0, 0.9))]
    out['attack'] = [frame(0, 2.0, 1.2), frame(math.pi / 2, 2.6, 1.5, 1.0), frame(math.pi, 3.2, 1.8, 2.0),
                     frame(3 * math.pi / 2, 2.4, 1.3, 1.0)]
    out['hit'] = hit_pair(frame(math.pi / 3, 3.5, 0.7))
    return out


# ---------------------------------------------------------------- eliminator (boss "The El")
def eliminator(small, size, legacy):
    """Heavy stomp walk: the far (front) leg lifts and slams down while the body dips on
    impact and the arms swing against it; the near leg rocks on its toe so the sprite
    never leaves the bottom row. Attack: cannon arm winds up (raised, pulled back) and
    punches out. Drawn facing right; extract_enemies mirrors it to face left and
    un-mirrors the CTA plate (the body part is only ever translated, so the plate stays
    detectable)."""
    sp = small['idle'][0]
    rig = PartRig(sp, size, [
        ('arm_b', dict(boxes=[(0, 12, 24, 54), (0, 55, 12, 58)], pivot=(22, 18), depth=5)),
        ('arm_f', dict(boxes=[(86, 8, 117, 32), (91, 28, 117, 41)], pivot=(86, 21), depth=30)),
        ('leg_b', dict(boxes=[(13, 36, 50, 74)], pivot=(46, 38), depth=12)),
        ('leg_f', dict(boxes=[(60, 33, 90, 58), (91, 42, 102, 58)], pivot=(68, 36), depth=8)),
    ], default='body', default_depth=10,
        sep={('arm_b', 'body'), ('arm_f', 'body'), ('leg_b', 'body'), ('leg_f', 'body'), ('arm_b', 'leg_b')})

    def F(body=(0, 0), ab=0.0, af=0.0, af_d=(0, 0), lb=0.0, lf=(0, 0, 0.0)):
        bx, by = body
        return rig.draw({'body': (bx, by), 'arm_b': (bx, by, ab), 'arm_f': (bx + af_d[0], by + af_d[1], af),
                         'leg_b': (0, 0, lb), 'leg_f': lf}, ground=False)
    out = {}
    out['idle'] = [F(), F(body=(0, 1), ab=-2, af=-2), F(body=(0, 1), ab=-3, af=-3), F(body=(0, 0), ab=-1, af=-1)]
    # stomp cycle: lift far leg (body rises, arms counter-swing), slam (dip 3px), rock near leg
    out['move'] = [
        F(body=(0, 0), ab=0, af=0, lf=(0, 0, 0)),
        F(body=(0, -1), ab=4, af=-4, lf=(1, -4, 8)),
        F(body=(1, -2), ab=7, af=-6, lf=(3, -6, 12)),
        F(body=(1, 2), ab=-3, af=3, lf=(3, 0, 0)),
        F(body=(1, 3), ab=-5, af=5, lf=(2, 0, 0), lb=4),
        F(body=(0, 1), ab=-2, af=2, lf=(1, 0, 0), lb=2),
    ]
    # cannon-arm punch: wind up (raised + pulled back), strike, hold, recover
    out['attack'] = [
        F(body=(-1, 1), ab=-4, af=22, af_d=(-3, -2)),
        F(body=(-2, 1), ab=-6, af=30, af_d=(-5, -3)),
        F(body=(1, 0), ab=6, af=-8, af_d=(4, 1)),
        F(body=(1, 0), ab=4, af=-4, af_d=(4, 0)),
        F(body=(0, 0), ab=0, af=6, af_d=(1, 0)),
    ]
    hit = F(body=(0, 0), ab=-8, af=12, af_d=(-2, -1), lf=(0, -2, 6))
    out['hit'] = [flash(hit), tint(hit)]
    return out


# ---------------------------------------------------------------- alien walkers (multi-pose sheet)
def stomp_cycle(rig, back='leg_b', front='leg_f', arms=(), cape=None, lift=3, dip=1, rot=6, swing=5, step=1):
    """6-frame heavy walk on one consistent base pose: front foot lifts and steps, body
    dips on the stomp, then the back foot; arms (and a cape) counter-swing. Feet slide
    back `step` px while planted (ground travel)."""
    fr = []
    seq = [  # (body_dy, front (dx, dy, rot), back (dx, dy, rot), arm swing)
        (0, (0, 0, 0), (0, 0, 0), 0),
        (-1, (step, -lift, rot), (-step, 0, 0), 1),
        (dip, (step, 0, 0), (-step, 0, 0), 0.5),
        (0, (0, 0, 0), (0, 0, 0), 0),
        (-1, (-step, 0, 0), (step, -lift, rot), -1),
        (dip, (-step, 0, 0), (step, 0, 0), -0.5),
    ]
    for by, f, b, a in seq:
        pose = {'body': (0, by), front: f, back: b}
        for name, sign in arms:
            pose[name] = (0, by, sign * swing * a)
        if cape:
            pose[cape] = (0, by, -swing * 0.6 * a)
        fr.append(rig.draw(pose))
    return fr


def skirmisher(small, size, legacy):
    sp = small['idle'][0]
    rig = PartRig(sp, size, [
        ('arm', dict(boxes=[(27, 16, 38, 24)], pivot=(28, 17), depth=30)),
        ('leg_b', dict(boxes=[(0, 17, 17, 33)], pivot=(13, 17), depth=5)),
        ('leg_f', dict(boxes=[(18, 19, 29, 33)], pivot=(22, 19), depth=15)),
    ], default='body', default_depth=10, sep={('leg_b', 'body'), ('leg_f', 'body'), ('arm', 'body')})
    out = {}
    # stalking scissor-step: legs counter-swing about the hips, the forward-swinging
    # leg lifts, body bobs at the crossing, claw arm swings against the front leg
    mv = []
    for i in range(6):
        ph = math.radians(i * 60)
        tf, tb = 10 * math.cos(ph), -10 * math.cos(ph)
        lf = -2 if math.sin(ph) < -0.1 else 0
        lb = -2 if math.sin(ph) > 0.1 else 0
        by = -1 if abs(math.cos(ph)) < 0.6 else 0
        mv.append(rig.draw({'body': (0, by), 'leg_f': (0, lf, tf), 'leg_b': (0, lb, tb), 'arm': (0, by, -6 * math.cos(ph))}))
    out['move'] = mv
    out['idle'] = [rig.draw({'body': (0, 0)}), rig.draw({'body': (0, 1), 'arm': (0, 1, -4)}),
                   rig.draw({'body': (0, 1), 'arm': (0, 1, -6)}), rig.draw({'body': (0, 0), 'arm': (0, 0, -2)})]
    return out


def warlord(small, size, legacy):
    sp = small['walk'][0]
    rig = PartRig(sp, size, [
        ('leg_b', dict(boxes=[(10, 39, 25, 47)], pivot=(17, 39), depth=5)),
        ('leg_f', dict(boxes=[(29, 38, 43, 47)], pivot=(35, 38), depth=15)),
        ('claw', dict(boxes=[(41, 30, 52, 43)], pivot=(42, 31), depth=30)),
        ('cape', dict(boxes=[(0, 22, 10, 43)], pivot=(10, 22), depth=4)),
    ], default='body', default_depth=10, sep={('leg_b', 'body'), ('leg_f', 'body'), ('claw', 'body')})
    out = {'move': stomp_cycle(rig, arms=[('claw', 1)], cape='cape', lift=3, dip=1, rot=4, swing=5)}
    out['idle'] = [rig.draw({'body': (0, 0)}), rig.draw({'body': (0, 1), 'claw': (0, 1, -3), 'cape': (0, 1, 2)}),
                   rig.draw({'body': (0, 1), 'claw': (0, 1, -4), 'cape': (0, 1, 3)}),
                   rig.draw({'body': (0, 0), 'claw': (0, 0, -1), 'cape': (0, 0, 1)})]
    return out


def juggernaut(small, size, legacy):
    sp = small['walk'][0]
    rig = PartRig(sp, size, [
        ('arm_f', dict(boxes=[(54, 28, 71, 52)], pivot=(56, 30), depth=30)),
        ('leg_b', dict(boxes=[(0, 44, 22, 56)], pivot=(12, 44), depth=5)),
        ('leg_f', dict(boxes=[(34, 42, 53, 56)], pivot=(43, 42), depth=15)),
    ], default='body', default_depth=10, sep={('leg_b', 'body'), ('leg_f', 'body'), ('arm_f', 'body')})
    out = {'move': stomp_cycle(rig, arms=[('arm_f', 1)], lift=4, dip=2, rot=3, swing=4)}
    out['idle'] = [rig.draw({'body': (0, 0)}), rig.draw({'body': (0, 1), 'arm_f': (0, 1, -2)}),
                   rig.draw({'body': (0, 2), 'arm_f': (0, 2, -3)}), rig.draw({'body': (0, 1), 'arm_f': (0, 1, -1)})]
    return out


BUILDERS = {
    'coneGuy': cone_guy,
    'skirmisher': skirmisher,
    'warlord': warlord,
    'juggernaut': juggernaut,
    'eliminator': eliminator,
    'overseer': overseer,
    'gnat': gnat,
    'wasp': wasp,
    'rat': rat,
    'pigeon': pigeon,
    'windowWasher': window_washer,
    'securityDrone': security_drone,
    'raccoon': raccoon,
    'turnstileBot': turnstile_bot,
}

# runtime timing per atlas (meta.anims): fps / per-frame durations
ENEMY_META: dict[str, dict] = {
    'pigeon': dict(idle=dict(durations=[600, 300, 500, 120]), move=dict(fps=10), attack=dict(fps=14, loop=True)),
    'rat': dict(idle=dict(fps=6), move=dict(fps=14)),
    'raccoon': dict(idle=dict(fps=4), move=dict(fps=9), attack=dict(fps=10)),
    'coneGuy': dict(idle=dict(durations=[500, 400, 500, 120]), move=dict(fps=9), shell=dict(fps=12)),
    'turnstileBot': dict(idle=dict(durations=[500, 400, 400, 120]), move=dict(fps=8), attack=dict(fps=14, loop=True)),
    'securityDrone': dict(idle=dict(fps=16), move=dict(fps=16), attack=dict(fps=10)),
    'windowWasher': dict(idle=dict(fps=8), move=dict(fps=8), attack=dict(fps=12)),
    'gnat': dict(idle=dict(fps=22), move=dict(fps=22), attack=dict(fps=16)),
    'wasp': dict(idle=dict(fps=12), move=dict(fps=12), attack=dict(fps=10)),
    'skirmisher': dict(idle=dict(fps=5), move=dict(fps=10)),
    'warlord': dict(idle=dict(fps=5), move=dict(fps=8)),
    'juggernaut': dict(idle=dict(fps=4), move=dict(fps=6)),
    'overseer': dict(idle=dict(fps=5), move=dict(fps=7), attack=dict(fps=8)),
    'eliminator': dict(idle=dict(fps=4), move=dict(fps=7), attack=dict(fps=10)),
}


def build(kind: str, small: dict[str, list[np.ndarray]], size: tuple[int, int],
          legacy: dict[str, list[np.ndarray]]) -> dict[str, list[np.ndarray]]:
    fn = BUILDERS.get(kind)
    return fn(small, size, legacy) if fn else {}
