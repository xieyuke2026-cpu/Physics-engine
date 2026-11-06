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

console.log(`\nNativeEngine tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
