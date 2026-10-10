import { describe, expect, it } from 'vitest';
import {
  EMPTY_RAW,
  KEY_BINDINGS,
  edge,
  keysToRaw,
  mergeRaw,
  padToRaw,
  toInputState,
  type EdgeMemory,
  type RawButtons,
} from '../../src/game/systems/InputMapping';

const raw = (o: Partial<RawButtons> = {}): RawButtons => ({ ...EMPTY_RAW, ...o });
const mem = (): EdgeMemory => ({ jump: false, attack: false, pause: false });

describe('edge detection', () => {
  it('edge() is true only on the rising edge', () => {
    expect(edge(false, true)).toBe(true);
    expect(edge(true, true)).toBe(false);
    expect(edge(true, false)).toBe(false);
    expect(edge(false, false)).toBe(false);
  });

  it('jumpPressed / attackPressed / pausePressed fire once per press', () => {
    const prev = mem();
    const frames = [false, true, true, true, false, true].map((j) => toInputState(raw({ jump: j, attack: j, pause: j }), prev, undefined));
    expect(frames.map((f) => f.jumpPressed)).toEqual([false, true, false, false, false, true]);
    expect(frames.map((f) => f.attackPressed)).toEqual([false, true, false, false, false, true]);
    expect(frames.map((f) => f.pausePressed)).toEqual([false, true, false, false, false, true]);
    expect(frames.map((f) => f.jump)).toEqual([false, true, true, true, false, true]);
  });

  it('a button held through a scene change does not register as a new press (resetEdges)', () => {
    const prev: EdgeMemory = { jump: true, attack: true, pause: true };
    const s = toInputState(raw({ jump: true, attack: true }), prev);
    expect(s.jumpPressed).toBe(false);
    expect(s.attackPressed).toBe(false);
  });

  it('opposite directions cancel out', () => {
    const s = toInputState(raw({ left: true, right: true }), mem());
    expect(s.left).toBe(false);
    expect(s.right).toBe(false);
    expect(toInputState(raw({ left: true }), mem()).left).toBe(true);
  });
});

describe('keyboard bindings', () => {
  it('match the spec (A/D or arrows, Space jump, Shift sprint, J attack, Esc pause)', () => {
    expect(KEY_BINDINGS.left).toContain('A');
    expect(KEY_BINDINGS.left).toContain('LEFT');
    expect(KEY_BINDINGS.right).toContain('D');
    expect(KEY_BINDINGS.right).toContain('RIGHT');
    expect(KEY_BINDINGS.down).toContain('S');
    expect(KEY_BINDINGS.down).toContain('DOWN');
    expect(KEY_BINDINGS.jump[0]).toBe('SPACE');
    expect(KEY_BINDINGS.run[0]).toBe('SHIFT');
    expect(KEY_BINDINGS.attack[0]).toBe('J');
    expect(KEY_BINDINGS.pause[0]).toBe('ESC');
  });

  it('keysToRaw maps held keys to logical buttons', () => {
    const held = new Set(['D', 'SPACE', 'SHIFT']);
    const r = keysToRaw((k) => held.has(k));
    expect(r).toEqual(raw({ right: true, jump: true, run: true }));
    expect(keysToRaw((k) => k === 'ESC').pause).toBe(true);
    expect(keysToRaw((k) => k === 'J').attack).toBe(true);
    expect(keysToRaw((k) => k === 'LEFT').left).toBe(true);
  });
});

describe('gamepad mapping', () => {
  const pressed = (...ids: number[]) => {
    const b = new Array(17).fill(false);
    for (const i of ids) b[i] = true;
    return b;
  };

  it('south = jump, west = attack, start = pause', () => {
    expect(padToRaw(pressed(0), 0, 0).jump).toBe(true);
    expect(padToRaw(pressed(2), 0, 0).attack).toBe(true);
    expect(padToRaw(pressed(9), 0, 0).pause).toBe(true);
    expect(padToRaw(pressed(5), 0, 0).run).toBe(true);
    expect(padToRaw(pressed(), 0, 0)).toEqual(EMPTY_RAW);
  });

  it('d-pad and left stick (with dead zone) move', () => {
    expect(padToRaw(pressed(14), 0, 0).left).toBe(true);
    expect(padToRaw(pressed(15), 0, 0).right).toBe(true);
    expect(padToRaw(pressed(13), 0, 0).down).toBe(true);
    expect(padToRaw(pressed(), -0.8, 0).left).toBe(true);
    expect(padToRaw(pressed(), 0.8, 0).right).toBe(true);
    expect(padToRaw(pressed(), 0, 0.9).down).toBe(true);
    const drift = padToRaw(pressed(), 0.17, -0.17); // inside the 0.25 radial dead zone
    expect(drift.left || drift.right || drift.up || drift.down).toBe(false);
  });

  it('devices are OR-merged (keyboard + pad + touch)', () => {
    const m = mergeRaw(raw({ left: true }), raw({ jump: true }), raw({ attack: true }));
    expect(m).toEqual(raw({ left: true, jump: true, attack: true }));
  });

  it('edges work across devices: holding jump on the pad while tapping Space is not a new press', () => {
    const prev = mem();
    toInputState(mergeRaw(raw(), raw({ jump: true })), prev);
    const s = toInputState(mergeRaw(raw({ jump: true }), raw({ jump: true })), prev);
    expect(s.jumpPressed).toBe(false);
  });
});
