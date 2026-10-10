import Phaser from 'phaser';
import { createGameConfig } from './game/main-config';
import { audio } from './game/systems/AudioSystem';

const game = new Phaser.Game(createGameConfig('game'));
audio.init(game);
document.getElementById('boot')?.remove();
(window as unknown as { __game?: Phaser.Game }).__game = game;
