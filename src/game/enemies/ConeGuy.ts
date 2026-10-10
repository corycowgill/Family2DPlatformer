import { Enemy, type StompOutcome } from '../entities/Enemy';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { hasAnim, playAnim } from '../systems/AnimationSystem';
import { ENEMY_FRAME_SIZE } from './enemyArt';
import { kickDirection, propNum, shellHurtsPlayer } from './ai';

const SHELL_SPEED = 210;
const WAKE_MS = 6000;
const WAKE_WARN_MS = 1200;

/**
 * Cone Guy: a walking traffic cone. Koopa-shell rules, tuned to be readable:
 * - walk: patrols, hurts on contact. Stomp → hides in its cone ('shell').
 * - shell (resting): harmless; touching it (or stomping it) kicks it away from the player.
 *   After 6 s it wobbles (1.2 s warning) and walks again.
 * - slide: speeds along the ground bouncing off walls, defeating any enemy it hits. It
 *   only hurts the player if it is moving TOWARD them (never right after a kick). Stomp it
 *   to stop it.
 */
export class ConeGuy extends Enemy {
  private readonly speed: number;
  private kickedAt = -1e9;

  constructor(ctx: LevelContext, spawn: SpawnObject) {
    super(ctx, spawn, { kind: 'coneGuy', hp: 1, contactDamage: 1, stompable: true, body: { width: 16, height: 24 }, gravity: true, frameSize: ENEMY_FRAME_SIZE.coneGuy });
    this.speed = propNum(spawn.props, 'speed', 30);
    this.setAI('walk');
  }

  get isShell(): boolean {
    return this.aiState === 'shell' || this.aiState === 'slide';
  }

  stompOutcome(): StompOutcome {
    return 'damage';
  }

  onStomp(): void {
    const now = this.ctx.now();
    if (this.aiState === 'walk') {
      this.enterShell();
      this.ctx.sfx('stomp');
      this.ctx.effect('dust', this.x, this.y);
    } else if (this.aiState === 'slide') {
      this.setAI('shell');
      this.body.setVelocityX(0);
      this.ctx.sfx('stomp');
    } else if (this.aiState === 'shell' && now - this.kickedAt > 200) {
      this.kick(kickDirection(this.x, this.player.x, this.player.facing));
    }
  }

  onPlayerContact(): boolean {
    if (this.aiState === 'shell') {
      if (this.ctx.now() - this.kickedAt > 200) this.kick(kickDirection(this.x, this.player.x, this.player.facing));
      return true;
    }
    if (this.aiState === 'slide') {
      // Harmless unless sliding toward the player.
      return !shellHurtsPlayer(this.body.velocity.x, this.x, this.player.x, this.ctx.now() - this.kickedAt);
    }
    return false;
  }

  harmsEnemies(): boolean {
    return this.aiState === 'slide' && Math.abs(this.body.velocity.x) > 40;
  }

  /** Hidden-in-cone pose: 'shell' anim if the atlas has one, else the squashed `die_1` frame. */
  private showShell(): void {
    if (hasAnim(this.scene, this.texture.key, 'shell')) {
      playAnim(this, 'shell');
      return;
    }
    if (this.texture.has('die_1')) {
      this.anims.stop();
      if (this.frame.name !== 'die_1') this.setFrame('die_1');
    }
  }

  private enterShell(): void {
    this.setAI('shell');
    this.body.setVelocityX(0);
    this.resizeBody(16, 12);
    this.playerGraceUntil = this.ctx.now() + 250;
    this.showShell();
  }

  private kick(dir: 1 | -1): void {
    this.facing = dir;
    this.kickedAt = this.ctx.now();
    this.playerGraceUntil = this.kickedAt + 350;
    this.setAI('slide');
    this.body.setVelocityX(dir * SHELL_SPEED);
    this.ctx.sfx('shell-kick');
    this.ctx.effect('spark', this.x - dir * 6, this.y - 6);
  }

  protected think(): void {
    const b = this.body;
    switch (this.aiState) {
      case 'walk':
        this.patrol(this.speed);
        playAnim(this, 'move');
        break;
      case 'shell': {
        if (b.blocked.down) b.setVelocityX(0);
        this.showShell();
        const wakeIn = WAKE_MS - this.stateTime;
        // Wobble warning before waking up.
        this.setAngle(wakeIn < WAKE_WARN_MS ? Math.sin(this.stateTime / 40) * 8 : 0);
        if (wakeIn <= 0) {
          this.setAngle(0);
          this.resizeBody(16, 24);
          this.body.y -= 1;
          this.setAI('walk');
          this.facePlayer();
        }
        break;
      }
      case 'slide':
        this.showShell();
        this.setAngle(0);
        if (this.wallAhead(this.facing)) {
          this.facing = (this.facing * -1) as 1 | -1;
          this.ctx.sfx('bump');
        }
        b.setVelocityX(this.facing * SHELL_SPEED);
        break;
      default:
        this.setAI('walk');
    }
  }
}
