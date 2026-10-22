/** FEEL §2 mappings: speed → FOV, wind and carve audio. Pure functions, no WebGL / WebAudio needed. */
import { describe, expect, it } from 'vitest';
import { carveLevel, windParams } from '../../src/audio/audio';
import { targetFov } from '../../src/render/camera';
import { TUNING } from '../../src/tuning';
import { ms } from './helpers';

describe('dynamic FOV', () => {
  it('opens with speed: ~base at 20 km/h, wider at 60, near max at 100+', () => {
    const f20 = targetFov(ms(20), false);
    const f60 = targetFov(ms(60), false);
    const f100 = targetFov(ms(100), false);
    const f140 = targetFov(ms(140), false);
    expect(f20).toBeLessThan(TUNING.fovBase + 2);
    expect(f60).toBeGreaterThan(f20 + 4);
    expect(f100).toBeGreaterThan(f60 + 4);
    expect(f140).toBeLessThanOrEqual(TUNING.fovBase + TUNING.fovMaxBoost + 1e-9);
  });

  it('tucking visibly widens the view', () => {
    expect(targetFov(ms(50), true) - targetFov(ms(50), false)).toBeCloseTo(TUNING.fovTuckBoost, 6);
  });
});

describe('wind audio', () => {
  it('is silent at rest, rises with the square of speed and whistles (higher Q) when fast', () => {
    expect(windParams(0).gain).toBe(0);
    const slow = windParams(ms(30));
    const fast = windParams(ms(110));
    expect(fast.gain).toBeGreaterThan(slow.gain * 4);
    expect(fast.freq).toBeGreaterThan(slow.freq);
    expect(fast.q).toBeGreaterThan(slow.q);
    expect(windParams(ms(300)).gain).toBe(windParams(ms(116)).gain); // saturates
  });
});

describe('carve audio', () => {
  it('is louder with edge load and skid, and silent in the air', () => {
    const straight = carveLevel(ms(50), 0, 0, false);
    const carving = carveLevel(ms(50), 0.8, 0, false);
    const skidding = carveLevel(ms(50), 0.8, 0.8, false);
    expect(carving).toBeGreaterThan(straight * 2);
    expect(skidding).toBeGreaterThan(carving);
    expect(carveLevel(ms(50), 1, 1, true)).toBe(0);
  });
});
