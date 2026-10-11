import { DEPTH } from '../config';
import { LAYERS } from '../data/tiles';
import type { LevelTheme } from '../types';
import type { LevelContext, SpawnObject } from './LevelContext';
import { num, str } from './worldUtil';

/** Default tint of the decor (background) tile layer per theme, so facades read as "behind". */
export const BG_TINT: Partial<Record<LevelTheme, number>> = {
  day: 0x7a86a8,
  rooftop: 0x747b9e,
  river: 0x7888a4,
  sunset: 0x9a7480,
};

const hex = (v: string, def: number): number => {
  const n = parseInt(v.replace(/^(0x|#)/, ''), 16);
  return Number.isFinite(n) ? n : def;
};

/**
 * levelStyle 0 0 [bgTint=8c93b6] — per-level look tweaks: tints the background tile
 * layer (decor buildings/girders) so it never reads as solid ground.
 */
export function applyLevelStyle(ctx: LevelContext, o: SpawnObject): void {
  const bg = ctx.map.getLayer(LAYERS.background)?.tilemapLayer;
  const def = BG_TINT[ctx.level.theme] ?? 0xa0a0b0;
  const tint = hex(str(o, 'bgTint', ''), def);
  bg?.setTint(tint);
}

/**
 * darkZone <tx> <ty> width=.. height=.. alpha=0.35 — a shaded area (Lower Wacker): darkens
 * the decor layer and props behind the solid tiles (blocks, pickups, enemies and the player stay bright).
 */
export function spawnDarkZone(ctx: LevelContext, o: SpawnObject): void {
  const alpha = num(o, 'alpha', 0.35);
  ctx.scene.add
    .rectangle(o.x - o.width / 2, o.y - o.height, o.width, o.height, 0x05070f, alpha)
    .setOrigin(0, 0)
    .setDepth(DEPTH.platforms - 1);
}
