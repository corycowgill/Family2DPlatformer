import Phaser from 'phaser';

/**
 * Procedurally generated FX textures, created once per game (texture count stays flat
 * across level restarts):
 *
 * - `fx-soft` (LINEAR filtered): blob shadow, radial glow, light cone, vignette, gradients.
 *   Everything is rendered at 480×270 and then pixel-upscaled, so soft gradients still land
 *   on the pixel grid.
 * - `fx-px` (NEAREST): crisp pixel sparkles, glints, rings, speed lines.
 */
export const FX_SOFT = 'fx-soft';
export const FX_PX = 'fx-px';

type Px = (x: number, y: number) => [number, number, number, number] | null;

interface FrameSpec {
  name: string;
  w: number;
  h: number;
  draw: Px;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0: number, e1: number, v: number) => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

const W: [number, number, number] = [255, 255, 255];
const white = (a: number): [number, number, number, number] => [W[0], W[1], W[2], a];

const SOFT_FRAMES: FrameSpec[] = [
  {
    // Elliptical contact shadow: dense core, soft rim.
    name: 'shadow', w: 32, h: 10,
    draw: (x, y) => {
      const dx = (x + 0.5 - 16) / 16;
      const dy = (y + 0.5 - 5) / 5;
      const r = Math.sqrt(dx * dx + dy * dy);
      const a = 1 - smooth(0.35, 1, r);
      return [0, 0, 0, a];
    },
  },
  {
    name: 'glow', w: 32, h: 32,
    draw: (x, y) => {
      const dx = (x + 0.5 - 16) / 16;
      const dy = (y + 0.5 - 16) / 16;
      const r = Math.sqrt(dx * dx + dy * dy);
      const a = Math.pow(clamp01(1 - r), 1.8);
      return white(a);
    },
  },
  {
    // Downward light cone: narrow at the top, widening, fading toward the floor.
    name: 'cone', w: 48, h: 64,
    draw: (x, y) => {
      const t = (y + 0.5) / 64;
      const half = 3 + 21 * t;
      const d = Math.abs(x + 0.5 - 24) / half;
      const edge = 1 - smooth(0.55, 1, d);
      const fall = Math.pow(1 - t, 1.25) * 0.85 + 0.15 * (1 - t);
      return white(edge * fall);
    },
  },
  {
    // Ellipse of light on the floor.
    name: 'pool', w: 48, h: 12,
    draw: (x, y) => {
      const dx = (x + 0.5 - 24) / 24;
      const dy = (y + 0.5 - 6) / 6;
      const r = Math.sqrt(dx * dx + dy * dy);
      return white(Math.pow(clamp01(1 - r), 1.4));
    },
  },
  {
    // Horizontal 0→1 alpha ramp (soft edges of dark zones).
    name: 'hramp', w: 32, h: 4,
    draw: (x) => white(smooth(0, 1, (x + 0.5) / 32)),
  },
  { name: 'white', w: 4, h: 4, draw: () => white(1) },
];

/** Five-frame twinkle (4-point star growing then shrinking), 7×7. */
function twinkle(x: number, y: number, r: number): [number, number, number, number] | null {
  const dx = Math.abs(x - 3);
  const dy = Math.abs(y - 3);
  if (dx === 0 && dy === 0) return white(1);
  if ((dx === 0 && dy <= r) || (dy === 0 && dx <= r)) return white(dx + dy >= r ? 0.7 : 1);
  if (r >= 2 && dx === 1 && dy === 1) return white(0.45);
  return null;
}

const PX_FRAMES: FrameSpec[] = [
  { name: 'dot', w: 1, h: 1, draw: () => white(1) },
  { name: 'dot2', w: 2, h: 2, draw: () => white(1) },
  { name: 'plus', w: 3, h: 3, draw: (x, y) => (x === 1 || y === 1 ? white(x === 1 && y === 1 ? 1 : 0.8) : null) },
  ...[0, 1, 2, 3].map((r) => ({ name: `tw_${r}`, w: 7, h: 7, draw: (x: number, y: number) => twinkle(x, y, r) })),
  {
    // Speed line: bright head on the right, fading tail to the left.
    name: 'line', w: 14, h: 1,
    draw: (x) => white(Math.pow((x + 1) / 14, 1.3)),
  },
  ...[2, 4, 6, 8].map((rad, i) => ({
    name: `ring_${i}`, w: 19, h: 19,
    draw: (x: number, y: number) => {
      const d = Math.sqrt((x - 9) ** 2 + (y - 9) ** 2);
      return Math.abs(d - rad) < 0.6 ? white(1) : null;
    },
  })),
];

function buildTexture(scene: Phaser.Scene, key: string, frames: FrameSpec[], linear: boolean): void {
  if (scene.textures.exists(key)) return;
  const pad = 2;
  // Simple shelf packing.
  const width = 128;
  let x = 0;
  let y = 0;
  let shelf = 0;
  const pos: { f: FrameSpec; x: number; y: number }[] = [];
  for (const f of frames) {
    if (x + f.w + pad > width) {
      x = 0;
      y += shelf + pad;
      shelf = 0;
    }
    pos.push({ f, x: x + 1, y: y + 1 });
    x += f.w + pad;
    shelf = Math.max(shelf, f.h);
  }
  const height = Phaser.Math.Pow2.GetNext(y + shelf + pad);
  const tex = scene.textures.createCanvas(key, width, height);
  if (!tex) return;
  const c = tex.getContext();
  const img = c.createImageData(width, height);
  for (const { f, x: ox, y: oy } of pos) {
    for (let py = 0; py < f.h; py++) {
      for (let px = 0; px < f.w; px++) {
        const v = f.draw(px, py);
        if (!v) continue;
        const i = ((oy + py) * width + ox + px) * 4;
        img.data[i] = v[0];
        img.data[i + 1] = v[1];
        img.data[i + 2] = v[2];
        img.data[i + 3] = Math.round(clamp01(v[3]) * 255);
      }
    }
  }
  c.putImageData(img, 0, 0);
  for (const { f, x: ox, y: oy } of pos) tex.add(f.name, 0, ox, oy, f.w, f.h);
  tex.refresh();
  tex.setFilter(linear ? Phaser.Textures.FilterMode.LINEAR : Phaser.Textures.FilterMode.NEAREST);
}

/**
 * One full-screen MULTIPLY "mood" texture per theme (built once per game): the vertical colour
 * grade times the vignette, baked together so the whole screen treatment is a single opaque
 * 480×270 quad (1:1, NEAREST — no filtering cost). Vignette ≈ lerp(white, vignetteColor, a).
 */
export function moodTexture(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  grade: [number, number] | null,
  vignette: number,
  vignetteColor: number,
): string {
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return '__WHITE';
  const c = tex.getContext();
  const img = c.createImageData(w, h);
  const top = Phaser.Display.Color.IntegerToRGB(grade?.[0] ?? 0xffffff);
  const bot = Phaser.Display.Color.IntegerToRGB(grade?.[1] ?? 0xffffff);
  const vc = Phaser.Display.Color.IntegerToRGB(vignetteColor);
  for (let y = 0; y < h; y++) {
    const t = smooth(0.15, 1, y / (h - 1));
    const gr = top.r + (bot.r - top.r) * t;
    const gg = top.g + (bot.g - top.g) * t;
    const gb = top.b + (bot.b - top.b) * t;
    const dy = (y + 0.5 - h / 2) / (h / 2);
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - w / 2) / (w / 2);
      const r = Math.sqrt(dx * dx * 0.9 + dy * dy * 0.75);
      const a = smooth(0.55, 1.25, r) * vignette;
      const i = (y * w + x) * 4;
      img.data[i] = Math.round(gr * (1 - a + (a * vc.r) / 255));
      img.data[i + 1] = Math.round(gg * (1 - a + (a * vc.g) / 255));
      img.data[i + 2] = Math.round(gb * (1 - a + (a * vc.b) / 255));
      img.data[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  tex.refresh();
  return key;
}

export function ensureFxTextures(scene: Phaser.Scene): void {
  buildTexture(scene, FX_SOFT, SOFT_FRAMES, true);
  buildTexture(scene, FX_PX, PX_FRAMES, false);
}
