import { Group, MathUtils, Mesh, Scene, Vector3, type MeshBasicMaterial, type WebGLRenderer } from 'three';
import { GameAudio } from './audio/audio';
import { Input } from './input/input';
import { ChaseCamera } from './render/camera';
import { Flakes, pointScale, SkiTrails, SnowFx, type SceneLight } from './render/fx';
import { buildChunkProps, buildLandmarks } from './render/props';
import { SkierModel, type SkierColors } from './render/skierModel';
import { Sky } from './render/sky';
import { addSnowSparkle, Terrain } from './render/terrain';
import { Crowd } from './render/crowd';
import { MountainView } from './render/mountainView';
import { botInput } from './sim/bot';
import { FREE_ID, makeMountain, type Mountain, type Spot } from './sim/mountain';
import { createFlow, stepFlow, type FlowEvent, type FlowState } from './sim/flow';
import { CHALLENGE_TITLE, CHALLENGES, describeChallenge, liveTier, progressText, type RunStats } from './sim/missions';
import { createRun, runStats, SlowMo, spinDegrees, stepRun, type RunEvent, type RunState } from './sim/run';
import { createSkier, stepSkier, type SkierEvent, type SkierInput, type SkierState } from './sim/skier';
import { makeTrack, Surface, type Track, type TrackDef } from './sim/track';
import { TUNING as T } from './tuning';
import { FLOW_NAMES, type ChallengeRow, type Hud } from './ui/hud';

export const DT = 1 / 60;
const MAX_STEPS = 5;
const CRASH_LINES = ['Yard sale!', 'Faceplant!', 'Oof!', 'Snow angel!'];
const TIER_NAME = ['', 'Bronze', 'Silver', 'Gold'];
const SPEED_MILESTONES = [80, 100, 120];

type LandEvent = Extract<SkierEvent, { type: 'land' }>;

/** ready: waiting at the start gate for the first input · running · finished: run-out, then results. */
export type Phase = 'ready' | 'running' | 'finished';

/** Owns one run: fixed-step simulation, interpolated rendering and all the feel layers. */
export class Game {
  readonly scene = new Scene();
  readonly input = new Input();
  readonly audio = new GameAudio();
  readonly cam: ChaseCamera;
  track!: Track;
  readonly sky: Sky;
  private terrain: Terrain | null = null;
  /** Free ride only: Les Rousses, its view (lifts, forests, villages) and the other skiers. */
  mountain: Mountain | null = null;
  private view: MountainView | null = null;
  private crowd: Crowd | null = null;
  private ride: { lift: number; f: number; t: number } | null = null;
  private piste: Mountain['pistes'][number] | null = null;
  private pisteTick = 0;
  private world = new Group();
  skier!: SkierState;
  run!: RunState;
  flow: FlowState = createFlow();
  private model = new SkierModel();
  private fx = new SnowFx();
  private flakes = new Flakes(T.flakeCount);
  private trails = new SkiTrails();
  private slowmo = new SlowMo();
  private prevPos = new Vector3();
  private renderPos = new Vector3();
  private prevHeading = 0;
  private inp: SkierInput = { steer: 0, tuck: false, brake: false, jump: false, flip: 0 };
  private sEv: SkierEvent[] = [];
  private rEv: RunEvent[] = [];
  private fEv: FlowEvent[] = [];
  private acc = 0;
  /** A landing waits for the run's points (same step) before it pops. */
  private landing: { e: LandEvent; points: number } | null = null;
  private jumped = false;
  private halfTurns = 0;
  private flipsShown = 0;
  private milestone = 0;
  private wasTuck = false;
  private plant = new Vector3();
  private light: SceneLight;
  private sparkle: ReturnType<typeof addSnowSparkle> | null = null;
  private quality: 'low' | 'medium' | 'high' = 'high';
  /** Autopilot target speed in m/s (tests, captures, attract mode), or null. */
  bot: number | null = null;
  botGap = 2.4;
  phase: Phase = 'ready';
  paused = false;
  /** Best tier already owned per challenge (from the save): live pops only fire above it. */
  bestTiers: Record<string, number> = {};
  private liveTiers: Record<string, number> = {};
  private finishTimer = -1;
  private hudTick = 0;
  private hudPhase: Phase | null = null;
  private landmarks: Group | null = null;
  onFinish: ((stats: RunStats) => void) | null = null;
  onStart: (() => void) | null = null;
  time = 0;
  fps = 0;
  private fpsN = 0;
  private fpsT = 0;

  constructor(private renderer: WebGLRenderer, def: TrackDef, private hud: Hud) {
    this.sky = new Sky(this.scene);
    this.light = { sun: this.sky.sun.color, sunIntensity: 1, sky: this.sky.hemi.color, ground: this.sky.hemi.groundColor, sunDir: this.sky.sunDirection };
    this.scene.add(this.world, this.model.root, this.model.shadow, this.trails.mesh, this.flakes.points, ...this.fx.objects);
    this.cam = new ChaseCamera(1);
    this.load(def);
  }

  /** Builds the world for a run definition (chunks stream in as the skier moves). */
  load(def: TrackDef): void {
    this.terrain?.dispose();
    this.view?.dispose();
    this.terrain = this.view = this.crowd = this.mountain = null;
    this.landmarks?.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      o.geometry.dispose();
      const m = o.material as MeshBasicMaterial;
      m.map?.dispose();
      m.dispose();
    });
    this.world.clear();
    if (def.id === FREE_ID) {
      // free ride: one open mountain, built once (no streaming), with its lifts and its crowd
      this.track = this.mountain = makeMountain();
      this.view = new MountainView(this.mountain);
      this.crowd = new Crowd(this.mountain);
      this.sparkle = addSnowSparkle(this.view.material);
      this.landmarks = null;
      this.world.add(this.view.group, this.crowd.group);
    } else {
      this.track = makeTrack(def);
      this.terrain = new Terrain(this.track, buildChunkProps);
      this.terrain.viewDistance = this.viewDistance;
      this.sparkle = addSnowSparkle(this.terrain.material);
      this.landmarks = buildLandmarks(this.track);
      this.world.add(this.terrain.group, this.landmarks);
    }
    this.sparkle.setQuality(this.quality);
    this.setQuality(this.quality);
    this.hud.el.classList.toggle('free', !!this.mountain);
    this.cam.camera.far = this.mountain ? 40000 : 3000; // from La Dôle you see the Léman
    this.cam.camera.updateProjectionMatrix();
    this.sky.showPeaks(!this.mountain);
    this.sky.setTime(def.timeOfDay);
    this.reset();
  }

  reset(): void {
    const z0 = -8;
    const at = this.mountain?.spawn;
    this.skier = at ? createSkier(this.track, at.x, at.z, at.heading) : createSkier(this.track, this.track.centerX(z0), z0, 0);
    this.ride = null;
    this.view?.leaveSeat();
    this.model.setSeated(false);
    this.run = createRun(this.track.def.length, this.track.def.par);
    this.flow = createFlow();
    this.phase = 'ready';
    this.hudPhase = null;
    this.finishTimer = -1;
    this.liveTiers = { ...this.bestTiers };
    this.slowmo = new SlowMo();
    this.landing = null;
    this.milestone = 0;
    this.prevPos.copy(this.skier.pos);
    this.prevHeading = this.skier.heading;
    this.renderPos.copy(this.skier.pos);
    this.cam.snap(this.skier.pos, this.skier.heading);
    this.trails.reset();
    this.acc = 0;
    this.hud.trick(null);
    this.audio.setFlow(0);
    this.sky.setTime(this.track.def.timeOfDay);
    this.terrain?.prewarm(this.skier.pos.z);
  }

  /** Drop the skier mid-run at `z` (attract mode / tests): already moving, clock running. */
  startAt(z: number, speed: number): void {
    const s = this.skier;
    const at = this.mountain?.spawn; // the open mountain: from the top of La Dôle
    if (at) z = at.z;
    const x = at ? at.x : this.track.centerX(z);
    const heading = at ? at.heading : Math.atan((this.track.centerX(z + 1) - this.track.centerX(z - 1)) / 2);
    s.pos.set(x, this.track.height(x, z), z);
    s.heading = heading;
    s.vel.set(Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(speed);
    this.prevPos.copy(s.pos);
    this.prevHeading = heading;
    this.renderPos.copy(s.pos);
    this.phase = 'running';
    this.cam.snap(s.pos, heading);
    this.terrain?.prewarm(z);
  }

  setOutfit(c: SkierColors): void {
    this.model.setColors(c);
  }

  setComfort(on: boolean): void {
    this.cam.comfort = on;
    this.fx.setComfort(on);
  }

  setFirstPerson(on: boolean): void {
    this.cam.firstPerson = on;
    this.model.setFirstPerson(on);
  }

  stats(): RunStats {
    return runStats(this.run);
  }

  readyText = 'Press <b>↑</b> or an arrow key to drop in';

  challengeRows(): ChallengeRow[] {
    const st = this.stats();
    return (CHALLENGES[this.track.def.id] ?? []).map((c) => {
      const tier = Math.max(this.liveTiers[c.id] ?? 0, this.bestTiers[c.id] ?? 0);
      return { title: CHALLENGE_TITLE[c.kind], goal: tier < 3 ? describeChallenge(c, tier + 1) : 'Gold ✓', value: progressText(c, st), tier };
    });
  }

  /** The player is at the controls (not the attract bot, tests or captures): haptics and musical feedback. */
  private get live(): boolean {
    return this.bot === null;
  }

  private rumble(strong: number, weak: number, ms: number): void {
    if (this.live) this.input.rumble(strong, weak, ms);
  }

  private step(): void {
    const s = this.skier;
    this.prevPos.copy(s.pos);
    this.prevHeading = s.heading;
    this.input.sample(this.inp, DT, s.airborne);
    if (s !== this.skier) return; // a pad callback restarted / loaded the run mid-step: drop the stale step
    if (this.bot) botInput(s, this.track, this.inp, this.bot, this.botGap);
    if (this.ride) {
      this.rideStep(s);
      return;
    }
    if (this.phase === 'ready') {
      // standing in the gate: the first real input starts the run (with a pole push)
      if (!this.inp.tuck && !this.inp.jump && Math.abs(this.inp.steer) < 0.05 && !this.inp.brake) return;
      this.phase = 'running';
      this.inp.tuck = true;
      // skating push-off out of the gate: the run starts the instant you ask for it
      s.vel.set(Math.sin(s.heading), 0, Math.cos(s.heading)).multiplyScalar(5);
      this.onStart?.();
    }
    if (this.phase === 'finished') {
      this.inp.steer = 0;
      this.inp.tuck = false;
      this.inp.jump = false;
      this.inp.brake = true;
    }
    this.sEv.length = 0;
    this.rEv.length = 0;
    this.fEv.length = 0;
    this.jumped = false;
    stepSkier(s, this.inp, this.track, DT, this.sEv);
    stepRun(this.run, s, this.track, DT, this.sEv, this.rEv);
    stepFlow(this.flow, s, DT, this.sEv, this.rEv, this.fEv);
    if (this.mountain) this.freeRide(s);
    for (const e of this.sEv) this.onSkierEvent(e);
    for (const e of this.rEv) this.onRunEvent(e);
    for (const e of this.fEv) this.onFlowEvent(e);
    if (this.landing) this.landed(this.landing.e, this.landing.points);
    if (this.phase === 'running') this.liveMedals();
    if (this.finishTimer >= 0) {
      this.finishTimer += DT;
      if (this.finishTimer > 1.3) {
        this.finishTimer = -1;
        this.onFinish?.(this.stats());
      }
    }
  }

  /** Free ride: ski into a bottom station to take its lift; name the piste you enter; skate on the flats. */
  private freeRide(s: SkierState): void {
    const m = this.mountain!;
    const speed = s.vel.length();
    if (!s.airborne && s.crashTimer <= 0) {
      if (speed < 15) {
        let best = -1, bd = 14;
        m.lifts.forEach((l, i) => {
          const d = Math.hypot(s.pos.x - l.pts[0], s.pos.z - l.pts[1]);
          if (d < bd) { bd = d; best = i; }
        });
        if (best >= 0) {
          this.ride = { lift: best, f: 0, t: 0 };
          this.hud.pop(m.lifts[best].name, 'info', this.bot ? undefined : 'any key to skip');
          if (this.bot) this.ride.f = 1; // attract mode: straight back to the top
          return;
        }
      }
      // skating: forward on the flats (and the liaisons' little climbs) pushes you along
      if (this.inp.tuck && speed < 6) {
        s.vel.x += Math.sin(s.heading) * 2.4 * DT;
        s.vel.z += Math.cos(s.heading) * 2.4 * DT;
      }
    }
    const b = m.bounds;
    if (s.pos.x < b.x0 + 30 || s.pos.x > b.x1 - 30 || s.pos.z < b.z0 + 30 || s.pos.z > b.z1 - 30) {
      this.hud.pop('Out of bounds', 'bad');
      this.unload(m.respawn(s.pos.z, s.pos.x));
      return;
    }
    if (this.bot && speed < 1 && (this.stuck += DT) > 4) this.toSummit(); // attract mode: never stand still
    if (speed > 1) this.stuck = 0;
    if ((this.pisteTick += DT) < 0.5) return;
    this.pisteTick = 0;
    const p = m.pisteAt(s.pos.x, s.pos.z)?.p ?? null;
    if (p && p !== this.piste && p.name && this.live) this.hud.pop(p.name, 'info', p.difficulty);
    if (p) this.piste = p;
  }
  private stuck = 0;

  /** Riding a lift: the chair carries the skier up, a drag lift tows them along the snow; any input skips to the top. */
  private rideStep(s: SkierState): void {
    const r = this.ride!;
    const view = this.view!;
    const l = this.mountain!.lifts[r.lift];
    r.t += DT;
    r.f += (l.speed * DT) / l.len;
    const skip = r.t > 0.6 && (this.inp.jump || this.inp.tuck || this.inp.brake || Math.abs(this.inp.steer) > 0.5);
    if (r.f >= 1 || skip) {
      this.unload(this.mountain!.unload(r.lift));
      return;
    }
    const chair = l.kind === 'chair';
    if (chair) view.seat(r.lift, r.f, s.pos);
    else view.tow(r.lift, r.f, s.pos);
    const yaw = view.liftYaw(r.lift, r.f);
    s.vel.set(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(l.speed);
    s.heading = yaw;
    s.airborne = chair;
    s.tuck = false;
    s.edge = s.skid = 0;
    if (!chair) this.mountain!.normal(s.pos.x, s.pos.z, s.normal);
    this.model.setSeated(chair);
  }

  /** Off the lift (or teleported): on the snow at a spot, facing down the nearest piste. */
  unload(at: Spot): void {
    const s = this.skier;
    const m = this.mountain!;
    this.ride = null;
    this.view?.leaveSeat();
    this.model.setSeated(false);
    s.pos.set(at.x, m.height(at.x, at.z), at.z);
    s.heading = at.heading;
    s.vel.set(Math.sin(s.heading), 0, Math.cos(s.heading)).multiplyScalar(4);
    s.airborne = false;
    s.tuck = false;
    m.normal(at.x, at.z, s.normal);
    this.prevPos.copy(s.pos);
    this.trails.reset();
    this.cam.snap(s.pos, s.heading);
  }

  /** Free ride shortcut (T): straight to the top of La Dôle. */
  toSummit(): void {
    if (!this.mountain || this.paused) return;
    this.phase = 'running';
    this.unload(this.mountain.summit);
  }

  /** Speed / air / chain / spin medals pop the moment they are earned (Traffic Rider's instant objective). */
  private liveMedals(): void {
    const st = this.stats();
    for (const c of CHALLENGES[this.track.def.id] ?? []) {
      const t = liveTier(c, st);
      if (t > (this.liveTiers[c.id] ?? 0)) {
        this.liveTiers[c.id] = t;
        this.audio.medal(t);
        this.hud.pop(`${TIER_NAME[t]} · ${describeChallenge(c, t)}`, 'great');
      }
    }
  }

  private onSkierEvent(e: SkierEvent): void {
    const s = this.skier;
    this.model.onEvent(e);
    switch (e.type) {
      case 'jump':
        this.jumped = true;
        this.audio.jump();
        this.rumble(0.15, 0.4, 60);
        break;
      case 'takeoff':
        this.input.lockAirInputs();
        this.halfTurns = 0;
        this.flipsShown = 0;
        this.fx.takeoff(s, s.pos, this.jumped);
        this.audio.takeoff(this.jumped);
        break;
      case 'pump':
        this.audio.pump();
        break;
      case 'edgeChange':
        if (!e.clean && this.live) this.audio.edgeChange(0, false); // clean ones come as flow beats
        break;
      case 'grab':
        this.audio.grab(true);
        this.rumble(0, 0.3, 40);
        break;
      case 'land':
        if (e.quality !== 'crash') this.landing = { e, points: 0 };
        break;
      case 'crash':
        this.audio.crash();
        this.cam.addTrauma(0.85);
        this.fx.crash(s, s.pos);
        this.hud.trick(null);
        this.hud.pop(e.reason === 'obstacle' ? 'Tree hugger!' : CRASH_LINES[this.run.crashes % CRASH_LINES.length], 'bad');
        if (!this.cam.comfort) this.hud.flash('crash', 0.7);
        this.slowmo.trigger(0.5, 0.15, 0.3);
        this.rumble(1, 0.8, 380);
        break;
    }
  }

  /** Touchdown, with the points the run paid for it: thump, snow, camera dip, readout, and the perfect hit. */
  private landed(e: LandEvent, points: number): void {
    const s = this.skier;
    this.landing = null;
    this.hud.trick(null);
    this.audio.land(e.vn, e.quality, points);
    this.fx.land(s, s.pos, e.vn, e.quality);
    this.cam.impact(e.vn);
    this.cam.addTrauma(MathUtils.clamp((e.vn - 2.5) / 10, 0, 0.75));
    this.rumble(MathUtils.clamp(e.vn / 12, 0.15, 1), 0.5, 80 + e.vn * 12);
    const deg = spinDegrees(e.spin);
    const trick = [deg >= 180 ? String(deg) : '', e.flips ? `${e.flips > 1 ? `${e.flips}× ` : ''}Flip` : '', (e.grab ?? 0) > 0 ? 'Grab' : '']
      .filter(Boolean).join(' + ');
    const sub = points > 0 ? `+${points.toLocaleString('en-US')}` : undefined;
    const big = !!trick || e.airTime >= 0.8;
    if (e.quality === 'perfect' && big) {
      if (!this.cam.comfort) {
        this.slowmo.trigger(0.12, T.perfectHitstop, 0.12); // the stomp lands like a hit
        this.hud.flash('perfect', 0.8);
      }
      this.cam.fovKick(5);
    }
    if (e.quality === 'switch') this.hud.pop(`${trick ? `${trick} · ` : ''}Switch!`, 'great', sub);
    else if (e.quality === 'sketchy') this.hud.pop('Sketchy…', 'bad', sub);
    else if (trick) this.hud.pop(`${trick} · ${e.quality === 'perfect' ? 'Perfect!' : 'Clean'}`, 'great', sub);
    else if (e.airTime >= 1) this.hud.pop(`Big air ${e.airTime.toFixed(1)}s${e.quality === 'perfect' ? ' · Perfect!' : ''}`, e.quality === 'perfect' ? 'great' : 'good', sub);
    else if (e.vn > T.landHardVn) this.hud.pop('Hard landing', 'bad');
    if (e.lateGrab) this.hud.pop('Let go before you land!', 'info');
  }

  private onRunEvent(e: RunEvent): void {
    switch (e.type) {
      case 'landPoints':
        if (this.landing) this.landing.points = e.points;
        break;
      case 'nearMiss':
        this.audio.nearMiss(e.side, e.razor, e.chain);
        this.fx.treeShake(e.x, this.track.height(e.x, e.z), e.z, e.h, e.kind, e.razor);
        this.cam.fovPunch();
        this.cam.addTrauma(e.razor ? 0.15 : 0.06);
        if (e.razor && !this.cam.comfort) this.hud.flash('razor', 0.6);
        this.rumble(e.razor ? 0.5 : 0.2, 0.7, e.razor ? 120 : 70);
        this.hud.pop(`${e.razor ? 'RAZOR' : 'Close call'}${e.chain > 1 ? ` ×${e.chain}` : ''}`, e.razor ? 'great' : 'good', `+${e.points}`);
        break;
      case 'slowmo':
        if (!this.cam.comfort || e.scale > 0.5) this.slowmo.trigger(e.scale, e.hold, e.ease);
        break;
      case 'finish':
        this.phase = 'finished';
        this.finishTimer = 0;
        this.audio.finish();
        this.cam.finishShot();
        if (!this.cam.comfort) this.slowmo.trigger(0.45, 0.3, 0.5);
        this.rumble(0.4, 0.6, 260);
        this.hud.pop('Finish!', 'great');
        break;
    }
  }

  private onFlowEvent(e: FlowEvent): void {
    switch (e.type) {
      case 'beat':
        this.hud.beat();
        this.cam.beat(this.flow.level);
        if (this.live) this.audio.edgeChange(e.streak, true);
        this.rumble(0, 0.12 + 0.06 * this.flow.level, 35);
        break;
      case 'level':
        this.audio.setFlow(e.level);
        if (e.up) {
          this.hud.pop(FLOW_NAMES[e.level], 'info');
          this.cam.fovKick(2 + e.level);
        }
        break;
    }
  }

  /** Graphics level: view distance + fog, falling snow density, snow fx budget. */
  setQuality(q: 'low' | 'medium' | 'high'): void {
    const view = { low: 300, medium: 390, high: 470 }[q];
    if (this.terrain) this.terrain.viewDistance = view;
    this.viewDistance = view;
    // the open mountain is seen whole, to the Léman and beyond: a long, thin haze
    this.sky.fog.far = this.mountain ? view * 50 : view;
    this.sky.fog.near = this.mountain ? view * 2 : view * 0.26;
    this.flakes.points.geometry.setDrawRange(0, Math.round(T.flakeCount * { low: 0.4, medium: 0.7, high: 1 }[q]));
    this.quality = q;
    this.view?.setQuality(q);
    this.fx.setQuality(q);
    this.sparkle?.setQuality(q);
  }
  private viewDistance = 470;

  frame(realDt: number): void {
    if (this.paused) {
      this.input.pollPad(); // a pad-only player must be able to resume
      this.audio.update(0, 0, 0, this.skier.surface, true, true, realDt); // hush wind and edges
      this.renderer.render(this.scene, this.cam.camera);
      return;
    }
    const scale = this.slowmo.update(realDt);
    const gdt = realDt * scale;
    this.time += gdt;
    this.acc += gdt;
    let steps = 0;
    while (this.acc >= DT && steps < MAX_STEPS) {
      this.step();
      this.acc -= DT;
      steps++;
    }
    if (steps === MAX_STEPS) this.acc = 0; // too slow: drop time instead of spiralling

    const s = this.skier;
    const speed = s.vel.length();
    const alpha = this.acc / DT;
    this.renderPos.lerpVectors(this.prevPos, s.pos, alpha);
    const heading = this.prevHeading + Math.atan2(Math.sin(s.heading - this.prevHeading), Math.cos(s.heading - this.prevHeading)) * alpha;
    this.model.update(s, this.renderPos, heading, this.track, realDt, this.sky.sunDirection);
    this.cam.update(this.renderPos, s, realDt, this.track.height);
    this.terrain?.update(this.cam.camera.position.z, 1);
    this.view?.update(gdt);
    this.crowd?.update(gdt, this.sky.sunDirection);
    this.sky.setTime(Math.min(0.95, this.sky.time + gdt * 0.0012)); // slow day cycle, stops at dusk (no wrap to morning)
    this.sky.update(this.cam.camera.position);

    // snow: continuous spray, the glove skimming the snow, pole plants, trails, flakes
    this.light.sunIntensity = this.sky.sun.intensity;
    this.light.hemiIntensity = this.sky.hemi.intensity;
    this.fx.update(s, this.renderPos, heading, gdt, this.cam.camera, this.renderer.domElement.height, this.light);
    this.sparkle?.update(this.time);
    const drag = this.model.handDrag;
    if (drag.active) this.fx.handDrag(drag.pos, drag.strength, gdt);
    if (this.model.consumePolePlant(this.plant)) {
      this.fx.polePlant(this.plant);
      this.audio.polePlant();
    }
    const powder = s.surface === Surface.Powder;
    const crashed = s.crashTimer > 0;
    const intensity = crashed ? 0 : Math.min(0.75, (powder ? 0.6 : 0.32) + Math.abs(s.edge) * 0.3 + s.skid * 0.25);
    this.trails.update(this.renderPos, heading, s.airborne || crashed, intensity, powder, T.trailWidth, this.track, s.skid, s.edge);
    this.flakes.update(this.cam.camera, this.time, pointScale(this.cam.camera, this.renderer.domElement.height));

    // sound
    this.audio.update(speed, s.edge, s.skid, s.surface, s.airborne, crashed, realDt, s.braking, s.tuck);
    this.audio.handDrag(drag.active ? drag.strength : 0);
    if (s.tuck !== this.wasTuck) {
      if (s.tuck && speed > 12) this.audio.tuck(true);
      this.wasTuck = s.tuck;
    }
    this.airReadout(s);
    const kmh = speed * 3.6;
    if (this.phase === 'running' && this.live) {
      for (const m of SPEED_MILESTONES) {
        if (kmh < m || this.milestone >= m) continue;
        this.milestone = m;
        this.hud.pop(`${m} km/h!`, 'info');
        this.audio.speedMilestone(m);
        this.cam.fovKick(3);
      }
    }

    this.hud.setSpeed(kmh);
    if (this.hud.setRun(this.run.time, this.run.score, Math.max(0, s.pos.z) / this.track.def.length, realDt) && this.live) this.audio.scoreTick();
    this.hud.setFlow(this.flow.value, this.flow.level, this.flow.streak);
    if (this.phase !== this.hudPhase) {
      this.hudPhase = this.phase;
      this.hud.setReady(this.phase === 'ready' ? this.readyText : null);
    }
    this.hudTick += realDt;
    if (this.hudTick > 0.2) {
      this.hudTick = 0;
      this.hud.setChallenges(this.challengeRows());
    }

    this.fpsN++;
    this.fpsT += realDt;
    if (this.fpsT >= 0.5) {
      this.fps = this.fpsN / this.fpsT;
      this.fpsN = 0;
      this.fpsT = 0;
    }
    this.renderer.render(this.scene, this.cam.camera);
  }

  /** In the air: the trick builds live ("180", "360 · Grab"), with a whoosh per half-turn and per flip. */
  private airReadout(s: SkierState): void {
    if (!s.airborne || s.crashTimer > 0) return;
    const half = Math.floor((Math.abs(s.spin) + 0.35) / Math.PI); // counts a little before the half-turn completes
    const flips = Math.floor((Math.abs(s.flip) + 0.6) / (2 * Math.PI));
    if (half > this.halfTurns) {
      this.halfTurns = half;
      this.audio.spinTick(half);
    }
    if (flips > this.flipsShown) {
      this.flipsShown = flips;
      this.audio.flipTick();
    }
    const parts = [half > 0 ? String(half * 180) : '', flips ? `${flips > 1 ? `${flips}× ` : ''}Flip` : '', s.grab ? 'Grab' : ''].filter(Boolean);
    this.hud.trick(parts.length ? parts.join(' · ') : null);
  }

  resize(w: number, h: number): void {
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
  }

  get chunkBuildMs(): number {
    return this.terrain?.buildMs ?? 0;
  }

  get particles(): number {
    return this.fx.alive;
  }
}
