/* physics.js — Matter.js wrapper. Owns the engine/world and converts between
   plain scene data (scene.js) and live Matter bodies. UI never touches Matter directly. */

import { bodyData, constraintData } from './scene.js';

const M = window.Matter;
const { Engine, Bodies, Body, Composite, Constraint, Events } = M;

/** Offset in body-local space -> world coordinates (accounts for rotation). */
function localToWorld(body, pt) {
  const c = Math.cos(body.angle), s = Math.sin(body.angle);
  return {
    x: body.position.x + pt.x * c - pt.y * s,
    y: body.position.y + pt.x * s + pt.y * c,
  };
}

export class PhysicsWorld {
  constructor() {
    this.engine = Engine.create({ enableSleeping: false });
    this.world = this.engine.world;
    this._byId = new Map();       // dataId -> Matter body
    this._cons = new Map();       // constraintId -> {constraint, data}
    this._dragConstraint = null;
    this.onChange = null;         // callback for structural changes (add/remove)
    Events.on(this.engine, 'collisionStart', () => { this.collisionFlash = performance.now(); });
  }

  get gravity() { return this.engine.gravity; }

  applySettings(s) {
    this.engine.gravity.x = s.gravityEnabled ? s.gravityX : 0;
    this.engine.gravity.y = s.gravityEnabled ? s.gravityY : 0;
  }

  /** Step the simulation. Total simulated time is dt*speed, split into
      sub-steps of at most ~16.7ms each so fast speeds stay stable. */
  step(dtMs, speed = 1) {
    const total = Math.min(dtMs, 50) * speed;
    const n = Math.max(1, Math.min(8, Math.ceil(total / 16.666)));
    const sub = total / n;
    for (let i = 0; i < n; i++) {
      // Rotation lock is a hard guarantee: infinite inertia stops torques, and
      // any residual angular velocity is zeroed so the angle truly stays put.
      for (const b of this._byId.values()) {
        if (!b.isStatic && b.plugin.motionlab.lockRotation && b.angularVelocity !== 0) Body.setAngularVelocity(b, 0);
      }
      Engine.update(this.engine, sub);
    }
  }

  clearBodies() {
    for (const { constraint } of this._cons.values()) Composite.remove(this.world, constraint);
    this._cons.clear();
    for (const b of this._byId.values()) Composite.remove(this.world, b);
    this._byId.clear();
    this.endDrag();
  }

  /** Build a live Matter body from plain data and add it to the world. */
  addBody(data) {
    const d = bodyData(data);
    const opts = {
      angle: d.angle,
      density: d.density,
      friction: d.friction,
      frictionAir: d.frictionAir,
      restitution: d.restitution,
      isStatic: d.isStatic,
      label: d.label || d.type,
      ...(d.lockRotation ? { inertia: Infinity } : {}),
    };
    let body;
    switch (d.type) {
      case 'circle': body = Bodies.circle(d.x, d.y, d.radius, opts); break;
      case 'polygon': body = Bodies.polygon(d.x, d.y, d.sides, d.radius, opts); break;
      case 'line': body = Bodies.rectangle(d.x, d.y, d.width, Math.max(4, d.height), opts); break;
      default: body = Bodies.rectangle(d.x, d.y, d.width, d.height, opts);
    }
    body.plugin = body.plugin || {};
    body.plugin.motionlab = { dataId: d.id, type: d.type, isBound: d.isBound, sides: d.sides, lockRotation: d.lockRotation };
    body._mlData = { width: d.width, height: d.height, radius: d.radius };
    if (Number.isFinite(body.inertia)) body._mlInertia0 = body.inertia;
    if (!d.isStatic && (d.vx || d.vy)) Body.setVelocity(body, { x: d.vx, y: d.vy });
    Composite.add(this.world, body);
    this._byId.set(d.id, body);
    this._emitChange();
    return body;
  }

  removeBody(dataId) {
    const b = this._byId.get(dataId);
    if (!b) return false;
    if (this._dragConstraint && this._dragConstraint.bodyB === b) this.endDrag();
    for (const [cid, rec] of [...this._cons]) {
      if (rec.data.bodyA === dataId || rec.data.bodyB === dataId) this.removeConstraint(cid, false);
    }
    Composite.remove(this.world, b);
    this._byId.delete(dataId);
    this._emitChange();
    return true;
  }

  /* ---------- spring / rod constraints ---------- */
  addConstraint(data) {
    const d = constraintData(data);
    const bodyB = this._byId.get(d.bodyB);
    if (!bodyB) return null;
    const bodyA = d.bodyA ? this._byId.get(d.bodyA) : null;
    if (d.bodyA && !bodyA) return null;
    let length = d.length;
    if (length === null) {
      const a = bodyA ? localToWorld(bodyA, d.pointA) : d.pointA;
      const b = localToWorld(bodyB, d.pointB);
      length = Math.hypot(b.x - a.x, b.y - a.y);
      d.length = Math.round(length * 100) / 100;
    }
    const constraint = Constraint.create({
      bodyA: bodyA || undefined,
      bodyB,
      pointA: d.pointA,
      pointB: d.pointB,
      stiffness: d.stiffness,
      damping: d.damping,
      length: d.length,
    });
    Composite.add(this.world, constraint);
    this._cons.set(d.id, { constraint, data: d });
    this._emitChange();
    return constraint;
  }

  removeConstraint(id, emit = true) {
    const rec = this._cons.get(id);
    if (!rec) return false;
    Composite.remove(this.world, rec.constraint);
    this._cons.delete(id);
    if (emit) this._emitChange();
    return true;
  }

  get constraintCount() { return this._cons.size; }

  /** Live constraints with resolved world-space endpoints, for rendering/picking. */
  constraintSegments() {
    const out = [];
    for (const { constraint, data } of this._cons.values()) {
      const a = constraint.bodyA ? localToWorld(constraint.bodyA, data.pointA) : { ...data.pointA };
      const b = localToWorld(constraint.bodyB, data.pointB);
      out.push({ id: data.id, a, b, stiffness: data.stiffness });
    }
    return out;
  }

  serializeConstraints() {
    return [...this._cons.values()].map(({ data }) => constraintData(data));
  }

  loadScene(scene) {
    this.clearBodies();
    for (const d of scene.bodies) this.addBody(d);
    for (const c of scene.constraints || []) this.addConstraint(c);
    this.applySettings(scene.settings);
  }

  bodyById(dataId) { return this._byId.get(dataId) || null; }
  dataIdOf(body) { return body && body.plugin && body.plugin.motionlab ? body.plugin.motionlab.dataId : null; }
  typeOf(body) { return body && body.plugin && body.plugin.motionlab ? body.plugin.motionlab.type : 'rectangle'; }
  allBodies() { return [...this._byId.values()]; }
  get count() { return this._byId.size; }

  /** Pick the topmost body at a world point (later-added bodies win). */
  pick(wx, wy) {
    const bodies = this.allBodies();
    for (let i = bodies.length - 1; i >= 0; i--) {
      if (M.Bounds.contains(bodies[i].bounds, { x: wx, y: wy }) &&
          M.Vertices.contains(bodies[i].vertices, { x: wx, y: wy })) return bodies[i];
    }
    return null;
  }

  /** Serialize one live body back to plain data (captures current pos/vel/angle). */
  serializeBody(body) {
    const meta = body.plugin.motionlab;
    const w = body.bounds.max.x - body.bounds.min.x;
    const h = body.bounds.max.y - body.bounds.min.y;
    const prev = body._mlData || {};
    return bodyData({
      id: meta.dataId,
      type: meta.type,
      x: body.position.x, y: body.position.y,
      angle: body.angle,
      // For rotated shapes bounds are not the true size; keep last known nominal size.
      width: prev.width !== undefined ? prev.width : w,
      height: prev.height !== undefined ? prev.height : h,
      radius: prev.radius !== undefined ? prev.radius : Math.max(w, h) / 2,
      sides: meta.sides,
      density: body.density,
      friction: body.friction,
      frictionAir: body.frictionAir,
      restitution: body.restitution,
      isStatic: body.isStatic,
      isBound: meta.isBound,
      lockRotation: meta.lockRotation === true,
      vx: body.velocity.x, vy: body.velocity.y,
      label: body.label,
    });
  }

  serializeScene(name, settings) {
    return {
      bodies: this.allBodies().map((b) => this.serializeBody(b)),
      constraints: this.serializeConstraints(),
    };
  }

  /* ---------- property edits (single source of truth for panel -> engine) ---------- */
  setPosition(body, x, y) { Body.setPosition(body, { x, y }); Body.setVelocity(body, body.velocity); }
  setAngleDeg(body, deg) { Body.setAngle(body, deg * Math.PI / 180); }
  setVelocity(body, vx, vy) { if (!body.isStatic) Body.setVelocity(body, { x: vx, y: vy }); }
  setDensity(body, v) {
    Body.setDensity(body, Math.max(0.00001, v));
    if (body.plugin.motionlab.lockRotation && !body.isStatic) Body.setInertia(body, Infinity);
  }
  setMass(body, v) {
    Body.setMass(body, Math.max(0.01, v));
    if (body.plugin.motionlab.lockRotation && !body.isStatic) Body.setInertia(body, Infinity);
  }
  setFriction(body, v) { body.friction = v; }
  setFrictionAir(body, v) { body.frictionAir = Math.min(1, Math.max(0, v)); }
  setRestitution(body, v) { body.restitution = v; }
  setStatic(body, flag) {
    Body.setStatic(body, flag);
    // Matter restores the pre-static inertia; re-apply the rotation lock.
    if (!flag && body.plugin.motionlab.lockRotation) Body.setInertia(body, Infinity);
  }
  setLockRotation(body, flag) {
    body.plugin.motionlab.lockRotation = flag;
    if (body.isStatic) return;
    if (flag) {
      if (Number.isFinite(body.inertia)) body._mlInertia0 = body.inertia;
      Body.setInertia(body, Infinity);
      Body.setAngularVelocity(body, 0);
    } else if (Number.isFinite(body._mlInertia0)) {
      Body.setInertia(body, body._mlInertia0);
    }
  }
  stopMotion(body) {
    if (body.isStatic) return;
    Body.setVelocity(body, { x: 0, y: 0 });
    Body.setAngularVelocity(body, 0);
  }

  /** Resize by rebuilding the body in place (keeps id, velocity, material props). */
  resize(body, patch) {
    const data = this.serializeBody(body);
    Object.assign(data, patch);
    const dataId = data.id;
    const vel = { x: body.velocity.x, y: body.velocity.y };
    this.removeBody(dataId);
    const nb = this.addBody(data);
    if (!nb.isStatic) Body.setVelocity(nb, vel);
    return nb;
  }

  /** Remember nominal dimensions on the body so serialization stays stable while rotating. */
  rememberSize(body, sizePatch) {
    body._mlData = { ...(body._mlData || {}), ...sizePatch };
  }

  /* ---------- dragging via a stiff constraint: real physics, bodies can be thrown ---------- */
  beginDrag(body, wx, wy) {
    this.endDrag();
    if (body.isStatic) return;
    this._dragConstraint = Constraint.create({
      pointA: { x: wx, y: wy },
      bodyB: body,
      pointB: { x: wx - body.position.x, y: wy - body.position.y },
      stiffness: 0.12, damping: 0.08, length: 0,
    });
    Composite.add(this.world, this._dragConstraint);
  }
  moveDrag(wx, wy) {
    if (this._dragConstraint) this._dragConstraint.pointA = { x: wx, y: wy };
  }
  endDrag() {
    if (this._dragConstraint) {
      Composite.remove(this.world, this._dragConstraint);
      this._dragConstraint = null;
    }
  }
  get dragging() { return !!this._dragConstraint; }

  _emitChange() { if (typeof this.onChange === 'function') this.onChange(); }
}
