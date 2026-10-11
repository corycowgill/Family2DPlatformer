import Phaser from 'phaser';
import type { AbilityController, Player } from '../entities/Player';
import type { Enemy } from '../entities/Enemy';
import { EnergyBall, liveEnergyBalls } from '../entities/PlayerProjectiles';
import { DEPTH, PHYSICS } from '../config';
import { EV, type HitInfo, type InputState } from '../types';
import { canGroundJump, startAirJump, startJump } from './PlayerMotor';
import { hasAnim, playAnim } from './AnimationSystem';
import { rumble } from '../ui/PadOverlay';

/**
 * Character special abilities (attack button). Every character also gets a short
 * melee attack window so all five can deal with enemies up close.
 *
 *  Dad     — air: Ground Pound (hang, slam, shockwave). ground: shoulder bump.
 *  Mom     — air: Sparkle Jump (one extra jump, also on the jump button). ground: sparkle swipe.
 *  Brennan — Soccer Dash (ground or once in air), bowls over small enemies.
 *  Parker  — Energy Blast projectile (max 2 on screen).
 *  Lupin   — Super Sniff (reveals secrets, EV.SNIFF) + pounce bite.
 *  Grandma — Frying Pan Spin: hits both sides; once per jump it also slows the fall.
 */

// ───────────────────────── shared helpers ─────────────────────────

/** Play an effects-atlas anim, or draw a simple procedural fallback if the art isn't there yet. */
function fx(p: Player, anim: string, x: number, y: number, fallback: () => void, opts?: { flipX?: boolean; scale?: number }): void {
  if (hasAnim(p.scene, 'effects', anim)) p.ctx.effect(anim, x, y, opts);
  else fallback();
}

/** Expanding ring (shockwave / sniff fallback). `flat` squashes it vertically. */
function ring(scene: Phaser.Scene, x: number, y: number, radius: number, color: number, ms: number, flat = 1, width = 2): void {
  const g = scene.add.graphics().setDepth(DEPTH.effects).setPosition(x, y);
  g.lineStyle(width, color, 1).strokeEllipse(0, 0, radius * 2, radius * 2 * flat);
  g.setScale(0.15);
  scene.tweens.add({ targets: g, scale: 1, alpha: 0, duration: ms, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
}

/** A little burst of square sparkles. */
function sparkles(scene: Phaser.Scene, x: number, y: number, color: number, n = 6, spread = 14): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
    const s = scene.add.rectangle(x, y, 2, 2, i % 2 ? 0xffffff : color).setDepth(DEPTH.effects);
    scene.tweens.add({
      targets: s,
      x: x + Math.cos(a) * spread,
      y: y + Math.sin(a) * spread,
      alpha: 0,
      angle: 90,
      duration: 260 + Math.random() * 120,
      onComplete: () => s.destroy(),
    });
  }
}

function liveEnemies(p: Player): Enemy[] {
  return (p.ctx.groups.enemies.getChildren() as Enemy[]).filter((e) => e.active && !e.dead && e.body && e.body.enable);
}

/** Hit every enemy whose body intersects a box in front of the player. */
function meleeHit(p: Player, reach: number, height: number, hit: Omit<HitInfo, 'fromX'>): number {
  const b = p.body;
  const x = p.facing > 0 ? b.center.x - 2 : b.center.x - reach + 2;
  const rect = new Phaser.Geom.Rectangle(x, b.bottom - height, reach, height);
  let n = 0;
  for (const e of liveEnemies(p)) {
    const eb = e.body;
    const er = new Phaser.Geom.Rectangle(eb.left, eb.top, eb.width, eb.height);
    if (Phaser.Geom.Intersects.RectangleToRectangle(rect, er)) {
      e.takeHit({ ...hit, fromX: p.x });
      n++;
    }
  }
  return n;
}

/** Common behaviour: cooldown bookkeeping and a timed melee attack window. */
abstract class BaseAbility implements AbilityController {
  protected meleeUntil = 0;
  protected meleeReach = 18;
  protected meleeHeight = 20;
  /** Separate small cooldown for the basic melee. */
  protected meleeReadyAt = 0;

  constructor(protected readonly p: Player) {}

  protected get now(): number {
    return this.p.ctx.now();
  }

  protected get ready(): boolean {
    return this.now >= this.p.abilityReadyAt;
  }

  protected startCooldown(ms = this.p.def.abilityCooldownMs): void {
    this.p.abilityReadyAt = this.now + ms;
  }

  protected used(): void {
    this.p.ctx.events.emit(EV.ABILITY_USED, this.p.def.ability);
  }

  /** Begin a short melee window; returns false if the melee is still cooling down. */
  protected melee(ms: number, reach: number, height: number, lunge = 0, cooldownMs = 320): boolean {
    if (this.now < this.meleeReadyAt) return false;
    this.meleeReadyAt = this.now + cooldownMs;
    this.meleeUntil = this.now + ms;
    this.meleeReach = reach;
    this.meleeHeight = height;
    this.p.attacking = true;
    this.p.playAction('attack', ms);
    this.p.ctx.sfx('attack');
    if (lunge && this.p.grounded) {
      const m = this.p.motor;
      m.vx = this.p.facing * Math.max(Math.abs(m.vx), lunge);
    }
    return true;
  }

  abstract onPress(input: InputState): void;

  update(_input: InputState, _dtMs: number): void {
    this.updateMelee();
  }

  protected updateMelee(): void {
    if (this.meleeUntil === 0) return;
    if (this.now < this.meleeUntil) {
      this.p.attacking = true;
      meleeHit(this.p, this.meleeReach, this.meleeHeight, { amount: this.p.attackPower, kind: 'melee' });
    } else {
      this.meleeUntil = 0;
      this.p.attacking = false;
    }
  }

  cancel(): void {
    this.meleeUntil = 0;
    this.p.attacking = false;
  }
}

// ───────────────────────── Dad: Ground Pound ─────────────────────────

class GroundPound extends BaseAbility {
  private state: 'idle' | 'hang' | 'slam' | 'recover' = 'idle';
  private t = 0;
  private trailT = 0;

  get slamming(): boolean {
    return this.state === 'slam';
  }

  onPress(_input: InputState): void {
    const p = this.p;
    if (this.state !== 'idle') return;
    if (!p.grounded) {
      if (!this.ready) return;
      this.state = 'hang';
      this.t = 0;
      p.setAbilityMode(true);
      p.attacking = true;
      p.motor.vx = 0;
      p.motor.vy = 0;
      p.motor.jumping = false;
      playAnim(p, 'ability', 'attack', false);
      p.squash(1.15, 0.85, PHYSICS.groundPoundHangMs);
      p.ctx.sfx('pound-start');
      this.used();
      return;
    }
    // Shoulder bump.
    this.melee(200, 20, 24, 150, 380);
  }

  update(input: InputState, dtMs: number): void {
    super.update(input, dtMs);
    const p = this.p;
    const m = p.motor;
    if (this.state === 'idle') return;
    this.t += dtMs;
    if (this.state === 'hang') {
      m.vx = 0;
      m.vy = -8; // tiny lift sells the wind-up
      if (this.t >= PHYSICS.groundPoundHangMs) {
        this.state = 'slam';
        this.t = 0;
        p.squash(0.8, 1.2, 160);
      }
      return;
    }
    if (this.state === 'slam') {
      m.vx = 0;
      if (m.grounded) {
        this.impact();
        return;
      }
      m.vy = PHYSICS.groundPoundSpeed;
      this.trailT -= dtMs;
      if (this.trailT <= 0) {
        this.trailT = 30;
        p.spawnAfterImage(0xffffff, 0.4, 160);
      }
      if (this.t > 2000) this.end(); // fell into a bottomless area
      return;
    }
    if (this.state === 'recover') {
      m.vx = 0;
      m.vy = 0;
      if (this.t >= 160) this.end();
    }
  }

  private impact(): void {
    const p = this.p;
    this.state = 'recover';
    this.t = 0;
    p.motor.vy = 0;
    const x = p.x;
    const y = p.body.bottom;
    fx(p, 'shockwave', x, y - 4, () => {
      ring(p.scene, x, y - 2, PHYSICS.groundPoundRadius, 0xffe08a, 300, 0.3, 3);
      ring(p.scene, x, y - 2, PHYSICS.groundPoundRadius * 0.6, 0xffffff, 220, 0.3, 2);
    });
    p.ctx.effect('dust', x - 10, y, { scale: 1, flipX: true });
    p.ctx.effect('dust', x + 10, y, { scale: 1 });
    p.ctx.shake(0.012, 200);
    p.ctx.sfx('pound');
    rumble('pound');
    p.squash(1.3, 0.7, 180);
    for (const e of liveEnemies(p)) {
      const eb = e.body;
      const dx = Math.abs(eb.center.x - x) - eb.width / 2;
      const dy = Math.abs(eb.bottom - y);
      if (dx <= PHYSICS.groundPoundRadius && dy <= 20) {
        e.takeHit({ amount: p.attackPower * 2, fromX: x, kind: 'groundPound' });
      }
    }
    this.startCooldown();
  }

  private end(): void {
    this.state = 'idle';
    this.p.attacking = false;
    this.p.setAbilityMode(false);
  }

  onEnemyContact(enemy: Enemy): boolean {
    if (this.state !== 'slam' && this.state !== 'hang') return false;
    enemy.takeHit({ amount: this.p.attackPower * 2, fromX: this.p.x, kind: 'groundPound' });
    if (!enemy.dead && this.state === 'slam') {
      // Too tough to crush: bounce off it like a stomp.
      this.startCooldown();
      this.p.bounce(this.p.lastInput.jump);
    }
    return true;
  }

  cancel(): void {
    super.cancel();
    if (this.state !== 'idle') this.end();
  }
}

// ───────────────────────── Mom: Sparkle (air) Jump ─────────────────────────

class AirJump extends BaseAbility {
  private usedInAir = false;

  private airJump(viaAttack: boolean): void {
    const p = this.p;
    this.usedInAir = true;
    startAirJump(p.motor, p.mods);
    p.jumpHeldByAttack = viaAttack;
    const x = p.x;
    const y = p.body.bottom;
    fx(p, 'air_puff', x, y, () => ring(p.scene, x, y, 10, 0xffffff, 220, 0.35, 2));
    sparkles(p.scene, x, y - 4, 0xff8af0, 8, 16);
    p.playAction('ability', 260);
    p.squash(0.85, 1.15, 160);
    p.ctx.sfx('airjump');
    this.used();
  }

  onAirJumpPressed(_input: InputState): boolean {
    if (this.usedInAir || this.p.mode !== 'normal') return false;
    this.airJump(false);
    return true;
  }

  onPress(_input: InputState): void {
    const p = this.p;
    if (!p.grounded && !this.usedInAir) {
      this.airJump(true);
      return;
    }
    if (this.melee(220, 22, 26, 0, 320)) {
      sparkles(p.scene, p.x + p.facing * 14, p.y - 14, 0xff8af0, 6, 10);
    }
  }

  onLand(): void {
    this.usedInAir = false;
    this.p.jumpHeldByAttack = false;
  }

  cooldown01(): number {
    return this.usedInAir ? 1 : 0;
  }

  cancel(): void {
    super.cancel();
    this.p.jumpHeldByAttack = false;
  }
}

// ───────────────────────── Brennan: Soccer Dash ─────────────────────────

class Dash extends BaseAbility {
  private dashing = false;
  private dir: 1 | -1 = 1;
  private t = 0;
  private trailT = 0;
  private airDashUsed = false;

  onPress(input: InputState): void {
    const p = this.p;
    if (this.dashing || !this.ready) return;
    const airborne = !p.grounded;
    if (airborne && this.airDashUsed) return;
    if (airborne) this.airDashUsed = true;
    this.dir = input.left ? -1 : input.right ? 1 : p.facing;
    p.motor.facing = this.dir;
    this.dashing = true;
    this.t = 0;
    this.trailT = 0;
    p.setAbilityMode(true);
    p.attacking = true;
    p.motor.jumping = false;
    playAnim(p, 'ability', 'run', false);
    p.squash(1.2, 0.85, 140);
    p.ctx.sfx('dash');
    this.startCooldown();
    this.used();
  }

  update(input: InputState, dtMs: number): void {
    super.update(input, dtMs);
    if (!this.dashing) return;
    const p = this.p;
    const m = p.motor;
    this.t += dtMs;
    // Dash-jump: jumping cancels a ground dash and keeps the speed.
    if (input.jumpPressed && canGroundJump(m)) {
      this.end(PHYSICS.dashSpeed * p.mods.speedMult);
      return;
    }
    const wall = this.dir < 0 ? p.body.blocked.left : p.body.blocked.right;
    if (wall && this.t > 20) {
      p.ctx.sfx('bump');
      this.end(0);
      return;
    }
    m.vx = this.dir * PHYSICS.dashSpeed * p.mods.speedMult;
    m.vy = 0;
    this.trailT -= dtMs;
    if (this.trailT <= 0) {
      this.trailT = 40;
      p.spawnAfterImage(0xffa040, 0.5, 200);
      fx(p, 'dash_trail', p.x - this.dir * 8, p.y - 10, () => {}, { flipX: this.dir < 0 });
    }
    if (this.t >= PHYSICS.dashMs) this.end(p.stats.runSpeed * p.mods.speedMult);
  }

  private end(exitSpeed: number): void {
    this.dashing = false;
    const p = this.p;
    p.motor.vx = this.dir * exitSpeed;
    p.attacking = false;
    p.setAbilityMode(false);
  }

  onLand(): void {
    this.airDashUsed = false;
  }

  onEnemyContact(enemy: Enemy): boolean {
    if (!this.dashing) return false;
    enemy.takeHit({ amount: this.p.attackPower, fromX: this.p.x, kind: 'melee' });
    if (!enemy.dead) {
      // Bounced off something tough.
      this.end(0);
      this.p.motor.vx = -this.dir * 120;
    }
    return true;
  }

  cancel(): void {
    super.cancel();
    if (this.dashing) {
      this.dashing = false;
      this.p.setAbilityMode(false);
    }
  }
}

// ───────────────────────── Parker: Energy Blast ─────────────────────────

class Projectile extends BaseAbility {
  onPress(_input: InputState): void {
    const p = this.p;
    if (!this.ready) return;
    if (liveEnergyBalls(p.ctx) >= PHYSICS.projectileMax) {
      p.ctx.sfx('fizzle');
      return;
    }
    const dir = p.facing;
    const y = p.body.bottom - p.body.height * 0.6;
    new EnergyBall(p.ctx, p.x + dir * 10, y, dir);
    sparkles(p.scene, p.x + dir * 10, y, 0x7cff8a, 4, 6);
    p.playAction('ability', 200);
    p.ctx.sfx('shoot');
    // Tiny recoil on the ground.
    if (p.grounded) p.motor.vx -= dir * 20;
    this.startCooldown();
    this.used();
  }
}

// ───────────────────────── Lupin: Super Sniff + pounce ─────────────────────────

class Sniff extends BaseAbility {
  onPress(_input: InputState): void {
    const p = this.p;
    // Pounce/bite — always available on a short cooldown.
    if (this.melee(240, 18, 14, 0, 380) && p.grounded && !p.crouching) {
      const m = p.motor;
      m.vx = p.facing * Math.max(Math.abs(m.vx), 150);
      startJump(m, p.stats, p.mods, 170);
      m.jumpCut = true;
    }
    // Sniff — reveals secrets nearby.
    if (this.ready) {
      const x = p.x;
      const y = p.body.center.y;
      const r = PHYSICS.sniffRadius;
      fx(p, 'sniff', x + p.facing * 10, y, () => {}, { flipX: p.facing < 0 });
      ring(p.scene, x, y, r, 0xffe36b, 600, 1, 1);
      sparkles(p.scene, x + p.facing * 10, y - 6, 0xffe36b, 5, 10);
      p.ctx.sfx('sniff');
      p.ctx.events.emit(EV.SNIFF, x, y, r);
      this.startCooldown();
      this.used();
    }
  }
}

// ───────────────────────── Grandma: Frying Pan Spin ─────────────────────────

/** Spin length, reach on each side, and the capped fall speed of the once-per-jump hover. */
export const PAN_SPIN = { ms: 380, reach: 22, height: 26, hoverFallSpeed: 45 } as const;

class PanSpin extends BaseAbility {
  private spinUntil = 0;
  private hovering = false;
  private hoverUsed = false;
  private readonly bonked = new Set<Enemy>();

  get spinning(): boolean {
    return this.spinUntil > 0 && this.now < this.spinUntil;
  }

  onPress(_input: InputState): void {
    const p = this.p;
    if (this.spinning || !this.ready) return;
    this.spinUntil = this.now + PAN_SPIN.ms;
    this.bonked.clear();
    p.attacking = true;
    p.playAction('ability', PAN_SPIN.ms);
    p.ctx.sfx('attack');
    // Once per jump the spin works like a little helicopter: the fall is slowed while it lasts.
    if (!p.grounded && !this.hoverUsed) {
      this.hoverUsed = true;
      this.hovering = true;
      if (p.motor.vy > 0) p.motor.vy = 0;
      p.motor.jumping = false;
    }
    const x = p.x;
    const y = p.body.center.y;
    ring(p.scene, x, y, PAN_SPIN.reach, 0xe8e4f0, PAN_SPIN.ms, 0.45, 2);
    sparkles(p.scene, x, y - 4, 0xc79bf0, 6, 14);
    this.startCooldown();
    this.used();
  }

  update(input: InputState, dtMs: number): void {
    super.update(input, dtMs);
    if (this.spinUntil === 0) return;
    const p = this.p;
    if (this.now < this.spinUntil) {
      p.attacking = true;
      // Bonk everything in reach on BOTH sides (each enemy once per spin).
      const b = p.body;
      const rect = new Phaser.Geom.Rectangle(b.center.x - PAN_SPIN.reach, b.bottom - PAN_SPIN.height, PAN_SPIN.reach * 2, PAN_SPIN.height);
      for (const e of liveEnemies(p)) {
        if (this.bonked.has(e)) continue;
        const eb = e.body;
        if (Phaser.Geom.Intersects.RectangleToRectangle(rect, new Phaser.Geom.Rectangle(eb.left, eb.top, eb.width, eb.height))) {
          this.bonked.add(e);
          e.takeHit({ amount: p.attackPower, fromX: p.x, kind: 'melee' });
        }
      }
      if (this.hovering && !p.grounded) p.motor.vy = Math.min(p.motor.vy, PAN_SPIN.hoverFallSpeed);
    } else {
      this.spinUntil = 0;
      this.hovering = false;
      p.attacking = false;
    }
  }

  onLand(): void {
    this.hoverUsed = false;
    this.hovering = false;
  }

  onEnemyContact(enemy: Enemy): boolean {
    if (!this.spinning) return false;
    if (!this.bonked.has(enemy)) {
      this.bonked.add(enemy);
      enemy.takeHit({ amount: this.p.attackPower, fromX: this.p.x, kind: 'melee' });
    }
    return true;
  }

  cancel(): void {
    super.cancel();
    this.spinUntil = 0;
    this.hovering = false;
  }
}

class NoAbility extends BaseAbility {
  onPress(): void {
    this.melee(200, 18, 20);
  }
}

export function createAbility(player: Player): AbilityController {
  switch (player.def.ability) {
    case 'groundPound':
      return new GroundPound(player);
    case 'airJump':
      return new AirJump(player);
    case 'dash':
      return new Dash(player);
    case 'projectile':
      return new Projectile(player);
    case 'sniff':
      return new Sniff(player);
    case 'panSpin':
      return new PanSpin(player);
    default:
      return new NoAbility(player);
  }
}

export function attachAbilities(player: Player): void {
  player.ability = createAbility(player);
}
