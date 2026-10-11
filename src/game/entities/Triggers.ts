import Phaser from 'phaser';
import { DEPTH } from '../config';
import { EV } from '../types';
import type { LevelContext, SpawnObject, Trigger } from '../world/LevelContext';

/** Base for static overlap zones/sprites the player can touch. */
export abstract class TriggerSprite extends Phaser.Physics.Arcade.Sprite implements Trigger {
  declare body: Phaser.Physics.Arcade.Body;
  constructor(ctx: LevelContext, x: number, y: number, texture: string, frame: string) {
    super(ctx.scene, x, y, texture, frame);
    ctx.scene.add.existing(this);
    ctx.groups.triggers.add(this);
    ctx.scene.physics.add.existing(this);
    this.body.setAllowGravity(false);
    this.body.setImmovable(true);
    this.setOrigin(0.5, 1);
    this.setDepth(DEPTH.props);
  }
  abstract onPlayerOverlap(ctx: LevelContext): void;
}

/** Chicago-flag checkpoint. `index` property orders checkpoints within a level. */
export class Checkpoint extends TriggerSprite {
  activated = false;
  readonly index: number;
  constructor(ctx: LevelContext, obj: SpawnObject) {
    super(ctx, obj.x, obj.y, 'items', 'checkpoint_off');
    this.index = Number(obj.props.index ?? 0);
    this.body.setSize(16, 40);
    this.body.setOffset((this.width - 16) / 2, this.height - 40);
  }
  /** Mark as already reached (restoring from a respawn). */
  setReached(): void {
    this.activated = true;
    this.setFrame('checkpoint_on');
  }
  onPlayerOverlap(ctx: LevelContext): void {
    if (this.activated || !ctx.player.isAlive()) return;
    this.setReached();
    ctx.sfx('checkpoint');
    ctx.effect('spark', this.x, this.y - this.height);
    ctx.player.heal(ctx.player.maxHealth);
    ctx.events.emit(EV.CHECKPOINT, this.index, this.x, this.y);
  }
}

/** End-of-level Chicago flag gate (`flag=w`: the ballpark W flag variant, World 2). */
export class Goal extends TriggerSprite {
  private reached = false;
  constructor(ctx: LevelContext, obj: SpawnObject) {
    const w = obj.props.flag === 'w' && ctx.scene.textures.get('items').has('goal_pole_w');
    super(ctx, obj.x, obj.y, 'items', w ? 'goal_pole_w' : 'goal_pole');
    this.body.setSize(12, Math.max(48, this.height));
    this.body.setOffset((this.width - 12) / 2, this.height - Math.max(48, this.height));
  }
  onPlayerOverlap(ctx: LevelContext): void {
    if (this.reached || !ctx.player.isAlive()) return;
    this.reached = true;
    ctx.sfx('goal');
    ctx.events.emit(EV.LEVEL_COMPLETE);
  }
}
