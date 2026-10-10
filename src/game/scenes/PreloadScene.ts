import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { MANIFEST_PATH, type AssetManifest } from '../data/assets';
import { registerAtlasAnimations } from '../systems/AnimationSystem';
import { ensurePlaceholderArt } from '../systems/PlaceholderArt';
import { registerAudio } from '../systems/AudioAssets';

/**
 * Loads `assets/manifest.json`, then every atlas/image it lists. Anything missing is
 * replaced by generated placeholder art, so a partially complete asset set still runs.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  preload(): void {
    const bar = this.add.graphics();
    const w = 200;
    this.load.on(Phaser.Loader.Events.PROGRESS, (p: number) => {
      bar.clear();
      bar.fillStyle(0x23395d).fillRect((GAME_WIDTH - w) / 2, GAME_HEIGHT / 2, w, 6);
      bar.fillStyle(0xe8414e).fillRect((GAME_WIDTH - w) / 2, GAME_HEIGHT / 2, w * p, 6);
    });
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (f: Phaser.Loader.File) => {
      console.warn(`Asset failed to load: ${f.key}`);
    });
    this.load.json('manifest', MANIFEST_PATH);
    this.load.once(Phaser.Loader.Events.FILE_KEY_COMPLETE + 'json-manifest', () => {
      const m = this.cache.json.get('manifest') as AssetManifest | undefined;
      if (!m) return;
      for (const a of m.atlases ?? []) this.load.atlas(a.key, a.png, a.json);
      for (const i of m.images ?? []) this.load.image(i.key, i.path);
    });
    registerAudio(this);
  }

  create(): void {
    ensurePlaceholderArt(this);
    for (const key of this.textures.getTextureKeys()) registerAtlasAnimations(this, key);
    const params = new URLSearchParams(window.location.search);
    const level = params.get('level');
    if (level) {
      this.scene.start('Level', { levelId: level });
      return;
    }
    this.scene.start('Menu');
  }
}
