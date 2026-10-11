import Phaser from 'phaser';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { EV, type HitInfo } from '../types';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { Enemy, type EnemyConfig } from './Enemy';
import { bossPhaseForHp, propNum } from '../enemies/ai';
import { boom } from '../enemies/fx';
import { saveSystem } from '../systems/SaveSystem';
import { reduceFlashing } from '../systems/Accessibility';

/** Arena rectangle for a boss spawn: the Tiled object's rectangle, or props arenaX/arenaWidth (px). */
export function arenaFromSpawn(spawn: SpawnObject): Phaser.Geom.Rectangle {
  const bottom = spawn.y;
  if (spawn.width > 16 && spawn.height > 16) {
    return new Phaser.Geom.Rectangle(spawn.x - spawn.width / 2, bottom - spawn.height, spawn.width, spawn.height);
  }
  const w = propNum(spawn.props, 'arenaWidth', GAME_WIDTH);
  const x = propNum(spawn.props, 'arenaX', spawn.x - w / 2);
  const h = propNum(spawn.props, 'arenaHeight', GAME_HEIGHT - 32);
  return new Phaser.Geom.Rectangle(x, bottom - h, w, h);
}

/**
 * Boss base: arena handling (camera lock + walls), intro, HP/phase events and the
 * defeat sequence (explosion chain, brief slow motion unless reduced motion, camera
 * unlock, EV.BOSS_DEFEATED). Subclasses implement `fight(dt)` and `onPhaseChange()`.
 *
 * Arena convention: the arena rectangle's bottom edge is the floor the boss stands on.
 */
export abstract class Boss extends Enemy {
  abstract readonly bossName: string;
  readonly arena: Phaser.Geom.Rectangle;
  phase = 1;
  started = false;
  defeated = false;
  protected readonly thresholds: number[];
  protected introMs = 1600;
  private walls: Phaser.GameObjects.Zone[] = [];
  private wallGfx?: Phaser.GameObjects.Graphics;
  private colliders: Phaser.Physics.Arcade.Collider[] = [];
  /** Extra objects (drones, markers…) destroyed when the boss is defeated or the scene ends. */
  protected minions: Enemy[] = [];

  constructor(ctx: LevelContext, spawn: SpawnObject, cfg: EnemyConfig, arena: Phaser.Geom.Rectangle, thresholds: number[]) {
    super(ctx, spawn, cfg);
    this.arena = arena;
    this.thresholds = thresholds;
    this.cullMargin = 4000;
    this.setAI('dormant');
    ctx.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.restoreTime());
  }

  get floorY(): number {
    return this.arena.bottom;
  }

  /** The player is inside the arena (with a small margin from the entry edge). */
  protected playerInArena(): boolean {
    const p = this.player;
    return p.x > this.arena.x + 40 && p.x < this.arena.right - 8 && p.y > this.arena.y - 64 && p.y <= this.arena.bottom + 48;
  }

  protected think(dt: number): void {
    if (this.defeated) return;
    if (!this.started) {
      if (this.body.blocked.down) this.body.setVelocityX(0);
      this.idleDormant(dt);
      if (this.playerAlive() && this.playerInArena()) this.startFight();
      return;
    }
    if (this.aiState === 'intro') {
      this.intro(dt);
      if (this.stateTime >= this.introMs) this.beginFight();
      return;
    }
    this.fight(dt);
  }

  /** Hook while waiting for the player. */
  protected idleDormant(_dt: number): void {}

  protected startFight(): void {
    this.started = true;
    const a = this.arena;
    // Camera: the arena horizontally (at least one screen), floor + 2 tiles visible.
    const camW = Math.max(a.width, GAME_WIDTH);
    const camH = Math.max(a.height + 32, GAME_HEIGHT);
    const camRect = new Phaser.Geom.Rectangle(a.centerX - camW / 2, a.bottom + 32 - camH, camW, camH);
    this.ctx.lockCamera(camRect);
    this.closeArena();
    this.setAI('intro');
    this.ctx.events.emit(EV.BOSS_START, this.bossName, this.maxHp);
    this.ctx.events.emit(EV.BOSS_HEALTH, this.hp, this.maxHp);
    this.ctx.events.emit(EV.BOSS_PHASE, 1);
    this.ctx.sfx('boss-roar');
    this.ctx.shake(0.008, 600);
    // Brief safety during the intro.
    this.player.invulnUntil = Math.max(this.player.invulnUntil, this.ctx.now() + this.introMs);
    this.onIntroStart();
  }

  protected onIntroStart(): void {}
  protected intro(_dt: number): void {}
  protected beginFight(): void {
    this.setAI('idle');
  }

  protected abstract fight(dt: number): void;
  protected abstract onPhaseChange(phase: number): void;

  private closeArena(): void {
    const a = this.arena;
    const scene = this.ctx.scene;
    const h = a.height + 160;
    this.wallGfx = scene.add.graphics().setDepth(DEPTH.foreground);
    for (const x of [a.x - 8, a.right + 8]) {
      const z = scene.add.zone(x, a.bottom - h / 2, 16, h);
      scene.physics.add.existing(z, true);
      this.walls.push(z);
      this.colliders.push(scene.physics.add.collider(this.player, z));
      this.colliders.push(scene.physics.add.collider(this.ctx.groups.enemies, z));
      // Visual barrier: hazard-striped energy gate.
      const gx = x < a.centerX ? a.x : a.right - 4;
      for (let y = a.y; y < a.bottom; y += 8) {
        this.wallGfx.fillStyle(((y - a.y) / 8) % 2 ? 0xffd23a : 0x222222, 0.85).fillRect(gx, y, 4, 8);
      }
    }
    this.wallGfx.setAlpha(0);
    scene.tweens.add({ targets: this.wallGfx, alpha: 1, duration: 300 });
    this.ctx.sfx('gate-close');
  }

  private openArena(): void {
    for (const c of this.colliders) c.destroy();
    for (const z of this.walls) z.destroy();
    this.colliders = [];
    this.walls = [];
    const g = this.wallGfx;
    if (g) this.ctx.scene.tweens.add({ targets: g, alpha: 0, duration: 400, onComplete: () => g.destroy() });
    this.wallGfx = undefined;
  }

  takeHit(hit: HitInfo): boolean {
    if (!this.started || this.defeated) return false;
    const dealt = super.takeHit(hit);
    if (!dealt) return false;
    this.ctx.events.emit(EV.BOSS_HEALTH, Math.max(0, this.hp), this.maxHp);
    if (this.hp > 0) {
      const ph = bossPhaseForHp(this.hp, this.thresholds);
      if (ph !== this.phase) {
        this.phase = ph;
        this.ctx.events.emit(EV.BOSS_PHASE, ph);
        this.onPhaseChange(ph);
      }
    }
    return true;
  }

  protected onHurt(_hit: HitInfo): void {
    this.flash(120);
    this.ctx.shake(0.004, 120);
  }

  /** Defeat sequence. */
  die(hit?: HitInfo): void {
    if (this.dead) return;
    this.dead = true;
    this.defeated = true;
    this.hp = 0;
    this.body.setVelocity(0, 0);
    this.body.enable = false;
    this.endTelegraph();
    this.onDefeatStart();
    for (const m of this.minions) if (m.active && !m.dead) m.die();
    this.minions = [];
    for (const p of [...this.ctx.groups.enemyProjectiles.getChildren()]) p.destroy();
    this.ctx.sfx('boss-defeat');
    this.ctx.events.emit(EV.ENEMY_DEFEATED, this.cfg.kind, this.x, this.y);
    void hit;

    const scene = this.ctx.scene;
    const reduced = saveSystem.get().settings.reducedMotion;
    if (!reduced) {
      // Brief slow motion (~1 s real time).
      // Relative to the current scales (assist game speed sets tweens.timeScale).
      this.savedTime ??= { clock: scene.time.timeScale, tweens: scene.tweens.timeScale, world: scene.physics.world.timeScale };
      scene.time.timeScale = 0.4 * this.savedTime.clock;
      scene.tweens.timeScale = 0.4 * this.savedTime.tweens;
      scene.physics.world.timeScale = 2.5 * this.savedTime.world;
      window.setTimeout(() => this.restoreTime(), 1000);
    }
    const w = this.displayWidth;
    const h = this.displayHeight;
    const n = 9;
    for (let i = 0; i < n; i++) {
      scene.time.delayedCall(i * 130, () => {
        if (!this.scene) return;
        const ex = this.x + (Math.random() - 0.5) * w * 0.8;
        const ey = this.y - Math.random() * h * 0.9;
        boom(this.ctx, ex, ey, 10 + Math.random() * 10);
        this.ctx.sfx('explosion');
        this.ctx.shake(0.006, 120);
        // Reduced flashing: a steady red tint instead of a white/red strobe.
        if (reduceFlashing()) this.setTint(0xff5030);
        else this.setTintFill(i % 2 ? 0xffffff : 0xff5030);
      });
    }
    scene.time.delayedCall(n * 130 + 150, () => {
      if (!this.scene) return;
      boom(this.ctx, this.x, this.y - h / 2, 40, 0xffd23a);
      this.ctx.shake(0.015, 500);
      this.ctx.sfx('explosion-big');
      this.clearTint();
      this.scene.tweens.add({ targets: this, alpha: 0, y: this.y + 20, duration: 600 });
      this.restoreTime();
      this.ctx.lockCamera(null);
      this.openArena();
      this.onDefeated();
      this.ctx.events.emit(EV.BOSS_DEFEATED);
      this.scene.time.delayedCall(700, () => this.destroy());
    });
  }

  protected onDefeatStart(): void {}
  protected onDefeated(): void {}

  /** Time scales before the defeat slow-motion (restored afterwards). */
  private savedTime?: { clock: number; tweens: number; world: number };

  private restoreTime(): void {
    const scene = this.ctx.scene;
    if (!scene || !scene.sys) return;
    const saved = this.savedTime;
    if (!saved) return; // no slow motion running (or already restored)
    this.savedTime = undefined;
    if (scene.time) scene.time.timeScale = saved.clock;
    if (scene.tweens) scene.tweens.timeScale = saved.tweens;
    if (scene.physics?.world) scene.physics.world.timeScale = saved.world;
  }

  destroy(fromScene?: boolean): void {
    for (const c of this.colliders) c.destroy();
    for (const z of this.walls) z.destroy();
    this.colliders = [];
    this.walls = [];
    this.wallGfx?.destroy();
    super.destroy(fromScene);
  }
}
