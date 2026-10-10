import Phaser from 'phaser';
import { DEPTH } from '../config';
import { LEVELS, TEST_LEVEL } from '../data/levels';
import { gameState } from '../state/GameState';
import type { TestHarness } from './TestHarness';

/**
 * `?debug` extras on top of LevelScene's own debug mode (collision boxes, I/C/B/N hotkeys,
 * bottom status line):
 *  - a second status line with frame time, physics bodies, enemies, tweens, textures;
 *  - level-select hotkeys: 0 = test level, 1..9 = LEVELS[n-1], R = restart current level,
 *    G = teleport next to the goal, T = toggle the platforming bot.
 */
export function installDebugOverlay(game: Phaser.Game, h: TestHarness): void {
  let attachedTo: unknown = null;
  let label: Phaser.GameObjects.Text | null = null;
  let botRunning = false;
  let frameMs = 16.7;
  let last = performance.now();

  game.events.on(Phaser.Core.Events.POST_STEP, () => {
    const now = performance.now();
    frameMs = frameMs * 0.9 + (now - last) * 0.1;
    last = now;
    const lv = h.level();
    if (!lv) return;
    if (attachedTo !== lv.player) {
      attachedTo = lv.player;
      label = lv.add
        .text(4, 30, '', { fontFamily: 'monospace', fontSize: '8px', color: '#0f0', backgroundColor: '#0008' })
        .setScrollFactor(0)
        .setDepth(DEPTH.overlay);
    }
    if (!label || !label.active) return;
    const w = lv.physics.world;
    const s = h.getState();
    label.setText(
      [
        `${frameMs.toFixed(1)}ms  bodies ${w.bodies.size}/${w.staticBodies.size}  phys ${w.fps}Hz  enemies ${s.enemies}  tweens ${lv.tweens.getTweens().length}  tex ${game.textures.getTextureKeys().length}`,
        `lvl ${s.levelId} t ${(s.levelTimeMs / 1000).toFixed(1)}s  hp ${s.health}  lives ${s.lives}  coins ${s.coins}  cp ${s.checkpoint}${h.isManual() ? '  MANUAL' : ''}${botRunning ? '  BOT' : ''}`,
        `[0-9] level  [R] restart  [G] goal  [T] bot  [I] invuln  [C] respawn  [B] boxes  [N] finish`,
      ].join('\n'),
    );
  });

  window.addEventListener('keydown', (e) => {
    if (e.repeat || botRunning) return;
    const digit = /^Digit(\d)$/.exec(e.code);
    if (digit) {
      const n = Number(digit[1]);
      const lvl = n === 0 ? TEST_LEVEL : LEVELS[n - 1];
      if (lvl) void h.startLevel(lvl.id, gameState.character);
      return;
    }
    const lv = h.level();
    if (!lv) return;
    if (e.code === 'KeyR') void h.startLevel(lv.level.id, gameState.character);
    if (e.code === 'KeyG') {
      const g = h.goal();
      if (g) h.teleport(g.x - 48, g.y - 1);
    }
    if (e.code === 'KeyT') {
      botRunning = true;
      void h
        .bot({ levelId: lv.level.id, character: gameState.character, realtime: true })
        .then((r) => console.info('[bot]', r))
        .finally(() => {
          botRunning = false;
          h.setManual(false);
          h.setInput(null);
        });
    }
  });
}
