/**
 * Every feel parameter lives here (see docs/FEEL.md). The debug panel (~) edits this object live.
 * Units: m, s, m/s, rad, m/s².
 */
export const TUNING = {
  // ── glide physics
  gravity: 11, // ×1.12 real g: snappier acceleration and less floaty air (FEEL §1)
  mass: 75,
  airDensity: 1.1,
  cdaUpright: 0.62,
  cdaTuck: 0.28,
  cdaBrake: 0.9,
  muGroomed: 0.03,
  muPowder: 0.05,
  muIce: 0.015,
  powderDrag: 0.06, // extra decel per m/s in powder (snow compaction)
  // ── steering & carving
  yawRateLow: 2.8, // ski authority at standstill (rad/s)
  yawRateHigh: 1.6, // ski authority at yawSpeedRef
  yawSpeedRef: 30,
  yawResponse: 0.12, // time constant of the ski yaw (inertia)
  tuckSteer: 0.4, // steering authority kept in tuck
  gripGroomed: 20, // max lateral acceleration before skidding (m/s²)
  gripPowder: 13,
  gripIce: 8,
  gripMinSpeed: 4,
  skidFriction: 9, // decel at 90° of skid (m/s²)
  pumpBoost: 0.6, // m/s added on a clean edge change
  pumpMinTurn: 0.35, // s of clean carve needed before the edge change
  pumpMaxSpeed: 19.5, // no pump above ~70 km/h
  brakeDecel: 8,
  poleAccel: 2.5,
  poleMaxSpeed: 4,
  // ── air
  jumpImpulse: 4.2,
  launchThreshold: 1.0, // relative normal speed above which the ground lets go (m/s)
  spinRate: 6.5,
  flipRate: 5.5,
  airResponse: 0.08,
  grabDelay: 0.08, // s after takeoff before a held grab catches the skis
  grabMinTime: 0.15, // shorter grabs are not tricks
  grabPoints: 250, // per second of grab, banked only if released before touchdown
  // ── landing (Vn = normal impact speed; EFH = Vn²/2g)
  landCleanAngle: 0.6,
  landCrashAngle: 1.2,
  landSwitchTol: 0.6,
  landFlipTol: 0.8,
  landPerfectAngle: 0.2,
  landHardVn: 7,
  landCrashVn: 20, // only cliff-onto-flat crashes from impact; orientation is what usually crashes you
  hardLandMaxLoss: 0.5, // speed lost at landCrashVn, scaled from 0 at landHardVn
  sketchyLoss: 0.7,
  switchLoss: 0.85,
  // ── crash
  crashDuration: 1.4,
  crashDecel: 9,
  respawnSpeed: 6,
  skierRadius: 0.35,
  // ── near-miss & reward (FEEL §2-3)
  nearMissDist: 1.6, // surface distance for a near-miss (m)
  razorDist: 0.7,
  nearMissMinSpeed: 11.1, // 40 km/h gate (Traffic Rider gates its bonus by speed)
  nearMissPoints: 100,
  razorPoints: 250,
  comboWindow: 3,
  slowmoScale: 0.4,
  slowmoHold: 0.25,
  slowmoEase: 0.3,
  slowmoAirTime: 2,
  airPoints: 100, // per second of airtime on a clean landing
  speedPoints: 12, // per second at 80 km/h (scales from 60 km/h)
  razorTimeScale: 0.3,
  razorHold: 0.06,
  // ── flow (cosmetic "in the zone" meter, src/sim/flow.ts) & juice
  flowBeat: 0.07, // per clean edge change (+10 % per beat of streak, up to ×2)
  flowBeatWindow: 2.5, // s on the ground without a clean beat ends the streak
  flowDecay: 0.05, // per s on the ground (×3 under 25 km/h)
  flowSpeed: 0.08, // per s at 100 km/h (from 70), only up to level 2
  flowSketchy: 0.25,
  flowBrakeDrain: 0.4, // per s of braking
  perfectHitstop: 0.05, // s of near-freeze on a perfect landing
  camImpactDip: 0.045, // camera dip per m/s of landing impact (spring)
  camCarveDrop: 0.22, // camera lowers in hard carves (m at full edge)
  beatFovKick: 1.2, // degrees per clean beat (+ flow level × 0.4)
  // ── camera & speed feel (FEEL §2, §4); fov is vertical, in degrees
  fovBase: 62,
  fovMaxBoost: 18,
  fovSpeedMin: 8,
  fovSpeedRef: 33,
  fovSmoothing: 0.3,
  fovTuckBoost: 4,
  fovPunch: 6,
  camHeight: 2.0,
  camDistance: 4.6,
  camLookAhead: 7,
  camAirPullback: 1.3,
  camRollMax: 4,
  camBreath: 0.03,
  traumaDecay: 1.4,
  shakeMaxOffset: 0.12,
  shakeMaxRoll: 2,
  shakeFreq: 18,
  speedRumble: 0.012,
  speedBuzz: 0.018, // m of high-frequency camera buzz on the snow, 90 → 125 km/h (off in the air and in comfort mode)
  speedBuzzFreq: 40, // noise rate of the buzz (its top partial stays under 30 Hz)
  // ── snow fx
  sprayRate: 900,
  sprayLife: 0.8,
  sprayPowder: 1.8,
  trailWidth: 0.12,
  flakeCount: 700,
  // ── skier model & animation (src/render/skierModel.ts)
  skierLean: 0.9, // × the physical inclination atan(lateral accel / g)
  skierAngulation: 0.45, // share of the lean the upper body takes back (the "comma")
  skierAbsorb: 3.2, // leg suspension frequency (Hz): soaks up moguls and landings
  skierLandKick: 0.6, // landing compression speed (m/s) per m/s of impact
  handDragEdge: 0.85, // |edge| above which the inside glove skims the snow…
  handDragKmh: 45, // …above this speed
  shadowOpacity: 0.3,
  shadowMinElev: 35, // degrees: the planar shadow stays under the skier at dawn and dusk
  // ── snow fx feel pass (src/render/fx.ts; sprayRate = rooster-tail grains/s at full load, sprayLife = grain life,
  //    sprayPowder = powder billow scale, trailWidth = carved groove width)
  fxGrain: 0.04, // grain size (m): small and crisp, never cotton balls over the skis
  fxMist: 0.32, // mist puff size (m)
  fxMistRate: 55, // mist puffs/s at full edge load
  fxMistLife: 1.1,
  fxBrake: 1.8, // hockey-stop curtain: × sprayRate
  fxBurst: 1, // landing / takeoff / crash burst scale
  fxTreeShake: 1, // snow shaken off a shaved tree
  fxLines: 0.5, // speed-line opacity at full ramp (in tuck; ×0.7 standing); they also get denser and longer
  fxLinesLen: 0.16, // s of travel one streak spans at full ramp (40 % of it at fxLinesFrom)
  fxLinesFrom: 70, // km/h where speed lines and the tunnel vignette fade in
  fxLinesFull: 120, // km/h at full strength
  fxVignette: 1, // tunnel vignette opacity at full ramp (edge darkening + faint radial streaks, no streaks in comfort mode)
  fxSparkle: 1, // sun glints on the snow (off on low quality)
  trailGroove: 1, // carved trench contrast (groove shading + darkness)
  // ── audio feel pass (src/audio/audio.ts); levels are multipliers of the designed mix
  sfxCarve: 1, // edge-bite hiss
  sfxSkid: 1, // skid / braking scrape (the hockey-stop "kssshh")
  sfxRumble: 1, // low ski-on-snow rumble
  sfxRhythm: 1, // notes played by clean edge changes (×0.7 with music off)
  sfxFlow: 1, // ambient layers added by flow (pad, pulse, arpeggio, shimmer)
  sfxDuck: 0.6, // how far wind and carve dip under big events
  sfxChordSeconds: 3.4, // length of one chord of the ambient progression
};

/** Debug-panel slider ranges; anything not listed gets [0, 3×value]. */
export const TUNING_RANGES: Partial<Record<keyof typeof TUNING, [number, number]>> = {
  gravity: [5, 20], landCleanAngle: [0.1, 1.5], landCrashAngle: [0.5, 1.6], fovBase: [40, 90], fovMaxBoost: [0, 35],
  camRollMax: [0, 10], shakeMaxRoll: [0, 8], pumpBoost: [0, 2], launchThreshold: [0.1, 4], slowmoScale: [0.1, 1],
};

export type Tuning = typeof TUNING;
