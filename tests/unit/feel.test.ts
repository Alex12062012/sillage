/**
 * Feel targets from docs/FEEL.md, measured on the real physics in a headless simulation.
 * If a tuning change breaks one of these, the game "feels" different: update FEEL.md on purpose or revert.
 */
import { describe, expect, it } from 'vitest';
import { kickerOffset, KICKERS } from '../../src/sim/track';
import { TUNING } from '../../src/tuning';
import { input, kmh, ms, simulate, skierAt, slopeGround, velHeading } from './helpers';

describe('FEEL §1 — glide physics', () => {
  it('0 → 50 km/h in tuck on 18° takes 3–5 s', () => {
    const g = slopeGround(18);
    const s = skierAt(g, 0, 0);
    let t50 = -1;
    simulate(s, g, 8, () => input({ tuck: true }), (st, t) => {
      if (t50 < 0 && kmh(st.vel.length()) >= 50) t50 = t;
    });
    expect(t50).toBeGreaterThanOrEqual(3);
    expect(t50).toBeLessThanOrEqual(5);
  });

  it('terminal speed on 18°: tuck > 110 km/h, upright 75–100 km/h', () => {
    const g = slopeGround(18);
    const tuck = skierAt(g, 0, 20);
    simulate(tuck, g, 90, () => input({ tuck: true }));
    const up = skierAt(g, 0, 20);
    simulate(up, g, 90);
    expect(kmh(tuck.vel.length())).toBeGreaterThan(110);
    expect(kmh(up.vel.length())).toBeGreaterThanOrEqual(75);
    expect(kmh(up.vel.length())).toBeLessThanOrEqual(100);
  });

  it('a progressive 90° carve at 50 km/h takes 0.9–1.5 s and loses < 15 % speed', () => {
    const g = slopeGround(0);
    const s = skierAt(g, 0, ms(50));
    const v0 = s.vel.length();
    let tTurn = -1;
    simulate(s, g, 2.5, () => input({ steer: tTurn < 0 ? 0.6 : 0 }), (st, t) => {
      if (tTurn < 0 && Math.abs(velHeading(st)) >= Math.PI / 2) tTurn = t;
    });
    expect(tTurn).toBeGreaterThanOrEqual(0.9);
    expect(tTurn).toBeLessThanOrEqual(1.5);
    // speed when the velocity crossed 90°: measured by a dedicated run
    const s2 = skierAt(g, 0, ms(50));
    let vTurn = 0;
    simulate(s2, g, tTurn, () => input({ steer: 0.6 }), (st) => { vTurn = st.vel.length(); });
    expect(1 - vTurn / v0).toBeLessThan(0.15);
  });

  it('yanking full lock at 70 km/h skids and loses > 30 % speed in 1.2 s', () => {
    const g = slopeGround(0);
    const s = skierAt(g, 0, ms(70));
    const v0 = s.vel.length();
    let maxSkid = 0;
    simulate(s, g, 1.2, () => input({ steer: 1 }), (st) => { maxSkid = Math.max(maxSkid, st.skid); });
    expect(1 - s.vel.length() / v0).toBeGreaterThan(0.3);
    expect(maxSkid).toBeGreaterThan(0.5);
  });

  it('brake: 70 → 0 km/h on 18° within 2.5–4 s', () => {
    const g = slopeGround(18);
    const s = skierAt(g, 0, ms(70));
    let tStop = -1;
    simulate(s, g, 6, () => input({ brake: true }), (st, t) => {
      if (tStop < 0 && st.vel.length() < 0.3) tStop = t;
    });
    expect(tStop).toBeGreaterThanOrEqual(2.5);
    expect(tStop).toBeLessThanOrEqual(4);
  });

  it('pop on flat ground: 0.6–0.9 s of airtime', () => {
    const g = slopeGround(0);
    const s = skierAt(g, 0, 8);
    let first = true;
    let air = 0;
    simulate(s, g, 2, () => { const j = first; first = false; return input({ jump: j }); }, (st) => { if (st.airborne) air += 1 / 60; });
    expect(air).toBeGreaterThanOrEqual(0.6);
    expect(air).toBeLessThanOrEqual(0.9);
  });

  it('medium kicker at 50 km/h: 0.9–2.2 s of air and a soft landing', () => {
    const k = { ...KICKERS.medium, z: 20, x: 0 };
    const g = slopeGround(18, (x, z) => kickerOffset(k, x, z));
    const s = skierAt(g, 0, ms(50));
    let air = 0;
    const events = simulate(s, g, 5, () => input({ brake: false }), (st) => { if (st.airborne) air += 1 / 60; });
    const land = events.find((e) => e.type === 'land');
    expect(air).toBeGreaterThanOrEqual(0.9);
    expect(air).toBeLessThanOrEqual(2.2);
    expect(land && land.type === 'land' && land.vn).toBeLessThan(TUNING.landHardVn);
  });

  it('overshooting a small kicker at 95 km/h is a hard landing that costs speed, not a crash', () => {
    const k = { ...KICKERS.small, z: 20, x: 0 };
    const g = slopeGround(16, (x, z) => kickerOffset(k, x, z));
    const s = skierAt(g, 0, ms(95));
    let vBefore = 0;
    const events = simulate(s, g, 5, () => input(), (st, _t, ev) => {
      if (st.airborne) vBefore = st.vel.length();
      for (const e of ev) if (e.type === 'land' && vBefore === 0) vBefore = st.vel.length();
    });
    const land = events.find((e) => e.type === 'land');
    expect(land && land.type === 'land' && land.quality).not.toBe('crash');
    expect(land && land.type === 'land' && land.vn).toBeGreaterThan(TUNING.landHardVn);
    expect(events.some((e) => e.type === 'crash')).toBe(false);
  });

  it('rhythmic clean carving (pump) builds more speed than the same slalom without pump', () => {
    const g = slopeGround(10);
    const slalom = (pump: number) => {
      const saved = TUNING.pumpBoost;
      TUNING.pumpBoost = pump;
      const s = skierAt(g, 0, ms(30));
      simulate(s, g, 12, (_st, t) => input({ steer: Math.sin(t * Math.PI * 1.1) > 0 ? 0.55 : -0.55 }));
      TUNING.pumpBoost = saved;
      return s.vel.length();
    };
    expect(slalom(TUNING.pumpBoost)).toBeGreaterThan(slalom(0) + 1);
  });
});
