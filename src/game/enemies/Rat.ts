import { Enemy } from '../entities/Enemy';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { playAnim } from '../systems/AnimationSystem';

/** Rat: scurries quickly along the ground, reversing at walls and ledges. */
export class Rat extends Enemy {
  speed = 70;
  constructor(ctx: LevelContext, spawn: SpawnObject) {
    super(ctx, spawn, { kind: 'rat', hp: 1, contactDamage: 1, stompable: true, body: { width: 18, height: 10 }, gravity: true, frameSize: { w: 32, h: 20 } });
  }
  protected think(): void {
    if (this.body.blocked.down) {
      if (this.wallAhead(this.facing) || !this.groundAhead(this.facing)) this.facing = (this.facing * -1) as 1 | -1;
      this.body.setVelocityX(this.facing * this.speed);
    }
    playAnim(this, 'move');
  }
}
