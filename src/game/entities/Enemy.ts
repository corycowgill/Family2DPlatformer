import Phaser from 'phaser';
import { DEPTH } from '../config';
import { EV, type EnemyKind, type HitInfo } from '../types';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { playAnim } from '../systems/AnimationSystem';
import { ensureEnemyPlaceholder } from '../systems/PlaceholderArt';

export interface EnemyConfig {
  kind: EnemyKind;
  hp: number;
  /** Damage dealt to the player on contact. */
  contactDamage: number;
  /** Can be defeated / damaged by jumping on it. */
  stompable: boolean;
  /** If false, stomping bounces the player but deals no damage (e.g. spiky / armored on top). */
  stompDamages?: boolean;
  /** Physics body size (px) — keep a little smaller than the sprite. */
  body: { width: number; height: number };
  /** Affected by gravity (false for flyers). */
  gravity: boolean;
  /** Score/coins awarded when defeated. */
  coins?: number;
  /** Texture atlas key (defaults to kind). */
  atlas?: string;
  /** Placeholder frame size if atlas missing. */
  frameSize?: { w: number; h: number };
}

/**
 * Base enemy. Subclasses implement `think(dt)` (AI state machine) and may override
 * hooks. Enemies are bottom-centre anchored like players.
 */
export abstract class Enemy extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  readonly cfg: EnemyConfig;
  hp: number;
  dead = false;
  facing: 1 | -1 = -1;
  /** Timestamp (level ms) until which the enemy ignores further hits. */
  protected invulnUntil = 0;
  /** AI state name, for debugging and tests. */
  aiState = 'idle';
  /** ms spent in the current aiState. */
  protected stateTime = 0;

  constructor(
    readonly ctx: LevelContext,
    readonly spawn: SpawnObject,
    cfg: EnemyConfig,
  ) {
    const atlas = cfg.atlas ?? cfg.kind;
    if (!ctx.scene.textures.exists(atlas)) {
      ensureEnemyPlaceholder(ctx.scene, atlas, cfg.frameSize?.w ?? 32, cfg.frameSize?.h ?? 32);
    }
    super(ctx.scene, spawn.x, spawn.y, atlas);
    this.cfg = cfg;
    this.hp = cfg.hp;
    ctx.scene.add.existing(this);
    ctx.groups.enemies.add(this);
    ctx.scene.physics.add.existing(this);
    this.setOrigin(0.5, 1);
    this.setDepth(DEPTH.enemies);
    const b = this.body;
    b.setAllowGravity(cfg.gravity);
    b.setSize(cfg.body.width, cfg.body.height);
    this.syncBodyOffset();
    if (spawn.props.facing === 'right') this.facing = 1;
    playAnim(this, 'idle');
  }

  /** Keep the body anchored to the bottom-centre of the frame. */
  protected syncBodyOffset(): void {
    const b = this.body;
    b.setOffset((this.width - b.width) / 2, this.height - b.height);
  }

  setAI(state: string): this {
    if (this.aiState !== state) {
      this.aiState = state;
      this.stateTime = 0;
    }
    return this;
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (this.dead) return;
    this.stateTime += delta;
    // Despawn if it fell out of the world.
    if (this.y > this.ctx.map.heightInPixels + 64) {
      this.destroy();
      return;
    }
    // Only think when near the camera (cheap culling).
    const cam = this.ctx.scene.cameras.main;
    const margin = 160;
    if (this.x < cam.worldView.left - margin || this.x > cam.worldView.right + margin) {
      if (this.cfg.gravity) this.body.setVelocityX(0);
      else this.body.setVelocity(0, 0);
      return;
    }
    this.think(delta);
    this.setFlipX(this.facing === 1);
  }

  /** AI per frame. */
  protected abstract think(dtMs: number): void;

  /** Player landed on top. Default: take 1 damage if stompDamages !== false. */
  onStomp(): void {
    if (this.cfg.stompDamages === false) {
      this.ctx.sfx('bump');
      return;
    }
    this.takeHit({ amount: 1, fromX: this.ctx.player.x, kind: 'stomp' });
  }

  /** Can the player currently hurt this enemy by touching it from the side (e.g. while dashing)? */
  isVulnerableTo(hit: HitInfo): boolean {
    return !this.dead && this.ctx.now() >= this.invulnUntil && hit.amount > 0;
  }

  takeHit(hit: HitInfo): void {
    if (!this.isVulnerableTo(hit)) return;
    this.hp -= hit.amount;
    this.invulnUntil = this.ctx.now() + 250;
    this.ctx.effect('spark', this.x, this.y - this.height / 2);
    if (this.hp <= 0) {
      this.die(hit);
    } else {
      this.ctx.sfx('enemy-hit');
      this.onHurt(hit);
    }
  }

  /** Hook: reaction to a non-lethal hit (default: flash + small knockback). */
  protected onHurt(hit: HitInfo): void {
    playAnim(this, 'hit', 'idle', false);
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(80, () => this.active && this.clearTint());
    const dir = Math.sign(this.x - hit.fromX) || 1;
    if (this.cfg.gravity) this.body.setVelocity(dir * 80, -120);
  }

  die(hit?: HitInfo): void {
    if (this.dead) return;
    this.dead = true;
    this.ctx.events.emit(EV.ENEMY_DEFEATED, this.cfg.kind, this.x, this.y);
    this.ctx.sfx(hit?.kind === 'stomp' ? 'stomp' : 'enemy-defeat');
    this.ctx.effect('poof', this.x, this.y - this.height / 2);
    this.body.enable = false;
    this.clearTint();
    if (hit?.kind === 'stomp') {
      this.setScale(1.2, 0.5);
    }
    playAnim(this, 'die', 'hit', false);
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      y: this.y + (hit?.kind === 'stomp' ? 0 : -8),
      delay: 300,
      duration: 250,
      onComplete: () => this.destroy(),
    });
  }

  /** Utility: the player, if alive. */
  protected get player() {
    return this.ctx.player;
  }

  protected distanceToPlayer(): number {
    return Phaser.Math.Distance.Between(this.x, this.y, this.player.x, this.player.y);
  }

  /** True if there is solid ground one step ahead at the enemy's feet (for ledge-aware patrol). */
  protected groundAhead(dir: 1 | -1, lookAhead = 2): boolean {
    const x = this.x + dir * (this.body.width / 2 + lookAhead);
    const y = this.y + 2;
    const g = this.ctx.ground.getTileAtWorldXY(x, y);
    const o = this.ctx.oneway?.getTileAtWorldXY(x, y);
    return !!(g && g.index > 0) || !!(o && o.index > 0);
  }

  /** True if a solid wall blocks movement in `dir`. */
  protected wallAhead(dir: 1 | -1): boolean {
    return dir < 0 ? this.body.blocked.left : this.body.blocked.right;
  }
}
