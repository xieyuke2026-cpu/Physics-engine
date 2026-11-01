/* MotionLab 3D lab smoke — run: node tests/lab3d-smoke.mjs
   Mode switching, 3D tools, saving to the separate 3D library, home distinction.
   No THREE in this harness: the view must fall back to wireframe mode. */
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire('/home/hatch/workspace/webos/package.json');
const localRequire = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  .replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;

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
window.localStorage.setItem('motionlab.visited.v1', '1');

for (const k of ['document', 'localStorage']) globalThis[k] = window[k];
globalThis.window = window;
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.confirm = window.confirm; globalThis.prompt = window.prompt;

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`FAIL  ${name} ${extra}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const doc = window.document;
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const ptr = (type, x, y, id = 1) => {
  const e = new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: id });
  return e;
};

await import('../js/app.js');
await wait(350);

/* --- mode switching --- */
check('3d: starts in 2D mode', !doc.getElementById('main').hidden && doc.getElementById('main3d').hidden);
click(doc.getElementById('mode3d'));
await wait(120);
check('3d: 3D lab becomes visible', !doc.getElementById('main3d').hidden && doc.getElementById('main').hidden);
check('3d: status shows default scene bodies', doc.getElementById('st3Count').textContent.includes('6'),
  doc.getElementById('st3Count').textContent);
check('3d: renderer fell back to wireframe (no WebGL in harness)',
  doc.getElementById('st3Render').textContent.includes('线框'), doc.getElementById('st3Render').textContent);
check('3d: project name synced to 3D scene', doc.getElementById('projectName').value === 'Untitled 3D Scene');

/* --- run + add bodies --- */
click(doc.getElementById('btn3Play'));
await wait(80);
check('3d: play state shows running', doc.getElementById('st3State').textContent.includes('运行中'));
click(doc.getElementById('btn3Pause'));
const boxTool = doc.querySelector('[data-t3="box"]');
click(boxTool);
const cvs = doc.getElementById('world3d');
cvs.dispatchEvent(ptr('pointerdown', 600, 350, 1));
await wait(60);
check('3d: box tool adds a body', doc.getElementById('st3Count').textContent.includes('7'),
  doc.getElementById('st3Count').textContent);
cvs.dispatchEvent(ptr('pointerup', 600, 350, 1));
check('3d: new body is selected in panel', doc.getElementById('panel3dBody').textContent.includes('方块'));

/* --- save to the separate 3D library --- */
doc.getElementById('projectName').value = '我的3D场景';
doc.getElementById('projectName').dispatchEvent(new window.Event('change', { bubbles: true }));
click(doc.getElementById('btn3Save'));
await wait(80);
const lib3 = JSON.parse(window.localStorage.getItem('motionlab.scenes3d.v1') || '{}');
check('3d: scene saved into 3D library key', !!lib3['我的3D场景']);
check('3d: saved scene format is the 3D format', lib3['我的3D场景'] && lib3['我的3D场景'].format === 'motionlab-scene-3d');
const lib2 = JSON.parse(window.localStorage.getItem('motionlab.scenes.v1') || '{}');
check('3d: 2D library untouched by 3D save', !lib2['我的3D场景']);

/* --- back to 2D --- */
click(doc.getElementById('mode2d'));
await wait(80);
check('3d: switching back restores 2D lab', !doc.getElementById('main').hidden && doc.getElementById('main3d').hidden);

/* --- home distinction --- */
click(doc.getElementById('btnScenes'));
await wait(150);
check('home: 3D preset cards listed separately', doc.querySelectorAll('#presetList3d .preset-card').length === 4,
  `${doc.querySelectorAll('#presetList3d .preset-card').length}`);
check('home: 2D preset cards still 10', doc.querySelectorAll('#presetList .preset-card').length === 10);
const savedCard = [...doc.querySelectorAll('#sceneList3d .scene-card')]
  .find((c) => c.textContent.includes('我的3D场景'));
check('home: saved 3D scene appears in the 3D library section', !!savedCard);
check('home: 3D card carries a 3D badge', savedCard && savedCard.textContent.includes('3D'));
check('home: sidebar preset count covers both dims', doc.getElementById('countPresets').textContent === '14',
  doc.getElementById('countPresets').textContent);
const openBtn = [...savedCard.querySelectorAll('.mini-btn')].find((b) => b.textContent === '打开');
click(openBtn);
await wait(150);
check('home: opening a 3D scene enters the 3D lab',
  !doc.getElementById('main3d').hidden && doc.getElementById('sceneNav').hidden);
check('home: opened scene name follows', doc.getElementById('projectName').value === '我的3D场景');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
