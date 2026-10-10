/**
 * Pure enemy/boss AI helpers (NO Phaser imports) so timing and decision logic can be
 * unit-tested in Node. Enemy classes call these from their `think()`.
 */

/** Stomp test. Generous: the player only needs to be falling (or at the apex) with
 * its feet near the enemy's top on the previous frame. */
export function isStomp(
  player: { bottom: number; prevBottom: number; vy: number },
  enemy: { top: number; prevTop?: number; height?: number },
  tolerance?: number,
): boolean {
  const tol = tolerance ?? stompTolerance(enemy.height ?? 16);
  const top = Math.max(enemy.top, enemy.prevTop ?? enemy.top);
  // Falling, or hovering at the jump apex just above the enemy.
  const descending = player.vy > 0 || (player.vy > -40 && player.bottom <= enemy.top + 4);
  return descending && player.prevBottom <= top + tol;
}

/** Stomp tolerance grows with the enemy's height (taller enemies are easier to land on). */
export function stompTolerance(enemyHeight: number): number {
  return Math.max(8, Math.min(16, enemyHeight * 0.5));
}

/** Boss phase (1-based) from hp. `thresholds` are the hp values at/below which the next phase starts (descending). */
export function bossPhaseForHp(hp: number, thresholds: readonly number[]): number {
  let phase = 1;
  for (const t of thresholds) if (hp <= t) phase++;
  return phase;
}

/** Telegraph blink: true when the tint should be ON. Blinks faster as the telegraph nears its end. */
export function telegraphBlink(elapsedMs: number, totalMs: number): boolean {
  if (elapsedMs >= totalMs) return true;
  const progress = Math.max(0, elapsedMs) / Math.max(1, totalMs);
  const period = progress < 0.5 ? 160 : progress < 0.8 ? 100 : 60;
  return Math.floor(elapsedMs / period) % 2 === 0;
}

/** Velocity vector of length `speed` from (x0,y0) toward (x1,y1). */
export function aimVelocity(x0: number, y0: number, x1: number, y1: number, speed: number): { vx: number; vy: number } {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  return { vx: (dx / len) * speed, vy: (dy / len) * speed };
}

/** Is `targetX` in front of an entity at `x` facing `facing`? */
export function isInFront(x: number, facing: 1 | -1, targetX: number): boolean {
  return (targetX - x) * facing > 0;
}

/** Raccoon shield: blocks a non-stomp hit coming from the side it is facing. */
export function shieldBlocks(hasShield: boolean, x: number, facing: 1 | -1, hitKind: string, hitFromX: number): boolean {
  if (!hasShield) return false;
  if (hitKind === 'stomp' || hitKind === 'groundPound' || hitKind === 'contact') return false;
  return hitFromX === x || isInFront(x, facing, hitFromX);
}

/** A repeating cycle of named phases with fixed durations (e.g. turnstile spin/rest). */
export class PhaseCycle<S extends string> {
  private t: number;
  private readonly total: number;
  constructor(
    readonly phases: readonly { state: S; ms: number }[],
    offsetMs = 0,
  ) {
    this.total = phases.reduce((a, p) => a + p.ms, 0);
    this.t = ((offsetMs % this.total) + this.total) % this.total;
  }
  update(dtMs: number): void {
    this.t = (this.t + dtMs) % this.total;
  }
  private locate(): { i: number; into: number } {
    let acc = 0;
    for (let i = 0; i < this.phases.length; i++) {
      if (this.t < acc + this.phases[i].ms) return { i, into: this.t - acc };
      acc += this.phases[i].ms;
    }
    return { i: this.phases.length - 1, into: this.phases[this.phases.length - 1].ms };
  }
  get state(): S {
    return this.phases[this.locate().i].state;
  }
  /** ms elapsed in the current phase. */
  get elapsed(): number {
    return this.locate().into;
  }
  /** ms left in the current phase. */
  get remaining(): number {
    const { i, into } = this.locate();
    return this.phases[i].ms - into;
  }
}

/** Turnstile bot timing: spin 1.5 s, rest 1.5 s; warn (flash) during the last `warnMs` of rest. */
export const TURNSTILE_TIMING = { spinMs: 1500, restMs: 1500, warnMs: 450 } as const;

export function turnstileStatus(cycle: PhaseCycle<'spin' | 'rest'>): { spinning: boolean; warning: boolean; stompable: boolean } {
  const spinning = cycle.state === 'spin';
  const warning = !spinning && cycle.remaining <= TURNSTILE_TIMING.warnMs;
  return { spinning, warning, stompable: !spinning };
}

/** Boss (EL-iminator) tuning per phase. All times in ms. Faster but still readable in later phases. */
export interface BossPhaseTiming {
  telegraphMs: number;
  vulnerableMs: number;
  idleMs: number;
  debrisWarnMs: number;
  shockwaveWarnMs: number;
  sweepSpeed: number;
  shockwaveSpeed: number;
  maxDrones: number;
}

export function eliminatorTiming(phase: number): BossPhaseTiming {
  if (phase <= 1)
    return { telegraphMs: 800, vulnerableMs: 2200, idleMs: 900, debrisWarnMs: 800, shockwaveWarnMs: 800, sweepSpeed: 300, shockwaveSpeed: 140, maxDrones: 0 };
  if (phase === 2)
    return { telegraphMs: 800, vulnerableMs: 2000, idleMs: 700, debrisWarnMs: 800, shockwaveWarnMs: 750, sweepSpeed: 330, shockwaveSpeed: 155, maxDrones: 0 };
  return { telegraphMs: 700, vulnerableMs: 1800, idleMs: 500, debrisWarnMs: 800, shockwaveWarnMs: 700, sweepSpeed: 360, shockwaveSpeed: 170, maxDrones: 2 };
}

export type EliminatorAttack = 'sweepLow' | 'sweepHigh' | 'debris' | 'shockwave' | 'drones';

/**
 * Choose the boss's next attack. Deterministic given `roll` (0..1). Never repeats the same
 * attack twice in a row; phase 1 only sweeps; phase 2 adds debris/shockwave; phase 3 adds drones
 * (only if fewer than maxDrones are alive).
 */
export function pickEliminatorAttack(phase: number, last: EliminatorAttack | null, roll: number, dronesAlive = 0): EliminatorAttack {
  const pool: EliminatorAttack[] = ['sweepLow', 'sweepHigh'];
  if (phase >= 2) pool.push('debris', 'shockwave');
  if (phase >= 3 && dronesAlive < eliminatorTiming(phase).maxDrones) pool.push('drones');
  const options = pool.filter((a) => a !== last);
  const r = Math.min(0.999999, Math.max(0, roll));
  return options[Math.floor(r * options.length)];
}

/** Sine hover offset (px) at time t (ms). */
export function hoverOffset(tMs: number, amplitude: number, periodMs: number, phase = 0): number {
  return Math.sin((tMs / periodMs) * Math.PI * 2 + phase) * amplitude;
}

/** Should a window washer drop its bucket? Player must be below and within `dx` horizontally. */
export function playerBeneath(ex: number, ey: number, px: number, py: number, dx = 28, maxDy = 220): boolean {
  return Math.abs(px - ex) <= dx && py > ey && py - ey <= maxDy;
}

/** Cone shell: does a moving shell hurt the player? Only when it moves toward them and the kick grace has passed. */
export function shellHurtsPlayer(shellVx: number, shellX: number, playerX: number, msSinceKick: number, graceMs = 350): boolean {
  if (Math.abs(shellVx) < 1 || msSinceKick < graceMs) return false;
  return Math.sign(shellVx) === Math.sign(playerX - shellX) || Math.abs(playerX - shellX) < 4;
}

/** Kick direction for a resting shell touched by the player: away from the player. */
export function kickDirection(shellX: number, playerX: number, playerFacing: 1 | -1): 1 | -1 {
  const d = Math.sign(shellX - playerX);
  return d === 0 ? playerFacing : (d as 1 | -1);
}

/** Read a numeric spawn property with a default. */
export function propNum(props: Record<string, string | number | boolean>, key: string, def: number): number {
  const v = props[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : def;
}

/** Apply spawn-property overrides for hp/damage (Tiled custom properties). */
export function applyStatOverrides(
  base: { hp: number; contactDamage: number },
  props: Record<string, string | number | boolean>,
): { hp: number; contactDamage: number } {
  const num = (v: unknown, d: number) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : d;
  };
  return {
    hp: Math.max(1, Math.round(num(props.hp, base.hp))),
    contactDamage: Math.max(0, num(props.damage, base.contactDamage)),
  };
}
