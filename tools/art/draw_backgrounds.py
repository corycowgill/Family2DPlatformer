#!/usr/bin/env python3
"""
Parallax backgrounds + ambient sprites for every level theme (World 1 here; the World 2
themes park / lakefront / night / stadium come from draw_backgrounds_w2.py).

Outputs
  public/assets/backgrounds/bg-<theme>-sky.png     480x270 opaque gradient, sun, distant clouds (static)
  public/assets/backgrounds/bg-<theme>-clouds.png  640x176 drifting cumulus layer (transparent)
  public/assets/backgrounds/bg-<theme>-far.png     960x270 skyline: hazy back row + landmark row
  public/assets/backgrounds/bg-<theme>-mid.png     960x270 mid-rises / rooftops / river + bridges / L
  public/assets/backgrounds/bg-<theme>-near.png    960x270 dark, saturated foreground silhouettes
  public/assets/ambient.png/.json                  ambient sprite atlas (birds, trains, boats, steam...)
  public/assets/ambient-water.png                  32x8 scrolling water-surface highlight strip
  src/game/world/AmbientAnchors.ts                 generated: lit windows / vents / track & river lines
  art/previews/backgrounds.png                     all four themes composited

Every primitive is drawn modulo the layer width so all layers tile seamlessly.
Atmospheric perspective: each row of buildings is drawn in "material" colours, then
graded per theme -- far rows are pulled hard toward the horizon haze (more so near their
base, where the air is thickest), mid rows less, near layers are darkened and saturated.
Sunset rows are first pushed toward a purple silhouette and get a warm rim light on the
sun side plus lit windows (whose positions are exported for the twinkle effect).
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from pxl import ASSETS, PREVIEWS, ROOT, FONT3, Cv, T, c, hexc, rng, pack_atlas  # noqa: E402
from PIL import Image  # noqa: E402

W, H = 480, 270
WIDE = 960
CLOUD_W, CLOUD_H = 640, 176
OUT = os.path.join(ASSETS, "backgrounds")
ANCHORS_TS = os.path.join(ROOT, "src", "game", "world", "AmbientAnchors.ts")

BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
THEME_NAMES = ("day", "rooftop", "river", "sunset", "park", "lakefront", "night", "stadium")
W1_THEMES = THEME_NAMES[:4]  # World 2 themes are drawn by draw_backgrounds_w2.py


def clamp01(v):
    return 0.0 if v < 0 else 1.0 if v > 1 else v


def mix(a, b, t):
    a, b = c(a), c(b)
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3)) + (255,)


def dith(t, x, y, steps):
    """Quantise t (0..1) to `steps` levels with a 4x4 ordered dither."""
    q = clamp01(t) * steps
    i = int(q)
    if (q - i) * 16 > BAYER[y % 4][x % 4] + 0.5:
        i += 1
    return min(steps, i) / steps


class Wrap(Cv):
    """Canvas whose x coordinate wraps (for seamless horizontal tiling)."""

    def set(self, x, y, col):
        x, y = int(x) % self.w, int(y)
        if 0 <= y < self.h:
            self.px[x, y] = c(col) if col != T else T

    def get(self, x, y):
        y = int(y)
        if 0 <= y < self.h:
            return self.px[int(x) % self.w, y]
        return T

    def rect(self, x, y, w, h, col):
        col = c(col) if col != T else T
        for yy in range(max(0, int(y)), min(self.h, int(y + h))):
            for xx in range(int(x), int(x + w)):
                self.px[xx % self.w, yy] = col


# ---------------------------------------------------------------------------
# Theme definitions
# ---------------------------------------------------------------------------
THEMES = {
    "day": dict(
        sky=[(0, "2a6cd0"), (60, "3c86de"), (120, "62a4ea"), (175, "93c6f2"), (215, "c4e2f8"), (250, "e6f4fc")],
        sun=(132, 58, "fffbe8", "fff3c0"), sun_glow=34,
        cloud=["ffffff", "f0f7fd", "d6e6f4", "b0c9e2", "93b1d4"], cloud_rim=None,
        haze="cfe4f6", far_fog=(0.34, 0.62), back_fog=(0.62, 0.82), far_y=(70, 262),
        mid_haze="b7d3ec", mid_fog=(0.2, 0.42), sil=None,
        rim_side=-1, rim="ffffff", rim_t=0.32,
        near_dark=0.18, near_sat=0.25,
    ),
    "rooftop": dict(
        sky=[(0, "2c5aa8"), (45, "3f74bc"), (95, "6e98c8"), (140, "b0bcc8"), (180, "e4cdb0"), (220, "f6d49c"), (255, "fae0b0")],
        sun=(388, 52, "fffbea", "fff0c8"), sun_glow=40,
        cloud=["fffaf0", "f6ecdc", "e0d2c4", "c4b6b0", "a69ca6"], cloud_rim=None,
        haze="ead8c0", far_fog=(0.3, 0.9), back_fog=(0.6, 0.95), far_y=(60, 252),
        mid_haze="d6c8bc", mid_fog=(0.16, 0.5), sil=None,
        rim_side=1, rim="fff4dc", rim_t=0.35,
        near_dark=0.12, near_sat=0.1,
    ),
    "river": dict(
        sky=[(0, "2470c4"), (60, "3a8ad4"), (120, "5fa8e2"), (175, "8ec8ec"), (215, "bfe2f0"), (250, "e2f4f4")],
        sun=(96, 66, "fffcec", "fff4cc"), sun_glow=30,
        cloud=["ffffff", "eef8fc", "d2e8f2", "a8cce2", "8ab4d2"], cloud_rim=None,
        haze="c6e2ee", far_fog=(0.36, 0.66), back_fog=(0.62, 0.84), far_y=(70, 262),
        mid_haze="b4d6e8", mid_fog=(0.16, 0.36), sil=None,
        rim_side=-1, rim="ffffff", rim_t=0.3,
        near_dark=0.15, near_sat=0.25,
    ),
    "sunset": dict(
        sky=[(0, "1a1240"), (40, "2e1a5c"), (90, "5a2678"), (135, "963a86"), (175, "d4567a"), (205, "f27e5e"), (232, "ffb060"), (255, "ffd27c")],
        sun=(330, 150, "fff2b8", "ffb45a"), sun_glow=80,
        cloud=["ffd0a8", "f6a092", "d06e8a", "8e4a86", "5e3478"], cloud_rim="ffe0a0",
        haze="d8708a", far_fog=(0.12, 0.5), back_fog=(0.42, 0.7), far_y=(60, 262),
        mid_haze="9a4878", mid_fog=(0.04, 0.22), sil=("54306e", 0.72, "2e1c46", 0.86, "1c1230", 0.9),
        rim_side=1, rim="ffb26a", rim_t=0.55,
        near_dark=0.0, near_sat=0.0,
        lit=["ffd27a", "ffc060", "fff0b0", "ffb070"],
    ),
}

# material colours: body, shade, light, window
MAT = {
    "glass": ("6a90b8", "4d6f96", "a0c2e0", "a8d0ee"),
    "glassd": ("43587a", "33445f", "7088aa", "8aa6c8"),
    "teal": ("5c98a4", "457a86", "8cc0c8", "a8dce0"),
    "black": ("363a46", "272a33", "5c6272", "6c7488"),
    "lime": ("cdbd94", "a99a74", "e6dab6", "7c8696"),
    "white": ("dcdee2", "b6bac2", "f4f6f8", "9aa6b6"),
    "brick": ("a65a40", "80412f", "c87a5c", "5a6880"),
    "conc": ("a0a2aa", "80828c", "c0c2ca", "667082"),
    "tan": ("bba07c", "977c5f", "d6c09c", "667082"),
    "green": ("6c8c84", "52706a", "94b2a8", "a8ccc4"),
}


# ---------------------------------------------------------------------------
# Post-processing (grade / fog / rim)
# ---------------------------------------------------------------------------
def grade(cv, theme, fog, y0, y1, haze, sil=None, steps=10):
    """Atmospheric perspective: pull opaque pixels toward `haze`, more strongly near the base."""
    hz = c(haze)
    s_col = c(sil[0]) if sil else None
    for y in range(cv.h):
        k = clamp01((y - y0) / max(1, y1 - y0))
        t = fog[0] + (fog[1] - fog[0]) * k * k ** 0.2
        for x in range(cv.w):
            p = cv.px[x, y]
            if p[3] == 0:
                continue
            if s_col:
                p = mix(p, s_col, sil[1])
            tt = dith(t, x, y, steps)
            cv.px[x, y] = mix(p, hz, tt)


def rim_light(cv, side, col, t, ymax=None, depth=1):
    """Lighten pixels whose neighbour on `side` (-1 left, +1 right) is transparent."""
    w, h = cv.w, cv.h
    alpha = [[cv.px[x, y][3] for x in range(w)] for y in range(h)]
    for y in range(h):
        if ymax and y > ymax:
            break
        row = alpha[y]
        for x in range(w):
            if not row[x]:
                continue
            for d in range(1, depth + 1):
                if not row[(x + side * d) % w]:
                    cv.px[x, y] = mix(cv.px[x, y], col, t * (1.0 if d == 1 else 0.5))
                    break


def top_light(cv, col, t, ymax=None):
    """Lighten pixels whose upper neighbour is transparent (roof edges catch the sky)."""
    w = cv.w
    for y in range(1, cv.h):
        if ymax and y > ymax:
            break
        for x in range(w):
            if cv.px[x, y][3] and not cv.px[x, y - 1][3]:
                cv.px[x, y] = mix(cv.px[x, y], col, t)


def saturate(col, amt, dark):
    r, g, b, a = col
    m = (r + g + b) / 3
    r, g, b = (m + (r - m) * (1 + amt), m + (g - m) * (1 + amt), m + (b - m) * (1 + amt))
    f = 1 - dark
    return (max(0, min(255, int(r * f))), max(0, min(255, int(g * f))), max(0, min(255, int(b * f))), 255)


# ---------------------------------------------------------------------------
# SKY
# ---------------------------------------------------------------------------
def gradient_col(stops, y):
    for i in range(len(stops) - 1):
        (ya, ca), (yb, cb) = stops[i], stops[i + 1]
        if y <= yb:
            return ca, cb, clamp01((y - ya) / max(1, yb - ya))
    return stops[-1][1], stops[-1][1], 0.0


def draw_sky(theme):
    th = THEMES[theme]
    cv = Wrap(W, H)
    for y in range(H):
        ca, cb, t = gradient_col(th["sky"], y)
        for x in range(W):
            cv.px[x, y] = mix(ca, cb, dith(t, x, y, 6))
    sx, sy, core, edge = th["sun"]
    glow = th["sun_glow"]
    # sun glow: dithered halo blending toward a warm/white tint
    for y in range(max(0, sy - glow), min(H, sy + glow)):
        for x in range(sx - glow, sx + glow):
            d = math.hypot(x - sx, y - sy)
            if d < glow:
                k = (1 - d / glow) ** 2
                cv.px[x % W, y] = mix(cv.px[x % W, y], edge, dith(k * (0.75 if theme == "sunset" else 0.55), x, y, 8))
    r_sun = 22 if theme == "sunset" else 8
    for y in range(sy - r_sun - 1, sy + r_sun + 2):
        for x in range(sx - r_sun - 1, sx + r_sun + 2):
            d = math.hypot(x - sx, y - sy)
            if d <= r_sun:
                if theme == "sunset":
                    # retro banded sun: horizontal gaps that widen toward the bottom
                    band = y - (sy - 4)
                    if band > 0 and band % 6 >= 6 - min(4, 1 + band // 6):
                        continue
                    cv.set(x, y, mix(core, edge, clamp01((y - (sy - r_sun)) / (2 * r_sun)) * 0.9))
                else:
                    cv.set(x, y, core if d < r_sun - 2 else edge)
    r = rng({"day": 11, "rooftop": 12, "river": 13, "sunset": 14}[theme])
    tones = th["cloud"]
    if theme == "sunset":
        # long lit stratus streaks near the sun + dark high streaks
        for (cx, cy, w, col) in ((300, 150, 140, tones[0]), (420, 168, 90, tones[0]), (90, 128, 120, tones[1]),
                                 (200, 104, 110, tones[2]), (40, 84, 90, tones[3]), (360, 70, 120, tones[3]),
                                 (180, 182, 70, tones[0])):
            streak(cv, cx, cy, w, col, mix(col, "ffffff", 0.35), r)
    elif theme == "rooftop":
        # high cirrus mares' tails + a low distant cloud bank
        for (cx, cy, w) in ((80, 70, 120), (260, 54, 160), (420, 88, 110), (180, 112, 90), (360, 130, 80)):
            cirrus(cv, cx, cy, w, mix(tones[1], th["sky"][2][1], 0.35), mix(tones[0], th["sky"][2][1], 0.15), r)
        for cx in range(0, W, 46):
            cumulus(cv, cx + r.randint(-6, 6), 214, r.randint(26, 40), r.randint(7, 11), [mix(t, th["haze"], 0.55) for t in tones], r)
    else:
        # small, far cumulus sitting low over the horizon (they don't drift: far away)
        for cx in range(10, W, 60):
            cumulus(cv, cx + r.randint(-10, 10), 206 + r.randint(-14, 4), r.randint(22, 40), r.randint(7, 12),
                    [mix(t, th["haze"], 0.45) for t in tones], r)
        for (cx, cy, w) in ((300, 112, 80),):
            cirrus(cv, cx, cy, w, mix(tones[1], th["sky"][2][1], 0.55), mix(tones[0], th["sky"][2][1], 0.4), r)
    return cv


def streak(cv, cx, cy, w, col, hi, r):
    """Sunset stratus: thin lens-shaped streak, brighter on its lower edge."""
    for i in range(-w // 2, w // 2):
        u = i / (w / 2)
        th = 1 + int(3 * (1 - u * u))
        off = int(2 * math.sin(i * 0.05 + cx))
        for k in range(th):
            if abs(u) > 0.8 and BAYER[(cy + k) % 4][(cx + i) % 4] < (abs(u) - 0.8) * 70:
                continue
            cv.set(cx + i, cy + off + k, hi if k == th - 1 else col)


def cirrus(cv, cx, cy, w, col, hi, r):
    """Soft high-altitude haze streak: a long, thin, feathered lens with a brighter core."""
    ry = 3.2
    for y in range(int(cy - ry * 2), int(cy + ry * 2) + 1):
        for x in range(int(cx - w / 2), int(cx + w / 2)):
            u = (x - cx) / (w / 2)
            yc = cy + u * u * 4 - u * 2  # gentle curve
            d = ((y - yc) / ry) ** 2 + u * u
            if d >= 1:
                continue
            dens = (1 - d) ** 1.4
            if BAYER[y % 4][x % 4] < dens * 15:
                cv.set(x, y, hi if dens > 0.55 else col)


def cumulus(cv, cx, base_y, width, height, tones, r, rim=None):
    """Pixel cumulus painted puff by puff (back/top puffs first, lower front puffs over them).
    Each puff gets a lit crescent on its upper-left and a shaded rim on its lower-right; the
    whole cloud gets a flat, shaded base. tones: 0 highlight .. 4 underside."""
    puffs = []
    n = max(3, width // 13)
    for i in range(n):
        u = (i + 0.5) / n
        dome = math.sin(u * math.pi)
        rad = height * (0.36 + 0.42 * dome) * r.uniform(0.85, 1.1)
        puffs.append((cx - width / 2 + u * width + r.uniform(-2, 2), base_y - rad * 0.5 - dome * height * 0.3, rad))
    for _ in range(max(1, n // 2)):
        u = r.uniform(0.25, 0.75)
        rad = height * r.uniform(0.38, 0.55)
        puffs.append((cx - width / 2 + u * width, base_y - height * 0.62 - rad * 0.35, rad))
    puffs.sort(key=lambda p: p[1])  # top first
    paint = {}
    for (px_, py_, rad) in puffs:
        sh = max(1.5, rad * 0.22)
        for y in range(int(py_ - rad) - 1, int(py_ + rad) + 2):
            if y > base_y:
                continue
            for x in range(int(px_ - rad) - 1, int(px_ + rad) + 2):
                d = math.hypot(x - px_, (y - py_) * 1.1)
                if d > rad:
                    continue
                d_hi = math.hypot(x - (px_ + sh), (y - (py_ + sh)) * 1.1)  # lit crescent
                d_lo = math.hypot(x - (px_ - sh * 0.8), (y - (py_ - sh * 0.8)) * 1.1)  # shaded rim
                if d_hi > rad:
                    t = 0
                elif d_lo > rad:
                    t = 2
                else:
                    t = 1
                paint[(x, y)] = t
    top = min(y for (_, y) in paint) if paint else base_y
    hgt = max(1, base_y - top)
    for (x, y), t in paint.items():
        k = (y - top) / hgt
        if k > 0.78:
            t = max(t, 3 if k > 0.9 or (k > 0.84 and (x + y) % 2) else 2)
        elif k > 0.62 and t < 2 and (x + y) % 2 == 0:
            t = 2
        if y >= base_y or (x, y + 1) not in paint:
            t = 4 if rim is None else -1
        cv.set(x, y, rim if t == -1 else tones[t])


def lit_band(cv, cx, base_y, w, hgt, tones, rim, r):
    """Sunset altostratus: lens-shaped band with a lumpy top, dark violet top shading to a
    hot orange underside and a bright rim on the bottom edge."""
    bumps = [(r.uniform(-0.5, 0.5) * w, r.uniform(0.25, 0.6) * hgt, r.uniform(0.08, 0.16) * w) for _ in range(max(3, w // 22))]
    for i in range(-w // 2, w // 2 + 1):
        u = i / (w / 2)
        th = hgt * (1 - u * u) ** 0.7
        for (bx, bh, bw) in bumps:
            d = (i - bx) / bw
            if abs(d) < 1:
                th += bh * (1 - d * d)
        top = int(round(base_y - th))
        bot = base_y - int(abs(u) ** 3 * 3)
        for y in range(top, bot + 1):
            v = (y - top) / max(1, bot - top)  # 0 top -> 1 bottom
            if y >= bot:
                col = rim
            else:
                q = (1 - v) * 3.0
                idx = int(q)
                if 0.4 < q - idx < 0.6 and (i + y) % 2 == 0:
                    idx += 1
                elif q - idx >= 0.6:
                    idx += 1
                col = tones[min(4, idx + 1)] if idx >= 1 else tones[0]
                if v > 0.82:
                    col = tones[0]
            if abs(u) > 0.85 and BAYER[y % 4][(cx + i) % 4] < (abs(u) - 0.85) * 100:
                continue
            cv.set(cx + i, y, col)


def draw_clouds(theme):
    th = THEMES[theme]
    cv = Wrap(CLOUD_W, CLOUD_H)
    r = rng({"day": 21, "rooftop": 22, "river": 23, "sunset": 24}[theme])
    tones = th["cloud"]
    if theme == "sunset":
        # long flat cloud bands; undersides catch the low sun
        for (cx, by, w, hgt) in ((80, 70, 150, 12), (330, 98, 190, 15), (560, 58, 120, 9), (450, 140, 110, 8), (180, 150, 90, 7)):
            lit_band(cv, cx, by, w, hgt, tones, th["cloud_rim"], r)
    elif theme == "rooftop":
        for (cx, by, w, hgt) in ((70, 92, 80, 22), (330, 70, 110, 28), (540, 118, 70, 18)):
            cumulus(cv, cx, by, w, hgt, tones, r)
    else:
        for (cx, by, w, hgt) in ((60, 86, 96, 30), (250, 62, 72, 22), (420, 104, 120, 34), (590, 74, 64, 20), (330, 140, 54, 14)):
            cumulus(cv, cx, by, w, hgt, tones, r)
    return cv


# ---------------------------------------------------------------------------
# Building primitives (material colours; graded afterwards)
# ---------------------------------------------------------------------------
def win_grid(cv, x, y, w, h, col, dx=2, dy=3, ww=1, wh=1, r=None, density=1.0, alt=None, coll=None):
    for yy in range(y, y + h - wh + 1, dy):
        for xx in range(x, x + w - ww + 1, dx):
            if r and r.random() > density:
                continue
            cv.rect(xx, yy, ww, wh, alt if (alt and r and r.random() < 0.15) else col)
            if coll is not None:
                coll.append((xx, yy, ww, wh))


def tower(cv, x, base, w, h, mat, top="flat", r=None, wpat=(2, 3, 1, 1), win=True, coll=None):
    body, shade, light, wcol = MAT[mat]
    y = base - h
    cv.rect(x, y, w, h, body)
    sw = max(2, w // 3)
    cv.rect(x + w - sw, y, sw, h, shade)
    cv.rect(x, y, 1, h, light)
    if win:
        win_grid(cv, x + 2, y + 3, w - sw - 2, h - 4, wcol, *wpat, coll=coll)
        win_grid(cv, x + w - sw + 1, y + 3, sw - 2, h - 4, mix(wcol, shade, 0.5), *wpat)
    if top == "spire":
        cv.rect(x + w // 2 - 2, y - 5, 4, 5, body)
        cv.rect(x + w // 2 - 1, y - 9, 2, 4, shade)
        cv.rect(x + w // 2, y - 22, 1, 13, body)
    elif top == "antenna":
        cv.rect(x + w // 3, y - 14, 1, 14, shade)
        cv.rect(x + w // 3 + 4, y - 7, 1, 7, shade)
    elif top == "pyramid":
        half = w // 2
        for i in range(half + 1):
            cv.rect(x + i, y - 1 - (i * 4) // 3, w - 2 * i, 1, body if i < half * 0.6 else shade)
        cv.rect(x + half, y - (half * 4) // 3 - 10, 1, 10, body)
    elif top == "chevron":  # Two Prudential: gable + spire
        half = w // 2
        for i in range(half):
            cv.rect(x + i, y - 1 - i, 1, i + 1, light if i < 2 else body)
            cv.rect(x + w - 1 - i, y - 1 - i, 1, i + 1, shade)
        cv.rect(x + half - 1, y - half - 18, 2, 18, shade)
        cv.rect(x + half, y - half - 26, 1, 8, body)
    elif top == "crown":  # 311 S Wacker style lit cylinder crown
        cv.rect(x + 3, y - 4, w - 6, 4, body)
        cv.rect(x + 5, y - 12, w - 10, 8, light)
        cv.rect(x + w - 8, y - 12, 3, 8, shade)
        for xx in range(x + 6, x + w - 6, 2):
            cv.rect(xx, y - 11, 1, 6, body)
        cv.rect(x + 5, y - 14, w - 10, 2, body)
    elif top == "diamond":  # Crain Communications slanted diamond top
        for i in range(w):
            hh = int(abs(i - w * 0.35) * 0.9)
            cv.rect(x + i, y - (int(w * 0.6) - hh) if int(w * 0.6) - hh > 0 else y, 1, max(0, int(w * 0.6) - hh), light if i < w * 0.35 else body)
    elif top == "step":
        cv.rect(x + 3, y - 6, w - 6, 6, body)
        cv.rect(x + w - 3 - (w - 6) // 3, y - 6, (w - 6) // 3, 6, shade)
        cv.rect(x + 6, y - 11, max(2, w - 12), 5, body)
    elif top == "gothic":
        cv.rect(x + 2, y - 8, w - 4, 8, body)
        cv.rect(x + w - 6, y - 8, 4, 8, shade)
        for i in range(0, w - 4, 3):
            cv.rect(x + 2 + i, y - 12, 1, 4, body)
        cv.rect(x + w // 2 - 1, y - 16, 2, 8, body)
    elif top == "deco":  # Board of Trade: stepped + pyramid roof + statue
        cv.rect(x + 2, y - 5, w - 4, 5, body)
        cv.rect(x + 5, y - 9, w - 10, 4, body)
        half = (w - 10) // 2
        for i in range(half + 1):
            cv.rect(x + 5 + i, y - 10 - i, w - 10 - 2 * i, 1, shade)
        cv.rect(x + w // 2, y - 13 - half, 1, 4, light)
    return y


def willis(cv, x, base, coll=None):
    body, shade, light, wcol = MAT["black"]
    cols = [(0, 12, 124), (12, 12, 186), (24, 7, 154), (31, 7, 98)]
    for (ox, w, h) in cols:
        cv.rect(x + ox, base - h, w, h, body)
        cv.rect(x + ox + w - 3, base - h, 3, h, shade)
        cv.rect(x + ox, base - h, 1, h, light)
        for xx in range(x + ox + 2, x + ox + w - 3, 2):
            for yy in range(base - h + 3, base - 2, 2):
                if (yy // 2) % 9:
                    cv.set(xx, yy, wcol)
                    if coll is not None:
                        coll.append((xx, yy, 1, 1))
        cv.rect(x + ox, base - h, w, 1, light)
    for yy in (base - 34, base - 68, base - 102, base - 140, base - 172):
        for (ox, w, h) in cols:
            if base - yy < h - 2:
                cv.rect(x + ox, yy, w, 2, shade)
    # twin antennas with white tips
    for ax, ah in ((x + 15, 30), (x + 21, 25)):
        cv.rect(ax, base - 186 - ah, 1, ah, light)
        cv.rect(ax - 1, base - 186 - ah + 8, 3, 2, body)
        cv.set(ax, base - 187 - ah, "ffffff")


def hancock(cv, x, base, h=168):
    body, shade, light, wcol = MAT["black"]
    bw, tw = 30, 18
    for i in range(h):
        y = base - i
        w = bw - (bw - tw) * i / h
        x0 = x + (bw - w) / 2
        cv.rect(int(round(x0)), y, int(round(w)), 1, body)
        cv.rect(int(round(x0 + w * 0.68)), y, int(round(w * 0.32)) + 1, 1, shade)
        if i % 2 == 0:
            for xx in range(int(round(x0)) + 2, int(round(x0 + w * 0.68)), 2):
                cv.set(xx, y, wcol)
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
    cv.rect(tx + 1, base - h - 3, tw - 2, 3, shade)
    for ax in (tx + 4, tx + 13):
        cv.rect(ax, base - h - 30, 1, 27, light)
        cv.rect(ax - 1, base - h - 14, 3, 2, shade)
        cv.set(ax, base - h - 31, "ffffff")


def trump(cv, x, base):
    body, shade, light, wcol = MAT["glass"]
    tiers = [(0, 28, 104), (3, 22, 136), (6, 16, 160), (9, 10, 172)]
    for (ox, w, h) in tiers:
        cv.rect(x + ox, base - h, w, h, body)
        cv.rect(x + ox + w - max(3, w // 3), base - h, max(3, w // 3), h, shade)
        cv.rect(x + ox, base - h, 1, h, light)
        cv.rect(x + ox, base - h, w, 1, light)
    for yy in range(base - 168, base - 2, 2):
        cv.rect(x + 2, yy, 15, 1, mix(body, wcol, 0.5)) if yy > base - 104 else cv.rect(x + 8, yy, 6, 1, mix(body, wcol, 0.5))
    cv.rect(x + 5, base - 160, 2, 158, light)  # glass sky reflection streak
    cv.rect(x + 13, base - 200, 2, 28, shade)
    cv.rect(x + 14, base - 214, 1, 14, light)


def aon(cv, x, base):
    body, shade, light, wcol = MAT["white"]
    cv.rect(x, base - 182, 24, 182, body)
    cv.rect(x + 17, base - 182, 7, 182, shade)
    for xx in range(x + 2, x + 17, 2):
        cv.rect(xx, base - 178, 1, 176, mix(body, shade, 0.6))
    cv.rect(x, base - 182, 24, 2, light)
    cv.rect(x, base - 182, 1, 182, light)


def marina_city(cv, x, base, h=112, theme="day"):
    """Corncob tower: scalloped balcony bands, cylinder shading, parking spiral base."""
    w = 22
    body, shade, light, wcol = MAT["white"]
    dark = "4a4e58"
    park = 38
    for yy in range(base - h, base):
        rel = base - yy
        if rel > park:
            band = (yy - (base - h)) % 3
            inset = 0 if band == 0 else 1
        else:
            band = -1
            inset = 1
        for i in range(inset, w - inset):
            u = (i + 0.5) / w
            light_k = 0.5 - math.cos(u * math.pi) * 0.5  # 0 left -> 1 right
            if band == 0:
                col = mix(light, shade, light_k * 0.8)  # balcony lip
            elif band > 0:
                col = mix(mix(body, dark, 0.65), dark, light_k * 0.6)  # recessed glass
            else:
                col = mix(body, shade, light_k)
                if (yy % 4) in (1, 2) and 2 < i < w - 3:
                    col = mix(dark, shade, 0.3)  # open parking decks
            cv.set(x + i, yy, col)
    for i in range(2, w - 2):  # rounded crown
        cv.set(x + i, base - h - 1, light if i < w * 0.6 else shade)
    for i in range(5, w - 5):
        cv.set(x + i, base - h - 2, light if i < w * 0.6 else shade)


def wrigley(cv, x, base, main=82):
    """Wrigley Building: white terracotta block + tiered clock tower (`main` = block height)."""
    tb = base + (82 - main)  # tower parts are offset with the block height
    body, shade, light, _ = MAT["white"]
    win = "8aa0b8"
    cv.rect(x, base - main, 62, main, body)
    cv.rect(x + 50, base - main, 12, main, shade)
    cv.rect(x - 1, base - main - 2, 64, 2, light)
    for yy in range(base - main + 4, base - 4, 5):
        for xx in range(x + 3, x + 48, 4):
            cv.rect(xx, yy, 2, 3, win)
    # clock tower: tiers + cupola (compact proportions for the mid layer)
    cx = x + 20
    yt = base - main
    cv.rect(cx, yt - 26, 22, 26, body)
    cv.rect(cx + 16, yt - 26, 6, 26, shade)
    cv.rect(cx - 1, yt - 28, 24, 2, light)
    cv.rect(cx + 2, yt - 38, 18, 10, body)
    cv.rect(cx + 15, yt - 38, 5, 10, shade)
    for xx in range(cx + 4, cx + 15, 3):
        cv.rect(xx, yt - 36, 1, 7, mix(body, shade, 0.7))
    cv.rect(cx + 4, yt - 46, 14, 8, light)
    cv.rect(cx + 13, yt - 46, 5, 8, body)
    cv.rect(cx + 7, yt - 54, 8, 8, body)
    cv.rect(cx + 12, yt - 54, 3, 8, shade)
    cv.rect(cx + 10, yt - 60, 2, 6, shade)
    cv.set(cx + 10, yt - 61, "ffd27a")
    cv.disc(cx + 10, yt - 15, 6, "c8a24a")
    cv.disc(cx + 10, yt - 15, 5, "fbf6e4")
    cv.rect(cx + 10, yt - 19, 1, 4, "2b2d42")
    cv.rect(cx + 10, yt - 15, 3, 1, "2b2d42")


def tribune(cv, x, base, body_h=110):
    """Tribune Tower: limestone shaft + gothic lantern crown with flying buttresses."""
    tb = base + (110 - body_h)
    body, shade, light, wcol = MAT["lime"]
    cv.rect(x, base - body_h, 28, body_h, body)
    cv.rect(x + 20, base - body_h, 8, body_h, shade)
    cv.rect(x, base - body_h, 1, body_h, light)
    for xx in range(x + 3, x + 20, 3):
        cv.rect(xx, base - body_h + 4, 1, body_h - 6, mix(body, shade, 0.7))
    # gothic crown: octagonal lantern with flying buttresses
    cv.rect(x + 4, tb - 132, 20, 22, body)
    cv.rect(x + 18, tb - 132, 6, 22, shade)
    for xx in range(x + 6, x + 18, 3):
        cv.rect(xx, tb - 128, 1, 14, mix(body, "40404a", 0.6))
    for i in range(6):
        cv.set(x + 1 + i // 2, tb - 112 - i * 3, body)
        cv.set(x + 26 - i // 2, tb - 112 - i * 3, shade)
        cv.line(x + 1, tb - 110, x + 5, tb - 126, body)
        cv.line(x + 26, tb - 110, x + 22, tb - 126, shade)
    for xx in range(x + 4, x + 25, 3):
        cv.rect(xx, tb - 138, 1, 6, body if xx < x + 18 else shade)
        cv.set(xx, tb - 139, light)
    cv.rect(x + 12, tb - 142, 4, 4, body)


def mies_black(cv, x, base, w=34, h=98):
    """330 N Wabash / IBM: dark steel grid."""
    body, shade, light, wcol = MAT["black"]
    cv.rect(x, base - h, w, h, body)
    cv.rect(x + w - 8, base - h, 8, h, shade)
    for xx in range(x + 2, x + w - 1, 3):
        cv.rect(xx, base - h + 2, 1, h - 2, mix(body, light, 0.35))
    for yy in range(base - h + 2, base, 3):
        cv.rect(x, yy, w, 1, mix(body, wcol, 0.25))


# ---------------------------------------------------------------------------
# FAR
# ---------------------------------------------------------------------------
def draw_far(theme):
    th = THEMES[theme]
    r = rng(100 + THEME_NAMES.index(theme))
    base = 270 if theme == "rooftop" else 262
    # --- back row: dense, plain, very hazy
    back = Wrap(WIDE, H)
    x = 0
    while x < WIDE:
        w = r.randint(14, 30)
        hgt = r.randint(46, 112)
        tower(back, x, base, w, hgt, r.choice(["conc", "glass", "tan", "glassd"]),
              top=r.choice(["flat", "flat", "antenna", "step", "spire"]), win=False)
        x += w + r.randint(-5, 2)
    back.rect(0, base, WIDE, H - base, MAT["conc"][1])
    grade(back, theme, th["back_fog"], th["far_y"][0], th["far_y"][1], th["haze"],
          sil=(th["sil"][0], th["sil"][1] * 0.9) if th["sil"] else None)
    # --- front row: landmarks + filler
    front = Wrap(WIDE, H)
    LM = {"willis": (110, 40), "aon": (262, 26), "pru": (304, 22), "trump": (378, 30), "crain": (456, 24),
          "hancock": (590, 32), "wacker": (700, 24), "cbot": (790, 22), "legacy": (850, 18)}
    occupied = [(lx - 3, lx + lw + 3) for lx, lw in LM.values()]
    groups = []
    x = 4
    while x < WIDE - 6:
        w = r.randint(16, 28)
        if not any(a < x + w and x < b for a, b in occupied):
            wl = []
            tower(front, x, base, w, r.randint(42, 112), r.choice(["conc", "glass", "tan", "glassd", "lime", "green"]),
                  top=r.choice(["flat", "flat", "antenna", "step", "gothic", "spire"]), r=r, coll=wl)
            groups.append(wl)
        x += w + r.randint(1, 7)
    wl = []
    willis(front, 110, base, coll=wl)
    groups.append(wl)
    for (tx, tw, th_, mat, top) in ((304, 22, 150, "glassd", "chevron"), (456, 24, 136, "glass", "diamond"),
                                    (700, 24, 130, "lime", "crown"), (790, 22, 98, "lime", "deco"), (850, 18, 140, "glassd", "step")):
        wl = []
        tower(front, tx, base, tw, th_, mat, top=top, coll=wl)
        groups.append(wl)
    aon(front, 262, base)
    trump(front, 378, base)
    hancock(front, 590, base)
    front.rect(0, base, WIDE, H - base, MAT["conc"][1])
    sil = (th["sil"][0], th["sil"][1]) if th["sil"] else None
    grade(front, theme, th["far_fog"], th["far_y"][0], th["far_y"][1], th["haze"], sil=sil)
    rim_light(front, th["rim_side"], th["rim"], th["rim_t"], ymax=base - 2)
    windows = []
    if theme == "sunset":
        windows = light_groups(front, groups, r, th, p_row=0.26, run=(2, 7))
    back.blit(front, 0, 0)
    return back, windows


def light_groups(cv, groups, r, th, p_row, run):
    """Light whole runs of windows along random floors (offices still working at dusk).
    Returns a sample of the windows left dark: the runtime switches those on and off."""
    dark = []
    for wl in groups:
        rows = {}
        for rc in wl:
            rows.setdefault(rc[1], []).append(rc)
        for y, lst in rows.items():
            lst.sort()
            if r.random() < p_row:
                n = r.randint(*run)
                s0 = r.randint(0, max(0, len(lst) - n))
                col = r.choice(th["lit"])
                for i, rc in enumerate(lst):
                    if s0 <= i < s0 + n:
                        cv.rect(rc[0], rc[1], rc[2], rc[3], col)
                    else:
                        dark.append(rc)
            else:
                dark.extend(lst)
    r.shuffle(dark)
    return dark


# ---------------------------------------------------------------------------
# MID
# ---------------------------------------------------------------------------
def mid_building(cv, x, base, w, h, mat, r, roof=True, coll=None):
    body, shade, light, wcol = MAT[mat]
    y = base - h
    cv.rect(x, y, w, h, body)
    cv.rect(x + w - 4, y, 4, h, shade)
    # cornice
    cv.rect(x - 1, y, w + 2, 2, light)
    cv.rect(x - 1, y + 2, w + 2, 1, shade)
    if mat in ("glass", "glassd", "teal"):
        for xx in range(x + 3, x + w - 4, 4):
            cv.rect(xx, y + 4, 1, h - 4, mix(body, shade, 0.7))
        for yy in range(y + 5, base, 4):
            cv.rect(x, yy, w - 4, 1, mix(body, light, 0.35))
        cv.rect(x + 2, y + 4, 1, h - 4, light)
    else:
        for yy in range(y + 6, base - 6, 7):
            for xx in range(x + 3, x + w - 7, 5):
                cv.rect(xx, yy, 3, 4, wcol)
                if coll is not None:
                    coll.append((xx, yy + 1, 3, 3))
                cv.rect(xx, yy, 3, 1, mix(wcol, "1a1c2c", 0.4))
                cv.rect(xx, yy + 4, 3, 1, light)
        # storefront band
        cv.rect(x, base - 6, w - 4, 6, mix(body, "1a1c2c", 0.45))
    if roof and r.random() < 0.55 and w > 26:
        water_tower(cv, x + r.randint(3, w - 18), y, "9c6237", "6e4227", "3a2c26")
    elif roof and r.random() < 0.4:
        cv.rect(x + 4, y - 5, 8, 5, shade)
        cv.rect(x + 4, y - 5, 8, 1, light)
    return y


def water_tower(cv, x, base, body, shade, dark):
    """Classic Chicago wooden rooftop water tank on a steel stand (16 px wide)."""
    for lx in (x + 2, x + 7, x + 12):
        cv.rect(lx, base - 9, 1, 9, dark)
    cv.line(x + 2, base - 1, x + 12, base - 8, dark)
    cv.line(x + 12, base - 1, x + 2, base - 8, dark)
    cv.rect(x + 1, base - 10, 13, 1, dark)
    cv.rect(x + 1, base - 24, 13, 14, body)
    cv.rect(x + 10, base - 24, 4, 14, shade)
    cv.rect(x + 2, base - 24, 1, 14, mix(body, "ffffff", 0.25))
    for yy in (base - 21, base - 16, base - 12):
        cv.rect(x + 1, yy, 13, 1, dark)
    for i in range(6):
        cv.rect(x + i, base - 25 - i, 15 - 2 * i, 1, shade if i == 0 else mix(dark, body, 0.4))
    cv.set(x + 7, base - 31, dark)


def chicago_theatre_sign(cv, x, base, h=58):
    """The vertical 'CHICAGO' marquee sign: red blade with white letters + marquee below."""
    cv.rect(x, base - h, 9, h - 12, "c4262e")
    cv.rect(x + 7, base - h, 2, h - 12, "8c1820")
    cv.rect(x, base - h - 2, 9, 2, "f4e4b0")
    for i, ch in enumerate("CHICAGO"):
        g = FONT3[ch]
        for gy, row in enumerate(g):
            for gx, v in enumerate(row):
                if v == "#":
                    cv.set(x + 3 + gx, base - h + 2 + i * 6 + gy, "fff6d8")
    cv.rect(x - 10, base - 12, 30, 8, "f4e4b0")
    cv.rect(x - 9, base - 11, 28, 6, "c4262e")
    for xx in range(x - 8, x + 18, 2):
        cv.set(xx, base - 9, "ffe08a")


def l_structure(cv, y_deck, steel, span=64, x_off=0, bottom=H):
    """Elevated L: riveted deck girder + rails + bents (paired posts with X bracing)."""
    body, shade, dark, light = steel
    cv.rect(0, y_deck - 4, WIDE, 1, shade)  # running rail
    for x in range(0, WIDE, 3):
        cv.rect(x, y_deck - 3, 2, 3, dark)  # ties
    cv.rect(0, y_deck, WIDE, 2, light)
    cv.rect(0, y_deck + 2, WIDE, 7, body)
    cv.rect(0, y_deck + 9, WIDE, 2, dark)
    for x in range(0, WIDE, 6):
        cv.set(x, y_deck + 4, light)
        cv.set(x + 3, y_deck + 7, shade)
    for x in range(0, WIDE, 24):
        cv.rect(x, y_deck + 2, 1, 7, shade)
    for x in range(x_off, WIDE + x_off, span):
        for px in (x, x + 20):
            cv.rect(px, y_deck + 11, 4, bottom - y_deck - 11, body)
            cv.rect(px + 3, y_deck + 11, 1, bottom - y_deck - 11, dark)
            cv.rect(px, y_deck + 11, 1, bottom - y_deck - 11, light)
        cv.rect(x - 1, y_deck + 11, 26, 2, shade)
        for yy in range(y_deck + 13, bottom - 8, 20):
            cv.line(x + 4, yy, x + 19, yy + 18, shade)
            cv.line(x + 19, yy, x + 4, yy + 18, shade)


def draw_mid(theme):
    th = THEMES[theme]
    r = rng(200 + THEME_NAMES.index(theme))
    cv = Wrap(WIDE, H)
    anchors = {}
    sil = (th["sil"][2], th["sil"][3]) if th["sil"] else None
    if theme in ("day", "sunset"):
        x = 0
        kinds = ["brick", "lime", "glass", "brick", "conc", "tan", "teal"]
        groups = []
        while x < WIDE:
            w = r.randint(36, 66)
            wl = []
            mid_building(cv, x, 262, w, r.randint(56, 120), r.choice(kinds), r, coll=wl)
            groups.append(wl)
            x += w + r.randint(3, 12)
        chicago_theatre_sign(cv, 412, 197)
        cv.rect(0, 262, WIDE, 8, MAT["conc"][1])
        grade(cv, theme, th["mid_fog"], 120, 262, th["mid_haze"], sil=sil)
        steel = [mix(s, th["mid_haze"], th["mid_fog"][0] + 0.12) for s in ("b8603c", "8e4428", "5e2c1e", "d88a5c")]
        if sil:
            steel = [mix(s, th["sil"][2], 0.6) for s in steel]
        if sil:
            anchors["win_mid"] = light_groups(cv, groups, r, th, p_row=0.45, run=(1, 6))
        l_structure(cv, 196, steel, span=96)
        anchors["train"] = {"layer": "mid", "y": 193}
    elif theme == "rooftop":
        # high vantage: roofs of the neighbours (water towers, setbacks), the L below
        x = 0
        while x < WIDE:
            w = r.randint(44, 84)
            hgt = r.randint(30, 96)
            mat = r.choice(["brick", "lime", "glass", "conc", "tan", "brick"])
            y = mid_building(cv, x, 270, w, hgt, mat, r, roof=False)
            # roof furniture seen from slightly above: tar roof plane + tanks + vents
            cv.rect(x, y - 3, w, 3, "6a6670")
            cv.rect(x, y - 3, w, 1, "8a8690")
            for _ in range(r.randint(1, 2)):
                tx = x + r.randint(2, max(3, w - 18))
                if r.random() < 0.65:
                    water_tower(cv, tx, y - 2, "9c6237", "6e4227", "3a2c26")
                else:
                    cv.rect(tx, y - 9, 12, 7, "a8a4ac")
                    cv.rect(tx, y - 9, 12, 1, "c8c4cc")
                    cv.rect(tx + 9, y - 9, 3, 7, "7e7a84")
            x += w + r.randint(8, 22)
        grade(cv, theme, th["mid_fog"], 150, 270, th["mid_haze"])
        steel = [mix(s, th["mid_haze"], 0.25) for s in ("b8603c", "8e4428", "5e2c1e", "d88a5c")]
        l_structure(cv, 214, steel, span=80)
        anchors["train"] = {"layer": "mid", "y": 211}
    elif theme == "river":
        BANK = 160
        x = 0
        while x < WIDE:
            w = r.randint(32, 62)
            hgt = r.randint(36, 92)
            if 116 < x + w and x < 196 or 548 < x + w and x < 700:
                x += 12
                continue
            mid_building(cv, x, BANK, w, hgt, r.choice(["brick", "lime", "glass", "conc", "tan", "teal"]), r)
            x += w + r.randint(4, 12)
        marina_city(cv, 132, BANK, 104, theme)
        marina_city(cv, 162, BANK, 104, theme)
        cv.rect(126, BANK - 12, 64, 12, MAT["conc"][1])
        wrigley(cv, 556, BANK, main=50)
        tribune(cv, 640, BANK, body_h=78)
        mies_black(cv, 230, BANK, 34, 96)
        grade(cv, theme, th["mid_fog"], 90, BANK, th["mid_haze"])
        top_light(cv, "ffffff", 0.25, ymax=BANK)
        rim_light(cv, th["rim_side"], th["rim"], th["rim_t"] * 0.7, ymax=BANK)
        # river wall
        cv.rect(0, BANK - 2, WIDE, 6, "9aa4a8")
        cv.rect(0, BANK - 2, WIDE, 1, "c4ccd0")
        cv.rect(0, BANK + 3, WIDE, 1, "6c767c")
        for bx in (20, 470):
            bridge(cv, bx, BANK - 22, th)
        WY = BANK + 4
        river_water(cv, WY, BANK, th)
        anchors["river"] = {"layer": "mid", "top": WY, "boatY": [WY + 10, WY + 15]}
    return cv, anchors


def bridge(cv, x, deck_y, th):
    """Chicago bascule bridge: green-grey truss span between limestone bridge houses."""
    steel = mix("5e7068", th["mid_haze"], 0.25)
    steel_d = mix("3e4c48", th["mid_haze"], 0.25)
    steel_l = mix("8a9c94", th["mid_haze"], 0.25)
    lime, lime_s, lime_l = (mix(m, th["mid_haze"], 0.2) for m in MAT["lime"][:3])
    span = 220
    cv.rect(x, deck_y, span, 2, steel_l)
    cv.rect(x, deck_y + 2, span, 9, steel)
    cv.rect(x, deck_y + 11, span, 1, steel_d)
    for xx in range(x, x + span, 10):
        cv.line(xx, deck_y + 2, xx + 5, deck_y + 10, steel_d)
        cv.line(xx + 5, deck_y + 10, xx + 10, deck_y + 2, steel_d)
    # railing + lamp posts on the deck
    cv.rect(x, deck_y - 6, span, 1, steel_d)
    for xx in range(x, x + span, 3):
        cv.rect(xx, deck_y - 5, 1, 5, steel_d)
    for xx in range(x + 30, x + span - 20, 40):
        cv.rect(xx, deck_y - 16, 1, 10, steel_d)
        cv.rect(xx - 1, deck_y - 18, 3, 2, "ffe9a0" if th["sil"] else steel_l)
    # arched underside
    for i in range(span):
        u = i / span
        drop = int(10 * math.sin(u * math.pi))
        cv.rect(x + i, deck_y + 12, 1, max(0, 6 - drop // 2), steel_d)
    for hx in (x - 8, x + span - 14):
        cv.rect(hx, deck_y - 34, 22, 56, lime)
        cv.rect(hx + 16, deck_y - 34, 6, 56, lime_s)
        cv.rect(hx - 1, deck_y - 36, 24, 3, lime_l)
        cv.rect(hx + 2, deck_y - 42, 18, 6, lime)
        cv.rect(hx + 14, deck_y - 42, 6, 6, lime_s)
        cv.rect(hx + 4, deck_y - 46, 14, 4, lime_l)
        cv.rect(hx + 5, deck_y - 28, 4, 8, "4e6a88")
        cv.rect(hx + 12, deck_y - 28, 3, 8, "4e6a88")
        cv.rect(hx + 5, deck_y - 30, 4, 2, lime_l)
        cv.rect(hx + 12, deck_y - 30, 3, 2, lime_l)


def river_water(cv, WY, BANK, th):
    """Chicago-river green water with mirrored, rippled reflections of everything above."""
    water = [mix(w, th["mid_haze"], 0.15) for w in ("2e8a84", "237270", "1b5c5e", "4fa8a0", "8ad0c4")]
    if th["sil"]:
        water = [mix(w, "4a2a5a", 0.55) for w in water]
    src = [[cv.px[x, y] for x in range(WIDE)] for y in range(H)]
    for y in range(WY, H):
        k = (y - WY) / (H - WY)
        base = water[0] if k < 0.35 else water[1] if k < 0.7 else water[2]
        for x in range(WIDE):
            col = base
            sy = BANK - 3 - int((y - WY) * 1.25)
            wob = int(round(1.6 * math.sin(y * 1.3 + x * 0.02)))
            if 0 <= sy and (y % 3 != 2 or k < 0.15):
                p = src[sy][(x + wob) % WIDE]
                if p[3]:
                    col = mix(p, base, 0.5 + 0.4 * k)
            if (x * 7 + y * 13) % 53 == 0 or ((x + y * 5) % 37 == 0 and y % 3 == 0):
                col = water[3]
            cv.px[x, y] = c(col)
    for y in range(WY + 2, H, 4):
        for x in range(WIDE):
            if (x + y * 11) % 64 < 5:
                cv.set(x, y, water[3])
            if (x + y * 11) % 64 == 2:
                cv.set(x, y, water[4])
    cv.rect(0, WY, WIDE, 1, mix(water[2], "000000", 0.2))


# ---------------------------------------------------------------------------
# NEAR
# ---------------------------------------------------------------------------
def lamp_post(cv, x, base, col, glow=None, h=62):
    """Chicago twin-globe park lamp."""
    cv.rect(x, base - h, 2, h, col)
    cv.rect(x - 1, base - 4, 4, 4, col)
    cv.rect(x - 1, base - h + 10, 4, 2, col)
    cv.rect(x - 5, base - h + 2, 12, 1, col)
    for gx in (x - 6, x + 5):
        cv.rect(gx, base - h - 3, 3, 5, glow or mix(col, "ffffff", 0.18))
        cv.rect(gx + 1, base - h - 4, 1, 1, col)
        if glow:
            cv.set(gx + 1, base - h - 2, "fffbe0")
    cv.rect(x, base - h - 5, 2, 5, col)


def glow_halo(cv, cx, cy, rad, col, strength=0.55):
    for y in range(cy - rad, cy + rad + 1):
        for x in range(cx - rad, cx + rad + 1):
            d = math.hypot(x - cx, y - cy)
            if d >= rad:
                continue
            p = cv.get(x, y)
            k = (1 - d / rad) ** 1.6 * strength
            if not p[3]:
                if BAYER[y % 4][x % 4] < k * 22 - 4:
                    cv.set(x, y, col)
            else:
                cv.set(x, y, mix(p, col, dith(k, x, y, 4)))


def tree(cv, cx, base, rad, cols, trunk):
    """cols = (mid, dark, light, deep). Overlapping canopy blobs lit from upper-left."""
    top_c = base - rad - 20
    cv.rect(cx - 1, top_c, 3, base - top_c, trunk)
    cv.line(cx, top_c + 12, cx - 7, top_c + 3, trunk)
    cv.line(cx + 1, top_c + 13, cx + 8, top_c + 5, trunk)
    blobs = [(cx, top_c - rad * 0.35, rad * 0.85), (cx - rad * 0.65, top_c + rad * 0.15, rad * 0.7),
             (cx + rad * 0.7, top_c + rad * 0.1, rad * 0.72), (cx - rad * 0.1, top_c + rad * 0.4, rad * 0.72),
             (cx + rad * 0.3, top_c - rad * 0.65, rad * 0.5)]
    for bx, by, br in blobs:
        for y in range(int(by - br) - 1, int(by + br) + 2):
            for x in range(int(bx - br) - 1, int(bx + br) + 2):
                d = math.hypot(x - bx, (y - by) * 1.15)
                if d <= br:
                    k = ((x - bx) * 0.6 + (y - by)) / max(br, 1) + (BAYER[y % 4][x % 4] - 7.5) / 36
                    col = cols[2] if k < -0.5 else cols[0] if k < 0.2 else cols[1] if k < 0.75 else cols[3]
                    cv.set(x, y, col)
    # leaf clumps texture
    for y in range(int(top_c - rad * 1.3), int(top_c + rad * 1.2)):
        for x in range(cx - int(rad * 1.5), cx + int(rad * 1.5)):
            p = cv.get(x, y)
            if p[3] and (x * 3 + y * 5) % 11 == 0 and c(p) == c(cols[0]):
                cv.set(x, y, cols[2])


def near_cols(theme, names):
    th = THEMES[theme]
    if th["sil"]:
        return [mix(n, th["sil"][4], th["sil"][5]) for n in names]
    return [saturate(c(n), th["near_sat"], th["near_dark"]) for n in names]


def draw_near(theme):
    th = THEMES[theme]
    cv = Wrap(WIDE, H)
    r = rng(300 + THEME_NAMES.index(theme))
    anchors = {}
    base = 266
    greens = near_cols(theme, ["3f8a4c", "2c6a3e", "6cae5a", "1f4c30"])
    metal = near_cols(theme, ["2c3a44"])[0]
    glow = "ffd77a" if theme == "sunset" else None
    lamps = []
    if theme in ("day", "sunset", "river"):
        x = 20
        i = 0
        while x < WIDE - 40:
            if i % 3 == 1:
                lamp_post(cv, x, base, metal, glow, h=64)
                lamps.append((x, base - 64))
            else:
                tree(cv, x, base, r.randint(18, 25), greens, near_cols(theme, ["4a3426"])[0])
            x += r.randint(70, 100)
            i += 1
        if theme == "river":
            rail = near_cols(theme, ["24343c"])[0]
            cv.rect(0, 226, WIDE, 3, rail)
            cv.rect(0, 226, WIDE, 1, mix(rail, "ffffff", 0.2))
            for x in range(0, WIDE, 6):
                cv.rect(x, 229, 1, 22, rail)
            for x in range(0, WIDE, 48):
                cv.rect(x, 222, 4, 30, rail)
                cv.rect(x - 1, 220, 6, 2, rail)
            cv.rect(0, 250, WIDE, H - 250, near_cols(theme, ["5a5c58"])[0])
            cv.rect(0, 250, WIDE, 2, near_cols(theme, ["8a8a80"])[0])
            for x in range(0, WIDE, 32):
                cv.rect(x, 252, 1, H - 252, near_cols(theme, ["44463f"])[0])
        else:
            for x in range(WIDE):
                top = 240 - int(3 * math.sin(x * 0.13) + 2 * math.sin(x * 0.051 + 1))
                for y in range(top, H):
                    k = (BAYER[y % 4][x % 4] - 7.5) / 30
                    cv.set(x, y, greens[2] if y - top < 2 + k * 4 else greens[0] if y - top < 7 else greens[1])
            for x in range(0, WIDE, 5):
                cv.rect(x, 234, 1, 8, metal)
                cv.set(x, 233, metal)
            cv.rect(0, 235, WIDE, 1, metal)
            cv.rect(0, 239, WIDE, 1, metal)
        if glow:
            for (lx, ly) in lamps:
                for gx in (lx - 5, lx + 6):
                    glow_halo(cv, gx, ly - 1, 13, "ffc870", 0.5)
    elif theme == "rooftop":
        PY = 228
        g = near_cols(theme, ["5a5e72", "44485a", "7a7e94", "34374a"])
        dark = near_cols(theme, ["2a2c38"])[0]
        cv.rect(0, PY, WIDE, H - PY, g[1])
        cv.rect(0, PY, WIDE, 2, g[2])
        cv.rect(0, PY + 2, WIDE, 1, g[3])
        for x in range(0, WIDE, 16):
            cv.rect(x, PY + 3, 1, H - PY - 3, g[3])
        vents = []
        signs = 0
        x = 8
        while x < WIDE - 60:
            k = r.choice(["hvac", "tank", "chimney", "antenna", "sign", "vent", "hvac", "tank", "vent"])
            if k == "sign":
                signs += 1
                if signs > 1:
                    k = "chimney"
            if k == "hvac":
                cv.rect(x, PY - 22, 40, 22, g[0])
                cv.rect(x, PY - 22, 40, 2, g[2])
                cv.rect(x + 34, PY - 22, 6, 22, g[1])
                for yy in range(PY - 18, PY - 3, 3):
                    cv.rect(x + 3, yy, 22, 1, g[1])
                cv.disc(x + 30, PY - 11, 6, g[1])
                cv.disc(x + 30, PY - 11, 5, g[3])
                cv.rect(x + 25, PY - 11, 11, 1, g[2])
                cv.rect(x + 30, PY - 16, 1, 11, g[2])
                vents.append([x + 30, PY - 18])
                x += 46
            elif k == "tank":
                water_tower(cv, x, PY, *near_cols(theme, ["8a5a36", "623e26"]), dark)
                x += 22
            elif k == "chimney":
                cv.rect(x, PY - 36, 12, 36, near_cols(theme, ["8e4a36"])[0])
                cv.rect(x + 8, PY - 36, 4, 36, near_cols(theme, ["6e3628"])[0])
                cv.rect(x - 1, PY - 39, 14, 3, g[2])
                for yy in range(PY - 32, PY, 4):
                    cv.rect(x, yy, 12, 1, near_cols(theme, ["6e3628"])[0])
                vents.append([x + 6, PY - 40])
                x += 20
            elif k == "vent":
                cv.rect(x + 2, PY - 18, 6, 18, g[0])
                cv.rect(x + 6, PY - 18, 2, 18, g[1])
                cv.rect(x, PY - 22, 10, 4, g[2])
                cv.rect(x + 1, PY - 23, 8, 1, g[0])
                vents.append([x + 5, PY - 24])
                x += 16
            elif k == "antenna":
                cv.rect(x + 5, PY - 64, 1, 64, dark)
                for yy, ww in ((PY - 56, 13), (PY - 48, 11), (PY - 40, 9)):
                    cv.rect(x + 5 - ww // 2, yy, ww, 1, dark)
                cv.set(x + 5, PY - 65, "ff4a4a")
                x += 18
            else:
                cv.rect(x + 6, PY - 30, 2, 30, dark)
                cv.rect(x + 48, PY - 30, 2, 30, dark)
                cv.line(x + 7, PY - 2, x + 49, PY - 28, dark)
                cv.rect(x, PY - 64, 56, 34, dark)
                cv.rect(x + 2, PY - 62, 52, 30, near_cols(theme, ["c8423a"])[0])
                cv.rect(x + 2, PY - 62, 52, 2, near_cols(theme, ["e86a5a"])[0])
                for i, ch in enumerate("HOT DOGS"):
                    gch = FONT3.get(ch)
                    for gy, row in enumerate(gch):
                        for gx, v in enumerate(row):
                            if v == "#":
                                cv.set(x + 6 + i * 6 + gx, PY - 56 + gy, near_cols(theme, ["fff2c8"])[0])
                cv.rect(x + 6, PY - 46, 44, 8, near_cols(theme, ["f2c84a"])[0])
                cv.rect(x + 8, PY - 44, 18, 4, near_cols(theme, ["c8423a"])[0])
                x += 62
            x += r.randint(12, 34)
        anchors["vents"] = vents
        cv.harden()
    return cv, anchors


# ---------------------------------------------------------------------------
# AMBIENT ATLAS
# ---------------------------------------------------------------------------
def spr(w, h):
    return Cv(w, h)


def draw_ambient():
    frames = {}
    # birds: white silhouettes (tinted per theme at runtime), 4-frame flap
    shapes = [
        ["#.......#", ".#.....#.", "..##.##..", "....#...."],
        [".........", "##.....##", "..##.##..", "....#...."],
        [".........", ".........", "#########", "....#...."],
        ["....#....", "..##.##..", ".#.....#.", "........."],
    ]
    for i, rows in enumerate(shapes):
        cv = spr(9, 5)
        for y, row in enumerate(rows):
            for x, v in enumerate(row):
                if v == "#":
                    cv.set(x, y + 1, "ffffff")
        frames[f"bird_{i}"] = cv.im
    # L trains for the mid layer (pre-hazed per theme, 4 cars)
    for theme in ("day", "rooftop", "sunset"):
        frames[f"train_{theme}"] = l_train_sprite(theme).im
    # river boats (pre-hazed for the mid layer)
    frames["boat_tour"] = tour_boat().im
    frames["boat_taxi"] = water_taxi().im
    frames["boat_tour_sunset"] = tour_boat(sunset=True).im
    frames["boat_taxi_sunset"] = water_taxi(sunset=True).im
    # steam puffs: 4 sizes, dithered discs (white; tinted/alpha at runtime)
    for i, rad in enumerate((2, 3, 4, 5)):
        cv = spr(12, 12)
        for y in range(12):
            for x in range(12):
                d = math.hypot(x - 5.5, y - 5.5)
                if d <= rad and (d < rad - 1 or BAYER[y % 4][x % 4] < 9):
                    cv.set(x, y, "ffffff" if d < rad * 0.5 or y < 5 else "dde4ec")
        frames[f"steam_{i}"] = cv.im
    # glint: 4-frame sparkle
    for i, n in enumerate((1, 2, 3, 2)):
        cv = spr(9, 9)
        for k in range(-n, n + 1):
            cv.set(4 + k, 4, "ffffff")
            cv.set(4, 4 + k, "ffffff")
        if n >= 2:
            for d in (-1, 1):
                cv.set(4 + d, 4 + d, "fff6c8")
                cv.set(4 + d, 4 - d, "fff6c8")
        frames[f"glint_{i}"] = cv.im
    # 1px white for lit windows / misc (scaled + tinted)
    cv = spr(2, 2)
    cv.rect(0, 0, 2, 2, "ffffff")
    frames["px"] = cv.im
    # boat wake (white dashes)
    for i in range(2):
        cv = spr(16, 3)
        for x in range(16):
            if (x + i * 3) % 6 < 3:
                cv.set(x, 1 + (x // 6 + i) % 2, "ffffff")
        frames[f"wake_{i}"] = cv.im
    return frames


def l_train_sprite(theme):
    th = THEMES[theme]
    cars, cw = 4, 46
    cv = spr(cars * (cw + 2), 18)
    body, shade, dark = "c8ccd4", "9aa0aa", "3a3e4a"
    win = "4a6a90"
    stripe = "c8282e"
    roof = "b0b4bc"
    for k in range(cars):
        x = k * (cw + 2)
        cv.rect(x, 2, cw, 13, body)
        cv.rect(x + 1, 1, cw - 2, 1, roof)
        cv.rect(x, 12, cw, 2, shade)
        cv.rect(x, 10, cw, 1, stripe)
        for wx in range(x + 4, x + cw - 5, 6):
            cv.rect(wx, 4, 4, 4, win)
            cv.set(wx, 4, mix(win, "ffffff", 0.4))
        cv.rect(x + cw // 2 - 2, 3, 4, 9, shade)
        for wx in (x + 5, x + cw - 11):
            cv.rect(wx, 15, 6, 2, dark)
            cv.set(wx + 1, 17, dark)
            cv.set(wx + 4, 17, dark)
        if k < cars - 1:
            cv.rect(x + cw, 6, 2, 6, dark)
    # cab windows at both ends
    cv.rect(0, 4, 2, 5, win)
    cv.rect(cv.w - 2, 4, 2, 5, win)
    if theme == "rooftop":
        # seen from above: roof plane with vents
        cv.rect(0, 0, cv.w, 2, "d8dce2")
        for k in range(cars):
            cv.rect(k * (cw + 2) + 10, 0, 6, 1, "8a8e96")
            cv.rect(k * (cw + 2) + 28, 0, 6, 1, "8a8e96")
    im = cv
    # grade to the mid layer of the theme
    for y in range(im.h):
        for x in range(im.w):
            p = im.px[x, y]
            if not p[3]:
                continue
            if th["sil"]:
                if p[:3] == c(win)[:3]:
                    im.px[x, y] = c(th["lit"][(x // 6) % 2])
                    continue
                p = mix(p, th["sil"][2], th["sil"][3] * 0.85)
            im.px[x, y] = mix(p, th["mid_haze"], th["mid_fog"][0] + 0.15)
    return im


def tour_boat(sunset=False):
    cv = spr(64, 16)
    hull, hull_d, deck, cabin, win, trim = "f2f4f6", "9aa4ae", "c8ccd2", "e8eaee", "3e5c82", "2e4a7a"
    cv.rect(2, 9, 60, 4, hull)
    cv.rect(4, 13, 56, 2, hull_d)
    cv.rect(0, 9, 3, 2, hull)
    cv.rect(61, 9, 3, 3, hull)
    cv.rect(2, 11, 60, 1, trim)
    cv.rect(10, 4, 44, 5, cabin)
    cv.rect(9, 3, 46, 1, trim)
    for wx in range(12, 52, 5):
        cv.rect(wx, 5, 3, 2, win)
    cv.rect(6, 8, 52, 1, deck)
    # passengers on the open top deck
    for px_, col in ((14, "e34a3a"), (20, "3a7ae3"), (27, "f2c84a"), (34, "3ab25a"), (41, "e37ab0"), (47, "f2f2f2")):
        cv.set(px_, 1, "f0b080")
        cv.set(px_, 2, col)
    for xx in range(9, 56, 3):
        cv.set(xx, 2, "8a98a8")
    return grade_sprite(cv, sunset, "river")


def water_taxi(sunset=False):
    cv = spr(34, 12)
    cv.rect(2, 6, 30, 3, "f2c84a")
    cv.rect(4, 9, 26, 2, "c8962a")
    cv.rect(0, 6, 3, 2, "f2c84a")
    cv.rect(8, 2, 16, 4, "f6f2e8")
    cv.rect(8, 1, 16, 1, "2b2d42")
    for wx in range(10, 23, 4):
        cv.rect(wx, 3, 2, 2, "3e5c82")
    cv.rect(2, 7, 30, 1, "2b2d42")
    return grade_sprite(cv, sunset, "river")


def grade_sprite(cv, sunset, theme):
    th = THEMES["sunset" if sunset else theme]
    for y in range(cv.h):
        for x in range(cv.w):
            p = cv.px[x, y]
            if not p[3]:
                continue
            if sunset:
                if p[:3] == c("3e5c82")[:3]:
                    cv.px[x, y] = c("ffd27a")
                    continue
                p = mix(p, th["sil"][2], 0.55)
            cv.px[x, y] = mix(p, th["mid_haze"], 0.18)
    return cv


def draw_water_strip():
    """32x8 tileable highlight strip scrolled along water surfaces at runtime."""
    cv = Cv(32, 8)
    for x in range(32):
        if x % 16 in (2, 3, 4, 5):
            cv.set(x, 1 if x % 16 in (3, 4) else 2, "ffffff")
        if (x + 9) % 32 in (0, 1, 2):
            cv.set(x, 5, "e8fbff")
        if (x + 22) % 32 in (0, 1):
            cv.set(x, 6, "e8fbff")
    return cv


# ---------------------------------------------------------------------------
def write_anchors(anchors):
    lines = [
        "// GENERATED by tools/art/draw_backgrounds.py -- do not edit by hand.",
        "// Positions are in parallax-layer pixels (layer x wraps at the layer width).",
        "import type { LevelTheme } from '../types';",
        "",
        "export interface ThemeAnchors {",
        "  /** Dark windows (x, y, w, h flattened) per layer that the sunset twinkle switches on and off. */",
        "  windows: { far: number[]; mid: number[] };",
        "  /** Glass-tower glint spots on the far layer (x, y flattened). */",
        "  glints: number[];",
        "  /** Steam vent mouths on the near layer (x, y flattened). */",
        "  vents: number[];",
        "  /** L train: y of the train's bottom edge on the given layer. */",
        "  train: { layer: 'far' | 'mid'; y: number } | null;",
        "  /** River surface on the mid layer: water top y and boat baselines. */",
        "  river: { layer: 'mid'; top: number; boatY: number[] } | null;",
        "  /** Lake horizon (World 2 lakefront): sailboat baseline y on the far layer. */",
        "  lake?: { layer: 'far'; y: number };",
        "  /** Stadium light banks (x, y flattened) on a layer: pulsing flares. */",
        "  flares?: { layer: 'far' | 'mid'; pts: number[] };",
        "  /** Neon signs (x, y, w, h flattened) on the mid layer: occasional flicker. */",
        "  neon?: number[];",
        "  /** Searchlight / alien beam origins: screen x at the bottom of the sky. */",
        "  beams?: number[];",
        "  /** Alien scout ships drifting across the sky. */",
        "  ships?: boolean;",
        "  /** Small flyers near the camera: park butterflies or night fireflies. */",
        "  flutter?: 'butterflies' | 'fireflies';",
        "}",
        "",
        f"export const LAYER_WIDTH = {WIDE};",
        f"export const CLOUD_LAYER = {{ width: {CLOUD_W}, height: {CLOUD_H} }};",
        "",
        "export const AMBIENT_ANCHORS: Record<LevelTheme, ThemeAnchors> = {",
    ]
    for theme in THEME_NAMES:
        a = anchors[theme]
        flat = lambda rects: ", ".join(str(v) for rc in rects for v in rc)  # noqa: E731
        lines.append(f"  {theme}: {{")
        lines.append(f"    windows: {{ far: [{flat(a.get('win_far', []))}], mid: [{flat(a.get('win_mid', []))}] }},")
        lines.append(f"    glints: [{flat(a.get('glints', []))}],")
        lines.append(f"    vents: [{flat(a.get('vents', []))}],")
        tr = a.get("train")
        lines.append(f"    train: {('{ layer: ' + repr(tr['layer']) + ', y: ' + str(tr['y']) + ' }') if tr else 'null'},")
        rv = a.get("river")
        lines.append(f"    river: {('{ layer: ' + repr(rv['layer']) + ', top: ' + str(rv['top']) + ', boatY: [' + ', '.join(map(str, rv['boatY'])) + '] }') if rv else 'null'},")
        if a.get("lake"):
            lines.append(f"    lake: {{ layer: '{a['lake']['layer']}', y: {a['lake']['y']} }},")
        if a.get("flares"):
            fl = a["flares"]
            lines.append(f"    flares: {{ layer: '{fl['layer']}', pts: [{', '.join(str(v) for pt in fl['pts'] for v in pt)}] }},")
        if a.get("neon"):
            lines.append(f"    neon: [{flat(a['neon'])}],")
        if a.get("beams"):
            lines.append(f"    beams: [{', '.join(map(str, a['beams']))}],")
        if a.get("ships"):
            lines.append("    ships: true,")
        if a.get("flutter"):
            lines.append(f"    flutter: '{a['flutter']}',")
        lines.append("  },")
    lines.append("};")
    with open(ANCHORS_TS, "w") as f:
        f.write("\n".join(lines).replace("'", "'") + "\n")


def glint_spots(far_cv, r, n=10):
    """Bright pixels high on glass towers -> sun glint spots."""
    out = []
    tries = 0
    while len(out) < n and tries < 5000:
        tries += 1
        x, y = r.randint(0, WIDE - 1), r.randint(80, 200)
        p = far_cv.get(x, y)
        if p[3] and far_cv.get(x - 3, y)[3] and far_cv.get(x + 3, y)[3] and sum(p[:3]) > 520:
            if all(abs(x - ox) > 40 for ox, _ in out):
                out.append((x, y))
    return out


def composite(layers):
    comp = Image.new("RGBA", (WIDE, H))
    for x in range(0, WIDE, W):
        comp.alpha_composite(layers["sky"].im, (x, 0))
    for x in range(0, WIDE, CLOUD_W):
        comp.alpha_composite(layers["clouds"].im, (x, 0))
    for name in ("far", "mid", "near"):
        comp.alpha_composite(layers[name].im, (0, 0))
    return comp


def main():
    os.makedirs(OUT, exist_ok=True)
    previews = []
    anchors = {}
    total = {}
    import draw_backgrounds_w2 as w2  # noqa: E402 (imports this module's helpers)
    for theme in THEME_NAMES:
        if theme in w2.W2_THEMES:
            layers, a = w2.draw_theme(theme)
            anchors[theme] = a
            tot = 0
            for name, cv in layers.items():
                cv.harden()
                cv.save(os.path.join(OUT, f"bg-{theme}-{name}.png"))
                tot += cv.w * cv.h * 4
            total[theme] = tot
            previews.append(composite(layers))
            continue
        far, win_far = draw_far(theme)
        mid, mid_anchors = draw_mid(theme)
        near, near_anchors = draw_near(theme)
        win_mid = [w for w in mid_anchors.pop("win_mid", []) if w[1] < 192]
        layers = {"sky": draw_sky(theme), "clouds": draw_clouds(theme), "far": far, "mid": mid, "near": near}
        a = {"win_far": [w for w in win_far if 40 < w[1] < 250][:64], "win_mid": win_mid[:40]}
        a.update(mid_anchors)
        a.update(near_anchors)
        if theme in ("day", "river", "rooftop"):
            a["glints"] = glint_spots(far, rng(500 + THEME_NAMES.index(theme)))
        anchors[theme] = a
        tot = 0
        for name, cv in layers.items():
            cv.harden()
            cv.save(os.path.join(OUT, f"bg-{theme}-{name}.png"))
            tot += cv.w * cv.h * 4
        total[theme] = tot
        previews.append(composite(layers))
    write_anchors(anchors)
    frames = draw_ambient()
    frames.update(w2.ambient_frames())
    pack_atlas(frames, os.path.join(ASSETS, "ambient"), max_w=256)
    draw_water_strip().save(os.path.join(ASSETS, "ambient-water.png"))
    os.makedirs(PREVIEWS, exist_ok=True)
    for name, group in (("backgrounds.png", previews[:4]), ("backgrounds-w2.png", previews[4:])):
        sheet = Image.new("RGBA", (WIDE, H * len(group)))
        for i, p in enumerate(group):
            sheet.alpha_composite(p, (0, i * H))
        sheet.save(os.path.join(PREVIEWS, name))
    print("backgrounds ok; uncompressed bytes per theme:", {k: f"{v / 1e6:.2f} MB" for k, v in total.items()})


if __name__ == "__main__":
    main()
