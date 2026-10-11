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
import { prompt } from '../ui/Prompts';
import type { MenuItem } from '../ui/Menus';

interface LevelLike {
  inputSys?: { resetEdges(): void };
  canSkipBoss?(): boolean;
  skipBoss?(): void;
}

/** In-level pause overlay. (Main-menu settings live in SettingsScene.) */
export class PauseScene extends Phaser.Scene {
  private levelId = '';
  private closing = false;
  /** Opened as the assist "skip the boss?" prompt instead of the plain pause menu. */
  private offerSkip = false;
  constructor() {
    super('Pause');
  }

  init(data: { fromMenu?: boolean; levelId?: string; offerSkip?: boolean }): void {
    this.levelId = data.levelId ?? '';
    this.closing = false;
    this.offerSkip = !!data.offerSkip;
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
    const lv = this.level();
    if (this.offerSkip) {
      // Assist: small "skip the boss?" prompt after the 3rd boss defeat.
      panel(this, cx - 110, 70, 220, 112);
      px(this, cx, 88, 'TOUGH BOSS?', { scale: 2, color: COLORS.gold });
      px(this, cx, 108, 'ASSIST: YOU CAN SKIP THIS FIGHT', { color: COLORS.sub });
      createMenu(
        this,
        [
          { label: 'KEEP TRYING', onSelect: () => this.resume(), sound: null },
          { label: 'SKIP BOSS', onSelect: () => this.skipBoss() },
        ],
        cx,
        134,
        20,
        { width: 160, scale: 1, onBack: () => this.resume(), onStart: () => this.resume() },
      );
      prompt(this, cx, 196, (d) => (d === 'touch' ? '' : '{NAV} SELECT  {CONFIRM} OK'), { color: COLORS.sub });
      return;
    }
    const items: MenuItem[] = [
      { label: 'RESUME', onSelect: () => this.resume(), sound: null },
      { label: 'RESTART LEVEL', onSelect: () => this.restartLevel() },
      { label: 'SETTINGS', onSelect: () => this.openSettings() },
      { label: 'QUIT TO MAP', onSelect: () => this.quit(), sound: 'menu-back' },
    ];
    if (lv?.canSkipBoss?.()) items.splice(1, 0, { label: 'SKIP BOSS', onSelect: () => this.skipBoss() });
    const extra = items.length > 4 ? 20 : 0;
    panel(this, cx - 100, 44, 200, 168 + extra);
    px(this, cx, 62, 'PAUSED', { scale: 2, color: COLORS.gold });
    const lvl = getLevel(this.levelId);
    if (lvl) px(this, cx, 80, `${lvl.number} ${lvl.name.toUpperCase()}`, { color: COLORS.sub });
    const def = CHARACTERS[gameState.character];
    px(this, cx, 200 + extra, `${def.name.toUpperCase()} · LIVES x${gameState.lives}`, { color: COLORS.dim });
    createMenu(this, items, cx, 106, 20, { width: 160, scale: 1, onBack: () => this.resume(), onStart: () => this.resume() });
    prompt(this, cx, 226 + extra, (d) => (d === 'touch' ? '' : '{NAV} SELECT  {CONFIRM} OK  {BACK} RESUME'), { color: COLORS.sub });
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
    this.level()?.inputSys?.resetEdges();
  }

  private level(): LevelLike | undefined {
    return this.scene.get('Level') as unknown as LevelLike | undefined;
  }

  /** Assist: skip the boss (the level completes; Results shows the ASSIST tag). */
  private skipBoss(): void {
    if (this.closing) return;
    this.resume();
    this.level()?.skipBoss?.();
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
