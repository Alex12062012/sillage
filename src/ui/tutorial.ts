import type { Game } from '../game';
import { TUTO_TRACK } from '../sim/tracks';
import { kickerLength } from '../sim/track';
import { isTouch } from './menus';

type Step =
  | 'ride' | 'boarding' | 'liftWait' | 'liftSpeed' | 'lifting'
  | 'right' | 'rightGo' | 'left' | 'leftGo' | 'jump1' | 'jump1Air'
  | 'approach2' | 'jump2' | 'flipTakeoff' | 'flip' | 'flipLand' | 'retry'
  | 'trees' | 'brakeWait' | 'brake' | 'stopping' | 'done';

/** What the tutorial needs from main.ts. */
export interface TutorialHost {
  startRun(id: string): Promise<void>;
  /** Into the station's free ride, at the top of the lift taken in the tutorial (-1: its usual start). */
  goStation(trackId: string, lift: number): void;
}

/**
 * The first free ride starts with a tutorial: take the lift (Ride button), ride it faster (two thumbs), then a
 * tutorial run: a turn each way, a jump, a backflip, a little forest, a stop. Each lesson freezes the game on
 * the gesture to make (a pulsing outline, or circles where the thumbs go) until the player makes it.
 * A failed backflip goes back to just before its bump, not to the start. Skip (top left) at any time.
 */
export class Tutorial {
  active = false;
  private step: Step = 'ride';
  private t = 0;
  private air = 0;
  private frozen = false;
  private station = '';
  private lift = -1;
  private boardClicked = false;
  private root: HTMLDivElement;
  private card: HTMLDivElement;
  private fingers: HTMLDivElement;

  constructor(parent: HTMLElement, private game: Game, private host: TutorialHost, private onDone: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'tuto';
    this.root.hidden = true;
    this.root.innerHTML = '<button class="tuto-skip">Skip tutorial</button><div class="tuto-card" hidden></div><div class="tuto-fingers"></div>';
    parent.appendChild(this.root);
    this.card = this.root.querySelector('.tuto-card')!;
    this.fingers = this.root.querySelector('.tuto-fingers')!;
    this.root.querySelector('.tuto-skip')!.addEventListener('click', () => this.end());
    document.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest?.('.hud-board')) this.boardClicked = true; }, true);
  }

  /** Entering a station's free ride for the first time. */
  begin(stationTrack: string): void {
    this.active = true;
    this.station = stationTrack;
    this.lift = -1;
    this.go('ride');
    this.root.hidden = false;
  }

  /** R on the tutorial run: back to its first lesson. */
  restarted(): void {
    if (this.active && this.game.track.def.id === TUTO_TRACK.id) this.go('right');
  }

  /** Quit to the menu mid-tutorial: it will come back next time (not marked done). */
  cancel(): void {
    if (!this.active) return;
    this.active = false;
    this.clear();
    this.root.hidden = true;
    this.game.paused = false;
  }

  /** Finished or skipped: never again, and on to the station. */
  private end(): void {
    const onRun = this.game.track.def.id === TUTO_TRACK.id;
    this.cancel();
    this.onDone();
    if (onRun) this.host.goStation(this.station, this.lift);
  }

  private go(step: Step): void {
    this.step = step;
    this.t = 0;
    this.air = 0;
  }

  private freeze(text: string, fingers: [string, number, number][] = []): void {
    this.frozen = true;
    this.say(text);
    this.fingers.innerHTML = fingers.map(([kind, x, y]) => `<div class="tuto-finger ${kind}" style="left:${x}%;top:${y}%"></div>`).join('');
  }

  private thaw(): void {
    this.frozen = false;
    this.clear();
  }

  private say(text: string | null): void {
    this.card.hidden = !text;
    if (text) this.card.innerHTML = text;
  }

  private clear(): void {
    this.say(null);
    this.fingers.innerHTML = '';
    document.querySelector('.hud-board')?.classList.remove('tuto-pulse');
  }

  /** Every frame, before the game's. */
  update(dt: number, running: boolean): void {
    if (!this.active || !running) return;
    const g = this.game, inp = g.input, s = g.skier, touch = isTouch(), f = inp.fingerState();
    this.t += dt;
    const onRun = g.track.def.id === TUTO_TRACK.id;
    const k = g.track.kickers;
    const lip = (i: number) => (k[i] ? k[i].z + k[i].ramp : Infinity);
    switch (this.step) {
      case 'ride': {
        const btn = document.querySelector('.hud-board.show');
        if (!btn) break;
        if (!this.frozen) {
          this.boardClicked = false;
          this.freeze(touch ? 'Tap <b>Ride</b> to take the chairlift' : 'Click <b>Ride</b> (or press <kbd>Space</kbd>) to take the chairlift');
          btn.classList.add('tuto-pulse');
        } else if (this.boardClicked || inp.jumpPending) { this.thaw(); this.go('boarding'); }
        break;
      }
      case 'boarding':
        if (g.riding !== null) { this.lift = g.riding; this.go('liftWait'); }
        else if (this.t > 2) this.go('ride'); // the tap missed: ask again
        break;
      case 'liftWait':
        if (this.t > 1.2) {
          this.freeze(touch ? 'Hold <b>both thumbs</b> on the screen to ride faster' : 'Hold <kbd>Space</kbd> to ride faster', touch ? [['hold', 22, 66], ['hold', 78, 66]] : []);
          this.go('liftSpeed');
        }
        break;
      case 'liftSpeed':
        if ((f.left && f.right) || inp.held('Space')) { this.thaw(); this.go('lifting'); }
        break;
      case 'lifting':
        if (g.riding === null && g.mountain) { void this.host.startRun(TUTO_TRACK.id); this.go('right'); }
        break;
      case 'right':
        if (!onRun || this.t < 0.3) break;
        if (g.phase === 'ready') g.startAt(2, 6); // the run drops in by itself: the first lesson comes once gliding
        if (s.pos.z < 45 && !this.frozen) break;
        if (!this.frozen) this.freeze(touch ? 'Hold the <b>right</b> side to turn right' : 'Hold <kbd>→</kbd> to turn right', touch ? [['hold', 80, 60]] : []);
        else if ((f.right && !f.left) || inp.held('ArrowRight', 'KeyD')) { this.thaw(); this.go('rightGo'); }
        break;
      case 'rightGo':
        if (this.t > 1.0) { this.freeze(touch ? 'Now hold the <b>left</b> side to turn left' : 'Now hold <kbd>←</kbd> to turn left', touch ? [['hold', 20, 60]] : []); this.go('left'); }
        break;
      case 'left':
        if ((f.left && !f.right) || inp.held('ArrowLeft', 'KeyA')) { this.thaw(); this.go('leftGo'); }
        break;
      case 'leftGo':
        if (s.pos.z >= lip(0) - 3) { this.freeze(touch ? 'Tap with <b>both thumbs</b> to jump' : 'Press <kbd>Space</kbd> to jump', touch ? [['tap', 22, 66], ['tap', 78, 66]] : []); this.go('jump1'); }
        break;
      case 'jump1':
        if (inp.jumpPending) { this.thaw(); this.go('jump1Air'); }
        break;
      case 'jump1Air':
        if (s.pos.z > k[0].z + kickerLength(k[0]) - 10 || (this.t > 0.6 && !s.airborne)) this.go('approach2');
        break;
      case 'approach2':
        if (s.pos.z >= lip(1) - 3) { this.freeze(touch ? 'A bigger one: tap with <b>both thumbs</b> to jump' : 'A bigger one: press <kbd>Space</kbd> to jump', touch ? [['tap', 22, 66], ['tap', 78, 66]] : []); this.go('jump2'); }
        break;
      case 'jump2':
        if (inp.jumpPending) { this.thaw(); this.go('flipTakeoff'); }
        break;
      case 'flipTakeoff':
        if (s.airborne) this.air += dt;
        if (this.air > 0.15) {
          g.lastLand = null;
          this.freeze(touch ? 'Pull <b>both thumbs back</b> and hold for a backflip,<br>let go when you are upright' : 'Hold <kbd>S</kbd> or <kbd>↑</kbd> for a backflip,<br>let go when you are upright', touch ? [['pull', 22, 52], ['pull', 78, 52]] : []);
          this.go('flip');
        } else if (this.t > 1.5) this.retry();
        break;
      case 'flip':
        if (f.pulled || inp.held('ArrowUp', 'KeyS')) { this.thaw(); this.go('flipLand'); }
        break;
      case 'flipLand': {
        const e = g.lastLand;
        if (!e || e.type !== 'land') { if (this.t > 6) this.retry(); break; }
        if (e.quality !== 'crash' && Math.abs(e.flips) >= 1) { this.say('Nice backflip!'); this.go('trees'); }
        else this.retry();
        break;
      }
      case 'retry':
        if (this.t > 1.3) {
          this.say(null);
          g.reset();
          g.startAt(k[1].z - 35, 12.5); // just before the big bump (past the first one's landing), 45 km/h
          this.go('approach2');
        }
        break;
      case 'trees': {
        const glade = g.track.features.find((x) => x.type === 'glade');
        if (this.t < 1.5) break; // let "Nice backflip!" be read
        this.say(glade && s.pos.z > glade.z0 - 25 && s.pos.z < glade.z1 ? 'Steer around the trees' : null);
        if (!glade || s.pos.z >= glade.z1) { this.say(null); this.go('brakeWait'); }
        break;
      }
      case 'brakeWait':
        if (s.pos.z >= Math.min(g.track.def.length - 200, (g.track.features.find((x) => x.type === 'glade')?.z1 ?? 0) + 40)) {
          this.freeze(touch ? 'Pull a thumb <b>down</b> to brake' : 'Hold <kbd>S</kbd> or <kbd>↓</kbd> to brake', touch ? [['pull', 78, 52]] : []);
          this.go('brake');
        }
        break;
      case 'brake':
        if (f.pulled || inp.held('ArrowDown', 'KeyS')) { this.thaw(); this.go('stopping'); }
        break;
      case 'stopping':
        if (s.vel.length() < 1.5 || s.pos.z > g.track.def.length - 60) {
          this.freeze('You finished the tutorial! <button class="tuto-continue">Continue</button>');
          this.card.querySelector('.tuto-continue')!.addEventListener('click', () => this.end());
          this.go('done');
        }
        break;
      case 'done':
        break;
    }
    g.paused = this.frozen;
  }

  private retry(): void {
    this.thaw();
    this.say('Almost! Try that backflip again');
    this.go('retry');
  }
}
