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
window.localStorage.setItem('motionlab.lang', 'zh'); // this suite asserts the Chinese UI

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
check('home: sidebar has four views', doc.querySelectorAll('.side-item[data-view]').length === 4);
const viewBtn = (v) => doc.querySelector(`.side-item[data-view="${v}"]`);
click(viewBtn('presets'));
await wait(60);
check('sidebar: presets view hides saved + current sections',
  doc.getElementById('navSectionSaved').hidden && doc.getElementById('navSectionCurrent').hidden
  && doc.getElementById('navSectionSavedList').hidden && doc.getElementById('hubInspector').hidden
  && !doc.getElementById('navSectionPresets').hidden);
check('sidebar: presets view hides the search toolbar', doc.getElementById('navToolbar').style.display === 'none');
click(viewBtn('library'));
await wait(60);
check('sidebar: library view shows saved, hides presets',
  !doc.getElementById('navSectionSaved').hidden && doc.getElementById('navSectionPresets').hidden);
click(viewBtn('overview'));
await wait(60);
check('sidebar: overview is the workbench (rows + inspector, grids tucked away)',
  !doc.getElementById('navSectionCurrent').hidden
  && !doc.getElementById('navSectionSavedList').hidden && !doc.getElementById('navSectionPresetsList').hidden
  && !doc.getElementById('hubInspector').hidden
  && doc.getElementById('navSectionSaved').hidden && doc.getElementById('navSectionPresets').hidden);

/* --- v1.12: developer docs view + settings reachable from the hub --- */
click(viewBtn('docs'));
await wait(60);
check('docs: view shows the docs section and hides the scene sections',
  !doc.getElementById('navSectionDocs').hidden && doc.getElementById('navSectionSaved').hidden
  && doc.getElementById('navSectionPresets').hidden && doc.getElementById('navSectionCurrent').hidden);
check('docs: view hides the search toolbar and retitles the page',
  doc.getElementById('navToolbar').style.display === 'none'
  && doc.getElementById('navTitle').textContent === '开发者文档');
check('docs: content covers download + engine usage',
  doc.getElementById('navSectionDocs').textContent.includes('如何下载')
  && doc.getElementById('navSectionDocs').textContent.includes('PhysicsEngine')
  && doc.getElementById('navSectionDocs').textContent.includes('addBody'));
check('v1.12: settings button uses a gear icon, not the old sun',
  doc.getElementById('btnSettings').innerHTML.includes('M19.4'));
const navSettingsBtn = doc.getElementById('btnNavSettings');
check('v1.12: hub has a labelled settings entry', !!navSettingsBtn && navSettingsBtn.textContent.includes('设置'));
click(navSettingsBtn);
await wait(60);
check('v1.12: hub settings entry opens the settings modal',
  !doc.getElementById('modalSettings').hidden
  && doc.getElementById('settingsBody').textContent.includes('重置数据'));
click(doc.querySelector('#modalSettings [data-close]'));
await wait(60);
check('v1.12: settings modal closes again', doc.getElementById('modalSettings').hidden);

/* --- v1.13: the settings modal must stack ABOVE the home hub --- */
const cssText = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
const zOf = (sel) => {
  const m = cssText.match(new RegExp(sel.replace(/[.#]/g, '\\$&') + '\\{[^}]*z-index:(\\d+)'));
  return m ? Number(m[1]) : NaN;
};
check('v1.13: modal backdrop z-index exceeds the home hub (settings opens on the hub, not under it)',
  zOf('.modal-backdrop') > zOf('#sceneNav'), `modal=${zOf('.modal-backdrop')} hub=${zOf('#sceneNav')}`);
check('v1.13: toast z-index exceeds the modal', zOf('#toast') > zOf('.modal-backdrop'),
  `toast=${zOf('#toast')} modal=${zOf('.modal-backdrop')}`);
click(viewBtn('overview'));
await wait(60);
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
  doc.querySelectorAll('#presetList .preset-card').length === 21
  && !!doc.querySelector('#presetList .preset-card canvas.thumb'));
check('nav: sidebar preset count shows 2D only while 3D is hidden', doc.getElementById('countPresets').textContent === '21');

/* --- v1.40: workbench overview (rows + inspector) --- */
check('workbench: scene rows mirror the library', doc.querySelectorAll('#sceneRows .scene-row').length === 1
  && doc.querySelector('#sceneRows').textContent.includes('我的实验一号'));
check('workbench: preset rows list all 21 presets', doc.querySelectorAll('#presetRows .scene-row').length === 21,
  `rows=${doc.querySelectorAll('#presetRows .scene-row').length}`);
check('workbench: inspector defaults to the newest saved scene',
  doc.getElementById('inspBody').textContent.includes('我的实验一号')
  && doc.getElementById('inspBody').textContent.includes('打开'));
const galtonRow = [...doc.querySelectorAll('#presetRows .scene-row')].find((r) => r.textContent.includes('钉板'));
click(galtonRow);
await wait(60);
check('workbench: selecting a preset row retargets the inspector',
  doc.getElementById('inspBody').textContent.includes('钉板概率')
  && doc.getElementById('inspBody').textContent.includes('载入并运行'));
check('workbench: whats-new card sits in the inspector column',
  doc.getElementById('navWhatsNew').textContent.includes('本版更新')
  && doc.getElementById('navWhatsNew').textContent.includes('流体蔓延'));

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

/* --- v1.24: hub follows the language switch (titles, docs view, preset names) --- */
click(doc.getElementById('btnScenes'));
await wait(120);
click(viewBtn('docs'));
await wait(60);
click(doc.getElementById('btnNavSettings'));
await wait(60);
const langBtn = (label) => [...doc.querySelectorAll('#settingsBody .lang-switch .btn')].find((b) => b.textContent === label);
click(langBtn('English'));
await wait(80);
check('v1.24: hub title switches to English', doc.getElementById('navTitle').textContent === 'Developer Docs',
  doc.getElementById('navTitle').textContent);
check('v1.24: docs view shows the English docs and hides the Chinese ones',
  !doc.querySelector('.docs[data-lang="en"]').hidden && doc.querySelector('.docs[data-lang="zh"]').hidden);
click(doc.querySelector('#modalSettings [data-close]'));
await wait(60);
click(viewBtn('presets'));
await wait(60);
check('v1.24: preset cards show English names',
  doc.querySelector('#presetList .scene-card-name').textContent.includes("Newton's Cradle"),
  doc.querySelector('#presetList .scene-card-name').textContent);
click(viewBtn('docs'));
await wait(60);
click(doc.getElementById('btnNavSettings'));
await wait(60);
click(langBtn('中文'));
await wait(80);
check('v1.24: switching back restores the Chinese hub',
  doc.getElementById('navTitle').textContent === '开发者文档'
  && !doc.querySelector('.docs[data-lang="zh"]').hidden);
click(doc.querySelector('#modalSettings [data-close]'));
await wait(60);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
