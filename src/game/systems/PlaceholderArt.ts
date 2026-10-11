import Phaser from 'phaser';
import { EAGER_THEMES } from './ThemeAssets';
import { CHARACTER_IDS } from '../types';
import { ATLAS, CHARACTER_ANIMS, CHARACTER_FRAME_SIZE, IMAGES } from '../data/assets';
import { TILESET_COLUMNS, TILE_COUNT } from '../data/tiles';
import { TILE_SIZE } from '../config';
import { CHARACTERS } from '../characters';

/**
 * Generates simple placeholder textures for any asset in the contract that failed
 * to load (or doesn't exist yet). Keeps the game playable while art is in progress.
 */

function makeAtlas(
  scene: Phaser.Scene,
  key: string,
  frames: string[],
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, name: string, x: number, y: number, i: number) => void,
): void {
  if (scene.textures.exists(key)) return;
  const cols = Math.max(1, Math.min(16, frames.length));
  const rows = Math.ceil(frames.length / cols);
  const tex = scene.textures.createCanvas(key, cols * w, rows * h);
  if (!tex) return;
  const ctx = tex.getContext();
  frames.forEach((name, i) => {
    const x = (i % cols) * w;
    const y = Math.floor(i / cols) * h;
    ctx.save();
    draw(ctx, name, x, y, i);
    ctx.restore();
    tex.add(name, 0, x, y, w, h);
  });
  tex.refresh();
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export function ensurePlaceholderArt(scene: Phaser.Scene): void {
  // Characters
  for (const id of CHARACTER_IDS) {
    const def = CHARACTERS[id];
    const counts: Record<string, number> = {
      idle: 4, walk: 6, run: 6, jump: 2, fall: 2, land: 2, crouch: 2, attack: 4, hurt: 2, victory: 6, defeat: 4, ability: 4,
    };
    const frames: string[] = [];
    for (const a of CHARACTER_ANIMS) for (let i = 0; i < (counts[a] ?? 2); i++) frames.push(`${a}_${i}`);
    const S = CHARACTER_FRAME_SIZE;
    makeAtlas(scene, id, frames, S, S, (ctx, name, x, y, i) => {
      const crouch = name.startsWith('crouch');
      const bw = id === 'lupin' ? 22 : 14;
      const bh = id === 'lupin' ? 16 : crouch ? 20 : 32;
      const bob = name.startsWith('walk') || name.startsWith('run') ? (i % 2) : 0;
      ctx.fillStyle = hex(def.color);
      ctx.fillRect(x + S / 2 - bw / 2, y + S - bh - bob, bw, bh);
      ctx.fillStyle = '#f2c9a0';
      if (id !== 'lupin') ctx.fillRect(x + S / 2 - 5, y + S - bh - bob - 1, 10, 10);
      ctx.fillStyle = '#000';
      ctx.fillRect(x + S / 2 + 2, y + S - bh - bob + 3, 2, 2);
    });
    if (!scene.textures.exists(IMAGES.portrait(id))) {
      const g = scene.make.graphics({}, false);
      g.fillStyle(def.color).fillRect(0, 0, 24, 24).fillStyle(0xf2c9a0).fillRect(6, 4, 12, 12);
      g.generateTexture(IMAGES.portrait(id), 24, 24);
      g.destroy();
    }
  }

  // Generic enemy placeholder for every kind referenced in code — created lazily by Enemy if missing.

  // Tileset
  if (!scene.textures.exists(IMAGES.tiles)) {
    const rows = Math.ceil(TILE_COUNT / TILESET_COLUMNS);
    const tex = scene.textures.createCanvas(IMAGES.tiles, TILESET_COLUMNS * TILE_SIZE, rows * TILE_SIZE);
    if (tex) {
      const ctx = tex.getContext();
      for (let i = 0; i < TILE_COUNT; i++) {
        const x = (i % TILESET_COLUMNS) * TILE_SIZE;
        const y = Math.floor(i / TILESET_COLUMNS) * TILE_SIZE;
        const hue = (i * 47) % 360;
        ctx.fillStyle = `hsl(${hue},25%,${40 + (i % 3) * 8}%)`;
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(x, y, TILE_SIZE, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x, y + TILE_SIZE - 1, TILE_SIZE, 1);
      }
      tex.refresh();
    }
  }

  // Items / props / effects / platforms / ui
  const simple = (key: string, names: string[], w: number, h: number, color: string) =>
    makeAtlas(scene, key, names, w, h, (ctx, name, x, y) => {
      ctx.fillStyle = name.includes('coin') ? '#f5c542' : name.includes('heart_full') ? '#e33' : color;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2 - 2, 0, Math.PI * 2);
      ctx.fill();
    });
  const animFrames = (anims: readonly string[], n = 4) => anims.flatMap((a) => Array.from({ length: n }, (_, i) => `${a}_${i}`));
  simple(ATLAS.items.key, [...ATLAS.items.frames, ...animFrames(ATLAS.items.anims)], 16, 16, '#ffd25a');
  simple(ATLAS.props.key, [...ATLAS.props.frames, ...animFrames(ATLAS.props.anims)], 32, 32, '#8899aa');
  simple(ATLAS.effects.key, [...ATLAS.effects.frames, ...animFrames(ATLAS.effects.anims)], 16, 16, '#ffffff');
  simple(ATLAS.ui.key, [...ATLAS.ui.frames], 16, 16, '#cccccc');
  makeAtlas(scene, ATLAS.platforms.key, [...ATLAS.platforms.frames], 64, 16, (ctx, _n, x, y) => {
    ctx.fillStyle = '#8a3b22';
    ctx.fillRect(x, y, 64, 16);
  });

  // Parallax backgrounds
  // Only boot-time themes: lazy themes load their real art on demand (ThemeAssets.ts).
  for (const theme of EAGER_THEMES) {
    for (const layer of ['sky', 'far', 'mid', 'near'] as const) {
      const key = IMAGES.bg(theme, layer);
      if (scene.textures.exists(key)) continue;
      const g = scene.make.graphics({}, false);
      if (layer === 'sky') {
        g.fillGradientStyle(0x4a90e2, 0x4a90e2, 0xbfe3ff, 0xbfe3ff, 1).fillRect(0, 0, 480, 270);
      } else {
        const c = layer === 'far' ? 0x6f8fb8 : layer === 'mid' ? 0x4f6b8f : 0x34465e;
        g.fillStyle(c, 1);
        for (let x = 0; x < 480; x += 40) {
          const h = 60 + ((x * 37) % 90) + (layer === 'far' ? 40 : 0);
          g.fillRect(x, 270 - h, 34, h);
        }
      }
      g.generateTexture(key, 480, 270);
      g.destroy();
    }
  }
}

/** Placeholder atlas for an enemy kind (called by Enemy when its atlas is missing). */
export function ensureEnemyPlaceholder(scene: Phaser.Scene, key: string, w = 32, h = 32): void {
  const frames = ['idle', 'move', 'attack', 'hit', 'die'].flatMap((a) => [0, 1].map((i) => `${a}_${i}`));
  makeAtlas(scene, key, frames, w, h, (ctx, name, x, y, i) => {
    ctx.fillStyle = name.startsWith('hit') ? '#ffffff' : `hsl(${(key.length * 53) % 360},60%,45%)`;
    ctx.fillRect(x + 4, y + 8 + (i % 2), w - 8, h - 8);
    ctx.fillStyle = '#f33';
    ctx.fillRect(x + w - 10, y + 12, 3, 3);
  });
}
