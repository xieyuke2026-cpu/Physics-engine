/* NativeEngineJitter tests — the fork backend (1.70) must honour the
   PhysicsEngine API on its own AND measurably mitigate the resting
   jitter the parent NativeEngine shows with sleeping off.
   Run: node tests/native-jitter-tests.mjs */
const { PhysicsEngine, BACKENDS } = await import('../js/engine/physics-engine.js');
const { NativeEngine } = await import('../js/engine/native-engine.js');
const { NativeEngineJitter } = await import('../js/engine/native-engine-jitter.js');

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
}
const step = (e, n) => { for (let i = 0; i < n; i++) e.advance(1000 / 60); };

/* Pyramid preset geometry, identical to the jitter probes: ground top
   y=540, 6 rows of 46px boxes (6,5,4,3,2,1), 2px horizontal gaps,
   friction 0.5, restitution 0.05, wrecking ball at (200,180). */
const GROUND_TOP = 540;
function buildPyramid(e) {
  e.addBody({ kind: 'rect', x: 640, y: 560, width: 1280, height: 40, isStatic: true, friction: 0.6 });
  e.addBody({ kind: 'rect', x: 20, y: 240, width: 40, height: 680, isStatic: true });
  e.addBody({ kind: 'rect', x: 1260, y: 240, width: 40, height: 680, isStatic: true });
  const s = 46, boxes = [];
  for (let row = 0; row < 6; row++) {
    const count = 6 - row, y = GROUND_TOP - s / 2 - row * s;
    for (let i = 0; i < count; i++) {
      boxes.push({ b: e.addBody({ kind: 'rect', x: 640 + (i - (count - 1) / 2) * (s + 2), y, width: s, height: s, friction: 0.5, restitution: 0.05 }), x0: 640 + (i - (count - 1) / 2) * (s + 2) });
    }
  }
  e.addBody({ kind: 'circle', x: 200, y: 180, radius: 26, density: 0.004, restitution: 0.4 });
  return boxes;
}
const maxDx = (boxes) => Math.max(...boxes.map((o) => Math.abs(o.b.position.x - o.x0)));
const maxAng = (boxes) => Math.max(...boxes.map((o) => Math.abs(o.b.angle)));

/* --- registry: the factory builds the fork backend --- */
{
  const e = PhysicsEngine.create({ backend: 'native-jitter', enableSleeping: false });
  check('create({backend:"native-jitter"}) returns a NativeEngineJitter', e instanceof NativeEngineJitter);
  check('fork instance carries backendId "native-jitter"', e.backendId === 'native-jitter');
  const reg = BACKENDS.find((b) => b.id === 'native-jitter');
  check('BACKENDS marks native-jitter experimental since 1.70', reg && reg.status === 'experimental' && reg.name === 'Impulse 缓解版');
}

/* --- mitigation: resting pyramid, sleeping OFF, 3600 steps ---
   Parent: top box flipped by step ~3600 (maxDx ~97px). Fork (2x2
   block solve): maxDx 33.5px, maxAng 0.033rad — still upright. */
{
  const fork = new NativeEngineJitter({ enableSleeping: false });
  const forkBoxes = buildPyramid(fork);
  step(fork, 3600);
  check('fork: pyramid still upright at 3600 steps (sleep off)', maxDx(forkBoxes) < 60 && maxAng(forkBoxes) < 0.1, `maxDx=${maxDx(forkBoxes).toFixed(1)} maxAng=${maxAng(forkBoxes).toFixed(3)}`);
  const base = new NativeEngine({ enableSleeping: false });
  const baseBoxes = buildPyramid(base);
  step(base, 3600);
  check('control: parent engine has toppled by 3600 steps (test discriminates)', maxAng(baseBoxes) > 1.0, `base maxAng=${maxAng(baseBoxes).toFixed(2)}`);
  check('fork beats parent at 3600 steps', maxDx(forkBoxes) < maxDx(baseBoxes), `fork ${maxDx(forkBoxes).toFixed(1)} vs base ${maxDx(baseBoxes).toFixed(1)}`);
}

/* --- mitigation: two stacked boxes, sleeping OFF, 2400 steps ---
   Parent: top box toppled (41.9px). Fork: top box 12.0px, 0.029rad. */
{
  const e = new NativeEngineJitter({ enableSleeping: false });
  e.addBody({ kind: 'rect', x: 640, y: 560, width: 1280, height: 40, isStatic: true, friction: 0.6 });
  const bottom = e.addBody({ kind: 'rect', x: 640, y: GROUND_TOP - 23, width: 46, height: 46, friction: 0.5, restitution: 0.05 });
  const top = e.addBody({ kind: 'rect', x: 640, y: GROUND_TOP - 23 - 46, width: 46, height: 46, friction: 0.5, restitution: 0.05 });
  step(e, 2400);
  check('fork: 2-box stack holds at 2400 steps (sleep off)', Math.abs(top.position.x - 640) < 20 && Math.abs(top.angle) < 0.05, `top dx=${(top.position.x - 640).toFixed(1)} ang=${top.angle.toFixed(3)}`);
  check('fork: bottom box barely moves', Math.abs(bottom.position.x - 640) < 10, `bottom dx=${(bottom.position.x - 640).toFixed(1)}`);
}

/* --- sleeping-ON parity: the mitigation must not change the path
   the app actually uses (sleeping on, pyramid, 6000 steps). --- */
{
  const e = new NativeEngineJitter({ enableSleeping: true });
  const boxes = buildPyramid(e);
  step(e, 6000);
  check('fork: pyramid dead still with sleeping on (6000 steps)', maxDx(boxes) < 1, `maxDx=${maxDx(boxes).toFixed(2)}`);
}

console.log(`\nnative-jitter: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
