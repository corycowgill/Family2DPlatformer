import Phaser from 'phaser';
import { DEPTH } from '../config';
import { Enemy } from '../entities/Enemy';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { playAnim } from '../systems/AnimationSystem';
import { ENEMY_FRAME_SIZE } from './enemyArt';
import { aimVelocity, hoverOffset, propNum, telegraphBlink } from './ai';

/**
 * Wasp: alien hover drone (2 hp). Drifts around its spawn; when the player is in range it
 * locks on — a thin aim line is drawn to the locked target for 0.6 s — then fires a fast
 * laser along that line. 1.8 s between shots. Stompable.
 */
export class Wasp extends Enemy {
  private readonly sight: number;
  private t: number;
  private nextShotAt: number;
  private aim = { x: 0, y: 0 };
  private readonly line: Phaser.GameObjects.Graphics;

  constructor(ctx: LevelContext, spawn: SpawnObject) {
    super(ctx, spawn, { kind: 'wasp', hp: 2, contactDamage: 1, stompable: true, body: { width: 18, height: 12 }, gravity: false, frameSize: ENEMY_FRAME_SIZE.wasp });
    this.sight = propNum(spawn.props, 'sight', 200);
    this.t = (spawn.id * 577) % 4000;
    this.nextShotAt = ctx.now() + 1000;
    this.line = ctx.scene.add.graphics().setDepth(DEPTH.projectiles);
    this.setAI('hover');
  }

  protected think(dt: number): void {
    this.t += dt;
    const b = this.body;
    const now = this.ctx.now();
    const tx = this.homeX + hoverOffset(this.t, 24, 4000);
    const ty = this.homeY - 6 + hoverOffset(this.t, 10, 1700);
    this.line.clear();
    switch (this.aiState) {
      case 'hover':
        b.setVelocity((tx - this.x) * 4, (ty - this.y) * 4);
        playAnim(this, 'move', 'idle');
        this.facePlayer();
        if (now >= this.nextShotAt && this.playerAlive() && this.distanceToPlayer() < this.sight) {
          this.aim = { x: this.player.x, y: this.playerCenterY() };
          this.telegraph(600, 0xff3030, false);
          this.setAI('lock');
        }
        break;
      case 'lock': {
        b.setVelocity(0, 0);
        playAnim(this, 'attack', 'idle');
        // Line follows the player for the first 60 % then locks (dodgeable).
        if (this.stateTime < 360) this.aim = { x: this.player.x, y: this.playerCenterY() };
        const on = telegraphBlink(this.stateTime, 600);
        this.line.lineStyle(1, 0xff3030, on ? 0.9 : 0.35).lineBetween(this.x + this.facing * 10, this.y - 6, this.aim.x, this.aim.y);
        if (this.stateTime >= 600) {
          const sx = this.x + this.facing * 10;
          const sy = this.y - 6;
          const v = aimVelocity(sx, sy, this.aim.x, this.aim.y, 200);
          this.shoot(sx, sy, { style: 'alien_laser', vx: v.vx, vy: v.vy, lifetimeMs: 3000 });
          this.nextShotAt = now + 1800;
          this.setAI('hover');
        }
        break;
      }
      default:
        this.setAI('hover');
    }
  }

  die(hit?: Parameters<Enemy['die']>[0]): void {
    this.line.clear();
    super.die(hit);
  }

  destroy(fromScene?: boolean): void {
    this.line?.destroy();
    super.destroy(fromScene);
  }
}
