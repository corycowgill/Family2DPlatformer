#!/usr/bin/env python3
"""
effects atlas: particles, projectiles, explosions. Every frame of an animation has
the same size and the effect is centred in it (dust: bottom-centred).

Style (v2): shaded volumes instead of dither fades. Puffs / fireballs are unions of
spheres lit from the upper left and quantised into 3-5 colour bands; things fade by
SHAPE (puffs shrink, split, get bitten away, streaks shorten), never by checkerboard
dither. Hard alpha only, named palette (+ a few effect-only tints defined below).

Writes public/assets/effects.{png,json} + art/previews/effects.png. Animated previews:
tools/art/preview_effects.py.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from pxl import ASSETS, PREVIEWS, Cv, c, contact_sheet, pack_atlas, rng  # noqa: E402

# Effect-only tints (cool whites for poofs/air, warm smoke).
X = {
    "pf0": "ffffff", "pf1": "e9e7f7", "pf2": "c3c0e0", "pf3": "8f8bb8", "pf4": "5f5a8a",
    "sm0": "d9d4cf", "sm1": "aaa39e", "sm2": "7e7774", "sm3": "57504f", "sm4": "3a3436",
    "xs0": "8a7f7c", "xs1": "625756", "xs2": "443a3d", "xs3": "2c2430",
    "fr0": "fffbe6", "fr5": "a8281c", "fr6": "6e1a1e",
    "gx0": "eaffc8", "gx4": "1d6b3a",
    "rx0": "ffd6d6",
    "px0": "ffe6ff",
}
for k, v in X.items():
    X[k] = c(v)


def col(name):
    return X[name] if name in X else c(name)


L = (-0.55, -0.72, 0.42)
_n = math.sqrt(sum(v * v for v in L))
L = tuple(v / _n for v in L)


# ---------------------------------------------------------------------------
# primitives
# ---------------------------------------------------------------------------
def spheres(cv, sph, colfn, holes=()):
    """Raster a union of spheres. sph: (cx, cy, r, data). colfn(x, y, I, zr, data) -> colour|None.
    I = Lambert term vs light L (-1..1), zr = depth/r at that pixel (0 edge .. 1 centre).
    holes: (cx, cy, r) discs carved out (shape-based dissolve)."""
    if not sph:
        return
    x0 = max(0, int(min(s[0] - s[2] for s in sph)) - 1)
    x1 = min(cv.w, int(max(s[0] + s[2] for s in sph)) + 2)
    y0 = max(0, int(min(s[1] - s[2] for s in sph)) - 1)
    y1 = min(cv.h, int(max(s[1] + s[2] for s in sph)) + 2)
    for y in range(y0, y1):
        for x in range(x0, x1):
            px, py = x + 0.5, y + 0.5
            if any((px - hx) ** 2 + (py - hy) ** 2 < hr * hr for hx, hy, hr in holes):
                continue
            best, bz = None, -1.0
            for s in sph:
                cx, cy, r = s[0], s[1], s[2]
                if r <= 0.3:
                    continue
                dx, dy = px - cx, py - cy
                d2 = dx * dx + dy * dy
                if d2 < r * r:
                    z = math.sqrt(r * r - d2)
                    if z > bz:
                        bz = z
                        best = (dx / r, dy / r, z / r, s[3] if len(s) > 3 else None)
            if best:
                nx, ny, nz, data = best
                I = nx * L[0] + ny * L[1] + nz * L[2]
                cc = colfn(x, y, I, nz, data)
                if cc is not None:
                    cv.set(x, y, col(cc) if isinstance(cc, str) else cc)


def band(v, ramp, cuts):
    """ramp dark->light, cuts ascending (len(ramp)-1)."""
    i = 0
    for cu in cuts:
        if v > cu:
            i += 1
    return ramp[i]


def shade(ramp, cuts):
    return lambda x, y, I, zr, d: band(I, ramp, cuts)


def streak(cv, x0, y0, x1, y1, cols, wide=0.0):
    """Line from tail (x0,y0) to head (x1,y1); colour by position (cols tail->head).
    `wide`: the head fraction drawn 2px thick."""
    ln = math.hypot(x1 - x0, y1 - y0)
    n = max(2, int(ln * 3))
    px_ = -(y1 - y0) / (ln or 1)
    py_ = (x1 - x0) / (ln or 1)
    for k in range(n + 1):
        f = k / n
        x, y = x0 + (x1 - x0) * f, y0 + (y1 - y0) * f
        cc = cols[min(len(cols) - 1, int(f * len(cols)))]
        cv.set(math.floor(x), math.floor(y), col(cc))
        if wide and f > 1 - wide:
            cv.set(math.floor(x + px_ * 0.7), math.floor(y + py_ * 0.7), col(cc))


def star4(cv, cx, cy, R, cc, core=None, e=0.55, sy=1.0):
    """4-point star (astroid-ish) centred on pixel (cx, cy)."""
    cx, cy = int(cx), int(cy)
    Ri = int(math.ceil(R))
    for y in range(-Ri, Ri + 1):
        for x in range(-Ri, Ri + 1):
            if R <= 0:
                continue
            v = (abs(x) / R) ** e + (abs(y) / (R * sy)) ** e
            if v <= 1.0001:
                cv.set(cx + x, cy + y, col(core) if core and v < 0.55 else col(cc))


def disc(cv, cx, cy, r, cc, sy=1.0):
    for y in range(int(cy - r * sy) - 1, int(cy + r * sy) + 2):
        for x in range(int(cx - r) - 1, int(cx + r) + 2):
            if r > 0 and ((x + 0.5 - cx) / r) ** 2 + ((y + 0.5 - cy) / (r * sy)) ** 2 <= 1:
                cv.set(x, y, col(cc))


def ering(cv, cx, cy, rx, ry, thick, colfn):
    """Elliptical ring. thick(a) = thickness in px at angle a (screen angle, y down).
    colfn(a, f) -> colour|None, f = 0 at outer edge .. 1 at inner edge."""
    for y in range(int(cy - ry) - 2, int(cy + ry) + 3):
        for x in range(int(cx - rx) - 2, int(cx + rx) + 3):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            a = math.atan2(dy, dx)
            d = math.hypot(dx, dy)
            ca, sa = math.cos(a), math.sin(a)
            re = rx * ry / math.sqrt((ry * ca) ** 2 + (rx * sa) ** 2 + 1e-9)
            t = thick(a)
            if t > 0 and re - t < d <= re:
                cc = colfn(a, (re - d) / t)
                if cc is not None:
                    cv.set(x, y, col(cc))


def outline_where(cv, cc, cond=lambda x, y: True):
    """1px outline outside opaque pixels, only where cond(x, y)."""
    src = cv.im.copy().load()
    for y in range(cv.h):
        for x in range(cv.w):
            if src[x, y][3] or not cond(x, y):
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                xx, yy = x + dx, y + dy
                if 0 <= xx < cv.w and 0 <= yy < cv.h and src[xx, yy][3]:
                    cv.set(x, y, col(cc))
                    break


def despeckle(cv):
    """Remove isolated single pixels with no 4-neighbour (keeps silhouettes clean)."""
    src = cv.im.copy().load()
    for y in range(cv.h):
        for x in range(cv.w):
            if not src[x, y][3]:
                continue
            if not any(
                0 <= x + dx < cv.w and 0 <= y + dy < cv.h and src[x + dx, y + dy][3]
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1))
            ):
                cv.px[x, y] = (0, 0, 0, 0)


def ease_out(t):
    return 1 - (1 - t) ** 2


def life(t, t_peak, t_end):
    """0 -> 1 (at t_peak) -> 0 (at t_end): size envelope that shrinks puffs away."""
    if t <= 0 or t >= t_end:
        return 0.0
    if t < t_peak:
        return ease_out(t / t_peak)
    return max(0.0, 1 - ((t - t_peak) / (t_end - t_peak)) ** 1.4)


# ---------------------------------------------------------------------------
# ramps
# ---------------------------------------------------------------------------
FIRE = ["fr6", "fr5", "o2", "o1", "y1", "y0", "fr0"]  # cold -> hot
XSMOKE = ["xs3", "xs2", "xs1", "xs0"]                 # explosion smoke, dark warm
SMOKE = ["sm3", "sm2", "sm1", "sm0"]                  # light smoke
POOF = ["pf3", "pf2", "pf1", "pf0"]
DUST = ["l3", "l2", "l1", "l0"]
GOLD = ["y3", "y2", "y1", "y0", "w"]


# ---------------------------------------------------------------------------
# explosions
# ---------------------------------------------------------------------------
def explosion(i, n, S, seed):
    """Flash -> fireball (banded heat, highlight) -> cooling into dark smoke puffs that
    rise and shrink apart. Debris chunks + embers fly out on ballistic arcs."""
    cv = Cv(S, S)
    cx = cy = S / 2
    R = S * (0.34 if S < 40 else 0.33)
    t = i / (n - 1)
    r = rng(seed)
    big = S >= 48
    # puff set (deterministic, same across frames)
    puffs = []
    k_n = 11 if big else 8
    for k in range(k_n):
        a = k / k_n * math.tau + r.uniform(-0.3, 0.3)
        puffs.append(dict(
            a=a, dist=r.uniform(0.35, 0.62), rad=r.uniform(0.42, 0.56),
            end=r.uniform(1.08, 1.3), cool=r.uniform(-0.12, 0.12), rise=r.uniform(0.6, 1.0),
        ))
    puffs.append(dict(a=0, dist=0.0, rad=0.7, end=0.85, cool=0.15, rise=0.7))  # centre
    debris = [(r.uniform(0, math.tau), r.uniform(0.75, 1.0)) for _ in range(7 if big else 4)]
    embers = [(r.uniform(0, math.tau), r.uniform(0.5, 1.0)) for _ in range(10 if big else 6)]

    if i == 0:
        # white-hot flash: core disc + 4-point burst
        star4(cv, cx, cy, R * 1.25, "y0", e=0.5)
        disc(cv, cx, cy, R * 0.55, "y0")
        disc(cv, cx, cy, R * 0.42, "fr0")
        star4(cv, cx, cy, R * 0.8, "fr0", e=0.5)
        return cv
    # fireball / smoke spheres
    sph = []
    tt = (i - 1) / (n - 2)  # 0..1 over the remaining frames
    grow = ease_out(min(1, tt / 0.35))
    for p in puffs:
        env = life(tt * 0.85 + 0.2, 0.3, p["end"])
        if env <= 0:
            continue
        d = R * p["dist"] * (0.55 + 0.75 * grow)
        rise = R * 1.1 * p["rise"] * max(0, tt - 0.2) ** 1.1
        rr = R * p["rad"] * (0.75 + 0.45 * grow) * (env ** 0.7)
        x = cx + math.cos(p["a"]) * d
        y = cy + math.sin(p["a"]) * d * 0.9 - rise
        heat = 0.72 - tt * 1.9 + p["cool"]
        sph.append((x, y, rr, heat))

    def fire_col(x, y, I, zr, heat):
        h = heat + 0.55 * zr + 0.2 * I
        for th, cc in ((1.05, "fr0"), (0.86, "y0"), (0.66, "y1"), (0.47, "o1"), (0.32, "o2"), (0.2, "fr5"), (0.1, "fr6")):
            if h > th:
                return cc
        return band(I, XSMOKE, (-0.25, 0.2, 0.62))

    # bite holes late in the anim so the smoke breaks up by shape
    holes = []
    if tt > 0.6:
        hr = rng(seed + i)
        for _ in range(3 if big else 2):
            a = hr.uniform(0, math.tau)
            holes.append((cx + math.cos(a) * R * 0.95, cy - R * 0.7 * tt + math.sin(a) * R * 0.85, R * 0.55 * (tt - 0.45) * 2))
    spheres(cv, sph, fire_col, holes)
    # ring of shock on frame 1
    if i == 1:
        ering(cv, cx, cy, R * 1.25, R * 1.25, lambda a: 1.6, lambda a, f: "y0")
    # debris chunks (dark with hot leading pixel + short trail)
    if tt < 0.85:
        for a, sp in debris:
            dist = R * (0.95 + 1.25 * sp * ease_out(tt))
            x = cx + math.cos(a) * dist
            y = cy + math.sin(a) * dist + R * 1.2 * tt * tt
            tx = x - math.cos(a) * R * 0.35 * (1 - tt)
            ty = y - math.sin(a) * R * 0.35 * (1 - tt) - R * 0.3 * tt
            if 0.05 < tt < 0.5:
                streak(cv, tx, ty, x, y, ["o2", "o1", "y1"])
            sz = 2 if big else 1
            for dy in range(sz):
                for dx in range(sz):
                    cv.set(int(x) + dx, int(y) + dy, col("xs3"))
            cv.set(int(x), int(y), col("o1" if tt < 0.5 else "xs1"))
    # embers: bright 1px sparks drifting out and up
    if tt < 0.95:
        for a, sp in embers:
            dist = R * (0.9 + 0.9 * sp * ease_out(tt))
            x = cx + math.cos(a) * dist
            y = cy + math.sin(a) * dist - R * 0.4 * tt
            cv.set(int(x), int(y), col("y0" if tt < 0.35 else ("y1" if tt < 0.65 else "o1")))
    return cv


# ---------------------------------------------------------------------------
def smoke(i, n=8):
    """Grey smoke: clustered spheres rise, swell, then shrink apart."""
    S = 32
    cv = Cv(S, S)
    t = i / (n - 1)
    r = rng(77)
    sph = []
    for k in range(6):
        a = k / 6 * math.tau + r.uniform(-0.4, 0.4)
        d = r.uniform(3, 6)
        rr = r.uniform(5.0, 6.8)
        end = r.uniform(1.12, 1.3)
        env = life(t * 0.92 + 0.12, 0.35, end)
        x = 16 + math.cos(a) * d * (0.7 + t * 0.6) + math.sin(t * 3 + k) * 0.8
        y = 19 + math.sin(a) * d * 0.7 - t * 9 - (k % 3) * t * 2
        sph.append((x, y, rr * env, None))
    sph.append((16, 18 - t * 8, 7.5 * life(t + 0.12, 0.3, 0.9), None))
    spheres(cv, sph, shade(SMOKE, (-0.2, 0.25, 0.68)))
    despeckle(cv)
    return cv


def poof(i, n=7):
    """Enemy defeat: white flash, a ring of soft puffs bursting out, two glints."""
    S = 32
    cv = Cv(S, S)
    t = i / (n - 1)
    cx = cy = 16
    if i == 0:
        disc(cv, cx, cy, 6.5, "pf1")
        disc(cv, cx, cy, 5, "pf0")
        star4(cv, cx, cy, 10, "pf0", e=0.5)
        return cv
    tt = (i - 1) / (n - 2)
    sph = []
    k_n = 7
    for k in range(k_n):
        a = k / k_n * math.tau + 0.35
        d = 5 + 7 * ease_out(tt)
        rr = (4.8 - (k % 2) * 0.9) * life(tt * 0.85 + 0.12, 0.2, 1.12 + (k % 3) * 0.05)
        sph.append((cx + math.cos(a) * d, cy + math.sin(a) * d * 0.85 - tt * 2, rr, None))
    if tt < 0.4:
        sph.append((cx, cy, 6 * (1 - tt / 0.4), None))
    spheres(cv, sph, shade(POOF, (-0.3, 0.15, 0.6)))
    if 0.1 < tt < 0.8:
        g = 2 if tt < 0.45 else 1
        star4(cv, cx + 9, cy - 9 - tt * 2, g + 1, "y0", core="pf0")
        star4(cv, cx - 10, cy + 6 - tt * 2, g, "y0", core="pf0")
    despeckle(cv)
    return cv


def dust(i, n=6):
    """Kicked-up dust (bottom-centred, symmetric): two puff clusters skid out, curl up
    and shrink away."""
    cv = Cv(24, 16)
    t = i / (n - 1)
    sph = []
    for side in (-1, 1):
        for k, (off, rr0, lift) in enumerate(((2.0, 3.4, 0.2), (5.5, 2.7, 0.7), (8.5, 1.9, 1.2))):
            env = life(t * 0.9 + 0.2, 0.28, 1.35 - k * 0.08)
            x = 12 + side * (off + t * (2.5 + k * 1.8))
            y = 16 - rr0 * env * 0.95 - t * (1.0 + lift * 3.2)
            sph.append((x, y, rr0 * env * (1 + 0.2 * t), None))
    spheres(cv, sph, shade(DUST, (-0.3, 0.2, 0.66)))
    despeckle(cv)
    return cv


def spark(i, n=5):
    """Hit spark: 1 white frame, then coloured streaks flying out + shrinking star."""
    S = 24
    cv = Cv(S, S)
    cx = cy = 12
    rays = [(0.35, 1.0), (1.95, 0.75), (3.3, 0.95), (4.75, 0.7), (1.1, 0.5), (2.7, 0.55), (4.1, 0.5), (5.6, 0.6)]
    if i == 0:
        star4(cv, cx, cy, 10, "w", e=0.45)
        star4(cv, cx, cy, 5, "w", e=0.75)
        disc(cv, cx + 0.5, cy + 0.5, 3, "w")
        return cv
    tt = (i - 1) / (n - 2)
    head_cols = [["y2", "y1", "y0", "w"], ["o1", "y1", "y0"], ["o2", "o1", "y1"], ["o2", "o1"]][i - 1]
    for k, (a, ln) in enumerate(rays):
        r0 = 3 + 7 * ease_out(tt) * ln
        r1 = r0 + (6 - 5 * tt) * ln + 1
        if tt > 0.9 and k >= 4:
            continue
        x0, y0 = cx + 0.5 + math.cos(a) * r0, cy + 0.5 + math.sin(a) * r0
        x1, y1 = cx + 0.5 + math.cos(a) * r1, cy + 0.5 + math.sin(a) * r1
        streak(cv, x0, y0, x1, y1, head_cols, wide=0.35 if (k < 4 and i < 3) else 0)
    core = [4, 2, 1, 0][i - 1]
    if core:
        star4(cv, cx, cy, core + 1, "y0", core="w", e=0.6)
    return cv


def coin_burst(i, n=6):
    """Coin pickup: golden flash, sparkle ring that breaks into glints."""
    S = 24
    cv = Cv(S, S)
    cx = cy = 12
    if i == 0:
        disc(cv, cx, cy, 4.5, "y1")
        disc(cv, cx, cy, 3.2, "y0")
        star4(cv, cx, cy, 8, "w", e=0.5)
        return cv
    tt = (i - 1) / (n - 2)
    R = 4 + 6.5 * ease_out(tt)
    th = 2.4 - 1.4 * tt
    gap = tt * 0.9  # ring breaks into segments
    def rc(a, f):
        seg = (a * 8 / math.tau) % 1
        if seg < gap * 0.6:
            return None
        if f < 0.4 and math.cos(a + 2.3) > 0.2:
            return "w"
        return "y1" if f < 0.6 else "y2"
    if tt < 0.85:
        ering(cv, cx, cy, R, R, lambda a: th, rc)
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4 + tt * 0.6
        d = R + 1.5
        g = [3, 3, 2, 1, 1][i - 1]
        star4(cv, cx + math.cos(a) * d, cy + math.sin(a) * d, g, "y1" if k % 2 else "y0", core="w")
    if tt < 0.5:
        star4(cv, cx, cy, 2, "y0", core="w")
    return cv


# ---------------------------------------------------------------------------
# projectiles (frame sizes unchanged: hitboxes derive from them). Face right.
# ---------------------------------------------------------------------------
def energy_shot(i):
    """Parker's blast: white-hot core in a banded green orb, rotating halo arcs and a
    tapered comet tail with peeling motes."""
    cv = Cv(16, 16)
    cx, cy = 10, 8
    pulse = [0, 0.5, 1, 0.5][i]
    # tail: two tapering bands (outer dark-green, inner bright)
    for x in range(0, 9):
        f = x / 8  # 0 tail end .. 1 at orb
        wob = math.sin(x * 1.1 - i * 1.6) * 0.5 * (1 - f)
        for y in range(16):
            dy = abs(y + 0.5 - cy - wob)
            if dy < 0.5 + 2.6 * f ** 1.3:
                cc = "gr2" if dy > 2.6 * f ** 1.3 - 0.6 else ("lime" if f > 0.55 and dy < 1.2 else "gr1")
                cv.set(x, y, col(cc))
    for k, (mx, my) in enumerate(((1, 5), (3, 11), (0, 9), (4, 4))):
        if (k + i) % 4 < 2:
            cv.set(mx - (i % 2), my, col("lime" if k % 2 else "gr1"))
    # halo arcs rotating around the orb
    rot = i * math.pi / 4
    ering(cv, cx, cy, 5.6 + pulse * 0.4, 5.6 + pulse * 0.4, lambda a: 1.0,
          lambda a, f: "lime" if ((a - rot) % math.pi) < 0.9 else ("gr1" if ((a - rot) % math.pi) < 1.4 else None))
    # orb: dark rim, banded body, white core
    spheres(cv, [(cx, cy, 4.2 + pulse * 0.3, None)],
            lambda x, y, I, zr, d: band(I * 0.6 + zr * 0.9, ["gx4", "gr1", "lime", "gx0", "w"], (0.3, 0.68, 1.0, 1.25)))
    return cv


def alien_laser(i):
    """Red energy bolt: tapered beam, white-hot core, glowing head, flickering tail."""
    cv = Cv(24, 8)
    fl = i % 2
    cy = 4
    for x in range(24):
        f = x / 23
        hw = 0.4 + 2.8 * min(1, f * 1.5) ** 1.5 * (1 if x < 20 else (23.5 - x) / 3.5)
        hw += (0.35 if (x + i * 3) % 6 < 3 else 0) * (1 - f)
        for y in range(8):
            d = abs(y + 0.5 - cy)
            if d < hw:
                if d < hw - 1.9 and f > 0.25:
                    cc = "w" if f > 0.45 else "rx0"
                elif d < hw - 1:
                    cc = "red" if f > 0.15 else "redd"
                else:
                    cc = "redd"
                cv.set(x, y, col(cc))
    # head flare
    disc(cv, 20.5, cy, 2.8 + 0.4 * fl, "red")
    disc(cv, 20.8, cy, 1.7, "w")
    cv.set(23, cy - 1, col("pk"))
    cv.set(23, cy, col("pk"))
    # tail sparks
    for k, (x, y) in enumerate(((1, 1), (3, 6), (0, 5), (5, 0))):
        if (k + i) % 2 == 0:
            cv.set(x, y, col("pk" if k % 2 else "red"))
    return cv


def plasma_shot(i):
    """Purple plasma orb: shaded sphere, rotating crackle arcs, halo."""
    cv = Cv(16, 16)
    cx, cy = 8, 8
    rr = [4.4, 4.7, 4.4, 4.1][i]
    # halo arcs rotating
    rot = i * math.pi / 4
    ering(cv, cx, cy, rr + 2.4, rr + 2.4, lambda a: 1.2,
          lambda a, f: "p1" if ((a - rot) % (math.pi)) < 1.1 else ("p3" if ((a - rot) % math.pi) < 1.6 else None))
    spheres(cv, [(cx, cy, rr, None)],
            lambda x, y, I, zr, d: band(I + zr * 0.3, ["p3", "p2", "p1", "p0", "px0"], (-0.1, 0.35, 0.75, 1.05)))
    # crackle: a short bright arc sliding over the surface
    a0 = rot * 2
    for k in range(4):
        x = cx + math.cos(a0 + k * 0.3) * (rr - 1.0)
        y = cy + math.sin(a0 + k * 0.3) * (rr - 1.0) * 0.6
        cv.set(int(x), int(y), col("px0" if k in (1, 2) else "p0"))
    return cv


def drone_shot(i):
    """Orange drone pellet: hot shaded core, rotating 4-point flare."""
    cv = Cv(12, 12)
    cx = cy = 6
    if i % 2 == 0:
        star4(cv, cx, cy, 5.5, "o1", e=0.5)
    else:
        for k in range(4):
            a = k * math.pi / 2 + math.pi / 4
            streak(cv, cx + 0.5, cy + 0.5, cx + 0.5 + math.cos(a) * 6.2, cy + 0.5 + math.sin(a) * 6.2, ["o1", "o1", "o2"])
    spheres(cv, [(cx + 0.5, cy + 0.5, 3.3, None)],
            lambda x, y, I, zr, d: band(I + zr * 0.4, ["o2", "o1", "y1", "y0", "w"], (0.15, 0.5, 0.85, 1.12)))
    return cv


# ---------------------------------------------------------------------------
# character abilities
# ---------------------------------------------------------------------------
GROUND = 17  # shockwave ground row inside its 64x24 frame (sprite is spawned at floor-4)


def shockwave(i, n=7):
    """Ground pound: impact flash, then a flat ground ring with twin crescent crests
    racing outward, dust billowing behind them and rock chips arcing up."""
    W, H = 64, 24
    cv = Cv(W, H)
    cx = 32
    t = i / (n - 1)
    if i == 0:
        disc(cv, cx, GROUND, 9, "l0", sy=0.35)
        disc(cv, cx, GROUND, 6, "w", sy=0.35)
        star4(cv, cx, GROUND - 1, 9, "w", e=0.5, sy=1.0)
        for s in (-1, 1):
            streak(cv, cx + s * 3, GROUND, cx + s * 14, GROUND - 1, ["l1", "l0", "w"], wide=0.5)
        return cv
    tt = (i - 1) / (n - 2)
    R = 11 + 19 * ease_out(tt)
    # dust behind the crests (sphere clusters, shrink away)
    sph = []
    for s in (-1, 1):
        for k in range(4):
            env = life(tt * 0.9 + 0.08, 0.3, 1.15 - k * 0.07)
            fx = R * (0.9 - k * 0.2) - 3
            rr = (3.4 - k * 0.5) * env
            sph.append((cx + s * fx, GROUND - rr * 0.6 - k * 0.6 * tt, rr, None))
    spheres(cv, sph, shade(DUST, (-0.25, 0.25, 0.68)))
    # flat ground ring: front arc thick + bright, back arc thin
    if tt < 0.9:
        th_front = 3.0 * (1 - tt) + 1
        def rc(a, f):
            front = math.sin(a) > 0
            if not front and tt > 0.5:
                return None
            if f < 0.34:
                return "w" if front else "l0"
            return "l0" if front else "l1"
        ering(cv, cx, GROUND, R, R * 0.2, lambda a: th_front if math.sin(a) > 0 else 1.0, rc)
    # twin crescent crests (moon shape standing on the ground, bulging outward):
    # thick in the middle, tapered tips, white leading edge.
    rc = min(12 * (1 - tt) ** 0.8 + 6.5, R * 0.8 + 2)
    off = 4.2 * (1 - tt) + 2.0
    for s_ in (-1, 1):
        front = cx + s_ * R
        ox = front - s_ * rc          # outer disc centre
        ix = ox - s_ * off            # inner disc centre (shifted toward the middle)
        for y in range(int(GROUND - rc / 1.3) - 1, GROUND + 1):
            for x in range(int(min(ox, ix) - rc) - 1, int(max(ox, ix) + rc) + 2):
                px, py = x + 0.5, y + 0.5
                do = math.hypot((px - ox), (py - GROUND - 0.5) * 1.3)
                di = math.hypot((px - ix), (py - GROUND - 0.5) * 1.3)
                if do <= rc and di > rc and (px - ox) * s_ > -0.5:
                    e = rc - do  # distance from the outer edge
                    cc = "w" if e < 1.1 else ("l0" if e < off * 0.6 else "l1")
                    if y >= GROUND - 1 and e >= 1.1:
                        cc = "l2"
                    cv.set(x, y, col(cc))
    # rock chips arcing out
    if tt < 0.9:
        for k, (vx, vy) in enumerate(((-0.7, 1.0), (-0.35, 1.25), (0.4, 1.15), (0.75, 0.95))):
            x = cx + vx * 30 * tt
            y = GROUND - 2 - vy * 26 * tt + 34 * tt * tt
            if y < GROUND:
                cv.rect(int(x), int(y), 2, 2, col("g4"))
                cv.set(int(x), int(y), col("g2"))
    return cv


def sniff(i, n=8):
    """Lupin's sniff: three wavy green scent ribbons (2px, lit top edge) drift forward
    and up, shortening from the tail; the lead one ends in a curl. Glints pop."""
    S = 24
    cv = Cv(S, S)
    t = (i + 0.7) / (n + 0.4)
    wisps = [(16, 0.0, 9, True), (11, 0.12, 7, False), (19.5, 0.24, 6, False)]  # (y, delay, length, curl)
    for y0, delay, ln, curl in wisps:
        u = (t - delay) / (1 - delay)
        if u <= 0 or u >= 1:
            continue
        x_head = 4 + ln * min(1, u * 2.2) + u * 8
        L_ = ln * min(1, u * 2.2) * (1 - max(0, (u - 0.45) / 0.55)) ** 0.9
        if L_ < 1:
            continue
        yb = y0 - u * 7
        pts = []
        steps = int(L_ * 4)
        for j in range(steps + 1):
            x = x_head - L_ + L_ * j / steps
            y = yb + math.sin(x * 0.55 - u * 4) * 1.3
            pts.append((x, y))
        for k, (x, y) in enumerate(pts):
            f = k / max(1, len(pts) - 1)
            cv.set(int(x), int(y) + 1, col("gr2" if f < 0.3 else "gr1"))
        for k, (x, y) in enumerate(pts):
            f = k / max(1, len(pts) - 1)
            cv.set(int(x), int(y), col("gr1" if f < 0.25 else ("lime" if f < 0.8 else "gx0")))
        if curl and u < 0.8:
            hx, hy = pts[-1]
            for a in range(0, 300, 20):
                ar = math.radians(a - 90)
                cv.set(int(hx + 1.5 + math.cos(ar) * 1.6), int(hy - 1.2 + math.sin(ar) * 1.6), col("lime"))
    if 2 <= i <= 5:
        g = [1, 2, 1, 1][i - 2]
        star4(cv, 20, 5 - (i - 2), g, "y0", core="w")
    if 4 <= i <= 6:
        star4(cv, 7, 7 - (i - 4), 1, "lime", core="gx0")
    return cv


def air_puff(i, n=6):
    """Mom's sparkle jump: a flat cloud ring kicks out under her feet, pink/white
    sparkles burst out."""
    W, H = 32, 20
    cv = Cv(W, H)
    cx, cy = 16, 9
    t = i / (n - 1)
    if i == 0:
        disc(cv, cx, cy, 5, "pf1", sy=0.45)
        disc(cv, cx, cy, 3.5, "pf0", sy=0.45)
        star4(cv, cx, cy, 6, "pf0", e=0.5, sy=1.0)
        return cv
    tt = (i - 1) / (n - 2)
    R = 5 + 9 * ease_out(tt)
    ry = R * 0.36
    # little cloud lobes on the ring
    sph = []
    for k in range(8):
        a = k / 8 * math.tau + 0.2
        rr = (2.9 - 0.6 * (k % 2)) * life(tt * 0.9 + 0.1, 0.22, 1.1 + 0.08 * (k % 2))
        sph.append((cx + math.cos(a) * R, cy + 2 * tt + math.sin(a) * ry, rr, None))
    back = [s for s in sph if s[1] < cy + 2 * tt]
    front = [s for s in sph if s[1] >= cy + 2 * tt]
    spheres(cv, back, shade(POOF, (-0.2, 0.2, 0.6)))
    if tt < 0.85:
        ering(cv, cx, cy + 2 * tt, R, ry, lambda a: 1.6 if math.sin(a) > 0 else 1.0,
              lambda a, f: ("pf0" if f < 0.5 else "pk") if math.sin(a) > 0 else ("pf1" if tt < 0.5 else None))
    spheres(cv, front, shade(POOF, (-0.2, 0.2, 0.6)))
    for k, (a, dd) in enumerate(((-2.4, 1.0), (-0.8, 1.1), (-1.6, 0.7), (0.3, 0.9), (2.9, 0.8))):
        if tt > 0.85 and k % 2:
            continue
        d = (R + 2) * dd
        g = 2 if (tt < 0.5 and k < 2) else 1
        star4(cv, cx + math.cos(a) * d, cy + math.sin(a) * d * 0.7 - tt * 3, g, "pk" if k % 2 else "p0", core="w")
    return cv


def dash_trail(i, n=5):
    """Brennan's dash: speed streaks trailing left of the spawn point (white heads,
    warm tails), retracting into the head as they fade; thin afterimage lines."""
    W, H = 32, 24
    cv = Cv(W, H)
    t = i / n
    lines = [(5, 22, 0.0, 2), (9, 28, 0.1, 1), (12, 30, 0.0, 2), (15, 24, 0.15, 1), (18, 16, 0.05, 1)]
    for y, ln, lag, thick in lines:
        head = W - 2 - lag * 10 - t * 3
        L_ = ln * (1 - t) ** 1.2
        if L_ < 1.5:
            if t < 1:
                cv.set(int(head), y, col("o0"))
            continue
        tail = head - L_
        cols = ["o1", "o0", "y0", "w"] if thick == 2 else ["o1", "o0", "w"]
        streak(cv, tail, y + 0.5, head, y + 0.5, cols)
        if thick == 2 and t < 0.6:
            streak(cv, tail + L_ * 0.4, y + 1.5, head - 1, y + 1.5, ["o1", "o0"])
    return cv


def spawn_ring(i, n=8):
    """Boss summon: red motes spiral in, flash, then a thick shaded ring expands,
    breaks into rotating segments and fades by thinning."""
    S = 40
    cv = Cv(S, S)
    cx = cy = 20
    if i < 3:
        tt = i / 3
        for k in range(8):
            a = k / 8 * math.tau + tt * 1.6
            d = 17 * (1 - tt) + 2
            x, y = cx + math.cos(a) * d, cy + math.sin(a) * d
            a2 = a - 0.5
            streak(cv, cx + math.cos(a2) * (d + 4), cy + math.sin(a2) * (d + 4), x, y, ["redd", "red", "pk"])
        disc(cv, cx, cy, 2 + i * 1.5, "redd")
        disc(cv, cx, cy, 1 + i * 1.2, "red")
        disc(cv, cx, cy, 0.5 + i * 0.8, "pk")
        return cv
    if i == 3:
        disc(cv, cx, cy, 8, "red")
        disc(cv, cx, cy, 6, "pk")
        disc(cv, cx, cy, 4, "w")
        star4(cv, cx, cy, 15, "pk", core="w", e=0.5)
        return cv
    tt = (i - 4) / (n - 5)
    R = 9 + 9 * ease_out(tt)
    th = 4.5 * (1 - tt) + 1
    rot = tt * 1.4

    def rc(a, f):
        seg = ((a + rot) * 6 / math.tau) % 1
        if seg < tt * 0.55:
            return None
        if f < 0.3:
            return "pk" if math.cos(a + 2.2) < 0.4 else "w"
        return "red" if f < 0.7 else "redd"
    ering(cv, cx, cy, R, R, lambda a: th, rc)
    if tt < 0.6:
        ering(cv, cx, cy, R * 0.55, R * 0.55, lambda a: 1.0,
              lambda a, f: "pk" if ((a - rot * 2) * 3 / math.tau) % 1 < 0.5 else None)
    for k in range(6):
        a = k / 6 * math.tau + rot * 1.5
        d = R + 3 + tt * 3
        g = 2 if tt < 0.5 else 1
        if tt < 0.99:
            star4(cv, cx + math.cos(a) * d, cy + math.sin(a) * d, g, "red", core="rx0")
    return cv


# ---------------------------------------------------------------------------
def debris(k):
    """Shaded 8x8 chunks: 0 concrete, 1 brick. Facet light from the upper left."""
    cv = Cv(8, 8)
    if k == 0:
        pts = [(0.6, 2.4), (3.5, 0.6), (6.8, 1.6), (7.4, 5.0), (4.6, 7.4), (1.2, 6.4)]
        ramp = ["g4", "g3", "g2", "g1"]
    else:
        pts = [(0.8, 3.0), (5.6, 0.8), (7.4, 4.6), (2.6, 7.4)]
        ramp = ["b3", "b2", "b1", "b0"]
    cv.poly(pts, ramp[1])
    gx = sum(p[0] for p in pts) / len(pts)
    gy = sum(p[1] for p in pts) / len(pts)
    for y in range(8):
        for x in range(8):
            if cv.get(x, y)[3]:
                v = -(x + 0.5 - gx) * 0.55 - (y + 0.5 - gy) * 0.75
                cv.set(x, y, col(band(v, ramp, (-1.6, 0.2, 1.8))))
    if k == 0:
        cv.set(4, 4, col("g4")), cv.set(5, 5, col("g4"))
    else:
        cv.line(2, 5, 5, 4, col("bm2"))
    cv.outline("ink")
    return cv


def bolt():
    cv = Cv(12, 16)
    cv.poly([(6, 0), (10.5, 0), (7.5, 6), (10.5, 6), (3, 15.8), (5, 8.5), (1.8, 8.5)], "y1")
    cv.line(7, 1, 4, 7, col("y0"))
    cv.line(8, 7, 5, 12, col("y0"))
    cv.line(6, 2, 5, 5, col("w"))
    cv.set(8, 7, col("w"))
    for y in range(16):  # shade the right edge
        for x in range(11, -1, -1):
            if cv.get(x, y)[3]:
                cv.set(x, y, col("y2"))
                break
    cv.outline("ink")
    return cv


# ---------------------------------------------------------------------------
# anim table: name -> (fn(i), frames). fps lives in src/game/systems/AnimationSystem.ts
ANIMS = {
    "dust": (dust, 6),
    "spark": (spark, 5),
    "explosion_small": (lambda i: explosion(i, 8, 32, 240), 8),
    "explosion_large": (lambda i: explosion(i, 10, 64, 480), 10),
    "smoke": (smoke, 8),
    "coin_burst": (coin_burst, 6),
    "poof": (poof, 7),
    "energy_shot": (energy_shot, 4),
    "alien_laser": (alien_laser, 4),
    "plasma_shot": (plasma_shot, 4),
    "drone_shot": (drone_shot, 4),
    "shockwave": (shockwave, 7),
    "sniff": (sniff, 8),
    "air_puff": (air_puff, 6),
    "dash_trail": (dash_trail, 5),
    "spawn_ring": (spawn_ring, 8),
}


def build():
    fr = {}
    for name, (fn, n) in ANIMS.items():
        for i in range(n):
            fr[f"{name}_{i}"] = fn(i).im
    fr["debris_0"] = debris(0).im
    fr["debris_1"] = debris(1).im
    fr["bolt"] = bolt().im
    pack_atlas(fr, os.path.join(ASSETS, "effects"))
    contact_sheet(fr, os.path.join(PREVIEWS, "effects.png"), scale=4)
    return fr


if __name__ == "__main__":
    build()
    print("effects ok")
