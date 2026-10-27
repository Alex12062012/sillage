import type { StationConfig } from '../sim/stationConfig';

/** The questions a station answers when it signs up, with the choices as a visitor would see them. */
const QUESTIONS: { key: keyof StationConfig; title: string; options: [string, string][] }[] = [
  { key: 'buildings', title: 'Buildings', options: [['real', 'As they really are'], ['generic', 'Generic']] },
  { key: 'crowd', title: 'People on the slopes', options: [['busy', 'Busy'], ['some', 'A few'], ['none', 'Nobody']] },
  { key: 'slopes', title: 'Slopes', options: [['real', 'Real'], ['fun', 'Steeper for fun'], ['memory', 'As remembered (blacks steeper)']] },
];

/**
 * The station settings screen (?setup), for a sales demo: change the answers and see them live, export them as
 * the station's config file. Visitors never see it.
 */
export class SetupPanel {
  readonly el: HTMLDivElement;
  private toggle: HTMLButtonElement;

  constructor(parent: HTMLElement, private cfg: StationConfig, private stationId: string, private onChange: (cfg: StationConfig) => void) {
    this.toggle = document.createElement('button');
    this.toggle.className = 'setup-toggle';
    this.toggle.setAttribute('aria-label', 'Station settings');
    this.toggle.textContent = '⚙';
    this.toggle.addEventListener('click', () => (this.el.hidden ? this.show() : this.hide()));
    this.el = document.createElement('div');
    this.el.className = 'setup';
    this.el.innerHTML = `<h3>Station settings <small>what the resort chose</small></h3>${QUESTIONS.map((q) => `
      <fieldset><legend>${q.title}</legend>${q.options.map(([v, label]) => `
        <label><input type="radio" name="setup-${q.key}" value="${v}"${cfg[q.key] === v ? ' checked' : ''}> ${label}</label>`).join('')}
      </fieldset>`).join('')}
      <button class="export">Export settings</button>`;
    parent.append(this.toggle, this.el);
    this.el.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      const key = t.name.replace('setup-', '') as keyof StationConfig;
      this.cfg = { ...this.cfg, [key]: t.value } as StationConfig;
      this.onChange(this.cfg);
    });
    this.el.querySelector('.export')!.addEventListener('click', () => this.export());
    // keys typed here are the panel's, not the skier's
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
  }

  show(): void {
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }

  private export(): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`${JSON.stringify(this.cfg, null, 2)}\n`], { type: 'application/json' }));
    a.download = `${this.stationId}.config.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
