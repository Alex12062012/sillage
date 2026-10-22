import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createRun, SlowMo, stepRun, type RunEvent } from '../../src/sim/run';
import { stepSkier, type SkierEvent } from '../../src/sim/skier';
import { type Ground, type Obstacle } from '../../src/sim/track';
import { TUNING } from '../../src/tuning';
import { DT, input, ms, skierAt, slopeGround } from './helpers';

/** A slope with a few trees, exposing the obstacle query the game uses. */
function forest(trees: Omit<Obstacle, 'id' | 'kind' | 'h'>[]): Ground {
  const base = slopeGround(12);
  const obs: Obstacle[] = trees.map((t, i) => ({ ...t, id: i, kind: 'tree', h: 8 }));
  return {
    ...base,
    obstaclesNear(x, z, radius, out) {
      out.length = 0;
      for (const o of obs) if (Math.hypot(o.x - x, o.z - z) < radius + o.r) out.push(o);
      return out;
    },
  };
}

function ride(g: Ground, speedKmh: number, seconds: number, steer = 0) {
  const s = skierAt(g, 0, ms(speedKmh));
  const run = createRun();
  const sEv: SkierEvent[] = [];
  const rEv: RunEvent[] = [];
  const all: (SkierEvent | RunEvent)[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    sEv.length = 0;
    rEv.length = 0;
    // hold speed roughly constant so the speed gate is what we test
    const inp = input({ steer, brake: s.vel.length() > ms(speedKmh) + 0.5 });
    stepSkier(s, inp, g, DT, sEv);
    stepRun(run, s, g, DT, sEv, rEv);
    all.push(...sEv, ...rEv);
  }
  return { s, run, all };
}

describe('obstacles', () => {
  it('riding into a tree is a crash, and never counts as a near-miss', () => {
    const { all } = ride(forest([{ x: 0, z: 25, r: 0.6 }]), 50, 3);
    expect(all.some((e) => e.type === 'crash' && e.reason === 'obstacle')).toBe(true);
    expect(all.some((e) => e.type === 'nearMiss')).toBe(false);
  });

  it('passing 1 m from a tree at 50 km/h is a near-miss on the correct side', () => {
    const { all } = ride(forest([{ x: 1.0 + 0.6 + TUNING.skierRadius, z: 25, r: 0.6 }]), 50, 3);
    const nm = all.find((e) => e.type === 'nearMiss');
    expect(nm && nm.type === 'nearMiss').toBe(true);
    if (nm && nm.type === 'nearMiss') {
      expect(nm.dist).toBeGreaterThan(0.8);
      expect(nm.dist).toBeLessThan(1.2);
      expect(nm.razor).toBe(false);
      expect(nm.side).toBe(-1); // tree at +x is on the skier's left when facing +z
    }
    expect(all.some((e) => e.type === 'crash')).toBe(false);
  });

  it('a pass closer than razorDist is a razor near-miss worth more', () => {
    const { all } = ride(forest([{ x: 0.4 + 0.6 + TUNING.skierRadius, z: 25, r: 0.6 }]), 50, 3);
    const nm = all.find((e) => e.type === 'nearMiss');
    expect(nm && nm.type === 'nearMiss' && nm.razor).toBe(true);
  });

  it('no near-miss below the speed gate (Traffic Rider rule) or when passing far away', () => {
    expect(ride(forest([{ x: 2, z: 25, r: 0.6 }]), 25, 4).all.some((e) => e.type === 'nearMiss')).toBe(false);
    expect(ride(forest([{ x: 5, z: 25, r: 0.6 }]), 50, 3).all.some((e) => e.type === 'nearMiss')).toBe(false);
  });

  it('consecutive near-misses chain and each one pays more (linear ramp)', () => {
    const x = 1.0 + 0.6 + TUNING.skierRadius;
    const { all, run } = ride(forest([{ x, z: 20, r: 0.6 }, { x: -x, z: 35, r: 0.6 }, { x, z: 50, r: 0.6 }]), 50, 4.5);
    const nms = all.filter((e) => e.type === 'nearMiss');
    expect(nms.length).toBe(3);
    const pts = nms.map((e) => (e.type === 'nearMiss' ? e.points : 0));
    expect(pts[1]).toBeGreaterThan(pts[0]);
    expect(pts[2]).toBeGreaterThan(pts[1]);
    expect(run.bestChain).toBe(3);
    expect(run.score).toBe(pts[0] + pts[1] + pts[2]);
  });
});

describe('SlowMo', () => {
  it('drops to the target scale, holds, eases back to 1 on real time', () => {
    const sm = new SlowMo();
    sm.trigger(0.4, 0.25, 0.3);
    expect(sm.update(0.01)).toBeCloseTo(0.4, 5);
    sm.update(0.24);
    expect(sm.scale).toBeCloseTo(0.4, 5);
    sm.update(0.15);
    expect(sm.scale).toBeGreaterThan(0.4);
    expect(sm.scale).toBeLessThan(1);
    sm.update(0.2);
    expect(sm.scale).toBe(1);
  });

  it('a weaker trigger never overrides a stronger running one', () => {
    const sm = new SlowMo();
    sm.trigger(0.3, 0.2, 0.2);
    sm.trigger(0.8, 0.5, 0.2);
    expect(sm.update(0.01)).toBeCloseTo(0.3, 5);
  });
});

describe('run stats', () => {
  it('tracks top speed and counts crashes', () => {
    const { run } = ride(forest([{ x: 0, z: 25, r: 0.6 }]), 50, 3);
    expect(run.topSpeed).toBeGreaterThan(ms(45));
    expect(run.crashes).toBe(1);
    expect(new Vector3().length()).toBe(0);
  });
});
