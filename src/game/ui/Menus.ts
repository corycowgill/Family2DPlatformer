import Phaser from 'phaser';
import { px, setPx } from './PixelFont';
import { onNav, type NavAction } from './NavInput';
import { COLORS, drawPanel } from './Widgets';
import { audio } from '../systems/AudioSystem';
import { reducedMotion } from './Transitions';

export const UI_FONT = 'monospace';

/**
 * @deprecated Canvas text is blurry at 480x270 — use `px()` from ui/PixelFont instead.
 * Kept for compatibility with code outside the UI module.
 */
export function text(scene: Phaser.Scene, x: number, y: number, s: string, size = 10, color = '#ffffff'): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, s, { fontFamily: UI_FONT, fontSize: `${size}px`, color, stroke: '#0b1730', strokeThickness: 3, resolution: 2 })
    .setOrigin(0.5);
}

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** Value shown at the right of the row (settings). */
  value?: () => string;
  /** Left/right adjustment (settings). */
  onAdjust?: (dir: -1 | 1) => void;
  /** Sound on select (default 'menu-select'; null = silent). */
  sound?: string | null;
}

export interface MenuOptions {
  /** Pixel-font scale of labels (default 1). */
  scale?: number;
  /** Row width — hit area, panel width, and label/value split (default 180). */
  width?: number;
  /** Draw a panel behind the menu. */
  panel?: boolean;
  onBack?: () => void;
  startIndex?: number;
  depth?: number;
}

export interface MenuHandle {
  destroy: () => void;
  refresh: () => void;
  setIndex: (i: number) => void;
  readonly index: number;
  labels: Phaser.GameObjects.BitmapText[];
}

/** Pure: next enabled index moving `d` from `index` (wrapping). Returns index unchanged if none enabled. */
export function nextEnabled(items: { disabled?: boolean }[], index: number, d: number): number {
  if (items.every((i) => i.disabled)) return index;
  let i = index;
  do i = (i + d + items.length) % items.length;
  while (items[i].disabled);
  return i;
}

/**
 * Vertical menu navigable by keyboard (arrows/WASD + Enter/Space/Z/J, Esc back), gamepad
 * (d-pad/stick + A/Start, B back) and touch/mouse (hover highlights, tap activates; on
 * value rows tap the left/right third to adjust).
 */
export function createMenu(scene: Phaser.Scene, items: MenuItem[], x: number, y: number, spacing = 18, opts: MenuOptions = {}): MenuHandle {
  const scale = opts.scale ?? 1;
  const width = opts.width ?? 180;
  const depth = opts.depth ?? 10;
  let index = opts.startIndex !== undefined && !items[opts.startIndex]?.disabled ? opts.startIndex : nextEnabled(items, -1, 1);
  const objs: Phaser.GameObjects.GameObject[] = [];

  if (opts.panel) {
    const g = drawPanel(scene.add.graphics(), x - width / 2 - 6, y - spacing / 2 - 6, width + 12, spacing * items.length + 12);
    g.setDepth(depth - 1);
    objs.push(g);
  }
  const hl = scene.add.graphics().setDepth(depth - 0.5);
  objs.push(hl);

  const labels: Phaser.GameObjects.BitmapText[] = [];
  const values: (Phaser.GameObjects.BitmapText | null)[] = [];
  items.forEach((it, i) => {
    const ry = Math.round(y + i * spacing);
    const split = !!it.value;
    const l = px(scene, split ? x - width / 2 + 10 : x, ry, it.label, { scale, origin: split ? [0, 0.5] : 0.5 }).setDepth(depth);
    labels.push(l);
    objs.push(l);
    let v: Phaser.GameObjects.BitmapText | null = null;
    if (split) {
      v = px(scene, x + width / 2 - 10, ry, '', { scale, origin: [1, 0.5] }).setDepth(depth);
      objs.push(v);
    }
    values.push(v);
    const zone = scene.add.zone(x, ry, width, spacing).setInteractive({ useHandCursor: true });
    objs.push(zone);
    let pressed = false;
    zone.on('pointerover', () => {
      if (it.disabled || index === i) return;
      index = i;
      audio.sfx('menu-move');
      refresh();
    });
    zone.on('pointerdown', () => {
      pressed = true;
      if (!it.disabled) l.setScale(scale * 0.92);
    });
    zone.on('pointerout', () => {
      pressed = false;
      l.setScale(scale);
    });
    zone.on('pointerup', (p: Phaser.Input.Pointer) => {
      l.setScale(scale);
      if (!pressed) return;
      pressed = false;
      index = i;
      if (it.disabled) {
        audio.sfx('menu-error');
        return;
      }
      if (it.onAdjust) {
        const rel = p.x - x;
        if (rel < -width / 6) return adjust(-1);
        if (rel > width / 6 || !it.onSelect) return adjust(1);
      }
      activate();
    });
  });

  const cursor = px(scene, 0, 0, '▶', { color: COLORS.gold }).setDepth(depth);
  objs.push(cursor);
  let cursorX = 0;
  const still = reducedMotion();
  const onUpdate = (time: number) => {
    cursor.x = cursorX + (still ? 0 : Math.round(Math.sin(time / 110) + 1));
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);

  const refresh = () => {
    hl.clear();
    items.forEach((it, i) => {
      const sel = i === index;
      const col = it.disabled ? COLORS.dim : sel ? COLORS.gold : COLORS.text;
      labels[i].setTint(col);
      const v = values[i];
      if (v && it.value) {
        setPx(v, sel && it.onAdjust ? `◀ ${it.value()} ▶` : it.value());
        v.setTint(it.disabled ? COLORS.dim : sel ? COLORS.text : COLORS.sub);
      }
    });
    const l = labels[index];
    if (!l) return;
    const ry = Math.round(y + index * spacing);
    hl.fillStyle(COLORS.gold, 0.12).fillRect(Math.round(x - width / 2), ry - Math.floor(spacing / 2) + 1, width, spacing - 2);
    hl.fillStyle(COLORS.gold, 0.6).fillRect(Math.round(x - width / 2), ry - Math.floor(spacing / 2) + 1, 2, spacing - 2);
    const left = items[index].value ? x - width / 2 + 10 : l.x - l.width / 2;
    cursorX = Math.round(left - 9);
    cursor.setPosition(cursorX, ry);
  };

  const activate = () => {
    const it = items[index];
    if (!it || it.disabled) return;
    if (!it.onSelect && it.onAdjust) return adjust(1);
    if (it.sound !== null) audio.sfx(it.sound ?? 'menu-select');
    it.onSelect?.();
  };
  const adjust = (d: -1 | 1) => {
    const it = items[index];
    if (!it?.onAdjust || it.disabled) return;
    it.onAdjust(d);
    audio.sfx('menu-move');
    refresh();
  };

  const offNav = onNav(scene, (a: NavAction) => {
    if (a === 'up' || a === 'down') {
      const ni = nextEnabled(items, index, a === 'up' ? -1 : 1);
      if (ni !== index) {
        index = ni;
        audio.sfx('menu-move');
        refresh();
      }
    } else if (a === 'left' || a === 'right') adjust(a === 'left' ? -1 : 1);
    else if (a === 'confirm') activate();
    else if (a === 'back' && opts.onBack) {
      audio.sfx('menu-back');
      opts.onBack();
    }
  });

  refresh();
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    offNav();
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    objs.forEach((o) => o.destroy());
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, destroy);
  return {
    destroy,
    refresh,
    setIndex: (i: number) => {
      index = i;
      refresh();
    },
    get index() {
      return index;
    },
    labels,
  };
}
