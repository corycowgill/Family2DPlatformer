import { Enemy } from '../entities/Enemy';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { playAnim } from '../systems/AnimationSystem';
import { ENEMY_FRAME_SIZE } from './enemyArt';
import { aimVelocity, propNum } from './ai';

/**
 * Gnat: small alien flyer. Buzzes erratically around its home point; when the player is
 * close it hovers in place shaking (350 ms telegraph), swoops at where the player was,
 * then flies home. 1 hp, stompable.
 */
export class Gnat extends Enemy {
  private readonly radius: number;
  private readonly sight: number;
  private target = { x: 0, y: 0 };
  private retargetAt = 0;
  private cooldownUntil = 0;
  private swoop = { vx: 0, vy: 0 };
  /** Home can be moved (e.g. by an Overseer that spawned it). */
  home: { x: number; y: number };

  constructor(ctx: LevelContext, spawn: SpawnObject) {
    super(ctx, spawn, { kind: 'gnat', hp: 1, contactDamage: 1, stompable: true, body: { width: 10, height: 8 }, gravity: false, frameSize: ENEMY_FRAME_SIZE.gnat });
    this.radius = propNum(spawn.props, 'range', 28);
    this.sight = propNum(spawn.props, 'sight', 110);
    this.home = { x: spawn.x, y: spawn.y - 8 };
    this.target = { ...this.home };
    this.cooldownUntil = ctx.now() + 800;
    this.setAI('buzz');
  }

  protected think(): void {
    const b = this.body;
    const now = this.ctx.now();
    switch (this.aiState) {
      case 'buzz': {
        playAnim(this, 'move', 'idle');
        if (now >= this.retargetAt) {
          this.retargetAt = now + 250 + Math.random() * 250;
          this.target = { x: this.home.x + (Math.random() * 2 - 1) * this.radius, y: this.home.y + (Math.random() * 2 - 1) * this.radius * 0.6 };
        }
        b.setVelocity((this.target.x - this.x) * 4, (this.target.y - this.y) * 4);
        this.facing = b.velocity.x >= 0 ? 1 : -1;
        if (now >= this.cooldownUntil && this.playerAlive() && this.distanceToPlayer() < this.sight) {
          this.setAI('aim');
          this.facePlayer();
          this.telegraph(350, 0xff40ff, true);
          b.setVelocity(0, 0);
        }
        break;
      }
      case 'aim':
        b.setVelocity(0, 0);
        this.setAngle(Math.sin(this.stateTime / 18) * 12);
        if (this.stateTime >= 350) {
          this.setAngle(0);
          this.swoop = aimVelocity(this.x, this.y - 4, this.player.x, this.playerCenterY(), 165);
          this.setAI('swoop');
          this.ctx.sfx('enemy-swoop');
        }
        break;
      case 'swoop':
        playAnim(this, 'attack', 'move');
        b.setVelocity(this.swoop.vx, this.swoop.vy);
        if (this.stateTime > 650 || b.blocked.down || b.blocked.left || b.blocked.right) this.setAI('return');
        break;
      case 'return': {
        playAnim(this, 'move', 'idle');
        const v = aimVelocity(this.x, this.y, this.home.x, this.home.y, 70);
        b.setVelocity(v.vx, v.vy);
        if (Math.hypot(this.home.x - this.x, this.home.y - this.y) < 6 || this.stateTime > 2500) {
          this.cooldownUntil = now + 1400;
          this.setAI('buzz');
        }
        break;
      }
      default:
        this.setAI('buzz');
    }
  }
}
