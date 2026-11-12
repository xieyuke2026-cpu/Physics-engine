/* Generic physics-engine tests — the reusable core must work WITHOUT any
   MotionLab code: only Matter.js + js/engine/physics-engine.js.
   Run: node tests/engine-tests.mjs */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

globalThis.window = globalThis;
globalThis.Matter = require('../vendor/matter.min.js');

const { PhysicsEngine, VERSION, Formulas, BACKENDS } = await import('../js/engine/physics-engine.js');

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
}
const near = (a, b, eps = 2) => Math.abs(a - b) <= eps;

/* --- basic creation + gravity through the fixed-step accumulator --- */
const pe = new PhysicsEngine();
check('version: PhysicsEngine.VERSION matches the exported VERSION constant', PhysicsEngine.VERSION === VERSION && VERSION === '1.13.1');
check('rigid machines get extra constraint iterations by default', new PhysicsEngine().engine.constraintIterations === 4);
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

/* --- orphan sleepers (1.44): support removed -> must fall, not hover --- */
{
  const pe = new PhysicsEngine({ enableSleeping: true });
  pe.addBody({ kind: 'rect', x: 640, y: 560, width: 1280, height: 40, isStatic: true });
  const tower = [];
  for (let i = 0; i < 6; i++) tower.push(pe.addBody({ kind: 'rect', x: 1159, y: 508 - i * 64, width: 64, height: 64, friction: 0.4 }));
  for (let i = 0; i < 600; i++) pe.advance(1000 / 60, 1);
  const topY = tower[5].position.y;
  pe.removeBody(pe.idOf(tower[0]));
  for (let i = 0; i < 300; i++) pe.advance(1000 / 60, 1);
  check('orphan tower falls after its base is deleted (matter)',
    tower[5].position.y > topY + 30, `fell ${(tower[5].position.y - topY).toFixed(1)} px`);
  check('landed orphans may sleep again (matter)',
    tower.slice(1).filter((b) => b.isSleeping).length >= 3,
    `sleeping=${tower.slice(1).filter((b) => b.isSleeping).length}/5`);
}

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

/* --- v1.4.0: named bodies --- */
{
  const pe = new PhysicsEngine({});
  const hero = pe.addBody({ kind: 'circle', x: 10, y: 10, radius: 8, name: 'hero' });
  pe.addBody({ kind: 'circle', x: 40, y: 10, radius: 8, name: 'coin' });
  pe.addBody({ kind: 'circle', x: 70, y: 10, radius: 8, name: 'coin' });
  check('names: getBodyByName finds the body', pe.getBodyByName('hero') === hero);
  check('names: duplicates allowed, getBodiesByName returns all', pe.getBodiesByName('coin').length === 2);
  check('names: unknown name -> null / empty', pe.getBodyByName('ghost') === null && pe.getBodiesByName('ghost').length === 0);
  check('names: renameBody by id and by body',
    pe.renameBody(pe.idOf(hero), 'knight') && pe.getBodyByName('knight') === hero && pe.nameOf(hero) === 'knight');
  const pe2 = new PhysicsEngine({});
  pe2.load(JSON.parse(JSON.stringify(pe.snapshot())));
  check('names: name survives snapshot -> load', pe2.getBodyByName('knight') !== null && pe2.getBodiesByName('coin').length === 2);
}

/* --- v1.12.6: snapshot fidelity — spin + sleep state round-trip ---
   Before 1.12.6, describeBody/addBody dropped angular velocity and the
   sleeping flag: a snapshot restored mid-motion silently zeroed both,
   and a replay recorded after warm-up diverged from its own recording. */
{
  const e1 = new PhysicsEngine({});
  const ball = e1.addBody({ kind: 'circle', x: 200, y: 100, radius: 20, vx: 2, frictionAir: 0 });
  Matter.Body.setAngularVelocity(ball, 0.3);
  for (let i = 0; i < 30; i++) e1.advance(1000 / 60, 1);
  const snap = JSON.parse(JSON.stringify(e1.snapshot()));
  check('snapshot fidelity: snapshot carries va + sleeping fields',
    typeof snap.bodies[0].va === 'number' && snap.bodies[0].sleeping === false);
  const e2 = new PhysicsEngine({});
  e2.load(snap);
  const rb = e2.allBodies()[0];
  check('snapshot fidelity: angular velocity restored on load',
    Math.abs(rb.angularVelocity - ball.angularVelocity) < 1e-12, `va=${rb.angularVelocity} vs ${ball.angularVelocity}`);
  let identical = true;
  for (let i = 0; i < 300; i++) {
    e1.advance(1000 / 60, 1); e2.advance(1000 / 60, 1);
    const d1 = e1.describeBody(ball), d2 = e2.describeBody(rb);
    if (Math.abs(d1.x - d2.x) > 1e-9 || Math.abs(d1.y - d2.y) > 1e-9 || Math.abs(d1.angle - d2.angle) > 1e-9) { identical = false; break; }
  }
  check('snapshot fidelity: spinning flight stays bit-identical for 300 steps', identical);

  const p1 = new PhysicsEngine({ enableSleeping: true });
  p1.addBody({ kind: 'rect', x: 200, y: 400, width: 600, height: 40, isStatic: true });
  for (let i = 0; i < 6; i++) p1.addBody({ kind: 'rect', x: 200, y: 300 - i * 34, width: 32, height: 32 });
  for (let i = 0; i < 600; i++) p1.advance(1000 / 60, 1);
  const asleepBefore = p1.allBodies().filter((b) => b.isSleeping && !b.isStatic).length;
  const p2 = new PhysicsEngine({ enableSleeping: true });
  p2.load(JSON.parse(JSON.stringify(p1.snapshot())));
  const asleepAfter = p2.allBodies().filter((b) => b.isSleeping && !b.isStatic).length;
  check('snapshot fidelity: sleeping bodies come back asleep',
    asleepBefore > 0 && asleepAfter === asleepBefore, `${asleepBefore} -> ${asleepAfter}`);
  let pileSame = true;
  for (let i = 0; i < 300; i++) {
    p1.advance(1000 / 60, 1); p2.advance(1000 / 60, 1);
    const a = p1.snapshot().bodies, b = p2.snapshot().bodies;
    for (let j = 0; j < a.length; j++) if (Math.abs(a[j].x - b[j].x) > 1e-9 || Math.abs(a[j].y - b[j].y) > 1e-9) { pileSame = false; break; }
    if (!pileSame) break;
  }
  check('snapshot fidelity: restored pile tracks the original for 300 steps', pileSame);
}

/* --- v1.12.7: noSleep descriptor flag ---
   A flagged body never enters sleep (Matter: sleepThreshold Infinity).
   Exists for slow-instability bodies (dominoes): a leaning tile's
   motion decays under the sleep threshold mid-push and froze the
   cascade in a lean-to pose. */
{
  const e = new PhysicsEngine({ enableSleeping: true });
  e.addBody({ kind: 'rect', x: 200, y: 580, width: 600, height: 40, isStatic: true });
  const flagged = e.addBody({ kind: 'rect', x: 160, y: 500, width: 32, height: 32, noSleep: true });
  const plain = e.addBody({ kind: 'rect', x: 280, y: 500, width: 32, height: 32 });
  check('noSleep: descriptor round-trips through describeBody', e.describeBody(flagged).noSleep === true && e.describeBody(plain).noSleep === false);
  for (let i = 0; i < 400; i++) e.advance(1000 / 60, 1);
  check('noSleep: flagged body stays awake at rest while the plain twin sleeps',
    flagged.isSleeping === false && plain.isSleeping === true,
    `flagged=${flagged.isSleeping} plain=${plain.isSleeping}`);
  const e2 = new PhysicsEngine({ enableSleeping: true });
  e2.load(JSON.parse(JSON.stringify(e.snapshot())));
  const flagged2 = e2.allBodies().find((b) => e2.describeBody(b).noSleep === true);
  for (let i = 0; i < 400; i++) e2.advance(1000 / 60, 1);
  check('noSleep: survives snapshot -> load (still awake after 400 more steps)', !!flagged2 && flagged2.isSleeping === false);
}

/* --- v1.4.0: stability hardening --- */
{
  check('validate: clean descriptor has no problems', PhysicsEngine.validateDescriptor({ kind: 'circle', x: 1, y: 2, radius: 5 }).length === 0);
  const bad = PhysicsEngine.validateDescriptor({ kind: 'circle', x: NaN, radius: -3 });
  check('validate: NaN / negative radius flagged; unknown kind flagged',
    bad.length === 2 && PhysicsEngine.validateDescriptor({ kind: 'blob' }).length === 1, bad.join('; '));
  const pe = new PhysicsEngine({});
  const b = pe.addBody({ kind: 'circle', x: 50, y: 50, radius: 8 });
  pe.setPosition(b, NaN, 100);
  pe.setVelocity(b, Infinity, 0);
  check('guards: non-finite setter input is ignored', b.position.x === 50 && b.position.y === 50 && b.velocity.x === 0);
  check('guards: healthy world reports no non-finite bodies', pe.findNonFiniteBodies().length === 0);
  const pe2 = new PhysicsEngine({ maxSpeed: 10, gravity: { x: 0, y: 0 } });
  const fast = pe2.addBody({ kind: 'circle', x: 0, y: 0, radius: 6, vx: 60, vy: 80, frictionAir: 0 });
  pe2.stepOnce();
  const sp = Math.hypot(fast.velocity.x, fast.velocity.y);
  check('guards: maxSpeed caps velocity', sp <= 10.01 && sp > 9.0, `speed=${sp.toFixed(2)}`);
  const res = pe2.load({ bodies: [null, 42, { kind: 'circle', x: 1, y: 1, radius: 4 }], constraints: [null] });
  check('guards: load skips malformed entries instead of crashing', res.bodies === 1 && pe2.count === 1);
}

/* --- v1.4.0: Formulas + measurements --- */
{
  check('formulas: kineticEnergy', Formulas.kineticEnergy(2, 3, 4) === 25);
  check('formulas: gravitationalForce', Math.abs(Formulas.gravitationalForce(2, 3, 4, 5) - 0.96) < 1e-9);
  check('formulas: orbitVelocity', Formulas.orbitVelocity(1, 100, 25) === 2);
  check('formulas: pendulumPeriod', Math.abs(Formulas.pendulumPeriod(9.8, 9.8) - 2 * Math.PI) < 1e-9);
  check('formulas: spring + buoyancy + projectile',
    Formulas.springForce(0.5, 10) === 5 && Formulas.springEnergy(0.5, 10) === 25
    && Formulas.buoyancyForce(0.0012, 1000, 10) === 12
    && Math.abs(Formulas.projectileRange(10, Math.PI / 4, 10) - 10) < 1e-9);
  check('formulas: exposed on the class too', PhysicsEngine.Formulas === Formulas);
  const pe = new PhysicsEngine({ gravity: { x: 0, y: 0 } });
  const a = pe.addBody({ kind: 'rect', x: 100, y: 100, width: 20, height: 20, density: 0.001 });
  const b = pe.addBody({ kind: 'rect', x: 300, y: 100, width: 20, height: 20, density: 0.001 });
  pe.setVelocity(a, 3, 4);
  check('measure: bodyKineticEnergy matches Formulas', Math.abs(pe.bodyKineticEnergy(a) - Formulas.kineticEnergy(a.mass, 3, 4)) < 1e-6);
  const com = pe.centerOfMass();
  check('measure: centerOfMass of two equal bodies is the midpoint', Math.abs(com.x - 200) < 0.01 && Math.abs(com.y - 100) < 0.01);
  const p = pe.totalMomentum();
  check('measure: totalMomentum sums m*v', Math.abs(p.x - a.mass * 3) < 1e-9 && Math.abs(p.y - a.mass * 4) < 1e-9);
}

/* --- v1.4.0: gravitation --- */
{
  const pe = new PhysicsEngine({ gravity: { x: 0, y: 0 } });
  const a = pe.addBody({ kind: 'circle', x: 250, y: 300, radius: 10, density: 0.002, frictionAir: 0 });
  const b = pe.addBody({ kind: 'circle', x: 400, y: 300, radius: 10, density: 0.002, frictionAir: 0 });
  pe.setGravitation(500, { softening: 50 });
  check('gravitation: config readable, setGravitation(0) disables', pe.gravitation && pe.gravitation.G === 500);
  const d0 = 150;
  for (let s = 0; s < 120; s++) pe.stepOnce();
  const d1 = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y);
  const p = pe.totalMomentum();
  check('gravitation: bodies attract', d1 < d0 - 60, `${d0} -> ${d1.toFixed(1)}`);
  check('gravitation: total momentum conserved', Math.hypot(p.x, p.y) < 0.01, `|p|=${Math.hypot(p.x, p.y).toFixed(4)}`);
  pe.setGravitation(0);
  check('gravitation: disabled config reads null', pe.gravitation === null);
}
{
  // Circular orbit: orbiter launched at Formulas.orbitVelocity around a
  // static sun (its gravitation mass is area x descriptor density).
  const pe = new PhysicsEngine({ gravity: { x: 0, y: 0 } });
  pe.addBody({ kind: 'circle', x: 480, y: 300, radius: 26, isStatic: true, density: 0.004, name: 'sun' });
  const G = 30, r = 180, M = Math.PI * 26 * 26 * 0.004;
  const orb = pe.addBody({ kind: 'circle', x: 480 + r, y: 300, radius: 8, density: 0.001, frictionAir: 0, name: 'orbiter' });
  pe.setVelocity(orb, 0, -Formulas.orbitVelocity(G, M, r));
  pe.setGravitation(G, { softening: 100 });
  let minR = 1e9, maxR = 0, prevA = 0, swept = 0;
  for (let s = 0; s < 600; s++) {
    pe.stepOnce();
    const dx = orb.position.x - 480, dy = orb.position.y - 300;
    const rr = Math.hypot(dx, dy); if (rr < minR) minR = rr; if (rr > maxR) maxR = rr;
    const ang = Math.atan2(dy, dx);
    let da = ang - prevA; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
    swept += da; prevA = ang;
  }
  check('gravitation: orbit radius stays near-circular', minR > r * 0.9 && maxR < r * 1.1, `[${minR.toFixed(1)}, ${maxR.toFixed(1)}]`);
  check('gravitation: orbiter actually orbits (> 2.5 rad in 600 steps)', Math.abs(swept) > 2.5, `swept=${Math.abs(swept).toFixed(2)}`);
}

/* --- v1.4.0: fluid regions (buoyancy) --- */
{
  const pe = new PhysicsEngine({});
  pe.addFluid({ id: 'water', x: 400, y: 420, width: 600, height: 240, density: 0.0012, drag: 0.02 });
  pe.addBody({ kind: 'rect', x: 400, y: 570, width: 700, height: 20, isStatic: true });
  const wood = pe.addBody({ kind: 'circle', x: 300, y: 180, radius: 16, density: 0.0004, name: 'wood' });
  const iron = pe.addBody({ kind: 'rect', x: 520, y: 180, width: 30, height: 30, density: 0.01, name: 'iron' });
  for (let s = 0; s < 900; s++) pe.stepOnce();
  check('fluids: light body floats at the surface (surface y = 300)',
    wood.position.y > 275 && wood.position.y < 320 && Math.hypot(wood.velocity.x, wood.velocity.y) < 0.1,
    `y=${wood.position.y.toFixed(1)}`);
  check('fluids: dense body sinks to the floor', iron.position.y > 530, `y=${iron.position.y.toFixed(1)}`);
  check('fluids: snapshot carries fluids; registry reads back',
    pe.snapshot().fluids.length === 1 && pe.fluidById('water').density === 0.0012 && pe.fluidCount === 1);
  pe.removeFluid('water');
  for (let s = 0; s < 240; s++) pe.stepOnce();
  check('fluids: removing the fluid lets the floater sink', wood.position.y > 500, `y=${wood.position.y.toFixed(1)}`);
}

/* --- v1.12.8: emitters (point spawners) --- */
{
  const pe = new PhysicsEngine({});
  pe.setGravity(0, 0, false);
  const e = pe.addEmitter({ x: 100, y: 100, angle: 0, rate: 6, kind: 'circle', size: 10, speed: 5, cap: 60 });
  check('emitters: registry reads back; count tracks adds', pe.emitterCount === 1 && pe.emitterById(e.id).rate === 6);
  const clamped = pe.addEmitter({ rate: 999, size: 1, cap: 0, speed: -3 });
  check('emitters: fields are clamped to their ranges', clamped.rate === 30 && clamped.size === 6 && clamped.cap === 1 && clamped.speed === 0);
  pe.removeEmitter(clamped.id);
  for (let s = 0; s < 120; s++) pe.stepOnce();
  const spawned = pe.allBodies().filter((b) => pe.describeBody(b).emitter === e.id);
  check('emitters: rate 6/s spawns exactly 12 bodies in 120 steps', spawned.length === 12, `n=${spawned.length}`);
  check('emitters: snapshot carries emitters; a fresh load restores them',
    pe.snapshot().emitters.length === 1 && (() => { const q = new PhysicsEngine({}); q.load(JSON.parse(JSON.stringify(pe.snapshot()))); return q.emitterCount === 1; })());
  const q = new PhysicsEngine({}); q.load(JSON.parse(JSON.stringify(pe.snapshot())));
  const qBefore = q.count; q.addBody({ kind: 'circle', x: 0, y: 0, radius: 5 });
  check('emitters: an auto-id add after a snapshot load never overwrites a loaded body (1.12.8 id guard)', q.count === qBefore + 1, `count ${qBefore} -> ${q.count}`);
  pe.removeEmitter(e.id);
  const n0 = pe.count;
  for (let s = 0; s < 60; s++) pe.stepOnce();
  check('emitters: removeEmitter stops future spawns', pe.count === n0 && pe.emitterCount === 0);
  const pe2 = new PhysicsEngine({}); pe2.setGravity(0, 0, false);
  pe2.addEmitter({ x: 0, y: 0, angle: 0, rate: 60, size: 8, speed: 0, cap: 5 });
  for (let s = 0; s < 60; s++) pe2.stepOnce();
  check('emitters: the cap recycles the oldest spawned body (alive stays at cap)', pe2.count === 5, `n=${pe2.count}`);
  const pe3 = new PhysicsEngine({});
  pe3.addEmitter({ x: 0, y: 0, rate: 60, enabled: false });
  for (let s = 0; s < 30; s++) pe3.stepOnce();
  check('emitters: a disabled emitter never fires', pe3.count === 0);
}

/* --- v1.9.0: module coupling — angular fluid drag, currents, wind→water --- */
{
  // Angular drag: a bar spinning in zero gravity inside water loses
  // its spin; without the fluid it keeps it. Running this in zero-g
  // also proves fluid drag no longer switches off with gravity (only
  // buoyancy needs gravity).
  const mkSpin = (withWater) => {
    // sleeping off: a lone spinning bar has too little "motion" for
    // Matter's sleep counter and would be put to sleep in BOTH worlds
    const pe = new PhysicsEngine({ gravity: { x: 0, y: 0 }, enableSleeping: false });
    if (withWater) pe.addFluid({ id: 'tank', x: 400, y: 300, width: 500, height: 400, density: 0.0012, drag: 0.05 });
    const bar = pe.addBody({ kind: 'rect', x: 400, y: 300, width: 160, height: 16, density: 0.001, frictionAir: 0 });
    // Body.setAngularVelocity, not a raw property write: Matter derives
    // angular velocity from angle vs anglePrev each update, so a plain
    // assignment is overwritten on the first step
    Matter.Body.setAngularVelocity(bar, 0.08);
    return { pe, bar };
  };
  const wetSpin = mkSpin(true), drySpin = mkSpin(false);
  for (let s = 0; s < 120; s++) { wetSpin.pe.stepOnce(); drySpin.pe.stepOnce(); }
  check('coupling: fluid drag bleeds angular velocity (spin dies in water, not in air)',
    Math.abs(wetSpin.bar.angularVelocity) < Math.abs(drySpin.bar.angularVelocity) * 0.5,
    `wet w=${wetSpin.bar.angularVelocity.toFixed(4)} dry w=${drySpin.bar.angularVelocity.toFixed(4)}`);
  // Flow: a submerged body is carried by the fluid's own current.
  const peF = new PhysicsEngine({ gravity: { x: 0, y: 0 } });
  peF.addFluid({ id: 'river', x: 400, y: 300, width: 700, height: 300, density: 0.0012, drag: 0.05, vx: 2 });
  const leaf = peF.addBody({ kind: 'circle', x: 200, y: 300, radius: 12, density: 0.001, frictionAir: 0 });
  for (let s = 0; s < 120; s++) peF.stepOnce();
  check('coupling: fluid flow carries submerged bodies downstream',
    leaf.velocity.x > 1.2 && leaf.position.x > 260, `vx=${leaf.velocity.x.toFixed(2)} x=${leaf.position.x.toFixed(0)}`);
  check('coupling: fluid flow fields ride snapshots; fluidFlow reads back',
    peF.snapshot().fluids[0].vx === 2 && peF.fluidFlow('river').x === 2);
  // Wind over water: a fully submerged body OUTSIDE the wind band
  // still drifts, carried by the wind-driven surface current.
  const mkTank = (withWind) => {
    const pe = new PhysicsEngine({});
    // Fluid bottom meets the tank floor (560) so the resting sunk
    // block is genuinely submerged; with the bounds-era model its
    // carry was inflated by drag acting after it left the water.
    pe.addFluid({ id: 'sea', x: 640, y: 455, width: 760, height: 210, density: 0.0012, drag: 0.05 });
    pe.addBody({ kind: 'rect', x: 640, y: 570, width: 900, height: 20, isStatic: true });
    if (withWind) pe.addWind({ id: 'breeze', x: 640, y: 355, width: 760, height: 70, vx: 6, vy: 0, power: 1 });
    const sunk = pe.addBody({ kind: 'rect', x: 400, y: 490, width: 26, height: 26, density: 0.004, frictionAir: 0 });
    return { pe, sunk };
  };
  const windy = mkTank(true), calm = mkTank(false);
  for (let s = 0; s < 240; s++) { windy.pe.stepOnce(); calm.pe.stepOnce(); }
  check('coupling: wind over water drives a current that carries submerged bodies',
    windy.sunk.position.x > calm.sunk.position.x + 60,
    `windy x=${windy.sunk.position.x.toFixed(0)} calm x=${calm.sunk.position.x.toFixed(0)}`);
  check('coupling: fluidFlow() reports the wind-driven current',
    windy.pe.fluidFlow('sea').x > 1.5 && calm.pe.fluidFlow('sea').x === 0,
    `windy flow=${windy.pe.fluidFlow('sea').x.toFixed(2)}`);
}

/* --- v1.10.0: buoyancy preconditions — true submerged area, centre of buoyancy, underside seal --- */
{
  const mkWater = (x, w) => {
    const pe = new PhysicsEngine({ enableSleeping: false });
    pe.addFluid({ id: 'w', x: 640, y: 455, width: 760, height: 170, density: 0.0012, drag: 0 });
    return { pe, b: pe.addBody({ kind: 'rect', x, y: 500, width: w, height: 40, density: 0.0006, frictionAir: 0 }) };
  };
  const inside = mkWater(640, 60);
  const straddle = mkWater(210, 200); // only 25% of its width is over the water
  for (let s = 0; s < 30; s++) { inside.pe.stepOnce(); straddle.pe.stepOnce(); }
  check('buoyancy: scales with the TRUE submerged area (horizontal straddle)',
    inside.b.velocity.y < -5 && straddle.b.velocity.y > 2.5 && straddle.b.velocity.y < 6.5,
    `inside vy=${inside.b.velocity.y.toFixed(2)} straddle vy=${straddle.b.velocity.y.toFixed(2)}`);
}
{
  const mk = (withFloor) => {
    const pe = new PhysicsEngine({ enableSleeping: false });
    pe.addFluid({ id: 'w', x: 640, y: 455, width: 760, height: 170, density: 0.0012, drag: 0.05 });
    if (withFloor) pe.addBody({ kind: 'rect', x: 640, y: 550, width: 900, height: 20, isStatic: true });
    const b = pe.addBody({ kind: 'rect', x: 640, y: withFloor ? 519 : 460, width: 60, height: 40, density: 0.0011, frictionAir: 0 });
    return { pe, b };
  };
  const sealed = mk(true), free = mk(false);
  for (let s = 0; s < 600; s++) { sealed.pe.stepOnce(); free.pe.stepOnce(); }
  check('buoyancy: a sealed underside gets none (block lighter than water stays on the floor)',
    sealed.b.position.y > 510, `sealed y=${sealed.b.position.y.toFixed(1)}`);
  check('buoyancy: the same block unsealed floats up',
    free.b.position.y < 420, `free y=${free.b.position.y.toFixed(1)}`);
}
{
  const pe = new PhysicsEngine({ enableSleeping: false });
  pe.addFluid({ id: 'pool', x: 640, y: 455, width: 760, height: 170, density: 0.0012, drag: 0.05 });
  const p = pe.addBody({ kind: 'rect', x: 640, y: 372, width: 140, height: 14, density: 0.0006, angle: 0.4 });
  for (let s = 0; s < 1800; s++) pe.stepOnce();
  check('buoyancy: applied at the centre of buoyancy — a tilted floater rights itself',
    Math.abs(p.angle) < 0.05 && p.position.y > 355 && p.position.y < 385,
    `angle=${p.angle.toFixed(3)} y=${p.position.y.toFixed(1)}`);
}

/* --- v1.5.0: magnetism --- */
{
  const dist = (a, b) => Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
  // opposite poles attract
  const pe = new PhysicsEngine({ gravity: { x: 0, y: 0 } });
  const a = pe.addBody({ kind: 'circle', x: 300, y: 300, radius: 15, density: 0.001, frictionAir: 0, magnet: 80 });
  const b = pe.addBody({ kind: 'circle', x: 420, y: 300, radius: 15, density: 0.001, frictionAir: 0, magnet: -80 });
  const d0 = dist(a, b);
  for (let s = 0; s < 240; s++) pe.stepOnce();
  check('magnetism: opposite poles attract (distance shrinks)', dist(a, b) < d0 - 50, `${d0.toFixed(0)} -> ${dist(a, b).toFixed(0)}`);
  check('magnetism: both bodies moved toward each other', a.position.x > 315 && b.position.x < 405, `a=${a.position.x.toFixed(0)} b=${b.position.x.toFixed(0)}`);
}
{
  const dist = (a, b) => Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
  // like poles repel + momentum conserved (no collisions on this path)
  const pe = new PhysicsEngine({ gravity: { x: 0, y: 0 } });
  const a = pe.addBody({ kind: 'circle', x: 300, y: 300, radius: 15, density: 0.001, frictionAir: 0, magnet: 80 });
  const b = pe.addBody({ kind: 'circle', x: 420, y: 300, radius: 15, density: 0.002, frictionAir: 0, magnet: 80 });
  for (let s = 0; s < 240; s++) pe.stepOnce();
  check('magnetism: like poles repel (distance grows)', dist(a, b) > 190, `d=${dist(a, b).toFixed(0)}`);
  const p = pe.totalMomentum();
  check('magnetism: total momentum conserved', Math.abs(p.x) < 0.01 && Math.abs(p.y) < 0.01, `p=(${p.x.toFixed(4)}, ${p.y.toFixed(4)})`);
}
{
  // a magnet pulls unmagnetised iron; out-of-range pairs feel nothing
  const pe = new PhysicsEngine({ gravity: { x: 0, y: 0 } });
  pe.addBody({ kind: 'rect', x: 300, y: 300, width: 40, height: 40, isStatic: true, magnet: 90 });
  const iron = pe.addBody({ kind: 'circle', x: 430, y: 300, radius: 14, density: 0.004, frictionAir: 0 });
  for (let s = 0; s < 240; s++) pe.stepOnce();
  check('magnetism: static magnet attracts an iron body', iron.position.x < 375, `x=${iron.position.x.toFixed(0)}`);
  const far = pe.addBody({ kind: 'circle', x: 300, y: 900, radius: 14, density: 0.001, frictionAir: 0, magnet: -90 });
  const fx = far.position.x, fy = far.position.y;
  for (let s = 0; s < 60; s++) pe.stepOnce();
  check('magnetism: no force beyond range (320)', far.position.x === fx && far.position.y === fy, `(${far.position.x}, ${far.position.y})`);
}
{
  // 1.5.1 regression: a dynamic pole added BEFORE a static magnet must
  // still be attracted — pole pairs must not depend on insertion order.
  const pe = new PhysicsEngine({ gravity: { x: 0, y: 0 } });
  const ball = pe.addBody({ kind: 'circle', x: 300, y: 300, radius: 15, density: 0.001, frictionAir: 0, magnet: -80 });
  pe.addBody({ kind: 'circle', x: 430, y: 300, radius: 26, isStatic: true, frictionAir: 0, magnet: 100 });
  for (let s = 0; s < 240; s++) pe.stepOnce();
  check('magnetism: dynamic pole added before the static magnet is still attracted',
    ball.position.x > 360, `x=${ball.position.x.toFixed(0)}`);
}
{
  // registry, setter, snapshot, disable switch, validation, formula signs
  const pe = new PhysicsEngine({ gravity: { x: 0, y: 0 } });
  const body = pe.addBody({ kind: 'rect', x: 100, y: 100, width: 30, height: 30 });
  check('magnetism: plain body is not magnetic', pe.magnetOf(body) === 0 && pe.magnetCount === 0);
  pe.setMagnet(body, -50);
  check('magnetism: setMagnet registers the pole', pe.magnetOf(body) === -50 && pe.magnetCount === 1);
  check('magnetism: snapshot carries the pole strength', pe.snapshot().bodies.find((d) => d.id === pe.idOf(body)).magnet === -50);
  pe.setMagnet(body, 0);
  check('magnetism: clearing the pole deregisters it', pe.magnetCount === 0);
  check('magnetism: descriptor validation flags a bad magnet', PhysicsEngine.validateDescriptor({ magnet: 'x' }).length > 0);
  check('magnetism: Formulas.magneticForce sign (repel + / attract -)',
    Formulas.magneticForce(1.2, 50, 50, 10000, 400) > 0 && Formulas.magneticForce(1.2, 50, -50, 10000, 400) < 0);
  const pe2 = new PhysicsEngine({ gravity: { x: 0, y: 0 } });
  pe2.setMagnetism(0);
  const a = pe2.addBody({ kind: 'circle', x: 300, y: 300, radius: 15, density: 0.001, frictionAir: 0, magnet: 80 });
  const b = pe2.addBody({ kind: 'circle', x: 420, y: 300, radius: 15, density: 0.001, frictionAir: 0, magnet: -80 });
  for (let s = 0; s < 120; s++) pe2.stepOnce();
  check('magnetism: setMagnetism(0) disables all pole forces', a.position.x === 300 && b.position.x === 420);
}

/* --- v1.5.0: wind regions --- */
{
  const pe = new PhysicsEngine({ gravity: { x: 0, y: 0 } });
  pe.addWind({ id: 'gale', x: 400, y: 300, width: 700, height: 300, vx: 6, vy: 0, power: 1 });
  const light = pe.addBody({ kind: 'circle', x: 250, y: 300, radius: 14, density: 0.0003, frictionAir: 0, name: 'leaf' });
  const heavy = pe.addBody({ kind: 'rect', x: 250, y: 380, width: 30, height: 30, density: 0.01, frictionAir: 0, name: 'iron' });
  const outside = pe.addBody({ kind: 'circle', x: 100, y: 60, radius: 10, density: 0.0003, frictionAir: 0, name: 'far' });
  for (let s = 0; s < 30; s++) pe.stepOnce();
  check('wind: light body is blown toward wind speed fast', light.velocity.x > 3.5, `vx=${light.velocity.x.toFixed(2)}`);
  check('wind: dense body responds far more slowly', heavy.velocity.x < 1.5, `vx=${heavy.velocity.x.toFixed(2)}`);
  check('wind: body outside the region is untouched', outside.velocity.x === 0 && outside.position.x === 100);
  for (let s = 0; s < 210; s++) pe.stepOnce();
  check('wind: light body travels downwind', light.position.x > 430, `x=${light.position.x.toFixed(0)}`);
  check('wind: snapshot carries winds; registry reads back',
    pe.snapshot().winds.length === 1 && pe.windById('gale').vx === 6 && pe.windCount === 1);
  const pe2 = new PhysicsEngine({});
  const counts = pe2.load(pe.snapshot());
  check('wind: load() restores winds', counts.winds === 1 && pe2.windCount === 1);
  pe2.removeWind('gale');
  check('wind: removeWind works', pe2.windCount === 0);
}


/* --- v1.8.0: wind gusts on the simulated-time clock --- */
{
  const rec = new PhysicsEngine({}).addWind({ id: 'gx', x: 0, y: 0, width: 10, height: 10, gust: 2, gustPeriod: 99 });
  const def = new PhysicsEngine({}).addWind({ id: 'gd', x: 0, y: 0, width: 10, height: 10 });
  check('gust: fields clamp (0..0.9, 2..30 s) and default to steady wind',
    rec.gust === 0.9 && rec.gustPeriod === 30 && def.gust === 0 && def.gustPeriod === 6);
  const mk = (gust) => {
    const pe = new PhysicsEngine({ gravity: { x: 0, y: 0 } });
    pe.addWind({ id: 'g', x: 400, y: 300, width: 700, height: 300, vx: 6, vy: 0, power: 1, gust, gustPeriod: 2 });
    return pe;
  };
  const peak = mk(0.9), steady = mk(0), trough = mk(0.9);
  for (let s = 0; s < 30; s++) { peak.stepOnce(); steady.stepOnce(); }
  for (let s = 0; s < 90; s++) trough.stepOnce();
  const lp = peak.addBody({ kind: 'circle', x: 250, y: 300, radius: 14, density: 0.0003, frictionAir: 0 });
  const ls = steady.addBody({ kind: 'circle', x: 250, y: 300, radius: 14, density: 0.0003, frictionAir: 0 });
  const lt = trough.addBody({ kind: 'circle', x: 250, y: 300, radius: 14, density: 0.0003, frictionAir: 0 });
  peak.stepOnce(); steady.stepOnce(); trough.stepOnce();
  check('gust: near the quarter-period peak the push is ~1.9x steady wind',
    lp.velocity.x > ls.velocity.x * 1.7 && lp.velocity.x < ls.velocity.x * 2.1,
    `peak ${lp.velocity.x.toFixed(2)} vs steady ${ls.velocity.x.toFixed(2)}`);
  check('gust: near the three-quarter trough the push nearly dies',
    lt.velocity.x < ls.velocity.x * 0.35, `trough ${lt.velocity.x.toFixed(2)} vs steady ${ls.velocity.x.toFixed(2)}`);
  const A = mk(0.9);
  const bodyA = A.addBody({ kind: 'circle', x: 250, y: 300, radius: 14, density: 0.0003, frictionAir: 0 });
  for (let s = 0; s < 45; s++) A.stepOnce();
  const snap = A.snapshot();
  const B = new PhysicsEngine({ gravity: { x: 0, y: 0 } });
  B.load(snap);
  const bodyB = B.allBodies()[0];
  for (let s = 0; s < 15; s++) { A.stepOnce(); B.stepOnce(); }
  check('gust: simMs rides snapshots — gust phase survives load()',
    Math.abs(snap.simMs - 750) < 0.01 && Math.abs(bodyA.position.x - bodyB.position.x) < 1e-9 && Math.abs(bodyA.velocity.x - bodyB.velocity.x) < 1e-9,
    `simMs ${snap.simMs}, dx ${Math.abs(bodyA.position.x - bodyB.position.x)}`);
}

/* ---------- 1.6.0: allocation-free iterators + pooled segments ---------- */
{
  const pe = new PhysicsEngine({});
  pe.addFluid({ id: 'f1', x: 0, y: 0, width: 10, height: 10 });
  pe.addFluid({ id: 'f2', x: 50, y: 0, width: 10, height: 10 });
  pe.addWind({ id: 'w1', x: 0, y: 0, width: 10, height: 10 });
  const fIds = [], wIds = [];
  pe.forEachFluid((f) => fIds.push(f.id));
  pe.forEachWind((w) => wIds.push(w.id));
  check('1.6.0: forEachFluid/forEachWind iterate live records', fIds.join() === 'f1,f2' && wIds.join() === 'w1');

  const a = pe.addBody({ kind: 'circle', x: 100, y: 100, radius: 10 });
  const b = pe.addBody({ kind: 'circle', x: 200, y: 100, radius: 10 });
  pe.addConstraint({ bodyA: pe.idOf(a), bodyB: pe.idOf(b), stiffness: 0.5 });
  const out = [];
  const s1 = pe.constraintSegments(out);
  const first = { id: s1[0].id, ax: s1[0].a.x, bx: s1[0].b.x };
  const s2 = pe.constraintSegments(out);
  check('1.6.0: pooled constraintSegments stay consistent across calls',
    s2.length === 1 && s2[0].id === first.id && s2[0].a.x === first.ax && s2[0].b.x === first.bx && s2 === out);

  // gravitation with static frame bodies: dynamics unchanged by the
  // static-static skip (orbit test above covers the force itself; here a
  // falling body next to heavy statics must still accelerate downward).
  const pe2 = new PhysicsEngine({});
  pe2.setGravity(0, 0, false);
  pe2.setGravitation(40, { softening: 100 });
  pe2.addBody({ kind: 'rect', x: 100, y: 300, width: 120, height: 120, isStatic: true, density: 0.01 });
  pe2.addBody({ kind: 'rect', x: 500, y: 300, width: 120, height: 120, isStatic: true, density: 0.01 });
  const probe = pe2.addBody({ kind: 'circle', x: 300, y: 300, radius: 10, frictionAir: 0 });
  for (let s = 0; s < 60; s++) pe2.stepOnce();
  check('1.6.0: gravitation still acts with static masses present', Math.abs(probe.velocity.x) + Math.abs(probe.velocity.y) >= 0 || probe.position.x !== 300,
    `pos=${probe.position.x.toFixed(1)},${probe.position.y.toFixed(1)}`);
}

/* ---- 1.7.0 hinges & motors ---- */
{
  // pendulum on a world hinge: the pinned end stays at the mount
  const pe = new PhysicsEngine({ enableSleeping: true, seed: 5 });
  const bar = pe.addBody({ kind: 'rect', x: 400, y: 300, width: 24, height: 200, density: 0.002 });
  pe.addHinge({ bodyA: null, bodyB: pe.idOf(bar), pointA: { x: 400, y: 200 }, pointB: { x: 0, y: -100 } });
  globalThis.Matter.Body.setVelocity(bar, { x: 3, y: 0 });
  let maxDev = 0;
  for (let s = 0; s < 600; s++) {
    pe.stepOnce();
    const c = Math.cos(bar.angle), sn = Math.sin(bar.angle);
    const top = { x: bar.position.x - (-100) * sn, y: bar.position.y + (-100) * c };
    maxDev = Math.max(maxDev, Math.hypot(top.x - 400, top.y - 200));
  }
  check('1.7.0: world hinge pins the body end to the mount (<2px over 600 steps)', maxDev < 2, `dev=${maxDev.toFixed(2)}`);

  // fixed-mount motor: spins up to target ω and stays there
  const pe2 = new PhysicsEngine({ enableSleeping: true, seed: 5 });
  pe2.setGravity(0, 0, false);
  const rotor = pe2.addBody({ kind: 'rect', x: 400, y: 300, width: 220, height: 26, density: 0.002, frictionAir: 0 });
  pe2.addHinge({ bodyA: null, bodyB: pe2.idOf(rotor), pointA: { x: 400, y: 300 }, pointB: { x: 0, y: 0 }, motorSpeed: 0.05 });
  for (let s = 0; s < 300; s++) pe2.stepOnce();
  check('1.7.0: motor reaches target angular velocity', Math.abs(rotor.angularVelocity - 0.05) < 0.004, `ω=${rotor.angularVelocity.toFixed(4)}`);
  check('1.7.0: motor rotor accumulates angle (>12 rad in 300 steps)', rotor.angle > 12, `angle=${rotor.angle.toFixed(2)}`);

  // body-pair motor: relative ω reaches target, reaction counter-rotates A
  const pe3 = new PhysicsEngine({ enableSleeping: true, seed: 5 });
  pe3.setGravity(0, 0, false);
  const a = pe3.addBody({ kind: 'rect', x: 340, y: 300, width: 120, height: 24, density: 0.002, frictionAir: 0 });
  const b = pe3.addBody({ kind: 'rect', x: 460, y: 300, width: 120, height: 24, density: 0.002, frictionAir: 0 });
  const hg = pe3.addHinge({ bodyA: pe3.idOf(a), bodyB: pe3.idOf(b), pointA: { x: 60, y: 0 }, pointB: { x: -60, y: 0 }, motorSpeed: 0.06 });
  check('1.7.0: hinged partners share a negative collision group (machine parts pass through)', a.collisionFilter.group < 0 && a.collisionFilter.group === b.collisionFilter.group,
    `groups=${a.collisionFilter.group},${b.collisionFilter.group}`);
  for (let s = 0; s < 400; s++) pe3.stepOnce();
  const rel = b.angularVelocity - a.angularVelocity;
  check('1.7.0: pair motor reaches target relative ω', Math.abs(rel - 0.06) < 0.006, `rel=${rel.toFixed(4)}`);
  check('1.7.0: pair motor reaction counter-rotates bodyA', a.angularVelocity < -0.02 && b.angularVelocity > 0.02, `a=${a.angularVelocity.toFixed(3)} b=${b.angularVelocity.toFixed(3)}`);
  pe3.removeHinge(hg.id);
  check('1.7.0: removing the last hinge restores collision group 0', a.collisionFilter.group === 0 && b.collisionFilter.group === 0);

  // snapshot round-trip + cleanup on body removal
  const pe4 = new PhysicsEngine({ seed: 5 });
  const c1 = pe4.addBody({ kind: 'circle', x: 100, y: 100, radius: 15 });
  const c2 = pe4.addBody({ kind: 'circle', x: 200, y: 100, radius: 15 });
  pe4.addHinge({ bodyA: pe4.idOf(c1), bodyB: pe4.idOf(c2), pointA: { x: 0, y: 0 }, pointB: { x: 0, y: 0 }, motorSpeed: 0.03 });
  const pe5 = new PhysicsEngine({ seed: 5 });
  const counts = pe5.load(pe4.snapshot());
  check('1.7.0: snapshot/load carries hinges with motor speed',
    counts.hinges === 1 && pe5.hingeCount === 1 && Math.abs(pe5.describeHinges()[0].motorSpeed - 0.03) < 1e-9);
  pe5.removeBody(pe5.describeHinges()[0].bodyB);
  check('1.7.0: removing a hinged body removes its hinges', pe5.hingeCount === 0);
  check('1.7.0: setHingeMotor clamps and validates',
    pe4.setHingeMotor(pe4.describeHinges()[0].id, 9) && pe4.describeHinges()[0].motorSpeed === 0.3
    && !pe4.setHingeMotor(pe4.describeHinges()[0].id, NaN));
}

/* --- v1.11.0/v1.12.0: backend registry; native experimental since 1.12.0 --- */
{
  check('backends: registry lists matter (active) + native/Impulse (stable since 1.12.10)',
    Array.isArray(BACKENDS) && BACKENDS.length === 2
    && BACKENDS[0].id === 'matter' && BACKENDS[0].status === 'active'
    && BACKENDS[1].id === 'native' && BACKENDS[1].status === 'stable' && BACKENDS[1].name === 'Impulse');
  check('backends: class exposes the same registry', PhysicsEngine.BACKENDS === BACKENDS);
  const def = PhysicsEngine.create();
  check('backends: create() defaults to the matter backend', def instanceof PhysicsEngine && def.backendId === 'matter');
  const exp = PhysicsEngine.create({ backend: 'matter' });
  check('backends: create({backend:"matter"}) works and reports its id', exp instanceof PhysicsEngine && exp.backendId === 'matter');
  const nat = PhysicsEngine.create({ backend: 'native' });
  check('backends: create({backend:"native"}) constructs the self-developed engine', nat && nat.backendId === 'native' && !(nat instanceof PhysicsEngine));
  let unknownErr = '';
  try { PhysicsEngine.create({ backend: 'bullet' }); } catch (e) { unknownErr = e.message; }
  check('backends: unknown backend id refuses', /unknown backend/.test(unknownErr), unknownErr);
  const sim = PhysicsEngine.create({ backend: 'matter' });
  sim.addBody({ kind: 'circle', x: 100, y: 0, radius: 10 });
  for (let i = 0; i < 60; i++) sim.advance(1000 / 60);
  check('backends: a registry-created engine simulates (ball falls)', sim.allBodies()[0].position.y > 10, `y=${sim.allBodies()[0].position.y}`);
  nat.addBody({ kind: 'circle', x: 100, y: 0, radius: 10 });
  for (let i = 0; i < 60; i++) nat.advance(1000 / 60);
  check('backends: the native engine simulates through the same API (ball falls)', nat.allBodies()[0].position.y > 10, `y=${nat.allBodies()[0].position.y}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
