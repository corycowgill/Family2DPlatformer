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
import { prompt } from '../ui/Prompts';
import { openControls } from '../ui/ControlsScreen';
import { formatSpeed, GAME_SPEEDS } from '../systems/Assist';

/** Settings pages: the main list, plus the Assist mode and Accessibility sub-pages. */
export type SettingsPage = 'main' | 'assist' | 'access';

const TITLES: Record<SettingsPage, string> = { main: 'SETTINGS', assist: 'ASSIST MODE', access: 'ACCESSIBILITY' };
/** One-line explanation under the title of each sub-page. */
const NOTES: Partial<Record<SettingsPage, string>> = {
  assist: 'ASSISTED CLEARS CAN\'T EARN GOLD',
  access: 'NEVER AFFECTS MEDALS',
};

/**
 * Settings screen. From the main menu it is a full screen; from the pause menu it is an
 * overlay on top of the (paused) Pause scene, which it resumes on close. Assist mode and
 * Accessibility are sub-pages (the scene restarts with another `page`).
 */
export class SettingsScene extends Phaser.Scene {
  private from: 'Menu' | 'Pause' = 'Menu';
  private page: SettingsPage = 'main';
  /** Menu row to highlight when coming back to the main page. */
  private startIndex?: number;
  private sky?: Skyline;
  private eraseArmed = false;

  constructor() {
    super('Settings');
  }

  init(data: { from?: 'Menu' | 'Pause'; page?: SettingsPage; startIndex?: number }): void {
    this.from = data.from ?? 'Menu';
    this.page = data.page ?? 'main';
    this.startIndex = data.startIndex;
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
    const box = panel(this, GAME_WIDTH / 2 - 130, 16, 260, 222);
    px(this, GAME_WIDTH / 2, 34, TITLES[this.page], { scale: 2, color: COLORS.gold });
    const note = NOTES[this.page];
    if (note) px(this, GAME_WIDTH / 2, 50, note, { color: COLORS.dim });

    const s = () => saveSystem.get().settings;
    const change = (fn: (st: Settings) => void) => {
      saveSystem.update((d) => fn(d.settings));
      audio.applySettings();
    };
    const onOff = (b: boolean) => (b ? 'ON' : 'OFF');
    /** ON/OFF row toggled by confirm or left/right. */
    const toggle = (label: string, key: { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings]): MenuItem => ({
      label,
      value: () => onOff(s()[key]),
      onSelect: () => change((st) => (st[key] = !st[key])),
      onAdjust: () => change((st) => (st[key] = !st[key])),
    });

    let items: MenuItem[];
    if (this.page === 'assist') {
      items = [
        {
          label: 'GAME SPEED', value: () => formatSpeed(s().gameSpeed),
          onSelect: () => change((st) => (st.gameSpeed = cycle(GAME_SPEEDS, st.gameSpeed))),
          onAdjust: (d) => change((st) => (st.gameSpeed = cycle(GAME_SPEEDS, st.gameSpeed, d))),
        },
        toggle('EXTRA HEARTS (+2)', 'extraHearts'),
        toggle('INFINITE LIVES', 'infiniteLives'),
        toggle('SAFETY NET (PITS)', 'safetyNet'),
        toggle('OFFER BOSS SKIP', 'bossSkip'),
        toggle('AUTO-RUN', 'autoRun'),
      ];
    } else if (this.page === 'access') {
      items = [
        toggle('SCREEN SHAKE', 'screenShake'),
        toggle('REDUCE FLASHING', 'reduceFlashing'),
        toggle('HIGH-CONTRAST OUTLINE', 'highContrast'),
        toggle('REDUCED MOTION', 'reducedMotion'),
      ];
    } else {
      const anyAssist = () => {
        const st = s();
        return st.gameSpeed !== 1 || st.extraHearts || st.infiniteLives || st.safetyNet || st.bossSkip || st.autoRun;
      };
      items = [
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
        toggle('MUTE ALL', 'muted'),
        {
          label: 'EFFECTS', value: () => s().effects.toUpperCase(),
          onSelect: () => change((st) => (st.effects = st.effects === 'high' ? 'low' : 'high')),
          onAdjust: () => change((st) => (st.effects = st.effects === 'high' ? 'low' : 'high')),
        },
        {
          label: 'TOUCH CONTROLS', value: () => s().showTouchControls.toUpperCase(),
          onSelect: () => change((st) => (st.showTouchControls = cycle(['auto', 'on', 'off'] as const, st.showTouchControls))),
          onAdjust: (d) => change((st) => (st.showTouchControls = cycle(['auto', 'on', 'off'] as const, st.showTouchControls, d))),
        },
        toggle('VIBRATION', 'rumble'),
        { label: 'ASSIST MODE', value: () => (anyAssist() ? 'ON ▶' : '▶'), onSelect: () => this.goto('assist') },
        { label: 'ACCESSIBILITY', value: () => '▶', onSelect: () => this.goto('access') },
        { label: 'CONTROLS', value: () => '▶', onSelect: () => openControls(this) },
      ];
    }
    if (!overlay && this.page === 'main') {
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
    const sp = this.page === 'main' ? 16 : 18; // the main page has 11 rows
    const top = note ? 70 : 62;
    box.clear();
    drawPanel(box, GAME_WIDTH / 2 - 130, 16, 260, top - 10 + items.length * sp + (overlay || this.page !== 'main' ? 0 : 12));
    const menu = createMenu(this, items, GAME_WIDTH / 2, top, sp, { width: 232, onBack: () => this.close(), startIndex: this.startIndex });
    const toast = px(this, GAME_WIDTH / 2, top + items.length * sp - 4, '', { color: COLORS.red }).setAlpha(0);
    prompt(this, GAME_WIDTH / 2, GAME_HEIGHT - 10, (d) => (d === 'touch' ? 'TAP ◀ ▶ TO ADJUST' : '{ADJUST} ADJUST  {CONFIRM} TOGGLE  {BACK} BACK'), { color: COLORS.sub });
    if (!overlay && this.page === 'main' && this.startIndex === undefined) transitionIn(this);
  }

  /** Open a sub-page (same scene, restarted). */
  private goto(page: SettingsPage): void {
    this.scene.restart({ from: this.from, page });
  }

  private close(): void {
    if (this.page !== 'main') {
      // Back from a sub-page lands on its row of the main page.
      this.scene.restart({ from: this.from, page: 'main', startIndex: this.page === 'assist' ? 6 : 7 });
      return;
    }
    if (this.from === 'Pause') {
      this.scene.resume('Pause');
      this.scene.stop();
    } else transitionTo(this, 'Menu');
  }

  update(_t: number, delta: number): void {
    this.sky?.update(delta);
  }
}
