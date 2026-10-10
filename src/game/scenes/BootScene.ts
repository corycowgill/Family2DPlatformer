import Phaser from 'phaser';
import { ensurePixelFonts } from '../ui/PixelFont';
import { ensureIcons } from '../ui/Icons';
import { installRotateOverlay } from '../ui/RotateOverlay';
import { installGamepads } from '../ui/PadOverlay';

/** Minimal boot: generates the pixel fonts/icons the preloader needs, then hands over. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }
  create(): void {
    ensurePixelFonts(this);
    ensureIcons(this);
    installRotateOverlay(this.game);
    installGamepads(this.game);
    this.scene.start('Preload');
  }
}
