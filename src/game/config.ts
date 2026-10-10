/**
 * Central configuration. All gameplay tuning lives here (or in character defs)
 * so movement feel can be adjusted without touching entity code.
 */

export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 270;
export const TILE_SIZE = 16;

/**
 * Base physics shared by all characters. Units: pixels and seconds.
 *
 * ── JUMP LIMITS (level-design contract) ───────────────────────────────────────
 * Measured with `simulateArc` (systems/PlayerMotor.ts), which integrates exactly like
 * the game (the motor runs once per 60 Hz Arcade step, so arcs are frame-rate
 * independent). Live values: `JUMP_LIMITS[id]` / `MIN_JUMP_LIMITS`; landing reach on a
 * ledge dy px higher/lower: `jumpReach(stats, dy)`. 16 px tiles. No abilities/power-ups.
 *
 *            tap    walk   run    walk   run    run gap
 *            peak   peak   peak   dist   dist   (tiles)
 *   dad      24.5   57.0   75.0   58.6   112.0  7
 *   mom      24.5   57.0   75.0   58.6   108.5  7     (+ Sparkle Jump: +40 px ≈ 2.5 tiles)
 *   brennan  24.0   55.7   74.0   60.0   119.0  7
 *   parker   24.5   57.0   75.0   58.6   112.0  7
 *   lupin    24.2   56.4   74.3   64.8   115.5  8
 *
 * Design against the minimums: a ledge 3 tiles up needs a full-hold jump (no run);
 * 4 tiles up needs a running jump; 5 tiles is unreachable without an ability.
 * Flat gaps: ≤ 3 tiles walking, ≤ 6 tiles running is comfortable, 7 is the max.
 * Tap jump ≈ 1.5 tiles. CTA pass (×1.25 speed, ×1.08 jump) raises the run peak to ~87 px.
 * Standing bodies are ≤ 30 px tall (fit 2-tile corridors); only Lupin (14 px) fits
 * 1-tile tunnels. Timings: coyote 100 ms, jump buffer 120 ms.
 */
export const PHYSICS = {
  /** Gravity while rising with jump held. */
  gravity: 1250,
  /** Gravity multiplier when falling (snappier falls). */
  fallGravityMult: 1.6,
  /** Gravity multiplier when the jump button is released while rising (variable jump height). */
  jumpCutGravityMult: 2.5,
  /** Gravity multiplier near the jump apex when jump is held (|vy| < apexThreshold). */
  apexGravityMult: 0.55,
  apexThreshold: 45,
  maxFallSpeed: 440,
  /** Ground deceleration multiplier when reversing direction (skid). */
  turnDecelMult: 1.6,
  /** Fraction of airAccel applied as drag when no direction is held in the air. */
  airDragMult: 0.35,
  /** Upward velocity of Mom's mid-air Sparkle Jump. */
  airJumpVelocity: 326,
  /** Vertical speed after bonking a ceiling (small downward push so we don't stick). */
  ceilingBonkVy: 30,
  /** Downward velocity applied while grounded so Arcade keeps reporting ground contact. */
  groundStickVy: 40,
  /** Dad's ground pound: hang time before the slam, slam speed, shockwave radius. */
  groundPoundHangMs: 120,
  groundPoundSpeed: 560,
  groundPoundRadius: 40,
  /** Brennan's dash. */
  dashSpeed: 240,
  dashMs: 220,
  /** Parker's energy ball. */
  projectileSpeed: 260,
  projectileRange: 140,
  projectileMax: 2,
  /** Lupin's sniff radius (px). */
  sniffRadius: 96,
  /** One-way platform drop-through window (ms). */
  dropThroughMs: 200,
  /** Grace period after leaving a ledge during which a jump is still allowed (ms). */
  coyoteTimeMs: 100,
  /** A jump pressed this long before landing still fires on landing (ms). */
  jumpBufferMs: 120,
  /** Invulnerability after taking damage (ms). */
  hurtInvulnMs: 1400,
  /** Duration of knockback during which control is reduced (ms). */
  knockbackMs: 260,
  knockbackVX: 150,
  knockbackVY: -220,
  /** Upward velocity after stomping an enemy (jump held gives more). */
  stompBounce: -260,
  stompBounceHeld: -380,
  bouncePadVelocity: -560,
} as const;

export const PLAYER_DEFAULTS = {
  maxHealth: 3,
  startingLives: 5,
} as const;

/** Depth (z-order) bands so every system layers consistently. */
export const DEPTH = {
  sky: -100,
  parallaxFar: -90,
  parallaxMid: -80,
  parallaxNear: -70,
  backgroundTiles: -10,
  props: 0,
  platforms: 5,
  ground: 10,
  pickups: 20,
  enemies: 30,
  player: 40,
  projectiles: 45,
  effects: 50,
  foreground: 60,
  hud: 1000,
  touch: 1100,
  overlay: 1200,
} as const;

export const STORAGE_KEY = 'cfa-save';
export const SAVE_VERSION = 1;

/** True when the URL contains ?debug — enables the debug overlay and hotkeys. */
export const DEBUG =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');
