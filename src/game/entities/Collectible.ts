import Phaser from 'phaser';
import { DEPTH } from '../config';
import { EV, type PickupKind } from '../types';
import type { Collectible, LevelContext } from '../world/LevelContext';
import { playAnim } from '../systems/AnimationSystem';

/** Durations of timed power-ups (ms). */
export const POWERUP_DURATION: Partial<Record<PickupKind, number>> = {
  pizza: 10000,
  ctaPass: 10000,
};

const FRAME: Record<PickupKind, string> = {
  coin: 'coin_0',
  hotdog: 'hotdog',
  pizza: 'pizza',
  ctaPass: 'cta_pass',
  star: 'star_0',
  souvenir: 'souvenir_0',
  oneUp: 'one_up',
};

/**
 * A pickup. Static (no gravity) unless `dynamic` — e.g. popped out of a block.
 */
export class Pickup extends Phaser.Physics.Arcade.Sprite implements Collectible {
  declare body: Phaser.Physics.Arcade.Body;
  private taken = false;

  constructor(
    ctx: LevelContext,
    x: number,
    y: number,
    readonly kind: PickupKind,
    readonly index = 0,
    dynamic = false,
  ) {
    super(ctx.scene, x, y, 'items', kind === 'souvenir' ? `souvenir_${index}` : FRAME[kind]);
    ctx.scene.add.existing(this);
    ctx.groups.pickups.add(this);
    ctx.scene.physics.add.existing(this);
    this.setDepth(DEPTH.pickups);
    this.body.setAllowGravity(dynamic);
    this.body.setSize(12, 12);
    if (kind === 'coin') playAnim(this, 'coin');
    if (kind === 'star') playAnim(this, 'star');
    if (kind !== 'coin' && !dynamic) {
      // gentle hover so rare items stand out
      ctx.scene.tweens.add({ targets: this, y: y - 3, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
  }

  collect(ctx: LevelContext): void {
    if (this.taken) return;
    this.taken = true;
    this.body.enable = false;
    const p = ctx.player;
    switch (this.kind) {
      case 'hotdog':
        p.heal(1);
        break;
      case 'pizza':
      case 'ctaPass':
        p.addPowerup(this.kind, POWERUP_DURATION[this.kind] ?? 8000);
        break;
      case 'souvenir':
        ctx.events.emit(EV.SECRET_FOUND, this.index);
        break;
      default:
        break;
    }
    ctx.events.emit(EV.PICKUP, this.kind, this.x, this.y);
    ctx.sfx(this.kind === 'coin' ? 'coin' : this.kind === 'souvenir' || this.kind === 'star' ? 'secret' : 'powerup');
    ctx.effect(this.kind === 'coin' ? 'coin_burst' : 'spark', this.x, this.y);
    ctx.scene.tweens.add({
      targets: this,
      y: this.y - 14,
      alpha: 0,
      duration: 220,
      onComplete: () => this.destroy(),
    });
  }
}
