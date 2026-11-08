/* MotionLab console (1.61) — a READ-ONLY window into the running
   world: an event log (impacts, sleep/wake, emitter spawns, app
   system lines) plus live solver readouts. The Impulse backend
   exposes counters no external engine can offer (wake-touch gate
   firings, pre-wake firings, sleep/wake tallies) via the 1.13.0
   observability surface (world.stats / world.onEvent); on the
   Matter backend those readouts show — and the log carries the
   app-level lines only.
 *
 * ConsoleLog is the DOM-free model (unit-tested); mountLabConsole
 * builds the drawer UI and the event-batching intake. Engine
 * events can arrive dozens of times per second (a pile falling
 * asleep), so sleep/wake/spawn events are batched over a short
 * window and summarized; impacts are already strongest-only per
 * substep from the engine and are capped per flush. */

export class ConsoleLog {
  constructor(cap = 300) {
    this.cap = Math.max(1, cap | 0);
    this.lines = [];
    this.seq = 0;
  }

  push(cat, text, step = null) {
    const line = { n: ++this.seq, cat, text, step };
    this.lines.push(line);
    if (this.lines.length > this.cap) this.lines.splice(0, this.lines.length - this.cap);
    return line;
  }

  clear() { this.lines = []; }

  view(filter = 'all') {
    return filter === 'all' ? this.lines : this.lines.filter((l) => l.cat === filter);
  }
}

const CATEGORIES = [
  ['all', 'console.filterAll'],
  ['impact', 'console.filterImpact'],
  ['sleep', 'console.filterSleep'],
  ['spawn', 'console.filterSpawn'],
  ['system', 'console.filterSystem'],
];

const STAT_FIELDS = [
  ['fps', 'console.statFps', () => null], // filled from deps.getFps
  ['steps', 'console.statSteps', (s) => s.steps],
  ['bodies', 'console.statBodies', (s) => s.bodies],
  ['sleeping', 'console.statSleeping', (s) => s.sleeping],
  ['contacts', 'console.statContacts', (s) => s.contacts],
  ['gateFirings', 'console.statGate', (s) => s.gateFirings],
  ['preWakeFirings', 'console.statPreWake', (s) => s.preWakeFirings],
  ['wakes', 'console.statWakes', (s) => s.wakes],
  ['sleeps', 'console.statSleeps', (s) => s.sleeps],
  ['spawns', 'console.statSpawns', (s) => s.spawns],
];

/** Mount the console drawer into `section` (an element with the
 *  static skeleton from index.html). deps: { world(): PhysicsWorld,
 *  getFps(): string, t(key, params?): string } */
export function mountLabConsole(section, deps) {
  const { t } = deps;
  const log = new ConsoleLog(300);
  let filter = 'all';
  let open = false;
  let dirty = true;
  let statsTimer = null;
  let flushTimer = null;

  const logEl = section.querySelector('#consoleLog');
  const statsEl = section.querySelector('#consoleStats');
  const chipsEl = section.querySelector('#consoleChips');

  // --- filter chips ---
  const chipBtns = new Map();
  for (const [cat, key] of CATEGORIES) {
    const b = document.createElement('button');
    b.className = 'console-chip' + (cat === filter ? ' active' : '');
    b.textContent = t(key);
    b.addEventListener('click', () => {
      filter = cat;
      for (const [c, btn] of chipBtns) btn.classList.toggle('active', c === cat);
      dirty = true;
      render();
    });
    chipsEl.appendChild(b);
    chipBtns.set(cat, b);
  }

  // --- stats row ---
  const statVals = new Map();
  for (const [field, key] of STAT_FIELDS) {
    const wrap = document.createElement('span');
    wrap.className = 'console-stat';
    const lab = document.createElement('span');
    lab.className = 'console-stat-label';
    lab.textContent = t(key);
    const val = document.createElement('strong');
    val.textContent = '—';
    wrap.appendChild(lab);
    wrap.appendChild(val);
    statsEl.appendChild(wrap);
    statVals.set(field, val);
  }

  function render() {
    if (!open) return;
    const lines = log.view(filter);
    logEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const l of lines) {
      const div = document.createElement('div');
      div.className = 'console-line cat-' + l.cat;
      const step = document.createElement('span');
      step.className = 'console-step';
      step.textContent = l.step === null ? '' : '#' + l.step;
      div.appendChild(step);
      div.appendChild(document.createTextNode(l.text));
      frag.appendChild(div);
    }
    logEl.appendChild(frag);
    logEl.scrollTop = logEl.scrollHeight;
    dirty = false;
  }

  function refreshStats() {
    if (!open) return;
    let s = null;
    try { s = deps.world().stats; } catch { s = null; }
    for (const [field, , pick] of STAT_FIELDS) {
      const el = statVals.get(field);
      if (!el) continue;
      if (field === 'fps') { el.textContent = deps.getFps() || '—'; continue; }
      const v = s ? pick(s) : null;
      el.textContent = v === null || v === undefined ? '—' : String(v);
    }
  }

  // --- batched engine-event intake ---
  const pending = { sleep: [], wake: [], spawn: [], impact: [] };
  function flush() {
    let changed = false;
    const take = (arr, n) => arr.splice(0, Math.min(n, arr.length));
    for (const ev of take(pending.impact, 3)) {
      log.push('impact', t('console.msgImpact', { a: ev.a || '?', b: ev.b || '?', v: ev.speed.toFixed(1) }), ev.step);
      changed = true;
    }
    if (pending.impact.length) {
      log.push('impact', t('console.msgMoreImpacts', { n: pending.impact.length }));
      pending.impact.length = 0;
      changed = true;
    }
    if (pending.sleep.length) {
      const items = pending.sleep.splice(0);
      if (items.length === 1) log.push('sleep', t('console.msgSleptOne', { label: items[0].label || items[0].id }), items[0].step);
      else log.push('sleep', t('console.msgSleptMany', { n: items.length, label: items[0].label || items[0].id }), items[items.length - 1].step);
      changed = true;
    }
    if (pending.wake.length) {
      const items = pending.wake.splice(0);
      if (items.length === 1) log.push('sleep', t('console.msgWokeOne', { label: items[0].label || items[0].id }), items[0].step);
      else log.push('sleep', t('console.msgWokeMany', { n: items.length, label: items[0].label || items[0].id }), items[items.length - 1].step);
      changed = true;
    }
    if (pending.spawn.length) {
      const items = pending.spawn.splice(0);
      log.push('spawn', t('console.msgSpawned', { n: items.length }), items[items.length - 1].step);
      changed = true;
    }
    if (changed) { dirty = true; render(); }
  }

  function ingest(ev) {
    if (!ev || typeof ev.type !== 'string') return;
    const arr = pending[ev.type];
    if (!arr) return;
    arr.push(ev);
    if (arr.length > 300) arr.splice(0, arr.length - 300); // bound memory between flushes
  }

  function sys(text) {
    log.push('system', text);
    dirty = true;
    render();
  }

  function setOpen(v) {
    open = !!v;
    section.hidden = !open;
    try { localStorage.setItem('motionlab.console.v1', JSON.stringify({ open })); } catch { /* storage unavailable */ }
    if (open) {
      render();
      refreshStats();
      if (!statsTimer) statsTimer = setInterval(refreshStats, 500);
    } else if (statsTimer) {
      clearInterval(statsTimer);
      statsTimer = null;
    }
  }

  // The flush runs from mount (not only while open) so the log
  // history is already there when the drawer is first opened.
  flushTimer = setInterval(flush, 300);

  section.querySelector('#consoleClear').addEventListener('click', () => { log.clear(); dirty = true; render(); });
  section.querySelector('#consoleClose').addEventListener('click', () => setOpen(false));

  let initialOpen = false;
  try { initialOpen = JSON.parse(localStorage.getItem('motionlab.console.v1') || '{}').open === true; } catch { initialOpen = false; }

  return {
    log,
    ingest,
    sys,
    setOpen,
    toggle: () => setOpen(!open),
    isOpen: () => open,
    initialOpen,
    render: () => { dirty = true; render(); },
  };
}
