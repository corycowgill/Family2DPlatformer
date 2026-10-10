import { describe, expect, it, vi } from 'vitest';
import { SAVE_VERSION, STORAGE_KEY } from '../../src/game/config';
import { FIRST_LEVEL_ID } from '../../src/game/data/levels';
import {
  DEFAULT_SETTINGS,
  SaveSystem,
  defaultSave,
  sanitizeSave,
  type KeyValueStorage,
} from '../../src/game/systems/SaveSystem';

class MemStorage implements KeyValueStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const withRaw = (raw: string) => {
  const s = new MemStorage();
  s.setItem(STORAGE_KEY, raw);
  return s;
};

describe('SaveSystem defaults', () => {
  it('starts with sensible defaults on empty storage', () => {
    const sys = new SaveSystem(new MemStorage());
    const d = sys.get();
    expect(d.version).toBe(SAVE_VERSION);
    expect(d.selectedCharacter).toBe('dad');
    expect(d.unlocked).toEqual([FIRST_LEVEL_ID]);
    expect(d.levels).toEqual({});
    expect(d.totalCoins).toBe(0);
    expect(d.worldsCompleted).toEqual([]);
    expect(d.settings).toEqual(DEFAULT_SETTINGS);
    expect(sys.hasProgress()).toBe(false);
    expect(sys.isUnlocked(FIRST_LEVEL_ID)).toBe(true);
    expect(sys.isUnlocked('loop-2')).toBe(false);
  });

  it('works with no storage at all', () => {
    const sys = new SaveSystem(null);
    expect(sys.get()).toEqual(defaultSave());
    expect(() => sys.update((d) => (d.totalCoins = 5))).not.toThrow();
    expect(sys.get().totalCoins).toBe(5);
  });

  it('defaultSave returns independent copies', () => {
    const a = defaultSave();
    a.settings.muted = true;
    a.unlocked.push('x');
    expect(defaultSave().settings.muted).toBe(false);
    expect(defaultSave().unlocked).toEqual([FIRST_LEVEL_ID]);
  });
});

describe('SaveSystem corrupted / malformed data', () => {
  it.each(['{not json', '', 'null', '42', '"str"', '[]', 'true'])('falls back to defaults for %j', (raw) => {
    const sys = new SaveSystem(withRaw(raw));
    expect(sys.get()).toEqual(defaultSave());
  });

  it('ignores wrongly typed fields individually', () => {
    const raw = {
      version: SAVE_VERSION,
      selectedCharacter: 'bowser',
      unlocked: ['loop-2', 7, null, 'loop-2'],
      levels: {
        'loop-1': { completed: 'yes', bestTimeMs: -5, souvenirs: [0, 1, 1, 5, 'a', 1.5], stars: 2.7 },
        'loop-2': null,
        'loop-3': 'oops',
      },
      totalCoins: -3,
      worldsCompleted: [1, 'two', 2.5],
      settings: { musicVolume: 7, sfxVolume: 'loud', muted: 'true', reducedMotion: true, showTouchControls: 'sometimes' },
    };
    const d = new SaveSystem(withRaw(JSON.stringify(raw))).get();
    expect(d.selectedCharacter).toBe('dad');
    expect(d.unlocked).toEqual([FIRST_LEVEL_ID, 'loop-2']);
    expect(d.levels['loop-1']).toEqual({ completed: false, bestTimeMs: undefined, souvenirs: [0, 1], stars: 2 });
    expect(d.levels['loop-2']).toBeUndefined();
    expect(d.levels['loop-3']).toBeUndefined();
    expect(d.totalCoins).toBe(0);
    expect(d.worldsCompleted).toEqual([1]);
    expect(d.settings).toEqual({
      musicVolume: 1,
      sfxVolume: DEFAULT_SETTINGS.sfxVolume,
      muted: false,
      reducedMotion: true,
      showTouchControls: 'auto',
      rumble: true,
      effects: 'high',
    });
  });

  it('rejects NaN / Infinity volumes', () => {
    const d = sanitizeSave({ version: SAVE_VERSION, settings: { musicVolume: null, sfxVolume: -1 } });
    expect(d.settings.musicVolume).toBe(DEFAULT_SETTINGS.musicVolume);
    expect(d.settings.sfxVolume).toBe(0);
  });

  it('keeps valid data intact (round trip)', () => {
    const storage = new MemStorage();
    const a = new SaveSystem(storage);
    a.update((d) => {
      d.selectedCharacter = 'lupin';
      d.settings.musicVolume = 0.2;
      d.settings.showTouchControls = 'off';
    });
    a.recordCompletion('loop-1', { timeMs: 1234, coins: 10, souvenirs: [2], stars: 1, next: 'loop-2' });
    const b = new SaveSystem(storage);
    expect(b.get()).toEqual(a.get());
    expect(sanitizeSave(JSON.parse(JSON.stringify(a.get())))).toEqual(a.get());
  });

  it('always keeps the first level unlocked', () => {
    const d = sanitizeSave({ version: SAVE_VERSION, unlocked: [] });
    expect(d.unlocked).toContain(FIRST_LEVEL_ID);
  });
});

describe('SaveSystem version handling', () => {
  it('non-numeric version starts fresh', () => {
    const d = sanitizeSave({ version: 'one', selectedCharacter: 'mom', totalCoins: 5 });
    expect(d).toEqual(defaultSave());
  });
  it('missing version starts fresh', () => {
    expect(sanitizeSave({ selectedCharacter: 'mom' })).toEqual(defaultSave());
  });
  it('unknown numeric version is sanitized field by field and stamped with the current version', () => {
    const d = sanitizeSave({ version: SAVE_VERSION + 1, selectedCharacter: 'mom' });
    expect(d.version).toBe(SAVE_VERSION);
    expect(d.selectedCharacter).toBe('mom');
  });
});

describe('SaveSystem.recordCompletion', () => {
  it('records completion, best times, souvenirs, stars, coins and unlocks', () => {
    const storage = new MemStorage();
    const sys = new SaveSystem(storage);
    expect(sys.recordCompletion('loop-1', { timeMs: 5000, coins: 10, souvenirs: [1], stars: 1, next: 'loop-2' })).toBe(true);
    let rec = sys.get().levels['loop-1'];
    expect(rec).toEqual({ completed: true, bestTimeMs: 5000, souvenirs: [1], stars: 1 });
    expect(sys.isUnlocked('loop-2')).toBe(true);
    expect(sys.hasProgress()).toBe(true);

    // Slower run: not a new best, but souvenirs merge, stars take max, coins accumulate.
    expect(sys.recordCompletion('loop-1', { timeMs: 6000, coins: 5, souvenirs: [0, 1], stars: 0, next: 'loop-2' })).toBe(false);
    rec = sys.get().levels['loop-1'];
    expect(rec.bestTimeMs).toBe(5000);
    expect(rec.souvenirs).toEqual([0, 1]);
    expect(rec.stars).toBe(1);
    expect(sys.get().totalCoins).toBe(15);
    expect(sys.get().unlocked.filter((u) => u === 'loop-2')).toHaveLength(1);

    // Faster run: new best.
    expect(sys.recordCompletion('loop-1', { timeMs: 4000, coins: 0, souvenirs: [2], stars: 3 })).toBe(true);
    rec = sys.get().levels['loop-1'];
    expect(rec.bestTimeMs).toBe(4000);
    expect(rec.souvenirs).toEqual([0, 1, 2]);
    expect(rec.stars).toBe(3);

    // Persisted.
    const stored = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(stored.levels['loop-1'].bestTimeMs).toBe(4000);
  });

  it('equal time is not a new best', () => {
    const sys = new SaveSystem(new MemStorage());
    sys.recordCompletion('loop-1', { timeMs: 100, coins: 0, souvenirs: [], stars: 0 });
    expect(sys.recordCompletion('loop-1', { timeMs: 100, coins: 0, souvenirs: [], stars: 0 })).toBe(false);
  });

  it('marks worlds complete only when flagged, without duplicates', () => {
    const sys = new SaveSystem(new MemStorage());
    sys.recordCompletion('loop-3', { timeMs: 1, coins: 0, souvenirs: [], stars: 0, world: 1 });
    expect(sys.get().worldsCompleted).toEqual([]);
    sys.recordCompletion('loop-boss', { timeMs: 1, coins: 0, souvenirs: [], stars: 0, world: 1, worldComplete: true });
    sys.recordCompletion('loop-boss', { timeMs: 1, coins: 0, souvenirs: [], stars: 0, world: 1, worldComplete: true });
    expect(sys.get().worldsCompleted).toEqual([1]);
  });

  it('reset keeps settings but clears progress', () => {
    const sys = new SaveSystem(new MemStorage());
    sys.update((d) => (d.settings.muted = true));
    sys.recordCompletion('loop-1', { timeMs: 1, coins: 3, souvenirs: [], stars: 0, next: 'loop-2' });
    sys.reset();
    expect(sys.hasProgress()).toBe(false);
    expect(sys.get().totalCoins).toBe(0);
    expect(sys.get().settings.muted).toBe(true);
  });
});

describe('SaveSystem with throwing storage', () => {
  const throwing: KeyValueStorage = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {
      throw new Error('nope');
    },
  };

  it('loads defaults when getItem throws', () => {
    const sys = new SaveSystem(throwing);
    expect(sys.get()).toEqual(defaultSave());
  });

  it('keeps working in memory when setItem throws', () => {
    const sys = new SaveSystem(throwing);
    expect(() => sys.recordCompletion('loop-1', { timeMs: 10, coins: 1, souvenirs: [], stars: 0, next: 'loop-2' })).not.toThrow();
    expect(sys.isUnlocked('loop-2')).toBe(true);
    expect(() => sys.reset()).not.toThrow();
  });

  it('writes JSON under the cfa-save key', () => {
    const storage = new MemStorage();
    const spy = vi.spyOn(storage, 'setItem');
    new SaveSystem(storage).save();
    expect(spy).toHaveBeenCalledWith('cfa-save', expect.any(String));
    expect(JSON.parse(spy.mock.calls[0][1])).toEqual(defaultSave());
  });
});
