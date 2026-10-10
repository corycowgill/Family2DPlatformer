import { describe, expect, it } from 'vitest';
import { SAVE_VERSION } from '../../src/game/config';
import { DEFAULT_SETTINGS, sanitizeSave } from '../../src/game/systems/SaveSystem';
import { fxRng, hash01, hitStopFrames, moodFor, shadowLook, surfaceBelow, THEME_MOOD } from '../../src/game/fx/fxMath';

describe('fx: shadowLook', () => {
  it('is full size on the ground and shrinks / fades with height', () => {
    const g = shadowLook(0, 100, 0.5);
    expect(g.visible).toBe(true);
    expect(g.scale).toBe(1);
    expect(g.alpha).toBeCloseTo(0.5);
    const mid = shadowLook(50, 100, 0.5);
    expect(mid.scale).toBeLessThan(1);
    expect(mid.scale).toBeGreaterThan(0.45);
    expect(mid.alpha).toBeLessThan(g.alpha);
    const hi = shadowLook(99, 100, 0.5);
    expect(hi.alpha).toBeLessThan(mid.alpha);
  });
  it('hides above the max height and for bogus input', () => {
    expect(shadowLook(101, 100, 0.5).visible).toBe(false);
    expect(shadowLook(Number.NaN, 100, 0.5).visible).toBe(false);
    expect(shadowLook(10, 0, 0.5).visible).toBe(false);
    expect(shadowLook(-20, 100, 0.5).visible).toBe(false); // surface far above the feet
  });
});

describe('fx: surfaceBelow', () => {
  // 10 rows; solid floor at row 8, a ledge at row 4 for tx 2.
  const solid = (tx: number, ty: number) => ty === 8 || (tx === 2 && ty === 4);
  it('finds the floor under a standing caster', () => {
    expect(surfaceBelow(5, 128, 100, 16, 10, solid)).toBe(128);
    expect(surfaceBelow(5, 129, 100, 16, 10, solid)).toBe(128); // sunk 1 px (ground stick)
  });
  it('finds the first surface below an airborne caster', () => {
    expect(surfaceBelow(5, 80, 100, 16, 10, solid)).toBe(128);
    expect(surfaceBelow(40, 40, 100, 16, 10, solid)).toBe(64); // tx 2 → ledge
    expect(surfaceBelow(40, 70, 100, 16, 10, solid)).toBe(128); // below the ledge
  });
  it('returns null over pits / beyond range / outside the map', () => {
    expect(surfaceBelow(5, 40, 50, 16, 10, solid)).toBeNull();
    expect(surfaceBelow(5, 140, 100, 16, 10, solid)).toBeNull();
    expect(surfaceBelow(5, 0, 400, 16, 4, solid)).toBeNull();
  });
});

describe('fx: helpers', () => {
  it('fxRng is deterministic and in [0,1)', () => {
    const a = fxRng(42);
    const b = fxRng(42);
    for (let i = 0; i < 50; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('hash01 is stable, in range, and varies between neighbouring coins', () => {
    expect(hash01(100, 50)).toBe(hash01(100, 50));
    const row = [0, 1, 2, 3, 4, 5].map((i) => hash01(200 + i * 16, 120));
    for (const v of row) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of row) expect(v).toBeLessThan(1);
    expect(new Set(row.map((v) => Math.floor(v * 6))).size).toBeGreaterThan(2);
  });
  it('every theme has a mood; unknown themes fall back to day; sunset is graded', () => {
    for (const t of ['day', 'rooftop', 'river', 'sunset']) expect(THEME_MOOD[t]).toBeDefined();
    expect(moodFor('nope')).toBe(THEME_MOOD.day);
    expect(moodFor('sunset').grade).not.toBeNull();
    expect(moodFor('day').grade).toBeNull();
    for (const m of Object.values(THEME_MOOD)) expect(m.vignette).toBeLessThanOrEqual(0.5);
  });
  it('hit-stop stays within 1-3 frames', () => {
    for (const e of ['stomp', 'defeat', 'bossHit'] as const) {
      expect(hitStopFrames(e)).toBeGreaterThanOrEqual(1);
      expect(hitStopFrames(e)).toBeLessThanOrEqual(3);
    }
  });
});

describe('settings.effects', () => {
  it("defaults to 'high' and sanitises bad values", () => {
    expect(DEFAULT_SETTINGS.effects).toBe('high');
    const s = (settings: unknown) => sanitizeSave({ version: SAVE_VERSION, settings }).settings.effects;
    expect(s({ effects: 'low' })).toBe('low');
    expect(s({ effects: 'high' })).toBe('high');
    expect(s({ effects: 'ultra' })).toBe('high');
    expect(s({ effects: 1 })).toBe('high');
    expect(s({})).toBe('high');
  });
});
