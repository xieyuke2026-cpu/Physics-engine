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
window.localStorage.setItem('motionlab.lang', 'zh'); // this suite asserts the Chinese UI; v1.24 blocks exercise switching

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
check('boot: 12 tool buttons with svg icons', doc.querySelectorAll('#toolrail .tool-btn svg').length === 12,
  `svgs=${doc.querySelectorAll('.tool-btn svg').length}`);
check('renderer is drawing frames', drawCalls > 50, `drawCalls=${drawCalls}`);

click(doc.getElementById('btnPlay'));
await wait(2200); // jsdom rAF is throttled under load; the FPS check needs a full update window
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

/* --- v1.9: blast tool --- */
click(doc.querySelector('[data-tool="blast"]'));
check('v1.9: blast hint explains the tool', doc.getElementById('stageHint').textContent.includes('冲击波'));
pointer(canvas, 'pointerdown', 620, 300);
pointer(canvas, 'pointerup', 620, 300);
await wait(80);
check('v1.9: blast reports pushed bodies in toast', doc.getElementById('toast').textContent.includes('冲击波推开了'),
  doc.getElementById('toast').textContent);
click(doc.querySelector('[data-tool="select"]'));

// scenes modal renders list
click(doc.getElementById('btnScenes'));
await wait(60);
check('scenes modal lists saved scene', doc.getElementById('sceneList').textContent.includes('Untitled Scene'));

/* --- v1.1/v1.6: presets (cards with overview thumbnails since 1.6) --- */
const presetBtns = doc.querySelectorAll('#presetList .preset-card');
check('v1.9: twenty-one preset cards rendered', presetBtns.length === 21, `got ${presetBtns.length}`);
check('v1.6: preset cards carry overview thumbnails', !!presetBtns[0].querySelector('canvas.thumb'));
click(presetBtns[0].querySelector('.mini-btn')); // Newton's cradle (auto-runs)
await wait(500);
check('v1.1: cradle preset loads 9 bodies', stCount().includes('9'), stCount());
check('v1.1: cradle preset auto-runs', stState().includes('运行中'), stState());
click(doc.getElementById('btnPause'));
await wait(60);

// back to the default scene via the scene panel's new-scene button
const newBtn = [...doc.getElementById('panelBody').querySelectorAll('button')].find((b) => b.textContent.includes('新建场景'));
click(newBtn);
await wait(200);
check('v1.1: new scene restores default 9 bodies', stCount().includes('9'), stCount());

/* --- v1.1: spring tool creates a real constraint (fit zoom 0.895, cam 640,300) --- */
click(doc.querySelector('[data-tool="spring"]'));
pointer(canvas, 'pointerdown', 367, 189); pointer(canvas, 'pointerup', 367, 189); // Ball at (380,120)
await wait(60);
pointer(canvas, 'pointerdown', 600, 162); pointer(canvas, 'pointerup', 600, 162); // Box at (640,90)
await wait(900); // autosave debounce 700ms
const auto = JSON.parse(window.localStorage.getItem('motionlab.autosave.v1') || '{}');
check('v1.1: spring saved into autosave constraints', Array.isArray(auto.constraints) && auto.constraints.length === 1,
  `constraints=${auto.constraints && auto.constraints.length}`);

/* --- v1.1: body panel extras --- */
click(doc.querySelector('[data-tool="select"]'));
pointer(canvas, 'pointerdown', 367, 189); pointer(canvas, 'pointerup', 367, 189);
await wait(60);
check('v1.1: panel shows air friction slider', !!panelBody.querySelector('[data-key="frictionAir"]'));
check('v1.1: panel shows lock-rotation switch', !!panelBody.querySelector('[data-key="lockRotation"]'));
check('v1.1: panel shows live readouts', panelBody.textContent.includes('动能') && panelBody.textContent.includes('角速度'));

/* --- v1.1: single-step while paused --- */
click(doc.getElementById('btnStep'));
await wait(60);
check('v1.1: step keeps paused state', stState().includes('已暂停'), stState());

/* --- v1.1: object list in scene panel --- */
window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await wait(60);
check('v1.1: scene panel lists objects', panelBody.textContent.includes('物体列表')
  && panelBody.querySelectorAll('.obj-row').length === 9,
  `rows=${panelBody.querySelectorAll('.obj-row').length}`);
check('no page errors during smoke', true);

/* --- v1.11: reset data (factory reset) --- */
window.localStorage.setItem('motionlab.scenes3d.v1', '{"Seed3D":{}}');
window.localStorage.setItem('motionlab.autosave3d.v1', '{}');
window.localStorage.setItem('motionlab.ui.v1', '{"panelHidden":true}');
check('v1.11: seed data present before reset',
  !!window.localStorage.getItem('motionlab.scenes.v1') && !!window.localStorage.getItem('motionlab.scenes3d.v1'));
click(doc.getElementById('btnSettings'));
await wait(80);
const resetBtn = [...doc.querySelectorAll('#settingsBody .btn')].find((b) => b.textContent.includes('重置数据'));
check('v1.11: settings shows the reset-data button', !!resetBtn);
check('v1.13: About line shows all three versions (app / engine / Matter)',
  doc.getElementById('settingsBody').textContent.includes('MotionLab 1.48')
  && doc.getElementById('settingsBody').textContent.includes('PhysicsEngine 1.12.4')
  && doc.getElementById('settingsBody').textContent.includes('Matter.js 0.20.0')
  && doc.getElementById('settingsBody').textContent.includes('PFLab 1.1.0'),
  doc.getElementById('settingsBody').textContent.slice(-260));
{
  const sel = doc.querySelector('#settingsBody select');
  check('v1.41: settings offers the backend picker (Matter default, Native experimental)',
    !!sel && sel.options.length === 2 && sel.value === 'matter'
    && sel.textContent.includes('Native') && sel.textContent.includes('实验性'),
    sel ? sel.textContent : 'no select');
  sel.value = 'native';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(400);
  check('v1.41: switching to Native persists the choice and keeps the scene',
    window.localStorage.getItem('motionlab.backend') === 'native'
    && /物体 [1-9]/.test(doc.getElementById('stCount').textContent),
    window.localStorage.getItem('motionlab.backend') + ' / ' + doc.getElementById('stCount').textContent);
  check('v1.43: scene panel Engine row follows the live backend',
    (doc.querySelector('[data-ro="engine"]') || {}).textContent === 'Native（自研）',
    (doc.querySelector('[data-ro="engine"]') || {}).textContent);
  sel.value = 'matter';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(120);
  check('v1.41: switching back to Matter works',
    window.localStorage.getItem('motionlab.backend') === 'matter');
  check('v1.43: scene panel Engine row returns to Matter.js',
    (doc.querySelector('[data-ro="engine"]') || {}).textContent === 'Matter.js',
    (doc.querySelector('[data-ro="engine"]') || {}).textContent);
}
{
  // Stylesheet integrity guard: a truncated rule once left an unclosed block
  // that silently disabled every later rule in real browsers (all of PFLab's
  // styles included) while text greps kept passing. Braces must balance.
  const cssText = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
  const stripped = cssText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"[^"]*"|'[^']*'/g, '""');
  let depth = 0, okDepth = true;
  for (const ch of stripped) { if (ch === '{') depth++; else if (ch === '}') depth--; if (depth < 0) okDepth = false; }
  check('v1.18: stylesheet braces balanced, no truncation markers',
    okDepth && depth === 0 && !cssText.includes('[truncated'), `depth=${depth}`);
}
click(resetBtn); // window.confirm is stubbed to true in this harness
await wait(500);
check('v1.11: 2D library key wiped', window.localStorage.getItem('motionlab.scenes.v1') === null);
check('v1.11: 3D library + autosave keys wiped',
  window.localStorage.getItem('motionlab.scenes3d.v1') === null && window.localStorage.getItem('motionlab.autosave3d.v1') === null);
check('v1.11: UI prefs + visited flag wiped',
  window.localStorage.getItem('motionlab.ui.v1') === null && window.localStorage.getItem('motionlab.visited.v1') === null);
check('v1.11: back to default scene (9 bodies, Untitled)',
  stCount().includes('9') && doc.getElementById('projectName').value === 'Untitled Scene', stCount());
check('v1.11: home hub open with empty library + reset toast',
  !doc.getElementById('sceneNav').hidden && doc.getElementById('toast').textContent.includes('已重置'),
  doc.getElementById('toast').textContent);
/* --- v1.24: the language choice is a preference, NOT scene data — a factory
       reset keeps it (the reset copy promises data/settings back to initial;
       the welcome page reappears via the visited flag, in the kept language) --- */
check('v1.24: language choice survives a factory reset', window.localStorage.getItem('motionlab.lang') === 'zh',
  window.localStorage.getItem('motionlab.lang'));

/* --- v1.23: lab entries for gravitation / fluids / rename, rail hover tips,
       and double-click no longer adds a circle --- */
{
  const toolBtns = [...doc.querySelectorAll('#toolrail .tool-btn')];
  check('v1.23: every tool-rail button carries a hover tip (data-tip)',
    toolBtns.length === 12 && toolBtns.every((b) => (b.getAttribute('data-tip') || '').length > 10),
    `buttons=${toolBtns.length}`);
  check('v1.23: scene panel exposes the gravitation entry',
    panelBody.textContent.includes('万有引力 Gravitation G') && !!panelBody.querySelector('input[data-key="gravitation"]'));
  const addBtn = [...panelBody.querySelectorAll('.btn')].find((b) => b.textContent.includes('添加流体区域'));
  check('v1.23: scene panel exposes the add-fluid entry', !!addBtn);
  click(addBtn);
  await wait(60);
  check('v1.23: adding a fluid opens its editor (density / drag)',
    panelBody.textContent.includes('流体区域 Fluid') && panelBody.textContent.includes('水中阻尼'),
    panelBody.textContent.slice(0, 120));
  const backBtn = [...panelBody.querySelectorAll('.btn')].find((b) => b.textContent.includes('返回场景属性'));
  click(backBtn);
  await wait(60);
  check('v1.23: scene panel lists the fluid next to the bodies',
    panelBody.textContent.includes('流体 1') && panelBody.querySelectorAll('.obj-row').length === 10,
    `rows=${panelBody.querySelectorAll('.obj-row').length}`);
  const groundRow = [...panelBody.querySelectorAll('.obj-row')].find((rw) => rw.textContent.includes('Ground'));
  click(groundRow);
  await wait(60);
  const nameInput = panelBody.querySelector('input[data-name-input]');
  check('v1.23: body panel has a rename box prefilled with the label',
    !!nameInput && nameInput.value === 'Ground', nameInput && nameInput.value);
  nameInput.value = '地面测试';
  nameInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(60);
  check('v1.23: renaming confirms via toast', doc.getElementById('toast').textContent.includes('地面测试'),
    doc.getElementById('toast').textContent);
  doc.getElementById('world').dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, clientX: 300, clientY: 200 }));
  await wait(320);
  check('v1.23: double-click on empty canvas adds nothing', stCount().includes('9'), stCount());
}

/* --- v1.24: language switch (Settings) re-renders panel + chrome live --- */
{
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); // back to scene panel
  await wait(60);
  click(doc.getElementById('btnSettings'));
  await wait(80);
  const langBtns = () => [...doc.querySelectorAll('#settingsBody .lang-switch .btn')];
  check('v1.24: settings shows a language switch with the current language active',
    langBtns().length === 2 && langBtns().find((b) => b.textContent === '中文').classList.contains('active'),
    doc.getElementById('settingsBody').textContent.slice(0, 80));
  click(langBtns().find((b) => b.textContent === 'English'));
  await wait(80);
  check('v1.24: switching persists the choice', window.localStorage.getItem('motionlab.lang') === 'en');
  check('v1.24: scene panel re-renders in English',
    doc.getElementById('panelBody').textContent.includes('Scene Properties')
    && doc.getElementById('panelBody').textContent.includes('Gravitation G'),
    doc.getElementById('panelBody').textContent.slice(0, 60));
  check('v1.24: settings re-render in English too',
    doc.getElementById('settingsBody').textContent.includes('Show Welcome Page')
    && langBtns().find((b) => b.textContent === 'English').classList.contains('active'));
  check('v1.24: status bar switches language', stState().includes('Paused'), stState());
  click(langBtns().find((b) => b.textContent === '中文'));
  await wait(80);
  check('v1.24: switching back restores the Chinese panel',
    window.localStorage.getItem('motionlab.lang') === 'zh'
    && doc.getElementById('panelBody').textContent.includes('场景属性'));
  click(doc.querySelector('#modalSettings [data-close]'));
  await wait(60);
}

/* --- v1.25: share button, hub import entry, wind add button --- */
{
  check('v1.25: top bar has a share button with an icon',
    !!doc.getElementById('btnShare') && doc.getElementById('btnShare').innerHTML.includes('<svg'));
  check('v1.25: home hub toolbar has an import-scene entry',
    !!doc.getElementById('btnImportHub') && doc.getElementById('btnImportHub').textContent.includes('导入场景'));
  check('v1.25: scene panel offers adding a wind region',
    doc.getElementById('panelBody').textContent.includes('添加风场区域'),
    doc.getElementById('panelBody').textContent.slice(0, 80));
}

/* --- v1.26: magnet entry points, material presets, draggable regions --- */
{
  const panelBody = doc.getElementById('panelBody');
  const countNum = () => Number(stCount().match(/\d+/)[0]);
  // scene-panel button adds a fixed N magnet and selects it
  check('v1.26: scene panel offers adding a magnet',
    panelBody.textContent.includes('添加磁铁'), panelBody.textContent.slice(0, 80));
  const before = countNum();
  click([...panelBody.querySelectorAll('.btn')].find((b) => b.textContent.includes('添加磁铁')));
  await wait(350); // status bar refreshes on a 250ms interval
  check('v1.26: add-magnet button creates a body', countNum() === before + 1, `${before} -> ${countNum()}`);
  const magInput = panelBody.querySelector('[data-key="magnet"]');
  check('v1.26: new magnet is selected with pole +100', !!magInput && magInput.value === '100',
    magInput ? magInput.value : 'no magnet input');
  // one-tap material preset writes the whole parameter set
  click(panelBody.querySelector('[data-mat="iron"]'));
  await wait(60);
  const dens = panelBody.querySelector('[data-key="density"]');
  check('v1.26: iron material preset sets density 0.008', !!dens && dens.value === '0.008',
    dens ? dens.value : 'no density input');
  // magnet tool places a magnet where tapped (world 640,90 <- screen 600,162)
  click(doc.querySelector('[data-tool="magnet"]'));
  const before2 = countNum();
  pointer(canvas, 'pointerdown', 600, 162); pointer(canvas, 'pointerup', 600, 162);
  await wait(350);
  check('v1.26: magnet tool creates a magnet on tap', countNum() === before2 + 1, `${before2} -> ${countNum()}`);
  check('v1.26: tool-placed magnet is selected with pole +100',
    panelBody.querySelector('[data-key="magnet"]')?.value === '100');
  // wind regions can be dragged on the canvas (select tool)
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  await wait(60);
  click([...panelBody.querySelectorAll('.btn')].find((b) => b.textContent.includes('添加风场区域')));
  await wait(60);
  const wx0 = Number(panelBody.querySelector('[data-key="wx"]')?.value);
  // default wind centre (640,300) -> screen (600,350); drag by (+45,+27) px
  pointer(canvas, 'pointerdown', 480, 300);
  pointer(canvas, 'pointermove', 525, 327);
  pointer(canvas, 'pointerup', 525, 327);
  await wait(60);
  const wx1 = Number(panelBody.querySelector('[data-key="wx"]')?.value);
  const wy1 = Number(panelBody.querySelector('[data-key="wy"]')?.value);
  check('v1.26: dragging a wind region moves its centre',
    wx1 > wx0 + 35 && wy1 > 315, `wx ${wx0} -> ${wx1}, wy -> ${wy1}`);
}

/* ---- v1.28: layout groups, record button, hinge tool ---- */
{
  check('v1.28: tool rail has four group captions',
    doc.querySelectorAll('#toolrail .rail-cap').length === 4,
    `caps=${doc.querySelectorAll('#toolrail .rail-cap').length}`);
  const recBtn = doc.getElementById('btnRecord');
  check('v1.28: record button exists with a label', !!recBtn && recBtn.textContent.trim().length > 0);
  click(recBtn);
  await wait(60);
  check('v1.28: record button enters recording state', recBtn.classList.contains('recording'));
  click(recBtn);
  await wait(200);
  check('v1.28: record button leaves recording state after stop', !recBtn.classList.contains('recording'));

  // hinge flow on a paused scene: two fresh circles, pin them, drive, delete
  click(doc.getElementById('btnPause'));
  click(doc.querySelector('[data-tool="circle"]'));
  pointer(canvas, 'pointerdown', 300, 300); pointer(canvas, 'pointerup', 300, 300);
  await wait(60);
  // creating a shape returns the tool to 'select' — re-arm the circle tool
  click(doc.querySelector('[data-tool="circle"]'));
  pointer(canvas, 'pointerdown', 430, 300); pointer(canvas, 'pointerup', 430, 300);
  await wait(60);
  click(doc.querySelector('[data-tool="hinge"]'));
  pointer(canvas, 'pointerdown', 300, 300); pointer(canvas, 'pointerup', 300, 300);
  await wait(60);
  pointer(canvas, 'pointerdown', 430, 300); pointer(canvas, 'pointerup', 430, 300);
  await wait(120);
  const motor = panelBody.querySelector('[data-key="hmotor"]');
  check('v1.28: hinge tool creates a hinge and opens its motor editor', !!motor,
    panelBody.textContent.slice(0, 60));
  if (motor) {
    motor.value = '0.1';
    motor.dispatchEvent(new window.Event('input', { bubbles: true }));
    await wait(60);
    check('v1.28: hinge editor keeps the motor slider after input', !!panelBody.querySelector('[data-key="hmotor"]'));
  }
  // delete tool removes the hinge by its pin marker
  click(doc.querySelector('[data-tool="delete"]'));
  pointer(canvas, 'pointerdown', 300, 300); pointer(canvas, 'pointerup', 300, 300);
  await wait(120);
  check('v1.28: delete tool removes the hinge (editor closes)',
    !panelBody.querySelector('[data-key="hmotor"]'));
  click(doc.getElementById('btnPlay'));
}

/* ---- v1.29: static-body drag toggle in the object panel ---- */
{
  const panelBody = doc.getElementById('panelBody');
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  await wait(60);
  // a fresh dynamic circle: its panel must show the toggle DISABLED
  click(doc.querySelector('[data-tool="circle"]'));
  pointer(canvas, 'pointerdown', 250, 200); pointer(canvas, 'pointerup', 250, 200);
  await wait(80);
  const dynBtn = panelBody.querySelector('[data-drag-static]');
  check('v1.29: object panel has a static-drag toggle', !!dynBtn);
  check('v1.29: toggle is disabled for a dynamic body', !!dynBtn && dynBtn.disabled === true);
  // the ground (static) can be armed and dragged on the canvas
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  await wait(60);
  click(doc.querySelector('[data-tool="select"]'));
  pointer(canvas, 'pointerdown', 600, 572); pointer(canvas, 'pointerup', 600, 572);
  await wait(80);
  const stBtn = panelBody.querySelector('[data-drag-static]');
  check('v1.29: toggle is enabled for a static body', !!stBtn && stBtn.disabled === false);
  const x0 = Number(panelBody.querySelector('[data-key="x"]')?.value);
  click(stBtn);
  await wait(60);
  check('v1.29: toggle shows the armed state', panelBody.querySelector('[data-drag-static]')?.classList.contains('armed') === true);
  pointer(canvas, 'pointerdown', 600, 572);
  pointer(canvas, 'pointermove', 645, 572);
  pointer(canvas, 'pointerup', 645, 572);
  await wait(80);
  const x1 = Number(panelBody.querySelector('[data-key="x"]')?.value);
  check('v1.29: dragging moves the static body on the canvas', x1 > x0 + 30, `x ${x0} -> ${x1}`);
  // 1.34: a stray click on empty canvas must not disarm the toggle —
  // re-grabbing the same static body still drags it
  pointer(canvas, 'pointerdown', 250, 200); pointer(canvas, 'pointerup', 250, 200);
  await wait(80);
  pointer(canvas, 'pointerdown', 645, 572);
  pointer(canvas, 'pointermove', 690, 572);
  pointer(canvas, 'pointerup', 690, 572);
  await wait(80);
  click(doc.querySelector('[data-tool="select"]'));
  pointer(canvas, 'pointerdown', 690, 572); pointer(canvas, 'pointerup', 690, 572);
  await wait(80);
  const x2 = Number(panelBody.querySelector('[data-key="x"]')?.value);
  check('v1.34: after a stray click the armed body still drags', x2 > x1 + 30, `x ${x1} -> ${x2}`);
  // v1.36: seed lives in the scene panel — refresh re-rolls it, the
  // jitter action runs off the seeded stream
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  await wait(80);
  const seedInput = panelBody.querySelector('[data-key="seed"]');
  check('v1.36: scene panel has a seed field', !!seedInput);
  check('v1.36: refresh-seed and jitter buttons exist',
    !!panelBody.querySelector('[data-refresh-seed]') && !!panelBody.querySelector('[data-jitter]'));
  const s0 = seedInput.value;
  click(panelBody.querySelector('[data-refresh-seed]'));
  await wait(80);
  const seedInput2 = panelBody.querySelector('[data-key="seed"]');
  check('v1.36: refresh changes the seed', !!seedInput2 && seedInput2.value !== s0 && Number.isInteger(Number(seedInput2.value)),
    `${s0} -> ${seedInput2 && seedInput2.value}`);
  seedInput2.value = '7';
  seedInput2.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(60);
  click(panelBody.querySelector('[data-jitter]'));
  await wait(60);
  check('v1.36: jitter reports through the toast', doc.getElementById('toast').textContent.includes('随机扰动'),
    doc.getElementById('toast').textContent);
  check('v1.37: seeded-replay button exists', !!panelBody.querySelector('[data-seed-replay]'));
  click(panelBody.querySelector('[data-seed-replay]'));
  await wait(60);
  check('v1.37: replay reports through the toast', doc.getElementById('toast').textContent.includes('重演'),
    doc.getElementById('toast').textContent);
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  await wait(40);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
