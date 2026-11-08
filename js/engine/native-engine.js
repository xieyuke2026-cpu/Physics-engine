/* ============================================================================
   NativeEngine — a self-developed rigid-body solver behind the
   PhysicsEngine API (backend id "native", registered in BACKENDS).

   Written from scratch for MotionLab 1.41: no physics library inside.
   Fixed-timestep simulation (advance / stepOnce, substeps split the
   integration + collision pass), sequential-impulse contacts with
   friction and restitution, distance constraints (springs & rods),
   revolute hinges with motors, sleeping, and the engine-level force
   models the API promises — pairwise gravitation, magnetism, fluid
   buoyancy (true clipped submerged area, centre of buoyancy, underside
   seal) and gusting wind regions — with the same constants and
   semantics as the Matter backend, so scenes behave comparably.

   Deliberate simplifications vs the Matter backend (documented, not
   silent): force models and hinge motors kick once per FIXED step
   (the Matter backend already does this for pair forces and motors;
   native extends the rule to gravity, fluids and winds, which makes
   native's response independent of the anti-tunnelling substep count);
   position correction is linear-only (rotation settles through the
   velocity solver's contact points). One solver property differs:
   the substep count has a floor of 2 — at a single substep the
   penetration/bias feedback loop in tall stacks is under-damped and
   towers slowly tip (measured: a 5-box tower diverges at substeps 1,
   is rock-stable at 2+), so the constructor and setSubsteps clamp to
   at least 2. Hosts that pass substeps ≥ 2 (MotionLab does) are
   unaffected. Known limits (1.43): a 10-high single-column tower
   still topples; dense piles settle/sleep more slowly than Matter's;
   at substeps > 2 an extreme pile pressed against a thin wall can
   squeeze a body through it (the app's shipped configuration is 2).
   1.12.3 adds the orphan-sleeper probe (shared with the Matter
   backend): every 15 fixed steps, sleeping bodies with no support
   chain — touching path to a non-sleeping body, a constraint/hinge
   attachment, or a fluid overlap — are woken, so deleting or
   dragging away a support can no longer leave bodies hovering.
   Bodies expose the field shape
   the hosts read (position / velocity / angle / vertices / bounds /
   circleRadius / plugin.pe.desc), so existing renderers work as-is.

   Units match the API: pixels, y down, velocities in px/step,
   angles in radians, mass = density × area.
   ========================================================================== */

const num = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Per-step gravity velocity gain at gravity 1 (matches the Matter
 *  backend's measured ≈0.28 px/step per step: g · 0.001 · (1000/60)²). */
const GRAVITY_STEP = 0.001 * (1000 / 60) * (1000 / 60);
// Shared scratch vectors for the contact solver (1.12.5): _solveContact
// runs 10 iterations x every contact x every substep; allocating two
// objects per call was a steady GC drip at high body counts. Safe: the
// solver is strictly sequential and nothing re-enters it mid-call.
const _scratchVa = { x: 0, y: 0 };
const _scratchVb = { x: 0, y: 0 };

/* ---------------- polygon helpers (local, centroid-relative) ------------- */
function polyAreaInertia(verts) {
  let s0 = 0, s1 = 0;
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i], q = verts[(i + 1) % verts.length];
    const cr = p.x * q.y - q.x * p.y;
    s0 += cr;
    s1 += cr * (p.x * p.x + p.x * q.x + q.x * q.x + p.y * p.y + p.y * q.y + q.y * q.y);
  }
  return { area: Math.abs(s0) / 2, inertiaPerMass: s0 !== 0 ? Math.abs(s1 / (6 * s0)) : 0 };
}

/** Clip a world-space polygon to an axis-aligned rectangle
 *  (Sutherland–Hodgman) — the fluid submerged-area workhorse. */
function clipRect(poly, left, top, right, bottom) {
  const clip = (pts, inside, cross) => {
    if (!pts.length) return pts;
    const out = [];
    for (let j = 0; j < pts.length; j++) {
      const cur = pts[j], prv = pts[(j + pts.length - 1) % pts.length];
      const ci = inside(cur), pi = inside(prv);
      if (ci) { if (!pi) out.push(cross(prv, cur)); out.push(cur); }
      else if (pi) out.push(cross(prv, cur));
    }
    return out;
  };
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
  for (const p of poly) { if (p.x < mnx) mnx = p.x; if (p.x > mxx) mxx = p.x; if (p.y < mny) mny = p.y; if (p.y > mxy) mxy = p.y; }
  if (mnx < left) poly = clip(poly, (p) => p.x >= left, (a, b) => lerp(a, b, (left - a.x) / ((b.x - a.x) || 1e-12)));
  if (mxx > right) poly = clip(poly, (p) => p.x <= right, (a, b) => lerp(a, b, (right - a.x) / ((b.x - a.x) || 1e-12)));
  if (mny < top) poly = clip(poly, (p) => p.y >= top, (a, b) => lerp(a, b, (top - a.y) / ((b.y - a.y) || 1e-12)));
  if (mxy > bottom) poly = clip(poly, (p) => p.y <= bottom, (a, b) => lerp(a, b, (bottom - a.y) / ((b.y - a.y) || 1e-12)));
  return poly;
}

/** Signed-area centroid of a clipped polygon; null when degenerate. */
function clippedCentroid(poly) {
  let a2 = 0, sx = 0, sy = 0;
  for (let j = 0; j < poly.length; j++) {
    const p = poly[j], q = poly[(j + 1) % poly.length];
    const cr = p.x * q.y - q.x * p.y;
    a2 += cr; sx += (p.x + q.x) * cr; sy += (p.y + q.y) * cr;
  }
  if (Math.abs(a2) < 1e-9) return null;
  const a = a2 / 2;
  return { x: sx / (6 * a), y: sy / (6 * a), area: Math.abs(a) };
}

/** Point-in-polygon (ray cast) over world-space vertices. */
function pointInPoly(verts, x, y) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const a = verts[i], b = verts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export class NativeEngine {
  constructor(opts = {}) {
    this.backendId = 'native';
    this.fixedDt = num(opts.fixedDt, 1000 / 60);
    this.maxSteps = Math.max(1, Math.round(num(opts.maxSteps, 5)));
    this.substeps = Math.max(2, Math.min(8, Math.round(num(opts.substeps, 2))));
    this.enableSleeping = opts.enableSleeping === true;
    this.constraintIterations = Math.max(1, Math.round(num(opts.constraintIterations, 4)));
    this._acc = 0;
    this._simMs = 0;
    this._byId = new Map();
    this._cons = new Map();
    this._hinges = new Map();
    this._fluids = new Map();
    this._winds = new Map();
    this._emitters = new Map();    // (1.12.8) twin of the Matter facade
    this._emStepIdx = 0;           // last fixed-step index emitters fired for
    this._fluidFlow = new Map();
    this._seq = 1;
    this._drag = null;
    this._grav = { x: num(opts.gravity && opts.gravity.x, 0), y: num(opts.gravity && opts.gravity.y, 1) };
    this._gravEnabled = true;
    this._gravitation = null;
    if (opts.gravitation !== undefined && opts.gravitation !== null) {
      const g = typeof opts.gravitation === 'number' ? { G: opts.gravitation } : opts.gravitation;
      this.setGravitation(g.G, g);
    }
    this._magnetism = { K: 1.2, range: 320, softening: 900 };
    this._magnets = new Set();
    this._maxSpeed = Math.max(0, num(opts.maxSpeed, 0));
    this._seed = 0;
    this._rngState = 0;
    this.setSeed(opts.seed === undefined ? (Math.random() * 4294967296) >>> 0 : opts.seed);
    this.onChange = null;
    this._collisionCbs = [];
    this._contactCache = new Map();
    this._activePairs = new Set();
    this._segPool = [];
    this._clusterRoot = new Map(); // hinge clusters: bodyId -> root id
  }

  /* ------------------------------ gravity ------------------------------ */
  setGravity(x, y, enabled = true) {
    this._grav.x = num(x, 0);
    this._grav.y = num(y, 0);
    this._gravEnabled = enabled !== false;
  }
  get gravity() {
    return this._gravEnabled ? { x: this._grav.x, y: this._grav.y } : { x: 0, y: 0 };
  }
  get simTime() { return this._simMs; }

  /* --------------------------- seeded RNG ------------------------------ */
  setSeed(n) {
    this._seed = Number(n) >>> 0;
    this._rngState = this._seed;
    return this._seed;
  }
  get seed() { return this._seed; }
  random() {
    this._rngState = (this._rngState + 0x6D2B79F5) >>> 0;
    let t = this._rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  randomRange(min, max) { return min + (max - min) * this.random(); }
  randomInt(min, max) { return Math.floor(this.randomRange(min, max + 1)); }
  choice(arr) { return arr[Math.floor(this.random() * arr.length)]; }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /* ------------------------------ bodies ------------------------------- */
  addBody(partial = {}) {
    const kind = ['circle', 'rect', 'polygon'].includes(partial.kind) ? partial.kind : 'rect';
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
      label: typeof partial.label === 'string' ? partial.label : '',
      name: typeof partial.name === 'string' ? partial.name : '',
      magnet: Math.min(100, Math.max(-100, num(partial.magnet, 0))),
      vx: num(partial.vx, 0), vy: num(partial.vy, 0),
      va: num(partial.va, 0),
      sleeping: partial.sleeping === true,
      noSleep: partial.noSleep === true,
      emitter: typeof partial.emitter === 'string' ? partial.emitter : '',
      userData: partial.userData && typeof partial.userData === 'object' ? { ...partial.userData } : {},
    };
    let local = null, area = 0, inertiaPerMass = 0;
    if (kind === 'circle') {
      area = Math.PI * desc.radius * desc.radius;
      inertiaPerMass = 0.5 * desc.radius * desc.radius;
      // Hosts draw EVERY body through body.vertices (the renderer opens
      // its path at vertices[0]) and Matter circle bodies carry a polygon
      // approximation — so circles expose one too (10–25 sides, mirroring
      // Matter's rule). Physics still treats the body as a true circle;
      // _local only feeds vertices/bounds via _syncShape.
      const sides = Math.max(10, Math.min(25, Math.ceil(desc.radius)));
      local = [];
      for (let i = 0; i < sides; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
        local.push({ x: Math.cos(a) * desc.radius, y: Math.sin(a) * desc.radius });
      }
    } else if (kind === 'rect') {
      const hw = desc.width / 2, hh = desc.height / 2;
      local = [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }];
      const pi = polyAreaInertia(local);
      area = pi.area; inertiaPerMass = pi.inertiaPerMass;
    } else {
      local = [];
      for (let i = 0; i < desc.sides; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / desc.sides;
        local.push({ x: Math.cos(a) * desc.radius, y: Math.sin(a) * desc.radius });
      }
      const pi = polyAreaInertia(local);
      area = pi.area; inertiaPerMass = pi.inertiaPerMass;
    }
    const density = Math.max(0.00001, desc.density);
    const mass = desc.isStatic ? Infinity : Math.max(1e-6, area * density);
    const body = {
      id: desc.id,
      plugin: { pe: { id: desc.id, kind, desc } },
      position: { x: desc.x, y: desc.y },
      // Snapshot fidelity (1.12.6): spin and sleep state round-trip too
      // (twin of the Matter facade). A sleeping body is restored in the
      // exact state this engine's own sleep transition produces: zeroed
      // velocities, sleepCounter at threshold, no residual motion.
      velocity: desc.sleeping && !desc.isStatic ? { x: 0, y: 0 } : { x: desc.vx, y: desc.vy },
      angle: desc.angle,
      angularVelocity: desc.isStatic || desc.sleeping ? 0 : (Number.isFinite(desc.va) ? desc.va : 0),
      isStatic: desc.isStatic,
      isSleeping: !desc.isStatic && desc.sleeping === true,
      sleepCounter: !desc.isStatic && desc.sleeping === true ? 30 : 0,
      _motion: 0,
      _supportAge: 9999,
      density: desc.density,
      friction: desc.friction,
      frictionAir: desc.frictionAir,
      restitution: desc.restitution,
      circleRadius: kind === 'circle' ? desc.radius : 0,
      vertices: [],
      bounds: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
      label: desc.label,
      area,
      mass,
      inverseMass: desc.isStatic ? 0 : 1 / mass,
      inertia: desc.isStatic || desc.lockRotation ? Infinity : Math.max(1e-6, mass * inertiaPerMass),
      inverseInertia: desc.isStatic || desc.lockRotation ? 0 : 1 / Math.max(1e-6, mass * inertiaPerMass),
      speed: 0,
      angularSpeed: 0,
      _local: local,
      _inertiaPerMass: inertiaPerMass,
    };
    body._ord = (this._ordSeq = (this._ordSeq || 0) + 1);
    this._byId.set(desc.id, body);
    if (desc.magnet !== 0) this._magnets.add(body);
    this._syncShape(body);
    this._changed();
    return body;
  }

  _syncShape(b) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    if (b._local) {
      b.vertices.length = b._local.length;
      let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
      for (let i = 0; i < b._local.length; i++) {
        const p = b._local[i];
        const wx = b.position.x + p.x * c - p.y * s;
        const wy = b.position.y + p.x * s + p.y * c;
        if (b.vertices[i]) { b.vertices[i].x = wx; b.vertices[i].y = wy; }
        else b.vertices[i] = { x: wx, y: wy };
        if (wx < mnx) mnx = wx; if (wx > mxx) mxx = wx;
        if (wy < mny) mny = wy; if (wy > mxy) mxy = wy;
      }
      b.bounds.min.x = mnx; b.bounds.max.x = mxx;
      b.bounds.min.y = mny; b.bounds.max.y = mxy;
    } else {
      const r = b.circleRadius;
      b.bounds.min.x = b.position.x - r; b.bounds.max.x = b.position.x + r;
      b.bounds.min.y = b.position.y - r; b.bounds.max.y = b.position.y + r;
    }
    b.speed = Math.hypot(b.velocity.x, b.velocity.y);
    b.angularSpeed = Math.abs(b.angularVelocity);
  }

  _wake(b) {
    if (b.isSleeping) { b.isSleeping = false; b.sleepCounter = 0; b._motion = 0.1; }
  }
  _changed() { if (typeof this.onChange === 'function') this.onChange(); }

  removeBody(idOrBody) {
    const id = typeof idOrBody === 'string' ? idOrBody : this.idOf(idOrBody);
    const b = this._byId.get(id);
    if (!b) return false;
    this._byId.delete(id);
    this._magnets.delete(b);
    for (const [cid, c] of this._cons) {
      if (c.bodyA === id || c.bodyB === id) this._cons.delete(cid);
    }
    for (const [hid, h] of this._hinges) {
      if (h.bodyA === id || h.bodyB === id) this._hinges.delete(hid);
    }
    this._rebuildClusters();
    if (this._drag && this._drag.body === b) this._drag = null;
    this._changed();
    return true;
  }

  clear() {
    this._byId.clear();
    this._cons.clear();
    this._hinges.clear();
    this._fluids.clear();
    this._winds.clear();
    this._emitters.clear();
    this._fluidFlow.clear();
    this._magnets.clear();
    this._clusterRoot.clear();
    this._drag = null;
    this._activePairs.clear();
    this._changed();
  }

  allBodies() { return [...this._byId.values()]; }
  forEachBody(fn) { for (const b of this._byId.values()) fn(b); }
  get count() { return this._byId.size; }
  bodyById(id) { return this._byId.get(id) || null; }
  idOf(body) { return body && body.plugin && body.plugin.pe ? body.plugin.pe.id : null; }
  kindOf(body) { return body && body.plugin && body.plugin.pe ? body.plugin.pe.kind : 'rect'; }
  userDataOf(body) { return body && body.plugin && body.plugin.pe ? body.plugin.pe.desc.userData : {}; }
  nameOf(body) { return body && body.plugin && body.plugin.pe ? body.plugin.pe.desc.name : ''; }
  getBodyByName(name) {
    for (const b of this._byId.values()) if (b.plugin.pe.desc.name === name) return b;
    return null;
  }
  getBodiesByName(name) {
    const out = [];
    for (const b of this._byId.values()) if (b.plugin.pe.desc.name === name) out.push(b);
    return out;
  }
  renameBody(bodyOrId, name) {
    const b = typeof bodyOrId === 'string' ? this._byId.get(bodyOrId) : bodyOrId;
    if (!b || !b.plugin || !b.plugin.pe) return false;
    b.plugin.pe.desc.name = typeof name === 'string' ? name : String(name ?? '');
    return true;
  }

  describeBody(body) {
    const rec = body.plugin.pe;
    const d = rec.desc;
    return {
      ...d,
      userData: { ...d.userData },
      x: body.position.x, y: body.position.y, angle: body.angle,
      vx: body.velocity.x, vy: body.velocity.y, va: body.angularVelocity,
      sleeping: body.isSleeping === true,
      density: body.density, friction: body.friction, frictionAir: body.frictionAir,
      restitution: body.restitution, isStatic: body.isStatic,
      lockRotation: rec.desc.lockRotation === true,
      mass: body.isStatic ? 0 : body.mass,
    };
  }

  static validateDescriptor(d) {
    const problems = [];
    if (!d || typeof d !== 'object') return ['descriptor is not an object'];
    if (d.kind !== undefined && !['circle', 'rect', 'polygon'].includes(d.kind)) problems.push(`unknown kind: ${String(d.kind)}`);
    for (const k of ['x', 'y', 'angle', 'density', 'friction', 'frictionAir', 'restitution']) {
      if (d[k] !== undefined && !Number.isFinite(Number(d[k]))) problems.push(`${k} is not a finite number`);
    }
    const kind = d.kind || 'rect';
    if (kind === 'circle' || kind === 'polygon') {
      if (d.radius !== undefined && !(Number(d.radius) > 0)) problems.push('radius must be > 0');
    } else {
      if (d.width !== undefined && !(Number(d.width) > 0)) problems.push('width must be > 0');
      if (d.height !== undefined && !(Number(d.height) > 0)) problems.push('height must be > 0');
    }
    if (d.density !== undefined && Number(d.density) < 0) problems.push('density must be >= 0');
    if (d.name !== undefined && typeof d.name !== 'string') problems.push('name must be a string');
    if (d.magnet !== undefined && !Number.isFinite(Number(d.magnet))) problems.push('magnet is not a finite number');
    return problems;
  }

  /* ---------------------------- constraints ---------------------------- */
  addConstraint(partial = {}) {
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
      stiffness: clamp(num(partial.stiffness, 0.1), 0, 1),
      damping: Math.max(0, num(partial.damping, 0.05)),
      length: partial.length === null || partial.length === undefined ? null : Math.max(0, num(partial.length, 0)),
    };
    if (desc.length === null) {
      const a = this._anchorWorld(desc, 'A'), b = this._anchorWorld(desc, 'B');
      desc.length = Math.hypot(b.x - a.x, b.y - a.y);
    }
    this._cons.set(desc.id, desc);
    this._changed();
    return { ...desc, pointA: { ...desc.pointA }, pointB: { ...desc.pointB } };
  }
  removeConstraint(id) {
    const ok = this._cons.delete(id);
    if (ok) this._changed();
    return ok;
  }
  get constraintCount() { return this._cons.size; }
  describeConstraints() {
    return [...this._cons.values()].map((c) => ({ ...c, pointA: { ...c.pointA }, pointB: { ...c.pointB } }));
  }
  _anchorWorld(desc, which) {
    const id = which === 'A' ? desc.bodyA : desc.bodyB;
    const pt = which === 'A' ? desc.pointA : desc.pointB;
    if (!id) return { x: pt.x, y: pt.y };
    const b = this._byId.get(id);
    if (!b) return { x: pt.x, y: pt.y };
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    return {
      x: b.position.x + pt.x * c - pt.y * s,
      y: b.position.y + pt.x * s + pt.y * c,
    };
  }
  constraintSegments(out = []) {
    out.length = 0;
    let k = 0;
    for (const desc of this._cons.values()) {
      let seg = this._segPool[k];
      if (!seg) seg = this._segPool[k] = { id: '', a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, stiffness: 0 };
      seg.id = desc.id;
      seg.stiffness = desc.stiffness;
      const a = this._anchorWorld(desc, 'A'), b = this._anchorWorld(desc, 'B');
      seg.a.x = a.x; seg.a.y = a.y; seg.b.x = b.x; seg.b.y = b.y;
      out.push(seg);
      k++;
    }
    return out;
  }

  /* ------------------------------ hinges ------------------------------- */
  addHinge(partial = {}) {
    const bodyB = this._byId.get(partial.bodyB);
    if (!bodyB) return null;
    const bodyA = partial.bodyA ? this._byId.get(partial.bodyA) : null;
    if (partial.bodyA && !bodyA) return null;
    const pt = (p) => ({ x: num(p && p.x, 0), y: num(p && p.y, 0) });
    const desc = {
      id: typeof partial.id === 'string' && partial.id ? partial.id : `hinge-${this._seq++}`,
      bodyA: bodyA ? this.idOf(bodyA) : null,
      bodyB: this.idOf(bodyB),
      pointA: pt(partial.pointA), pointB: pt(partial.pointB),
      motorSpeed: clamp(num(partial.motorSpeed, 0), -0.3, 0.3),
      motorPower: clamp(num(partial.motorPower, 0.0025), 0.0001, 0.05),
    };
    this._hinges.set(desc.id, desc);
    this._rebuildClusters();
    this._changed();
    return { ...desc, pointA: { ...desc.pointA }, pointB: { ...desc.pointB } };
  }
  removeHinge(id) {
    const ok = this._hinges.delete(id);
    if (ok) { this._rebuildClusters(); this._changed(); }
    return ok;
  }
  hingeById(id) {
    const h = this._hinges.get(id);
    return h ? { ...h, pointA: { ...h.pointA }, pointB: { ...h.pointB } } : null;
  }
  describeHinges() {
    return [...this._hinges.values()].map((h) => ({ ...h, pointA: { ...h.pointA }, pointB: { ...h.pointB } }));
  }
  get hingeCount() { return this._hinges.size; }
  hingeAnchors() {
    const out = [];
    for (const h of this._hinges.values()) {
      out.push({ id: h.id, a: this._anchorWorld(h, 'A'), b: this._anchorWorld(h, 'B') });
    }
    return out;
  }
  setHingeMotor(id, v) {
    const h = this._hinges.get(id);
    if (!h || !Number.isFinite(Number(v))) return false;
    h.motorSpeed = clamp(Number(v), -0.3, 0.3);
    return true;
  }
  /** Union-find over hinge-connected bodies: cluster members do not
   *  collide with each other (the Matter backend's negative collision
   *  groups, 1.7.0 — hinged machine parts must fold without jamming). */
  _rebuildClusters() {
    this._clusterRoot.clear();
    const parent = new Map();
    const find = (x) => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r);
      return r;
    };
    const union = (a, b) => {
      if (!parent.has(a)) parent.set(a, a);
      if (!parent.has(b)) parent.set(b, b);
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    for (const h of this._hinges.values()) {
      if (h.bodyA && h.bodyB) union(h.bodyA, h.bodyB);
    }
    for (const id of parent.keys()) this._clusterRoot.set(id, find(id));
  }
  _sameCluster(aId, bId) {
    const ra = this._clusterRoot.get(aId), rb = this._clusterRoot.get(bId);
    return ra !== undefined && ra === rb;
  }

  /* ------------------------- fluids & winds ---------------------------- */
  addFluid(partial = {}) {
    const rec = {
      id: typeof partial.id === 'string' && partial.id ? partial.id : `fluid-${this._seq++}`,
      x: num(partial.x, 0), y: num(partial.y, 0),
      width: Math.max(1, num(partial.width, 400)), height: Math.max(1, num(partial.height, 240)),
      density: Math.max(0, num(partial.density, 0.0012)),
      drag: clamp(num(partial.drag, 0.08), 0, 1),
      vx: clamp(num(partial.vx, 0), -16, 16), vy: clamp(num(partial.vy, 0), -16, 16),
    };
    this._fluids.set(rec.id, rec);
    this._changed();
    return { ...rec };
  }
  removeFluid(id) {
    const ok = this._fluids.delete(id);
    if (ok) { this._fluidFlow.delete(id); this._changed(); }
    return ok;
  }
  clearFluids() { this._fluids.clear(); }
  fluidById(id) { const f = this._fluids.get(id); return f ? { ...f } : null; }
  fluids() { return [...this._fluids.values()].map((f) => ({ ...f })); }
  forEachFluid(fn) { for (const f of this._fluids.values()) fn(f); }
  get fluidCount() { return this._fluids.size; }
  fluidFlow(id) {
    const e = this._fluidFlow.get(id);
    if (e) return { x: e.x, y: e.y };
    const f = this._fluids.get(id);
    return f ? { x: f.vx, y: f.vy } : null;
  }

  addWind(partial = {}) {
    const rec = {
      id: typeof partial.id === 'string' && partial.id ? partial.id : `wind-${this._seq++}`,
      x: num(partial.x, 0), y: num(partial.y, 0),
      width: Math.max(1, num(partial.width, 400)), height: Math.max(1, num(partial.height, 240)),
      vx: clamp(num(partial.vx, 3), -16, 16), vy: clamp(num(partial.vy, 0), -16, 16),
      power: clamp(num(partial.power, 1), 0, 2),
      gust: clamp(num(partial.gust, 0), 0, 0.9),
      gustPeriod: clamp(num(partial.gustPeriod, 6), 2, 30),
    };
    this._winds.set(rec.id, rec);
    this._changed();
    return { ...rec };
  }
  removeWind(id) {
    const ok = this._winds.delete(id);
    if (ok) this._changed();
    return ok;
  }
  windById(id) { const w = this._winds.get(id); return w ? { ...w } : null; }
  clearWinds() { this._winds.clear(); }
  winds() { return [...this._winds.values()].map((w) => ({ ...w })); }
  forEachWind(fn) { for (const w of this._winds.values()) fn(w); }
  get windCount() { return this._winds.size; }

  /* ---------------- emitters (1.12.8, twin of the Matter facade) ------
     Same contract: schedule is a pure function of the fixed-step
     index; spawned bodies carry desc.emitter; at the cap the oldest
     spawned body is removed. See physics-engine.js for the full note. */
  addEmitter(partial = {}) {
    const rec = {
      id: typeof partial.id === 'string' && partial.id ? partial.id : `emitter-${this._seq++}`,
      x: num(partial.x, 0), y: num(partial.y, 0),
      angle: num(partial.angle, 0),
      rate: Math.min(30, Math.max(0.2, num(partial.rate, 4))),
      kind: partial.kind === 'rect' ? 'rect' : 'circle',
      size: Math.min(80, Math.max(6, num(partial.size, 16))),
      speed: Math.min(30, Math.max(0, num(partial.speed, 8))),
      cap: Math.min(200, Math.max(1, Math.round(num(partial.cap, 60)))),
      enabled: partial.enabled !== false,
    };
    this._emitters.set(rec.id, rec);
    this._changed();
    return { ...rec };
  }
  removeEmitter(id) {
    const ok = this._emitters.delete(id);
    if (ok) this._changed();
    return ok;
  }
  clearEmitters() { this._emitters.clear(); }
  emitterById(id) { const e = this._emitters.get(id); return e ? { ...e } : null; }
  emitters() { return [...this._emitters.values()].map((e) => ({ ...e })); }
  forEachEmitter(fn) { for (const e of this._emitters.values()) fn(e); }
  get emitterCount() { return this._emitters.size; }

  _runEmitters(stepIdx) {
    for (const e of this._emitters.values()) {
      if (!e.enabled) continue;
      const interval = Math.max(1, Math.round(60 / e.rate));
      if (stepIdx % interval !== 0) continue;
      if (this._byId.size >= 1500) continue;
      let alive = 0, oldestId = null;
      for (const b of this._byId.values()) {
        if (b.plugin.pe.desc.emitter === e.id) { alive++; if (oldestId === null) oldestId = b.plugin.pe.id; }
      }
      if (alive >= e.cap && oldestId !== null) this.removeBody(oldestId);
      const c = Math.cos(e.angle), s = Math.sin(e.angle);
      const off = e.size + 4;
      this.addBody({
        kind: e.kind, x: e.x + c * off, y: e.y + s * off,
        radius: e.size, width: e.size * 2, height: e.size * 2,
        density: 0.001, friction: 0.3, frictionAir: 0.001, restitution: 0.3,
        vx: c * e.speed, vy: s * e.speed,
        emitter: e.id, label: 'Emitter',
      });
    }
  }
  _windVel(w) {
    if (!(w.gust > 0)) return { x: w.vx, y: w.vy };
    const m = 1 + w.gust * Math.sin(6.283185307179586 * (this._simMs / (1000 * w.gustPeriod)));
    return { x: w.vx * m, y: w.vy * m };
  }

  /* --------------------- gravitation & magnetism ----------------------- */
  setGravitation(G, opts = {}) {
    const g = num(G, 0);
    if (!(g > 0)) { this._gravitation = null; return; }
    this._gravitation = { G: g, softening: Math.max(0, num(opts.softening, 100)) };
  }
  get gravitation() { return this._gravitation ? { ...this._gravitation } : null; }
  setMagnetism(K, opts = {}) {
    const k = num(K, 0);
    this._magnetism = {
      K: Math.max(0, k),
      range: Math.max(10, num(opts.range, this._magnetism ? this._magnetism.range : 320)),
      softening: Math.max(0, num(opts.softening, this._magnetism ? this._magnetism.softening : 900)),
    };
  }
  get magnetism() { return { ...this._magnetism }; }
  get magnetCount() { return this._magnets.size; }
  setMagnet(bodyOrId, v) {
    const b = typeof bodyOrId === 'string' ? this._byId.get(bodyOrId) : bodyOrId;
    if (!b || !b.plugin || !b.plugin.pe) return false;
    const val = clamp(num(v, 0), -100, 100);
    b.plugin.pe.desc.magnet = val;
    if (val !== 0) this._magnets.add(b); else this._magnets.delete(b);
    return true;
  }
  magnetOf(bodyOrId) {
    const b = typeof bodyOrId === 'string' ? this._byId.get(bodyOrId) : bodyOrId;
    return b && b.plugin && b.plugin.pe ? b.plugin.pe.desc.magnet : 0;
  }

  /* ------------------------- property setters -------------------------- */
  _bodyOf(bodyOrId) {
    return typeof bodyOrId === 'string' ? this._byId.get(bodyOrId) : bodyOrId;
  }
  setPosition(bodyOrId, x, y) {
    const b = this._bodyOf(bodyOrId);
    if (!b || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    b.position.x = x; b.position.y = y;
    this._wake(b); b.sleepCounter = 0;
    this._syncShape(b);
    return true;
  }
  setAngle(bodyOrId, a) {
    const b = this._bodyOf(bodyOrId);
    if (!b || !Number.isFinite(a)) return false;
    b.angle = a;
    this._wake(b);
    this._syncShape(b);
    return true;
  }
  setAngleDeg(bodyOrId, deg) { return this.setAngle(bodyOrId, (num(deg, 0) * Math.PI) / 180); }
  setVelocity(bodyOrId, vx, vy) {
    const b = this._bodyOf(bodyOrId);
    if (!b || !Number.isFinite(vx) || !Number.isFinite(vy)) return false;
    b.velocity.x = vx; b.velocity.y = vy;
    if (vx !== 0 || vy !== 0) this._wake(b);
    return true;
  }
  setAngularVelocity(bodyOrId, w) {
    const b = this._bodyOf(bodyOrId);
    if (!b || !Number.isFinite(w)) return false;
    if (b.plugin.pe.desc.lockRotation) return false;
    b.angularVelocity = w;
    if (w !== 0) this._wake(b);
    return true;
  }
  addVelocity(bodyOrId, dvx, dvy) {
    const b = this._bodyOf(bodyOrId);
    if (!b || !Number.isFinite(dvx) || !Number.isFinite(dvy)) return false;
    b.velocity.x += dvx; b.velocity.y += dvy;
    this._wake(b);
    return true;
  }
  _recomputeMass(b) {
    const d = b.plugin.pe.desc;
    const density = Math.max(0.00001, b.density);
    if (b.isStatic) { b.mass = Infinity; b.inverseMass = 0; b.inertia = Infinity; b.inverseInertia = 0; return; }
    b.mass = Math.max(1e-6, b.area * density);
    b.inverseMass = 1 / b.mass;
    if (d.lockRotation) { b.inertia = Infinity; b.inverseInertia = 0; }
    else {
      b.inertia = Math.max(1e-6, b.mass * b._inertiaPerMass);
      b.inverseInertia = 1 / b.inertia;
    }
  }
  setDensity(bodyOrId, v) {
    const b = this._bodyOf(bodyOrId);
    if (!b || !Number.isFinite(v)) return false;
    b.density = Math.max(0, v); b.plugin.pe.desc.density = b.density;
    this._recomputeMass(b);
    return true;
  }
  setMass(bodyOrId, v) {
    const b = this._bodyOf(bodyOrId);
    if (!b || !Number.isFinite(v) || v <= 0 || b.isStatic) return false;
    b.density = v / Math.max(1, b.area);
    b.plugin.pe.desc.density = b.density;
    this._recomputeMass(b);
    return true;
  }
  setFriction(bodyOrId, v) {
    const b = this._bodyOf(bodyOrId);
    if (!b || !Number.isFinite(v)) return false;
    b.friction = Math.max(0, v); b.plugin.pe.desc.friction = b.friction;
    return true;
  }
  setFrictionAir(bodyOrId, v) {
    const b = this._bodyOf(bodyOrId);
    if (!b || !Number.isFinite(v)) return false;
    b.frictionAir = clamp(v, 0, 1); b.plugin.pe.desc.frictionAir = b.frictionAir;
    return true;
  }
  setRestitution(bodyOrId, v) {
    const b = this._bodyOf(bodyOrId);
    if (!b || !Number.isFinite(v)) return false;
    b.restitution = Math.max(0, v); b.plugin.pe.desc.restitution = b.restitution;
    return true;
  }
  setStatic(bodyOrId, flag) {
    const b = this._bodyOf(bodyOrId);
    if (!b) return false;
    b.isStatic = flag === true;
    b.plugin.pe.desc.isStatic = b.isStatic;
    if (b.isStatic) { b.velocity.x = 0; b.velocity.y = 0; b.angularVelocity = 0; b.isSleeping = false; }
    this._recomputeMass(b);
    this._wake(b);
    return true;
  }
  setLockRotation(bodyOrId, flag) {
    const b = this._bodyOf(bodyOrId);
    if (!b) return false;
    b.plugin.pe.desc.lockRotation = flag === true;
    if (flag) b.angularVelocity = 0;
    this._recomputeMass(b);
    return true;
  }
  wake(bodyOrId) {
    const b = this._bodyOf(bodyOrId);
    if (b) this._wake(b);
  }
  stopMotion(bodyOrId) {
    const b = this._bodyOf(bodyOrId);
    if (!b) return false;
    b.velocity.x = 0; b.velocity.y = 0; b.angularVelocity = 0;
    return true;
  }
  resize(bodyOrId, patch = {}) {
    const b = this._bodyOf(bodyOrId);
    if (!b || !b.plugin || !b.plugin.pe) return null;
    const d = { ...b.plugin.pe.desc, ...patch, id: b.plugin.pe.desc.id, x: b.position.x, y: b.position.y, angle: b.angle, vx: b.velocity.x, vy: b.velocity.y };
    const id = b.plugin.pe.desc.id;
    const omega = b.angularVelocity;
    this.removeBody(id);
    const nb = this.addBody(d);
    if (nb) { nb.angularVelocity = omega; }
    return nb;
  }
  findNonFiniteBodies() {
    const out = [];
    for (const b of this._byId.values()) {
      if (!Number.isFinite(b.position.x) || !Number.isFinite(b.position.y)
        || !Number.isFinite(b.velocity.x) || !Number.isFinite(b.velocity.y)
        || !Number.isFinite(b.angle)) out.push(b);
    }
    return out;
  }

  /* ---------------------------- measurements --------------------------- */
  bodyKineticEnergy(body) {
    if (!body) return 0;
    return 0.5 * body.mass * (body.velocity.x * body.velocity.x + body.velocity.y * body.velocity.y)
      + (Number.isFinite(body.inertia) ? 0.5 * body.inertia * body.angularVelocity * body.angularVelocity : 0);
  }
  totalKineticEnergy() {
    let e = 0;
    for (const b of this._byId.values()) if (!b.isStatic) e += this.bodyKineticEnergy(b);
    return e;
  }
  bodyMomentum(body) {
    return body ? { x: body.mass * body.velocity.x, y: body.mass * body.velocity.y } : { x: 0, y: 0 };
  }
  totalMomentum() {
    let x = 0, y = 0;
    for (const b of this._byId.values()) {
      if (b.isStatic) continue;
      x += b.mass * b.velocity.x; y += b.mass * b.velocity.y;
    }
    return { x, y };
  }
  centerOfMass() {
    let m = 0, x = 0, y = 0;
    for (const b of this._byId.values()) {
      if (b.isStatic) continue;
      m += b.mass; x += b.position.x * b.mass; y += b.position.y * b.mass;
    }
    return m > 0 ? { x: x / m, y: y / m, mass: m } : { x: 0, y: 0, mass: 0 };
  }

  /* ------------------------------ dragging ----------------------------- */
  beginDrag(bodyOrId, wx, wy) {
    const b = this._bodyOf(bodyOrId);
    if (!b || b.isStatic) return false;
    this._drag = { body: b, x: num(wx, b.position.x), y: num(wy, b.position.y) };
    this._wake(b);
    return true;
  }
  moveDrag(wx, wy) {
    if (!this._drag) return;
    this._drag.x = num(wx, this._drag.x);
    this._drag.y = num(wy, this._drag.y);
  }
  endDrag() { this._drag = null; }
  get dragging() { return !!this._drag; }
  get dragBody() { return this._drag ? this._drag.body : null; }

  /* ------------------------------ queries ------------------------------ */
  _pointInBody(b, x, y) {
    if (b.circleRadius > 0) {
      const dx = x - b.position.x, dy = y - b.position.y;
      return dx * dx + dy * dy <= b.circleRadius * b.circleRadius;
    }
    if (x < b.bounds.min.x || x > b.bounds.max.x || y < b.bounds.min.y || y > b.bounds.max.y) return false;
    return pointInPoly(b.vertices, x, y);
  }
  pick(x, y) {
    const arr = [...this._byId.values()];
    for (let i = arr.length - 1; i >= 0; i--) {
      if (this._pointInBody(arr[i], x, y)) return arr[i];
    }
    return null;
  }
  queryRegion(x0, y0, x1, y1) {
    const out = [];
    for (const b of this._byId.values()) {
      if (b.bounds.max.x < x0 || b.bounds.min.x > x1 || b.bounds.max.y < y0 || b.bounds.min.y > y1) continue;
      out.push(b);
    }
    return out;
  }
  raycast(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return null;
    let best = null;
    for (const b of this._byId.values()) {
      // segment vs bounds first (cheap reject)
      if (b.bounds.max.x < Math.min(x0, x1) || b.bounds.min.x > Math.max(x0, x1)
        || b.bounds.max.y < Math.min(y0, y1) || b.bounds.min.y > Math.max(y0, y1)) continue;
      let tHit = null;
      if (b.circleRadius > 0) {
        const fx = x0 - b.position.x, fy = y0 - b.position.y;
        const a = dx * dx + dy * dy, bb = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - b.circleRadius * b.circleRadius;
        const disc = bb * bb - 4 * a * c;
        if (disc >= 0) {
          const t = (-bb - Math.sqrt(disc)) / (2 * a);
          if (t >= 0 && t <= 1) tHit = t;
        }
      } else {
        for (let i = 0; i < b.vertices.length; i++) {
          const p = b.vertices[i], q = b.vertices[(i + 1) % b.vertices.length];
          const ex = q.x - p.x, ey = q.y - p.y;
          const den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-12) continue;
          const t = ((p.x - x0) * ey - (p.y - y0) * ex) / den;
          const u = ((p.x - x0) * dy - (p.y - y0) * dx) / den;
          if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (tHit === null || t < tHit)) tHit = t;
        }
        if (tHit === null && this._pointInBody(b, x0, y0)) tHit = 0;
      }
      if (tHit !== null && (!best || tHit < best.t)) {
        best = { body: b, t: tHit, x: x0 + dx * tHit, y: y0 + dy * tHit, distance: tHit * len };
      }
    }
    return best;
  }
  applyRadialImpulse(cx, cy, opts = {}) {
    const radius = Math.max(1, num(opts.radius, 200));
    const base = num(opts.base, 0), power = num(opts.power, 10);
    const filter = typeof opts.filter === 'function' ? opts.filter : null;
    let hit = 0;
    for (const b of this._byId.values()) {
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

  /* ---------------------------- snapshot ------------------------------- */
  snapshot() {
    return {
      bodies: [...this._byId.values()].map((b) => this.describeBody(b)),
      constraints: this.describeConstraints(),
      hinges: this.describeHinges(),
      fluids: this.fluids(),
      winds: this.winds(),
      emitters: this.emitters(),
      gravity: { ...this.gravity },
      gravitation: this.gravitation,
      rng: { seed: this._seed, state: this._rngState },
      simMs: this._simMs,
    };
  }
  load(data = {}) {
    this.clear();
    let bodies = 0, constraints = 0, fluids = 0, winds = 0, hinges = 0;
    for (const d of data.bodies || []) { if (d && typeof d === 'object') { this.addBody(d); bodies++; } }
    for (const c of data.constraints || []) { if (c && typeof c === 'object' && this.addConstraint(c)) constraints++; }
    for (const h of data.hinges || []) { if (h && typeof h === 'object' && this.addHinge(h)) hinges++; }
    for (const f of data.fluids || []) { if (f && typeof f === 'object') { this.addFluid(f); fluids++; } }
    for (const w of data.winds || []) { if (w && typeof w === 'object') { this.addWind(w); winds++; } }
    let emitters = 0;
    for (const e of data.emitters || []) { if (e && typeof e === 'object') { this.addEmitter(e); emitters++; } }
    if (data.gravity) this.setGravity(data.gravity.x, data.gravity.y, true);
    if (data.gravitation) this.setGravitation(data.gravitation.G, data.gravitation);
    if (data.rng && Number.isFinite(data.rng.state)) {
      this._seed = num(data.rng.seed, this._seed) >>> 0;
      this._rngState = data.rng.state >>> 0;
    }
    if (Number.isFinite(data.simMs)) this._simMs = Math.max(0, data.simMs);
    this._emStepIdx = Math.round(this._simMs / this.fixedDt);
    // Id-sequence guard (1.12.8, twin of the Matter facade): never
    // reissue a loaded entry's id to a later auto-id add.
    const bump = (id) => { const m = /-(\d+)$/.exec(id || ''); if (m) this._seq = Math.max(this._seq, Number(m[1]) + 1); };
    for (const id of this._byId.keys()) bump(id);
    for (const id of this._cons.keys()) bump(id);
    for (const id of this._hinges.keys()) bump(id);
    for (const id of this._fluids.keys()) bump(id);
    for (const id of this._winds.keys()) bump(id);
    for (const id of this._emitters.keys()) bump(id);
    return { bodies, constraints, fluids, winds, hinges, emitters };
  }

  /* --------------------------- collision hook -------------------------- */
  onCollision(cb) {
    if (typeof cb === 'function') this._collisionCbs.push(cb);
    return () => {
      const i = this._collisionCbs.indexOf(cb);
      if (i >= 0) this._collisionCbs.splice(i, 1);
    };
  }
  setSubsteps(n) { this.substeps = Math.max(2, Math.min(8, Math.round(num(n, 2)))); }
  setMaxSpeed(v) { this._maxSpeed = Math.max(0, num(v, 0)); }
  get maxSpeed() { return this._maxSpeed; }

  /* ------------------------------ stepping ----------------------------- */
  advance(elapsedMs, speed = 1) {
    this._acc += Math.min(Math.max(num(elapsedMs, 0), 0), 250) * num(speed, 1);
    let steps = 0;
    while (this._acc >= this.fixedDt && steps < this.maxSteps) {
      this._stepOnce(1);
      this._acc -= this.fixedDt;
      steps++;
    }
    if (steps === this.maxSteps && this._acc >= this.fixedDt) this._acc = 0;
    return steps;
  }
  stepOnce() { this._stepOnce(1); }
  /** Compatibility helper: advance a single chunk of dt (sub-stepped). */
  step(dtMs, speed = 1) {
    const total = Math.min(num(dtMs, 0), 50) * num(speed, 1);
    const n = Math.max(1, Math.min(8, Math.ceil(total / this.fixedDt)));
    const scale = total / n / this.fixedDt;
    for (let i = 0; i < n; i++) this._stepOnce(scale);
  }

  _stepOnce(scale) {
    this._simMs += this.fixedDt * scale;
    if (this._gravitation || (this._magnetism.K > 0 && this._magnets.size)) this._applyPairForces(scale);
    if (this._hinges.size) this._applyMotors(scale);
    // Gravity kick (once per fixed step; see the header note).
    const g = this.gravity;
    if (g.x !== 0 || g.y !== 0) {
      for (const b of this._byId.values()) {
        if (b.isStatic || b.isSleeping) continue;
        b.velocity.x += g.x * GRAVITY_STEP * scale;
        b.velocity.y += g.y * GRAVITY_STEP * scale;
      }
    }
    if (this._fluids.size) this._applyFluids(scale);
    if (this._winds.size) this._applyWinds();
    const n = this.substeps;
    const h = scale / n;
    for (let i = 0; i < n; i++) this._integrateSolve(h, i === 0);
    // Orphan-sleeper probe (every 15 fixed steps): a sleeper whose
    // support was deleted or dragged away must fall, not hover.
    if (this.enableSleeping && Math.round(this._simMs / this.fixedDt) % 15 === 0) this._wakeOrphans();
    // Emitters (1.12.8, twin of the Matter facade): fire once per
    // crossed fixed-step index, at the end of the step.
    const eidx = Math.round(this._simMs / this.fixedDt);
    if (eidx !== this._emStepIdx) {
      this._emStepIdx = eidx;
      if (this._emitters.size) this._runEmitters(eidx);
    }
  }

  /** Wake sleeping bodies that have lost every support. Support means
   *  a touching chain (bounds grown 3 px) to a non-sleeping body, an
   *  attachment to a constraint/hinge, or an overlap with a fluid
   *  region. Without this, deleting the bottom box of a sleeping tower
   *  left the rest hovering in mid-air forever — gravity never applies
   *  to sleepers and nothing else re-checks them (user report, 1.44).
   *  Zero/disabled gravity opts out: floating is legitimate there. */
  _wakeOrphans() {
    const g = this.gravity;
    if (g.x === 0 && g.y === 0) return;
    const sleepers = [];
    for (const b of this._byId.values()) if (b.isSleeping && !b.isStatic) sleepers.push(b);
    if (!sleepers.length) return;
    const supported = new Set();
    for (const c of this._cons.values()) { if (c.bodyA) supported.add(c.bodyA); if (c.bodyB) supported.add(c.bodyB); }
    for (const hg of this._hinges.values()) { if (hg.bodyA) supported.add(hg.bodyA); if (hg.bodyB) supported.add(hg.bodyB); }
    const touch = (A, B) => A.min.x - 3 <= B.max.x && A.max.x + 3 >= B.min.x && A.min.y - 3 <= B.max.y && A.max.y + 3 >= B.min.y;
    const fluidBounds = [...this._fluids.values()].map((f) => ({
      min: { x: f.x - f.width / 2, y: f.y - f.height / 2 },
      max: { x: f.x + f.width / 2, y: f.y + f.height / 2 },
    }));
    // 1.12.5: uniform-grid candidate lookup, twin of the Matter facade's
    // probe — same touch predicate and support rules, no O(sleepers x
    // bodies) scans at high body counts.
    const CELL = 96;
    const cells = new Map();
    for (const b of this._byId.values()) {
      const bd = b.bounds;
      const x0 = Math.floor((bd.min.x - 3) / CELL), x1 = Math.floor((bd.max.x + 3) / CELL);
      const y0 = Math.floor((bd.min.y - 3) / CELL), y1 = Math.floor((bd.max.y + 3) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
        const key = cx * 100000 + cy;
        let cell = cells.get(key);
        if (!cell) cells.set(key, (cell = []));
        cell.push(b);
      }
    }
    const near = (bd, fn) => {
      const stamp = (this._probeSeq = (this._probeSeq || 0) + 1);
      const x0 = Math.floor((bd.min.x - 3) / CELL), x1 = Math.floor((bd.max.x + 3) / CELL);
      const y0 = Math.floor((bd.min.y - 3) / CELL), y1 = Math.floor((bd.max.y + 3) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
        const cell = cells.get(cx * 100000 + cy);
        if (!cell) continue;
        for (const o of cell) {
          if (o._peProbe === stamp) continue;
          o._peProbe = stamp;
          if (fn(o)) return true;
        }
      }
      return false;
    };
    const queue = [];
    for (const s of sleepers) {
      const id = s.plugin.pe.id;
      if (supported.has(id)) { queue.push(s); continue; }
      let ok = fluidBounds.some((fb) => touch(s.bounds, fb));
      if (!ok) ok = near(s.bounds, (o) => o !== s && !o.isSleeping && touch(s.bounds, o.bounds));
      if (ok) { supported.add(id); queue.push(s); }
    }
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i];
      near(cur.bounds, (o) => {
        if (o.isSleeping && !o.isStatic) {
          const id = o.plugin.pe.id;
          if (!supported.has(id) && touch(cur.bounds, o.bounds)) { supported.add(id); queue.push(o); }
        }
        return false;
      });
    }
    for (const s of sleepers) if (!supported.has(s.plugin.pe.id)) this._wake(s);
  }


  _applyPairForces(scale) {
    const arr = [...this._byId.values()];
    const n = arr.length;
    if (!n) return;
    const grav = this._gravitation;
    const mag = this._magnetism;
    const doMag = mag.K > 0 && this._magnets.size > 0;
    const magKick = doMag ? new Map() : null;
    for (let i = 0; i < n; i++) {
      const a = arr[i];
      for (let j = i + 1; j < n; j++) {
        const b = arr[j];
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const d2 = dx * dx + dy * dy;
        if (grav && !(a.isStatic && b.isStatic)) {
          const denom = Math.pow(d2 + grav.softening, 1.5);
          if (denom > 0) {
            const ma = a.isStatic ? a.area * Math.max(0, a.plugin.pe.desc.density) : a.mass;
            const mb = b.isStatic ? b.area * Math.max(0, b.plugin.pe.desc.density) : b.mass;
            const s = grav.G / denom;
            if (!a.isStatic && !a.isSleeping) { a.velocity.x += s * mb * dx * scale; a.velocity.y += s * mb * dy * scale; }
            if (!b.isStatic && !b.isSleeping) { b.velocity.x -= s * ma * dx * scale; b.velocity.y -= s * ma * dy * scale; }
          }
        }
        if (doMag && d2 <= mag.range * mag.range && d2 > 1e-9) {
          const sa = a.plugin.pe.desc.magnet, sb = b.plugin.pe.desc.magnet;
          const dist = Math.sqrt(d2);
          const ux = dx / dist, uy = dy / dist;
          const addKick = (body, kx, ky) => {
            if (body.isStatic || body.isSleeping) return;
            const cur = magKick.get(body) || { x: 0, y: 0 };
            cur.x += kx; cur.y += ky;
            magKick.set(body, cur);
          };
          if (sa !== 0 && sb !== 0) {
            const F = (mag.K * sa * sb) / (d2 + mag.softening);
            addKick(a, -ux * F * a.inverseMass * scale, -uy * F * a.inverseMass * scale);
            addKick(b, ux * F * b.inverseMass * scale, uy * F * b.inverseMass * scale);
          } else if (sa !== 0 || sb !== 0) {
            // A pole attracts an unmagnetised dynamic body ("iron",
            // effective strength 35, always attractive).
            const pole = sa !== 0 ? a : b;
            const iron = sa !== 0 ? b : a;
            if (!iron.isStatic) {
              const F = (mag.K * Math.abs(pole.plugin.pe.desc.magnet) * 35) / (d2 + mag.softening);
              const sgn = pole === a ? 1 : -1;
              addKick(iron, -sgn * ux * F * iron.inverseMass * scale, -sgn * uy * F * iron.inverseMass * scale);
              addKick(pole, sgn * ux * F * pole.inverseMass * scale, sgn * uy * F * pole.inverseMass * scale);
            }
          }
        }
      }
    }
    if (magKick) {
      for (const [b, k] of magKick) {
        const m = Math.hypot(k.x, k.y);
        const cap = 0.8 * scale;
        const s = m > cap && m > 0 ? cap / m : 1;
        b.velocity.x += k.x * s;
        b.velocity.y += k.y * s;
      }
    }
  }

  _applyMotors(scale) {
    for (const h of this._hinges.values()) {
      if (h.motorSpeed === 0) continue;
      const B = this._byId.get(h.bodyB);
      if (!B) continue;
      const A = h.bodyA ? this._byId.get(h.bodyA) : null;
      const invA = A && !A.isStatic ? A.inverseInertia : 0;
      const invB = B.isStatic ? 0 : B.inverseInertia;
      const sum = invA + invB;
      if (sum <= 0) continue;
      const rel = (B.isStatic ? 0 : B.angularVelocity) - (A && !A.isStatic ? A.angularVelocity : 0);
      let d = clamp(h.motorSpeed - rel, -h.motorPower, h.motorPower) * scale;
      if (A && !A.isStatic) { A.angularVelocity -= d * (invA / sum); this._wake(A); A.sleepCounter = 0; }
      if (!B.isStatic) { B.angularVelocity += d * (invB / sum); this._wake(B); B.sleepCounter = 0; }
    }
  }

  _applyFluids(scale) {
    const g = this.gravity;
    const hasG = g.x !== 0 || g.y !== 0;
    const arr = [...this._byId.values()];
    for (const f of this._fluids.values()) {
      const top = f.y - f.height / 2, bottom = f.y + f.height / 2;
      const left = f.x - f.width / 2, right = f.x + f.width / 2;
      let fx = f.vx, fy = f.vy;
      if (this._winds.size) {
        for (const w of this._winds.values()) {
          if (w.power <= 0) continue;
          const ox = Math.min(right, w.x + w.width / 2) - Math.max(left, w.x - w.width / 2);
          if (ox <= 0) continue;
          const oy = Math.min(bottom, w.y + w.height / 2) - Math.max(top, w.y - w.height / 2);
          if (oy <= 0) continue;
          const v = this._windVel(w);
          const k = 0.4 * w.power * (ox / f.width);
          fx += v.x * k; fy += v.y * k;
        }
      }
      this._fluidFlow.set(f.id, { x: fx, y: fy });
      for (const b of arr) {
        if (b.isStatic || b.isSleeping) continue;
        const bd = b.bounds;
        if (bd.max.x < left || bd.min.x > right || bd.max.y < top || bd.min.y > bottom) continue;
        const sub = this._submerged(b, left, top, right, bottom);
        if (!sub) continue;
        const frac = Math.min(1, sub.area / Math.max(1, b.area));
        if (frac <= 0) continue;
        if (hasG) {
          const ratio = b.density > 0 ? f.density / b.density : 0;
          const seal = this._undersideSeal(b, arr, left, right);
          let ax = -g.x * ratio * frac * (1 - seal) * GRAVITY_STEP;
          let ay = -g.y * ratio * frac * (1 - seal) * GRAVITY_STEP;
          if (seal > 0) {
            const bh = Math.max(1, bd.max.y - bd.min.y);
            const topDepth = clamp((bd.min.y - top) / bh, 0, 1);
            ax += g.x * ratio * seal * topDepth * GRAVITY_STEP;
            ay += g.y * ratio * seal * topDepth * GRAVITY_STEP;
          }
          const dvx = ax * scale, dvy = ay * scale;
          b.velocity.x += dvx;
          b.velocity.y += dvy;
          // Torque from the centre of buoyancy offset (self-righting).
          const rx = sub.x - b.position.x, ry = sub.y - b.position.y;
          b.angularVelocity += (rx * dvy - ry * dvx) * b.mass * b.inverseInertia;
        }
        if (f.drag > 0) {
          const keep = 1 - f.drag * frac;
          b.velocity.x = fx + (b.velocity.x - fx) * keep;
          b.velocity.y = fy + (b.velocity.y - fy) * keep;
          b.angularVelocity *= Math.max(0, 1 - f.drag * frac * 2.5);
        }
      }
    }
  }

  _submerged(b, left, top, right, bottom) {
    const bd = b.bounds;
    if (bd.min.x >= left && bd.max.x <= right && bd.min.y >= top && bd.max.y <= bottom) {
      return { x: b.position.x, y: b.position.y, area: b.area };
    }
    let poly;
    if (b.circleRadius > 0) {
      poly = [];
      const SEG = 20;
      for (let i = 0; i < SEG; i++) {
        const a = (i * 2 * Math.PI) / SEG;
        poly.push({ x: b.position.x + Math.cos(a) * b.circleRadius, y: b.position.y + Math.sin(a) * b.circleRadius });
      }
    } else {
      poly = b.vertices;
    }
    const clipped = clipRect(poly.map((p) => ({ x: p.x, y: p.y })), left, top, right, bottom);
    if (clipped.length < 3) return null;
    return clippedCentroid(clipped);
  }

  _undersideSeal(b, arr, left, right) {
    const bd = b.bounds;
    const x0 = Math.max(bd.min.x, left), x1 = Math.min(bd.max.x, right);
    if (x1 <= x0) return 0;
    const yTop = bd.max.y - 1, yBot = bd.max.y + 3;
    let candidates = null;
    for (const o of arr) {
      if (o === b) continue;
      const ob = o.bounds;
      if (ob.max.x < x0 || ob.min.x > x1 || ob.max.y < yTop || ob.min.y > yBot) continue;
      (candidates || (candidates = [])).push(o);
    }
    if (!candidates) return 0;
    const y = bd.max.y + 1.5;
    let blocked = 0;
    for (const t of [0.25, 0.5, 0.75]) {
      const x = x0 + (x1 - x0) * t;
      for (const o of candidates) {
        if (this._pointInBody(o, x, y)) { blocked++; break; }
      }
    }
    return blocked / 3;
  }

  _applyWinds() {
    const arr = [...this._byId.values()];
    for (const w of this._winds.values()) {
      if (w.power <= 0) continue;
      const v = this._windVel(w);
      const top = w.y - w.height / 2, bottom = w.y + w.height / 2;
      const left = w.x - w.width / 2, right = w.x + w.width / 2;
      for (const b of arr) {
        if (b.isStatic) continue;
        const bd = b.bounds;
        const ox = Math.min(bd.max.x, right) - Math.max(bd.min.x, left);
        const oy = Math.min(bd.max.y, bottom) - Math.max(bd.min.y, top);
        if (ox <= 0 || oy <= 0) continue;
        const area = Math.max(1, (bd.max.x - bd.min.x) * (bd.max.y - bd.min.y));
        const frac = Math.min(1, (ox * oy) / area);
        const densityRatio = 0.0012 / Math.max(0.0001, b.density);
        const rate = Math.min(0.5, 0.06 * w.power * frac * densityRatio);
        if (rate <= 0.001) continue;
        this._wake(b);
        b.velocity.x += (v.x - b.velocity.x) * rate;
        b.velocity.y += (v.y - b.velocity.y) * rate;
      }
    }
  }

  /* --------------------- integration & the solver ---------------------- */
  _pointVel(b, rx, ry, out) {
    out.x = b.velocity.x - b.angularVelocity * ry;
    out.y = b.velocity.y + b.angularVelocity * rx;
    return out;
  }
  _applyImpulse(b, ix, iy, rx, ry) {
    if (b.isStatic || b.isSleeping) return;
    b.velocity.x += ix * b.inverseMass;
    b.velocity.y += iy * b.inverseMass;
    b.angularVelocity += b.inverseInertia * (rx * iy - ry * ix);
    if (b.plugin.pe.desc.lockRotation) b.angularVelocity = 0;
  }
  _invM(b) { return b.isStatic || b.isSleeping ? 0 : b.inverseMass; }
  _invI(b) { return b.isStatic || b.isSleeping ? 0 : b.inverseInertia; }

  _integrateSolve(h, warmStart = true) {
    const dragBody = this._drag ? this._drag.body : null;
    // Drag servo: position-driven (the pointer wins over gravity).
    if (dragBody && !dragBody.isStatic && this._byId.get(dragBody.plugin.pe.id) === dragBody) {
      const dx = this._drag.x - dragBody.position.x;
      const dy = this._drag.y - dragBody.position.y;
      let vx = (dx * 0.5) / h, vy = (dy * 0.5) / h;
      const sp = Math.hypot(vx, vy);
      if (sp > 60) { vx = (vx / sp) * 60; vy = (vy / sp) * 60; }
      dragBody.velocity.x = vx;
      dragBody.velocity.y = vy;
      dragBody.angularVelocity *= 0.8;
      this._wake(dragBody);
      dragBody.sleepCounter = 0;
    }
    for (const b of this._byId.values()) {
      if (b.isStatic || b.isSleeping) continue;
      if (b !== dragBody) {
        const f = Math.max(0, 1 - b.frictionAir * h);
        b.velocity.x *= f;
        b.velocity.y *= f;
      }
      if (b.plugin.pe.desc.lockRotation) b.angularVelocity = 0;
      if (this._maxSpeed > 0) {
        const spSq = b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y;
        if (spSq > this._maxSpeed * this._maxSpeed) {
          const s = this._maxSpeed / Math.sqrt(spSq);
          b.velocity.x *= s; b.velocity.y *= s;
        }
      }
      b._prevX = b.position.x;
      b._prevY = b.position.y;
      b.position.x += b.velocity.x * h;
      b.position.y += b.velocity.y * h;
      b.angle += b.angularVelocity * h;
      this._syncShape(b);
    }
    // 1.12.11: pre-wake — a sleeper that last substep's contacts say is
    // still being pressed by a moving body wakes NOW, before _collide
    // bakes its zero inverse mass into this substep's contacts. A
    // contact created against a sleeping body carries the immovable-
    // body effective mass (measured imN 8.49 vs the true ~1.66); when
    // the exact wake pass below then wakes the body mid-substep, the
    // solve pumps energy (impulses ±98, vn flipping -8/+48.6 within
    // one substep) and a pressed stack detonates chain-by-chain as
    // each newly disturbed box wakes the next with a frozen contact
    // (Ryan's pyramid video: boxes leaving at 50-266 px/step, one
    // reaching the stage top). First-touch contacts have no previous
    // contact and keep the historical one-substep frozen solve —
    // that frozen step is also what hands a Newton's-cradle chain
    // its clean equal-mass transfer, so it is deliberately kept.
    if (this._prevContacts && this.enableSleeping) {
      const pv = { x: 0, y: 0 };
      for (const c of this._prevContacts) {
        if (c.a.isSleeping === c.b.isSleeping) continue;
        const sleeper = c.a.isSleeping ? c.a : c.b;
        const other = c.a.isSleeping ? c.b : c.a;
        if (other.isStatic) continue;
        this._pointVel(other, c.px - other.position.x, c.py - other.position.y, pv);
        if (Math.hypot(pv.x, pv.y) > 0.6) this._wake(sleeper);
      }
    }
    const contacts = this._collide();
    // 1.12.10: snapshot each contact's approach velocity NOW — after
    // integration, before warm starting pre-applies last step's
    // impulses. Restitution answers this sample (see _solveContact):
    // the collide-time capture (1.12.9) starved touching chains,
    // because a chain's downstream contacts are created before the
    // impact has travelled into them; the post-warm-start live vn
    // (pre-1.12.9) is what launched wedged pins. This sample point
    // sits between those two failure modes.
    for (const c of contacts) {
      this._pointVel(c.a, c.rax, c.ray, _scratchVa);
      this._pointVel(c.b, c.rbx, c.rby, _scratchVb);
      c.preVn = (_scratchVb.x - _scratchVa.x) * c.nx + (_scratchVb.y - _scratchVa.y) * c.ny;
    }
    // Warm starting: seed each contact with the impulses its feature
    // point accumulated last step and pre-apply them — resting stacks
    // start each step already held up instead of re-solving from zero
    // (the cure for resting-stack jitter). FIRST substep only: the
    // pre-applied impulse stays in the velocities, so re-applying it on
    // later substeps double-counts it — an energy leak that scaled
    // with the substep count (resting piles sustained a creep limit
    // cycle; on the 796-body stress scene it also launched a body at
    // ~65 px/step in the first seconds). Later substeps continue from
    // the carried velocity with a fresh delta solve.
    const cacheSeen = new Set();
    for (const c of contacts) {
      // 1.12.5: numeric warm-start key (was a template string per contact
      // per substep). Quantised point folded in with fixed strides; the
      // key only steers warm-start matching, so range spill is harmless.
      const key = ((c._oa * 8192 + c._ob) * 4096 + (Math.round(c.px / 8) + 2048)) * 4096 + (Math.round(c.py / 8) + 2048);
      c._cacheKey = key;
      cacheSeen.add(key);
      const warm = warmStart ? this._contactCache.get(key) : null;
      if (warm) {
        c.accN = warm.n; c.accT = warm.t;
        this._applyImpulse(c.a, -c.accN * c.nx + c.accT * c.ny, -c.accN * c.ny - c.accT * c.nx, c.rax, c.ray);
        this._applyImpulse(c.b, c.accN * c.nx - c.accT * c.ny, c.accN * c.ny + c.accT * c.nx, c.rbx, c.rby);
      }
    }
    // Wake on meaningful impact.
    const tmp = { x: 0, y: 0 };
    for (const c of contacts) {
      if (c.a.isSleeping === c.b.isSleeping) continue;
      const sleeper = c.a.isSleeping ? c.a : c.b;
      const other = c.a.isSleeping ? c.b : c.a;
      if (other.isStatic) continue;
      this._pointVel(other, c.px - other.position.x, c.py - other.position.y, tmp);
      if (Math.hypot(tmp.x, tmp.y) > 0.6) { this._wake(sleeper); }
    }
    const ITER = 30;
    for (let it = 0; it < ITER; it++) {
      // 1.12.10: symmetric Gauss-Seidel — alternate the contact order
      // every iteration. One-directional sweeps systematically favour
      // the contacts solved last, and in a touching chain (Newton's
      // cradle) that bias pumps the middle bodies a little more every
      // exchange until the row falls apart; alternating the sweep
      // direction cancels the bias. Measured on the cradle preset
      // (middle-body worst deviation, 600 steps): 184 -> 31 combined
      // with the iteration raise below; flat ~45 out to 3600 steps.
      if (it % 2 === 0) { for (const c of contacts) this._solveContact(c, h, it === 0); }
      else { for (let ci = contacts.length - 1; ci >= 0; ci--) this._solveContact(contacts[ci], h, false); }
      for (const c of this._cons.values()) this._solveConstraint(c);
      for (const hg of this._hinges.values()) this._solveHinge(hg);
    }
    // Linear position correction — only for genuinely deep residual
    // penetration; the velocity bias handles the shallow rest (running
    // both at full strength makes resting contacts oscillate).
    for (const c of contacts) {
      const ima = this._invM(c.a), imb = this._invM(c.b);
      const sum = ima + imb;
      if (sum <= 0) continue;
      const corr = (Math.max(c.pen - 0.6, 0) * 0.6) / sum;
      if (corr <= 0) continue;
      if (!c.a.isStatic && !c.a.isSleeping) { c.a.position.x -= c.nx * corr * ima; c.a.position.y -= c.ny * corr * ima; }
      if (!c.b.isStatic && !c.b.isSleeping) { c.b.position.x += c.nx * corr * imb; c.b.position.y += c.ny * corr * imb; }
    }
    if (this._contactCache) {
      for (const c of contacts) this._contactCache.set(c._cacheKey, { n: c.accN, t: c.accT });
      for (const key of this._contactCache.keys()) if (!cacheSeen.has(key)) this._contactCache.delete(key);
    }
    // 1.12.11: last substep's contacts drive the pre-wake pass at the
    // top of the next _integrateSolve (see below).
    this._prevContacts = contacts;
    for (const b of this._byId.values()) {
      // 1.12.5: sleeping bodies cannot have moved during this substep
      // (integration, impulses and position correction all skip them,
      // and host-side moves call _syncShape themselves) — skip them.
      if (!b.isStatic && !b.isSleeping) this._syncShape(b);
    }
    // Sleeping bookkeeping — Matter-style SMOOTHED motion: the metric is
    // an exponentially decaying max of v² + ω², so a single solver nudge
    // in a pile cannot reset the fuse (the pre-1.43 rule — instantaneous
    // speed < 0.3, |ω| < 0.03, contact this very step — flickered around
    // its thresholds in dense piles: on the 796-body stress scene only
    // 72/705 dynamics slept after 15 s vs Matter's 256). Support is
    // remembered for 45 steps so a body resting between contacts still
    // counts as supported, while a tossed body (no recent contact, and
    // its launch motion still unwound in the smoothed metric) cannot
    // fall asleep mid-flight.
    if (this.enableSleeping) {
      // 1.12.5: support is marked with a per-substep stamp on the bodies
      // themselves (was: a fresh Set with ~2 entries per contact, rebuilt
      // every substep), and motor-driven bodies are resolved once per
      // substep instead of scanning every hinge for every body.
      const stamp = (this._supportStamp = (this._supportStamp || 0) + 1);
      for (const c of contacts) { c.a._supportStamp = stamp; c.b._supportStamp = stamp; }
      let drivenSet = null;
      if (this._hinges.size) {
        for (const hg of this._hinges.values()) {
          if (hg.motorSpeed === 0) continue;
          if (hg.bodyA) { const A = this._byId.get(hg.bodyA); if (A) (drivenSet || (drivenSet = new Set())).add(A); }
          if (hg.bodyB) { const B = this._byId.get(hg.bodyB); if (B) (drivenSet || (drivenSet = new Set())).add(B); }
        }
      }
      for (const b of this._byId.values()) {
        if (b.isStatic) continue;
        if (b._supportStamp === stamp) b._supportAge = 0; else b._supportAge = (b._supportAge ?? 9999) + 1;
        if (b.isSleeping) continue;
        const inst = b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y
          + b.angularVelocity * b.angularVelocity;
        b._motion = Math.max(inst, (b._motion || 0) * 0.9);
        const driven = b === dragBody || (drivenSet !== null && drivenSet.has(b));
        const slow = b._motion < 0.1 && b._supportAge <= 45;
        // noSleep (1.12.7): flagged bodies (dominoes) never enter sleep.
        if (!driven && slow && !(b.plugin && b.plugin.pe && b.plugin.pe.desc.noSleep)) {
          b.sleepCounter++;
          if (b.sleepCounter >= 30) {
            b.isSleeping = true;
            b.velocity.x = 0; b.velocity.y = 0; b.angularVelocity = 0;
            b._motion = 0;
          }
        } else b.sleepCounter = 0;
      }
    }
    // Collision-start events.
    if (this._collisionCbs.length) {
      const now = new Set();
      for (const c of contacts) {
        const key = c.a.plugin.pe.id < c.b.plugin.pe.id
          ? `${c.a.plugin.pe.id}|${c.b.plugin.pe.id}` : `${c.b.plugin.pe.id}|${c.a.plugin.pe.id}`;
        now.add(key);
        if (!this._activePairs.has(key)) {
          for (const cb of this._collisionCbs) cb(c.a, c.b, { bodyA: c.a, bodyB: c.b });
        }
      }
      this._activePairs = now;
    }
  }

  _isMotorDriven(b) {
    const id = b.plugin.pe.id;
    for (const h of this._hinges.values()) {
      if (h.motorSpeed !== 0 && (h.bodyA === id || h.bodyB === id)) return true;
    }
    return false;
  }

  _solveContact(c, h, first) {
    const ima = this._invM(c.a), imb = this._invM(c.b);
    if (ima + imb <= 0) return;
    const va = _scratchVa, vb = _scratchVb;
    this._pointVel(c.a, c.rax, c.ray, va);
    this._pointVel(c.b, c.rbx, c.rby, vb);
    const vn = (vb.x - va.x) * c.nx + (vb.y - va.y) * c.ny;
    if (first) {
      // 1.12.9: restitution from a captured approach velocity, NOT
      // from the live vn — by the
      // first iteration, warm-start pre-application and the wedge
      // geometry of a stack can inflate the contact-point velocity
      // far beyond anything physical (measured vn = -61 on a pin
      // the ball reached at 2.4 px/step), and -e*vn then LAUNCHES
      // the light body (peak pin speed 19.6 px/step, ~4x the
      // momentum ceiling). The Baumgarte penetration term is capped
      // for the same reason: a deep one-step overlap (pen ~16)
      // otherwise demands a separating velocity of 12+; the linear
      // position correction below resolves deep overlap over a few
      // steps instead. Honest fast impacts keep their full bounce:
      // a restitution-0.8 drop still rebounds to e^2 * h.
      const ap = (c.preVn !== undefined ? c.preVn : c.restVn);
      const rest = ap < -1 ? -c.e * ap : 0;
      c.biasVel = rest + Math.min((0.2 * Math.max(0, c.pen - 0.01)) / Math.max(h, 0.05), 4);
    }
    // 1.12.12: a contact created against a sleeping body carries the
    // immovable-body effective mass. For gentle touches that frozen
    // solve is a feature — it hands a touching chain (Newton's
    // cradle) a clean equal-mass transfer, and sleeping is what
    // keeps the middle balls from drifting (cradle drift 45 with
    // sleep vs 235 without). But a FAST first touch turns it into
    // an amplifier: the impulse is sized to stop the striker
    // against a wall, then delivered to the woken body at its real
    // mass — a wrecking ball arriving at 34 px/step produced box
    // speeds 58 -> 132 -> 210 up the pyramid rows. The solver
    // knows the approach speed (preVn) and the sleep states at
    // creation, so a violent wake-touch is re-based on the honest
    // (live) effective mass for this substep; gentle ones keep
    // the frozen transfer.
    if (first && c.wakeTouch && c.preVn !== undefined && c.preVn < -12) {
      const kia = this._invI(c.a), kib = this._invI(c.b);
      const gRaCn = c.rax * c.ny - c.ray * c.nx, gRbCn = c.rbx * c.ny - c.rby * c.nx;
      const gKn = ima + imb + kia * gRaCn * gRaCn + kib * gRbCn * gRbCn;
      const gTx = -c.ny, gTy = c.nx;
      const gRaCt = c.rax * gTy - c.ray * gTx, gRbCt = c.rbx * gTy - c.rby * gTx;
      const gKt = ima + imb + kia * gRaCt * gRaCt + kib * gRbCt * gRbCt;
      c.imN = gKn > 0 ? 1 / gKn : 0;
      c.imT = gKt > 0 ? 1 / gKt : 0;
    }
    let lambda = (c.biasVel - vn) * c.imN;
    const newAcc = Math.max(0, c.accN + lambda);
    lambda = newAcc - c.accN;
    c.accN = newAcc;
    this._applyImpulse(c.a, -lambda * c.nx, -lambda * c.ny, c.rax, c.ray);
    this._applyImpulse(c.b, lambda * c.nx, lambda * c.ny, c.rbx, c.rby);
    // Friction (Coulomb, clamped by the accumulated normal impulse).
    this._pointVel(c.a, c.rax, c.ray, va);
    this._pointVel(c.b, c.rbx, c.rby, vb);
    const tx = -c.ny, ty = c.nx;
    const vt = (vb.x - va.x) * tx + (vb.y - va.y) * ty;
    let lt = -vt * c.imT;
    const maxF = c.mu * c.accN;
    const newAccT = clamp(c.accT + lt, -maxF, maxF);
    lt = newAccT - c.accT;
    c.accT = newAccT;
    this._applyImpulse(c.a, -lt * tx, -lt * ty, c.rax, c.ray);
    this._applyImpulse(c.b, lt * tx, lt * ty, c.rbx, c.rby);
  }

  _solveConstraint(c) {
    const B = this._byId.get(c.bodyB);
    if (!B) return;
    const A = c.bodyA ? this._byId.get(c.bodyA) : null;
    const pa = this._anchorWorld(c, 'A'), pb = this._anchorWorld(c, 'B');
    const dx = pb.x - pa.x, dy = pb.y - pa.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-9) return;
    const nx = dx / dist, ny = dy / dist;
    const C = dist - c.length;
    const rax = A ? pa.x - A.position.x : 0, ray = A ? pa.y - A.position.y : 0;
    const rbx = pb.x - B.position.x, rby = pb.y - B.position.y;
    const ima = A ? this._invM(A) : 0, imb = this._invM(B);
    const iia = A ? this._invI(A) : 0, iib = this._invI(B);
    const raCn = rax * ny - ray * nx, rbCn = rbx * ny - rby * nx;
    const kEff = ima + imb + iia * raCn * raCn + iib * rbCn * rbCn;
    if (kEff <= 0) return;
    const va = { x: 0, y: 0 }, vb = { x: 0, y: 0 };
    if (A) this._pointVel(A, rax, ray, va);
    this._pointVel(B, rbx, rby, vb);
    const vn = (vb.x - va.x) * nx + (vb.y - va.y) * ny;
    const stiff = c.stiffness >= 0.99 ? 1 : c.stiffness;
    const target = -0.2 * C;
    const lambda = ((target - vn) - vn * c.damping * 0.2) * (1 / kEff) * stiff;
    if (A) this._applyImpulse(A, -lambda * nx, -lambda * ny, rax, ray);
    this._applyImpulse(B, lambda * nx, lambda * ny, rbx, rby);
  }

  _solveHinge(hg) {
    const B = this._byId.get(hg.bodyB);
    if (!B) return;
    const A = hg.bodyA ? this._byId.get(hg.bodyA) : null;
    const pa = this._anchorWorld(hg, 'A'), pb = this._anchorWorld(hg, 'B');
    const Cx = pb.x - pa.x, Cy = pb.y - pa.y;
    const rax = A ? pa.x - A.position.x : 0, ray = A ? pa.y - A.position.y : 0;
    const rbx = pb.x - B.position.x, rby = pb.y - B.position.y;
    const ima = A ? this._invM(A) : 0, imb = this._invM(B);
    const iia = A ? this._invI(A) : 0, iib = this._invI(B);
    let kxx = ima + imb, kyy = ima + imb, kxy = 0;
    if (A) { kxx += iia * ray * ray; kyy += iia * rax * rax; kxy += -iia * rax * ray; }
    kxx += iib * rby * rby; kyy += iib * rbx * rbx; kxy += -iib * rbx * rby;
    const det = kxx * kyy - kxy * kxy;
    if (Math.abs(det) < 1e-12) return;
    const va = { x: 0, y: 0 }, vb = { x: 0, y: 0 };
    if (A) this._pointVel(A, rax, ray, va);
    this._pointVel(B, rbx, rby, vb);
    const bx = -0.2 * Cx - (vb.x - va.x);
    const by = -0.2 * Cy - (vb.y - va.y);
    const lx = (bx * kyy - by * kxy) / det;
    const ly = (kxx * by - kxy * bx) / det;
    if (A) this._applyImpulse(A, -lx, -ly, rax, ray);
    this._applyImpulse(B, lx, ly, rbx, rby);
  }

  /* --------------------------- narrowphase ----------------------------- */
  _collide() {
    const arr = [...this._byId.values()];
    const CELL = 128;
    const grid = new Map();
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i], bd = b.bounds;
      const x0 = Math.floor(bd.min.x / CELL), x1 = Math.floor(bd.max.x / CELL);
      const y0 = Math.floor(bd.min.y / CELL), y1 = Math.floor(bd.max.y / CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const key = cx * 100000 + cy;
          let cell = grid.get(key);
          if (!cell) grid.set(key, (cell = []));
          cell.push(i);
        }
      }
    }
    const seen = new Set();
    const contacts = [];
    for (const cell of grid.values()) {
      for (let i = 0; i < cell.length; i++) {
        for (let j = i + 1; j < cell.length; j++) {
          const ia = cell[i], ib = cell[j];
          const key = ia < ib ? ia * 1000000 + ib : ib * 1000000 + ia;
          if (seen.has(key)) continue;
          seen.add(key);
          const a = arr[ia], b = arr[ib];
          if (a.isStatic && b.isStatic) continue;
          if (a.isSleeping && b.isSleeping) continue;
          if (this._sameCluster(a.plugin.pe.id, b.plugin.pe.id)) continue;
          const ab = a.bounds, bb = b.bounds;
          if (ab.max.x < bb.min.x || ab.min.x > bb.max.x || ab.max.y < bb.min.y || ab.min.y > bb.max.y) continue;
          const found = this._narrow(a, b);
          for (const f of found) {
            const rax = f.px - a.position.x, ray = f.py - a.position.y;
            const rbx = f.px - b.position.x, rby = f.py - b.position.y;
            const ima = this._invM(a), imb = this._invM(b);
            const iia = this._invI(a), iib = this._invI(b);
            const raCn = rax * f.ny - ray * f.nx, rbCn = rbx * f.ny - rby * f.nx;
            const kn = ima + imb + iia * raCn * raCn + iib * rbCn * rbCn;
            const tx = -f.ny, ty = f.nx;
            const raCt = rax * ty - ray * tx, rbCt = rbx * ty - rby * tx;
            const kt = ima + imb + iia * raCt * raCt + iib * rbCt * rbCt;
            contacts.push({
              _oa: a._ord, _ob: b._ord,
              a, b, nx: f.nx, ny: f.ny, pen: f.pen, px: f.px, py: f.py,
              rax, ray, rbx, rby,
              imN: kn > 0 ? 1 / kn : 0, imT: kt > 0 ? 1 / kt : 0,
              mu: Math.sqrt(Math.max(0, a.friction) * Math.max(0, b.friction)),
              e: Math.max(a.restitution, b.restitution),
              // 1.12.9: capture the approach velocity NOW, at contact
              // creation — before warm starting pre-applies last step's
              // impulses and before any solver iteration mutates the
              // velocities. Restitution must answer the velocity the
              // bodies actually arrived with.
              restVn: (b.velocity.x - b.angularVelocity * rby - (a.velocity.x - a.angularVelocity * ray)) * f.nx
                    + (b.velocity.y + b.angularVelocity * rbx - (a.velocity.y + a.angularVelocity * rax)) * f.ny,
              biasVel: 0, accN: 0, accT: 0,
              wakeTouch: a.isSleeping !== b.isSleeping,
            });
          }
        }
      }
    }
    // Deterministic solve order (pair, then point): sequential impulses
    // are order-sensitive, and a stable order keeps micro-asymmetries
    // from random-walking resting stacks apart.
    // 1.12.5: numeric insertion-order keys instead of template-string
    // keys built per comparison (the string sort measured ~18% of step
    // time at ~800 bodies). Same deterministic contract: pair order,
    // then contact point.
    contacts.sort((c1, c2) => (c1._oa - c2._oa) || (c1._ob - c2._ob) || (c1.px - c2.px) || (c1.py - c2.py));
    return contacts;
  }

  _narrow(a, b) {
    const aCirc = a.circleRadius > 0, bCirc = b.circleRadius > 0;
    if (aCirc && bCirc) {
      const dx = b.position.x - a.position.x, dy = b.position.y - a.position.y;
      const rSum = a.circleRadius + b.circleRadius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rSum * rSum) return [];
      const d = Math.sqrt(d2) || 1e-9;
      const nx = dx / d, ny = dy / d;
      return [{ nx, ny, pen: rSum - d, px: a.position.x + nx * (a.circleRadius - (rSum - d) / 2), py: a.position.y + ny * (a.circleRadius - (rSum - d) / 2) }];
    }
    if (aCirc && !bCirc) {
      const c = this._circlePoly(a, b);
      if (!c) return [];
      return [{ nx: -c.nx, ny: -c.ny, pen: c.pen, px: c.px, py: c.py }];
    }
    if (!aCirc && bCirc) {
      const c = this._circlePoly(b, a);
      if (!c) return [];
      return [c];
    }
    return this._polyPoly(a, b);
  }

  /** Contact of a circle against a polygon; the returned normal points
   *  from the POLYGON toward the CIRCLE. */
  _circlePoly(circle, poly) {
    const C = circle.position, r = circle.circleRadius;
    const verts = poly.vertices;
    let bestD2 = Infinity, bestPt = null;
    for (let i = 0; i < verts.length; i++) {
      const p = verts[i], q = verts[(i + 1) % verts.length];
      const ex = q.x - p.x, ey = q.y - p.y;
      const len2 = ex * ex + ey * ey || 1e-12;
      let t = ((C.x - p.x) * ex + (C.y - p.y) * ey) / len2;
      t = clamp(t, 0, 1);
      const px = p.x + ex * t, py = p.y + ey * t;
      const dx = C.x - px, dy = C.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; bestPt = { x: px, y: py, edge: i }; }
    }
    const inside = pointInPoly(verts, C.x, C.y);
    if (!inside) {
      const d = Math.sqrt(bestD2);
      if (d > r) return null;
      if (d < 1e-9) return null;
      return { nx: (C.x - bestPt.x) / d, ny: (C.y - bestPt.y) / d, pen: r - d, px: bestPt.x, py: bestPt.y };
    }
    // Centre inside: exit through the face the circle CAME from (the
    // edge its previous centre was closest to leaving) — choosing the
    // geometrically nearest edge instead would expel a fast circle
    // through the far side of a thin body once its centre crosses the
    // mid-plane (tunnelling through floors).
    const px = Number.isFinite(circle._prevX) ? circle._prevX : C.x;
    const py = Number.isFinite(circle._prevY) ? circle._prevY : C.y;
    let exit = null;
    for (let i = 0; i < verts.length; i++) {
      const p = verts[i], q = verts[(i + 1) % verts.length];
      const ex = q.x - p.x, ey = q.y - p.y;
      const elen = Math.hypot(ex, ey) || 1e-9;
      let nx = ey / elen, ny = -ex / elen;
      const mx = (p.x + q.x) / 2 - poly.position.x, my = (p.y + q.y) / 2 - poly.position.y;
      if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
      const sPrev = (px - p.x) * nx + (py - p.y) * ny;
      const sCur = (C.x - p.x) * nx + (C.y - p.y) * ny;
      if (!exit || sPrev > exit.sPrev) exit = { nx, ny, sPrev, sCur, edge: i };
    }
    return { nx: exit.nx, ny: exit.ny, pen: r - exit.sCur, px: bestPt.x, py: bestPt.y };
  }

  /** SAT with reference-face clipping (Box2D-lite style): up to two
   *  contact points, normals pointing from a to b. */
  _polyPoly(a, b) {
    const sepA = this._maxSeparation(a, b);
    if (sepA.sep > 0) return [];
    const sepB = this._maxSeparation(b, a);
    if (sepB.sep > 0) return [];
    let ref, other, refSep;
    if (sepB.sep > sepA.sep + 1e-6) { ref = b; other = a; refSep = sepB; }
    else { ref = a; other = b; refSep = sepA; }
    const nx0 = refSep.nx, ny0 = refSep.ny; // outward from ref, toward other
    const rv0 = ref.vertices[refSep.edge], rv1 = ref.vertices[(refSep.edge + 1) % ref.vertices.length];
    // Incident edge: the other body's edge most anti-parallel to n.
    let incI = 0, incDot = Infinity;
    for (let i = 0; i < other.vertices.length; i++) {
      const p = other.vertices[i], q = other.vertices[(i + 1) % other.vertices.length];
      const n = this._edgeOutward(other, i);
      const d = n.x * nx0 + n.y * ny0;
      if (d < incDot) { incDot = d; incI = i; }
      void p; void q;
    }
    let pts = [
      { ...other.vertices[incI] },
      { ...other.vertices[(incI + 1) % other.vertices.length] },
    ];
    // Clip the incident segment to the reference face's side planes.
    let tx = rv1.x - rv0.x, ty = rv1.y - rv0.y;
    const tl = Math.hypot(tx, ty) || 1e-9;
    tx /= tl; ty /= tl;
    pts = this._clipSegment(pts, tx, ty, rv0.x * tx + rv0.y * ty, 1);
    pts = this._clipSegment(pts, tx, ty, rv1.x * tx + rv1.y * ty, -1);
    const out = [];
    for (const p of pts) {
      const depth = -((p.x - rv0.x) * nx0 + (p.y - rv0.y) * ny0);
      if (depth >= 0) {
        const flip = ref === b;
        out.push({ nx: flip ? -nx0 : nx0, ny: flip ? -ny0 : ny0, pen: depth, px: p.x, py: p.y });
      }
    }
    return out;
  }

  _clipSegment(pts, tx, ty, plane, side) {
    // Sutherland–Hodgman over an open polyline of 0/1/2 points. The
    // earlier version indexed pts[1] unconditionally and used a strict
    // sign-product crossing test: an incident vertex landing EXACTLY on
    // a side plane (routine with axis-aligned piles) produced a 1-point
    // result and the second clip crashed reading pts[1].x — the 796-body
    // stress scene hit this within seconds; small scenes never did.
    const out = [];
    if (!pts.length) return out;
    const dist = (p) => (p.x * tx + p.y * ty - plane) * side;
    let prev = pts[0], prevD = dist(prev);
    if (prevD >= 0) out.push(prev);
    for (let i = 1; i < pts.length; i++) {
      const cur = pts[i], curD = dist(cur);
      if (prevD * curD < 0) {
        const t = prevD / (prevD - curD);
        out.push({ x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t });
      }
      if (curD >= 0) out.push(cur);
      prev = cur; prevD = curD;
    }
    return out;
  }

  _edgeOutward(poly, i) {
    const p = poly.vertices[i], q = poly.vertices[(i + 1) % poly.vertices.length];
    const ex = q.x - p.x, ey = q.y - p.y;
    const l = Math.hypot(ex, ey) || 1e-9;
    let nx = ey / l, ny = -ex / l;
    const mx = (p.x + q.x) / 2 - poly.position.x, my = (p.y + q.y) / 2 - poly.position.y;
    if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
    return { x: nx, y: ny };
  }

  /** Largest separation of `other` along any of ref's edge normals. */
  _maxSeparation(ref, other) {
    let best = { sep: -Infinity, edge: 0, nx: 0, ny: 0 };
    for (let i = 0; i < ref.vertices.length; i++) {
      const n = this._edgeOutward(ref, i);
      const rp = ref.vertices[i];
      let minD = Infinity;
      for (const v of other.vertices) {
        const d = (v.x - rp.x) * n.x + (v.y - rp.y) * n.y;
        if (d < minD) minD = d;
      }
      if (minD > best.sep) best = { sep: minD, edge: i, nx: n.x, ny: n.y };
    }
    return best;
  }
}
