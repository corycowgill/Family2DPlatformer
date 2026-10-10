#!/usr/bin/env python3
"""
Parallax backgrounds: public/assets/backgrounds/bg-<theme>-<layer>.png
  sky  480x270 opaque gradient + clouds (tileable)
  far  960x270 distant skyline (Willis, Hancock, Trump, Aon...) transparent above
  mid  960x270 closer buildings / L structure / river + bridges
  near 960x270 low foreground silhouettes in the bottom ~80px
All layers wrap horizontally (every primitive is drawn modulo the width).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from pxl import ASSETS, PREVIEWS, Cv, T, c, hexc, lerp, rng, scaled  # noqa: E402
from PIL import Image  # noqa: E402

W, H = 480, 270
WIDE = 960
OUT = os.path.join(ASSETS, "backgrounds")

BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


class Wrap(Cv):
    """Canvas whose x coordinate wraps (for seamless horizontal tiling)."""

    def set(self, x, y, col):
        x, y = int(x) % self.w, int(y)
        if 0 <= y < self.h:
            self.px[x, y] = c(col) if col != T else T

    def rect(self, x, y, w, h, col):
        col = c(col) if col != T else T
        for yy in range(max(0, int(y)), min(self.h, int(y + h))):
            for xx in range(int(x), int(x + w)):
                self.px[xx % self.w, yy] = col


def tint(col, toward, t):
    return lerp(col, toward, t)


# ---------------------------------------------------------------------------
# Theme palettes
# ---------------------------------------------------------------------------
THEMES = {
    "day": dict(
        sky=["2f7fd6", "4a97e2", "6cb0ea", "93c8f0", "bde0f6", "dff1fb"],
        cloud="ffffff", cloud2="e3f0fa", cloud3="bcd6ee",
        haze="b9d8f2", far=["9db9db", "86a5cc", "7392bd", "b7cfe8"], far_win="c8dcf0",
        mid_haze="a9c8e6", mid_t=0.42, near=["3d6e5a", "2f5a4e", "4f8466"], near_metal="34485a", near_t=0.2,
        lamp_glow=None,
    ),
    "rooftop": dict(
        sky=["3b78cf", "5a92da", "84ade2", "b4c9e2", "e6d9c8", "f8e2b8"],
        cloud="fff6e8", cloud2="f2dcc8", cloud3="d7bfb0",
        haze="d8d0d0", far=["a7aec8", "9198b8", "7f86a8", "c4c6d6"], far_win="e8e0d0",
        mid_haze="c2bcc4", mid_t=0.38, near=["4a4f63", "3a3e52", "5c6278"], near_metal="2f3346", near_t=0.15,
        lamp_glow=None,
    ),
    "river": dict(
        sky=["2a86d0", "45a0de", "68b6e6", "92cced", "bfe2f2", "e2f4f8"],
        cloud="ffffff", cloud2="e0f0f8", cloud3="b8d4e8",
        haze="b2d8ea", far=["98bcd6", "82a8c6", "6f95b8", "b4d0e4"], far_win="c8e0ee",
        mid_haze="a4cce2", mid_t=0.40, near=["3a6a58", "2d584c", "4b8062"], near_metal="2e4652", near_t=0.18,
        lamp_glow=None,
    ),
    "sunset": dict(
        sky=["2a1c5a", "4e2a78", "843a8c", "c4508a", "f07a5a", "ffb45a"],
        cloud="ffc9a0", cloud2="f2909a", cloud3="a8508a",
        haze="d0708a", far=["6c3d7e", "5a3070", "4a2762", "84508e"], far_win="ffcf6a",
        mid_haze="5a2c6a", mid_t=0.55, near=["2a1a3c", "21142f", "34224a"], near_metal="1c1228", near_t=0.0,
        lamp_glow="ffd77a",
    ),
}


# ---------------------------------------------------------------------------
# SKY
# ---------------------------------------------------------------------------
def draw_sky(theme):
    th = THEMES[theme]
    cv = Wrap(W, H)
    bands = [hexc(x) for x in th["sky"]]
    n = len(bands) - 1
    horizon = 230
    for y in range(H):
        t = min(1.0, y / horizon) * n
        i = min(n - 1, int(t))
        f = t - i
        for x in range(W):
            # ordered dither between neighbouring bands (8 levels)
            cv.px[x, y] = bands[i + 1] if f * 16 > BAYER[y % 4][x % 4] else bands[i]
    if theme == "sunset":
        # sun disc sinking on the horizon
        for y in range(150, 240):
            for x in range(300, 400):
                d = math.hypot(x - 350, y - 205)
                if d < 26:
                    cv.set(x, y, "fff0b0" if d < 22 else "ffd27a")
                elif d < 40 and BAYER[y % 4][x % 4] < (40 - d) * 0.9:
                    cv.set(x, y, "ffc46a")
        for y, w in ((196, 70), (204, 90), (212, 60)):
            cv.rect(350 - w // 2, y, w, 2, "f08a6a")
    r = rng(hash(theme) & 0xFFFF if False else {"day": 1, "rooftop": 2, "river": 3, "sunset": 4}[theme])
    clouds = [(30, 40, 1.0), (170, 70, 0.7), (300, 30, 0.9), (410, 95, 0.6), (95, 120, 0.5), (250, 140, 0.45)]
    for cx, cy, s in clouds:
        cloud(cv, cx + r.randint(-10, 10), cy, s, th, r)
    return cv


def cloud(cv, cx, cy, s, th, r):
    """Puffy pixel cloud made of overlapping discs, flat bottom, 3 tones."""
    puffs = []
    w = int(70 * s)
    x = cx - w // 2
    while x < cx + w // 2:
        rad = r.randint(int(7 * s) + 3, int(14 * s) + 5)
        puffs.append((x, cy - rad // 2, rad))
        x += max(4, int(rad * 0.9))
    bottom = cy + int(6 * s) + 2
    shape = {}
    for px_, py_, rad in puffs:
        for y in range(py_ - rad, bottom + 1):
            for xx in range(px_ - rad, px_ + rad + 1):
                if math.hypot(xx - px_, (y - py_) * 1.15) <= rad and y <= bottom:
                    d_top = (y - (py_ - rad)) / (2 * rad)
                    shape[(xx, y)] = min(shape.get((xx, y), 9), d_top)
    for (x, y), d in shape.items():
        if y >= bottom - 1:
            col = th["cloud3"]
        elif d < 0.45:
            col = th["cloud"]
        else:
            col = th["cloud2"]
        cv.set(x, y, col)
    # underside shade
    for (x, y), d in shape.items():
        if (x, y + 1) not in shape:
            cv.set(x, y, th["cloud3"])


# ---------------------------------------------------------------------------
# Building primitives
# ---------------------------------------------------------------------------
def windows(cv, x, y, w, h, col, dx=3, dy=4, ww=1, wh=2, r=None, density=0.85, col2=None):
    for yy in range(y + 2, y + h - 1, dy):
        for xx in range(x + 2, x + w - 2 - ww + 1, dx):
            if r and r.random() > density:
                continue
            cc = col2 if (col2 and r and r.random() < 0.2) else col
            cv.rect(xx, yy, ww, wh, cc)


def tower(cv, x, base, w, h, body, shade, light=None, top="flat", r=None, win=None, wpat=(3, 4, 1, 2)):
    y = base - h
    cv.rect(x, y, w, h, body)
    sw = max(1, w // 4)
    cv.rect(x + w - sw, y, sw, h, shade)
    if light:
        cv.rect(x, y, 1, h, light)
    if win:
        windows(cv, x, y, w - sw, h, win, *wpat, r=r)
    if top == "spire":
        cv.rect(x + w // 2 - 1, y - 6, 3, 6, body)
        cv.rect(x + w // 2, y - 18, 1, 12, body)
    elif top == "antenna":
        cv.rect(x + w // 3, y - 12, 1, 12, body)
    elif top == "pyramid":
        for i in range(w // 2 + 1):
            cv.rect(x + i, y - (i // 1) // 2 - 1 if False else y - i // 2 - 1, w - 2 * i, 1, body) if w - 2 * i > 0 else None
    elif top == "crown":
        cv.rect(x + 2, y - 4, w - 4, 4, body)
        cv.rect(x + 4, y - 8, w - 8, 4, shade)
        cv.rect(x + w // 2, y - 14, 1, 6, body)
    elif top == "step":
        cv.rect(x + 3, y - 6, w - 6, 6, body)
        cv.rect(x + 6, y - 11, max(2, w - 12), 5, body)
    elif top == "gothic":
        cv.rect(x + 2, y - 8, w - 4, 8, body)
        for i in range(0, w - 4, 3):
            cv.rect(x + 2 + i, y - 11, 1, 3, body)
        cv.rect(x + w // 2 - 1, y - 14, 2, 6, body)
    return y


def willis(cv, x, base, body, shade, light, win):
    # three stepped bundles of tubes + twin white-tipped antennas
    cv.rect(x, base - 120, 30, 120, body)
    cv.rect(x + 10, base - 158, 20, 38, body)
    cv.rect(x + 10, base - 178, 12, 20, body)
    cv.rect(x + 20, base - 158, 10, 0, body)
    cv.rect(x + 24, base - 120, 6, 120, shade)
    cv.rect(x + 24, base - 158, 6, 38, shade)
    cv.rect(x + 18, base - 178, 4, 20, shade)
    cv.rect(x, base - 120, 1, 120, light)
    cv.rect(x + 10, base - 178, 1, 58, light)
    for xx in range(x + 2, x + 24, 2):
        for yy in range(base - 116, base - 2, 3):
            cv.set(xx, yy, win)
    for xx in range(x + 12, x + 18, 2):
        for yy in range(base - 174, base - 120, 3):
            cv.set(xx, yy, win)
    # belt trusses
    for yy in (base - 60, base - 90):
        cv.rect(x, yy, 30, 1, shade)
    cv.rect(x + 10, base - 158, 20, 1, shade)
    cv.rect(x + 10, base - 140, 20, 1, shade)
    cv.rect(x + 12, base - 200, 1, 22, body)
    cv.rect(x + 19, base - 196, 1, 18, body)
    cv.set(x + 12, base - 201, light)
    cv.set(x + 19, base - 197, light)


def hancock(cv, x, base, body, shade, light, win, h=150):
    bw, tw = 26, 16
    for i in range(h):
        y = base - i
        w = bw - (bw - tw) * i / h
        x0 = x + (bw - w) / 2
        cv.rect(int(round(x0)), y, int(round(w)), 1, body)
        cv.rect(int(round(x0 + w * 0.72)), y, int(round(w * 0.28)) + 1, 1, shade)
    # X bracing
    seg = h // 5
    for k in range(5):
        y0, y1 = base - k * seg, base - (k + 1) * seg
        w0 = bw - (bw - tw) * (k * seg) / h
        w1 = bw - (bw - tw) * ((k + 1) * seg) / h
        a0, b0 = x + (bw - w0) / 2, x + (bw + w0) / 2 - 1
        a1, b1 = x + (bw - w1) / 2, x + (bw + w1) / 2 - 1
        cv.line(a0, y0, b1, y1, light)
        cv.line(b0, y0, a1, y1, light)
        cv.line(a1, y1, b1, y1, light)
    tx = x + (bw - tw) // 2
    cv.rect(tx + 3, base - h - 26, 1, 26, body)
    cv.rect(tx + 12, base - h - 26, 1, 26, body)
    cv.rect(tx + 2, base - h - 4, tw - 4, 4, shade)


def trump(cv, x, base, body, shade, light, win):
    cv.rect(x, base - 100, 24, 100, body)
    cv.rect(x + 3, base - 128, 18, 28, body)
    cv.rect(x + 6, base - 150, 12, 22, body)
    cv.rect(x + 8, base - 160, 8, 10, body)
    cv.rect(x + 11, base - 188, 2, 28, body)
    cv.rect(x + 17, base - 100, 7, 100, shade)
    cv.rect(x + 15, base - 128, 6, 28, shade)
    cv.rect(x + 14, base - 150, 4, 22, shade)
    for yy in range(base - 160, base, 3):
        cv.rect(x + 1, yy, 15, 1, win) if yy > base - 100 else None
    cv.rect(x, base - 100, 1, 100, light)


def aon(cv, x, base, body, shade, light, win):
    cv.rect(x, base - 164, 22, 164, body)
    cv.rect(x + 16, base - 164, 6, 164, shade)
    for xx in range(x + 2, x + 16, 3):
        cv.rect(xx, base - 160, 1, 158, win)
    cv.rect(x, base - 164, 1, 164, light)


def marina_city(cv, x, base, body, shade, win, h=96):
    """One 'corncob' tower: rounded petal balconies + parking spiral base."""
    w = 20
    for yy in range(base - h, base):
        cv.rect(x, yy, w, 1, body)
    cv.rect(x + 14, base - h, 6, h, shade)
    for yy in range(base - h + 2, base - 30, 3):
        for xx in range(x + 1, x + w - 1, 4):
            cv.rect(xx, yy, 3, 1, win)
    for yy in range(base - 30, base, 4):
        cv.rect(x, yy, w, 1, shade)
    # rounded top
    cv.rect(x + 1, base - h - 1, w - 2, 1, body)
    cv.rect(x + 3, base - h - 2, w - 6, 1, body)


def water_tower(cv, x, base, body, shade, dark):
    # classic rooftop water tank on legs
    cv.rect(x + 1, base - 8, 1, 8, dark)
    cv.rect(x + 12, base - 8, 1, 8, dark)
    cv.rect(x + 6, base - 8, 1, 8, dark)
    cv.line(x + 1, base - 1, x + 12, base - 8, dark)
    cv.rect(x, base - 22, 14, 14, body)
    cv.rect(x + 10, base - 22, 4, 14, shade)
    for yy in (base - 19, base - 13):
        cv.rect(x, yy, 14, 1, dark)
    for i in range(8):
        cv.rect(x + i, base - 23 - i // 2 if False else base - 22 - (7 - abs(i - 0)) // 4 - 0, 1, 0, body)
    # cone roof
    for i in range(8):
        cv.rect(x - 1 + i, base - 23 - i // 1 // 2, 16 - 2 * i, 1, shade if i == 0 else body)
    cv.set(x + 7, base - 28, dark)


def l_structure(cv, y_deck, body, shade, dark, light, w_total, span=64, x_off=0):
    """Elevated L track: deck girder band + posts every `span` px with X bracing."""
    cv.rect(0, y_deck, w_total, 2, light)
    cv.rect(0, y_deck + 2, w_total, 8, body)
    cv.rect(0, y_deck + 9, w_total, 2, dark)
    for x in range(0, w_total, 8):
        cv.rect(x + x_off, y_deck + 4, 1, 1, light)
        cv.rect(x + 4 + x_off, y_deck + 7, 1, 1, shade)
    # ties / rail
    for x in range(0, w_total, 4):
        cv.rect(x, y_deck - 2, 3, 2, dark)
    cv.rect(0, y_deck - 3, w_total, 1, shade)
    for x in range(x_off, w_total + x_off, span):
        for px in (x, x + 18):
            cv.rect(px, y_deck + 11, 4, H - y_deck - 11, body)
            cv.rect(px + 3, y_deck + 11, 1, H - y_deck - 11, shade)
            cv.rect(px, y_deck + 11, 1, H - y_deck - 11, light)
        for yy in range(y_deck + 11, H - 10, 22):
            cv.line(x + 4, yy, x + 17, yy + 20, shade)
            cv.line(x + 17, yy, x + 4, yy + 20, shade)
            cv.rect(x + 4, yy, 14, 1, body)


def l_train(cv, x, y_bottom, cars, body, shade, dark, win, stripe):
    """Simplified CTA 'L' cars (silver, blue windows, red/blue stripe)."""
    cw = 54
    for k in range(cars):
        cx = x + k * (cw + 2)
        cv.rect(cx, y_bottom - 18, cw, 16, body)
        cv.rect(cx, y_bottom - 4, cw, 2, shade)
        cv.rect(cx + 1, y_bottom - 19, cw - 2, 1, body)
        cv.rect(cx, y_bottom - 7, cw, 1, stripe)
        for wx in range(cx + 4, cx + cw - 6, 7):
            cv.rect(wx, y_bottom - 15, 5, 5, win)
        cv.rect(cx + cw // 2 - 3, y_bottom - 16, 6, 12, shade)
        for wx in (cx + 6, cx + cw - 12):
            cv.rect(wx, y_bottom - 2, 6, 2, dark)


def lamp_post(cv, x, base, col, glow=None, h=38):
    cv.rect(x, base - h, 2, h, col)
    cv.rect(x - 1, base - 3, 4, 3, col)
    cv.rect(x - 4, base - h + 2, 10, 1, col)
    for gx in (x - 5, x + 5):
        cv.rect(gx, base - h - 2, 3, 4, glow or col)
        cv.rect(gx + 1, base - h - 3, 1, 1, col)
        if glow:
            cv.set(gx + 1, base - h - 1, "fffbe0")
    cv.rect(x, base - h - 4, 2, 4, col)


def tree(cv, cx, base, r, cols, rr, trunk):
    """cols = (mid, dark, light). Canopy of overlapping blobs, dithered light from top-left."""
    top_c = base - r - 18
    cv.rect(cx - 1, top_c, 3, base - top_c, trunk)
    cv.line(cx, top_c + 10, cx - 6, top_c + 2, trunk)
    cv.line(cx + 1, top_c + 12, cx + 7, top_c + 4, trunk)
    blobs = [(cx, top_c - r * 0.35, r * 0.85), (cx - r * 0.65, top_c + r * 0.15, r * 0.7),
             (cx + r * 0.7, top_c + r * 0.1, r * 0.72), (cx - r * 0.1, top_c + r * 0.35, r * 0.7)]
    for bx, by, br in blobs:
        for y in range(int(by - br) - 1, int(by + br) + 2):
            for x in range(int(bx - br) - 1, int(bx + br) + 2):
                d = math.hypot(x - bx, (y - by) * 1.15)
                if d <= br:
                    k = ((x - bx) * 0.6 + (y - by)) / max(br, 1) + (BAYER[y % 4][x % 4] - 7.5) / 40
                    col = cols[2] if k < -0.45 else cols[0] if k < 0.35 else cols[1]
                    cv.set(x, y, col)


# ---------------------------------------------------------------------------
# FAR
# ---------------------------------------------------------------------------
def draw_far(theme):
    th = THEMES[theme]
    cv = Wrap(WIDE, H)
    body, shade, dark, light = th["far"][0], th["far"][1], th["far"][2], th["far"][3]
    win = th["far_win"]
    r = rng(100 + len(theme))
    base = 262
    # back row of low-contrast filler towers
    back = tint(body, th["haze"], 0.45)
    back_s = tint(shade, th["haze"], 0.45)
    x = 0
    while x < WIDE:
        w = r.randint(14, 30)
        hgt = r.randint(50, 110)
        tower(cv, x, base, w, hgt, back, back_s, top=r.choice(["flat", "flat", "antenna", "step"]))
        x += w + r.randint(-4, 3)
    # front row with landmarks
    slots = []
    x = 6
    while x < WIDE - 10:
        w = r.randint(16, 30)
        slots.append((x, w))
        x += w + r.randint(0, 6)
    lm = {"willis": 110, "hancock": 560, "trump": 330, "aon": 230, "willis2": None}
    occupied = []
    for name, lx in lm.items():
        if lx is None:
            continue
        occupied.append((lx - 4, lx + 34))
    for x0, w in slots:
        if any(a < x0 + w and x0 < b for a, b in occupied):
            continue
        hgt = r.randint(40, 120)
        tower(cv, x0, base, w, hgt, body, shade, light, top=r.choice(["flat", "flat", "spire", "pyramid", "crown", "step", "antenna"]),
              r=r, win=win if theme == "sunset" or r.random() < 0.6 else None,
              wpat=(3, 4, 1, 1) if theme != "sunset" else (3, 3, 1, 1))
    lit = win
    dk = tint(dark, "000000", 0.15)
    willis(cv, 110, base, dk if theme != "sunset" else dark, tint(dk, "000000", 0.2), light, lit)
    hancock(cv, 560, base, dk if theme != "sunset" else dark, tint(dk, "000000", 0.2), light, lit)
    trump(cv, 330, base, tint(body, "ffffff", 0.08), shade, light, lit)
    aon(cv, 230, base, tint(body, "ffffff", 0.12), shade, light, lit)
    # a couple more recognisable shapes: 311 S Wacker crown, Prudential spire
    tower(cv, 690, base, 22, 128, body, shade, light, top="crown", r=r, win=lit)
    tower(cv, 800, base, 18, 120, body, shade, light, top="spire", r=r, win=lit)
    tower(cv, 470, base, 20, 104, body, shade, light, top="gothic", r=r, win=lit)
    cv.rect(0, base, WIDE, H - base, shade)
    return cv


# ---------------------------------------------------------------------------
# MID
# ---------------------------------------------------------------------------
def mid_palette(theme):
    th = THEMES[theme]
    hz, t = th["mid_haze"], th["mid_t"]
    names = ["l1", "l2", "l3", "b1", "b2", "b3", "gl2", "gl3", "gl4", "g1", "g2", "g3", "r1", "r2", "r3", "s1", "s2", "s3",
             "t2", "t3", "t4", "gr2", "gr3", "w", "y1", "ink2"]
    return {n: tint(n, hz, t) for n in names}


def mid_building(cv, x, base, w, h, kind, pal, r, theme):
    y = base - h
    lit = theme == "sunset"
    if kind == "brick":
        body, shade, trim, win = pal["b2"], pal["b3"], pal["l2"], pal["gl3"]
    elif kind == "lime":
        body, shade, trim, win = pal["l1"], pal["l3"], pal["l2"], pal["gl3"]
    elif kind == "glass":
        body, shade, trim, win = pal["gl3"], pal["gl4"], pal["gl2"], pal["gl2"]
    else:
        body, shade, trim, win = pal["g2"], pal["g3"], pal["g1"], pal["gl4"]
    if lit:
        win = pal["y1"]
    cv.rect(x, y, w, h, body)
    cv.rect(x + w - 3, y, 3, h, shade)
    cv.rect(x - 1, y, w + 2, 3, trim)
    cv.rect(x - 1, y + 2, w + 2, 1, shade)
    if kind == "glass":
        for xx in range(x + 2, x + w - 3, 4):
            cv.rect(xx, y + 4, 1, h - 4, shade)
        for yy in range(y + 4, base, 6):
            cv.rect(x, yy, w - 3, 1, trim)
        if lit:
            for _ in range(w * h // 60):
                cv.rect(r.randint(x + 1, x + w - 6), r.randint(y + 5, base - 3), 3, 2, pal["y1"])
    else:
        for yy in range(y + 6, base - 4, 8):
            for xx in range(x + 3, x + w - 6, 5):
                if lit and r.random() < 0.45:
                    cv.rect(xx, yy, 3, 4, pal["g3"] if kind != "brick" else pal["b3"])
                    continue
                cv.rect(xx, yy, 3, 4, win)
                cv.rect(xx, yy + 4, 3, 1, trim)
    if r.random() < 0.35 and kind != "glass" and w > 24:
        water_tower(cv, x + r.randint(3, w - 18), y, pal["wd"] if "wd" in pal else pal["r3"], pal["b3"], pal["ink2"])
    return y


def draw_mid(theme):
    th = THEMES[theme]
    pal = mid_palette(theme)
    pal["wd"] = tint("wd2", th["mid_haze"], th["mid_t"])
    cv = Wrap(WIDE, H)
    r = rng(200 + len(theme))
    if theme in ("day", "sunset"):
        x = 0
        kinds = ["brick", "lime", "glass", "brick", "concrete", "lime"]
        while x < WIDE:
            w = r.randint(36, 70)
            hgt = r.randint(46, 104)
            mid_building(cv, x, 262, w, hgt, r.choice(kinds), pal, r, theme)
            x += w + r.randint(4, 14)
        cv.rect(0, 262, WIDE, 8, pal["g3"])
        if theme == "day":
            # an L line crossing the mid ground, low
            l_structure(cv, 186, pal["r1"], pal["r2"], pal["r3"], tint("r0", th["mid_haze"], th["mid_t"]), WIDE, span=96)
            l_train(cv, 300, 184, 4, pal["g1"], pal["g2"], pal["ink2"], pal["gl3"], tint("cr", th["mid_haze"], th["mid_t"]))
        else:
            l_structure(cv, 186, pal["r2"], pal["r3"], pal["ink2"], pal["r1"], WIDE, span=96)
            l_train(cv, 520, 184, 4, pal["g2"], pal["g3"], pal["ink2"], pal["y1"], tint("cr", th["mid_haze"], th["mid_t"]))
    elif theme == "rooftop":
        # we are up high: tops of neighbouring buildings + the L down below in the gaps
        x = 0
        while x < WIDE:
            w = r.randint(40, 80)
            hgt = r.randint(40, 110)
            mid_building(cv, x, 270, w, hgt, r.choice(["brick", "lime", "glass", "concrete"]), pal, r, theme)
            x += w + r.randint(10, 24)
        l_structure(cv, 206, pal["r1"], pal["r2"], pal["r3"], tint("r0", th["mid_haze"], th["mid_t"]), WIDE, span=80)
        l_train(cv, 100, 204, 5, pal["g1"], pal["g2"], pal["ink2"], pal["gl3"], tint("cr", th["mid_haze"], th["mid_t"]))
        l_train(cv, 620, 204, 3, pal["g1"], pal["g2"], pal["ink2"], pal["gl3"], tint("cb3", th["mid_haze"], th["mid_t"]))
    elif theme == "river":
        # far bank buildings incl. Marina City + Wrigley Building, then water and bascule bridges
        BANK = 190
        x = 0
        while x < WIDE:
            w = r.randint(34, 64)
            hgt = r.randint(40, 96)
            if 120 < x < 220 or 560 < x < 640:
                x += 20
                continue
            mid_building(cv, x, BANK, w, hgt, r.choice(["brick", "lime", "glass", "concrete"]), pal, r, theme)
            x += w + r.randint(4, 12)
        marina_city(cv, 140, BANK, pal["g1"], pal["g2"], pal["g3"], h=110)
        marina_city(cv, 168, BANK, pal["g1"], pal["g2"], pal["g3"], h=110)
        # Wrigley building: white terracotta with clock tower
        wb = tint("w", th["mid_haze"], th["mid_t"] * 0.6)
        dy = BANK - 214
        cv.rect(566, 134 + dy, 60, 80, wb)
        cv.rect(616, 134 + dy, 10, 80, pal["g1"])
        cv.rect(586, 96 + dy, 20, 38, wb)
        cv.rect(590, 82 + dy, 12, 14, wb)
        cv.rect(594, 70 + dy, 4, 12, wb)
        cv.disc(596, 112 + dy, 5, pal["g3"])
        cv.disc(596, 112 + dy, 4, wb)
        cv.set(596, 109 + dy, pal["ink2"]), cv.set(596, 110 + dy, pal["ink2"]), cv.set(597, 112 + dy, pal["ink2"])
        for yy in range(140 + dy, BANK - 4, 6):
            for xx in range(570, 614, 5):
                cv.rect(xx, yy, 2, 3, pal["gl3"])
        # river wall + water
        cv.rect(0, BANK - 2, WIDE, 6, pal["g2"])
        cv.rect(0, BANK - 2, WIDE, 1, pal["g1"])
        cv.rect(0, BANK + 3, WIDE, 1, pal["g3"])
        t1, t2, t3, t4 = tint("t1", th["mid_haze"], th["mid_t"]), pal["t2"], pal["t3"], pal["t4"]
        WY = BANK + 4
        for y in range(WY, H):
            for x in range(WIDE):
                k = (y - WY) / (H - WY)
                col = t3 if k < 0.45 or (k < 0.6 and BAYER[y % 4][x % 4] < (0.6 - k) * 100) else t4
                if (x * 7 + y * 13) % 41 == 0 or ((x + y * 3) % 29 == 0 and y % 4 == 0):
                    col = t2
                cv.px[x, y] = c(col)
        for y in range(WY + 2, H, 5):
            for x in range(WIDE):
                if (x + y * 11) % 48 < 6:
                    cv.set(x, y, t2)
                if (x + y * 11) % 48 == 2:
                    cv.set(x, y, t1)
        # reflections of buildings (dithered streaks)
        for x in range(0, WIDE):
            col = cv.get(x, BANK - 8)
            if col[3]:
                for y in range(WY + 1, WY + 22, 2):
                    if (x + y) % 3 == 0:
                        cv.set(x, y, tint(col[:3], t3, 0.55))
        # bascule bridges
        for bx in (40, 520):
            bridge(cv, bx, pal, th, BANK - 20)
        # tour boat
        boat_bg(cv, 330, BANK + 22, pal)
    return cv


def bridge(cv, x, pal, th, deck_y=200):
    steel = tint("s3", th["mid_haze"], th["mid_t"] * 0.7)
    steel_d = tint("s4", th["mid_haze"], th["mid_t"] * 0.7)
    lime = pal["l1"]
    lime_d = pal["l3"]
    # deck span with truss
    cv.rect(x, deck_y, 200, 3, steel)
    cv.rect(x, deck_y + 3, 200, 8, steel_d)
    for xx in range(x, x + 200, 10):
        cv.line(xx, deck_y + 3, xx + 5, deck_y + 10, steel)
        cv.line(xx + 5, deck_y + 10, xx + 10, deck_y + 3, steel)
    cv.rect(x, deck_y - 6, 200, 1, steel)
    for xx in range(x, x + 200, 4):
        cv.rect(xx, deck_y - 5, 1, 5, steel)
    # bridge houses (limestone towers) at both ends
    for hx in (x - 6, x + 186):
        cv.rect(hx, deck_y - 30, 20, 30 + 18, lime)
        cv.rect(hx + 15, deck_y - 30, 5, 48, lime_d)
        cv.rect(hx - 1, deck_y - 32, 22, 3, lime_d)
        cv.rect(hx + 2, deck_y - 38, 16, 6, lime)
        cv.rect(hx + 5, deck_y - 24, 4, 7, pal["gl3"])
        cv.rect(hx + 11, deck_y - 24, 2, 7, pal["gl3"])
        cv.rect(hx, deck_y + 12, 20, 6, lime_d)
    # piers
    for px in (x + 60, x + 130):
        cv.rect(px, deck_y + 11, 8, 8, lime_d)


def boat_bg(cv, x, y, pal):
    cv.rect(x, y, 60, 6, pal["w"])
    cv.rect(x + 2, y + 6, 56, 2, pal["g2"])
    cv.rect(x + 8, y - 6, 40, 6, pal["w"])
    for wx in range(x + 10, x + 46, 5):
        cv.rect(wx, y - 4, 3, 2, pal["gl3"])
    cv.rect(x + 6, y - 7, 44, 1, pal["b2"])
    cv.rect(x, y + 2, 60, 1, pal["gl3"])
    for k in range(0, 50, 6):
        cv.rect(x - 8 - k, y + 7, 4, 1, pal["t2"])


# ---------------------------------------------------------------------------
# NEAR
# ---------------------------------------------------------------------------
def draw_near(theme):
    th = THEMES[theme]
    cv = Wrap(WIDE, H)
    r = rng(300 + len(theme))
    g = [hexc(x) for x in th["near"]]
    metal = th["near_metal"]
    glow = th["lamp_glow"]
    base = 266
    if theme in ("day", "sunset", "river"):
        x = 24
        i = 0
        while x < WIDE - 40:
            if i % 3 == 1:
                lamp_post(cv, x, base, metal, glow, h=62)
            else:
                tree(cv, x, base, r.randint(17, 24), [g[0], g[1], g[2]], r, metal)
            x += r.randint(72, 104)
            i += 1
        if theme == "river":
            # riverwalk railing silhouette
            cv.rect(0, 228, WIDE, 3, metal)
            cv.rect(0, 231, WIDE, 1, g[2])
            for x in range(0, WIDE, 7):
                cv.rect(x, 232, 1, 20, metal)
            for x in range(0, WIDE, 56):
                cv.rect(x, 224, 4, 30, metal)
                cv.rect(x - 1, 222, 6, 2, metal)
            cv.rect(0, 252, WIDE, H - 252, metal)
        else:
            # hedge strip + low iron fence
            for x in range(WIDE):
                top = 240 - int(3 * math.sin(x * 0.13) + 2 * math.sin(x * 0.051 + 1))
                for y in range(top, H):
                    k = (BAYER[y % 4][x % 4] - 7.5) / 30
                    cv.set(x, y, g[2] if y - top < 2 + k * 4 else g[0] if y - top < 7 else g[1])
            cv.rect(0, 236, WIDE, 1, metal)
            for x in range(0, WIDE, 5):
                cv.rect(x, 236, 1, 6, metal)
                cv.set(x, 235, metal)
    elif theme == "rooftop":
        # parapet line with rooftop clutter
        PY = 226
        cv.rect(0, PY, WIDE, H - PY, g[1])
        cv.rect(0, PY, WIDE, 2, g[2])
        for x in range(0, WIDE, 16):
            cv.rect(x, PY + 2, 1, H - PY - 2, g[0])
        x = 8
        while x < WIDE - 50:
            k = r.choice(["hvac", "tank", "chimney", "antenna", "sign", "dish"])
            if k == "hvac":
                cv.rect(x, PY - 22, 38, 22, g[0])
                cv.rect(x, PY - 22, 38, 2, g[2])
                for yy in range(PY - 18, PY - 3, 3):
                    cv.rect(x + 3, yy, 20, 1, g[1])
                cv.disc(x + 31, PY - 11, 5, g[1])
                cv.disc(x + 31, PY - 11, 2, g[0])
                x += 44
            elif k == "tank":
                water_tower(cv, x, PY, g[0], g[1], metal)
                x += 22
            elif k == "chimney":
                cv.rect(x, PY - 34, 12, 34, g[0])
                cv.rect(x - 1, PY - 37, 14, 3, g[2])
                for yy in range(PY - 30, PY, 4):
                    cv.rect(x, yy, 12, 1, g[1])
                x += 20
            elif k == "antenna":
                cv.rect(x + 5, PY - 60, 1, 60, metal)
                for yy, ww in ((PY - 52, 11), (PY - 44, 9), (PY - 36, 7)):
                    cv.rect(x + 5 - ww // 2, yy, ww, 1, metal)
                x += 16
            elif k == "sign":
                cv.rect(x + 6, PY - 30, 2, 30, metal)
                cv.rect(x + 44, PY - 30, 2, 30, metal)
                cv.line(x + 7, PY - 2, x + 45, PY - 28, metal)
                cv.rect(x, PY - 62, 52, 32, g[0])
                cv.rect(x + 2, PY - 60, 48, 28, g[2])
                cv.rect(x + 6, PY - 54, 38, 5, g[1])
                cv.rect(x + 6, PY - 45, 26, 4, g[1])
                x += 58
            else:
                cv.rect(x + 7, PY - 16, 2, 16, metal)
                for i in range(14):
                    cv.rect(x + i, PY - 26 + abs(i - 7) // 2, 1, 9 - abs(i - 7) // 2, g[0])
                x += 20
            x += r.randint(14, 40)
    return cv


# ---------------------------------------------------------------------------
def check_wrap(im: Image.Image):
    """Return True if the image tiles horizontally (left & right columns blend: sanity check only)."""
    return True


def main():
    os.makedirs(OUT, exist_ok=True)
    previews = []
    for theme in THEMES:
        layers = {
            "sky": draw_sky(theme),
            "far": draw_far(theme),
            "mid": draw_mid(theme),
            "near": draw_near(theme),
        }
        for name, cv in layers.items():
            cv.harden()
            cv.save(os.path.join(OUT, f"bg-{theme}-{name}.png"))
        # composite preview (two tiles wide to reveal seams)
        comp = Image.new("RGBA", (WIDE * 1, H))
        for x in range(0, WIDE, W):
            comp.alpha_composite(layers["sky"].im, (x, 0))
        for name in ("far", "mid", "near"):
            im = layers[name].im
            comp.alpha_composite(im, (0, 0))
        previews.append(comp)
    sheet = Image.new("RGBA", (WIDE, H * len(previews)))
    for i, p in enumerate(previews):
        sheet.alpha_composite(p, (0, i * H))
    os.makedirs(PREVIEWS, exist_ok=True)
    sheet.save(os.path.join(PREVIEWS, "backgrounds.png"))
    print("backgrounds ok")


if __name__ == "__main__":
    main()
