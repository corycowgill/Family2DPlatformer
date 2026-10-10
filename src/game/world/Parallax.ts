import Phaser from 'phaser';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { IMAGES } from '../data/assets';
import type { LevelTheme } from '../types';
import { saveSystem } from '../systems/SaveSystem';
import type { LevelContext } from './LevelContext';
import { Ambient } from './Ambient';

export type ParallaxLayerName = 'sky' | 'clouds' | 'far' | 'mid' | 'near';

interface LayerDef {
  layer: ParallaxLayerName;
  /** Horizontal scroll factor relative to the camera. */
  factor: number;
  depth: number;
  /** Autonomous drift in px/s (clouds), disabled under reduced motion. */
  drift: number;
}

const LAYERS: readonly LayerDef[] = [
  { layer: 'sky', factor: 0, depth: DEPTH.sky, drift: 0 },
  { layer: 'clouds', factor: 0.04, depth: DEPTH.sky + 5, drift: 3.5 },
  { layer: 'far', factor: 0.1, depth: DEPTH.parallaxFar, drift: 0 },
  { layer: 'mid', factor: 0.3, depth: DEPTH.parallaxMid, drift: 0 },
  { layer: 'near', factor: 0.55, depth: DEPTH.parallaxNear, drift: 0 },
];

/** Live state of one layer (read by the ambient system to pin sprites onto it). */
export interface ParallaxLayer {
  readonly name: ParallaxLayerName;
  readonly ts: Phaser.GameObjects.TileSprite;
  readonly factor: number;
  readonly depth: number;
  readonly drift: number;
  /** Texture width: layer x coordinates wrap at this. */
  readonly width: number;
  /** Current integer texture offset (tilePositionX). Layer x = screen x + offsetX. */
  offsetX: number;
  /** Accumulated drift (wrapped). */
  driftX: number;
}

/** Max downward shift (px) of the nearest layer when the camera climbs above the level floor. */
const MAX_LIFT = 28;

/**
 * Multi-layer horizontally-scrolling background fixed to the camera:
 * sky (static) → drifting clouds → far skyline → mid → near, plus the theme's
 * ambient animation (see Ambient.ts), attached once the level context exists.
 */
export class Parallax {
  private layers: ParallaxLayer[] = [];
  private ambient?: Ambient;
  private readonly bounds = new Phaser.Geom.Rectangle();

  constructor(
    private scene: Phaser.Scene,
    readonly theme: LevelTheme,
  ) {
    for (const l of LAYERS) {
      const key = l.layer === 'clouds' ? `bg-${theme}-clouds` : IMAGES.bg(theme, l.layer);
      if (!scene.textures.exists(key)) continue;
      const src = scene.textures.get(key).getSourceImage();
      const h = l.layer === 'clouds' ? src.height : GAME_HEIGHT;
      const ts = scene.add.tileSprite(0, 0, GAME_WIDTH, h, key).setOrigin(0, 0).setScrollFactor(0).setDepth(l.depth);
      this.layers.push({ name: l.layer, ts, factor: l.factor, depth: l.depth, drift: l.drift, width: src.width || GAME_WIDTH, offsetX: 0, driftX: 0 });
    }
  }

  /** Start the theme's ambient animation (one call from LevelScene once ctx exists). */
  attachAmbient(ctx: LevelContext): void {
    this.ambient?.destroy();
    this.ambient = new Ambient(ctx, this);
  }

  layer(name: ParallaxLayerName): ParallaxLayer | undefined {
    for (const l of this.layers) if (l.name === name) return l;
    return undefined;
  }

  update(): void {
    const cam = this.scene.cameras.main;
    const dt = Math.min(50, this.scene.game.loop.delta) / 1000;
    const still = saveSystem.get().settings.reducedMotion;
    cam.getBounds(this.bounds);
    // How far the camera is above its lowest position (tall levels): push layers down a bit
    // so climbing reveals more sky. 0 on single-screen-high levels.
    const climb = Math.max(0, this.bounds.bottom - GAME_HEIGHT - cam.scrollY);
    for (const l of this.layers) {
      if (l.drift && !still) l.driftX = (l.driftX + l.drift * dt) % l.width;
      l.offsetX = Math.round(cam.scrollX * l.factor + l.driftX);
      l.ts.tilePositionX = l.offsetX;
      l.ts.y = Math.round(Math.min(MAX_LIFT, climb * l.factor * 0.25));
    }
    this.ambient?.update(dt, still);
  }
}
