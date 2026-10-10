import { describe, expect, it } from 'vitest';
import { PHYSICS, TILE_SIZE } from '../../src/game/config';
import { EMPTY_INPUT, type InputState, CHARACTER_IDS } from '../../src/game/types';
import { CHARACTERS } from '../../src/game/characters';
import {
  createMotorState,
  stepHorizontal,
  stepVertical,
  tryJump,
  bonkCeiling,
  gravityFor,
  simulateArc,
  simulateJump,
  jumpReach,
  startAirJump,
  JUMP_LIMITS,
  MIN_JUMP_LIMITS,
  type MotorState,
} from '../../src/game/systems/PlayerMotor';

const DT = 1000 / 60;
const dad = CHARACTERS.dad.stats;
const inp = (o: Partial<InputState> = {}): InputState => ({ ...EMPTY_INPUT, ...o });

/** Advance the motor one frame the way Player.tick does (minus physics). Returns true if a jump started. */
function frame(s: MotorState, input: InputState): boolean {
  stepHorizontal(s, input, dad, DT);
  const jumped = tryJump(s, input, dad, DT);
  stepVertical(s, input, DT);
  return jumped;
}

function grounded(): MotorState {
  const s = createMotorState();
  s.grounded = true;
  s.sinceGroundedMs = 0;
  return s;
}

describe('horizontal movement', () => {
  it('accelerates monotonically to walk speed in ~0.1s and never overshoots', () => {
    const s = grounded();
    const speeds: number[] = [];
    for (let i = 0; i < 20; i++) {
      stepHorizontal(s, inp({ right: true }), dad, DT);
      speeds.push(s.vx);
    }
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeGreaterThanOrEqual(speeds[i - 1]);
    const framesToMax = speeds.findIndex((v) => v >= dad.walkSpeed) + 1;
    expect(framesToMax).toBeGreaterThan(3); // not instant: has some weight
    expect(framesToMax).toBeLessThanOrEqual(9); // but responsive (< 150ms)
    expect(Math.max(...speeds)).toBe(dad.walkSpeed);
  });

  it('reaches run speed when sprinting and decays gently back to walk speed on release', () => {
    const s = grounded();
    for (let i = 0; i < 30; i++) stepHorizontal(s, inp({ right: true, run: true }), dad, DT);
    expect(s.vx).toBe(dad.runSpeed);
    stepHorizontal(s, inp({ right: true }), dad, DT);
    expect(s.vx).toBeLessThan(dad.runSpeed);
    expect(s.vx).toBeGreaterThan(dad.walkSpeed);
  });

  it('stops predictably: under one tile from run speed, a few px from walk speed', () => {
    for (const [start, maxDist] of [
      [dad.runSpeed, TILE_SIZE],
      [dad.walkSpeed, 6],
    ] as const) {
      const s = grounded();
      s.vx = start;
      let x = 0;
      let frames = 0;
      while (s.vx > 0 && frames < 100) {
        stepHorizontal(s, inp(), dad, DT);
        x += (s.vx * DT) / 1000;
        frames++;
      }
      expect(s.vx).toBe(0);
      expect(x).toBeLessThan(maxDist);
      expect(frames * DT).toBeLessThan(200);
    }
  });

  it('turns around faster than it accelerates (skid)', () => {
    const s = grounded();
    s.vx = dad.walkSpeed;
    stepHorizontal(s, inp({ left: true }), dad, DT);
    expect(dad.walkSpeed - s.vx).toBeGreaterThan((dad.groundAccel * DT) / 1000);
    expect(s.facing).toBe(-1);
  });

  it('has reduced but non-zero air control', () => {
    const s = createMotorState();
    stepHorizontal(s, inp({ right: true }), dad, DT);
    expect(s.vx).toBeGreaterThan(0);
    expect(s.vx).toBeLessThan((dad.groundAccel * DT) / 1000 + 0.001);
  });

  it('knockback (low control) barely changes velocity and keeps facing', () => {
    const s = grounded();
    s.vx = -150;
    s.facing = -1;
    stepHorizontal(s, inp({ right: true }), dad, DT, { speedMult: 1, jumpMult: 1, control: 0.15 });
    expect(s.vx).toBeLessThan(-140);
    expect(s.facing).toBe(-1);
  });

  it('crouching on the ground slides to a stop', () => {
    const s = grounded();
    s.vx = 90;
    for (let i = 0; i < 20; i++) stepHorizontal(s, inp({ right: true, down: true }), dad, DT, undefined, true);
    expect(s.vx).toBe(0);
  });
});

describe('jumping', () => {
  it('jumps immediately when pressed on the ground', () => {
    const s = grounded();
    expect(frame(s, inp({ jump: true, jumpPressed: true }))).toBe(true);
    expect(s.vy).toBeLessThan(-dad.jumpVelocity + 30);
  });

  it(`allows a coyote jump within ${PHYSICS.coyoteTimeMs}ms of leaving a ledge but not after`, () => {
    for (const [delayMs, expected] of [
      [50, true],
      [90, true],
      [130, false],
      [200, false],
    ] as const) {
      const s = grounded();
      frame(s, inp({ right: true }));
      s.grounded = false; // walked off the ledge
      let t = 0;
      while (t + DT < delayMs) {
        frame(s, inp({ right: true }));
        t += DT;
      }
      const jumped = frame(s, inp({ right: true, jump: true, jumpPressed: true }));
      expect(jumped, `jump ${delayMs}ms after leaving ledge`).toBe(expected);
    }
  });

  it('does not allow a second coyote jump after jumping', () => {
    const s = grounded();
    frame(s, inp({ jump: true, jumpPressed: true }));
    frame(s, inp({ jump: false }));
    expect(frame(s, inp({ jump: true, jumpPressed: true }))).toBe(false);
  });

  it(`buffers a jump pressed up to ${PHYSICS.jumpBufferMs}ms before landing`, () => {
    for (const [earlyMs, expected] of [
      [16, true],
      [100, true],
      [115, true],
      [150, false],
      [250, false],
    ] as const) {
      const s = createMotorState();
      s.vy = 200; // falling
      frame(s, inp({ jump: true, jumpPressed: true }));
      let t = DT;
      while (t < earlyMs) {
        frame(s, inp({ jump: true }));
        t += DT;
      }
      s.grounded = true; // land
      s.vy = 0;
      const jumped = frame(s, inp({ jump: true }));
      expect(jumped, `pressed ${earlyMs}ms before landing`).toBe(expected);
    }
  });

  it('a buffered jump whose button was released is a short hop', () => {
    const s = createMotorState();
    s.vy = 100;
    frame(s, inp({ jump: true, jumpPressed: true }));
    frame(s, inp());
    s.grounded = true;
    expect(frame(s, inp())).toBe(true);
    expect(s.jumpCut).toBe(true);
  });

  it('variable height: tap ≈ 1.5 tiles, full hold > 3 tiles', () => {
    const tap = simulateJump(dad, { running: false, holdMs: 0 });
    const mid = simulateJump(dad, { running: false, holdMs: 120 });
    const full = simulateJump(dad, { running: false, holdMs: Infinity });
    expect(tap.peak).toBeGreaterThan(1.2 * TILE_SIZE);
    expect(tap.peak).toBeLessThan(1.8 * TILE_SIZE);
    expect(mid.peak).toBeGreaterThan(tap.peak);
    expect(full.peak).toBeGreaterThan(mid.peak);
    expect(full.peak).toBeGreaterThan(3 * TILE_SIZE);
    expect(full.peak).toBeGreaterThan(2 * tap.peak);
  });

  it('falls faster than it rises', () => {
    const arc = simulateArc(dad, { running: false, holdMs: Infinity });
    const apex = arc.reduce((a, p) => (p.h > a.h ? p : a));
    const last = arc[arc.length - 1];
    const riseMs = apex.t;
    const fallMs = last.t - apex.t;
    expect(fallMs).toBeLessThan(riseMs);
    const s = createMotorState();
    s.vy = 200;
    const fallG = gravityFor(s, false);
    s.vy = -200;
    s.jumping = true;
    expect(fallG).toBeGreaterThan(gravityFor(s, true));
  });

  it('hangs briefly at the apex while jump is held', () => {
    const s = createMotorState();
    s.vy = -20;
    s.jumping = true;
    expect(gravityFor(s, true)).toBeLessThan(PHYSICS.gravity);
    s.vy = 20;
    expect(gravityFor(s, true)).toBeLessThan(PHYSICS.gravity);
    expect(gravityFor(s, false)).toBe(PHYSICS.gravity * PHYSICS.fallGravityMult);
  });

  it('a running jump goes higher and further than a walking jump', () => {
    const walk = simulateJump(dad, { running: false, holdMs: Infinity });
    const run = simulateJump(dad, { running: true, holdMs: Infinity });
    expect(run.peak).toBeGreaterThan(walk.peak + 8);
    expect(run.distance).toBeGreaterThan(walk.distance * 1.5);
  });

  it('never exceeds max fall speed', () => {
    const s = createMotorState();
    for (let i = 0; i < 120; i++) stepVertical(s, inp(), DT);
    expect(s.vy).toBe(PHYSICS.maxFallSpeed);
  });

  it('ceiling bonk ends the rise and cancels the jump hold', () => {
    const s = grounded();
    frame(s, inp({ jump: true, jumpPressed: true }));
    bonkCeiling(s);
    expect(s.vy).toBeGreaterThanOrEqual(0);
    expect(s.jumping).toBe(false);
    frame(s, inp({ jump: true }));
    expect(s.vy).toBeGreaterThan(0);
  });

  it('landing zeroes vertical speed and ends the jump', () => {
    const s = createMotorState();
    s.vy = 300;
    s.jumping = true;
    s.grounded = true;
    stepVertical(s, inp({ jump: true }), DT);
    expect(s.vy).toBe(0);
    expect(s.jumping).toBe(false);
  });

  it('air jump adds a fresh upward velocity', () => {
    const s = createMotorState();
    s.vy = 150;
    startAirJump(s);
    expect(s.vy).toBe(-PHYSICS.airJumpVelocity);
    expect(s.jumping).toBe(true);
  });
});

describe('level-design jump limits (all characters, no abilities)', () => {
  for (const id of CHARACTER_IDS) {
    it(`${id} meets the design targets`, () => {
      const l = JUMP_LIMITS[id];
      expect(l.tapPeak).toBeGreaterThan(1.2 * TILE_SIZE);
      expect(l.tapPeak).toBeLessThan(1.8 * TILE_SIZE);
      expect(l.walkPeak).toBeGreaterThanOrEqual(3 * TILE_SIZE + 4); // clears 3 tiles
      expect(l.walkPeak).toBeLessThan(4 * TILE_SIZE); // …but not 4 without running
      expect(l.runPeak).toBeGreaterThanOrEqual(4 * TILE_SIZE + 4); // running clears 4 tiles
      expect(l.runPeak).toBeLessThan(5 * TILE_SIZE);
      expect(l.runGapTiles).toBeGreaterThanOrEqual(6);
      expect(l.runGapTiles).toBeLessThanOrEqual(8);
    });
  }

  it('differences between characters are modest', () => {
    const all = Object.values(JUMP_LIMITS);
    const spread = (k: 'walkPeak' | 'runPeak' | 'runDistance') => Math.max(...all.map((l) => l[k])) - Math.min(...all.map((l) => l[k]));
    expect(spread('walkPeak')).toBeLessThan(4);
    expect(spread('runPeak')).toBeLessThan(4);
    expect(spread('runDistance')).toBeLessThan(16);
  });

  it('matches the table documented in config.ts (update both when retuning)', () => {
    const documented: Record<string, [number, number, number, number]> = {
      dad: [24.5, 57.0, 75.0, 112.0],
      mom: [24.5, 57.0, 75.0, 108.5],
      brennan: [24.0, 55.7, 74.0, 119.0],
      parker: [24.5, 57.0, 75.0, 112.0],
      lupin: [24.2, 56.4, 74.3, 115.5],
    };
    for (const [id, [tap, walk, run, dist]] of Object.entries(documented)) {
      const l = JUMP_LIMITS[id as keyof typeof JUMP_LIMITS];
      expect(l.tapPeak).toBeCloseTo(tap, 0);
      expect(l.walkPeak).toBeCloseTo(walk, 0);
      expect(l.runPeak).toBeCloseTo(run, 0);
      expect(l.runDistance).toBeCloseTo(dist, 0);
    }
  });

  it('Mom air jump adds ~2.5 tiles', () => {
    expect(JUMP_LIMITS.mom.airJumpExtra).toBeGreaterThan(2.2 * TILE_SIZE);
    expect(JUMP_LIMITS.mom.airJumpExtra).toBeLessThan(2.8 * TILE_SIZE);
  });

  it('MIN_JUMP_LIMITS is the floor across characters', () => {
    expect(MIN_JUMP_LIMITS.runGapTiles).toBe(Math.min(...Object.values(JUMP_LIMITS).map((l) => l.runGapTiles)));
    expect(MIN_JUMP_LIMITS.runHeightTiles).toBe(4);
    expect(MIN_JUMP_LIMITS.walkHeightTiles).toBe(3);
  });

  it('jumpReach: landing higher means shorter reach, unreachable heights give 0', () => {
    const flat = jumpReach(dad, 0);
    const up3 = jumpReach(dad, 3 * TILE_SIZE);
    const down2 = jumpReach(dad, -2 * TILE_SIZE);
    expect(up3).toBeGreaterThan(0);
    expect(up3).toBeLessThan(flat);
    expect(down2).toBeGreaterThan(flat);
    expect(jumpReach(dad, 6 * TILE_SIZE)).toBe(0);
  });
});
