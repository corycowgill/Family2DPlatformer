import { describe, expect, it, vi } from 'vitest';

// These modules import Phaser at the top level, which needs a browser. The functions
// under test are pure, so stub Phaser out.
vi.mock('phaser', () => ({ default: {} }));

const { groupFrames, animKey, strideTimeScale, STRIDE_SCALE_MAX, STRIDE_SCALE_MIN } = await import(
  '../../src/game/systems/AnimationSystem'
);
const { edge } = await import('../../src/game/systems/InputSystem');
const { isStomp } = await import('../../src/game/systems/CombatSystem');

describe('AnimationSystem.groupFrames', () => {
  it('groups by prefix and sorts numerically (not lexically)', () => {
    expect(groupFrames(['walk_10', 'walk_2', 'walk_0', 'walk_1', 'idle_0'])).toEqual({
      walk: ['walk_0', 'walk_1', 'walk_2', 'walk_10'],
      idle: ['idle_0'],
    });
  });
  it('keeps underscores inside animation names', () => {
    expect(groupFrames(['explosion_small_1', 'explosion_small_0', 'coin_burst_0'])).toEqual({
      explosion_small: ['explosion_small_0', 'explosion_small_1'],
      coin_burst: ['coin_burst_0'],
    });
  });
  it('ignores frames without a numeric suffix', () => {
    expect(groupFrames(['heart_full', 'heart_empty', 'logo', '__BASE', 'walk_'])).toEqual({});
  });
  it('handles empty input', () => {
    expect(groupFrames([])).toEqual({});
  });
  it('animKey joins atlas and anim', () => {
    expect(animKey('dad', 'walk')).toBe('dad:walk');
  });
  it('strideTimeScale keeps planted feet in step with ground speed', () => {
    // 4 px/frame at 14 fps = 56 px/s nominal
    expect(strideTimeScale(56, 4, 14)).toBeCloseTo(1);
    expect(strideTimeScale(-84, 4, 14)).toBeCloseTo(1.5); // direction does not matter
    expect(strideTimeScale(500, 4, 14)).toBe(STRIDE_SCALE_MAX);
    expect(strideTimeScale(0, 4, 14)).toBe(STRIDE_SCALE_MIN);
    expect(strideTimeScale(100, 0, 14)).toBe(1); // no stride metadata: plain playback
  });
});

describe('InputSystem.edge', () => {
  it('is true only on a rising edge', () => {
    expect(edge(false, true)).toBe(true);
    expect(edge(true, true)).toBe(false);
    expect(edge(true, false)).toBe(false);
    expect(edge(false, false)).toBe(false);
  });
  it('detects exactly one press per hold in a sequence', () => {
    const seq = [false, true, true, true, false, true, false, false, true];
    let prev = false;
    let presses = 0;
    for (const now of seq) {
      if (edge(prev, now)) presses++;
      prev = now;
    }
    expect(presses).toBe(3);
  });
});

describe('CombatSystem.isStomp', () => {
  const enemy = { top: 100 };
  it('falling onto the top is a stomp', () => {
    expect(isStomp({ bottom: 104, prevBottom: 99, vy: 200 }, enemy)).toBe(true);
  });
  it('within tolerance is a stomp, just outside is not', () => {
    expect(isStomp({ bottom: 112, prevBottom: 108, vy: 50 }, enemy)).toBe(true);
    expect(isStomp({ bottom: 112, prevBottom: 108.1, vy: 50 }, enemy)).toBe(false);
  });
  it('rising is not a stomp; standing still is only a stomp at the jump apex on top', () => {
    expect(isStomp({ bottom: 104, prevBottom: 99, vy: -100 }, enemy)).toBe(false);
    // Hovering at the apex with feet at the enemy's top counts (forgiving stomps)…
    expect(isStomp({ bottom: 104, prevBottom: 99, vy: 0 }, enemy)).toBe(true);
    // …but standing still beside it (feet below its top) does not.
    expect(isStomp({ bottom: 112, prevBottom: 112, vy: 0 }, enemy)).toBe(false);
  });
  it('side contact (feet well below enemy top) is not a stomp', () => {
    expect(isStomp({ bottom: 130, prevBottom: 128, vy: 300 }, enemy)).toBe(false);
  });
  it('respects a custom tolerance', () => {
    expect(isStomp({ bottom: 104, prevBottom: 102, vy: 10 }, enemy, 0)).toBe(false);
    expect(isStomp({ bottom: 104, prevBottom: 100, vy: 10 }, enemy, 0)).toBe(true);
  });
});
