#!/usr/bin/env python3
"""Home-screen / PWA icons for Chicago Family Adventure (reproducible, Pillow only).

    python3 tools/art/draw_icons.py

Draws one 64x64 pixel-art master (Chicago flag band with the red six-pointed star, a night
skyline with the Willis Tower, and the family — Dad, Mom, Brennan, Parker and Lupin the dog —
on the street) and upscales it with nearest-neighbour:

    public/icons/icon-192.png          192x192  (3x)
    public/icons/icon-512.png          512x512  (8x)
    public/icons/icon-maskable-512.png 512x512  (8x, full-bleed; motif inside the 80% safe zone)
    public/icons/apple-touch-icon.png  180x180  (3x, 6 px of background cropped per side)
"""
import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'icons')

INK = (11, 23, 48)
NIGHT = (19, 37, 74)
NIGHT2 = (29, 53, 102)
WHITE = (236, 244, 250)
SKY = (179, 221, 242)
RED = (232, 65, 78)
RED_DK = (150, 30, 44)
GOLD = (255, 210, 90)
BLDG = (16, 30, 60)
BLDG_HI = (40, 66, 116)
SKIN = (238, 190, 150)
DAD, MOM, BRENNAN, PARKER, LUPIN = (47, 111, 214), (194, 63, 208), (224, 65, 58), (58, 160, 74), (232, 197, 71)

N = 64


def star_points(cx, cy, r):
    pts = []
    for i in range(12):
        a = -math.pi / 2 + i * math.pi / 6
        rr = r if i % 2 == 0 else r * 0.5
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    return pts


def inside(pts, x, y):
    """Even-odd point-in-polygon test (pixel centres → clean, symmetric pixel shapes)."""
    hit = False
    j = len(pts) - 1
    for i in range(len(pts)):
        (xi, yi), (xj, yj) = pts[i], pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def fill_star(d, cx, cy, r, color, dy=0):
    pts = star_points(cx, cy, r)
    for y in range(int(cy - r) - 1, int(cy + r) + 2):
        for x in range(int(cx - r) - 1, int(cx + r) + 2):
            if inside(pts, x + 0.5, y + 0.5):
                d.point((x, y + dy), fill=color)


def person(d, x, base, h, shirt, hair=INK):
    """Tiny figure, 3 px wide, `h` px tall, feet on row `base`."""
    top = base - h + 1
    d.rectangle([x, top, x + 2, top + 1], fill=SKIN)  # head
    d.point((x, top), fill=hair)
    d.point((x + 1, top), fill=hair)
    d.point((x + 2, top), fill=hair)
    d.rectangle([x, top + 2, x + 2, base - 2], fill=shirt)  # body
    d.point((x, base - 1), fill=INK)  # legs
    d.point((x + 2, base - 1), fill=INK)
    d.point((x, base), fill=INK)
    d.point((x + 2, base), fill=INK)


def master():
    img = Image.new('RGB', (N, N), INK)
    d = ImageDraw.Draw(img)
    # Night sky, banded.
    for y in range(N):
        c = INK if y < 4 else NIGHT if y < 40 else NIGHT2
        d.line([(0, y), (N - 1, y)], fill=c)
    # A few stars in the sky.
    for x, y in [(5, 5), (57, 7), (12, 33), (52, 35), (60, 30), (3, 27)]:
        d.point((x, y), fill=SKY)
    # Chicago flag band: white field, two light-blue stripes, red star.
    d.rectangle([0, 9, N - 1, 29], fill=WHITE)
    d.rectangle([0, 11, N - 1, 12], fill=SKY)
    d.rectangle([0, 26, N - 1, 27], fill=SKY)
    fill_star(d, 32, 19, 8.6, RED_DK, dy=1)
    fill_star(d, 32, 19, 8.6, RED)
    d.rectangle([0, 30, N - 1, 30], fill=INK)
    # Skyline (x0, top, x1) — Willis Tower on the right with twin antennas.
    blocks = [(0, 44, 6), (7, 40, 12), (13, 46, 17), (18, 38, 23), (24, 43, 28), (29, 41, 34),
              (35, 45, 39), (40, 36, 46), (47, 39, 51), (52, 43, 57), (58, 41, 63)]
    for x0, top, x1 in blocks:
        d.rectangle([x0, top, x1, 54], fill=BLDG)
        d.line([(x0, top), (x1, top)], fill=BLDG_HI)
        for wy in range(top + 2, 52, 3):
            for wx in range(x0 + 1, x1, 2):
                if (wx * 7 + wy * 13) % 5 < 2:
                    d.point((wx, wy), fill=GOLD)
    d.rectangle([42, 33, 44, 36], fill=BLDG)  # Willis setback
    d.line([(42, 31), (42, 33)], fill=BLDG_HI)
    d.line([(44, 31), (44, 33)], fill=BLDG_HI)
    d.point((42, 31), fill=RED)
    d.point((44, 31), fill=RED)
    # Street.
    d.rectangle([0, 55, N - 1, N - 1], fill=INK)
    d.line([(0, 55), (N - 1, 55)], fill=BLDG_HI)
    for x in range(2, N, 8):
        d.line([(x, 59), (x + 3, 59)], fill=(60, 80, 120))
    # The family, feet on row 54, in the middle of the safe zone.
    person(d, 21, 54, 11, DAD, INK)
    person(d, 26, 54, 10, MOM, (120, 60, 30))
    person(d, 31, 54, 8, BRENNAN, (90, 50, 20))
    person(d, 36, 54, 7, PARKER, (200, 150, 60))
    # Lupin the dog.
    d.rectangle([41, 51, 45, 52], fill=LUPIN)
    d.rectangle([44, 49, 46, 50], fill=LUPIN)
    d.point((46, 49), fill=INK)
    d.point((40, 50), fill=LUPIN)
    d.point((41, 53), fill=INK)
    d.point((45, 53), fill=INK)
    d.point((41, 54), fill=INK)
    d.point((45, 54), fill=INK)
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    m = master()
    up = lambda s: m.resize((N * s, N * s), Image.NEAREST)
    up(3).save(os.path.join(OUT, 'icon-192.png'), optimize=True)
    up(8).save(os.path.join(OUT, 'icon-512.png'), optimize=True)
    up(8).save(os.path.join(OUT, 'icon-maskable-512.png'), optimize=True)
    up(3).crop((6, 6, 186, 186)).save(os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)
    print('wrote', ', '.join(sorted(os.listdir(OUT))))


if __name__ == '__main__':
    main()
