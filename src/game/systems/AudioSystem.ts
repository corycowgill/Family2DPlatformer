import Phaser from 'phaser';
import { saveSystem } from './SaveSystem';

/**
 * Audio facade. Sound effects and music are synthesised/loaded by the Audio team;
 * every caller goes through `audio.sfx(key)` / `audio.music(key)` so implementations
 * can change without touching gameplay code. Unknown keys are silently ignored.
 */
export class AudioSystem {
  private game: Phaser.Game | null = null;
  private currentMusic: Phaser.Sound.BaseSound | null = null;
  private currentMusicKey = '';

  init(game: Phaser.Game): void {
    this.game = game;
  }

  private get settings() {
    return saveSystem.get().settings;
  }

  sfx(key: string): void {
    const g = this.game;
    if (!g || this.settings.muted) return;
    if (!g.cache.audio.exists(`sfx-${key}`)) return;
    g.sound.play(`sfx-${key}`, { volume: this.settings.sfxVolume });
  }

  music(key: string): void {
    const g = this.game;
    if (!g) return;
    if (this.currentMusicKey === key && this.currentMusic?.isPlaying) return;
    this.stopMusic();
    this.currentMusicKey = key;
    if (!g.cache.audio.exists(`music-${key}`)) return;
    this.currentMusic = g.sound.add(`music-${key}`, { loop: true, volume: this.settings.muted ? 0 : this.settings.musicVolume });
    this.currentMusic.play();
  }

  stopMusic(): void {
    this.currentMusic?.stop();
    this.currentMusic?.destroy();
    this.currentMusic = null;
    this.currentMusicKey = '';
  }

  /** Re-apply volume settings (called by the settings menu). */
  applySettings(): void {
    const m = this.currentMusic as Phaser.Sound.WebAudioSound | null;
    if (m && 'setVolume' in m) m.setVolume(this.settings.muted ? 0 : this.settings.musicVolume);
  }
}

export const audio = new AudioSystem();
