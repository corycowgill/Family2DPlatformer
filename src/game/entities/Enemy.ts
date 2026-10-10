import Phaser from 'phaser';
import { DEPTH } from '../config';
import { EV, type EnemyKind, type HitInfo } from '../types';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { playAnim } from '../systems/AnimationSystem';
import { ensureEnemyArt } from '../enemies/enemyArt';
import { applyStatOverrides, telegraphBlink } from '../enemies/ai';
import { EnemyProjectile, type EnemyProjectileOptions } from './Projectile';

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
 * What happens when the player lands on top of an enemy:
 * - damage: enemy.onStomp() and the player bounces
 * - bounce: the player bounces, no damage (armored / closed weak spot)
 * - hurt: the top is dangerous (spinning arms) — treated as contact damage
 * - none: not stompable, treated as a normal contact
 */
export type StompOutcome = 'damage' | 'bounce' | 'hurt' | 'none';

/**
 * Base enemy. Subclasses implement `think(dt)` (AI state machine) and may override
 * hooks. Enemies are bottom-centre anchored like players.
 */
export abstract class Enemy extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  readonly cfg: EnemyConfig;
  hp: number;
  readonly maxHp: number;
  /** Damage on contact (cfg.contactDamage, overridable by the `damage` spawn property). */
  contactDamage: number;
  dead = false;
  facing: 1 | -1 = -1;
  /** Timestamp (level ms) until which the enemy ignores further hits. */
  protected invulnUntil = 0;
  /** AI state name, for debugging and tests. */
  aiState = 'idle';
  /** ms spent in the current aiState. */
  protected stateTime = 0;
  /** Level ms until which contact with this enemy can't hurt the player (set after a stomp). */
  playerGraceUntil = 0;
  /** How far outside the camera the enemy keeps thinking (px). */
  protected cullMargin = 160;
  /** Spawn position. */
  readonly homeX: number;
  readonly homeY: number;
  private telegraphStart = 0;
  private telegraphUntil = 0;
  private telegraphColor = 0xff3030;
  private mark?: Phaser.GameObjects.Text;
  private markUntil = 0;
  private flashUntil = 0;

  constructor(
    readonly ctx: LevelContext,
    readonly spawn: SpawnObject,
    cfg: EnemyConfig,
  ) {
    const atlas = cfg.atlas ?? cfg.kind;
    if (!ctx.scene.textures.exists(atlas)) ensureEnemyArt(ctx.scene, cfg.kind);
    super(ctx.scene, spawn.x, spawn.y, atlas);
    const stats = applyStatOverrides(cfg, spawn.props);
    this.cfg = cfg;
    this.hp = stats.hp;
    this.maxHp = stats.hp;
    this.contactDamage = stats.contactDamage;
    this.homeX = spawn.x;
    this.homeY = spawn.y;
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
    else if (spawn.props.facing !== 'left' && ctx.player && ctx.player.x > spawn.x) this.facing = 1;
    playAnim(this, 'idle');
  }

  /** Keep the body anchored to the bottom-centre of the frame. */
  protected syncBodyOffset(): void {
    const b = this.body;
    b.setOffset((this.width - b.width) / 2, this.height - b.height);
  }

  /** Resize the body keeping it bottom-centre anchored. */
  protected resizeBody(w: number, h: number): void {
    const bottom = this.body.bottom;
    this.body.setSize(w, h, false);
    this.syncBodyOffset();
    if (Number.isFinite(bottom) && bottom !== 0) this.body.y = bottom - h;
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
    if (this.dead || !this.active) return;
    this.stateTime += delta;
    this.updateFx();
    // Despawn if it fell out of the world.
    if (this.y > this.ctx.map.heightInPixels + 64) {
      this.destroy();
      return;
    }
    // Only think when near the camera (cheap culling).
    const cam = this.ctx.scene.cameras.main;
    const margin = this.cullMargin;
    if (this.x < cam.worldView.left - margin || this.x > cam.worldView.right + margin) {
      if (this.cfg.gravity) this.body.setVelocityX(0);
      else this.body.setVelocity(0, 0);
      return;
    }
    this.think(delta);
    if (!this.active) return;
    this.setFlipX(this.facing === -1);
  }

  /** AI per frame. */
  protected abstract think(dtMs: number): void;

  // ───────────── combat hooks (used by CombatSystem) ─────────────

  /** Result of the player landing on top of this enemy right now. */
  stompOutcome(): StompOutcome {
    if (!this.cfg.stompable) return 'none';
    return this.cfg.stompDamages === false ? 'bounce' : 'damage';
  }

  /** Player landed on top. Default: take 1 damage (stomps always deal at least the player's attack power). */
  onStomp(): void {
    if (this.stompOutcome() === 'bounce') {
      this.ctx.sfx('bump');
      return;
    }
    this.takeHit({ amount: this.ctx.player.attackPower ?? 1, fromX: this.ctx.player.x, kind: 'stomp' });
  }

  /**
   * Side contact with the player (not a stomp, not an attack). Return true if handled
   * (no contact damage), e.g. kicking a resting cone shell.
   */
  onPlayerContact(): boolean {
    return false;
  }

  /** Whether touching this enemy currently hurts the player. */
  hurtsOnContact(): boolean {
    return this.contactDamage > 0 && this.ctx.now() >= this.playerGraceUntil;
  }

  /** True while this enemy damages other enemies it touches (kicked cone shell). */
  harmsEnemies(): boolean {
    return false;
  }

  /** Can the player currently hurt this enemy by touching it from the side (e.g. while dashing)? */
  isVulnerableTo(hit: HitInfo): boolean {
    return !this.dead && this.ctx.now() >= this.invulnUntil && hit.amount > 0;
  }

  /** Hook: return true if the hit is blocked (shields). */
  protected blocksHit(_hit: HitInfo): boolean {
    return false;
  }

  /** Apply a hit. Returns true if it dealt damage. */
  takeHit(hit: HitInfo): boolean {
    if (!this.isVulnerableTo(hit)) return false;
    if (this.blocksHit(hit)) {
      this.invulnUntil = this.ctx.now() + 200;
      this.ctx.sfx('block');
      this.ctx.effect('spark', this.x + this.facing * (this.body.width / 2), this.y - this.height / 2);
      this.onBlocked(hit);
      return false;
    }
    this.hp -= hit.amount;
    this.invulnUntil = this.ctx.now() + 250;
    this.ctx.effect('spark', this.x, this.y - this.height / 2);
    if (this.hp <= 0) {
      this.die(hit);
    } else {
      this.ctx.sfx('enemy-hit');
      this.onHurt(hit);
    }
    return true;
  }

  /** Hook: a hit was blocked by a shield. */
  protected onBlocked(_hit: HitInfo): void {}

  /** Hook: reaction to a non-lethal hit (default: flash + small knockback). */
  protected onHurt(hit: HitInfo): void {
    playAnim(this, 'hit', 'idle', false);
    this.flash(90);
    const dir = Math.sign(this.x - hit.fromX) || 1;
    if (this.cfg.gravity) this.body.setVelocity(dir * 80, -120);
  }

  die(hit?: HitInfo): void {
    if (this.dead) return;
    this.dead = true;
    this.clearFx();
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

  destroy(fromScene?: boolean): void {
    this.clearFx();
    super.destroy(fromScene);
  }

  // ───────────── telegraph / feedback helpers ─────────────

  /** Blink a tint (accelerating) for `ms`, optionally with a '!' mark above the head. */
  telegraph(ms: number, color = 0xff3030, mark = true): void {
    const now = this.ctx.now();
    this.telegraphStart = now;
    this.telegraphUntil = now + ms;
    this.telegraphColor = color;
    if (mark) this.showMark('!', ms);
    this.ctx.sfx('enemy-telegraph');
  }

  get telegraphing(): boolean {
    return this.ctx.now() < this.telegraphUntil;
  }

  /** Stop any telegraph blink early. */
  endTelegraph(): void {
    this.telegraphUntil = 0;
    this.clearTint();
    this.hideMark();
  }

  showMark(text: string, ms: number, color = '#ffe14a'): void {
    if (!this.mark) {
      this.mark = this.scene.add
        .text(this.x, this.y, text, { fontFamily: 'monospace', fontSize: '12px', color, stroke: '#000', strokeThickness: 3 })
        .setOrigin(0.5, 1)
        .setDepth(DEPTH.effects);
    } else {
      this.mark.setText(text).setColor(color).setVisible(true);
    }
    this.markUntil = this.ctx.now() + ms;
  }

  private hideMark(): void {
    this.mark?.setVisible(false);
    this.markUntil = 0;
  }

  /** White flash for `ms`. */
  flash(ms = 80): void {
    this.flashUntil = this.ctx.now() + ms;
    this.setTintFill(0xffffff);
  }

  private updateFx(): void {
    const now = this.ctx.now();
    if (this.flashUntil) {
      if (now >= this.flashUntil) {
        this.flashUntil = 0;
        this.clearTint();
      } else return;
    }
    if (this.telegraphUntil) {
      if (now >= this.telegraphUntil) {
        this.telegraphUntil = 0;
        this.clearTint();
      } else if (telegraphBlink(now - this.telegraphStart, this.telegraphUntil - this.telegraphStart)) {
        this.setTint(this.telegraphColor);
      } else {
        this.clearTint();
      }
    }
    if (this.mark) {
      if (this.markUntil && now >= this.markUntil) this.hideMark();
      const bob = Math.sin(now / 80) * 1.5;
      this.mark.setPosition(this.x, this.y - this.displayHeight - 2 + bob);
    }
  }

  private clearFx(): void {
    this.mark?.destroy();
    this.mark = undefined;
    this.telegraphUntil = 0;
    this.flashUntil = 0;
  }

  /** Fire an enemy projectile. */
  shoot(x: number, y: number, opts: EnemyProjectileOptions): EnemyProjectile {
    this.ctx.sfx('enemy-shoot');
    return new EnemyProjectile(this.ctx, x, y, { damage: 1, ...opts });
  }

  // ───────────── utilities ─────────────

  /** Utility: the player, if alive. */
  protected get player() {
    return this.ctx.player;
  }

  protected playerAlive(): boolean {
    return this.player.isAlive();
  }

  protected distanceToPlayer(): number {
    return Phaser.Math.Distance.Between(this.x, this.y, this.player.x, this.player.y);
  }

  /** Face toward the player. */
  protected facePlayer(): void {
    this.facing = this.player.x >= this.x ? 1 : -1;
  }

  /** Centre Y of the player's body. */
  protected playerCenterY(): number {
    return this.player.body ? this.player.body.center.y : this.player.y - 12;
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

  /** Is the given world point inside a solid ground tile? */
  protected solidAt(x: number, y: number): boolean {
    const t = this.ctx.ground.getTileAtWorldXY(x, y);
    return !!(t && t.index > 0);
  }

  /** Ground-patrol step: reverse at walls/ledges; returns true if it turned. */
  protected patrol(speed: number): boolean {
    let turned = false;
    if (this.body.blocked.down) {
      if (this.wallAhead(this.facing) || !this.groundAhead(this.facing)) {
        this.facing = (this.facing * -1) as 1 | -1;
        turned = true;
      }
      this.body.setVelocityX(this.facing * speed);
    }
    return turned;
  }
}
