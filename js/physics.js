/* physics.js — MotionLab adapter over the reusable physics core.
   The generic engine lives in js/engine/physics-engine.js (project-agnostic,
   reusable in future projects). This file only translates between MotionLab's
   scene format (scene.js) and the engine's plain descriptors. */

import { bodyData, constraintData } from './scene.js';
import { PhysicsEngine } from './engine/physics-engine.js';

function mlToDesc(d) {
  return {
    id: d.id,
    kind: d.type === 'rectangle' || d.type === 'line' ? 'rect' : d.type,
    x: d.x, y: d.y, angle: d.angle,
    width: d.width, height: d.type === 'line' ? Math.max(4, d.height) : d.height,
    radius: d.radius, sides: d.sides,
    density: d.density, friction: d.friction, frictionAir: d.frictionAir,
    restitution: d.restitution, isStatic: d.isStatic, lockRotation: d.lockRotation,
    vx: d.vx, vy: d.vy, label: d.label,
    userData: { mlType: d.type, isBound: d.isBound, sides: d.sides },
  };
}

export class PhysicsWorld {
  constructor() {
    // Sleeping on: resting stacks (pyramids, settled piles) stop costing CPU.
    // Bodies wake automatically on collision, edits and dragging.
    // substeps 2 = anti-tunnelling: fast bodies cannot jump thin colliders
    // (user dragging stays exempt — it is position-driven by design).
    this.core = new PhysicsEngine({ enableSleeping: true, substeps: 2 });
    this.collisionFlash = 0;
    this.core.onCollision(() => { this.collisionFlash = performance.now(); });
  }

  get engine() { return this.core.engine; }
  get gravity() { return this.core.gravity; }
  get onChange() { return this.core.onChange; }
  set onChange(fn) { this.core.onChange = fn; }

  applySettings(s) { this.core.setGravity(s.gravityX, s.gravityY, s.gravityEnabled); }
  step(dtMs, speed = 1) { this.core.step(dtMs, speed); }
  advance(elapsedMs, speed = 1) { return this.core.advance(elapsedMs, speed); }
  stepOnce() { this.core.stepOnce(); }

  clearBodies() { this.core.clear(); }

  addBody(data) { return this.core.addBody(mlToDesc(bodyData(data))); }
  removeBody(dataId) { return this.core.removeBody(dataId); }

  addConstraint(data) { return this.core.addConstraint(constraintData(data)); }
  removeConstraint(id) { return this.core.removeConstraint(id); }
  get constraintCount() { return this.core.constraintCount; }
  constraintSegments(out) { return this.core.constraintSegments(out); }
  serializeConstraints() { return this.core.describeConstraints().map((c) => constraintData(c)); }

  loadScene(scene) {
    this.core.clear();
    for (const d of scene.bodies) this.addBody(d);
    for (const c of scene.constraints || []) this.addConstraint(c);
    this.applySettings(scene.settings);
  }

  bodyById(dataId) { return this.core.bodyById(dataId); }
  dataIdOf(body) { return this.core.idOf(body); }
  typeOf(body) { return this.core.userDataOf(body).mlType || 'rectangle'; }
  isBound(body) { return this.core.userDataOf(body).isBound === true; }
  allBodies() { return this.core.allBodies(); }
  get count() { return this.core.count; }
  pick(wx, wy) { return this.core.pick(wx, wy); }
  /** Radial shove via the engine; world-boundary bodies are never pushed. */
  applyRadialImpulse(x, y, opts) {
    return this.core.applyRadialImpulse(x, y, { ...opts, filter: (b) => !this.isBound(b) });
  }

  serializeBody(body) {
    const d = this.core.describeBody(body);
    const ud = d.userData || {};
    return bodyData({
      id: d.id,
      type: ud.mlType || 'rectangle',
      x: d.x, y: d.y, angle: d.angle,
      width: d.width, height: d.height, radius: d.radius,
      sides: ud.sides !== undefined ? ud.sides : d.sides,
      density: d.density, friction: d.friction, frictionAir: d.frictionAir,
      restitution: d.restitution, isStatic: d.isStatic,
      isBound: ud.isBound === true, lockRotation: d.lockRotation,
      vx: d.vx, vy: d.vy, label: d.label,
    });
  }

  serializeScene() {
    return {
      bodies: this.allBodies().map((b) => this.serializeBody(b)),
      constraints: this.serializeConstraints(),
    };
  }

  /* ---------- property edits ---------- */
  setPosition(body, x, y) { this.core.setPosition(body, x, y); }
  setAngleDeg(body, deg) { this.core.setAngleDeg(body, deg); }
  setVelocity(body, vx, vy) { this.core.setVelocity(body, vx, vy); }
  setDensity(body, v) { this.core.setDensity(body, v); }
  setMass(body, v) { this.core.setMass(body, v); }
  setFriction(body, v) { this.core.setFriction(body, v); }
  setFrictionAir(body, v) { this.core.setFrictionAir(body, v); }
  setRestitution(body, v) { this.core.setRestitution(body, v); }
  setStatic(body, flag) { this.core.setStatic(body, flag); }
  setLockRotation(body, flag) { this.core.setLockRotation(body, flag); }
  stopMotion(body) { this.core.stopMotion(body); }
  resize(body, patch) { return this.core.resize(body, patch); }
  rememberSize(body, sizePatch) { Object.assign(body.plugin.pe.desc, sizePatch); }

  /* ---------- dragging ---------- */
  beginDrag(body, wx, wy) { this.core.beginDrag(body, wx, wy); }
  moveDrag(wx, wy) { this.core.moveDrag(wx, wy); }
  endDrag() { this.core.endDrag(); }
  get dragging() { return this.core.dragging; }
}
