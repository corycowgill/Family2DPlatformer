import Phaser from 'phaser';
import { allGlyphs, GLYPH_ROWS, sanitizeText, SPACE_WIDTH } from './fontGlyphs';

/**
 * Runtime-generated bitmap fonts (crisp at 480x270, unlike canvas Text):
 *   FONT.plain   — white glyphs, tint to colour
 *   FONT.outline — white glyphs with a 1px dark outline baked in (tint keeps the outline dark)
 * Font size 8 = 1x; use 16 / 24 for 2x / 3x.
 */
export const FONT = { plain: 'px', outline: 'pxo' } as const;
export const FONT_BASE_SIZE = 8;
export const LINE_HEIGHT = GLYPH_ROWS + 2;
const OUTLINE_RGB = [11, 23, 48];

function buildFont(scene: Phaser.Scene, key: string, outline: boolean): void {
  if (scene.cache.bitmapFont.exists(key)) return;
  const glyphs = allGlyphs();
  const pad = outline ? 1 : 0;
  const cellH = GLYPH_ROWS + pad * 2;
  const sheetW = 256;
  // Layout glyph cells in rows.
  const placed: { g: (typeof glyphs)[number]; x: number; y: number; w: number }[] = [];
  let cx = 0;
  let cy = 0;
  for (const g of glyphs) {
    const w = g.width + pad * 2;
    if (cx + w > sheetW) {
      cx = 0;
      cy += cellH + 1;
    }
    placed.push({ g, x: cx, y: cy, w });
    cx += w + 1;
  }
  const sheetH = Phaser.Math.Pow2.GetNext(cy + cellH + 1);
  const tex = scene.textures.createCanvas(`${key}-tex`, sheetW, sheetH);
  if (!tex) return;
  const ctx = tex.getContext();
  const img = ctx.createImageData(sheetW, sheetH);
  const put = (x: number, y: number, rgb: number[]) => {
    const i = (y * sheetW + x) * 4;
    img.data[i] = rgb[0];
    img.data[i + 1] = rgb[1];
    img.data[i + 2] = rgb[2];
    img.data[i + 3] = 255;
  };
  for (const p of placed) {
    const { g } = p;
    if (outline) {
      for (let y = 0; y < GLYPH_ROWS; y++)
        for (let x = 0; x < g.width; x++) {
          if (!g.rows[y][x]) continue;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) put(p.x + pad + x + dx, p.y + pad + y + dy, OUTLINE_RGB);
        }
    }
    for (let y = 0; y < GLYPH_ROWS; y++)
      for (let x = 0; x < g.width; x++) if (g.rows[y][x]) put(p.x + pad + x, p.y + pad + y, [255, 255, 255]);
  }
  ctx.putImageData(img, 0, 0);
  tex.refresh();

  const chars: Record<number, unknown> = {};
  const entry = (code: number, x: number, y: number, w: number, h: number, adv: number) => {
    chars[code] = {
      x, y, width: w, height: h,
      centerX: Math.floor(w / 2), centerY: Math.floor(h / 2),
      xOffset: -pad, yOffset: -pad, xAdvance: adv,
      data: {}, kerning: {},
      u0: x / sheetW, v0: y / sheetH, u1: (x + w) / sheetW, v1: (y + h) / sheetH,
    };
  };
  for (const p of placed) entry(p.g.ch.charCodeAt(0), p.x, p.y, p.w, cellH, p.g.width + 1);
  entry(32, 0, 0, 0, 0, SPACE_WIDTH + 1);
  scene.cache.bitmapFont.add(key, {
    data: { font: key, size: FONT_BASE_SIZE, lineHeight: LINE_HEIGHT, retroFont: true, chars },
    texture: `${key}-tex`,
    frame: null,
  });
}

/** Generate both fonts (idempotent). Call once at boot. */
export function ensurePixelFonts(scene: Phaser.Scene): void {
  buildFont(scene, FONT.plain, false);
  buildFont(scene, FONT.outline, true);
}

export interface PxOptions {
  /** Integer scale (1 = 7px capitals). */
  scale?: number;
  color?: number | string;
  outline?: boolean;
  /** Origin; default centred (0.5). */
  origin?: number | [number, number];
  align?: 'left' | 'center' | 'right';
  maxWidth?: number;
  depth?: number;
}

export const toColor = (c: number | string): number => (typeof c === 'number' ? c : Phaser.Display.Color.HexStringToColor(c).color);

/** Add crisp pixel text. Unsupported characters are mapped by sanitizeText. */
export function px(scene: Phaser.Scene, x: number, y: number, str: string, opts: PxOptions = {}): Phaser.GameObjects.BitmapText {
  ensurePixelFonts(scene);
  const t = scene.add.bitmapText(x, y, opts.outline === false ? FONT.plain : FONT.outline, sanitizeText(str), FONT_BASE_SIZE * (opts.scale ?? 1));
  const o = opts.origin ?? 0.5;
  if (Array.isArray(o)) t.setOrigin(o[0], o[1]);
  else t.setOrigin(o);
  if (opts.align === 'center' || (opts.align === undefined && o === 0.5)) t.setCenterAlign();
  else if (opts.align === 'right') t.setRightAlign();
  if (opts.maxWidth) t.setMaxWidth(opts.maxWidth);
  if (opts.color !== undefined) t.setTint(toColor(opts.color));
  if (opts.depth !== undefined) t.setDepth(opts.depth);
  return t;
}

/** Set text on a pixel-font object, sanitising unsupported characters. */
export function setPx(t: Phaser.GameObjects.BitmapText, str: string): Phaser.GameObjects.BitmapText {
  return t.setText(sanitizeText(str));
}
