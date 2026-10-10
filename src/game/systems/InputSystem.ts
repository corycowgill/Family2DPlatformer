import Phaser from 'phaser';
import { EMPTY_INPUT, type InputState } from '../types';

/**
 * Virtual buttons written by on-screen touch controls (and by the automated test bot).
 * Held state only — edge detection ("pressed this frame") is done by InputSystem.
 */
export interface VirtualButtons {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jump: boolean;
  run: boolean;
  attack: boolean;
  pause: boolean;
}

export const virtualButtons: VirtualButtons = {
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  run: false,
  attack: false,
  pause: false,
};

export function clearVirtualButtons(): void {
  for (const k of Object.keys(virtualButtons) as (keyof VirtualButtons)[]) virtualButtons[k] = false;
}

/** Edge-detect helper, pure — exported for tests. */
export function edge(prev: boolean, now: boolean): boolean {
  return now && !prev;
}

const STICK_DEADZONE = 0.35;

export class InputSystem {
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private prev = { jump: false, attack: false, pause: false };
  private state: InputState = { ...EMPTY_INPUT };
  /** When set (by tests/bot), replaces all physical input. */
  override: Partial<VirtualButtons> | null = null;

  constructor(private scene: Phaser.Scene) {
    const kb = scene.input.keyboard;
    if (kb) {
      const K = Phaser.Input.Keyboard.KeyCodes;
      const map: Record<string, number> = {
        left: K.LEFT, right: K.RIGHT, up: K.UP, down: K.DOWN,
        a: K.A, d: K.D, w: K.W, s: K.S,
        space: K.SPACE, z: K.Z, shift: K.SHIFT, x: K.X,
        j: K.J, k: K.K, esc: K.ESC, p: K.P, enter: K.ENTER,
      };
      for (const [name, code] of Object.entries(map)) {
        // enableCapture=true so the page doesn't scroll on arrows/space.
        this.keys[name] = kb.addKey(code, true);
      }
    }
  }

  private down(name: string): boolean {
    return this.keys[name]?.isDown ?? false;
  }

  private gamepad(): Phaser.Input.Gamepad.Gamepad | undefined {
    const gp = this.scene.input.gamepad;
    if (!gp || gp.total === 0) return undefined;
    return gp.getPad(0) ?? gp.gamepads.find((p) => p && p.connected);
  }

  /** Call once per frame (before player update). */
  update(): InputState {
    const v = virtualButtons;
    const pad = this.gamepad();
    const axisX = pad ? pad.leftStick.x : 0;
    const axisY = pad ? pad.leftStick.y : 0;
    const btn = (i: number) => (pad ? (pad.buttons[i]?.pressed ?? false) : false);

    let left = this.down('left') || this.down('a') || v.left || axisX < -STICK_DEADZONE || (pad?.left ?? false);
    let right = this.down('right') || this.down('d') || v.right || axisX > STICK_DEADZONE || (pad?.right ?? false);
    let up = this.down('up') || this.down('w') || v.up || axisY < -STICK_DEADZONE || (pad?.up ?? false);
    let down = this.down('down') || this.down('s') || v.down || axisY > STICK_DEADZONE || (pad?.down ?? false);
    let jump = this.down('space') || this.down('z') || this.down('k') || v.jump || btn(0);
    let run = this.down('shift') || v.run || btn(4) || btn(5) || btn(6) || btn(7);
    let attack = this.down('j') || this.down('x') || v.attack || btn(2) || btn(1);
    let pause = this.down('esc') || this.down('p') || v.pause || btn(9);

    if (this.override) {
      const o = this.override;
      left = !!o.left; right = !!o.right; up = !!o.up; down = !!o.down;
      jump = !!o.jump; run = !!o.run; attack = !!o.attack; pause = !!o.pause;
    }

    const s = this.state;
    s.left = left && !right;
    s.right = right && !left;
    s.up = up;
    s.down = down;
    s.jump = jump;
    s.jumpPressed = edge(this.prev.jump, jump);
    s.run = run;
    s.attack = attack;
    s.attackPressed = edge(this.prev.attack, attack);
    s.pausePressed = edge(this.prev.pause, pause);
    this.prev.jump = jump;
    this.prev.attack = attack;
    this.prev.pause = pause;
    return s;
  }

  get current(): InputState {
    return this.state;
  }

  /** Swallow held buttons so e.g. a menu "jump" doesn't trigger an in-game jump. */
  resetEdges(): void {
    this.prev = { jump: true, attack: true, pause: true };
  }
}
