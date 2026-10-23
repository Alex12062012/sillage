/** FEEL §2 mappings: speed → FOV, wind and carve audio. Pure functions, no WebGL / WebAudio needed. */
import { describe, expect, it } from 'vitest';
import { carveLevel, rhythmNote, windParams } from '../../src/audio/audio';
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

describe('rhythm notes', () => {
  const semis = (f: number, root: number) => ((Math.round(12 * Math.log2(f / root)) % 12) + 12) % 12;
  it('climb one pentatonic step per clean beat, two octaves, then loop the top octave', () => {
    for (let c = 0; c < 4; c++) {
      for (let n = 2; n <= 11; n++) expect(rhythmNote(c, n)).toBeGreaterThan(rhythmNote(c, n - 1));
      expect(rhythmNote(c, 11) / rhythmNote(c, 1)).toBeCloseTo(4, 6);
      for (let n = 12; n < 30; n++) {
        expect(rhythmNote(c, n)).toBeGreaterThan(rhythmNote(c, 6) * 1.01);
        expect(rhythmNote(c, n)).toBeLessThanOrEqual(rhythmNote(c, 11) + 1e-9);
      }
    }
  });

  it('stay in the pentatonic of the chord (and in C major)', () => {
    const cMajor = [0, 2, 4, 5, 7, 9, 11];
    for (let c = 0; c < 4; c++) {
      const pent = new Set<number>();
      for (let n = 1; n <= 20; n++) {
        pent.add(semis(rhythmNote(c, n), 261.63));
        expect(cMajor).toContain(semis(rhythmNote(c, n), 261.63));
      }
      expect(pent.size).toBe(5);
    }
    expect(rhythmNote(5, 3)).toBe(rhythmNote(1, 3)); // the chord index wraps
  });

  it('never step down when the chord changes mid-climb', () => {
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let n = 1; n < 11; n++) expect(rhythmNote(b, n + 1)).toBeGreaterThan(rhythmNote(a, n));
  });
});
