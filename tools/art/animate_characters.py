"""Hand-keyed rig animation for the playable characters.

`extract_characters.py` cuts each character's poses out of the reference sheet; this
module takes the clean idle pose (Lupin: the walk pose), splits it into rigid parts and
redraws the limbs as rig capsules (see rig.py), then poses every frame from the key
tables below.

Humans: head + torso/pelvis are the original pixels; arms (sleeve, forearm, fist), legs
(trousers / shorts + skin bands) and side-view shoes are drawn by the rig with colours
snapped to the character's own palette. Lupin: body, head (with ears) and tail are
pixels from the sheet's walk pose; four fluffy legs + paws are rig limbs; the tail wags
with a rotsprite rotation.

Coordinates: frame pixels (48x48), +y down. A planted sole's interior bottom edge is at
y = 47 so the silhouette outline sits on the bottom row 47. Foot x values are relative
to that leg's rest pivot (scaled by the character's leg length); arm angles are degrees
from straight down, + = forward (toward facing), 180 = straight up; the elbow angle is
relative to the upper arm.

Locomotion stride (ground travel per frame of a planted foot) is exported per atlas in
`meta.anims` so the runtime can sync walk/run playback to the actual speed (no foot
sliding / moonwalking) — see src/game/systems/AnimationSystem.ts.
"""
from __future__ import annotations

import math

import numpy as np

from rig import Canvas, bottom_anchor, fk2, ik2, rot90, rot_sprite, shear_rows, strip_outline

FRAME = 48
GROUND = 47.0

# part labels; depth = label value (higher = in front)
FAR_ARM, FAR_LEG, FAR_SHOE, NEAR_LEG, NEAR_SHOE, TORSO, HEAD, NEAR_ARM = 1, 2, 3, 4, 5, 6, 7, 8
KICK_LEG, KICK_SHOE = 9, 10
DEPTH = {k: k for k in range(1, 11)}
MERGE = {(FAR_LEG, TORSO), (NEAR_LEG, TORSO), (TORSO, HEAD), (FAR_ARM, TORSO)}

EYE = (34, 24, 34)
LASH = (96, 52, 46)

# ---------------------------------------------------------------- per-character rig data
# Coordinates in the idle_0 sprite (as extracted & trimmed by extract_characters.py).
#   neck: head = rows above (plus head_extra boxes); torso: inclusive (x0, y0, x1, y1) box
#   hip: (near_x, far_x, y) leg pivots;  leg: (thigh, shin, r_thigh, r_shin)
#   shoulder: ((near_x, y), (far_x, y));  arm: (upper, lower, radius, hand_r, sleeve_t)
#   shoe: shoe size factor;  eyes: [(x, y)] eye pixels closed on the blink frame
#   pal: (main, light, shade, dark) tables, snapped to the sprite's own palette;
#        leg = [(t_end, table), ...] bands from hip (t=0) to ankle (t=1)
HUMANS = {
    'dad': dict(
        neck=16, torso=(6, 14, 13, 27), head_extra=[],
        hip=(8.2, 11.2, 26.5), leg=(4.2, 4.1, 1.95, 1.8),
        shoulder=((4.4, 17.6), (14.6, 17.6)), arm=(4.4, 3.7, 1.55, 1.95, 0.4),
        shoe=1.0, eyes=[(7, 9, 1), (14, 9, 1)],
        pal=dict(
            skin=((239, 152, 100), (246, 190, 143), (204, 132, 94), (191, 96, 65)),
            sleeve=((31, 56, 97), (46, 86, 138), (30, 44, 72), (22, 30, 52)),
            leg=[(1.01, ((12, 89, 163), (40, 120, 190), (20, 66, 122), (8, 41, 80)))],
            shoe=((125, 49, 37), (155, 87, 59), (83, 47, 36), (60, 34, 28)), sole=(44, 28, 26),
        )),
    'mom': dict(
        neck=15, torso=(5, 14, 13, 25), head_extra=[(0, 15, 4, 18)],
        hip=(7.6, 10.6, 25.0), leg=(3.9, 3.9, 1.85, 1.7),
        shoulder=((4.4, 16.8), (13.8, 16.8)), arm=(4.1, 3.5, 1.5, 1.85, 0.36),
        shoe=0.95, eyes=[(7, 9, 2), (13, 9, 2)],
        pal=dict(
            skin=((250, 179, 138), (245, 200, 166), (230, 150, 111), (190, 110, 80)),
            sleeve=((234, 68, 216), (245, 120, 235), (191, 34, 165), (131, 24, 100)),
            leg=[(1.01, ((47, 46, 49), (72, 70, 76), (32, 31, 34), (22, 20, 25)))],
            shoe=((210, 68, 155), (245, 200, 210), (131, 24, 100), (90, 20, 70)), sole=(240, 228, 220),
        )),
    'brennan': dict(
        neck=15, torso=(4, 13, 12, 22), head_extra=[],
        hip=(6.6, 9.8, 22.0), leg=(3.3, 3.2, 2.1, 1.6),
        shoulder=((3.6, 16.4), (12.6, 16.4)), arm=(3.6, 3.2, 1.45, 1.75, 0.38),
        shoe=0.86, eyes=[(8, 8, 2), (12, 8, 2)],
        pal=dict(
            skin=((244, 194, 151), (247, 207, 167), (224, 155, 117), (195, 120, 90)),
            sleeve=((47, 49, 51), (75, 75, 80), (34, 32, 35), (22, 20, 25)),
            leg=[(0.5, ((47, 49, 51), (75, 75, 80), (34, 32, 35), (22, 20, 25))),
                 (1.01, ((244, 194, 151), (247, 207, 167), (224, 155, 117), (195, 120, 90)))],
            shoe=((206, 87, 88), (246, 221, 188), (162, 41, 48), (110, 30, 36)), sole=(246, 221, 188),
        )),
    'parker': dict(
        neck=14, torso=(3, 13, 10, 21), head_extra=[],
        hip=(5.2, 8.2, 21.0), leg=(2.9, 2.8, 2.0, 1.5),
        shoulder=((2.7, 15.4), (10.8, 15.4)), arm=(3.3, 3.0, 1.4, 1.7, 0.4),
        shoe=0.8, eyes=[(7, 8, 2), (11, 8, 2)],
        pal=dict(
            skin=((251, 196, 136), (253, 218, 165), (243, 177, 126), (192, 126, 73)),
            sleeve=((6, 103, 219), (50, 140, 218), (6, 68, 158), (25, 57, 89)),
            leg=[(0.5, ((25, 57, 89), (45, 85, 125), (7, 29, 57), (6, 19, 30))),
                 (0.86, ((251, 196, 136), (253, 218, 165), (243, 177, 126), (192, 126, 73))),
                 (1.01, ((240, 236, 222), (255, 255, 245), (213, 205, 173), (150, 140, 120)))],
            shoe=((50, 140, 218), (213, 205, 173), (6, 68, 158), (25, 57, 89)), sole=(240, 236, 222),
        )),
}


def _palette_of(sp: np.ndarray) -> np.ndarray:
    px = sp[sp[..., 3] > 0][:, :3]
    return np.unique(px, axis=0).astype(np.int32)


def _snap(c, pal: np.ndarray, max_d: float = 28.0):
    """Snap a hand-picked colour to the nearest colour already in the sprite (exact match
    with the torso pixels) if one is close; otherwise keep it."""
    d = np.sqrt(((pal - np.array(c)) ** 2).sum(1))
    i = int(np.argmin(d))
    return tuple(int(v) for v in pal[i]) if d[i] <= max_d else tuple(c)


def _snap_pal(p, pal):
    out = {}
    for k, v in p.items():
        if k == 'leg':
            out[k] = [(t, tuple(_snap(c, pal) for c in tbl)) for t, tbl in v]
        elif isinstance(v[0], tuple):
            out[k] = tuple(_snap(c, pal) for c in v)
        else:
            out[k] = _snap(v, pal)
    return out


def _tone(tbl, nx, far=False, rel=0.0):
    main, light, shade, dark = tbl
    if far:
        main, light, shade = shade, main, dark
    if nx > 0.5 and rel > 0.35:
        return light
    if nx < -0.45 and rel > 0.35:
        return shade
    return main


def _rot_pt(p, c, deg):
    """Rotate point p around c by deg clockwise on screen (y down)."""
    a = math.radians(deg)
    x, y = p[0] - c[0], p[1] - c[1]
    return (c[0] + x * math.cos(a) - y * math.sin(a), c[1] + x * math.sin(a) + y * math.cos(a))


class Human:
    def __init__(self, cid: str, idle: np.ndarray):
        self.cid = cid
        c = self.c = HUMANS[cid]
        h, w = idle.shape[:2]
        self.ox = int(round(FRAME / 2 - w / 2))
        self.oy = FRAME - h
        self.pal = _snap_pal(c['pal'], _palette_of(idle))
        base = strip_outline(idle)
        nk = c['neck']
        head = np.zeros_like(base)
        head[:nk] = base[:nk]
        for (x0, y0, x1, y1) in c['head_extra']:
            head[y0:y1 + 1, x0:x1 + 1] = base[y0:y1 + 1, x0:x1 + 1]
        x0, y0, x1, y1 = c['torso']
        torso = np.zeros_like(base)
        torso[y0:y1 + 1, x0:x1 + 1] = idle[y0:y1 + 1, x0:x1 + 1]
        torso = strip_outline(torso)
        # crisp eyes (the reduction leaves them as mushy mid-tones on most faces)
        for ex, ey, eh in c['eyes']:
            for y in range(ey, ey + eh):
                if head[y, ex, 3]:
                    head[y, ex, :3] = EYE
        self.head, self.torso = head, torso
        self.blink_head = self._blink(head)
        L1, L2 = c['leg'][:2]
        self.leg_len = L1 + L2
        self.k = self.leg_len / 8.3  # pose tables are keyed at Dad's leg length

    def _blink(self, head):
        """Closed eyes: 2px eyes keep only a lash line on their lower pixel, 1px eyes turn
        into the lid (skin shade)."""
        out = head.copy()
        for ex, ey, eh in self.c['eyes']:
            for y in range(ey, ey + eh):
                if out[y, ex, 3]:
                    out[y, ex, :3] = LASH if (eh > 1 and y == ey + eh - 1) else self.pal['skin'][2]
        return out

    # ------------------------------------------------------------ shoes / feet
    def shoe_poly(self, ax, ay, pitch, s):
        pts = [(-2.0, -1.5), (0.9, -1.5), (2.2, -0.6), (3.3, 0.1), (3.3, 1.5), (-2.0, 1.5)]
        a = math.radians(-pitch)
        ca, sa = math.cos(a), math.sin(a)
        return [(ax + (x * ca - y * sa) * s, ay + (x * sa + y * ca) * s) for x, y in pts]

    def foot_y(self, pitch, lift, s):
        poly = self.shoe_poly(0, 0, pitch, s)
        return GROUND - lift - max(y for _, y in poly)

    # ------------------------------------------------------------ one pose
    def draw(self, P: dict) -> np.ndarray:
        c, pal = self.c, self.pal
        cv = Canvas(FRAME, FRAME)
        cv.depth = dict(DEPTH)
        ox, oy, k = self.ox, self.oy, self.k
        hx, hy = P.get('hip', (0, 0))
        hx *= k
        lean = int(P.get('lean', 0))
        bend = P.get('bend', 0)
        hdx, hdy = P.get('head', (0, 0))
        tdx, tdy = ox + hx, oy + hy
        nhx, fhx, hpy = c['hip']
        s = c['shoe']
        pivot = (ox + hx + (nhx + fhx) / 2, oy + hy + hpy)
        # -- legs + shoes
        L1, L2, r1, r2 = c['leg']

        def leg(which, px, foot, lab_leg, lab_shoe):
            fx, pitch, lift = foot
            far = which == 'far'
            root = (px + tdx, hpy + tdy)
            ank = (px + ox + fx * k, self.foot_y(pitch, lift * k, s))
            knee, end = ik2(root, ank, L1, L2, bend=1)
            bands = pal['leg']

            def legcol(t, nx, ny, rel, far=far, bands=bands):
                for t_end, tbl in bands:
                    if t <= t_end:
                        return _tone(tbl, nx, far, rel)
                return _tone(bands[-1][1], nx, far, rel)
            cv.capsules([root, knee, end], [r1, r2], legcol, lab_leg)
            sh = pal['shoe']
            poly = self.shoe_poly(end[0], end[1], pitch, s)
            ang = math.radians(pitch)

            def shoecol(x, y, end=end, ang=ang, far=far, sh=sh):
                lx = (x - end[0]) * math.cos(ang) - (y - end[1]) * math.sin(ang)
                ly = (x - end[0]) * math.sin(ang) + (y - end[1]) * math.cos(ang)
                if ly > 0.6 * s:
                    return pal['sole']
                if ly < -0.5 * s and lx > -0.3:
                    return sh[0] if far else sh[1]
                return sh[2] if far else sh[0]
            cv.poly(poly, shoecol, lab_shoe)
        leg('far', fhx, P['ff'], FAR_LEG, FAR_SHOE)
        kick = P.get('kick', False)
        if not kick:
            leg('near', nhx, P['nf'], NEAR_LEG, NEAR_SHOE)
        # -- arms (shoulders follow lean/bend)
        (nsx, nsy), (fsx, fsy) = c['shoulder']
        A1, A2, ar, hr, sleeve = c['arm']
        ty0, ty1 = c['torso'][1], c['torso'][3]

        def shoulder(sx, sy):
            t = 1 - (sy - ty0) / max(1, ty1 - ty0)
            p = (sx + tdx + lean * t, sy + tdy)
            return _rot_pt(p, pivot, bend) if bend else p

        def arm(which, sx, sy, ang):
            far = which == 'far'
            a1, a2 = ang[:2]
            root = shoulder(sx, sy)
            mid, end = fk2(root, a1 + bend, a2, A1, A2)

            def armcol(t, nx, ny, rel, far=far):
                return _tone(pal['sleeve'] if t < sleeve else pal['skin'], nx, far, rel)
            lab = FAR_ARM if far else NEAR_ARM
            cv.capsules([root, mid, end], [ar + 0.2, ar], armcol, lab)
            cv.disc(end[0], end[1], hr, lambda t, nx, ny, rel, far=far: _tone(pal['skin'], nx - ny * 0.4, far, rel), lab)
        arm('far', fsx, fsy, P['fa'])
        # -- torso + head (one rigid upper body when bent)
        head = self.blink_head if P.get('blink') else self.head
        if bend:
            up = np.zeros((FRAME * 2, FRAME * 2, 4), np.uint8)
            off = FRAME // 2

            def paste(sp, x, y):
                h, w = sp.shape[:2]
                m = sp[..., 3] > 0
                sub = up[y:y + h, x:x + w]
                sub[m] = sp[m]
            torso, tox = shear_rows(self.torso, lean, y_from=ty0) if lean else (self.torso, 0)
            paste(torso, off - tox, off)
            paste(head, off + hdx + lean, off + hdy)
            pv = (off + (nhx + fhx) / 2, off + hpy)
            rup, npv = rot_sprite(up, -bend, pv)
            cv.sprite(rup, pivot[0], pivot[1], TORSO, anchor=npv)
        else:
            torso, tox = shear_rows(self.torso, lean, y_from=ty0) if lean else (self.torso, 0)
            cv.sprite(torso, tdx - tox, tdy, TORSO)
            cv.sprite(head, tdx + hdx + lean, tdy + hdy, HEAD)
        if kick:  # kicking leg swings in front of the body
            leg('near', nhx, P['nf'], KICK_LEG, KICK_SHOE)
        arm('near', nsx, nsy, P['na'])
        img = cv.finish(merge=MERGE)
        return _post(img, P)


def _post(img: np.ndarray, P: dict) -> np.ndarray:
    rot = P.get('rot', 0)
    if rot:
        a = img[..., 3] > 0
        ys, xs = np.nonzero(a)
        c = ((xs.min() + xs.max() + 1) / 2, (ys.min() + ys.max() + 1) / 2)
        if rot % 90 == 0:
            img, _ = rot90(img, (-rot // 90) % 4, (FRAME / 2, FRAME / 2))
        else:
            big, _ = rot_sprite(img, -rot, c)
            img = _fit(big)
        img = _center_x(img, P.get('cx', 0))
    if P.get('ground', True):
        img = bottom_anchor(img)
    if P.get('up'):
        img = bottom_anchor(img)
        img = _shift(img, 0, -int(P['up']))
    if P.get('dx'):
        img = _shift(img, int(P['dx']), 0)
    return img


def _fit(img):
    """Crop a (larger) canvas back to FRAME x FRAME around its content (bottom-centre)."""
    a = img[..., 3] > 0
    ys, xs = np.nonzero(a)
    out = np.zeros((FRAME, FRAME, 4), np.uint8)
    cx = (xs.min() + xs.max() + 1) // 2
    sx0, sy0 = cx - FRAME // 2, ys.max() + 1 - FRAME
    H, W = img.shape[:2]
    for y in range(FRAME):
        yy = sy0 + y
        if not 0 <= yy < H:
            continue
        for x in range(FRAME):
            xx = sx0 + x
            if 0 <= xx < W:
                out[y, x] = img[yy, xx]
    return out


def _center_x(img, dx=0):
    a = img[..., 3] > 0
    xs = np.nonzero(a.any(0))[0]
    cx = (xs.min() + xs.max() + 1) / 2
    return _shift(img, int(round(FRAME / 2 - cx)) + dx, 0)


def _shift(img, dx, dy):
    out = np.zeros_like(img)
    h, w = img.shape[:2]
    ys0, ys1 = max(0, dy), min(h, h + dy)
    xs0, xs1 = max(0, dx), min(w, w + dx)
    if ys1 > ys0 and xs1 > xs0:
        out[ys0:ys1, xs0:xs1] = img[ys0 - dy:ys1 - dy, xs0 - dx:xs1 - dx]
    return out


# ---------------------------------------------------------------- key poses
REST = dict(nf=(0, 0, 0), ff=(0, 0, 0), na=(-5, 8), fa=(5, 8))

# walk / run strides at Dad's leg length (planted foot moves this far per frame)
WALK_D, RUN_D = 4.0, 7.0


def P(**kw):
    d = dict(REST)
    d.update(kw)
    return d


def walk_cycle(S=6.0, d=WALK_D):
    # stance: contact (heel, toe up) -> down -> passing -> toe-off; swing: lifted passes
    st = [(S, 14, 0), (S - d, 0, 0), (S - 2 * d, 0, 0), (-S, -30, 0), (-S + d, -10, 2.4), (S - d, 6, 1.6)]
    hip = [1, 1, 0, 1, 1, 0]
    sw = [-30, -12, 14, 30, 12, -14]  # near arm (opposite the near leg)
    out = []
    for i in range(6):
        a = sw[i]
        b = sw[(i + 3) % 6]
        out.append(P(hip=(0, hip[i]), nf=st[i], ff=st[(i + 3) % 6],
                     na=(a, 14 + max(0, a) * 0.9), fa=(b, 14 + max(0, b) * 0.9)))
    return out


def run_cycle(d=RUN_D, lean=1):
    st = [(3, 12, 0), (3 - d, 0, 0), (-8, -50, 2.4), (-5, -25, 6), (2, 0, 5.5), (7, 14, 2.6)]
    hip = [0, 1, -1, 0, 1, -1]
    sw = [-55, -25, 25, 55, 25, -25]
    out = []
    for i in range(6):
        a = sw[i]
        b = sw[(i + 3) % 6]
        out.append(P(hip=(0, hip[i]), lean=lean, head=(1, 0), nf=st[i], ff=st[(i + 3) % 6],
                     na=(a, 95 - max(0, -a) * 0.6), fa=(b, 95 - max(0, -b) * 0.6)))
    return out


def common_poses():
    p = {}
    p['idle'] = [P(), P(hip=(0, 1), na=(-3, 12), fa=(3, 12)), P(), P(blink=True)]
    p['walk'] = walk_cycle()
    p['run'] = run_cycle()
    p['jump'] = [
        P(hip=(0, -1), nf=(1, -45, 0), ff=(4, -10, 3.5), na=(-45, 30), fa=(140, 20), head=(0, -1)),
        P(nf=(1, -25, 2.5), ff=(4, -10, 5.5), na=(-60, 40), fa=(160, 10), head=(0, -1)),
    ]
    p['fall'] = [
        P(nf=(-1, -25, 1.5), ff=(3, -10, 3), na=(-110, -20), fa=(120, -20)),
        P(nf=(-3, -35, 0), ff=(3, -15, 2.5), na=(-150, -10), fa=(150, -10), head=(0, 1)),
    ]
    p['land'] = [
        P(hip=(0, 4), nf=(-1, 0, 0), ff=(1.5, 0, 0), na=(35, 25), fa=(20, 25), head=(0, 1)),
        P(hip=(0, 1), na=(10, 15), fa=(5, 15)),
    ]
    p['crouch'] = [
        P(hip=(0, 4), lean=1, head=(0, 1), nf=(-1, 0, 0), ff=(2, 0, 0), na=(30, 40), fa=(20, 40)),
        P(hip=(0, 6), lean=2, head=(1, 2), nf=(-1.5, 0, 0), ff=(2.5, 0, 0), na=(40, 50), fa=(30, 50)),
    ]
    p['hurt'] = [
        P(hip=(-1, 0), lean=-2, head=(-1, 0), nf=(3, 25, 2.5), ff=(-1, 0, 0), na=(-120, -20), fa=(115, 20), blink=True),
        P(hip=(-2, 1), lean=-1, head=(-1, 0), nf=(1, 0, 0), ff=(-2, 0, 0), na=(-90, -10), fa=(95, 20), blink=True),
    ]
    p['victory'] = [
        P(hip=(0, 4), nf=(-1, 0, 0), ff=(1.5, 0, 0), na=(-40, 20), fa=(-30, 20), head=(0, 1), ground=False),
        P(nf=(0, -45, 0), ff=(2, -40, 2), na=(-50, 30), fa=(152, -5), head=(0, -1), ground=False, up=5),
        P(nf=(-1, -20, 2), ff=(3, -15, 4), na=(-60, 40), fa=(150, -15), head=(0, -1), ground=False, up=9),
        P(nf=(0, -30, 0), ff=(2, -20, 1), na=(-40, 30), fa=(150, 0), ground=False, up=4),
        P(hip=(0, 2), nf=(-1, 0, 0), ff=(1.5, 0, 0), na=(-15, 20), fa=(150, 40), ground=False),
        P(nf=(-1, 0, 0), ff=(1.5, 0, 0), na=(-10, 15), fa=(148, -20), head=(0, -1), ground=False, blink=True),
    ]
    p['defeat'] = [
        P(hip=(-1, 0), lean=-2, head=(-1, 0), nf=(3, 25, 2.5), ff=(-1, 0, 0), na=(-120, -20), fa=(115, 20), blink=True),
        P(nf=(2, 20, 0), ff=(0, 0, 0), na=(60, 20), fa=(100, 20), rot=-40, blink=True),
        P(nf=(0, 0, 0), ff=(1, 0, 0), na=(20, 10), fa=(40, 10), rot=-90, blink=True),
        P(nf=(0, -10, 0), ff=(1, -10, 0), na=(5, 5), fa=(-5, 5), rot=-90, blink=True),
    ]
    return p


ATTACKS = {
    'dad': [  # shoulder-bump punch
        P(hip=(-1, 1), lean=-1, head=(-1, 0), nf=(-2, 0, 0), ff=(3, 0, 0), na=(40, 90), fa=(-50, 110)),
        P(hip=(2, 1), lean=2, head=(1, 0), nf=(-4, -25, 0), ff=(5, 10, 0), na=(-40, 80), fa=(88, 0)),
        P(hip=(3, 1), lean=2, head=(1, 0), nf=(-5, -25, 0), ff=(5, 0, 0), na=(-45, 80), fa=(92, -5)),
        P(hip=(1, 0), lean=1, nf=(-2, 0, 0), ff=(3, 0, 0), na=(-10, 40), fa=(45, 60)),
    ],
    'mom': [  # sparkle-hand thrust
        P(hip=(-1, 1), lean=-1, head=(-1, 0), nf=(-1, 0, 0), ff=(3, 0, 0), na=(30, 60), fa=(-130, 30)),
        P(hip=(1, 0), lean=1, head=(1, 0), nf=(-3, -20, 0), ff=(4, 10, 0), na=(-30, 40), fa=(110, -5)),
        P(hip=(2, 0), lean=1, head=(1, 0), nf=(-4, -20, 0), ff=(4, 0, 0), na=(-35, 40), fa=(100, 0)),
        P(hip=(1, 0), nf=(-1, 0, 0), ff=(2, 0, 0), na=(-10, 30), fa=(50, 50)),
    ],
    'brennan': [  # soccer kick with the near leg
        P(hip=(-1, 1), lean=-1, nf=(-7, -40, 3.5), ff=(1, 0, 0), na=(40, 50), fa=(-40, 30)),
        P(hip=(0, 1), lean=-1, head=(-1, 0), nf=(8, 20, 5), ff=(0, 0, 0), na=(-75, 30), fa=(25, 40), kick=True),
        P(hip=(1, 1), lean=-2, head=(-1, 0), nf=(8, 35, 9), ff=(0, 0, 0), na=(-85, 30), fa=(35, 40), kick=True),
        P(hip=(1, 0), nf=(4, 10, 2), ff=(0, 0, 0), na=(-30, 20), fa=(15, 20), kick=True),
    ],
    'parker': [  # two-hand push
        P(hip=(-1, 1), lean=-1, nf=(-1, 0, 0), ff=(2, 0, 0), na=(-30, 110), fa=(-20, 110)),
        P(hip=(1, 1), lean=1, head=(1, 0), nf=(4, 10, 0), ff=(-3, -20, 0), na=(90, 0), fa=(86, 0)),
        P(hip=(0, 1), lean=0, nf=(4, 0, 0), ff=(-3, -20, 0), na=(88, 0), fa=(84, 0)),
        P(hip=(0, 0), nf=(2, 0, 0), ff=(-1, 0, 0), na=(40, 60), fa=(30, 60)),
    ],
}

TUCK = dict(nf=(3, -15, 7), ff=(5, -10, 8), na=(70, 80), fa=(60, 80), ground=False)
ABILITIES = {
    'dad': [  # ground pound: tuck in the air, then the slam pose (held while dropping)
        P(nf=(2, -20, 4), ff=(4, -10, 5), na=(-60, 60), fa=(130, 40), head=(0, -1), ground=False, up=4),
        P(**{**TUCK, 'up': 6}),
        P(**{**TUCK, 'up': 6, 'bend': 10, 'na': (90, 60), 'fa': (80, 60)}),
        P(nf=(0, -50, 0), ff=(1.5, -50, 0), na=(-160, 0), fa=(160, 0), head=(0, -1), ground=False, up=3),
    ],
    'mom': [  # sparkle air jump: tucked front flip
        P(**{**TUCK, 'rot': 0, 'up': 4}),
        P(**{**TUCK, 'rot': 90, 'up': 4}),
        P(**{**TUCK, 'rot': 180, 'up': 4}),
        P(**{**TUCK, 'rot': 270, 'up': 4}),
    ],
    'brennan': [  # dash: deep lean, arms swept back
        P(hip=(0, 1), lean=2, head=(2, 0), nf=(6, 10, 0), ff=(-7, -50, 3), na=(-70, 20), fa=(-60, 20)),
        P(hip=(0, 2), lean=2, head=(2, 0), nf=(-1, 0, 0), ff=(-4, -20, 5), na=(-75, 20), fa=(-55, 20)),
        P(hip=(0, 1), lean=2, head=(2, 0), nf=(-7, -50, 3), ff=(6, 10, 0), na=(-60, 20), fa=(-70, 20)),
        P(hip=(0, 2), lean=2, head=(2, 0), nf=(-4, -20, 5), ff=(-1, 0, 0), na=(-55, 20), fa=(-75, 20)),
    ],
    'parker': [  # energy blast: palms together, push, recoil
        P(hip=(0, 1), nf=(-1, 0, 0), ff=(2, 0, 0), na=(60, 60), fa=(55, 60)),
        P(hip=(1, 1), lean=1, head=(1, 0), nf=(4, 10, 0), ff=(-3, -15, 0), na=(92, 0), fa=(88, 0)),
        P(hip=(-1, 1), lean=-1, head=(-1, 0), nf=(3, 0, 0), ff=(-3, -10, 0), na=(98, 0), fa=(94, 0)),
        P(hip=(0, 0), nf=(2, 0, 0), ff=(-1, 0, 0), na=(40, 50), fa=(30, 50)),
    ],
}


def build_human(cid: str, idle: np.ndarray) -> dict[str, list[np.ndarray]]:
    rig = Human(cid, idle)
    poses = common_poses()
    poses['attack'] = ATTACKS[cid]
    poses['ability'] = ABILITIES[cid]
    return {anim: [rig.draw(p) for p in plist] for anim, plist in poses.items()}


def human_meta(cid: str, idle: np.ndarray) -> dict:
    rig = Human(cid, idle)
    return dict(walk=dict(stride=round(WALK_D * rig.k, 2)), run=dict(stride=round(RUN_D * rig.k, 2)))


def build(cid: str, raw: dict[str, list[np.ndarray]]) -> dict[str, list[np.ndarray]]:
    if cid in HUMANS:
        return build_human(cid, raw['idle'][0])
    if cid == 'lupin':
        from animate_dog import build_dog
        return build_dog(raw)
    return {}


# ---------------------------------------------------------------- runtime timing (atlas meta.anims)
def anim_meta(cid: str, raw: dict[str, list[np.ndarray]]) -> dict:
    """Per-anim timing written into the atlas JSON (`meta.anims`, read by AnimationSystem):
    fps, per-frame durations (ms) and the locomotion stride (px of ground per frame) that
    stride-synced playback uses to keep planted feet from sliding."""
    if cid == 'lupin':
        from animate_dog import RUN_D as DR, WALK_D as DW
        return dict(idle=dict(durations=[240, 240, 240, 240]),
                    walk=dict(fps=20, stride=DW), run=dict(fps=20, stride=DR))
    rig = Human(cid, raw['idle'][0])
    kid = rig.k < 0.9
    meta = dict(
        idle=dict(durations=[600, 600, 500, 130]),
        walk=dict(fps=16 if kid else 14, stride=round(WALK_D * rig.k, 2)),
        run=dict(fps=18 if kid else 16, stride=round(RUN_D * rig.k, 2)),
    )
    if cid != 'brennan':  # the dash loops; the others play once and hold (dad: slam pose while dropping)
        meta['ability'] = dict(loop=False)
    return meta


ANIM_FPS = dict(idle=6, walk=14, run=16, jump=8, fall=8, land=14, crouch=10, attack=16, hurt=10, victory=8,
                defeat=8, ability=14, move=10, hit=12, die=10)
LOOPING = {'idle', 'walk', 'run', 'ability', 'move'}


def preview_cells(fr: dict[str, np.ndarray], meta: dict) -> list[dict]:
    """Cells for rig.anim_gif: every anim at its runtime rate; walk/run scroll the ground
    at the nominal stride speed (planted feet must move with the ground ticks)."""
    groups: dict[str, list[np.ndarray]] = {}
    for name, f in fr.items():
        anim = name.rpartition('_')[0]
        groups.setdefault(anim, []).append(f)
    cells = []
    for anim, frames in groups.items():
        m = meta.get(anim, {})
        fps = m.get('fps', ANIM_FPS.get(anim, 10))
        if 'durations' in m:
            fps = 1000 * len(frames) / sum(m['durations'])
        cells.append(dict(title=anim, frames=frames, fps=fps, loop=anim in LOOPING,
                          scroll=m.get('stride', 0) * fps))
    return cells
