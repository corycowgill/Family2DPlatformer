import Phaser from 'phaser';
import type { Player } from '../entities/Player';

/**
 * Platformer camera: smooth follow, horizontal dead zone, look-ahead in the facing
 * direction, and "platform snapping" vertically (only re-centres vertically when the
 * player lands or moves far from the frame centre).
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

  snap(): void {
    this.targetY = this.player.y;
    this.lookAhead = 0;
    this.cam.centerOn(this.player.x, this.player.y - 40);
  }

  update(dtMs: number): void {
    const cam = this.cam;
    const p = this.player;
    const dt = Math.min(dtMs, 50) / 1000;
    const vx = p.body?.velocity.x ?? 0;
    // Look ahead in the movement direction, proportional to speed.
    const desiredLook = Phaser.Math.Clamp(vx * 0.35, -48, 48);
    this.lookAhead += (desiredLook - this.lookAhead) * Math.min(1, dt * 2.5);

    // Vertical: follow when grounded, or when the player leaves a comfortable band.
    if (p.grounded || p.y > this.targetY + 40 || p.y < this.targetY - 80) {
      this.targetY = p.y;
    }

    const desiredX = p.x + this.lookAhead;
    const desiredY = this.targetY - 30;
    const curX = cam.scrollX + cam.width / 2;
    const curY = cam.scrollY + cam.height / 2;
    // Horizontal dead zone of 16px around the centre.
    let nx = curX;
    const dz = 12;
    if (desiredX > curX + dz) nx = curX + (desiredX - dz - curX) * Math.min(1, dt * 8);
    else if (desiredX < curX - dz) nx = curX + (desiredX + dz - curX) * Math.min(1, dt * 8);
    const followY = p.y > curY + 60 ? 12 : 5; // catch up faster when falling
    const ny = curY + (desiredY - curY) * Math.min(1, dt * followY);
    cam.centerOn(nx, ny);
  }
}
