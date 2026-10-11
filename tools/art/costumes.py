"""Costume variants for the playable characters (the POWER-UPS column of
art/reference/family-characters-sheet.png), rendered as full animation atlases by the
same part rig as the base characters (animate_characters.Human / animate_dog.Dog).

A costume is applied to the rig *before* posing, so every frame of every animation
gets it consistently (no per-frame overlays that could drift or tear):

* palette swap of the rig limbs: sleeves, trouser / shorts bands, shoes;
* torso recolour: torso pixels are classified as shirt / trousers / skin against the
  base palette and remapped to the costume ramps (same tone index), then `paint`
  rectangles add straps, aprons, belts and badges;
* head: `hood` recolours the hair (+1px growth) into a hood, `hat` pastes a small
  hand-authored pixel sprite anchored to the head's bounding box (hats, crowns, ears,
  headbands); head and torso sprites are padded so hats may rise above the head;
* `back`: cape / tail drawn behind the body each frame from the rig's hip and shoulder;
* `item`: a prop held in the near hand (wand, sword, spatula, flowers, fireball);
* Lupin (dog rig): `cape`, bee stripes + antennae + wings, firefighter helmet + coat.

Atlases: public/assets/characters/<id>-<costume>.png/.json (same frame names, sizes
and meta as the base atlas). Ids/names here must match src/game/data/costumes.ts.
"""
from __future__ import annotations

import math

import numpy as np

OUT = (22, 16, 30)

# hair colours per base character (hex, as extracted) — used by hoods
HAIR = {
    'dad': ['432c24', '6d4637', '876357', '2b1717', '622b1f', '130f14'],
    'mom': ['ab5c2e', 'b56e31', 'd07043', '894f20', '542715', '280c15', 'cd8e65'],
    'brennan': ['9c5b25', 'a66731', 'bf6e3f', '8e4e1c', '75221b', '4b201a', '341818', '1d0f11'],
    'parker': ['fad456', 'fbe064', 'fce787', 'f9c768', 'd28e4c'],
    'grandma': ['f2f0ea', 'ebe6de', 'ded9d0', 'c5c1bc', 'a99d94', 'd8c7b7'],
}


def hx(h: str):
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def ramp(main, light, shade, dark):
    return tuple(hx(c) if isinstance(c, str) else c for c in (main, light, shade, dark))


# ---------------------------------------------------------------- shared ramps
BROWN = ramp('9a5a2c', 'c58448', '74401f', '4e2a16')
BROWN_LT = ramp('d9a56a', 'efc58e', 'b9834c', '8a5a30')
RED = ramp('d2382e', 'f06a50', 'a02424', '6e1820')
JEANS = ramp('2f62b8', '4f86d6', '22489a', '173468')
NAVY = ramp('24418c', '3a5fb4', '1a2f68', '111f48')
YELLOW = ramp('f2c230', 'ffe27a', 'cf9420', '9a6a18')
WHITE = ramp('eeeef2', 'ffffff', 'c8c8d6', '9a9aae')
PINK = ramp('e868c0', 'f6a0dc', 'c0449c', '8a2c70')
PINK_LT = ramp('f4a6c8', 'ffd0e4', 'e07aa8', 'b05080')
GREEN = ramp('3fa34a', '6ccc60', '2c7a38', '1c5228')
GREEN_DK = ramp('2f8a3c', '4fae4c', '226a2e', '164a22')
BOOT = ramp('6e4026', '96603a', '4e2c1a', '361e14')
BLUE = ramp('2e63d8', '5a8af0', '2248a8', '183478')
GOLD = ramp('f2c230', 'fff0a0', 'c89020', '8a6018')
SKY = ramp('8ccbf0', 'c4e6fa', '5ea6d6', '3a7aa8')
PURPLE = ramp('8e5ad6', 'b48cf0', '6a40ac', '4a2c80')
BLACK = ramp('3a3a42', '585864', '2a2a32', '1c1c24')
SKIN = None  # sentinel: keep the character's skin

# ---------------------------------------------------------------- hats (pixel sprites)
# k = outline; other letters per-hat palette. Anchor: (dx, dy) of the sprite's top-left
# relative to the head bbox (x centre, top row): x = cx + dx, y = top + dy.
HATS = {
    'hardhat': dict(rows=[
        '......kkkkkkk......',
        '....kkYYYYWYYkk....',
        '...kYYYYYYYWYYYk...',
        '..kYYYYYYYYYWYYYk..',
        '..kyyyyyyyyyyyyyk..',
        '.kkkkkkkkkkkkkkkkkk',
        '..kYYYYYYYYYYYYYYYYk',
        '...kkkkkkkkkkkkkkkk.',
    ], pal=dict(Y=hx('f2c230'), y=hx('cf9420'), W=hx('fff3b0')), at=(-9, -5)),
    'raccoon_ears': dict(rows=[
        '..kk.......kk..',
        '.kBBk.....kBBk.',
        '.kBdBk...kBdBk.',
        'kBBddBkkkBddBBk',
    ], pal=dict(B=hx('9a5a2c'), d=hx('4e2a16')), at=(-7, -3)),
    'cat_ears': dict(rows=[
        '.kk.........kk.',
        'kWWk.......kWWk',
        'kWpWk.....kWpWk',
        'kWppWkkkkkWppWk',
    ], pal=dict(W=hx('f4f4f8'), p=hx('f4a6c8')), at=(-7, -3)),
    'chef': dict(rows=[
        '...kkk.kkkk...',
        '..kWWWkWWWWk..',
        '.kWWWWWWWWWWk.',
        '.kWWWWWWWWwWk.',
        '.kWWWWWWWWWWk.',
        '..kWWWWWWWwk..',
        '..kwWWWWWWwk..',
        '..kWWWWWWWWk..',
        '..kkkkkkkkkk..',
    ], pal=dict(W=hx('f8f8fc'), w=hx('c8c8d8')), at=(-6, -7)),
    'elf': dict(rows=[
        '.......kkkkkkk....',
        '.....kkGGGGGGGkk..',
        '....kGGGgGGGGGGGk.',
        '...kGGGGGGGGGGGGGk',
        '..kGGGkkkkkkkkkkkk',
        '.kGGk.............',
        'kGGk..............',
        'kGk...............',
        'kk................',
    ], pal=dict(G=hx('3fa34a'), g=hx('7cd46a')), at=(-10, -4)),
    'cap': dict(rows=[
        '....kkkkkkkk.....',
        '..kkBBBBBBBBkk...',
        '.kBBBBBBBRBBBBk..',
        '.kBBBBBRBRBRBBk..',
        '.kBBBBBBRRRBBBk..',
        '.kBBBBBRBRBRBBk..',
        '.kBBBBBBBRBBBBk..',
        '.kbbbbbbbbbbbbkkk',
        '..kkkkkkkkkkBBBBk',
        '............kkkk.',
    ], pal=dict(B=hx('6cb8ec'), b=hx('3a86c4'), R=hx('e0303a')), at=(-8, -6)),
    'propeller': dict(rows=[
        '.kkkkkk.kkkkkk..',
        '.kYYYYYkYYYYYk..',
        '..kkkkkkkkkkk...',
        '.......kYk......',
        '....kkkkkkkk....',
        '..kkRRBBBYYRkk..',
        '.kRRRBBBBYYYRRk.',
        '.kRRRBBBBYYYRRk.',
        '.kyyyyyyyyyyyyk.',
        '..kkkkkkkkkkkk..',
    ], pal=dict(Y=hx('f2c230'), y=hx('f2c230'), R=hx('d2382e'), B=hx('2e63d8')), at=(-8, -8)),
    'crown': dict(rows=[
        'k..k..k..k',
        'Yk.kYk.kYk',
        'YYkYYYkYYk',
        'kYYrYYbYYk',
        'kkkkkkkkkk',
    ], pal=dict(Y=hx('f2c230'), r=hx('e0303a'), b=hx('3a86e0')), at=(-5, -3)),
    'straw': dict(rows=[
        '.......kkkkkkk.......',
        '......kSSSSSSSk......',
        '.....kSSSsSSSSSk.....',
        '.....kRRRRRRRRRk.....',
        '..kkkSSSSSSSSSSSkkk..',
        '.kSSSSSSSSSSSSSSSSSk.',
        'kssssssssssssssssssssk',
        '.kkkkkkkkkkkkkkkkkkkk.',
    ], pal=dict(S=hx('f0c860'), s=hx('d0a040'), R=hx('d2382e')), at=(-11, -6)),
    'dino': dict(rows=[
        '..........kkk...',
        '....kkkkkkWWWk..',
        '...kGGGGGkWkWk..',
        '..kGGGGGGGkWWkk.',
        '.kGGrGGGGGGkkGGk',
        '.kGrrGGGGGGGGGGk',
        '.kGGGGGGGGGGGGgk',
        '..kkkkkkkkkkkkk.',
    ], pal=dict(G=hx('3fa34a'), g=hx('2c7a38'), W=hx('ffffff'), r=hx('e0303a')), at=(-8, -6)),
}
# headbands are painted over existing head pixels only (no sprite)
BANDS = {
    'sporty': dict(rows=(4, 5), cols=None, colours=[hx('f4a6c8'), hx('ffffff')]),
}

# ---------------------------------------------------------------- costume table
# shirt/sleeve ramps replace the base 'sleeve' role, legs the 'leg' bands (list of
# (t_end, ramp)), torso_legs the trouser colour inside the torso box (pelvis).
C = {}
C['dad'] = [
    dict(id='flame', name='Flame Tee', shirt=RED, legs=[(1.01, JEANS)], item=('fireball', 'attack'),
         paint=[('rect', 3, 3, 4, 4, hx('f6d24a'))]),
    dict(id='raccoon', name='Raccoon Suit', shirt=BROWN, legs=[(1.01, BROWN)], shoe=BOOT,
         hood=BROWN, hat='raccoon_ears', back=dict(kind='tail', style='raccoon'),
         paint=[('rect', 2, 6, 5, 11, BROWN_LT[0]), ('rect', 3, 7, 4, 7, BROWN_LT[1])]),
    dict(id='hardhat', name='Hard Hat', shirt=YELLOW, legs=[(1.01, JEANS)], shoe=BOOT, hat='hardhat',
         paint=[('rect', 1, 3, 1, 12, NAVY[0]), ('rect', 6, 3, 6, 12, NAVY[0]), ('rect', 1, 7, 6, 13, NAVY[0]),
                ('rect', 2, 8, 5, 8, NAVY[1]), ('px', 1, 4, hx('f2c230')), ('px', 6, 4, hx('f2c230'))]),
]
C['mom'] = [
    dict(id='wand', name='Star Wand', shirt=ramp('b04ae8', 'd28af6', '8a30c0', '5e2090'), item=('wand', 'always'),
         paint=[('px', 4, 3, hx('fff0a0'))]),
    dict(id='cat', name='Kitty Suit', shirt=PINK, legs=[(1.01, PINK)], shoe=ramp('f4f4f8', 'ffffff', 'd0d0de', '9a9aae'),
         sole=hx('f4a6c8'), hood=ramp('f4f4f8', 'ffffff', 'd8d8e4', 'b0b0c4'), hood_max_y=8, hat='cat_ears',
         back=dict(kind='tail', style='cat'),
         paint=[('rect', 2, 3, 6, 9, hx('f4f4f8')), ('px', 4, 5, hx('e868c0')), ('px', 4, 7, hx('e868c0'))]),
    dict(id='chef', name='Chef Mom', shirt=ramp('f0f0f4', 'ffffff', 'c8c8d8', '9a9aae'), sleeve_t=0.3, hat='chef',
         item=('spatula', 'always'),
         paint=[('rect', 2, 4, 6, 11, hx('ffffff')), ('rect', 2, 4, 6, 4, hx('e868c0')), ('px', 4, 7, hx('e868c0'))]),
]
C['brennan'] = [
    dict(id='knight', name='Super Knight', shirt=BLUE, legs=[(0.55, BLUE), (1.01, ramp('2a2a6a', '3c3c8a', '1e1e50', '141438'))],
         shoe=ramp('f4f4f8', 'ffffff', 'd0d0de', '9a9aae'), sole=hx('e0303a'), item=('sword', 'always'),
         back=dict(kind='cape', col=RED),
         paint=[('rect', 0, 7, 8, 7, hx('f2c230')), ('px', 4, 3, hx('f2c230')), ('px', 4, 4, hx('cf9420'))]),
    dict(id='raccoon', name='Raccoon Suit', shirt=BROWN, legs=[(1.01, BROWN)], shoe=BOOT,
         hood=BROWN, hat='raccoon_ears', back=dict(kind='tail', style='raccoon'),
         paint=[('rect', 2, 4, 6, 8, BROWN_LT[0])]),
    dict(id='elf', name='Forest Elf', shirt=GREEN, legs=[(0.55, GREEN_DK), (1.01, ramp('e8d4a8', 'f6e6c0', 'c8b080', 'a08860'))],
         shoe=BOOT, sole=hx('361e14'), hat='elf',
         paint=[('rect', 0, 7, 8, 7, hx('6e4026')), ('px', 4, 7, hx('f2c230')), ('px', 6, 2, hx('6e4026')),
                ('px', 5, 3, hx('6e4026')), ('px', 4, 4, hx('6e4026')), ('px', 3, 5, hx('6e4026'))]),
]
C['parker'] = [
    dict(id='cap', name='Chicago Cap', shirt=RED, legs=[(0.55, NAVY), (0.86, NAVY), (1.01, ramp('f0ece0', 'fffff6', 'd6cdad', '968c78'))],
         shoe=ramp('8a3a26', 'b0563a', '642a1c', '461c14'), sole=hx('361e14'), hat='cap',
         paint=[('rect', 1, 3, 1, 8, NAVY[0]), ('rect', 6, 3, 6, 8, NAVY[0]), ('rect', 1, 5, 6, 8, NAVY[0]),
                ('px', 1, 5, hx('f2c230')), ('px', 6, 5, hx('f2c230'))]),
    dict(id='dino', name='Dino Suit', shirt=GREEN, legs=[(1.01, GREEN)], shoe=ramp('f08a30', 'f8b060', 'c8641c', '8a4414'),
         sole=hx('8a4414'), hood=GREEN, hat='dino', back=dict(kind='tail', style='dino'),
         paint=[('rect', 2, 3, 5, 8, hx('f4f4f0')), ('px', 3, 4, hx('ffffff'))]),
    dict(id='propeller', name='Propeller Beanie', hat='propeller'),
]
C['grandma'] = [
    dict(id='princess', name='Princess', shirt=PINK_LT, legs=[(1.01, PINK_LT)], shoe=PINK, hat='crown',
         skirt=dict(col=PINK_LT, trim=hx('ffffff')),
         paint=[('rect', 2, 2, 5, 2, hx('f2c230')), ('px', 4, 3, hx('e0303a'))]),
    dict(id='sporty', name='Sporty Gran', shirt=PURPLE, sleeve_t=0.2,
         legs=[(0.5, BLACK), (1.01, None)], shoe=PINK, band='sporty',
         paint=[('rect', 1, 1, 6, 1, hx('ffffff'))]),
    dict(id='gardener', name='Green Thumb', shirt=ramp('e8607a', 'f4909e', 'c04058', '8a2c40'), legs=[(1.01, GREEN_DK)],
         shoe=BOOT, sole=hx('361e14'), hat='straw', item=('flowers', 'always'),
         paint=[('rect', 1, 2, 1, 9, GREEN_DK[0]), ('rect', 6, 2, 6, 9, GREEN_DK[0]), ('rect', 1, 6, 6, 12, GREEN_DK[0]),
                ('px', 1, 3, hx('f2c230')), ('px', 6, 3, hx('f2c230'))]),
]
C['lupin'] = [
    dict(id='cape', name='Super Pup', dog='cape'),
    dict(id='bee', name='Bumble Pup', dog='bee'),
    dict(id='firefighter', name='Fire Pup', dog='firefighter'),
]


def costumes(cid: str) -> list[dict]:
    return C.get(cid, [])


# ---------------------------------------------------------------- sprite helpers
def _pad(sp: np.ndarray, px: int, py: int) -> np.ndarray:
    h, w = sp.shape[:2]
    out = np.zeros((h + py, w + 2 * px, 4), np.uint8)
    out[py:, px:px + w] = sp
    return out


def _bbox(sp: np.ndarray):
    ys, xs = np.nonzero(sp[..., 3] > 0)
    return xs.min(), ys.min(), xs.max(), ys.max()


def _lum(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def _stamp(sp: np.ndarray, rows: list[str], pal: dict, x0: int, y0: int):
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch == '.':
                continue
            y, x = y0 + j, x0 + i
            if 0 <= y < sp.shape[0] and 0 <= x < sp.shape[1]:
                sp[y, x, :3] = OUT if ch == 'k' else pal[ch]
                sp[y, x, 3] = 255


def _remap(sp: np.ndarray, roles: list[tuple[tuple, tuple | None]], mask=None, max_d=70.0):
    """Remap pixels: each role = (base ramp, target ramp); a pixel takes the target colour
    at the tone index of its nearest base colour (if within max_d)."""
    out = sp.copy()
    h, w = sp.shape[:2]
    for y in range(h):
        for x in range(w):
            if not sp[y, x, 3] or (mask is not None and not mask(x, y)):
                continue
            c = sp[y, x, :3].astype(np.int32)
            if _lum(c) < 28:  # outline / deep shadow pixels stay
                continue
            best = None
            for k, (base, tgt) in enumerate(roles):
                for i, b in enumerate(base):
                    d = float(np.sqrt(((c - np.array(b)) ** 2).sum()))
                    if best is None or d < best[0]:
                        best = (d, k, i)
            if best and best[0] <= max_d:
                tgt = roles[best[1]][1]
                if tgt is not None:
                    out[y, x, :3] = tgt[best[2]]
    return out


def _paint(sp: np.ndarray, ops, ox: int, oy: int):
    """Paint rectangles / pixels (torso-box coordinates) over existing, non-outline pixels."""
    for op in ops:
        if op[0] == 'rect':
            _, x0, y0, x1, y1, col = op
        else:
            _, x0, y0, col = op
            x1, y1 = x0, y0
        for y in range(oy + y0, oy + y1 + 1):
            for x in range(ox + x0, ox + x1 + 1):
                if 0 <= y < sp.shape[0] and 0 <= x < sp.shape[1] and sp[y, x, 3] and _lum(sp[y, x, :3]) >= 40:
                    sp[y, x, :3] = col


# ---------------------------------------------------------------- human costumes
PADX, PADY = 8, 10


def apply_human(rig, cs: dict):
    c = rig.c
    base = dict(rig.pal)
    pal = dict(rig.pal)
    if cs.get('shirt'):
        pal['sleeve'] = cs['shirt']
    if cs.get('legs'):
        # None = bare skin (shorts)
        pal['leg'] = [(t, r if r is not None else base['skin']) for t, r in cs['legs']]
    if cs.get('shoe'):
        pal['shoe'] = cs['shoe']
    if cs.get('sole'):
        pal['sole'] = cs['sole']
    rig.pal = pal
    if 'sleeve_t' in cs:
        a = list(c['arm'])
        a[4] = cs['sleeve_t']
        c['arm'] = tuple(a)
    # -- torso recolour (shirt above the hips, trousers at / below them)
    hip_y = c['hip'][2]
    roles_up = [(base['sleeve'], pal['sleeve']), (base['leg'][0][1], pal['sleeve'])]
    roles_lo = [(base['sleeve'], pal['leg'][0][1]), (base['leg'][0][1], pal['leg'][0][1])]
    torso = _remap(rig.torso, roles_up, mask=lambda x, y: y < hip_y - 2, max_d=60)
    torso = _remap(torso, roles_lo, mask=lambda x, y: y >= hip_y - 2, max_d=60)
    tx0, ty0 = c['torso'][:2]
    if cs.get('paint'):
        _paint(torso, cs['paint'], tx0, ty0)
    # -- head
    heads = []
    for head in (rig.head, rig.blink_head):
        head = head.copy()
        if cs.get('hood'):
            head = _hood(head, rig.cid, c, cs)
        heads.append(head)
    rig.px, rig.py = PADX, PADY
    rig.torso = _pad(torso, PADX, PADY)
    out = []
    for head in heads:
        hp = _pad(head, PADX, PADY)
        x0, y0, x1, y1 = _bbox(head)
        cx, top = (x0 + x1 + 1) // 2 + PADX, y0 + PADY
        if cs.get('band'):
            b = BANDS[cs['band']]
            for k, yy in enumerate(range(*b['rows'])):
                col = b['colours'][k % len(b['colours'])]
                for xx in range(hp.shape[1]):
                    if hp[top + yy, xx, 3] and _lum(hp[top + yy, xx, :3]) >= 40:
                        hp[top + yy, xx, :3] = col
        if cs.get('hat'):
            hat = HATS[cs['hat']]
            dx, dy = hat['at']
            _stamp(hp, hat['rows'], hat['pal'], cx + dx, top + dy)
        out.append(hp)
    rig.head, rig.blink_head = out
    if cs.get('item'):
        rig.items = rig.items + [cs['item']]
    rig.back = cs.get('back')
    rig.skirt = cs.get('skirt')


def head_hair(cid, c) -> bool:
    h = '%02x%02x%02x' % tuple(int(v) for v in c[:3])
    return h in HAIR.get(cid, [])


def _hood(head: np.ndarray, cid: str, c: dict, cs: dict) -> np.ndarray:
    """Recolour the hair into a hood and grow it by 1px around the top of the head."""
    hood = cs['hood']
    eyes = c['eyes']
    ey = min(e[1] for e in eyes)
    ex0 = min(e[0] for e in eyes)
    max_y = cs.get('hood_max_y', 99)
    hair_cols = [hx(h) for h in HAIR[cid]]
    hl = sorted(hair_cols, key=_lum)
    out = head.copy()
    H, W = head.shape[:2]
    m = head[..., 3] > 0
    for y in range(H):
        for x in range(W):
            if not m[y, x] or y > max_y:
                continue
            col = tuple(int(v) for v in head[y, x, :3])
            if col not in hair_cols:
                continue
            if not (y < ey - 1 or x < ex0 - 1):
                continue
            # tone by luminance rank: brightest hair -> light, mid -> main, darker -> shade / dark
            r = hl.index(col) / max(1, len(hl) - 1)
            out[y, x, :3] = hood[1] if r > 0.8 else hood[0] if r > 0.45 else hood[2] if r > 0.15 else hood[3]
    # grow 1px around the head above the eye line (the hood is bigger than the hair)
    p = np.pad(m, 1)
    ring = ~m & (p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:])
    for y, x in zip(*np.nonzero(ring)):
        if y <= min(ey + 1, max_y) and y > 0 or (x < ex0 - 2 and y <= max_y):
            out[y, x, :3] = hood[2]
            out[y, x, 3] = 255
    return out


def _tone(tbl, nx, rel):
    main, light, shade, dark = tbl
    if nx > 0.5 and rel > 0.35:
        return light
    if nx < -0.45 and rel > 0.35:
        return shade
    return main


def draw_back(rig, cv, P: dict, origin, label: int):
    """Cape or tail behind the body (canvas coords)."""
    spec = rig.back
    tdx, tdy = origin
    c = rig.c
    x0, y0, x1, y1 = c['torso']
    hip_y = c['hip'][2]
    lean = P.get('lean', 0)
    air = not P.get('ground', True) or P.get('nf', (0, 0, 0))[2] > 2
    run = lean > 0
    # a per-frame phase from the pose (deterministic) so capes / tails flutter
    phase = (P.get('hip', (0, 0))[1] + P.get('nf', (0, 0, 0))[0] * 0.3) % 2
    if spec['kind'] == 'cape':
        col = spec['col']
        sy = y0 + 2 + tdy
        sx0, sx1 = x0 + tdx + 1, x0 + tdx + 5 + lean
        f = 3 + 4 * (1 if run else 0) + (3 if air else 0) + phase
        by = hip_y + tdy + (3 if not (run or air) else 1)
        pts = [(sx1, sy), (sx0 - 1, sy), (sx0 - 3 - f, by - (2 if run or air else 0)), (sx0 + 1 - f * 0.5, by + 1)]
        cv.poly(pts, lambda x, y: col[0] if x > sx0 - 1 - f * 0.4 else col[2], label)
        return
    style = spec['style']
    rx, ry = x0 + tdx + 0.5, hip_y + tdy - 2.0
    wag = 1 if phase >= 1 else 0
    if style == 'raccoon':
        pts = [(rx, ry), (rx - 4, ry + 1 - wag), (rx - 7, ry - 2 - wag)]
        rad = [1.9, 2.2]

        def col(t, nx, ny, rel):
            band = int(t * 5) % 2
            return (BROWN[3] if band else BROWN[0]) if not (nx < -0.4 and rel > 0.5) else BROWN[3]
    elif style == 'cat':
        pts = [(rx, ry), (rx - 3, ry + 1), (rx - 5, ry - 2 - wag), (rx - 5 + wag, ry - 6)]
        rad = [0.9, 0.9, 1.0]

        def col(t, nx, ny, rel):
            return hx('f4a6c8') if t > 0.85 else _tone(WHITE, nx, rel)
    else:  # dino
        pts = [(rx + 1, ry - 1), (rx - 4, ry + 2), (rx - 8, ry + 3 - wag)]
        rad = [2.6, 1.6]

        def col(t, nx, ny, rel):
            if ny < -0.6 and rel > 0.6 and int(t * 6) % 2 == 0:
                return hx('e0303a')
            return _tone(GREEN, nx, rel)
    cv.capsules(pts, rad, col, label)


def draw_skirt(rig, cv, P: dict, origin, label_torso: int):
    """Princess dress skirt over the thighs (own label so legs get a contour under it)."""
    spec = rig.skirt
    tdx, tdy = origin
    c = rig.c
    x0, y0, x1, y1 = c['torso']
    hip_y = c['hip'][2] + tdy
    lean = P.get('lean', 0)
    top = hip_y - 3
    bot = hip_y + 4
    pts = [(x0 + tdx + 0.5 + lean * 0.3, top), (x1 + tdx + 1.5 + lean * 0.3, top), (x1 + tdx + 4, bot), (x0 + tdx - 2.5, bot)]
    col = spec['col']
    SK = 13
    cv.depth[SK] = cv.depth.get(label_torso, 6)

    def f(x, y):
        if y > bot - 1:
            return spec['trim']
        return col[1] if (x - x0 - tdx) > (x1 - x0) * 0.6 else col[0]
    cv.poly(pts, f, SK)


# ---------------------------------------------------------------- held items
def draw_item(cv, name: str, hand, ang: float, label: int):
    """Draw a prop from the hand along direction `ang` (deg, 0 = down, + = forward)."""
    a = math.radians(ang)
    d = (math.sin(a), math.cos(a))
    n = (math.cos(a), -math.sin(a))
    hxp, hyp = hand

    def P(u, v=0.0):
        return (hxp + d[0] * u + n[0] * v, hyp + d[1] * u + n[1] * v)

    def solid(col):
        return lambda t, nx, ny, rel: col
    cv.depth.setdefault(label, 11)
    if name == 'pan':
        cv.capsules([P(-0.5), P(4.5)], 0.7, solid(hx('5a3a26')), label)
        cv.disc(*P(7.0), 2.7, lambda t, nx, ny, rel: hx('9a9cac') if rel > 0.72 else hx('3c3e4a') if nx < 0.3 else hx('5a5c6a'),
                label)
    elif name == 'wand':
        cv.capsules([P(-0.5), P(6)], 0.55, solid(hx('c8902a')), label)
        cv.disc(*P(7.4), 1.6, lambda t, nx, ny, rel: hx('ffffff') if rel < 0.45 else hx('ff7cf0'), label)
    elif name == 'sword':
        cv.capsules([P(-1), P(1)], 0.6, solid(hx('6e4026')), label)
        cv.capsules([P(1.2, -2.2), P(1.2, 2.2)], 0.6, solid(hx('f2c230')), label)
        cv.poly([P(1.8, -1.0), P(1.8, 1.0), P(9.0, 1.0), P(10.5, 0), P(9.0, -1.0)],
                lambda x, y: hx('e8ecf4'), label)
    elif name == 'spatula':
        cv.capsules([P(-0.5), P(4.5)], 0.55, solid(hx('3c3e4a')), label)
        cv.poly([P(4.5, -1.6), P(4.5, 1.6), P(8.5, 1.8), P(8.5, -1.8)], lambda x, y: hx('c8ccd8'), label)
    elif name == 'flowers':
        cv.capsules([P(-0.5), P(4.0)], 0.6, solid(hx('3fa34a')), label)
        cv.disc(*P(5.0, -1.6), 1.3, solid(hx('f06aa8')), label)
        cv.disc(*P(5.6, 1.4), 1.3, solid(hx('a070e8')), label)
        cv.disc(*P(6.6, 0), 1.2, solid(hx('f2c230')), label)
    elif name == 'fireball':
        cv.disc(*P(3.0), 2.3, lambda t, nx, ny, rel: hx('fff2a0') if rel < 0.45 else hx('ffb020') if rel < 0.8 else hx('e84a1c'),
                label)


# ---------------------------------------------------------------- dog costumes
def apply_dog(rig, cs: dict):
    kind = cs['dog']
    rig.costume = kind
    PX, PY = 6, 8
    d = rig.d
    hx0, hy0, hx1, hy1 = d['head']
    if kind == 'bee':
        def stripes(sp):
            out = sp.copy()
            for y, x in zip(*np.nonzero(sp[..., 3] > 0)):
                c = sp[y, x, :3]
                if _lum(c) < 140:
                    continue
                band = (x // 3) % 2 == 0
                out[y, x, :3] = hx('2a2420') if band else (hx('f6c838') if _lum(c) > 215 else hx('d8a020'))
            return out
        rig.body = stripes(rig.body)
    if kind == 'firefighter':
        out = rig.body.copy()
        bx = [x for x in range(out.shape[1])]
        for y, x in zip(*np.nonzero(out[..., 3] > 0)):
            c = out[y, x, :3]
            if _lum(c) < 140 or x < 5 or y < 4 or y > d['body_bottom'] - 2 or x > 14:
                continue
            out[y, x, :3] = hx('f2c230') if y == d['body_bottom'] - 3 else (hx('e0403a') if _lum(c) > 225 else hx('b02a2a'))
        rig.body = out
    pads = []
    for sp in (rig.head, rig.blink_head):
        hp = _pad(sp, PX, PY)
        x0, y0, x1, y1 = _bbox(sp)
        if kind == 'bee':
            _stamp(hp, ['.k...k.', 'kYk.kYk', '.k...k.', '.k..k..', '..k.k..'],
                   dict(Y=hx('f6c838')), x0 + PX + 1, y0 + PY - 5)
        if kind == 'firefighter':
            _stamp(hp, ['....kkkkk...', '..kkRRRRRkk.', '.kRRRRYRRRRk', '.kRRRRRRRRRk', 'kkkkkkkkkkkkk',
                        'kRRRRRRRRRRRk', '.kkkkkkkkkkk.'],
                   dict(R=hx('d8302a'), Y=hx('f2c230')), x0 + PX - 1, y0 + PY - 5)
        pads.append(hp)
    rig.head, rig.blink_head = pads
    rig.tail = _pad(rig.tail, PX, PY)
    rig.body = _pad(rig.body, PX, PY)
    rig.px, rig.py = PX, PY


def draw_dog_extra(rig, cv, P: dict, origin, labels: dict):
    """Cape over the back / bee wings, between body and head."""
    kind = getattr(rig, 'costume', None)
    if kind not in ('cape', 'bee'):
        return
    tdx, tdy = origin
    for k in list(cv.depth):
        cv.depth[k] = cv.depth[k] * 10
    EX = 20
    cv.depth[EX] = labels['BODY'] * 10 + 5
    d = rig.d
    run = abs(P.get('front', 0)) > 0 or P.get('tail', 0) >= 20
    phase = (P.get('body', (0, 0))[1]) % 2
    if kind == 'cape':
        # tied at the neck (x~13, y~4), draped over the back towards the tail
        nx, ny = 13 + tdx, 4 + tdy
        f = 3 if run else 1
        pts = [(nx + 1, ny), (nx - 1, ny - 1), (tdx + 3 - f, ny - 1 - f + phase), (tdx + 1 - f, ny + 4), (nx - 3, ny + 5)]
        cv.poly(pts, lambda x, y: hx('e0303a') if y < ny + 2 else hx('a82020'), EX)
        cv.poly([(nx - 1, ny - 1), (nx + 2, ny - 1), (nx + 2, ny + 1), (nx - 1, ny + 1)], lambda x, y: hx('f2c230'), EX)
    else:
        wx, wy = 9 + tdx, 1 + tdy
        flap = 1 if phase else 0
        cv.poly([(wx, wy + 2), (wx - 3, wy - 2 + flap), (wx - 1, wy - 4 + flap), (wx + 2, wy - 1)],
                lambda x, y: hx('dff2ff'), EX)
        cv.poly([(wx + 2, wy + 2), (wx + 1, wy - 3 + flap), (wx + 4, wy - 4 + flap), (wx + 5, wy - 1)],
                lambda x, y: hx('bfe4fa'), EX)
