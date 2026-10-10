import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, DEPTH } from '../config';
import { virtualButtons, clearVirtualButtons, type VirtualButtons } from '../systems/InputSystem';
import { saveSystem } from '../systems/SaveSystem';

export function shouldShowTouch(): boolean {
  const pref = saveSystem.get().settings.showTouchControls;
  if (pref !== 'auto') return pref === 'on';
  return typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
}

/** On-screen buttons writing to virtualButtons. Multi-touch aware. */
export class TouchControls {
  constructor(scene: Phaser.Scene) {
    clearVirtualButtons();
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, clearVirtualButtons);
    if (!shouldShowTouch()) return;
    const mk = (x: number, y: number, r: number, label: string, key: keyof VirtualButtons) => {
      const c = scene.add.circle(x, y, r, 0xffffff, 0.18).setStrokeStyle(1, 0xffffff, 0.5).setScrollFactor(0).setDepth(DEPTH.touch);
      scene.add.text(x, y, label, { fontFamily: 'monospace', fontSize: '10px', color: '#fff' }).setOrigin(0.5).setDepth(DEPTH.touch).setAlpha(0.8);
      c.setInteractive();
      const on = () => { virtualButtons[key] = true; c.setFillStyle(0xffffff, 0.4); };
      const off = () => { virtualButtons[key] = false; c.setFillStyle(0xffffff, 0.18); };
      c.on('pointerdown', on).on('pointerover', (p: Phaser.Input.Pointer) => p.isDown && on()).on('pointerup', off).on('pointerout', off);
    };
    mk(34, GAME_HEIGHT - 34, 20, '◀', 'left');
    mk(84, GAME_HEIGHT - 34, 20, '▶', 'right');
    mk(GAME_WIDTH - 34, GAME_HEIGHT - 40, 22, 'A', 'jump');
    mk(GAME_WIDTH - 82, GAME_HEIGHT - 26, 18, 'B', 'attack');
    mk(GAME_WIDTH - 16, 40, 10, 'II', 'pause');
  }
}
