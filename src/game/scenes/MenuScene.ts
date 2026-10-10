import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { createMenu } from '../ui/Menus';
import { saveSystem } from '../systems/SaveSystem';
import { audio } from '../systems/AudioSystem';
import { IMAGES } from '../data/assets';
import { px } from '../ui/PixelFont';
import { Skyline } from '../ui/Skyline';
import { isRealAsset } from '../ui/Icons';
import { reducedMotion, transitionIn, transitionTo } from '../ui/Transitions';
import { COLORS } from '../ui/Widgets';
import { shouldShowTouch } from '../ui/TouchControls';

/** Draw a six-pointed Chicago-flag star centred at (cx, cy). */
export function drawChicagoStar(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, color: number = COLORS.red): void {
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < 12; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 6;
    const rr = i % 2 === 0 ? r : r * 0.5;
    pts.push(new Phaser.Math.Vector2(Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr)));
  }
  g.fillStyle(COLORS.ink, 1);
  g.fillPoints(pts.map((p) => new Phaser.Math.Vector2(p.x, p.y + 1)), true);
  g.fillStyle(color, 1);
  g.fillPoints(pts, true);
}

export class MenuScene extends Phaser.Scene {
  private sky!: Skyline;

  constructor() {
    super('Menu');
  }

  create(): void {
    this.sky = new Skyline(this);
    this.buildLogo();

    const hasSave = saveSystem.hasProgress();
    createMenu(
      this,
      [
        { label: 'PLAY', onSelect: () => transitionTo(this, 'CharacterSelect', { next: 'WorldMap' }) },
        { label: 'CONTINUE', disabled: !hasSave, onSelect: () => transitionTo(this, 'WorldMap') },
        { label: 'CHARACTER SELECT', onSelect: () => transitionTo(this, 'CharacterSelect', { next: 'Menu' }) },
        { label: 'SETTINGS', onSelect: () => transitionTo(this, 'Settings', { from: 'Menu' }) },
        { label: 'CREDITS', onSelect: () => transitionTo(this, 'Credits') },
      ],
      GAME_WIDTH / 2,
      134,
      17,
      { width: 172, panel: true, startIndex: hasSave ? 1 : 0, depth: 20 },
    );
    const hint = shouldShowTouch()
      ? 'TAP TO CHOOSE'
      : 'ARROWS/WASD MOVE · SPACE JUMP · SHIFT RUN · J ABILITY';
    px(this, GAME_WIDTH / 2, GAME_HEIGHT - 8, hint, { color: COLORS.sub }).setDepth(20);
    px(this, GAME_WIDTH - 4, 4, 'v0.1', { origin: [1, 0], color: COLORS.dim, outline: false }).setDepth(20);
    audio.music('title');
    transitionIn(this);
  }

  private buildLogo(): void {
    const cx = GAME_WIDTH / 2;
    const c = this.add.container(cx, 0).setDepth(15);
    if (isRealAsset(this, IMAGES.logo)) {
      const img = this.add.image(0, 56, IMAGES.logo);
      const s = Math.min(1, 300 / img.width, 96 / img.height);
      img.setScale(s >= 1 ? Math.floor(s) || 1 : s);
      c.add(img);
    } else {
      // Chicago flag motif: two light-blue stripes and red six-pointed stars.
      const g = this.add.graphics();
      g.fillStyle(COLORS.ink, 0.55).fillRect(-150, 20, 300, 76);
      g.fillStyle(COLORS.skyBlue, 1).fillRect(-150, 22, 300, 3).fillRect(-150, 91, 300, 3);
      for (const [x, s] of [[-128, 9], [128, 9]] as const) drawChicagoStar(g, x, 50, s);
      c.add(g);
      c.add(px(this, 0, 46, 'CHICAGO', { scale: 4, color: 0xffffff }));
      c.add(px(this, 0, 76, 'FAMILY ADVENTURE', { scale: 2, color: COLORS.red }));
      const stars = this.add.graphics();
      drawChicagoStar(stars, -128, 76, 5);
      drawChicagoStar(stars, 128, 76, 5);
      c.add(stars);
    }
    if (!reducedMotion()) this.tweens.add({ targets: c, y: 3, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
  }

  update(_t: number, delta: number): void {
    this.sky.update(delta);
  }
}
