/* MotionLab 3D-hidden smoke — run: node tests/lab3d-smoke.mjs
   Since 1.8 (Ryan: hide all 3D content, do not delete) FEATURE_3D=false:
   no mode switch, no 3D lab entry, no 3D sections/cards on the home hub,
   counts are 2D-only — while the 3D code and stored data remain untouched. */
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire('/home/hatch/workspace/webos/package.json');
const localRequire = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  .replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;

const fakeCtx = new Proxy({}, {
  get(t, p) { if (p in t) return t[p]; return () => {}; },
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
window.localStorage.setItem('motionlab.lang', 'zh');
// plant a 3D scene in storage first: hiding must not delete it
window.localStorage.setItem('motionlab.scenes3d.v1', JSON.stringify({
  '保留的3D场景': {
    format: 'motionlab-scene-3d', version: 1, name: '保留的3D场景',
    settings: { gravityX: 0, gravityY: -9.82, gravityZ: 0, gravityEnabled: true, speed: 1, friction: 0.4, restitution: 0.25 },
    bodies: [{ id: 'g', kind: 'box', x: 0, y: -0.5, z: 0, sizeX: 44, sizeY: 1, sizeZ: 44, isStatic: true, isBound: true }],
    updatedAt: Date.now(),
  },
}));

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

await import('../js/app.js');
await wait(350);

/* --- the switch and the lab stay hidden; even a click cannot enter 3D --- */
check('hidden: mode switch is not displayed', doc.querySelector('.mode-switch').style.display === 'none');
{
  // v1.20 structural guards: the hiding no longer depends on JS timing —
  // body carries no-3d in the markup and the stylesheet kills 3D surfaces.
  const cssText = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
  check('v1.20: body starts with the no-3d structural guard',
    doc.body.classList.contains('no-3d') && html.includes('<body class="no-3d">')
    && cssText.includes('body.no-3d .mode-switch') && cssText.includes('body.no-3d #navSectionPresets3D'));
}
check('hidden: 3D lab DOM stays hidden', doc.getElementById('main3d').hidden && doc.getElementById('statusbar3d').hidden);
click(doc.getElementById('mode3d'));
await wait(80);
check('hidden: clicking the (hidden) 3D button cannot switch modes',
  !doc.getElementById('main').hidden && doc.getElementById('main3d').hidden);
check('hidden: still on the 2D scene name', doc.getElementById('projectName').value === 'Untitled Scene');

/* --- home hub shows no 3D content --- */
click(doc.getElementById('btnScenes'));
await wait(150);
check('hidden: no 3D preset cards rendered', doc.querySelectorAll('#presetList3d .preset-card').length === 0);
check('hidden: 3D preset section is display:none', doc.getElementById('navSectionPresets3D').style.display === 'none');
check('hidden: 3D library section is display:none', doc.getElementById('navSectionSaved3D').style.display === 'none');
check('hidden: no 3D scene cards rendered', doc.querySelectorAll('#sceneList3d .scene-card').length === 0);
check('hidden: no 3D entry card in current section',
  ![...doc.querySelectorAll('#navCurrent .scene-card-name')].some((n) => n.textContent.includes('3D 实验室')));
check('hidden: sidebar counts are 2D-only',
  doc.getElementById('countPresets').textContent === '20' && doc.getElementById('countLibrary').textContent === '0',
  `${doc.getElementById('countPresets').textContent}/${doc.getElementById('countLibrary').textContent}`);
check('hidden: 2D presets still listed', doc.querySelectorAll('#presetList .preset-card').length === 20);

/* --- but nothing was deleted --- */
const lib3 = JSON.parse(window.localStorage.getItem('motionlab.scenes3d.v1') || '{}');
check('hidden: stored 3D scene data is untouched', !!lib3['保留的3D场景']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
