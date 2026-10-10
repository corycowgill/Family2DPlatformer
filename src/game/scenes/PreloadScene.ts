import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { MANIFEST_PATH, type AssetManifest } from '../data/assets';
import { registerAtlasAnimations } from '../systems/AnimationSystem';
import { ensurePlaceholderArt } from '../systems/PlaceholderArt';
import { buildSfx, ensureMusic, registerAudio, warmMusic } from '../systems/AudioAssets';
import { px, setPx } from '../ui/PixelFont';
import { COLORS, drawPanel } from '../ui/Widgets';

/**
 * Loads `assets/manifest.json`, then every atlas/image it lists. Anything missing is
 * replaced by generated placeholder art, so a partially complete asset set still runs.
 * Also synthesises the sound effects and title music.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  preload(): void {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    const w = 200;
    px(this, cx, cy - 22, 'CHICAGO FAMILY ADVENTURE', { color: COLORS.gold });
    const label = px(this, cx, cy + 18, 'LOADING THE LOOP... 0%', { color: COLORS.sub });
    const bar = this.add.graphics();
    const draw = (p: number) => {
      bar.clear();
      drawPanel(bar, cx - w / 2 - 3, cy - 5, w + 6, 12);
      bar.fillStyle(COLORS.red).fillRect(cx - w / 2, cy - 2, Math.round(w * p), 6);
      bar.fillStyle(0xffffff, 0.35).fillRect(cx - w / 2, cy - 2, Math.round(w * p), 1);
    };
    draw(0);
    this.load.on(Phaser.Loader.Events.PROGRESS, (p: number) => {
      draw(p);
      setPx(label, `LOADING THE LOOP... ${Math.round(p * 100)}%`);
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
    const t0 = performance.now();
    buildSfx(this.game);
    ensureMusic(this.game, 'title');
    (window as unknown as { __audioBuildMs?: number }).__audioBuildMs = Math.round(performance.now() - t0);
    warmMusic(this.game);
    const params = new URLSearchParams(window.location.search);
    const level = params.get('level');
    if (level) {
      this.scene.start('Level', { levelId: level });
      return;
    }
    const screen = params.get('screen');
    if (screen && this.scene.get(screen)) {
      this.scene.start(screen);
      return;
    }
    this.scene.start('Menu');
  }
}
