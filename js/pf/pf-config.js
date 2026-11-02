/* pf-config.js — PFLab tunable parameters, all in one place.
   Units: pixels, fixed steps (60 steps = 1 second). Change values here to
   tune game feel; nothing else in PFLab hard-codes these numbers. */

/** PF engine version (the platform-fighter module set under js/pf/). */
export const PF_VERSION = '1.1.0';

export const STEP_MS = 1000 / 60;      // fixed timestep
export const MAX_FRAME_MS = 100;       // clamp for background-tab time jumps
export const MAX_STEPS_PER_FRAME = 5;  // spiral-of-death guard

export const WORLD = {
  width: 960,
  height: 540,
  gravityY: 2.0,        // engine gravity for the fighter world (snappier than the sandbox default)
  substeps: 2,          // anti-tunnelling, same default as the 2D lab
};

export const FIGHTER = {
  width: 34,
  height: 52,
  moveSpeed: 4.2,       // px/step on the ground
  airAccel: 0.35,       // fraction of horizontal velocity corrected per air step
  groundAccel: 1.0,     // grounded horizontal velocity snaps to intent
  jumpVel: 13.4,        // initial upward velocity of a ground jump
  doubleJumpVel: 12.2,  // initial upward velocity of the air jump
  maxJumps: 2,          // ground jump + one double jump
  coyoteSteps: 6,       // grace period after walking off an edge
  jumpBufferSteps: 6,   // a jump pressed slightly early still counts
  dashSpeed: 9.0,
  dashSteps: 9,         // dash duration
  dashCooldown: 42,
  hitstunDrag: 0.96,    // per-step horizontal velocity kept while in hitstun
};

export const ATTACK = {
  startup: 6,           // steps before the hitbox is live
  active: 5,            // steps the hitbox can hit
  recovery: 11,         // steps after the active window
  damage: 7,            // percent added per hit
  hitboxW: 48,
  hitboxH: 40,
  reach: 16,            // gap between the attacker's edge and the hitbox near edge
  baseKnockback: 3.4,   // px/step at 0% damage
  knockbackGrowth: 0.075, // extra px/step per point of victim damage
  knockbackUpRatio: 0.75, // vertical component as a fraction of horizontal
  hitstunBase: 10,
  hitstunPerDamage: 0.22,
  hitstunMax: 42,
};

export const AI = {
  decideEvery: 10,      // steps between FSM evaluations (never per-frame)
  attackCooldown: 30,   // steps the dummy waits after attacking before it may attack again
  attackRangeX: 64,
  attackRangeY: 48,
  retreatDamage: 75,    // at/above this damage the dummy prefers distance
  retreatSteps: 26,     // how long a retreat lasts once started
  edgeMargin: 60,       // distance from a platform edge considered dangerous
};

/** Named AI difficulty profiles: partial overrides merged over AI.
    calm = slower reactions, longer pauses; sharp = fast and relentless. */
export const AI_PROFILES = {
  calm: { decideEvery: 16, attackCooldown: 48 },
  normal: {},
  sharp: { decideEvery: 6, attackCooldown: 18 },
};

export const BLAST = {
  left: -90,
  right: WORLD.width + 90,
  top: -170,
  bottom: WORLD.height + 170,
};

export const DEBUG = {
  showHitboxes: true,   // draw live hitboxes (lab-style debug view)
  panelEverySteps: 6,   // DOM debug panel refresh cadence (in steps)
};
