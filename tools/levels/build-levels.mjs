#!/usr/bin/env node
/**
 * Level compiler: tools/levels/src/<id>.txt  →  public/levels/<id>.json (Tiled-compatible).
 *
 * Source format (sections separated by lines starting with `@`):
 *
 *   @meta
 *   name: Welcome to the Loop
 *   theme: day
 *   @legend            (optional — add/override single-char mappings, see DEFAULT_LEGEND)
 *   Q: ground STEEL_BLOCK
 *   @map               (the main grid; every row the same width, '.' or ' ' = empty)
 *   ......
 *   @background        (optional decor grid, same size, background layer)
 *   @foreground        (optional decor grid, same size, drawn in front)
 *   @objects           (optional explicit objects in TILE coordinates, bottom-left tile of the object)
 *   movingPlatform 40 12 dx=6 dy=0 period=3 width=3 style=girder
 *
 * Grid chars map to either a tile (on a layer) or an entity (object). Entities placed
 * in the grid sit on the bottom of their cell.
 *
 * `--check` validates without writing (used in CI).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(__dirname, 'src');
const OUT = path.join(ROOT, 'public/levels');
const TILE = 16;

// Must match src/game/data/tiles.ts
const TILES_TS = fs.readFileSync(path.join(ROOT, 'src/game/data/tiles.ts'), 'utf8');
const TILE_IDS = Object.fromEntries(
  [...TILES_TS.matchAll(/^\s+([A-Z_0-9]+): (\d+),$/gm)].map((m) => [m[1], Number(m[2])]),
);

/**
 * Default legend. Tile entries: { layer, tile } where tile is a TILE name or an
 * auto-tile rule name. Entity entries: { type, props }.
 */
export const DEFAULT_LEGEND = {
  // Auto-tiled solids (top tile chosen when nothing solid above)
  '#': { layer: 'ground', auto: ['SIDEWALK', 'CONCRETE'] },
  L: { layer: 'ground', auto: ['LIMESTONE_TOP', 'LIMESTONE'] },
  B: { layer: 'ground', auto: ['BRICK_TOP', 'BRICK'] },
  G: { layer: 'ground', auto: ['GIRDER_TOP', 'GIRDER'] },
  R: { layer: 'ground', auto: ['RIVERWALK_TOP', 'RIVERWALK'] },
  W: { layer: 'ground', auto: ['STONE_WALL_TOP', 'STONE_WALL'] },
  T: { layer: 'ground', auto: ['ROOF_TOP', 'ROOF'] },
  A: { layer: 'ground', auto: ['ASPHALT_TOP', 'ASPHALT'] },
  K: { layer: 'ground', tile: 'BRIDGE_DECK' },
  S: { layer: 'ground', tile: 'STEEL_BLOCK' },
  Y: { layer: 'ground', tile: 'WARNING_STRIPE' },
  V: { layer: 'ground', tile: 'PLANTER' },
  // One-way platforms
  '=': { layer: 'oneway', tile: 'RAIL' },
  '-': { layer: 'oneway', tile: 'SCAFFOLD_PLANK' },
  _: { layer: 'oneway', tile: 'WOOD_PLANK' },
  ':': { layer: 'oneway', tile: 'AWNING' },
  // Hazards
  '^': { layer: 'hazards', tile: 'SPIKES' },
  E: { layer: 'hazards', tile: 'ELECTRIC_RAIL' },
  '~': { layer: 'water', auto: ['WATER_TOP', 'WATER'] },
  // Decor (background layer) usable inside @map too
  '|': { layer: 'background', tile: 'GIRDER_POST' },
  x: { layer: 'background', tile: 'GIRDER_X' },
  '!': { layer: 'background', tile: 'PILLAR' },
  // Entities
  P: { type: 'playerStart' },
  o: { type: 'coin' },
  h: { type: 'hotdog' },
  z: { type: 'pizza' },
  t: { type: 'ctaPass' },
  '*': { type: 'star' },
  '+': { type: 'oneUp' },
  1: { type: 'souvenir', props: { index: 0 } },
  2: { type: 'souvenir', props: { index: 1 } },
  3: { type: 'souvenir', props: { index: 2 } },
  C: { type: 'checkpoint' }, // index assigned left→right
  F: { type: 'goal' },
  J: { type: 'bouncePad' },
  '?': { type: 'block', props: { kind: 'question', contents: 'coin' } },
  '%': { type: 'block', props: { kind: 'brick' } },
  r: { type: 'enemy', props: { kind: 'rat' } },
  p: { type: 'enemy', props: { kind: 'pigeon' } },
  k: { type: 'enemy', props: { kind: 'raccoon' } },
  c: { type: 'enemy', props: { kind: 'coneGuy' } },
  b: { type: 'enemy', props: { kind: 'turnstileBot' } },
  d: { type: 'enemy', props: { kind: 'securityDrone' } },
  w: { type: 'enemy', props: { kind: 'windowWasher' } },
  g: { type: 'enemy', props: { kind: 'gnat' } },
  s: { type: 'enemy', props: { kind: 'skirmisher' } },
  v: { type: 'enemy', props: { kind: 'wasp' } },
};

function parseValue(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v.replace(/^"|"$/g, '');
}

export function parseSource(text, file = '<src>') {
  const sections = {};
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const m = /^@(\w+)\s*$/.exec(raw);
    if (m) {
      cur = m[1];
      sections[cur] = [];
      continue;
    }
    if (cur === null) continue;
    sections[cur].push(raw);
  }
  if (!sections.map) throw new Error(`${file}: missing @map section`);
  const meta = {};
  for (const line of sections.meta ?? []) {
    const mm = /^\s*([\w]+)\s*:\s*(.*)$/.exec(line);
    if (mm) meta[mm[1]] = parseValue(mm[2].trim());
  }
  const legend = { ...DEFAULT_LEGEND };
  for (const line of sections.legend ?? []) {
    const mm = /^(.)\s*:\s*(\w+)\s+(.*)$/.exec(line);
    if (!mm) continue;
    const [, ch, kind, rest] = mm;
    if (['ground', 'oneway', 'hazards', 'water', 'background', 'foreground'].includes(kind)) {
      const parts = rest.trim().split(/\s+/);
      legend[ch] = parts.length > 1 ? { layer: kind, auto: parts } : { layer: kind, tile: parts[0] };
    } else {
      const [type, ...kv] = [kind, ...rest.trim().split(/\s+/).filter(Boolean)];
      const props = {};
      for (const p of kv) {
        const [k, v] = p.split('=');
        props[k] = parseValue(v);
      }
      legend[ch] = { type, props };
    }
  }
  const trimGrid = (lines) => {
    const rows = [...lines];
    while (rows.length && rows[rows.length - 1].trim() === '') rows.pop();
    while (rows.length && rows[0].trim() === '') rows.shift();
    return rows;
  };
  const grid = trimGrid(sections.map);
  const objects = (sections.objects ?? [])
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))
    .map((l) => {
      const [type, tx, ty, ...kv] = l.split(/\s+/);
      const props = {};
      for (const p of kv) {
        const i = p.indexOf('=');
        props[p.slice(0, i)] = parseValue(p.slice(i + 1));
      }
      return { type, tx: Number(tx), ty: Number(ty), props };
    });
  return {
    meta,
    legend,
    grid,
    background: sections.background ? trimGrid(sections.background) : null,
    foreground: sections.foreground ? trimGrid(sections.foreground) : null,
    objects,
  };
}

export function compile(src, file = '<src>') {
  const { meta, legend, grid, background, foreground, objects } = src;
  const height = grid.length;
  const width = Math.max(...grid.map((r) => r.length));
  const errors = [];
  const layers = {
    background: new Array(width * height).fill(0),
    ground: new Array(width * height).fill(0),
    oneway: new Array(width * height).fill(0),
    hazards: new Array(width * height).fill(0),
    water: new Array(width * height).fill(0),
    foreground: new Array(width * height).fill(0),
  };
  const charAt = (g, x, y) => (y >= 0 && y < g.length ? (g[y][x] ?? '.') : '.');
  const tileId = (name) => {
    if (!(name in TILE_IDS)) {
      errors.push(`${file}: unknown tile ${name}`);
      return 0;
    }
    return TILE_IDS[name] + 1; // gid
  };
  const placeTile = (layerName, g, x, y, entry) => {
    let name = entry.tile;
    if (entry.auto) {
      const above = charAt(g, x, y - 1);
      name = above === charAt(g, x, y) ? entry.auto[1] : entry.auto[0];
    }
    layers[layerName][y * width + x] = tileId(name);
  };
  const objs = [];
  let nextId = 1;
  let checkpointIndex = 0;
  const pushObj = (type, px, py, w, h, props = {}) => {
    const properties = Object.entries(props).map(([name, value]) => ({
      name,
      type: typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float') : typeof value === 'boolean' ? 'bool' : 'string',
      value,
    }));
    objs.push({ id: nextId++, name: '', type, x: px, y: py, width: w, height: h, rotation: 0, visible: true, properties });
  };

  // Main grid: sorted so checkpoints index left→right
  const entities = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = charAt(grid, x, y);
      if (ch === '.' || ch === ' ') continue;
      const e = legend[ch];
      if (!e) {
        errors.push(`${file}: unknown char '${ch}' at ${x},${y}`);
        continue;
      }
      if (e.layer) placeTile(e.layer, grid, x, y, e);
      else entities.push({ x, y, e });
    }
  }
  entities.sort((a, b) => a.x - b.x || a.y - b.y);
  for (const { x, y, e } of entities) {
    const props = { ...(e.props ?? {}) };
    if (e.type === 'checkpoint') props.index = checkpointIndex++;
    pushObj(e.type, x * TILE, y * TILE, TILE, TILE, props);
  }
  for (const [g, layerName] of [
    [background, 'background'],
    [foreground, 'foreground'],
  ]) {
    if (!g) continue;
    for (let y = 0; y < Math.min(height, g.length); y++) {
      for (let x = 0; x < width; x++) {
        const ch = charAt(g, x, y);
        if (ch === '.' || ch === ' ') continue;
        const e = legend[ch];
        if (!e || !e.layer) {
          errors.push(`${file}: ${layerName} grid char '${ch}' at ${x},${y} must be a tile`);
          continue;
        }
        placeTile(layerName, g, x, y, { ...e, layer: layerName });
      }
    }
  }
  for (const o of objects) {
    const w = (Number(o.props.width) || 1) * TILE;
    const h = (Number(o.props.height) || 1) * TILE;
    // (tx, ty) = bottom-left tile of the object
    pushObj(o.type, o.tx * TILE, (o.ty + 1) * TILE - h, w, h, o.props);
  }

  // Validation
  const starts = objs.filter((o) => o.type === 'playerStart');
  if (starts.length !== 1) errors.push(`${file}: expected exactly 1 playerStart (P), found ${starts.length}`);
  if (!meta.boss && !objs.some((o) => o.type === 'goal')) errors.push(`${file}: no goal (F)`);
  for (const r of grid) if (r.length !== width) {
    // ragged rows are allowed (padded) but warn
  }

  const mkLayer = (name, id) => ({
    id,
    name,
    type: 'tilelayer',
    width,
    height,
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
    data: layers[name],
  });
  const tilesetCols = 16;
  const tileCount = Object.keys(TILE_IDS).length;
  const json = {
    type: 'map',
    version: '1.10',
    tiledversion: '1.10.2',
    orientation: 'orthogonal',
    renderorder: 'right-down',
    infinite: false,
    width,
    height,
    tilewidth: TILE,
    tileheight: TILE,
    nextlayerid: 9,
    nextobjectid: nextId,
    properties: Object.entries(meta).map(([name, value]) => ({ name, type: typeof value === 'number' ? 'float' : typeof value === 'boolean' ? 'bool' : 'string', value })),
    tilesets: [
      {
        firstgid: 1,
        name: 'chicago-tiles',
        image: '../assets/tilesets/chicago-tiles.png',
        imagewidth: tilesetCols * TILE,
        imageheight: Math.ceil(tileCount / tilesetCols) * TILE,
        tilewidth: TILE,
        tileheight: TILE,
        tilecount: tileCount,
        columns: tilesetCols,
        margin: 0,
        spacing: 0,
      },
    ],
    layers: [
      mkLayer('background', 1),
      mkLayer('ground', 2),
      mkLayer('oneway', 3),
      mkLayer('hazards', 4),
      mkLayer('water', 5),
      mkLayer('foreground', 6),
      { id: 7, name: 'entities', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown', objects: objs },
    ],
  };
  return { json, errors, width, height };
}

function main() {
  const check = process.argv.includes('--check');
  if (!fs.existsSync(SRC)) {
    console.log('no level sources');
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });
  let failed = false;
  for (const f of fs.readdirSync(SRC).filter((f) => f.endsWith('.txt')).sort()) {
    const id = f.replace(/\.txt$/, '');
    const text = fs.readFileSync(path.join(SRC, f), 'utf8');
    try {
      const { json, errors, width, height } = compile(parseSource(text, f), f);
      if (errors.length) {
        failed = true;
        for (const e of errors) console.error('  ✗', e);
      }
      if (!check) fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(json));
      console.log(`${errors.length ? '✗' : '✓'} ${id} (${width}x${height})`);
    } catch (e) {
      failed = true;
      console.error(`✗ ${f}: ${e.message}`);
    }
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
