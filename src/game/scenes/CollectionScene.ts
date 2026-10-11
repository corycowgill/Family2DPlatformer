import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { LEVELS } from '../data/levels';
import { CHARACTER_IDS } from '../types';
import { saveSystem } from '../systems/SaveSystem';
import { audio } from '../systems/AudioSystem';
import { collectionStats, COSTUMES, isCharacterUnlocked, isCostumeUnlocked, MEDALS, medalTimes, TIER_RULE, UNLOCK_RULES } from '../systems/Rewards';
import { px } from '../ui/PixelFont';
import { icon } from '../ui/Icons';
import { onNav } from '../ui/NavInput';
import { Skyline } from '../ui/Skyline';
import { COLORS, button, panel } from '../ui/Widgets';
import { transitionIn, transitionTo } from '../ui/Transitions';
import { formatTarget, formatTime } from '../ui/format';
import { prompt } from '../ui/Prompts';

/**
 * COLLECTION (main menu): souvenirs found per level, best times and medals, Chicago
 * Stars, and the unlock table with progress — so every collectible visibly counts.
 */
export class CollectionScene extends Phaser.Scene {
  private sky!: Skyline;

  constructor() {
    super('Collection');
  }

  create(): void {
    this.sky = new Skyline(this, { train: false });
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.6).setOrigin(0).setDepth(-50);
    px(this, GAME_WIDTH / 2, 13, 'COLLECTION', { scale: 2, color: COLORS.gold });
    const save = saveSystem.get();
    const stats = collectionStats(save);

    // ── Levels: souvenirs, best time, medal ──
    panel(this, 8, 26, 464, 116);
    const hy = 36;
    px(this, 18, hy, 'LEVEL', { origin: [0, 0.5], color: COLORS.dim });
    px(this, 262, hy, 'SOUVENIRS', { color: COLORS.dim });
    px(this, 330, hy, 'BEST', { color: COLORS.dim });
    px(this, 378, hy, 'MEDAL', { color: COLORS.dim });
    px(this, 432, hy, 'GOLD AT', { color: COLORS.dim });
    LEVELS.forEach((l, i) => {
      const y = 50 + i * 16;
      const rec = save.levels[l.id];
      const open = saveSystem.isUnlocked(l.id);
      px(this, 18, y, l.number, { origin: [0, 0.5], color: open ? COLORS.gold : COLORS.dim });
      px(this, 44, y, open ? l.name.toUpperCase() : '???', { origin: [0, 0.5], color: open ? COLORS.text : COLORS.dim });
      for (let k = 0; k < 3; k++) icon(this, 246 + k * 16, y, rec?.souvenirs.includes(k) ? 'souvenir_icon' : 'souvenir_icon_empty');
      px(this, 330, y, rec?.bestTimeMs ? formatTime(rec.bestTimeMs) : '--:--.--', { color: rec?.bestTimeMs ? COLORS.text : COLORS.dim });
      icon(this, 378, y, rec?.medal ? `medal_${rec.medal}` : 'medal_empty');
      const mt = medalTimes(l.id);
      px(this, 432, y, mt ? formatTarget(mt.gold) : '-', { color: COLORS.dim });
    });
    // Totals
    const ty = 50 + LEVELS.length * 16 + 8;
    const g = this.add.graphics();
    g.fillStyle(COLORS.border, 0.5).fillRect(16, ty - 9, 448, 1);
    icon(this, 22, ty, 'souvenir_icon');
    px(this, 32, ty, `${stats.souvenirs}/${stats.souvenirsMax} SOUVENIRS`, { origin: [0, 0.5] });
    icon(this, 150, ty, 'star_icon');
    px(this, 160, ty, `${stats.stars} CHICAGO STARS`, { origin: [0, 0.5] });
    let mx = 280;
    for (const m of MEDALS) {
      icon(this, mx, ty, `medal_${m}`);
      px(this, mx + 8, ty, `x${stats.medals[m]}`, { origin: [0, 0.5] });
      mx += 36;
    }
    px(this, 462, ty, `CLEARED ${stats.levelsCleared}/${stats.levelsTotal}`, { origin: [1, 0.5], color: COLORS.sub });
    px(this, GAME_WIDTH / 2, ty + 13, 'CHICAGO STARS COUNT AS SOUVENIRS FOR OUTFITS II', { color: COLORS.dim });

    // ── Unlock table ──
    panel(this, 8, 146, 464, 102);
    px(this, 18, 156, 'UNLOCKS', { origin: [0, 0.5], color: COLORS.dim });
    px(this, 150, 156, 'HOW', { origin: [0, 0.5], color: COLORS.dim });
    px(this, 300, 156, 'PROGRESS', { origin: [0, 0.5], color: COLORS.dim });
    const bars = this.add.graphics();
    UNLOCK_RULES.forEach((r, i) => {
      const y = 172 + i * 19;
      const p = r.progress(save);
      const done = p.have >= p.need;
      const what =
        r.id === 'grandma'
          ? 'GRANDMA (SECRET HERO)'
          : `${r.reward} (${CHARACTER_IDS.filter((id) => COSTUMES[id].some((c) => TIER_RULE[c.tier] === r.id && isCostumeUnlocked(save, id, c.id))).length}/${CHARACTER_IDS.length})`;
      px(this, 18, y, r.id === 'grandma' && !done && !isCharacterUnlocked(save, 'grandma') ? 'SECRET HERO' : what, {
        origin: [0, 0.5],
        color: done ? COLORS.gold : COLORS.text,
      });
      px(this, 150, y, r.hint, { origin: [0, 0.5], color: COLORS.sub });
      // progress bar
      const bx = 300;
      const bw = 90;
      bars.fillStyle(COLORS.ink, 1).fillRect(bx, y - 3, bw, 7);
      bars.fillStyle(done ? COLORS.green : COLORS.gold, 1).fillRect(bx + 1, y - 2, Math.round(((bw - 2) * Math.min(p.have, p.need)) / p.need), 5);
      px(this, bx + bw + 6, y, `${Math.min(p.have, p.need)}/${p.need}`, { origin: [0, 0.5], color: done ? COLORS.green : COLORS.sub });
      if (done) icon(this, 456, y, 'check');
      else icon(this, 456, y, 'lock').setScale(0.75);
    });

    button(this, 32, 13, 'BACK', () => this.back(), { sound: 'menu-back', w: 48 });
    prompt(this, GAME_WIDTH / 2, GAME_HEIGHT - 10, (d) => (d === 'touch' ? 'TAP BACK TO RETURN' : '{BACK} BACK'), { color: COLORS.sub });
    onNav(this, (a) => {
      if (a === 'back' || a === 'confirm' || a === 'start') {
        audio.sfx('menu-back');
        this.back();
      }
    });
    if (!audio.musicKey) audio.music('title');
    transitionIn(this);
  }

  private back(): void {
    transitionTo(this, 'Menu');
  }

  update(_t: number, delta: number): void {
    this.sky.update(delta);
  }
}
