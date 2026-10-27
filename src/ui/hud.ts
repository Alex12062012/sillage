import { TUNING as T } from '../tuning';

const mmss = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

export interface ChallengeRow { title: string; goal: string; value: string; tier: number }

/** Flow level names (level 1..4); level 4 is the game's name, earned. */
export const FLOW_NAMES = ['', 'Flow', 'Groove', 'In the zone', 'Sillage!'];

/** Restart a CSS animation on `el` by toggling `cls` (forces a reflow in between). */
function retrigger(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/**
 * In-run HUD: timer, rolling score with a "+gain" pill, progress, live challenges, speed, flow meter and
 * carve streak, live trick readout in the air, popups, screen flashes, speed vignette, hints.
 */
export class Hud {
  readonly el: HTMLDivElement;
  private speed: HTMLDivElement;
  private pops: HTMLDivElement;
  private vignette: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private hint: HTMLDivElement;
  private timer: HTMLDivElement;
  private score: HTMLDivElement;
  private gainEl: HTMLDivElement;
  private bar: HTMLDivElement;
  private rows: HTMLDivElement;
  private ready: HTMLDivElement;
  private trickEl: HTMLDivElement;
  private flowEl: HTMLDivElement;
  private flowSegs: HTMLElement[];
  private flowName: HTMLElement;
  private streakEl: HTMLElement;
  private lastSpeed = -1;
  private lastRows = '';
  private lastTimer = '';
  private lastBar = -1;
  private shown = 0;
  private target = 0;
  private gain = 0;
  private gainT = 0;
  private lastTrick = '';
  private lastFlow = '';
  private boardEl: HTMLDivElement;
  private liftEl: HTMLDivElement;
  private liftFill: HTMLElement;
  private lastBoard = '';
  private lastLift = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud-vignette"></div>
      <div class="hud-flash"></div>
      <div class="hud-top">
        <div class="hud-left"><div class="hud-timer">0:00.0</div><div class="hud-bar"><i></i></div><div class="hud-rows"></div></div>
        <div class="hud-right"><div class="hud-score">0</div><div class="hud-gain"></div></div>
      </div>
      <div class="hud-trick"></div>
      <div class="hud-pops"></div>
      <div class="hud-ready"></div>
      <div class="hud-bottom">
        <div class="hud-flow l0"><span class="hud-streak"></span><span class="segs"><i></i><i></i><i></i><i></i></span><b class="name"></b></div>
        <div class="hud-speed"></div>
      </div>
      <div class="hud-board"></div>
      <div class="hud-lift"><i></i><span></span></div>
      <div class="hud-hint"></div>`;
    parent.appendChild(this.el);
    const q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
    this.vignette = q('.hud-vignette');
    this.flashEl = q('.hud-flash');
    this.pops = q('.hud-pops');
    this.speed = q('.hud-speed');
    this.hint = q('.hud-hint');
    this.timer = q('.hud-timer');
    this.score = q('.hud-score');
    this.gainEl = q('.hud-gain');
    this.bar = q('.hud-bar i');
    this.rows = q('.hud-rows');
    this.ready = q('.hud-ready');
    this.trickEl = q('.hud-trick');
    this.flowEl = q('.hud-flow');
    this.flowSegs = [...this.flowEl.querySelectorAll<HTMLElement>('.segs i')];
    this.flowName = q('.hud-flow .name');
    this.streakEl = q('.hud-streak');
    this.boardEl = q('.hud-board');
    this.liftEl = q('.hud-lift');
    this.liftFill = q('.hud-lift i');
  }

  /** Free ride, at a lift's bottom station: "Space · ride <lift>" (html), or null. */
  board(html: string | null): void {
    if ((html ?? '') === this.lastBoard) return;
    this.lastBoard = html ?? '';
    this.boardEl.innerHTML = this.lastBoard;
    this.boardEl.classList.toggle('show', !!html);
  }

  /** Riding a lift: a bar filling up to the top (f 0..1), the key that speeds it up in the middle; null hides it. */
  lift(f: number | null, label = '', fast = false): void {
    const key = f === null ? '' : `${Math.round(f * 400)}|${label}|${fast}`;
    if (key === this.lastLift) return;
    this.lastLift = key;
    this.liftEl.classList.toggle('show', f !== null);
    if (f === null) return;
    this.liftFill.style.width = `${(Math.min(1, Math.max(0, f)) * 100).toFixed(2)}%`;
    this.liftEl.classList.toggle('fast', fast);
    const span = this.liftEl.querySelector('span')!;
    if (span.textContent !== label) span.textContent = label;
  }

  show(on: boolean): void {
    this.el.hidden = !on;
  }

  setSpeed(kmh: number): void {
    const v = Math.round(kmh);
    if (v === this.lastSpeed) return;
    this.lastSpeed = v;
    this.speed.innerHTML = `${v}<small>km/h</small>`;
    this.speed.classList.toggle('hot', v >= 125); // a peak, not the cruise (free ride cruises at 100–110)
    this.vignette.style.opacity = String(T.fxVignette * Math.min(1, Math.max(0, (kmh - T.fxLinesFrom) / (T.fxLinesFull - T.fxLinesFrom))));
    this.speed.style.setProperty('--heat', String(Math.min(1, Math.max(0, (kmh - 60) / 60)).toFixed(2)));
  }

  /** Crossing 100 / 120 km/h: the readout flares (`gentle`: brightness only, no pop). */
  speedFlash(gentle: boolean): void {
    this.speed.animate([{ filter: 'brightness(1.9) drop-shadow(0 0 12px #ffb35c)', ...(gentle ? {} : { transform: 'scale(1.45)' }) }, {}], { duration: 500, easing: 'ease-out' });
  }

  /** Per frame. The score rolls up toward the real value; returns true while it is rolling (score tick). */
  setRun(time: number, score: number, progress: number, dt: number): boolean {
    const t = mmss(time);
    if (t !== this.lastTimer) { this.timer.textContent = t; this.lastTimer = t; }
    const bar = Math.round(Math.max(0, Math.min(1, progress)) * 200);
    if (bar !== this.lastBar) { this.bar.style.width = `${bar / 2}%`; this.lastBar = bar; }

    if (score < this.target) { // restart: no roll-down
      this.shown = this.target = score;
      this.gain = this.gainT = 0;
      this.gainEl.classList.remove('show');
    }
    if (score > this.target) {
      const d = score - this.target;
      if (d >= 50) {
        this.gain += d;
        this.gainT = 1.2;
        this.gainEl.textContent = `+${this.gain.toLocaleString('en-US')}`;
        retrigger(this.gainEl, 'show');
        if (d >= 200) retrigger(this.score, 'bump');
      }
      this.target = score;
    }
    if (this.gainT > 0 && (this.gainT -= dt) <= 0) { this.gain = 0; this.gainEl.classList.remove('show'); }
    const before = Math.round(this.shown);
    if (this.shown < score) this.shown = Math.min(score, this.shown + Math.max(dt * 40, (score - this.shown) * (1 - Math.exp(-dt / 0.22))));
    const now = Math.round(this.shown);
    if (now !== before || this.score.textContent === '') this.score.textContent = now.toLocaleString('en-US');
    return score - now >= 20;
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

  /** Flow meter: value 0..1 across 4 segments, level 0..4, carve streak. */
  setFlow(value: number, level: number, streak: number): void {
    const key = `${level}|${Math.round(value * 40)}|${streak}`;
    if (key === this.lastFlow) return;
    this.lastFlow = key;
    this.flowEl.className = `hud-flow l${level}`;
    this.flowSegs.forEach((s, i) => s.style.setProperty('--fill', String(Math.max(0, Math.min(1, value * 4 - i)).toFixed(2))));
    this.flowName.textContent = FLOW_NAMES[level];
    this.streakEl.textContent = streak >= 2 ? `Carve ×${streak}` : '';
  }

  /** A clean beat: the meter and the streak counter pulse. */
  beat(): void {
    retrigger(this.flowEl, 'pulse');
    if (this.streakEl.textContent) retrigger(this.streakEl, 'bump');
  }

  /** Live trick readout while airborne ("540 · Grab"); null hides it. Changes pop. */
  trick(text: string | null): void {
    if ((text ?? '') === this.lastTrick) return;
    this.lastTrick = text ?? '';
    this.trickEl.textContent = this.lastTrick;
    if (text) retrigger(this.trickEl, 'show');
    else this.trickEl.classList.remove('show');
  }

  /** Short animated message; `kind` picks the colour (good / great / bad / info); `sub` is a smaller second line. */
  pop(text: string, kind: 'good' | 'great' | 'bad' | 'info' = 'good', sub?: string): void {
    const p = document.createElement('div');
    p.className = `pop pop-${kind}`;
    p.textContent = text;
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      p.appendChild(s);
    }
    this.pops.appendChild(p);
    while (this.pops.children.length > 3) this.pops.firstElementChild!.remove();
    window.setTimeout(() => p.remove(), 1500);
  }

  /** Full-screen flash: warm for a perfect landing, cool for a razor pass, red for a crash. */
  flash(kind: 'perfect' | 'razor' | 'crash', strength = 1): void {
    this.flashEl.className = `hud-flash ${kind}`;
    this.flashEl.style.setProperty('--a', String(Math.min(1, strength).toFixed(2)));
    retrigger(this.flashEl, 'go');
  }

  showHint(html: string, seconds: number): void {
    this.hint.innerHTML = html;
    this.hint.classList.add('show');
    window.setTimeout(() => this.hint.classList.remove('show'), seconds * 1000);
  }
}
