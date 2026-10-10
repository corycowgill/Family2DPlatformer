import { PHYSICS } from '../config';
import type { InputState, MovementStats } from '../types';

/**
 * Pure platforming movement model (no Phaser). The Player sprite feeds it input and
 * collision flags each physics step and applies the resulting velocity/gravity.
 * Kept pure so jump arcs and timings are unit-testable and usable by the level
 * reachability checker.
 */

export interface MotorState {
  vx: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  /** ms since last grounded (for coyote time). */
  sinceGroundedMs: number;
  /** ms since jump was last pressed (for buffering); Infinity when none pending. */
  jumpBufferMs: number;
  /** True from jump takeoff until landing/apex; used for variable jump height. */
  jumping: boolean;
  /** True if the jump button has been released during the current jump. */
  jumpCut: boolean;
}

export interface MotorModifiers {
  speedMult: number;
  jumpMult: number;
  /** 0..1 — how much horizontal control the player has (reduced during knockback). */
  control: number;
}

export const DEFAULT_MODS: MotorModifiers = { speedMult: 1, jumpMult: 1, control: 1 };

export function createMotorState(): MotorState {
  return {
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: false,
    sinceGroundedMs: Infinity,
    jumpBufferMs: Infinity,
    jumping: false,
    jumpCut: false,
  };
}

function approach(v: number, target: number, delta: number): number {
  if (v < target) return Math.min(v + delta, target);
  if (v > target) return Math.max(v - delta, target);
  return v;
}

/** Horizontal step. `crouching` locks movement on the ground (Mario-style) — players slide to a stop. */
export function stepHorizontal(
  s: MotorState,
  input: InputState,
  stats: MovementStats,
  dtMs: number,
  mods: MotorModifiers = DEFAULT_MODS,
  crouching = false,
): void {
  const dt = dtMs / 1000;
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const maxSpeed = (input.run ? stats.runSpeed : stats.walkSpeed) * mods.speedMult;
  const target = crouching && s.grounded ? 0 : dir * maxSpeed;
  let accel: number;
  if (s.grounded) {
    const turning = dir !== 0 && Math.sign(s.vx) === -dir;
    accel = dir === 0 || crouching ? stats.groundDecel : turning ? stats.groundDecel * 1.4 : stats.groundAccel;
  } else {
    accel = dir === 0 ? stats.airAccel * 0.35 : stats.airAccel;
  }
  // Above max speed (e.g. after releasing run) decay gently instead of snapping.
  if (dir !== 0 && Math.sign(s.vx) === dir && Math.abs(s.vx) > maxSpeed) accel = stats.groundDecel * 0.5;
  s.vx = approach(s.vx, target, accel * dt * mods.control);
  if (dir !== 0 && mods.control > 0.5) s.facing = dir as 1 | -1;
}

/** Called once per step BEFORE stepVertical with the latest input. Returns true if a jump started. */
export function tryJump(s: MotorState, input: InputState, stats: MovementStats, dtMs: number, mods: MotorModifiers = DEFAULT_MODS): boolean {
  if (input.jumpPressed) s.jumpBufferMs = 0;
  else s.jumpBufferMs += dtMs;

  if (s.grounded) s.sinceGroundedMs = 0;
  else s.sinceGroundedMs += dtMs;

  const canJump = s.grounded || (s.sinceGroundedMs <= PHYSICS.coyoteTimeMs && !s.jumping);
  if (s.jumpBufferMs <= PHYSICS.jumpBufferMs && canJump) {
    startJump(s, stats, mods);
    return true;
  }
  return false;
}

export function jumpVelocityFor(s: Pick<MotorState, 'vx'>, stats: MovementStats, mods: MotorModifiers = DEFAULT_MODS): number {
  const runFrac = Math.min(1, Math.max(0, (Math.abs(s.vx) - stats.walkSpeed) / Math.max(1, stats.runSpeed - stats.walkSpeed)));
  return (stats.jumpVelocity + stats.runJumpBonus * runFrac) * mods.jumpMult;
}

export function startJump(s: MotorState, stats: MovementStats, mods: MotorModifiers = DEFAULT_MODS, velocity?: number): void {
  s.vy = -(velocity ?? jumpVelocityFor(s, stats, mods));
  s.jumping = true;
  s.jumpCut = false;
  s.grounded = false;
  s.jumpBufferMs = Infinity;
  s.sinceGroundedMs = Infinity;
}

/** Effective gravity for this step given jump-hold state. */
export function gravityFor(s: MotorState, jumpHeld: boolean): number {
  const g = PHYSICS.gravity;
  if (s.vy > 0) return g * PHYSICS.fallGravityMult;
  if (s.jumping && (!jumpHeld || s.jumpCut)) return g * PHYSICS.jumpCutGravityMult;
  if (jumpHeld && Math.abs(s.vy) < PHYSICS.apexThreshold) return g * PHYSICS.apexGravityMult;
  return g;
}

/** Integrate vertical velocity (position integration is done by Arcade physics). */
export function stepVertical(s: MotorState, input: InputState, dtMs: number): void {
  const dt = dtMs / 1000;
  if (s.jumping && !input.jump) s.jumpCut = true;
  if (s.grounded && s.vy >= 0) {
    s.vy = 0;
    s.jumping = false;
    return;
  }
  s.vy = Math.min(PHYSICS.maxFallSpeed, s.vy + gravityFor(s, input.jump) * dt);
  if (s.vy > 0) s.jumping = false;
}

/**
 * Simulate a full jump arc on flat ground with jump held for `holdMs` and full
 * horizontal speed — used by tests and the level reachability checker.
 * Returns the peak height (px) and horizontal distance (px) travelled when landing
 * back at the take-off height.
 */
export function simulateJump(
  stats: MovementStats,
  opts: { running: boolean; holdMs: number; mods?: MotorModifiers; stepMs?: number },
): { peak: number; distance: number; airtimeMs: number } {
  const step = opts.stepMs ?? 1000 / 60;
  const s = createMotorState();
  s.grounded = true;
  s.vx = opts.running ? stats.runSpeed : stats.walkSpeed;
  const input = { left: false, right: true, up: false, down: false, jump: true, jumpPressed: true, run: opts.running, attack: false, attackPressed: false, pausePressed: false };
  tryJump(s, input, stats, step, opts.mods);
  let y = 0;
  let x = 0;
  let peak = 0;
  let t = 0;
  input.jumpPressed = false;
  while (t < 5000) {
    t += step;
    input.jump = t < opts.holdMs;
    stepHorizontal(s, input, stats, step, opts.mods);
    stepVertical(s, input, step);
    y += (s.vy * step) / 1000;
    x += (s.vx * step) / 1000;
    peak = Math.max(peak, -y);
    if (y >= 0 && s.vy > 0) break;
  }
  return { peak, distance: x, airtimeMs: t };
}
