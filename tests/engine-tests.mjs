/* Generic physics-engine tests — the reusable core must work WITHOUT any
   MotionLab code: only Matter.js + js/engine/physics-engine.js.
   Run: node tests/engine-tests.mjs */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

globalThis.window = globalThis;
globalThis.Matter = require('../vendor/matter.min.js');

const { PhysicsEngine, VERSION } = await import('../js/engine/physics-engine.js');

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
}
const near = (a, b, eps = 2) => Math.abs(a - b) <= eps;

/* --- basic creation + gravity through the fixed-step accumulator --- */
const pe = new PhysicsEngine();
check('version: PhysicsEngine.VERSION matches the exported VERSION constant', PhysicsEngine.VERSION === VERSION && VERSION === '1.3.0');
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

/* --- anti-tunnelling: substeps stop a fast body passing a thin wall --- */
function tunnelTrial(substeps) {
  const peT = new PhysicsEngine({ gravity: { x: 0, y: 0 }, substeps });
  peT.addBody({ kind: 'rect', x: 300, y: 300, width: 12, height: 200, isStatic: true });
  const shot = peT.addBody({ kind: 'circle', x: 100, y: 300, radius: 8, frictionAir: 0 });
  peT.setVelocity(shot, 36, 0);
  for (let i = 0; i < 40; i++) peT.advance(1000 / 60, 1);
  return shot.position.x;
}
check('tunnelling: substeps=1 lets a 36px/step shot through a 12px wall (baseline)', tunnelTrial(1) > 306, `x=${tunnelTrial(1)}`);
check('tunnelling: substeps=4 stops the same shot at the wall', tunnelTrial(4) < 294, `x=${tunnelTrial(4)}`);

/* --- v1.2.0: spatial queries + impulse helpers --- */
{
  const peQ = new PhysicsEngine({ gravity: { x: 0, y: 0 } });
  const wallA = peQ.addBody({ kind: 'rect', x: 300, y: 300, width: 20, height: 200, isStatic: true });
  const wallB = peQ.addBody({ kind: 'rect', x: 500, y: 300, width: 20, height: 200, isStatic: true });
  const free = peQ.addBody({ kind: 'circle', x: 100, y: 100, radius: 10, frictionAir: 0 });

  const hits = peQ.raycast(0, 300, 800, 300);
  check('raycast: hits both walls, nearest first', hits.length === 2 && hits[0].body === wallA && hits[1].body === wallB && hits[0].distance < hits[1].distance, `hits=${hits.length}`);
  check('raycast: short segment stops before the first wall', peQ.raycast(0, 300, 200, 300).length === 0);
  check('raycast: vertical miss returns empty', peQ.raycast(0, 50, 800, 50).length === 0);

  const region = peQ.queryRegion(250, 200, 100, 200);
  check('queryRegion: finds the overlapping wall only', region.length === 1 && region[0] === wallA, `n=${region.length}`);
  check('queryRegion: empty area returns empty', peQ.queryRegion(600, 0, 50, 50).length === 0);

  peQ.addVelocity(free, 3, -2);
  check('addVelocity: accumulates onto velocity', near(free.velocity.x, 3, 0.01) && near(free.velocity.y, -2, 0.01), `v=${free.velocity.x},${free.velocity.y}`);
  peQ.addVelocity(wallA, 5, 5);
  check('addVelocity: static bodies are ignored', wallA.velocity.x === 0 && wallA.velocity.y === 0);

  // Radial impulse: body at distance 50 of radius 100 -> mag = 2 + 13 * 0.5 = 8.5 outward (+x).
  const peB = new PhysicsEngine({ gravity: { x: 0, y: 0 } });
  const inBody = peB.addBody({ kind: 'circle', x: 150, y: 100, radius: 10, frictionAir: 0 });
  const outBody = peB.addBody({ kind: 'circle', x: 400, y: 100, radius: 10, frictionAir: 0 });
  const statBody = peB.addBody({ kind: 'rect', x: 120, y: 100, width: 20, height: 20, isStatic: true });
  const n = peB.applyRadialImpulse(100, 100, { radius: 100, base: 2, power: 13 });
  check('applyRadialImpulse: affects only in-radius dynamic bodies', n === 1 && near(inBody.velocity.x, 8.5, 0.6) && outBody.velocity.x === 0 && statBody.velocity.x === 0, `n=${n} vx=${inBody.velocity.x}`);
  const n2 = peB.applyRadialImpulse(100, 100, { radius: 100, base: 2, power: 13, filter: () => false });
  check('applyRadialImpulse: filter can veto everything', n2 === 0);
}

/* --- v1.3.0: seeded RNG --- */
{
  const seq = (seed, n = 8) => { const e = new PhysicsEngine({ seed }); return Array.from({ length: n }, () => e.random()); };
  const a = seq(42), b = seq(42), c = seq(7);
  check('rng: same seed reproduces the same stream', a.every((v, i) => v === b[i]));
  check('rng: a different seed gives a different stream', a.some((v, i) => v !== c[i]));
  check('rng: values stay in [0, 1)', a.every((v) => v >= 0 && v < 1));
  const e = new PhysicsEngine({ seed: 99 });
  e.random(); e.random();
  e.setSeed(99);
  check('rng: setSeed restarts the stream', e.random() === seq(99, 1)[0] && e.seed === 99);
  const e2 = new PhysicsEngine({ seed: 5 });
  let rangeOk = true, intOk = true;
  for (let i = 0; i < 500; i++) {
    const r = e2.randomRange(2, 5); if (!(r >= 2 && r < 5)) rangeOk = false;
    const k = e2.randomInt(1, 6); if (!(Number.isInteger(k) && k >= 1 && k <= 6)) intOk = false;
  }
  check('rng: randomRange / randomInt respect their bounds', rangeOk && intOk);
  check('rng: choice picks a member; shuffle permutes',
    [10, 20, 30].includes(e2.choice([10, 20, 30]))
    && [...e2.shuffle([1, 2, 3, 4, 5, 6, 7, 8])].sort((x, y) => x - y).join() === '1,2,3,4,5,6,7,8');
  check('rng: seed aligns Matter Common._seed', globalThis.Matter.Common._seed === 5);
  // Snapshot/restore keeps the stream position.
  const e3 = new PhysicsEngine({ seed: 77 });
  e3.random(); e3.random();
  const snap = e3.snapshot();
  const nextA = [e3.random(), e3.random(), e3.random()];
  const e4 = new PhysicsEngine({ seed: 1 });
  e4.load(JSON.parse(JSON.stringify(snap)));
  const nextB = [e4.random(), e4.random(), e4.random()];
  check('rng: snapshot -> load resumes the same stream', nextA.every((v, i) => v === nextB[i]) && e4.seed === 77);
}

/* --- v1.3.0: Galton board (钉板) — seeded spawn jitter, modelled on the
       MotionLab 钉板概率 preset geometry. The seed must make the whole
       rain of balls exactly reproducible. --- */
function galtonBins(seed) {
  const pe = new PhysicsEngine({ enableSleeping: true, seed });
  pe.addBody({ kind: 'rect', x: 640, y: 580, width: 1240, height: 40, isStatic: true });
  pe.addBody({ kind: 'rect', x: 330, y: 300, width: 16, height: 600, isStatic: true });
  pe.addBody({ kind: 'rect', x: 950, y: 300, width: 16, height: 600, isStatic: true });
  for (let row = 0; row < 6; row++) {
    const y = 208 + row * 40, off = row % 2 ? 32 : 0;
    for (let x = 424 + off; x <= 856; x += 64)
      pe.addBody({ kind: 'circle', x, y, radius: 7, isStatic: true, friction: 0.05, restitution: 0.4 });
  }
  for (let i = 0; i <= 8; i++)
    pe.addBody({ kind: 'rect', x: 392 + i * 64, y: 492, width: 8, height: 96, isStatic: true, friction: 0.2 });
  const balls = [];
  let si = 0;
  for (let s = 0; s < 1700; s++) {
    if (si < 40 && s % 14 === 0) {
      balls.push(pe.addBody({ kind: 'circle', x: 640 + pe.randomRange(-10, 10), y: 30, radius: 11, restitution: 0.35, friction: 0.05, frictionAir: 0.002 }));
      si++;
    }
    pe.stepOnce();
  }
  const bins = new Array(8).fill(0);
  let counted = 0;
  for (const b of balls) {
    if (b.position.y < 440) continue;
    bins[Math.max(0, Math.min(7, Math.floor((b.position.x - 392) / 64)))]++;
    counted++;
  }
  return { bins, counted };
}
{
  const g1 = galtonBins(42), g2 = galtonBins(42), g3 = galtonBins(7);
  check('galton: every ball lands in a bin', g1.counted === 40, `counted=${g1.counted}`);
  check('galton: same seed -> identical bin counts', JSON.stringify(g1.bins) === JSON.stringify(g2.bins), `${g1.bins} vs ${g2.bins}`);
  check('galton: different seed -> different outcome', JSON.stringify(g1.bins) !== JSON.stringify(g3.bins), `${g1.bins} vs ${g3.bins}`);
  check('galton: balls spread across the board (no single dominant bin)',
    g1.bins.filter((n) => n > 0).length >= 6 && Math.max(...g1.bins) <= 18, `${g1.bins}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
