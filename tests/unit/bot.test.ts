import { describe, expect, it } from 'vitest';
import { botInput } from '../../src/sim/bot';
import { createRun, stepRun, type RunEvent } from '../../src/sim/run';
import { createSkier, stepSkier, type SkierEvent } from '../../src/sim/skier';
import { makeTrack, type TrackDef } from '../../src/sim/track';
import { DT, input } from './helpers';

const GREYBOX: TrackDef = {
  id: 'greybox', name: 'Grey box', seed: 7, length: 1200, slopeDeg: 16, halfWidth: 24,
  kickers: [{ z: 250, size: 'small' }, { z: 520, size: 'medium' }, { z: 820, size: 'large' }],
};

/** Drives a whole descent with the simple "follow the line, dodge trees, hold a speed" bot. */
export function botRun(def: TrackDef, targetKmh: number, maxSeconds = 240) {
  const track = makeTrack(def);
  const s = createSkier(track, track.centerX(2), 2, 0);
  const run = createRun();
  const inp = input();
  const sEv: SkierEvent[] = [];
  const rEv: RunEvent[] = [];
  let t = 0;
  while (s.pos.z < def.length && t < maxSeconds) {
    sEv.length = 0;
    rEv.length = 0;
    botInput(s, track, inp, targetKmh / 3.6);
    stepSkier(s, inp, track, DT, sEv);
    stepRun(run, s, track, DT, sEv, rEv);
    t += DT;
  }
  return { finished: s.pos.z >= def.length, time: t, run };
}

describe('bot (proof that the line is readable and finishable with basic inputs)', () => {
  it('finishes the grey-box track without crashing at a cautious 45 km/h', () => {
    const r = botRun(GREYBOX, 45);
    expect(r.finished).toBe(true);
    expect(r.run.crashes).toBe(0);
  });

  it('finishes at 70 km/h with at most one crash', () => {
    const r = botRun(GREYBOX, 70);
    expect(r.finished).toBe(true);
    expect(r.run.crashes).toBeLessThanOrEqual(1);
  });
});
