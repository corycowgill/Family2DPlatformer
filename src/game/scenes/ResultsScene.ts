import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { createMenu, text } from '../ui/Menus';
import type { LevelRunStats } from './LevelScene';
import { getLevel } from '../data/levels';

export function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 10)).padStart(2, '0')}`;
}

export class ResultsScene extends Phaser.Scene {
  constructor() {
    super('Results');
  }

  create(data: { gameOver: boolean; stats: LevelRunStats; worldComplete?: boolean }): void {
    this.cameras.main.setBackgroundColor('#13254a');
    const lvl = getLevel(data.stats.levelId);
    if (data.gameOver) {
      text(this, GAME_WIDTH / 2, 70, 'GAME OVER', 24, '#e8414e');
      createMenu(this, [
        { label: 'Try Again', onSelect: () => this.scene.start('Level', { levelId: data.stats.levelId }) },
        { label: 'World Map', onSelect: () => this.scene.start('WorldMap') },
      ], GAME_WIDTH / 2, 140);
      return;
    }
    text(this, GAME_WIDTH / 2, 36, data.worldComplete ? 'THE LOOP IS SAVED!' : 'LEVEL CLEAR!', 20, '#ffd25a');
    text(this, GAME_WIDTH / 2, 64, `${lvl?.number ?? ''} ${lvl?.name ?? ''}`, 10);
    text(this, GAME_WIDTH / 2, 92, `Time ${formatTime(data.stats.timeMs)}`, 10);
    text(this, GAME_WIDTH / 2, 108, `Coins ${data.stats.coins}   Souvenirs ${data.stats.souvenirs.length}/3`, 10);
    const items = [];
    if (lvl?.next) items.push({ label: 'Next Level', onSelect: () => this.scene.start('Level', { levelId: lvl.next }) });
    items.push({ label: 'World Map', onSelect: () => this.scene.start('WorldMap') });
    createMenu(this, items, GAME_WIDTH / 2, GAME_HEIGHT - 70);
  }
}
