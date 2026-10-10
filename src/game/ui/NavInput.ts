import Phaser from 'phaser';
import { isLeaving } from './Transitions';

export type NavAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';

const KEYS: Record<string, NavAction> = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Enter: 'confirm', NumpadEnter: 'confirm', Space: 'confirm', KeyZ: 'confirm', KeyJ: 'confirm', KeyK: 'confirm',
  Escape: 'back', Backspace: 'back', KeyX: 'back',
};

const PAD_BUTTONS: Record<number, NavAction> = { 12: 'up', 13: 'down', 14: 'left', 15: 'right', 0: 'confirm', 9: 'confirm', 1: 'back', 8: 'back' };

/** Pure: map a gamepad stick position to a direction (or null inside the dead zone). */
export function stickDirection(x: number, y: number, dead = 0.5): NavAction | null {
  if (Math.abs(x) < dead && Math.abs(y) < dead) return null;
  if (Math.abs(x) > Math.abs(y)) return x < 0 ? 'left' : 'right';
  return y < 0 ? 'up' : 'down';
}

/**
 * Unified menu navigation from keyboard and gamepad (d-pad, stick with auto-repeat, A/B/Start).
 * Ignores input while the scene is inactive, transitioning out, or for a short grace period
 * after creation (so the key that opened a screen doesn't also activate it).
 */
export function onNav(scene: Phaser.Scene, cb: (a: NavAction) => void, graceMs = 140): () => void {
  const born = scene.time.now;
  const ok = () => scene.sys.isActive() && !isLeaving(scene) && scene.time.now - born >= graceMs;
  const kb = scene.input.keyboard;
  const onKey = (e: KeyboardEvent) => {
    const a = KEYS[e.code];
    if (!a || !ok()) return;
    if (e.repeat && (a === 'confirm' || a === 'back')) return;
    cb(a);
  };
  kb?.on('keydown', onKey);
  const pad = scene.input.gamepad;
  const onPad = (_p: Phaser.Input.Gamepad.Gamepad, button: Phaser.Input.Gamepad.Button) => {
    const a = PAD_BUTTONS[button.index];
    if (a && ok()) cb(a);
  };
  pad?.on('down', onPad);
  let stickDir: NavAction | null = null;
  let nextRepeat = 0;
  const onUpdate = (time: number) => {
    if (!pad || pad.total === 0) return;
    const p = pad.getPad(0) ?? pad.gamepads.find((g) => g && g.connected);
    if (!p) return;
    const d = stickDirection(p.leftStick.x, p.leftStick.y);
    if (d !== stickDir) {
      stickDir = d;
      if (d && ok()) cb(d);
      nextRepeat = time + 380;
    } else if (d && time >= nextRepeat) {
      if (ok()) cb(d);
      nextRepeat = time + 140;
    }
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  const off = () => {
    kb?.off('keydown', onKey);
    pad?.off('down', onPad);
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
  return off;
}
