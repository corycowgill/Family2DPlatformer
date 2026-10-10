/**
 * Auto-tiling for the level compiler (pure functions, no I/O).
 *
 * 1. Materials (ground / foreground / plain background): every material has the same
 *    48 tiles `${MAT}_${SUFFIX}` (see MATERIAL_SUFFIXES in src/game/data/tiles.ts). A cell
 *    picks its suffix from its neighbourhood — cap / corners / slab when nothing solid is
 *    above, side edges, undersides, inner corners — and its fill variant with a
 *    deterministic (x, y) hash, so rebuilds are stable and there is no visible period.
 *    Fill darkens with depth below the surface (F → D at 2-3 tiles → E at 4+).
 * 2. Facades (background layer): brick / limestone / Lower Wacker regions are dressed as
 *    buildings: cornice row on top, quoined edges, lit / unlit / blind / AC windows, one fire
 *    escape on some brick buildings, belt-course ledges, a sign band over storefront glass,
 *    an occasional vertical marquee, and rooftop clutter (water towers, HVAC, stacks).
 *
 * Only tile choice changes — never which cells are filled — so collision and level
 * geometry are exactly what the source grid says.
 */

/** Legacy two-tile auto pairs → material. */
export const LEGACY_PAIRS = {
  'SIDEWALK/CONCRETE': 'CONC',
  'LIMESTONE_TOP/LIMESTONE': 'LIME',
  'BRICK_TOP/BRICK': 'BRICK',
  'GIRDER_TOP/GIRDER': 'GIRD',
  'RIVERWALK_TOP/RIVERWALK': 'RWALK',
  'STONE_WALL_TOP/STONE_WALL': 'STONE',
  'ROOF_TOP/ROOF': 'ROOF',
  'ASPHALT_TOP/ASPHALT': 'ASPH',
};

export function materialOf(entry) {
  if (!entry || !entry.layer) return null;
  if (entry.mat) return entry.mat;
  if (entry.auto) return LEGACY_PAIRS[entry.auto.join('/')] ?? null;
  return null;
}

/** Deterministic hash of integers → [0, 1). */
export function hash01(...a) {
  let h = 0x811c9dc5;
  for (const v of a) h = Math.imul(h ^ (v | 0), 16777619) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function pick(r, table) {
  let t = table.reduce((s, [, w]) => s + w, 0) * r;
  for (const [n, w] of table) if ((t -= w) < 0) return n;
  return table[table.length - 1][0];
}

const TOP = [['T0', 36], ['T1', 22], ['T2', 18], ['T3', 18], ['X0', 3], ['X1', 3]];
const FILL = {
  F: [['F0', 28], ['F1', 16], ['F2', 14], ['F3', 13], ['F4', 9], ['F5', 8], ['F6', 8], ['X2', 2], ['X3', 2]],
  D: [['D0', 40], ['D1', 25], ['D2', 20], ['D3', 15]],
  E: [['E0', 45], ['E1', 30], ['E2', 25]],
};
const BOTTOM = [['B0', 40], ['B1', 25], ['B2', 20], ['B3', 15]];
const SLAB = [['S0', 60], ['S1', 40]];
const RARE = new Set(['X0', 'X1', 'X2', 'X3']);
const MAT_SALT = { CONC: 11, LIME: 23, BRICK: 37, GIRD: 41, RWALK: 53, STONE: 67, ROOF: 79, ASPH: 83, DECK: 97, WACK: 101 };
/** Per-material underside rhythm (Lower Wacker: a sodium lamp every 4 tiles). */
const BOTTOM_PATTERN = {
  WACK: (x, y) => (x % 4 === 2 ? 'B1' : hash01(x, y, 7) < 0.5 ? 'B0' : 'B2'),
};

/**
 * Suffix for a solid `mat` cell at (x, y). `solid(x, y)` says whether a cell reads as solid
 * (out of bounds: below / sideways = solid, above = open); `chosen(x, y)` returns the
 * suffix already picked for an earlier cell of the same pass (or undefined).
 */
export function materialSuffix(mat, x, y, solid, chosen = () => undefined) {
  const up = solid(x, y - 1);
  const down = solid(x, y + 1);
  const left = solid(x - 1, y);
  const right = solid(x + 1, y);
  const salt = MAT_SALT[mat] ?? 1;
  const r = (k = 0) => hash01(x, y, salt, k);
  // no two rare features touching, and no identical non-base variant side by side / stacked
  const vary = (table) => {
    let s = pick(r(), table);
    const l = chosen(x - 1, y);
    const u = chosen(x, y - 1);
    for (let k = 1; k < 4; k++) {
      const clash = (RARE.has(s) && (RARE.has(l) || RARE.has(u))) || ((s === l || s === u) && !s.endsWith('0'));
      if (!clash) break;
      s = pick(r(k), table.filter(([n]) => !RARE.has(n)));
    }
    return s;
  };
  if (!up) {
    if (!down) return !left && !right ? 'SLR' : !left ? 'SL' : !right ? 'SR' : pick(r(), SLAB);
    if (!left && !right) return 'TLR';
    if (!left) return 'TL';
    if (!right) return 'TR';
    return vary(TOP);
  }
  if (!down) {
    if (!left && !right) return 'BLR';
    if (!left) return 'BL';
    if (!right) return 'BR';
    return BOTTOM_PATTERN[mat]?.(x, y) ?? vary(BOTTOM);
  }
  let d = 1;
  while (d < 4 && solid(x, y - d - 1)) d++;
  const tier = d <= 1 ? 'F' : d <= 3 ? 'D' : 'E';
  const pre = tier === 'F' ? '' : tier;
  if (!left && !right) return `${pre}LR`;
  if (!left) return `${pre}L`;
  if (!right) return `${pre}R`;
  if (tier === 'F' && !solid(x - 1, y - 1)) return 'IL';
  if (tier === 'F' && !solid(x + 1, y - 1)) return 'IR';
  return vary(FILL[tier]);
}

// ---------------------------------------------------------------------------
// Facades
// ---------------------------------------------------------------------------
const FAMILY_TILES = {
  brick: new Set(['BRICK_TOP', 'BRICK', 'BRICK_WINDOW']),
  lime: new Set(['LIMESTONE_TOP', 'LIMESTONE', 'LIMESTONE_WINDOW', 'LIMESTONE_ARCH']),
  wack: new Set(['LOWER_WACKER']),
};
const FAMILY_MAT = { BRICK: 'brick', LIME: 'lime', WACK: 'wack' };
const WINDOW_TILES = new Set(['BRICK_WINDOW', 'LIMESTONE_WINDOW']);
const GLASS_TILES = new Set(['GLASS', 'GLASS_FRAME']);

export function facadeFamily(entry) {
  if (!entry || !entry.layer) return null;
  const m = materialOf(entry);
  if (m && FAMILY_MAT[m]) return FAMILY_MAT[m];
  for (const [fam, set] of Object.entries(FAMILY_TILES)) if (entry.tile && set.has(entry.tile)) return fam;
  return null;
}

const WIN = {
  brick: [['FB_WIN', 42], ['FB_WIN_LIT', 20], ['FB_WIN_BLIND', 13], ['FB_WIN_AC', 15], ['FB_WIN_TV', 10]],
  lime: [['FL_WIN', 48], ['FL_WIN_LIT', 22], ['FL_WIN_BLIND', 15], ['FL_WIN_AC', 15]],
};
const WALL = {
  brick: [['FB_WALL0', 62], ['FB_WALL1', 16], ['FB_WALL3', 14], ['FB_WALL2', 8]],
  lime: [['FL_WALL0', 64], ['FL_WALL1', 20], ['FL_WALL2', 16]],
};
const PRE = { brick: 'FB', lime: 'FL' };

/**
 * Background decoration. `cell(x, y)` → legend entry of the background grid (or undefined).
 * Returns Map<index, tileName> overriding the plain per-cell placement.
 */
export function decorateBackground(cell, width, height) {
  const out = new Map();
  const idx = (x, y) => y * width + x;
  const inb = (x, y) => x >= 0 && x < width && y >= 0 && y < height;
  const fam = (x, y) => (inb(x, y) ? facadeFamily(cell(x, y)) : null);
  const occupied = (x, y) => inb(x, y) && !!cell(x, y);
  const tileOf = (x, y) => (inb(x, y) ? cell(x, y)?.tile : undefined);

  // connected components per family
  const comp = new Int32Array(width * height).fill(-1);
  const buildings = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const f = fam(x, y);
      if (!f || comp[idx(x, y)] >= 0) continue;
      const b = { id: buildings.length, fam: f, cells: [], minX: x, maxX: x, minY: y, maxY: y };
      const stack = [[x, y]];
      comp[idx(x, y)] = b.id;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        b.cells.push([cx, cy]);
        b.minX = Math.min(b.minX, cx);
        b.maxX = Math.max(b.maxX, cx);
        b.minY = Math.min(b.minY, cy);
        b.maxY = Math.max(b.maxY, cy);
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
          if (fam(nx, ny) === f && comp[idx(nx, ny)] < 0) {
            comp[idx(nx, ny)] = b.id;
            stack.push([nx, ny]);
          }
        }
      }
      buildings.push(b);
    }
  }

  let marqueeUsed = false;
  for (const b of buildings) {
    const w = b.maxX - b.minX + 1;
    const h = b.maxY - b.minY + 1;
    const seed = b.minX * 131 + b.minY * 7919;
    const inside = (x, y) => occupied(x, y) && (fam(x, y) === b.fam || fam(x, y) === null);
    const isTop = (x, y) => y > 0 && !occupied(x, y - 1);
    const set = (x, y, name) => out.set(idx(x, y), name);

    if (b.fam === 'wack') {
      for (const [x, y] of b.cells) {
        if (isTop(x, y) || (y === b.minY && y > 0)) set(x, y, 'LW_BEAM');
        else if (y === b.minY + 1 && x % 6 === 4) set(x, y, 'LW_LAMP');
        else set(x, y, pick(hash01(x, y, 5), [['LW_WALL0', 70], ['LW_WALL1', 30]]));
      }
      // one green guide sign + an exit sign per long underpass
      const sy = b.minY + 2;
      if (h >= 4 && w >= 12) {
        const sx = b.minX + 6;
        if (fam(sx, sy) === 'wack' && fam(sx + 1, sy) === 'wack') {
          set(sx, sy, 'LW_SIGN_L');
          set(sx + 1, sy, 'LW_SIGN_R');
        }
        const ex = b.maxX - 5;
        if (fam(ex, sy) === 'wack') set(ex, sy, 'LW_EXIT');
      }
      continue;
    }

    const pre = PRE[b.fam];
    const rowHasWindow = new Set();
    for (const [x, y] of b.cells) if (WINDOW_TILES.has(tileOf(x, y)) || tileOf(x, y) === 'LIMESTONE_ARCH') rowHasWindow.add(y);
    // wall-only rows below the top → belt courses on some of them
    const wallRows = [];
    for (let y = b.minY + 1; y <= b.maxY; y++) if (!rowHasWindow.has(y)) wallRows.push(y);
    const ledgeRows = new Set();
    if (h >= 6) {
      const every = b.fam === 'lime' ? 2 : 3;
      wallRows.forEach((y, k) => {
        if (k % every === every - 1 && y < b.maxY - 1) ledgeRows.add(y);
      });
    }
    // fire escape (brick, wide & tall enough): one window column + the column to its right
    let fe = null;
    if (b.fam === 'brick' && w >= 6 && h >= 5 && hash01(seed, 3) < 0.65) {
      const cols = [...new Set(b.cells.filter(([x, y]) => WINDOW_TILES.has(tileOf(x, y))).map(([x]) => x))]
        .filter((x) => x > b.minX && x + 1 < b.maxX)
        .sort((a, c) => a - c);
      if (cols.length >= 2) {
        const fx = cols[Math.floor(hash01(seed, 4) * cols.length)];
        const rows = b.cells.filter(([x, y]) => x === fx && WINDOW_TILES.has(tileOf(x, y))).map(([, y]) => y);
        if (rows.length >= 2) fe = { x: fx, top: Math.min(...rows), bottom: Math.max(...rows) };
      }
    }
    // vertical marquee on one tall limestone building
    let marquee = null;
    if (!marqueeUsed && b.fam === 'lime' && h >= 7 && w >= 6 && hash01(seed, 9) < 0.7) {
      const mx = hash01(seed, 10) < 0.5 ? b.minX + 1 : b.maxX - 1;
      let ok = true;
      for (let y = b.minY + 1; y <= b.minY + 5; y++) if (fam(mx, y) !== 'lime') ok = false;
      if (ok) {
        marquee = { x: mx, y: b.minY + 1 };
        marqueeUsed = true;
      }
    }

    for (const [x, y] of b.cells) {
      const t = tileOf(x, y);
      const leftEdge = !inside(x - 1, y);
      const rightEdge = !inside(x + 1, y);
      const r = hash01(x, y, seed);
      if (isTop(x, y)) {
        set(x, y, `${pre}_CORN${leftEdge ? '_L' : rightEdge ? '_R' : ''}`);
        continue;
      }
      if (marquee && x === marquee.x && y >= marquee.y && y < marquee.y + 5) {
        set(x, y, ['SIGN_V_TOP', 'SIGN_V1', 'SIGN_V2', 'SIGN_V3', 'SIGN_V4'][y - marquee.y]);
        continue;
      }
      if (t === 'LIMESTONE_ARCH') {
        set(x, y, 'FL_WIN_ARCH');
        continue;
      }
      if (WINDOW_TILES.has(t)) {
        if (fe && x === fe.x && y >= fe.top && y <= fe.bottom) set(x, y, 'FB_WIN_FE');
        else set(x, y, pick(r, WIN[b.fam]));
        continue;
      }
      // plain wall cell
      if (fe && x === fe.x + 1 && y >= fe.top && y <= fe.bottom) {
        set(x, y, rowHasWindow.has(y) ? 'FB_FE_RAIL' : 'FB_FE_STAIR');
        continue;
      }
      const below = tileOf(x, y + 1);
      if (GLASS_TILES.has(below)) {
        const lb = GLASS_TILES.has(tileOf(x - 1, y + 1)) && inside(x - 1, y);
        const rb = GLASS_TILES.has(tileOf(x + 1, y + 1)) && inside(x + 1, y);
        let runL = x;
        while (GLASS_TILES.has(tileOf(runL - 1, y + 1)) && inside(runL - 1, y)) runL--;
        let runR = x;
        while (GLASS_TILES.has(tileOf(runR + 1, y + 1)) && inside(runR + 1, y)) runR++;
        const mid = Math.floor((runL + runR) / 2);
        set(x, y, !lb ? 'BAND_L' : !rb ? 'BAND_R' : runR - runL >= 4 && x === mid ? 'BAND_2' : 'BAND');
        continue;
      }
      if (ledgeRows.has(y)) {
        if (b.fam === 'lime') set(x, y, leftEdge ? 'FL_LEDGE_L' : rightEdge ? 'FL_LEDGE_R' : 'FL_LEDGE');
        else set(x, y, leftEdge ? 'FB_EDGE_L' : rightEdge ? 'FB_EDGE_R' : 'FB_LEDGE');
        continue;
      }
      if (leftEdge) set(x, y, `${pre}_EDGE_L`);
      else if (rightEdge) set(x, y, `${pre}_EDGE_R`);
      else set(x, y, pick(r, WALL[b.fam]));
    }

    // rooftop clutter in the open cells above the cornice
    const free = (x, y) => inb(x, y) && !occupied(x, y);
    const tops = b.cells.filter(([x, y]) => isTop(x, y)).sort((a, c) => a[0] - c[0]);
    const used = new Set();
    if (w >= 6 && hash01(seed, 1) < 0.6) {
      const cand = tops.filter(([x, y]) => x > b.minX && x + 1 < b.maxX && isTop(x + 1, y) && y >= 2 && free(x, y - 1) && free(x + 1, y - 1) && free(x, y - 2) && free(x + 1, y - 2));
      if (cand.length) {
        const [x, y] = cand[Math.floor(hash01(seed, 2) * cand.length)];
        set(x, y - 2, 'WT_TL');
        set(x + 1, y - 2, 'WT_TR');
        set(x, y - 1, 'WT_BL');
        set(x + 1, y - 1, 'WT_BR');
        for (let k = -1; k <= 2; k++) used.add(x + k);
      }
    }
    for (const [x, y] of tops) {
      if (used.has(x) || !free(x, y - 1) || x === b.minX || x === b.maxX) continue;
      const r = hash01(x, y, seed, 6);
      if (r < 0.16) {
        set(x, y - 1, r < 0.08 ? 'ROOF_HVAC' : r < 0.12 ? 'ROOF_STACK' : 'ROOF_ANTENNA');
        used.add(x + 1);
        used.add(x - 1);
      }
    }
  }

  // glass curtain walls: a few lit / dark panes; Lower Wacker pillars get a striped base
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = tileOf(x, y);
      if (t === 'GLASS') out.set(idx(x, y), pick(hash01(x, y, 31), [['GLASS', 74], ['GLASS_LIT', 11], ['GLASS_DARK', 15]]));
      else if (t === 'GLASS_FRAME') out.set(idx(x, y), pick(hash01(x, y, 37), [['GLASS_FRAME', 88], ['GLASS_FRAME_LIT', 12]]));
      else if (t === 'LW_PILLAR' && tileOf(x, y + 1) !== 'LW_PILLAR') out.set(idx(x, y), 'LW_PILLAR_BASE');
    }
  }
  return out;
}
