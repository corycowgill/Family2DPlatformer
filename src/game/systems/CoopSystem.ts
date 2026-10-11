import Phaser from 'phaser';
import { DEPTH } from '../config';
import { CHARACTER_IDS, EMPTY_INPUT, EV, type CharacterId, type InputState } from '../types';
import { getCharacter } from '../characters';
import { Player } from '../entities/Player';
import { attachAbilities } from './Abilities';
import { InputSystem, inputClaims, type InputSource } from './InputSystem';
import { KEY_P2_JOIN, KEY_P2_LEAVE, PAD } from './InputMapping';
import { gamepads } from './Gamepads';
import { playAnim } from './AnimationSystem';
import { saveSystem } from './SaveSystem';
import { isCharacterUnlocked } from './Rewards';
import { heroTexture } from '../ui/CharacterArt';
import { px, setPx } from '../ui/PixelFont';
import { gameState } from '../state/GameState';
import {
  LEASH_MS,
  RESPAWN_DELAY_MS,
  RESPAWN_INVULN_MS,
  cycleCharacter,
  defaultP2Character,
  isOffscreen,
  leashStep,
  padJoinCandidate,
  spotNearPartner,
} from './Coop';

/** What the level scene exposes to the co-op system. */
export interface CoopHost {
  scene: Phaser.Scene;
  /** All players (live array, P1 first). */
  players: Player[];
  readonly player: Player;
  readonly finished: boolean;
  addPlayer(p: Player): void;
  removePlayer(p: Player): void;
  /** Called when a co-op respawn finds nobody left to respawn next to. */
  loseLife(p: Player): void;
  snapCamera(): void;
}

/** Session co-op state (survives scene restarts / level changes), kept in GameState. */
export interface CoopSession {
  character: CharacterId;
  source: InputSource;
}

/** P2 marker colour (HUD uses the same). */
export const P2_COLOR = 0x5ad1ff;

/**
 * Local 2-player co-op (drop-in / drop-out, same screen) — Phaser glue around the pure
 * rules in systems/Coop.ts:
 *  - join: A / Start on a second controller (never P1's pad), or U on the keyboard (P2 plays IJKL + U jump,
 *    O ability, H run); a picker (left/right, jump to confirm) chooses a hero other than P1's.
 *  - leave: View/Back on P2's controller, Backspace on the keyboard (or unplugging the pad).
 *  - P2 gets its own InputSystem, a "P2" marker, and the camera frames both players.
 *  - leash: a player off-screen for LEASH_MS warps next to the partner.
 *  - deaths: with a partner alive, respawn next to them after RESPAWN_DELAY_MS (no life lost).
 */
export class CoopSystem {
  p2: Player | null = null;
  p2Input: InputSystem | null = null;
  private source: InputSource | null = null;
  private picker: {
    source: InputSource;
    input: InputSystem;
    char: CharacterId;
    ghost: Phaser.GameObjects.Sprite;
    label: Phaser.GameObjects.BitmapText;
    prevL: boolean;
    prevR: boolean;
  } | null = null;
  private marker: Phaser.GameObjects.BitmapText | null = null;
  private leash = new Map<Player, number>();
  private pendingRespawn = new Map<Player, Phaser.Time.TimerEvent>();
  private prevP1Pad: number | null = null;
  private p2Pause = false;
  /** Warps done by the leash (tests / debug). */
  warps = 0;

  constructor(private readonly host: CoopHost) {
    const scene = host.scene;
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.lateUpdate, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdown());
  }

  get active(): boolean {
    return !!this.p2;
  }

  get picking(): boolean {
    return !!this.picker;
  }

  get pickerCharacter(): CharacterId | null {
    return this.picker?.char ?? null;
  }

  /** Heroes P2 may pick: unlocked ones other than P1's. */
  available(): CharacterId[] {
    const save = saveSystem.get();
    return CHARACTER_IDS.filter((id) => isCharacterUnlocked(save, id));
  }

  /** Re-create P2 from the session (scene restart, next level). */
  restore(): void {
    const s = gameState.coop;
    if (!s) return;
    if (s.source.kind === 'pad' && !gamepads.has(s.source.index) && !s.source.harness) {
      gameState.coop = null;
      return;
    }
    let char = s.character;
    if (char === this.host.player.def.id) char = defaultP2Character(this.available(), this.host.player.def.id) ?? char;
    if (char === this.host.player.def.id) {
      gameState.coop = null;
      return;
    }
    const p1 = this.host.player;
    const spot = spotNearPartner({ x: p1.x, y: p1.y }, p1.facing, p1.ctx.map.widthInPixels);
    this.spawnP2(char, s.source, spot.x, spot.y);
  }

  // ───────────── per frame ─────────────

  /**
   * Joins / leaves / picker, before Player 1 reads input (so a joining pad is claimed in the
   * same frame). Skipped while `enabled` is false (test harness overriding input).
   */
  detect(enabled: boolean): void {
    if (enabled && !this.host.finished) {
      if (!this.p2 && !this.picker) this.detectJoin();
      else this.detectLeave();
    }
    // A P2 controller that disappeared drops P2 out.
    const src = this.source ?? this.picker?.source;
    if (src?.kind === 'pad' && !src.harness && !gamepads.has(src.index)) this.leave();
    this.prevP1Pad = gamepads.activeIndexExcept(inputClaims.pads);
  }

  private detectJoin(): void {
    const pads = gamepads.indices().map((index) => ({
      index,
      pressedA: gamepads.wasPressedOn(index, PAD.A),
      pressedStart: gamepads.wasPressedOn(index, PAD.MENU),
    }));
    const pad = padJoinCandidate(pads, this.prevP1Pad, inputClaims.pads);
    if (pad !== null) {
      this.startPicker({ kind: 'pad', index: pad });
      return;
    }
    const kb = this.host.scene.input.keyboard;
    const key = kb?.addKey(KEY_P2_JOIN, false);
    if (key && Phaser.Input.Keyboard.JustDown(key) && !inputClaims.keys2) this.startPicker({ kind: 'keys2' });
  }

  private detectLeave(): void {
    const src = this.source ?? this.picker?.source;
    if (!src || src.harness) return;
    if (src.kind === 'pad' && gamepads.wasPressedOn(src.index, PAD.VIEW)) this.leave();
    else if (src.kind === 'keys2') {
      const key = this.host.scene.input.keyboard?.addKey(KEY_P2_LEAVE, false);
      if (key && Phaser.Input.Keyboard.JustDown(key)) this.leave();
    }
  }

  /** Read P2's input for this frame; returns true when P2 pressed pause. */
  readInput(): boolean {
    this.p2Pause = false;
    if (this.picker) {
      this.updatePicker(this.picker.input.update());
      return false;
    }
    if (!this.p2Input) return false;
    const input = this.p2Input.update();
    const src = this.source;
    // View/Back is "leave" for P2's controller, not pause.
    const viewHeld = src?.kind === 'pad' && gamepads.isDownOn(src.index, PAD.VIEW);
    this.p2Pause = input.pausePressed && !viewHeld;
    return this.p2Pause;
  }

  /** Tick P2 (after P1) and run the leash. `hold` = cinematic (no input). */
  tick(dtMs: number, hold: boolean): void {
    const p2 = this.p2;
    if (!p2 || !this.p2Input) return;
    const input: InputState = hold ? EMPTY_INPUT : this.p2Input.current;
    p2.tick(input, dtMs);
    if (!this.host.finished) this.updateLeash(dtMs);
  }

  private updateLeash(dtMs: number): void {
    const cam = this.host.scene.cameras.main;
    const view = cam.worldView;
    if (!view.width) return;
    const living = this.host.players.filter((p) => p.isAlive() && p.active);
    if (living.length < 2) {
      this.leash.clear();
      return;
    }
    for (const p of living) {
      const partner = living.find((q) => q !== p)!;
      const off = isOffscreen(p, view) && !isOffscreen(partner, view);
      const st = leashStep(this.leash.get(p) ?? 0, off, dtMs, LEASH_MS);
      this.leash.set(p, st.offMs);
      if (st.warp) {
        this.warpNear(p, partner);
        return; // one warp per frame
      }
    }
  }

  /** Warp `p` next to `partner` (partner's last safe footing, or where they stand if that's off-screen). */
  warpNear(p: Player, partner: Player): void {
    const spot = this.spotNear(partner);
    this.host.scene.events.emit(EV.SFX, 'poof');
    p.ctx.effect('poof', p.x, p.y - 12);
    p.warpTo(spot.x, spot.y, RESPAWN_INVULN_MS);
    p.ctx.effect('spark', spot.x, spot.y - 12);
    this.leash.set(p, 0);
    this.warps++;
  }

  private spotNear(partner: Player): { x: number; y: number } {
    const view = this.host.scene.cameras.main.worldView;
    const safe = partner.lastSafe;
    const useSafe = view.width > 0 && !isOffscreen(safe, view, -4);
    const base = useSafe ? safe : { x: partner.x, y: partner.y };
    return spotNearPartner(base, partner.facing, partner.ctx.map.widthInPixels);
  }

  /** After physics: keep the P2 marker / picker label above their heads. */
  private lateUpdate(): void {
    const p2 = this.p2;
    if (this.marker && p2) {
      this.marker.setPosition(Math.round(p2.x), Math.round(p2.y - p2.def.body.height - 10));
      this.marker.setVisible(p2.mode !== 'dead' || Math.floor(this.host.scene.time.now / 120) % 2 === 0);
    }
    const pk = this.picker;
    if (pk) {
      const p1 = this.host.player;
      const x = Math.round(p1.x - p1.facing * 20);
      pk.ghost.setPosition(x, Math.round(p1.y));
      pk.label.setPosition(x, Math.round(p1.y - 44));
    }
  }

  // ───────────── deaths ─────────────

  /**
   * A player fell while someone else is alive: respawn next to a living partner after a short
   * delay, no life lost. If nobody is left by then, falls back to the normal life loss.
   */
  scheduleRespawn(p: Player): void {
    this.pendingRespawn.get(p)?.remove(false);
    const ev = this.host.scene.time.delayedCall(RESPAWN_DELAY_MS, () => {
      this.pendingRespawn.delete(p);
      if (!p.active || p.isAlive()) return;
      this.respawnNow(p);
    });
    this.pendingRespawn.set(p, ev);
  }

  /** Respawn a fallen player next to the nearest living partner now (or lose a life if none). */
  respawnNow(p: Player): void {
    this.pendingRespawn.get(p)?.remove(false);
    this.pendingRespawn.delete(p);
    if (p.isAlive()) return;
    const partner = this.host.players.find((q) => q !== p && q.isAlive() && q.active);
    if (!partner) {
      this.host.loseLife(p);
      return;
    }
    const spot = this.spotNear(partner);
    this.host.scene.tweens.killTweensOf(p);
    p.respawn(spot.x, spot.y);
    p.invulnUntil = p.ctx.now() + RESPAWN_INVULN_MS;
    p.ctx.effect('spark', spot.x, spot.y - 12);
    p.ctx.sfx('powerup');
  }

  /** Revive every fallen player at once (level complete). */
  reviveAll(): void {
    for (const p of [...this.pendingRespawn.keys()]) this.respawnNow(p);
  }

  // ───────────── join / leave ─────────────

  private startPicker(source: InputSource): void {
    const p1 = this.host.player;
    const char = defaultP2Character(this.available(), p1.def.id);
    if (!char) return;
    inputClaims.claim(source);
    const input = new InputSystem(this.host.scene, source);
    input.resetEdges();
    const scene = this.host.scene;
    const ghost = scene.add.sprite(p1.x, p1.y, heroTexture(scene, char)).setOrigin(0.5, 1).setDepth(DEPTH.player - 1).setAlpha(0.7);
    playAnim(ghost as unknown as Phaser.GameObjects.Sprite, 'idle');
    const label = px(scene, p1.x, p1.y - 44, '', { color: P2_COLOR, depth: DEPTH.foreground + 3, origin: [0.5, 1] });
    // Held directions don't count as a press (the stick may already be pushed when joining).
    this.picker = { source, input, char, ghost, label, prevL: true, prevR: true };
    this.refreshPicker();
    scene.tweens.add({ targets: ghost, alpha: { from: 0.35, to: 0.8 }, duration: 420, yoyo: true, repeat: -1 });
    this.host.scene.events.emit(EV.SFX, 'menu-move');
  }

  private refreshPicker(): void {
    const pk = this.picker;
    if (!pk) return;
    const def = getCharacter(pk.char);
    const scene = this.host.scene;
    pk.ghost.setTexture(heroTexture(scene, pk.char));
    playAnim(pk.ghost as unknown as Phaser.GameObjects.Sprite, 'idle');
    const ok = pk.source.kind === 'keys2' ? 'U' : 'A';
    setPx(pk.label, `P2 < ${def.name.toUpperCase()} >\n${ok}: PLAY`);
  }

  private updatePicker(input: InputState): void {
    const pk = this.picker;
    if (!pk) return;
    const avail = this.available();
    const taken = this.host.player.def.id;
    if (input.left && !pk.prevL) {
      pk.char = cycleCharacter(pk.char, -1, avail, taken);
      this.refreshPicker();
      this.host.scene.events.emit(EV.SFX, 'menu-move');
    } else if (input.right && !pk.prevR) {
      pk.char = cycleCharacter(pk.char, 1, avail, taken);
      this.refreshPicker();
      this.host.scene.events.emit(EV.SFX, 'menu-move');
    }
    pk.prevL = input.left;
    pk.prevR = input.right;
    if (input.jumpPressed || input.attackPressed) this.confirmPicker();
  }

  private confirmPicker(): void {
    const pk = this.picker;
    if (!pk) return;
    this.closePicker(false);
    const p1 = this.host.player;
    const spot = p1.isAlive() ? spotNearPartner(p1.lastSafe, p1.facing, p1.ctx.map.widthInPixels) : { x: p1.lastSafe.x, y: p1.lastSafe.y };
    this.spawnP2(pk.char, pk.source, spot.x, spot.y, pk.input);
  }

  private closePicker(release: boolean): void {
    const pk = this.picker;
    if (!pk) return;
    this.host.scene.tweens.killTweensOf(pk.ghost);
    pk.ghost.destroy();
    pk.label.destroy();
    this.picker = null;
    if (release) this.releaseClaims();
  }

  /**
   * Add Player 2 right away (test hook / restored session). `source` defaults to a harness-only
   * source that claims no physical device.
   */
  join(character: CharacterId, source: InputSource = { kind: 'keys2', harness: true }): Player {
    if (character === this.host.player.def.id) throw new Error(`P2 must pick a hero other than P1 (${character})`);
    if (this.p2) this.leave();
    this.closePicker(true);
    const p1 = this.host.player;
    const spot = spotNearPartner(p1.isAlive() ? p1.lastSafe : { x: p1.x, y: p1.y }, p1.facing, p1.ctx.map.widthInPixels);
    return this.spawnP2(character, source, spot.x, spot.y);
  }

  private spawnP2(char: CharacterId, source: InputSource, x: number, y: number, input?: InputSystem): Player {
    const scene = this.host.scene;
    if (!source.harness) inputClaims.claim(source);
    const def = getCharacter(char);
    const p2 = new Player(scene, x, y, def);
    p2.slot = 1;
    const skin = heroTexture(scene, def.id);
    if (skin !== def.id) {
      p2.setTexture(skin);
      playAnim(p2, 'idle');
    }
    p2.attach(this.host.player.ctx);
    attachAbilities(p2);
    this.p2 = p2;
    this.source = source;
    this.p2Input = input ?? new InputSystem(scene, source);
    this.p2Input.resetEdges();
    p2.invulnUntil = p2.ctx.now() + RESPAWN_INVULN_MS;
    this.marker = px(scene, x, y - 30, 'P2', { color: P2_COLOR, depth: DEPTH.foreground + 3, origin: [0.5, 1] });
    this.host.addPlayer(p2);
    gameState.coop = { character: char, source };
    p2.ctx.effect('spark', x, y - 12);
    p2.ctx.events.emit(EV.PLAYER_JOINED, p2);
    p2.ctx.sfx('powerup');
    return p2;
  }

  /** Player 2 drops out (the level carries on for Player 1). */
  leave(): void {
    if (this.picker) {
      this.closePicker(true);
      return;
    }
    const p2 = this.p2;
    if (!p2) return;
    this.pendingRespawn.get(p2)?.remove(false);
    this.pendingRespawn.delete(p2);
    this.leash.delete(p2);
    p2.ctx.effect('poof', p2.x, p2.y - 12);
    this.host.removePlayer(p2);
    this.host.scene.tweens.killTweensOf(p2);
    p2.ctx.events.emit(EV.PLAYER_LEFT, p2);
    p2.destroy();
    this.marker?.destroy();
    this.marker = null;
    this.p2 = null;
    this.p2Input = null;
    this.source = null;
    gameState.coop = null;
    this.releaseClaims();
    // P1 was waiting to respawn next to P2: nobody left, so that costs a life now.
    const p1 = this.host.player;
    if (!p1.isAlive() && this.pendingRespawn.has(p1)) this.respawnNow(p1);
  }

  private releaseClaims(): void {
    inputClaims.clear();
  }

  private shutdown(): void {
    this.host.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.lateUpdate, this);
    this.pendingRespawn.clear();
    this.picker = null;
    this.marker = null;
    this.p2 = null;
    this.p2Input = null;
    inputClaims.clear();
  }
}
