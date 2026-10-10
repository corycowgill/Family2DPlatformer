import Phaser from 'phaser';
import { DEBUG, DEPTH, GAME_HEIGHT, TILE_SIZE } from '../config';
import { EV, type LevelInfo, type PickupKind } from '../types';
import { getLevel, FIRST_LEVEL_ID } from '../data/levels';
import { LAYERS, TILESET_KEY, TILESET_NAME } from '../data/tiles';
import { getCharacter } from '../characters';
import { Player } from '../entities/Player';
import { attachAbilities } from '../systems/Abilities';
import { InputSystem } from '../systems/InputSystem';
import { CombatSystem } from '../systems/CombatSystem';
import { CameraSystem } from '../systems/CameraSystem';
import { audio } from '../systems/AudioSystem';
import { saveSystem } from '../systems/SaveSystem';
import { REQUEST_PAUSE } from '../systems/InputDevice';
import { animKey } from '../systems/AnimationSystem';
import { gameState } from '../state/GameState';
import { Parallax } from '../world/Parallax';
import { getSpawner } from '../world/registry';
import '../world/registerAll';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { Checkpoint } from '../entities/Triggers';
import { LevelFx } from '../fx/LevelFx';

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
}

/**
 * Runs one level: builds the tilemap from Tiled JSON, spawns entities through the
 * spawner registry, and owns the game loop (input → player → camera → HUD events).
 */
export class LevelScene extends Phaser.Scene {
  level!: LevelInfo;
  ctx!: LevelContext;
  player!: Player;
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

  constructor() {
    super('Level');
  }

  init(data: LevelSceneData): void {
    this.level = getLevel(data.levelId) ?? getLevel(FIRST_LEVEL_ID)!;
    this.levelTime = 0;
    this.finished = false;
    this.respawning = false;
    this.checkpoints = [];
    gameState.beginLevel(this.level.id);
    this.stats = { levelId: this.level.id, timeMs: 0, coins: 0, souvenirs: [], stars: 0, enemies: 0, deaths: 0 };
  }

  preload(): void {
    const key = `map-${this.level.id}`;
    if (!this.cache.tilemap.exists(key)) this.load.tilemapTiledJSON(key, this.level.file);
  }

  create(): void {
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

    const scene = this;
    this.ctx = {
      scene: this,
      level: this.level,
      player: this.player,
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
        if (!saveSystem.get().settings.reducedMotion) this.cameras.main.shake(d, i);
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

    new CombatSystem(this.ctx);
    this.fx = new LevelFx(this.ctx);
    this.inputSys = new InputSystem(this);
    this.inputSys.resetEdges();
    this.cameraSys = new CameraSystem(this.cameras.main, this.player, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBackgroundColor('#0b1730');

    this.wireEvents();

    this.scene.launch('HUD', { levelScene: this });
    this.scene.bringToTop('HUD');
    audio.music(this.level.music);
    this.cameras.main.fadeIn(250, 0, 0, 0);

    if (DEBUG) this.setupDebug();
    this.exposeTestHooks();
    // Pause requests from outside the scene (app backgrounded, controller disconnected…).
    const onRequestPause = () => {
      if (this.scene.isActive() && !this.finished && this.player.isAlive()) this.pauseGame();
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
    ev.on(EV.PLAYER_DIED, () => this.onPlayerDied());
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

  private onPlayerDied(): void {
    if (this.respawning) return;
    this.respawning = true;
    this.stats.deaths++;
    gameState.lives--;
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
    this.player.celebrate();
    audio.stopMusic();
    audio.sfx('victory');
    gameState.resetCheckpoint();
    const isLast = !this.level.next;
    saveSystem.recordCompletion(this.level.id, {
      timeMs: this.stats.timeMs,
      coins: this.stats.coins,
      souvenirs: this.stats.souvenirs,
      stars: this.stats.stars,
      next: this.level.next,
      world: this.level.world,
      worldComplete: isLast && this.level.world > 0,
    });
    this.time.delayedCall(1800, () => {
      this.cameras.main.fadeOut(400);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.stop('HUD');
        this.scene.start('Results', { gameOver: false, stats: this.stats, worldComplete: isLast });
      });
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

  /** One simulation step (also driven by the test harness). */
  step(delta: number): void {
    const dt = Math.min(delta, 1000 / 30);
    const input = this.inputSys.update();
    if (input.pausePressed && !this.finished && this.player.isAlive()) {
      this.pauseGame();
      return;
    }
    if (!this.finished) this.levelTime += dt;
    this.player.tick(input, dt);
    this.cameraSys.update(dt);
    this.parallax.update();
    this.fx.update(dt);
    if (this.debugGfx) this.updateDebug();
  }

  pauseGame(): void {
    this.scene.pause();
    this.scene.launch('Pause', { levelId: this.level.id });
    this.scene.bringToTop('Pause');
  }

  private setupDebug(): void {
    this.physics.world.createDebugGraphic();
    this.physics.world.drawDebug = true;
    this.debugGfx = this.add.text(4, GAME_HEIGHT - 12, '', { fontFamily: 'monospace', fontSize: '8px', color: '#0f0' }).setScrollFactor(0).setDepth(DEPTH.overlay);
    const kb = this.input.keyboard;
    kb?.on('keydown-I', () => (this.player.invulnUntil = this.player.invulnUntil > 1e12 ? 0 : Number.MAX_SAFE_INTEGER));
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
    this.events.off(EV.LEVEL_COMPLETE);
    this.events.off(EV.CAMERA_SHAKE);
    this.events.off(EV.BOSS_DEFEATED);
    if ((window as unknown as { __level?: LevelScene }).__level === this) {
      (window as unknown as { __level?: LevelScene }).__level = undefined;
    }
  }
}
