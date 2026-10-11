import Phaser from 'phaser';

/**
 * Builds Phaser animations from atlas frame names. A frame named `<anim>_<n>` in
 * atlas `<key>` becomes part of animation `<key>:<anim>`.
 */

/** Frame rates per animation name (fallback DEFAULT_FPS). */
const FPS: Record<string, number> = {
  idle: 6, walk: 10, run: 14, jump: 8, fall: 8, land: 14, crouch: 8, attack: 16, hurt: 10,
  victory: 8, defeat: 8, ability: 14, move: 10, hit: 12, die: 10, coin: 10, star: 8, question: 6,
  // effects atlas (frame counts in tools/art/draw_effects.py ANIMS)
  dust: 18, spark: 24, explosion_small: 18, explosion_large: 16, smoke: 12, coin_burst: 20, poof: 18,
  energy_shot: 12, alien_laser: 14, plasma_shot: 12, drone_shot: 12, shockwave: 16, sniff: 14,
  air_puff: 18, dash_trail: 20, spawn_ring: 14,
  pigeon_idle: 4, pigeon_fly: 14, steam: 10,
};
const DEFAULT_FPS = 10;

/** Animations that play once (others loop). */
const ONCE = new Set([
  'land', 'attack', 'hurt', 'victory', 'defeat', 'hit', 'die', 'dust', 'spark', 'explosion_small',
  'explosion_large', 'smoke', 'coin_burst', 'poof', 'shockwave', 'sniff', 'air_puff', 'dash_trail', 'spawn_ring',
]);
/** Looping anims that should NOT loop despite default (jump/fall hold last frame). */
const HOLD_LAST = new Set(['jump', 'fall', 'crouch']);

export function animKey(atlas: string, anim: string): string {
  return `${atlas}:${anim}`;
}

/** Group frame names like walk_0, walk_1 → { walk: [walk_0, walk_1] } (sorted numerically). Exported for tests. */
export function groupFrames(frameNames: string[]): Record<string, string[]> {
  const groups: Record<string, { n: number; name: string }[]> = {};
  for (const name of frameNames) {
    const m = /^(.*)_(\d+)$/.exec(name);
    if (!m) continue;
    (groups[m[1]] ??= []).push({ n: Number(m[2]), name });
  }
  const out: Record<string, string[]> = {};
  for (const [k, arr] of Object.entries(groups)) out[k] = arr.sort((a, b) => a.n - b.n).map((f) => f.name);
  return out;
}

export function registerAtlasAnimations(scene: Phaser.Scene, atlasKey: string): void {
  const tex = scene.textures.get(atlasKey);
  if (!tex || tex.key === '__MISSING') return;
  const groups = groupFrames(tex.getFrameNames());
  for (const [anim, frames] of Object.entries(groups)) {
    const key = animKey(atlasKey, anim);
    if (scene.anims.exists(key)) continue;
    const once = ONCE.has(anim) || HOLD_LAST.has(anim);
    scene.anims.create({
      key,
      frames: frames.map((frame) => ({ key: atlasKey, frame })),
      frameRate: FPS[anim] ?? DEFAULT_FPS,
      repeat: once ? 0 : -1,
    });
  }
}

/** Play `<atlas>:<anim>` if it exists; otherwise try `fallback`, otherwise keep the current frame. */
export function playAnim(
  sprite: Phaser.GameObjects.Sprite,
  anim: string,
  fallback = 'idle',
  ignoreIfPlaying = true,
): void {
  const atlas = sprite.texture.key;
  const scene = sprite.scene;
  let key = animKey(atlas, anim);
  if (!scene.anims.exists(key)) {
    key = animKey(atlas, fallback);
    if (!scene.anims.exists(key)) return;
  }
  sprite.anims.play(key, ignoreIfPlaying);
}

export function hasAnim(scene: Phaser.Scene, atlas: string, anim: string): boolean {
  return scene.anims.exists(animKey(atlas, anim));
}
