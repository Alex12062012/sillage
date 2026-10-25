import { describe, expect, it } from 'vitest';
import { DELAY, FLAG, OnlineRide, type Wire } from '../../src/net/online';

/** A socket.io client stand-in: records what is sent, lets the test play the server. */
function fakeWire() {
  const handlers = new Map<string, ((...a: unknown[]) => void)[]>();
  const sent: { ev: string; args: unknown[] }[] = [];
  const wire: Wire & { server(ev: string, ...a: unknown[]): void; sent: typeof sent } = {
    connected: false,
    on: (ev, fn) => void handlers.set(ev, [...(handlers.get(ev) ?? []), fn as (...a: unknown[]) => void]),
    emit: (ev, ...args) => void sent.push({ ev, args }),
    disconnect: () => { wire.connected = false; },
    server: (ev, ...a) => handlers.get(ev)?.forEach((f) => f(...a)),
    sent,
  };
  return wire;
}

describe('online free ride', () => {
  const look = { jacket: 0xff0000, pants: 0x00ff00, helmet: 0x0000ff, skis: 0xffffff };

  it('joins its station on connect, under its name and outfit, and lists who is there', () => {
    const w = fakeWire();
    const ride = new OnlineRide('avoriaz', 'Alex', look);
    ride.attach(w);
    w.connected = true;
    w.server('connect');
    const join = w.sent.find((m) => m.ev === 'sillage:join')!;
    expect(join.args[0]).toEqual({ station: 'avoriaz', name: 'Alex', look: [0xff0000, 0x00ff00, 0x0000ff, 0xffffff] });
    (join.args[1] as (r: unknown) => void)({ ok: true, skiers: [{ id: 'b', name: 'Bob', look: [1, 2, 3, 4] }] });
    expect(ride.status).toBe('online');
    expect([...ride.remotes.values()].map((r) => r.name)).toEqual(['Bob']);
    let joined = '', left = '';
    ride.onJoin = (r) => { joined = r.name; };
    ride.onLeave = (r) => { left = r.name; };
    w.server('sillage:joined', { id: 'c', name: 'Cleo', look: [] });
    w.server('sillage:left', 'b');
    expect([joined, left]).toEqual(['Cleo', 'Bob']);
    expect([...ride.remotes.keys()]).toEqual(['c']);
  });

  it('sends its state 15 times a second, only once online', () => {
    const w = fakeWire();
    const ride = new OnlineRide('rousses', 'Alex', look);
    ride.attach(w);
    for (let i = 0; i < 60; i++) ride.update(1 / 60, [1, 2, 3, 0, 0, 0, 0, 0, 0, 0]);
    expect(w.sent.filter((m) => m.ev === 'sillage:state')).toHaveLength(0); // not connected yet
    w.connected = true;
    w.server('connect');
    (w.sent.find((m) => m.ev === 'sillage:join')!.args[1] as (r: unknown) => void)({ ok: true, skiers: [] });
    for (let i = 0; i < 60; i++) ride.update(1 / 60, [1, 2, 3, 0, 0, 0, 0, 0, 0, FLAG.tuck]);
    const n = w.sent.filter((m) => m.ev === 'sillage:state').length;
    expect(n).toBeGreaterThanOrEqual(14);
    expect(n).toBeLessThanOrEqual(16);
  });

  it('draws the others smoothly, DELAY s in the past, between the states they sent', () => {
    const w = fakeWire();
    const ride = new OnlineRide('avoriaz', 'Alex', look);
    ride.attach(w);
    w.connected = true;
    w.server('connect');
    (w.sent.find((m) => m.ev === 'sillage:join')!.args[1] as (r: unknown) => void)({ ok: true, skiers: [{ id: 'b', name: 'Bob', look: [] }] });
    const bob = ride.remotes.get('b')!;
    // Bob moves 1 m per state, 15 states a second, heading across ±π (the short way round)
    for (let k = 0; k < 15; k++) {
      w.server('sillage:states', { b: [k, 0, 0, k % 2 ? 3.1 : -3.1, 15, 0, 0, 0, 0, k >= 12 ? FLAG.air : 0] });
      for (let i = 0; i < 4; i++) ride.update(1 / 60, []);
    }
    const out: number[] = [];
    const st = ride.sample(bob, out)!;
    // the k-th state arrived at k/15 s; at 1 s, drawn as of 1 - DELAY s: between two states, Bob at x = 15 (1 - DELAY)
    expect(st[0]).toBeCloseTo(15 * (1 - DELAY), 1);
    expect(Math.abs(Math.abs(st[3]) - Math.PI)).toBeLessThan(0.1); // never swung through 0
    expect(st[9]).toBe(FLAG.air); // flags are not blended
  });

  it('a hit is reported to the other, and their hit on us comes back', () => {
    const w = fakeWire();
    const ride = new OnlineRide('avoriaz', 'Alex', look);
    ride.attach(w);
    w.connected = true;
    w.server('connect');
    (w.sent.find((m) => m.ev === 'sillage:join')!.args[1] as (r: unknown) => void)({ ok: true, skiers: [{ id: 'b', name: 'Bob', look: [] }] });
    ride.bump(ride.remotes.get('b')!, 12, -3);
    expect(w.sent.at(-1)).toEqual({ ev: 'sillage:bump', args: [{ id: 'b', vx: 12, vz: -3 }] });
    let by = '';
    ride.onBumped = (r) => { by = r?.name ?? ''; };
    w.server('sillage:bumped', { id: 'b', vx: 1, vz: 2 });
    expect(by).toBe('Bob');
    w.server('disconnect');
    expect(ride.status).toBe('offline');
    expect(ride.remotes.size).toBe(0);
  });
});
