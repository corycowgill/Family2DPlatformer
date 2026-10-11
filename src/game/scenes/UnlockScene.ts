import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { CHARACTERS } from '../characters';
import { audio } from '../systems/AudioSystem';
import { playAnim } from '../systems/AnimationSystem';
import { describeUnlock, type UnlockInfo } from '../systems/Rewards';
import { px } from '../ui/PixelFont';
import { onNav } from '../ui/NavInput';
import { COLORS, drawPanel, lighten } from '../ui/Widgets';
import { reducedMotion } from '../ui/Transitions';
import { prompt } from '../ui/Prompts';
import { heroTexture } from '../ui/CharacterArt';
import { drawChicagoStar } from './MenuScene';

export interface UnlockSceneData {
  /** Unlock keys to celebrate, one card each (characters first). */
  keys: string[];
  /** Scene to pause while the popup is up (resumed afterwards). */
  from: string;
}

/**
 * Celebratory "UNLOCKED!" popup over another scene (Results, Character Select). The
 * caller is paused so its menus don't react; any button / tap advances, then it resumes.
 */
export class UnlockScene extends Phaser.Scene {
  private cards: UnlockInfo[] = [];
  private from = '';
  private layer?: Phaser.GameObjects.Container;
  private shownAt = 0;

  constructor() {
    super('Unlock');
  }

  /** Show `keys` over `scene` (no-op for an empty list). Returns true if a popup opened. */
  static show(scene: Phaser.Scene, keys: string[]): boolean {
    const valid = keys.filter((k) => describeUnlock(k));
    if (!valid.length) return false;
    scene.scene.launch('Unlock', { keys: valid, from: scene.scene.key } satisfies UnlockSceneData);
    scene.scene.bringToTop('Unlock');
    scene.scene.pause();
    return true;
  }

  create(data: UnlockSceneData): void {
    this.from = data.from;
    const infos = data.keys.map((k) => describeUnlock(k)).filter((u): u is UnlockInfo => !!u);
    // Characters first, then costumes; max 4 cards (the rest are summarised).
    infos.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'character' ? -1 : 1));
    this.cards = infos.slice(0, 4);
    const extra = infos.length - this.cards.length;
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, COLORS.ink, 0.72).setOrigin(0).setInteractive();
    prompt(this, GAME_WIDTH / 2, GAME_HEIGHT - 12, (d) => (d === 'touch' ? 'TAP TO CONTINUE' : '{CONFIRM} CONTINUE'), { color: COLORS.sub, depth: 5 });
    if (extra > 0) px(this, GAME_WIDTH / 2, GAME_HEIGHT - 24, `+${extra} MORE - SEE CHARACTER SELECT`, { color: COLORS.dim, depth: 5 });
    onNav(this, (a) => {
      if (a === 'confirm' || a === 'start' || a === 'back') this.advance();
    }, 250);
    this.input.on('pointerup', () => this.advance());
    this.showCard();
  }

  private advance(): void {
    if (this.time.now - this.shownAt < 250) return;
    this.cards.shift();
    if (this.cards.length) this.showCard();
    else this.close();
  }

  private close(): void {
    audio.sfx('menu-back');
    this.scene.resume(this.from);
    this.scene.stop();
  }

  private showCard(): void {
    this.layer?.destroy();
    const u = this.cards[0];
    this.shownAt = this.time.now;
    const cx = GAME_WIDTH / 2;
    const cy = 120;
    const c = this.add.container(cx, cy).setDepth(10);
    this.layer = c;
    const def = CHARACTERS[u.character];
    const g = this.add.graphics();
    drawPanel(g, -130, -78, 260, 156, { fill: lighten(def.color, 0.05), border: COLORS.gold, alpha: 0.96 });
    // sunburst behind the hero
    const rays = this.add.graphics();
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * Math.PI * 2;
      const a1 = a0 + Math.PI / 12;
      rays.fillStyle(0xffffff, i % 2 ? 0.06 : 0.12);
      rays.fillTriangle(0, 0, Math.cos(a0) * 70, Math.sin(a0) * 70, Math.cos(a1) * 70, Math.sin(a1) * 70);
    }
    rays.setPosition(0, 4);
    const stars = this.add.graphics();
    drawChicagoStar(stars, -100, -58, 8);
    drawChicagoStar(stars, 100, -58, 8);
    const title = px(this, 0, -60, 'UNLOCKED!', { scale: 2, color: COLORS.gold });
    const kind = px(this, 0, -44, u.kind === 'character' ? 'A SECRET HERO' : 'A NEW OUTFIT', { color: COLORS.text });
    const shadow = this.add.ellipse(0, 46, 54, 8, 0x000000, 0.4);
    const hero = this.add.sprite(0, 48, heroTexture(this, u.character, u.costume)).setOrigin(0.5, 1).setScale(2);
    playAnim(hero, 'victory', 'idle', false);
    const name = u.kind === 'character' ? `${def.name.toUpperCase()} JOINS THE FAMILY!` : `${def.name.toUpperCase()} · ${u.label}`;
    const line = px(this, 0, 60, name, { color: COLORS.text });
    const sub = px(this, 0, 70, u.kind === 'character' ? 'NOW ON CHARACTER SELECT!' : 'WEAR IT ON CHARACTER SELECT ▲▼', {
      color: COLORS.sub,
    });
    c.add([g, rays, stars, title, kind, shadow, hero, line, sub]);
    audio.sfx('secret');
    if (!reducedMotion()) {
      c.setScale(0.2);
      this.tweens.add({ targets: c, scale: 1, duration: 320, ease: 'Back.out' });
      this.tweens.add({ targets: rays, angle: 360, duration: 9000, repeat: -1 });
      this.tweens.add({ targets: title, y: -62, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      this.confetti();
      this.time.delayedCall(1300, () => hero.active && playAnim(hero, 'victory', 'idle', false));
    }
  }

  private confetti(): void {
    const colors = [COLORS.gold, COLORS.red, COLORS.skyBlue, COLORS.green, 0xffffff];
    for (let i = 0; i < 36; i++) {
      const x = GAME_WIDTH / 2 + Phaser.Math.Between(-120, 120);
      const p = this.add.rectangle(x, 30, 2, 3, colors[i % colors.length]).setDepth(20);
      this.tweens.add({
        targets: p,
        y: Phaser.Math.Between(150, 260),
        x: x + Phaser.Math.Between(-30, 30),
        angle: Phaser.Math.Between(-360, 360),
        alpha: 0,
        delay: Phaser.Math.Between(0, 400),
        duration: Phaser.Math.Between(900, 1600),
        onComplete: () => p.destroy(),
      });
    }
  }
}
