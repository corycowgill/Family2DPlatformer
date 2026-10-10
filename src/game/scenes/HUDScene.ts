import Phaser from 'phaser';
import { GAME_WIDTH } from '../config';
import { EV } from '../types';
import { gameState } from '../state/GameState';
import { IMAGES } from '../data/assets';
import type { LevelScene } from './LevelScene';
import { text } from '../ui/Menus';
import { TouchControls } from '../ui/TouchControls';

/** Heads-up display, runs above LevelScene and listens to its events. */
export class HUDScene extends Phaser.Scene {
  private level!: LevelScene;
  constructor() {
    super('HUD');
  }

  init(data: { levelScene: LevelScene }): void {
    this.level = data.levelScene;
  }

  create(): void {
    const lv = this.level;
    const portraitKey = IMAGES.portrait(gameState.character);
    if (this.textures.exists(portraitKey)) this.add.image(6, 6, portraitKey).setOrigin(0);
    const hearts: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < lv.player.maxHealth; i++) hearts.push(this.add.image(36 + i * 12, 12, 'ui', 'heart_full').setOrigin(0, 0.5));
    const lives = text(this, 36, 24, '', 8).setOrigin(0, 0.5);
    this.add.image(GAME_WIDTH - 60, 12, 'ui', 'coin_icon');
    const coins = text(this, GAME_WIDTH - 50, 12, '0', 10).setOrigin(0, 0.5);
    text(this, GAME_WIDTH / 2, 10, `${lv.level.number} ${lv.level.name}`, 8, '#cfe3ff');

    const setHealth = (h: number) => hearts.forEach((img, i) => img.setFrame(i < h ? 'heart_full' : 'heart_empty'));
    const setLives = (n: number) => lives.setText(`x${n}`);
    setHealth(lv.player.health);
    setLives(gameState.lives);

    const ev = lv.events;
    const onHealth = (h: number) => setHealth(h);
    const onCoins = (n: number) => coins.setText(String(n));
    ev.on(EV.HEALTH_CHANGED, onHealth);
    ev.on(EV.COINS_CHANGED, onCoins);
    ev.on(EV.LIVES_CHANGED, setLives);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      ev.off(EV.HEALTH_CHANGED, onHealth);
      ev.off(EV.COINS_CHANGED, onCoins);
      ev.off(EV.LIVES_CHANGED, setLives);
    });

    new TouchControls(this);
  }
}
