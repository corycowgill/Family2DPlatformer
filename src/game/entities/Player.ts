import Phaser from 'phaser';
import { DEPTH, PHYSICS, PLAYER_DEFAULTS } from '../config';
import { EV, EMPTY_INPUT, type CharacterDef, type HitInfo, type InputState, type PickupKind } from '../types';
import {
  createMotorState,
  stepHorizontal,
  stepVertical,
  tryJump,
  startJump,
  type MotorModifiers,
  type MotorState,
} from '../systems/PlayerMotor';
import { playAnim } from '../systems/AnimationSystem';
import { CHARACTER_FRAME_SIZE } from '../data/assets';
import type { LevelContext } from '../world/LevelContext';

/** A character's special ability. Implementations live in systems/Abilities.ts. */
export interface AbilityController {
  onPress(input: InputState): void;
  update(input: InputState, dtMs: number): void;
  onAirJumpPressed?(input: InputState): void;
  /** Called on landing. */
  onLand?(): void;
  /** Cancel any in-progress ability (hurt/death). */
  cancel?(): void;
}

export type PlayerMode = 'normal' | 'hurt' | 'dead' | 'victory' | 'ability' | 'frozen';

/**
 * The player-controlled family member. Movement math lives in PlayerMotor (pure);
 * this class glues it to Arcade physics, animations and game rules.
 */
export class Player extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  ctx!: LevelContext;
  readonly motor: MotorState = createMotorState();
  readonly mods: MotorModifiers = { speedMult: 1, jumpMult: 1, control: 1 };
  health: number = PLAYER_DEFAULTS.maxHealth;
  maxHealth: number = PLAYER_DEFAULTS.maxHealth;
  mode: PlayerMode = 'normal';
  crouching = false;
  /** Level time (ms) until which the player can't be damaged. */
  invulnUntil = 0;
  /** Level time (ms) until which knockback reduces control. */
  private knockbackUntil = 0;
  /** Level time when the ability can be used again. */
  abilityReadyAt = 0;
  /** Active timed power-ups → expiry (level ms). */
  readonly powerups = new Map<PickupKind, number>();
  /** True during an attack window in which touching enemies damages them instead of the player. */
  attacking = false;
  /** Damage dealt by attacks/stomps (pizza doubles it). */
  attackPower = 1;
  /** Input from the most recent tick (read by combat for stomp-bounce height). */
  lastInput: InputState = { ...EMPTY_INPUT };
  ability: AbilityController | null = null;
  private wasGrounded = false;
  private landTimer = 0;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    readonly def: CharacterDef,
  ) {
    super(scene, x, y, def.id);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 1);
    this.setDepth(DEPTH.player);
    this.body.setAllowGravity(false);
    this.body.setMaxVelocityY(PHYSICS.maxFallSpeed);
    this.applyBodySize(false);
    playAnim(this, 'idle');
  }

  attach(ctx: LevelContext): void {
    this.ctx = ctx;
  }

  get stats() {
    return this.def.stats;
  }

  get grounded(): boolean {
    return this.motor.grounded;
  }

  get facing(): 1 | -1 {
    return this.motor.facing;
  }

  isInvulnerable(): boolean {
    return this.ctx.now() < this.invulnUntil || this.mode === 'dead' || this.mode === 'victory';
  }

  isAlive(): boolean {
    return this.mode !== 'dead';
  }

  applyBodySize(crouch: boolean): void {
    const b = this.body;
    const h = crouch ? this.def.body.crouchHeight : this.def.body.height;
    const w = this.def.body.width;
    const prevBottom = b.bottom;
    b.setSize(w, h, false);
    b.setOffset((CHARACTER_FRAME_SIZE - w) / 2, CHARACTER_FRAME_SIZE - h);
    if (Number.isFinite(prevBottom) && prevBottom !== 0) b.y = prevBottom - h;
  }

  /** True if standing up (from a crouch) would hit a ceiling. */
  private ceilingBlocksStanding(): boolean {
    const b = this.body;
    const top = b.bottom - this.def.body.height;
    const layer = this.ctx.ground;
    for (const x of [b.left + 1, b.right - 1]) {
      for (let y = top; y < b.top; y += 8) {
        const t = layer.getTileAtWorldXY(x, y);
        if (t && t.collides) return true;
      }
    }
    return false;
  }

  /** Main per-frame update, called by LevelScene. */
  tick(input: InputState, dtMs: number): void {
    if (!this.ctx || !this.body) return;
    this.lastInput = input;
    const now = this.ctx.now();
    const b = this.body;
    const m = this.motor;

    // Expire power-ups.
    for (const [kind, until] of this.powerups) {
      if (now >= until) {
        this.powerups.delete(kind);
        this.onPowerupEnd(kind);
      }
    }

    if (this.mode === 'dead' || this.mode === 'frozen') return;
    if (this.mode === 'victory') {
      b.setVelocityX(0);
      this.integrateGravityOnly(dtMs);
      return;
    }

    // Read back collision results from the physics step.
    m.vx = b.velocity.x;
    m.vy = b.velocity.y;
    m.grounded = b.blocked.down || b.touching.down;

    // Crouch (on ground, holding down).
    const wantCrouch = input.down && m.grounded;
    if (wantCrouch !== this.crouching) {
      if (!wantCrouch && this.ceilingBlocksStanding()) {
        // stay crouched under low ceilings (Lupin tunnels)
      } else {
        this.crouching = wantCrouch;
        this.applyBodySize(wantCrouch);
      }
    }

    const knocked = now < this.knockbackUntil;
    this.mods.control = knocked ? 0.15 : 1;

    // Lupin can crawl while crouched (slow); others slide to a stop.
    const crawl = this.crouching && this.def.ability === 'sniff';
    const crawlInput = crawl ? { ...input, run: false } : input;
    const savedSpeed = this.mods.speedMult;
    if (crawl) this.mods.speedMult = savedSpeed * 0.55;
    stepHorizontal(m, crawlInput, this.stats, dtMs, this.mods, this.crouching && !crawl);
    this.mods.speedMult = savedSpeed;

    if (!knocked && this.mode !== 'ability') {
      if (tryJump(m, input, this.stats, dtMs, this.mods)) {
        this.onJump();
      } else if (input.jumpPressed && !m.grounded) {
        this.onAirJumpPressed(input);
      }
    }
    if (this.mode !== 'ability') stepVertical(m, input, dtMs);

    // Abilities
    if (input.attackPressed && now >= this.abilityReadyAt && this.mode === 'normal') {
      this.useAbility(input);
    }
    this.updateAbility(input, dtMs);

    b.setVelocity(m.vx, m.vy);

    // Landing feedback
    if (m.grounded && !this.wasGrounded) this.onLand();
    this.wasGrounded = m.grounded;
    if (this.landTimer > 0) this.landTimer -= dtMs;

    // Fell into a pit
    if (this.y > this.ctx.map.heightInPixels + 32) {
      this.die('pit');
      return;
    }

    // Invulnerability flicker
    if (now < this.invulnUntil && this.mode !== 'ability') {
      this.setAlpha(Math.floor(now / 60) % 2 ? 0.35 : 1);
    } else {
      this.setAlpha(1);
    }
    if (this.mode === 'hurt' && !knocked) this.mode = 'normal';

    this.setFlipX(m.facing < 0);
    this.updateAnimation();
  }

  private integrateGravityOnly(dtMs: number): void {
    const m = this.motor;
    m.grounded = this.body.blocked.down || this.body.touching.down;
    m.vy = this.body.velocity.y;
    if (!m.grounded) m.vy = Math.min(PHYSICS.maxFallSpeed, m.vy + PHYSICS.gravity * PHYSICS.fallGravityMult * (dtMs / 1000));
    this.body.setVelocityY(m.vy);
  }

  protected updateAnimation(): void {
    if (this.mode === 'ability') return; // ability code drives its own anim
    const m = this.motor;
    if (this.mode === 'hurt') return playAnim(this, 'hurt');
    if (this.attacking) return;
    if (!m.grounded) return playAnim(this, m.vy < 0 ? 'jump' : 'fall');
    if (this.crouching) return playAnim(this, Math.abs(m.vx) > 10 && this.def.ability === 'sniff' ? 'walk' : 'crouch', 'idle');
    if (this.landTimer > 0) return playAnim(this, 'land', 'idle');
    const speed = Math.abs(m.vx);
    if (speed < 8) return playAnim(this, 'idle');
    if (speed > this.stats.walkSpeed * this.mods.speedMult + 10) return playAnim(this, 'run', 'walk');
    playAnim(this, 'walk');
  }

  // ───────────── hooks (abilities are implemented in systems/Abilities.ts) ─────────────

  protected onJump(): void {
    this.ctx.sfx('jump');
    this.ctx.effect('dust', this.x, this.y, { scale: 0.8 });
    this.setScale(0.9, 1.1);
    this.scene.tweens.add({ targets: this, scaleX: 1, scaleY: 1, duration: 140 });
  }

  protected onLand(): void {
    this.ability?.onLand?.();
    this.landTimer = 90;
    this.ctx.sfx('land');
    this.ctx.effect('dust', this.x, this.y, { scale: 0.7 });
    this.setScale(1.12, 0.88);
    this.scene.tweens.add({ targets: this, scaleX: 1, scaleY: 1, duration: 120 });
  }

  /** Jump pressed in mid-air (and not a coyote/buffered jump). */
  protected onAirJumpPressed(input: InputState): void {
    this.ability?.onAirJumpPressed?.(input);
  }

  /** Attack/ability button pressed. */
  useAbility(input: InputState): void {
    this.ability?.onPress(input);
  }

  protected updateAbility(input: InputState, dtMs: number): void {
    this.ability?.update(input, dtMs);
  }

  protected onPowerupEnd(kind: PickupKind): void {
    if (kind === 'pizza') this.attackPower = 1;
    if (kind === 'ctaPass') {
      this.mods.speedMult = 1;
      this.mods.jumpMult = 1;
    }
    this.ctx.events.emit(EV.POWERUP_END, kind);
  }

  // ───────────── game rules ─────────────

  /** Bounce up after stomping an enemy. */
  bounce(held: boolean, velocity?: number): void {
    const v = velocity ?? (held ? -PHYSICS.stompBounceHeld : -PHYSICS.stompBounce);
    startJump(this.motor, this.stats, this.mods, v);
    this.motor.jumpCut = !held;
    this.body.setVelocityY(this.motor.vy);
  }

  hurt(hit: HitInfo): void {
    if (this.isInvulnerable() || this.mode === 'dead') return;
    this.health = Math.max(0, this.health - hit.amount);
    this.ctx.events.emit(EV.HEALTH_CHANGED, this.health, this.maxHealth);
    this.ctx.events.emit(EV.PLAYER_HURT, hit);
    if (this.health <= 0) {
      this.die(hit.kind);
      return;
    }
    this.ctx.sfx('hurt');
    this.ctx.shake(0.004, 120);
    const now = this.ctx.now();
    this.invulnUntil = now + PHYSICS.hurtInvulnMs;
    this.knockbackUntil = now + PHYSICS.knockbackMs;
    const dir = Math.sign(this.x - hit.fromX) || -this.motor.facing;
    this.motor.vx = dir * PHYSICS.knockbackVX;
    this.motor.vy = PHYSICS.knockbackVY;
    this.motor.grounded = false;
    this.body.setVelocity(this.motor.vx, this.motor.vy);
    this.attacking = false;
    this.ability?.cancel?.();
    this.mode = 'hurt';
    playAnim(this, 'hurt', 'idle', false);
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
    this.ctx.events.emit(EV.HEALTH_CHANGED, this.health, this.maxHealth);
  }

  die(_cause: HitInfo['kind'] | 'pit' = 'contact'): void {
    if (this.mode === 'dead') return;
    this.ability?.cancel?.();
    this.mode = 'dead';
    this.health = 0;
    this.attacking = false;
    this.ctx.events.emit(EV.HEALTH_CHANGED, 0, this.maxHealth);
    this.body.setVelocity(0, 0);
    this.body.enable = false;
    this.setAlpha(1);
    this.ctx.sfx('die');
    playAnim(this, 'defeat', 'hurt', false);
    this.scene.tweens.add({ targets: this, y: this.y - 24, duration: 300, yoyo: true, ease: 'Quad.easeOut' });
    this.ctx.events.emit(EV.PLAYER_DIED);
  }

  respawn(x: number, y: number): void {
    this.mode = 'normal';
    this.health = this.maxHealth;
    this.body.enable = true;
    this.body.reset(x, y);
    this.setPosition(x, y);
    Object.assign(this.motor, createMotorState());
    this.crouching = false;
    this.applyBodySize(false);
    this.invulnUntil = this.ctx.now() + 1500;
    this.powerups.clear();
    this.attackPower = 1;
    this.mods.speedMult = 1;
    this.mods.jumpMult = 1;
    this.ctx.events.emit(EV.HEALTH_CHANGED, this.health, this.maxHealth);
    this.ctx.events.emit(EV.PLAYER_RESPAWN);
    playAnim(this, 'idle');
  }

  celebrate(): void {
    this.mode = 'victory';
    this.attacking = false;
    this.setAlpha(1);
    playAnim(this, 'victory', 'idle', false);
  }

  addPowerup(kind: PickupKind, durationMs: number): void {
    this.powerups.set(kind, this.ctx.now() + durationMs);
    if (kind === 'pizza') this.attackPower = 2;
    if (kind === 'ctaPass') {
      this.mods.speedMult = 1.25;
      this.mods.jumpMult = 1.08;
    }
    this.ctx.events.emit(EV.POWERUP_START, kind, durationMs);
  }
}
