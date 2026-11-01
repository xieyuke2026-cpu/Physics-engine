/* physics3d.js — adapter between MotionLab's 3D scene format (scene3d.js)
   and the generic PhysicsEngine3D core. Mirrors physics.js on the 2D side. */

import * as CANNON from '../vendor/cannon-es.js';
import { PhysicsEngine3D, setCannonModule } from './engine/physics-engine-3d.js';
import { bodyData3D, sceneData3D } from './scene3d.js';

setCannonModule(CANNON);

export class PhysicsWorld3D {
  constructor() {
    this.core = new PhysicsEngine3D({ enableSleeping: true, friction: 0.4, restitution: 0.25 });
  }

  applySettings(s) {
    this.core.setGravity(s.gravityX, s.gravityY, s.gravityZ, s.gravityEnabled);
    this.core.setContact(s.friction, s.restitution);
  }
  advance(elapsedMs, speed = 1) { return this.core.advance(elapsedMs, speed); }
  stepOnce() { this.core.stepOnce(); }
  clearBodies() { this.core.clear(); }
  addBody(data) {
    return this.core.addBody({ ...bodyData3D(data), userData: { isBound: data.isBound === true } });
  }
  removeBody(id) { return this.core.removeBody(id); }
  bodyById(id) { return this.core.bodyById(id); }
  allBodies() { return this.core.allBodies(); }
  get count() { return this.core.count; }
  get constraintCount() { return 0; }
  pick(origin, dir) { return this.core.pick(origin, dir); }

  loadScene(scene) {
    this.core.clear();
    this.applySettings(scene.settings);
    for (const d of scene.bodies) this.addBody(d);
  }

  serializeBody(body) {
    const d = this.core.describeBody(body);
    return bodyData3D({
      id: d.id, kind: d.kind,
      x: d.x, y: d.y, z: d.z,
      sizeX: d.sizeX, sizeY: d.sizeY, sizeZ: d.sizeZ, radius: d.radius,
      quaternion: d.quaternion,
      mass: d.mass, isStatic: d.isStatic, lockRotation: d.lockRotation,
      vx: d.vx, vy: d.vy, vz: d.vz,
      label: d.label,
      isBound: d.userData.isBound === true,
    });
  }

  serializeScene(name, settings) {
    return sceneData3D({
      name,
      settings,
      bodies: this.core.allBodies().map((b) => this.serializeBody(b)),
    });
  }

  /* snapshots for the view renderer */
  viewBodies() {
    return this.core.allBodies().map((b) => {
      const d = this.core.describeBody(b);
      return {
        id: d.id, kind: d.kind,
        sizeX: d.sizeX, sizeY: d.sizeY, sizeZ: d.sizeZ, radius: d.radius,
        x: d.x, y: d.y, z: d.z, quaternion: d.quaternion,
        isStatic: d.isStatic, isBound: d.userData.isBound === true,
      };
    });
  }
}
