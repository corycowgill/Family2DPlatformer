import Phaser from 'phaser';
import type { AssetManifest } from '../data/assets';

/**
 * Small pixel-art icon atlas ('uigen') drawn at runtime, used whenever the art team's
 * 'ui' atlas isn't shipped yet (PlaceholderArt only makes coloured circles for it).
 */
export const UIGEN = 'uigen';

const PAL: Record<string, string> = {
  k: '#0b1730', R: '#e8414e', r: '#a3203a', w: '#ffffff', Y: '#ffd25a', o: '#c98a1b', S: '#c8d4e0', s: '#7f93ab',
  d: '#3a4566', D: '#26304d', G: '#4cd07a', g: '#23864a', B: '#4aa3ff', b: '#2a5fb0', P: '#c23fd0', O: '#ff9d2e', n: '#8a5a32',
};

const ICONS: Record<string, string[]> = {
  heart_full: ['.kk...kk.', 'kRRk.kRRk', 'kRwRkRRrk', 'kRRRRRRrk', '.kRRRRrk.', '..kRRrk..', '...kRk...', '....k....'],
  heart_empty: ['.kk...kk.', 'kddk.kddk', 'kdDdkdddk', 'kdddddddk', '.kdddddk.', '..kdddk..', '...kdk...', '....k....'],
  coin_icon: ['..kkkk..', '.kYYYYk.', 'kYwYYoYk', 'kYwYYoYk', 'kYwYYoYk', 'kYYYYoYk', '.kYooYk.', '..kkkk..'],
  star_icon: ['....k....', '...kYk...', '...kYk...', 'kkkYwYkkk', 'kYYYwYYYk', '.kYYYYYk.', '..kYYYk..', '.kYYkYYk.', '.kYk.kYk.', '.kk...kk.'],
  souvenir_icon: ['...kkkkkk...', '.kkSSSSSSkk.', 'kSSwwSSSSSSk', 'kSwSSSSSSSsk', 'kSSSSkkSSSsk', 'kSSsk..ksSsk', '.kkk....kkk.'],
  souvenir_icon_empty: ['...kkkkkk...', '.kkDDDDDDkk.', 'kDDDDDDDDDDk', 'kDDDDDDDDDDk', 'kDDDDkkDDDDk', 'kDDDk..kDDDk', '.kkk....kkk.'],
  lock: ['..kkkk..', '.kssssk.', '.ks..sk.', '.ks..sk.', 'kkkkkkkk', 'kYYYYYYk', 'kYYkkYYk', 'kYYkkYYk', 'kYooooYk', 'kkkkkkkk'],
  check: ['.......kk', '......kGk', '.....kGgk', 'kk..kGgk.', 'kGkkGgk..', '.kGGgk...', '..kgk....', '...k.....'],
  pause: ['kkkkkkkkk', 'kwwkkkwwk', 'kwwkkkwwk', 'kwwkkkwwk', 'kwwkkkwwk', 'kwwkkkwwk', 'kkkkkkkkk'],
  clock: ['..kkkk..', '.kwwwwk.', 'kwwkwwwk', 'kwwkwwwk', 'kwwkkkwk', 'kwwwwwwk', '.kwwwwk.', '..kkkk..'],
  life: ['..kkk..', '.kYYYk.', 'kYkYkYk', 'kYYYYYk', 'kYkkkYk', '.kYYYk.', '..kkk..'],
  pass: ['kkkkkkkkkk', 'kBBBBBBBBk', 'kBwwBBRRBk', 'kBBBBBBBBk', 'kBwwwwwwBk', 'kkkkkkkkkk'],
  hotdog: ['..kkkkkk..', '.kOOOOOOk.', 'kRRRRRRRRk', 'kOYOYOYOOk', '.kOOOOOOk.', '..kkkkkk..'],
  pizza: ['kkkkkkkk', 'kYRYYRYk', '.kYYRYk.', '.kYRYYk.', '..kYYk..', '..kYYk..', '...kk...'],
  plane: ['....k....', '...kwk...', 'kkkkwkkkk', 'kwwwwwwwk', '.kkkwkkk.', '...kwk...', '..kwwwk..', '..kkkkk..'],
  arrow_l: ['...k', '..kk', '.kwk', 'kwwk', '.kwk', '..kk', '...k'],
  arrow_r: ['k...', 'kk..', 'kwk.', 'kwwk', 'kwk.', 'kk..', 'k...'],
};

function draw(ctx: CanvasRenderingContext2D, ox: number, oy: number, rows: string[]): void {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = PAL[row[x]];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  });
}

export function ensureIcons(scene: Phaser.Scene): void {
  if (scene.textures.exists(UIGEN)) return;
  const names = Object.keys(ICONS);
  const cell = 16;
  const cols = 8;
  const tex = scene.textures.createCanvas(UIGEN, cols * cell, Math.ceil(names.length / cols) * cell);
  if (!tex) return;
  const ctx = tex.getContext();
  names.forEach((name, i) => {
    const rows = ICONS[name];
    const w = Math.max(...rows.map((r) => r.length));
    const x = (i % cols) * cell;
    const y = Math.floor(i / cols) * cell;
    draw(ctx, x, y, rows);
    tex.add(name, 0, x, y, w, rows.length);
  });
  tex.refresh();
}

/** True when `key` was shipped by the art team (listed in the manifest), not a generated placeholder. */
export function isRealAsset(scene: Phaser.Scene, key: string): boolean {
  if (!scene.textures.exists(key)) return false;
  const m = scene.cache.json.get('manifest') as AssetManifest | undefined;
  if (!m) return false;
  return (m.atlases ?? []).some((a) => a.key === key) || (m.images ?? []).some((i) => i.key === key);
}

/** True when the real atlas `atlas` has frame `frame`. */
export function hasRealFrame(scene: Phaser.Scene, atlas: string, frame: string): boolean {
  return isRealAsset(scene, atlas) && scene.textures.get(atlas).has(frame);
}

/** Map our generated icon names to the art contract's 'ui' atlas frame names. */
const UI_ATLAS_NAME: Record<string, string> = {
  heart_full: 'heart_full', heart_empty: 'heart_empty', coin_icon: 'coin_icon', star_icon: 'star_icon',
  souvenir_icon: 'souvenir_icon', souvenir_icon_empty: 'souvenir_icon_empty', lock: 'lock', pause: 'btn_pause',
};

/** Texture + frame for a UI icon, preferring real art. */
export function iconFrame(scene: Phaser.Scene, name: string): [string, string] {
  const real = UI_ATLAS_NAME[name];
  if (real && hasRealFrame(scene, 'ui', real)) return ['ui', real];
  ensureIcons(scene);
  return [UIGEN, name];
}

export function icon(scene: Phaser.Scene, x: number, y: number, name: string): Phaser.GameObjects.Image {
  const [tex, frame] = iconFrame(scene, name);
  return scene.add.image(x, y, tex, frame);
}

export function setIcon(img: Phaser.GameObjects.Image, name: string): void {
  const [tex, frame] = iconFrame(img.scene, name);
  img.setTexture(tex, frame);
}
