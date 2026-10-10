import { EMPTY_RAW, PAD, PAD_BUTTON_COUNT, isHeld, padToRaw, radialDeadzone, type RawButtons } from './InputMapping';

/**
 * Gamepad layer (pure — no Phaser): reads the browser Gamepad API, normalises every pad to
 * the W3C "standard" (Xbox) layout, remaps known non-standard Xbox layouts, tracks which
 * connected pad was used most recently, and reports presses / hot-plug events.
 *
 * Phaser glue (polling every frame, toasts, cursor hiding, pause-on-disconnect) lives in
 * ui/PadOverlay.ts. Gameplay reads `gamepads.raw()` (InputSystem); menus read
 * `gamepads.wasPressed()` / `gamepads.active` (NavInput).
 */

/** The subset of the DOM `Gamepad` we use (lets tests pass plain objects). */
export interface GamepadLike {
  id: string;
  index: number;
  connected: boolean;
  mapping: string;
  buttons: readonly ({ pressed: boolean; value: number } | null | undefined)[];
  axes: readonly number[];
  vibrationActuator?: { playEffect?: (type: string, params: object) => Promise<unknown> } | null;
  hapticActuators?: readonly { pulse?: (value: number, ms: number) => Promise<unknown> }[];
}

/** A pad in standard layout: 17 button values (0..1) and the two sticks. */
export interface PadSnapshot {
  index: number;
  id: string;
  /** Which remap profile produced this snapshot. */
  profile: RemapProfile;
  buttons: number[];
  lx: number;
  ly: number;
  rx: number;
  ry: number;
}

export type RemapProfile = 'standard' | 'xbox-linux' | 'xbox-mac' | 'generic';

/** Per-pad memory the remap needs (Firefox reports untouched trigger axes as 0, not -1). */
export interface RemapState {
  triggerSeen: boolean[];
}

/** Xbox pads: name contains "xbox"/"xinput" or Microsoft's USB vendor id 045e (sometimes "45e-"). */
export function isXboxId(id: string): boolean {
  return /xbox|xinput|x-box|045e|(^|[^0-9a-f])45e-/i.test(id);
}

/**
 * Decode a DirectInput-style hat-switch axis (8 positions spread over -1..1, neutral
 * outside that range, typically ~1.29).
 */
export function decodeHat(v: number | undefined): { up: boolean; down: boolean; left: boolean; right: boolean } {
  const none = { up: false, down: false, left: false, right: false };
  if (typeof v !== 'number' || !Number.isFinite(v) || v < -1.05 || v > 1.05) return none;
  const i = Math.round(((v + 1) * 7) / 2); // 0 up, 1 up-right, 2 right, … 7 up-left
  return { up: i === 7 || i <= 1, right: i >= 1 && i <= 3, down: i >= 3 && i <= 5, left: i >= 5 && i <= 7 };
}

/** Choose a remap profile for a pad. */
export function remapProfile(p: Pick<GamepadLike, 'id' | 'mapping' | 'buttons' | 'axes'>): RemapProfile {
  if (p.mapping === 'standard') return 'standard';
  if (!isXboxId(p.id)) return 'generic';
  // 360Controller driver on macOS (Firefox): d-pad as buttons 11-14, 15+ buttons.
  if (p.buttons.length >= 15) return 'xbox-mac';
  return 'xbox-linux';
}

const bv = (p: GamepadLike, i: number): number => {
  const b = p.buttons[i];
  return b ? (typeof b.value === 'number' && b.value > 0 ? b.value : b.pressed ? 1 : 0) : 0;
};
const ax = (p: GamepadLike, i: number): number => {
  const v = p.axes[i];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};

/** Trigger on a -1..1 axis → 0..1, ignoring the axis until it has been seen at rest (-1). */
function triggerAxis(p: GamepadLike, i: number, slot: number, st?: RemapState): number {
  const v = ax(p, i);
  if (st) {
    if (v < -0.5) st.triggerSeen[slot] = true;
    if (!st.triggerSeen[slot]) return 0;
  }
  return Math.min(1, Math.max(0, (v + 1) / 2));
}

/**
 * Normalise any pad to standard (Xbox) layout. Non-standard layouts are best effort:
 *  - xbox-linux (Firefox + xpad, Windows DirectInput): buttons A B X Y LB RB View Menu Guide LS RS;
 *    axes LX LY LT RX RY RT, d-pad on axes 6/7 or on a hat axis (9, or any value outside -1..1).
 *  - xbox-mac (Firefox + 360Controller): A B X Y LB RB LS RS Menu View Guide Up Down Left Right;
 *    axes LX LY LT RX RY RT.
 *  - generic: buttons as-is, axes 0-3 sticks.
 */
export function normalizePad(p: GamepadLike, st?: RemapState): PadSnapshot {
  const profile = remapProfile(p);
  const b = new Array<number>(PAD_BUTTON_COUNT).fill(0);
  const out: PadSnapshot = { index: p.index, id: p.id, profile, buttons: b, lx: ax(p, 0), ly: ax(p, 1), rx: ax(p, 2), ry: ax(p, 3) };
  if (profile === 'standard' || profile === 'generic') {
    for (let i = 0; i < PAD_BUTTON_COUNT; i++) b[i] = bv(p, i);
    return out;
  }
  const face = [PAD.A, PAD.B, PAD.X, PAD.Y, PAD.LB, PAD.RB];
  face.forEach((dst, src) => (b[dst] = bv(p, src)));
  out.rx = ax(p, 3);
  out.ry = ax(p, 4);
  if (profile === 'xbox-mac') {
    b[PAD.LS] = bv(p, 6);
    b[PAD.RS] = bv(p, 7);
    b[PAD.MENU] = bv(p, 8);
    b[PAD.VIEW] = bv(p, 9);
    b[PAD.HOME] = bv(p, 10);
    b[PAD.UP] = bv(p, 11);
    b[PAD.DOWN] = bv(p, 12);
    b[PAD.LEFT] = bv(p, 13);
    b[PAD.RIGHT] = bv(p, 14);
  } else {
    b[PAD.VIEW] = bv(p, 6);
    b[PAD.MENU] = bv(p, 7);
    b[PAD.HOME] = bv(p, 8);
    b[PAD.LS] = bv(p, 9);
    b[PAD.RS] = bv(p, 10);
    // Some drivers report the triggers as buttons 6/7 instead; then View/Menu shift up.
    if (p.axes.length < 6 && p.buttons.length >= 13) {
      b[PAD.LT] = bv(p, 6);
      b[PAD.RT] = bv(p, 7);
      b[PAD.VIEW] = bv(p, 8);
      b[PAD.MENU] = bv(p, 9);
      b[PAD.LS] = bv(p, 10);
      b[PAD.RS] = bv(p, 11);
      b[PAD.HOME] = bv(p, 12);
    }
    // D-pad: a hat axis (any axis outside -1..1 at rest, or axis 9) or axes 6/7.
    const hatIdx = p.axes.findIndex((v) => Math.abs(v) > 1.05);
    const hat = hatIdx >= 0 ? hatIdx : p.axes.length >= 10 ? 9 : -1;
    if (hat >= 0) {
      const h = decodeHat(ax(p, hat));
      b[PAD.UP] = h.up ? 1 : 0;
      b[PAD.DOWN] = h.down ? 1 : 0;
      b[PAD.LEFT] = h.left ? 1 : 0;
      b[PAD.RIGHT] = h.right ? 1 : 0;
    } else if (p.axes.length >= 8) {
      b[PAD.LEFT] = ax(p, 6) < -0.5 ? 1 : 0;
      b[PAD.RIGHT] = ax(p, 6) > 0.5 ? 1 : 0;
      b[PAD.UP] = ax(p, 7) < -0.5 ? 1 : 0;
      b[PAD.DOWN] = ax(p, 7) > 0.5 ? 1 : 0;
    }
  }
  if (p.axes.length >= 6) {
    b[PAD.LT] = Math.max(b[PAD.LT], triggerAxis(p, 2, 0, st));
    b[PAD.RT] = Math.max(b[PAD.RT], triggerAxis(p, 5, 1, st));
  }
  return out;
}

interface Track {
  snap: PadSnapshot;
  lastActive: number;
  everActive: boolean;
  stickOut: boolean;
  remap: RemapState;
}

export interface PadEventInfo {
  index: number;
  id: string;
  /** The pad had been used (button press / stick push) since it connected. */
  wasUsed: boolean;
  /** It was the pad currently driving the game. */
  wasActive: boolean;
}

type PadListener = (info: PadEventInfo) => void;

/** Pure: index of the pad used most recently (ties/none → lowest index), or null when empty. */
export function pickActivePad(pads: readonly { index: number; lastActive: number }[]): number | null {
  let best: { index: number; lastActive: number } | null = null;
  for (const p of pads) {
    if (!best || p.lastActive > best.lastActive || (p.lastActive === best.lastActive && p.index < best.index)) best = p;
  }
  return best ? best.index : null;
}

export class GamepadManager {
  private tracks = new Map<number, Track>();
  private pressed = new Set<number>();
  private activeIdx: number | null = null;
  private seq = 0;
  private listeners = { connect: new Set<PadListener>(), disconnect: new Set<PadListener>(), activity: new Set<() => void>() };

  constructor(private source: () => readonly (GamepadLike | null | undefined)[] = browserPads) {}

  /** Read all pads once (call once per frame). */
  poll(): void {
    let list: readonly (GamepadLike | null | undefined)[] = [];
    try {
      list = this.source() ?? [];
    } catch {
      list = [];
    }
    this.pressed.clear();
    const seen = new Set<number>();
    let activity = false;
    for (const gp of list) {
      if (!gp || gp.connected === false) continue;
      seen.add(gp.index);
      let t = this.tracks.get(gp.index);
      if (t && t.snap.id !== gp.id) {
        this.drop(gp.index);
        t = undefined;
      }
      if (!t) {
        const remap: RemapState = { triggerSeen: [] };
        const snap = normalizePad(gp, remap);
        // A pad only appears after a button press: treat what's held now as already held (no
        // edge — the wake-up press must not also confirm a menu), but count it as activity.
        const busy = snap.buttons.some((v) => isHeld(v)) || radialDeadzone(snap.lx, snap.ly).mag > 0;
        t = { snap, lastActive: busy ? ++this.seq : 0, everActive: busy, stickOut: radialDeadzone(snap.lx, snap.ly).mag > 0, remap };
        this.tracks.set(gp.index, t);
        if (busy) activity = true;
        for (const l of [...this.listeners.connect]) l({ index: gp.index, id: gp.id, wasUsed: busy, wasActive: false });
        continue;
      }
      const prev = t.snap;
      const snap = normalizePad(gp, t.remap);
      let used = false;
      for (let i = 0; i < PAD_BUTTON_COUNT; i++) {
        if (isHeld(snap.buttons[i]) && !isHeld(prev.buttons[i])) {
          this.pressed.add(i);
          used = true;
        }
      }
      const out = radialDeadzone(snap.lx, snap.ly).mag > 0 || radialDeadzone(snap.rx, snap.ry).mag > 0;
      if (out && !t.stickOut) used = true;
      t.stickOut = out;
      t.snap = snap;
      if (used) {
        t.lastActive = ++this.seq;
        t.everActive = true;
        activity = true;
      }
    }
    for (const idx of [...this.tracks.keys()]) if (!seen.has(idx)) this.drop(idx);
    this.activeIdx = pickActivePad([...this.tracks.entries()].map(([index, t]) => ({ index, lastActive: t.lastActive })));
    if (activity) for (const l of [...this.listeners.activity]) l();
  }

  private drop(index: number): void {
    const t = this.tracks.get(index);
    if (!t) return;
    const wasActive = this.activeIdx === index;
    this.tracks.delete(index);
    if (wasActive) this.activeIdx = pickActivePad([...this.tracks.entries()].map(([i, tr]) => ({ index: i, lastActive: tr.lastActive })));
    for (const l of [...this.listeners.disconnect]) l({ index, id: t.snap.id, wasUsed: t.everActive, wasActive });
  }

  /** The pad driving the game (most recently used), or null. */
  get active(): PadSnapshot | null {
    return this.activeIdx === null ? null : this.tracks.get(this.activeIdx)?.snap ?? null;
  }

  get count(): number {
    return this.tracks.size;
  }

  /** Logical gameplay buttons from the active pad. */
  raw(): RawButtons {
    const a = this.active;
    return a ? padToRaw(a.buttons, a.lx, a.ly) : EMPTY_RAW;
  }

  /** Standard button `i` went down during the latest poll (on any pad). */
  wasPressed(i: number): boolean {
    return this.pressed.has(i);
  }

  /** Standard button `i` is held on the active pad. */
  isDown(i: number): boolean {
    return isHeld(this.active?.buttons[i]);
  }

  onConnect(cb: PadListener): () => void {
    this.listeners.connect.add(cb);
    return () => this.listeners.connect.delete(cb);
  }

  onDisconnect(cb: PadListener): () => void {
    this.listeners.disconnect.add(cb);
    return () => this.listeners.disconnect.delete(cb);
  }

  /** Any button press / stick push on any pad. */
  onActivity(cb: () => void): () => void {
    this.listeners.activity.add(cb);
    return () => this.listeners.activity.delete(cb);
  }

  /** Raw DOM pad behind the active snapshot (for rumble). */
  activeDomPad(): GamepadLike | null {
    if (this.activeIdx === null) return null;
    try {
      return this.source().find((p) => p && p.index === this.activeIdx) ?? null;
    } catch {
      return null;
    }
  }

  /** Forget all pads (tests). */
  reset(): void {
    this.tracks.clear();
    this.pressed.clear();
    this.activeIdx = null;
  }
}

function browserPads(): readonly (GamepadLike | null)[] {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
  return navigator.getGamepads() as unknown as (GamepadLike | null)[];
}

/** Shared instance polled once per frame by ui/PadOverlay. */
export const gamepads = new GamepadManager();

// ------------------------------------------------------------------ rumble

export type RumbleKind = 'hurt' | 'death' | 'pound' | 'bossHit' | 'bossDefeat';

/** Dual-rumble presets — kept short and subtle. */
export const RUMBLE: Record<RumbleKind, { duration: number; strongMagnitude: number; weakMagnitude: number }> = {
  hurt: { duration: 160, strongMagnitude: 0.45, weakMagnitude: 0.35 },
  death: { duration: 380, strongMagnitude: 0.7, weakMagnitude: 0.4 },
  pound: { duration: 110, strongMagnitude: 0.55, weakMagnitude: 0.15 },
  bossHit: { duration: 90, strongMagnitude: 0.25, weakMagnitude: 0.4 },
  bossDefeat: { duration: 650, strongMagnitude: 0.9, weakMagnitude: 0.6 },
};

/**
 * Play a rumble on the active pad when supported (Chrome/Edge `vibrationActuator`
 * dual-rumble, older Firefox `hapticActuators`). Silently does nothing otherwise.
 * `enabled` is the Settings → Vibration toggle.
 */
export function rumbleOn(pad: GamepadLike | null, kind: RumbleKind, enabled: boolean): boolean {
  if (!enabled || !pad) return false;
  const fx = RUMBLE[kind];
  try {
    const va = pad.vibrationActuator;
    if (va && typeof va.playEffect === 'function') {
      void va.playEffect('dual-rumble', { startDelay: 0, ...fx }).catch(() => undefined);
      return true;
    }
    const h = pad.hapticActuators?.[0];
    if (h && typeof h.pulse === 'function') {
      void h.pulse(fx.strongMagnitude, fx.duration).catch(() => undefined);
      return true;
    }
  } catch {
    /* unsupported */
  }
  return false;
}

