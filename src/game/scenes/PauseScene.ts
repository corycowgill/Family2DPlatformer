import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { createMenu, text, type MenuItem } from '../ui/Menus';
import { saveSystem } from '../systems/SaveSystem';
import { audio } from '../systems/AudioSystem';
import { gameState } from '../state/GameState';

/** Pause menu (in-level) and settings screen (from main menu). */
export class PauseScene extends Phaser.Scene {
  private fromMenu = false;
  private levelId = '';
  constructor() {
    super('Pause');
  }

  init(data: { fromMenu?: boolean; levelId?: string }): void {
    this.fromMenu = !!data.fromMenu;
    this.levelId = data.levelId ?? '';
  }

  create(): void {
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x0b1730, this.fromMenu ? 1 : 0.75).setOrigin(0);
    text(this, GAME_WIDTH / 2, 40, this.fromMenu ? 'SETTINGS' : 'PAUSED', 18, '#ffd25a');
    this.buildMenu();
  }

  private buildMenu(): void {
    const s = saveSystem.get().settings;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const cycle = (v: number) => (v >= 1 ? 0 : Math.round((v + 0.2) * 10) / 10);
    const rebuild = () => this.scene.restart({ fromMenu: this.fromMenu, levelId: this.levelId });
    const set = (fn: () => void) => () => {
      saveSystem.update(fn);
      audio.applySettings();
      rebuild();
    };
    const items: MenuItem[] = [];
    if (!this.fromMenu) {
      items.push({ label: 'Resume', onSelect: () => this.resume() });
      items.push({ label: 'Restart Level', onSelect: () => this.restartLevel() });
    }
    items.push(
      { label: `Music: ${pct(s.musicVolume)}`, onSelect: set(() => (s.musicVolume = cycle(s.musicVolume))) },
      { label: `Sound FX: ${pct(s.sfxVolume)}`, onSelect: set(() => (s.sfxVolume = cycle(s.sfxVolume))) },
      { label: `Mute: ${s.muted ? 'On' : 'Off'}`, onSelect: set(() => (s.muted = !s.muted)) },
      { label: `Reduced Motion: ${s.reducedMotion ? 'On' : 'Off'}`, onSelect: set(() => (s.reducedMotion = !s.reducedMotion)) },
      { label: `Touch Controls: ${s.showTouchControls}`, onSelect: set(() => (s.showTouchControls = s.showTouchControls === 'auto' ? 'on' : s.showTouchControls === 'on' ? 'off' : 'auto')) },
    );
    items.push(this.fromMenu ? { label: 'Back', onSelect: () => this.scene.start('Menu') } : { label: 'Quit to Map', onSelect: () => this.quit() });
    createMenu(this, items, GAME_WIDTH / 2, 72, 18);
    this.input.keyboard?.once('keydown-ESC', () => (this.fromMenu ? this.scene.start('Menu') : this.resume()));
  }

  private resume(): void {
    this.scene.stop();
    this.scene.resume('Level');
    const lv = this.scene.get('Level') as unknown as { inputSys?: { resetEdges(): void } };
    lv.inputSys?.resetEdges();
  }

  private restartLevel(): void {
    gameState.resetCheckpoint();
    this.scene.stop('HUD');
    this.scene.stop();
    this.scene.get('Level').scene.restart({ levelId: this.levelId });
  }

  private quit(): void {
    gameState.resetCheckpoint();
    audio.stopMusic();
    this.scene.stop('HUD');
    this.scene.stop('Level');
    this.scene.start('WorldMap');
  }
}
