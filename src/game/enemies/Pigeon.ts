import { Enemy } from '../entities/Enemy';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { playAnim } from '../systems/AnimationSystem';
import { ENEMY_FRAME_SIZE } from './enemyArt';
import { propNum } from './ai';

/**
 * Pigeon: waddles slowly; every few seconds crouches (telegraph) and does a short
 * hop-flight (~1.5 tiles up) gliding forward, then lands. Stompable, 1 hp.
 */
export class Pigeon extends Enemy {
  speed: number;
  private nextHopAt: number;
  constructor(ctx: LevelContext, spawn: SpawnObject) {
    super(ctx, spawn, { kind: 'pigeon', hp: 1, contactDamage: 1, stompable: true, body: { width: 14, height: 12 }, gravity: true, frameSize: ENEMY_FRAME_SIZE.pigeon });
    this.speed = propNum(spawn.props, 'speed', 22);
    this.nextHopAt = ctx.now() + 1500 + ((spawn.id * 733) % 2000);
    this.setAI('walk');
  }

  protected think(): void {
    const b = this.body;
    const now = this.ctx.now();
    switch (this.aiState) {
      case 'walk':
        this.patrol(this.speed);
        playAnim(this, 'move');
        if (b.blocked.down && now >= this.nextHopAt) {
          this.setAI('crouch');
          b.setVelocityX(0);
          this.setScale(1.1, 0.85);
        }
        break;
      case 'crouch':
        playAnim(this, 'idle');
        if (this.stateTime > 220) {
          this.setScale(1, 1);
          this.setAI('fly');
          // ~1.5 tiles: v = sqrt(2 g h) ≈ sqrt(2*1100*24)
          b.setVelocity(this.facing * 55, -230);
          this.ctx.sfx('flap');
        }
        break;
      case 'fly':
        playAnim(this, 'attack', 'move');
        // Glide: weak gravity while descending.
        b.setGravityY(b.velocity.y > 0 ? -850 : 0);
        b.setVelocityX(this.facing * 55);
        if (this.wallAhead(this.facing)) this.facing = (this.facing * -1) as 1 | -1;
        if (this.stateTime > 150 && b.blocked.down) {
          b.setGravityY(0);
          this.setAI('walk');
          this.nextHopAt = now + 2200 + Math.random() * 1800;
        }
        break;
      default:
        this.setAI('walk');
    }
  }
}
