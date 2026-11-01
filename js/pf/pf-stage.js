/* pf-stage.js — PFLab stage definition (pure data + pure helpers).
   No DOM, no physics imports: the same data drives the physics adapter,
   the renderer and the blast-zone test, so they can never disagree. */

import { WORLD, BLAST } from './pf-config.js';

/* The main platform is a solid physics body. The two floating platforms are
   one-way (jump up through them, land on top): solid-body corner contacts
   made jump-through unreliable in testing, and one-way is the genre
   standard for floaters. One-way landing is resolved by the physics
   adapter + character controller, not by a physics body. */
export const PLATFORMS = [
  { id: 'main', x: 480, y: 452, w: 620, h: 44 },   // main platform, top at y=430
  { id: 'left', x: 240, y: 318, w: 150, h: 18, oneWay: true },   // floating, top at y=309
  { id: 'right', x: 720, y: 318, w: 150, h: 18, oneWay: true },  // floating, top at y=309
];

export const SPAWNS = [
  { x: 370, y: 370, facing: 1 },   // player, left side (clear sky above)
  { x: 590, y: 370, facing: -1 },  // AI dummy, right side
];

export function platformTop(p) { return p.y - p.h / 2; }

/** Horizontal span of the main platform — the "stage" a fighter must return to. */
export const STAGE_SPAN = (() => {
  const m = PLATFORMS[0];
  return { left: m.x - m.w / 2, right: m.x + m.w / 2, top: platformTop(m) };
})();

/** True when a point (a fighter's centre) is outside the blast zone. */
export function isBlasted(x, y) {
  return x < BLAST.left || x > BLAST.right || y < BLAST.top || y > BLAST.bottom;
}

/** True when a fighter is off the stage horizontally or below its top surface. */
export function isOffStage(x, y) {
  return x < STAGE_SPAN.left - 10 || x > STAGE_SPAN.right + 10 || y > STAGE_SPAN.top + 30;
}

export const WORLD_SIZE = { width: WORLD.width, height: WORLD.height };
