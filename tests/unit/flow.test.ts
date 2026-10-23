import { describe, expect, it } from 'vitest';
import { createFlow, FLOW_LEVELS, stepFlow, type FlowEvent } from '../../src/sim/flow';
import type { RunEvent } from '../../src/sim/run';
import type { SkierEvent } from '../../src/sim/skier';
import { DT, ms, skierAt, slopeGround } from './helpers';

const beat = (clean = true): SkierEvent => ({ type: 'edgeChange', clean, carveTime: 0.8, dir: 1 });

/** Runs `seconds` of flow at `kmh`; `every(step)` / `rEv(step)` give that step's events (60 steps = 1 s). */
function ride(seconds: number, kmh: number, every: (i: number) => SkierEvent[] = () => [], rEv: (i: number) => RunEvent[] = () => []) {
  const f = createFlow();
  const s = skierAt(slopeGround(15), 0, ms(kmh));
  const out: FlowEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) stepFlow(f, s, DT, every(i), rEv(i), out);
  return { f, out };
}
const everySecond = (i: number) => (i % 60 === 0 ? [beat()] : []);

describe('flow', () => {
  it('builds level by level from a steady carving rhythm, and counts the streak', () => {
    const { f, out } = ride(16, 50, everySecond);
    expect(f.level).toBeGreaterThanOrEqual(3);
    expect(f.streak).toBeGreaterThanOrEqual(15);
    const ups = out.filter((e) => e.type === 'level' && e.up).map((e) => (e as { level: number }).level);
    expect(ups.slice(0, 3)).toEqual([1, 2, 3]); // one level at a time, in order
  });

  it('a skidded edge change or a long pause ends the streak; a crash empties everything', () => {
    const skid = ride(4, 50, (i) => (i % 60 === 0 ? [beat(i < 150)] : []));
    expect(skid.f.streak).toBe(0);
    expect(skid.out.some((e) => e.type === 'streakEnd' && e.streak === 3)).toBe(true);
    const pause = ride(6, 50, (i) => (i < 120 ? everySecond(i) : []));
    expect(pause.f.streak).toBe(0);
    const crash = ride(10, 50, (i) => (i === 570 ? [{ type: 'crash', reason: 'obstacle' }] : everySecond(i)));
    expect(crash.f.value).toBe(0);
    expect(crash.f.level).toBe(0);
  });

  it('speed alone carries you to level 2 at most, and idling drains it', () => {
    expect(ride(60, 110).f.level).toBe(2);
    const { f } = ride(40, 15, (i) => (i < 720 ? everySecond(i) : []));
    expect(f.value).toBe(0);
  });

  it('near-misses and landed tricks feed it, sketchy landings cost it', () => {
    const shave = ride(3, 60, () => [], (i) => (i % 60 === 0 ? [{ type: 'nearMiss', dist: 0.5, razor: true, side: 1, points: 250, chain: 1, kind: 'tree', offPiste: false, x: 0, z: 0, h: 4 }] : []));
    expect(shave.f.value).toBeGreaterThan(FLOW_LEVELS[1]);
    const land = (quality: 'perfect' | 'sketchy') => ride(DT, 50, () => [{ type: 'land', vn: 2, quality, spin: 2 * Math.PI, flips: 0, airTime: 1, distance: 10 }]).f.value;
    expect(land('perfect')).toBeGreaterThan(0.3);
    expect(land('sketchy')).toBe(0);
  });
});
