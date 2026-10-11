import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { audio } from '../systems/AudioSystem';
import { saveSystem } from '../systems/SaveSystem';
import { playAnim } from '../systems/AnimationSystem';
import { px } from '../ui/PixelFont';
import { COLORS } from '../ui/Widgets';
import { reducedMotion, transitionIn, transitionTo } from '../ui/Transitions';
import { drawChicagoStar } from './MenuScene';
import { INTRO_PANELS, type IntroPanel } from '../story/storyData';
import { CaptionBox, CREAM, INK, cutsceneControls, drawElTrack, ensureStoryTextures, popIn, speechBubble, speedBurst, type CutsceneControls } from '../story/Cutscene';

export interface StorySceneData {
  /** Scene to start afterwards (default: Menu). */
  next?: string;
  nextData?: object;
}

/** Panel frame on the page (screen px). */
const PX0 = 14;
const PY0 = 10;
const PW = GAME_WIDTH - PX0 * 2;
const PH = 178;
/** Panel contents live far off-screen in world space; each panel has its own clipped camera. */
const ORIGIN_X = 4000;
const ORIGIN_Y = 4000;
const AUTO_ADVANCE_MS = 4200;

interface BuiltPanel {
  root: Phaser.GameObjects.Container;
  cam: Phaser.Cameras.Scene2D.Camera;
  update?: (dt: number, t: number) => void;
}

/**
 * Opening story: six comic panels with typewriter captions. Shown once when a new save
 * presses PLAY (see MenuScene), replayable from Extras. Every panel / the whole story is
 * skippable (CONFIRM = next, BACK / SKIP button = skip all).
 */
export class StoryScene extends Phaser.Scene {
  private index = -1;
  private current?: BuiltPanel;
  private caption!: CaptionBox;
  private controls?: CutsceneControls;
  private dots: Phaser.GameObjects.Graphics[] = [];
  private idleMs = 0;
  private finished = false;
  private data0: StorySceneData = {};
  private t = 0;

  constructor() {
    super('Story');
  }

  init(data: StorySceneData): void {
    this.data0 = data ?? {};
    this.index = -1;
    this.current = undefined;
    this.finished = false;
    this.idleMs = 0;
    this.t = 0;
    this.dots = [];
  }

  create(): void {
    ensureStoryTextures(this);
    this.cameras.main.setBackgroundColor(INK);
    this.drawPage();
    this.caption = new CaptionBox(this, PX0, PY0 + PH + 7, PW, 46);
    this.controls = cutsceneControls(this, { next: () => this.next(), skip: () => this.finish() });
    audio.music('title');
    this.goto(0);
    transitionIn(this);
    (window as unknown as { __story?: StoryScene }).__story = this;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      const w = window as unknown as { __story?: StoryScene };
      if (w.__story === this) w.__story = undefined;
    });
  }

  /** Current panel index (tests / debug). */
  get panel(): number {
    return this.index;
  }

  get panelCount(): number {
    return INTRO_PANELS.length;
  }

  // ------------------------------------------------------------------ page

  private drawPage(): void {
    const g = this.add.graphics();
    // Halftone dots on the page, Chicago-flag stripes top & bottom.
    g.fillStyle(0x13254a, 1);
    for (let y = 0; y < GAME_HEIGHT; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < GAME_WIDTH; x += 6) g.fillRect(x, y, 1, 1);
    // Panel frame + shadow.
    g.fillStyle(0x000000, 0.5).fillRect(PX0 + 3, PY0 + 3, PW, PH);
    g.fillStyle(0xffffff, 1).fillRect(PX0 - 3, PY0 - 3, PW + 6, PH + 6);
    g.fillStyle(INK, 1).fillRect(PX0 - 1, PY0 - 1, PW + 2, PH + 2);
    // Page dots (progress).
    const n = INTRO_PANELS.length;
    for (let i = 0; i < n; i++) {
      const d = this.add.graphics({ x: 22 + i * 10, y: 258 });
      this.dots.push(d);
    }
    this.drawDots();
  }

  private drawDots(): void {
    this.dots.forEach((d, i) => {
      d.clear();
      const on = i === this.index;
      const done = i < this.index;
      d.fillStyle(INK, 1).fillRect(-3, -3, 7, 7);
      d.fillStyle(on ? COLORS.gold : done ? COLORS.skyBlue : 0x2a3a5e, 1).fillRect(-2, -2, 5, 5);
    });
  }

  // ------------------------------------------------------------------ flow

  private next(): void {
    if (this.finished) return;
    if (!this.caption.done) {
      this.caption.complete();
      return;
    }
    if (this.index >= INTRO_PANELS.length - 1) this.finish();
    else this.goto(this.index + 1);
  }

  goto(i: number): void {
    if (i === this.index || i < 0 || i >= INTRO_PANELS.length) return;
    const dir = i > this.index ? 1 : -1;
    const old = this.current;
    this.index = i;
    this.idleMs = 0;
    const p = INTRO_PANELS[i];
    this.current = this.buildPanel(p, i);
    this.drawDots();
    this.caption.say(p.caption);
    audio.sfx('menu-select', { volume: 0.5 });

    const still = reducedMotion();
    const cam = this.current.cam;
    if (old) {
      if (still) {
        this.destroyPanel(old);
      } else {
        // New panel slides in over the old one; the old one drifts out the other way.
        cam.setPosition(PX0 + dir * (PW + PX0 * 2), PY0);
        this.tweens.add({ targets: cam, x: PX0, duration: 420, ease: 'Cubic.out' });
        this.tweens.add({ targets: old.cam, x: PX0 - dir * 120, alpha: 0, duration: 420, ease: 'Cubic.in', onComplete: () => this.destroyPanel(old) });
      }
    }
  }

  private destroyPanel(p: BuiltPanel): void {
    p.root.destroy();
    this.cameras.remove(p.cam);
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.caption.complete();
    this.controls?.destroy();
    saveSystem.update((d) => (d.seenIntro = true));
    audio.sfx('confirm');
    transitionTo(this, this.data0.next ?? 'Menu', this.data0.nextData);
  }

  update(_t: number, delta: number): void {
    this.t += delta;
    this.caption.update(delta);
    this.current?.update?.(delta, this.t);
    if (this.caption.done && !this.finished) {
      this.idleMs += delta;
      if (this.idleMs > AUTO_ADVANCE_MS) this.next();
    }
  }

  // ------------------------------------------------------------------ panels

  private buildPanel(p: IntroPanel, i: number): BuiltPanel {
    const ox = ORIGIN_X + i * 1000;
    const root = this.add.container(ox, ORIGIN_Y);
    const cam = this.cameras.add(PX0, PY0, PW, PH).setScroll(ox, ORIGIN_Y).setRoundPixels(true);
    cam.setBackgroundColor(0x6fb7ff);
    // The page's main camera must not draw panel content (it's off-screen anyway) and
    // panel cameras must not draw the page: they look at different world regions.
    const built: BuiltPanel = { root, cam };
    const build = {
      hotdogs: () => this.panelHotdogs(root, p),
      rumble: () => this.panelRumble(root, p, cam),
      eliminator: () => this.panelEliminator(root),
      haywire: () => this.panelHaywire(root),
      pod: () => this.panelPod(root),
      rally: () => this.panelRally(root, p),
    }[p.id];
    built.update = build();
    if (p.tag) this.tag(root, p.tag);
    return built;
  }

  /** Yellow caption tag in the panel's top-left corner. */
  private tag(root: Phaser.GameObjects.Container, text: string): void {
    const t = px(this, 8, 7, text, { origin: [0, 0], outline: false, color: INK });
    const g = this.add.graphics();
    g.fillStyle(INK, 1).fillRect(0, 0, t.width + 13, 17);
    g.fillStyle(CREAM, 1).fillRect(0, 0, t.width + 12, 16);
    g.lineStyle(1, INK, 1).strokeRect(0.5, 0.5, t.width + 11, 15);
    t.setPosition(6, 4);
    root.add([g, t]);
  }

  private img(root: Phaser.GameObjects.Container, key: string, x: number, y: number): Phaser.GameObjects.Image | undefined {
    if (!this.textures.exists(key)) return undefined;
    const im = this.add.image(x, y, key).setOrigin(0);
    root.add(im);
    return im;
  }

  private bg(root: Phaser.GameObjects.Container, theme: string, offX: number, offY: number, layers: string[] = ['sky', 'clouds', 'far', 'mid']): Record<string, Phaser.GameObjects.Image | undefined> {
    const out: Record<string, Phaser.GameObjects.Image | undefined> = {};
    for (const l of layers) out[l] = this.img(root, `bg-${theme}-${l}`, l === 'sky' ? 0 : offX, offY);
    if (out.sky) out.sky.setDisplaySize(PW, 270);
    return out;
  }

  private hero(root: Phaser.GameObjects.Container, id: string, x: number, y: number, anim = 'idle', scale = 1, flip = false): Phaser.GameObjects.Sprite {
    const s = this.add.sprite(x, y, id).setOrigin(0.5, 1).setScale(scale).setFlipX(flip);
    playAnim(s, anim, 'idle', false);
    root.add(s);
    return s;
  }

  private shadow(root: Phaser.GameObjects.Container, x: number, y: number, w: number): void {
    root.add(this.add.ellipse(x, y, w, 5, 0x000000, 0.28));
  }

  private sfxText(root: Phaser.GameObjects.Container, x: number, y: number, text: string, color: number, angle: number, delay = 0, scale = 2): Phaser.GameObjects.BitmapText {
    const t = px(this, x, y, text, { scale, color }).setAngle(angle);
    root.add(t);
    popIn(this, t, delay);
    if (!reducedMotion()) this.tweens.add({ targets: t, y: y - 2, duration: 260, yoyo: true, repeat: -1, delay: delay + 300 });
    return t;
  }

  private sidewalk(root: Phaser.GameObjects.Container, y: number): void {
    const g = this.add.graphics();
    g.fillStyle(0x8f8a80, 1).fillRect(0, y, PW, PH - y);
    g.fillStyle(0xb9b3a6, 1).fillRect(0, y, PW, 3);
    g.fillStyle(0x6f6a62, 1);
    for (let x = 12; x < PW; x += 34) g.fillRect(x, y + 3, 1, PH - y);
    g.fillStyle(0x4a4844, 1).fillRect(0, PH - 8, PW, 8);
    g.fillStyle(0xe8d27a, 1).fillRect(0, PH - 8, PW, 1);
    root.add(g);
  }

  // 1. Hot dogs in the Loop.
  private panelHotdogs(root: Phaser.GameObjects.Container, p: IntroPanel): (dt: number, t: number) => void {
    const layers = this.bg(root, 'day', -40, -78);
    const clouds = layers.clouds;
    this.sidewalk(root, 140);
    // Hot dog cart + pigeons.
    if (this.textures.exists('props')) {
      root.add(this.add.image(360, 160, 'props', 'hotdog_cart').setOrigin(0.5, 1).setScale(1));
      root.add(this.add.image(412, 160, 'props', 'lamp').setOrigin(0.5, 1));
      const pg = this.add.sprite(300, 162, 'props', 'pigeon_idle_0').setOrigin(0.5, 1).setFlipX(true);
      playAnim(pg, 'pigeon_idle');
      root.add(pg);
    }
    const xs = [150, 186, 222, 254, 300];
    const ids = ['dad', 'mom', 'parker', 'brennan', 'lupin'];
    ids.forEach((id, k) => {
      this.shadow(root, xs[k], 161, id === 'lupin' ? 22 : 16);
      const s = this.hero(root, id, xs[k], 162, 'idle', 1, id === 'lupin');
      if (id === 'lupin' && !reducedMotion()) {
        this.tweens.add({ targets: s, y: 159, duration: 180, yoyo: true, repeat: -1, repeatDelay: 900 });
      }
    });
    // Hot dogs in a few hands.
    if (this.textures.exists('items')) {
      for (const x of [xs[2] + 10, xs[3] + 10]) root.add(this.add.image(x, 145, 'items', 'hotdog').setScale(0.75));
    }
    if (p.speech) {
      const b = speechBubble(this, 212, 88, p.speech.text, { maxWidth: 110 });
      root.add(b);
      popIn(this, b, 500);
    }
    return (dt) => {
      if (clouds && !reducedMotion()) clouds.x = ((clouds.x - dt * 0.004 + 200) % 200) - 200;
    };
  }

  // 2. The L rumbles.
  private panelRumble(root: Phaser.GameObjects.Container, p: IntroPanel, cam: Phaser.Cameras.Scene2D.Camera): (dt: number, t: number) => void {
    this.bg(root, 'rooftop', -120, -40, ['sky', 'clouds', 'far']);
    const g = this.add.graphics();
    drawElTrack(g, -10, PW + 10, 92, 90);
    root.add(g);
    const train = this.add.container(PW + 20, 92);
    if (this.textures.exists('platforms')) {
      train.add(this.add.image(0, 0, 'platforms', 'train_front').setOrigin(0, 1));
      train.add(this.add.image(126, 0, 'platforms', 'train_car').setOrigin(0, 1));
      train.add(this.add.image(252, 0, 'platforms', 'train_car').setOrigin(0, 1));
    }
    root.add(train);
    const still = reducedMotion();
    this.tweens.add({ targets: train, x: 40, duration: 2600, ease: 'Cubic.out' });
    this.sfxText(root, 330, 40, 'RUMBLE', 0xffa63a, -8, 600);
    this.sfxText(root, 380, 62, 'RUMBLE!!', 0xff6a3a, 6, 1100);
    audio.sfx('train-horn');
    if (!still) this.time.delayedCall(700, () => this.current?.cam === cam && cam.shake(1800, 0.006));
    // Parker, close-up, bottom-left.
    const parker = this.hero(root, 'parker', 64, PH + 14, 'hurt', 2);
    parker.anims.pause();
    if (p.speech) {
      const b = speechBubble(this, 178, 124, p.speech.text, { maxWidth: 150 });
      root.add(b);
      popIn(this, b, 900);
    }
    let sparkT = 0;
    return (dt, t) => {
      if (!still) {
        train.y = 92 + (Math.sin(t / 45) > 0.6 ? -1 : 0);
        sparkT -= dt;
        if (sparkT <= 0) {
          sparkT = 160;
          this.effect(root, train.x + 20 + Math.random() * 340, 93, 'spark');
        }
      }
    };
  }

  private effect(root: Phaser.GameObjects.Container, x: number, y: number, anim: string): void {
    if (!this.anims.exists(`effects:${anim}`)) return;
    const s = this.add.sprite(x, y, 'effects');
    root.add(s);
    s.play(`effects:${anim}`);
    s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
  }

  // 3. The EL-iminator goes off the rails.
  private panelEliminator(root: Phaser.GameObjects.Container): (dt: number, t: number) => void {
    const g = this.add.graphics({ x: PW / 2, y: 110 });
    speedBurst(g, 0, 0, 340, 0x5a1020, 0x8a1e28, 30);
    root.add(g);
    const still = reducedMotion();
    if (!still) this.tweens.add({ targets: g, angle: 4, duration: 2400, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    // Broken track pieces.
    const tg = this.add.graphics();
    drawElTrack(tg, -10, 140, 150, 30);
    drawElTrack(tg, 330, PW + 10, 150, 30);
    root.add(tg);
    const boss = this.add.sprite(PW / 2 + 10, 168, 'eliminator').setOrigin(0.5, 1).setScale(1.25);
    playAnim(boss, 'attack', 'idle', false);
    root.add(boss);
    if (!still) this.tweens.add({ targets: boss, y: 164, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    // "OUT OF SERVICE" destination sign.
    const sign = this.add.container(360, 40);
    const sg = this.add.graphics();
    sg.fillStyle(0x777777, 1).fillRect(-50, -12, 100, 24);
    sg.fillStyle(0x111111, 1).fillRect(-48, -10, 96, 20);
    const st = px(this, 0, 0, 'OUT OF SERVICE', { outline: false, color: 0xff8a2a });
    sign.add([sg, st]).setAngle(-6);
    root.add(sign);
    popIn(this, sign, 300);
    if (!still) this.tweens.add({ targets: st, alpha: 0.25, duration: 380, yoyo: true, repeat: -1, delay: 600 });
    this.sfxText(root, 80, 46, 'KRZZZT!', COLORS.gold, -10, 200);
    audio.sfx('boss-roar');
    // Flying debris.
    if (!still && this.textures.exists('effects')) {
      for (let k = 0; k < 6; k++) {
        const d = this.add.image(PW / 2, 120, 'effects', `debris_${k % 2}`);
        root.add(d);
        const ang = -Math.PI / 2 + (k - 2.5) * 0.45;
        this.tweens.add({
          targets: d,
          x: PW / 2 + Math.cos(ang) * 220,
          y: 120 + Math.sin(ang) * 140 + 80,
          angle: 360,
          duration: 1400 + k * 120,
          ease: 'Quad.out',
          delay: k * 90,
          repeat: -1,
          repeatDelay: 600,
        });
      }
    }
    let sparkT = 0;
    return (dt) => {
      if (still) return;
      sparkT -= dt;
      if (sparkT <= 0) {
        sparkT = 220;
        this.effect(root, boss.x - 60 + Math.random() * 120, boss.y - 30 - Math.random() * 100, 'spark');
      }
    };
  }

  // 4. Drones, rats and pigeons go haywire.
  private panelHaywire(root: Phaser.GameObjects.Container): (dt: number, t: number) => void {
    this.bg(root, 'day', -300, -78);
    this.sidewalk(root, 140);
    const tint = this.add.rectangle(0, 0, PW, PH, 0xff3030, 0.12).setOrigin(0);
    root.add(tint);
    if (this.textures.exists('props')) {
      root.add(this.add.image(60, 160, 'props', 'trash_can_broken').setOrigin(0.5, 1));
      root.add(this.add.image(400, 160, 'props', 'cone').setOrigin(0.5, 1).setAngle(80));
    }
    if (this.textures.exists('platforms')) root.add(this.add.image(330, 168, 'platforms', 'taxi').setOrigin(0.5, 1).setAngle(-4));
    const still = reducedMotion();
    const movers: { s: Phaser.GameObjects.Sprite; fn: (t: number) => void }[] = [];
    const add = (key: string, anim: string, fn: (s: Phaser.GameObjects.Sprite, t: number) => void, artFacesLeft = false) => {
      const s = this.add.sprite(0, 0, key).setOrigin(0.5, 1);
      playAnim(s, anim);
      root.add(s);
      const m = { s, fn: (t: number) => fn(s, t) };
      movers.push(m);
      m.fn(0);
      void artFacesLeft;
      return s;
    };
    // Drones zig-zag across the sky.
    for (let k = 0; k < 3; k++) {
      add('securityDrone', 'move', (s, t) => {
        const ph = t / 900 + k * 2.1;
        s.setPosition(90 + k * 130 + Math.sin(ph) * 50, 54 + k * 12 + Math.sin(ph * 2.3) * 12);
        s.setFlipX(Math.cos(ph) > 0);
      });
    }
    // Rats scurry back and forth on the sidewalk.
    for (let k = 0; k < 3; k++) {
      add('rat', 'move', (s, t) => {
        const span = PW + 60;
        const v = (t / 18 + k * 160) % (span * 2);
        const fwd = v < span;
        s.setPosition(fwd ? v - 30 : span * 2 - v - 30, 166 + k * 4);
        s.setFlipX(!fwd);
      });
    }
    // Pigeons swoop in loops.
    for (let k = 0; k < 3; k++) {
      add('pigeon', 'move', (s, t) => {
        const ph = t / 700 + k * 2;
        s.setPosition(PW / 2 + Math.cos(ph) * (150 - k * 30), 96 + Math.sin(ph) * 30 - k * 10);
        s.setFlipX(Math.sin(ph) > 0);
      });
    }
    this.sfxText(root, 110, 26, 'BZZT!', COLORS.skyBlue, -8, 200);
    this.sfxText(root, 360, 36, 'SQUAWK!', 0xffffff, 8, 600);
    this.sfxText(root, 200, 120, 'SQUEAK!', COLORS.gold, -4, 1000, 1);
    let t0 = 0;
    return (dt) => {
      t0 += still ? dt * 0.35 : dt;
      for (const m of movers) m.fn(t0);
    };
  }

  // 5. Something watches from the sky.
  private panelPod(root: Phaser.GameObjects.Container): (dt: number, t: number) => void {
    this.bg(root, 'sunset', -200, -46, ['sky', 'clouds', 'far', 'mid']);
    const dim = this.add.rectangle(0, 0, PW, PH, 0x0b1730, 0.35).setOrigin(0);
    root.add(dim);
    // Stars.
    const sg = this.add.graphics();
    for (let k = 0; k < 40; k++) {
      sg.fillStyle(k % 5 ? 0x8fa6d8 : 0xffffff, 1).fillRect((k * 97) % PW, (k * 53) % 60, 1, 1);
    }
    root.add(sg);
    const beam = this.add.graphics();
    beam.setBlendMode(Phaser.BlendModes.ADD);
    root.add(beam);
    const pod = this.add.sprite(330, 92, 'overseer').setOrigin(0.5, 1).setScale(0.75);
    playAnim(pod, 'idle');
    root.add(pod);
    const still = reducedMotion();
    // The pod drifts slowly down out of the clouds.
    let podY = still ? 92 : 70;
    if (!still) this.tweens.add({ targets: { v: 70 }, v: 92, duration: 3000, ease: 'Sine.out', onUpdate: (tw) => (podY = tw.getValue() ?? 92) });
    const q = this.add.container(286, 40);
    q.add(px(this, 0, 0, '?', { scale: 2, color: 0xff5a7a }));
    root.add(q);
    popIn(this, q, 1200);
    return (_dt, t) => {
      const bob = still ? 0 : Math.sin(t / 600) * 3;
      pod.y = podY + bob;
      beam.clear();
      const a = still ? 0.22 : 0.16 + 0.08 * Math.sin(t / 180);
      const sweep = still ? 0 : Math.sin(t / 1300) * 30;
      beam.fillStyle(0xff3a6a, a).fillTriangle(pod.x - 4, pod.y - 4, pod.x + 4, pod.y - 4, pod.x + sweep + 26, PH);
      beam.fillTriangle(pod.x - 4, pod.y - 4, pod.x + 4, pod.y - 4, pod.x + sweep - 26, PH);
      beam.fillStyle(0xffd0e0, a * 0.8).fillTriangle(pod.x - 1, pod.y - 4, pod.x + 1, pod.y - 4, pod.x + sweep, PH);
    };
  }

  // 6. Let's save the Loop!
  private panelRally(root: Phaser.GameObjects.Container, p: IntroPanel): (dt: number, t: number) => void {
    const g = this.add.graphics({ x: PW / 2, y: 120 });
    speedBurst(g, 0, 0, 340, 0x6fb7e8, 0xb3ddf2, 32);
    root.add(g);
    const still = reducedMotion();
    if (!still) this.tweens.add({ targets: g, angle: 360 / 16, duration: 3000, repeat: -1 });
    const stars = this.add.graphics();
    for (const [x, y] of [[40, 40], [PW - 40, 40], [40, 140], [PW - 40, 140]] as const) drawChicagoStar(stars, x, y, 10);
    root.add(stars);
    const ids = ['mom', 'parker', 'dad', 'brennan', 'lupin'];
    ids.forEach((id, k) => {
      const x = 66 + k * 80;
      this.shadow(root, x, 172, 34);
      const s = this.hero(root, id, x, 174, 'victory', 2);
      if (!still) {
        s.y = PH + 120;
        this.tweens.add({ targets: s, y: 174, duration: 450, delay: 120 * k, ease: 'Back.out' });
      }
    });
    if (p.speech) {
      const b = speechBubble(this, PW / 2, 36, p.speech.text, { scale: 2, maxWidth: 400, shout: true });
      root.add(b);
      popIn(this, b, 700);
      this.time.delayedCall(700, () => audio.sfx('powerup'));
    }
    return () => {};
  }
}
