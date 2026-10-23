import { describe, expect, it } from 'vitest';
import { botInput } from '../../src/sim/bot';
import { makeMountain, PISTES, SUMMIT_SPAWN } from '../../src/sim/mountain';
import { createSkier, stepSkier, type SkierEvent } from '../../src/sim/skier';
import { DT, input } from './helpers';

describe('free-ride mountain', () => {
  const m = makeMountain();

  it('every piste goes downhill from the summit to the village, without basins', () => {
    for (const p of PISTES) {
      for (let z = p.z0 + 10; z < 1140; z += 5) {
        if (p === PISTES[0] && m.kickers.some((k) => z > k.z - 5 && z < k.z + k.ramp + k.knuckle + 5)) continue; // park ramps climb, by design
        const drop = m.height(p.x(z), z) - m.height(p.x(z + 5), z + 5);
        expect(drop, `${p.name} at z=${z}`).toBeGreaterThan(0);
      }
    }
  });

  it('has forests, and no tree on a piste', () => {
    const trees = m.obstaclesBetween(-1000, 2000);
    expect(trees.length).toBeGreaterThan(1500);
    expect(trees.length).toBeLessThan(5000);
    for (const t of trees) for (const p of PISTES) expect(Math.abs(t.x - p.x(t.z))).toBeGreaterThan(p.halfWidth);
  });

  it('the line-following bot rides the blue from the top to the village', () => {
    const s = createSkier(m, m.centerX(SUMMIT_SPAWN.z), SUMMIT_SPAWN.z, 0);
    const inp = input();
    const ev: SkierEvent[] = [];
    let crashes = 0;
    for (let t = 0; t < 200 && s.pos.z < 1150; t += DT) {
      ev.length = 0;
      botInput(s, m, inp, 50 / 3.6);
      stepSkier(s, inp, m, DT, ev);
      crashes += ev.filter((e) => e.type === 'crash').length;
    }
    expect(s.pos.z).toBeGreaterThan(1150);
    expect(crashes).toBeLessThan(3);
  });
});
