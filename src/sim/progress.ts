import { CHALLENGES, tierOf, type RunStats } from './missions';
import { TRACKS } from './tracks';

/** Stars needed to open each run (GMA: cumulative tickets open new lifts). */
export const UNLOCK: Record<string, number> = { 'combe-douce': 0, 'crete-du-loup': 4, 'couloir-noir': 9 };

export interface Outfit { id: string; name: string; stars: number; jacket: number; pants: number; helmet: number; skis: number }

/** Purely cosmetic rewards: never gate a challenge behind gear (Traffic Rider's top complaint). */
export const COSMETICS: Outfit[] = [
  { id: 'ember', name: 'Ember', stars: 0, jacket: 0xff6b4a, pants: 0x2b3a55, helmet: 0xf4f6fa, skis: 0x3a7bd5 },
  { id: 'glacier', name: 'Glacier', stars: 3, jacket: 0x58d6c9, pants: 0x1f3b4d, helmet: 0xffffff, skis: 0xff7a3d },
  { id: 'sunburst', name: 'Sunburst', stars: 6, jacket: 0xffc43d, pants: 0x3b2f5c, helmet: 0x2b2b33, skis: 0x2b2b33 },
  { id: 'violet', name: 'Violet Hour', stars: 9, jacket: 0x8b5cf6, pants: 0x1e1b3a, helmet: 0xf0e6ff, skis: 0xffd166 },
  { id: 'forest', name: 'Pine', stars: 13, jacket: 0x2f7a55, pants: 0x3d2b1f, helmet: 0xe8d9b5, skis: 0xc0392b },
  { id: 'midnight', name: 'Midnight', stars: 18, jacket: 0x1d2333, pants: 0x0f121b, helmet: 0xd4af37, skis: 0xd4af37 },
  { id: 'aurora', name: 'Aurora', stars: 23, jacket: 0x2de2c4, pants: 0x5b2a86, helmet: 0xff5fa2, skis: 0x2de2c4 },
  { id: 'gold', name: 'Gold Line', stars: 27, jacket: 0xf2c14e, pants: 0xfaf7f0, helmet: 0xf2c14e, skis: 0xfaf7f0 },
];

export interface TrackRecord { bestTime: number | null; bestScore: number; topKmh: number }

export interface Settings {
  quality: 'low' | 'medium' | 'high';
  volume: number;
  music: boolean;
  sensitivity: number;
  leftHanded: boolean;
  comfort: boolean;
  camera: 'chase' | 'helmet';
  tilt: boolean;
  showFps: boolean;
  vibration: boolean;
  /** Free ride: people on the pistes, times an average day (0.4 off-season to 2.5 peak day). */
  traffic: number;
}

export interface Save {
  version: 1;
  /** best tier reached per challenge id */
  medals: { [challengeId: string]: number };
  records: { [trackId: string]: TrackRecord };
  outfit: string;
  settings: Settings;
  seenHint: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'high', volume: 0.8, music: true, sensitivity: 1, leftHanded: false, comfort: false, camera: 'chase', tilt: false, showFps: false,
  vibration: true, traffic: 1,
};

const KEY = 'sillage.save.v1';

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function emptySave(): Save {
  return { version: 1, medals: {}, records: {}, outfit: 'ember', settings: { ...DEFAULT_SETTINGS }, seenHint: false };
}

/** Never throws: private mode, blocked storage or corrupt JSON all fall back to an empty save. */
export function loadSave(store: KV): Save {
  try {
    const raw = store.getItem(KEY);
    if (!raw) return emptySave();
    const data = JSON.parse(raw) as Partial<Save>;
    if (data.version !== 1) return emptySave();
    const base = emptySave();
    return { ...base, ...data, settings: { ...base.settings, ...data.settings }, medals: { ...data.medals }, records: { ...data.records } } as Save;
  } catch {
    return emptySave();
  }
}

export function saveSave(store: KV, s: Save): void {
  try {
    store.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: progress lives for this session only */
  }
}

export const starsOf = (s: Save, trackId: string) =>
  (CHALLENGES[trackId] ?? []).reduce((n, c) => n + (s.medals[c.id] ?? 0), 0);

export const totalStars = (s: Save) => TRACKS.reduce((n, t) => n + starsOf(s, t.id), 0);

export const isUnlocked = (s: Save, trackId: string) => totalStars(s) >= (UNLOCK[trackId] ?? 0);

export interface MedalGain { challengeId: string; from: number; to: number }

/** Folds a run into the save (pure): best tiers, records, and the list of medals just earned. */
export function applyRun(s: Save, trackId: string, run: RunStats): { save: Save; gained: MedalGain[]; unlocked: string[] } {
  const next: Save = { ...s, medals: { ...s.medals }, records: { ...s.records } };
  const gained: MedalGain[] = [];
  const before = new Set(TRACKS.filter((t) => isUnlocked(s, t.id)).map((t) => t.id));
  for (const c of CHALLENGES[trackId] ?? []) {
    const tier = tierOf(c, run);
    const prev = next.medals[c.id] ?? 0;
    if (tier > prev) {
      next.medals[c.id] = tier;
      gained.push({ challengeId: c.id, from: prev, to: tier });
    }
  }
  const r = next.records[trackId] ?? { bestTime: null, bestScore: 0, topKmh: 0 };
  next.records[trackId] = {
    bestTime: run.finished ? (r.bestTime === null ? run.time : Math.min(r.bestTime, run.time)) : r.bestTime,
    bestScore: run.finished ? Math.max(r.bestScore, run.score) : r.bestScore,
    topKmh: Math.max(r.topKmh, run.topKmh),
  };
  const unlocked = TRACKS.filter((t) => isUnlocked(next, t.id) && !before.has(t.id)).map((t) => t.id);
  return { save: next, gained, unlocked };
}
