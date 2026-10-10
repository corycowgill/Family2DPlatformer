import { describe, expect, it } from 'vitest';
import { checkLevel } from '../../tools/levels/check-reachability.mjs';
import { LEVELS } from '../../src/game/data/levels';

const SOURCES = import.meta.glob('../../tools/levels/src/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('level reachability (weakest character, no abilities)', () => {
  for (const level of LEVELS) {
    it(`${level.id}: goal / boss arena and every checkpoint are reachable`, () => {
      const text = SOURCES[`../../tools/levels/src/${level.id}.txt`];
      expect(text, `missing source for ${level.id}`).toBeTypeOf('string');
      const res = checkLevel(level.id, text);
      expect(res.problems).toEqual([]);
      expect(res.stats!.coins).toBeGreaterThanOrEqual(100);
      // three souvenirs (grid chars 1, 2, 3) per level
      const map = text.split('@map')[1].split('\n@')[0];
      expect((map.match(/[123]/g) ?? []).length).toBe(3);
    });
  }
});
