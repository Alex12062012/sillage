import type { TrackDef } from './track';

/** A ski area baked by scripts/bake-station.mjs (metres, x east, z south; see that script for the encodings). */
export interface StationData {
  origin: number[];
  grid: { x0: number; z0: number; step: number; nx: number; nz: number; base: number; unit?: number; h: string; forest: string };
  around: { x0: number; z0: number; step: number; nx: number; nz: number; h: string };
  pistes: { name: string; diff: string; area?: boolean; pts: number[] }[];
  lifts: { name: string; kind: string; seats: number; pts: number[] }[];
  roads: number[][];
  /** x, z, width, depth, yaw, levels. */
  buildings: number[][];
  radar: number[] | null;
  peaks: (string | number | null)[][];
}

export interface Station {
  id: string;
  /** Track id of its free ride ('free', Les Rousses, was the only one). */
  trackId: string;
  name: string;
  area: string;
  /** The large-scale relief steepened STEEP times above H0 (1: as it is). */
  steep: number;
  h0: number;
  /** You start in this lift's queue; T takes you to the top of `summit` (`summitName` on the hint). */
  start: string;
  summit: string;
  summitName: string;
  seed: number;
  /** For the menu: km of pistes, lifts, real altitudes. */
  km: number;
  lifts: number;
  alt: [number, number];
  /** Camera far plane (m) and haze reach (× view distance): the Léman from La Dôle, Mont Blanc from Avoriaz. */
  far: number;
  haze: number;
  load(): Promise<StationData>;
}

export const STATIONS: Station[] = [
  {
    id: 'rousses', trackId: 'free', name: 'Les Rousses', area: 'Jura · Dôle-Tuffes', steep: 2.3, h0: 1160,
    start: 'Jouvenceaux', summit: 'Dappes', summitName: 'La Dôle', seed: 4242, km: 36, lifts: 22, alt: [1120, 1677], far: 40000, haze: 50,
    load: () => import('./rousses-data').then((d) => d.ROUSSES),
  },
  {
    id: 'avoriaz', trackId: 'free-avoriaz', name: 'Avoriaz', area: 'Portes du Soleil · from Morzine to the Swiss Wall', steep: 1, h0: 0,
    start: 'Super-Morzine', summit: 'Mossettes', summitName: 'Les Mossettes', seed: 7474, km: 87, lifts: 37, alt: [960, 2466], far: 70000, haze: 120,
    load: () => import('./avoriaz-data').then((d) => d.AVORIAZ),
  },
];

export const stationOfTrack = (trackId: string): Station | undefined => STATIONS.find((s) => s.trackId === trackId);

/** The open mountain as a run: no clock, no finish, everything unlocked. */
export const freeDef = (s: Station): TrackDef => ({
  id: s.trackId, name: s.name, difficulty: 'easy', seed: s.seed, length: Infinity, slopeDeg: 18, slopeVar: 0,
  halfWidth: 14, curve: 0, kickers: [], moguls: 0, glades: 0, cliffs: 0, ice: 0, arches: 0, treeDensity: 1, rockDensity: 1,
  timeOfDay: 0.5, par: 0,
});

const cache = new Map<string, StationData>();

/** The station's data, fetched once (each station is its own chunk: the arcade runs never download them). */
export async function loadStation(s: Station): Promise<StationData> {
  let d = cache.get(s.id);
  if (!d) cache.set(s.id, (d = await s.load()));
  return d;
}

/** The station's data if it was loaded already. */
export const loadedStation = (s: Station): StationData | undefined => cache.get(s.id);
