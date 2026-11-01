/* MotionLab project-navigation smoke — run: node tests/nav-smoke.mjs
   The 我的项目 hub: store scenes, see cards with thumbnails, search, open. */
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
window.localStorage.setItem('motionlab.visited.v1', '1'); // skip landing

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

await import('../js/app.js');
await wait(300);

/* --- v1.5: hub is the home page, with a sidebar --- */
check('home: hub is shown on boot (return visit)', !doc.getElementById('sceneNav').hidden);
check('home: sidebar has three views', doc.querySelectorAll('.side-item').length === 3);
const viewBtn = (v) => doc.querySelector(`.side-item[data-view="${v}"]`);
click(viewBtn('presets'));
await wait(60);
check('sidebar: presets view hides saved + current sections',
  doc.getElementById('navSectionSaved').hidden && doc.getElementById('navSectionCurrent').hidden
  && !doc.getElementById('navSectionPresets').hidden);
check('sidebar: presets view hides the search toolbar', doc.getElementById('navToolbar').style.display === 'none');
click(viewBtn('library'));
await wait(60);
check('sidebar: library view shows saved, hides presets',
  !doc.getElementById('navSectionSaved').hidden && doc.getElementById('navSectionPresets').hidden);
click(viewBtn('overview'));
await wait(60);
check('sidebar: overview shows everything again',
  !doc.getElementById('navSectionSaved').hidden && !doc.getElementById('navSectionPresets').hidden
  && !doc.getElementById('navSectionCurrent').hidden);
click(doc.getElementById('btnCloseNav'));
await wait(60);
check('home: 进入实验室 closes the hub', doc.getElementById('sceneNav').hidden);

// save the default scene under a project name first
doc.getElementById('projectName').value = '我的实验一号';
doc.getElementById('projectName').dispatchEvent(new window.Event('change', { bubbles: true }));
click(doc.getElementById('btnSave'));
await wait(120);

// open the hub
click(doc.getElementById('btnScenes'));
await wait(150);
check('nav: hub becomes visible', !doc.getElementById('sceneNav').hidden);
check('nav: current-scene card rendered', doc.querySelectorAll('#navCurrent .scene-card').length >= 1);
check('nav: current card offers save + continue',
  doc.querySelector('#navCurrent').textContent.includes('保存到场景库'));
const cards = doc.querySelectorAll('#sceneList .scene-card');
check('nav: saved scene appears as a card', cards.length === 1, `cards=${cards.length}`);
check('nav: card shows the scene name + body count',
  doc.querySelector('#sceneList').textContent.includes('我的实验一号')
  && doc.querySelector('#sceneList').textContent.includes('9 个物体'));
check('nav: card has a thumbnail canvas', !!doc.querySelector('#sceneList .scene-card canvas.thumb'));
await wait(120); // thumbnails draw on rAF
check('nav: thumbnail actually drawn', drawCalls > 0);
check('nav: presets listed as cards with overview thumbnails',
  doc.querySelectorAll('#presetList .preset-card').length === 10
  && !!doc.querySelector('#presetList .preset-card canvas.thumb'));
check('nav: sidebar preset count shows 2D only while 3D is hidden', doc.getElementById('countPresets').textContent === '10');

// search filters cards
const search = doc.getElementById('sceneSearch');
search.value = '不存在的名字';
search.dispatchEvent(new window.Event('input', { bubbles: true }));
await wait(60);
check('nav: search with no match shows empty note', doc.getElementById('sceneList').textContent.includes('没有匹配'));
search.value = '实验';
search.dispatchEvent(new window.Event('input', { bubbles: true }));
await wait(60);
check('nav: search match restores the card', doc.querySelectorAll('#sceneList .scene-card').length === 1);

// open the stored scene from its card
const openBtn = [...doc.querySelectorAll('#sceneList .mini-btn')].find((b) => b.textContent === '打开');
click(openBtn);
await wait(150);
check('nav: opening a card closes the hub', doc.getElementById('sceneNav').hidden);
check('nav: opened scene is loaded in the lab', doc.getElementById('stCount').textContent.includes('9'),
  doc.getElementById('stCount').textContent);
check('nav: project name follows the scene', doc.getElementById('projectName').value === '我的实验一号');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
