#!/usr/bin/env python3
"""
effects atlas: particles, projectiles, explosions. Every frame of an animation has
the same size and the effect is centred in it. Fades are done with ordered dithering
(hard alpha only). Writes public/assets/effects.{png,json} + art/previews/effects.png
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from pxl import ASSETS, PREVIEWS, Cv, T, c, contact_sheet, lerp, pack_atlas, rng  # noqa: E402

BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def keep(x, y, alpha):
    """Ordered-dither alpha test (alpha 0..1)."""
    return alpha * 16 > BAYER[y % 4][x % 4]


def blob(cv, cx, cy, r, col, alpha=1.0, sy=1.0):
    for y in range(int(cy - r * sy) - 1, int(cy + r * sy) + 2):
        for x in range(int(cx - r) - 1, int(cx + r) + 2):
            if math.hypot(x - cx, (y - cy) / sy) <= r and keep(x, y, alpha):
                cv.set(x, y, col)


def ring(cv, cx, cy, r, thick, col, alpha=1.0, sy=1.0):
    for y in range(int(cy - r * sy) - 2, int(cy + r * sy) + 3):
        for x in range(int(cx - r) - 2, int(cx + r) + 3):
            d = math.hypot(x - cx, (y - cy) / sy)
            if r - thick < d <= r and keep(x, y, alpha):
                cv.set(x, y, col)


def sparkle(cv, x, y, size, col, core="w"):
    for i in range(-size, size + 1):
        cv.set(x + i, y, col)
        cv.set(x, y + i, col)
    cv.set(x, y, core)


# ---------------------------------------------------------------------------
def dust(i, n=5):
    cv = Cv(16, 16)
    t = i / (n - 1)
    for side in (-1, 1):
        cx = 8 + side * (2 + t * 5)
        cy = 12 - t * 3
        r = 2.2 + t * 1.8
        a = 1.0 - t * 0.85
        blob(cv, cx, cy, r, "l1", a)
        blob(cv, cx - side * 0.6, cy - 0.6, r - 1, "l0", a)
    blob(cv, 8, 13 - t, 1.5 + t, "l2", 1 - t)
    return cv


def spark(i, n=4):
    cv = Cv(16, 16)
    size = [6, 5, 3, 2][i]
    diag = [3, 4, 2, 1][i]
    col = "y1" if i < 2 else "y2"
    for k in range(-size, size + 1):
        cv.set(7 + k, 7, col)
        cv.set(7, 7 + k, col)
    for k in range(-diag, diag + 1):
        cv.set(7 + k, 7 + k, "w" if abs(k) < 2 else "y0")
        cv.set(7 + k, 7 - k, "w" if abs(k) < 2 else "y0")
    cv.set(7, 7, "w")
    if i < 2:
        for k in (-1, 0, 1):
            cv.set(7 + k, 7, "w")
            cv.set(7, 7 + k, "w")
    return cv


def explosion(i, n, S):
    cv = Cv(S, S)
    t = i / (n - 1)
    cx = cy = S / 2 - 0.5
    R = S / 2 - 1.5
    r = rng(S * 10 + i)
    if i == 0:
        blob(cv, cx, cy, R * 0.35, "y0")
        blob(cv, cx, cy, R * 0.22, "w")
        sparkle(cv, int(cx), int(cy), int(R * 0.6), "y0")
        return cv
    core = R * (0.45 + 0.5 * min(1, t * 2.2))
    fade = 1.0 if t < 0.55 else max(0.0, 1 - (t - 0.55) / 0.45)
    # lumpy fire ball from several sub-blobs
    lumps = [(cx, cy, core)]
    for k in range(6):
        a = k * math.pi / 3 + i * 0.4
        lumps.append((cx + math.cos(a) * core * 0.5, cy + math.sin(a) * core * 0.5, core * 0.55))
    smoke_t = max(0.0, (t - 0.35) / 0.65)
    for lx, ly, lr in lumps:
        blob(cv, lx, ly - smoke_t * 2, lr, "g3" if smoke_t > 0.3 else "o2", fade)
    for lx, ly, lr in lumps:
        blob(cv, lx - 0.5, ly - 0.5 - smoke_t * 2, lr * 0.78, "g2" if smoke_t > 0.55 else "o1", fade)
    if t < 0.75:
        for lx, ly, lr in lumps[:4]:
            blob(cv, lx - 1, ly - 1, lr * (0.55 - t * 0.4), "y1")
        blob(cv, cx - 1, cy - 1, core * (0.45 - t * 0.45), "y0")
        if t < 0.3:
            blob(cv, cx - 1, cy - 1, core * 0.2, "w")
    # flying embers
    for k in range(8 if S > 30 else 5):
        a = r.random() * math.tau
        d = R * (0.6 + t * 0.5)
        x, y = int(cx + math.cos(a) * d), int(cy + math.sin(a) * d)
        if keep(x, y, 1 - t * 0.8):
            cv.set(x, y, "y1" if t < 0.5 else "o1")
    return cv


def smoke(i, n=6):
    cv = Cv(24, 24)
    t = i / (n - 1)
    a = 1.0 - t * 0.9
    for k, (dx, dy, rr) in enumerate(((0, 0, 5), (-4, 2, 4), (4, 1, 4), (1, -4, 4))):
        cx = 11.5 + dx * (1 + t * 0.6)
        cy = 13 + dy * (1 + t * 0.6) - t * 5
        r = rr * (0.6 + t * 0.6)
        blob(cv, cx, cy, r, "g3", a)
        blob(cv, cx - 0.8, cy - 0.8, r * 0.7, "g2", a)
        blob(cv, cx - 1.4, cy - 1.4, r * 0.35, "g1", a)
    return cv


def coin_burst(i, n=5):
    cv = Cv(24, 24)
    t = i / (n - 1)
    d = 2 + t * 9
    for k in range(8):
        a = k * math.pi / 4 + 0.3
        x, y = int(round(11.5 + math.cos(a) * d)), int(round(11.5 + math.sin(a) * d))
        sz = 2 if t < 0.5 else 1
        if t < 0.95:
            sparkle(cv, x, y, sz if k % 2 == 0 else 1, "y1" if k % 2 == 0 else "y0", "w")
        elif k % 2 == 0:
            cv.set(x, y, "y0")
    if i == 0:
        blob(cv, 11.5, 11.5, 3, "y0")
        blob(cv, 11.5, 11.5, 1.5, "w")
    return cv


def poof(i, n=5):
    cv = Cv(24, 24)
    t = i / (n - 1)
    a = 1.0 if t < 0.5 else 1 - (t - 0.5) * 1.8
    R = 4 + t * 6
    for k in range(6):
        ang = k * math.pi / 3 + 0.5
        cx, cy = 11.5 + math.cos(ang) * R * 0.7, 11.5 + math.sin(ang) * R * 0.7
        blob(cv, cx, cy, 3.4 - t * 1.2, "g1", a)
        blob(cv, cx - 0.7, cy - 0.7, 2.4 - t * 1.0, "w", a)
    if t < 0.4:
        blob(cv, 11.5, 11.5, 4 - t * 6, "w")
    return cv


def energy_shot(i):
    cv = Cv(16, 16)
    pulse = [0, 1, 0, -1][i]
    # trail
    for k in range(5):
        x = 3 + k
        if keep(x, 7 + (k % 2), 0.3 + k * 0.15):
            cv.set(x, 7, "lime"), cv.set(x, 8, "gr1")
    blob(cv, 10, 7.5, 4.2 + pulse * 0.4, "gr1")
    blob(cv, 10, 7.5, 3.0 + pulse * 0.4, "lime")
    blob(cv, 10.5, 7, 1.6, "w")
    for k, (dx, dy) in enumerate(((0, -6), (5, 0), (0, 6), (-4, -4))):
        if (k + i) % 2 == 0:
            cv.set(10 + dx, 7 + dy, "lime")
    return cv


def alien_laser(i):
    cv = Cv(24, 8)
    flick = i % 2
    cv.rect(2, 2 + flick * 0, 20, 4, "redd")
    cv.rect(3, 3, 19, 2, "red")
    cv.rect(8, 3, 14, 1, "pk")
    cv.rect(16, 3, 6, 2, "w")
    blob(cv, 20.5, 3.5, 3.4 - flick * 0.5, "red")
    blob(cv, 20.5, 3.5, 2.0, "w")
    for x in range(0, 6):
        if keep(x, 3 + (x + i) % 2, x / 6):
            cv.set(x, 3 + (x + i) % 2, "red")
    return cv


def plasma_shot(i):
    cv = Cv(16, 16)
    rr = [4.6, 5.0, 4.6, 4.2][i]
    blob(cv, 8, 7.5, rr + 1.2, "p3", 0.6)
    blob(cv, 8, 7.5, rr, "p2")
    blob(cv, 8, 7.5, rr - 1.5, "p1")
    blob(cv, 7.5, 7, rr - 3, "p0")
    cv.set(7, 6, "w")
    for k in range(4):
        a = k * math.pi / 2 + i * 0.6
        x, y = int(round(8 + math.cos(a) * (rr + 1.8))), int(round(7.5 + math.sin(a) * (rr + 1.8)))
        cv.set(x, y, "p1")
    return cv


def drone_shot(i):
    cv = Cv(12, 12)
    blob(cv, 5.5, 5.5, 3.6 + (i % 2) * 0.5, "o2")
    blob(cv, 5.5, 5.5, 2.6, "o1")
    blob(cv, 5.0, 5.0, 1.4, "y0")
    for k in range(4):
        a = k * math.pi / 2 + i * math.pi / 4
        cv.set(int(round(5.5 + math.cos(a) * 5)), int(round(5.5 + math.sin(a) * 5)), "y1")
    return cv


def shockwave(i, n=6):
    cv = Cv(64, 24)
    t = i / (n - 1)
    a = 1.0 if t < 0.5 else 1 - (t - 0.5) * 1.6
    R = 6 + t * 26
    ring(cv, 31.5, 18, R, 3.5, "l2", a, sy=0.35)
    ring(cv, 31.5, 18, R - 1.0, 2.0, "l0", a, sy=0.35)
    ring(cv, 31.5, 18, R - 2.0, 1.0, "w", a, sy=0.35)
    # upward dust columns at the front edges
    for side in (-1, 1):
        x = 31.5 + side * R
        h = int(10 * (1 - t) + 3)
        for y in range(18 - h, 19):
            for dx in (-1, 0, 1):
                if keep(int(x + dx), y, a * (1 - (18 - y) / (h + 2))):
                    cv.set(x + dx, y, "l2" if dx else "l0")
    # rocks
    for k in range(4):
        x = 31.5 + (k - 1.5) * (R * 0.5)
        y = 14 - math.sin(t * math.pi) * 8 + k % 2
        if t < 0.9:
            cv.rect(int(x), int(y), 2, 2, "g3")
            cv.set(int(x), int(y), "g1")
    return cv


def sniff(i, n=6):
    """Lupin's sniff: wavy scent lines + a little '!' sparkle drifting up."""
    cv = Cv(16, 16)
    t = i / (n - 1)
    a = 1 if t < 0.6 else 1 - (t - 0.6) * 2.4
    for k in range(3):
        y0 = 13 - k * 4 - t * 4
        for x in range(2, 14):
            y = y0 + math.sin(x * 0.9 + i * 0.9 + k) * 1.2
            if keep(x, int(y), a) and 0 <= y < 16:
                cv.set(x, int(round(y)), "lime" if k != 1 else "y1")
    if i in (2, 3, 4):
        sparkle(cv, 12, 3 - (i - 2), 1, "w", "y0")
    return cv


def air_puff(i, n=5):
    cv = Cv(24, 16)
    t = i / (n - 1)
    a = 1.0 if t < 0.4 else 1 - (t - 0.4) * 1.5
    R = 3 + t * 8
    ring(cv, 11.5, 6 + t * 4, R, 2.5, "w", a, sy=0.45)
    ring(cv, 11.5, 7 + t * 4, R - 2, 1, "cb", a, sy=0.45)
    for side in (-1, 1):
        cv_x = 11.5 + side * (R + 1)
        if keep(int(cv_x), 10, a):
            cv.set(cv_x, 7 + t * 4, "w")
    return cv


def dash_trail(i, n=4):
    cv = Cv(24, 16)
    t = i / (n - 1)
    a = 1 - t * 0.8
    for k, (y, ln) in enumerate(((3, 14), (7, 20), (11, 16), (13, 9))):
        x0 = int(2 + t * 6 + (k % 2) * 2)
        for x in range(x0, min(24, x0 + int(ln * (1 - t * 0.5)))):
            if keep(x, y, a * (x - x0) / ln + 0.2):
                cv.set(x, y, "cb" if k % 2 else "w")
    return cv


def spawn_ring(i, n=6):
    cv = Cv(32, 32)
    t = i / (n - 1)
    R = 3 + t * 12
    a = 1 if t < 0.7 else 1 - (t - 0.7) * 3
    ring(cv, 15.5, 15.5, R, 2, "redd", a)
    ring(cv, 15.5, 15.5, R - 1, 1, "red", a)
    ring(cv, 15.5, 15.5, R * 0.6, 1, "pk", a * 0.7)
    for k in range(6):
        ang = k * math.pi / 3 + t * 2
        x, y = int(round(15.5 + math.cos(ang) * (R + 2))), int(round(15.5 + math.sin(ang) * (R + 2)))
        if t < 0.9:
            sparkle(cv, x, y, 1, "red", "w")
    if i < 2:
        blob(cv, 15.5, 15.5, 3 - i, "w")
        blob(cv, 15.5, 15.5, 2 - i, "pk")
    return cv


def debris(k):
    cv = Cv(8, 8)
    if k == 0:
        cv.poly([(1, 2), (5, 1), (7, 4), (4, 7), (1, 6)], "g2")
        cv.line(2, 2, 5, 1, "g1")
        cv.set(4, 5, "g3"), cv.set(5, 4, "g3")
    else:
        cv.poly([(1, 3), (6, 1), (7, 6), (2, 7)], "b1")
        cv.line(1, 3, 6, 1, "b0")
        cv.line(2, 6, 6, 5, "b2")
    cv.outline("ink")
    return cv


def bolt():
    cv = Cv(12, 16)
    cv.poly([(6, 0), (10, 0), (7, 6), (10, 6), (3, 15.5), (5, 8), (2, 8)], "y1")
    cv.line(6, 1, 4, 7, "y0")
    cv.line(7, 7, 5, 11, "w")
    cv.outline("ink")
    return cv


def build():
    fr = {}

    def anim(name, fn, n):
        for i in range(n):
            fr[f"{name}_{i}"] = fn(i).im

    anim("dust", dust, 5)
    anim("spark", spark, 4)
    anim("explosion_small", lambda i: explosion(i, 6, 24), 6)
    anim("explosion_large", lambda i: explosion(i, 8, 48), 8)
    anim("smoke", smoke, 6)
    anim("coin_burst", coin_burst, 5)
    anim("poof", poof, 5)
    anim("energy_shot", energy_shot, 4)
    anim("alien_laser", alien_laser, 4)
    anim("plasma_shot", plasma_shot, 4)
    anim("drone_shot", drone_shot, 4)
    anim("shockwave", shockwave, 6)
    anim("sniff", sniff, 6)
    anim("air_puff", air_puff, 5)
    anim("dash_trail", dash_trail, 4)
    anim("spawn_ring", spawn_ring, 6)
    fr["debris_0"] = debris(0).im
    fr["debris_1"] = debris(1).im
    fr["bolt"] = bolt().im
    pack_atlas(fr, os.path.join(ASSETS, "effects"))
    contact_sheet(fr, os.path.join(PREVIEWS, "effects.png"), scale=4)
    return fr


if __name__ == "__main__":
    build()
    print("effects ok")
