import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { TUNING } from '../../src/tuning';
import { DT, input, ms, simulate, skierAt, slopeGround } from './helpers';

const n = new Vector3();

describe('skier on the ground', () => {
  it('stays glued to a plane slope for 10 s without jitter or NaN', () => {
    const g = slopeGround(18);
    const s = skierAt(g, 0, 5);
    simulate(s, g, 10, () => input(), (st) => {
      expect(st.airborne).toBe(false);
      expect(Number.isFinite(st.pos.x + st.pos.y + st.pos.z + st.vel.x + st.vel.y + st.vel.z)).toBe(true);
      expect(Math.abs(st.pos.y - g.height(st.pos.x, st.pos.z))).toBeLessThan(1e-6);
      g.normal(st.pos.x, st.pos.z, n);
      expect(Math.abs(st.vel.dot(n))).toBeLessThan(1e-6);
    });
  });

  it('steering right (+1) carves toward -x, i.e. screen-right when facing downhill +z', () => {
    const g = slopeGround(15);
    const s = skierAt(g, 0, 10);
    simulate(s, g, 1.5, () => input({ steer: 1 }));
    expect(s.pos.x).toBeLessThan(-1);
  });

  it('brakes to a full stop and holds still on an 18° slope', () => {
    const g = slopeGround(18);
    const s = skierAt(g, 0, ms(40));
    simulate(s, g, 6, () => input({ brake: true }));
    expect(s.vel.length()).toBeLessThan(0.05);
    const z = s.pos.z;
    simulate(s, g, 2, () => input({ brake: true }));
    expect(Math.abs(s.pos.z - z)).toBeLessThan(0.05);
  });

  it('a pole push gets the skier moving from standstill on a flat', () => {
    const g = slopeGround(0);
    const s = skierAt(g, 0, 0);
    simulate(s, g, 2, () => input({ tuck: true }));
    expect(s.vel.length()).toBeGreaterThan(2);
  });
});

describe('air and landing', () => {
  it('jumps off flat ground and lands cleanly', () => {
    const g = slopeGround(0);
    const s = skierAt(g, 0, 8);
    let jumped = false;
    const events = simulate(s, g, 2, () => {
      const j = !jumped;
      jumped = true;
      return input({ jump: j });
    });
    expect(events.some((e) => e.type === 'takeoff')).toBe(true);
    const land = events.find((e) => e.type === 'land');
    expect(land && land.type === 'land' && land.quality !== 'crash').toBe(true);
    expect(s.airborne).toBe(false);
  });

  it('landing with skis across the velocity (90°) is a crash, then the skier gets back up and moves', () => {
    const g = slopeGround(10);
    const s = skierAt(g, 0, 10);
    s.vel.y += 3;
    s.airborne = true;
    s.pos.y += 0.5;
    s.heading = Math.PI / 2; // skis sideways
    const events = simulate(s, g, 1.2);
    expect(events.some((e) => e.type === 'crash')).toBe(true);
    simulate(s, g, TUNING.crashDuration + 0.5);
    expect(s.crashTimer).toBe(0);
    simulate(s, g, 1);
    expect(s.vel.length()).toBeGreaterThan(2);
  });

  it('a 180° (switch) landing is accepted, not a crash', () => {
    const g = slopeGround(10);
    const s = skierAt(g, 0, 10);
    s.vel.y += 3;
    s.airborne = true;
    s.pos.y += 0.5;
    s.heading = Math.PI; // facing backwards
    const events = simulate(s, g, 1.2);
    const land = events.find((e) => e.type === 'land');
    expect(land && land.type === 'land' && land.quality).toBe('switch');
    expect(events.some((e) => e.type === 'crash')).toBe(false);
  });

  it('small moguls at 40 km/h keep the skier on the ground', () => {
    const g = slopeGround(15, (x, z) => 0.35 * Math.sin((z * 2 * Math.PI) / 8) * Math.cos(x * 0.3));
    const s = skierAt(g, 0, ms(40));
    let airFrames = 0;
    simulate(s, g, 3, () => input({ brake: s.vel.length() > ms(42) }), (st) => { if (st.airborne) airFrames++; });
    expect(airFrames).toBeLessThan(3);
  });

  it('runs at a fixed step without drift: 600 steps of 1/60 s equal 10 s', () => {
    expect(Math.round(600 * DT * 1000)).toBe(10000);
  });
});
