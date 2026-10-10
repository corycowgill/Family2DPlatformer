import Phaser from 'phaser';
import { isLeaving } from './Transitions';
import { gamepads } from '../systems/Gamepads';
import { PAD } from '../systems/InputMapping';

/**
 * Menu actions. `start` = the pad's Menu button (menus treat it as confirm; the pause menu
 * as resume). `alt` = Y (world map: change hero).
 */
export type NavAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'start' | 'alt';

const KEYS: Record<string, NavAction> = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Enter: 'confirm', NumpadEnter: 'confirm', Space: 'confirm', KeyZ: 'confirm', KeyJ: 'confirm', KeyK: 'confirm',
  Escape: 'back', Backspace: 'back', KeyX: 'back',
};

/** Pad face/system buttons → actions (directions come from the d-pad/stick with auto-repeat). */
export const PAD_NAV: Record<number, NavAction> = {
  [PAD.A]: 'confirm',
  [PAD.B]: 'back',
  [PAD.VIEW]: 'back',
  [PAD.MENU]: 'start',
  [PAD.Y]: 'alt',
};

/** Auto-repeat for a held d-pad/stick direction: first repeat after this delay, then every REPEAT_MS. */
export const REPEAT_DELAY_MS = 380;
export const REPEAT_MS = 140;

/** Pure: map a gamepad stick position to a direction (or null inside the radial dead zone). */
export function stickDirection(x: number, y: number, dead = 0.5): NavAction | null {
  if (!(Math.hypot(x, y) >= dead)) return null;
  if (Math.abs(x) > Math.abs(y)) return x < 0 ? 'left' : 'right';
  return y < 0 ? 'up' : 'down';
}

/** Pure: direction held on the pad — d-pad first, then the left stick. */
export function padDirection(buttons: readonly number[], lx: number, ly: number): NavAction | null {
  const on = (i: number) => (buttons[i] ?? 0) > 0.5;
  if (on(PAD.UP)) return 'up';
  if (on(PAD.DOWN)) return 'down';
  if (on(PAD.LEFT)) return 'left';
  if (on(PAD.RIGHT)) return 'right';
  return stickDirection(lx, ly);
}

/**
 * Pure auto-repeat state machine for a held direction: fires on change, then repeats.
 * A direction already held when the screen opens is ignored until it changes.
 */
export class RepeatNav {
  private dir: NavAction | null;
  private next = Infinity;
  constructor(initial: NavAction | null = null) {
    this.dir = initial;
  }
  update(d: NavAction | null, time: number): NavAction | null {
    if (d !== this.dir) {
      this.dir = d;
      this.next = time + REPEAT_DELAY_MS;
      return d;
    }
    if (d && time >= this.next) {
      this.next = time + REPEAT_MS;
      return d;
    }
    return null;
  }
}

export interface NavOptions {
  /** Ignore input for this long after creation / resume (default 140 ms). */
  graceMs?: number;
}

/**
 * Unified menu navigation from keyboard and gamepad (d-pad / stick with auto-repeat, A
 * confirm, B / View back, Menu start, Y alt). Ignores input while the scene is inactive,
 * transitioning out, or for a short grace period after creation or resume (so the button
 * that opened a screen — or closed the one above it — doesn't also activate it).
 * Pad buttons are read in the scene's update (after the per-frame poll), so a press is
 * seen only by scenes running at that moment.
 */
export function onNav(scene: Phaser.Scene, cb: (a: NavAction) => void, opts: NavOptions | number = {}): () => void {
  const graceMs = typeof opts === 'number' ? opts : opts.graceMs ?? 140;
  let born = scene.time.now;
  const ok = () => scene.sys.isActive() && !isLeaving(scene) && scene.time.now - born >= graceMs;
  const onResume = () => (born = scene.time.now);
  scene.events.on(Phaser.Scenes.Events.RESUME, onResume);
  scene.events.on(Phaser.Scenes.Events.WAKE, onResume);
  const kb = scene.input.keyboard;
  const onKey = (e: KeyboardEvent) => {
    const a = KEYS[e.code];
    if (!a || !ok()) return;
    if (e.repeat && (a === 'confirm' || a === 'back')) return;
    cb(a);
  };
  kb?.on('keydown', onKey);
  const pad0 = gamepads.active;
  const rep = new RepeatNav(pad0 ? padDirection(pad0.buttons, pad0.lx, pad0.ly) : null);
  const onUpdate = (time: number) => {
    const p = gamepads.active;
    const d = rep.update(p ? padDirection(p.buttons, p.lx, p.ly) : null, time);
    if (!ok()) return;
    if (d) cb(d);
    for (const [btn, a] of Object.entries(PAD_NAV)) {
      if (!ok()) break; // a previous action closed / left the screen
      if (gamepads.wasPressed(Number(btn))) cb(a);
    }
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  const off = () => {
    kb?.off('keydown', onKey);
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    scene.events.off(Phaser.Scenes.Events.RESUME, onResume);
    scene.events.off(Phaser.Scenes.Events.WAKE, onResume);
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
  return off;
}
