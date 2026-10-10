import { Enemy } from '../entities/Enemy';
import type { HitInfo } from '../types';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { playAnim } from '../systems/AnimationSystem';
import { ENEMY_FRAME_SIZE } from './enemyArt';
import { propNum } from './ai';

/**
 * Juggernaut (reserved for later worlds): heavy alien walker, 5 hp. Trudges toward the
 * player; when within range it raises its fist (0.7 s blink + squash), slams the ground
 * and sends a shockwave along the floor in both directions (jump over it), then
 * recovers for 0.9 s. Stompable at any time (doesn't flinch).
 */
export class Juggernaut extends Enemy {
  private readonly sight: number;
  private cooldownUntil = 0;

  constructor(ctx: LevelContext, spawn: SpawnObject) {
    super(ctx, spawn, { kind: 'juggernaut', hp: 5, contactDamage: 1, stompable: true, body: { width: 34, height: 38 }, gravity: true, frameSize: ENEMY_FRAME_SIZE.juggernaut });
    this.sight = propNum(spawn.props, 'range', 150);
    this.cullMargin = 240;
    this.setAI('walk');
  }

  protected onHurt(_hit: HitInfo): void {
    playAnim(this, 'hit', 'idle', false);
    this.flash(90);
  }

  protected think(): void {
    const b = this.body;
    const p = this.player;
    const now = this.ctx.now();
    const adx = Math.abs(p.x - this.x);
    switch (this.aiState) {
      case 'walk':
        playAnim(this, 'move');
        if (this.playerAlive() && adx < this.sight * 1.6) this.facePlayer();
        if (b.blocked.down) b.setVelocityX(this.groundAhead(this.facing, 4) && !this.wallAhead(this.facing) ? this.facing * 18 : 0);
        if (this.playerAlive() && adx < this.sight && Math.abs(p.y - this.y) < 64 && now >= this.cooldownUntil && b.blocked.down) {
          b.setVelocityX(0);
          this.telegraph(700, 0xffb020);
          this.setAI('windup');
        }
        break;
      case 'windup':
        b.setVelocityX(0);
        playAnim(this, 'attack', 'idle');
        this.setScale(1, 1 + Math.min(1, this.stateTime / 700) * 0.1);
        if (this.stateTime >= 700) {
          this.setScale(1.15, 0.85);
          this.scene.tweens.add({ targets: this, scaleX: 1, scaleY: 1, duration: 200 });
          this.smash();
          this.setAI('recover');
        }
        break;
      case 'recover':
        playAnim(this, 'idle');
        if (this.stateTime >= 900) {
          this.cooldownUntil = now + 1500;
          this.setAI('walk');
        }
        break;
      default:
        this.setAI('walk');
    }
  }

  private smash(): void {
    this.ctx.shake(0.006, 180);
    this.ctx.sfx('boss-slam');
    this.ctx.effect('shockwave', this.x, this.y - 6);
    for (const dir of [-1, 1] as const) {
      this.shoot(this.x + dir * (this.body.width / 2 + 8), this.y - 6, { style: 'shockwave', vx: dir * 150, ignoreTerrain: true, groundOnly: true, persistent: true, lifetimeMs: 1600 });
    }
  }
}
