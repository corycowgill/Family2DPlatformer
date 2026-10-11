import Phaser from 'phaser';
import { DEPTH } from '../config';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { Pickup } from './Collectible';
import { animKey } from '../systems/AnimationSystem';
import { bool, burst, ensureTexture, hasFrame, num, playerRect, str } from '../world/worldUtil';
import { prompt, type PromptText } from '../ui/Prompts';

/**
 * prop <tx> <ty> frame=lamp|hydrant|hotdog_cart|bench|flag_pole|... [front=true] [flip=true]
 * Decorative sprite from the `props` atlas, bottom-centre on its cell. Animated frames
 * (pigeon_idle, steam, train_light) play their animation.
 */
export function spawnProp(ctx: LevelContext, o: SpawnObject): void {
  const scene = ctx.scene;
  const frame = str(o, 'frame', 'lamp');
  const anim = animKey('props', frame);
  let s: Phaser.GameObjects.Sprite;
  if (scene.anims.exists(anim)) {
    s = scene.add.sprite(o.x, o.y, 'props');
    s.play(anim);
  } else {
    s = scene.add.sprite(o.x, o.y, 'props', hasFrame(scene, 'props', frame) ? frame : undefined);
  }
  s.setOrigin(0.5, 1);
  s.setDepth(bool(o, 'front', false) ? DEPTH.foreground + 1 : DEPTH.props - 1);
  if (bool(o, 'flip', false)) s.setFlipX(true);
  const scale = num(o, 'scale', 1);
  if (scale !== 1) s.setScale(scale);
}

const SIGN_TEX = 'world-sign';

/**
 * sign <tx> <ty> text="Hold {RUN} to jump farther"
 * A small tutorial sign; shows its text in a bubble while the player is close.
 * (Use `_` for spaces if the compiler's object line can't hold spaces.) Tokens such as
 * {JUMP} {RUN} {ABILITY} {MOVE} {CROUCH} render as the active device's button glyph
 * (ui/Prompts) and update live when the player switches keyboard / controller / touch.
 */
export class Sign extends Phaser.GameObjects.Image {
  private bubble: PromptText;
  private shown = false;
  constructor(
    readonly ctx: LevelContext,
    o: SpawnObject,
  ) {
    ensureTexture(ctx.scene, SIGN_TEX, 18, 22, (g) => {
      g.fillStyle(0x5b3a22).fillRect(8, 10, 3, 12);
      g.fillStyle(0x2f6fd6).fillRect(0, 0, 18, 12);
      g.lineStyle(1, 0xffffff).strokeRect(0.5, 0.5, 17, 11);
      g.fillStyle(0xffffff).fillRect(4, 4, 10, 1).fillRect(4, 7, 7, 1);
    });
    super(ctx.scene, o.x, o.y, SIGN_TEX);
    ctx.scene.add.existing(this);
    this.setOrigin(0.5, 1).setDepth(DEPTH.props);
    const text = str(o, 'text', '').replace(/_/g, ' ').replace(/\\n/g, '\n');
    this.bubble = prompt(ctx.scene, o.x, o.y - 30, text, { origin: [0.5, 1], bg: true, depth: DEPTH.foreground + 2 });
    this.bubble.setAlpha(0);
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.bubble.destroy());
  }

  preUpdate(): void {
    const near = this.ctx.players.some((p) => Math.abs(p.x - this.x) < 40 && Math.abs(p.y - this.y) < 48);
    if (near !== this.shown) {
      this.shown = near;
      this.scene.tweens.killTweensOf(this.bubble);
      this.scene.tweens.add({ targets: this.bubble, alpha: near ? 1 : 0, y: this.y - (near ? 32 : 28), duration: 160 });
    }
  }
}

/**
 * pigeons <tx> <ty> count=4 width=4 — ambient pigeons that peck around and fly off
 * when the player gets close. Pure decoration (the `pigeon` ENEMY is separate).
 */
export class PigeonFlock extends Phaser.GameObjects.Zone {
  private birds: Phaser.GameObjects.Sprite[] = [];
  private scattered = false;
  constructor(
    readonly ctx: LevelContext,
    o: SpawnObject,
  ) {
    super(ctx.scene, o.x, o.y, o.width, 16);
    ctx.scene.add.existing(this);
    const scene = ctx.scene;
    const count = num(o, 'count', 4);
    const w = Math.max(o.width, count * 10);
    const idle = animKey('props', 'pigeon_idle');
    for (let i = 0; i < count; i++) {
      const bx = o.x - w / 2 + (w * (i + 0.5)) / count + Phaser.Math.Between(-3, 3);
      const b = scene.add.sprite(bx, o.y, 'props').setOrigin(0.5, 1).setDepth(DEPTH.props + 1);
      if (scene.anims.exists(idle)) b.play({ key: idle, startFrame: i % 2, delay: i * 130 });
      if (b.frame.width >= 32 && !hasFrame(scene, 'props', 'pigeon_idle_0')) b.setScale(0.4);
      else if (b.frame.width >= 32) b.setScale(0.5);
      b.setFlipX(i % 2 === 0);
      this.birds.push(b);
    }
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.birds.forEach((b) => b.destroy()));
  }

  preUpdate(): void {
    if (this.scattered) return;
    const p = this.ctx.players.find((pl) => Math.abs(pl.x - this.x) <= 56 + this.width / 2 && Math.abs(pl.y - this.y) <= 64);
    if (!p) return;
    this.scattered = true;
    this.ctx.sfx('pigeon-flap');
    const fly = animKey('props', 'pigeon_fly');
    this.birds.forEach((b, i) => {
      if (this.scene.anims.exists(fly)) b.play(fly);
      const away = Math.sign(b.x - p.x) || 1;
      b.setFlipX(away > 0);
      this.scene.tweens.add({
        targets: b,
        x: b.x + away * Phaser.Math.Between(120, 220),
        y: b.y - Phaser.Math.Between(110, 170),
        delay: i * 60,
        duration: 1300,
        ease: 'Quad.easeIn',
        onComplete: () => b.destroy(),
      });
    });
  }
}

/**
 * trashCan <tx> <ty> [contents=coin] — breakable by attacks, projectiles or a stomp; drops a coin.
 */
export class TrashCan extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  private broken = false;
  private readonly contents: string;
  constructor(
    readonly ctx: LevelContext,
    o: SpawnObject,
  ) {
    super(ctx.scene, o.x, o.y, 'props', 'trash_can');
    ctx.scene.add.existing(this);
    ctx.scene.physics.add.existing(this);
    this.setOrigin(0.5, 1).setDepth(DEPTH.props + 1);
    this.body.setAllowGravity(false);
    this.body.setImmovable(true);
    const bw = Math.min(14, this.width);
    const bh = Math.min(18, this.height);
    this.body.setSize(bw, bh);
    this.body.setOffset((this.width - bw) / 2, this.height - bh);
    this.contents = str(o, 'contents', 'coin');
    ctx.scene.physics.add.overlap(ctx.groups.playerProjectiles, this, (a, b) => {
      const proj = (a === this ? b : a) as Phaser.GameObjects.GameObject & { onHitEnemy?: () => void };
      if (this.broken) return;
      this.smash();
      proj.onHitEnemy?.();
    });
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (this.broken) return;
    for (const p of this.ctx.players) {
      if (this.broken) return;
      if (!p.isAlive()) continue;
      const pr = playerRect(p);
      const r = new Phaser.Geom.Rectangle(this.body.left, this.body.top, this.body.width, this.body.height);
      if (!Phaser.Geom.Rectangle.Overlaps(pr, r)) continue;
      const pb = p.body;
      const stomp = pb.velocity.y > 0 && pb.prev.y + pb.height <= this.body.top + 8;
      if (stomp) {
        p.bounce(p.lastInput.jump);
        this.smash();
      } else if (p.attacking) {
        this.smash();
      }
    }
  }

  smash(): void {
    if (this.broken) return;
    this.broken = true;
    this.body.enable = false;
    this.ctx.sfx('crash');
    if (hasFrame(this.scene, 'props', 'trash_can_broken')) this.setFrame('trash_can_broken');
    else this.setAlpha(0.5);
    const paper = ensureTexture(this.scene, 'world-paper', 5, 4, (g) => g.fillStyle(0xe8e4d8).fillRect(0, 0, 5, 4));
    burst(this.scene, this.x, this.y - 12, paper, [undefined], 5, { spread: 20, up: 24 });
    if (this.contents !== 'none') {
      const kind = this.contents === 'hotdog' ? 'hotdog' : 'coin';
      const c = new Pickup(this.ctx, this.x, this.y - 22, kind, 0, true);
      c.body.setVelocity(Phaser.Math.Between(-30, 30), -200);
    }
  }
}

/** newspapers <tx> <ty> — a pile of papers that scatters when run through. */
export class Newspapers extends Phaser.GameObjects.Image {
  private rearmAt = 0;
  constructor(
    readonly ctx: LevelContext,
    o: SpawnObject,
  ) {
    const tex = ensureTexture(ctx.scene, 'world-papers', 14, 5, (g) => {
      g.fillStyle(0xd9d4c4).fillRect(0, 1, 14, 4);
      g.fillStyle(0xf1eee6).fillRect(2, 0, 9, 3);
      g.fillStyle(0x777777).fillRect(3, 1, 6, 1);
    });
    super(ctx.scene, o.x, o.y, tex);
    ctx.scene.add.existing(this);
    this.setOrigin(0.5, 1).setDepth(DEPTH.props);
  }
  preUpdate(): void {
    const now = this.ctx.now();
    if (now < this.rearmAt) return;
    if (this.ctx.players.some((p) => Math.abs(p.x - this.x) < 10 && Math.abs(p.y - this.y) < 6 && Math.abs(p.body.velocity.x) > 20)) {
      this.rearmAt = now + 3000;
      const paper = ensureTexture(this.scene, 'world-paper', 5, 4, (g) => g.fillStyle(0xe8e4d8).fillRect(0, 0, 5, 4));
      burst(this.scene, this.x, this.y - 4, paper, [undefined], 6, { spread: 26, up: 22, duration: 900 });
      this.ctx.sfx('paper');
      this.setAlpha(0.4);
      this.scene.time.delayedCall(2600, () => this.active && this.setAlpha(1));
    }
  }
}

