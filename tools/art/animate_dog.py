"""Quadruped rig for Lupin (the family dog).

Rigid parts come from the sheet's walk pose (`walk_0` as extracted): body, head (with the
floppy ear) and tail; the four legs + paws are rig limbs (fluffy capsules). Gaits:
trot (walk: diagonal pairs), bound/gallop (run: gather - push - flight - front landing),
tail wag via rotsprite rotation around the tail root.

Coordinates are walk_0 sprite pixels; see animate_characters.py for the conventions.
"""
from __future__ import annotations

import math

import numpy as np

from rig import Canvas, bottom_anchor, ik2, rot90, rot_sprite, strip_outline

FRAME = 48
GROUND = 47.0

FAR_LEG, TAIL, BODY, NEAR_LEG, HEAD = 1, 2, 4, 3, 5
DEPTH = {FAR_LEG: 1, TAIL: 2, NEAR_LEG: 3, BODY: 4, HEAD: 5}
MERGE = {(FAR_LEG, BODY), (NEAR_LEG, BODY), (BODY, HEAD)}

DOG = dict(
    tail=(0, 0, 5, 6), tail_root=(4.0, 7.0),
    head=(11, 0, 22, 8), ear=(12, 6, 17, 12), neck_row=5,
    body_bottom=12,
    hips=((4.0, 11.0), (6.0, 10.5)),      # (near, far)
    shoulders=((14.0, 11.0), (16.2, 10.5)),
    leg=(2.2, 2.2, 1.75, 1.6), paw=1.55,
    eye=(18, 4),
    fur=((250, 243, 223), (253, 248, 230), (232, 211, 177), (212, 185, 152)),
    pad=(190, 160, 140),
    paint={
        (19, 8): (224, 92, 104), (20, 8): (224, 92, 104), (20, 7): (150, 40, 52),
        (12, 8): (226, 70, 70), (13, 9): (246, 200, 70), (14, 9): (70, 150, 230),
        (15, 10): (110, 200, 110), (16, 10): (236, 110, 190), (17, 11): (226, 70, 70),
    },
)


def _tone(tbl, nx, far, rel):
    main, light, shade, dark = tbl
    if far:
        main, light, shade = shade, main, dark
    if nx > 0.5 and rel > 0.4:
        return light
    if nx < -0.4 and rel > 0.4:
        return shade
    return main


class Dog:
    def __init__(self, walk0: np.ndarray):
        d = self.d = DOG
        h, w = walk0.shape[:2]
        self.ox = int(round(FRAME / 2 - w / 2))
        self.oy = FRAME - h
        base = strip_outline(walk0)
        H, W = base.shape[:2]
        # touch-ups lost in the 2.8x reduction (visible on the sheet): pink tongue in
        # the open mouth and the beaded rainbow collar
        for (x, y), c in d.get('paint', {}).items():
            if 0 <= y < H and 0 <= x < W and base[y, x, 3]:
                base[y, x, :3] = c
        yy, xx = np.mgrid[0:H, 0:W]

        def box(b):
            x0, y0, x1, y1 = b
            return (xx >= x0) & (xx <= x1) & (yy >= y0) & (yy <= y1)
        tail_m = box(d['tail'])
        head_m = box(d['head']) | box(d['ear'])
        body_m = (yy <= d['body_bottom']) & ~tail_m & ~box(d['head'])

        def cut(m):
            o = np.zeros_like(base)
            o[m] = base[m]
            return o
        self.tail, self.head, self.body = cut(tail_m), cut(head_m), cut(body_m)
        ex, ey = d['eye']
        self.blink_head = self.head.copy()
        self.blink_head[ey, ex, :3] = d['fur'][3]
        if ey + 1 < H and self.blink_head[ey + 1, ex, 3]:
            self.blink_head[ey + 1, ex, :3] = (90, 60, 56)
        self.k = 1.0

    def draw(self, P: dict) -> np.ndarray:
        d = self.d
        cv = Canvas(FRAME, FRAME)
        cv.depth = dict(DEPTH)
        ox, oy = self.ox, self.oy
        bx, by = P.get('body', (0, 0))
        hdx, hdy = P.get('head', (0, 0))
        fdy = P.get('front', 0)  # front of the body lifted (-) / lowered (+) -> shoulders
        tdx, tdy = ox + bx, oy + by
        L1, L2, r1, r2 = d['leg']
        pr = d['paw']

        def leg(pivot, foot, far, front, lab):
            fx, lift = foot[:2]
            root = (pivot[0] + tdx, pivot[1] + tdy + (fdy if front else 0))
            paw = (pivot[0] + ox + fx, GROUND - pr - lift)
            knee, end = ik2(root, paw, L1, L2, bend=1 if front else -1)

            def col(t, nx, ny, rel, far=far):
                return _tone(d['fur'], nx, far, rel)
            cv.capsules([root, knee, end], [r1, r2], col, lab)

            def pcol(t, nx, ny, rel, far=far):
                if ny > 0.55 and rel > 0.5:
                    return d['fur'][3] if not far else d['pad']
                return _tone(d['fur'], nx, far, rel)
            cv.disc(end[0] + 0.4, end[1], pr, pcol, lab)
        (hn, hf), (sn, sf) = d['hips'], d['shoulders']
        leg(hf, P['hf'], True, False, FAR_LEG)
        leg(sf, P['ff'], True, True, FAR_LEG)
        # tail (behind the body)
        ang = P.get('tail', 0)
        tr = d['tail_root']
        if ang:
            tail, npv = rot_sprite(self.tail, ang, tr)
        else:
            tail, npv = self.tail, tr
        tdy_tail = P.get('tail_dy', 0)
        cv.sprite(tail, tr[0] + tdx, tr[1] + tdy + tdy_tail, TAIL, anchor=npv)
        leg(hn, P['hn'], False, False, NEAR_LEG)
        leg(sn, P['fn'], False, True, NEAR_LEG)
        cv.sprite(self.body, tdx, tdy, BODY)
        head = self.blink_head if P.get('blink') else self.head
        cv.sprite(head, tdx + hdx, tdy + hdy + (fdy if fdy < 0 else 0), HEAD)
        img = cv.finish(merge=MERGE)
        from animate_characters import _post
        if P.get('flip'):
            img = img[:, ::-1].copy()
        return _post(img, P)


def Q(**kw):
    d = dict(hn=(0, 0), hf=(0, 0), fn=(0, 0), ff=(0, 0))
    d.update(kw)
    return d


WALK_D, RUN_D = 2.5, 4.0


def dog_poses() -> dict[str, list[dict]]:
    p = {}
    p['idle'] = [
        Q(tail=-14),
        Q(tail=14, body=(0, 1), head=(0, 0)),
        Q(tail=-14),
        Q(tail=14, blink=True),
    ]
    # trot: near-front + far-hind together, far-front + near-hind half a cycle later
    S, d = 3.75, WALK_D
    st = [(S, 0), (S - d, 0), (S - 2 * d, 0), (-S, 0.5), (-S + d, 2.2), (S - d, 1.4)]
    bob = [0, 1, 0, 0, 1, 0]
    tail = [-12, 0, 12, 12, 0, -12]
    p['walk'] = [Q(fn=st[i], hf=st[i], ff=st[(i + 3) % 6], hn=st[(i + 3) % 6], body=(0, bob[i]),
                   head=(0, bob[i] and -1 + 1), tail=tail[i]) for i in range(6)]
    # bound / gallop
    D = RUN_D
    hind = [(0, 0), (-D, 0), (-7, 2), (-5, 3.5), (0, 3.5), (D, 0)]
    front = [(-4, 2.5), (2, 3.5), (6, 2), (4, 0), (4 - D, 0), (-5, 1)]
    body = [(0, 1), (0, -1), (0, -2), (0, -1), (0, 1), (0, 0)]
    front_lift = [0, -1, 0, 1, 0, 0]
    tail = [10, 20, 25, 15, 0, 5]
    run = []
    for i in range(6):
        hf_ = hind[(i + 5) % 6]
        ff_ = front[(i + 5) % 6]
        run.append(Q(hn=hind[i], hf=(hf_[0] - 0.5, hf_[1]), fn=front[i], ff=(ff_[0] - 0.5, ff_[1]),
                     body=body[i], front=front_lift[i], tail=tail[i], head=(1, 0)))
    p['run'] = run
    p['jump'] = [
        Q(hn=(-4, 0), hf=(-3, 0), fn=(3, 3), ff=(4, 2.5), front=-2, head=(1, -1), tail=20),
        Q(hn=(-5, 2), hf=(-4, 2.5), fn=(4, 3), ff=(5, 2.5), front=-1, head=(1, -1), tail=25),
    ]
    p['fall'] = [
        Q(hn=(-3, 2), hf=(-2, 2.5), fn=(4, 1), ff=(5, 1.5), front=1, tail=10),
        Q(hn=(-2, 1), hf=(-1, 1.5), fn=(5, 0), ff=(6, 0.5), front=1, head=(1, 1), tail=-5),
    ]
    p['land'] = [
        Q(body=(0, 2), hn=(-1, 0), hf=(0, 0), fn=(1, 0), ff=(2, 0), head=(0, 1), tail=-10),
        Q(body=(0, 1), tail=0),
    ]
    p['crouch'] = [
        Q(body=(0, 2), hn=(-2, 0), hf=(-1, 0), fn=(2, 0), ff=(3, 0), head=(0, 1), tail=-10),
        Q(body=(0, 3), hn=(-3, 0), hf=(-2, 0), fn=(3, 0), ff=(4, 0), head=(1, 2), tail=-14),
    ]
    p['attack'] = [  # pounce + bite
        Q(body=(-1, 2), hn=(1, 0), hf=(2, 0), fn=(-1, 0), ff=(0, 0), head=(0, 1), tail=10),
        Q(body=(1, -1), hn=(-5, 0), hf=(-4, 0.5), fn=(5, 2.5), ff=(6, 2), front=-1, head=(2, -1), tail=25),
        Q(body=(2, 0), hn=(-5, 1), hf=(-4, 1.5), fn=(6, 1.5), ff=(7, 1), head=(3, 0), tail=25),
        Q(body=(1, 1), hn=(-2, 0), hf=(-1, 0), fn=(3, 0), ff=(4, 0), head=(1, 0), tail=10),
    ]
    p['hurt'] = [
        Q(body=(-1, 0), hn=(-2, 0), hf=(-1, 0), fn=(2, 2), ff=(3, 1.5), front=-2, head=(-1, -1), tail=-30, blink=True),
        Q(body=(-2, 1), hn=(-2, 0), hf=(-1, 0), fn=(1, 0), ff=(2, 0), front=-1, head=(-1, 0), tail=-25, blink=True),
    ]
    p['victory'] = [
        Q(body=(0, 2), hn=(-1, 0), hf=(0, 0), fn=(1, 0), ff=(2, 0), tail=20, ground=False),
        Q(hn=(-4, 2), hf=(-3, 2), fn=(3, 3), ff=(4, 3), front=-1, head=(0, -1), tail=30, ground=False, up=5),
        Q(hn=(-3, 3), hf=(-2, 3), fn=(3, 3), ff=(4, 3), tail=30, ground=False, up=8, flip=True),
        Q(hn=(-3, 2), hf=(-2, 2), fn=(3, 2), ff=(4, 2), tail=25, ground=False, up=4),
        Q(body=(0, 1), tail=-20, ground=False),
        Q(head=(0, -1), tail=25, ground=False, blink=True),
    ]
    p['defeat'] = [
        Q(body=(-1, 0), hn=(-2, 0), hf=(-1, 0), fn=(2, 2), ff=(3, 1.5), front=-2, head=(-1, -1), tail=-30, blink=True),
        Q(hn=(-2, 1), hf=(-1, 1), fn=(2, 1), ff=(3, 1), tail=-20, rot=-30, blink=True),
        Q(hn=(-1, 2), hf=(0, 1), fn=(1, 2), ff=(2, 1), tail=-10, rot=-180, blink=True),
        Q(hn=(-1, 3), hf=(0, 2), fn=(1, 3), ff=(2, 2), tail=-20, rot=-180, blink=True),
    ]
    p['ability'] = [  # super sniff: nose to the ground, sniff-sniff
        Q(body=(0, 1), head=(1, 2), front=1, tail=15, fn=(1, 0), ff=(2, 0)),
        Q(body=(0, 1), head=(1, 3), front=1, tail=-10, fn=(1, 0), ff=(2, 0)),
        Q(body=(0, 1), head=(2, 2), front=1, tail=15, fn=(1, 0), ff=(2, 0)),
        Q(body=(0, 1), head=(2, 3), front=1, tail=-10, fn=(1, 0), ff=(2, 0), blink=True),
    ]
    return p


def build_dog(raw: dict[str, list[np.ndarray]]) -> dict[str, list[np.ndarray]]:
    rig = Dog(raw['walk'][0])
    return {anim: [rig.draw(q) for q in ql] for anim, ql in dog_poses().items()}


def dog_meta() -> dict:
    return dict(walk=dict(stride=WALK_D), run=dict(stride=RUN_D))
