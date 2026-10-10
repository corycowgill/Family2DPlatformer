import Phaser from 'phaser';
import { DEPTH, TILE_SIZE } from '../config';
import type { PickupKind } from '../types';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { Pickup } from './Collectible';
import type { Enemy } from './Enemy';
import { playAnim } from '../systems/AnimationSystem';
import { burst, hasFrame, str } from '../world/worldUtil';

/**
 * `block` objects: `?` question blocks and breakable bricks.
 *
 *   block <tx> <ty> kind=question|brick contents=coin|coins5|hotdog|pizza|ctaPass|star|oneUp
 *
 * Blocks are static Arcade bodies in a per-level group with their own colliders (player,
 * enemies, pickups). Hitting one from below "bumps" it: question blocks pop their
 * contents and turn into used blocks; plain bricks break. Enemies (and coins) standing on
 * a bumped block are hit/collected.
 */

export type BlockContents = PickupKind | 'coins5' | 'none';

interface BlockSystem {
  group: Phaser.Physics.Arcade.StaticGroup;
  candidates: Block[];
}
const systems = new WeakMap<LevelContext, BlockSystem>();

function blockSystem(ctx: LevelContext): BlockSystem {
  let sys = systems.get(ctx);
  if (sys) return sys;
  const scene = ctx.scene;
  const group = scene.physics.add.staticGroup();
  const s: BlockSystem = { group, candidates: [] };
  systems.set(ctx, s);
  const player = ctx.player;
  scene.physics.add.collider(player, group, (_p, blk) => {
    const b = blk as Block;
    const pb = player.body;
    if (!player.isAlive()) return;
    if ((pb.blocked.up || pb.touching.up) && b.body.bottom <= pb.top + 3) s.candidates.push(b);
  });
  scene.physics.add.collider(ctx.groups.enemies, group);
  scene.physics.add.collider(ctx.groups.pickups, group);
  // Resolve once per frame: only the block nearest the player's head gets bumped.
  const resolve = () => {
    if (!s.candidates.length) return;
    const px = player.body.center.x;
    let best: Block | null = null;
    for (const c of s.candidates) if (c.active && (!best || Math.abs(c.x - px) < Math.abs(best.x - px))) best = c;
    s.candidates.length = 0;
    best?.bump();
  };
  scene.events.on(Phaser.Scenes.Events.POST_UPDATE, resolve);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.POST_UPDATE, resolve));
  return s;
}

export class Block extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.StaticBody;
  readonly kind: 'question' | 'brick';
  private contents: BlockContents;
  private coinsLeft: number;
  private used = false;
  private bumpReadyAt = 0;
  private readonly homeY: number;

  constructor(
    readonly ctx: LevelContext,
    o: SpawnObject,
  ) {
    // Object (tx,ty) is a 16x16 cell; centre the block in it.
    const kind = str(o, 'kind', 'question') === 'brick' ? 'brick' : 'question';
    super(ctx.scene, o.x, o.y - TILE_SIZE / 2, 'items', kind === 'brick' ? 'brick' : hasFrame(ctx.scene, 'items', 'question_0') ? 'question_0' : 'block_used');
    this.kind = kind;
    this.contents = str(o, 'contents', kind === 'question' ? 'coin' : 'none') as BlockContents;
    this.coinsLeft = this.contents === 'coins5' ? 5 : 1;
    this.homeY = this.y;
    ctx.scene.add.existing(this);
    this.setDisplaySize(TILE_SIZE, TILE_SIZE);
    blockSystem(ctx).group.add(this);
    this.refreshBody();
    this.setDepth(DEPTH.ground + 1);
    if (kind === 'question') {
      playAnim(this, 'question');
      this.setDisplaySize(TILE_SIZE, TILE_SIZE);
    }
  }

  /** Hit from below. */
  bump(): void {
    const now = this.ctx.now();
    if (now < this.bumpReadyAt || !this.active) return;
    this.bumpReadyAt = now + 220;
    this.hitThingsOnTop();
    if (this.used) {
      this.ctx.sfx('bump');
      return;
    }
    if (this.kind === 'brick' && this.contents === 'none') {
      this.breakApart();
      return;
    }
    this.ctx.sfx('bump');
    this.wobble();
    this.release();
  }

  private wobble(): void {
    this.scene.tweens.killTweensOf(this);
    this.y = this.homeY;
    this.scene.tweens.add({ targets: this, y: this.homeY - 5, duration: 70, yoyo: true, ease: 'Quad.easeOut' });
  }

  private release(): void {
    const ctx = this.ctx;
    const top = this.body.top;
    const c = this.contents;
    if (c === 'coin' || c === 'coins5') {
      const coin = new Pickup(ctx, this.x, top - 8, 'coin');
      coin.collect(ctx);
      this.coinsLeft--;
    } else if (c !== 'none') {
      const item = new Pickup(ctx, this.x, top - 2, c, 0, true);
      // Pop up, then slide off toward the player so it never strands on top of a block row.
      const dir = Math.sign(ctx.player.x - this.x) || 1;
      item.body.setVelocity(dir * 70, -170);
      item.body.setDragX(35);
      item.setDepth(DEPTH.pickups);
      // Appear from inside the block.
      item.setScale(0.4);
      this.scene.tweens.add({ targets: item, scale: 1, duration: 160 });
      ctx.sfx('powerup-appear');
      this.coinsLeft = 0;
    } else {
      this.coinsLeft = 0;
    }
    if (this.coinsLeft <= 0) {
      this.used = true;
      this.anims.stop();
      this.setFrame('block_used');
      this.setDisplaySize(TILE_SIZE, TILE_SIZE);
    }
  }

  private breakApart(): void {
    const ctx = this.ctx;
    ctx.sfx('brick-break');
    const frames = ['debris_0', 'debris_1'].filter((f) => hasFrame(this.scene, 'effects', f));
    if (frames.length) burst(this.scene, this.x, this.y, 'effects', frames, 4, { spread: 24, up: 30 });
    else burst(this.scene, this.x, this.y, 'items', ['brick'], 4, { spread: 24, up: 30 });
    this.destroy();
  }

  /** Enemies standing on top get hit; coins resting on top get collected. */
  private hitThingsOnTop(): void {
    const top = this.body.top;
    const left = this.body.left - 2;
    const right = this.body.right + 2;
    for (const e of this.ctx.groups.enemies.getChildren() as Enemy[]) {
      const b = e.body;
      if (!b || e.dead || !e.active) continue;
      if (b.bottom >= top - 5 && b.bottom <= top + 3 && b.right > left && b.left < right) {
        e.takeHit({ amount: 1, fromX: this.x, kind: 'melee' });
        if (e.active && !e.dead && e.body) e.body.setVelocityY(-180);
      }
    }
    for (const p of this.ctx.groups.pickups.getChildren() as Pickup[]) {
      if (!(p instanceof Pickup) || p.kind !== 'coin' || !p.body?.enable) continue;
      if (p.y >= top - 20 && p.y <= top && p.x > left && p.x < right) p.collect(this.ctx);
    }
  }
}
