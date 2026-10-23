import { Group, MathUtils, Mesh, Scene, Vector3, type MeshBasicMaterial, type WebGLRenderer } from 'three';
import { GameAudio } from './audio/audio';
import { Input } from './input/input';
import { ChaseCamera } from './render/camera';
import { Flakes, pointScale, SkiTrails, SnowSpray } from './render/fx';
import { buildChunkProps, buildLandmarks } from './render/props';
import { SkierModel, type SkierColors } from './render/skierModel';
import { Sky } from './render/sky';
import { Terrain } from './render/terrain';
import { botInput } from './sim/bot';
import { CHALLENGE_TITLE, CHALLENGES, describeChallenge, liveTier, progressText, type RunStats } from './sim/missions';
import { createRun, runStats, SlowMo, stepRun, type RunEvent, type RunState } from './sim/run';
import { createSkier, stepSkier, type SkierEvent, type SkierInput, type SkierState } from './sim/skier';
import { makeTrack, Surface, type Track, type TrackDef } from './sim/track';
import { TUNING as T } from './tuning';
import type { ChallengeRow, Hud } from './ui/hud';

export const DT = 1 / 60;
const MAX_STEPS = 5;
const CRASH_LINES = ['Yard sale!', 'Faceplant!', 'Oof!', 'Snow angel!'];
const TIER_NAME = ['', 'Bronze', 'Silver', 'Gold'];

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
  private world = new Group();
  skier!: SkierState;
  run!: RunState;
  private model = new SkierModel();
  private spray = new SnowSpray();
  private flakes = new Flakes(T.flakeCount);
  private trails = new SkiTrails();
  private slowmo = new SlowMo();
  private prevPos = new Vector3();
  private renderPos = new Vector3();
  private prevHeading = 0;
  private inp: SkierInput = { steer: 0, tuck: false, brake: false, jump: false, flip: 0 };
  private sEv: SkierEvent[] = [];
  private rEv: RunEvent[] = [];
  private acc = 0;
  private sprayAcc = 0;
  /** audio test hooks (the lead owns the real streak / flow logic) */
  private beatStreak = 0;
  private halfTurns = 0;
  private flipCount = 0;
  private kmhStep = 0;
  private wasTuck = false;
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
    this.scene.add(this.world, this.model.root, this.trails.mesh, this.spray.points, this.flakes.points);
    this.cam = new ChaseCamera(1);
    this.load(def);
  }

  /** Builds the world for a run definition (chunks stream in as the skier moves). */
  load(def: TrackDef): void {
    this.terrain?.dispose();
    this.landmarks?.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      o.geometry.dispose();
      const m = o.material as MeshBasicMaterial;
      m.map?.dispose();
      m.dispose();
    });
    this.world.clear();
    this.track = makeTrack(def);
    this.terrain = new Terrain(this.track, buildChunkProps);
    this.terrain.viewDistance = this.viewDistance;
    this.landmarks = buildLandmarks(this.track);
    this.world.add(this.terrain.group, this.landmarks);
    this.sky.setTime(def.timeOfDay);
    this.reset();
  }

  reset(): void {
    this.skier = createSkier(this.track, this.track.centerX(-8), -8, 0);
    this.run = createRun(this.track.def.length, this.track.def.par);
    this.phase = 'ready';
    this.hudPhase = null;
    this.finishTimer = -1;
    this.liveTiers = { ...this.bestTiers };
    this.slowmo = new SlowMo();
    this.prevPos.copy(this.skier.pos);
    this.prevHeading = this.skier.heading;
    this.renderPos.copy(this.skier.pos);
    this.cam.snap(this.skier.pos, 0);
    this.trails.reset();
    this.acc = 0;
    this.sky.setTime(this.track.def.timeOfDay);
    this.terrain?.prewarm(this.skier.pos.z);
  }

  /** Drop the skier mid-run at `z` (attract mode / tests): already moving, clock running. */
  startAt(z: number, speed: number): void {
    const s = this.skier;
    const x = this.track.centerX(z);
    const heading = Math.atan((this.track.centerX(z + 1) - this.track.centerX(z - 1)) / 2);
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

  private step(): void {
    const s = this.skier;
    this.prevPos.copy(s.pos);
    this.prevHeading = s.heading;
    this.input.sample(this.inp, DT, s.airborne);
    if (s !== this.skier) return; // a pad callback restarted / loaded the run mid-step: drop the stale step
    if (this.bot) botInput(s, this.track, this.inp, this.bot, this.botGap);
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
    stepSkier(s, this.inp, this.track, DT, this.sEv);
    stepRun(this.run, s, this.track, DT, this.sEv, this.rEv);
    for (const e of this.sEv) this.onSkierEvent(e);
    for (const e of this.rEv) this.onRunEvent(e);
    this.audioTicks();
    if (this.phase === 'running') this.liveMedals();
    if (this.finishTimer >= 0) {
      this.finishTimer += DT;
      if (this.finishTimer > 1.3) {
        this.finishTimer = -1;
        this.onFinish?.(this.stats());
      }
    }
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
    switch (e.type) {
      case 'takeoff':
        this.input.lockAirInputs();
        this.audio.takeoff(this.sEv.some((x) => x.type === 'jump'));
        this.halfTurns = 0;
        this.flipCount = 0;
        break;
      case 'edgeChange':
        this.beatStreak = e.clean ? this.beatStreak + 1 : 0;
        this.audio.edgeChange(this.beatStreak, e.clean);
        break;
      case 'grab':
        this.audio.grab(true);
        break;
      case 'jump':
        this.audio.jump();
        this.spray.burst(s.pos, 8, 2, 0.25);
        break;
      case 'pump':
        this.audio.pump();
        break;
      case 'land': {
        if (e.quality === 'crash') break;
        const trickEv = this.rEv.find((r) => r.type === 'trick');
        this.audio.land(e.vn, e.quality, trickEv?.type === 'trick' ? trickEv.points : 0);
        this.cam.addTrauma(MathUtils.clamp((e.vn - 2.5) / 10, 0, 0.75));
        this.spray.burst(s.pos, 10 + Math.round(e.vn * 4), 2 + e.vn * 0.35, s.surface === Surface.Powder ? 0.5 : 0.3);
        const spins = Math.round(Math.abs(e.spin) / Math.PI) * 180;
        const trick = spins >= 360 ? `${spins}! ` : e.flips ? `${e.flips > 1 ? e.flips + 'x ' : ''}Flip! ` : '';
        if (e.quality === 'switch') this.hud.pop(`${trick || ''}Switch!`, 'great');
        else if (e.quality === 'sketchy') this.hud.pop('Sketchy…', 'bad');
        else if (trick) this.hud.pop(`${trick}${e.quality === 'perfect' ? 'Perfect' : 'Clean'}`, 'great');
        else if (e.airTime >= 1) this.hud.pop(`Big air ${e.airTime.toFixed(1)}s`, 'good');
        else if (e.vn > T.landHardVn) this.hud.pop('Hard landing', 'bad');
        break;
      }
      case 'crash':
        this.audio.crash();
        this.beatStreak = 0;
        this.cam.addTrauma(0.85);
        this.spray.burst(s.pos, 70, 5, 0.45);
        this.hud.pop(e.reason === 'obstacle' ? 'Tree hugger!' : CRASH_LINES[this.run.crashes % CRASH_LINES.length], 'bad');
        this.slowmo.trigger(0.5, 0.15, 0.3);
        break;
    }
  }

  private onRunEvent(e: RunEvent): void {
    switch (e.type) {
      case 'nearMiss':
        this.audio.nearMiss(e.side, e.razor, e.chain);
        this.cam.fovPunch();
        this.cam.addTrauma(e.razor ? 0.15 : 0.06);
        this.hud.pop(`${e.razor ? 'RAZOR' : 'Close call'}${e.chain > 1 ? ` ×${e.chain}` : ''}  +${e.points}`, e.razor ? 'great' : 'good');
        break;
      case 'slowmo':
        if (!this.cam.comfort || e.scale > 0.5) this.slowmo.trigger(e.scale, e.hold, e.ease);
        break;
      case 'chainEnd':
        break;
      case 'trick':
        break;
      case 'finish':
        this.phase = 'finished';
        this.finishTimer = 0;
        this.audio.finish();
        this.hud.pop('Finish!', 'great');
        break;
    }
  }

  /** Sim-rate audio cues read off the skier state: spin / flip ticks, speed milestones, tuck lock-in. */
  private audioTicks(): void {
    const s = this.skier;
    if (s.airborne) {
      const h = Math.floor(Math.abs(s.spin) / Math.PI);
      if (h > this.halfTurns) this.audio.spinTick((this.halfTurns = h));
      const f = Math.floor(Math.abs(s.flip) / (2 * Math.PI));
      if (f > this.flipCount) {
        this.flipCount = f;
        this.audio.flipTick();
      }
    }
    const kmh = s.vel.length() * 3.6;
    const m = kmh >= 120 ? 3 : kmh >= 100 ? 2 : kmh >= 80 ? 1 : 0;
    if (m > this.kmhStep) this.audio.speedMilestone(60 + m * 20);
    this.kmhStep = kmh < 70 ? 0 : Math.max(this.kmhStep, m);
    if (s.tuck && !this.wasTuck && kmh > 40) this.audio.tuck(true);
    this.wasTuck = s.tuck;
  }

  /** Graphics level: view distance + fog, falling snow density. */
  setQuality(q: 'low' | 'medium' | 'high'): void {
    const view = { low: 300, medium: 390, high: 470 }[q];
    if (this.terrain) this.terrain.viewDistance = view;
    this.viewDistance = view;
    this.sky.fog.far = view;
    this.sky.fog.near = view * 0.26;
    this.flakes.points.geometry.setDrawRange(0, Math.round(T.flakeCount * { low: 0.4, medium: 0.7, high: 1 }[q]));
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
    const alpha = this.acc / DT;
    this.renderPos.lerpVectors(this.prevPos, s.pos, alpha);
    const heading = this.prevHeading + Math.atan2(Math.sin(s.heading - this.prevHeading), Math.cos(s.heading - this.prevHeading)) * alpha;
    this.model.update(s, this.renderPos, heading, this.track, realDt);
    this.cam.update(this.renderPos, s, realDt, this.track.height);
    this.terrain!.update(this.cam.camera.position.z, 1);
    this.sky.setTime(Math.min(0.95, this.sky.time + gdt * 0.0012)); // slow day cycle, stops at dusk (no wrap to morning)
    this.sky.update(this.cam.camera.position);
    this.emitSpray(heading, gdt);
    this.spray.update(gdt);
    const powder = s.surface === Surface.Powder;
    const crashed = s.crashTimer > 0;
    const intensity = crashed ? 0 : Math.min(0.75, (powder ? 0.6 : 0.32) + Math.abs(s.edge) * 0.3 + s.skid * 0.25);
    this.trails.update(this.renderPos, heading, s.airborne || crashed, intensity, powder, T.trailWidth, this.track);
    const ps = pointScale(this.cam.camera, this.renderer.domElement.height);
    this.spray.material.uniforms.uScale.value = ps;
    this.flakes.update(this.cam.camera, this.time, ps);
    this.audio.update(s.vel.length(), s.edge, s.skid, s.surface, s.airborne, crashed, realDt, s.braking, s.tuck);
    this.hud.setSpeed(s.vel.length() * 3.6);
    this.hud.setRun(this.run.time, this.run.score, Math.max(0, s.pos.z) / this.track.def.length, realDt);
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

  /** Snow kicked up by the edges: outward from the turn, a wall when braking, clouds in powder. */
  private emitSpray(heading: number, gdt: number): void {
    const s = this.skier;
    const speed = s.vel.length();
    if (s.airborne || s.crashTimer > 0 || speed < 2) return;
    const powder = s.surface === Surface.Powder;
    const load = Math.abs(s.edge) * 0.8 + s.skid * 1.6 + (powder ? 0.6 : 0.04) + (s.braking ? 1.2 : 0);
    this.sprayAcc += T.sprayRate * MathUtils.smoothstep(speed, 2, 20) * load * gdt;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const lx = Math.cos(heading); // local +x (skier's left) in world
    const lz = -Math.sin(heading);
    const outward = s.edge >= 0 ? -1 : 1;
    const sizeK = powder ? T.sprayPowder : 1;
    while (this.sprayAcc >= 1) {
      this.sprayAcc -= 1;
      const side = Math.random() < 0.5 ? 0.12 : -0.12;
      const back = 0.3 + Math.random() * 0.6;
      const kick = 0.8 + Math.random() * (1 + 3 * Math.abs(s.edge) + 3 * s.skid);
      this.spray.emit(
        this.renderPos.x - fx * back + lx * side, this.renderPos.y + 0.05, this.renderPos.z - fz * back + lz * side,
        s.vel.x * 0.3 + lx * outward * kick + (Math.random() - 0.5), 0.6 + Math.random() * (powder ? 2.4 : 1.4), s.vel.z * 0.3 + lz * outward * kick + (Math.random() - 0.5),
        (0.07 + Math.random() * 0.16) * sizeK, (0.35 + Math.random() * 0.65) * T.sprayLife,
      );
    }
  }

  resize(w: number, h: number): void {
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
  }

  get chunkBuildMs(): number {
    return this.terrain?.buildMs ?? 0;
  }

  get particles(): number {
    return this.spray.alive;
  }
}
