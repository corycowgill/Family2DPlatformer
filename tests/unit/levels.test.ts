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

  it('auto-tiles: top tile when the cell above differs, fill tile below', () => {
    const r = build(lvl('P..F\n####\n####\nBB##'));
    expect(tileAt(r, 'ground', 0, 1)).toBe(gid('SIDEWALK'));
    expect(tileAt(r, 'ground', 0, 2)).toBe(gid('CONCRETE'));
    // B under # starts a new run → top tile
    expect(tileAt(r, 'ground', 0, 3)).toBe(gid('BRICK_TOP'));
    expect(tileAt(r, 'ground', 2, 3)).toBe(gid('CONCRETE'));
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
