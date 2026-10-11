#!/usr/bin/env python3
"""
World 2 ("The North Side") props, merged into the props atlas by draw_props.py.
Same rules as World 1: bottom-anchored (the prop stands on the frame's bottom row),
1px `ink` outline, hard alpha, palette `P`, light from the top-left.

Static frames
  park_tree_s 32x40, park_tree_m 48x60, park_tree_l 64x80   round park trees (oak / elm canopies)
  park_bench 32x18          green-slatted Chicago park bench
  park_lamp 16x56           acorn-globe park lamp (lit: Lighting adds a glow at night)
  lion_statue 44x34         stone lion on a plinth
  giraffe_topiary 30x56     clipped-hedge giraffe in a planter
  flower_bed 48x16          raised bed of tulips / marigolds
  lifeguard_stand 32x52     tall white lifeguard chair with a red rescue board
  beach_umbrella 36x40      striped umbrella in the sand
  volleyball_net 64x34      beach volleyball net
  sailboat 40x48            moored sailboat (background / pier decoration)
  buoy 12x18                red-white marker buoy
  stadium_light 32x112      ballpark light standard (Lighting adds the glow)
  scoreboard 64x52          chunk of the hand-turned scoreboard with a clock + flagpoles
  pennants 64x16            string of pennants (hang it between poles)
  ivy_clump 16x14, ivy_clump_l 32x24   ivy tufts to break up walls / ledges
  baseball 8x8              a baseball (decor)
Animations (looping flicker, timing in meta.anims)
  neon_bar_0-3, neon_pizza_0-3, neon_dogs_0-3, neon_open_0-3   40x18 neon signs
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from pxl import FONT3, FONT5, Cv, T, c, lerp  # noqa: E402

BAY = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
IRON = lerp("gr4", "ink2", 0.4)
IRON_L = lerp("gr3", "s3", 0.3)


def canopy(cv, blobs, cx, cy, greens=("gr0", "gr1", "gr2", "gr3", "gr4")):
    shape = set()
    for bx, by, br in blobs:
        for y in range(int(by - br) - 1, int(by + br) + 2):
            for x in range(int(bx - br) - 1, int(bx + br) + 2):
                if math.hypot(x - bx, (y - by) * 1.1) <= br:
                    shape.add((x, y))
    for (x, y) in shape:
        k = (x - cx) * 0.45 + (y - cy) + (BAY[y % 4][x % 4] - 7.5) * 0.4
        col = greens[0] if k < -10 else greens[1] if k < -2 else greens[2] if k < 7 else greens[3]
        cv.set(x, y, col)
    # leaf clumps: lit dabs on the upper-left of each blob, dark crescents underneath
    for bx, by, br in blobs:
        for a in range(0, 360, 40):
            r_ = br * 0.6
            x = int(bx + math.cos(math.radians(a)) * r_)
            y = int(by + math.sin(math.radians(a)) * r_ * 0.9)
            if (x, y) in shape and a in (200, 240, 280):
                cv.set(x, y, greens[0])
                cv.set(x + 1, y, greens[1])
    for (x, y) in shape:
        if (x, y + 1) not in shape and y > cy:
            cv.set(x, y, greens[4])
    return shape


def park_tree(size):
    W, H = {"s": (32, 40), "m": (48, 60), "l": (64, 80)}[size]
    cv = Cv(W, H)
    cx = W // 2
    tw = {"s": 3, "m": 4, "l": 6}[size]
    top_trunk = int(H * 0.45)
    # trunk + root flare + two limbs
    cv.rect(cx - tw // 2, top_trunk, tw, H - top_trunk, "wd3")
    cv.vline(cx - tw // 2, top_trunk, H - top_trunk, "wd2")
    cv.vline(cx + tw - tw // 2 - 1, top_trunk, H - top_trunk, "wd4")
    cv.rect(cx - tw // 2 - 1, H - 2, tw + 2, 2, "wd3")
    cv.line(cx, top_trunk + 6, cx - W // 4, top_trunk - 4, "wd3")
    cv.line(cx + 1, top_trunk + 4, cx + W // 4, top_trunk - 6, "wd3")
    for y in range(top_trunk, H, 3):  # bark
        cv.set(cx, y, "wd4")
    s = W / 64
    blobs = [(cx, H * 0.27, 17 * s), (cx - 17 * s, H * 0.38, 12 * s), (cx + 17 * s, H * 0.36, 13 * s),
             (cx - 4 * s, H * 0.45, 14 * s), (cx - 9 * s, H * 0.17, 10 * s), (cx + 10 * s, H * 0.16, 10 * s),
             (cx + 22 * s, H * 0.48, 8 * s), (cx - 22 * s, H * 0.5, 8 * s)]
    canopy(cv, blobs, cx, H * 0.3)
    # grass tuft at the base
    for x in range(cx - tw - 3, cx + tw + 3):
        if (x * 7) % 3:
            cv.set(x, H - 1, "gr2")
            if x % 2:
                cv.set(x, H - 2, "gr1")
    cv.outline("ink")
    return cv


def park_bench():
    cv = Cv(32, 18)
    wood, wood_d, wood_l = lerp("gr2", "gr3", 0.2), "gr3", lerp("gr1", "gr0", 0.3)
    for y in (2, 5):  # back slats
        cv.rect(2, y, 28, 2, wood)
        cv.hline(2, y, 28, wood_l)
    for y in (10, 12):  # seat slats (seen slightly from above)
        cv.rect(1, y, 30, 2, wood)
        cv.hline(1, y, 30, wood_l)
    cv.hline(1, 14, 30, wood_d)
    for x in (4, 26):  # cast iron ends with a scroll
        cv.rect(x, 1, 2, 17, IRON)
        cv.vline(x, 1, 17, IRON_L)
        cv.rect(x - 1, 15, 4, 3, IRON)
        cv.set(x - 1, 9, IRON), cv.set(x + 2, 9, IRON)
    cv.rect(14, 15, 4, 3, IRON)
    cv.outline("ink")
    return cv


def park_lamp():
    cv = Cv(16, 56)
    post, post_l = IRON, IRON_L
    cv.rect(7, 18, 3, 34, post)
    cv.vline(7, 18, 34, post_l)
    cv.rect(5, 46, 7, 6, post)
    cv.hline(5, 46, 7, post_l)
    cv.rect(4, 52, 9, 4, post)
    cv.hline(4, 52, 9, post_l)
    for y in (26, 36):
        cv.hline(6, y, 5, post_l)
    # acorn globe (warm glass) on a collar
    cv.rect(5, 16, 7, 2, post)
    for y in range(3, 16):
        w = {3: 2, 4: 4, 5: 6}.get(y, 8 if y < 13 else 7 if y < 15 else 6)
        x0 = 8 - w // 2
        cv.hline(x0, y, w, "y0" if y < 8 else "y1" if y < 12 else "y2")
    cv.vline(5, 7, 6, "w")
    cv.set(6, 6, "w")
    cv.rect(7, 0, 3, 3, post)
    cv.set(8, 0, post_l)
    cv.outline("ink")
    return cv


def lion_statue():
    cv = Cv(44, 34)
    st, st_l, st_d, st_dd = "g1", "g0", "g2", "g3"
    # plinth
    cv.rect(2, 24, 40, 10, st_d)
    cv.hline(2, 24, 40, st_l)
    cv.rect(4, 26, 36, 6, st)
    cv.hline(4, 32, 36, st_dd)
    cv.rect(16, 27, 12, 4, st_d)  # plaque
    cv.hline(16, 27, 12, st_dd)
    # reclining lion (head right, mane), drawn as stone (verdigris tinted)
    body, body_l, body_d = lerp("t2", "g1", 0.5), lerp("t1", "g0", 0.45), lerp("t3", "g3", 0.4)
    cv.ellipse(18, 18.5, 13, 5.5, body)  # torso
    cv.ellipse(14, 16, 8, 3, body_l)
    cv.rect(6, 19, 30, 5, body)
    cv.rect(4, 21, 8, 3, body)  # hind leg
    cv.rect(26, 21, 13, 3, body)  # fore legs stretched
    cv.hline(26, 23, 13, body_d)
    for a in range(0, 360, 30):  # shaggy mane: ring of tufts
        r_ = 7.5 if a % 60 else 8.5
        cv.disc(31 + math.cos(math.radians(a)) * 4.2, 12 + math.sin(math.radians(a)) * 4.2, 3.2 if a % 60 else 3.6, body_d)
    cv.disc(31, 12, 5.5, lerp(body, body_d, 0.4))
    for a in range(200, 330, 30):  # lit tufts on the upper left
        cv.set(int(31 + math.cos(math.radians(a)) * 6), int(12 + math.sin(math.radians(a)) * 6), body_l)
    cv.ellipse(34, 13, 3.6, 3.4, body_l)  # face
    cv.rect(36, 13, 4, 3, body_l)  # muzzle
    cv.set(39, 13, "ink2")  # nose
    cv.set(35, 11, "ink2")  # eye
    cv.hline(36, 16, 3, body_d)
    cv.set(32, 8, body_l), cv.set(33, 8, body)  # ear
    cv.line(4, 20, 1, 14, body)  # tail
    cv.set(1, 13, body_d), cv.set(0, 13, body_d)
    cv.hline(8, 23, 16, body_d)
    cv.outline("ink")
    return cv


def giraffe_topiary():
    cv = Cv(30, 56)
    g, g_l, g_d = "gr2", "gr1", "gr3"
    # planter box
    cv.rect(4, 46, 22, 10, "wd2")
    cv.hline(4, 46, 22, "wd1")
    cv.vline(25, 46, 10, "wd3")
    for x in range(6, 25, 5):
        cv.vline(x, 47, 9, "wd3")
    # legs, body, long neck, head with ossicones — clipped hedge texture
    shape = Cv(30, 56)
    for lx in (8, 12, 18, 22):
        shape.rect(lx, 30, 3, 16, g)
    shape.ellipse(15, 27, 10, 6, g)
    for i in range(18):
        shape.rect(18 + i // 3, 22 - i, 4, 2, g)
    shape.ellipse(26, 5, 3.5, 2.5, g)
    shape.set(24, 1, g), shape.set(26, 1, g)
    for y in range(56):
        for x in range(30):
            if shape.get(x, y)[3]:
                k = (BAY[y % 4][x % 4]) / 16
                col = g_l if (shape.get(x - 1, y - 1)[3] == 0 or k < 0.2) else g_d if (shape.get(x + 1, y + 1)[3] == 0 or k > 0.85) else g
                cv.set(x, y, col)
    cv.set(27, 4, "ink2")
    for (x, y) in ((12, 25), (16, 23), (19, 28), (13, 29), (21, 16), (20, 10)):  # 'spots' of darker leaves
        cv.set(x, y, "gr4"), cv.set(x + 1, y, g_d)
    cv.outline("ink")
    return cv


def flower_bed():
    cv = Cv(48, 16)
    cv.rect(1, 9, 46, 7, "l2")  # stone curb
    cv.hline(1, 9, 46, "l0")
    cv.hline(1, 15, 46, "l4")
    for x in range(2, 46, 8):
        cv.vline(x, 10, 5, "l3")
    cv.rect(2, 7, 44, 3, "d1")
    cols = ["cr", "y1", "pk", "o1", "w", "p1"]
    for i in range(30):
        x = 3 + (i * 37) % 42
        y = 2 + (i * 13) % 6
        col = cols[(i * 5) % len(cols)]
        cv.vline(x + 1, y + 2, 9 - y - 2 if 9 - y - 2 > 0 else 1, "gr2")
        cv.rect(x, y, 2, 2, col)
        cv.set(x, y, lerp(col, "ffffff", 0.4) if col != "w" else "w")
    for x in range(2, 46, 2):
        cv.set(x, 7, "gr1")
        cv.set(x + 1, 6, "gr2")
    cv.outline("ink")
    return cv


def lifeguard_stand():
    cv = Cv(32, 52)
    wd, wd_d, wd_l = "w", "g1", "w"
    # legs (A-frame, side view) + cross braces
    cv.line(4, 51, 11, 22, wd)
    cv.line(5, 51, 12, 22, wd_d)
    cv.line(27, 51, 20, 22, wd_d)
    cv.line(26, 51, 19, 22, wd)
    for y in (32, 42):
        cv.hline(8 + (51 - y) // 6, y, 16 - (51 - y) // 3, wd_d)
    # seat + back + rescue board
    cv.rect(9, 20, 15, 3, wd)
    cv.hline(9, 22, 15, wd_d)
    cv.rect(19, 6, 3, 15, wd)
    cv.vline(21, 6, 15, wd_d)
    cv.rect(6, 4, 4, 20, "cr")  # red rescue board leaning
    cv.vline(6, 4, 20, "pk")
    cv.hline(6, 4, 4, "pk")
    cv.rect(12, 10, 8, 2, "cr")  # umbrella stub / sign
    # rungs
    for y in range(26, 50, 5):
        cv.hline(12 + (y - 26) // 8, y, 8, wd_d)
    cv.outline("ink")
    return cv


def beach_umbrella():
    cv = Cv(36, 40)
    cx = 18
    stripes = ["cr", "w", "cb2", "w", "y1", "w", "cr", "w"]
    for i in range(8):
        a0 = math.pi + i * math.pi / 8
        a1 = math.pi + (i + 1) * math.pi / 8
        cv.poly([(cx, 2), (cx + 17 * math.cos(a0), 13 + 7 * math.sin(a0)), (cx + 17 * math.cos(a1), 13 + 7 * math.sin(a1))], stripes[i])
    for i in range(8):  # scalloped valance
        x0 = cx - 17 + i * 4.25
        cv.ellipse(x0 + 2.1, 13, 2.2, 1.3, lerp(stripes[i], "ink2", 0.18))
    cv.rect(cx - 1, 0, 2, 3, "s2")
    cv.rect(cx, 14, 1, 24, "s2")
    cv.vline(cx + 1, 14, 24, "s3")
    cv.ellipse(cx, 38.5, 6, 1.5, lerp("l1", "l2", 0.5))  # sand mound
    cv.outline("ink")
    return cv


def volleyball_net():
    cv = Cv(64, 34)
    for x in (2, 60):
        cv.rect(x, 2, 2, 32, "s2")
        cv.vline(x, 2, 32, "s0")
        cv.rect(x - 1, 1, 4, 2, "s3")
    for y in range(5, 14):
        for x in range(4, 60):
            if (x + y) % 3 == 0 or (x - y) % 3 == 0:
                cv.set(x, y, "w" if y > 5 else "s1")
    cv.rect(4, 4, 56, 2, "w")
    cv.hline(4, 14, 56, "w")
    cv.line(2, 4, 0, 33, "g3")  # guy ropes
    cv.line(63, 4, 63, 33, "g3")
    cv.disc(32, 27.5, 3.3, "w")  # ball in the sand
    cv.line(30, 25, 34, 30, "cb2")
    cv.line(29, 28, 33, 25, "y1")
    cv.outline("ink")
    return cv


def sailboat():
    cv = Cv(40, 48)
    # hull
    cv.poly([(2, 38), (38, 38), (34, 46), (6, 46)], "w")
    cv.hline(2, 38, 37, "s0")
    cv.hline(6, 43, 30, "cb3")
    cv.hline(7, 45, 28, "g2")
    # mast + boom + sails
    cv.rect(18, 2, 2, 36, "s2")
    cv.vline(18, 2, 36, "s0")
    cv.poly([(21, 4), (21, 34), (36, 34)], "w")
    cv.poly([(16, 8), (16, 36), (4, 36)], "g0")
    for y in range(12, 34, 6):
        cv.hline(21, y, max(1, (y - 4) // 2), "g1")
    cv.hline(19, 35, 17, "s3")
    cv.rect(24, 22, 6, 3, "cr")  # sail number band
    cv.outline("ink")
    return cv


def buoy():
    cv = Cv(12, 18)
    for y in range(2, 14):
        w = 4 + min(y - 2, 4)
        cv.hline(6 - w // 2, y, w, "cr" if (y // 3) % 2 == 0 else "w")
    cv.vline(4, 6, 7, "pk")
    cv.rect(5, 0, 2, 2, "y1")
    cv.rect(1, 14, 10, 2, "s3")
    cv.ellipse(6, 16.5, 5.5, 1.4, lerp("t2", "t3", 0.4))
    cv.outline("ink")
    return cv


def stadium_light():
    cv = Cv(32, 112)
    steel, steel_l, steel_d = "s3", "s2", "s4"
    # lattice mast
    cv.rect(14, 30, 4, 82, steel)
    cv.vline(14, 30, 82, steel_l)
    cv.vline(17, 30, 82, steel_d)
    for y in range(32, 108, 8):
        cv.line(12, y, 19, y + 6, steel_d)
        cv.line(19, y, 12, y + 6, steel_d)
    cv.rect(10, 106, 12, 6, steel_d)
    cv.hline(10, 106, 12, steel_l)
    # lamp bank: 4 rows x 6 lamps, white-hot
    cv.rect(1, 2, 30, 26, steel_d)
    cv.rect(1, 2, 30, 1, steel_l)
    for j in range(4):
        for i in range(6):
            x, y = 3 + i * 5, 4 + j * 6
            cv.rect(x, y, 4, 4, "y0")
            cv.rect(x + 1, y + 1, 2, 2, "w")
            cv.set(x + 3, y + 3, "y1")
    cv.rect(13, 28, 6, 2, steel)
    cv.outline("ink")
    return cv


def scoreboard():
    cv = Cv(64, 52)
    g, g_d, g_l = lerp("gr3", "t4", 0.35), lerp("gr4", "t5", 0.4), lerp("gr2", "t3", 0.35)
    cv.rect(0, 16, 64, 36, g)
    cv.hline(0, 16, 64, g_l)
    cv.vline(63, 16, 36, g_d)
    for row in range(3):
        y = 20 + row * 10
        for k in range(7):
            x = 3 + k * 9
            on = (k * 5 + row * 3) % 4 != 0
            cv.rect(x, y, 7, 8, "w" if on else g_d)
            if on:
                d = FONT3[str((k + row) % 4)]
                for j, r_ in enumerate(d):
                    for i, v in enumerate(r_):
                        if v == "#":
                            cv.set(x + 2 + i, y + 2 + j - 1, "ink2")
    # clock + flag poles
    cv.rect(24, 4, 16, 12, g)
    cv.disc(32, 10, 5, "w")
    cv.vline(32, 6, 4, "ink2"), cv.hline(32, 10, 3, "ink2")
    for fx, col in ((4, "cr"), (14, "cb2"), (48, "y1"), (58, "w")):
        cv.vline(fx, 0, 16, "s1")
        cv.poly([(fx + 1, 1), (fx + 8, 3), (fx + 1, 6)], col)
    cv.outline("ink")
    return cv


def pennants():
    cv = Cv(64, 16)
    for x in range(64):  # sagging string
        y = 1 + int(4 * math.sin(math.pi * x / 63))
        cv.set(x, y, "g3")
    cols = ["cr", "w", "cb2", "y1", "cr", "w", "cb2"]
    for i in range(7):
        x0 = 2 + i * 9
        y0 = 1 + int(4 * math.sin(math.pi * (x0 + 3) / 63))
        cv.poly([(x0, y0 + 1), (x0 + 7, y0 + 1), (x0 + 3.5, y0 + 10)], cols[i])
        cv.set(x0 + 1, y0 + 2, lerp(cols[i], "ffffff", 0.4))
    cv.outline("ink")
    return cv


def ivy_clump(big=False):
    """Mound of ivy leaves (hangs over a ledge or hugs a wall base)."""
    W, H = (32, 24) if big else (16, 14)
    cv = Cv(W, H)
    shape = Cv(W, H)
    blobs = [(W * 0.5, H * 0.45, W * 0.32), (W * 0.27, H * 0.6, W * 0.24), (W * 0.73, H * 0.6, W * 0.24)]
    for bx, by, br in blobs:
        shape.ellipse(bx, by, br, br * 0.85, "gr3")
    for y in range(H):  # dangling tendrils below the mound
        for x in range(2, W - 2, 4 if big else 3):
            if shape.get(x, y - 1)[3] and not shape.get(x, y)[3] and y < H - 1 and (x * 7) % 5 < 3:
                for k in range(1 + (x * 3) % 3):
                    shape.set(x, y + k, "gr4")
    for y in range(H):
        for x in range(W):
            if shape.get(x, y)[3]:
                cv.set(x, y, "gr4" if shape.get(x, y) == c("gr4") else lerp("gr3", "gr4", 0.4))
    n = 26 if big else 9
    for i in range(n):  # leaves: lit top-left, dark bottom-right
        x = int((i * 37 + 3) % (W - 3))
        y = int((i * 23 + 1) % (H - 4))
        if not shape.get(x + 1, y + 1)[3]:
            continue
        for dx, dy, col in ((1, 0, "gr0"), (0, 1, "gr1"), (1, 1, "gr1"), (2, 1, "gr2"), (1, 2, "gr2"), (2, 2, "gr3")):
            if shape.get(x + dx, y + dy)[3]:
                cv.set(x + dx, y + dy, col)
    cv.outline("ink")
    return cv


def baseball():
    cv = Cv(8, 8)
    cv.disc(3.5, 3.5, 3.4, "w")
    cv.set(1, 2, "cr"), cv.set(2, 3, "cr"), cv.set(2, 4, "cr")
    cv.set(6, 3, "cr"), cv.set(5, 4, "cr"), cv.set(5, 5, "cr")
    cv.set(5, 1, "g1"), cv.set(6, 2, "g1")
    cv.outline("ink")
    return cv


NEON = {"bar": ("BAR", "pk", "p0"), "pizza": ("PIZZA", "o1", "o0"), "dogs": ("HOT DOGS", "y1", "y0"), "open": ("OPEN", "red", "pk")}


def neon_sign(kind, frame):
    """40x18 neon sign on a dark board. Frames: 0 on, 1 flicker (half the letters dark),
    2 on (brighter), 3 all dim."""
    word, col, hot = NEON[kind]
    cv = Cv(40, 18)
    cv.rect(0, 2, 40, 14, lerp("ink", "navy", 0.35))
    cv.frame(0, 2, 40, 14, lerp("s4", "ink2", 0.2))
    cv.rect(8, 0, 1, 2, "s3"), cv.rect(31, 0, 1, 2, "s3")
    font = FONT5 if len(word) <= 5 else FONT3
    tw = sum(len(font[ch][0]) + 1 for ch in word) - 1
    x = (40 - tw) // 2
    y = 5 if font is FONT5 else 7
    dim = lerp(col, "ink2", 0.65)
    for k, ch in enumerate(word):
        g = font[ch]
        lit = frame in (0, 2) or (frame == 1 and k % 2 == 0)
        tube = (hot if frame == 2 else col) if lit else dim
        for j, row in enumerate(g):
            for i, v in enumerate(row):
                if v == "#":
                    cv.set(x + i, y + j, tube)
        x += len(g[0]) + 1
    if frame != 3:  # glow halo on the board next to lit tubes (1px, dithered)
        src = cv.im.copy().load()
        for yy in range(3, 15):
            for xx in range(1, 39):
                p = src[xx, yy]
                if p[:3] in (c(col)[:3], c(hot)[:3]):
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    q = src[xx + dx, yy + dy]
                    if q[:3] in (c(col)[:3], c(hot)[:3]) and (xx + yy) % 2 == 0:
                        cv.set(xx, yy, lerp(p, col, 0.35))
                        break
    cv.outline("ink")
    return cv


NEON_META = {"fps": 8, "durations": [1700, 90, 140, 70], "loop": True}


def frames():
    fr = {
        "park_tree_s": park_tree("s").im,
        "park_tree_m": park_tree("m").im,
        "park_tree_l": park_tree("l").im,
        "park_bench": park_bench().im,
        "park_lamp": park_lamp().im,
        "lion_statue": lion_statue().im,
        "giraffe_topiary": giraffe_topiary().im,
        "flower_bed": flower_bed().im,
        "lifeguard_stand": lifeguard_stand().im,
        "beach_umbrella": beach_umbrella().im,
        "volleyball_net": volleyball_net().im,
        "sailboat": sailboat().im,
        "buoy": buoy().im,
        "stadium_light": stadium_light().im,
        "scoreboard": scoreboard().im,
        "pennants": pennants().im,
        "ivy_clump": ivy_clump().im,
        "ivy_clump_l": ivy_clump(True).im,
        "baseball": baseball().im,
    }
    for kind in NEON:
        for i in range(4):
            fr[f"neon_{kind}_{i}"] = neon_sign(kind, i).im
    meta = {f"neon_{k}": NEON_META for k in NEON}
    return fr, meta
