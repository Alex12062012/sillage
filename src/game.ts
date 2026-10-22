import { Group, MathUtils, Scene, Vector3, type WebGLRenderer } from 'three';
import { GameAudio } from './audio/audio';
import { Input } from './input/input';
import { ChaseCamera } from './render/camera';
import { Flakes, pointScale, SkiTrails, SnowSpray } from './render/fx';
import { buildChunkProps, buildLandmarks } from './render/props';
import { SkierModel } from './render/skierModel';
import { Sky } from './render/sky';
import { Terrain } from './render/terrain';
import { botInput } from './sim/bot';
import { createRun, SlowMo, stepRun, type RunEvent, type RunState } from './sim/run';
import { createSkier, stepSkier, type SkierEvent, type SkierInput, type SkierState } from './sim/skier';
import { makeTrack, Surface, type Track, type TrackDef } from './sim/track';
import { TUNING as T } from './tuning';
import type { Hud } from './ui/hud';

export const DT = 1 / 60;
const MAX_STEPS = 5;
const CRASH_LINES = ['Yard sale!', 'Faceplant!', 'Oof!', 'Snow angel!'];

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
  /** Autopilot target speed in m/s (tests, captures, attract mode), or null. */
  bot: number | null = null;
  botGap = 2.4;
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
    this.world.clear();
    this.track = makeTrack(def);
    this.terrain = new Terrain(this.track, buildChunkProps);
    this.world.add(this.terrain.group, buildLandmarks(this.track));
    this.sky.setTime(def.timeOfDay);
    this.reset();
  }

  reset(): void {
    this.skier = createSkier(this.track, this.track.centerX(-8), -8, 0);
    this.run = createRun();
    this.prevPos.copy(this.skier.pos);
    this.prevHeading = this.skier.heading;
    this.renderPos.copy(this.skier.pos);
    this.cam.snap(this.skier.pos, 0);
    this.trails.reset();
    this.acc = 0;
    this.sky.setTime(this.track.def.timeOfDay);
    this.terrain?.prewarm(this.skier.pos.z);
  }

  private step(): void {
    const s = this.skier;
    this.prevPos.copy(s.pos);
    this.prevHeading = s.heading;
    this.input.sample(this.inp, DT, s.airborne);
    if (this.bot) botInput(s, this.track, this.inp, this.bot, this.botGap);
    this.sEv.length = 0;
    this.rEv.length = 0;
    stepSkier(s, this.inp, this.track, DT, this.sEv);
    stepRun(this.run, s, this.track, DT, this.sEv, this.rEv);
    for (const e of this.sEv) this.onSkierEvent(e);
    for (const e of this.rEv) this.onRunEvent(e);
  }

  private onSkierEvent(e: SkierEvent): void {
    const s = this.skier;
    switch (e.type) {
      case 'takeoff':
        this.input.lockAirInputs();
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
        this.audio.land(e.vn);
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
        this.audio.nearMiss(e.side, e.razor);
        this.cam.fovPunch();
        this.cam.addTrauma(e.razor ? 0.15 : 0.06);
        this.hud.pop(`${e.razor ? 'RAZOR' : 'Close call'}${e.chain > 1 ? ` ×${e.chain}` : ''}  +${e.points}`, e.razor ? 'great' : 'good');
        break;
      case 'slowmo':
        if (!this.cam.comfort || e.scale > 0.5) this.slowmo.trigger(e.scale, e.hold, e.ease);
        break;
      case 'chainEnd':
        break;
    }
  }

  frame(realDt: number): void {
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
    this.sky.setTime(this.sky.time + gdt * 0.0012); // slow day cycle during a run
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
    this.audio.update(s.vel.length(), s.edge, s.skid, s.surface, s.airborne, crashed, realDt);
    this.hud.setSpeed(s.vel.length() * 3.6);

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
