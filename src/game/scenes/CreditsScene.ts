import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { CHARACTER_IDS } from '../types';
import { CHARACTERS } from '../characters';
import { audio } from '../systems/AudioSystem';
import { playAnim } from '../systems/AnimationSystem';
import { px } from '../ui/PixelFont';
import { onNav } from '../ui/NavInput';
import { Skyline } from '../ui/Skyline';
import { COLORS } from '../ui/Widgets';
import { reducedMotion, transitionIn, transitionTo } from '../ui/Transitions';
import { prompt } from '../ui/Prompts';

const LINES: [string, 'h' | 't' | 's' | 'gap'][] = [
  ['CHICAGO FAMILY ADVENTURE', 'h'],
  ['', 'gap'],
  ['STARRING', 's'],
  ['DAD · MOM · BRENNAN · PARKER', 't'],
  ['AND LUPIN THE DOG', 't'],
  ['', 'gap'],
  ['MADE WITH LOVE', 's'],
  ['FOR THE WHOLE FAMILY', 't'],
  ['', 'gap'],
  ['MUSIC & SOUND', 's'],
  ['ORIGINAL CHIPTUNES SYNTHESISED', 't'],
  ['LIVE IN YOUR BROWSER', 't'],
  ['', 'gap'],
  ['BUILT WITH', 's'],
  ['PHASER 3 · TYPESCRIPT · VITE', 't'],
  ['', 'gap'],
  ['SPECIAL THANKS', 's'],
  ['THE CTA, FOR THE RIDE', 't'],
  ['THE PIGEONS OF THE LOOP', 't'],
  ['EVERY HOT DOG STAND (NO KETCHUP!)', 't'],
  ['', 'gap'],
  ['TO BE CONTINUED IN LINCOLN PARK...', 'h'],
  ['', 'gap'],
  ['THANKS FOR PLAYING!', 'h'],
];

export class CreditsScene extends Phaser.Scene {
  private sky!: Skyline;
  private roll!: Phaser.GameObjects.Container;
  private speed = 24;
  private done = false;

  constructor() {
    super('Credits');
  }

  create(): void {
    this.done = false;
    this.sky = new Skyline(this);
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.45).setOrigin(0);
    this.roll = this.add.container(0, GAME_HEIGHT - 40);
    let y = 0;
    for (const [s, kind] of LINES) {
      if (kind === 'gap') {
        y += 10;
        continue;
      }
      const t = px(this, GAME_WIDTH / 2, y, s, {
        scale: kind === 'h' ? 2 : 1,
        color: kind === 'h' ? COLORS.gold : kind === 's' ? COLORS.red : COLORS.text,
      });
      this.roll.add(t);
      y += kind === 'h' ? 22 : 13;
    }
    // The family parade at the end of the roll.
    CHARACTER_IDS.forEach((id, i) => {
      const s = this.add.sprite(GAME_WIDTH / 2 + (i - 2) * 50, y + 60, id).setOrigin(0.5, 1);
      playAnim(s, 'victory');
      this.roll.add(s);
      this.roll.add(px(this, s.x, y + 68, CHARACTERS[id].name.toUpperCase(), { color: COLORS.sub }));
    });
    this.roll.setData('height', y + 80);
    if (reducedMotion()) this.speed = 30;

    prompt(this, GAME_WIDTH - 6, GAME_HEIGHT - 10, (d) => (d === 'touch' ? 'TAP: BACK' : '{BACK} BACK'), { origin: [1, 0.5], color: COLORS.sub });
    onNav(this, (a) => {
      if (a === 'back' || a === 'confirm' || a === 'start') this.leave();
      if (a === 'down') this.speed = 60;
    });
    this.input.on('pointerup', () => this.leave());
    audio.music('title');
    transitionIn(this);
  }

  private leave(): void {
    if (this.done) return;
    this.done = true;
    audio.sfx('menu-back');
    transitionTo(this, 'Menu');
  }

  update(_t: number, delta: number): void {
    this.sky.update(delta);
    const h = this.roll.getData('height') as number;
    const stopY = GAME_HEIGHT / 2 - h + 40;
    if (this.roll.y > stopY) this.roll.y -= (this.speed * delta) / 1000;
  }
}
