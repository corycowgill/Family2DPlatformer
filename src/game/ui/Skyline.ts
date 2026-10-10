import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { IMAGES } from '../data/assets';
import { mulberry32 } from '../systems/audio/notes';
import { audio } from '../systems/AudioSystem';
import { hasRealFrame, isRealAsset } from './Icons';
import { reducedMotion } from './Transitions';

/**
 * Animated Chicago skyline used behind the title, credits and settings screens.
 * Uses the art team's `bg-day-*` layers when shipped; otherwise draws a dusk skyline with
 * Willis Tower, the Hancock, Aon Center and Marina City, an elevated track and a CTA train.
 */

const W = GAME_WIDTH;
const H = GAME_HEIGHT;
export const EL_DECK_Y = 226;

function canvasTex(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
  if (scene.textures.exists(key)) return;
  const t = scene.textures.createCanvas(key, w, h);
  if (!t) return;
  draw(t.getContext());
  t.refresh();
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function drawSky(ctx: CanvasRenderingContext2D): void {
  const stops = ['#0b1730', '#16224a', '#2a2d66', '#4b3577', '#7a3f7c', '#b4517a', '#e27772', '#f6a46a', '#ffd08a'];
  const top = 0;
  const bottom = 215;
  const rgb = stops.map((c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const t = Math.min(1, Math.max(0, (y - top) / (bottom - top))) * (stops.length - 1);
    for (let x = 0; x < W; x++) {
      const d = BAYER[(y % 4) * 4 + (x % 4)] / 16;
      const c = rgb[Math.min(stops.length - 1, Math.floor(t + d * 0.999))];
      const o = (y * W + x) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const rnd = mulberry32(7);
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(rnd() * W);
    const y = Math.floor(rnd() * 90);
    ctx.fillStyle = rnd() < 0.2 ? '#ffffff' : '#8fa6d8';
    ctx.fillRect(x, y, 1, 1);
  }
  // Setting sun with banded bottom (pixel-art style).
  const cx = 360;
  const cy = 196;
  for (let y = -30; y <= 30; y++) {
    const half = Math.floor(Math.sqrt(Math.max(0, 30 * 30 - y * y)));
    if (y > 4 && (y % 6 === 0 || y % 6 === 1)) continue;
    ctx.fillStyle = y < -10 ? '#fff1b0' : y < 8 ? '#ffd27a' : '#ffb35c';
    ctx.fillRect(cx - half, cy + y, half * 2, 1);
  }
}

interface Bldg { x: number; w: number; h: number; kind?: 'willis' | 'hancock' | 'aon' | 'marina' | 'spire' }

function drawBuilding(ctx: CanvasRenderingContext2D, b: Bldg, base: number, body: string, edge: string, rnd: () => number, lit: number): void {
  const draw = (ox: number) => {
    const x = b.x + ox;
    const top = base - b.h;
    ctx.fillStyle = body;
    switch (b.kind) {
      case 'willis': {
        // stepped bundled tubes + twin antennas
        ctx.fillRect(x, top + 40, b.w, b.h - 40);
        ctx.fillRect(x + 4, top + 18, b.w - 8, 30);
        ctx.fillRect(x + 8, top, b.w - 14, 24);
        ctx.fillRect(x + 10, top - 22, 1, 22);
        ctx.fillRect(x + b.w - 9, top - 18, 1, 18);
        break;
      }
      case 'hancock': {
        for (let y = 0; y < b.h; y++) {
          const inset = Math.floor((1 - y / b.h) * 5);
          ctx.fillRect(x + inset, top + y, b.w - inset * 2, 1);
        }
        ctx.fillRect(x + 7, top - 20, 1, 20);
        ctx.fillRect(x + b.w - 8, top - 20, 1, 20);
        // X-bracing hint
        ctx.fillStyle = edge;
        for (let y = 10; y < b.h - 10; y += 22) {
          for (let k = 0; k < 11; k++) {
            ctx.fillRect(x + 6 + k, top + y + k, 1, 1);
            ctx.fillRect(x + b.w - 7 - k, top + y + k, 1, 1);
          }
        }
        ctx.fillStyle = body;
        break;
      }
      case 'marina': {
        for (const dx of [0, 13]) {
          ctx.fillRect(x + dx + 1, top, 8, b.h);
          for (let y = top + 2; y < base - 10; y += 3) {
            ctx.fillRect(x + dx, y, 10, 2);
          }
          ctx.fillStyle = edge;
          for (let y = top + 3; y < base - 10; y += 3) ctx.fillRect(x + dx + 1, y, 8, 1);
          ctx.fillStyle = body;
        }
        break;
      }
      case 'spire': {
        ctx.fillRect(x, top + 10, b.w, b.h - 10);
        ctx.fillRect(x + 3, top + 4, b.w - 6, 8);
        ctx.fillRect(x + Math.floor(b.w / 2), top - 10, 1, 14);
        break;
      }
      default:
        ctx.fillRect(x, top, b.w, b.h);
        if (b.w > 14) ctx.fillRect(x + 3, top - 4, b.w - 6, 4);
    }
    // Lit windows
    ctx.fillStyle = edge;
    ctx.fillRect(x, top, 1, b.h);
    for (let wy = top + 4; wy < base - 3; wy += 4) {
      for (let wx = x + 2; wx < x + b.w - 2; wx += 3) {
        if (rnd() < lit) {
          ctx.fillStyle = rnd() < 0.7 ? '#ffd98a' : '#cfe8ff';
          ctx.fillRect(wx, wy, 1, 2);
        }
      }
    }
  };
  draw(0);
  if (b.x + b.w > W) draw(-W);
  if (b.x < 0) draw(W);
}

function drawLayer(ctx: CanvasRenderingContext2D, seed: number, base: number, body: string, edge: string, minH: number, maxH: number, lit: number, landmarks: Bldg[]): void {
  const rnd = mulberry32(seed);
  const list: Bldg[] = [];
  let x = 0;
  while (x < W) {
    const w = 12 + Math.floor(rnd() * 22);
    list.push({ x, w, h: minH + Math.floor(rnd() * (maxH - minH)), kind: rnd() < 0.08 ? 'spire' : undefined });
    x += w + Math.floor(rnd() * 3) - 1;
  }
  for (const b of [...list, ...landmarks]) drawBuilding(ctx, b, base, body, edge, rnd, lit);
  ctx.fillStyle = body;
  ctx.fillRect(0, base, W, H - base);
}

function drawEl(ctx: CanvasRenderingContext2D): void {
  const deck = EL_DECK_Y;
  ctx.fillStyle = '#1a1830';
  // columns + cross bracing every 40px
  for (let x = 0; x < W; x += 40) {
    ctx.fillRect(x + 4, deck + 6, 4, H - deck);
    ctx.fillRect(x + 30, deck + 6, 4, H - deck);
    for (let k = 0; k < 22; k++) {
      ctx.fillRect(x + 8 + k, deck + 8 + Math.floor(k * 0.7), 1, 1);
      ctx.fillRect(x + 29 - k, deck + 8 + Math.floor(k * 0.7), 1, 1);
    }
  }
  // deck girder with rivets
  ctx.fillStyle = '#2b2846';
  ctx.fillRect(0, deck, W, 7);
  ctx.fillStyle = '#423d66';
  ctx.fillRect(0, deck, W, 1);
  ctx.fillStyle = '#121022';
  for (let x = 2; x < W; x += 6) ctx.fillRect(x, deck + 4, 1, 1);
  // rails
  ctx.fillStyle = '#8b8fa8';
  ctx.fillRect(0, deck - 1, W, 1);
}

function drawRiver(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#0f2347';
  ctx.fillRect(0, 248, W, H - 248);
  const rnd = mulberry32(3);
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(rnd() * W);
    const y = 250 + Math.floor(rnd() * 20);
    ctx.fillStyle = rnd() < 0.5 ? '#f6a46a' : '#2f6fb0';
    ctx.fillRect(x, y, 3 + Math.floor(rnd() * 6), 1);
  }
}

/** One CTA rail car, 100x24, facing left (front car has headlights + LOOP sign). */
function drawTrainCar(ctx: CanvasRenderingContext2D, front: boolean): void {
  const w = 100;
  ctx.fillStyle = '#2a2f3d';
  ctx.fillRect(1, 0, w - 2, 22);
  ctx.fillStyle = '#c9d1db';
  ctx.fillRect(2, 1, w - 4, 19);
  ctx.fillStyle = '#e8eef5';
  ctx.fillRect(2, 1, w - 4, 2);
  ctx.fillStyle = '#8d99a8';
  ctx.fillRect(2, 16, w - 4, 4);
  // red / blue stripe
  ctx.fillStyle = '#c8313f';
  ctx.fillRect(2, 13, w - 4, 1);
  ctx.fillStyle = '#2d5fb4';
  ctx.fillRect(2, 14, w - 4, 1);
  // windows (lit)
  for (let x = 8; x < w - 8; x += 9) {
    if (x > 40 && x < 56) continue;
    ctx.fillStyle = '#28324a';
    ctx.fillRect(x, 5, 7, 6);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(x + 1, 6, 5, 4);
    ctx.fillStyle = '#fff6d6';
    ctx.fillRect(x + 1, 6, 2, 1);
  }
  // doors
  ctx.fillStyle = '#6d7686';
  ctx.fillRect(43, 3, 1, 13);
  ctx.fillRect(52, 3, 1, 13);
  ctx.fillStyle = '#28324a';
  ctx.fillRect(45, 5, 6, 7);
  if (front) {
    ctx.fillStyle = '#28324a';
    ctx.fillRect(2, 4, 4, 8);
    ctx.fillStyle = '#ff6a3d';
    ctx.fillRect(3, 2, 10, 2);
    ctx.fillStyle = '#fff6b0';
    ctx.fillRect(2, 16, 2, 2);
  }
  // bogies
  ctx.fillStyle = '#121420';
  for (const bx of [10, 76]) {
    ctx.fillRect(bx, 21, 14, 3);
    ctx.fillRect(bx + 1, 22, 3, 2);
    ctx.fillRect(bx + 10, 22, 3, 2);
  }
}

export class Skyline {
  private layers: { ts: Phaser.GameObjects.TileSprite; speed: number }[] = [];
  private train?: Phaser.GameObjects.Container;
  private trainTimer = 3000;
  private moving: boolean;

  constructor(private scene: Phaser.Scene, opts: { train?: boolean; depth?: number } = {}) {
    this.moving = !reducedMotion();
    const depth = opts.depth ?? -100;
    const realBg = ['sky', 'far', 'mid', 'near'].every((l) => isRealAsset(scene, IMAGES.bg('day', l as 'sky')));
    if (realBg) {
      (['sky', 'far', 'mid', 'near'] as const).forEach((l, i) => this.addLayer(IMAGES.bg('day', l), [0, 3, 8, 16][i], depth + i));
    } else {
      canvasTex(scene, 'menu-sky', W, H, drawSky);
      canvasTex(scene, 'menu-far', W, H, (c) =>
        drawLayer(c, 11, 214, '#3a2f63', '#4a3d78', 30, 80, 0.05, [
          { x: 130, w: 30, h: 150, kind: 'willis' },
          { x: 240, w: 20, h: 128, kind: 'aon' },
          { x: 318, w: 26, h: 138, kind: 'hancock' },
        ]),
      );
      canvasTex(scene, 'menu-mid', W, H, (c) =>
        drawLayer(c, 23, 234, '#221c42', '#2f2858', 20, 62, 0.14, [{ x: 404, w: 23, h: 76, kind: 'marina' }]),
      );
      canvasTex(scene, 'menu-river', W, H, drawRiver);
      this.addLayer('menu-sky', 0, depth);
      this.addLayer('menu-far', 3, depth + 1);
      this.addLayer('menu-mid', 8, depth + 2);
      this.addLayer('menu-river', 14, depth + 3);
    }
    canvasTex(scene, 'menu-el', W, H, drawEl);
    this.addLayer('menu-el', 22, depth + 4);
    if (opts.train !== false && this.moving) this.buildTrain(depth + 3.5);
  }

  private addLayer(key: string, speed: number, depth: number): void {
    const ts = this.scene.add.tileSprite(0, 0, W, H, key).setOrigin(0).setDepth(depth).setScrollFactor(0);
    this.layers.push({ ts, speed });
  }

  private buildTrain(depth: number): void {
    const scene = this.scene;
    const parts: Phaser.GameObjects.GameObject[] = [];
    if (hasRealFrame(scene, 'platforms', 'train_car')) {
      const f = scene.textures.getFrame('platforms', 'train_car');
      const hasFront = hasRealFrame(scene, 'platforms', 'train_front');
      for (let i = 0; i < 4; i++) {
        const frame = i === 0 && hasFront ? 'train_front' : 'train_car';
        parts.push(scene.add.image(i * (f.width + 2), 0, 'platforms', frame).setOrigin(0, 1));
      }
    } else {
      canvasTex(scene, 'menu-train-front', 100, 24, (c) => drawTrainCar(c, true));
      canvasTex(scene, 'menu-train-car', 100, 24, (c) => drawTrainCar(c, false));
      for (let i = 0; i < 4; i++) parts.push(scene.add.image(i * 102, 0, i === 0 ? 'menu-train-front' : 'menu-train-car').setOrigin(0, 1));
    }
    this.train = scene.add.container(W + 20, EL_DECK_Y - 1, parts).setDepth(depth).setVisible(false);
  }

  /** Call from scene.update. */
  update(delta: number): void {
    if (!this.moving) return;
    const s = delta / 1000;
    for (const l of this.layers) l.ts.tilePositionX += l.speed * s;
    const t = this.train;
    if (!t) return;
    if (!t.visible) {
      this.trainTimer -= delta;
      if (this.trainTimer <= 0) {
        t.setVisible(true).setX(W + 20);
        audio.sfx('train-horn', { volume: 0.35 });
      }
      return;
    }
    t.x -= 120 * s;
    if (t.x < -440) {
      t.setVisible(false);
      this.trainTimer = 9000 + Math.random() * 6000;
    }
  }
}
