import type { SkierColors } from '../render/skierModel';

/** The portail.io server (Render) relays the free ride's skiers, one channel per station (server/games/sillage.js there). */
export const PORTAL_URL = 'https://portail-io.onrender.com';

/** What each skier sends ~15 times a second: x, y, z, heading, vx, vy, vz, edge, skid, flags (FLAG.*). */
export type WireState = number[];
export const FLAG = { air: 1, tuck: 2, brake: 4, crash: 8, lift: 16 } as const;
const SEND_EVERY = 1 / 15;
/** Others are drawn this far in the past, between two states they sent (no jerks at 15 Hz with some jitter). */
export const DELAY = 0.15;

export interface Remote { id: string; name: string; look: SkierColors; buf: { t: number; s: WireState }[] }
/** The subset of a socket.io client the ride uses (a fake one in the tests). */
export interface Wire {
  connected: boolean;
  on(ev: string, fn: (...a: never[]) => void): void;
  emit(ev: string, ...a: unknown[]): void;
  disconnect(): void;
}

const lookOf = (c: number[] | undefined): SkierColors => ({ jacket: c?.[0] ?? 0x888888, pants: c?.[1] ?? 0x333333, helmet: c?.[2] ?? 0xffffff, skis: c?.[3] ?? 0x3a7bd5 });

/**
 * The online free ride: joins the station's channel on the portal, sends our skier, keeps the others' recent states.
 * Offline (no server, it sleeps: Render's free plan wakes in ~30 s) the game just stays solo, and joins once it answers.
 */
export class OnlineRide {
  readonly remotes = new Map<string, Remote>();
  status: 'connecting' | 'online' | 'offline' = 'connecting';
  onBumped?: (from: Remote | undefined, vx: number, vz: number) => void;
  onJoin?: (r: Remote) => void;
  onLeave?: (r: Remote) => void;
  private wire: Wire | null = null;
  private clock = 0;
  private sent = 0;

  constructor(readonly station: string, readonly name: string, readonly look: SkierColors) {}

  /** Connects (socket.io loaded on demand: solo players never download it). */
  async start(url = PORTAL_URL): Promise<void> {
    const { io } = await import('socket.io-client');
    this.attach(io(url, { transports: ['websocket'], reconnectionDelayMax: 10000, timeout: 60000 }) as unknown as Wire);
  }

  attach(wire: Wire): void {
    this.wire = wire;
    const join = () => wire.emit('sillage:join', { station: this.station, name: this.name, look: [this.look.jacket, this.look.pants, this.look.helmet, this.look.skis] },
      (res: { ok: boolean; skiers?: { id: string; name: string; look: number[] }[] }) => {
        this.status = res?.ok ? 'online' : 'offline';
        this.remotes.clear();
        for (const k of res?.skiers ?? []) this.add(k);
      });
    wire.on('connect', join);
    wire.on('disconnect', () => { this.status = 'offline'; this.remotes.clear(); });
    wire.on('connect_error', () => { this.status = 'offline'; });
    wire.on('sillage:joined', (k: { id: string; name: string; look: number[] }) => this.onJoin?.(this.add(k)));
    wire.on('sillage:left', (id: string) => {
      const r = this.remotes.get(id);
      this.remotes.delete(id);
      if (r) this.onLeave?.(r);
    });
    wire.on('sillage:states', (states: Record<string, WireState>) => {
      for (const [id, s] of Object.entries(states)) {
        const r = this.remotes.get(id);
        if (!r) continue;
        r.buf.push({ t: this.clock, s });
        if (r.buf.length > 8) r.buf.shift();
      }
    });
    wire.on('sillage:bumped', (b: { id: string; vx: number; vz: number }) => this.onBumped?.(this.remotes.get(b.id), b.vx, b.vz));
    if (wire.connected) join();
  }

  private add(k: { id: string; name: string; look: number[] }): Remote {
    const r: Remote = { id: k.id, name: k.name, look: lookOf(k.look), buf: [] };
    this.remotes.set(k.id, r);
    return r;
  }

  /** Every frame: our state (sent at 15 Hz while online). */
  update(dt: number, state: WireState): void {
    this.clock += dt;
    if (this.status !== 'online' || !this.wire?.connected || this.clock - this.sent < SEND_EVERY * 0.95) return; // (frame-time jitter)
    this.sent = this.clock;
    this.wire.emit('sillage:state', state);
  }

  /** Remote r as it was DELAY s ago, between the two states around that time (the latest one if it has stopped sending). */
  sample(r: Remote, out: WireState): WireState | null {
    const b = r.buf;
    if (!b.length) return null;
    const t = this.clock - DELAY;
    let k = b.length - 1;
    while (k > 0 && b[k - 1].t > t) k--;
    const a = b[Math.max(0, k - 1)], c = b[k];
    const f = c.t === a.t ? 1 : Math.min(1, Math.max(0, (t - a.t) / (c.t - a.t)));
    for (let i = 0; i < c.s.length; i++) {
      if (i === 3) { // heading: the short way round
        const d = Math.atan2(Math.sin(c.s[3] - a.s[3]), Math.cos(c.s[3] - a.s[3]));
        out[i] = a.s[3] + d * f;
      } else out[i] = i === 9 ? c.s[i] : a.s[i] + (c.s[i] - a.s[i]) * f;
    }
    out.length = c.s.length;
    return out;
  }

  /** We ran into r: it falls too. */
  bump(r: Remote, vx: number, vz: number): void {
    this.wire?.emit('sillage:bump', { id: r.id, vx, vz });
  }

  stop(): void {
    this.wire?.emit('sillage:leave');
    this.wire?.disconnect();
    this.wire = null;
    this.remotes.clear();
    this.status = 'offline';
  }
}
