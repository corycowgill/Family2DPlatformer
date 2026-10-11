import Phaser from 'phaser';

/**
 * Builds Phaser animations from atlas frame names. A frame named `<anim>_<n>` in
 * atlas `<key>` becomes part of animation `<key>:<anim>`.
 *
 * Atlases may carry per-animation timing in their JSON `meta.anims` (written by
 * tools/art): `{ "<anim>": { fps?, durations?: number[] (ms per frame), stride?, loop? } }`.
 * `stride` is the ground distance (px) a planted foot travels per frame of a locomotion
 * cycle; while such an anim plays, `playAnim` scales its playback to the sprite's real
 * horizontal speed so feet stay planted (no skating / moonwalking).
 */

/** Frame rates per animation name (fallback DEFAULT_FPS). */
const FPS: Record<string, number> = {
  idle: 6, walk: 14, run: 16, jump: 8, fall: 8, land: 14, crouch: 10, attack: 16, hurt: 10,
  victory: 8, defeat: 8, ability: 14, move: 10, hit: 12, die: 10, coin: 10, star: 8, question: 6,
  dust: 18, spark: 20, explosion_small: 18, explosion_large: 16, smoke: 10, coin_burst: 20, poof: 16,
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

/** Playback-rate limits for stride-synced locomotion. */
export const STRIDE_SCALE_MIN = 0.55;
export const STRIDE_SCALE_MAX = 2.0;

export interface AtlasAnimMeta {
  fps?: number;
  durations?: number[];
  stride?: number;
  /** Override the default loop / play-once behaviour for this atlas. */
  loop?: boolean;
}

/** Ground speed (px/s) at which an anim with this stride plays at its nominal rate. */
const strideSpeed = new Map<string, number>();

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

/** Playback time scale that keeps a stride-`stride` cycle at `fps` in step with `speed` px/s. Exported for tests. */
export function strideTimeScale(speed: number, stride: number, fps: number): number {
  if (!(stride > 0) || !(fps > 0)) return 1;
  const s = Math.abs(speed) / (stride * fps);
  return Math.min(STRIDE_SCALE_MAX, Math.max(STRIDE_SCALE_MIN, s));
}

function atlasMeta(tex: Phaser.Textures.Texture): Record<string, AtlasAnimMeta> {
  const meta = (tex.customData as { meta?: { anims?: Record<string, AtlasAnimMeta> } } | undefined)?.meta;
  return meta?.anims ?? {};
}

export function registerAtlasAnimations(scene: Phaser.Scene, atlasKey: string): void {
  const tex = scene.textures.get(atlasKey);
  if (!tex || tex.key === '__MISSING') return;
  const groups = groupFrames(tex.getFrameNames());
  const meta = atlasMeta(tex);
  for (const [anim, frames] of Object.entries(groups)) {
    const key = animKey(atlasKey, anim);
    if (scene.anims.exists(key)) continue;
    const m = meta[anim] ?? {};
    const once = m.loop !== undefined ? !m.loop : ONCE.has(anim) || HOLD_LAST.has(anim);
    const frameRate = m.fps ?? FPS[anim] ?? DEFAULT_FPS;
    scene.anims.create({
      key,
      frames: frames.map((frame, i) => {
        const duration = m.durations?.[i];
        return duration ? { key: atlasKey, frame, duration } : { key: atlasKey, frame };
      }),
      frameRate,
      repeat: once ? 0 : -1,
    });
    if (m.stride) strideSpeed.set(key, m.stride * frameRate);
    else strideSpeed.delete(key);
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
  // Stride sync: locomotion cycles follow the real ground speed; everything else plays at 1x.
  const nominal = strideSpeed.get(key);
  const body = sprite.body as Phaser.Physics.Arcade.Body | null;
  sprite.anims.timeScale = nominal && body ? strideTimeScale(body.velocity.x, nominal, 1) : 1;
}

export function hasAnim(scene: Phaser.Scene, atlas: string, anim: string): boolean {
  return scene.anims.exists(animKey(atlas, anim));
}
