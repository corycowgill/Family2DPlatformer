import { describe, expect, it } from 'vitest';
import { SaveSystem, defaultSave, sanitizeSave, syncUnlocks, type KeyValueStorage, type SaveData } from '../../src/game/systems/SaveSystem';
import {
  CLASSIC,
  COSTUMES,
  MEDAL_TIMES,
  UNLOCK_RULES,
  betterMedal,
  collectionStats,
  costumeTexture,
  describeUnlock,
  earnedUnlocks,
  isCharacterUnlocked,
  isCostumeUnlocked,
  medalFor,
  nextMedal,
  ruleMet,
  selectedCostume,
} from '../../src/game/systems/Rewards';
import { CHARACTER_IDS } from '../../src/game/types';
import { CHARACTERS } from '../../src/game/characters';
import { LEVELS } from '../../src/game/data/levels';
import { STORAGE_KEY } from '../../src/game/config';
import { formatTarget } from '../../src/game/ui/format';
import MANIFEST from '../../public/assets/manifest.json';

class MemStorage implements KeyValueStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

/** A save with `levels` cleared (time, souvenirs, medal). */
function withLevels(levels: Record<string, Partial<SaveData['levels'][string]>>, extra: Partial<SaveData> = {}): SaveData {
  const d = defaultSave();
  for (const [id, r] of Object.entries(levels)) d.levels[id] = { completed: true, souvenirs: [], stars: 0, ...r };
  return { ...d, ...extra };
}

describe('medals', () => {
  it('every registered level has ordered target times', () => {
    for (const l of LEVELS) {
      const t = MEDAL_TIMES[l.id];
      expect(t, l.id).toBeDefined();
      expect(t.gold).toBeGreaterThan(10_000);
      expect(t.gold).toBeLessThan(t.silver);
      expect(t.silver).toBeLessThan(t.bronze);
    }
  });

  it('medalFor picks the best medal the time qualifies for (boundaries inclusive)', () => {
    const t = MEDAL_TIMES['loop-1'];
    expect(medalFor('loop-1', t.gold)).toBe('gold');
    expect(medalFor('loop-1', t.gold + 1)).toBe('silver');
    expect(medalFor('loop-1', t.silver)).toBe('silver');
    expect(medalFor('loop-1', t.bronze)).toBe('bronze');
    expect(medalFor('loop-1', t.bronze + 1)).toBeNull();
    expect(medalFor('loop-1', 0)).toBeNull();
    expect(medalFor('test', 1000)).toBeNull(); // no targets for the dev level
  });

  it('betterMedal / nextMedal', () => {
    expect(betterMedal('bronze', 'gold')).toBe('gold');
    expect(betterMedal('silver', null)).toBe('silver');
    expect(betterMedal(undefined, null)).toBeUndefined();
    expect(nextMedal('loop-1', undefined)).toEqual({ medal: 'bronze', timeMs: MEDAL_TIMES['loop-1'].bronze });
    expect(nextMedal('loop-1', 'silver')).toEqual({ medal: 'gold', timeMs: MEDAL_TIMES['loop-1'].gold });
    expect(nextMedal('loop-1', 'gold')).toBeUndefined();
  });

  it('formatTarget shows whole seconds', () => {
    expect(formatTarget(35_000)).toBe('0:35');
    expect(formatTarget(75_000)).toBe('1:15');
  });
});

describe('unlock rules', () => {
  it('a fresh save has the five starting heroes, classic outfits only', () => {
    const d = defaultSave();
    for (const id of CHARACTER_IDS) expect(isCharacterUnlocked(d, id)).toBe(id !== 'grandma');
    for (const id of CHARACTER_IDS) {
      expect(isCostumeUnlocked(d, id, CLASSIC)).toBe(true);
      for (const c of COSTUMES[id]) expect(isCostumeUnlocked(d, id, c.id)).toBe(false);
    }
    expect(earnedUnlocks(d)).toEqual([]);
    expect(UNLOCK_RULES.map((r) => ruleMet(d, r.id))).toEqual([false, false, false, false]);
  });

  it('every character has 3 costumes, one per tier, with distinct ids', () => {
    for (const id of CHARACTER_IDS) {
      expect(COSTUMES[id].map((c) => c.tier)).toEqual([1, 2, 3]);
      expect(new Set(COSTUMES[id].map((c) => c.id)).size).toBe(3);
    }
  });

  it('tier 1: clearing 1-2 unlocks the first outfit of every starting hero', () => {
    const d = withLevels({ 'loop-1': {}, 'loop-2': {} });
    expect(ruleMet(d, 'tier1')).toBe(true);
    expect(isCostumeUnlocked(d, 'dad', 'flame')).toBe(true);
    expect(isCostumeUnlocked(d, 'dad', 'raccoon')).toBe(false);
    const keys = earnedUnlocks(d);
    expect(keys).toContain('costume:parker-cap');
    // grandma's outfits are only announced once she is unlocked
    expect(keys.some((k) => k.startsWith('costume:grandma'))).toBe(false);
  });

  it('tier 2: six souvenirs (Chicago Stars count too)', () => {
    expect(ruleMet(withLevels({ 'loop-1': { souvenirs: [0, 1, 2] }, 'loop-2': { souvenirs: [0, 1] } }), 'tier2')).toBe(false);
    expect(ruleMet(withLevels({ 'loop-1': { souvenirs: [0, 1, 2] }, 'loop-2': { souvenirs: [0, 1, 2] } }), 'tier2')).toBe(true);
    expect(ruleMet(withLevels({ 'loop-1': { souvenirs: [0, 1, 2], stars: 3 } }), 'tier2')).toBe(true);
    // souvenirs of unregistered levels (dev test map) don't count
    expect(collectionStats(withLevels({ test: { souvenirs: [0, 1, 2] } })).souvenirs).toBe(0);
  });

  it('tier 3: three gold medals', () => {
    const two = withLevels({ 'loop-1': { medal: 'gold' }, 'loop-2': { medal: 'gold' }, 'loop-3': { medal: 'silver' } });
    expect(ruleMet(two, 'tier3')).toBe(false);
    two.levels['loop-3'].medal = 'gold';
    expect(ruleMet(two, 'tier3')).toBe(true);
    expect(isCostumeUnlocked(two, 'mom', 'chef')).toBe(true);
  });

  it('grandma: beating the boss (world complete or boss level cleared)', () => {
    expect(isCharacterUnlocked(withLevels({}, { worldsCompleted: [1] }), 'grandma')).toBe(true);
    expect(isCharacterUnlocked(withLevels({ 'loop-boss': {} }), 'grandma')).toBe(true);
    expect(isCharacterUnlocked(withLevels({ 'loop-3': {} }), 'grandma')).toBe(false);
    // once earned it is remembered even if the progress were somehow lost
    const d = defaultSave();
    d.unlockedCharacters = ['grandma'];
    expect(isCharacterUnlocked(d, 'grandma')).toBe(true);
  });

  it('selected costume falls back to classic when locked; texture keys', () => {
    const d = defaultSave();
    d.costumes.dad = 'hardhat';
    expect(selectedCostume(d, 'dad')).toBe(CLASSIC);
    d.levels['loop-1'] = { completed: true, souvenirs: [], stars: 0, medal: 'gold' };
    d.levels['loop-2'] = { completed: true, souvenirs: [], stars: 0, medal: 'gold' };
    d.levels['loop-3'] = { completed: true, souvenirs: [], stars: 0, medal: 'gold' };
    expect(selectedCostume(d, 'dad')).toBe('hardhat');
    expect(costumeTexture('dad', 'hardhat')).toBe('dad-hardhat');
    expect(costumeTexture('dad', CLASSIC)).toBe('dad');
  });

  it('describeUnlock parses keys', () => {
    expect(describeUnlock('char:grandma')).toMatchObject({ kind: 'character', character: 'grandma' });
    expect(describeUnlock('costume:lupin-bee')).toMatchObject({ kind: 'costume', character: 'lupin', costume: 'bee', label: 'BUMBLE PUP' });
    expect(describeUnlock('costume:dad-tutu')).toBeUndefined();
    expect(describeUnlock('char:bowser')).toBeUndefined();
  });

  it('every costume has its atlas + portrait in the manifest', () => {
    const keys = new Set([...MANIFEST.atlases.map((a) => a.key), ...MANIFEST.images.map((i) => i.key)]);
    for (const id of CHARACTER_IDS) {
      expect(keys.has(id), id).toBe(true);
      expect(keys.has(`portrait-${id}`), id).toBe(true);
      for (const c of COSTUMES[id]) {
        const key = costumeTexture(id, c.id);
        expect(keys.has(key), key).toBe(true);
        expect(keys.has(`portrait-${key}`), key).toBe(true);
      }
    }
    expect(CHARACTERS.grandma.ability).toBe('panSpin');
  });
});

describe('SaveSystem rewards fields', () => {
  it('defaults', () => {
    const d = defaultSave();
    expect(d.unlockedCharacters).toEqual([]);
    expect(d.costumes).toEqual({});
    expect(d.unlocks).toEqual([]);
    expect(d.newUnlocks).toEqual([]);
  });

  it('an old save without the new fields loads with defaults (and unlocks retroactively)', () => {
    const old = {
      version: 1,
      selectedCharacter: 'mom',
      unlocked: ['loop-1', 'loop-2', 'loop-3', 'loop-boss'],
      levels: {
        'loop-1': { completed: true, bestTimeMs: 50000, souvenirs: [0, 1, 2], stars: 0 },
        'loop-2': { completed: true, bestTimeMs: 50000, souvenirs: [0, 1, 2], stars: 0 },
      },
      totalCoins: 5,
      worldsCompleted: [],
      settings: { musicVolume: 0.5 },
    };
    const s = new MemStorage();
    s.setItem(STORAGE_KEY, JSON.stringify(old));
    const d = new SaveSystem(s).get();
    expect(d.selectedCharacter).toBe('mom');
    expect(d.levels['loop-1'].medal).toBeUndefined(); // medals only from new runs
    expect(d.costumes).toEqual({});
    expect(d.unlockedCharacters).toEqual([]);
    // tier 1 (1-2 cleared) + tier 2 (6 souvenirs) for the five starting heroes
    expect(d.unlocks).toHaveLength(10);
    expect(d.newUnlocks).toEqual(d.unlocks);
  });

  it('sanitises malformed reward fields', () => {
    const d = sanitizeSave({
      version: 1,
      selectedCharacter: 'grandma', // locked → falls back to dad
      unlockedCharacters: ['grandma', 'bowser', 7, 'dad'],
      costumes: { dad: 'hardhat', mom: 'tutu', luigi: 'cap', parker: 5, lupin: '' },
      unlocks: ['char:grandma', 'costume:dad-flame', 'costume:dad-tutu', 42, 'char:grandma'],
      newUnlocks: ['costume:dad-flame', 'costume:mom-cat'],
      levels: { 'loop-1': { completed: true, souvenirs: [], stars: 0, medal: 'platinum' }, 'loop-2': { completed: true, souvenirs: [], stars: 0, medal: 'silver' } },
    });
    expect(d.unlockedCharacters).toEqual(['grandma']);
    expect(d.selectedCharacter).toBe('grandma'); // grandma is in unlockedCharacters → allowed
    expect(d.costumes).toEqual({ dad: 'hardhat', lupin: '' });
    expect(d.unlocks).toEqual(['char:grandma', 'costume:dad-flame']);
    expect(d.newUnlocks).toEqual(['costume:dad-flame']); // must be a subset of unlocks
    expect(d.levels['loop-1'].medal).toBeUndefined();
    expect('medal' in d.levels['loop-1']).toBe(false);
    expect(d.levels['loop-2'].medal).toBe('silver');

    const locked = sanitizeSave({ version: 1, selectedCharacter: 'grandma' });
    expect(locked.selectedCharacter).toBe('dad');
    for (const bad of [null, 'x', { costumes: 'dad' }, { unlocks: 'char:grandma' }, { unlockedCharacters: {} }]) {
      expect(() => sanitizeSave(bad)).not.toThrow();
    }
  });

  it('recordCompletion stores the best medal and reports new unlocks once', () => {
    const s = new MemStorage();
    const sys = new SaveSystem(s);
    const t = MEDAL_TIMES['loop-1'];
    sys.recordCompletion('loop-1', { timeMs: t.silver, coins: 0, souvenirs: [], stars: 0, next: 'loop-2' });
    expect(sys.get().levels['loop-1'].medal).toBe('silver');
    expect(sys.lastCompletion).toMatchObject({ levelId: 'loop-1', medal: 'silver', previousMedal: undefined, unlocked: [] });
    // slower run keeps silver
    sys.recordCompletion('loop-1', { timeMs: t.bronze + 5000, coins: 0, souvenirs: [], stars: 0 });
    expect(sys.get().levels['loop-1'].medal).toBe('silver');
    expect(sys.lastCompletion?.medal).toBeNull();
    // gold upgrades
    sys.recordCompletion('loop-1', { timeMs: t.gold - 1, coins: 0, souvenirs: [], stars: 0 });
    expect(sys.get().levels['loop-1'].medal).toBe('gold');
    expect(sys.lastCompletion?.previousMedal).toBe('silver');

    // clearing 1-2 unlocks the tier-1 outfits — reported exactly once
    sys.recordCompletion('loop-2', { timeMs: 999_999, coins: 0, souvenirs: [], stars: 0, next: 'loop-3' });
    expect(sys.lastCompletion?.unlocked.sort()).toEqual(
      ['brennan-knight', 'dad-flame', 'lupin-cape', 'mom-wand', 'parker-cap'].map((k) => `costume:${k}`),
    );
    sys.recordCompletion('loop-2', { timeMs: 999_999, coins: 0, souvenirs: [], stars: 0 });
    expect(sys.lastCompletion?.unlocked).toEqual([]);

    // beating the boss: grandma + her tier-1 outfit
    sys.recordCompletion('loop-boss', { timeMs: 999_999, coins: 0, souvenirs: [], stars: 0, world: 1, worldComplete: true });
    expect(sys.lastCompletion?.unlocked).toEqual(['char:grandma', 'costume:grandma-princess']);
    expect(sys.get().unlockedCharacters).toEqual(['grandma']);
    // persisted
    const stored = JSON.parse(s.getItem(STORAGE_KEY)!);
    expect(stored.unlockedCharacters).toEqual(['grandma']);
    expect(stored.levels['loop-1'].medal).toBe('gold');
    // seen badges
    sys.markSeen(['char:grandma']);
    expect(sys.get().newUnlocks).not.toContain('char:grandma');
    expect(sys.get().unlocks).toContain('char:grandma');
  });

  it('reset clears rewards but keeps settings', () => {
    const sys = new SaveSystem(new MemStorage());
    sys.update((d) => {
      d.costumes.dad = 'flame';
      d.unlocks.push('costume:dad-flame');
      d.settings.muted = true;
    });
    sys.reset();
    expect(sys.get().costumes).toEqual({});
    expect(sys.get().unlocks).toEqual([]);
    expect(sys.get().settings.muted).toBe(true);
  });

  it('syncUnlocks is idempotent', () => {
    const d = withLevels({ 'loop-2': {} });
    expect(syncUnlocks(d)).toHaveLength(5);
    expect(syncUnlocks(d)).toEqual([]);
  });
});
