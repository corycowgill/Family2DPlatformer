import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, STORAGE_KEY } from '../../src/game/config';
import {
  DEFAULT_SETTINGS,
  SaveSystem,
  sanitizeSave,
  sanitizeSettings,
  type KeyValueStorage,
} from '../../src/game/systems/SaveSystem';
import {
  BOSS_SKIP_DEATHS,
  EXTRA_HEARTS,
  GAME_SPEEDS,
  SafeGroundTracker,
  assistAffectsRun,
  canSkipBoss,
  formatSpeed,
  livesAfterDeath,
  maxHealthWith,
  pitOutcome,
} from '../../src/game/systems/Assist';
import { ASSIST_MEDAL_CAP, MEDAL_TIMES, medalFor } from '../../src/game/systems/Rewards';

class MemStorage implements KeyValueStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

describe('assist / accessibility settings', () => {
  it('defaults: every assist OFF, screen shake ON, no flashing reduction, no outline', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      gameSpeed: 1,
      extraHearts: false,
      infiniteLives: false,
      safetyNet: false,
      bossSkip: false,
      autoRun: false,
      screenShake: true,
      reduceFlashing: false,
      highContrast: false,
    });
    expect(assistAffectsRun(DEFAULT_SETTINGS)).toBe(false);
  });

  it('migrates an old save (no assist fields) to the defaults and keeps the old settings', () => {
    const old = {
      version: SAVE_VERSION,
      selectedCharacter: 'mom',
      settings: { musicVolume: 0.3, sfxVolume: 0.5, muted: true, reducedMotion: true, showTouchControls: 'off', rumble: false, effects: 'low' },
    };
    const s = new MemStorage();
    s.setItem(STORAGE_KEY, JSON.stringify(old));
    const d = new SaveSystem(s).get();
    expect(d.settings).toEqual({
      ...DEFAULT_SETTINGS,
      musicVolume: 0.3,
      sfxVolume: 0.5,
      muted: true,
      reducedMotion: true,
      showTouchControls: 'off',
      rumble: false,
      effects: 'low',
    });
    // A save without any settings object at all.
    expect(sanitizeSave({ version: SAVE_VERSION }).settings).toEqual(DEFAULT_SETTINGS);
  });

  it('validates each new field and round-trips valid values', () => {
    const bad = sanitizeSettings({ gameSpeed: 0.5, extraHearts: 'yes', infiniteLives: 1, safetyNet: null, screenShake: 'no', highContrast: {} });
    expect(bad.gameSpeed).toBe(1);
    expect(bad.extraHearts).toBe(false);
    expect(bad.infiniteLives).toBe(false);
    expect(bad.safetyNet).toBe(false);
    expect(bad.screenShake).toBe(true);
    expect(bad.highContrast).toBe(false);

    const storage = new MemStorage();
    const a = new SaveSystem(storage);
    a.update((d) => {
      Object.assign(d.settings, {
        gameSpeed: 0.7, extraHearts: true, infiniteLives: true, safetyNet: true, bossSkip: true, autoRun: true,
        screenShake: false, reduceFlashing: true, highContrast: true,
      });
    });
    const b = new SaveSystem(storage).get().settings;
    expect(b).toEqual(a.get().settings);
    expect(b.gameSpeed).toBe(0.7);
    for (const sp of GAME_SPEEDS) expect(sanitizeSettings({ gameSpeed: sp }).gameSpeed).toBe(sp);
  });

  it('erasing the save keeps the settings (incl. assist)', () => {
    const sys = new SaveSystem(new MemStorage());
    sys.update((d) => (d.settings.safetyNet = true));
    sys.reset();
    expect(sys.get().settings.safetyNet).toBe(true);
  });
});

describe('assist rules', () => {
  const off = { ...DEFAULT_SETTINGS };

  it('assistAffectsRun: any run-changing assist marks the run (boss skip only when used)', () => {
    expect(assistAffectsRun({ ...off, gameSpeed: 0.85 })).toBe(true);
    expect(assistAffectsRun({ ...off, extraHearts: true })).toBe(true);
    expect(assistAffectsRun({ ...off, infiniteLives: true })).toBe(true);
    expect(assistAffectsRun({ ...off, safetyNet: true })).toBe(true);
    expect(assistAffectsRun({ ...off, autoRun: true })).toBe(true);
    expect(assistAffectsRun({ ...off, bossSkip: true })).toBe(false);
  });

  it('extra hearts, infinite lives, boss skip threshold', () => {
    expect(maxHealthWith(3, off)).toBe(3);
    expect(maxHealthWith(3, { extraHearts: true })).toBe(3 + EXTRA_HEARTS);
    expect(livesAfterDeath(5, off)).toBe(4);
    expect(livesAfterDeath(5, { infiniteLives: true })).toBe(5);
    expect(canSkipBoss({ bossSkip: true }, true, BOSS_SKIP_DEATHS - 1)).toBe(false);
    expect(canSkipBoss({ bossSkip: true }, true, BOSS_SKIP_DEATHS)).toBe(true);
    expect(canSkipBoss({ bossSkip: true }, false, 10)).toBe(false);
    expect(canSkipBoss({ bossSkip: false }, true, 10)).toBe(false);
    expect(formatSpeed(0.85)).toBe('85%');
  });

  it('pitOutcome: one heart of damage back on safe ground; the last heart is a real death', () => {
    const safe = { x: 40, y: 200 };
    expect(pitOutcome(true, 3, safe)).toEqual({ kind: 'rescue', x: 40, y: 200, health: 2 });
    expect(pitOutcome(true, 1, safe)).toEqual({ kind: 'die' });
    expect(pitOutcome(false, 3, safe)).toEqual({ kind: 'die' });
    expect(pitOutcome(true, 3, null)).toEqual({ kind: 'die' });
  });

  it('SafeGroundTracker keeps the last spot that was safe for the settle time', () => {
    const t = new SafeGroundTracker(100);
    expect(t.point).toBeNull();
    t.reset(10, 100);
    expect(t.point).toEqual({ x: 10, y: 100 });
    // Walking right on safe ground, one sample per 60 Hz step.
    let ms = 0;
    for (let x = 10; x <= 60; x += 2, ms += 1000 / 60) t.note({ x, y: 100, t: ms, safe: true });
    expect(t.point).toEqual({ x: 60, y: 100 });
    // Over the edge: unsafe samples never move the point.
    for (let x = 62; x < 90; x += 2, ms += 1000 / 60) t.note({ x, y: 100 + x, t: ms, safe: false });
    expect(t.point).toEqual({ x: 60, y: 100 });
    // A brief touch of safe ground (shorter than the settle time) doesn't count…
    t.note({ x: 200, y: 80, t: ms, safe: true });
    t.note({ x: 202, y: 80, t: ms + 50, safe: true });
    expect(t.point).toEqual({ x: 60, y: 100 });
    // …standing there does.
    t.note({ x: 204, y: 80, t: ms + 120, safe: true });
    expect(t.point).toEqual({ x: 204, y: 80 });
    // The returned point is a copy.
    t.point!.x = -1;
    expect(t.point!.x).toBe(204);
  });
});

describe('medal gating under assist', () => {
  const t = MEDAL_TIMES['loop-1'];
  it('an assisted gold time earns silver at best; other medals are unchanged', () => {
    expect(ASSIST_MEDAL_CAP).toBe('silver');
    expect(medalFor('loop-1', t.gold, true)).toBe('silver');
    expect(medalFor('loop-1', t.gold)).toBe('gold');
    expect(medalFor('loop-1', t.silver, true)).toBe('silver');
    expect(medalFor('loop-1', t.bronze, true)).toBe('bronze');
    expect(medalFor('loop-1', t.bronze + 1, true)).toBeNull();
  });

  it('recordCompletion: assisted clears never store gold; a skipped boss stores no medal or time', () => {
    const sys = new SaveSystem(new MemStorage());
    sys.recordCompletion('loop-1', { timeMs: t.gold - 1000, coins: 0, souvenirs: [], stars: 0, assisted: true });
    expect(sys.get().levels['loop-1'].medal).toBe('silver');
    expect(sys.lastCompletion?.assisted).toBe(true);
    // An unassisted gold later still upgrades it.
    sys.recordCompletion('loop-1', { timeMs: t.gold - 1000, coins: 0, souvenirs: [], stars: 0 });
    expect(sys.get().levels['loop-1'].medal).toBe('gold');
    expect(sys.lastCompletion?.assisted).toBe(false);

    sys.recordCompletion('loop-boss', { timeMs: 5000, coins: 0, souvenirs: [], stars: 0, assisted: true, skippedBoss: true, next: 'north-1' });
    const rec = sys.get().levels['loop-boss'];
    expect(rec.completed).toBe(true);
    expect(rec.medal).toBeUndefined();
    expect(rec.bestTimeMs).toBeUndefined();
    expect(sys.isUnlocked('north-1')).toBe(true);
  });
});
