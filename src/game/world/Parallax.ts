import Phaser from 'phaser';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { IMAGES } from '../data/assets';
import type { LevelTheme } from '../types';

const LAYERS = [
  { layer: 'sky', factor: 0, depth: DEPTH.sky },
  { layer: 'far', factor: 0.1, depth: DEPTH.parallaxFar },
  { layer: 'mid', factor: 0.3, depth: DEPTH.parallaxMid },
  { layer: 'near', factor: 0.55, depth: DEPTH.parallaxNear },
] as const;

/** Multi-layer horizontally-scrolling background fixed to the camera. */
export class Parallax {
  private sprites: { ts: Phaser.GameObjects.TileSprite; factor: number }[] = [];

  constructor(private scene: Phaser.Scene, theme: LevelTheme) {
    for (const l of LAYERS) {
      const key = IMAGES.bg(theme, l.layer);
      if (!scene.textures.exists(key)) continue;
      const ts = scene.add
        .tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, key)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(l.depth);
      this.sprites.push({ ts, factor: l.factor });
    }
  }

  update(): void {
    const cam = this.scene.cameras.main;
    for (const { ts, factor } of this.sprites) {
      ts.tilePositionX = cam.scrollX * factor;
      // subtle vertical parallax so tall levels feel deep
      ts.tilePositionY = 0;
      ts.y = Math.round(-Math.max(0, cam.scrollY - (cam.getBounds().height - GAME_HEIGHT)) * factor * 0.2);
    }
  }
}
