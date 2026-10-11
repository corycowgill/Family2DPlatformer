import Phaser from 'phaser';
import { saveSystem } from './SaveSystem';

/**
 * Runtime accessibility switches read by gameplay/FX code (settings live in SaveSystem;
 * the pure assist rules are in Assist.ts).
 */

/** Camera shake allowed (Screen shake ON and Reduced motion OFF). */
export function shakeAllowed(): boolean {
  const s = saveSystem.get().settings;
  return s.screenShake && !s.reducedMotion;
}

/** "Reduce flashing": no white flashes, strobing tints, screen flashes or lamp flicker. */
export function reduceFlashing(): boolean {
  return saveSystem.get().settings.reduceFlashing;
}

/** Calm hit cue used instead of a solid white flash when flashing is reduced. */
export const SOFT_HIT_TINT = 0xffa0a0;

/** Outline colours for the high-contrast option. */
export const OUTLINE_PLAYER = 0xffffff;
export const OUTLINE_ENEMY = 0xff3030;

const OFFSETS: readonly [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
type Outlined = Phaser.GameObjects.Sprite;

/**
 * High-contrast outline: four 1-px offset, tint-filled copies of each tracked sprite drawn
 * just behind it. Plain images batch with the rest of the scene (no per-sprite framebuffer
 * like preFX glow, which halved the frame rate in a software-GL check), so it is cheap on
 * phones. Copies are synced once per rendered frame and hidden for off-screen targets.
 */
export class OutlineLayer {
  private readonly copies = new Map<Outlined, Phaser.GameObjects.Image[]>();
  private readonly sources: (() => Iterable<Phaser.GameObjects.GameObject>)[] = [];
  private readonly colors = new Map<() => Iterable<Phaser.GameObjects.GameObject>, number>();

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.sync, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** Outline everything `list()` returns (re-read each frame, so later spawns are included). */
  track(list: () => Iterable<Phaser.GameObjects.GameObject>, color: number): this {
    this.sources.push(list);
    this.colors.set(list, color);
    return this;
  }

  private sync(): void {
    const view = this.scene.cameras.main.worldView;
    const seen = new Set<Outlined>();
    for (const src of this.sources) {
      const color = this.colors.get(src)!;
      for (const go of src()) {
        if (!(go instanceof Phaser.GameObjects.Sprite) || !go.active) continue;
        seen.add(go);
        let imgs = this.copies.get(go);
        if (!imgs) {
          imgs = OFFSETS.map(() => this.scene.add.image(0, 0, go.texture.key).setTintFill(color));
          this.copies.set(go, imgs);
        }
        const onScreen =
          go.visible && go.alpha > 0.05 &&
          go.x + go.displayWidth > view.x && go.x - go.displayWidth < view.right &&
          go.y + go.displayHeight > view.y && go.y - go.displayHeight < view.bottom;
        imgs.forEach((img, i) => {
          img.setVisible(onScreen);
          if (!onScreen) return;
          if (img.texture.key !== go.texture.key || img.frame.name !== go.frame.name) img.setTexture(go.texture.key, go.frame.name);
          img
            .setPosition(go.x + OFFSETS[i][0], go.y + OFFSETS[i][1])
            .setOrigin(go.originX, go.originY)
            .setScale(go.scaleX, go.scaleY)
            .setFlip(go.flipX, go.flipY)
            .setRotation(go.rotation)
            .setScrollFactor(go.scrollFactorX, go.scrollFactorY)
            .setAlpha(go.alpha)
            .setDepth(go.depth - 0.01);
        });
      }
    }
    for (const [go, imgs] of this.copies) {
      if (seen.has(go)) continue;
      for (const img of imgs) img.destroy();
      this.copies.delete(go);
    }
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.sync, this);
    for (const imgs of this.copies.values()) for (const img of imgs) img.destroy();
    this.copies.clear();
  }
}
