import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { CHARACTER_IDS, type CharacterId } from '../types';
import { CHARACTERS } from '../characters';
import { gameState } from '../state/GameState';
import { playAnim } from '../systems/AnimationSystem';
import { audio } from '../systems/AudioSystem';
import { saveSystem } from '../systems/SaveSystem';
import {
  CLASSIC,
  COSTUMES,
  characterHint,
  characterKey,
  costumeHint,
  costumeKey,
  isCharacterUnlocked,
  isCostumeUnlocked,
  selectedCostume,
} from '../systems/Rewards';
import { px, setPx } from '../ui/PixelFont';
import { onNav } from '../ui/NavInput';
import { Skyline } from '../ui/Skyline';
import { icon } from '../ui/Icons';
import { COLORS, button, drawPanel, lighten, panel, setRatingBar } from '../ui/Widgets';
import { reducedMotion, transitionIn, transitionTo } from '../ui/Transitions';
import { prompt } from '../ui/Prompts';
import { heroTexture } from '../ui/CharacterArt';
import { UnlockScene } from './UnlockScene';
import { reduceFlashing, shakeAllowed } from '../systems/Accessibility';

const SLOT_SPACING = 56;
const SLOT_Y = 222;
/** Costume chips (inside the info panel, bottom right). */
const CHIP_X = 337;
const CHIP_Y = 124;
const CHIP_W = 30;
const CHIP_H = 46;
/** Silhouette colour of anything still locked. */
const SILHOUETTE = 0x1c1430;

const slotX = (i: number) => Math.round(GAME_WIDTH / 2 + (i - (CHARACTER_IDS.length - 1) / 2) * SLOT_SPACING);

/** Costume ids of a character, classic first. */
const outfits = (id: CharacterId) => [CLASSIC, ...COSTUMES[id].map((c) => c.id)];

export class CharacterSelectScene extends Phaser.Scene {
  private index = 0;
  /** Highlighted outfit index per character (0 = classic). */
  private outfit: Record<string, number> = {};
  private next = 'WorldMap';
  private confirmed = false;
  private sky!: Skyline;
  private preview!: Phaser.GameObjects.Sprite;
  private previewQ!: Phaser.GameObjects.BitmapText;
  private previewTimer?: Phaser.Time.TimerEvent;
  private slots: { g: Phaser.GameObjects.Graphics; sprite: Phaser.GameObjects.Sprite; q: Phaser.GameObjects.BitmapText; badge: Phaser.GameObjects.BitmapText }[] = [];
  private chips: {
    g: Phaser.GameObjects.Graphics;
    sprite: Phaser.GameObjects.Sprite;
    lock: Phaser.GameObjects.Image;
    badge: Phaser.GameObjects.BitmapText;
  }[] = [];
  private marker!: Phaser.GameObjects.BitmapText;
  private info!: {
    name: Phaser.GameObjects.BitmapText;
    abilityLabel: Phaser.GameObjects.BitmapText;
    ability: Phaser.GameObjects.BitmapText;
    desc: Phaser.GameObjects.BitmapText;
    bars: Phaser.GameObjects.Graphics;
    barLabels: Phaser.GameObjects.BitmapText[];
    cd: Phaser.GameObjects.BitmapText;
    outfit: Phaser.GameObjects.BitmapText;
  };

  constructor() {
    super('CharacterSelect');
  }

  init(data: { next?: string }): void {
    this.next = data.next ?? 'WorldMap';
    this.index = Math.max(0, CHARACTER_IDS.indexOf(gameState.character));
    this.confirmed = false;
    this.slots = [];
    this.chips = [];
    const save = saveSystem.get();
    this.outfit = {};
    for (const id of CHARACTER_IDS) this.outfit[id] = Math.max(0, outfits(id).indexOf(selectedCostume(save, id)));
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
    this.previewQ = px(this, 90, 110, '?', { scale: 4, color: COLORS.gold }).setVisible(false);

    // Info panel
    panel(this, 172, 30, 294, 156);
    const name = px(this, 186, 46, '', { scale: 2, origin: [0, 0.5] });
    const abilityLabel = px(this, 186, 66, 'SPECIAL ABILITY', { origin: [0, 0.5], color: COLORS.dim });
    const ability = px(this, 186, 78, '', { origin: [0, 0.5], color: COLORS.gold });
    const desc = px(this, 186, 90, '', { origin: [0, 0], color: COLORS.sub, maxWidth: 266 });
    const barLabels = ['SPEED', 'JUMP', 'ABILITY'].map((l, i) => px(this, 186, 134 + i * 12, l, { origin: [0, 0.5] }));
    const bars = this.add.graphics();
    const cd = px(this, 186, 172, '', { origin: [0, 0.5], color: COLORS.dim });
    const outfit = px(this, CHIP_X + (CHIP_W * 4 + 3) / 2, CHIP_Y + CHIP_H + 7, '', { color: COLORS.sub });
    this.info = { name, abilityLabel, ability, desc, bars, barLabels, cd, outfit };

    // Costume chips (classic + 3 outfits)
    for (let k = 0; k < 4; k++) {
      const x = CHIP_X + k * (CHIP_W + 1);
      const g = this.add.graphics();
      const sprite = this.add.sprite(x + CHIP_W / 2, CHIP_Y + CHIP_H - 2, CHARACTER_IDS[0]).setOrigin(0.5, 1);
      // keep tall hats inside the chip
      sprite.setCrop(0, 48 - (CHIP_H - 3), 48, CHIP_H - 3);
      const lock = icon(this, x + CHIP_W - 6, CHIP_Y + 8, 'lock').setScale(0.75);
      const badge = px(this, x + CHIP_W / 2, CHIP_Y + 4, 'NEW', { color: COLORS.red }).setDepth(3);
      const zone = this.add.zone(x + CHIP_W / 2, CHIP_Y + CHIP_H / 2, CHIP_W, CHIP_H).setInteractive({ useHandCursor: true });
      zone.on('pointerup', () => {
        if (!this.confirmed) this.selectOutfit(k);
      });
      this.chips.push({ g, sprite, lock, badge });
    }

    // Roster
    CHARACTER_IDS.forEach((id, i) => {
      const x = slotX(i);
      const g = this.add.graphics();
      const sprite = this.add.sprite(x, SLOT_Y + 24, id).setOrigin(0.5, 1);
      playAnim(sprite, 'idle');
      const q = px(this, x, SLOT_Y - 2, '?', { scale: 2, color: COLORS.gold }).setVisible(false);
      const badge = px(this, x + 14, SLOT_Y - 21, 'NEW', { color: COLORS.red }).setVisible(false).setDepth(3);
      const zone = this.add.zone(x, SLOT_Y, 50, 56).setInteractive({ useHandCursor: true });
      zone.on('pointerup', () => {
        if (this.confirmed) return;
        if (this.index === i) this.confirm();
        else this.select(i);
      });
      this.slots.push({ g, sprite, q, badge });
    });
    this.marker = px(this, 0, SLOT_Y - 33, '▼', { color: COLORS.gold }).setDepth(5);
    if (!reducedMotion()) this.tweens.add({ targets: this.marker, y: SLOT_Y - 31, duration: 350, yoyo: true, repeat: -1 });

    button(this, 38, SLOT_Y, 'BACK', () => this.back(), { sound: 'menu-back', w: 50 });
    button(this, GAME_WIDTH - 38, SLOT_Y, 'GO!', () => this.confirm(), { sound: null, w: 50, color: COLORS.gold });

    prompt(
      this,
      GAME_WIDTH / 2,
      GAME_HEIGHT - 10,
      (d) => (d === 'touch' ? 'TAP A HERO / OUTFIT · TAP AGAIN OR GO! TO START' : '{CHOOSE} HERO  {NAV} OUTFIT  {CONFIRM} CONFIRM  {BACK} BACK'),
      { color: COLORS.sub },
    );

    onNav(this, (a) => {
      if (this.confirmed) return;
      if (a === 'left') this.select(this.index - 1);
      else if (a === 'right') this.select(this.index + 1);
      else if (a === 'up') this.selectOutfit(this.outfit[this.id] - 1);
      else if (a === 'down') this.selectOutfit(this.outfit[this.id] + 1);
      else if (a === 'confirm' || a === 'start') this.confirm();
      else if (a === 'back') {
        audio.sfx('menu-back');
        this.back();
      }
    });

    this.select(this.index, true);
    if (!audio.musicKey) audio.music('title');
    transitionIn(this);
    // A secret hero unlocked since the last visit gets a celebration here too.
    const pending = saveSystem.get().newUnlocks.filter((k) => k.startsWith('char:'));
    if (pending.length) {
      this.time.delayedCall(450, () => {
        if (!this.sys.isActive()) return;
        saveSystem.markSeen(pending);
        UnlockScene.show(this, pending);
        this.refreshBadges();
      });
    }
  }

  private get id(): CharacterId {
    return CHARACTER_IDS[this.index];
  }

  private back(): void {
    transitionTo(this, 'Menu');
  }

  private unlocked(id: CharacterId = this.id): boolean {
    return isCharacterUnlocked(saveSystem.get(), id);
  }

  private select(i: number, silent = false): void {
    const n = CHARACTER_IDS.length;
    this.index = (i + n) % n;
    if (!silent) audio.sfx('menu-move');
    const id = this.id;
    const def = CHARACTERS[id];
    const open = this.unlocked(id);
    this.slots.forEach((s, j) => {
      const x = slotX(j);
      const sel = j === this.index;
      const cid = CHARACTER_IDS[j];
      const ok = this.unlocked(cid);
      s.g.clear();
      drawPanel(s.g, x - 25, SLOT_Y - 26, 50, 54, {
        fill: sel ? lighten(ok ? CHARACTERS[cid].color : 0x2a2440, 0.15) : COLORS.panel,
        border: sel ? COLORS.gold : COLORS.border,
        alpha: sel ? 0.95 : 0.85,
      });
      s.sprite.setTexture(ok ? heroTexture(this, cid) : cid);
      s.sprite.setAlpha(sel ? 1 : 0.6);
      if (ok) s.sprite.clearTint();
      else s.sprite.setTintFill(SILHOUETTE);
      s.q.setVisible(!ok);
      playAnim(s.sprite, sel && ok ? 'walk' : 'idle');
    });
    this.marker.setX(slotX(this.index));

    const { name, abilityLabel, ability, desc, bars, barLabels, cd } = this.info;
    bars.clear();
    if (open) {
      setPx(name, def.name.toUpperCase()).setTint(lighten(def.color, 0.35));
      setPx(abilityLabel, 'SPECIAL ABILITY');
      setPx(ability, def.abilityName.toUpperCase());
      setPx(desc, def.abilityDescription);
      const rows = [def.ratings.speed, def.ratings.jump, def.ratings.ability];
      rows.forEach((v, r) => setRatingBar(bars, 248, 131 + r * 12, v, 5, [COLORS.green, 0x4aa3ff, COLORS.gold][r], r === 0));
      setPx(cd, def.abilityCooldownMs > 0 ? `COOLDOWN ${(def.abilityCooldownMs / 1000).toFixed(2).replace(/0$/, '')}S` : 'NO COOLDOWN');
      saveSystem.markSeen([characterKey(id)]);
    } else {
      setPx(name, '???').setTint(COLORS.dim);
      setPx(abilityLabel, 'SECRET HERO');
      setPx(ability, 'LOCKED');
      setPx(desc, `${characterHint(id)} TO UNLOCK THIS HERO!`);
      setPx(cd, '');
    }
    barLabels.forEach((t) => t.setVisible(open));
    this.chips.forEach((c) => c.g.setVisible(open));
    this.selectOutfit(this.outfit[id], true);
  }

  /** Move the outfit cursor; unlocked outfits are worn (saved) immediately. */
  private selectOutfit(k: number, silent = false): void {
    const id = this.id;
    const list = outfits(id);
    const n = list.length;
    k = (k + n) % n;
    if (!silent && k !== this.outfit[id]) audio.sfx('menu-move');
    this.outfit[id] = k;
    const save = saveSystem.get();
    const open = this.unlocked(id);
    const costume = list[k];
    const wearable = open && isCostumeUnlocked(save, id, costume);
    if (wearable && (save.costumes[id] ?? CLASSIC) !== costume) {
      saveSystem.update((d) => {
        d.costumes[id] = costume;
      });
    }
    if (open) {
      saveSystem.markSeen([costumeKey(id, costume)]);
      // the roster slot wears what the hero will wear
      const slot = this.slots[this.index].sprite;
      const worn = heroTexture(this, id);
      if (slot.texture.key !== worn) {
        slot.setTexture(worn);
        playAnim(slot, 'walk');
      }
    }

    this.chips.forEach((c, j) => {
      const x = CHIP_X + j * (CHIP_W + 1);
      const cos = list[j];
      const ok = isCostumeUnlocked(save, id, cos);
      const sel = j === k;
      c.g.clear();
      drawPanel(c.g, x, CHIP_Y, CHIP_W, CHIP_H, {
        fill: sel ? lighten(CHARACTERS[id].color, 0.1) : COLORS.panel,
        border: sel ? COLORS.gold : COLORS.border,
        alpha: sel ? 0.95 : 0.8,
      });
      c.sprite.setVisible(open).setTexture(heroTexture(this, id, cos));
      c.sprite.setFrame('idle_0');
      if (ok) c.sprite.clearTint().setAlpha(1);
      else c.sprite.setTintFill(SILHOUETTE).setAlpha(0.85);
      c.lock.setVisible(open && !ok);
    });
    this.refreshBadges();

    const { outfit } = this.info;
    if (!open) setPx(outfit, '').setTint(COLORS.sub);
    else if (costume === CLASSIC) setPx(outfit, 'CLASSIC').setTint(COLORS.sub);
    else if (wearable) setPx(outfit, COSTUMES[id][k - 1].name).setTint(COLORS.gold);
    else setPx(outfit, costumeHint(id, costume)).setTint(COLORS.red);

    // Big preview: the highlighted outfit (silhouette if locked).
    this.preview.setTexture(open ? heroTexture(this, id, costume) : id).setScale(2).setY(172);
    if (open && wearable) this.preview.clearTint();
    else this.preview.setTintFill(SILHOUETTE);
    this.previewQ.setVisible(!open);
    this.startPreviewCycle(open);
  }

  private refreshBadges(): void {
    const fresh = new Set(saveSystem.get().newUnlocks);
    this.slots.forEach((s, j) => {
      const cid = CHARACTER_IDS[j];
      s.badge.setVisible(fresh.has(characterKey(cid)) || COSTUMES[cid].some((c) => fresh.has(costumeKey(cid, c.id))));
    });
    const id = this.id;
    const list = outfits(id);
    this.chips.forEach((c, j) => c.badge.setVisible(this.unlocked(id) && j > 0 && fresh.has(costumeKey(id, list[j]))));
  }

  /** Preview loops: run → victory → idle (locked heroes just stand). */
  private startPreviewCycle(animate = true): void {
    this.previewTimer?.remove();
    const p = this.preview;
    if (!animate) {
      playAnim(p, 'idle', 'idle', false);
      return;
    }
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
    if (!this.unlocked()) {
      audio.sfx('menu-error');
      if (shakeAllowed()) this.cameras.main.shake(120, 0.004);
      return;
    }
    this.confirmed = true;
    this.previewTimer?.remove();
    // Confirming on a locked outfit keeps the hero in the last outfit they can wear.
    const id = this.id;
    const worn = selectedCostume(saveSystem.get(), id);
    const p = this.preview;
    p.setTexture(heroTexture(this, id, worn)).clearTint();
    gameState.selectCharacter(id);
    audio.sfx('confirm');
    playAnim(p, 'jump', 'idle', false);
    if (!reducedMotion()) {
      if (!reduceFlashing()) this.cameras.main.flash(180, 255, 255, 255);
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
