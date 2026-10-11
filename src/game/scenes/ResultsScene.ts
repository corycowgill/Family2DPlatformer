import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { createMenu, type MenuItem } from '../ui/Menus';
import type { LevelRunStats } from './LevelScene';
import { getLevel } from '../data/levels';
import { saveSystem } from '../systems/SaveSystem';
import { audio } from '../systems/AudioSystem';
import { gameState } from '../state/GameState';
import { playAnim } from '../systems/AnimationSystem';
import { px, setPx } from '../ui/PixelFont';
import { icon, setIcon } from '../ui/Icons';
import { Skyline } from '../ui/Skyline';
import { COLORS, panel } from '../ui/Widgets';
import { reducedMotion, transitionIn, transitionTo } from '../ui/Transitions';
import { formatTime as fmt } from '../ui/format';

/** @deprecated import from ui/format */
export const formatTime = fmt;

export interface ResultsData {
  gameOver: boolean;
  stats: LevelRunStats;
  worldComplete?: boolean;
}

/** Level clear / world complete / game over screen. */
export class ResultsScene extends Phaser.Scene {
  private sky?: Skyline;
  constructor() {
    super('Results');
  }

  create(data: ResultsData): void {
    this.sky = undefined;
    if (data.gameOver) this.gameOver(data);
    else this.cleared(data);
    transitionIn(this);
  }

  private hero(x: number, y: number, anim: string): Phaser.GameObjects.Sprite {
    const s = this.add.sprite(x, y, gameState.character).setOrigin(0.5, 1).setScale(2);
    playAnim(s, anim, 'idle', false);
    return s;
  }

  private gameOver(data: ResultsData): void {
    const g = this.add.graphics();
    g.fillGradientStyle(0x2a0b1c, 0x2a0b1c, COLORS.ink, COLORS.ink, 1).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    const title = px(this, GAME_WIDTH / 2, 50, 'GAME OVER', { scale: 3, color: COLORS.red });
    if (!reducedMotion()) {
      title.setScale(0.1);
      this.tweens.add({ targets: title, scale: 1, duration: 500, ease: 'Back.out' });
    }
    const lvl = getLevel(data.stats.levelId);
    px(this, GAME_WIDTH / 2, 76, lvl ? `${lvl.number} ${lvl.name.toUpperCase()}` : '', { color: COLORS.sub });
    this.add.ellipse(GAME_WIDTH / 2, 160, 60, 8, 0x000000, 0.4);
    this.hero(GAME_WIDTH / 2, 160, 'defeat');
    px(this, GAME_WIDTH / 2, 176, "DON'T GIVE UP - CHICAGO NEEDS YOU!", { color: COLORS.sub });
    audio.stopMusic();
    audio.music('gameover');
    createMenu(this, [
      { label: 'TRY AGAIN', onSelect: () => { gameState.resetLives(); transitionTo(this, 'Level', { levelId: data.stats.levelId }); } },
      { label: 'WORLD MAP', onSelect: () => transitionTo(this, 'WorldMap'), sound: 'menu-back' },
    ], GAME_WIDTH / 2, 206, 20, { width: 140, panel: true });
  }

  private cleared(data: ResultsData): void {
    const { stats } = data;
    this.sky = new Skyline(this, { train: !!data.worldComplete });
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.45).setOrigin(0);
    const lvl = getLevel(stats.levelId);
    const world = !!data.worldComplete && (lvl?.world ?? 0) > 0;
    const title = px(this, GAME_WIDTH / 2, 22, world ? `WORLD ${lvl?.world ?? 1} CLEAR!` : 'LEVEL CLEAR!', { scale: world ? 2 : 3, color: COLORS.gold });
    if (!reducedMotion()) {
      const s = title.scale;
      title.setScale(0.1);
      this.tweens.add({ targets: title, scale: s, duration: 450, ease: 'Back.out' });
    }
    px(this, GAME_WIDTH / 2, world ? 40 : 44, lvl ? `${lvl.number} ${lvl.name.toUpperCase()}` : '', { color: COLORS.sub });

    // Stats panel
    const top = 56;
    panel(this, 40, top, 400, world ? 98 : 104);
    this.add.ellipse(92, top + 88, 50, 7, 0x000000, 0.4);
    this.hero(92, top + 90, 'victory');

    const rec = saveSystem.get().levels[stats.levelId];
    const newBest = !!rec && rec.bestTimeMs === stats.timeMs;
    const rowX = 150;
    const valX = 300;
    const row = (i: number, label: string) => px(this, rowX, top + 16 + i * 18, label, { origin: [0, 0.5], color: COLORS.sub });
    row(0, 'TIME');
    row(1, 'COINS');
    row(2, 'SOUVENIRS');
    row(3, 'ENEMIES');
    const timeT = px(this, valX, top + 16, fmt(stats.timeMs), { origin: [0, 0.5] });
    if (newBest) {
      const nb = px(this, valX + timeT.width + 8, top + 16, 'NEW BEST!', { origin: [0, 0.5], color: COLORS.red });
      if (!reducedMotion()) this.tweens.add({ targets: nb, alpha: 0.3, duration: 300, yoyo: true, repeat: -1 });
    } else if (rec?.bestTimeMs) {
      px(this, valX + timeT.width + 8, top + 16, `BEST ${fmt(rec.bestTimeMs)}`, { origin: [0, 0.5], color: COLORS.dim });
    }
    icon(this, valX + 4, top + 34, 'coin_icon');
    const coinT = px(this, valX + 14, top + 34, '0', { origin: [0, 0.5] });
    const souv = [0, 1, 2].map((i) => icon(this, valX + 6 + i * 16, top + 52, 'souvenir_icon_empty'));
    px(this, valX, top + 70, String(stats.enemies), { origin: [0, 0.5] });

    // Tally animation
    const still = reducedMotion();
    let shown = 0;
    if (still || stats.coins === 0) setPx(coinT, String(stats.coins));
    else {
      this.time.addEvent({
        delay: Math.max(16, Math.min(60, 900 / stats.coins)),
        repeat: stats.coins - 1,
        callback: () => {
          shown++;
          setPx(coinT, String(shown));
          if (shown % 2 === 0 || shown === stats.coins) audio.sfx('count');
        },
      });
    }
    const got = new Set(stats.souvenirs);
    const allTime = new Set(rec?.souvenirs ?? []);
    souv.forEach((img, i) => {
      if (!got.has(i) && !allTime.has(i)) return;
      this.time.delayedCall(still ? 0 : 500 + i * 250, () => {
        setIcon(img, 'souvenir_icon');
        if (!got.has(i)) img.setAlpha(0.5); // collected on an earlier run
        else {
          audio.sfx('coin');
          if (!still) this.tweens.add({ targets: img, scale: { from: 2, to: 1 }, duration: 250, ease: 'Back.out' });
        }
      });
    });

    if (world) {
      px(this, GAME_WIDTH / 2, 170, 'THE EL-IMINATOR IS DOWN... BUT THE STORY', { color: COLORS.skyBlue });
      px(this, GAME_WIDTH / 2, 181, "ISN'T OVER YET!", { color: COLORS.skyBlue });
      audio.stopMusic();
      audio.music('worldclear');
    } else {
      this.time.delayedCall(2600, () => {
        if (this.sys.isActive()) audio.music('map');
      });
    }

    const items: MenuItem[] = [];
    if (lvl?.next) items.push({ label: 'NEXT LEVEL', onSelect: () => transitionTo(this, 'Level', { levelId: lvl.next }) });
    // World complete → the ending (family on the L at sunset, credits, World 2 teaser) → world map.
    if (world) items.push({ label: 'CONTINUE', onSelect: () => transitionTo(this, 'Ending') });
    items.push({ label: 'REPLAY', onSelect: () => transitionTo(this, 'Level', { levelId: stats.levelId }) });
    items.push({ label: 'WORLD MAP', onSelect: () => transitionTo(this, 'WorldMap'), sound: 'menu-back' });
    createMenu(this, items, GAME_WIDTH / 2, world ? 204 : 186, 18, { width: 150, panel: true });
  }

  update(_t: number, delta: number): void {
    this.sky?.update(delta);
  }
}
