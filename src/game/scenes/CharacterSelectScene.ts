import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { CHARACTER_IDS, type CharacterId } from '../types';
import { CHARACTERS } from '../characters';
import { gameState } from '../state/GameState';
import { playAnim } from '../systems/AnimationSystem';
import { audio } from '../systems/AudioSystem';
import { px, setPx } from '../ui/PixelFont';
import { onNav } from '../ui/NavInput';
import { Skyline } from '../ui/Skyline';
import { COLORS, button, drawPanel, lighten, panel, setRatingBar } from '../ui/Widgets';
import { reducedMotion, transitionIn, transitionTo } from '../ui/Transitions';
import { prompt } from '../ui/Prompts';

const SLOT_SPACING = 64;
const SLOT_Y = 222;

export class CharacterSelectScene extends Phaser.Scene {
  private index = 0;
  private next = 'WorldMap';
  private confirmed = false;
  private sky!: Skyline;
  private preview!: Phaser.GameObjects.Sprite;
  private previewTimer?: Phaser.Time.TimerEvent;
  private slots: { g: Phaser.GameObjects.Graphics; sprite: Phaser.GameObjects.Sprite }[] = [];
  private marker!: Phaser.GameObjects.BitmapText;
  private info!: {
    name: Phaser.GameObjects.BitmapText;
    ability: Phaser.GameObjects.BitmapText;
    desc: Phaser.GameObjects.BitmapText;
    bars: Phaser.GameObjects.Graphics;
    cd: Phaser.GameObjects.BitmapText;
  };

  constructor() {
    super('CharacterSelect');
  }

  init(data: { next?: string }): void {
    this.next = data.next ?? 'WorldMap';
    this.index = Math.max(0, CHARACTER_IDS.indexOf(gameState.character));
    this.confirmed = false;
    this.slots = [];
  }

  create(): void {
    this.sky = new Skyline(this, { train: false });
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.55).setOrigin(0).setDepth(-50);
    px(this, GAME_WIDTH / 2, 14, 'CHOOSE YOUR HERO', { scale: 2, color: COLORS.gold });

    // Preview stage
    panel(this, 14, 30, 152, 156);
    const stage = this.add.graphics();
    stage.fillStyle(0xffffff, 0.06).fillCircle(90, 108, 62);
    stage.fillStyle(0x000000, 0.35).fillEllipse(90, 170, 70, 10);
    this.preview = this.add.sprite(90, 172, CHARACTER_IDS[this.index]).setOrigin(0.5, 1).setScale(2);

    // Info panel
    panel(this, 172, 30, 294, 156);
    const name = px(this, 186, 46, '', { scale: 2, origin: [0, 0.5] });
    px(this, 186, 66, 'SPECIAL ABILITY', { origin: [0, 0.5], color: COLORS.dim });
    const ability = px(this, 186, 78, '', { origin: [0, 0.5], color: COLORS.gold });
    const desc = px(this, 186, 90, '', { origin: [0, 0], color: COLORS.sub, maxWidth: 266 });
    ['SPEED', 'JUMP', 'ABILITY'].forEach((l, i) => px(this, 186, 132 + i * 13, l, { origin: [0, 0.5] }));
    const bars = this.add.graphics();
    const cd = px(this, 452, 171, '', { origin: [1, 0.5], color: COLORS.dim });
    this.info = { name, ability, desc, bars, cd };

    // Roster
    CHARACTER_IDS.forEach((id, i) => {
      const x = GAME_WIDTH / 2 + (i - 2) * SLOT_SPACING;
      const g = this.add.graphics();
      const sprite = this.add.sprite(x, SLOT_Y + 24, id).setOrigin(0.5, 1);
      playAnim(sprite, 'idle');
      const zone = this.add.zone(x, SLOT_Y, 56, 56).setInteractive({ useHandCursor: true });
      zone.on('pointerup', () => {
        if (this.confirmed) return;
        if (this.index === i) this.confirm();
        else this.select(i);
      });
      zone.on('pointerover', () => sprite.setTint(0xffffff));
      this.slots.push({ g, sprite });
    });
    this.marker = px(this, 0, SLOT_Y - 33, '▼', { color: COLORS.gold }).setDepth(5);
    if (!reducedMotion()) this.tweens.add({ targets: this.marker, y: SLOT_Y - 31, duration: 350, yoyo: true, repeat: -1 });

    button(this, 38, SLOT_Y, 'BACK', () => this.back(), { sound: 'menu-back', w: 50 });
    button(this, GAME_WIDTH - 38, SLOT_Y, 'GO!', () => this.confirm(), { sound: null, w: 50, color: COLORS.gold });

    prompt(this, GAME_WIDTH / 2, GAME_HEIGHT - 10, (d) => (d === 'touch' ? 'TAP A HERO · TAP AGAIN OR GO! TO START' : '{CHOOSE} CHOOSE  {CONFIRM} CONFIRM  {BACK} BACK'), {
      color: COLORS.sub,
    });

    onNav(this, (a) => {
      if (this.confirmed) return;
      if (a === 'left' || a === 'up') this.select(this.index - 1);
      else if (a === 'right' || a === 'down') this.select(this.index + 1);
      else if (a === 'confirm' || a === 'start') this.confirm();
      else if (a === 'back') {
        audio.sfx('menu-back');
        this.back();
      }
    });

    this.select(this.index, true);
    if (!audio.musicKey) audio.music('title');
    transitionIn(this);
  }

  private back(): void {
    transitionTo(this, 'Menu');
  }

  private select(i: number, silent = false): void {
    const n = CHARACTER_IDS.length;
    this.index = (i + n) % n;
    if (!silent) audio.sfx('menu-move');
    const id = CHARACTER_IDS[this.index] as CharacterId;
    const def = CHARACTERS[id];
    this.slots.forEach((s, j) => {
      const x = GAME_WIDTH / 2 + (j - 2) * SLOT_SPACING;
      const sel = j === this.index;
      s.g.clear();
      drawPanel(s.g, x - 27, SLOT_Y - 26, 54, 54, {
        fill: sel ? lighten(CHARACTERS[CHARACTER_IDS[j]].color, 0.15) : COLORS.panel,
        border: sel ? COLORS.gold : COLORS.border,
        alpha: sel ? 0.95 : 0.85,
      });
      s.sprite.setAlpha(sel ? 1 : 0.6).clearTint();
      playAnim(s.sprite, sel ? 'walk' : 'idle');
    });
    this.marker.setX(GAME_WIDTH / 2 + (this.index - 2) * SLOT_SPACING);

    const { name, ability, desc, bars, cd } = this.info;
    setPx(name, def.name.toUpperCase()).setTint(lighten(def.color, 0.35));
    setPx(ability, def.abilityName.toUpperCase());
    setPx(desc, def.abilityDescription);
    bars.clear();
    const rows = [def.ratings.speed, def.ratings.jump, def.ratings.ability];
    rows.forEach((v, r) => setRatingBar(bars, 248, 129 + r * 13, v, 5, [COLORS.green, 0x4aa3ff, COLORS.gold][r], r === 0));
    setPx(cd, def.abilityCooldownMs > 0 ? `COOLDOWN ${(def.abilityCooldownMs / 1000).toFixed(1)}S` : 'NO COOLDOWN');

    this.preview.setTexture(id).setScale(2).setY(172);
    this.startPreviewCycle();
  }

  /** Preview loops: run → victory → idle. */
  private startPreviewCycle(): void {
    this.previewTimer?.remove();
    const p = this.preview;
    const steps: [string, number][] = [['run', 1800], ['victory', 1400], ['idle', 1400]];
    let k = 0;
    const play = () => {
      const [anim, ms] = steps[k++ % steps.length];
      playAnim(p, anim, 'idle', false);
      this.previewTimer = this.time.delayedCall(ms, play);
    };
    play();
  }

  private confirm(): void {
    if (this.confirmed) return;
    this.confirmed = true;
    this.previewTimer?.remove();
    gameState.selectCharacter(CHARACTER_IDS[this.index]);
    audio.sfx('confirm');
    const p = this.preview;
    playAnim(p, 'jump', 'idle', false);
    if (!reducedMotion()) {
      this.cameras.main.flash(180, 255, 255, 255);
      this.tweens.add({
        targets: p, y: 140, duration: 220, yoyo: true, ease: 'Quad.out',
        onComplete: () => playAnim(p, 'victory', 'idle', false),
      });
    } else playAnim(p, 'victory', 'idle', false);
    const slot = this.slots[this.index].sprite;
    playAnim(slot, 'victory', 'idle', false);
    this.time.delayedCall(850, () => transitionTo(this, this.next));
  }

  update(_t: number, delta: number): void {
    this.sky.update(delta);
  }
}
