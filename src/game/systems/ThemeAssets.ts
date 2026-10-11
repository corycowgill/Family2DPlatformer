import type Phaser from 'phaser';
import type { AssetManifest } from '../data/assets';

/**
 * Per-theme background loading. Each theme's parallax set is ~4 MB of GPU texture, so only
 * the themes the menu / story / World-1 ending use are loaded at boot; every other theme is
 * loaded when a level (or cutscene) needs it and released when another lazy theme replaces it.
 */
export const EAGER_THEMES: readonly string[] = ['day', 'rooftop', 'river', 'sunset'];

const BG_KEY = /^bg-([a-z0-9]+)-/;

/** Theme of a background texture key (`bg-<theme>-<layer>`), or null for other keys. Pure. */
export function bgTheme(key: string): string | null {
  const m = BG_KEY.exec(key);
  return m ? m[1] : null;
}

/** True for background images that are not loaded at boot. Pure. */
export function isLazyBgKey(key: string): boolean {
  const t = bgTheme(key);
  return t !== null && !EAGER_THEMES.includes(t);
}

/**
 * Queue the manifest images for `themes` on `scene.load` (call from a scene's preload()).
 * Generated placeholder textures with the same key are replaced. Returns the number queued.
 */
export function queueThemeBackgrounds(scene: Phaser.Scene, ...themes: string[]): number {
  const m = scene.cache.json.get('manifest') as AssetManifest | undefined;
  if (!m) return 0;
  let n = 0;
  for (const img of m.images ?? []) {
    const t = bgTheme(img.key);
    if (!t || !themes.includes(t)) continue;
    const tex = scene.textures.exists(img.key) ? scene.textures.get(img.key) : null;
    // A real loaded image has an HTMLImageElement source; generated placeholders are canvases.
    const isReal = !!tex && tex.getSourceImage() instanceof HTMLImageElement;
    if (isReal) continue;
    if (tex) scene.textures.remove(img.key);
    scene.load.image(img.key, img.path);
    n++;
  }
  return n;
}

/** Free lazily-loaded theme backgrounds except `keep` (eager themes are never released). */
export function releaseLazyThemes(scene: Phaser.Scene, keep: readonly string[]): void {
  for (const key of scene.textures.getTextureKeys()) {
    const t = bgTheme(key);
    if (t && isLazyBgKey(key) && !keep.includes(t)) scene.textures.remove(key);
  }
}
