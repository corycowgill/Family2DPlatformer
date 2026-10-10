import { Enemy } from '../entities/Enemy';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { playAnim } from '../systems/AnimationSystem';
import { ENEMY_FRAME_SIZE } from './enemyArt';
import { isInFront, propNum } from './ai';

/**
 * Rat: scurries quickly along the ground, reversing at walls and ledges (with a tiny
 * turn-around pause so it reads clearly). Speeds up when the player is close in front.
 */
export class Rat extends Enemy {
  speed: number;
  constructor(ctx: LevelContext, spawn: SpawnObject) {
    super(ctx, spawn, { kind: 'rat', hp: 1, contactDamage: 1, stompable: true, body: { width: 18, height: 10 }, gravity: true, frameSize: ENEMY_FRAME_SIZE.rat });
    this.speed = propNum(spawn.props, 'speed', 70);
    this.setAI('scurry');
  }
  protected think(): void {
    const b = this.body;
    if (this.aiState === 'turn') {
      b.setVelocityX(0);
      playAnim(this, 'idle');
      if (this.stateTime > 120) this.setAI('scurry');
      return;
    }
    if (!b.blocked.down) return;
    if (this.wallAhead(this.facing) || !this.groundAhead(this.facing)) {
      this.facing = (this.facing * -1) as 1 | -1;
      this.setAI('turn');
      return;
    }
    const near = Math.abs(this.player.x - this.x) < 80 && Math.abs(this.player.y - this.y) < 24 && isInFront(this.x, this.facing, this.player.x);
    b.setVelocityX(this.facing * this.speed * (near ? 1.3 : 1));
    playAnim(this, 'move');
  }
}
