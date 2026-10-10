#!/usr/bin/env python3
"""
platforms atlas: moving platforms and rideable vehicles (side view, facing right).
Writes public/assets/platforms.{png,json} + art/previews/platforms.png
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from pxl import ASSETS, FONT3, PREVIEWS, Cv, T, c, contact_sheet, draw_text, lerp, pack_atlas, text_w  # noqa: E402


def girder(n):
    w = 16 * n
    cv = Cv(w, 16)
    # top & bottom flanges
    cv.rect(0, 0, w, 4, "r1")
    cv.hline(0, 0, w, "r0")
    cv.hline(0, 3, w, "r3")
    cv.rect(0, 12, w, 4, "r2")
    cv.hline(0, 12, w, "r1")
    cv.hline(0, 15, w, "r4")
    # lattice web (open)
    for x0 in range(0, w, 8):
        cv.line(x0, 4, x0 + 4, 11, "r2")
        cv.line(x0 + 1, 4, x0 + 5, 11, "r1")
        cv.line(x0 + 4, 11, x0 + 8, 4, "r3")
    # rivets
    for x in range(3, w, 6):
        cv.set(x, 1, "r0"), cv.set(x, 2, "r4")
        cv.set(x, 13, "r0"), cv.set(x, 14, "r4")
    cv.rect(0, 0, 2, 16, "r2"), cv.vline(0, 0, 16, "r1")
    cv.rect(w - 2, 0, 2, 16, "r3")
    cv.outline("ink")
    # outline is drawn outside, so shrink by cropping: redraw border as ink inside instead
    cv2 = Cv(w, 16)
    cv2.blit(cv.im.crop((0, 0, w, 16)), 0, 0)
    cv2.frame(0, 0, w, 16, "ink")
    for x in range(1, w - 1):
        for y in range(4, 12):
            p = cv2.get(x, y)
            if p[3] == 0:
                continue
    return cv2


def plank(n):
    w = 16 * n
    cv = Cv(w, 8)
    cv.rect(0, 0, w, 6, "wd1")
    cv.hline(0, 0, w, "ink")
    cv.hline(0, 1, w, "wd0")
    cv.hline(0, 5, w, "wd2")
    cv.hline(0, 6, w, "wd3")
    cv.hline(0, 7, w, "ink")
    cv.vline(0, 0, 8, "ink"), cv.vline(w - 1, 0, 8, "ink")
    for x in range(10, w - 4, 13):
        cv.hline(x, 3, 4, "wd2")
    for x in (3, w - 4):
        cv.set(x, 3, "s2"), cv.set(x, 2, "s0")  # nails
    for x in range(16, w, 16):
        cv.vline(x, 1, 5, "wd3")
    return cv


def scaffold(n):
    w = 16 * n
    cv = Cv(w, 16)
    cv.rect(0, 0, w, 5, "wd1")
    cv.hline(0, 1, w, "wd0")
    cv.hline(0, 4, w, "wd3")
    for x in range(12, w, 16):
        cv.vline(x, 1, 3, "wd2")
    # steel tube frame
    cv.rect(0, 5, w, 2, "s1")
    cv.hline(0, 6, w, "s3")
    cv.rect(0, 13, w, 2, "s1")
    cv.hline(0, 14, w, "s3")
    for x in (1, w // 2 - 1, w - 3):
        cv.rect(x, 5, 2, 10, "s1")
        cv.vline(x + 1, 5, 10, "s3")
    for x0 in range(3, w - 4, 16):
        cv.line(x0, 12, x0 + 8, 7, "y2")
    cv.hline(0, 15, w, "ink")
    cv.hline(0, 0, w, "ink")
    cv.vline(0, 0, 16, "ink"), cv.vline(w - 1, 0, 16, "ink")
    return cv


def cta_car(front=False):
    W, H = 128, 40
    cv = Cv(W, H)
    body, body_l, body_d = "s0", "w", "s2"
    # roof
    cv.rect(2, 2, W - 4, 3, "s1")
    cv.hline(3, 1, W - 6, "s2")
    cv.rect(20, 0, 14, 2, "s3"), cv.rect(90, 0, 14, 2, "s3")  # roof units
    # body
    cv.rect(1, 5, W - 2, 26, body)
    cv.hline(1, 5, W - 2, body_l)
    for y in range(7, 30, 3):
        cv.hline(2, y, W - 4, lerp("s0", "s1", 0.5))  # fluted stainless
    # stripe (red / blue) and windows
    cv.rect(1, 23, W - 2, 2, "cr")
    cv.rect(1, 25, W - 2, 1, "cb3")
    for wx in (6, 18, 50, 100) + (() if front else (112,)):
        cv.rect(wx, 9, 10, 9, "ink2")
        cv.rect(wx + 1, 10, 8, 7, "gl3")
        cv.rect(wx + 1, 10, 8, 3, "gl2")
        cv.set(wx + 2, 11, "gl0"), cv.set(wx + 3, 11, "gl1")
    # doors
    for dx in (32, 82):
        cv.rect(dx, 7, 14, 23, body_d)
        cv.vline(dx + 7, 7, 23, "s3")
        cv.rect(dx + 2, 9, 4, 10, "gl3"), cv.rect(dx + 9, 9, 4, 10, "gl3")
        cv.frame(dx, 7, 14, 23, "s3")
    # route sign
    cv.rect(63, 9, 19, 9, "ink2")
    draw_text(cv, 65, 11, "LOOP", "o1")
    # underframe + trucks
    cv.rect(1, 31, W - 2, 3, "g4")
    cv.hline(1, 31, W - 2, "g3")
    for tx in (14, W - 34):
        cv.rect(tx, 33, 20, 4, "ink2")
        for wx in (tx + 4, tx + 15):
            cv.disc(wx, 36.5, 3.0, "g5")
            cv.disc(wx, 36.5, 1.4, "s2")
    if front:
        # cab end on the right: slanted nose, headlights, destination sign
        for y in range(5, 31):
            cut = max(0, 6 - (y - 5) // 2) if y < 17 else 0
            for x in range(W - 1 - cut, W):
                cv.set(x, y, T)
        cv.rect(W - 12, 8, 9, 9, "ink2")
        cv.rect(W - 11, 9, 7, 7, "gl2")
        cv.set(W - 10, 10, "gl0")
        cv.rect(W - 6, 20, 4, 3, "y0")
        cv.set(W - 5, 21, "w")
        cv.rect(W - 6, 27, 4, 2, "cr")
        cv.rect(W - 26, 7, 12, 5, "ink2")
        cv.hline(W - 25, 9, 10, "o1")
    else:
        # coupler ends
        cv.rect(0, 27, 2, 3, "g4"), cv.rect(W - 2, 27, 2, 3, "g4")
    cv.outline("ink")
    return cv


def boat():
    W, H = 112, 36
    cv = Cv(W, H)
    # hull
    cv.poly([(2, 20), (W - 2, 20), (W - 10, 34), (8, 34)], "w")
    cv.rect(4, 28, W - 10, 2, "navy")
    cv.poly([(8, 32), (W - 8, 32), (W - 10, 34), (8, 34)], "cb3")
    cv.hline(2, 20, W - 4, "g1")
    cv.hline(4, 22, W - 8, "g0")
    # deck rail (open top deck = platform surface at y=10)
    cv.rect(4, 10, W - 18, 2, "s1")
    cv.hline(4, 10, W - 18, "s0")
    # cabin
    cv.rect(8, 12, W - 26, 8, "w")
    cv.hline(8, 12, W - 26, "g0")
    for wx in range(11, W - 22, 8):
        cv.rect(wx, 13, 6, 5, "gl3")
        cv.rect(wx, 13, 6, 2, "gl2")
    cv.rect(W - 18, 12, 10, 8, "w")
    cv.rect(W - 16, 13, 6, 5, "gl2")
    # rail posts on top deck
    for x in range(6, W - 14, 6):
        cv.vline(x, 5, 5, "s2")
    cv.hline(5, 5, W - 19, "s1")
    # flag at stern
    cv.vline(4, 0, 10, "s3")
    cv.rect(5, 0, 6, 4, "w")
    cv.hline(5, 1, 6, "cb")
    cv.set(7, 2, "cr"), cv.set(9, 2, "cr")
    # name
    draw_text(cv, 20, 23, "CHICAGO RIVER TOURS", "navy") if text_w("CHICAGO RIVER TOURS", FONT3) < W - 30 else None
    cv.outline("ink")
    return cv


def bus():
    W, H = 104, 40
    cv = Cv(W, H)
    cv.rect(2, 2, W - 4, 30, "w")
    cv.rect(3, 1, W - 6, 1, "g1")
    cv.rect(10, 0, 20, 2, "g2")  # AC unit
    # windows band
    cv.rect(2, 7, W - 4, 11, "ink2")
    for wx in range(6, W - 20, 12):
        cv.rect(wx, 8, 10, 9, "gl3")
        cv.rect(wx, 8, 10, 3, "gl2")
        cv.set(wx + 1, 9, "gl0")
    # front windshield (right)
    cv.rect(W - 12, 5, 9, 15, "gl2")
    cv.rect(W - 12, 5, 9, 4, "gl1")
    cv.rect(W - 24, 3, 12, 4, "ink2")
    draw_text(cv, W - 23, 3, "151", "o0") if False else None
    cv.hline(W - 23, 4, 10, "o1"), cv.hline(W - 23, 5, 6, "o1")
    # livery stripes
    cv.rect(2, 21, W - 4, 3, "cb3")
    cv.rect(2, 24, W - 4, 2, "cr")
    # doors
    for dx in (W - 26, 40):
        cv.rect(dx, 8, 10, 22, "gl3")
        cv.vline(dx + 5, 8, 22, "s3")
        cv.frame(dx, 8, 10, 22, "s3")
    # skirt, wheels
    cv.rect(2, 30, W - 4, 3, "g3")
    for wx in (20, W - 20):
        cv.disc(wx, 33.5, 5.6, "ink2")
        cv.disc(wx, 33.5, 3.4, "g4")
        cv.disc(wx, 33.5, 1.6, "s1")
    cv.rect(W - 4, 26, 3, 3, "y0")
    cv.rect(1, 26, 2, 3, "cr")
    cv.outline("ink")
    return cv


def car(kind):
    W, H = 56, 26
    cv = Cv(W, H)
    if kind == "taxi":
        body, body_l, body_d = "y1", "y0", "y3"
    else:
        body, body_l, body_d = "w", "w", "g1"
    # lower body
    cv.rect(2, 11, W - 4, 10, body)
    cv.hline(2, 11, W - 4, body_l)
    cv.hline(2, 20, W - 4, body_d)
    # cabin
    cv.poly([(12, 11), (17, 3), (38, 3), (45, 11)], body)
    cv.poly([(15, 11), (19, 5), (27, 5), (27, 11)], "gl2")
    cv.poly([(29, 11), (29, 5), (37, 5), (42, 11)], "gl2")
    cv.line(19, 5, 16, 10, "gl1")
    cv.hline(17, 3, 21, body_l)
    if kind == "taxi":
        cv.rect(22, 0, 12, 3, "w")
        draw_text(cv, 23, -1, "", "ink")
        cv.hline(23, 1, 10, "ink2")
        cv.rect(2, 14, W - 4, 2, "ink2")
        for x in range(2, W - 2, 4):
            cv.rect(x, 14, 2, 1, "w")
            cv.rect(x + 2, 15, 2, 1, "w")
    else:
        # light bar + blue/white checker band
        cv.rect(21, 0, 6, 3, "cb3"), cv.rect(28, 0, 6, 3, "cr")
        cv.set(22, 1, "cyan"), cv.set(31, 1, "pk")
        for x in range(2, W - 2, 2):
            cv.set(x, 14 + (x // 2) % 2, "cb3")
            cv.set(x + 1, 15 - (x // 2) % 2, "cb3")
        cv.rect(2, 16, W - 4, 1, "cb3")
        cv.rect(31, 6, 0, 0, "w")
    # doors seams + handles
    cv.vline(28, 11, 9, body_d)
    cv.hline(22, 13, 3, body_d), cv.hline(32, 13, 3, body_d)
    # bumpers, lights
    cv.rect(W - 4, 13, 3, 3, "y0")
    cv.rect(1, 13, 3, 3, "cr")
    cv.rect(1, 18, W - 2, 2, "s2")
    for wx in (13, W - 13):
        cv.disc(wx, 21, 4.6, "ink2")
        cv.disc(wx, 21, 2.6, "g4")
        cv.disc(wx, 21, 1.2, "s1")
    cv.outline("ink")
    return cv


def build():
    fr = {
        "girder_2": girder(2).im,
        "girder_3": girder(3).im,
        "girder_4": girder(4).im,
        "plank_2": plank(2).im,
        "plank_3": plank(3).im,
        "scaffold_3": scaffold(3).im,
        "train_car": cta_car(False).im,
        "train_front": cta_car(True).im,
        "boat": boat().im,
        "bus": bus().im,
        "taxi": car("taxi").im,
        "cop_car": car("cop").im,
    }
    pack_atlas(fr, os.path.join(ASSETS, "platforms"))
    contact_sheet(fr, os.path.join(PREVIEWS, "platforms.png"), scale=3)
    return fr


if __name__ == "__main__":
    build()
    print("platforms ok")
