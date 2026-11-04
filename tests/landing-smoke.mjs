/* MotionLab landing smoke — run: node tests/landing-smoke.mjs
   First boot (no visited flag) must show the landing page; starting writes
   the flag; a return boot must open the app directly. */
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire('/home/hatch/workspace/webos/package.json');
const localRequire = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`FAIL  ${name} ${extra}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(presetVisited, bust, lang) {
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
  if (presetVisited) window.localStorage.setItem('motionlab.visited.v1', '1');
  if (lang) window.localStorage.setItem('motionlab.lang', lang);
  for (const k of ['document', 'localStorage']) globalThis[k] = window[k];
  globalThis.window = window;
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.confirm = window.confirm; globalThis.prompt = window.prompt;
  await import(`../js/app.js?case=${bust}`);
  await wait(250);
  return window;
}

const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

/* --- first visit --- */
const w1 = await boot(false, 'first', 'zh');
const d1 = w1.document;
check('first visit: landing is shown', !d1.getElementById('landing').hidden);
check('landing: demo canvas + start button present', !!d1.getElementById('landingCanvas') && !!d1.getElementById('btnStartLab'));
check('landing: sixteen preset shortcuts', d1.querySelectorAll('#landingPresets .chip').length === 16,
  `got ${d1.querySelectorAll('#landingPresets .chip').length}`);
click(w1, d1.querySelectorAll('#landingPresets .chip')[0]); // Newton's cradle
await wait(500);
check('preset shortcut: landing hides', d1.getElementById('landing').hidden);
check('preset shortcut: visited flag written', w1.localStorage.getItem('motionlab.visited.v1') === '1');
check('preset shortcut: cradle loaded (9 bodies)', d1.getElementById('stCount').textContent.includes('9'),
  d1.getElementById('stCount').textContent);
check('preset shortcut: simulation running', d1.getElementById('stState').textContent.includes('运行中'));

/* --- return visit --- */
const w2 = await boot(true, 'return', 'zh');
check('return visit: landing stays hidden', w2.document.getElementById('landing').hidden);
check('return visit: app booted with 9 bodies', w2.document.getElementById('stCount').textContent.includes('9'));
check('return visit: home hub is the first screen', !w2.document.getElementById('sceneNav').hidden);

/* --- first visit: 开始使用 goes landing -> home --- */
const w3 = await boot(false, 'start', 'zh');
const d3 = w3.document;
check('start flow: landing shown first', !d3.getElementById('landing').hidden && d3.getElementById('sceneNav').hidden);
click(w3, d3.getElementById('btnStartLab'));
await wait(120);
check('start flow: landing hides, home hub opens',
  d3.getElementById('landing').hidden && !d3.getElementById('sceneNav').hidden);
click(w3, d3.getElementById('btnCloseNav'));
await wait(60);
check('start flow: 进入实验室 reaches the lab', d3.getElementById('sceneNav').hidden);

/* --- v1.24: first visit with NO stored language defaults to English,
       and the landing picker guides (and performs) the choice --- */
const w4 = await boot(false, 'langfirst');
const d4 = w4.document;
check('v1.24: first visit defaults to English (headline + CTA + html lang)',
  d4.querySelector('#landing h1').textContent.includes('Real physics experiments')
  && d4.getElementById('btnStartLab').textContent === 'Get Started'
  && d4.documentElement.lang === 'en',
  d4.querySelector('#landing h1').textContent);
check('v1.24: language picker present with English active',
  !!d4.getElementById('btnLangEn') && d4.getElementById('btnLangEn').classList.contains('active')
  && !!d4.getElementById('btnLangZh') && !d4.getElementById('btnLangZh').classList.contains('active'));
check('v1.24: preset shortcuts are English on a first visit',
  d4.querySelector('#landingPresets .chip').textContent === "Newton's Cradle",
  d4.querySelector('#landingPresets .chip').textContent);
click(w4, d4.getElementById('btnLangZh'));
await wait(80);
check('v1.24: picking Chinese re-renders the landing and persists',
  d4.querySelector('#landing h1').textContent.includes('做真实的物理实验')
  && w4.localStorage.getItem('motionlab.lang') === 'zh'
  && d4.getElementById('btnLangZh').classList.contains('active')
  && d4.querySelector('#landingPresets .chip').textContent === '牛顿摆',
  d4.querySelector('#landing h1').textContent);
click(w4, d4.getElementById('btnLangEn'));
await wait(80);
check('v1.24: picking English again flips back',
  d4.querySelector('#landing h1').textContent.includes('Real physics experiments')
  && w4.localStorage.getItem('motionlab.lang') === 'en');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
