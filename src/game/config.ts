/**
 * Central configuration. All gameplay tuning lives here (or in character defs)
 * so movement feel can be adjusted without touching entity code.
 */

export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 270;
export const TILE_SIZE = 16;

/** Base physics shared by all characters. Units: pixels and seconds. */
export const PHYSICS = {
  /** Gravity while rising with jump held. */
  gravity: 1100,
  /** Gravity multiplier when falling (snappier falls). */
  fallGravityMult: 1.6,
  /** Gravity multiplier when the jump button is released while rising (variable jump height). */
  jumpCutGravityMult: 2.6,
  /** Gravity multiplier near the jump apex when jump is held (|vy| < apexThreshold). */
  apexGravityMult: 0.55,
  apexThreshold: 45,
  maxFallSpeed: 420,
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
