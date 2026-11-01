/* pf-physics.js — PFLab's adapter over the shared PhysicsEngine core.
   This is the ONLY PFLab module that talks to the engine, and it talks to
   the engine's public API only (never to Matter internals). The game uses
   stepOnce() inside its own accumulator so character/combat logic can run
   deterministically before and after every fixed step. */

import { PhysicsEngine } from '../engine/physics-engine.js';
import { WORLD, FIGHTER } from './pf-config.js';

export class PFPhysics {
  constructor() {
    this.pe = new PhysicsEngine({
      gravity: { x: 0, y: WORLD.gravityY },
      substeps: WORLD.substeps,
      enableSleeping: false, // fighters must never fall asleep mid-match
    });
    this._platformIds = new Set();
    this._oneWay = []; // rects for one-way platforms (no physics body)
  }

  addPlatform(desc) {
    if (desc.oneWay) {
      const rect = {
        pid: desc.id, cx: desc.x, top: desc.y - desc.h / 2,
        left: desc.x - desc.w / 2, right: desc.x + desc.w / 2,
      };
      this._oneWay.push(rect);
      return rect;
    }
    const body = this.pe.addBody({
      id: `pf-stage-${desc.id}`, kind: 'rect',
      x: desc.x, y: desc.y, width: desc.w, height: desc.h,
      isStatic: true, friction: 0.15, restitution: 0,
      userData: { pf: 'platform', pid: desc.id },
    });
    this._platformIds.add(this.pe.idOf(body));
    return body;
  }

  /**
   * One-way platform landing: if the body is falling and its feet crossed a
   * one-way platform's top surface this step, snap it onto the surface and
   * zero its vertical velocity. Returns the platform rect, or null.
   */
  tryOneWayLand(body, prevFeet, bodyHalfH, bodyHalfW) {
    const p = this.pose(body);
    if (p.vy < 0) return null;
    const feet = p.y + bodyHalfH;
    for (const r of this._oneWay) {
      if (prevFeet <= r.top + 0.6 && feet >= r.top
        && Math.abs(p.x - r.cx) < (r.right - r.left) / 2 + bodyHalfW - 8) {
        this.setPosition(body, p.x, r.top - bodyHalfH);
        this.setVelocity(body, p.vx, 0);
        return r;
      }
    }
    return null;
  }

  addFighter(id, spawn) {
    return this.pe.addBody({
      id: `pf-${id}`, kind: 'rect',
      x: spawn.x, y: spawn.y, width: FIGHTER.width, height: FIGHTER.height,
      density: 0.001, friction: 0, frictionAir: 0, restitution: 0,
      lockRotation: true,
      userData: { pf: 'fighter', fid: id },
    });
  }

  /** One fixed simulation step (the engine's own fixed dt). */
  step() { this.pe.stepOnce(); }

  /** Live transform/velocity of a body (single describeBody call). */
  pose(body) {
    const d = this.pe.describeBody(body);
    return { x: d.x, y: d.y, vx: d.vx, vy: d.vy };
  }

  setVelocity(body, vx, vy) { this.pe.setVelocity(body, vx, vy); }
  setPosition(body, x, y) { this.pe.setPosition(body, x, y); }

  /** True when the world point sits inside a platform body. */
  probePlatform(x, y) {
    const hit = this.pe.pick(x, y);
    return !!hit && this._platformIds.has(this.pe.idOf(hit));
  }

  clear() { this.pe.clear(); this._platformIds.clear(); }
}
