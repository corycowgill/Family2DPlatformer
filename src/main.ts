import Phaser from 'phaser';
import { createGameConfig } from './game/main-config';
import { audio } from './game/systems/AudioSystem';

const game = new Phaser.Game(createGameConfig('game'));
audio.init(game);
document.getElementById('boot')?.remove();
(window as unknown as { __game?: Phaser.Game }).__game = game;

// QA: test harness / debug tools (?test or ?debug), loaded as a separate chunk. See docs/QA.md.
const qaParams = new URLSearchParams(window.location.search);
if (qaParams.has('test') || qaParams.has('debug')) {
  void import('./game/debug/TestHarness').then((m) => m.installHarness(game, { debug: qaParams.has('debug') }));
}
