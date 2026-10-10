import Phaser from 'phaser';
import { DEPTH } from '../config';
import { FX_PX, FX_SOFT } from './FxTextures';

export interface ParticleSpec {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  /** px/s² */
  gravity?: number;
  /** Velocity damping per second (0 = none, 4 = strong drag). */
  drag?: number;
  lifeMs: number;
  /** Frame names played evenly over the lifetime (or a single frame). */
  frames: readonly string[];
  soft?: boolean;
  tint?: number;
  alpha?: number;
  /** Alpha at end of life (default 0). */
  alphaEnd?: number;
  scale?: number;
  scaleEnd?: number;
  add?: boolean;
  depth?: number;
  delayMs?: number;
  flipX?: boolean;
  /** Frames ping-pong (0..n..0) instead of playing once. */
  pingPong?: boolean;
  /** Follow this object (offset = spawn position relative to it). */
  follow?: { x: number; y: number; active?: boolean };
}

interface Live {
  img: Phaser.GameObjects.Image;
  s: ParticleSpec;
  vx: number;
  vy: number;
  age: number;
  ox: number;
  oy: number;
}

/**
 * Fixed-size pool of image particles (no allocation after create; the display-list size
 * stays constant so level restarts don't drift). When full, the oldest particle is recycled.
 */
export class FxParticles {
  private readonly free: Live[] = [];
  private readonly live: Live[] = [];

  constructor(scene: Phaser.Scene, size: number) {
    for (let i = 0; i < size; i++) {
      const img = scene.add.image(0, 0, FX_PX, 'dot').setVisible(false).setActive(false).setDepth(DEPTH.effects);
      this.free.push({ img, s: undefined as unknown as ParticleSpec, vx: 0, vy: 0, age: 0, ox: 0, oy: 0 });
    }
  }

  get activeCount(): number {
    return this.live.length;
  }

  spawn(s: ParticleSpec): void {
    // Recycle the oldest live particle when the pool is exhausted.
    const rec = this.free.pop() ?? this.live.shift();
    if (!rec) return;
    rec.s = s;
    rec.vx = s.vx ?? 0;
    rec.vy = s.vy ?? 0;
    rec.age = -(s.delayMs ?? 0);
    rec.ox = s.follow ? s.x - s.follow.x : 0;
    rec.oy = s.follow ? s.y - s.follow.y : 0;
    const im = rec.img;
    im.setTexture(s.soft ? FX_SOFT : FX_PX, s.frames[0]);
    im.setPosition(s.x, s.y).setScale(s.scale ?? 1).setAlpha(s.alpha ?? 1).setDepth(s.depth ?? DEPTH.effects);
    im.setFlipX(!!s.flipX);
    im.setBlendMode(s.add ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    if (s.tint !== undefined) im.setTint(s.tint);
    else im.clearTint();
    im.setVisible(rec.age >= 0).setActive(true);
    this.live.push(rec);
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      const s = p.s;
      p.age += dtMs;
      const im = p.img;
      if (p.age < 0) continue;
      if (p.age >= s.lifeMs || (s.follow && s.follow.active === false)) {
        this.live.splice(i, 1);
        im.setVisible(false).setActive(false);
        this.free.push(p);
        continue;
      }
      const t = p.age / s.lifeMs;
      if (s.gravity) p.vy += s.gravity * dt;
      if (s.drag) {
        const k = Math.max(0, 1 - s.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      if (s.follow) {
        p.ox += p.vx * dt;
        p.oy += p.vy * dt;
        im.setPosition(s.follow.x + p.ox, s.follow.y + p.oy);
      } else {
        im.x += p.vx * dt;
        im.y += p.vy * dt;
      }
      const n = s.frames.length;
      if (n > 1) {
        let fi: number;
        if (s.pingPong) {
          const k = Math.floor(t * (2 * n - 1));
          fi = k < n ? k : 2 * n - 2 - k;
        } else fi = Math.min(n - 1, Math.floor(t * n));
        im.setFrame(s.frames[Math.max(0, fi)]);
      }
      const a0 = s.alpha ?? 1;
      const a1 = s.alphaEnd ?? 0;
      im.setAlpha(a0 + (a1 - a0) * t);
      if (s.scaleEnd !== undefined) {
        const s0 = s.scale ?? 1;
        im.setScale(s0 + (s.scaleEnd - s0) * t);
      }
      im.setVisible(true);
    }
  }

  clear(): void {
    for (const p of this.live) {
      p.img.setVisible(false).setActive(false);
      this.free.push(p);
    }
    this.live.length = 0;
  }
}
