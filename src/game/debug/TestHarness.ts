import Phaser from 'phaser';
import type { LevelScene } from '../scenes/LevelScene';
import { gameState } from '../state/GameState';
import { saveSystem } from '../systems/SaveSystem';
import { getSpawner } from '../world/registry';
import { CHARACTER_IDS, EV, type CharacterId, type EnemyKind } from '../types';
import { LEVELS, TEST_LEVEL, getLevel } from '../data/levels';
import { STORAGE_KEY } from '../config';
import { Checkpoint, Goal } from '../entities/Triggers';
import { Enemy } from '../entities/Enemy';
import { PlatformBot, type BotOptions, type BotResult } from './PlatformBot';
import { installDebugOverlay } from './DebugOverlay';

/**
 * Deterministic test harness, installed on `window.__harness` when the URL has `?test`
 * or `?debug` (see src/main.ts). Used by Playwright specs, the platforming bot and the
 * debug overlay. See docs/QA.md for the API.
 *
 * Determinism: in manual mode the Level scene's `sys.step` is gated so the real
 * requestAnimationFrame loop no longer advances it (rendering continues). `stepFrames`
 * then runs the scene's normal update pipeline (timers, tweens, cameras, sprite updates,
 * Arcade physics, LevelScene.step) with a fixed dt. Tween deltas (normally wall-clock
 * based) are fed the same fixed dt, and Math.random / Phaser RND are seeded.
 */

export interface HarnessInput {
  left?: boolean;
  right?: boolean;
  up?: boolean;
  down?: boolean;
  jump?: boolean;
  run?: boolean;
  attack?: boolean;
  pause?: boolean;
}

export interface StartOptions {
  /** Drive the simulation only through stepFrames (deterministic). Default false (real time). */
  manual?: boolean;
  /** Seed for Math.random and Phaser.Math.RND (manual mode defaults to 1). */
  seed?: number;
  /** Replace the level's map file (e.g. use test.json for a level whose map doesn't exist yet). */
  mapFile?: string;
}

export interface HarnessState {
  scenes: string[];
  levelId: string | null;
  character: CharacterId | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  mode: string;
  health: number;
  lives: number;
  coins: number;
  levelTimeMs: number;
  finished: boolean;
  enemies: number;
  deaths: number;
  checkpoint: number;
  manual: boolean;
  frame: number;
}

export interface HarnessStats {
  textures: number;
  levelChildren: number;
  hudChildren: number;
  bodies: number;
  staticBodies: number;
  tweens: number;
  levelListeners: number;
  gameListeners: number;
  heapBytes: number | null;
}

type LevelPrivate = LevelScene;
/** LevelScene internals the harness reads (private in TS, public at runtime). */
type LevelInternals = { finished: boolean; respawning: boolean; spawnPoint: { x: number; y: number } };
const internals = (lv: LevelScene) => lv as unknown as LevelInternals;
type SceneManagerPrivate = Phaser.Scenes.SceneManager & { _queue: unknown[]; _pending: unknown[]; _start: unknown[] };
type TweensPrivate = Phaser.Tweens.TweenManager & { getDelta: (tick?: boolean) => number; __harnessPatched?: boolean };
type ClockPrivate = Phaser.Time.Clock & { _pendingInsertion: unknown[] };

const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class TestHarness {
  readonly version = 1;
  private manual = false;
  private input: HarnessInput | null = null;
  private invulnerable = false;
  private simTime = 0;
  private stepDt = 1000 / 60;
  private frame = 0;
  private origStep?: (time: number, delta: number) => void;
  private readonly nativeRandom = Math.random;
  private lastPlayer: unknown = null;

  constructor(readonly game: Phaser.Game) {
    // Sticky settings (input override, invulnerability) are re-applied every game step so
    // they survive scene restarts in real-time mode too.
    game.events.on(Phaser.Core.Events.PRE_STEP, () => this.applySticky());
  }

  // ───────────────────────── scenes ─────────────────────────

  /** The Level scene object (exists even when not running). */
  levelScene(): LevelPrivate {
    return this.game.scene.getScene('Level') as LevelPrivate;
  }

  /** The Level scene if it is running or paused with a player. */
  level(): LevelPrivate | null {
    const lv = this.levelScene();
    if (!lv || !lv.player || !lv.sys.settings) return null;
    const st = lv.sys.settings.status;
    if (st !== Phaser.Scenes.RUNNING && st !== Phaser.Scenes.PAUSED) return null;
    return lv;
  }

  scenes(): string[] {
    return this.game.scene.getScenes(false).filter((s) => s.sys.isActive() || s.sys.isPaused()).map((s) => s.sys.settings.key);
  }

  isActive(key: string): boolean {
    return this.game.scene.isActive(key);
  }

  /** Resolves once boot/preload are done (placeholder art exists, first real scene is running). */
  async ready(timeoutMs = 20000): Promise<void> {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      if (this.game.isBooted) {
        const running = this.game.scene.getScenes(true).map((s) => s.sys.settings.key);
        if (running.some((k) => k !== 'Boot' && k !== 'Preload')) {
          this.patchLevelScene();
          return;
        }
      }
      await raf();
    }
    throw new Error('harness.ready timed out');
  }

  private pendingSceneOps(): number {
    const sm = this.game.scene as SceneManagerPrivate;
    return (sm._queue?.length ?? 0) + (sm._pending?.length ?? 0) + (sm._start?.length ?? 0);
  }

  /** Gate the Level scene's automatic stepping so manual mode is deterministic. */
  private patchLevelScene(): void {
    const lv = this.levelScene();
    if (!lv || this.origStep) return;
    const sys = lv.sys;
    const proto = Phaser.Scenes.Systems.prototype.step;
    this.origStep = (time, delta) => proto.call(sys, time, delta);
    sys.step = (time: number, delta: number) => {
      if (this.manual) return;
      proto.call(sys, time, delta);
    };
  }

  private patchTweens(lv: LevelPrivate): void {
    const tw = lv.tweens as TweensPrivate;
    if (!tw || tw.__harnessPatched) return;
    const orig = tw.getDelta.bind(tw);
    tw.getDelta = (tick?: boolean) => (this.manual ? this.stepDt : orig(tick));
    tw.__harnessPatched = true;
  }

  seed(seed: number): void {
    Phaser.Math.RND.sow([String(seed)]);
    Math.random = mulberry32(seed);
  }

  unseed(): void {
    Math.random = this.nativeRandom;
  }

  /**
   * (Re)start a level with the given character. Stops all other scenes (menus, pause,
   * results). Resolves once the new LevelScene has finished create().
   */
  async startLevel(levelId = 'test', character: CharacterId = 'dad', opts: StartOptions = {}): Promise<HarnessState> {
    await this.ready();
    if (!CHARACTER_IDS.includes(character)) throw new Error(`unknown character ${character}`);
    const info = getLevel(levelId);
    if (!info) throw new Error(`unknown level ${levelId}`);
    if (opts.mapFile) info.file = opts.mapFile;
    this.manual = !!opts.manual;
    this.frame = 0;
    this.simTime = 0;
    this.input = null;
    if (opts.seed !== undefined || opts.manual) this.seed(opts.seed ?? 1);
    else this.unseed();
    gameState.character = character;
    gameState.resetCheckpoint();
    gameState.resetLives();
    const lv = this.levelScene();
    lv.manualStep = this.manual;
    const prevPlayer = lv.player;
    for (const s of this.game.scene.getScenes(false)) {
      const k = s.sys.settings.key;
      if (k === 'Level') continue;
      if (s.sys.isActive() || s.sys.isPaused() || s.sys.isSleeping()) this.game.scene.stop(k);
    }
    // Clear any queued level transitions (e.g. a pending restart) before starting.
    this.game.scene.start('Level', { levelId });
    const t0 = performance.now();
    while (performance.now() - t0 < 15000) {
      await raf();
      const cur = this.levelScene();
      if (cur.player && cur.player !== prevPlayer && cur.sys.isActive() && this.pendingSceneOps() === 0) {
        this.patchTweens(cur);
        cur.manualStep = this.manual;
        this.applySticky();
        return this.getState();
      }
    }
    throw new Error(`startLevel(${levelId}) timed out; scenes: ${this.scenes().join(',')}`);
  }

  /** Switch between real-time and manual (deterministic) stepping. */
  setManual(on: boolean): void {
    this.patchLevelScene();
    this.manual = on;
    const lv = this.levelScene();
    if (lv) {
      lv.manualStep = on;
      if (on && lv.tweens) this.patchTweens(lv);
    }
  }

  isManual(): boolean {
    return this.manual;
  }

  /**
   * Advance the Level simulation by n fixed frames (enables manual mode). Waits (without
   * advancing the simulation) for queued scene transitions such as a death restart.
   * Returns the number of frames actually stepped (fewer if the level stopped/paused).
   */
  async stepFrames(n: number, dtMs = 1000 / 60): Promise<number> {
    if (!this.manual) this.setManual(true);
    let stepped = 0;
    while (stepped < n) {
      if (this.pendingSceneOps() > 0) {
        const t0 = performance.now();
        while (this.pendingSceneOps() > 0 && performance.now() - t0 < 10000) await raf();
        // A restart re-creates the player; give create() a frame to finish.
        await raf();
      }
      const lv = this.level();
      if (!lv || !lv.sys.isActive() || !this.origStep) break;
      this.patchTweens(lv);
      this.applySticky();
      this.stepDt = dtMs;
      this.simTime += dtMs;
      lv.manualStep = false;
      try {
        this.origStep(this.simTime, dtMs);
      } finally {
        lv.manualStep = true;
      }
      // Camera.worldView is normally refreshed by the renderer (preRender). Entities read it
      // (e.g. enemy off-screen culling), so refresh it per step exactly like the real loop
      // does — otherwise the number of rendered frames would leak into the simulation.
      for (const cam of lv.cameras.cameras) (cam as unknown as { preRender(): void }).preRender();
      this.frame++;
      stepped++;
    }
    return stepped;
  }

  // ───────────────────────── input & cheats ─────────────────────────

  /** Replace all physical input (null = give control back to keyboard/touch/gamepad). */
  setInput(input: HarnessInput | null): void {
    this.input = input ? { ...input } : null;
    this.applySticky();
  }

  setInvulnerable(on: boolean): void {
    this.invulnerable = on;
    const lv = this.level();
    if (lv && !on) lv.player.invulnUntil = 0;
    this.applySticky();
  }

  private applySticky(): void {
    const lv = this.level();
    if (!lv) return;
    if (lv.inputSys) lv.inputSys.override = this.input ? { ...this.input } : this.manual ? {} : null;
    if (this.invulnerable) lv.player.invulnUntil = Number.MAX_SAFE_INTEGER;
    if (lv.player !== this.lastPlayer) {
      this.lastPlayer = lv.player;
      this.frame = 0;
    }
  }

  getState(): HarnessState {
    const lv = this.level();
    const scenes = this.scenes();
    if (!lv) {
      return {
        scenes, levelId: null, character: null, x: 0, y: 0, vx: 0, vy: 0, grounded: false, mode: 'none', health: 0,
        lives: gameState.lives, coins: 0, levelTimeMs: 0, finished: false, enemies: 0, deaths: 0,
        checkpoint: gameState.checkpoint, manual: this.manual, frame: this.frame,
      };
    }
    const p = lv.player;
    return {
      scenes,
      levelId: lv.level.id,
      character: p.def.id,
      x: p.x,
      y: p.y,
      vx: p.body?.velocity.x ?? 0,
      vy: p.body?.velocity.y ?? 0,
      grounded: p.grounded,
      mode: p.mode,
      health: p.health,
      lives: gameState.lives,
      coins: lv.stats.coins,
      levelTimeMs: lv.ctx.now(),
      finished: internals(lv).finished,
      enemies: lv.ctx.groups.enemies.getChildren().filter((e) => e.active && !(e as Enemy).dead).length,
      deaths: lv.stats.deaths,
      checkpoint: gameState.checkpoint,
      manual: this.manual,
      frame: this.frame,
    };
  }

  private requireLevel(): LevelPrivate {
    const lv = this.level();
    if (!lv) throw new Error('no level running');
    return lv;
  }

  /** Move the player (bottom-centre anchor) to world x,y and stop it. */
  teleport(x: number, y: number): void {
    const lv = this.requireLevel();
    const p = lv.player;
    p.setPosition(x, y);
    p.body.reset(x, y);
    p.body.setVelocity(0, 0);
    p.motor.vx = 0;
    p.motor.vy = 0;
    lv.cameraSys.snap();
  }

  checkpoints(): { index: number; x: number; y: number; activated: boolean }[] {
    const lv = this.requireLevel();
    return lv.ctx.groups.triggers
      .getChildren()
      .filter((c): c is Checkpoint => c instanceof Checkpoint)
      .map((c) => ({ index: c.index, x: c.x, y: c.y, activated: c.activated }))
      .sort((a, b) => a.index - b.index);
  }

  goal(): { x: number; y: number } | null {
    const lv = this.requireLevel();
    const g = lv.ctx.groups.triggers.getChildren().find((c): c is Goal => c instanceof Goal);
    return g ? { x: g.x, y: g.y } : null;
  }

  teleportToCheckpoint(index: number): { x: number; y: number } {
    const cp = this.checkpoints().find((c) => c.index === index);
    if (!cp) throw new Error(`no checkpoint ${index}`);
    this.teleport(cp.x, cp.y - 1);
    return { x: cp.x, y: cp.y };
  }

  /** Spawn an enemy through the spawner registry (same path as level objects). */
  spawnEnemy(kind: EnemyKind, x: number, y: number, props: Record<string, string | number | boolean> = {}): number {
    const lv = this.requireLevel();
    const spawner = getSpawner('enemy');
    if (!spawner) throw new Error('no enemy spawner registered');
    spawner(lv.ctx, { id: 100000 + Math.floor(this.frame), type: 'enemy', name: 'harness', x, y, width: 16, height: 16, props: { kind, ...props } });
    return this.getState().enemies;
  }

  /**
   * Edit tiles at runtime (tile coords, inclusive rect). `index` is a Tiled gid-1 tile index;
   * -1 clears. Ground tiles become solid; oneway tiles collide from above only.
   */
  editTiles(layer: 'ground' | 'oneway' | 'hazards' | 'water', tx: number, ty: number, w: number, h: number, index: number): void {
    const lv = this.requireLevel();
    const l = lv.ctx[layer];
    if (!l) throw new Error(`level has no ${layer} layer`);
    for (let y = ty; y < ty + h; y++) {
      for (let x = tx; x < tx + w; x++) {
        if (index < 0) {
          l.removeTileAt(x, y);
          continue;
        }
        const t = l.putTileAt(index, x, y);
        if (layer === 'ground') t.setCollision(true, true, true, true);
        if (layer === 'oneway') t.setCollision(false, false, true, false);
      }
    }
    if (layer === 'ground') l.calculateFacesWithin(tx - 1, ty - 1, w + 2, h + 2);
  }

  completeLevel(): void {
    this.requireLevel().events.emit(EV.LEVEL_COMPLETE);
  }

  killPlayer(): void {
    this.requireLevel().player.die('pit');
  }

  /**
   * Undo a death without restarting the scene (used by the bot): cancels the pending
   * restart timer, restores the life and respawns at x,y (default: current spawn point).
   */
  revive(x?: number, y?: number): void {
    const lv = this.requireLevel();
    const p = lv.player;
    const wasDead = p.mode === 'dead';
    const clock = lv.time as ClockPrivate;
    clock.removeAllEvents();
    if (clock._pendingInsertion) clock._pendingInsertion.length = 0;
    lv.tweens.killTweensOf(p);
    p.setScale(1);
    if (wasDead && internals(lv).respawning) {
      gameState.lives++;
      lv.events.emit(EV.LIVES_CHANGED, gameState.lives);
    }
    internals(lv).respawning = false;
    lv.cameras.main.resetFX();
    const sp = internals(lv).spawnPoint;
    p.respawn(x ?? sp.x, y ?? sp.y);
    lv.cameraSys.snap();
    this.applySticky();
  }

  setLives(n: number): void {
    gameState.lives = n;
    this.level()?.events.emit(EV.LIVES_CHANGED, n);
  }

  /** Text currently shown by a scene (e.g. HUD lives "x4", Results "LEVEL CLEAR!"). */
  sceneTexts(key: string): string[] {
    const s = this.game.scene.getScene(key);
    if (!s || !s.sys.isActive()) return [];
    const out: string[] = [];
    const walk = (list: Phaser.GameObjects.GameObject[]) => {
      for (const o of list) {
        if (!o.active) continue;
        if (o instanceof Phaser.GameObjects.Text || o instanceof Phaser.GameObjects.BitmapText) out.push(o.text);
        else if (o instanceof Phaser.GameObjects.Container) walk(o.list);
      }
    };
    walk(s.children.list);
    return out;
  }

  /** Count of visible game objects of a type in a scene, optionally at a given depth. */
  sceneObjects(key: string, type: string, depth?: number): number {
    const s = this.game.scene.getScene(key);
    if (!s || !s.sys.isActive()) return 0;
    return s.children.list.filter((o) => {
      const v = o as Phaser.GameObjects.GameObject & { visible?: boolean; depth?: number };
      return o.type === type && v.visible !== false && (depth === undefined || v.depth === depth);
    }).length;
  }

  /** True when the HUD's on-screen touch controls are drawn. */
  touchControlsVisible(): boolean {
    return document.getElementById('touch-controls')?.classList.contains('show') ?? false;
  }

  pause(): void {
    this.requireLevel().pauseGame();
  }

  // ───────────────────────── save & levels ─────────────────────────

  getSave(): unknown {
    return JSON.parse(JSON.stringify(saveSystem.get()));
  }

  clearSave(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    saveSystem.load();
    gameState.character = saveSystem.get().selectedCharacter;
  }

  /**
   * Replace the save with `data` (sanitised exactly like a save loaded from storage, so
   * retroactive unlocks are applied) and persist it. Used by e2e tests to set up progress.
   */
  setSave(data: unknown): unknown {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
    saveSystem.load();
    saveSystem.save();
    gameState.character = saveSystem.get().selectedCharacter;
    return this.getSave();
  }

  /** All registered levels (test level first) and whether their map file is served. */
  async levels(): Promise<{ id: string; file: string; exists: boolean; boss: boolean; next?: string }[]> {
    const out = [];
    for (const l of [TEST_LEVEL, ...LEVELS]) {
      let exists = false;
      try {
        const res = await fetch(l.file, { cache: 'no-store' });
        if (res.ok) {
          const j = (await res.json()) as { layers?: unknown };
          exists = Array.isArray(j.layers);
        }
      } catch {
        exists = false;
      }
      out.push({ id: l.id, file: l.file, exists, boss: !!l.boss, next: l.next });
    }
    return out;
  }

  /** Point a level at another map file (e.g. test.json while the real map isn't built yet). */
  useMap(levelId: string, file: string): void {
    const info = getLevel(levelId);
    if (!info) throw new Error(`unknown level ${levelId}`);
    info.file = file;
  }

  /** For every registered level whose map is missing, use the test map instead. Returns the aliased ids. */
  async aliasMissingLevels(file = TEST_LEVEL.file): Promise<string[]> {
    const aliased: string[] = [];
    for (const l of await this.levels()) {
      if (!l.exists && l.id !== TEST_LEVEL.id) {
        this.useMap(l.id, file);
        aliased.push(l.id);
      }
    }
    return aliased;
  }

  // ───────────────────────── diagnostics ─────────────────────────

  stats(): HarnessStats {
    const lv = this.level();
    const hud = this.game.scene.getScene('HUD');
    const count = (em: Phaser.Events.EventEmitter) => em.eventNames().reduce((n, e) => n + em.listenerCount(e), 0);
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      textures: this.game.textures.getTextureKeys().length,
      levelChildren: lv ? lv.children.length : 0,
      hudChildren: hud && hud.sys.isActive() ? hud.children.length : 0,
      bodies: lv ? lv.physics.world.bodies.size : 0,
      staticBodies: lv ? lv.physics.world.staticBodies.size : 0,
      tweens: lv ? lv.tweens.getTweens().length : 0,
      levelListeners: lv ? count(lv.events) : 0,
      gameListeners: count(this.game.events),
      heapBytes: mem ? mem.usedJSHeapSize : null,
    };
  }

  /** Measure real rendering frame times over `ms` (real-time mode). */
  async measureFps(ms = 5000): Promise<{ avgFps: number; avgFrameMs: number; p95FrameMs: number; worstFrameMs: number; frames: number; loopFps: number }> {
    const deltas: number[] = [];
    let last = performance.now();
    const t0 = last;
    while (performance.now() - t0 < ms) {
      await raf();
      const now = performance.now();
      deltas.push(now - last);
      last = now;
    }
    const sorted = [...deltas].sort((a, b) => a - b);
    const total = deltas.reduce((a, b) => a + b, 0);
    const avg = total / Math.max(1, deltas.length);
    return {
      avgFps: 1000 / avg,
      avgFrameMs: avg,
      p95FrameMs: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      worstFrameMs: sorted[sorted.length - 1] ?? 0,
      frames: deltas.length,
      loopFps: this.game.loop.actualFps,
    };
  }

  /** Run the platforming bot (see PlatformBot.ts). */
  bot(opts: BotOptions = {}): Promise<BotResult> {
    return new PlatformBot(this).run(opts);
  }
}

declare global {
  interface Window {
    __harness?: TestHarness;
  }
}

export function installHarness(game: Phaser.Game, opts: { debug: boolean }): TestHarness {
  const h = new TestHarness(game);
  window.__harness = h;
  if (opts.debug) installDebugOverlay(game, h);
  return h;
}
