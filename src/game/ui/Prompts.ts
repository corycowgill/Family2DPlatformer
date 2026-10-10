import Phaser from 'phaser';
import { allGlyphs, CAP_HEIGHT, measureLine, sanitizeText } from './fontGlyphs';
import { px } from './PixelFont';
import { drawPanel } from './Widgets';
import { getInputDevice, onInputDeviceChange, type InputDevice } from '../systems/InputDevice';

/**
 * Device-aware button prompts. Templates use tokens like `{JUMP}` that resolve to the
 * active device's glyph: keyboard keycaps ("SPACE", "J"…), Xbox buttons (coloured A/B/X/Y
 * circles, Menu/View icons, LB/RB/LT/RT pills, d-pad, stick) or touch-button hints.
 * Glyphs are tiny pixel-art canvas textures generated on first use (crisp at 480x270).
 * Prompt objects re-render live when the active input device changes.
 */

export type PromptToken =
  | 'JUMP' | 'RUN' | 'ABILITY' | 'MOVE' | 'CROUCH' | 'PAUSE'
  | 'CONFIRM' | 'BACK' | 'NAV' | 'CHOOSE' | 'ADJUST' | 'HERO';

/** A glyph is `pad:<name>`, `key:<label>` or `touch:<name>`. */
export type GlyphId = string;

const KEYBOARD: Record<PromptToken, GlyphId[]> = {
  JUMP: ['key:SPACE'],
  RUN: ['key:SHIFT'],
  ABILITY: ['key:J'],
  MOVE: ['key:◀▲▼▶'],
  CROUCH: ['key:▼'],
  PAUSE: ['key:ESC'],
  CONFIRM: ['key:ENTER'],
  BACK: ['key:ESC'],
  NAV: ['key:▲▼'],
  CHOOSE: ['key:◀▶'],
  ADJUST: ['key:◀▶'],
  HERO: ['key:C'],
};

const GAMEPAD: Record<PromptToken, GlyphId[]> = {
  JUMP: ['pad:A'],
  RUN: ['pad:RT'],
  ABILITY: ['pad:X'],
  MOVE: ['pad:LS'],
  CROUCH: ['pad:DPAD'],
  PAUSE: ['pad:MENU'],
  CONFIRM: ['pad:A'],
  BACK: ['pad:B'],
  NAV: ['pad:DPAD'],
  CHOOSE: ['pad:DPAD'],
  ADJUST: ['pad:DPAD'],
  HERO: ['pad:Y'],
};

const TOUCH: Record<PromptToken, GlyphId[]> = {
  JUMP: ['touch:JUMP'],
  RUN: ['touch:RUN'],
  ABILITY: ['touch:ABILITY'],
  MOVE: ['touch:MOVE'],
  CROUCH: ['touch:DOWN'],
  PAUSE: ['touch:PAUSE'],
  CONFIRM: ['touch:TAP'],
  BACK: ['touch:TAP'],
  NAV: ['touch:TAP'],
  CHOOSE: ['touch:TAP'],
  ADJUST: ['touch:TAP'],
  HERO: ['touch:TAP'],
};

const TABLES: Record<InputDevice, Record<PromptToken, GlyphId[]>> = { keyboard: KEYBOARD, gamepad: GAMEPAD, touch: TOUCH };

export function isPromptToken(s: string): s is PromptToken {
  return Object.prototype.hasOwnProperty.call(KEYBOARD, s);
}

/** Pure: glyph ids for a token on a device. */
export function glyphsFor(token: PromptToken, device: InputDevice): GlyphId[] {
  return TABLES[device][token];
}

export type Segment = { text: string } | { glyph: GlyphId };

/** Pure: split a template ("HOLD {RUN} TO RUN") into text and glyph segments for a device. */
export function resolveTemplate(template: string, device: InputDevice): Segment[][] {
  return template.split('\n').map((line) => {
    const out: Segment[] = [];
    const re = /\{((?:key|pad|touch):[^}]+|[A-Z]+)\}/g;
    let last = 0;
    let m: RegExpExecArray | null;
    const pushText = (t: string) => {
      if (!t) return;
      const prev = out[out.length - 1];
      if (prev && 'text' in prev) prev.text += t;
      else out.push({ text: t });
    };
    while ((m = re.exec(line))) {
      pushText(line.slice(last, m.index));
      if (isPromptToken(m[1])) glyphsFor(m[1], device).forEach((g) => out.push({ glyph: g }));
      else if (m[1].includes(':')) out.push({ glyph: m[1] }); // explicit glyph, e.g. {pad:A} {key:SPACE}
      else pushText(m[0]);
      last = m.index + m[0].length;
    }
    pushText(line.slice(last));
    return out;
  });
}

/** Pure: the template with tokens replaced by plain words (for text-only consumers/tests). */
export function templateToText(template: string, device: InputDevice): string {
  return resolveTemplate(template, device)
    .map((line) => line.map((s) => ('text' in s ? s.text : glyphLabel(s.glyph))).join(''))
    .join('\n');
}

/** Pure: short text name of a glyph ("A", "RT", "SPACE"). */
export function glyphLabel(g: GlyphId): string {
  const [kind, name] = [g.slice(0, g.indexOf(':')), g.slice(g.indexOf(':') + 1)];
  if (kind === 'touch') return name === 'TAP' ? 'TAP' : name;
  return name;
}

// ------------------------------------------------------------------ glyph textures

export const GLYPH_H = 13;
const INK = 0x0b1730;
const FACE: Record<string, [number, number]> = {
  // [button colour, letter colour]
  A: [0x3cb44a, 0xffffff],
  B: [0xe03a3e, 0xffffff],
  X: [0x2f78e0, 0xffffff],
  Y: [0xf2c230, INK],
};
const PAD_GREY = 0x3b4560;
const PAD_LIGHT = 0xc9d2e3;

type Painter = { w: number; h: number; set: (x: number, y: number, c: number) => void; text: (x: number, y: number, s: string, c: number) => void };

let glyphMap: Map<string, boolean[][]> | null = null;
function fontRows(ch: string): boolean[][] | null {
  if (!glyphMap) glyphMap = new Map(allGlyphs().map((g) => [g.ch, g.rows]));
  return glyphMap.get(ch) ?? null;
}

/** Width in pixels of a glyph's label text. */
const labelW = (s: string) => measureLine(s);

function paint(scene: Phaser.Scene, key: string, w: number, h: number, draw: (p: Painter) => void): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  const img = ctx.createImageData(w, h);
  const set = (x: number, y: number, c: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    img.data[i] = (c >> 16) & 255;
    img.data[i + 1] = (c >> 8) & 255;
    img.data[i + 2] = c & 255;
    img.data[i + 3] = 255;
  };
  const text = (x: number, y: number, s: string, c: number) => {
    let cx = x;
    for (const ch of sanitizeText(s)) {
      if (ch === ' ') {
        cx += 4;
        continue;
      }
      const rows = fontRows(ch);
      if (!rows) continue;
      for (let ry = 0; ry < CAP_HEIGHT; ry++) for (let rx = 0; rx < rows[ry].length; rx++) if (rows[ry][rx]) set(cx + rx, y + ry, c);
      cx += rows[0].length + 1;
    }
  };
  draw({ w, h, set, text });
  ctx.putImageData(img, 0, 0);
  tex.refresh();
}

function disc(p: Painter, cx: number, cy: number, r: number, c: number): void {
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) p.set(x, y, c);
}

/** Rounded (notched) rectangle with a 1px ink border. */
function pill(p: Painter, fill: number, notchTop = 1): void {
  const { w, h } = p;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nt = y < notchTop ? notchTop - y : 0;
      const nb = y === h - 1 ? 1 : 0;
      const n = Math.max(nt, nb);
      if (x < n || x >= w - n) continue;
      const edge = y === 0 || y === h - 1 || x === n || x === w - 1 - n || (y < notchTop && (x === n + 1 || x === w - 2 - n));
      p.set(x, y, edge ? INK : fill);
    }
}

/** Texture key for a glyph (generated on demand). */
export function glyphTexture(scene: Phaser.Scene, g: GlyphId): string {
  const key = `prompt-${g}`;
  if (scene.textures.exists(key)) return key;
  const kind = g.slice(0, g.indexOf(':'));
  const name = g.slice(g.indexOf(':') + 1);
  const H = GLYPH_H;
  const c = (H - 1) / 2;
  if (kind === 'pad' && FACE[name]) {
    const [bg, fg] = FACE[name];
    paint(scene, key, H, H, (p) => {
      disc(p, c, c, 6.5, INK);
      disc(p, c, c, 5.6, bg);
      p.text(c - Math.floor(labelW(name) / 2), 3, name, fg);
    });
  } else if (kind === 'pad' && (name === 'MENU' || name === 'VIEW')) {
    paint(scene, key, H, H, (p) => {
      disc(p, c, c, 6.5, INK);
      disc(p, c, c, 5.6, PAD_GREY);
      if (name === 'MENU') for (const y of [4, 6, 8]) for (let x = 4; x <= 8; x++) p.set(x, y, 0xffffff);
      else {
        for (let i = 0; i < 4; i++) {
          p.set(3 + i, 3, 0xffffff); p.set(3, 3 + i, 0xffffff); p.set(6, 3 + i, 0xffffff);
        }
        for (let y = 5; y <= 9; y++) for (let x = 5; x <= 9; x++) p.set(x, y, 0xffffff);
      }
    });
  } else if (kind === 'pad' && name === 'DPAD') {
    paint(scene, key, H, H, (p) => {
      for (let y = 0; y < H; y++)
        for (let x = 0; x < H; x++) {
          const inV = x >= 4 && x <= 8;
          const inH = y >= 4 && y <= 8;
          if (!inV && !inH) continue;
          const border = (inV && (x === 4 || x === 8) && !(inH && y > 4 && y < 8)) || (inH && (y === 4 || y === 8) && !(inV && x > 4 && x < 8)) || y === 0 || y === H - 1 || x === 0 || x === H - 1;
          p.set(x, y, border ? INK : PAD_LIGHT);
        }
      p.set(6, 6, PAD_GREY);
      for (const [x, y] of [[6, 2], [6, 10], [2, 6], [10, 6]]) p.set(x, y, PAD_GREY);
    });
  } else if (kind === 'pad' && (name === 'LS' || name === 'RS')) {
    paint(scene, key, H, H, (p) => {
      disc(p, c, c, 6.5, INK);
      disc(p, c, c, 5.6, PAD_GREY);
      disc(p, c, c, 3.6, INK);
      disc(p, c, c, 2.7, PAD_LIGHT);
      p.set(5, 5, 0xffffff);
    });
  } else if (kind === 'pad' && name === 'CONTROLLER') {
    // Tiny controller silhouette (toasts).
    const w = 17;
    const inBody = (x: number, y: number) =>
      (x >= 2 && x <= 14 && y >= 2 && y <= 8 && !((x === 2 || x === 14) && y === 2)) || (x - 4.5) ** 2 + (y - 9) ** 2 <= 5 || (x - 11.5) ** 2 + (y - 9) ** 2 <= 5;
    paint(scene, key, w, H, (p) => {
      for (let y = 0; y < H; y++)
        for (let x = 0; x < w; x++) {
          if (inBody(x, y)) p.set(x, y, PAD_LIGHT);
          else if (inBody(x - 1, y) || inBody(x + 1, y) || inBody(x, y - 1) || inBody(x, y + 1)) p.set(x, y, INK);
        }
      for (const [x, y] of [[5, 4], [4, 5], [5, 5], [6, 5], [5, 6]]) p.set(x, y, PAD_GREY);
      p.set(11, 5, FACE.X[0]);
      p.set(13, 5, FACE.B[0]);
      p.set(12, 4, FACE.Y[0]);
      p.set(12, 6, FACE.A[0]);
    });
  } else if (kind === 'pad') {
    // LB / RB / LT / RT pills (triggers get a rounder top).
    const trig = name.endsWith('T');
    const w = labelW(name) + 6;
    paint(scene, key, w, H, (p) => {
      pill(p, PAD_GREY, trig ? 2 : 1);
      p.text(3, 3, name, 0xffffff);
    });
  } else if (kind === 'key') {
    const w = Math.max(H, labelW(name) + 6);
    paint(scene, key, w, H, (p) => {
      pill(p, 0xe9edf5, 1);
      for (let x = 2; x < w - 2; x++) p.set(x, H - 2, 0x8f9bb3);
      p.text(Math.floor((w - labelW(name)) / 2), 3, name, INK);
    });
  } else {
    // touch hints
    const label = { JUMP: '▲', ABILITY: '★', RUN: 'RUN', MOVE: '◀▶', DOWN: '▼', PAUSE: 'II', TAP: 'TAP' }[name] ?? name;
    const round = name === 'JUMP' || name === 'ABILITY' || name === 'DOWN';
    const w = round ? H : labelW(label) + 6;
    paint(scene, key, w, H, (p) => {
      if (round) {
        disc(p, c, c, 6.5, 0xffffff);
        disc(p, c, c, 5.6, 0x2a3f6e);
      } else pill(p, 0x2a3f6e, 1);
      const lw = labelW(label);
      p.text(Math.floor((w - lw) / 2), name === 'JUMP' ? 2 : name === 'DOWN' ? 4 : 3, label, 0xffffff);
    });
  }
  return key;
}

// ------------------------------------------------------------------ rendering

export type Template = string | ((device: InputDevice) => string);

export interface PromptOptions {
  /** Text colour (tint). */
  color?: number;
  /** Origin of the whole block (default centred). */
  origin?: number | [number, number];
  depth?: number;
  /** Draw a panel behind (signs). */
  bg?: boolean;
  /** Horizontal alignment of lines inside a multi-line block. */
  align?: 'left' | 'center';
}

const LINE_GAP = GLYPH_H + 1;

/**
 * Text with inline device glyphs. `template` may be a function of the device (e.g. a
 * different hint for touch). Re-renders automatically when the input device changes.
 */
export class PromptText extends Phaser.GameObjects.Container {
  private template: Template;
  private opts: PromptOptions;
  private unsubscribe: () => void;
  private device: InputDevice;
  /** Block size in pixels after the last render. */
  blockW = 0;
  blockH = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, template: Template, opts: PromptOptions = {}) {
    super(scene, Math.round(x), Math.round(y));
    this.template = template;
    this.opts = opts;
    this.device = getInputDevice();
    scene.add.existing(this);
    if (opts.depth !== undefined) this.setDepth(opts.depth);
    this.unsubscribe = onInputDeviceChange((d) => {
      this.device = d;
      if (this.scene) this.render();
    });
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.unsubscribe());
    this.render();
  }

  setTemplate(t: Template): this {
    this.template = t;
    this.render();
    return this;
  }

  /** Current resolved string (glyphs as words) — handy for tests. */
  get plainText(): string {
    return templateToText(this.resolveString(), this.device);
  }

  private resolveString(): string {
    return typeof this.template === 'function' ? this.template(this.device) : this.template;
  }

  private render(): void {
    this.removeAll(true);
    const lines = resolveTemplate(this.resolveString(), this.device);
    const scene = this.scene;
    const color = this.opts.color ?? 0xffffff;
    // Measure
    const widths = lines.map((segs) =>
      segs.reduce((w, s, i) => {
        if ('text' in s) return w + measureLine(s.text) + (i > 0 ? 1 : 0);
        const tex = scene.textures.get(glyphTexture(scene, s.glyph));
        return w + tex.getSourceImage().width + (i > 0 ? 1 : 0);
      }, 0),
    );
    const W = Math.max(0, ...widths);
    const H = lines.length * LINE_GAP - 1;
    const o = this.opts.origin ?? 0.5;
    const [ox, oy] = Array.isArray(o) ? o : [o, o];
    const left = -Math.floor(W * ox);
    const top = -Math.floor(H * oy);
    this.blockW = W;
    this.blockH = H;
    if (this.opts.bg && W > 0) {
      const g = scene.add.graphics();
      drawPanel(g, left - 5, top - 4, W + 10, H + 8, { alpha: 0.92 });
      this.add(g);
    }
    lines.forEach((segs, li) => {
      const cy = top + li * LINE_GAP + Math.floor(GLYPH_H / 2);
      let x = left + (this.opts.align === 'left' ? 0 : Math.round((W - widths[li]) / 2));
      segs.forEach((s, i) => {
        if (i > 0) x += 1;
        if ('text' in s) {
          if (s.text.trim()) this.add(px(scene, x, cy - 3, s.text, { origin: [0, 0], color }));
          x += measureLine(s.text);
        } else {
          const key = glyphTexture(scene, s.glyph);
          const img = scene.add.image(x, cy - Math.floor(GLYPH_H / 2), key).setOrigin(0, 0);
          img.setData('glyph', s.glyph);
          this.add(img);
          x += img.width;
        }
      });
    });
  }
}

/** Add a prompt line/block to a scene. */
export function prompt(scene: Phaser.Scene, x: number, y: number, template: Template, opts: PromptOptions = {}): PromptText {
  return new PromptText(scene, x, y, template, opts);
}

/** Glyph ids currently shown by prompts in a scene (tests / debug). */
export function shownGlyphs(scene: Phaser.Scene): GlyphId[] {
  const out: GlyphId[] = [];
  for (const o of scene.children.list) {
    if (o instanceof PromptText && o.visible) for (const c of o.list) if (c instanceof Phaser.GameObjects.Image && c.getData('glyph')) out.push(c.getData('glyph') as string);
  }
  return out;
}
