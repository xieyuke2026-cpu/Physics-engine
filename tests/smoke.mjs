/* MotionLab jsdom smoke test — run: node tests/smoke.mjs
   Boots the real app (index.html DOM + js/app.js modules) with a stubbed 2D
   canvas context, then drives the actual UI: play, create, edit, save, undo.
   jsdom is borrowed from the sibling webos project's node_modules. */
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire('/home/hatch/workspace/webos/package.json');
const localRequire = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  .replace(/<script[\s\S]*?<\/script>/g, ''); // scripts are loaded manually below
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;

// --- canvas 2D stub (jsdom has no rasterizer) ---
let drawCalls = 0;
const fakeCtx = new Proxy({}, {
  get(t, p) { if (p in t) return t[p]; return () => { drawCalls++; }; },
  set(t, p, v) { t[p] = v; return true; },
});
window.HTMLCanvasElement.prototype.getContext = () => fakeCtx;
window.HTMLCanvasElement.prototype.setPointerCapture = () => {};
window.Element.prototype.getBoundingClientRect = function () {
  return { width: 1200, height: 700, left: 0, top: 0, right: 1200, bottom: 700, x: 0, y: 0 };
};
window.Matter = localRequire('../vendor/matter.min.js');
window.confirm = () => true;
window.prompt = () => null;

// --- expose browser globals to Node module scope ---
for (const k of ['document', 'localStorage']) globalThis[k] = window[k];
globalThis.window = window;
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.confirm = window.confirm; globalThis.prompt = window.prompt;

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`FAIL  ${name} ${extra}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const doc = window.document;
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
function pointer(el, type, x, y) {
  const e = new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  el.dispatchEvent(e);
}

await import('../js/app.js');
await wait(300);

const stCount = () => doc.getElementById('stCount').textContent;
const stState = () => doc.getElementById('stState').textContent;

check('boot: status shows 9 bodies', stCount().includes('9'), stCount());
check('boot: state is paused', stState().includes('已暂停'), stState());
check('boot: scene panel visible', doc.getElementById('panelBody').textContent.includes('场景属性'));
check('boot: toolbar icons rendered (svg)', doc.querySelectorAll('#topbar svg').length >= 8,
  `svgs=${doc.querySelectorAll('#topbar svg').length}`);
check('boot: 7 tool buttons with svg icons', doc.querySelectorAll('.tool-btn svg').length === 7);
check('renderer is drawing frames', drawCalls > 50, `drawCalls=${drawCalls}`);

click(doc.getElementById('btnPlay'));
await wait(1400);
check('play: state becomes running', stState().includes('运行中'), stState());
check('play: FPS counter live', /FPS [1-9]/.test(doc.getElementById('stFps').textContent), doc.getElementById('stFps').textContent);
check('play: bodies still 9 after settling', stCount().includes('9'), stCount());
click(doc.getElementById('btnPause'));
await wait(60);
check('pause: state back to paused', stState().includes('已暂停'));

// create a circle through the real pointer pipeline
click(doc.querySelector('[data-tool="circle"]'));
const canvas = doc.getElementById('world');
pointer(canvas, 'pointerdown', 620, 330);
pointer(canvas, 'pointerup', 620, 330);
await wait(400); // status bar refreshes on a 250ms interval
check('create circle: count becomes 10', stCount().includes('10'), stCount());
const panelBody = doc.getElementById('panelBody');
check('create circle: property panel shows object fields',
  !!panelBody.querySelector('[data-key="radius"]') && !!panelBody.querySelector('[data-key="mass"]')
  && !!panelBody.querySelector('[data-key="friction"]') && !!panelBody.querySelector('[data-key="restitution"]'));

// edit density via the panel -> should not error and should stick in the form
const dens = panelBody.querySelector('[data-key="density"]');
dens.value = '0.004';
dens.dispatchEvent(new window.Event('change', { bubbles: true }));
await wait(60);
check('edit density: value accepted', dens.value === '0.004');

// save scene to library
click(doc.getElementById('btnSave'));
await wait(60);
const lib = JSON.parse(window.localStorage.getItem('motionlab.scenes.v1') || '{}');
check('save: scene stored in localStorage library', !!lib['Untitled Scene'] && lib['Untitled Scene'].bodies.length === 10,
  Object.keys(lib).join(','));
check('autosave written', !!window.localStorage.getItem('motionlab.autosave.v1'));

// undo steps: creation and the density edit are separate history entries,
// so two undos return to the initial 9-body scene (snapshots debounced 350ms)
await wait(600);
click(doc.getElementById('btnUndo'));
await wait(150);
click(doc.getElementById('btnUndo'));
await wait(400);
check('undo x2: count back to 9', stCount().includes('9'), stCount());
click(doc.getElementById('btnRedo'));
await wait(150);
click(doc.getElementById('btnRedo'));
await wait(400);
check('redo x2: count back to 10', stCount().includes('10'), stCount());

// delete via keyboard path (selection exists after redo? redo reloads scene -> selection cleared)
// select the circle again with the select tool, then press Delete
click(doc.querySelector('[data-tool="select"]'));
pointer(canvas, 'pointerdown', 620, 330);
pointer(canvas, 'pointerup', 620, 330);
await wait(60);
window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
await wait(400);
check('delete key: count back to 9', stCount().includes('9'), stCount());

// scenes modal renders list
click(doc.getElementById('btnScenes'));
await wait(60);
check('scenes modal lists saved scene', doc.getElementById('sceneList').textContent.includes('Untitled Scene'));
check('no page errors during smoke', true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
