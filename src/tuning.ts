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
  razorTimeScale: 0.3,
  razorHold: 0.06,
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
  // ── snow fx
  sprayRate: 420,
  sprayLife: 0.8,
  sprayPowder: 1.8,
  trailWidth: 0.12,
  flakeCount: 700,
};

/** Debug-panel slider ranges; anything not listed gets [0, 3×value]. */
export const TUNING_RANGES: Partial<Record<keyof typeof TUNING, [number, number]>> = {
  gravity: [5, 20], landCleanAngle: [0.1, 1.5], landCrashAngle: [0.5, 1.6], fovBase: [40, 90], fovMaxBoost: [0, 35],
  camRollMax: [0, 10], shakeMaxRoll: [0, 8], pumpBoost: [0, 2], launchThreshold: [0.1, 4], slowmoScale: [0.1, 1],
};

export type Tuning = typeof TUNING;
