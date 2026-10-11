import Phaser from 'phaser';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH, TILE_SIZE } from '../config';
import type { LevelTheme } from '../types';
import type { LevelContext } from './LevelContext';
import type { Parallax, ParallaxLayer } from './Parallax';
import { AMBIENT_ANCHORS, type ThemeAnchors } from './AmbientAnchors';

/**
 * Theme-driven ambient animation layered onto the parallax background and the level's
 * water: drifting clouds live in Parallax; this adds
 *  - bird flocks crossing the sky now and then (all themes),
 *  - an L train rolling along the mid-layer elevated track (day, rooftop, sunset),
 *  - tour boats / water taxis on the river (river),
 *  - windows switching on and off across the skyline (sunset),
 *  - sun glints flashing on glass towers (day, rooftop, river),
 *  - steam wisps from rooftop vents (rooftop),
 *  - scrolling highlights along every water surface in the level's `water` layer.
 *
 * Built for phones: every sprite is created once up front (fixed pools), update() does no
 * allocation, anything off-screen is hidden, and reduced motion hides it all.
 */

const ATLAS = 'ambient';
const WATER_TEX = 'ambient-water';
const BIRD_FRAMES = ['bird_0', 'bird_1', 'bird_2', 'bird_3'] as const;
const GLINT_SEQ = ['glint_0', 'glint_1', 'glint_2', 'glint_3', 'glint_2', 'glint_1', 'glint_0'] as const;
const STEAM_FRAMES = ['steam_0', 'steam_1', 'steam_2', 'steam_3'] as const;

const BIRD_TINT: Partial<Record<LevelTheme, number>> = { day: 0x2c3444, rooftop: 0x3c3444, river: 0xf2f6fa, sunset: 0x1a1030 };
const NO_ANCHORS: ThemeAnchors = { windows: { far: [], mid: [] }, glints: [], vents: [], train: null, river: null };
const LIT_TINTS = [0xffd27a, 0xffc060, 0xfff0b0, 0xffb070] as const;

const FLOCK = 7;
const TWINKLES = 22;
const STEAM = 18;

interface Bird {
  s: Phaser.GameObjects.Image;
  dx: number;
  dy: number;
  phase: number;
  frame: number;
}
interface Mover {
  img: Phaser.GameObjects.Image;
  wake?: Phaser.GameObjects.Image;
  active: boolean;
  /** Layer-space x of the sprite's left edge. */
  lx: number;
  y: number;
  dir: 1 | -1;
  speed: number;
  timer: number;
  age: number;
}
interface Twinkle {
  s: Phaser.GameObjects.Image;
  layer: ParallaxLayer | undefined;
  lx: number;
  ly: number;
  on: boolean;
  timer: number;
}
interface Puff {
  s: Phaser.GameObjects.Image;
  active: boolean;
  lx: number;
  ly: number;
  age: number;
  life: number;
  frame: number;
}
interface WaterRun {
  top: Phaser.GameObjects.TileSprite;
  deep: Phaser.GameObjects.TileSprite;
  x: number;
  y: number;
  w: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Ambient {
  private readonly scene: Phaser.Scene;
  private readonly theme: LevelTheme;
  private readonly a: ThemeAnchors;
  private readonly hasAtlas: boolean;
  private t = 0;
  private hidden = false;
  private lastScrollX: number;

  private birds: Bird[] = [];
  private flockActive = false;
  private flockTimer = rand(2, 6);
  private flockX = 0;
  private flockY = 0;
  private flockVx = 0;

  private train?: Mover;
  private boats: Mover[] = [];

  private twinkles: Twinkle[] = [];
  private glint?: Phaser.GameObjects.Image;
  private glintTimer = rand(1.5, 4);
  private glintStep = -1;
  private glintLx = 0;
  private glintLy = 0;

  private puffs: Puff[] = [];
  private ventTimers: number[] = [];

  private water: WaterRun[] = [];

  constructor(
    ctx: LevelContext,
    private readonly parallax: Parallax,
  ) {
    this.scene = ctx.scene;
    this.theme = parallax.theme;
    // Themes without generated anchors (new worlds before their art lands) get birds only.
    this.a = AMBIENT_ANCHORS[this.theme] ?? NO_ANCHORS;
    this.hasAtlas = this.scene.textures.exists(ATLAS) && this.scene.textures.get(ATLAS).has('bird_0');
    this.lastScrollX = this.scene.cameras.main.scrollX;
    if (this.hasAtlas) {
      this.buildBirds();
      this.buildTrain();
      this.buildBoats();
      this.buildTwinkles();
      this.buildGlint();
      this.buildSteam();
    }
    this.buildWater(ctx);
  }

  destroy(): void {
    const all: Phaser.GameObjects.GameObject[] = [];
    this.birds.forEach((b) => all.push(b.s));
    if (this.train) all.push(this.train.img);
    this.boats.forEach((b) => (all.push(b.img), b.wake && all.push(b.wake)));
    this.twinkles.forEach((t) => all.push(t.s));
    if (this.glint) all.push(this.glint);
    this.puffs.forEach((p) => all.push(p.s));
    this.water.forEach((w) => all.push(w.top, w.deep));
    all.forEach((o) => o.destroy());
  }

  // ---------------------------------------------------------------- build
  private img(frame: string, depth: number): Phaser.GameObjects.Image {
    return this.scene.add.image(-100, -100, ATLAS, frame).setScrollFactor(0).setDepth(depth).setVisible(false);
  }

  private buildBirds(): void {
    const tint = BIRD_TINT[this.theme] ?? 0x2c3444;
    for (let i = 0; i < FLOCK; i++) {
      // V formation: leader in front, wings trailing alternately up/down.
      const rank = Math.ceil(i / 2);
      const side = i % 2 ? -1 : 1;
      const s = this.img(BIRD_FRAMES[0], DEPTH.parallaxFar + 5).setTint(tint).setOrigin(0.5);
      this.birds.push({ s, dx: -rank * 11, dy: side * rank * 5, phase: Math.random() * 4, frame: 0 });
    }
  }

  private buildTrain(): void {
    const tr = this.a.train;
    if (!tr) return;
    const frame = this.theme === 'sunset' ? 'train_sunset' : this.theme === 'rooftop' ? 'train_rooftop' : 'train_day';
    if (!this.scene.textures.get(ATLAS).has(frame)) return;
    const layer = this.parallax.layer(tr.layer);
    if (!layer) return;
    const img = this.img(frame, layer.depth + 0.5).setOrigin(0, 1);
    this.train = { img, active: false, lx: 0, y: tr.y, dir: 1, speed: 0, timer: rand(1, 4), age: 0 };
  }

  private buildBoats(): void {
    const rv = this.a.river;
    if (!rv) return;
    const layer = this.parallax.layer(rv.layer);
    if (!layer) return;
    const sunset = this.theme === 'sunset';
    const frames = sunset ? ['boat_tour_sunset', 'boat_taxi_sunset'] : ['boat_tour', 'boat_taxi'];
    frames.forEach((f, i) => {
      const img = this.img(f, layer.depth + 0.6 + i * 0.01).setOrigin(0, 1);
      const wake = this.img('wake_0', layer.depth + 0.59).setOrigin(0, 1).setAlpha(0.6);
      this.boats.push({ img, wake, active: false, lx: 0, y: rv.boatY[i % rv.boatY.length], dir: 1, speed: 0, timer: rand(0.5, 5) + i * 6, age: 0 });
    });
  }

  private buildTwinkles(): void {
    const far = this.a.windows.far.length;
    const mid = this.a.windows.mid.length;
    if (!far && !mid) return;
    for (let i = 0; i < TWINKLES; i++) {
      const s = this.img('px', DEPTH.parallaxFar + 0.5).setOrigin(0, 0);
      const tw: Twinkle = { s, layer: undefined, lx: 0, ly: 0, on: false, timer: rand(0, 3) };
      this.twinkles.push(tw);
    }
  }

  private buildGlint(): void {
    if (!this.a.glints.length || !this.parallax.layer('far')) return;
    this.glint = this.img(GLINT_SEQ[0], DEPTH.parallaxFar + 0.6).setOrigin(0.5);
  }

  private buildSteam(): void {
    if (!this.a.vents.length || !this.parallax.layer('near')) return;
    const depth = DEPTH.parallaxNear + 0.5;
    for (let i = 0; i < STEAM; i++) {
      this.puffs.push({ s: this.img(STEAM_FRAMES[0], depth).setOrigin(0.5), active: false, lx: 0, ly: 0, age: 0, life: 1, frame: 0 });
    }
    for (let i = 0; i < this.a.vents.length / 2; i++) this.ventTimers.push(rand(0, 0.6));
  }

  /** One scrolling highlight strip pair per horizontal run of water-surface tiles. */
  private buildWater(ctx: LevelContext): void {
    const layer = ctx.water;
    if (!layer || !this.scene.textures.exists(WATER_TEX)) return;
    const data = layer.layer.data;
    const depth = DEPTH.foreground - 1 + 0.1;
    for (let ty = 0; ty < data.length; ty++) {
      const row = data[ty];
      let start = -1;
      for (let tx = 0; tx <= row.length; tx++) {
        const t = tx < row.length ? row[tx] : null;
        const above = ty > 0 && tx < row.length ? data[ty - 1][tx] : null;
        const surface = !!t && t.index > 0 && !(above && above.index > 0);
        if (surface && start < 0) start = tx;
        if (!surface && start >= 0) {
          const x = start * TILE_SIZE + layer.x;
          const y = ty * TILE_SIZE + layer.y;
          const w = (tx - start) * TILE_SIZE;
          const top = this.scene.add.tileSprite(x, y + 3, w, 8, WATER_TEX).setOrigin(0, 0).setDepth(depth).setAlpha(0.55);
          const deep = this.scene.add.tileSprite(x, y + 9, w, 8, WATER_TEX).setOrigin(0, 0).setDepth(depth).setAlpha(0.22).setFlipX(true);
          deep.tilePositionX = 13;
          this.water.push({ top, deep, x, y, w });
          start = -1;
        }
      }
    }
  }

  // ---------------------------------------------------------------- helpers
  /** Screen x of a layer-space x, wrapped so it lands in [-240, 720). */
  private sx(layer: ParallaxLayer, lx: number): number {
    const w = layer.width;
    let x = (((lx - layer.offsetX) % w) + w) % w;
    if (x >= GAME_WIDTH + 240) x -= w;
    return x;
  }

  private setHidden(h: boolean): void {
    if (this.hidden === h) return;
    this.hidden = h;
    if (!h) return;
    for (const b of this.birds) b.s.setVisible(false);
    if (this.train) this.train.img.setVisible(false);
    for (const b of this.boats) {
      b.img.setVisible(false);
      b.wake?.setVisible(false);
    }
    for (const t of this.twinkles) t.s.setVisible(false);
    this.glint?.setVisible(false);
    for (const p of this.puffs) p.s.setVisible(false);
    for (const w of this.water) {
      w.top.setVisible(false);
      w.deep.setVisible(false);
    }
  }

  // ---------------------------------------------------------------- update
  update(dt: number, reducedMotion: boolean): void {
    this.setHidden(reducedMotion);
    if (reducedMotion) return;
    this.t += dt;
    const cam = this.scene.cameras.main;
    const camDx = cam.scrollX - this.lastScrollX;
    this.lastScrollX = cam.scrollX;
    if (this.birds.length) this.updateBirds(dt, camDx);
    if (this.train) this.updateMover(this.train, dt, this.a.train!.layer, 64, 82, 6, 14);
    for (const b of this.boats) this.updateMover(b, dt, 'mid', 6, 11, 4, 12);
    if (this.twinkles.length) this.updateTwinkles(dt);
    if (this.glint) this.updateGlint(dt);
    if (this.puffs.length) this.updateSteam(dt);
    if (this.water.length) this.updateWater(dt, cam);
  }

  private updateBirds(dt: number, camDx: number): void {
    if (!this.flockActive) {
      this.flockTimer -= dt;
      if (this.flockTimer > 0) return;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.flockVx = dir * rand(26, 40);
      this.flockX = dir > 0 ? -30 : GAME_WIDTH + 30;
      this.flockY = rand(54, 120);
      this.flockActive = true;
      for (const b of this.birds) b.s.setFlipX(dir < 0).setVisible(true);
    }
    // birds are far away: mostly their own motion, a little camera parallax
    this.flockX += this.flockVx * dt - camDx * 0.12;
    const bob = Math.sin(this.t * 1.7) * 3;
    const dir = this.flockVx > 0 ? 1 : -1;
    let anyOn = false;
    for (const b of this.birds) {
      const x = this.flockX + b.dx * dir;
      const y = this.flockY + b.dy * Math.abs(b.dy) * 0.08 + Math.abs(b.dy) + bob + Math.sin(this.t * 2.3 + b.phase) * 1.2;
      b.s.setPosition(Math.round(x), Math.round(y));
      const f = Math.floor(this.t * 9 + b.phase) & 3;
      if (f !== b.frame) {
        b.frame = f;
        b.s.setFrame(BIRD_FRAMES[f]);
      }
      if (x > -40 && x < GAME_WIDTH + 40) anyOn = true;
    }
    if (!anyOn && Math.abs(this.flockX - GAME_WIDTH / 2) > GAME_WIDTH) {
      this.flockActive = false;
      this.flockTimer = rand(8, 18);
      for (const b of this.birds) b.s.setVisible(false);
    }
  }

  /** Train or boat crossing its layer; spawns just off-screen every `gap` seconds. */
  private updateMover(m: Mover, dt: number, layerName: 'far' | 'mid', vMin: number, vMax: number, gapMin: number, gapMax: number): void {
    const layer = this.parallax.layer(layerName);
    if (!layer) return;
    const w = m.img.width;
    if (!m.active) {
      m.timer -= dt;
      if (m.timer > 0) return;
      m.active = true;
      m.age = 0;
      m.dir = Math.random() < 0.5 ? 1 : -1;
      m.speed = rand(vMin, vMax);
      m.lx = layer.offsetX + (m.dir > 0 ? -w - 8 : GAME_WIDTH + 8);
      m.img.setFlipX(m.dir < 0);
      m.wake?.setFlipX(m.dir < 0);
    }
    m.age += dt;
    m.lx += m.dir * m.speed * dt;
    const x = this.sx(layer, m.lx);
    const y = m.y + layer.ts.y;
    const onScreen = x > -w && x < GAME_WIDTH;
    m.img.setVisible(onScreen);
    if (onScreen) m.img.setPosition(Math.round(x), y);
    if (m.wake) {
      m.wake.setVisible(onScreen);
      if (onScreen) {
        m.wake.setPosition(Math.round(m.dir > 0 ? x - 14 : x + w - 2), y + 1);
        m.wake.setFrame(Math.floor(this.t * 4) & 1 ? 'wake_1' : 'wake_0');
      }
    }
    const gone = (m.dir > 0 && x > GAME_WIDTH + 8) || (m.dir < 0 && x < -w - 8);
    if ((gone && m.age > 1) || m.age > 90) {
      m.active = false;
      m.timer = rand(gapMin, gapMax);
      m.img.setVisible(false);
      m.wake?.setVisible(false);
    }
  }

  private updateTwinkles(dt: number): void {
    const far = this.a.windows.far;
    const mid = this.a.windows.mid;
    const farL = this.parallax.layer('far');
    const midL = this.parallax.layer('mid');
    for (const tw of this.twinkles) {
      tw.timer -= dt;
      if (tw.timer <= 0) {
        if (tw.on) {
          tw.on = false;
          tw.timer = rand(0.4, 3);
        } else {
          // switch a dark window on somewhere (prefer one that's on screen)
          const useMid = mid.length > 0 && (far.length === 0 || Math.random() < 0.4);
          const arr = useMid ? mid : far;
          const layer = useMid ? midL : farL;
          if (!layer || !arr.length) continue;
          const i = (Math.floor(Math.random() * (arr.length / 4)) * 4) | 0;
          tw.layer = layer;
          tw.lx = arr[i];
          tw.ly = arr[i + 1];
          tw.s.setDisplaySize(arr[i + 2], arr[i + 3]);
          tw.s.setTint(LIT_TINTS[(Math.random() * LIT_TINTS.length) | 0]);
          tw.s.setDepth(layer.depth + 0.3);
          tw.on = true;
          tw.timer = rand(2, 7);
        }
      }
      if (!tw.on || !tw.layer) {
        tw.s.setVisible(false);
        continue;
      }
      const x = this.sx(tw.layer, tw.lx);
      const vis = x > -4 && x < GAME_WIDTH;
      tw.s.setVisible(vis);
      if (vis) tw.s.setPosition(x, tw.ly + tw.layer.ts.y);
    }
  }

  private updateGlint(dt: number): void {
    const g = this.glint!;
    const layer = this.parallax.layer('far')!;
    if (this.glintStep < 0) {
      this.glintTimer -= dt;
      if (this.glintTimer > 0) return;
      // pick a glint spot that is currently on screen
      const pts = this.a.glints;
      const n = pts.length / 2;
      const k0 = (Math.random() * n) | 0;
      for (let k = 0; k < n; k++) {
        const i = ((k0 + k) % n) * 2;
        const x = this.sx(layer, pts[i]);
        if (x > 8 && x < GAME_WIDTH - 8) {
          this.glintLx = pts[i];
          this.glintLy = pts[i + 1];
          this.glintStep = 0;
          break;
        }
      }
      this.glintTimer = rand(2.5, 6);
      if (this.glintStep < 0) return;
    }
    const step = Math.floor(this.glintStep);
    if (step >= GLINT_SEQ.length) {
      this.glintStep = -1;
      g.setVisible(false);
      return;
    }
    g.setFrame(GLINT_SEQ[step]);
    g.setPosition(this.sx(layer, this.glintLx), this.glintLy + layer.ts.y).setVisible(true);
    this.glintStep += dt * 14;
  }

  private updateSteam(dt: number): void {
    const layer = this.parallax.layer('near')!;
    const v = this.a.vents;
    for (let i = 0; i < this.ventTimers.length; i++) {
      this.ventTimers[i] -= dt;
      if (this.ventTimers[i] > 0) continue;
      this.ventTimers[i] = rand(0.35, 0.7);
      const x = this.sx(layer, v[i * 2]);
      if (x < -20 || x > GAME_WIDTH + 20) continue;
      for (const p of this.puffs) {
        if (p.active) continue;
        p.active = true;
        p.lx = v[i * 2] + rand(-1, 1);
        p.ly = v[i * 2 + 1];
        p.age = 0;
        p.life = rand(1.4, 2.2);
        p.frame = -1;
        break;
      }
    }
    for (const p of this.puffs) {
      if (!p.active) continue;
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        p.active = false;
        p.s.setVisible(false);
        continue;
      }
      p.ly -= 13 * dt;
      p.lx += (4 + k * 8) * dt; // the wind picks it up as it rises
      const f = Math.min(3, Math.floor(k * 4));
      if (f !== p.frame) {
        p.frame = f;
        p.s.setFrame(STEAM_FRAMES[f]);
      }
      const x = this.sx(layer, p.lx);
      p.s.setPosition(Math.round(x), Math.round(p.ly + layer.ts.y)).setAlpha(0.75 * (1 - k * k)).setVisible(true);
    }
  }

  private updateWater(dt: number, cam: Phaser.Cameras.Scene2D.Camera): void {
    const view = cam.worldView;
    const left = view.x - 8;
    const right = view.right + 8;
    const top = view.y - 16;
    const bottom = view.y + GAME_HEIGHT + 16;
    for (const w of this.water) {
      const vis = w.x < right && w.x + w.w > left && w.y > top && w.y < bottom;
      w.top.setVisible(vis);
      w.deep.setVisible(vis);
      if (!vis) continue;
      w.top.tilePositionX = Math.round(this.t * 9) % 32;
      w.deep.tilePositionX = 13 + (Math.round(-this.t * 5) % 32);
    }
  }
}
