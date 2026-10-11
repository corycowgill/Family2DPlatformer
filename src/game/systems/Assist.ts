/**
 * Assist mode & accessibility rules — pure logic (no Phaser, no save singleton) so it is
 * unit-testable in Node. Settings live in SaveSystem (`Settings`); scenes read them there.
 *
 * Assist options (all default OFF) make a run "assisted": the run is still recorded, but it
 * can't earn the gold medal (Rewards.medalFor caps it at silver) and Results shows an ASSIST
 * tag. Accessibility options (screen shake, flashing, outlines) never affect rewards.
 */

/** Game speed choices (1 = normal). The physics still runs at a fixed 60 Hz of *game* time. */
export const GAME_SPEEDS = [1, 0.85, 0.7] as const;
export type GameSpeed = (typeof GAME_SPEEDS)[number];

export function isGameSpeed(v: unknown): v is GameSpeed {
  return typeof v === 'number' && (GAME_SPEEDS as readonly number[]).includes(v);
}

/** 0.85 → "85%". */
export function formatSpeed(s: GameSpeed): string {
  return `${Math.round(s * 100)}%`;
}

/** Extra max hearts granted by the "extra hearts" assist. */
export const EXTRA_HEARTS = 2;
/** Deaths on a boss level before the "skip boss" assist offers to skip it. */
export const BOSS_SKIP_DEATHS = 3;

/** The subset of Settings the assist rules read (keeps this module free of SaveSystem). */
export interface AssistSettings {
  gameSpeed: GameSpeed;
  extraHearts: boolean;
  infiniteLives: boolean;
  safetyNet: boolean;
  bossSkip: boolean;
  autoRun: boolean;
}

/**
 * True when an assist that changes how hard the run is, is switched on. (The boss skip only
 * counts once it is actually used — LevelScene marks the run then.)
 */
export function assistAffectsRun(s: AssistSettings): boolean {
  return s.gameSpeed !== 1 || s.extraHearts || s.infiniteLives || s.safetyNet || s.autoRun;
}

export function maxHealthWith(base: number, s: Pick<AssistSettings, 'extraHearts'>): number {
  return base + (s.extraHearts ? EXTRA_HEARTS : 0);
}

/** Lives after a death (infinite lives: unchanged). */
export function livesAfterDeath(lives: number, s: Pick<AssistSettings, 'infiniteLives'>): number {
  return s.infiniteLives ? lives : lives - 1;
}

/** Should the boss-skip prompt be offered on this attempt? */
export function canSkipBoss(s: Pick<AssistSettings, 'bossSkip'>, bossLevel: boolean, deaths: number): boolean {
  return s.bossSkip && bossLevel && deaths >= BOSS_SKIP_DEATHS;
}

/** Outcome of a pit fall with the safety net on. */
export type PitOutcome = { kind: 'rescue'; x: number; y: number; health: number } | { kind: 'die' };

/**
 * Safety net: a pit fall costs one heart and puts the hero back on the last safe ground.
 * With one heart left (or nowhere safe known yet) it is a normal death.
 */
export function pitOutcome(safetyNet: boolean, health: number, safe: { x: number; y: number } | null): PitOutcome {
  if (!safetyNet || !safe || health <= 1) return { kind: 'die' };
  return { kind: 'rescue', x: safe.x, y: safe.y, health: health - 1 };
}

/** One sample of where the hero stands, taken once per physics step. */
export interface GroundSample {
  x: number;
  y: number;
  /** Level time (ms). */
  t: number;
  /**
   * Standing still-able ground: grounded on solid tiles under both feet, not a moving or
   * crumbling platform, no hazard here. Computed by the Player (needs the tilemap).
   */
  safe: boolean;
}

/**
 * Remembers the last safe ground the hero stood on. A spot only counts after the hero has
 * stood on safe ground for `settleMs` (so bouncing off a ledge lip doesn't count).
 */
export class SafeGroundTracker {
  private last: { x: number; y: number } | null = null;
  private safeSince = -1;

  constructor(private readonly settleMs = 100) {}

  /** Seed with a known-safe point (level start / checkpoint). */
  reset(x: number, y: number): void {
    this.last = { x, y };
    this.safeSince = -1;
  }

  note(s: GroundSample): void {
    if (!s.safe) {
      this.safeSince = -1;
      return;
    }
    if (this.safeSince < 0) this.safeSince = s.t;
    if (s.t - this.safeSince >= this.settleMs) this.last = { x: s.x, y: s.y };
  }

  /** Last safe ground (null until something is known). */
  get point(): { x: number; y: number } | null {
    return this.last ? { ...this.last } : null;
  }
}
