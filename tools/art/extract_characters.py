#!/usr/bin/env python3
"""Extract the 5 playable characters from art/reference/family-characters-sheet.png.

Outputs (see tools/art/README.md):
  public/assets/characters/<id>.png + .json   48x48 frames, JSON Hash atlas
  public/assets/ui/portrait-<id>.png          24x24 HUD portraits
  art/previews/characters.png                 4x contact sheet on a checkerboard

Run: python3 tools/art/extract_characters.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from artlib import (OUT, PREVIEW, components, contact_sheet, dilate, erode, fg_mask, flip, keep_largest, load,  # noqa: E402
                    outline, place, quantize_set, remove_specks, downscale, trim, write_atlas)
import animate_characters  # noqa: E402
import rig  # noqa: E402

FRAME = 48

# Row bands (sheet y-range below the column headers) and per-character settings.
#   h: target pixel height of the idle pose (sets the downscale factor for the whole set)
CHARS = {
    'dad': dict(band=(44, 158), h=37),
    'mom': dict(band=(218, 335), h=35),
    'brennan': dict(band=(394, 509), h=31),
    'parker': dict(band=(566, 685), h=29),
    'lupin': dict(band=(744, 852), h=18),
    'grandma': dict(band=(900, 1012), h=33),
}
# Column cells (sheet x-range between the separator lines) and how many poses each holds.
CELLS = {
    'idle': ((212, 311), 2), 'walk': ((314, 457), 3), 'run': ((460, 612), 3), 'jump': ((615, 699), 1),
    'fall': ((702, 776), 1), 'crouch': ((779, 856), 1), 'attack': ((859, 1010), 2), 'hurt': ((1013, 1095), 1),
    'die': ((1098, 1200), 1),
}
# Lupin's walk/run cells only hold 2 dogs each.
COUNT_OVERRIDE = {('lupin', 'walk'): 2, ('lupin', 'run'): 2, ('lupin', 'attack'): 1}
# Attack effects (swooshes, ball, sparkles, energy) erased before segmentation – sheet coords.
ERASE = {
    'dad': [(978, 44, 1012, 100), (999, 100, 1012, 158)],
    'mom': [(984, 218, 1012, 335)],
    'brennan': [(928, 394, 1012, 427), (958, 394, 1012, 437), (967, 437, 1012, 509)],
    'parker': [(970, 566, 1012, 685)],
    'lupin': [(950, 744, 1012, 852)],
    'grandma': [(968, 900, 1012, 932)],
}


def split_blob(mask: np.ndarray, n: int) -> list[np.ndarray]:
    """Split a mask holding n touching figures.

    First try erosion: erode until the blob falls apart into n big cores, then grow the
    cores back inside the original mask (each pixel goes to the core that reaches it
    first). Falls back to cutting at the emptiest columns.
    """
    area = mask.sum()
    for it in range(1, 9):
        core = erode(mask, it)
        lab, comps = components(core)
        big = sorted([c for c in comps if c['area'] > area * 0.12], key=lambda c: c['bbox'][0])
        if len(big) >= n:
            big = sorted(sorted(big, key=lambda c: -c['area'])[:n], key=lambda c: c['bbox'][0])
            own = np.zeros(mask.shape, np.int32)
            for k, c in enumerate(big):
                own[lab == c['id']] = k + 1
            for _ in range(it + 4):
                for k in range(1, n + 1):
                    grow = dilate(own == k) & mask & (own == 0)
                    own[grow] = k
            # pixels not reached (thin detached bits) go to the nearest core by column
            rest = mask & (own == 0)
            if rest.any():
                cxs = [c['cx'] for c in big]
                yy, xx = np.nonzero(rest)
                for y, x in zip(yy, xx):
                    own[y, x] = 1 + int(np.argmin([abs(x - cx) for cx in cxs]))
            return [own == k for k in range(1, n + 1)]
    ys, xs = np.nonzero(mask)
    x0, x1 = xs.min(), xs.max() + 1
    colsum = mask.sum(0)
    cuts = [x0]
    for k in range(1, n):
        mid = x0 + (x1 - x0) * k / n
        lo, hi = int(mid - (x1 - x0) / (n * 3)), int(mid + (x1 - x0) / (n * 3))
        c = lo + int(np.argmin(colsum[lo:hi]))
        cuts.append(c)
    cuts.append(x1)
    out = []
    for a, b in zip(cuts[:-1], cuts[1:]):
        m = np.zeros_like(mask)
        m[:, a:b] = mask[:, a:b]
        out.append(m)
    return out


def extract_poses(rgb: np.ndarray, cid: str) -> dict[str, list[tuple[np.ndarray, np.ndarray]]]:
    """Return {pose: [(rgb_region, mask), ...]} in sheet order (left→right)."""
    y0, y1 = CHARS[cid]['band']
    work = rgb.copy()
    poses = {}
    for pose, ((x0, x1), n) in CELLS.items():
        n = COUNT_OVERRIDE.get((cid, pose), n)
        reg = work[y0:y1, x0 + 1:x1].copy()
        m = fg_mask(reg, tol=34)
        if pose == 'attack':
            for ex0, ey0, ex1, ey1 in ERASE[cid]:
                m[max(0, ey0 - y0):max(0, ey1 - y0), max(0, ex0 - x0 - 1):max(0, ex1 - x0 - 1)] = False
        lab, comps = components(m)
        # figure-sized components only (drops stars, floor strips, text)
        comps = [c for c in comps if c['area'] >= 600 and (c['bbox'][3] - c['bbox'][1]) > 12]
        comps.sort(key=lambda c: c['bbox'][0])
        masks = []
        for c in comps:
            cm = lab == c['id']
            w = c['bbox'][2] - c['bbox'][0]
            masks.append((cm, w))
        # split blobs that hold more than one figure
        while len(masks) < n:
            i = max(range(len(masks)), key=lambda k: masks[k][1])
            cm, w = masks.pop(i)
            parts = split_blob(cm, 2)
            for j, p in enumerate(parts):
                ys, xs = np.nonzero(p)
                masks.insert(i + j, (p, xs.max() - xs.min() + 1))
        assert len(masks) == n, (cid, pose, len(masks))
        poses[pose] = [(reg, cm) for cm, _ in masks]
    return poses


def squash(sp: np.ndarray, rows: int = 1, at: float = 0.55) -> np.ndarray:
    """Remove `rows` rows around relative height `at` (0=top) → shorter sprite."""
    h = sp.shape[0]
    out = sp
    for _ in range(rows):
        r = int(out.shape[0] * at)
        out = np.delete(out, r, axis=0)
    return out


def stretch(sp: np.ndarray, rows: int = 1, at: float = 0.55) -> np.ndarray:
    out = sp
    for _ in range(rows):
        r = int(out.shape[0] * at)
        out = np.insert(out, r, out[r], axis=0)
    return out


def shear(sp: np.ndarray, amount: int = 3) -> np.ndarray:
    """Lean forward: top rows shifted right by up to `amount` px."""
    h, w = sp.shape[:2]
    out = np.zeros((h, w + amount, 4), np.uint8)
    for y in range(h):
        dx = int(round(amount * (1 - y / max(1, h - 1))))
        out[y, dx:dx + w] = sp[y]
    return trim(out)


def nod(sp: np.ndarray, frac: float = 0.45, dy: int = 1) -> np.ndarray:
    """Lower the front (right) part of the sprite by dy px (dog sniffing)."""
    h, w = sp.shape[:2]
    out = sp.copy()
    x0 = int(w * (1 - frac))
    part = sp[:, x0:].copy()
    out[:, x0:] = 0
    shifted = np.zeros_like(part)
    shifted[dy:] = part[:-dy]
    # keep the feet row of the original so the baseline stays planted
    keep = part[-dy:]
    m = keep[..., 3] > 0
    shifted[-dy:][m] = keep[m]
    out[:, x0:] = shifted
    return out


def raw_sprites(rgb: np.ndarray, cid: str):
    """All sheet poses of one character at game scale: ({pose: [rgba, ...]}, poses, scale)."""
    poses = extract_poses(rgb, cid)
    # scale from the first idle pose height
    _, m0 = poses['idle'][0]
    ys = np.nonzero(m0)[0]
    scale = (ys.max() - ys.min() + 1) / CHARS[cid]['h']
    raw = {}
    for pose, lst in poses.items():
        raw[pose] = []
        for reg, cm in lst:
            # feature-preserving: glasses / eyes / mouths survive the ~2.5x reduction
            sp = downscale(reg, cm, scale, cover=0.5, dark_frac=0.45)
            sp = keep_largest(remove_specks(sp, 4), 0.25)
            raw[pose].append(sp)
    names = [(p, i) for p in raw for i in range(len(raw[p]))]
    q = quantize_set([raw[p][i] for p, i in names], colors=28)
    for (p, i), f in zip(names, q):
        raw[p][i] = trim(outline(f, color=(22, 16, 30), thresh=60))
    return raw, poses, scale


def build_character_sheet(raw, cid: str) -> dict[str, np.ndarray]:
    """Legacy assembly straight from the sheet poses (padded with squash/offset
    variants). Kept as the fallback for any anim the rig does not provide."""
    S = raw
    I, W, R = S['idle'], S['walk'], S['run']
    J, Fa, C, A, H, D = S['jump'][0], S['fall'][0], S['crouch'][0], S['attack'], S['hurt'][0], S['die'][0]
    fr: dict[str, np.ndarray] = {}

    def add(anim, sprites):
        for k, s in enumerate(sprites):
            if isinstance(s, tuple):
                sp, dx, dy = s
            else:
                sp, dx, dy = s, 0, 0
            fr[f'{anim}_{k}'] = place(sp, FRAME, FRAME, dx, dy)

    def lift(sp, dy):
        # never push the head out of the frame
        dy = min(dy, FRAME - sp.shape[0])
        return (sp, 0, -max(0, dy))

    add('idle', [I[0], squash(I[0]), I[1], squash(I[1])])
    if len(W) == 3:
        add('walk', [W[0], W[1], W[2], squash(W[0]), W[1], W[2]])
    else:  # lupin: 2 walk poses
        add('walk', [W[0], squash(W[0]), W[1], squash(W[1]), W[0], W[1]])
    if len(R) == 3:
        add('run', [R[0], R[1], R[2], squash(R[0]), R[1], R[2]])
    else:
        add('run', [R[0], squash(R[0]), R[1], squash(R[1]), R[0], R[1]])
    add('jump', [J, stretch(J)])
    add('fall', [Fa, stretch(Fa)])
    add('land', [C, squash(I[0], 2, 0.6)])
    add('crouch', [C, squash(C, 1, 0.4)])
    if len(A) == 2:
        add('attack', [A[0], A[1], squash(A[1]), A[0]])
    else:  # lupin: crouch wind-up, lunge
        add('attack', [C, A[0], (A[0], 2, 0), squash(A[0])])
    add('hurt', [H, (H, -2, 0)])
    add('victory', [I[0], squash(C, 1), lift(J, 3), lift(J, 6), lift(J, 3), squash(I[0], 2, 0.6)])
    add('defeat', [H, (squash(H, 3), -2, 0), D, D])
    if cid == 'dad':  # ground pound: rise, tuck in the air, slam
        ab = [lift(J, 2), lift(C, 8), lift(C, 4), squash(C, 2)]
    elif cid == 'mom':  # sparkle air-jump: spin
        ab = [J, flip(J), stretch(J), flip(Fa)]
    elif cid == 'brennan':  # dash
        ab = [shear(R[1], 3), shear(R[2], 4), shear(R[1], 4), shear(R[2], 3)]
    elif cid == 'parker':  # energy blast
        ab = [A[0], A[1], squash(A[1]), A[1]]
    else:  # lupin sniff
        ab = [C, nod(C, 0.45, 1), nod(C, 0.45, 2), nod(C, 0.45, 1)]
    add('ability', ab)
    return fr


def build_character(rgb: np.ndarray, cid: str, costume: dict | None = None, cached=None):
    raw, poses, scale = cached or raw_sprites(rgb, cid)
    legacy = build_character_sheet(raw, cid)
    rigged = animate_characters.build(cid, raw, costume)
    fr: dict[str, np.ndarray] = {}
    for name in legacy:
        anim, _, n = name.rpartition('_')
        if anim in rigged:
            fr[name] = rigged[anim][int(n)]
        else:
            fr[name] = legacy[name]
    return fr, poses, scale, rigged


PORTRAIT_FRAC = {'dad': 0.46, 'mom': 0.46, 'brennan': 0.5, 'parker': 0.5, 'lupin': 0.62, 'grandma': 0.47}


def portrait(rgb: np.ndarray, poses, cid: str) -> np.ndarray:
    """24x24 head portrait from the first idle pose at a finer scale."""
    reg, cm = poses['idle'][0]
    ys, xs = np.nonzero(cm)
    top, bot = ys.min(), ys.max()
    h = bot - top + 1
    m = cm.copy()
    frac = PORTRAIT_FRAC[cid]
    m[top + int(h * frac):] = False  # head down to the chin
    # square window centred on the head (cuts most of mom's ponytail)
    hy = np.nonzero(m)[0]
    hh = hy.max() - hy.min() + 1
    cx = np.nonzero(m[top:top + max(2, hh // 2)])[1].mean()
    x0 = int(round(cx - hh * 0.55))
    m[:, :max(0, x0)] = False
    m[:, x0 + int(hh * 1.1):] = False
    ys, xs = np.nonzero(m)
    span = max(ys.max() - ys.min() + 1, xs.max() - xs.min() + 1)
    sp = downscale(reg, m, span / 22, cover=0.5)
    sp = keep_largest(remove_specks(sp, 3), 0.2)
    sp = quantize_set([sp], 24)[0]
    sp = trim(outline(sp, color=(22, 16, 30), thresh=60))
    out = np.zeros((24, 24, 4), np.uint8)
    h, w = sp.shape[:2]
    y, x = (24 - h) // 2 + 1, (24 - w) // 2
    h2, w2 = min(h, 24 - y), min(w, 24 - x)
    out[y:y + h2, x:x + w2] = sp[:h2, :w2]
    return out


def costume_portrait(fr: dict[str, np.ndarray], cid: str) -> np.ndarray:
    """24x24 costume portrait: the head (+ hat) of idle_0 at 1x, centred."""
    f = fr['idle_0']
    a = f[..., 3] > 0
    ys, xs = np.nonzero(a)
    top = ys.min()
    if cid == 'lupin':  # head is at the front (right) of the dog
        x1 = xs.max() + 1
        crop = f[max(0, top - 1):top + 22, max(0, x1 - 22):x1]
    else:
        sel = ys < top + 12
        cx = int(round((xs[sel].min() + xs[sel].max() + 1) / 2))
        crop = f[top:top + 22, max(0, cx - 11):cx + 11].copy()
    out = np.zeros((24, 24, 4), np.uint8)
    h, w = crop.shape[:2]
    y, x = 1, (24 - w) // 2
    out[y:y + h, x:x + w] = crop
    out[-1] = 0
    return out


def build_costumes(rgb: np.ndarray, cids=None) -> list:
    """Write public/assets/characters/<id>-<costume>.png/.json for every costume."""
    import costumes
    rows = []
    for cid in cids or CHARS:
        cached = raw_sprites(rgb, cid)
        meta = animate_characters.anim_meta(cid, cached[0])
        for cs in costumes.costumes(cid):
            key = f"{cid}-{cs['id']}"
            fr, *_ = build_character(rgb, cid, cs, cached)
            write_atlas(OUT / 'characters' / key, fr, cols=12, meta_extra={'anims': meta})
            rig.anim_gif(PREVIEW / f'anim-{key}.gif', animate_characters.preview_cells(fr, meta), zoom=2, cols=6,
                         seconds=2.0)
            Image.fromarray(costume_portrait(fr, cid), 'RGBA').save(OUT / 'ui' / f'portrait-{key}.png')
            rows.append((key, list(fr.items())))
            print(f'{key}: {len(fr)} frames')
    return rows


def main():
    rgb = load('family-characters-sheet.png')
    args = sys.argv[1:]
    if args and args[0] == '--costumes':
        rows = build_costumes(rgb, args[1:] or None)
        PREVIEW.mkdir(parents=True, exist_ok=True)
        for cid in sorted({k.split('-')[0] for k, _ in rows}):
            mine = [r for r in rows if r[0].startswith(cid + '-')]
            contact_sheet(mine, zoom=3, per_row=12).save(PREVIEW / f'costumes-{cid}.png')
        return
    rows = []
    ports = []
    for cid in (args or CHARS):
        fr, poses, scale, rigged = build_character(rgb, cid)
        raw = raw_sprites(rgb, cid)[0]
        meta = animate_characters.anim_meta(cid, raw)
        write_atlas(OUT / 'characters' / cid, fr, cols=12, meta_extra={'anims': meta})
        PREVIEW.mkdir(parents=True, exist_ok=True)
        rig.anim_gif(PREVIEW / f'anim-{cid}.gif', animate_characters.preview_cells(fr, meta), zoom=4, cols=4,
                     seconds=2.0)
        groups: dict[str, list] = {}
        for name, f in fr.items():
            groups.setdefault(name.rpartition('_')[0], []).append(f)
        rig.strip_png(PREVIEW / f'anim-{cid}.png', list(groups.items()), zoom=4)
        p = portrait(rgb, poses, cid)
        (OUT / 'ui').mkdir(parents=True, exist_ok=True)
        Image.fromarray(p, 'RGBA').save(OUT / 'ui' / f'portrait-{cid}.png')
        ports.append((cid, p))
        rows.append((cid, list(fr.items())))
        print(f'{cid}: scale {scale:.2f}, {len(fr)} frames')
    PREVIEW.mkdir(parents=True, exist_ok=True)
    if args:
        return
    contact_sheet(rows, zoom=4, per_row=12).save(PREVIEW / 'characters.png')
    contact_sheet([('portraits', ports)], zoom=6).save(PREVIEW / 'portraits.png')


if __name__ == '__main__':
    main()
