/** Minimal in-run HUD: speed, event popups, speed vignette, first-run control hints. */
export class Hud {
  readonly el: HTMLDivElement;
  private speed: HTMLDivElement;
  private pops: HTMLDivElement;
  private vignette: HTMLDivElement;
  private hint: HTMLDivElement;
  private lastSpeed = -1;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud-vignette"></div>
      <div class="hud-pops"></div>
      <div class="hud-speed"></div>
      <div class="hud-hint"></div>`;
    parent.appendChild(this.el);
    this.vignette = this.el.querySelector('.hud-vignette')!;
    this.pops = this.el.querySelector('.hud-pops')!;
    this.speed = this.el.querySelector('.hud-speed')!;
    this.hint = this.el.querySelector('.hud-hint')!;
  }

  setSpeed(kmh: number): void {
    const v = Math.round(kmh);
    if (v === this.lastSpeed) return;
    this.lastSpeed = v;
    this.speed.innerHTML = `${v}<small>km/h</small>`;
    this.vignette.style.opacity = String(Math.min(1, Math.max(0, (kmh - 55) / 60)));
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
