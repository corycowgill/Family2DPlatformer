import Phaser from 'phaser';
import type { Player } from '../entities/Player';
import { cameraFocus, clampCenter, fitsInView, leaderIndex } from './Coop';

/**
 * Platformer camera: smooth follow, horizontal dead zone, look-ahead in the facing
 * direction, and "platform snapping" vertically (only re-centres vertically when the
 * player lands or moves far from the frame centre).
 *
 * Co-op: with more than one living player the camera frames their midpoint (look-ahead from
 * their average speed; vertical re-centring once everyone is grounded). Phaser's camera
 * bounds keep it inside the world / locked arena. Keeping players on one screen is the
 * CoopSystem's leash.
 */
export class CameraSystem {
  private lookAhead = 0;
  private targetY = 0;
  private locked: Phaser.Geom.Rectangle | null = null;

  constructor(
    private cam: Phaser.Cameras.Scene2D.Camera,
    private player: Player,
    private worldWidth: number,
    private worldHeight: number,
    /** All players (live array); defaults to just `player`. */
    private players: readonly Player[] = [player],
  ) {
    cam.setBounds(0, 0, worldWidth, worldHeight);
    cam.setRoundPixels(true);
    this.targetY = player.y;
    cam.centerOn(player.x, player.y - 40);
  }

  /** Restrict the camera to a rectangle (boss arenas). Pass null to release. */
  lock(rect: Phaser.Geom.Rectangle | null): void {
    this.locked = rect;
    if (rect) this.cam.setBounds(rect.x, rect.y, rect.width, rect.height);
    else this.cam.setBounds(0, 0, this.worldWidth, this.worldHeight);
  }

  get isLocked(): boolean {
    return this.locked !== null;
  }

  /** The bounds the camera is currently clamped to (world or locked arena). */
  get bounds(): { x: number; y: number; width: number; height: number } {
    return this.locked ?? { x: 0, y: 0, width: this.worldWidth, height: this.worldHeight };
  }

  /** Living players to frame (2+ only in co-op). */
  private living(): Player[] {
    if (this.players.length < 2) return [];
    return this.players.filter((p) => p.isAlive() && p.active);
  }

  snap(): void {
    const group = this.living();
    if (group.length > 1) {
      const f = cameraFocus(group.map((p) => ({ x: p.x, y: p.y, alive: true })))!;
      this.targetY = f.y;
      this.lookAhead = 0;
      this.cam.centerOn(f.x, f.y - 40);
      return;
    }
    const p = group[0] ?? this.player;
    this.targetY = p.y;
    this.lookAhead = 0;
    this.cam.centerOn(p.x, p.y - 40);
  }

  update(dtMs: number): void {
    const group = this.living();
    if (group.length > 1) return this.updateGroup(group, dtMs);
    // Single player (or one co-op player left standing): the original follow.
    this.follow(group[0] ?? this.player, dtMs);
  }

  private follow(p: Player, dtMs: number): void {
    const vx = p.body?.velocity.x ?? 0;
    // Vertical: follow when grounded, or when the player leaves a comfortable band.
    if (p.grounded || p.y > this.targetY + 40 || p.y < this.targetY - 80) {
      this.targetY = p.y;
    }
    this.move(p.x, p.y, vx, dtMs);
  }

  private updateGroup(group: Player[], dtMs: number): void {
    // Too far apart for one screen: follow the leader; the CoopSystem leash warps the other.
    if (group.length === 2 && !fitsInView(group[0], group[1], this.cam.width, this.cam.height, 16)) {
      const lead = group[leaderIndex(group.map((p) => ({ x: p.x, y: p.y, alive: true })))];
      return this.follow(lead, dtMs);
    }
    const f = cameraFocus(group.map((p) => ({ x: p.x, y: p.y, alive: true })))!;
    const vx = group.reduce((s, p) => s + (p.body?.velocity.x ?? 0), 0) / group.length;
    if (group.every((p) => p.grounded) || f.y > this.targetY + 40 || f.y < this.targetY - 80) {
      this.targetY = f.y;
    }
    // Aim at a centre the camera can actually reach, so easing never pushes against the bounds.
    const c = clampCenter(f.x, f.y, this.cam.width, this.cam.height, this.bounds);
    this.move(c.x, f.y, vx, dtMs);
  }

  /** Ease toward (x, targetY) with look-ahead from `vx`; `y` only decides the fall catch-up. */
  private move(x: number, y: number, vx: number, dtMs: number): void {
    const cam = this.cam;
    const dt = Math.min(dtMs, 50) / 1000;
    // Look ahead in the movement direction, proportional to speed.
    const desiredLook = Phaser.Math.Clamp(vx * 0.35, -48, 48);
    this.lookAhead += (desiredLook - this.lookAhead) * Math.min(1, dt * 2.5);

    const desiredX = x + this.lookAhead;
    const desiredY = this.targetY - 30;
    const curX = cam.scrollX + cam.width / 2;
    const curY = cam.scrollY + cam.height / 2;
    // Horizontal dead zone of 16px around the centre.
    let nx = curX;
    const dz = 12;
    if (desiredX > curX + dz) nx = curX + (desiredX - dz - curX) * Math.min(1, dt * 8);
    else if (desiredX < curX - dz) nx = curX + (desiredX + dz - curX) * Math.min(1, dt * 8);
    const followY = y > curY + 60 ? 12 : 5; // catch up faster when falling
    const ny = curY + (desiredY - curY) * Math.min(1, dt * followY);
    cam.centerOn(nx, ny);
  }
}
