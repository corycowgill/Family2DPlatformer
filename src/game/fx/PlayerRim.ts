import Phaser from 'phaser';
import { DEPTH } from '../config';
import type { Player } from '../entities/Player';

/** Offsets of the silhouette copies: left, right, up (no bottom copy — it would draw a light line under the feet). */
const OFFSETS: readonly [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
];

/**
 * 1-px light rim around the hero so they always pop from busy facades: three solid-colour
 * silhouettes of the current frame, offset by one pixel, drawn just behind the player.
 * Same texture as the player, so it batches with it (3 extra quads, no shader pass).
 */
export class PlayerRim {
  private readonly copies: Phaser.GameObjects.Image[] = [];
  private boost = 0;

  constructor(
    private readonly player: Player,
    private color: number,
    private alpha: number,
  ) {
    const scene = player.scene;
    for (let i = 0; i < OFFSETS.length; i++) {
      const img = scene.add.image(player.x, player.y, player.texture.key).setOrigin(0.5, 1).setDepth(DEPTH.player - 0.5);
      img.setTintFill(color);
      this.copies.push(img);
    }
  }

  /** Extra rim strength 0..1 (e.g. inside dark zones). */
  setBoost(k: number): void {
    this.boost = k;
  }

  setStyle(color: number, alpha: number): void {
    this.color = color;
    this.alpha = alpha;
    for (const c of this.copies) c.setTintFill(color);
  }

  update(): void {
    const p = this.player;
    const show = p.visible && p.active && p.alpha > 0.5 && !!p.frame && p.mode !== 'dead';
    const a = Math.min(1, this.alpha + this.boost * (1 - this.alpha) * 0.8) * p.alpha;
    // Hide while a white flash/power-up tint already outlines the hero.
    const tinted = p.isTinted && p.tintFill;
    for (let i = 0; i < this.copies.length; i++) {
      const c = this.copies[i];
      if (!show || tinted) {
        if (c.visible) c.setVisible(false);
        continue;
      }
      const [ox, oy] = OFFSETS[i];
      if (c.texture !== p.texture) c.setTexture(p.texture.key);
      c.setFrame(p.frame.name, false, false);
      c.setPosition(p.x + ox, p.y + oy);
      c.setScale(p.scaleX, p.scaleY).setFlipX(p.flipX).setAlpha(a).setVisible(true);
    }
  }

  destroy(): void {
    for (const c of this.copies) c.destroy();
    this.copies.length = 0;
    void this.color;
  }
}
