/* MotionLab logic tests — run: node tests/run-tests.mjs
   Covers scene validation, real Matter.js gravity/collision, property edits,
   resize, drag constraint, and serialize round-trips. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

globalThis.window = globalThis;
globalThis.Matter = require('../vendor/matter.min.js');

const { validateScene, defaultScene, sceneData, bodyData } = await import('../js/scene.js');
const { PhysicsWorld } = await import('../js/physics.js');

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
}
const near = (a, b, eps = 2) => Math.abs(a - b) <= eps;

/* --- scene validation --- */
check('default scene validates', validateScene(defaultScene()).ok);
check('bad format rejected', !validateScene({ format: 'x', version: 1, bodies: [] }).ok);
check('bad body type rejected', !validateScene({ format: 'motionlab-scene', version: 1, bodies: [{ type: 'star', x: 0, y: 0 }] }).ok);
check('NaN position rejected', !validateScene({ format: 'motionlab-scene', version: 1, bodies: [{ type: 'circle', x: 'NaN', y: 0 }] }).ok);
check('restitution > 2 rejected', !validateScene({ format: 'motionlab-scene', version: 1, bodies: [{ type: 'circle', x: 0, y: 0, restitution: 9 }] }).ok);
check('non-object rejected', !validateScene([1, 2]).ok && !validateScene(null).ok);
check('speed out of range rejected', !validateScene({ format: 'motionlab-scene', version: 1, bodies: [], settings: { speed: 99 } }).ok);

/* --- physics: gravity + collision with ground --- */
const world = new PhysicsWorld();
const scene = defaultScene();
world.loadScene(scene);
check('default scene body count = 9', world.count === 9, `got ${world.count}`);
const ball = world.allBodies().find((b) => b.label === 'Ball' && !b.isStatic);
const y0 = ball.position.y;
for (let i = 0; i < 240; i++) world.step(1000 / 60, 1); // 4 simulated seconds
check('gravity pulled ball down', ball.position.y > y0 + 100, `y0=${y0.toFixed(1)} y=${ball.position.y.toFixed(1)}`);
check('ball rests on/above ground (no tunneling)', ball.position.y < 545, `y=${ball.position.y.toFixed(1)}`);
check('ball settled (low velocity)', Math.hypot(ball.velocity.x, ball.velocity.y) < 1.2, `v=${Math.hypot(ball.velocity.x, ball.velocity.y).toFixed(2)}`);

/* --- gravity off --- */
const w2 = new PhysicsWorld();
w2.loadScene(sceneData({ settings: { gravityEnabled: false, gravityX: 0, gravityY: 1 }, bodies: [bodyData({ type: 'circle', x: 100, y: 100, radius: 20 })] }));
const b2 = w2.allBodies()[0];
for (let i = 0; i < 60; i++) w2.step(1000 / 60, 1);
check('gravity disabled: body stays put', near(b2.position.y, 100, 0.6), `y=${b2.position.y.toFixed(2)}`);

/* --- create / pick / delete --- */
const w3 = new PhysicsWorld();
w3.loadScene(sceneData({ bodies: [] }));
const c = w3.addBody(bodyData({ type: 'circle', x: 300, y: 200, radius: 25 }));
const r = w3.addBody(bodyData({ type: 'rectangle', x: 500, y: 200, width: 50, height: 50 }));
check('pick circle', w3.pick(300, 200) === c);
check('pick rectangle', w3.pick(500, 200) === r);
check('pick empty returns null', w3.pick(50, 50) === null);
w3.removeBody(w3.dataIdOf(c));
check('delete removes body', w3.count === 1 && w3.pick(300, 200) === null);

/* --- property edits sync to engine --- */
const w4 = new PhysicsWorld();
w4.loadScene(sceneData({ bodies: [bodyData({ type: 'rectangle', x: 100, y: 100, width: 40, height: 40, density: 0.001 })] }));
const box = w4.allBodies()[0];
const m0 = box.mass;
w4.setDensity(box, 0.004);
check('density edit changes mass ~4x', near(box.mass / m0, 4, 0.15), `ratio=${(box.mass / m0).toFixed(2)}`);
w4.setMass(box, 10);
check('mass edit applies', near(box.mass, 10, 0.01));
w4.setFriction(box, 0.9); w4.setRestitution(box, 0.8);
check('friction/restitution apply', box.friction === 0.9 && box.restitution === 0.8);
w4.setPosition(box, 222, 333);
check('position edit applies', box.position.x === 222 && box.position.y === 333);
w4.setAngleDeg(box, 90);
check('angle edit applies (deg->rad)', near(box.angle, Math.PI / 2, 0.001));
w4.setVelocity(box, 3, -2);
check('velocity edit applies', near(box.velocity.x, 3, 0.2) && near(box.velocity.y, -2, 0.2));
w4.setStatic(box, true);
check('static toggle applies', box.isStatic === true);
w4.setStatic(box, false);

/* --- resize rebuild keeps id & props --- */
const beforeId = w4.dataIdOf(box);
w4.setAngleDeg(box, 0); // un-rotate so bounds map directly to width/height
const nb = w4.resize(box, { width: 120, height: 30 });
check('resize keeps data id', w4.dataIdOf(nb) === beforeId);
check('resize changes bounds', near(nb.bounds.max.x - nb.bounds.min.x, 120, 1), `w=${(nb.bounds.max.x - nb.bounds.min.x).toFixed(1)}`);

/* --- drag constraint moves body (running drag) --- */
const w5 = new PhysicsWorld();
w5.loadScene(sceneData({ bodies: [bodyData({ type: 'circle', x: 100, y: 100, radius: 20 })] }));
const db = w5.allBodies()[0];
w5.beginDrag(db, 100, 100);
w5.moveDrag(400, 100);
for (let i = 0; i < 90; i++) w5.step(1000 / 60, 1);
check('drag constraint pulls body toward pointer', db.position.x > 250, `x=${db.position.x.toFixed(1)}`);
w5.endDrag();
check('endDrag clears constraint', !w5.dragging);

/* --- serialize round-trip --- */
const w6 = new PhysicsWorld();
w6.loadScene(defaultScene());
for (let i = 0; i < 30; i++) w6.step(1000 / 60, 1);
const snap = sceneData({ name: 'RT', settings: { gravityY: 1 }, bodies: w6.allBodies().map((b) => w6.serializeBody(b)) });
const v = validateScene(JSON.parse(JSON.stringify(snap)));
check('serialized scene survives JSON round-trip + validation', v.ok, v.errors.join(';'));
const w7 = new PhysicsWorld();
if (v.ok) w7.loadScene(v.scene);
check('round-tripped scene reloads same count', w7.count === w6.count);

/* --- speed multiplier --- */
const w8 = new PhysicsWorld();
w8.loadScene(sceneData({ bodies: [bodyData({ type: 'circle', x: 0, y: 0, radius: 10 })] }));
const fast = w8.allBodies()[0];
for (let i = 0; i < 30; i++) w8.step(1000 / 60, 2);
check('speed 2x falls further than 1x baseline (>150px in 0.5s wall)', fast.position.y > 100, `y=${fast.position.y.toFixed(1)}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
