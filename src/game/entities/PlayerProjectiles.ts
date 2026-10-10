import Phaser from 'phaser';
import { DEPTH, PHYSICS } from '../config';
import type { LevelContext, PlayerProjectile } from '../world/LevelContext';
import { animKey } from '../systems/AnimationSystem';

const FALLBACK_TEX = 'player-energy-ball';

/** Generated fallback texture (glowing green orb) used until the effects atlas has `energy_shot`. */
function ensureFallbackTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(FALLBACK_TEX)) return;
  const g = scene.make.graphics({}, false);
  g.fillStyle(0x3aa04a, 0.35).fillCircle(6, 6, 6);
  g.fillStyle(0x7cff8a, 1).fillCircle(6, 6, 4);
  g.fillStyle(0xffffff, 1).fillCircle(6, 6, 2);
  g.generateTexture(FALLBACK_TEX, 12, 12);
  g.destroy();
}

/**
 * Parker's Energy Blast: travels straight ahead, fizzles after `PHYSICS.projectileRange`
 * px, is destroyed by walls (CombatSystem) and on hitting an enemy.
 */
export class EnergyBall extends Phaser.Physics.Arcade.Sprite implements PlayerProjectile {
  declare body: Phaser.Physics.Arcade.Body;
  damage = 1;
  private readonly startX: number;
  private fizzling = false;

  constructor(
    private readonly ctx: LevelContext,
    x: number,
    y: number,
    readonly dir: 1 | -1,
    speed = PHYSICS.projectileSpeed,
  ) {
    const scene = ctx.scene;
    const hasAnim = scene.anims.exists(animKey('effects', 'energy_shot'));
    if (!hasAnim) ensureFallbackTexture(scene);
    super(scene, x, y, hasAnim ? 'effects' : FALLBACK_TEX);
    this.startX = x;
    scene.add.existing(this);
    ctx.groups.playerProjectiles.add(this);
    scene.physics.add.existing(this);
    this.setDepth(DEPTH.projectiles);
    this.setFlipX(dir < 0);
    if (hasAnim) this.play({ key: animKey('effects', 'energy_shot'), repeat: -1 });
    else scene.tweens.add({ targets: this, scale: { from: 0.85, to: 1.15 }, duration: 90, yoyo: true, repeat: -1 });
    const b = this.body;
    b.setAllowGravity(false);
    b.setCircle(4, this.width / 2 - 4, this.height / 2 - 4);
    b.setVelocity(dir * speed, 0);
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (this.fizzling || !this.body) return;
    if (Math.abs(this.x - this.startX) >= PHYSICS.projectileRange) this.fizzle();
  }

  /** Called by CombatSystem after damaging an enemy. */
  onHitEnemy(): void {
    this.ctx.effect('spark', this.x, this.y);
    this.destroy();
  }

  /** Out of range: shrink and fade away. */
  fizzle(): void {
    if (this.fizzling) return;
    this.fizzling = true;
    this.body.enable = false;
    this.ctx.effect('poof', this.x, this.y, { scale: 0.5 });
    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.add({ targets: this, alpha: 0, scale: 0.3, duration: 140, onComplete: () => this.destroy() });
  }

  get live(): boolean {
    return this.active && !this.fizzling;
  }
}

/** Number of Parker shots currently alive (for the max-on-screen rule). */
export function liveEnergyBalls(ctx: LevelContext): number {
  return ctx.groups.playerProjectiles.getChildren().filter((c) => c instanceof EnergyBall && c.live).length;
}
