/* PFLab UI smoke test (jsdom): enter from hub and from the topbar, pause,
   restart, exit restores the previous screen, repeated enter/exit cycles.
   Run: node tests/pf-ui-smoke.mjs */
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

for (const k of ['document', 'localStorage']) globalThis[k] = window[k];
globalThis.window = window;
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.confirm = window.confirm; globalThis.prompt = window.prompt;

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
}
const $ = (id) => window.document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

window.localStorage.setItem('motionlab.visited.v1', '1');
try {
  await import('../js/app.js');
  await sleep(120);

  check('boot: hub visible, PFLab hidden', !$('sceneNav').hidden && $('pfLab').hidden);
  check('entry in the hub sidebar, topbar button gone', !!$('btnSidePF') && !$('btnPFLab') && !$('btnEnterPF'));

  // Enter from the sidebar button on the main interface (the hub).
  $('btnSidePF').click();
  await sleep(80);
  check('enter from sidebar: overlay visible, hub closed', !$('pfLab').hidden && $('sceneNav').hidden);
  check('debug panel populated', $('pfDbgPState').textContent !== '—' && $('pfDbgFps').textContent.includes('step'),
    `pstate=${$('pfDbgPState').textContent} fps=${$('pfDbgFps').textContent}`);

  // Pause toggles.
  $('btnPFPause').click();
  check('pause: button switches to resume', $('btnPFPause').textContent === '继续' && $('pfStatus').textContent === '已暂停');
  $('btnPFPause').click();
  check('resume: button switches back', $('btnPFPause').textContent === '暂停' && $('pfStatus').textContent === '对战中');

  // Restart keeps the overlay open with a fresh match.
  $('btnPFRestart').click();
  await sleep(30);
  check('restart: still in PFLab, result hidden', !$('pfLab').hidden && $('pfResult').hidden);

  // Exit returns to the main interface (the hub).
  $('btnPFBack').click();
  await sleep(30);
  check('exit: back at the hub', $('pfLab').hidden && !$('sceneNav').hidden);

  // Repeated enter/exit cycles must not accumulate errors or stuck state.
  let cyclesOk = true;
  for (let i = 0; i < 3; i++) {
    $('btnSidePF').click();
    await sleep(40);
    if ($('pfLab').hidden) cyclesOk = false;
    $('btnPFBack').click();
    await sleep(20);
    if (!$('pfLab').hidden || $('sceneNav').hidden) cyclesOk = false;
  }
  check('repeated enter/exit x3: clean', cyclesOk);

  // The update bar stays hidden when no newer version.json is reachable.
  check('update bar hidden by default', $('updateBar').hidden);
} catch (e) {
  fail++;
  console.log('FAIL  exception:', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e);
}
console.log(`\nPFLab UI smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
