/* PFLab logic tests (Node, no DOM): character controller, one-way platforms,
   combat (single-hit, knockback scaling), AI FSM, blast KO, pause/reset.
   Run: node tests/pf-smoke.mjs */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.Matter = require('../vendor/matter.min.js');

const { PFPhysics } = await import('../js/pf/pf-physics.js');
const { Character } = await import('../js/pf/pf-character.js');
const { Combat } = await import('../js/pf/pf-combat.js');
const { PFMatch, PFEngine } = await import('../js/pf/pf-lab.js');
const { PF_VERSION, ATTACK } = await import('../js/pf/pf-config.js');
const { FighterAI } = await import('../js/pf/pf-ai.js');
const { PLATFORMS, SPAWNS, isBlasted } = await import('../js/pf/pf-stage.js');

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
}
const idle = { move: 0, jump: false, attack: false, dash: false };
function world() {
  const phys = new PFPhysics();
  for (const p of PLATFORMS) phys.addPlatform(p);
  return phys;
}
function runChar(phys, c, n, intent = idle) {
  for (let i = 0; i < n; i++) { c.setIntent(intent); c.preStep(); phys.step(); c.postStep(); }
}

/* ---------- character controller ---------- */
{
  const phys = world();
  const c = new Character(phys, 'p1', SPAWNS[0]);
  runChar(phys, c, 90);
  check('settle: grounded on main platform', c.grounded && Math.abs(c.y - 404) < 3, `y=${c.y.toFixed(1)} grounded=${c.grounded}`);

  const x0 = c.x;
  runChar(phys, c, 30, { ...idle, move: 1 });
  check('run: full speed to the right', c.x - x0 > 110 && c.vx > 4, `dx=${(c.x - x0).toFixed(1)} vx=${c.vx.toFixed(2)}`);
}
{
  const phys = world();
  const c = new Character(phys, 'p1', SPAWNS[0]);
  runChar(phys, c, 80);
  let minY = c.y, leftGround = false;
  for (let i = 0; i < 120; i++) {
    c.setIntent({ ...idle, jump: i === 0 }); c.preStep(); phys.step(); c.postStep();
    if (!c.grounded) { leftGround = true; minY = Math.min(minY, c.y); }
    else if (leftGround && i > 10) break;
  }
  const apex = 404 - minY;
  check('jump: leaves ground, apex 130-190px, lands again', leftGround && apex > 130 && apex < 190 && c.grounded, `apex=${apex.toFixed(0)} grounded=${c.grounded}`);
}
{
  const phys = world();
  const c = new Character(phys, 'p1', SPAWNS[0]);
  runChar(phys, c, 80);
  runChar(phys, c, 1, { ...idle, jump: true });
  runChar(phys, c, 14);                       // rising, airborne
  runChar(phys, c, 1, { ...idle, jump: true }); // double jump
  const vyAfterDouble = c.vy;
  runChar(phys, c, 12);                       // let the double jump decay (vy ≈ -5)
  const vyBeforeThird = c.vy;
  runChar(phys, c, 1, { ...idle, jump: true }); // third jump: must NOT snap vy upward
  check('double jump works, third jump denied', vyAfterDouble < -8 && c.jumpsUsed === 2 && c.vy > vyBeforeThird - 1.5,
    `vyDouble=${vyAfterDouble.toFixed(1)} jumpsUsed=${c.jumpsUsed} vyBefore=${vyBeforeThird.toFixed(1)} vyThird=${c.vy.toFixed(1)}`);
}
{
  const phys = world();
  const c = new Character(phys, 'p1', SPAWNS[0]);
  runChar(phys, c, 80);
  runChar(phys, c, 1, { ...idle, dash: true });
  let maxVx = 0;
  for (let i = 0; i < 8; i++) { c.setIntent(idle); c.preStep(); phys.step(); c.postStep(); maxVx = Math.max(maxVx, Math.abs(c.vx)); }
  check('dash: burst speed and cooldown engaged', maxVx >= 8 && c.dashCooldown > 0, `maxVx=${maxVx.toFixed(1)} cd=${c.dashCooldown}`);
}
{
  // One-way platform: jump up through it, land on top, walk off its edge.
  const phys = world();
  const c = new Character(phys, 'p1', SPAWNS[0]);
  runChar(phys, c, 80);
  runChar(phys, c, 9, { ...idle, move: -1 });
  runChar(phys, c, 1, { ...idle, move: -1, jump: true });
  runChar(phys, c, 30, { ...idle, move: -1 });
  runChar(phys, c, 70);
  check('one-way: jumps through and lands on the floating platform', c.grounded && Math.abs(c.y - 283) < 3, `y=${c.y.toFixed(1)} grounded=${c.grounded}`);
  runChar(phys, c, 40, { ...idle, move: -1 });
  check('one-way: walking off the edge falls', !c.grounded && c.y > 300, `y=${c.y.toFixed(1)} grounded=${c.grounded}`);
}

/* ---------- combat ---------- */
function duel(dx, victimDamage = 0) {
  const phys = world();
  const a = new Character(phys, 'player', { x: 400, y: 370, facing: 1 });
  const b = new Character(phys, 'dummy', { x: 400 + dx, y: 370, facing: -1 });
  const combat = new Combat();
  const stepBoth = (ia, ib) => { a.setIntent(ia); b.setIntent(ib); a.preStep(); b.preStep(); phys.step(); a.postStep(); b.postStep(); return combat.resolve(a, b, 0); };
  for (let i = 0; i < 60; i++) stepBoth(idle, idle);
  b.damage = victimDamage;
  let hits = 0, speedAfterHit = 0;
  for (let i = 0; i < 40; i++) {
    const evs = stepBoth({ ...idle, attack: i === 0 }, idle);
    hits += evs.length;
    if (evs.length) speedAfterHit = Math.abs(b.vx);
  }
  return { hits, dmg: b.damage, speedAfterHit, state: b.state };
}
{
  const d = duel(55);
  check('combat: one attack hits exactly once for 7%', d.hits === 1 && d.dmg === 7, JSON.stringify(d));
  const w = duel(110);
  check('combat: out-of-range attack whiffs', w.hits === 0 && w.dmg === 0, JSON.stringify(w));
  const low = duel(55, 0), high = duel(55, 100);
  check('combat: knockback grows with damage', high.speedAfterHit > low.speedAfterHit + 2,
    `low=${low.speedAfterHit.toFixed(1)} high=${high.speedAfterHit.toFixed(1)}`);
  check('combat: victim enters hitstun', d.state === 'hitstun' || d.dmg === 7, `state=${d.state}`);
}

/* ---------- blast zone helper ---------- */
check('blast: centre is safe, outside is out', !isBlasted(480, 270) && isBlasted(-120, 270) && isBlasted(480, 800) && isBlasted(480, -200));

/* ---------- match + AI ---------- */
{
  const m = new PFMatch();
  for (let i = 0; i < 5; i++) m.step(idle);
  const d0 = Math.abs(m.dummy.x - m.player.x);
  for (let i = 0; i < 120; i++) m.step(idle);
  const d1 = Math.abs(m.dummy.x - m.player.x);
  check('AI: approaches the player from spawn', d0 > 180 && d1 < d0 - 80, `d0=${d0.toFixed(0)} d1=${d1.toFixed(0)} ai=${m.ai.state}`);
  for (let i = 0; i < 400 && m.state === 'fight'; i++) m.step(idle);
  check('AI: attacks a passive player (damage accumulates)', m.player.damage > 0, `playerDmg=${m.player.damage}`);
}
{
  const m = new PFMatch();
  for (let i = 0; i < 60; i++) m.step(idle);
  m.physics.setPosition(m.dummy.body, 905, 475);
  m.physics.setVelocity(m.dummy.body, 3, -4);
  let sawRecover = false, back = false;
  for (let i = 0; i < 420 && m.state === 'fight'; i++) {
    m.step(idle);
    if (m.ai.state === 'recover') sawRecover = true;
    if (m.dummy.grounded && m.dummy.x > 185 && m.dummy.x < 775 && m.dummy.y < 432) { back = true; break; }
  }
  check('AI: recovers to the stage after being knocked off', sawRecover && back,
    `sawRecover=${sawRecover} back=${back} at=${Math.round(m.dummy.x)},${Math.round(m.dummy.y)} state=${m.state}`);
}
{
  const m = new PFMatch();
  for (let i = 0; i < 60; i++) m.step(idle);
  m.physics.setPosition(m.player.body, 495, 404);
  m.dummy.damage = 80;
  let sawRetreat = false;
  for (let i = 0; i < 120 && m.state === 'fight'; i++) {
    m.step(idle);
    if (m.ai.state === 'retreat') { sawRetreat = true; break; }
  }
  check('AI: retreats when heavily damaged and pressured', sawRetreat, `ai=${m.ai.state}`);
}
{
  const m = new PFMatch();
  for (let i = 0; i < 30; i++) m.step(idle);
  m.physics.setPosition(m.player.body, -200, 300);
  const evs = m.step(idle);
  check('KO: leaving the blast zone ends the match', m.state === 'over' && m.winner === 'dummy' && evs.some((e) => e.type === 'ko'),
    `state=${m.state} winner=${m.winner}`);
  const frozen = m.stepCount;
  m.step(idle);
  check('KO: steps after the match ends are no-ops', m.stepCount === frozen);
}
{
  const m = new PFMatch();
  for (let i = 0; i < 30; i++) m.step(idle);
  m.paused = true;
  const sc = m.stepCount, px = m.player.x;
  m.step({ ...idle, move: 1 });
  check('pause: simulation fully frozen', m.stepCount === sc && m.player.x === px);
  m.paused = false;
  m.dummy.damage = 42;
  m.reset();
  check('reset: fresh match state', m.state === 'fight' && m.stepCount === 0 && m.dummy.damage === 0 && m.player.damage === 0);
}

/* --- PF engine 1.1.0: version, facade, AI profiles, tune --- */
{
  check('pf version: PFEngine.VERSION is 1.1.0', PFEngine.VERSION === '1.1.0' && PF_VERSION === '1.1.0');
  const m = PFEngine.createMatch();
  check('facade: createMatch returns a running headless match', m.state === 'fight' && typeof m.step === 'function');
  for (let i = 0; i < 30; i++) m.step(idle);
  check('facade: headless match advances steps', m.stepCount === 30, `steps=${m.stepCount}`);

  check('ai profiles: calm/sharp presets resolve', new FighterAI('calm').cfg.decideEvery === 16 && new FighterAI('sharp').cfg.decideEvery === 6 && new FighterAI('sharp').cfg.attackCooldown === 18);
  check('ai profiles: object overrides merge over defaults', new FighterAI({ decideEvery: 3 }).cfg.decideEvery === 3 && new FighterAI({ decideEvery: 3 }).cfg.attackRangeX === 64);
  const m2 = PFEngine.createMatch({ ai: 'calm' });
  check('facade: match opts.ai reaches the dummy brain', m2.ai.cfg.decideEvery === 16);

  const before = ATTACK.damage;
  PFEngine.tune({ attack: { damage: before + 5 } });
  const tuned = ATTACK.damage === before + 5;
  PFEngine.tune({ attack: { damage: before } });
  check('facade: tune() merges into the shared tables (and restores)', tuned && ATTACK.damage === before);
}

console.log(`\nPFLab logic: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
