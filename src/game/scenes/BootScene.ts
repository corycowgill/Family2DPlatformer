import Phaser from 'phaser';

/** Minimal boot: nothing to load before the preloader (its bar is drawn with graphics). */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }
  create(): void {
    this.scene.start('Preload');
  }
}
