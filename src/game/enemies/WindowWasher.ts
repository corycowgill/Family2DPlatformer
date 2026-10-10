import Phaser from 'phaser';
import { DEPTH, TILE_SIZE } from '../config';
import type { HitInfo } from '../types';
import { Enemy } from '../entities/Enemy';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { playAnim } from '../systems/AnimationSystem';
import { ENEMY_FRAME_SIZE } from './enemyArt';
import { hoverOffset, playerBeneath, propNum } from './ai';

/**
 * Window Washer: hangs on a rope from the platform/ceiling above its spawn and bobs up
 * and down. When the player passes beneath, it shakes (0.5 s telegraph) and drops a
 * bucket. The bucket is the threat; the washer itself can be stomped or shot (1 hp).
 * Props: `rope` (rope length in tiles, default: hangs where placed), `dx` (trigger width px).
 */
export class WindowWasher extends Enemy {
  private readonly anchorY: number;
  private readonly restY: number;
  private readonly rope: Phaser.GameObjects.Graphics;
  private readonly triggerDx: number;
  private cooldownUntil = 0;
  private t = 0;

  constructor(ctx: LevelContext, spawn: SpawnObject) {
    super(ctx, spawn, { kind: 'windowWasher', hp: 1, contactDamage: 1, stompable: true, body: { width: 18, height: 30 }, gravity: false, frameSize: ENEMY_FRAME_SIZE.windowWasher });
    this.triggerDx = propNum(spawn.props, 'dx', 26);
    // Find the anchor: first solid/one-way tile above the spawn (up to 12 tiles).
    let anchor = spawn.y - 6 * TILE_SIZE;
    for (let y = spawn.y - TILE_SIZE - 1; y > spawn.y - 13 * TILE_SIZE; y -= TILE_SIZE) {
      const g = ctx.ground.getTileAtWorldXY(spawn.x, y);
      const o = ctx.oneway?.getTileAtWorldXY(spawn.x, y);
      if ((g && g.index > 0) || (o && o.index > 0)) {
        anchor = (g ?? o)!.getBottom();
        break;
      }
    }
    this.anchorY = anchor;
    const ropeTiles = propNum(spawn.props, 'rope', 0);
    this.restY = ropeTiles > 0 ? anchor + ropeTiles * TILE_SIZE + 22 : spawn.y;
    this.setY(this.restY);
    this.rope = ctx.scene.add.graphics().setDepth(DEPTH.enemies - 1);
    this.t = (spawn.id * 431) % 2400;
    this.setAI('hang');
  }

  protected think(dt: number): void {
    this.t += dt;
    const b = this.body;
    const now = this.ctx.now();
    const bob = hoverOffset(this.t, 8, 2400);
    b.setVelocityX(0);
    b.setVelocityY((this.restY + bob - this.y) * 6);
    const p = this.player;
    switch (this.aiState) {
      case 'hang':
        playAnim(this, 'idle');
        if (now >= this.cooldownUntil && this.playerAlive() && playerBeneath(this.x, this.y, p.x, p.y, this.triggerDx)) {
          this.setAI('shake');
          this.telegraph(500, 0x6fd0ff, true);
        }
        break;
      case 'shake':
        playAnim(this, 'attack', 'idle');
        this.setAngle(Math.sin(this.stateTime / 25) * 6);
        if (this.stateTime >= 500) {
          this.setAngle(0);
          this.shoot(this.x + this.facing * 6, this.y - 4, { style: 'bucket', vx: 0, vy: 30, gravity: true, lifetimeMs: 4000 });
          this.ctx.sfx('bucket-drop');
          this.cooldownUntil = now + 1800;
          this.setAI('hang');
        }
        break;
      default:
        this.setAI('hang');
    }
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active || !this.rope.active) return;
    this.rope.clear();
    if (this.dead) return;
    this.rope.lineStyle(1, 0xd8d0b0, 1).lineBetween(this.x, this.anchorY, this.x, this.y - this.displayHeight + 4);
    this.rope.fillStyle(0x7a5b3a, 1).fillRect(this.x - 3, this.anchorY, 6, 2);
  }

  die(hit?: HitInfo): void {
    this.rope.clear();
    super.die(hit);
    // Falls off the rope.
    this.scene.tweens.add({ targets: this, y: this.y + 60, duration: 500, ease: 'Quad.easeIn' });
  }

  destroy(fromScene?: boolean): void {
    this.rope?.destroy();
    super.destroy(fromScene);
  }
}
