#!/usr/bin/env python3
"""
Draws public/assets/tilesets/chicago-tiles.png (256 wide, 16x16 tiles, 16 columns,
as many rows as the contract needs) in exactly the order of src/game/data/tiles.ts,
plus art/previews/tiles-*.png. Rows 4+ (materials + facade decor) come from draw_terrain.py,
World 2 rows (indices 608+) from draw_terrain_w2.py.

Fill tiles are periodic in 16px so they tile with themselves; each *_TOP tile
re-uses its fill function under a distinct walkable top band.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from pxl import ASSETS, PREVIEWS, ROOT, Cv, P, T, c, lerp, scaled  # noqa: E402
from PIL import Image  # noqa: E402
from draw_terrain import terrain_tiles  # noqa: E402
from draw_terrain_w2 import terrain_tiles_w2  # noqa: E402

S = 16


def h(x, y, seed=0):
    """Deterministic periodic hash noise in [0,1)."""
    x, y = x % S, y % S
    n = (x * 374761393 + y * 668265263 + seed * 2147483647) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65536.0


def tile():
    return Cv(S, S)


def fill_fn(cv, fn, y0=0, y1=S):
    for y in range(y0, y1):
        for x in range(S):
            col = fn(x, y)
            if col is not None:
                cv.set(x, y, col)


# ---------------------------------------------------------------------------
# Fill patterns (periodic)
# ---------------------------------------------------------------------------
def concrete(x, y, seed=1):
    # big 16x16 slab, soft seam on the right column and bottom row, light speckle
    if x == 15 or y == 15:
        return P["g3"] if (x == 15) != (y == 15) or x == 15 else P["g3"]
    if x == 0 or y == 0:
        return lerp("g1", "g2", 0.4)
    n = h(x, y, seed)
    if n < 0.035:
        return P["g3"]
    if n > 0.965:
        return P["g1"]
    return P["g2"]


def asphalt(x, y, seed=2):
    n = h(x, y, seed)
    if n < 0.10:
        return P["a3"]
    if n > 0.92:
        return P["a1"]
    return P["a2"]


def dirt(x, y, seed=3):
    n = h(x, y, seed)
    # pebbles
    if (x, y) in ((3, 4), (4, 4), (11, 10), (12, 10), (7, 13)):
        return P["g2"]
    if (x, y) in ((3, 5), (4, 5), (11, 11), (12, 11), (7, 14)):
        return P["d2"]
    if n < 0.12:
        return P["d2"]
    if n > 0.9:
        return P["d0"]
    return P["d1"]


def limestone(x, y):
    # ashlar: 8px courses, blocks 16 wide offset by 8 on alternate courses
    row = y // 8
    xo = (x + (8 if row % 2 else 0)) % 16
    yy = y % 8
    if yy == 7 or xo == 15:
        return P["l3"]
    if yy == 0 or xo == 0:
        return P["l0"]
    if yy == 6 or xo == 14:
        return P["l2"]
    n = h(x, y, 5)
    return P["l2"] if n < 0.07 else P["l1"]


def brick(x, y):
    row = y // 4
    xo = (x + (4 if row % 2 else 0)) % 8
    yy = y % 4
    if yy == 3 or xo == 7:
        return P["bm2"]
    n = h(x // 8 + row * 3, row, 7)
    base = P["b1"] if n < 0.55 else (P["b2"] if n < 0.85 else P["b0"])
    if yy == 0 and xo < 6:
        return lerp(base, "b0", 0.5) if base != P["b0"] else P["b0"]
    if yy == 2:
        return lerp(base, "b3", 0.35)
    return base


def glass(x, y):
    # curtain wall: 8px wide panes, mullions every 8px, horizontal spandrel every 16
    if x % 8 == 0:
        return P["gl4"]
    if y == 0:
        return P["gl4"]
    if y == 1 or x % 8 == 1:
        return P["gl1"]
    # diagonal reflection streaks
    d = (x + y) % 16
    if d in (5, 6):
        return P["gl1"]
    if d == 7:
        return P["gl0"] if (x + y) % 32 < 16 else P["gl1"]
    t = y / 15
    return P["gl2"] if t < 0.55 else P["gl3"]


def roof(x, y):
    # tar & gravel roof membrane
    n = h(x, y, 11)
    if n < 0.1:
        return P["g5"]
    if n > 0.9:
        return P["g3"]
    if y % 8 == 7:
        return P["g5"]
    return P["g4"]


def girder_body(x, y):
    # riveted box beam, horizontal bands, rivets every 8px
    if y in (0,):
        return P["r1"]
    if y == 15:
        return P["r3"]
    if y in (7, 8):
        # stiffener band
        return P["r3"] if y == 8 else P["r2"]
    if (y in (3, 12)) and (x % 8 == 3):
        return P["r0"]
    if (y in (4, 13)) and (x % 8 == 3):
        return P["r3"]
    if x % 16 == 15:
        return P["r3"]
    if x % 16 == 0:
        return P["r1"]
    return P["r2"]


def stone(x, y):
    # river wall rough stones: 8px courses, varied block widths
    row = y // 8
    offs = [0, 5][row % 2]
    widths = [16] if row % 2 == 0 else [16]
    xo = (x + offs) % 16
    cut = 9 if row % 2 == 0 else 6
    yy = y % 8
    edge_r = xo in (cut - 1, 15)
    if yy == 7 or edge_r:
        return P["s4"]
    if yy == 0 or xo in (cut, 0):
        return P["s1"]
    n = h(x, y, 13)
    if n < 0.12:
        return P["s3"]
    if n > 0.94:
        return P["s1"]
    return P["s2"]


def riverwalk_body(x, y):
    # warm granite pavers stacked
    row = y // 8
    xo = (x + (4 if row % 2 else 12)) % 16
    yy = y % 8
    if yy == 7 or xo == 15:
        return P["g3"]
    if yy == 0 or xo == 0:
        return P["g0"]
    n = h(x, y, 17)
    if n < 0.1:
        return lerp("g1", "l2", 0.4)
    return lerp("g1", "l1", 0.35)


def water(x, y):
    # teal water body with soft wave highlights that wrap
    base = lerp("t3", "t4", min(1.0, y / 15 * 0.6))
    ph = (y // 4) * 5
    xx = (x + ph) % 16
    if y % 4 == 1 and xx in (2, 3, 4):
        return P["t2"]
    if y % 4 == 1 and xx == 5 and y < 8:
        return P["t1"]
    if y % 8 == 6 and xx in (10, 11):
        return P["t4"]
    return base


def subway(x, y):
    # white glazed subway tiles 8x4 running bond with grey grout
    row = y // 4
    xo = (x + (4 if row % 2 else 0)) % 8
    yy = y % 4
    if yy == 3 or xo == 7:
        return P["g2"]
    if yy == 0 and xo < 3:
        return P["w"]
    return P["g0"]


def lower_wacker(x, y):
    # dark concrete wall panel
    if x == 0 or y == 15:
        return P["g5"]
    n = h(x, y, 21)
    base = lerp("g4", "gr4", 0.25)
    if n < 0.1:
        return P["g5"]
    return base


# ---------------------------------------------------------------------------
# Tile drawers
# ---------------------------------------------------------------------------
def t_fill(fn):
    def f():
        cv = tile()
        fill_fn(cv, fn)
        return cv
    return f


def sidewalk(edge=None):
    def f():
        cv = tile()
        fill_fn(cv, concrete)
        # walking surface band (top 5 rows), slab joints every 8px
        cv.hline(0, 0, 16, "w")
        cv.rect(0, 1, 16, 3, "g0")
        for x in range(16):
            if h(x, 2, 31) < 0.15:
                cv.set(x, 2, "g1")
        cv.hline(0, 4, 16, "g1")
        cv.hline(0, 5, 16, "g4")  # curb shadow line
        cv.set(0, 1, "g1"), cv.set(0, 2, "g1"), cv.set(0, 3, "g1")
        cv.set(8, 1, "g1"), cv.set(8, 2, "g1"), cv.set(8, 3, "g1")
        if edge == "L":
            cv.vline(0, 0, 16, "ink2")
            cv.vline(1, 1, 4, "w")
            cv.vline(1, 6, 10, "g1")
            cv.set(0, 0, T)
        if edge == "R":
            cv.vline(15, 0, 16, "ink2")
            cv.vline(14, 1, 4, "g1")
            cv.vline(14, 6, 10, "g3")
            cv.set(15, 0, T)
        return cv
    return f


def concrete_cracked():
    cv = tile()
    fill_fn(cv, concrete)
    crack = [(4, 0), (4, 1), (5, 2), (5, 3), (6, 4), (6, 5), (5, 6), (6, 7), (7, 8), (8, 9), (9, 9), (10, 10),
             (11, 11), (11, 12), (12, 13), (6, 6), (3, 7), (4, 7), (2, 8), (12, 14), (13, 15)]
    for x, y in crack:
        cv.set(x, y, "g5")
        cv.set(x + 1, y, "g1") if (x + 1, y) not in crack else None
    cv.set(9, 4, "g3"), cv.set(13, 6, "g3"), cv.set(3, 12, "g3")
    return cv


def asphalt_top():
    cv = tile()
    fill_fn(cv, asphalt)
    cv.hline(0, 0, 16, "a0")
    cv.hline(0, 1, 16, "a1")
    for x in range(16):
        if h(x, 1, 41) < 0.3:
            cv.set(x, 1, "a0")
        if h(x, 2, 42) < 0.25:
            cv.set(x, 2, "a1")
    return cv


def curb():
    cv = tile()
    fill_fn(cv, asphalt)
    # concrete curb with yellow painted face
    cv.rect(0, 0, 16, 7, "g1")
    cv.hline(0, 0, 16, "w")
    cv.hline(0, 1, 16, "g0")
    cv.rect(0, 3, 16, 4, "y1")
    cv.hline(0, 3, 16, "y0")
    cv.hline(0, 6, 16, "y3")
    for x in (3, 11):
        cv.rect(x, 3, 2, 4, "g1")  # chipped paint
    cv.hline(0, 7, 16, "a3")
    cv.vline(0, 0, 7, "g3")
    return cv


def manhole():
    cv = asphalt_top()
    cv.rect(0, 0, 16, 2, "a0")
    cv.hline(0, 0, 16, "a0")
    # flush iron cover seen edge-on + its rim into the road bed
    cv.rect(2, 0, 12, 2, "g4")
    cv.hline(3, 0, 10, "g3")
    cv.rect(2, 2, 12, 3, "a3")
    cv.hline(3, 2, 10, "g5")
    for x in range(3, 13, 2):
        cv.set(x, 0, "g2")
    cv.vline(1, 0, 5, "a3"), cv.vline(14, 0, 5, "a3")
    # tiny steam wisp
    return cv


def grate():
    cv = tile()
    cv.rect(0, 0, 16, 16, "s4")
    cv.hline(0, 0, 16, "s1")
    cv.hline(0, 1, 16, "s2")
    for x in range(1, 16, 3):
        cv.rect(x, 2, 2, 13, "ink")
        cv.vline(x, 2, 13, "ink2")
    for y in (6, 11):
        cv.hline(0, y, 16, "s3")
    cv.hline(0, 15, 16, "ink")
    cv.vline(0, 0, 16, "s3")
    cv.vline(15, 0, 16, "s4")
    return cv


def planter(edge=None):
    def f():
        cv = tile()
        # concrete box body
        cv.rect(0, 6, 16, 10, "g2")
        for x in range(16):
            for y in range(8, 16):
                if h(x, y, 51) < 0.08:
                    cv.set(x, y, "g3")
        cv.hline(0, 6, 16, "g0")
        cv.hline(0, 7, 16, "g1")
        cv.hline(0, 8, 16, "g3")
        cv.hline(0, 15, 16, "g4")
        # foliage mound
        for x in range(16):
            top = 2 + int(1.5 + 1.5 * __import__("math").sin((x + 1) * 0.9)) - (1 if x % 5 == 2 else 0)
            for y in range(top, 6):
                cv.set(x, y, "gr2" if y > top + 1 else "gr1")
            cv.set(x, top, "gr0" if x % 3 else "gr1")
            cv.set(x, 5, "gr3")
        for fx, fy in ((2, 3), (7, 2), (12, 3), (10, 4), (5, 4)):
            cv.set(fx, fy, "cr")
            cv.set(fx + 1, fy, "pk") if fx < 15 else None
        cv.set(14, 2, "y1")
        if edge == "L":
            cv.vline(0, 6, 10, "g4")
            cv.vline(1, 7, 8, "g1")
            for y in range(0, 6):
                if cv.get(0, y)[3]:
                    cv.set(0, y, T if y < 4 else "gr3")
        if edge == "R":
            cv.vline(15, 6, 10, "g4")
            cv.vline(14, 8, 7, "g3")
            for y in range(0, 6):
                if cv.get(15, y)[3]:
                    cv.set(15, y, T if y < 4 else "gr3")
        return cv
    return f


def soil_top():
    cv = tile()
    fill_fn(cv, dirt)
    for x in range(16):
        top = 0 if x % 4 in (1, 2) else 1
        if x % 7 == 3:
            top = 0
        for y in range(top, 4):
            cv.set(x, y, "gr1" if y < 2 else "gr2")
        cv.set(x, top, "gr0")
        cv.set(x, 4, "gr3" if x % 3 else "gr2")
        if x % 5 == 0:
            cv.set(x, 5, "gr3")
    cv.set(5, 0, "y0")
    cv.set(12, 0, "w")
    return cv


def limestone_top():
    cv = tile()
    fill_fn(cv, limestone)
    # cornice: lip + dentils
    cv.hline(0, 0, 16, "w")
    cv.rect(0, 1, 16, 2, "l0")
    cv.hline(0, 3, 16, "l2")
    cv.hline(0, 4, 16, "l4")
    for x in range(0, 16, 4):
        cv.rect(x + 1, 5, 2, 2, "l1")
        cv.set(x + 1, 5, "l0")
        cv.rect(x + 3, 5, 2, 2, "l3")
        cv.set(x, 5, "l3"), cv.set(x, 6, "l3")
    cv.hline(0, 7, 16, "l3")
    return cv


def limestone_window():
    cv = tile()
    fill_fn(cv, limestone)
    cv.rect(3, 2, 10, 11, "l3")  # reveal
    cv.rect(4, 3, 8, 9, "gl3")
    cv.rect(4, 3, 8, 4, "gl2")
    cv.vline(8, 3, 9, "l1")
    cv.hline(4, 7, 8, "l1")
    cv.set(5, 4, "gl0"), cv.set(5, 5, "gl1"), cv.set(9, 4, "gl1")
    cv.rect(2, 12, 12, 2, "l0")  # sill
    cv.hline(2, 13, 12, "l2")
    cv.hline(3, 14, 10, "l3")
    cv.hline(3, 1, 10, "l0")
    return cv


def limestone_arch():
    cv = tile()
    fill_fn(cv, limestone)
    # arch window: round head
    shape = []
    for y in range(2, 15):
        for x in range(3, 13):
            if y < 7:
                if (x - 7.5) ** 2 + (y - 7) ** 2 <= 4.6 ** 2:
                    shape.append((x, y))
            else:
                shape.append((x, y))
    for x, y in shape:
        cv.set(x, y, "l3")
    for x, y in shape:
        if 4 <= x <= 11 and (y >= 7 or (x - 7.5) ** 2 + (y - 7) ** 2 <= 3.6 ** 2) and y < 14:
            cv.set(x, y, "y2" if y < 9 else "y3")
    cv.vline(7, 4, 10, "l2"), cv.vline(8, 4, 10, "l2")
    cv.set(5, 6, "y0"), cv.set(5, 7, "y1"), cv.set(10, 7, "y1")
    cv.rect(2, 14, 12, 2, "l0")
    cv.hline(2, 15, 12, "l3")
    cv.set(7, 1, "l0"), cv.set(8, 1, "l0")  # keystone
    cv.set(7, 2, "l1"), cv.set(8, 2, "l1")
    return cv


def brick_top():
    cv = tile()
    fill_fn(cv, brick)
    cv.rect(0, 0, 16, 4, "l1")
    cv.hline(0, 0, 16, "w")
    cv.hline(0, 1, 16, "l0")
    cv.hline(0, 3, 16, "l3")
    cv.hline(0, 4, 16, "b3")
    cv.set(7, 2, "l2"), cv.set(15, 2, "l2")
    return cv


def brick_window():
    cv = tile()
    fill_fn(cv, brick)
    cv.rect(3, 1, 10, 2, "l1")  # lintel
    cv.hline(3, 1, 10, "l0")
    cv.rect(4, 3, 8, 9, "ink2")
    cv.rect(5, 4, 6, 7, "gl3")
    cv.rect(5, 4, 6, 3, "gl2")
    cv.hline(5, 7, 6, "ink2")
    cv.set(6, 5, "gl0"), cv.set(6, 4, "gl1"), cv.set(9, 8, "gl2")
    cv.rect(3, 12, 10, 2, "l1")
    cv.hline(3, 12, 10, "l0")
    cv.hline(4, 14, 8, "b3")
    return cv


def glass_frame():
    cv = tile()
    fill_fn(cv, glass)
    cv.rect(0, 0, 16, 2, "ink2")
    cv.rect(0, 0, 2, 16, "ink2")
    cv.vline(8, 0, 16, "ink2")
    cv.hline(0, 0, 16, "g5")
    cv.vline(0, 0, 16, "g5")
    cv.vline(9, 2, 14, "gl4")
    return cv


def roof_top(edge=None):
    def f():
        cv = tile()
        fill_fn(cv, roof)
        # parapet coping (sheet metal)
        cv.hline(0, 0, 16, "s0")
        cv.rect(0, 1, 16, 2, "s1")
        cv.hline(0, 3, 16, "s3")
        cv.hline(0, 4, 16, "ink2")
        for x in range(0, 16, 8):
            cv.vline(x + 4, 1, 3, "s2")
        if edge == "L":
            cv.vline(0, 0, 16, "ink2")
            cv.vline(1, 1, 3, "s0")
            cv.vline(1, 5, 11, "g3")
            cv.set(0, 0, T)
        if edge == "R":
            cv.vline(15, 0, 16, "ink2")
            cv.vline(14, 5, 11, "g5")
            cv.set(15, 0, T)
        return cv
    return f


def awning(edge=None):
    def f():
        cv = tile()
        # top rod + striped canvas sloping slightly, scalloped bottom
        for x in range(16):
            stripe = "cr" if (x // 4) % 2 == 0 else "w"
            shade = "cr2" if stripe == "cr" else "g0"
            for y in range(2, 11):
                cv.set(x, y, stripe if y < 8 else shade)
            # scallop
            if x % 4 in (1, 2):
                cv.set(x, 11, shade)
                cv.set(x, 12, "cr3" if stripe == "cr" else "g2")
            else:
                cv.set(x, 11, "cr3" if stripe == "cr" else "g2")
        cv.hline(0, 0, 16, "ink2")
        cv.hline(0, 1, 16, "g3")
        cv.hline(0, 0, 16, "s1")
        cv.hline(0, 2, 16, "cr3")
        for x in range(16):
            if (x // 4) % 2 == 1:
                cv.set(x, 2, "g2")
        if edge == "L":
            cv.vline(0, 0, 13, "ink2")
            cv.vline(1, 2, 9, "cr3")
            cv.set(0, 0, "s2")
        if edge == "R":
            cv.vline(15, 0, 13, "ink2")
            cv.vline(14, 2, 9, "g2" if (14 // 4) % 2 else "cr3")
            cv.set(15, 0, "s2")
        return cv
    return f


def girder_top():
    cv = tile()
    fill_fn(cv, girder_body)
    cv.hline(0, 0, 16, "r0")
    cv.rect(0, 1, 16, 2, "r1")
    cv.hline(0, 3, 16, "r3")
    cv.hline(0, 4, 16, "r4")
    for x in (3, 11):
        cv.set(x, 1, "r0"), cv.set(x, 2, "r3")
    return cv


def girder_x():
    cv = tile()
    # open lattice: frame + X brace, transparent holes
    for i in range(16):
        for d in (0, 1):
            cv.set(i, min(15, i + d), "r2")
            cv.set(15 - i, min(15, i + d), "r2")
    for i in range(16):
        cv.set(i, i, "r1")
        cv.set(15 - i, i, "r1")
    cv.rect(0, 0, 16, 2, "r2")
    cv.hline(0, 0, 16, "r1")
    cv.rect(0, 14, 16, 2, "r3")
    cv.hline(0, 14, 16, "r2")
    cv.rect(0, 0, 2, 16, "r2")
    cv.vline(0, 0, 16, "r1")
    cv.rect(14, 0, 2, 16, "r3")
    cv.vline(14, 0, 16, "r2")
    cv.rect(6, 6, 4, 4, "r2")
    cv.set(7, 7, "r0"), cv.set(8, 8, "r3")
    for x, y in ((1, 1), (14, 1), (1, 14), (14, 14)):
        cv.set(x, y, "r0")
    return cv


def girder_post():
    cv = tile()
    cv.rect(3, 0, 10, 16, "r2")
    cv.vline(3, 0, 16, "r4")
    cv.vline(4, 0, 16, "r1")
    cv.vline(5, 0, 16, "r0")
    cv.vline(11, 0, 16, "r3")
    cv.vline(12, 0, 16, "r4")
    cv.vline(8, 0, 16, "r3")
    for y in (3, 11):
        cv.set(6, y, "r0"), cv.set(6, y + 1, "r4")
        cv.set(10, y, "r0"), cv.set(10, y + 1, "r4")
    return cv


def rail_tie():
    cv = tile()
    fill_fn(cv, girder_body)
    # wooden ties on top flange
    cv.rect(0, 0, 16, 6, T)
    for x0 in (0, 8):
        cv.rect(x0 + 1, 1, 6, 5, "wd2")
        cv.hline(x0 + 1, 1, 6, "wd1")
        cv.vline(x0 + 6, 2, 4, "wd3")
        cv.set(x0 + 3, 3, "wd3")
        cv.rect(x0, 1, 1, 5, "ink2")
        cv.set(x0 + 7, 1, "ink2"), cv.vline(x0 + 7, 1, 5, "ink2")
    cv.hline(0, 0, 16, "wd1")
    cv.hline(0, 6, 16, "r1")
    cv.hline(0, 7, 16, "r3")
    return cv


def rail():
    cv = rail_tie()
    # steel running rail on the ties
    cv.rect(0, 0, 16, 1, T)
    cv.hline(0, 0, 16, "s0")
    cv.hline(0, 1, 16, "s1")
    cv.hline(0, 2, 16, "s3")
    for x0 in (2, 10):
        cv.rect(x0, 3, 3, 1, "s4")  # tie plates
    return cv


def rivet_plate():
    cv = tile()
    cv.rect(0, 0, 16, 16, "s2")
    cv.hline(0, 0, 16, "s0")
    cv.vline(0, 0, 16, "s1")
    cv.hline(0, 15, 16, "s4")
    cv.vline(15, 0, 16, "s4")
    cv.hline(1, 1, 14, "s1")
    for x, y in ((3, 3), (12, 3), (3, 12), (12, 12)):
        cv.set(x, y, "s0"), cv.set(x + 1, y + 1, "s4"), cv.set(x + 1, y, "s1"), cv.set(x, y + 1, "s3")
    cv.line(5, 10, 10, 5, "s1")
    cv.line(6, 10, 10, 6, "s3")
    return cv


def scaffold_plank():
    cv = tile()
    cv.rect(0, 0, 16, 5, "wd1")
    cv.hline(0, 0, 16, "wd0")
    cv.hline(0, 4, 16, "wd3")
    cv.hline(2, 2, 5, "wd2"), cv.hline(10, 3, 4, "wd2")
    cv.vline(15, 0, 5, "wd3")
    # pipe ledger underneath
    cv.hline(0, 5, 16, "s3")
    cv.hline(0, 6, 16, "s2")
    cv.hline(0, 7, 16, "s4")
    cv.rect(6, 4, 3, 4, "s1")  # clamp
    cv.set(7, 5, "s4")
    return cv


def scaffold_frame():
    cv = tile()
    # vertical standards at x=1..2 and 13..14, diagonal brace, ledger at top
    for x in (1, 13):
        cv.vline(x, 0, 16, "s1")
        cv.vline(x + 1, 0, 16, "s3")
    cv.line(3, 14, 12, 2, "y2")
    cv.line(3, 15, 12, 3, "y3")
    cv.hline(0, 0, 16, "s1")
    cv.hline(0, 1, 16, "s3")
    cv.rect(0, 0, 4, 3, "s2"), cv.rect(12, 0, 4, 3, "s2")
    cv.hline(0, 0, 4, "s0"), cv.hline(12, 0, 4, "s0")
    return cv


def steel_block():
    cv = tile()
    cv.rect(0, 0, 16, 16, "s3")
    cv.rect(1, 1, 14, 14, "s2")
    cv.hline(1, 1, 14, "s0")
    cv.vline(1, 1, 14, "s1")
    cv.hline(1, 14, 14, "s4")
    cv.vline(14, 1, 14, "s4")
    cv.rect(4, 4, 8, 8, "s3")
    cv.rect(5, 5, 6, 6, "s2")
    cv.hline(4, 4, 8, "s4"), cv.vline(4, 4, 8, "s4")
    cv.hline(5, 11, 7, "s1"), cv.vline(11, 5, 7, "s1")
    cv.frame(0, 0, 16, 16, "ink2")
    for x, y in ((2, 2), (13, 2), (2, 13), (13, 13)):
        cv.set(x, y, "s0")
    return cv


def warning_stripe():
    cv = tile()
    for y in range(16):
        for x in range(16):
            cv.set(x, y, "y1" if ((x + y) // 4) % 2 == 0 else "ink2")
    cv.hline(0, 0, 16, "y0")
    for x in range(16):
        if ((x + 0) // 4) % 2:
            cv.set(x, 0, "g5")
    cv.hline(0, 15, 16, "ink")
    return cv


def electric_rail():
    cv = tile()
    # protective board + steel third rail (bottom), crackling arcs above
    cv.rect(0, 9, 16, 3, "s1")
    cv.hline(0, 9, 16, "s0")
    cv.hline(0, 11, 16, "s3")
    cv.rect(0, 12, 16, 4, "y2")
    cv.hline(0, 12, 16, "y0")
    cv.hline(0, 15, 16, "y4")
    for x in range(0, 16, 4):
        cv.rect(x, 13, 2, 2, "ink2")
    # arcs
    bolt = [(1, 8), (2, 7), (3, 6), (3, 5), (4, 4), (5, 5), (6, 6), (7, 5), (8, 3), (9, 4), (10, 6), (11, 5),
            (12, 4), (13, 5), (14, 7), (15, 8), (0, 8)]
    for x, y in bolt:
        cv.set(x, y, "w")
        if y + 1 < 9:
            cv.set(x, y + 1, "cyan")
        if y - 1 >= 0:
            cv.set(x, y - 1, "cb3")
    for x, y in ((5, 2), (11, 1), (13, 2), (2, 3)):
        cv.set(x, y, "cyan")
    return cv


def spikes():
    cv = tile()
    # two big steel spikes per tile on a dark base plate (reads as danger)
    for x0 in (0, 8):
        for y in range(2, 13):
            hw = (y - 2) * 4 / 10.0  # half width grows to 4
            for x in range(16):
                xc = x0 + 3.5
                if abs(x - xc) <= hw + 0.01 and x0 <= x < x0 + 8:
                    cv.set(x, y, "s0" if x < xc - 0.6 else ("s2" if x < xc + 0.6 else "s3"))
        cv.set(x0 + 3, 1, "w")
        cv.set(x0 + 3, 2, "w"), cv.set(x0 + 4, 2, "s1")
    cv.outline("ink")
    cv.rect(0, 12, 16, 4, "g4")
    cv.hline(0, 12, 16, "cr2")
    cv.hline(0, 13, 16, "g3")
    cv.hline(0, 15, 16, "ink")
    for x in (3, 11):
        cv.set(x, 14, "g2")
    return cv


def chain_fence():
    cv = tile()
    for y in range(16):
        for x in range(16):
            if (x + y) % 4 == 0 or (x - y) % 4 == 0:
                cv.set(x, y, "s2" if (x + y) % 8 < 4 else "s1")
    return cv


def vent():
    cv = tile()
    cv.rect(0, 0, 16, 16, "s2")
    cv.frame(0, 0, 16, 16, "s4")
    cv.hline(0, 0, 16, "s0")
    cv.vline(0, 0, 16, "s1")
    for y in range(3, 14, 3):
        cv.hline(2, y, 12, "ink2")
        cv.hline(2, y + 1, 12, "s1")
    cv.vline(2, 2, 13, "s3"), cv.vline(13, 2, 13, "s3")
    return cv


def pipe_h():
    cv = tile()
    cv.hline(0, 4, 16, "ink2")
    cv.hline(0, 5, 16, "s0")
    cv.rect(0, 6, 16, 3, "s1")
    cv.rect(0, 9, 16, 2, "s2")
    cv.hline(0, 11, 16, "ink2")
    cv.hline(0, 10, 16, "s3")
    # flange
    cv.rect(10, 3, 3, 10, "s2")
    cv.vline(10, 3, 10, "s0")
    cv.vline(12, 3, 10, "s3")
    cv.hline(10, 3, 3, "ink2"), cv.hline(10, 12, 3, "ink2")
    cv.set(11, 4, "s0"), cv.set(11, 11, "s4")
    return cv


def riverwalk_top():
    cv = tile()
    fill_fn(cv, riverwalk_body)
    cv.hline(0, 0, 16, "w")
    cv.rect(0, 1, 16, 3, lerp("g0", "l0", 0.5))
    for x in (0, 8):
        cv.vline(x, 1, 3, "g1")
    cv.hline(0, 4, 16, lerp("g2", "l3", 0.4))
    cv.hline(0, 5, 16, "g3")
    return cv


def wood_plank():
    cv = tile()
    cv.rect(0, 0, 16, 6, "wd1")
    cv.hline(0, 0, 16, "wd0")
    cv.hline(0, 1, 16, "wd0")
    for x in (0, 5, 11):
        cv.vline(x, 0, 6, "wd3")
    cv.set(3, 3, "wd2"), cv.set(8, 2, "wd2"), cv.set(13, 4, "wd2"), cv.set(9, 3, "wd2")
    cv.hline(0, 5, 16, "wd2")
    cv.hline(0, 6, 16, "wd4")
    # stringer beam below
    cv.rect(0, 7, 16, 3, "wd3")
    cv.hline(0, 7, 16, "wd2")
    cv.hline(0, 9, 16, "wd4")
    cv.set(4, 8, "s2"), cv.set(12, 8, "s2")
    return cv


def wood_post():
    cv = tile()
    cv.rect(4, 0, 8, 16, "wd2")
    cv.vline(4, 0, 16, "wd4")
    cv.vline(5, 0, 16, "wd1")
    cv.vline(6, 0, 16, "wd0")
    cv.vline(10, 0, 16, "wd3")
    cv.vline(11, 0, 16, "wd4")
    for y in (3, 10):
        cv.hline(5, y, 6, "wd3")
    cv.set(8, 6, "wd3"), cv.set(8, 7, "wd3"), cv.set(7, 13, "wd3")
    return cv


def bridge_deck():
    cv = tile()
    # road surface + steel side girder (painted dark slate green-grey like many river bridges)
    cv.rect(0, 0, 16, 3, "a1")
    cv.hline(0, 0, 16, "a0")
    cv.hline(0, 3, 16, "ink2")
    sg = [lerp("s1", "gr2", 0.25), lerp("s2", "gr3", 0.3), lerp("s3", "gr3", 0.35), lerp("s4", "gr4", 0.3)]
    cv.rect(0, 4, 16, 12, sg[2])
    cv.hline(0, 4, 16, sg[0])
    cv.hline(0, 5, 16, sg[1])
    cv.hline(0, 14, 16, sg[1])
    cv.hline(0, 15, 16, sg[3])
    for x in range(1, 16, 4):
        cv.set(x, 7, sg[0]), cv.set(x, 12, sg[0])
        cv.set(x, 8, sg[3]), cv.set(x, 13, sg[3])
    cv.vline(0, 6, 8, sg[3])
    cv.vline(8, 6, 8, sg[3])
    cv.vline(9, 6, 8, sg[1])
    return cv


def bridge_truss():
    cv = tile()
    sg = [lerp("s1", "gr2", 0.25), lerp("s2", "gr3", 0.3), lerp("s3", "gr3", 0.35), lerp("s4", "gr4", 0.3)]
    cv.rect(0, 0, 16, 2, sg[1])
    cv.hline(0, 0, 16, sg[0])
    cv.rect(0, 14, 16, 2, sg[2])
    cv.hline(0, 15, 16, sg[3])
    cv.rect(0, 0, 2, 16, sg[1])
    cv.vline(0, 0, 16, sg[0])
    for i in range(2, 14):
        cv.set(i, i, sg[1])
        cv.set(i + 1, i, sg[2])
    for y in (5, 10):
        cv.set(0, y, sg[3]), cv.set(1, y, sg[0])
    return cv


def bridge_rail():
    cv = tile()
    # ornamental bridge railing on the deck
    cv.hline(0, 3, 16, "s3")
    cv.hline(0, 2, 16, lerp("s1", "gr2", 0.3))
    cv.hline(0, 4, 16, "ink2")
    cv.hline(0, 13, 16, "s3")
    cv.hline(0, 14, 16, "ink2")
    cv.hline(0, 15, 16, "s4")
    for x in range(1, 16, 4):
        cv.vline(x, 5, 8, lerp("s2", "gr3", 0.3))
        cv.vline(x + 1, 5, 8, "ink2")
    for x in range(3, 16, 4):
        cv.set(x, 8, "s2"), cv.set(x + 1, 9, "s2"), cv.set(x, 9, "s3")
    cv.vline(0, 0, 16, "s4")
    cv.rect(0, 0, 2, 16, lerp("s2", "gr3", 0.3))
    cv.vline(0, 0, 16, "ink2")
    cv.rect(0, 0, 3, 2, "s1")
    return cv


def water_top():
    cv = tile()
    fill_fn(cv, water)
    for x in range(16):
        top = 2 + (1 if x % 8 in (4, 5, 6, 7) else 0) - (1 if x % 8 in (1, 2) else 0)
        for y in range(0, top):
            cv.set(x, y, T)
        cv.set(x, top, "t0")
        cv.set(x, top + 1, "t1")
        cv.set(x, top + 2, "t2")
    return cv


def stone_wall_top():
    cv = tile()
    fill_fn(cv, stone)
    cv.rect(0, 0, 16, 4, "g1")
    cv.hline(0, 0, 16, "w")
    cv.hline(0, 1, 16, "g0")
    cv.hline(0, 3, 16, "g3")
    cv.hline(0, 4, 16, "s4")
    cv.vline(10, 1, 3, "g2")
    return cv


def lower_wacker_tile():
    cv = tile()
    fill_fn(cv, lower_wacker)
    # sodium lamp strip and a painted line
    cv.rect(3, 3, 10, 3, "ink2")
    cv.rect(4, 4, 8, 1, "y1")
    cv.hline(4, 4, 8, "y0")
    for x in range(2, 14):
        cv.set(x, 6, lerp("g4", "y2", 0.35))
    for x in range(4, 12):
        cv.set(x, 7, lerp("g4", "y2", 0.2))
    cv.hline(0, 12, 16, "y3")
    return cv


def pillar():
    cv = tile()
    cv.rect(2, 0, 12, 16, "l1")
    cv.vline(2, 0, 16, "l3")
    cv.vline(3, 0, 16, "l0")
    for x in (5, 8, 11):
        cv.vline(x, 0, 16, "l2")
        cv.vline(x + 1, 0, 16, "l0") if x < 11 else None
    cv.vline(12, 0, 16, "l2")
    cv.vline(13, 0, 16, "l4")
    return cv


def pillar_cap():
    cv = pillar()
    cv.rect(0, 0, 16, 7, "l1")
    cv.hline(0, 0, 16, "w")
    cv.hline(0, 1, 16, "l0")
    cv.hline(0, 3, 16, "l3")
    cv.rect(1, 4, 14, 2, "l1")
    cv.hline(1, 4, 14, "l0")
    cv.hline(1, 6, 14, "l3")
    cv.hline(2, 7, 12, "l4")
    for x in (0, 15):
        cv.vline(x, 0, 4, "l3")
    cv.vline(0, 0, 3, "l2")
    # scroll volutes
    cv.set(2, 5, "l3"), cv.set(13, 5, "l3")
    return cv


def railing():
    cv = tile()
    cv.hline(0, 3, 16, "ink2")
    cv.hline(0, 2, 16, "g4")
    cv.hline(0, 4, 16, "ink")
    cv.hline(0, 13, 16, "ink2")
    for x in range(1, 16, 3):
        cv.vline(x, 4, 12, "ink2")
    cv.hline(0, 15, 16, "g5")
    for x in range(1, 16, 3):
        cv.set(x, 2, "g3")
    return cv


def bush():
    import math
    cv = tile()
    for y in range(16):
        for x in range(16):
            dx, dy = (x - 7.5) / 7.6, (y - 10.5) / 6.0
            r = dx * dx + dy * dy
            bump = 0.15 * math.sin(x * 1.7) * (1 if y < 9 else 0)
            if r <= 1.0 + bump:
                n = h(x, y, 63)
                if dx + dy < -0.6:
                    col = "gr0"
                elif dx + dy < 0.0:
                    col = "gr1"
                elif dx + dy < 0.8:
                    col = "gr2"
                else:
                    col = "gr3"
                if n < 0.12 and col != "gr3":
                    col = "gr2"
                cv.set(x, y, col)
    cv.outline("gr4")
    cv.set(5, 7, "cr"), cv.set(10, 9, "cr"), cv.set(7, 12, "pk")
    cv.hline(0, 15, 16, "gr4")
    return cv


TILES = {
    # Row 0
    "SIDEWALK_L": sidewalk("L"),
    "SIDEWALK": sidewalk(),
    "SIDEWALK_R": sidewalk("R"),
    "CONCRETE": t_fill(concrete),
    "CONCRETE_CRACKED": concrete_cracked,
    "ASPHALT_TOP": asphalt_top,
    "ASPHALT": t_fill(asphalt),
    "CURB": curb,
    "MANHOLE": manhole,
    "GRATE": grate,
    "PLANTER_L": planter("L"),
    "PLANTER": planter(),
    "PLANTER_R": planter("R"),
    "DIRT": t_fill(dirt),
    "SOIL_TOP": soil_top,
    "SUBWAY_TILE": t_fill(subway),
    # Row 1
    "LIMESTONE_TOP": limestone_top,
    "LIMESTONE": t_fill(limestone),
    "LIMESTONE_WINDOW": limestone_window,
    "LIMESTONE_ARCH": limestone_arch,
    "BRICK_TOP": brick_top,
    "BRICK": t_fill(brick),
    "BRICK_WINDOW": brick_window,
    "GLASS": t_fill(glass),
    "GLASS_FRAME": glass_frame,
    "ROOF_TOP": roof_top(),
    "ROOF": t_fill(roof),
    "ROOF_EDGE_L": roof_top("L"),
    "ROOF_EDGE_R": roof_top("R"),
    "AWNING_L": awning("L"),
    "AWNING": awning(),
    "AWNING_R": awning("R"),
    # Row 2
    "GIRDER_TOP": girder_top,
    "GIRDER": t_fill(girder_body),
    "GIRDER_X": girder_x,
    "GIRDER_POST": girder_post,
    "RAIL_TIE": rail_tie,
    "RAIL": rail,
    "RIVET_PLATE": rivet_plate,
    "SCAFFOLD_PLANK": scaffold_plank,
    "SCAFFOLD_FRAME": scaffold_frame,
    "STEEL_BLOCK": steel_block,
    "WARNING_STRIPE": warning_stripe,
    "ELECTRIC_RAIL": electric_rail,
    "SPIKES": spikes,
    "CHAIN_FENCE": chain_fence,
    "VENT": vent,
    "PIPE_H": pipe_h,
    # Row 3
    "RIVERWALK_TOP": riverwalk_top,
    "RIVERWALK": t_fill(riverwalk_body),
    "WOOD_PLANK": wood_plank,
    "WOOD_POST": wood_post,
    "BRIDGE_DECK": bridge_deck,
    "BRIDGE_TRUSS": bridge_truss,
    "BRIDGE_RAIL": bridge_rail,
    "WATER_TOP": water_top,
    "WATER": t_fill(water),
    "STONE_WALL": t_fill(stone),
    "STONE_WALL_TOP": stone_wall_top,
    "LOWER_WACKER": lower_wacker_tile,
    "PILLAR": pillar,
    "PILLAR_CAP": pillar_cap,
    "RAILING": railing,
    "BUSH": bush,
}


def contract_order():
    src = open(os.path.join(ROOT, "src/game/data/tiles.ts")).read()
    body = src[src.index("export const TILE = {"):]
    body = body[: body.index("} as const")]
    pairs = re.findall(r"^\s+([A-Z_0-9]+):\s*(\d+),", body, re.M)
    return {name: int(i) for name, i in pairs}


def build():
    order = contract_order()
    TILES.update(terrain_tiles())
    TILES.update(terrain_tiles_w2())
    assert set(order) == set(TILES), (set(order) ^ set(TILES))
    rows = (max(order.values()) + 16) // 16
    sheet = Image.new("RGBA", (256, rows * 16), (0, 0, 0, 0))
    ims = {}
    for name, idx in order.items():
        im = TILES[name]().im
        ims[idx] = im
        sheet.paste(im, ((idx % 16) * 16, (idx // 16) * 16))
    out = os.path.join(ASSETS, "tilesets", "chicago-tiles.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sheet.save(out)
    return sheet, ims, order


def demo(ims, order):
    """Compose a sample scene to check seams."""
    W, H = 30, 17
    bg = Image.open(os.path.join(ASSETS, "backgrounds", "bg-day-sky.png")).convert("RGBA") \
        if os.path.exists(os.path.join(ASSETS, "backgrounds", "bg-day-sky.png")) else Image.new("RGBA", (480, 270), (140, 200, 240, 255))
    for layer in ("far", "mid", "near"):
        p = os.path.join(ASSETS, "backgrounds", f"bg-day-{layer}.png")
        if os.path.exists(p):
            bg.alpha_composite(Image.open(p).convert("RGBA").crop((0, 0, 480, 270)))
    scene = bg.copy()
    grid = [[None] * W for _ in range(H)]
    O = order

    def put(x, y, name):
        grid[y][x] = O[name]

    # street ground
    for x in range(0, 12):
        put(x, 14, "SIDEWALK" if 0 < x < 11 else ("SIDEWALK_L" if x == 0 else "SIDEWALK_R"))
        put(x, 15, "CONCRETE_CRACKED" if x == 5 else "CONCRETE")
        put(x, 16, "CONCRETE")
    for x in range(12, 18):
        put(x, 14, "ASPHALT_TOP" if x != 14 else "MANHOLE")
        put(x, 15, "ASPHALT")
        put(x, 16, "ASPHALT")
    put(12, 14, "CURB")
    # river
    for x in range(18, 30):
        put(x, 15, "WATER_TOP")
        put(x, 16, "WATER")
    for x in range(18, 22):
        put(x, 13, "RIVERWALK_TOP")
        put(x, 14, "RIVERWALK")
        put(x, 15, "STONE_WALL_TOP" if x == 18 else "RIVERWALK")
        put(x, 16, "STONE_WALL")
    for x in range(24, 30):
        put(x, 10, "BRIDGE_RAIL")
        put(x, 11, "BRIDGE_DECK")
    put(24, 12, "BRIDGE_TRUSS"), put(25, 12, "BRIDGE_TRUSS")
    put(27, 13, "WOOD_PLANK"), put(28, 13, "WOOD_PLANK")
    put(27, 14, "WOOD_POST")
    # brick building
    for y in range(6, 14):
        for x in range(1, 6):
            if y == 6:
                put(x, y, "BRICK_TOP")
            elif (y in (8, 11)) and x in (2, 4):
                put(x, y, "BRICK_WINDOW")
            else:
                put(x, y, "BRICK")
    for x in range(1, 6):
        put(x, 5, "ROOF_EDGE_L" if x == 1 else "ROOF_EDGE_R" if x == 5 else "ROOF_TOP")
    # awning + planters
    put(7, 11, "AWNING_L"), put(8, 11, "AWNING"), put(9, 11, "AWNING_R")
    put(7, 13, "PLANTER_L"), put(8, 13, "PLANTER"), put(9, 13, "PLANTER_R")
    put(10, 13, "BUSH")
    # limestone tower
    for y in range(4, 14):
        for x in range(13, 17):
            if y == 4:
                put(x, y, "LIMESTONE_TOP")
            elif y == 6 and x in (14, 15):
                put(x, y, "LIMESTONE_ARCH")
            elif y == 9 and x in (14, 15):
                put(x, y, "LIMESTONE_WINDOW")
            else:
                put(x, y, "LIMESTONE")
    put(13, 13, "PILLAR"), put(16, 13, "PILLAR"), put(13, 12, "PILLAR_CAP"), put(16, 12, "PILLAR_CAP")
    # L structure
    for x in range(6, 12):
        put(x, 3, "RAIL" if x % 2 else "RAIL_TIE")
        put(x, 4, "GIRDER")
    put(6, 5, "GIRDER_X"), put(11, 5, "GIRDER_X")
    put(6, 6, "GIRDER_POST"), put(11, 6, "GIRDER_POST")
    put(6, 7, "GIRDER_POST"), put(11, 7, "GIRDER_POST")
    for x in range(18, 22):
        put(x, 6, "GIRDER_TOP")
    put(19, 7, "GIRDER"), put(20, 7, "GIRDER")
    # glass + misc row
    for y in range(1, 4):
        for x in range(23, 27):
            put(x, y, "GLASS_FRAME" if y == 1 else "GLASS")
    misc = ["STEEL_BLOCK", "WARNING_STRIPE", "RIVET_PLATE", "VENT", "GRATE", "SUBWAY_TILE", "LOWER_WACKER", "CHAIN_FENCE"]
    for i, n in enumerate(misc):
        put(18 + i, 3 if i < 4 else 4, n) if False else put(17 + i, 9, n)
    put(13, 3, "SPIKES"), put(14, 3, "SPIKES"), put(15, 3, "ELECTRIC_RAIL"), put(16, 3, "ELECTRIC_RAIL")
    put(0, 3, "SCAFFOLD_PLANK"), put(1, 3, "SCAFFOLD_PLANK"), put(0, 4, "SCAFFOLD_FRAME"), put(1, 4, "SCAFFOLD_FRAME")
    put(26, 6, "PIPE_H"), put(27, 6, "PIPE_H"), put(28, 6, "PIPE_H")
    put(26, 7, "RAILING"), put(27, 7, "RAILING")
    put(28, 2, "SOIL_TOP"), put(29, 2, "SOIL_TOP"), put(28, 3, "DIRT"), put(29, 3, "DIRT")
    put(27, 4, "STONE_WALL_TOP"), put(28, 4, "STONE_WALL_TOP"), put(27, 5, "STONE_WALL"), put(28, 5, "STONE_WALL")
    put(2, 1, "ROOF"), put(3, 1, "ROOF"), put(2, 2, "ROOF"), put(3, 2, "ROOF")
    put(20, 1, "GLASS"), put(21, 1, "GLASS")
    for y in range(H):
        for x in range(W):
            if grid[y][x] is not None:
                scene.alpha_composite(ims[grid[y][x]], (x * 16, y * 16))
    scene = scene.crop((0, 0, 480, 270))
    os.makedirs(PREVIEWS, exist_ok=True)
    scaled(scene, 3).save(os.path.join(PREVIEWS, "tiles-demo.png"))
    scene.save(os.path.join(PREVIEWS, "tiles-demo-1x.png"))


def preview_sheet(sheet, order):
    from pxl import draw_text
    s = 4
    names = {v: k for k, v in order.items()}
    rows = sheet.height // 16
    big = Image.new("RGBA", (16 * (16 * s + 4), rows * (16 * s + 14)), (54, 60, 84, 255))
    cv = Cv(big.width, big.height)
    cv.im = big
    for idx in sorted(names):
        x0 = (idx % 16) * (16 * s + 4) + 2
        y0 = (idx // 16) * (16 * s + 14) + 2
        t = sheet.crop(((idx % 16) * 16, (idx // 16) * 16, (idx % 16) * 16 + 16, (idx // 16) * 16 + 16))
        big.alpha_composite(Image.new("RGBA", (16 * s, 16 * s), (90, 98, 128, 255)), (x0, y0))
        big.alpha_composite(scaled(t, s), (x0, y0))
        cv.px = big.load()
        draw_text(cv, x0, y0 + 16 * s + 3, f"{idx} " + names[idx][:12].replace("_", "-"), (255, 255, 255, 255))
    big.save(os.path.join(PREVIEWS, "tiles-sheet.png"))
    # 3x3 self-tiling check of each fill tile
    fills = ["CONCRETE", "ASPHALT", "DIRT", "SUBWAY_TILE", "LIMESTONE", "BRICK", "GLASS", "ROOF", "GIRDER",
             "CHAIN_FENCE", "RIVERWALK", "WATER", "STONE_WALL", "LOWER_WACKER", "GIRDER_POST", "PILLAR"]
    tops = {"CONCRETE": "SIDEWALK", "ASPHALT": "ASPHALT_TOP", "DIRT": "SOIL_TOP", "LIMESTONE": "LIMESTONE_TOP",
            "BRICK": "BRICK_TOP", "ROOF": "ROOF_TOP", "GIRDER": "GIRDER_TOP", "RIVERWALK": "RIVERWALK_TOP",
            "WATER": "WATER_TOP", "STONE_WALL": "STONE_WALL_TOP", "PILLAR": "PILLAR_CAP"}
    out = Image.new("RGBA", (len(fills) * 52, 68), (54, 60, 84, 255))
    for i, n in enumerate(fills):
        t = TILES[n]().im
        top = TILES[tops[n]]().im if n in tops else t
        for yy in range(4):
            for xx in range(3):
                out.alpha_composite(top if yy == 0 else t, (i * 52 + xx * 16, yy * 16 + 2))
    scaled(out, 2).save(os.path.join(PREVIEWS, "tiles-seams.png"))


if __name__ == "__main__":
    sheet, ims, order = build()
    preview_sheet(sheet, order)
    demo(ims, order)
    print("tiles ok")
