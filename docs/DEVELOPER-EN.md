# MotionLab Developer Documentation

> 中文版：[DEVELOPER.md](DEVELOPER.md)

The complete integration guide for secondary development: **PhysicsEngine**
(the general-purpose 2D physics core), the **PF engine** (platform-fighter
module set), **PhysicsEngine3D** (the 3D core) and the vendored
**Matter.js**. This document is readable directly on GitHub; the in-app
"Home → Developer Docs" page is a condensed version of the same content.

- Live site: https://xieyuke2026-cpu.github.io/Physics-engine/
- Layout: the site root is this repository's root (pure static, no build step)

## Current versions

| Component | Version | Single source of truth |
|---|---|---|
| MotionLab (app) | 1.54 | `APP_VERSION` in `js/ui.js` |
| PhysicsEngine (2D core) | 1.12.6 | `VERSION` / `PhysicsEngine.VERSION` in `js/engine/physics-engine.js` |
| PF engine (platform fighter) | 1.1.0 | `PF_VERSION` / `PFEngine.VERSION` in `js/pf/pf-config.js` |
| PhysicsEngine3D (3D core) | 1.0.0 | `VERSION` in `js/engine/physics-engine-3d.js` |
| Matter.js (vendored) | 0.20.0 | Read from `Matter.version` at runtime, never hard-coded |

**App language**: MotionLab 1.24 added a Chinese / English UI switch. On a
first visit the UI is English and the welcome page guides the visitor to pick
a language; the choice persists in localStorage (`motionlab.lang`) and can be
changed anytime in Settings. Strings live in `js/i18n.js`.

---

## 1. PhysicsEngine (2D physics core)

A project-agnostic wrapper around Matter.js: host projects never touch
Matter internals, only plain data descriptors and the public API.
File: `js/engine/physics-engine.js` (see the standalone package / skill notes
in this repository for the packaged form).

### Loading

In the browser (global Matter + module import):

```html
<script src="vendor/matter.min.js"></script>
<script type="module">
  import { PhysicsEngine, VERSION } from './js/engine/physics-engine.js';
  console.log(VERSION); // '1.12.3'
</script>
```

In Node / tests: put Matter on the global first, or inject it explicitly with
`PhysicsEngine.setMatter(Matter)`; `new PhysicsEngine({ matter })` also works.

### Quick start

```js
const pe = new PhysicsEngine({ enableSleeping: true }); // options below
pe.setGravity(0, 1);

const ball = pe.addBody({ kind: 'circle', x: 120, y: 60, radius: 22, restitution: 0.6 });
pe.addBody({ kind: 'rect', x: 120, y: 320, width: 420, height: 20, isStatic: true, label: 'ground' });

// Spring: bodyA null anchors the constraint to a fixed world point
pe.addConstraint({ bodyA: null, pointA: { x: 120, y: 20 }, bodyB: pe.idOf(ball), stiffness: 0.02, damping: 0.05 });

function frame(elapsedMs) {
  const steps = pe.advance(elapsedMs, 1); // fixed-step accumulator; returns steps run this frame
  for (const b of pe.allBodies()) draw(b); // the host renders
}
```

Constructor options: `gravity {x,y}`, `enableSleeping`, `fixedDt`
(default 1000/60 ms), `maxSteps` (default 5, spiral-of-death guard),
`substeps` (1–8, anti-tunnelling; MotionLab uses 2), `matter` (an injected
Matter module).

### Body descriptors (addBody)

`{ id?, kind: 'circle'|'rect'|'polygon', x, y, angle (radians), width, height,
radius, sides, density, friction, frictionAir, restitution, isStatic,
lockRotation, vx, vy, label, userData }` — all serializable. `describeBody(body)`
reads back live state (including mass); `snapshot()` / `load(data)` save and
restore the whole world.

### API at a glance

| Area | Methods |
|---|---|
| Bodies | `addBody / removeBody / clear / bodyById / allBodies / forEachBody / count / pick(x,y) / describeBody / idOf / kindOf / userDataOf` |
| Constraints | `addConstraint / removeConstraint / constraintCount / describeConstraints / constraintSegments(out?)` |
| Stepping | `advance(ms, speed) / stepOnce() / step(dtMs, speed) / setSubsteps(n)` |
| Properties | `setVelocity / setPosition / setAngleDeg / setDensity / setMass / setFriction / setFrictionAir / setRestitution / setStatic / setLockRotation / stopMotion / resize(body, patch) / wake(body)` |
| Dragging | `beginDrag(body,x,y) / moveDrag(x,y) / endDrag()` (a real physics constraint — bodies can be thrown) |
| Queries (added 1.2.0) | `queryRegion(x,y,w,h)` AABB region query; `raycast(x1,y1,x2,y2)` ray hits (nearest → farthest, with hit points and distances) |
| Impulses (added 1.2.0) | `addVelocity(body, dvx, dvy)`; `applyRadialImpulse(cx, cy, { radius, base, power, filter })` radial impulse (magnitude = base + power×(1 − distance/radius), returns how many bodies were affected) |
| Snapshots | `snapshot() / load(data)` |
| Events | `onCollision((bodyA, bodyB, pair) => …)`; `pe.onChange` structural-change callback |
| Seeded RNG (added 1.3.0) | `new PhysicsEngine({ seed })`, `pe.seed` (read the seed back), `setSeed(n)`, `random()`, `randomRange(min, max)`, `randomInt(min, max)`, `choice(arr)`, `shuffle(arr)` |
| Naming (added 1.4.0) | descriptor `name` field, `nameOf(body)`, `getBodyByName(name)`, `getBodiesByName(name)`, `renameBody(bodyOrId, name)` |
| Gravitation (added 1.4.0) | `setGravitation(G, { softening })`, `gravitation` (read the config), `setGravitation(0)` to disable |
| Fluids (added 1.4.0; coupling 1.9.0; preconditions 1.10.0) | `addFluid({ id?, x, y, width, height, density, drag, vx, vy })`, `removeFluid(id)`, `fluids()`, `fluidById(id)`, `fluidCount`, `fluidFlow(id)` |
| Magnetism (added 1.5.0) | descriptor field `magnet` (−100..100), `setMagnetism(K, { range, softening })`, `magnetism`, `setMagnet(body, v)`, `magnetOf(body)`, `magnetCount` |
| Wind fields (added 1.5.0; gusts 1.8.0) | `addWind({ id?, x, y, width, height, vx, vy, power, gust, gustPeriod })`, `removeWind(id)`, `winds()`, `windById(id)`, `windCount`, `simTime` |
| Hinges & motors (added 1.7.0) | `addHinge({ id?, bodyA, bodyB, pointA, pointB, motorSpeed, motorPower })`, `removeHinge(id)`, `hingeById(id)`, `describeHinges()`, `hingeCount`, `hingeAnchors()`, `setHingeMotor(id, v)` |
| Formulas & measurement (added 1.4.0) | `Formulas.*` (pure functions, below), `bodyKineticEnergy(body)`, `totalKineticEnergy()`, `bodyMomentum(body)`, `totalMomentum()`, `centerOfMass()` |
| Stability (added 1.4.0) | `PhysicsEngine.validateDescriptor(desc)`, `findNonFiniteBodies()`, `{ maxSpeed }` / `setMaxSpeed(v)` |

Coordinate system: pixels, y grows downward; angles are radians (except
`setAngleDeg`). Constraint descriptor endpoints are **`bodyA` / `bodyB`**
(id strings; `bodyA: null` means a world anchor whose coordinates come from
`pointA`).

### The backend interface (1.11.0)

Behind the public API sits a pluggable solver "backend". The registry is
the single source of truth: the module exports `BACKENDS` (also
`PhysicsEngine.BACKENDS`), each entry carrying
`id / name / status ('active' | 'experimental' | 'planned') / since / summary`:

| id | Name | Status |
| --- | --- | --- |
| `matter` | Matter.js | active (the default, since 1.0.0) |
| `native` | Native (self-developed) | experimental (since 1.12.0) |

- Construct through the registry: `PhysicsEngine.create({ backend: 'matter' })` (omitting `backend` means matter); `new PhysicsEngine()` is equivalent. `create({ backend: 'native' })` returns the self-developed engine (class `NativeEngine` in `native-engine.js`).
- Every instance reports its solver as `backendId`.
- 'active' and 'experimental' backends construct normally (hosts should label experimental ones as such); asking for a planned or unknown backend **throws** (the message states the status) — there is no silent fallback: swapping solvers changes simulation results, and the host must know.
- The backend contract: a backend implements this class's full public surface (body / constraint / hinge management, fluid / wind / magnet regions, fixed-timestep `advance`, snapshots, spatial queries, the seeded RNG). Hosts code against that API only, never against backend internals — MotionLab 1.41 wires it exactly this way: the Settings backend picker rebuilds the world on the chosen solver and replays the current scene, with zero host-code changes.
- Native solver notes (1.12.0): sequential impulses with warm starting, SAT + reference-face clipping contacts, sleeping; force models and motors kick once per fixed step (independent of the substep count); the substep count floors at 2 (tall stacks are under-damped at 1); known limits: a 10-high single-column tower still topples, and position correction is linear-only. Its behaviour suite is `tests/native-tests.mjs`.
- **Host contract (1.12.1)**: every body — circles included — must expose a non-empty `vertices` polygon that tracks its pose; hosts draw every body through its vertices. Native circles shipped with empty vertices in 1.12.0, which left the live canvas showing only the grid while physics ran fine (the engine suite never renders, and the app smoke never rendered under Native — both missed it); MotionLab guards the line with the app-level `tests/native-render.mjs`.
- **Native robustness (1.12.2)**: reference-face clipping tolerates degenerate 0/1-point segments (exactly-aligned stacks used to crash large scenes mid-run); sleeping uses a smoothed motion metric with remembered support; warm-start impulses apply on the first substep only (re-applying them leaked energy scaled by the substep count).
- **Orphan-sleeper wake (1.12.3, both backends)**: sleepers ignore gravity, so without a support re-check, deleting a tower's base or dragging a support away left everything above hovering forever. Both backends now run a support probe (`_wakeOrphans`) every 15 fixed steps: a sleeping dynamic body with no support left is woken. Support means a touching chain (bounds grown by 3 px) reaching a non-sleeping body (statics count as anchors — note that Matter marks static bodies as sleeping too), an attachment to a constraint/hinge, or an overlap with a fluid region; zero/disabled gravity opts out.

### Seeded RNG (1.3.0)

The engine carries its own mulberry32 stream (per instance, unrelated to
`Math.random`). Passing `{ seed }` to the constructor yields a
**reproducible** sequence — the same seed produces the same `random()`
results, which suits procedural scene generation, spawn jitter, random
impulses and any "send a seed, replay the run" scenario. Without a seed the
engine picks one at random; read it back from `pe.seed` to record it.
`setSeed(n)` resets the sequence at any time and syncs Matter's
`Common._seed`. `snapshot()` carries the RNG state, so after `load()` the
stream continues exactly where the snapshot left off.

### Named bodies (1.4.0)

Descriptors may carry `name` (a string; duplicates allowed — a scene may hold
dozens of `peg`s). `getBodyByName` returns the first match,
`getBodiesByName` returns all of them (insertion order), and `renameBody`
accepts a body or an id. Names are saved by `snapshot()` and restored by
`load()`. In MotionLab, a body's label *is* its engine name.

### Pairwise gravitation (1.4.0)

`setGravitation(G, { softening = 100 })` turns on attraction between every
pair of bodies: each dynamic body receives a velocity kick of
`a = Σ G·m_j·d / (|d|² + softening)^1.5` once per fixed step (independent of
substeps). Static bodies attract but never move; their mass is computed as
**area × descriptor density** (a static body's `density` in Matter is
Infinity and cannot be used directly). Total momentum is conserved.
Complexity is O(n²) per step — suited to orbital/planetary simulations with
dozens of bodies. Use `Formulas.orbitVelocity(G, M, r)` for a near-circular
starting orbit (see `examples/orbit.html`).

### Fluid regions & buoyancy (1.4.0)

`addFluid({ x, y, width, height, density = 0.0012, drag = 0.02, vx = 0, vy = 0 })`:
(x, y) is the region's **center**; its top edge is the surface. When a dynamic
body overlaps the region, buoyancy is applied through Matter's force channel,
mirroring world gravity and scaled by
`(fluid density / body density) × submerged fraction` — fully submerged at
equal density means neutral buoyancy. `drag` is the per-substep velocity
retention decay while submerged. Buoyancy only applies while world gravity
is non-zero. Snapshots carry a `fluids` array. Since 1.10.0, buoyancy
obeys its preconditions: the submerged fraction is the TRUE clipped
area (part polygons clipped to the fluid rectangle — straddling counts
only what is in; circles and rotated bodies use their real shape), the
force acts at the centre of buoyancy (the submerged centroid — tilted
floaters right themselves or capsize), and an underside sealed against
another body (three-point sampling) fades buoyancy out and, with the
top face submerged, adds the fluid column's downward pressure — a
light block flush on the tank floor does not float up on its own.

### Magnetism (1.5.0)

The descriptor field `magnet` is a signed pole strength (−100..100;
positive = N pole, negative = S pole). Two magnetic bodies interact with
`F = K · s1 · s2 / (d² + ε²)`: same signs repel, opposite signs attract
(this is `Formulas.magneticForce`). A magnetic body also attracts
unmagnetised dynamic bodies ("iron") with an effective strength of 35.
Like gravitation, magnetism is applied as a velocity kick once per fixed
step; the kick on each side is force ÷ that body's mass, so total momentum
is conserved and lighter bodies react more; each kick is capped at
0.8 px/step. Unlike gravitation, magnetism is short-ranged: pairs beyond
`range` (default 320) feel nothing, and a uniform grid keeps the cost
local. Tune globally with `setMagnetism(K, { range, softening })`,
`setMagnetism(0)` disables it; change one body with `setMagnet(body, v)`.

### Wind regions (1.5.0)

`addWind({ x, y, width, height, vx = 3, vy = 0, power = 1 })`: (x, y) is
the region's **center**; (vx, vy) is the wind velocity in px/step. A
dynamic body overlapping the region has its velocity blended toward the
wind velocity every substep, at a rate ∝ overlap-area fraction × `power`
× (0.0012 ÷ body density): light bodies quickly reach wind speed while
dense blocks barely stir — the gaseous counterpart of fluids. Snapshots
carry a `winds` array.

### Hinges & motors (1.7.0)

`addHinge({ bodyA, bodyB, pointA, pointB, motorSpeed = 0, motorPower = 0.0025 })`
pins two bodies at one shared point so they can only rotate around it
(a rigid zero-length constraint, the same mechanism as the Newton's
cradle rods); with `bodyA: null`, pointA is a fixed world mount.
`motorSpeed` is the motor's target **relative angular velocity**
(rad/step, ±0.3, positive = clockwise), approached with a per-step
acceleration cap of `motorPower`; when both ends are dynamic the
reaction is split by inverse inertia, so momentum stays honest.
Motor-driven bodies never fall asleep (sleeping zeroes velocity and
would fight the drive every step). **Collision groups:** each
hinge-connected cluster shares a negative Matter collision group —
parts of one machine never collide with each other and can swing
through one another, otherwise two end-pinned bars jam on their own
corners after a few degrees; collisions with everything outside the
machine are unaffected. Hinges persist in snapshots (a `hinges`
array) and are cleaned up when a body is removed; `hingeAnchors()`
returns resolved world pin points for rendering and picking.

### The Formulas library (1.4.0)

`import { Formulas } from '.../physics-engine.js'` (or
`PhysicsEngine.Formulas`). All pure functions, in engine units (px, px/step):

| Formula | Function |
|---|---|
| Kinetic / rotational energy | `kineticEnergy(m, vx, vy)` / `rotationalEnergy(I, ω)` |
| Momentum / impulse for Δv | `momentum(m, vx, vy)` / `impulseForDeltaV(m, dvx, dvy)` |
| Gravitational force | `gravitationalForce(G, m1, m2, r)` |
| Magnetic pole force (signed, 1.5.0) | `magneticForce(K, s1, s2, d², ε²)` (positive = repel, negative = attract) |
| Orbital / escape velocity | `orbitVelocity(G, M, r)` / `escapeVelocity(G, M, r)` |
| Hooke's law / spring energy | `springForce(k, x)` / `springEnergy(k, x)` |
| Pendulum period | `pendulumPeriod(L, g)` |
| Archimedean buoyancy (2D) | `buoyancyForce(ρ, submergedArea, g)` |
| Quadratic drag / max static friction | `dragForce(c, v)` / `frictionForce(μ, N)` |
| Projectile range / centripetal acceleration / potential energy | `projectileRange(v, θ, g)` / `centripetalAcceleration(v, r)` / `potentialEnergy(m, g, h)` |

Combined with the instance measurements (`totalMomentum()`, `centerOfMass()`,
…) you can verify conservation laws directly.

### Stability & validation (1.4.0)

- `PhysicsEngine.validateDescriptor(desc)` statically validates a descriptor
  and returns a list of problems (it never throws); `addBody` itself stays
  lenient (bad values fall back to defaults), so importers can use the
  validator as a strict gate.
- Position/velocity/angle setters and `addVelocity` **ignore non-finite
  input**, so a NaN can never poison the world; `findNonFiniteBodies()`
  audits world health.
- `{ maxSpeed }` (or `setMaxSpeed(v)`) caps velocity (px/step, 0 = off). The
  cap runs before the solver, so a runaway impulse can't eject a body from
  the world.
- `load()` skips non-object entries and returns `{ bodies, constraints, fluids, winds, hinges }`
  load counts.

### Version history

- 1.0.0 — extracted from MotionLab as a general-purpose core
- 1.1.0 — `substeps` anti-tunnelling
- 1.2.0 — spatial queries (`queryRegion` / `raycast`), impulse helpers
  (`addVelocity` / `applyRadialImpulse`), zero-allocation `pick()` optimization
- 1.3.0 — seeded RNG (`seed` option, the `random` API family, RNG state in snapshots)
- 1.4.0 — named bodies, pairwise gravitation, fluid buoyancy, the Formulas
  library, stability hardening (validation / non-finite guards / speed cap)
- 1.5.0 — magnetism (the `magnet` descriptor field, pole attraction /
  repulsion, iron attraction, range culling), wind regions (`addWind`),
  and a faster pairwise-force pass (one unified traversal, typed-array
  hoisting, symmetric gravitation pairs — ≈40% faster on an isolated
  150-body benchmark)
- 1.5.1 — magnetism fix: a pole pair involving a static magnet was
  skipped by the pair dedup when the dynamic pole had been added first;
  the dedup now only applies when the earlier pass can actually run,
  so pole pairs no longer depend on insertion order
- 1.6.0 — performance pass (no behaviour change): zero-allocation
  pairwise-force channel (reused typed buffers, cached magnet list /
  body index, numeric-keyed pooled grid); gravitation split into a
  symmetric dynamic–dynamic loop plus a one-way dynamic–static loop,
  so static–static pairs are never evaluated (static-heavy worlds:
  pair pass ≈40% faster); fluids skip sleeping bodies,
  constraintSegments is pooled, and allocation-free forEachFluid /
  forEachWind iterators were added
- 1.7.0 — machinery: hinges (addHinge, rotation about a shared pin)
  and motors (target relative angular velocity, acceleration cap,
  reaction split by inverse inertia, driven bodies never sleep);
  hinge clusters share a negative collision group (parts of one
  machine never collide); hingeAnchors for rendering/picking;
  hinges persist in snapshots
- 1.7.1 — solver: default constraintIterations raised 2 -> 4 (override
  with the `constraintIterations` constructor option). Simultaneous
  rigid constraints (hinge clusters, triangulated crosses) left
  multi-pixel anchor errors at 2 iterations (ferris wheel: 28px hub
  drift, 5.6° cross error); at 4 the same machine holds its hub
  exactly and its cross angle to <1°
- 1.8.0 — wind gusts: regions gain gust (0..0.9) and gustPeriod
  (2..30 s); the effective velocity breathes as
  (1 + gust * sin(2π * t / period)) on the engine's simulated-time
  clock — all regions in phase, like one weather system. The clock
  rides snapshots (simMs), so the gust phase survives load();
  gust = 0 is bit-identical to the old behaviour
- 1.10.0 — buoyancy preconditions: true submerged area (polygon
  clipping), force applied at the centre of buoyancy, underside-seal
  detection (buoyancy fades with the sealed fraction, plus the fluid
  column's downward pressure); drag scales with the true area
- 1.9.0 — module coupling: fluid drag also bleeds angular velocity
  (2.5x coefficient — rotors and paddles are genuinely braked by
  water; the pinwheel with default added water slows ~23%, vs ~11%
  before, where the gust cycle masked it); fluids gain a flow
  velocity (vx, vy) and drag blends toward the effective flow; a
  wind region overlapping a fluid drives a surface current
  (gust-adjusted wind x 40% x power x horizontal overlap), readable
  via fluidFlow(id); fluid drag/flow no longer switch off in
  zero-gravity worlds (only buoyancy needs gravity)
- 1.11.0 — backend interface formalised: the `BACKENDS` registry
  (matter active / native self-developed, planned for 1.41),
  `PhysicsEngine.create({ backend })` constructing through it, and
  `backendId` on every instance; unavailable backends throw plainly
  instead of falling back silently; simulation behaviour unchanged
- 1.12.0 — the self-developed Native backend lands (experimental):
  `create({ backend: 'native' })` constructs it directly; a
  from-scratch sequential-impulse solver covering the full public
  surface (stacking / sleeping / hinge motors / true buoyancy /
  magnetism / gravitation / gusts / snapshots / seeded RNG), force
  models kicking once per fixed step and a substep floor of 2; its
  own 43-check behaviour suite (tests/native-tests.mjs)
- 1.12.6 — snapshot-fidelity fix: `describeBody` now carries `va` (angular velocity) and `sleeping`, and `addBody` restores both on both backends — previously a snapshot restore silently zeroed spin and woke every sleeper, so a replay recorded after warm-up diverged from its own run (Newton's cradle: >14 px measured). Solver behaviour unchanged; 5 new fidelity checks per backend suite.
- 1.12.5 — performance pass (behaviour unchanged): the orphan-sleeper probe (both backends) now finds candidate pairs through a uniform grid instead of O(sleepers x bodies) scans (~31% of all step time at ~800 bodies); Native gets numeric contact-sort / warm-start keys, shared solver scratch vectors, stamp-based support marking, and shape sync that skips sleeping bodies.
- 1.12.4 — dual-engine API parity: Native gains `wake` / `setMaxSpeed` / `maxSpeed` / `clearFluids` / `clearWinds` / `dragBody`, and `dragging` is boolean on both backends; new parity and framed-world regression tests; solver behaviour unchanged.
- 1.12.3 — orphan-sleeper wake (both backends): a support probe every 15 steps wakes sleepers whose support is gone (deleting a tower base or dragging a support away no longer leaves bodies hovering); support = touching chain to a non-sleeping body, constraint/hinge attachment, or fluid overlap; zero gravity opts out.
- 1.12.2 — Native robustness: reference-face clipping no longer crashes on exactly-aligned stacks (the stress scene used to freeze mid-run); sleeping uses smoothed motion with remembered support (dense piles: 72 → 163 of 705 asleep); warm-start impulses apply on the first substep only (re-applying them leaked energy scaled by the substep count)
- 1.12.1 — Native host-contract fix: circle bodies now expose a
  `vertices` polygon approximation (10–25 sides, as Matter does) —
  hosts draw every body through its vertex path, and 1.12.0's empty
  circle vertices left the canvas showing only the grid. No solver
  behaviour changes. **Contract addition: every body, circles
  included, must expose non-empty `vertices` that track its pose.**

---

### The MotionLab scene file format (host format; import hardening in 1.39)

The engine itself knows no file format. The MotionLab host's scene JSON is
`{ format: 'motionlab-scene', version: 2, name, settings, bodies, constraints, hinges, fluids, winds }`
(version 1 files still import). Imports — including the decompressed size
of share links — are capped at **2 MB**; budgets: bodies ≤ 2000,
constraints ≤ 500, hinges ≤ 500, fluids/winds ≤ 20 each. `validateScene`
(`js/scene.js`) audits every field: coordinates must be finite with
|value| ≤ 100000, width/height ∈ (0, 5000], radius ∈ (0, 2500], sides an
integer 3–64, restitution 0–2, scene name ≤ 128 chars, body labels ≤ 64;
constraint/hinge endpoints must reference existing bodies. Oversize or
invalid files are rejected whole with a stated reason, and the current
scene is left untouched. Exports and share links pass the same validation.

## 2. The PF engine (platform-fighter module set)

The PF engine is a platform-fighter foundation layered on PhysicsEngine: a
character controller (ground probes, coyote time, jump buffering, double
jump, dash, hitstun), a combat system (startup/active/recovery phases, a
separate hitbox, damage-scaled knockback, one hit per attack), a
deterministic AI state machine (idle/approach/attack/retreat/recover),
one-way platforms and blast-zone detection. The modules live in `js/pf/`:
`pf-config` (parameters & version), `pf-stage` (stage data), `pf-physics`
(the only engine adapter), `pf-character`, `pf-combat`, `pf-ai`,
`pf-renderer`, `pf-input`, `pf-lab` (match logic + UI shell + the `PFEngine`
facade). Game logic only ever calls PhysicsEngine's public API through the
adapter — it never touches Matter.

### Option A: the PFEngine facade (recommended)

```js
import { PFEngine } from './js/pf/pf-lab.js';

PFEngine.VERSION; // '1.1.0'

// 1) Headless match (no DOM — for tools, tests, server-side simulation)
const match = PFEngine.createMatch({ ai: 'normal' }); // ai: 'calm'|'normal'|'sharp' or an overrides object
const idle = { move: 0, jump: false, attack: false, dash: false };
for (let i = 0; i < 600; i++) {
  const events = match.step({ move: 1, jump: false, attack: false, dash: false });
  // events: hit and KO events; match.state: 'fight'|'over'; match.winner: 'player'|'dummy'|'draw'
}
console.log(match.debugInfo()); // both fighters' state/damage/velocity/position, AI state, step count, last hit

// 2) Full UI shell (full-screen overlay: canvas, debug panel, touch buttons) —
//    the page must contain index.html's #pfLab markup (or use the MotionLab page whole)
const lab = PFEngine.createLab(() => { /* called on exit */ });
lab.enter();   // open and start a match
lab.exit();    // exit: releases listeners, the loop and the physics world

// 3) Tuning (applies to the shared tables; affects matches created afterwards)
PFEngine.tune({ attack: { damage: 9 }, ai: { decideEvery: 8 } });
PFEngine.config.ATTACK.baseKnockback; // read current parameters
PFEngine.stage.PLATFORMS;              // stage platform data
```

### Option B: use the classes directly

```js
import { PFMatch, PFLab } from './js/pf/pf-lab.js';
import { FighterAI } from './js/pf/pf-ai.js';
import { PF_VERSION } from './js/pf/pf-config.js';

const m = new PFMatch({ ai: { decideEvery: 14 } }); // call m.step(intent) per step
m.reset();                                          // restart with the same configuration
```

### The intent interface

Player and AI share one input shape — AI output is exactly isomorphic to
player input:

```js
{ move: -1|0|1, jump: bool, attack: bool, dash: bool, face: -1|0|1 }
```

`jump/attack/dash` are edge-triggered (true on the step they are pressed);
`face: 0` means "keep the current facing".

### AI profiles

| Profile | decideEvery | attackCooldown | Notes |
|---|---|---|---|
| `calm` | 16 | 48 | Slow reactions, long gaps between attacks |
| `normal` | 10 | 30 | The default (the `AI` table itself) |
| `sharp` | 6 | 18 | Fast reactions, relentless pressure |

You may also pass any overrides object, e.g. `{ decideEvery: 12, retreatDamage: 50 }`;
it is merged over the defaults and affects only that AI instance.

### Main parameters (pf-config.js)

`FIGHTER` (speed / jump / dash / hitstun), `ATTACK` (the three phase lengths,
damage 7, knockback 3.4 + 0.075 × damage%), `AI` (decision interval, ranges,
retreat threshold), `BLAST` (blast-zone bounds), `WORLD` (960×540,
gravityY 2.0, substeps 2). Stepping is fixed at 60 steps/second, with
rendering decoupled from logic.

---

## 3. PhysicsEngine3D (3D core)

File `js/engine/physics-engine-3d.js` (driven by cannon-es, `VERSION` 1.0.0),
with the same descriptor/snapshot design as the 2D core; friction and
restitution are world-level settings. MotionLab's 3D lab UI has been hidden
since v1.8 (`FEATURE_3D = false` plus the `body.no-3d` structural guards);
the code and stored 3D scene data remain, and the core itself is still
usable on its own from the standalone package.

## 4. About Matter.js

`vendor/matter.min.js` is the vendored **Matter.js 0.20.0** (upgraded from
0.19.0 in 2026-11; adopted only after the full test suite passed against it
with no assertion relaxed). The app reads the actually-loaded
`Matter.version` at runtime for display instead of hard-coding it. Upgrade
policy: run the complete engine/logic/PF/UI suites against a copy first, and
swap the vendored file only when everything passes with no weakened
assertions.

## 5. Local development & tests

```bash
python3 -m http.server 8000        # local preview at http://localhost:8000
node tests/engine-tests.mjs        # PhysicsEngine core (140 checks)
node tests/native-tests.mjs        # Native backend behaviour (53)
node tests/native-render.mjs       # real-app rendering under Native + zero window errors (7)
node tests/run-tests.mjs           # scenes / logic (160)
node tests/smoke.mjs               # app smoke (91)
node tests/nav-smoke.mjs           # home-hub / navigation smoke (39)
node tests/landing-smoke.mjs       # landing smoke (18)
node --expose-gc tests/soak.mjs    # memory soak (17; omitting --expose-gc false-reports heap growth)
node tests/render-tests.mjs        # renderer caches (10)
node tests/pf-smoke.mjs            # PF engine logic (27)
node tests/pf-ui-smoke.mjs         # PF UI smoke (10)
node tests/engine3d-tests.mjs      # 3D core (22)
node tests/lab3d-smoke.mjs         # 3D lab smoke (13)
# 607 checks total (as of MotionLab 1.44 / PhysicsEngine 1.12.3)
```

Releases are pushed as static files straight to GitHub Pages; `version.json`
and the entry assets' `?v=` parameters move with each version, and the app
shows an in-page notice when a newer version is available.
