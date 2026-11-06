/* MotionLab memory soak test (1.39) — run: node --expose-gc tests/soak.mjs
   Boots the real app in jsdom and churns it the way a long classroom
   session would: load a dense preset, run it, add a body, undo/redo,
   switch scenes, repeat. The leak question is answered with counts,
   not impressions: after every cycle the world must return to exactly
   the same body counts, and the DOM node count / localStorage size /
   JS heap (after GC) must not trend upward. A bounded spike (e.g. the
   GIF recorder's frames) is not a leak; a rising floor is. */
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
window.localStorage.setItem('motionlab.lang', 'zh');

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

const bodyCount = () => {
  const m = /(\d+)/.exec(doc.getElementById('stCount').textContent);
  return m ? Number(m[1]) : -1;
};
const domNodes = () => doc.getElementsByTagName('*').length;
const storageKB = () => {
  let n = 0;
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    n += k.length + (window.localStorage.getItem(k) || '').length;
  }
  return n / 1024;
};
const heapMB = () => {
  if (typeof globalThis.gc === 'function') globalThis.gc();
  return process.memoryUsage().heapUsed / 1048576;
};
const presetCard = (needle) => [...doc.querySelectorAll('#presetList .preset-card')]
  .find((c) => c.textContent.includes(needle));
const loadPreset = async (needle) => {
  click(presetCard(needle).querySelector('.mini-btn'));
  await wait(500); // load + status-bar refresh interval
};

await import('../js/app.js');
await wait(400);
click(doc.getElementById('btnStartLab')); // landing -> hub renders the preset cards
await wait(600);
check('boot: default scene has 9 bodies', bodyCount() === 9, `got ${bodyCount()}`);
check('soak: galton + cradle preset cards exist', !!presetCard('钉板') && !!presetCard('牛顿摆'));

const canvas = doc.getElementById('world');
const ROUNDS = 8;
const galtonCounts = [];
const cradleCounts = [];
const samples = [];

for (let r = 1; r <= ROUNDS; r++) {
  await loadPreset('钉板'); // Galton board: 60+ bodies, auto-runs
  galtonCounts.push(bodyCount());
  click(doc.getElementById('btnPause'));
  await wait(80);

  // edit churn: add a body, then undo / redo / undo through the history stack
  click(doc.querySelector('[data-tool="circle"]'));
  pointer(canvas, 'pointerdown', 620, 330);
  pointer(canvas, 'pointerup', 620, 330);
  await wait(500);
  const afterAdd = bodyCount();
  click(doc.getElementById('btnUndo'));
  await wait(450);
  const afterUndo = bodyCount();
  click(doc.getElementById('btnRedo'));
  await wait(450);
  click(doc.getElementById('btnUndo'));
  await wait(450);
  if (r === 1) {
    check('soak: add-body raises the count by 1', afterAdd === galtonCounts[0] + 1, `${galtonCounts[0]} -> ${afterAdd}`);
    check('soak: undo restores the preset count', afterUndo === galtonCounts[0], `got ${afterUndo}`);
  }
  check(`soak r${r}: undo/redo churn returns to the galton count`, bodyCount() === galtonCounts[0], `got ${bodyCount()}`);

  await loadPreset('牛顿摆');
  cradleCounts.push(bodyCount());
  click(doc.getElementById('btnPause'));
  await wait(80);

  if (r === 2 || r === ROUNDS) {
    samples.push({ round: r, dom: domNodes(), kb: storageKB(), heap: heapMB() });
    console.log(`  ..  round ${r}: dom=${samples[samples.length - 1].dom} storage=${samples[samples.length - 1].kb.toFixed(1)}KB heap=${samples[samples.length - 1].heap.toFixed(1)}MB`);
  }
}

check('soak: galton body count identical in all rounds', galtonCounts.every((n) => n === galtonCounts[0]), galtonCounts.join(','));
check('soak: cradle body count identical in all rounds', cradleCounts.every((n) => n === cradleCounts[0]), cradleCounts.join(','));
const [s0, s1] = samples;
check('soak: DOM nodes do not accumulate', s1.dom <= s0.dom * 1.03 + 10, `${s0.dom} -> ${s1.dom}`);
check('soak: localStorage size stays flat', s1.kb <= s0.kb + 4, `${s0.kb.toFixed(1)}KB -> ${s1.kb.toFixed(1)}KB`);
check('soak: heap floor does not rise materially (post-GC)', s1.heap <= s0.heap + 30, `${s0.heap.toFixed(1)}MB -> ${s1.heap.toFixed(1)}MB`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
