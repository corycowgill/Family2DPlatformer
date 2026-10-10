import Phaser from 'phaser';
import { createGameConfig } from './game/main-config';
import { audio } from './game/systems/AudioSystem';
import { setInputDevice } from './game/systems/InputDevice';
import { installPlatform } from './game/platform';

const game = new Phaser.Game(createGameConfig('game'));
audio.init(game);
// Mobile / iOS: hardening, audio unlock + background pause, DOM touch controls, home-screen tip.
installPlatform(game);
document.getElementById('boot')?.remove();

// Track the active input device for prompts / touch-control visibility (gamepad sets itself).
window.addEventListener('keydown', () => setInputDevice('keyboard'), { capture: true, passive: true });
window.addEventListener('touchstart', () => setInputDevice('touch'), { capture: true, passive: true });
(window as unknown as { __game?: Phaser.Game }).__game = game;

// QA: test harness / debug tools (?test or ?debug), loaded as a separate chunk. See docs/QA.md.
const qaParams = new URLSearchParams(window.location.search);
if (qaParams.has('test') || qaParams.has('debug')) {
  void import('./game/debug/TestHarness').then((m) => m.installHarness(game, { debug: qaParams.has('debug') }));
}
