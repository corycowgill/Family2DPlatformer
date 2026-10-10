/**
 * CONTRACT (tech lead): which input device the player is currently using.
 * Drives on-screen button prompts (keyboard keys vs Xbox glyphs) and whether touch
 * controls are shown. Pure module — no Phaser.
 *
 *  - keyboard: set by any keydown (main.ts)
 *  - touch:    set by any touchstart (main.ts)
 *  - gamepad:  set by any gamepad button press / stick movement (gamepad layer)
 */
export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

type Listener = (device: InputDevice) => void;

const listeners = new Set<Listener>();

function initialDevice(): InputDevice {
  if (typeof window === 'undefined') return 'keyboard';
  const touch = 'ontouchstart' in window || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
  // A coarse primary pointer (phones/tablets) means touch first; touch laptops stay keyboard.
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return touch && coarse ? 'touch' : 'keyboard';
}

let current: InputDevice = initialDevice();

export function getInputDevice(): InputDevice {
  return current;
}

export function setInputDevice(device: InputDevice): void {
  if (device === current) return;
  current = device;
  for (const l of [...listeners]) l(device);
}

/** Subscribe to device changes; returns an unsubscribe function. */
export function onInputDeviceChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Game-level event any system may emit to pause a running level (app backgrounded, pad disconnected…). */
export const REQUEST_PAUSE = 'request-pause';
