import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { saveSystem } from '../systems/SaveSystem';

/** Scene-to-scene "venetian blind" wipe (plain fade when reduced motion is on). */

const OVERLAY_DEPTH = 100000;
const COLOR = 0x0b1730;
const BANDS = 9;
const leaving = new WeakSet<Phaser.Scene>();

export function reducedMotion(): boolean {
  return saveSystem.get().settings.reducedMotion;
}

/** Pure: how much of band `i` (0..BANDS-1) is covered at overall progress p (0..1). */
export function bandCoverage(p: number, i: number, bands = BANDS): number {
  const stagger = 0.45;
  const start = (i / Math.max(1, bands - 1)) * stagger;
  const k = (p - start) / (1 - stagger);
  const c = Math.min(1, Math.max(0, k));
  return 1 - (1 - c) * (1 - c); // ease-out
}

function drawCover(g: Phaser.GameObjects.Graphics, p: number, fade: boolean): void {
  g.clear();
  if (fade) {
    g.fillStyle(COLOR, p).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    return;
  }
  const h = Math.ceil(GAME_HEIGHT / BANDS);
  g.fillStyle(COLOR, 1);
  for (let i = 0; i < BANDS; i++) {
    const w = Math.round(GAME_WIDTH * bandCoverage(p, i));
    if (w <= 0) continue;
    const x = i % 2 === 0 ? 0 : GAME_WIDTH - w;
    g.fillRect(x, i * h, w, h);
  }
}

function overlay(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
  return scene.add.graphics().setDepth(OVERLAY_DEPTH).setScrollFactor(0);
}

export function isLeaving(scene: Phaser.Scene): boolean {
  return leaving.has(scene);
}

/** Cover the screen, then start `key`. Optional `stop` lists other scenes to stop first. */
export function transitionTo(scene: Phaser.Scene, key: string, data?: object, opts: { stop?: string[]; duration?: number } = {}): void {
  if (leaving.has(scene)) return;
  leaving.add(scene);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => leaving.delete(scene));
  if (scene.input) scene.input.enabled = false;
  const fade = reducedMotion();
  const g = overlay(scene);
  const finish = () => {
    for (const k of opts.stop ?? []) if (k !== scene.scene.key) scene.scene.stop(k);
    scene.scene.start(key, data);
  };
  scene.tweens.addCounter({
    from: 0,
    to: 1,
    duration: opts.duration ?? (fade ? 200 : 300),
    onUpdate: (tw) => drawCover(g, tw.getValue() ?? 0, fade),
    onComplete: finish,
  });
}

/** Reveal the scene (call at the end of create()). */
export function transitionIn(scene: Phaser.Scene, duration?: number): void {
  const fade = reducedMotion();
  const g = overlay(scene);
  drawCover(g, 1, fade);
  scene.tweens.addCounter({
    from: 1,
    to: 0,
    duration: duration ?? (fade ? 200 : 320),
    onUpdate: (tw) => drawCover(g, tw.getValue() ?? 0, fade),
    onComplete: () => g.destroy(),
  });
}
