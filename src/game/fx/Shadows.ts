import Phaser from 'phaser';
import { DEPTH, TILE_SIZE } from '../config';
import type { LevelContext } from '../world/LevelContext';
import { Block } from '../entities/Blocks';
import { FX_SOFT } from './FxTextures';
import { shadowLook, surfaceBelow } from './fxMath';

type Body = Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody;
type Caster = Phaser.GameObjects.Sprite & { body: Body | null };

const SHADOW_W = 32; // texture width
const SHADOW_H = 10;

/**
 * Soft blob drop shadows projected onto the first standable surface (ground/one-way
 * tiles, moving platforms, blocks) below the player, enemies and pickups. Fixed pool,
 * no per-frame allocation; only on-screen casters are processed.
 */
export class Shadows {
  private readonly pool: Phaser.GameObjects.Image[] = [];
  private used = 0;
  private readonly blocks: Block[] = [];
  private readonly groundData: Phaser.Tilemaps.Tile[][];
  private readonly onewayData: Phaser.Tilemaps.Tile[][] | null;
  private readonly rows: number;
  private readonly cols: number;
  private readonly solidAt = (tx: number, ty: number): boolean => {
    if (tx < 0 || tx >= this.cols) return false;
    const g = this.groundData[ty]?.[tx];
    if (g && g.index > 0) return true;
    const o = this.onewayData?.[ty]?.[tx];
    return !!(o && o.index > 0);
  };

  constructor(
    private readonly ctx: LevelContext,
    size: number,
    private readonly pickupShadows: boolean,
  ) {
    const scene = ctx.scene;
    for (let i = 0; i < size; i++) {
      this.pool.push(scene.add.image(0, 0, FX_SOFT, 'shadow').setDepth(DEPTH.ground + 1).setVisible(false));
    }
    this.groundData = ctx.ground.layer.data;
    this.onewayData = ctx.oneway?.layer.data ?? null;
    this.rows = ctx.map.height;
    this.cols = ctx.map.width;
    for (const o of scene.children.list) if (o instanceof Block) this.blocks.push(o);
  }

  update(): void {
    this.used = 0;
    const cam = this.ctx.scene.cameras.main;
    const view = cam.worldView;
    const left = view.x - 24;
    const right = view.right + 24;
    for (const p of this.ctx.players) if (p.isAlive() && p.visible) this.cast(p as unknown as Caster, 110, 0.55, 1);
    for (const e of this.ctx.groups.enemies.getChildren() as Caster[]) {
      if (!e.active || !e.visible || e.x < left || e.x > right) continue;
      this.cast(e, 140, 0.5, 1);
    }
    if (this.pickupShadows) {
      for (const c of this.ctx.groups.pickups.getChildren() as (Caster & { kind?: string })[]) {
        if (!c.active || !c.visible || c.x < left || c.x > right) continue;
        if (c.kind === 'coin') this.cast(c, 36, 0.3, 0.6);
        else this.cast(c, 64, 0.4, 0.8);
      }
    }
    for (let i = this.used; i < this.pool.length; i++) {
      const s = this.pool[i];
      if (!s.visible) break; // the rest were already hidden last frame
      s.setVisible(false);
    }
  }

  private cast(c: Caster, maxH: number, baseAlpha: number, widthMult: number): void {
    if (this.used >= this.pool.length) return;
    const b = c.body;
    if (!b) return;
    // Bodies may be disabled (dead enemies fading out, collected pickups): use the sprite.
    const x = b.enable ? b.center.x : c.x;
    const feet = b.enable ? b.bottom : c.y;
    const width = Math.max(8, (b.enable ? b.width : c.displayWidth * 0.6) * widthMult + 4);
    let surf = surfaceBelow(x, feet, maxH, TILE_SIZE, this.rows, this.solidAt);
    if ('blocked' in b && b.blocked.down && (surf === null || surf - feet > 3)) surf = feet;
    // Moving platforms and blocks.
    for (const pl of this.ctx.groups.platforms.getChildren() as Caster[]) {
      const pb = pl.body;
      if (!pb || !pb.enable || x < pb.left || x > pb.right) continue;
      if (pb.top >= feet - 3 && (surf === null || pb.top < surf)) surf = pb.top;
    }
    for (const bl of this.blocks) {
      if (!bl.active || x < bl.x - 8 || x > bl.x + 8) continue;
      const top = bl.body.top;
      if (top >= feet - 3 && (surf === null || top < surf)) surf = top;
    }
    if (surf === null) return;
    const look = shadowLook(surf - feet, maxH, baseAlpha * c.alpha);
    if (!look.visible) return;
    const s = this.pool[this.used++];
    const w = width * look.scale;
    // Sits on the top face of the surface (the light curb/ledge strip), where it reads best side-on.
    s.setPosition(x, surf + 2).setScale(w / SHADOW_W, (Math.min(7, 4 + w * 0.1) * (0.6 + 0.4 * look.scale)) / SHADOW_H);
    s.setAlpha(look.alpha).setVisible(true);
  }

  setVisible(on: boolean): void {
    if (!on) for (const s of this.pool) s.setVisible(false);
  }
}
