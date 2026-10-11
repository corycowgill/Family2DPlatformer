import Phaser from 'phaser';
import { GAME_WIDTH } from '../config';
import { px, setPx } from '../ui/PixelFont';
import { onNav } from '../ui/NavInput';
import { prompt } from '../ui/Prompts';
import { COLORS } from '../ui/Widgets';
import { reducedMotion } from '../ui/Transitions';
import { hasRealFrame } from '../ui/Icons';
import { audio } from '../systems/AudioSystem';
import { typewriterLength, typewriterSlice, wrapText } from './storyData';

/** Shared building blocks for the cutscene scenes (StoryScene, EndingScene). */

export const INK = COLORS.ink;
export const CREAM = 0xfff3c4;

// ------------------------------------------------------------------ caption box (typewriter)

const CHARS_PER_SEC = 42;

/** Yellow comic caption box with typewriter text. */
export class CaptionBox {
  readonly container: Phaser.GameObjects.Container;
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.BitmapText;
  private lines: string[] = [];
  private total = 0;
  private shown = 0;
  private acc = 0;
  private onDone?: () => void;

  constructor(
    scene: Phaser.Scene,
    readonly x: number,
    readonly y: number,
    readonly w: number,
    readonly h: number,
    opts: { depth?: number; fill?: number; color?: number } = {},
  ) {
    this.container = scene.add.container(x, y).setDepth(opts.depth ?? 50);
    this.g = scene.add.graphics();
    this.g.fillStyle(INK, 1).fillRect(1, 1, w, h); // drop shadow
    this.g.fillStyle(opts.fill ?? CREAM, 1).fillRect(0, 0, w - 1, h - 1);
    this.g.lineStyle(1, INK, 1).strokeRect(0.5, 0.5, w - 2, h - 2);
    this.text = px(scene, 8, 7, '', { origin: [0, 0], outline: false, color: opts.color ?? INK });
    this.text.setLineSpacing(3);
    this.container.add([this.g, this.text]);
  }

  /** Start typing `text`. Under reduced motion it still types (text is not motion) but faster. */
  say(text: string, onDone?: () => void): void {
    this.lines = wrapText(text, this.w - 16);
    this.total = typewriterLength(this.lines);
    this.shown = 0;
    this.acc = 0;
    this.onDone = onDone;
    setPx(this.text, '');
    const lh = this.lines.length * 12 - 3;
    this.text.setY(Math.max(5, Math.round((this.h - lh) / 2)));
  }

  get done(): boolean {
    return this.shown >= this.total;
  }

  /** Reveal everything now. */
  complete(): void {
    if (this.done) return;
    this.shown = this.total;
    setPx(this.text, typewriterSlice(this.lines, this.shown));
    const cb = this.onDone;
    this.onDone = undefined;
    cb?.();
  }

  update(dtMs: number): void {
    if (this.done) return;
    this.acc += (dtMs / 1000) * CHARS_PER_SEC * (reducedMotion() ? 2 : 1);
    const n = Math.floor(this.acc);
    if (n <= 0) return;
    this.acc -= n;
    const before = this.shown;
    this.shown = Math.min(this.total, this.shown + n);
    setPx(this.text, typewriterSlice(this.lines, this.shown));
    if (Math.floor(before / 3) !== Math.floor(this.shown / 3)) audio.sfx('menu-move', { volume: 0.18, detune: Phaser.Math.Between(-80, 80) });
    if (this.done) {
      const cb = this.onDone;
      this.onDone = undefined;
      cb?.();
    }
  }

  setVisible(v: boolean): this {
    this.container.setVisible(v);
    return this;
  }
}

// ------------------------------------------------------------------ speech bubble

/** White comic speech bubble with a tail pointing down-left (or down-right with `tailRight`). */
export function speechBubble(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: { tailRight?: boolean; scale?: number; color?: number; maxWidth?: number; shout?: boolean } = {},
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const lines = wrapText(text, opts.maxWidth ?? 150);
  const scale = opts.scale ?? 1;
  const t = px(scene, 0, 0, lines.join('\n'), { scale, outline: false, color: opts.color ?? INK });
  t.setLineSpacing(2);
  const w = Math.ceil(t.width) + 12;
  const h = Math.ceil(t.height) + 9;
  const g = scene.add.graphics();
  // Body with notched corners, ink outline.
  const L = -w / 2;
  const T = -h / 2;
  g.fillStyle(INK, 1);
  g.fillRect(L + 1, T - 1, w - 2, h + 2).fillRect(L - 1, T + 1, w + 2, h - 2).fillRect(L, T, w, h);
  g.fillStyle(opts.shout ? 0xfff7d6 : 0xffffff, 1);
  g.fillRect(L + 1, T, w - 2, h).fillRect(L, T + 1, w, h - 2);
  // Tail.
  const tx = opts.tailRight ? w / 2 - 14 : L + 14;
  const dir = opts.tailRight ? 1 : -1;
  g.fillStyle(INK, 1).fillTriangle(tx - 5, h / 2 - 1, tx + 5, h / 2 - 1, tx + dir * 9, h / 2 + 9);
  g.fillStyle(0xffffff, 1).fillTriangle(tx - 3, h / 2 - 2, tx + 3, h / 2 - 2, tx + dir * 7, h / 2 + 6);
  c.add([g, t]);
  return c;
}

/** Pop a container in (scale bounce), unless reduced motion. */
export function popIn(scene: Phaser.Scene, obj: Phaser.GameObjects.Container | Phaser.GameObjects.Components.Transform, delay = 0): void {
  const o = obj as unknown as Phaser.GameObjects.Container;
  if (reducedMotion()) {
    o.setAlpha(0);
    scene.tweens.add({ targets: o, alpha: 1, delay, duration: 150 });
    return;
  }
  const s = o.scale;
  o.setScale(0.1).setAlpha(0);
  scene.tweens.add({ targets: o, scale: s, alpha: 1, delay, duration: 260, ease: 'Back.out' });
}

// ------------------------------------------------------------------ controls (next / skip)

export interface CutsceneControls {
  /** Hide the controls (end of the cutscene). */
  destroy(): void;
}

/**
 * Standard cutscene input: CONFIRM (Enter/Space/Z, pad A, tap anywhere) → next; BACK (Esc,
 * pad B/View, pad Menu, or tapping the SKIP sign) → skip the whole cutscene. Draws the
 * device-aware "NEXT" hint and the SKIP sign, right-aligned at (right, y).
 */
export function cutsceneControls(
  scene: Phaser.Scene,
  handlers: { next: () => void; skip: () => void },
  y = 258,
  depth = 900,
  right = GAME_WIDTH - 9,
): CutsceneControls {
  const skip = prompt(scene, right - 4, y, (d) => (d === 'touch' ? 'SKIP ▶▶' : '{BACK} SKIP ▶▶'), {
    origin: [1, 0.5],
    color: COLORS.sub,
    depth,
    bg: true,
  });
  const nextHint = prompt(scene, 0, y, (d) => (d === 'touch' ? 'TAP: NEXT' : '{CONFIRM} NEXT'), { origin: [1, 0.5], color: COLORS.sub, depth });
  const place = () => nextHint.setX(Math.round(skip.x - skip.blockW - 16));
  place();
  scene.events.on(Phaser.Scenes.Events.UPDATE, place);
  const onSkipSign = (pt: Phaser.Input.Pointer) =>
    pt.x >= skip.x - skip.blockW - 8 && pt.x <= skip.x + 8 && Math.abs(pt.y - skip.y) <= skip.blockH / 2 + 8;
  const offNav = onNav(scene, (a) => {
    if (a === 'confirm') handlers.next();
    else if (a === 'back' || a === 'start') handlers.skip();
  }, 250);
  const onTap = (pt: Phaser.Input.Pointer) => {
    if (onSkipSign(pt)) handlers.skip();
    else handlers.next();
  };
  scene.input.on('pointerup', onTap);
  const destroy = () => {
    offNav();
    scene.input.off('pointerup', onTap);
    scene.events.off(Phaser.Scenes.Events.UPDATE, place);
    if (skip.scene) skip.destroy();
    if (nextHint.scene) nextHint.destroy();
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, destroy);
  return { destroy };
}

// ------------------------------------------------------------------ textures

const PX = 'story-px';
export const FLAG_TEX = 'story-flag';
export const FLAG_FRAMES = 4;

/** Ensure the generated textures used by cutscenes exist: a 2x2 white pixel and a waving Chicago flag. */
export function ensureStoryTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(PX)) {
    const t = scene.textures.createCanvas(PX, 2, 2);
    if (t) {
      t.getContext().fillStyle = '#ffffff';
      t.getContext().fillRect(0, 0, 2, 2);
      t.refresh();
    }
  }
  if (!scene.textures.exists(FLAG_TEX)) buildFlag(scene);
}

export const pixelTexture = PX;

/** Waving Chicago flag spritesheet (FLAG_FRAMES frames), from the items atlas' goal_flag when shipped. */
function buildFlag(scene: Phaser.Scene): void {
  const W = 27;
  const H = 17;
  const src = document.createElement('canvas');
  src.width = W;
  src.height = H;
  const sctx = src.getContext('2d')!;
  if (hasRealFrame(scene, 'items', 'goal_flag')) {
    const f = scene.textures.getFrame('items', 'goal_flag');
    sctx.drawImage(f.source.image as CanvasImageSource, f.cutX, f.cutY, f.cutWidth, f.cutHeight, 0, 0, W, H);
  } else {
    // Placeholder Chicago flag: white field, two light-blue stripes, four red stars.
    sctx.fillStyle = '#ffffff';
    sctx.fillRect(0, 0, W, H);
    sctx.fillStyle = '#b3ddf2';
    sctx.fillRect(0, 2, W, 3);
    sctx.fillRect(0, H - 5, W, 3);
    sctx.fillStyle = '#e8414e';
    for (let i = 0; i < 4; i++) {
      const cx = 4 + i * 6;
      sctx.fillRect(cx - 1, 7, 3, 3);
      sctx.fillRect(cx, 6, 1, 5);
      sctx.fillRect(cx - 2, 8, 5, 1);
    }
  }
  const tex = scene.textures.createCanvas(FLAG_TEX, (W + 1) * FLAG_FRAMES, H + 4);
  if (!tex) return;
  const ctx = tex.getContext();
  for (let fi = 0; fi < FLAG_FRAMES; fi++) {
    const ox = fi * (W + 1);
    for (let x = 0; x < W; x++) {
      // Travelling wave, amplitude growing away from the pole.
      const amp = 0.4 + (x / W) * 1.1;
      const dy = Math.round(Math.sin(x * 0.3 - (fi * Math.PI) / 2) * amp) + 2;
      ctx.drawImage(src, x, 0, 1, H, ox + x, dy, 1, H);
      // Shade the troughs.
      const shade = Math.cos(x * 0.3 - (fi * Math.PI) / 2);
      if (shade < -0.4 && x > 2) {
        ctx.fillStyle = 'rgba(11,23,48,0.18)';
        ctx.fillRect(ox + x, dy, 1, H);
      }
    }
    tex.add(fi, 0, ox, 0, W, H + 4);
  }
  tex.refresh();
  if (!scene.anims.exists('story:flag')) {
    scene.anims.create({
      key: 'story:flag',
      frames: Array.from({ length: FLAG_FRAMES }, (_, i) => ({ key: FLAG_TEX, frame: i })),
      frameRate: 8,
      repeat: -1,
    });
  }
}

// ------------------------------------------------------------------ particles

export const CONFETTI_COLORS = [COLORS.red, COLORS.skyBlue, COLORS.gold, 0xffffff, COLORS.green];

/** Falling confetti across `width` from y. Gentler (slow, fewer) under reduced motion. */
export function confetti(scene: Phaser.Scene, x: number, y: number, width: number, depth = 40): Phaser.GameObjects.Particles.ParticleEmitter {
  ensureStoryTextures(scene);
  const still = reducedMotion();
  return scene.add
    .particles(x, y, PX, {
      x: { min: 0, max: width },
      speedY: { min: still ? 15 : 30, max: still ? 30 : 70 },
      speedX: { min: -20, max: 20 },
      gravityY: still ? 0 : 20,
      lifespan: 6000,
      frequency: still ? 120 : 35,
      quantity: 1,
      scaleX: { min: 0.5, max: 1.5 },
      scaleY: { min: 0.5, max: 1 },
      rotate: { min: 0, max: 360 },
      tint: CONFETTI_COLORS,
    })
    .setDepth(depth);
}

/** One firework burst (sparkle ring that droops and fades). */
export function firework(scene: Phaser.Scene, x: number, y: number, color: number, depth = 30): void {
  ensureStoryTextures(scene);
  const e = scene.add
    .particles(x, y, PX, {
      speed: { min: 30, max: 75 },
      angle: { min: 0, max: 360 },
      gravityY: 40,
      lifespan: { min: 700, max: 1100 },
      alpha: { start: 1, end: 0 },
      scale: { start: 1, end: 0.5 },
      tint: [color, 0xffffff, color],
      emitting: false,
    })
    .setDepth(depth);
  e.explode(34);
  scene.time.delayedCall(1300, () => e.destroy());
}

// ------------------------------------------------------------------ misc drawing

/** Comic "speed lines" burst behind a subject (alternating wedge colours). */
export function speedBurst(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, a: number, b: number, rays = 28): void {
  g.fillStyle(a, 1).fillRect(cx - r, cy - r, r * 2, r * 2);
  g.fillStyle(b, 1);
  for (let i = 0; i < rays; i += 2) {
    const a0 = (i / rays) * Math.PI * 2;
    const a1 = ((i + 1) / rays) * Math.PI * 2;
    g.fillTriangle(cx, cy, cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
  }
}

/** A stretch of CTA elevated structure: rails + deck on top at `y`, lattice girder and columns below. */
export function drawElTrack(g: Phaser.GameObjects.Graphics, x0: number, x1: number, y: number, depthBelow = 40, color = 0x6b4a32): void {
  const dark = 0x3a2618;
  // Columns.
  for (let x = x0 + 20; x < x1; x += 72) {
    g.fillStyle(dark, 1).fillRect(x, y + 14, 6, depthBelow);
    g.fillStyle(color, 1).fillRect(x + 1, y + 14, 3, depthBelow);
  }
  // Girder with X lattice.
  g.fillStyle(dark, 1).fillRect(x0, y + 4, x1 - x0, 12);
  g.fillStyle(color, 1).fillRect(x0, y + 5, x1 - x0, 2).fillRect(x0, y + 13, x1 - x0, 2);
  g.lineStyle(1, color, 1);
  for (let x = x0; x < x1; x += 12) {
    g.lineBetween(x, y + 7, x + 6, y + 13);
    g.lineBetween(x + 6, y + 13, x + 12, y + 7);
  }
  // Ties + rails.
  g.fillStyle(0x2b2b33, 1).fillRect(x0, y + 2, x1 - x0, 3);
  for (let x = x0; x < x1; x += 5) g.fillStyle(0x4a3a2e, 1).fillRect(x, y + 1, 3, 2);
  g.fillStyle(0xbfc6d4, 1).fillRect(x0, y, x1 - x0, 1);
}
