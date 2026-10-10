import { describe, expect, it } from 'vitest';
import {
  PhaseCycle,
  TURNSTILE_TIMING,
  aimVelocity,
  applyStatOverrides,
  bossPhaseForHp,
  eliminatorTiming,
  hoverOffset,
  isInFront,
  isStomp,
  kickDirection,
  pickEliminatorAttack,
  playerBeneath,
  propNum,
  shellHurtsPlayer,
  shieldBlocks,
  stompTolerance,
  telegraphBlink,
  turnstileStatus,
} from '../../src/game/enemies/ai';

describe('isStomp', () => {
  it('accepts a falling player whose feet were above the enemy top', () => {
    expect(isStomp({ bottom: 102, prevBottom: 98, vy: 200 }, { top: 100 })).toBe(true);
  });
  it('is generous: feet slightly below the top last frame still count', () => {
    expect(isStomp({ bottom: 110, prevBottom: 106, vy: 300 }, { top: 100, height: 20 })).toBe(true);
  });
  it('rejects side hits (feet well below the top)', () => {
    expect(isStomp({ bottom: 130, prevBottom: 128, vy: 50 }, { top: 100, height: 20 })).toBe(false);
  });
  it('rejects a rising player', () => {
    expect(isStomp({ bottom: 101, prevBottom: 105, vy: -200 }, { top: 100 })).toBe(false);
  });
  it('accepts the jump apex just above the enemy', () => {
    expect(isStomp({ bottom: 101, prevBottom: 101, vy: -10 }, { top: 100 })).toBe(true);
  });
  it('uses the lower of current/previous enemy top (enemy moving down)', () => {
    expect(isStomp({ bottom: 112, prevBottom: 111, vy: 100 }, { top: 104, prevTop: 100, height: 16 })).toBe(true);
  });
  it('tolerance scales with enemy height within [8, 16]', () => {
    expect(stompTolerance(4)).toBe(8);
    expect(stompTolerance(24)).toBe(12);
    expect(stompTolerance(100)).toBe(16);
  });
});

describe('boss phases', () => {
  it('maps hp to phase with thresholds 8 and 4', () => {
    expect(bossPhaseForHp(12, [8, 4])).toBe(1);
    expect(bossPhaseForHp(9, [8, 4])).toBe(1);
    expect(bossPhaseForHp(8, [8, 4])).toBe(2);
    expect(bossPhaseForHp(5, [8, 4])).toBe(2);
    expect(bossPhaseForHp(4, [8, 4])).toBe(3);
    expect(bossPhaseForHp(1, [8, 4])).toBe(3);
  });
  it('later phases are faster but keep telegraphs readable (>= 0.6 s) and vulnerable windows >= 1.5 s', () => {
    const [a, b, c] = [1, 2, 3].map(eliminatorTiming);
    expect(c.telegraphMs).toBeLessThanOrEqual(a.telegraphMs);
    expect(c.sweepSpeed).toBeGreaterThan(a.sweepSpeed);
    for (const t of [a, b, c]) {
      expect(t.telegraphMs).toBeGreaterThanOrEqual(600);
      expect(t.debrisWarnMs).toBeGreaterThanOrEqual(800);
      expect(t.vulnerableMs).toBeGreaterThanOrEqual(1500);
    }
    expect(a.maxDrones).toBe(0);
    expect(c.maxDrones).toBe(2);
  });
  it('attack selection respects phase pools and never repeats', () => {
    for (let r = 0; r < 1; r += 0.05) {
      expect(['sweepLow', 'sweepHigh']).toContain(pickEliminatorAttack(1, null, r));
      expect(pickEliminatorAttack(2, 'debris', r)).not.toBe('debris');
      expect(pickEliminatorAttack(3, 'sweepLow', r, 2)).not.toBe('drones');
    }
    const p2 = new Set<string>();
    const p3 = new Set<string>();
    for (let r = 0; r < 1; r += 0.01) {
      p2.add(pickEliminatorAttack(2, null, r));
      p3.add(pickEliminatorAttack(3, null, r, 0));
    }
    expect([...p2].sort()).toEqual(['debris', 'shockwave', 'sweepHigh', 'sweepLow']);
    expect(p3.has('drones')).toBe(true);
    expect(pickEliminatorAttack(1, 'sweepLow', 1)).toBe('sweepHigh');
  });
});

describe('telegraphs and cycles', () => {
  it('telegraph blink toggles and ends ON', () => {
    const samples = Array.from({ length: 40 }, (_, i) => telegraphBlink(i * 20, 800));
    expect(samples.includes(true)).toBe(true);
    expect(samples.includes(false)).toBe(true);
    expect(telegraphBlink(800, 800)).toBe(true);
  });
  it('turnstile: rest 1.5 s (warning in the last 0.45 s), spin 1.5 s, repeating', () => {
    const c = new PhaseCycle<'spin' | 'rest'>([
      { state: 'rest', ms: TURNSTILE_TIMING.restMs },
      { state: 'spin', ms: TURNSTILE_TIMING.spinMs },
    ]);
    expect(turnstileStatus(c)).toEqual({ spinning: false, warning: false, stompable: true });
    c.update(1100);
    expect(turnstileStatus(c).warning).toBe(true);
    expect(turnstileStatus(c).stompable).toBe(true);
    c.update(500);
    expect(turnstileStatus(c)).toEqual({ spinning: true, warning: false, stompable: false });
    c.update(1500);
    expect(c.state).toBe('rest');
    expect(c.elapsed).toBeCloseTo(100);
  });
  it('phase cycle offset', () => {
    const c = new PhaseCycle([{ state: 'a', ms: 100 }, { state: 'b', ms: 100 }], 150);
    expect(c.state).toBe('b');
    expect(c.remaining).toBe(50);
  });
});

describe('geometry helpers', () => {
  it('aimVelocity has the requested speed and direction', () => {
    const v = aimVelocity(0, 0, 30, 40, 100);
    expect(Math.hypot(v.vx, v.vy)).toBeCloseTo(100);
    expect(v.vx).toBeCloseTo(60);
    expect(v.vy).toBeCloseTo(80);
    expect(aimVelocity(5, 5, 5, 5, 50)).toEqual({ vx: 0, vy: 0 });
  });
  it('hoverOffset is bounded by amplitude', () => {
    for (let t = 0; t < 5000; t += 37) expect(Math.abs(hoverOffset(t, 6, 1100))).toBeLessThanOrEqual(6);
  });
  it('isInFront / shieldBlocks', () => {
    expect(isInFront(100, 1, 120)).toBe(true);
    expect(isInFront(100, -1, 120)).toBe(false);
    expect(shieldBlocks(true, 100, -1, 'projectile', 80)).toBe(true);
    expect(shieldBlocks(true, 100, -1, 'projectile', 120)).toBe(false);
    expect(shieldBlocks(true, 100, -1, 'stomp', 80)).toBe(false);
    expect(shieldBlocks(true, 100, -1, 'contact', 80)).toBe(false);
    expect(shieldBlocks(false, 100, -1, 'melee', 80)).toBe(false);
  });
  it('window washer trigger: only when the player is below and close', () => {
    expect(playerBeneath(100, 100, 110, 200)).toBe(true);
    expect(playerBeneath(100, 100, 160, 200)).toBe(false);
    expect(playerBeneath(100, 100, 100, 90)).toBe(false);
    expect(playerBeneath(100, 100, 100, 400)).toBe(false);
  });
});

describe('cone shell rules', () => {
  it('kicks away from the player', () => {
    expect(kickDirection(100, 90, -1)).toBe(1);
    expect(kickDirection(100, 110, 1)).toBe(-1);
    expect(kickDirection(100, 100, -1)).toBe(-1);
  });
  it('a moving shell only hurts when heading toward the player after the kick grace', () => {
    expect(shellHurtsPlayer(200, 100, 150, 1000)).toBe(true);
    expect(shellHurtsPlayer(200, 100, 50, 1000)).toBe(false);
    expect(shellHurtsPlayer(200, 100, 150, 100)).toBe(false);
    expect(shellHurtsPlayer(0, 100, 150, 1000)).toBe(false);
  });
});

describe('spawn property overrides', () => {
  it('reads hp and damage overrides', () => {
    expect(applyStatOverrides({ hp: 2, contactDamage: 1 }, {})).toEqual({ hp: 2, contactDamage: 1 });
    expect(applyStatOverrides({ hp: 2, contactDamage: 1 }, { hp: 5, damage: 2 })).toEqual({ hp: 5, contactDamage: 2 });
    expect(applyStatOverrides({ hp: 2, contactDamage: 1 }, { hp: '3', damage: 'x' })).toEqual({ hp: 3, contactDamage: 1 });
    expect(applyStatOverrides({ hp: 2, contactDamage: 1 }, { hp: 0 })).toEqual({ hp: 1, contactDamage: 1 });
  });
  it('propNum', () => {
    expect(propNum({ range: 40 }, 'range', 10)).toBe(40);
    expect(propNum({ range: '' }, 'range', 10)).toBe(10);
    expect(propNum({}, 'range', 10)).toBe(10);
  });
});
