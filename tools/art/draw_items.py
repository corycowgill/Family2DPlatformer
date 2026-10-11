#!/usr/bin/env python3
"""
items atlas (pickups, blocks, checkpoint, goal) and ui atlas (HUD icons, touch buttons,
map nodes). Writes public/assets/{items,ui}.{png,json} + art/previews/{items,ui}.png
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from pxl import ASSETS, PREVIEWS, Cv, FONT3, T, c, contact_sheet, draw_text, lerp, pack_atlas  # noqa: E402


def star6(cv, cx, cy, R, r, col, rot=-90):
    pts = []
    for i in range(12):
        a = math.radians(rot + i * 30)
        rad = R if i % 2 == 0 else r
        pts.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
    cv.poly(pts, col)


def star5(cv, cx, cy, R, r, col, rot=-90):
    pts = []
    for i in range(10):
        a = math.radians(rot + i * 36)
        rad = R if i % 2 == 0 else r
        pts.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
    cv.poly(pts, col)


# ---------------------------------------------------------------------------
# Coin (6 frame spin)
# ---------------------------------------------------------------------------
def coin(i):
    cv = Cv(16, 16)
    widths = [6.0, 4.6, 2.6, 0.9, 2.6, 4.6]
    rx = widths[i]
    cx, cy, ry = 7.5, 7.5, 6.0
    if rx < 1.5:
        cv.rect(7, 2, 2, 12, "y2")
        cv.vline(7, 2, 12, "y0")
        cv.vline(8, 3, 10, "y3")
        cv.outline("ink")
        return cv
    cv.ellipse(cx, cy, rx, ry, "y3")
    cv.ellipse(cx - (0.5 if i < 3 else -0.5), cy, max(0.5, rx - 1), ry - 1, "y1")
    # inner rim & emblem (six-point star) only when facing
    if rx >= 4:
        cv.ellipse(cx, cy, rx - 2, ry - 2, "y2")
        cv.ellipse(cx, cy, rx - 2.6, ry - 2.6, "y1")
        star6(cv, cx, cy, min(rx - 2.4, 3.6), 1.6, "y3")
        cv.set(int(cx), int(cy) - 1, "y2")
    elif rx >= 2:
        cv.vline(int(cx), 4, 8, "y3")
    # highlight
    hx = int(cx - rx + 1.5) if i < 3 else int(cx + rx - 2.5)
    cv.vline(hx, 4, 3, "y0")
    cv.set(hx + (1 if i < 3 else -1), 3, "y0") if rx > 3 else None
    cv.outline("ink")
    return cv


def star_item(i):
    cv = Cv(16, 16)
    scale = [1.0, 0.92, 1.0, 1.06][i]
    R = 7.2 * scale
    star5(cv, 7.5, 8.2, R, R * 0.48, "y3")
    star5(cv, 7.5, 7.8, R - 1.2, (R - 1.2) * 0.48, "y1")
    star5(cv, 7.0, 7.2, (R - 1.2) * 0.55, (R - 1.2) * 0.26, "y0")
    # eyes
    cv.vline(6, 7, 2, "ink"), cv.vline(9, 7, 2, "ink")
    cv.outline("ink")
    sp = [(2, 2), (13, 3), (13, 13), (1, 12)][i]
    cv.set(sp[0], sp[1], "w")
    for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        cv.set(sp[0] + d[0], sp[1] + d[1], "y0") if cv.get(sp[0] + d[0], sp[1] + d[1])[3] == 0 else None
    return cv


def question(i):
    cv = Cv(16, 16)
    cv.rect(0, 0, 16, 16, "ink")
    cv.rect(1, 1, 14, 14, "y2")
    cv.hline(1, 1, 14, "y0")
    cv.vline(1, 1, 14, "y1")
    cv.hline(1, 14, 14, "y3")
    cv.vline(14, 1, 14, "y3")
    for x, y in ((2, 2), (13, 2), (2, 13), (13, 13)):
        cv.set(x, y, "y4")
    # '?' glyph with drop shadow
    q = [".####.", "##..##", "....##", "...##.", "..##..", "......", "..##.."]
    for j, row in enumerate(q):
        for k, ch in enumerate(row):
            if ch == "#":
                cv.set(5 + k + 1, 4 + j + 1, "y4")
    for j, row in enumerate(q):
        for k, ch in enumerate(row):
            if ch == "#":
                cv.set(5 + k, 4 + j, "w" if j < 2 else "y0")
    # shimmer sweep
    sweep = [None, 3, 7, 11][i]
    if sweep is not None:
        for k in range(14):
            x, y = sweep + k - 6, 1 + k
            for dx in (0, 1):
                xx = x + dx
                if 2 <= xx <= 13 and 2 <= y <= 13:
                    col = cv.get(xx, y)
                    if col == c("y2"):
                        cv.set(xx, y, "y1")
    return cv


def hotdog():
    cv = Cv(16, 16)
    # Chicago-style: poppy seed bun, yellow mustard, neon relish, tomato, pickle
    cv.ellipse(7.5, 10.5, 7, 3.0, "bun1")
    cv.ellipse(7.5, 9.8, 6.6, 2.2, "bun0")
    cv.rect(1, 6, 14, 3, "o2")       # sausage
    cv.hline(1, 6, 14, "o1")
    cv.hline(1, 8, 14, "b3")
    cv.set(0, 7, "o2"), cv.set(15, 7, "o2")
    # mustard zigzag
    for x in range(1, 15):
        cv.set(x, 6 + (x % 2), "mus")
    # relish + tomato + pickle
    for x in (3, 7, 11):
        cv.set(x, 5, "rel"), cv.set(x + 1, 5, "gr1")
    cv.rect(5, 4, 2, 2, "tom"), cv.set(5, 4, "pk")
    cv.rect(9, 4, 4, 1, "gr2"), cv.set(9, 3, "gr1")
    for x, y in ((3, 10), (6, 11), (10, 10), (12, 11)):
        cv.set(x, y, "bun2")
    cv.outline("ink")
    return cv


def pizza():
    cv = Cv(16, 16)
    # Chicago deep dish slice (side-ish 3/4 view): tall crust, chunky tomato on top, cheese layer
    cv.poly([(1, 5), (14, 3), (15, 5), (15, 13), (2, 14), (1, 12)], "bun1")
    cv.poly([(2, 5), (14, 3.5), (14.5, 7), (2, 9)], "tom")
    cv.poly([(2, 9), (14.5, 7), (14.5, 9), (2, 11)], "y1")
    cv.hline(2, 11, 13, "bun0")
    cv.hline(2, 12, 13, "bun1")
    cv.hline(2, 13, 13, "bun2")
    for x, y in ((4, 6), (8, 5), (11, 5), (6, 7), (12, 6)):
        cv.set(x, y, "cr2")
    for x, y in ((5, 5), (10, 5)):
        cv.set(x, y, "o0")
    cv.set(7, 6, "gr2"), cv.set(12, 5, "gr2")
    for x, y in ((4, 10), (9, 9), (12, 8)):
        cv.set(x, y, "y0")
    cv.vline(15, 5, 8, "bun2")
    cv.outline("ink")
    return cv


def cta_pass():
    cv = Cv(16, 16)
    cv.rect(1, 3, 14, 10, "cb3")
    cv.rect(1, 3, 14, 3, "w")
    cv.hline(1, 6, 14, "cr")
    cv.hline(1, 3, 14, "s0")
    draw_text(cv, 3, 7, "CTA", "w")
    cv.rect(12, 8, 2, 3, "y1")
    cv.set(12, 8, "y0")
    cv.hline(2, 12, 12, "navy")
    cv.outline("ink")
    return cv


def one_up():
    cv = Cv(16, 16)
    star6(cv, 7.5, 7.5, 7.6, 3.4, "cr2")
    star6(cv, 7.5, 7.0, 6.6, 2.9, "cr")
    star6(cv, 7.0, 6.5, 3.2, 1.4, "pk")
    cv.set(6, 5, "w")
    cv.outline("ink")
    return cv


def souvenir_bean():
    cv = Cv(16, 16)
    cv.ellipse(7.5, 8.5, 7, 4.2, "s3")
    cv.ellipse(7.0, 8.0, 6.2, 3.4, "s1")
    cv.ellipse(6.0, 7.0, 3.6, 1.6, "s0")
    cv.hline(4, 6, 3, "w")
    cv.rect(5, 11, 6, 2, T)  # the arch under the bean
    cv.hline(5, 10, 6, "s3")
    cv.set(4, 11, "s2"), cv.set(11, 11, "s2")
    cv.hline(9, 9, 3, "cb")  # sky reflection
    cv.outline("ink")
    return cv


def souvenir_lion():
    """Art Institute lion: bronze-green patina, standing, facing right, on a pedestal."""
    cv = Cv(16, 16)
    pat, pat_d, pat_l = lerp("t2", "gr2", 0.35), lerp("t3", "gr3", 0.4), lerp("t1", "gr1", 0.35)
    mane = lerp("t4", "gr3", 0.3)
    cv.rect(1, 13, 14, 3, "l2")
    cv.hline(1, 13, 14, "l0")
    cv.hline(1, 15, 14, "l3")
    cv.rect(2, 6, 9, 4, pat)          # body
    cv.hline(3, 6, 7, pat_l)
    cv.hline(2, 9, 9, pat_d)
    for x in (2, 4, 8, 10):           # legs
        cv.vline(x, 10, 3, pat if x in (2, 8) else pat_d)
    cv.ellipse(11.0, 5.0, 3.8, 4.2, mane)  # mane
    cv.rect(12, 4, 3, 3, pat)         # face/muzzle
    cv.set(14, 6, pat_d), cv.set(15, 5, pat), cv.set(15, 6, pat_d)
    cv.set(13, 4, "ink")              # eye
    cv.set(11, 2, pat_l), cv.set(10, 3, pat_l)
    cv.line(1, 6, 0, 3, pat)          # tail
    cv.set(0, 2, mane)
    cv.outline("ink")
    return cv


def souvenir_willis():
    cv = Cv(16, 16)
    dk, md, lt = "g5", "g4", "s2"
    cv.rect(4, 6, 8, 9, md)
    cv.rect(6, 3, 6, 3, md)
    cv.rect(6, 1, 4, 2, md)
    cv.rect(10, 3, 2, 12, dk)
    cv.vline(4, 6, 9, lt), cv.vline(6, 1, 5, lt)
    for y in range(7, 14, 2):
        for x in (5, 7, 9):
            cv.set(x, y, "cb")
    cv.vline(7, 0, 1, "s1")
    cv.vline(9, 0, 1, "s1")
    cv.rect(2, 14, 12, 2, "y2")
    cv.hline(2, 14, 12, "y1")
    cv.outline("ink")
    cv.set(7, 0, "w"), cv.set(9, 0, "cr")
    return cv


def block_used():
    cv = Cv(16, 16)
    cv.rect(0, 0, 16, 16, "ink")
    cv.rect(1, 1, 14, 14, "d1")
    cv.hline(1, 1, 14, "d0")
    cv.vline(1, 1, 14, "d0")
    cv.hline(1, 14, 14, "d2")
    cv.vline(14, 1, 14, "d2")
    for x, y in ((3, 3), (12, 3), (3, 12), (12, 12)):
        cv.set(x, y, "wd4"), cv.set(x - 1, y - 1, "d0")
    return cv


def brick_block():
    cv = Cv(16, 16)
    cv.rect(0, 0, 16, 16, "b3")
    for row in range(4):
        y = row * 4
        off = 0 if row % 2 == 0 else 4
        for bx in range(-8, 16, 8):
            x0 = bx + off
            for yy in range(y, y + 3):
                for xx in range(max(0, x0), min(16, x0 + 7)):
                    cv.set(xx, yy, "b1")
            for xx in range(max(0, x0), min(16, x0 + 7)):
                cv.set(xx, y, "b0")
            if 0 <= x0 + 6 < 16:
                cv.vline(x0 + 6, y + 1, 2, "b2")
            for xx in range(max(0, x0), min(16, x0 + 7)):
                cv.set(xx, y + 2, "b2")
    cv.frame(0, 0, 16, 16, "ink")
    return cv


def bounce_pad(i):
    cv = Cv(16, 16)
    # base
    cv.rect(1, 13, 14, 3, "s3")
    cv.hline(1, 13, 14, "s1")
    top = 4 if i == 0 else 9
    # spring coils
    for y in range(top + 3, 13):
        if (y - top) % 2 == 0:
            cv.hline(4, y, 8, "s1")
            cv.set(4, y, "s0")
        else:
            cv.hline(5, y, 6, "s3")
    # pad
    cv.rect(0, top, 16, 3, "cr")
    cv.hline(0, top, 16, "pk")
    cv.hline(0, top + 2, 16, "cr2")
    for x in (3, 7, 11):
        cv.set(x, top + 1, "y1")
    cv.outline("ink")
    return cv


STAR5 = ["..#..", "#####", ".###.", "#####", "..#.."]
STAR3 = [".#.", "###", ".#."]


def chicago_flag(big=True, wave=0.0):
    """Chicago flag: white field, two light-blue stripes, four red six-point stars.
    big: 25x15 with 5x5 stars; small: 15x11 with 3x3 stars."""
    if big:
        w, h, stripes, srow, pat, step = 25, 15, (2, 11), 5, STAR5, 6
    else:
        w, h, stripes, srow, pat, step = 15, 11, (1, 8), 4, STAR3, 4
    cv = Cv(w, h)
    cv.rect(0, 0, w, h, "w")
    for y0 in stripes:
        cv.rect(0, y0, w, 2, "cb")
    for k in range(4):
        x0 = 1 + k * step if big else k * step
        for j, row in enumerate(pat):
            for i, ch in enumerate(row):
                if ch == "#":
                    cv.set(x0 + i, srow + j, "cr")
    if wave is not None:
        for x in range(w):
            ph = math.sin((x / w) * math.pi * 2 + wave)
            if ph > 0.6:
                for y in range(h):
                    cv.set(x, y, lerp(cv.get(x, y)[:3], "ffffff", 0.3))
            elif ph < -0.6:
                for y in range(h):
                    cv.set(x, y, lerp(cv.get(x, y)[:3], "56648a", 0.2))
    return cv


def checkpoint(on):
    cv = Cv(34, 48)
    # pole (centred on x=17)
    cv.rect(16, 3, 2, 42, "s1")
    cv.vline(16, 3, 42, "s0")
    cv.disc(16.5, 2.5, 1.6, "y1" if on else "g2")
    cv.set(16, 1, "y0" if on else "g1")
    # base
    cv.rect(12, 44, 10, 4, "g2")
    cv.hline(12, 44, 10, "g1")
    cv.rect(13, 43, 8, 1, "g3")
    if on:
        cv.blit(chicago_flag(False, 0.8), 18, 4)
    else:
        f = Cv(12, 9)
        for x in range(12):
            droop = x // 3
            for y in range(droop, 9 - (x // 6)):
                f.set(x, y, "g1" if y not in (1 + droop, 6) else "g2")
        f.set(3, 4, "g3"), f.set(7, 5, "g3")
        cv.blit(f, 18, 30)
    cv.outline("ink")
    return cv


def goal_pole(flag=None):
    W = 54
    cv = Cv(W, 96)
    px = 25  # pole spans px..px+3, centred on the frame
    # stone base
    cv.rect(px - 9, 86, 22, 10, "l1")
    cv.hline(px - 9, 86, 22, "l0")
    cv.rect(px - 9, 92, 22, 4, "l2")
    cv.vline(px + 12, 86, 10, "l3")
    cv.rect(px - 6, 82, 16, 4, "l2")
    cv.hline(px - 6, 82, 16, "l0")
    cv.rect(px - 4, 89, 12, 2, "cb")  # blue plaque
    # pole
    cv.rect(px, 9, 4, 73, "s1")
    cv.vline(px, 9, 73, "s0")
    cv.vline(px + 3, 9, 73, "s3")
    for y in range(16, 82, 12):
        cv.hline(px, y, 4, "s2")
    # gold six-point finial
    star6(cv, px + 1.5, 4.5, 4.8, 2.1, "y2")
    star6(cv, px + 1.2, 4.2, 3.1, 1.3, "y1")
    cv.set(px + 1, 3, "y0")
    cv.outline("ink")
    f = flag or chicago_flag(True, 1.0)
    f.outline("ink")
    cv.paste_over(f, px + 3, 10)
    return cv


def goal_flag():
    f = chicago_flag(True, 0.3)
    cv = Cv(27, 17)
    cv.blit(f, 1, 1)
    cv.outline("ink")
    return cv


def w_flag(wave=0.0):
    """Ballpark win flag: white field, bold blue W (World 2 goal variant). 25x15 like the Chicago flag."""
    w, h = 25, 15
    cv = Cv(w, h)
    cv.rect(0, 0, w, h, "w")
    for (x0, y0, x1, y1) in ((6, 3, 9, 11), (9, 11, 12, 5), (12, 5, 15, 11), (15, 11, 18, 3)):
        for dx in (0, 1):
            cv.line(x0 + dx, y0, x1 + dx, y1, "1e4c9a")
    for x in range(w):
        ph = math.sin((x / w) * math.pi * 2 + wave)
        if ph > 0.6:
            for y in range(h):
                cv.set(x, y, lerp(cv.get(x, y)[:3], "ffffff", 0.3))
        elif ph < -0.6:
            for y in range(h):
                cv.set(x, y, lerp(cv.get(x, y)[:3], "56648a", 0.2))
    return cv


def goal_pole_w():
    """goal_pole with the W flag (same 54x96 frame, pole and base)."""
    cv = goal_pole(flag=w_flag(1.0))
    return cv


def goal_flag_w():
    f = w_flag(0.3)
    cv = Cv(27, 17)
    cv.blit(f, 1, 1)
    cv.outline("ink")
    return cv


# ---------------------------------------------------------------------------
# UI
# ---------------------------------------------------------------------------
HEART = [
    ".##...##.",
    "####.####",
    "#########",
    "#########",
    ".#######.",
    "..#####..",
    "...###...",
    "....#....",
]


def heart(full):
    cv = Cv(11, 10)
    for j, row in enumerate(HEART):
        for i, ch in enumerate(row):
            if ch == "#":
                cv.set(i + 1, j + 1, "cr" if full else "g4")
    if full:
        cv.set(2, 2, "w"), cv.set(3, 2, "pk"), cv.set(2, 3, "pk")
        for i in range(2, 9):
            pass
        for (x, y) in ((8, 4), (7, 5), (6, 6), (8, 3)):
            cv.set(x, y, "cr2")
    else:
        cv.set(2, 2, "g3"), cv.set(3, 2, "g3")
    cv.outline("ink")
    return cv


def coin_icon():
    cv = Cv(12, 12)
    cv.ellipse(5.5, 5.5, 4.5, 4.8, "y3")
    cv.ellipse(5.2, 5.2, 3.6, 3.9, "y1")
    star6(cv, 5.5, 5.5, 2.6, 1.2, "y3")
    cv.vline(2, 3, 3, "y0")
    cv.outline("ink")
    return cv


def star_icon():
    cv = Cv(12, 12)
    star5(cv, 5.5, 6.0, 5.4, 2.6, "y2")
    star5(cv, 5.3, 5.6, 4.2, 2.0, "y1")
    cv.set(4, 4, "y0"), cv.set(5, 3, "y0")
    cv.outline("ink")
    return cv


def souvenir_icon(empty):
    cv = Cv(12, 12)
    cv.ellipse(5.5, 6.0, 5, 3.2, "s3" if not empty else "g4")
    cv.ellipse(5.0, 5.6, 4.2, 2.5, "s1" if not empty else "g4")
    if not empty:
        cv.hline(3, 4, 3, "w")
        cv.hline(6, 7, 3, "cb")
    cv.rect(3, 8, 5, 2, T)
    cv.outline("ink")
    if empty:
        # hollow look
        cv.ellipse(5.0, 5.6, 3.0, 1.4, "g5")
    return cv


def lock():
    cv = Cv(12, 14)
    cv.ring(5.5, 5.0, 3.6, "s2", 1.6)
    cv.rect(0, 5, 12, 2, T)
    cv.rect(1, 6, 10, 7, "y2")
    cv.hline(1, 6, 10, "y0")
    cv.hline(1, 12, 10, "y3")
    cv.rect(5, 8, 2, 3, "ink")
    cv.set(5, 8, "ink2")
    cv.outline("ink")
    return cv


def button(kind):
    S = 32
    cv = Cv(S, S)
    # soft disc, white rim (semi-transparent friendly: mostly light greys)
    cv.disc(15.5, 15.5, 15.0, "ink2")
    cv.disc(15.5, 15.5, 14.0, "g4")
    cv.disc(15.5, 14.8, 13.0, "g3")
    cv.ring(15.5, 15.5, 14.2, "g1", 1.0)
    glyph = "w"
    if kind == "left":
        cv.poly([(9, 16), (19, 8), (19, 24)], glyph)
        cv.rect(19, 13, 4, 6, glyph)
    elif kind == "right":
        cv.poly([(23, 16), (13, 8), (13, 24)], glyph)
        cv.rect(9, 13, 4, 6, glyph)
    elif kind == "jump":
        cv.poly([(16, 7), (8, 17), (24, 17)], glyph)
        cv.rect(13, 17, 6, 7, glyph)
    elif kind == "action":
        star6(cv, 15.5, 15.5, 9.5, 4.2, "cr")
        star6(cv, 15.2, 15.0, 7.5, 3.3, "w")
    elif kind == "pause":
        cv.rect(10, 9, 4, 14, glyph)
        cv.rect(18, 9, 4, 14, glyph)
    # glyph shadow
    cv2 = Cv(S, S)
    cv2.im = cv.im.copy()
    cv2.px = cv2.im.load()
    for y in range(S - 1, 0, -1):
        for x in range(S):
            if cv.get(x, y - 1) == c("w") and cv.get(x, y) != c("w"):
                cv2.set(x, y, "ink2")
    return cv2


def map_node(state):
    cv = Cv(14, 14)
    if state == "locked":
        cv.disc(6.5, 6.5, 6.0, "g4")
        cv.disc(6.2, 6.0, 4.6, "g3")
        cv.rect(5, 6, 4, 4, "g1")
        cv.ring(6.5, 5.5, 2.2, "g1", 1.0)
        cv.rect(4, 6, 6, 1, T) if False else None
        cv.rect(5, 6, 4, 4, "g1")
        cv.set(6, 7, "g4"), cv.set(6, 8, "g4")
    elif state == "done":
        cv.disc(6.5, 6.5, 6.0, "y3")
        cv.disc(6.2, 6.0, 4.8, "y1")
        star6(cv, 6.5, 6.5, 4.4, 2.0, "cr")
        cv.set(5, 4, "pk")
    else:
        cv.disc(6.5, 6.5, 6.0, "cr2")
        cv.disc(6.2, 6.0, 4.8, "cr")
        cv.disc(6.5, 6.5, 2.2, "w")
        cv.set(4, 3, "pk"), cv.set(3, 4, "pk")
    cv.outline("ink")
    return cv


def build_items():
    fr = {}
    for i in range(6):
        fr[f"coin_{i}"] = coin(i).im
    for i in range(4):
        fr[f"star_{i}"] = star_item(i).im
    for i in range(4):
        fr[f"question_{i}"] = question(i).im
    fr["hotdog"] = hotdog().im
    fr["pizza"] = pizza().im
    fr["cta_pass"] = cta_pass().im
    fr["one_up"] = one_up().im
    fr["souvenir_0"] = souvenir_bean().im
    fr["souvenir_1"] = souvenir_lion().im
    fr["souvenir_2"] = souvenir_willis().im
    fr["block_used"] = block_used().im
    fr["brick"] = brick_block().im
    fr["bounce_pad_0"] = bounce_pad(0).im
    fr["bounce_pad_1"] = bounce_pad(1).im
    fr["checkpoint_off"] = checkpoint(False).im
    fr["checkpoint_on"] = checkpoint(True).im
    fr["goal_pole"] = goal_pole().im
    fr["goal_flag"] = goal_flag().im
    fr["goal_pole_w"] = goal_pole_w().im  # World 2 ballpark win flag (goal flag=w)
    fr["goal_flag_w"] = goal_flag_w().im
    pack_atlas(fr, os.path.join(ASSETS, "items"))
    contact_sheet(fr, os.path.join(PREVIEWS, "items.png"), scale=4, cols=10)
    return fr


def build_ui():
    fr = {
        "heart_full": heart(True).im,
        "heart_empty": heart(False).im,
        "coin_icon": coin_icon().im,
        "star_icon": star_icon().im,
        "souvenir_icon": souvenir_icon(False).im,
        "souvenir_icon_empty": souvenir_icon(True).im,
        "lock": lock().im,
        "btn_left": button("left").im,
        "btn_right": button("right").im,
        "btn_jump": button("jump").im,
        "btn_action": button("action").im,
        "btn_pause": button("pause").im,
        "map_node": map_node("open").im,
        "map_node_locked": map_node("locked").im,
        "map_node_done": map_node("done").im,
    }
    pack_atlas(fr, os.path.join(ASSETS, "ui"))
    contact_sheet(fr, os.path.join(PREVIEWS, "ui.png"), scale=5, cols=8)
    return fr


if __name__ == "__main__":
    build_items()
    build_ui()
    print("items/ui ok")
