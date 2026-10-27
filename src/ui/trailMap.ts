import type { Lift, Mountain, PisteColor } from '../sim/mountain';

export interface MapMarkers {
  me: { x: number; z: number; heading: number; lift: number | null };
  others: { name: string; x: number; z: number }[];
}

const PISTE: Record<PisteColor, string> = { green: '#2e9e4f', blue: '#2a6bd4', red: '#d8342c', black: '#15181d' };
const PX_HIT = 16; // how close (screen px) a tap must land to pick a lift or a piste

/**
 * The station's trail map (free ride, M or the map button): shaded relief, forests, pistes in their colours,
 * lifts, you and the other players. Wheel / pinch zooms, drag pans; a tap on a lift takes you to its queue.
 */
export class TrailMap {
  readonly el: HTMLDivElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private tip: HTMLDivElement;
  private base: HTMLCanvasElement | null = null;
  private m: Mountain | null = null;
  /** World metres → screen px: sx = (x - cx) * k + w / 2. */
  private cx = 0;
  private cz = 0;
  private k = 1;
  private fitK = 1;
  private raf = 0;
  private ptrs = new Map<number, { x: number; y: number }>();
  private moved = 0;
  private pinch = 0;
  private hover: { x: number; y: number } | null = null;

  constructor(parent: HTMLElement, private markers: () => MapMarkers, private onLift: (i: number) => void, private onClose: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'trailmap';
    this.el.hidden = true;
    this.el.innerHTML = `
      <canvas></canvas>
      <div class="trailmap-head"><b></b><span>tap a lift to go to its queue<em> · <kbd>M</kbd> close</em></span><button aria-label="Close map">✕</button></div>
      <div class="trailmap-legend"><i class="green"></i>green <i class="blue"></i>blue <i class="red"></i>red <i class="black"></i>black <i class="lift"></i>lift</div>
      <div class="trailmap-tip"></div>`;
    parent.appendChild(this.el);
    this.cv = this.el.querySelector('canvas')!;
    this.g = this.cv.getContext('2d')!;
    this.tip = this.el.querySelector('.trailmap-tip')!;
    this.el.querySelector('button')!.addEventListener('click', () => this.onClose());
    this.listen();
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  show(m: Mountain): void {
    if (this.m !== m) { this.m = m; this.base = null; }
    this.el.querySelector('.trailmap-head b')!.textContent = `${m.station.name} · ${m.station.area}`;
    this.el.hidden = false;
    this.resize();
    // open on you, zoomed in a little from the whole area
    const me = this.markers().me;
    this.k = this.fitK * 2.2;
    this.cx = me.x;
    this.cz = me.z;
    this.clamp();
    this.hover = null;
    this.tip.hidden = true;
    const tick = () => { this.draw(); this.raf = requestAnimationFrame(tick); };
    cancelAnimationFrame(this.raf);
    tick();
  }

  hide(): void {
    this.el.hidden = true;
    cancelAnimationFrame(this.raf);
    this.ptrs.clear();
  }

  private resize(): void {
    const m = this.m!, b = m.bounds, dpr = Math.min(devicePixelRatio, 2);
    const w = this.el.clientWidth, h = this.el.clientHeight;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.fitK = Math.min(w / (b.x1 - b.x0), h / (b.z1 - b.z0)) * 0.94;
  }

  /** Keeps the area on screen and the zoom between the whole area and ~1.5 px per metre. */
  private clamp(): void {
    const b = this.m!.bounds;
    this.k = Math.min(Math.max(this.k, this.fitK), 1.5);
    const hw = this.el.clientWidth / 2 / this.k, hh = this.el.clientHeight / 2 / this.k;
    const mid = (a: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(a, lo), hi));
    this.cx = mid(this.cx, b.x0 + hw, b.x1 - hw);
    this.cz = mid(this.cz, b.z0 + hh, b.z1 - hh);
  }

  private toWorld(px: number, py: number): [number, number] {
    return [this.cx + (px - this.el.clientWidth / 2) / this.k, this.cz + (py - this.el.clientHeight / 2) / this.k];
  }

  private zoomAt(px: number, py: number, f: number): void {
    const [wx, wz] = this.toWorld(px, py);
    this.k *= f;
    this.clamp();
    const [ax, az] = this.toWorld(px, py);
    this.cx += wx - ax;
    this.cz += wz - az;
    this.clamp();
  }

  private listen(): void {
    const cv = this.cv;
    const local = (e: PointerEvent | WheelEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      this.ptrs.set(e.pointerId, local(e));
      this.moved = 0;
      this.pinch = 0;
    });
    cv.addEventListener('pointermove', (e) => {
      const p = local(e);
      this.hover = e.pointerType === 'mouse' ? p : null;
      const prev = this.ptrs.get(e.pointerId);
      if (!prev) return;
      if (this.ptrs.size === 1) {
        this.cx -= (p.x - prev.x) / this.k;
        this.cz -= (p.y - prev.y) / this.k;
        this.moved += Math.hypot(p.x - prev.x, p.y - prev.y);
        this.clamp();
      }
      this.ptrs.set(e.pointerId, p);
      if (this.ptrs.size === 2) {
        const [a, b] = [...this.ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch) this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / this.pinch);
        this.pinch = d;
        this.moved = 1e9;
      }
    });
    const up = (e: PointerEvent) => {
      if (!this.ptrs.delete(e.pointerId)) return;
      this.pinch = 0;
      if (this.ptrs.size || this.moved > 8) return;
      const p = local(e);
      const lift = this.liftAt(p.x, p.y);
      if (lift >= 0) this.onLift(lift);
      else if (e.pointerType !== 'mouse') this.hover = p; // touch: a tap names what is under it
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', (e) => { this.ptrs.delete(e.pointerId); this.pinch = 0; });
    cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.hover = null; });
    addEventListener('resize', () => { if (this.open) { this.resize(); this.clamp(); } });
  }

  /** Distance (screen px) from a point to a polyline of x, z pairs. */
  private distTo(pts: number[], px: number, py: number): number {
    const [wx, wz] = this.toWorld(px, py);
    let best = Infinity;
    for (let i = 2; i < pts.length; i += 2) {
      const ax = pts[i - 2], az = pts[i - 1], vx = pts[i] - ax, vz = pts[i + 1] - az;
      const t = Math.min(1, Math.max(0, ((wx - ax) * vx + (wz - az) * vz) / (vx * vx + vz * vz || 1)));
      best = Math.min(best, Math.hypot(wx - ax - vx * t, wz - az - vz * t));
    }
    return best * this.k;
  }

  private liftAt(px: number, py: number): number {
    let best = -1, bd = PX_HIT;
    this.m!.lifts.forEach((l, i) => {
      const d = this.distTo(l.pts, px, py);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  /** Shaded relief and forests, once per station, one pixel per 10 m cell. */
  private buildBase(): HTMLCanvasElement {
    const m = this.m!, { nx, nz, h, step, x0, z0 } = m.grid;
    const c = document.createElement('canvas');
    c.width = nx;
    c.height = nz;
    const g = c.getContext('2d')!;
    const img = g.createImageData(nx, nz);
    const lx = -0.55, ly = 0.62, lz = -0.55; // the sun from the north-west, as on printed maps
    const at = (a: ArrayLike<number>, i: number, j: number) => a[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))];
    const mask = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) mask[j * nx + i] = m.forest(x0 + i * step, z0 + j * step) ? 1 : 0;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const dx = (at(h, i + 1, j) - at(h, i - 1, j)) / (2 * step), dz = (at(h, i, j + 1) - at(h, i, j - 1)) / (2 * step);
        const n = 1 / Math.hypot(dx, 1, dz);
        const shade = Math.max(0, (-dx * lx + ly - dz * lz) * n);
        let f = 0; // the woods' share of the 5 × 5 cells around: soft edges, not 10 m stairs
        for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) f += at(mask, i + a, j + b);
        f = Math.min(1, Math.max(0, (f / 25 - 0.2) / 0.6));
        const r = 238 - 88 * f, gg = 244 - 62 * f, bb = 250 - 92 * f;
        const s = 0.62 + 0.42 * shade;
        const k = (j * nx + i) * 4;
        img.data[k] = Math.min(255, r * s);
        img.data[k + 1] = Math.min(255, gg * s);
        img.data[k + 2] = Math.min(255, bb * s + 6);
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  private draw(): void {
    const m = this.m!, g = this.g, dpr = this.cv.width / this.el.clientWidth;
    const w = this.el.clientWidth, h = this.el.clientHeight, k = this.k;
    const sx = (x: number) => (x - this.cx) * k + w / 2, sy = (z: number) => (z - this.cz) * k + h / 2;
    this.base ??= this.buildBase();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#c9d3df';
    g.fillRect(0, 0, w, h);
    const gr = m.grid;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base, sx(gr.x0), sy(gr.z0), gr.nx * gr.step * k, gr.nz * gr.step * k);

    const line = (pts: number[]) => {
      g.beginPath();
      g.moveTo(sx(pts[0]), sy(pts[1]));
      for (let i = 2; i < pts.length; i += 2) g.lineTo(sx(pts[i]), sy(pts[i + 1]));
    };
    g.lineCap = g.lineJoin = 'round';
    const pw = Math.max(2, Math.min(7, 18 * k));
    for (const p of m.pistes) {
      if (p.area) continue;
      line(p.pts);
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = pw + 2;
      g.stroke();
      g.strokeStyle = PISTE[p.difficulty];
      g.lineWidth = pw;
      g.stroke();
    }
    const hoverLift = this.hover ? this.liftAt(this.hover.x, this.hover.y) : -1;
    m.lifts.forEach((l: Lift, i) => {
      line(l.pts);
      g.strokeStyle = i === hoverLift ? '#ff7a3d' : '#1c2433';
      g.lineWidth = i === hoverLift ? 4 : 2;
      g.setLineDash(l.kind === 'drag' || l.kind === 'carpet' ? [6, 4] : []);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = i === hoverLift ? '#ff7a3d' : '#1c2433';
      g.beginPath();
      g.arc(sx(l.pts[0]), sy(l.pts[1]), i === hoverLift ? 6 : 4, 0, Math.PI * 2);
      g.fill();
    });

    const mk = this.markers();
    g.font = '600 12px system-ui, sans-serif';
    g.textAlign = 'center';
    for (const o of mk.others) {
      g.fillStyle = '#8a2be2';
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(sx(o.x), sy(o.z), 5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#12233d';
      g.fillText(o.name, sx(o.x), sy(o.z) - 9);
    }
    // you: an arrow pointing where you face (heading: 0 = +z, south, down the screen)
    const px = sx(mk.me.x), py = sy(mk.me.z), a = mk.me.heading;
    const fx = Math.sin(a), fz = Math.cos(a);
    const pulse = 13 + 3 * Math.sin(performance.now() / 260);
    g.fillStyle = 'rgba(255,122,61,0.25)';
    g.beginPath();
    g.arc(px, py, pulse, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ff7a3d';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px + fx * 11, py + fz * 11);
    g.lineTo(px - fx * 7 + fz * 7, py - fz * 7 - fx * 7);
    g.lineTo(px - fx * 3, py - fz * 3);
    g.lineTo(px - fx * 7 - fz * 7, py - fz * 7 + fx * 7);
    g.closePath();
    g.fill();
    g.stroke();

    this.tipAt(hoverLift);
  }

  /** Names the lift (or else the piste) under the pointer. */
  private tipAt(lift: number): void {
    const m = this.m!, hv = this.hover;
    let text = '';
    if (hv && lift >= 0) {
      const l = m.lifts[lift];
      text = `<b>${esc(l.name || 'Lift')}</b> · ${l.kind === 'drag' ? 'drag lift' : l.kind === 'carpet' ? 'carpet' : l.kind === 'gondola' ? 'gondola' : `${l.seats}-seat chair`}<small>tap to go to its queue</small>`;
    } else if (hv) {
      let bd = PX_HIT, best = null;
      for (const p of m.pistes) {
        if (p.area || !p.name) continue;
        const d = this.distTo(p.pts, hv.x, hv.y);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) text = `<i class="${best.difficulty}"></i><b>${esc(best.name)}</b> · ${(best.len / 1000).toFixed(1)} km`;
    }
    this.tip.hidden = !text;
    if (!text || !hv) return;
    if (this.tip.innerHTML !== text) this.tip.innerHTML = text;
    this.tip.style.transform = `translate(${Math.round(hv.x + 14)}px, ${Math.round(hv.y + 14)}px)`;
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
