import Phaser from 'phaser';
import { GAME_WIDTH } from '../config';
import { LEVELS } from '../data/levels';
import { saveSystem } from '../systems/SaveSystem';
import { gameState } from '../state/GameState';
import { createMenu, text } from '../ui/Menus';

export class WorldMapScene extends Phaser.Scene {
  constructor() {
    super('WorldMap');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#1a3a5e');
    text(this, GAME_WIDTH / 2, 20, 'WORLD 1 · THE LOOP', 16, '#ffd25a');
    const save = saveSystem.get();
    createMenu(
      this,
      [
        ...LEVELS.map((l) => ({
          label: `${l.number} ${l.name}${save.levels[l.id]?.completed ? ' ✓' : ''}`,
          disabled: !saveSystem.isUnlocked(l.id),
          onSelect: () => {
            gameState.resetLives();
            this.scene.start('Level', { levelId: l.id });
          },
        })),
        { label: 'Back', onSelect: () => this.scene.start('Menu') },
      ],
      GAME_WIDTH / 2,
      80,
      22,
    );
  }
}
