import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { LEVELS } from '../data/levels';
import { saveSystem } from '../systems/SaveSystem';
import { gameState } from '../state/GameState';
import { audio } from '../systems/AudioSystem';
import { playAnim } from '../systems/AnimationSystem';
import { px, setPx } from '../ui/PixelFont';
import { icon, setIcon } from '../ui/Icons';
import { onNav } from '../ui/NavInput';
import { COLORS, button, drawPanel, type UIButton } from '../ui/Widgets';
import { reducedMotion, transitionIn, transitionTo } from '../ui/Transitions';
import { formatTarget, formatTime } from '../ui/format';
import { pathBetween, pickDirectional } from '../ui/mapNav';
import { prompt, type PromptText } from '../ui/Prompts';
import { mulberry32 } from '../systems/audio/notes';
import { heroTexture } from '../ui/CharacterArt';
import { MEDALS, medalTimes } from '../systems/Rewards';

interface MapNode {
  kind: 'level' | 'hood';
  x: number;
  y: number;
  name: string;
  levelId?: string;
  world?: number;
  blurb?: string;
}

/** The Loop's elevated tracks form the World 1 path: up Wells, along Lake, down Wabash. */
const LEVEL_POS: [number, number][] = [[268, 168], [268, 112], [352, 112], [352, 168]];

const HOODS: MapNode[] = [
  { kind: 'hood', x: 330, y: 64, name: 'LINCOLN PARK', world: 2, blurb: 'The zoo animals are acting very strange...' },
  { kind: 'hood', x: 290, y: 26, name: 'WRIGLEYVILLE', world: 3, blurb: 'Something just landed on the scoreboard!' },
  { kind: 'hood', x: 430, y: 128, name: 'NAVY PIER', world: 4, blurb: 'The Ferris wheel is spinning backwards.' },
  { kind: 'hood', x: 398, y: 204, name: 'MUSEUM CAMPUS', world: 5, blurb: 'The dinosaur bones are on the move!' },
  { kind: 'hood', x: 296, y: 214, name: 'CHINATOWN', world: 6, blurb: 'Dragon-shaped UFOs spotted overhead.' },
  { kind: 'hood', x: 252, y: 250, name: 'THE SOUTH SIDE', world: 7, blurb: 'Rumours of an alien ground base...' },
  { kind: 'hood', x: 66, y: 92, name: "O'HARE", world: 8, blurb: 'The mothership is coming in to land!' },
];

const SHORE: [number, number][] = [[350, 0], [358, 40], [372, 80], [386, 104], [392, 130], [392, 172], [402, 204], [414, 240], [420, 270]];

export class WorldMapScene extends Phaser.Scene {
  private nodes: MapNode[] = [];
  private sel = 0;
  /** Level-node index the walker stands on. */
  private at = 0;
  private walking = false;
  private walker!: Phaser.GameObjects.Sprite;
  private ring!: Phaser.GameObjects.Graphics;
  private info!: {
    g: Phaser.GameObjects.Graphics;
    title: Phaser.GameObjects.BitmapText;
    name: Phaser.GameObjects.BitmapText;
    status: Phaser.GameObjects.BitmapText;
    best: Phaser.GameObjects.BitmapText;
    souv: Phaser.GameObjects.Image[];
    /** Best medal earned + the three target times. */
    medal: Phaser.GameObjects.Image;
    targets: { img: Phaser.GameObjects.Image; t: Phaser.GameObjects.BitmapText }[];
    play: UIButton;
    hint: PromptText;
  };

  constructor() {
    super('WorldMap');
  }

  create(): void {
    this.walking = false;
    const save = saveSystem.get();
    this.nodes = [
      ...LEVELS.map((l, i): MapNode => ({ kind: 'level', x: LEVEL_POS[i % 4][0], y: LEVEL_POS[i % 4][1], name: l.name.toUpperCase(), levelId: l.id })),
      ...HOODS,
    ];
    // Start on the furthest unlocked, not-yet-completed level (or the last remembered one).
    const remembered = this.registry.get('mapIndex') as number | undefined;
    const firstOpen = LEVELS.findIndex((l) => saveSystem.isUnlocked(l.id) && !save.levels[l.id]?.completed);
    const lastUnlocked = LEVELS.reduce((acc, l, i) => (saveSystem.isUnlocked(l.id) ? i : acc), 0);
    this.at = remembered !== undefined && remembered < LEVELS.length && saveSystem.isUnlocked(LEVELS[remembered].id) ? remembered : firstOpen >= 0 ? firstOpen : lastUnlocked;
    this.sel = this.at;

    this.drawMap();
    this.drawNodes();

    const start = this.nodes[this.at];
    this.walker = this.add.sprite(start.x, start.y + 3, heroTexture(this)).setOrigin(0.5, 1).setDepth(30);
    playAnim(this.walker, 'idle');

    this.ring = this.add.graphics().setDepth(25);
    this.buildInfo();

    // Header
    const hg = this.add.graphics().setDepth(40);
    drawPanel(hg, 4, 4, 150, 30);
    px(this, 12, 13, 'CHICAGO', { scale: 2, origin: [0, 0.5], color: COLORS.gold }).setDepth(41);
    px(this, 12, 27, save.worldsCompleted.includes(1) ? '★ THE LOOP IS SAVED!' : 'WORLD 1 · THE LOOP', { origin: [0, 0.5], color: COLORS.sub }).setDepth(41);
    button(this, GAME_WIDTH - 30, 14, 'MENU', () => this.leave('Menu'), { sound: 'menu-back', depth: 40 });
    button(this, GAME_WIDTH - 80, 14, 'HERO', () => this.leave('CharacterSelect', { next: 'WorldMap' }), { depth: 40 });

    onNav(this, (a) => {
      if (a === 'back') {
        audio.sfx('menu-back');
        this.leave('Menu');
      } else if (a === 'confirm' || a === 'start') this.confirm();
      else if (a === 'alt') this.leave('CharacterSelect', { next: 'WorldMap' });
      else this.moveTo(pickDirectional(this.nodes, this.sel, a));
    });
    this.input.keyboard?.on('keydown-C', () => this.leave('CharacterSelect', { next: 'WorldMap' }));

    this.refresh();
    audio.music('map');
    transitionIn(this);
  }

  // ------------------------------------------------------------------ drawing

  private drawMap(): void {
    // Always draw procedurally: node/neighbourhood positions are laid out for this drawing
    // (the 'world-map' image has its own labels and geography, which would double up).
    const g = this.add.graphics();
    // Land + street grid
    g.fillStyle(0x34503f, 1).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    g.fillStyle(0x2e4838, 1);
    for (let x = 0; x < GAME_WIDTH; x += 12) g.fillRect(x, 0, 1, GAME_HEIGHT);
    for (let y = 0; y < GAME_HEIGHT; y += 12) g.fillRect(0, y, GAME_WIDTH, 1);
    // Neighbourhood blocks (tiny rooftops)
    const rnd = mulberry32(42);
    for (let i = 0; i < 260; i++) {
      const bx = Math.floor(rnd() * 40) * 12 + 2;
      const by = Math.floor(rnd() * 23) * 12 + 2;
      g.fillStyle(rnd() < 0.5 ? 0x3d5c48 : 0x456a52, 1).fillRect(bx, by, 9, 9);
    }
    // Parks: Lincoln Park and Grant Park along the lake
    g.fillStyle(0x4f9a52, 1);
    g.fillPoints([new Phaser.Math.Vector2(330, 30), new Phaser.Math.Vector2(362, 30), new Phaser.Math.Vector2(376, 90), new Phaser.Math.Vector2(340, 92)], true);
    g.fillRect(356, 112, 34, 66);
    g.fillStyle(0x5fae5f, 1).fillRect(358, 114, 30, 2);
    // Expressways
    g.lineStyle(3, 0x7b8798, 1);
    g.strokePoints([new Phaser.Math.Vector2(262, 120), new Phaser.Math.Vector2(200, 112), new Phaser.Math.Vector2(140, 96), new Phaser.Math.Vector2(66, 92)]);
    g.strokePoints([new Phaser.Math.Vector2(262, 170), new Phaser.Math.Vector2(250, 220), new Phaser.Math.Vector2(226, 270)]);
    g.strokePoints([new Phaser.Math.Vector2(262, 140), new Phaser.Math.Vector2(150, 150), new Phaser.Math.Vector2(0, 156)]);
    g.lineStyle(1, 0xd8c45a, 0.7);
    g.strokePoints([new Phaser.Math.Vector2(262, 120), new Phaser.Math.Vector2(200, 112), new Phaser.Math.Vector2(140, 96), new Phaser.Math.Vector2(66, 92)]);
    // Lake Michigan
    const lake = [...SHORE.map(([x, y]) => new Phaser.Math.Vector2(x, y)), new Phaser.Math.Vector2(GAME_WIDTH, GAME_HEIGHT), new Phaser.Math.Vector2(GAME_WIDTH, 0)];
    g.fillStyle(0x1f5f9e, 1).fillPoints(lake, true);
    g.lineStyle(2, 0xd9c99a, 1).strokePoints(SHORE.map(([x, y]) => new Phaser.Math.Vector2(x, y)));
    // Chicago River: main stem + north and south branches
    g.lineStyle(3, 0x2f6fb0, 1);
    g.strokePoints([new Phaser.Math.Vector2(387, 104), new Phaser.Math.Vector2(300, 103), new Phaser.Math.Vector2(258, 104)]);
    g.strokePoints([new Phaser.Math.Vector2(258, 104), new Phaser.Math.Vector2(246, 70), new Phaser.Math.Vector2(222, 30), new Phaser.Math.Vector2(206, 0)]);
    g.strokePoints([new Phaser.Math.Vector2(258, 104), new Phaser.Math.Vector2(256, 182), new Phaser.Math.Vector2(236, 204), new Phaser.Math.Vector2(170, 236), new Phaser.Math.Vector2(110, 270)]);
    // Navy Pier + Ferris wheel
    g.fillStyle(0x9aa4b0, 1).fillRect(391, 117, 50, 5);
    g.lineStyle(1, 0x9aa4b0, 1).lineBetween(434, 117, 438, 106).lineBetween(442, 117, 438, 106);
    g.lineStyle(1, 0xe8414e, 0.7);
    for (let a = 0; a < 4; a++) {
      const ang = (a * Math.PI) / 4;
      g.lineBetween(438 - Math.cos(ang) * 8, 106 - Math.sin(ang) * 8, 438 + Math.cos(ang) * 8, 106 + Math.sin(ang) * 8);
    }
    g.lineStyle(2, 0xe8414e, 1).strokeCircle(438, 106, 8);
    for (let a = 0; a < 8; a++) g.fillStyle(0xffd25a, 1).fillRect(Math.round(437 + Math.cos((a * Math.PI) / 4) * 8), Math.round(105 + Math.sin((a * Math.PI) / 4) * 8), 2, 2);
    // The Loop: dense downtown blocks + the elevated track rectangle
    g.fillStyle(0x4a5a6a, 1).fillRect(262, 106, 96, 68);
    for (let x = 266; x < 352; x += 8) for (let y = 110; y < 170; y += 8) g.fillStyle((x + y) % 16 ? 0x6b7b8c : 0x5c6b7c, 1).fillRect(x, y, 6, 6);
    g.lineStyle(4, 0x2b2846, 1).strokeRect(LEVEL_POS[0][0], LEVEL_POS[1][1], LEVEL_POS[2][0] - LEVEL_POS[0][0], LEVEL_POS[0][1] - LEVEL_POS[1][1]);
    g.lineStyle(1, 0x8b8fa8, 1).strokeRect(LEVEL_POS[0][0], LEVEL_POS[1][1], LEVEL_POS[2][0] - LEVEL_POS[0][0], LEVEL_POS[0][1] - LEVEL_POS[1][1]);
    px(this, 310, 140, 'THE LOOP', { color: COLORS.text });
    // Lake shimmer
    if (!reducedMotion()) {
      const r2 = mulberry32(5);
      for (let i = 0; i < 16; i++) {
        const sx = 400 + Math.floor(r2() * 76);
        const sy = 10 + Math.floor(r2() * 250);
        const s = this.add.rectangle(sx, sy, 4, 1, 0x8fc3f0).setOrigin(0).setAlpha(0);
        this.tweens.add({ targets: s, alpha: 0.9, duration: 900, yoyo: true, repeat: -1, delay: Math.floor(r2() * 2000), repeatDelay: 600 });
      }
    }
  }

  private nodeGfx: Phaser.GameObjects.Graphics[] = [];

  private drawNodes(): void {
    const save = saveSystem.get();
    const g = this.add.graphics().setDepth(5);
    // Dashed routes from the Loop to the locked neighbourhoods
    const hub = { x: 310, y: 140 };
    for (const n of HOODS) {
      const dx = n.x - hub.x;
      const dy = n.y - hub.y;
      const len = Math.hypot(dx, dy);
      for (let d = 34; d < len - 8; d += 6) {
        g.fillStyle(0xe8e0c8, 0.55).fillRect(Math.round(hub.x + (dx * d) / len), Math.round(hub.y + (dy * d) / len), 2, 2);
      }
    }
    this.nodeGfx = [];
    this.nodes.forEach((n, i) => {
      const ng = this.add.graphics().setDepth(10);
      this.nodeGfx.push(ng);
      if (n.kind === 'level') {
        const unlocked = saveSystem.isUnlocked(n.levelId!);
        const done = !!save.levels[n.levelId!]?.completed;
        ng.fillStyle(COLORS.ink, 1).fillCircle(n.x, n.y, 7);
        ng.fillStyle(!unlocked ? 0x6d7686 : done ? COLORS.green : COLORS.red, 1).fillCircle(n.x, n.y, 6);
        ng.fillStyle(0xffffff, 0.35).fillCircle(n.x - 2, n.y - 2, 2);
        if (done) px(this, n.x, n.y, '✓', { color: 0xffffff }).setDepth(11);
        else if (!unlocked) icon(this, n.x, n.y, 'lock').setDepth(11).setScale(0.75);
        const lvl = LEVELS[i];
        const left = n.x < 300;
        px(this, n.x + (left ? -12 : 12), n.y, lvl.number, { origin: [left ? 1 : 0, 0.5], color: COLORS.text }).setDepth(11);
        if (lvl.boss) px(this, n.x + 12, n.y + 10, 'BOSS', { origin: [0, 0.5], color: COLORS.red }).setDepth(11);
      } else {
        ng.fillStyle(COLORS.ink, 1).fillCircle(n.x, n.y, 8);
        ng.fillStyle(0x4b4466, 1).fillCircle(n.x, n.y, 7);
        if (n.world === 8) icon(this, n.x, n.y, 'plane').setDepth(11);
        else icon(this, n.x, n.y, 'lock').setDepth(11);
        const below = n.y < 230;
        px(this, n.x, n.y + (below ? 13 : -13), n.name, { color: 0xd0d6e6 }).setDepth(11);
      }
      const z = this.add.zone(n.x, n.y, 24, 24).setInteractive({ useHandCursor: true }).setDepth(50);
      z.on('pointerup', () => {
        if (this.sel === i) this.confirm();
        else this.moveTo(i);
      });
    });
  }

  private buildInfo(): void {
    const x = 6;
    const y = 166;
    const g = this.add.graphics().setDepth(40);
    drawPanel(g, x, y, 186, 98);
    const d = 41;
    const title = px(this, x + 10, y + 12, '', { origin: [0, 0.5], color: COLORS.gold }).setDepth(d);
    const name = px(this, x + 10, y + 26, '', { origin: [0, 0], color: COLORS.text, maxWidth: 168 }).setDepth(d);
    const status = px(this, x + 10, y + 52, '', { origin: [0, 0.5], color: COLORS.sub, maxWidth: 168 }).setDepth(d);
    const best = px(this, x + 10, y + 64, '', { origin: [0, 0.5], color: COLORS.sub }).setDepth(d);
    const medal = icon(this, x + 170, y + 63, 'medal_empty').setDepth(d);
    const targets = MEDALS.map((m, i) => ({
      img: icon(this, x + 14 + i * 38, y + 75, `medal_${m}`).setDepth(d).setScale(0.75),
      t: px(this, x + 21 + i * 38, y + 75, '', { origin: [0, 0.5], color: COLORS.dim }).setDepth(d),
    }));
    const souv = [0, 1, 2].map((i) => icon(this, x + 124 + i * 16, y + 12, 'souvenir_icon_empty').setDepth(d));
    const play = button(this, x + 150, y + 84, '▶ PLAY', () => this.confirm(), { sound: null, depth: d, w: 56 });
    const hint = prompt(this, x + 10, y + 84, (dev) => (dev === 'touch' ? 'TAP AGAIN: PLAY' : '{CONFIRM} PLAY {HERO} HERO'), {
      origin: [0, 0.5],
      color: COLORS.sub,
      depth: d,
    });
    this.info = { g, title, name, status, best, souv, medal, targets, play, hint };
  }

  private refresh(): void {
    const n = this.nodes[this.sel];
    const save = saveSystem.get();
    const { title, name, status, best, souv, medal, targets, play, hint } = this.info;
    hint.setVisible(n.kind === 'level' && saveSystem.isUnlocked(n.levelId!));
    if (n.kind === 'level') {
      const lvl = LEVELS[this.sel];
      const rec = save.levels[lvl.id];
      const unlocked = saveSystem.isUnlocked(lvl.id);
      setPx(title, `WORLD 1-${lvl.number.split('-')[1]}${lvl.boss ? ' · BOSS' : ''}`);
      setPx(name, n.name);
      setPx(status, !unlocked ? `LOCKED - CLEAR ${LEVELS[this.sel - 1]?.number ?? ''} FIRST` : rec?.completed ? '✓ CLEARED' : 'NEW ADVENTURE!');
      status.setTint(!unlocked ? COLORS.dim : rec?.completed ? COLORS.green : COLORS.gold);
      setPx(best, rec?.bestTimeMs ? `BEST TIME ${formatTime(rec.bestTimeMs)}` : 'BEST TIME --:--.--');
      setIcon(medal.setVisible(true), rec?.medal ? `medal_${rec.medal}` : 'medal_empty');
      const mt = medalTimes(lvl.id);
      targets.forEach(({ img, t }, i) => {
        img.setVisible(!!mt);
        t.setVisible(!!mt);
        if (mt) setPx(t, formatTarget(mt[MEDALS[i]]));
      });
      souv.forEach((img, i) => setIcon(img.setVisible(true), rec?.souvenirs.includes(i) ? 'souvenir_icon' : 'souvenir_icon_empty'));
      play.setEnabled(unlocked);
      play.container.setVisible(true);
    } else {
      setPx(title, `WORLD ${n.world} · COMING SOON`);
      title.setTint(COLORS.gold);
      setPx(name, n.name);
      setPx(status, n.blurb ?? '');
      status.setTint(COLORS.sub);
      setPx(best, '');
      souv.forEach((img) => img.setVisible(false));
      medal.setVisible(false);
      targets.forEach(({ img, t }) => {
        img.setVisible(false);
        t.setVisible(false);
      });
      play.container.setVisible(false);
    }
    // Selection ring
    this.ring.clear();
    this.ring.lineStyle(2, COLORS.gold, 1).strokeCircle(n.x, n.y, n.kind === 'level' ? 10 : 11);
    if (!reducedMotion()) {
      this.tweens.killTweensOf(this.ring);
      this.ring.setAlpha(1);
      this.tweens.add({ targets: this.ring, alpha: 0.35, duration: 450, yoyo: true, repeat: -1 });
    }
  }

  // ------------------------------------------------------------------ interaction

  private moveTo(i: number): void {
    if (this.walking || i === this.sel) return;
    this.sel = i;
    audio.sfx('menu-move');
    this.refresh();
    const n = this.nodes[i];
    if (n.kind !== 'level' || !saveSystem.isUnlocked(n.levelId!)) return;
    // Walk along the Loop track through each intermediate level node.
    const path = pathBetween(this.at, i);
    if (!path.every((k) => saveSystem.isUnlocked(LEVELS[k].id))) return;
    this.walking = true;
    playAnim(this.walker, 'walk');
    const stepNext = () => {
      const k = path.shift();
      if (k === undefined) {
        this.walking = false;
        playAnim(this.walker, 'idle');
        return;
      }
      const t = this.nodes[k];
      this.walker.setFlipX(t.x < this.walker.x);
      const dist = Phaser.Math.Distance.Between(this.walker.x, this.walker.y, t.x, t.y + 3);
      this.tweens.add({
        targets: this.walker, x: t.x, y: t.y + 3, duration: reducedMotion() ? 1 : (dist / 110) * 1000,
        onComplete: () => {
          this.at = k;
          this.registry.set('mapIndex', k);
          stepNext();
        },
      });
    };
    stepNext();
  }

  private confirm(): void {
    if (this.walking) return;
    const n = this.nodes[this.sel];
    if (n.kind !== 'level' || !saveSystem.isUnlocked(n.levelId!)) {
      audio.sfx('menu-error');
      if (!reducedMotion()) this.cameras.main.shake(120, 0.004);
      return;
    }
    if (this.at !== this.sel) return;
    audio.sfx('confirm');
    playAnim(this.walker, 'jump', 'idle', false);
    if (!reducedMotion()) this.tweens.add({ targets: this.walker, y: this.walker.y - 12, duration: 160, yoyo: true });
    this.registry.set('mapIndex', this.sel);
    gameState.resetLives();
    this.time.delayedCall(350, () => transitionTo(this, 'Level', { levelId: n.levelId }));
  }

  private leave(key: string, data?: object): void {
    transitionTo(this, key, data);
  }
}
