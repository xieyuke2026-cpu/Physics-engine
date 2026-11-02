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

   Version: 1.3.0 (exported as VERSION / PhysicsEngine.VERSION)
     1.0.0 — extracted from MotionLab as a project-agnostic core
     1.1.0 — substeps anti-tunnelling (setSubsteps)
     1.2.0 — spatial queries (queryRegion / raycast), impulse helpers
             (addVelocity / applyRadialImpulse), allocation-free pick()
     1.3.0 — seeded RNG (seed option, random / randomRange / randomInt /
             choice / shuffle, setSeed; RNG state rides along in snapshots)
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

/** PhysicsEngine core version — the single source of truth for the core. */
export const VERSION = '1.3.0';

export class PhysicsEngine {
  /** Core version; same value as the module-level VERSION export. */
  static get VERSION() { return VERSION; }

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
   * @param {number} [opts.substeps] physics sub-updates per fixed step
   *        (default 1). Higher values shrink per-update displacement, which
   *        prevents fast bodies tunnelling through thin colliders; 2 is a
   *        good default for scenes with thin statics. User dragging is
   *        exempt by design (the drag constraint is position-driven).
   * @param {number} [opts.seed] seed for the engine's RNG stream (see
   *        random()). Omit it and a random seed is chosen — read it back
   *        via `pe.seed` to reproduce the run later.
   */
  constructor(opts = {}) {
    const M = opts.matter || matter();
    this.M = M;
    const { Engine } = M;
    this.engine = Engine.create({ enableSleeping: opts.enableSleeping === true });
    this.world = this.engine.world;
    this.fixedDt = num(opts.fixedDt, 1000 / 60);
    this.maxSteps = Math.max(1, Math.round(num(opts.maxSteps, 5)));
    this.substeps = Math.max(1, Math.min(8, Math.round(num(opts.substeps, 1))));
    this._acc = 0;
    this._byId = new Map();        // id -> Matter body
    this._bodiesCache = null;      // cached array view of _byId (invalidated on structure change)
    this._locked = new Set();      // bodies with lockRotation — the per-step lock pass touches only these
    this._cons = new Map();        // id -> {constraint, desc}
    this._seq = 1;
    this._drag = null;
    this._pickPt = { x: 0, y: 0 }; // scratch point for pick() — no per-call allocation
    this._seed = 0;                // RNG: the seed the current stream started from
    this._rngState = 0;            // RNG: mulberry32 state (uint32)
    this.setSeed(opts.seed === undefined ? (Math.random() * 4294967296) >>> 0 : opts.seed);
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
    if (desc.lockRotation) this._locked.add(body);
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
    this._locked.delete(body);
    this._emitChange();
    return true;
  }

  clear() {
    for (const { constraint } of this._cons.values()) this.M.Composite.remove(this.world, constraint);
    this._cons.clear();
    for (const b of this._byId.values()) this.M.Composite.remove(this.world, b);
    this._byId.clear();
    this._locked.clear();
    this.endDrag();
    this._acc = 0;
    this._emitChange();
  }

  bodyById(id) { return this._byId.get(id) || null; }
  idOf(body) { return body && body.plugin && body.plugin.pe ? body.plugin.pe.id : null; }
  kindOf(body) { return body && body.plugin && body.plugin.pe ? body.plugin.pe.kind : 'rect'; }
  userDataOf(body) { return body && body.plugin && body.plugin.pe ? body.plugin.pe.desc.userData : {}; }
  /** Cached array view (insertion order). Rebuilt only after a structural change;
   *  internal use — callers must not mutate it. */
  _bodies() {
    if (!this._bodiesCache) this._bodiesCache = [...this._byId.values()];
    return this._bodiesCache;
  }
  /** All bodies as an array (insertion order). Allocates a copy; use in UI code, not per-frame loops. */
  allBodies() { return [...this._bodies()]; }
  /** Allocation-free iteration for render loops. */
  forEachBody(fn) { for (const b of this._byId.values()) fn(b); }
  get count() { return this._byId.size; }

  /** Topmost body containing the world point, or null. */
  pick(wx, wy) {
    const arr = this._bodies();
    const pt = this._pickPt;
    pt.x = wx; pt.y = wy;
    for (let i = arr.length - 1; i >= 0; i--) {
      const b = arr[i];
      if (this.M.Bounds.contains(b.bounds, pt) &&
          this.M.Vertices.contains(b.vertices, pt)) return b;
    }
    return null;
  }

  /** All bodies whose AABB intersects the rectangle (x, y, w, h). Broadphase
   *  only (bounds, not exact shape) — ideal for area effects and culling. */
  queryRegion(x, y, w, h) {
    const x2 = x + w, y2 = y + h;
    const out = [];
    for (const b of this._bodies()) {
      const bd = b.bounds;
      if (bd.min.x <= x2 && bd.max.x >= x && bd.min.y <= y2 && bd.max.y >= y) out.push(b);
    }
    return out;
  }

  /**
   * Bodies intersected by the segment (x1, y1) -> (x2, y2), nearest first.
   * Each hit: { id, body, point, distance } — point is the contact support
   * closest to the segment start. Built on Matter's Query.ray.
   */
  raycast(x1, y1, x2, y2) {
    const hits = this.M.Query.ray(this._bodies(), { x: x1, y: y1 }, { x: x2, y: y2 });
    const seen = new Map();
    for (const h of hits) {
      const body = h.body && h.body.parent ? h.body.parent : h.body;
      if (!body || seen.has(body)) continue;
      const s = (h.collision && h.collision.supports && h.collision.supports[0]) || body.position;
      seen.set(body, {
        id: this.idOf(body), body,
        point: { x: s.x, y: s.y },
        distance: Math.hypot(s.x - x1, s.y - y1),
      });
    }
    return [...seen.values()].sort((a, b) => a.distance - b.distance);
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
    if (data.rng && Number.isFinite(data.rng.state)) {
      // Restore the RNG stream exactly where the snapshot left it, so a
      // loaded world keeps producing the same random sequence.
      this._seed = num(data.rng.seed, this._seed) >>> 0;
      this._rngState = data.rng.state >>> 0;
    }
  }
  snapshot() {
    return {
      bodies: this.allBodies().map((b) => this.describeBody(b)),
      constraints: this.describeConstraints(),
      rng: { seed: this._seed, state: this._rngState },
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

  _stepOnce() {
    // Split the fixed step into `substeps` engine updates (anti-tunnelling:
    // a body can move at most fixedDt/substeps worth of travel per update).
    const n = this.substeps;
    const dt = this.fixedDt / n;
    for (let i = 0; i < n; i++) this._subStep(dt);
  }

  /** Change the anti-tunnelling substep count (1..8). */
  setSubsteps(n) { this.substeps = Math.max(1, Math.min(8, Math.round(num(n, 1)))); }

  _subStep(dt) {
    // Rotation lock is a hard guarantee: zero residual angular velocity each
    // step (infinite inertia alone does not stop an explicitly set spin).
    // Only bodies in the lock set are visited — O(locked), not O(all bodies).
    if (this._locked.size) {
      for (const b of this._locked) {
        if (!b.isStatic && b.angularVelocity !== 0) this.M.Body.setAngularVelocity(b, 0);
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
    if (flag) this._locked.add(body); else this._locked.delete(body);
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

  /** Add to a body's velocity (an impulse-like shove). Static bodies are ignored. */
  addVelocity(body, dvx, dvy) {
    if (!body || body.isStatic) return;
    this.wake(body);
    this.M.Body.setVelocity(body, { x: body.velocity.x + dvx, y: body.velocity.y + dvy });
  }

  /**
   * Radial shove: every non-static body within `radius` of (cx, cy) gains
   * velocity pointing away from the centre, with magnitude
   *   base + power * (1 - distance / radius)
   * Bodies at the exact centre are pushed straight up. An optional
   * `filter(body)` may veto bodies (e.g. host-level boundary walls).
   * Returns the number of bodies affected.
   */
  applyRadialImpulse(cx, cy, opts = {}) {
    const radius = Math.max(1, num(opts.radius, 200));
    const base = num(opts.base, 0), power = num(opts.power, 10);
    const filter = typeof opts.filter === 'function' ? opts.filter : null;
    let hit = 0;
    for (const b of this._bodies()) {
      if (b.isStatic) continue;
      if (filter && !filter(b)) continue;
      const dx = b.position.x - cx, dy = b.position.y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > radius) continue;
      const mag = base + power * (1 - dist / radius);
      const ux = dist > 1 ? dx / dist : 0, uy = dist > 1 ? dy / dist : -1;
      this.addVelocity(b, ux * mag, uy * mag);
      hit++;
    }
    return hit;
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

  /* ---------------- seeded RNG ----------------
     A mulberry32 stream owned by this engine instance: same seed -> same
     sequence, independent of Math.random and of other engines. Use it for
     anything that must be reproducible (procedural scenes, spawn jitter,
     random impulses) — share the seed and the run can be replayed exactly.
     Setting a seed also aligns Matter's own Common._seed, so Matter-level
     helpers that draw randomness start from the same origin. */
  setSeed(n) {
    this._seed = (Number.isFinite(Number(n)) ? Number(n) : 0) >>> 0;
    this._rngState = this._seed;
    if (this.M && this.M.Common) this.M.Common._seed = this._seed;
  }
  /** The seed the current RNG stream started from. */
  get seed() { return this._seed; }

  /** Next float in [0, 1). */
  random() {
    this._rngState = (this._rngState + 0x6D2B79F5) >>> 0;
    let t = this._rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Float in [min, max). */
  randomRange(min, max) { return min + this.random() * (max - min); }
  /** Integer in [min, max], both ends inclusive. */
  randomInt(min, max) { return Math.floor(min + this.random() * (Math.floor(max) - min + 1)); }
  /** A random element of the array (undefined for an empty array). */
  choice(arr) { return arr && arr.length ? arr[Math.floor(this.random() * arr.length)] : undefined; }
  /** Fisher–Yates shuffle driven by this stream; in place, returns the array. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  /* ---------------- events ---------------- */
  onCollision(cb) { if (typeof cb === 'function') this._collisionCbs.push(cb); }
  _emitChange() {
    this._bodiesCache = null; // any structural change invalidates the cached view
    if (typeof this.onChange === 'function') this.onChange();
  }
}

export default PhysicsEngine;
