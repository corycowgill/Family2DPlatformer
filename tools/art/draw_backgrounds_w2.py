#!/usr/bin/env python3
"""
World 2 ("The North Side") parallax sets, drawn with the World 1 primitives and grading
(see draw_backgrounds.py, which imports this module and writes every theme + the
ambient atlas + AmbientAnchors.ts in one run):

  park       2-1 Lincoln Park, sunny morning: Streeterville skyline far to the south over the
             park canopy; the Conservatory glasshouse, zoo gate + pavilion roofs, North Pond;
             near: big park trees, acorn lamps, flower beds, hedge + iron fence.
  lakefront  2-2 Lakefront, afternoon: Lake Michigan horizon with sailboats, the skyline (Hancock)
             to the south; North Avenue Beach: the ship-shaped beach house, lifeguard chairs,
             volleyball nets, umbrellas; near: dune grass, snow fence, trail lamps.
  night      2-3 Wrigleyville night: stars + moon, alien beams over the ballpark (marquee glowing
             red in the distance, light towers); three-flats with lit windows, neon signs,
             rooftop bleachers, the Red Line L at Addison; near: street lamps with halos.
  stadium    2-4 inside the ballpark at night: mothership in the sky, Wrigleyville rooftops with
             rooftop bleachers + light towers beyond; the outfield bleachers, hand-turned
             scoreboard with pennants and the ivy wall; near: foul pole + mowed outfield grass.

Everything wraps horizontally (Wrap canvas), hard alpha (translucent light = ordered dither).
"""
import math

import draw_backgrounds as DB
from draw_backgrounds import (  # noqa: F401
    BAYER, CLOUD_H, CLOUD_W, H, MAT, W, WIDE, Wrap, clamp01, cumulus, cirrus, dith, glow_halo, gradient_col,
    grade, hancock, light_groups, mix, rim_light, saturate, streak, top_light, tower, trump, aon, water_tower,
)
from pxl import FONT3, FONT5, T, c, rng

W2_THEMES = ("park", "lakefront", "night", "stadium")

THEMES2 = {
    "park": dict(
        sky=[(0, "3576d6"), (60, "4e92e2"), (120, "7fb6ec"), (170, "b4d8f2"), (210, "dcecf2"), (250, "f4f0dc")],
        sun=(96, 62, "fffbe6", "fff1c0"), sun_glow=38,
        cloud=["ffffff", "f4f8fc", "dce8f4", "b8cce2", "9cb4d4"], cloud_rim=None,
        haze="d6e6f0", far_fog=(0.45, 0.8), back_fog=(0.7, 0.9), far_y=(90, 230),
        mid_haze="bcd6e6", mid_fog=(0.1, 0.32), sil=None,
        rim_side=-1, rim="fffbe8", rim_t=0.32, near_dark=0.16, near_sat=0.3,
    ),
    "lakefront": dict(
        sky=[(0, "1d62c6"), (50, "3480d8"), (110, "5ea8e8"), (150, "92cbf0"), (178, "c8e8f4"), (270, "d8f0f4")],
        sun=(372, 46, "fffcee", "fff2c8"), sun_glow=36,
        cloud=["ffffff", "f2f8fc", "d8e8f4", "b0c8e0", "94b2d0"], cloud_rim=None,
        haze="cce6f0", far_fog=(0.5, 0.75), back_fog=(0.7, 0.88), far_y=(100, 176),
        mid_haze="c2dcea", mid_fog=(0.08, 0.26), sil=None,
        rim_side=1, rim="fff6dc", rim_t=0.34, near_dark=0.12, near_sat=0.3,
    ),
    "night": dict(
        sky=[(0, "080a20"), (60, "10163a"), (120, "1c2250"), (170, "2e2a5e"), (210, "4a3466"), (245, "6a4068"), (270, "804868")],
        sun=(388, 54, "fbf6e0", "c8d0f0"), sun_glow=46,
        cloud=["8a8cb8", "62668e", "464a74", "33365c", "262848"], cloud_rim="c07a8a",
        haze="3e3462", far_fog=(0.25, 0.55), back_fog=(0.5, 0.75), far_y=(80, 262),
        mid_haze="2c2a52", mid_fog=(0.08, 0.3), sil=("2a2850", 0.55, "1e1c3c", 0.7, "12122a", 0.82),
        rim_side=1, rim="9aa8e0", rim_t=0.3, near_dark=0.0, near_sat=0.0,
        lit=["ffd27a", "ffc060", "fff0b0", "ffb070"],
    ),
    "stadium": dict(
        sky=[(0, "070920"), (70, "0f1636"), (130, "1a2650"), (180, "2c3e68"), (220, "4c6488"), (270, "7890aa")],
        sun=(110, 40, "f4f6ff", "b8c8f0"), sun_glow=0,
        cloud=["9aa6c8", "6e7aa0", "4e5880", "3a4268", "2a3052"], cloud_rim="d8e8ff",
        haze="40507a", far_fog=(0.15, 0.45), back_fog=(0.4, 0.65), far_y=(90, 262),
        mid_haze="243050", mid_fog=(0.05, 0.22), sil=("263252", 0.5, "1a2240", 0.55, "10142a", 0.8),
        rim_side=-1, rim="dce8ff", rim_t=0.38, near_dark=0.0, near_sat=0.0,
        lit=["fff4d0", "ffe8a8", "e8f0ff", "ffd890"],
    ),
}
DB.THEMES.update(THEMES2)

ALIEN = ["b6ff6a", "6af0c8", "3ac8a8", "2a8a7a"]  # beam / ship light colours (Overseer green-cyan)


def seed(theme, k):
    return 1000 + W2_THEMES.index(theme) * 37 + k


def put_text(cv, x, y, s, col, font=FONT3):
    for ch in s:
        g = font.get(ch, font.get("?"))
        for j, row in enumerate(g):
            for i, v in enumerate(row):
                if v == "#":
                    cv.set(x + i, y + j, col)
        x += len(g[0]) + 1
    return x


def dither_rect(cv, x, y, w, h, col, k, shape=None):
    """Translucent-looking fill with an ordered dither (k = coverage 0..1, may vary via shape)."""
    for yy in range(int(y), int(y + h)):
        for xx in range(int(x), int(x + w)):
            kk = k if shape is None else shape(xx, yy)
            if kk > 0 and BAYER[yy % 4][xx % 4] < kk * 16:
                cv.set(xx, yy, col)


def beam(cv, x_top, y_top, x_bot, y_bot, w_top, w_bot, col, k=0.5, core=None):
    """Tractor / search beam: a dithered quad, denser in the middle."""
    for y in range(int(y_top), int(y_bot)):
        t = (y - y_top) / max(1, y_bot - y_top)
        cx = x_top + (x_bot - x_top) * t
        hw = (w_top + (w_bot - w_top) * t) / 2
        for x in range(int(cx - hw), int(cx + hw) + 1):
            u = abs(x - cx) / max(1, hw)
            kk = k * (1 - u * u) * (0.55 + 0.45 * (1 - t))
            if BAYER[y % 4][x % 4] < kk * 16:
                cv.set(x, y, core if (core and u < 0.18 and BAYER[y % 4][x % 4] < 9) else col)


# ---------------------------------------------------------------------------
# SKY + CLOUDS
# ---------------------------------------------------------------------------
def stars(cv, r, n, ymax, bright=("ffffff", "dfe6ff", "fff2c8")):
    for i in range(n):
        x, y = r.randint(0, W - 1), int(r.random() ** 1.6 * ymax)
        col = r.choice(bright)
        cv.set(x, y, col)
        if i % 9 == 0:  # a few twinkly crosses
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                cv.set(x + dx, y + dy, mix(col, cv.get(x + dx, y + dy), 0.5))


def mothership(cv, cx, cy, w, h, hull=("3a3e5a", "2a2c44", "52587a", "1a1c2e"), lights=ALIEN):
    """Alien mothership seen from below: wide lens hull, ring of lights, glowing core."""
    body, dark, light, deep = hull
    for y in range(int(cy - h), int(cy + h) + 1):
        for x in range(int(cx - w), int(cx + w) + 1):
            u, v = (x - cx) / w, (y - cy) / h
            if u * u + v * v > 1:
                continue
            col = light if v < -0.45 else body if v < 0.25 else dark
            if v > 0.6:
                col = deep
            cv.set(x, y, col)
    # dome
    for y in range(int(cy - h * 1.9), int(cy - h * 0.6)):
        for x in range(int(cx - w * 0.32), int(cx + w * 0.32) + 1):
            u, v = (x - cx) / (w * 0.32), (y - (cy - h * 0.6)) / (h * 1.3)
            if u * u + v * v <= 1:
                cv.set(x, y, mix(light, lights[1], 0.25) if u < -0.2 else body)
    # light ring along the rim + underside core
    n = int(w // 4)
    for i in range(n):
        a = i / n * math.pi
        x = cx - math.cos(a) * w * 0.9
        y = cy + math.sin(a) * h * 0.35 + 1
        cv.set(x, y, lights[0] if i % 2 else lights[1])
    for y in range(int(cy + h * 0.2), int(cy + h) + 1):
        for x in range(int(cx - w * 0.18), int(cx + w * 0.18) + 1):
            if ((x - cx) / (w * 0.18)) ** 2 + ((y - cy - h * 0.6) / (h * 0.42)) ** 2 <= 1:
                cv.set(x, y, lights[0] if abs(x - cx) < w * 0.07 else lights[2])


def draw_sky(theme):
    th = THEMES2[theme]
    r = rng(seed(theme, 1))
    cv = Wrap(W, H)
    for y in range(H):
        ca, cb, t = gradient_col(th["sky"], y)
        for x in range(W):
            cv.px[x, y] = mix(ca, cb, dith(t, x, y, 6))
    sx, sy, core, edge = th["sun"]
    glow = th["sun_glow"]
    for y in range(max(0, sy - glow), min(H, sy + glow)):
        for x in range(sx - glow, sx + glow):
            d = math.hypot(x - sx, y - sy)
            if glow and d < glow:
                k = (1 - d / glow) ** 2
                cv.px[x % W, y] = mix(cv.px[x % W, y], edge, dith(k * (0.4 if theme == "night" else 0.55), x, y, 8))
    tones = th["cloud"]
    if theme in ("night", "stadium"):
        stars(cv, r, 140 if theme == "night" else 70, 190 if theme == "night" else 150)
    if theme == "night":
        # full moon: lit from the upper left, soft maria
        for y in range(sy - 10, sy + 11):
            for x in range(sx - 10, sx + 11):
                d = math.hypot(x - sx, y - sy)
                if d <= 9.2:
                    k = ((x - sx) + (y - sy)) / 13
                    col = core if k < 0.2 else mix(core, edge, 0.5) if k < 0.55 else edge
                    cv.set(x, y, col)
        for (dx, dy, rr) in ((-3, -2, 2.2), (2, 1, 2.8), (-1, 4, 1.6), (4, -4, 1.4)):
            for y in range(int(sy + dy - rr), int(sy + dy + rr) + 1):
                for x in range(int(sx + dx - rr), int(sx + dx + rr) + 1):
                    if math.hypot(x - sx - dx, y - sy - dy) <= rr:
                        cv.set(x, y, mix(cv.get(x, y), "8a92b8", 0.45))
        # far low city glow streaks
        for (cx, cy, w) in ((110, 214, 150), (340, 226, 170), (240, 200, 90)):
            streak(cv, cx, cy, w, mix(tones[2], th["sky"][5][1], 0.5), mix(tones[0], th["sky"][5][1], 0.6), r)
    elif theme == "stadium":
        # the mothership hangs over the ballpark (static: it's huge and far away)
        mothership(cv, 300, 34, 96, 13)
        for (cx, cy, w) in ((90, 120, 120), (420, 104, 110)):
            cirrus(cv, cx, cy, w, mix(tones[3], th["sky"][2][1], 0.5), mix(tones[2], th["sky"][2][1], 0.4), r)
    else:
        r_sun = 8
        for y in range(sy - r_sun - 1, sy + r_sun + 2):
            for x in range(sx - r_sun - 1, sx + r_sun + 2):
                d = math.hypot(x - sx, y - sy)
                if d <= r_sun:
                    cv.set(x, y, core if d < r_sun - 2 else edge)
        hz = th["haze"]
        y0 = 196 if theme == "park" else 168
        for cx in range(14, W, 58):
            cumulus(cv, cx + r.randint(-10, 10), y0 + r.randint(-12, 4), r.randint(22, 40), r.randint(7, 12),
                    [mix(t, hz, 0.45) for t in tones], r)
        for (cx, cy, w) in ((260, 96, 110), (430, 120, 70)):
            cirrus(cv, cx, cy, w, mix(tones[1], th["sky"][2][1], 0.55), mix(tones[0], th["sky"][2][1], 0.4), r)
    return cv


def draw_clouds(theme):
    th = THEMES2[theme]
    cv = Wrap(CLOUD_W, CLOUD_H)
    r = rng(seed(theme, 2))
    tones = th["cloud"]
    if theme == "park":
        for (cx, by, w, hgt) in ((70, 80, 104, 32), (250, 58, 70, 22), (410, 98, 128, 36), (580, 66, 70, 22), (330, 138, 60, 16)):
            cumulus(cv, cx, by, w, hgt, tones, r)
    elif theme == "lakefront":
        for (cx, by, w, hgt) in ((40, 70, 90, 28), (210, 52, 64, 20), (380, 92, 140, 34), (560, 60, 84, 24), (300, 132, 54, 14), (500, 140, 46, 12)):
            cumulus(cv, cx, by, w, hgt, tones, r)
    elif theme == "night":
        for (cx, by, w, hgt) in ((90, 84, 130, 26), (330, 62, 110, 22), (520, 104, 150, 30), (230, 140, 80, 14)):
            cumulus(cv, cx, by, w, hgt, tones, r, rim=th["cloud_rim"])
    else:
        for (cx, cy, w, col) in ((80, 70, 150, tones[2]), (300, 96, 190, tones[1]), (520, 60, 140, tones[2]),
                                 (420, 130, 120, tones[3]), (160, 140, 110, tones[3])):
            streak(cv, cx, cy, w, col, th["cloud_rim"], r)
    return cv


# ---------------------------------------------------------------------------
# shared primitives
# ---------------------------------------------------------------------------
def canopy(cv, x0, x1, y_top, cols, r, lump=10, rad=(9, 16)):
    """Continuous lumpy tree canopy band (park tree line) from y_top down to the layer bottom."""
    mid, dark, light, deep = cols
    x = x0
    while x < x1:
        rr = r.randint(*rad)
        cy = y_top + rr + r.randint(-lump // 2, lump // 2)
        for y in range(cy - rr, H):
            for xx in range(x - rr, x + rr + 1):
                d = math.hypot(xx - x, (y - cy) * 1.1)
                if y < cy and d > rr:
                    continue
                k = ((xx - x) * 0.5 + (y - cy)) / max(rr, 1) + (BAYER[y % 4][xx % 4] - 7.5) / 34
                col = light if k < -0.55 else mid if k < 0.15 else dark if k < 0.9 else deep
                if cv.get(xx, y)[3] and y > cy:
                    continue
                cv.set(xx, y, col)
        x += int(rr * 1.2)


def acorn_lamp(cv, x, base, col, glow=None, h=40):
    """Lincoln Park acorn lamp: slim post, flared base, acorn-shaped globe."""
    cv.rect(x, base - h, 2, h, col)
    cv.rect(x - 1, base - 6, 4, 6, col)
    cv.rect(x - 2, base - 2, 6, 2, col)
    g = glow or mix(col, "ffffff", 0.35)
    cv.rect(x - 2, base - h - 7, 6, 6, g)
    cv.rect(x - 1, base - h - 9, 4, 2, g)
    cv.rect(x - 2, base - h - 1, 6, 1, col)
    cv.rect(x, base - h - 11, 2, 2, col)
    if glow:
        cv.set(x, base - h - 5, "fffbe0")


def park_tree(cv, cx, base, rad, cols, trunk, r):
    DB.tree(cv, cx, base, rad, cols, trunk)


def three_flat(cv, x, base, w, h, stone, r, lit=None, coll=None, bay=True):
    """Chicago three-flat / greystone front: cornice, bay column, 3 window rows, stoop."""
    body, shade, light, wcol = stone
    y = base - h
    cv.rect(x, y, w, h, body)
    cv.rect(x + w - 3, y, 3, h, shade)
    cv.rect(x - 1, y - 3, w + 2, 3, light)  # cornice
    cv.rect(x - 1, y, w + 2, 1, shade)
    for xx in range(x, x + w, 3):
        cv.set(xx, y + 1, shade)
    floors = 3
    fh = (h - 10) // floors
    for f in range(floors):
        fy = y + 5 + f * fh
        if bay:  # projecting bay: lighter column with 3 windows
            cv.rect(x + 2, fy - 2, 14, fh, mix(body, light, 0.35))
            cv.rect(x + 2, fy - 2, 14, 1, light)
            for k, wx in enumerate((x + 3, x + 7, x + 12)):
                cv.rect(wx, fy, 3 if k != 1 else 4, fh - 5, wcol)
                if coll is not None:
                    coll.append((wx, fy, 3 if k != 1 else 4, fh - 5))
        for wx in range(x + (19 if bay else 4), x + w - 5, 6):
            cv.rect(wx, fy, 3, fh - 5, wcol)
            cv.rect(wx - 1, fy - 1, 5, 1, light)
            if coll is not None:
                coll.append((wx, fy, 3, fh - 5))
    # stoop + door
    cv.rect(x + w - 12, base - 9, 5, 9, mix(shade, "1a1c2c", 0.4))
    for i in range(4):
        cv.rect(x + w - 16 + i, base - 2 - i * 2, 9, 2, light if i % 2 == 0 else body)
    return y


# ---------------------------------------------------------------------------
# PARK — Lincoln Park, sunny morning
# ---------------------------------------------------------------------------
def far_park(theme):
    th = THEMES2[theme]
    r = rng(seed(theme, 10))
    base = 184
    back = Wrap(WIDE, H)
    # distant Streeterville / Gold Coast cluster (south, across the park), hazy
    x = 0
    while x < WIDE:
        w = r.randint(12, 24)
        tower(back, x, base, w, r.randint(20, 52), r.choice(["conc", "glass", "tan", "glassd", "lime"]),
              top=r.choice(["flat", "flat", "antenna", "step"]), win=False)
        x += w + r.randint(4, 30)
    hancock(back, 300, base, h=96)
    trump(back, 620, base + 80)  # far away: sinks below the treeline
    tower(back, 360, base, 18, 70, "lime", top="step")  # Palmolive-ish
    tower(back, 252, base, 16, 62, "glass", top="flat")
    tower(back, 690, base, 20, 72, "white", top="flat")
    grade(back, theme, th["back_fog"], th["far_y"][0], base, th["haze"])
    rim_light(back, th["rim_side"], th["rim"], 0.2, ymax=base)
    # park canopy in front (much closer), graded lighter toward its base
    front = Wrap(WIDE, H)
    cols = ["5f9a5a", "467e4a", "86ba6a", "2f5e3e"]
    canopy(front, 0, WIDE + 20, 166, cols, r, lump=12, rad=(10, 18))
    grade(front, theme, (0.32, 0.55), 160, 240, th["haze"])
    rim_light(front, -1, "f4ffd8", 0.25)
    back.blit(front, 0, 0)
    return back, []


def conservatory(cv, x, base):
    """Lincoln Park Conservatory: central palm-house dome + two lower glazed wings."""
    glass, glass2, frame, frame_d = "a8d8d8", "84bcc4", "f2f4f0", "b8c4c4"
    hi = "dcf4f0"

    def vault(x0, w, h_wall, h_roof):
        y_wall = base - h_wall
        cv.rect(x0, y_wall, w, h_wall, glass)
        for xx in range(x0, x0 + w, 4):
            cv.rect(xx, y_wall, 1, h_wall, frame)
        for yy in range(y_wall, base, 6):
            cv.rect(x0, yy, w, 1, frame)
        for i in range(w):  # barrel/curved roof
            u = (i - w / 2) / (w / 2)
            top = int(y_wall - h_roof * math.sqrt(max(0, 1 - u * u)))
            for yy in range(top, y_wall):
                col = glass2 if (i // 4) % 2 else glass
                if (i + yy) % 9 == 0:
                    col = hi
                cv.set(x0 + i, yy, col)
            cv.set(x0 + i, top, frame)
            if i % 4 == 0:
                cv.rect(x0 + i, top, 1, y_wall - top, frame)
        cv.rect(x0, base - 3, w, 3, "c8c0b0")  # stone plinth
        cv.rect(x0, base - 3, w, 1, "e4dcc8")
    vault(x, 34, 16, 10)  # west wing
    vault(x + 74, 34, 16, 10)  # east wing
    vault(x + 30, 48, 24, 22)  # palm house
    # lantern on the dome + finial
    cv.rect(x + 49, base - 52, 10, 6, glass)
    cv.rect(x + 49, base - 52, 10, 1, frame)
    for xx in range(x + 49, x + 59, 3):
        cv.rect(xx, base - 52, 1, 6, frame)
    cv.rect(x + 53, base - 56, 2, 4, frame_d)
    # palms inside the glass
    for (px_, py_) in ((x + 40, base - 16), (x + 60, base - 22), (x + 88, base - 10), (x + 10, base - 10)):
        for k in range(-5, 6):
            cv.set(px_ + k, py_ + abs(k) // 2, "4f9a48")
            cv.set(px_ + k, py_ + abs(k) // 2 + 1, "2f6b3a")
        cv.rect(px_, py_ + 2, 1, base - py_ - 5, "6e4227")


def zoo_gate(cv, x, base):
    """Zoo entrance: brick pillars with stone caps, iron arch with a sign board."""
    brick, brick_d, stone = "a65a40", "80412f", "e2d6bc"
    for px_ in (x, x + 46):
        cv.rect(px_, base - 34, 10, 34, brick)
        cv.rect(px_ + 7, base - 34, 3, 34, brick_d)
        cv.rect(px_ - 1, base - 37, 12, 3, stone)
        cv.rect(px_ + 2, base - 40, 6, 3, stone)
        for yy in range(base - 30, base, 4):
            cv.rect(px_, yy, 10, 1, brick_d)
    # iron arch + sign
    for i in range(36):
        u = (i - 18) / 18
        cv.set(x + 10 + i, base - 34 - int(8 * (1 - u * u)), "2b2d42")
    cv.rect(x + 12, base - 33, 32, 9, "2f5e3e")
    cv.rect(x + 12, base - 33, 32, 1, "e8c060")
    cv.rect(x + 12, base - 25, 32, 1, "e8c060")
    put_text(cv, x + 22, base - 31, "ZOO", "fff4d0")
    cv.disc(x + 17, base - 29, 2, "e8c060")
    cv.disc(x + 39, base - 29, 2, "e8c060")
    for gx in range(x + 12, x + 44, 3):  # gates (open)
        cv.rect(gx, base - 20, 1, 20, "2b2d42")


def pavilion(cv, x, base, w=60):
    """Prairie-style park pavilion (cafe) with a low red-tile hip roof and wide eaves."""
    wall, wall_d, roof, roof_d, trim = "e4d4b0", "c4b08c", "b85a3a", "8a3a2a", "6e4227"
    cv.rect(x + 4, base - 16, w - 8, 16, wall)
    cv.rect(x + w - 10, base - 16, 6, 16, wall_d)
    for wx in range(x + 8, x + w - 12, 7):
        cv.rect(wx, base - 12, 4, 8, "5a7a96")
        cv.rect(wx, base - 12, 4, 1, trim)
    for i in range(10):  # hip roof
        cv.rect(x - 4 + i * 2, base - 18 - i, w + 8 - i * 4, 1, roof if i % 2 else mix(roof, "ffffff", 0.12))
    cv.rect(x - 5, base - 18, w + 10, 2, roof_d)
    cv.rect(x + w // 2 - 3, base - 30, 6, 4, roof_d)


def mid_park(theme):
    th = THEMES2[theme]
    r = rng(seed(theme, 20))
    cv = Wrap(WIDE, H)
    LAWN = 206
    # rolling lawn + pond
    for x in range(WIDE):
        top = LAWN - int(3 * math.sin(x * 0.012) + 2 * math.sin(x * 0.031 + 2))
        for y in range(top, H):
            k = (y - top) / 40 + (BAYER[y % 4][x % 4] - 7.5) / 40
            cv.set(x, y, "8cc46a" if k < 0.08 else "74b05a" if k < 0.5 else "5e9a4e")
    trees = [(30, 14), (90, 18), (250, 16), (300, 13), (430, 17), (520, 15), (600, 19), (760, 14), (820, 18), (900, 15)]
    greens = ["5c9c52", "3f7a44", "86c06a", "2c5a38"]
    for (tx, rad) in trees:
        DB.tree(cv, tx, LAWN + 2, rad, greens, "5a4030")
    big = Wrap(WIDE, H)
    conservatory(big, 0, 100)
    sc = big.im.crop((0, 30, 116, 100)).resize((150, 90), 0)  # nearest-neighbour 1.3x: it's closer
    cv.paste_over(sc, 110, LAWN - 90)
    zoo_gate(cv, 660, LAWN)
    pavilion(cv, 470, LAWN, 64)
    # zoo rooftops peeking behind the gate: lion house gable + aviary dome
    cv.rect(720, LAWN - 34, 54, 34, "b86a48")
    cv.rect(764, LAWN - 34, 10, 34, "8e4a36")
    for i in range(14):
        cv.rect(718 + i * 2, LAWN - 36 - i, 58 - i * 4, 1, "6a7a7a" if i % 2 else "7e8e8e")
    for wx in range(726, 760, 8):
        cv.rect(wx, LAWN - 26, 4, 10, "5a7a96")
        cv.rect(wx, LAWN - 27, 4, 1, "e2d6bc")
    for y in range(LAWN - 52, LAWN - 30):  # aviary mesh dome
        for x in range(780, 820):
            u, v = (x - 800) / 20, (y - (LAWN - 30)) / 22
            if u * u + v * v <= 1 and (x + y) % 3 == 0:
                cv.set(x, y, "4a5a5a")
    grade(cv, theme, th["mid_fog"], 120, 262, th["mid_haze"])
    top_light(cv, "fffbe8", 0.3, ymax=LAWN)
    rim_light(cv, th["rim_side"], th["rim"], th["rim_t"] * 0.7, ymax=LAWN)
    # North Pond (after grading: water reflects the graded scene)
    pond(cv, 0, WIDE, LAWN + 10, r)
    return cv, {}


def pond(cv, x0, x1, wy, r, cols=("6aa8c0", "5a96b0", "4a8098", "a8dcec", "e4f6fa")):
    src = [[cv.px[x, y] for x in range(WIDE)] for y in range(H)]
    for y in range(wy, H):
        k = (y - wy) / max(1, H - wy)
        base = cols[0] if k < 0.4 else cols[1] if k < 0.75 else cols[2]
        for x in range(x0, x1):
            col = base
            sy = wy - 2 - int((y - wy) * 1.3)
            wob = int(round(1.4 * math.sin(y * 1.2 + x * 0.03)))
            if sy >= 0 and y % 3 != 2:
                p = src[sy][(x + wob) % WIDE]
                if p[3]:
                    col = mix(p, base, 0.55 + 0.3 * k)
            if (x + y * 7) % 41 == 0:
                col = cols[3]
            cv.set(x, y, col)
    cv.rect(x0, wy, x1 - x0, 1, "3e6e58")  # bank edge
    for y in range(wy + 3, H, 4):
        for x in range(x0, x1):
            if (x * 3 + y * 11) % 70 < 4:
                cv.set(x, y, cols[3])
            if (x * 3 + y * 11) % 70 == 1:
                cv.set(x, y, cols[4])
    # lily pads + a pair of ducks
    for i in range(14):
        lx, ly = r.randint(x0, x1), r.randint(wy + 4, H - 3)
        cv.rect(lx, ly, 4, 1, "4f9a48")
        cv.rect(lx + 1, ly + 1, 3, 1, "2f6b3a")
    for dx in (340, 352, 610):
        cv.rect(dx, wy + 8, 6, 3, "f2f2ea")
        cv.rect(dx + 4, wy + 6, 2, 2, "2f6b3a")
        cv.set(dx + 6, wy + 7, "f4b02a")


def near_park(theme):
    th = THEMES2[theme]
    cv = Wrap(WIDE, H)
    r = rng(seed(theme, 30))
    base = 266
    greens = DB.near_cols(theme, ["3f8a4c", "2c6a3e", "6cae5a", "1f4c30"])
    oak = DB.near_cols(theme, ["4a8a3e", "336a34", "78b45a", "234c2a"])
    metal = DB.near_cols(theme, ["2c3a44"])[0]
    trunk = DB.near_cols(theme, ["4a3426"])[0]
    x = 30
    i = 0
    while x < WIDE - 40:
        if i % 3 == 1:
            acorn_lamp(cv, x, base - 30, metal, None, h=44)
        else:
            DB.tree(cv, x, base - 26, r.randint(20, 28), oak if i % 2 else greens, trunk)
        x += r.randint(76, 104)
        i += 1
    # hedge with flower beds in front, iron fence
    hed = DB.near_cols(theme, ["3c7c44", "2a5c36", "5e9e52", "1c4028"])
    for x in range(WIDE):
        top = 236 - int(2 * math.sin(x * 0.2) + 2 * math.sin(x * 0.07 + 1))
        for y in range(top, H):
            k = (BAYER[y % 4][x % 4] - 7.5) / 30
            cv.set(x, y, hed[2] if y - top < 2 + k * 3 else hed[0] if y - top < 8 else hed[1])
    flowers = [DB.near_cols(theme, [cc])[0] for cc in ("e84a5a", "f4c84a", "f2f2f2", "c070f0", "ff7a2a")]
    for bx in range(20, WIDE, 140):  # flower beds: mounded clumps of blooms
        for i in range(26):
            fx = bx + r.randint(0, 44)
            fy = 240 + r.randint(0, 6) + abs(fx - bx - 22) // 6
            col = flowers[(i + bx) % len(flowers)]
            cv.rect(fx, fy, 2, 2, col)
            cv.set(fx, fy, mix(col, "ffffff", 0.35))
            cv.set(fx + 1, fy + 2, hed[1])
    for x in range(0, WIDE, 4):  # low hoop fence
        cv.rect(x, 250, 1, 8, metal)
        cv.set(x + 1, 249, metal), cv.set(x + 2, 249, metal)
    cv.rect(0, 256, WIDE, 1, metal)
    return cv, {}


# ---------------------------------------------------------------------------
# LAKEFRONT — North Avenue Beach, afternoon
# ---------------------------------------------------------------------------
LAKE_Y = 150


def sailboat(cv, x, base, s=1.0, sail="f8f8f4", hull="f2f4f6", shade="c8d0d8", col2=None):
    h = int(18 * s)
    for i in range(h):  # main sail (triangle, right of the mast)
        w = int((i / h) * 9 * s)
        cv.rect(x + 1, base - 3 - h + i, w, 1, sail if i < h * 0.6 or not col2 else col2)
    for i in range(int(h * 0.7)):  # jib
        w = int((i / (h * 0.7)) * 5 * s)
        cv.rect(x - w, base - 3 - int(h * 0.7) + i, w, 1, shade)
    cv.rect(x, base - 4 - h, 1, h + 1, "5a5c64")
    cv.rect(x - int(5 * s), base - 3, int(15 * s), 2, hull)
    cv.rect(x - int(4 * s), base - 1, int(13 * s), 1, shade)


def far_lakefront(theme):
    th = THEMES2[theme]
    r = rng(seed(theme, 10))
    cv = Wrap(WIDE, H)
    # skyline to the south across the water (left part of the layer), standing on the horizon
    back = Wrap(WIDE, H)
    x = 20
    while x < 520:
        w = r.randint(10, 22)
        tower(back, x, LAKE_Y, w, r.randint(14, 44), r.choice(["conc", "glass", "tan", "glassd", "lime"]),
              top=r.choice(["flat", "flat", "antenna", "step"]), win=False)
        x += w + r.randint(0, 6)
    front = Wrap(WIDE, H)
    hancock(front, 230, LAKE_Y, h=78)
    trump(front, 330, LAKE_Y + 110)
    aon(front, 380, LAKE_Y + 110)
    DB.willis(front, 430, LAKE_Y + 120)
    tower(front, 180, LAKE_Y, 18, 60, "lime", top="step")
    tower(front, 280, LAKE_Y, 16, 68, "glassd", top="flat")
    tower(front, 120, LAKE_Y, 14, 44, "white", top="flat")
    grade(back, theme, th["back_fog"], 60, LAKE_Y, th["haze"])
    grade(front, theme, th["far_fog"], 60, LAKE_Y, th["haze"])
    rim_light(front, th["rim_side"], th["rim"], 0.25, ymax=LAKE_Y)
    back.blit(front, 0, 0)
    cv.blit(back, 0, 0)
    # the lake: deep blue at the horizon -> teal toward the shore, sun glitter path
    stops = [(LAKE_Y, "3e7cb8"), (LAKE_Y + 20, "3a86b8"), (LAKE_Y + 60, "3592b2"), (H, "2f9aaa")]
    for y in range(LAKE_Y, H):
        ca, cb, t = gradient_col(stops, y)
        for x in range(WIDE):
            col = mix(ca, cb, dith(t, x, y, 4))
            if (x * 5 + y * 13) % 47 == 0 or ((x + y * 7) % 29 == 0 and y % 3 == 0):
                col = mix(col, "d8f0f8", 0.6)
            cv.px[x, y] = c(col)
    for y in range(LAKE_Y + 2, H, 3):  # long swell lines
        for x in range(WIDE):
            if (x + y * 17) % 90 < 16:
                cv.set(x, y, mix(cv.get(x, y), "5aa8d0", 0.5))
    cv.rect(0, LAKE_Y, WIDE, 1, "6aa6d0")
    # sun glitter (sun is up-right in the sky; glitter column scrolls with the lake)
    for y in range(LAKE_Y + 2, H):
        for x in range(700, 780):
            if BAYER[y % 4][x % 4] < 3 and (x * 3 + y * 5) % 7 == 0:
                cv.set(x, y, "fffbe0")
    # a few static sailboats + a freighter on the horizon
    for (sx, sy, s_) in ((560, LAKE_Y + 6, 0.6), (630, LAKE_Y + 10, 0.8), (860, LAKE_Y + 5, 0.55)):
        sailboat(cv, sx, sy, s_, sail="eef4f8", shade="b8ccd8")
    cv.rect(900, LAKE_Y - 4, 40, 3, "6a7488")
    cv.rect(926, LAKE_Y - 8, 6, 4, "8a94a6")
    grade(cv, theme, (0.0, 0.25), LAKE_Y, H, th["haze"])  # light haze over the water
    return cv, []


def beach_house(cv, x, base):
    """North Avenue Beach house: a white two-deck 'steamship' with blue trim, portholes and
    two smokestack towers, flags on the mast."""
    white, white_d, blue, blue_d, hull_d = "f4f6f8", "c8d0dc", "2f6fd6", "1e4c9a", "9aa6b6"
    L = 150
    # lower deck (hull) — rounded bow on the left
    cv.rect(x + 6, base - 18, L - 6, 18, white)
    for i in range(6):
        cv.rect(x + i, base - 18 + (6 - i) * 2, 6 - i, 18 - (6 - i) * 2, white)
    cv.rect(x, base - 4, L, 4, white_d)
    cv.rect(x + 4, base - 12, L - 8, 2, blue)  # blue stripe
    for px_ in range(x + 12, x + L - 10, 9):  # portholes
        cv.rect(px_, base - 9, 3, 3, "4a6a8c")
        cv.set(px_, base - 9, "8ab0d0")
    # upper deck with railing + windows
    cv.rect(x + 20, base - 32, L - 44, 14, white)
    cv.rect(x + L - 30, base - 32, 6, 14, white_d)
    for wx in range(x + 24, x + L - 34, 7):
        cv.rect(wx, base - 28, 5, 6, "5a86b8")
        cv.rect(wx, base - 28, 5, 1, blue_d)
    cv.rect(x + 14, base - 20, L - 26, 1, blue_d)  # deck rail
    for rx in range(x + 14, x + L - 12, 3):
        cv.rect(rx, base - 23, 1, 3, hull_d)
    cv.rect(x + 14, base - 23, L - 26, 1, white_d)
    # two 'smokestacks' (stair towers) with blue bands
    for sx in (x + 48, x + 92):
        cv.rect(sx, base - 50, 12, 18, white)
        cv.rect(sx + 9, base - 50, 3, 18, white_d)
        cv.rect(sx, base - 44, 12, 3, blue)
        cv.rect(sx - 1, base - 52, 14, 2, blue_d)
    # mast with pennants
    cv.rect(x + 76, base - 70, 1, 38, "5a5c64")
    cv.line(x + 77, base - 68, x + 120, base - 34, "5a5c64")
    cv.line(x + 76, base - 68, x + 30, base - 34, "5a5c64")
    for i, col in enumerate(("e3242b", "f4c84a", "2f6fd6", "f2f2f2", "3ab25a", "e3242b", "f4c84a")):
        t = (i + 1) / 8
        px_ = int(x + 77 + (43 * t))
        py_ = int(base - 68 + 34 * t)
        cv.rect(px_, py_ + 1, 2, 2, col)
        px_ = int(x + 76 - (46 * t))
        cv.rect(px_, py_ + 1, 2, 2, col)


def lifeguard_chair(cv, x, base, col="f4f6f8", shade="c0c8d0"):
    """Tall wooden lifeguard chair (white), seen side-on."""
    cv.line(x, base, x + 5, base - 20, col)
    cv.line(x + 12, base, x + 7, base - 20, shade)
    cv.rect(x + 3, base - 10, 7, 1, shade)
    cv.rect(x + 3, base - 22, 7, 2, col)
    cv.rect(x + 3, base - 30, 2, 8, col)
    cv.rect(x + 3, base - 31, 6, 1, "e3242b")  # red rescue board tip
    cv.rect(x + 8, base - 26, 2, 6, "e3242b")


def umbrella(cv, x, base, cols):
    a, b = cols
    for i in range(7):
        w = 4 + i * 2
        cv.rect(x - w // 2, base - 18 + i, w, 1, a if (i // 2) % 2 == 0 else b)
    for k in range(-6, 7, 3):
        cv.set(x + k, base - 11, b)
    cv.rect(x, base - 12, 1, 12, "6e6e6e")


def mid_lakefront(theme):
    th = THEMES2[theme]
    r = rng(seed(theme, 20))
    cv = Wrap(WIDE, H)
    SH = 192  # waterline / top of the beach
    # surf + wet sand + dry sand
    for x in range(WIDE):
        wl = SH + int(1.5 * math.sin(x * 0.05) + math.sin(x * 0.013 + 1))
        for y in range(wl - 4, H):
            if y < wl - 1:
                col = "eaf8fc" if (x + y * 3) % 7 else "b8e4f0"  # foam
                if (x // 6 + y) % 3 == 0:
                    continue
            elif y < wl + 3:
                col = "c8b48c"  # wet sand
            else:
                k = (y - wl) / 50 + (BAYER[y % 4][x % 4] - 7.5) / 50
                col = "f2dfb0" if k < 0.25 else "e8d2a0" if k < 0.6 else "dcc290"
            cv.set(x, y, col)
    # breakwater / jetty with a light tower on the left
    cv.rect(20, SH - 6, 90, 4, "8a8e96")
    cv.rect(20, SH - 6, 90, 1, "b6bac2")
    cv.rect(96, SH - 24, 8, 18, "e3242b")
    cv.rect(95, SH - 26, 10, 2, "f4f6f8")
    beach_house(cv, 300, SH + 18)
    for lx in (180, 560, 760, 900):
        lifeguard_chair(cv, lx, SH + 18)
    # volleyball nets
    for vx in (640, 820):
        cv.rect(vx, SH + 2, 1, 16, "4a4c54")
        cv.rect(vx + 34, SH + 2, 1, 16, "4a4c54")
        for yy in range(SH + 3, SH + 9):
            for xx in range(vx + 1, vx + 34):
                if (xx + yy) % 2 == 0:
                    cv.set(xx, yy, "f4f6f8")
        cv.rect(vx + 1, SH + 2, 33, 1, "f4f6f8")
    ucol = [("e3242b", "f4f6f8"), ("f4c84a", "2f6fd6"), ("3ab25a", "f4f6f8"), ("ff7a2a", "f4c84a"), ("2f6fd6", "f4f6f8")]
    for i, ux in enumerate((150, 230, 500, 540, 600, 720, 880, 940, 60)):
        umbrella(cv, ux, SH + 24 + (i % 3) * 3, ucol[i % len(ucol)])
    # beach-goers: tiny figures (towels, people)
    skin = ["f0b080", "c8894f", "8a5e3c", "ffd9b0"]
    for i in range(40):
        bx = r.randint(0, WIDE - 1)
        by = SH + r.randint(10, 40)
        if r.random() < 0.5:  # towel
            cv.rect(bx, by, 7, 2, r.choice(["e3242b", "2f6fd6", "f4c84a", "3ab25a", "e37ab0"]))
        else:
            cv.rect(bx, by - 5, 2, 2, r.choice(skin))
            cv.rect(bx, by - 3, 2, 3, r.choice(["e3242b", "2f6fd6", "f4c84a", "f2f2f2", "3ab25a", "1a1c2c"]))
    grade(cv, theme, th["mid_fog"], 150, 262, th["mid_haze"])
    rim_light(cv, th["rim_side"], th["rim"], th["rim_t"] * 0.6, ymax=SH + 30)
    return cv, {}


def near_lakefront(theme):
    cv = Wrap(WIDE, H)
    r = rng(seed(theme, 30))
    sand = DB.near_cols(theme, ["e2c890", "c8ac74", "f0dcac", "a88c5c"])
    grass = DB.near_cols(theme, ["8aae5a", "5e8a44", "b4d27a", "3e6a34"])
    wood = DB.near_cols(theme, ["9c7a52", "6e5236"])
    metal = DB.near_cols(theme, ["3a4a58"])[0]
    # dune
    for x in range(WIDE):
        top = 232 - int(5 * math.sin(x * 0.021) + 3 * math.sin(x * 0.063 + 2))
        for y in range(top, H):
            k = (y - top) / 20 + (BAYER[y % 4][x % 4] - 7.5) / 34
            cv.set(x, y, sand[2] if k < 0.12 else sand[0] if k < 0.7 else sand[1])
    # marram grass tufts
    for i in range(70):
        gx = r.randint(0, WIDE - 1)
        top = 232 - int(5 * math.sin(gx * 0.021) + 3 * math.sin(gx * 0.063 + 2))
        for k in range(r.randint(3, 6)):
            hgt = r.randint(6, 14)
            lean = r.choice((-1, 0, 1))
            for j in range(hgt):
                cv.set(gx + k * 2 + (lean * j) // 4, top + 2 - j, grass[2] if j > hgt * 0.6 else grass[k % 2])
    # snow fence (slat fence on wire), sagging
    for x in range(0, WIDE):
        if x % 4 == 0:
            sag = int(2 * math.sin(x * math.pi / 64))
            cv.rect(x, 224 + sag, 2, 16, wood[0] if x % 8 else wood[1])
    for x in range(0, WIDE, 64):
        cv.rect(x, 218, 3, 26, wood[1])
    # trail lamps (modern posts) + a life ring post
    for lx in range(90, WIDE, 240):
        cv.rect(lx, 190, 2, 56, metal)
        cv.rect(lx - 6, 188, 14, 3, metal)
        cv.rect(lx - 5, 191, 12, 1, DB.near_cols(theme, ["dce8f0"])[0])
        rx = lx + 120
        cv.rect(rx, 214, 2, 34, metal)
        cv.ring(rx + 1, 214, 6, DB.near_cols(theme, ["ff6a2a"])[0], 2.2)
    return cv, {}


# ---------------------------------------------------------------------------
# NIGHT — Wrigleyville
# ---------------------------------------------------------------------------
def light_tower(cv, x, base, h, col, lamp="f4f8ff", rows=3, w=16):
    cv.rect(x + w // 2 - 1, base - h, 2, h, col)
    for i in range(0, h - 12, 6):
        cv.line(x + w // 2 - 1, base - h + 12 + i, x + w // 2 + 1, base - h + 18 + i, col)
    cv.rect(x, base - h - rows * 3, w, rows * 3 + 1, col)
    for j in range(rows):
        for i in range(0, w - 1, 2):
            cv.set(x + 1 + i, base - h - rows * 3 + 1 + j * 3, lamp)


def wrigley_marquee(cv, x, base):
    """The classic red marquee over the main gate (red sign, white bulb letters)."""
    red, red_d, post = "d02830", "8a1820", "2a2c3c"
    cv.rect(x + 8, base - 18, 3, 18, post)
    cv.rect(x + 41, base - 18, 3, 18, post)
    cv.rect(x, base - 38, 52, 20, red)
    cv.rect(x, base - 38, 52, 2, "f04048")
    cv.rect(x, base - 20, 52, 2, red_d)
    put_text(cv, x + 4, base - 34, "WRIGLEY", "fff6e0")
    put_text(cv, x + 10, base - 27, "FIELD", "fff6e0")
    cv.rect(x + 2, base - 18, 48, 4, "1a1c2c")
    for xx in range(x + 3, x + 49, 2):
        cv.set(xx, base - 16, "ffd27a")


def far_night(theme):
    th = THEMES2[theme]
    r = rng(seed(theme, 10))
    base = 226
    back = Wrap(WIDE, H)
    # distant skyline glow (the Loop, far south) — tiny + hazy
    x = 0
    while x < WIDE:
        w = r.randint(10, 22)
        tower(back, x, base - 40, w, r.randint(20, 60), r.choice(["glassd", "black", "conc"]), win=False,
              top=r.choice(["flat", "antenna", "flat"]))
        x += w + r.randint(10, 40)
    hancock(back, 640, base - 40, h=96)
    grade(back, theme, th["back_fog"], 60, base, th["haze"], sil=(th["sil"][0], 0.5))
    front = Wrap(WIDE, H)
    groups = []
    # ballpark: grandstand + light towers + marquee, centred at x≈300
    gx = 220
    stand_top = base - 84
    for i in range(170):  # upper deck silhouette, roof line slightly curved
        top = stand_top + int(4 * ((i - 85) / 85) ** 2 * 4)
        front.rect(gx + i, top, 1, base - top, "34365a" if (i // 6) % 2 else "2e3052")
    front.rect(gx, stand_top - 3, 170, 3, "4a4c78")
    for i in range(0, 170, 2):  # roof fascia lights
        front.set(gx + i, stand_top - 2, "8a8eb8")
    for i in range(gx + 6, gx + 164, 6):  # concourse openings (lit)
        front.rect(i, base - 52, 3, 6, "ffcf7a")
        front.rect(i, base - 72, 3, 5, "ffcf7a")
    for lx in (gx + 10, gx + 70, gx + 130):
        light_tower(front, lx, stand_top - 3, 28, "4a4c78")
    wrigley_marquee(front, gx + 60, base - 22)
    # neighbourhood roofs left / right with lit windows
    x = 0
    while x < WIDE:
        if gx - 8 < x < gx + 178:
            x = gx + 178
            continue
        w = r.randint(26, 46)
        h = r.randint(36, 64)
        wl = []
        three_flat(front, x, base, w, h, MAT[r.choice(["lime", "brick", "tan", "conc"])], r, coll=wl, bay=w > 34)
        groups.append(wl)
        x += w + r.randint(2, 8)
    grade(front, theme, th["far_fog"], 60, base, th["haze"], sil=(th["sil"][0], th["sil"][1]))
    rim_light(front, th["rim_side"], th["rim"], 0.25, ymax=base - 2)
    win = light_groups(front, groups, r, th, p_row=0.42, run=(1, 5))
    back.blit(front, 0, 0)
    # alien tractor beams onto the ballpark (dithered, behind the light towers)
    beams = Wrap(WIDE, H)
    beam(beams, gx + 50, 54, gx + 46, stand_top, 6, 26, ALIEN[1], 0.45, core=ALIEN[0])
    beam(beams, gx + 128, 48, gx + 124, stand_top, 5, 22, ALIEN[1], 0.4, core=ALIEN[0])
    for bx, by in ((gx + 50, 52), (gx + 128, 46)):  # the pods the beams come from
        for y in range(by - 6, by + 3):
            for x in range(bx - 8, bx + 9):
                if ((x - bx) / 8) ** 2 + ((y - by + 2) / 4.5) ** 2 <= 1:
                    beams.set(x, y, "4a4e70" if y < by - 1 else "2a2c44")
        beams.rect(bx - 4, by + 1, 9, 1, ALIEN[0])
    out = Wrap(WIDE, H)
    out.blit(beams, 0, 0)
    out.blit(back, 0, 0)
    # beams in front of the stands too (lighter dither), so the stand reads as lit
    beam(out, gx + 46, stand_top - 6, gx + 46, stand_top + 14, 26, 30, ALIEN[0], 0.18)
    out.rect(0, base, WIDE, H - base, mix(th["haze"], "12122a", 0.4))
    return out, [w for w in win if 60 < w[1] < 250][:64]


def l_station(cv, y_deck, steel, x0=600):
    """Red Line at Addison: L structure + a station platform canopy with a sign."""
    DB.l_structure(cv, y_deck, steel, span=88)
    body, shade, dark, light = steel
    # platform + canopy
    cv.rect(x0, y_deck - 4, 120, 3, mix(light, "c8c8d0", 0.3))
    for px_ in range(x0 + 4, x0 + 120, 20):
        cv.rect(px_, y_deck - 22, 2, 18, dark)
    cv.rect(x0 - 2, y_deck - 25, 124, 3, shade)
    cv.rect(x0 - 2, y_deck - 26, 124, 1, light)
    cv.rect(x0 + 44, y_deck - 20, 32, 7, "f4f4f4")
    cv.rect(x0 + 44, y_deck - 20, 32, 2, "c8282e")
    put_text(cv, x0 + 47, y_deck - 17, "ADDISON", "1a1c2c")
    for i in range(0, 120, 8):  # platform lights
        cv.set(x0 + i + 2, y_deck - 22, "fff0b0")


def neon_sign(cv, x, y, word, col, board="141428", tall=False):
    w = len(word) * 4 + 4
    if tall:  # vertical blade
        cv.rect(x, y, 9, len(word) * 6 + 4, board)
        for i, ch in enumerate(word):
            put_text(cv, x + 3, y + 2 + i * 6, ch, col)
        return
    cv.rect(x, y, w, 9, board)
    put_text(cv, x + 2, y + 2, word, col)


def mid_night(theme):
    th = THEMES2[theme]
    r = rng(seed(theme, 20))
    cv = Wrap(WIDE, H)
    base = 262
    groups = []
    neons = []
    x = 0
    stones = ["lime", "brick", "tan", "conc", "brick"]
    i = 0
    while x < WIDE:
        w = r.randint(44, 62)
        h = r.randint(56, 86)
        wl = []
        mat = stones[i % len(stones)]
        y = three_flat(cv, x, base, w, h, MAT[mat], r, coll=wl)
        groups.append(wl)
        # rooftop bleachers on some roofs (stepped seating on a steel frame)
        if i % 3 == 1:
            sx = x + 4
            sw = w - 8
            for k in range(4):
                cv.rect(sx + k * 2, y - 6 - k * 5, sw - k * 4, 2, "a8acb8")
                cv.rect(sx + k * 2, y - 4 - k * 5, sw - k * 4, 3, "4a4c58")
            cv.line(sx, y - 3, sx + 8, y - 24, "3a3c48")
            cv.line(sx + sw, y - 3, sx + sw - 8, y - 24, "3a3c48")
            for k in range(4):  # fans
                for fx in range(sx + k * 2 + 1, sx + sw - k * 2 - 1, 3):
                    if r.random() < 0.7:
                        cv.rect(fx, y - 9 - k * 5, 2, 3, r.choice(["c8282e", "2f6fd6", "f2f2f2", "f4c84a", "1e3a7a"]))
            light_tower(cv, sx + sw - 10, y - 24, 10, "3a3c48", rows=2, w=10)
        elif r.random() < 0.5:
            water_tower(cv, x + r.randint(4, w - 20), y - 3, "9c6237", "6e4227", "3a2c26")
        # ground floor shop with a neon sign
        if i % 2 == 0:
            word, col = r.choice([("BAR", "ff6aa8"), ("PIZZA", "ff9a4a"), ("HOT DOGS", "ffd84a"), ("GO TEAM!", "6af0ff"),
                                  ("TAVERN", "ff6aa8"), ("GRILL", "a8f060"), ("OPEN", "ff3b3b")])
            nx, ny = x + 4, base - 30
            neon_sign(cv, nx, ny, word, col)
            neons.append((nx, ny, len(word) * 4 + 4, 9))
            cv.rect(x + 2, base - 18, w - 6, 18, "2a2c3c")
            cv.rect(x + 4, base - 16, w - 22, 12, "ffcf7a")
            groups.append([])
        elif r.random() < 0.6:
            vx = x + w - 14
            word, col = r.choice([("BAR", "ff6aa8"), ("EAT", "ffd84a"), ("INN", "6af0ff")])
            neon_sign(cv, vx, y + 8, word, col, tall=True)
            neons.append((vx, y + 8, 9, len(word) * 6 + 4))
        x += w + r.randint(0, 4)
        i += 1
    grade(cv, theme, th["mid_fog"], 120, 262, th["mid_haze"], sil=(th["sil"][2], th["sil"][3]))
    rim_light(cv, th["rim_side"], th["rim"], 0.2, ymax=base)
    win_mid = light_groups(cv, groups, r, th, p_row=0.5, run=(1, 6))
    # re-light neon after grading (signs glow, they don't fade into the haze)
    for (nx, ny, nw, nh) in neons:
        for yy in range(ny - 2, ny + nh + 2):
            for xx in range(nx - 2, nx + nw + 2):
                p = cv.get(xx, yy)
                if p[3] and sum(p[:3]) > 330:
                    continue
                if BAYER[yy % 4][xx % 4] < 4:
                    cv.set(xx, yy, mix(p if p[3] else c("1a1c2c"), "ff6aa8", 0.25)) if p[3] else None
    steel = [mix(s_, "1e1c3c", 0.55) for s_ in ("b8603c", "8e4428", "5e2c1e", "d88a5c")]
    l_station(cv, 196, steel, x0=560)
    return cv, {"win_mid": win_mid, "train": {"layer": "mid", "y": 193}, "neon": neons}


def near_night(theme):
    th = THEMES2[theme]
    cv = Wrap(WIDE, H)
    r = rng(seed(theme, 30))
    base = 266
    greens = DB.near_cols(theme, ["3f8a4c", "2c6a3e", "6cae5a", "1f4c30"])
    metal = DB.near_cols(theme, ["2c3a44"])[0]
    lamps = []
    x = 20
    i = 0
    while x < WIDE - 40:
        if i % 2 == 0:
            DB.lamp_post(cv, x, base, metal, "ffd77a", h=64)
            lamps.append((x, base - 64))
        else:
            DB.tree(cv, x, base, r.randint(18, 24), greens, DB.near_cols(theme, ["4a3426"])[0])
        x += r.randint(80, 110)
        i += 1
    # parked cars silhouettes + curb
    car = DB.near_cols(theme, ["3a4060"])[0]
    for cx in range(60, WIDE, 210):
        cv.rect(cx, 246, 44, 10, car)
        cv.rect(cx + 8, 238, 26, 9, car)
        cv.rect(cx + 11, 240, 9, 5, DB.near_cols(theme, ["5a6a8a"])[0])
        cv.rect(cx + 22, 240, 9, 5, DB.near_cols(theme, ["5a6a8a"])[0])
        cv.disc(cx + 9, 256, 4, "12121e")
        cv.disc(cx + 35, 256, 4, "12121e")
        cv.rect(cx + 42, 248, 2, 2, "ff4a4a")
    for x in range(WIDE):
        top = 252
        for y in range(top, H):
            cv.set(x, y, DB.near_cols(theme, ["4a4a58"])[0] if y > top else DB.near_cols(theme, ["7a7a88"])[0])
    for (lx, ly) in lamps:
        for gx in (lx - 5, lx + 6):
            glow_halo(cv, gx, ly - 1, 14, "ffc870", 0.55)
    return cv, {}


# ---------------------------------------------------------------------------
# STADIUM — inside the ballpark at night
# ---------------------------------------------------------------------------
def far_stadium(theme):
    th = THEMES2[theme]
    r = rng(seed(theme, 10))
    base = 206
    back = Wrap(WIDE, H)
    groups = []
    # Wrigleyville rooftops beyond the outfield, many with rooftop bleachers (lit)
    x = 0
    while x < WIDE:
        w = r.randint(36, 56)
        h = r.randint(26, 46)
        wl = []
        y = three_flat(back, x, base, w, h, MAT[r.choice(["lime", "brick", "tan", "brick"])], r, coll=wl, bay=w > 40)
        groups.append(wl)
        if r.random() < 0.7:
            for k in range(4):
                back.rect(x + 3 + k * 2, y - 5 - k * 4, w - 6 - k * 4, 2, "c8ccd8")
                back.rect(x + 3 + k * 2, y - 3 - k * 4, w - 6 - k * 4, 2, "5a5e70")
                for fx in range(x + 4 + k * 2, x + w - 4 - k * 2, 3):
                    if r.random() < 0.65:
                        back.rect(fx, y - 7 - k * 4, 2, 2, r.choice(["c8282e", "2f6fd6", "f2f2f2", "f4c84a"]))
        x += w + r.randint(0, 6)
    back.rect(0, base, WIDE, H - base, MAT["conc"][1])
    grade(back, theme, th["far_fog"], 120, base, th["haze"], sil=(th["sil"][0], th["sil"][1]))
    win = light_groups(back, groups, r, th, p_row=0.4, run=(1, 5))
    rim_light(back, th["rim_side"], th["rim"], 0.2, ymax=base)
    # alien scout pods beaming up the neighbourhood
    out = Wrap(WIDE, H)
    for (bx, by, w0, w1) in ((250, 70, 6, 30), (700, 56, 5, 26)):
        beam(out, bx, by + 3, bx - 6, base, w0, w1, ALIEN[1], 0.32, core=ALIEN[0])
        for y in range(by - 6, by + 3):
            for x in range(bx - 9, bx + 10):
                if ((x - bx) / 9) ** 2 + ((y - by + 2) / 4.5) ** 2 <= 1:
                    out.set(x, y, "565a80" if y < by - 2 else "2e3050")
        out.rect(bx - 5, by + 1, 11, 1, ALIEN[0])
        out.set(bx - 2, by - 6, ALIEN[1]), out.set(bx + 2, by - 6, ALIEN[1])
    out.blit(back, 0, 0)
    return out, [w for w in win if 60 < w[1] < 250][:64]


def scoreboard(cv, x, base):
    """Centre-field hand-turned scoreboard: dark green box, white number plates, clock on top,
    pennant flags flying from poles above."""
    g, g_d, g_l = "2e5a3e", "1e4030", "3e6e4c"
    W_, H_ = 120, 52
    y = base - H_
    cv.rect(x, y, W_, H_, g)
    cv.rect(x, y, W_, 2, g_l)
    cv.rect(x + W_ - 4, y, 4, H_, g_d)
    # inning grid: 2 rows x 10 columns of plates + team name slots
    for row in range(3):
        yy = y + 8 + row * 12
        cv.rect(x + 4, yy, 26, 8, g_d)
        put_text(cv, x + 6, yy + 2, ["HOME", "AWAY", "BALL"][row], "e8f0e8")
        for k in range(9):
            px_ = x + 34 + k * 9
            cv.rect(px_, yy, 7, 8, "f2f4f0" if (row < 2 and (k * 7 + row * 3) % 5 != 0) else g_d)
            if row < 2 and (k * 7 + row * 3) % 5 != 0:
                put_text(cv, px_ + 2, yy + 2, str((k + row * 2) % 3), "1a1c2c")
    # clock on top
    cx = x + W_ // 2
    cv.rect(cx - 12, y - 14, 24, 14, g)
    cv.disc(cx, y - 7, 6, "f2f4f0")
    cv.disc(cx, y - 7, 5, "f8f8f0")
    cv.rect(cx, y - 11, 1, 4, "1a1c2c")
    cv.rect(cx, y - 7, 3, 1, "1a1c2c")
    # flagpoles + pennants (team pennants: plain colours, no logos)
    cols = ["c8282e", "2f6fd6", "f2f2f2", "f4c84a", "3ab25a", "e37ab0", "ff7a2a"]
    for k, fx in enumerate(range(x + 4, x + W_, 14)):
        cv.rect(fx, y - 30, 1, 30, "c8ccd8")
        for j, fy in enumerate((y - 29, y - 22, y - 15)):
            col = cols[(k + j * 3) % len(cols)]
            for t in range(8):
                cv.rect(fx + 1 + t, fy + t // 3, 1, max(1, 4 - t // 2), col)


def mid_stadium(theme):
    th = THEMES2[theme]
    r = rng(seed(theme, 20))
    cv = Wrap(WIDE, H)
    WALL = 214
    BL = 172  # top of the bleachers
    # outfield bleachers rising behind the wall: bench rows, fans as 2x3 figures (head + shirt)
    shirts = ["a83038", "2f5aa6", "c8ccd8", "c8a040", "28407a", "3a3e4c", "6a3a6a"]
    heads = ["d8a070", "a87850", "6a4a34", "2a2a34"]
    for x in range(WIDE):
        for y in range(BL, WALL):
            cv.set(x, y, "3a3e4c" if (y - BL) % 5 else "5a6070")
    for row in range((WALL - BL) // 5):
        y = BL + row * 5 + 1
        x = 0
        while x < WIDE:
            if hh2(x, row, 1) < 0.62:
                cv.rect(x, y + 1, 2, 3, shirts[int(hh2(x, row, 3) * len(shirts))])
                cv.rect(x, y, 2, 1, heads[int(hh2(x, row, 5) * len(heads))])
            x += 3
    for ax in range(40, WIDE, 160):  # aisles
        cv.rect(ax, BL, 3, WALL - BL, "6a7080")
    cv.rect(0, BL - 2, WIDE, 2, "8a90a0")  # back rail
    for x in range(0, WIDE, 4):
        cv.rect(x, BL - 5, 1, 3, "6a7080")
    cv.rect(0, BL - 6, WIDE, 1, "8a90a0")
    scoreboard(cv, 420, BL - 6)
    flares = []
    for lx in (90, 300, 660, 860):  # light standards on the stand roofs
        light_tower(cv, lx, BL - 6, 64, "4a5276", rows=4, w=28)
        flares.append((lx + 14, BL - 6 - 64 - 6))
    # ivy-covered outfield wall (leaf clusters lit from above) + yellow line on the coping
    for x in range(WIDE):
        for y in range(WALL, WALL + 30):
            cv.set(x, y, "234a2e")
    for gy in range(0, 12):
        for gx in range(0, WIDE // 3 + 1):
            lx = gx * 3 + int(hh2(gx, gy, 1) * 3)
            ly = WALL + 2 + gy * 3 + int(hh2(gx, gy, 2) * 2)
            k = hh2(gx, gy, 3)
            hi, md, lo = ("6aa85a", "3f7a44", "2a5634") if k < 0.8 else ("8ab85a", "5e8a3a", "3a5a2a")
            for dx, dy, col in ((1, 0, hi), (0, 1, hi), (1, 1, md), (2, 1, md), (1, 2, lo), (2, 2, lo)):
                if ly + dy < WALL + 30:
                    cv.set(lx + dx, ly + dy, col)
    for x in range(WIDE):
        cv.set(x, WALL, "f4c84a")
        cv.set(x, WALL + 1, "c8962a")
    # wall distance markers + a doorway in the ivy
    for (mx, txt) in ((120, "368"), (480, "400"), (840, "368")):
        put_text(cv, mx, WALL + 6, txt, "f2f4f0")
    cv.rect(640, WALL + 8, 14, 22, "1e4030")
    grade(cv, theme, th["mid_fog"], 120, 262, th["mid_haze"], sil=(th["sil"][2], th["sil"][3] * 0.4))
    top_light(cv, "dce8ff", 0.3, ymax=WALL)
    for (fx, fy) in flares:  # light bloom around each lamp bank (after grading: lights stay hot)
        glow_halo(cv, fx, fy, 30, "eef4ff", 0.6)
        for x in range(fx - 13, fx + 14):
            for y in range(fy - 5, fy + 7):
                p = cv.get(x, y)
                if p[3] and sum(p[:3]) > 500:
                    cv.set(x, y, "ffffff")
    # outfield grass below the wall (warning track first)
    for x in range(WIDE):
        for y in range(WALL + 30, H):
            col = "8a6a4a" if y < WALL + 36 else ("3c7a3c" if ((x // 24) % 2) else "347034")
            cv.set(x, y, col)
    return cv, {"flares": {"layer": "mid", "pts": flares}}


def hh2(*a):
    from draw_terrain import hh
    return hh(*a)


def near_stadium(theme):
    cv = Wrap(WIDE, H)
    # foul pole (yellow) with a screen, dugout-rail padding, mowed outfield stripes at the bottom
    pole, pole_d = mix("f4c84a", "10142a", 0.25), mix("c8962a", "10142a", 0.35)
    for x in range(WIDE):
        for y in range(250, H):
            stripe = ((x + (y - 250) // 2) // 32) % 2
            cv.set(x, y, DB.near_cols(theme, ["3e8a40" if stripe else "347a38"])[0])
        cv.set(x, 250, DB.near_cols(theme, ["5aa654"])[0])
    for px_ in (200, 680):
        cv.rect(px_, 90, 4, 160, pole)
        cv.rect(px_ + 3, 90, 1, 160, pole_d)
        for y in range(100, 200):  # screen
            for x in range(px_ + 4, px_ + 12):
                if (x + y) % 2 == 0:
                    cv.set(x, y, pole)
        cv.rect(px_ - 1, 88, 6, 2, pole)
    # padded wall rail at field level (bullpen)
    pad = DB.near_cols(theme, ["1e4c8a"])[0]
    for x0 in (360, 850):
        cv.rect(x0, 236, 70, 14, pad)
        cv.rect(x0, 236, 70, 2, DB.near_cols(theme, ["3a6ab0"])[0])
        cv.rect(x0 + 6, 244, 58, 2, DB.near_cols(theme, ["c8282e"])[0])
    return cv, {}


# ---------------------------------------------------------------------------
def draw_theme(theme):
    """-> (layers {sky, clouds, far, mid, near}, anchors dict for AmbientAnchors)."""
    a = {}
    if theme == "park":
        far, win_far = far_park(theme)
        mid, ma = mid_park(theme)
        near, na = near_park(theme)
        a.update({"flutter": "butterflies"})
    elif theme == "lakefront":
        far, win_far = far_lakefront(theme)
        mid, ma = mid_lakefront(theme)
        near, na = near_lakefront(theme)
        a.update({"lake": {"layer": "far", "y": LAKE_Y + 12}})
    elif theme == "night":
        far, win_far = far_night(theme)
        mid, ma = mid_night(theme)
        near, na = near_night(theme)
        a.update({"flutter": "fireflies", "ships": True, "beams": [140, 360]})
    else:
        far, win_far = far_stadium(theme)
        mid, ma = mid_stadium(theme)
        near, na = near_stadium(theme)
        a.update({"ships": True, "beams": [60, 240, 420]})
    a["win_far"] = [w for w in win_far if 40 < w[1] < 250][:64]
    a["win_mid"] = [w for w in ma.pop("win_mid", []) if w[1] < 230][:48]
    a.update(ma)
    a.update(na)
    layers = {"sky": draw_sky(theme), "clouds": draw_clouds(theme), "far": far, "mid": mid, "near": near}
    return layers, a


# ---------------------------------------------------------------------------
# AMBIENT sprites (merged into public/assets/ambient.png by draw_backgrounds.main)
# ---------------------------------------------------------------------------
def ambient_frames():
    from pxl import Cv
    fr = {}
    fr["train_night"] = DB.l_train_sprite("night").im
    # sailboats for the lake horizon (far layer, factor 0.1): pre-hazed toward the lake haze
    th = THEMES2["lakefront"]
    for i, (s_, sail, col2) in enumerate(((1.0, "f8f8f4", None), (0.75, "f8f8f4", "e3242b"), (0.85, "f4f0e0", "2f6fd6"))):
        cv = Wrap(22, 26)
        sailboat(cv, 8, 25, s_, sail=sail, col2=col2)
        for y in range(cv.h):
            for x in range(cv.w):
                p = cv.px[x, y]
                if p[3]:
                    cv.px[x, y] = mix(p, th["haze"], 0.3)
        fr[f"sail_{i}"] = cv.im.crop(cv.im.getbbox())
    # butterflies (white, tinted at runtime): wings open / half / closed
    shapes = [["#.#", "###", "#.#"], [".#.", "###", ".#."], ["...", ".#.", ".#."]]
    for i, rows in enumerate(shapes):
        cv = Cv(5, 4)
        for y, row in enumerate(rows):
            for x, v in enumerate(row):
                if v == "#":
                    cv.set(x + 1, y, "ffffff")
        cv.set(2, 3, "ffffff") if i == 2 else None
        fr[f"butterfly_{i}"] = cv.im
    # firefly mote: 3x3 plus with a hot centre
    cv = Cv(3, 3)
    for x, y in ((1, 0), (0, 1), (2, 1), (1, 2)):
        cv.set(x, y, "d8ff9a")
    cv.set(1, 1, "ffffff")
    fr["mote"] = cv.im
    # alien scout ship, two frames (rim lights chase)
    for i in range(2):
        cv = Cv(26, 12)
        mothership(cv, 12.5, 7, 12, 3.2, lights=ALIEN if i == 0 else [ALIEN[1], ALIEN[0], ALIEN[2], ALIEN[3]])
        fr[f"ufo_{i}"] = cv.im
    # searchlight / beam wedge (white, drawn with alpha + ADD at runtime), origin bottom-centre
    cv = Cv(24, 180)
    for y in range(180):
        hw = 1 + (179 - y) / 179 * 11
        for x in range(24):
            if abs(x - 11.5) <= hw:
                cv.set(x, y, "ffffff")
    fr["beam"] = cv.im
    # flare: dithered white disc for pulsing light banks
    cv = Cv(24, 24)
    for y in range(24):
        for x in range(24):
            d = math.hypot(x - 11.5, y - 11.5) / 11.5
            if d < 1 and BAYER[y % 4][x % 4] < (1 - d) * 26:
                cv.set(x, y, "ffffff")
    fr["flare"] = cv.im
    return fr
