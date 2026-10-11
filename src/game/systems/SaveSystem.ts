import { SAVE_VERSION, STORAGE_KEY } from '../config';
import { CHARACTER_IDS, type CharacterId } from '../types';
import { FIRST_LEVEL_ID } from '../data/levels';

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
  settings: Settings;
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
    settings: { ...DEFAULT_SETTINGS },
  };
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
      };
    }
  }
  if (typeof r.totalCoins === 'number' && r.totalCoins >= 0) out.totalCoins = Math.floor(r.totalCoins);
  if (Array.isArray(r.worldsCompleted)) out.worldsCompleted = r.worldsCompleted.filter((n): n is number => Number.isInteger(n));
  out.seenIntro = r.seenIntro === true;
  out.seenEnding = r.seenEnding === true;
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

  isUnlocked(levelId: string): boolean {
    return this.data.unlocked.includes(levelId);
  }

  /** Record a level completion; returns true when the time is a new best. */
  recordCompletion(
    levelId: string,
    result: { timeMs: number; coins: number; souvenirs: number[]; stars: number; next?: string; world?: number; worldComplete?: boolean },
  ): boolean {
    let newBest = false;
    this.update((d) => {
      const rec = d.levels[levelId] ?? { completed: false, souvenirs: [], stars: 0 };
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
    });
    return newBest;
  }
}

/** Shared singleton used by scenes. */
export const saveSystem = new SaveSystem();
