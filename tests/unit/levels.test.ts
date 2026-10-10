import { describe, expect, it } from 'vitest';
import { TILE } from '../../src/game/data/tiles';
import { LEVELS, TEST_LEVEL } from '../../src/game/data/levels';
// @ts-expect-error -- plain JS build tool without type declarations
import * as builder from '../../tools/levels/build-levels.mjs';

interface TiledObject {
  id: number;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties: { name: string; type: string; value: unknown }[];
}
interface TiledLayer {
  name: string;
  type: string;
  width?: number;
  height?: number;
  data?: number[];
  objects?: TiledObject[];
}
interface CompileResult {
  json: { width: number; height: number; tilewidth: number; layers: TiledLayer[] };
  errors: string[];
  width: number;
  height: number;
}
const parseSource = builder.parseSource as (text: string, file?: string) => unknown;
const compile = builder.compile as (src: unknown, file?: string) => CompileResult;
const DEFAULT_LEGEND = builder.DEFAULT_LEGEND as Record<string, unknown>;

const build = (text: string) => compile(parseSource(text, 't.txt'), 't.txt');
const layer = (r: CompileResult, name: string) => r.json.layers.find((l) => l.name === name)!;
const tileAt = (r: CompileResult, name: string, x: number, y: number) => layer(r, name).data![y * r.width + x];
const gid = (name: keyof typeof TILE) => TILE[name] + 1;
const objects = (r: CompileResult) => layer(r, 'entities').objects!;
const prop = (o: TiledObject, n: string) => o.properties.find((p) => p.name === n)?.value;

const lvl = (map: string, extra = '') => `@meta\nname: T\ntheme: day\n${extra}@map\n${map}\n`;

describe('level compiler: parseSource', () => {
  it('parses meta values with types', () => {
    const src = parseSource('@meta\nname: Welcome to the Loop\nboss: true\ntime: 300\n@map\nP.F\n###\n') as {
      meta: Record<string, unknown>;
      grid: string[];
    };
    expect(src.meta).toEqual({ name: 'Welcome to the Loop', boss: true, time: 300 });
    expect(src.grid).toEqual(['P.F', '###']);
  });

  it('trims blank leading/trailing grid rows', () => {
    const src = parseSource('@map\n\n\nP.F\n###\n\n\n') as { grid: string[] };
    expect(src.grid).toEqual(['P.F', '###']);
  });

  it('throws when @map is missing', () => {
    expect(() => parseSource('@meta\nname: x\n', 'nomap.txt')).toThrow(/nomap\.txt: missing @map/);
  });

  it('legend section adds tile, auto-tile and entity mappings', () => {
    const src = parseSource(
      '@legend\nQ: ground STEEL_BLOCK\nM: ground BRICK_TOP BRICK\nm: enemy kind=pigeon facing=right hp=2\n@map\nP\n',
    ) as { legend: Record<string, unknown> };
    expect(src.legend.Q).toEqual({ layer: 'ground', tile: 'STEEL_BLOCK' });
    expect(src.legend.M).toEqual({ layer: 'ground', auto: ['BRICK_TOP', 'BRICK'] });
    expect(src.legend.m).toEqual({ type: 'enemy', props: { kind: 'pigeon', facing: 'right', hp: 2 } });
    // defaults survive
    expect(src.legend['#']).toEqual(DEFAULT_LEGEND['#']);
  });
});

describe('level compiler: compile', () => {
  it('produces a Tiled-compatible map with all layers', () => {
    const r = build(lvl('P..F\n####'));
    expect(r.errors).toEqual([]);
    expect(r.width).toBe(4);
    expect(r.height).toBe(2);
    expect(r.json.tilewidth).toBe(16);
    expect(r.json.layers.map((l) => l.name)).toEqual(['background', 'ground', 'oneway', 'hazards', 'water', 'foreground', 'entities']);
    for (const l of r.json.layers.filter((l) => l.type === 'tilelayer')) expect(l.data).toHaveLength(8);
  });

  it('auto-tiles materials by neighbourhood: caps, corners, edges, depth tiers', () => {
    const r = build(lvl('P....F\n.####.\n.####.\n.####.\n.####.\n.####.'));
    const name = (x: number, y: number) => {
      const g = tileAt(r, 'ground', x, y) - 1;
      return (Object.keys(TILE) as (keyof typeof TILE)[]).find((k) => TILE[k] === g);
    };
    expect(name(1, 1)).toBe('CONC_TL');
    expect(name(4, 1)).toBe('CONC_TR');
    expect(name(2, 1)).toMatch(/^CONC_(T[0-3]|X[01])$/); // walkable cap variant
    expect(name(1, 2)).toBe('CONC_L');
    expect(name(4, 3)).toBe('CONC_DR'); // 2 tiles deep → darker tier
    expect(name(2, 2)).toMatch(/^CONC_(F[0-6]|X[23])$/);
    expect(name(2, 3)).toMatch(/^CONC_D[0-3]$/);
    expect(name(2, 5)).toMatch(/^CONC_E[0-2]$/); // map bottom continues → no underside
  });

  it('auto-tiles undersides, one-tile slabs, inner corners and mixed materials', () => {
    const r = build(lvl('P.....F\n.......\n..BBB..\n..BBB..\n.......\n.GGG...\n.GGGG..\n#######\n#######'));
    const name = (x: number, y: number) => {
      const g = tileAt(r, 'ground', x, y) - 1;
      return (Object.keys(TILE) as (keyof typeof TILE)[]).find((k) => TILE[k] === g);
    };
    expect(name(2, 3)).toBe('BRICK_BL');
    expect(name(3, 3)).toMatch(/^BRICK_B[0-3]$/);
    expect(name(4, 6)).toBe('GIRD_TR'); // step down: cap
    expect(name(3, 6)).toBe('GIRD_IR'); // under the wall next to the step: inner corner
    // a different solid above: no lip, it continues as fill
    expect(name(2, 7)).toMatch(/^CONC_(D[0-3]|DL|F[0-6]|X[23])$/);
    const slab = build(lvl('P...F\n.KKK.\n.....\n#####'));
    const slabName = (x: number) => (Object.keys(TILE) as (keyof typeof TILE)[]).find((k) => TILE[k] === tileAt(slab, 'ground', x, 1) - 1);
    expect([slabName(1), slabName(3)]).toEqual(['DECK_SL', 'DECK_SR']);
    expect(slabName(2)).toMatch(/^DECK_S[01]$/);
  });

  it('auto-tiling is deterministic and only changes tile choice, never occupancy', () => {
    const text = lvl('P.......F\n#########\n#########\n#########');
    const a = build(text);
    const b = build(text);
    expect(layer(a, 'ground').data).toEqual(layer(b, 'ground').data);
    const occupied = layer(a, 'ground').data!.map((g) => g > 0);
    expect(occupied).toEqual([...'P.......F', ...'#'.repeat(27)].map((c) => c === '#'));
  });

  it('legacy two-tile auto pairs map to materials; other pairs keep top/fill behaviour', () => {
    const r = build(lvl('P.F\nMMM\nMMM', '') .replace('@map', '@legend\nM: ground BRICK_TOP BRICK\n@map'));
    expect(r.errors).toEqual([]);
    expect(tileAt(r, 'ground', 0, 1)).toBeGreaterThan(gid('BUSH')); // material tile, not BRICK_TOP
    const w = build(lvl('P~~F\n.~~.\n####'));
    expect(tileAt(w, 'water', 1, 0)).toBe(gid('WATER_TOP'));
    expect(tileAt(w, 'water', 1, 1)).toBe(gid('WATER'));
  });

  it('@MAT legend entries select a material; unknown materials are errors', () => {
    const ok = build(lvl('P.F\nZZZ').replace('@map', '@legend\nZ: ground @WACK\n@map'));
    expect(ok.errors).toEqual([]);
    expect(tileAt(ok, 'ground', 1, 1)).toBeGreaterThanOrEqual(gid('WACK_TL'));
    const bad = build(lvl('P.F\nZZZ').replace('@map', '@legend\nZ: ground @NOPE\n@map'));
    expect(bad.errors.some((e) => /unknown material @NOPE/.test(e))).toBe(true);
  });

  it('dresses background facades: cornice on top, windows varied, edges quoined', () => {
    const bg = ['........', 'BBBBBBBB', 'BmBmBmBB', 'BBBBBBBB', 'BmBmBmBB', '........'].join('\n');
    const r = build(lvl('P......F\n........\n........\n........\n........\n########', '@legend\nm: background BRICK_WINDOW\n') + `@background\n${bg}\n`);
    const name = (x: number, y: number) => {
      const g = tileAt(r, 'background', x, y) - 1;
      return (Object.keys(TILE) as (keyof typeof TILE)[]).find((k) => TILE[k] === g);
    };
    expect(name(0, 1)).toBe('FB_CORN_L');
    expect(name(3, 1)).toBe('FB_CORN');
    expect(name(7, 1)).toBe('FB_CORN_R');
    expect(name(0, 3)).toBe('FB_EDGE_L');
    expect(name(1, 2)).toMatch(/^FB_(WIN|WIN_LIT|WIN_BLIND|WIN_AC|WIN_TV|WIN_FE)$/);
    // no walkable material lips in the background
    for (let x = 0; x < 8; x++) expect(name(x, 1)).not.toMatch(/BRICK_T/);
  });

  it('places one-way, hazard and water tiles on their layers', () => {
    const r = build(lvl('P=^~F\n#####'));
    expect(tileAt(r, 'oneway', 1, 0)).toBe(gid('RAIL'));
    expect(tileAt(r, 'hazards', 2, 0)).toBe(gid('SPIKES'));
    expect(tileAt(r, 'water', 3, 0)).toBe(gid('WATER_TOP'));
    expect(tileAt(r, 'ground', 1, 0)).toBe(0);
  });

  it('converts entities to objects positioned at the cell (bottom-left) with props', () => {
    const r = build(lvl('P.r?F\n#####'));
    const objs = objects(r);
    const enemy = objs.find((o) => o.type === 'enemy')!;
    expect(enemy).toMatchObject({ x: 32, y: 0, width: 16, height: 16 });
    expect(prop(enemy, 'kind')).toBe('rat');
    const block = objs.find((o) => o.type === 'block')!;
    expect(prop(block, 'kind')).toBe('question');
    expect(prop(block, 'contents')).toBe('coin');
    // ids unique
    expect(new Set(objs.map((o) => o.id)).size).toBe(objs.length);
  });

  it('indexes checkpoints left to right regardless of row', () => {
    const r = build(lvl('.....C.\nP.C....\n..C...F\n#######'));
    const cps = objects(r)
      .filter((o) => o.type === 'checkpoint')
      .map((o) => ({ x: o.x / 16, y: o.y / 16, index: prop(o, 'index') }));
    expect(cps).toEqual([
      { x: 2, y: 1, index: 0 },
      { x: 2, y: 2, index: 1 },
      { x: 5, y: 0, index: 2 },
    ]);
  });

  it('@objects section: tile coords are the bottom-left tile; width/height in tiles', () => {
    const r = build(lvl('P..F\n####', '') + '@objects\n// comment\nmovingPlatform 1 0 dx=6 dy=0 period=3 width=3 style=girder\nbouncePad 2 1\n');
    const mp = objects(r).find((o) => o.type === 'movingPlatform')!;
    expect(mp).toMatchObject({ x: 16, y: 0, width: 48, height: 16 });
    expect(prop(mp, 'dx')).toBe(6);
    expect(prop(mp, 'period')).toBe(3);
    expect(prop(mp, 'style')).toBe('girder');
    const typeOf = (n: string) => mp.properties.find((p) => p.name === n)?.type;
    expect(typeOf('dx')).toBe('int');
    expect(typeOf('style')).toBe('string');
    const pad = objects(r).find((o) => o.type === 'bouncePad')!;
    expect(pad).toMatchObject({ x: 32, y: 16, width: 16, height: 16 });
  });

  it('tall @objects extend upward from their bottom tile', () => {
    const r = build(lvl('P..F\n####') + '@objects\nvent 1 1 height=3\n');
    const v = objects(r).find((o) => o.type === 'vent')!;
    expect(v).toMatchObject({ x: 16, y: 32 - 48, height: 48 });
  });

  it('background / foreground grids land on their own layers', () => {
    const r = build(lvl('P..F\n####') + '@background\n.|..\n....\n@foreground\n..x.\n');
    expect(tileAt(r, 'background', 1, 0)).toBe(gid('GIRDER_POST'));
    expect(tileAt(r, 'foreground', 2, 0)).toBe(gid('GIRDER_X'));
  });

  it('errors on unknown characters', () => {
    const r = build(lvl('P.@F\n####'));
    expect(r.errors.some((e) => /unknown char '@' at 2,0/.test(e))).toBe(true);
  });

  it('errors on entity chars in decor grids', () => {
    const r = build(lvl('P..F\n####') + '@background\n.o..\n');
    expect(r.errors.some((e) => /background grid char 'o'/.test(e))).toBe(true);
  });

  it('errors on unknown tile names in the legend', () => {
    const r = compile(parseSource('@legend\nQ: ground NOT_A_TILE\n@map\nPQF\n###\n', 't.txt'), 't.txt');
    expect(r.errors.some((e) => /unknown tile NOT_A_TILE/.test(e))).toBe(true);
  });

  it('errors when playerStart is missing or duplicated', () => {
    expect(build(lvl('...F\n####')).errors.some((e) => /exactly 1 playerStart.*found 0/.test(e))).toBe(true);
    expect(build(lvl('P.PF\n####')).errors.some((e) => /found 2/.test(e))).toBe(true);
  });

  it('requires a goal unless the level is a boss level', () => {
    expect(build(lvl('P...\n####')).errors.some((e) => /no goal/.test(e))).toBe(true);
    expect(build(lvl('P...\n####', 'boss: true\n')).errors).toEqual([]);
  });

  it('pads ragged rows', () => {
    const r = build(lvl('P\n...F\n####'));
    expect(r.errors).toEqual([]);
    expect(r.width).toBe(4);
  });
});

describe('level sources on disk', () => {
  // Vite globs (no Node types needed): every level source and every compiled map.
  const sources = import.meta.glob('../../tools/levels/src/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const maps = import.meta.glob('../../public/levels/*.json', { import: 'default', eager: true }) as Record<string, { layers: TiledLayer[] }>;
  const files = Object.entries(sources).map(([p, text]) => [p.split('/').pop()!, text] as const);

  it.each(files)('%s compiles without errors', (f, text) => {
    const r = compile(parseSource(text, f), f);
    expect(r.errors).toEqual([]);
  });

  const registered = [TEST_LEVEL, ...LEVELS]
    .map((l) => [l.id, l, maps[`../../public/${l.file}`]] as const)
    .filter(([, , json]) => !!json);
  it('test level map exists', () => {
    expect(registered.some(([id]) => id === 'test')).toBe(true);
  });
  it.each(registered)('%s map JSON has the layers the game needs', (_id, l, json) => {
    const names = json.layers.map((x) => x.name);
    expect(names).toContain('ground');
    expect(names).toContain('entities');
    const ents = json.layers.find((x) => x.name === 'entities')!.objects!;
    expect(ents.filter((o) => o.type === 'playerStart')).toHaveLength(1);
    if (!l.boss) expect(ents.some((o) => o.type === 'goal')).toBe(true);
  });

  it('every LEVELS "next" refers to a registered level', () => {
    const ids = new Set(LEVELS.map((l) => l.id));
    for (const l of LEVELS) if (l.next) expect(ids.has(l.next)).toBe(true);
  });
});
