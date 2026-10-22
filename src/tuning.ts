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
};

export type Tuning = typeof TUNING;
