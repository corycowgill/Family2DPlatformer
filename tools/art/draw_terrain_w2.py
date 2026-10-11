#!/usr/bin/env python3
"""
World 2 ("The North Side") terrain + facade tiles, appended to the Chicago tileset after
the World 1 rows (indices 608+, see src/game/data/tiles.ts).

Seven auto-tiled materials use exactly the World 1 48-slot layout (draw_terrain.SUFFIXES,
assembled by draw_terrain.assemble), so tools/levels/autotile.mjs handles them unchanged:

  GRASS  park lawn (blade fringe, daisies / tulips / clover) over dark loam with roots
  PATH   park paths: rose-tan clay pavers with a granite edge over a crushed-gravel bed
  SAND   North Avenue Beach sand (ripples, shells, footprints) over packed, wetter sand
  BOARD  boardwalk / pier: deck planks over a timber crib of pilings + cross bracing
  IVY    ballpark outfield wall: brick coping, Boston ivy over red brick
  FLAT   three-flat greystone: rock-faced Bedford limestone, carved cornice lip
  SEAT   stadium stands: concrete treads with a yellow nosing over green seat rows

Facade decor (background layer): greystone and brownstone three-flats (cornices, bay
windows, stoops, doors), neon bar signs, rooftop bleachers, the Addison L sign, zoo
signage, conservatory glasshouse, flat ivy wall, boardwalk plank / railing, scoreboard,
hedge. Light from the top-left, hard alpha, palette `P` + ramp blends.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from pxl import FONT3, FONT5, Cv, P, T, c  # noqa: E402
from draw_terrain import (  # noqa: E402
    S, SUFFIXES, VSEED, L, Mat, assemble, crack, drips, hh, speckle, text, tile, tint,
)

MATERIALS2 = ["GRASS", "PATH", "SAND", "BOARD", "IVY", "FLAT", "SEAT"]

DECOR2 = [
    # greystone three-flat (row 0)
    "GS_WALL0", "GS_WALL1", "GS_WALL2", "GS_EDGE_L", "GS_EDGE_R", "GS_CORN_L", "GS_CORN", "GS_CORN_R",
    "GS_WIN", "GS_WIN_LIT", "GS_BAY_L", "GS_BAY_R", "GS_BAYLIT_L", "GS_BAYLIT_R", "GS_DOOR", "GS_STOOP",
    # brownstone (row 1, same set, warm sandstone palette)
    "BS_WALL0", "BS_WALL1", "BS_WALL2", "BS_EDGE_L", "BS_EDGE_R", "BS_CORN_L", "BS_CORN", "BS_CORN_R",
    "BS_WIN", "BS_WIN_LIT", "BS_BAY_L", "BS_BAY_R", "BS_BAYLIT_L", "BS_BAYLIT_R", "BS_DOOR", "BS_STOOP",
    # Wrigleyville street (row 2): neon signs (2 tiles each), rooftop bleachers, Addison sign
    "NEON_BAR_L", "NEON_BAR_R", "NEON_PIZZA_L", "NEON_PIZZA_R", "NEON_DOGS_L", "NEON_DOGS_R", "NEON_TEAM_L", "NEON_TEAM_R",
    "BLEACH_TL", "BLEACH_T", "BLEACH_TR", "BLEACH_L", "BLEACH", "BLEACH_R", "SIGN_ADDISON_L", "SIGN_ADDISON_R",
    # park / lake / ballpark (row 3)
    "ZOO_SIGN_L", "ZOO_SIGN_M", "ZOO_SIGN_R", "CONS_ROOF_L", "CONS_ROOF", "CONS_ROOF_R", "CONS_GLASS", "CONS_GLASS_LIT",
    "IVYW_TOP", "IVYW_0", "IVYW_1", "BOARD_PLANK", "BOARD_RAIL", "SCORE_L", "SCORE_R", "HEDGE",
]


def all_new_names():
    return [f"{m}_{s}" for m in MATERIALS2 for s in SUFFIXES] + DECOR2


def px(cv, pts, col):
    for x, y in pts:
        cv.set(x, y, col)


# ---------------------------------------------------------------------------
# GRASS — park lawn over loam
# ---------------------------------------------------------------------------
LOAM = {"base": L("d1", "d2", 0.35), "lt": L("d0", "d1", 0.3), "dk": L("d2", "ink2", 0.35), "clod": L("d0", "wd1", 0.25)}


def grass_body(cv, v):
    s = VSEED[v] + 101
    base = LOAM["base"]
    cv.rect(0, 0, S, S, base)
    # soft horizontal soil strata
    for y in range(S):
        if y % 5 == 2:
            for x in range(S):
                if hh(x, y, s) < 0.6:
                    tint(cv, x, y, LOAM["dk"], 0.25)
    speckle(cv, s, [(0.03, LOAM["dk"]), (0.025, LOAM["lt"]), (0.008, L("g2", "d0", 0.4))])
    # clods: 2px light top / dark bottom
    for i in range(3):
        x, y = int(hh(s, i, 1) * 14), int(hh(s, i, 2) * 14)
        cv.set(x, y, LOAM["clod"]), cv.set(x + 1, y, LOAM["lt"])
        cv.set(x, y + 1, LOAM["dk"]), cv.set(x + 1, y + 1, LOAM["dk"])
    if v == "F1":  # thin root
        x = 3 + int(hh(s) * 8)
        for y in range(0, 12):
            cv.set(x, y, L("wd2", "d1", 0.3))
            if hh(s, y) < 0.3:
                x += 1 if hh(s, y, 2) < 0.5 else -1
            if y in (4, 8):
                cv.set(x + 1, y + 1, L("wd2", "d1", 0.5))
    elif v == "F2":  # buried pebble
        cv.ellipse(9.5, 9.5, 2.6, 1.8, L("g2", "d1", 0.2))
        cv.hline(8, 8, 3, L("g1", "d0", 0.2))
        cv.hline(8, 11, 3, L("g4", "d2", 0.3))
    elif v == "F3":
        for i in range(5):
            x, y = 2 + int(hh(s, i) * 12), 3 + int(hh(s, i, 7) * 10)
            cv.set(x, y, L("g1", "d0", 0.4))
    elif v == "F4":  # worm (it's a park)
        px(cv, ((4, 9), (5, 9), (6, 10), (7, 10), (8, 9)), L("pk", "d0", 0.45))
        cv.set(4, 8, L("pk", "w", 0.2))
    elif v == "F5":
        for i in range(4):
            x, y = 1 + int(hh(s, i) * 13), 2 + int(hh(s, i, 3) * 11)
            cv.rect(x, y, 2, 1, LOAM["clod"])
    elif v == "F6":
        drips(cv, s, 2, 14, 0, LOAM["dk"], 0.2, 10)
    elif v == "X2":  # big rock
        cv.ellipse(8, 9, 5.2, 3.6, L("g3", "d1", 0.25))
        cv.ellipse(7, 8, 3.8, 2.4, L("g2", "d0", 0.2))
        px(cv, ((5, 7), (6, 6), (7, 6)), L("g1", "l1", 0.2))
        cv.hline(4, 12, 9, L("g4", "d2", 0.4))
    elif v == "X3":  # root tangle
        for (x0, y0, x1, y1) in ((1, 2, 7, 9), (7, 9, 14, 6), (7, 9, 9, 15), (4, 5, 2, 12)):
            cv.line(x0, y0, x1, y1, L("wd2", "d1", 0.25))
        cv.set(7, 9, L("wd1", "d0", 0.2))


def grass_deep(cv, v):
    s = VSEED.get(v, 3) + 140
    base = L("d2", "ink2", 0.2)
    cv.rect(0, 0, S, S, base)
    speckle(cv, s, [(0.07, L(base, "ink2", 0.5)), (0.05, L("d1", "d2", 0.4)), (0.015, L("g3", "d2", 0.4))])
    for i in range(3):
        x, y = int(hh(s, i) * 14), int(hh(s, i, 9) * 14)
        cv.ellipse(x + 1, y + 1, 1.6, 1.1, L("g4", "d2", 0.4))
        cv.set(x, y, L("g3", "d1", 0.3))
    if v == "F2":  # clay lens
        for x in range(2, 13):
            cv.set(x, 6 + (x % 3 == 0), L("o2", "d1", 0.55))
            cv.set(x, 7, L("o2", "d2", 0.6))


GR = ["gr0", "gr1", "gr2", "gr3", "gr4"]


def grass_cap(cv, v):
    s = VSEED.get(v, 7) + 900
    # lawn band rows 0..4, darker underlayer row 5, fringe hanging over the loam rows 6..8
    for x in range(S):
        top = 0
        if hh(x, s, 1) < 0.18:
            top = 1  # little dips in the turf line
        for y in range(top, 5):
            col = "gr1" if y > 1 else "gr0"
            if y >= 3 and hh(x, y, s) < 0.35:
                col = "gr2"
            cv.set(x, y, col)
        if top:
            cv.set(x, 0, T)
        cv.set(x, 5, "gr2")
        cv.set(x, 6, "gr3")
        hang = int(hh(x, s, 4) * 3.2)  # roots / tufts hanging into the soil
        for y in range(7, 7 + hang):
            cv.set(x, y, "gr3" if y == 7 else L("gr4", "d2", 0.4))
        tint(cv, x, 7 + hang, "ink2", 0.3)
    # blade tips: lighter flecks in the top rows, dark blade strokes lower
    for x in range(S):
        if hh(x, s, 6) < 0.3:
            cv.set(x, 1, L("gr0", "y0", 0.35))
        if hh(x, s, 7) < 0.3:
            cv.set(x, 3, "gr2"), cv.set(x, 4, "gr3")
    if v == "T1":  # daisies
        for x, y in ((3, 2), (11, 1)):
            px(cv, ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)), "w")
            cv.set(x, y, "y1")
    elif v == "T2":  # clover patch
        for x in range(5, 11):
            cv.set(x, 2, "gr2" if x % 2 else "gr1")
            cv.set(x, 3, "gr3" if x % 3 == 0 else "gr2")
        cv.set(7, 1, L("w", "p0", 0.3))
    elif v == "T3":  # dandelions
        for x in (5, 13):
            cv.set(x, 1, "y1"), cv.set(x, 2, "gr2"), cv.set(x + 1, 1, "y2")
    elif v == "X0":  # tulips
        for x, col in ((3, "cr"), (6, "y1"), (9, "pk"), (12, "cr")):
            cv.set(x, 1, col), cv.set(x + 1, 1, col)
            cv.set(x, 0, L(col, "w", 0.35))
            cv.set(x, 2, "gr2"), cv.set(x, 3, "gr3")
    elif v == "X1":  # sprinkler head
        cv.rect(7, 2, 3, 2, "s3")
        cv.hline(7, 2, 3, "s1")
        cv.set(8, 1, "s2")


# ---------------------------------------------------------------------------
# PATH — clay pavers + granite edge over a crushed-gravel bed
# ---------------------------------------------------------------------------
PV = {"a": L("b0", "l1", 0.55), "b": L("b1", "l2", 0.5), "c": L("b0", "l0", 0.45), "j": L("l3", "d1", 0.4),
      "edge": L("g1", "l1", 0.3), "edge2": L("g3", "l3", 0.3)}
GRAV = {"base": L("g3", "l3", 0.45), "lt": L("g1", "l2", 0.35), "dk": L("g4", "d2", 0.4), "w": L("g0", "l1", 0.4)}


def path_body(cv, v):
    s = VSEED[v] + 211
    base = GRAV["base"]
    cv.rect(0, 0, S, S, base)
    # packed aggregate: lots of 1-2px stones, each lit on top
    for i in range(18):
        x, y = int(hh(s, i) * 16), int(hh(s, i, 1) * 16)
        k = hh(s, i, 2)
        col = GRAV["lt"] if k < 0.5 else L(GRAV["w"], base, 0.4) if k < 0.6 else L(base, "d1", 0.35)
        cv.set(x, y, col)
        cv.set(x, y + 1, GRAV["dk"])
        if k < 0.25:
            cv.set(x + 1, y, col)
            cv.set(x + 1, y + 1, GRAV["dk"])
    speckle(cv, s, [(0.03, GRAV["dk"])])
    if v == "F1":  # compaction layer
        for x in range(S):
            tint(cv, x, 9, GRAV["dk"], 0.35)
            tint(cv, x, 10, GRAV["lt"], 0.15)
    elif v == "F2":
        cv.ellipse(5, 9, 3, 2.2, L("g2", "l2", 0.3))
        cv.hline(3, 8, 4, GRAV["w"])
        cv.hline(3, 11, 5, GRAV["dk"])
    elif v == "F4":  # drain tile
        cv.disc(10.5, 8.5, 3.2, L("o2", "d1", 0.35))
        cv.disc(10.5, 8.5, 2.0, "ink2")
        cv.set(9, 7, L("o1", "d0", 0.3))
    elif v == "X2":  # irrigation line
        cv.hline(0, 7, S, L("s3", "ink2", 0.2))
        cv.hline(0, 6, S, L("s2", "g2", 0.3))
        cv.hline(0, 8, S, "ink2")
    elif v == "X3":  # lost coin (heh)
        cv.ellipse(7.5, 10.5, 2, 1.4, "y2")
        cv.set(7, 10, "y0"), cv.set(8, 11, "y3")


def path_deep(cv, v):
    s = VSEED.get(v, 3) + 250
    base = L("d2", "g4", 0.35)
    cv.rect(0, 0, S, S, base)
    speckle(cv, s, [(0.08, L(base, "ink2", 0.45)), (0.06, L("g3", "d1", 0.4)), (0.02, L("g2", "l3", 0.4))])
    for i in range(4):
        x, y = int(hh(s, i) * 14), int(hh(s, i, 4) * 14)
        cv.ellipse(x + 1, y + 1, 1.8, 1.2, L("g4", "d1", 0.35))
        cv.set(x, y, L("g2", "d0", 0.35))


def path_cap(cv, v):
    # row 0 lit lip, rows 1-4 pavers (basket weave: 2 tall bricks then 2 long), row 5 granite edge,
    # rows 6-7 bedding sand shadow
    cv.hline(0, 0, S, L(PV["c"], "w", 0.45))
    off = {"T0": 0, "T1": 4, "T2": 8, "T3": 2, "X0": 0, "X1": 6}[v]
    for x in range(S):
        xx = (x + off) % 16
        for y in range(1, 5):
            if xx < 8:  # long brick, horizontal joint at row 3
                joint = y == 3 or xx == 7
                n = hh((x + off) // 8, y // 3, 17)
            else:  # two short vertical bricks
                joint = xx in (11, 15)
                n = hh((x + off) // 4, 1, 19)
            if joint:
                col = PV["j"]
            else:
                col = PV["a"] if n < 0.5 else PV["b"] if n < 0.85 else PV["c"]
                if y == 1 or (xx < 8 and y == 4):
                    col = L(col, "w", 0.18)
            cv.set(x, y, col)
    cv.hline(0, 5, S, PV["edge"])
    cv.hline(0, 6, S, PV["edge2"])
    for x in range(S):
        tint(cv, x, 7, "ink2", 0.35)
    if v == "T2":  # a cracked paver
        px(cv, ((4, 2), (5, 3), (5, 4)), PV["j"])
    if v == "T3":
        for x in (3, 10):
            cv.set(x, 1, L("gr1", PV["a"], 0.3))  # moss in the joints
    if v == "X0":  # bronze "LPZ" medallion
        cv.rect(6, 1, 4, 3, "y3")
        cv.hline(6, 1, 4, "y2")
        cv.set(7, 2, "y4"), cv.set(8, 2, "y4")
    if v == "X1":  # leaf on the path
        px(cv, ((9, 2), (10, 2), (10, 1), (11, 2)), "o1")
        cv.set(10, 3, "o2")


# ---------------------------------------------------------------------------
# SAND — beach sand over packed sand
# ---------------------------------------------------------------------------
SD = {"hi": L("l0", "w", 0.35), "a": L("l0", "y0", 0.3), "b": L("l1", "l0", 0.3), "c": L("l1", "l2", 0.35),
      "d": L("l2", "l3", 0.4), "wet": L("l2", "d1", 0.35), "wet2": L("l3", "d1", 0.45)}


def sand_body(cv, v):
    s = VSEED[v] + 307
    for y in range(S):
        for x in range(S):
            # wavy strata of packed sand
            band = (y + int(2 * hh(x // 4, s, 3))) % 8
            col = SD["c"] if band < 5 else L(SD["c"], SD["d"], 0.55) if band < 7 else L(SD["c"], SD["d"], 0.3)
            cv.set(x, y, col)
    speckle(cv, s, [(0.035, SD["b"]), (0.03, SD["d"]), (0.01, L("g2", "l2", 0.3))])
    if v == "F1":  # pebble
        cv.ellipse(10, 9, 1.8, 1.2, L("g3", "l3", 0.3))
        cv.set(9, 8, L("g1", "l1", 0.2))
    elif v == "F2":  # buried shell
        px(cv, ((5, 9), (6, 8), (7, 8), (8, 9)), L("w", "pk", 0.18))
        px(cv, ((5, 10), (6, 10), (7, 10), (8, 10)), L("l2", "pk", 0.25))
    elif v == "F3":
        for i in range(4):
            x, y = 2 + int(hh(s, i) * 12), 2 + int(hh(s, i, 1) * 12)
            cv.set(x, y, L("g3", "l3", 0.4))
    elif v == "F5":  # cross bedding
        for i in range(10):
            cv.set(3 + i, 4 + i // 2, SD["d"])
    elif v == "X2":  # beach glass
        cv.rect(6, 8, 3, 2, L("t1", "gr1", 0.3))
        cv.set(6, 8, L("t0", "w", 0.4))
    elif v == "X3":  # bottle cap
        cv.rect(9, 7, 3, 2, "cr")
        cv.set(9, 7, "pk")
        cv.hline(9, 9, 3, "cr3")


def sand_deep(cv, v):
    s = VSEED.get(v, 3) + 340
    for y in range(S):
        for x in range(S):
            band = (y + int(2 * hh(x // 4, s, 5))) % 6
            cv.set(x, y, SD["wet"] if band < 4 else SD["wet2"])
    speckle(cv, s, [(0.06, SD["wet2"]), (0.04, L(SD["wet"], "l1", 0.4)), (0.02, L("g3", "d2", 0.3))])
    if v == "F2":
        cv.ellipse(7, 10, 3, 2, L("g3", "d2", 0.3))
        cv.hline(6, 9, 3, L("g2", "l3", 0.3))


def sand_cap(cv, v):
    s = VSEED.get(v, 5) + 360
    cv.hline(0, 0, S, SD["hi"])
    for x in range(S):
        for y in range(1, 6):
            col = SD["a"] if y < 3 else SD["b"]
            # wind ripples: diagonal dashes, lit on top
            r = (x * 2 + y * 5 + {"T0": 0, "T1": 3, "T2": 6, "T3": 9, "X0": 1, "X1": 4}[v]) % 11
            if y in (2, 4) and r < 3:
                col = SD["c"]
            elif y in (1, 3) and r < 3:
                col = SD["hi"]
            cv.set(x, y, col)
    for x in range(S):
        cv.set(x, 6, SD["c"])
        tint(cv, x, 7, SD["d"], 0.6)
    speckle(cv, s, [(0.04, SD["c"])], 1, 6)
    if v == "T1":  # footprint
        cv.ellipse(5.5, 3, 1.6, 1, SD["c"])
        cv.set(5, 3, SD["d"])
        cv.ellipse(11, 2.5, 1.4, 0.9, SD["c"])
    if v == "T2":  # shell
        px(cv, ((9, 2), (10, 1), (11, 1), (12, 2)), "w")
        px(cv, ((9, 3), (10, 3), (11, 3), (12, 3)), L("pk", "l0", 0.45))
        cv.set(10, 2, L("pk", "w", 0.5)), cv.set(11, 2, L("pk", "w", 0.6))
    if v == "T3":
        px(cv, ((3, 2), (4, 2)), L("g2", "l2", 0.3))
        cv.set(3, 3, L("g4", "d1", 0.3))
    if v == "X0":  # beach grass tuft
        for x, h in ((5, 4), (6, 6), (7, 5), (8, 3), (10, 5), (11, 4)):
            for y in range(1, 1 + h):
                if y < 6:
                    cv.set(x, 6 - y, "gr2" if y < 3 else L("gr0", "l0", 0.3))
    if v == "X1":  # driftwood
        cv.hline(3, 3, 10, "wd2")
        cv.hline(4, 2, 7, L("wd1", "g1", 0.35))
        cv.hline(3, 4, 10, "wd3")
        cv.set(12, 2, "wd2")


# ---------------------------------------------------------------------------
# BOARD — boardwalk deck over a timber crib
# ---------------------------------------------------------------------------
BW = {"p0": L("wd0", "l0", 0.25), "p1": L("wd1", "wd0", 0.25), "p2": "wd2", "p3": "wd3", "gap": L("wd4", "ink", 0.45),
      "pile": L("wd2", "g3", 0.25), "pile_l": L("wd1", "g2", 0.25), "pile_d": L("wd3", "g4", 0.3),
      "beam": L("wd2", "wd3", 0.4), "dark": L("ink2", "wd4", 0.45)}


def board_body(cv, v, deep=False):
    s = VSEED[v] + 401
    cv.rect(0, 0, S, S, BW["dark"])
    # cross bracing in the dark gap (behind the piles)
    flip = (v in ("F1", "F3", "F5", "X3"))
    br = L(BW["beam"], BW["dark"], 0.45)
    for i in range(S):
        y = i if not flip else 15 - i
        cv.set(i, y, br)
        cv.set(i, min(15, y + 1), L(br, BW["dark"], 0.5))
    # two piles per tile (x 1..5 and 9..13), round timber lit from the left
    for x0 in (1, 9):
        for x in range(x0, x0 + 5):
            k = x - x0
            col = BW["pile_l"] if k == 0 else BW["pile"] if k < 3 else BW["pile_d"]
            cv.vline(x, 0, S, col)
        # bark texture / checks
        for y in range(S):
            if hh(x0, y, s) < 0.18:
                cv.set(x0 + 2, y, BW["pile_d"])
            if hh(x0, y, s, 2) < 0.1:
                cv.set(x0 + 1, y, L(BW["pile_l"], "w", 0.15))
        cv.vline(x0 + 5, 0, S, L(BW["dark"], "ink", 0.3))  # cast shadow
    # horizontal stringer
    if not deep:
        cv.rect(0, 6, S, 3, BW["beam"])
        cv.hline(0, 6, S, L(BW["beam"], "wd1", 0.5))
        cv.hline(0, 8, S, BW["pile_d"])
        cv.hline(0, 9, S, L(BW["dark"], "ink", 0.3))
        for x in (3, 11):  # bolts
            cv.set(x, 7, "s2")
    if v == "F2":
        drips(cv, s, 0, 16, 9, "gr4", 0.35, 6)  # algae
    elif v == "F4":  # iron strap
        for x0 in (1, 9):
            cv.hline(x0, 12, 5, "s4")
            cv.set(x0 + 1, 12, "s3")
    elif v == "F6":
        drips(cv, s, 0, 16, 0, "ink2", 0.25, 6)
    elif v == "X2":  # rope ring on a pile
        cv.ring(3.5, 11.5, 2.6, "wd0", 1.2)
        cv.set(2, 10, "l0")
    elif v == "X3":  # barnacles / zebra mussels
        for i in range(6):
            x, y = 9 + int(hh(s, i) * 5), 10 + int(hh(s, i, 1) * 5)
            cv.set(x, y, L("g1", "l2", 0.3))
            cv.set(x, y + 1, "g4")


def board_deep(cv, v):
    board_body(cv, v, deep=True)


def board_cap(cv, v):
    # rows 0-4 deck plank end-on (thick plank), row 5 shadow line, rows 6-7 deck beam
    cv.hline(0, 0, S, L(BW["p0"], "w", 0.3))
    cv.rect(0, 1, S, 2, BW["p0"])
    cv.rect(0, 3, S, 2, BW["p1"])
    cv.hline(0, 5, S, BW["p3"])
    cv.hline(0, 6, S, BW["gap"])
    cv.rect(0, 7, S, 2, BW["beam"])
    cv.hline(0, 7, S, L(BW["beam"], "wd1", 0.4))
    cv.hline(0, 9, S, L(BW["dark"], "ink", 0.3))
    # plank butt joints + wood grain
    js = {"T0": [7], "T1": [2, 12], "T2": [10], "T3": [5], "X0": [7], "X1": [13]}[v]
    for j in js:
        cv.vline(j, 1, 4, BW["p3"])
        cv.set(j + 1, 1, L(BW["p0"], "w", 0.4))
    for x in range(S):
        if hh(x, 7, VSEED.get(v, 1)) < 0.22:
            cv.set(x, 2, BW["p1"])
        if hh(x, 9, VSEED.get(v, 1)) < 0.15:
            cv.set(x, 4, BW["p2"])
    for j in js:  # nail heads either side of each joint
        cv.set(j - 2, 2, "s3"), cv.set(j + 2, 2, "s3")
    if v == "T2":  # knot
        cv.set(4, 3, BW["p2"]), cv.set(5, 3, BW["p3"])
    if v == "X0":  # brass number plate
        cv.rect(10, 1, 4, 3, "y2")
        cv.hline(10, 1, 4, "y1")
        cv.set(11, 2, "y4"), cv.set(12, 2, "y4")
    if v == "X1":  # cleat
        cv.rect(3, 0, 6, 2, "s3")
        cv.hline(3, 0, 6, "s1")
        cv.set(5, 2, "s4"), cv.set(6, 2, "s4")


# ---------------------------------------------------------------------------
# IVY — ivy-covered outfield brick wall with a brick coping
# ---------------------------------------------------------------------------
IV = ["gr0", "gr1", "gr2", "gr3", "gr4"]
IVB = {"brick": L("b2", "b3", 0.25), "brick2": L("b1", "b2", 0.4), "mortar": L("bm2", "b3", 0.35)}


def ivy_brick(cv, s):
    for y in range(S):
        row = y // 4
        for x in range(S):
            xo = (x + (4 if row % 2 else 0)) % 8
            if y % 4 == 3 or xo == 7:
                cv.set(x, y, IVB["mortar"])
            else:
                cv.set(x, y, IVB["brick2"] if hh((x + (4 if row % 2 else 0)) // 8, row, s) < 0.4 else IVB["brick"])


def ivy_leaves(cv, s, density=0.85, autumn=0.0, dark=0.0):
    """Clusters of 3x3-ish heart leaves lit from the top-left; `density` = coverage."""
    cells = []
    for gy in range(-1, 6):
        for gx in range(-1, 6):
            jx = int(hh(gx, gy, s) * 3)
            jy = int(hh(gx, gy, s, 1) * 3)
            cells.append((gx * 3 + jx, gy * 3 + jy, hh(gx, gy, s, 2), hh(gx, gy, s, 3)))
    cells.sort(key=lambda t: t[1])
    for (x, y, k, a) in cells:
        if k > density:
            continue
        aut = a < autumn
        mid = L("o1", "cr2", 0.4) if aut else IV[1] if k < density * 0.5 else IV[2]
        hi = L("o0", "y1", 0.3) if aut else IV[0]
        lo = L("cr3", "b3", 0.3) if aut else IV[3]
        if dark:
            mid, hi, lo = L(mid, "gr4", dark), L(hi, "gr3", dark), L(lo, "ink2", dark)
        # leaf: diamond-ish 4x3 with a dark lower edge
        for dx, dy, col in ((1, 0, hi), (2, 0, mid), (0, 1, hi), (1, 1, mid), (2, 1, mid), (3, 1, mid),
                            (1, 2, mid), (2, 2, lo), (3, 2, lo), (2, 3, lo)):
            xx, yy = x + dx, y + dy
            if 0 <= xx < S and 0 <= yy < S:
                cv.set(xx, yy, col)


def ivy_body(cv, v):
    s = VSEED[v] + 503
    ivy_brick(cv, s)
    dens = {"F0": 0.9, "F1": 0.62, "F2": 0.88, "F3": 0.8, "F4": 0.92, "F5": 0.7, "F6": 0.86, "X2": 0.5, "X3": 0.88}[v]
    # stems first (visible in gaps)
    for i in range(3):
        x = int(hh(s, i) * 14) + 1
        for y in range(S):
            cv.set(x, y, L("wd3", "gr4", 0.4))
            if hh(s, i, y) < 0.25:
                x = max(0, min(15, x + (1 if hh(s, y, i) < 0.5 else -1)))
    if v != "X2":
        for y in range(S):
            for x in range(S):
                cv.set(x, y, L("gr4", "ink2", 0.15) if (x + y) % 3 else L("gr3", "gr4", 0.5))
    ivy_leaves(cv, s, min(0.97, dens + 0.05))
    if v == "X2":  # painted distance marker on the brick
        cv.rect(2, 4, 12, 7, IVB["brick"])
        text(cv, 3, 5, "400", "w")
        for x in range(2, 14):
            cv.set(x, 11, IVB["mortar"])
    if v == "X3":  # a baseball lost in the ivy
        cv.disc(8, 8, 2.2, "w")
        cv.set(7, 7, "w"), cv.set(9, 9, "g1"), cv.set(10, 8, "g1")
        px(cv, ((7, 9), (8, 10)), "cr")
        px(cv, ((9, 6), (10, 7)), "cr")


def ivy_deep(cv, v):
    s = VSEED.get(v, 3) + 540
    ivy_brick(cv, s)
    for x in range(S):
        for y in range(S):
            tint(cv, x, y, "ink2", 0.18)
    for y in range(S):
        for x in range(S):
            cv.set(x, y, L("gr4", "ink2", 0.35))
    ivy_leaves(cv, s, 0.95, dark=0.45)


def ivy_cap(cv, v):
    # rows 0-3 brick coping (rowlock bricks on edge), row 4 shadow, rows 5+ ivy spilling over the top
    cv.hline(0, 0, S, L("b0", "w", 0.35))
    for x in range(S):
        k = x % 4
        col = "b1" if k else L("b3", "bm2", 0.4)
        cv.set(x, 1, L(col, "b0", 0.35) if k else col)
        cv.set(x, 2, col)
        cv.set(x, 3, L(col, "b3", 0.4) if k else col)
    cv.hline(0, 4, S, L("b3", "ink2", 0.4))
    s = VSEED.get(v, 3) + 560
    for x in range(S):  # ivy top edge: irregular, hugging the coping
        top = 5 + int(hh(x // 2, s) * 2)
        for y in range(top, S):
            cv.set(x, y, IV[2] if y > top else IV[1])
        tint(cv, x, top - 1, "ink2", 0.25)
    ivy_leaves(cv, s, 0.85)
    cv.hline(0, 0, S, L("b0", "w", 0.35))
    for x in range(S):
        k = x % 4
        col = "b1" if k else L("b3", "bm2", 0.4)
        cv.set(x, 1, L(col, "b0", 0.35) if k else col)
        cv.set(x, 2, col)
        cv.set(x, 3, L(col, "b3", 0.4) if k else col)
        cv.set(x, 4, L("b3", "ink2", 0.4))
    if v == "T1":  # tendril curling over the coping
        px(cv, ((5, 3), (6, 2), (7, 2), (8, 3)), IV[2])
        cv.set(6, 1, IV[1])
    if v == "T3":
        px(cv, ((11, 3), (12, 3)), IV[1])
    if v == "X0":  # yardage plate on the coping
        cv.rect(5, 1, 6, 3, "y1")
        cv.hline(5, 3, 6, "y3")
    if v == "X1":  # padding seam
        cv.vline(8, 0, 4, L("b3", "ink2", 0.3))


# ---------------------------------------------------------------------------
# FLAT — three-flat greystone (rock-faced Bedford limestone)
# ---------------------------------------------------------------------------
GS = {"a": L("g1", "l1", 0.45), "b": L("g2", "l2", 0.45), "c": L("g2", "l3", 0.3), "hi": L("g0", "l0", 0.5),
      "lo": L("g3", "l3", 0.45), "j": L("g4", "l4", 0.4), "dk": L("g4", "ink2", 0.35)}


def flat_body(cv, v):
    s = VSEED[v] + 601
    # rock-faced ashlar: 8px courses, blocks 6-10 wide, each block a lumpy lit face
    joints = {"F0": ([7], [3, 12]), "F1": ([4, 12], [8]), "F2": ([10], [5]), "F3": ([6, 14], [2, 10]),
              "F4": ([9], [1, 13]), "F5": ([3, 11], [7]), "F6": ([13], [6]), "X2": ([7], [3, 12]), "X3": ([5, 12], [9])}[v]
    cv.rect(0, 0, S, S, GS["b"])
    for course in (0, 1):
        y0 = course * 8
        js = joints[course]
        edges = [-1] + js + [S]
        for a, b in zip(edges, edges[1:]):
            x0, x1 = a + 1, min(S - 1, b - 1)
            for y in range(y0, y0 + 7):
                for x in range(x0, x1 + 1):
                    n = hh(x // 2, y // 2, s, course)
                    col = GS["a"] if n < 0.35 else GS["b"] if n < 0.8 else GS["c"]
                    if y == y0:
                        col = GS["hi"]
                    elif y == y0 + 6:
                        col = GS["lo"]
                    elif x == x0 and a >= 0:
                        col = L(GS["a"], GS["hi"], 0.5)
                    elif x == x1 and b < S:
                        col = GS["lo"]
                    cv.set(x, y, col)
            # rock-face bumps: lit pixel above a shadow pixel
            for i in range(3):
                bx = x0 + 1 + int(hh(a, i, s) * max(1, x1 - x0 - 1))
                by = y0 + 2 + int(hh(a, i, s, 5) * 3)
                cv.set(bx, by, GS["hi"])
                cv.set(bx, by + 1, GS["lo"])
        cv.hline(0, y0 + 7, S, GS["j"])
        for j in js:
            cv.vline(j, y0, 7, GS["j"])
    if v == "F2":
        drips(cv, s, 3, 13, 0, GS["dk"], 0.22, 12)
    elif v == "F4":
        drips(cv, s, 0, 16, 8, "gr4", 0.18, 6)
    elif v == "X2":  # carved rosette (smooth-dressed block)
        cv.rect(4, 1, 8, 6, GS["a"])
        cv.ring(7.5, 4, 2.6, GS["lo"])
        cv.disc(7.5, 4, 1.2, GS["c"])
        cv.set(6, 2, GS["hi"])
    elif v == "X3":  # date stone
        cv.rect(3, 9, 10, 5, GS["a"])
        cv.frame(3, 9, 10, 5, GS["lo"])
        cv.hline(5, 11, 6, GS["j"])
        cv.hline(3, 9, 10, GS["hi"])


def flat_cap(cv, v):
    # carved cornice lip: row 0 lit, 1-2 smooth, 3 egg-and-dart, 4 bed mould, 5 shadow
    cv.hline(0, 0, S, L(GS["hi"], "w", 0.4))
    cv.rect(0, 1, S, 2, GS["hi"])
    cv.hline(0, 2, S, GS["a"])
    for x in range(S):
        cv.set(x, 3, GS["a"] if x % 3 else GS["lo"])
        cv.set(x, 4, GS["c"] if x % 2 else GS["lo"])
    cv.hline(0, 5, S, GS["j"])
    for x in range(S):
        tint(cv, x, 6, "ink2", 0.3)
    js = {"T0": [9], "T1": [3], "T2": [13], "T3": [], "X0": [9], "X1": [6]}[v]
    for j in js:
        cv.vline(j, 1, 2, GS["lo"])
        cv.set(j + 1, 1, L(GS["hi"], "w", 0.5))
    if v == "T2":
        px(cv, ((5, 1), (6, 2)), GS["lo"])
    if v == "X0":  # potted geranium on the ledge... just a pot rim
        cv.rect(10, 0, 4, 2, "o2")
        cv.hline(10, 0, 4, "o1")
        cv.set(11, 0, "cr"), cv.set(12, 0, "gr2")
    if v == "X1":  # pigeon spikes
        for x in range(2, 14, 2):
            cv.set(x, 0, "s2")


# ---------------------------------------------------------------------------
# SEAT — stadium stands: concrete treads, green seat rows on the risers
# ---------------------------------------------------------------------------
ST = {"c0": L("g0", "s0", 0.3), "c1": L("g1", "s1", 0.35), "c2": L("g2", "s2", 0.35), "c3": L("g3", "s3", 0.35),
      "c4": L("g4", "s4", 0.3), "seat": L("gr2", "t3", 0.3), "seat_l": L("gr1", "t2", 0.3), "seat_d": L("gr3", "t4", 0.3),
      "nose": "y1", "nose2": "y3"}


def seat_body(cv, v):
    s = VSEED[v] + 701
    cv.rect(0, 0, S, S, ST["c2"])
    speckle(cv, s, [(0.04, ST["c3"]), (0.03, ST["c1"])])
    # two riser rows per tile (8px each): seat back 0-3, seat pan 4, legs/shadow 5-6, tread line 7
    empty = {"F1": 6, "F3": 1, "F5": 11, "X2": 3}.get(v)
    for r_ in (0, 1):
        y0 = r_ * 8
        cv.hline(0, y0 + 7, S, ST["c1"])  # tread nose of the step below
        cv.hline(0, y0 + 6, S, ST["c3"])
        for sx in range(0, S, 4):
            if empty is not None and r_ == 0 and sx == (empty // 4) * 4:
                cv.rect(sx + 1, y0 + 4, 2, 1, ST["c3"])  # folded-up seat
                cv.rect(sx + 1, y0 + 1, 2, 3, ST["seat_d"])
                continue
            cv.rect(sx, y0 + 1, 3, 3, ST["seat"])
            cv.set(sx, y0 + 1, ST["seat_l"])
            cv.set(sx + 1, y0 + 1, ST["seat_l"])
            cv.vline(sx + 2, y0 + 1, 3, ST["seat_d"])
            cv.hline(sx, y0 + 4, 4, ST["seat_d"])
            cv.set(sx + 3, y0 + 2, ST["c3"])  # armrest
            cv.set(sx + 3, y0 + 3, ST["c4"])
            cv.set(sx + 1, y0 + 5, ST["c4"])  # pedestal
    if v == "F2":  # spilled popcorn
        for i in range(5):
            cv.set(2 + int(hh(s, i) * 12), 14, "y0")
    elif v == "F4":  # aisle row number
        cv.rect(12, 9, 4, 4, "y1")
        cv.set(13, 10, "ink2"), cv.set(13, 11, "ink2")
    elif v == "F6":
        drips(cv, s, 0, 16, 0, ST["c4"], 0.18, 8)
    elif v == "X3":  # red seat (a home-run seat)
        cv.rect(4, 9, 3, 3, "cr")
        cv.set(4, 9, "pk"), cv.vline(6, 9, 3, "cr2")


def seat_deep(cv, v):
    s = VSEED.get(v, 3) + 740
    base = L(ST["c3"], "s4", 0.3)
    cv.rect(0, 0, S, S, base)
    speckle(cv, s, [(0.05, ST["c4"]), (0.03, ST["c2"])])
    # precast raker beams + column
    cv.hline(0, 5, S, ST["c4"])
    cv.hline(0, 4, S, ST["c2"])
    cv.hline(0, 13, S, ST["c4"])
    cv.hline(0, 12, S, ST["c2"])
    if v in ("D1", "E1", "F1"):
        cv.rect(6, 0, 4, S, ST["c2"])
        cv.vline(6, 0, S, ST["c1"])
        cv.vline(9, 0, S, ST["c4"])
    if v == "F2":
        drips(cv, s, 0, 16, 6, "r3", 0.25, 6)


def seat_cap(cv, v):
    # tread: lit concrete lip, yellow safety nosing, then the first seat row of the riser
    cv.hline(0, 0, S, ST["c0"])
    cv.rect(0, 1, S, 2, ST["c1"])
    cv.hline(0, 3, S, ST["nose"])
    cv.hline(0, 4, S, ST["nose2"])
    cv.hline(0, 5, S, ST["c3"])
    for x in range(S):
        tint(cv, x, 6, "ink2", 0.3)
    js = {"T0": [8], "T1": [], "T2": [3], "T3": [12], "X0": [8], "X1": []}[v]
    for j in js:
        cv.vline(j, 1, 2, ST["c2"])
        cv.set(j + 1, 1, ST["c0"])
    if v == "T1":  # stray peanut shells
        px(cv, ((5, 2), (6, 2)), "wd0")
        cv.set(11, 2, "wd1")
    if v == "X0":  # cup holder / drink
        cv.rect(10, 0, 3, 3, "w")
        cv.hline(10, 0, 3, "cb2")
        cv.set(11, 1, "cr")
    if v == "X1":  # foul-ball scuff
        px(cv, ((4, 1), (5, 2), (6, 1)), ST["c2"])


MATS2 = {
    "GRASS": Mat("GRASS", grass_body, grass_cap, L("d2", "ink", 0.5), LOAM["lt"], LOAM["dk"], L("d2", "ink2", 0.4),
                 tiers=(0.1, 0.2), cap_h=7, deep_body=grass_deep),
    "PATH": Mat("PATH", path_body, path_cap, L("g4", "ink2", 0.4), GRAV["lt"], GRAV["dk"], L("d2", "ink2", 0.3),
                tiers=(0.1, 0.2), cap_h=7, deep_body=path_deep),
    "SAND": Mat("SAND", sand_body, sand_cap, L("l3", "d2", 0.55), SD["hi"], SD["d"], L("l3", "d1", 0.4),
                tiers=(0.08, 0.16), cap_h=7, deep_body=sand_deep),
    "BOARD": Mat("BOARD", board_body, board_cap, L("wd4", "ink", 0.5), BW["p0"], BW["dark"], BW["dark"],
                 tiers=(0.12, 0.22), cap_h=9, deep_body=board_deep),
    "IVY": Mat("IVY", ivy_body, ivy_cap, L("gr4", "ink", 0.5), "gr0", "gr4", L("gr4", "ink2", 0.35),
               tiers=(0.1, 0.2), cap_h=5, deep_body=ivy_deep),
    "FLAT": Mat("FLAT", flat_body, flat_cap, L("g4", "ink2", 0.45), GS["hi"], GS["lo"], L("g4", "l4", 0.4), cap_h=6),
    "SEAT": Mat("SEAT", seat_body, seat_cap, L("s4", "ink", 0.4), ST["c0"], ST["c4"], L("s4", "ink2", 0.35),
                tiers=(0.1, 0.2), cap_h=6, deep_body=seat_deep),
}


# ---------------------------------------------------------------------------
# Facade decor — flatter, lower contrast, no lit lips (tinted further at runtime)
# ---------------------------------------------------------------------------
STONES = {
    # greystone: cool grey-buff limestone
    "GS": {"wall": L("g2", "l2", 0.4), "wall2": L("g2", "l3", 0.25), "joint": L("g3", "l3", 0.4), "lt": L("g1", "l1", 0.4),
           "dk": L("g4", "l4", 0.45), "trim": L("g1", "l1", 0.55), "frame": L("ink2", "g5", 0.3), "door": L("wd3", "ink2", 0.3)},
    # brownstone: chocolate sandstone
    "BS": {"wall": L("wd3", "d1", 0.45), "wall2": L("wd3", "wd4", 0.3), "joint": L("wd4", "ink2", 0.3), "lt": L("wd2", "d0", 0.4),
           "dk": L("wd4", "ink2", 0.2), "trim": L("wd1", "l2", 0.4), "frame": L("ink2", "wd4", 0.4), "door": L("gr4", "ink2", 0.3)},
}


def fs_wall(cv, pre, v=0):
    p = STONES[pre]
    s = 800 + v * 19 + (0 if pre == "GS" else 7)
    cv.rect(0, 0, S, S, p["wall"])
    js = {0: ([6], [13]), 1: ([11], [3]), 2: ([2, 10], [7])}[v]
    for y in range(S):
        if y % 8 == 7:
            cv.hline(0, y, S, p["joint"])
        elif y % 8 == 0:
            cv.hline(0, y, S, L(p["wall"], p["lt"], 0.4))
    for course, xs in ((0, js[0]), (1, js[1])):
        for x in xs:
            cv.vline(x, course * 8, 7, p["joint"])
    speckle(cv, s, [(0.05, p["wall2"]), (0.025, L(p["wall"], p["lt"], 0.5))])
    if v == 1:
        drips(cv, s, 2, 13, 0, "ink2", 0.2, 14)
    if v == 2:  # carved lintel band
        cv.hline(0, 3, S, p["trim"])
        cv.hline(0, 4, S, p["dk"])


def fs_edge(cv, pre, side):
    p = STONES[pre]
    fs_wall(cv, pre, 0)
    for y in range(S):  # quoins: alternating long / short blocks
        w = 5 if (y // 4) % 2 == 0 else 3
        for i in range(w):
            x = i if side == "L" else 15 - i
            cv.set(x, y, p["trim"] if y % 4 != 3 else p["dk"])
        cv.set(w if side == "L" else 15 - w, y, p["dk"])
    cv.vline(0 if side == "L" else 15, 0, S, p["dk"])


def fs_cornice(cv, pre, side=None):
    """Pressed-metal / carved cornice of a three-flat: brackets + dentils, bracketed ends."""
    p = STONES[pre]
    fs_wall(cv, pre, 0)
    top = L("g2", "s2", 0.4) if pre == "GS" else L("wd2", "g3", 0.3)
    mid = L("g3", "s3", 0.4) if pre == "GS" else L("wd3", "g4", 0.3)
    dk = L("g5", "ink2", 0.3)
    cv.hline(0, 0, S, mid)
    cv.rect(0, 1, S, 2, top)
    cv.hline(0, 3, S, dk)
    for x in range(S):
        cv.set(x, 4, top if x % 3 != 2 else dk)  # dentils
    cv.hline(0, 5, S, mid)
    cv.hline(0, 6, S, dk)
    for x0 in (1, 9):  # scroll brackets
        cv.rect(x0, 7, 4, 2, mid)
        cv.rect(x0 + 1, 9, 2, 2, mid)
        cv.set(x0 + 2, 11, mid)
        cv.set(x0, 7, top)
        cv.set(x0 + 3, 8, dk), cv.set(x0 + 2, 10, dk)
    for x in range(S):
        tint(cv, x, 7, "ink2", 0.2)
    if side == "L":
        for y in range(0, 7):
            cv.set(0, y, T if y < 1 else dk)
        cv.vline(0, 7, 9, p["dk"])
    if side == "R":
        for y in range(0, 7):
            cv.set(15, y, T if y < 1 else dk)
        cv.vline(15, 7, 9, p["dk"])


def fs_pane(cv, x0, y0, w, h, lit, pre):
    if lit:
        warm = "y1" if pre == "GS" else "o0"
        cv.rect(x0, y0, w, h, warm)
        cv.rect(x0, y0 + h // 2, w, h - h // 2, "y2")
        cv.set(x0, y0, "y0")
        cv.vline(x0 + w - 1, y0, h, "y3")
    else:
        cv.rect(x0, y0, w, h, L("gl4", "ink2", 0.3))
        cv.rect(x0, y0, w, max(1, h // 3), L("gl3", "gl4", 0.45))
        cv.set(x0 + 1, y0 + 1, L("gl2", "gl3", 0.35))


def fs_window(cv, pre, lit):
    p = STONES[pre]
    fs_wall(cv, pre, 0)
    # carved lintel with keystone, tall 1-over-1 sash, sill
    cv.rect(3, 0, 10, 2, p["trim"])
    cv.rect(7, 0, 2, 3, p["lt"])
    cv.hline(3, 2, 10, p["dk"])
    cv.rect(4, 3, 8, 10, p["frame"])
    fs_pane(cv, 5, 4, 6, 4, lit, pre)
    fs_pane(cv, 5, 9, 6, 3, lit, pre)
    cv.hline(5, 8, 6, p["trim"])
    cv.hline(3, 13, 10, p["trim"])
    cv.hline(3, 14, 10, p["dk"])


def fs_bay(cv, pre, side, lit):
    """Two-tile wide projecting bay window: angled side sashes + wide centre pane."""
    p = STONES[pre]
    full = Cv(32, 16)
    for t in (0, 16):
        sub = Cv(16, 16)
        fs_wall(sub, pre, 0)
        full.blit(sub, t, 0)
    bay = L(p["wall"], p["lt"], 0.35)
    full.rect(2, 0, 28, 16, bay)
    full.vline(2, 0, 16, p["trim"])
    full.vline(29, 0, 16, p["dk"])
    full.vline(30, 0, 16, L(p["dk"], "ink2", 0.3))  # cast shadow of the projection
    full.rect(2, 0, 28, 2, p["trim"])  # bay cornice band
    full.hline(2, 2, 28, p["dk"])
    full.rect(2, 13, 28, 2, p["trim"])
    full.hline(2, 15, 28, p["dk"])
    # side sashes (foreshortened) and the centre picture window
    for (x0, w) in ((4, 4), (10, 12), (24, 4)):
        full.rect(x0, 4, w, 8, p["frame"])
        fs_pane(full, x0 + 1, 5, w - 2, 6, lit, pre)
        full.hline(x0 + 1, 7, w - 2, p["frame"]) if w > 6 else None
    full.vline(9, 3, 10, p["dk"])
    full.vline(22, 3, 10, p["dk"])
    if lit:  # curtains in the centre pane
        full.vline(11, 5, 6, "o2" if pre == "GS" else "cr2")
        full.vline(20, 5, 6, "o2" if pre == "GS" else "cr2")
    cv.blit(full.im.crop((0, 0, 16, 16) if side == "L" else (16, 0, 32, 16)), 0, 0)


def fs_door(cv, pre):
    p = STONES[pre]
    fs_wall(cv, pre, 0)
    # arched doorway with transom
    for y in range(1, 16):
        for x in range(3, 13):
            if y >= 5 or (x - 7.5) ** 2 + (y - 5) ** 2 <= 4.8 ** 2:
                cv.set(x, y, p["trim"])
    for y in range(2, 16):
        for x in range(4, 12):
            if y >= 5 or (x - 7.5) ** 2 + (y - 5) ** 2 <= 3.6 ** 2:
                cv.set(x, y, p["door"])
    for x in range(5, 11):
        cv.set(x, 4, "y1" if x % 2 else "y2")  # lit transom
    cv.set(7, 3, "y1"), cv.set(8, 3, "y2")
    cv.rect(5, 7, 2, 7, L(p["door"], "w", 0.12))
    cv.rect(9, 7, 2, 7, L(p["door"], "w", 0.12))
    cv.set(10, 10, "y2")  # knob
    cv.hline(3, 15, 10, p["dk"])


def fs_stoop(cv, pre):
    """Stone stoop climbing to the door on the right (steps + iron railing)."""
    p = STONES[pre]
    fs_wall(cv, pre, 0)
    for i in range(5):
        y = 15 - i * 3
        x0 = 2 + i * 3
        cv.rect(x0, y - 2, 16 - x0, 3, p["trim"] if i % 2 == 0 else L(p["trim"], p["lt"], 0.3))
        cv.hline(x0, y - 2, 16 - x0, L(p["trim"], "w", 0.25))
        cv.hline(x0, y, 16 - x0, p["dk"])
    iron = "ink2"
    cv.line(1, 9, 13, 0, iron)  # handrail
    for x in (2, 6, 10):
        cv.vline(x, 9 - (x * 3) // 4, 15 - (9 - (x * 3) // 4) - (x // 3), iron)
    cv.set(1, 8, "s3")


def neon(part):
    """Neon bar signs on a dark backing board, two tiles wide (lit tubes + glow)."""
    kind, side = part[5:].rsplit("_", 1)
    word, col, glow = {"BAR": ("BAR", "pk", L("p0", "pk", 0.4)), "PIZZA": ("PIZZA", "o1", "o0"),
                       "DOGS": ("HOT DOGS", "y1", "y0"), "TEAM": ("GO TEAM!", "cyan", "t0")}[kind]
    full = Cv(32, 16)
    full.rect(0, 2, 32, 12, L("ink", "navy", 0.3))
    full.frame(0, 2, 32, 12, L("s4", "ink2", 0.3))
    for x in (2, 29):  # mounting brackets
        full.rect(x, 0, 1, 3, "s3")
    tube_col = c(col)
    if kind == "DOGS":  # mustard hot dog icon + small letters
        full.ellipse(6.5, 8, 4.5, 2, "y2")
        full.hline(3, 8, 8, "cr")
        full.hline(4, 7, 6, "y0")
        x = 13
        for ch in "DOGS":
            g = FONT3[ch]
            for j, row in enumerate(g):
                for i, vv in enumerate(row):
                    if vv == "#":
                        full.set(x + i, 6 + j, tube_col)
            x += 4
    elif kind == "PIZZA":
        full.poly([(3, 5), (10, 8), (3, 11)], "y2")
        full.set(5, 7, "cr"), full.set(5, 9, "cr"), full.set(7, 8, "cr")
        x = 12
        for ch in "PIZZA":
            g = FONT3[ch]
            for j, row in enumerate(g):
                for i, vv in enumerate(row):
                    if vv == "#":
                        full.set(x + i, 6 + j, tube_col)
            x += 4
    elif kind == "BAR":
        # cocktail glass + BAR in the big font
        full.poly([(3, 5), (10, 5), (6.5, 9)], "cyan")
        full.vline(6, 9, 3, "cyan")
        full.hline(4, 11, 5, "cyan")
        full.set(8, 4, "lime")
        x = 13
        for ch in "BAR":
            g = FONT5[ch]
            for j, row in enumerate(g):
                for i, vv in enumerate(row):
                    if vv == "#":
                        full.set(x + i, 4 + j, tube_col)
            x += len(g[0]) + 1
    else:  # GO TEAM!
        x = 3
        for ch in "GO TEAM!":
            g = FONT3.get(ch, FONT3["?"])
            for j, row in enumerate(g):
                for i, vv in enumerate(row):
                    if vv == "#":
                        full.set(x + i, 6 + j, tube_col if ch not in "GO" else "cr")
            x += len(g[0]) + 1
    # tube glow: tint the backing next to lit pixels
    src = full.im.copy().load()
    lit = {c(col)[:3], c("cyan")[:3], c("cr")[:3], c("y2")[:3]}
    for y in range(3, 13):
        for x in range(1, 31):
            if src[x, y][:3] in lit:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                q = src[x + dx, y + dy]
                if q[3] and q[:3] in lit:
                    full.set(x, y, L(src[x, y], glow, 0.35))
                    break
    cv = tile()
    cv.blit(full.im.crop((0, 0, 16, 16) if side == "L" else (16, 0, 32, 16)), 0, 0)
    return cv


def bleachers(part):
    """Rooftop bleachers seen from the street: steel stand on top of a three-flat, people optional."""
    cv = tile()
    steel, steel_d, steel_l = L("s3", "g4", 0.3), "ink2", L("s2", "g2", 0.3)
    bench = L("s1", "g1", 0.3)
    if part.startswith("BLEACH_T"):
        # top: guard rail + 2 bench rows stepping down to the front; fans as tiny silhouettes
        for i, y in enumerate((5, 10)):
            x0 = 0
            cv.rect(x0, y, S, 2, bench)
            cv.hline(x0, y, S, L(bench, "w", 0.3))
            cv.hline(x0, y + 2, S, steel_d)
            cv.rect(x0, y + 3, S, 2, L(steel, "ink2", 0.2))
        cv.hline(0, 1, S, steel_l)  # back rail
        for x in range(0, S, 5):
            cv.vline(x, 1, 5, steel)
        cols = ["cr", "cb2", "w", "y1", "cr2", "navy"]
        for k, x in enumerate(range(2, 15, 4)):  # fans on the back row
            n = hh(x, 3, 77)
            if n < 0.75:
                cv.rect(x, 2, 2, 3, cols[int(n * 6) % 6])
                cv.set(x, 1, "sk1" if n < 0.5 else "wd2")
        if part == "BLEACH_TL":
            cv.vline(0, 1, 15, steel_l)
        if part == "BLEACH_TR":
            cv.vline(15, 1, 15, steel_d)
        return cv
    # lower: steel frame (X-bracing) standing on the roof
    for x in (1, 14):
        cv.vline(x, 0, S, steel)
        cv.vline(x + 1, 0, S, steel_d)
    cv.line(2, 1, 13, 14, steel)
    cv.line(13, 1, 2, 14, steel)
    cv.hline(0, 0, S, steel_l)
    cv.hline(0, 15, S, steel_d)
    if part == "BLEACH_L":
        cv.vline(0, 0, S, steel_l)
    if part == "BLEACH_R":
        cv.vline(15, 0, S, steel_d)
    return cv


def sign_addison(part):
    full = Cv(32, 16)
    full.rect(0, 2, 32, 11, "ink2")
    full.rect(1, 3, 30, 9, "w")
    full.rect(1, 3, 30, 2, "cr")  # Red Line band
    x = 4
    for ch in "ADDISON":
        g = FONT3[ch]
        for j, row in enumerate(g):
            for i, vv in enumerate(row):
                if vv == "#":
                    full.set(x + i, 6 + j, "ink")
        x += 4 if ch != "I" else 4
    full.vline(8, 13, 3, "s3")
    full.vline(23, 13, 3, "s3")
    cv = tile()
    cv.blit(full.im.crop((0, 0, 16, 16) if part.endswith("_L") else (16, 0, 32, 16)), 0, 0)
    return cv


def zoo_sign(part):
    """Zoo entrance sign board, three tiles wide: 'LINCOLN PARK' over 'ZOO'."""
    full = Cv(48, 16)
    wood, wood2 = L("gr4", "wd4", 0.35), L("gr3", "wd3", 0.35)
    full.rect(0, 1, 48, 14, wood)
    full.hline(0, 1, 48, L(wood, "w", 0.2))
    full.hline(0, 14, 48, "ink2")
    full.hline(0, 2, 48, "y3")
    full.hline(0, 13, 48, "y3")
    x = 1
    for ch in "LINCOLN PARK":
        g = FONT3.get(ch)
        for j, row in enumerate(g):
            for i, vv in enumerate(row):
                if vv == "#":
                    full.set(x + i, 3 + j, "l0")
        x += len(g[0]) + 1
    x = 18
    for ch in "ZOO":
        g = FONT3[ch]
        for j, row in enumerate(g):
            for i, vv in enumerate(row):
                if vv == "#":
                    full.set(x + i, 9 + j, "y1")
        x += 4
    # little lion-head emblems either side of ZOO
    for ex in (10, 34):
        full.disc(ex + 1.5, 11, 2.2, "y3")
        full.disc(ex + 1.5, 11, 1.2, "y1")
    full.hline(0, 15, 48, wood2)
    i = {"ZOO_SIGN_L": 0, "ZOO_SIGN_M": 1, "ZOO_SIGN_R": 2}[part]
    cv = tile()
    cv.blit(full.im.crop((i * 16, 0, i * 16 + 16, 16)), 0, 0)
    return cv


CG = {"glass": L("gl1", "t1", 0.3), "glass2": L("gl2", "t2", 0.3), "hi": "gl0", "frame": L("w", "s1", 0.25),
      "frame_d": L("s2", "g2", 0.3), "plant": "gr2", "plant2": "gr3"}


def conservatory(part):
    """Victorian glasshouse: white iron glazing bars over pale aqua glass, palms inside."""
    cv = tile()
    if part in ("CONS_GLASS", "CONS_GLASS_LIT"):
        cv.rect(0, 0, S, S, CG["glass"])
        for y in range(S):
            for x in range(S):
                if (x + y) % 9 == 0:
                    cv.set(x, y, CG["hi"])  # sky reflection diagonals
        # foliage inside: soft, low-contrast leaf masses in the lower half of the pane
        frond = L(CG["glass"], "gr2", 0.35)
        frond2 = L(CG["glass2"], "gr3", 0.35)
        for y in range(9, S):
            for x in range(S):
                if hh(x // 2, y // 2, 61 if part == "CONS_GLASS" else 67) < 0.35 + (y - 9) * 0.06:
                    cv.set(x, y, frond if (x + y) % 3 else frond2)
        if part == "CONS_GLASS_LIT":  # lit at night: warm interior
            for y in range(S):
                for x in range(S):
                    p = cv.get(x, y)
                    cv.set(x, y, L(p, "y1", 0.45))
        for x in (0, 8):
            cv.vline(x, 0, S, CG["frame"])
        cv.vline(15, 0, S, CG["frame_d"])
        for y in (0, 8):
            cv.hline(0, y, S, CG["frame"])
        return cv
    # curved roof: quarter-ellipse glazing (L rises to the right, R falls), middle = crown with finials
    for x in range(S):
        if part == "CONS_ROOF_L":
            top = int(round(15 - 13 * (1 - ((15 - x) / 16) ** 2) ** 0.5))
        elif part == "CONS_ROOF_R":
            top = int(round(15 - 13 * (1 - (x / 16) ** 2) ** 0.5))
        else:
            top = 2
        for y in range(top, S):
            cv.set(x, y, CG["glass"] if (x // 4 + y // 4) % 2 else CG["glass2"])
            if (x + y) % 9 == 0:
                cv.set(x, y, CG["hi"])
        cv.set(x, top, CG["frame"])
        if top + 1 < S:
            cv.set(x, top + 1, CG["frame"] if part != "CONS_ROOF" else CG["glass"])
    for x in range(0, S, 4):  # ribs
        for y in range(S):
            if cv.get(x, y)[3]:
                cv.set(x, y, CG["frame"])
    if part == "CONS_ROOF":
        cv.hline(0, 1, S, CG["frame"])
        for x in (3, 11):  # finials
            cv.set(x, 0, CG["frame_d"])
    return cv


def ivy_wall_flat(part):
    cv = tile()
    s = 950 + (0 if part == "IVYW_0" else 13)
    if part == "IVYW_TOP":
        ivy_brick(cv, s)
        cv.rect(0, 0, S, 4, L("b2", "g3", 0.3))
        cv.hline(0, 4, S, L("b3", "ink2", 0.3))
        for y in range(5, S):
            for x in range(S):
                cv.set(x, y, L("gr4", "ink2", 0.3))
        ivy_leaves(cv, s, 0.8, dark=0.3)
        cv.rect(0, 0, S, 4, L("b2", "g3", 0.3))
        for x in range(0, S, 4):
            cv.vline(x, 0, 4, L("b3", "g4", 0.3))
        return cv
    ivy_brick(cv, s)
    for y in range(S):
        for x in range(S):
            if part == "IVYW_0" or not (3 <= x <= 10 and 5 <= y <= 10):  # IVYW_1: a patch of bare brick
                cv.set(x, y, L("gr4", "ink2", 0.3) if (x + y) % 3 else L("gr3", "gr4", 0.6))
    ivy_leaves(cv, s, 0.92 if part == "IVYW_0" else 0.7, dark=0.3)
    return cv


def board_plank():
    """One-way boardwalk plank: thick deck board + a bracket underneath, transparent below."""
    cv = tile()
    cv.hline(0, 0, S, L(BW["p0"], "w", 0.3))
    cv.rect(0, 1, S, 2, BW["p0"])
    cv.rect(0, 3, S, 2, BW["p1"])
    cv.hline(0, 5, S, BW["p3"])
    cv.hline(0, 6, S, "ink2")
    cv.vline(7, 1, 4, BW["p3"])
    cv.set(8, 1, L(BW["p0"], "w", 0.4))
    cv.set(5, 2, "s3"), cv.set(10, 2, "s3")
    # joist stub + diagonal knee brace
    cv.rect(2, 7, 3, 3, BW["beam"])
    cv.hline(2, 7, 3, L(BW["beam"], "wd1", 0.4))
    cv.line(4, 10, 8, 14, BW["p3"])
    cv.line(5, 10, 9, 14, BW["beam"])
    return cv


def board_rail():
    """Boardwalk railing (background): wood posts + two rails."""
    cv = tile()
    for x in (2, 10):
        cv.rect(x, 2, 2, 14, BW["pile"])
        cv.vline(x, 2, 14, BW["pile_l"])
        cv.set(x, 1, BW["p0"]), cv.set(x + 1, 1, BW["p0"])
    for y in (3, 9):
        cv.hline(0, y, S, BW["p0"])
        cv.hline(0, y + 1, S, BW["p2"])
    return cv


def scoreboard(part):
    """Hand-turned scoreboard panel: dark green, 2x2 white number plates per tile (some blank)."""
    cv = tile()
    green, green2 = L("gr3", "t4", 0.4), L("gr4", "t5", 0.45)
    cv.rect(0, 0, S, S, green)
    cv.hline(0, 0, S, L(green, "w", 0.12))
    digits = {"SCORE_L": ("1", "0", "2", None), "SCORE_R": (None, "3", "0", "1")}[part]
    for k, d in enumerate(digits):
        x, y = 1 + (k % 2) * 8, 1 + (k // 2) * 8
        cv.rect(x, y, 6, 7, green2)
        if d is None:
            continue
        cv.rect(x, y, 6, 7, "w")
        cv.hline(x, y + 6, 6, "g1")
        g = FONT3[d]
        for j, row in enumerate(g):
            for i, vv in enumerate(row):
                if vv == "#":
                    cv.set(x + 1 + i + (1 if d == "1" and False else 0), y + 1 + j, "ink2")
    return cv


def hedge():
    cv = tile()
    for y in range(2, S):
        for x in range(S):
            k = (BAYER4[y % 4][x % 4] - 7.5) / 40 + (y - 2) / 14
            cv.set(x, y, "gr1" if k < 0.15 else "gr2" if k < 0.6 else "gr3")
    for x in range(S):  # lumpy top
        top = 1 + int(hh(x // 3, 4, 3) * 3)
        for y in range(0, top + 1):
            cv.set(x, y, T)
        cv.set(x, top + 1, "gr0")
    for i in range(10):
        x, y = int(hh(i, 1, 9) * 15), 4 + int(hh(i, 2, 9) * 11)
        cv.set(x, y, "gr0" if y < 9 else "gr2")
        cv.set(x, y + 1, "gr4")
    return cv


BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def decor_tile2(name):
    cv = tile()
    pre = name[:2]
    if pre in ("GS", "BS") and name[2] == "_":
        rest = name[3:]
        if rest.startswith("WALL"):
            fs_wall(cv, pre, int(rest[-1]))
        elif rest in ("EDGE_L", "EDGE_R"):
            fs_edge(cv, pre, rest[-1])
        elif rest.startswith("CORN"):
            fs_cornice(cv, pre, {"CORN_L": "L", "CORN_R": "R"}.get(rest))
        elif rest in ("WIN", "WIN_LIT"):
            fs_window(cv, pre, rest == "WIN_LIT")
        elif rest.startswith("BAY"):
            fs_bay(cv, pre, rest[-1], "LIT" in rest)
        elif rest == "DOOR":
            fs_door(cv, pre)
        elif rest == "STOOP":
            fs_stoop(cv, pre)
        else:
            raise KeyError(name)
        return cv
    if name.startswith("NEON_"):
        return neon(name)
    if name.startswith("BLEACH"):
        return bleachers(name)
    if name.startswith("SIGN_ADDISON"):
        return sign_addison(name)
    if name.startswith("ZOO_SIGN"):
        return zoo_sign(name)
    if name.startswith("CONS_"):
        return conservatory(name)
    if name.startswith("IVYW"):
        return ivy_wall_flat(name)
    if name == "BOARD_PLANK":
        return board_plank()
    if name == "BOARD_RAIL":
        return board_rail()
    if name.startswith("SCORE"):
        return scoreboard(name)
    if name == "HEDGE":
        return hedge()
    raise KeyError(name)


def terrain_tiles_w2():
    out = {}
    for m in MATERIALS2:
        for s in SUFFIXES:
            out[f"{m}_{s}"] = (lambda mm=m, ss=s: assemble(MATS2[mm], ss))
    for d in DECOR2:
        out[d] = (lambda dd=d: decor_tile2(dd))
    return out


if __name__ == "__main__":
    # quick preview: every new tile at 4x, plus a seam check of each material
    from PIL import Image
    from pxl import PREVIEWS, draw_text, scaled
    names = all_new_names()
    tiles = terrain_tiles_w2()
    cols = 16
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * 16, rows * 16), (90, 98, 128, 255))
    for i, n in enumerate(names):
        sheet.alpha_composite(tiles[n]().im, ((i % cols) * 16, (i // cols) * 16))
    scaled(sheet, 4).save(os.path.join(PREVIEWS, "tiles-w2-sheet.png"))
    print("w2 tiles:", len(names))
