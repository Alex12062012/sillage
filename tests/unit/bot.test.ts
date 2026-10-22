import { describe, expect, it } from 'vitest';
import { TRACKS } from '../../src/sim/tracks';
import { botRun } from './helpers';

describe('bot (proof that each run is readable and finishable with basic inputs)', () => {
  for (const def of TRACKS) {
    it(`finishes ${def.name} with zero crashes at a cautious pace`, () => {
      const r = botRun(def, def.difficulty === 'easy' ? 45 : 50);
      expect(r.finished).toBe(true);
      expect(r.run.crashes).toBe(0);
    });
  }

  it('punishes speed more as difficulty rises (brisk pace: crashes easy ≤ medium ≤ hard, all finish)', () => {
    const [e, m, h] = TRACKS.map((def, i) => botRun(def, [65, 70, 75][i]));
    for (const r of [e, m, h]) expect(r.finished).toBe(true);
    expect(e.run.crashes).toBeLessThanOrEqual(m.run.crashes);
    expect(m.run.crashes).toBeLessThanOrEqual(h.run.crashes);
    expect(h.run.crashes).toBeLessThanOrEqual(4);
  });
});
