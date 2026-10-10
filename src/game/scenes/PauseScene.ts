import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { createMenu } from '../ui/Menus';
import { audio } from '../systems/AudioSystem';
import { gameState } from '../state/GameState';
import { getLevel } from '../data/levels';
import { px } from '../ui/PixelFont';
import { COLORS, panel } from '../ui/Widgets';
import { transitionTo } from '../ui/Transitions';
import { clearVirtualButtons } from '../systems/InputSystem';
import { CHARACTERS } from '../characters';

/** In-level pause overlay. (Main-menu settings live in SettingsScene.) */
export class PauseScene extends Phaser.Scene {
  private levelId = '';
  private closing = false;
  constructor() {
    super('Pause');
  }

  init(data: { fromMenu?: boolean; levelId?: string }): void {
    this.levelId = data.levelId ?? '';
    this.closing = false;
    // Legacy entry point: settings from the menu.
    if (data.fromMenu) this.scene.start('Settings', { from: 'Menu' });
  }

  create(): void {
    if (!this.levelId) return;
    clearVirtualButtons();
    audio.sfx('pause');
    audio.duck(true);
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0).setOrigin(0);
    this.tweens.add({ targets: dim, fillAlpha: 0.7, duration: 150 });
    const cx = GAME_WIDTH / 2;
    panel(this, cx - 100, 44, 200, 168);
    px(this, cx, 62, 'PAUSED', { scale: 2, color: COLORS.gold });
    const lvl = getLevel(this.levelId);
    if (lvl) px(this, cx, 80, `${lvl.number} ${lvl.name.toUpperCase()}`, { color: COLORS.sub });
    const def = CHARACTERS[gameState.character];
    px(this, cx, 200, `${def.name.toUpperCase()} · LIVES x${gameState.lives}`, { color: COLORS.dim });
    createMenu(
      this,
      [
        { label: 'RESUME', onSelect: () => this.resume(), sound: null },
        { label: 'RESTART LEVEL', onSelect: () => this.restartLevel() },
        { label: 'SETTINGS', onSelect: () => this.openSettings() },
        { label: 'QUIT TO MAP', onSelect: () => this.quit(), sound: 'menu-back' },
      ],
      cx,
      106,
      20,
      { width: 160, scale: 1, onBack: () => this.resume() },
    );
    this.input.keyboard?.on('keydown-P', (e: KeyboardEvent) => !e.repeat && this.resume());
  }

  private openSettings(): void {
    this.scene.launch('Settings', { from: 'Pause' });
    this.scene.bringToTop('Settings');
    this.scene.pause();
  }

  private resume(): void {
    if (this.closing) return;
    this.closing = true;
    audio.duck(false);
    audio.sfx('menu-select');
    clearVirtualButtons();
    this.scene.stop();
    this.scene.resume('Level');
    const lv = this.scene.get('Level') as unknown as { inputSys?: { resetEdges(): void } };
    lv.inputSys?.resetEdges();
  }

  private restartLevel(): void {
    if (this.closing) return;
    this.closing = true;
    audio.duck(false);
    gameState.resetCheckpoint();
    this.scene.stop('HUD');
    this.scene.stop();
    this.scene.get('Level').scene.restart({ levelId: this.levelId });
  }

  private quit(): void {
    if (this.closing) return;
    this.closing = true;
    gameState.resetCheckpoint();
    audio.duck(false);
    audio.stopMusic();
    transitionTo(this, 'WorldMap', undefined, { stop: ['HUD', 'Level'] });
  }
}
