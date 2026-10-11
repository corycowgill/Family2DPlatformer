import { describe, expect, it } from 'vitest';
import {
  OVERSEER_HP,
  OVERSEER_SCHEDULE,
  beamSweepPlan,
  beamX,
  boxHitsSegment,
  laserArms,
  laserFloorReach,
  opensWeakSpot,
  overseerAttack,
  overseerPhase,
  overseerThresholds,
  overseerTiming,
  segmentDistance,
  slamTargetX,
} from '../../src/game/enemies/overseerPlan';

describe('Overseer phases', () => {
  it('9 hp → three phases of three stomps each', () => {
    expect(OVERSEER_HP).toBe(9);
    expect(overseerThresholds(9)).toEqual([6, 3]);
    expect([9, 8, 7].map((h) => overseerPhase(h))).toEqual([1, 1, 1]);
    expect([6, 5, 4].map((h) => overseerPhase(h))).toEqual([2, 2, 2]);
    expect([3, 2, 1].map((h) => overseerPhase(h))).toEqual([3, 3, 3]);
  });

  it('thresholds scale with an hp override', () => {
    expect(overseerThresholds(12)).toEqual([8, 4]);
    expect(overseerPhase(8, 12)).toBe(2);
    expect(overseerPhase(4, 12)).toBe(3);
  });

  it('later phases are faster but every telegraph stays readable (>= 0.7 s) and windows stay fair (>= 2 s)', () => {
    const [p1, p2, p3] = [1, 2, 3].map(overseerTiming);
    expect(p2.idleMs).toBeLessThan(p1.idleMs);
    expect(p3.idleMs).toBeLessThan(p2.idleMs);
    for (const t of [p1, p2, p3]) {
      expect(t.beamWarnMs).toBeGreaterThanOrEqual(700);
      expect(t.slamWarnMs).toBeGreaterThanOrEqual(700);
      expect(t.laserWarnMs).toBeGreaterThanOrEqual(700);
      expect(t.vulnerableMs).toBeGreaterThanOrEqual(2000);
    }
    expect(p3.slams).toBe(2);
    expect(p3.maxWasps).toBeGreaterThan(0);
    expect(p1.maxWasps).toBe(0);
  });
});

describe('Overseer attack schedule', () => {
  it('phase signatures: beam first, then slam, then wasps + laser', () => {
    expect(overseerAttack(1, 0)).toBe('beam');
    expect(overseerAttack(2, 0)).toBe('slam');
    expect(OVERSEER_SCHEDULE[3]).toContain('laser');
    expect(OVERSEER_SCHEDULE[3]).toContain('wasps');
    expect(OVERSEER_SCHEDULE[1]).not.toContain('slam');
    expect(OVERSEER_SCHEDULE[1]).not.toContain('laser');
  });

  it('cycles the rotation', () => {
    const n = OVERSEER_SCHEDULE[2].length;
    for (let i = 0; i < n; i++) expect(overseerAttack(2, i + n)).toBe(overseerAttack(2, i));
  });

  it('skips summons while their minions are at the cap', () => {
    expect(overseerAttack(1, 1, { gnats: 0, wasps: 0 })).toBe('gnats');
    expect(overseerAttack(1, 1, { gnats: 2, wasps: 0 })).toBe('beam');
    expect(overseerAttack(3, 0, { gnats: 0, wasps: 2 })).toBe('laser');
  });

  it('every phase rotation opens the weak spot at least twice per cycle', () => {
    for (const p of [1, 2, 3] as const) {
      expect(OVERSEER_SCHEDULE[p].filter(opensWeakSpot).length).toBeGreaterThanOrEqual(2);
    }
    expect(opensWeakSpot('gnats')).toBe(false);
    expect(opensWeakSpot('wasps')).toBe(false);
  });
});

describe('Overseer attack geometry', () => {
  const ax = 704;
  const aw = 416;
  const mid = ax + aw / 2;

  it('tractor beam sweeps the player half, from the outer wall to the middle', () => {
    const left = beamSweepPlan(ax, aw, ax + 50);
    expect(left.fromX).toBeLessThan(left.toX);
    expect(left.toX).toBe(mid);
    expect(left.zoneMin).toBe(ax);
    const right = beamSweepPlan(ax, aw, ax + aw - 50);
    expect(right.fromX).toBeGreaterThan(right.toX);
    expect(right.zoneMax).toBe(ax + aw);
    // Eased, monotonic, ends exactly at the middle.
    let prev = beamX(left, 0, 1500);
    expect(prev).toBe(left.fromX);
    for (let t = 100; t <= 1500; t += 100) {
      const x = beamX(left, t, 1500);
      expect(x).toBeGreaterThanOrEqual(prev);
      prev = x;
    }
    expect(beamX(left, 5000, 1500)).toBe(mid);
  });

  it('the beam never catches a walking player who heads for the other half when it starts', () => {
    // Weakest walk speed in the game is ~90 px/s; the player reacts at the start of the warning.
    for (const phase of [1, 2, 3]) {
      const t = overseerTiming(phase);
      const plan = beamSweepPlan(ax, aw, ax + 20);
      for (let ms = 0; ms <= t.beamSweepMs; ms += 50) {
        const playerX = ax + 20 + (90 * (t.beamWarnMs + ms)) / 1000;
        const bx = beamX(plan, ms, t.beamSweepMs);
        expect(playerX - bx, `phase ${phase} at ${ms} ms`).toBeGreaterThan(9 + 6);
      }
    }
  });

  it('laser reach: the floor danger zone is narrower than the arena half', () => {
    const floor = 208;
    const reach = laserFloorReach(floor - 128, floor - 34, 136);
    expect(reach).toBeGreaterThan(60);
    expect(reach + 10).toBeLessThan(aw / 2 - 60);
    expect(laserFloorReach(0, 200, 100)).toBe(0);
  });

  it('laser arms are opposite segments of the given length', () => {
    const [a, b] = laserArms(100, 50, 0, 40);
    expect(a).toEqual([100, 50, 140, 50]);
    expect(b[2]).toBeCloseTo(60);
    expect(b[3]).toBeCloseTo(50);
  });

  it('segment distance and box hit test', () => {
    expect(segmentDistance(5, 5, 0, 0, 10, 0)).toBe(5);
    expect(segmentDistance(-3, 4, 0, 0, 10, 0)).toBe(5);
    const seg = [0, 0, 100, 0] as const;
    expect(boxHitsSegment(40, -10, 52, 20, seg)).toBe(true);
    expect(boxHitsSegment(40, 10, 52, 40, seg)).toBe(false);
    expect(boxHitsSegment(110, -10, 122, 20, seg)).toBe(false);
  });

  it('slam target stays inside the arena', () => {
    expect(slamTargetX(ax - 100, ax, aw)).toBe(ax + 40);
    expect(slamTargetX(ax + aw + 100, ax, aw)).toBe(ax + aw - 40);
    expect(slamTargetX(mid, ax, aw)).toBe(mid);
  });
});
