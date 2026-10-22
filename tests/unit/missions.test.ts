import { describe, expect, it } from 'vitest';
import { CHALLENGES, describeChallenge, liveTier, tierOf, type RunStats } from '../../src/sim/missions';
import { TRACKS } from '../../src/sim/tracks';

const stats = (o: Partial<RunStats> = {}): RunStats => ({
  finished: true, time: 999, topKmh: 0, longestJump: 0, bestChain: 0, bestSpin: 0, crashes: 0, score: 0, ...o,
});

describe('challenges', () => {
  it('every run has 3 challenges whose tiers get strictly harder', () => {
    for (const t of TRACKS) {
      const list = CHALLENGES[t.id];
      expect(list.length).toBe(3);
      for (const c of list) {
        const [b, s, g] = c.tiers;
        if (c.lowerIsBetter) expect(b > s && s > g).toBe(true);
        else expect(b < s && s < g).toBe(true);
      }
    }
  });

  it('race tiers need a finished run under the threshold', () => {
    const race = CHALLENGES['combe-douce'].find((c) => c.kind === 'race')!;
    expect(tierOf(race, stats({ finished: false, time: 10 }))).toBe(0);
    expect(tierOf(race, stats({ time: race.tiers[0] + 1 }))).toBe(0);
    expect(tierOf(race, stats({ time: race.tiers[0] - 1 }))).toBe(1);
    expect(tierOf(race, stats({ time: race.tiers[1] - 1 }))).toBe(2);
    expect(tierOf(race, stats({ time: race.tiers[2] - 1 }))).toBe(3);
  });

  it('speed, air, chain and spin tiers count during the run (live medals), clean and score need the finish', () => {
    const speed = CHALLENGES['combe-douce'].find((c) => c.kind === 'speed')!;
    expect(liveTier(speed, stats({ finished: false, topKmh: speed.tiers[1] }))).toBe(2);
    const clean = CHALLENGES['couloir-noir'].find((c) => c.kind === 'clean')!;
    expect(liveTier(clean, stats({ finished: false, crashes: 0 }))).toBe(0);
    expect(tierOf(clean, stats({ crashes: 0 }))).toBe(3);
    expect(tierOf(clean, stats({ crashes: 1 }))).toBe(2);
    expect(tierOf(clean, stats({ crashes: 9 }))).toBe(0);
  });

  it('describes a tier in plain words', () => {
    const race = CHALLENGES['combe-douce'].find((c) => c.kind === 'race')!;
    expect(describeChallenge(race, 2)).toMatch(/Finish under 1:\d\d/);
    const spin = CHALLENGES['crete-du-loup'].find((c) => c.kind === 'spin')!;
    expect(describeChallenge(spin, 1)).toMatch(/180/);
    expect(describeChallenge(spin, 2)).toMatch(/360/);
  });
});
