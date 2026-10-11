#!/usr/bin/env python3
"""Validate character/enemy atlases and portraits against src/game/data/assets.ts.

Checks: required frame names/counts, one frame size per atlas (characters 48x48),
frames inside the image, hard alpha (0/255 only), transparent image corners and
transparent top corners of every frame, non-empty frames whose sprite touches the
bottom row (bottom-centre anchoring), 24x24 portraits.

Run: python3 tools/art/validate_atlases.py   (exit code 1 on failure)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
A = ROOT / 'public' / 'assets'
CHARS = ['dad', 'mom', 'brennan', 'parker', 'lupin', 'grandma']
sys.path.insert(0, str(Path(__file__).resolve().parent))
import costumes as _costumes  # noqa: E402
# costume atlases <id>-<costume> (tools/art/costumes.py) follow the same contract
COSTUME_KEYS = [f"{c}-{cs['id']}" for c in CHARS for cs in _costumes.costumes(c)]
CHAR_COUNTS = dict(idle=4, walk=6, run=6, jump=2, fall=2, land=2, crouch=2, attack=4, hurt=2, victory=6,
                   defeat=4, ability=4)
ENEMIES = ['pigeon', 'rat', 'raccoon', 'coneGuy', 'turnstileBot', 'securityDrone', 'windowWasher', 'gnat',
           'skirmisher', 'wasp', 'warlord', 'juggernaut', 'overseer', 'eliminator']
ENEMY_ANIMS = ['idle', 'move', 'attack', 'hit', 'die']
# frame-count range per enemy anim (looping cycles may use up to 8 frames)
ENEMY_COUNTS = dict(idle=(2, 8), move=(2, 8), attack=(2, 6), hit=(2, 4), die=(2, 6))

AIRBORNE_OK = {'victory', 'ability', 'die'}

errors: list[str] = []


def err(msg: str):
    errors.append(msg)


def check_atlas(path: Path, required: dict[str, tuple[int, int]], size: tuple[int, int] | None):
    """required: anim -> (min, max) frame count."""
    png, js = path.with_suffix('.png'), path.with_suffix('.json')
    if not png.exists() or not js.exists():
        err(f'{path.name}: missing png/json')
        return
    data = json.loads(js.read_text())
    img = np.asarray(Image.open(png).convert('RGBA'))
    H, W = img.shape[:2]
    alpha = np.unique(img[..., 3])
    if not set(alpha.tolist()) <= {0, 255}:
        err(f'{path.name}: soft alpha values present')
    for y, x in [(0, 0), (0, W - 1), (H - 1, 0), (H - 1, W - 1)]:
        if img[y, x, 3] != 0:
            err(f'{path.name}: image corner ({x},{y}) not transparent')
    frames = data['frames']
    sizes = {(f['frame']['w'], f['frame']['h']) for f in frames.values()}
    if len(sizes) != 1:
        err(f'{path.name}: multiple frame sizes {sizes}')
    if size and sizes != {size}:
        err(f'{path.name}: frame size {sizes} != {size}')
    groups: dict[str, list[int]] = {}
    for name, f in frames.items():
        anim, _, n = name.rpartition('_')
        if anim and n.isdigit():
            groups.setdefault(anim, []).append(int(n))
        r = f['frame']
        if r['x'] + r['w'] > W or r['y'] + r['h'] > H:
            err(f'{path.name}:{name} outside image')
            continue
        cell = img[r['y']:r['y'] + r['h'], r['x']:r['x'] + r['w'], 3]
        if not cell.any():
            err(f'{path.name}:{name} empty frame')
            continue
        if cell[0, 0] or cell[0, -1]:
            err(f'{path.name}:{name} top corners not transparent')
        # mid-air poses (victory hops, ground-pound rise) and dissolving death frames are
        # intentionally off the ground
        if not cell[-1].any() and anim not in AIRBORNE_OK:
            err(f'{path.name}:{name} sprite does not touch bottom row')
    for anim, (lo, hi) in required.items():
        ns = sorted(groups.get(anim, []))
        if not ns:
            err(f'{path.name}: missing anim {anim}')
        elif ns != list(range(len(ns))):
            err(f'{path.name}: {anim} frames not contiguous from 0: {ns}')
        elif not lo <= len(ns) <= hi:
            err(f'{path.name}: {anim} has {len(ns)} frames, expected {lo}-{hi}')
    return sizes


def main():
    for c in CHARS + COSTUME_KEYS:
        check_atlas(A / 'characters' / c, {k: (v, v) for k, v in CHAR_COUNTS.items()}, (48, 48))
        p = A / 'ui' / f'portrait-{c}.png'
        if not p.exists():
            err(f'missing {p}')
        else:
            im = np.asarray(Image.open(p).convert('RGBA'))
            if im.shape[:2] != (24, 24):
                err(f'{p.name}: size {im.shape[:2]}')
            if im[0, 0, 3] or im[0, -1, 3] or im[-1, 0, 3] or im[-1, -1, 3]:
                err(f'{p.name}: corners not transparent')
    for e in ENEMIES:
        # the "die" pose is allowed to sit off the ground only if it is a flyer; we anchor all.
        sizes = check_atlas(A / 'enemies' / e, ENEMY_COUNTS, None)
        print(f'  {e:14s} {sorted(sizes or [])}')
    if errors:
        print('FAIL')
        for e in errors:
            print(' -', e)
        sys.exit(1)
    print(f'OK: {len(CHARS)} characters, {len(COSTUME_KEYS)} costumes, {len(CHARS) + len(COSTUME_KEYS)} portraits, '
          f'{len(ENEMIES)} enemies')


if __name__ == '__main__':
    main()
