import { PHYSICS, TILE_SIZE } from '../config';
import { CHARACTER_IDS, type CharacterDef, type CharacterId, type InputState, type MovementStats } from '../types';
import { CHARACTERS } from '../characters';

/**
 * Pure platforming movement model (no Phaser). The Player sprite feeds it input and
 * collision flags each physics step and applies the resulting velocity/gravity.
 * Kept pure so jump arcs and timings are unit-testable and usable by the level
 * reachability checker (see `JUMP_LIMITS` / `jumpReach`).
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
  /** True from jump takeoff until the apex; used for variable jump height. */
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

/** Tolerance for accumulated frame times (16.666…ms steps) when comparing against windows. */
const TIME_EPS = 1;

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
    accel = dir === 0 || crouching ? stats.groundDecel : turning ? stats.groundDecel * PHYSICS.turnDecelMult : stats.groundAccel;
  } else {
    const turning = dir !== 0 && Math.sign(s.vx) === -dir;
    accel = dir === 0 ? stats.airAccel * PHYSICS.airDragMult : turning ? stats.airAccel * 1.25 : stats.airAccel;
  }
  // Above max speed (after releasing run, or after a dash) decay gently instead of snapping.
  if (dir !== 0 && Math.sign(s.vx) === dir && Math.abs(s.vx) > maxSpeed) accel = stats.groundDecel * (s.grounded ? 0.5 : 0.25);
  s.vx = approach(s.vx, target, accel * dt * mods.control);
  if (dir !== 0 && mods.control > 0.5) s.facing = dir as 1 | -1;
}

/**
 * Called once per step BEFORE stepVertical with the latest input. Handles jump
 * buffering and coyote time. Returns true if a jump started.
 */
export function tryJump(s: MotorState, input: InputState, stats: MovementStats, dtMs: number, mods: MotorModifiers = DEFAULT_MODS): boolean {
  if (input.jumpPressed) s.jumpBufferMs = 0;
  else s.jumpBufferMs += dtMs;

  if (s.grounded) s.sinceGroundedMs = 0;
  else s.sinceGroundedMs += dtMs;

  if (s.jumpBufferMs <= PHYSICS.jumpBufferMs + TIME_EPS && canGroundJump(s)) {
    startJump(s, stats, mods);
    // A buffered jump whose button was already released becomes a short hop.
    if (!input.jump) s.jumpCut = true;
    return true;
  }
  return false;
}

/** True if a jump press this step would NOT be consumed by a ground/coyote jump (used for air jumps). */
export function canGroundJump(s: MotorState): boolean {
  return s.grounded || (s.sinceGroundedMs <= PHYSICS.coyoteTimeMs + TIME_EPS && !s.jumping);
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

/** Mid-air jump (Mom's Sparkle Jump). Fixed height regardless of speed. */
export function startAirJump(s: MotorState, mods: MotorModifiers = DEFAULT_MODS): void {
  s.vy = -PHYSICS.airJumpVelocity * mods.jumpMult;
  s.jumping = true;
  s.jumpCut = false;
  s.jumpBufferMs = Infinity;
}

/** Head hit a ceiling: kill upward speed and end the jump so we don't stick to it. */
export function bonkCeiling(s: MotorState): void {
  if (s.vy < PHYSICS.ceilingBonkVy) s.vy = PHYSICS.ceilingBonkVy;
  s.jumping = false;
  s.jumpCut = true;
}

/** Effective gravity for this step given jump-hold state. */
export function gravityFor(s: MotorState, jumpHeld: boolean): number {
  const g = PHYSICS.gravity;
  if (s.vy > 0) {
    // Slight hang just after the apex when the button is still held.
    if (jumpHeld && s.vy < PHYSICS.apexThreshold) return g * PHYSICS.apexGravityMult;
    return g * PHYSICS.fallGravityMult;
  }
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

// ───────────────────────── simulation / reachability ─────────────────────────

export interface ArcPoint {
  t: number;
  x: number;
  /** Height above take-off (positive = up). */
  h: number;
  vy: number;
}

export interface SimOptions {
  running: boolean;
  /** How long jump is held (ms). Infinity = full hold. */
  holdMs: number;
  mods?: MotorModifiers;
  stepMs?: number;
  /** Mom: perform an air jump this many ms after take-off. */
  airJumpAtMs?: number;
  /** Stop when falling back through this height (px above take-off, default 0). */
  landHeight?: number;
}

/** Simulate a jump on open ground (holding right) and return the full arc. */
export function simulateArc(stats: MovementStats, opts: SimOptions): ArcPoint[] {
  const step = opts.stepMs ?? 1000 / 60;
  const s = createMotorState();
  s.grounded = true;
  s.vx = (opts.running ? stats.runSpeed : stats.walkSpeed) * (opts.mods?.speedMult ?? 1);
  const input: InputState = { left: false, right: true, up: false, down: false, jump: true, jumpPressed: true, run: opts.running, attack: false, attackPressed: false, pausePressed: false };
  tryJump(s, input, stats, step, opts.mods);
  const landH = opts.landHeight ?? 0;
  let y = 0;
  let x = 0;
  let t = 0;
  let airJumped = false;
  const pts: ArcPoint[] = [{ t: 0, x: 0, h: 0, vy: s.vy }];
  input.jumpPressed = false;
  let holdStart = 0;
  while (t < 5000) {
    t += step;
    // Same order as the game: Arcade moves the body with the velocity set last tick,
    // then Player.tick integrates the motor over the elapsed physics time.
    y += (s.vy * step) / 1000;
    x += (s.vx * step) / 1000;
    pts.push({ t, x, h: -y, vy: s.vy });
    if (opts.airJumpAtMs !== undefined && !airJumped && t >= opts.airJumpAtMs) {
      startAirJump(s, opts.mods);
      airJumped = true;
      holdStart = t;
    }
    input.jump = t - holdStart < opts.holdMs;
    stepHorizontal(s, input, stats, step, opts.mods);
    stepVertical(s, input, step);
    if (-y <= landH && s.vy > 0) break;
  }
  return pts;
}

/**
 * Simulate a full jump arc on flat ground with jump held for `holdMs` and full
 * horizontal speed — used by tests and the level reachability checker.
 * Returns the peak height (px) and horizontal distance (px) travelled when landing
 * back at the take-off height.
 */
export function simulateJump(
  stats: MovementStats,
  opts: SimOptions,
): { peak: number; distance: number; airtimeMs: number } {
  const pts = simulateArc(stats, opts);
  const last = pts[pts.length - 1];
  return { peak: Math.max(...pts.map((p) => p.h)), distance: last.x, airtimeMs: last.t };
}

/**
 * Horizontal distance (px) covered when landing on a ledge `dyPx` above (positive) or
 * below (negative) the take-off point, with full hold. Returns 0 if unreachable.
 */
export function jumpReach(stats: MovementStats, dyPx: number, running = true, mods?: MotorModifiers): number {
  const pts = simulateArc(stats, { running, holdMs: Infinity, mods, landHeight: dyPx });
  const peak = Math.max(...pts.map((p) => p.h));
  if (peak < dyPx) return 0;
  return pts[pts.length - 1].x;
}

export interface JumpLimits {
  /** Peak heights (px) of a tap jump (released after one frame), full-hold walk jump and full-hold running jump. */
  tapPeak: number;
  walkPeak: number;
  runPeak: number;
  /** Horizontal distance (px) back to take-off height. */
  walkDistance: number;
  runDistance: number;
  /** Extra height (px) gained by Mom's air jump fired at the apex (0 for others). */
  airJumpExtra: number;
  /** Conservative clearable figures in tiles: highest ledge you can land on and widest gap (flat). */
  walkHeightTiles: number;
  runHeightTiles: number;
  runGapTiles: number;
  walkGapTiles: number;
}

function limitsFor(def: CharacterDef): JumpLimits {
  const st = def.stats;
  const tap = simulateJump(st, { running: false, holdMs: 0 });
  const walk = simulateJump(st, { running: false, holdMs: Infinity });
  const run = simulateJump(st, { running: true, holdMs: Infinity });
  let airJumpExtra = 0;
  if (def.ability === 'airJump') {
    const arc = simulateArc(st, { running: false, holdMs: Infinity });
    const apexT = arc.reduce((a, p) => (p.h > a.h ? p : a)).t;
    const withAir = simulateJump(st, { running: false, holdMs: Infinity, airJumpAtMs: apexT });
    airJumpExtra = withAir.peak - walk.peak;
  }
  // A ledge is "clearable" if the feet rise at least 2px above it.
  const tiles = (px: number) => Math.floor((px - 2) / TILE_SIZE);
  // Gap: body overhangs both edges by up to half its width, keep 4px safety margin.
  const gap = (dist: number) => Math.floor((dist + def.body.width - 4) / TILE_SIZE);
  return {
    tapPeak: round1(tap.peak),
    walkPeak: round1(walk.peak),
    runPeak: round1(run.peak),
    walkDistance: round1(walk.distance),
    runDistance: round1(run.distance),
    airJumpExtra: round1(airJumpExtra),
    walkHeightTiles: tiles(walk.peak),
    runHeightTiles: tiles(run.peak),
    walkGapTiles: gap(walk.distance),
    runGapTiles: gap(run.distance),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Per-character jump capabilities WITHOUT abilities or power-ups — design levels against the minimum. */
export const JUMP_LIMITS: Record<CharacterId, JumpLimits> = Object.fromEntries(
  CHARACTER_IDS.map((id) => [id, limitsFor(CHARACTERS[id])]),
) as Record<CharacterId, JumpLimits>;

/** The weakest value of each field across all characters — every mandatory jump must fit these. */
export const MIN_JUMP_LIMITS: JumpLimits = (() => {
  const all = Object.values(JUMP_LIMITS);
  const out = { ...all[0] };
  for (const k of Object.keys(out) as (keyof JumpLimits)[]) out[k] = Math.min(...all.map((l) => l[k]));
  return out;
})();
