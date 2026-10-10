import Phaser from 'phaser';
import { DEPTH } from '../config';
import type { LevelContext } from '../world/LevelContext';
import { animKey } from '../systems/AnimationSystem';
import { ensureSimpleTexture, hasRealAtlas } from '../enemies/enemyArt';

export type EnemyShotStyle =
  | 'alien_laser'
  | 'plasma_shot'
  | 'drone_shot'
  | 'bucket'
  | 'girder'
  | 'shockwave'
  | 'fist'
  | 'beam';

export interface EnemyProjectileOptions {
  style: EnemyShotStyle;
  vx?: number;
  vy?: number;
  damage?: number;
  /** Apply world gravity (falling buckets, debris). */
  gravity?: boolean;
  /** Destroyed after this many ms (default 4000). */
  lifetimeMs?: number;
  /** Pass through tiles (floor shockwaves, arm sweeps). */
  ignoreTerrain?: boolean;
  /** Keep existing after hitting the player (sweeps, beams, shockwaves). */
  persistent?: boolean;
  /** Floor wave: destroyed when there is no solid ground under it (or it hits a wall). */
  groundOnly?: boolean;
  /** Destroyed when leaving this horizontal range (boss arenas). */
  clampX?: { min: number; max: number };
  /** Override hitbox size. */
  body?: { width: number; height: number };
}

/** Generated fallback textures per style: [w, h, draw]. */
const FALLBACK: Record<EnemyShotStyle, [number, number, (g: Phaser.GameObjects.Graphics) => void]> = {
  alien_laser: [12, 4, (g) => g.fillStyle(0xff3be0).fillRect(0, 0, 12, 4).fillStyle(0xffffff).fillRect(2, 1, 8, 2)],
  plasma_shot: [8, 8, (g) => g.fillStyle(0x5cff7a).fillCircle(4, 4, 4).fillStyle(0xeaffea).fillCircle(4, 4, 2)],
  drone_shot: [7, 7, (g) => g.fillStyle(0xff2a2a).fillCircle(3.5, 3.5, 3.5).fillStyle(0xffd0d0).fillCircle(3.5, 3.5, 1.5)],
  bucket: [10, 10, (g) => g.fillStyle(0x9aa3ad).fillRect(1, 2, 8, 8).fillStyle(0x4aa8ff).fillRect(2, 2, 6, 3).fillStyle(0x555555).fillRect(0, 0, 10, 2)],
  girder: [28, 8, (g) => {
    g.fillStyle(0x8a3b22).fillRect(0, 0, 28, 8).fillStyle(0x5a2614);
    for (let x = 2; x < 28; x += 6) g.fillRect(x, 2, 3, 4);
  }],
  shockwave: [20, 12, (g) => g.fillStyle(0x7fe8ff, 0.9).fillTriangle(0, 12, 10, 0, 20, 12).fillStyle(0xffffff).fillTriangle(5, 12, 10, 4, 15, 12)],
  fist: [22, 14, (g) => g.fillStyle(0x6b7684).fillRect(0, 0, 22, 14).fillStyle(0xffb020).fillRect(2, 2, 4, 10).fillStyle(0x39414a).fillRect(18, 1, 4, 12)],
  beam: [8, 8, (g) => g.fillStyle(0xff3030, 0.85).fillRect(0, 0, 8, 8).fillStyle(0xffd0d0).fillRect(2, 0, 4, 8)],
};

/** Styles that map onto the shared `effects` atlas animations. */
const EFFECT_ANIM: Partial<Record<EnemyShotStyle, string>> = {
  alien_laser: 'alien_laser',
  plasma_shot: 'plasma_shot',
  drone_shot: 'drone_shot',
  shockwave: 'shockwave',
};

/**
 * Enemy/boss projectile. Lives in `ctx.groups.enemyProjectiles`; CombatSystem handles
 * player hits (`damage`, `onHitPlayer()`) and wall hits (`onHitWall()`). Auto-destroys after
 * its lifetime or when far outside the camera.
 */
export class EnemyProjectile extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  damage: number;
  readonly ignoreTerrain: boolean;
  readonly persistent: boolean;
  private expiresAt: number;
  /** Set false to make it harmless (e.g. while fading out). */
  harmful = true;

  constructor(
    readonly ctx: LevelContext,
    x: number,
    y: number,
    readonly opts: EnemyProjectileOptions,
  ) {
    const scene = ctx.scene;
    const effectAnim = EFFECT_ANIM[opts.style];
    const useAtlas = !!effectAnim && hasRealAtlas(scene, 'effects') && scene.anims.exists(animKey('effects', effectAnim));
    let texture: string;
    if (useAtlas) texture = 'effects';
    else {
      const [w, h, draw] = FALLBACK[opts.style];
      texture = ensureSimpleTexture(scene, `eproj-${opts.style}`, w, h, draw);
    }
    super(scene, x, y, texture);
    if (useAtlas) this.play(animKey('effects', effectAnim!));
    this.damage = opts.damage ?? 1;
    this.ignoreTerrain = !!opts.ignoreTerrain;
    this.persistent = !!opts.persistent;
    this.expiresAt = ctx.now() + (opts.lifetimeMs ?? 4000);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    ctx.groups.enemyProjectiles.add(this);
    this.setDepth(DEPTH.projectiles);
    const b = this.body;
    b.setAllowGravity(!!opts.gravity);
    if (opts.body) {
      b.setSize(opts.body.width, opts.body.height);
    } else {
      // Slightly forgiving hitbox.
      b.setSize(Math.max(3, this.width - 2), Math.max(3, this.height - 2));
    }
    b.setVelocity(opts.vx ?? 0, opts.vy ?? 0);
    if (opts.style === 'alien_laser' || opts.style === 'drone_shot' || opts.style === 'plasma_shot') {
      this.setRotation(Math.atan2(opts.vy ?? 0, opts.vx ?? 1));
    } else if ((opts.vx ?? 0) < 0 && opts.style !== 'bucket' && opts.style !== 'girder') {
      this.setFlipX(true);
    }
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;
    if (this.ctx.now() >= this.expiresAt) {
      this.destroy();
      return;
    }
    if (this.opts.clampX && (this.x < this.opts.clampX.min || this.x > this.opts.clampX.max)) {
      this.destroy();
      return;
    }
    if (this.opts.groundOnly) {
      const dir = Math.sign(this.body.velocity.x) || 1;
      const bottom = this.body.bottom;
      const below = this.ctx.ground.getTileAtWorldXY(this.x, bottom + 2);
      const ahead = this.ctx.ground.getTileAtWorldXY(this.x + dir * (this.body.width / 2 + 1), bottom - 4);
      if (!(below && below.index > 0) || (ahead && ahead.index > 0)) {
        this.ctx.effect('spark', this.x, bottom - 4);
        this.destroy();
        return;
      }
    }
    const v = this.ctx.scene.cameras.main.worldView;
    const m = 120;
    if (this.x < v.left - m || this.x > v.right + m || this.y > v.bottom + m || this.y < v.top - m * 2) this.destroy();
  }

  /** Called by CombatSystem after damaging the player. */
  onHitPlayer(): void {
    if (this.persistent) {
      // Persistent hazards stay; player invulnerability prevents repeated hits.
      return;
    }
    this.ctx.effect('spark', this.x, this.y);
    this.destroy();
  }

  /** Called by CombatSystem when hitting solid terrain (unless ignoreTerrain). */
  onHitWall(): void {
    if (this.opts.style === 'bucket' || this.opts.style === 'girder') {
      this.ctx.effect('dust', this.x, this.y + this.height / 2);
      this.ctx.sfx(this.opts.style === 'girder' ? 'boss-slam' : 'splash');
      if (this.opts.style === 'girder') this.ctx.shake(0.003, 80);
    } else {
      this.ctx.effect('spark', this.x, this.y);
    }
    this.destroy();
  }

  /** Extend/shorten remaining lifetime. */
  setLifetime(ms: number): this {
    this.expiresAt = this.ctx.now() + ms;
    return this;
  }
}
