"""Shared helpers for extracting pixel-art sprites from the AI reference sheets.

Only depends on Pillow + numpy (no scipy) so the scripts stay reproducible.

Pipeline for one figure:
  1. `fg_mask`  – background removal: flood-fill from the region border over pixels
     whose colour is within `tol` of the (median) border colour, plus large enclosed
     background-coloured pockets (gaps between legs/arms).
  2. `components` – connected components of the foreground; callers pick the figure.
  3. `downscale` – box-downsample by a (float) factor: a target pixel is opaque when
     >= `cover` of its source block is foreground; its colour is the median of the
     foreground source pixels (keeps hard pixel colours, kills JPEG noise).
  4. `quantize` / `outline` – limited palette, hard alpha, dark outline on the
     silhouette edge so no navy fringe can survive.
"""
from __future__ import annotations

import json
import math
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / 'art' / 'reference'
OUT = ROOT / 'public' / 'assets'
PREVIEW = ROOT / 'art' / 'previews'


def load(name: str) -> np.ndarray:
    return np.asarray(Image.open(REF / name).convert('RGB')).astype(np.int16)


def _label(mask: np.ndarray, conn8: bool = True) -> tuple[np.ndarray, int]:
    """Connected-component labelling (pure python BFS over numpy)."""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    n = 0
    ys, xs = np.nonzero(mask)
    nb = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    if conn8:
        nb += [(-1, -1), (-1, 1), (1, -1), (1, 1)]
    m = mask
    for y0, x0 in zip(ys.tolist(), xs.tolist()):
        if lab[y0, x0]:
            continue
        n += 1
        lab[y0, x0] = n
        q = deque([(y0, x0)])
        while q:
            y, x = q.popleft()
            for dy, dx in nb:
                yy, xx = y + dy, x + dx
                if 0 <= yy < h and 0 <= xx < w and m[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = n
                    q.append((yy, xx))
    return lab, n


def label(mask: np.ndarray, conn8: bool = True):
    return _label(mask, conn8)


def border_bg(rgb: np.ndarray) -> np.ndarray:
    b = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    return np.median(b, axis=0)


def color_dist(rgb: np.ndarray, c) -> np.ndarray:
    d = rgb.astype(np.float32) - np.asarray(c, np.float32)
    return np.sqrt((d * d).sum(-1))


def fg_mask(rgb: np.ndarray, tol: float = 34, bg=None, pocket_min: int = 12,
            pocket_tol: float | None = None) -> np.ndarray:
    """True where the pixel belongs to a sprite."""
    if bg is None:
        bg = border_bg(rgb)
    dist = color_dist(rgb, bg)
    bgl = dist < tol
    lab, n = _label(bgl, conn8=False)
    h, w = bgl.shape
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])).tolist())
    edge.discard(0)
    isbg = np.isin(lab, list(edge))
    # enclosed pockets of background colour (between legs etc.)
    ptol = pocket_tol if pocket_tol is not None else tol * 0.7
    strict = dist < ptol
    if pocket_min:
        lab2, n2 = _label(strict & ~isbg, conn8=False)
        if n2:
            counts = np.bincount(lab2.ravel())
            big = np.nonzero(counts >= pocket_min)[0]
            big = big[big != 0]
            isbg |= np.isin(lab2, big)
    return ~isbg


def strip_lines(mask: np.ndarray, frac: float = 0.85, width: int = 3) -> np.ndarray:
    """Remove panel border lines: columns/rows that are mostly foreground, plus their
    immediate neighbours (lines are 1-3 px wide and antialiased)."""
    m = mask.copy()
    h, w = m.shape
    cols = np.nonzero(m.mean(0) > frac)[0]
    rows = np.nonzero(m.mean(1) > frac)[0]
    for c in cols:
        m[:, max(0, c - width // 2):c + width // 2 + 1] = False
    for r in rows:
        m[max(0, r - width // 2):r + width // 2 + 1, :] = False
    return m


def components(mask: np.ndarray, min_area: int = 1):
    """List of dicts: label id, area, bbox (x0,y0,x1,y1 exclusive), centroid."""
    lab, n = _label(mask)
    out = []
    if n == 0:
        return lab, out
    idx = np.arange(1, n + 1)
    ys, xs = np.nonzero(lab)
    ls = lab[ys, xs]
    for i in idx:
        sel = ls == i
        if sel.sum() < min_area:
            continue
        y, x = ys[sel], xs[sel]
        out.append(dict(id=int(i), area=int(sel.sum()), bbox=(int(x.min()), int(y.min()), int(x.max()) + 1, int(y.max()) + 1),
                        cx=float(x.mean()), cy=float(y.mean())))
    return lab, out


def erode(mask: np.ndarray, n: int = 1) -> np.ndarray:
    m = mask.copy()
    for _ in range(n):
        p = np.pad(m, 1)
        m = p[1:-1, 1:-1] & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    return m


def dilate(mask: np.ndarray, n: int = 1) -> np.ndarray:
    m = mask.copy()
    for _ in range(n):
        p = np.pad(m, 1)
        m = p[1:-1, 1:-1] | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
    return m


def downscale(rgb: np.ndarray, mask: np.ndarray, scale: float, cover: float = 0.45,
              anchor_bottom: bool = True) -> np.ndarray:
    """Box-downsample a masked figure by `scale` (source px per target px) → RGBA uint8.

    The grid is anchored to the bottom-centre of the mask bbox so feet land on a whole
    target row regardless of where the figure sits in the source.
    """
    ys, xs = np.nonzero(mask)
    x0, x1 = xs.min(), xs.max() + 1
    y0, y1 = ys.min(), ys.max() + 1
    tw = max(1, math.ceil((x1 - x0) / scale))
    th = max(1, math.ceil((y1 - y0) / scale))
    cxs = (x0 + x1) / 2 - tw * scale / 2
    oys = y1 - th * scale if anchor_bottom else y0
    out = np.zeros((th, tw, 4), np.uint8)
    H, W = mask.shape
    for ty in range(th):
        sy0 = oys + ty * scale
        a0, a1 = int(math.floor(sy0 + 1e-6)), int(math.ceil(sy0 + scale - 1e-6))
        a0, a1 = max(a0, 0), min(a1, H)
        for tx in range(tw):
            sx0 = cxs + tx * scale
            b0, b1 = int(math.floor(sx0 + 1e-6)), int(math.ceil(sx0 + scale - 1e-6))
            b0, b1 = max(b0, 0), min(b1, W)
            if a1 <= a0 or b1 <= b0:
                continue
            m = mask[a0:a1, b0:b1]
            if m.size == 0 or m.mean() < cover:
                continue
            px = rgb[a0:a1, b0:b1][m]
            # median of the central-ish pixels gives crisp colours
            out[ty, tx, :3] = np.median(px, axis=0).astype(np.uint8)
            out[ty, tx, 3] = 255
    return out


def remove_specks(rgba: np.ndarray, min_area: int = 3) -> np.ndarray:
    a = rgba[..., 3] > 0
    lab, comps = components(a)
    if not comps:
        return rgba
    big = max(comps, key=lambda c: c['area'])
    out = rgba.copy()
    for c in comps:
        if c['area'] < min_area and c is not big:
            out[lab == c['id']] = 0
    return out


def keep_largest(rgba: np.ndarray, keep_ratio: float = 0.0) -> np.ndarray:
    """Keep the largest component (plus any component >= keep_ratio * largest)."""
    a = rgba[..., 3] > 0
    lab, comps = components(a)
    if not comps:
        return rgba
    big = max(c['area'] for c in comps)
    keep = [c['id'] for c in comps if c['area'] >= max(big * keep_ratio, big if keep_ratio == 0 else 0)]
    out = rgba.copy()
    out[~np.isin(lab, keep)] = 0
    return out


def lum(c) -> float:
    c = np.asarray(c, np.float32)
    return float(0.299 * c[..., 0] + 0.587 * c[..., 1] + 0.114 * c[..., 2]) if c.ndim == 1 else 0


def outline(rgba: np.ndarray, color=(20, 14, 24), inner: bool = True, thresh: float = 70) -> np.ndarray:
    """Darken the silhouette edge.

    inner=True: opaque pixels touching transparency become `color` unless already dark
    (keeps the sprite size). inner=False: add a 1px outline outside the silhouette.
    """
    out = rgba.copy()
    a = out[..., 3] > 0
    p = np.pad(a, 1)
    if inner:
        edge = a & ~(p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:])
        rgb = out[..., :3].astype(np.float32)
        L = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
        sel = edge & (L > thresh)
        out[sel, :3] = color
    else:
        ring = ~a & (p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:])
        out[ring, :3] = color
        out[ring, 3] = 255
    return out


def quantize_set(frames: list[np.ndarray], colors: int = 32) -> list[np.ndarray]:
    """Quantise a list of RGBA frames to one shared palette (alpha preserved hard)."""
    opaque = [f[f[..., 3] > 0][:, :3] for f in frames]
    allpx = np.concatenate([o for o in opaque if len(o)]) if opaque else np.zeros((1, 3), np.uint8)
    strip = Image.fromarray(allpx.reshape(1, -1, 3).astype(np.uint8), 'RGB')
    pal_img = strip.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    out = []
    for f in frames:
        rgb = Image.fromarray(f[..., :3].astype(np.uint8), 'RGB')
        q = np.asarray(rgb.quantize(palette=pal_img, dither=Image.Dither.NONE).convert('RGB'))
        g = f.copy()
        g[..., :3] = q
        g[f[..., 3] == 0] = 0
        out.append(g)
    return out


def trim(rgba: np.ndarray) -> np.ndarray:
    a = rgba[..., 3] > 0
    if not a.any():
        return rgba[:1, :1]
    ys, xs = np.nonzero(a)
    return rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def place(sprite: np.ndarray, fw: int, fh: int, dx: int = 0, dy: int = 0, cx: float | None = None) -> np.ndarray:
    """Place a trimmed sprite bottom-centre in an fw x fh frame. dx/dy shift (dy<0 = up).
    cx: optional horizontal anchor column inside the sprite (defaults to its centre)."""
    fr = np.zeros((fh, fw, 4), np.uint8)
    h, w = sprite.shape[:2]
    anchor = w / 2 if cx is None else cx
    x = int(round(fw / 2 - anchor)) + dx
    y = fh - h + dy
    # clip
    sx0, sy0 = max(0, -x), max(0, -y)
    sx1, sy1 = min(w, fw - x), min(h, fh - y)
    if sx1 > sx0 and sy1 > sy0:
        src = sprite[sy0:sy1, sx0:sx1]
        dst = fr[y + sy0:y + sy1, x + sx0:x + sx1]
        m = src[..., 3] > 0
        dst[m] = src[m]
    return fr


def flip(rgba: np.ndarray) -> np.ndarray:
    return rgba[:, ::-1].copy()


def write_atlas(path_noext: Path, frames: dict[str, np.ndarray], cols: int | None = None, meta_extra: dict | None = None):
    """Write `<path>.png` + `<path>.json` (Phaser JSON Hash) from equal-size frames."""
    names = list(frames)
    fh, fw = frames[names[0]].shape[:2]
    for n in names:
        assert frames[n].shape[:2] == (fh, fw), (n, frames[n].shape)
    n = len(names)
    if cols is None:
        cols = max(1, min(n, int(math.ceil(math.sqrt(n * fh / fw)))))
    rows = int(math.ceil(n / cols))
    sheet = np.zeros((rows * fh, cols * fw, 4), np.uint8)
    out = {'frames': {}, 'meta': {
        'app': 'tools/art (Chicago Family Adventure)',
        'image': path_noext.name + '.png', 'format': 'RGBA8888',
        'size': {'w': cols * fw, 'h': rows * fh}, 'scale': '1'}}
    if meta_extra:
        out['meta'].update(meta_extra)
    for i, name in enumerate(names):
        cx, cy = (i % cols) * fw, (i // cols) * fh
        f = frames[name].copy()
        f[f[..., 3] < 128] = 0
        f[f[..., 3] >= 128, 3] = 255
        sheet[cy:cy + fh, cx:cx + fw] = f
        out['frames'][name] = {
            'frame': {'x': cx, 'y': cy, 'w': fw, 'h': fh}, 'rotated': False, 'trimmed': False,
            'spriteSourceSize': {'x': 0, 'y': 0, 'w': fw, 'h': fh}, 'sourceSize': {'w': fw, 'h': fh},
            'pivot': {'x': 0.5, 'y': 1.0}}
    path_noext.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(sheet, 'RGBA').save(str(path_noext) + '.png', optimize=True)
    with open(str(path_noext) + '.json', 'w') as fp:
        json.dump(out, fp, indent=1)
        fp.write('\n')


def checker(w: int, h: int, s: int = 8) -> Image.Image:
    yy, xx = np.mgrid[0:h, 0:w]
    c = ((yy // s + xx // s) % 2).astype(np.uint8)
    arr = np.where(c[..., None] == 1, np.array([200, 200, 210], np.uint8), np.array([150, 150, 165], np.uint8))
    return Image.fromarray(arr.astype(np.uint8), 'RGB')


def contact_sheet(rows: list[tuple[str, list[tuple[str, np.ndarray]]]], zoom: int = 4, per_row: int = 16,
                  baseline: bool = True) -> Image.Image:
    """rows: [(title, [(frame_name, rgba), ...]), ...] → preview image (no text rendering
    beyond a small label strip drawn with PIL's default font)."""
    from PIL import ImageDraw
    blocks = []
    for title, frames in rows:
        fh, fw = frames[0][1].shape[:2]
        for i in range(0, len(frames), per_row):
            blocks.append((title if i == 0 else '', frames[i:i + per_row], fw, fh))
    W = max(len(b[1]) * (b[2] * zoom + 4) for b in blocks) + 8
    H = sum(b[3] * zoom + 22 for b in blocks) + 8
    img = Image.new('RGB', (W, H), (40, 40, 48))
    d = ImageDraw.Draw(img)
    y = 4
    for title, frames, fw, fh in blocks:
        x = 4
        for name, f in frames:
            bg = checker(fw * zoom, fh * zoom, 2 * zoom)
            fi = Image.fromarray(f, 'RGBA').resize((fw * zoom, fh * zoom), Image.NEAREST)
            bg.paste(fi, (0, 0), fi)
            img.paste(bg, (x, y + 12))
            if baseline:
                d.line([(x, y + 12 + fh * zoom - 1), (x + fw * zoom - 1, y + 12 + fh * zoom - 1)], fill=(255, 0, 0))
            d.text((x + 1, y), (title + ' ' if title and x == 4 else '') + name, fill=(255, 255, 255))
            x += fw * zoom + 4
        y += fh * zoom + 22
    return img
