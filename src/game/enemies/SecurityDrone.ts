import { Enemy } from '../entities/Enemy';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { playAnim } from '../systems/AnimationSystem';
import { ENEMY_FRAME_SIZE } from './enemyArt';
import { aimVelocity, hoverOffset, propNum } from './ai';

/**
 * Security Drone: hovers on a sine path around its spawn point. Every ~2.5 s, if the player
 * is within range, its red light blinks for 0.5 s and it fires a slow shot at the player.
 * Stompable, 1 hp.
 */
export class SecurityDrone extends Enemy {
  private readonly range: number;
  private readonly sight: number;
  private readonly interval: number;
  private t: number;
  private nextShotAt: number;
  private readonly baseY: number;

  constructor(ctx: LevelContext, spawn: SpawnObject) {
    super(ctx, spawn, { kind: 'securityDrone', hp: 1, contactDamage: 1, stompable: true, body: { width: 18, height: 12 }, gravity: false, frameSize: ENEMY_FRAME_SIZE.securityDrone });
    this.range = propNum(spawn.props, 'range', 40);
    this.sight = propNum(spawn.props, 'sight', 220);
    this.interval = propNum(spawn.props, 'interval', 2500);
    this.t = (spawn.id * 997) % 3000;
    this.nextShotAt = ctx.now() + 1200 + (spawn.id % 5) * 200;
    this.baseY = spawn.y - 4;
    this.setAI('hover');
  }

  protected think(dt: number): void {
    this.t += dt;
    const b = this.body;
    const tx = this.homeX + hoverOffset(this.t, this.range, 3200);
    const ty = this.baseY + hoverOffset(this.t, 6, 1100);
    b.setVelocity((tx - this.x) * 6, (ty - this.y) * 6);
    const now = this.ctx.now();
    switch (this.aiState) {
      case 'hover': {
        playAnim(this, 'move', 'idle');
        this.facePlayer();
        const inRange = this.distanceToPlayer() < this.sight && this.playerAlive();
        if (inRange && now >= this.nextShotAt) {
          this.setAI('aim');
          this.telegraph(500, 0xff2020, false);
        }
        break;
      }
      case 'aim':
        playAnim(this, 'attack', 'idle');
        this.facePlayer();
        if (this.stateTime >= 500) {
          const sx = this.x + this.facing * 6;
          const sy = this.y - 6;
          const v = aimVelocity(sx, sy, this.player.x, this.playerCenterY(), 85);
          this.shoot(sx, sy, { style: 'drone_shot', vx: v.vx, vy: v.vy, lifetimeMs: 5000 });
          this.nextShotAt = now + this.interval;
          this.setAI('hover');
        }
        break;
      default:
        this.setAI('hover');
    }
  }
}
