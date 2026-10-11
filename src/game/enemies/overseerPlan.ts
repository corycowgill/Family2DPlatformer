/**
 * THE OVERSEER (World 2 boss) — pure fight plan: phases, timings, attack schedule and the
 * geometry of its attacks. No Phaser imports, unit-tested in Node (tests/unit/overseer.test.ts).
 * The Phaser side lives in enemies/OverseerBoss.ts.
 *
 * Fight loop: hover → telegraphed attack → (beam / slam / laser only) the pod sinks to the
 * outfield and its CORE glows between the tentacles: stomp it (one stomp = 1 hp, the window
 * closes) → rise → repeat. Summons (gnats / wasps) don't open a window.
 *
 * Phase 1 (9-7 hp): tractor-beam sweep over the half of the field the player is in, gnat pods.
 * Phase 2 (6-4 hp): tentacle slam — tracks the player, locks, drops; shockwaves both ways.
 * Phase 3 (3-1 hp): wasps, double slams, spinning laser (stay out of the marked zone).
 */
import { bossPhaseForHp } from './ai';

export type OverseerAttack = 'beam' | 'gnats' | 'slam' | 'wasps' | 'laser';

export const OVERSEER_HP = 9;

/** hp values at/below which phase 2 and phase 3 start. */
export function overseerThresholds(maxHp: number): [number, number] {
  return [Math.round((maxHp * 2) / 3), Math.round(maxHp / 3)];
}

export function overseerPhase(hp: number, maxHp = OVERSEER_HP): number {
  return bossPhaseForHp(hp, overseerThresholds(maxHp));
}

export interface OverseerTiming {
  /** Hover time between attacks. */
  idleMs: number;
  /** Beam: floor zone + column blink before the sweep starts. */
  beamWarnMs: number;
  /** Beam sweep duration (outer wall → middle of the arena). */
  beamSweepMs: number;
  /** Slam: the pod follows the player's x for this long... */
  slamTrackMs: number;
  /** ...then holds still over a blinking floor marker before dropping. */
  slamWarnMs: number;
  /** Slams per slam attack (phase 3 combos two). */
  slams: number;
  shockwaveSpeed: number;
  /** Laser: the danger zone blinks this long before the arms appear. */
  laserWarnMs: number;
  /** Laser: one full spin. */
  laserSpinMs: number;
  /** How long the core stays open after an attack. */
  vulnerableMs: number;
  maxGnats: number;
  maxWasps: number;
}

export function overseerTiming(phase: number): OverseerTiming {
  if (phase <= 1) {
    return { idleMs: 1100, beamWarnMs: 1100, beamSweepMs: 1700, slamTrackMs: 1300, slamWarnMs: 800, slams: 1, shockwaveSpeed: 130, laserWarnMs: 1100, laserSpinMs: 3200, vulnerableMs: 2600, maxGnats: 2, maxWasps: 0 };
  }
  if (phase === 2) {
    return { idleMs: 900, beamWarnMs: 1000, beamSweepMs: 1500, slamTrackMs: 1200, slamWarnMs: 750, slams: 1, shockwaveSpeed: 140, laserWarnMs: 1100, laserSpinMs: 3000, vulnerableMs: 2400, maxGnats: 2, maxWasps: 0 };
  }
  return { idleMs: 700, beamWarnMs: 950, beamSweepMs: 1400, slamTrackMs: 1000, slamWarnMs: 700, slams: 2, shockwaveSpeed: 150, laserWarnMs: 1000, laserSpinMs: 3000, vulnerableMs: 2200, maxGnats: 2, maxWasps: 2 };
}

/** Attack rotation per phase (cycled). Each phase opens with its signature attack. */
export const OVERSEER_SCHEDULE: Readonly<Record<1 | 2 | 3, readonly OverseerAttack[]>> = {
  1: ['beam', 'gnats', 'beam', 'beam'],
  2: ['slam', 'beam', 'slam', 'gnats'],
  3: ['wasps', 'laser', 'slam', 'beam', 'laser', 'slam'],
};

/**
 * The `index`-th attack of `phase`'s rotation. Summons are skipped when their minions are
 * already at the cap (so the fight never stalls on a no-op attack).
 */
export function overseerAttack(phase: number, index: number, alive: { gnats: number; wasps: number } = { gnats: 0, wasps: 0 }): OverseerAttack {
  const p = (Math.min(3, Math.max(1, phase)) as 1 | 2 | 3);
  const list = OVERSEER_SCHEDULE[p];
  const t = overseerTiming(p);
  for (let k = 0; k < list.length; k++) {
    const a = list[(((index + k) % list.length) + list.length) % list.length];
    if (a === 'gnats' && alive.gnats >= t.maxGnats) continue;
    if (a === 'wasps' && alive.wasps >= t.maxWasps) continue;
    return a;
  }
  return p === 1 ? 'beam' : 'slam';
}

/** Attacks after which the pod sinks and its core can be stomped. */
export function opensWeakSpot(a: OverseerAttack): boolean {
  return a === 'beam' || a === 'slam' || a === 'laser';
}

export interface BeamPlan {
  /** Column centre at the start / end of the sweep. */
  fromX: number;
  toX: number;
  /** Floor zone the column will cover (telegraphed). */
  zoneMin: number;
  zoneMax: number;
}

/**
 * Tractor-beam sweep: covers the HALF of the arena the player stands in, starting at that
 * half's outer wall and ending at the middle, so walking toward (and past) the middle always
 * escapes it. `margin` keeps the column off the walls.
 */
export function beamSweepPlan(arenaX: number, arenaW: number, playerX: number, margin = 14): BeamPlan {
  const mid = arenaX + arenaW / 2;
  if (playerX < mid) {
    return { fromX: arenaX + margin, toX: mid, zoneMin: arenaX, zoneMax: mid + margin };
  }
  return { fromX: arenaX + arenaW - margin, toX: mid, zoneMin: mid - margin, zoneMax: arenaX + arenaW };
}

/** Column x at `elapsed` ms of a sweep lasting `ms` (eased in/out). */
export function beamX(plan: BeamPlan, elapsed: number, ms: number): number {
  const k = Math.min(1, Math.max(0, elapsed / ms));
  const e = k * k * (3 - 2 * k);
  return plan.fromX + (plan.toX - plan.fromX) * e;
}

/**
 * Half-width of the floor strip a laser arm of `length` rotating around (cx, cy) can touch.
 * 0 when the arms can't reach the floor at all.
 */
export function laserFloorReach(cy: number, floorY: number, length: number): number {
  const h = floorY - cy;
  if (h >= length) return 0;
  return Math.sqrt(length * length - h * h);
}

/** End points of the two opposite laser arms at `angle` (radians). */
export function laserArms(cx: number, cy: number, angle: number, length: number): [[number, number, number, number], [number, number, number, number]] {
  const dx = Math.cos(angle) * length;
  const dy = Math.sin(angle) * length;
  return [
    [cx, cy, cx + dx, cy + dy],
    [cx, cy, cx - dx, cy - dy],
  ];
}

/** Distance from point (px, py) to segment (ax, ay)-(bx, by). */
export function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * vx + (py - ay) * vy) / len2)) : 0;
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

/**
 * Does the axis-aligned box (left, top, right, bottom) touch a laser segment (thickness `half`)?
 * Samples the box's centre line + corners — enough for player-sized boxes.
 */
export function boxHitsSegment(left: number, top: number, right: number, bottom: number, seg: readonly [number, number, number, number], half = 3): boolean {
  const [ax, ay, bx, by] = seg;
  const cx = (left + right) / 2;
  const pts: [number, number][] = [
    [cx, top], [cx, (top + bottom) / 2], [cx, bottom],
    [left, top], [right, top], [left, bottom], [right, bottom],
  ];
  const r = half + Math.min(right - left, bottom - top) / 2;
  return pts.some(([x, y]) => segmentDistance(x, y, ax, ay, bx, by) <= (x === cx ? r : half));
}

/** Slam target: the player's x clamped so the pod (and its shockwave origin) stays inside the arena. */
export function slamTargetX(playerX: number, arenaX: number, arenaW: number, halfWidth = 40): number {
  return Math.min(arenaX + arenaW - halfWidth, Math.max(arenaX + halfWidth, playerX));
}
