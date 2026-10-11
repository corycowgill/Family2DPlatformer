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
 *  - scrolling highlights along every water surface in the level's `water` layer,
 *  - World 2: sailboats on the lake horizon (lakefront), white gulls (lakefront), butterflies
 *    (park) / fireflies (night), alien scout ships drifting over the sky and sweeping beams
 *    (night, stadium), pulsing stadium light flares (stadium), neon signs flickering (night).
 *
 * Built for phones: every sprite is created once up front (fixed pools), update() does no
 * allocation, anything off-screen is hidden, and reduced motion hides it all.
 */

const ATLAS = 'ambient';
const WATER_TEX = 'ambient-water';
const BIRD_FRAMES = ['bird_0', 'bird_1', 'bird_2', 'bird_3'] as const;
const GLINT_SEQ = ['glint_0', 'glint_1', 'glint_2', 'glint_3', 'glint_2', 'glint_1', 'glint_0'] as const;
const STEAM_FRAMES = ['steam_0', 'steam_1', 'steam_2', 'steam_3'] as const;

const BIRD_TINT: Record<LevelTheme, number> = {
  day: 0x2c3444,
  rooftop: 0x3c3444,
  river: 0xf2f6fa,
  sunset: 0x1a1030,
  park: 0x34404c,
  lakefront: 0xf6f8fa,
  night: 0x1a1030,
  stadium: 0x1a1030,
};
/** No bird flocks at night (the sky belongs to the aliens). */
const NO_BIRDS: ReadonlySet<LevelTheme> = new Set<LevelTheme>(['night', 'stadium']);
const SAIL_FRAMES = ['sail_0', 'sail_1', 'sail_2'] as const;
const FLUTTER = 8;
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
interface Ship {
  img: Phaser.GameObjects.Image;
  active: boolean;
  x: number;
  y: number;
  vx: number;
  timer: number;
  phase: number;
}
interface Beam {
  img: Phaser.GameObjects.Image;
  phase: number;
  speed: number;
}
interface Flare {
  img: Phaser.GameObjects.Image;
  layer: ParallaxLayer;
  lx: number;
  ly: number;
  phase: number;
}
interface Flyer {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  turn: number;
}
interface NeonBlink {
  img: Phaser.GameObjects.Image;
  layer: ParallaxLayer;
  lx: number;
  ly: number;
  timer: number;
  burst: number;
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

  // World 2
  private sails: Mover[] = [];
  private ships: Ship[] = [];
  private beams: Beam[] = [];
  private flares: Flare[] = [];
  private flyers: Flyer[] = [];
  private neon: NeonBlink[] = [];

  constructor(
    ctx: LevelContext,
    private readonly parallax: Parallax,
  ) {
    this.scene = ctx.scene;
    this.theme = parallax.theme;
    this.a = AMBIENT_ANCHORS[this.theme] ?? AMBIENT_ANCHORS.day;
    this.hasAtlas = this.scene.textures.exists(ATLAS) && this.scene.textures.get(ATLAS).has('bird_0');
    this.lastScrollX = this.scene.cameras.main.scrollX;
    if (this.hasAtlas) {
      this.buildBirds();
      this.buildTrain();
      this.buildBoats();
      this.buildTwinkles();
      this.buildGlint();
      this.buildSteam();
      this.buildWorld2();
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
    this.sails.forEach((m) => all.push(m.img));
    this.ships.forEach((m) => all.push(m.img));
    this.beams.forEach((b) => all.push(b.img));
    this.flares.forEach((f) => all.push(f.img));
    this.flyers.forEach((f) => all.push(f.img));
    this.neon.forEach((n) => all.push(n.img));
    all.forEach((o) => o.destroy());
  }

  // ---------------------------------------------------------------- build
  private img(frame: string, depth: number): Phaser.GameObjects.Image {
    return this.scene.add.image(-100, -100, ATLAS, frame).setScrollFactor(0).setDepth(depth).setVisible(false);
  }

  private buildBirds(): void {
    if (NO_BIRDS.has(this.theme)) return;
    const tint = BIRD_TINT[this.theme];
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
    const frame =
      this.theme === 'sunset' ? 'train_sunset' : this.theme === 'rooftop' ? 'train_rooftop' : this.theme === 'night' ? 'train_night' : 'train_day';
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
    for (const o of [...this.sails, ...this.ships, ...this.beams, ...this.flares, ...this.flyers, ...this.neon]) o.img.setVisible(false);
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
    for (const m of this.sails) this.updateMover(m, dt, 'far', 1.5, 4, 3, 9);
    if (this.ships.length) this.updateShips(dt, camDx);
    if (this.beams.length) this.updateBeams();
    if (this.flares.length) this.updateFlares();
    if (this.flyers.length) this.updateFlyers(dt, camDx);
    if (this.neon.length) this.updateNeon(dt);
  }

  // ---------------------------------------------------------------- World 2
  private has(frame: string): boolean {
    return this.scene.textures.get(ATLAS).has(frame);
  }

  private buildWorld2(): void {
    const a = this.a;
    const far = this.parallax.layer('far');
    if (a.lake && far && this.has('sail_0')) {
      SAIL_FRAMES.forEach((f, i) => {
        const img = this.img(f, far.depth + 0.4).setOrigin(0, 1);
        this.sails.push({ img, active: false, lx: 0, y: a.lake!.y + i * 4, dir: 1, speed: 0, timer: rand(0, 4) + i * 5, age: 0 });
      });
    }
    if (a.ships && this.has('ufo_0')) {
      for (let i = 0; i < 2; i++) {
        const img = this.img('ufo_0', DEPTH.sky + 6).setOrigin(0.5);
        this.ships.push({ img, active: false, x: 0, y: 0, vx: 0, timer: rand(1, 4) + i * 7, phase: Math.random() * 6 });
      }
    }
    if (a.beams && this.has('beam')) {
      const tint = this.theme === 'night' ? 0x9affc8 : 0xdfe8ff;
      for (const x of a.beams) {
        const img = this.img('beam', DEPTH.sky + 4)
          .setOrigin(0.5, 1)
          .setPosition(x, GAME_HEIGHT - 30)
          .setTint(tint)
          .setAlpha(0.1)
          .setBlendMode(Phaser.BlendModes.ADD);
        this.beams.push({ img, phase: Math.random() * 6, speed: rand(0.25, 0.45) });
      }
    }
    if (a.flares && this.has('flare')) {
      const layer = this.parallax.layer(a.flares.layer);
      if (layer) {
        for (let i = 0; i + 1 < a.flares.pts.length; i += 2) {
          const img = this.img('flare', layer.depth + 0.4).setOrigin(0.5).setScale(1.7).setBlendMode(Phaser.BlendModes.ADD).setTint(0xe8f0ff);
          this.flares.push({ img, layer, lx: a.flares.pts[i], ly: a.flares.pts[i + 1], phase: Math.random() * 6 });
        }
      }
    }
    if (a.flutter) {
      const fire = a.flutter === 'fireflies';
      const frame = fire ? 'mote' : 'butterfly_0';
      if (this.has(frame)) {
        const tints = fire ? [0xd8ff9a] : [0xffffff, 0xffe066, 0xff9ad0, 0xffb84a, 0xa8d8ff];
        for (let i = 0; i < (fire ? FLUTTER * 2 : FLUTTER); i++) {
          const img = this.img(frame, DEPTH.parallaxNear + 1).setOrigin(0.5).setTint(tints[i % tints.length]);
          if (fire) img.setBlendMode(Phaser.BlendModes.ADD);
          const f: Flyer = { img, x: 0, y: 0, vx: 0, vy: 0, phase: Math.random() * 6, turn: 0 };
          this.respawnFlyer(f, true);
          this.flyers.push(f);
        }
      }
    }
    const mid = this.parallax.layer('mid');
    if (a.neon && mid && this.has('px')) {
      for (let i = 0; i + 3 < a.neon.length && this.neon.length < 4; i += 4 * 3) {
        const img = this.img('px', mid.depth + 0.3).setOrigin(0, 0).setTint(0x0e0e22).setDisplaySize(a.neon[i + 2], a.neon[i + 3]);
        this.neon.push({ img, layer: mid, lx: a.neon[i], ly: a.neon[i + 1], timer: rand(1, 5), burst: 0 });
      }
    }
  }

  private updateShips(dt: number, camDx: number): void {
    for (const s of this.ships) {
      if (!s.active) {
        s.timer -= dt;
        if (s.timer > 0) continue;
        const dir = Math.random() < 0.5 ? 1 : -1;
        s.active = true;
        s.vx = dir * rand(9, 18);
        s.x = dir > 0 ? -30 : GAME_WIDTH + 30;
        s.y = rand(26, 96);
        s.img.setVisible(true);
      }
      s.x += s.vx * dt - camDx * 0.04;
      const bob = Math.sin(this.t * 1.3 + s.phase) * 2;
      s.img.setPosition(Math.round(s.x), Math.round(s.y + bob));
      s.img.setFrame(Math.floor(this.t * 4 + s.phase) & 1 ? 'ufo_1' : 'ufo_0');
      if (s.x < -60 || s.x > GAME_WIDTH + 60) {
        s.active = false;
        s.timer = rand(6, 16);
        s.img.setVisible(false);
      }
    }
  }

  private updateBeams(): void {
    for (const b of this.beams) {
      b.img.setVisible(true);
      b.img.rotation = Math.sin(this.t * b.speed + b.phase) * 0.42;
      b.img.setAlpha(0.08 + 0.04 * Math.sin(this.t * 0.9 + b.phase));
    }
  }

  private updateFlares(): void {
    for (const f of this.flares) {
      const x = this.sx(f.layer, f.lx);
      const vis = x > -30 && x < GAME_WIDTH + 30;
      f.img.setVisible(vis);
      if (!vis) continue;
      f.img.setPosition(Math.round(x), f.ly + f.layer.ts.y);
      // slow breathing + an occasional bright flare-up
      const k = 0.3 + 0.08 * Math.sin(this.t * 2.1 + f.phase) + (Math.sin(this.t * 0.37 + f.phase * 3) > 0.97 ? 0.25 : 0);
      f.img.setAlpha(k);
    }
  }

  private respawnFlyer(f: Flyer, anywhere: boolean): void {
    const fire = this.a.flutter === 'fireflies';
    f.x = anywhere ? rand(0, GAME_WIDTH) : Math.random() < 0.5 ? -6 : GAME_WIDTH + 6;
    f.y = fire ? rand(120, GAME_HEIGHT - 40) : rand(110, GAME_HEIGHT - 70);
    f.vx = (f.x < 0 ? 1 : f.x > GAME_WIDTH ? -1 : Math.random() < 0.5 ? 1 : -1) * rand(6, 14);
    f.vy = rand(-4, 4);
    f.turn = rand(0.5, 2);
  }

  private updateFlyers(dt: number, camDx: number): void {
    const fire = this.a.flutter === 'fireflies';
    for (const f of this.flyers) {
      f.turn -= dt;
      if (f.turn <= 0) {
        f.vx = Math.sign(f.vx || 1) * rand(5, 14) * (Math.random() < 0.15 ? -1 : 1);
        f.vy = rand(-6, 6);
        f.turn = rand(0.6, 2.2);
      }
      f.x += f.vx * dt - camDx * 0.6;
      f.y += (f.vy + Math.sin(this.t * (fire ? 1.5 : 7) + f.phase) * (fire ? 3 : 10)) * dt;
      if (f.x < -12 || f.x > GAME_WIDTH + 12 || f.y < 90 || f.y > GAME_HEIGHT - 20) this.respawnFlyer(f, false);
      f.img.setPosition(Math.round(f.x), Math.round(f.y)).setVisible(true);
      if (fire) {
        f.img.setAlpha(Math.max(0, Math.sin(this.t * 1.7 + f.phase * 2)) * 0.9);
      } else {
        const fr = Math.floor(this.t * 12 + f.phase) % 3;
        f.img.setFrame(`butterfly_${fr}`).setFlipX(f.vx < 0);
      }
    }
  }

  private updateNeon(dt: number): void {
    for (const n of this.neon) {
      const x = this.sx(n.layer, n.lx);
      if (n.burst > 0) {
        n.burst -= dt;
        const off = n.burst > 0 && Math.sin(n.burst * 70) > 0;
        n.img.setVisible(off && x > -40 && x < GAME_WIDTH);
        if (off) n.img.setPosition(Math.round(x), n.ly + n.layer.ts.y);
        continue;
      }
      n.img.setVisible(false);
      if ((n.timer -= dt) <= 0) {
        n.burst = rand(0.15, 0.5);
        n.timer = rand(2, 7);
      }
    }
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
