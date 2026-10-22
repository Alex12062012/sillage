const mmss = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

export interface ChallengeRow { title: string; goal: string; value: string; tier: number }

/** In-run HUD: timer, score, progress, live challenges, speed, popups, speed vignette, hints. */
export class Hud {
  readonly el: HTMLDivElement;
  private speed: HTMLDivElement;
  private pops: HTMLDivElement;
  private vignette: HTMLDivElement;
  private hint: HTMLDivElement;
  private timer: HTMLDivElement;
  private score: HTMLDivElement;
  private bar: HTMLDivElement;
  private rows: HTMLDivElement;
  private ready: HTMLDivElement;
  private lastSpeed = -1;
  private lastRows = '';
  private lastTimer = '';
  private lastScore = -1;
  private lastBar = -1;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud-vignette"></div>
      <div class="hud-top">
        <div class="hud-left"><div class="hud-timer">0:00.0</div><div class="hud-bar"><i></i></div><div class="hud-rows"></div></div>
        <div class="hud-score">0</div>
      </div>
      <div class="hud-pops"></div>
      <div class="hud-ready"></div>
      <div class="hud-speed"></div>
      <div class="hud-hint"></div>`;
    parent.appendChild(this.el);
    const q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
    this.vignette = q('.hud-vignette');
    this.pops = q('.hud-pops');
    this.speed = q('.hud-speed');
    this.hint = q('.hud-hint');
    this.timer = q('.hud-timer');
    this.score = q('.hud-score');
    this.bar = q('.hud-bar i');
    this.rows = q('.hud-rows');
    this.ready = q('.hud-ready');
  }

  show(on: boolean): void {
    this.el.hidden = !on;
  }

  setSpeed(kmh: number): void {
    const v = Math.round(kmh);
    if (v === this.lastSpeed) return;
    this.lastSpeed = v;
    this.speed.innerHTML = `${v}<small>km/h</small>`;
    this.vignette.style.opacity = String(Math.min(1, Math.max(0, (kmh - 55) / 60)));
  }

  setRun(time: number, score: number, progress: number): void {
    const t = mmss(time);
    if (t !== this.lastTimer) { this.timer.textContent = t; this.lastTimer = t; }
    if (score !== this.lastScore) { this.score.textContent = score.toLocaleString('en-US'); this.lastScore = score; }
    const bar = Math.round(Math.max(0, Math.min(1, progress)) * 200);
    if (bar !== this.lastBar) { this.bar.style.width = `${bar / 2}%`; this.lastBar = bar; }
  }

  setChallenges(rows: ChallengeRow[]): void {
    const html = rows
      .map((r) => `<div class="hud-row"><span class="pips">${[1, 2, 3].map((i) => `<b class="${i <= r.tier ? `on t${i}` : ''}"></b>`).join('')}</span><span class="t">${r.title}</span><span class="g">${r.goal}</span><span class="v">${r.value}</span></div>`)
      .join('');
    if (html !== this.lastRows) {
      this.rows.innerHTML = html;
      this.lastRows = html;
    }
  }

  setReady(html: string | null): void {
    this.ready.innerHTML = html ?? '';
    this.ready.classList.toggle('show', !!html);
  }

  /** Short animated message; `kind` picks the colour (good / great / bad / info). */
  pop(text: string, kind: 'good' | 'great' | 'bad' | 'info' = 'good'): void {
    const p = document.createElement('div');
    p.className = `pop pop-${kind}`;
    p.textContent = text;
    this.pops.appendChild(p);
    while (this.pops.children.length > 3) this.pops.firstElementChild!.remove();
    window.setTimeout(() => p.remove(), 1400);
  }

  showHint(html: string, seconds: number): void {
    this.hint.innerHTML = html;
    this.hint.classList.add('show');
    window.setTimeout(() => this.hint.classList.remove('show'), seconds * 1000);
  }
}
