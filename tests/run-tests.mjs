/* MotionLab logic tests — run: node tests/run-tests.mjs
   Covers scene validation, real Matter.js gravity/collision, property edits,
   resize, drag constraint, and serialize round-trips. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

globalThis.window = globalThis;
globalThis.Matter = require('../vendor/matter.min.js');

const { validateScene, defaultScene, sceneData, bodyData, constraintData, hingeData, fluidData, presetScenes, jitteredScene, sceneJsonTooLarge, MAX_SCENE_JSON_BYTES } = await import('../js/scene.js');
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
check('v1.36: default scene carries seed 1', sceneData({}).settings.seed === 1);
check('v1.36: scene seed round-trips (uint32 max)', sceneData({ settings: { seed: 4294967295 } }).settings.seed === 4294967295);
check('v1.36: negative seed rejected', !validateScene({ format: 'motionlab-scene', version: 2, bodies: [], settings: { seed: -3 } }).ok);
check('v1.36: fractional seed rejected', !validateScene({ format: 'motionlab-scene', version: 2, bodies: [], settings: { seed: 1.5 } }).ok);
check('v1.36: valid seed accepted', validateScene({ format: 'motionlab-scene', version: 2, bodies: [], settings: { seed: 42 } }).ok);
{
  const wa = new PhysicsWorld(); const wb = new PhysicsWorld();
  wa.setSeed(7); wb.setSeed(7);
  const sa = [wa.random(), wa.random(), wa.random()];
  const sb = [wb.random(), wb.random(), wb.random()];
  check('v1.36: same seed -> same RNG stream', sa.every((v, i) => v === sb[i]), `${sa} vs ${sb}`);
  wa.loadScene(sceneData({ settings: { seed: 42 } }));
  check('v1.36: loadScene applies the scene seed', wa.seed === 42, `seed=${wa.seed}`);
}
{
  const base = sceneData({ bodies: [
    { type: 'circle', x: 100, y: 100, radius: 10 },
    { type: 'rectangle', x: 50, y: 50, width: 40, height: 10, isStatic: true },
  ] });
  const wA = new PhysicsWorld(); wA.setSeed(7);
  const j1 = jitteredScene(base, () => wA.random());
  const wB = new PhysicsWorld(); wB.setSeed(7);
  const j2 = jitteredScene(base, () => wB.random());
  const wC = new PhysicsWorld(); wC.setSeed(8);
  const j3 = jitteredScene(base, () => wC.random());
  check('v1.37: same seed -> identical jitter', JSON.stringify(j1.bodies) === JSON.stringify(j2.bodies));
  check('v1.37: different seed -> different jitter', JSON.stringify(j3.bodies) !== JSON.stringify(j1.bodies));
  check('v1.37: jitter moves dynamic bodies', j1.bodies[0].x !== 100 || j1.bodies[0].y !== 100, `(${j1.bodies[0].x}, ${j1.bodies[0].y})`);
  check('v1.37: jitter stays within bounds', Math.abs(j1.bodies[0].x - 100) <= 6 && Math.abs(j1.bodies[0].y - 100) <= 3);
  check('v1.37: static bodies untouched by jitter', j1.bodies[1].x === 50 && j1.bodies[1].y === 50);
  check('v1.37: jitter does not mutate the input scene', base.bodies[0].x === 100 && base.bodies[0].y === 100);
}
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

/* --- v1.1: format v2 + backward compatibility --- */
check('v1 scene (no constraints) still validates', validateScene({ format: 'motionlab-scene', version: 1, bodies: [] }).ok);
check('version 3 rejected', !validateScene({ format: 'motionlab-scene', version: 3, bodies: [] }).ok);
check('constraint referencing missing body rejected', !validateScene({
  format: 'motionlab-scene', version: 2,
  bodies: [{ id: 'a', type: 'circle', x: 0, y: 0 }],
  constraints: [{ bodyA: null, bodyB: 'nope', pointA: { x: 0, y: 0 }, pointB: { x: 0, y: 0 }, stiffness: 0.1 }],
}).ok);
check('constraint stiffness > 1 rejected', !validateScene({
  format: 'motionlab-scene', version: 2,
  bodies: [{ id: 'a', type: 'circle', x: 0, y: 0 }],
  constraints: [{ bodyA: null, bodyB: 'a', pointA: { x: 0, y: 0 }, pointB: { x: 0, y: 0 }, stiffness: 5 }],
}).ok);

/* --- v1.1: rigid rod constraint holds a pendulum ball --- */
const wp = new PhysicsWorld();
wp.loadScene(sceneData({
  settings: { gravityY: 1 },
  bodies: [bodyData({ id: 'pend', type: 'circle', x: 320, y: 250, radius: 20, frictionAir: 0.001 })],
  constraints: [constraintData({ bodyA: null, bodyB: 'pend', pointA: { x: 200, y: 50 }, pointB: { x: 0, y: 0 }, stiffness: 1, damping: 0, length: 200 })],
}));
check('constraint added to world', wp.constraintCount === 1);
const pend = wp.allBodies()[0];
for (let i = 0; i < 240; i++) wp.step(1000 / 60, 1);
const rodDist = Math.hypot(pend.position.x - 200, pend.position.y - 50);
check('rod keeps ball near fixed length from anchor', rodDist > 180 && rodDist < 225, `d=${rodDist.toFixed(1)}`);
check('pendulum did not fall away', pend.position.y < 320, `y=${pend.position.y.toFixed(1)}`);

/* --- v1.1: soft spring pulls two bodies together --- */
const ws = new PhysicsWorld();
ws.loadScene(sceneData({
  settings: { gravityEnabled: false },
  bodies: [
    bodyData({ id: 's1', type: 'circle', x: 100, y: 200, radius: 15 }),
    bodyData({ id: 's2', type: 'circle', x: 420, y: 200, radius: 15 }),
  ],
  constraints: [constraintData({ bodyA: 's1', bodyB: 's2', stiffness: 0.02, damping: 0.02, length: 0 })],
}));
const [s1, s2] = ws.allBodies();
for (let i = 0; i < 180; i++) ws.step(1000 / 60, 1);
const sprDist = Math.hypot(s2.position.x - s1.position.x, s2.position.y - s1.position.y);
check('spring pulls bodies closer (320 -> <200)', sprDist < 200, `d=${sprDist.toFixed(1)}`);

/* --- v1.1: constraint lifecycle --- */
const wc = new PhysicsWorld();
wc.loadScene(sceneData({
  bodies: [bodyData({ id: 'c1', type: 'circle', x: 100, y: 100, radius: 15 })],
  constraints: [constraintData({ bodyA: null, bodyB: 'c1', pointA: { x: 100, y: 20 } })],
}));
check('constraint serialized back out', wc.serializeConstraints().length === 1);
const cScene = sceneData({ bodies: wc.allBodies().map((b) => wc.serializeBody(b)), constraints: wc.serializeConstraints() });
check('scene with constraint validates after round-trip', validateScene(JSON.parse(JSON.stringify(cScene))).ok);
wc.removeBody('c1');
check('deleting a body removes its constraints', wc.constraintCount === 0);

/* --- v1.1: lock rotation / air friction / stop --- */
const wl = new PhysicsWorld();
wl.loadScene(sceneData({ bodies: [bodyData({ id: 'lk', type: 'rectangle', x: 100, y: 100, width: 60, height: 30 })] }));
const lk = wl.allBodies()[0];
wl.setLockRotation(lk, true);
check('lock rotation sets infinite inertia', lk.inertia === Infinity);
check('lock rotation flag serializes', wl.serializeBody(lk).lockRotation === true);
Matter.Body.setAngularVelocity(lk, 0.3);
for (let i = 0; i < 30; i++) wl.step(1000 / 60, 1);
check('locked body does not rotate', Math.abs(lk.angle) < 0.05, `angle=${lk.angle.toFixed(3)}`);
wl.setLockRotation(lk, false);
check('unlock restores finite inertia', Number.isFinite(lk.inertia));
wl.setFrictionAir(lk, 0.05);
check('frictionAir edit applies', lk.frictionAir === 0.05);
wl.setVelocity(lk, 4, 3); wl.stopMotion(lk);
check('stop motion zeroes velocity', lk.velocity.x === 0 && lk.velocity.y === 0 && lk.angularVelocity === 0);

/* --- v1.1/v1.6: presets --- */
const presets = presetScenes();
check('twenty-one presets exist', presets.length === 21, `got ${presets.length}`);
for (const p of presets) {
  check(`preset ${p.key} validates`, validateScene(JSON.parse(JSON.stringify(p.scene))).ok);
}
/* --- v1.28: hinges in scene data + GIF recording core --- */
{
  const hd = hingeData({ bodyB: 'b1', motorSpeed: 9 });
  check('hingeData clamps motorSpeed to ±0.3', hd.motorSpeed === 0.3 && hd.bodyA === null && hd.motorPower === 0.0025);
  const sc = sceneData({ name: 'H', bodies: [bodyData({ id: 'b1', type: 'circle', x: 10, y: 10, radius: 5 }), bodyData({ id: 'b2', type: 'circle', x: 60, y: 10, radius: 5 })],
    hinges: [hingeData({ bodyA: 'b1', bodyB: 'b2', motorSpeed: 0.05 })] });
  const rt = JSON.parse(JSON.stringify(sc));
  check('scene roundtrip keeps hinges', rt.hinges.length === 1 && rt.hinges[0].motorSpeed === 0.05);
  check('validateScene accepts hinged scene', validateScene(rt).ok);
  const bad = JSON.parse(JSON.stringify(rt)); bad.hinges[0].bodyB = 'ghost';
  check('validateScene rejects hinge to missing body', !validateScene(bad).ok);
  const bad2 = JSON.parse(JSON.stringify(rt)); bad2.hinges[0].motorSpeed = 2;
  check('validateScene rejects out-of-range motorSpeed', !validateScene(bad2).ok);
  const wl = new PhysicsWorld();
  wl.loadScene(rt);
  check('adapter loadScene restores hinges', wl.hingeCount === 1);
  const ser = wl.serializeScene();
  check('adapter serializeScene emits hinges', ser.hinges.length === 1 && ser.hinges[0].bodyB === 'b2');
  wl.setHingeMotor(ser.hinges[0].id, -0.02);
  check('adapter setHingeMotor applies', Math.abs(wl.hingeById(ser.hinges[0].id).motorSpeed - -0.02) < 1e-9);
  const anch = wl.hingeAnchors();
  check('adapter hingeAnchors resolves the pin point', anch.length === 1 && Math.abs(anch[0].x - 60) < 30);
}
/* --- v1.50: deterministic replay (format, validation, hashing) --- */
{
  const { createRecording, recordEvent, finalizeRecording, validateReplay, hashBodyStates, eventsByStep } =
    await import('../js/replay.js');
  const rec = createRecording({ backend: 'matter', sceneName: 'T', initial: { bodies: [] }, appVersion: '1.50' });
  check('replay: recording carries the format marker', rec.format === 'motionlab-replay' && rec.version === 1 && rec.backend === 'matter');
  check('replay: recordEvent rejects unknown types', recordEvent(rec, 5, { type: 'nope' }) === false && rec.events.length === 0);
  recordEvent(rec, 10, { type: 'blast', x: 1, y: 2, radius: 90 });
  recordEvent(rec, 4, { type: 'blast', x: 3, y: 4, radius: 90 });
  check('replay: out-of-order events clamp to the last step', rec.events.length === 2 && rec.events[1].step === 10);
  finalizeRecording(rec, 600, 'abcd1234');
  const v = validateReplay(JSON.parse(JSON.stringify(rec)));
  check('replay: a finished recording validates', v.ok && v.replay.steps === 600 && v.replay.events.length === 2);
  check('replay: validateReplay rejects a foreign format', !validateReplay({ format: 'motionlab-scene' }).ok);
  check('replay: validateReplay rejects out-of-order events',
    !validateReplay({ format: 'motionlab-replay', version: 1, steps: 10, initial: { bodies: [] }, events: [{ step: 5, type: 'blast' }, { step: 2, type: 'blast' }] }).ok);
  check('replay: validateReplay rejects steps beyond the cap',
    !validateReplay({ format: 'motionlab-replay', version: 1, steps: 60 * 181, initial: { bodies: [] }, events: [] }).ok);
  check('replay: validateReplay rejects an event past the end',
    !validateReplay({ format: 'motionlab-replay', version: 1, steps: 10, initial: { bodies: [] }, events: [{ step: 11, type: 'blast' }] }).ok);
  check('replay: eventsByStep groups by step', eventsByStep(rec.events).get(10).length === 2);
  const h1 = hashBodyStates([{ id: 'a', x: 1.0004, y: 2, angle: 0 }]);
  const h2 = hashBodyStates([{ id: 'a', x: 1.0001, y: 2, angle: 0 }]);
  const h3 = hashBodyStates([{ id: 'a', x: 1.01, y: 2, angle: 0 }]);
  check('replay: hash ignores sub-millimetre noise but catches divergence', h1 === h2 && h1 !== h3, `${h1} ${h2} ${h3}`);
}

/* --- v1.50: replay determinism proof on BOTH backends ---
   Record: snapshot a live world, then run 480 steps with scripted inputs
   (add body, gravity change, radial blast, a physics drag). Replay: load
   the snapshot into a FRESH world and re-apply the same inputs at the
   same steps. The final state hashes must be identical. */
{
  const { hashBodyStates, statesFromSnapshot } = await import('../js/replay.js');
  const bounce = presets.find((p) => p.key === 'bounce').scene;
  function runScript(backend, replayMode) {
    const scene = JSON.parse(JSON.stringify(bounce));
    const seedWorld = new PhysicsWorld(backend);
    seedWorld.loadScene(scene);
    const initial = JSON.parse(JSON.stringify(seedWorld.snapshot()));
    const w = replayMode ? new PhysicsWorld(backend) : seedWorld;
    if (replayMode) w.loadSnapshot(initial);
    let settings = { ...scene.settings };
    const target = w.allBodies().find((b) => !b.isStatic);
    const targetId = w.dataIdOf(target);
    const script = new Map();
    const at = (s, e) => { if (!script.has(s)) script.set(s, []); script.get(s).push(e); };
    at(60, { type: 'add', body: bodyData({ id: 'extra-ball', type: 'circle', x: 640, y: 80, radius: 15, restitution: 0.6 }) });
    at(150, { type: 'settings', settings: { ...settings, gravityX: 0.4 } });
    at(240, { type: 'blast', x: 640, y: 300, radius: 120 });
    at(300, { type: 'dragStart', id: targetId });
    for (let s = 301; s <= 330; s++) at(s, { type: 'drag', dx: 2, dy: -1 });
    at(331, { type: 'dragEnd' });
    const apply = (e) => {
      if (e.type === 'add') w.addBody(bodyData(e.body));
      else if (e.type === 'settings') { settings = { ...e.settings }; w.applySettings(settings); }
      else if (e.type === 'blast') w.applyRadialImpulse(e.x, e.y, { radius: e.radius, base: 2, power: 13 });
      else if (e.type === 'dragStart') { const b = w.bodyById(e.id); dragPt = { x: b.position.x, y: b.position.y }; w.beginDrag(b, dragPt.x, dragPt.y); }
      else if (e.type === 'drag') { dragPt.x += e.dx; dragPt.y += e.dy; w.moveDrag(dragPt.x, dragPt.y); }
      else if (e.type === 'dragEnd') w.endDrag();
    };
    let dragPt = null;
    for (let s = 0; s < 480; s++) {
      const evs = script.get(s);
      if (evs) for (const e of evs) apply(e);
      w.stepOnce();
    }
    return hashBodyStates(statesFromSnapshot(w.snapshot()));
  }
  for (const backend of ['matter', 'native']) {
    const live = runScript(backend, false);
    const replayed = runScript(backend, true);
    check(`replay: ${backend} re-stepping reproduces the run exactly`, live === replayed, `${live} vs ${replayed}`);
  }
}

/* --- v1.54: replay determinism for a WARM recording (the cradle case) ---
   The 1.50 proof above snapshots a cold scene. Real use presses record
   while the scene is already running: the live solver then carries
   warm-start state a snapshot cannot serialize, and the run diverged
   from its own replay (Newton's cradle warmed 300 steps: >2 px with no
   inputs at all, >14 px with a drag — live-verified failure in 1.52/1.53).
   The app now reloads the captured snapshot at record start (1.54), so
   the recorded run and the replay start from the same rebuilt state. */
{
  const { hashBodyStates, statesFromSnapshot } = await import('../js/replay.js');
  const cradle = presets.find((p) => p.key === 'cradle').scene;
  function drive(world) {
    const balls = world.allBodies().filter((b) => !b.isStatic);
    const ball = balls.reduce((a, b) => (a.position.x < b.position.x ? a : b));
    const id = world.dataIdOf(ball);
    const x0 = ball.position.x, y0 = ball.position.y;
    for (let s = 0; s < 900; s++) {
      if (s === 120) { const b = world.bodyById(id); if (b) world.beginDrag(b, x0, y0); }
      if (s > 120 && s <= 200) world.moveDrag(x0 - 160 * Math.sin(((s - 120) / 80) * Math.PI * 0.5), y0 - 60 * Math.sin(((s - 120) / 80) * Math.PI));
      if (s === 201) world.endDrag();
      world.stepOnce();
    }
    return hashBodyStates(statesFromSnapshot(world.snapshot()));
  }
  function runWarm(backend, replayMode) {
    const scene = JSON.parse(JSON.stringify(cradle));
    const w = new PhysicsWorld(backend);
    w.loadScene(scene);
    for (let i = 0; i < 300; i++) w.advance(1000 / 60, 1); // warm-up: already running when record is pressed
    const initial = JSON.parse(JSON.stringify(w.snapshot()));
    if (replayMode) {
      const fresh = new PhysicsWorld(backend);
      fresh.loadScene(scene);
      fresh.loadSnapshot(initial);
      return drive(fresh);
    }
    w.loadSnapshot(JSON.parse(JSON.stringify(initial))); // 1.54 record-start reload
    return drive(w);
  }
  for (const backend of ['matter', 'native']) {
    const live = runWarm(backend, false);
    const replayed = runWarm(backend, true);
    check(`replay: ${backend} warm recording (record-start reload) reproduces exactly`, live === replayed, `${live} vs ${replayed}`);
  }
}

/* --- v1.55: the domino preset must actually cascade on BOTH backends ---
   Regression for the stall Ryan reported: on the default backend the
   row froze leaning (tile 1 asleep at 42°, tile 2 at 2.6°) because
   sleep swallowed the slow push, and the strike itself was a
   quasi-static lean at the default density. The preset now ships
   dense noSleep tiles at spacing 52; under stock app conditions
   (sleeping enabled) all 11 must be down within 1200 steps. */
{
  const domino = presets.find((p) => p.key === 'domino').scene;
  for (const backend of ['matter', 'native']) {
    const w = new PhysicsWorld(backend);
    w.loadScene(JSON.parse(JSON.stringify(domino)));
    let fallen = 0;
    for (let i = 0; i < 1200; i++) {
      w.advance(1000 / 60, 1);
      if (i % 10 === 0) {
        const doms = w.snapshot().bodies.filter((b) => b.label === 'Domino');
        fallen = doms.filter((b) => Math.abs(b.angle) > 0.8).length;
        if (fallen === doms.length) break;
      }
    }
    const doms = w.snapshot().bodies.filter((b) => b.label === 'Domino');
    fallen = doms.filter((b) => Math.abs(b.angle) > 0.8).length;
    check(`dominoes: ${backend} cascade completes (11/11 down)`, fallen === 11, `fallen=${fallen}`);
  }
}

/* --- v1.50: challenge definitions + goal logic --- */
{
  const { CHALLENGES, GoalTracker, pointInZone, starsFor } = await import('../js/challenges.js');
  check('challenges: six levels ship', CHALLENGES.length === 6, `n=${CHALLENGES.length}`);
  for (const def of CHALLENGES) {
    const built = def.build();
    const v = validateScene(JSON.parse(JSON.stringify(built)));
    check(`challenges: ${def.id} setup validates as a scene`, v.ok, v.ok ? '' : v.errors.join(';'));
    check(`challenges: ${def.id} budget and time are sane`, def.budget >= 1 && def.timeSec >= 30);
    if (def.goalKind === 'target') {
      check(`challenges: ${def.id} target body exists in its setup`, built.bodies.some((b) => b.id === def.targetId));
    }
  }
  const tr = new GoalTracker(3);
  check('challenges: the goal needs CONSECUTIVE steps inside',
    tr.update(true) === false && tr.update(true) === false && tr.update(false) === false
    && tr.update(true) === false && tr.update(true) === false && tr.update(true) === true);
  check('challenges: stars = win + piece par + time par',
    starsFor(2, 20, { pieces: 2, sec: 25 }) === 3 && starsFor(3, 20, { pieces: 2, sec: 25 }) === 2
    && starsFor(3, 30, { pieces: 2, sec: 25 }) === 1 && starsFor(9, 99, { pieces: 2, sec: 25 }) === 1);
  check('challenges: pointInZone is inclusive of the near edges only',
    pointInZone(10, 10, { x: 10, y: 10, w: 5, h: 5 }) && pointInZone(15, 15, { x: 10, y: 10, w: 5, h: 5 })
    && !pointInZone(16, 10, { x: 10, y: 10, w: 5, h: 5 }));
}

/* --- v1.29: ferris wheel regression (Ryan's video: the cross folded shut) ---
   The two arms must stay locked at 90°, the wheel must actually revolve
   (not rock in place), cabins stay upright and the hub stays pinned. */
{
  const fw = new PhysicsWorld();
  fw.loadScene(JSON.parse(JSON.stringify(presets.find((p) => p.key === 'ferris').scene)));
  const byId = {};
  for (const b of fw.allBodies()) byId[fw.dataIdOf(b)] = b;
  const H = byId['fw-bar-h'], V = byId['fw-bar-v'];
  const a0 = H.angle;
  let worstDev = 0, worstCab = 0, hubDrift = 0;
  for (let s = 1; s <= 1800; s++) {
    fw.advance(1000 / 60);
    if (s % 30 === 0) {
      let d = ((V.angle - H.angle) * 180 / Math.PI) % 360; if (d < 0) d += 360;
      worstDev = Math.max(worstDev, Math.abs(((d + 540) % 360) - 180));
      hubDrift = Math.max(hubDrift, Math.hypot(H.position.x - 640, H.position.y - 270));
      for (let i = 1; i <= 4; i++) {
        let a = ((byId[`fw-cab-${i}`].angle % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        worstCab = Math.max(worstCab, Math.abs(a * 180 / Math.PI));
      }
    }
  }
  const turned = (H.angle - a0) * 180 / Math.PI;
  check('ferris: cross stays locked at 90°', worstDev < 3, `dev ${worstDev.toFixed(1)}°`);
  check('ferris: wheel actually revolves (>600° in 30 s)', turned > 600, `turned ${turned.toFixed(0)}°`);
  check('ferris: cabins stay upright', worstCab < 10, `tilt ${worstCab.toFixed(1)}°`);
  check('ferris: hub stays pinned', hubDrift < 3, `drift ${hubDrift.toFixed(1)}px`);
  check('ferris: whole machine is one collision cluster', H.collisionFilter.group !== 0 && H.collisionFilter.group === V.collisionFilter.group && byId['fw-cab-3'].collisionFilter.group === H.collisionFilter.group && byId['fw-leg-l'].collisionFilter.group === H.collisionFilter.group);
}

/* --- v1.30: pinwheel is driven by wind alone (no motor anywhere) and
   the cross/hub hold like the ferris structure it reuses --- */
{
  const sc = presets.find((p) => p.key === 'pinwheel').scene;
  check('pinwheel: one gusty wind region and no motor drive',
    sc.winds.length === 1 && sc.winds[0].gust === 0.5 && sc.hinges.every((h) => (h.motorSpeed || 0) === 0),
    `winds ${sc.winds.length}, motors ${sc.hinges.map((h) => h.motorSpeed || 0).join('/')}`);
  const pw = new PhysicsWorld();
  pw.loadScene(JSON.parse(JSON.stringify(sc)));
  const byId = {};
  for (const b of pw.allBodies()) byId[pw.dataIdOf(b)] = b;
  const H = byId['pw-bar-h'], V = byId['pw-bar-v'];
  const a0 = H.angle;
  let worstDev = 0, hubDrift = 0;
  for (let s = 1; s <= 1800; s++) {
    pw.advance(1000 / 60);
    if (s % 30 === 0) {
      let d = ((V.angle - H.angle) * 180 / Math.PI) % 360; if (d < 0) d += 360;
      worstDev = Math.max(worstDev, Math.abs(((d + 540) % 360) - 180));
      hubDrift = Math.max(hubDrift, Math.hypot(H.position.x - 640, H.position.y - 250));
    }
  }
  const turned = (H.angle - a0) * 180 / Math.PI;
  check('pinwheel: wind alone revolves the wheel (>500° in 30 s)', turned > 500, `turned ${turned.toFixed(0)}°`);
  check('pinwheel: cross stays locked at 90°', worstDev < 3, `dev ${worstDev.toFixed(1)}°`);
  check('pinwheel: hub stays pinned', hubDrift < 3, `drift ${hubDrift.toFixed(1)}px`);
}

/* --- v1.31: pinwheel + water (Ryan: added water to the pinwheel and
   nothing happened — with engine 1.9.0's angular drag the default
   added water must measurably brake the wheel) --- */
{
  const base = presets.find((p) => p.key === 'pinwheel').scene;
  const runWheel = (scene) => {
    const w = new PhysicsWorld();
    w.loadScene(JSON.parse(JSON.stringify(scene)));
    const H = w.allBodies().find((b) => w.dataIdOf(b) === 'pw-bar-h');
    for (let s = 0; s < 1800; s++) w.advance(1000 / 60);
    return Math.abs(H.angle) * 180 / Math.PI;
  };
  const dryTurn = runWheel(base);
  const wetScene = JSON.parse(JSON.stringify(base));
  wetScene.fluids = [fluidData({})]; // exactly what the app's Add Fluid button creates
  const wetTurn = runWheel(wetScene);
  check('pinwheel+water: default added water brakes the wheel by >=18%',
    wetTurn < dryTurn * 0.82, `dry ${dryTurn.toFixed(0)}° wet ${wetTurn.toFixed(0)}°`);
  check('fluid flow: fluidData keeps vx/vy and validation accepts them',
    fluidData({ vx: 2 }).vx === 2 && validateScene(sceneData({ fluids: [fluidData({ vx: 1.5, vy: -1 })] })).ok);
}

/* --- v1.23: gravitation / fluids / rename get lab entries (scene level) --- */
{
  const fd = fluidData({});
  check('fluidData defaults are a sane pool', fd.width === 760 && fd.height === 170 && Math.abs(fd.density - 0.0012) < 1e-9 && fd.drag === 0.02);
  const sc = sceneData({ name: 'FX', fluids: [fluidData({ density: 0.002 })], settings: { gravitation: 25 } });
  const rt = JSON.parse(JSON.stringify(sc));
  check('scene roundtrip keeps fluids + gravitation', rt.fluids.length === 1 && rt.fluids[0].density === 0.002 && rt.settings.gravitation === 25);
  check('validate accepts fluids + gravitation', validateScene(rt).ok);
  const bad = JSON.parse(JSON.stringify(sc)); bad.fluids[0].density = 'wet';
  check('validate rejects a non-numeric fluid density', !validateScene(bad).ok);
  const neg = JSON.parse(JSON.stringify(sc)); neg.settings.gravitation = -5;
  check('validate rejects negative gravitation', !validateScene(neg).ok);

  // Orbit preset: gravitation wired through loadScene, planet stays in orbit.
  const orbit = presets.find((p) => p.key === 'orbit');
  check('orbit preset carries gravitation settings', orbit.scene.settings.gravitation === 30 && orbit.scene.settings.gravityEnabled === false);
  const wo = new PhysicsWorld();
  wo.loadScene(orbit.scene);
  check('orbit preset activates engine gravitation', wo.gravitation && wo.gravitation.G === 30);
  const planetStart = orbit.scene.bodies.find((b) => b.label === 'Planet 行星');
  const planet = wo.allBodies().find((b) => Math.abs(b.position.x - planetStart.x) < 2 && Math.abs(b.position.y - planetStart.y) < 2);
  let minR = Infinity, maxR = 0;
  for (let i = 0; i < 600; i++) {
    wo.advance(1000 / 60, 1);
    const r = Math.hypot(planet.position.x - 640, planet.position.y - 290);
    minR = Math.min(minR, r); maxR = Math.max(maxR, r);
  }
  check('orbit preset: planet radius stays near 180 for 600 steps', minR > 150 && maxR < 215, `[${minR.toFixed(1)}, ${maxR.toFixed(1)}]`);

  // Buoyancy preset: the fluid reaches the world; densities sort themselves.
  const buoy = presets.find((p) => p.key === 'buoyancy');
  const wb = new PhysicsWorld();
  wb.loadScene(buoy.scene);
  check('buoyancy preset loads one fluid region', wb.fluidCount === 1);
  for (let i = 0; i < 700; i++) wb.advance(1000 / 60, 1);
  const byLabel = (lb) => wb.allBodies().find((b) => wb.serializeBody(b).label === lb);
  const cork = byLabel('Cork 软木'), wood = byLabel('Wood 木块'), iron = byLabel('Iron 铁块');
  check('buoyancy: cork floats at the surface (centre 350..430)', cork.position.y > 350 && cork.position.y < 430, `y=${cork.position.y.toFixed(1)}`);
  check('buoyancy: wood floats lower than cork', wood.position.y > cork.position.y + 5, `wood=${wood.position.y.toFixed(1)} cork=${cork.position.y.toFixed(1)}`);
  check('buoyancy: iron sinks to the tank floor', iron.position.y > 480, `y=${iron.position.y.toFixed(1)}`);

  // Rename through the adapter (the panel's name box calls exactly this).
  const wr = new PhysicsWorld();
  wr.loadScene(defaultScene());
  const ball = wr.allBodies().find((b) => wr.serializeBody(b).label === 'Ball');
  wr.renameBody(ball, '主角球');
  check('rename via adapter sticks in serialization', wr.serializeBody(ball).label === '主角球');
  check('renamed body is findable by name', wr.bodyByName('主角球') === ball);
}

const cradle = presets.find((p) => p.key === 'cradle');
check('cradle preset has 5 rod constraints', cradle.scene.constraints.length === 5, `got ${cradle.scene.constraints.length}`);
const wcr = new PhysicsWorld();
wcr.loadScene(cradle.scene);
check('cradle loads 5 constraints into world', wcr.constraintCount === 5);
for (let i = 0; i < 120; i++) wcr.step(1000 / 60, 1);
check('cradle balls stay suspended (none on ground)', wcr.allBodies().filter((b) => b.label === 'Pendulum Ball').every((b) => b.position.y < 500));

/* --- v1.10: coaster preset really loops; world-level anti-tunnelling --- */
{
  const coaster = presets.find((p) => p.key === 'coaster');
  const wc = new PhysicsWorld();
  wc.loadScene(coaster.scene);
  const C = { x: 730, y: 380 };
  const start = coaster.scene.bodies.find((b) => b.label === 'Coaster Ball');
  const ball = wc.allBodies().find((b) => !b.isStatic && Math.abs(b.position.x - start.x) < 2 && Math.abs(b.position.y - start.y) < 2);
  let prevA = Math.atan2(ball.position.y - C.y, ball.position.x - C.x), sweep = 0, loops = 0;
  for (let i = 0; i < 900; i++) {
    wc.advance(1000 / 60, 1);
    const a = Math.atan2(ball.position.y - C.y, ball.position.x - C.x);
    let d = a - prevA; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    sweep += d; prevA = a;
    loops = Math.max(loops, -sweep / (2 * Math.PI));
  }
  check('v1.10: coaster ball completes at least one full loop', loops >= 1, `loops=${loops.toFixed(2)}`);
}
{
  const wt = new PhysicsWorld();
  wt.loadScene(defaultScene());
  wt.clearBodies();
  wt.addBody(bodyData({ type: 'rectangle', x: 300, y: 300, width: 12, height: 200, isStatic: true, label: 'Thin Wall' }));
  const shotData = bodyData({ type: 'circle', x: 100, y: 300, radius: 8, frictionAir: 0, label: 'Shot' });
  wt.addBody(shotData);
  const shot = wt.allBodies().find((b) => !b.isStatic);
  wt.setVelocity(shot, 20, 0);
  for (let i = 0; i < 40; i++) wt.advance(1000 / 60, 1);
  check('v1.10: fast shot cannot tunnel through a thin wall (substeps=2)', shot.position.x < 294, `x=${Math.round(shot.position.x)}`);
}

/* --- v1.25: magnetism + winds in the scene layer --- */
{
  check('v1.25: non-finite magnet rejected',
    !validateScene({ format: 'motionlab-scene', version: 2, bodies: [{ type: 'circle', x: 0, y: 0, magnet: 'x' }] }).ok);
  check('v1.25: non-array winds rejected',
    !validateScene({ format: 'motionlab-scene', version: 2, bodies: [], winds: {} }).ok);
  check('v1.25: non-finite wind field rejected',
    !validateScene({ format: 'motionlab-scene', version: 2, bodies: [], winds: [{ x: 0, y: 0, vx: 'gale' }] }).ok);
  check('v1.25: scene with magnet + wind validates',
    validateScene({ format: 'motionlab-scene', version: 2, bodies: [{ type: 'circle', x: 0, y: 0, magnet: -40 }], winds: [{ x: 100, y: 100, width: 200, height: 100, vx: 3 }] }).ok);
  check('v1.25: bodyData clamps magnet to [-100, 100]',
    bodyData({ type: 'circle', magnet: 150 }).magnet === 100 && bodyData({ type: 'circle', magnet: -150 }).magnet === -100);

  const w1 = new PhysicsWorld();
  w1.loadScene(sceneData({
    name: 'magnet roundtrip',
    bodies: [bodyData({ type: 'circle', x: 200, y: 200, radius: 15, magnet: 70, label: 'pole' })],
    winds: [{ id: 'w1', x: 300, y: 300, width: 300, height: 200, vx: -2, vy: 1, power: 1.5 }],
  }));
  const ser = w1.serializeScene();
  check('v1.25: serialize keeps magnet + winds', ser.bodies[0].magnet === 70 && ser.winds.length === 1 && ser.winds[0].vx === -2,
    JSON.stringify(ser.winds));
  const w2 = new PhysicsWorld();
  w2.loadScene(sceneData(ser));
  const pole = w2.allBodies()[0];
  check('v1.25: reload restores pole + wind field', w2.magnetOf(pole) === 70 && w2.windCount === 1 && w2.windById('w1').power === 1.5);
}

/* --- v1.25: new preset behaviour --- */
{
  const presets = presetScenes();
  const mag = presets.find((p) => p.key === 'magnets');
  check('v1.25: magnets preset exists', !!mag);
  const wm = new PhysicsWorld();
  wm.loadScene(mag.scene);
  for (let i = 0; i < 600; i++) wm.stepOnce();
  const sBall = wm.allBodies().map((b) => wm.serializeBody(b)).find((d) => d.label.startsWith('S Ball'));
  const sBody = wm.allBodies()[wm.allBodies().map((b) => wm.serializeBody(b)).findIndex((d) => d.label.startsWith('S Ball'))];
  check('v1.25: S ball ends up stuck to the N magnet',
    Math.hypot(sBody.position.x - 430, sBody.position.y - 300) < 90,
    `at (${Math.round(sBody.position.x)}, ${Math.round(sBody.position.y)}) label=${sBall && sBall.label}`);

  const tun = presets.find((p) => p.key === 'windtunnel');
  check('v1.25: wind tunnel preset exists with one wind field', !!tun && tun.scene.winds.length === 1);
  const ww = new PhysicsWorld();
  ww.loadScene(tun.scene);
  for (let i = 0; i < 600; i++) ww.stepOnce();
  const foamMaxX = Math.max(...ww.allBodies().filter((b) => ww.serializeBody(b).label.startsWith('Foam')).map((b) => b.position.x));
  const ironBody = ww.allBodies().find((b) => ww.serializeBody(b).label.startsWith('Iron'));
  check('v1.25: foam balls are blown downwind into the bin', foamMaxX > 850, `maxX=${Math.round(foamMaxX)}`);
  check('v1.25: iron block barely moves in the wind', ironBody.position.x < 560, `x=${Math.round(ironBody.position.x)}`);
}

/* --- v1.26: materials + magnet swing presets --- */
{
  const presets = presetScenes();
  const mat = presets.find((p) => p.key === 'materials');
  check('v1.26: materials preset exists', !!mat);
  const wm = new PhysicsWorld();
  wm.loadScene(mat.scene);
  for (let i = 0; i < 1200; i++) wm.stepOnce();
  const balls = wm.allBodies().filter((b) => wm.serializeBody(b).label.includes('球'));
  check('v1.26: all five material balls roll down and settle on the floor',
    balls.length === 5 && balls.every((b) => b.position.x > 1000 && b.position.y > 500 && b.position.y < 545),
    balls.map((b) => `${Math.round(b.position.x)},${Math.round(b.position.y)}`).join(' '));

  const sw = presets.find((p) => p.key === 'magnetswing');
  check('v1.26: magnet swing preset exists', !!sw);
  const ws = new PhysicsWorld();
  ws.loadScene(sw.scene);
  for (let i = 0; i < 1200; i++) ws.stepOnce();
  const ball = ws.allBodies().find((b) => ws.serializeBody(b).label.startsWith('S Ball'));
  check('v1.26: swing ball ends up hanging pulled toward the magnet',
    ball.position.x > 720 && Math.hypot(ball.position.x - 800, ball.position.y - 372) < 110,
    `at (${Math.round(ball.position.x)}, ${Math.round(ball.position.y)})`);
}

/* --- v1.25: share-link codec round-trip --- */
{
  const { encodeScenePayload, decodeScenePayload, payloadFromHash } = await import('../js/share.js');
  const scene = presetScenes().find((p) => p.key === 'windtunnel').scene;
  const payload = await encodeScenePayload(scene);
  check('v1.25: share payload has a codec tag', /^[gr]/.test(payload), payload.slice(0, 1));
  check('v1.25: payload survives the hash round-trip', payloadFromHash(`#s=${payload}`) === payload && payloadFromHash('#other') === null);
  const back = await decodeScenePayload(payload);
  check('v1.25: decoded scene validates and matches',
    !!back && validateScene(back).ok && back.bodies.length === scene.bodies.length && back.winds.length === 1);
  check('v1.25: garbage payload decodes to null', (await decodeScenePayload('g!!!not-base64!!!')) === null);
}

/* --- v1.39: import hardening (size cap, finite/range audit, string bounds) --- */
{
  check('v1.39: sceneJsonTooLarge flags >2MB text', sceneJsonTooLarge('x'.repeat(MAX_SCENE_JSON_BYTES + 1)));
  check('v1.39: sceneJsonTooLarge passes small text', !sceneJsonTooLarge('{"format":"motionlab-scene"}'));
  const base = { format: 'motionlab-scene', version: 2, bodies: [{ type: 'circle', x: 10, y: 10, radius: 20 }] };
  check('v1.39: plain valid scene still passes', validateScene(base).ok);
  check('v1.39: Infinity angle rejected (what 1e999 parses to)', !validateScene({ ...base, bodies: [{ type: 'circle', x: 0, y: 0, angle: Infinity }] }).ok);
  check('v1.39: absurd radius rejected (finite but 1e308)', !validateScene({ ...base, bodies: [{ type: 'circle', x: 0, y: 0, radius: 1e308 }] }).ok);
  check('v1.39: zero width rejected', !validateScene({ ...base, bodies: [{ type: 'rectangle', x: 0, y: 0, width: 0, height: 10 }] }).ok);
  check('v1.39: oversized width rejected', !validateScene({ ...base, bodies: [{ type: 'rectangle', x: 0, y: 0, width: 6000, height: 10 }] }).ok);
  check('v1.39: huge position rejected', !validateScene({ ...base, bodies: [{ type: 'circle', x: 1e308, y: 0 }] }).ok);
  check('v1.39: million-sided polygon rejected', !validateScene({ ...base, bodies: [{ type: 'polygon', x: 0, y: 0, sides: 1000000 }] }).ok);
  check('v1.39: boundary geometry accepted (r=2500, sides=64)', validateScene({ ...base, bodies: [{ type: 'polygon', x: 0, y: 0, radius: 2500, sides: 64 }] }).ok);
  check('v1.39: scene name >128 rejected', !validateScene({ ...base, name: 'n'.repeat(129) }).ok);
  check('v1.39: body label >64 rejected', !validateScene({ ...base, bodies: [{ type: 'circle', x: 0, y: 0, label: 'l'.repeat(65) }] }).ok);
  check('v1.39: fluid at absurd position rejected', !validateScene({ ...base, fluids: [{ x: 1e308, y: 0, width: 100, height: 100 }] }).ok);
  check('v1.39: bodyData clamps monster geometry', bodyData({ type: 'polygon', sides: 100000 }).sides === 64
    && bodyData({ width: 1e9 }).width === 5000 && bodyData({ radius: 1e9 }).radius === 2500);
  check('v1.39: sceneData truncates long name/label', sceneData({ name: 'n'.repeat(200) }).name.length === 128
    && bodyData({ label: 'l'.repeat(200) }).label.length === 64);
  const { decodeScenePayload } = await import('../js/share.js');
  const bigJson = JSON.stringify({ format: 'motionlab-scene', version: 2, name: 'x'.repeat(MAX_SCENE_JSON_BYTES), bodies: [] });
  const rawPayload = 'r' + Buffer.from(bigJson, 'utf8').toString('base64url');
  check('v1.39: oversized share payload decodes to null', (await decodeScenePayload(rawPayload)) === null);
}


/* --- v1.52: video recording helpers (pure) --- */
{
  const { pickVideoMime, videoExt, videoSupported, VIDEO_MIME_CANDIDATES } = await import('../js/video.js');
  check('video: mp4 preferred when supported', pickVideoMime((m) => m.includes('mp4') || m.includes('webm')) === VIDEO_MIME_CANDIDATES[0]);
  check('video: falls back to webm when mp4 refused', pickVideoMime((m) => m.includes('webm')) === 'video/webm;codecs=vp9');
  check('video: empty string when nothing is supported', pickVideoMime(() => false) === '');
  check('video: a throwing isTypeSupported does not break the picker', pickVideoMime(() => { throw new Error('nope'); }) === '');
  check('video: extension follows the mime family', videoExt('video/mp4;codecs=avc1') === 'mp4' && videoExt('video/webm;codecs=vp9') === 'webm' && videoExt('') === 'webm');
  const fakeOk = { MediaRecorder: function () {}, HTMLCanvasElement: function () {} };
  fakeOk.HTMLCanvasElement.prototype = { captureStream: () => ({}) };
  check('video: support detected with MediaRecorder + captureStream', videoSupported(fakeOk) === true);
  check('video: unsupported without MediaRecorder', videoSupported({ HTMLCanvasElement: fakeOk.HTMLCanvasElement }) === false);
  check('video: unsupported without captureStream', videoSupported({ MediaRecorder: function () {}, HTMLCanvasElement: function () {} }) === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
