import Phaser from 'phaser';
import { DEPTH } from '../config';
import type { HitInfo } from '../types';
import { Enemy } from '../entities/Enemy';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { playAnim } from '../systems/AnimationSystem';
import { ENEMY_FRAME_SIZE, ensureSimpleTexture, hasRealAtlas } from './enemyArt';
import { propNum, shieldBlocks } from './ai';

/**
 * Raccoon: holds a trash-can-lid shield in front (2 hp). Frontal attacks/projectiles
 * are blocked while it faces the player; the first stomp knocks the lid off. When the
 * player is near it telegraphs ('!' + red blink, 450 ms), charges briefly, then pants
 * (recovery window, 700 ms).
 */
export class Raccoon extends Enemy {
  hasLid = true;
  private lid?: Phaser.GameObjects.Image;
  /** The Art team's raccoon frames already show the lid (we crop it away once knocked off). */
  private readonly artHasLid: boolean;
  private readonly speed: number;
  private readonly sight: number;
  private cooldownUntil = 0;

  constructor(ctx: LevelContext, spawn: SpawnObject) {
    super(ctx, spawn, { kind: 'raccoon', hp: 2, contactDamage: 1, stompable: true, body: { width: 24, height: 20 }, gravity: true, frameSize: ENEMY_FRAME_SIZE.raccoon });
    this.speed = propNum(spawn.props, 'speed', 28);
    this.sight = propNum(spawn.props, 'range', 96);
    const key = ensureSimpleTexture(ctx.scene, 'raccoon-lid', 6, 16, (g) =>
      g.fillStyle(0x9aa3ad).fillRect(1, 0, 4, 16).fillStyle(0xd7dde3).fillRect(2, 1, 2, 14).fillStyle(0x5a6068).fillRect(0, 6, 1, 4),
    );
    this.lid = ctx.scene.add.image(this.x, this.y, key).setOrigin(0.5, 1).setDepth(DEPTH.enemies + 1);
    this.artHasLid = hasRealAtlas(ctx.scene, 'raccoon');
    if (this.artHasLid) this.lid.setVisible(false);
    this.setAI('patrol');
  }

  protected blocksHit(hit: HitInfo): boolean {
    return shieldBlocks(this.hasLid, this.x, this.facing, hit.kind, hit.fromX);
  }

  protected onBlocked(): void {
    this.lid?.setTintFill(0xffffff);
    this.scene.time.delayedCall(80, () => this.lid?.active && this.lid.clearTint());
  }

  protected onHurt(hit: HitInfo): void {
    super.onHurt(hit);
    if (this.hasLid) this.knockLidOff(hit.fromX);
    this.setAI('recover');
  }

  private knockLidOff(fromX: number): void {
    this.hasLid = false;
    const lid = this.lid;
    this.lid = undefined;
    if (!lid) return;
    lid.setVisible(true);
    // Hide the lid drawn in the atlas frames (it occupies the front ~third of the frame).
    if (this.artHasLid) this.setCrop(0, 0, Math.round(this.width * 0.68), this.height);
    this.ctx.sfx('clang');
    const dir = Math.sign(this.x - fromX) || 1;
    this.scene.tweens.add({ targets: lid, x: lid.x + dir * 40, y: lid.y - 30, angle: dir * 540, duration: 420, ease: 'Quad.easeOut' });
    this.scene.tweens.add({ targets: lid, y: lid.y + 60, alpha: 0, delay: 420, duration: 380, ease: 'Quad.easeIn', onComplete: () => lid.destroy() });
  }

  protected think(): void {
    const b = this.body;
    const p = this.player;
    const now = this.ctx.now();
    const dx = p.x - this.x;
    const near = Math.abs(dx) < this.sight && Math.abs(p.y - this.y) < 28 && this.playerAlive();
    switch (this.aiState) {
      case 'patrol':
        this.patrol(this.speed);
        playAnim(this, 'move');
        if (near && now >= this.cooldownUntil && b.blocked.down) {
          this.facePlayer();
          b.setVelocityX(0);
          this.telegraph(450);
          this.setAI('windup');
        }
        break;
      case 'windup':
        b.setVelocityX(0);
        playAnim(this, 'idle');
        this.x += Math.sin(this.stateTime / 20) * 0.4;
        if (this.stateTime > 450) {
          this.setAI('charge');
          this.ctx.sfx('raccoon-hiss');
        }
        break;
      case 'charge':
        playAnim(this, 'attack', 'move');
        b.setVelocityX(this.facing * (this.hasLid ? 130 : 150));
        if (this.stateTime > 650 || this.wallAhead(this.facing) || !this.groundAhead(this.facing, 4)) {
          b.setVelocityX(0);
          this.setAI('recover');
        }
        break;
      case 'recover':
        if (b.blocked.down) b.setVelocityX(0);
        playAnim(this, 'idle');
        if (this.stateTime > 700) {
          this.cooldownUntil = now + 900;
          this.setAI('patrol');
        }
        break;
      default:
        this.setAI('patrol');
    }
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (this.lid && this.active) {
      this.lid.setPosition(this.x + this.facing * 11, this.y - 2);
      this.lid.setVisible(this.visible && !this.artHasLid);
    }
  }

  destroy(fromScene?: boolean): void {
    this.lid?.destroy();
    this.lid = undefined;
    super.destroy(fromScene);
  }

  die(hit?: HitInfo): void {
    if (this.hasLid) this.knockLidOff(hit?.fromX ?? this.x);
    super.die(hit);
  }
}
