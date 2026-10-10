import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { EV } from '../types';
import { gamepads, rumbleOn, type RumbleKind } from '../systems/Gamepads';
import { getInputDevice, onInputDeviceChange, REQUEST_PAUSE, setInputDevice } from '../systems/InputDevice';
import { saveSystem } from '../systems/SaveSystem';
import { px } from './PixelFont';
import { measureLine } from './fontGlyphs';
import { COLORS, drawPanel } from './Widgets';
import { glyphTexture } from './Prompts';

/**
 * Phaser glue for the gamepad layer (systems/Gamepads.ts):
 *  - polls every pad once per frame (game PRE_STEP, before any scene update)
 *  - any pad press / stick push → setInputDevice('gamepad'); hides the mouse cursor until
 *    the mouse moves
 *  - hot-plug toasts ("CONTROLLER CONNECTED / DISCONNECTED") drawn by a tiny overlay scene
 *    added on demand above every other scene
 *  - a used pad disconnecting emits REQUEST_PAUSE (LevelScene pauses if a level is running)
 *  - rumble helper honouring Settings → Vibration
 */

const OVERLAY_KEY = 'PadOverlay';
let installedOn: Phaser.Game | null = null;
const pendingToasts: { text: string; color: number }[] = [];

class PadOverlayScene extends Phaser.Scene {
  private busy = false;
  constructor() {
    super(OVERLAY_KEY);
  }

  create(): void {
    this.busy = false;
    this.input.enabled = false;
    this.next();
  }

  update(): void {
    // Scenes launched later (e.g. Pause via bringToTop) must not cover a toast.
    const list = this.scene.manager.scenes;
    if (this.busy && list[list.length - 1] !== this) this.scene.bringToTop();
  }

  /** Called when new toasts are queued. */
  kick(): void {
    if (!this.busy) this.next();
  }

  private next(): void {
    const t = pendingToasts.shift();
    if (!t) {
      this.busy = false;
      return;
    }
    this.busy = true;
    const w = measureLine(t.text) + 17 + 19;
    const left = -Math.floor(w / 2);
    const c = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT - 24).setDepth(10);
    const g = this.add.graphics();
    drawPanel(g, left, -9, w, 19, { alpha: 0.95, border: t.color });
    g.fillStyle(t.color, 1).fillRect(left + 2, -7, 2, 15);
    const icon = this.add.image(left + 7, -6, glyphTexture(this, 'pad:CONTROLLER')).setOrigin(0, 0);
    const label = px(this, left + 7 + 17 + 4, -3, t.text, { origin: [0, 0], color: COLORS.text });
    c.add([g, icon, label]);
    c.setName('pad-toast');
    c.setData('text', t.text);
    c.setAlpha(0);
    this.tweens.chain({
      targets: c,
      tweens: [
        { alpha: 1, y: GAME_HEIGHT - 26, duration: 150 },
        { alpha: 0, delay: 1700, duration: 300 },
      ],
      onComplete: () => {
        c.destroy();
        this.next();
      },
    });
  }
}

function showToast(game: Phaser.Game, text: string, color: number): void {
  pendingToasts.push({ text, color });
  const sm = game.scene;
  let s = sm.getScene(OVERLAY_KEY) as PadOverlayScene | null;
  if (!s) {
    sm.add(OVERLAY_KEY, PadOverlayScene, true);
    return;
  }
  if (!s.sys.isActive()) {
    sm.run(OVERLAY_KEY);
    return;
  }
  // Keep it on top of anything started since (scenes added at runtime render last anyway).
  sm.bringToTop(OVERLAY_KEY);
  s = sm.getScene(OVERLAY_KEY) as PadOverlayScene;
  s.kick();
}

/** Text of the toast currently on screen (tests). */
export function currentPadToast(game: Phaser.Game): string | null {
  const s = game.scene.getScene(OVERLAY_KEY);
  if (!s || !s.sys.isActive()) return null;
  const c = s.children.getByName('pad-toast');
  return c ? (c.getData('text') as string) : null;
}

function fallbackDevice(): 'touch' | 'keyboard' {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse && 'ontouchstart' in window ? 'touch' : 'keyboard';
}

/** Install once per game (idempotent). Called from BootScene. */
export function installGamepads(game: Phaser.Game): void {
  if (installedOn === game) return;
  installedOn = game;
  game.events.on(Phaser.Core.Events.PRE_STEP, () => gamepads.poll());
  gamepads.onActivity(() => setInputDevice('gamepad'));
  gamepads.onConnect(() => showToast(game, 'CONTROLLER CONNECTED', COLORS.green));
  gamepads.onDisconnect((info) => {
    showToast(game, 'CONTROLLER DISCONNECTED', COLORS.red);
    if (info.wasUsed) game.events.emit(REQUEST_PAUSE);
    if (gamepads.count === 0 && getInputDevice() === 'gamepad') setInputDevice(fallbackDevice());
  });
  if (typeof window !== 'undefined') {
    // The browser exposes a pad only after a button press; polling picks it up either way,
    // the events just make it immediate (also while the game loop is throttled).
    window.addEventListener('gamepadconnected', () => gamepads.poll());
    window.addEventListener('gamepaddisconnected', () => gamepads.poll());
    installCursorHiding(game);
  }
}

function installCursorHiding(game: Phaser.Game): void {
  if (typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = 'canvas.pad-active, .pad-active canvas { cursor: none !important; }';
  document.head.appendChild(style);
  const target = () => game.canvas;
  const set = (on: boolean) => target()?.classList.toggle('pad-active', on);
  onInputDeviceChange((d) => set(d === 'gamepad'));
  window.addEventListener('mousemove', (e) => {
    // Ignore synthetic zero-movement events some browsers fire on layout changes.
    if (e.movementX === 0 && e.movementY === 0) return;
    set(false);
  }, { passive: true });
  set(getInputDevice() === 'gamepad');
}

/** Rumble the active pad (only while the player is actually using a pad). */
export function rumble(kind: RumbleKind): void {
  if (getInputDevice() !== 'gamepad') return;
  rumbleOn(gamepads.activeDomPad(), kind, saveSystem.get().settings.rumble);
}

/**
 * Wire rumble to a level's events (hurt, death, boss hits / defeat). Ground-pound landings
 * call `rumble('pound')` directly. Returns an unsubscribe function.
 */
export function attachRumble(events: Phaser.Events.EventEmitter): () => void {
  let bossHp = Infinity;
  const handlers: [string, (...a: never[]) => void][] = [
    [EV.PLAYER_HURT, () => rumble('hurt')],
    [EV.PLAYER_DIED, () => rumble('death')],
    [EV.BOSS_START, (_n: string, max: number) => (bossHp = max)],
    [EV.BOSS_HEALTH, (hp: number) => {
      if (hp < bossHp && hp > 0) rumble('bossHit');
      bossHp = hp;
    }],
    [EV.BOSS_DEFEATED, () => rumble('bossDefeat')],
  ];
  for (const [e, fn] of handlers) events.on(e, fn);
  return () => {
    for (const [e, fn] of handlers) events.off(e, fn);
  };
}
