import { describe, expect, it } from 'vitest';
import { botInput, type BotMemory } from '../../src/sim/bot';
import { createRun, stepRun, type RunEvent } from '../../src/sim/run';
import { createSkier, stepSkier, type SkierEvent } from '../../src/sim/skier';
import { makeTrack, type TrackDef } from '../../src/sim/track';
import { TRACKS } from '../../src/sim/tracks';
import { DT, input } from './helpers';

/** Drives a whole descent with the simple "follow the line, dodge trees, hold a speed" bot. */
export function botRun(def: TrackDef, targetKmh: number, maxSeconds = 240) {
  const track = makeTrack(def);
  const s = createSkier(track, track.centerX(2), 2, 0);
  const run = createRun();
  const inp = input();
  const sEv: SkierEvent[] = [];
  const rEv: RunEvent[] = [];
  const mem: BotMemory = { offset: 0 };
  let t = 0;
  while (s.pos.z < def.length && t < maxSeconds) {
    sEv.length = 0;
    rEv.length = 0;
    botInput(s, track, inp, targetKmh / 3.6, 2.4, mem);
    stepSkier(s, inp, track, DT, sEv);
    stepRun(run, s, track, DT, sEv, rEv);
    t += DT;
  }
  return { finished: s.pos.z >= def.length, time: t, run };
}

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
