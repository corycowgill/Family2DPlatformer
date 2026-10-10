import type { LevelInfo } from '../types';

/** Level registry. Maps live in public/levels/<id>.json (compiled from tools/levels/src). */
export const LEVELS: LevelInfo[] = [
  { id: 'loop-1', number: '1-1', name: 'Welcome to the Loop', world: 1, file: 'levels/loop-1.json', theme: 'day', music: 'streets', next: 'loop-2' },
  { id: 'loop-2', number: '1-2', name: 'The Elevated Tracks', world: 1, file: 'levels/loop-2.json', theme: 'rooftop', music: 'elevated', next: 'loop-3' },
  { id: 'loop-3', number: '1-3', name: 'Riverwalk Rush', world: 1, file: 'levels/loop-3.json', theme: 'river', music: 'riverwalk', next: 'loop-boss' },
  { id: 'loop-boss', number: '1-4', name: 'Battle for the Loop', world: 1, file: 'levels/loop-boss.json', theme: 'sunset', music: 'boss', boss: true },
];

/** Developer test level, reachable via ?level=test. */
export const TEST_LEVEL: LevelInfo = {
  id: 'test', number: '0-0', name: 'Test Range', world: 0, file: 'levels/test.json', theme: 'day', music: 'streets',
};

export function getLevel(id: string): LevelInfo | undefined {
  if (id === TEST_LEVEL.id) return TEST_LEVEL;
  const found = LEVELS.find((l) => l.id === id);
  if (found) return found;
  // Generic developer test levels: ?level=test-<name> → levels/test-<name>.json
  if (/^test-[\w-]+$/.test(id)) {
    return { ...TEST_LEVEL, id, name: `Test: ${id.slice(5)}`, file: `levels/${id}.json`, boss: id.includes('boss') };
  }
  return undefined;
}

export const FIRST_LEVEL_ID = LEVELS[0].id;
