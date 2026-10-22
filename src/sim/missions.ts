/**
 * Three challenges per run, each with bronze / silver / gold tiers (1–3 stars), Grand-Mountain style:
 * difficulty rises by tightening thresholds, never by adding rules. Thresholds are calibrated on bot
 * runs (docs/DECISIONS.md): bronze ≈ a cautious descent, silver ≈ a brisk one, gold = skilled play.
 */
export type ChallengeKind = 'race' | 'speed' | 'air' | 'chain' | 'spin' | 'clean' | 'score';

export interface Challenge {
  id: string;
  kind: ChallengeKind;
  /** bronze, silver, gold */
  tiers: [number, number, number];
  lowerIsBetter?: boolean;
}

/** What a run produced, as the challenges see it. */
export interface RunStats {
  finished: boolean;
  time: number;
  topKmh: number;
  longestJump: number;
  bestChain: number;
  bestSpin: number;
  crashes: number;
  score: number;
}

export const CHALLENGES: Record<string, Challenge[]> = {
  'combe-douce': [
    { id: 'cd-race', kind: 'race', tiers: [100, 74, 60], lowerIsBetter: true },
    { id: 'cd-speed', kind: 'speed', tiers: [55, 70, 85] },
    { id: 'cd-air', kind: 'air', tiers: [12, 20, 30] },
  ],
  'crete-du-loup': [
    { id: 'cl-race', kind: 'race', tiers: [135, 100, 80], lowerIsBetter: true },
    { id: 'cl-chain', kind: 'chain', tiers: [1, 3, 5] },
    { id: 'cl-spin', kind: 'spin', tiers: [180, 360, 720] },
  ],
  'couloir-noir': [
    { id: 'cn-race', kind: 'race', tiers: [165, 120, 96], lowerIsBetter: true },
    { id: 'cn-clean', kind: 'clean', tiers: [2, 1, 0], lowerIsBetter: true },
    { id: 'cn-score', kind: 'score', tiers: [3500, 7000, 11000] },
  ],
};

const NEEDS_FINISH: Record<ChallengeKind, boolean> = {
  race: true, clean: true, score: true, speed: false, air: false, chain: false, spin: false,
};

function valueOf(c: Challenge, s: RunStats): number {
  switch (c.kind) {
    case 'race': return s.time;
    case 'speed': return s.topKmh;
    case 'air': return s.longestJump;
    case 'chain': return s.bestChain;
    case 'spin': return s.bestSpin;
    case 'clean': return s.crashes;
    case 'score': return s.score;
  }
}

/** Tier reached (0–3) by a run; challenges that need the finish line return 0 for unfinished runs. */
export function tierOf(c: Challenge, s: RunStats): number {
  if (NEEDS_FINISH[c.kind] && !s.finished) return 0;
  const v = valueOf(c, s);
  let tier = 0;
  for (let i = 0; i < 3; i++) if (c.lowerIsBetter ? v <= c.tiers[i] : v >= c.tiers[i]) tier = i + 1;
  return tier;
}

/** Tier already secured during the run (for live medal pops): only challenges that don't need the finish. */
export function liveTier(c: Challenge, s: RunStats): number {
  return NEEDS_FINISH[c.kind] ? 0 : tierOf({ ...c }, { ...s, finished: true });
}

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Player-facing text for a tier (1–3). */
export function describeChallenge(c: Challenge, tier: number): string {
  const v = c.tiers[Math.max(0, Math.min(2, tier - 1))];
  switch (c.kind) {
    case 'race': return `Finish under ${mmss(v)}`;
    case 'speed': return `Reach ${v} km/h`;
    case 'air': return `Jump ${v} m`;
    case 'chain': return v === 1 ? 'Land a near-miss' : `Chain ${v} near-misses`;
    case 'spin': return v === 180 ? 'Land a 180 (switch)' : `Land a ${v}`;
    case 'clean': return v === 0 ? 'Finish without crashing' : `Finish with ≤ ${v} crash${v > 1 ? 'es' : ''}`;
    case 'score': return `Score ${v.toLocaleString('en-US')}`;
  }
}

/** Short title of a challenge (menus, HUD). */
export const CHALLENGE_TITLE: Record<ChallengeKind, string> = {
  race: 'Race', speed: 'Top speed', air: 'Big air', chain: 'Close calls', spin: 'Spin', clean: 'Clean run', score: 'Score',
};

/** Current value formatted for the HUD progress line. */
export function progressText(c: Challenge, s: RunStats): string {
  switch (c.kind) {
    case 'race': return mmss(s.time);
    case 'speed': return `${Math.round(s.topKmh)} km/h`;
    case 'air': return `${s.longestJump.toFixed(1)} m`;
    case 'chain': return `×${s.bestChain}`;
    case 'spin': return s.bestSpin ? `${s.bestSpin}` : '—';
    case 'clean': return `${s.crashes} crash${s.crashes === 1 ? '' : 'es'}`;
    case 'score': return s.score.toLocaleString('en-US');
  }
}
