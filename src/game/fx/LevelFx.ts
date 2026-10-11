import Phaser from 'phaser';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { EV, type PickupKind } from '../types';
import type { LevelContext } from '../world/LevelContext';
import { saveSystem } from '../systems/SaveSystem';
import { ensureFxTextures, FX_SOFT } from './FxTextures';
import { FxParticles } from './FxParticles';
import { Shadows } from './Shadows';
import { PlayerRim } from './PlayerRim';
import { Lighting } from './Lighting';
import { PickupGlow, RARE_TINT } from './PickupGlow';
import { fxRng, hitStopFrames, moodFor } from './fxMath';
import { reduceFlashing } from '../systems/Accessibility';

const TWINKLE = ['tw_0', 'tw_1', 'tw_2', 'tw_3'] as const;
const RING = ['ring_0', 'ring_1', 'ring_2', 'ring_3'] as const;
const GOLD = [0xffe36b, 0xffc93a, 0xffffff];

type PickupLike = Phaser.GameObjects.Sprite & { kind?: PickupKind };

interface HarnessLike {
  isManual?: () => boolean;
}

/**
 * Lighting & FX layer for one LevelScene run: drop shadows, player rim light, mood
 * lighting, pickup sparkle/glints/bursts and combat juice (hit-stop, flashes, trails).
 * Purely cosmetic: it reads game objects and listens to level events, never changes
 * gameplay state (hit-stop only pauses the physics world for 1-3 rendered frames, and
 * not at all under the deterministic test harness).
 */
export class LevelFx {
  readonly high: boolean;
  private readonly reducedMotion: boolean;
  private readonly particles: FxParticles;
  private readonly shadows: Shadows;
  private readonly rim: PlayerRim;
  private readonly glow: PickupGlow | null;
  readonly lighting: Lighting;
  private readonly rng = fxRng(0xc0ffee);
  private readonly flash: Phaser.GameObjects.Image;
  private glintTimer = 0;
  private sparkleTimer = 0;
  private hitStop = 0;
  private trailMs = 0;
  private trailKind: 'airJump' | 'dash' | null = null;
  private trailTimer = 0;
  private lastBossHp = -1;
  private wasGrounded = true;
  private lastVy = 0;
  private readonly offs: [string, (...a: never[]) => void][] = [];
  /** Cost of the last update() in ms (exposed for perf checks). */
  lastUpdateMs = 0;
  lastLateMs = 0;
  private enabled = true;
  private owned: Phaser.GameObjects.Components.Visible[] = [];
  private ownedVisible: boolean[] = [];

  constructor(private readonly ctx: LevelContext) {
    const scene = ctx.scene;
    const settings = saveSystem.get().settings;
    this.high = settings.effects !== 'low';
    this.reducedMotion = settings.reducedMotion;
    ensureFxTextures(scene);
    const firstChild = scene.children.list.length;
    const mood = moodFor(ctx.level.theme);
    this.lighting = new Lighting(ctx, mood, this.high, this.reducedMotion);
    this.shadows = new Shadows(ctx, this.high ? 40 : 16, this.high);
    this.rim = new PlayerRim(ctx.player, mood.rimColor, mood.rimAlpha);
    this.glow = this.high ? new PickupGlow(ctx, 8, !this.reducedMotion) : null;
    this.particles = new FxParticles(scene, this.high ? 96 : 32);
    this.flash = scene.add
      .image(0, 0, FX_SOFT, 'white')
      .setOrigin(0)
      .setScrollFactor(0)
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH.foreground + 5)
      .setAlpha(0)
      .setVisible(false);
    this.owned = scene.children.list.slice(firstChild) as unknown as Phaser.GameObjects.Components.Visible[];

    this.on(EV.PICKUP, (kind: PickupKind, x: number, y: number) => this.onPickup(kind, x, y));
    this.on(EV.ENEMY_DEFEATED, (_kind: string, x: number, y: number) => this.onEnemyDefeated(x, y));
    this.on(EV.BOSS_HEALTH, (hp: number) => this.onBossHealth(hp));
    this.on(EV.ABILITY_USED, (ability: string) => {
      if (ability === 'airJump' || ability === 'dash') {
        this.trailKind = ability;
        this.trailMs = ability === 'dash' ? 240 : 420;
        this.trailTimer = 0;
      }
    });
    // Shadows and the rim follow sprites, so they run after the physics → sprite sync.
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.lateUpdate, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  private on(ev: string, handler: (...a: never[]) => void): void {
    const fn = (...a: never[]) => {
      if (this.enabled) handler(...a);
    };
    this.ctx.events.on(ev, fn);
    this.offs.push([ev, fn]);
  }

  private destroy(): void {
    this.ctx.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.lateUpdate, this);
    for (const [ev, fn] of this.offs) this.ctx.events.off(ev, fn);
    this.offs.length = 0;
    if (this.hitStop > 0) this.ctx.scene.physics.world?.resume();
    this.hitStop = 0;
  }

  // ───────────── per frame ─────────────

  /** Debug/perf A-B switch: hide every FX object and skip all FX work. */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.particles.clear();
    if (on) {
      // Static lighting objects come back; pooled ones are re-shown by their updates.
      this.owned.forEach((o, i) => o.setVisible(this.ownedVisible[i]));
      return;
    }
    this.ownedVisible = this.owned.map((o) => o.visible);
    for (const o of this.owned) o.setVisible(false);
  }

  /** Timers, particles and events (called from LevelScene.step). */
  update(dtMs: number): void {
    if (!this.enabled) return;
    const t0 = performance.now();
    if (this.hitStop > 0 && --this.hitStop === 0) this.ctx.scene.physics.world.resume();
    this.lighting.update(dtMs);
    if (this.high) {
      this.updateGlints(dtMs);
      this.updateTrails(dtMs);
      this.updateLanding();
    }
    this.particles.update(dtMs);
    this.updateFlash(dtMs);
    this.lastUpdateMs = performance.now() - t0;
  }

  /** After the physics step has moved the sprites: shadows and rim light. */
  private lateUpdate(): void {
    if (!this.enabled) return;
    const t0 = performance.now();
    this.shadows.update();
    this.updateRim();
    this.glow?.update(this.ctx.scene.game.loop.delta);
    this.lastLateMs = performance.now() - t0;
  }

  private updateRim(): void {
    const p = this.ctx.player;
    this.rim.setBoost(this.lighting.darkZones.length ? this.lighting.darkness(p.x, p.y - 12) : 0);
    this.rim.update();
  }

  /** Coins: an occasional twinkle on a random on-screen coin; rare pickups: a gentle sparkle loop. */
  private updateGlints(dtMs: number): void {
    this.glintTimer -= dtMs;
    this.sparkleTimer -= dtMs;
    const doGlint = this.glintTimer <= 0;
    const doSparkle = this.sparkleTimer <= 0;
    if (!doGlint && !doSparkle) return;
    if (doGlint) this.glintTimer = 140 + this.rng() * 160;
    if (doSparkle) this.sparkleTimer = 260;
    const view = this.ctx.scene.cameras.main.worldView;
    const list = this.ctx.groups.pickups.getChildren() as PickupLike[];
    // Pick a random starting index and take the first on-screen coin from there (no allocation).
    const n = list.length;
    if (!n) return;
    let glinted = !doGlint;
    const start = Math.floor(this.rng() * n);
    for (let k = 0; k < n; k++) {
      const c = list[(start + k) % n];
      if (!c.active || !c.visible || c.alpha < 0.9) continue;
      if (c.x < view.x - 8 || c.x > view.right + 8 || c.y < view.y - 8 || c.y > view.bottom + 8) continue;
      if (c.kind === 'coin') {
        if (!glinted) {
          glinted = true;
          this.twinkle(c.x + (this.rng() * 8 - 4), c.y - 3 - this.rng() * 5, 0xffffff, 300);
        }
      } else if (doSparkle && c.kind) {
        const tint = RARE_TINT[c.kind] ?? 0xffffff;
        const a = this.rng() * Math.PI * 2;
        const r = 7 + this.rng() * 4;
        this.twinkle(c.x + Math.cos(a) * r, c.y - 8 + Math.sin(a) * r, this.rng() < 0.5 ? 0xffffff : tint, 420);
      }
    }
  }

  private twinkle(x: number, y: number, tint: number, lifeMs: number): void {
    this.particles.spawn({ x, y, frames: TWINKLE, pingPong: true, lifeMs, tint, alpha: 1, alphaEnd: 0.6, depth: DEPTH.pickups + 1 });
  }

  private updateTrails(dtMs: number): void {
    if (this.trailMs <= 0 || !this.trailKind) return;
    this.trailMs -= dtMs;
    this.trailTimer -= dtMs;
    if (this.trailTimer > 0) return;
    const p = this.ctx.player;
    if (!p.isAlive()) return;
    const b = p.body;
    if (this.trailKind === 'airJump') {
      this.trailTimer = 30;
      for (let i = 0; i < 2; i++) {
        const x = b.center.x + (this.rng() * 16 - 8);
        const y = b.bottom - 2 - this.rng() * (b.height * 0.7);
        const big = this.rng() < 0.6;
        this.particles.spawn({
          x, y, vx: (this.rng() - 0.5) * 30, vy: 5 + this.rng() * 20, drag: 2, lifeMs: 460 + this.rng() * 200,
          frames: big ? TWINKLE : ['plus'], pingPong: big,
          tint: this.rng() < 0.35 ? 0xffffff : this.rng() < 0.5 ? 0xff8af0 : 0xffc6f6, alpha: 1, alphaEnd: 0.2,
          depth: DEPTH.player - 1,
        });
      }
    } else {
      this.trailTimer = 28;
      const dir = p.facing;
      for (let i = 0; i < 2; i++) {
        const y = b.top + 3 + this.rng() * (b.height - 6);
        const x = b.center.x - dir * (10 + this.rng() * 10);
        this.particles.spawn({
          x, y, vx: -dir * (60 + this.rng() * 60), lifeMs: 160 + this.rng() * 60, frames: ['line'],
          scale: 1, alpha: 0.85, tint: i ? 0xffe0b0 : 0xffffff, depth: DEPTH.player - 1, flipX: dir < 0,
        });
      }
    }
  }

  /** Extra dust kick on hard landings (complements the existing 'dust' effect). */
  private updateLanding(): void {
    const p = this.ctx.player;
    const g = p.grounded;
    if (g && !this.wasGrounded && this.lastVy > 260 && !this.reducedMotion) {
      const b = p.body;
      for (let i = 0; i < 6; i++) {
        const side = i % 2 ? 1 : -1;
        this.particles.spawn({
          x: b.center.x + side * (4 + this.rng() * 4), y: b.bottom - 1,
          vx: side * (30 + this.rng() * 50), vy: -10 - this.rng() * 25, gravity: 120, drag: 3,
          lifeMs: 300 + this.rng() * 150, frames: ['dot2'], tint: 0xd8d0c0, alpha: 0.9, depth: DEPTH.player + 1,
        });
      }
    }
    this.wasGrounded = g;
    this.lastVy = p.body ? p.body.velocity.y : 0;
  }

  private updateFlash(dtMs: number): void {
    const f = this.flash;
    if (!f.visible) return;
    const a = f.alpha - dtMs / 110;
    if (a <= 0) f.setAlpha(0).setVisible(false);
    else f.setAlpha(a);
  }

  // ───────────── events ─────────────

  private onPickup(kind: PickupKind, x: number, y: number): void {
    const coin = kind === 'coin';
    const n = this.high ? (coin ? 6 : 14) : coin ? 0 : 6;
    const tint = coin ? undefined : (RARE_TINT[kind] ?? 0xffffff);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rng() * 0.5;
      const sp = coin ? 55 + this.rng() * 40 : 70 + this.rng() * 70;
      this.particles.spawn({
        x, y: y - 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, gravity: 220, drag: 2.5,
        lifeMs: coin ? 320 : 520, frames: coin ? ['dot2'] : i % 3 ? ['dot2'] : TWINKLE,
        tint: coin ? GOLD[i % GOLD.length] : i % 2 ? 0xffffff : tint, alpha: 1, alphaEnd: 0.1,
      });
    }
    // Soft additive flash at the pickup point.
    this.particles.spawn({
      x, y: y - 6, frames: ['glow'], soft: true, add: true, lifeMs: coin ? 180 : 320,
      tint: coin ? 0xffd860 : tint, alpha: coin ? 0.7 : 0.9, scale: coin ? 0.5 : 0.8, scaleEnd: coin ? 1 : 1.8,
    });
    if (!coin) this.particles.spawn({ x, y: y - 6, frames: RING, lifeMs: 300, tint: 0xffffff, alpha: 1, alphaEnd: 0 });
  }

  private onEnemyDefeated(x: number, y: number): void {
    this.startHitStop(hitStopFrames(this.ctx.player.body.velocity.y < 0 ? 'stomp' : 'defeat'));
    const cy = y - 10;
    this.particles.spawn({ x, y: cy, frames: RING, lifeMs: 220, tint: 0xffffff, alpha: 1, alphaEnd: 0 });
    this.particles.spawn({ x, y: cy, frames: ['glow'], soft: true, add: true, lifeMs: 200, tint: 0xffffff, alpha: 0.9, scale: 0.6, scaleEnd: 1.4 });
    if (!this.high) return;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.particles.spawn({
        x: x + Math.cos(a) * 4, y: cy + Math.sin(a) * 4, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90 - 20, drag: 5,
        lifeMs: 260, frames: i % 2 ? ['plus'] : ['dot2'], tint: 0xffffff, alpha: 1, alphaEnd: 0,
      });
    }
  }

  private onBossHealth(hp: number): void {
    const prev = this.lastBossHp;
    this.lastBossHp = hp;
    if (prev < 0 || hp >= prev) return;
    this.startHitStop(hitStopFrames('bossHit'));
    if (!this.reducedMotion && !reduceFlashing()) this.flash.setVisible(true).setAlpha(hp <= 0 ? 0.6 : 0.32);
  }

  private startHitStop(frames: number): void {
    if (frames <= 0) return;
    const h = (window as unknown as { __harness?: HarnessLike }).__harness;
    if (h?.isManual?.()) return; // keep harness-stepped simulations frame-exact
    const world = this.ctx.scene.physics.world;
    if (!world || world.isPaused) return;
    world.pause();
    this.hitStop = frames;
  }
}
