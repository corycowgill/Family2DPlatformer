import Phaser from 'phaser';
import { DEBUG, DEPTH, GAME_HEIGHT, TILE_SIZE } from '../config';
import { EMPTY_INPUT, EV, playerEvent, type LevelInfo, type PickupKind } from '../types';
import { getLevel, FIRST_LEVEL_ID, isWorldFinale } from '../data/levels';
import { LAYERS, TILESET_KEY, TILESET_NAME } from '../data/tiles';
import { getCharacter } from '../characters';
import { Player } from '../entities/Player';
import { attachAbilities } from '../systems/Abilities';
import { InputSystem } from '../systems/InputSystem';
import { CombatSystem } from '../systems/CombatSystem';
import { CameraSystem } from '../systems/CameraSystem';
import { CoopSystem } from '../systems/CoopSystem';
import { deathOutcome } from '../systems/Coop';
import { audio } from '../systems/AudioSystem';
import { saveSystem } from '../systems/SaveSystem';
import { REQUEST_PAUSE } from '../systems/InputDevice';
import { queueThemeBackgrounds, releaseLazyThemes } from '../systems/ThemeAssets';
import { animKey, playAnim } from '../systems/AnimationSystem';
import { heroTexture } from '../ui/CharacterArt';
import { gameState } from '../state/GameState';
import { Parallax } from '../world/Parallax';
import { getSpawner } from '../world/registry';
import '../world/registerAll';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { Checkpoint } from '../entities/Triggers';
import { LevelFx } from '../fx/LevelFx';
import { CINEMATIC_END } from '../story/BossIntro';
import { assistAffectsRun, canSkipBoss, livesAfterDeath, maxHealthWith, SafeGroundTracker } from '../systems/Assist';
import { OutlineLayer, OUTLINE_ENEMY, OUTLINE_PLAYER, shakeAllowed } from '../systems/Accessibility';

export interface LevelSceneData {
  levelId: string;
}

/** Per-attempt stats handed to ResultsScene. */
export interface LevelRunStats {
  levelId: string;
  timeMs: number;
  coins: number;
  souvenirs: number[];
  stars: number;
  enemies: number;
  deaths: number;
  /** Assist mode was used during this attempt (no gold medal; ASSIST tag on Results). */
  assisted?: boolean;
  /** The boss was skipped (assist). */
  skippedBoss?: boolean;
}

/**
 * Runs one level: builds the tilemap from Tiled JSON, spawns entities through the
 * spawner registry, and owns the game loop (input → player → camera → HUD events).
 */
export class LevelScene extends Phaser.Scene {
  level!: LevelInfo;
  ctx!: LevelContext;
  player!: Player;
  /** Every player: `[player]`, plus Player 2 while local co-op is active (live array, = ctx.players). */
  players: Player[] = [];
  /** Local co-op (Player 2 drop-in/out, leash, respawn next to the partner). */
  coop!: CoopSystem;
  private playerHooks: ((p: Player) => void | (() => void))[] = [];
  private playerCleanups = new Map<Player, (() => void)[]>();
  inputSys!: InputSystem;
  cameraSys!: CameraSystem;
  private parallax!: Parallax;
  fx!: LevelFx;
  private levelTime = 0;
  private spawnPoint = { x: 32, y: 32 };
  private checkpoints: Checkpoint[] = [];
  private finished = false;
  private respawning = false;
  stats!: LevelRunStats;
  private debugGfx?: Phaser.GameObjects.Text;
  /** When true (tests), update() steps only via `stepFrames`. */
  manualStep = false;
  /** Active cinematic beat (boss intro): player input held, camera eased onto `focus`. */
  private cine?: { until: number; focus?: { x: number; y: number } };

  constructor() {
    super('Level');
    // Assist "game speed": scale the delta of the whole scene update (clock, physics
    // accumulator, sprites/anims, LevelScene.step). Arcade still steps a fixed 1/60 s of
    // game time, so the PlayerMotor stays deterministic and jump arcs keep their shape —
    // there are just fewer steps per real second. (The test harness wraps this step.)
    const sys = this.sys;
    const base = sys.step;
    sys.step = (time: number, delta: number) => base.call(sys, time, delta * this.speed);
  }

  private syncSpeed(): void {
    this.tweens.timeScale = this.speed;
  }

  /** Current game speed (1 = normal; assist setting). */
  get speed(): number {
    return saveSystem.get().settings.gameSpeed;
  }

  init(data: LevelSceneData): void {
    this.level = getLevel(data.levelId) ?? getLevel(FIRST_LEVEL_ID)!;
    this.levelTime = 0;
    this.finished = false;
    this.respawning = false;
    this.checkpoints = [];
    this.cine = undefined;
    this.players = [];
    this.playerHooks = [];
    this.playerCleanups = new Map();
    gameState.beginLevel(this.level.id);
    this.stats = { levelId: this.level.id, timeMs: 0, coins: 0, souvenirs: [], stars: 0, enemies: 0, deaths: 0, assisted: false };
  }

  preload(): void {
    const key = `map-${this.level.id}`;
    if (!this.cache.tilemap.exists(key)) this.load.tilemapTiledJSON(key, this.level.file);
    queueThemeBackgrounds(this, this.level.theme);
  }

  create(): void {
    releaseLazyThemes(this, [this.level.theme]);
    const map = this.make.tilemap({ key: `map-${this.level.id}` });
    const tileset = map.addTilesetImage(TILESET_NAME, TILESET_KEY, TILE_SIZE, TILE_SIZE, 0, 0);
    if (!tileset) throw new Error('Tileset missing');
    const mk = (name: string, depth: number) => {
      if (map.getLayerIndex(name) === null) return undefined;
      const l = map.createLayer(name, tileset, 0, 0) ?? undefined;
      l?.setDepth(depth);
      return l;
    };
    mk(LAYERS.background, DEPTH.backgroundTiles);
    const ground = mk(LAYERS.ground, DEPTH.ground)!;
    const oneway = mk(LAYERS.oneway, DEPTH.platforms);
    const hazards = mk(LAYERS.hazards, DEPTH.ground);
    const water = mk(LAYERS.water, DEPTH.foreground - 1);
    mk(LAYERS.foreground, DEPTH.foreground);
    ground.setCollisionByExclusion([-1]);
    if (oneway) {
      oneway.forEachTile((t) => {
        if (t.index > 0) t.setCollision(false, false, true, false);
      });
    }

    this.physics.world.setBounds(0, -GAME_HEIGHT, map.widthInPixels, map.heightInPixels + GAME_HEIGHT * 2);
    this.physics.world.setBoundsCollision(true, true, false, false);

    this.parallax = new Parallax(this, this.level.theme);

    // Groups
    const groups = {
      enemies: this.physics.add.group({ runChildUpdate: false }),
      playerProjectiles: this.physics.add.group({ allowGravity: false }),
      enemyProjectiles: this.physics.add.group({ allowGravity: false }),
      pickups: this.physics.add.group({ allowGravity: false }),
      platforms: this.physics.add.group({ allowGravity: false, immovable: true }),
      triggers: this.physics.add.group({ allowGravity: false, immovable: true }),
    };

    // Collect objects
    const objects = this.readObjects(map);
    const start = objects.find((o) => o.type === 'playerStart');
    this.spawnPoint = start ? { x: start.x, y: start.y } : { x: 48, y: map.heightInPixels - 48 };

    const def = getCharacter(gameState.character);
    this.player = new Player(this, this.spawnPoint.x, this.spawnPoint.y, def);
    const settings = saveSystem.get().settings;
    this.player.maxHealth = this.player.health = maxHealthWith(this.player.maxHealth, settings);
    // Costume (cosmetic only): same frame names / anims, different atlas.
    const skin = heroTexture(this, def.id);
    if (skin !== def.id) {
      this.player.setTexture(skin);
      playAnim(this.player, 'idle');
    }

    const scene = this;
    this.players = [this.player];
    this.ctx = {
      scene: this,
      level: this.level,
      player: this.player,
      players: this.players,
      nearestPlayer: (x, y) => scene.nearestPlayer(x, y),
      eachPlayer: (fn) => scene.eachPlayer(fn),
      map,
      ground,
      oneway,
      hazards,
      water,
      groups,
      events: this.events,
      effect: (anim, x, y, opts) => this.spawnEffect(anim, x, y, opts),
      sfx: (k) => audio.sfx(k),
      shake: (i = 0.006, d = 150) => {
        if (shakeAllowed()) this.cameras.main.shake(d, i);
      },
      lockCamera: (rect) => scene.cameraSys?.lock(rect),
      now: () => scene.levelTime,
    };
    this.player.attach(this.ctx);
    attachAbilities(this.player);
    this.parallax.attachAmbient(this.ctx);

    for (const o of objects) {
      if (o.type === 'playerStart') continue;
      const spawner = getSpawner(o.type);
      if (spawner) spawner(this.ctx, o);
      else if (DEBUG) console.warn(`No spawner for object type "${o.type}"`);
    }
    this.checkpoints = groups.triggers.getChildren().filter((c): c is Checkpoint => c instanceof Checkpoint);
    // Accessibility: high-contrast outline on the hero and every enemy (incl. later spawns).
    if (settings.highContrast) {
      new OutlineLayer(this).track(() => [this.player], OUTLINE_PLAYER).track(() => groups.enemies.getChildren(), OUTLINE_ENEMY);
    }

    // Resume from checkpoint if we died earlier in this level.
    if (gameState.checkpointLevel === this.level.id && gameState.checkpoint >= 0) {
      const cp = this.checkpoints.find((c) => c.index === gameState.checkpoint);
      if (cp) {
        this.spawnPoint = { x: cp.x, y: cp.y };
        this.checkpoints.filter((c) => c.index <= cp.index).forEach((c) => c.setReached());
        this.player.setPosition(cp.x, cp.y);
        this.player.body.reset(cp.x, cp.y);
      }
    }
    // Assist safety net: track the last safe ground (seeded with the spawn point).
    if (settings.safetyNet) {
      this.player.safeGround = new SafeGroundTracker();
      this.player.safeGround.reset(this.spawnPoint.x, this.spawnPoint.y);
    }

    new CombatSystem(this.ctx);
    this.fx = new LevelFx(this.ctx);
    this.inputSys = new InputSystem(this);
    this.inputSys.resetEdges();
    this.cameraSys = new CameraSystem(this.cameras.main, this.player, map.widthInPixels, map.heightInPixels, this.players);
    this.cameras.main.setBackgroundColor('#0b1730');
    this.coop = new CoopSystem({
      scene: this,
      players: this.players,
      get player() {
        return scene.player;
      },
      get finished() {
        return scene.finished;
      },
      addPlayer: (p) => scene.addPlayer(p),
      removePlayer: (p) => scene.removePlayer(p),
      loseLife: () => scene.loseLife(),
      snapCamera: () => scene.cameraSys.snap(),
    });
    // Co-op session from an earlier level / restart: Player 2 is back next to Player 1.
    this.coop.restore();
    if (this.coop.active) this.cameraSys.snap();

    this.wireEvents();

    this.scene.launch('HUD', { levelScene: this });
    this.scene.bringToTop('HUD');
    audio.music(this.level.music);
    this.cameras.main.fadeIn(250, 0, 0, 0);

    if (DEBUG) this.setupDebug();
    this.exposeTestHooks();
    // Tweens run on their own wall clock: scale them with the game speed (re-read after a
    // pause, where the speed may have been changed in Settings).
    this.tweens.timeScale = this.speed;
    this.events.on(Phaser.Scenes.Events.RESUME, this.syncSpeed, this);
    this.offerBossSkipSoon();
    // Pause requests from outside the scene (app backgrounded, controller disconnected…).
    const onRequestPause = () => {
      if (this.scene.isActive() && !this.finished && this.anyAlive()) this.pauseGame();
    };
    this.game.events.on(REQUEST_PAUSE, onRequestPause);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off(REQUEST_PAUSE, onRequestPause));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.onShutdown());
  }

  private readObjects(map: Phaser.Tilemaps.Tilemap): SpawnObject[] {
    const layer = map.getObjectLayer(LAYERS.entities);
    if (!layer) return [];
    return layer.objects.map((o) => {
      const props: Record<string, string | number | boolean> = {};
      for (const p of (o.properties ?? []) as { name: string; value: string | number | boolean }[]) props[p.name] = p.value;
      const w = o.width ?? 0;
      const h = o.height ?? 0;
      // Tiled point/rect objects: x,y is top-left. Normalise to bottom-centre.
      return {
        id: o.id,
        type: o.type || (o as { class?: string }).class || o.name,
        name: o.name,
        x: (o.x ?? 0) + w / 2,
        y: (o.y ?? 0) + h,
        width: w,
        height: h,
        props,
      };
    });
  }

  private wireEvents(): void {
    const ev = this.events;
    ev.on(EV.PICKUP, (kind: PickupKind, _x: number, _y: number) => {
      if (kind === 'coin') {
        this.stats.coins++;
        this.events.emit(EV.COINS_CHANGED, this.stats.coins);
        if (this.stats.coins % 100 === 0) this.gainLife();
      }
      if (kind === 'star') this.stats.stars++;
      if (kind === 'oneUp') this.gainLife();
    });
    ev.on(EV.SECRET_FOUND, (index: number) => {
      if (!this.stats.souvenirs.includes(index)) this.stats.souvenirs.push(index);
    });
    ev.on(EV.ENEMY_DEFEATED, () => this.stats.enemies++);
    ev.on(EV.CHECKPOINT, (index: number, x: number, y: number) => {
      gameState.checkpoint = Math.max(gameState.checkpoint, index);
      gameState.checkpointLevel = this.level.id;
      this.spawnPoint = { x, y };
    });
    ev.on(EV.PLAYER_RESCUED, () => {
      this.stats.assisted = true;
      this.cameraSys.snap();
    });
    ev.on(EV.PLAYER_DIED, () => this.onPlayerDied(this.player));
    ev.on(playerEvent(EV.PLAYER_DIED, 1), () => this.coop.p2 && this.onPlayerDied(this.coop.p2));
    ev.on(EV.LEVEL_COMPLETE, () => this.onLevelComplete());
    // Boss levels complete shortly after the boss is defeated.
    ev.on(EV.BOSS_DEFEATED, () => this.time.delayedCall(2500, () => this.events.emit(EV.LEVEL_COMPLETE)));
    ev.on(EV.CAMERA_SHAKE, (i: number, d: number) => this.ctx.shake(i, d));
  }

  private gainLife(): void {
    gameState.lives = Math.min(99, gameState.lives + 1);
    this.events.emit(EV.LIVES_CHANGED, gameState.lives);
    audio.sfx('oneup');
  }

  private onPlayerDied(who: Player): void {
    if (this.players.length > 1 && !this.finished) {
      // Co-op: with a partner still standing, come back next to them — no life lost.
      const partners = this.players.filter((p) => p !== who && p.isAlive()).length;
      if (deathOutcome(partners) === 'respawnAtPartner') {
        this.stats.deaths++;
        this.coop.scheduleRespawn(who);
        return;
      }
    }
    this.loseLife();
  }

  /** Everyone is down: lose a life and restart from the checkpoint (or game over). */
  private loseLife(): void {
    if (this.respawning) return;
    this.respawning = true;
    this.stats.deaths++;
    if (this.level.boss) gameState.bossDeaths[this.level.id] = (gameState.bossDeaths[this.level.id] ?? 0) + 1;
    const settings = saveSystem.get().settings;
    if (settings.infiniteLives) this.stats.assisted = true;
    gameState.lives = livesAfterDeath(gameState.lives, settings);
    this.events.emit(EV.LIVES_CHANGED, gameState.lives);
    this.time.delayedCall(1200, () => {
      if (gameState.lives <= 0) {
        gameState.resetCheckpoint();
        gameState.resetLives();
        this.cameras.main.fadeOut(400);
        this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
          this.scene.stop('HUD');
          this.scene.start('Results', { gameOver: true, stats: this.stats });
        });
        return;
      }
      this.cameras.main.fadeOut(250);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        // Restart the scene so enemies/pickups reset; checkpoint state lives in gameState.
        this.scene.restart({ levelId: this.level.id });
      });
    });
  }

  private onLevelComplete(): void {
    if (this.finished) return;
    this.finished = true;
    this.stats.timeMs = this.levelTime;
    this.coop.reviveAll();
    for (const p of this.players) p.celebrate();
    audio.stopMusic();
    audio.sfx('victory');
    gameState.resetCheckpoint();
    delete gameState.bossDeaths[this.level.id];
    if (assistAffectsRun(saveSystem.get().settings)) this.stats.assisted = true;
    // World finale: no next level, or the next one opens a new world (1-4 → 2-1).
    const isLast = isWorldFinale(this.level) || (this.level.world <= 0 && !this.level.next);
    saveSystem.recordCompletion(this.level.id, {
      timeMs: this.stats.timeMs,
      coins: this.stats.coins,
      souvenirs: this.stats.souvenirs,
      stars: this.stats.stars,
      next: this.level.next,
      world: this.level.world,
      worldComplete: isLast && this.level.world > 0,
      assisted: this.stats.assisted,
      skippedBoss: this.stats.skippedBoss,
    });
    this.time.delayedCall(1800, () => {
      this.cameras.main.fadeOut(400);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.stop('HUD');
        this.scene.start('Results', { gameOver: false, stats: this.stats, worldComplete: isLast });
      });
    });
  }

  /** Assist: may this attempt skip the boss (setting on + enough deaths on this boss level)? */
  canSkipBoss(): boolean {
    return !this.finished && canSkipBoss(saveSystem.get().settings, !!this.level.boss, gameState.bossDeaths[this.level.id] ?? 0);
  }

  /** Assist: skip the boss — the level counts as cleared (no medal / best time). */
  skipBoss(): void {
    if (!this.canSkipBoss()) return;
    this.stats.assisted = true;
    this.stats.skippedBoss = true;
    this.endCinematic();
    this.events.emit(EV.LEVEL_COMPLETE);
  }

  /** Right after the death that unlocks it, a small prompt (Pause in "skip" mode) offers the skip. */
  private offerBossSkipSoon(): void {
    const deaths = gameState.bossDeaths[this.level.id] ?? 0;
    if (!this.canSkipBoss() || gameState.bossSkipOffered === `${this.level.id}:${deaths}`) return;
    gameState.bossSkipOffered = `${this.level.id}:${deaths}`;
    this.time.delayedCall(700, () => {
      if (this.sys.isActive() && this.canSkipBoss() && this.player.isAlive()) this.pauseGame(true);
    });
  }

  /** Respawn helper used by debug tools (normal deaths restart the scene). */
  respawnAtCheckpoint(): void {
    this.player.respawn(this.spawnPoint.x, this.spawnPoint.y);
    this.cameraSys.snap();
  }

  private spawnEffect(anim: string, x: number, y: number, opts?: { flipX?: boolean; depth?: number; scale?: number }): void {
    const key = animKey('effects', anim);
    if (!this.anims.exists(key)) return;
    if (anim === 'dust' && saveSystem.get().settings.reducedMotion) return;
    const s = this.add.sprite(x, y, 'effects').setDepth(opts?.depth ?? DEPTH.effects);
    if (anim === 'dust') s.setOrigin(0.5, 1);
    if (opts?.flipX) s.setFlipX(true);
    if (opts?.scale) s.setScale(opts.scale);
    s.play(key);
    s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
    // Safety: looping anims never complete.
    this.time.delayedCall(1500, () => s.active && s.destroy());
  }

  update(_time: number, delta: number): void {
    if (this.manualStep) return;
    this.step(delta);
  }

  /**
   * Start a short cinematic beat (boss intro): for `ms` of level time the player's input is
   * held (pause still works; JUMP skips) and the camera eases onto `focus`. Emits
   * CINEMATIC_END when it ends.
   */
  cinematic(ms: number, focus?: { x: number; y: number }): void {
    this.cine = { until: this.levelTime + ms, focus };
  }

  get inCinematic(): boolean {
    return !!this.cine;
  }

  endCinematic(): void {
    if (!this.cine) return;
    this.cine = undefined;
    const cam = this.cameras.main;
    if (cam.zoom !== 1) cam.zoomTo(1, 220, 'Sine.easeInOut', true);
    this.events.emit(CINEMATIC_END);
  }

  /** Position of the boss called `name` (boss intro camera focus). */
  findBoss(name: string): { x: number; y: number } | undefined {
    const e = this.ctx.groups.enemies.getChildren().find((o) => (o as unknown as { bossName?: string }).bossName === name);
    return e ? { x: (e as Phaser.GameObjects.Sprite).x, y: (e as Phaser.GameObjects.Sprite).y } : undefined;
  }

  private updateCinematicCamera(dt: number): void {
    const cam = this.cameras.main;
    const f = this.cine?.focus;
    if (!f) return;
    const k = Math.min(1, (dt / 1000) * 5);
    const cx = cam.midPoint.x + (f.x - cam.midPoint.x) * k;
    const cy = cam.midPoint.y + (f.y - cam.midPoint.y) * k;
    if (!saveSystem.get().settings.reducedMotion) cam.setZoom(cam.zoom + (1.3 - cam.zoom) * k);
    cam.centerOn(cx, cy);
  }

  /** One simulation step (also driven by the test harness). */
  step(delta: number): void {
    const dt = Math.min(delta, 1000 / 30);
    // Co-op joins/leaves first, so a joining controller is claimed before P1 reads input.
    this.coop.detect(this.inputSys.override === null);
    let input = this.inputSys.update();
    const p2Pause = this.coop.readInput();
    if ((input.pausePressed || p2Pause) && !this.finished && this.anyAlive()) {
      this.pauseGame();
      return;
    }
    let hold = false;
    if (this.cine) {
      // JUMP skips the beat; that press is swallowed so the hero doesn't also jump.
      const skip = input.jumpPressed;
      if (skip || this.levelTime >= this.cine.until || !this.anyAlive()) this.endCinematic();
      if (this.cine || skip) {
        input = { ...EMPTY_INPUT };
        hold = true;
      }
    }
    if (!this.finished) this.levelTime += dt;
    if (saveSystem.get().settings.autoRun) input = { ...input, run: true };
    this.player.tick(input, dt);
    this.coop.tick(dt, hold);
    if (this.cine) this.updateCinematicCamera(dt);
    else this.cameraSys.update(dt);
    this.parallax.update();
    this.fx.update(dt);
    if (this.debugGfx) this.updateDebug();
  }

  /** Is any player alive? (single player: Player 1.) */
  anyAlive(): boolean {
    return this.players.length > 1 ? this.players.some((p) => p.isAlive()) : this.player.isAlive();
  }

  /** The living player nearest to (x, y); Player 1 when nobody else qualifies. */
  nearestPlayer(x: number, y: number): Player {
    const ps = this.players;
    if (ps.length < 2) return this.player;
    let best: Player | null = null;
    let bestD = Infinity;
    for (const p of ps) {
      if (!p.isAlive() || !p.active) continue;
      const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best ?? this.player;
  }

  /** LevelContext.eachPlayer: run `fn` for current and future players. */
  private eachPlayer(fn: (p: Player) => void | (() => void)): () => void {
    this.playerHooks.push(fn);
    for (const p of [...this.players]) this.runPlayerHook(fn, p);
    return () => {
      const i = this.playerHooks.indexOf(fn);
      if (i >= 0) this.playerHooks.splice(i, 1);
    };
  }

  private runPlayerHook(fn: (p: Player) => void | (() => void), p: Player): void {
    const cleanup = fn(p);
    if (!cleanup) return;
    let list = this.playerCleanups.get(p);
    if (!list) this.playerCleanups.set(p, (list = []));
    list.push(cleanup);
  }

  /** Co-op: a player joined (after picking a hero). */
  private addPlayer(p: Player): void {
    if (this.players.includes(p)) return;
    this.players.push(p);
    for (const fn of [...this.playerHooks]) this.runPlayerHook(fn, p);
  }

  /** Co-op: a player left — undo everything `eachPlayer` set up for them. */
  private removePlayer(p: Player): void {
    const i = this.players.indexOf(p);
    if (i <= 0) return; // Player 1 never leaves
    this.players.splice(i, 1);
    for (const c of this.playerCleanups.get(p) ?? []) c();
    this.playerCleanups.delete(p);
  }

  pauseGame(offerSkip = false): void {
    this.scene.pause();
    this.scene.launch('Pause', { levelId: this.level.id, offerSkip });
    this.scene.bringToTop('Pause');
  }

  private setupDebug(): void {
    this.physics.world.createDebugGraphic();
    this.physics.world.drawDebug = true;
    this.debugGfx = this.add.text(4, GAME_HEIGHT - 12, '', { fontFamily: 'monospace', fontSize: '8px', color: '#0f0' }).setScrollFactor(0).setDepth(DEPTH.overlay);
    const kb = this.input.keyboard;
    kb?.on('keydown-I', () => !this.coop.active && (this.player.invulnUntil = this.player.invulnUntil > 1e12 ? 0 : Number.MAX_SAFE_INTEGER));
    kb?.on('keydown-C', () => this.respawnAtCheckpoint());
    kb?.on('keydown-B', () => {
      this.physics.world.drawDebug = !this.physics.world.drawDebug;
      this.physics.world.debugGraphic?.clear();
    });
    kb?.on('keydown-N', () => this.events.emit(EV.LEVEL_COMPLETE));
  }

  private updateDebug(): void {
    const p = this.player;
    this.debugGfx!.setText(
      `fps ${this.game.loop.actualFps.toFixed(0)} x${p.x.toFixed(0)} y${p.y.toFixed(0)} vx${p.body.velocity.x.toFixed(0)} vy${p.body.velocity.y.toFixed(0)} g${p.grounded ? 1 : 0} ${p.mode}`,
    );
  }

  private exposeTestHooks(): void {
    if (typeof window === 'undefined') return;
    (window as unknown as { __level?: LevelScene }).__level = this;
  }

  private onShutdown(): void {
    this.events.off(EV.PICKUP);
    this.events.off(EV.SECRET_FOUND);
    this.events.off(EV.ENEMY_DEFEATED);
    this.events.off(EV.CHECKPOINT);
    this.events.off(EV.PLAYER_DIED);
    this.events.off(playerEvent(EV.PLAYER_DIED, 1));
    this.events.off(EV.LEVEL_COMPLETE);
    this.events.off(EV.CAMERA_SHAKE);
    this.events.off(EV.BOSS_DEFEATED);
    this.events.off(EV.PLAYER_RESCUED);
    this.events.off(Phaser.Scenes.Events.RESUME, this.syncSpeed, this);
    this.tweens.timeScale = 1;
    if ((window as unknown as { __level?: LevelScene }).__level === this) {
      (window as unknown as { __level?: LevelScene }).__level = undefined;
    }
  }
}
