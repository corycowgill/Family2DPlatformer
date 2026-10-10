import { allGlyphs, CAP_HEIGHT, SPACE_WIDTH, sanitizeText } from '../ui/fontGlyphs';

/**
 * Crisp pixel-art SVG snippets for the DOM overlays (touch controls, home-screen tip),
 * drawn with the game's own 5x7 pixel font so the DOM UI matches the in-canvas UI.
 * Pure string builders — no DOM.
 */

let glyphMap: Map<string, ReturnType<typeof allGlyphs>[number]> | null = null;
function glyph(ch: string) {
  if (!glyphMap) glyphMap = new Map(allGlyphs().map((g) => [g.ch, g]));
  return glyphMap.get(ch);
}

/** Rects (in font pixels) for one line of text, origin top-left. Runs are merged per row. */
export function textRects(text: string): { rects: [number, number, number, number][]; w: number; h: number } {
  const rects: [number, number, number, number][] = [];
  let x = 0;
  for (const ch of sanitizeText(text)) {
    if (ch === ' ') {
      x += SPACE_WIDTH + 1;
      continue;
    }
    const g = glyph(ch);
    if (!g) continue;
    g.rows.forEach((row, y) => {
      let start = -1;
      for (let i = 0; i <= row.length; i++) {
        if (row[i] && start < 0) start = i;
        if (!row[i] && start >= 0) {
          rects.push([x + start, y, i - start, 1]);
          start = -1;
        }
      }
    });
    x += g.width + 1;
  }
  return { rects, w: Math.max(0, x - 1), h: CAP_HEIGHT };
}

function rectsToPath(rects: [number, number, number, number][], ox = 0, oy = 0, scale = 1): string {
  return rects.map(([x, y, w, h]) => `M${ox + x * scale} ${oy + y * scale}h${w * scale}v${h * scale}h${-w * scale}z`).join('');
}

/** Standalone SVG of a text line (fill = currentColor), `scale` CSS px per font pixel. */
export function pixelTextSvg(text: string, scale = 2, cls = ''): string {
  const t = textRects(text);
  const W = t.w * scale;
  const H = t.h * scale;
  return `<svg class="${cls}" width="${W}" height="${H}" viewBox="0 0 ${t.w} ${t.h}" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="${rectsToPath(t.rects)}"/></svg>`;
}

/** Cells of a pixel disc of `n`x`n` (true = inside). */
function disc(n: number, inset = 0): boolean[][] {
  const c = (n - 1) / 2;
  const r = n / 2 - inset - 0.15;
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => Math.hypot(x - c, y - c) <= r));
}

function cellsToRects(cells: boolean[][]): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  cells.forEach((row, y) => {
    let start = -1;
    for (let i = 0; i <= row.length; i++) {
      if (row[i] && start < 0) start = i;
      if (!row[i] && start >= 0) {
        out.push([start, y, i - start, 1]);
        start = -1;
      }
    }
  });
  return out;
}

export type PixelLabel = string | { rects: [number, number, number, number][]; w: number; h: number };

/** Pause icon (two bars) in cells. */
export const PAUSE_ICON: PixelLabel = { rects: [[0, 0, 2, 7], [4, 0, 2, 7]], w: 6, h: 7 };

/** Solid pixel triangle pointing `dir`, `len` cells along the point axis (base = 2*len - 1). */
export function triangleIcon(dir: 'left' | 'right' | 'up' | 'down', len: number): PixelLabel {
  const rects: [number, number, number, number][] = [];
  const base = 2 * len - 1;
  for (let i = 0; i < len; i++) {
    const span = 2 * i + 1; // width of slice i, counted from the tip
    const off = len - 1 - i;
    if (dir === 'up') rects.push([off, i, span, 1]);
    else if (dir === 'down') rects.push([off, len - 1 - i, span, 1]);
    else if (dir === 'left') rects.push([i, off, 1, span]);
    else rects.push([len - 1 - i, off, 1, span]);
  }
  const horizontal = dir === 'up' || dir === 'down';
  return { rects, w: horizontal ? base : len, h: horizontal ? len : base };
}

/** Six-pointed (Chicago) star rasterised at pixel centres, `d` cells across. */
export function starIcon(d: number): PixelLabel {
  const c = d / 2;
  const R = d / 2;
  const pts: [number, number][] = [];
  for (let i = 0; i < 12; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 6;
    const r = i % 2 === 0 ? R : R * 0.55;
    pts.push([c + Math.cos(a) * r, c + Math.sin(a) * r]);
  }
  const inside = (x: number, y: number) => {
    let hit = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const rects: [number, number, number, number][] = [];
  for (let y = 0; y < d; y++) for (let x = 0; x < d; x++) if (inside(x + 0.5, y + 0.5)) rects.push([x, y, 1, 1]);
  return { rects, w: d, h: d };
}

/**
 * A round pixel button: outer ring (class "ring"), body ("body"), a 1-cell highlight arc
 * ("hi") and a centred label made of font glyphs ("glyph") at `glyphScale` cells per font pixel.
 * Colours come from CSS so pressed / latched states are pure class changes.
 */
export function pixelButtonSvg(n: number, label: PixelLabel, glyphScale: number): string {
  const outer = disc(n);
  const inner = disc(n, 1);
  const ring = outer.map((row, y) => row.map((v, x) => v && !inner[y][x]));
  const hiCells = inner.map((row, y) => row.map((v, x) => v && !inner[y - 1]?.[x] && y < n / 2));
  const t = typeof label === 'string' ? textRects(label) : label;
  // Centre on the ink's bounding box (glyphs such as ▲ have empty rows).
  const minX = Math.min(...t.rects.map((r) => r[0]));
  const maxX = Math.max(...t.rects.map((r) => r[0] + r[2]));
  const minY = Math.min(...t.rects.map((r) => r[1]));
  const maxY = Math.max(...t.rects.map((r) => r[1] + r[3]));
  const ox = Math.round((n - (maxX - minX) * glyphScale) / 2) - minX * glyphScale;
  const oy = Math.round((n - (maxY - minY) * glyphScale) / 2) - minY * glyphScale;
  return (
    `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" aria-hidden="true">` +
    `<path class="body" d="${rectsToPath(cellsToRects(inner))}"/>` +
    `<path class="hi" d="${rectsToPath(cellsToRects(hiCells))}"/>` +
    `<path class="ring" d="${rectsToPath(cellsToRects(ring))}"/>` +
    `<path class="glyph-shadow" d="${rectsToPath(t.rects, ox + glyphScale, oy + glyphScale, glyphScale)}"/>` +
    `<path class="glyph" d="${rectsToPath(t.rects, ox, oy, glyphScale)}"/>` +
    `</svg>`
  );
}
