/**
 * PhysicsEngine — TypeScript type declarations.
 *
 * Hand-written declarations for the plain-JS engine in `physics-engine.js`
 * (and the Native backend in `native-engine.js`). No build step is required
 * at runtime; this file only gives editors and `tsc` the public API shape.
 * The runtime exports are the source of truth — if a signature here and the
 * implementation ever disagree, the implementation wins.
 */

export interface Vec {
  x: number;
  y: number;
}

export type BodyKind = 'circle' | 'rect' | 'polygon';

/** Plain-data description of a body to create (see `addBody`). */
export interface BodyDescriptor {
  /** Stable string id; auto-assigned when omitted. */
  id?: string;
  kind: BodyKind;
  x: number;
  y: number;
  /** Degrees. */
  angle?: number;
  /** rect / polygon width (px). */
  width?: number;
  /** rect / polygon height (px). */
  height?: number;
  /** circle radius (px). */
  radius?: number;
  /** polygon sides (3–64, default 5). */
  sides?: number;
  /** Default 0.001; the engine clamps to ≥ 0.00001. */
  density?: number;
  friction?: number;
  frictionAir?: number;
  frictionStatic?: number;
  /** 0–2. */
  restitution?: number;
  isStatic?: boolean;
  lockRotation?: boolean;
  /** Initial velocity (px per fixed step). */
  vx?: number;
  vy?: number;
  /** Display name; look bodies up with `getBodyByName`. */
  name?: string;
  /** Signed magnet strength; 0 / undefined = unmagnetised. */
  magnet?: number;
  /** Host-owned data, carried through snapshots untouched. */
  userData?: unknown;
  [key: string]: unknown;
}

/**
 * A live body inside the engine. Field-for-field compatible across the
 * Matter and Native backends; every body — circles included — exposes a
 * non-empty `vertices` polygon so hosts can draw through it.
 */
export interface Body {
  position: Vec;
  velocity: Vec;
  /** Radians. */
  angle: number;
  angularVelocity: number;
  isStatic: boolean;
  isSleeping: boolean;
  mass: number;
  bounds: { min: Vec; max: Vec };
  vertices: Vec[];
  /** Present on circles. */
  circleRadius?: number;
  plugin: { pe: { id: string; kind: BodyKind; desc: BodyDescriptor } };
  [key: string]: unknown;
}

export interface ConstraintDescriptor {
  id?: string;
  /** Body id, or null for a fixed world anchor. */
  bodyA?: string | null;
  bodyB: string;
  /** Local offset on A (world point when bodyA is null). */
  pointA?: Vec;
  /** Local offset on B. */
  pointB?: Vec;
  /** 0–1; ≥ 0.9 renders/acts as a rigid rod. */
  stiffness?: number;
  damping?: number;
  /** Rest length (px); defaults to the current distance. */
  length?: number;
  [key: string]: unknown;
}

export interface Constraint extends ConstraintDescriptor {
  id: string;
  bodyB: string;
}

export interface HingeDescriptor {
  id?: string;
  bodyA?: string | null;
  bodyB: string;
  pointA?: Vec;
  pointB?: Vec;
  /** Motor target angular-velocity difference (rad/step); 0 = free hinge. */
  motorSpeed?: number;
  motorPower?: number;
  [key: string]: unknown;
}

export interface Hinge extends HingeDescriptor {
  id: string;
  bodyB: string;
}

export interface FluidDescriptor {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Relative to body density; water ≈ 1. */
  density?: number;
  drag?: number;
  /** Surface/current flow velocity (px/step). */
  vx?: number;
  vy?: number;
  [key: string]: unknown;
}

export interface Fluid extends FluidDescriptor {
  id: string;
}

export interface WindDescriptor {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Target air velocity (px/step). */
  vx?: number;
  vy?: number;
  /** 0–2 multiplier. */
  power?: number;
  /** Gust amplitude 0–1; 0 = steady wind. */
  gust?: number;
  /** Gust period in simulated seconds. */
  gustPeriod?: number;
  [key: string]: unknown;
}

export interface Wind extends WindDescriptor {
  id: string;
}

export interface EngineOptions {
  /** Backend id: 'matter' (default) or 'native'. */
  backend?: string;
  /** Matter.js module; required for the matter backend outside MotionLab. */
  matter?: unknown;
  enableSleeping?: boolean;
  /** Fixed timestep in ms (default 1000/60). */
  fixedDt?: number;
  /** Anti death-spiral cap per advance (default 5). */
  maxSteps?: number;
  /** Engine updates per fixed step (default 1; MotionLab uses 2). */
  substeps?: number;
  gravity?: { x?: number; y?: number; enabled?: boolean };
  /** uint32 seed for the reproducible random stream. */
  seed?: number;
  /** Speed safety clamp (px/step); ≤ 0 disables. */
  maxSpeed?: number;
  /** Pairwise gravitation constant; 0 = off. */
  gravitation?: number;
  /** Magnetism constant; 0 = off. */
  magnetism?: number;
  constraintIterations?: number;
}

/** A full, JSON-serialisable engine state (see `snapshot` / `load`). */
export interface EngineSnapshot {
  bodies: BodyDescriptor[];
  constraints: ConstraintDescriptor[];
  hinges: HingeDescriptor[];
  fluids: FluidDescriptor[];
  winds: WindDescriptor[];
  gravity: { x: number; y: number; enabled: boolean };
  gravitation: number;
  magnetism: number;
  seed: number;
  /** RNG stream position — restoring it keeps replays deterministic. */
  rng: number;
  simMs: number;
  [key: string]: unknown;
}

export interface BackendInfo {
  id: string;
  name: string;
  status: 'active' | 'experimental' | 'planned';
  /** Engine version that introduced the backend. */
  since: string;
  summary: string;
}

export interface RayHit {
  body: Body;
  point: Vec;
  normal: Vec;
  /** 0–1 along the segment. */
  fraction: number;
}

export declare const BODY_KINDS: BodyKind[];
export declare const VERSION: string;
export declare const BACKENDS: BackendInfo[];

/** Pure physics formulas — the same math the engine's force passes apply. */
export declare const Formulas: {
  kineticEnergy(mass: number, vx: number, vy: number): number;
  rotationalEnergy(inertia: number, angularVelocity: number): number;
  momentum(mass: number, vx: number, vy: number): Vec;
  impulseForDeltaV(mass: number, dvx: number, dvy: number): Vec;
  gravitationalForce(G: number, m1: number, m2: number, distance: number): number;
  magneticForce(K: number, s1: number, s2: number, distSq: number, softening: number): number;
  orbitVelocity(G: number, centralMass: number, radius: number): number;
  escapeVelocity(G: number, centralMass: number, radius: number): number;
  springForce(stiffness: number, displacement: number): number;
  springEnergy(stiffness: number, displacement: number): number;
  pendulumPeriod(length: number, gravity: number): number;
  buoyancyForce(fluidDensity: number, submergedArea: number, gravity: number): number;
  dragForce(coefficient: number, speed: number): number;
  frictionForce(mu: number, normalForce: number): number;
  projectileRange(speed: number, angleRad: number, gravity: number): number;
  centripetalAcceleration(speed: number, radius: number): number;
  potentialEnergy(mass: number, gravity: number, height: number): number;
};

export declare class PhysicsEngine {
  static readonly VERSION: string;
  static readonly BACKENDS: BackendInfo[];
  static readonly Formulas: typeof Formulas;
  /** Preferred constructor — validates the backend against the registry. */
  static create(opts?: EngineOptions): PhysicsEngine;
  /** Inject the Matter.js module (or call before constructing). */
  static setMatter(matter: unknown): void;
  /** Returns a list of problems with a descriptor ([] = valid). */
  static validateDescriptor(desc: BodyDescriptor): string[];

  constructor(opts?: EngineOptions);

  /** Backend this instance runs on ('matter' | 'native'). */
  readonly backendId: string;
  /** The underlying Matter engine (matter backend only). */
  readonly engine: unknown;

  // ----- counts & world state -----
  readonly count: number;
  readonly constraintCount: number;
  readonly hingeCount: number;
  readonly fluidCount: number;
  readonly windCount: number;
  readonly magnetCount: number;
  readonly gravity: { x: number; y: number; enabled: boolean; scale: number };
  readonly gravitation: number;
  readonly seed: number;
  /** Simulated milliseconds elapsed. */
  readonly simTime: number;
  readonly maxSpeed: number;
  readonly dragging: boolean;
  readonly dragBody: Body | null;

  // ----- stepping -----
  /** Advance by a wall-clock delta (ms) through the fixed-step accumulator. */
  advance(deltaMs: number): void;
  /** Run exactly `steps` fixed steps (default 1). */
  step(steps?: number): void;
  /** One fixed step; returns false while a sub-step batch is mid-flight. */
  stepOnce(): boolean;

  // ----- bodies -----
  addBody(desc: BodyDescriptor): Body | null;
  removeBody(id: string): boolean;
  bodyById(id: string): Body | null;
  idOf(body: Body): string | null;
  kindOf(body: Body): BodyKind | null;
  allBodies(): Body[];
  forEachBody(fn: (body: Body) => void): void;
  clear(): void;
  describeBody(body: Body): BodyDescriptor;
  renameBody(body: Body, name: string): void;
  nameOf(body: Body): string;
  getBodyByName(name: string): Body | null;
  getBodiesByName(name: string): Body[];
  userDataOf(body: Body): unknown;

  setPosition(body: Body, pos: Vec): void;
  setVelocity(body: Body, vel: Vec): void;
  addVelocity(body: Body, delta: Vec): void;
  setAngleDeg(body: Body, degrees: number): void;
  setStatic(body: Body, isStatic: boolean): void;
  setDensity(body: Body, density: number): void;
  setMass(body: Body, mass: number): void;
  setFriction(body: Body, friction: number): void;
  setFrictionAir(body: Body, frictionAir: number): void;
  setRestitution(body: Body, restitution: number): void;
  setLockRotation(body: Body, locked: boolean): void;
  /** Rebuild a body at a new size, keeping id and material. */
  resize(body: Body, size: { width?: number; height?: number; radius?: number }): Body | null;
  stopMotion(body: Body): void;
  wake(body: Body): void;
  /** Radial impulse centred at (x, y); returns how many bodies were hit. */
  applyRadialImpulse(x: number, y: number, radius: number, power: number): number;

  // ----- queries & readouts -----
  pick(x: number, y: number): Body | null;
  queryRegion(x: number, y: number, width: number, height: number): Body[];
  raycast(from: Vec, to: Vec): RayHit | null;
  centerOfMass(): Vec | null;
  bodyMomentum(body: Body): Vec;
  bodyKineticEnergy(body: Body): number;
  totalMomentum(): Vec;
  totalKineticEnergy(): number;
  findNonFiniteBodies(): Body[];

  // ----- constraints & hinges -----
  addConstraint(desc: ConstraintDescriptor): Constraint | null;
  removeConstraint(id: string): boolean;
  describeConstraints(): ConstraintDescriptor[];
  /** World-space segments for rendering, one per constraint. */
  constraintSegments(): { a: Vec; b: Vec; stiffness: number }[];
  addHinge(desc: HingeDescriptor): Hinge | null;
  removeHinge(id: string): boolean;
  hingeById(id: string): Hinge | null;
  describeHinges(): HingeDescriptor[];
  hingeAnchors(hinge: Hinge): { a: Vec; b: Vec };
  setHingeMotor(hinge: Hinge, speed: number, power?: number): void;

  // ----- world effects -----
  setGravity(x: number, y: number, enabled?: boolean): void;
  setGravitation(G: number): void;
  setMagnetism(K: number): void;
  setMagnet(body: Body, strength: number): void;
  magnetOf(body: Body): number;
  addFluid(desc: FluidDescriptor): Fluid | null;
  removeFluid(id: string): boolean;
  fluidById(id: string): Fluid | null;
  fluids(): Fluid[];
  forEachFluid(fn: (fluid: Fluid) => void): void;
  clearFluids(): void;
  /** Effective flow inside a fluid at time t (base flow + wind coupling). */
  fluidFlow(fluid: Fluid, t?: number): Vec;
  addWind(desc: WindDescriptor): Wind | null;
  removeWind(id: string): boolean;
  windById(id: string): Wind | null;
  winds(): Wind[];
  forEachWind(fn: (wind: Wind) => void): void;
  clearWinds(): void;

  // ----- drag (physics picking) -----
  beginDrag(x: number, y: number): Body | null;
  moveDrag(x: number, y: number): void;
  endDrag(): void;

  // ----- seeded random -----
  setSeed(seed: number): void;
  random(): number;
  randomRange(min: number, max: number): number;
  randomInt(min: number, max: number): number;
  choice<T>(items: readonly T[]): T;
  shuffle<T>(items: T[]): T[];

  // ----- misc -----
  setMaxSpeed(pxPerStep: number): void;
  setSubsteps(n: number): void;
  onCollision(cb: (pairs: unknown) => void): void;
  snapshot(): EngineSnapshot;
  load(snapshot: EngineSnapshot): void;
}

export default PhysicsEngine;
