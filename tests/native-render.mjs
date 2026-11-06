/* Native-backend RENDER regression suite (added 1.42).
   Why this exists: 1.41 shipped with native circle bodies exposing
   vertices = []; the app renderer opens every body's path at
   vertices[0], threw on the first circle, and the live canvas showed
   only the grid while physics ran fine. The engine suite never saw it
   (it never renders) and the app smoke suite never ran the renderer
   under the native backend. This suite boots the REAL app with the
   native backend preselected, loads the Galton preset, and asserts
   the renderer actually draws bodies without a single window error.
   Run: node tests/native-render.mjs */
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire('/home/hatch/workspace/webos/package.json');
const localRequire = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  .replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;

const calls = new Map();
const errors = [];
window.addEventListener('error', (e) => errors.push(String((e.error && e.error.message) || e.message)));
const fakeCtx = new Proxy({}, {
  get(t, p) {
    if (p in t) return t[p];
    return () => { calls.set(p, (calls.get(p) || 0) + 1); };
  },
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
window.localStorage.setItem('motionlab.lang', 'zh');
window.localStorage.setItem('motionlab.backend', 'native'); // boot straight into the native backend

for (const k of ['document', 'localStorage']) globalThis[k] = window[k];
globalThis.window = window;
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.confirm = window.confirm; globalThis.prompt = window.prompt;

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const doc = window.document;
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

await import('../js/app.js');
await wait(400);
check('boot under native: no window errors', errors.length === 0, errors[0] || '');
check('boot under native: cradle scene present', doc.getElementById('stCount').textContent.includes('9'),
  doc.getElementById('stCount').textContent);

click(doc.getElementById('btnStartLab'));
await wait(600);
const card = [...doc.querySelectorAll('#presetList .preset-card')].find((c) => c.textContent.includes('钉板'));
check('galton preset card found', !!card);
calls.clear(); errors.length = 0;
click(card.querySelector('.mini-btn'));
await wait(2500);
check('galton loaded under native: 68 bodies', doc.getElementById('stCount').textContent.includes('68'),
  doc.getElementById('stCount').textContent);
check('renderer drew body paths (lineTo storm)', (calls.get('lineTo') || 0) > 1000,
  `lineTo=${calls.get('lineTo') || 0}`);
check('renderer filled bodies', (calls.get('fill') || 0) > 500, `fill=${calls.get('fill') || 0}`);
check('no window errors while rendering native galton', errors.length === 0, errors[0] || '');

console.log(`\nNative render tests: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
