import { describe, expect, it } from 'vitest';
import { applyRun, COSMETICS, isUnlocked, loadSave, saveSave, starsOf, totalStars, type Save } from '../../src/sim/progress';
import type { RunStats } from '../../src/sim/missions';

const mem = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};
const stats = (o: Partial<RunStats> = {}): RunStats => ({
  finished: true, time: 999, topKmh: 0, longestJump: 0, bestChain: 0, bestSpin: 0, crashes: 0, score: 0, ...o,
});

describe('progress', () => {
  it('starts empty: easy run unlocked, the others locked', () => {
    const s = loadSave(mem());
    expect(totalStars(s)).toBe(0);
    expect(isUnlocked(s, 'combe-douce')).toBe(true);
    expect(isUnlocked(s, 'crete-du-loup')).toBe(false);
    expect(isUnlocked(s, 'couloir-noir')).toBe(false);
  });

  it('keeps the best tier per challenge, reports new medals, and never loses stars', () => {
    let s: Save = loadSave(mem());
    const r1 = applyRun(s, 'combe-douce', stats({ time: 79, topKmh: 72, longestJump: 13 }));
    s = r1.save;
    expect(r1.gained.length).toBeGreaterThan(0);
    const before = starsOf(s, 'combe-douce');
    const r2 = applyRun(s, 'combe-douce', stats({ finished: false, topKmh: 10 }));
    expect(starsOf(r2.save, 'combe-douce')).toBe(before);
    expect(r2.gained.length).toBe(0);
  });

  it('records best time (lower), best score and top speed (higher)', () => {
    let s = loadSave(mem());
    s = applyRun(s, 'combe-douce', stats({ time: 80, score: 1000, topKmh: 60 })).save;
    s = applyRun(s, 'combe-douce', stats({ time: 90, score: 3000, topKmh: 55 })).save;
    s = applyRun(s, 'combe-douce', stats({ finished: false, time: 5, score: 50, topKmh: 99 })).save;
    expect(s.records['combe-douce']).toEqual({ bestTime: 80, bestScore: 3000, topKmh: 99 });
  });

  it('unlocks the next runs at 4 and 9 stars, and cosmetics by star count', () => {
    let s = loadSave(mem());
    const r = applyRun(s, 'combe-douce', stats({ time: 75, topKmh: 72, longestJump: 21 })); // 6 stars
    s = r.save;
    expect(totalStars(s)).toBe(6);
    expect(r.unlocked).toEqual(['crete-du-loup']);
    expect(isUnlocked(s, 'couloir-noir')).toBe(false);
    s = applyRun(s, 'combe-douce', stats({ time: 60, topKmh: 99, longestJump: 99 })).save; // 9 stars
    expect(isUnlocked(s, 'couloir-noir')).toBe(true);
    expect(COSMETICS.filter((c) => c.stars <= totalStars(s)).length).toBeGreaterThan(1);
  });

  it('round-trips through storage and survives corrupt data or a throwing storage', () => {
    const store = mem();
    let s = loadSave(store);
    s = applyRun(s, 'combe-douce', stats({ time: 70 })).save;
    saveSave(store, s);
    expect(loadSave(store)).toEqual(s);
    store.setItem('sillage.save.v1', '{oops');
    expect(totalStars(loadSave(store))).toBe(0);
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(totalStars(loadSave(broken))).toBe(0);
    expect(() => saveSave(broken, s)).not.toThrow();
  });
});
