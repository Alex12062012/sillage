/**
 * Phase 4 gate, quantified: difficulty rises without a brutal spike. A cautious bot stands in for a
 * beginner, a brisk one for an improving player. Thresholds come from these runs (docs/DECISIONS.md).
 */
import { describe, expect, it } from 'vitest';
import { CHALLENGES, tierOf, type RunStats } from '../../src/sim/missions';
import { UNLOCK } from '../../src/sim/progress';
import { TRACKS } from '../../src/sim/tracks';
import { botRun } from './helpers';

const statsOf = (r: ReturnType<typeof botRun>): RunStats => ({
  finished: r.finished, time: r.run.time, topKmh: r.run.topSpeed * 3.6, longestJump: r.run.longestJump,
  bestChain: r.run.bestChain, bestSpin: r.run.bestSpin, crashes: r.run.crashes, score: r.run.score,
});
const stars = (id: string, st: RunStats) => CHALLENGES[id].reduce((n, c) => n + tierOf(c, st), 0);

describe('difficulty curve', () => {
  const beginner = TRACKS.map((t) => stars(t.id, statsOf(botRun(t, 45))));
  const improving = TRACKS.map((t) => stars(t.id, statsOf(botRun(t, 75))));

  it('gives every run at least one star to a cautious beginner', () => {
    for (const s of beginner) expect(s).toBeGreaterThanOrEqual(1);
  });

  it('lets an improving player open the next runs one after the other', () => {
    expect(improving[0]).toBeGreaterThanOrEqual(UNLOCK['crete-du-loup']);
    expect(improving[0] + improving[1]).toBeGreaterThanOrEqual(UNLOCK['couloir-noir']);
  });

  it('keeps headroom: simple driving never reaches all 27 stars (gold needs tricks, near-misses, lines)', () => {
    expect(improving.reduce((a, b) => a + b, 0)).toBeLessThan(27 - 6);
  });
});
