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

   Version: 1.12.5 (exported as VERSION / PhysicsEngine.VERSION)
     1.0.0 — extracted from MotionLab as a project-agnostic core
     1.1.0 — substeps anti-tunnelling (setSubsteps)
     1.2.0 — spatial queries (queryRegion / raycast), impulse helpers
             (addVelocity / applyRadialImpulse), allocation-free pick()
     1.3.0 — seeded RNG (seed option, random / randomRange / randomInt /
             choice / shuffle, setSeed; RNG state rides along in snapshots)
     1.4.0 — named bodies (name / renameBody / getBodyByName), pairwise
             gravitation, fluid regions (buoyancy + drag), a Formulas
             library of pure physics helpers, and stability hardening
             (descriptor validation, non-finite setter guards, maxSpeed)
     1.5.0 — magnetism (descriptor `magnet`: signed pole strength; poles
             attract/repel each other and pull unmagnetised "iron" bodies,
             range-limited, momentum-conserving), wind regions (addWind —
             a target-velocity field, the gaseous sibling of fluids), and
             a faster pairwise-force pass (positions/masses hoisted into
             typed arrays once per step, one unified pass for gravitation
             + magnetism, uniform-grid range culling for magnet pairs)
     1.5.1 — magnetism fix: a pole pair involving a static magnet is no
             longer skipped when the dynamic pole was added first (the
             pair-dedup now only applies when the earlier pass can run)
     1.6.0 — performance pass, no behaviour change: the pairwise-force
             pass reuses grow-only typed buffers, a cached body->index
             map and magnet list, and a numeric-keyed pooled grid
             (zero allocation per fixed step); gravitation is split into
             a symmetric dynamic–dynamic loop plus a one-way
             dynamic–static loop, so static–static pairs are never
             evaluated (static-heavy worlds: pair pass ~40% faster);
             fluids skip sleeping bodies (Matter discards their forces
             anyway) and reuse a scratch force vector;
             constraintSegments pools its segment records;
             new allocation-free forEachFluid / forEachWind iterators
     1.7.0 — machinery: revolute hinges (addHinge — pin two bodies, or a
             body to a fixed mount, at a shared point) with optional
             motors (target relative angular velocity in rad/step,
             acceleration-capped, reaction split by inverse inertia);
             hinges ride snapshots/load, are cleaned up with their
             bodies, and expose hingeAnchors() for rendering/picking
     1.7.1 — solver: default constraintIterations raised 2 -> 4 (option
             `constraintIterations` overrides). Simultaneous rigid
             constraints (hinge clusters, triangulated crosses) left
             multi-pixel anchor errors at 2 iterations (measured on a
             ferris wheel: hub drift 28px, cross error 5.6°); at 4 the
             same machine holds its hub exactly and its cross angle
     1.12.0 — the self-developed Native backend lands (MotionLab 1.41):
             BACKENDS' native entry moves from planned to experimental
             and PhysicsEngine.create({ backend: 'native' }) now
             constructs it (a from-scratch impulse solver in
             native-engine.js — no physics library inside — honouring
             this API's full surface: bodies, constraints, hinges with
             motors, fluids, winds, magnetism, gravitation, sleeping,
             snapshots, queries, seeded RNG). Matter stays the default
             and the reference behaviour; native is opt-in and labelled
             experimental while its feel is validated on real scenes.
    1.12.5 — performance pass (MotionLab 1.51), no behaviour change:
             the orphan-sleeper probe (both backends) finds candidate
             pairs through a uniform grid instead of O(sleepers x bodies)
             scans — it measured ~31% of all step time at ~800 bodies;
             Native: numeric contact-sort and warm-start keys (were
             template strings built per contact per substep), shared
             solver scratch vectors, support marking by per-substep
             stamp, motor-driven set resolved once per substep, and the
             post-solve shape sync skips sleeping bodies.
    1.12.4 — API parity (MotionLab 1.47): Native gains wake /
             setMaxSpeed / maxSpeed / clearFluids / clearWinds /
             dragBody, and `dragging` is boolean on both backends
             (it returned the body on Native). No solver changes.
    1.12.3 — orphan-sleeper wake (MotionLab 1.44, BOTH backends):
             a probe every 15 fixed steps wakes sleeping bodies whose
             support chain is gone (deleted/dragged-away support left
             towers hovering in mid-air forever); support = touching
             chain to a non-sleeping body (statics count — Matter
             marks statics sleeping too), constraint/hinge attachment,
             or fluid overlap; zero/disabled gravity opts out.
    1.12.2 — native robustness (MotionLab 1.43): reference-face
             clipping no longer crashes on exactly-aligned stacks (the
             796-body stress scene froze mid-run); sleeping uses a
             smoothed motion metric with remembered support (dense
             piles: 72 -> 163 of 705 asleep at 15 s); warm-start
             impulses apply on the first substep only (they persist in
             the velocities — re-applying them leaked energy scaled by
             the substep count).
    1.12.1 — native host-contract fix (MotionLab 1.42): native circle
             bodies now expose a vertices polygon approximation (10–25
             sides, mirroring Matter circle bodies). Hosts draw every
             body through body.vertices — 1.12.0 shipped circles with
             vertices = [] and the MotionLab canvas rendered only the
             grid while the physics ran. No solver behaviour changes.
    1.11.0 — backend interface formalised: a BACKENDS registry (also
             PhysicsEngine.BACKENDS) names every solver backend behind
             this API, PhysicsEngine.create({ backend }) constructs
             through the registry, and every instance reports its
             backendId. The Matter.js backend is the only active one;
             a self-developed Native backend is registered as planned
             (MotionLab 1.41) — hosts code against this API only and
             can render engine pickers from the registry.
     1.10.0 — buoyancy obeys its preconditions: the displaced volume
             is the body's TRUE submerged area (part polygons clipped
             to the fluid rectangle — circles and rotated bodies get
             their real submerged fraction, and horizontal straddling
             counts), the force is applied at the centre of buoyancy
             (the submerged centroid — tilted floaters right or capsize
             physically), and the underside-seal condition is checked:
             if the body's underside is sealed against another body
             (flush on the tank floor), fluid pressure cannot act
             upward there, so buoyancy fades with the sealed fraction
             and a submerged top face is pressed down by the fluid
             column above it (the bridge-pier case). Fluid drag/flow
             now scale with the same true submerged fraction
     1.9.0 — module coupling: fluid drag also bleeds ANGULAR velocity
             (a spinning bar or paddle in water now feels the water;
             before, drag only touched linear velocity at the centre of
             mass, so rotors whose centre barely moved felt nothing);
             fluids gain a flow velocity (vx, vy — drag blends toward
             the flow instead of toward zero); wind regions overlapping
             a fluid drive a surface current in it (40% of the
             gust-adjusted wind velocity, scaled by horizontal overlap)
             — read it back with fluidFlow(id); fluid drag/flow no
             longer switch off in zero-gravity worlds (only buoyancy
             needs gravity)
     1.8.0 — wind gusts: wind regions gain `gust` (0..0.9) and
             `gustPeriod` (seconds, 2..30); the effective wind velocity
             oscillates as (1 + gust * sin(2π * t / period)) on a
             simulated-time clock that rides snapshots (simMs), so all
             regions breathe together like weather and a loaded world
             keeps its gust phase. Steady wind is unchanged (gust = 0)
   ========================================================================== */

import { NativeEngine } from './native-engine.js';

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
/** Allocation-free twin of localToWorld: writes the world point into `out`. */
function localToWorldInto(M, body, pt, out) {
  const c = Math.cos(body.angle), s = Math.sin(body.angle);
  out.x = body.position.x + pt.x * c - pt.y * s;
  out.y = body.position.y + pt.x * s + pt.y * c;
  return out;
}
const num = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb);

export const BODY_KINDS = ['circle', 'rect', 'polygon'];

/** PhysicsEngine core version — the single source of truth for the core. */
export const VERSION = '1.12.5';

/* ============================================================================
   Backends (1.11.0) — the solver behind this API is pluggable.

   A "backend" is whatever implements this class's public surface:
   body / constraint / hinge management, fluid / wind / magnet regions,
   fixed-timestep advance(), snapshots, spatial queries and the seeded
   RNG. Hosts must code against that API only — never against a
   backend's internals — so backends can be swapped without host
   changes. This registry is the single source of truth: hosts render
   engine pickers from it, and PhysicsEngine.create({ backend })
   constructs through it. Statuses: 'active' backends are the
   reference behaviour; 'experimental' backends construct normally
   but hosts should label them as such; a 'planned' entry is a
   published intention, not a usable engine — create() says so
   plainly instead of silently falling back.
   ========================================================================== */
export const BACKENDS = [
  {
    id: 'matter', name: 'Matter.js', status: 'active', since: '1.0.0',
    summary: 'The original solver: Matter.js 0.20 rigid-body engine behind the PhysicsEngine API, plus the engine-level force models (gravitation, buoyancy, magnetism, wind).',
  },
  {
    id: 'native', name: 'Native', status: 'experimental', since: '1.12.0',
    summary: 'A self-developed solver written for this API (sequential impulses, warm starting, sleeping, SAT + face-clipping contacts). Experimental since 1.12.0: covers the full API surface, validated by its own behaviour suite; Matter remains the default.',
  },
];

/* ============================================================================
   Formulas — pure physics helpers (no engine state).

   Units follow the engine's world: distances in px, velocities in px/step,
   mass = density × area. `gravity` parameters are accelerations in
   px/step² (a falling body under engine gravity y=1 gains ≈0.28 px/step
   per step; measure your world with a test drop if you need it exactly).
   ========================================================================== */
export const Formulas = {
  /** Kinetic energy of translation: ½·m·|v|² */
  kineticEnergy: (mass, vx, vy) => 0.5 * mass * (vx * vx + vy * vy),
  /** Rotational kinetic energy: ½·I·ω² */
  rotationalEnergy: (inertia, angularVelocity) => 0.5 * inertia * angularVelocity * angularVelocity,
  /** Linear momentum vector: m·v */
  momentum: (mass, vx, vy) => ({ x: mass * vx, y: mass * vy }),
  /** Impulse needed to change a body's velocity by (dvx, dvy): m·Δv */
  impulseForDeltaV: (mass, dvx, dvy) => ({ x: mass * dvx, y: mass * dvy }),
  /** Newton's law of gravitation — force magnitude: G·m1·m2 / r² */
  gravitationalForce: (G, m1, m2, distance) => (distance > 0 ? (G * m1 * m2) / (distance * distance) : 0),
  /** Magnetic pole interaction — signed force scalar: K·s1·s2 / (d² + ε²).
   *  Positive = repulsion (like poles), negative = attraction. This is the
   *  exact scalar the engine's magnetism pass applies along the pair axis. */
  magneticForce: (K, s1, s2, distSq, softening) => (K * s1 * s2) / (distSq + Math.max(0, softening)),
  /** Circular-orbit speed around a central mass: √(G·M / r) */
  orbitVelocity: (G, centralMass, radius) => Math.sqrt((G * centralMass) / Math.max(1e-9, radius)),
  /** Escape velocity from a central mass at radius r: √(2·G·M / r) */
  escapeVelocity: (G, centralMass, radius) => Math.sqrt((2 * G * centralMass) / Math.max(1e-9, radius)),
  /** Hooke's law — spring force magnitude: k·x (direction opposes stretch) */
  springForce: (stiffness, displacement) => stiffness * displacement,
  /** Elastic potential energy stored in a spring: ½·k·x² */
  springEnergy: (stiffness, displacement) => 0.5 * stiffness * displacement * displacement,
  /** Small-angle pendulum period: 2π·√(L / g) */
  pendulumPeriod: (length, gravity) => 2 * Math.PI * Math.sqrt(length / Math.max(1e-9, gravity)),
  /** Archimedes (2D) — buoyant force: ρ_fluid · submergedArea · g */
  buoyancyForce: (fluidDensity, submergedArea, gravity) => fluidDensity * submergedArea * gravity,
  /** Quadratic drag force magnitude: c·v² (apply opposite the motion) */
  dragForce: (coefficient, speed) => coefficient * speed * speed,
  /** Maximum static friction force: μ·N */
  frictionForce: (mu, normalForce) => mu * normalForce,
  /** Projectile range on flat ground: v²·sin(2θ) / g */
  projectileRange: (speed, angleRad, gravity) => (speed * speed * Math.sin(2 * angleRad)) / Math.max(1e-9, gravity),
  /** Centripetal acceleration for circular motion: v² / r */
  centripetalAcceleration: (speed, radius) => (speed * speed) / Math.max(1e-9, radius),
  /** Gravitational potential energy relative to a reference: m·g·h */
  potentialEnergy: (mass, gravity, height) => mass * gravity * height,
};

export class PhysicsEngine {
  /** Core version; same value as the module-level VERSION export. */
  static get VERSION() { return VERSION; }

  /** The backend registry (also exported standalone as `BACKENDS`). */
  static get BACKENDS() { return BACKENDS; }

  /**
   * Construct an engine through the backend registry (1.11.0).
   * `opts.backend` names a BACKENDS entry ('matter' when omitted).
   * 'active' and 'experimental' backends construct normally (native
   * since 1.12.0); a registered-but-planned backend — and an unknown
   * id — throws a plain error: silently falling back to another
   * solver would change simulation results without telling the host.
   */
  static create(opts = {}) {
    const backend = opts.backend || 'matter';
    if (backend === 'matter') return new PhysicsEngine(opts);
    if (backend === 'native') return new NativeEngine(opts);
    const known = BACKENDS.find((b) => b.id === backend);
    if (known) {
      throw new Error(`PhysicsEngine: backend "${backend}" (${known.name}) is registered but not available in ${VERSION} — status: ${known.status}`);
    }
    throw new Error(`PhysicsEngine: unknown backend "${backend}" (known: ${BACKENDS.map((b) => b.id).join(', ')})`);
  }

  /** The pure-formula library (also exported standalone as `Formulas`). */
  static get Formulas() { return Formulas; }

  /**
   * Check a body descriptor without creating anything. Returns a list of
   * human-readable problems (empty = valid). addBody() itself stays lenient
   * (it coerces bad values to defaults); use this in tools/importers that
   * would rather reject bad data than silently fix it.
   */
  static validateDescriptor(d) {
    const problems = [];
    if (!d || typeof d !== 'object') return ['descriptor is not an object'];
    if (d.kind !== undefined && !BODY_KINDS.includes(d.kind)) problems.push(`unknown kind: ${String(d.kind)}`);
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
   * @param {number} [opts.maxSpeed] velocity cap in px/step (0 = off).
   *        A stability guard: no dynamic body ever exceeds it, so a bad
   *        impulse cannot explode a scene or tunnel through everything.
   * @param {{G:number, softening?:number}|number} [opts.gravitation]
   *        pairwise Newtonian attraction between all bodies (see
   *        setGravitation). Off by default.
   * @param {{K:number, range?:number, softening?:number}|number} [opts.magnetism]
   *        global magnetism tuning (see setMagnetism). Bodies only feel it
   *        when their descriptor carries a `magnet` pole strength; the
   *        default (K = 1.2, range 320) is active out of the box.
   */
  constructor(opts = {}) {
    const M = opts.matter || matter();
    this.M = M;
    const { Engine } = M;
    this.engine = Engine.create({ enableSleeping: opts.enableSleeping === true });
    this.enableSleeping = opts.enableSleeping === true;
    // Rigid machines (hinge clusters, rod-locked crosses) need more
    // constraint iterations than Matter's default 2, or simultaneous
    // rigid constraints leave multi-pixel anchor errors that read as
    // hub drift and shape wobble (measured on the ferris wheel: hub
    // drift 28px -> 4px, cross error 5.6° -> 1° at 6 iterations).
    // 4 is the measured cost/quality balance; overridable per engine.
    this.engine.constraintIterations = Math.max(1, Math.round(num(opts.constraintIterations, 4)));
    this.world = this.engine.world;
    this.backendId = 'matter'; // registry id of the solver behind this instance (1.11.0)
    this.fixedDt = num(opts.fixedDt, 1000 / 60);
    this.maxSteps = Math.max(1, Math.round(num(opts.maxSteps, 5)));
    this.substeps = Math.max(1, Math.min(8, Math.round(num(opts.substeps, 1))));
    this._acc = 0;
    this._simMs = 0;               // simulated ms elapsed — the wind-gust clock (1.8.0); rides snapshots
    this._byId = new Map();        // id -> Matter body
    this._bodiesCache = null;      // cached array view of _byId (invalidated on structure change)
    this._locked = new Set();      // bodies with lockRotation — the per-step lock pass touches only these
    this._cons = new Map();        // id -> {constraint, desc}
    this._hinges = new Map();      // id -> {constraint, desc} revolute joints (1.7.0)
    this._seq = 1;
    this._drag = null;
    this._pickPt = { x: 0, y: 0 }; // scratch point for pick() — no per-call allocation
    this._seed = 0;                // RNG: the seed the current stream started from
    this._rngState = 0;            // RNG: mulberry32 state (uint32)
    this.setSeed(opts.seed === undefined ? (Math.random() * 4294967296) >>> 0 : opts.seed);
    this._maxSpeed = Math.max(0, num(opts.maxSpeed, 0)); // 0 = uncapped
    this._gravitation = null;      // { G, softening } | null
    if (opts.gravitation !== undefined && opts.gravitation !== null) {
      const g = typeof opts.gravitation === 'number' ? { G: opts.gravitation } : opts.gravitation;
      this.setGravitation(g.G, g);
    }
    this._fluids = new Map();      // id -> {id, x, y, width, height, density, drag, vx, vy}
    this._fluidFlow = new Map();   // id -> last computed effective flow {x, y} (base + wind-driven, 1.9.0)
    this._winds = new Map();       // id -> {id, x, y, width, height, vx, vy, power}
    this._magnets = new Set();     // Matter bodies whose descriptor magnet !== 0
    this._magnetism = { K: 1.2, range: 320, softening: 900 };
    // 1.6.0 perf scratch state: reused across steps so the fixed-step loop
    // allocates nothing (pair-force buffers, magnet grid, segment pool).
    this._pairBuf = null;          // {px, py, ms, axs, ays} grow-only Float64Arrays
    this._magnetCache = null;      // {list, ordinal} — invalidated whenever _magnets changes
    this._indexCache = null;       // Map body -> index in _bodies() (structural changes)
    this._grid = new Map();        // numeric cell key -> pooled index array
    this._gridPool = [];
    this._segPool = [];            // pooled constraint-segment records
    this._forceVec = { x: 0, y: 0 }; // scratch force vector for fluids
    if (opts.magnetism !== undefined && opts.magnetism !== null) {
      const m = typeof opts.magnetism === 'number' ? { K: opts.magnetism } : opts.magnetism;
      this.setMagnetism(m.K, m);
    }
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
   *   isStatic, lockRotation, vx, vy, label, name, magnet, userData }
   * `magnet` is a signed pole strength in [-100, 100] (0 = not magnetic);
   * see the magnetism section for how poles interact.
   * `name` is a developer-facing identifier (see getBodyByName); it is
   * independent of Matter's `label`. Returns the Matter body. The
   * (normalized) descriptor is kept on the body and can be read back
   * with describeBody().
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
      magnet: Math.min(100, Math.max(-100, num(partial.magnet, 0))),
      vx: num(partial.vx, 0), vy: num(partial.vy, 0),
      label: typeof partial.label === 'string' ? partial.label : '',
      name: typeof partial.name === 'string' ? partial.name : '',
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
    if (desc.magnet !== 0) { this._magnets.add(body); this._magnetCache = null; }
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
    for (const [hid, rec] of [...this._hinges]) {
      if (rec.desc.bodyA === id || rec.desc.bodyB === id) this.removeHinge(hid, false);
    }
    this.M.Composite.remove(this.world, body);
    this._byId.delete(id);
    this._locked.delete(body);
    if (this._magnets.delete(body)) this._magnetCache = null;
    this._emitChange();
    return true;
  }

  clear() {
    for (const { constraint } of this._cons.values()) this.M.Composite.remove(this.world, constraint);
    this._cons.clear();
    for (const { constraint } of this._hinges.values()) this.M.Composite.remove(this.world, constraint);
    this._hinges.clear();
    for (const b of this._byId.values()) this.M.Composite.remove(this.world, b);
    this._byId.clear();
    this._locked.clear();
    this._magnets.clear();
    this._magnetCache = null;
    this._fluids.clear();
    this._winds.clear();
    this.endDrag();
    this._acc = 0;
    this._emitChange();
  }

  bodyById(id) { return this._byId.get(id) || null; }
  idOf(body) { return body && body.plugin && body.plugin.pe ? body.plugin.pe.id : null; }
  kindOf(body) { return body && body.plugin && body.plugin.pe ? body.plugin.pe.kind : 'rect'; }
  userDataOf(body) { return body && body.plugin && body.plugin.pe ? body.plugin.pe.desc.userData : {}; }

  /* ---------------- names ----------------
     Bodies can carry a developer-facing `name` (descriptor field, kept in
     snapshots). Names need NOT be unique — scenes often reuse them
     ("peg", "ball") — so lookups come in two forms: first match, or all
     matches, both in insertion order. */
  /** The body's name ('' when unnamed or not an engine body). */
  nameOf(body) { return body && body.plugin && body.plugin.pe ? body.plugin.pe.desc.name : ''; }
  /** First body with this name, or null. */
  getBodyByName(name) {
    for (const b of this._byId.values()) if (b.plugin.pe.desc.name === name) return b;
    return null;
  }
  /** All bodies with this name, in insertion order. */
  getBodiesByName(name) {
    const out = [];
    for (const b of this._byId.values()) if (b.plugin.pe.desc.name === name) out.push(b);
    return out;
  }
  /** Rename a body (accepts the body itself or its id). Returns success. */
  renameBody(bodyOrId, name) {
    const body = typeof bodyOrId === 'string' ? this._byId.get(bodyOrId) : bodyOrId;
    if (!body || !body.plugin || !body.plugin.pe) return false;
    body.plugin.pe.desc.name = typeof name === 'string' ? name : '';
    return true;
  }
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
   *  Pass a reusable array to avoid per-frame allocation: it is cleared and
   *  refilled. Since 1.6.0 the segment records and their endpoint points
   *  are pooled per instance too, so a steady-state render loop allocates
   *  nothing here — but callers must consume them immediately and never
   *  retain a segment across calls. */
  constraintSegments(out = []) {
    out.length = 0;
    let k = 0;
    for (const { constraint, desc } of this._cons.values()) {
      let seg = this._segPool[k];
      if (!seg) seg = this._segPool[k] = { id: '', a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, stiffness: 0 };
      seg.id = desc.id;
      seg.stiffness = desc.stiffness;
      if (constraint.bodyA) localToWorldInto(this.M, constraint.bodyA, desc.pointA, seg.a);
      else { seg.a.x = desc.pointA.x; seg.a.y = desc.pointA.y; }
      localToWorldInto(this.M, constraint.bodyB, desc.pointB, seg.b);
      out.push(seg);
      k++;
    }
    return out;
  }

  /* ---------------- hinges & motors (revolute joints, 1.7.0) ----------------
     A hinge pins two bodies (or one body to a fixed world mount) at a
     shared point so they can only ROTATE around it — implemented as a
     rigid zero-length constraint, the same mechanism the app already
     trusts for pendulum rods. A hinge may carry a MOTOR: a target
     relative angular velocity (rad/step, signed) that the step loop
     drives toward with a per-step acceleration cap, applying the
     reaction to the other body when it is dynamic (momentum-honest,
     split by inverse inertia). Motors skip lockRotation bodies, whose
     inertia is infinite by design. */
  /**
   * Add a hinge: { id?, bodyA (id or null = fixed world mount), bodyB,
   *   pointA, pointB (body-local offsets; world coords when bodyA null),
   *   motorSpeed = 0 (rad/step, ±0.3), motorPower = 0.0025 (max Δω/step) }.
   * Returns a copy of the stored descriptor, or null when bodyB (or a
   * named bodyA) does not exist.
   */
  addHinge(partial = {}) {
    const M = this.M;
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
      motorSpeed: Math.min(0.3, Math.max(-0.3, num(partial.motorSpeed, 0))),
      motorPower: Math.min(0.05, Math.max(0.0001, num(partial.motorPower, 0.0025))),
    };
    const constraint = M.Constraint.create({
      bodyA: bodyA || undefined, bodyB,
      pointA: desc.pointA, pointB: desc.pointB,
      stiffness: 1, damping: 0, length: 0,
    });
    M.Composite.add(this.world, constraint);
    this._hinges.set(desc.id, { constraint, desc });
    this._syncHingeCollisionGroups();
    this._emitChange();
    return { ...desc, pointA: { ...desc.pointA }, pointB: { ...desc.pointB } };
  }

  /**
   * Bodies joined by hinges form a machine: parts of one machine must
   * be able to swing THROUGH each other around their pins (two bars
   * pinned end-to-end would otherwise jam on their own corners after a
   * few degrees). Each connected hinge cluster therefore shares a
   * negative Matter collision group — cluster members never collide
   * with each other, but collide normally with everything else.
   * Recomputed from scratch on every hinge add/remove (hinge counts
   * are small); bodies outside any cluster return to group 0.
   */
  _syncHingeCollisionGroups() {
    const parent = new Map();
    const find = (x) => { let r = x; while (parent.get(r) !== r) r = parent.get(r); return r; };
    const link = (a, b) => {
      if (!parent.has(a)) parent.set(a, a);
      if (!parent.has(b)) parent.set(b, b);
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    for (const { desc } of this._hinges.values()) if (desc.bodyA) link(desc.bodyA, desc.bodyB);
    const clusters = new Map();
    for (const id of parent.keys()) {
      const root = find(id);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root).push(id);
    }
    const grouped = new Set();
    let g = 0;
    for (const ids of clusters.values()) {
      if (ids.length < 2) continue;
      g -= 1;
      for (const id of ids) {
        const body = this._byId.get(id);
        if (body) { body.collisionFilter.group = g; grouped.add(id); }
      }
    }
    for (const [id, body] of this._byId) {
      if (!grouped.has(id) && body.collisionFilter.group < 0) body.collisionFilter.group = 0;
    }
  }

  removeHinge(id, emit = true) {
    const rec = this._hinges.get(id);
    if (!rec) return false;
    this.M.Composite.remove(this.world, rec.constraint);
    this._hinges.delete(id);
    this._syncHingeCollisionGroups();
    if (emit) this._emitChange();
    return true;
  }

  get hingeCount() { return this._hinges.size; }
  hingeById(id) {
    const rec = this._hinges.get(id);
    return rec ? { ...rec.desc, pointA: { ...rec.desc.pointA }, pointB: { ...rec.desc.pointB } } : null;
  }
  describeHinges() {
    return [...this._hinges.values()].map(({ desc }) => ({ ...desc, pointA: { ...desc.pointA }, pointB: { ...desc.pointB } }));
  }

  /** Resolved world-space pin points for rendering / picking:
   *  [{ id, x, y, motorSpeed }]. The two endpoints coincide by
   *  construction; bodyB's side is reported. */
  hingeAnchors() {
    const out = [];
    for (const { constraint, desc } of this._hinges.values()) {
      const p = localToWorld(this.M, constraint.bodyB, desc.pointB);
      out.push({ id: desc.id, x: p.x, y: p.y, motorSpeed: desc.motorSpeed });
    }
    return out;
  }

  /** Set a hinge's motor target speed (rad/step, clamped to ±0.3).
   *  Non-finite input is ignored; affected bodies are woken. */
  setHingeMotor(id, speed) {
    const rec = this._hinges.get(id);
    if (!rec || !Number.isFinite(Number(speed))) return false;
    rec.desc.motorSpeed = Math.min(0.3, Math.max(-0.3, Number(speed)));
    const a = rec.desc.bodyA ? this._byId.get(rec.desc.bodyA) : null;
    const b = this._byId.get(rec.desc.bodyB);
    if (a) this.wake(a);
    if (b) this.wake(b);
    return true;
  }

  _applyMotors() {
    const { Body, Sleeping } = this.M;
    for (const { desc } of this._hinges.values()) {
      const target = desc.motorSpeed;
      if (!target) continue;
      const b = this._byId.get(desc.bodyB);
      if (!b || b.isStatic || !Number.isFinite(b.inertia)) continue;
      const a = desc.bodyA ? this._byId.get(desc.bodyA) : null;
      const aFree = a && !a.isStatic && Number.isFinite(a.inertia);
      const rel = b.angularVelocity - (aFree ? a.angularVelocity : 0);
      const err = target - rel;
      // A motor-driven body must not doze off: Matter zeroes velocity
      // when a body falls asleep, which would fight the drive every
      // step. Holding the sleep counter at zero keeps driven bodies
      // awake for as long as their motor is on.
      b.sleepCounter = 0;
      if (aFree) a.sleepCounter = 0;
      if (!err) continue;
      const step = Math.max(-desc.motorPower, Math.min(desc.motorPower, err));
      if (aFree) {
        // split the impulse by inverse inertia: Δrel = step exactly,
        // with the reaction carried by bodyA (momentum conserved)
        const invB = 1 / b.inertia, invA = 1 / a.inertia;
        const j = step / (invB + invA);
        if (b.isSleeping) Sleeping.set(b, false);
        if (a.isSleeping) Sleeping.set(a, false);
        Body.setAngularVelocity(b, b.angularVelocity + j * invB);
        Body.setAngularVelocity(a, a.angularVelocity - j * invA);
      } else {
        if (b.isSleeping) Sleeping.set(b, false);
        Body.setAngularVelocity(b, b.angularVelocity + step);
      }
    }
  }

  /* ---------------- bulk load ---------------- */
  /**
   * Replace the world from plain data ({ bodies, constraints, fluids?,
   * winds?, gravity?, rng? }). Malformed entries (non-objects) are skipped
   * rather than crashing the load. Returns how many of each kind were loaded.
   */
  load(data = {}) {
    this.clear();
    let bodies = 0, constraints = 0, fluids = 0, winds = 0;
    for (const d of data.bodies || []) { if (d && typeof d === 'object') { this.addBody(d); bodies++; } }
    for (const c of data.constraints || []) { if (c && typeof c === 'object' && this.addConstraint(c)) constraints++; }
    let hinges = 0;
    for (const h of data.hinges || []) { if (h && typeof h === 'object' && this.addHinge(h)) hinges++; }
    for (const f of data.fluids || []) { if (f && typeof f === 'object') { this.addFluid(f); fluids++; } }
    for (const w of data.winds || []) { if (w && typeof w === 'object') { this.addWind(w); winds++; } }
    if (data.gravity) this.setGravity(data.gravity.x, data.gravity.y, data.gravity.enabled !== false);
    if (data.rng && Number.isFinite(data.rng.state)) {
      // Restore the RNG stream exactly where the snapshot left it, so a
      // loaded world keeps producing the same random sequence.
      this._seed = num(data.rng.seed, this._seed) >>> 0;
      this._rngState = data.rng.state >>> 0;
    }
    if (Number.isFinite(data.simMs)) this._simMs = Math.max(0, data.simMs);
    return { bodies, constraints, fluids, winds, hinges };
  }
  snapshot() {
    return {
      bodies: this.allBodies().map((b) => this.describeBody(b)),
      constraints: this.describeConstraints(),
      hinges: this.describeHinges(),
      fluids: this.fluids(),
      winds: this.winds(),
      rng: { seed: this._seed, state: this._rngState },
      simMs: this._simMs,
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
    this._simMs += this.fixedDt;
    // Pairwise forces (gravitation + magnetism) kick velocities once per
    // fixed step (not per substep), so their strength does not depend on
    // the anti-tunnelling setting.
    if (this._gravitation || (this._magnetism.K > 0 && this._magnets.size)) this._applyPairForces();
    // Hinge motors likewise drive once per fixed step (1.7.0).
    if (this._hinges.size) this._applyMotors();
    // Split the fixed step into `substeps` engine updates (anti-tunnelling:
    // a body can move at most fixedDt/substeps worth of travel per update).
    const n = this.substeps;
    const dt = this.fixedDt / n;
    for (let i = 0; i < n; i++) this._subStep(dt);
    // Orphan-sleeper probe (every 15 fixed steps): a sleeper whose
    // support was deleted or dragged away must fall, not hover.
    if (this.enableSleeping && Math.round(this._simMs / this.fixedDt) % 15 === 0) this._wakeOrphans();
  }

  /** Wake sleeping bodies that have lost every support (see the
   *  NativeEngine twin for the rationale — deleting the bottom box of
   *  a sleeping tower left the rest hovering forever, in BOTH
   *  backends). Support = a touching chain (bounds grown 3 px) to a
   *  non-sleeping body, a constraint/hinge attachment, or a fluid
   *  region overlap. Zero/disabled gravity opts out. */
  _wakeOrphans() {
    const g = this.engine.gravity;
    if (!g || (g.x === 0 && g.y === 0)) return;
    const arr = this._bodies();
    const sleepers = arr.filter((b) => b.isSleeping && !b.isStatic);
    if (!sleepers.length) return;
    const supported = new Set();
    for (const rec of this._cons.values()) { if (rec.desc.bodyA) supported.add(rec.desc.bodyA); if (rec.desc.bodyB) supported.add(rec.desc.bodyB); }
    for (const rec of this._hinges.values()) { if (rec.desc.bodyA) supported.add(rec.desc.bodyA); if (rec.desc.bodyB) supported.add(rec.desc.bodyB); }
    const touch = (A, B) => A.min.x - 3 <= B.max.x && A.max.x + 3 >= B.min.x && A.min.y - 3 <= B.max.y && A.max.y + 3 >= B.min.y;
    const fluidBounds = [...this._fluids.values()].map((f) => ({
      min: { x: f.x - f.width / 2, y: f.y - f.height / 2 },
      max: { x: f.x + f.width / 2, y: f.y + f.height / 2 },
    }));
    // 1.12.5: candidate pairs come from a uniform grid over grown bounds
    // instead of O(sleepers x bodies) scans. At ~800 bodies (nearly all
    // asleep at rest) the naive probe measured ~31% of ALL step time.
    // Semantics unchanged: the touch predicate and the support rules are
    // identical; the grid only prunes pairs that cannot touch (touching
    // grown bounds always share a cell both were inserted into).
    const CELL = 96;
    const cells = new Map();
    for (const b of arr) {
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
      if (!ok) ok = near(s.bounds, (o) => o !== s && (o.isStatic || !o.isSleeping) && touch(s.bounds, o.bounds));
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
    for (const s of sleepers) if (!supported.has(s.plugin.pe.id)) this.M.Sleeping.set(s, false);
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
    // Stability guard: cap speeds before the solver sees them, so one bad
    // impulse can never poison the world with a runaway body.
    if (this._maxSpeed > 0) {
      const cap = this._maxSpeed, capSq = cap * cap;
      const arr = this._bodies();
      for (let i = 0; i < arr.length; i++) {
        const b = arr[i];
        // sleeping bodies sit far below any sane cap by definition
        if (b.isStatic || b.isSleeping) continue;
        const v = b.velocity, spSq = v.x * v.x + v.y * v.y;
        if (spSq > capSq) {
          const s = cap / Math.sqrt(spSq);
          this.M.Body.setVelocity(b, { x: v.x * s, y: v.y * s });
        }
      }
    }
    // Fluid forces must be applied right before the update: Matter clears
    // accumulated forces as part of every Engine.update.
    if (this._fluids.size) this._applyFluids();
    if (this._winds.size) this._applyWinds();
    this.M.Engine.update(this.engine, dt);
  }

  /* ---------------- gravitation (pairwise, Newtonian) ----------------
     Every body attracts every other body: a = G · m_other · d / (|d|² + ε²)^1.5
     applied as a velocity kick once per fixed step. G is in engine units
     (px/step² per unit mass); ε (softening, px²) avoids the singularity
     when bodies overlap. Static bodies attract but are not moved; their
     effective mass is area × density (Matter reports Infinity for them).
     Cost is O(n²) per step — built for tens of bodies, not thousands. */
  /** Enable/retune pairwise gravitation. `setGravitation(0)` disables. */
  setGravitation(G, opts = {}) {
    const g = num(G, 0);
    if (!(g > 0)) { this._gravitation = null; return; }
    this._gravitation = { G: g, softening: Math.max(0, num(opts.softening, 100)) };
  }
  /** Current gravitation config ({ G, softening }) or null when off. */
  get gravitation() { return this._gravitation ? { ...this._gravitation } : null; }

  _gravMass(body) {
    if (!body.isStatic) return body.mass;
    // Matter sets a static body's density to Infinity; the descriptor
    // keeps the density the body was created (or last set) with.
    const d = body.plugin && body.plugin.pe ? body.plugin.pe.desc.density : 0;
    return body.area * (Number.isFinite(d) ? d : 0);
  }

  /* ---------------- magnetism (pairwise, range-limited) ----------------
     A body's descriptor `magnet` is a signed pole strength in [-100, 100];
     the sign is the pole (positive = "N", negative = "S"). Two magnetic
     bodies interact with the signed scalar F = K · s1 · s2 / (d² + ε²)
     (Formulas.magneticForce): same signs repel, opposite signs attract —
     exactly like real poles. A magnetic body also attracts UNMAGNETISED
     dynamic bodies ("iron") with an effective strength of IRON = 35,
     always attractively. Kicks are force ÷ mass on both sides, so total
     momentum is conserved, and light bodies respond more than heavy ones.
     Unlike gravitation, magnetism is short-ranged: pairs beyond `range`
     (default 320px) feel nothing, which also keeps the cost local. */
  /** Retune global magnetism. `setMagnetism(0)` disables it entirely. */
  setMagnetism(K, opts = {}) {
    const k = num(K, 0);
    this._magnetism = {
      K: Math.max(0, k),
      range: Math.max(10, num(opts.range, this._magnetism ? this._magnetism.range : 320)),
      softening: Math.max(0, num(opts.softening, this._magnetism ? this._magnetism.softening : 900)),
    };
  }
  /** Current magnetism config ({ K, range, softening }). */
  get magnetism() { return { ...this._magnetism }; }
  /** Number of bodies currently carrying a pole strength. */
  get magnetCount() { return this._magnets.size; }

  /* One unified pairwise pass for gravitation + magnetism (1.5.0).
     Positions and effective masses are hoisted into typed arrays once,
     instead of property lookups and a _gravMass() call per pair (the
     1.4.0 inner loop). Gravitation stays O(n²) (it is infinite-ranged);
     magnetism queries a uniform grid (cell = range) so its cost scales
     with the number of magnets × local density, not with n².
     1.6.0: the typed arrays, the body->index map, the magnet list and the
     grid (numeric keys, pooled cell arrays) are all reused across steps —
     a fixed step of this pass now allocates nothing. */
  _applyPairForces() {
    const arr = this._bodies();
    const n = arr.length;
    if (!n) return;
    let buf = this._pairBuf;
    if (!buf || buf.px.length < n) {
      const cap = Math.max(64, n * 2);
      buf = this._pairBuf = {
        px: new Float64Array(cap), py: new Float64Array(cap), ms: new Float64Array(cap),
        axs: new Float64Array(cap), ays: new Float64Array(cap),
        dynIdx: new Int32Array(cap),
        dpx: new Float64Array(cap), dpy: new Float64Array(cap), dms: new Float64Array(cap),
        spx: new Float64Array(cap), spy: new Float64Array(cap), sms: new Float64Array(cap),
      };
    }
    const { px, py, ms } = buf;
    // Hoist positions/masses AND partition dynamic vs static bodies into
    // contiguous arrays for the gravitation loops (see below).
    let nd = 0, ns = 0;
    const { dynIdx, dpx, dpy, dms, spx, spy, sms } = buf;
    for (let i = 0; i < n; i++) {
      const b = arr[i];
      px[i] = b.position.x; py[i] = b.position.y;
      ms[i] = this._gravMass(b);
      if (b.isStatic) { spx[ns] = px[i]; spy[ns] = py[i]; sms[ns] = ms[i]; ns++; }
      else { dynIdx[nd] = i; dpx[nd] = px[i]; dpy[nd] = py[i]; dms[nd] = ms[i]; nd++; }
    }
    buf.nd = nd; buf.ns = ns;
    const { Body, Sleeping } = this.M;
    const kick = (i, kx, ky) => {
      if (!kx && !ky) return;
      const b = arr[i];
      if (b.isSleeping) Sleeping.set(b, false);
      Body.setVelocity(b, { x: b.velocity.x + kx, y: b.velocity.y + ky });
    };
    if (this._gravitation) {
      const { G, softening } = this._gravitation;
      // Symmetric dynamic–dynamic pairs: each unordered pair is evaluated
      // ONCE and both accelerations accumulated — half the sqrt work of
      // the naive double loop. Static bodies then contribute a one-way
      // pass over the dynamics. Splitting the loops this way (instead of
      // a static check inside one O(n²) loop) matters: a per-pair branch
      // measurably de-optimises the hot loop (~20%), and static–static
      // pairs — which can never move anything — are never evaluated.
      const axs = buf.axs, ays = buf.ays;
      axs.fill(0, 0, nd); ays.fill(0, 0, nd);
      for (let a = 0; a < nd; a++) {
        for (let b = a + 1; b < nd; b++) {
          const dx = dpx[b] - dpx[a], dy = dpy[b] - dpy[a];
          const dSq = dx * dx + dy * dy + softening;
          const inv = 1 / (dSq * Math.sqrt(dSq));
          const sa = G * dms[b] * inv, sb = G * dms[a] * inv;
          axs[a] += dx * sa; ays[a] += dy * sa;
          axs[b] -= dx * sb; ays[b] -= dy * sb;
        }
      }
      for (let a = 0; a < nd; a++) {
        for (let s = 0; s < ns; s++) {
          const dx = spx[s] - dpx[a], dy = spy[s] - dpy[a];
          const dSq = dx * dx + dy * dy + softening;
          const inv = 1 / (dSq * Math.sqrt(dSq));
          const sa = G * sms[s] * inv;
          axs[a] += dx * sa; ays[a] += dy * sa;
        }
      }
      for (let a = 0; a < nd; a++) kick(dynIdx[a], axs[a], ays[a]);
    }
    const { K, range, softening } = this._magnetism;
    if (K > 0 && this._magnets.size) {
      const IRON = 35;
      const rangeSq = range * range;
      if (!this._indexCache) {
        this._indexCache = new Map();
        for (let i = 0; i < n; i++) this._indexCache.set(arr[i], i);
      }
      const indexOf = this._indexCache;
      if (!this._magnetCache) {
        const list = [...this._magnets];
        this._magnetCache = { list, ordinal: new Map(list.map((b, i) => [b, i])) };
      }
      const { list: magnets, ordinal } = this._magnetCache;
      // uniform grid over all bodies (cell = range): neighbours within
      // `range` live in the 3×3 block of cells around the source. Keys are
      // numeric ((cx+32768)*65536 + (cy+32768)) — no per-step strings.
      const grid = this._grid, pool = this._gridPool;
      for (const cell of grid.values()) { cell.length = 0; pool.push(cell); }
      grid.clear();
      const keyOf = (cx, cy) => (cx + 32768) * 65536 + (cy + 32768);
      for (let i = 0; i < n; i++) {
        const key = keyOf(Math.floor(px[i] / range), Math.floor(py[i] / range));
        let cell = grid.get(key);
        if (!cell) { cell = pool.pop() || []; grid.set(key, cell); }
        cell.push(i);
      }
      for (const src of magnets) {
        const si = indexOf.get(src);
        if (si === undefined) continue;
        const ss = src.plugin.pe.desc.magnet;
        const cx = Math.floor(px[si] / range), cy = Math.floor(py[si] / range);
        for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const cell = grid.get(keyOf(gx, gy));
          if (!cell) continue;
          for (const ti of cell) {
            if (ti === si) continue;
            const tgt = arr[ti];
            if (tgt.isStatic) continue; // statics exert (as sources) but never move
            const tm = tgt.plugin.pe.desc.magnet;
            // Magnet–magnet pairs are handled once, from the earlier source —
            // but only when that earlier pass can actually process the pair:
            // a static target is skipped above, so when the source is static
            // the pair must be handled HERE even if the target was added
            // earlier (1.5.1 fix: pole pairs no longer depend on add order).
            if (tm !== 0 && !src.isStatic && ordinal.get(tgt) < ordinal.get(src)) continue;
            const dx = px[ti] - px[si], dy = py[ti] - py[si];
            const dSq = dx * dx + dy * dy;
            if (dSq > rangeSq || dSq < 1e-9 || ms[ti] <= 0) continue;
            const d = Math.sqrt(dSq);
            const ux = dx / d, uy = dy / d;
            // signed scalar along source->target: >0 pushes apart, <0 pulls together
            const f = tm !== 0
              ? (K * ss * tm) / (dSq + softening)
              : -(K * Math.abs(ss) * IRON) / (dSq + softening);
            // Per-step kick clamp: at contact distance the raw force is
            // huge; an uncapped kick makes stuck bodies buzz against the
            // contact solver and can sling overlap pairs across the world.
            const MAXK = 0.8;
            let kx = ux * f / ms[ti], ky = uy * f / ms[ti];
            const km = Math.hypot(kx, ky);
            if (km > MAXK) { kx *= MAXK / km; ky *= MAXK / km; }
            kick(ti, kx, ky);
            if (!src.isStatic && ms[si] > 0) {
              let sx = -ux * f / ms[si], sy = -uy * f / ms[si];
              const sm = Math.hypot(sx, sy);
              if (sm > MAXK) { sx *= MAXK / sm; sy *= MAXK / sm; }
              kick(si, sx, sy);
            }
          }
        }
      }
    }
  }

  /* ---------------- fluid regions (buoyancy + drag) ----------------
     A fluid is an axis-aligned rectangle given by its CENTER (x, y) and
     size; the surface is its top edge. A dynamic body overlapping the
     region feels an upward force mirroring world gravity, scaled by
     (fluid density / body density) × submerged fraction of its bounds —
     so a body floats when the submerged fraction balances its density
     ratio, exactly Archimedes' principle in 2D. `drag` (0..1) bleeds
     velocity per substep while submerged — from 1.9.0 toward the
     fluid's flow velocity (its own current plus wind-driven surface
     current) instead of toward zero, and it bleeds angular velocity
     by the same factor, so spinning/paddling bodies feel the fluid. */
  /**
   * Add a fluid region: { id?, x, y, width, height, density = 0.0012,
   * drag = 0.02, vx = 0, vy = 0 }. (vx, vy) is the fluid's own flow
   * (current) in px/step: drag blends submerged bodies toward the
   * flow, and bleeds their angular velocity too (1.9.0). Wind regions
   * overlapping the fluid add a wind-driven surface current on top —
   * see fluidFlow(id) for the effective flow. Returns a copy.
   */
  addFluid(partial = {}) {
    const rec = {
      id: typeof partial.id === 'string' && partial.id ? partial.id : `fluid-${this._seq++}`,
      x: num(partial.x, 0), y: num(partial.y, 0),
      width: Math.max(1, num(partial.width, 200)), height: Math.max(1, num(partial.height, 200)),
      density: Math.max(0, num(partial.density, 0.0012)),
      drag: Math.min(1, Math.max(0, num(partial.drag, 0.02))),
      vx: Math.min(16, Math.max(-16, num(partial.vx, 0))),
      vy: Math.min(16, Math.max(-16, num(partial.vy, 0))),
    };
    this._fluids.set(rec.id, rec);
    return { ...rec };
  }
  removeFluid(id) { return this._fluids.delete(id); }
  clearFluids() { this._fluids.clear(); }
  fluidById(id) { const f = this._fluids.get(id); return f ? { ...f } : null; }
  /** All fluid regions (copies), in insertion order. */
  fluids() { return [...this._fluids.values()].map((f) => ({ ...f })); }
  /** Allocation-free iteration over the LIVE fluid records — read-only:
   *  for render loops and other per-frame readers (1.6.0). */
  forEachFluid(fn) { for (const f of this._fluids.values()) fn(f); }
  get fluidCount() { return this._fluids.size; }
  /** Effective flow of a fluid right now: its own (vx, vy) plus any
   *  wind-driven surface current (1.9.0). Before the first simulated
   *  step (or in a zero-wind world) this is just the base flow. */
  fluidFlow(id) {
    const e = this._fluidFlow.get(id);
    if (e) return { x: e.x, y: e.y };
    const f = this._fluids.get(id);
    return f ? { x: f.vx, y: f.vy } : null;
  }

  _applyFluids() {
    const g = this.engine.gravity;
    const scale = g && g.scale !== undefined ? g.scale : 0.001;
    // Only buoyancy needs gravity (1.9.0): drag and currents keep
    // working in zero-gravity worlds instead of switching off whole.
    const hasG = !!(g && (g.x !== 0 || g.y !== 0));
    const { Body } = this.M;
    const arr = this._bodies();
    const fv = this._forceVec;
    for (const f of this._fluids.values()) {
      const top = f.y - f.height / 2, bottom = f.y + f.height / 2;
      const left = f.x - f.width / 2, right = f.x + f.width / 2;
      // Effective flow (1.9.0): the fluid's own current plus a
      // wind-driven surface current from every overlapping wind
      // region — 40% of its gust-adjusted velocity, scaled by power
      // and by the horizontal overlap fraction. Derived per step and
      // never written back into the record (snapshots stay clean).
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
      for (let i = 0; i < arr.length; i++) {
        const b = arr[i];
        // Sleeping bodies are skipped: Matter discards forces on them
        // without integrating, and their (near-zero) velocity makes the
        // drag branch a no-op too — the first substep after they wake
        // re-applies everything, so behaviour is unchanged.
        if (b.isStatic || b.isSleeping) continue;
        const bd = b.bounds;
        if (bd.max.x < left || bd.min.x > right || bd.max.y < top || bd.min.y > bottom) continue;
        // True submerged geometry (1.10.0): clip every part polygon
        // to the fluid rectangle — the clipped area is the displaced
        // volume (in 2D), its centroid is the centre of buoyancy.
        // This replaces the old bounding-box depth fraction, which
        // ignored horizontal straddling entirely and over-credited
        // rotated shapes.
        const sub = this._submerged(b, left, top, right, bottom);
        if (!sub) continue;
        const frac = Math.min(1, sub.area / Math.max(1, b.area));
        if (frac <= 0) continue;
        if (hasG) {
          const ratio = b.density > 0 ? f.density / b.density : 0;
          // Archimedes has a precondition most models skip: fluid
          // pressure can only push the body up where fluid can reach
          // the underside. A body sealed flush against the tank floor
          // (or another body) has no upward pressure there — buoyancy
          // fades with the sealed fraction, and if its top face is
          // submerged, the fluid column above presses it DOWN
          // (the bridge-pier / suction case).
          const seal = this._undersideSeal(b, arr, left, right);
          fv.x = -g.x * b.mass * ratio * frac * (1 - seal) * scale;
          fv.y = -g.y * b.mass * ratio * frac * (1 - seal) * scale;
          if (seal > 0) {
            const bh = Math.max(1, bd.max.y - bd.min.y);
            const topDepth = Math.min(1, Math.max(0, (bd.min.y - top) / bh));
            fv.x += g.x * b.mass * ratio * seal * topDepth * scale;
            fv.y += g.y * b.mass * ratio * seal * topDepth * scale;
          }
          // Buoyancy through Matter's own force channel, mirroring
          // how gravity itself is applied (force = mass · g · scale),
          // so a fully submerged unsealed body with ratio 1 is exactly
          // neutrally buoyant — but applied at the CENTRE OF BUOYANCY
          // (the submerged centroid), not the centre of mass, which
          // is what makes tilted floaters right themselves or capsize.
          Body.applyForce(b, sub, fv);
        }
        if (f.drag > 0) {
          const keep = 1 - f.drag * frac;
          // Blend toward the effective flow (identical to the old
          // bleed-to-zero when the flow is zero), and bleed spin with
          // a stronger coefficient: rotational drag acts over the
          // body's whole submerged sweep, not just at its centre —
          // a rotor whose centre barely moves still feels the water
          // through its angular velocity (1.9.0).
          Body.setVelocity(b, { x: fx + (b.velocity.x - fx) * keep, y: fy + (b.velocity.y - fy) * keep });
          Body.setAngularVelocity(b, b.angularVelocity * Math.max(0, 1 - f.drag * frac * 2.5));
        }
      }
    }
  }

  /* ---------------- wind regions (target-velocity fields) ----------------
     A wind is an axis-aligned rectangle (given by its CENTER and size)
     carrying a target velocity (vx, vy) in px/step. A dynamic body
     overlapping the region is blended toward that velocity — the gaseous
     sibling of fluid drag. The blend rate scales with the bounds-overlap
     fraction and with (reference density / body density), so light, airy
     bodies are blown around while dense blocks barely stir; `power`
     (0..2, default 1) scales the effect per region. */
  /**
   * Add a wind region: { id?, x, y, width, height, vx = 3, vy = 0,
   * power = 1, gust = 0, gustPeriod = 6 }. `gust` (0..0.9) makes the
   * wind breathe: the effective velocity is multiplied by
   * (1 + gust * sin(2π * simTime / gustPeriod)) — all regions share
   * the engine's simulated-time clock, like one weather system.
   * Returns the stored record (a copy).
   */
  addWind(partial = {}) {
    const rec = {
      id: typeof partial.id === 'string' && partial.id ? partial.id : `wind-${this._seq++}`,
      x: num(partial.x, 0), y: num(partial.y, 0),
      width: Math.max(1, num(partial.width, 400)), height: Math.max(1, num(partial.height, 240)),
      vx: Math.min(16, Math.max(-16, num(partial.vx, 3))),
      vy: Math.min(16, Math.max(-16, num(partial.vy, 0))),
      power: Math.min(2, Math.max(0, num(partial.power, 1))),
      gust: Math.min(0.9, Math.max(0, num(partial.gust, 0))),
      gustPeriod: Math.min(30, Math.max(2, num(partial.gustPeriod, 6))),
    };
    this._winds.set(rec.id, rec);
    return { ...rec };
  }
  removeWind(id) { return this._winds.delete(id); }
  clearWinds() { this._winds.clear(); }
  windById(id) { const w = this._winds.get(id); return w ? { ...w } : null; }
  /** All wind regions (copies), in insertion order. */
  winds() { return [...this._winds.values()].map((w) => ({ ...w })); }
  /** Allocation-free iteration over the LIVE wind records — read-only:
   *  for render loops and other per-frame readers (1.6.0). */
  forEachWind(fn) { for (const w of this._winds.values()) fn(w); }
  get windCount() { return this._winds.size; }
  /** Simulated milliseconds elapsed (the gust clock); rides snapshots. */
  get simTime() { return this._simMs; }

  /** Clip a polygon to the fluid rectangle (Sutherland–Hodgman). */
  _clipRect(poly, left, top, right, bottom) {
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
    // Skip the edges the polygon's bounds never cross — most bodies
    // in a fluid only cross the surface line, so typically one of
    // the four passes actually runs.
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
    for (const p of poly) { if (p.x < mnx) mnx = p.x; if (p.x > mxx) mxx = p.x; if (p.y < mny) mny = p.y; if (p.y > mxy) mxy = p.y; }
    if (mnx < left) poly = clip(poly, (p) => p.x >= left, (a, b) => lerp(a, b, (left - a.x) / ((b.x - a.x) || 1e-12)));
    if (mxx > right) poly = clip(poly, (p) => p.x <= right, (a, b) => lerp(a, b, (right - a.x) / ((b.x - a.x) || 1e-12)));
    if (mny < top) poly = clip(poly, (p) => p.y >= top, (a, b) => lerp(a, b, (top - a.y) / ((b.y - a.y) || 1e-12)));
    if (mxy > bottom) poly = clip(poly, (p) => p.y <= bottom, (a, b) => lerp(a, b, (bottom - a.y) / ((b.y - a.y) || 1e-12)));
    return poly;
  }

  /** The body's submerged geometry inside a fluid rectangle: total
   *  clipped area and its centroid (the centre of buoyancy), or null
   *  when nothing is submerged. Compound bodies clip per part. */
  _submerged(b, left, top, right, bottom) {
    const bd = b.bounds;
    // Fast path: fully inside — the whole body is the submerged part.
    if (bd.min.x >= left && bd.max.x <= right && bd.min.y >= top && bd.max.y <= bottom) {
      return { x: b.position.x, y: b.position.y, area: b.area };
    }
    let area = 0, cx = 0, cy = 0;
    const parts = b.parts.length > 1 ? b.parts.slice(1) : b.parts;
    for (const part of parts) {
      const poly = this._clipRect(part.vertices, left, top, right, bottom);
      if (poly.length < 3) continue;
      let a2 = 0, sx = 0, sy = 0;
      for (let j = 0; j < poly.length; j++) {
        const p = poly[j], q = poly[(j + 1) % poly.length];
        const cr = p.x * q.y - q.x * p.y;
        a2 += cr; sx += (p.x + q.x) * cr; sy += (p.y + q.y) * cr;
      }
      if (Math.abs(a2) < 1e-9) continue;
      const a = a2 / 2, wgt = Math.abs(a);
      cx += (sx / (6 * a)) * wgt; cy += (sy / (6 * a)) * wgt; area += wgt;
    }
    return area > 0 ? { x: cx / area, y: cy / area, area } : null;
  }

  /** Fraction of the body's underside (within the fluid's horizontal
   *  span) that is sealed against another body — sampled at three
   *  points just below the body's bounds. 0 = fluid reaches the whole
   *  underside, 1 = fully sealed (flush on the floor). */
  _undersideSeal(b, arr, left, right) {
    const bd = b.bounds;
    const x0 = Math.max(bd.min.x, left), x1 = Math.min(bd.max.x, right);
    if (x1 <= x0) return 0;
    // Cheap gate first: another body's bounds must reach into the
    // thin probe slab under the underside before any point test
    // runs — a body falling through open water skips the seal check
    // entirely (three full Query.point scans per body per substep
    // measurably slowed dense fluid scenes).
    let candidates = null;
    const yTop = bd.max.y - 1, yBot = bd.max.y + 3;
    for (let j = 0; j < arr.length; j++) {
      const o = arr[j];
      if (o === b) continue;
      const ob = o.bounds;
      if (ob.max.x < x0 || ob.min.x > x1 || ob.max.y < yTop || ob.min.y > yBot) continue;
      (candidates || (candidates = [])).push(o);
    }
    if (!candidates) return 0;
    const y = bd.max.y + 1.5;
    let blocked = 0;
    for (const t of [0.25, 0.5, 0.75]) {
      const pt = { x: x0 + (x1 - x0) * t, y };
      for (const o of candidates) {
        const parts = o.parts.length > 1 ? o.parts.slice(1) : o.parts;
        let hit = false;
        for (const part of parts) if (this.M.Vertices.contains(part.vertices, pt)) { hit = true; break; }
        if (hit) { blocked++; break; }
      }
    }
    return blocked / 3;
  }

  /** Gust-adjusted wind velocity of a region right now (shared by
   *  _applyWinds and the wind→fluid surface-current coupling, 1.9.0). */
  _windVel(w) {
    if (!(w.gust > 0)) return { x: w.vx, y: w.vy };
    const m = 1 + w.gust * Math.sin(6.283185307179586 * (this._simMs / (1000 * w.gustPeriod)));
    return { x: w.vx * m, y: w.vy * m };
  }

  _applyWinds() {
    const { Body, Sleeping } = this.M;
    const arr = this._bodies();
    for (const w of this._winds.values()) {
      if (w.power <= 0) continue;
      const { x: mvx, y: mvy } = this._windVel(w);
      const top = w.y - w.height / 2, bottom = w.y + w.height / 2;
      const left = w.x - w.width / 2, right = w.x + w.width / 2;
      for (let i = 0; i < arr.length; i++) {
        const b = arr[i];
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
        if (b.isSleeping) Sleeping.set(b, false);
        Body.setVelocity(b, {
          x: b.velocity.x + (mvx - b.velocity.x) * rate,
          y: b.velocity.y + (mvy - b.velocity.y) * rate,
        });
      }
    }
  }

  /* ---------------- measurements (live Formulas over world state) -------- */
  /** Kinetic energy of one body (translation + rotation). */
  bodyKineticEnergy(body) {
    if (!body) return 0;
    return Formulas.kineticEnergy(body.mass, body.velocity.x, body.velocity.y)
      + (Number.isFinite(body.inertia) ? Formulas.rotationalEnergy(body.inertia, body.angularVelocity) : 0);
  }
  /** Total kinetic energy of all dynamic bodies. */
  totalKineticEnergy() {
    let e = 0;
    for (const b of this._byId.values()) if (!b.isStatic) e += this.bodyKineticEnergy(b);
    return e;
  }
  /** Momentum vector of one body. */
  bodyMomentum(body) { return body ? Formulas.momentum(body.mass, body.velocity.x, body.velocity.y) : { x: 0, y: 0 }; }
  /** Total momentum of all dynamic bodies — conserved in collisions and
   *  under symmetric internal forces like gravitation. */
  totalMomentum() {
    let x = 0, y = 0;
    for (const b of this._byId.values()) {
      if (b.isStatic) continue;
      x += b.mass * b.velocity.x; y += b.mass * b.velocity.y;
    }
    return { x, y };
  }
  /** Centre of mass of all dynamic bodies: { x, y, mass } (mass 0 → origin). */
  centerOfMass() {
    let m = 0, x = 0, y = 0;
    for (const b of this._byId.values()) {
      if (b.isStatic) continue;
      m += b.mass; x += b.position.x * b.mass; y += b.position.y * b.mass;
    }
    return m > 0 ? { x: x / m, y: y / m, mass: m } : { x: 0, y: 0, mass: 0 };
  }

  /* ---------------- property setters (engine stays source of truth) ----------------
     Stability rule: setters IGNORE non-finite inputs (NaN / Infinity)
     instead of letting them into the world — a single NaN position would
     otherwise poison every body it touches. Use findNonFiniteBodies() to
     audit a world that came from untrusted data. */
  wake(body) { if (body.isSleeping) this.M.Sleeping.set(body, false); }
  setPosition(body, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.wake(body); this.M.Body.setPosition(body, { x, y });
  }
  setVelocity(body, vx, vy) {
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) return;
    if (!body.isStatic) { this.wake(body); this.M.Body.setVelocity(body, { x: vx, y: vy }); }
  }
  setAngleDeg(body, deg) {
    if (!Number.isFinite(deg)) return;
    this.wake(body); this.M.Body.setAngle(body, deg * Math.PI / 180);
  }
  /** Velocity cap in px/step (0 = off) — see the constructor option. */
  setMaxSpeed(v) { this._maxSpeed = Math.max(0, num(v, 0)); }
  get maxSpeed() { return this._maxSpeed; }
  /** Ids of bodies whose position or velocity is NaN/Infinity (should
   *  always be empty in a healthy world). */
  findNonFiniteBodies() {
    const out = [];
    for (const b of this._byId.values()) {
      if (!Number.isFinite(b.position.x) || !Number.isFinite(b.position.y)
        || !Number.isFinite(b.velocity.x) || !Number.isFinite(b.velocity.y)) out.push(this.idOf(b));
    }
    return out;
  }
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
  /** Set a body's magnetic pole strength (signed, clamped to [-100, 100]).
   *  Keeps the magnet registry in sync; non-finite input is ignored. */
  setMagnet(body, v) {
    if (!body || !body.plugin || !body.plugin.pe || !Number.isFinite(Number(v))) return;
    const val = Math.min(100, Math.max(-100, Number(v)));
    body.plugin.pe.desc.magnet = val;
    if (val !== 0) this._magnets.add(body); else this._magnets.delete(body);
    this._magnetCache = null;
    this.wake(body);
  }
  /** A body's current magnetic pole strength (0 when not magnetic). */
  magnetOf(body) { return body && body.plugin && body.plugin.pe ? body.plugin.pe.desc.magnet : 0; }
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
    if (!Number.isFinite(dvx) || !Number.isFinite(dvy)) return;
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
    this._indexCache = null;  // body -> position-in-array map used by the pair pass
    if (typeof this.onChange === 'function') this.onChange();
  }
}

export default PhysicsEngine;
