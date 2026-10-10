#!/usr/bin/env python3
"""Extract enemy atlases from the reference sheets.

Sources:
  art/reference/enemies-sheet.png          gnat, skirmisher, wasp, warlord, juggernaut, overseer,
                                           pigeon + rat (Chicago interactives row)
  art/reference/chicago-environment-sheet.png
                                           raccoon, coneGuy, turnstileBot, securityDrone,
                                           windowWasher, eliminator (boss "The El")

Each kind lists source boxes (sheet pixel coords) per pose. A box is cut out, the
background is flood-filled away, the figure (largest blob + attached parts) is kept,
everything is downscaled by ONE factor per kind, quantised, outlined, and then the
required animations are assembled (missing poses derived procedurally: squash/stretch,
lean, white hit-flash, red tint, tumble rotation, stomp-flatten, dissolve).

Outputs public/assets/enemies/<kind>.png/.json and art/previews/enemies.png.
Run: python3 tools/art/extract_enemies.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from artlib import (OUT, PREVIEW, components, contact_sheet, dilate, downscale, fg_mask, load,  # noqa: E402
                    outline, place, quantize_set, remove_specks, strip_lines, trim, write_atlas)

SHEETS = {'en': 'enemies-sheet.png', 'chi': 'chicago-environment-sheet.png'}
OUTLINE = (18, 14, 26)

# ---------------------------------------------------------------- source specs
# kind: sheet, frame (w,h), ref pose + target sprite height (sets the scale), tol,
#       poses {name: [ (x0,y0,x1,y1), ... ]}, erase [(box)], keep_gap
SPECS: dict[str, dict] = {
    'gnat': dict(sheet='en', frame=(24, 24), ref=('idle', 0), h=17, tol=24, poses={
        'idle': [(177, 76, 222, 119), (177, 129, 222, 175)],
        'move': [(239, 76, 282, 119), (305, 76, 353, 119), (243, 131, 286, 175), (304, 130, 355, 175)],
        'attack': [(368, 76, 420, 119), (424, 76, 477, 119), (370, 131, 422, 174)],
        'hit': [(495, 77, 538, 119), (554, 77, 599, 119)],
        'die': [(611, 134, 670, 176), (672, 134, 736, 176)],
    }),
    'skirmisher': dict(sheet='en', frame=(48, 48), ref=('idle', 0), h=34, tol=22, poses={
        'idle': [(905, 72, 966, 127), (904, 131, 966, 184)],
        'walk': [(978, 72, 1038, 128), (978, 131, 1038, 184)],
        'run': [(1045, 72, 1100, 127), (1047, 131, 1100, 184)],
        'ranged': [(1243, 72, 1301, 127), (1241, 131, 1301, 184)],
        'hit': [(1361, 72, 1431, 127), (1358, 131, 1429, 184)],
        'die': [(1437, 131, 1482, 184), (1439, 76, 1527, 130)],
    }, keep_gap=3),
    'wasp': dict(sheet='en', frame=(32, 24), ref=('idle', 0), h=21, tol=22, poses={
        'idle': [(168, 271, 224, 322), (168, 325, 223, 380)],
        'move': [(242, 273, 296, 323), (307, 270, 353, 317), (245, 328, 296, 380), (304, 325, 353, 376)],
        'attack': [(375, 270, 432, 318), (373, 324, 431, 376)],
        'hit': [(540, 268, 603, 318), (540, 329, 607, 379)],
        'die': [(686, 269, 734, 326)],
    }, keep_gap=2),
    'warlord': dict(sheet='en', frame=(56, 56), ref=('idle', 0), h=48, tol=22, poses={
        'idle': [(931, 266, 996, 330), (941, 330, 996, 382)],
        'walk': [(1008, 266, 1080, 330), (1008, 330, 1080, 382)],
        'slash': [(1092, 266, 1166, 330), (1092, 330, 1166, 382)],
        'proj': [(1224, 266, 1292, 330), (1224, 330, 1290, 382)],
        'hit': [(1359, 266, 1434, 330), (1359, 330, 1434, 382)],
        'die': [(1438, 266, 1530, 330), (1438, 330, 1530, 382)],
    }, keep_gap=3),
    'juggernaut': dict(sheet='en', frame=(72, 72), ref=('idle', 0), h=56, tol=22, poses={
        'idle': [(210, 462, 288, 533), (210, 533, 288, 597)],
        'walk': [(292, 462, 386, 533), (292, 533, 386, 597)],
        'ranged': [(507, 462, 592, 536)],
        'hit': [(624, 462, 694, 533), (624, 533, 694, 597)],
        'die': [(696, 462, 798, 533), (696, 533, 798, 597)],
    }, keep_gap=3),
    'overseer': dict(sheet='en', frame=(80, 96), ref=('idle', 0), h=92, tol=22, poses={
        'idle': [(964, 462, 1052, 592)],
    }, keep_gap=6),
    'pigeon': dict(sheet='en', frame=(24, 24), ref=('idle', 0), h=20, tol=26, poses={
        'idle': [(10, 828, 60, 878), (58, 834, 107, 878), (110, 827, 169, 878)],
        'fly': [(170, 812, 231, 864)],
    }),
    'rat': dict(sheet='en', frame=(32, 20), ref=('idle', 0), h=16, tol=26, poses={
        'idle': [(244, 828, 310, 875), (306, 827, 379, 875)],
        'leap': [(377, 812, 450, 870)],
    }),
    'raccoon': dict(sheet='chi', frame=(40, 28), ref=('idle', 0), h=26, w=38, tol=26, poses={
        'idle': [(103, 757, 225, 839)],
    }),
    'coneGuy': dict(sheet='chi', frame=(24, 32), ref=('idle', 0), h=28, tol=26, poses={
        'idle': [(229, 756, 301, 839)],
    }),
    'turnstileBot': dict(sheet='chi', frame=(32, 32), ref=('idle', 0), h=30, tol=26, poses={
        'idle': [(422, 745, 512, 839)],
    }, keep_gap=10),
    'securityDrone': dict(sheet='chi', frame=(32, 24), ref=('idle', 0), h=20, tol=26, poses={
        'idle': [(781, 743, 893, 815)],
    }, keep_gap=4),
    'windowWasher': dict(sheet='chi', frame=(32, 40), ref=('idle', 0), h=38, tol=26, poses={
        'idle': [(662, 743, 776, 831)],
    }, erase=[(745, 755, 782, 790)], keep_gap=4),
    'eliminator': dict(sheet='chi', frame=(128, 112), ref=('idle', 0), h=74, tol=26, poses={
        'idle': [(905, 720, 1168, 880)],
    }, erase=[(998, 840, 1112, 878)], keep_gap=10),
}


FRAME_SIZES: dict[str, tuple[int, int]] = {}

# ---------------------------------------------------------------- extraction
def cut(rgb: np.ndarray, box, tol: float, erase=(), keep_gap: int = 6):
    x0, y0, x1, y1 = box
    pad = 4
    H, W = rgb.shape[:2]
    X0, Y0, X1, Y1 = max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad), min(H, y1 + pad)
    reg = rgb[Y0:Y1, X0:X1]
    m = fg_mask(reg, tol=tol)
    inside = np.zeros_like(m)
    inside[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0] = True
    m &= inside
    for ex0, ey0, ex1, ey1 in erase:
        m[max(0, ey0 - Y0):max(0, ey1 - Y0), max(0, ex0 - X0):max(0, ex1 - X0)] = False
    lab, comps = components(m)
    if not comps:
        raise SystemExit(f'empty box {box}')
    big = max(comps, key=lambda c: c['area'])
    keep = np.zeros_like(m)
    keep |= lab == big['id']
    # attach parts that touch (within keep_gap) the main blob
    grown = dilate(keep, keep_gap)
    for c in comps:
        if c is big or c['area'] < 6:
            continue
        cm = lab == c['id']
        if (cm & grown).any():
            keep |= cm
    return reg, keep


def scale_for(mask: np.ndarray, h: int) -> float:
    ys = np.nonzero(mask)[0]
    return (ys.max() - ys.min() + 1) / h


# ---------------------------------------------------------------- sprite ops
def squash(sp, rows=1, at=0.55):
    out = sp
    for _ in range(rows):
        out = np.delete(out, int(out.shape[0] * at), axis=0)
    return out


def stretch(sp, rows=1, at=0.55):
    out = sp
    for _ in range(rows):
        r = int(out.shape[0] * at)
        out = np.insert(out, r, out[r], axis=0)
    return out


def shear(sp, amount=2):
    """Lean: positive = top shifted right (forward)."""
    h, w = sp.shape[:2]
    a = abs(amount)
    out = np.zeros((h, w + a, 4), np.uint8)
    for y in range(h):
        t = 1 - y / max(1, h - 1)
        dx = int(round(a * t))
        if amount < 0:
            dx = a - dx
        out[y, dx:dx + w] = sp[y]
    return trim(out)


def sway(sp, amount=1, start=0.5):
    """Shift the rows below `start` sideways (tentacles / dangling parts)."""
    h, w = sp.shape[:2]
    out = np.zeros((h, w + 2 * abs(amount), 4), np.uint8)
    for y in range(h):
        dx = abs(amount) + (amount if y >= h * start else 0)
        out[y, dx:dx + w] = sp[y]
    return trim(out)


def flash(sp, k=0.75):
    out = sp.copy()
    m = out[..., 3] > 0
    out[m, :3] = (out[m, :3] * (1 - k) + 255 * k).astype(np.uint8)
    return out


def tint(sp, c=(255, 60, 60), k=0.45):
    out = sp.copy()
    m = out[..., 3] > 0
    out[m, :3] = (out[m, :3] * (1 - k) + np.array(c) * k).astype(np.uint8)
    return out


def rotate(sp, deg):
    im = Image.fromarray(sp, 'RGBA').rotate(deg, resample=Image.NEAREST, expand=True)
    return trim(np.asarray(im).copy())


def flatten(sp, f=0.5):
    h, w = sp.shape[:2]
    nh = max(2, int(round(h * f)))
    nw = w + 2
    im = Image.fromarray(sp, 'RGBA').resize((nw, nh), Image.NEAREST)
    return np.asarray(im).copy()


def dissolve(sp, p, seed=7):
    rng = np.random.default_rng(seed)
    out = sp.copy()
    h, w = out.shape[:2]
    # 2x2 blocks vanish together so it reads as chunky pixels
    blk = rng.random(((h + 1) // 2, (w + 1) // 2)) < p
    blk = np.kron(blk, np.ones((2, 2), bool))[:h, :w]
    out[blk] = 0
    return out


def extend_arm(sp, n=4, col=0.76, row_arm=0.47, claw_col=0.86, claw_row=0.62):
    """Telescoping arm (boss punch): the right arm (x >= col, y < row_arm) and the claw
    (x >= claw_col, y < claw_row) slide right by n px; the gap is filled by repeating
    the forearm column at `col`."""
    h, w = sp.shape[:2]
    c, ra, cc, rc = int(w * col), int(h * row_arm), int(w * claw_col), int(h * claw_row)
    arm = np.zeros((h, w), bool)
    arm[:ra, c:] = True
    arm[:rc, cc:] = True
    arm &= sp[..., 3] > 0
    out = np.zeros((h, w + n, 4), np.uint8)
    body = sp.copy()
    body[arm] = 0
    out[:, :w] = body
    for k in range(n):  # forearm filler
        colpx = sp[:ra, c]
        m = colpx[..., 3] > 0
        out[:ra, c + k][m] = colpx[m]
    moved = np.zeros_like(out)
    moved[:, n:n + w][arm] = sp[arm]
    m = moved[..., 3] > 0
    out[m] = moved[m]
    return trim(out)


# ---------------------------------------------------------------- assembly
def build(kind: str, S: dict[str, list[np.ndarray]]) -> dict[str, list]:
    """Return {anim: [sprite | (sprite, dx, dy)]}."""
    I = S['idle']
    base = I[0]
    hitfx = lambda s: [flash(s), (tint(s), -1, 0)]  # noqa: E731
    if kind == 'gnat':
        M, A, H, D = S['move'], S['attack'], S['hit'], S['die']
        return dict(idle=[I[0], I[1], I[0], M[2]], move=M, attack=[A[1], A[2], A[1]],
                    hit=[flash(H[0]), H[1]], die=[tint(H[0]), rotate(H[1], -30), D[0], D[1]])
    if kind == 'skirmisher':
        W, R, A, H, D = S['walk'], S['run'], S['ranged'], S['hit'], S['die']
        return dict(idle=[I[0], I[1], I[0], squash(I[1])], move=[W[0], R[0], W[1], R[1]],
                    attack=[A[0], A[1], A[1]], hit=[flash(H[0]), H[1]],
                    die=[H[1], tint(H[1]), D[1], dissolve(D[1], 0.5)])
    if kind == 'wasp':
        M, A, H, D = S['move'], S['attack'], S['hit'], S['die']
        return dict(idle=[I[0], I[1]], move=M, attack=[A[0], A[1], A[0]], hit=[flash(H[0]), H[1]],
                    die=[tint(H[1]), rotate(H[1], -25), D[0], dissolve(D[0], 0.5)])
    if kind == 'warlord':
        W, SL, P, H, D = S['walk'], S['slash'], S['proj'], S['hit'], S['die']
        return dict(idle=[I[0], I[1], I[0], squash(I[1])], move=[W[0], W[1], W[0], W[1]],
                    attack=[P[0], SL[0], SL[1], P[1]], hit=[flash(H[0]), H[1]],
                    die=[H[1], D[0], dissolve(D[0], 0.4), dissolve(D[0], 0.75)])
    if kind == 'juggernaut':
        W, R, H, D = S['walk'], S['ranged'], S['hit'], S['die']
        return dict(idle=[I[0], squash(I[0]), I[0], I[1]], move=[W[0], W[1], W[0], W[1]],
                    attack=[squash(I[0], 2), R[0], R[0], I[0]], hit=[flash(H[0]), H[1]], die=[H[1], D[0], D[1], dissolve(D[1], 0.5)])
    if kind == 'overseer':
        return dict(idle=[base, sway(base, 1, 0.55), base, sway(base, -1, 0.55)],
                    move=[sway(base, 1, 0.5), sway(base, 2, 0.5), sway(base, 1, 0.5), base],
                    attack=[base, tint(base, (255, 40, 40), 0.25), tint(base, (255, 40, 40), 0.45), base],
                    hit=hitfx(base), die=[flash(base), tint(base, k=0.6), dissolve(tint(base, k=0.6), 0.45),
                                          dissolve(tint(base, k=0.6), 0.8)])
    if kind == 'pigeon':
        F = S['fly'][0]
        return dict(idle=[I[0], I[1], I[0], I[2]], move=[I[0], I[2], I[1], I[2]], attack=[I[2], F, F],
                    hit=hitfx(I[0]), die=[flash(I[0]), rotate(I[0], 180), flatten(I[0], 0.5)])
    if kind == 'rat':
        L = S['leap'][0]
        return dict(idle=[I[0], squash(I[0])], move=[I[0], I[1], I[0], I[1]], attack=[squash(I[1]), L, L],
                    hit=hitfx(I[0]), die=[flash(I[0]), flatten(I[0], 0.6), flatten(I[0], 0.4)])
    if kind in ('raccoon', 'coneGuy', 'turnstileBot'):
        mv = [shear(base, 1), base, shear(base, -1), squash(base)]
        atk = [squash(base, 2), (shear(base, 2), 1, 0), (shear(base, 2), 2, 0)]
        return dict(idle=[base, squash(base)], move=mv, attack=atk, hit=hitfx(base),
                    die=[flash(base), flatten(base, 0.7), flatten(base, 0.45), flatten(base, 0.3)])
    if kind in ('securityDrone', 'windowWasher'):
        return dict(idle=[base, sway(base, 1, 0.6)], move=[base, sway(base, 1, 0.6), base, sway(base, -1, 0.6)],
                    attack=[squash(base), (shear(base, 1), 1, 0), (shear(base, 1), 2, 0)], hit=hitfx(base),
                    die=[flash(base), tint(base, k=0.55), dissolve(tint(base, k=0.55), 0.4),
                         dissolve(tint(base, k=0.55), 0.75)])
    if kind == 'eliminator':
        return dict(idle=[base, squash(base, 1), base, stretch(base, 1)],
                    move=[shear(base, 2), base, shear(base, -2), base],
                    attack=[squash(base, 2), extend_arm(base, n=4), extend_arm(base, n=8), extend_arm(base, n=4)],
                    hit=hitfx(base), die=[flash(base), tint(base, k=0.5), dissolve(tint(base, k=0.5), 0.4),
                                          dissolve(tint(base, k=0.5), 0.75)])
    raise KeyError(kind)


def process(kind: str, sheets: dict[str, np.ndarray]):
    sp = SPECS[kind]
    rgb = sheets[sp['sheet']]
    cuts = {p: [cut(rgb, b, sp['tol'], sp.get('erase', ()), sp.get('keep_gap', 6)) for b in boxes]
            for p, boxes in sp['poses'].items()}
    rp, ri = sp['ref']
    scale = scale_for(cuts[rp][ri][1], sp['h'])
    if 'w' in sp:
        xs = np.nonzero(cuts[rp][ri][1])[1]
        scale = max(scale, (xs.max() - xs.min() + 1) / sp['w'])
    small = {}
    for p, lst in cuts.items():
        small[p] = [trim(remove_specks(downscale(reg, m, scale, cover=0.5), 3)) for reg, m in lst]
    names = [(p, i) for p in small for i in range(len(small[p]))]
    q = quantize_set([small[p][i] for p, i in names], colors=32)
    for (p, i), f in zip(names, q):
        small[p][i] = trim(outline(f, color=OUTLINE, thresh=55))
    anims = build(kind, small)
    fw, fh = sp['frame']
    # grow the frame (in steps of 4px) if any pose does not fit the suggested size
    for lst in anims.values():
        for s in lst:
            s, dx, dy = s if isinstance(s, tuple) else (s, 0, 0)
            need_w = s.shape[1] + 2 * abs(dx)
            if need_w > fw:
                fw = int(np.ceil(need_w / 4) * 4)
            if s.shape[0] - dy > fh:
                fh = int(np.ceil((s.shape[0] - dy) / 4) * 4)
    if (fw, fh) != sp['frame']:
        print(f'  ! {kind}: frame grown {sp["frame"]} -> {(fw, fh)}')
    FRAME_SIZES[kind] = (fw, fh)
    frames = {}
    for anim, lst in anims.items():
        for k, s in enumerate(lst):
            s, dx, dy = s if isinstance(s, tuple) else (s, 0, 0)
            frames[f'{anim}_{k}'] = place(s, fw, fh, dx, dy)
    return frames, scale


# Atlases drawn facing LEFT (Enemy reads `artFacesLeft` from EnemyConfig). The boss is
# mirrored so it can face the player without its chest "CTA" plate reading backwards.
FACES_LEFT = {'eliminator'}
PLATE_COLORS = np.array([[0x25, 0x38, 0x5e], [0x18, 0x2b, 0x55]])


def plate_bbox(frame: np.ndarray):
    """Bounding box (x0, x1, y0, y1) of the navy CTA plate in a frame, or None."""
    rgb = frame[..., :3].astype(int)
    mask = (frame[..., 3] > 0) & np.any(np.all(np.abs(rgb[:, :, None, :] - PLATE_COLORS[None, None]) <= 6, axis=-1), axis=-1)
    ys, xs = np.nonzero(mask)
    if len(xs) < 40:
        return None
    cx, cy = int(np.median(xs)), int(np.median(ys))
    sel = (np.abs(xs - cx) <= 12) & (np.abs(ys - cy) <= 6)
    return xs[sel].min(), xs[sel].max(), ys[sel].min(), ys[sel].max()


def face_left_keep_label(frames: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """Mirror every frame horizontally, then un-mirror the CTA plate so its text reads.
    Tinted/flashed frames (plate colour changed) reuse the plate box of idle_0."""
    fallback = plate_bbox(frames['idle_0'][:, ::-1])
    out = {}
    for name, frame in frames.items():
        m = frame[:, ::-1].copy()
        box = plate_bbox(m) or (fallback if not name.startswith('die_') or name in ('die_0', 'die_1') else None)
        if box:
            x0, x1, y0, y1 = box
            m[y0:y1 + 1, x0:x1 + 1] = m[y0:y1 + 1, x0:x1 + 1][:, ::-1].copy()
        out[name] = m
    return out


def main():
    sheets = {k: load(v) for k, v in SHEETS.items()}
    only = sys.argv[1:]
    rows = []
    for kind in SPECS:
        if only and kind not in only:
            continue
        frames, scale = process(kind, sheets)
        if kind in FACES_LEFT:
            frames = face_left_keep_label(frames)
        write_atlas(OUT / 'enemies' / kind, frames)
        rows.append((kind, list(frames.items())))
        print(f'{kind}: scale {scale:.2f}, {len(frames)} frames {SPECS[kind]["frame"]}')
    if not only:
        PREVIEW.mkdir(parents=True, exist_ok=True)
        contact_sheet(rows, zoom=4, per_row=8).save(PREVIEW / 'enemies.png')
    else:
        contact_sheet(rows, zoom=4, per_row=8).save(PREVIEW / 'enemies-partial.png')


if __name__ == '__main__':
    main()
