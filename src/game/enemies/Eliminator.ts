import Phaser from 'phaser';
import { DEPTH } from '../config';
import type { HitInfo } from '../types';
import { Boss, arenaFromSpawn } from '../entities/Boss';
import type { StompOutcome } from '../entities/Enemy';
import { EnemyProjectile } from '../entities/Projectile';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { playAnim } from '../systems/AnimationSystem';
import { ENEMY_FRAME_SIZE } from './enemyArt';
import { applyStatOverrides, eliminatorTiming, pickEliminatorAttack, propNum, telegraphBlink, type EliminatorAttack } from './ai';
import { ring, shadowMarker } from './fx';
import { SecurityDrone } from './SecurityDrone';

const STAND = { width: 84, height: 70 };
/** While vulnerable the robot slumps (sprite + body squash) so its cab top is ~40 px above the floor. */
const KNEEL_HEIGHT = 40;
const KNEEL_SCALE_Y = KNEEL_HEIGHT / STAND.height;
/** Low sweep: fist hugs the floor — jump over it. High sweep: head height — duck or stay away. */
const LOW_Y = 7;
const HIGH_Y = 27;
const HIGH_REACH = 300;

/**
 * BOSS — "The EL-iminator": a malfunctioning CTA-train robot (train-car torso, girder legs,
 * a mechanical arm). 12 hp, phases at 8 and 4 hp.
 *
 * Fight loop: idle (shuffles toward the player) → telegraphed attack → VULNERABLE window
 * (the robot slumps, its cab drops to 40 px and a glowing hatch opens on top: stomp it or
 * hit it with projectiles/abilities) → rise → repeat. A stomp closes the window early.
 *
 * Attacks (each telegraphed):
 * 1. Arm sweep (all phases): arm raises & the fist blinks for 0.8 s at LOW (floor — jump)
 *    or HIGH (head height — duck or stay > 300 px away) level, then shoots across the arena
 *    and returns harmlessly.
 * 2. Falling debris (phase 2+): shadow markers on the floor 0.8 s before girders drop.
 * 3. Rail shockwave (phase 2+): sparks at its feet, then floor waves travel both ways — jump.
 * 4. Security drones (phase 3, max 2 alive).
 */
export class Eliminator extends Boss {
  readonly bossName: string;
  private fist?: EnemyProjectile;
  private fistStartX = 0;
  private sweepHigh = false;
  private lastAttack: EliminatorAttack | null = null;
  private forcedNext: EliminatorAttack | null = null;
  private vulnMs = 2000;
  private readonly arm: Phaser.GameObjects.Graphics;
  private readonly weak: Phaser.GameObjects.Graphics;
  private markers: Phaser.GameObjects.Graphics[] = [];
  private debrisX: number[] = [];
  private sparkTimer = 0;
  private wavesLeft = 0;
  /** Attack counter (debug/tests). */
  attacks = 0;

  constructor(ctx: LevelContext, spawn: SpawnObject) {
    const arena = arenaFromSpawn(spawn);
    const stats = applyStatOverrides({ hp: 12, contactDamage: 1 }, spawn.props);
    const bx = arena.x + propNum(spawn.props, 'bossOffset', arena.width - 90);
    super(
      ctx,
      { ...spawn, x: bx, y: arena.bottom },
      { kind: 'eliminator', hp: 12, contactDamage: 1, stompable: true, body: STAND, gravity: true, frameSize: ENEMY_FRAME_SIZE.eliminator },
      arena,
      [Math.round((stats.hp * 2) / 3), Math.round(stats.hp / 3)],
    );
    this.bossName = String(spawn.props.name ?? 'The EL-iminator');
    this.facing = -1;
    this.arm = ctx.scene.add.graphics().setDepth(DEPTH.enemies + 1);
    this.weak = ctx.scene.add.graphics().setDepth(DEPTH.enemies + 2);
  }

  // ───────────── combat hooks ─────────────

  get vulnerable(): boolean {
    return this.aiState === 'vulnerable';
  }

  stompOutcome(): StompOutcome {
    return this.vulnerable ? 'damage' : 'bounce';
  }

  hurtsOnContact(): boolean {
    if (!this.started || this.vulnerable || this.aiState === 'rise' || this.aiState === 'intro') return false;
    return super.hurtsOnContact();
  }

  protected blocksHit(hit: HitInfo): boolean {
    return !this.vulnerable && hit.kind !== 'stomp';
  }

  takeHit(hit: HitInfo): boolean {
    // A stomp always deals exactly 1 so the fight length is the same for every character.
    const amount = hit.kind === 'stomp' ? 1 : Math.min(hit.amount, 2);
    const dealt = super.takeHit({ ...hit, amount });
    if (dealt) this.invulnUntil = this.ctx.now() + (hit.kind === 'stomp' ? 250 : 600);
    return dealt;
  }

  onStomp(): void {
    if (!this.vulnerable) {
      this.ctx.sfx('bump');
      return;
    }
    const dealt = this.takeHit({ amount: 1, fromX: this.player.x, kind: 'stomp' });
    if (dealt && !this.dead) {
      this.ctx.sfx('boss-hit');
      // Push the player off the robot and close the hatch (unless a phase change already did).
      const away = this.player.x < this.x ? -1 : 1;
      this.player.body.setVelocityX(away * 170);
      if (this.aiState === 'vulnerable') this.startRise();
    }
  }

  // ───────────── boss flow ─────────────

  protected idleDormant(): void {
    playAnim(this, 'idle');
    this.drawArm(null, false);
  }

  protected onIntroStart(): void {
    this.telegraph(this.introMs, 0xff8a00, false);
    this.showMark('!!', this.introMs, '#ff5030');
  }

  protected intro(): void {
    playAnim(this, 'attack', 'idle');
    this.drawArm(null, false);
  }

  protected onPhaseChange(phase: number): void {
    this.ctx.sfx('boss-roar');
    this.ctx.shake(0.01, 500);
    this.cleanupAttack();
    this.startRise(true);
    this.forcedNext = phase === 2 ? 'debris' : 'drones';
    this.invulnUntil = this.ctx.now() + 900;
    this.showMark(phase === 2 ? 'RAGE!' : 'MAX POWER!', 1000, '#ff5030');
  }

  private timing() {
    return eliminatorTiming(this.phase);
  }

  private dronesAlive(): number {
    this.minions = this.minions.filter((m) => m.active && !m.dead);
    return this.minions.filter((m) => m instanceof SecurityDrone).length;
  }

  private nextAttack(): void {
    const atk = this.forcedNext ?? pickEliminatorAttack(this.phase, this.lastAttack, Math.random(), this.dronesAlive());
    this.forcedNext = null;
    this.lastAttack = atk;
    this.attacks++;
    this.facePlayer();
    const t = this.timing();
    switch (atk) {
      case 'sweepLow':
      case 'sweepHigh':
        this.sweepHigh = atk === 'sweepHigh';
        this.spawnFist();
        this.telegraph(t.telegraphMs, 0xff3030, false);
        this.showMark(this.sweepHigh ? 'DUCK!' : 'JUMP!', t.telegraphMs, '#ffe14a');
        this.ctx.sfx('arm-raise');
        this.setAI('sweepTele');
        break;
      case 'debris': {
        const a = this.arena;
        const px = Phaser.Math.Clamp(this.player.x, a.x + 24, a.right - 24);
        const xs = [px];
        let guard = 0;
        while (xs.length < (this.phase >= 3 ? 4 : 3) && guard++ < 40) {
          const x = a.x + 24 + Math.random() * (a.width - 48);
          if (xs.every((o) => Math.abs(o - x) > 56) && Math.abs(x - this.x) > 50) xs.push(x);
        }
        this.debrisX = xs;
        this.markers = xs.map((x) => shadowMarker(this.ctx, x, this.floorY, 30, t.debrisWarnMs));
        this.telegraph(t.debrisWarnMs, 0xffb020, false);
        this.ctx.sfx('debris-warn');
        this.setAI('debrisTele');
        break;
      }
      case 'shockwave':
        this.telegraph(t.shockwaveWarnMs, 0x7fe8ff, false);
        this.showMark('JUMP!', t.shockwaveWarnMs, '#7fe8ff');
        this.ctx.sfx('rail-spark');
        this.sparkTimer = 0;
        this.wavesLeft = this.phase >= 3 ? 2 : 1;
        this.setAI('shockTele');
        break;
      case 'drones':
        this.telegraph(600, 0x7be0d8, false);
        this.ctx.sfx('summon');
        this.setAI('summonTele');
        break;
    }
  }

  private spawnFist(): void {
    this.fist?.destroy();
    const y = this.floorY - (this.sweepHigh ? HIGH_Y : LOW_Y);
    const x = this.x + this.facing * (STAND.width / 2 + 14);
    this.fistStartX = x;
    const a = this.arena;
    const f = new EnemyProjectile(this.ctx, x, y, {
      style: 'fist',
      damage: 1,
      persistent: true,
      ignoreTerrain: true,
      lifetimeMs: 20000,
      clampX: { min: a.x - 64, max: a.right + 64 },
      body: { width: 20, height: 12 },
      duckable: this.sweepHigh,
    });
    f.harmful = false;
    f.setFlipX(this.facing < 0);
    this.fist = f;
  }

  private startVulnerable(scale = 1): void {
    this.vulnMs = this.timing().vulnerableMs * scale;
    this.setAI('vulnerable');
    this.endTelegraph();
    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.add({ targets: this, scaleX: 1.08, scaleY: KNEEL_SCALE_Y, duration: 160, ease: 'Quad.easeIn' });
    this.ctx.shake(0.004, 120);
    this.ctx.sfx('boss-vulnerable');
    this.ctx.effect('smoke', this.x, this.floorY - KNEEL_HEIGHT);
  }

  private startRise(fromPhase = false): void {
    if (this.aiState === 'vulnerable' || fromPhase) {
      this.playerGraceUntil = this.ctx.now() + 600;
    }
    this.setAI(fromPhase ? 'rage' : 'rise');
  }

  private cleanupAttack(): void {
    this.fist?.destroy();
    this.fist = undefined;
    for (const m of this.markers) m.destroy();
    this.markers = [];
  }

  protected fight(dt: number): void {
    const b = this.body;
    const t = this.timing();
    if (b.blocked.down && this.aiState !== 'idle') b.setVelocityX(0);
    switch (this.aiState) {
      case 'idle': {
        playAnim(this, 'move', 'idle');
        if (this.scaleY !== 1 && !this.scene.tweens.isTweening(this)) this.setScale(1, 1);
        this.facePlayer();
        // Shuffle to stay ~110 px from the player, inside the right part of the arena.
        const a = this.arena;
        const side = this.player.x < this.x ? 1 : -1;
        const tx = Phaser.Math.Clamp(this.player.x + side * 110, a.x + a.width * 0.4, a.right - STAND.width / 2 - 20);
        const dx = tx - this.x;
        b.setVelocityX(Math.abs(dx) > 4 ? Math.sign(dx) * 40 : 0);
        if (this.stateTime >= t.idleMs) {
          b.setVelocityX(0);
          this.nextAttack();
        }
        break;
      }
      case 'sweepTele': {
        playAnim(this, 'attack', 'idle');
        const f = this.fist;
        if (f?.active) {
          if (telegraphBlink(this.stateTime, t.telegraphMs)) f.setTint(0xff4040);
          else f.clearTint();
          if (!this.sweepHigh) {
            this.sparkTimer += dt;
            if (this.sparkTimer > 140) {
              this.sparkTimer = 0;
              this.ctx.effect('spark', f.x + Phaser.Math.Between(-8, 8), this.floorY - 2);
            }
          }
        }
        if (this.stateTime >= t.telegraphMs) {
          if (f?.active) {
            f.clearTint();
            f.harmful = true;
            f.body.setVelocityX(this.facing * t.sweepSpeed);
          }
          this.ctx.sfx('arm-sweep');
          this.setAI('sweep');
        }
        break;
      }
      case 'sweep': {
        const f = this.fist;
        const a = this.arena;
        if (!f?.active) {
          this.startVulnerable();
          break;
        }
        const reach = Math.abs(f.x - this.fistStartX);
        const atEdge = f.x <= a.x + 14 || f.x >= a.right - 14;
        if (atEdge || (this.sweepHigh && reach >= HIGH_REACH)) {
          if (atEdge) this.ctx.shake(0.004, 100);
          f.harmful = false;
          f.setAlpha(0.55);
          f.body.setVelocityX(-this.facing * t.sweepSpeed * 1.6);
          this.setAI('sweepReturn');
        }
        break;
      }
      case 'sweepReturn': {
        const f = this.fist;
        if (!f?.active || Math.abs(f.x - this.fistStartX) < 12 || Math.sign(this.fistStartX - f.x) !== Math.sign(-f.body.velocity.x) || this.stateTime > 3000) {
          this.cleanupAttack();
          this.startVulnerable();
        }
        break;
      }
      case 'debrisTele':
        playAnim(this, 'attack', 'idle');
        if (this.stateTime >= t.debrisWarnMs) {
          for (const x of this.debrisX) {
            this.shoot(x, this.floorY - 150, { style: 'girder', vy: 240, gravity: true, lifetimeMs: 3000, body: { width: 24, height: 8 } });
          }
          this.ctx.sfx('debris-fall');
          this.setAI('debrisFall');
        }
        break;
      case 'debrisFall':
        if (this.stateTime >= 550) {
          for (const m of this.markers) m.destroy();
          this.markers = [];
          this.startVulnerable(0.85);
        }
        break;
      case 'shockTele':
        playAnim(this, 'attack', 'idle');
        this.sparkTimer += dt;
        if (this.sparkTimer > 90) {
          this.sparkTimer = 0;
          for (const s of [-1, 1]) this.ctx.effect('spark', this.x + s * (STAND.width / 2 + Phaser.Math.Between(0, 12)), this.floorY - 3);
          this.drawSparks();
        }
        if (this.stateTime >= t.shockwaveWarnMs) {
          this.fireShockwave();
          this.setAI('shockwave');
        }
        break;
      case 'shockwave':
        if (this.wavesLeft > 0 && this.stateTime >= 650) {
          this.fireShockwave();
          this.stateTime = 0;
        } else if (this.wavesLeft === 0 && this.stateTime >= 700) {
          this.startVulnerable(0.85);
        }
        break;
      case 'summonTele':
        playAnim(this, 'attack', 'idle');
        if (this.stateTime >= 600) {
          this.summonDrones();
          this.startVulnerable(0.85);
        }
        break;
      case 'vulnerable':
        playAnim(this, 'idle');
        if (this.stateTime >= this.vulnMs) this.startRise();
        break;
      case 'rise':
      case 'rage':
        playAnim(this, this.aiState === 'rage' ? 'attack' : 'idle', 'idle');
        if (this.scaleY < 1 && this.stateTime >= 250 && !this.scene.tweens.isTweening(this)) {
          this.scene.tweens.add({ targets: this, scaleX: 1, scaleY: 1, duration: 200, ease: 'Back.easeOut' });
        }
        if (this.stateTime >= (this.aiState === 'rage' ? 1000 : 450)) this.setAI('idle');
        break;
      default:
        this.setAI('idle');
    }
    this.drawArm(this.fist?.active ? this.fist : null, this.aiState === 'sweepTele');
    this.drawWeakSpot();
  }

  private fireShockwave(): void {
    this.wavesLeft--;
    const a = this.arena;
    this.ctx.shake(0.006, 160);
    this.ctx.sfx('shockwave');
    for (const dir of [-1, 1] as const) {
      this.shoot(this.x + dir * (STAND.width / 2 + 6), this.floorY - 6, {
        style: 'shockwave',
        vx: dir * this.timing().shockwaveSpeed,
        ignoreTerrain: true,
        groundOnly: true,
        persistent: true,
        lifetimeMs: 6000,
        clampX: { min: a.x + 4, max: a.right - 4 },
      });
    }
  }

  private summonDrones(): void {
    const max = this.timing().maxDrones;
    const a = this.arena;
    const spots = [
      { x: a.x + 70, y: a.y + 70 },
      { x: a.centerX, y: a.y + 56 },
    ];
    let alive = this.dronesAlive();
    for (const s of spots) {
      if (alive >= max) break;
      ring(this.ctx, s.x, s.y - 6, 0xff3030, 18);
      const d = new SecurityDrone(this.ctx, { id: 900 + alive, type: 'enemy', name: 'boss-drone', x: s.x, y: s.y, width: 16, height: 16, props: { kind: 'securityDrone', range: 50, interval: 3000 } });
      this.minions.push(d);
      alive++;
    }
  }

  // ───────────── visuals ─────────────

  private drawSparks(): void {
    const g = this.ctx.scene.add.graphics().setDepth(DEPTH.effects);
    g.lineStyle(1, 0x9ff6ff, 1);
    for (const s of [-1, 1]) {
      let x = this.x + s * (STAND.width / 2);
      let y = this.floorY - 1;
      g.beginPath();
      g.moveTo(x, y);
      for (let i = 0; i < 4; i++) {
        x += s * Phaser.Math.Between(4, 9);
        y = this.floorY - 1 - Phaser.Math.Between(0, 6);
        g.lineTo(x, y);
      }
      g.strokePath();
    }
    this.ctx.scene.time.delayedCall(80, () => g.destroy());
  }

  /** Mechanical arm: shoulder → fist (or resting pose). */
  private drawArm(fist: EnemyProjectile | null, glow: boolean): void {
    const g = this.arm;
    g.clear();
    if (this.dead) return;
    const sx = this.x + this.facing * (STAND.width / 2 - 6);
    const sy = this.body.top + 14;
    const ex = fist ? fist.x - this.facing * 8 : sx + this.facing * 10;
    const ey = fist ? fist.y : sy + 30;
    const mx = (sx + ex) / 2;
    const my = Math.min(sy, ey) - (fist ? 18 : 0);
    const col = glow && telegraphBlink(this.stateTime, this.timing().telegraphMs) ? 0xff5030 : 0x6b7684;
    g.lineStyle(6, 0x39414a, 1).beginPath().moveTo(sx, sy).lineTo(mx, my).lineTo(ex, ey).strokePath();
    g.lineStyle(3, col, 1).beginPath().moveTo(sx, sy).lineTo(mx, my).lineTo(ex, ey).strokePath();
    g.fillStyle(0xffb020, 1).fillCircle(sx, sy, 3).fillCircle(mx, my, 3);
  }

  private drawWeakSpot(): void {
    const g = this.weak;
    g.clear();
    if (!this.vulnerable || this.dead) return;
    const top = this.body.top;
    const pulse = 0.6 + 0.4 * Math.sin(this.stateTime / 70);
    const closing = this.vulnMs - this.stateTime < 500;
    const col = closing && Math.floor(this.stateTime / 80) % 2 ? 0xff5030 : 0xffe14a;
    g.fillStyle(0x222222, 1).fillRect(this.x - 14, top - 2, 28, 4);
    g.fillStyle(col, 0.35 * pulse).fillCircle(this.x, top - 2, 14);
    g.fillStyle(col, 1).fillCircle(this.x, top - 2, 6 + pulse * 2);
    g.fillStyle(0xffffff, 1).fillCircle(this.x, top - 3, 2.5);
    // Down arrow hint above the hatch.
    const ay = top - 22 + Math.sin(this.stateTime / 120) * 3;
    g.fillStyle(0xffe14a, 0.9).fillTriangle(this.x - 6, ay, this.x + 6, ay, this.x, ay + 7);
  }

  protected onDefeatStart(): void {
    this.cleanupAttack();
    this.arm.clear();
    this.weak.clear();
  }

  destroy(fromScene?: boolean): void {
    this.cleanupAttack();
    this.arm?.destroy();
    this.weak?.destroy();
    super.destroy(fromScene);
  }
}
