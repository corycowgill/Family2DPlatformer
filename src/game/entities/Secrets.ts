import Phaser from 'phaser';
import { DEPTH } from '../config';
import { EV } from '../types';
import { LAYERS } from '../data/tiles';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { onLevelEvent, playerRect } from '../world/worldUtil';

/** Event Lupin's sniff ability emits on the level emitter: (x, y, radius). */
export const SNIFF_EVENT = EV.SNIFF;

/**
 * secret <tx> <ty> width=<tiles> height=<tiles>
 *
 * Marks a hidden area. Foreground-layer tiles inside the rectangle (fake walls,
 * building facades) fade out while the player is inside, revealing the room behind.
 * Lupin's sniff within range makes the secret sparkle.
 */
export class Secret extends Phaser.GameObjects.Zone {
  private readonly rect: Phaser.Geom.Rectangle;
  private readonly tiles: Phaser.Tilemaps.Tile[] = [];
  private inside = false;
  private discovered = false;
  private hintUntil = 0;

  constructor(
    readonly ctx: LevelContext,
    o: SpawnObject,
  ) {
    super(ctx.scene, o.x, o.y, o.width, o.height);
    ctx.scene.add.existing(this);
    this.rect = new Phaser.Geom.Rectangle(o.x - o.width / 2, o.y - o.height, o.width, o.height);
    const fg = ctx.map.getLayer(LAYERS.foreground)?.tilemapLayer;
    if (fg) {
      for (const t of fg.getTilesWithinWorldXY(this.rect.x, this.rect.y, this.rect.width - 1, this.rect.height - 1)) {
        if (t && t.index > 0) this.tiles.push(t);
      }
    }
    onLevelEvent(ctx, this, SNIFF_EVENT, ((x: number, y: number, radius?: number) => this.onSniff(x, y, radius ?? 160)) as (...a: never[]) => void);
  }

  /** Distance from a point to the secret's rectangle (0 if inside). */
  distanceTo(x: number, y: number): number {
    const dx = Math.max(this.rect.left - x, 0, x - this.rect.right);
    const dy = Math.max(this.rect.top - y, 0, y - this.rect.bottom);
    return Math.hypot(dx, dy);
  }

  private onSniff(x: number, y: number, radius: number): void {
    if (this.distanceTo(x, y) > radius) return;
    const now = this.ctx.now();
    if (now < this.hintUntil) return;
    this.hintUntil = now + 1500;
    const cx = this.rect.centerX;
    const cy = this.rect.centerY;
    for (let i = 0; i < 6; i++) {
      this.scene.time.delayedCall(i * 180, () => {
        if (!this.active) return;
        const px = cx + Phaser.Math.Between(-this.rect.width / 2 + 4, this.rect.width / 2 - 4);
        const py = cy + Phaser.Math.Between(-this.rect.height / 2 + 4, this.rect.height / 2 - 4);
        this.ctx.effect('spark', px, py, { depth: DEPTH.foreground + 2 });
        const star = this.scene.add.star(px, py, 4, 1.5, 4, 0xfff3a0).setDepth(DEPTH.foreground + 2);
        this.scene.tweens.add({ targets: star, y: py - 10, alpha: 0, angle: 90, duration: 700, onComplete: () => star.destroy() });
      });
    }
    this.ctx.sfx('sniff-hint');
  }

  preUpdate(): void {
    const inside = this.ctx.players.some(
      (p) => p.isAlive() && Phaser.Geom.Rectangle.Overlaps(this.rect, playerRect(p)) && this.rect.contains(p.body.center.x, p.body.center.y),
    );
    if (inside === this.inside) return;
    this.inside = inside;
    if (inside && !this.discovered) {
      this.discovered = true;
      this.ctx.sfx('secret');
    }
    this.scene.tweens.killTweensOf(this.tiles);
    if (this.tiles.length) this.scene.tweens.add({ targets: this.tiles, alpha: inside ? 0.15 : 1, duration: 250 });
  }
}

/**
 * cameraZone <tx> <ty> width=.. height=.. — while the player is inside, the camera is
 * clamped to this rectangle (e.g. a vertical shaft or a closed room).
 */
export class CameraZone extends Phaser.GameObjects.Zone {
  private readonly rect: Phaser.Geom.Rectangle;
  private inside = false;
  constructor(
    readonly ctx: LevelContext,
    o: SpawnObject,
  ) {
    super(ctx.scene, o.x, o.y, o.width, o.height);
    ctx.scene.add.existing(this);
    this.rect = new Phaser.Geom.Rectangle(o.x - o.width / 2, o.y - o.height, o.width, o.height);
  }
  preUpdate(): void {
    // Co-op: clamp only while every living player is inside (the camera frames them all).
    const ps = this.ctx.players.length > 1 ? this.ctx.players.filter((p) => p.isAlive()) : this.ctx.players;
    const inside = ps.length > 0 && ps.every((p) => this.rect.contains(p.x, p.y - 4));
    if (inside === this.inside) return;
    this.inside = inside;
    this.ctx.lockCamera(inside ? this.rect : null);
  }
}
