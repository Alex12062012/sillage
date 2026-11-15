import type { SkierInput } from '../sim/skier';

const approach = (v: number, target: number, step: number) =>
  v < target ? Math.min(target, v + step) : Math.max(target, v - step);
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

interface Finger { id: number; x0: number; y0: number; t0: number; x: number; y: number; side: -1 | 1; mode: 'hold' | 'jump' | 'brake' | 'button' }

const SWIPE_PX = 38;
const SWIPE_MS = 320;
const BRAKE_MS = 700; // a thumb pulled down within this long brakes

/**
 * One SkierInput per physics step from keyboard, touch, gamepad and tilt, laid out like Grand Mountain Adventure 2.
 * Touch: hold the left / right half = carve (analog ramp), both thumbs = jump when one lifts (a tap or a long
 * hold alike), swipe up = jump too, pull a thumb down and hold = brake, a short tap = a pole push (skating on
 * the flats). In the air: hold one side = spin, pull the thumbs back (down) and hold = backflip, push them
 * forward (up) and hold = frontflip, hold both = grab.
 * Keyboard (as GMA: Wonderlands on PC): ← → carve, ↓ brake, Space jump, in the air ↑ / ↓ flip and Space or
 * Shift held = grab; ↑ on the ground skates on the flats. Pad: stick carve, B / LT brake, A jump, A or RT grab.
 * Riding straight and fast, the skier tucks on their own (Game.step), as in GMA.
 */
export class Input {
  readonly keys = new Set<string>();
  /** Scripted override used by tests and the debug API (window.__sillage.drive). */
  override: Partial<SkierInput> | null = null;
  sensitivity = 1;
  tilt = false;
  private tiltSteer = 0;
  private steer = 0;
  private jumpQueued = false;
  /** Space / both thumbs / A or RT held at the last sample: a grab in the air, a faster lift when riding one. */
  holding = false;
  private airLockSteer = false;
  private airLockFlip = false;
  private fingers = new Map<number, Finger>();

  /** A short tap pushes on the poles until then (performance.now ms). */
  private pushUntil = 0;
  private padPrev: boolean[] = [];
  /** Any input this frame (used to leave the start gate / attract mode). */
  touched = false;
  /** Rumble on gamepads, vibrate on phones (setting). */
  haptics = true;
  private lastTouch = -Infinity;
  /** `code` is the physical key, `key` the letter it types (M is `Semicolon` on an AZERTY keyboard). */
  onKey: ((code: string, key: string) => void) | null = null;
  onPad: ((button: 'a' | 'b' | 'start' | 'y' | 'select' | 'up' | 'down') => void) | null = null;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // on a focused button / field, Space and arrows keep their native meaning (activate, slide)
      const inUi = !!(e.target as HTMLElement)?.closest?.('input, button, select');
      this.keys.add(e.code);
      if (e.code === 'Space' && !inUi) this.jumpQueued = true;
      if (!inUi && (e.code.startsWith('Arrow') || e.code === 'Space')) e.preventDefault();
      this.onKey?.(e.code, e.key);
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => { this.keys.clear(); this.fingers.clear(); });
  }

  private has(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** Touch steering on `el` (the canvas layer). Fingers starting on `.touch-btn` elements are buttons. */
  attachTouch(el: HTMLElement): void {
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      const onButton = (e.target as HTMLElement).closest('.touch-btn, .minimap, .hud-board'); // a tap on the minimap opens the map, it does not steer
      this.fingers.set(e.pointerId, {
        id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), x: e.clientX, y: e.clientY,
        side: e.clientX < window.innerWidth / 2 ? -1 : 1, mode: onButton ? 'button' : 'hold',
      });
      this.touched = true;
      this.lastTouch = performance.now();
    });
    el.addEventListener('pointermove', (e) => {
      const f = this.fingers.get(e.pointerId);
      if (!f) return;
      f.x = e.clientX;
      f.y = e.clientY;
      const age = performance.now() - f.t0;
      if (f.mode !== 'hold' || age > BRAKE_MS) return;
      const dy = f.y - f.y0;
      const dx = Math.abs(f.x - f.x0);
      if (dy < -SWIPE_PX && -dy > dx && age <= SWIPE_MS) { f.mode = 'jump'; this.jumpQueued = true; }
      else if (dy > SWIPE_PX && dy > dx) f.mode = 'brake'; // pulling a thumb down brakes, even slowly
    });
    const end = (e: PointerEvent) => {
      const f = this.fingers.get(e.pointerId);
      this.fingers.delete(e.pointerId);
      if (!f || f.mode !== 'hold' || e.type === 'pointercancel') return;
      const now = performance.now(), still = Math.hypot(f.x - f.x0, f.y - f.y0) < 20;
      const other = [...this.fingers.values()].find((o) => o.mode === 'hold' && o.side !== f.side);
      if (other) {
        // both thumbs down, one lifts (tap or long hold): jump; the other thumb then neither steers nor jumps again
        this.jumpQueued = true;
        other.mode = 'button';
      } else if (still && !other && now - f.t0 < 220) this.pushUntil = now + 350;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /**
   * Haptic hit: strong/weak motor 0..1 for `ms`. Gamepads get a dual rumble; a phone played by touch in
   * the last 10 s gets navigator.vibrate (Android; iOS has none).
   */
  rumble(strong: number, weak: number, ms: number): void {
    if (!this.haptics) return;
    const pad = navigator.getGamepads?.().find((g) => g && g.connected);
    if (pad?.vibrationActuator) {
      pad.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {});
    } else if (performance.now() - this.lastTouch < 10_000 && Math.max(strong, weak) > 0.25) {
      navigator.vibrate?.(Math.round(ms * Math.max(strong, weak)));
    }
  }

  /** Tutorial: are these keys held now. */
  held(...codes: string[]): boolean {
    return this.has(...codes);
  }

  /** Tutorial: a jump is asked and not yet taken (Space, two thumbs, a swipe up, A). */
  get jumpPending(): boolean {
    return this.jumpQueued;
  }

  /** Tutorial: which halves have a thumb resting, and whether a thumb is pulled down. */
  fingerState(): { left: boolean; right: boolean; pulled: boolean } {
    let left = false, right = false, pulled = false;
    for (const f of this.fingers.values()) {
      if (f.mode === 'hold') { if (f.side < 0) left = true; else right = true; }
      if (f.mode === 'brake') pulled = true;
    }
    return { left, right, pulled };
  }

  pressJump(): void {
    this.jumpQueued = true;
    this.touched = true;
  }

  /** iOS needs a permission prompt from a user gesture; resolves false if denied or unavailable. */
  async enableTilt(): Promise<boolean> {
    const D = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (!D) return false;
    try {
      if (typeof D.requestPermission === 'function' && (await D.requestPermission()) !== 'granted') return false;
    } catch {
      return false;
    }
    window.addEventListener('deviceorientation', (e) => {
      const angle = (screen.orientation?.angle ?? 0) % 360;
      const raw = angle === 90 ? e.beta : angle === 270 || angle === -90 ? -(e.beta ?? 0) : e.gamma;
      const deg = raw ?? 0;
      this.tiltSteer = clamp1((Math.abs(deg) < 3 ? 0 : deg - Math.sign(deg) * 3) / 22);
    });
    this.tilt = true;
    return true;
  }

  /** Inputs held at takeoff must be released before they spin or flip (no accidental tricks). */
  lockAirInputs(): void {
    this.airLockSteer = this.steer !== 0;
    this.airLockFlip = this.has('ArrowUp', 'KeyW', 'ArrowDown', 'KeyS');
  }

  /** Poll buttons only (menus while paused): fires onPad, never queues a jump. */
  pollPad(): void {
    this.pad(false);
  }

  private pad(queueJump = true): { steer: number; tuck: boolean; brake: boolean; flip: number; grab: boolean } | null {
    const p = navigator.getGamepads?.().find((g) => g && g.connected);
    if (!p) return null;
    const b = (i: number) => !!p.buttons[i]?.pressed;
    const edges: [number, 'a' | 'b' | 'start' | 'y' | 'select' | 'up' | 'down'][] = [[0, 'a'], [1, 'b'], [9, 'start'], [3, 'y'], [8, 'select'], [12, 'up'], [13, 'down']];
    for (const [i, name] of edges) {
      if (b(i) && !this.padPrev[i]) {
        this.touched = true;
        if (i === 0 && queueJump) this.jumpQueued = true;
        this.onPad?.(name);
      }
      this.padPrev[i] = b(i);
    }
    const ax = Math.abs(p.axes[0] ?? 0) > 0.15 ? p.axes[0] : 0;
    const steer = clamp1(ax + (b(15) ? 1 : 0) - (b(14) ? 1 : 0));
    const ay = Math.abs(p.axes[1] ?? 0) > 0.5 ? p.axes[1] : 0;
    const tuck = (p.buttons[7]?.value ?? 0) > 0.3;
    const brake = b(1) || (p.buttons[6]?.value ?? 0) > 0.3;
    if (steer || tuck || brake) this.touched = true;
    return { steer, tuck, brake, flip: Math.sign(ay), grab: b(0) || tuck };
  }

  sample(out: SkierInput, dt: number, airborne: boolean): SkierInput {
    const left = this.has('ArrowLeft', 'KeyA');
    const right = this.has('ArrowRight', 'KeyD');
    let up = this.has('ArrowUp', 'KeyW');
    let down = this.has('ArrowDown', 'KeyS');
    let target = (right ? 1 : 0) - (left ? 1 : 0);
    let flip = (down ? 1 : 0) - (up ? 1 : 0);
    if (left || right || up || down) this.touched = true;

    // touch: holds steer (both thumbs: brake on the snow, grab in the air), taps jump / push, swipes jump / brake / flip
    let holdL = false;
    let holdR = false;
    let swipeBrake = false;
    let swipeFlip = 0;
    for (const f of this.fingers.values()) {
      if (f.mode === 'hold') { if (f.side < 0) holdL = true; else holdR = true; }
      if (f.mode === 'brake') { swipeBrake = true; swipeFlip = -1; } // thumbs pulled back: backflip in the air
      if (f.mode === 'jump' && airborne) swipeFlip = 1; // thumbs pushed forward: frontflip
    }
    const now = performance.now();
    let touchGrab = false;
    if (this.tilt) {
      target = Math.abs(this.tiltSteer) > Math.abs(target) ? this.tiltSteer : target;
      up = up || holdL || holdR; // with tilt steering, a thumb tucks (grabs in the air)
      touchGrab = holdL || holdR;
    } else if (holdL && holdR) {
      if (airborne) touchGrab = true; // on the snow, both thumbs wait for one to lift: the jump
    } else if (holdL || holdR) target = holdR ? 1 : -1;
    if (now < this.pushUntil) up = true;
    down = down || swipeBrake;
    if (airborne && swipeFlip) flip = swipeFlip;

    let grab = this.has('Space', 'ShiftLeft', 'ShiftRight') || touchGrab;
    const pad = this.pad();
    if (pad) {
      if (Math.abs(pad.steer) > Math.abs(target)) target = pad.steer;
      up = up || pad.tuck;
      down = down || pad.brake;
      if (pad.flip) flip = pad.flip;
      grab = grab || pad.grab;
    }

    // analog-ish ramp: a tap is a small carve, a hold a full one (sensitivity scales both)
    const s = this.sensitivity;
    this.steer = approach(this.steer, clamp1(target * (0.75 + 0.25 * s)), dt / (target === 0 ? 0.06 : 0.15 / s));
    out.steer = this.steer;
    out.tuck = up && !airborne;
    out.brake = down && !airborne;
    out.jump = this.jumpQueued;
    out.flip = airborne ? flip : 0;
    out.grab = airborne && grab;
    this.holding = grab || (holdL && holdR); // both thumbs on a lift: faster
    this.jumpQueued = false;

    if (airborne) {
      if (this.airLockSteer && target === 0) this.airLockSteer = false;
      if (this.airLockFlip && flip === 0) this.airLockFlip = false;
      if (this.airLockSteer) out.steer = 0;
      if (this.airLockFlip) out.flip = 0;
    }
    if (this.override) Object.assign(out, this.override);
    return out;
  }

  /** True if anything was pressed since the last call (and clears the flag). */
  consumeTouched(): boolean {
    const t = this.touched;
    this.touched = false;
    return t;
  }
}
