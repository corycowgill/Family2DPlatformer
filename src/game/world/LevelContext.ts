import type Phaser from 'phaser';
import type { LevelInfo } from '../types';
import type { Player } from '../entities/Player';

/**
 * Everything an entity needs to interact with the running level.
 * Created by LevelScene and passed to every spawner/entity. (Technical-lead contract.)
 */
export interface LevelContext {
  scene: Phaser.Scene;
  level: LevelInfo;
  player: Player;
  map: Phaser.Tilemaps.Tilemap;
  /** Collidable tile layers. */
  ground: Phaser.Tilemaps.TilemapLayer;
  oneway?: Phaser.Tilemaps.TilemapLayer;
  hazards?: Phaser.Tilemaps.TilemapLayer;
  water?: Phaser.Tilemaps.TilemapLayer;
  groups: {
    /** Arcade sprites extending Enemy (runChildUpdate = true). */
    enemies: Phaser.Physics.Arcade.Group;
    /** Player attacks (Parker's blast, etc.). Children must implement `PlayerProjectile`. */
    playerProjectiles: Phaser.Physics.Arcade.Group;
    /** Enemy/boss projectiles. Children may implement `onHitPlayer()`. */
    enemyProjectiles: Phaser.Physics.Arcade.Group;
    /** Pickups (coins, power-ups). Children implement `Collectible`. */
    pickups: Phaser.Physics.Arcade.Group;
    /** Solid moving / falling platforms (immovable bodies), collide with player & enemies. */
    platforms: Phaser.Physics.Arcade.Group;
    /** Static/dynamic triggers the player overlaps (checkpoints, goal, vents, bounce pads…). Children implement `Trigger`. */
    triggers: Phaser.Physics.Arcade.Group;
  };
  /** Emits EV.* events (scene.events). */
  events: Phaser.Events.EventEmitter;
  /** Play a one-shot effect animation from the `effects` atlas at world position. */
  effect(anim: string, x: number, y: number, opts?: { flipX?: boolean; depth?: number; scale?: number }): void;
  sfx(key: string): void;
  shake(intensity?: number, durationMs?: number): void;
  /** Restrict the camera to a world rectangle (boss arenas); null releases it. */
  lockCamera(rect: Phaser.Geom.Rectangle | null): void;
  /** Level time in ms since start (paused time excluded). */
  now(): number;
}

/** Implemented by anything in `groups.pickups`. */
export interface Collectible {
  collect(ctx: LevelContext): void;
}

/** Implemented by anything in `groups.triggers`. Called every frame the player overlaps it. */
export interface Trigger {
  onPlayerOverlap(ctx: LevelContext): void;
}

/** Implemented by player projectiles. */
export interface PlayerProjectile {
  damage: number;
  /** Called after the projectile hits an enemy. */
  onHitEnemy(): void;
}

/**
 * A Tiled object from the `entities` layer, normalised: x/y is the BOTTOM-CENTRE of the
 * object's rectangle in world pixels; width/height in pixels; `props` holds custom properties.
 */
export interface SpawnObject {
  id: number;
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  props: Record<string, string | number | boolean>;
}

export type Spawner = (ctx: LevelContext, obj: SpawnObject) => void;
