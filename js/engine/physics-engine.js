/* ============================================================================
   physics-engine.js — reusable 2D physics core (built on Matter.js)

   A small, project-agnostic wrapper around Matter.js that gives games, tools
   and simulations a stable API without touching Matter internals:

     - plain-data body / constraint descriptors (JSON-friendly, serializable)
     - fixed-timestep simulation with an accumulator (stable at any refresh
       rate, speed multiplier, spiral-of-death protection)
     - optional body sleeping for large resting scenes
     - constraint (spring / rod) management with lifecycle cleanup
     - physics-based dragging (throwable bodies), picking, property setters
       that keep the engine as the single source of truth

   It knows nothing about any particular app: no DOM, no rendering, no file
   format. Rendering and persistence belong to the host project.

   Usage (browser):
     <script src="matter.min.js"></script>
     <script type="module">
       import { PhysicsEngine } from './physics-engine.js';
       const pe = new PhysicsEngine({ enableSleeping: true });
       pe.addBody({ kind: 'circle', x: 100, y: 50, radius: 24, restitution: .6 });
       pe.addBody({ kind: 'rect', x: 100, y: 300, width: 400, height: 20, isStatic: true });
       function frame(dtMs) { pe.advance(dtMs, 1); }
     </script>

   Matter.js must be available as a global `Matter` (script tag) or injected:
     PhysicsEngine.setMatter(Matter)  /  new PhysicsEngine({ matter })
   In Node tests: globalThis.Matter = require('matter-js') before importing.
   ========================================================================== */

let _M = null;
function matter() {
  if (_M) return _M;
  if (typeof globalThis !== 'undefined' && globalThis.Matter) return globalThis.Matter;
  if (typeof window !== 'undefined' && window.Matter) return window.Matter;
  throw new Error('physics-engine: Matter.js not found. Load matter.min.js first or call PhysicsEngine.setMatter().');
}

/** Body-local offset -> world coordinates (accounts for body rotation). */
function localToWorld(M, body, pt) {
  const c = Math.cos(body.angle), s = Math.sin(body.angle);
  return { x: body.position.x + pt.x * c - pt.y * s, y: body.position.y + pt.x * s + pt.y * c };
}
const num = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb);

export const BODY_KINDS = ['circle', 'rect', 'polygon'];

export class PhysicsEngine {
  /** Inject the Matter.js module explicitly (optional; global fallback works). */
  static setMatter(m) { _M = m; }

  /**
   * @param {object} [opts]
   * @param {object} [opts.matter] Matter.js module (defaults to global Matter)
   * @param {{x:number,y:number}} [opts.gravity] default {x:0, y:1}
   * @param {boolean} [opts.enableSleeping] let resting bodies sleep (big perf
   *        win for stacks/piles; bodies wake on collision, edits and dragging)
   * @param {number} [opts.fixedDt] fixed timestep in ms (default 1000/60)
   * @param {number} [opts.maxSteps] max fixed steps per advance() (default 5)
   */
  constructor(opts = {}) {
    const M = opts.matter || matter();
    this.M = M;
    const { Engine } = M;
    this.engine = Engine.create({ enableSleeping: opts.enableSleeping === true });
    this.world = this.engine.world;
    this.fixedDt = num(opts.fixedDt, 1000 / 60);
    this.maxSteps = Math.max(1, Math.round(num(opts.maxSteps, 5)));
    this._acc = 0;
    this._byId = new Map();        // id -> Matter body
    this._cons = new Map();        // id -> {constraint, desc}
    this._seq = 1;
    this._drag = null;
    this.onChange = null;          // () => void, structural changes
    this._collisionCbs = [];
    if (opts.gravity) this.setGravity(opts.gravity.x, opts.gravity.y, opts.gravity.enabled !== false);
    M.Events.on(this.engine, 'collisionStart', (ev) => {
      if (!this._collisionCbs.length) return;
      for (const pair of ev.pairs) {
        for (const cb of this._collisionCbs) cb(pair.bodyA, pair.bodyB, pair);
      }
    });
  }

  /* ---------------- gravity ---------------- */
  setGravity(x, y, enabled = true) {
    this.engine.gravity.x = enabled ? num(x, 0) : 0;
    this.engine.gravity.y = enabled ? num(y, 0) : 0;
  }
  get gravity() { return this.engine.gravity; }

  /* ---------------- bodies ---------------- */
  /**
   * Create a body from a plain descriptor and add it to the world.
   * desc: { id?, kind:'circle'|'rect'|'polygon', x, y, angle?(rad), width,
   *   height, radius, sides, density, friction, frictionAir, restitution,
   *   isStatic, lockRotation, vx, vy, label, userData }
   * Returns the Matter body. The (normalized) descriptor is kept on the body
   * and can be read back with describeBody().
   */
  addBody(partial = {}) {
    const M = this.M;
    const { Bodies, Body, Composite } = M;
    const kind = BODY_KINDS.includes(partial.kind) ? partial.kind : 'rect';
    const desc = {
      id: typeof partial.id === 'string' && partial.id ? partial.id : `body-${this._seq++}`,
      kind,
      x: num(partial.x, 0), y: num(partial.y, 0),
      angle: num(partial.angle, 0),
      width: num(partial.width, 64), height: num(partial.height, 64),
      radius: num(partial.radius, 30),
      sides: Math.max(3, Math.round(num(partial.sides, 6))),
      density: num(partial.density, 0.001),
      friction: num(partial.friction, 0.3),
      frictionAir: num(partial.frictionAir, 0.01),
      restitution: num(partial.restitution, 0.2),
      isStatic: partial.isStatic === true,
      lockRotation: partial.lockRotation === true,
      vx: num(partial.vx, 0), vy: num(partial.vy, 0),
      label: typeof partial.label === 'string' ? partial.label : '',
      userData: partial.userData && typeof partial.userData === 'object' ? partial.userData : {},
    };
    const opts = {
      angle: desc.angle, density: desc.density, friction: desc.friction,
      frictionAir: desc.frictionAir, restitution: desc.restitution,
      isStatic: desc.isStatic, label: desc.label || kind,
      ...(desc.lockRotation ? { inertia: Infinity } : {}),
    };
    let body;
    if (kind === 'circle') body = Bodies.circle(desc.x, desc.y, desc.radius, opts);
    else if (kind === 'polygon') body = Bodies.polygon(desc.x, desc.y, desc.sides, desc.radius, opts);
    else body = Bodies.rectangle(desc.x, desc.y, desc.width, desc.height, opts);
    body.plugin = body.plugin || {};
    body.plugin.pe = { id: desc.id, kind, desc };
    if (Number.isFinite(body.inertia)) body._peInertia0 = body.inertia;
    if (!desc.isStatic && (desc.vx || desc.vy)) Body.setVelocity(body, { x: desc.vx, y: desc.vy });
    Composite.add(this.world, body);
    this._byId.set(desc.id, body);
    this._emitChange();
    return body;
  }

  removeBody(id) {
    const body = this._byId.get(id);
    if (!body) return false;
    if (this._drag && this._drag.bodyB === body) this.endDrag();
    for (const [cid, rec] of [...this._cons]) {
      if (rec.desc.bodyA === id || rec.desc.bodyB === id) this.removeConstraint(cid, false);
    }
    this.M.Composite.remove(this.world, body);
    this._byId.delete(id);
    this._emitChange();
    return true;
  }

  clear() {
    for (const { constraint } of this._cons.values()) this.M.Composite.remove(this.world, constraint);
    this._cons.clear();
    for (const b of this._byId.values()) this.M.Composite.remove(this.world, b);
    this._byId.clear();
    this.endDrag();
    this._acc = 0;
    this._emitChange();
  }

  bodyById(id) { return this._byId.get(id) || null; }
  idOf(body) { return body && body.plugin && body.plugin.pe ? body.plugin.pe.id : null; }
  kindOf(body) { return body && body.plugin && body.plugin.pe ? body.plugin.pe.kind : 'rect'; }
  userDataOf(body) { return body && body.plugin && body.plugin.pe ? body.plugin.pe.desc.userData : {}; }
  /** All bodies as an array (insertion order). Allocates; use in UI code, not per-frame loops. */
  allBodies() { return [...this._byId.values()]; }
  /** Allocation-free iteration for render loops. */
  forEachBody(fn) { for (const b of this._byId.values()) fn(b); }
  get count() { return this._byId.size; }

  /** Topmost body containing the world point, or null. */
  pick(wx, wy) {
    const arr = [...this._byId.values()];
    for (let i = arr.length - 1; i >= 0; i--) {
      const b = arr[i];
      if (this.M.Bounds.contains(b.bounds, { x: wx, y: wy }) &&
          this.M.Vertices.contains(b.vertices, { x: wx, y: wy })) return b;
    }
    return null;
  }

  /** Live snapshot of one body merged over its stored descriptor. */
  describeBody(body) {
    const rec = body.plugin.pe;
    const d = rec.desc;
    return {
      ...d,
      userData: { ...d.userData },
      x: body.position.x, y: body.position.y, angle: body.angle,
      vx: body.velocity.x, vy: body.velocity.y,
      density: body.density, friction: body.friction, frictionAir: body.frictionAir,
      restitution: body.restitution, isStatic: body.isStatic,
      lockRotation: rec.desc.lockRotation === true,
      mass: body.mass,
    };
  }

  /* ---------------- constraints (springs / rods) ---------------- */
  /**
   * desc: { id?, bodyA (id or null for a fixed world anchor), bodyB (id),
   *   pointA, pointB (body-local offsets; world coords when bodyA is null),
   *   stiffness 0..1 (1 = rigid rod), damping, length (null = current distance) }
   */
  addConstraint(partial = {}) {
    const M = this.M;
    const bodyB = this._byId.get(partial.bodyB);
    if (!bodyB) return null;
    const bodyA = partial.bodyA ? this._byId.get(partial.bodyA) : null;
    if (partial.bodyA && !bodyA) return null;
    const pt = (p) => ({ x: num(p && p.x, 0), y: num(p && p.y, 0) });
    const desc = {
      id: typeof partial.id === 'string' && partial.id ? partial.id : `con-${this._seq++}`,
      bodyA: bodyA ? this.idOf(bodyA) : null,
      bodyB: this.idOf(bodyB),
      pointA: pt(partial.pointA), pointB: pt(partial.pointB),
      stiffness: Math.min(1, Math.max(0.001, num(partial.stiffness, 0.08))),
      damping: Math.min(1, Math.max(0, num(partial.damping, 0.05))),
      length: partial.length === null || partial.length === undefined ? null : Math.max(0, num(partial.length, 0)),
    };
    if (desc.length === null) {
      const a = bodyA ? localToWorld(M, bodyA, desc.pointA) : desc.pointA;
      const b = localToWorld(M, bodyB, desc.pointB);
      desc.length = Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 100) / 100;
    }
    const constraint = M.Constraint.create({
      bodyA: bodyA || undefined, bodyB,
      pointA: desc.pointA, pointB: desc.pointB,
      stiffness: desc.stiffness, damping: desc.damping, length: desc.length,
    });
    M.Composite.add(this.world, constraint);
    this._cons.set(desc.id, { constraint, desc });
    this._emitChange();
    return constraint;
  }

  removeConstraint(id, emit = true) {
    const rec = this._cons.get(id);
    if (!rec) return false;
    this.M.Composite.remove(this.world, rec.constraint);
    this._cons.delete(id);
    if (emit) this._emitChange();
    return true;
  }

  get constraintCount() { return this._cons.size; }
  describeConstraints() { return [...this._cons.values()].map(({ desc }) => ({ ...desc, pointA: { ...desc.pointA }, pointB: { ...desc.pointB } })); }

  /** Resolved world-space endpoints for rendering / picking.
   *  Pass a reusable array to avoid per-frame allocation: it is cleared and refilled. */
  constraintSegments(out = []) {
    out.length = 0;
    for (const { constraint, desc } of this._cons.values()) {
      const a = constraint.bodyA ? localToWorld(this.M, constraint.bodyA, desc.pointA) : { ...desc.pointA };
      const b = localToWorld(this.M, constraint.bodyB, desc.pointB);
      out.push({ id: desc.id, a, b, stiffness: desc.stiffness });
    }
    return out;
  }

  /* ---------------- bulk load ---------------- */
  load(data = {}) {
    this.clear();
    for (const d of data.bodies || []) this.addBody(d);
    for (const c of data.constraints || []) this.addConstraint(c);
    if (data.gravity) this.setGravity(data.gravity.x, data.gravity.y, data.gravity.enabled !== false);
  }
  snapshot() {
    return {
      bodies: this.allBodies().map((b) => this.describeBody(b)),
      constraints: this.describeConstraints(),
    };
  }

  /* ---------------- simulation ---------------- */
  /**
   * Advance the simulation by elapsed wall-clock ms at the given speed,
   * using fixed timesteps. Returns the number of fixed steps executed.
   * Excess time beyond maxSteps is dropped (no spiral of death).
   */
  advance(elapsedMs, speed = 1) {
    this._acc += Math.min(Math.max(0, num(elapsedMs, 0)), 250) * num(speed, 1);
    let steps = 0;
    while (this._acc >= this.fixedDt && steps < this.maxSteps) {
      this._stepOnce();
      this._acc -= this.fixedDt;
      steps++;
    }
    if (steps === this.maxSteps) this._acc = 0;
    return steps;
  }

  /** Run exactly one fixed step (for step-through / tests). */
  stepOnce() { this._stepOnce(); }

  /** Compatibility helper: advance a single chunk of dt (sub-stepped). */
  step(dtMs, speed = 1) {
    const total = Math.min(num(dtMs, 0), 50) * num(speed, 1);
    const n = Math.max(1, Math.min(8, Math.ceil(total / this.fixedDt)));
    const sub = total / n;
    for (let i = 0; i < n; i++) this._subStep(sub);
  }

  _stepOnce() { this._subStep(this.fixedDt); }

  _subStep(dt) {
    // Rotation lock is a hard guarantee: zero residual angular velocity each
    // step (infinite inertia alone does not stop an explicitly set spin).
    for (const b of this._byId.values()) {
      if (!b.isStatic && b.plugin.pe.desc.lockRotation && b.angularVelocity !== 0) {
        this.M.Body.setAngularVelocity(b, 0);
      }
    }
    this.M.Engine.update(this.engine, dt);
  }

  /* ---------------- property setters (engine stays source of truth) ---------------- */
  wake(body) { if (body.isSleeping) this.M.Sleeping.set(body, false); }
  setPosition(body, x, y) { this.wake(body); this.M.Body.setPosition(body, { x, y }); }
  setVelocity(body, vx, vy) { if (!body.isStatic) { this.wake(body); this.M.Body.setVelocity(body, { x: vx, y: vy }); } }
  setAngleDeg(body, deg) { this.wake(body); this.M.Body.setAngle(body, deg * Math.PI / 180); }
  setDensity(body, v) {
    this.M.Body.setDensity(body, Math.max(0.00001, v));
    if (body.plugin.pe.desc.lockRotation && !body.isStatic) this.M.Body.setInertia(body, Infinity);
    body.plugin.pe.desc.density = body.density;
  }
  setMass(body, v) {
    this.M.Body.setMass(body, Math.max(0.01, v));
    if (body.plugin.pe.desc.lockRotation && !body.isStatic) this.M.Body.setInertia(body, Infinity);
  }
  setFriction(body, v) { body.friction = v; body.plugin.pe.desc.friction = v; }
  setFrictionAir(body, v) { body.frictionAir = Math.min(1, Math.max(0, v)); body.plugin.pe.desc.frictionAir = body.frictionAir; }
  setRestitution(body, v) { body.restitution = v; body.plugin.pe.desc.restitution = v; }
  setStatic(body, flag) {
    this.M.Body.setStatic(body, flag);
    body.plugin.pe.desc.isStatic = flag;
    if (!flag && body.plugin.pe.desc.lockRotation) this.M.Body.setInertia(body, Infinity);
  }
  setLockRotation(body, flag) {
    const rec = body.plugin.pe;
    rec.desc.lockRotation = flag;
    if (body.isStatic) return;
    if (flag) {
      if (Number.isFinite(body.inertia)) body._peInertia0 = body.inertia;
      this.M.Body.setInertia(body, Infinity);
      this.M.Body.setAngularVelocity(body, 0);
    } else if (Number.isFinite(body._peInertia0)) {
      this.M.Body.setInertia(body, body._peInertia0);
    }
  }
  stopMotion(body) {
    if (body.isStatic) return;
    this.wake(body);
    this.M.Body.setVelocity(body, { x: 0, y: 0 });
    this.M.Body.setAngularVelocity(body, 0);
  }

  /** Resize by rebuilding in place: keeps id, material, velocity and userData. */
  resize(body, patch) {
    const desc = this.describeBody(body);
    Object.assign(desc, patch);
    const vel = { x: body.velocity.x, y: body.velocity.y };
    const id = desc.id;
    this.removeBody(id);
    const nb = this.addBody(desc);
    if (!nb.isStatic) this.M.Body.setVelocity(nb, vel);
    return nb;
  }

  /* ---------------- dragging (real physics constraint; bodies can be thrown) ---------------- */
  beginDrag(body, wx, wy) {
    this.endDrag();
    if (!body || body.isStatic) return;
    this.wake(body);
    this._drag = this.M.Constraint.create({
      pointA: { x: wx, y: wy },
      bodyB: body,
      pointB: { x: wx - body.position.x, y: wy - body.position.y },
      stiffness: 0.12, damping: 0.08, length: 0,
    });
    this.M.Composite.add(this.world, this._drag);
  }
  moveDrag(wx, wy) { if (this._drag) this._drag.pointA = { x: wx, y: wy }; }
  endDrag() {
    if (this._drag) { this.M.Composite.remove(this.world, this._drag); this._drag = null; }
  }
  get dragging() { return !!this._drag; }
  get dragBody() { return this._drag ? this._drag.bodyB : null; }

  /* ---------------- events ---------------- */
  onCollision(cb) { if (typeof cb === 'function') this._collisionCbs.push(cb); }
  _emitChange() { if (typeof this.onChange === 'function') this.onChange(); }
}

export default PhysicsEngine;
