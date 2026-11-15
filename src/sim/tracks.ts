import { freeDef, stationOfTrack } from './stations';
import type { TrackDef } from './track';

/**
 * The three runs (fixed seeds). Difficulty rises through slope, width, line curvature and feature
 * density — never through new mechanics (GMA lesson: tighten the thresholds, don't add rules).
 */
export const TRACKS: TrackDef[] = [
  {
    id: 'combe-douce', name: 'Combe Douce', difficulty: 'easy', seed: 1021,
    length: 1100, slopeDeg: 13, slopeVar: 2, halfWidth: 26, curve: 24,
    kickers: [{ size: 'small' }, { size: 'small' }, { size: 'medium' }],
    moguls: 0, glades: 1, cliffs: 0, ice: 0, arches: 0, treeDensity: 0.8, rockDensity: 0.4,
    timeOfDay: 0.3, par: 70,
  },
  {
    id: 'crete-du-loup', name: 'Crête du Loup', difficulty: 'medium', seed: 2047,
    length: 1500, slopeDeg: 18, slopeVar: 4, halfWidth: 20, curve: 30,
    kickers: [{ size: 'medium' }, { size: 'medium' }, { size: 'large' }],
    moguls: 1, glades: 2, cliffs: 1, ice: 0, arches: 1, treeDensity: 1, rockDensity: 0.7,
    timeOfDay: 0.52, par: 90,
  },
  {
    id: 'couloir-noir', name: 'Couloir Noir', difficulty: 'hard', seed: 3313,
    length: 1800, slopeDeg: 23, slopeVar: 5, halfWidth: 15, curve: 34,
    kickers: [{ size: 'medium' }, { size: 'large' }, { size: 'large' }],
    moguls: 2, glades: 2, cliffs: 2, ice: 2, arches: 1, treeDensity: 1.2, rockDensity: 1,
    timeOfDay: 0.8, par: 105,
  },
];

/**
 * The tutorial run (after the lift, before the station's free ride): straight and wide, a turn each way, a bump
 * across the whole piste to jump, a longer one for a backflip, a little forest to steer through, then a stop.
 * Its own run: the stations' mountains stay 1:1.
 */
export const TUTO_TRACK: TrackDef = {
  id: 'tuto', name: 'Tutorial', difficulty: 'easy', seed: 4711,
  length: 1000, slopeDeg: 10, slopeVar: 0, halfWidth: 22, curve: 0,
  kickers: [{ size: 'wide', z: 150 }, { size: 'wideLarge', z: 250 }],
  moguls: 0, glades: 1, cliffs: 0, ice: 0, arches: 0, treeDensity: 0.7, rockDensity: 0,
  timeOfDay: 0.708, par: 0,
};

export const trackById = (id: string): TrackDef => {
  if (id === TUTO_TRACK.id) return TUTO_TRACK;
  const st = stationOfTrack(id);
  return st ? freeDef(st) : TRACKS.find((t) => t.id === id) ?? TRACKS[0];
};
