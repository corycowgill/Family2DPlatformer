#!/usr/bin/env python3
"""
Terrain + facade tiles appended to the Chicago tileset (indices 64+).

Every walkable material gets the same 48-slot layout (3 tileset rows, see SUFFIXES):
caps (top / corners / single column), inner corners, one-tile slabs, left/right edges,
undersides, 7 fill variants + 2 rare features near the surface, and darker 'D'
(2-3 tiles below the surface) and 'E' (4+) depth tiers. tools/levels/build-levels.mjs
picks among them from each cell's neighbourhood with a deterministic (x,y) hash.

Facade decor (background layer) is deliberately flatter / lower contrast and never
has a bright top lip, so it can't be mistaken for something to stand on.

Light comes from the top-left. Hard alpha only; colours are the shared palette `P`
plus blends between palette ramps (as the original fills already do).
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from pxl import FONT3, FONT5, Cv, P, T, c, lerp  # noqa: E402

S = 16

SUFFIXES = [
    # row 0 — surface
    "TL", "T0", "T1", "T2", "T3", "TR", "TLR", "IL", "IR", "SL", "S0", "S1", "SR", "SLR", "X0", "X1",
    # row 1 — near-surface body + undersides
    "L", "F0", "F1", "F2", "F3", "F4", "R", "LR", "BL", "B0", "B1", "BR", "BLR", "X2", "X3", "F5",
    # row 2 — depth tiers
    "DL", "D0", "D1", "D2", "D3", "DR", "DLR", "EL", "E0", "E1", "E2", "ER", "ELR", "B2", "B3", "F6",
]
MATERIALS = ["CONC", "LIME", "BRICK", "GIRD", "RWALK", "STONE", "ROOF", "ASPH", "DECK", "WACK"]

DECOR = [
    # brick facade
    "FB_WALL0", "FB_WALL1", "FB_WALL2", "FB_WALL3", "FB_EDGE_L", "FB_EDGE_R", "FB_CORN_L", "FB_CORN",
    "FB_CORN_R", "FB_WIN", "FB_WIN_LIT", "FB_WIN_BLIND", "FB_WIN_AC", "FB_WIN_FE", "FB_FE_RAIL", "FB_FE_STAIR",
    # limestone facade
    "FL_WALL0", "FL_WALL1", "FL_WALL2", "FL_EDGE_L", "FL_EDGE_R", "FL_CORN_L", "FL_CORN", "FL_CORN_R",
    "FL_WIN", "FL_WIN_LIT", "FL_WIN_BLIND", "FL_WIN_AC", "FL_WIN_ARCH", "FL_LEDGE", "FL_LEDGE_L", "FL_LEDGE_R",
    # rooftops, storefront band, vertical marquee
    "WT_TL", "WT_TR", "WT_BL", "WT_BR", "ROOF_HVAC", "ROOF_STACK", "ROOF_ANTENNA", "BAND_L",
    "BAND", "BAND_2", "BAND_R", "SIGN_V_TOP", "SIGN_V1", "SIGN_V2", "SIGN_V3", "SIGN_V4",
    # Lower Wacker, glass, misc
    "LW_WALL0", "LW_WALL1", "LW_LAMP", "LW_EXIT", "LW_SIGN_L", "LW_SIGN_R", "LW_BEAM", "LW_PILLAR",
    "LW_PILLAR_CAP", "LW_PILLAR_BASE", "GLASS_LIT", "GLASS_DARK", "GLASS_FRAME_LIT", "SIGN_CTA", "FB_LEDGE", "FB_WIN_TV",
]


def all_new_names():
    return [f"{m}_{s}" for m in MATERIALS for s in SUFFIXES] + DECOR


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def hh(*a) -> float:
    n = 0x811C9DC5
    for v in a:
        n = ((n ^ (int(v) & 0xFFFFFFFF)) * 16777619) & 0xFFFFFFFF
    n ^= n >> 15
    n = (n * 2246822519) & 0xFFFFFFFF
    n ^= n >> 13
    n = (n * 3266489917) & 0xFFFFFFFF
    n ^= n >> 16
    return (n & 0xFFFF) / 65536.0


def L(a, b, t):
    return lerp(a, b, t)


def tile():
    return Cv(S, S)


def each(fn):
    for y in range(S):
        for x in range(S):
            fn(x, y)


def tint(cv, x, y, col, t):
    p = cv.get(x, y)
    if p[3]:
        cv.set(x, y, L(p, col, t))


def tint_rect(cv, x0, y0, w, h, col, t):
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            tint(cv, x, y, col, t)


def text(cv, x, y, s, col, font=FONT3):
    for ch in s:
        g = font.get(ch)
        for j, row in enumerate(g):
            for i, v in enumerate(row):
                if v == "#":
                    cv.set(x + i, y + j, col)
        x += len(g[0]) + 1


def speckle(cv, seed, rules, y0=0, y1=S):
    """rules: list of (probability, colour or callable(prev)->colour)."""
    for y in range(y0, y1):
        for x in range(S):
            n = hh(x, y, seed)
            acc = 0.0
            for p, col in rules:
                acc += p
                if n < acc:
                    cv.set(x, y, col(cv.get(x, y)) if callable(col) else col)
                    break


def crack(cv, seed, x0, y0, steps, dark, light, dx_bias=0.0):
    x, y = x0, y0
    for i in range(steps):
        cv.set(x, y, dark)
        if 0 <= x + 1 < S and cv.get(x + 1, y) != c(dark):
            tint(cv, x + 1, y, light, 0.55)
        r = hh(seed, i)
        y += 1
        if r < 0.33 + dx_bias:
            x += 1
        elif r > 0.72 + dx_bias:
            x -= 1
        if not (0 <= x < S and 0 <= y < S):
            break
        if hh(seed, i, 9) < 0.12:  # tiny branch
            tint(cv, x - 1, y, dark, 0.6)


def drips(cv, seed, x0, x1, y0, col, t, maxlen=9):
    for x in range(x0, x1):
        if hh(seed, x) < 0.55:
            ln = 2 + int(hh(seed, x, 3) * maxlen)
            for y in range(y0, min(S, y0 + ln)):
                tint(cv, x, y, col, t * (1 - (y - y0) / (ln + 1)))


def star_plate(cv, cx, cy, col="ink2", hi="s3"):
    # Chicago-style star anchor plate (tie-rod end)
    for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (2, -1), (-2, -1), (1, 2), (-1, 2), (0, -2)):
        cv.set(cx + dx, cy + dy, col)
    cv.set(cx, cy, hi)


# ---------------------------------------------------------------------------
# Material definition
# ---------------------------------------------------------------------------
class Mat:
    """body(cv, v): draws the 16x16 fill for variant v ('F0'..'F6','X2','X3').
    cap(cv, v): draws the walkable top band over it for v ('T0'..'T3','X0','X1').
    bottom(cv, v): optional extra underside detail for v ('B0'..'B3')."""

    def __init__(self, key, body, cap, outline, hi, lo, deep, tiers=(0.13, 0.25), bottom=None, cap_h=6, deep_body=None):
        self.key, self.body, self.cap, self.bottom_fn = key, body, cap, bottom
        self.deep_body = deep_body
        self.outline, self.hi, self.lo, self.deep = c(outline), c(hi), c(lo), c(deep)
        self.tiers, self.cap_h = tiers, cap_h


DEPTH_BODY = {"D0": "F0", "D1": "F1", "D2": "F2", "D3": "F4", "E0": "F6", "E1": "F3", "E2": "F5"}


def shade(cv, col, t):
    if t <= 0:
        return
    for y in range(S):
        for x in range(S):
            tint(cv, x, y, col, t)


def edge_left(cv, m, y0=0, cap_rows=0):
    for y in range(y0, S):
        cv.set(0, y, m.outline)
        if y < cap_rows:
            tint(cv, 1, y, "w", 0.35)
        else:
            tint(cv, 1, y, m.hi, 0.42)
    if y0 == 0:
        cv.set(0, 0, T)
        tint(cv, 1, 0, m.outline, 0.35)


def edge_right(cv, m, y0=0, cap_rows=0):
    for y in range(y0, S):
        cv.set(15, y, m.outline)
        tint(cv, 14, y, m.lo, 0.30 if y < cap_rows else 0.40)
    if y0 == 0:
        cv.set(15, 0, T)
        tint(cv, 14, 0, m.outline, 0.4)


def edge_bottom(cv, m, left=False, right=False):
    for x in range(S):
        tint(cv, x, 13, m.lo, 0.18)
        tint(cv, x, 14, m.lo, 0.45)
        cv.set(x, 15, m.outline)
    if left:
        cv.set(0, 15, T)
        cv.set(1, 14, m.outline)
    if right:
        cv.set(15, 15, T)
        cv.set(14, 14, m.outline)


def inner_corner(cv, m, side):
    for y in range(6):
        for x in range(6):
            xx = x if side == "L" else 15 - x
            d = x + y
            k = {0: 0.62, 1: 0.5, 2: 0.36, 3: 0.24, 4: 0.13, 5: 0.06}.get(d, 0)
            if k:
                tint(cv, xx, y, m.lo, k)
    xx = 0 if side == "L" else 15
    for y in range(3):
        tint(cv, xx, y, m.outline, 0.7 - y * 0.2)


def assemble(m: Mat, suf: str) -> Cv:
    cv = tile()
    cap = None
    left = right = bottom = False
    tier = 0
    body = "F0"
    ao = None
    if suf in ("TL", "TR", "TLR"):
        cap = "T0"
        left, right = "L" in suf[1:], "R" in suf[1:]
    elif suf in ("T0", "T1", "T2", "T3", "X0", "X1"):
        cap = suf
    elif suf in ("SL", "S0", "S1", "SR", "SLR"):
        cap = "T1" if suf == "S1" else "T0"
        body = "F1" if suf == "S1" else "F0"
        bottom = True
        left, right = suf in ("SL", "SLR"), suf in ("SR", "SLR")
    elif suf in ("IL", "IR"):
        ao = suf[1]
    elif suf in ("L", "R", "LR"):
        left, right = "L" in suf, "R" in suf
    elif suf in ("BL", "B0", "B1", "BR", "BLR", "B2", "B3"):
        bottom = True
        tier = 1
        left, right = suf in ("BL", "BLR"), suf in ("BR", "BLR")
        body = {"B1": "F1", "B2": "F2", "B3": "F4"}.get(suf, "F0")
    elif suf[0] in "DE" and len(suf) >= 2:
        tier = 1 if suf[0] == "D" else 2
        rest = suf[1:]
        if rest[0].isdigit():
            body = DEPTH_BODY[suf]
        else:
            left, right = "L" in rest, "R" in rest
    else:  # F0..F6, X2, X3
        body = suf
    if tier and m.deep_body and not bottom:
        m.deep_body(cv, body)
    else:
        m.body(cv, body)
    if tier:
        shade(cv, m.deep, m.tiers[tier - 1])
    cap_rows = 0
    if cap:
        m.cap(cv, cap)
        cap_rows = m.cap_h
    if bottom and m.bottom_fn:
        m.bottom_fn(cv, suf if suf in ("B0", "B1", "B2", "B3") else ("B1" if suf == "S1" else "B0"))
    if ao:
        inner_corner(cv, m, ao)
    if left:
        edge_left(cv, m, 0 if cap else 0, cap_rows)
        if not cap:
            cv.set(0, 0, m.outline)
            tint(cv, 1, 0, m.hi, 0.42)
    if right:
        edge_right(cv, m, 0, cap_rows)
        if not cap:
            cv.set(15, 0, m.outline)
    if bottom:
        edge_bottom(cv, m, left, right)
    return cv


# ---------------------------------------------------------------------------
# CONCRETE — sidewalk slab top over a poured foundation
# ---------------------------------------------------------------------------
VSEED = {"F0": 11, "F1": 23, "F2": 37, "F3": 41, "F4": 53, "F5": 67, "F6": 79, "X2": 83, "X3": 97}


CONC_VJ = {"F0": [11], "F1": [], "F2": [4], "F3": [], "F4": [7], "F5": [14], "F6": [2], "X2": [], "X3": []}


def conc_body(cv, v):
    s = VSEED[v]
    base = L("g2", "g1", 0.12)
    cv.rect(0, 0, S, S, base)
    for y in range(S):  # board-form strata, 4px boards
        k = y % 4
        if k == 0:
            cv.hline(0, y, S, L(base, "g1", 0.28))
        elif k == 3:
            cv.hline(0, y, S, L(base, "g3", 0.18))
    for j in CONC_VJ[v]:
        cv.vline(j, 0, S, L(base, "g3", 0.5))
        cv.vline(j + 1, 0, S, L(base, "g1", 0.35))
    speckle(cv, s, [(0.025, L("g2", "g3", 0.7)), (0.05, L("g2", "g3", 0.35)), (0.035, L("g2", "g1", 0.45))])
    # aggregate pebbles
    for i in range(2 if v != "F5" else 7):
        x, y = int(hh(s, i, 1) * 15), int(hh(s, i, 2) * 15)
        cv.set(x, y, L("g1", "l1", 0.2))
        cv.set(x, y + 1, "g3")
    if v == "F1":
        crack(cv, s, 5 + int(hh(s) * 6), 2, 11, L("g2", "g3", 0.85), L("g2", "g1", 0.6))
    elif v == "F2":
        drips(cv, s, 3, 12, 0, "g4", 0.26, 12)
    elif v == "F3":  # shallow spall / pitting
        for i in range(9):
            x, y = 4 + int(hh(s, i) * 7), 5 + int(hh(s, i, 1) * 6)
            cv.set(x, y, L("g2", "g3", 0.6))
            cv.set(x + 1, y + 1, L("g2", "g1", 0.4))
    elif v == "F4":
        for x0 in (3, 11):
            cv.rect(x0, 7, 2, 2, "g4")
            cv.set(x0, 7, "g5")
            cv.set(x0 + 1, 9, L("g2", "g0", 0.5))
        drips(cv, s, 11, 13, 9, "d1", 0.45, 6)
    elif v == "F6":
        crack(cv, s, 11, 6, 5, L("g2", "g3", 0.7), L("g2", "g1", 0.5), -0.1)
    elif v == "X2":  # drain pipe outlet
        cv.disc(7.5, 6.5, 3.2, "g3")
        cv.disc(7.5, 6.5, 2.3, "ink2")
        cv.set(6, 5, "g5")
        for x in range(5, 11):
            cv.set(x, 3, L("g2", "g1", 0.6)) if (x - 7.5) ** 2 < 6 else None
        drips(cv, s, 6, 10, 10, "gr4", 0.4, 6)
    elif v == "X3":  # spalled corner with rusty rebar
        cv.poly([(2, 4), (12, 3), (13, 10), (4, 11)], L("g3", "g4", 0.3))
        cv.hline(3, 4, 9, "g4")
        cv.hline(2, 6, 12, "r3")
        cv.hline(2, 9, 12, "r3")
        for x in range(2, 14, 2):
            cv.set(x, 6, "r2")
            cv.set(x + 1, 9, "r2")
        drips(cv, s, 4, 12, 11, "r3", 0.35, 4)


def conc_cap(cv, v):
    s = VSEED.get(v, 7) + 300
    cv.hline(0, 0, S, "w")
    cv.rect(0, 1, S, 3, "g0")
    for x in range(S):
        if hh(x, 1, s) < 0.12:
            cv.set(x, 1 + int(hh(x, 2, s) * 3), L("g0", "g1", 0.6))
    cv.hline(0, 4, S, "g1")
    cv.hline(0, 5, S, "g4")
    for x in range(S):
        tint(cv, x, 6, "g3", 0.35)
    joints = {"T0": [8], "T1": [2], "T2": [12], "T3": [], "X0": [], "X1": [5]}[v]
    for j in joints:
        cv.vline(j, 1, 3, "g1")
        cv.set(j, 4, "g2")
        cv.set(j + 1, 1, "w")
    if v == "T2":
        for x, y in ((4, 2), (5, 2), (5, 3), (6, 3)):
            cv.set(x, y, "g2")
    if v == "T3":
        for x, y in ((3, 2), (10, 1), (13, 3)):
            cv.set(x, y, L("g1", "g2", 0.5))
    if v == "X0":  # utility cover in the slab
        cv.rect(4, 1, 8, 3, "s2")
        cv.hline(4, 1, 8, "s1")
        cv.hline(4, 3, 8, "s3")
        cv.vline(4, 1, 3, "s3"), cv.vline(11, 1, 3, "s4")
        cv.set(7, 2, "s4"), cv.set(8, 2, "s4")
    if v == "X1":  # tactile strip at a crossing
        for x in range(7, 16):
            cv.set(x, 1, "y1" if x % 2 else "y2")
            cv.set(x, 2, "y2" if x % 2 else "y1")
            cv.set(x, 3, "y3")


# ---------------------------------------------------------------------------
# LIMESTONE — ashlar courses with varied joints, cornice cap
# ---------------------------------------------------------------------------
LIME_J = {"F0": ([6], [12]), "F1": ([3, 11], [8]), "F2": ([10], [2]), "F3": ([5, 13], [9]), "F4": ([7], [1, 12]),
          "F5": ([12], [6]), "F6": ([2, 9], [13]), "X2": ([8], [4]), "X3": ([4, 12], [10])}


def lime_body(cv, v):
    s = VSEED[v] + 5
    j0, j1 = LIME_J[v]
    for y in range(S):
        for x in range(S):
            yy = y % 8
            col = P["l1"]
            if yy == 0:
                col = P["l0"]
            elif yy == 6:
                col = L("l1", "l2", 0.6)
            elif yy == 7:
                col = P["l3"]
            cv.set(x, y, col)
    speckle(cv, s, [(0.05, L("l1", "l2", 0.7)), (0.02, L("l1", "l0", 0.6))])
    for course, js in ((0, j0), (1, j1)):
        for j in js:
            y0 = course * 8
            cv.vline(j, y0, 7, "l3")
            cv.vline(j + 1, y0, 7, L("l1", "l0", 0.6))
            cv.set(j - 1, y0 + 6, "l2")
    if v == "F2":
        drips(cv, s, 2, 9, 1, "l3", 0.35, 12)
    elif v == "F3":
        cv.set(13, 8, "l3"), cv.set(14, 8, "l3"), cv.set(14, 9, "l3"), cv.set(13, 9, "l2")
    elif v == "F4":
        for i in range(7):
            cv.set(int(hh(s, i) * 15), int(hh(s, i, 1) * 15), "l2")
    elif v == "F5":
        x0, x1 = 6 + 1, 16
        for y in range(8, 15):
            for x in range(x0, x1):
                tint(cv, x, y, "l2", 0.3)
    elif v == "X2":  # carved rosette
        cv.ring(11.5, 11.5, 3, "l3")
        cv.disc(11.5, 11.5, 1.2, "l2")
        cv.set(10, 9, "l0"), cv.set(9, 10, "l0")
    elif v == "X3":
        star_plate(cv, 8, 11)


def lime_cap(cv, v):
    cv.hline(0, 0, S, "w")
    cv.rect(0, 1, S, 2, "l0")
    cv.hline(0, 3, S, "l1")
    cv.hline(0, 4, S, "l2")
    cv.hline(0, 5, S, "l4")
    cv.rect(0, 6, S, 2, "l3")
    if v in ("T0", "T2", "X0"):
        for x in range(0, S, 4):
            cv.rect(x + 1, 6, 2, 1, "l1")
            cv.set(x + 1, 7, "l2")
    if v == "T3":
        cv.vline(9, 1, 3, "l2")
        cv.set(10, 1, "w")
    if v == "T2":
        cv.set(5, 1, "l2"), cv.set(6, 2, "l2"), cv.set(6, 3, "l3")
    if v == "T1":
        cv.vline(3, 1, 3, "l2")
    if v == "X0":  # bronze survey disc
        cv.rect(6, 1, 4, 2, "y3")
        cv.hline(6, 1, 4, "y2")
    if v == "X1":  # scupper notch
        cv.rect(10, 4, 3, 2, "l4")
        drips(cv, 5, 10, 13, 6, "l4", 0.4, 6)


# ---------------------------------------------------------------------------
# BRICK — bold running bond with per-brick colour, limestone coping
# ---------------------------------------------------------------------------
def brick_body(cv, v):
    s = VSEED[v] + 9
    for y in range(S):
        row = y // 4
        yy = y % 4
        for x in range(S):
            xo = (x + (4 if row % 2 else 0)) % 8
            if yy == 3 or xo == 7:
                cv.set(x, y, "bm2")
                continue
            bx = (x + (4 if row % 2 else 0)) // 8
            crossing = row % 2 == 1 and (x < 3 or x > 11)
            n = hh(bx, row, s)
            if crossing:
                base = P["b1"]
            elif v == "F1" and n < 0.22:
                base = L("b3", "ink2", 0.25)
            elif v == "F6":
                base = P["b0"] if n < 0.3 else P["b1"] if n < 0.75 else P["b2"]
            else:
                base = P["b1"] if n < 0.55 else (P["b2"] if n < 0.86 else L("b0", "b1", 0.4))
            col = base
            if yy == 0:
                col = L(base, "b0", 0.45)
            elif yy == 2:
                col = L(base, "b3", 0.3)
            if xo == 0 and yy < 2:
                col = L(col, "b0", 0.25)
            cv.set(x, y, col)
    if v == "F2":  # efflorescence
        for y in range(6, 16):
            for x in range(3, 12):
                if hh(x, y, s) < 0.35 + (y - 6) * 0.03:
                    tint(cv, x, y, "bm", 0.35)
    elif v == "F3":  # chipped brick
        cv.rect(1, 9, 4, 2, L("b3", "ink2", 0.4))
        cv.set(1, 9, "b3"), cv.set(4, 10, "b2")
    elif v == "F4":  # repointed mortar
        for y in range(S):
            for x in range(S):
                if cv.get(x, y) == P["bm2"] and 5 <= x <= 13:
                    cv.set(x, y, "bm")
    elif v == "F5":  # soot
        for y in range(S):
            for x in range(S):
                k = max(0.0, 0.42 - ((x - 12) ** 2 + (y - 2) ** 2) / 120)
                tint(cv, x, y, "ink2", k)
    elif v == "X2":
        star_plate(cv, 8, 9, "ink2", "s3")
    elif v == "X3":  # iron vent grille
        cv.rect(4, 4, 8, 7, "ink2")
        for x in range(5, 11, 2):
            cv.vline(x, 5, 5, "s3")
        cv.hline(4, 4, 8, "s2")
        drips(cv, s, 5, 11, 11, "r4", 0.3, 4)


def brick_cap(cv, v):
    cv.hline(0, 0, S, "w")
    cv.hline(0, 1, S, "l0")
    cv.rect(0, 2, S, 2, "l1")
    cv.hline(0, 4, S, "l3")
    cv.hline(0, 5, S, "b3")
    for x in range(S):
        tint(cv, x, 6, "ink2", 0.3)
    j = {"T0": [7], "T1": [3, 12], "T2": [10], "T3": [], "X0": [7], "X1": [7]}[v]
    for x in j:
        cv.vline(x, 1, 3, "l2")
        cv.set(x + 1, 1, "w")
    if v == "T2":
        cv.set(4, 2, "l2"), cv.set(5, 3, "l2"), cv.set(4, 3, "l3")
    if v == "T3":
        for x in (2, 9, 13):
            cv.set(x, 3, "l2")
    if v == "X0":  # moss tuft on the coping
        for x, y in ((11, 1), (12, 1), (12, 2), (13, 2), (11, 2)):
            cv.set(x, y, "gr1" if y == 1 else "gr2")
    if v == "X1":
        cv.rect(2, 4, 3, 2, "ink2")
        drips(cv, 3, 2, 5, 6, "ink2", 0.35, 5)


# ---------------------------------------------------------------------------
# GIRDER — riveted rust-red L steel
# ---------------------------------------------------------------------------
def gird_body(cv, v):
    s = VSEED[v] + 13
    cv.rect(0, 0, S, S, "r2")
    for x in range(S):
        cv.set(x, 0, L("r2", "r1", 0.5))
        cv.set(x, 7, "r1")
        cv.set(x, 8, "r3")
        cv.set(x, 15, "r3")
    speckle(cv, s, [(0.04, L("r2", "r3", 0.5)), (0.025, L("r2", "r1", 0.5))])
    for y in (3, 12):
        for x in range(1, S, 4):
            cv.set(x, y, "r0")
            cv.set(x + 1, y, "r1")
            cv.set(x, y + 1, "r3")
            cv.set(x + 1, y + 1, "r4")
    stiff = {"F1": 7, "F5": 12}.get(v)
    if stiff is not None:
        cv.vline(stiff, 0, S, "r1")
        cv.vline(stiff + 1, 0, S, "r1")
        cv.vline(stiff + 2, 0, S, "r3")
        for y in (2, 5, 10, 13):
            cv.set(stiff + 1, y, "r0")
    if v in ("F2", "F5"):
        drips(cv, s, 0, 16, 5, "r4", 0.45, 9)
    if v == "F3":
        for i in range(6):
            x, y = int(hh(s, i) * 14), int(hh(s, i, 1) * 14)
            cv.rect(x, y, 2, 1, L("r1", "r0", 0.3))
            cv.set(x, y + 1, "s3")
    if v == "F4":
        for y in range(1, 15, 3):
            cv.set(9, y, "r1"), cv.set(9, y + 1, "r4")
    if v == "X3":  # splice plate
        cv.rect(3, 2, 10, 12, L("r2", "r1", 0.35))
        cv.hline(3, 2, 10, "r0")
        cv.vline(3, 2, 12, "r1")
        cv.hline(3, 13, 10, "r4")
        cv.vline(12, 2, 12, "r3")
        for x in (5, 8, 10):
            for y in (4, 8, 11):
                cv.set(x, y, "r0")
                cv.set(x, y + 1, "r4")
    if v == "X2":
        for y in range(9, 14):
            for x in range(4, 12):
                cv.set(x, y, "y1" if ((x + y) // 2) % 2 == 0 else "ink2")
        cv.frame(3, 8, 10, 7, "r4")



def gird_cap(cv, v):
    cv.hline(0, 0, S, "r0")
    cv.rect(0, 1, S, 2, "r1")
    cv.hline(0, 3, S, "r3")
    cv.hline(0, 4, S, "r4")
    for x in range(S):
        tint(cv, x, 5, "r4", 0.4)
    for x in range(2, S, 4):
        cv.set(x, 1, "r0")
        cv.set(x, 2, "r3")
    if v == "T1":
        cv.rect(6, 1, 4, 2, "r2")
        cv.set(6, 1, "r0")
    if v == "T2":
        for x in (4, 5, 11):
            cv.set(x, 2, "r3")
            cv.set(x, 1, L("r1", "r3", 0.5))
    if v == "T3":
        for x in (1, 8, 9, 13):
            cv.set(x, 0, L("r0", "s1", 0.6))
    if v == "X0":
        cv.rect(4, 1, 8, 2, "s3")
        cv.hline(4, 1, 8, "s2")
    if v == "X1":
        cv.rect(10, 0, 3, 3, "y2")
        cv.set(10, 0, "y1")


# ---------------------------------------------------------------------------
# RIVERWALK — granite pavers on dressed granite blocks (algae deep down)
# ---------------------------------------------------------------------------
RW_J = {"F0": ([4], [11]), "F1": ([9], [3, 14]), "F2": ([1, 12], [7]), "F3": ([6], [13]), "F4": ([14], [5]),
        "F5": ([3, 10], [12]), "F6": ([11], [2]), "X2": ([4], [11]), "X3": ([8], [3])}


RW_VJ = {"F0": [9], "F1": [3], "F2": [], "F3": [12], "F4": [6], "F5": [], "F6": [1], "X2": [], "X3": [14]}


def rw_body(cv, v):
    s = VSEED[v] + 17
    base = L("g1", "l2", 0.3)
    for y in range(S):
        for x in range(S):
            col = L(base, "g0", 0.12) if y < 5 else base if y < 12 else L(base, "g2", 0.25)
            cv.set(x, y, col)
    cv.hline(0, 0, S, L(base, "g0", 0.6))
    cv.hline(0, 14, S, L(base, "g3", 0.45))
    cv.hline(0, 15, S, L("g3", "l4", 0.35))
    speckle(cv, s, [(0.035, L(base, "g3", 0.35)), (0.012, L(base, "g3", 0.7)), (0.02, L(base, "w", 0.35))], 1, 14)
    for j in RW_VJ[v]:
        cv.vline(j, 0, 15, L("g3", "l4", 0.35))
        cv.vline(j + 1, 1, 13, L(base, "g0", 0.45))
        cv.set(j - 1, 14, L(base, "g3", 0.6))
    if v == "F2":
        drips(cv, s, 5, 11, 1, "r3", 0.18, 12)
    if v == "F3":  # chipped arris
        for x, y in ((3, 1), (4, 1), (3, 2), (11, 13), (12, 13), (12, 12)):
            cv.set(x, y, L(base, "g3", 0.45))
    if v == "F5":
        drips(cv, s, 0, 16, 1, "gr3", 0.22, 8)
    if v == "X2":  # mooring ring
        cv.ring(7.5, 9.5, 3.2, "s4", 1.2)
        cv.rect(6, 5, 4, 2, "ink2")
        cv.set(5, 8, "s2"), cv.set(5, 9, "s2")
        drips(cv, s, 6, 10, 13, "r3", 0.4, 3)
    if v == "X3":  # bronze plaque
        cv.rect(4, 9, 8, 5, "y3")
        cv.hline(4, 9, 8, "y2")
        cv.hline(4, 13, 8, "y4")
        cv.hline(6, 11, 4, "y4")


def rw_cap(cv, v):
    pav = L("g0", "l0", 0.45)
    cv.hline(0, 0, S, "w")
    cv.rect(0, 1, S, 3, pav)
    speckle(cv, VSEED.get(v, 3) + 400, [(0.08, L(pav, "g2", 0.5))], 1, 4)
    cv.hline(0, 4, S, L("g2", "l3", 0.4))
    cv.hline(0, 5, S, "g3")
    for x in range(S):
        tint(cv, x, 6, "g4", 0.3)
    js = {"T0": [7], "T1": [3, 11], "T2": [13], "T3": [0, 8], "X0": [7], "X1": [7]}[v]
    for j in js:
        cv.vline(j, 1, 3, L("g2", "l2", 0.4))
        cv.set(j + 1, 1, "w") if j + 1 < S else None
    if v == "T2":
        for x in range(2, 6):
            cv.set(x, 3, L(pav, "gr2", 0.3))
    if v == "X0":
        cv.rect(10, 1, 4, 3, "y3")
        cv.hline(10, 1, 4, "y2")
    if v == "X1":
        for x in range(1, 6):
            cv.set(x, 2, "s3" if x % 2 else "ink2")


def rw_bottom(cv, v):
    for x in range(S):
        if hh(x, 7, 91) < 0.5:
            tint(cv, x, 12, "gr3", 0.35)


# ---------------------------------------------------------------------------
# STONE WALL — rough cool rubble, concrete coping
# ---------------------------------------------------------------------------
ST_J = {"F0": ([9], [3, 13]), "F1": ([5, 12], [8]), "F2": ([2], [10]), "F3": ([7, 14], [4]), "F4": ([11], [1, 7]),
        "F5": ([4], [12]), "F6": ([13], [6]), "X2": ([6], [11]), "X3": ([10], [2])}


def stone_body(cv, v):
    s = VSEED[v] + 19
    j0, j1 = ST_J[v]
    cv.rect(0, 0, S, S, "s4")
    for course, js in ((0, j0), (1, j1)):
        y0 = course * 8
        edges = [-1] + js + [S]
        for a, b in zip(edges, edges[1:]):
            x0, x1 = a + 1, b - 1 if b < S else S - 1
            for y in range(y0, y0 + 7):
                for x in range(x0, x1 + 1):
                    col = P["s2"]
                    if y == y0:
                        col = P["s1"]
                    elif y == y0 + 6:
                        col = P["s3"]
                    elif x == x0 and a >= 0:
                        col = L("s2", "s1", 0.5)
                    elif x == x1 and b < S:
                        col = P["s3"]
                    cv.set(x, y, col)
            # rounded stone corners
            if a >= 0:
                cv.set(x0, y0, L("s2", "s3", 0.5))
                cv.set(x0, y0 + 6, "s4")
            if b < S:
                cv.set(x1, y0, L("s2", "s3", 0.3))
                cv.set(x1, y0 + 6, "s4")
    speckle(cv, s, [(0.08, lambda p: L(p, "s3", 0.45) if p[:3] != P["s4"][:3] else p),
                    (0.03, lambda p: L(p, "s1", 0.45) if p[:3] != P["s4"][:3] else p)])
    if v in ("F2", "F5"):
        for x in range(S):
            if hh(x, s) < 0.45:
                cv.set(x, 14, "gr3")
                if hh(x, s, 1) < 0.5:
                    cv.set(x, 13, "gr2")
    if v == "F3":
        crack(cv, s, 4, 8, 7, "s4", "s1")
    if v == "X2":
        cv.disc(7.5, 11, 2.2, "ink")
        cv.ring(7.5, 11, 2.8, "s3")
        drips(cv, s, 6, 10, 13, "gr4", 0.4, 3)
    if v == "X3":
        cv.rect(4, 2, 7, 4, "s1")
        cv.hline(4, 5, 7, "s3")
        cv.hline(5, 3, 4, "s3")


def stone_cap(cv, v):
    cv.hline(0, 0, S, "w")
    cv.rect(0, 1, S, 2, "g0")
    cv.hline(0, 3, S, "g1")
    cv.hline(0, 4, S, "g3")
    cv.hline(0, 5, S, "s4")
    js = {"T0": [10], "T1": [4], "T2": [], "T3": [13], "X0": [10], "X1": [2]}[v]
    for j in js:
        cv.vline(j, 1, 3, "g2")
        cv.set(j + 1, 1, "w")
    if v == "T2":
        for x in (3, 4, 9):
            cv.set(x, 2, "g1")
    if v == "X0":
        cv.rect(5, 1, 3, 3, "s3")
        cv.set(5, 1, "s2")
    if v == "X1":
        for x in range(6, 12):
            cv.set(x, 3, "gr2" if x % 2 else "gr1")


# ---------------------------------------------------------------------------
# ROOF — parapet coping over a slate precast wall (reads unlike the brick facades)
# ---------------------------------------------------------------------------
RF = {"base": L("g4", "s3", 0.55), "lt": L("g3", "s2", 0.5), "dk": L("g5", "s4", 0.5)}
RF_J = {"F0": [11], "F1": [4], "F2": [], "F3": [7], "F4": [13], "F5": [2], "F6": [9], "X2": [], "X3": [5]}


def roof_body(cv, v):
    s = VSEED[v] + 23
    base = RF["base"]
    cv.rect(0, 0, S, S, base)
    speckle(cv, s, [(0.07, L(base, RF["dk"], 0.6)), (0.05, L(base, RF["lt"], 0.5))])
    # horizontal panel reveal (half way) — deep and lit, so it reads as precast panels
    cv.hline(0, 8, S, RF["dk"])
    cv.hline(0, 9, S, L(base, RF["lt"], 0.6))
    for j in RF_J[v]:
        y0 = 0 if j % 2 else 9
        cv.vline(j, y0, 8 if y0 == 0 else 7, RF["dk"])
        cv.vline(j + 1, y0, 8 if y0 == 0 else 7, L(base, RF["lt"], 0.5))
    if v == "F1":
        drips(cv, s, 6, 10, 3, "r3", 0.4, 9)
        cv.set(7, 2, "s3"), cv.set(8, 2, "s4")
    if v == "F2":
        drips(cv, s, 2, 14, 0, RF["dk"], 0.3, 12)
    if v == "X2":  # louvre vent
        cv.rect(3, 2, 10, 6, "ink2")
        for y in range(3, 7):
            cv.hline(4, y, 8, RF["lt"] if y % 2 else "s4")
        cv.hline(3, 2, 10, "s2")
    if v == "F3":
        cv.rect(2, 10, 9, 5, L(base, RF["lt"], 0.15))
        cv.hline(2, 10, 9, L(base, RF["lt"], 0.5))
    if v == "F4":
        for x in (3, 12):
            cv.set(x, 4, "s1"), cv.set(x, 5, "s4")
            cv.set(x, 12, "s1"), cv.set(x, 13, "s4")
    if v == "F5":
        drips(cv, s, 0, 16, 10, RF["dk"], 0.45, 6)
    if v == "X3":  # electrical box
        cv.rect(4, 2, 7, 9, "s2")
        cv.hline(4, 2, 7, "s1")
        cv.vline(10, 2, 9, "s4")
        cv.hline(4, 10, 7, "s4")
        cv.rect(6, 4, 3, 2, "y1")
        cv.vline(7, 11, 5, "ink2")


def roof_cap(cv, v):
    cv.hline(0, 0, S, "s0")
    cv.rect(0, 1, S, 2, "s1")
    cv.hline(0, 3, S, "s2")
    cv.hline(0, 4, S, "s3")
    cv.hline(0, 5, S, "ink2")
    for x in range(S):
        tint(cv, x, 6, "ink2", 0.35)
    js = {"T0": [5], "T1": [12], "T2": [1, 9], "T3": [], "X0": [5], "X1": [12]}[v]
    for j in js:
        cv.vline(j, 1, 4, "s2")
        cv.set(j + 1, 1, "s0")
    if v == "T3":
        for x in (3, 4, 10):
            cv.set(x, 2, L("s1", "r1", 0.25))
    if v == "X0":  # pigeon spikes strip
        for x in range(2, 14, 2):
            cv.set(x, 0, "s3")
            cv.set(x, 1, "s2")
    if v == "X1":  # cable clamp
        cv.rect(7, 1, 3, 4, "ink2")
        cv.set(8, 2, "y1")


# ---------------------------------------------------------------------------
# ASPHALT — road surface (lane paint variants) over the road bed
# ---------------------------------------------------------------------------
def asph_body(cv, v):
    s = VSEED[v] + 29
    cv.rect(0, 0, S, S, "a2")
    speckle(cv, s, [(0.07, L("a2", "a3", 0.7)), (0.05, L("a2", "a1", 0.5)), (0.012, "a0")])
    if v == "F1":
        x = 4 + int(hh(s) * 7)
        for y in range(S):
            cv.set(x, y, "a3")
            cv.set(x + 1, y, L("a3", "a2", 0.4))
            if hh(s, y) < 0.3:
                x += 1 if hh(s, y, 1) < 0.5 else -1
                x = max(1, min(13, x))
        cv.set(x, 5, "a0")
    if v == "F2":
        cv.rect(2, 3, 10, 7, L("a2", "a1", 0.22))
        cv.hline(2, 3, 10, L("a2", "a1", 0.6))
        cv.hline(2, 10, 11, L("a2", "a3", 0.6))
        cv.vline(12, 3, 8, L("a2", "a3", 0.6))
    if v == "F3":
        cv.ellipse(8, 10, 4.5, 2.4, L("a2", "a3", 0.55))
        cv.hline(5, 8, 6, L("a2", "a1", 0.35))
    if v == "F5":
        speckle(cv, s + 1, [(0.12, "g3"), (0.04, "g2")], 8, 16)
    if v == "X2":  # orange utility conduit
        cv.disc(7.5, 8.5, 3.2, "o2")
        cv.disc(7.5, 8.5, 2.0, "ink2")
        cv.set(6, 6, "o1"), cv.set(5, 7, "o1")
    if v == "X3":
        cv.rect(2, 6, 12, 3, "g3")
        cv.hline(2, 6, 12, "g2")
        cv.hline(2, 8, 12, "g4")


def asph_deep(cv, v):
    s = VSEED.get(v, 5) + 700
    base = L("g4", "d2", 0.3)
    cv.rect(0, 0, S, S, base)
    for i in range(22):
        x, y = int(hh(s, i) * 15), int(hh(s, i, 1) * 15)
        col = [L("g3", "d1", 0.3), L("g2", "d0", 0.2), L("g4", "a3", 0.4)][i % 3]
        cv.set(x, y, col)
        if i % 2:
            cv.set(x + 1, y, col)
            cv.set(x, y + 1, L("g5", "d2", 0.4))
    speckle(cv, s, [(0.08, L(base, "a3", 0.5)), (0.04, L(base, "g3", 0.5))])
    if v == "F2":  # a buried stone
        cv.ellipse(9.5, 9, 3, 2, L("g3", "d1", 0.25))
        cv.hline(8, 7, 3, L("g2", "d0", 0.3))


def asph_cap(cv, v):
    cv.hline(0, 0, S, "a0")
    cv.hline(0, 1, S, L("a0", "a1", 0.5))
    cv.rect(0, 2, S, 2, "a1")
    speckle(cv, VSEED.get(v, 2) + 500, [(0.15, "a2"), (0.05, "a0")], 1, 4)
    cv.hline(0, 4, S, "a2")
    cv.hline(0, 5, S, "a3")
    if v == "T1":  # yellow dash
        cv.hline(3, 1, 9, "y1")
        cv.hline(3, 2, 9, "y2")
    if v == "T2":
        cv.set(9, 1, "a3"), cv.set(10, 2, "a3"), cv.set(10, 3, "a3"), cv.set(11, 4, "a3")
    if v == "T3":  # white dash
        cv.hline(8, 1, 6, "g0")
        cv.hline(8, 2, 6, "g1")
    if v == "X0":  # manhole cover edge-on
        cv.rect(2, 0, 12, 2, "g4")
        cv.hline(3, 0, 10, "g3")
        for x in range(3, 13, 2):
            cv.set(x, 0, "g2")
        cv.rect(2, 2, 12, 3, "a3")
        cv.hline(3, 2, 10, "g5")
    if v == "X1":  # storm grate
        cv.rect(3, 0, 10, 4, "ink")
        for x in range(4, 13, 2):
            cv.vline(x, 0, 4, "s3")
        cv.hline(3, 0, 10, "s2")


# ---------------------------------------------------------------------------
# BRIDGE DECK — slate-green riveted plate girder, road plate on top
# ---------------------------------------------------------------------------
SG = [L("s1", "gr2", 0.25), L("s2", "gr3", 0.3), L("s3", "gr3", 0.35), L("s4", "gr4", 0.3)]


def deck_body(cv, v):
    s = VSEED[v] + 31
    cv.rect(0, 0, S, S, SG[2])
    speckle(cv, s, [(0.05, L(SG[2], SG[3], 0.5)), (0.03, L(SG[2], SG[1], 0.5))])
    cv.hline(0, 0, S, SG[1])
    cv.hline(0, 15, S, SG[3])
    for y in (3, 12):
        for x in range(1, S, 4):
            cv.set(x, y, SG[0])
            cv.set(x, y + 1, SG[3])
    st = {"F1": 7, "F3": 2, "F5": 12, "F6": 9}.get(v)
    if st is not None:
        cv.vline(st, 1, 14, SG[0])
        cv.vline(st + 1, 1, 14, SG[1])
        cv.vline(st + 2, 1, 14, SG[3])
    if v == "F2":
        for i in range(5):
            x, y = int(hh(s, i) * 14), 4 + int(hh(s, i, 1) * 9)
            cv.set(x, y, "r2"), cv.set(x + 1, y, "r3"), cv.set(x, y + 1, "r3")
    if v == "F4":
        cv.rect(4, 5, 8, 6, SG[1])
        cv.hline(4, 5, 8, SG[0])
        cv.hline(4, 10, 8, SG[3])
        for x in (5, 10):
            cv.set(x, 7, SG[0]), cv.set(x, 8, SG[3])
    if v == "X2":
        cv.rect(5, 5, 6, 6, "g0")
        cv.frame(5, 5, 6, 6, "ink2")
        text(cv, 7, 6, "7", "ink2")
    if v == "X3":
        drips(cv, s, 3, 13, 5, "r3", 0.35, 9)


def deck_cap(cv, v):
    cv.hline(0, 0, S, "a0")
    cv.rect(0, 1, S, 2, "a1")
    speckle(cv, VSEED.get(v, 2) + 600, [(0.15, "a2")], 1, 3)
    cv.hline(0, 3, S, "ink2")
    cv.hline(0, 4, S, SG[0])
    cv.hline(0, 5, S, SG[1])
    if v == "T1":
        cv.hline(4, 1, 7, "y1")
    if v == "T2":
        cv.vline(8, 0, 3, "s3")  # expansion joint
        cv.vline(9, 0, 3, "s1")
    if v == "T3":
        for x in range(1, S, 4):
            cv.set(x, 4, "s0")
    if v == "X0":
        cv.rect(3, 0, 10, 3, "s3")
        for x in range(3, 13, 2):
            cv.set(x, 1, "ink2")
    if v == "X1":
        cv.hline(2, 1, 12, "g1")


# ---------------------------------------------------------------------------
# LOWER WACKER — dark stained concrete slab; underside carries sodium lamps
# ---------------------------------------------------------------------------
WK = {"base": L("g5", "g4", 0.45), "dk": L("g5", "ink", 0.35), "lt": L("g4", "gr4", 0.2)}


def wack_body(cv, v):
    s = VSEED[v] + 37
    base = WK["base"]
    cv.rect(0, 0, S, S, base)
    speckle(cv, s, [(0.06, WK["dk"]), (0.04, WK["lt"])])
    drips(cv, s, 0, 16, 0, "ink", 0.22, 8)
    cv.hline(0, 15, S, L(base, WK["dk"], 0.5))  # pour joint
    if v == "F1":
        drips(cv, s + 1, 2, 14, 0, "gr4", 0.3, 14)
    if v == "F3":
        crack(cv, s, 7, 0, 16, WK["dk"], WK["lt"])
    if v == "F4":
        for x0 in (3, 11):
            cv.rect(x0, 9, 2, 2, "ink2")
    if v == "F5":
        for x in range(2, 14):
            if hh(x, s) < 0.5:
                tint(cv, x, 15 - int(hh(x, s, 2) * 4), "g2", 0.3)
    if v == "X2":  # tag
        for i, (x, y) in enumerate(((3, 9), (4, 8), (5, 9), (6, 10), (7, 9), (8, 8), (9, 9), (10, 8), (11, 9))):
            cv.set(x, y, "p1" if i % 3 else "cb2")
        cv.set(12, 10, "p1")
    if v == "X3":
        for y in range(9, 13):
            for x in range(2, 14):
                cv.set(x, y, "y2" if ((x + y) // 2) % 2 else "ink2")


def wack_cap(cv, v):
    cv.hline(0, 0, S, "g1")
    cv.rect(0, 1, S, 2, "g2")
    cv.hline(0, 3, S, "g3")
    cv.hline(0, 4, S, "g4")
    cv.hline(0, 5, S, "ink2")
    if v == "T1":
        cv.vline(7, 1, 3, "g3")


def wack_bottom(cv, v):
    if v in ("B1", "B3"):  # recessed sodium lamp
        cv.rect(4, 10, 8, 4, "ink2")
        cv.hline(5, 12, 6, "y2")
        cv.hline(5, 13, 6, "y0" if v == "B1" else "y1")
        cv.set(4, 13, "o1"), cv.set(11, 13, "o1")
        for x in range(3, 13):
            tint(cv, x, 9, "y2", 0.25)
    else:
        cv.hline(0, 12, S, WK["dk"])


MATS = {
    "CONC": Mat("CONC", conc_body, conc_cap, "g5", "g0", "g4", L("g3", "g4", 0.5), tiers=(0.16, 0.3)),
    "LIME": Mat("LIME", lime_body, lime_cap, L("l4", "ink2", 0.45), "l0", "l4", "l3", cap_h=8),
    "BRICK": Mat("BRICK", brick_body, brick_cap, L("b3", "ink", 0.55), "b0", "b3", L("b3", "ink2", 0.3)),
    "GIRD": Mat("GIRD", gird_body, gird_cap, "r4", "r0", "r4", "r4"),
    "RWALK": Mat("RWALK", rw_body, rw_cap, L("g4", "ink2", 0.4), "g0", "g4", L("g4", "gr4", 0.45), bottom=rw_bottom),
    "STONE": Mat("STONE", stone_body, stone_cap, "ink2", "s0", "s4", L("s4", "ink2", 0.3)),
    "ROOF": Mat("ROOF", roof_body, roof_cap, "ink2", RF["lt"], RF["dk"], L("g5", "ink2", 0.3)),
    "ASPH": Mat("ASPH", asph_body, asph_cap, "ink", "a0", "a3", "a3", tiers=(0.06, 0.16), deep_body=asph_deep),
    "DECK": Mat("DECK", deck_body, deck_cap, "ink2", SG[0], SG[3], SG[3]),
    "WACK": Mat("WACK", wack_body, wack_cap, "ink", WK["lt"], "ink2", "ink2", tiers=(0.06, 0.12), bottom=wack_bottom),
}


# ---------------------------------------------------------------------------
# Facade decor — flatter, lower contrast, no lit lips
# ---------------------------------------------------------------------------
FBc = {"brick": L("b2", "g3", 0.32), "brick2": L("b1", "g3", 0.35), "brick3": L("b3", "g4", 0.3),
       "mortar": L("b2", "bm2", 0.38), "stone": L("l2", "g2", 0.35), "stone2": L("l3", "g3", 0.35),
       "stone_dk": L("l4", "g4", 0.4), "trim": L("g1", "l1", 0.3), "frame": L("ink2", "g5", 0.3)}


def fb_wall(cv, v=0):
    s = 400 + v * 17
    for y in range(S):
        row = y // 4
        for x in range(S):
            xo = (x + (4 if row % 2 else 0)) % 8
            if y % 4 == 3 or xo == 7:
                cv.set(x, y, FBc["mortar"])
            else:
                bx = (x + (4 if row % 2 else 0)) // 8
                n = hh(bx, row, s)
                crossing = row % 2 == 1 and (x < 3 or x > 11)
                col = FBc["brick"]
                if not crossing and n < 0.18:
                    col = FBc["brick2"]
                elif not crossing and n > 0.9:
                    col = FBc["brick3"]
                cv.set(x, y, col)
    if v == 1:  # soot streak
        drips(cv, s, 2, 14, 0, "ink2", 0.28, 14)
    if v == 2:
        star_plate(cv, 8, 9, FBc["frame"], FBc["stone2"])
    if v == 3:  # repaired patch (newer, redder brick)
        for y in range(4, 12):
            for x in range(3, 12):
                p = cv.get(x, y)
                if p[:3] != FBc["mortar"][:3]:
                    cv.set(x, y, L(p, "b1", 0.25))


def fb_edge(cv, side):
    fb_wall(cv, 0)
    for y in range(S):
        long = (y // 4) % 2 == 0
        w = 4 if long else 3
        for i in range(w):
            x = i if side == "L" else 15 - i
            col = FBc["stone"] if y % 4 != 3 else FBc["stone2"]
            cv.set(x, y, col)
        xe = (w if side == "L" else 15 - w)
        cv.set(xe, y, FBc["stone2"])
    xo = 0 if side == "L" else 15
    cv.vline(xo, 0, S, FBc["stone_dk"])


def cornice(cv, kind, side=None):
    """kind 'b' brick building (pressed-metal cornice), 'l' limestone (stone cornice)."""
    if kind == "b":
        fb_wall(cv, 0)
        top, mid, dk = L("g2", "l2", 0.3), L("g3", "l3", 0.3), L("g5", "b3", 0.3)
        cv.hline(0, 0, S, mid)
        cv.rect(0, 1, S, 2, top)
        cv.hline(0, 3, S, mid)
        cv.hline(0, 4, S, dk)
        for x in range(S):  # dentils
            cv.set(x, 5, top if x % 3 != 2 else dk)
        cv.hline(0, 6, S, dk)
        for x0 in (2, 10):  # corbel brackets
            cv.rect(x0, 7, 3, 3, mid)
            cv.set(x0 + 1, 9, dk), cv.set(x0 + 2, 8, dk)
            cv.set(x0, 7, top)
        for x in range(S):
            tint(cv, x, 7, "ink2", 0.25)
    else:
        fl_wall(cv, 0)
        top, mid, dk = FBc["stone"], FBc["stone2"], FBc["stone_dk"]
        cv.hline(0, 0, S, mid)
        cv.rect(0, 1, S, 2, top)
        cv.hline(0, 3, S, dk)
        for x in range(S):  # modillions
            cv.set(x, 4, top if x % 4 in (1, 2) else dk)
            cv.set(x, 5, mid if x % 4 in (1, 2) else dk)
        cv.hline(0, 6, S, top)
        for x in range(S):  # egg & dart
            cv.set(x, 7, mid if x % 2 else dk)
        cv.hline(0, 8, S, dk)
        for x in range(S):
            tint(cv, x, 9, "ink2", 0.2)
    if side == "L":
        for y in range(0, 9):
            cv.set(0, y, T if y < 1 else FBc["stone_dk"])
        cv.vline(0, 9, 7, FBc["stone_dk"])
    if side == "R":
        for y in range(0, 9):
            cv.set(15, y, T if y < 1 else FBc["stone_dk"])
        cv.vline(15, 9, 7, FBc["stone_dk"])


def glass_pane(cv, x0, y0, w, h, mode):
    if mode == "dark":
        cv.rect(x0, y0, w, h, L("gl4", "ink2", 0.25))
        cv.rect(x0, y0, w, max(1, h // 3), L("gl3", "gl4", 0.4))
        cv.set(x0 + 1, y0 + 1, L("gl2", "gl3", 0.3))
        if w > 3:
            cv.set(x0 + 2, y0 + 1, L("gl3", "gl4", 0.2))
            cv.set(x0 + w - 2, y0 + h - 2, L("gl3", "gl4", 0.5))
    elif mode == "lit":
        cv.rect(x0, y0, w, h, "y1")
        cv.rect(x0, y0 + h // 2, w, h - h // 2, "y2")
        cv.set(x0, y0, "y0")
        cv.vline(x0 + w - 1, y0, h, "y3")  # curtain edge
    elif mode == "tv":
        cv.rect(x0, y0, w, h, L("gl3", "cb3", 0.5))
        cv.rect(x0, y0 + h // 2, w, h - h // 2, L("gl3", "navy", 0.5))
        cv.set(x0 + 1, y0 + 1, "cb")
    elif mode == "blind":
        glass_pane(cv, x0, y0, w, h, "dark")
        bh = (h * 2) // 3
        cv.rect(x0, y0, w, bh, L("l1", "g1", 0.4))
        for y in range(y0 + 1, y0 + bh, 2):
            cv.hline(x0, y, w, L("l2", "g2", 0.4))
        cv.hline(x0, y0 + bh - 1, w, L("l3", "g3", 0.4))


def fb_window(cv, mode="dark", ac=False, fe=False):
    fb_wall(cv, 0)
    lint = FBc["stone"]
    cv.rect(3, 1, 10, 2, lint)
    cv.hline(3, 2, 10, FBc["stone2"])
    cv.rect(4, 3, 8, 10, FBc["frame"])
    glass_pane(cv, 5, 4, 6, 4, mode if mode != "blind" else "blind")
    glass_pane(cv, 5, 8, 6, 4, mode if mode in ("lit", "tv") else "dark")
    cv.hline(5, 7, 6, FBc["trim"])
    cv.hline(3, 13, 10, FBc["stone"])
    cv.hline(3, 14, 10, FBc["stone_dk"])
    if ac:
        cv.rect(4, 9, 8, 5, L("g1", "g2", 0.5))
        cv.hline(4, 9, 8, "g1")
        for y in (11, 13):
            cv.hline(5, y, 6, "g3")
        cv.vline(11, 9, 5, "g3")
        cv.rect(5, 14, 2, 1, "g4")
        cv.set(9, 15, L("g4", "b3", 0.5))
    if fe:
        fire_escape_rail(cv)


def fire_escape_rail(cv):
    col, dk = L("ink2", "g5", 0.2), "ink"
    cv.hline(0, 8, S, col)
    for x in range(1, S, 3):
        cv.vline(x, 9, 5, col)
    cv.hline(0, 14, S, dk)
    for x in range(0, S, 2):
        cv.set(x, 15, col)
    cv.hline(0, 11, S, L(col, "g4", 0.3))


def fb_stair(cv):
    fb_wall(cv, 0)
    col = L("ink2", "g5", 0.2)
    for i in range(S):
        x = 15 - i
        cv.set(x, i, "ink")
        cv.set(x, i + 1 if i + 1 < S else i, col)
        if i % 3 == 0:
            cv.hline(max(0, x - 2), i, 3, col)
    for i in range(S - 5):  # handrail
        cv.set(15 - i, i + 5 - 6 if i >= 1 else 0, col) if i >= 1 else None
    for i in range(10):
        cv.set(15 - i - 1, max(0, i - 5), col)


def fl_wall(cv, v=0):
    s = 600 + v * 13
    base = FBc["stone"]
    cv.rect(0, 0, S, S, base)
    j = {0: ([5], [12]), 1: ([10], [3]), 2: ([2, 13], [8])}[v]
    for y in range(S):
        if y % 8 == 7:
            cv.hline(0, y, S, FBc["stone2"])
    for course, js in ((0, j[0]), (1, j[1])):
        for x in js:
            cv.vline(x, course * 8, 7, FBc["stone2"])
    speckle(cv, s, [(0.04, L(base, FBc["stone2"], 0.5))])
    if v == 1:
        drips(cv, s, 3, 12, 0, "ink2", 0.22, 14)
    if v == 2:
        drips(cv, s, 9, 14, 8, FBc["stone_dk"], 0.25, 8)


def fl_edge(cv, side):
    fl_wall(cv, 0)
    for y in range(S):
        for i in range(4):
            x = i if side == "L" else 15 - i
            col = L(FBc["stone"], "l1", 0.25)
            if y % 4 == 3:
                col = FBc["stone_dk"]
            cv.set(x, y, col)
        xe = 4 if side == "L" else 11
        cv.set(xe, y, FBc["stone2"])
    cv.vline(0 if side == "L" else 15, 0, S, FBc["stone_dk"])


def fl_window(cv, mode="dark", ac=False, arch=False):
    fl_wall(cv, 0)
    fr = FBc["frame"]
    if arch:
        for y in range(1, 14):
            for x in range(3, 13):
                if y >= 5 or (x - 7.5) ** 2 + (y - 5) ** 2 <= 4.6 ** 2:
                    cv.set(x, y, FBc["stone_dk"])
        for y in range(2, 13):
            for x in range(4, 12):
                if y >= 5 or (x - 7.5) ** 2 + (y - 5) ** 2 <= 3.6 ** 2:
                    cv.set(x, y, L("gl4", "ink2", 0.25))
        cv.vline(7, 2, 11, fr), cv.vline(8, 2, 11, fr)
        cv.set(5, 4, L("gl2", "gl3", 0.3))
        cv.rect(7, 0, 2, 2, L(FBc["stone"], "l1", 0.4))
    else:
        cv.rect(2, 2, 12, 11, FBc["stone_dk"])
        cv.rect(3, 3, 10, 9, fr)
        # Chicago window: narrow sash | wide fixed pane | narrow sash
        glass_pane(cv, 4, 4, 2, 7, mode if mode != "blind" else "dark")
        glass_pane(cv, 7, 4, 3, 7, mode)
        glass_pane(cv, 11, 4, 1, 7, mode if mode != "blind" else "dark")
        cv.hline(4, 7, 2, fr), cv.set(11, 7, fr)
        cv.hline(2, 1, 12, L(FBc["stone"], "l1", 0.3))
    cv.hline(2, 13, 12, L(FBc["stone"], "l1", 0.3))
    cv.hline(2, 14, 12, FBc["stone_dk"])
    if ac:
        cv.rect(6, 8, 6, 5, L("g1", "g2", 0.5))
        cv.hline(6, 8, 6, "g1")
        cv.hline(7, 10, 4, "g3"), cv.hline(7, 12, 4, "g3")
        cv.rect(7, 14, 2, 1, "g4")


def fl_ledge(cv, side=None):
    fl_wall(cv, 1)
    top, mid, dk = L(FBc["stone"], "l1", 0.35), FBc["stone2"], FBc["stone_dk"]
    cv.hline(0, 5, S, mid)
    cv.rect(0, 6, S, 2, top)
    cv.hline(0, 8, S, mid)
    cv.hline(0, 9, S, dk)
    for x in range(S):
        tint(cv, x, 10, "ink2", 0.2)
    if side:
        fl_edge_overlay(cv, side)


def fl_edge_overlay(cv, side):
    for y in list(range(0, 5)) + list(range(10, 16)):
        for i in range(4):
            x = i if side == "L" else 15 - i
            cv.set(x, y, L(FBc["stone"], "l1", 0.25) if y % 4 != 3 else FBc["stone_dk"])
    cv.vline(0 if side == "L" else 15, 0, S, FBc["stone_dk"])


def fb_ledge(cv):
    fb_wall(cv, 0)
    top, mid, dk = FBc["stone"], FBc["stone2"], FBc["stone_dk"]
    cv.hline(0, 6, S, top)
    cv.hline(0, 7, S, top)
    cv.hline(0, 8, S, mid)
    cv.hline(0, 9, S, dk)


# --- rooftop clutter (sits on top of facades, in front of the sky) ----------
def water_tower(part):
    cv = tile()
    wood, wood2, wood3 = L("wd2", "g3", 0.25), L("wd3", "g4", 0.25), L("wd1", "g2", 0.25)
    steel, steel2 = L("s3", "g4", 0.3), "ink2"
    # tank spans x 4..27 (of 32), cone y 2..13 of the top tiles, tank body y 14..(16+9), legs below
    full = Cv(32, 32)
    for y in range(3, 14):  # conical roof
        half = 2 + (y - 3) * 1.15
        for x in range(32):
            if abs(x - 15.5) <= half:
                full.set(x, y, wood3 if x < 15.5 - half / 3 else wood if x < 15.5 + half / 3 else wood2)
    full.set(15, 1, steel2), full.set(16, 1, steel2), full.set(15, 2, steel), full.set(16, 2, steel)
    full.hline(3, 14, 26, steel2)
    for y in range(15, 26):  # staves
        for x in range(4, 28):
            col = wood if x % 3 else wood2
            if x < 7:
                col = wood3 if x % 3 else wood
            if x > 24:
                col = wood2
            full.set(x, y, col)
    for y in (17, 21, 25):
        full.hline(4, y, 24, steel2)
    full.hline(3, 26, 26, steel2)
    for x0 in (6, 15, 24):  # legs
        full.vline(x0, 27, 5, steel2)
        full.vline(x0 + 1, 27, 5, steel)
    full.line(7, 27, 15, 31, steel2)
    full.line(16, 27, 24, 31, steel2)
    full.line(15, 27, 7, 31, steel)
    full.line(24, 27, 16, 31, steel)
    ox, oy = {"WT_TL": (0, 0), "WT_TR": (16, 0), "WT_BL": (0, 16), "WT_BR": (16, 16)}[part]
    cv.blit(full.im.crop((ox, oy, ox + 16, oy + 16)), 0, 0)
    return cv


def roof_hvac():
    cv = tile()
    box, lt, dk = L("s2", "g3", 0.3), L("s1", "g2", 0.3), L("s4", "g5", 0.3)
    cv.rect(1, 7, 14, 9, box)
    cv.hline(1, 7, 14, lt)
    cv.vline(1, 7, 9, lt)
    cv.vline(14, 7, 9, dk)
    for y in range(9, 15, 2):
        cv.hline(3, y, 7, dk)
    cv.disc(11.5, 11, 2, dk)
    cv.rect(4, 4, 4, 3, box)
    cv.hline(4, 4, 4, lt)
    return cv


def roof_stack():
    cv = tile()
    col, lt, dk = L("s3", "g4", 0.3), L("s2", "g3", 0.3), "ink2"
    for x0, top in ((3, 4), (10, 8)):
        cv.rect(x0, top, 3, 16 - top, col)
        cv.vline(x0, top, 16 - top, lt)
        cv.rect(x0 - 1, top - 2, 5, 2, dk)
        cv.hline(x0 - 1, top - 2, 5, lt)
    return cv


def roof_antenna():
    cv = tile()
    col = L("s3", "g4", 0.2)
    cv.vline(7, 0, 16, col)
    for y, w in ((3, 7), (6, 5), (9, 3)):
        cv.hline(7 - w // 2, y, w, col)
    cv.set(7, 0, "cr")  # aircraft light
    cv.ellipse(11.5, 13, 2.5, 2, L("s1", "g2", 0.3))
    cv.set(11, 15, "ink2"), cv.set(12, 15, "ink2")
    return cv


def band(part):
    cv = tile()
    board, trim, dk = L("gr4", "navy", 0.35), "y3", "ink2"
    cv.rect(0, 2, S, 12, board)
    cv.hline(0, 2, S, trim)
    cv.hline(0, 13, S, L("y4", "ink2", 0.3))
    cv.hline(0, 3, S, dk)
    cv.hline(0, 14, S, "ink")
    cv.hline(0, 0, S, FBc["mortar"])
    cv.hline(0, 1, S, FBc["brick"])
    cv.hline(0, 15, S, FBc["frame"])
    if part in ("BAND", "BAND_2"):
        # Blank sign board with a row of marquee bulbs (8 px pitch, so it repeats seamlessly).
        # No lettering: 3-px glyphs on a 16-px tile read as stray characters ("E T").
        lit, dim = ("y1", "y4") if part == "BAND_2" else ("y4", "y1")
        for x, col in ((3, lit), (11, dim)):
            cv.set(x, 8, col), cv.set(x + 1, 8, col)
            cv.set(x, 9, "y3"), cv.set(x + 1, 9, "y3")
    if part == "BAND_L":
        cv.vline(0, 2, 12, trim)
        cv.vline(1, 3, 10, dk)
    if part == "BAND_R":
        cv.vline(15, 2, 12, trim)
        cv.vline(14, 3, 10, dk)
    return cv


MARQUEE = {"SIGN_V1": "CH", "SIGN_V2": "IC", "SIGN_V3": "AG", "SIGN_V4": "O"}


def marquee(part):
    cv = tile()
    fl_wall(cv, 0)  # hangs in front of a limestone facade
    red, red2, gold = "cr2", "cr3", "y1"
    if part == "SIGN_V_TOP":
        cv.rect(3, 9, 10, 7, red)
        cv.vline(3, 9, 7, red2), cv.vline(12, 9, 7, red2)
        cv.ellipse(7.5, 9, 4.5, 3, "y2")
        cv.ellipse(7.5, 8.5, 3, 2, gold)
        cv.vline(7, 2, 5, "y2"), cv.vline(8, 2, 5, "y3")
        cv.set(7, 1, "y0"), cv.set(8, 1, "y0")
        cv.hline(3, 15, 10, "y2")
        for x in (0, 1, 2):
            cv.set(x, 12, "ink2")
        return cv
    letters = MARQUEE[part]
    h = 16 if part != "SIGN_V4" else 11
    cv.rect(3, 0, 10, h, red)
    cv.vline(3, 0, h, red2)
    cv.vline(12, 0, h, red2)
    for y in range(0, h, 2):  # chaser bulbs on the rim
        cv.set(3, y, "y0")
        cv.set(12, y + 1 if y + 1 < h else y, "y0")
    for i, ch in enumerate(letters):
        g = FONT5[ch]
        y0 = 1 + i * 8
        for j, row in enumerate(g):
            for k, vv in enumerate(row):
                if vv == "#":
                    cv.set(5 + k + (1 if len(row) == 3 else 0), y0 + j, gold)
    if part == "SIGN_V4":
        for y in range(11, 15):
            w = 10 - (y - 10) * 2
            cv.hline(8 - w // 2, y, w, red2)
        cv.set(7, 15, "y2"), cv.set(8, 15, "y2")
    for x in (0, 1, 2):
        cv.set(x, 4, "ink2")
    return cv


# --- Lower Wacker -----------------------------------------------------------
LWc = {"wall": L("g5", "gr4", 0.3), "wall2": L("g4", "gr4", 0.35), "dk": L("ink", "gr4", 0.2)}


def lw_wall(cv, v=0):
    cv.rect(0, 0, S, S, LWc["wall"])
    speckle(cv, 700 + v, [(0.08, LWc["dk"]), (0.05, LWc["wall2"])])
    cv.vline(0, 0, S, LWc["dk"])
    cv.hline(0, 15, S, LWc["dk"])
    drips(cv, 701 + v, 1, 15, 0, "ink", 0.3, 10)
    if v == 1:
        for y, col in ((5, "s3"), (6, "s4"), (7, "ink2")):
            cv.hline(0, y, S, L(col, "gr4", 0.3))
        for y, col in ((10, "s3"), (11, "ink2")):
            cv.hline(0, y, S, L(col, "o2", 0.25))


def lw_lamp():
    cv = tile()
    lw_wall(cv, 0)
    for y in range(S):
        for x in range(S):
            d = ((x - 7.5) ** 2 + (y - 6) ** 2) ** 0.5
            if d < 7:
                tint(cv, x, y, "y3", 0.35 * (1 - d / 7))
    cv.rect(5, 3, 6, 4, "ink2")
    cv.hline(6, 6, 4, "y1")
    cv.hline(6, 7, 4, "o0")
    cv.hline(5, 3, 6, "s3")
    return cv


def lw_exit():
    cv = tile()
    lw_wall(cv, 0)
    cv.rect(2, 4, 12, 7, "gr3")
    cv.frame(2, 4, 12, 7, "g1")
    text(cv, 3, 5, "EXI", "w")
    cv.vline(13, 5, 5, "w")  # stub of the T
    cv.hline(12, 5, 2, "w")
    return cv


def lw_sign(part):
    full = Cv(32, 16)
    full.rect(0, 0, 32, 16, LWc["wall"])
    full.rect(1, 2, 30, 12, "gr3")
    full.frame(1, 2, 30, 12, "g0")
    text(full, 6, 3, "LOWER", "w")
    text(full, 4, 8, "WACKER", "w")
    cv = tile()
    cv.blit(full.im.crop((0, 0, 16, 16) if part == "LW_SIGN_L" else (16, 0, 32, 16)), 0, 0)
    return cv


def lw_beam():
    cv = tile()
    lw_wall(cv, 0)
    cv.rect(0, 0, S, 7, L("g4", "gr4", 0.25))
    cv.hline(0, 6, S, "ink")
    cv.hline(0, 7, S, LWc["dk"])
    cv.hline(0, 0, S, L("g3", "gr4", 0.25))
    for x in range(0, S, 8):
        cv.vline(x, 1, 5, LWc["dk"])
    return cv


def lw_pillar(part):
    cv = tile()
    base, lt, dk = L("g3", "gr4", 0.2), L("g2", "gr3", 0.2), L("g5", "gr4", 0.2)
    x0, w = 3, 10
    if part == "LW_PILLAR_CAP":
        for y in range(S):
            ww = w + max(0, (8 - y)) * 0.75
            xa = int(round(8 - ww / 2))
            cv.hline(xa, y, int(round(ww)), base)
            cv.set(xa, y, lt)
            cv.set(xa + int(round(ww)) - 1, y, dk)
        cv.hline(0, 0, S, dk)
        return cv
    cv.rect(x0, 0, w, S, base)
    cv.vline(x0, 0, S, lt)
    cv.vline(x0 + 1, 0, S, L(base, lt, 0.5))
    cv.vline(x0 + w - 1, 0, S, dk)
    cv.vline(x0 + w - 2, 0, S, L(base, dk, 0.5))
    drips(cv, 733, x0 + 2, x0 + w - 2, 0, "ink2", 0.3, 12)
    if part == "LW_PILLAR_BASE":
        for y in range(6, 14):
            for x in range(x0, x0 + w):
                cv.set(x, y, "y1" if ((x + y) // 3) % 2 == 0 else "ink2")
        cv.hline(x0, 14, w, dk)
        cv.hline(x0 - 1, 15, w + 2, "ink2")
    return cv


def glass_variant(name):
    from draw_tiles import glass, glass_frame  # noqa: WPS433 (shared periodic pattern)
    cv = tile()
    if name == "GLASS_FRAME_LIT":
        cv = glass_frame()
    else:
        for y in range(S):
            for x in range(S):
                cv.set(x, y, glass(x, y))
    if name in ("GLASS_LIT", "GLASS_FRAME_LIT"):
        for y in range(2 if name == "GLASS_FRAME_LIT" else 1, 15):
            for x in range(S):
                if x % 8 not in (0,) and not (name == "GLASS_FRAME_LIT" and x < 2) and x != 8:
                    col = "y1" if y < 9 else "y2"
                    if x % 8 == 1:
                        col = "y0"
                    cv.set(x, y, col)
        cv.hline(0, 15, S, "gl4")
        # silhouettes of desks/people
        cv.rect(10, 11, 4, 4, "y3")
        cv.rect(11, 9, 2, 2, "y3")
    if name == "GLASS_DARK":
        for y in range(S):
            for x in range(S):
                tint(cv, x, y, "ink2", 0.45)
    return cv


def sign_cta():
    cv = tile()
    cv.rect(1, 3, 14, 10, "cb3")
    cv.frame(1, 3, 14, 10, "w")
    text(cv, 3, 5, "CTA", "w")
    cv.hline(3, 11, 10, "cr")
    cv.vline(7, 13, 3, "ink2"), cv.vline(8, 13, 3, "s3")
    return cv


def decor_tile(name):
    cv = tile()
    if name.startswith("FB_WALL"):
        fb_wall(cv, int(name[-1]))
    elif name in ("FB_EDGE_L", "FB_EDGE_R"):
        fb_edge(cv, name[-1])
    elif name.startswith("FB_CORN"):
        cornice(cv, "b", {"FB_CORN_L": "L", "FB_CORN_R": "R"}.get(name))
    elif name == "FB_WIN":
        fb_window(cv, "dark")
    elif name == "FB_WIN_LIT":
        fb_window(cv, "lit")
    elif name == "FB_WIN_TV":
        fb_window(cv, "tv")
    elif name == "FB_WIN_BLIND":
        fb_window(cv, "blind")
    elif name == "FB_WIN_AC":
        fb_window(cv, "dark", ac=True)
    elif name == "FB_WIN_FE":
        fb_window(cv, "dark", fe=True)
    elif name == "FB_FE_RAIL":
        fb_wall(cv, 0)
        fire_escape_rail(cv)
    elif name == "FB_FE_STAIR":
        fb_stair(cv)
    elif name == "FB_LEDGE":
        fb_ledge(cv)
    elif name.startswith("FL_WALL"):
        fl_wall(cv, int(name[-1]))
    elif name in ("FL_EDGE_L", "FL_EDGE_R"):
        fl_edge(cv, name[-1])
    elif name.startswith("FL_CORN"):
        cornice(cv, "l", {"FL_CORN_L": "L", "FL_CORN_R": "R"}.get(name))
    elif name == "FL_WIN":
        fl_window(cv, "dark")
    elif name == "FL_WIN_LIT":
        fl_window(cv, "lit")
    elif name == "FL_WIN_BLIND":
        fl_window(cv, "blind")
    elif name == "FL_WIN_AC":
        fl_window(cv, "dark", ac=True)
    elif name == "FL_WIN_ARCH":
        fl_window(cv, "dark", arch=True)
    elif name == "FL_LEDGE":
        fl_ledge(cv)
    elif name in ("FL_LEDGE_L", "FL_LEDGE_R"):
        fl_ledge(cv, name[-1])
    elif name.startswith("WT_"):
        cv = water_tower(name)
    elif name == "ROOF_HVAC":
        cv = roof_hvac()
    elif name == "ROOF_STACK":
        cv = roof_stack()
    elif name == "ROOF_ANTENNA":
        cv = roof_antenna()
    elif name.startswith("BAND"):
        cv = band(name)
    elif name.startswith("SIGN_V"):
        cv = marquee(name)
    elif name.startswith("LW_WALL"):
        lw_wall(cv, int(name[-1]))
    elif name == "LW_LAMP":
        cv = lw_lamp()
    elif name == "LW_EXIT":
        cv = lw_exit()
    elif name.startswith("LW_SIGN"):
        cv = lw_sign(name)
    elif name == "LW_BEAM":
        cv = lw_beam()
    elif name.startswith("LW_PILLAR"):
        cv = lw_pillar(name)
    elif name.startswith("GLASS"):
        cv = glass_variant(name)
    elif name == "SIGN_CTA":
        cv = sign_cta()
    else:
        raise KeyError(name)
    return cv


def terrain_tiles():
    out = {}
    for m in MATERIALS:
        for s in SUFFIXES:
            out[f"{m}_{s}"] = (lambda mm=m, ss=s: assemble(MATS[mm], ss))
    for d in DECOR:
        out[d] = (lambda dd=d: decor_tile(dd))
    return out
