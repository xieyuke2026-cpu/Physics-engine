/* physics.js — MotionLab adapter over the reusable physics core.
   The generic engine lives in js/engine/physics-engine.js (project-agnostic,
   reusable in future projects). This file only translates between MotionLab's
   scene format (scene.js) and the engine's plain descriptors. */

import { bodyData, constraintData, hingeData } from './scene.js';
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
    noSleep: d.noSleep === true,
    magnet: d.magnet,
    vx: d.vx, vy: d.vy, label: d.label,
    // The scene label doubles as the engine-level body name (1.4.0), so
    // scene bodies are addressable via core.getBodyByName(label) too.
    name: d.label || '',
    userData: { mlType: d.type, isBound: d.isBound, sides: d.sides },
  };
}

export class PhysicsWorld {
  constructor(backend = 'matter') {
    // Sleeping on: resting stacks (pyramids, settled piles) stop costing CPU.
    // Bodies wake automatically on collision, edits and dragging.
    // substeps 2 = anti-tunnelling: fast bodies cannot jump thin colliders
    // (user dragging stays exempt — it is position-driven by design).
    // The solver is chosen through the registry (1.41): 'matter' is the
    // default; 'native' is the self-developed experimental backend. The
    // scene format is identical either way, so worlds can be rebuilt on
    // the other solver and replayed.
    this.core = PhysicsEngine.create({ backend, enableSleeping: true, substeps: 2 });
    this.collisionFlash = 0;
    this.core.onCollision(() => { this.collisionFlash = performance.now(); });
  }

  get engine() { return this.core.engine; }
  get gravity() { return this.core.gravity; }
  get onChange() { return this.core.onChange; }
  set onChange(fn) { this.core.onChange = fn; }

  applySettings(s) {
    this.core.setGravity(s.gravityX, s.gravityY, s.gravityEnabled);
    this.core.setGravitation(Number(s.gravitation) || 0, { softening: s.gravitationSoftening });
    if (s.seed !== undefined && Number.isFinite(Number(s.seed))) this.core.setSeed(Number(s.seed) >>> 0);
  }
  /** The engine RNG stream's seed (see PhysicsEngine.setSeed). */
  get seed() { return this.core.seed; }
  setSeed(n) { this.core.setSeed(n); }
  /** Next value from the engine's seeded RNG stream, in [0, 1). */
  random() { return this.core.random(); }
  step(dtMs, speed = 1) { this.core.step(dtMs, speed); }
  advance(elapsedMs, speed = 1) { return this.core.advance(elapsedMs, speed); }
  stepOnce() { this.core.stepOnce(); }

  /* ---------- deterministic replay support (1.50) ---------- */
  /** Simulated milliseconds elapsed on the core clock (rides snapshots). */
  get simTime() { return this.core.simTime; }
  /** The core's fixed timestep in ms (1000/60). */
  get fixedDt() { return this.core.fixedDt; }
  /** Full engine-state snapshot (bodies, constraints, RNG, clock). */
  snapshot() { return this.core.snapshot(); }
  /** Restore a snapshot produced by snapshot() on either backend. */
  loadSnapshot(data) { this.core.load(data); }

  clearBodies() { this.core.clear(); }

  addBody(data) { return this.core.addBody(mlToDesc(bodyData(data))); }
  removeBody(dataId) { return this.core.removeBody(dataId); }

  addConstraint(data) { return this.core.addConstraint(constraintData(data)); }
  removeConstraint(id) { return this.core.removeConstraint(id); }
  get constraintCount() { return this.core.constraintCount; }
  constraintSegments(out) { return this.core.constraintSegments(out); }
  serializeConstraints() { return this.core.describeConstraints().map((c) => constraintData(c)); }

  /* ---------- hinges & motors (1.28 / core 1.7.0) ---------- */
  addHinge(data) { return this.core.addHinge(hingeData(data)); }
  removeHinge(id) { return this.core.removeHinge(id); }
  get hingeCount() { return this.core.hingeCount; }
  hingeById(id) { const h = this.core.hingeById(id); return h ? hingeData(h) : null; }
  hinges() { return this.core.describeHinges().map((h) => hingeData(h)); }
  hingeAnchors() { return this.core.hingeAnchors(); }
  setHingeMotor(id, v) { return this.core.setHingeMotor(id, v); }
  serializeHinges() { return this.hinges(); }

  loadScene(scene) {
    this.core.clear();
    for (const d of scene.bodies) this.addBody(d);
    for (const c of scene.constraints || []) this.addConstraint(c);
    for (const h of scene.hinges || []) this.addHinge(h);
    for (const f of scene.fluids || []) this.core.addFluid(f);
    for (const w of scene.winds || []) this.core.addWind(w);
    this.applySettings(scene.settings);
  }

  /* ---------- fluids (buoyancy regions) + gravitation ---------- */
  addFluid(f) { return this.core.addFluid(f); }
  removeFluid(id) { return this.core.removeFluid(id); }
  fluidById(id) { return this.core.fluidById(id); }
  fluids() { return this.core.fluids(); }
  /** Allocation-free live iteration for the renderer (1.6.0 core). */
  forEachBody(fn) { this.core.forEachBody(fn); }
  forEachFluid(fn) { this.core.forEachFluid(fn); }
  forEachWind(fn) { this.core.forEachWind(fn); }
  get fluidCount() { return this.core.fluidCount; }
  /** Replace a fluid's fields (the engine has no in-place update). */
  updateFluid(id, patch) {
    const f = this.core.fluidById(id);
    if (!f) return null;
    this.core.removeFluid(id);
    return this.core.addFluid({ ...f, ...patch, id });
  }
  get gravitation() { return this.core.gravitation; }

  /* ---------- winds (target-velocity fields) + magnetism ---------- */
  addWind(w) { return this.core.addWind(w); }
  removeWind(id) { return this.core.removeWind(id); }
  windById(id) { return this.core.windById(id); }
  winds() { return this.core.winds(); }
  get windCount() { return this.core.windCount; }
  /** Replace a wind's fields (the engine has no in-place update). */
  /** Effective fluid flow (base current + wind-driven, engine 1.9.0). */
  fluidFlow(id) { return this.core.fluidFlow(id); }
  /** Replace a wind's fields (the engine has no in-place update). */
  updateWind(id, patch) {
    const w = this.core.windById(id);
    if (!w) return null;
    this.core.removeWind(id);
    return this.core.addWind({ ...w, ...patch, id });
  }
  setMagnet(body, v) { this.core.setMagnet(body, v); }
  magnetOf(body) { return this.core.magnetOf(body); }

  bodyById(dataId) { return this.core.bodyById(dataId); }
  /** Engine-level naming (1.4.0): find / rename scene bodies by label-name. */
  bodyByName(name) { return this.core.getBodyByName(name); }
  bodiesByName(name) { return this.core.getBodiesByName(name); }
  renameBody(bodyOrId, name) { return this.core.renameBody(bodyOrId, name); }
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
      restitution: d.restitution, isStatic: d.isStatic, magnet: d.magnet,
      isBound: ud.isBound === true, lockRotation: d.lockRotation, noSleep: d.noSleep === true,
      // A rename done through the engine wins over the creation label.
      vx: d.vx, vy: d.vy, label: d.name || d.label,
    });
  }

  serializeScene() {
    return {
      bodies: this.allBodies().map((b) => this.serializeBody(b)),
      constraints: this.serializeConstraints(),
      hinges: this.serializeHinges(),
      fluids: this.core.fluids(),
      winds: this.core.winds(),
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
