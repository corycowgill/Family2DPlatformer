import { EMPTY_INPUT, type InputState } from '../types';

/**
 * Pure input mapping (no Phaser) — bindings, gamepad decoding and edge detection.
 * InputSystem gathers raw device state and feeds it through here; kept pure so the
 * mapping is unit-testable.
 */

/** Held state of every logical button, merged from all devices. */
export interface RawButtons {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jump: boolean;
  run: boolean;
  attack: boolean;
  pause: boolean;
}

export const EMPTY_RAW: Readonly<RawButtons> = {
  left: false, right: false, up: false, down: false, jump: false, run: false, attack: false, pause: false,
};

/** Keyboard bindings by Phaser KeyCodes name. First entry is the documented primary key. */
export const KEY_BINDINGS: Record<keyof RawButtons, readonly string[]> = {
  left: ['A', 'LEFT'],
  right: ['D', 'RIGHT'],
  up: ['W', 'UP'],
  down: ['S', 'DOWN'],
  jump: ['SPACE', 'Z', 'K'],
  run: ['SHIFT'],
  attack: ['J', 'X'],
  pause: ['ESC', 'P'],
};

/**
 * Standard-mapping gamepad buttons (W3C "standard" layout):
 * 0 south (A/Cross) = jump, 2 west (X/Square) = attack, 1 east (B/Circle) = attack too,
 * 4/5 bumpers + 6/7 triggers = run, 9 start = pause, 12-15 d-pad.
 */
export const PAD_BUTTONS = {
  jump: [0],
  attack: [2, 1],
  run: [4, 5, 6, 7],
  pause: [9],
  up: [12],
  down: [13],
  left: [14],
  right: [15],
} as const;

export const STICK_DEADZONE = 0.35;

/** Decode one gamepad's pressed-button list and left stick into logical buttons. */
export function padToRaw(pressed: readonly boolean[], stickX: number, stickY: number): RawButtons {
  const any = (ids: readonly number[]) => ids.some((i) => pressed[i] === true);
  return {
    left: any(PAD_BUTTONS.left) || stickX < -STICK_DEADZONE,
    right: any(PAD_BUTTONS.right) || stickX > STICK_DEADZONE,
    up: any(PAD_BUTTONS.up) || stickY < -STICK_DEADZONE,
    down: any(PAD_BUTTONS.down) || stickY > STICK_DEADZONE,
    jump: any(PAD_BUTTONS.jump),
    run: any(PAD_BUTTONS.run),
    attack: any(PAD_BUTTONS.attack),
    pause: any(PAD_BUTTONS.pause),
  };
}

/** Decode the keyboard: `isDown(name)` answers for a KeyCodes name. */
export function keysToRaw(isDown: (key: string) => boolean): RawButtons {
  const out = { ...EMPTY_RAW };
  for (const k of Object.keys(KEY_BINDINGS) as (keyof RawButtons)[]) out[k] = KEY_BINDINGS[k].some(isDown);
  return out;
}

/** OR together several devices. */
export function mergeRaw(...sources: readonly RawButtons[]): RawButtons {
  const out = { ...EMPTY_RAW };
  for (const s of sources) for (const k of Object.keys(out) as (keyof RawButtons)[]) out[k] = out[k] || s[k];
  return out;
}

/** Edge-detect helper — true only on the frame the button goes down. */
export function edge(prev: boolean, now: boolean): boolean {
  return now && !prev;
}

export interface EdgeMemory {
  jump: boolean;
  attack: boolean;
  pause: boolean;
}

/**
 * Turn merged held buttons into the per-frame InputState (opposing directions cancel,
 * `*Pressed` true only on the first frame). Updates `prev` in place.
 */
export function toInputState(raw: RawButtons, prev: EdgeMemory, out: InputState = { ...EMPTY_INPUT }): InputState {
  out.left = raw.left && !raw.right;
  out.right = raw.right && !raw.left;
  out.up = raw.up;
  out.down = raw.down;
  out.jump = raw.jump;
  out.jumpPressed = edge(prev.jump, raw.jump);
  out.run = raw.run;
  out.attack = raw.attack;
  out.attackPressed = edge(prev.attack, raw.attack);
  out.pausePressed = edge(prev.pause, raw.pause);
  prev.jump = raw.jump;
  prev.attack = raw.attack;
  prev.pause = raw.pause;
  return out;
}
