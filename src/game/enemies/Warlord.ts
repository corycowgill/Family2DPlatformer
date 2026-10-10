import { DEPTH } from '../config';
import { EV, type HitInfo } from '../types';
import { Enemy, type StompOutcome } from '../entities/Enemy';
import { EnemyProjectile } from '../entities/Projectile';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { playAnim } from '../systems/AnimationSystem';
import { ENEMY_FRAME_SIZE } from './enemyArt';
import { aimVelocity, propNum } from './ai';

/**
 * Alien Warlord (mini-boss, 6 hp). Armored except during recovery windows:
 * - Slash: when close — raises its blade, blinks red 0.6 s, then slashes in front
 *   (short-range hitbox) → 1.1 s recovery (dizzy '*').
 * - Volley: at mid range — blinks purple 0.6 s, fires 3 plasma shots in a spread → 0.9 s recovery.
 * During recovery it is harmless to touch and stomps/projectiles/abilities damage it.
 * A stomp makes it hop back and resume. Outside recovery, stomps just bounce off its armor.
 * With spawn prop `boss=true` it emits BOSS_START / BOSS_HEALTH / BOSS_DEFEATED.
 */
export class Warlord extends Enemy {
  private readonly isBoss: boolean;
  private readonly bossName: string;
  private engaged = false;
  private volleyReadyAt = 0;
  private readonly sight: number;

  constructor(ctx: LevelContext, spawn: SpawnObject) {
    super(ctx, spawn, { kind: 'warlord', hp: 6, contactDamage: 1, stompable: true, body: { width: 24, height: 40 }, gravity: true, frameSize: ENEMY_FRAME_SIZE.warlord });
    this.isBoss = spawn.props.boss === true;
    this.bossName = String(spawn.props.name ?? 'Alien Warlord');
    this.sight = propNum(spawn.props, 'range', 220);
    this.cullMargin = 260;
    this.setAI('idle');
  }

  get recovering(): boolean {
    return this.aiState === 'recover';
  }

  stompOutcome(): StompOutcome {
    return this.recovering ? 'damage' : 'bounce';
  }

  hurtsOnContact(): boolean {
    return !this.recovering && super.hurtsOnContact();
  }

  protected blocksHit(hit: HitInfo): boolean {
    // Shell hits ('contact') and recovery-window hits get through.
    return !this.recovering && hit.kind !== 'contact';
  }

  takeHit(hit: HitInfo): boolean {
    const dealt = super.takeHit(hit);
    if (dealt && this.isBoss) this.ctx.events.emit(EV.BOSS_HEALTH, Math.max(0, this.hp), this.maxHp);
    return dealt;
  }

  onStomp(): void {
    const dealt = this.takeHit({ amount: this.player.attackPower ?? 1, fromX: this.player.x, kind: 'stomp' });
    if (dealt && !this.dead) {
      // Hop away and resume fighting.
      this.facePlayer();
      this.body.setVelocity(-this.facing * 110, -220);
      this.setAI('retreat');
    }
  }

  protected onHurt(): void {
    // No knockback: it stays planted so the recovery window stays predictable.
    playAnim(this, 'hit', 'idle', false);
    this.flash(90);
  }

  die(hit?: HitInfo): void {
    super.die(hit);
    if (this.isBoss) {
      this.ctx.shake(0.01, 400);
      this.ctx.events.emit(EV.BOSS_DEFEATED);
    }
  }

  private engage(): void {
    this.engaged = true;
    if (this.isBoss) {
      this.ctx.events.emit(EV.BOSS_START, this.bossName, this.maxHp);
      this.ctx.events.emit(EV.BOSS_HEALTH, this.hp, this.maxHp);
      this.ctx.sfx('boss-roar');
    }
  }

  private slashHitbox(): void {
    const x = this.x + this.facing * 22;
    const y = this.y - 20;
    const hb = new EnemyProjectile(this.ctx, x, y, { style: 'beam', damage: this.contactDamage, persistent: true, ignoreTerrain: true, lifetimeMs: 220, body: { width: 8, height: 8 } });
    hb.setDisplaySize(34, 34).setAlpha(0);
    hb.body.setSize(8, 8);
    const arc = this.scene.add.graphics().setDepth(DEPTH.effects);
    arc.lineStyle(3, 0xc0f0ff, 1).beginPath();
    arc.arc(0, 0, 20, -Math.PI / 2, Math.PI / 2, false);
    arc.strokePath();
    arc.setPosition(this.x + this.facing * 6, y).setScale(this.facing, 1);
    this.scene.tweens.add({ targets: arc, alpha: 0, duration: 220, onComplete: () => arc.destroy() });
    this.ctx.sfx('slash');
  }

  protected think(): void {
    const b = this.body;
    const p = this.player;
    const now = this.ctx.now();
    const dx = p.x - this.x;
    const adx = Math.abs(dx);
    switch (this.aiState) {
      case 'idle':
        playAnim(this, 'idle');
        if (b.blocked.down) b.setVelocityX(0);
        if (this.playerAlive() && adx < this.sight && Math.abs(p.y - this.y) < 100) {
          if (!this.engaged) this.engage();
          this.volleyReadyAt = now + 1200;
          this.setAI('approach');
        }
        break;
      case 'approach':
        this.facePlayer();
        playAnim(this, 'move');
        if (!this.playerAlive()) {
          this.setAI('idle');
          break;
        }
        if (adx < 56 && b.blocked.down) {
          b.setVelocityX(0);
          this.telegraph(600, 0xff3030);
          this.setAI('slashWindup');
        } else if (adx > 100 && now >= this.volleyReadyAt && b.blocked.down) {
          b.setVelocityX(0);
          this.telegraph(600, 0xd040ff);
          this.setAI('volleyWindup');
        } else if (b.blocked.down) {
          b.setVelocityX(this.groundAhead(this.facing, 4) ? this.facing * 48 : 0);
        }
        break;
      case 'slashWindup':
        if (b.blocked.down) b.setVelocityX(0);
        playAnim(this, 'attack', 'idle');
        this.setScale(1 + Math.min(1, this.stateTime / 600) * 0.08, 1);
        if (this.stateTime >= 600) {
          this.setScale(1, 1);
          this.slashHitbox();
          b.setVelocityX(this.groundAhead(this.facing, 6) ? this.facing * 90 : 0);
          this.setAI('slash');
        }
        break;
      case 'slash':
        if (this.stateTime >= 220) {
          b.setVelocityX(0);
          this.enterRecovery(1100);
        }
        break;
      case 'volleyWindup':
        if (b.blocked.down) b.setVelocityX(0);
        playAnim(this, 'attack', 'idle');
        if (this.stateTime >= 600) {
          const sx = this.x + this.facing * 16;
          const sy = this.y - 30;
          const base = aimVelocity(sx, sy, p.x, this.playerCenterY(), 115);
          const ang = Math.atan2(base.vy, base.vx);
          for (const d of [-0.28, 0, 0.28]) {
            this.shoot(sx, sy, { style: 'plasma_shot', vx: Math.cos(ang + d) * 115, vy: Math.sin(ang + d) * 115, lifetimeMs: 4000 });
          }
          this.volleyReadyAt = now + 3000;
          this.enterRecovery(900);
        }
        break;
      case 'recover':
        if (b.blocked.down) b.setVelocityX(0);
        playAnim(this, 'idle');
        if (this.stateTime >= this.recoverMs) {
          this.clearTint();
          this.setAI('approach');
        }
        break;
      case 'retreat':
        playAnim(this, 'move');
        if (this.stateTime > 150 && b.blocked.down) {
          b.setVelocityX(0);
          this.setAI('approach');
        }
        break;
      default:
        this.setAI('idle');
    }
  }

  private recoverMs = 1000;
  private enterRecovery(ms: number): void {
    this.recoverMs = ms;
    this.setAI('recover');
    this.showMark('*', ms, '#9fe8ff');
    this.setTint(0x9fb8ff);
  }
}
