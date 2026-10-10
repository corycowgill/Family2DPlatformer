import Phaser from 'phaser';
import { DEPTH, PHYSICS, TILE_SIZE } from '../config';
import { TILE, TILESET_KEY } from '../data/tiles';
import type { LevelContext, SpawnObject, Trigger } from '../world/LevelContext';
import { bool, hasFrame, isStandingOn, num, onPostUpdate, str, tileFrame } from '../world/worldUtil';

/**
 * Moving / falling / train platforms and bounce pads.
 *
 * Platforms are invisible Arcade Zones in `ctx.groups.platforms` (immovable, no gravity)
 * moved BY VELOCITY, so Arcade carries riders horizontally. Visuals are separate
 * images synced to the body after the physics step.
 */

export type PlatformStyle = 'girder' | 'plank' | 'scaffold' | 'train' | 'boat';

const STYLE_TILE: Record<PlatformStyle, number> = {
  girder: TILE.GIRDER_TOP,
  plank: TILE.WOOD_PLANK,
  scaffold: TILE.SCAFFOLD_PLANK,
  train: TILE.STEEL_BLOCK,
  boat: TILE.WOOD_PLANK,
};

type Visual = Phaser.GameObjects.Image | Phaser.GameObjects.TileSprite;

/** Builds a `wTiles`-wide platform visual from the platforms atlas (or tileset fallback). */
export function platformVisual(scene: Phaser.Scene, style: PlatformStyle, wTiles: number): Visual {
  const w = wTiles * TILE_SIZE;
  if (style === 'boat' && hasFrame(scene, 'platforms', 'boat')) {
    // Single boat image stretched to the platform width; deck at the top of the frame.
    const img = scene.add.image(0, 0, 'platforms', 'boat').setOrigin(0, 0);
    const f = img.frame;
    img.setDisplaySize(w, f.height > TILE_SIZE ? Math.round((f.height * w) / f.width) : TILE_SIZE);
    return img;
  }
  const exact = `${style}_${wTiles}`;
  if (hasFrame(scene, 'platforms', exact)) {
    const f = scene.textures.getFrame('platforms', exact);
    if (f.width === w) return scene.add.image(0, 0, 'platforms', exact).setOrigin(0, 0);
    return scene.add.tileSprite(0, 0, w, TILE_SIZE, 'platforms', exact).setOrigin(0, 0);
  }
  for (const n of [2, 3, 4]) {
    const f = `${style}_${n}`;
    if (hasFrame(scene, 'platforms', f)) return scene.add.tileSprite(0, 0, w, TILE_SIZE, 'platforms', f).setOrigin(0, 0);
  }
  return scene.add.tileSprite(0, 0, w, TILE_SIZE, TILESET_KEY, tileFrame(scene, STYLE_TILE[style] ?? TILE.STEEL_BLOCK)).setOrigin(0, 0);
}

/** Base: an immovable zone body + visuals that follow it. */
export class PlatformBase extends Phaser.GameObjects.Zone {
  declare body: Phaser.Physics.Arcade.Body;
  protected visuals: { obj: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject; ox: number; oy: number }[] = [];
  /** Visual-only offset (shaking). */
  protected jitter = { x: 0, y: 0 };

  constructor(
    readonly ctx: LevelContext,
    x: number,
    y: number,
    w: number,
    h: number,
    readonly oneWay: boolean,
  ) {
    super(ctx.scene, x, y, w, h);
    this.setOrigin(0, 0);
    ctx.scene.add.existing(this);
    ctx.scene.physics.add.existing(this);
    ctx.groups.platforms.add(this);
    const b = this.body;
    b.setAllowGravity(false);
    b.setImmovable(true);
    b.setVelocity(0, 0);
    b.pushable = false;
    if (oneWay) {
      this.setData('oneWay', true);
      b.checkCollision.down = false;
      b.checkCollision.left = false;
      b.checkCollision.right = false;
    }
    onPostUpdate(ctx, this, () => this.syncVisuals());
    this.last.set(x, y);
    const world = ctx.scene.physics.world;
    world.on(Phaser.Physics.Arcade.Events.WORLD_STEP, this.onWorldStep);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      world.off(Phaser.Physics.Arcade.Events.WORLD_STEP, this.onWorldStep);
      this.visuals.forEach((v) => v.obj.destroy());
    });
  }

  protected readonly last = new Phaser.Math.Vector2();
  private riding = false;

  /**
   * After every physics step: carry the rider by the platform's displacement (Arcade only
   * does this on frames with overlap, which drops riders), keep them glued to the top and
   * report them as grounded. Then let the subclass choose the next step's velocity.
   */
  private onWorldStep = (delta: number): void => {
    const b = this.body;
    if (!b || !this.active) return;
    const dx = b.x - this.last.x;
    const dy = b.y - this.last.y;
    const p = this.ctx.player;
    if (this.riding && b.enable && p.body?.enable && p.isAlive() && this.notLeaving()) {
      const pb = p.body;
      pb.x += dx;
      if (dy !== 0 || pb.bottom > b.top) pb.y = b.top - pb.height;
      pb.blocked.down = true;
    }
    this.last.set(b.x, b.y);
    const pb = p.body;
    this.riding =
      b.enable && !!pb?.enable && p.isAlive() && this.notLeaving() && Math.abs(pb.bottom - b.top) <= 4 && pb.right > b.left + 1 && pb.left < b.right - 1;
    this.step(delta);
  };

  /** The player isn't jumping off (a platform rising into the player may give it a small upward velocity). */
  private notLeaving(): boolean {
    const p = this.ctx.player;
    return p.body.velocity.y >= -1 || (!p.motor.jumping && p.body.velocity.y > -200);
  }

  /** Subclasses set the velocity for the next physics step here. */
  protected step(_delta: number): void {}

  addVisual(obj: Visual, ox = 0, oy = 0): void {
    obj.setDepth(DEPTH.platforms);
    this.visuals.push({ obj, ox, oy });
    this.syncVisuals();
  }

  protected syncVisuals(): void {
    const b = this.body;
    if (!b) return;
    for (const v of this.visuals) v.obj.setPosition(Math.round(b.x + v.ox + this.jitter.x), Math.round(b.y + v.oy + this.jitter.y));
  }

  /** True while the player stands on this platform. */
  hasRider(): boolean {
    return this.body.enable && isStandingOn(this.ctx.player, this.body);
  }
}

/**
 * Smooth ping-pong position in 0..1 for time `t` (s). `pause` holds at each end.
 * Exported for tests and the reachability checker's mental model.
 */
export function pingPong(t: number, period: number, phase = 0, pause = 0): number {
  const p = Math.max(0.1, period);
  let u = (((t / p + phase) % 1) + 1) % 1; // 0..1 over a full there-and-back cycle
  const half = p / 2;
  const hold = Math.min(pause, half * 0.9);
  const move = half - hold;
  let s = u * p; // seconds into the cycle
  let forward = true;
  if (s >= half) {
    s -= half;
    forward = false;
  }
  const k = s < hold ? 0 : (s - hold) / move;
  const eased = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, k));
  u = forward ? eased : 1 - eased;
  return u;
}

/**
 * movingPlatform <tx> <ty> width=3 dx=6 dy=0 period=4 style=girder phase=0 oneWay=true pause=0
 * Travels from its spawn position by (dx, dy) tiles and back.
 */
export class MovingPlatform extends PlatformBase {
  protected t = 0;
  readonly home: Phaser.Math.Vector2;
  readonly travel: Phaser.Math.Vector2;

  constructor(
    ctx: LevelContext,
    o: SpawnObject,
    opts: { w: number; h: number; style: PlatformStyle; withVisual?: boolean } = {
      w: num(o, 'width', 3) * TILE_SIZE,
      h: TILE_SIZE,
      style: str(o, 'style', 'girder') as PlatformStyle,
    },
  ) {
    const left = o.x - o.width / 2;
    const top = o.y - TILE_SIZE;
    super(ctx, left, top, opts.w, opts.h, bool(o, 'oneWay', true));
    this.home = new Phaser.Math.Vector2(left, top);
    this.travel = new Phaser.Math.Vector2(num(o, 'dx', 0) * TILE_SIZE, num(o, 'dy', 0) * TILE_SIZE);
    this.period = num(o, 'period', 4);
    this.phase = num(o, 'phase', 0);
    this.pause = num(o, 'pause', 0);
    if (opts.withVisual !== false) this.addVisual(platformVisual(ctx.scene, opts.style, Math.round(opts.w / TILE_SIZE)));
    // Start at the phase position.
    const p = this.pathAt(0);
    this.body.reset(p.x, p.y);
    this.last.set(p.x, p.y);
    this.drive(0);
  }

  period: number;
  phase: number;
  pause: number;

  pathAt(t: number): Phaser.Math.Vector2 {
    const f = pingPong(t, this.period, this.phase, this.pause);
    return new Phaser.Math.Vector2(this.home.x + this.travel.x * f, this.home.y + this.travel.y * f);
  }

  protected step(delta: number): void {
    this.drive(delta);
  }

  /** Called after every physics step: set the velocity that lands exactly on the path next step. */
  protected drive(stepDelta?: number): void {
    if (!this.body || !this.active) return;
    const dt = 1 / this.ctx.scene.physics.world.fps;
    this.t += stepDelta === undefined ? dt : stepDelta;
    const target = this.pathAt(this.t + dt);
    this.body.setVelocity((target.x - this.body.x) / dt, (target.y - this.body.y) / dt);
  }
}

/** trainPlatform <tx> <ty> width=8 dx=30 period=14 pause=2 — a CTA car riding the elevated track. */
export class TrainPlatform extends MovingPlatform {
  constructor(ctx: LevelContext, o: SpawnObject) {
    const wTiles = num(o, 'width', 8);
    super(ctx, { ...o, props: { pause: 1.5, period: 12, ...o.props } }, { w: wTiles * TILE_SIZE, h: 12, style: 'train', withVisual: false });
    const scene = ctx.scene;
    const w = wTiles * TILE_SIZE;
    if (hasFrame(scene, 'platforms', 'train_car')) {
      const f = scene.textures.getFrame('platforms', 'train_car');
      const img = scene.add.image(0, 0, 'platforms', 'train_car').setOrigin(0, 0);
      const h = f.height > TILE_SIZE ? Math.round((f.height * w) / f.width) : 40;
      img.setDisplaySize(w, h);
      this.addVisual(img, 0, -2);
      if (f.height <= TILE_SIZE) {
        // Placeholder art: add a simple window band so it reads as a train car.
        const g = scene.add.tileSprite(0, 0, w - 8, 8, TILESET_KEY, tileFrame(scene, TILE.GLASS));
        this.addVisual(g, 4, 10);
      }
    } else {
      this.addVisual(platformVisual(scene, 'train', wTiles));
    }
  }
}

/**
 * fallingPlatform / collapsingScaffold <tx> <ty> width=2 style=plank|scaffold respawn=4
 * Shakes 0.5 s after being stood on, then falls; respawns after `respawn` seconds.
 */
export class FallingPlatform extends PlatformBase {
  private pmode: 'idle' | 'shaking' | 'falling' | 'gone' = 'idle';
  private timer = 0;
  private readonly home: Phaser.Math.Vector2;
  private readonly respawnMs: number;

  constructor(ctx: LevelContext, o: SpawnObject, defaultStyle: PlatformStyle) {
    const w = num(o, 'width', 2) * TILE_SIZE;
    const left = o.x - o.width / 2;
    const top = o.y - TILE_SIZE;
    super(ctx, left, top, w, TILE_SIZE, bool(o, 'oneWay', true));
    this.home = new Phaser.Math.Vector2(left, top);
    this.respawnMs = num(o, 'respawn', 4) * 1000;
    const style = str(o, 'style', defaultStyle) as PlatformStyle;
    this.addVisual(platformVisual(ctx.scene, style, Math.round(w / TILE_SIZE)));
    if (style === 'scaffold') {
      // Scaffold frame hanging below so it reads as "construction".
      const frame = ctx.scene.add.tileSprite(0, 0, w, TILE_SIZE, TILESET_KEY, tileFrame(ctx.scene, TILE.SCAFFOLD_FRAME)).setAlpha(0.9);
      this.addVisual(frame, 0, TILE_SIZE);
    }
  }

  preUpdate(_time: number, delta: number): void {
    this.timer += delta;
    switch (this.pmode) {
      case 'idle':
        if (this.hasRider()) this.setState2('shaking');
        break;
      case 'shaking':
        this.jitter.x = Math.round(Math.sin(this.timer * 0.12) * 1.5);
        if (this.timer >= 500) {
          this.jitter.x = 0;
          this.setState2('falling');
          this.ctx.sfx('crumble');
        }
        break;
      case 'falling': {
        const vy = Math.min(320, this.body.velocity.y + 900 * (delta / 1000));
        this.body.setVelocity(0, vy);
        this.visuals.forEach((v) => (v.obj as unknown as Phaser.GameObjects.Components.Alpha).setAlpha?.(Math.max(0, 1 - this.timer / 1400)));
        if (this.timer > 1400) {
          this.body.enable = false;
          this.body.setVelocity(0, 0);
          this.setVisible(false);
          this.setState2('gone');
        }
        break;
      }
      case 'gone':
        if (this.timer >= this.respawnMs - 1400) this.tryRespawn();
        break;
    }
  }

  private setState2(s: FallingPlatform['pmode']): void {
    this.pmode = s;
    this.timer = 0;
  }

  private tryRespawn(): void {
    const p = this.ctx.player.body;
    const r = new Phaser.Geom.Rectangle(this.home.x, this.home.y - 4, this.width, this.height + 8);
    if (Phaser.Geom.Rectangle.Overlaps(r, new Phaser.Geom.Rectangle(p.left, p.top, p.width, p.height))) return;
    this.body.enable = true;
    this.body.reset(this.home.x, this.home.y);
    this.body.setVelocity(0, 0);
    this.setVisible(true);
    this.visuals.forEach((v) => {
      const a = v.obj as unknown as Phaser.GameObjects.Components.Alpha;
      a.setAlpha?.(0);
      this.scene.tweens.add({ targets: v.obj, alpha: 1, duration: 300 });
    });
    this.syncVisuals();
    this.setState2('idle');
  }
}

/** bouncePad <tx> <ty> [power=560] — springboard that launches the player when landed on. */
export class BouncePad extends Phaser.Physics.Arcade.Sprite implements Trigger {
  declare body: Phaser.Physics.Arcade.Body;
  private cooldownUntil = 0;
  private readonly power: number;

  constructor(ctx: LevelContext, o: SpawnObject) {
    super(ctx.scene, o.x, o.y, 'items', 'bounce_pad_0');
    ctx.scene.add.existing(this);
    ctx.scene.physics.add.existing(this);
    ctx.groups.triggers.add(this);
    this.body.setAllowGravity(false);
    this.body.setImmovable(true);
    this.setOrigin(0.5, 1);
    this.setDepth(DEPTH.props + 1);
    this.body.setSize(14, 8);
    this.body.setOffset((this.width - 14) / 2, this.height - 8);
    this.power = num(o, 'power', -PHYSICS.bouncePadVelocity);
  }

  onPlayerOverlap(ctx: LevelContext): void {
    const p = ctx.player;
    const now = ctx.now();
    if (now < this.cooldownUntil || !p.isAlive()) return;
    const b = p.body;
    const descending = b.velocity.y > 0 || b.y > b.prev.y + 0.01;
    if (!descending || b.bottom > this.body.bottom + 2) return;
    this.cooldownUntil = now + 250;
    p.bounce(true, this.power);
    ctx.sfx('bounce');
    if (hasFrame(this.scene, 'items', 'bounce_pad_1')) {
      this.setFrame('bounce_pad_1');
      this.scene.time.delayedCall(180, () => this.active && this.setFrame('bounce_pad_0'));
    }
    this.setScale(1.15, 0.8);
    this.scene.tweens.add({ targets: this, scaleX: 1, scaleY: 1, duration: 200, ease: 'Back.easeOut' });
  }
}
