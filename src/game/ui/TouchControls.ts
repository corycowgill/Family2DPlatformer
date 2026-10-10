import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, DEPTH } from '../config';
import { virtualButtons, clearVirtualButtons, type VirtualButtons } from '../systems/InputSystem';
import { saveSystem } from '../systems/SaveSystem';
import { px } from './PixelFont';

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && ('ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0);
}

export function shouldShowTouch(): boolean {
  const pref = saveSystem.get().settings.showTouchControls;
  if (pref !== 'auto') return pref === 'on';
  return isTouchDevice();
}

export type TouchButton = 'left' | 'right' | 'down' | 'jump' | 'attack' | 'run';

interface Circle {
  id: TouchButton;
  x: number;
  y: number;
  r: number;
  /** Hit radius (bigger than the drawn button for fat-finger tolerance). */
  hit: number;
  label: string;
}

const B = GAME_HEIGHT;
export const TOUCH_LAYOUT: Circle[] = [
  { id: 'left', x: 28, y: B - 30, r: 18, hit: 0, label: '◀' },
  { id: 'right', x: 78, y: B - 30, r: 18, hit: 0, label: '▶' },
  { id: 'down', x: 53, y: B - 66, r: 11, hit: 15, label: '▼' },
  { id: 'jump', x: GAME_WIDTH - 30, y: B - 34, r: 21, hit: 30, label: '▲' },
  { id: 'attack', x: GAME_WIDTH - 76, y: B - 22, r: 16, hit: 22, label: '★' },
  { id: 'run', x: GAME_WIDTH - 70, y: B - 64, r: 11, hit: 15, label: 'RUN' },
];

/**
 * Pure: which button a touch at (x, y) presses. The left cluster is a split zone (the whole
 * bottom-left corner), so a thumb can rock between left and right without lifting.
 */
export function hitTest(x: number, y: number): TouchButton | null {
  if (x < 112 && y > B - 82) {
    const d = TOUCH_LAYOUT[2];
    if (Math.hypot(x - d.x, y - d.y) <= d.hit) return 'down';
    if (y > B - 54) return x < 53 ? 'left' : 'right';
    return null;
  }
  let best: TouchButton | null = null;
  let bestD = Infinity;
  for (const c of TOUCH_LAYOUT) {
    if (!c.hit) continue;
    if (c.id === 'down') continue;
    const dist = Math.hypot(x - c.x, y - c.y);
    if (dist <= c.hit && dist < bestD) {
      best = c.id;
      bestD = dist;
    }
  }
  return best;
}

/**
 * On-screen buttons writing to `virtualButtons`. Polls every active pointer each frame
 * (true multi-touch: hold ▶ and tap ▲ together). RUN is a latching toggle.
 * Only writes virtualButtons when its own state changes, so it never fights other writers.
 */
export class TouchControls {
  private gfx: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.BitmapText[] = [];
  private held = new Set<TouchButton>();
  private runLatched = false;
  private runWasDown = false;
  private visible = false;

  constructor(private scene: Phaser.Scene) {
    clearVirtualButtons();
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, clearVirtualButtons);
    this.gfx = scene.add.graphics().setDepth(DEPTH.touch).setScrollFactor(0);
    for (const c of TOUCH_LAYOUT) {
      this.labels.push(px(scene, c.x, c.y, c.label, { color: 0xffffff }).setDepth(DEPTH.touch + 1).setAlpha(0.85));
    }
    try {
      this.runLatched = localStorage.getItem('cfa-touch-run') === '1';
    } catch {
      /* ignore */
    }
    this.setVisible(shouldShowTouch());
  }

  private setVisible(on: boolean): void {
    this.visible = on;
    this.gfx.setVisible(on);
    this.labels.forEach((l) => l.setVisible(on));
    if (on && this.runLatched) virtualButtons.run = true;
    this.draw();
  }

  private draw(): void {
    const g = this.gfx;
    g.clear();
    if (!this.visible) return;
    for (const c of TOUCH_LAYOUT) {
      const on = this.held.has(c.id) || (c.id === 'run' && this.runLatched);
      g.fillStyle(0x0b1730, on ? 0.5 : 0.28).fillCircle(c.x, c.y, c.r);
      g.fillStyle(c.id === 'run' && this.runLatched ? 0xffd25a : 0xffffff, on ? 0.45 : 0.14).fillCircle(c.x, c.y, c.r - 1);
      g.lineStyle(1, 0xffffff, on ? 0.9 : 0.45).strokeCircle(c.x, c.y, c.r);
    }
  }

  update(): void {
    const want = shouldShowTouch();
    if (want !== this.visible) this.setVisible(want);
    if (!this.visible) return;
    const now = new Set<TouchButton>();
    for (const p of this.scene.input.manager.pointers) {
      if (!p || !p.isDown) continue;
      const b = hitTest(p.x, p.y);
      if (b) now.add(b);
    }
    // RUN toggles on press.
    const runDown = now.has('run');
    if (runDown && !this.runWasDown) {
      this.runLatched = !this.runLatched;
      virtualButtons.run = this.runLatched;
      try {
        localStorage.setItem('cfa-touch-run', this.runLatched ? '1' : '0');
      } catch {
        /* ignore */
      }
    }
    this.runWasDown = runDown;
    let changed = runDown !== this.held.has('run');
    for (const k of ['left', 'right', 'down', 'jump', 'attack'] as (keyof VirtualButtons & TouchButton)[]) {
      const isOn = now.has(k);
      if (isOn !== this.held.has(k)) {
        virtualButtons[k] = isOn;
        changed = true;
      }
    }
    this.held = now;
    if (changed) this.draw();
  }
}
