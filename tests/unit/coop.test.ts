import { describe, expect, it } from 'vitest';
import {
  LEASH_MS,
  cameraFocus,
  clampCenter,
  cycleCharacter,
  deathOutcome,
  defaultP2Character,
  fitsInView,
  isOffscreen,
  leaderIndex,
  leashStep,
  padJoinCandidate,
  spotNearPartner,
} from '../../src/game/systems/Coop';
import { KEY_BINDINGS, KEY_BINDINGS_P2, P2_KEY_NAMES, PAD, keysToRaw } from '../../src/game/systems/InputMapping';
import { GamepadManager, type GamepadLike } from '../../src/game/systems/Gamepads';
import { P2_EVENT_SUFFIX, playerEvent, EV, type CharacterId } from '../../src/game/types';

const WORLD = { x: 0, y: 0, width: 2000, height: 600 };

describe('co-op camera', () => {
  it('frames the midpoint of the living players', () => {
    expect(cameraFocus([{ x: 100, y: 200, alive: true }, { x: 300, y: 100, alive: true }])).toEqual({ x: 200, y: 150 });
  });
  it('ignores fallen players; nobody alive → null', () => {
    expect(cameraFocus([{ x: 100, y: 200, alive: false }, { x: 300, y: 100, alive: true }])).toEqual({ x: 300, y: 100 });
    expect(cameraFocus([{ x: 1, y: 1, alive: false }])).toBeNull();
    expect(cameraFocus([])).toBeNull();
  });
  it('clamps the centre so the view stays inside the world', () => {
    expect(clampCenter(10, 10, 480, 270, WORLD)).toEqual({ x: 240, y: 135 });
    expect(clampCenter(1990, 590, 480, 270, WORLD)).toEqual({ x: 1760, y: 465 });
    expect(clampCenter(1000, 300, 480, 270, WORLD)).toEqual({ x: 1000, y: 300 });
  });
  it('centres on bounds smaller than the view (boss arenas)', () => {
    expect(clampCenter(0, 0, 480, 270, { x: 100, y: 50, width: 300, height: 200 })).toEqual({ x: 250, y: 150 });
  });
  it('knows when two players fit on one screen', () => {
    expect(fitsInView({ x: 0, y: 0 }, { x: 400, y: 0 }, 480, 270)).toBe(true);
    expect(fitsInView({ x: 0, y: 0 }, { x: 460, y: 0 }, 480, 270)).toBe(false);
    expect(fitsInView({ x: 0, y: 0 }, { x: 0, y: 250 }, 480, 270)).toBe(false);
  });
});

describe('co-op leash', () => {
  const view = { x: 100, y: 0, width: 480, height: 270 };
  it('detects players outside the view (with margin)', () => {
    expect(isOffscreen({ x: 300, y: 200 }, view)).toBe(false);
    expect(isOffscreen({ x: 95, y: 200 }, view)).toBe(false); // within the margin
    expect(isOffscreen({ x: 50, y: 200 }, view)).toBe(true);
    expect(isOffscreen({ x: 700, y: 200 }, view)).toBe(true);
    expect(isOffscreen({ x: 300, y: 400 }, view)).toBe(true); // fell below
    expect(isOffscreen({ x: 300, y: -40 }, view)).toBe(false); // a high jump is fine
    expect(isOffscreen({ x: 300, y: -100 }, view)).toBe(true);
  });
  it('follows the player furthest along when they do not fit on one screen', () => {
    expect(leaderIndex([{ x: 100, y: 0, alive: true }, { x: 700, y: 0, alive: true }])).toBe(1);
    expect(leaderIndex([{ x: 900, y: 0, alive: true }, { x: 700, y: 0, alive: true }])).toBe(0);
    expect(leaderIndex([{ x: 500, y: 0, alive: true }, { x: 500, y: 0, alive: true }])).toBe(0);
    expect(leaderIndex([{ x: 100, y: 0, alive: true }, { x: 700, y: 0, alive: false }])).toBe(0);
    expect(leaderIndex([])).toBe(-1);
  });
  it('warps only after staying off-screen for LEASH_MS, and resets when back', () => {
    let st = { offMs: 0, warp: false };
    st = leashStep(st.offMs, true, LEASH_MS / 2);
    expect(st.warp).toBe(false);
    st = leashStep(st.offMs, false, 16);
    expect(st).toEqual({ offMs: 0, warp: false });
    let frames = 0;
    st = { offMs: 0, warp: false };
    while (!st.warp && frames < 1000) {
      st = leashStep(st.offMs, true, 1000 / 60);
      frames++;
    }
    expect(st.warp).toBe(true);
    // ~LEASH_MS of 60 fps frames (float accumulation may need one more).
    expect(frames).toBeGreaterThanOrEqual(Math.ceil(LEASH_MS / (1000 / 60)));
    expect(frames).toBeLessThanOrEqual(Math.ceil(LEASH_MS / (1000 / 60)) + 1);
    expect(st.offMs).toBe(0);
  });
});

describe('co-op respawn rule', () => {
  it('respawns next to a living partner, loses a life when nobody is left', () => {
    expect(deathOutcome(1)).toBe('respawnAtPartner');
    expect(deathOutcome(0)).toBe('loseLife');
  });
  it('places the returning player beside the partner, behind their facing, inside the world', () => {
    expect(spotNearPartner({ x: 500, y: 300 }, 1, 2000)).toEqual({ x: 486, y: 300 });
    expect(spotNearPartner({ x: 500, y: 300 }, -1, 2000)).toEqual({ x: 514, y: 300 });
    expect(spotNearPartner({ x: 4, y: 300 }, 1, 2000).x).toBe(8);
    expect(spotNearPartner({ x: 1998, y: 300 }, -1, 2000).x).toBe(1992);
  });
});

describe('co-op character picker', () => {
  const all: CharacterId[] = ['dad', 'mom', 'brennan', 'parker', 'lupin'];
  it('never offers P1’s hero', () => {
    expect(defaultP2Character(all, 'dad')).toBe('mom');
    expect(defaultP2Character(all, 'lupin')).toBe('dad');
    expect(cycleCharacter('dad', 1, all, 'mom')).toBe('brennan');
    expect(cycleCharacter('brennan', -1, all, 'mom')).toBe('dad');
    expect(cycleCharacter('dad', -1, all, 'mom')).toBe('lupin');
    for (const taken of all) {
      let c = defaultP2Character(all, taken)!;
      for (let i = 0; i < 12; i++) {
        c = cycleCharacter(c, i % 3 ? 1 : -1, all, taken);
        expect(c).not.toBe(taken);
      }
    }
  });
  it('returns null / current when nobody else is available', () => {
    expect(defaultP2Character(['dad'], 'dad')).toBeNull();
    expect(cycleCharacter('dad', 1, ['dad'], 'dad')).toBe('dad');
  });
});

describe('co-op join rules', () => {
  const none = new Set<number>();
  it('a second pad joins with A or Start', () => {
    expect(padJoinCandidate([{ index: 0, pressedA: false, pressedStart: false }, { index: 1, pressedA: true, pressedStart: false }], 0, none)).toBe(1);
    expect(padJoinCandidate([{ index: 1, pressedA: false, pressedStart: true }], 0, none)).toBe(1);
    expect(padJoinCandidate([{ index: 1, pressedA: false, pressedStart: false }], 0, none)).toBeNull();
  });
  it("P1's own pad never joins (a lone controller's Start keeps pausing)", () => {
    expect(padJoinCandidate([{ index: 0, pressedA: true, pressedStart: true }], 0, none)).toBeNull();
  });
  it('claimed pads are ignored', () => {
    expect(padJoinCandidate([{ index: 1, pressedA: true, pressedStart: false }], 0, new Set([1]))).toBeNull();
  });
});

describe('per-player input sources', () => {
  const down = (keys: string[]) => (k: string) => keys.includes(k);
  it('P2 keyboard set: IJKL move, U jump, O ability', () => {
    expect(keysToRaw(down(['J', 'U']), null, KEY_BINDINGS_P2)).toMatchObject({ left: true, jump: true, attack: false });
    expect(keysToRaw(down(['L', 'O', 'I', 'K']), null, KEY_BINDINGS_P2)).toMatchObject({ right: true, attack: true, up: true, down: true });
    expect(keysToRaw(down(['SPACE', 'A']), null, KEY_BINDINGS_P2)).toMatchObject({ jump: false, left: false });
  });
  it('P1 keeps its keys, minus the shared ones while P2 is on the keyboard', () => {
    expect(keysToRaw(down(['K', 'J']))).toMatchObject({ jump: true, attack: true });
    expect(keysToRaw(down(['K', 'J']), P2_KEY_NAMES)).toMatchObject({ jump: false, attack: false, down: false });
    expect(keysToRaw(down(['SPACE', 'X', 'A']), P2_KEY_NAMES)).toMatchObject({ jump: true, attack: true, left: true });
    // No P1 action is lost entirely.
    for (const [k, keys] of Object.entries(KEY_BINDINGS)) expect(keys.some((n) => !P2_KEY_NAMES.has(n)), k).toBe(true);
  });
  it('gamepads: P2 owns one pad, P1 reads the others', () => {
    const pad = (index: number, values: Record<number, number> = {}): GamepadLike => ({
      id: `Xbox ${index}`,
      index,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: (values[i] ?? 0) > 0.5, value: values[i] ?? 0 })),
    });
    const pads: GamepadLike[] = [pad(0), pad(1)];
    const m = new GamepadManager(() => pads);
    m.poll();
    pads[1] = pad(1, { [PAD.A]: 1 });
    m.poll();
    expect(m.wasPressedOn(1, PAD.A)).toBe(true);
    expect(m.wasPressedOn(0, PAD.A)).toBe(false);
    expect(m.active?.index).toBe(1);
    // P2 claims pad 1: P1 ignores its A, P2 reads it.
    const claimed = new Set([1]);
    expect(m.activeIndexExcept(claimed)).toBe(0);
    expect(m.rawExcept(claimed).jump).toBe(false);
    expect(m.rawFor(1).jump).toBe(true);
    expect(m.isDownOn(1, PAD.A)).toBe(true);
    // Without claims P1 reads exactly what it always did.
    expect(m.rawExcept(new Set())).toEqual(m.raw());
  });
});

describe('player events', () => {
  it('P1 keeps the plain event names; P2 gets a suffix', () => {
    expect(playerEvent(EV.HEALTH_CHANGED, 0)).toBe(EV.HEALTH_CHANGED);
    expect(playerEvent(EV.PLAYER_DIED, 1)).toBe(`${EV.PLAYER_DIED}${P2_EVENT_SUFFIX}`);
  });
});
