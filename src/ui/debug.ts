import { TUNING, TUNING_RANGES } from '../tuning';

const DEFAULTS = { ...TUNING };

/** Live tuning panel (~ / F2): one slider per TUNING value, filter box, copy-as-JSON, reset. */
export function createDebugPanel(parent: HTMLElement, info: () => string): { toggle(): void; visible(): boolean } {
  const el = document.createElement('div');
  el.className = 'debug-panel';
  el.hidden = true;
  el.innerHTML = `
    <div class="debug-head"><b>Tuning</b>
      <input class="debug-filter" placeholder="filter…" />
      <button data-act="copy">Copy JSON</button><button data-act="reset">Reset</button><button data-act="close">✕</button>
    </div>
    <pre class="debug-info"></pre>
    <div class="debug-list"></div>`;
  parent.appendChild(el);
  const list = el.querySelector('.debug-list') as HTMLDivElement;
  const infoEl = el.querySelector('.debug-info') as HTMLPreElement;
  const filter = el.querySelector('.debug-filter') as HTMLInputElement;
  const rows: { key: keyof typeof TUNING; row: HTMLElement; input: HTMLInputElement; out: HTMLElement }[] = [];

  for (const key of Object.keys(TUNING) as (keyof typeof TUNING)[]) {
    const v = DEFAULTS[key];
    const [min, max] = TUNING_RANGES[key] ?? [0, Math.max(1, Math.abs(v) * 3)];
    const row = document.createElement('label');
    row.className = 'debug-row';
    row.innerHTML = `<span>${key}</span><input type="range" min="${min}" max="${max}" step="${(max - min) / 400}" value="${v}"><output>${v}</output>`;
    const input = row.querySelector('input') as HTMLInputElement;
    const out = row.querySelector('output') as HTMLElement;
    input.addEventListener('input', () => {
      TUNING[key] = Number(input.value);
      out.textContent = String(+Number(input.value).toFixed(3));
    });
    list.appendChild(row);
    rows.push({ key, row, input, out });
  }

  filter.addEventListener('input', () => {
    const f = filter.value.toLowerCase();
    for (const r of rows) r.row.hidden = !r.key.toLowerCase().includes(f);
  });
  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).dataset.act;
    if (act === 'copy') void navigator.clipboard?.writeText(JSON.stringify(TUNING, null, 2));
    if (act === 'reset') {
      Object.assign(TUNING, DEFAULTS);
      for (const r of rows) { r.input.value = String(TUNING[r.key]); r.out.textContent = String(TUNING[r.key]); }
    }
    if (act === 'close') el.hidden = true;
  });
  // keep keyboard focus in the game after touching a slider
  el.addEventListener('keydown', (e) => e.stopPropagation(), true);

  const tick = () => {
    if (!el.hidden) infoEl.textContent = info();
    window.setTimeout(tick, 400);
  };
  tick();

  return {
    toggle: () => { el.hidden = !el.hidden; },
    visible: () => !el.hidden,
  };
}
