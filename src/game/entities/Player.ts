import Phaser from 'phaser';
import { DEPTH, PHYSICS, PLAYER_DEFAULTS } from '../config';
import { EV, EMPTY_INPUT, type CharacterDef, type HitInfo, type InputState, type PickupKind } from '../types';
import {
  bonkCeiling,
  canGroundJump,
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
import type { Enemy } from './Enemy';

/** A character's special ability. Implementations live in systems/Abilities.ts. */
export interface AbilityController {
  /** Attack button pressed while the player is in 'normal' mode. The controller checks its own cooldown. */
  onPress(input: InputState): void;
  /**
   * Called every tick before movement. While `player.mode === 'ability'` the controller
   * owns `player.motor.vx/vy` (normal movement, jumping and gravity are skipped).
   */
  update(input: InputState, dtMs: number): void;
  /** Jump pressed in mid-air with no ground/coyote jump available. Return true if consumed. */
  onAirJumpPressed?(input: InputState): boolean;
  /** Called on landing. */
  onLand?(): void;
  /** Cancel any in-progress ability (hurt/death/respawn). */
  cancel?(): void;
  /** The player touches a live enemy. Return true if handled (CombatSystem then skips its default rules). */
  onEnemyContact?(enemy: Enemy): boolean;
  /** Cooldown remaining 0..1 for the HUD (default derives from `player.abilityReadyAt`). */
  cooldown01?(): number;
}

export type PlayerMode = 'normal' | 'hurt' | 'dead' | 'victory' | 'ability' | 'frozen';

/** Power-ups that change the player's look while active. */
const TINT_PIZZA = 0xff5a4a;
const TRAIL_CTA = 0x3fa0ff;

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
  /** Level time until which one-way tiles/platforms are ignored (drop-through). */
  dropThroughUntil = 0;
  /** Moving platform body the player is standing on (set by CombatSystem's platform collider). */
  groundPlatform: Phaser.Physics.Arcade.Body | null = null;
  /** Mom's attack-button air jump: holding attack counts as holding jump (variable height). */
  jumpHeldByAttack = false;
  private wasGrounded = false;
  private landTimer = 0;
  /** Extra downward velocity we added last tick (ground stick + platform), excluded from motor readback. */
  private appliedExtraVy = 0;
  /** Timed one-shot animation (attack / ability) overriding the locomotion anim. */
  private actionAnim: { name: string; until: number } | null = null;
  private lastCooldown = -1;
  private trailTimer = 0;
  private skidTimer = 0;
  /** Input latched by tick() for the following physics steps (edges held until consumed). */
  private readonly latched: InputState = { ...EMPTY_INPUT };
  private sawWorldStep = false;

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
    // The motor clamps fall speed itself; leave headroom for ground pound / platforms.
    this.body.setMaxVelocity(1000, 1000);
    this.applyBodySize(false);
    playAnim(this, 'idle');
    // Movement runs once per Arcade fixed step so it's frame-rate independent.
    const world = scene.physics.world;
    const onStep = (delta: number) => this.onWorldStep(delta);
    world.on(Phaser.Physics.Arcade.Events.WORLD_STEP, onStep);
    this.once(Phaser.GameObjects.Events.DESTROY, () => world.off(Phaser.Physics.Arcade.Events.WORLD_STEP, onStep));
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

  /** True while one-way tiles and one-way platforms should be ignored. */
  isDroppingThrough(): boolean {
    return !!this.ctx && this.ctx.now() < this.dropThroughUntil;
  }

  /** Called by CombatSystem's platform collider whenever the player collides with a platform body. */
  setGroundPlatform(body: Phaser.Physics.Arcade.Body | null): void {
    if (!body) {
      this.groundPlatform = null;
      return;
    }
    const pb = this.body;
    if (pb.bottom <= body.top + 4 && pb.right > body.left && pb.left < body.right) this.groundPlatform = body;
  }

  /** Show `name` (attack/ability) for `ms`, overriding locomotion animations. */
  playAction(name: 'attack' | 'ability', ms: number): void {
    this.actionAnim = { name, until: this.ctx.now() + ms };
    playAnim(this, name, name === 'ability' ? 'attack' : 'idle', false);
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
      for (let y = top; y < b.top; y += 4) {
        const t = layer.getTileAtWorldXY(x, y);
        if (t && t.collides) return true;
      }
    }
    return false;
  }

  /** The moving platform still under our feet, if any. */
  private currentPlatform(): Phaser.Physics.Arcade.Body | null {
    const plat = this.groundPlatform;
    if (!plat) return null;
    const pb = this.body;
    const go = plat.gameObject as Phaser.GameObjects.GameObject | undefined;
    if (!plat.enable || !go || !go.active || pb.right <= plat.left + 1 || pb.left >= plat.right - 1 || Math.abs(pb.bottom - plat.top) > 4) {
      this.groundPlatform = null;
      return null;
    }
    return plat;
  }

  /** True when the feet rest on a one-way tile or one-way platform (and not on solid ground). */
  private standingOnOneWay(): boolean {
    const b = this.body;
    const y = b.bottom + 2;
    const plat = this.currentPlatform();
    if (plat) return !!(plat.gameObject as Phaser.GameObjects.GameObject).getData?.('oneWay');
    const ow = this.ctx.oneway;
    if (!ow) return false;
    let onOneWay = false;
    for (const x of [b.left + 1, b.center.x, b.right - 1]) {
      const g = this.ctx.ground.getTileAtWorldXY(x, y);
      if (g && g.collides) return false;
      const t = ow.getTileAtWorldXY(x, y);
      if (t && t.index > 0) onOneWay = true;
    }
    return onOneWay;
  }

  /**
   * Per-frame update, called by LevelScene after the physics step(s). Latches input
   * for the next physics steps and updates visuals/animation. Movement itself runs in
   * `physicsStep`, once per Arcade fixed step (see constructor), so arcs are identical
   * at any display frame rate and match `simulateArc`.
   */
  tick(input: InputState, frameMs: number): void {
    if (!this.ctx || !this.body) return;
    const L = this.latched;
    const jumpPressed = L.jumpPressed || input.jumpPressed;
    const attackPressed = L.attackPressed || input.attackPressed;
    Object.assign(L, input, { jumpPressed, attackPressed });
    // Fallback for harnesses that drive tick() without stepping the physics world.
    if (!this.sawWorldStep) this.physicsStep(frameMs);
    this.frameUpdate(frameMs);
  }

  private onWorldStep(deltaSec: number): void {
    if (!this.ctx || !this.body || !this.active) return;
    this.sawWorldStep = true;
    this.physicsStep(deltaSec * 1000);
  }

  /** One fixed physics step of movement: read collisions, run the motor/abilities, write velocity. */
  private physicsStep(dtMs: number): void {
    const input = this.latched;
    this.lastInput = input;
    const now = this.ctx.now();
    const b = this.body;
    const m = this.motor;

    if (this.mode === 'dead' || this.mode === 'frozen') return;
    if (this.mode === 'victory') {
      b.setVelocityX(0);
      this.integrateGravityOnly(dtMs);
      return;
    }

    // ── Read back collision results from the physics step ──
    m.vx = b.velocity.x;
    const readVy = b.velocity.y;
    // Last step we pushed into the ground; unless something launched us (bounce pad), we're at rest.
    m.vy = this.appliedExtraVy !== 0 && readVy > -100 ? 0 : readVy;
    const plat = this.currentPlatform();
    // NB: only `blocked` — `touching` is also set by mere overlaps (coins, triggers).
    const touchingGround = b.blocked.down || !!plat;
    m.grounded = touchingGround && m.vy >= 0;
    if (!m.grounded && b.blocked.up && m.vy <= 0) {
      if (m.jumping) this.onBonk();
      bonkCeiling(m);
    }

    if (this.mode === 'ability') {
      // Ability owns the motion this step (dash / ground pound).
      this.ability?.update(input, dtMs);
    }
    if (this.mode !== 'ability') {
      this.stepNormal(input, dtMs, now);
    }
    // Edges are consumed by the first step that sees them.
    input.jumpPressed = false;
    input.attackPressed = false;

    // ── Write velocity back to the body ──
    let extraVy = 0;
    if (m.grounded && m.vy >= 0) {
      extraVy = PHYSICS.groundStickVy + (plat ? plat.velocity.y : 0);
    }
    this.appliedExtraVy = extraVy;
    b.setVelocity(m.vx, m.vy + extraVy);

    // Landing feedback
    if (m.grounded && !this.wasGrounded) this.onLand();
    this.wasGrounded = m.grounded;
    if (this.landTimer > 0) this.landTimer -= dtMs;
    if (this.mode === 'hurt' && now >= this.knockbackUntil) this.mode = 'normal';

    // Fell into a pit
    if (this.y > this.ctx.map.heightInPixels + 32) this.die('pit');
  }

  /** Per-frame bookkeeping: power-up expiry, HUD cooldown, visuals and animation. */
  private frameUpdate(frameMs: number): void {
    const now = this.ctx.now();
    for (const [kind, until] of this.powerups) {
      if (now >= until) {
        this.powerups.delete(kind);
        this.onPowerupEnd(kind);
      }
    }
    if (this.mode === 'dead' || this.mode === 'frozen' || this.mode === 'victory') return;
    if (this.actionAnim && now >= this.actionAnim.until) this.actionAnim = null;
    this.emitCooldown(now);
    this.setFlipX(this.motor.facing < 0);
    this.updateVisuals(now, frameMs);
    this.updateAnimation();
  }

  /** Normal-mode movement: crouch, run, jump, gravity, abilities. */
  private stepNormal(input: InputState, dtMs: number, now: number): void {
    const m = this.motor;
    const knocked = now < this.knockbackUntil;
    this.mods.control = knocked ? 0.15 : 1;

    // Drop through one-way platforms: down + jump while standing on one.
    let jumpInput = input;
    if (m.grounded && input.down && input.jumpPressed && !knocked && this.standingOnOneWay()) {
      this.dropThroughUntil = now + PHYSICS.dropThroughMs;
      this.groundPlatform = null;
      m.grounded = false;
      m.vy = 60;
      m.jumping = false;
      m.sinceGroundedMs = Infinity; // no coyote jump while dropping
      m.jumpBufferMs = Infinity;
      jumpInput = { ...input, jumpPressed: false };
      if (this.crouching) {
        this.crouching = false;
        this.applyBodySize(false);
      }
    }

    // Crouch (on ground, holding down).
    const wantCrouch = input.down && m.grounded && this.mode === 'normal';
    if (wantCrouch !== this.crouching) {
      if (!wantCrouch && m.grounded && this.ceilingBlocksStanding()) {
        // stay crouched under low ceilings (Lupin tunnels)
      } else {
        this.crouching = wantCrouch;
        this.applyBodySize(wantCrouch);
      }
    }

    // Lupin can crawl while crouched (slow); others slide to a stop.
    const crawl = this.crouching && this.def.ability === 'sniff';
    const moveInput = crawl ? { ...jumpInput, run: false } : jumpInput;
    const savedSpeed = this.mods.speedMult;
    if (crawl) this.mods.speedMult = savedSpeed * 0.55;
    const prevVx = m.vx;
    stepHorizontal(m, moveInput, this.stats, dtMs, this.mods, this.crouching && !crawl);
    this.mods.speedMult = savedSpeed;
    // Skid detection (reversing at speed on the ground) for the animation.
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (m.grounded && dir !== 0 && Math.sign(prevVx) === -dir && Math.abs(prevVx) > this.stats.walkSpeed * 0.7) this.skidTimer = 120;
    else if (this.skidTimer > 0) this.skidTimer -= dtMs;

    const crouchBlocksJump = this.crouching && this.ceilingBlocksStanding();
    let jumpedNow = false;
    if (!knocked && !crouchBlocksJump) {
      const coyote = canGroundJump(m);
      if (tryJump(m, jumpInput, this.stats, dtMs, this.mods)) {
        jumpedNow = true;
        this.onJump();
      } else if (jumpInput.jumpPressed && !coyote && !m.grounded && this.mode === 'normal') {
        if (this.ability?.onAirJumpPressed?.(jumpInput)) m.jumpBufferMs = Infinity;
      }
    } else {
      // Keep coyote/buffer timers ticking while knocked back.
      if (m.grounded) m.sinceGroundedMs = 0;
      else m.sinceGroundedMs += dtMs;
      m.jumpBufferMs = Infinity;
    }
    if (this.jumpHeldByAttack && !input.attack) this.jumpHeldByAttack = false;
    // No gravity on the take-off tick: the physics time just elapsed was spent on the ground.
    if (!jumpedNow) stepVertical(m, this.jumpHeldByAttack ? { ...input, jump: true } : input, dtMs);

    // Abilities / attack
    if (input.attackPressed && this.mode === 'normal') this.useAbility(input);
    if (this.mode === 'normal') this.ability?.update(input, dtMs);
  }

  private integrateGravityOnly(dtMs: number): void {
    const m = this.motor;
    m.grounded = this.body.blocked.down;
    m.vy = this.body.velocity.y;
    if (!m.grounded) m.vy = Math.min(PHYSICS.maxFallSpeed, m.vy + PHYSICS.gravity * PHYSICS.fallGravityMult * (dtMs / 1000));
    else m.vy = PHYSICS.groundStickVy;
    this.body.setVelocityY(m.vy);
  }

  private emitCooldown(now: number): void {
    const cd = this.ability?.cooldown01
      ? this.ability.cooldown01()
      : this.def.abilityCooldownMs > 0
        ? Phaser.Math.Clamp((this.abilityReadyAt - now) / this.def.abilityCooldownMs, 0, 1)
        : 0;
    const q = Math.round(cd * 50) / 50;
    if (q !== this.lastCooldown) {
      this.lastCooldown = q;
      this.ctx.events.emit(EV.ABILITY_COOLDOWN, q);
    }
  }

  /** Tints, trails and invulnerability flashing. */
  private updateVisuals(now: number, dtMs: number): void {
    // Invulnerability: strong blink (alpha) plus a white flash right after the hit.
    const invuln = now < this.invulnUntil && this.mode !== 'ability';
    if (invuln) {
      const left = this.invulnUntil - now;
      const period = left < 400 ? 40 : 70;
      this.setAlpha(Math.floor(now / period) % 2 ? 0.2 : 1);
    } else {
      this.setAlpha(1);
    }

    const sinceHurt = now - (this.invulnUntil - PHYSICS.hurtInvulnMs);
    if (this.mode === 'hurt' && sinceHurt < 160) {
      this.setTintFill(0xffffff);
    } else if (this.powerups.has('star')) {
      this.setTint(Phaser.Display.Color.HSVToRGB(((now / 400) % 1), 0.6, 1).color);
    } else if (this.powerups.has('pizza')) {
      const left = (this.powerups.get('pizza') ?? 0) - now;
      const speed = left < 2000 ? 60 : 160; // pulses faster just before it expires
      const t = (Math.sin(now / speed) + 1) / 2;
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(0xffffff),
        Phaser.Display.Color.ValueToColor(TINT_PIZZA),
        100,
        Math.round(t * 100),
      );
      this.setTint(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
    } else if (this.powerups.has('ctaPass')) {
      this.setTint(0xcfe4ff);
    } else if (this.isTinted) {
      this.clearTint();
    }

    // CTA pass: blue after-image trail while moving.
    if (this.powerups.has('ctaPass') && (Math.abs(this.motor.vx) > 20 || !this.motor.grounded)) {
      this.trailTimer -= dtMs;
      if (this.trailTimer <= 0) {
        const left = (this.powerups.get('ctaPass') ?? 0) - now;
        this.trailTimer = left < 2000 ? 90 : 45;
        this.spawnAfterImage(TRAIL_CTA);
      }
    }
  }

  /** A fading copy of the current frame (CTA trail, dash). */
  spawnAfterImage(tint: number, alpha = 0.55, durationMs = 240): void {
    if (!this.frame) return;
    const img = this.scene.add
      .image(this.x, this.y, this.texture.key, this.frame.name)
      .setOrigin(0.5, 1)
      .setFlipX(this.flipX)
      .setScale(this.scaleX, this.scaleY)
      .setDepth(DEPTH.player - 1)
      .setTintFill(tint)
      .setAlpha(alpha);
    this.scene.tweens.add({ targets: img, alpha: 0, duration: durationMs, onComplete: () => img.destroy() });
  }

  protected updateAnimation(): void {
    if (this.mode === 'ability') return; // ability code drives its own anim
    const m = this.motor;
    if (this.mode === 'hurt') return playAnim(this, 'hurt');
    if (this.actionAnim) return playAnim(this, this.actionAnim.name, 'attack');
    if (!m.grounded) return playAnim(this, m.vy < 0 ? 'jump' : 'fall', 'jump');
    if (this.crouching) return playAnim(this, Math.abs(m.vx) > 10 && this.def.ability === 'sniff' ? 'walk' : 'crouch', 'idle');
    if (this.skidTimer > 0) return playAnim(this, 'land', 'idle');
    if (this.landTimer > 0) return playAnim(this, 'land', 'idle');
    const speed = Math.abs(m.vx);
    if (speed < 8) return playAnim(this, 'idle');
    if (speed > this.stats.walkSpeed * this.mods.speedMult + 10) return playAnim(this, 'run', 'walk');
    playAnim(this, 'walk');
  }

  // ───────────── hooks ─────────────

  protected onJump(): void {
    this.groundPlatform = null;
    this.ctx.sfx('jump');
    this.ctx.effect('dust', this.x, this.y, { scale: 0.8 });
    this.squash(0.86, 1.14, 140);
  }

  protected onLand(): void {
    this.ability?.onLand?.();
    const hard = this.landTimer <= 0;
    this.landTimer = 90;
    if (hard) {
      this.ctx.sfx('land');
      this.ctx.effect('dust', this.x, this.y, { scale: 0.7 });
      this.squash(1.14, 0.86, 120);
    }
  }

  protected onBonk(): void {
    this.ctx.sfx('bump');
    this.squash(1.1, 0.9, 100);
  }

  squash(sx: number, sy: number, ms: number): void {
    this.scene.tweens.killTweensOf(this);
    this.setScale(sx, sy);
    this.scene.tweens.add({ targets: this, scaleX: 1, scaleY: 1, duration: ms });
  }

  /**
   * Called by CombatSystem when the player overlaps a live enemy, before the default
   * stomp/contact rules. Returns true if handled (star power, dash, ground pound).
   */
  onEnemyContact(enemy: Enemy): boolean {
    if (this.powerups.has('star')) {
      enemy.takeHit({ amount: 99, fromX: this.x, kind: 'melee' });
      return true;
    }
    return this.ability?.onEnemyContact?.(enemy) ?? false;
  }

  /** Attack/ability button pressed. */
  useAbility(input: InputState): void {
    this.ability?.onPress(input);
  }

  /** Enter/leave ability mode (the controller owns motion while in it). */
  setAbilityMode(on: boolean): void {
    if (on) {
      this.mode = 'ability';
      if (this.crouching) {
        this.crouching = false;
        this.applyBodySize(false);
      }
    } else if (this.mode === 'ability') {
      this.mode = 'normal';
    }
  }

  protected onPowerupEnd(kind: PickupKind): void {
    if (kind === 'pizza') this.attackPower = 1;
    if (kind === 'ctaPass') {
      this.mods.speedMult = 1;
      this.mods.jumpMult = 1;
    }
    if (kind === 'star' && this.mode !== 'ability') this.attacking = false;
    if (this.powerups.size === 0) this.clearTint();
    this.ctx.events.emit(EV.POWERUP_END, kind);
  }

  // ───────────── game rules ─────────────

  /** Bounce up after stomping an enemy (or from a bounce pad when `velocity` is given). */
  bounce(held: boolean, velocity?: number): void {
    const v = velocity ?? (held ? -PHYSICS.stompBounceHeld : -PHYSICS.stompBounce);
    this.ability?.cancel?.();
    if (this.mode === 'ability') this.mode = 'normal';
    startJump(this.motor, this.stats, this.mods, Math.abs(v));
    this.motor.jumpCut = !held;
    this.groundPlatform = null;
    this.appliedExtraVy = 0;
    this.body.setVelocityY(this.motor.vy);
  }

  hurt(hit: HitInfo): void {
    if (this.isInvulnerable() || this.mode === 'dead') return;
    if (this.powerups.has('star') && hit.kind !== 'pit') return;
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
    this.ability?.cancel?.();
    const dir = Math.sign(this.x - hit.fromX) || -this.motor.facing;
    this.motor.vx = dir * PHYSICS.knockbackVX;
    this.motor.vy = PHYSICS.knockbackVY;
    this.motor.grounded = false;
    this.motor.jumping = false;
    this.groundPlatform = null;
    this.appliedExtraVy = 0;
    this.body.setVelocity(this.motor.vx, this.motor.vy);
    this.attacking = false;
    this.actionAnim = null;
    if (this.crouching) {
      this.crouching = false;
      this.applyBodySize(false);
    }
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
    this.clearTint();
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
    this.ability?.cancel?.();
    this.mode = 'normal';
    this.health = this.maxHealth;
    this.body.enable = true;
    this.body.reset(x, y);
    this.setPosition(x, y);
    Object.assign(this.motor, createMotorState());
    this.crouching = false;
    this.attacking = false;
    this.actionAnim = null;
    this.groundPlatform = null;
    this.appliedExtraVy = 0;
    this.applyBodySize(false);
    this.invulnUntil = this.ctx.now() + 1500;
    for (const kind of [...this.powerups.keys()]) {
      this.powerups.delete(kind);
      this.onPowerupEnd(kind);
    }
    this.attackPower = 1;
    this.mods.speedMult = 1;
    this.mods.jumpMult = 1;
    this.clearTint();
    this.setScale(1);
    this.ctx.events.emit(EV.HEALTH_CHANGED, this.health, this.maxHealth);
    this.ctx.events.emit(EV.PLAYER_RESPAWN);
    playAnim(this, 'idle');
  }

  celebrate(): void {
    this.ability?.cancel?.();
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
    if (kind === 'star') this.invulnUntil = Math.max(this.invulnUntil, this.ctx.now());
    this.squash(1.2, 1.2, 200);
    this.ctx.events.emit(EV.POWERUP_START, kind, durationMs);
  }
}
