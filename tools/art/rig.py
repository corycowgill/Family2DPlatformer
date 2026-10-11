"""Tiny 2D part rig for re-posing extracted pixel sprites.

Used by `animate_characters.py` and `animate_enemies.py`. Pure Pillow + numpy.

Model
-----
A frame is painted onto a `Canvas` (rgb + part label per pixel) back-to-front:

* rigid parts (head, torso, shields, rotors ...) are pixel sprites cut from an extracted
  pose; they are pasted unrotated (sub-pixel moves are rounded), or rotated with
  `rot_sprite` (rotsprite-style: 8x nearest upscale, rotate, majority-vote downscale);
* limbs are capsule chains (hip-knee-ankle, shoulder-elbow-hand) rasterised with 4x4
  supersampling and coloured per pixel by a `colour(t, nx)` function (t = 0..1 along the
  limb, nx = screen-space normal x, used for front-lit shading);
* small shapes (shoes, hands, paws) are polygons / discs.

`Canvas.finish()` then draws one shared 1px outline around the whole silhouette plus
internal contours wherever a part sits in front of another (unless the pair is listed
as `merge`, e.g. legs disappearing under the pelvis), so limbs never tear away from
the body and there are no outline gaps.
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

OUTLINE = (22, 16, 30)


# ---------------------------------------------------------------- geometry helpers
def ik2(root, target, l1: float, l2: float, bend: int = 1):
    """Two-bone IK. Returns (mid, end). `bend` +1 puts the middle joint on the +x side of
    the root→target line when it points down (knees forward for right-facing legs).
    Out of reach: the chain points straight at the target and stretches to it (cartoon)."""
    rx, ry = root
    tx, ty = target
    dx, dy = tx - rx, ty - ry
    d = math.hypot(dx, dy)
    if d < 1e-6:
        return (rx, ry + l1), (tx, ty)
    if d >= l1 + l2 - 1e-6:
        k = l1 / (l1 + l2)
        return (rx + dx * k, ry + dy * k), (tx, ty)
    a = math.acos(max(-1.0, min(1.0, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))))
    base = math.atan2(dy, dx)
    # pick the solution whose joint lies on the requested side
    c1 = (rx + l1 * math.cos(base + a), ry + l1 * math.sin(base + a))
    c2 = (rx + l1 * math.cos(base - a), ry + l1 * math.sin(base - a))
    # side test: cross of (target-root) x (joint-root); for a downward chain +x side == cross < 0
    def side(c):
        return dx * (c[1] - ry) - dy * (c[0] - rx)
    mid = c1 if (side(c1) < 0) == (bend > 0) else c2
    return mid, (tx, ty)


def fk2(root, a1: float, a2: float, l1: float, l2: float):
    """Forward kinematics; angles in degrees, 0 = straight down, + = toward +x (forward).
    a2 is relative to the first bone."""
    r1 = math.radians(a1)
    mid = (root[0] + l1 * math.sin(r1), root[1] + l1 * math.cos(r1))
    r2 = math.radians(a1 + a2)
    end = (mid[0] + l2 * math.sin(r2), mid[1] + l2 * math.cos(r2))
    return mid, end


# ---------------------------------------------------------------- canvas
class Canvas:
    def __init__(self, w: int, h: int):
        self.w, self.h = w, h
        self.rgb = np.zeros((h, w, 3), np.uint8)
        self.lab = np.zeros((h, w), np.int16)
        self.depth: dict[int, int] = {}

    # -- painting
    def _paint(self, mask: np.ndarray, rgb: np.ndarray, label: int):
        self.rgb[mask] = rgb[mask] if rgb.ndim == 3 else rgb
        self.lab[mask] = label

    def sprite(self, sp: np.ndarray, x: float, y: float, label: int, anchor=(0.0, 0.0)):
        """Paste RGBA sprite so that its pixel-space point `anchor` lands on (x, y)."""
        ox = int(round(x - anchor[0]))
        oy = int(round(y - anchor[1]))
        h, w = sp.shape[:2]
        x0, y0 = max(0, ox), max(0, oy)
        x1, y1 = min(self.w, ox + w), min(self.h, oy + h)
        if x1 <= x0 or y1 <= y0:
            return
        src = sp[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
        m = src[..., 3] > 0
        sub_rgb = self.rgb[y0:y1, x0:x1]
        sub_lab = self.lab[y0:y1, x0:x1]
        sub_rgb[m] = src[..., :3][m]
        sub_lab[m] = label

    def capsules(self, pts: list[tuple[float, float]], radii: list[float] | float, colour, label: int,
                 ss: int = 4, cover: float = 0.5, caps=(True, True)):
        """Rasterise a chain of capsules through `pts` (radius per segment).
        colour(t, nx, ny, rel) -> rgb, t in 0..1 along the chain, (nx, ny) unit normal
        from the bone axis to the pixel, rel = dist / radius."""
        n = len(pts) - 1
        if isinstance(radii, (int, float)):
            radii = [float(radii)] * n
        P = np.array(pts, np.float64)
        seglen = np.hypot(*(P[1:] - P[:-1]).T)
        total = max(1e-6, seglen.sum())
        cum = np.concatenate([[0], np.cumsum(seglen)])
        rmax = max(radii) + 1
        x0 = int(math.floor(P[:, 0].min() - rmax)); x1 = int(math.ceil(P[:, 0].max() + rmax))
        y0 = int(math.floor(P[:, 1].min() - rmax)); y1 = int(math.ceil(P[:, 1].max() + rmax))
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(self.w, x1), min(self.h, y1)
        if x1 <= x0 or y1 <= y0:
            return
        # sample grid
        off = (np.arange(ss) + 0.5) / ss
        xs = (np.arange(x0, x1)[:, None] + off[None, :]).ravel()
        ys = (np.arange(y0, y1)[:, None] + off[None, :]).ravel()
        SX, SY = np.meshgrid(xs, ys)
        inside = np.zeros(SX.shape, bool)
        for i in range(n):
            a, b = P[i], P[i + 1]
            d = b - a
            L2 = max(1e-9, d @ d)
            t = np.clip(((SX - a[0]) * d[0] + (SY - a[1]) * d[1]) / L2, 0, 1)
            if not caps[0] and i == 0:
                tr = ((SX - a[0]) * d[0] + (SY - a[1]) * d[1]) / L2
                ok = tr >= 0
            else:
                ok = True
            if not caps[1] and i == n - 1:
                tr = ((SX - a[0]) * d[0] + (SY - a[1]) * d[1]) / L2
                ok = ok & (tr <= 1)
            px, py = a[0] + t * d[0], a[1] + t * d[1]
            dist = np.hypot(SX - px, SY - py)
            inside |= (dist <= radii[i]) & ok
        hh, ww = y1 - y0, x1 - x0
        cov = inside.reshape(hh, ss, ww, ss).mean(axis=(1, 3))
        mask_local = cov >= cover
        if not mask_local.any():
            return
        # colour at pixel centres
        cy, cx = np.nonzero(mask_local)
        out = np.zeros((hh, ww, 3), np.uint8)
        for yy, xx in zip(cy.tolist(), cx.tolist()):
            qx, qy = x0 + xx + 0.5, y0 + yy + 0.5
            best = None
            for i in range(n):
                a, b = P[i], P[i + 1]
                d = b - a
                L2 = max(1e-9, d @ d)
                t = min(1, max(0, ((qx - a[0]) * d[0] + (qy - a[1]) * d[1]) / L2))
                px, py = a[0] + t * d[0], a[1] + t * d[1]
                dist = math.hypot(qx - px, qy - py)
                rel = dist / radii[i]
                if best is None or rel < best[0]:
                    nx, ny = ((qx - px) / dist, (qy - py) / dist) if dist > 1e-6 else (0.0, 0.0)
                    best = (rel, (cum[i] + t * seglen[i]) / total, nx, ny)
            rel, tt, nx, ny = best
            out[yy, xx] = colour(tt, nx, ny, rel)
        full = np.zeros((self.h, self.w), bool)
        full[y0:y1, x0:x1] = mask_local
        rgb_full = np.zeros((self.h, self.w, 3), np.uint8)
        rgb_full[y0:y1, x0:x1] = out
        self._paint(full, rgb_full, label)

    def poly(self, pts, colour, label: int, ss: int = 4, cover: float = 0.5, shade=None):
        """Filled polygon. colour: rgb, or fn(x, y) -> rgb evaluated at pixel centres."""
        img = Image.new('L', (self.w * ss, self.h * ss), 0)
        ImageDraw.Draw(img).polygon([(x * ss, y * ss) for x, y in pts], fill=255)
        a = np.asarray(img, np.float32).reshape(self.h, ss, self.w, ss).mean(axis=(1, 3)) / 255
        m = a >= cover
        if not m.any():
            return
        if callable(colour):
            rgb = np.zeros((self.h, self.w, 3), np.uint8)
            for y, x in zip(*np.nonzero(m)):
                rgb[y, x] = colour(x + 0.5, y + 0.5)
            self._paint(m, rgb, label)
        else:
            self._paint(m, np.array(colour, np.uint8), label)

    def disc(self, cx, cy, r, colour, label: int, ss: int = 4, cover: float = 0.5):
        self.capsules([(cx, cy), (cx + 1e-3, cy)], r, colour if callable(colour) else (lambda *a: colour), label,
                      ss=ss, cover=cover)

    # -- finishing
    def finish(self, merge: set[tuple[int, int]] = frozenset(), outline=OUTLINE, contour: bool = True,
               outer: bool = True, no_contour: set[int] = frozenset()) -> np.ndarray:
        """Return RGBA: silhouette outline (outside, 4-neighbour) + internal contours.

        Internal contour: a pixel of part A that 4-touches a pixel of part B with a
        higher depth (B is in front) turns into the outline colour, unless (A, B) or
        (B, A) is in `merge` or A is in `no_contour`."""
        h, w = self.h, self.w
        rgb = self.rgb.copy()
        lab = self.lab
        filled = lab > 0
        if contour:
            dep = np.zeros(lab.max() + 2, np.int32)
            for k, v in self.depth.items():
                if k < len(dep):
                    dep[k] = v
            D = dep[lab]
            line = np.zeros((h, w), bool)
            for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                nl = np.zeros_like(lab)
                ys0, ys1 = max(0, dy), h + min(0, dy)
                xs0, xs1 = max(0, dx), w + min(0, dx)
                nl[ys0 - dy:ys1 - dy, xs0 - dx:xs1 - dx] = lab[ys0:ys1, xs0:xs1]
                ND = dep[nl]
                cand = filled & (nl > 0) & (nl != lab) & (ND > D)
                if merge or no_contour:
                    ys, xs = np.nonzero(cand)
                    for y, x in zip(ys.tolist(), xs.tolist()):
                        a, b = int(lab[y, x]), int(nl[y, x])
                        if (a, b) in merge or (b, a) in merge or a in no_contour:
                            cand[y, x] = False
                line |= cand
            rgb[line] = outline
        out = np.zeros((h, w, 4), np.uint8)
        out[filled, :3] = rgb[filled]
        out[filled, 3] = 255
        if outer:
            p = np.pad(filled, 1)
            ring = ~filled & (p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:])
            out[ring, :3] = outline
            out[ring, 3] = 255
        return out


# ---------------------------------------------------------------- sprite helpers
def strip_outline(sp: np.ndarray, thresh: float = 70, passes: int = 1) -> np.ndarray:
    """Remove dark silhouette-edge pixels (the old inner outline) so a fresh outline can
    be drawn around the re-composited figure without doubling up."""
    out = sp.copy()
    for _ in range(passes):
        a = out[..., 3] > 0
        p = np.pad(a, 1)
        edge = a & ~(p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:])
        rgb = out[..., :3].astype(np.float32)
        L = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
        out[edge & (L < thresh)] = 0
    return out


def rot_sprite(sp: np.ndarray, deg: float, pivot=None, up: int = 8):
    """Rotate an RGBA pixel sprite by `deg` (counter-clockwise, PIL convention) around
    `pivot` (sprite pixel coords, default centre). rotsprite-like: nearest upscale x`up`,
    nearest rotation, block majority vote back down (colour = most common opaque colour
    of the block, opaque when >= half the block is opaque). Returns (sprite, new_pivot)."""
    h, w = sp.shape[:2]
    if pivot is None:
        pivot = (w / 2, h / 2)
    k = deg % 360
    if abs(k) < 1e-6:
        return sp.copy(), pivot
    pad = int(math.ceil(math.hypot(w, h))) + 2
    big = np.zeros((pad * 2, pad * 2, 4), np.uint8)
    ox, oy = int(round(pad - pivot[0])), int(round(pad - pivot[1]))
    big[oy:oy + h, ox:ox + w] = sp
    im = Image.fromarray(big, 'RGBA').resize((pad * 2 * up, pad * 2 * up), Image.NEAREST)
    cx = (ox + pivot[0]) * up
    cy = (oy + pivot[1]) * up
    im = im.rotate(deg, resample=Image.NEAREST, center=(cx, cy))
    arr = np.asarray(im)
    H = W = pad * 2
    blk = arr.reshape(H, up, W, up, 4).transpose(0, 2, 1, 3, 4).reshape(H, W, up * up, 4)
    alpha = (blk[..., 3] > 0).mean(-1)
    out = np.zeros((H, W, 4), np.uint8)
    ys, xs = np.nonzero(alpha >= 0.5)
    for y, x in zip(ys.tolist(), xs.tolist()):
        px = blk[y, x]
        px = px[px[:, 3] > 0][:, :3]
        keys = px[:, 0].astype(np.int32) << 16 | px[:, 1].astype(np.int32) << 8 | px[:, 2]
        vals, cnt = np.unique(keys, return_counts=True)
        v = int(vals[np.argmax(cnt)])
        out[y, x] = ((v >> 16) & 255, (v >> 8) & 255, v & 255, 255)
    return out, (ox + pivot[0], oy + pivot[1])


def rot90(sp: np.ndarray, k: int, pivot):
    """Exact rotation by k*90 degrees counter-clockwise; returns (sprite, new pivot)."""
    h, w = sp.shape[:2]
    x, y = pivot
    k %= 4
    out = np.rot90(sp, k).copy()
    if k == 0:
        return out, (x, y)
    if k == 1:
        return out, (y, w - x)
    if k == 2:
        return out, (w - x, h - y)
    return out, (h - y, x)


def shear_rows(sp: np.ndarray, top_dx: int, y_from: int = 0) -> np.ndarray:
    """Shift rows progressively so the top row moves `top_dx` px and the bottom row stays
    (lean). Returns (sprite, x_margin): the result is 2*|top_dx| wider, the original
    column 0 now sits at x_margin."""
    h, w = sp.shape[:2]
    a = abs(top_dx)
    if a == 0:
        return sp, 0
    out = np.zeros((h, w + 2 * a, 4), np.uint8)
    span = max(1, h - 1 - y_from)
    for y in range(h):
        t = 1 - min(1, max(0, y - y_from) / span)
        dx = int(round(top_dx * t))
        out[y, a + dx:a + dx + w] = sp[y]
    return out, a


def lum(rgb) -> float:
    r, g, b = rgb[:3]
    return 0.299 * r + 0.587 * g + 0.114 * b


def nearest_palette(img: np.ndarray, pal: np.ndarray) -> np.ndarray:
    """Snap opaque pixels of an RGBA image to the nearest palette colour."""
    out = img.copy()
    m = out[..., 3] > 0
    px = out[m][:, :3].astype(np.int32)
    d = ((px[:, None, :] - pal[None, :, :].astype(np.int32)) ** 2).sum(-1)
    out[m, :3] = pal[np.argmin(d, 1)]
    return out


def bottom_anchor(img: np.ndarray) -> np.ndarray:
    """Shift an RGBA frame vertically so its lowest opaque row is the bottom row."""
    a = img[..., 3] > 0
    if not a.any():
        return img
    ys = np.nonzero(a.any(1))[0]
    dy = img.shape[0] - 1 - ys.max()
    if dy == 0:
        return img
    out = np.zeros_like(img)
    if dy > 0:
        out[dy:] = img[:-dy]
    else:
        out[:dy] = img[-dy:]
    return out


# ---------------------------------------------------------------- previews
def _checker(w, h, s):
    yy, xx = np.mgrid[0:h, 0:w]
    c = ((yy // s + xx // s) % 2).astype(bool)
    arr = np.where(c[..., None], np.array([206, 208, 216], np.uint8), np.array([176, 180, 192], np.uint8))
    return arr


def anim_gif(path: Path, cells: list[dict], zoom: int = 4, cols: int = 4, seconds: float = 2.4,
             tick_ms: int = 40, label: bool = True):
    """Animated preview. cells: [{title, frames:[rgba...], fps, loop(bool), scroll(px/s)}].
    Each cell plays its own frame rate on a common clock. `scroll` draws a ground strip
    with tick marks moving left at that speed (feet planted on contact frames should move
    with the ticks — the foot-sliding / moonwalk check)."""
    fh = max(c['frames'][0].shape[0] for c in cells)
    fw = max(c['frames'][0].shape[1] for c in cells)
    pad_top = 12 if label else 0
    cw, ch = fw * zoom + 6, fh * zoom + pad_top + 4 * zoom + 6
    rows = math.ceil(len(cells) / cols)
    W, H = cw * min(cols, len(cells)), ch * rows
    n_ticks = int(round(seconds * 1000 / tick_ms))
    frames_out = []
    for k in range(n_ticks):
        t = k * tick_ms / 1000
        img = Image.new('RGB', (W, H), (34, 34, 42))
        d = ImageDraw.Draw(img)
        for i, c in enumerate(cells):
            cx, cy = (i % cols) * cw + 3, (i // cols) * ch + 2
            fr = c['frames']
            n = len(fr)
            idx = int(t * c['fps'])
            idx = idx % n if c.get('loop', True) else min(idx % (n + max(2, n // 2)), n - 1)
            f = fr[idx]
            h, w = f.shape[:2]
            bg = np.full((fh * zoom, fw * zoom, 3), (172, 186, 206), np.uint8)  # flat sky (small GIFs)
            cell = Image.fromarray(bg, 'RGB')
            sp = Image.fromarray(f, 'RGBA').resize((w * zoom, h * zoom), Image.NEAREST)
            cell.paste(sp, ((fw - w) // 2 * zoom, (fh - h) * zoom), sp)
            img.paste(cell, (cx, cy + pad_top))
            gy = cy + pad_top + fh * zoom
            # ground strip
            d.rectangle([cx, gy, cx + fw * zoom - 1, gy + 4 * zoom - 1], fill=(92, 84, 78))
            sc = c.get('scroll', 0)
            off = (t * sc) % 8
            for tx in range(-1, fw // 8 + 2):
                x = (tx * 8 - off)
                if 0 <= x < fw:
                    d.rectangle([cx + int(x * zoom), gy, cx + int(x * zoom) + zoom - 1, gy + 4 * zoom - 1],
                                fill=(160, 150, 136))
            if label:
                d.text((cx, cy), f"{c['title']} {idx}", fill=(255, 255, 255))
        frames_out.append(img)
    frames_out[0].save(path, save_all=True, append_images=frames_out[1:], duration=tick_ms, loop=0,
                       optimize=False, disposal=1)


def strip_png(path: Path, rows: list[tuple[str, list[np.ndarray]]], zoom: int = 4, onion: bool = False):
    """Frame strips (one row per anim) on a checkerboard with a red baseline; `onion`
    adds a faint previous-frame ghost to judge spacing."""
    fh = max(f.shape[0] for _, fr in rows for f in fr)
    fw = max(f.shape[1] for _, fr in rows for f in fr)
    n = max(len(fr) for _, fr in rows)
    W = 70 + n * (fw * zoom + 4)
    H = len(rows) * (fh * zoom + 6) + 4
    img = Image.new('RGB', (W, H), (34, 34, 42))
    d = ImageDraw.Draw(img)
    for r, (title, fr) in enumerate(rows):
        y = 4 + r * (fh * zoom + 6)
        d.text((2, y + 2), title, fill=(255, 255, 255))
        for i, f in enumerate(fr):
            x = 70 + i * (fw * zoom + 4)
            bg = Image.fromarray(_checker(fw * zoom, fh * zoom, 2 * zoom), 'RGB')
            h, w = f.shape[:2]
            if onion and i > 0:
                g = fr[i - 1].copy()
                g[..., 3] = (g[..., 3] > 0) * 70
                gi = Image.fromarray(g, 'RGBA').resize((w * zoom, h * zoom), Image.NEAREST)
                bg.paste(gi, ((fw - w) // 2 * zoom, (fh - h) * zoom), gi)
            sp = Image.fromarray(f, 'RGBA').resize((w * zoom, h * zoom), Image.NEAREST)
            bg.paste(sp, ((fw - w) // 2 * zoom, (fh - h) * zoom), sp)
            img.paste(bg, (x, y))
            d.line([(x, y + fh * zoom - 1), (x + fw * zoom - 1, y + fh * zoom - 1)], fill=(255, 0, 0))
    img.save(path)
