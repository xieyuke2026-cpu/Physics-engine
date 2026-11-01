/* Generic physics-engine tests — the reusable core must work WITHOUT any
   MotionLab code: only Matter.js + js/engine/physics-engine.js.
   Run: node tests/engine-tests.mjs */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

globalThis.window = globalThis;
globalThis.Matter = require('../vendor/matter.min.js');

const { PhysicsEngine } = await import('../js/engine/physics-engine.js');

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
}
const near = (a, b, eps = 2) => Math.abs(a - b) <= eps;

/* --- basic creation + gravity through the fixed-step accumulator --- */
const pe = new PhysicsEngine();
check('engine constructs with defaults', pe.count === 0 && pe.fixedDt === 1000 / 60);
const ball = pe.addBody({ kind: 'circle', x: 100, y: 50, radius: 20 });
pe.addBody({ kind: 'rect', x: 100, y: 400, width: 500, height: 20, isStatic: true });
check('ids assigned', typeof pe.idOf(ball) === 'string' && pe.count === 2);
const steps = pe.advance(1000 / 60, 1);
check('advance(16.7ms) runs exactly 1 fixed step', steps === 1, `steps=${steps}`);
for (let i = 0; i < 240; i++) pe.advance(1000 / 60, 1);
check('ball fell and rests above floor', ball.position.y > 300 && ball.position.y < 385, `y=${ball.position.y.toFixed(1)}`);
check('advance caps steps (no spiral of death)', pe.advance(10000, 1) <= 5);

/* --- descriptors are app-agnostic: userData rides along untouched --- */
const crate = pe.addBody({ kind: 'rect', x: 300, y: 100, width: 30, height: 30, userData: { game: 'tower-defense', hp: 3 } });
check('userData preserved on body', pe.userDataOf(crate).hp === 3);
const snap = pe.snapshot();
check('snapshot has bodies + constraints arrays', Array.isArray(snap.bodies) && Array.isArray(snap.constraints) && snap.bodies.length === 3);
const pe2 = new PhysicsEngine();
pe2.load(JSON.parse(JSON.stringify(snap)));
check('snapshot -> load round trip (generic JSON)', pe2.count === 3 && pe2.userDataOf(pe2.allBodies()[2]).hp === 3);

/* --- constraints without any app format --- */
const pe3 = new PhysicsEngine({ enableSleeping: false });
const anchorBall = pe3.addBody({ kind: 'circle', x: 320, y: 250, radius: 18, frictionAir: 0.001 });
pe3.addConstraint({ bodyA: null, bodyB: pe3.idOf(anchorBall), pointA: { x: 200, y: 50 }, stiffness: 1, damping: 0, length: 200 });
for (let i = 0; i < 240; i++) pe3.advance(1000 / 60, 1);
const d = Math.hypot(anchorBall.position.x - 200, anchorBall.position.y - 50);
check('rod constraint holds distance', d > 180 && d < 225, `d=${d.toFixed(1)}`);
check('constraint segments resolve endpoints', pe3.constraintSegments().length === 1 && pe3.constraintSegments()[0].id !== undefined);
pe3.removeBody(pe3.idOf(anchorBall));
check('removing body cleans constraints generically', pe3.constraintCount === 0);

/* --- collision events --- */
const pe4 = new PhysicsEngine();
let hits = 0;
pe4.onCollision(() => { hits++; });
pe4.addBody({ kind: 'circle', x: 100, y: 50, radius: 15 });
pe4.addBody({ kind: 'rect', x: 100, y: 300, width: 400, height: 20, isStatic: true });
for (let i = 0; i < 180; i++) pe4.advance(1000 / 60, 1);
check('collision callback fired', hits > 0, `hits=${hits}`);

/* --- sleeping: resting bodies sleep, edits wake them --- */
const pe5 = new PhysicsEngine({ enableSleeping: true });
pe5.addBody({ kind: 'rect', x: 200, y: 390, width: 600, height: 20, isStatic: true });
const sleeper = pe5.addBody({ kind: 'rect', x: 200, y: 340, width: 40, height: 40, friction: 0.6 });
for (let i = 0; i < 600; i++) pe5.advance(1000 / 60, 1);
check('resting body falls asleep', sleeper.isSleeping === true, `sleeping=${sleeper.isSleeping}`);
pe5.setVelocity(sleeper, 0, -8);
check('setVelocity wakes the body', sleeper.isSleeping === false);
for (let i = 0; i < 30; i++) pe5.advance(1000 / 60, 1);
check('woken body actually moves up', sleeper.position.y < 335, `y=${sleeper.position.y.toFixed(1)}`);

/* --- generic resize + drag --- */
const pe6 = new PhysicsEngine();
const rb = pe6.addBody({ kind: 'rect', x: 100, y: 100, width: 40, height: 40, userData: { tag: 'x' } });
const rid = pe6.idOf(rb);
const nb = pe6.resize(rb, { width: 120 });
check('generic resize keeps id + userData', pe6.idOf(nb) === rid && pe6.userDataOf(nb).tag === 'x');
check('generic resize changes size', near(nb.bounds.max.x - nb.bounds.min.x, 120, 1));
const db = pe6.addBody({ kind: 'circle', x: 100, y: 300, radius: 18 });
pe6.beginDrag(db, 100, 300);
pe6.moveDrag(400, 300);
for (let i = 0; i < 90; i++) pe6.advance(1000 / 60, 1);
check('generic drag pulls body', db.position.x > 250, `x=${db.position.x.toFixed(1)}`);
pe6.endDrag();

/* --- v1.6 optimizations: bodies cache + lock set --- */
const pe8 = new PhysicsEngine({ enableSleeping: true });
pe8.addBody({ id: 'floor8', kind: 'rect', x: 300, y: 560, width: 800, height: 40, isStatic: true });
const c1 = pe8.addBody({ id: 'c1', kind: 'circle', x: 200, y: 100, radius: 18 });
const c2 = pe8.addBody({ id: 'c2', kind: 'circle', x: 260, y: 100, radius: 18 });
check('cache: pick finds body before structural change', pe8.pick(200, 100) === c1);
pe8.removeBody('c1');
check('cache: pick no longer returns removed body', pe8.pick(200, 100) === null);
check('cache: allBodies reflects removal', pe8.allBodies().length === 2 && pe8.count === 2);
const c3 = pe8.addBody({ id: 'c3', kind: 'circle', x: 200, y: 100, radius: 18 });
check('cache: pick finds newly added body', pe8.pick(200, 100) === c3);
const copy = pe8.allBodies(); copy.length = 0;
check('cache: allBodies returns a copy (mutation-safe)', pe8.count === 3);
// lock set: only locked bodies are held; unlocking releases; removing a locked body is clean
pe8.setLockRotation(c2, true);
pe8.setVelocity(c2, 0, 0);
Matter.Body.setAngularVelocity(c2, 2.5);
for (let i = 0; i < 30; i++) pe8.advance(1000 / 60, 1);
check('lock set: locked body keeps zero spin', Math.abs(c2.angularVelocity) < 1e-9 && Math.abs(c2.angle) < 0.05, `angle=${c2.angle}`);
pe8.setLockRotation(c2, false);
check('lock set: unlock removes from set', pe8._locked.size === 0);
pe8.setLockRotation(c3, true);
pe8.removeBody('c3');
check('lock set: removing a locked body cleans the set', pe8._locked.size === 0);
for (let i = 0; i < 10; i++) pe8.advance(1000 / 60, 1);
check('lock set: engine still steps after cleanup', Number.isFinite(c2.position.y));

/* --- perf sanity: 200 dynamic bodies, 120 steps --- */
const pe7 = new PhysicsEngine({ enableSleeping: true });
pe7.addBody({ kind: 'rect', x: 600, y: 580, width: 1400, height: 40, isStatic: true });
for (let i = 0; i < 200; i++) {
  pe7.addBody({ kind: i % 2 ? 'circle' : 'rect', x: 100 + (i % 20) * 55, y: 60 + Math.floor(i / 20) * 45, radius: 16, width: 30, height: 30 });
}
const t0 = Date.now();
for (let i = 0; i < 120; i++) pe7.advance(1000 / 60, 1);
const elapsed = Date.now() - t0;
check('perf: 201 bodies x 120 steps completes quickly', elapsed < 4000, `${elapsed}ms`);
console.log(`  perf: 201 bodies x 120 steps = ${elapsed}ms (${(elapsed / 120).toFixed(2)}ms/step)`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
