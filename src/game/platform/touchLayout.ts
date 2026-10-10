/**
 * Pure geometry for the DOM touch-control overlay (no DOM, no Phaser — unit tested).
 * All values are CSS pixels in viewport space.
 *
 * Left thumb: a "d-pad without up" — ◀ and ▶ side by side, ▼ centred below them. The whole
 * cluster is one zone hit-tested by angle from its centre, so the thumb can slide between
 * directions (including ↙ / ↘ = down + direction, for Lupin's crawl) without lifting.
 * Right thumb: big JUMP, ABILITY to its lower left, a small latching RUN above ABILITY.
 * PAUSE sits in the top-right corner. Everything hugs the screen edges (the letterbox bars on
 * wide phones) and respects the safe-area insets.
 */

export type DirButton = 'left' | 'right' | 'down';
export type ActionButton = 'jump' | 'attack' | 'run';
export type TouchButton = DirButton | ActionButton;
export type OverlayButton = TouchButton | 'pause';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ViewportInfo {
  w: number;
  h: number;
  safe: Insets;
}

/** A round button: centre + diameter. */
export interface Btn {
  cx: number;
  cy: number;
  size: number;
}

export interface TouchLayout {
  /** Base button size (diameter). */
  s: number;
  buttons: Record<OverlayButton, Btn>;
  /** Angle-test centre of the d-pad and its dead-zone radius. */
  dpad: { cx: number; cy: number; dead: number };
  /** Touch-capturing zones (each cluster's buttons plus generous padding). */
  leftZone: Rect;
  rightZone: Rect;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function computeTouchLayout(v: ViewportInfo): TouchLayout {
  const { w, h, safe } = v;
  // Thumb-sized, scaled with the short side; never wider than ~8.5% of the screen width.
  const s = Math.round(clamp(Math.min(h * 0.16, w * 0.085), 48, 84));
  const gap = Math.round(s * 0.12);
  // Insets: the notch side gets most of its inset (the bottom corners next to the notch are
  // still touchable), the home indicator gets all of it plus a little clearance.
  const padL = Math.round(Math.max(14, safe.left * 0.75));
  const padR = Math.round(Math.max(14, safe.right * 0.75));
  const bottom = h - Math.round(Math.max(12, safe.bottom + 6));
  const top = Math.round(Math.max(10, safe.top + 6));

  // --- Left: d-pad without up.
  const d = Math.round(s * 0.74);
  const downSize = Math.round(s * 0.9);
  const downCy = bottom - downSize / 2;
  const rowCy = Math.round(downCy - d * 0.95);
  const left: Btn = { cx: padL + s / 2, cy: rowCy, size: s };
  const dcx = left.cx + d;
  const right: Btn = { cx: dcx + d, cy: rowCy, size: s };
  const down: Btn = { cx: dcx, cy: downCy, size: downSize };

  // --- Right: JUMP big, ABILITY lower-left of it, RUN above ABILITY.
  const a = Math.round(s * 1.18);
  const jump: Btn = { cx: w - padR - a / 2, cy: bottom - a / 2 - Math.round(s * 0.3), size: a };
  const attack: Btn = { cx: jump.cx - a / 2 - gap - s / 2 + Math.round(s * 0.08), cy: bottom - s / 2, size: s };
  const runSize = Math.max(44, Math.round(s * 0.72));
  const run: Btn = { cx: attack.cx - Math.round(s * 0.12), cy: attack.cy - s / 2 - gap - runSize / 2 - Math.round(s * 0.12), size: runSize };

  // --- Pause, top right (Apple's 44pt minimum).
  const p = Math.max(44, Math.round(s * 0.66));
  const pause: Btn = { cx: w - padR - p / 2, cy: top + p / 2, size: p };

  const lzRight = right.cx + s / 2 + Math.round(s * 0.45);
  const lzTop = rowCy - s / 2 - Math.round(s * 0.55);
  const rzLeft = attack.cx - s / 2 - Math.round(s * 0.35);
  const rzTop = Math.min(run.cy - runSize / 2, jump.cy - a / 2) - Math.round(s * 0.3);

  return {
    s,
    buttons: { left, right, down, jump, attack, run, pause },
    dpad: { cx: dcx, cy: rowCy + d * 0.45, dead: s * 0.18 },
    leftZone: { x: 0, y: lzTop, w: lzRight, h: h - lzTop },
    rightZone: { x: rzLeft, y: rzTop, w: w - rzLeft, h: h - rzTop },
  };
}

/**
 * Directions pressed by a d-pad touch at (x, y). 8-way by angle around the d-pad centre,
 * with the up half folded onto left/right (there is no "up"). Inside the dead zone the
 * previous result is kept (no flicker when the thumb rests on the centre).
 */
export function dpadDirs(L: TouchLayout, x: number, y: number, prev: readonly DirButton[] = []): DirButton[] {
  const dx = x - L.dpad.cx;
  const dy = y - L.dpad.cy;
  if (Math.hypot(dx, dy) < L.dpad.dead) {
    if (prev.length) return [...prev];
    return [dx < 0 ? 'left' : 'right'];
  }
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI; // 0 = right, 90 = down
  if (deg >= 60 && deg <= 120) return ['down'];
  if (deg > 22 && deg < 60) return ['down', 'right'];
  if (deg > 120 && deg < 158) return ['down', 'left'];
  return [dx < 0 ? 'left' : 'right'];
}

/** Distance from a button's centre in units of its radius (1 = on the rim). */
export function radiusRatio(b: Btn, x: number, y: number): number {
  return Math.hypot(x - b.cx, y - b.cy) / (b.size / 2);
}

/** Which action button a NEW touch at (x, y) lands on (fat-finger tolerant), or null. */
export function actionAt(L: TouchLayout, x: number, y: number): ActionButton | null {
  let best: ActionButton | null = null;
  let bestR = Infinity;
  for (const id of ['jump', 'attack', 'run'] as const) {
    const r = radiusRatio(L.buttons[id], x, y);
    if (r < bestR) {
      best = id;
      bestR = r;
    }
  }
  return bestR <= 1.4 ? best : null;
}

/**
 * A held action touch that moved: JUMP and ABILITY can be slid between; sliding off releases
 * (with hysteresis so a wobbling thumb doesn't drop the jump). RUN never changes by sliding.
 */
export function actionSlide(L: TouchLayout, x: number, y: number, cur: ActionButton | null): ActionButton | null {
  if (cur === 'run') return 'run';
  const rj = radiusRatio(L.buttons.jump, x, y);
  const ra = radiusRatio(L.buttons.attack, x, y);
  const best: ActionButton = rj <= ra ? 'jump' : 'attack';
  const bestR = Math.min(rj, ra);
  if (bestR <= 1.0) return best;
  if (cur && radiusRatio(L.buttons[cur], x, y) <= 1.7) return cur;
  return bestR <= 1.25 ? best : null;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function btnRect(b: Btn): Rect {
  return { x: b.cx - b.size / 2, y: b.cy - b.size / 2, w: b.size, h: b.size };
}
