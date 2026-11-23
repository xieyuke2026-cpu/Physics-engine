/* Native 2x2 block-solve tests — engine 1.13.4 graduated the 1.70
   fork's block solve into the main NativeEngine, and the fork backend
   is deleted. These checks pin the mitigation numbers on the MAIN
   engine and assert the fork id is truly gone.
   Run: node tests/native-blocksolver-tests.mjs */
const { PhysicsEngine, BACKENDS } = await import('../js/engine/physics-engine.js');
const { NativeEngine } = await import('../js/engine/native-engine.js');

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

/* --- registry: the fork is gone, the main engine carries the fix --- */
{
  const e = PhysicsEngine.create({ backend: 'native', enableSleeping: false });
  check('create({backend:"native"}) returns a NativeEngine', e instanceof NativeEngine);
  check('main instance carries backendId "native"', e.backendId === 'native');
  check('BACKENDS has no native-jitter entry (fork deleted in 1.71)', !BACKENDS.some((b) => b.id === 'native-jitter') && BACKENDS.length === 2);
}

/* --- mitigation on the MAIN engine: resting pyramid, sleeping OFF,
   3600 steps. Sequential solve: top box flipped by step ~3600
   (maxDx ~97px). Block solve: maxDx 33.5px, maxAng 0.033rad. --- */
{
  const e = new NativeEngine({ enableSleeping: false });
  const boxes = buildPyramid(e);
  step(e, 3600);
  check('main: pyramid still upright at 3600 steps (sleep off)', maxDx(boxes) < 60 && maxAng(boxes) < 0.1, `maxDx=${maxDx(boxes).toFixed(1)} maxAng=${maxAng(boxes).toFixed(3)}`);
}

/* --- mitigation on the MAIN engine: two stacked boxes, sleeping OFF,
   2400 steps. Sequential solve: top box toppled (41.9px). Block
   solve: top box 12.0px, 0.029rad. --- */
{
  const e = new NativeEngine({ enableSleeping: false });
  e.addBody({ kind: 'rect', x: 640, y: 560, width: 1280, height: 40, isStatic: true, friction: 0.6 });
  const bottom = e.addBody({ kind: 'rect', x: 640, y: GROUND_TOP - 23, width: 46, height: 46, friction: 0.5, restitution: 0.05 });
  const top = e.addBody({ kind: 'rect', x: 640, y: GROUND_TOP - 23 - 46, width: 46, height: 46, friction: 0.5, restitution: 0.05 });
  step(e, 2400);
  check('main: 2-box stack holds at 2400 steps (sleep off)', Math.abs(top.position.x - 640) < 20 && Math.abs(top.angle) < 0.05, `top dx=${(top.position.x - 640).toFixed(1)} ang=${top.angle.toFixed(3)}`);
  check('main: bottom box barely moves', Math.abs(bottom.position.x - 640) < 10, `bottom dx=${(bottom.position.x - 640).toFixed(1)}`);
}

/* --- sleeping-ON parity: the mitigation must not change the path
   the app actually uses (sleeping on, pyramid, 6000 steps). --- */
{
  const e = new NativeEngine({ enableSleeping: true });
  const boxes = buildPyramid(e);
  step(e, 6000);
  check('main: pyramid dead still with sleeping on (6000 steps)', maxDx(boxes) < 1, `maxDx=${maxDx(boxes).toFixed(2)}`);
}

/* --- the block solve changes solver numerics: old replays no longer
   verify bit-exactly. The 1.68 spring change set this precedent; the
   check below pins the NEW pyramid behaviour so a silent regression
   of the solver is caught, not an old hash. --- */
{
  const e = new NativeEngine({ enableSleeping: false });
  const boxes = buildPyramid(e);
  step(e, 5000);
  check('main: pyramid survives to 5000 steps (sleep off)', maxDx(boxes) < 60 && maxAng(boxes) < 0.1, `maxDx=${maxDx(boxes).toFixed(1)} maxAng=${maxAng(boxes).toFixed(3)}`);
}

console.log(`\nnative-blocksolver: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
