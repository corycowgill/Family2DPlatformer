import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { createMenu, text } from '../ui/Menus';
import { saveSystem } from '../systems/SaveSystem';
import { audio } from '../systems/AudioSystem';
import { IMAGES } from '../data/assets';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    for (const layer of ['sky', 'far', 'mid', 'near'] as const) {
      const k = IMAGES.bg('day', layer);
      if (this.textures.exists(k)) this.add.image(0, 0, k).setOrigin(0);
    }
    text(this, GAME_WIDTH / 2, 50, 'CHICAGO FAMILY', 24, '#ffffff');
    text(this, GAME_WIDTH / 2, 76, 'ADVENTURE', 24, '#e8414e');
    const hasSave = saveSystem.hasProgress();
    createMenu(
      this,
      [
        { label: 'Play', onSelect: () => this.scene.start('CharacterSelect', { next: 'WorldMap' }) },
        { label: 'Continue', disabled: !hasSave, onSelect: () => this.scene.start('WorldMap') },
        { label: 'Character Select', onSelect: () => this.scene.start('CharacterSelect', { next: 'Menu' }) },
        { label: 'Settings', onSelect: () => this.scene.start('Pause', { fromMenu: true }) },
      ],
      GAME_WIDTH / 2,
      140,
    );
    text(this, GAME_WIDTH / 2, GAME_HEIGHT - 10, 'Arrows/WASD move · Space jump · Shift run · J ability', 8, '#cfe3ff');
    audio.music('title');
  }
}
