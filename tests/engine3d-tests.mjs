/* Generic 3D physics-engine tests — the 3D core must work WITHOUT any
   MotionLab code: only cannon-es + js/engine/physics-engine-3d.js.
   Run: node tests/engine3d-tests.mjs */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const CANNON = await import('../vendor/cannon-es.js');
const { PhysicsEngine3D, setCannonModule, VERSION } = await import('../js/engine/physics-engine-3d.js');
setCannonModule(CANNON);

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`FAIL  ${name} ${extra}`); }
};
const ground = { id: 'ground', kind: 'box', x: 0, y: -0.5, z: 0, sizeX: 60, sizeY: 1, sizeZ: 60, isStatic: true };

/* --- gravity & resting contact --- */
const e1 = new PhysicsEngine3D({ enableSleeping: true });
e1.addBody(ground);
const ball = e1.addBody({ id: 'ball', kind: 'sphere', x: 0, y: 6, z: 0, radius: 0.5, mass: 1 });
for (let i = 0; i < 240; i++) e1.advance(1000 / 60, 1);
const bd = e1.describeBody(ball);
check('version: PhysicsEngine3D.VERSION matches the exported VERSION constant', PhysicsEngine3D.VERSION === VERSION && VERSION === '1.0.0');
check('sphere falls and rests on ground', Math.abs(bd.y - 0.5) < 0.06, `y=${bd.y}`);
check('resting sphere nearly stops', bd.speed < 0.2, `speed=${bd.speed.toFixed(3)}`);
check('describeBody reports quaternion', bd.quaternion && Number.isFinite(bd.quaternion.w));

/* --- box stacking settles --- */
const e2 = new PhysicsEngine3D({ enableSleeping: true });
e2.addBody(ground);
for (let i = 0; i < 4; i++) e2.addBody({ kind: 'box', x: 0, y: 0.55 + i * 1.1, z: 0, sizeX: 1, sizeY: 1, sizeZ: 1, mass: 1 });
for (let i = 0; i < 300; i++) e2.advance(1000 / 60, 1);
const tops = e2.allBodies().filter((b) => e2.idOf(b) !== 'ground').map((b) => b.position.y).sort((a, b) => a - b);
check('4-box stack settles in place', tops.length === 4 && tops[3] < 4.2 && tops[0] > 0.2, JSON.stringify(tops.map((v) => v.toFixed(2))));

/* --- fixed-step advance determinism & speed --- */
const e3 = new PhysicsEngine3D();
e3.addBody(ground);
const b3 = e3.addBody({ kind: 'box', x: 0, y: 10, z: 0, mass: 1 });
const steps = e3.advance(1000 / 30, 1);
check('advance runs the accumulated fixed steps', steps === 2, `${steps}`);
check('advance respects maxSteps cap', e3.advance(5000, 1) <= e3.maxSteps);

/* --- snapshot / load round-trip --- */
const snap = e2.snapshot();
const e4 = new PhysicsEngine3D({ enableSleeping: true });
e4.load(snap);
check('snapshot/load preserves body count', e4.count === e2.count, `${e4.count} vs ${e2.count}`);
const snap2 = JSON.parse(JSON.stringify(e4.snapshot()));
check('snapshot is JSON-safe and stable', snap2.bodies.length === snap.bodies.length && Math.abs(snap2.bodies[1].y - snap.bodies[1].y) < 1e-6);

/* --- ray pick --- */
const hit = e1.pick({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 });
check('ray pick hits the sphere from above', hit === ball);
check('ray pick misses sideways', e1.pick({ x: 30, y: 10, z: 30 }, { x: 0, y: -1, z: 0 }) === null);

/* --- lock rotation set --- */
const e5 = new PhysicsEngine3D({ enableSleeping: true });
e5.addBody(ground);
const lb = e5.addBody({ kind: 'box', x: 0, y: 3, z: 0, mass: 1, lockRotation: true });
e5.setAngularVelocity(lb, 2, 1, 0);
for (let i = 0; i < 60; i++) e5.advance(1000 / 60, 1);
check('locked body keeps identity rotation', Math.abs(lb.quaternion.x) < 1e-6 && Math.abs(lb.quaternion.y) < 1e-6 && Math.abs(lb.quaternion.z) < 1e-6,
  JSON.stringify(lb.quaternion));
check('locked body still falls', lb.position.y < 2.9, `y=${lb.position.y}`);

/* --- static toggle, remove, clear --- */
const e6 = new PhysicsEngine3D();
const s6 = e6.addBody({ kind: 'sphere', x: 0, y: 2, z: 0, radius: 0.4, mass: 2 });
e6.setStatic(s6, true);
check('setStatic makes body static', e6.describeBody(s6).isStatic === true);
e6.setStatic(s6, false);
check('setStatic(false) restores mass', Math.abs(e6.describeBody(s6).mass - 2) < 1e-9);
check('removeBody works', e6.removeBody(e6.idOf(s6)) === true && e6.count === 0);
e6.addBody(ground); e6.clear();
check('clear empties the world', e6.count === 0);

/* --- drag pulls body --- */
const e7 = new PhysicsEngine3D({ enableSleeping: true });
e7.addBody(ground);
const d7 = e7.addBody({ kind: 'box', x: 0, y: 0.6, z: 0, mass: 1 });
for (let i = 0; i < 60; i++) e7.advance(1000 / 60, 1);
e7.beginDrag(d7, { x: 0, y: 0.6, z: 0 });
e7.moveDrag({ x: 4, y: 0.6, z: 0 });
for (let i = 0; i < 120; i++) e7.advance(1000 / 60, 1);
check('drag pulls body toward target', d7.position.x > 2.5, `x=${d7.position.x.toFixed(2)}`);
e7.endDrag();
check('endDrag releases', e7.dragging === false);

/* --- gravity control --- */
const e8 = new PhysicsEngine3D();
e8.setGravity(0, 0, 0, false);
check('gravity can be disabled', e8.gravity.y === 0);
e8.setGravity(0, -9.82, 0, true);
check('gravity restores', Math.abs(e8.gravity.y + 9.82) < 1e-9);

/* --- perf sanity: 120 boxes, 180 steps --- */
const e9 = new PhysicsEngine3D({ enableSleeping: true });
e9.addBody(ground);
for (let i = 0; i < 120; i++) {
  e9.addBody({ kind: i % 3 ? 'box' : 'sphere', x: (i % 10) * 1.4 - 6, y: 1 + Math.floor(i / 10) * 1.3, z: (i % 4) * 1.4 - 2, radius: 0.45, mass: 1 });
}
const t0 = Date.now();
for (let i = 0; i < 180; i++) e9.advance(1000 / 60, 1);
const elapsed = Date.now() - t0;
check('perf: 121 bodies x 180 steps completes quickly', elapsed < 6000, `${elapsed}ms`);
console.log(`  perf: 121 bodies x 180 steps = ${elapsed}ms (${(elapsed / 180).toFixed(2)}ms/step)`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
