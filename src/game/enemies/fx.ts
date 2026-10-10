import Phaser from 'phaser';
import { DEPTH } from '../config';
import type { LevelContext } from '../world/LevelContext';

/** Expanding/fading explosion flash drawn with graphics (works with or without effect art). */
export function boom(ctx: LevelContext, x: number, y: number, radius = 14, color = 0xffa31a, withEffect = true): void {
  const g = ctx.scene.add.graphics().setDepth(DEPTH.effects);
  g.fillStyle(color, 1).fillCircle(0, 0, radius).fillStyle(0xfff3c4, 1).fillCircle(0, 0, radius * 0.5);
  g.setPosition(x, y).setScale(0.3);
  ctx.scene.tweens.add({ targets: g, scale: 1.2, alpha: 0, duration: 380, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
  if (withEffect) ctx.effect(radius > 16 ? 'explosion_large' : 'explosion_small', x, y);
}

/** Small expanding ring (summons, telegraphs). */
export function ring(ctx: LevelContext, x: number, y: number, color = 0x7fe8ff, radius = 14): void {
  const g = ctx.scene.add.graphics().setDepth(DEPTH.effects);
  g.lineStyle(2, color, 1).strokeCircle(0, 0, radius);
  g.setPosition(x, y).setScale(0.2);
  ctx.scene.tweens.add({ targets: g, scale: 1, alpha: 0, duration: 450, onComplete: () => g.destroy() });
  ctx.effect('spawn_ring', x, y);
}

/** Ground shadow marker for falling debris; returns the graphics so the caller can remove it. */
export function shadowMarker(ctx: LevelContext, x: number, floorY: number, width: number, ms: number): Phaser.GameObjects.Graphics {
  const g = ctx.scene.add.graphics().setDepth(DEPTH.enemies - 1);
  g.setPosition(x, floorY - 1);
  const draw = (k: number) => {
    g.clear();
    g.fillStyle(0x000000, 0.25 + 0.35 * k).fillEllipse(0, 0, width * (0.5 + 0.5 * k), 6);
    g.lineStyle(1, 0xff3030, 0.5 + 0.5 * k).strokeEllipse(0, 0, width * (0.5 + 0.5 * k) + 4, 8);
  };
  draw(0);
  const t = { k: 0 };
  ctx.scene.tweens.add({ targets: t, k: 1, duration: ms, onUpdate: () => draw(t.k) });
  return g;
}
