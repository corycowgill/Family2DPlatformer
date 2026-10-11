import Phaser from 'phaser';
import { EMPTY_INPUT, type InputState } from '../types';
import {
  EMPTY_RAW,
  KEY_BINDINGS,
  KEY_BINDINGS_P2,
  KEY_P2_JOIN,
  KEY_P2_LEAVE,
  P2_KEY_NAMES,
  heldEdges,
  keysToRaw,
  mergeRaw,
  toInputState,
  type EdgeMemory,
  type RawButtons,
} from './InputMapping';
import { gamepads } from './Gamepads';

export { edge } from './InputMapping';

/**
 * Virtual buttons written by on-screen touch controls (and by the automated test bot).
 * Held state only — edge detection ("pressed this frame") is done by InputSystem.
 */
export type VirtualButtons = RawButtons;

export const virtualButtons: VirtualButtons = { ...EMPTY_RAW };

export function clearVirtualButtons(): void {
  for (const k of Object.keys(virtualButtons) as (keyof VirtualButtons)[]) virtualButtons[k] = false;
}

/**
 * Where a player's input comes from (local co-op).
 *  - primary: Player 1 — keyboard (minus the P2 key set while it's claimed), the most recently
 *    used pad not owned by Player 2, and touch.
 *  - keys2:   Player 2 on the keyboard's right-hand set (IJKL / U / O / H).
 *  - pad:     Player 2 on one specific controller.
 */
export type InputSource = ({ kind: 'primary' } | { kind: 'keys2' } | { kind: 'pad'; index: number }) & {
  /** Test harness player: reads no physical device (driven only through `override`). */
  harness?: boolean;
};

export const PRIMARY_INPUT: InputSource = { kind: 'primary' };

/** Devices currently owned by Player 2 — Player 1's primary source skips them. */
export const inputClaims = {
  pads: new Set<number>(),
  keys2: false,
  clear(): void {
    this.pads.clear();
    this.keys2 = false;
  },
  claim(src: InputSource): void {
    if (src.harness) return;
    if (src.kind === 'pad') this.pads.add(src.index);
    if (src.kind === 'keys2') this.keys2 = true;
  },
};

/**
 * Merges keyboard (WASD/arrows, Space/Z/K jump, Shift run, J/X attack, Esc/P pause),
 * gamepad (the most recently used pad — stick/d-pad move, A jump, X/B ability, RT/LT/RB/LB
 * run, Menu/View pause; see InputMapping.ts / Gamepads.ts) and touch into one InputState
 * per frame.
 */
export class InputSystem {
  private keys = new Map<string, Phaser.Input.Keyboard.Key>();
  private prev: EdgeMemory = { jump: false, attack: false, pause: false };
  private state: InputState = { ...EMPTY_INPUT };
  /** When set (by tests/bot), replaces all physical input. */
  override: Partial<VirtualButtons> | null = null;

  constructor(
    scene: Phaser.Scene,
    readonly source: InputSource = PRIMARY_INPUT,
  ) {
    const kb = scene.input.keyboard;
    if (kb) {
      const names = new Set(Object.values(KEY_BINDINGS).flat());
      // P2 keys (join / play / leave) are watched without capture so typing elsewhere is unaffected.
      const watch = new Set([...P2_KEY_NAMES, KEY_P2_JOIN, KEY_P2_LEAVE]);
      for (const name of watch) {
        if (names.has(name)) continue;
        const code = Phaser.Input.Keyboard.KeyCodes[name as keyof typeof Phaser.Input.Keyboard.KeyCodes];
        if (code !== undefined) this.keys.set(name, kb.addKey(code, false));
      }
      for (const name of names) {
        const code = Phaser.Input.Keyboard.KeyCodes[name as keyof typeof Phaser.Input.Keyboard.KeyCodes];
        // enableCapture=true so the page doesn't scroll on arrows/space.
        if (code !== undefined) this.keys.set(name, kb.addKey(code, true));
      }
    }
  }

  /** Call once per frame (before player update). */
  update(): InputState {
    let raw: RawButtons;
    if (this.override) {
      const o = this.override;
      raw = { ...EMPTY_RAW };
      for (const k of Object.keys(raw) as (keyof RawButtons)[]) raw[k] = !!o[k];
    } else {
      raw = this.physical();
    }
    return toInputState(raw, this.prev, this.state);
  }

  private physical(): RawButtons {
    const down = (name: string) => this.keys.get(name)?.isDown ?? false;
    const src = this.source;
    if (src.harness) return { ...EMPTY_RAW };
    if (src.kind === 'keys2') return keysToRaw(down, null, KEY_BINDINGS_P2);
    if (src.kind === 'pad') return gamepads.rawFor(src.index);
    // Player 1. With no co-op claims this is exactly keyboard + active pad + touch.
    const kb = keysToRaw(down, inputClaims.keys2 ? P2_KEY_NAMES : null);
    return mergeRaw(kb, gamepads.rawExcept(inputClaims.pads), virtualButtons);
  }

  /** Is a keyboard key (KeyCodes name) held? Only keys this system watches. */
  keyDown(name: string): boolean {
    return this.keys.get(name)?.isDown ?? false;
  }

  get current(): InputState {
    return this.state;
  }

  /** Swallow held buttons so e.g. a menu "jump" doesn't trigger an in-game jump. */
  resetEdges(): void {
    this.prev = heldEdges();
  }
}
