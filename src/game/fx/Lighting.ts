import Phaser from 'phaser';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH, TILE_SIZE } from '../config';
import { LAYERS, TILE } from '../data/tiles';
import type { LevelContext } from '../world/LevelContext';
import { FX_SOFT, moodTexture } from './FxTextures';
import { fxRng, type ThemeMood } from './fxMath';

/** Lamp prop (props atlas `lamp`, 16×48, bottom-centre origin): bulb centre offset. */
const LAMP_BULB_DY = -40;

interface Flicker {
  objs: Phaser.GameObjects.Image[];
  base: number[];
  phase: number;
  /** Ms until the next flicker burst. */
  next: number;
  /** Remaining flicker burst (ms). */
  burst: number;
}

interface DarkRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Per-theme mood lighting:
 * - screen-space vignette (all themes, subtle by day) and a warm MULTIPLY colour grade at sunset;
 * - additive glows on lamp props at sunset (lit windows are baked into the facade tiles / backgrounds);
 * - Lower Wacker `darkZone`s: a darker MULTIPLY ambience with ceiling lamps casting additive
 *   light cones and floor pools under the level's own LW_LAMP tiles (generated fixtures only if the
 *   art has none), gentle flicker unless reduced motion.
 * Everything is static sprites + blend modes (a handful of quads), no render textures or shaders.
 */
export class Lighting {
  readonly darkZones: DarkRect[] = [];
  private readonly flickers: Flicker[] = [];
  private readonly rng = fxRng(0x51a7);
  private screenObjs: Phaser.GameObjects.Image[] = [];

  constructor(
    private readonly ctx: LevelContext,
    private readonly mood: ThemeMood,
    private readonly high: boolean,
    private readonly reducedMotion: boolean,
  ) {
    const objects = ctx.map.getObjectLayer(LAYERS.entities)?.objects ?? [];
    for (const o of objects) {
      const type = o.type || (o as { class?: string }).class || o.name;
      if (type === 'darkZone') {
        this.darkZones.push({ x: o.x ?? 0, y: o.y ?? 0, w: o.width ?? 0, h: o.height ?? 0 });
      }
    }
    for (const z of this.darkZones) this.buildDarkZone(z);
    if (mood.lampGlow > 0) {
      for (const o of objects) {
        const type = o.type || (o as { class?: string }).class || o.name;
        if (type !== 'prop') continue;
        const frame = (o.properties as { name: string; value: unknown }[] | undefined)?.find((p) => p.name === 'frame')?.value;
        if (frame !== 'lamp') continue;
        // Spawn objects are normalised to bottom-centre (see LevelScene.readObjects).
        const x = (o.x ?? 0) + (o.width ?? 0) / 2;
        const y = (o.y ?? 0) + (o.height ?? 0);
        if (this.inDarkZone(x, y - 8)) continue;
        this.lampGlow(x, y, mood.lampGlow);
      }
    }
    if (high) this.buildScreen();
  }

  inDarkZone(x: number, y: number): boolean {
    for (const z of this.darkZones) if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return true;
    return false;
  }

  /** 0..1: how deep inside a dark zone (fades over 40 px at the ends). */
  darkness(x: number, y: number): number {
    for (const z of this.darkZones) {
      if (y < z.y - 8 || y > z.y + z.h + 8 || x < z.x || x > z.x + z.w) continue;
      return Math.min(1, Math.min(x - z.x, z.x + z.w - x) / 40);
    }
    return 0;
  }

  /** Screen-space grade + vignette: one opaque MULTIPLY quad (HUD is a separate scene, unaffected). */
  private buildScreen(): void {
    const m = this.mood;
    if (!m.grade && m.vignette <= 0) return;
    const scene = this.ctx.scene;
    const key = moodTexture(scene, `fx-mood-${this.ctx.level.theme}`, GAME_WIDTH, GAME_HEIGHT, m.grade, m.vignette, m.vignetteColor);
    const img = scene.add
      .image(0, 0, key)
      .setOrigin(0)
      .setScrollFactor(0)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setDepth(DEPTH.foreground + 3);
    this.screenObjs.push(img);
  }

  private lampGlow(x: number, y: number, k: number): void {
    const scene = this.ctx.scene;
    const by = y + LAMP_BULB_DY;
    const halo = scene.add
      .image(x, by, FX_SOFT, 'glow')
      .setScale(1.6)
      .setTint(0xffc46a)
      .setAlpha(0.55 * k)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH.props);
    const core = scene.add
      .image(x, by, FX_SOFT, 'glow')
      .setScale(0.5)
      .setTint(0xfff0c0)
      .setAlpha(0.8 * k)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH.props);
    // Light pool on the pavement.
    const pool = scene.add
      .image(x, y - 1, FX_SOFT, 'pool')
      .setScale(1.3, 1)
      .setTint(0xffb860)
      .setAlpha(0.45 * k)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH.ground + 0.5);
    if (this.high) {
      const cone = scene.add
        .image(x, by + 2, FX_SOFT, 'cone')
        .setOrigin(0.5, 0)
        .setDisplaySize(40, Math.max(8, y - by - 2))
        .setTint(0xffc070)
        .setAlpha(0.22 * k)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(DEPTH.props);
      void cone;
    }
    void halo;
    void core;
    void pool;
  }

  private buildDarkZone(z: DarkRect): void {
    const scene = this.ctx.scene;
    const depth = DEPTH.effects - 1;
    const shade = 0x6c78a6;
    // Darkness (MULTIPLY) over the scenery but under pickups / enemies / the hero so actors stay
    // readable; the lamp light (ADD, above the actors) still falls on them. Soft 40-px ends.
    const ramp = 40;
    const mk = (x: number, w: number, frame: string, flip: boolean) =>
      scene.add
        .image(x, z.y, FX_SOFT, frame)
        .setOrigin(0, 0)
        .setDisplaySize(w, z.h)
        .setFlipX(flip)
        .setTint(shade)
        .setBlendMode(Phaser.BlendModes.MULTIPLY)
        .setDepth(DEPTH.pickups - 0.5);
    mk(z.x + ramp, Math.max(0, z.w - ramp * 2), 'white', false);
    mk(z.x, ramp, 'hramp', false);
    mk(z.x + z.w - ramp, ramp, 'hramp', true);

    // Ceiling: the first solid tile row above the zone's middle.
    const midTx = Math.floor((z.x + z.w / 2) / TILE_SIZE);
    let ceiling = z.y;
    const data = this.ctx.ground.layer.data;
    for (let ty = Math.floor((z.y + z.h - 1) / TILE_SIZE); ty >= 0; ty--) {
      const t = data[ty]?.[midTx];
      if (t && t.index > 0) {
        ceiling = (ty + 1) * TILE_SIZE;
        break;
      }
    }
    const floor = z.y + z.h;
    // Prefer the level art's own sodium lamps (LW_LAMP tiles): light *them*, don't add fixtures.
    const lamps = this.lampTiles(z);
    const generated = lamps.length === 0;
    if (generated) {
      const spacing = 112;
      const n = Math.max(1, Math.floor((z.w - 48) / spacing) + 1);
      const start = z.x + (z.w - (n - 1) * spacing) / 2;
      for (let i = 0; i < n; i++) lamps.push({ x: Math.round(start + i * spacing), y: ceiling + 3 });
    }
    lamps.forEach(({ x, y }, i) => {
      if (generated) {
        const g = scene.add.graphics().setDepth(depth + 0.2);
        // Sodium fixture: dark housing, bright strip.
        g.fillStyle(0x1c1f2c, 1).fillRect(x - 5, y - 3, 10, 3);
        g.fillStyle(0xffe2a0, 1).fillRect(x - 4, y, 8, 1);
      }
      const h = Math.max(8, floor - y - 1);
      const cone = scene.add
        .image(x, y + 1, FX_SOFT, 'cone')
        .setOrigin(0.5, 0)
        .setDisplaySize(Math.min(72, 24 + h * 0.8), h)
        .setTint(0xffb45a)
        .setAlpha(generated ? 0.32 : 0.26)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(depth + 0.1);
      const pool = scene.add
        .image(x, floor, FX_SOFT, 'pool')
        .setDisplaySize(generated ? 84 : 64, 12)
        .setTint(0xffaa50)
        .setAlpha(generated ? 0.42 : 0.36)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(depth + 0.1);
      const bulb = scene.add
        .image(x, y, FX_SOFT, 'glow')
        .setDisplaySize(22, 12)
        .setTint(0xffd890)
        .setAlpha(generated ? 0.75 : 0.55)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(depth + 0.1);
      // One lamp in three flickers now and then.
      if (!this.reducedMotion && i % 3 === 1) {
        const objs = [cone, pool, bulb];
        this.flickers.push({ objs, base: objs.map((o) => o.alpha), phase: this.rng() * 1000, next: 1500 + this.rng() * 3000, burst: 0 });
      }
    });
  }

  /** Bulb positions of LW_LAMP tiles (background / ground layers) inside a dark zone. */
  private lampTiles(z: DarkRect): { x: number; y: number }[] {
    const lamp = (TILE as Record<string, number>).LW_LAMP;
    const out: { x: number; y: number }[] = [];
    if (lamp === undefined) return out;
    const firstGid = this.ctx.map.tilesets[0]?.firstgid ?? 1;
    const layers = [this.ctx.map.getLayer(LAYERS.background)?.tilemapLayer, this.ctx.ground];
    const tx0 = Math.floor(z.x / TILE_SIZE);
    const tx1 = Math.floor((z.x + z.w - 1) / TILE_SIZE);
    const ty0 = Math.max(0, Math.floor((z.y - 32) / TILE_SIZE));
    const ty1 = Math.floor((z.y + z.h - 1) / TILE_SIZE);
    for (const l of layers) {
      const data = l?.layer.data;
      if (!data) continue;
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const t = data[ty]?.[tx];
          // Bulb sits at pixel rows 6-7, centred, in the 16×16 lamp tile.
          if (t && t.index - firstGid === lamp) out.push({ x: tx * TILE_SIZE + 8, y: ty * TILE_SIZE + 8 });
        }
      }
    }
    return out;
  }

  update(dtMs: number): void {
    for (const f of this.flickers) {
      if (f.burst > 0) {
        f.burst -= dtMs;
        f.phase += dtMs;
        const on = f.burst <= 0 || Math.sin(f.phase * 0.09) + Math.sin(f.phase * 0.23) > -0.2;
        const k = on ? 1 : 0.35;
        for (let i = 0; i < f.objs.length; i++) f.objs[i].setAlpha(f.base[i] * k);
      } else if ((f.next -= dtMs) <= 0) {
        f.burst = 250 + this.rng() * 350;
        f.next = 2500 + this.rng() * 4500;
      }
    }
  }

  setScreenVisible(on: boolean): void {
    for (const o of this.screenObjs) o.setVisible(on);
  }
}
