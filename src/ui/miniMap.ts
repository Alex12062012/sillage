import type { Mountain } from '../sim/mountain';
import { drawMe, mapBase, PISTE, type MapMarkers } from './trailMap';

const SIZE = 172; // css px, square
const K = 0.32; // px per metre: ~540 m across

/** Bounding box of a polyline of x, z pairs (cached: the lines never change). */
const boxes = new WeakMap<number[], number[]>();
function boxOf(pts: number[]): number[] {
  let b = boxes.get(pts);
  if (!b) {
    b = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pts.length; i += 2) {
      b[0] = Math.min(b[0], pts[i]); b[1] = Math.min(b[1], pts[i + 1]);
      b[2] = Math.max(b[2], pts[i]); b[3] = Math.max(b[3], pts[i + 1]);
    }
    boxes.set(pts, b);
  }
  return b;
}

/**
 * Free ride mini-map, top right: north up, centred on you, the pistes, lifts and players around. A tap (or M)
 * opens the full trail map.
 */
export class MiniMap {
  readonly el: HTMLDivElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private m: Mountain | null = null;
  private t = 0;

  constructor(parent: HTMLElement, private markers: () => MapMarkers, onOpen: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'minimap';
    this.el.hidden = true;
    this.el.innerHTML = `<canvas></canvas><span class="minimap-key"><kbd>M</kbd> Map</span>`;
    parent.appendChild(this.el);
    this.cv = this.el.querySelector('canvas')!;
    this.g = this.cv.getContext('2d')!;
    this.el.addEventListener('click', onOpen);
  }

  /** The station to show, or null to hide it (arcade runs). */
  show(m: Mountain | null): void {
    this.m = m;
    this.el.hidden = !m;
    if (!m) return;
    const dpr = Math.min(devicePixelRatio, 2);
    this.cv.width = this.cv.height = Math.round(SIZE * dpr);
    this.t = 1;
  }

  /** Per frame; redraws at ~30 Hz. */
  update(dt: number): void {
    if (!this.m || this.el.hidden || (this.t += dt) < 1 / 30) return;
    this.t = 0;
    const m = this.m, g = this.g, dpr = this.cv.width / SIZE, mk = this.markers();
    const cx = mk.me.x, cz = mk.me.z, half = SIZE / 2 / K;
    const sx = (x: number) => (x - cx) * K + SIZE / 2, sy = (z: number) => (z - cz) * K + SIZE / 2;
    const seen = (pts: number[]) => {
      const b = boxOf(pts);
      return b[2] > cx - half && b[0] < cx + half && b[3] > cz - half && b[1] < cz + half;
    };
    const line = (pts: number[]) => {
      g.beginPath();
      g.moveTo(sx(pts[0]), sy(pts[1]));
      for (let i = 2; i < pts.length; i += 2) g.lineTo(sx(pts[i]), sy(pts[i + 1]));
    };
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#c9d3df';
    g.fillRect(0, 0, SIZE, SIZE);
    const gr = m.grid;
    g.drawImage(mapBase(m), sx(gr.x0), sy(gr.z0), gr.nx * gr.step * K, gr.nz * gr.step * K);
    g.lineCap = g.lineJoin = 'round';
    for (const p of m.pistes) {
      if (p.area || !seen(p.pts)) continue;
      line(p.pts);
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 5;
      g.stroke();
      g.strokeStyle = PISTE[p.difficulty];
      g.lineWidth = 3;
      g.stroke();
    }
    g.fillStyle = g.strokeStyle = '#1c2433';
    for (const l of m.lifts) {
      if (!seen(l.pts)) continue;
      line(l.pts);
      g.lineWidth = 1.5;
      g.setLineDash(l.kind === 'drag' || l.kind === 'carpet' ? [4, 3] : []);
      g.stroke();
      g.setLineDash([]);
      g.beginPath();
      g.arc(sx(l.pts[0]), sy(l.pts[1]), 3, 0, Math.PI * 2);
      g.fill();
    }
    for (const o of mk.others) {
      g.fillStyle = '#8a2be2';
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(sx(o.x), sy(o.z), 4, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    drawMe(g, SIZE / 2, SIZE / 2, mk.me.heading);
  }
}
