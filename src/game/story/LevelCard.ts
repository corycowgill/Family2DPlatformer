import Phaser from 'phaser';
import { GAME_WIDTH } from '../config';
import { IMAGES } from '../data/assets';
import { CHARACTERS } from '../characters';
import type { CharacterId, LevelInfo } from '../types';
import { px } from '../ui/PixelFont';
import { COLORS } from '../ui/Widgets';
import { reducedMotion } from '../ui/Transitions';
import { drawChicagoStar } from '../scenes/MenuScene';
import { measureLine } from '../ui/fontGlyphs';
import { levelTagline } from './storyData';

const CARD_Y = 96;
const BAND_H = 60;
const HOLD_MS = 1700;

/**
 * Level intro card (shown by the HUD at level start): a Chicago-flag band with the hero's
 * portrait, "WORLD 1-2", the level name and a one-line flavour subtitle. Purely visual —
 * gameplay runs underneath; it slides away by itself.
 */
export function showLevelCard(scene: Phaser.Scene, level: LevelInfo, hero: CharacterId, depth = 500): Phaser.GameObjects.Container {
  const def = CHARACTERS[hero];
  const name = level.name.toUpperCase();
  const tagline = levelTagline(level.id).toUpperCase();
  const textW = Math.max(measureLine(name) * 2, measureLine(tagline), 60);
  const portrait = 52;
  const blockW = portrait + 12 + textW;
  const left = Math.round(-blockW / 2);

  const c = scene.add.container(GAME_WIDTH / 2, CARD_Y).setDepth(depth);
  const band = scene.add.graphics();
  const half = GAME_WIDTH / 2;
  band.fillStyle(COLORS.ink, 0.82).fillRect(-half, -BAND_H / 2, GAME_WIDTH, BAND_H);
  band.fillStyle(COLORS.skyBlue, 1).fillRect(-half, -BAND_H / 2, GAME_WIDTH, 2).fillRect(-half, BAND_H / 2 - 2, GAME_WIDTH, 2);
  band.fillStyle(0xffffff, 0.9).fillRect(-half, -BAND_H / 2 + 2, GAME_WIDTH, 1).fillRect(-half, BAND_H / 2 - 3, GAME_WIDTH, 1);
  drawChicagoStar(band, left - 22, 0, 7);
  drawChicagoStar(band, left + blockW + 22, 0, 7);
  c.add(band);

  // Portrait in the hero's colour.
  const pf = scene.add.graphics();
  const px0 = left;
  pf.fillStyle(COLORS.ink, 1).fillRect(px0 - 1, -portrait / 2 - 1, portrait + 2, portrait + 2);
  pf.fillStyle(def.color, 1).fillRect(px0, -portrait / 2, portrait, portrait);
  pf.fillStyle(0xffffff, 0.25).fillRect(px0, -portrait / 2, portrait, 2);
  const pic = scene.add.container(0, 0);
  pic.add(pf);
  const key = IMAGES.portrait(hero);
  if (scene.textures.exists(key)) pic.add(scene.add.image(px0 + portrait / 2, 0, key).setScale(2));
  c.add(pic);

  const tx = left + portrait + 12;
  const text = scene.add.container(0, 0);
  text.add(px(scene, tx, -19, `WORLD ${level.number}`, { origin: [0, 0.5], color: COLORS.gold }));
  text.add(px(scene, tx, -2, name, { scale: 2, origin: [0, 0.5], color: COLORS.text }));
  if (tagline) text.add(px(scene, tx, 17, tagline, { origin: [0, 0.5], color: COLORS.skyBlue }));
  c.add(text);

  if (reducedMotion()) {
    c.setAlpha(0);
    scene.tweens.chain({
      targets: c,
      tweens: [
        { alpha: 1, duration: 200 },
        { alpha: 0, delay: HOLD_MS + 300, duration: 300 },
      ],
      onComplete: () => c.destroy(),
    });
    return c;
  }
  // Band wipes open, portrait drops in, text slides from the right; then everything slides out left.
  band.setScale(1, 0);
  scene.tweens.add({ targets: band, scaleY: 1, duration: 220, ease: 'Cubic.out' });
  pic.setY(-80).setAlpha(0);
  scene.tweens.add({ targets: pic, y: 0, alpha: 1, duration: 360, delay: 120, ease: 'Back.out' });
  text.setX(60).setAlpha(0);
  scene.tweens.add({ targets: text, x: 0, alpha: 1, duration: 320, delay: 200, ease: 'Cubic.out' });
  scene.tweens.add({
    targets: c,
    x: -GAME_WIDTH / 2,
    alpha: 0,
    delay: 520 + HOLD_MS,
    duration: 380,
    ease: 'Cubic.in',
    onComplete: () => c.destroy(),
  });
  return c;
}
