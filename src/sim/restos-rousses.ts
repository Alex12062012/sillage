import type { RestoDef } from './restos';

/**
 * Les Rousses, Dôle-Tuffes: the ski area's restaurants (checked 2026-10-27 against OSM, the resort's site and
 * Google Maps). Footprints from the OSM outlines, eaves / ridge from IGN BD TOPO (French side), the look noted
 * by hand from photos. Left out: Jura-Track (an activity in Le Poyet's building), Bar de la Dôle and Le Lapin
 * Blanc (not found reliably).
 */
export const ROUSSES_RESTOS: RestoDef[] = [
  { id: 'poyet', name: 'Le Poyet', kind: 'restaurant', lat: 46.445727, lon: 6.06696, w: 11.9, d: 15.1, yaw: -1.615, eave: 6.6, ridge: 10, roof: 'gable', wall: 'wood', wallColor: 0x8a5a33, roofColor: 0x5a4a42, trim: 0xd9c9a8, terrace: true, source: 'ign' },
  { id: 'telemark', name: "Telemark'Afé", kind: 'restaurant', lat: 46.447511, lon: 6.077226, w: 12.9, d: 27.6, yaw: -1.953, eave: 4.9, ridge: 9.6, roof: 'gable', wall: 'wood', wallColor: 0x9b6b3f, roofColor: 0x6b5d55, trim: 0xe8dcc0, terrace: true, source: 'ign' },
  { id: 'tuffes', name: 'Bistrot du Chalet des Tuffes', kind: 'restaurant', lat: 46.450362, lon: 6.075606, website: 'https://chaletlestuffes.ffcam.fr/', w: 11.7, d: 28.5, yaw: -1.258, eave: 5.8, ridge: 7.6, roof: 'gable', wall: 'wood', wallColor: 0x4f5a63, roofColor: 0x3d4146, trim: 0xf2f2f0, terrace: true, source: 'ign' },
  { id: 'cotedole', name: 'Snack Côté Dôle', kind: 'snack', lat: 46.446705, lon: 6.081768, w: 28.1, d: 66.5, yaw: 0.764, eave: 10, ridge: 13.7, roof: 'gable', wall: 'render', wallColor: 0xe9e2d2, roofColor: 0x6a4a3a, trim: 0x5a3a24, terrace: true, source: 'ign' },
  { id: 'trolles', name: 'Chalet des Trolles', kind: 'hut', lat: 46.458841, lon: 6.067504, w: 14.8, d: 41.2, yaw: 1.933, eave: 6.5, ridge: 9.4, roof: 'gable', wall: 'wood', wallColor: 0xc9ccc9, roofColor: 0x5c5f63, trim: 0xf4f4f2, terrace: false, source: 'ign' },
  { id: 'eldorado', name: "L'Eldorado", kind: 'snack', lat: 46.455411, lon: 6.053541, w: 58.4, d: 50.2, yaw: -2.887, eave: 15.8, ridge: 17.8, roof: 'flat', wall: 'render', wallColor: 0xeeeeea, roofColor: 0x8a8f94, trim: 0xc8342c, terrace: true, source: 'ign' },
  { id: 'taverne', name: 'La Taverne', kind: 'restaurant', lat: 46.45553, lon: 6.056478, w: 10.8, d: 12.6, yaw: 2.273, eave: 4.8, ridge: 9.6, roof: 'gable', wall: 'render', wallColor: 0xf1efe9, roofColor: 0x6e4a35, trim: 0x7a4a2a, terrace: true, source: 'ign' },
  { id: 'illico', name: 'Illico resto', kind: 'restaurant', lat: 46.455856, lon: 6.055603, w: 12.1, d: 24.6, yaw: -0.837, eave: 6, ridge: 10.8, roof: 'gable', wall: 'wood', wallColor: 0x8e6440, roofColor: 0x5d5550, trim: 0xe5d8bd, terrace: true, source: 'ign' },
  { id: 'arbezie', name: "L'Arbezie Franco-Suisse", kind: 'restaurant', lat: 46.464279, lon: 6.073019, website: 'https://arbezie.com/', w: 30.8, d: 22, yaw: 1.79, eave: 10.6, ridge: 15, roof: 'gable', wall: 'render', wallColor: 0xefe6d2, roofColor: 0x55504c, trim: 0xc0392b, terrace: false, source: 'ign' },
  { id: 'mamac', name: 'Chez Mamac', kind: 'restaurant', lat: 46.465987, lon: 6.078769, w: 17.6, d: 18.4, yaw: -0.761, eave: 6.1, ridge: 10, roof: 'gable', wall: 'wood', wallColor: 0x5e3b22, roofColor: 0x4a3c34, trim: 0xd23b3b, terrace: true, source: 'ign' },
  { id: 'cuvaloup', name: 'Cuvaloup de Crans', kind: 'restaurant', lat: 46.441134, lon: 6.093105, website: 'https://www.cuvaloup-de-crans.ch/', w: 13.3, d: 25.5, yaw: -0.753, eave: 5, ridge: 10, roof: 'gable', wall: 'stone', wallColor: 0xd8cfbf, roofColor: 0x6f7276, trim: 0x6b4a2e, terrace: true, source: 'photo' },
];
