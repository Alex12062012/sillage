import { describe, expect, it } from 'vitest';
import { fbm, mulberry32, valueNoise } from '../../src/core/rng';

describe('mulberry32', () => {
  it('is deterministic for a seed and stays in [0,1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const va = a();
      expect(va).toBe(b());
      expect(va).toBeGreaterThanOrEqual(0);
      expect(va).toBeLessThan(1);
    }
  });

  it('differs between seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('valueNoise / fbm', () => {
  it('is continuous (small step, small change)', () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37;
      const z = i * 1.13;
      expect(Math.abs(valueNoise(7, x, z) - valueNoise(7, x + 0.001, z))).toBeLessThan(0.01);
    }
  });

  it('stays within [-1, 1] and depends on the seed', () => {
    let diff = 0;
    for (let i = 0; i < 500; i++) {
      const v = fbm(3, i * 0.7, i * 0.3, 4);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      diff += Math.abs(v - fbm(4, i * 0.7, i * 0.3, 4));
    }
    expect(diff).toBeGreaterThan(1);
  });
});
