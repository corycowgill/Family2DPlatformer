import Phaser from 'phaser';
import { TILE_SIZE } from '../config';
import { TILESET_COLUMNS, TILESET_KEY } from '../data/tiles';
import type { Player } from '../entities/Player';
import type { LevelContext, SpawnObject } from './LevelContext';

/** Small helpers shared by the world entities (platforms, blocks, hazards, props, secrets). */

export const num = (o: SpawnObject, key: string, def: number): number => {
  const v = o.props[key];
  const n = typeof v === 'number' ? v : Number(v);
  return v === undefined || v === '' || Number.isNaN(n) ? def : n;
};
export const str = (o: SpawnObject, key: string, def: string): string => {
  const v = o.props[key];
  return v === undefined || v === '' ? def : String(v);
};
export const bool = (o: SpawnObject, key: string, def: boolean): boolean => {
  const v = o.props[key];
  if (v === undefined) return def;
  return v === true || v === 'true' || v === 1;
};

export function hasFrame(scene: Phaser.Scene, atlas: string, frame: string): boolean {
  return scene.textures.exists(atlas) && scene.textures.get(atlas).has(frame);
}

/** Returns a frame name `t<index>` on the tileset texture (adds it on first use). */
export function tileFrame(scene: Phaser.Scene, index: number): string {
  const tex = scene.textures.get(TILESET_KEY);
  const name = `t${index}`;
  if (!tex.has(name)) {
    tex.add(name, 0, (index % TILESET_COLUMNS) * TILE_SIZE, Math.floor(index / TILESET_COLUMNS) * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  }
  return name;
}

/** Generates a texture once from a draw callback (used for tiny effect particles / signs). */
export function ensureTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void): string {
  if (!scene.textures.exists(key)) {
    const g = scene.make.graphics({}, false);
    draw(g);
    g.generateTexture(key, w, h);
    g.destroy();
  }
  return key;
}

/** Is the player standing on top of `body` (feet at its top edge, horizontally overlapping)? */
export function isStandingOn(player: Player, r: { top: number; left: number; right: number }, slack = 3): boolean {
  if (!player.isAlive() || !player.body?.enable) return false;
  const pb = player.body;
  return pb.velocity.y >= -1 && Math.abs(pb.bottom - r.top) <= slack && pb.right > r.left + 1 && pb.left < r.right - 1;
}

export function playerRect(player: Player): Phaser.Geom.Rectangle {
  const b = player.body;
  return new Phaser.Geom.Rectangle(b.left, b.top, b.width, b.height);
}

/** Calls `fn` on every scene POST_UPDATE (after physics positioned bodies) until `owner` is destroyed. */
export function onPostUpdate(ctx: LevelContext, owner: Phaser.GameObjects.GameObject, fn: (time: number, delta: number) => void): void {
  const ev = ctx.scene.events;
  ev.on(Phaser.Scenes.Events.POST_UPDATE, fn);
  const off = () => ev.off(Phaser.Scenes.Events.POST_UPDATE, fn);
  owner.once(Phaser.GameObjects.Events.DESTROY, off);
  ev.once(Phaser.Scenes.Events.SHUTDOWN, off);
}

/** Subscribe to a level event for the lifetime of `owner` (scene.events outlive scene restarts). */
export function onLevelEvent(ctx: LevelContext, owner: Phaser.GameObjects.GameObject, event: string, fn: (...args: never[]) => void): void {
  const ev = ctx.events;
  ev.on(event, fn);
  const off = () => ev.off(event, fn);
  owner.once(Phaser.GameObjects.Events.DESTROY, off);
  ctx.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
}

/** Burst of small particles (debris, paper) using tweens — no particle manager needed. */
export function burst(
  scene: Phaser.Scene,
  x: number,
  y: number,
  texture: string,
  frames: (string | undefined)[],
  count: number,
  opts: { spread?: number; up?: number; depth?: number; duration?: number; tint?: number } = {},
): void {
  const spread = opts.spread ?? 40;
  for (let i = 0; i < count; i++) {
    const frame = frames[i % frames.length];
    const s = scene.add.image(x, y, texture, frame).setDepth(opts.depth ?? 50);
    if (opts.tint !== undefined) s.setTint(opts.tint);
    const dx = (i / Math.max(1, count - 1) - 0.5) * 2 * spread + Phaser.Math.Between(-6, 6);
    const up = opts.up ?? 40;
    scene.tweens.add({
      targets: s,
      x: x + dx,
      y: { from: y, to: y - up - Phaser.Math.Between(0, 12) },
      angle: Phaser.Math.Between(-200, 200),
      duration: (opts.duration ?? 500) * 0.45,
      ease: 'Quad.easeOut',
      onComplete: () =>
        scene.tweens.add({
          targets: s,
          y: s.y + 90,
          alpha: 0,
          duration: (opts.duration ?? 500) * 0.8,
          ease: 'Quad.easeIn',
          onComplete: () => s.destroy(),
        }),
    });
  }
}
