import { TUNING as T } from '../tuning';
import type { RunEvent } from './run';
import type { SkierEvent, SkierState } from './skier';
import { clamp } from './track';

/**
 * Flow: how "in the zone" the run feels right now. Cosmetic, never scores: clean carving beats,
 * near-misses, landed tricks and sustained speed fill it; idling, braking and mistakes drain it.
 * It drives the musical rhythm (the beat streak) and the escalating feedback (music layers, meter, FOV).
 */
export interface FlowState {
  /** 0..1 */
  value: number;
  /** 0..4, from FLOW_LEVELS with hysteresis */
  level: number;
  /** clean edge changes in a row */
  streak: number;
  /** ground time since the last clean beat */
  sinceBeat: number;
}

export type FlowEvent =
  | { type: 'beat'; streak: number }
  | { type: 'streakEnd'; streak: number }
  | { type: 'level'; level: number; up: boolean };

/** Value thresholds of levels 1..4; a level drops FLOW_HYSTERESIS below its threshold. */
export const FLOW_LEVELS = [0.2, 0.45, 0.7, 0.92];
const FLOW_HYSTERESIS = 0.08;

export const createFlow = (): FlowState => ({ value: 0, level: 0, streak: 0, sinceBeat: 0 });

function endStreak(f: FlowState, out: FlowEvent[]): void {
  if (f.streak > 0) out.push({ type: 'streakEnd', streak: f.streak });
  f.streak = 0;
}

/** Per physics step, after stepSkier / stepRun, with their events. */
export function stepFlow(f: FlowState, s: SkierState, dt: number, sEv: SkierEvent[], rEv: RunEvent[], out: FlowEvent[]): void {
  for (const e of sEv) {
    if (e.type === 'edgeChange') {
      if (!e.clean) { endStreak(f, out); continue; }
      f.streak++;
      f.sinceBeat = 0;
      f.value += T.flowBeat * (1 + 0.1 * Math.min(f.streak, 10));
      out.push({ type: 'beat', streak: f.streak });
    } else if (e.type === 'land') {
      const trick = Math.abs(e.spin) >= 2 * Math.PI - 0.6 || e.flips > 0 || (e.grab ?? 0) > 0;
      if (e.quality === 'sketchy') f.value -= T.flowSketchy;
      else if (e.quality !== 'crash') f.value += (e.quality === 'perfect' ? 0.2 : 0.1) + (trick ? 0.12 : 0);
    } else if (e.type === 'crash') {
      f.value = 0;
      endStreak(f, out);
    }
  }
  for (const e of rEv) if (e.type === 'nearMiss') f.value += e.razor ? 0.25 : 0.15;

  if (!s.airborne && s.crashTimer <= 0) {
    const kmh = s.vel.length() * 3.6;
    if (s.braking) {
      f.value -= T.flowBrakeDrain * dt;
      endStreak(f, out); // braking breaks the rhythm
    } else if (f.value < FLOW_LEVELS[1]) {
      f.value += T.flowSpeed * clamp((kmh - 70) / 30, 0, 1) * dt; // speed alone carries you to level 2, no further
    }
    f.sinceBeat += dt;
    if (f.sinceBeat > T.flowBeatWindow) endStreak(f, out);
    f.value -= T.flowDecay * (kmh < 25 ? 3 : 1) * dt;
  }
  f.value = clamp(f.value, 0, 1);

  let level = f.level;
  while (level < FLOW_LEVELS.length && f.value >= FLOW_LEVELS[level]) level++;
  while (level > 0 && f.value < FLOW_LEVELS[level - 1] - FLOW_HYSTERESIS) level--;
  if (level !== f.level) {
    out.push({ type: 'level', level, up: level > f.level });
    f.level = level;
  }
}
