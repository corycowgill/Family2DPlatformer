import type { LevelInfo, LevelTheme } from '../types';

/** Level registry. Maps live in public/levels/<id>.json (compiled from tools/levels/src). */
export const LEVELS: LevelInfo[] = [
  { id: 'loop-1', number: '1-1', name: 'Welcome to the Loop', world: 1, file: 'levels/loop-1.json', theme: 'day', music: 'streets', next: 'loop-2' },
  { id: 'loop-2', number: '1-2', name: 'The Elevated Tracks', world: 1, file: 'levels/loop-2.json', theme: 'rooftop', music: 'elevated', next: 'loop-3' },
  { id: 'loop-3', number: '1-3', name: 'Riverwalk Rush', world: 1, file: 'levels/loop-3.json', theme: 'river', music: 'riverwalk', next: 'loop-boss' },
  // Beating the EL-iminator opens World 2 (the World 1 ending plays first — see isWorldFinale).
  { id: 'loop-boss', number: '1-4', name: 'Battle for the Loop', world: 1, file: 'levels/loop-boss.json', theme: 'sunset', music: 'boss', boss: true, next: 'north-1' },
  { id: 'north-1', number: '2-1', name: 'Lincoln Park', world: 2, file: 'levels/north-1.json', theme: 'park', music: 'park', next: 'north-2' },
  { id: 'north-2', number: '2-2', name: 'Lakefront Trail', world: 2, file: 'levels/north-2.json', theme: 'lakefront', music: 'lakefront', next: 'north-3' },
  { id: 'north-3', number: '2-3', name: 'Wrigleyville Nights', world: 2, file: 'levels/north-3.json', theme: 'night', music: 'night', next: 'north-4' },
  { id: 'north-4', number: '2-4', name: 'Battle at Wrigley', world: 2, file: 'levels/north-4.json', theme: 'stadium', music: 'wrigley', boss: true },
];

/** Display data per world (world map header, collection pages, results). */
export interface WorldInfo {
  world: number;
  name: string;
  /** Short line once the world is complete. */
  savedLine: string;
}

export const WORLDS: readonly WorldInfo[] = [
  { world: 1, name: 'THE LOOP', savedLine: '★ THE LOOP IS SAVED!' },
  { world: 2, name: 'THE NORTH SIDE', savedLine: '★ THE NORTH SIDE IS SAVED!' },
];

export function worldInfo(world: number): WorldInfo {
  return WORLDS.find((w) => w.world === world) ?? { world, name: `WORLD ${world}`, savedLine: `★ WORLD ${world} SAVED!` };
}

/** Registered levels of one world, in play order. */
export function levelsOfWorld(world: number): LevelInfo[] {
  return LEVELS.filter((l) => l.world === world);
}

/**
 * Last level of its world: no `next`, or `next` belongs to another world. Completing it
 * completes the world (Results → ending) even though it also unlocks the next world.
 */
export function isWorldFinale(level: LevelInfo): boolean {
  if (level.world <= 0) return false;
  if (!level.next) return true;
  const n = LEVELS.find((l) => l.id === level.next);
  return !n || n.world !== level.world;
}

/** First level of a world (undefined if the world has none). */
export function firstLevelOfWorld(world: number): LevelInfo | undefined {
  return LEVELS.find((l) => l.world === world);
}

/** Developer test level, reachable via ?level=test. */
export const TEST_LEVEL: LevelInfo = {
  id: 'test', number: '0-0', name: 'Test Range', world: 0, file: 'levels/test.json', theme: 'day', music: 'streets',
};

/** Test levels named after a theme (`test-park`, `test-night-foo`...) use that theme. */
const TEST_THEMES: readonly LevelTheme[] = ['park', 'lakefront', 'night', 'stadium', 'rooftop', 'river', 'sunset'];
const testTheme = (id: string): LevelTheme => TEST_THEMES.find((t) => id === `test-${t}` || id.startsWith(`test-${t}-`)) ?? 'day';

export function getLevel(id: string): LevelInfo | undefined {
  if (id === TEST_LEVEL.id) return TEST_LEVEL;
  const found = LEVELS.find((l) => l.id === id);
  if (found) return found;
  // Generic developer test levels: ?level=test-<name> → levels/test-<name>.json
  if (/^test-[\w-]+$/.test(id)) {
    return { ...TEST_LEVEL, id, name: `Test: ${id.slice(5)}`, file: `levels/${id}.json`, boss: id.includes('boss'), theme: testTheme(id) };
  }
  return undefined;
}

export const FIRST_LEVEL_ID = LEVELS[0].id;
