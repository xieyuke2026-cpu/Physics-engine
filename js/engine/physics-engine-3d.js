/* physics-engine-3d.js — project-agnostic 3D physics core on top of cannon-es.
 *
 * Same spirit as physics-engine.js (2D): plain-data descriptors in and out,
 * the host project keeps its own scene format and maps to these descriptors.
 * No DOM, no renderer — pair it with any 3D view (three.js, Babylon, custom).
 *
 * Wiring: the cannon-es module is injected, because its location differs per
 * project:
 *   import * as CANNON from './cannon-es.js';
 *   import { PhysicsEngine3D, setCannonModule } from './physics-engine-3d.js';
 *   setCannonModule(CANNON);
 * (or set globalThis.CANNON).
 *
 * Units: 1 unit = 1 metre, gravity default -9.82 on Y.
 * Contact friction/restitution are world-level (cannon-es resolves contacts
 * per material pair); per-body values are intentionally not promised.
 */

let _cannon = null;
export function setCannonModule(m) { _cannon = m; }
function cannon() {
  if (_cannon) return _cannon;
  if (typeof globalThis !== 'undefined' && globalThis.CANNON) return globalThis.CANNON;
  throw new Error('PhysicsEngine3D: cannon-es module not set — call setCannonModule(CANNON) first');
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function vec3(v, fb = { x: 0, y: 0, z: 0 }) {
  return { x: num(v && v.x, fb.x), y: num(v && v.y, fb.y), z: num(v && v.z, fb.z) };
}

export class PhysicsEngine3D {
  constructor(opts = {}) {
    const C = cannon();
    this.C = C;
    this.world = new C.World({ gravity: new C.Vec3(0, -9.82, 0) });
    this.world.broadphase = new C.SAPBroadphase(this.world);
    this.world.allowSleep = opts.enableSleeping === true;
    this.world.solver.iterations = Math.max(1, Math.round(num(opts.iterations, 10)));
    this.material = new C.Material('pe3');
    this.world.addContactMaterial(new C.ContactMaterial(this.material, this.material, {
      friction: num(opts.friction, 0.4),
      restitution: num(opts.restitution, 0.2),
      contactEquationStiffness: 1e7,
    }));
    this.world.defaultContactMaterial.friction = num(opts.friction, 0.4);
    this.fixedDt = num(opts.fixedDt, 1000 / 60);
    this.maxSteps = Math.max(1, Math.round(num(opts.maxSteps, 5)));
    this._acc = 0;
    this._byId = new Map();
    this._bodiesCache = null;
    this._locked = new Set();
    this._seq = 1;
    this._drag = null;      // { constraint, jointBody }
    this.onChange = null;
    this._collisionCbs = [];
    if (opts.gravity) this.setGravity(opts.gravity.x, opts.gravity.y, opts.gravity.z, opts.gravity.enabled !== false);
  }

  /* ---------------- gravity & contact ---------------- */
  setGravity(x, y, z, enabled = true) {
    const g = enabled ? vec3({ x, y, z }, { x: 0, y: -9.82, z: 0 }) : { x: 0, y: 0, z: 0 };
    this.world.gravity.set(g.x, g.y, g.z);
  }
  get gravity() {
    const g = this.world.gravity;
    return { x: g.x, y: g.y, z: g.z };
  }
  setContact(friction, restitution) {
    const cm = this.world.contactmaterials[0];
    if (cm) { cm.friction = num(friction, cm.friction); cm.restitution = num(restitution, cm.restitution); }
    this.world.defaultContactMaterial.friction = num(friction, this.world.defaultContactMaterial.friction);
  }

  /* ---------------- bodies ---------------- */
  /**
   * desc: { id?, kind: 'box'|'sphere', x, y, z (or position {x,y,z}),
   *   sizeX, sizeY, sizeZ (box full extents), radius,
   *   mass (<=0 or isStatic => static), isStatic, vx, vy, vz,
   *   quaternion {x,y,z,w}?, euler {x,y,z}? (radians), lockRotation,
   *   linearDamping, angularDamping, label, userData }
   */
  addBody(partial = {}) {
    const C = this.C;
    const pos = partial.position ? vec3(partial.position) : vec3(partial);
    const desc = {
      id: typeof partial.id === 'string' && partial.id ? partial.id : `b3-${this._seq++}`,
      kind: partial.kind === 'sphere' ? 'sphere' : 'box',
      x: pos.x, y: pos.y, z: pos.z,
      sizeX: Math.max(0.05, num(partial.sizeX, 1)),
      sizeY: Math.max(0.05, num(partial.sizeY, 1)),
      sizeZ: Math.max(0.05, num(partial.sizeZ, 1)),
      radius: Math.max(0.05, num(partial.radius, 0.5)),
      isStatic: partial.isStatic === true || num(partial.mass, 1) <= 0,
      mass: 0,
      vx: num(partial.vx, 0), vy: num(partial.vy, 0), vz: num(partial.vz, 0),
      lockRotation: partial.lockRotation === true,
      linearDamping: Math.min(0.99, Math.max(0, num(partial.linearDamping, 0.01))),
      angularDamping: Math.min(0.99, Math.max(0, num(partial.angularDamping, 0.05))),
      label: typeof partial.label === 'string' ? partial.label : '',
      userData: partial.userData && typeof partial.userData === 'object' ? { ...partial.userData } : {},
    };
    desc.mass = desc.isStatic ? 0 : Math.max(0.01, num(partial.mass, 1));
    const shape = desc.kind === 'sphere'
      ? new C.Sphere(desc.radius)
      : new C.Box(new C.Vec3(desc.sizeX / 2, desc.sizeY / 2, desc.sizeZ / 2));
    const body = new C.Body({
      mass: desc.mass,
      type: desc.isStatic ? C.Body.STATIC : C.Body.DYNAMIC,
      shape,
      material: this.material,
      position: new C.Vec3(desc.x, desc.y, desc.z),
      linearDamping: desc.linearDamping,
      angularDamping: desc.angularDamping,
      allowSleep: this.world.allowSleep,
      sleepSpeedLimit: 0.25,
      sleepTimeLimit: 0.6,
    });
    if (partial.quaternion) {
      body.quaternion.set(num(partial.quaternion.x, 0), num(partial.quaternion.y, 0), num(partial.quaternion.z, 0), num(partial.quaternion.w, 1));
    } else if (partial.euler) {
      body.quaternion.setFromEuler(num(partial.euler.x, 0), num(partial.euler.y, 0), num(partial.euler.z, 0));
    }
    if (!desc.isStatic && (desc.vx || desc.vy || desc.vz)) body.velocity.set(desc.vx, desc.vy, desc.vz);
    if (desc.lockRotation && !desc.isStatic) {
      body.fixedRotation = true;
      body.updateMassProperties();
    }
    body.pe3 = { id: desc.id, desc };
    body.addEventListener('collide', (e) => {
      for (const cb of this._collisionCbs) cb(e.body, e.target, e.contact);
    });
    this.world.addBody(body);
    this._byId.set(desc.id, body);
    if (desc.lockRotation) this._locked.add(body);
    this._emitChange();
    return body;
  }

  removeBody(id) {
    const body = this._byId.get(id);
    if (!body) return false;
    if (this._drag && this._drag.constraint.bodyA === body) this.endDrag();
    this.world.removeBody(body);
    this._byId.delete(id);
    this._locked.delete(body);
    this._emitChange();
    return true;
  }

  clear() {
    this.endDrag();
    for (const b of this._byId.values()) this.world.removeBody(b);
    this._byId.clear();
    this._locked.clear();
    this._acc = 0;
    this._emitChange();
  }

  bodyById(id) { return this._byId.get(id) || null; }
  idOf(body) { return body && body.pe3 ? body.pe3.id : null; }
  userDataOf(body) { return body && body.pe3 ? body.pe3.desc.userData : {}; }
  _bodies() {
    if (!this._bodiesCache) this._bodiesCache = [...this._byId.values()];
    return this._bodiesCache;
  }
  allBodies() { return [...this._bodies()]; }
  forEachBody(fn) { for (const b of this._byId.values()) fn(b); }
  get count() { return this._byId.size; }

  /** Ray pick: returns the closest body along the ray, or null. */
  pick(origin, dir, maxDistance = 1000) {
    const C = this.C;
    const from = new C.Vec3(origin.x, origin.y, origin.z);
    const to = new C.Vec3(origin.x + dir.x * maxDistance, origin.y + dir.y * maxDistance, origin.z + dir.z * maxDistance);
    const ray = new C.Ray(from, to);
    const result = new C.RaycastResult();
    ray.intersectWorld(this.world, { mode: C.Ray.CLOSEST, result, skipBackfaces: true });
    return result.hasHit ? result.body : null;
  }

  describeBody(body) {
    const d = body.pe3.desc;
    return {
      ...d,
      userData: { ...d.userData },
      x: body.position.x, y: body.position.y, z: body.position.z,
      quaternion: { x: body.quaternion.x, y: body.quaternion.y, z: body.quaternion.z, w: body.quaternion.w },
      vx: body.velocity.x, vy: body.velocity.y, vz: body.velocity.z,
      mass: body.mass,
      isStatic: body.type === this.C.Body.STATIC,
      sleeping: body.sleepState === 2,
      speed: body.velocity.length(),
    };
  }

  /* ---------------- snapshot ---------------- */
  snapshot() {
    return {
      gravity: this.gravity,
      bodies: this.allBodies().map((b) => {
        const d = this.describeBody(b);
        delete d.sleeping; delete d.speed;
        return d;
      }),
    };
  }
  load(data = {}) {
    this.clear();
    if (data.gravity) this.setGravity(data.gravity.x, data.gravity.y, data.gravity.z, true);
    for (const d of data.bodies || []) this.addBody(d);
  }

  /* ---------------- stepping ---------------- */
  advance(elapsedMs, speed = 1) {
    this._acc = Math.min(this._acc + num(elapsedMs, 0) * num(speed, 1), 250 * Math.max(1, num(speed, 1)));
    let steps = 0;
    while (this._acc >= this.fixedDt && steps < this.maxSteps) {
      this._subStep(this.fixedDt / 1000);
      this._acc -= this.fixedDt;
      steps++;
    }
    if (steps === this.maxSteps) this._acc = 0;
    return steps;
  }
  stepOnce() { this._subStep(this.fixedDt / 1000); }
  step(dtMs, speed = 1) {
    const total = Math.min(num(dtMs, 0), 50) * num(speed, 1);
    const n = Math.max(1, Math.min(8, Math.ceil(total / this.fixedDt)));
    for (let i = 0; i < n; i++) this._subStep((total / n) / 1000);
  }
  _subStep(dtSeconds) {
    if (this._locked.size) {
      for (const b of this._locked) {
        if (b.type !== this.C.Body.STATIC && (b.angularVelocity.x || b.angularVelocity.y || b.angularVelocity.z)) {
          b.angularVelocity.set(0, 0, 0);
        }
      }
    }
    this.world.step(dtSeconds);
  }

  /* ---------------- setters ---------------- */
  wake(body) { if (body.sleepState !== 0) body.wakeUp(); }
  setPosition(body, x, y, z) { this.wake(body); body.position.set(x, y, z); body.aabbNeedsUpdate = true; }
  setVelocity(body, vx, vy, vz) { if (body.type !== this.C.Body.STATIC) { this.wake(body); body.velocity.set(vx, vy, vz); } }
  setAngularVelocity(body, x, y, z) { if (body.type !== this.C.Body.STATIC) { this.wake(body); body.angularVelocity.set(x, y, z); } }
  setEuler(body, x, y, z) { this.wake(body); body.quaternion.setFromEuler(x, y, z); }
  setMass(body, v) {
    body.mass = Math.max(0.01, v);
    body.pe3.desc.mass = body.mass;
    body.updateMassProperties();
    if (body.pe3.desc.lockRotation) { body.fixedRotation = true; body.updateMassProperties(); }
    this.wake(body);
  }
  setStatic(body, flag) {
    body.type = flag ? this.C.Body.STATIC : this.C.Body.DYNAMIC;
    body.mass = flag ? 0 : Math.max(0.01, body.pe3.desc.mass || 1);
    body.pe3.desc.isStatic = flag;
    if (!flag) body.pe3.desc.mass = body.mass;
    body.updateMassProperties();
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    this._emitChange();
  }
  setLockRotation(body, flag) {
    body.pe3.desc.lockRotation = flag;
    if (flag) this._locked.add(body); else this._locked.delete(body);
    body.fixedRotation = flag;
    body.updateMassProperties();
    if (flag) body.angularVelocity.set(0, 0, 0);
  }
  stopMotion(body) {
    if (body.type === this.C.Body.STATIC) return;
    this.wake(body);
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
  }
  /** Resize by rebuilding in place (keeps id, velocity, userData). */
  resize(body, patch) {
    const desc = this.describeBody(body);
    Object.assign(desc, patch);
    const vel = { x: body.velocity.x, y: body.velocity.y, z: body.velocity.z };
    const id = desc.id;
    this.removeBody(id);
    const nb = this.addBody(desc);
    if (nb.type !== this.C.Body.STATIC) nb.velocity.set(vel.x, vel.y, vel.z);
    return nb;
  }

  /* ---------------- dragging ---------------- */
  beginDrag(body, hitPoint) {
    this.endDrag();
    if (!body || body.type === this.C.Body.STATIC) return;
    const C = this.C;
    this.wake(body);
    const jointBody = new C.Body({ mass: 0, type: C.Body.STATIC, collisionFilterGroup: 0, collisionFilterMask: 0 });
    jointBody.addShape(new C.Sphere(0.05));
    jointBody.position.set(hitPoint.x, hitPoint.y, hitPoint.z);
    const pivotLocal = new C.Vec3();
    body.pointToLocalFrame(new C.Vec3(hitPoint.x, hitPoint.y, hitPoint.z), pivotLocal);
    const constraint = new C.PointToPointConstraint(body, pivotLocal, jointBody, new C.Vec3(0, 0, 0));
    this.world.addBody(jointBody);
    this.world.addConstraint(constraint);
    this._drag = { constraint, jointBody };
  }
  moveDrag(point) { if (this._drag) this._drag.jointBody.position.set(point.x, point.y, point.z); }
  endDrag() {
    if (!this._drag) return;
    this.world.removeConstraint(this._drag.constraint);
    this.world.removeBody(this._drag.jointBody);
    this._drag = null;
  }
  get dragging() { return !!this._drag; }
  get dragBody() { return this._drag ? this._drag.constraint.bodyA : null; }

  /* ---------------- events ---------------- */
  onCollision(cb) { if (typeof cb === 'function') this._collisionCbs.push(cb); }
  _emitChange() {
    this._bodiesCache = null;
    if (typeof this.onChange === 'function') this.onChange();
  }
}
