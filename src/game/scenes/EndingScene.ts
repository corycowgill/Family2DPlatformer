import { queueThemeBackgrounds } from '../systems/ThemeAssets';
import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { IMAGES } from '../data/assets';
import { CHARACTERS } from '../characters';
import { audio } from '../systems/AudioSystem';
import { saveSystem } from '../systems/SaveSystem';
import { playAnim } from '../systems/AnimationSystem';
import { px } from '../ui/PixelFont';
import { isRealAsset } from '../ui/Icons';
import { prompt } from '../ui/Prompts';
import { COLORS } from '../ui/Widgets';
import { reducedMotion, transitionIn, transitionTo } from '../ui/Transitions';
import { ENDING_CAPTION, ENDING_CREDITS, ENDING2_CAPTION, FAMILY, TEASER_CAPTION, TEASER2_CAPTION } from '../story/storyData';
import { LEVELS } from '../data/levels';
import {
  CONFETTI_COLORS,
  CaptionBox,
  FLAG_TEX,
  INK,
  W_FLAG_TEX,
  confetti,
  cutsceneControls,
  ensureStoryTextures,
  firework,
  popIn,
  type CutsceneControls,
} from '../story/Cutscene';
import type { CharacterId } from '../types';

export interface EndingSceneData {
  /** Rewatching from Extras: return there instead of the world map. */
  replay?: boolean;
  /** Which world was just completed (default 1). */
  world?: number;
}

type Beat = 'flag' | 'credits' | 'teaser' | 'done';

const DECK_Y = 222;
const POLE_X = 410;
const POLE_TOP = 104;
const FLAG_BOTTOM = 160;
const ROLL_TOP = 12;
const ROLL_BOTTOM = 172;

/**
 * World 2 ending (`world: 2`): the family raises the white "W" flag over Wrigley Field at
 * night (fireworks), then a short teaser of Navy Pier's Ferris wheel spinning backwards —
 * "WORLD 3: COMING SOON". No credits roll. Ends at the world map.
 *
 * World 1 ending: the family raises a Chicago flag on the L platform at sunset (confetti +
 * fireworks), "THE LOOP IS SAVED!", a credits roll, then a night-time teaser of the alien
 * Overseer over Lincoln Park / Wrigleyville — "WORLD 2: COMING SOON". Ends at the world map.
 */
export class EndingScene extends Phaser.Scene {
  private beat: Beat = 'flag';
  private data0: EndingSceneData = {};
  private caption!: CaptionBox;
  private controls?: CutsceneControls;
  private family: Phaser.GameObjects.Sprite[] = [];
  private flag!: Phaser.GameObjects.Sprite;
  private flagUp = false;
  private title?: Phaser.GameObjects.BitmapText;
  private dusk!: Phaser.GameObjects.Rectangle;
  private roll: Phaser.GameObjects.GameObject[] = [];
  private rollY = 0;
  private rollH = 0;
  private confettiE?: Phaser.GameObjects.Particles.ParticleEmitter;
  private fireT = 0;
  private teaserUpdate?: (dt: number) => void;
  private teaserReady = false;
  private beatMs = 0;
  private finished = false;
  private t = 0;
  private world = 1;

  constructor() {
    super('Ending');
  }

  init(data: EndingSceneData): void {
    this.data0 = data ?? {};
    this.world = this.data0.world ?? 1;
    this.beat = 'flag';
    this.family = [];
    this.flagUp = false;
    this.title = undefined;
    this.roll = [];
    this.confettiE = undefined;
    this.teaserUpdate = undefined;
    this.teaserReady = false;
    this.beatMs = 0;
    this.finished = false;
    this.fireT = 0;
    this.t = 0;
  }

  /** The World 2 ending stands in the (lazily loaded) stadium. */
  preload(): void {
    if ((this.data0.world ?? 1) === 2) queueThemeBackgrounds(this, 'stadium');
  }

  create(): void {
    ensureStoryTextures(this);
    if (this.world === 2) {
      saveSystem.markStorySeen('world2-ending');
      this.buildStadium();
    } else {
      saveSystem.update((d) => (d.seenEnding = true));
      this.buildSunset();
    }
    this.caption = new CaptionBox(this, 60, 234, GAME_WIDTH - 120, 30, { depth: 60 });
    this.caption.setVisible(false);
    this.controls = cutsceneControls(this, { next: () => this.next(), skip: () => this.finish() }, 13, 900);
    audio.stopMusic();
    audio.music('worldclear');
    this.startFlagBeat();
    transitionIn(this);
    (window as unknown as { __ending?: EndingScene }).__ending = this;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      const w = window as unknown as { __ending?: EndingScene };
      if (w.__ending === this) w.__ending = undefined;
    });
  }

  /** Current beat (tests / debug). */
  get currentBeat(): Beat {
    return this.beat;
  }

  /** Which world's ending is playing (tests / debug). */
  get endingWorld(): number {
    return this.world;
  }

  // ------------------------------------------------------------------ scene building

  private img(key: string, x: number, y: number, depth: number): Phaser.GameObjects.Image | undefined {
    if (!this.textures.exists(key)) return undefined;
    return this.add.image(x, y, key).setOrigin(0).setDepth(depth);
  }

  private buildSunset(): void {
    this.cameras.main.setBackgroundColor(0x3a2a5e);
    this.img(IMAGES.bg('sunset', 'sky'), 0, 0, 0);
    const clouds = this.img('bg-sunset-clouds', 0, 0, 1);
    if (clouds && !reducedMotion()) this.tweens.add({ targets: clouds, x: -120, duration: 60000 });
    this.img(IMAGES.bg('sunset', 'far'), -140, 0, 2);
    this.img(IMAGES.bg('sunset', 'mid'), -60, 6, 3);
    // Dusk overlay (deepens during the credits).
    this.dusk = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x0b1030, 0).setOrigin(0).setDepth(4);

    // The L platform the family stands on.
    const g = this.add.graphics().setDepth(10);
    // Railing behind.
    g.fillStyle(0x2a1e30, 1).fillRect(0, DECK_Y - 18, GAME_WIDTH, 2);
    for (let x = 4; x < GAME_WIDTH; x += 16) g.fillRect(x, DECK_Y - 18, 2, 18);
    // Deck.
    g.fillStyle(0x6f6a72, 1).fillRect(0, DECK_Y, GAME_WIDTH, 6);
    g.fillStyle(0x9a94a0, 1).fillRect(0, DECK_Y, GAME_WIDTH, 1);
    g.fillStyle(0xe8c23a, 1).fillRect(0, DECK_Y + 6, GAME_WIDTH, 2);
    g.fillStyle(0x2a1e24, 1).fillRect(0, DECK_Y + 8, GAME_WIDTH, GAME_HEIGHT - DECK_Y - 8);
    // Girder lattice under the deck.
    g.fillStyle(0x5a3a2a, 1).fillRect(0, DECK_Y + 10, GAME_WIDTH, 2).fillRect(0, DECK_Y + 24, GAME_WIDTH, 2);
    g.lineStyle(1, 0x5a3a2a, 1);
    for (let x = 0; x < GAME_WIDTH; x += 14) {
      g.lineBetween(x, DECK_Y + 12, x + 7, DECK_Y + 24);
      g.lineBetween(x + 7, DECK_Y + 24, x + 14, DECK_Y + 12);
    }
    // CTA station sign: "LOOP" with the colours of the lines that run around it.
    const sx = 56;
    const sy = DECK_Y - 46;
    g.fillStyle(0x3a3a3a, 1).fillRect(sx + 18, sy + 14, 2, 32).fillRect(sx + 50, sy + 14, 2, 32);
    g.fillStyle(0x111111, 1).fillRect(sx, sy - 2, 70, 18);
    g.fillStyle(0xffffff, 1).fillRect(sx, sy - 2, 70, 1);
    const lines = [0x62361b, 0x009b3a, 0xf9461c, 0xe27ea6, 0x522398];
    lines.forEach((c, i) => g.fillStyle(c, 1).fillRect(sx + 6 + i * 12, sy + 11, 10, 3));
    px(this, sx + 35, sy + 4, 'THE LOOP', { outline: false, color: 0xffffff }).setDepth(11);

    // Flagpole + rising Chicago flag.
    g.fillStyle(0xc8b48a, 1).fillRect(POLE_X - 7, DECK_Y - 6, 16, 6);
    g.fillStyle(0x8a7a5a, 1).fillRect(POLE_X - 7, DECK_Y - 1, 16, 1);
    g.fillStyle(0x6a7180, 1).fillRect(POLE_X, POLE_TOP, 3, DECK_Y - POLE_TOP - 6);
    g.fillStyle(0xd8dde8, 1).fillRect(POLE_X, POLE_TOP, 1, DECK_Y - POLE_TOP - 6);
    g.fillStyle(0xffd25a, 1).fillRect(POLE_X - 1, POLE_TOP - 4, 5, 4);
    g.fillStyle(0xfff1b0, 1).fillRect(POLE_X, POLE_TOP - 4, 2, 1);
    this.flag = this.add.sprite(POLE_X + 3, FLAG_BOTTOM, FLAG_TEX, 0).setOrigin(0, 0).setScale(2).setDepth(9);
    if (!reducedMotion()) this.flag.play('story:flag');
  }

  /** Wrigley Field at night: light towers, bleachers, the ivy wall and the marquee; a W flag on the pole. */
  private buildStadium(): void {
    this.cameras.main.setBackgroundColor(0x0b1438);
    // Painted stadium backdrop once the art ships; generated placeholders don't count.
    if (isRealAsset(this, IMAGES.bg('stadium', 'sky'))) {
      this.img(IMAGES.bg('stadium', 'sky'), 0, 0, 0);
      this.img(IMAGES.bg('stadium', 'far'), -140, 0, 2);
      this.img(IMAGES.bg('stadium', 'mid'), -60, 6, 3);
    } else {
      const g = this.add.graphics().setDepth(0);
      g.fillGradientStyle(0x070c28, 0x070c28, 0x24306a, 0x24306a, 1).fillRect(0, 0, GAME_WIDTH, DECK_Y);
      for (let k = 0; k < 60; k++) g.fillStyle(k % 5 ? 0x8fa6d8 : 0xffffff, 1).fillRect((k * 131) % GAME_WIDTH, (k * 37) % 110, 1, 1);
      // Light towers with glowing banks.
      for (const x of [40, 250, 452]) {
        g.fillStyle(0x2a2f48, 1).fillRect(x - 1, 40, 3, DECK_Y - 40);
        g.fillStyle(0x3a4060, 1).fillRect(x - 12, 30, 25, 12);
        for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) g.fillStyle(0xfff6c8, 1).fillRect(x - 10 + i * 6, 32 + j * 5, 4, 3);
      }
      // Bleachers: grey tiers under the lights.
      g.fillStyle(0x2c3350, 1).fillRect(0, 128, GAME_WIDTH, 50);
      for (let y = 132; y < 176; y += 6) g.fillStyle(0x3a4266, 1).fillRect(0, y, GAME_WIDTH, 2);
      for (let k = 0; k < 140; k++) g.fillStyle([0xe8414e, 0x2f5fc0, 0xfff3c4, 0x5aa0e0][k % 4], 0.9).fillRect((k * 53) % GAME_WIDTH, 131 + ((k * 7) % 7) * 6, 2, 2);
      // Brick wall with ivy.
      g.fillStyle(0x7a3a2a, 1).fillRect(0, 178, GAME_WIDTH, 26);
      g.fillStyle(0x245a2a, 1).fillRect(0, 180, GAME_WIDTH, 22);
      for (let x = 0; x < GAME_WIDTH; x += 5) g.fillStyle(x % 15 ? 0x2f7a3a : 0x3f9a4a, 1).fillRect(x, 180 + ((x * 3) % 8), 4, 5);
      const glow = this.add.graphics().setDepth(1).setBlendMode(Phaser.BlendModes.ADD);
      for (const x of [40, 250, 452]) glow.fillStyle(0xfff2b0, 0.12).fillCircle(x, 36, 34).fillStyle(0xfff2b0, 0.2).fillCircle(x, 36, 16);
    }
    this.dusk = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x0b1030, 0).setOrigin(0).setDepth(4);
    // Outfield grass the family stands on, warning track below.
    const g = this.add.graphics().setDepth(10);
    g.fillStyle(0x2f8a3a, 1).fillRect(0, DECK_Y - 18, GAME_WIDTH, 18);
    for (let x = 0; x < GAME_WIDTH; x += 32) g.fillStyle(0x3a9a46, 1).fillRect(x, DECK_Y - 18, 16, 18);
    g.fillStyle(0xb07a4a, 1).fillRect(0, DECK_Y, GAME_WIDTH, GAME_HEIGHT - DECK_Y);
    g.fillStyle(0xc8925a, 1).fillRect(0, DECK_Y, GAME_WIDTH, 2);
    // The red marquee.
    const sx = 70;
    const sy = DECK_Y - 70;
    g.fillStyle(0x2a2a30, 1).fillRect(sx - 3, sy + 24, 6, 46);
    g.fillStyle(0x6a1018, 1).fillRect(sx - 46, sy - 2, 92, 28);
    g.fillStyle(0xc8202e, 1).fillRect(sx - 44, sy, 88, 24);
    for (let x = sx - 42; x <= sx + 42; x += 6) g.fillStyle(0xffe08a, 1).fillRect(x, sy - 2, 2, 1).fillRect(x, sy + 25, 2, 1);
    px(this, sx, sy + 7, 'WRIGLEY', { outline: false, color: 0xffffff }).setDepth(11);
    px(this, sx, sy + 17, 'FIELD', { outline: false, color: 0xffffff }).setDepth(11);
    // Flagpole + rising W flag.
    g.fillStyle(0x6a7180, 1).fillRect(POLE_X, POLE_TOP, 3, DECK_Y - POLE_TOP);
    g.fillStyle(0xd8dde8, 1).fillRect(POLE_X, POLE_TOP, 1, DECK_Y - POLE_TOP);
    g.fillStyle(0xffd25a, 1).fillRect(POLE_X - 1, POLE_TOP - 4, 5, 4);
    this.flag = this.add.sprite(POLE_X + 3, FLAG_BOTTOM, W_FLAG_TEX, 0).setOrigin(0, 0).setScale(2).setDepth(9);
    if (!reducedMotion()) this.flag.play('story:flag-w');
  }

  // ------------------------------------------------------------------ beats

  private startFlagBeat(): void {
    this.beat = 'flag';
    this.beatMs = 0;
    const still = reducedMotion();
    const targets = [140, 190, 240, 290, 338];
    FAMILY.forEach((id, i) => {
      const s = this.add.sprite(targets[i], DECK_Y + 1, id).setOrigin(0.5, 1).setDepth(20);
      this.add.ellipse(targets[i], DECK_Y + 1, id === 'lupin' ? 24 : 18, 4, 0x000000, 0.3).setDepth(19);
      this.family.push(s);
      if (still) {
        playAnim(s, 'idle', 'idle', false);
        return;
      }
      s.x = -30 - i * 34;
      playAnim(s, 'walk', 'idle', false);
      this.tweens.add({
        targets: s,
        x: targets[i],
        duration: 1700 + i * 120,
        ease: 'Sine.out',
        onComplete: () => {
          // Turn to face the flag.
          playAnim(s, 'idle', 'idle', false);
        },
      });
    });
    this.time.delayedCall(still ? 300 : 2100, () => this.raiseFlag());
    this.time.delayedCall(still ? 300 : 900, () => {
      this.caption.setVisible(true);
      this.caption.say(this.world === 2 ? ENDING2_CAPTION : ENDING_CAPTION);
    });
  }

  private raiseFlag(): void {
    if (this.beat !== 'flag' || this.flagUp) return;
    audio.sfx('goal');
    this.tweens.add({
      targets: this.flag,
      y: POLE_TOP + 1,
      duration: reducedMotion() ? 800 : 2600,
      ease: 'Sine.inOut',
      onComplete: () => this.flagRaised(),
    });
  }

  private flagRaised(): void {
    if (this.flagUp) return;
    this.flagUp = true;
    this.flag.y = POLE_TOP + 1;
    audio.sfx('oneup');
    for (const s of this.family) playAnim(s, 'victory', 'idle', false);
    const still = reducedMotion();
    const w2 = this.world === 2;
    this.title = px(this, GAME_WIDTH / 2, 38, w2 ? 'WRIGLEY IS SAVED!' : 'THE LOOP IS SAVED!', { scale: 3, color: COLORS.gold }).setDepth(50);
    popIn(this, this.title);
    const sub = px(this, GAME_WIDTH / 2, 62, w2 ? 'WORLD 2 COMPLETE · FLY THE W!' : 'WORLD 1 COMPLETE', { color: COLORS.sub }).setDepth(50);
    popIn(this, sub, 250);
    this.title.setData('sub', sub);
    this.confettiE = confetti(this, 0, -6, GAME_WIDTH, 45);
    if (!still) {
      for (let i = 0; i < 3; i++) this.time.delayedCall(i * 260, () => this.burst());
    }
  }

  private burst(): void {
    if (reducedMotion()) return;
    const x = Phaser.Math.Between(60, GAME_WIDTH - 60);
    const y = Phaser.Math.Between(70, 140);
    firework(this, x, y, Phaser.Utils.Array.GetRandom(CONFETTI_COLORS) as number, 5);
    if (Math.random() < 0.5) audio.sfx('explosion', { volume: 0.25 });
  }

  private startCredits(): void {
    if (this.beat !== 'flag') return;
    if (!this.flagUp) {
      this.tweens.killTweensOf(this.flag);
      this.flagRaised();
    }
    this.beat = 'credits';
    this.beatMs = 0;
    this.caption.complete();
    this.caption.setVisible(false);
    const sub = this.title?.getData('sub') as Phaser.GameObjects.BitmapText | undefined;
    this.tweens.add({ targets: [this.title, sub].filter(Boolean), alpha: 0, duration: 500 });
    this.tweens.add({ targets: this.dusk, fillAlpha: 0.5, duration: 4000 });
    this.confettiE?.stop();
    this.time.delayedCall(1500, () => this.sys.isActive() && this.beat === 'credits' && audio.music('title'));
    for (const s of this.family) {
      if (s.texture.key !== 'lupin') playAnim(s, 'idle', 'idle', false);
    }

    // Build the roll (each line is its own object so it can fade at the edges).
    let y = 0;
    for (const [text, kind] of ENDING_CREDITS) {
      if (kind === 'gap') {
        y += 10;
        continue;
      }
      if (kind === 'family') {
        FAMILY.forEach((id, i) => {
          const x = GAME_WIDTH / 2 + (i - 2) * 56;
          const key = IMAGES.portrait(id);
          if (this.textures.exists(key)) {
            const frame = this.add.rectangle(x, y + 12, 28, 28, CHARACTERS[id as CharacterId].color).setStrokeStyle(1, INK).setDepth(30);
            const p = this.add.image(x, y + 12, key).setDisplaySize(24, 24).setDepth(31);
            this.roll.push(frame, p);
            frame.setData('y0', y + 12);
            p.setData('y0', y + 12);
          }
          const name = id === 'lupin' ? 'LUPIN THE DOG' : CHARACTERS[id as CharacterId].name.toUpperCase();
          const t = px(this, x, y + 34, name, { color: COLORS.text }).setDepth(31);
          t.setData('y0', y + 34);
          this.roll.push(t);
        });
        y += 46;
        continue;
      }
      const t = px(this, GAME_WIDTH / 2, y, text, {
        scale: kind === 'h' ? 2 : 1,
        color: kind === 'h' ? COLORS.gold : kind === 's' ? COLORS.red : COLORS.text,
      }).setDepth(31);
      t.setData('y0', y);
      this.roll.push(t);
      y += kind === 'h' ? 22 : 13;
    }
    this.rollH = y;
    this.rollY = ROLL_BOTTOM + 4;
    this.layoutRoll();
  }

  private layoutRoll(): void {
    for (const o of this.roll) {
      const obj = o as Phaser.GameObjects.Image;
      const y = Math.round(this.rollY + (obj.getData('y0') as number));
      obj.y = y;
      const a = Math.min(1, Math.max(0, (y - ROLL_TOP) / 18), Math.max(0, (ROLL_BOTTOM - y) / 18));
      obj.setAlpha(a);
      obj.setVisible(a > 0);
    }
  }

  private startTeaser(): void {
    if (this.beat === 'teaser' || this.beat === 'done') return;
    this.beat = 'teaser';
    this.beatMs = 0;
    for (const o of this.roll) o.destroy();
    this.roll = [];
    this.confettiE?.stop();
    audio.stopMusic();
    // Cover-wipe into the night scene.
    const cover = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, INK, 0).setOrigin(0).setDepth(80);
    this.tweens.add({
      targets: cover,
      fillAlpha: 1,
      duration: 500,
      onComplete: () => {
        if (this.world === 2) this.buildTeaser3();
        else this.buildTeaser();
        this.tweens.add({ targets: cover, fillAlpha: 0, duration: 600, onComplete: () => cover.destroy() });
      },
    });
  }

  private buildTeaser(): void {
    const c = this.add.container(0, 0).setDepth(70);
    const still = reducedMotion();
    // Night sky.
    const sky = this.add.graphics();
    sky.fillGradientStyle(0x040818, 0x040818, 0x1b2a5a, 0x1b2a5a, 1).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    c.add(sky);
    const stars = this.add.graphics();
    for (let k = 0; k < 70; k++) stars.fillStyle(k % 6 ? 0x8fa6d8 : 0xffffff, 1).fillRect((k * 131) % GAME_WIDTH, (k * 37) % 150, 1, 1);
    c.add(stars);
    if (!still) this.tweens.add({ targets: stars, alpha: 0.6, duration: 900, yoyo: true, repeat: -1 });
    // Moon.
    const moon = this.add.graphics();
    moon.fillStyle(0xfff3c4, 1).fillCircle(446, 58, 12);
    moon.fillStyle(0x040818, 1).fillCircle(452, 54, 10);
    c.add(moon);
    // Downtown, far away (silhouette).
    if (this.textures.exists('bg-day-far')) {
      c.add(this.add.image(-200, 18, 'bg-day-far').setOrigin(0).setTint(0x1c2550).setAlpha(0.95));
    }
    // Lincoln Park trees.
    const trees = this.add.graphics();
    for (let x = -10; x < GAME_WIDTH + 20; x += 22) {
      const r = 14 + ((x * 7) % 9);
      trees.fillStyle(0x0d2a22, 1).fillCircle(x, 214 - (x % 3) * 3, r);
      trees.fillStyle(0x163a2c, 1).fillCircle(x - 3, 210 - (x % 3) * 3, r - 6);
    }
    trees.fillStyle(0x0a1a18, 1).fillRect(0, 214, GAME_WIDTH, GAME_HEIGHT - 214);
    c.add(trees);
    // Wrigleyville marquee.
    const m = this.add.container(150, 150);
    const mg = this.add.graphics();
    mg.fillStyle(0x2a2a30, 1).fillRect(-4, 20, 8, 70);
    mg.fillStyle(0x6a1018, 1).fillRect(-52, -26, 104, 30);
    mg.fillStyle(0xc8202e, 1).fillRect(-50, -24, 100, 26);
    mg.fillStyle(0xffffff, 1).fillRect(-50, -24, 100, 1);
    mg.fillStyle(0x182a5a, 1).fillRect(-46, 4, 92, 18);
    mg.fillStyle(0x0a1430, 1).fillRect(-44, 6, 88, 14);
    // Marquee bulbs.
    for (let x = -48; x <= 48; x += 6) mg.fillStyle(0xffe08a, 1).fillRect(x, -26, 2, 1).fillRect(x, 3, 2, 1);
    m.add(mg);
    m.add(px(this, 0, -16, 'WRIGLEY', { outline: false, color: 0xffffff }));
    m.add(px(this, 0, -6, 'FIELD', { outline: false, color: 0xffffff }));
    const ticker = px(this, 0, 13, 'GAME DELAYED: UFO', { outline: false, color: 0xffd25a });
    m.add(ticker);
    c.add(m);
    if (!still) this.tweens.add({ targets: ticker, alpha: 0.4, duration: 500, yoyo: true, repeat: -1 });

    // The Overseer descends.
    const beam = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    c.add(beam);
    const pod = this.add.sprite(360, -40, 'overseer').setOrigin(0.5, 1);
    playAnim(pod, 'idle');
    c.add(pod);
    const gnats: Phaser.GameObjects.Sprite[] = [];
    for (let k = 0; k < 3; k++) {
      const gs = this.add.sprite(360, 60, 'gnat').setOrigin(0.5);
      playAnim(gs, 'move');
      gs.setAlpha(0);
      gnats.push(gs);
      c.add(gs);
    }
    const podY = 150;
    let down = false;
    this.tweens.add({
      targets: pod,
      y: podY,
      duration: still ? 600 : 2600,
      ease: 'Sine.out',
      onComplete: () => {
        down = true;
        gnats.forEach((g) => this.tweens.add({ targets: g, alpha: 1, duration: 400 }));
        this.time.delayedCall(still ? 300 : 900, () => this.revealWorld2(c));
      },
    });
    audio.sfx('secret');

    this.caption.setVisible(true);
    this.caption.container.setDepth(90);
    this.caption.say(TEASER_CAPTION);
    let tt = 0;
    this.teaserUpdate = (dt) => {
      tt += dt;
      const bob = still ? 0 : Math.sin(tt / 500) * 3;
      if (down) pod.y = podY + bob;
      beam.clear();
      if (pod.y > 40) {
        const a = still ? 0.2 : 0.14 + 0.08 * Math.sin(tt / 170);
        const sweep = still ? -40 : Math.sin(tt / 1400) * 70 - 30;
        const top = pod.y - 6;
        beam.fillStyle(0x7aff9a, a).fillTriangle(pod.x - 5, top, pod.x + 5, top, pod.x + sweep + 34, 214);
        beam.fillTriangle(pod.x - 5, top, pod.x + 5, top, pod.x + sweep - 34, 214);
        beam.fillStyle(0xd0ffe0, a).fillTriangle(pod.x - 1, top, pod.x + 1, top, pod.x + sweep, 214);
        beam.fillStyle(0x7aff9a, a * 1.4).fillEllipse(pod.x + sweep, 214, 76, 8);
      }
      gnats.forEach((g, k) => {
        const ph = tt / 600 + (k * Math.PI * 2) / 3;
        g.setPosition(pod.x + Math.cos(ph) * 54, pod.y - 50 + Math.sin(ph) * 16);
        g.setFlipX(Math.sin(ph) < 0);
      });
    };
  }

  private revealWorld2(c: Phaser.GameObjects.Container): void {
    if (this.teaserReady || this.beat !== 'teaser') return;
    this.teaserReady = true;
    const still = reducedMotion();
    // World 2 is playable now: the teaser opens it instead of promising it.
    const w = px(this, 160, 30, 'WORLD 2', { scale: 3, color: 0x7aff9a });
    const s = px(this, 160, 54, 'UNLOCKED!', { scale: 2, color: 0xff6aa8 });
    const n = px(this, 160, 70, 'THE NORTH SIDE', { color: 0xffffff });
    c.add([w, s, n]);
    popIn(this, w);
    popIn(this, s, 300);
    popIn(this, n, 500);
    audio.sfx('powerup');
    if (!still) {
      // A little alien glitch on the title.
      this.time.addEvent({
        delay: 1400,
        loop: true,
        callback: () => {
          if (!w.active) return;
          w.x += 2;
          w.setTint(0xff6aa8);
          this.time.delayedCall(70, () => w.active && (w.x -= 2, w.setTint(0x7aff9a)));
        },
      });
    }
    const end = prompt(this, 160, 86, (d) => (d === 'touch' ? 'TAP TO CONTINUE' : '{CONFIRM} CONTINUE'), { color: COLORS.sub });
    c.add(end);
    popIn(this, end, 900);
  }

  /** World 2 teaser: Navy Pier at night, the Ferris wheel turning the wrong way. */
  private buildTeaser3(): void {
    const c = this.add.container(0, 0).setDepth(70);
    const still = reducedMotion();
    const sky = this.add.graphics();
    sky.fillGradientStyle(0x040818, 0x040818, 0x1b2a5a, 0x1b2a5a, 1).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    for (let k = 0; k < 60; k++) sky.fillStyle(k % 6 ? 0x8fa6d8 : 0xffffff, 1).fillRect((k * 131) % GAME_WIDTH, (k * 37) % 140, 1, 1);
    // Lake + pier.
    sky.fillStyle(0x0c2a5a, 1).fillRect(0, 196, GAME_WIDTH, GAME_HEIGHT - 196);
    for (let k = 0; k < 24; k++) sky.fillStyle(0x3a6ab0, 0.8).fillRect((k * 97) % GAME_WIDTH, 204 + ((k * 13) % 50), 6, 1);
    sky.fillStyle(0x6a7180, 1).fillRect(0, 190, 330, 8);
    sky.fillStyle(0x3a3f50, 1);
    for (let x = 6; x < 330; x += 24) sky.fillRect(x, 198, 3, 16);
    c.add(sky);
    // Ferris wheel (spinning backwards).
    const cx = 210;
    const cy = 120;
    const wheel = this.add.graphics({ x: cx, y: cy });
    const r = 62;
    wheel.lineStyle(2, 0xe8414e, 1).strokeCircle(0, 0, r);
    wheel.lineStyle(1, 0xe8414e, 0.8).strokeCircle(0, 0, r - 8);
    for (let a = 0; a < 16; a++) {
      const ang = (a * Math.PI) / 8;
      wheel.lineStyle(1, 0xc8c8d8, 0.7).lineBetween(0, 0, Math.cos(ang) * r, Math.sin(ang) * r);
      wheel.fillStyle([0xffd25a, 0x7aff9a, 0x5aa0e0, 0xff6aa8][a % 4], 1).fillRect(Math.round(Math.cos(ang) * r) - 3, Math.round(Math.sin(ang) * r) - 2, 6, 5);
    }
    const legs = this.add.graphics();
    legs.lineStyle(3, 0x9aa4b0, 1).lineBetween(cx, cy, cx - 34, 190).lineBetween(cx, cy, cx + 34, 190);
    c.add([legs, wheel]);
    if (!still) this.tweens.add({ targets: wheel, angle: -360, duration: 5200, repeat: -1 });
    const swirl = px(this, cx, cy, '?', { scale: 2, color: 0x7aff9a });
    c.add(swirl);
    // A couple of gnats buzz around the wheel.
    const gnats = [0, 1, 2].map(() => {
      const s = this.add.sprite(cx, cy, 'gnat').setOrigin(0.5);
      playAnim(s, 'move');
      c.add(s);
      return s;
    });
    this.caption.setVisible(true);
    this.caption.container.setDepth(90);
    this.caption.say(TEASER2_CAPTION);
    audio.sfx('secret');
    let tt = 0;
    this.teaserUpdate = (dt) => {
      tt += dt;
      gnats.forEach((g, k) => {
        const ph = -tt / 700 + (k * Math.PI * 2) / 3;
        g.setPosition(cx + Math.cos(ph) * 84, cy + Math.sin(ph) * 30);
        g.setFlipX(Math.sin(ph) > 0);
      });
    };
    this.time.delayedCall(still ? 300 : 1600, () => {
      if (this.teaserReady || this.beat !== 'teaser') return;
      this.teaserReady = true;
      const w = px(this, 380, 40, 'WORLD 3', { scale: 3, color: 0x7aff9a });
      const s = px(this, 380, 66, 'COMING SOON', { scale: 2, color: 0xff6aa8 });
      c.add([w, s]);
      popIn(this, w);
      popIn(this, s, 300);
      audio.sfx('powerup');
      const end = prompt(this, 380, 88, (d) => (d === 'touch' ? 'TAP TO CONTINUE' : '{CONFIRM} CONTINUE'), { color: COLORS.sub });
      c.add(end);
      popIn(this, end, 900);
    });
  }

  // ------------------------------------------------------------------ flow

  private next(): void {
    if (this.finished) return;
    if (this.beat === 'flag') {
      if (!this.caption.done) this.caption.complete();
      else if (!this.flagUp) {
        this.tweens.killTweensOf(this.flag);
        this.flagRaised();
      } else if (this.world === 2) this.startTeaser();
      else this.startCredits();
    } else if (this.beat === 'credits') this.startTeaser();
    else if (this.beat === 'teaser') {
      if (!this.caption.done) this.caption.complete();
      else if (this.teaserReady && this.beatMs > 600) this.finish();
    }
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.beat = 'done';
    this.controls?.destroy();
    audio.sfx('confirm');
    if (this.data0.replay) transitionTo(this, 'Extras');
    else {
      // After World 1 the map opens on 2-1 (World 2 is unlocked by then).
      if (this.world === 1) {
        const i = LEVELS.findIndex((l) => l.id === 'north-1');
        if (i >= 0 && saveSystem.isUnlocked('north-1')) this.registry.set('mapIndex', i);
      }
      transitionTo(this, 'WorldMap');
    }
  }

  update(_t: number, delta: number): void {
    this.t += delta;
    this.beatMs += delta;
    this.caption.update(delta);
    if (this.beat === 'flag') {
      if (this.flagUp && this.caption.done && this.beatMs > 9000) {
        if (this.world === 2) this.startTeaser();
        else this.startCredits();
      }
      if (this.flagUp) this.fireworks(delta, 700);
    } else if (this.beat === 'credits') {
      this.fireworks(delta, 1600);
      this.rollY -= (delta / 1000) * (reducedMotion() ? 22 : 26);
      this.layoutRoll();
      if (this.rollY + this.rollH < ROLL_TOP - 4) this.startTeaser();
    } else if (this.beat === 'teaser') {
      this.teaserUpdate?.(delta);
      if (this.teaserReady && this.beatMs > 14000) this.finish();
    }
  }

  private fireworks(delta: number, every: number): void {
    if (reducedMotion()) return;
    this.fireT -= delta;
    if (this.fireT <= 0) {
      this.fireT = every * (0.6 + Math.random() * 0.8);
      this.burst();
    }
  }
}
