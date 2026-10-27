import { describe, expect, it } from 'vitest';
import { configFromUrl, DEFAULT_CONFIG, parseConfig } from '../../src/sim/stationConfig';
import { STATIONS } from '../../src/sim/stations';

describe('station config', () => {
  it('keeps each valid field and falls back on the others', () => {
    expect(parseConfig({ slopes: 'memory' }, DEFAULT_CONFIG)).toEqual({ buildings: 'real', crowd: 'busy', slopes: 'memory' });
  });

  it('ignores invalid values and non-objects', () => {
    expect(parseConfig({ slopes: 'steep', crowd: 3 }, DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
    expect(parseConfig(null, DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
    expect(parseConfig('x', DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
  });

  it('reads the URL over the station config', () => {
    expect(configFromUrl(new URLSearchParams('crowd=none&slopes=oops'), DEFAULT_CONFIG)).toEqual({ ...DEFAULT_CONFIG, crowd: 'none' });
  });

  it('Les Rousses ships the default settings', () => {
    expect(STATIONS[0].config).toEqual(DEFAULT_CONFIG);
  });
});
