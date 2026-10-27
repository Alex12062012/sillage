import type { Lift, Mountain, Piste, PisteColor } from '../sim/mountain';

export interface MapMarkers {
  me: { x: number; z: number; heading: number; lift: number | null };
  others: { name: string; x: number; z: number }[];
}

export const PISTE: Record<PisteColor, string> = { green: '#2e9e4f', blue: '#2a6bd4', red: '#d8342c', black: '#15181d' };
const PX_HIT = 16; // how close (screen px) a tap must land to pick a lift or a piste
const K_MAX = 2; // deepest zoom, px per metre
const PAN_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], KeyA: [-1, 0], KeyD: [1, 0], KeyW: [0, -1], KeyS: [0, 1],
};

const liftKind = (l: Lift) => (l.kind === 'drag' ? 'drag lift' : l.kind === 'carpet' ? 'carpet' : l.kind === 'gondola' ? 'gondola' : `${l.seats}-seat chair`);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Arc length of a polyline of x, z pairs (cached: the lines never change). */
const lengths = new WeakMap<number[], number>();
function lengthOf(pts: number[]): number {
  let L = lengths.get(pts);
  if (L === undefined) {
    L = 0;
    for (let i = 2; i < pts.length; i += 2) L += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    lengths.set(pts, L);
  }
  return L;
}

/** The point at arc length s along a polyline. */
function pointAt(pts: number[], s: number): [number, number] {
  for (let i = 2; i < pts.length; i += 2) {
    const l = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    if (s <= l) { const t = l ? s / l : 0; return [pts[i - 2] + (pts[i] - pts[i - 2]) * t, pts[i - 1] + (pts[i + 1] - pts[i - 1]) * t]; }
    s -= l;
  }
  return [pts[pts.length - 2], pts[pts.length - 1]];
}

/** Shaded relief and forests, once per station, one pixel per 10 m cell (cached: the map and the mini-map share it). */
const bases = new WeakMap<Mountain, HTMLCanvasElement>();
export function mapBase(m: Mountain): HTMLCanvasElement {
let c = bases.get(m);
if (!c) bases.set(m, (c = buildBase(m)));
return c;
}

function buildBase(m: Mountain): HTMLCanvasElement {
  const { nx, nz, h, step, x0, z0 } = m.grid;
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

/** You: an arrow pointing where you face (heading 0 = +z, south, down the map), in a pulsing halo. */
export function drawMe(g: CanvasRenderingContext2D, px: number, py: number, heading: number): void {
  const fx = Math.sin(heading), fz = Math.cos(heading);
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
}

type Pick = { lift: number } | { piste: Piste };

/**
 * The station's trail map (free ride, M or the map button), browsed like an online map: drag (or the arrows,
 * WASD) to move, wheel / pinch / double-click / the + − buttons to zoom, names of the lifts and pistes appearing as
 * there is room for them. Shaded relief, forests, pistes in their colours, lifts, you and the other players.
 * Clicking a lift or a piste opens its card; a lift's card takes you to its queue.
 */
export class TrailMap {
  readonly el: HTMLDivElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private tip: HTMLDivElement;
  private card: HTMLDivElement;
  private m: Mountain | null = null;
  /** World metres → screen px: sx = (x - cx) * k + w / 2. */
  private cx = 0;
  private cz = 0;
  private k = 1;
  private fitK = 1;
  /** Glide after a fling (m/s) and zoom still to apply (log factor) around `zAt`, both eased out frame by frame. */
  private vx = 0;
  private vz = 0;
  private zLeft = 0;
  private zAt = { x: 0, y: 0 };
  private follow = false;
  private raf = 0;
  private last = 0;
  private ptrs = new Map<number, { x: number; y: number }>();
  private moved = 0;
  private pinch = 0;
  private drag = { vx: 0, vy: 0, t: 0 };
  private held = new Set<string>();
  private hover: { x: number; y: number } | null = null;
  private picked: Pick | null = null;
  private textW = new Map<string, number>();

  constructor(parent: HTMLElement, private markers: () => MapMarkers, private onLift: (i: number) => void, private onClose: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'trailmap';
    this.el.hidden = true;
    this.el.innerHTML = `
      <canvas></canvas>
      <div class="trailmap-head"><b></b><span>drag to move · scroll to zoom · click a lift to ride it<em> · <kbd>M</kbd> close</em></span><button class="close" aria-label="Close map">✕</button></div>
      <div class="trailmap-ctrl"><button data-z="1" aria-label="Zoom in">+</button><button data-z="-1" aria-label="Zoom out">−</button><button class="me" aria-label="Centre on me">◎</button></div>
      <div class="trailmap-legend"><i class="green"></i>green <i class="blue"></i>blue <i class="red"></i>red <i class="black"></i>black <i class="lift"></i>lift</div>
      <div class="trailmap-card" hidden></div>
      <div class="trailmap-tip" hidden></div>`;
    parent.appendChild(this.el);
    this.cv = this.el.querySelector('canvas')!;
    this.g = this.cv.getContext('2d')!;
    this.tip = this.el.querySelector('.trailmap-tip')!;
    this.card = this.el.querySelector('.trailmap-card')!;
    this.el.querySelector('.close')!.addEventListener('click', () => this.onClose());
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-z]')) {
      b.addEventListener('click', () => this.zoomBy(Number(b.dataset.z) * Math.LN2, this.el.clientWidth / 2, this.el.clientHeight / 2));
    }
    this.el.querySelector('.me')!.addEventListener('click', () => { this.follow = true; this.vx = this.vz = 0; });
    this.card.addEventListener('click', (e) => {
      const go = (e.target as HTMLElement).closest('[data-lift]') as HTMLElement | null;
      if (go) this.onLift(Number(go.dataset.lift));
    });
    this.listen();
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  show(m: Mountain): void {
    this.m = m;
    this.el.querySelector('.trailmap-head b')!.textContent = `${m.station.name} · ${m.station.area}`;
    this.el.hidden = false;
    this.resize();
    // open on you, close enough to read the names around
    const me = this.markers().me;
    this.k = Math.max(this.fitK, Math.min(0.55, this.fitK * 4));
    this.cx = me.x;
    this.cz = me.z;
    this.vx = this.vz = this.zLeft = 0;
    this.follow = false;
    this.clamp();
    this.hover = null;
    this.select(null);
    this.held.clear();
    cancelAnimationFrame(this.raf);
    this.last = performance.now();
    const tick = (now: number) => {
      this.step(Math.min(0.05, (now - this.last) / 1000));
      this.last = now;
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  hide(): void {
    this.el.hidden = true;
    cancelAnimationFrame(this.raf);
    this.ptrs.clear();
    this.held.clear();
  }

  private resize(): void {
    const m = this.m!, b = m.bounds, dpr = Math.min(devicePixelRatio, 2);
    const w = this.el.clientWidth, h = this.el.clientHeight;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.fitK = Math.min(w / (b.x1 - b.x0), h / (b.z1 - b.z0)) * 0.94;
  }

  /** Keeps the area on screen and the zoom between the whole area and K_MAX. */
  private clamp(): void {
    const b = this.m!.bounds;
    this.k = Math.min(Math.max(this.k, this.fitK), K_MAX);
    const hw = this.el.clientWidth / 2 / this.k, hh = this.el.clientHeight / 2 / this.k;
    const mid = (a: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(a, lo), hi));
    this.cx = mid(this.cx, b.x0 + hw, b.x1 - hw);
    this.cz = mid(this.cz, b.z0 + hh, b.z1 - hh);
  }

  private toWorld(px: number, py: number): [number, number] {
    return [this.cx + (px - this.el.clientWidth / 2) / this.k, this.cz + (py - this.el.clientHeight / 2) / this.k];
  }

  /** Zooms by f around a screen point, the point staying put. */
  private zoomAt(px: number, py: number, f: number): void {
    const [wx, wz] = this.toWorld(px, py);
    this.k *= f;
    this.clamp();
    const [ax, az] = this.toWorld(px, py);
    this.cx += wx - ax;
    this.cz += wz - az;
    this.clamp();
  }

  /** A smooth zoom (log factor) around a screen point, spread over the next frames. */
  private zoomBy(log: number, px: number, py: number): void {
    this.zLeft += log;
    this.zAt = { x: px, y: py };
  }

  /** Per frame: the keys held, the glide, the smooth zoom, following you. */
  private step(dt: number): void {
    let kx = 0, kz = 0;
    for (const c of this.held) { const d = PAN_KEYS[c]; if (d) { kx += d[0]; kz += d[1]; } }
    if (kx || kz) {
      const v = 700 / this.k; // ~700 px a second whatever the zoom
      this.cx += kx * v * dt;
      this.cz += kz * v * dt;
      this.follow = false;
    }
    if (this.vx || this.vz) {
      this.cx += this.vx * dt;
      this.cz += this.vz * dt;
      const d = Math.exp(-dt * 4);
      this.vx *= d;
      this.vz *= d;
      if (Math.hypot(this.vx, this.vz) * this.k < 5) this.vx = this.vz = 0;
    }
    if (Math.abs(this.zLeft) > 1e-3) {
      const part = this.zLeft * (1 - Math.exp(-dt * 14));
      this.zLeft -= part;
      this.zoomAt(this.zAt.x, this.zAt.y, Math.exp(part));
    } else this.zLeft = 0;
    if (this.follow) {
      const me = this.markers().me, f = 1 - Math.exp(-dt * 8);
      this.cx += (me.x - this.cx) * f;
      this.cz += (me.z - this.cz) * f;
    }
    this.clamp();
  }

  private listen(): void {
    const cv = this.cv;
    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY; // lines → px (Firefox)
      this.zoomBy(-dy * 0.0016, p.x, p.y);
    }, { passive: false });
    cv.addEventListener('dblclick', (e) => {
      const p = local(e);
      this.zoomBy(e.shiftKey ? -Math.LN2 : Math.LN2, p.x, p.y);
    });
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      this.ptrs.set(e.pointerId, local(e));
      this.moved = 0;
      this.pinch = 0;
      this.vx = this.vz = 0;
      this.drag = { vx: 0, vy: 0, t: performance.now() };
    });
    cv.addEventListener('pointermove', (e) => {
      const p = local(e);
      this.hover = e.pointerType === 'mouse' ? p : null;
      const prev = this.ptrs.get(e.pointerId);
      if (!prev) return;
      if (this.ptrs.size === 1) {
        const dx = p.x - prev.x, dy = p.y - prev.y;
        this.cx -= dx / this.k;
        this.cz -= dy / this.k;
        this.moved += Math.hypot(dx, dy);
        if (this.moved > 4) this.follow = false;
        const now = performance.now(), dtm = Math.max(1, now - this.drag.t), a = Math.min(1, dtm / 50);
        this.drag = { vx: this.drag.vx + (dx / dtm - this.drag.vx) * a, vy: this.drag.vy + (dy / dtm - this.drag.vy) * a, t: now }; // px per ms, smoothed
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
      if (this.ptrs.size) return;
      if (this.moved > 6) {
        // a fling glides on, unless the pointer stopped before letting go
        if (this.moved < 1e9 && performance.now() - this.drag.t < 80) {
          this.vx = (-this.drag.vx * 1000) / this.k;
          this.vz = (-this.drag.vy * 1000) / this.k;
        }
        return;
      }
      const p = local(e);
      this.select(this.pickAt(p.x, p.y));
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', (e) => { this.ptrs.delete(e.pointerId); this.pinch = 0; });
    cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.hover = null; });
    addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (PAN_KEYS[e.code]) { this.held.add(e.code); e.preventDefault(); }
      if (e.key === '+' || e.key === '=') this.zoomBy(Math.LN2, this.el.clientWidth / 2, this.el.clientHeight / 2);
      if (e.key === '-' || e.key === '_') this.zoomBy(-Math.LN2, this.el.clientWidth / 2, this.el.clientHeight / 2);
    });
    addEventListener('keyup', (e) => this.held.delete(e.code));
    addEventListener('blur', () => this.held.clear());
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

  /** The lift under a screen point, or else the named piste. */
  private pickAt(px: number, py: number): Pick | null {
    let bd = PX_HIT, lift = -1;
    this.m!.lifts.forEach((l, i) => {
      const d = this.distTo(l.pts, px, py);
      if (d < bd) { bd = d; lift = i; }
    });
    if (lift >= 0) return { lift };
    let piste: Piste | null = null;
    bd = PX_HIT;
    for (const p of this.m!.pistes) {
      if (p.area || !p.name) continue;
      const d = this.distTo(p.pts, px, py);
      if (d < bd) { bd = d; piste = p; }
    }
    return piste ? { piste } : null;
  }

  /** The card of a lift (with "go to its queue") or a piste; null closes it. */
  private select(p: Pick | null): void {
    this.picked = p;
    this.card.hidden = !p;
    if (!p) return;
    if ('lift' in p) {
      const l = this.m!.lifts[p.lift];
      this.card.innerHTML = `<div><b>${esc(l.name || 'Lift')}</b><small>${liftKind(l)} · ${Math.round(lengthOf(l.pts))} m</small></div><button class="go" data-lift="${p.lift}">Go to its queue</button>`;
    } else {
      const s = p.piste;
      this.card.innerHTML = `<div><b><i class="${s.difficulty}"></i>${esc(s.name)}</b><small>${s.difficulty} piste · ${(s.len / 1000).toFixed(1)} km</small></div>`;
    }
  }

  private widthOf(text: string, font: string): number {
    const key = font + text;
    let w = this.textW.get(key);
    if (w === undefined) {
      this.g.font = font;
      this.textW.set(key, (w = this.g.measureText(text).width));
    }
    return w;
  }

  private draw(): void {
    const m = this.m!, g = this.g, dpr = this.cv.width / this.el.clientWidth;
    const w = this.el.clientWidth, h = this.el.clientHeight, k = this.k;
    const sx = (x: number) => (x - this.cx) * k + w / 2, sy = (z: number) => (z - this.cz) * k + h / 2;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#c9d3df';
    g.fillRect(0, 0, w, h);
    const gr = m.grid;
    g.imageSmoothingEnabled = true;
    g.drawImage(mapBase(m), sx(gr.x0), sy(gr.z0), gr.nx * gr.step * k, gr.nz * gr.step * k);

    const line = (pts: number[]) => {
      g.beginPath();
      g.moveTo(sx(pts[0]), sy(pts[1]));
      for (let i = 2; i < pts.length; i += 2) g.lineTo(sx(pts[i]), sy(pts[i + 1]));
    };
    const hot = this.hover ? this.pickAt(this.hover.x, this.hover.y) : null;
    const isHot = (p: Pick | null, o: number | Piste) => !!p && ('lift' in p ? p.lift === o : p.piste === o);
    g.lineCap = g.lineJoin = 'round';
    const pw = Math.max(2, Math.min(9, 18 * k));
    for (const p of m.pistes) {
      if (p.area) continue;
      const on = isHot(hot, p) || isHot(this.picked, p);
      line(p.pts);
      g.strokeStyle = on ? '#ffd166' : 'rgba(255,255,255,0.85)';
      g.lineWidth = pw + (on ? 6 : 2);
      g.stroke();
      g.strokeStyle = PISTE[p.difficulty];
      g.lineWidth = pw;
      g.stroke();
    }
    m.lifts.forEach((l: Lift, i) => {
      const on = isHot(hot, i) || isHot(this.picked, i);
      line(l.pts);
      g.strokeStyle = on ? '#ff7a3d' : '#1c2433';
      g.lineWidth = on ? 4 : 2;
      g.setLineDash(l.kind === 'drag' || l.kind === 'carpet' ? [6, 4] : []);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = on ? '#ff7a3d' : '#1c2433';
      for (const e of [0, l.pts.length - 2]) {
        g.beginPath();
        g.arc(sx(l.pts[e]), sy(l.pts[e + 1]), on ? 6 : e ? 3 : 4.5, 0, Math.PI * 2);
        g.fill();
      }
    });

    const mk = this.markers();
    this.labels(mk, sx, sy, w, h);
    g.font = '600 12px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    for (const o of mk.others) {
      g.fillStyle = '#8a2be2';
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(sx(o.x), sy(o.z), 5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.lineWidth = 3;
      g.strokeText(o.name, sx(o.x), sy(o.z) - 9);
      g.fillStyle = '#12233d';
      g.fillText(o.name, sx(o.x), sy(o.z) - 9);
    }
    drawMe(g, sx(mk.me.x), sy(mk.me.z), mk.me.heading);

    this.tipAt(hot);
  }

  /**
   * Names along the lines, like an online map: lifts first, then the longest pistes, each written along its line
   * at its middle (upright), only when the line is long enough on screen and the name hits no other.
   */
  private labels(mk: MapMarkers, sx: (x: number) => number, sy: (z: number) => number, w: number, h: number): void {
    const g = this.g, k = this.k, m = this.m!;
    const placed: number[][] = [[sx(mk.me.x) - 16, sy(mk.me.z) - 16, sx(mk.me.x) + 16, sy(mk.me.z) + 16]];
    const items: { name: string; pts: number[]; len: number; color: string; font: string }[] = [];
    for (const l of m.lifts) if (l.name) items.push({ name: l.name, pts: l.pts, len: lengthOf(l.pts), color: '#1c2433', font: 'italic 600 12px system-ui, sans-serif' });
    const pistes = m.pistes.filter((p) => !p.area && p.name).sort((a, b) => b.len - a.len);
    for (const p of pistes) items.push({ name: p.name, pts: p.pts, len: lengthOf(p.pts), color: PISTE[p.difficulty], font: '700 12px system-ui, sans-serif' });
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    for (const it of items) {
      const tw = this.widthOf(it.name, it.font);
      if (it.len * k < tw + 30) continue; // no room along the line at this zoom
      const half = tw / 2 / k;
      const [x, z] = pointAt(it.pts, it.len / 2);
      const X = sx(x), Y = sy(z);
      if (X < -tw || X > w + tw || Y < -20 || Y > h + 20) continue;
      const [ax, az] = pointAt(it.pts, Math.max(0, it.len / 2 - half));
      const [bx, bz] = pointAt(it.pts, Math.min(it.len, it.len / 2 + half));
      let ang = Math.atan2(bz - az, bx - ax);
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      const c = Math.abs(Math.cos(ang)), s = Math.abs(Math.sin(ang));
      const bw = (tw + 8) * c + 16 * s, bh = (tw + 8) * s + 16 * c;
      const box = [X - bw / 2, Y - bh / 2, X + bw / 2, Y + bh / 2];
      if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
      placed.push(box);
      g.save();
      g.translate(X, Y);
      g.rotate(ang);
      g.font = it.font;
      g.strokeStyle = 'rgba(255,255,255,0.92)';
      g.lineWidth = 4;
      g.strokeText(it.name, 0, 0);
      g.fillStyle = it.color;
      g.fillText(it.name, 0, 0);
      g.restore();
    }
  }

  /** Names the lift or piste under the mouse. */
  private tipAt(hot: Pick | null): void {
    const hv = this.hover;
    let text = '';
    if (hv && hot) {
      if ('lift' in hot) {
        const l = this.m!.lifts[hot.lift];
        text = `<b>${esc(l.name || 'Lift')}</b> · ${liftKind(l)}<small>click for its card</small>`;
      } else text = `<i class="${hot.piste.difficulty}"></i><b>${esc(hot.piste.name)}</b> · ${(hot.piste.len / 1000).toFixed(1)} km`;
    }
    this.tip.hidden = !text;
    this.cv.style.cursor = text ? 'pointer' : '';
    if (!text || !hv) return;
    if (this.tip.innerHTML !== text) this.tip.innerHTML = text;
    this.tip.style.transform = `translate(${Math.round(Math.min(hv.x + 14, this.el.clientWidth - 250))}px, ${Math.round(hv.y + 14)}px)`;
  }
}
