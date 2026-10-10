import { Enemy } from '../entities/Enemy';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { playAnim } from '../systems/AnimationSystem';
import { ENEMY_FRAME_SIZE } from './enemyArt';
import { propNum } from './ai';

/**
 * Skirmisher: fast alien foot soldier (2 hp). Patrols; when the player is in range:
 * - close (< 60 px): crouches & blinks (450 ms), then lunges forward;
 * - farther: raises its blaster & blinks (500 ms), then fires a horizontal laser.
 * Each attack is followed by a 650 ms recovery (stand still) — the time to stomp it.
 */
export class Skirmisher extends Enemy {
  private readonly speed: number;
  private readonly sight: number;
  private cooldownUntil = 0;

  constructor(ctx: LevelContext, spawn: SpawnObject) {
    super(ctx, spawn, { kind: 'skirmisher', hp: 2, contactDamage: 1, stompable: true, body: { width: 14, height: 26 }, gravity: true, frameSize: ENEMY_FRAME_SIZE.skirmisher });
    this.speed = propNum(spawn.props, 'speed', 50);
    this.sight = propNum(spawn.props, 'range', 150);
    this.setAI('patrol');
  }

  protected think(): void {
    const b = this.body;
    const p = this.player;
    const now = this.ctx.now();
    const dx = p.x - this.x;
    const seen = this.playerAlive() && Math.abs(dx) < this.sight && Math.abs(p.y - this.y) < 40;
    switch (this.aiState) {
      case 'patrol':
        this.patrol(this.speed);
        playAnim(this, 'move');
        if (seen && b.blocked.down && now >= this.cooldownUntil) {
          this.facePlayer();
          b.setVelocityX(0);
          if (Math.abs(dx) < 60) {
            this.setAI('lungeWindup');
            this.telegraph(450);
            this.setScale(1.1, 0.9);
          } else {
            this.setAI('shootWindup');
            this.telegraph(500, 0xff40ff);
          }
        }
        break;
      case 'lungeWindup':
        b.setVelocityX(0);
        playAnim(this, 'idle');
        if (this.stateTime >= 450) {
          this.setScale(1, 1);
          this.setAI('lunge');
          b.setVelocity(this.facing * 210, -120);
          this.ctx.sfx('enemy-swoop');
        }
        break;
      case 'lunge':
        playAnim(this, 'attack', 'move');
        if (this.stateTime > 80 && b.blocked.down) {
          b.setVelocityX(0);
          this.setAI('recover');
        } else if (!this.groundAhead(this.facing, 4) && b.blocked.down) {
          b.setVelocityX(0);
        }
        break;
      case 'shootWindup':
        b.setVelocityX(0);
        playAnim(this, 'attack', 'idle');
        if (this.stateTime >= 500) {
          this.shoot(this.x + this.facing * 12, this.y - 17, { style: 'alien_laser', vx: this.facing * 190, vy: 0, lifetimeMs: 3000 });
          this.setAI('recover');
        }
        break;
      case 'recover':
        if (b.blocked.down) b.setVelocityX(0);
        playAnim(this, 'idle');
        if (this.stateTime >= 650) {
          this.cooldownUntil = now + 800;
          this.setAI('patrol');
        }
        break;
      default:
        this.setAI('patrol');
    }
  }
}
