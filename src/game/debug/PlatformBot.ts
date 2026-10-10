import type Phaser from 'phaser';
import type { CharacterId } from '../types';
import { PHYSICS } from '../config';
import type { Enemy } from '../entities/Enemy';
import type { HarnessInput, TestHarness } from './TestHarness';

/**
 * Heuristic platforming bot. Runs right, and while grounded scans the tile layers
 * ahead (ground / oneway / hazards / water) and nearby enemies; it jumps when a gap,
 * wall, hazard or enemy is within a "lead" distance derived from the player's speed and
 * jump envelope. When it dies or stops making progress it rewinds to an earlier safe
 * spot and retries that section with a different jump-timing variant. A bot failure is
 * NOT proof that a level is impossible — it is a hint where to look.
 *
 * Runs on top of TestHarness in manual (deterministic) mode.
 */

export interface BotOptions {
  levelId?: string;
  character?: CharacterId;
  /** Ignore damage (pits/water still kill → rewind). Tests pure traversal. */
  invulnerable?: boolean;
  /** Give up after this many simulated frames (default 3 simulated minutes). */
  maxFrames?: number;
  /** Retries per failure location before giving up (default 10). */
  maxAttemptsPerSection?: number;
  /** Frames without new max-x progress that count as stuck (default 240 = 4 s). */
  stuckFrames?: number;
  /** Step one frame per animation frame so a human can watch (debug overlay `T`). */
  realtime?: boolean;
  /** Don't (re)start the level — run from the current state. */
  noRestart?: boolean;
  seed?: number;
}

export interface BotFailure {
  x: number;
  y: number;
  reason: 'died' | 'stuck';
  attempts: number;
  frame: number;
}

export interface BotResult {
  levelId: string;
  character: CharacterId;
  completed: boolean;
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
}

interface Variant {
  run: boolean;
  /** px before a gap/hazard edge at which to jump. */
  gapLead: number;
  /** multiplier on the computed wall lead. */
  wallScale: number;
  /** multiplier on the enemy lead. */
  enemyScale: number;
  /** ms to hold jump. */
  holdMs: number;
}

const VARIANTS: Variant[] = [
  { run: true, gapLead: 6, wallScale: 1.2, enemyScale: 1, holdMs: 450 },
  { run: true, gapLead: 14, wallScale: 1.7, enemyScale: 1.5, holdMs: 600 },
  { run: true, gapLead: 2, wallScale: 0.8, enemyScale: 0.7, holdMs: 300 },
  { run: false, gapLead: 6, wallScale: 1.2, enemyScale: 1, holdMs: 600 },
  { run: true, gapLead: 20, wallScale: 2.4, enemyScale: 2.2, holdMs: 220 },
  { run: false, gapLead: 2, wallScale: 0.6, enemyScale: 0.6, holdMs: 450 },
  { run: true, gapLead: 10, wallScale: 1, enemyScale: 1.2, holdMs: 1000 },
  { run: false, gapLead: 12, wallScale: 2, enemyScale: 2, holdMs: 1000 },
];

type Threat = { kind: 'gap' | 'wall' | 'hazard' | 'enemy'; d: number; height?: number; closing?: number };

const T = 16;

export class PlatformBot {
  private jumpHold = 0;
  private jumpCooldown = 0;
  private safe: { x: number; y: number; frame: number }[] = [];
  private failures: BotFailure[] = [];
  private maxX = 0;
  private sinceProgress = 0;
  private deaths = 0;
  private rewinds = 0;
  private frames = 0;

  constructor(private h: TestHarness) {}

  async run(opts: BotOptions = {}): Promise<BotResult> {
    const h = this.h;
    const maxFrames = opts.maxFrames ?? 60 * 180;
    const maxAttempts = opts.maxAttemptsPerSection ?? 10;
    const stuckFrames = opts.stuckFrames ?? 240;
    if (!opts.noRestart || !h.level()) {
      await h.startLevel(opts.levelId ?? h.level()?.level.id ?? 'test', opts.character ?? h.level()?.player.def.id ?? 'dad', {
        manual: true,
        seed: opts.seed ?? 1,
      });
    } else {
      h.setManual(true);
    }
    h.setInvulnerable(!!opts.invulnerable);
    const lv = h.level()!;
    const levelId = lv.level.id;
    const character = lv.player.def.id;
    const goal = h.goal();
    const levelWidth = lv.ctx.map.widthInPixels;
    this.maxX = lv.player.x;
    let stuckAt: BotResult['stuckAt'];

    while (this.frames < maxFrames) {
      const cur = h.level();
      if (!cur) break;
      const st = h.getState();
      if (st.finished) break;
      const p = cur.player;

      if (p.mode === 'dead') {
        this.deaths++;
        const gaveUp = this.fail(p.x, p.y, 'died', maxAttempts);
        if (gaveUp) {
          stuckAt = { x: p.x, y: p.y, reason: 'died' };
          break;
        }
        continue;
      }

      if (p.x > this.maxX + 1) {
        this.maxX = p.x;
        this.sinceProgress = 0;
      } else if (++this.sinceProgress > stuckFrames) {
        const gaveUp = this.fail(p.x, p.y, 'stuck', maxAttempts);
        if (gaveUp) {
          stuckAt = { x: p.x, y: p.y, reason: 'stuck' };
          break;
        }
        continue;
      }

      if (p.grounded && this.onSafeGround()) {
        const lastSafe = this.safe[this.safe.length - 1];
        if (!lastSafe || Math.abs(lastSafe.x - p.x) >= 24) this.safe.push({ x: p.x, y: p.y, frame: this.frames });
      }

      h.setInput(this.decide());
      const n = await h.stepFrames(1);
      if (n === 0 && !h.level()?.player) break;
      this.frames++;
      if (opts.realtime) await new Promise<void>((r) => requestAnimationFrame(() => r()));
      else if (this.frames % 240 === 0) await new Promise<void>((r) => setTimeout(r, 0));
    }

    const end = h.getState();
    if (!end.finished && !stuckAt) stuckAt = { x: end.x, y: end.y, reason: this.frames >= maxFrames ? 'timeout' : 'level stopped' };
    h.setInput(null);
    const goalX = goal?.x ?? null;
    return {
      levelId,
      character,
      completed: end.finished,
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
      invulnerable: !!opts.invulnerable,
    };
  }

  /** Record a failure, rewind to an earlier safe spot. Returns true when giving up. */
  private fail(x: number, y: number, reason: 'died' | 'stuck', maxAttempts: number): boolean {
    let f = this.failures.find((ff) => Math.abs(ff.x - x) < 48);
    if (!f) {
      f = { x: Math.round(x), y: Math.round(y), reason, attempts: 0, frame: this.frames };
      this.failures.push(f);
    }
    f.attempts++;
    f.reason = reason;
    f.frame = this.frames;
    if (f.attempts > maxAttempts) return true;
    // Rewind further back on later attempts (longer run-up).
    const back = 48 + 32 * Math.min(4, f.attempts - 1);
    const candidates = this.safe.filter((s) => s.x < x - back);
    const spot = candidates[candidates.length - 1] ?? this.safe[0];
    this.rewinds++;
    this.jumpHold = 0;
    this.jumpCooldown = 6;
    this.sinceProgress = 0;
    this.maxX = spot ? spot.x : this.maxX;
    if (spot) this.h.revive(spot.x, spot.y - 1);
    else this.h.revive();
    return false;
  }

  /** The variant for the section the player is about to enter. */
  private variant(px: number): Variant {
    let attempts = 0;
    for (const f of this.failures) if (f.x >= px - 32 && f.x - px < 240) attempts = Math.max(attempts, f.attempts);
    return VARIANTS[attempts % VARIANTS.length];
  }

  private decide(): HarnessInput {
    const lv = this.h.level()!;
    const p = lv.player;
    const v = this.variant(p.x);
    let jump = false;
    if (this.jumpCooldown > 0) this.jumpCooldown--;
    if (this.jumpHold > 0) {
      this.jumpHold--;
      jump = true;
    } else if (p.grounded && this.jumpCooldown === 0) {
      const threat = this.scan(v);
      if (threat && threat.d <= this.lead(threat, v)) {
        jump = true;
        this.jumpHold = Math.max(1, Math.round(v.holdMs / (1000 / 60)));
        this.jumpCooldown = this.jumpHold + 4;
      }
    }
    return { right: true, run: v.run, jump };
  }

  private lead(t: Threat, v: Variant): number {
    const p = this.h.level()!.player;
    const speed = Math.max(40, Math.abs(p.body.velocity.x));
    switch (t.kind) {
      case 'gap':
      case 'hazard':
        return v.gapLead;
      case 'wall': {
        // Time to rise to the wall top (+margin) with the jump held: v0*t - g t²/2 = h.
        const v0 = p.stats.jumpVelocity * p.mods.jumpMult;
        const g = PHYSICS.gravity;
        const hgt = (t.height ?? T) + 6;
        const disc = v0 * v0 - 2 * g * hgt;
        const tRise = disc > 0 ? (v0 - Math.sqrt(disc)) / g : v0 / g;
        return Math.max(4, speed * tRise * v.wallScale);
      }
      case 'enemy':
        return Math.max(12, (t.closing ?? speed) * 0.22 * v.enemyScale);
    }
  }

  private solidAt(layer: Phaser.Tilemaps.TilemapLayer | undefined, x: number, y: number): boolean {
    if (!layer) return false;
    const t = layer.getTileAtWorldXY(x, y, true);
    return !!t && t.index > 0;
  }

  private onSafeGround(): boolean {
    const lv = this.h.level()!;
    const b = lv.player.body;
    const c = lv.ctx;
    const y = b.bottom + 4;
    for (const x of [b.left + 1, b.center.x, b.right - 1]) {
      if (this.solidAt(c.hazards, x, b.bottom - 4) || this.solidAt(c.water, x, y)) return false;
      if (!this.solidAt(c.ground, x, y) && !this.solidAt(c.oneway, x, y)) return false;
    }
    return true;
  }

  /** Nearest obstacle ahead (to the right) of the player. */
  private scan(v: Variant): Threat | null {
    const lv = this.h.level()!;
    const c = lv.ctx;
    const p = lv.player;
    const b = p.body;
    const feet = b.bottom;
    const look = Math.max(64, Math.abs(b.velocity.x) * 0.6) + v.gapLead;
    const mapH = c.map.heightInPixels;
    let best: Threat | null = null;

    for (let d = 0; d <= look; d += 2) {
      const x = b.right + d;
      if (x >= c.map.widthInPixels) break;
      // Wall: solid ground in the body's vertical span.
      let wall = false;
      for (let y = feet - 3; y > feet - b.height; y -= 6) if (this.solidAt(c.ground, x, y)) wall = true;
      if (wall) {
        let hgt = 0;
        while (hgt < T * 8 && this.solidAt(c.ground, x, feet - 2 - hgt)) hgt += T;
        best = { kind: 'wall', d, height: hgt };
        break;
      }
      // Hazard at foot level or just below.
      if (this.solidAt(c.hazards, x, feet - 4) || this.solidAt(c.hazards, x, feet + 4) || this.solidAt(c.water, x, feet + 4)) {
        best = { kind: 'hazard', d };
        break;
      }
      // Gap: no support under this column; small step-downs onto safe ground are fine.
      const supported = this.solidAt(c.ground, x, feet + 4) || this.solidAt(c.oneway, x, feet + 4);
      if (!supported) {
        let safeDrop = false;
        for (let y = feet + 4 + T; y < Math.min(mapH, feet + 4 + T * 3); y += T / 2) {
          if (this.solidAt(c.hazards, x, y - T) || this.solidAt(c.water, x, y)) break;
          if (this.solidAt(c.ground, x, y) || this.solidAt(c.oneway, x, y)) {
            safeDrop = true;
            break;
          }
        }
        if (!safeDrop) {
          best = { kind: 'gap', d };
          break;
        }
      }
    }

    // Enemies ahead at roughly our height.
    for (const go of c.groups.enemies.getChildren()) {
      const e = go as Enemy;
      if (!e.active || e.dead || !e.body) continue;
      const eb = e.body as Phaser.Physics.Arcade.Body;
      const d = eb.left - b.right;
      if (d < -4 || d > 160) continue;
      if (eb.top > feet + 2 || eb.bottom < feet - b.height - 24) continue;
      const closing = Math.max(0, b.velocity.x - eb.velocity.x);
      const t: Threat = { kind: 'enemy', d: Math.max(0, d), closing };
      if (!best || t.d < best.d) best = t;
    }
    return best;
  }
}
