import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { createMenu, type MenuItem } from '../ui/Menus';
import { saveSystem, type Settings } from '../systems/SaveSystem';
import { audio } from '../systems/AudioSystem';
import { px } from '../ui/PixelFont';
import { Skyline } from '../ui/Skyline';
import { COLORS, drawPanel, panel } from '../ui/Widgets';
import { transitionIn, transitionTo } from '../ui/Transitions';
import { cycle, stepVolume, volumeBar } from '../ui/format';

/**
 * Settings screen. From the main menu it is a full screen; from the pause menu it is an
 * overlay on top of the (paused) Pause scene, which it resumes on close.
 */
export class SettingsScene extends Phaser.Scene {
  private from: 'Menu' | 'Pause' = 'Menu';
  private sky?: Skyline;
  private eraseArmed = false;

  constructor() {
    super('Settings');
  }

  init(data: { from?: 'Menu' | 'Pause' }): void {
    this.from = data.from ?? 'Menu';
    this.eraseArmed = false;
    this.sky = undefined;
  }

  create(): void {
    const overlay = this.from === 'Pause';
    if (overlay) this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.6).setOrigin(0);
    else {
      this.sky = new Skyline(this, { train: false });
      this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.35).setOrigin(0);
    }
    const box = panel(this, GAME_WIDTH / 2 - 130, 24, 260, 222);
    px(this, GAME_WIDTH / 2, 42, 'SETTINGS', { scale: 2, color: COLORS.gold });

    const s = () => saveSystem.get().settings;
    const change = (fn: (st: Settings) => void) => {
      saveSystem.update((d) => fn(d.settings));
      audio.applySettings();
    };
    const onOff = (b: boolean) => (b ? 'ON' : 'OFF');
    const items: MenuItem[] = [
      {
        label: 'MUSIC', value: () => volumeBar(s().musicVolume),
        onAdjust: (d) => change((st) => (st.musicVolume = stepVolume(st.musicVolume, d))),
      },
      {
        label: 'SOUND FX', value: () => volumeBar(s().sfxVolume),
        onAdjust: (d) => {
          change((st) => (st.sfxVolume = stepVolume(st.sfxVolume, d)));
          audio.sfx('coin');
        },
      },
      { label: 'MUTE ALL', value: () => onOff(s().muted), onSelect: () => change((st) => (st.muted = !st.muted)), onAdjust: () => change((st) => (st.muted = !st.muted)) },
      {
        label: 'REDUCED MOTION', value: () => onOff(s().reducedMotion),
        onSelect: () => change((st) => (st.reducedMotion = !st.reducedMotion)), onAdjust: () => change((st) => (st.reducedMotion = !st.reducedMotion)),
      },
      {
        label: 'TOUCH CONTROLS', value: () => s().showTouchControls.toUpperCase(),
        onSelect: () => change((st) => (st.showTouchControls = cycle(['auto', 'on', 'off'] as const, st.showTouchControls))),
        onAdjust: (d) => change((st) => (st.showTouchControls = cycle(['auto', 'on', 'off'] as const, st.showTouchControls, d))),
      },
    ];
    if (!overlay) {
      items.push({
        label: 'ERASE SAVE DATA',
        value: () => (this.eraseArmed ? 'SURE?' : ''),
        sound: 'menu-back',
        onSelect: () => {
          if (!this.eraseArmed) {
            this.eraseArmed = true;
            menu.refresh();
            return;
          }
          saveSystem.reset();
          this.eraseArmed = false;
          audio.sfx('break');
          menu.refresh();
          toast.setText('SAVE ERASED').setAlpha(1);
          this.tweens.add({ targets: toast, alpha: 0, delay: 1200, duration: 400 });
        },
      });
    }
    items.push({ label: 'BACK', onSelect: () => this.close(), sound: 'menu-back' });
    box.clear();
    drawPanel(box, GAME_WIDTH / 2 - 130, 24, 260, 58 + items.length * 20 + (overlay ? 0 : 14));
    const menu = createMenu(this, items, GAME_WIDTH / 2, 74, 20, { width: 232, onBack: () => this.close() });
    const toast = px(this, GAME_WIDTH / 2, 234, '', { color: COLORS.red }).setAlpha(0);
    px(this, GAME_WIDTH / 2, GAME_HEIGHT - 10, '◀ ▶ ADJUST · ENTER TOGGLE · ESC BACK', { color: COLORS.sub });
    if (!overlay) transitionIn(this);
  }

  private close(): void {
    if (this.from === 'Pause') {
      this.scene.resume('Pause');
      this.scene.stop();
    } else transitionTo(this, 'Menu');
  }

  update(_t: number, delta: number): void {
    this.sky?.update(delta);
  }
}
