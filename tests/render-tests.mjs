/* Renderer cache tests (1.38) — the gesture-aware static/backdrop
   caches: bake once, blit while settled, TRANSFORM-blit while the
   camera moves (no rebake), rebake on the first settled frame and
   on content changes. Run: node tests/render-tests.mjs */
globalThis.window = globalThis;
window.devicePixelRatio = 2;

const ctxRegistry = [];
function makeCtx(tag) {
  const rec = { tag, calls: 0, drawImages: 0 };
  ctxRegistry.push(rec);
  const target = {};
  const ctx = new Proxy(target, {
    get(t, prop) {
      if (prop === 'canvas') return t.canvas;
      if (typeof prop === 'string') {
        return (...args) => {
          rec.calls++;
          if (prop === 'drawImage') rec.drawImages++;
        };
      }
      return undefined;
    },
    set(t, prop, v) { t[prop] = v; return true; },
  });
  return ctx;
}
let canvasSeq = 0;
function makeCanvas() {
  const tag = canvasSeq === 0 ? 'main' : `off${canvasSeq}`;
  canvasSeq++;
  return { width: 300, height: 150, getContext: () => makeCtx(tag), getBoundingClientRect: () => ({ width: 1200, height: 700 }) };
}
globalThis.document = { createElement: () => makeCanvas() };

const { Renderer } = await import('../js/render.js');

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
}
const offCalls = () => ctxRegistry.filter((r) => r.tag !== 'main').reduce((s, r) => s + r.calls, 0);
const mainDrawImages = () => ctxRegistry.find((r) => r.tag === 'main').drawImages;

function mkBody(id, isStatic, x, y) {
  return {
    _id: id, _type: 'rectangle', isStatic,
    position: { x, y }, angle: 0, circleRadius: 0,
    velocity: { x: 0, y: 0 }, isSleeping: false,
    vertices: [{ x: x - 10, y: y - 10 }, { x: x + 10, y: y - 10 }, { x: x + 10, y: y + 10 }, { x: x - 10, y: y + 10 }],
    bounds: { min: { x: x - 10, y: y - 10 }, max: { x: x + 10, y: y + 10 } },
  };
}
const s1 = mkBody('s1', true, 200, 200);
const s2 = mkBody('s2', true, 500, 200);
const d1 = mkBody('d1', false, 350, 400);
const world = {
  forEachBody(cb) { [s1, s2, d1].forEach(cb); },
  dataIdOf: (b) => b._id,
  typeOf: (b) => b._type,
  magnetOf: () => 0,
  isBound: () => false,
  constraintSegments: () => [],
};

const renderer = new Renderer(makeCanvas());
renderer.resize();
renderer.camera.x = 640; renderer.camera.y = 300; renderer.camera.zoom = 1;
const opts = { showGrid: true };

// frame 1: both caches bake
renderer.draw(world, opts);
const afterBake = offCalls();
check('first frame bakes the caches', afterBake > 0, `off=${afterBake}`);
check('first frame blits both layers', mainDrawImages() >= 2, `drawImages=${mainDrawImages()}`);

// frame 2: camera settled -> pure blits, no rebake
renderer.draw(world, opts);
check('settled frame does not rebake', offCalls() === afterBake, `off=${offCalls()} vs ${afterBake}`);

// frame 3: camera moves -> transformed reuse, still no rebake
const beforeMove = offCalls();
const imagesBefore = mainDrawImages();
renderer.camera.x = 660; renderer.camera.y = 310; renderer.camera.zoom = 1.1;
renderer.draw(world, opts);
check('moving camera does not rebake', offCalls() === beforeMove, `off=${offCalls()} vs ${beforeMove}`);
check('moving camera still blits both layers', mainDrawImages() - imagesBefore >= 2, `+${mainDrawImages() - imagesBefore}`);

// frame 4: camera holds the new pose -> rebake exactly on settle
renderer.draw(world, opts);
check('settled-after-move rebakes', offCalls() > beforeMove, `off=${offCalls()} vs ${beforeMove}`);

// frame 5: settled again -> pure blits
const afterSettle = offCalls();
renderer.draw(world, opts);
check('post-settle frame does not rebake', offCalls() === afterSettle);

// frame 6: a static body moves (content change), camera static -> rebake
s1.position.x += 30;
renderer.draw(world, opts);
check('static content change rebakes', offCalls() > afterSettle, `off=${offCalls()} vs ${afterSettle}`);

// frame 7: grid toggled off -> backdrop rebakes
const beforeToggle = offCalls();
renderer.draw(world, { showGrid: false });
check('grid toggle rebakes the backdrop', offCalls() > beforeToggle, `off=${offCalls()} vs ${beforeToggle}`);

// frame 8: pan (translate only) also reuses the bitmap
const beforePan = offCalls();
renderer.camera.x += 25;
renderer.draw(world, { showGrid: false });
check('pan reuses the bitmap too', offCalls() === beforePan, `off=${offCalls()} vs ${beforePan}`);

console.log(`\nrender-tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
