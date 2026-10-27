/**
 * A station's settings, its answers to the few questions it is asked when it signs up: real or generic
 * buildings, how busy the pistes are, the slopes as they are, steeper for fun, or as remembered (the blacks
 * steeper). One JSON per station (src/stations/<id>.config.json); a sales demo can override them in the URL.
 */
export type BuildingsMode = 'real' | 'generic';
export type CrowdLevel = 'busy' | 'some' | 'none';
export type SlopesMode = 'real' | 'fun' | 'memory';

export interface StationConfig { buildings: BuildingsMode; crowd: CrowdLevel; slopes: SlopesMode }

export const DEFAULT_CONFIG: StationConfig = { buildings: 'real', crowd: 'busy', slopes: 'real' };

const VALUES: { [K in keyof StationConfig]: readonly StationConfig[K][] } = {
  buildings: ['real', 'generic'],
  crowd: ['busy', 'some', 'none'],
  slopes: ['real', 'fun', 'memory'],
};

const pick = <K extends keyof StationConfig>(k: K, v: unknown, base: StationConfig): StationConfig[K] =>
  (VALUES[k] as readonly unknown[]).includes(v) ? (v as StationConfig[K]) : base[k];

/** Each valid field of `raw`, the others from `base`. */
export function parseConfig(raw: unknown, base: StationConfig): StationConfig {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return { buildings: pick('buildings', o.buildings, base), crowd: pick('crowd', o.crowd, base), slopes: pick('slopes', o.slopes, base) };
}

/** `?buildings=…&crowd=…&slopes=…` over `base`. */
export function configFromUrl(params: URLSearchParams, base: StationConfig): StationConfig {
  return parseConfig({ buildings: params.get('buildings'), crowd: params.get('crowd'), slopes: params.get('slopes') }, base);
}
