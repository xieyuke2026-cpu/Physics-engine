/* SpreadWater model tests — extracts the water-column flux model from
   examples/spread.html (between the SPREAD MODEL markers) and checks its
   invariants: barrier hold, exact volume conservation, levelling, and a
   full dam-breach drain. Run: node tests/spread-model.mjs */
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../examples/spread.html', import.meta.url), 'utf8');
const src = html.split('// == SPREAD MODEL START ==')[1].split('// == SPREAD MODEL END ==')[0];
const SpreadWater = new Function(`${src}; return SpreadWater;`)();

let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log(`  ok  ${n}`); } else { fail++; console.log(`FAIL  ${n} ${x}`); } };

const COLW = 8, COLS = 120, floorY = [];
for (let i = 0; i < COLS; i++) { const cx = i * COLW + COLW / 2; floorY.push(cx < 16 || cx >= 944 ? 300 : (i * COLW < 424 ? 430 : 560)); }
const w = new SpreadWater({ x0: 0, colW: COLW, count: COLS, floorY, datum: 600 });
for (let i = 0; i < COLS; i++) if (i * COLW >= 16 && i * COLW < 400) w.depth[i] = 90;
w.barriers.add(49);
const V0 = w.totalVolume();
for (let i = 0; i < 900; i++) w.step();
check('barrier holds: no water east of the dam', w.depth.slice(50).every((d) => d === 0));
check('volume conserved behind the dam', Math.abs(w.totalVolume() - V0) < 1e-6);
check('reservoir surface levelled (< 0.5px)', (() => { const s = []; for (let i = 2; i < 50; i++) if (w.depth[i] > 0) s.push(w.surfaceY(i)); return Math.max(...s) - Math.min(...s) < 0.5; })());
check('dry column reports no surface', w.surfaceYAt(700) === Infinity);
w.barriers.delete(49);
for (let i = 0; i < 2400; i++) w.step();
check('after breach: all water reaches the lowland', Math.abs(w.depth.slice(53).reduce((a, d) => a + d, 0) - V0 / COLW) < 1);
check('volume still conserved after breach', Math.abs(w.totalVolume() - V0) < 1e-6);
check('bench drains dry', w.depth.slice(0, 53).every((d) => d < 0.6));
check('lowland pool surface levelled (< 1px)', (() => { const s = []; for (let i = 53; i < COLS; i++) if (w.depth[i] > 0.05) s.push(w.surfaceY(i)); return s.length > 30 && Math.max(...s) - Math.min(...s) < 1.0; })());

console.log(`\nspread-model tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
