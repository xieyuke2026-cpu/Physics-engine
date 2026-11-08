/* NativeEngine tests — the self-developed solver backend (1.41) must
   honour the PhysicsEngine API's behaviour on its own: no Matter.js
   involved anywhere in this file.
   Run: node tests/native-tests.mjs */
const { PhysicsEngine, BACKENDS } = await import('../js/engine/physics-engine.js');
const { NativeEngine } = await import('../js/engine/native-engine.js');

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
}
const near = (a, b, eps = 2) => Math.abs(a - b) <= eps;
const step = (e, n) => { for (let i = 0; i < n; i++) e.advance(1000 / 60); };

/* --- registry: the factory now builds the native backend --- */
{
  const e = PhysicsEngine.create({ backend: 'native', enableSleeping: true });
  check('create({backend:"native"}) returns a NativeEngine', e instanceof NativeEngine);
  check('native instance carries backendId "native"', e.backendId === 'native');
  const reg = BACKENDS.find((b) => b.id === 'native');
  check('BACKENDS marks native experimental (no longer planned)', reg && reg.status === 'experimental');
  check('substeps floor: native clamps substeps to >= 2', new NativeEngine({ substeps: 1 }).substeps === 2);
}

/* --- gravity: a ball falls and rests exactly on the floor --- */
{
  const e = new NativeEngine({ enableSleeping: true });
  e.addBody({ kind: 'rect', x: 640, y: 560, width: 1280, height: 40, isStatic: true });
  const ball = e.addBody({ kind: 'circle', x: 640, y: 100, radius: 20, restitution: 0.2 });
  step(e, 240);
  check('ball rests on the floor (y = 540 - r)', near(ball.position.y, 520, 2), `y=${ball.position.y.toFixed(1)}`);
  check('rested ball is (nearly) still', Math.abs(ball.velocity.y) < 0.05, `vy=${ball.velocity.y.toFixed(3)}`);
  check('no non-finite bodies after the fall', e.findNonFiniteBodies().length === 0);
}

/* --- restitution: a dropped ball rebounds, but lower than it fell --- */
{
  const e = new NativeEngine();
  e.addBody({ kind: 'rect', x: 400, y: 560, width: 800, height: 40, isStatic: true });
  const ball = e.addBody({ kind: 'circle', x: 400, y: 300, radius: 15, restitution: 0.6, frictionAir: 0 });
  let minY = Infinity, rebounded = false;
  for (let i = 0; i < 200; i++) {
    e.advance(1000 / 60);
    if (ball.position.y < minY) minY = ball.position.y;
    if (i > 40 && ball.velocity.y < -1) rebounded = true;
  }
  check('bouncy ball leaves the floor moving up', rebounded);
  check('rebound apex stays below the drop point (energy loss)', minY > 300 - 240 || ball.position.y > 400, `minY=${minY.toFixed(0)}`);
}

/* --- friction: a sliding box is braked to a stop on the floor --- */
{
  const e = new NativeEngine();
  e.addBody({ kind: 'rect', x: 400, y: 560, width: 1600, height: 40, isStatic: true, friction: 0.4 });
  const box = e.addBody({ kind: 'rect', x: 200, y: 519, width: 40, height: 40, friction: 0.4, vx: 6 });
  step(e, 300);
  check('sliding box stops', Math.abs(box.velocity.x) < 0.05, `vx=${box.velocity.x.toFixed(3)}`);
  check('box travelled but stayed on the floor', box.position.x > 260 && near(box.position.y, 520, 2), `x=${box.position.x.toFixed(0)} y=${box.position.y.toFixed(1)}`);
}

/* --- stacking: a 5-box tower and a 15-box pyramid settle and sleep --- */
{
  const e = new NativeEngine({ enableSleeping: true });
  e.addBody({ kind: 'rect', x: 400, y: 560, width: 800, height: 40, isStatic: true });
  const boxes = [];
  for (let i = 0; i < 5; i++) boxes.push(e.addBody({ kind: 'rect', x: 400, y: 519 - i * 41, width: 40, height: 40, friction: 0.6 }));
  step(e, 600);
  check('5-tower stays upright', boxes.every((b) => Math.abs(b.position.x - 400) < 6), boxes.map((b) => b.position.x.toFixed(0)).join(','));
  check('5-tower angles stay tiny', Math.max(...boxes.map((b) => Math.abs(b.angle))) < 0.02);
  check('5-tower falls asleep', boxes.every((b) => b.isSleeping));
}
{
  const e = new NativeEngine({ enableSleeping: true });
  e.addBody({ kind: 'rect', x: 640, y: 560, width: 1280, height: 40, isStatic: true });
  const boxes = [];
  for (let row = 0; row < 5; row++) {
    const n = 5 - row;
    for (let i = 0; i < n; i++) boxes.push(e.addBody({ kind: 'rect', x: 640 + (i - (n - 1) / 2) * 44, y: 500 - row * 42, width: 40, height: 40, friction: 0.5 }));
  }
  step(e, 600);
  check('pyramid keeps its span', Math.max(...boxes.map((b) => b.position.x)) - Math.min(...boxes.map((b) => b.position.x)) < 190);
  check('pyramid angles stay tiny', Math.max(...boxes.map((b) => Math.abs(b.angle))) < 0.02);
  check('pyramid falls asleep', boxes.every((b) => b.isSleeping));
}

/* --- constraints: a pendulum rod keeps its length; a spring breathes --- */
{
  const e = new NativeEngine();
  e.setGravity(0, 1, true);
  const bob = e.addBody({ kind: 'circle', x: 500, y: 200, radius: 14 });
  e.addConstraint({ bodyA: null, bodyB: bob.plugin.pe.id, pointA: { x: 300, y: 200 }, pointB: { x: 0, y: 0 }, stiffness: 1, damping: 0, length: 200 });
  let maxDev = 0;
  for (let i = 0; i < 240; i++) {
    e.advance(1000 / 60);
    const d = Math.hypot(bob.position.x - 300, bob.position.y - 200);
    maxDev = Math.max(maxDev, Math.abs(d - 200));
  }
  check('rod pendulum keeps its length', maxDev < 4, `maxDev=${maxDev.toFixed(2)}`);
  check('pendulum actually swings (bob drops below the anchor)', bob.position.y > 200);
}
{
  const e = new NativeEngine();
  e.setGravity(0, 0, false);
  const a = e.addBody({ kind: 'circle', x: 300, y: 300, radius: 12 });
  const b = e.addBody({ kind: 'circle', x: 420, y: 300, radius: 12 });
  e.addConstraint({ bodyA: a.plugin.pe.id, bodyB: b.plugin.pe.id, pointA: { x: 0, y: 0 }, pointB: { x: 0, y: 0 }, stiffness: 0.02, damping: 0.05, length: 80 });
  let minD = Infinity, maxD = 0;
  for (let i = 0; i < 240; i++) {
    e.advance(1000 / 60);
    const d = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y);
    minD = Math.min(minD, d); maxD = Math.max(maxD, d);
  }
  check('spring pulls the pair toward its rest length', maxD <= 120 && minD >= 40, `range=${minD.toFixed(0)}..${maxD.toFixed(0)}`);
  check('spring pair stays finite', e.findNonFiniteBodies().length === 0);
}

/* --- hinges: a pinned bar hangs from its anchor; a motor spins up --- */
{
  const e = new NativeEngine();
  const bar = e.addBody({ kind: 'rect', x: 400, y: 200, width: 160, height: 16 });
  e.addHinge({ bodyA: null, bodyB: bar.plugin.pe.id, pointA: { x: 320, y: 200 }, pointB: { x: -80, y: 0 } });
  step(e, 240);
  const anchor = e.hingeAnchors()[0];
  check('hinged bar stays pinned at the anchor', near(anchor.b.x, 320, 3) && near(anchor.b.y, 200, 3), `anchor=${anchor.b.x.toFixed(1)},${anchor.b.y.toFixed(1)}`);
  check('hinged bar hangs downward', bar.position.y > 230, `y=${bar.position.y.toFixed(0)}`);
}
{
  const e = new NativeEngine();
  e.setGravity(0, 0, false);
  const bar = e.addBody({ kind: 'rect', x: 400, y: 200, width: 120, height: 14 });
  const h = e.addHinge({ bodyA: null, bodyB: bar.plugin.pe.id, pointA: { x: 400, y: 200 }, pointB: { x: 0, y: 0 }, motorSpeed: 0.1, motorPower: 0.01 });
  step(e, 120);
  check('hinge motor spins the bar up toward its target', bar.angularVelocity > 0.05, `w=${bar.angularVelocity.toFixed(3)}`);
  check('motor hinge exists in the registry', e.hingeCount === 1 && !!h);
}

/* --- buoyancy: light floats at its line, dense sinks, sealed stays --- */
function poolWorld() {
  const e = new NativeEngine({ enableSleeping: true });
  e.addBody({ kind: 'rect', x: 400, y: 590, width: 800, height: 20, isStatic: true });        // tank floor (top 580)
  e.addBody({ kind: 'rect', x: 195, y: 480, width: 10, height: 200, isStatic: true });        // left wall
  e.addBody({ kind: 'rect', x: 605, y: 480, width: 10, height: 200, isStatic: true });        // right wall
  e.addFluid({ x: 400, y: 480, width: 400, height: 200, density: 0.0012, drag: 0.08 });      // surface at y=380
  return e;
}
{
  const e = poolWorld();
  const block = e.addBody({ kind: 'rect', x: 400, y: 340, width: 60, height: 60, density: 0.0006 }); // half the fluid density
  step(e, 600);
  const submerged = (block.position.y + 30) - 380;
  check('half-density block floats ~half submerged', submerged > 12 && submerged < 48, `submerged=${submerged.toFixed(0)}px of 60`);
}
{
  const e = poolWorld();
  const rock = e.addBody({ kind: 'rect', x: 400, y: 340, width: 60, height: 60, density: 0.003 });
  step(e, 600);
  check('dense block sinks to the tank floor', near(rock.position.y, 550, 3), `y=${rock.position.y.toFixed(1)}`);
}
{
  const e = poolWorld();
  const sealed = e.addBody({ kind: 'rect', x: 400, y: 550, width: 60, height: 60, density: 0.0006 });
  step(e, 300);
  check('floor-sealed light block does not self-float', sealed.position.y > 540, `y=${sealed.position.y.toFixed(1)}`);
}

/* --- wind: light bodies are blown, dense blocks barely stir --- */
{
  const e = new NativeEngine();
  e.setGravity(0, 0, false);
  e.addWind({ x: 400, y: 300, width: 800, height: 600, vx: 8, vy: 0, power: 1 });
  const feather = e.addBody({ kind: 'rect', x: 200, y: 300, width: 30, height: 30, density: 0.0002 });
  const block = e.addBody({ kind: 'rect', x: 200, y: 100, width: 30, height: 30, density: 0.01 });
  step(e, 30);
  check('wind blows the light body along', feather.velocity.x > 3, `vx=${feather.velocity.x.toFixed(2)}`);
  check('dense block barely responds to wind', block.velocity.x < feather.velocity.x * 0.4, `vx=${block.velocity.x.toFixed(2)}`);
}

/* --- magnetism & gravitation (pairwise, once per fixed step) --- */
{
  const e = new NativeEngine();
  e.setGravity(0, 0, false);
  e.addBody({ kind: 'circle', x: 300, y: 300, radius: 18, isStatic: true, magnet: 80 });
  const iron = e.addBody({ kind: 'circle', x: 460, y: 300, radius: 12 });
  const d0 = Math.abs(iron.position.x - 300);
  step(e, 90);
  const d1 = Math.abs(iron.position.x - 300);
  check('magnet attracts unmagnetised iron', d1 < d0 - 10, `d ${d0.toFixed(0)} -> ${d1.toFixed(0)}`);
}
{
  const e = new NativeEngine();
  e.setGravity(0, 0, false);
  e.setGravitation(500, { softening: 50 });
  const a = e.addBody({ kind: 'circle', x: 250, y: 300, radius: 10, density: 0.002, frictionAir: 0 });
  const b = e.addBody({ kind: 'circle', x: 400, y: 300, radius: 10, density: 0.002, frictionAir: 0 });
  const d0 = 150;
  step(e, 120);
  const d1 = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y);
  const p = e.totalMomentum();
  check('gravitation pulls two free bodies together', d1 < d0 - 60, `d ${d0} -> ${d1.toFixed(1)}`);
  check('gravitation conserves total momentum', Math.hypot(p.x, p.y) < 0.01, `|p|=${Math.hypot(p.x, p.y).toFixed(4)}`);
}

/* --- queries, dragging, lockRotation --- */
{
  const e = new NativeEngine({ enableSleeping: true });
  e.addBody({ kind: 'rect', x: 400, y: 560, width: 800, height: 40, isStatic: true });
  const box = e.addBody({ kind: 'rect', x: 400, y: 300, width: 40, height: 40 });
  check('pick finds the box', e.pick(400, 300) === box);
  check('queryRegion finds bodies', e.queryRegion(350, 250, 450, 350).includes(box));
  const hit = e.raycast(400, 100, 400, 500);
  check('raycast hits the box from above', hit && hit.body === box, hit ? `t=${hit.t.toFixed(2)}` : 'no hit');
  e.beginDrag(box, 400, 300);
  e.moveDrag(500, 200);
  step(e, 60);
  check('dragging pulls the body to the pointer', near(box.position.x, 500, 12) && near(box.position.y, 200, 12), `at ${box.position.x.toFixed(0)},${box.position.y.toFixed(0)}`);
  e.endDrag();
}
{
  const e = new NativeEngine();
  e.addBody({ kind: 'rect', x: 400, y: 560, width: 800, height: 40, isStatic: true });
  const plank = e.addBody({ kind: 'rect', x: 400, y: 300, width: 160, height: 14, lockRotation: true });
  e.setAngularVelocity(plank, 0.2);
  step(e, 120);
  check('lockRotation body never rotates', Math.abs(plank.angle) < 0.001 && plank.angularVelocity === 0, `angle=${plank.angle.toFixed(4)}`);
}

/* --- snapshot round trip + RNG continuity --- */
{
  const e = new NativeEngine({ enableSleeping: true, seed: 42 });
  e.addBody({ kind: 'rect', x: 400, y: 560, width: 800, height: 40, isStatic: true });
  const a = e.addBody({ kind: 'circle', x: 350, y: 300, radius: 16, name: 'a' });
  const b = e.addBody({ kind: 'rect', x: 450, y: 300, width: 36, height: 36 });
  e.addConstraint({ bodyA: a.plugin.pe.id, bodyB: b.plugin.pe.id, stiffness: 0.05, length: 120 });
  e.addFluid({ x: 400, y: 500, width: 300, height: 80 });
  step(e, 60);
  const snap = e.snapshot();
  const r1 = [e.random(), e.random()];
  const e2 = new NativeEngine();
  const counts = e2.load(snap);
  check('snapshot loads back (counts)', counts.bodies === 3 && counts.constraints === 1 && counts.fluids === 1, JSON.stringify(counts));
  const r2 = [e2.random(), e2.random()];
  check('RNG stream continues across snapshot/load', r1[0] === r2[0] && r1[1] === r2[1]);
  step(e, 60); step(e2, 60);
  const pa = e.bodyById(a.plugin.pe.id), pb = e2.bodyById(a.plugin.pe.id);
  check('reloaded world evolves equivalently (within solver noise)', near(pa.position.x, pb.position.x, 2.5) && near(pa.position.y, pb.position.y, 2.5),
    `(${pa.position.x.toFixed(1)},${pa.position.y.toFixed(1)}) vs (${pb.position.x.toFixed(1)},${pb.position.y.toFixed(1)})`);
}

/* --- v1.12.6: snapshot fidelity — spin + sleep state round-trip (twin) --- */
{
  const e1 = new NativeEngine({});
  const ball = e1.addBody({ kind: 'circle', x: 200, y: 100, radius: 20, vx: 2, frictionAir: 0 });
  ball.angularVelocity = 0.3;
  step(e1, 30);
  const snap = JSON.parse(JSON.stringify(e1.snapshot()));
  check('snapshot fidelity: snapshot carries va + sleeping fields',
    typeof snap.bodies[0].va === 'number' && snap.bodies[0].sleeping === false);
  const e2 = new NativeEngine({});
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

  const p1 = new NativeEngine({ enableSleeping: true });
  p1.addBody({ kind: 'rect', x: 200, y: 400, width: 600, height: 40, isStatic: true });
  for (let i = 0; i < 6; i++) p1.addBody({ kind: 'rect', x: 200, y: 300 - i * 34, width: 32, height: 32 });
  step(p1, 600);
  const asleepBefore = p1.allBodies().filter((b) => b.isSleeping && !b.isStatic).length;
  const p2 = new NativeEngine({ enableSleeping: true });
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

/* --- v1.12.7: noSleep descriptor flag (twin) --- */
{
  const e = new NativeEngine({ enableSleeping: true });
  e.addBody({ kind: 'rect', x: 200, y: 580, width: 600, height: 40, isStatic: true });
  const flagged = e.addBody({ kind: 'rect', x: 160, y: 500, width: 32, height: 32, noSleep: true });
  const plain = e.addBody({ kind: 'rect', x: 280, y: 500, width: 32, height: 32 });
  check('noSleep: descriptor round-trips through describeBody', e.describeBody(flagged).noSleep === true && e.describeBody(plain).noSleep === false);
  step(e, 400);
  check('noSleep: flagged body stays awake at rest while the plain twin sleeps',
    flagged.isSleeping === false && plain.isSleeping === true,
    `flagged=${flagged.isSleeping} plain=${plain.isSleeping}`);
  const e2 = new NativeEngine({ enableSleeping: true });
  e2.load(JSON.parse(JSON.stringify(e.snapshot())));
  const flagged2 = e2.allBodies().find((b) => e2.describeBody(b).noSleep === true);
  step(e2, 400);
  check('noSleep: survives snapshot -> load (still awake after 400 more steps)', !!flagged2 && flagged2.isSleeping === false);
}

/* --- a mini Galton board: many circle/polygon contacts stay finite --- */
{
  const e = new NativeEngine({ enableSleeping: true });
  e.addBody({ kind: 'rect', x: 400, y: 590, width: 800, height: 20, isStatic: true });
  e.addBody({ kind: 'rect', x: 6, y: 300, width: 12, height: 600, isStatic: true });
  e.addBody({ kind: 'rect', x: 794, y: 300, width: 12, height: 600, isStatic: true });
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i <= row; i++) {
      e.addBody({ kind: 'circle', x: 400 + (i - row / 2) * 56, y: 240 + row * 52, radius: 6, isStatic: true });
    }
  }
  e.setSeed(7);
  const balls = [];
  for (let i = 0; i < 12; i++) {
    balls.push(e.addBody({ kind: 'circle', x: 400 + (e.random() - 0.5) * 20, y: 60 + i * 4, radius: 9, restitution: 0.3 }));
  }
  step(e, 600);
  check('galton balls all leave the spawn zone and stay on the board', balls.every((b) => b.position.y > 150 && b.position.y < 580 && b.position.x > 12 && b.position.x < 788 && Number.isFinite(b.position.x)),
    balls.map((b) => b.position.y.toFixed(0)).join(','));
  check('galton world stays finite', e.findNonFiniteBodies().length === 0);
}

/* --- host rendering contract: every body exposes non-empty vertices ---
   (1.42 regression: circles shipped with vertices = [] and the app
   renderer, which opens each body's path at vertices[0], threw on the
   first circle — physics ran but the canvas showed only the grid) --- */
{
  const e = new NativeEngine({ enableSleeping: true });
  e.addBody({ kind: 'rect', x: 640, y: 560, width: 1280, height: 40, isStatic: true });
  const ball = e.addBody({ kind: 'circle', x: 640, y: 100, radius: 20, restitution: 0.2 });
  check('circle body exposes a vertices polygon (10–25 sides)',
    ball.vertices.length >= 10 && ball.vertices.length <= 25, `n=${ball.vertices.length}`);
  const bw = ball.bounds.max.x - ball.bounds.min.x;
  check('circle bounds hug the disc (polygon approximation)',
    bw > 36 && bw <= 40.01, `w=${bw.toFixed(1)}`);
  const v0y = ball.vertices[0].y;
  step(e, 30);
  check('circle vertices track the falling body',
    ball.vertices[0].y > v0y + 30 && near(ball.vertices[0].x, ball.position.x, 0.01),
    `dy=${(ball.vertices[0].y - v0y).toFixed(1)}`);
  const spin = e.addBody({ kind: 'circle', x: 300, y: 100, radius: 15, angle: Math.PI / 2 });
  check('circle vertices rotate with the body angle',
    near(spin.vertices[0].x, 300 + 15, 0.5) && near(spin.vertices[0].y, 100, 0.5),
    `v0=(${spin.vertices[0].x.toFixed(1)},${spin.vertices[0].y.toFixed(1)})`);
}

/* --- 1.43 regressions: the 796-body stress scene's three lessons ---
   (a) _clipSegment crashed when an incident vertex landed EXACTLY on a
   reference side plane (axis-aligned piles) — the scene froze mid-air
   under native while matter ran on: "results completely different".
   (b) Warm-start impulses re-applied on every substep double-counted
   (they persist in the velocities) and launched bodies early.
   (c) Instantaneous-threshold sleeping flickered in dense piles. --- */
{
  // (a) exactly-aligned box stack: every interface shares its x-extents
  // with the box below, so incident vertices sit exactly on side planes.
  const e = new NativeEngine({ enableSleeping: true });
  e.addBody({ kind: 'rect', x: 640, y: 560, width: 1280, height: 40, isStatic: true });
  const boxes = [];
  for (let i = 0; i < 6; i++) boxes.push(e.addBody({ kind: 'rect', x: 640, y: 520 - i * 40, width: 80, height: 40, friction: 0.5 }));
  step(e, 600); // would throw TypeError in _clipSegment before the fix
  check('aligned stack: no clip crash, stack stands', boxes.every((b) => Math.abs(b.position.x - 640) < 6),
    boxes.map((b) => Math.round(b.position.x)).join(','));
  check('aligned stack: boxes sleep', boxes.filter((b) => b.isSleeping).length >= 4,
    `sleeping=${boxes.filter((b) => b.isSleeping).length}/6`);
}
{
  // (b)+(c) 30-ball chute pile at the shipped configuration (substeps
  // 2): settles on the floor, partially sleeps, nothing sinks into the
  // slab or leaves the world. (Substeps > 2 in extreme piles against
  // thin walls can still squeeze a body through — known limit, see the
  // engine header; the app always runs substeps 2.)
  const e = new NativeEngine({ enableSleeping: true, substeps: 2 });
  e.addBody({ kind: 'rect', x: 640, y: 560, width: 1280, height: 40, isStatic: true });
  e.addBody({ kind: 'rect', x: 579, y: 300, width: 6, height: 480, isStatic: true });
  e.addBody({ kind: 'rect', x: 701, y: 300, width: 6, height: 480, isStatic: true });
  const balls = [];
  for (let i = 0; i < 30; i++) balls.push(e.addBody({ kind: 'circle', x: 640 + (i % 3 - 1) * 14, y: 40 + Math.floor(i / 3) * 34, radius: 13, restitution: 0.1, friction: 0.4 }));
  step(e, 900);
  const lowest = Math.max(...balls.map((b) => b.position.y));
  check('chute pile: contained, floor respected',
    balls.every((b) => Number.isFinite(b.position.x) && b.position.y < 541) && lowest > 505,
    `lowest=${lowest.toFixed(1)}`);
  check('chute pile: some balls sleep',
    balls.filter((b) => b.isSleeping).length >= 4,
    `sleeping=${balls.filter((b) => b.isSleeping).length}/30`);
}

/* --- 1.44 orphan sleepers: support removed -> must fall --- */
{
  const e = new NativeEngine({ enableSleeping: true });
  e.addBody({ kind: 'rect', x: 640, y: 560, width: 1280, height: 40, isStatic: true });
  const tower = [];
  for (let i = 0; i < 6; i++) tower.push(e.addBody({ kind: 'rect', x: 1159, y: 508 - i * 64, width: 64, height: 64, friction: 0.4 }));
  step(e, 600);
  const topY = tower[5].position.y;
  e.removeBody(tower[0]);
  step(e, 300);
  check('orphan tower falls after its base is deleted (native)',
    tower[5].position.y > topY + 30, `fell ${(tower[5].position.y - topY).toFixed(1)} px`);
  // Zero gravity: floating sleepers are legitimate, the probe opts out.
  const ez = new NativeEngine({ enableSleeping: true });
  ez.setGravity(0, 0, true);
  ez.addBody({ kind: 'rect', x: 640, y: 560, width: 1280, height: 40, isStatic: true });
  const zb = ez.addBody({ kind: 'rect', x: 640, y: 300, width: 40, height: 40, friction: 0.4 });
  zb.isSleeping = true; // parked mid-air in zero-g
  step(ez, 120);
  check('zero-gravity sleeper is left alone by the orphan probe', zb.isSleeping === true);
}


/* --- API parity with the Matter facade (2026-11-06 audit) --- */
{
  const pub = (proto) => Object.getOwnPropertyNames(proto)
    .filter((n) => !n.startsWith('_') && n !== 'constructor');
  const gettersOf = (proto) => pub(proto).filter((n) => {
    const d = Object.getOwnPropertyDescriptor(proto, n); return d && typeof d.get === 'function';
  });
  const methodsOf = (proto) => pub(proto).filter((n) => !gettersOf(proto).includes(n));
  const fm = methodsOf(PhysicsEngine.prototype), nm = methodsOf(NativeEngine.prototype);
  const fg = gettersOf(PhysicsEngine.prototype), ng = gettersOf(NativeEngine.prototype);
  const NATIVE_EXTRA = ['setAngle', 'setAngularVelocity']; // documented native-only helpers
  check('parity: no facade method is missing on Native',
    fm.filter((x) => !nm.includes(x)).length === 0,
    fm.filter((x) => !nm.includes(x)).join(','));
  check('parity: Native extras are only the documented helpers',
    nm.filter((x) => !fm.includes(x) && !NATIVE_EXTRA.includes(x)).length === 0,
    nm.filter((x) => !fm.includes(x)).join(','));
  check('parity: no facade getter is missing on Native',
    fg.filter((x) => !ng.includes(x)).length === 0,
    fg.filter((x) => !ng.includes(x)).join(','));
}
/* --- the six members the audit found missing, exercised --- */
{
  const e = new NativeEngine({ enableSleeping: true });
  e.addBody({ kind: 'rect', x: 640, y: 560, width: 1280, height: 40, isStatic: true });
  const b = e.addBody({ kind: 'rect', x: 640, y: 500, width: 40, height: 40 });
  step(e, 240);
  check('a settled body falls asleep before wake()', b.isSleeping === true);
  e.wake(b);
  check('wake(body) wakes a sleeping body', b.isSleeping === false);
  e.setMaxSpeed(3);
  check('maxSpeed reads back after setMaxSpeed', e.maxSpeed === 3);
  e.setVelocity(b, 50, 0); step(e, 30);
  check('setMaxSpeed clamps body speed', Math.hypot(b.velocity.x, b.velocity.y) <= 3.01,
    `v=${Math.hypot(b.velocity.x, b.velocity.y).toFixed(2)}`);
  e.setMaxSpeed(0);
  e.addFluid({ x: 0, y: 0, width: 10, height: 10 });
  e.addWind({ x: 0, y: 0, width: 10, height: 10, vx: 1 });
  e.clearFluids(); e.clearWinds();
  check('clearFluids / clearWinds empty the region lists', e.fluidCount === 0 && e.windCount === 0);
  check('dragging is boolean false before a drag', e.dragging === false && e.dragBody === null);
  e.beginDrag(b, b.position.x, b.position.y);
  check('dragging is boolean true and dragBody is the body during a drag', e.dragging === true && e.dragBody === b);
  e.endDrag();
  check('drag state clears on endDrag', e.dragging === false && e.dragBody === null);
}
/* --- v1.12.8: emitters (twin of the Matter facade) --- */
{
  const e = new NativeEngine({ enableSleeping: true });
  e.setGravity(0, 0, false);
  const em = e.addEmitter({ x: 100, y: 100, angle: 0, rate: 6, kind: 'circle', size: 10, speed: 5, cap: 60 });
  check('emitters: registry reads back on Native', e.emitterCount === 1 && e.emitterById(em.id).rate === 6);
  step(e, 120);
  const spawned = [...e._byId.values()].filter((b) => e.describeBody(b).emitter === em.id);
  check('emitters: rate 6/s spawns exactly 12 bodies in 120 steps on Native', spawned.length === 12, `n=${spawned.length}`);
  check('emitters: snapshot carries emitters; a fresh load restores them',
    e.snapshot().emitters.length === 1 && (() => { const q = new NativeEngine({}); q.load(JSON.parse(JSON.stringify(e.snapshot()))); return q.emitterCount === 1; })());
  const e2 = new NativeEngine({ enableSleeping: true });
  e2.setGravity(0, 0, false);
  e2.addEmitter({ x: 0, y: 0, angle: 0, rate: 60, size: 8, speed: 0, cap: 5 });
  step(e2, 60);
  check('emitters: the cap recycles the oldest on Native (alive stays at cap)', e2.count === 5, `n=${e2.count}`);
  // restore-vs-restore determinism with an emitter mid-run (replay path)
  const mk = () => { const p = new NativeEngine({ enableSleeping: true, seed: 42 }); p.addBody({ kind: 'rect', x: 640, y: 560, width: 1280, height: 40, isStatic: true }); p.addEmitter({ x: 200, y: 80, angle: Math.PI / 2, rate: 12, size: 12, speed: 2, cap: 40 }); return p; };
  const src = mk(); step(src, 150);
  const snap = JSON.parse(JSON.stringify(src.snapshot()));
  const c1 = new NativeEngine({ enableSleeping: true, seed: 42 }); c1.load(snap);
  const c2 = new NativeEngine({ enableSleeping: true, seed: 42 }); c2.load(snap);
  step(c1, 150); step(c2, 150);
  const h = (p) => [...p._byId.values()].map((b) => { const d = p.describeBody(b); return `${d.id}@${d.x.toFixed(4)},${d.y.toFixed(4)}`; }).join('|');
  check('emitters: restore-vs-restore stays bit-identical on Native', h(c1) === h(c2) && c1.count === 41, `n=${c1.count}`);
}

/* --- framed world: a ball bouncing off a spring-hung box stays inside
       and settles (audit A re-test with the app frame, 2026-11-06) --- */
{
  const e = new NativeEngine({ enableSleeping: true, seed: 7 });
  e.addBody({ kind: 'rect', x: 640, y: 570, width: 1280, height: 60, isStatic: true });
  e.addBody({ kind: 'rect', x: 20, y: 300, width: 40, height: 600, isStatic: true });
  e.addBody({ kind: 'rect', x: 1260, y: 300, width: 40, height: 600, isStatic: true });
  e.addBody({ id: 'a', kind: 'rect', x: 400, y: 470, width: 40, height: 40 });
  const ball = e.addBody({ id: 'b', kind: 'circle', x: 430, y: 300, radius: 15, restitution: 0.4 });
  e.addConstraint({ bodyA: null, bodyB: 'a', pointA: { x: 400, y: 300 }, pointB: { x: 0, y: 0 }, stiffness: 0.02, length: 120 });
  step(e, 1200);
  check('framed world: ball stays inside the frame', ball.position.x > 40 && ball.position.x < 1240 && ball.position.y < 560,
    `at (${ball.position.x.toFixed(0)},${ball.position.y.toFixed(0)})`);
  check('framed world: ball settles asleep on the ground', ball.isSleeping === true && near(ball.position.y, 525, 3),
    `y=${ball.position.y.toFixed(1)} sleeping=${ball.isSleeping}`);
}

/* --- v1.12.9: wedged light bodies are not launched (bowling repro) ---
   Ryan's bowling scene on the native backend: a heavy ball arriving
   at ~2.4 px/step wedged into a stacked triangle pyramid and one pin
   left at 19.6 px/step (~4x the momentum ceiling, it hit the side
   wall). Two amplifiers: restitution answered the contact-point
   velocity AFTER warm-start/solve pollution (vn measured -61), and
   the Baumgarte term demanded 12+ px/step for a 16 px overlap. The
   fix captures the approach velocity at contact creation and caps
   the penetration bias; this test rebuilds the scene and bounds the
   peak pin speed, and a drop test pins honest restitution. */
{
  const e = new NativeEngine({ enableSleeping: true, substeps: 2, seed: 1 });
  e.addBody({ kind: 'rect', x: 640, y: 560, width: 1280, height: 40, isStatic: true, friction: 0.6 });
  e.addBody({ id: 'ball', kind: 'circle', x: 210, y: 514, radius: 26, density: 0.006, friction: 0.08, frictionAir: 0.01, restitution: 0.1, vx: 10.5 });
  const pinAt = (x, y) => e.addBody({ kind: 'polygon', sides: 3, x, y, radius: 24, density: 0.0008, friction: 0.3 });
  const pins = [pinAt(950, 519), pinAt(995, 519), pinAt(1040, 519), pinAt(972, 478), pinAt(1017, 478), pinAt(995, 437)];
  let peak = 0;
  for (let i = 0; i < 423; i++) {
    e.advance(e.fixedDt);
    if (i >= 130 && i <= 220) {
      for (const p of pins) peak = Math.max(peak, Math.hypot(p.velocity.x, p.velocity.y));
    }
  }
  check('v1.12.9: wedged pins are not launched (peak pin speed bounded)', peak < 8, `peak=${peak.toFixed(2)}`);
  check('v1.12.9: no pin reaches the side wall', pins.every((p) => p.position.x < 1150),
    `maxX=${Math.max(...pins.map((p) => p.position.x)).toFixed(0)}`);
}
{
  const e = new NativeEngine({ enableSleeping: false, substeps: 2, seed: 1 });
  e.addBody({ kind: 'rect', x: 640, y: 560, width: 1280, height: 40, isStatic: true, friction: 0 });
  const ball = e.addBody({ kind: 'circle', x: 300, y: 200, radius: 20, density: 0.001, friction: 0, frictionAir: 0, restitution: 0.8 });
  let fell = false, apex = Infinity;
  for (let i = 0; i < 300; i++) {
    e.advance(e.fixedDt);
    if (!fell && ball.velocity.y < -3) fell = true;
    if (fell) apex = Math.min(apex, ball.position.y);
  }
  const rebound = 520 - apex; // ground top 540, centre rest y = 520
  check('v1.12.9: honest restitution survives the bias fix (e=0.8 rebounds near e^2*h)', rebound > 140 && rebound < 270,
    `rebound=${rebound.toFixed(0)}px (ideal 205)`);
}

console.log(`\nNativeEngine tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
