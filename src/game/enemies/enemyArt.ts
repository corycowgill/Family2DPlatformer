import Phaser from 'phaser';
import type { EnemyKind } from '../types';
import { registerAtlasAnimations } from '../systems/AnimationSystem';

/**
 * Readable programmer-art for enemies, used only when the Art team's atlas for a kind is
 * missing. Frames follow the asset contract (`<anim>_<n>`, bottom-centre anchored, facing right).
 */

type Ctx = CanvasRenderingContext2D;
type Draw = (c: Ctx, anim: string, i: number, w: number, h: number) => void;

const R = (c: Ctx, x: number, y: number, w: number, h: number, col: string) => {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};
const eye = (c: Ctx, x: number, y: number, col = '#000') => R(c, x, y, 2, 2, col);
const hitTint = (anim: string, col: string) => (anim === 'hit' ? '#ffffff' : col);

export const ENEMY_FRAME_SIZE: Record<EnemyKind, { w: number; h: number }> = {
  pigeon: { w: 24, h: 20 },
  rat: { w: 28, h: 16 },
  raccoon: { w: 30, h: 26 },
  coneGuy: { w: 22, h: 28 },
  turnstileBot: { w: 32, h: 32 },
  securityDrone: { w: 26, h: 20 },
  windowWasher: { w: 24, h: 30 },
  gnat: { w: 14, h: 12 },
  skirmisher: { w: 24, h: 32 },
  wasp: { w: 28, h: 22 },
  warlord: { w: 44, h: 48 },
  juggernaut: { w: 52, h: 48 },
  overseer: { w: 52, h: 40 },
  eliminator: { w: 128, h: 112 },
};

const DRAW: Record<EnemyKind, Draw> = {
  pigeon: (c, a, i, w, h) => {
    const body = hitTint(a, '#8c93a6');
    const fly = a === 'attack';
    R(c, 6, h - 14, 13, 9, body);
    R(c, 15, h - 18, 6, 6, hitTint(a, '#6f7a99'));
    R(c, 21, h - 15, 3, 2, '#e3a33b');
    eye(c, 18, h - 16, '#f0d040');
    R(c, 13, h - 13, 5, 2, '#5aa37a');
    if (fly) R(c, 4, h - 20 + (i % 2) * 6, 10, 4, '#b8bfd1');
    else R(c, 6, h - 12, 9, 3, '#b8bfd1');
    if (a !== 'attack') {
      R(c, 10 + (a === 'move' ? i : 0), h - 5, 2, 5, '#e3a33b');
      R(c, 14 - (a === 'move' ? i : 0), h - 5, 2, 5, '#e3a33b');
    }
    R(c, 2, h - 12, 5, 3, body);
  },
  rat: (c, a, i, w, h) => {
    const body = hitTint(a, '#6b5a50');
    R(c, 6, h - 10, 16, 8, body);
    R(c, 20, h - 9, 6, 5, body);
    R(c, 25, h - 7, 2, 2, '#f29b9b');
    R(c, 19, h - 12, 3, 3, '#c88');
    eye(c, 22, h - 8);
    R(c, 0, h - 6, 7, 2, '#c99');
    R(c, 8 + (a === 'move' ? i * 2 : 0), h - 2, 3, 2, '#3d322c');
    R(c, 16 - (a === 'move' ? i * 2 : 0), h - 2, 3, 2, '#3d322c');
  },
  raccoon: (c, a, i, w, h) => {
    const body = hitTint(a, '#7d7f86');
    R(c, 6, h - 18, 16, 14, body);
    R(c, 16, h - 24, 11, 9, body);
    R(c, 17, h - 21, 10, 3, '#222');
    eye(c, 23, h - 21, '#fff');
    R(c, 17, h - 26, 3, 3, body);
    R(c, 24, h - 26, 3, 3, body);
    R(c, 0, h - 16, 7, 4, '#444');
    R(c, 2, h - 16, 2, 4, '#aaa');
    R(c, 8 + (a === 'move' ? i * 2 : 0), h - 4, 4, 4, '#3b3b40');
    R(c, 16 - (a === 'move' ? i * 2 : 0), h - 4, 4, 4, '#3b3b40');
    if (a === 'attack') R(c, 26, h - 14, 4, 3, '#ddd');
  },
  coneGuy: (c, a, i, w, h) => {
    const col = hitTint(a, '#f07a1a');
    if (a === 'shell' || a === 'die') {
      // tucked-in cone lying low
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(3, h);
      c.lineTo(w - 3, h);
      c.lineTo(w / 2 + (i % 2), h - 14);
      c.closePath();
      c.fill();
      R(c, 6, h - 7, w - 12, 3, '#fff');
      R(c, 2, h - 2, w - 4, 2, '#333');
      return;
    }
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(4, h - 4);
    c.lineTo(w - 4, h - 4);
    c.lineTo(w / 2, h - 27);
    c.closePath();
    c.fill();
    R(c, 7, h - 14, w - 14, 3, '#fff');
    R(c, 2, h - 5, w - 4, 2, '#333');
    eye(c, w / 2 + 1, h - 19);
    eye(c, w / 2 + 4, h - 19);
    R(c, 6 + (a === 'move' ? i * 2 : 0), h - 3, 3, 3, '#333');
    R(c, w - 9 - (a === 'move' ? i * 2 : 0), h - 3, 3, 3, '#333');
  },
  turnstileBot: (c, a, i, w, h) => {
    const col = hitTint(a, '#9aa3ad');
    R(c, 8, h - 26, 16, 22, col);
    R(c, 10, h - 24, 12, 5, '#2b5ea8');
    eye(c, 17, h - 22, a === 'attack' ? '#f33' : '#7ff');
    R(c, 9, h - 4, 4, 4, '#333');
    R(c, 19, h - 4, 4, 4, '#333');
    // arms
    const spin = a === 'attack';
    const ang = spin ? (i * Math.PI) / 3 : 0;
    c.strokeStyle = spin ? '#ffd23a' : '#c9d0d8';
    c.lineWidth = 3;
    for (let k = 0; k < 3; k++) {
      const t = ang + (k * Math.PI * 2) / 3;
      c.beginPath();
      c.moveTo(16, h - 14);
      c.lineTo(16 + Math.cos(t) * 15, h - 14 + Math.sin(t) * 12);
      c.stroke();
    }
  },
  securityDrone: (c, a, i, w, h) => {
    const col = hitTint(a, '#3b4250');
    R(c, 5, h - 12, 16, 8, col);
    R(c, 2, h - 18, 22, 2, '#999');
    R(c, i % 2 ? 2 : 14, h - 19, 8, 1, '#ddd');
    R(c, 11, h - 16, 4, 4, '#555');
    R(c, 15, h - 10, 5, 4, a === 'attack' ? '#ff2a2a' : '#7a1010');
    R(c, 7, h - 4, 2, 3, '#555');
    R(c, 17, h - 4, 2, 3, '#555');
  },
  windowWasher: (c, a, i, w, h) => {
    R(c, 7, h - 18, 10, 12, hitTint(a, '#2f6fb7'));
    R(c, 8, h - 26, 8, 8, '#f2c9a0');
    R(c, 7, h - 28, 10, 3, '#ffd23a');
    eye(c, 13, h - 23);
    R(c, 8, h - 6, 3, 6, '#333');
    R(c, 13, h - 6, 3, 6, '#333');
    R(c, a === 'attack' ? 16 + (i % 2) : 16, h - 16, 6, 6, '#c9c9c9');
    R(c, 3, h - 18, 18, 2, '#7a5b3a');
  },
  gnat: (c, a, i, w, h) => {
    R(c, 3, h - 8, 8, 6, hitTint(a, '#4fd16a'));
    R(c, 9, h - 7, 3, 3, '#d03fd0');
    R(c, 3, h - 11 + (i % 2) * 2, 6, 2, 'rgba(220,255,255,0.8)');
  },
  skirmisher: (c, a, i, w, h) => {
    const col = hitTint(a, '#3fae58');
    R(c, 7, h - 22, 10, 14, col);
    R(c, 8, h - 30, 9, 8, '#7be08f');
    R(c, 13, h - 28, 4, 3, '#d03fd0');
    R(c, 8 + (a === 'move' ? i * 2 : 0), h - 8, 3, 8, '#2a6b39');
    R(c, 13 - (a === 'move' ? i * 2 : 0), h - 8, 3, 8, '#2a6b39');
    if (a === 'attack') R(c, 16, h - 19, 8, 3, '#e0e0ff');
    else R(c, 15, h - 18, 5, 2, '#666');
  },
  wasp: (c, a, i, w, h) => {
    const col = hitTint(a, '#2c2f3a');
    R(c, 4, h - 14, 18, 8, col);
    R(c, 8, h - 14, 3, 8, '#e8c02e');
    R(c, 14, h - 14, 3, 8, '#e8c02e');
    R(c, 20, h - 12, 6, 4, a === 'attack' ? '#ff4040' : '#9a2020');
    R(c, 6, h - 20 + (i % 2) * 2, 12, 3, 'rgba(200,240,255,0.8)');
    R(c, 2, h - 6, 2, 4, '#777');
  },
  warlord: (c, a, i, w, h) => {
    const col = hitTint(a, '#5b2a7a');
    R(c, 12, h - 36, 20, 26, col);
    R(c, 14, h - 46, 16, 11, '#7be08f');
    R(c, 24, h - 43, 5, 3, '#ff3030');
    R(c, 12, h - 48, 20, 3, '#d4af37');
    R(c, 13 + (a === 'move' ? i * 2 : 0), h - 10, 6, 10, '#3b1a50');
    R(c, 25 - (a === 'move' ? i * 2 : 0), h - 10, 6, 10, '#3b1a50');
    if (a === 'attack') R(c, 30, h - 40 + i * 14, 14, 4, '#c0f0ff');
    else R(c, 31, h - 30, 4, 18, '#c0f0ff');
  },
  juggernaut: (c, a, i, w, h) => {
    const col = hitTint(a, '#4d5560');
    R(c, 8, h - 38, 36, 28, col);
    R(c, 16, h - 46, 20, 10, '#6b7684');
    R(c, 28, h - 43, 6, 3, '#ffb020');
    R(c, a === 'attack' ? 38 : 42, h - (a === 'attack' && i === 0 ? 46 : 30), 10, 10, '#39414a');
    R(c, 10 + (a === 'move' ? i * 2 : 0), h - 10, 10, 10, '#2c3238');
    R(c, 32 - (a === 'move' ? i * 2 : 0), h - 10, 10, 10, '#2c3238');
  },
  overseer: (c, a, i, w, h) => {
    const col = hitTint(a, '#2d3a55');
    c.fillStyle = col;
    c.beginPath();
    c.ellipse(26, h - 20, 24, 12, 0, 0, Math.PI * 2);
    c.fill();
    R(c, 14, h - 30, 24, 8, '#7be0d8');
    R(c, 22, h - 14, 8, 6, a === 'attack' ? '#ff3030' : '#8a1a1a');
    R(c, 4 + (i % 2) * 2, h - 20, 4, 3, '#ffd23a');
    R(c, 44 - (i % 2) * 2, h - 20, 4, 3, '#ffd23a');
  },
  eliminator: (c, a, i, w, h) => {
    const kneel = a === 'kneel';
    const dy = kneel ? 40 : a === 'die' ? 30 + i * 6 : 0;
    const hull = hitTint(a, '#b9c0c8');
    // girder legs
    if (!kneel) {
      R(c, 30, h - 40, 10, 40, '#8a3b22');
      R(c, 88, h - 40, 10, 40, '#8a3b22');
      for (let k = 0; k < 4; k++) {
        R(c, 30, h - 38 + k * 10, 10, 2, '#5a2614');
        R(c, 88, h - 38 + k * 10, 10, 2, '#5a2614');
      }
    } else {
      R(c, 22, h - 10, 84, 10, '#8a3b22');
    }
    // train-car torso
    R(c, 14, h - 100 + dy, 100, 62, hull);
    R(c, 14, h - 62 + dy, 100, 6, '#c8102e'); // CTA red stripe
    R(c, 14, h - 56 + dy, 100, 3, '#00a1de'); // CTA blue stripe
    // windshield / face
    R(c, 60, h - 94 + dy, 46, 22, '#1d2733');
    R(c, 66, h - 88 + dy, 10, 5, a === 'attack' ? '#ff2020' : '#ff8a00');
    R(c, 88, h - 88 + dy, 10, 5, a === 'attack' ? '#ff2020' : '#ff8a00');
    R(c, 70, h - 78 + dy, 28, 3, '#9aa3ad');
    // route sign
    R(c, 20, h - 96 + dy, 34, 10, '#111');
    R(c, 23, h - 93 + dy, 28, 4, '#f5a623');
    // rivets
    for (let k = 0; k < 6; k++) R(c, 20 + k * 16, h - 44 + dy, 2, 2, '#666');
    // shoulder & arm stub
    R(c, 0, h - 86 + dy, 16, 14, '#6b7684');
    if (a === 'hit') R(c, 14, h - 100 + dy, 100, 62, 'rgba(255,255,255,0.6)');
    void w;
  },
};

/** Ensure a texture for `kind` exists (art atlas, else generated programmer-art). */
export function ensureEnemyArt(scene: Phaser.Scene, kind: EnemyKind): void {
  if (scene.textures.exists(kind)) return;
  const { w, h } = ENEMY_FRAME_SIZE[kind];
  const anims = ['idle', 'move', 'attack', 'hit', 'die'];
  if (kind === 'coneGuy') anims.push('shell');
  if (kind === 'eliminator') anims.push('kneel');
  const frames = anims.flatMap((a) => [0, 1].map((i) => ({ a, i, name: `${a}_${i}` })));
  const cols = Math.min(8, frames.length);
  const rows = Math.ceil(frames.length / cols);
  const tex = scene.textures.createCanvas(kind, cols * w, rows * h);
  if (!tex) return;
  const ctx = tex.getContext();
  frames.forEach((f, n) => {
    const x = (n % cols) * w;
    const y = Math.floor(n / cols) * h;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    DRAW[kind](ctx, f.a, f.i, w, h);
    ctx.restore();
    tex.add(f.name, 0, x, y, w, h);
  });
  tex.refresh();
  registerAtlasAnimations(scene, kind);
}

/** Small generated textures for projectiles/props (cached by key). */
export function ensureSimpleTexture(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  draw: (g: Phaser.GameObjects.Graphics) => void,
): string {
  if (!scene.textures.exists(key)) {
    const g = scene.make.graphics({}, false);
    draw(g);
    g.generateTexture(key, w, h);
    g.destroy();
  }
  return key;
}

/** True when the Art team's real `effects` atlas was loaded (vs generated placeholders). */
export function hasRealAtlas(scene: Phaser.Scene, key: string): boolean {
  const m = scene.cache.json.get('manifest') as { atlases?: { key: string }[] } | undefined;
  return !!m?.atlases?.some((a) => a.key === key);
}
