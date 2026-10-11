import Phaser from 'phaser';
import { DEPTH } from '../config';
import type { HitInfo } from '../types';
import { Boss, arenaFromSpawn } from '../entities/Boss';
import type { StompOutcome } from '../entities/Enemy';
import { EnemyProjectile } from '../entities/Projectile';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { playAnim } from '../systems/AnimationSystem';
import { ENEMY_FRAME_SIZE } from './enemyArt';
import { applyStatOverrides, telegraphBlink } from './ai';
import { ring, shadowMarker } from './fx';
import { Gnat } from './Gnat';
import { Wasp } from './Wasp';
import {
  OVERSEER_HP,
  beamSweepPlan,
  beamX,
  boxHitsSegment,
  laserArms,
  laserFloorReach,
  overseerAttack,
  overseerThresholds,
  overseerTiming,
  slamTargetX,
  type BeamPlan,
  type OverseerAttack,
} from './overseerPlan';

/** Pod hitbox (the shell above the tentacles) and how far it sits above the sprite's bottom. */
const POD = { width: 44, height: 40 };
const POD_LIFT = 38;
/** Sprite bottom above the floor while hovering. */
const HOVER = 100;
/** Slam tracking height (sprite bottom above the floor). */
const SLAM_HOVER = 84;
/** Laser: eye height above the floor and arm length. */
const LASER_EYE = 128;
const LASER_LEN = 136;
/** The eye/centre of the pod relative to the sprite bottom. */
const EYE_DY = -66;
/** The weak-spot core hangs at the tentacle tips (frame 80x96: the diamond around y = 88). */
const CORE = { width: 26, height: 18, dy: -1 };

/**
 * BOSS — THE OVERSEER: the alien mothership pod hovering over the Wrigley outfield.
 * 9 hp (3 per phase), see enemies/overseerPlan.ts for the full design:
 *  - P1 tractor-beam sweep over the player's half (floor zone telegraphed), gnat pods;
 *  - P2 tentacle slam (tracks, locks over a blinking marker, drops) + floor shockwaves;
 *  - P3 wasps, double slams and a spinning laser (danger zone blinks first).
 * After a beam / slam / laser the pod sinks to the grass and the core between its tentacle
 * tips glows: one stomp = 1 damage and the pod rises again. Only the core takes damage
 * (while the pod is down its hitbox shrinks to the core, so stomp detection — and the
 * PlatformBot — treat it like any boss weak spot: stompOutcome 'damage' only then);
 * (stomps, projectiles, abilities); the shell bounces stomps.
 *
 * Spawn: `boss <tx> <ty> width=26 height=13 kind=overseer` (the rectangle is the arena).
 */
export class OverseerBoss extends Boss {
  readonly bossName: string;
  private readonly fx: Phaser.GameObjects.Graphics;
  private readonly glow: Phaser.GameObjects.Graphics;
  /** Current hitbox: the pod shell, or the core while the window is open. */
  private onCore = false;
  private attackIndex = 0;
  private forced: OverseerAttack[] = [];
  private current: OverseerAttack | null = null;
  private plan?: BeamPlan;
  private beam?: EnemyProjectile;
  private slamsLeft = 0;
  private slamX = 0;
  private marker?: Phaser.GameObjects.Graphics;
  private laserAngle = 0;
  private laserZone = 0;
  private bob = 0;
  /** Attack counter (debug/tests). */
  attacks = 0;

  constructor(ctx: LevelContext, spawn: SpawnObject) {
    const arena = arenaFromSpawn(spawn);
    const stats = applyStatOverrides({ hp: OVERSEER_HP, contactDamage: 1 }, spawn.props);
    super(
      ctx,
      { ...spawn, x: arena.centerX, y: arena.bottom - HOVER },
      { kind: 'overseer', hp: OVERSEER_HP, contactDamage: 1, stompable: true, body: POD, bodyLift: POD_LIFT, gravity: false, frameSize: ENEMY_FRAME_SIZE.overseer },
      arena,
      overseerThresholds(stats.hp),
    );
    this.bossName = String(spawn.props.name ?? 'The Overseer');
    this.fx = ctx.scene.add.graphics().setDepth(DEPTH.projectiles).setBlendMode(Phaser.BlendModes.ADD);
    this.glow = ctx.scene.add.graphics().setDepth(DEPTH.enemies + 2);
    // Flies through the arena's one-way ledges (only the scripted y matters).
    // (tile collision is per face; overlaps with the player still work — `none` would disable those too).
    const cc = this.body.checkCollision;
    cc.up = cc.down = cc.left = cc.right = false;
  }

  // ───────────── combat hooks ─────────────

  /** The core is open (pod down on the grass). */
  get vulnerable(): boolean {
    return this.aiState === 'vulnerable';
  }

  /** Current attack (tests / debug). */
  get attack(): OverseerAttack | null {
    return this.current;
  }

  /** World position of the core's bottom centre (tests / bots). */
  get corePos(): { x: number; y: number } {
    return { x: this.x, y: this.y + CORE.dy };
  }

  stompOutcome(): StompOutcome {
    return this.vulnerable ? 'damage' : 'bounce';
  }

  hurtsOnContact(): boolean {
    if (!this.started || this.defeated) return false;
    if (!['idle', 'beamWarn', 'beamSweep', 'slamTrack', 'slamWarn', 'slamFall', 'laserMove', 'laserWarn', 'laserSpin', 'summon'].includes(this.aiState)) return false;
    return super.hurtsOnContact();
  }

  /** Only the open core takes damage (stomps, projectiles, abilities). */
  protected blocksHit(): boolean {
    return !this.vulnerable;
  }

  takeHit(hit: HitInfo): boolean {
    if (!this.vulnerable || this.defeated) return super.takeHit(hit); // blocked (spark + clink)
    // A stomp always deals exactly 1 so the fight is the same length for every character.
    const amount = hit.kind === 'stomp' ? 1 : Math.min(hit.amount, 2);
    const dealt = super.takeHit({ ...hit, amount });
    if (!dealt) return false;
    this.invulnUntil = this.ctx.now() + (hit.kind === 'stomp' ? 250 : 600);
    this.ctx.sfx('boss-hit');
    if (!this.dead && this.aiState === 'vulnerable') {
      // Push the player clear of the pod and close the window.
      const away = this.player.x < this.x ? -1 : 1;
      if (hit.kind === 'stomp') this.player.body.setVelocityX(away * 150);
      this.startRise();
    }
    return true;
  }

  onStomp(): void {
    if (!this.vulnerable) {
      this.ctx.sfx('bump');
      return;
    }
    this.takeHit({ amount: 1, fromX: this.player.x, kind: 'stomp' });
  }

  /** Hitbox follows the weak spot: pod shell normally, the core at the tentacle tips while open. */
  protected syncBodyOffset(): void {
    const b = this.body;
    const lift = this.onCore ? -CORE.dy : POD_LIFT;
    b.setOffset((this.width - b.sourceWidth) / 2, this.height - b.sourceHeight - lift);
  }

  private setCoreBody(on: boolean): void {
    if (this.onCore === on) return;
    this.onCore = on;
    if (on) this.resizeBody(CORE.width, CORE.height);
    else this.resizeBody(POD.width, POD.height);
  }

  protected onHurt(_hit: HitInfo): void {
    playAnim(this, 'hit', 'idle', false);
    this.flash(120);
    this.ctx.shake(0.004, 120);
  }

  // ───────────── boss flow ─────────────

  protected idleDormant(dt: number): void {
    this.bob += dt;
    playAnim(this, 'idle');
    this.body.setVelocity(0, (this.homeY + Math.sin(this.bob / 600) * 4 - this.y) * 3);
  }

  protected onIntroStart(): void {
    this.telegraph(this.introMs, 0x7aff9a, false);
    this.showMark('!!', this.introMs, '#7aff9a');
  }

  protected intro(dt: number): void {
    this.bob += dt;
    playAnim(this, 'attack', 'idle');
    this.body.setVelocity(0, (this.homeY + Math.sin(this.bob / 300) * 6 - this.y) * 3);
  }

  protected onPhaseChange(phase: number): void {
    this.ctx.sfx('boss-roar');
    this.ctx.shake(0.01, 500);
    this.cleanupAttack();
    this.setCoreBody(false);
    this.forced = phase === 2 ? ['slam'] : ['wasps', 'laser'];
    this.attackIndex = 0;
    this.invulnUntil = this.ctx.now() + 900;
    this.playerGraceUntil = this.ctx.now() + 900;
    this.showMark(phase === 2 ? 'GRRR!' : 'FULL POWER!', 1100, '#7aff9a');
    this.setAI('rage');
  }

  private timing() {
    return overseerTiming(this.phase);
  }

  private minionsAlive(): { gnats: number; wasps: number } {
    this.minions = this.minions.filter((m) => m.active && !m.dead);
    return { gnats: this.minions.filter((m) => m instanceof Gnat).length, wasps: this.minions.filter((m) => m instanceof Wasp).length };
  }

  /** Steer toward (x, sprite-bottom y) with a capped speed. Returns true once there. */
  private moveTo(tx: number, ty: number, max = 180, k = 4): boolean {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const vx = Phaser.Math.Clamp(dx * k, -max, max);
    const vy = Phaser.Math.Clamp(dy * k, -max, max);
    this.body.setVelocity(vx, vy);
    return Math.abs(dx) < 3 && Math.abs(dy) < 3;
  }

  private get hoverY(): number {
    return this.floorY - HOVER;
  }

  private nextAttack(): void {
    const atk = this.forced.shift() ?? overseerAttack(this.phase, this.attackIndex++, this.minionsAlive());
    this.current = atk;
    this.attacks++;
    const t = this.timing();
    const a = this.arena;
    switch (atk) {
      case 'beam': {
        this.plan = beamSweepPlan(a.x, a.width, this.player.x);
        this.telegraph(t.beamWarnMs, 0x7aff9a, false);
        this.showMark('BEAM!', t.beamWarnMs, '#7aff9a');
        this.ctx.sfx('enemy-telegraph');
        this.setAI('beamWarn');
        break;
      }
      case 'slam':
        this.slamsLeft = t.slams;
        playAnim(this, 'attack', 'idle');
        this.setAI('slamTrack');
        break;
      case 'laser':
        this.laserZone = Math.ceil(laserFloorReach(this.floorY - LASER_EYE, this.floorY - 34, LASER_LEN)) + 10;
        this.setAI('laserMove');
        break;
      case 'gnats':
      case 'wasps':
        this.telegraph(700, atk === 'gnats' ? 0x7be0d8 : 0xff6aa8, false);
        this.ctx.sfx('summon');
        this.setAI('summon');
        break;
    }
  }

  private cleanupAttack(): void {
    this.beam?.destroy();
    this.beam = undefined;
    this.marker?.destroy();
    this.marker = undefined;
    this.fx.clear();
  }

  private startSink(): void {
    this.cleanupAttack();
    this.setAI('sink');
  }

  private startRise(): void {
    this.setCoreBody(false);
    this.playerGraceUntil = this.ctx.now() + 700;
    this.endTelegraph();
    this.setAI('rise');
  }

  protected fight(dt: number): void {
    const t = this.timing();
    const a = this.arena;
    const now = this.ctx.now();
    this.bob += dt;
    this.fx.clear();
    switch (this.aiState) {
      case 'idle': {
        playAnim(this, 'move', 'idle');
        const tx = Phaser.Math.Clamp(this.player.x + (this.player.x < a.centerX ? 60 : -60), a.x + 50, a.right - 50);
        this.moveTo(tx, this.hoverY + Math.sin(this.bob / 500) * 5, 70, 2);
        if (this.stateTime >= t.idleMs) this.nextAttack();
        break;
      }
      case 'rage':
      case 'rise': {
        playAnim(this, this.aiState === 'rage' ? 'attack' : 'move', 'idle');
        const there = this.moveTo(this.x, this.hoverY, this.aiState === 'rage' ? 160 : 120);
        if (there && this.stateTime >= (this.aiState === 'rage' ? 1100 : 300)) this.setAI('idle');
        break;
      }
      // ── tractor beam ──
      case 'beamWarn': {
        const plan = this.plan!;
        playAnim(this, 'attack', 'idle');
        this.moveTo(plan.fromX, this.hoverY, 360, 8);
        const on = telegraphBlink(this.stateTime, t.beamWarnMs);
        // Floor zone the sweep will cover + the column outline where it starts.
        this.fx.fillStyle(0x7aff9a, on ? 0.5 : 0.18).fillRect(plan.zoneMin, this.floorY - 6, plan.zoneMax - plan.zoneMin, 6);
        this.fx.fillStyle(0x7aff9a, on ? 0.12 : 0.04).fillRect(plan.zoneMin, this.floorY - 40, plan.zoneMax - plan.zoneMin, 34);
        this.fx.lineStyle(1, 0x7aff9a, on ? 0.9 : 0.35).strokeRect(this.x - 11, this.y - 30, 22, this.floorY - this.y + 30);
        if (this.stateTime >= t.beamWarnMs) {
          this.body.setVelocity(0, 0);
          const top = this.y - 30;
          const h = this.floorY - top;
          this.beam = new EnemyProjectile(this.ctx, this.x, top + h / 2, { style: 'beam', persistent: true, ignoreTerrain: true, lifetimeMs: t.beamSweepMs + 500, body: { width: 18, height: Math.round(h) } });
          this.beam.setAlpha(0);
          this.ctx.sfx('beam');
          this.ctx.shake(0.002, t.beamSweepMs);
          this.setAI('beamSweep');
        }
        break;
      }
      case 'beamSweep': {
        const plan = this.plan!;
        const x = beamX(plan, this.stateTime, t.beamSweepMs);
        this.body.setVelocity(0, 0);
        this.setPosition(x, this.hoverY);
        this.body.reset(x, this.hoverY);
        if (this.beam?.active) {
          this.beam.setPosition(x, this.beam.y);
          this.beam.body.reset(x, this.beam.y);
        }
        this.drawBeam(x);
        if (this.stateTime >= t.beamSweepMs) {
          this.ctx.sfx('fizzle');
          this.startSink();
        }
        break;
      }
      // ── tentacle slam ──
      case 'slamTrack': {
        playAnim(this, 'attack', 'idle');
        const tx = slamTargetX(this.player.x, a.x, a.width);
        this.moveTo(tx, this.floorY - SLAM_HOVER, 150, 3);
        if (this.stateTime >= t.slamTrackMs) {
          this.slamX = this.x;
          this.marker = shadowMarker(this.ctx, this.slamX, this.floorY, 60, t.slamWarnMs);
          this.telegraph(t.slamWarnMs, 0xff3030, false);
          this.showMark('SLAM!', t.slamWarnMs, '#ff5030');
          this.ctx.sfx('debris-warn');
          this.setAI('slamWarn');
        }
        break;
      }
      case 'slamWarn': {
        // Rear up a little, then drop.
        this.moveTo(this.slamX, this.floorY - SLAM_HOVER - 14, 80, 4);
        if (this.stateTime >= t.slamWarnMs) {
          this.body.setVelocity(0, 520);
          this.setAI('slamFall');
        }
        break;
      }
      case 'slamFall':
        this.body.setVelocity(0, 520);
        if (this.y >= this.floorY || this.stateTime > 1500) {
          this.body.setVelocity(0, 0);
          this.setY(this.floorY);
          this.body.reset(this.x, this.floorY);
          this.impact();
          this.slamsLeft--;
          this.setAI(this.slamsLeft > 0 ? 'slamBounce' : 'vulnerablePrep');
        }
        break;
      case 'slamBounce':
        // Combo: a short hop back up, then track again.
        this.moveTo(this.x, this.floorY - SLAM_HOVER, 200);
        if (this.stateTime >= 550) this.setAI('slamTrack');
        break;
      // ── spinning laser ──
      case 'laserMove': {
        playAnim(this, 'move', 'idle');
        const there = this.moveTo(a.centerX, this.floorY - LASER_EYE - EYE_DY, 200);
        if (there || this.stateTime > 2000) {
          this.telegraph(t.laserWarnMs, 0xff3030, false);
          this.showMark('STAY BACK!', t.laserWarnMs, '#ff5030');
          this.ctx.sfx('enemy-telegraph');
          this.laserAngle = Math.PI; // arms start horizontal
          this.setAI('laserWarn');
        }
        break;
      }
      case 'laserWarn': {
        this.body.setVelocity(0, 0);
        playAnim(this, 'attack', 'idle');
        const on = telegraphBlink(this.stateTime, t.laserWarnMs);
        this.fx.fillStyle(0xff3030, on ? 0.45 : 0.15).fillRect(this.x - this.laserZone, this.floorY - 4, this.laserZone * 2, 4);
        this.fx.lineStyle(1, 0xff3030, on ? 0.6 : 0.2).strokeRect(this.x - this.laserZone, this.floorY - 40, this.laserZone * 2, 40);
        this.drawLaser(on ? 0.25 : 0.08, false);
        if (this.stateTime >= t.laserWarnMs) {
          this.ctx.sfx('beam');
          this.setAI('laserSpin');
        }
        break;
      }
      case 'laserSpin': {
        this.body.setVelocity(0, 0);
        this.laserAngle = Math.PI + (this.stateTime / t.laserSpinMs) * Math.PI * 2;
        this.fx.fillStyle(0xff3030, 0.18).fillRect(this.x - this.laserZone, this.floorY - 4, this.laserZone * 2, 4);
        this.drawLaser(1, true);
        if (this.stateTime >= t.laserSpinMs) this.startSink();
        break;
      }
      // ── summons ──
      case 'summon':
        playAnim(this, 'attack', 'idle');
        this.moveTo(this.x, this.hoverY, 60);
        if (this.stateTime >= 700) {
          this.summon(this.current === 'wasps' ? 'wasps' : 'gnats');
          this.setAI('idle');
          this.stateTime = Math.max(0, t.idleMs - 600);
        }
        break;
      // ── weak-spot window ──
      case 'sink':
        playAnim(this, 'idle');
        this.body.setVelocity(0, Math.min(260, (this.floorY - this.y) * 6 + 60));
        if (this.y >= this.floorY - 1) {
          this.setY(this.floorY);
          this.body.reset(this.x, this.floorY);
          this.ctx.shake(0.003, 120);
          this.ctx.effect('dust', this.x, this.floorY);
          this.setAI('vulnerablePrep');
        }
        break;
      case 'vulnerablePrep':
        this.body.setVelocity(0, 0);
        this.setCoreBody(true);
        this.endTelegraph();
        this.ctx.sfx('boss-vulnerable');
        this.showMark('STOMP THE CORE!', 1200, '#ffe14a');
        this.setAI('vulnerable');
        break;
      case 'vulnerable':
        this.body.setVelocity(0, 0);
        playAnim(this, 'idle');
        if (this.stateTime >= t.vulnerableMs) this.startRise();
        break;
      default:
        this.setAI('idle');
    }
    this.drawCore(now);
  }

  private impact(): void {
    const a = this.arena;
    this.ctx.shake(0.012, 260);
    this.ctx.sfx('boss-slam');
    this.ctx.effect('dust', this.x - 20, this.floorY);
    this.ctx.effect('dust', this.x + 20, this.floorY, { flipX: true });
    this.marker?.destroy();
    this.marker = undefined;
    for (const dir of [-1, 1] as const) {
      this.shoot(this.x + dir * 38, this.floorY - 6, {
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

  private summon(kind: 'gnats' | 'wasps'): void {
    const a = this.arena;
    const t = this.timing();
    const alive = this.minionsAlive();
    if (kind === 'gnats') {
      // Gnat pods drop from the pod's belly and hatch to either side.
      for (const dx of [-36, 36]) {
        if (this.minionsAlive().gnats >= t.maxGnats) break;
        const x = Phaser.Math.Clamp(this.x + dx, a.x + 30, a.right - 30);
        const y = this.floorY - 40;
        ring(this.ctx, x, y - 4, 0x7aff9a, 16);
        const g = new Gnat(this.ctx, { id: 950 + this.attacks * 2 + (dx > 0 ? 1 : 0), type: 'enemy', name: 'overseer-gnat', x, y, width: 16, height: 16, props: { kind: 'gnat', range: 40, sight: 160 } });
        this.minions.push(g);
      }
    } else {
      const spots = [
        { x: a.x + 56, y: a.y + 70 },
        { x: a.right - 56, y: a.y + 70 },
      ];
      let n = alive.wasps;
      for (const s of spots) {
        if (n >= t.maxWasps) break;
        ring(this.ctx, s.x, s.y - 6, 0xff6aa8, 18);
        const w = new Wasp(this.ctx, { id: 970 + n, type: 'enemy', name: 'overseer-wasp', x: s.x, y: s.y, width: 16, height: 16, props: { kind: 'wasp', sight: 260 } });
        this.minions.push(w);
        n++;
      }
    }
  }

  // ───────────── visuals ─────────────

  private drawBeam(x: number): void {
    const g = this.fx;
    const top = this.y - 30;
    const pulse = 0.75 + 0.25 * Math.sin(this.bob / 60);
    g.fillStyle(0x7aff9a, 0.28 * pulse).fillRect(x - 13, top, 26, this.floorY - top);
    g.fillStyle(0xb8ffcc, 0.45 * pulse).fillRect(x - 7, top, 14, this.floorY - top);
    g.fillStyle(0xffffff, 0.6).fillRect(x - 2, top, 4, this.floorY - top);
    g.fillStyle(0x7aff9a, 0.5).fillEllipse(x, this.floorY - 1, 44, 8);
    // Little motes rising in the beam.
    for (let i = 0; i < 6; i++) {
      const yy = this.floorY - (((this.bob / 4 + i * 23) % (this.floorY - top)));
      g.fillStyle(0xffffff, 0.8).fillRect(Math.round(x - 6 + ((i * 5) % 12)), Math.round(yy), 2, 2);
    }
  }

  private laserSegments() {
    return laserArms(this.x, this.y + EYE_DY, this.laserAngle, LASER_LEN);
  }

  private drawLaser(alpha: number, hurt: boolean): void {
    const g = this.fx;
    for (const [ax, ay, bx, by] of this.laserSegments()) {
      g.lineStyle(7, 0xff3060, 0.35 * alpha).lineBetween(ax, ay, bx, by);
      g.lineStyle(3, 0xff6a8a, 0.9 * alpha).lineBetween(ax, ay, bx, by);
      g.lineStyle(1, 0xffffff, alpha).lineBetween(ax, ay, bx, by);
      if (alpha >= 1) g.fillStyle(0xffd0e0, 0.8).fillCircle(bx, by, 3);
    }
    if (!hurt) return;
    const p = this.player;
    if (!p.isAlive() || p.isInvulnerable()) return;
    const b = p.body;
    for (const seg of this.laserSegments()) {
      if (boxHitsSegment(b.left, b.top, b.right, b.bottom, seg, 2)) {
        p.hurt({ amount: 1, fromX: this.x, kind: 'projectile' });
        break;
      }
    }
  }

  /** Glowing core + arrow while the pod is down. */
  private drawCore(now: number): void {
    const g = this.glow;
    g.clear();
    if (this.dead) return;
    const c = this.corePos;
    if (this.aiState === 'vulnerable') {
      const t = this.timing();
      const pulse = 0.6 + 0.4 * Math.sin(this.stateTime / 70);
      const closing = t.vulnerableMs - this.stateTime < 500;
      const col = closing && Math.floor(this.stateTime / 80) % 2 ? 0xff5030 : 0xffe14a;
      g.fillStyle(col, 0.3 * pulse).fillCircle(c.x, c.y - 8, 16);
      g.fillStyle(col, 0.9).fillCircle(c.x, c.y - 8, 5 + pulse * 2);
      g.fillStyle(0xffffff, 1).fillCircle(c.x, c.y - 9, 2);
      const ay = c.y - 40 + Math.sin(this.stateTime / 120) * 3;
      g.fillStyle(0xffe14a, 0.95).fillTriangle(c.x - 6, ay, c.x + 6, ay, c.x, ay + 7);
    } else if (this.aiState === 'sink') {
      g.fillStyle(0xffe14a, 0.3 + 0.2 * Math.sin(now / 60)).fillCircle(c.x, c.y - 8, 6);
    }
  }

  protected onDefeatStart(): void {
    this.cleanupAttack();
    this.glow.clear();
  }

  destroy(fromScene?: boolean): void {
    this.cleanupAttack();
    this.fx?.destroy();
    this.glow?.destroy();
    super.destroy(fromScene);
  }
}
