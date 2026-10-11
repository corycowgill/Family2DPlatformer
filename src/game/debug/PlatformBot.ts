import Phaser from 'phaser';
import type { CharacterId, InputState, MovementStats } from '../types';
import { PHYSICS, TILE_SIZE } from '../config';
import { bonkCeiling, stepHorizontal, stepVertical, tryJump, startJump, type MotorModifiers, type MotorState } from '../systems/PlayerMotor';
import { Enemy } from '../entities/Enemy';
import { Boss } from '../entities/Boss';
import { BouncePad, FallingPlatform, MovingPlatform } from '../entities/Platforms';
import { KillZone, PassingTrain, SteamVent } from '../entities/Hazards';
import { Block } from '../entities/Blocks';
import type { HarnessInput, TestHarness } from './TestHarness';

/**
 * Route-planning platforming bot (QA tool — a failure is a lead, not proof a level is impossible).
 *
 * 1. **Navigation graph** (built once per run, per character): every tile surface the
 *    character can stand on is a node; edges are walking steps plus jump / walk-off arcs
 *    simulated with the real motor (`PlayerMotor`) and this character's stats, one-way
 *    platforms (jump up through them), moving-platform paths (ride them), bounce pads and
 *    blocks. A reverse Dijkstra from the goal (or the boss arena) gives every node a
 *    cost-to-go in frames. When the goal is not reachable in the graph the bot heads for
 *    the reachable node closest to it (and reports `stuck` there).
 * 2. **Receding-horizon control** every frame: candidate inputs (run / brake / wait / jumps
 *    with several hold times and air-steering profiles on the ground; steer + hold/release
 *    in the air) are simulated forward from the player's exact state against the tiles,
 *    the *predicted* moving platforms, steam-vent phases, hazard trains, enemies and enemy
 *    shots. Score = frames spent + cost-to-go where the sim ends + penalties (death, damage)
 *    + a "can I stand here for a while" check. The cheapest candidate's first input is
 *    applied. This climbs one-way staircases, waits for moving platforms and for steam /
 *    trains to pass, runs up for long jumps (backs off when a jump needs more speed) and
 *    stomps or avoids enemies.
 * 3. **Recovery**: on death (revived in place, the scene isn't restarted) or no cost-to-go
 *    progress for `stuckFrames` it rewinds to an earlier safe spot and retries with a bit
 *    of randomness; after `maxAttemptsPerSection` failures in one place it gives up.
 * 4. **Boss arenas**: once inside, it stays away from the boss and stomps it whenever it
 *    is stompable for damage (vulnerable window).
 *
 * Runs on top of TestHarness in manual (deterministic) mode.
 */

export interface BotOptions {
  levelId?: string;
  character?: CharacterId;
  /** Ignore damage (pits/water still kill → rewind). Tests pure traversal. */
  invulnerable?: boolean;
  /** Give up after this many simulated frames (default 4 simulated minutes). */
  maxFrames?: number;
  /** Retries per failure location before giving up (default 10). */
  maxAttemptsPerSection?: number;
  /** Frames without cost-to-go progress that count as stuck (default 900 = 15 s: trains / platforms can take a while). */
  stuckFrames?: number;
  /** Step one frame per animation frame so a human can watch (debug overlay `T`). */
  realtime?: boolean;
  /** Don't (re)start the level — run from the current state. */
  noRestart?: boolean;
  seed?: number;
  /** Stop as soon as the player is inside the boss arena (damage-on reachability runs). */
  stopAtBossArena?: boolean;
  /** Record the last `trace` decisions (debugging the bot). */
  trace?: number;
  /**
   * Human-like sloppiness 0..1 (default 0): random reaction lag (keeps the previous input)
   * and noisy candidate scores, so death heatmaps show where a less precise player gets hurt.
   */
  sloppy?: number;
  /** [from, to] frames: also record every candidate's score. */
  traceDetail?: [number, number];
}

export interface BotFailure {
  x: number;
  y: number;
  reason: 'died' | 'stuck';
  attempts: number;
  frame: number;
}

export interface BotIncident {
  x: number;
  y: number;
  type: 'hurt' | 'death';
  kind: string;
  frame: number;
}

export interface BotResult {
  levelId: string;
  character: CharacterId;
  completed: boolean;
  /** Reached the boss arena (boss levels; true for completed boss levels). */
  reachedBossArena: boolean;
  frames: number;
  simSeconds: number;
  maxX: number;
  goalX: number | null;
  levelWidth: number;
  /** maxX / goalX (0..1). */
  progress: number;
  deaths: number;
  rewinds: number;
  failures: BotFailure[];
  /** Where the bot finally gave up (undefined when completed). */
  stuckAt?: { x: number; y: number; reason: string };
  invulnerable: boolean;
  /** Every hurt / death with its position (for death heatmaps). */
  incidents: BotIncident[];
  /** Last decisions when `trace` is set: frame, x, y, vx, vy, grounded, choice, score. */
  trace?: (string | number)[][];
  /** Wall-clock ms spent planning vs stepping the game. */
  perf: { decideMs: number; stepMs: number };
  /** Navigation graph size (nodes) and whether the goal was reachable in it. */
  graph: { nodes: number; edges: number; goalReachable: boolean; buildMs: number };
}

const T = TILE_SIZE;
const DT = 1000 / 60;
const INF = 1e9;
const DEATH = 1e6;

type Input = Pick<HarnessInput, 'left' | 'right' | 'jump' | 'run'>;

interface PlatInfo {
  /** Position (left, top) at sim time t (ms from now). */
  at(tMs: number, out: { x: number; y: number }): boolean;
  w: number;
  h: number;
  /** Graph cells covered by its path (static model). */
  oneWay: boolean;
}

interface Mover {
  /** rect at sim time tMs (ms from now) — returns false when absent. */
  at(tMs: number, out: Rect): boolean;
  kind: 'enemy' | 'shot' | 'train' | 'vent' | 'kill' | 'lift';
  stompable: boolean;
  /** Stomping deals damage (counts for the boss bonus). */
  stompDamages: boolean;
  isBoss: boolean;
  /** Prediction horizon (ms) — enemies turn around, so don't trust far-future positions. */
  horizonMs: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SimState {
  x: number;
  bottom: number;
  bvx: number;
  bvy: number;
  m: MotorState;
  plat: number;
  carry: number;
  extraVy: number;
  stuck: boolean;
  t: number;
  dead: boolean;
  hurt: number;
  hurtAt: number;
  stomps: number;
  bossStomps: number;
  prevJump: boolean;
  leftGround: boolean;
  dropUntil: number;
  /** Sim time until which damage is ignored (invulnerability frames). */
  noDmgUntil: number;
}

interface World {
  W: number;
  H: number;
  solid: Uint8Array;
  oneway: Uint8Array;
  hazard: Uint8Array;
  water: Uint8Array;
  pads: Rect[];
  plats: PlatInfo[];
  movers: Mover[];
  /** Static graph mode: moving-platform paths are one-way tiles, no movers. */
  graphMode: boolean;
}

interface Evaluation {
  base: number;
  /** Where the sim ended (debug traces). */
  end?: string;
  rest: { s: SimState; endFrames: number; horizons: number[] } | null;
}

interface Candidate {
  name: string;
  /** Input for own step k (0-based). */
  input(k: number, s: SimState): Input;
  /** Frames of active input before the sim coasts (ground moves); Infinity for jumps. */
  dur: number;
  jump: boolean;
}

function cloneMotor(m: MotorState): MotorState {
  return { ...m };
}

/** Simple seeded PRNG (bot retries). */
function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class PlatformBot {
  private failures: BotFailure[] = [];
  private safe: { x: number; y: number; cost: number; frame: number }[] = [];
  private deaths = 0;
  private rewinds = 0;
  private frames = 0;
  private maxX = 0;
  private bestCost = INF;
  private sinceProgress = 0;
  private lastInput: Input = { right: false, left: false, jump: false, run: false };
  private lastChoice = '';
  private invulnerable = false;
  private random: () => number = Math.random;
  private noise = 0;
  /** Run-up manoeuvre: hold this direction until `runupUntil`. */
  private runupDir = 0;
  private runupUntil = 0;
  private runupTries = 0;
  private waitFrames = 0;
  private waitNode = -1;

  // character
  private stats!: MovementStats;
  private mods!: MotorModifiers;
  private bw = 12;
  private bh = 30;

  // graph
  private world!: World;
  private nodeId!: Int32Array; // cell → node index (-1)
  private nodeCell: number[] = [];
  private cost!: Float64Array;
  private goalReachable = false;
  private edgeCount = 0;
  private buildMs = 0;
  private platCells: number[][] = [];
  private boss: Boss | null = null;
  private arena: Phaser.Geom.Rectangle | null = null;

  constructor(private h: TestHarness) {}

  // ═════════════════════════════ run loop ═════════════════════════════

  async run(opts: BotOptions = {}): Promise<BotResult> {
    const h = this.h;
    const maxFrames = opts.maxFrames ?? 60 * 240;
    const maxAttempts = opts.maxAttemptsPerSection ?? 10;
    const stuckFrames = opts.stuckFrames ?? 900;
    if (!opts.noRestart || !h.level()) {
      await h.startLevel(opts.levelId ?? h.level()?.level.id ?? 'test', opts.character ?? h.level()?.player.def.id ?? 'dad', {
        manual: true,
        seed: opts.seed ?? 1,
      });
    } else {
      h.setManual(true);
    }
    this.random = rng((opts.seed ?? 1) * 7919 + 17);
    this.invulnerable = !!opts.invulnerable;
    this.traceN = opts.trace ?? 0;
    this.detail = opts.traceDetail ?? null;
    this.sloppy = Math.max(0, Math.min(1, opts.sloppy ?? 0));
    h.setInvulnerable(this.invulnerable);
    const lv = h.level()!;
    const levelId = lv.level.id;
    const character = lv.player.def.id;
    const goal = h.goal();
    const levelWidth = lv.ctx.map.widthInPixels;
    this.boss = (lv.ctx.groups.enemies.getChildren().find((e) => e instanceof Boss) as Boss | undefined) ?? null;
    this.arena = this.boss ? this.boss.arena : null;
    this.buildGraph(goal);
    this.maxX = lv.player.x;
    let stuckAt: BotResult['stuckAt'];
    let reachedArena = false;
    const incidents: BotIncident[] = [];
    const onHurt = (hit: { kind: string }) => {
      const pl = h.level()?.player;
      if (pl) incidents.push({ x: Math.round(pl.x), y: Math.round(pl.y), type: pl.health <= 0 ? 'death' : 'hurt', kind: hit.kind, frame: this.frames });
    };
    lv.events.on('player-hurt', onHurt);

    let lastYield = performance.now();
    while (this.frames < maxFrames) {
      const cur = h.level();
      if (!cur) break;
      const st = h.getState();
      if (st.finished) break;
      const p = cur.player;

      if (p.mode === 'dead') {
        this.deaths++;
        const last = incidents[incidents.length - 1];
        if (!last || last.type !== 'death' || this.frames - last.frame > 2) incidents.push({ x: Math.round(p.x), y: Math.round(p.y), type: 'death', kind: 'pit', frame: this.frames });
        if (this.fail(p.x, p.y, 'died', maxAttempts)) {
          stuckAt = { x: p.x, y: p.y, reason: 'died' };
          break;
        }
        continue;
      }

      if (this.arena && this.inArena(p.x, p.y)) {
        reachedArena = true;
        if (opts.stopAtBossArena) break;
      }

      const c = this.costAt(p.x, p.body.bottom);
      if (p.x > this.maxX) this.maxX = p.x;
      const inBossFight = !!this.boss && this.boss.started && !this.boss.defeated;
      if (c < this.bestCost - 0.5 || inBossFight) {
        this.bestCost = Math.min(this.bestCost, c);
        this.sinceProgress = 0;
      } else if (++this.sinceProgress > stuckFrames) {
        if (this.fail(p.x, p.y, 'stuck', maxAttempts)) {
          stuckAt = { x: p.x, y: p.y, reason: 'stuck' };
          break;
        }
        continue;
      }

      if (p.grounded && p.mode === 'normal' && !p.groundPlatform && this.onSafeGround()) {
        const lastSafe = this.safe[this.safe.length - 1];
        if (!lastSafe || Math.abs(lastSafe.x - p.x) >= 24 || Math.abs(lastSafe.y - p.y) >= 8) this.safe.push({ x: p.x, y: p.y, cost: c, frame: this.frames });
      }

      const tD = performance.now();
      const input = this.decide();
      this.decideMs += performance.now() - tD;
      let pred: SimState | null = null;
      let pre: number[] = [];
      if (this.traceN && p.mode === 'normal') {
        pred = this.initState();
        pre = [pred.x, pred.bottom, pred.bvx, pred.bvy, pred.carry, pred.plat, p.x, p.body.x, p.body.width];
        this.step(pred, this.lastInput, false);
      }
      this.prevPrevJump = !!this.lastInput.jump;
      this.lastInput = input;
      h.setInput({ ...input });
      const tS = performance.now();
      const n = await h.stepFrames(1);
      this.stepMs += performance.now() - tS;
      if (pred && h.level()) {
        const b = h.level()!.player.body;
        const ex = b.center.x - pred.x;
        const ey = b.bottom - pred.bottom;
        if (Math.abs(ex) > 0.3 || Math.abs(ey) > 0.3) this.trace.push(['MISPREDICT', this.frames, Math.round(ex * 100) / 100, Math.round(ey * 100) / 100, Math.round(pred.x * 10) / 10, Math.round(pred.bottom * 10) / 10, Math.round(b.center.x * 10) / 10, Math.round(b.bottom * 10) / 10, 'pre', ...pre.map((v) => Math.round(v * 100) / 100), 'post', b.velocity.x, b.velocity.y, b.blocked.left ? 'BL' : '', b.blocked.right ? 'BR' : '', b.blocked.down ? 'BD' : '']);
      }
      if (n === 0 && !h.level()?.player) break;
      this.frames++;
      if (opts.realtime) await new Promise<void>((r) => requestAnimationFrame(() => r()));
      else if (performance.now() - lastYield > 1500) {
        // let the page breathe now and then (each yield may cost a rendered frame)
        await new Promise<void>((r) => setTimeout(r, 0));
        lastYield = performance.now();
      }
    }

    const end = h.getState();
    if (!end.finished && !stuckAt) {
      stuckAt = { x: end.x, y: end.y, reason: opts.stopAtBossArena && reachedArena ? 'boss arena reached' : this.frames >= maxFrames ? 'timeout' : 'level stopped' };
    }
    h.setInput(null);
    lv.events.off('player-hurt', onHurt);
    const goalX = goal?.x ?? (this.arena ? this.arena.centerX : null);
    return {
      levelId,
      character,
      completed: end.finished,
      reachedBossArena: reachedArena || (end.finished && !!this.arena),
      frames: this.frames,
      simSeconds: this.frames / 60,
      maxX: Math.round(end.finished && goalX ? Math.max(this.maxX, goalX) : this.maxX),
      goalX,
      levelWidth,
      progress: goalX ? Math.min(1, (end.finished ? goalX : this.maxX) / goalX) : this.maxX / levelWidth,
      deaths: this.deaths,
      rewinds: this.rewinds,
      failures: this.failures,
      stuckAt: end.finished ? undefined : stuckAt,
      invulnerable: this.invulnerable,
      incidents,
      trace: this.traceN ? this.trace : undefined,
      perf: { decideMs: Math.round(this.decideMs), stepMs: Math.round(this.stepMs) },
      graph: { nodes: this.nodeCell.length, edges: this.edgeCount, goalReachable: this.goalReachable, buildMs: Math.round(this.buildMs) },
    };
  }

  private inArena(x: number, y: number): boolean {
    const a = this.arena!;
    return x > a.x + 40 && x < a.right - 8 && y > a.y - 64 && y <= a.bottom + 48;
  }

  /** Record a failure, rewind to an earlier safe spot. Returns true when giving up. */
  private fail(x: number, y: number, reason: 'died' | 'stuck', maxAttempts: number): boolean {
    let f = this.failures.find((ff) => Math.abs(ff.x - x) < 48 && Math.abs(ff.y - y) < 64);
    if (!f) {
      f = { x: Math.round(x), y: Math.round(y), reason, attempts: 0, frame: this.frames };
      this.failures.push(f);
    }
    f.attempts++;
    f.reason = reason;
    f.frame = this.frames;
    if (f.attempts > maxAttempts) return true;
    // Rewind further back on later attempts (longer run-up, different timing).
    const curCost = this.costAt(x, y);
    const backPx = 48 + 32 * Math.min(4, f.attempts - 1);
    const backFrames = (backPx / this.stats.runSpeed) * 60;
    const candidates = this.safe.filter((s) => s.x < x - backPx || (curCost < INF / 2 && s.cost > curCost + backFrames && s.x < x + 8));
    const spot = candidates[candidates.length - 1] ?? this.safe[0];
    this.rewinds++;
    this.sinceProgress = 0;
    this.runupDir = 0;
    this.runupTries = 0;
    this.waitFrames = 0;
    this.noise = Math.min(30, 4 * f.attempts);
    this.bestCost = spot ? spot.cost : this.bestCost;
    this.lastInput = { right: false, left: false, jump: false, run: false };
    if (spot) this.h.revive(spot.x, spot.y - 1);
    else this.h.revive();
    // Random idle so dynamic hazards / platforms are met at a different phase.
    this.idleFrames = Math.floor(this.random() * 20 * Math.min(4, f.attempts));
    return false;
  }

  private idleFrames = 0;
  private traceN = 0;
  private decideMs = 0;
  private stepMs = 0;
  private sloppy = 0;
  private detail: [number, number] | null = null;
  private trace: (string | number)[][] = [];
  private prevPrevJump = false;

  private onSafeGround(): boolean {
    const lv = this.h.level()!;
    const b = lv.player.body;
    const w = this.world;
    const r = Math.floor((b.bottom + 2) / T);
    for (const x of [b.left + 1, b.center.x, b.right - 1]) {
      const c = Math.floor(x / T);
      if (c < 0 || c >= w.W || r < 0 || r >= w.H) return false;
      const i = r * w.W + c;
      if (!(w.solid[i] || w.oneway[i]) || w.water[i]) return false;
      if (r > 0 && (w.hazard[i - w.W] || w.water[i - w.W])) return false;
    }
    return true;
  }

  // ═════════════════════════════ world model ═════════════════════════════

  private buildWorld(): World {
    const lv = this.h.level()!;
    const c = lv.ctx;
    const W = c.map.width;
    const H = c.map.height;
    const grid = (layer: Phaser.Tilemaps.TilemapLayer | undefined) => {
      const a = new Uint8Array(W * H);
      if (!layer) return a;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const t = layer.getTileAt(x, y, true);
        if (t && t.index > 0) a[y * W + x] = 1;
      }
      return a;
    };
    const w: World = {
      W,
      H,
      solid: grid(c.ground),
      oneway: grid(c.oneway),
      hazard: grid(c.hazards),
      water: grid(c.water),
      pads: [],
      plats: [],
      movers: [],
      graphMode: true,
    };
    for (const o of c.groups.triggers.getChildren()) {
      if (o instanceof BouncePad) {
        const b = o.body;
        w.pads.push({ x: b.x, y: b.y, w: b.width, h: b.height });
      }
    }
    return w;
  }

  /** Blocks are solid cells (re-read every decision: bricks break). */
  private blockCells: number[] = [];
  private syncBlocks(): void {
    const w = this.world;
    const lv = this.h.level()!;
    for (const i of this.blockCells) w.solid[i] = this.baseSolid[i];
    this.blockCells = [];
    for (const o of lv.children.list) {
      if (!(o instanceof Block) || !o.active || !o.body || !o.body.enable) continue;
      const cx = Math.floor(o.body.center.x / T);
      const cy = Math.floor(o.body.center.y / T);
      if (cx < 0 || cy < 0 || cx >= w.W || cy >= w.H) continue;
      const i = cy * w.W + cx;
      w.solid[i] = 1;
      this.blockCells.push(i);
    }
  }
  private baseSolid!: Uint8Array;

  /** Moving / falling platforms as predictable rects. */
  private collectPlatforms(): PlatInfo[] {
    const lv = this.h.level()!;
    const out: PlatInfo[] = [];
    for (const go of lv.ctx.groups.platforms.getChildren()) {
      const body = (go as Phaser.GameObjects.Zone).body as Phaser.Physics.Arcade.Body | null;
      if (!body) continue;
      const oneWay = !!(go as Phaser.GameObjects.GameObject).getData('oneWay');
      if (go instanceof MovingPlatform) {
        const mp = go as unknown as { t: number; pathAt(t: number): Phaser.Math.Vector2 };
        out.push({
          w: body.width,
          h: body.height,
          oneWay,
          at: (tMs, o) => {
            if (!body.enable) return false;
            if (tMs <= 0) {
              o.x = body.x;
              o.y = body.y;
              return true;
            }
            const p = mp.pathAt(mp.t + tMs / 1000);
            o.x = p.x;
            o.y = p.y;
            return true;
          },
        });
      } else if (go instanceof FallingPlatform) {
        const fp = go as unknown as { pmode: string; timer: number };
        const x0 = body.x;
        const y0 = body.y;
        out.push({
          w: body.width,
          h: body.height,
          oneWay,
          at: (tMs, o) => {
            if (!body.enable || fp.pmode === 'gone') return false;
            if (fp.pmode === 'falling') {
              // falls away; treat as gone shortly
              if (tMs > 100) return false;
              o.x = body.x;
              o.y = body.y;
              return true;
            }
            if (fp.pmode === 'shaking' && fp.timer + tMs > 520) return false;
            o.x = x0;
            o.y = y0;
            return true;
          },
        });
      } else {
        out.push({ w: body.width, h: body.height, oneWay, at: (_t, o) => ((o.x = body.x), (o.y = body.y), body.enable) });
      }
    }
    return out;
  }

  /** Dynamic hazards & enemies, predicted from their current state. */
  private collectMovers(): Mover[] {
    const lv = this.h.level()!;
    const c = lv.ctx;
    const p = c.player;
    const out: Mover[] = [];
    const px = p.x;
    const py = p.y;
    const near = (x: number, y: number, r = 360) => Math.abs(x - px) < r && Math.abs(y - py) < 260;
    for (const go of c.groups.enemies.getChildren()) {
      const e = go as Enemy;
      if (!e.active || e.dead || !e.body) continue;
      const b = e.body as Phaser.Physics.Arcade.Body;
      if (!b.enable || !near(b.center.x, b.center.y, 420)) continue;
      const outcome = e.stompOutcome();
      const hurts = e.hurtsOnContact();
      const isBoss = e instanceof Boss;
      const x0 = b.x;
      const y0 = b.y;
      const vx = b.velocity.x;
      const vy = b.allowGravity ? 0 : b.velocity.y;
      const w = b.width;
      const hgt = b.height;
      if (!hurts && outcome === 'none') continue;
      out.push({
        kind: 'enemy',
        stompable: outcome !== 'none',
        stompDamages: outcome === 'damage',
        isBoss,
        horizonMs: isBoss ? 2000 : 900,
        at: (tMs, o) => {
          const s = tMs / 1000;
          o.x = x0 + vx * s;
          o.y = y0 + vy * s;
          o.w = w;
          o.h = hgt;
          return hurts || outcome !== 'none';
        },
      });
    }
    for (const go of c.groups.enemyProjectiles.getChildren()) {
      const s = go as Phaser.Physics.Arcade.Sprite & { harmful?: boolean };
      if (!s.active || !s.body || s.harmful === false) continue;
      const b = s.body as Phaser.Physics.Arcade.Body;
      if (!near(b.center.x, b.center.y, 400)) continue;
      const x0 = b.x;
      const y0 = b.y;
      const vx = b.velocity.x;
      const vy = b.velocity.y;
      const w = b.width;
      const hgt = b.height;
      out.push({ kind: 'shot', stompable: false, stompDamages: false, isBoss: false, horizonMs: 1200, at: (tMs, o) => ((o.x = x0 + (vx * tMs) / 1000), (o.y = y0 + (vy * tMs) / 1000), (o.w = w), (o.h = hgt), true) });
    }
    const cam = lv.cameras.main.worldView;
    for (const go of lv.children.list) {
      if (go instanceof SteamVent) {
        const v = go as unknown as { t: number; lift: boolean; zoneRect: Phaser.Geom.Rectangle; phaseAt(t: number): string };
        const r = v.zoneRect;
        if (!near(r.centerX, r.bottom, 400)) continue;
        out.push({
          kind: v.lift ? 'lift' : 'vent',
          stompable: false,
          stompDamages: false,
          isBoss: false,
          horizonMs: 1e9,
          at: (tMs, o) => {
            if (v.phaseAt(v.t + tMs / 1000) !== 'active') return false;
            o.x = r.x;
            o.y = r.y;
            o.w = r.width;
            o.h = r.height;
            return true;
          },
        });
      } else if (go instanceof PassingTrain) {
        const tr = go as unknown as {
          hazard: boolean;
          pmode: 'idle' | 'warning' | 'passing';
          stateMs: number;
          t: number;
          interval: number;
          dir: 1 | -1;
          cars: number;
          speed: number;
          lane: Phaser.Geom.Rectangle;
          trainX: number;
          train: { width: number; height: number } | null;
        };
        if (!tr.hazard) continue;
        const lane = tr.lane;
        if (!(px > lane.left - 200 && px < lane.right + 200 && py > lane.top - 140 && py < lane.bottom + 100)) continue;
        const width = tr.train?.width ?? (tr.cars + 1) * 130;
        const hgt = Math.min(tr.train?.height ?? 40, lane.height);
        let startIn: number; // ms until the train starts moving (passing)
        let x0: number;
        if (tr.pmode === 'passing') {
          startIn = 0;
          x0 = tr.trainX;
        } else {
          startIn = tr.pmode === 'warning' ? PassingTrain.TELEGRAPH_MS - tr.stateMs : Math.max(0, tr.interval - tr.t) * 1000 + PassingTrain.TELEGRAPH_MS;
          const leftStart = Math.min(cam.left, lane.left) - width - 16;
          const rightStart = Math.max(cam.right, lane.right) + 16;
          x0 = tr.dir > 0 ? leftStart : rightStart;
        }
        const dir = tr.dir;
        const speed = tr.speed;
        out.push({
          kind: 'train',
          stompable: false,
          stompDamages: false,
          isBoss: false,
          horizonMs: 1e9,
          at: (tMs, o) => {
            if (tMs < startIn) return false;
            o.x = x0 + (dir * speed * (tMs - startIn)) / 1000;
            o.y = lane.bottom - hgt;
            o.w = width;
            o.h = hgt;
            return true;
          },
        });
      } else if (go instanceof KillZone) {
        const r = (go as unknown as { rect: Phaser.Geom.Rectangle }).rect;
        out.push({ kind: 'kill', stompable: false, stompDamages: false, isBoss: false, horizonMs: 1e9, at: (_t, o) => ((o.x = r.x), (o.y = r.y), (o.w = r.width), (o.h = r.height), true) });
      }
    }
    return out;
  }

  // ═════════════════════════════ simulation ═════════════════════════════

  private initState(): SimState {
    const p = this.h.level()!.player;
    const b = p.body;
    let plat = -1;
    if (p.groundPlatform) {
      const plats = this.h.level()!.ctx.groups.platforms.getChildren();
      plat = plats.findIndex((g) => (g as Phaser.GameObjects.Zone).body === p.groundPlatform);
    }
    const pi = p as unknown as { appliedCarryVx: number; appliedExtraVy: number; stuckToGround: boolean; dropThroughUntil: number };
    return {
      x: b.center.x,
      bottom: b.bottom,
      bvx: b.velocity.x,
      bvy: b.velocity.y,
      m: cloneMotor(p.motor),
      plat,
      carry: pi.appliedCarryVx ?? 0,
      extraVy: pi.appliedExtraVy ?? 0,
      stuck: !!pi.stuckToGround,
      t: 0,
      dead: false,
      hurt: 0,
      hurtAt: -1,
      stomps: 0,
      bossStomps: 0,
      // the input latched last frame is consumed by the next physics step (with its press edge)
      prevJump: this.prevPrevJump,
      leftGround: !p.motor.grounded,
      dropUntil: 0,
      noDmgUntil: 0,
    };
  }

  private cell(c: number, r: number, a: Uint8Array): boolean {
    const w = this.world;
    if (c < 0 || c >= w.W) return a === w.solid;
    if (r < 0 || r >= w.H) return false;
    return a[r * w.W + c] === 1;
  }

  private overlapsGrid(a: Uint8Array, x0: number, y0: number, x1: number, y1: number): boolean {
    const c0 = Math.floor(x0 / T);
    const c1 = Math.floor((x1 - 0.001) / T);
    const r0 = Math.floor(y0 / T);
    const r1 = Math.floor((y1 - 0.001) / T);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (this.cell(c, r, a)) return true;
    return false;
  }

  private tmpRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private tmpPos = { x: 0, y: 0 };
  private tmpPos2 = { x: 0, y: 0 };

  /** Arcade body being separated in `step` (position = top-left). */
  private body = { x: 0, y: 0, px: 0, py: 0, w: 0, h: 0, vx: 0, vy: 0, bl: false, br: false, bu: false, bd: false };

  /** Emulates Arcade's collideSpriteVsTilemapLayer + SeparateTile for one grid. */
  private collideLayer(grid: Uint8Array, oneWay: boolean): void {
    const w = this.world;
    const B = this.body;
    const ground = this.baseSolid;
    const c0 = Math.floor((B.x - T) / T);
    const c1 = Math.floor((B.x + B.w) / T);
    const r0 = Math.floor((B.y - T) / T);
    const r1 = Math.floor((B.y + B.h) / T);
    const bias = 20; // main-config arcade.tileBias
    const at = (g: Uint8Array, c: number, r: number) => c >= 0 && c < w.W && r >= 0 && r < w.H && g[r * w.W + c] === 1;
    for (let r = Math.max(0, r0); r <= Math.min(w.H - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(w.W - 1, c1); c++) {
        if (grid[r * w.W + c] !== 1) continue;
        const tl = c * T;
        const tt = r * T;
        const tr = tl + T;
        const tb = tt + T;
        if (B.x + B.w <= tl || B.y + B.h <= tt || B.x >= tr || B.y >= tb) continue;
        // faces & collision directions
        let fT: boolean, fB: boolean, fL: boolean, fR: boolean;
        let cUp = true;
        let cSide = true;
        let cDown = true;
        if (oneWay) {
          fT = !at(grid, c, r - 1);
          fB = !at(grid, c, r + 1);
          fL = !at(grid, c - 1, r);
          fR = !at(grid, c + 1, r);
          cSide = false;
          cDown = false;
        } else if (ground[r * w.W + c]) {
          fT = !at(ground, c, r - 1);
          fB = !at(ground, c, r + 1);
          fL = !at(ground, c - 1, r);
          fR = !at(ground, c + 1, r);
        } else {
          fT = fB = fL = fR = true; // block (separate static body)
        }
        const fH = fL || fR;
        const fV = fT || fB;
        if (!fH && !fV) continue;
        const dX = B.x - B.px;
        const dY = B.y - B.py;
        let minX = 0;
        let minY = 1;
        if (Math.abs(dX) > Math.abs(dY)) minX = -1;
        else if (Math.abs(dX) < Math.abs(dY)) minY = -1;
        if (dX !== 0 && dY !== 0 && fH && fV) {
          minX = Math.min(Math.abs(B.x - tr), Math.abs(B.x + B.w - tl));
          minY = Math.min(Math.abs(B.y - tb), Math.abs(B.y + B.h - tt));
        }
        const checkX = (): number => {
          const ddx = B.x - B.px;
          let ox = 0;
          if (ddx < 0 && cSide && fR && B.x < tr) {
            ox = B.x - tr;
            if (ox < -bias) ox = 0;
          } else if (ddx > 0 && cSide && fL && B.x + B.w > tl) {
            ox = B.x + B.w - tl;
            if (ox > bias) ox = 0;
          }
          if (ox !== 0) {
            if (ox < 0) B.bl = true;
            else B.br = true;
            B.x -= ox;
            B.vx = 0;
          }
          return ox;
        };
        const checkY = (): number => {
          const ddy = B.y - B.py;
          let oy = 0;
          if (ddy < 0 && cDown && fB && B.y < tb) {
            oy = B.y - tb;
            if (oy < -bias) oy = 0;
          } else if (ddy > 0 && cUp && fT && B.y + B.h > tt) {
            oy = B.y + B.h - tt;
            if (oy > bias) oy = 0;
          }
          if (oy !== 0) {
            if (oy < 0) B.bu = true;
            else B.bd = true;
            B.y -= oy;
            B.vy = 0;
          }
          return oy;
        };
        const still = () => !(B.x + B.w <= tl || B.y + B.h <= tt || B.x >= tr || B.y >= tb);
        if (minX < minY) {
          if (fH && checkX() !== 0 && !still()) continue;
          if (fV) checkY();
        } else {
          if (fV && checkY() !== 0 && !still()) continue;
          if (fH) checkX();
        }
      }
    }
  }

  /** One physics step (mirrors Arcade integration + Player.physicsStep). */
  private step(s: SimState, inp: Input, dmgOn: boolean): void {
    const w = this.world;
    const hw = this.bw / 2;
    const bh = this.bh;
    const dt = DT / 1000;
    const prevBottom = s.bottom;
    // ── Arcade: integrate, then separate against tiles (Phaser's SeparateTile rules) ──
    const B = this.body;
    B.px = s.x - hw;
    B.py = s.bottom - bh;
    B.x = B.px + s.bvx * dt;
    B.y = B.py + s.bvy * dt;
    B.w = this.bw;
    B.h = bh;
    B.vx = s.bvx;
    B.vy = s.bvy;
    B.bl = B.br = B.bu = B.bd = false;
    this.collideLayer(w.solid, false);
    const dropping = s.t < s.dropUntil;
    if (!dropping) this.collideLayer(w.oneway, true);
    let ny = B.y + bh;
    let newPlat = -1;
    let blockedDown = B.bd;
    if (!w.graphMode && !dropping && B.vy >= 0) {
      for (let i = 0; i < w.plats.length; i++) {
        const pl = w.plats[i];
        if (!pl.at(s.t + DT, this.tmpPos)) continue;
        const top = this.tmpPos.y;
        // Player.currentPlatform() drops platforms overlapped by ≤ 1 px: demand a little more
        if (B.x + B.w <= this.tmpPos.x + 2 || B.x >= this.tmpPos.x + pl.w - 2) continue;
        const prevTop = pl.at(s.t, this.tmpPos2) ? this.tmpPos2.y : top;
        if (prevBottom <= prevTop + 6 && ny >= top - 0.01 && ny - top <= Math.abs(s.bvy * dt) + Math.abs(top - prevTop) + 4 + 0.01 && (!blockedDown || top < ny)) {
          ny = top;
          blockedDown = true;
          newPlat = i;
        }
      }
    }
    s.x = B.x + hw;
    const blockedX = B.bl || B.br;
    const blockedUp = B.bu;
    s.bottom = ny;
    s.t += DT;
    let bvy = B.vy;
    const bvx = B.vx;
    if (newPlat >= 0) bvy = 0;
    s.plat = newPlat;

    // ── hazards / death ──
    if (s.bottom > w.H * T + 32) {
      s.dead = true;
      return;
    }
    const top = s.bottom - bh;
    {
      const c0 = Math.floor((s.x - hw) / T);
      const c1 = Math.floor((s.x + hw - 0.001) / T);
      const r0 = Math.floor(top / T);
      const r1 = Math.floor((s.bottom - 0.001) / T);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (this.cell(c, r, w.water) && s.bottom > r * T + 6) {
            s.dead = true;
            return;
          }
          if (this.cell(c, r, w.hazard) && dmgOn && s.t > s.noDmgUntil) this.hurt(s);
        }
      }
    }
    // pads
    let bounced = 0;
    if (bvy >= 0 || s.bottom > prevBottom) {
      for (const pad of w.pads) {
        if (s.x + hw > pad.x && s.x - hw < pad.x + pad.w && s.bottom > pad.y && top < pad.y + pad.h && s.bottom <= pad.y + pad.h + 2) bounced = -PHYSICS.bouncePadVelocity;
      }
    }
    // movers
    let stompV = 0;
    if (!w.graphMode) {
      const r = this.tmpRect;
      for (const mv of w.movers) {
        if (s.t > mv.horizonMs) continue;
        if (!mv.at(s.t, r)) continue;
        if (s.x + hw <= r.x || s.x - hw >= r.x + r.w || s.bottom <= r.y || top >= r.y + r.h) continue;
        if (mv.kind === 'kill') {
          s.dead = true;
          return;
        }
        if (mv.kind === 'lift') {
          if (bvy > -240 && bounced === 0) bounced = 430;
          continue;
        }
        if (mv.kind === 'enemy' && mv.stompable) {
          const tol = Math.max(8, Math.min(16, r.h * 0.5));
          const descending = bvy > 0 || (bvy > -40 && s.bottom <= r.y + 4);
          if (descending && prevBottom <= r.y + tol) {
            stompV = inp.jump ? PHYSICS.stompBounceHeld : PHYSICS.stompBounce;
            s.stomps++;
            if (mv.isBoss && mv.stompDamages) s.bossStomps++;
            s.bottom = Math.min(s.bottom, r.y);
            mv.horizonMs = mv.isBoss ? s.t + 300 : -1; // consumed
            continue;
          }
        }
        if (dmgOn && s.t > s.noDmgUntil) this.hurt(s);
      }
    }

    // ── Player.physicsStep: readback ──
    const m = s.m;
    m.vx = bvx - s.carry;
    if (blockedX) m.vx = 0;
    const readVy = bvy;
    m.vy = s.stuck && readVy > s.extraVy - 100 ? 0 : readVy;
    let platVx = 0;
    let platVy = 0;
    if (s.plat >= 0) {
      const pl = w.plats[s.plat];
      if (pl.at(s.t, this.tmpPos) && pl.at(s.t + DT, this.tmpPos2)) {
        platVx = (this.tmpPos2.x - this.tmpPos.x) / dt;
        platVy = (this.tmpPos2.y - this.tmpPos.y) / dt;
      }
      if (!s.stuck && readVy - platVy > -60) m.vy = 0;
    }
    const touching = blockedDown || s.plat >= 0;
    m.grounded = touching && m.vy >= 0;
    if (!m.grounded && blockedUp && m.vy <= 0) bonkCeiling(m);
    const full: InputState = {
      left: !!inp.left,
      right: !!inp.right,
      up: false,
      down: false,
      jump: !!inp.jump,
      jumpPressed: !!inp.jump && !s.prevJump,
      run: !!inp.run,
      attack: false,
      attackPressed: false,
      pausePressed: false,
    };
    s.prevJump = !!inp.jump;
    stepHorizontal(m, full, this.stats, DT, this.mods, false);
    const jumped = tryJump(m, full, this.stats, DT, this.mods);
    if (!jumped) stepVertical(m, full, DT);
    else if (s.plat >= 0) {
      // Player.onJump: jumping off a moving platform keeps its momentum
      m.vx += platVx;
      s.plat = -1;
    }
    if (bounced || stompV) {
      startJump(m, this.stats, this.mods, Math.abs(bounced || stompV));
      if (!bounced && !inp.jump) m.jumping = false;
      m.jumpCut = false;
      s.plat = -1;
    }
    let extra = 0;
    let carry = 0;
    if (m.grounded && m.vy >= 0) {
      extra = PHYSICS.groundStickVy + (s.plat >= 0 ? platVy : 0);
      if (s.plat >= 0) carry = platVx;
    }
    s.extraVy = extra;
    s.stuck = m.grounded && m.vy >= 0;
    s.carry = carry;
    s.bvx = m.vx + carry;
    s.bvy = m.vy + extra;
    if (!m.grounded) s.leftGround = true;
  }

  private hurt(s: SimState): void {
    if (s.hurtAt < 0) s.hurtAt = s.t;
    s.hurt++;
    // after a hit the player is invulnerable for a while
    s.noDmgUntil = s.t + PHYSICS.hurtInvulnMs;
  }

  // ═════════════════════════════ navigation graph ═════════════════════════════

  private buildGraph(goal: { x: number; y: number } | null): void {
    const t0 = performance.now();
    const lv = this.h.level()!;
    const p = lv.player;
    this.stats = p.stats;
    this.mods = p.mods;
    this.bw = p.def.body.width;
    this.bh = p.def.body.height;
    this.world = this.buildWorld();
    this.baseSolid = this.world.solid.slice();
    this.syncBlocks();
    const w = this.world;
    const W = w.W;
    // Platforms: their paths become one-way cells in graph mode.
    const plats = this.collectPlatforms();
    const graphOneway = w.oneway.slice();
    this.platCells = [];
    const pos = { x: 0, y: 0 };
    for (const pl of plats) {
      const cells = new Set<number>();
      const mp = pl as PlatInfo;
      // sample the path over a long window (its period is ≤ 20 s)
      for (let t = 0; t <= 20000; t += 100) {
        if (!mp.at(t, pos)) continue;
        const r = Math.round(pos.y / T);
        const c0 = Math.round(pos.x / T);
        const n = Math.round(pl.w / T);
        for (let k = 0; k < n; k++) {
          const c = c0 + k;
          if (c < 0 || c >= W || r < 0 || r >= w.H) continue;
          const i = r * W + c;
          if (!w.solid[i]) cells.add(i);
        }
      }
      for (const i of cells) graphOneway[i] = 1;
      this.platCells.push([...cells]);
    }
    const realOneway = w.oneway;
    w.oneway = graphOneway;
    w.graphMode = true;

    this.nodeId = new Int32Array(W * w.H).fill(-1);
    this.nodeCell = [];
    const addNode = (i: number): number => {
      if (this.nodeId[i] >= 0) return this.nodeId[i];
      this.nodeId[i] = this.nodeCell.length;
      this.nodeCell.push(i);
      return this.nodeId[i];
    };
    const edges: { a: number; b: number; c: number }[] = [];
    const startCell = this.surfaceUnder(p.body.center.x, p.body.bottom);
    const queue: number[] = [];
    const visited = new Uint8Array(W * w.H);
    const push = (cellIdx: number) => {
      if (cellIdx < 0 || visited[cellIdx]) return;
      visited[cellIdx] = 1;
      addNode(cellIdx);
      queue.push(cellIdx);
    };
    // Seed with the start and with every checkpoint (respawn points).
    push(startCell);
    for (const cp of this.h.checkpoints()) push(this.surfaceUnder(cp.x, cp.y));
    const walkCost = (T / this.stats.runSpeed) * 60;
    const platOf = new Map<number, number>();
    this.platCells.forEach((cells, g) => cells.forEach((i) => platOf.set(i, g)));
    const maxEdges = 400000;
    while (queue.length && edges.length < maxEdges) {
      const i = queue.shift()!;
      const a = this.nodeId[i];
      const c = i % W;
      const r = Math.floor(i / W);
      // walking
      for (const d of [-1, 1]) {
        const j = i + d;
        if (c + d < 0 || c + d >= W) continue;
        if (this.standable(j)) {
          push(j);
          edges.push({ a, b: this.nodeId[j], c: walkCost });
        }
      }
      // riding a moving platform (adjacent cells of its path)
      const g = platOf.get(i);
      if (g !== undefined) {
        const cells = this.platCells[g];
        const rideCost = walkCost * 1.5;
        for (const j of cells) {
          const dc = Math.abs((j % W) - c);
          const dr = Math.abs(Math.floor(j / W) - r);
          if (dc + dr === 1 && this.standable(j)) {
            push(j);
            edges.push({ a, b: this.nodeId[j], c: rideCost });
          }
        }
      }
      // jumps and walk-offs
      for (const land of this.arcsFrom(i)) {
        if (land.cell === i) continue;
        push(land.cell);
        edges.push({ a, b: this.nodeId[land.cell], c: land.frames });
      }
    }
    this.edgeCount = edges.length;
    // reverse Dijkstra from the targets
    const N = this.nodeCell.length;
    const rev: number[][] = Array.from({ length: N }, () => []);
    const revC: number[][] = Array.from({ length: N }, () => []);
    for (const e of edges) {
      rev[e.b].push(e.a);
      revC[e.b].push(e.c);
    }
    const cost = new Float64Array(N).fill(INF);
    const targets: number[] = [];
    for (let n = 0; n < N; n++) {
      const ci = this.nodeCell[n];
      const cx = (ci % W) * T + 8;
      const cy = Math.floor(ci / W) * T;
      if (goal && Math.abs(cx - goal.x) <= 16 && Math.abs(cy - goal.y) <= 40) targets.push(n);
      if (!goal && this.arena && cx > this.arena.x + 56 && cx < this.arena.right - 24 && cy >= this.arena.y && cy <= this.arena.bottom + 16) targets.push(n);
    }
    const dijkstra = (init: (n: number) => number) => {
      const heap = new MinHeap();
      for (let n = 0; n < N; n++) {
        cost[n] = init(n);
        if (cost[n] < INF) heap.push(n, cost[n]);
      }
      while (heap.size) {
        const [n, d] = heap.pop();
        if (d > cost[n]) continue;
        const from = rev[n];
        const fc = revC[n];
        for (let k = 0; k < from.length; k++) {
          const nd = d + fc[k];
          if (nd < cost[from[k]]) {
            cost[from[k]] = nd;
            heap.push(from[k], nd);
          }
        }
      }
    };
    const targetSet = new Set(targets);
    dijkstra((n) => (targetSet.has(n) ? 0 : INF));
    const startNode = startCell >= 0 ? this.nodeId[startCell] : -1;
    this.goalReachable = targets.length > 0 && startNode >= 0 && cost[startNode] < INF;
    if (!this.goalReachable) {
      // Unreachable goal: head for the explored nodes closest to it.
      const gx = goal?.x ?? this.arena?.centerX ?? w.W * T;
      const k = (60 / this.stats.runSpeed) * 3;
      dijkstra((n) => Math.abs(gx - ((this.nodeCell[n] % W) * T + 8)) * k);
    }
    this.cost = cost;
    w.oneway = realOneway;
    w.graphMode = false;
    w.plats = plats;
    this.buildMs = performance.now() - t0;
  }

  /** The surface cell (solid / one-way) under a body standing at (x, bottom). */
  private surfaceUnder(x: number, bottom: number): number {
    const w = this.world;
    const r0 = Math.floor((bottom + 1) / T);
    for (let r = r0; r < Math.min(w.H, r0 + 3); r++) {
      for (const dx of [0, -this.bw / 2 + 1, this.bw / 2 - 1]) {
        const c = Math.floor((x + dx) / T);
        if (c < 0 || c >= w.W) continue;
        const i = r * w.W + c;
        if (w.solid[i] || w.oneway[i]) return i;
      }
    }
    return -1;
  }

  /** Can the character stand on cell i (surface with free space above)? */
  private standable(i: number): boolean {
    const w = this.world;
    if (i < 0 || i >= w.W * w.H) return false;
    if (!(w.solid[i] || w.oneway[i])) return false;
    const c = i % w.W;
    const r = Math.floor(i / w.W);
    const x = c * T + 8;
    const hw = Math.min(this.bw, 12) / 2;
    if (this.overlapsGrid(w.solid, x - hw, r * T - this.bh, x + hw, r * T)) return false;
    if (this.overlapsGrid(w.hazard, x - hw, r * T - 4, x + hw, r * T)) return false;
    if (w.water[i] || (r > 0 && w.water[i - w.W])) return false;
    return true;
  }

  /** Simulated arcs from standing on cell i: returns landing cells and frames. */
  private arcsFrom(i: number): { cell: number; frames: number }[] {
    const w = this.world;
    const c = i % w.W;
    const r = Math.floor(i / w.W);
    const x = c * T + 8;
    const y = r * T;
    const out = new Map<number, number>();
    const st = this.stats;
    const speeds = [0, st.walkSpeed, st.runSpeed];
    const holds = [5, 12, 60];
    for (const dir of [-1, 1]) {
      // edge detection for walk-offs
      const edge = !this.standable(i + dir);
      for (const sp of speeds) {
        const run = sp > st.walkSpeed;
        const runupPenalty = sp === 0 ? 0 : run ? 10 : 4;
        const profiles: ((k: number, s: SimState) => Input)[] = [];
        for (const hold of holds) {
          profiles.push((k) => ({ right: dir > 0, left: dir < 0, run, jump: k < hold }));
          profiles.push((k, s) => ({ right: dir > 0 && s.m.vy < 0, left: dir < 0 && s.m.vy < 0, run, jump: k < hold }));
          if (sp === 0) profiles.push((k, s) => ({ right: dir > 0 && s.m.vy >= 0, left: dir < 0 && s.m.vy >= 0, run: true, jump: k < hold }));
        }
        if (edge) profiles.push(() => ({ right: dir > 0, left: dir < 0, run, jump: false }));
        for (const prof of profiles) {
          const s: SimState = {
            x,
            bottom: y,
            bvx: dir * sp,
            bvy: PHYSICS.groundStickVy,
            m: { vx: dir * sp, vy: 0, facing: dir as 1 | -1, grounded: true, sinceGroundedMs: 0, jumpBufferMs: Infinity, jumping: false, jumpCut: false },
            plat: -1,
            carry: 0,
            extraVy: PHYSICS.groundStickVy,
            stuck: true,
            t: 0,
            dead: false,
            hurt: 0,
            hurtAt: -1,
            stomps: 0,
            bossStomps: 0,
            prevJump: false,
            leftGround: false,
            dropUntil: 0,
            noDmgUntil: 0,
          };
          let k = 0;
          for (; k < 150; k++) {
            this.step(s, prof(k, s), true);
            if (s.dead || s.hurt) break;
            if (s.leftGround && s.m.grounded) break;
            if (!s.leftGround && k > 40) break;
          }
          if (s.dead || s.hurt || !s.leftGround || !s.m.grounded) continue;
          const land = this.surfaceUnder(s.x, s.bottom);
          if (land < 0 || !this.standable(land)) continue;
          const f = k + 1 + runupPenalty;
          const prev = out.get(land);
          if (prev === undefined || f < prev) out.set(land, f);
        }
      }
    }
    return [...out].map(([cell, frames]) => ({ cell, frames }));
  }

  /** Cost-to-go (frames) for a body at (x, bottom). */
  private costAt(x: number, bottom: number): number {
    if (this.boss && this.boss.started && !this.boss.defeated) {
      const a = this.arena!;
      if (x > a.x && x < a.right && bottom > a.y - 64 && bottom <= a.bottom + 48) return this.bossCost(x);
    }
    const w = this.world;
    const r = Math.round(bottom / T);
    let best = INF;
    for (const rr of [r, r + 1, r - 1]) {
      if (rr < 0 || rr >= w.H) continue;
      for (const dx of [0, -this.bw / 2 + 1, this.bw / 2 - 1]) {
        const c = Math.floor((x + dx) / T);
        if (c < 0 || c >= w.W) continue;
        const n = this.nodeId[rr * w.W + c];
        if (n >= 0) {
          const v = this.cost[n];
          if (v < best) best = v;
        }
      }
      if (best < INF) return best;
    }
    return best;
  }

  /** In the boss arena: be next to the boss while it can be stomped, otherwise keep away. */
  private bossCost(x: number): number {
    const b = this.boss!;
    const bx = b.body ? (b.body as Phaser.Physics.Arcade.Body).center.x : b.x;
    const stompable = b.stompOutcome() === 'damage';
    const a = this.arena!;
    let target: number;
    if (stompable) target = bx;
    else {
      // stay on the side with more room, ~130 px away
      const left = bx - 130;
      const right = bx + 130;
      target = left > a.x + 24 ? left : right < a.right - 24 ? right : a.x + 40;
    }
    return (Math.abs(x - target) / this.stats.runSpeed) * 60;
  }

  // ═════════════════════════════ decisions ═════════════════════════════

  private candidates: Candidate[] | null = null;
  private groundCandidates(): Candidate[] {
    if (this.candidates) return this.candidates;
    const out: Candidate[] = [];
    out.push({ name: 'wait', dur: 30, jump: false, input: () => ({}) });
    for (const dir of [-1, 1]) {
      for (const dur of [3, 14]) {
        out.push({ name: `run${dir}:${dur}`, dur, jump: false, input: () => ({ right: dir > 0, left: dir < 0, run: true }) });
      }
      out.push({ name: `walk${dir}`, dur: 10, jump: false, input: () => ({ right: dir > 0, left: dir < 0, run: false }) });
    }
    const jump = (name: string, dir: number, hold: number, steer: (s: SimState) => boolean) =>
      out.push({ name: `${name}${dir}:${hold}`, dur: Infinity, jump: true, input: (k, s) => ({ right: dir > 0 && steer(s), left: dir < 0 && steer(s), run: true, jump: k < hold }) });
    const always = () => true;
    const rising = (s: SimState) => s.m.vy < 0; // steer until the apex, then drop straight
    const late = (s: SimState) => s.m.vy >= -60; // jump straight up, steer near the apex
    for (const hold of [8, 22, 60]) jump('j', 0, hold, always);
    for (const dir of [-1, 1]) {
      for (const hold of [3, 8, 14, 22, 60]) jump('j', dir, hold, always);
      for (const hold of [8, 60]) jump('ja', dir, hold, rising);
      for (const hold of [14, 60]) jump('jl', dir, hold, late);
    }
    this.candidates = out;
    return out;
  }

  private airCandidates(): Candidate[] {
    const out: Candidate[] = [];
    const holding = !!this.lastInput.jump;
    for (const dir of [-1, 0, 1]) {
      for (const run of [true, false]) {
        if (!run && dir === 0) continue;
        out.push({ name: `a${dir}${run ? 'r' : 'w'}`, dur: Infinity, jump: false, input: () => ({ right: dir > 0, left: dir < 0, run, jump: false }) });
        if (holding) out.push({ name: `ah${dir}${run ? 'r' : 'w'}`, dur: Infinity, jump: false, input: () => ({ right: dir > 0, left: dir < 0, run, jump: true }) });
      }
    }
    return out;
  }

  private decide(): Input {
    const lv = this.h.level()!;
    const p = lv.player;
    if (this.idleFrames > 0) {
      this.idleFrames--;
      return {};
    }
    if (p.mode !== 'normal' && p.mode !== 'ability') return {};
    if (this.sloppy && this.random() < this.sloppy * 0.12) return { ...this.lastInput };
    this.syncBlocks();
    const w = this.world;
    w.movers = this.collectMovers();
    const dmgOn = !this.invulnerable;
    const now = lv.ctx.now();
    const invulnMs = Math.max(0, p.invulnUntil - now);
    // A jump pressed last frame fires on the next physics step: we're effectively airborne.
    const grounded = p.grounded && !(this.lastInput.jump && !this.prevPrevJump);

    // Run-up manoeuvre in progress
    if (grounded && this.runupDir !== 0) {
      if (this.frames < this.runupUntil) {
        const cand: Candidate = { name: 'runup', dur: 6, jump: false, input: () => ({ right: this.runupDir > 0, left: this.runupDir < 0, run: true }) };
        const ev = this.evaluate(cand, dmgOn, invulnMs);
        if (ev.base + this.restPenalty(ev, dmgOn) < DEATH / 4) return cand.input(0, this.initState());
      }
      this.runupDir = 0;
    }

    const cands = grounded ? this.groundCandidates() : this.airCandidates();
    let best: Candidate | null = null;
    let bestScore = Infinity;
    const evals: { cand: Candidate; e: Evaluation; sc: number }[] = [];
    for (const cand of cands) {
      const e = this.evaluate(cand, dmgOn, invulnMs);
      let sc = e.base;
      if (cand.name === this.lastChoice) sc -= 1.5;
      if (this.noise) sc += this.random() * this.noise;
      if (this.sloppy) sc += this.random() * this.sloppy * 24;
      evals.push({ cand, e, sc });
    }
    evals.sort((a, b) => a.sc - b.sc);
    if (this.detail && this.frames >= this.detail[0] && this.frames <= this.detail[1]) for (const ev of evals) this.trace.push(['E', this.frames, ev.cand.name, Math.round(ev.sc), ev.e.end ?? '']);
    for (const ev of evals) {
      if (ev.sc >= bestScore) break;
      const full = ev.sc + this.restPenalty(ev.e, dmgOn);
      if (this.detail && this.frames >= this.detail[0] && this.frames <= this.detail[1]) this.trace.push(['C', this.frames, ev.cand.name, Math.round(ev.sc), Math.round(full)]);
      if (full < bestScore) {
        bestScore = full;
        best = ev.cand;
      }
    }
    if (!best) return {};
    // Stalled at an edge (waiting) with nothing dynamic to wait for → back off for a run-up.
    if (grounded) {
      const node = this.surfaceUnder(p.body.center.x, p.body.bottom);
      const stalled = (best.name === 'wait' || best.name.startsWith('run') && best.name.endsWith(':3')) && Math.abs(p.body.velocity.x) < 30;
      if (stalled && node === this.waitNode) this.waitFrames++;
      else if (!stalled) this.waitFrames = 0;
      this.waitNode = node;
      const dynamicNear = w.movers.some((m) => m.kind !== 'enemy' || !this.invulnerable) || w.plats.some((pl) => pl.at(0, this.tmpPos) && Math.abs(this.tmpPos.x - p.x) < 260 && Math.abs(this.tmpPos.y - p.y) < 200);
      if (this.waitFrames > (dynamicNear ? 150 : 40) && !(this.boss?.started)) {
        this.waitFrames = 0;
        this.runupTries++;
        const goalDir = this.goalDirection();
        this.runupDir = -goalDir;
        this.runupUntil = this.frames + 12 + 10 * Math.min(5, this.runupTries);
        return { right: this.runupDir > 0, left: this.runupDir < 0, run: true };
      }
    }
    this.lastChoice = best.name;
    if (this.traceN) {
      const row: (string | number)[] = [this.frames, Math.round(p.x * 10) / 10, Math.round(p.body.bottom * 10) / 10, Math.round(p.body.velocity.x), Math.round(p.body.velocity.y), grounded ? 1 : 0, best.name, Math.round(bestScore)];
      for (const pl of w.plats) if (pl.at(0, this.tmpPos) && Math.abs(this.tmpPos.x + pl.w / 2 - p.x) < 200 && Math.abs(this.tmpPos.y - p.body.bottom) < 100) row.push(`plat@${this.tmpPos.x.toFixed(1)},${this.tmpPos.y.toFixed(1)}w${pl.w}`);
      if (p.groundPlatform) row.push(`gp v${p.groundPlatform.velocity.x.toFixed(0)},${p.groundPlatform.velocity.y.toFixed(0)}`);
      this.trace.push(row);
      if (this.trace.length > this.traceN) this.trace.shift();
    }
    const inp = best.input(0, this.initState());
    // never re-press jump in the air (Mom's Sparkle Jump / buffered jumps)
    if (!grounded && inp.jump && !this.lastInput.jump) inp.jump = false;
    // a fresh ground jump needs the button released first
    if (grounded && best.jump && this.lastInput.jump) inp.jump = false;
    return inp;
  }

  /** Which way the cheaper neighbouring nodes lie (for run-ups). */
  private goalDirection(): number {
    const p = this.h.level()!.player;
    const here = this.costAt(p.x, p.body.bottom);
    const l = this.costAt(p.x - 24, p.body.bottom);
    const r = this.costAt(p.x + 24, p.body.bottom);
    if (r < INF / 2 && r <= here) return 1;
    if (l < INF / 2 && l <= here) return -1;
    const goal = this.h.goal();
    return goal && goal.x < p.x ? -1 : 1;
  }

  /** Simulate a candidate from the current state; lower is better. */
  private evaluate(cand: Candidate, dmgOn: boolean, invulnMs: number): Evaluation {
    const w = this.world;
    const s = this.initState();
    // reset per-sim mover consumption
    for (const mv of w.movers) if (mv.kind === 'enemy') mv.horizonMs = mv.isBoss ? 2000 : 900;
    s.noDmgUntil = invulnMs;
    // The first physics step still uses the input latched last frame.
    this.step(s, this.lastInput, dmgOn);
    let k = 0;
    let frames = 1;
    const maxF = 170;
    const isJump = cand.jump;
    const startPlat = s.plat;
    let durFrames = -1;
    let durX = 0;
    let durVx = 0;
    let durBottom = 0;
    while (frames < maxF && !s.dead) {
      let inp: Input;
      if (isJump && this.lastInput.jump) inp = k === 0 ? { ...cand.input(0, s), jump: false } : cand.input(k - 1, s);
      else if (k < cand.dur) inp = cand.input(k, s);
      else inp = {};
      this.step(s, inp, dmgOn);
      k++;
      frames++;
      if (s.dead) break;
      if (!isJump && k === cand.dur && s.m.grounded) {
        durFrames = frames;
        durVx = s.m.vx;
        durX = s.x;
        durBottom = s.bottom;
      }
      if (s.leftGround && s.m.grounded) break; // landed
      if (isJump && !s.leftGround && k > 12) break; // the jump never left the ground
      if (!isJump && k >= cand.dur && s.m.grounded && Math.abs(s.m.vx) < 1) break;
    }
    if (s.dead) return { base: DEATH + (maxF - frames), rest: null, end: `dead@${s.x.toFixed(0)},${s.bottom.toFixed(0)} f${frames}` };
    const endVx = s.m.vx;
    const endFrames = frames;
    if (!s.m.grounded && s.plat < 0) {
      // still airborne after the horizon: judge by where we'd be
      const c = this.costAt(s.x, s.bottom);
      return { base: endFrames + (c >= INF / 2 ? 5000 : c + 60) + s.hurt * 500, rest: null, end: `air@${s.x.toFixed(0)},${s.bottom.toFixed(0)}` };
    }
    // Ground moves are judged where the input ends (the coast/brake after it is a safety check).
    const useDur = durFrames > 0 && s.m.grounded && !s.leftGround;
    let c = useDur ? Math.min(this.costAt(durX, durBottom), this.costAt(s.x, s.bottom) + 8) : this.costAt(s.x, s.bottom);
    if (c >= INF / 2) c = 20000;
    let score = (useDur ? durFrames : endFrames) + c;
    // Time still needed to get back up to running speed toward the goal.
    const ex = useDur ? durX : s.x;
    const eb = useDur ? durBottom : s.bottom;
    const toward = Math.sign(this.costAt(ex - 10, eb) - this.costAt(ex + 10, eb));
    if (toward !== 0) score += (Math.max(0, this.stats.runSpeed - (useDur ? durVx : endVx) * toward) / this.stats.groundAccel) * 60 * 0.6;
    if (s.hurt) score += 500 * s.hurt;
    // Prefer landings with some margin: a 1-px toe-hold falls off on the smallest error.
    if (s.leftGround && !this.supported(s, 3)) score += 60;
    // Hopping on a moving platform only adds risk.
    if (isJump && startPlat >= 0 && s.plat === startPlat) score += 40;
    if (s.bossStomps) score -= 2000 * s.bossStomps;
    if (isJump) score += 3;
    return { base: score, end: `${s.x.toFixed(0)},${s.bottom.toFixed(0)} p${s.plat} f${endFrames}`, rest: s.m.grounded ? { s, endFrames, horizons: w.movers.map((m) => m.horizonMs) } : null };
  }

  /** Is the body (shrunk by `inset` px on both sides) standing on something? */
  private supported(s: SimState, inset: number): boolean {
    const w = this.world;
    const hw = this.bw / 2 - inset;
    if (s.plat >= 0) {
      const pl = w.plats[s.plat];
      if (!pl.at(s.t, this.tmpPos)) return false;
      // moving platforms: extra margin (prediction errors compound while it moves)
      return s.x + hw > this.tmpPos.x + 4 && s.x - hw < this.tmpPos.x + pl.w - 4;
    }
    const r = Math.floor((s.bottom + 1) / T);
    const c0 = Math.floor((s.x - hw) / T);
    const c1 = Math.floor((s.x + hw - 0.001) / T);
    for (let c = c0; c <= c1; c++) if (this.cell(c, r, w.solid) || this.cell(c, r, w.oneway)) return true;
    return false;
  }

  /** Rest check: can we stand where the candidate ends for a moment? Extra penalty (or death). */
  private restPenalty(e: Evaluation, dmgOn: boolean): number {
    if (!e.rest) return 0;
    const { s, endFrames, horizons } = e.rest;
    const w = this.world;
    w.movers.forEach((m, i) => (m.horizonMs = horizons[i]));
    const before = s.hurt;
    const n = dmgOn ? 70 : 30;
    for (let r = 0; r < n; r++) {
      this.step(s, {}, dmgOn);
      if (s.dead) return DEATH / 2 + endFrames - e.base;
      if (dmgOn && s.hurt > before) return 250;
    }
    return 0;
  }
}

/** Binary min-heap of (node, priority). */
class MinHeap {
  private n: number[] = [];
  private p: number[] = [];
  get size(): number {
    return this.n.length;
  }
  push(node: number, pri: number): void {
    this.n.push(node);
    this.p.push(pri);
    let i = this.n.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (this.p[par] <= this.p[i]) break;
      this.swap(i, par);
      i = par;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.n[0], this.p[0]];
    const ln = this.n.pop()!;
    const lp = this.p.pop()!;
    if (this.n.length) {
      this.n[0] = ln;
      this.p[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.n.length && this.p[l] < this.p[m]) m = l;
        if (r < this.n.length && this.p[r] < this.p[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.n[a], this.n[b]] = [this.n[b], this.n[a]];
    [this.p[a], this.p[b]] = [this.p[b], this.p[a]];
  }
}
