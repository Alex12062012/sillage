import { CHALLENGE_TITLE, CHALLENGES, describeChallenge } from '../sim/missions';
import { COSMETICS, isUnlocked, starsOf, totalStars, UNLOCK, type Save, type Settings } from '../sim/progress';
import { TRACKS } from '../sim/tracks';

const mmss = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const DIFF = { easy: 'Blue · easy', medium: 'Red · medium', hard: 'Black · hard' } as const;
const MOOD = (t: number) => (t < 0.4 ? 'morning' : t < 0.7 ? 'midday' : 'golden hour');
export const isTouch = () => matchMedia('(pointer: coarse)').matches;

export interface MenuActions {
  save(): Save;
  play(trackId: string): void;
  setOutfit(id: string): void;
  setSettings(s: Settings): void;
  enableTilt(): Promise<boolean>;
  resetProgress(): void;
  click(): void;
}

/** DOM menus over the attract-mode background: main, run select, locker, settings, pause. */
export class Menus {
  private el: HTMLDivElement;
  current: string | null = null;

  constructor(parent: HTMLElement, private a: MenuActions) {
    this.el = document.createElement('div');
    this.el.className = 'screen menu-root';
    this.el.hidden = true;
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b && !b.disabled) this.a.click();
    });
  }

  hide(): void {
    this.el.hidden = true;
    this.current = null;
  }

  private open(name: string, html: string, focus = 'button:not([disabled])'): void {
    this.current = name;
    this.el.hidden = false;
    this.el.className = `screen menu-root ${name}`;
    this.el.innerHTML = html;
    (this.el.querySelector(focus) as HTMLElement | null)?.focus();
  }

  private on(sel: string, fn: (el: HTMLElement) => void): void {
    this.el.querySelectorAll<HTMLElement>(sel).forEach((el) => el.addEventListener('click', () => fn(el)));
  }

  main(): void {
    const s = this.a.save();
    const hint = isTouch()
      ? 'Hold left / right to carve · both thumbs to tuck · swipe ↑ to jump · swipe ↓ to brake'
      : '← → carve · ↑ tuck · ↓ brake · Space jump · R restart · Esc pause';
    this.open('main', `
      <div class="menu">
        <div class="brand"><h1>Sillage</h1><p>Carve your line.</p></div>
        <div class="stack">
          <button class="primary big" data-go="select">Play</button>
          <button data-go="locker">Locker</button>
          <button data-go="settings">Settings</button>
        </div>
        <div class="foot"><b>★ ${totalStars(s)} / 27</b><span>${hint}</span></div>
        ${isTouch() && innerHeight > innerWidth ? '<div class="rotate">↻ Turn your phone sideways for a wider view</div>' : ''}
      </div>`);
    this.on('[data-go="select"]', () => this.select());
    this.on('[data-go="locker"]', () => this.locker());
    this.on('[data-go="settings"]', () => this.settings(() => this.main()));
  }

  select(): void {
    const s = this.a.save();
    const cards = TRACKS.map((t) => {
      const open = isUnlocked(s, t.id);
      const rec = s.records[t.id];
      const pips = (CHALLENGES[t.id] ?? []).map((c) => {
        const tier = s.medals[c.id] ?? 0;
        return `<div class="ch"><span class="pips">${[1, 2, 3].map((i) => `<b class="${i <= tier ? `on t${i}` : ''}"></b>`).join('')}</span>${CHALLENGE_TITLE[c.kind]}<small>${tier < 3 ? describeChallenge(c, tier + 1) : 'Gold ✓'}</small></div>`;
      }).join('');
      return `<button class="run-card ${t.difficulty}" data-run="${t.id}" ${open ? '' : 'disabled'}>
        <span class="chip"></span>
        <b>${t.name}</b>
        <small>${DIFF[t.difficulty]} · ${(t.length / 1000).toFixed(1)} km · ${MOOD(t.timeOfDay)}</small>
        ${open ? `<div class="chs">${pips}</div><span class="rec">★ ${starsOf(s, t.id)} / 9${rec?.bestTime != null ? ` · best ${mmss(rec.bestTime)}` : ''}${rec?.bestScore ? ` · ${rec.bestScore.toLocaleString('en-US')} pts` : ''}</span>`
        : `<span class="lock">Locked · ${UNLOCK[t.id]} ★ to open (you have ${totalStars(s)})</span>`}
      </button>`;
    }).join('');
    this.open('select', `<div class="menu wide"><h2>Choose a run</h2><div class="cards">${cards}</div><div class="buttons"><button data-go="main">Back</button></div></div>`);
    this.on('[data-run]', (b) => this.a.play(b.dataset.run!));
    this.on('[data-go="main"]', () => this.main());
  }

  locker(): void {
    const s = this.a.save();
    const stars = totalStars(s);
    const items = COSMETICS.map((o) => {
      const open = stars >= o.stars;
      const sw = [o.jacket, o.pants, o.helmet, o.skis].map((c) => `<i style="background:${hex(c)}"></i>`).join('');
      return `<button class="outfit ${s.outfit === o.id ? 'sel' : ''}" data-outfit="${o.id}" ${open ? '' : 'disabled'}>
        <span class="sw">${sw}</span><b>${o.name}</b><small>${open ? (s.outfit === o.id ? 'Wearing' : 'Wear') : `${o.stars} ★`}</small></button>`;
    }).join('');
    this.open('locker', `<div class="menu wide"><h2>Locker <small>★ ${stars} / 27</small></h2><div class="outfits">${items}</div><div class="buttons"><button data-go="main">Back</button></div></div>`, '.outfit.sel');
    this.on('[data-outfit]', (b) => { this.a.setOutfit(b.dataset.outfit!); this.locker(); });
    this.on('[data-go="main"]', () => this.main());
  }

  settings(back: () => void, focus?: string): void {
    const st = { ...this.a.save().settings };
    const seg = (key: keyof Settings, opts: [string, string][]) =>
      `<span class="seg">${opts.map(([v, l]) => `<button data-set="${key}" data-val="${v}" class="${String(st[key]) === v ? 'on' : ''}">${l}</button>`).join('')}</span>`;
    const tog = (key: keyof Settings) => `<button class="tog ${st[key] ? 'on' : ''}" data-tog="${key}" aria-pressed="${!!st[key]}">${st[key] ? 'On' : 'Off'}</button>`;
    this.open('settings', `
      <div class="menu wide settings">
        <h2>Settings</h2>
        <div class="rows">
          <label>Graphics ${seg('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])}</label>
          <label>Steering sensitivity <input type="range" min="0.6" max="1.4" step="0.05" value="${st.sensitivity}" data-range="sensitivity"></label>
          <label>Volume <input type="range" min="0" max="1" step="0.05" value="${st.volume}" data-range="volume"></label>
          <label>Music ${tog('music')}</label>
          <label>Camera ${seg('camera', [['chase', 'Chase'], ['helmet', 'Helmet']])}</label>
          <label>Comfort mode <small>fixed FOV, no shake or roll</small> ${tog('comfort')}</label>
          ${isTouch() ? `<label>Left-handed <small>mirrors the touch buttons</small> ${tog('leftHanded')}</label>
          <label>Tilt to steer ${tog('tilt')}</label>` : ''}
          <label>Vibration <small>gamepad rumble, phone buzz</small> ${tog('vibration')}</label>
          <label>Show FPS ${tog('showFps')}</label>
        </div>
        <div class="buttons"><button class="primary" data-go="back">Done</button><button data-go="reset" class="danger">Reset progress</button></div>
      </div>`, focus ?? '[data-go="back"]');
    const commit = () => this.a.setSettings({ ...st });
    this.on('[data-set]', (b) => {
      (st as unknown as Record<string, string>)[b.dataset.set!] = b.dataset.val!;
      commit();
      this.settings(back, `[data-set="${b.dataset.set}"][data-val="${b.dataset.val}"]`);
    });
    this.on('[data-tog]', async (b) => {
      const k = b.dataset.tog as keyof Settings;
      const next = !st[k];
      if (k === 'tilt' && next && !(await this.a.enableTilt())) return;
      (st as unknown as Record<string, boolean>)[k] = next;
      commit();
      this.settings(back, `[data-tog="${k}"]`);
    });
    this.el.querySelectorAll<HTMLInputElement>('[data-range]').forEach((r) =>
      r.addEventListener('input', () => {
        (st as unknown as Record<string, number>)[r.dataset.range!] = Number(r.value);
        commit();
      }));
    this.on('[data-go="back"]', back);
    this.on('[data-go="reset"]', () => {
      if (window.confirm('Erase all medals, records and outfits?')) {
        this.a.resetProgress();
        this.settings(back);
      }
    });
  }

  pause(on: { resume(): void; restart(): void; quit(): void }): void {
    this.open('pause', `
      <div class="menu">
        <h2>Paused</h2>
        <div class="stack">
          <button class="primary big" data-go="resume">Resume</button>
          <button data-go="restart">Restart <kbd>R</kbd></button>
          <button data-go="settings">Settings</button>
          <button data-go="quit">Quit to menu</button>
        </div>
      </div>`);
    this.on('[data-go="resume"]', on.resume);
    this.on('[data-go="restart"]', on.restart);
    this.on('[data-go="settings"]', () => this.settings(() => this.pause(on)));
    this.on('[data-go="quit"]', on.quit);
  }

  /** Gamepad / arrow navigation between focusable buttons. */
  move(dir: 1 | -1, root: HTMLElement = this.el): void {
    const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), input')];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + dir + items.length) % items.length].focus();
  }

  activate(): void {
    const el = document.activeElement as HTMLElement | null;
    if (el && this.el.contains(el)) el.click();
  }
}
