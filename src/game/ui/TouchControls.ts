import Phaser from 'phaser';
import { virtualButtons, clearVirtualButtons } from '../systems/InputSystem';
import { saveSystem } from '../systems/SaveSystem';
import { getInputDevice, onInputDeviceChange, REQUEST_PAUSE } from '../systems/InputDevice';
import { PORTRAIT_QUERY } from '../platform/device';
import { maybeEnterFullscreen } from '../platform/fullscreen';
import { PAUSE_ICON, pixelButtonSvg, starIcon, triangleIcon, type PixelLabel } from '../platform/pixelSvg';
import {
  actionAt, actionSlide, computeTouchLayout, dpadDirs,
  type ActionButton, type DirButton, type Insets, type OverlayButton, type TouchButton, type TouchLayout,
} from '../platform/touchLayout';

export type { TouchButton } from '../platform/touchLayout';

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && ('ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0);
}

/**
 * Whether touch UI (on-screen controls, "tap" hints) should be used: the setting forces it
 * on/off; 'auto' follows the active input device (touch until a keyboard / pad is used).
 */
export function shouldShowTouch(): boolean {
  const pref = saveSystem.get().settings.showTouchControls;
  if (pref !== 'auto') return pref === 'on';
  return getInputDevice() === 'touch';
}

const HELD: readonly (DirButton | 'jump' | 'attack')[] = ['left', 'right', 'down', 'jump', 'attack'];
const RUN_KEY = 'cfa-touch-run';

const LABELS: Record<OverlayButton, { label: PixelLabel; glyph: number; title: string }> = {
  left: { label: triangleIcon('left', 6), glyph: 1, title: 'Left' },
  right: { label: triangleIcon('right', 6), glyph: 1, title: 'Right' },
  down: { label: triangleIcon('down', 5), glyph: 1, title: 'Crouch / drop' },
  jump: { label: triangleIcon('up', 6), glyph: 1, title: 'Jump (A)' },
  attack: { label: starIcon(13), glyph: 1, title: 'Ability (B)' },
  run: { label: 'RUN', glyph: 1, title: 'Run (toggle)' },
  pause: { label: PAUSE_ICON, glyph: 1, title: 'Pause' },
};

const CSS = `
#touch-controls { position: fixed; inset: 0; z-index: 20; pointer-events: none; visibility: hidden;
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; touch-action: none;
  -webkit-tap-highlight-color: transparent; }
#touch-controls.show { visibility: visible; }
#touch-controls .tc-zone { position: absolute; pointer-events: auto; touch-action: none; }
#touch-controls .tc-btn { position: absolute; pointer-events: none; opacity: 0.72; transform-origin: 50% 50%;
  transition: transform 50ms linear, opacity 50ms linear; will-change: transform; }
#touch-controls .tc-btn.tc-pause { pointer-events: auto; touch-action: none; opacity: 0.75; }
#touch-controls .tc-btn svg { display: block; width: 100%; height: 100%; }
#touch-controls .body { fill: rgba(11, 23, 48, 0.55); }
#touch-controls .hi { fill: rgba(255, 255, 255, 0.14); }
#touch-controls .ring { fill: rgba(207, 227, 255, 0.9); }
#touch-controls .glyph { fill: #ffffff; }
#touch-controls .glyph-shadow { fill: rgba(11, 23, 48, 0.7); }
#touch-controls [data-btn="jump"] .ring { fill: rgba(255, 210, 90, 0.9); }
#touch-controls [data-btn="attack"] .ring { fill: rgba(232, 65, 78, 0.9); }
#touch-controls .tc-btn.pressed { opacity: 0.95; transform: scale(0.9); }
#touch-controls .tc-btn.pressed .body { fill: rgba(91, 123, 181, 0.8); }
#touch-controls .tc-btn.pressed .ring { fill: #ffffff; }
#touch-controls [data-btn="run"].on { opacity: 0.9; }
#touch-controls [data-btn="run"].on .body { fill: rgba(255, 210, 90, 0.92); }
#touch-controls [data-btn="run"].on .glyph { fill: #0b1730; }
#touch-controls [data-btn="run"].on .glyph-shadow { fill: rgba(255, 255, 255, 0.35); }
#cfa-safe-probe { position: fixed; left: 0; top: 0; width: 0; height: 0; visibility: hidden; pointer-events: none;
  padding: var(--cfa-safe-top, env(safe-area-inset-top, 0px)) var(--cfa-safe-right, env(safe-area-inset-right, 0px))
    var(--cfa-safe-bottom, env(safe-area-inset-bottom, 0px)) var(--cfa-safe-left, env(safe-area-inset-left, 0px)); }
@media (prefers-reduced-motion: reduce) { #touch-controls .tc-btn { transition: none; } }
`;

interface TrackedTouch {
  zone: 'dpad' | 'action';
  dirs: DirButton[];
  action: ActionButton | null;
}

/**
 * On-screen controls as a DOM overlay above the canvas (one per page, created once).
 *
 * The clusters hug the SCREEN edges — on wide phones they sit in the letterbox bars and only
 * overlap the canvas edges — and respect the safe-area insets. Each cluster is one touch zone
 * (touch events, `passive: false` + preventDefault so iOS doesn't zoom/scroll and Phaser's
 * window listeners ignore them). Every Touch is tracked by identifier and re-hit-tested on
 * touchmove, so the thumb can slide ◀ → ▶ → ▼ (or JUMP ↔ ABILITY) without lifting, and any
 * number of fingers work at once. touchcancel (iOS system gestures) releases everything.
 *
 * Writes held state into `virtualButtons` only when it changes; DOM is touched only on state
 * changes and on resize — never per frame.
 */
export class TouchOverlay {
  readonly root: HTMLDivElement;
  private probe: HTMLDivElement;
  private els = {} as Record<OverlayButton, HTMLDivElement>;
  private leftZone: HTMLDivElement;
  private rightZone: HTMLDivElement;
  private layout!: TouchLayout;
  private touches = new Map<number, TrackedTouch>();
  private held: Record<string, boolean> = {};
  private pausePressed = new Set<number>();
  private runLatched = false;
  private shown = false;
  private relayoutQueued = false;
  private builtCell = -1;

  constructor(private game: Phaser.Game) {
    const style = document.createElement('style');
    style.id = 'touch-controls-css';
    style.textContent = CSS;
    document.head.appendChild(style);

    this.probe = document.createElement('div');
    this.probe.id = 'cfa-safe-probe';
    document.body.appendChild(this.probe);

    const root = (this.root = document.createElement('div'));
    root.id = 'touch-controls';
    root.setAttribute('aria-hidden', 'true');
    this.leftZone = this.zone('dpad');
    this.rightZone = this.zone('action');
    for (const id of Object.keys(LABELS) as OverlayButton[]) {
      const el = document.createElement('div');
      el.className = id === 'pause' ? 'tc-btn tc-pause' : 'tc-btn';
      el.dataset.btn = id;
      el.title = LABELS[id].title;
      this.els[id] = el;
      root.appendChild(el);
    }
    this.wirePause(this.els.pause);
    document.body.appendChild(root);

    try {
      this.runLatched = localStorage.getItem(RUN_KEY) === '1';
    } catch {
      /* storage blocked */
    }
    this.els.run.classList.toggle('on', this.runLatched);

    const queue = () => this.queueRelayout();
    window.addEventListener('resize', queue, { passive: true });
    window.addEventListener('orientationchange', queue, { passive: true });
    window.visualViewport?.addEventListener('resize', queue, { passive: true });
    game.scale.on(Phaser.Scale.Events.RESIZE, queue);
    // Lost focus / app switch: never leave a button stuck down.
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && this.releaseAll());
    this.relayout();
  }

  get visible(): boolean {
    return this.shown;
  }

  get run(): boolean {
    return this.runLatched;
  }

  /** Current layout (CSS px, viewport space) — exposed for tests/debug. */
  get currentLayout(): TouchLayout {
    return this.layout;
  }

  setVisible(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    if (on) this.relayout();
    else this.releaseAll();
    this.root.classList.toggle('show', on);
    // RUN latch only applies while the controls are in use.
    virtualButtons.run = on && this.runLatched;
  }

  // ------------------------------------------------------------------ layout

  private readInsets(): Insets {
    const cs = getComputedStyle(this.probe);
    const n = (v: string) => parseFloat(v) || 0;
    return { top: n(cs.paddingTop), right: n(cs.paddingRight), bottom: n(cs.paddingBottom), left: n(cs.paddingLeft) };
  }

  private queueRelayout(): void {
    if (this.relayoutQueued) return;
    this.relayoutQueued = true;
    requestAnimationFrame(() => {
      this.relayoutQueued = false;
      this.relayout();
    });
  }

  relayout(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (!w || !h) return;
    const L = (this.layout = computeTouchLayout({ w, h, safe: this.readInsets() }));
    const place = (el: HTMLElement, x: number, y: number, ww: number, hh: number) => {
      el.style.left = `${Math.round(x)}px`;
      el.style.top = `${Math.round(y)}px`;
      el.style.width = `${Math.round(ww)}px`;
      el.style.height = `${Math.round(hh)}px`;
    };
    place(this.leftZone, L.leftZone.x, L.leftZone.y, L.leftZone.w, L.leftZone.h);
    place(this.rightZone, L.rightZone.x, L.rightZone.y, L.rightZone.w, L.rightZone.h);
    // Art cell ≈ 2 game pixels at the current canvas scale, so the DOM buttons match the pixel UI.
    const gamePx = Math.max(1, Math.min(w / this.game.scale.gameSize.width, h / this.game.scale.gameSize.height));
    const cell = Math.max(2, Math.round(gamePx * 2 * 2) / 2);
    const rebuild = cell !== this.builtCell;
    this.builtCell = cell;
    for (const id of Object.keys(LABELS) as OverlayButton[]) {
      const b = L.buttons[id];
      const el = this.els[id];
      place(el, b.cx - b.size / 2, b.cy - b.size / 2, b.size, b.size);
      if (rebuild || !el.firstChild) {
        const minCells = id === 'run' ? 21 : 14;
        const n = Math.max(minCells, Math.round(b.size / cell));
        el.innerHTML = pixelButtonSvg(n, LABELS[id].label, LABELS[id].glyph);
      }
    }
  }

  // ------------------------------------------------------------------ input

  private zone(kind: 'dpad' | 'action'): HTMLDivElement {
    const z = document.createElement('div');
    z.className = 'tc-zone';
    z.dataset.zone = kind;
    const opts = { passive: false } as const;
    z.addEventListener('touchstart', (e) => this.onStart(kind, e), opts);
    z.addEventListener('touchmove', (e) => this.onMove(e), opts);
    z.addEventListener('touchend', (e) => this.onEnd(e), opts);
    z.addEventListener('touchcancel', (e) => {
      if (e.cancelable) e.preventDefault();
      this.releaseAll();
    }, opts);
    // Mouse (Settings → touch controls ON on a desktop): pointer events with capture.
    z.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      z.setPointerCapture(e.pointerId);
      this.begin(kind, -1, e.clientX, e.clientY);
    });
    z.addEventListener('pointermove', (e) => e.pointerType === 'mouse' && this.track(-1, e.clientX, e.clientY));
    const up = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      this.touches.delete(-1);
      this.sync();
    };
    z.addEventListener('pointerup', up);
    z.addEventListener('pointercancel', up);
    // Keep Phaser's window-level mouse listeners from treating these as canvas clicks.
    z.addEventListener('mousedown', (e) => e.preventDefault());
    z.addEventListener('mouseup', (e) => e.preventDefault());
    z.addEventListener('contextmenu', (e) => e.preventDefault());
    this.root.appendChild(z);
    return z;
  }

  private begin(kind: 'dpad' | 'action', id: number, x: number, y: number): void {
    const L = this.layout;
    if (kind === 'dpad') this.touches.set(id, { zone: kind, dirs: dpadDirs(L, x, y), action: null });
    else {
      const action = actionAt(L, x, y);
      if (action === 'run') this.toggleRun();
      this.touches.set(id, { zone: kind, dirs: [], action });
    }
    this.sync();
  }

  private track(id: number, x: number, y: number): boolean {
    const t = this.touches.get(id);
    if (!t) return false;
    if (t.zone === 'dpad') t.dirs = dpadDirs(this.layout, x, y, t.dirs);
    else t.action = actionSlide(this.layout, x, y, t.action);
    return true;
  }

  private onStart(kind: 'dpad' | 'action', e: TouchEvent): void {
    if (e.cancelable) e.preventDefault();
    if (!this.shown) return;
    for (const t of Array.from(e.changedTouches)) this.begin(kind, t.identifier, t.clientX, t.clientY);
  }

  private onMove(e: TouchEvent): void {
    if (e.cancelable) e.preventDefault();
    let any = false;
    for (const t of Array.from(e.changedTouches)) any = this.track(t.identifier, t.clientX, t.clientY) || any;
    if (any) this.sync();
  }

  private onEnd(e: TouchEvent): void {
    if (e.cancelable) e.preventDefault();
    for (const t of Array.from(e.changedTouches)) this.touches.delete(t.identifier);
    // Safety net: drop anything the browser no longer reports as down.
    const live = new Set(Array.from(e.touches).map((t) => t.identifier));
    for (const id of [...this.touches.keys()]) if (id >= 0 && !live.has(id)) this.touches.delete(id);
    this.sync();
    // Android Chrome: go fullscreen + lock landscape on the first gameplay tap (needs a gesture).
    maybeEnterFullscreen();
  }

  private wirePause(el: HTMLDivElement): void {
    const opts = { passive: false } as const;
    el.addEventListener('touchstart', (e) => {
      if (e.cancelable) e.preventDefault();
      for (const t of Array.from(e.changedTouches)) this.pausePressed.add(t.identifier);
      el.classList.add('pressed');
    }, opts);
    const end = (e: TouchEvent, fire: boolean) => {
      if (e.cancelable) e.preventDefault();
      let hit = false;
      for (const t of Array.from(e.changedTouches)) {
        if (!this.pausePressed.delete(t.identifier)) continue;
        const r = el.getBoundingClientRect();
        const pad = 16;
        hit ||= t.clientX >= r.left - pad && t.clientX <= r.right + pad && t.clientY >= r.top - pad && t.clientY <= r.bottom + pad;
      }
      if (!this.pausePressed.size) el.classList.remove('pressed');
      if (fire && hit) this.requestPause();
    };
    el.addEventListener('touchend', (e) => end(e, true), opts);
    el.addEventListener('touchcancel', (e) => end(e, false), opts);
    el.addEventListener('touchmove', (e) => e.cancelable && e.preventDefault(), opts);
    el.addEventListener('click', (e) => {
      // Mouse only (touch clicks are suppressed by preventDefault above).
      e.preventDefault();
      this.requestPause();
    });
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('mouseup', (e) => e.preventDefault());
  }

  private requestPause(): void {
    if (!this.shown) return;
    this.releaseAll();
    this.game.events.emit(REQUEST_PAUSE);
  }

  private toggleRun(): void {
    this.runLatched = !this.runLatched;
    virtualButtons.run = this.shown && this.runLatched;
    this.els.run.classList.toggle('on', this.runLatched);
    try {
      localStorage.setItem(RUN_KEY, this.runLatched ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  /** Release every held button (touchcancel, hide, blur, pause). The RUN latch is kept. */
  releaseAll(): void {
    this.touches.clear();
    this.pausePressed.clear();
    this.els.pause.classList.remove('pressed');
    this.sync();
  }

  /** Recompute held buttons from all tracked touches; write only what changed. */
  private sync(): void {
    const now = new Set<TouchButton>();
    for (const t of this.touches.values()) {
      for (const d of t.dirs) now.add(d);
      if (t.action) now.add(t.action);
    }
    for (const k of HELD) {
      const v = now.has(k);
      if (v === !!this.held[k]) continue;
      this.held[k] = v;
      virtualButtons[k] = v;
      this.els[k].classList.toggle('pressed', v);
    }
    const runDown = now.has('run');
    if (runDown !== !!this.held.run) {
      this.held.run = runDown;
      this.els.run.classList.toggle('pressed', runDown);
    }
  }
}

let overlay: TouchOverlay | null = null;

/** Create the (hidden) overlay once per page. */
export function installTouchOverlay(game: Phaser.Game): TouchOverlay | null {
  if (typeof document === 'undefined') return null;
  overlay ??= new TouchOverlay(game);
  return overlay;
}

export function getTouchOverlay(): TouchOverlay | null {
  return overlay;
}

/**
 * HUD-side controller: shows the overlay only while the level is actually running (not
 * paused, not in menus), the device is landscape, and touch is the active input (or the
 * setting forces it). Polls a few booleans per frame and touches the DOM only on change.
 */
export class TouchControls {
  private overlay: TouchOverlay | null;
  private shown = false;
  private portrait: MediaQueryList | null;
  private unsubscribe: () => void;

  constructor(private scene: Phaser.Scene, private level: Phaser.Scene, private onShownChange?: (shown: boolean) => void) {
    this.overlay = installTouchOverlay(scene.game);
    this.portrait = typeof matchMedia === 'function' ? matchMedia(PORTRAIT_QUERY) : null;
    // Device switches (pad/keyboard ↔ touch) are picked up immediately.
    this.unsubscribe = onInputDeviceChange(() => this.update());
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribe();
      this.apply(false);
      clearVirtualButtons();
    });
    clearVirtualButtons();
    this.update();
  }

  private wanted(): boolean {
    return (
      !!this.overlay &&
      shouldShowTouch() &&
      this.scene.sys.isActive() &&
      this.level.sys.isActive() &&
      !this.portrait?.matches &&
      document.visibilityState !== 'hidden'
    );
  }

  private apply(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    this.overlay?.setVisible(on);
    this.onShownChange?.(on);
  }

  update(): void {
    this.apply(this.wanted());
  }
}
