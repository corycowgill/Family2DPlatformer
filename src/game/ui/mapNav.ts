/** Pure helpers for world-map navigation (unit-tested). */

export interface Pt {
  x: number;
  y: number;
}

const DIRS: Record<'up' | 'down' | 'left' | 'right', Pt> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * Index of the best node in direction `dir` from node `from`: must lie within a 60° half-cone
 * of the direction; score favours alignment and distance. Returns `from` if nothing qualifies.
 */
export function pickDirectional(nodes: Pt[], from: number, dir: keyof typeof DIRS): number {
  const o = nodes[from];
  const d = DIRS[dir];
  let best = from;
  let bestScore = Infinity;
  nodes.forEach((n, i) => {
    if (i === from) return;
    const vx = n.x - o.x;
    const vy = n.y - o.y;
    const dist = Math.hypot(vx, vy);
    if (dist === 0) return;
    const cos = (vx * d.x + vy * d.y) / dist;
    if (cos < 0.5) return; // outside ±60°
    const score = dist * (2 - cos) * (2 - cos);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** Node indices visited walking along a linear path from `a` to `b` (exclusive of a, inclusive of b). */
export function pathBetween(a: number, b: number): number[] {
  const out: number[] = [];
  const step = b > a ? 1 : -1;
  for (let i = a + step; step > 0 ? i <= b : i >= b; i += step) out.push(i);
  return out;
}
