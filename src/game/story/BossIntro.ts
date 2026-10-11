import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { px } from '../ui/PixelFont';
import { COLORS } from '../ui/Widgets';
import { reducedMotion } from '../ui/Transitions';
import { audio } from '../systems/AudioSystem';
import { bossCard } from './storyData';

/** Emitted on the level scene's events when a cinematic beat ends (timed out or skipped). */
export const CINEMATIC_END = 'cinematic-end';

/** Boss intro length. Shorter than every boss's `introMs` (1600) so the fight timing is unchanged. */
export const BOSS_INTRO_MS = 1450;
export const BOSS_INTRO_REPEAT_MS = 850;
const BAR_H = 30;

/** Bosses whose full intro has been seen this session (retries get a shorter beat). */
const seen = new Set<string>();

/** Minimal view of LevelScene the intro needs (avoids a scene ↔ story import cycle). */
export interface CinematicHost {
  events: Phaser.Events.EventEmitter;
  cinematic(ms: number, focus?: { x: number; y: number }): void;
  findBoss(name: string): { x: number; y: number } | undefined;
}

/**
 * Boss intro beat, drawn by the HUD scene: letterbox bars, HUD hidden, the level camera
 * eases onto the boss (LevelScene.cinematic — player input is held meanwhile), and a
 * station-sign name card. Jump / confirm skips. Calls `onDone` when control returns.
 */
export function playBossIntro(hud: Phaser.Scene, level: CinematicHost, name: string, onDone: () => void): void {
  const card = bossCard(name);
  const ms = seen.has(name) ? BOSS_INTRO_REPEAT_MS : BOSS_INTRO_MS;
  seen.add(name);
  const still = reducedMotion();

  // Hide the HUD while the beat plays.
  const hidden = hud.children.list.filter((o) => (o as unknown as Phaser.GameObjects.Components.Visible).visible) as unknown as Phaser.GameObjects.Components.Visible[];
  for (const o of hidden) o.setVisible(false);

  const root = hud.add.container(0, 0).setDepth(800);
  const top = hud.add.rectangle(0, 0, GAME_WIDTH, BAR_H, 0x000000, 1).setOrigin(0, 0);
  const bot = hud.add.rectangle(0, GAME_HEIGHT, GAME_WIDTH, BAR_H, 0x000000, 1).setOrigin(0, 1);
  root.add([top, bot]);

  // Station-sign name card, lower third.
  const sign = hud.add.container(GAME_WIDTH / 2, GAME_HEIGHT - BAR_H - 34);
  const title = px(hud, 0, -5, card.title, { scale: 2, outline: false, color: 0xffffff });
  const w = Math.max(200, Math.ceil(title.width) + 40);
  const g = hud.add.graphics();
  g.fillStyle(0x000000, 0.5).fillRect(-w / 2 + 2, -18 + 2, w, 40);
  g.fillStyle(0x111111, 1).fillRect(-w / 2, -18, w, 40);
  g.fillStyle(0xffffff, 1).fillRect(-w / 2, -18, w, 1);
  g.fillStyle(card.line, 1).fillRect(-w / 2, 8, w, 4);
  g.fillStyle(COLORS.red, 1).fillRect(-w / 2 + 6, -12, 4, 14);
  sign.add([g, title]);
  if (card.subtitle) {
    const sub = px(hud, 0, 17, card.subtitle, { outline: false, color: 0xff8a2a });
    const sg = hud.add.graphics();
    const sw = Math.ceil(sub.width) + 12;
    sg.fillStyle(0x111111, 1).fillRect(-sw / 2, 12, sw, 11);
    sign.add([sg, sub]);
  }
  const warn = px(hud, 0, -28, '! WARNING !', { color: COLORS.red });
  sign.add(warn);
  root.add(sign);

  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    level.events.off(CINEMATIC_END, end);
    const fadeMs = still ? 150 : 260;
    hud.tweens.add({ targets: top, y: -BAR_H, duration: fadeMs });
    hud.tweens.add({ targets: bot, y: GAME_HEIGHT + BAR_H, duration: fadeMs });
    hud.tweens.add({ targets: sign, alpha: 0, duration: fadeMs, onComplete: () => root.destroy() });
    for (const o of hidden) if ((o as unknown as Phaser.GameObjects.GameObject).active) o.setVisible(true);
    onDone();
  };

  if (still) {
    root.setAlpha(0);
    hud.tweens.add({ targets: root, alpha: 1, duration: 150 });
  } else {
    top.setY(-BAR_H);
    bot.setY(GAME_HEIGHT + BAR_H);
    hud.tweens.add({ targets: top, y: 0, duration: 260, ease: 'Cubic.out' });
    hud.tweens.add({ targets: bot, y: GAME_HEIGHT, duration: 260, ease: 'Cubic.out' });
    sign.setX(-GAME_WIDTH / 2);
    hud.tweens.add({ targets: sign, x: GAME_WIDTH / 2, duration: 340, delay: 160, ease: 'Back.out' });
    hud.tweens.add({ targets: warn, alpha: 0.2, duration: 200, yoyo: true, repeat: -1, delay: 500 });
  }
  audio.sfx('train-horn', { volume: 0.7 });
  level.events.on(CINEMATIC_END, end);
  hud.events.once(Phaser.Scenes.Events.SHUTDOWN, () => level.events.off(CINEMATIC_END, end));
  const boss = level.findBoss(name);
  level.cinematic(ms, boss ? { x: boss.x, y: boss.y - 40 } : undefined);
}
