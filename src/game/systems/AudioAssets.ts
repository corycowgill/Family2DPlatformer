import Phaser from 'phaser';
import { renderSfx, renderSong } from './audio/synth';
import { SFX_DEFS } from './audio/sfxDefs';
import { SONGS } from './audio/songs';

/**
 * Procedural audio glue: renders the synth's PCM into WebAudio AudioBuffers and adds them
 * to Phaser's audio cache as `sfx-<key>` / `music-<key>`, which WebAudioSoundManager plays
 * like any loaded file. Music is rendered lazily (first request) or in idle warm-up time.
 */

const SFX_RATE = 32000;
const MUSIC_RATE = 32000;

/** Queue audio files for loading — everything is synthesised, so nothing to queue. */
export function registerAudio(_scene: Phaser.Scene): void {
  /* procedural */
}

function audioContext(game: Phaser.Game): BaseAudioContext | null {
  const sm = game.sound as Phaser.Sound.WebAudioSoundManager;
  return sm && 'context' in sm && sm.context ? sm.context : null;
}

function addBuffer(game: Phaser.Game, key: string, pcm: Float32Array, rate: number): boolean {
  const ctx = audioContext(game);
  if (!ctx) return false;
  try {
    const buf = ctx.createBuffer(1, pcm.length, rate);
    buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
    game.cache.audio.add(key, buf);
    return true;
  } catch (e) {
    console.warn(`Audio buffer ${key} failed`, e);
    return false;
  }
}

/** Synthesise all sound effects plus the victory jingle (as `sfx-victory`). ~100ms. */
export function buildSfx(game: Phaser.Game): void {
  if (!audioContext(game)) return;
  for (const [key, def] of Object.entries(SFX_DEFS)) {
    const ck = `sfx-${key}`;
    if (!game.cache.audio.exists(ck)) addBuffer(game, ck, renderSfx(def, SFX_RATE), SFX_RATE);
  }
  for (const jingle of ['victory', 'gameover', 'worldclear']) {
    const ck = `sfx-${jingle}`;
    if (!game.cache.audio.exists(ck)) ensureMusic(game, jingle, ck);
  }
}

/** Render a music track on demand. Returns false for unknown keys or when audio is unavailable. */
export function ensureMusic(game: Phaser.Game, key: string, cacheKey = `music-${key}`): boolean {
  if (game.cache.audio.exists(cacheKey)) return true;
  const make = SONGS[key];
  if (!make || !audioContext(game)) return false;
  return addBuffer(game, cacheKey, renderSong(make(), MUSIC_RATE), MUSIC_RATE);
}

/** Render remaining music in the background, one track per tick, so level starts never hitch. */
export function warmMusic(game: Phaser.Game, order: string[] = ['map', 'streets', 'elevated', 'riverwalk', 'boss']): void {
  const queue = order.filter((k) => !game.cache.audio.exists(`music-${k}`));
  const next = () => {
    const k = queue.shift();
    if (!k) return;
    ensureMusic(game, k);
    setTimeout(next, 250);
  };
  setTimeout(next, 600);
}

export const MUSIC_KEYS = Object.keys(SONGS);
