/* MotionLab console (1.61) — a READ-ONLY window into the running
   world: an event log (impacts, sleep/wake, emitter spawns, app
   system lines) plus live solver readouts. The Impulse backend
   exposes counters no external engine can offer (wake-touch gate
   firings, pre-wake firings, sleep/wake tallies) via the 1.13.0
   observability surface (world.stats / world.onEvent); on the
   Matter backend those readouts show — and the log carries the
   app-level lines only.
 *
 * 1.63 (Ryan's field feedback): the drawer no longer restores its
 * open state (it "spread open by itself" and ate the lab view), all
 * timers and the engine-event subscription live only while it is
 * open (closed = zero cost), rendering is incremental (append-only
 * tail) instead of a full rebuild every flush, and stats refresh
 * at 1 Hz.
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
    this.gen = 0; // bumped by clear() so renderers can resync
  }

  push(cat, text, step = null) {
    const line = { n: ++this.seq, cat, text, step };
    this.lines.push(line);
    if (this.lines.length > this.cap) this.lines.splice(0, this.lines.length - this.cap);
    return line;
  }

  clear() { this.lines = []; this.gen++; }

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
 *  getFps(): string, t(key, params?): string,
 *  onToggle?(open): called after the drawer opens/closes so the app
 *  can subscribe/unsubscribe the engine event stream (1.63) } */
export function mountLabConsole(section, deps) {
  const { t } = deps;
  const log = new ConsoleLog(300);
  let filter = 'all';
  let open = false;
  let dirty = true;
  let renderedFilter = null;
  let renderedSeq = 0;
  let renderedGen = -1;
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

  function makeLine(l) {
    const div = document.createElement('div');
    div.className = 'console-line cat-' + l.cat;
    const step = document.createElement('span');
    step.className = 'console-step';
    step.textContent = l.step === null ? '' : '#' + l.step;
    div.appendChild(step);
    div.appendChild(document.createTextNode(l.text));
    return div;
  }

  const RENDER_CAP = 160;
  function render() {
    if (!open) return;
    const lines = log.view(filter);
    // Incremental append is safe: log pushes happen only inside
    // flush()/sys() (a handful per interval), so the last rendered
    // line can never be evicted from the 300-line model between
    // renders. Anything else (first render, filter change, clear)
    // falls back to a tail rebuild.
    const anchor = renderedSeq ? lines.findIndex((l) => l.n === renderedSeq) : -1;
    if (filter === renderedFilter && log.gen === renderedGen && anchor >= 0) {
      if (lines.length > anchor + 1) {
        const frag = document.createDocumentFragment();
        for (let i = anchor + 1; i < lines.length; i++) frag.appendChild(makeLine(lines[i]));
        logEl.appendChild(frag);
        while (logEl.childElementCount > RENDER_CAP) logEl.removeChild(logEl.firstChild);
        renderedSeq = lines[lines.length - 1].n;
      }
    } else {
      logEl.innerHTML = '';
      const tail = lines.slice(-RENDER_CAP);
      const frag = document.createDocumentFragment();
      for (const l of tail) frag.appendChild(makeLine(l));
      logEl.appendChild(frag);
      renderedSeq = tail.length ? tail[tail.length - 1].n : 0;
      renderedFilter = filter;
      renderedGen = log.gen;
    }
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
    if (open) {
      flush();
      render();
      refreshStats();
      if (!statsTimer) statsTimer = setInterval(refreshStats, 1000);
      if (!flushTimer) flushTimer = setInterval(flush, 500);
    } else {
      if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
      if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
    }
    if (deps.onToggle) { try { deps.onToggle(open); } catch { /* the app's binding must not break the drawer */ } }
  }

  // 1.63: no timers run while the drawer is closed (see setOpen).

  section.querySelector('#consoleClear').addEventListener('click', () => { log.clear(); dirty = true; render(); });
  section.querySelector('#consoleClose').addEventListener('click', () => setOpen(false));

  // 1.63: the drawer always starts closed — 1.61 persisted the open
  // state and restored it on every lab entry. Drop any stale key.
  try { localStorage.removeItem('motionlab.console.v1'); } catch { /* storage unavailable */ }

  return {
    log,
    ingest,
    sys,
    setOpen,
    toggle: () => setOpen(!open),
    isOpen: () => open,
    render: () => { dirty = true; render(); },
  };
}
