import Phaser from 'phaser';
import { DEPTH, TILE_SIZE } from '../config';
import { TILE, TILESET_KEY } from '../data/tiles';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { animKey } from '../systems/AnimationSystem';
import { bool, hasFrame, num, playerRect, tileFrame } from '../world/worldUtil';

/**
 * steamVent <tx> <ty> period=3 offset=0 height=4 lift=false
 *
 * A street grate that periodically vents steam. Cycle: idle → telegraph (small puffs,
 * 0.8 s) → column (1.1 s, damages — or with lift=true, launches the player upward).
 */
export class SteamVent extends Phaser.GameObjects.Zone {
  private t: number;
  private readonly period: number;
  private readonly heightPx: number;
  private readonly lift: boolean;
  private readonly puffs: Phaser.GameObjects.Sprite[] = [];
  private readonly zoneRect: Phaser.Geom.Rectangle;
  static readonly TELEGRAPH = 0.8;
  static readonly ACTIVE = 1.1;

  constructor(
    readonly ctx: LevelContext,
    o: SpawnObject,
  ) {
    super(ctx.scene, o.x, o.y, 16, 16);
    ctx.scene.add.existing(this);
    this.period = Math.max(SteamVent.TELEGRAPH + SteamVent.ACTIVE + 0.4, num(o, 'period', 3));
    this.t = num(o, 'offset', 0);
    this.heightPx = num(o, 'height', 4) * TILE_SIZE;
    this.lift = bool(o, 'lift', false);
    this.zoneRect = new Phaser.Geom.Rectangle(o.x - 7, o.y - this.heightPx, 14, this.heightPx);
    const scene = ctx.scene;
    // Grate on the ground.
    if (hasFrame(scene, 'props', 'steam_vent')) scene.add.image(o.x, o.y, 'props', 'steam_vent').setOrigin(0.5, 1).setDepth(DEPTH.props);
    else scene.add.image(o.x, o.y - 8, TILESET_KEY, tileFrame(scene, TILE.GRATE)).setDepth(DEPTH.props);
    const steamAnim = animKey('props', 'steam');
    const n = Math.ceil(this.heightPx / 14);
    for (let i = 0; i < n; i++) {
      const s = scene.add.sprite(o.x, o.y - 4 - i * 14, 'props').setDepth(DEPTH.effects - 1).setVisible(false);
      if (scene.anims.exists(steamAnim)) s.play({ key: steamAnim, startFrame: i % 2 });
      const fw = s.frame.width;
      s.setScale(Math.min(1, 22 / Math.max(1, fw)));
      s.setAlpha(0.85);
      this.puffs.push(s);
    }
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.puffs.forEach((p) => p.destroy()));
  }

  /** Phase of the cycle: 'idle' | 'telegraph' | 'active'. */
  phaseAt(t: number): 'idle' | 'telegraph' | 'active' {
    const u = ((t % this.period) + this.period) % this.period;
    const activeStart = this.period - SteamVent.ACTIVE;
    if (u >= activeStart) return 'active';
    if (u >= activeStart - SteamVent.TELEGRAPH) return 'telegraph';
    return 'idle';
  }

  preUpdate(_time: number, delta: number): void {
    const prev = this.phaseAt(this.t);
    this.t += delta / 1000;
    const phase = this.phaseAt(this.t);
    const onScreen = Math.abs(this.ctx.player.x - this.x) < 320;
    if (phase !== prev && phase === 'active' && onScreen) this.ctx.sfx('steam');
    this.puffs.forEach((p, i) => {
      if (phase === 'active') {
        p.setVisible(true).setAlpha(0.85);
      } else if (phase === 'telegraph') {
        // a couple of small flickering puffs at the base
        p.setVisible(i < 1 || (i < 2 && Math.floor(this.t * 8) % 2 === 0)).setAlpha(0.6);
      } else {
        p.setVisible(false);
      }
    });
    if (phase !== 'active') return;
    const player = this.ctx.player;
    if (!player.isAlive()) return;
    if (!Phaser.Geom.Rectangle.Overlaps(this.zoneRect, playerRect(player))) return;
    if (this.lift) {
      if (player.body.velocity.y > -240) player.bounce(true, 430);
    } else {
      player.hurt({ amount: 1, fromX: this.x, kind: 'hazard' });
    }
  }
}

/** Builds a CTA train (front car + `cars` cars) as images; returns them and the total width. */
function buildTrain(scene: Phaser.Scene, cars: number, depth: number, dir: 1 | -1, tint?: number): { parts: Phaser.GameObjects.Image[]; width: number; height: number } {
  const parts: Phaser.GameObjects.Image[] = [];
  const carFrame = hasFrame(scene, 'platforms', 'train_car') ? scene.textures.getFrame('platforms', 'train_car') : null;
  const real = carFrame && carFrame.height > TILE_SIZE;
  const cw = real ? carFrame!.width : 128;
  const ch = real ? carFrame!.height : 40;
  let x = 0;
  for (let i = 0; i <= cars; i++) {
    const isFront = i === 0 && hasFrame(scene, 'platforms', 'train_front');
    const img = scene.add.image(0, 0, 'platforms', isFront ? 'train_front' : 'train_car').setOrigin(0, 1).setDepth(depth);
    const w = isFront && real ? img.frame.width : cw;
    img.setDisplaySize(w, ch);
    if (dir < 0) img.setFlipX(true);
    if (tint !== undefined) img.setTint(tint);
    img.setData('ox', x);
    x += w + 2;
    parts.push(img);
  }
  // Leading car first in the direction of travel.
  if (dir > 0) parts.forEach((p) => p.setData('ox', x - (p.getData('ox') as number) - p.displayWidth));
  return { parts, width: x, height: ch };
}

/**
 * passingTrain <tx> <ty> width=<lane tiles> height=3 interval=9 offset=0 dir=1 cars=4 hazard=false speed=420
 *
 * hazard=false: decoration — a train crosses BEHIND the tiles every `interval` seconds
 * (bottom of the train at the object's bottom).
 * hazard=true: the object's rectangle is a track lane. When the player is near, warning
 * lights blink for 1.5 s, then a train sweeps across the lane damaging the player.
 */
export class PassingTrain extends Phaser.GameObjects.Zone {
  static readonly TELEGRAPH_MS = 1500;
  private t: number;
  private readonly interval: number;
  private readonly hazard: boolean;
  private readonly dir: 1 | -1;
  private readonly cars: number;
  private readonly speed: number;
  private readonly lane: Phaser.Geom.Rectangle;
  private pmode: 'idle' | 'warning' | 'passing' = 'idle';
  private stateMs = 0;
  private train: { parts: Phaser.GameObjects.Image[]; width: number; height: number } | null = null;
  private trainX = 0;
  private readonly lights: Phaser.GameObjects.Sprite[] = [];

  constructor(
    readonly ctx: LevelContext,
    o: SpawnObject,
  ) {
    super(ctx.scene, o.x, o.y, Math.max(16, o.width), Math.max(16, o.height));
    ctx.scene.add.existing(this);
    this.hazard = bool(o, 'hazard', false);
    this.interval = num(o, 'interval', this.hazard ? 6 : 9);
    this.t = this.interval - num(o, 'offset', this.hazard ? 1 : 2);
    this.dir = num(o, 'dir', 1) < 0 ? -1 : 1;
    this.cars = num(o, 'cars', this.hazard ? 3 : 4);
    this.speed = num(o, 'speed', this.hazard ? 480 : 300);
    this.lane = new Phaser.Geom.Rectangle(o.x - o.width / 2, o.y - o.height, o.width, o.height);
    if (this.hazard) {
      const scene = ctx.scene;
      const anim = animKey('props', 'train_light');
      // Lights every ~14 tiles along the lane (at least at both ends), just above it.
      const n = Math.max(2, Math.round(this.lane.width / (14 * TILE_SIZE)) + 1);
      for (let i = 0; i < n; i++) {
        const lx = this.lane.left + 8 + ((this.lane.width - 16) * i) / (n - 1);
        const s = scene.add.sprite(lx, this.lane.top, 'props').setOrigin(0.5, 1).setDepth(DEPTH.props);
        if (scene.anims.exists(anim)) {
          s.play(anim);
          s.anims.pause();
        }
        s.setScale(Math.min(1, 16 / Math.max(1, s.frame.width)));
        s.setTint(0x666666);
        this.lights.push(s);
      }
      this.once(Phaser.GameObjects.Events.DESTROY, () => this.lights.forEach((l) => l.destroy()));
    }
  }

  private playerNear(): boolean {
    const p = this.ctx.player;
    if (!this.hazard) {
      const cam = this.ctx.scene.cameras.main.worldView;
      return this.lane.bottom > cam.top && this.lane.bottom - 60 < cam.bottom;
    }
    return p.x > this.lane.left - 120 && p.x < this.lane.right + 120 && p.y > this.lane.top - 120 && p.y < this.lane.bottom + 80;
  }

  preUpdate(_time: number, delta: number): void {
    this.stateMs += delta;
    switch (this.pmode) {
      case 'idle':
        this.t += delta / 1000;
        if (this.t >= this.interval && this.playerNear()) {
          this.t = 0;
          if (this.hazard) this.setState2('warning');
          else this.startTrain();
        }
        break;
      case 'warning': {
        const on = Math.floor(this.stateMs / 150) % 2 === 0;
        this.lights.forEach((l) => {
          l.setTint(on ? 0xffffff : 0x884444);
          if (l.anims.isPaused) l.anims.resume();
        });
        if (this.stateMs >= PassingTrain.TELEGRAPH_MS) this.startTrain();
        break;
      }
      case 'passing':
        this.moveTrain(delta);
        break;
    }
  }

  private setState2(s: PassingTrain['pmode']): void {
    if (s === 'warning') this.ctx.sfx('train-warning');
    this.pmode = s;
    this.stateMs = 0;
  }

  private startTrain(): void {
    const scene = this.ctx.scene;
    const cam = scene.cameras.main.worldView;
    const depth = this.hazard ? DEPTH.enemies + 2 : DEPTH.backgroundTiles - 5;
    this.train = buildTrain(scene, this.cars, depth, this.dir, this.hazard ? undefined : 0x8890a8);
    if (!this.hazard) this.train.parts.forEach((p) => p.setAlpha(0.95));
    // Start just off-screen (or at the lane start for a lane further away).
    const leftStart = Math.min(cam.left, this.lane.left) - this.train.width - 16;
    const rightStart = Math.max(cam.right, this.lane.right) + 16;
    this.trainX = this.dir > 0 ? leftStart : rightStart;
    if (!this.hazard) this.trainX = this.dir > 0 ? cam.left - this.train.width - 16 : cam.right + 16;
    this.pmode = 'passing';
    this.stateMs = 0;
    this.lights.forEach((l) => l.setTint(0xff5555));
    this.ctx.sfx(this.hazard ? 'train-horn' : 'train-pass');
    this.placeTrain();
  }

  private placeTrain(): void {
    if (!this.train) return;
    for (const p of this.train.parts) p.setPosition(Math.round(this.trainX + (p.getData('ox') as number)), this.lane.bottom);
  }

  private moveTrain(delta: number): void {
    if (!this.train) return;
    this.trainX += this.dir * this.speed * (delta / 1000);
    this.placeTrain();
    if (this.hazard) {
      const p = this.ctx.player;
      const r = new Phaser.Geom.Rectangle(this.trainX, this.lane.bottom - Math.min(this.train.height, this.lane.height), this.train.width, Math.min(this.train.height, this.lane.height));
      if (p.isAlive() && Phaser.Geom.Rectangle.Overlaps(r, playerRect(p))) {
        p.hurt({ amount: 1, fromX: p.x - this.dir * 10, kind: 'hazard' });
      }
      if (Math.abs(p.x - this.trainX) < 300) this.ctx.shake(0.002, 60);
    }
    const cam = this.ctx.scene.cameras.main.worldView;
    const end = this.hazard ? (this.dir > 0 ? Math.max(cam.right, this.lane.right) : Math.min(cam.left, this.lane.left) - this.train.width) : this.dir > 0 ? cam.right + 32 : cam.left - this.train.width - 32;
    const done = this.dir > 0 ? this.trainX > end + 16 : this.trainX < end - 16;
    if (done || this.stateMs > 12000) {
      this.train.parts.forEach((p) => p.destroy());
      this.train = null;
      this.lights.forEach((l) => {
        l.setTint(0x666666);
        l.anims.pause();
      });
      this.pmode = 'idle';
      this.stateMs = 0;
    }
  }
}

/** killZone <tx> <ty> width=.. height=.. — touching it is instant death (bottomless drops inside the map). */
export class KillZone extends Phaser.GameObjects.Zone {
  private readonly rect: Phaser.Geom.Rectangle;
  constructor(
    readonly ctx: LevelContext,
    o: SpawnObject,
  ) {
    super(ctx.scene, o.x, o.y, o.width, o.height);
    ctx.scene.add.existing(this);
    this.rect = new Phaser.Geom.Rectangle(o.x - o.width / 2, o.y - o.height, o.width, o.height);
  }
  preUpdate(): void {
    const p = this.ctx.player;
    if (p.isAlive() && Phaser.Geom.Rectangle.Overlaps(this.rect, playerRect(p))) p.die('pit');
  }
}
