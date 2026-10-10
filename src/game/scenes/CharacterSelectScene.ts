import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { CHARACTER_IDS, type CharacterId } from '../types';
import { CHARACTERS } from '../characters';
import { gameState } from '../state/GameState';
import { playAnim } from '../systems/AnimationSystem';
import { text } from '../ui/Menus';

export class CharacterSelectScene extends Phaser.Scene {
  private index = 0;
  private next = 'WorldMap';
  constructor() {
    super('CharacterSelect');
  }

  init(data: { next?: string }): void {
    this.next = data.next ?? 'WorldMap';
    this.index = Math.max(0, CHARACTER_IDS.indexOf(gameState.character));
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#13254a');
    text(this, GAME_WIDTH / 2, 18, 'CHOOSE YOUR HERO', 16, '#ffd25a');
    const spacing = GAME_WIDTH / (CHARACTER_IDS.length + 1);
    const sprites = CHARACTER_IDS.map((id, i) => {
      const s = this.add.sprite(spacing * (i + 1), 120, id).setOrigin(0.5, 1).setScale(2);
      playAnim(s, 'idle');
      s.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        if (this.index === i) this.confirm();
        else this.select(i);
      });
      return s;
    });
    const nameT = text(this, GAME_WIDTH / 2, 150, '', 14);
    const abilityT = text(this, GAME_WIDTH / 2, 170, '', 10, '#ffd25a');
    const descT = text(this, GAME_WIDTH / 2, 188, '', 8, '#cfe3ff');
    const statsT = text(this, GAME_WIDTH / 2, 210, '', 8);
    text(this, GAME_WIDTH / 2, GAME_HEIGHT - 14, '◀ ▶ choose · Enter / tap again to start', 8, '#cfe3ff');
    const refresh = () => {
      const def = CHARACTERS[CHARACTER_IDS[this.index] as CharacterId];
      sprites.forEach((s, i) => {
        s.setAlpha(i === this.index ? 1 : 0.5);
        playAnim(s, i === this.index ? 'walk' : 'idle');
      });
      nameT.setText(def.name.toUpperCase());
      abilityT.setText(def.abilityName);
      descT.setText(def.abilityDescription);
      const bar = (n: number) => '■'.repeat(n) + '□'.repeat(5 - n);
      statsT.setText(`SPD ${bar(def.ratings.speed)}  JMP ${bar(def.ratings.jump)}  ABL ${bar(def.ratings.ability)}`);
    };
    this.select = (i: number) => {
      this.index = (i + CHARACTER_IDS.length) % CHARACTER_IDS.length;
      refresh();
    };
    const kb = this.input.keyboard;
    kb?.on('keydown', (e: KeyboardEvent) => {
      if (['ArrowLeft', 'KeyA'].includes(e.code)) this.select(this.index - 1);
      if (['ArrowRight', 'KeyD'].includes(e.code)) this.select(this.index + 1);
      if (['Enter', 'Space', 'KeyJ'].includes(e.code)) this.confirm();
      if (e.code === 'Escape') this.scene.start('Menu');
    });
    this.input.gamepad?.on('down', (_p: unknown, b: Phaser.Input.Gamepad.Button) => {
      if (b.index === 14) this.select(this.index - 1);
      if (b.index === 15) this.select(this.index + 1);
      if (b.index === 0) this.confirm();
    });
    refresh();
  }

  private select: (i: number) => void = () => {};

  private confirm(): void {
    gameState.selectCharacter(CHARACTER_IDS[this.index]);
    this.scene.start(this.next);
  }
}
