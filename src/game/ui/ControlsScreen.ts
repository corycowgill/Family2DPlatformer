import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { audio } from '../systems/AudioSystem';
import { onNav } from './NavInput';
import { px, setPx } from './PixelFont';
import { gamepads } from '../systems/Gamepads';
import { prompt } from './Prompts';
import { COLORS, panel } from './Widgets';

/** Rows of the controls reference: [action, keyboard glyphs, controller glyphs]. */
export const CONTROL_ROWS: [string, string, string][] = [
  ['MOVE', '{key:◀▲▼▶} {key:WASD}', '{pad:LS} {pad:DPAD}'],
  ['JUMP', '{key:SPACE} {key:Z}', '{pad:A}'],
  ['RUN (HOLD)', '{key:SHIFT}', '{pad:RT} {pad:LT} {pad:RB} {pad:LB}'],
  ['ABILITY', '{key:J} {key:X}', '{pad:X} {pad:B}'],
  ['CROUCH / DROP', '{key:▼} {key:S}', '{pad:LS} {pad:DPAD} DOWN'],
  ['PAUSE', '{key:ESC} {key:P}', '{pad:MENU} {pad:VIEW}'],
  ['MENUS', '{key:ENTER} {key:ESC}', '{pad:A} OK {pad:B} BACK'],
];

const KEY = 'Controls';
const registered = new WeakSet<Phaser.Game>();

/**
 * Controls reference overlay (keyboard and Xbox controller side by side). Opened from
 * Settings; pauses the caller and resumes it on close. Registered on first use, so it
 * needs no entry in the game config.
 */
export class ControlsScene extends Phaser.Scene {
  private from = '';
  private closing = false;

  constructor() {
    super(KEY);
  }

  init(data: { from: string }): void {
    this.from = data.from;
    this.closing = false;
  }

  create(): void {
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.75).setOrigin(0);
    const x0 = 28;
    const w = GAME_WIDTH - x0 * 2;
    panel(this, x0, 16, w, 236);
    px(this, GAME_WIDTH / 2, 32, 'CONTROLS', { scale: 2, color: COLORS.gold });
    const colA = x0 + 14;
    const colK = x0 + 124;
    const colP = x0 + 244;
    px(this, colK, 52, 'KEYBOARD', { origin: [0, 0.5], color: COLORS.dim });
    px(this, colP, 52, 'XBOX CONTROLLER', { origin: [0, 0.5], color: COLORS.dim });
    CONTROL_ROWS.forEach(([label, kb, pad], i) => {
      const y = 70 + i * 21;
      if (i % 2 === 0) this.add.rectangle(x0 + 6, y - 10, w - 12, 20, 0xffffff, 0.04).setOrigin(0);
      px(this, colA, y - 3, label, { origin: [0, 0], color: COLORS.text });
      prompt(this, colK, y, kb, { origin: [0, 0.5], color: COLORS.sub });
      prompt(this, colP, y, pad, { origin: [0, 0.5], color: COLORS.sub });
    });
    px(this, GAME_WIDTH / 2, 216, 'TOUCH: ON-SCREEN BUTTONS · RUN TOGGLES', { color: COLORS.dim });
    // Browsers only reveal a pad after one of its buttons is pressed — say so, quietly.
    const status = px(this, GAME_WIDTH / 2, 228, '', { color: COLORS.dim });
    const showStatus = () => {
      const n = gamepads.count;
      setPx(status, n > 0 ? `CONTROLLER CONNECTED${n > 1 ? ` (${n})` : ''}` : 'CONTROLLER NOT FOUND? PRESS ANY BUTTON ON IT');
      status.setTint(n > 0 ? COLORS.green : COLORS.dim);
    };
    showStatus();
    this.events.on(Phaser.Scenes.Events.UPDATE, showStatus);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.UPDATE, showStatus));
    prompt(this, GAME_WIDTH / 2, 242, (d) => (d === 'touch' ? 'TAP TO CLOSE' : '{BACK} BACK'), { color: COLORS.sub });
    onNav(this, (a) => {
      if (a === 'back' || a === 'confirm' || a === 'start') this.close();
    });
    this.input.on('pointerup', () => this.close());
  }

  private close(): void {
    if (this.closing) return;
    this.closing = true;
    audio.sfx('menu-back');
    this.scene.resume(this.from);
    this.scene.stop();
  }
}

/** Open the controls overlay above `scene` (which is paused until it closes). */
export function openControls(scene: Phaser.Scene): void {
  const sm = scene.scene;
  const data = { from: scene.scene.key };
  if (!registered.has(scene.game)) {
    // Added on first use (no game-config entry). An add made during a scene update is
    // queued, so let the manager auto-start it with the data rather than launching here.
    registered.add(scene.game);
    scene.game.scene.add(KEY, ControlsScene, true, data);
  } else {
    sm.launch(KEY, data);
    sm.bringToTop(KEY);
  }
  sm.pause();
}
