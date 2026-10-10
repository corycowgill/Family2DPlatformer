import Phaser from 'phaser';
import { DEPTH } from '../config';
import type { PickupKind } from '../types';
import type { LevelContext } from '../world/LevelContext';
import { FX_SOFT } from './FxTextures';

export const RARE_TINT: Partial<Record<PickupKind, number>> = {
  hotdog: 0xffb060,
  pizza: 0xff7a5a,
  ctaPass: 0x7cc0ff,
  star: 0xfff27a,
  souvenir: 0xff9af0,
  oneUp: 0x8cff8a,
};

type PickupLike = Phaser.GameObjects.Sprite & { kind?: PickupKind };

/**
 * Soft additive back-glow behind on-screen power-ups and souvenirs (pulsing gently unless
 * reduced motion), so rare items read as special from across the screen. Fixed pool.
 */
export class PickupGlow {
  private readonly pool: Phaser.GameObjects.Image[] = [];
  private t = 0;

  constructor(
    private readonly ctx: LevelContext,
    size: number,
    private readonly pulse: boolean,
  ) {
    for (let i = 0; i < size; i++) {
      this.pool.push(
        ctx.scene.add.image(0, 0, FX_SOFT, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.pickups - 1).setVisible(false),
      );
    }
  }

  update(dtMs: number): void {
    this.t += dtMs;
    const view = this.ctx.scene.cameras.main.worldView;
    let used = 0;
    const k = this.pulse ? 0.5 + 0.5 * Math.sin(this.t / 260) : 0.6;
    for (const c of this.ctx.groups.pickups.getChildren() as PickupLike[]) {
      if (used >= this.pool.length) break;
      if (!c.active || !c.visible || !c.kind || c.kind === 'coin') continue;
      if (c.x < view.x - 16 || c.x > view.right + 16 || c.y < view.y - 16 || c.y > view.bottom + 32) continue;
      const g = this.pool[used++];
      // Pickup sprites are centre-anchored 16×16.
      g.setPosition(c.x, c.y).setScale(0.9 + 0.12 * k).setTint(RARE_TINT[c.kind] ?? 0xffffff);
      g.setAlpha((0.45 + 0.2 * k) * c.alpha).setVisible(true);
    }
    for (let i = used; i < this.pool.length; i++) {
      if (!this.pool[i].visible) break;
      this.pool[i].setVisible(false);
    }
  }
}
