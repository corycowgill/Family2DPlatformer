import Phaser from 'phaser';
import { EMPTY_INPUT, type InputState } from '../types';
import { EMPTY_RAW, KEY_BINDINGS, heldEdges, keysToRaw, mergeRaw, toInputState, type EdgeMemory, type RawButtons } from './InputMapping';
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

  constructor(scene: Phaser.Scene) {
    const kb = scene.input.keyboard;
    if (kb) {
      const names = new Set(Object.values(KEY_BINDINGS).flat());
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
      const kb = keysToRaw((name) => this.keys.get(name)?.isDown ?? false);
      raw = mergeRaw(kb, gamepads.raw(), virtualButtons);
    }
    return toInputState(raw, this.prev, this.state);
  }

  get current(): InputState {
    return this.state;
  }

  /** Swallow held buttons so e.g. a menu "jump" doesn't trigger an in-game jump. */
  resetEdges(): void {
    this.prev = heldEdges();
  }
}
