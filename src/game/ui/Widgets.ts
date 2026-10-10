import Phaser from 'phaser';
import { px } from './PixelFont';
import { audio } from '../systems/AudioSystem';

export const COLORS = {
  ink: 0x0b1730,
  panel: 0x13254a,
  panelHi: 0x1d3566,
  border: 0x5b7bb5,
  text: 0xffffff,
  sub: 0xcfe3ff,
  gold: 0xffd25a,
  red: 0xe8414e,
  green: 0x4cd07a,
  dim: 0x5b6b88,
  skyBlue: 0xb3ddf2,
} as const;

/** Draw a pixel-style rounded panel (corners notched) into `g`. */
export function drawPanel(
  g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number,
  opts: { fill?: number; alpha?: number; border?: number; borderAlpha?: number } = {},
): Phaser.GameObjects.Graphics {
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);
  const fill = opts.fill ?? COLORS.panel;
  const border = opts.border ?? COLORS.border;
  g.fillStyle(COLORS.ink, (opts.alpha ?? 0.92));
  g.fillRect(x + 1, y, w - 2, h);
  g.fillRect(x, y + 1, w, h - 2);
  g.fillStyle(fill, opts.alpha ?? 0.92);
  g.fillRect(x + 2, y + 1, w - 4, h - 2);
  g.fillRect(x + 1, y + 2, w - 2, h - 4);
  g.fillStyle(border, opts.borderAlpha ?? 1);
  g.fillRect(x + 2, y + 1, w - 4, 1); // top
  g.fillRect(x + 2, y + h - 2, w - 4, 1); // bottom
  g.fillRect(x + 1, y + 2, 1, h - 4); // left
  g.fillRect(x + w - 2, y + 2, 1, h - 4); // right
  return g;
}

export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, opts: Parameters<typeof drawPanel>[5] = {}): Phaser.GameObjects.Graphics {
  return drawPanel(scene.add.graphics(), x, y, w, h, opts);
}

export interface ButtonOptions {
  w?: number;
  h?: number;
  scale?: number;
  color?: number;
  fill?: number;
  sound?: string | null;
  depth?: number;
}

export interface UIButton {
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.BitmapText;
  setEnabled(on: boolean): void;
  setHighlight(on: boolean): void;
}

/** Tap/click button with hover + press feedback. */
export function button(scene: Phaser.Scene, x: number, y: number, label: string, onClick: () => void, opts: ButtonOptions = {}): UIButton {
  const scale = opts.scale ?? 1;
  const t = px(scene, 0, 0, label, { scale, color: opts.color ?? COLORS.text });
  const w = opts.w ?? Math.max(28, Math.ceil(t.width) + 14);
  const h = opts.h ?? 9 * scale + 9;
  const g = scene.add.graphics();
  let enabled = true;
  let hi = false;
  let hover = false;
  const redraw = () => {
    g.clear();
    drawPanel(g, -w / 2, -h / 2, w, h, {
      fill: hover || hi ? COLORS.panelHi : opts.fill ?? COLORS.panel,
      border: !enabled ? COLORS.dim : hover || hi ? COLORS.gold : COLORS.border,
    });
    t.setTint(!enabled ? COLORS.dim : hover || hi ? COLORS.gold : opts.color ?? COLORS.text);
  };
  const c = scene.add.container(Math.round(x), Math.round(y), [g, t]).setSize(w, h);
  if (opts.depth !== undefined) c.setDepth(opts.depth);
  c.setInteractive({ useHandCursor: true });
  c.on('pointerover', () => { hover = true; redraw(); });
  c.on('pointerout', () => { hover = false; c.setScale(1); redraw(); });
  c.on('pointerdown', () => { if (enabled) c.setScale(0.94); });
  c.on('pointerup', () => {
    c.setScale(1);
    if (!enabled) {
      audio.sfx('menu-error');
      return;
    }
    if (opts.sound !== null) audio.sfx(opts.sound ?? 'menu-select');
    onClick();
  });
  redraw();
  return {
    container: c,
    label: t,
    setEnabled(on) { enabled = on; redraw(); },
    setHighlight(on) { hi = on; redraw(); },
  };
}

/** Segmented 1..max rating bar. */
export function ratingBar(scene: Phaser.Scene, x: number, y: number, value: number, max = 5, color: number = COLORS.gold): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  setRatingBar(g, x, y, value, max, color);
  return g;
}

export function setRatingBar(g: Phaser.GameObjects.Graphics, x: number, y: number, value: number, max = 5, color: number = COLORS.gold): void {
  g.clear();
  for (let i = 0; i < max; i++) {
    g.fillStyle(COLORS.ink, 1).fillRect(x + i * 11, y, 10, 6);
    g.fillStyle(i < value ? color : 0x2a3a5e, 1).fillRect(x + i * 11 + 1, y + 1, 8, 4);
    if (i < value) g.fillStyle(0xffffff, 0.45).fillRect(x + i * 11 + 1, y + 1, 8, 1);
  }
}

/** Lighten a 0xRRGGBB colour toward white by t (0..1). */
export function lighten(color: number, t: number): number {
  const c = Phaser.Display.Color.IntegerToColor(color);
  const l = (v: number) => Math.round(v + (255 - v) * t);
  return Phaser.Display.Color.GetColor(l(c.red), l(c.green), l(c.blue));
}
