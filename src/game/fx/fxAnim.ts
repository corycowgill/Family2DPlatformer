import Phaser from 'phaser';
import { hash01 } from './fxMath';
import { reduceFlashing, SOFT_HIT_TINT } from '../systems/Accessibility';

/**
 * Start a looping animation at a position-derived phase so rows of identical sprites
 * (coins) don't animate in lockstep. Deterministic (no Math.random).
 */
export function desyncAnim(sprite: Phaser.GameObjects.Sprite): void {
  const anims = sprite.anims;
  if (!anims || !anims.isPlaying || !anims.currentAnim) return;
  anims.setProgress(hash01(sprite.x, sprite.y));
}

/** Solid white flash for `ms`, then back to the normal colours (defeated enemies). */
export function flashWhite(sprite: Phaser.GameObjects.Sprite, ms: number): void {
  if (reduceFlashing()) sprite.setTint(SOFT_HIT_TINT);
  else sprite.setTintFill(0xffffff);
  sprite.scene.time.delayedCall(ms, () => {
    if (sprite.active) sprite.clearTint();
  });
}
