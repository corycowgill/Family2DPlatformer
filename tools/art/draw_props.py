#!/usr/bin/env python3
"""
props atlas: Chicago street furniture + small ambient animations.
Static frames are drawn sitting on the bottom row of their frame (bottom-anchored);
animations: pigeon_idle_n, pigeon_fly_n, steam_n, train_light_n.
Writes public/assets/props.{png,json} + art/previews/props.png
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from pxl import ASSETS, FONT3, PREVIEWS, Cv, T, c, contact_sheet, draw_text, lerp, pack_atlas, text_w  # noqa: E402
from draw_items import STAR3, chicago_flag  # noqa: E402

IRON = ("g5", "ink2", "g4")  # dark iron greens/greys for poles
POLE = lerp("gr4", "ink2", 0.4)
POLE_L = lerp("gr3", "s3", 0.3)


def lamp():
    cv = Cv(16, 48)
    # ornate Chicago street lamp: fluted post, lantern with warm glass
    cv.rect(6, 14, 4, 30, POLE)
    cv.vline(6, 14, 30, POLE_L)
    cv.rect(4, 42, 8, 6, POLE)
    cv.hline(4, 42, 8, POLE_L)
    cv.rect(5, 39, 6, 3, POLE)
    cv.hline(3, 47, 10, POLE)
    for y in (20, 28):
        cv.hline(5, y, 6, POLE)
    # lantern
    cv.rect(4, 4, 8, 9, "y1")
    cv.rect(5, 5, 3, 6, "y0")
    cv.vline(4, 4, 9, POLE), cv.vline(11, 4, 9, POLE), cv.vline(8, 4, 9, POLE)
    cv.rect(3, 13, 10, 1, POLE)
    cv.poly([(2, 4), (8, 0), (14, 4)], POLE)
    cv.set(8, 0, POLE_L)
    cv.hline(5, 2, 4, POLE_L)
    cv.outline("ink")
    return cv


def hydrant():
    cv = Cv(14, 16)
    cv.rect(3, 4, 8, 10, "cr")
    cv.vline(3, 4, 10, "pk")
    cv.vline(9, 4, 10, "cr2")
    cv.vline(10, 4, 10, "cr3")
    cv.ellipse(6.5, 3.5, 3.5, 2.5, "cr")
    cv.set(5, 2, "pk")
    cv.rect(6, 0, 2, 2, "s2")
    cv.rect(0, 7, 3, 3, "s1"), cv.rect(11, 7, 3, 3, "s2")
    cv.rect(5, 8, 4, 3, "s1")
    cv.set(6, 9, "s3")
    cv.rect(2, 14, 10, 2, "cr2")
    cv.hline(2, 14, 10, "cr")
    cv.hline(3, 5, 7, "cr2")
    cv.outline("ink")
    return cv


def hotdog_cart():
    W, H = 52, 44
    cv = Cv(W, H)
    # umbrella
    cx = 22
    for i in range(8):
        a0 = math.pi + i * math.pi / 8
        a1 = math.pi + (i + 1) * math.pi / 8
        col = "cr" if i % 2 == 0 else "y1"
        cv.poly([(cx, 3), (cx + 22 * math.cos(a0), 13 + 8 * math.sin(a0) + 0), (cx + 22 * math.cos(a1), 13 + 8 * math.sin(a1))], col)
    for i in range(8):
        x0 = cx - 22 + i * 5.5
        cv.ellipse(x0 + 2.7, 13, 2.8, 1.6, "cr2" if i % 2 == 0 else "y2")
    cv.hline(cx - 21, 11, 42, "cr2")
    cv.hline(cx - 21, 10, 42, T)
    cv.rect(cx - 1, 0, 2, 4, "s3")
    cv.vline(cx, 14, 10, "s3")
    # condiment bottles
    cv.rect(10, 20, 2, 4, "mus"), cv.rect(13, 21, 2, 3, "tom"), cv.rect(31, 20, 2, 4, "rel")
    # cart body
    cv.rect(3, 24, 38, 14, "s1")
    cv.hline(3, 24, 38, "s0")
    cv.rect(3, 23, 38, 1, "s2")
    cv.vline(40, 24, 14, "s3")
    cv.hline(3, 37, 38, "s3")
    # sign panel
    cv.rect(6, 25, 32, 13, "cr")
    cv.hline(6, 25, 32, "pk")
    cv.hline(6, 37, 32, "cr3")
    t1, t2 = "CHICAGO", "DOGS"
    draw_text(cv, 6 + (32 - text_w(t1, FONT3)) // 2, 26, t1, "w")
    draw_text(cv, 6 + (32 - text_w(t2, FONT3)) // 2 + 1, 33 - 0, t2, "y1") if False else None
    draw_text(cv, 6 + (32 - text_w(t2, FONT3)) // 2, 32, t2, "y1")
    # handle + wheels
    cv.rect(41, 26, 6, 2, "s2")
    cv.vline(46, 24, 4, "s2")
    for wx in (10, 33):
        cv.disc(wx, 39.5, 3.6, "ink2")
        cv.disc(wx, 39.5, 2.0, "s1")
        cv.set(wx, 39, "s3")
    cv.vline(4, 38, 4, "s2")
    cv.outline("ink")
    return cv


def bench():
    cv = Cv(32, 16)
    wood, wood_d, wood_l = lerp("gr2", "gr3", 0.3), "gr3", "gr1"
    for y in (2, 5):
        cv.rect(2, y, 28, 2, wood)
        cv.hline(2, y, 28, wood_l)
    cv.rect(1, 9, 30, 2, wood)
    cv.hline(1, 9, 30, wood_l)
    cv.hline(1, 11, 30, wood_d)
    for x in (4, 26):
        cv.rect(x, 2, 2, 14, POLE)
        cv.rect(x - 1, 14, 4, 2, POLE)
    cv.vline(15, 2, 8, POLE)
    cv.outline("ink")
    return cv


def flag_pole():
    cv = Cv(32, 48)
    cv.rect(3, 3, 2, 42, "s1")
    cv.vline(3, 3, 42, "s0")
    cv.disc(3.5, 2.0, 1.5, "y1")
    cv.rect(1, 44, 6, 4, "g2")
    cv.hline(1, 44, 6, "g1")
    cv.outline("ink")
    f = chicago_flag(True, 0.9)
    f.outline("ink")
    cv.paste_over(f, 5, 4)
    return cv


def cone():
    cv = Cv(12, 16)
    cv.poly([(4.5, 1), (7.5, 1), (10, 13), (2, 13)], "o1")
    cv.poly([(4.5, 1), (6, 1), (4, 13), (2, 13)], "o0")
    cv.hline(3, 5, 6, "w"), cv.hline(3, 6, 6, "w")
    cv.hline(2, 9, 8, "w"), cv.hline(2, 10, 8, "w")
    cv.set(3, 5, "g0"), cv.set(2, 9, "g0")
    cv.rect(0, 13, 12, 3, "o2")
    cv.hline(0, 13, 12, "o1")
    cv.outline("ink")
    return cv


def barricade():
    cv = Cv(32, 22)
    for y0 in (2, 9):
        for x in range(28):
            for y in range(y0, y0 + 5):
                stripe = ((x + (y - y0)) // 4) % 2
                cv.set(x + 2, y, "o1" if stripe else "w")
        cv.hline(2, y0, 28, "g0")
        cv.hline(2, y0 + 4, 28, "o2")
    for x in (5, 25):
        cv.rect(x, 2, 2, 18, "w")
        cv.vline(x + 1, 2, 18, "g2")
        cv.line(x, 21, x - 3, 21, "g3")
        cv.rect(x - 3, 20, 8, 2, "g3")
    cv.rect(14, 0, 4, 2, "y1")
    cv.set(15, 0, "y0")
    cv.outline("ink")
    return cv


def news_box():
    cv = Cv(16, 24)
    cv.rect(1, 3, 14, 16, "cb3")
    cv.vline(1, 3, 16, "cb2")
    cv.vline(14, 3, 16, "navy")
    cv.rect(1, 1, 14, 2, "navy")
    cv.rect(3, 5, 10, 4, "w")
    draw_text(cv, 3, 5 - 0, "NEWS", "navy") if False else None
    cv.rect(3, 5, 10, 7, "g0")
    for y in (7, 9):
        cv.hline(4, y, 8, "g2")
    cv.hline(4, 6, 5, "ink2")
    cv.rect(3, 13, 10, 2, "w")
    draw_text(cv, 0, 0, "", "w")
    cv.rect(10, 15, 2, 2, "s1")
    cv.rect(3, 19, 2, 5, "s3"), cv.rect(11, 19, 2, 5, "s3")
    cv.hline(2, 23, 12, "s4")
    cv.outline("ink")
    return cv


def trash_can(broken=False):
    cv = Cv(18, 18)
    if not broken:
        cv.rect(3, 4, 12, 14, "gr3")
        for x in range(4, 14, 3):
            cv.vline(x, 5, 12, "gr2")
        cv.vline(3, 4, 14, "gr2")
        cv.vline(14, 4, 14, "gr4")
        cv.rect(2, 2, 14, 2, "gr2")
        cv.hline(2, 2, 14, "gr1")
        cv.rect(7, 0, 4, 2, "gr3")
        cv.hline(3, 10, 12, "gr4")
    else:
        # knocked over & dented, lid off, trash spilling
        cv.poly([(1, 10), (13, 7), (15, 17), (3, 17)], "gr3")
        cv.line(2, 11, 13, 8, "gr2")
        cv.line(4, 14, 14, 12, "gr4")
        cv.set(8, 12, "gr4"), cv.set(9, 12, "gr2")
        cv.ellipse(15.0, 12.0, 2.0, 4.6, "gr4")
        cv.rect(14, 15, 4, 3, "w")
        cv.set(16, 14, "y1"), cv.set(17, 16, "cr")
        cv.rect(0, 16, 3, 2, "g1")
        cv.poly([(3, 4), (12, 2), (13, 4), (4, 6)], "gr2")  # flying lid
        cv.hline(4, 3, 7, "gr1")
    cv.outline("ink")
    return cv


def planter():
    cv = Cv(32, 22)
    cv.rect(2, 10, 28, 12, "l2")
    cv.rect(1, 9, 30, 3, "l1")
    cv.hline(1, 9, 30, "l0")
    cv.hline(2, 12, 28, "l3")
    cv.vline(29, 12, 10, "l3")
    cv.hline(2, 21, 28, "l4")
    for x in range(1, 31):
        top = 3 + int(2 * math.sin(x * 0.7) + 1.5 * math.cos(x * 1.9))
        for y in range(top, 9):
            cv.set(x, y, "gr1" if y < top + 2 else "gr2")
        cv.set(x, top, "gr0")
    for fx, fy, col in ((4, 4, "cr"), (9, 3, "y1"), (14, 5, "pk"), (19, 3, "cr"), (24, 4, "y1"), (28, 5, "cr")):
        cv.rect(fx, fy, 2, 2, col)
        cv.set(fx, fy, "w" if col != "y1" else "y0")
    cv.outline("ink")
    return cv


def traffic_light():
    cv = Cv(14, 48)
    cv.rect(6, 22, 2, 24, POLE)
    cv.vline(6, 22, 24, POLE_L)
    cv.rect(4, 45, 6, 3, POLE)
    cv.rect(2, 1, 10, 22, "ink2")
    cv.vline(2, 1, 22, "g4")
    for i, (col, on) in enumerate((("cr", True), ("y2", False), ("rel", False))):
        y = 4 + i * 7
        cv.disc(6.5, y + 1.5, 2.6, col if on else lerp(col, "ink2", 0.65))
        if on:
            cv.set(5, y, "w")
        cv.hline(2, y - 2, 10, "g5")
    cv.outline("ink")
    return cv


def street_sign(text):
    w = text_w(text, FONT3) + 8
    cv = Cv(w, 34)
    px = w // 2 - 1
    cv.rect(px, 8, 2, 26, "s2")
    cv.vline(px, 8, 26, "s1")
    cv.rect(1, 1, w - 2, 9, "gr3")
    cv.frame(1, 1, w - 2, 9, "w")
    cv.hline(2, 2, w - 4, lerp("gr3", "gr2", 0.6))
    draw_text(cv, 4, 3, text, "w")
    cv.rect(px - 1, 32, 4, 2, "s3")
    cv.outline("ink")
    return cv


def clock():
    cv = Cv(18, 48)
    # pedestal street clock (State Street style): gold-trimmed green post, round face
    cv.rect(7, 16, 4, 28, POLE)
    cv.vline(7, 16, 28, POLE_L)
    for y in (22, 34):
        cv.rect(6, y, 6, 2, "y2")
        cv.hline(6, y, 6, "y1")
    cv.rect(4, 43, 10, 5, POLE)
    cv.hline(4, 43, 10, POLE_L)
    cv.hline(3, 47, 12, "ink2")
    cv.disc(8.5, 8.5, 7.6, "y3")
    cv.disc(8.5, 8.5, 6.6, "y1")
    cv.disc(8.5, 8.5, 5.4, "w")
    cv.set(8, 4, "ink"), cv.set(13, 8, "ink"), cv.set(8, 13, "ink"), cv.set(4, 8, "ink")
    cv.vline(8, 5, 4, "ink"), cv.line(8, 8, 11, 6, "ink")
    cv.set(5, 6, "g0")
    cv.set(8, 0, "y1")
    cv.outline("ink")
    return cv


def cta_logo(cv, x, y, w=20):
    """'cta' on white with blue box like the agency sign."""
    cv.rect(x, y, w, 9, "w")
    cv.rect(x, y, w, 2, "cb3")
    cv.rect(x, y + 7, w, 2, "cr")
    t = "CTA"
    draw_text(cv, x + (w - text_w(t, FONT3)) // 2, y + 2, t, "navy") if False else None
    draw_text(cv, x + (w - text_w(t, FONT3)) // 2, y + 2, t, "navy")


def cta_entrance():
    cv = Cv(48, 48)
    # canopy kiosk over stairs going down
    cv.rect(2, 10, 44, 3, "s3")
    cv.hline(2, 10, 44, "s1")
    cv.rect(4, 4, 40, 6, "ink2")
    cta_logo(cv, 6, 3, 36)
    for x in (4, 42):
        cv.rect(x, 13, 2, 35, "s2")
        cv.vline(x, 13, 35, "s1")
    # glass sides
    cv.rect(6, 14, 36, 18, lerp("gl2", "gl3", 0.5))
    for x in range(6, 42, 6):
        cv.vline(x, 14, 18, "s3")
    cv.line(8, 15, 14, 21, "gl1"), cv.line(26, 15, 32, 21, "gl1")
    # stairs
    for i in range(8):
        y = 32 + i * 2
        cv.rect(8 + i * 2, y, 32 - i * 4, 2, "g2" if i % 2 == 0 else "g3")
        cv.hline(8 + i * 2, y, 32 - i * 4, "g1")
    cv.rect(6, 32, 2, 16, "y2"), cv.rect(40, 32, 2, 16, "y2")  # handrails
    cv.hline(6, 32, 2, "y0"), cv.hline(40, 32, 2, "y0")
    cv.rect(16, 44, 16, 4, "ink2")
    cv.outline("ink")
    return cv


def bus_shelter():
    cv = Cv(48, 40)
    cv.rect(0, 2, 48, 4, "s3")
    cv.hline(0, 2, 48, "s1")
    cv.hline(0, 5, 48, "ink2")
    cv.rect(1, 0, 46, 2, "g4")
    for x in (2, 45):
        cv.rect(x, 6, 2, 34, "s2")
        cv.vline(x, 6, 34, "s1")
    # back glass
    cv.rect(4, 7, 41, 26, lerp("gl1", "gl2", 0.5))
    for x in (17, 31):
        cv.vline(x, 7, 26, "s3")
    cv.line(6, 8, 14, 16, "gl0"), cv.line(20, 8, 26, 14, "gl0"), cv.line(34, 9, 40, 15, "gl0")
    # ad panel (Chicago skyline poster)
    cv.rect(32, 9, 12, 20, "y1")
    cv.rect(33, 10, 10, 18, "cb")
    cv.rect(34, 17, 2, 11, "navy"), cv.rect(37, 14, 2, 14, "navy"), cv.rect(40, 19, 2, 9, "navy")
    cv.rect(33, 24, 10, 4, "cb3")
    # bench
    cv.rect(6, 28, 24, 2, "wd1")
    cv.hline(6, 28, 24, "wd0")
    cv.vline(8, 30, 6, "s3"), cv.vline(27, 30, 6, "s3")
    # bus stop sign
    cv.rect(6, 10, 9, 6, "w")
    cv.rect(6, 10, 9, 2, "cb3")
    cv.rect(8, 13, 5, 2, "cr")
    cv.hline(1, 39, 46, "g4")
    cv.outline("ink")
    return cv


def steam_vent():
    cv = Cv(16, 8)
    cv.rect(0, 3, 16, 5, "g4")
    cv.hline(0, 3, 16, "g2")
    for x in range(2, 15, 3):
        cv.rect(x, 4, 2, 3, "ink")
    cv.rect(3, 0, 10, 3, "o1")  # striped steam chimney collar
    cv.rect(5, 0, 2, 3, "w"), cv.rect(9, 0, 2, 3, "w")
    cv.outline("ink")
    return cv


def mailbox():
    cv = Cv(16, 22)
    cv.rect(1, 4, 14, 13, "cb3")
    cv.ellipse(7.5, 4.5, 6.6, 4.0, "cb3")
    cv.rect(1, 4, 14, 1, "cb3")
    cv.vline(1, 4, 13, "cb2"), cv.vline(14, 4, 13, "navy")
    cv.set(5, 1, "cb2"), cv.set(4, 2, "cb2")
    cv.rect(4, 6, 8, 2, "ink2")
    cv.hline(4, 6, 8, "s3")
    cv.rect(5, 10, 6, 3, "w")
    cv.rect(6, 11, 4, 1, "cr")
    cv.rect(2, 17, 3, 5, "cb3"), cv.rect(11, 17, 3, 5, "cb3")
    cv.vline(4, 17, 5, "navy"), cv.vline(13, 17, 5, "navy")
    cv.outline("ink")
    return cv


def tree():
    cv = Cv(32, 48)
    # trunk with tree grate
    cv.rect(14, 26, 4, 20, "wd3")
    cv.vline(14, 26, 20, "wd2")
    cv.line(15, 32, 10, 24, "wd3"), cv.line(17, 30, 22, 23, "wd3")
    cv.rect(8, 45, 16, 3, "g4")
    for x in range(9, 24, 3):
        cv.set(x, 46, "ink")
    blobs = [(16, 13, 11), (8, 20, 8), (24, 19, 8), (16, 22, 9), (11, 10, 6), (22, 10, 6)]
    shape = set()
    for bx, by, br in blobs:
        for y in range(by - br, by + br + 1):
            for x in range(bx - br, bx + br + 1):
                if math.hypot(x - bx, (y - by) * 1.1) <= br:
                    shape.add((x, y))
    for (x, y) in shape:
        k = (x - 16) * 0.5 + (y - 14)
        bay = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]][y % 4][x % 4]
        k += (bay - 7.5) * 0.35
        col = "gr0" if k < -9 else "gr1" if k < -1 else "gr2" if k < 7 else "gr3"
        cv.set(x, y, col)
    for (x, y) in shape:
        if (x, y + 1) not in shape and y > 18:
            cv.set(x, y, "gr4")
    cv.outline("ink")
    return cv


# ---------------------------------------------------------------------------
# animations
# ---------------------------------------------------------------------------
def pigeon(pose):
    cv = Cv(16, 16)
    body, wing, dark, neck, neck2 = "s2", "s1", "s3", lerp("gr2", "s3", 0.35), lerp("p2", "s3", 0.4)
    head = {"stand": (11, 6), "fwd": (12, 7), "peck": (13, 11)}.get(pose, (11, 6))
    if pose.startswith("fly"):
        cv.ellipse(8, 9, 5.5, 3, body)
        cv.ellipse(12.5, 7, 2.2, 2.0, body)
        cv.set(13, 6, "o1"), cv.set(15, 7, "y3"), cv.set(14, 7, "y3")
        cv.set(13, 6, "ink")
        cv.poly([(1, 8), (4, 7), (4, 11)], dark)
        up = {"fly0": -1, "fly1": 0, "fly2": 1, "fly3": 0}[pose]
        if up == -1:
            cv.poly([(5, 8), (10, 8), (4, 0), (2, 1)], wing)
            cv.line(4, 1, 8, 7, dark)
        elif up == 0:
            cv.poly([(4, 8), (11, 8), (6, 3), (1, 5)], wing)
            cv.hline(2, 5, 4, dark)
        else:
            cv.poly([(4, 9), (11, 9), (5, 15), (2, 14)], wing)
            cv.line(4, 14, 8, 10, dark)
        cv.hline(11, 9, 2, neck)
        cv.outline("ink")
        return cv
    cv.ellipse(7, 10, 5, 3.4, body)
    cv.ellipse(7.5, 9.5, 3.4, 2.0, wing)
    cv.hline(5, 9, 4, dark), cv.hline(5, 11, 4, dark)
    cv.poly([(1, 9), (3, 8), (4, 12), (0, 12)], dark)
    hx, hy = head
    cv.line(10, 9, hx, hy + 1, neck)
    cv.line(10, 10, hx - 1, hy + 2, neck2)
    cv.ellipse(hx, hy, 1.8, 1.6, body)
    cv.set(hx + 2, hy + (1 if pose == "peck" else 0), "y3")
    cv.set(hx, hy - 1 if pose != "peck" else hy, "ink")
    cv.set(hx + 1, hy - 1, "w") if pose != "peck" else None
    cv.vline(6, 13, 2, "o1"), cv.vline(8, 13, 2, "o1")
    cv.hline(5, 15, 2, "o1"), cv.hline(8, 15, 2, "o1")
    cv.outline("ink")
    return cv


def steam(i):
    cv = Cv(16, 32)
    r = [(0.0, 0), (0.9, 1), (1.8, 2), (2.7, 3), (3.6, 4), (4.5, 5)]
    for k in range(6):
        t = ((k * 5 + i * 5) % 30) / 30.0  # puff phase 0..1 (rising)
        y = 30 - t * 30
        x = 8 + math.sin(t * 6 + k) * 3
        rad = 1.6 + t * 4.2
        if t > 0.92:
            continue
        col = "w" if t < 0.35 else "g0" if t < 0.65 else "g1"
        cv.disc(x, y, rad, col)
    for y in range(32):
        for x in range(16):
            p = cv.get(x, y)
            if p[3] and cv.get(x - 1, y - 1)[3] == 0:
                cv.set(x, y, "w")
    return cv


def train_light(i):
    cv = Cv(16, 24)
    cv.rect(7, 10, 2, 14, POLE)
    cv.vline(7, 10, 14, POLE_L)
    cv.rect(0, 2, 16, 8, "ink2")
    cv.line(2, 13, 13, 18, "w"), cv.line(2, 18, 13, 13, "w")
    cv.line(2, 14, 13, 19, "cr"), cv.line(2, 19, 13, 14, "cr")
    left = i < 3
    for cx, on in ((3.5, left), (12.5, not left)):
        cv.disc(cx, 5.5, 2.8, "cr" if on else "cr3")
        if on:
            cv.set(int(cx) - 1, 4, "pk")
            cv.set(int(cx), 4, "w")
    cv.rect(6, 0, 4, 2, "ink2")
    cv.hline(3, 22, 10, POLE)
    cv.outline("ink")
    if True:
        # glow halo around the lit lamp (outside the outline)
        cx = 3 if left else 12
        for x, y in ((cx - 4, 5), (cx + 5, 5), (cx, 0)):
            if cv.get(x, y)[3] == 0:
                cv.set(x, y, "o1")
    return cv


def build():
    fr = {
        "lamp": lamp().im,
        "hydrant": hydrant().im,
        "hotdog_cart": hotdog_cart().im,
        "bench": bench().im,
        "flag_pole": flag_pole().im,
        "cone": cone().im,
        "barricade": barricade().im,
        "news_box": news_box().im,
        "trash_can": trash_can().im,
        "trash_can_broken": trash_can(True).im,
        "planter": planter().im,
        "traffic_light": traffic_light().im,
        "sign_wacker": street_sign("WACKER DR").im,
        "sign_michigan": street_sign("MICHIGAN AV").im,
        "clock": clock().im,
        "cta_entrance": cta_entrance().im,
        "bus_shelter": bus_shelter().im,
        "steam_vent": steam_vent().im,
        "mailbox": mailbox().im,
        "tree": tree().im,
    }
    for i, p in enumerate(["stand", "fwd", "peck", "fwd"]):
        fr[f"pigeon_idle_{i}"] = pigeon(p).im
    for i in range(4):
        fr[f"pigeon_fly_{i}"] = pigeon(f"fly{i}").im
    for i in range(6):
        fr[f"steam_{i}"] = steam(i).im
    for i in range(6):
        fr[f"train_light_{i}"] = train_light(i).im
    # World 2 (The North Side) props + looping neon flicker anims (timing in meta.anims)
    import json
    from draw_props_w2 import frames as w2_frames
    fr2, anim_meta = w2_frames()
    w1_names = list(fr)
    fr.update(fr2)
    pack_atlas(fr, os.path.join(ASSETS, "props"))
    with open(os.path.join(ASSETS, "props.json")) as f:
        data = json.load(f)
    data["meta"]["anims"] = anim_meta
    with open(os.path.join(ASSETS, "props.json"), "w") as f:
        json.dump(data, f, indent=1)
    contact_sheet({k: fr[k] for k in w1_names}, os.path.join(PREVIEWS, "props.png"), scale=4)
    contact_sheet(fr2, os.path.join(PREVIEWS, "props-w2.png"), scale=3)
    return fr


if __name__ == "__main__":
    build()
    print("props ok")
