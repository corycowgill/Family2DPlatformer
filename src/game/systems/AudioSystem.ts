import Phaser from 'phaser';
import { saveSystem } from './SaveSystem';
import { ensureMusic } from './AudioAssets';
import { SFX_DETUNE } from './audio/sfxDefs';
import { ONE_SHOT_MUSIC } from './audio/songs';

/** Effective music gain for the given settings (pure — unit tested). */
export function musicGain(s: { muted: boolean; musicVolume: number }, ducked = false): number {
  if (s.muted) return 0;
  return Math.max(0, Math.min(1, s.musicVolume)) * 0.7 * (ducked ? 0.35 : 1);
}

/** Effective sfx gain for the given settings (pure — unit tested). */
export function sfxGain(s: { muted: boolean; sfxVolume: number }, volume = 1): number {
  if (s.muted) return 0;
  return Math.max(0, Math.min(1, s.sfxVolume)) * volume;
}

/**
 * Audio facade. Sound effects and music are synthesised at runtime (see AudioAssets);
 * every caller goes through `audio.sfx(key)` / `audio.music(key)` so implementations
 * can change without touching gameplay code. Unknown keys are silently ignored.
 */
export class AudioSystem {
  private game: Phaser.Game | null = null;
  private currentMusic: Phaser.Sound.BaseSound | null = null;
  private currentMusicKey = '';
  private ducked = false;
  private lastPlayed = new Map<string, number>();

  init(game: Phaser.Game): void {
    this.game = game;
  }

  private get settings() {
    return saveSystem.get().settings;
  }

  /** True once the browser has allowed audio (after the first user gesture). */
  get ready(): boolean {
    const sm = this.game?.sound as Phaser.Sound.BaseSoundManager | undefined;
    if (!sm) return false;
    const ctx = (sm as unknown as { context?: AudioContext }).context;
    if (!ctx) return !sm.locked;
    return ctx.state === 'running';
  }

  sfx(key: string, opts: { volume?: number; detune?: number } = {}): void {
    const g = this.game;
    if (!g) return;
    const vol = sfxGain(this.settings, opts.volume ?? 1);
    if (vol <= 0 || !this.ready) return;
    const ck = `sfx-${key}`;
    if (!g.cache.audio.exists(ck)) return;
    // Rate-limit identical effects fired in the same instant (e.g. 5 coins at once).
    const now = performance.now();
    if (now - (this.lastPlayed.get(key) ?? -1e9) < 35) return;
    this.lastPlayed.set(key, now);
    const spread = SFX_DETUNE[key] ?? 0;
    const detune = opts.detune ?? (spread ? (Math.random() * 2 - 1) * spread : 0);
    try {
      g.sound.play(ck, { volume: vol, detune });
    } catch {
      /* never let audio break gameplay */
    }
  }

  music(key: string): void {
    const g = this.game;
    if (!g) return;
    if (this.currentMusicKey === key && this.currentMusic?.isPlaying) return;
    this.stopMusic();
    this.currentMusicKey = key;
    if (!ensureMusic(g, key)) return;
    const loop = !ONE_SHOT_MUSIC.has(key);
    try {
      this.currentMusic = g.sound.add(`music-${key}`, { loop, volume: musicGain(this.settings, this.ducked) });
      this.currentMusic.play();
    } catch {
      this.currentMusic = null;
    }
  }

  get musicKey(): string {
    return this.currentMusicKey;
  }

  stopMusic(): void {
    this.currentMusic?.stop();
    this.currentMusic?.destroy();
    this.currentMusic = null;
    this.currentMusicKey = '';
  }

  /** Lower the music while a pause/settings overlay is open. */
  duck(on: boolean): void {
    this.ducked = on;
    this.applySettings();
  }

  /** Re-apply volume settings (called by the settings menu). */
  applySettings(): void {
    const m = this.currentMusic as Phaser.Sound.WebAudioSound | null;
    if (m && 'setVolume' in m) m.setVolume(musicGain(this.settings, this.ducked));
  }
}

export const audio = new AudioSystem();
