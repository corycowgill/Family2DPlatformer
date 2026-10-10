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
 * Xbox / W3C "standard" gamepad layout (buttons are indices into `Gamepad.buttons`):
 *   0 A · 1 B · 2 X · 3 Y · 4 LB · 5 RB · 6 LT · 7 RT · 8 View · 9 Menu · 10 LS · 11 RS
 *   12-15 d-pad up/down/left/right · 16 Xbox (guide, normally captured by the OS)
 */
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16,
} as const;
export const PAD_BUTTON_COUNT = 17;

/**
 * Gameplay mapping. A jumps; X (and B) use the hero's ability/attack — X sits where the
 * keyboard's X/J ability key does; run is a separate hold on any shoulder (RT/LT/RB/LB) so
 * jump + run + ability can all be pressed together (index finger on RT, thumb rolls A↔X).
 * Menu and View both pause. Y is left free in play (world map: change hero).
 */
export const PAD_BUTTONS = {
  jump: [PAD.A],
  attack: [PAD.X, PAD.B],
  run: [PAD.RT, PAD.LT, PAD.RB, PAD.LB],
  pause: [PAD.MENU, PAD.VIEW],
  up: [PAD.UP],
  down: [PAD.DOWN],
  left: [PAD.LEFT],
  right: [PAD.RIGHT],
} as const;

/** Radial dead zone of the left stick (fraction of full deflection). */
export const STICK_DEADZONE = 0.25;
/** Analog buttons (LT/RT) count as pressed above this value. */
export const TRIGGER_THRESHOLD = 0.3;
/** Stick-down only crouches within this angle (degrees) of straight down. */
export const CROUCH_MAX_ANGLE = 30;
/** Stick-up only counts within this angle of straight up. */
export const UP_MAX_ANGLE = 40;
/** Left/right needs the stick at least this far (degrees) from vertical. */
export const HORIZONTAL_MIN_ANGLE = 22.5;

/** Value (0..1) of a pad button given as boolean or analog value. */
export const buttonValue = (b: boolean | number | undefined): number => (b === true ? 1 : typeof b === 'number' ? b : 0);
/** Whether a button counts as held (analog triggers above TRIGGER_THRESHOLD). */
export const isHeld = (b: boolean | number | undefined): boolean => buttonValue(b) > TRIGGER_THRESHOLD;

/**
 * Radial dead zone: returns the stick rescaled so the dead zone edge is 0 and full
 * deflection is 1 (direction preserved), or {0,0} inside the dead zone.
 */
export function radialDeadzone(x: number, y: number, dead = STICK_DEADZONE): { x: number; y: number; mag: number } {
  const m = Math.hypot(x, y);
  if (!(m > dead)) return { x: 0, y: 0, mag: 0 };
  const mag = Math.min(1, (m - dead) / (1 - dead));
  return { x: (x / m) * mag, y: (y / m) * mag, mag };
}

/**
 * Digital directions from the left stick: radial dead zone, then angle thresholds — so a
 * diagonal-ish push while running right never reads as "down" (crouch), and a clear
 * downward push doesn't steer sideways from noise.
 */
export function stickToDirs(x: number, y: number, dead = STICK_DEADZONE): { left: boolean; right: boolean; up: boolean; down: boolean } {
  const s = radialDeadzone(x, y, dead);
  if (s.mag === 0) return { left: false, right: false, up: false, down: false };
  // Angle from the vertical axis (0 = straight up/down, 90 = horizontal).
  const fromVertical = (Math.atan2(Math.abs(s.x), Math.abs(s.y)) * 180) / Math.PI;
  const horizontal = fromVertical >= HORIZONTAL_MIN_ANGLE;
  return {
    left: horizontal && s.x < 0,
    right: horizontal && s.x > 0,
    up: s.y < 0 && fromVertical <= UP_MAX_ANGLE,
    down: s.y > 0 && fromVertical <= CROUCH_MAX_ANGLE,
  };
}

/**
 * Decode one gamepad (standard-mapping button list, booleans or analog values) and its
 * left stick into logical buttons.
 */
export function padToRaw(buttons: readonly (boolean | number)[], stickX: number, stickY: number): RawButtons {
  const any = (ids: readonly number[]) => ids.some((i) => isHeld(buttons[i]));
  const st = stickToDirs(stickX, stickY);
  return {
    left: any(PAD_BUTTONS.left) || st.left,
    right: any(PAD_BUTTONS.right) || st.right,
    up: any(PAD_BUTTONS.up) || st.up,
    down: any(PAD_BUTTONS.down) || st.down,
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

/** Edge memory that treats every edge button as already held (InputSystem.resetEdges). */
export function heldEdges(): EdgeMemory {
  return { jump: true, attack: true, pause: true };
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
