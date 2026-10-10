#!/usr/bin/env python3
"""
logo.png (title logo), world-map.png (stylised Chicago map) and pixel-font.png
(a white 5x7 bitmap font usable with Phaser RetroFont; see README).
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from pxl import ASSETS, FONT3, FONT5, PREVIEWS, Cv, T, c, draw_text, lerp, scaled, text_w  # noqa: E402
from draw_items import STAR5, star6  # noqa: E402

BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def big_text(text, scale, face, light, dark, font=FONT5, spacing=1):
    """Blocky text: each font pixel becomes scale x scale, with bevel highlight/shadow."""
    w = text_w(text, font, spacing) * scale
    h = len(font["A"]) * scale
    cv = Cv(w, h)
    mask = Cv(w // scale + 2, h // scale + 2)
    draw_text(mask, 0, 0, text, "w", font, spacing)
    for y in range(mask.h):
        for x in range(mask.w):
            if mask.get(x, y)[3]:
                up = mask.get(x, y - 1)[3]
                dn = mask.get(x, y + 1)[3]
                for yy in range(scale):
                    for xx in range(scale):
                        col = face
                        if not up and yy == 0:
                            col = light
                        if not dn and yy == scale - 1:
                            col = dark
                        cv.set(x * scale + xx, y * scale + yy, col)
    return cv


def logo():
    W, H = 304, 84
    cv = Cv(W, H)
    # flag ribbon behind "CHICAGO"
    ry0, ry1 = 6, 46
    for y in range(ry0, ry1):
        for x in range(10, W - 10):
            cv.set(x, y, "w")
    cv.rect(10, ry0 + 3, W - 20, 6, "cb")
    cv.rect(10, ry1 - 9, W - 20, 6, "cb")
    # ribbon notched ends
    for k in range(8):
        cv.rect(10, ry0 + 12 + k, 8 - k, 1, T) if False else None
    cv.poly([(2, ry0), (12, ry0), (12, ry1), (2, ry1), (8, (ry0 + ry1) / 2)], "w")
    cv.poly([(W - 12, ry0), (W - 2, ry0), (W - 8, (ry0 + ry1) / 2), (W - 2, ry1), (W - 12, ry1)], "w")
    cv.rect(2, ry0 + 3, 10, 6, "cb"), cv.rect(2, ry1 - 9, 10, 6, "cb")
    cv.rect(W - 12, ry0 + 3, 10, 6, "cb"), cv.rect(W - 12, ry1 - 9, 10, 6, "cb")
    # fix notch after stripes
    cv.poly([(0, ry0), (2, ry0), (8, (ry0 + ry1) / 2), (2, ry1), (0, ry1)], T)
    cv.poly([(W, ry0), (W - 2, ry0), (W - 8, (ry0 + ry1) / 2), (W - 2, ry1), (W, ry1)], T)
    rib = Cv(W, H)
    rib.im = cv.im.copy()
    rib.px = rib.im.load()
    rib.outline("ink")
    cv = rib
    # red stars on the ribbon either side
    for sx in (30, W - 31):
        star6(cv, sx, (ry0 + ry1) / 2 - 0.5, 9.5, 4.0, "cr2")
        star6(cv, sx - 0.4, (ry0 + ry1) / 2 - 1, 8.5, 3.5, "cr")
    # CHICAGO
    t = big_text("CHICAGO", 4, "cr", "pk", "cr2")
    t.outline("ink")
    t2 = Cv(t.w + 2, t.h + 2)
    t2.blit(t, 1, 1)
    t2.outline("ink")
    sx = (W - t2.w) // 2
    sh = Cv(t2.w, t2.h)
    sh.im = t2.im.copy()
    sh.px = sh.im.load()
    for y in range(sh.h):
        for x in range(sh.w):
            if sh.get(x, y)[3]:
                sh.set(x, y, "navy")
    cv.blit(sh, sx + 2, 8 + 3)
    cv.blit(t2, sx, 8)
    # FAMILY ADVENTURE banner
    b = big_text("FAMILY ADVENTURE", 2, "w", "w", "cb", spacing=1)
    bw = b.w + 16
    bx = (W - bw) // 2
    by = 52
    cv.rect(bx, by, bw, b.h + 8, "cb3")
    cv.hline(bx, by, bw, "cb")
    cv.hline(bx, by + b.h + 7, bw, "navy")
    for x in (bx, bx + bw - 1):
        pass
    band = Cv(W, H)
    band.rect(bx, by, bw, b.h + 8, "cb3")
    band.outline("ink")
    for y in range(H):
        for x in range(W):
            if band.get(x, y) == c("ink") and cv.get(x, y)[3] == 0:
                cv.set(x, y, "ink")
            elif band.get(x, y) == c("ink"):
                cv.set(x, y, "ink")
    bo = Cv(b.w + 2, b.h + 2)
    bo.blit(b, 1, 1)
    bo.outline("navy")
    cv.blit(bo, bx + 7, by + 3)
    # sparkle
    for (x, y) in ((sx - 4, 10), (sx + t2.w + 2, 40)):
        for i in range(-2, 3):
            cv.set(x + i, y, "y1")
            cv.set(x, y + i, "y1")
        cv.set(x, y, "w")
    return cv


# ---------------------------------------------------------------------------
# World map
# ---------------------------------------------------------------------------
MAP_POINTS = {
    "loop": (306, 150),
    "lincoln-park": (318, 72),
    "wrigleyville": (290, 22),
    "navy-pier": (398, 110),
    "museum-campus": (382, 196),
    "chinatown": (250, 206),
    "south-side": (276, 242),
    "ohare": (62, 44),
}


def shore_x(y):
    """Lake Michigan shoreline x at row y (lake is east of it)."""
    return int(352 + 14 * math.sin(y / 60.0 + 0.6) + (6 if y > 180 else 0) - (y < 40) * (y - 40) * 0.25)


def world_map():
    W, H = 480, 270
    cv = Cv(W, H)
    land, land2, grid = c("cfd2b4"), c("c2c7a6"), c("b4b996")
    lake, lake2, lake3 = c("3d8fc9"), c("5aa7da"), c("2f78b2")
    for y in range(H):
        sx = shore_x(y)
        for x in range(W):
            if x >= sx:
                col = lake if (x - sx) > 3 else lake2
                if (x * 3 + y * 7) % 53 == 0 or ((x + 2 * y) % 41 == 0 and y % 3 == 0):
                    col = lake2
                if x - sx > 60 and BAYER[y % 4][x % 4] < 6:
                    col = lake3
                cv.px[x, y] = col
            else:
                col = land if (x // 24 + y // 24) % 2 else land2
                if x % 12 == 0 or y % 12 == 0:
                    col = grid
                cv.px[x, y] = col
    # beach strip
    for y in range(H):
        sx = shore_x(y)
        cv.set(sx - 1, y, "l0"), cv.set(sx - 2, y, "l1")
        cv.set(sx, y, "w")
    # lake waves
    for k in range(40):
        x = 380 + (k * 37) % 95
        y = 8 + (k * 53) % 255
        if x > shore_x(y) + 6:
            cv.hline(x, y, 3, "gl1")
            cv.set(x + 1, y - 1, "gl1")

    def district(cx, cy, w, h, label, col="b6b6b0", parks=False):
        x0, y0 = cx - w // 2, cy - h // 2
        fill = c(col)
        for y in range(y0, y0 + h):
            for x in range(x0, x0 + w):
                if x < shore_x(y) - 2:
                    if (x + y) % 2 == 0 or not parks:
                        cv.set(x, y, fill)
                    else:
                        cv.set(x, y, lerp(col, "8a8a84", 0.15))
        for x in range(x0, x0 + w, 3):
            if x < shore_x(y0):
                cv.set(x, y0, "g3")
            if x < shore_x(y0 + h - 1):
                cv.set(x, y0 + h - 1, "g3")
        for y in range(y0, y0 + h, 3):
            cv.set(x0, y, "g3")
            if x0 + w - 1 < shore_x(y):
                cv.set(x0 + w - 1, y, "g3")
        tw = text_w(label, FONT3)
        lx, ly = cx - tw // 2, y0 + h + 2
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1)):
            draw_text(cv, lx + dx, ly + dy, label, "w")
        draw_text(cv, lx, ly, label, "g4")

    # O'Hare: runways
    district(62, 44, 84, 46, "O'HARE")
    for (x0, y0, x1, y1) in ((26, 30, 96, 30), (26, 52, 96, 52), (40, 24, 80, 64), (36, 60, 84, 26)):
        cv.line(x0, y0, x1, y1, "g4")
    plane = [(60, 38), (58, 40), (66, 40), (60, 42), (60, 44)]
    cv.rect(52, 40, 18, 2, "g5")
    cv.rect(59, 34, 2, 14, "g5")
    cv.rect(56, 46, 8, 1, "g5")
    # Kennedy expressway O'Hare -> Loop
    for k in range(0, 100):
        t = k / 99
        x = 96 + (262 - 96) * t
        y = 56 + (140 - 56) * (t ** 1.4)
        if k % 3 != 2:
            cv.rect(int(x), int(y), 2, 2, "y3")

    district(290, 22, 66, 24, "WRIGLEYVILLE")
    # little ballpark diamond
    cv.poly([(290, 14), (297, 21), (290, 28), (283, 21)], "9aa890")
    cv.ring(290, 21, 6, "g4", 1)
    district(318, 72, 64, 40, "LINCOLN PARK", col="a9b4a0", parks=True)
    for (tx, ty) in ((300, 62), (314, 68), (330, 60), (322, 80), (306, 78), (336, 74)):
        cv.disc(tx, ty, 3, "8f9c88")
        cv.set(tx - 1, ty - 1, "a6b19e")
    district(250, 206, 42, 22, "CHINATOWN")
    cv.poly([(250, 196), (258, 202), (242, 202)], "a08880")
    cv.rect(246, 202, 8, 6, "a08880")
    district(276, 242, 120, 20, "SOUTH SIDE")

    # Museum campus peninsula + Navy Pier (built into the lake)
    for y in range(184, 210):
        for x in range(shore_x(y) - 2, 398 - abs(y - 197)):
            cv.set(x, y, "b6b6b0")
    cv.set(388, 197, "g4")
    for (x, y, w, h) in ((370, 190, 8, 5), (382, 194, 6, 6), (372, 200, 7, 4)):
        cv.rect(x, y, w, h, "9a9a96")
    lab = "MUSEUM CAMPUS"
    lx = 382 - text_w(lab, FONT3) // 2
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        draw_text(cv, lx + dx, 213 + dy, lab, "w")
    draw_text(cv, lx, 213, lab, "g4")
    sx = shore_x(110)
    cv.rect(sx - 2, 107, 420 - sx, 6, "b6b6b0")
    cv.hline(sx - 2, 107, 420 - sx, "w")
    cv.hline(sx - 2, 112, 420 - sx, "g3")
    cv.ring(408, 102, 7, "g4", 1)  # ferris wheel
    cv.line(401, 102, 415, 102, "g4"), cv.line(408, 95, 408, 109, "g4")
    lab = "NAVY PIER"
    lx = 404 - text_w(lab, FONT3) // 2
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        draw_text(cv, lx + dx, 118 + dy, lab, "w")
    draw_text(cv, lx, 118, lab, "g4")

    # Chicago River: main stem + north / south branches (Y shape)
    river, river_d = c("3fb2ab"), c("268c93")

    def river_line(pts, width=4):
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
            for k in range(n):
                t = k / max(1, n - 1)
                x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
                for dy in range(-width // 2, width // 2 + 1):
                    for dx in range(-width // 2, width // 2 + 1):
                        if dx * dx + dy * dy <= (width / 2) ** 2:
                            cv.set(x + dx, y + dy, river)
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
            for k in range(0, n, 5):
                t = k / max(1, n - 1)
                cv.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, "t1")

    fork = (262, 122)
    river_line([(shore_x(122) + 2, 122), (300, 122), fork], 5)
    river_line([fork, (258, 96), (246, 70), (236, 40), (226, 0)], 4)
    river_line([fork, (262, 160), (256, 186), (226, 200), (150, 238), (60, 270)], 4)

    # The Loop: highlighted district, bounded by river (N, W), lake (E)
    lx0, ly0, lx1, ly1 = 266, 126, shore_x(150) - 3, 178
    for y in range(ly0, ly1):
        for x in range(lx0, min(lx1, shore_x(y) - 3)):
            cv.set(x, y, "f3e7c6" if (x // 6 + y // 6) % 2 else "e8d9b5")
    for x in range(lx0, lx1, 6):
        cv.vline(x, ly0, ly1 - ly0, "e2cf9f")
    # mini buildings
    blds = [(270, 150, 6, 20, "l2"), (278, 140, 7, 30, "g3"), (288, 134, 8, 38, "g5"), (298, 146, 7, 24, "b2"),
            (307, 142, 6, 28, "gl3"), (315, 150, 7, 20, "l3"), (324, 144, 6, 26, "gl2"), (332, 152, 7, 18, "b1")]
    for (x, y, w, h, col) in blds:
        cv.rect(x, y, w, h - 2, col)
        cv.vline(x + w - 1, y, h - 2, lerp(col, "1a1c2c", 0.35))
        for yy in range(y + 2, y + h - 4, 3):
            for xx in range(x + 1, x + w - 2, 2):
                cv.set(xx, yy, "y0")
    # Willis antennas
    cv.vline(290, 128, 6, "g5"), cv.vline(293, 130, 4, "g5")
    # Loop L tracks (rust-red rectangle)
    cv.frame(268, 130, lx1 - 270, 44, "r1")
    cv.frame(269, 131, lx1 - 272, 42, "r2")
    # glow border
    tmp = Cv(W, H)
    for y in range(ly0, ly1):
        for x in range(lx0, min(lx1, shore_x(y) - 3)):
            tmp.set(x, y, "w")
    tmp.outline("cr")
    for y in range(H):
        for x in range(W):
            if tmp.get(x, y) == c("cr"):
                cv.set(x, y, "cr")
    lab = "THE LOOP"
    lw = text_w(lab, FONT3)
    lx = 306 - lw // 2
    cv.rect(lx - 3, 180, lw + 6, 9, "cr")
    cv.frame(lx - 3, 180, lw + 6, 9, "ink")
    draw_text(cv, lx, 182, lab, "w")

    # compass rose (lower-left)
    cx, cy = 40, 228
    cv.disc(cx, cy, 14, "e8d9b5")
    cv.ring(cx, cy, 14, "l3", 1)
    cv.poly([(cx, cy - 13), (cx + 3, cy), (cx - 3, cy)], "cr")
    cv.poly([(cx, cy + 13), (cx + 3, cy), (cx - 3, cy)], "g4")
    cv.poly([(cx - 13, cy), (cx, cy - 3), (cx, cy + 3)], "g3")
    cv.poly([(cx + 13, cy), (cx, cy - 3), (cx, cy + 3)], "g3")
    draw_text(cv, cx - 1, cy - 22, "N", "ink")
    # title cartouche
    tt = "CHICAGO"
    title = big_text(tt, 2, "cr", "pk", "cr2")
    title.outline("ink")
    tx, ty = 120, 240
    cv.rect(tx - 6, ty - 5, title.w + 12, title.h + 10, "w")
    cv.rect(tx - 6, ty - 3, title.w + 12, 2, "cb")
    cv.rect(tx - 6, ty + title.h + 1, title.w + 12, 2, "cb")
    cv.frame(tx - 7, ty - 6, title.w + 14, title.h + 12, "ink")
    cv.blit(title, tx, ty)
    # lake label
    lab = "LAKE MICHIGAN"
    for i, ch in enumerate(lab):
        draw_text(cv, 440, 140 + i * 0 + 0, "", "w")
    for i, ch in enumerate(lab.replace(" ", "")):
        pass
    draw_text(cv, 400, 150, "LAKE", "gl0")
    draw_text(cv, 396, 157, "MICHIGAN", "gl0")
    # frame
    cv.frame(0, 0, W, H, "ink")
    cv.frame(1, 1, W - 2, H - 2, "l3")
    return cv


def pixel_font():
    chars = " !'-.,:/?0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    cw, ch, cols = 6, 8, 16
    rows = (len(chars) + cols - 1) // cols
    cv = Cv(cw * cols, ch * rows)
    for i, chr_ in enumerate(chars):
        g = FONT5.get(chr_, FONT5["?"])
        x0 = (i % cols) * cw + (5 - len(g[0])) // 2
        y0 = (i // cols) * ch
        for j, row in enumerate(g):
            for k, v in enumerate(row):
                if v == "#":
                    cv.set(x0 + k, y0 + j, "w")
    return cv, chars


if __name__ == "__main__":
    lg = logo()
    lg.save(os.path.join(ASSETS, "logo.png"))
    wm = world_map()
    wm.save(os.path.join(ASSETS, "world-map.png"))
    pf, chars = pixel_font()
    pf.save(os.path.join(ASSETS, "pixel-font.png"))
    os.makedirs(PREVIEWS, exist_ok=True)
    prev = Cv(lg.w * 3, lg.h * 3, (54, 60, 84, 255))
    prev.blit(scaled(lg.im, 3), 0, 0)
    prev.save(os.path.join(PREVIEWS, "logo.png"))
    scaled(wm.im, 2).save(os.path.join(PREVIEWS, "world-map.png"))
    print("map points:", json.dumps(MAP_POINTS))
    print("logo/map/font ok")
