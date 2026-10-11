import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, PHYSICS } from './config';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { MenuScene } from './scenes/MenuScene';
import { CharacterSelectScene } from './scenes/CharacterSelectScene';
import { WorldMapScene } from './scenes/WorldMapScene';
import { LevelScene } from './scenes/LevelScene';
import { HUDScene } from './scenes/HUDScene';
import { PauseScene } from './scenes/PauseScene';
import { ResultsScene } from './scenes/ResultsScene';
import { SettingsScene } from './scenes/SettingsScene';
import { CreditsScene } from './scenes/CreditsScene';
import { StoryScene } from './scenes/StoryScene';
import { EndingScene } from './scenes/EndingScene';
import { ExtrasScene } from './scenes/ExtrasScene';
import { CollectionScene } from './scenes/CollectionScene';
import { UnlockScene } from './scenes/UnlockScene';

export function createGameConfig(parent: string): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#0b1730',
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    input: { gamepad: true, activePointers: 4 },
    fps: { target: 60, smoothStep: true },
    physics: {
      default: 'arcade',
      arcade: { gravity: { x: 0, y: PHYSICS.gravity }, fps: 60, fixedStep: true, tileBias: 20, debug: false },
    },
    audio: { disableWebAudio: false },
    scene: [BootScene, PreloadScene, MenuScene, CharacterSelectScene, WorldMapScene, LevelScene, HUDScene, PauseScene, ResultsScene, SettingsScene, CreditsScene,
      // story & presentation
      StoryScene, EndingScene, ExtrasScene,
      // rewards & replay
      CollectionScene, UnlockScene],
  };
}
