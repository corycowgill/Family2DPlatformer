/**
 * SHARED CONTRACTS — owned by the technical lead.
 * Changing anything in this file affects every team; coordinate before editing.
 */

export type CharacterId = 'dad' | 'mom' | 'brennan' | 'parker' | 'lupin' | 'grandma';
/** Every playable character. Grandma is secret: see systems/Rewards.ts for unlocking. */
export const CHARACTER_IDS: readonly CharacterId[] = ['dad', 'mom', 'brennan', 'parker', 'lupin', 'grandma'];

export type AbilityId = 'groundPound' | 'airJump' | 'dash' | 'projectile' | 'sniff' | 'panSpin';

export interface MovementStats {
  walkSpeed: number;
  runSpeed: number;
  groundAccel: number;
  groundDecel: number;
  airAccel: number;
  /** Initial upward velocity of a jump (positive number, applied as -jumpVelocity). */
  jumpVelocity: number;
  /** Extra jump velocity when running at full speed (Mario-style). */
  runJumpBonus: number;
}

export interface BodySpec {
  width: number;
  height: number;
  /** Height of the body while crouching/crawling. */
  crouchHeight: number;
}

export interface CharacterDef {
  id: CharacterId;
  name: string;
  ability: AbilityId;
  abilityName: string;
  abilityDescription: string;
  /** 1..5 ratings for the character-select screen. */
  ratings: { speed: number; jump: number; ability: number };
  stats: MovementStats;
  body: BodySpec;
  /** Cooldown of the special ability in ms (0 = none). */
  abilityCooldownMs: number;
  /** Primary UI color (hex number). */
  color: number;
}

/** Normalised per-frame input, merged from keyboard, gamepad and touch. */
export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jump: boolean;
  jumpPressed: boolean;
  run: boolean;
  attack: boolean;
  attackPressed: boolean;
  pausePressed: boolean;
}

export const EMPTY_INPUT: Readonly<InputState> = {
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  jumpPressed: false,
  run: false,
  attack: false,
  attackPressed: false,
  pausePressed: false,
};

export type EnemyKind =
  | 'pigeon'
  | 'rat'
  | 'raccoon'
  | 'coneGuy'
  | 'turnstileBot'
  | 'securityDrone'
  | 'windowWasher'
  | 'gnat'
  | 'skirmisher'
  | 'wasp'
  | 'warlord'
  | 'juggernaut'
  | 'overseer'
  | 'eliminator';

export type PickupKind = 'coin' | 'hotdog' | 'pizza' | 'ctaPass' | 'star' | 'souvenir' | 'oneUp';

/** World 1: day / rooftop / river / sunset. World 2 (The North Side): park / lakefront / night / stadium. */
export type LevelTheme = 'day' | 'rooftop' | 'river' | 'sunset' | 'park' | 'lakefront' | 'night' | 'stadium';

export interface LevelInfo {
  id: string;
  /** Display number, e.g. "1-1". */
  number: string;
  name: string;
  world: number;
  /** Path (relative to the site root) of the Tiled JSON map. */
  file: string;
  theme: LevelTheme;
  music: string;
  /** Level id unlocked on completion (undefined = world complete). */
  next?: string;
  boss?: boolean;
}

/** Damage source passed to Player.hurt / Enemy.takeHit. */
export interface HitInfo {
  amount: number;
  /** World x of the attacker — used for knockback direction. */
  fromX: number;
  kind: 'contact' | 'stomp' | 'melee' | 'projectile' | 'groundPound' | 'hazard' | 'pit';
}

/**
 * Global event names emitted on the level scene's `events` emitter
 * (and mirrored to the game registry events for the HUD).
 */
export const EV = {
  COINS_CHANGED: 'coins-changed', // (total: number)
  HEALTH_CHANGED: 'health-changed', // (health: number, max: number)
  LIVES_CHANGED: 'lives-changed', // (lives: number)
  PICKUP: 'pickup', // (kind: PickupKind, x: number, y: number)
  PLAYER_HURT: 'player-hurt', // (hit: HitInfo)
  PLAYER_DIED: 'player-died', // ()
  PLAYER_RESPAWN: 'player-respawn', // ()
  ENEMY_DEFEATED: 'enemy-defeated', // (kind: EnemyKind, x: number, y: number)
  CHECKPOINT: 'checkpoint', // (index: number)
  LEVEL_COMPLETE: 'level-complete', // ()
  ABILITY_USED: 'ability-used', // (ability: AbilityId)
  ABILITY_COOLDOWN: 'ability-cooldown', // (remaining01: number) 0 = ready
  POWERUP_START: 'powerup-start', // (kind: PickupKind, durationMs: number)
  POWERUP_END: 'powerup-end', // (kind: PickupKind)
  BOSS_START: 'boss-start', // (name: string, maxHp: number)
  BOSS_HEALTH: 'boss-health', // (hp: number, maxHp: number)
  BOSS_PHASE: 'boss-phase', // (phase: number)
  BOSS_DEFEATED: 'boss-defeated', // ()
  SECRET_FOUND: 'secret-found', // (index: number)
  CAMERA_SHAKE: 'camera-shake', // (intensity: number, durationMs: number)
  SFX: 'sfx', // (key: string)
  /** Lupin's Super Sniff — secrets within `radius` of (x, y) should reveal themselves. */
  SNIFF: 'sniff', // (x: number, y: number, radius: number)
} as const;
