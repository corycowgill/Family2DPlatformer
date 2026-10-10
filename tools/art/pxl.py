"""
Tiny pixel-art helper library shared by the tools/art/draw_*.py scripts.

Everything is drawn at native resolution with hard alpha (0 or 255) from a fixed
named palette, so output is reproducible (seeded RNG) and crisp.
"""
from __future__ import annotations

import json
import os
import random
from typing import Callable, Iterable

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ASSETS = os.path.join(ROOT, "public", "assets")
PREVIEWS = os.path.join(ROOT, "art", "previews")


def hexc(s: str) -> tuple[int, int, int, int]:
    s = s.lstrip("#")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255)


# ---------------------------------------------------------------------------
# Palette (named). Keep sprites inside this set; backgrounds may blend.
# ---------------------------------------------------------------------------
P = {k: hexc(v) for k, v in {
    # outlines / darks
    "ink": "1a1c2c", "ink2": "2b2d42", "navy": "29366f",
    # neutral greys (concrete / steel)
    "w": "f4f4f4", "g0": "e4e1da", "g1": "c8c4bc", "g2": "a29e97", "g3": "7a7772", "g4": "56545a", "g5": "3c3b44",
    # cool steel (vehicles / girders highlights)
    "s0": "dfe7ee", "s1": "b6c3cf", "s2": "8a9aab", "s3": "5e6d80", "s4": "3f4b5c",
    # limestone
    "l0": "f3e7c6", "l1": "e2cf9f", "l2": "c8b07c", "l3": "a08a5a", "l4": "6f5f40",
    # brick
    "b0": "e07a55", "b1": "c4553a", "b2": "a2402c", "b3": "7a2e22", "bm": "d8b896", "bm2": "b09477",
    # asphalt
    "a0": "6a6e7a", "a1": "4c505c", "a2": "3a3d48", "a3": "2b2d36",
    # rust steel (L)
    "r0": "e08a5a", "r1": "c25a36", "r2": "9c4128", "r3": "6e2c1f", "r4": "4a1e18",
    # water
    "t0": "c6f4ea", "t1": "6fd6c6", "t2": "3fb2ab", "t3": "268c93", "t4": "1b6a78", "t5": "154f62",
    # glass
    "gl0": "d2f0fa", "gl1": "8cc8e8", "gl2": "5a9fd0", "gl3": "3a74ad", "gl4": "284f80",
    # greens
    "gr0": "b4e36e", "gr1": "7cc35a", "gr2": "4f9a48", "gr3": "2f6b3a", "gr4": "1f4a30",
    # wood / dirt
    "wd0": "e8b070", "wd1": "c8894f", "wd2": "9c6237", "wd3": "6e4227", "wd4": "4a2c1c",
    "d0": "a87a52", "d1": "8a5e3c", "d2": "6a442a",
    # Chicago flag
    "cb": "8ecbf0", "cb2": "5eaee0", "cb3": "3b86c0", "cr": "e3242b", "cr2": "b0151f", "cr3": "7c0f1a",
    # gold / yellow / orange
    "y0": "fff4a8", "y1": "ffd84a", "y2": "f4b02a", "y3": "d07a1c", "y4": "8f4a14",
    "o0": "ffb36a", "o1": "ff7a2a", "o2": "d9501c",
    # skin / food
    "sk0": "ffd9b0", "sk1": "f0b080", "bun0": "f6c27a", "bun1": "d8903e", "bun2": "a8602a",
    "mus": "ffd400", "rel": "3cc23c", "tom": "e43a2a",
    # purple / pink / magenta (effects, sunset)
    "p0": "f0b4ff", "p1": "c070f0", "p2": "8a3ad0", "p3": "5a2496", "pk": "ff6aa8",
    # misc
    "lime": "a8f060", "cyan": "6af0ff", "red": "ff3b3b", "redd": "b01c28",
}.items()}

T = (0, 0, 0, 0)


def c(name_or_rgba) -> tuple[int, int, int, int]:
    if isinstance(name_or_rgba, str):
        return P[name_or_rgba] if name_or_rgba in P else hexc(name_or_rgba)
    if len(name_or_rgba) == 3:
        return (*name_or_rgba, 255)
    return tuple(name_or_rgba)  # type: ignore


def lerp(a, b, t):
    a, b = c(a), c(b)
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3)) + (255,)


def mix_rgb(a, b, t):
    return lerp(a, b, t)


# ---------------------------------------------------------------------------
# Canvas
# ---------------------------------------------------------------------------
class Cv:
    def __init__(self, w: int, h: int, fill=T):
        self.w, self.h = w, h
        self.im = Image.new("RGBA", (w, h), c(fill) if fill != T else T)
        self.px = self.im.load()

    # basic ------------------------------------------------------------
    def set(self, x, y, col):
        x, y = int(x), int(y)
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[x, y] = c(col) if col != T else T

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[x, y]
        return T

    def rect(self, x, y, w, h, col):
        col = c(col) if col != T else T
        for yy in range(max(0, y), min(self.h, y + h)):
            for xx in range(max(0, x), min(self.w, x + w)):
                self.px[xx, yy] = col

    def frame(self, x, y, w, h, col):
        self.hline(x, y, w, col)
        self.hline(x, y + h - 1, w, col)
        self.vline(x, y, h, col)
        self.vline(x + w - 1, y, h, col)

    def hline(self, x, y, w, col):
        self.rect(x, y, w, 1, col)

    def vline(self, x, y, h, col):
        self.rect(x, y, 1, h, col)

    def line(self, x0, y0, x1, y1, col):
        x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx + dy
        while True:
            self.set(x0, y0, col)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def ellipse(self, cx, cy, rx, ry, col):
        """Filled ellipse centred at (cx,cy) (floats allowed, e.g. 7.5 for even sizes)."""
        for y in range(int(cy - ry - 1), int(cy + ry + 2)):
            for x in range(int(cx - rx - 1), int(cx + rx + 2)):
                dx = (x + 0.5 - cx - 0.5) / max(rx, 0.01) if False else (x - cx) / max(rx, 0.01)
                dy = (y - cy) / max(ry, 0.01)
                if dx * dx + dy * dy <= 1.0 + 1e-6:
                    self.set(x, y, col)

    def disc(self, cx, cy, r, col):
        self.ellipse(cx, cy, r, r, col)

    def ring(self, cx, cy, r, col, thick=1.0):
        for y in range(int(cy - r - 2), int(cy + r + 3)):
            for x in range(int(cx - r - 2), int(cx + r + 3)):
                d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
                if r - thick < d <= r:
                    self.set(x, y, col)

    def poly(self, pts, col):
        """Filled polygon via scanline (pixel centres)."""
        ys = [p[1] for p in pts]
        for y in range(int(min(ys)), int(max(ys)) + 1):
            yc = y + 0.5
            xs = []
            n = len(pts)
            for i in range(n):
                (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
                if (y0 <= yc < y1) or (y1 <= yc < y0):
                    xs.append(x0 + (yc - y0) * (x1 - x0) / (y1 - y0))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                for x in range(int(round(xs[i])), int(round(xs[i + 1]))):
                    self.set(x, y, col)

    def blit(self, other: "Cv | Image.Image", x, y):
        im = other.im if isinstance(other, Cv) else other
        self.im.alpha_composite(im, (int(x), int(y)))
        self.px = self.im.load()

    def paste_over(self, other, x, y):
        """Hard paste of opaque pixels only."""
        im = other.im if isinstance(other, Cv) else other
        p2 = im.load()
        for yy in range(im.height):
            for xx in range(im.width):
                if p2[xx, yy][3] > 0:
                    self.set(x + xx, y + yy, p2[xx, yy])

    def replace(self, a, b):
        a, b = c(a), c(b)
        for y in range(self.h):
            for x in range(self.w):
                if self.px[x, y] == a:
                    self.px[x, y] = b

    def outline(self, col="ink", diag=False):
        """Add a 1px outline outside opaque pixels."""
        col = c(col)
        src = self.im.copy().load()
        nb = [(1, 0), (-1, 0), (0, 1), (0, -1)]
        if diag:
            nb += [(1, 1), (-1, -1), (1, -1), (-1, 1)]
        for y in range(self.h):
            for x in range(self.w):
                if src[x, y][3] != 0:
                    continue
                for dx, dy in nb:
                    xx, yy = x + dx, y + dy
                    if 0 <= xx < self.w and 0 <= yy < self.h and src[xx, yy][3] != 0:
                        self.px[x, y] = col
                        break

    def flip_h(self) -> "Cv":
        n = Cv(self.w, self.h)
        n.im = self.im.transpose(Image.FLIP_LEFT_RIGHT)
        n.px = n.im.load()
        return n

    def harden(self, thresh=128):
        for y in range(self.h):
            for x in range(self.w):
                r, g, b, a = self.px[x, y]
                self.px[x, y] = (r, g, b, 255) if a >= thresh else T

    def bbox(self):
        return self.im.getbbox()

    def save(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.im.save(path)


def text_w(s: str, font: dict, spacing=1) -> int:
    w = 0
    for ch in s:
        g = font.get(ch.upper(), font.get("?"))
        w += len(g[0]) + spacing
    return max(0, w - spacing)


def draw_text(cv: Cv, x, y, s, col, font=None, spacing=1):
    font = font or FONT3
    for ch in s:
        g = font.get(ch.upper(), font.get("?"))
        for j, row in enumerate(g):
            for i, v in enumerate(row):
                if v == "#":
                    cv.set(x + i, y + j, col)
        x += len(g[0]) + spacing
    return x


def _f(rows: str) -> list[str]:
    return [r for r in rows.strip("\n").split("\n")]


# 3x5 font (small signs / labels)
FONT3 = {k: _f(v) for k, v in {
    "A": "###\n#.#\n###\n#.#\n#.#", "B": "##.\n#.#\n##.\n#.#\n##.", "C": "###\n#..\n#..\n#..\n###",
    "D": "##.\n#.#\n#.#\n#.#\n##.", "E": "###\n#..\n##.\n#..\n###", "F": "###\n#..\n##.\n#..\n#..",
    "G": "###\n#..\n#.#\n#.#\n###", "H": "#.#\n#.#\n###\n#.#\n#.#", "I": "###\n.#.\n.#.\n.#.\n###",
    "J": "..#\n..#\n..#\n#.#\n###", "K": "#.#\n#.#\n##.\n#.#\n#.#", "L": "#..\n#..\n#..\n#..\n###",
    "M": "#.#\n###\n###\n#.#\n#.#", "N": "##.\n#.#\n#.#\n#.#\n#.#", "O": "###\n#.#\n#.#\n#.#\n###",
    "P": "###\n#.#\n###\n#..\n#..", "Q": "###\n#.#\n#.#\n###\n..#", "R": "###\n#.#\n##.\n#.#\n#.#",
    "S": "###\n#..\n###\n..#\n###", "T": "###\n.#.\n.#.\n.#.\n.#.", "U": "#.#\n#.#\n#.#\n#.#\n###",
    "V": "#.#\n#.#\n#.#\n#.#\n.#.", "W": "#.#\n#.#\n###\n###\n#.#", "X": "#.#\n#.#\n.#.\n#.#\n#.#",
    "Y": "#.#\n#.#\n.#.\n.#.\n.#.", "Z": "###\n..#\n.#.\n#..\n###",
    "0": "###\n#.#\n#.#\n#.#\n###", "1": ".#.\n##.\n.#.\n.#.\n###", "2": "###\n..#\n###\n#..\n###",
    "3": "###\n..#\n###\n..#\n###", "4": "#.#\n#.#\n###\n..#\n..#", "5": "###\n#..\n###\n..#\n###",
    "6": "###\n#..\n###\n#.#\n###", "7": "###\n..#\n..#\n..#\n..#", "8": "###\n#.#\n###\n#.#\n###",
    "9": "###\n#.#\n###\n..#\n###", " ": "..\n..\n..\n..\n..", ".": ".\n.\n.\n.\n#", "'": "#\n#\n.\n.\n.",
    "-": "...\n...\n###\n...\n...", "!": "#\n#\n#\n.\n#", "?": "###\n..#\n.##\n...\n.#.", ":": ".\n#\n.\n#\n.",
    "/": "..#\n..#\n.#.\n#..\n#..", "&": ".#.\n#.#\n.#.\n#.#\n.##", "x": "...\n#.#\n.#.\n#.#\n...",
}.items()}

# 5x7 font (logo / titles)
FONT5 = {k: _f(v) for k, v in {
    "A": ".###.\n#...#\n#...#\n#####\n#...#\n#...#\n#...#",
    "B": "####.\n#...#\n#...#\n####.\n#...#\n#...#\n####.",
    "C": ".###.\n#...#\n#....\n#....\n#....\n#...#\n.###.",
    "D": "####.\n#...#\n#...#\n#...#\n#...#\n#...#\n####.",
    "E": "#####\n#....\n#....\n####.\n#....\n#....\n#####",
    "F": "#####\n#....\n#....\n####.\n#....\n#....\n#....",
    "G": ".###.\n#...#\n#....\n#.###\n#...#\n#...#\n.####",
    "H": "#...#\n#...#\n#...#\n#####\n#...#\n#...#\n#...#",
    "I": "###\n.#.\n.#.\n.#.\n.#.\n.#.\n###",
    "J": "..###\n...#.\n...#.\n...#.\n#..#.\n#..#.\n.##..",
    "K": "#...#\n#..#.\n#.#..\n##...\n#.#..\n#..#.\n#...#",
    "L": "#....\n#....\n#....\n#....\n#....\n#....\n#####",
    "M": "#...#\n##.##\n#.#.#\n#.#.#\n#...#\n#...#\n#...#",
    "N": "#...#\n##..#\n#.#.#\n#..##\n#...#\n#...#\n#...#",
    "O": ".###.\n#...#\n#...#\n#...#\n#...#\n#...#\n.###.",
    "P": "####.\n#...#\n#...#\n####.\n#....\n#....\n#....",
    "Q": ".###.\n#...#\n#...#\n#...#\n#.#.#\n#..#.\n.##.#",
    "R": "####.\n#...#\n#...#\n####.\n#.#..\n#..#.\n#...#",
    "S": ".####\n#....\n#....\n.###.\n....#\n....#\n####.",
    "T": "#####\n..#..\n..#..\n..#..\n..#..\n..#..\n..#..",
    "U": "#...#\n#...#\n#...#\n#...#\n#...#\n#...#\n.###.",
    "V": "#...#\n#...#\n#...#\n#...#\n#...#\n.#.#.\n..#..",
    "W": "#...#\n#...#\n#...#\n#.#.#\n#.#.#\n##.##\n#...#",
    "X": "#...#\n#...#\n.#.#.\n..#..\n.#.#.\n#...#\n#...#",
    "Y": "#...#\n#...#\n.#.#.\n..#..\n..#..\n..#..\n..#..",
    "Z": "#####\n....#\n...#.\n..#..\n.#...\n#....\n#####",
    "0": ".###.\n#...#\n#..##\n#.#.#\n##..#\n#...#\n.###.",
    "1": "..#..\n.##..\n..#..\n..#..\n..#..\n..#..\n.###.",
    "2": ".###.\n#...#\n....#\n...#.\n..#..\n.#...\n#####",
    "3": "####.\n....#\n....#\n.###.\n....#\n....#\n####.",
    "4": "...#.\n..##.\n.#.#.\n#..#.\n#####\n...#.\n...#.",
    "5": "#####\n#....\n####.\n....#\n....#\n#...#\n.###.",
    "6": ".###.\n#....\n#....\n####.\n#...#\n#...#\n.###.",
    "7": "#####\n....#\n...#.\n..#..\n.#...\n.#...\n.#...",
    "8": ".###.\n#...#\n#...#\n.###.\n#...#\n#...#\n.###.",
    "9": ".###.\n#...#\n#...#\n.####\n....#\n....#\n.###.",
    " ": "...\n...\n...\n...\n...\n...\n...",
    "!": "#\n#\n#\n#\n#\n.\n#", "?": ".###.\n#...#\n....#\n..##.\n..#..\n.....\n..#..",
    ".": ".\n.\n.\n.\n.\n.\n#", "'": "#\n#\n.\n.\n.\n.\n.", "-": "....\n....\n....\n####\n....\n....\n....",
    ":": ".\n.\n#\n.\n.\n#\n.", ",": "..\n..\n..\n..\n..\n.#\n#.", "/": "....#\n...#.\n...#.\n..#..\n.#...\n.#...\n#....",
}.items()}


# ---------------------------------------------------------------------------
# Atlas packing (Phaser JSON Hash)
# ---------------------------------------------------------------------------
def pack_atlas(frames: dict[str, Image.Image], out_base: str, max_w=512, pad=1):
    """Shelf-pack frames (kept in insertion order grouped by height) and write png+json."""
    items = list(frames.items())
    order = sorted(range(len(items)), key=lambda i: (-items[i][1].height, i))
    x = y = shelf_h = 0
    pos = {}
    width = 0
    for i in order:
        name, im = items[i]
        if x + im.width > max_w:
            x = 0
            y += shelf_h + pad
            shelf_h = 0
        pos[name] = (x, y)
        x += im.width + pad
        width = max(width, x)
        shelf_h = max(shelf_h, im.height)
    height = y + shelf_h
    sheet = Image.new("RGBA", (width, height), T)
    out = {}
    for name, im in items:
        px, py = pos[name]
        sheet.paste(im, (px, py))
        out[name] = {
            "frame": {"x": px, "y": py, "w": im.width, "h": im.height},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": im.width, "h": im.height},
            "sourceSize": {"w": im.width, "h": im.height},
        }
    os.makedirs(os.path.dirname(out_base), exist_ok=True)
    sheet.save(out_base + ".png")
    meta = {
        "frames": out,
        "meta": {
            "app": "tools/art (Chicago Family Adventure)",
            "version": "1.0",
            "image": os.path.basename(out_base) + ".png",
            "format": "RGBA8888",
            "size": {"w": width, "h": height},
            "scale": "1",
        },
    }
    with open(out_base + ".json", "w") as f:
        json.dump(meta, f, indent=1)
    return sheet


def contact_sheet(frames: dict[str, Image.Image], path: str, scale=3, cols=8, bg=(54, 60, 84, 255), label=True, max_w=1500):
    """Preview: every frame scaled up with its name underneath (row height = tallest in row)."""
    names = list(frames)
    placed = []
    x = y = row_h = 0
    width = 0
    for n in names:
        im = frames[n]
        cw = max(im.width * scale, 64) + 8
        ch = im.height * scale + 14
        if x + cw > max_w and x > 0:
            x = 0
            y += row_h
            row_h = 0
        placed.append((n, x + 4, y + 2))
        x += cw
        width = max(width, x)
        row_h = max(row_h, ch)
    sheet = Image.new("RGBA", (width, y + row_h), bg)
    cv = Cv(1, 1)
    for n, x0, y0 in placed:
        im = frames[n]
        big = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
        sheet.alpha_composite(Image.new("RGBA", big.size, (74, 82, 110, 255)), (x0, y0))
        sheet.alpha_composite(big, (x0, y0))
        if label:
            cv.im, cv.w, cv.h = sheet, sheet.width, sheet.height
            cv.px = sheet.load()
            draw_text(cv, x0, y0 + big.height + 3, n[:16].replace("_", "-"), (255, 255, 255, 255))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sheet.save(path)


def rng(seed: int) -> random.Random:
    return random.Random(seed)


def scaled(im: Image.Image, s: int) -> Image.Image:
    return im.resize((im.width * s, im.height * s), Image.NEAREST)
