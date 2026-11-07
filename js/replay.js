/* =========================================================================
   MotionLab — deterministic replay (1.50), replacing GIF recording.

   A replay is NOT a video: it is the exact initial engine snapshot plus
   every user input stamped with the simulation step at which it happened.
   Because the engine runs a fixed timestep and its RNG is a seeded stream
   whose state rides snapshots, re-stepping the same snapshot with the
   same inputs at the same steps reproduces the run bit-for-bit on the
   same engine build. Playback verifies this itself: the recorder stores
   a hash of the final body states, and the player compares its own
   final hash and reports whether the reproduction was exact.

   File format "motionlab-replay" v1:
     { format, version, appVersion, backend, sceneName, createdAt,
       steps, initial: <engine snapshot>, events: [{step, type, ...}],
       finalHash }
   Event types: add | remove | addConstraint | removeConstraint |
     addHinge | removeHinge | hingeMotor | settings | regions |
     bodyProps | blast | dragStart | drag | dragEnd
   This module is DOM-free (format, validation, hashing) and unit-tested;
   the app owns recording hooks and the player transport.
   ========================================================================= */

export const REPLAY_FORMAT = 'motionlab-replay';
export const REPLAY_VERSION = 1;
export const MAX_REPLAY_STEPS = 60 * 180;      // 3 minutes of simulation
export const MAX_REPLAY_EVENTS = 30000;
export const MAX_REPLAY_BYTES = 8 * 1024 * 1024;

const EVENT_TYPES = new Set([
  'add', 'remove', 'addConstraint', 'removeConstraint',
  'addHinge', 'removeHinge', 'hingeMotor', 'settings', 'regions',
  'bodyProps', 'blast', 'dragStart', 'drag', 'dragEnd',
]);

/** Start a recording. `initial` is an engine snapshot (core.snapshot());
 *  `settings` rides alongside because snapshots capture bodies/RNG/clock
 *  but NOT gravity or pairwise gravitation — the player applies the
 *  settings first, then loads the snapshot. */
export function createRecording({ backend, sceneName, initial, settings, appVersion }) {
  return {
    format: REPLAY_FORMAT,
    version: REPLAY_VERSION,
    appVersion: appVersion || '',
    backend: backend === 'native' ? 'native' : 'matter',
    sceneName: typeof sceneName === 'string' ? sceneName.slice(0, 128) : 'Untitled',
    createdAt: Date.now(),
    steps: 0,
    initial,
    settings: settings && typeof settings === 'object' ? settings : null,
    events: [],
    finalHash: '',
  };
}

/** Append one input event. Events must arrive in non-decreasing step
 *  order; an out-of-order event is clamped to the last step so a sloppy
 *  hook can never corrupt the stream. Returns false when the recording
 *  is full (caller should auto-stop). */
export function recordEvent(rec, step, ev) {
  if (!rec || !ev || !EVENT_TYPES.has(ev.type)) return false;
  if (rec.events.length >= MAX_REPLAY_EVENTS) return false;
  const last = rec.events.length ? rec.events[rec.events.length - 1].step : 0;
  const s = Math.max(last, Math.max(0, Math.floor(Number(step) || 0)));
  rec.events.push({ ...ev, step: s });
  return true;
}

/** Close a recording with its total step count and final-state hash. */
export function finalizeRecording(rec, steps, finalHash) {
  rec.steps = Math.max(0, Math.floor(Number(steps) || 0));
  rec.finalHash = String(finalHash || '');
  return rec;
}

/** Stable hash of a body's dynamic state list. Input: an array of
 *  {id, x, y, angle} (snapshot order is engine order — deterministic).
 *  Coordinates are rounded to 1e-3 so the hash measures physical
 *  divergence, not float-printing noise. FNV-1a over the joined string. */
export function hashBodyStates(states) {
  let s = '';
  for (const b of states || []) {
    s += `${b.id}:${Math.round(b.x * 1000)},${Math.round(b.y * 1000)},${Math.round((b.angle || 0) * 1000)};`;
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Extract the hashable state list from an engine snapshot. Snapshot
 *  bodies are engine descriptors: {id, x, y, angle, ...}. */
export function statesFromSnapshot(snap) {
  const bodies = (snap && snap.bodies) || [];
  return bodies.map((b) => ({ id: b.id, x: b.x, y: b.y, angle: b.angle || 0 }));
}

/** Structural validation for an imported replay file. Mirrors the scene
 *  import discipline (1.39): size cap first, then shape, then budgets.
 *  Returns {ok, replay?, error?} — error is a short machine code the UI
 *  maps to a localised message. */
export function validateReplay(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'not-object' };
  if (raw.format !== REPLAY_FORMAT) return { ok: false, error: 'bad-format' };
  if (raw.version !== REPLAY_VERSION) return { ok: false, error: 'bad-version' };
  const steps = Number(raw.steps);
  if (!Number.isFinite(steps) || steps < 0 || steps > MAX_REPLAY_STEPS) return { ok: false, error: 'bad-steps' };
  if (!raw.initial || typeof raw.initial !== 'object' || !Array.isArray(raw.initial.bodies)) {
    return { ok: false, error: 'bad-initial' };
  }
  if (raw.initial.bodies.length > 2000) return { ok: false, error: 'bad-initial' };
  if (!Array.isArray(raw.events) || raw.events.length > MAX_REPLAY_EVENTS) return { ok: false, error: 'bad-events' };
  let lastStep = 0;
  for (const ev of raw.events) {
    if (!ev || typeof ev !== 'object' || !EVENT_TYPES.has(ev.type)) return { ok: false, error: 'bad-event' };
    const s = Number(ev.step);
    if (!Number.isFinite(s) || s < 0 || s > steps) return { ok: false, error: 'bad-event-step' };
    if (s < lastStep) return { ok: false, error: 'bad-event-order' };
    lastStep = s;
  }
  return {
    ok: true,
    replay: {
      format: REPLAY_FORMAT,
      version: REPLAY_VERSION,
      appVersion: String(raw.appVersion || ''),
      backend: raw.backend === 'native' ? 'native' : 'matter',
      sceneName: String(raw.sceneName || 'Replay').slice(0, 128),
      createdAt: Number(raw.createdAt) || 0,
      steps: Math.floor(steps),
      initial: raw.initial,
      settings: raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings) ? raw.settings : null,
      events: raw.events,
      finalHash: String(raw.finalHash || ''),
    },
  };
}

/** Group events by step for O(1) lookup while stepping the player.
 *  Returns a Map<step, event[]>. */
export function eventsByStep(events) {
  const map = new Map();
  for (const ev of events || []) {
    const arr = map.get(ev.step);
    if (arr) arr.push(ev); else map.set(ev.step, [ev]);
  }
  return map;
}
