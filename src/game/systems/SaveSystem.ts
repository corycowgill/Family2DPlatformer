import { SAVE_VERSION, STORAGE_KEY } from '../config';
import { CHARACTER_IDS, type CharacterId } from '../types';
import { FIRST_LEVEL_ID, LEVELS } from '../data/levels';
import {
  betterMedal,
  COSTUMES,
  earnedUnlocks,
  isCharacterUnlocked,
  isMedal,
  isValidUnlockKey,
  medalFor,
  SECRET_CHARACTERS,
  type Medal,
} from './Rewards';

/** Pure save-data logic (no Phaser) so it can be unit tested in Node. */

export interface Settings {
  musicVolume: number; // 0..1
  sfxVolume: number; // 0..1
  muted: boolean;
  reducedMotion: boolean;
  showTouchControls: 'auto' | 'on' | 'off';
  /** Controller vibration (rumble) where the browser supports it. */
  rumble: boolean;
  /** Lighting / particle quality: 'low' drops screen overlays, glints and sparkle particles (weak phones). */
  effects: 'high' | 'low';
}

export interface LevelRecord {
  completed: boolean;
  bestTimeMs?: number;
  /** Souvenir indices (0..2) collected in this level. */
  souvenirs: number[];
  stars: number;
  /** Best time-trial medal earned on this level (systems/Rewards.ts MEDAL_TIMES). */
  medal?: Medal;
}

export interface SaveData {
  version: number;
  selectedCharacter: CharacterId;
  unlocked: string[];
  levels: Record<string, LevelRecord>;
  totalCoins: number;
  worldsCompleted: number[];
  /** The opening story has been shown (or skipped) once. */
  seenIntro: boolean;
  /** The World 1 ending has been reached — unlocks rewatching it from Extras. */
  seenEnding: boolean;
  /** Later cutscenes seen once (STORY_KEYS: 'world2-intro', 'world2-ending'). */
  seenStories: string[];
  settings: Settings;

  // ── Rewards & replay (systems/Rewards.ts) ──
  /** Secret characters unlocked so far (e.g. 'grandma'); sticky once earned. */
  unlockedCharacters: CharacterId[];
  /** Selected costume per character ('' = classic outfit). Cosmetic only. */
  costumes: Partial<Record<CharacterId, string>>;
  /** Unlock keys already earned + announced ('char:grandma', 'costume:dad-flame'). */
  unlocks: string[];
  /** Earned unlocks not yet looked at on Character Select ("NEW" badges). */
  newUnlocks: string[];
}

/** Result of the last `recordCompletion` (read by the Results screen). */
export interface CompletionReport {
  levelId: string;
  medal: Medal | null;
  previousMedal?: Medal;
  /** Unlock keys earned by this completion (popup). */
  unlocked: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  musicVolume: 0.6,
  sfxVolume: 0.8,
  muted: false,
  reducedMotion: false,
  showTouchControls: 'auto',
  rumble: true,
  effects: 'high',
};

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    selectedCharacter: 'dad',
    unlocked: [FIRST_LEVEL_ID],
    levels: {},
    totalCoins: 0,
    worldsCompleted: [],
    seenIntro: false,
    seenEnding: false,
    seenStories: [],
    settings: { ...DEFAULT_SETTINGS },
    // rewards & replay
    unlockedCharacters: [],
    costumes: {},
    unlocks: [],
    newUnlocks: [],
  };
}

/** Rewards fields of an untrusted save (each malformed entry is dropped). */
function sanitizeRewards(r: Record<string, unknown>, out: SaveData): void {
  if (Array.isArray(r.unlockedCharacters)) {
    out.unlockedCharacters = Array.from(
      new Set(r.unlockedCharacters.filter((c): c is CharacterId => typeof c === 'string' && SECRET_CHARACTERS.includes(c as CharacterId))),
    );
  }
  if (r.costumes && typeof r.costumes === 'object' && !Array.isArray(r.costumes)) {
    for (const [id, c] of Object.entries(r.costumes as Record<string, unknown>)) {
      if (!(CHARACTER_IDS as readonly string[]).includes(id) || typeof c !== 'string') continue;
      if (c === '' || COSTUMES[id as CharacterId].some((d) => d.id === c)) out.costumes[id as CharacterId] = c;
    }
  }
  for (const k of ['unlocks', 'newUnlocks'] as const) {
    if (Array.isArray(r[k])) out[k] = Array.from(new Set((r[k] as unknown[]).filter(isValidUnlockKey)));
  }
  out.newUnlocks = out.newUnlocks.filter((k) => out.unlocks.includes(k));
}

/**
 * Add every unlock the save now qualifies for to `unlocks` (+ `newUnlocks`,
 * `unlockedCharacters`). Returns the keys that were not earned before.
 */
export function syncUnlocks(d: SaveData): string[] {
  const fresh = earnedUnlocks(d).filter((k) => !d.unlocks.includes(k));
  for (const k of fresh) {
    d.unlocks.push(k);
    d.newUnlocks.push(k);
    const m = /^char:(\w+)$/.exec(k);
    if (m && !d.unlockedCharacters.includes(m[1] as CharacterId)) d.unlockedCharacters.push(m[1] as CharacterId);
  }
  return fresh;
}

/** Cutscenes remembered in `seenStories`. */
export const STORY_KEYS = ['world2-intro', 'world2-ending'] as const;
export type StoryKey = (typeof STORY_KEYS)[number];

/**
 * Every completed level unlocks its `next` (saves from before a world existed — e.g. a
 * World 1 save that beat the EL-iminator — open the new world retroactively).
 */
export function repairUnlocks(d: SaveData): void {
  for (const l of LEVELS) {
    if (l.next && d.levels[l.id]?.completed && !d.unlocked.includes(l.next)) d.unlocked.push(l.next);
  }
}

const clamp01 = (n: unknown, d: number) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d;

/** Validate untrusted data; any malformed field falls back to its default. */
export function sanitizeSave(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  if (r.version !== SAVE_VERSION) {
    // Future: migrations by version. Unknown versions start fresh but keep settings if valid.
    if (typeof r.version !== 'number') return d;
  }
  const out = d;
  if (typeof r.selectedCharacter === 'string' && (CHARACTER_IDS as readonly string[]).includes(r.selectedCharacter)) {
    out.selectedCharacter = r.selectedCharacter as CharacterId;
  }
  if (Array.isArray(r.unlocked)) {
    const u = r.unlocked.filter((x): x is string => typeof x === 'string');
    out.unlocked = Array.from(new Set([FIRST_LEVEL_ID, ...u]));
  }
  if (r.levels && typeof r.levels === 'object') {
    for (const [id, rec] of Object.entries(r.levels as Record<string, unknown>)) {
      if (!rec || typeof rec !== 'object') continue;
      const lr = rec as Record<string, unknown>;
      out.levels[id] = {
        completed: lr.completed === true,
        bestTimeMs: typeof lr.bestTimeMs === 'number' && lr.bestTimeMs > 0 ? lr.bestTimeMs : undefined,
        souvenirs: Array.isArray(lr.souvenirs)
          ? Array.from(new Set(lr.souvenirs.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < 3)))
          : [],
        stars: typeof lr.stars === 'number' && lr.stars >= 0 ? Math.floor(lr.stars) : 0,
        medal: isMedal(lr.medal) ? lr.medal : undefined,
      };
      if (!out.levels[id].medal) delete out.levels[id].medal;
    }
  }
  if (typeof r.totalCoins === 'number' && r.totalCoins >= 0) out.totalCoins = Math.floor(r.totalCoins);
  if (Array.isArray(r.worldsCompleted)) out.worldsCompleted = r.worldsCompleted.filter((n): n is number => Number.isInteger(n));
  out.seenIntro = r.seenIntro === true;
  out.seenEnding = r.seenEnding === true;
  if (Array.isArray(r.seenStories)) {
    out.seenStories = Array.from(new Set(r.seenStories.filter((k): k is string => typeof k === 'string' && (STORY_KEYS as readonly string[]).includes(k))));
  }
  repairUnlocks(out);
  if (r.settings && typeof r.settings === 'object') {
    const s = r.settings as Record<string, unknown>;
    out.settings = {
      musicVolume: clamp01(s.musicVolume, DEFAULT_SETTINGS.musicVolume),
      sfxVolume: clamp01(s.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
      muted: s.muted === true,
      reducedMotion: s.reducedMotion === true,
      showTouchControls: s.showTouchControls === 'on' || s.showTouchControls === 'off' ? s.showTouchControls : 'auto',
      rumble: s.rumble !== false,
      effects: s.effects === 'low' ? 'low' : 'high',
    };
  }
  sanitizeRewards(r, out);
  // A secret hero can only be selected once unlocked.
  if (!isCharacterUnlocked(out, out.selectedCharacter)) out.selectedCharacter = 'dad';
  return out;
}

/** Minimal storage interface so tests can inject a fake. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export class SaveSystem {
  private data: SaveData;
  /** Set by recordCompletion for the Results screen. */
  lastCompletion: CompletionReport | null = null;

  constructor(private storage: KeyValueStorage | null = defaultStorage()) {
    this.data = this.load();
  }

  get(): SaveData {
    return this.data;
  }

  load(): SaveData {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      this.data = raw ? sanitizeSave(JSON.parse(raw)) : defaultSave();
    } catch {
      this.data = defaultSave();
    }
    // Old saves unlock retroactively (badged NEW on Character Select, no popup).
    syncUnlocks(this.data);
    return this.data;
  }

  save(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      /* storage full or unavailable — game stays playable */
    }
  }

  update(mutator: (d: SaveData) => void): void {
    mutator(this.data);
    this.save();
  }

  reset(): void {
    const settings = this.data.settings;
    this.data = defaultSave();
    this.data.settings = settings;
    this.save();
  }

  hasProgress(): boolean {
    return Object.values(this.data.levels).some((l) => l.completed) || this.data.unlocked.length > 1;
  }

  /** Remove `keys` from the NEW badges (seen on Character Select). */
  markSeen(keys: string[]): void {
    if (!keys.some((k) => this.data.newUnlocks.includes(k))) return;
    this.update((d) => {
      d.newUnlocks = d.newUnlocks.filter((k) => !keys.includes(k));
    });
  }

  hasSeenStory(key: StoryKey): boolean {
    return this.data.seenStories.includes(key);
  }

  markStorySeen(key: StoryKey): void {
    if (this.hasSeenStory(key)) return;
    this.update((d) => d.seenStories.push(key));
  }

  isUnlocked(levelId: string): boolean {
    return this.data.unlocked.includes(levelId);
  }

  /** Record a level completion; returns true when the time is a new best. */
  recordCompletion(
    levelId: string,
    result: { timeMs: number; coins: number; souvenirs: number[]; stars: number; next?: string; world?: number; worldComplete?: boolean },
  ): boolean {
    let newBest = false;
    const medal = medalFor(levelId, result.timeMs);
    const report: CompletionReport = { levelId, medal, unlocked: [] };
    this.update((d) => {
      const rec: LevelRecord = d.levels[levelId] ?? { completed: false, souvenirs: [], stars: 0 };
      report.previousMedal = rec.medal;
      const best = betterMedal(rec.medal, medal);
      if (best) rec.medal = best;
      rec.completed = true;
      if (rec.bestTimeMs === undefined || result.timeMs < rec.bestTimeMs) {
        rec.bestTimeMs = result.timeMs;
        newBest = true;
      }
      rec.souvenirs = Array.from(new Set([...rec.souvenirs, ...result.souvenirs])).sort();
      rec.stars = Math.max(rec.stars, result.stars);
      d.levels[levelId] = rec;
      d.totalCoins += result.coins;
      if (result.next && !d.unlocked.includes(result.next)) d.unlocked.push(result.next);
      if (result.worldComplete && result.world !== undefined && !d.worldsCompleted.includes(result.world)) {
        d.worldsCompleted.push(result.world);
      }
      report.unlocked = syncUnlocks(d);
    });
    this.lastCompletion = report;
    return newBest;
  }
}

/** Shared singleton used by scenes. */
export const saveSystem = new SaveSystem();
