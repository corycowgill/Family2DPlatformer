import Phaser from 'phaser';
import { GAME_WIDTH } from '../config';
import { EV, type PickupKind } from '../types';
import { gameState } from '../state/GameState';
import { heroPortrait } from '../ui/CharacterArt';
import { CHARACTERS } from '../characters';
import type { LevelScene } from './LevelScene';
import { TouchControls } from '../ui/TouchControls';
import { px, setPx } from '../ui/PixelFont';
import { icon, setIcon, hasRealFrame } from '../ui/Icons';
import { COLORS, drawPanel } from '../ui/Widgets';
import { pad, remaining01 } from '../ui/format';
import { reducedMotion } from '../ui/Transitions';
import { audio } from '../systems/AudioSystem';
import { prompt } from '../ui/Prompts';
import { attachRumble } from '../ui/PadOverlay';

const POWERUP_ICON: Partial<Record<PickupKind, string>> = { star: 'star_icon', ctaPass: 'pass', hotdog: 'hotdog', pizza: 'pizza' };
const ABILITY_SHORT: Record<string, string> = { groundPound: 'POUND', airJump: 'SPARKLE', dash: 'DASH', projectile: 'BLAST', sniff: 'SNIFF', panSpin: 'SPIN' };

/** Heads-up display, runs above LevelScene and listens to its events. */
export class HUDScene extends Phaser.Scene {
  private level!: LevelScene;
  private touch!: TouchControls;
  private powerups = new Map<PickupKind, { start: number; dur: number; img: Phaser.GameObjects.Image; bar: Phaser.GameObjects.Graphics }>();
  private abilityG!: Phaser.GameObjects.Graphics;
  private abilityT!: Phaser.GameObjects.BitmapText;
  private abilityRemaining = 0;
  private boss?: { c: Phaser.GameObjects.Container; bar: Phaser.GameObjects.Graphics; name: Phaser.GameObjects.BitmapText; hp: number; max: number; shown: number };
  private toastQueue: { text: string; color: number }[] = [];
  private toastBusy = false;

  constructor() {
    super('HUD');
  }

  init(data: { levelScene: LevelScene }): void {
    this.level = data.levelScene;
    this.powerups = new Map();
    this.boss = undefined;
    this.toastQueue = [];
    this.toastBusy = false;
    this.abilityRemaining = 0;
  }

  create(): void {
    const lv = this.level;
    const def = CHARACTERS[gameState.character];

    // --- Top-left: portrait, hearts, lives badge, ability gauge
    const g = this.add.graphics();
    const portraitKey = heroPortrait(this);
    if (this.textures.exists(portraitKey)) this.add.image(7, 7, portraitKey).setOrigin(0).setDisplaySize(24, 24);
    const livesT = px(this, 33, 30, '', { origin: [1, 1] });
    const hearts: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < lv.player.maxHealth; i++) hearts.push(icon(this, 41 + i * 10, 12, 'heart_full'));
    this.abilityG = this.add.graphics();
    this.abilityT = px(this, 51, 25, ABILITY_SHORT[def.ability] ?? 'ABILITY', { origin: [0, 0.5] });
    this.drawAbility();
    // Which button fires the ability (hidden on touch, where the ★ button says it).
    const abilityKey = prompt(this, Math.round(this.abilityT.x + this.abilityT.width + 3), 25, (d) => (d === 'touch' ? '' : '{ABILITY}'), { origin: [0, 0.5] });
    const panelW = () => Math.max(98, (abilityKey.blockW > 0 ? abilityKey.x + abilityKey.blockW : this.abilityT.x + this.abilityT.width) + 4 - 3);
    let shownW = 0;
    const drawLeftPanel = () => {
      const w = panelW();
      if (w === shownW) return;
      shownW = w;
      g.clear();
      drawPanel(g, 3, 3, w, 30, { alpha: 0.7 });
      g.fillStyle(COLORS.ink, 1).fillRect(6, 6, 26, 26);
      g.fillStyle(def.color, 1).fillRect(7, 7, 24, 24);
    };
    drawLeftPanel();
    this.events.on(Phaser.Scenes.Events.UPDATE, drawLeftPanel);

    // --- Top-right: coins, souvenirs, pause
    const rg = this.add.graphics();
    drawPanel(rg, GAME_WIDTH - 108, 3, 82, 30, { alpha: 0.7 });
    icon(this, GAME_WIDTH - 98, 12, 'coin_icon');
    const coinsT = px(this, GAME_WIDTH - 90, 12, '000', { origin: [0, 0.5] });
    const souv = [0, 1, 2].map((i) => icon(this, GAME_WIDTH - 94 + i * 15, 25, 'souvenir_icon_empty'));
    const pauseBtn = this.add.container(GAME_WIDTH - 13, 13).setSize(22, 22);
    const pg = this.add.graphics();
    drawPanel(pg, -10, -10, 20, 20, { alpha: 0.75 });
    pg.fillStyle(0xffffff, 1).fillRect(-4, -5, 3, 10).fillRect(1, -5, 3, 10);
    pauseBtn.add(pg);
    pauseBtn.setInteractive({ useHandCursor: true }).on('pointerup', () => {
      if (lv.sys.isActive()) lv.pauseGame();
    });
    pauseBtn.on('pointerdown', () => pauseBtn.setScale(0.9)).on('pointerout', () => pauseBtn.setScale(1));

    // --- Top-centre: level name (hidden while a boss bar is up)
    const levelT = px(this, GAME_WIDTH / 2, 8, `${lv.level.number} ${lv.level.name.toUpperCase()}`, { color: COLORS.sub });

    const setHealth = (h: number, max = lv.player.maxHealth) => {
      while (hearts.length < max) hearts.push(icon(this, 41 + hearts.length * 10, 12, 'heart_full'));
      hearts.forEach((img, i) => {
        img.setVisible(i < max);
        const full = i < h;
        const was = img.getData('full');
        setIcon(img, full ? 'heart_full' : 'heart_empty');
        img.setData('full', full);
        if (was === true && !full && !reducedMotion()) this.tweens.add({ targets: img, y: { from: 8, to: 12 }, duration: 250, ease: 'Bounce.out' });
        if (was === false && full && !reducedMotion()) this.tweens.add({ targets: img, scale: { from: 1.8, to: 1 }, duration: 250 });
      });
    };
    const setLives = (n: number) => setPx(livesT, `x${n}`);
    const setCoins = (n: number, bump = true) => {
      setPx(coinsT, pad(n, 3));
      if (bump && !reducedMotion()) this.tweens.add({ targets: coinsT, y: { from: 10, to: 12 }, duration: 120 });
    };
    const setSouvenir = (i: number, pop: boolean) => {
      const img = souv[i];
      if (!img) return;
      setIcon(img, 'souvenir_icon');
      if (pop && !reducedMotion()) this.tweens.add({ targets: img, scale: { from: 2.2, to: 1 }, duration: 350, ease: 'Back.out' });
    };
    setHealth(lv.player.health);
    setLives(gameState.lives);
    setCoins(lv.stats?.coins ?? 0, false);
    (lv.stats?.souvenirs ?? []).forEach((i) => setSouvenir(i, false));

    // --- Level intro banner
    this.banner(`${lv.level.number}`, lv.level.name.toUpperCase());

    // --- Event wiring
    const ev = lv.events;
    const handlers: [string, (...a: never[]) => void][] = [
      [EV.HEALTH_CHANGED, (h: number, max?: number) => setHealth(h, max)],
      [EV.COINS_CHANGED, (n: number) => setCoins(n)],
      [EV.LIVES_CHANGED, (n: number) => setLives(n)],
      [EV.SECRET_FOUND, (i: number) => {
        setSouvenir(i, true);
        this.toast('SOUVENIR FOUND!', COLORS.gold);
      }],
      [EV.CHECKPOINT, () => this.toast('CHECKPOINT!', COLORS.green)],
      [EV.ABILITY_COOLDOWN, (r: number) => {
        const wasReady = this.abilityRemaining <= 0;
        this.abilityRemaining = r;
        this.drawAbility();
        if (!wasReady && r <= 0 && !reducedMotion()) this.tweens.add({ targets: this.abilityT, scale: { from: 1.4, to: 1 }, duration: 200 });
      }],
      [EV.POWERUP_START, (k: PickupKind, dur: number) => this.powerupStart(k, dur)],
      [EV.POWERUP_END, (k: PickupKind) => this.powerupEnd(k)],
      [EV.BOSS_START, (name: string, max: number) => {
        levelT.setVisible(false);
        this.bossStart(name, max);
      }],
      [EV.BOSS_HEALTH, (hp: number, max: number) => this.bossHealth(hp, max)],
      [EV.BOSS_PHASE, (phase: number) => {
        this.toast(`PHASE ${phase}!`, COLORS.red);
        if (!reducedMotion()) this.cameras.main.flash(120, 255, 80, 80);
      }],
      [EV.BOSS_DEFEATED, () => {
        this.bossHealth(0, this.boss?.max ?? 1);
        this.toast('BOSS DEFEATED!', COLORS.gold);
        if (this.boss) this.tweens.add({ targets: this.boss.c, alpha: 0, delay: 900, duration: 500 });
      }],
      // Generic sound requests from gameplay code.
      [EV.SFX, (key: string) => audio.sfx(key)],
    ];
    for (const [e, fn] of handlers) ev.on(e, fn);
    const offRumble = attachRumble(ev);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const [e, fn] of handlers) ev.off(e, fn);
      offRumble();
      this.events.off(Phaser.Scenes.Events.UPDATE, drawLeftPanel);
    });

    // DOM touch overlay (shown only while the level runs on a touch device). It has its own
    // pause button, so the in-canvas one hides while the overlay is up.
    this.touch = new TouchControls(this, lv, (shown) => pauseBtn.setVisible(!shown));
  }

  // ------------------------------------------------------------------ pieces

  private drawAbility(): void {
    const g = this.abilityG;
    const cx = 44;
    const cy = 25;
    const r = 5;
    const ready = this.abilityRemaining <= 0;
    g.clear();
    g.fillStyle(COLORS.ink, 1).fillCircle(cx, cy, r + 1);
    g.fillStyle(0x2a3a5e, 1).fillCircle(cx, cy, r);
    if (ready) g.fillStyle(COLORS.gold, 1).fillCircle(cx, cy, r);
    else {
      const frac = 1 - Math.min(1, this.abilityRemaining);
      g.fillStyle(0x8a7a40, 1).slice(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2, false).fillPath();
    }
    g.fillStyle(0xffffff, ready ? 0.6 : 0.2).fillRect(cx - 2, cy - 3, 2, 2);
    this.abilityT.setTint(ready ? COLORS.text : COLORS.dim);
  }

  private powerupStart(kind: PickupKind, dur: number): void {
    this.powerupEnd(kind);
    if (!(dur > 0)) return;
    const y = 42 + this.powerups.size * 13;
    const img = icon(this, 12, y, POWERUP_ICON[kind] ?? 'star_icon');
    if (kind === 'ctaPass' && hasRealFrame(this, 'items', 'cta_pass')) img.setTexture('items', 'cta_pass').setDisplaySize(12, 12);
    const bar = this.add.graphics();
    this.powerups.set(kind, { start: this.level.time.now, dur, img, bar });
    if (!reducedMotion()) this.tweens.add({ targets: img, scale: { from: 2, to: 1 }, duration: 250 });
  }

  private powerupEnd(kind: PickupKind): void {
    const p = this.powerups.get(kind);
    if (!p) return;
    p.img.destroy();
    p.bar.destroy();
    this.powerups.delete(kind);
    // Re-stack remaining timers
    [...this.powerups.values()].forEach((q, i) => q.img.setY(42 + i * 13));
  }

  private bossStart(name: string, max: number): void {
    const w = 170;
    const c = this.add.container(GAME_WIDTH / 2, 0);
    const g = this.add.graphics();
    drawPanel(g, -w / 2 - 6, 2, w + 12, 26, { alpha: 0.8, border: COLORS.red });
    const nameT = px(this, 0, 10, name.toUpperCase(), { color: COLORS.red });
    const bar = this.add.graphics();
    c.add([g, nameT, bar]);
    this.boss = { c, bar, name: nameT, hp: max, max, shown: max };
    this.drawBoss();
    audio.sfx('boss-roar');
    if (!reducedMotion()) {
      c.setY(-30);
      this.tweens.add({ targets: c, y: 0, duration: 400, ease: 'Back.out' });
    }
  }

  private bossHealth(hp: number, max: number): void {
    if (!this.boss) return;
    const b = this.boss;
    b.hp = Math.max(0, hp);
    b.max = max;
    this.drawBoss();
  }

  private drawBoss(): void {
    const b = this.boss;
    if (!b) return;
    const w = 170;
    const g = b.bar;
    const x = -w / 2;
    const y = 18;
    g.clear();
    g.fillStyle(COLORS.ink, 1).fillRect(x - 1, y - 1, w + 2, 7);
    g.fillStyle(0x3a1020, 1).fillRect(x, y, w, 5);
    g.fillStyle(0xffffff, 0.8).fillRect(x, y, Math.round((w * b.shown) / b.max), 5);
    g.fillStyle(COLORS.red, 1).fillRect(x, y, Math.round((w * b.hp) / b.max), 5);
    g.fillStyle(0xff9aa4, 1).fillRect(x, y, Math.round((w * b.hp) / b.max), 1);
  }

  private banner(big: string, small: string): void {
    const c = this.add.container(GAME_WIDTH / 2, 92).setDepth(500);
    const g = this.add.graphics();
    g.fillStyle(COLORS.ink, 0.7).fillRect(-GAME_WIDTH / 2, -22, GAME_WIDTH, 44);
    g.fillStyle(COLORS.skyBlue, 1).fillRect(-GAME_WIDTH / 2, -22, GAME_WIDTH, 1).fillRect(-GAME_WIDTH / 2, 21, GAME_WIDTH, 1);
    c.add([g, px(this, 0, -8, `WORLD ${big}`, { scale: 2, color: COLORS.gold }), px(this, 0, 11, small, { color: COLORS.text })]);
    if (reducedMotion()) {
      this.tweens.add({ targets: c, alpha: 0, delay: 1600, duration: 300, onComplete: () => c.destroy() });
      return;
    }
    c.setX(GAME_WIDTH * 1.5);
    this.tweens.chain({
      targets: c,
      tweens: [
        { x: GAME_WIDTH / 2, duration: 350, ease: 'Cubic.out' },
        { x: -GAME_WIDTH / 2, duration: 350, delay: 1300, ease: 'Cubic.in' },
      ],
      onComplete: () => c.destroy(),
    });
  }

  toast(text: string, color: number = COLORS.text): void {
    this.toastQueue.push({ text, color });
    if (!this.toastBusy) this.nextToast();
  }

  private nextToast(): void {
    const t = this.toastQueue.shift();
    if (!t) {
      this.toastBusy = false;
      return;
    }
    this.toastBusy = true;
    const y = this.boss ? 40 : 30;
    const txt = px(this, GAME_WIDTH / 2, y, t.text, { scale: 1, color: t.color }).setDepth(400);
    const done = () => {
      txt.destroy();
      this.nextToast();
    };
    if (reducedMotion()) {
      this.time.delayedCall(1200, done);
      return;
    }
    txt.setScale(0.2);
    this.tweens.chain({
      targets: txt,
      tweens: [
        { scale: 1, duration: 180, ease: 'Back.out' },
        { alpha: 0, y: y - 8, delay: 900, duration: 300 },
      ],
      onComplete: done,
    });
  }

  update(_t: number, delta: number): void {
    this.touch.update();
    const now = this.level.time.now;
    for (const [kind, p] of this.powerups) {
      const r = remaining01(p.start, p.dur, now);
      const g = p.bar;
      g.clear();
      g.fillStyle(COLORS.ink, 0.8).fillRect(20, p.img.y - 3, 32, 6);
      g.fillStyle(r < 0.25 ? COLORS.red : COLORS.gold, 1).fillRect(21, p.img.y - 2, Math.round(30 * r), 4);
      if (r < 0.25) p.img.setAlpha(Math.floor(now / 120) % 2 ? 0.4 : 1);
      if (r <= 0) this.powerupEnd(kind);
    }
    const b = this.boss;
    if (b && b.shown > b.hp) {
      b.shown = Math.max(b.hp, b.shown - (b.max * delta) / 1500);
      this.drawBoss();
    }
  }
}
