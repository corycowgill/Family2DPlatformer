import { CHARACTER_IDS, type CharacterId } from '../types';
import { LEVELS } from '../data/levels';
import type { SaveData } from './SaveSystem';

/**
 * Rewards & replay rules — pure logic (no Phaser) so it is unit-testable in Node.
 *
 *  - Time-trial medals per level (gold / silver / bronze target times).
 *  - Costumes: 3 per character (art: public/assets/characters/<id>-<costume>.png, built by
 *    tools/art/costumes.py — ids here must match), unlocked in three tiers.
 *  - Grandma, the secret 6th hero.
 *
 * Everything that is earned is *derived* from the save (completions, souvenirs, stars,
 * medals), so old saves unlock retroactively; SaveSystem additionally remembers which
 * unlocks were already announced (`unlocks`) to show a popup exactly once.
 */

// ───────────────────────── medals ─────────────────────────

export type Medal = 'gold' | 'silver' | 'bronze';
export const MEDALS: readonly Medal[] = ['gold', 'silver', 'bronze'];
const RANK: Record<Medal, number> = { gold: 3, silver: 2, bronze: 1 };

export interface MedalTimes {
  gold: number;
  silver: number;
  bronze: number;
}

/**
 * Target times (ms) per level. Par = the platform bot's clean invulnerable runs on the
 * shipped maps (sim time, docs/QA.md "Medal times"), 2026-10 after the playtest pass:
 * loop-1 22-24 s, loop-2 31-33 s, loop-3 27-31 s, loop-boss 73-76 s (incl. the boss fight;
 * the fight length is set by the boss's attack/vulnerable cycle, not by the player).
 * Gold ≈ 1.4x par (tight but fair, no detours), silver ≈ 2.2x (a relaxed clear),
 * bronze ≈ 3.5x (any clear that doesn't get lost; the boss level's bronze is a bit tighter
 * because most of its time is the fight).
 */
export const MEDAL_TIMES: Record<string, MedalTimes> = {
  'loop-1': { gold: 32_000, silver: 50_000, bronze: 80_000 },
  'loop-2': { gold: 45_000, silver: 70_000, bronze: 110_000 },
  'loop-3': { gold: 40_000, silver: 65_000, bronze: 100_000 },
  'loop-boss': { gold: 105_000, silver: 150_000, bronze: 210_000 },
  // TODO-measure (re-run when the real 2-x maps replace the placeholders): bot par on the
  // short placeholder maps, 2026-10 — 2-1 ≈ 9.5 s, 2-2 ≈ 13 s, 2-3 ≈ 10 s, 2-4 ≈ 92 s
  // (approach + the 9-hp Overseer). Gold ≈ 1.4×, silver ≈ 2.2×, bronze ≈ 3.5× par.
  'north-1': { gold: 13_000, silver: 21_000, bronze: 33_000 },
  'north-2': { gold: 18_000, silver: 29_000, bronze: 46_000 },
  'north-3': { gold: 14_000, silver: 22_000, bronze: 35_000 },
  'north-4': { gold: 130_000, silver: 200_000, bronze: 320_000 },
};

export function medalTimes(levelId: string): MedalTimes | undefined {
  return MEDAL_TIMES[levelId];
}

/** Best medal an assisted run (assist mode, systems/Assist.ts) can earn. */
export const ASSIST_MEDAL_CAP: Medal = 'silver';

/**
 * Medal earned by finishing `levelId` in `timeMs` (null = too slow / no targets).
 * Assisted runs never earn gold (capped at ASSIST_MEDAL_CAP).
 */
export function medalFor(levelId: string, timeMs: number, assisted = false): Medal | null {
  const t = MEDAL_TIMES[levelId];
  if (!t || !(timeMs > 0)) return null;
  if (timeMs <= t.gold) return assisted ? ASSIST_MEDAL_CAP : 'gold';
  if (timeMs <= t.silver) return 'silver';
  if (timeMs <= t.bronze) return 'bronze';
  return null;
}

export function medalRank(m: Medal | null | undefined): number {
  return m ? RANK[m] : 0;
}

export function betterMedal(a: Medal | null | undefined, b: Medal | null | undefined): Medal | undefined {
  const best = medalRank(a) >= medalRank(b) ? a : b;
  return best ?? undefined;
}

export function isMedal(v: unknown): v is Medal {
  return v === 'gold' || v === 'silver' || v === 'bronze';
}

/** The next medal to chase for a level and its target time (undefined when gold is held). */
export function nextMedal(levelId: string, have: Medal | null | undefined): { medal: Medal; timeMs: number } | undefined {
  const t = MEDAL_TIMES[levelId];
  if (!t) return undefined;
  const r = medalRank(have);
  if (r >= 3) return undefined;
  const m: Medal = r === 2 ? 'gold' : r === 1 ? 'silver' : 'bronze';
  return { medal: m, timeMs: t[m] };
}

// ───────────────────────── collection progress ─────────────────────────

export interface CollectionStats {
  souvenirs: number;
  souvenirsMax: number;
  stars: number;
  levelsCleared: number;
  levelsTotal: number;
  medals: Record<Medal, number>;
  bossBeaten: boolean;
}

/**
 * Totals over every registered level, or only `world`'s levels. `bossBeaten` is always the
 * World 1 boss (it gates Grandma); per-world boss state is `worldBossBeaten`.
 */
export function collectionStats(save: SaveData, world?: number): CollectionStats {
  const medals: Record<Medal, number> = { gold: 0, silver: 0, bronze: 0 };
  let souvenirs = 0;
  let stars = 0;
  let cleared = 0;
  const levels = world === undefined ? LEVELS : LEVELS.filter((l) => l.world === world);
  for (const l of levels) {
    const r = save.levels[l.id];
    if (!r) continue;
    souvenirs += r.souvenirs.length;
    stars += r.stars;
    if (r.completed) cleared++;
    if (r.medal) medals[r.medal]++;
  }
  const boss = LEVELS.find((l) => l.boss);
  return {
    souvenirs,
    souvenirsMax: levels.length * 3,
    stars,
    levelsCleared: cleared,
    levelsTotal: levels.length,
    medals,
    bossBeaten: save.worldsCompleted.includes(1) || (!!boss && !!save.levels[boss.id]?.completed),
  };
}

/** Has the boss level of `world` been cleared? */
export function worldBossBeaten(save: SaveData, world: number): boolean {
  if (save.worldsCompleted.includes(world)) return true;
  const boss = LEVELS.find((l) => l.world === world && l.boss);
  return !!boss && !!save.levels[boss.id]?.completed;
}

/** Worlds that have registered levels, ascending. */
export function registeredWorlds(): number[] {
  return Array.from(new Set(LEVELS.map((l) => l.world))).sort((a, b) => a - b);
}

// ───────────────────────── unlock rules ─────────────────────────

export type UnlockRuleId = 'tier1' | 'tier2' | 'tier3' | 'grandma';

export interface UnlockRule {
  id: UnlockRuleId;
  /** What it unlocks (Collection screen). */
  reward: string;
  /** Short hint shown on locked items, e.g. "CLEAR 1-2". */
  hint: string;
  progress(save: SaveData): { have: number; need: number };
}

const SECOND_LEVEL = LEVELS[1] ?? LEVELS[0];
const BOSS_LEVEL = LEVELS.find((l) => l.boss) ?? LEVELS[LEVELS.length - 1];

/** Simple, visible rule table (shown on the Collection screen and Character Select). */
export const UNLOCK_RULES: readonly UnlockRule[] = [
  {
    id: 'tier1',
    reward: 'OUTFITS I',
    hint: `CLEAR ${SECOND_LEVEL.number}`,
    progress: (s) => ({ have: s.levels[SECOND_LEVEL.id]?.completed ? 1 : 0, need: 1 }),
  },
  {
    id: 'tier2',
    reward: 'OUTFITS II',
    hint: 'FIND 6 SOUVENIRS',
    // Chicago Stars count too: every star found is worth a souvenir here.
    progress: (s) => {
      const c = collectionStats(s);
      return { have: Math.min(6, c.souvenirs + c.stars), need: 6 };
    },
  },
  {
    id: 'tier3',
    reward: 'OUTFITS III',
    hint: 'WIN 3 GOLD MEDALS',
    progress: (s) => ({ have: Math.min(3, collectionStats(s).medals.gold), need: 3 }),
  },
  {
    id: 'grandma',
    reward: 'SECRET HERO',
    hint: `BEAT THE BOSS IN ${BOSS_LEVEL.number}`,
    progress: (s) => ({ have: collectionStats(s).bossBeaten ? 1 : 0, need: 1 }),
  },
];

export function rule(id: UnlockRuleId): UnlockRule {
  return UNLOCK_RULES.find((r) => r.id === id)!;
}

export function ruleMet(save: SaveData, id: UnlockRuleId): boolean {
  const p = rule(id).progress(save);
  return p.have >= p.need;
}

// ───────────────────────── characters & costumes ─────────────────────────

/** Characters that need unlocking (everyone else is playable from the start). */
export const SECRET_CHARACTERS: readonly CharacterId[] = ['grandma'];

export function isCharacterUnlocked(save: SaveData, id: CharacterId): boolean {
  if (!SECRET_CHARACTERS.includes(id)) return true;
  return save.unlockedCharacters.includes(id) || ruleMet(save, 'grandma');
}

export function characterHint(id: CharacterId): string {
  return SECRET_CHARACTERS.includes(id) ? rule('grandma').hint : '';
}

export interface CostumeDef {
  /** Atlas suffix: texture key `<character>-<id>`. */
  id: string;
  name: string;
  tier: 1 | 2 | 3;
}

/** The classic outfit (base atlas). */
export const CLASSIC = '';

export const COSTUMES: Record<CharacterId, readonly CostumeDef[]> = {
  dad: [
    { id: 'flame', name: 'FLAME TEE', tier: 1 },
    { id: 'raccoon', name: 'RACCOON SUIT', tier: 2 },
    { id: 'hardhat', name: 'HARD HAT', tier: 3 },
  ],
  mom: [
    { id: 'wand', name: 'STAR WAND', tier: 1 },
    { id: 'cat', name: 'KITTY SUIT', tier: 2 },
    { id: 'chef', name: 'CHEF MOM', tier: 3 },
  ],
  brennan: [
    { id: 'knight', name: 'SUPER KNIGHT', tier: 1 },
    { id: 'raccoon', name: 'RACCOON SUIT', tier: 2 },
    { id: 'elf', name: 'FOREST ELF', tier: 3 },
  ],
  parker: [
    { id: 'cap', name: 'CHICAGO CAP', tier: 1 },
    { id: 'dino', name: 'DINO SUIT', tier: 2 },
    { id: 'propeller', name: 'PROPELLER BEANIE', tier: 3 },
  ],
  lupin: [
    { id: 'cape', name: 'SUPER PUP', tier: 1 },
    { id: 'bee', name: 'BUMBLE PUP', tier: 2 },
    { id: 'firefighter', name: 'FIRE PUP', tier: 3 },
  ],
  grandma: [
    { id: 'princess', name: 'PRINCESS', tier: 1 },
    { id: 'sporty', name: 'SPORTY GRAN', tier: 2 },
    { id: 'gardener', name: 'GREEN THUMB', tier: 3 },
  ],
};

export const TIER_RULE: Record<1 | 2 | 3, UnlockRuleId> = { 1: 'tier1', 2: 'tier2', 3: 'tier3' };

export function costumeDef(id: CharacterId, costume: string): CostumeDef | undefined {
  return COSTUMES[id]?.find((c) => c.id === costume);
}

export function isCostumeUnlocked(save: SaveData, id: CharacterId, costume: string): boolean {
  if (costume === CLASSIC) return true;
  const def = costumeDef(id, costume);
  if (!def) return false;
  return save.unlocks.includes(costumeKey(id, costume)) || ruleMet(save, TIER_RULE[def.tier]);
}

export function costumeHint(id: CharacterId, costume: string): string {
  const def = costumeDef(id, costume);
  return def ? rule(TIER_RULE[def.tier]).hint : '';
}

/** Texture / atlas key of a character in a costume. */
export function costumeTexture(id: CharacterId, costume: string): string {
  return costume ? `${id}-${costume}` : id;
}

/** The costume a character will wear (falls back to classic when the saved one is locked or unknown). */
export function selectedCostume(save: SaveData, id: CharacterId): string {
  const c = save.costumes[id] ?? CLASSIC;
  return isCostumeUnlocked(save, id, c) ? c : CLASSIC;
}

// ───────────────────────── unlock keys (announcements) ─────────────────────────

export function characterKey(id: CharacterId): string {
  return `char:${id}`;
}

export function costumeKey(id: CharacterId, costume: string): string {
  return `costume:${id}-${costume}`;
}

/** Every unlock key the save currently qualifies for (rules only, not the remembered list). */
export function earnedUnlocks(save: SaveData): string[] {
  const out: string[] = [];
  for (const id of SECRET_CHARACTERS) if (ruleMet(save, 'grandma')) out.push(characterKey(id));
  for (const id of CHARACTER_IDS) {
    // a secret hero's outfits are announced once the hero is
    if (!isCharacterUnlocked(save, id)) continue;
    for (const c of COSTUMES[id]) if (ruleMet(save, TIER_RULE[c.tier])) out.push(costumeKey(id, c.id));
  }
  return out;
}

export interface UnlockInfo {
  key: string;
  kind: 'character' | 'costume';
  character: CharacterId;
  costume: string;
  /** Display name, e.g. "GRANDMA" or "DAD - HARD HAT". */
  label: string;
}

export function describeUnlock(key: string): UnlockInfo | undefined {
  const m = /^(char|costume):([a-z]+)(?:-([a-z]+))?$/.exec(key);
  if (!m) return undefined;
  const character = m[2] as CharacterId;
  if (!CHARACTER_IDS.includes(character)) return undefined;
  if (m[1] === 'char') return { key, kind: 'character', character, costume: CLASSIC, label: character.toUpperCase() };
  const def = costumeDef(character, m[3] ?? '');
  if (!def) return undefined;
  return { key, kind: 'costume', character, costume: def.id, label: def.name };
}

/** Is a remembered unlock key still meaningful (sanitising old / foreign saves)? */
export function isValidUnlockKey(key: unknown): key is string {
  return typeof key === 'string' && !!describeUnlock(key);
}
