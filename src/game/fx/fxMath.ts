/**
 * Pure helpers for the lighting / FX layer (no Phaser imports, unit-tested in Node).
 */

export type EffectsQuality = 'high' | 'low';

/** Small deterministic PRNG (mulberry32) so cosmetic FX never consume `Math.random` (the test harness seeds it). */
export function fxRng(seed = 0x9e3779b9): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable pseudo-random 0..1 from a world position (coin animation phase etc.). */
export function hash01(x: number, y: number): number {
  let h = Math.imul(Math.round(x) | 0, 374761393) ^ Math.imul(Math.round(y) | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface ShadowLook {
  visible: boolean;
  /** Width multiplier (1 = touching the ground). */
  scale: number;
  alpha: number;
}

/**
 * Blob shadow size/opacity from the caster's height above the surface: full size and
 * opacity on the ground, shrinking to `minScale` and fading out at `maxHeight`.
 */
export function shadowLook(height: number, maxHeight: number, baseAlpha: number, minScale = 0.45): ShadowLook {
  if (!(height >= -4) || height > maxHeight || maxHeight <= 0) return { visible: false, scale: 0, alpha: 0 };
  const k = Math.min(1, Math.max(0, height) / maxHeight);
  const alpha = baseAlpha * (1 - k) * (1 - k * 0.3);
  return { visible: alpha > 0.02, scale: 1 - (1 - minScale) * k, alpha };
}

/**
 * Scan a column of tile rows for the first solid tile whose top is at or below `feetY`
 * (minus a small tolerance). Returns the surface Y in pixels, or null if none within `maxDist`.
 * `solidAt(tx, ty)` reports whether the tile is something you can stand on.
 */
export function surfaceBelow(
  x: number,
  feetY: number,
  maxDist: number,
  tileSize: number,
  rows: number,
  solidAt: (tx: number, ty: number) => boolean,
): number | null {
  const tx = Math.floor(x / tileSize);
  let ty = Math.max(0, Math.floor((feetY - 3) / tileSize));
  const lastTy = Math.min(rows - 1, Math.floor((feetY + maxDist) / tileSize));
  for (; ty <= lastTy; ty++) {
    if (ty * tileSize < feetY - 3) continue;
    if (solidAt(tx, ty)) return ty * tileSize;
  }
  return null;
}

/** Per-theme mood settings for the lighting layer. */
export interface ThemeMood {
  /** Vignette darkness at the corners (0 = none). */
  vignette: number;
  vignetteColor: number;
  /** Multiply colour grade (top → bottom of the screen), or null for none. */
  grade: [number, number] | null;
  /** Additive glow on lamp props (0 = lamps off). */
  lampGlow: number;
  /** Player rim-light colour / strength. */
  rimColor: number;
  rimAlpha: number;
}

export const THEME_MOOD: Record<string, ThemeMood> = {
  day: { vignette: 0.2, vignetteColor: 0x0a1028, grade: null, lampGlow: 0, rimColor: 0xfff6dc, rimAlpha: 0.42 },
  rooftop: { vignette: 0.24, vignetteColor: 0x0a1028, grade: null, lampGlow: 0, rimColor: 0xfff6dc, rimAlpha: 0.45 },
  river: { vignette: 0.22, vignetteColor: 0x081428, grade: null, lampGlow: 0, rimColor: 0xe6f2ff, rimAlpha: 0.5 },
  sunset: {
    vignette: 0.42,
    vignetteColor: 0x1c0a26,
    grade: [0xfff0e2, 0xf4c8b4],
    lampGlow: 0.75,
   
    rimColor: 0xffd29a,
    rimAlpha: 0.62,
  },
  // World 2 — The North Side
  park: { vignette: 0.18, vignetteColor: 0x0c1a20, grade: null, lampGlow: 0, rimColor: 0xfffbe0, rimAlpha: 0.42 },
  lakefront: { vignette: 0.2, vignetteColor: 0x0a1630, grade: [0xfffbf2, 0xfff1de], lampGlow: 0, rimColor: 0xfff2d0, rimAlpha: 0.48 },
  night: {
    vignette: 0.48,
    vignetteColor: 0x060818,
    grade: [0xa9b0e6, 0xbdb6dc],
    lampGlow: 0.95,
    rimColor: 0xb8d0ff,
    rimAlpha: 0.62,
  },
  stadium: {
    vignette: 0.4,
    vignetteColor: 0x080a1c,
    grade: [0xbcc4f0, 0xd2d0ea],
    lampGlow: 0.85,
    rimColor: 0xe8f0ff,
    rimAlpha: 0.68,
  },
};

export function moodFor(theme: string): ThemeMood {
  return THEME_MOOD[theme] ?? THEME_MOOD.day;
}

/** Hit-stop length (rendered frames) for a combat event. Zero in reduced-effects contexts is the caller's call. */
export function hitStopFrames(event: 'stomp' | 'defeat' | 'bossHit' | 'bossDefeat'): number {
  switch (event) {
    case 'stomp':
      return 3;
    case 'defeat':
      return 2;
    case 'bossHit':
      return 3;
    default:
      return 0;
  }
}
