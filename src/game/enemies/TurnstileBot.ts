import { Enemy, type StompOutcome } from '../entities/Enemy';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { playAnim } from '../systems/AnimationSystem';
import { ENEMY_FRAME_SIZE } from './enemyArt';
import { PhaseCycle, TURNSTILE_TIMING, propNum, turnstileStatus } from './ai';

/**
 * Turnstile Bot: patrols a platform and blocks the way. Its arms spin for 1.5 s, then it
 * rests for 1.5 s. It can only be stomped while resting (its last 0.45 s of rest blinks
 * yellow as a warning that the arms are about to spin). Landing on it while spinning hurts.
 * Projectiles/abilities damage it at any time (2 hp; a stomp is a knockout).
 */
export class TurnstileBot extends Enemy {
  private readonly cycle: PhaseCycle<'spin' | 'rest'>;
  private readonly speed: number;
  private warned = false;

  constructor(ctx: LevelContext, spawn: SpawnObject) {
    super(ctx, spawn, { kind: 'turnstileBot', hp: 2, contactDamage: 1, stompable: true, body: { width: 20, height: 28 }, gravity: true, frameSize: ENEMY_FRAME_SIZE.turnstileBot });
    this.speed = propNum(spawn.props, 'speed', 22);
    this.cycle = new PhaseCycle(
      [
        { state: 'rest', ms: propNum(spawn.props, 'restMs', TURNSTILE_TIMING.restMs) },
        { state: 'spin', ms: propNum(spawn.props, 'spinMs', TURNSTILE_TIMING.spinMs) },
      ],
      propNum(spawn.props, 'offset', 0),
    );
    this.setAI('rest');
  }

  get spinning(): boolean {
    return this.aiState === 'spin';
  }

  stompOutcome(): StompOutcome {
    return this.spinning ? 'hurt' : 'damage';
  }

  onStomp(): void {
    // A clean stomp while resting knocks it out regardless of remaining hp.
    this.takeHit({ amount: this.hp, fromX: this.player.x, kind: 'stomp' });
  }

  protected think(dt: number): void {
    this.cycle.update(dt);
    const st = turnstileStatus(this.cycle);
    const b = this.body;
    if (st.spinning) {
      if (this.aiState !== 'spin') {
        this.setAI('spin');
        this.ctx.sfx('turnstile-spin');
      }
      this.warned = false;
      if (b.blocked.down) b.setVelocityX(0);
      playAnim(this, 'attack', 'move');
    } else {
      if (this.aiState !== 'rest') this.setAI('rest');
      if (st.warning && !this.warned) {
        this.warned = true;
        this.telegraph(TURNSTILE_TIMING.warnMs, 0xffd23a, false);
      }
      this.patrol(this.speed);
      playAnim(this, 'move');
    }
  }
}
