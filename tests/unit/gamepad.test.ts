import { describe, expect, it, vi } from 'vitest';

// UI modules import Phaser for runtime objects; the helpers under test are pure.
vi.mock('phaser', () => ({ default: { GameObjects: { Container: class {} } } }));

import {
  CROUCH_MAX_ANGLE,
  EMPTY_RAW,
  PAD,
  STICK_DEADZONE,
  TRIGGER_THRESHOLD,
  heldEdges,
  padToRaw,
  radialDeadzone,
  stickToDirs,
  toInputState,
  type EdgeMemory,
} from '../../src/game/systems/InputMapping';
import {
  GamepadManager,
  decodeHat,
  isXboxId,
  normalizePad,
  pickActivePad,
  remapProfile,
  rumbleOn,
  type GamepadLike,
} from '../../src/game/systems/Gamepads';
import { RepeatNav, padDirection, stickDirection, REPEAT_DELAY_MS, REPEAT_MS } from '../../src/game/ui/NavInput';
import { glyphsFor, resolveTemplate, templateToText } from '../../src/game/ui/Prompts';
import { DEFAULT_SETTINGS, sanitizeSave } from '../../src/game/systems/SaveSystem';
import { SAVE_VERSION } from '../../src/game/config';

const btns = (vals: Record<number, number | boolean> = {}) => {
  const b: (number | boolean)[] = new Array(17).fill(0);
  for (const [i, v] of Object.entries(vals)) b[Number(i)] = v;
  return b;
};
const polar = (deg: number, r: number) => [Math.sin((deg * Math.PI) / 180) * r, Math.cos((deg * Math.PI) / 180) * r] as const; // deg from straight down

function domPad(o: Partial<GamepadLike> & { values?: Record<number, number>; nButtons?: number } = {}): GamepadLike {
  const n = o.nButtons ?? 17;
  const buttons = Array.from({ length: n }, (_, i) => {
    const v = o.values?.[i] ?? 0;
    return { pressed: v > 0.5, value: v };
  });
  return { id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], ...o, buttons: o.buttons ?? buttons };
}

describe('radial dead zone', () => {
  it('ignores anything inside the circle, in every direction', () => {
    for (let deg = 0; deg < 360; deg += 15) {
      const [x, y] = polar(deg, STICK_DEADZONE - 0.01);
      expect(radialDeadzone(x, y).mag).toBe(0);
      expect(stickToDirs(x, y)).toEqual({ left: false, right: false, up: false, down: false });
    }
  });
  it('a diagonal at 0.3 counts (per-axis 0.35 would have dropped it) and rescales smoothly', () => {
    const r = radialDeadzone(0.22, 0.22); // |v| ≈ 0.31
    expect(r.mag).toBeGreaterThan(0);
    expect(r.mag).toBeLessThan(0.15);
    expect(radialDeadzone(1, 0).mag).toBe(1);
    expect(radialDeadzone(0.8, 0.8).mag).toBe(1); // clamped (square-ish gates exceed 1)
  });
});

describe('stick → directions (crouch angle threshold)', () => {
  it('straight down crouches, down-diagonals while running do not', () => {
    expect(stickToDirs(...polar(0, 0.9)).down).toBe(true);
    expect(stickToDirs(...polar(CROUCH_MAX_ANGLE - 2, 0.9)).down).toBe(true);
    const runDiag = stickToDirs(...polar(45, 0.9)); // pushing right and a bit down
    expect(runDiag.down).toBe(false);
    expect(runDiag.right).toBe(true);
    expect(stickToDirs(...polar(CROUCH_MAX_ANGLE + 3, 1)).down).toBe(false);
  });
  it('a clear down push does not steer sideways from small noise', () => {
    const d = stickToDirs(0.12, 0.95);
    expect(d).toEqual({ left: false, right: false, up: false, down: true });
  });
  it('full left/right, light pushes past the dead zone still move', () => {
    expect(stickToDirs(-1, 0).left).toBe(true);
    expect(stickToDirs(0.3, 0.05).right).toBe(true);
    expect(stickToDirs(0.3, 0.05).down).toBe(false);
  });
});

describe('pad buttons → gameplay', () => {
  it('A jump, X and B ability, triggers/bumpers run, Menu and View pause', () => {
    expect(padToRaw(btns({ [PAD.A]: 1 }), 0, 0).jump).toBe(true);
    expect(padToRaw(btns({ [PAD.X]: 1 }), 0, 0).attack).toBe(true);
    expect(padToRaw(btns({ [PAD.B]: 1 }), 0, 0).attack).toBe(true);
    for (const b of [PAD.RT, PAD.LT, PAD.RB, PAD.LB]) expect(padToRaw(btns({ [b]: 1 }), 0, 0).run, `button ${b}`).toBe(true);
    expect(padToRaw(btns({ [PAD.MENU]: 1 }), 0, 0).pause).toBe(true);
    expect(padToRaw(btns({ [PAD.VIEW]: 1 }), 0, 0).pause).toBe(true);
    expect(padToRaw(btns({ [PAD.Y]: 1 }), 0, 0)).toEqual(EMPTY_RAW);
  });
  it('analog triggers press above the threshold', () => {
    expect(padToRaw(btns({ [PAD.RT]: TRIGGER_THRESHOLD - 0.05 }), 0, 0).run).toBe(false);
    expect(padToRaw(btns({ [PAD.RT]: TRIGGER_THRESHOLD + 0.05 }), 0, 0).run).toBe(true);
    expect(padToRaw(btns({ [PAD.LT]: 0.6 }), 0, 0).run).toBe(true);
  });
  it('run held + jump pressed together, while moving right', () => {
    const r = padToRaw(btns({ [PAD.RT]: 0.8, [PAD.A]: 1 }), 0.9, 0.1);
    expect(r).toMatchObject({ run: true, jump: true, right: true, down: false });
  });
});

describe('resetEdges: confirming a level with A does not jump on spawn', () => {
  it('A still held after the menu is not a new press; releasing and pressing again jumps', () => {
    const prev: EdgeMemory = heldEdges(); // what InputSystem.resetEdges() installs
    const heldA = padToRaw(btns({ [PAD.A]: 1 }), 0, 0);
    expect(toInputState(heldA, prev).jumpPressed).toBe(false);
    expect(toInputState(heldA, prev).jumpPressed).toBe(false);
    toInputState(padToRaw(btns(), 0, 0), prev);
    expect(toInputState(heldA, prev).jumpPressed).toBe(true);
  });
  it('Menu held from the pause screen does not re-pause', () => {
    const prev = heldEdges();
    expect(toInputState(padToRaw(btns({ [PAD.MENU]: 1 }), 0, 0), prev).pausePressed).toBe(false);
  });
});

describe('non-standard Xbox remap', () => {
  it('recognises Xbox ids', () => {
    expect(isXboxId('Xbox Wireless Controller')).toBe(true);
    expect(isXboxId('045e-02ea-Microsoft X-Box One S pad')).toBe(true);
    expect(isXboxId('45e-2ea-Controller')).toBe(true);
    expect(isXboxId('054c-09cc-Wireless Controller')).toBe(false);
  });
  it('picks a profile', () => {
    expect(remapProfile(domPad())).toBe('standard');
    expect(remapProfile(domPad({ mapping: '', id: '045e-02ea-Microsoft X-Box One S pad', nButtons: 11, axes: new Array(8).fill(0) }))).toBe('xbox-linux');
    expect(remapProfile(domPad({ mapping: '', id: '45e-2ea-Xbox Wireless Controller', nButtons: 15, axes: new Array(6).fill(0) }))).toBe('xbox-mac');
    expect(remapProfile(domPad({ mapping: '', id: 'Some Generic Pad', nButtons: 12 }))).toBe('generic');
  });
  it('xbox-linux: View/Menu moved, d-pad on axes 6/7, triggers on axes 2/5 (after seen at rest)', () => {
    const base = { mapping: '', id: '045e-02ea-Microsoft X-Box One S pad', nButtons: 11 };
    const st = { triggerSeen: [] as boolean[] };
    // Firefox reports untouched triggers as 0 — must not read as half-pressed.
    let n = normalizePad(domPad({ ...base, axes: [0, 0, 0, 0, 0, 0, 0, 0] }), st);
    expect(n.buttons[PAD.LT]).toBe(0);
    expect(n.buttons[PAD.RT]).toBe(0);
    n = normalizePad(domPad({ ...base, values: { 6: 1, 7: 1, 0: 1 }, axes: [0.5, -0.25, -1, 0.1, 0.2, -1, -1, 1] }), st);
    expect(n.buttons[PAD.A]).toBe(1);
    expect(n.buttons[PAD.VIEW]).toBe(1);
    expect(n.buttons[PAD.MENU]).toBe(1);
    expect(n.buttons[PAD.LEFT]).toBe(1);
    expect(n.buttons[PAD.DOWN]).toBe(1);
    expect(n.buttons[PAD.RIGHT]).toBe(0);
    expect([n.lx, n.ly, n.rx, n.ry]).toEqual([0.5, -0.25, 0.1, 0.2]);
    n = normalizePad(domPad({ ...base, axes: [0, 0, -1, 0, 0, 0.6, 0, 0] }), st);
    expect(n.buttons[PAD.RT]).toBeCloseTo(0.8);
    expect(padToRaw(n.buttons, n.lx, n.ly).run).toBe(true);
  });
  it('hat-switch d-pad', () => {
    expect(decodeHat(-1)).toEqual({ up: true, down: false, left: false, right: false });
    expect(decodeHat(-3 / 7)).toEqual({ up: false, down: false, left: false, right: true });
    expect(decodeHat(1 / 7)).toEqual({ up: false, down: true, left: false, right: false });
    expect(decodeHat(5 / 7)).toEqual({ up: false, down: false, left: true, right: false });
    expect(decodeHat(-5 / 7)).toEqual({ up: true, down: false, left: false, right: true });
    expect(decodeHat(1.2857)).toEqual({ up: false, down: false, left: false, right: false });
    const axes = [0, 0, -1, 0, 0, -1, 0, 0, 0, 1.2857];
    const pad = domPad({ mapping: '', id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', nButtons: 10, axes });
    expect(normalizePad(pad).buttons.slice(PAD.UP, PAD.RIGHT + 1)).toEqual([0, 0, 0, 0]);
    axes[9] = 5 / 7;
    expect(normalizePad(pad).buttons[PAD.LEFT]).toBe(1);
  });
  it('xbox-mac: d-pad on buttons 11-14, Menu 8, View 9', () => {
    const n = normalizePad(domPad({ mapping: '', id: '45e-2ea-Xbox Wireless Controller', nButtons: 15, axes: [0, 0, -1, 0, 0, -1], values: { 8: 1, 9: 1, 14: 1 } }));
    expect(n.buttons[PAD.MENU]).toBe(1);
    expect(n.buttons[PAD.VIEW]).toBe(1);
    expect(n.buttons[PAD.RIGHT]).toBe(1);
    expect(n.buttons[PAD.LS]).toBe(0);
  });
  it('standard pads pass through untouched', () => {
    const n = normalizePad(domPad({ values: { [PAD.RT]: 0.42, [PAD.UP]: 1 }, axes: [0.1, 0.2, 0.3, 0.4] }));
    expect(n.profile).toBe('standard');
    expect(n.buttons[PAD.RT]).toBe(0.42);
    expect(n.buttons[PAD.UP]).toBe(1);
    expect([n.lx, n.ly, n.rx, n.ry]).toEqual([0.1, 0.2, 0.3, 0.4]);
  });
});

describe('GamepadManager', () => {
  const make = () => {
    const pads: (GamepadLike | null)[] = [null, null, null, null];
    const m = new GamepadManager(() => pads);
    return { pads, m };
  };
  it('picks the most recently used pad, not just index 0', () => {
    expect(pickActivePad([])).toBeNull();
    expect(pickActivePad([{ index: 0, lastActive: 0 }, { index: 2, lastActive: 0 }])).toBe(0);
    expect(pickActivePad([{ index: 0, lastActive: 3 }, { index: 1, lastActive: 7 }])).toBe(1);
    const { pads, m } = make();
    pads[0] = domPad({ index: 0 });
    pads[1] = domPad({ index: 1, id: 'Xbox 2' });
    m.poll();
    expect(m.active?.index).toBe(0);
    pads[1] = domPad({ index: 1, id: 'Xbox 2', values: { [PAD.A]: 1 } });
    m.poll();
    expect(m.active?.index).toBe(1);
    expect(m.raw().jump).toBe(true);
    // Pad 0 stick push → pad 0 drives again.
    pads[0] = domPad({ index: 0, axes: [0.9, 0, 0, 0] });
    m.poll();
    expect(m.active?.index).toBe(0);
    expect(m.raw()).toMatchObject({ right: true, jump: false });
  });
  it('reports presses once (edges), activity, hot-plug; the wake-up press is not an edge', () => {
    const { pads, m } = make();
    const log: string[] = [];
    m.onConnect((i) => log.push(`connect ${i.index}`));
    m.onDisconnect((i) => log.push(`disconnect ${i.index} used=${i.wasUsed} active=${i.wasActive}`));
    m.onActivity(() => log.push('activity'));
    pads[0] = domPad({ values: { [PAD.A]: 1 } }); // browsers expose a pad on its first press
    m.poll();
    expect(m.wasPressed(PAD.A)).toBe(false);
    expect(log).toEqual(['connect 0', 'activity']);
    pads[0] = domPad();
    m.poll();
    pads[0] = domPad({ values: { [PAD.B]: 1 } });
    m.poll();
    expect(m.wasPressed(PAD.B)).toBe(true);
    m.poll();
    expect(m.wasPressed(PAD.B)).toBe(false);
    expect(m.isDown(PAD.B)).toBe(true);
    pads[0] = null;
    m.poll();
    expect(log.slice(-1)[0]).toBe('disconnect 0 used=true active=true');
    expect(m.active).toBeNull();
    expect(m.raw()).toEqual(EMPTY_RAW);
  });
  it('stick drift does not count as activity; crossing the dead zone does', () => {
    const { pads, m } = make();
    let n = 0;
    m.onActivity(() => n++);
    pads[0] = domPad({ axes: [0.1, 0.05, 0, 0] });
    m.poll();
    m.poll();
    expect(n).toBe(0);
    pads[0] = domPad({ axes: [0.8, 0, 0, 0] });
    m.poll();
    m.poll(); // still held: no new activity
    expect(n).toBe(1);
  });
  it('a throwing getGamepads is survived', () => {
    const m = new GamepadManager(() => {
      throw new Error('SecurityError');
    });
    expect(() => m.poll()).not.toThrow();
    expect(m.active).toBeNull();
  });
});

describe('rumble', () => {
  it('uses dual-rumble when available, respects the setting, survives missing support', () => {
    const calls: unknown[] = [];
    const pad = domPad({ vibrationActuator: { playEffect: (t: string, p: object) => (calls.push([t, p]), Promise.resolve()) } });
    expect(rumbleOn(pad, 'hurt', true)).toBe(true);
    expect(calls[0]).toEqual(['dual-rumble', expect.objectContaining({ duration: expect.any(Number), strongMagnitude: expect.any(Number) })]);
    expect(rumbleOn(pad, 'hurt', false)).toBe(false);
    expect(rumbleOn(domPad(), 'death', true)).toBe(false);
    expect(rumbleOn(null, 'death', true)).toBe(false);
  });
  it('vibration setting defaults on and is sanitised', () => {
    expect(DEFAULT_SETTINGS.rumble).toBe(true);
    const s = (settings: unknown) => sanitizeSave({ version: SAVE_VERSION, settings }).settings.rumble;
    expect(s({})).toBe(true);
    expect(s({ rumble: false })).toBe(false);
    expect(s({ rumble: 'no' })).toBe(true);
    expect(sanitizeSave(null).settings.rumble).toBe(true);
  });
});

describe('menu navigation from the pad', () => {
  it('stick directions use a radial dead zone', () => {
    expect(stickDirection(0.3, 0.3)).toBeNull();
    expect(stickDirection(0.4, 0.4)).toBe('down');
    expect(stickDirection(-0.6, 0.1)).toBe('left');
  });
  it('d-pad wins over the stick', () => {
    expect(padDirection(btns({ [PAD.UP]: 1 }) as number[], 0.9, 0)).toBe('up');
    expect(padDirection(btns() as number[], 0.9, 0)).toBe('right');
    expect(padDirection(btns() as number[], 0, 0)).toBeNull();
  });
  it('auto-repeats a held direction; a direction held when the screen opens is ignored', () => {
    const r = new RepeatNav(null);
    expect(r.update('down', 0)).toBe('down');
    expect(r.update('down', REPEAT_DELAY_MS - 1)).toBeNull();
    expect(r.update('down', REPEAT_DELAY_MS)).toBe('down');
    expect(r.update('down', REPEAT_DELAY_MS + REPEAT_MS - 1)).toBeNull();
    expect(r.update('down', REPEAT_DELAY_MS + REPEAT_MS)).toBe('down');
    expect(r.update(null, 2000)).toBeNull();
    const held = new RepeatNav('right');
    expect(held.update('right', 0)).toBeNull();
    expect(held.update('right', 5000)).toBeNull();
    expect(held.update(null, 5001)).toBeNull();
    expect(held.update('right', 5002)).toBe('right');
  });
});

describe('prompts', () => {
  it('resolves tokens per device', () => {
    expect(glyphsFor('JUMP', 'gamepad')).toEqual(['pad:A']);
    expect(glyphsFor('JUMP', 'keyboard')).toEqual(['key:SPACE']);
    expect(glyphsFor('ABILITY', 'gamepad')).toEqual(['pad:X']);
    expect(glyphsFor('ABILITY', 'keyboard')).toEqual(['key:J']);
    expect(glyphsFor('RUN', 'gamepad')).toEqual(['pad:RT']);
    expect(glyphsFor('PAUSE', 'gamepad')).toEqual(['pad:MENU']);
    expect(templateToText('Hold {RUN} to jump farther', 'keyboard')).toBe('Hold SHIFT to jump farther');
    expect(templateToText('Hold {RUN} to jump farther', 'gamepad')).toBe('Hold RT to jump farther');
    expect(templateToText('{JUMP} JUMP', 'touch')).toBe('JUMP JUMP');
  });
  it('splits text, glyphs, unknown tokens and lines', () => {
    expect(resolveTemplate('A {JUMP} B {NOPE}\n{BACK}', 'gamepad')).toEqual([
      [{ text: 'A ' }, { glyph: 'pad:A' }, { text: ' B {NOPE}' }],
      [{ glyph: 'pad:B' }],
    ]);
  });
});
