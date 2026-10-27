import { CanvasTexture, Group, LinearFilter, Sprite, SpriteMaterial, type Vector3 } from 'three';
import { FLAG, type OnlineRide, type Remote, type WireState } from '../net/online';
import type { Mountain } from '../sim/mountain';
import { createSkier, type SkierState } from '../sim/skier';
import type { Ground, Obstacle } from '../sim/track';
import { SkierModel } from './skierModel';

interface Shown { model: SkierModel; tag: Sprite; s: SkierState; obstacle: Obstacle }

/** A name over a skier's head: white on a dark pill, shrinking with distance like the skier. */
function nameTag(name: string): Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '600 34px system-ui, sans-serif';
  const w = Math.min(248, g.measureText(name).width + 32);
  g.fillStyle = 'rgba(16, 22, 34, 0.62)';
  g.beginPath();
  g.roundRect((256 - w) / 2, 6, w, 52, 26);
  g.fill();
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 128, 33);
  const tex = new CanvasTexture(c);
  tex.minFilter = LinearFilter;
  const sp = new Sprite(new SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sp.scale.set(2.2, 0.55, 1);
  sp.renderOrder = 3;
  return sp;
}

/**
 * The other players on the station (online free ride): their skier in their outfit, their name, and a moving
 * obstacle for the collision code (hit one fast and you both fall: see Game).
 */
export class OtherSkiers {
  readonly group = new Group();
  private shown = new Map<string, Shown>();
  private st: WireState = [];
  private ground: Ground;
  private ids = 700000;

  constructor(private m: Mountain, private ride: OnlineRide, drawn: (x: number, z: number) => number) {
    this.ground = { height: drawn, normal: m.normal, surface: m.surface };
  }

  /** The player behind obstacle `id`, if it is one. */
  remoteOf(id: number): Remote | undefined {
    for (const [rid, v] of this.shown) if (v.obstacle.id === id) return this.ride.remotes.get(rid);
    return undefined;
  }

  update(dt: number, sunDir: Vector3): void {
    for (const [id, v] of this.shown) if (!this.ride.remotes.has(id)) this.drop(id, v);
    for (const r of this.ride.remotes.values()) {
      const st = this.ride.sample(r, this.st);
      let v = this.shown.get(r.id);
      if (!st) continue;
      if (!v) {
        const model = new SkierModel(r.look), tag = nameTag(r.name);
        const obstacle: Obstacle = { id: this.ids++, x: st[0], z: st[2], r: 0.45, h: 1.8, kind: 'skier' };
        this.m.dynamic.push(obstacle);
        this.group.add(model.root, model.shadow, tag);
        v = { model, tag, s: createSkier(this.m, st[0], st[2], st[3]), obstacle };
        this.shown.set(r.id, v);
      }
      const s = v.s, flags = st[9] | 0;
      const lift = (flags & FLAG.lift) !== 0;
      s.pos.set(st[0], st[1], st[2]);
      s.vel.set(st[4], st[5], st[6]);
      s.heading = st[3];
      s.edge = st[7];
      s.skid = st[8];
      s.airborne = (flags & FLAG.air) !== 0;
      s.tuck = (flags & FLAG.tuck) !== 0;
      s.braking = (flags & FLAG.brake) !== 0;
      s.crashTimer = flags & FLAG.crash ? 1 : 0;
      this.m.normal(st[0], st[2], s.normal);
      v.model.setSeated(lift && s.airborne);
      v.model.update(s, s.pos, s.heading, this.ground, dt, sunDir);
      v.tag.position.set(st[0], st[1] + 2.4, st[2]);
      // on a lift they are out of reach; otherwise a moving obstacle where they are
      v.obstacle.x = lift ? 1e9 : st[0];
      v.obstacle.z = lift ? 1e9 : st[2];
    }
  }

  /** Where the other players are, for the trail map. */
  markers(): { name: string; x: number; z: number }[] {
    const out: { name: string; x: number; z: number }[] = [];
    for (const [id, v] of this.shown) out.push({ name: this.ride.remotes.get(id)?.name ?? '', x: v.s.pos.x, z: v.s.pos.z });
    return out;
  }

  private drop(id: string, v: Shown): void {
    this.group.remove(v.model.root, v.model.shadow, v.tag);
    v.tag.material.map?.dispose();
    v.tag.material.dispose();
    const k = this.m.dynamic.indexOf(v.obstacle);
    if (k >= 0) this.m.dynamic.splice(k, 1);
    this.shown.delete(id);
  }

  dispose(): void {
    for (const [id, v] of [...this.shown]) this.drop(id, v);
  }
}
