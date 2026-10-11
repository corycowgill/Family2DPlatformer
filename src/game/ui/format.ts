/** Pure formatting helpers for UI (unit-tested). */

/** 83456 → "1:23.45" */
export function formatTime(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  const s = Math.floor(safe / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${String(Math.floor((safe % 1000) / 10)).padStart(2, '0')}`;
}

/** Medal target times (whole seconds): 75000 → "1:15" */
export function formatTarget(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 0.6 → "●●●●●●○○○○" */
export function volumeBar(v: number, slots = 10): string {
  const n = Math.round(Math.max(0, Math.min(1, v)) * slots);
  return '●'.repeat(n) + '○'.repeat(slots - n);
}

/** Step a 0..1 volume by tenths, clamped and rounded to avoid float drift. */
export function stepVolume(v: number, dir: number): number {
  return Math.round(Math.max(0, Math.min(1, v + dir * 0.1)) * 10) / 10;
}

/** Zero-padded integer, e.g. pad(7, 3) → "007". */
export function pad(n: number, width: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(width, '0');
}

/** Cycle through a list of options. */
export function cycle<T>(list: readonly T[], current: T, dir = 1): T {
  const i = list.indexOf(current);
  return list[(((i < 0 ? 0 : i) + dir) % list.length + list.length) % list.length];
}

/** Power-up remaining fraction (1 = just started, 0 = ended). */
export function remaining01(startMs: number, durationMs: number, nowMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - (nowMs - startMs) / durationMs));
}
