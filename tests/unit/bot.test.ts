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

  it('finishes every run at a brisk pace too (a few crashes allowed on the black run)', () => {
    for (const [i, def] of TRACKS.entries()) {
      const r = botRun(def, [65, 70, 75][i]);
      expect(r.finished).toBe(true);
      expect(r.run.crashes).toBeLessThanOrEqual(def.difficulty === 'hard' ? 4 : 2);
    }
  });
});
