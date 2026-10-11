import type { CharacterId } from '../types';

/**
 * Local co-op rules (pure — no Phaser, unit-tested in tests/unit/coop.test.ts).
 * The Phaser glue lives in systems/CoopSystem.ts.
 *
 *  - Camera: frames the midpoint of the living players, clamped to the world/camera bounds.
 *  - Leash: a living player who stays off-screen for LEASH_MS (fell behind, got stuck) warps
 *    next to the on-screen partner's last safe ground position.
 *  - Deaths: while a partner is alive, a fallen player respawns next to them after
 *    RESPAWN_DELAY_MS without costing a life. Only when everyone is down is a life lost.
 */

export interface CoopBody {
  x: number;
  y: number;
  alive: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Delay before a fallen co-op player respawns next to the partner (ms). */
export const RESPAWN_DELAY_MS = 1500;
/** Invulnerability after a co-op respawn / leash warp (ms). */
export const RESPAWN_INVULN_MS = 1500;
/** How long a player may stay off-screen before being warped to the partner (ms). */
export const LEASH_MS = 700;
/** Off-screen margin (px) — a player this far outside the view counts as off-screen. */
export const LEASH_MARGIN = 8;
/** Horizontal offset of a respawn / warp next to the partner (px). */
export const PARTNER_OFFSET = 14;

/** Midpoint of the living players, or null when nobody is alive. */
export function cameraFocus(players: readonly CoopBody[]): { x: number; y: number } | null {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (const p of players) {
    if (!p.alive) continue;
    n++;
    sx += p.x;
    sy += p.y;
  }
  return n ? { x: sx / n, y: sy / n } : null;
}

/**
 * Clamp a camera centre so a view of `viewW` x `viewH` stays inside `bounds`. A bounds
 * smaller than the view centres on the bounds (same as Phaser's camera bounds).
 */
export function clampCenter(cx: number, cy: number, viewW: number, viewH: number, bounds: Rect): { x: number; y: number } {
  const clamp1 = (c: number, half: number, lo: number, size: number) => {
    if (size <= half * 2) return lo + size / 2;
    return Math.min(lo + size - half, Math.max(lo + half, c));
  };
  return { x: clamp1(cx, viewW / 2, bounds.x, bounds.width), y: clamp1(cy, viewH / 2, bounds.y, bounds.height) };
}

/** Extra room above the view before a jumping player counts as off-screen (bounce pads, steam lifts). */
export const LEASH_ABOVE = 64;

/**
 * True when a player (bottom-centre anchor) is outside `view` by more than `margin`
 * (above the top only past LEASH_ABOVE more — high jumps are fine).
 */
export function isOffscreen(p: { x: number; y: number }, view: Rect, margin = LEASH_MARGIN): boolean {
  return (
    p.x < view.x - margin ||
    p.x > view.x + view.width + margin ||
    p.y < view.y - margin - LEASH_ABOVE ||
    p.y - 24 > view.y + view.height + margin
  );
}

/** Can the two players both fit in one view (with `margin` inside each edge)? */
export function fitsInView(a: { x: number; y: number }, b: { x: number; y: number }, viewW: number, viewH: number, margin = 24): boolean {
  return Math.abs(a.x - b.x) <= viewW - margin * 2 && Math.abs(a.y - b.y) <= viewH - margin * 2;
}

/**
 * Who the camera follows when the living players don't fit on one screen: the one furthest
 * along the level (largest x; ties → the earlier player, i.e. P1). The trailing player then
 * drops off-screen and the leash brings them back. Returns an index into `players`, or -1.
 */
export function leaderIndex(players: readonly CoopBody[]): number {
  let best = -1;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p.alive) continue;
    if (best < 0 || p.x > players[best].x) best = i;
  }
  return best;
}

/**
 * Leash timer step. Returns the new off-screen time and whether to warp now.
 * The timer resets whenever the player is back on screen (or dead).
 */
export function leashStep(offMs: number, offscreen: boolean, dtMs: number, limitMs = LEASH_MS): { offMs: number; warp: boolean } {
  if (!offscreen) return { offMs: 0, warp: false };
  const t = offMs + dtMs;
  if (t >= limitMs) return { offMs: 0, warp: true };
  return { offMs: t, warp: false };
}

export type DeathOutcome = 'respawnAtPartner' | 'loseLife';

/**
 * What happens when a player falls: with a living partner (co-op) they come back next to
 * them for free; with nobody left standing, the family loses a life (scene restarts at the
 * checkpoint). Single player always loses a life.
 */
export function deathOutcome(partnersAlive: number): DeathOutcome {
  return partnersAlive > 0 ? 'respawnAtPartner' : 'loseLife';
}

/**
 * Where to put a player returning next to `partner`: on the partner's last safe ground
 * position (never mid-air over a pit), offset sideways, behind the partner's facing,
 * clamped inside the world.
 */
export function spotNearPartner(
  partnerSafe: { x: number; y: number },
  facing: 1 | -1,
  worldWidth: number,
  offset = PARTNER_OFFSET,
): { x: number; y: number } {
  const x = Math.min(worldWidth - 8, Math.max(8, partnerSafe.x - facing * offset));
  return { x, y: partnerSafe.y };
}

/**
 * Character picker for P2: step `dir` (+1/-1) from `current` through `available`,
 * skipping `taken` (P1's hero). Returns `current` when nothing else is free.
 */
export function cycleCharacter(current: CharacterId, dir: 1 | -1, available: readonly CharacterId[], taken: CharacterId): CharacterId {
  const free = available.filter((c) => c !== taken);
  if (!free.length) return current;
  const i = available.indexOf(current);
  const n = available.length;
  for (let k = 1; k <= n; k++) {
    const c = available[(((i < 0 ? 0 : i) + dir * k) % n + n) % n];
    if (c !== taken) return c;
  }
  return current;
}

/** First character P2 is offered: the one after P1's in roster order. */
export function defaultP2Character(available: readonly CharacterId[], taken: CharacterId): CharacterId | null {
  const free = available.filter((c) => c !== taken);
  if (!free.length) return null;
  return cycleCharacter(taken, 1, available, taken);
}

/**
 * Which pad (if any) joins as Player 2 this frame: A or Start on a pad that is not the one
 * Player 1 plays with (P1's pad = the most recently used unclaimed pad, so a lone controller
 * always stays Player 1's — its Start keeps pausing). One keyboard + one controller: P2 takes
 * the keyboard set (U) instead.
 */
export function padJoinCandidate(
  pads: readonly { index: number; pressedA: boolean; pressedStart: boolean }[],
  p1Pad: number | null,
  claimed: ReadonlySet<number>,
): number | null {
  for (const p of pads) {
    if (claimed.has(p.index) || p.index === p1Pad) continue;
    if (p.pressedA || p.pressedStart) return p.index;
  }
  return null;
}
