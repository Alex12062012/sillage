/**
 * The places to eat on a ski area, drawn as the real buildings: where they stand (OSM), their footprint (OSM
 * outline), their eaves and ridge (IGN BD TOPO, or estimated from photos), their look (noted by hand from photos:
 * nothing copied). Placed into the station's local frame by makeMountain.
 */
export interface RestoDef {
  id: string;
  name: string;
  kind: 'restaurant' | 'cafe' | 'bar' | 'snack' | 'hut';
  /** The building's centre. */
  lat: number;
  lon: number;
  website?: string;
  /** Footprint (m) and its yaw (rad, in the game's frame: the bake's oriented box). */
  w: number;
  d: number;
  yaw: number;
  /** Heights above the ground (m): eaves, ridge. */
  eave: number;
  ridge: number;
  roof: 'gable' | 'hip' | 'flat';
  wall: 'wood' | 'render' | 'stone';
  wallColor: number;
  roofColor: number;
  /** Shutters, frames, balconies. */
  trim: number;
  terrace: boolean;
  /** Which way the sign faces (rad); by default towards the nearest piste. */
  signYaw?: number;
  /** Where the heights come from. */
  source: 'ign' | 'photo';
}

export interface Resto extends RestoDef {
  x: number;
  z: number;
  /** The lowest ground under the footprint: the building's plinth goes down to it. */
  y: number;
  /** The highest: the ground floor stands there (nothing buried on the uphill side). */
  floor: number;
  signYaw: number;
}

/** The bake's local frame (scripts/bake-station.mjs): metres, x east, z south, from the station's origin. */
export function toLocal(origin: number[], lat: number, lon: number): [number, number] {
  const [lat0, lon0] = origin;
  const my = 111195, mx = 111195 * Math.cos((lat0 * Math.PI) / 180);
  return [(lon - lon0) * mx, (lat0 - lat) * my];
}
