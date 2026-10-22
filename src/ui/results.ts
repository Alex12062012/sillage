import { CHALLENGE_TITLE, CHALLENGES, describeChallenge, tierOf, type RunStats } from '../sim/missions';
import { COSMETICS, type MedalGain, type TrackRecord } from '../sim/progress';
import type { TrackDef } from '../sim/track';

const mmss = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const TIER = ['—', 'Bronze', 'Silver', 'Gold'];

export interface ResultsData {
  track: TrackDef;
  stats: RunStats;
  previous: TrackRecord | undefined;
  medals: Record<string, number>;
  gained: MedalGain[];
  unlockedRuns: TrackDef[];
  starsBefore: number;
  starsAfter: number;
  hasNext: boolean;
}

/** End-of-run screen: time, score, records, medals (new ones animate), unlocks, instant retry. */
export function showResults(parent: HTMLElement, d: ResultsData, on: { retry(): void; next(): void; menu(): void }): HTMLElement {
  const s = d.stats;
  const newTime = s.finished && (d.previous?.bestTime == null || s.time < d.previous.bestTime);
  const newScore = s.finished && s.score > (d.previous?.bestScore ?? 0);
  const outfits = COSMETICS.filter((c) => c.stars > d.starsBefore && c.stars <= d.starsAfter);
  const rows = (CHALLENGES[d.track.id] ?? []).map((c) => {
    const tier = d.medals[c.id] ?? 0;
    const got = d.gained.find((g) => g.challengeId === c.id);
    const run = tierOf(c, s);
    return `<li class="${got ? 'gain' : ''}">
      <span class="pips">${[1, 2, 3].map((i) => `<b class="${i <= tier ? `on t${i}` : ''} ${got && i > got.from && i <= got.to ? 'new' : ''}"></b>`).join('')}</span>
      <span class="t">${CHALLENGE_TITLE[c.kind]}</span>
      <span class="g">${tier < 3 ? `Next: ${describeChallenge(c, tier + 1)}` : 'Maxed out'}</span>
      <span class="r">${got ? `${TIER[got.to]}!` : run ? TIER[run] : ''}</span>
    </li>`;
  });
  const el = document.createElement('div');
  el.className = 'screen results';
  el.innerHTML = `
    <div class="card">
      <h2>${s.finished ? 'Finish!' : 'Run over'} <small>${d.track.name}</small></h2>
      <div class="big">${s.finished ? mmss(s.time) : '—'} ${newTime ? '<em>New record</em>' : ''}</div>
      <div class="grid">
        <div><span>Score</span><b>${s.score.toLocaleString('en-US')}</b>${newScore ? '<em>Best</em>' : ''}</div>
        <div><span>Top speed</span><b>${Math.round(s.topKmh)} km/h</b></div>
        <div><span>Best jump</span><b>${s.longestJump.toFixed(1)} m</b></div>
        <div><span>Best chain</span><b>×${s.bestChain}</b></div>
        <div><span>Best spin</span><b>${s.bestSpin || '—'}</b></div>
        <div><span>Crashes</span><b>${s.crashes}</b></div>
      </div>
      <ul class="challenges">${rows.join('')}</ul>
      <div class="stars">★ ${d.starsAfter} / 27 ${d.starsAfter > d.starsBefore ? `<em>+${d.starsAfter - d.starsBefore}</em>` : ''}</div>
      ${d.unlockedRuns.map((t) => `<div class="unlock">New run unlocked: <b>${t.name}</b></div>`).join('')}
      ${outfits.map((o) => `<div class="unlock">New outfit: <b>${o.name}</b></div>`).join('')}
      <div class="buttons">
        <button class="primary" data-act="retry">Retry <kbd>R</kbd></button>
        ${d.hasNext ? '<button data-act="next">Next run</button>' : ''}
        <button data-act="menu">Menu</button>
      </div>
    </div>`;
  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest('button')?.dataset.act;
    if (act === 'retry') on.retry();
    if (act === 'next') on.next();
    if (act === 'menu') on.menu();
  });
  parent.appendChild(el);
  (el.querySelector('button.primary') as HTMLButtonElement).focus();
  return el;
}
