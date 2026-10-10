import Phaser from 'phaser';
import { DEPTH, TILE_SIZE } from '../config';
import type { HitInfo } from '../types';
import { Enemy } from '../entities/Enemy';
import { EnemyProjectile } from '../entities/Projectile';
import type { LevelContext, SpawnObject } from '../world/LevelContext';
import { playAnim } from '../systems/AnimationSystem';
import { ENEMY_FRAME_SIZE } from './enemyArt';
import { hoverOffset, propNum, telegraphBlink } from './ai';
import { Gnat } from './Gnat';
import { ring } from './fx';

/**
 * Overseer (reserved for later worlds): hovering command pod, 6 hp.
 * - Drifts toward the player's x (within `range` of its home).
 * - Summon: every ~5 s, if fewer than 3 of its gnats are alive, blinks (0.5 s) and spawns one.
 * - Beam: stops, draws a blinking target line straight down for 0.8 s, then fires a
 *   vertical beam for 0.6 s → 1 s recovery. Step out of the line to dodge.
 * Stompable (it hovers fairly high — use platforms or abilities).
 */
export class Overseer extends Enemy {
  private readonly range: number;
  private t = 0;
  private nextSummonAt: number;
  private nextBeamAt: number;
  private readonly gnats: Gnat[] = [];
  private readonly line: Phaser.GameObjects.Graphics;
  private beam?: EnemyProjectile;
  private beamBottom = 0;

  constructor(ctx: LevelContext, spawn: SpawnObject) {
    super(ctx, spawn, { kind: 'overseer', hp: 6, contactDamage: 1, stompable: true, body: { width: 44, height: 36 }, bodyLift: 40, gravity: false, frameSize: ENEMY_FRAME_SIZE.overseer });
    this.range = propNum(spawn.props, 'range', 120);
    this.nextSummonAt = ctx.now() + 2000;
    this.nextBeamAt = ctx.now() + 3500;
    this.cullMargin = 260;
    this.line = ctx.scene.add.graphics().setDepth(DEPTH.projectiles);
    this.setAI('hover');
  }

  protected onHurt(_hit: HitInfo): void {
    playAnim(this, 'hit', 'idle', false);
    this.flash(90);
  }

  /** Floor y below a point (first solid tile), or map bottom. */
  private floorBelow(x: number, y: number): number {
    const map = this.ctx.map;
    for (let yy = y; yy < map.heightInPixels; yy += TILE_SIZE / 2) {
      const t = this.ctx.ground.getTileAtWorldXY(x, yy);
      if (t && t.index > 0) return t.getTop();
    }
    return map.heightInPixels;
  }

  protected think(dt: number): void {
    this.t += dt;
    const b = this.body;
    const now = this.ctx.now();
    const p = this.player;
    this.line.clear();
    for (let i = this.gnats.length - 1; i >= 0; i--) if (!this.gnats[i].active || this.gnats[i].dead) this.gnats.splice(i, 1);
    const ty = this.homeY + hoverOffset(this.t, 6, 1500);
    switch (this.aiState) {
      case 'hover': {
        playAnim(this, 'move', 'idle');
        const tx = Phaser.Math.Clamp(p.x, this.homeX - this.range, this.homeX + this.range);
        b.setVelocity(Phaser.Math.Clamp((tx - this.x) * 2, -45, 45), (ty - this.y) * 4);
        this.facePlayer();
        const near = this.playerAlive() && this.distanceToPlayer() < 260;
        if (near && now >= this.nextSummonAt && this.gnats.length < 3) {
          this.telegraph(500, 0x7be0d8);
          this.setAI('summon');
        } else if (near && now >= this.nextBeamAt && Math.abs(p.x - this.x) < 40) {
          this.telegraph(800, 0xff3030, true);
          this.beamBottom = this.floorBelow(this.x, this.body.bottom + 2);
          this.setAI('beamCharge');
        }
        break;
      }
      case 'summon':
        b.setVelocity(0, (ty - this.y) * 4);
        if (this.stateTime >= 500) {
          const gx = this.x + (Math.random() < 0.5 ? -24 : 24);
          const gy = this.body.bottom + 8;
          ring(this.ctx, gx, gy - 4);
          const g = new Gnat(this.ctx, { id: -1, type: 'enemy', name: 'summoned', x: gx, y: gy, width: 16, height: 16, props: { kind: 'gnat', range: 40 } });
          this.gnats.push(g);
          this.nextSummonAt = now + 5000;
          this.setAI('hover');
        }
        break;
      case 'beamCharge': {
        b.setVelocity(0, 0);
        playAnim(this, 'attack', 'idle');
        const on = telegraphBlink(this.stateTime, 800);
        this.line.lineStyle(2, 0xff3030, on ? 0.9 : 0.3).lineBetween(this.x, this.body.bottom, this.x, this.beamBottom);
        if (this.stateTime >= 800) {
          const top = this.body.bottom;
          const h = Math.max(8, this.beamBottom - top);
          this.beam = new EnemyProjectile(this.ctx, this.x, top + h / 2, { style: 'beam', persistent: true, ignoreTerrain: true, lifetimeMs: 600, body: { width: 8, height: 8 } });
          this.beam.setDisplaySize(12, h);
          this.ctx.sfx('beam');
          this.ctx.shake(0.003, 600);
          this.setAI('beam');
        }
        break;
      }
      case 'beam':
        b.setVelocity(0, 0);
        if (this.stateTime >= 600) {
          this.beam = undefined;
          this.nextBeamAt = now + 3500;
          this.setAI('recover');
        }
        break;
      case 'recover':
        b.setVelocity(0, (ty + 10 - this.y) * 3);
        playAnim(this, 'idle');
        if (this.stateTime >= 1000) this.setAI('hover');
        break;
      default:
        this.setAI('hover');
    }
  }

  die(hit?: HitInfo): void {
    this.line.clear();
    this.beam?.destroy();
    super.die(hit);
  }

  destroy(fromScene?: boolean): void {
    this.line?.destroy();
    super.destroy(fromScene);
  }
}
