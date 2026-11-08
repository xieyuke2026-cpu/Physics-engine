/* app.js — application glue: toolbar, tools, pointer interaction, history,
   scene management, status bar, boot/restore. Physics lives in physics.js,
   drawing in render.js, panel DOM in ui.js, persistence in storage.js. */

import { icon, TOOL_ICONS } from './icons.js';
import { sceneData, bodyData, constraintData, hingeData, fluidData, windData, emitterData, validateScene, defaultScene, presetScenes, DEFAULT_SETTINGS, jitteredScene, MAX_SCENE_JSON_BYTES, sceneJsonTooLarge } from './scene.js';
import { createRecording, recordEvent, finalizeRecording, validateReplay, hashBodyStates, statesFromSnapshot, eventsByStep, MAX_REPLAY_STEPS, MAX_REPLAY_BYTES } from './replay.js';
import { createVideoRecorder, videoSupported } from './video.js';
import { CHALLENGES, challengeById, GoalTracker, pointInZone, starsFor } from './challenges.js';
import { encodeScenePayload, decodeScenePayload, payloadFromHash } from './share.js';
import { PhysicsWorld } from './physics.js';
import { PhysicsEngine } from './engine/physics-engine.js';
import { Renderer } from './render.js';
import { Panel, renderSettings, APP_VERSION } from './ui.js';
import { PFLab } from './pf/pf-lab.js';
import { PF_VERSION } from './pf/pf-config.js';
import * as store from './storage.js';
import { presetScenes3D, defaultScene3D } from './scene3d.js';
import { initLab3D, setLab3DActive, lab3DLoadScene, lab3DCurrentName, lab3DRename } from './lab3d.js';
import { t, getLang, setLang, applyI18n, presetDisplayName, syncLangFromStorage } from './i18n.js';

/* Feature flags.
 * FEATURE_3D: Ryan asked on 2026-11-01 to HIDE all 3D content without deleting
 * it. All 3D code, scenes and stored data stay in place; flip this to true to
 * bring the 3D lab back exactly as it was. */
const FEATURE_3D = false;

const $ = (id) => document.getElementById(id);
const canvas = $('world');

/* The solver backend is a device preference (1.41), not scene data:
   scenes stay solver-neutral and can be replayed on either engine. */
function savedBackend() {
  try { return localStorage.getItem('motionlab.backend') === 'native' ? 'native' : 'matter'; } catch { return 'matter'; }
}
let world = new PhysicsWorld(savedBackend());
const renderer = new Renderer(canvas);
const camera = renderer.camera;

let settings = { ...DEFAULT_SETTINGS };
let sceneName = 'Untitled Scene';
let running = false;
let tool = 'select';
let selectedId = null;
let staticDragId = null; // body id armed for direct static dragging (panel toggle)
let selectedFluidId = null;
let selectedWindId = null;
let selectedHingeId = null;
let selectedEmitterId = null;
let initialSnapshot = null;   // for Reset: state at load / last save
let preview = null;
let dragPoint = null;
let springStart = null;   // {bodyId|null, offset:{x,y}, point:{x,y}} first spring endpoint
let springCur = null;     // current pointer world pos while placing a spring
let hingeStart = null;    // same shape as springStart: the pin point for a hinge
let hingeCur = null;      // current pointer world pos while placing a hinge

/* ---------------- toast ---------------- */
let toastTimer = null;
function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------------- scene snapshot / load ---------------- */
function currentScene() {
  return sceneData({
    name: sceneName,
    settings: { ...settings },
    bodies: world.allBodies().map((b) => world.serializeBody(b)),
    constraints: world.serializeConstraints(),
    hinges: world.serializeHinges(),
    fluids: world.fluids(),
    winds: world.winds(),
    emitters: world.emitters(),
  });
}

function loadScene(scene, { markInitial = true } = {}) {
  if (playback) teardownPlayback();
  if (replayRec) cancelReplayRecording();
  if (challenge) { challenge = null; chalDismissed = false; }
  const s = sceneData(scene);
  sceneName = s.name;
  settings = { ...s.settings };
  $('projectName').value = sceneName;
  world.loadScene(s);
  selectedId = null;
  selectedFluidId = null;
  selectedWindId = null;
  selectedHingeId = null;
  selectedEmitterId = null;
  springStart = null; springCur = null;
  hingeStart = null; hingeCur = null;
  renderer.clearTrails();
  if (markInitial) initialSnapshot = JSON.stringify(currentScene());
  refreshPanel();
  updateTransport();
  scheduleAutosave();
}

function selectedBody() { return selectedId ? world.bodyById(selectedId) : null; }
function liveOf(body) {
  const speedPxS = Math.hypot(body.velocity.x, body.velocity.y) * 60;
  return {
    x: body.position.x, y: body.position.y,
    vx: body.velocity.x, vy: body.velocity.y,
    angleDeg: body.angle * 180 / Math.PI,
    mass: body.mass,
    speedPxS,
    ke: body.isStatic ? 0 : 0.5 * body.mass * speedPxS * speedPxS,
    angVelDegS: body.angularVelocity * 60 * 180 / Math.PI,
    momentum: body.isStatic ? 0 : body.mass * speedPxS,
  };
}

/** World point of a spring's first endpoint (anchor may ride on a moving body). */
function springAnchorWorld() {
  if (!springStart) return null;
  if (!springStart.bodyId) return { ...springStart.point };
  const b = world.bodyById(springStart.bodyId);
  if (!b) return null;
  const c = Math.cos(b.angle), s = Math.sin(b.angle);
  const o = springStart.offset;
  return { x: b.position.x + o.x * c - o.y * s, y: b.position.y + o.x * s + o.y * c };
}
function localOffset(body, w) {
  const dx = w.x - body.position.x, dy = w.y - body.position.y;
  const c = Math.cos(-body.angle), s = Math.sin(-body.angle);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

/* ---------------- history (undo/redo over scene snapshots) ---------------- */
const history = { stack: [], idx: -1, applying: false };
function pushHistory() {
  if (history.applying) return;
  const snap = JSON.stringify(currentScene());
  if (history.stack[history.idx] === snap) return;
  history.stack = history.stack.slice(0, history.idx + 1);
  history.stack.push(snap);
  if (history.stack.length > 60) history.stack.shift();
  history.idx = history.stack.length - 1;
  updateUndoBtns();
}
let historyTimer = null;
function pushHistorySoon() { clearTimeout(historyTimer); historyTimer = setTimeout(pushHistory, 350); }
function applyHistory(dir) {
  const next = history.idx + dir;
  if (next < 0 || next >= history.stack.length) return;
  history.idx = next;
  history.applying = true;
  const wasRunning = running; running = false;
  loadScene(JSON.parse(history.stack[history.idx]), { markInitial: false });
  running = wasRunning;
  history.applying = false;
  updateUndoBtns(); updateTransport();
}
function resetHistory() {
  history.stack = [JSON.stringify(currentScene())];
  history.idx = 0;
  updateUndoBtns();
}
function updateUndoBtns() {
  $('btnUndo').disabled = history.idx <= 0;
  $('btnRedo').disabled = history.idx >= history.stack.length - 1;
}

/* ---------------- autosave ---------------- */
let autoTimer = null;
function scheduleAutosave() {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => store.saveAutosave(currentScene()), 700);
}

/* ---------------- panel ---------------- */
/** One-tap material presets for the body panel (1.26): each writes a full
 *  density / friction / restitution / air-friction set in one go. Values
 *  match the materials used across the built-in presets. */
const MATERIAL_PRESETS = {
  foam: { label: '泡沫 Foam', density: 0.0003, friction: 0.3, restitution: 0.4, frictionAir: 0.002 },
  wood: { label: '木头 Wood', density: 0.001, friction: 0.45, restitution: 0.2, frictionAir: 0.001 },
  rubber: { label: '橡胶 Rubber', density: 0.0011, friction: 0.9, restitution: 0.85, frictionAir: 0.001 },
  ice: { label: '冰 Ice', density: 0.0009, friction: 0.03, restitution: 0.05, frictionAir: 0.0005 },
  iron: { label: '铁 Iron', density: 0.008, friction: 0.5, restitution: 0.1, frictionAir: 0.001 },
};

/** Place a fixed N-pole magnet and select it (shared by the scene-panel
 *  button; the tool rail places magnets at the tap point instead). */
function addMagnetAt(x, y, radius = 26) {
  const b = world.addBody(bodyData({
    type: 'circle', x, y, radius, isStatic: true, friction: 0.4,
    density: 0.008, magnet: 100, label: 'Magnet N 磁铁',
  }));
  recEvent('add', { body: world.serializeBody(b) });
  if (challenge) challenge.added.add(world.dataIdOf(b));
  selectedId = world.dataIdOf(b);
  selectedFluidId = null; selectedWindId = null; selectedHingeId = null; selectedEmitterId = null;
  refreshPanel(); pushHistorySoon(); scheduleAutosave();
  toast(t('msg.magnetAdded'));
  return b;
}

const panel = new Panel($('panelBody'), {
  onBodyProp(key, value) {
    const b = selectedBody(); if (!b) return;
    switch (key) {
      case 'x': world.setPosition(b, value, b.position.y); break;
      case 'y': world.setPosition(b, b.position.x, value); break;
      case 'angleDeg': world.setAngleDeg(b, value); break;
      case 'vx': world.setVelocity(b, value, b.velocity.y); break;
      case 'vy': world.setVelocity(b, b.velocity.x, value); break;
      case 'mass': world.setMass(b, value); break;
      case 'density': world.setDensity(b, value); break;
      case 'friction': world.setFriction(b, value); break;
      case 'frictionAir': world.setFrictionAir(b, value); break;
      case 'restitution': world.setRestitution(b, value); break;
      case 'magnet': world.setMagnet(b, value); break;
      case 'isStatic': world.setStatic(b, value); if (!value && staticDragId) { staticDragId = null; panel.staticDragId = null; panel.mode = null; } break;
      case 'lockRotation': world.setLockRotation(b, value); break;
    }
    recBodyProps(b);
    panel.refreshBody(liveOf(b));
    pushHistorySoon(); scheduleAutosave();
  },
  onToggleStaticDrag(id) {
    staticDragId = staticDragId === id ? null : id;
    panel.staticDragId = staticDragId;
    panel.mode = null; // force the body panel to rebuild (armed state styling)
    refreshPanel();
    toast(t(staticDragId ? 'msg.staticDragOn' : 'msg.staticDragOff'));
  },
  onBodyAction(action) {
    const b = selectedBody(); if (!b) return;
    if (action === 'stop') world.stopMotion(b);
    else if (action === 'flipX') world.setVelocity(b, -b.velocity.x, b.velocity.y);
    else if (action === 'flipY') world.setVelocity(b, b.velocity.x, -b.velocity.y);
    recBodyProps(b);
    panel.refreshBody(liveOf(b));
    pushHistorySoon(); scheduleAutosave();
  },
  onSelectBody(id) {
    if (challenge && challenge.locked.has(id)) { toast(t('chal.locked')); return; }
    if (!world.bodyById(id)) return;
    selectedId = id;
    selectedFluidId = null;
    selectedWindId = null;
    selectedHingeId = null;
    selectedEmitterId = null;
    refreshPanel();
  },
  onDeleteBody(id) {
    if (challenge && challenge.locked.has(id)) { toast(t('chal.locked')); return; }
    recEvent('remove', { id });
    if (challenge) challenge.added.delete(id);
    world.removeBody(id);
    if (selectedId === id) selectedId = null;
    refreshPanel(); pushHistorySoon(); scheduleAutosave();
    toast(t('msg.bodyDeleted'));
  },
  onGravityPreset(key) {
    if (key === 'moon') { settings.gravityX = 0; settings.gravityY = 0.17; settings.gravityEnabled = true; }
    else if (key === 'earth') { settings.gravityX = 0; settings.gravityY = 1; settings.gravityEnabled = true; }
    else if (key === 'jupiter') { settings.gravityX = 0; settings.gravityY = 2.5; settings.gravityEnabled = true; }
    else if (key === 'zero') { settings.gravityEnabled = false; }
    else if (key === 'side') { settings.gravityX = 1; settings.gravityY = 0; settings.gravityEnabled = true; }
    world.applySettings(settings);
    recSettings();
    panel.selectedId = null; panel.mode = null; // force scene panel rebuild so values show
    refreshPanel(); updateStatus();
    pushHistorySoon(); scheduleAutosave();
  },
  onBodySize(key, value) {
    const b = selectedBody(); if (!b) return;
    const patch = { [key]: key === 'sides' ? Math.round(value) : value };
    const nb = world.resize(b, patch);
    recBodyProps(nb);
    selectedId = world.dataIdOf(nb);
    panel.selectedId = null; // force form rebuild with new size values
    refreshPanel();
    pushHistorySoon(); scheduleAutosave();
  },
  onSceneProp(key, value) {
    if (key === 'seed') value = Math.min(4294967295, Math.max(0, Math.floor(Number(value) || 0)));
    settings[key] = value;
    world.applySettings(settings);
    recSettings();
    updateStatus();
    pushHistorySoon(); scheduleAutosave();
  },
  onRefreshSeed() {
    settings.seed = (Math.random() * 4294967296) >>> 0;
    world.setSeed(settings.seed);
    panel.mode = null; // rebuild the scene panel so the field shows the new seed
    refreshPanel();
    updateStatus();
    pushHistorySoon(); scheduleAutosave();
    // Refreshing the seed must be VISIBLE (Ryan, 1.36: he re-ran the
    // Galton board after a refresh and nothing changed — the falling
    // balls never drew from the stream). So a refresh immediately
    // replays the scene baseline with the new seed's jitter applied.
    if (replayWithSeed()) toast(t('msg.seedRefreshedReplay', { seed: settings.seed }));
    else toast(t('msg.seedRefreshed', { seed: settings.seed }));
  },
  onSeedReplay() {
    if (replayWithSeed()) toast(t('msg.replayed', { seed: settings.seed }));
    else toast(t('msg.noBaseline'));
  },
  onRandomJitter() {
    // A visible consumer for the seed: every dynamic body gets a kick
    // whose direction/magnitude come from the engine's seeded RNG
    // stream — same seed, same kicks, exactly replayable.
    let n = 0;
    for (const b of world.allBodies()) {
      if (b.isStatic || world.isBound(b)) continue;
      const a = world.random() * Math.PI * 2;
      const m = 2.5 + world.random() * 3.5;
      world.setVelocity(b, b.velocity.x + Math.cos(a) * m, b.velocity.y + Math.sin(a) * m);
      recBodyProps(b);
      n++;
    }
    if (n) { pushHistorySoon(); scheduleAutosave(); }
    toast(t('msg.jittered', { n }));
  },
  onDeleteSelected() { deleteSelected(); },
  onDuplicateSelected() { duplicateSelected(); },
  onSaveScene() { saveCurrent(); },
  onNewScene() { newScene(); },
  onBodyRename(name) {
    const b = selectedBody(); if (!b) return;
    world.renameBody(b, name);
    recBodyProps(b);
    pushHistorySoon(); scheduleAutosave();
    toast(name ? t('msg.renamed', { name }) : t('msg.nameCleared'));
  },
  onAddFluid() {
    if (challenge && challenge.phase === 'run') { toast(t('chal.needBuild')); return; }
    const f = world.addFluid(fluidData({}));
    recRegions();
    selectedFluidId = f.id; selectedId = null; selectedWindId = null; selectedHingeId = null; selectedEmitterId = null;
    refreshPanel(); pushHistorySoon(); scheduleAutosave();
    toast(t('msg.fluidAdded'));
  },
  onSelectFluid(id) {
    if (!world.fluidById(id)) return;
    selectedFluidId = id; selectedId = null; selectedWindId = null; selectedHingeId = null; selectedEmitterId = null;
    refreshPanel();
  },
  onDeleteFluid(id) {
    world.removeFluid(id);
    recRegions();
    if (selectedFluidId === id) selectedFluidId = null;
    refreshPanel(); pushHistorySoon(); scheduleAutosave();
    toast(t('msg.fluidDeleted'));
  },
  onFluidProp(id, key, value) {
    world.updateFluid(id, { [key]: value });
    recRegions();
    pushHistorySoon(); scheduleAutosave();
  },
  onAddWind() {
    if (challenge && challenge.phase === 'run') { toast(t('chal.needBuild')); return; }
    const w = world.addWind(windData({}));
    recRegions();
    selectedWindId = w.id; selectedId = null; selectedFluidId = null; selectedHingeId = null; selectedEmitterId = null;
    refreshPanel(); pushHistorySoon(); scheduleAutosave();
    toast(t('msg.windAdded'));
  },
  onSelectWind(id) {
    if (!world.windById(id)) return;
    selectedWindId = id; selectedId = null; selectedFluidId = null; selectedHingeId = null; selectedEmitterId = null;
    refreshPanel();
  },
  onDeleteWind(id) {
    world.removeWind(id);
    recRegions();
    if (selectedWindId === id) selectedWindId = null;
    refreshPanel(); pushHistorySoon(); scheduleAutosave();
    toast(t('msg.windDeleted'));
  },
  onWindProp(id, key, value) {
    world.updateWind(id, { [key]: value });
    recRegions();
    pushHistorySoon(); scheduleAutosave();
  },
  onAddEmitter() {
    if (challenge && challenge.phase === 'run') { toast(t('chal.needBuild')); return; }
    if (world.emitterCount >= 8) { toast(t('msg.emitterLimit')); return; }
    const e = world.addEmitter(emitterData({}));
    recRegions();
    selectedEmitterId = e.id; selectedId = null; selectedFluidId = null; selectedWindId = null; selectedHingeId = null;
    refreshPanel(); pushHistorySoon(); scheduleAutosave();
    toast(t('msg.emitterAdded'));
  },
  onSelectEmitter(id) {
    if (!world.emitterById(id)) return;
    selectedEmitterId = id; selectedId = null; selectedFluidId = null; selectedWindId = null; selectedHingeId = null;
    refreshPanel();
  },
  onDeleteEmitter(id) {
    world.removeEmitter(id);
    recRegions();
    if (selectedEmitterId === id) selectedEmitterId = null;
    refreshPanel(); pushHistorySoon(); scheduleAutosave();
    toast(t('msg.emitterDeleted'));
  },
  onEmitterProp(id, key, value) {
    world.updateEmitter(id, { [key]: value });
    recRegions();
    pushHistorySoon(); scheduleAutosave();
  },
  onShowScene() { chalDismissed = true; selectedFluidId = null; selectedWindId = null; selectedHingeId = null; selectedEmitterId = null; refreshPanel(); },
  onHingeProp(id, key, value) {
    if (key === 'motorSpeed') { world.setHingeMotor(id, value); recEvent('hingeMotor', { id, value }); }
    pushHistorySoon(); scheduleAutosave();
  },
  onDeleteHinge(id) {
    recEvent('removeHinge', { id });
    world.removeHinge(id);
    if (selectedHingeId === id) selectedHingeId = null;
    refreshPanel(); pushHistorySoon(); scheduleAutosave();
    toast(t('msg.hingeDeleted'));
  },
  onAddMagnet() {
    // Centre of the world stage (the camera frames 0..1280 × 0..600).
    setTool('select');
    addMagnetAt(640, 280);
  },
  onMaterialPreset(key) {
    const b = selectedBody(); if (!b) return;
    const m = MATERIAL_PRESETS[key]; if (!m) return;
    world.setDensity(b, m.density);
    world.setFriction(b, m.friction);
    world.setRestitution(b, m.restitution);
    world.setFrictionAir(b, m.frictionAir);
    recBodyProps(b);
    panel.selectedId = null; panel.mode = null; // force form rebuild with new values
    refreshPanel();
    pushHistorySoon(); scheduleAutosave();
    toast(t('msg.materialSet', { name: m.label }));
  },
  onOpenChallenges() {
    // 1.51: Challenge Mode has its own interface — the hub's Challenges
    // view. The lab hosts no entry and no list; the challenge card's
    // "All challenges" button lands here and routes back to the hub.
    if (challenge) exitChallenge();
    chalDismissed = false;
    openSceneNav();
    setNavView('challenges');
  },
  onChallengeAction(action) {
    if (!challenge) return;
    if (action === 'start') startChallengeRun();
    else if (action === 'restart') restartChallenge();
    else if (action === 'next') nextChallenge();
    else if (action === 'exit') exitChallenge();
  },
});

/** Topmost fluid region containing a world point, or null. */
function pickFluid(w) {
  const list = world.fluids();
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i];
    if (Math.abs(w.x - f.x) <= f.width / 2 && Math.abs(w.y - f.y) <= f.height / 2) return f;
  }
  return null;
}

/** Topmost wind region containing a world point, or null. */
function pickWind(w) {
  const list = world.winds();
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i];
    if (Math.abs(w.x - f.x) <= f.width / 2 && Math.abs(w.y - f.y) <= f.height / 2) return f;
  }
  return null;
}

/** Nearest emitter within grab range of a world point, or null (1.56).
 *  Emitters are points, so the pick is a radius test (18 world px). */
function pickEmitter(w) {
  const list = world.emitters();
  let best = null, bestD = 18;
  for (const e of list) {
    const d = Math.hypot(w.x - e.x, w.y - e.y);
    if (d <= bestD) { best = e; bestD = d; }
  }
  return best;
}

function refreshPanel() {
  // The static-drag arm belongs to the BODY, not to the selection:
  // a stray click on empty canvas (which clears the selection) must
  // not silently disarm it — found by the 1.33 live verification,
  // whose agent misclicked the thin ground bar once and lost the
  // armed state. Disarming happens on toggle-off, Escape, the body
  // turning dynamic, or deletion (a stale id can never match a grab).
  panel.staticDragId = staticDragId;
  const b = selectedBody();
  if (b) { panel.showBody(world.serializeBody(b), liveOf(b)); return; }
  if (selectedHingeId) {
    const h = world.hingeById(selectedHingeId);
    if (h) {
      const labelOf = (id) => { const bb = world.bodyById(id); return bb ? (world.serializeBody(bb).label || id) : id; };
      panel.showHinge(h, h.bodyA ? labelOf(h.bodyA) : null, labelOf(h.bodyB));
      return;
    }
    selectedHingeId = null;
  }
  if (selectedFluidId) {
    const f = world.fluidById(selectedFluidId);
    if (f) { panel.showFluid(f); return; }
    selectedFluidId = null;
  }
  if (selectedWindId) {
    const w = world.windById(selectedWindId);
    if (w) { panel.showWind(w); return; }
    selectedWindId = null;
  }
  if (selectedEmitterId) {
    const em = world.emitterById(selectedEmitterId);
    if (em) { panel.showEmitter(em); return; }
    selectedEmitterId = null;
  }
  if (challenge && !chalDismissed) { panel.showChallenge(challengeVM()); return; }
  panel.backendId = world.core.backendId; // scene panel's Engine row follows the live backend
  panel.showScene(settings, world.allBodies().map((x) => world.serializeBody(x)), world.fluids(), world.winds(), world.emitters());
}

function deleteSelected() {
  if (challenge && selectedId && challenge.locked.has(selectedId)) { toast(t('chal.locked')); return; }
  if (selectedHingeId) {
    recEvent('removeHinge', { id: selectedHingeId });
    world.removeHinge(selectedHingeId);
    selectedHingeId = null;
    refreshPanel(); pushHistorySoon(); scheduleAutosave();
    toast(t('msg.hingeDeleted'));
    return;
  }
  if (selectedEmitterId) {
    world.removeEmitter(selectedEmitterId);
    recRegions();
    selectedEmitterId = null;
    refreshPanel(); pushHistorySoon(); scheduleAutosave();
    toast(t('msg.emitterDeleted'));
    return;
  }
  if (!selectedId) return;
  recEvent('remove', { id: selectedId });
  if (challenge) challenge.added.delete(selectedId);
  world.removeBody(selectedId);
  selectedId = null;
  refreshPanel(); pushHistorySoon(); scheduleAutosave();
  toast(t('msg.bodyDeleted'));
}
function duplicateSelected() {
  const b = selectedBody(); if (!b) return;
  if (challenge) {
    if (challenge.phase !== 'build') { toast(t('chal.needBuild')); return; }
    if (challenge.added.size >= challenge.def.budget) { toast(t('chal.budgetOut', { n: challenge.def.budget })); return; }
  }
  const d = world.serializeBody(b);
  d.id = undefined; // fresh id assigned by bodyData
  d.x += 28; d.y += 28; d.vx = 0; d.vy = 0;
  const nb = world.addBody(bodyData(d));
  recEvent('add', { body: world.serializeBody(nb) });
  if (challenge) challenge.added.add(world.dataIdOf(nb));
  selectedId = world.dataIdOf(nb);
  refreshPanel(); pushHistorySoon(); scheduleAutosave();
}

/* ---------------- transport ---------------- */
function updateTransport() {
  const play = $('btnPlay');
  play.innerHTML = running ? `${icon('pause', 17)} ${t('transport.pause')}` : `${icon('play', 17)} ${t('transport.run')}`;
  play.classList.toggle('is-running', running);
  $('btnPause').disabled = !running;
  const st = $('stState');
  st.textContent = running ? t('st.running') : t('st.paused');
  st.classList.toggle('running', running);
}
function setRunning(v) {
  if (!v && dragRecActive) { recEvent('dragEnd'); dragRecActive = false; }
  running = v; if (!v) world.endDrag(); updateTransport();
}

/* ---------------- scene actions ---------------- */
function saveCurrent() {
  sceneName = $('projectName').value.trim() || 'Untitled Scene';
  const s = currentScene();
  if (store.saveSceneToLibrary(s)) {
    initialSnapshot = JSON.stringify(s);
    toast(t('msg.saved', { name: sceneName }));
  } else toast(t('msg.saveFailed'), 3200);
}
function newScene() {
  if (!confirm(t('msg.newSceneConfirm'))) return;
  setRunning(false);
  loadScene(defaultScene());
  resetHistory();
  toast(t('msg.newScene'));
}
function resetScene() {
  if (!initialSnapshot) return;
  setRunning(false);
  history.applying = true;
  loadScene(JSON.parse(initialSnapshot), { markInitial: false });
  history.applying = false;
  pushHistory();
  toast(t('msg.sceneReset'));
}

/** Restore the scene baseline (initialSnapshot) with the dynamic
 *  bodies' starting positions jittered by the CURRENT seed's RNG
 *  stream, then run. Same seed -> identical jitter -> identical run;
 *  this is the seed's headline behaviour (e.g. re-dropping the Galton
 *  board under a new seed changes the outcome). Current settings are
 *  kept; only body starting poses come from the jittered baseline. */
function replayWithSeed() {
  if (!initialSnapshot) return false;
  world.setSeed(settings.seed); // restart the stream at the seed
  const base = JSON.parse(initialSnapshot);
  const jittered = jitteredScene(base, () => world.random());
  jittered.settings = { ...jittered.settings, ...settings };
  history.applying = true;
  loadScene(jittered, { markInitial: false });
  history.applying = false;
  pushHistory();
  setRunning(true);
  return true;
}

/* ---------------- pointer interaction ---------------- */
const pointers = new Map();
let gesture = null; // {kind:'create'|'drag-body'|'pan'|'pinch', ...}

function toWorld(e) {
  const r = canvas.getBoundingClientRect();
  return camera.screenToWorld(e.clientX - r.left, e.clientY - r.top, renderer.view);
}
function hintFor(toolName) {
  const key = toolName === 'spring' ? (springStart ? 'hint.springNext' : 'hint.springStart')
    : toolName === 'hinge' ? (hingeStart ? 'hint.hingeNext' : 'hint.hingeStart')
    : `hint.${toolName}`;
  $('stageHint').textContent = t(key);
}
function setTool(t) {
  tool = t;
  if (t !== 'spring') { springStart = null; springCur = null; }
  if (t !== 'hinge') { hingeStart = null; hingeCur = null; }
  document.querySelectorAll('.tool-btn').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  hintFor(t);
  canvas.style.cursor = t === 'move' ? 'grab' : t === 'delete' ? 'not-allowed' : 'crosshair';
  if (t === 'select') canvas.style.cursor = 'default';
}

/* ---------------- blast tool （冲击波） ---------------- */
const BLAST_RADIUS = 280;
let blastFx = null; // {x, y, radius, startedAt} — renderer draws the expanding ring
function applyBlast(w) {
  // The shove itself is PhysicsEngine.applyRadialImpulse (v1.2.0) via the
  // adapter, which keeps world-boundary bodies out. base/power reproduce the
  // original hand-tuned curve: magnitude 2 + 13 * (1 - distance / radius).
  const hit = world.applyRadialImpulse(w.x, w.y, { radius: BLAST_RADIUS, base: 2, power: 13 });
  recEvent('blast', { x: w.x, y: w.y, radius: BLAST_RADIUS });
  blastFx = { x: w.x, y: w.y, radius: BLAST_RADIUS, startedAt: performance.now() };
  if (hit) toast(t('msg.blast', { n: hit }));
  scheduleAutosave();
}

/** Two-tap spring placement: body->body, body->world anchor, or world anchor->body. */
function handleSpringTap(w) {
  const b = world.pick(w.x, w.y);
  if (!springStart) {
    springStart = b
      ? { bodyId: world.dataIdOf(b), offset: localOffset(b, w), point: { ...w } }
      : { bodyId: null, offset: { x: 0, y: 0 }, point: { ...w } };
    springCur = { ...w };
    hintFor('spring');
    toast(b ? t('msg.springStartBody') : t('msg.springStartAnchor'));
    return;
  }
  const start = springStart;
  springStart = null; springCur = null;
  hintFor('spring');
  if (b && start.bodyId && world.dataIdOf(b) === start.bodyId) { toast(t('msg.springSameBody')); return; }
  if (!b && !start.bodyId) { toast(t('msg.springNeedBody')); return; }
  // Only bodyA may be null (a fixed world anchor), so a world endpoint always goes to A.
  let data;
  if (start.bodyId && b) {
    data = constraintData({ bodyA: start.bodyId, bodyB: world.dataIdOf(b), pointA: start.offset, pointB: localOffset(b, w), stiffness: 0.08, damping: 0.05 });
  } else if (start.bodyId && !b) {
    data = constraintData({ bodyA: null, bodyB: start.bodyId, pointA: { ...w }, pointB: start.offset, stiffness: 0.08, damping: 0.05 });
  } else {
    data = constraintData({ bodyA: null, bodyB: world.dataIdOf(b), pointA: start.point, pointB: localOffset(b, w), stiffness: 0.08, damping: 0.05 });
  }
  if (world.addConstraint(data)) {
    recEvent('addConstraint', { constraint: data });
    pushHistorySoon(); scheduleAutosave();
    toast(t('msg.springCreated'));
  } else toast(t('msg.springFailed'));
}

/** World point of a hinge's first endpoint (mirrors springAnchorWorld). */
function hingeAnchorWorld() {
  if (!hingeStart) return null;
  if (!hingeStart.bodyId) return { ...hingeStart.point };
  const b = world.bodyById(hingeStart.bodyId);
  if (!b) return null;
  const c = Math.cos(b.angle), s = Math.sin(b.angle);
  const o = hingeStart.offset;
  return { x: b.position.x + o.x * c - o.y * s, y: b.position.y + o.x * s + o.y * c };
}

/** Two-tap hinge placement: the FIRST tap sets the pin point (on a body,
 *  or empty space for a fixed mount); the second tap picks the partner
 *  body, which is pinned at that same world point. */
function handleHingeTap(w) {
  const b = world.pick(w.x, w.y);
  if (!hingeStart) {
    hingeStart = b
      ? { bodyId: world.dataIdOf(b), offset: localOffset(b, w), point: { ...w } }
      : { bodyId: null, offset: { x: 0, y: 0 }, point: { ...w } };
    hingeCur = { ...w };
    hintFor('hinge');
    toast(b ? t('msg.hingeStartBody') : t('msg.hingeStartAnchor'));
    return;
  }
  const start = hingeStart;
  hingeStart = null; hingeCur = null;
  hintFor('hinge');
  if (!b) { toast(t('msg.hingeNeedBody')); return; }
  if (start.bodyId && world.dataIdOf(b) === start.bodyId) { toast(t('msg.hingeSameBody')); return; }
  const pin = start.bodyId
    ? hingeAnchorOf(start)
    : start.point;
  const data = hingeData({
    bodyA: start.bodyId,
    bodyB: world.dataIdOf(b),
    pointA: start.bodyId ? start.offset : start.point,
    pointB: localOffset(b, pin),
    motorSpeed: 0,
  });
  const created = world.addHinge(data);
  if (created) recEvent('addHinge', { hinge: world.hingeById(created.id) || data });
  if (created) {
    selectedHingeId = created.id;
    selectedId = null; selectedFluidId = null; selectedWindId = null; selectedEmitterId = null;
    refreshPanel(); pushHistorySoon(); scheduleAutosave();
    toast(t('msg.hingeCreated'));
  } else toast(t('msg.hingeFailed'));
}

/** Resolve the world pin point from a stored hinge start (body may have moved). */
function hingeAnchorOf(start) {
  const b = world.bodyById(start.bodyId);
  if (!b) return start.point;
  const c = Math.cos(b.angle), s = Math.sin(b.angle);
  const o = start.offset;
  return { x: b.position.x + o.x * c - o.y * s, y: b.position.y + o.x * s + o.y * c };
}

/** Nearest hinge anchor within tap tolerance of a world point, or null. */
function pickHinge(wx, wy) {
  const tol = 14 / camera.zoom;
  let best = null, bestD = tol;
  for (const a of world.hingeAnchors()) {
    const d = Math.hypot(wx - a.x, wy - a.y);
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

/** Nearest spring segment within tap tolerance of a world point, or null. */
function pickSpring(wx, wy) {
  const tol = 12 / camera.zoom;
  let best = null, bestD = tol;
  for (const seg of world.constraintSegments()) {
    const { a, b } = seg;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / len2));
    const d = Math.hypot(wx - (a.x + dx * t), wy - (a.y + dy * t));
    if (d < bestD) { bestD = d; best = seg; }
  }
  return best;
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    // begin pinch: cancel any single-pointer gesture
    world.endDrag(); gesture = { kind: 'pinch', d: pinchDist(), cx: pinchCenter().x, cy: pinchCenter().y };
    preview = null;
    return;
  }
  const w = toWorld(e);
  if (tool === 'circle' || tool === 'rectangle' || tool === 'polygon' || tool === 'triangle' || tool === 'line' || tool === 'magnet') {
    gesture = { kind: 'create', start: w, cur: w };
    updatePreview();
    return;
  }
  if (tool === 'spring') { handleSpringTap(w); return; }
  if (tool === 'hinge') { handleHingeTap(w); return; }
  if (tool === 'blast') { applyBlast(w); return; }
  if (tool === 'delete') {
    // hinges first: their pin markers are small targets sitting on bodies
    const hg = pickHinge(w.x, w.y);
    if (hg) {
      recEvent('removeHinge', { id: hg.id });
      world.removeHinge(hg.id);
      if (selectedHingeId === hg.id) selectedHingeId = null;
      refreshPanel(); pushHistorySoon(); scheduleAutosave();
      toast(t('msg.hingeDeleted'));
      return;
    }
    // springs next: tapping near a spring line removes the spring, not a body
    const seg = pickSpring(w.x, w.y);
    if (seg) {
      recEvent('removeConstraint', { id: seg.id });
      world.removeConstraint(seg.id);
      refreshPanel(); pushHistorySoon(); scheduleAutosave();
      toast(t('msg.springDeleted'));
      return;
    }
    const b = world.pick(w.x, w.y);
    if (b) {
      const id = world.dataIdOf(b);
      if (challenge && challenge.locked.has(id)) { toast(t('chal.locked')); return; }
      recEvent('remove', { id });
      if (challenge) challenge.added.delete(id);
      world.removeBody(id);
      if (selectedId === id) selectedId = null;
      refreshPanel(); pushHistorySoon(); scheduleAutosave();
      toast(t('msg.bodyDeleted'));
      return;
    }
    const wn = pickWind(w);
    if (wn) {
      world.removeWind(wn.id);
      recRegions();
      if (selectedWindId === wn.id) selectedWindId = null;
      refreshPanel(); pushHistorySoon(); scheduleAutosave();
      toast(t('msg.windDeleted'));
      return;
    }
    const f = pickFluid(w);
    if (f) {
      world.removeFluid(f.id);
      recRegions();
      if (selectedFluidId === f.id) selectedFluidId = null;
      refreshPanel(); pushHistorySoon(); scheduleAutosave();
      toast(t('msg.fluidDeleted'));
    }
    return;
  }
  // select / move
  // hinge pins win over bodies in the select tool: the marker usually
  // sits ON a body, so it must be checked first or it can never be picked.
  if (tool === 'select') {
    const hg = pickHinge(w.x, w.y);
    if (hg) {
      selectedHingeId = hg.id;
      selectedId = null; selectedFluidId = null; selectedWindId = null; selectedEmitterId = null;
      refreshPanel();
      gesture = { kind: 'none' };
      return;
    }
  }
  const b = world.pick(w.x, w.y);
  if (b) {
    selectedId = world.dataIdOf(b);
    if (challenge && challenge.locked.has(selectedId)) {
      selectedId = null;
      gesture = { kind: 'none' };
      toast(t('chal.locked'));
      return;
    }
    selectedFluidId = null;
    selectedWindId = null;
    selectedHingeId = null;
    selectedEmitterId = null;
    refreshPanel();
    if (b.isStatic && staticDragId === selectedId) {
      gesture = { kind: 'drag-static', body: b, offX: w.x - b.position.x, offY: w.y - b.position.y, moved: false };
    } else if (!b.isStatic) {
      if (running) {
        world.beginDrag(b, w.x, w.y);
        dragPoint = { x: w.x, y: w.y, bodyX: b.position.x, bodyY: b.position.y };
        if (replayRec) { recEvent('dragStart', { id: world.dataIdOf(b), x: w.x, y: w.y }); dragRecActive = true; recLastDrag = { x: w.x, y: w.y }; }
      }
      gesture = { kind: 'drag-body', body: b, offX: w.x - b.position.x, offY: w.y - b.position.y, moved: false };
    } else if (tool === 'move') {
      gesture = { kind: 'pan', sx: e.clientX, sy: e.clientY, camX: camera.x, camY: camera.y };
    }
  } else {
    if (tool === 'move') {
      gesture = { kind: 'pan', sx: e.clientX, sy: e.clientY, camX: camera.x, camY: camera.y };
    } else {
      // no body hit: a wind or fluid region can still be selected for
      // editing (winds are drawn above fluids, so they win the pick) —
      // and since 1.26 it can be dragged on the canvas to move it.
      if (challenge) { gesture = { kind: 'none' }; return; }
      const em = pickEmitter(w);
      const wn = em ? null : pickWind(w);
      const f = (em || wn) ? null : pickFluid(w);
      selectedId = null;
      selectedHingeId = null;
      selectedEmitterId = em ? em.id : null;
      selectedWindId = wn ? wn.id : null;
      selectedFluidId = f ? f.id : null;
      refreshPanel();
      const rec = em || wn || f;
      gesture = rec
        ? { kind: 'drag-region', regionType: em ? 'emitter' : wn ? 'wind' : 'fluid', rec, offX: w.x - rec.x, offY: w.y - rec.y, moved: false }
        : { kind: 'none' };
    }
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (tool === 'spring' && springStart) springCur = toWorld(e);
  if (tool === 'hinge' && hingeStart) hingeCur = toWorld(e);
  if (!gesture) return;
  if (gesture.kind === 'pinch' && pointers.size === 2) {
    const d = pinchDist(), c = pinchCenter();
    if (gesture.d > 0) { camera.zoom *= d / gesture.d; camera.clampZoom(); }
    camera.x -= (c.x - gesture.cx) / camera.zoom;
    camera.y -= (c.y - gesture.cy) / camera.zoom;
    gesture.d = d; gesture.cx = c.x; gesture.cy = c.y;
    updateZoomLabel();
    return;
  }
  const w = toWorld(e);
  if (gesture.kind === 'create') { gesture.cur = w; updatePreview(); }
  else if (gesture.kind === 'drag-region') {
    gesture.moved = true;
    const nx = Math.round(w.x - gesture.offX), ny = Math.round(w.y - gesture.offY);
    if (gesture.regionType === 'wind') world.updateWind(gesture.rec.id, { x: nx, y: ny });
    else if (gesture.regionType === 'emitter') world.updateEmitter(gesture.rec.id, { x: nx, y: ny });
    else world.updateFluid(gesture.rec.id, { x: nx, y: ny });
    gesture.rec.x = nx; gesture.rec.y = ny; // local copy: keep the grab offset stable
  } else if (gesture.kind === 'drag-static') {
    gesture.moved = true;
    world.setPosition(gesture.body, Math.round(w.x - gesture.offX), Math.round(w.y - gesture.offY));
    panel.refreshBody(liveOf(gesture.body));
  } else if (gesture.kind === 'drag-body') {
    gesture.moved = true;
    if (running && world.dragging) {
      world.moveDrag(w.x, w.y);
      dragPoint = { x: w.x, y: w.y, bodyX: gesture.body.position.x, bodyY: gesture.body.position.y };
      if (replayRec && dragRecActive && (!recLastDrag || Math.hypot(w.x - recLastDrag.x, w.y - recLastDrag.y) >= 1)) {
        recEvent('drag', { x: w.x, y: w.y });
        recLastDrag = { x: w.x, y: w.y };
      }
    }
    else if (!running) world.setPosition(gesture.body, w.x - gesture.offX, w.y - gesture.offY);
    panel.refreshBody(liveOf(gesture.body));
  } else if (gesture.kind === 'pan') {
    camera.x = gesture.camX - (e.clientX - gesture.sx) / camera.zoom;
    camera.y = gesture.camY - (e.clientY - gesture.sy) / camera.zoom;
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (!gesture) return;
  if (gesture.kind === 'pinch') { if (pointers.size < 2) gesture = null; return; }
  if (gesture.kind === 'create') finalizeCreate();
  if (gesture.kind === 'drag-region' && gesture.moved) {
    recRegions();
    panel.mode = null; // force the region editor to rebuild with the new centre
    refreshPanel(); pushHistorySoon(); scheduleAutosave();
  }
  if (gesture.kind === 'drag-body') {
    if (replayRec && dragRecActive) { recEvent('dragEnd'); dragRecActive = false; }
    world.endDrag(); dragPoint = null;
    if (gesture.moved) {
      if (replayRec && !running) recBodyProps(gesture.body);
      pushHistorySoon(); scheduleAutosave();
    }
  }
  if (gesture.kind === 'drag-static' && gesture.moved) {
    if (replayRec) recBodyProps(gesture.body);
    pushHistorySoon(); scheduleAutosave();
  }
  gesture = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

function pinchDist() {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function pinchCenter() {
  const [a, b] = [...pointers.values()];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function updatePreview() {
  if (!gesture || gesture.kind !== 'create') { preview = null; return; }
  const { start: s, cur: c } = gesture;
  const dx = c.x - s.x, dy = c.y - s.y;
  if (tool === 'circle' || tool === 'polygon' || tool === 'triangle' || tool === 'magnet') preview = { kind: 'circle', x: s.x, y: s.y, r: Math.max(6, Math.hypot(dx, dy)) };
  else if (tool === 'line') preview = { kind: 'line', x1: s.x, y1: s.y, x2: c.x, y2: c.y };
  else preview = { kind: 'rectangle', x: (s.x + c.x) / 2, y: (s.y + c.y) / 2, w: Math.max(6, Math.abs(dx)), h: Math.max(6, Math.abs(dy)) };
}

function finalizeCreate() {
  const { start: s, cur: c } = gesture;
  const dx = c.x - s.x, dy = c.y - s.y;
  const dist = Math.hypot(dx, dy);
  let d = null;
  if (tool === 'circle') d = bodyData({ type: 'circle', x: s.x, y: s.y, radius: dist > 6 ? dist : 30, restitution: 0.4, label: 'Ball' });
  else if (tool === 'magnet') d = bodyData({ type: 'circle', x: s.x, y: s.y, radius: dist > 6 ? dist : 26, isStatic: true, friction: 0.4, density: 0.008, magnet: 100, label: 'Magnet N 磁铁' });
  else if (tool === 'polygon') d = bodyData({ type: 'polygon', x: s.x, y: s.y, radius: dist > 6 ? dist : 34, sides: 6, label: 'Polygon' });
  else if (tool === 'triangle') d = bodyData({ type: 'polygon', x: s.x, y: s.y, radius: dist > 6 ? dist : 36, sides: 3, label: 'Triangle' });
  else if (tool === 'rectangle') {
    d = dist > 6
      ? bodyData({ type: 'rectangle', x: (s.x + c.x) / 2, y: (s.y + c.y) / 2, width: Math.abs(dx), height: Math.abs(dy), label: 'Box' })
      : bodyData({ type: 'rectangle', x: s.x, y: s.y, width: 64, height: 64, label: 'Box' });
  } else if (tool === 'line') {
    d = dist > 10
      ? bodyData({ type: 'line', x: (s.x + c.x) / 2, y: (s.y + c.y) / 2, width: dist, height: 6, angle: Math.atan2(dy, dx), isStatic: true, friction: 0.2, label: 'Line' })
      : bodyData({ type: 'line', x: s.x, y: s.y, width: 180, height: 6, angle: 0, isStatic: true, friction: 0.2, label: 'Line' });
  }
  preview = null;
  if (!d) return;
  if (challenge) {
    if (challenge.phase !== 'build') { toast(t('chal.needBuild')); return; }
    if (challenge.added.size >= challenge.def.budget) { toast(t('chal.budgetOut', { n: challenge.def.budget })); return; }
  }
  const b = world.addBody(d);
  recEvent('add', { body: world.serializeBody(b) });
  if (challenge) challenge.added.add(world.dataIdOf(b));
  selectedId = world.dataIdOf(b);
  selectedFluidId = null;
  setTool('select');
  refreshPanel(); pushHistorySoon(); scheduleAutosave();
  if (d.magnet) toast(t('msg.magnetAdded'));
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const before = toWorld(e);
  // Proportional zoom (1.55): the old sign-only step (×1.1 / ×0.9 per
  // event, ignoring magnitude) made trackpads unusable — a pinch or a
  // two-finger scroll fires dozens of small-delta events per second,
  // each worth a full 10% jump. Scale by the actual delta instead:
  // deltaMode normalises line/page units to pixels; ctrlKey marks a
  // trackpad pinch, whose deltas are small and get a larger gain.
  // A mouse notch (~100 px) still lands near the old ×1.17 / ×0.85.
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const delta = e.deltaY * unit;
  const gain = e.ctrlKey ? 0.006 : 0.0016;
  const f = Math.min(2, Math.max(0.5, Math.exp(-delta * gain)));
  camera.zoom *= f;
  camera.clampZoom();
  const after = toWorld(e);
  camera.x += before.x - after.x; camera.y += before.y - after.y;
  updateZoomLabel();
}, { passive: false });

/* (Removed in 1.23 per Ryan's request: double-clicking empty canvas used to
   add a circle. Creation now happens only through the shape tools.) */

/* ---------------- zoom controls ---------------- */
function updateZoomLabel() {
  const z = `${Math.round(camera.zoom * 100)}%`;
  $('btnZoomFit').textContent = z;
  $('stZoom').textContent = `Zoom ${z}`;
}
$('btnZoomIn').addEventListener('click', () => { camera.zoom *= 1.2; camera.clampZoom(); updateZoomLabel(); });
$('btnZoomOut').addEventListener('click', () => { camera.zoom /= 1.2; camera.clampZoom(); updateZoomLabel(); });
$('btnZoomFit').addEventListener('click', () => { camera.fit(renderer.view); updateZoomLabel(); });

/* ---------------- scenes modal ---------------- */
function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(b.dataset.close)));
document.querySelectorAll('.modal-backdrop').forEach((m) => m.addEventListener('pointerdown', (e) => { if (e.target === m) m.hidden = true; }));

/* ---------------- home (My Projects hub) ---------------- */
let navView = 'overview';
function openSceneNav() {
  renderSceneNav();
  setNavView(navView);
  $('sceneNav').hidden = false;
}
function closeSceneNav() { $('sceneNav').hidden = true; }

/* The developer-docs page shows the same version trio as Settings → About,
   stamped from the single sources of truth so the prose can never go stale. */
function stampDocsVersions() {
  const els = document.querySelectorAll('.docsVersions');
  if (!els.length) return;
  const matter = (typeof window !== 'undefined' && window.Matter && window.Matter.version) || '—';
  const text = `MotionLab ${APP_VERSION} · PhysicsEngine ${PhysicsEngine.VERSION} · Matter.js ${matter} · PFLab ${PF_VERSION}`;
  els.forEach((el) => { el.textContent = text; });
}

/* ---------------- PFLab (platform fighter module) ----------------
   Single entry point: the PFLab button in the home hub's sidebar
   (the main interface). The overlay is opened FIRST and the hub is closed
   only after it succeeds — a failure must never strand the user in the lab
   behind (an earlier version closed the hub first and did exactly that). */
let pfLab = null;
function enterPFLab() {
  try {
    if (!pfLab) pfLab = new PFLab(() => openSceneNav());
    pfLab.enter();
    closeSceneNav();
  } catch (err) {
    console.error('PFLab failed to open:', err);
    toast(t('msg.pfFailed', { err: err && err.message ? err.message : err }));
  }
}

/* ---------------- New-version notice ----------------
   GitHub Pages (and Safari) may keep serving cached files after a deploy.
   The app polls version.json with no-store on boot and whenever the tab
   becomes visible again; if the served version differs from the running
   one, a notice offers a one-tap refresh to the new build. */
let updateDismissedFor = null;
let updateAvailable = null;
async function checkForUpdate() {
  try {
    if (typeof fetch !== 'function') return;
    const r = await fetch(`version.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const v = await r.json();
    if (v && typeof v.app === 'string' && v.app !== APP_VERSION && v.app !== updateDismissedFor) {
      updateAvailable = v.app;
      const bar = $('updateBar');
      if (!bar) return;
      $('updateText').textContent = t('update.msg', { v: v.app, cur: APP_VERSION });
      bar.hidden = false;
    }
  } catch { /* offline or local preview: stay silent */ }
}

function setNavView(view) {
  navView = view;
  document.querySelectorAll('.side-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  // Workbench overview (1.40): the centre column shows compact rows and
  // the inspector aside; the card grids belong to the library / presets
  // views.
  const overview = view === 'overview';
  $('navSectionCurrent').hidden = !overview;
  $('navSectionSavedList').hidden = !overview;
  $('navSectionPresetsList').hidden = !overview;
  $('hubInspector').hidden = !overview;
  $('navSectionSaved').hidden = view === 'presets' || view === 'docs' || view === 'challenges' || overview;
  $('navSectionSaved3D').hidden = view === 'presets' || view === 'docs' || view === 'challenges' || overview;
  $('navSectionPresets').hidden = view === 'library' || view === 'docs' || view === 'challenges' || overview;
  $('navSectionPresets3D').hidden = view === 'library' || view === 'docs' || view === 'challenges' || overview;
  $('navSectionDocs').hidden = view !== 'docs';
  $('navSectionChallenges').hidden = view !== 'challenges';
  $('navToolbar').style.display = view === 'presets' || view === 'docs' || view === 'challenges' ? 'none' : '';
  $('navTitle').textContent = t(`hub.title.${view}`);
}

/* ---------------- 2D / 3D mode switching ---------------- */
let appMode = '2d';
function setAppMode(m) {
  if (m === '3d' && !FEATURE_3D) m = '2d'; // 3D hidden (not removed) — stay in 2D
  appMode = m;
  $('mode2d').classList.toggle('active', m === '2d');
  $('mode3d').classList.toggle('active', m === '3d');
  $('main').hidden = m !== '2d';
  $('statusbar').hidden = m !== '2d';
  $('main3d').hidden = m !== '3d';
  $('statusbar3d').hidden = m !== '3d';
  document.querySelectorAll('.lab2d-only').forEach((g) => { g.style.display = m === '2d' ? '' : 'none'; });
  if (m === '3d') {
    setLab3DActive(true);
    $('projectName').value = lab3DCurrentName();
  } else {
    setLab3DActive(false);
    $('projectName').value = sceneName;
  }
}

/** Static thumbnail drawn from scene data (no physics): shapes + springs, fitted to the card. */
function drawThumb(canvas, scene) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fafafa'; ctx.fillRect(0, 0, W, H);
  const bodies = scene.bodies || [];
  if (!bodies.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ext = (b) => (b.type === 'circle' || b.type === 'polygon') ? b.radius : Math.hypot(b.width, b.height) / 2;
  for (const b of bodies) {
    const e = ext(b);
    minX = Math.min(minX, b.x - e); maxX = Math.max(maxX, b.x + e);
    minY = Math.min(minY, b.y - e); maxY = Math.max(maxY, b.y + e);
  }
  const pad = 10;
  const scale = Math.min((W - pad * 2) / Math.max(1, maxX - minX), (H - pad * 2) / Math.max(1, maxY - minY));
  const ox = pad + ((W - pad * 2) - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = pad + ((H - pad * 2) - (maxY - minY) * scale) / 2 - minY * scale;
  const P = (x, y) => [ox + x * scale, oy + y * scale];
  const byId = new Map(bodies.map((b) => [b.id, b]));
  ctx.strokeStyle = '#8a8d93'; ctx.lineWidth = 1;
  for (const c of scene.constraints || []) {
    const bB = byId.get(c.bodyB); if (!bB) continue;
    const a = c.bodyA && byId.get(c.bodyA) ? [byId.get(c.bodyA).x, byId.get(c.bodyA).y] : [c.pointA.x, c.pointA.y];
    const [x1, y1] = P(a[0], a[1]); const [x2, y2] = P(bB.x, bB.y);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  for (const b of bodies) {
    const [cx, cy] = P(b.x, b.y);
    ctx.beginPath();
    if (b.type === 'circle') {
      ctx.arc(cx, cy, Math.max(1.5, b.radius * scale), 0, Math.PI * 2);
    } else {
      let pts;
      if (b.type === 'polygon') {
        pts = [];
        for (let i = 0; i < b.sides; i++) {
          const a = b.angle - Math.PI / 2 + i * Math.PI * 2 / b.sides;
          pts.push([cx + Math.cos(a) * b.radius * scale, cy + Math.sin(a) * b.radius * scale]);
        }
      } else {
        const hw = b.width / 2 * scale, hh = b.height / 2 * scale;
        const c = Math.cos(b.angle), s = Math.sin(b.angle);
        pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([dx, dy]) => [cx + dx * c - dy * s, cy + dx * s + dy * c]);
      }
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
    }
    ctx.fillStyle = b.isBound ? '#dcdce0' : (b.isStatic ? '#e6e6ea' : '#ffffff');
    ctx.fill();
    ctx.strokeStyle = b.isStatic ? '#9a9da3' : '#3c4046';
    ctx.stroke();
  }
}

function sceneCard(scene, opts = {}) {
  const card = document.createElement('article');
  card.className = 'scene-card' + (opts.current ? ' current' : '');
  const cv = document.createElement('canvas');
  cv.className = 'thumb'; cv.width = 264; cv.height = 118;
  card.appendChild(cv);
  const body = document.createElement('div');
  body.className = 'scene-card-body';
  const nameEl = document.createElement('div');
  nameEl.className = 'scene-card-name';
  nameEl.textContent = scene.name;
  if (opts.badge) {
    const bd = document.createElement('span');
    bd.className = 'badge'; bd.textContent = opts.badge;
    nameEl.appendChild(bd);
  }
  const sub = document.createElement('div');
  sub.className = 'scene-sub';
  const nCon = (scene.constraints || []).length;
  sub.textContent = t('card.sub', { n: scene.bodies.length, c: nCon ? t('card.subSprings', { n: nCon }) : '', date: new Date(scene.updatedAt || Date.now()).toLocaleString() });
  body.appendChild(nameEl); body.appendChild(sub);
  const actions = document.createElement('div');
  actions.className = 'scene-card-actions';
  for (const [label, cls, fn] of opts.actions || []) {
    const b = document.createElement('button');
    b.className = 'mini-btn' + (cls ? ` ${cls}` : '');
    b.textContent = label;
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    actions.appendChild(b);
  }
  body.appendChild(actions);
  card.appendChild(body);
  requestAnimationFrame(() => drawThumb(cv, scene));
  return card;
}

function openStoredScene(s) {
  setRunning(false);
  loadScene(s); resetHistory(); closeSceneNav();
  toast(t('msg.opened', { name: s.name }));
}

/* ---------------- scene share links ----------------
   The whole scene rides inside the link's #s= hash (gzip + base64url via
   share.js): no backend, no upload — anyone opening the link lands in the
   lab with this exact scene loaded. */
async function shareSceneObject(sceneObj) {
  try {
    const payload = await encodeScenePayload(sceneData(sceneObj));
    const url = `${window.location.origin}${window.location.pathname}#s=${payload}`;
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch { /* clipboard unavailable (permissions / non-secure context) */ }
    if (copied) toast(t('msg.shareCopied'), 3200);
    else window.prompt(t('msg.sharePrompt'), url);
  } catch { toast(t('msg.shareInvalid'), 3200); }
}
function shareCurrentScene() {
  sceneName = $('projectName').value.trim() || sceneName;
  shareSceneObject(currentScene());
}
/** Boot helper: when the URL carries a #s= payload, load that scene and
 *  report true; false means "no (usable) link — carry on with normal boot". */
async function openSharedSceneFromHash() {
  const payload = payloadFromHash(window.location.hash);
  if (!payload) return false;
  // NB: window.history — the module-level `history` here is the undo stack.
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  const raw = await decodeScenePayload(payload);
  const v = raw ? validateScene(raw) : { ok: false };
  if (!v.ok) { toast(t('msg.shareInvalid'), 3800); return false; }
  setRunning(false);
  loadScene(v.scene); resetHistory();
  toast(t('msg.shareOpened', { name: v.scene.name }), 3200);
  return true;
}

function exportSceneData(s) {
  const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${s.name.replace(/[\\/:*?"<>|]/g, '_')}.motionlab.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function renderSceneCards(filter = '') {
  const list = $('sceneList');
  list.innerHTML = '';
  const scenes = store.loadScenes();
  const names = Object.keys(scenes)
    .filter((n) => !filter || n.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => (scenes[b].updatedAt || 0) - (scenes[a].updatedAt || 0));
  if (!names.length) {
    list.appendChild(Object.assign(document.createElement('p'), {
      className: 'empty-note',
      textContent: filter ? t('hub.emptyNoMatch') : t('hub.emptySaved'),
    }));
    return;
  }
  for (const name of names) {
    const s = scenes[name];
    list.appendChild(sceneCard(s, {
      current: name === sceneName,
      badge: name === sceneName ? t('card.badgeCurrent') : '2D',
      actions: [
        [t('card.open'), 'primary', () => openStoredScene(s)],
        [t('card.rename'), '', () => {
          const nn = prompt(t('msg.renamePrompt'), name);
          if (!nn || !nn.trim() || nn.trim() === name) return;
          if (store.renameSceneInLibrary(name, nn.trim())) {
            if (sceneName === name) { sceneName = nn.trim(); $('projectName').value = sceneName; }
            renderSceneNav(); toast(t('msg.renamedOk'));
          } else toast(t('msg.renameFailed'), 3000);
        }],
        [t('card.duplicate'), '', () => {
          let nn = `${name} ${t('msg.copySuffix')}`; let i = 2;
          const all = store.loadScenes();
          while (all[nn]) nn = `${name} ${t('msg.copySuffix')} ${i++}`;
          if (store.saveSceneToLibrary({ ...s, name: nn })) { renderSceneNav(); toast(t('msg.duplicated', { name: nn })); }
        }],
        [t('card.export'), '', () => exportSceneData(s)],
        [t('card.share'), '', () => shareSceneObject(s)],
        [t('card.delete'), 'danger', () => {
          if (!confirm(t('msg.deleteSceneConfirm', { name }))) return;
          store.deleteSceneFromLibrary(name); renderSceneNav(); toast(t('msg.sceneDeleted'));
        }],
      ],
    }));
  }
}

function renderSceneNav() {
  $('navLogo').innerHTML = icon('logo', 26);
  document.querySelectorAll('.side-ic').forEach((s) => { s.innerHTML = icon(s.dataset.ic, 18); });
  const savedCount = Object.keys(store.loadScenes()).length;
  const saved3Count = FEATURE_3D ? Object.keys(store.loadScenes3D()).length : 0;
  const presetCount = presetScenes().length + (FEATURE_3D ? presetScenes3D().length : 0);
  $('countLibrary').textContent = String(savedCount + saved3Count);
  $('countPresets').textContent = String(presetCount);
  $('sideStorage').textContent = FEATURE_3D
    ? t('hub.storage3d', { s2: savedCount, s3: saved3Count, presets: presetCount })
    : t('hub.storage', { scenes: savedCount, presets: presetCount });
  $('navSectionPresets3D').style.display = FEATURE_3D ? '' : 'none';
  $('navSectionSaved3D').style.display = FEATURE_3D ? '' : 'none';
  // current + autosave cards
  const cur = $('navCurrent');
  cur.innerHTML = '';
  const now = currentScene();
  cur.appendChild(sceneCard(now, {
    current: true, badge: t('card.badgeEditing'),
    actions: [
      [t('card.saveToLib'), 'primary', () => { saveCurrent(); renderSceneNav(); }],
      [t('card.share'), '', () => shareSceneObject(now)],
      [t('card.keepEditing'), '', () => closeSceneNav()],
    ],
  }));
  const auto = store.loadAutosave();
  if (auto && JSON.stringify(auto.bodies) !== JSON.stringify(now.bodies)) {
    cur.appendChild(sceneCard({ ...auto, name: t('card.autosaveName'), updatedAt: auto.updatedAt }, {
      badge: t('card.badgeAuto'),
      actions: [[t('card.restore'), 'primary', () => openStoredScene(auto)]],
    }));
  }
  if (FEATURE_3D) {
    // 3D lab entry card
    const auto3 = store.loadAutosave3D();
    const entry = document.createElement('article');
    entry.className = 'scene-card';
    entry.innerHTML = `<div class="scene-card-body">
        <div class="scene-card-name">3D 实验室<span class="badge badge-3d">3D</span></div>
        <div class="scene-sub">${auto3 ? `上次进度「${auto3.name}」 · ${auto3.bodies.length} 个物体` : '三维刚体物理：方块、球体、斜坡与堆叠'}</div>
        <div class="scene-card-actions"><button class="mini-btn primary">进入 3D 实验室</button></div>
      </div>`;
    entry.querySelector('button').addEventListener('click', () => { closeSceneNav(); setAppMode('3d'); });
    cur.appendChild(entry);
  }
  renderPresetList();
  if (FEATURE_3D) renderPresetList3D();
  renderSceneCards($('sceneSearch').value.trim());
  if (FEATURE_3D) renderSceneCards3D($('sceneSearch').value.trim());
  renderSceneRows();
  renderPresetRows();
  renderChallengeRows();
  renderInspector();
}

/* ---------------- hub workbench (1.40): rows + inspector ----------------
   The overview is a workbench: compact scene/preset rows in the centre
   column, and the selected item detailed in the right-hand inspector
   (preview, meta, actions). The card grids remain for the library and
   presets views; both render from the same store data. */
let hubSel = null; // { kind: 'scene' | 'preset', key: scene name | preset key }

function relTime(ts) {
  const then = ts || Date.now();
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 90) return t('hub.rel.now');
  if (s < 3600) return t('hub.rel.min', { n: Math.max(1, Math.round(s / 60)) });
  if (s < 86400) return t('hub.rel.hour', { n: Math.round(s / 3600) });
  if (s < 86400 * 30) return t('hub.rel.day', { n: Math.round(s / 86400) });
  return new Date(then).toLocaleDateString();
}

function sortedSceneNames(filter = '') {
  const scenes = store.loadScenes();
  return Object.keys(scenes)
    .filter((n) => !filter || n.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => (scenes[b].updatedAt || 0) - (scenes[a].updatedAt || 0));
}

function hubRow({ scene, title, sub, selected, kind, key, onSelect, onOpen, openLabel }) {
  const row = document.createElement('div');
  row.className = 'scene-row' + (selected ? ' sel' : '');
  row.dataset.kind = kind;
  row.dataset.key = key;
  const cv = document.createElement('canvas');
  cv.className = 'row-thumb'; cv.width = 132; cv.height = 74;
  row.appendChild(cv);
  const mid = document.createElement('div');
  mid.className = 'row-mid';
  const nameEl = document.createElement('div');
  nameEl.className = 'row-name'; nameEl.textContent = title;
  const subEl = document.createElement('div');
  subEl.className = 'row-sub'; subEl.textContent = sub;
  mid.appendChild(nameEl); mid.appendChild(subEl);
  row.appendChild(mid);
  const b = document.createElement('button');
  b.className = 'mini-btn primary';
  b.textContent = openLabel;
  b.addEventListener('click', (e) => { e.stopPropagation(); onOpen(); });
  row.appendChild(b);
  row.addEventListener('click', onSelect);
  row.addEventListener('dblclick', onOpen);
  requestAnimationFrame(() => drawThumb(cv, scene));
  return row;
}

function renderSceneRows() {
  const wrap = $('sceneRows');
  if (!wrap) return;
  wrap.innerHTML = '';
  const filter = $('sceneSearch').value.trim();
  const scenes = store.loadScenes();
  const names = sortedSceneNames(filter);
  if (!names.length) {
    wrap.appendChild(Object.assign(document.createElement('p'), {
      className: 'empty-note',
      textContent: filter ? t('hub.emptyNoMatch') : t('hub.emptySaved'),
    }));
    return;
  }
  for (const name of names) {
    const s = scenes[name];
    const nCon = (s.constraints || []).length;
    wrap.appendChild(hubRow({
      scene: s,
      title: name,
      sub: t('card.sub', { n: s.bodies.length, c: nCon ? t('card.subSprings', { n: nCon }) : '', date: relTime(s.updatedAt) }),
      selected: !!hubSel && hubSel.kind === 'scene' && hubSel.key === name,
      kind: 'scene', key: name,
      onSelect: () => selectHubItem('scene', name),
      onOpen: () => openStoredScene(s),
      openLabel: t('card.open'),
    }));
  }
}

function renderPresetRows() {
  const wrap = $('presetRows');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const p of presetScenes()) {
    wrap.appendChild(hubRow({
      scene: p.scene,
      title: presetDisplayName(p),
      sub: t('hub.insp.presetMeta', { n: p.scene.bodies.length }),
      selected: !!hubSel && hubSel.kind === 'preset' && hubSel.key === p.key,
      kind: 'preset', key: p.key,
      onSelect: () => selectHubItem('preset', p.key),
      onOpen: () => loadPreset(p),
      openLabel: t('card.loadRun'),
    }));
  }
}

function renderChallengeRows() {
  const wrap = $('challengeRows');
  if (!wrap) return;
  wrap.innerHTML = '';
  const prog = store.loadChallengeProgress();
  const lang = getLang();
  let total = 0;
  for (const def of CHALLENGES) {
    const p = prog[def.id] || { stars: 0 };
    total += p.stars || 0;
    const stars = '★'.repeat(p.stars || 0) + '☆'.repeat(3 - (p.stars || 0));
    wrap.appendChild(hubRow({
      scene: def.build(),
      title: `${lang === 'en' ? def.title.en : def.title.zh} · ${stars}`,
      sub: lang === 'en' ? def.brief.en : def.brief.zh,
      selected: !!hubSel && hubSel.kind === 'challenge' && hubSel.key === def.id,
      kind: 'challenge', key: def.id,
      onSelect: () => selectHubItem('challenge', def.id),
      onOpen: () => enterChallenge(def.id),
      openLabel: t('chal.start'),
    }));
  }
  const badge = $('countChallenges');
  if (badge) badge.textContent = `★${total}`;
}

function selectHubItem(kind, key) {
  hubSel = { kind, key };
  renderSceneRows();
  renderPresetRows();
  renderChallengeRows();
  renderInspector();
}

/** The item the inspector should show: the user's explicit selection
 *  when it still exists, else the most recently saved scene, else
 *  preset #1. The fallback is recomputed on every render — it is NOT
 *  written back into hubSel, or a boot-time fallback (first preset)
 *  would stick forever and outrank scenes saved later. */
function inspectorTarget() {
  const scenes = store.loadScenes();
  if (hubSel && hubSel.kind === 'scene' && scenes[hubSel.key]) {
    return { kind: 'scene', key: hubSel.key, scene: scenes[hubSel.key] };
  }
  if (hubSel && hubSel.kind === 'preset') {
    const p = presetScenes().find((x) => x.key === hubSel.key);
    if (p) return { kind: 'preset', key: p.key, preset: p };
  }
  const names = sortedSceneNames();
  if (names.length) return { kind: 'scene', key: names[0], scene: scenes[names[0]] };
  const p0 = presetScenes()[0];
  return p0 ? { kind: 'preset', key: p0.key, preset: p0 } : null;
}

function renderInspector() {
  const body = $('inspBody');
  if (!body) return;
  body.innerHTML = '';
  const target = inspectorTarget();
  if (!target) {
    body.appendChild(Object.assign(document.createElement('p'), { className: 'empty-note', textContent: t('hub.emptySaved') }));
    return;
  }
  const scene = target.kind === 'scene' ? target.scene : target.preset.scene;
  const cv = document.createElement('canvas');
  cv.className = 'insp-thumb'; cv.width = 528; cv.height = 236;
  body.appendChild(cv);
  requestAnimationFrame(() => drawThumb(cv, scene));
  const nameEl = document.createElement('div');
  nameEl.className = 'insp-name';
  nameEl.textContent = target.kind === 'scene' ? target.key : presetDisplayName(target.preset);
  body.appendChild(nameEl);
  const nCon = (scene.constraints || []).length;
  const meta = document.createElement('p');
  meta.className = 'insp-meta';
  meta.textContent = target.kind === 'scene'
    ? t('hub.insp.meta', { n: scene.bodies.length, c: nCon ? t('card.subSprings', { n: nCon }) : '', when: relTime(scene.updatedAt) })
    : t('hub.insp.presetMeta', { n: scene.bodies.length });
  body.appendChild(meta);
  const actions = document.createElement('div');
  actions.className = 'insp-actions';
  const addBtn = (label, cls, fn) => {
    const b = document.createElement('button');
    b.className = 'btn block' + (cls ? ` ${cls}` : '');
    b.textContent = label;
    b.addEventListener('click', fn);
    actions.appendChild(b);
  };
  if (target.kind === 'preset') {
    addBtn(t('card.loadRun'), 'accent', () => loadPreset(target.preset));
  } else {
    const s = target.scene;
    const name = target.key;
    addBtn(t('card.open'), 'accent', () => openStoredScene(s));
    addBtn(t('card.duplicate'), '', () => {
      let nn = `${name} ${t('msg.copySuffix')}`; let i = 2;
      const all = store.loadScenes();
      while (all[nn]) nn = `${name} ${t('msg.copySuffix')} ${i++}`;
      if (store.saveSceneToLibrary({ ...s, name: nn })) { hubSel = { kind: 'scene', key: nn }; renderSceneNav(); toast(t('msg.duplicated', { name: nn })); }
    });
    addBtn(t('card.export'), '', () => exportSceneData(s));
    addBtn(t('card.delete'), 'danger', () => {
      if (!confirm(t('msg.deleteSceneConfirm', { name }))) return;
      store.deleteSceneFromLibrary(name);
      if (hubSel && hubSel.key === name) hubSel = null;
      renderSceneNav(); toast(t('msg.sceneDeleted'));
    });
  }
  body.appendChild(actions);
  // keep row highlights in sync when the selection fell back to a default
  document.querySelectorAll('#sceneRows .scene-row, #presetRows .scene-row').forEach((r) => {
    r.classList.toggle('sel', r.dataset.kind === target.kind && r.dataset.key === target.key);
  });
}

function loadPreset(p) {
  loadScene(p.scene);
  resetHistory();
  closeSceneNav();
  setRunning(true);
  toast(t('msg.presetLoaded', { name: presetDisplayName(p) }));
}
function renderPresetList() {
  const wrap = $('presetList');
  wrap.innerHTML = '';
  for (const p of presetScenes()) {
    const card = sceneCard({ ...p.scene, name: presetDisplayName(p) }, {
      badge: '2D',
      actions: [[t('card.loadRun'), 'primary', () => loadPreset(p)]],
    });
    card.classList.add('preset-card');
    card.title = t('card.presetTitle');
    card.addEventListener('click', () => loadPreset(p));
    wrap.appendChild(card);
  }
}
/* ---------------- home: 3D presets & 3D library ---------------- */
function quatFromEuler(e) {
  const cx = Math.cos(e.x / 2), sx = Math.sin(e.x / 2);
  const cy = Math.cos(e.y / 2), sy = Math.sin(e.y / 2);
  const cz = Math.cos(e.z / 2), sz = Math.sin(e.z / 2);
  return {
    x: sx * cy * cz + cx * sy * sz, y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz, w: cx * cy * cz - sx * sy * sz,
  };
}
function quatMat3(q) {
  const { x, y, z, w } = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}
/** Isometric-style overview thumbnail for a 3D scene (drawn from its data). */
function drawThumb3D(canvas, scene) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fafafa'; ctx.fillRect(0, 0, W, H);
  const bodies = (scene.bodies || []).filter((b) => !b.isBound);
  if (!bodies.length) return;
  const th = 0.7, tilt = 0.52;
  const proj = (x, y, z) => {
    const x1 = x * Math.cos(th) - z * Math.sin(th);
    const z1 = x * Math.sin(th) + z * Math.cos(th);
    return [x1, -(y * Math.cos(tilt) - z1 * Math.sin(tilt)), y * Math.sin(tilt) + z1 * Math.cos(tilt)];
  };
  const extent = (b) => b.kind === 'sphere' ? b.radius : Math.hypot(b.sizeX, b.sizeY, b.sizeZ) / 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const probe = [];
  for (const b of bodies) {
    const e = extent(b);
    for (const [dx, dy, dz] of [[-e, -e, -e], [e, e, e], [-e, e, e], [e, -e, -e]]) {
      const p = proj(b.x + dx, b.y + dy, b.z + dz);
      probe.push(p);
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    }
  }
  const pad = 12;
  const scale = Math.min((W - pad * 2) / Math.max(0.5, maxX - minX), (H - pad * 2) / Math.max(0.5, maxY - minY));
  const ox = pad + ((W - pad * 2) - (maxX - minX) * scale) / 2;
  const oy = pad + ((H - pad * 2) - (maxY - minY) * scale) / 2;
  const P = (x, y, z) => { const p = proj(x, y, z); return [ox + (p[0] - minX) * scale, oy + (p[1] - minY) * scale, p[2]]; };
  const items = bodies.map((b) => ({ b, d: P(b.x, b.y, b.z)[2] })).sort((a, b2) => b2.d - a.d);
  for (const { b } of items) {
    ctx.strokeStyle = b.isStatic ? '#9a9da3' : '#3c4046';
    ctx.fillStyle = b.isStatic ? '#e6e6ea' : 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.1;
    if (b.kind === 'sphere') {
      const c = P(b.x, b.y, b.z);
      ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(2, b.radius * scale), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else {
      const m = quatMat3(b.quaternion || quatFromEuler(b.euler || { x: 0, y: 0, z: 0 }));
      const hx = b.sizeX / 2, hy = b.sizeY / 2, hz = b.sizeZ / 2;
      const corners = [];
      for (const [sx, sy, sz] of [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]) {
        const lx = sx * hx, ly = sy * hy, lz = sz * hz;
        corners.push(P(
          b.x + m[0] * lx + m[1] * ly + m[2] * lz,
          b.y + m[3] * lx + m[4] * ly + m[5] * lz,
          b.z + m[6] * lx + m[7] * ly + m[8] * lz,
        ));
      }
      const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      ctx.beginPath();
      for (const [a, b2] of EDGES) { ctx.moveTo(corners[a][0], corners[a][1]); ctx.lineTo(corners[b2][0], corners[b2][1]); }
      ctx.stroke();
    }
  }
}

function sceneCard3D(scene, opts = {}) {
  const card = document.createElement('article');
  card.className = 'scene-card';
  const cv = document.createElement('canvas');
  cv.className = 'thumb'; cv.width = 264; cv.height = 118;
  card.appendChild(cv);
  const body = document.createElement('div');
  body.className = 'scene-card-body';
  const nameEl = document.createElement('div');
  nameEl.className = 'scene-card-name';
  nameEl.textContent = scene.name;
  const bd = document.createElement('span');
  bd.className = 'badge badge-3d'; bd.textContent = opts.badge || '3D';
  nameEl.appendChild(bd);
  const sub = document.createElement('div');
  sub.className = 'scene-sub';
  sub.textContent = `${scene.bodies.length} 个物体 · ${new Date(scene.updatedAt || Date.now()).toLocaleString()}`;
  body.appendChild(nameEl); body.appendChild(sub);
  const actions = document.createElement('div');
  actions.className = 'scene-card-actions';
  for (const [label, cls, fn] of opts.actions || []) {
    const b = document.createElement('button');
    b.className = 'mini-btn' + (cls ? ` ${cls}` : '');
    b.textContent = label;
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    actions.appendChild(b);
  }
  body.appendChild(actions);
  card.appendChild(body);
  requestAnimationFrame(() => drawThumb3D(cv, scene));
  return card;
}

function openStoredScene3D(s, run = false) {
  closeSceneNav();
  setAppMode('3d');
  lab3DLoadScene(s, { run });
  toast(`已打开 3D 场景「${s.name}」`);
}

function renderPresetList3D() {
  const wrap = $('presetList3d');
  wrap.innerHTML = '';
  for (const p of presetScenes3D()) {
    const card = sceneCard3D({ ...p.scene, name: p.name }, {
      badge: '3D 预设',
      actions: [['在 3D 实验室运行', 'primary', () => openStoredScene3D(p.scene, true)]],
    });
    card.classList.add('preset-card');
    card.addEventListener('click', () => openStoredScene3D(p.scene, true));
    wrap.appendChild(card);
  }
}

function renderSceneCards3D(filter = '') {
  const list = $('sceneList3d');
  list.innerHTML = '';
  const scenes = store.loadScenes3D();
  const names = Object.keys(scenes)
    .filter((n) => !filter || n.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => (scenes[b].updatedAt || 0) - (scenes[a].updatedAt || 0));
  if (!names.length) {
    list.appendChild(Object.assign(document.createElement('p'), {
      className: 'empty-note',
      textContent: filter ? '没有匹配的 3D 场景。' : '暂无已保存的 3D 场景。进入 3D 实验室后点「保存 3D 场景」即可存到这里。',
    }));
    return;
  }
  for (const name of names) {
    const s = scenes[name];
    list.appendChild(sceneCard3D(s, {
      actions: [
        ['打开', 'primary', () => openStoredScene3D(s)],
        ['重命名', '', () => {
          const nn = prompt('新的场景名称：', name);
          if (!nn || !nn.trim() || nn.trim() === name) return;
          if (store.renameScene3DInLibrary(name, nn.trim())) {
            if (lab3DCurrentName() === name) lab3DRename(nn.trim());
            renderSceneNav(); toast('已重命名');
          } else toast('重命名失败：名称已存在或保存失败', 3000);
        }],
        ['复制', '', () => {
          let nn = `${name} 副本`; let i = 2;
          const all = store.loadScenes3D();
          while (all[nn]) nn = `${name} 副本 ${i++}`;
          if (store.saveScene3DToLibrary({ ...s, name: nn })) { renderSceneNav(); toast(`已复制为「${nn}」`); }
        }],
        ['导出', '', () => exportSceneData(s)],
        ['删除', 'danger', () => {
          if (!confirm(`删除 3D 场景「${name}」？此操作不可恢复。`)) return;
          store.deleteScene3DFromLibrary(name); renderSceneNav(); toast('3D 场景已删除');
        }],
      ],
    }));
  }
}

$('btnScenes').addEventListener('click', openSceneNav);
$('btnCloseNav').addEventListener('click', closeSceneNav);
document.querySelectorAll('.side-item').forEach((b) => b.addEventListener('click', () => setNavView(b.dataset.view)));
$('sceneSearch').addEventListener('input', () => {
  renderSceneCards($('sceneSearch').value.trim());
  if (FEATURE_3D) renderSceneCards3D($('sceneSearch').value.trim());
});
$('btnNewScene').addEventListener('click', () => { closeSceneNav(); newScene(); });
$('btnDuplicateScene').addEventListener('click', () => {
  let nn = `${sceneName} ${t('msg.copySuffix')}`; let i = 2;
  const all = store.loadScenes();
  while (all[nn]) nn = `${sceneName} ${t('msg.copySuffix')} ${i++}`;
  if (store.saveSceneToLibrary({ ...currentScene(), name: nn })) { renderSceneNav(); toast(t('msg.currentDuplicated', { name: nn })); }
});

/* ---------------- settings modal ---------------- */
/** Switch the solver backend (1.41): persist the choice, rebuild the
 *  world on the new solver and replay the current scene into it. */
function setEngineBackend(id) {
  if (id !== 'matter' && id !== 'native') return;
  try { localStorage.setItem('motionlab.backend', id); } catch { /* storage unavailable */ }
  if (world.core.backendId === id) return;
  const snap = currentScene();
  world = new PhysicsWorld(id);
  loadScene(snap);
  resetHistory();
  toast(t('msg.backendSwitched', { name: id === 'native' ? 'Native' : 'Matter.js' }));
}

function openSettings() {
  renderSettings($('settingsBody'), settings, {
    backendId: world.core.backendId,
    onEngineBackend(id) { setEngineBackend(id); },
    onUISetting(key, value) {
      settings[key] = value;
      scheduleAutosave();
    },
    onLanguage(code) { setLang(code); }, // ml-lang handler re-renders everything, settings included
    onShowLanding() { closeModal('modalSettings'); showLanding(); },
    onClearAll() {
      if (!confirm(t('msg.resetConfirm'))) return;
      // Reset the (hidden) 3D lab's in-memory scene FIRST, so nothing it
      // persists afterwards can resurrect pre-reset 3D data.
      lab3DLoadScene(defaultScene3D());
      store.resetAllData(); // scenes/settings only — the language choice is a device preference and stays
      closeModal('modalSettings');
      setRunning(false);
      loadScene(defaultScene()); // also restores default settings from the scene
      resetHistory();
      openSceneNav(); // home hub now shows the empty, first-run library
      toast(t('msg.resetDone'));
    },
  });
  openModal('modalSettings');
}
$('btnSettings').addEventListener('click', openSettings);
$('btnNavSettings').addEventListener('click', openSettings);
  // Guards: if a browser cache mix ever pairs this script with older markup,
  // missing optional buttons must not abort the rest of the chrome setup.
  const sidePF = $('btnSidePF');
  if (sidePF) sidePF.addEventListener('click', () => enterPFLab());
  stampDocsVersions();
  const btnReload = $('btnUpdateReload');
  if (btnReload) btnReload.addEventListener('click', () => location.reload());
  const btnDismiss = $('btnUpdateDismiss');
  if (btnDismiss) btnDismiss.addEventListener('click', () => {
    updateDismissedFor = updateAvailable;
    $('updateBar').hidden = true;
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });

/* ---------------- language switching ----------------
   setLang() (i18n.js) persists the choice, re-applies all static markup and
   fires 'ml-lang'; here we re-render every dynamic surface in the new
   language. (A factory reset does not touch the language choice — it is a
   device preference, not scene data.) */
function refreshAfterLangChange() {
  applyI18n();
  applyChromeLabels();
  panel.mode = null; panel.selectedId = null; panel.selectedFluidId = null; panel._sceneSig = null;
  refreshPanel();
  hintFor(tool);
  updateTransport();
  updateStatus();
  syncLangPicker();
  document.querySelectorAll('#landingPresets .chip').forEach((chip) => {
    const p = presetScenes().find((x) => x.key === chip.dataset.presetKey);
    if (p) chip.textContent = presetDisplayName(p);
  });
  if (!$('sceneNav').hidden) { renderSceneNav(); setNavView(navView); }
  if (!$('modalSettings').hidden) openSettings();
}
window.addEventListener('ml-lang', refreshAfterLangChange);

/* ---------------- toolbar wiring ---------------- */
/** Icon+text labels that depend on the language; re-run on language change. */
function applyChromeLabels() {
  updateVideoBtn();
  const logo = $('logo');
  if (logo) logo.title = t('tb.logoTitle');
  const nav = $('btnNavSettings'); if (nav) nav.innerHTML = `${icon('settings', 16)} ${t('tb.settings')}`;
  const save = $('btnSave'); if (save) save.innerHTML = `${icon('save', 17)} ${t('tb.save')}`;
  const scenes = $('btnScenes'); if (scenes) scenes.innerHTML = `${icon('folder', 17)} ${t('tb.projects')}`;
  const nw = $('btnNewScene'); if (nw) nw.innerHTML = `${icon('plus', 16)} ${t('tb.newScene')}`;
  const dup = $('btnDuplicateScene'); if (dup) dup.innerHTML = `${icon('copy', 16)} ${t('tb.dupScene')}`;
  updateReplayBtn();
  const rp = $('btnReplayPlay'); if (rp) rp.innerHTML = icon('play', 15);
}

function initChrome() {
  if (!FEATURE_3D) {
    const ms = document.querySelector('.mode-switch');
    if (ms) ms.style.display = 'none';
  }
  $('logo').innerHTML = icon('logo', 26);
  $('logo').style.cursor = 'pointer';
  $('logo').addEventListener('click', openSceneNav);
  $('btnUndo').innerHTML = icon('undo'); $('btnRedo').innerHTML = icon('redo');
  $('btnPause').innerHTML = icon('pause'); $('btnReset').innerHTML = icon('reset');
  $('btnStep').innerHTML = icon('step'); $('btnShot').innerHTML = icon('camera');
  $('btnSettings').innerHTML = icon('settings'); $('btnPanel').innerHTML = icon('panel');
  $('btnExport').innerHTML = icon('export'); $('btnImport').innerHTML = icon('import');
  $('btnShare').innerHTML = icon('share');
  $('btnZoomIn').innerHTML = icon('plus', 17); $('btnZoomOut').innerHTML = icon('minus', 17);
  applyChromeLabels();
  document.querySelectorAll('.modal-close').forEach((b) => { b.innerHTML = icon('close', 18); });
  document.querySelectorAll('.tool-btn').forEach((b) => {
    b.innerHTML = icon(TOOL_ICONS[b.dataset.tool], 21);
    b.addEventListener('click', () => setTool(b.dataset.tool));
  });
  $('btnPlay').addEventListener('click', () => toggleRun());
  $('btnPause').addEventListener('click', () => { if (playback) { playback.playing = false; updateReplayBar(); } else setRunning(false); });
  $('btnStep').addEventListener('click', () => {
    if (playback) { playback.playing = false; stepPlayback(1); updateReplayBar(); return; }
    setRunning(false);
    world.step(1000 / 60, settings.speed);
    const b = selectedBody();
    if (b) panel.refreshBody(liveOf(b));
  });
  $('btnReplay').addEventListener('click', () => { replayRec ? stopReplayRecording() : startReplayRecording(); });
  $('btnVideo').addEventListener('click', toggleVideoRecording);
  $('btnReplayPlay').addEventListener('click', () => { if (lastReplay) openPlayback(lastReplay); });
  $('btnShot').addEventListener('click', () => {
    renderer.draw(world, {
      selectedId, showGrid: settings.showGrid, showVectors: settings.showVectors,
      showTrails: settings.showTrails, preview: null, dragPoint: null, springPreview: null,
    });
    canvas.toBlob((blob) => {
      if (!blob) { toast(t('msg.shotFailed')); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(sceneName || 'motionlab').replace(/[\\/:*?"<>|]/g, '_')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(t('msg.shotOk'));
    }, 'image/png');
  });
  $('btnReset').addEventListener('click', resetScene);
  $('btnUndo').addEventListener('click', () => applyHistory(-1));
  $('btnRedo').addEventListener('click', () => applyHistory(1));
  $('btnSave').addEventListener('click', saveCurrent);
  $('btnPanel').addEventListener('click', () => {
    const p = $('panel');
    p.classList.toggle('hidden-panel');
    store.saveUISettings({ ...store.loadUISettings(), panelHidden: p.classList.contains('hidden-panel') });
    requestAnimationFrame(() => { renderer.resize(); });
  });
  $('btnExport').addEventListener('click', () => {
    sceneName = $('projectName').value.trim() || sceneName;
    const blob = new Blob([JSON.stringify(currentScene(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${sceneName.replace(/[\\/:*?"<>|]/g, '_')}.motionlab.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(t('msg.exportOk'));
  });
  $('btnImport').addEventListener('click', () => $('fileImport').click());
  $('btnShare').addEventListener('click', shareCurrentScene);
  // Home hub import entry: same file picker + loader as the lab's button,
  // so a scene can be imported without entering the lab first.
  $('btnImportHub').addEventListener('click', () => $('fileImport').click());
  $('fileImport').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    // Size cap first (1.39): never read or parse an oversized file.
    if (f.size > MAX_REPLAY_BYTES) { toast(t('msg.importTooLarge'), 4200); return; }
    try {
      const text = await f.text();
      const raw = JSON.parse(text);
      if (raw && raw.format === 'motionlab-replay') {
        const rv = validateReplay(raw);
        if (!rv.ok) { toast(t('msg.replayInvalid'), 4200); return; }
        lastReplay = rv.replay;
        updateReplayPlayBtn();
        openPlayback(rv.replay);
        toast(t('msg.replayImported', { name: rv.replay.sceneName }));
        return;
      }
      if (sceneJsonTooLarge(text)) { toast(t('msg.importTooLarge'), 4200); return; }
      const v = validateScene(raw);
      if (!v.ok) { toast(t('msg.importFailed', { err: v.errors.slice(0, 2).join(getLang() === 'en' ? '; ' : '；') }), 4200); return; }
      setRunning(false);
      loadScene(v.scene); resetHistory();
      closeSceneNav(); // imports started from the home hub land in the lab
      toast(t('msg.imported', { name: v.scene.name }));
    } catch { toast(t('msg.importNotJson'), 3600); }
  });
  $('projectName').addEventListener('change', () => {
    const nn = $('projectName').value.trim();
    if (appMode === '3d') {
      if (!nn) { $('projectName').value = lab3DCurrentName(); return; }
      const old = lab3DCurrentName();
      lab3DRename(nn);
      const lib3 = store.loadScenes3D();
      if (lib3[old]) store.renameScene3DInLibrary(old, nn);
      return;
    }
    if (!nn) { $('projectName').value = sceneName; return; }
    const old = sceneName;
    sceneName = nn;
    const lib = store.loadScenes();
    if (lib[old]) store.renameSceneInLibrary(old, nn);
    scheduleAutosave();
  });
  $('mode2d').addEventListener('click', () => setAppMode('2d'));
  $('mode3d').addEventListener('click', () => setAppMode('3d'));
  window.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (appMode === '3d') return; // 2D shortcuts stay in the 2D lab
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); applyHistory(e.shiftKey ? 1 : -1); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); applyHistory(1); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveCurrent(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); }
    else if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); toggleRun(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedId || selectedHingeId)) { deleteSelected(); }
    else if (e.key === 'Escape') { selectedId = null; selectedFluidId = null; selectedWindId = null; selectedEmitterId = null; selectedHingeId = null; staticDragId = null; springStart = null; springCur = null; hingeStart = null; hingeCur = null; refreshPanel(); }
    else if (selectedId && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const b = selectedBody(); if (!b) return;
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      world.setPosition(b, b.position.x + dx, b.position.y + dy);
      panel.refreshBody(liveOf(b));
      pushHistorySoon(); scheduleAutosave();
    }
    else if (selectedId && (e.key === 'r' || e.key === 'R')) {
      const b = selectedBody(); if (!b) return;
      world.setAngleDeg(b, b.angle * 180 / Math.PI + (e.shiftKey ? -15 : 15));
      panel.refreshBody(liveOf(b));
      pushHistorySoon(); scheduleAutosave();
    }
  });
  window.addEventListener('resize', () => renderer.resize());
  window.addEventListener('beforeunload', () => { try { store.saveAutosave(currentScene()); } catch {} });
}

/* ---------------- challenge mode (1.50) ---------------- */
let challenge = null;   // {def, phase, locked:Set, added:Set, steps, tracker, stars}
let chalDismissed = false; // user asked for scene settings instead of the card

function challengeVM() {
  const c = challenge;
  const lang = getLang();
  const best = store.loadChallengeProgress()[c.def.id];
  return {
    id: c.def.id,
    title: lang === 'en' ? c.def.title.en : c.def.title.zh,
    brief: lang === 'en' ? c.def.brief.en : c.def.brief.zh,
    phase: c.phase,
    budget: c.def.budget,
    budgetLeft: c.def.budget - c.added.size,
    statsText: `${fmtT(c.steps / 60)} / ${fmtT(c.def.timeSec)}`,
    stars: c.stars || 0,
    isLast: CHALLENGES[CHALLENGES.length - 1].id === c.def.id,
    bestText: best ? `★${best.stars} · ${best.bestPieces} · ${Number(best.bestSec).toFixed(1)}s` : '—',
  };
}

function enterChallenge(id) {
  const def = challengeById(id);
  if (!def) return;
  closeSceneNav();
  loadScene(def.build()); // exits any previous challenge / playback / recording
  resetHistory();
  challenge = {
    def, phase: 'build',
    locked: new Set(world.allBodies().map((b) => world.dataIdOf(b))),
    added: new Set(), steps: 0, tracker: new GoalTracker(def.holdSteps), stars: 0,
  };
  chalDismissed = false;
  setRunning(false);
  refreshPanel();
  updateChallengeHint();
  toast(t('chal.started', { name: getLang() === 'en' ? def.title.en : def.title.zh }));
}

function exitChallenge() {
  if (!challenge) return;
  challenge = null; chalDismissed = false;
  setRunning(false);
  refreshPanel();
  hintFor(tool);
  toast(t('chal.exited'));
}

function startChallengeRun() {
  if (!challenge || challenge.phase !== 'build') return;
  challenge.phase = 'run';
  challenge.steps = 0;
  challenge.tracker.reset();
  setRunning(true);
  refreshPanel();
  updateChallengeHint();
}

function restartChallenge() { if (challenge) enterChallenge(challenge.def.id); }

function nextChallenge() {
  if (!challenge) return;
  const i = CHALLENGES.findIndex((c) => c.id === challenge.def.id);
  if (i >= 0 && i < CHALLENGES.length - 1) enterChallenge(CHALLENGES[i + 1].id);
}

function winChallenge() {
  const c = challenge;
  c.phase = 'won';
  const sec = c.steps / 60;
  c.stars = starsFor(c.added.size, sec, c.def.par);
  store.saveChallengeResult(c.def.id, { stars: c.stars, pieces: c.added.size, sec: Math.round(sec * 10) / 10 });
  setRunning(false);
  const z = c.def.zone;
  blastFx = { x: z.x + z.w / 2, y: z.y + z.h / 2, radius: 130, startedAt: performance.now() };
  refreshPanel();
  updateChallengeHint();
  toast(t('chal.won'), 3000);
}

function failChallenge(fell) {
  if (!challenge) return;
  challenge.phase = 'lost';
  setRunning(false);
  refreshPanel();
  updateChallengeHint();
  toast(fell ? t('chal.fell') : t('chal.lost'), 3200);
}

/** One simulation step of goal evaluation (called from the main loop). */
function stepChallenge() {
  const c = challenge;
  c.steps++;
  const def = c.def;
  let inside = false;
  if (def.goalKind === 'target') {
    const b = world.bodyById(def.targetId);
    if (!b || b.position.y > (def.lostY || 700)) { failChallenge(true); return; }
    inside = pointInZone(b.position.x, b.position.y, def.zone);
  } else {
    for (const id of c.added) {
      const b = world.bodyById(id);
      if (b && pointInZone(b.position.x, b.position.y, def.zone)) { inside = true; break; }
    }
  }
  if (c.tracker.update(inside)) { winChallenge(); return; }
  if (c.steps >= def.timeSec * 60) { failChallenge(false); return; }
  if (c.steps % 60 === 0) updateChallengeHint();
}

function updateChallengeHint() {
  if (!challenge) return;
  const lang = getLang();
  const name = lang === 'en' ? challenge.def.title.en : challenge.def.title.zh;
  $('stageHint').textContent = lang === 'en'
    ? `Challenge · ${name} · pieces ${challenge.added.size}/${challenge.def.budget} · ${fmtT(challenge.steps / 60)} / ${fmtT(challenge.def.timeSec)}`
    : `挑战 · ${name} · 物体 ${challenge.added.size}/${challenge.def.budget} · ${fmtT(challenge.steps / 60)} / ${fmtT(challenge.def.timeSec)}`;
}

function challengeTargetPos() {
  if (!challenge || challenge.def.goalKind !== 'target') return null;
  const b = world.bodyById(challenge.def.targetId);
  return b ? { x: b.position.x, y: b.position.y, r: b.circleRadius || 18 } : null;
}

function toggleRun() {
  if (playback) { togglePlaybackPlay(); return; }
  if (challenge) {
    if (challenge.phase === 'build') { startChallengeRun(); return; }
    if (challenge.phase === 'run') { setRunning(!running); return; }
    toast(t('chal.needBuild'));
    return;
  }
  setRunning(!running);
}

/* ---------------- deterministic replay (1.50, replaces GIF) ----------------
 * Recording captures the engine snapshot plus every user input stamped
 * with its simulation step (see replay.js). Playback re-steps the same
 * snapshot with the same inputs and verifies the final state hash, so a
 * replay either reproduces the run exactly or says so honestly. */
let replayRec = null;        // active recording (replay.js object)
let recStartStep = 0;        // world step when the recording started
let dragRecActive = false;   // a physics drag is being recorded
let recLastDrag = null;      // last sampled drag target while recording
let lastReplay = null;       // most recent finished / imported replay
let playback = null;         // {data, step, playing, speed, acc, byStep, checkpoints, seekTarget}
const PB_CHECKPOINT_EVERY = 120; // steps between scrub checkpoints (1.52: was 300 — shorter worst-case seeks, ~90 max for a 3-minute replay)
let savedLiveScene = null;   // scene JSON restored when playback exits
let savedPlaybackBackend = null;
let pbWired = false;

const stepNow = () => Math.round(world.simTime / world.fixedDt);
const recStep = () => stepNow() - recStartStep;
const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function recEvent(type, data = {}) {
  if (!replayRec) return;
  if (!recordEvent(replayRec, recStep(), { type, ...data })) stopReplayRecording();
}
function recBodyProps(body) { if (replayRec && body) recEvent('bodyProps', { body: world.serializeBody(body) }); }
function recRegions() { if (replayRec) recEvent('regions', { fluids: world.fluids(), winds: world.winds(), emitters: world.emitters() }); }
function recSettings() { if (replayRec) recEvent('settings', { settings: { ...settings } }); }

function startReplayRecording() {
  if (playback) exitPlayback();
  replayRec = createRecording({
    backend: world.core.backendId, sceneName,
    initial: world.snapshot(), settings: { ...settings }, appVersion: APP_VERSION,
  });
  // Determinism anchor (1.54): reload the captured snapshot into the live
  // world, so the recorded run and every later playback start from the
  // SAME rebuilt state. A snapshot cannot carry solver warm-start state
  // (contact-pair impulses, sleep counters), so without this a recording
  // started mid-motion — the normal case: press record while the scene
  // is already running — diverged from its own replay (Newton's cradle,
  // warmed up 5 s, no inputs at all: >2 px after 21 s; with a drag,
  // >14 px). The reload is visually invisible: positions, velocities,
  // spin and sleep state all round-trip (engine 1.12.6).
  world.loadSnapshot(JSON.parse(JSON.stringify(replayRec.initial)));
  recStartStep = stepNow();
  dragRecActive = false; recLastDrag = null;
  updateReplayBtn();
  toast(t('msg.replayRecStart'), 3200);
}

function stopReplayRecording() {
  if (!replayRec) return;
  const rec = replayRec; replayRec = null;
  if (dragRecActive) dragRecActive = false;
  finalizeRecording(rec, recStep(), hashBodyStates(statesFromSnapshot(world.snapshot())));
  updateReplayBtn();
  if (rec.steps < 10) { toast(t('msg.replayTooShort')); return; }
  lastReplay = rec;
  updateReplayPlayBtn();
  const blob = new Blob([JSON.stringify(rec)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(sceneName || 'motionlab').replace(/[\\/:*?"<>|]/g, '_')}.replay.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(t('msg.replaySaved', { sec: (rec.steps / 60).toFixed(1) }), 3200);
}

function cancelReplayRecording() {
  if (!replayRec) return;
  replayRec = null; dragRecActive = false;
  updateReplayBtn();
  toast(t('msg.replayDiscarded'));
}

/* ---------------- canvas video recording (1.52) ----------------
   Real-time capture (MediaRecorder): MP4 where the platform offers
   it, WebM otherwise. Complements the deterministic replay — video
   is for sharing, replay is for exact reproduction. */
let videoRec = null; // { recorder, startedAt }

function updateVideoBtn() {
  const btn = $('btnVideo');
  if (!btn) return;
  if (videoRec) {
    btn.innerHTML = `${icon('stop', 15)}<span>${t('replay.stop')} ${fmtT((performance.now() - videoRec.startedAt) / 1000)}</span>`;
    btn.classList.add('recording');
  } else {
    btn.innerHTML = `${icon('camera', 15)}<span>${t('video.label')}</span>`;
    btn.classList.remove('recording');
  }
}

function toggleVideoRecording() {
  if (videoRec) { videoRec.recorder.stop(); return; }
  if (!videoSupported()) { toast(t('msg.videoUnsupported'), 3600); return; }
  const startedAt = performance.now();
  const recorder = createVideoRecorder(canvas, {
    onStop: (blob, ext) => {
      videoRec = null;
      updateVideoBtn();
      const sec = (performance.now() - startedAt) / 1000;
      if (sec < 0.6 || !blob.size) { toast(t('msg.videoTooShort')); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(sceneName || 'motionlab').replace(/[\\/:*?"<>|]/g, '_')}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(t('msg.videoSaved', { sec: sec.toFixed(1), fmt: ext.toUpperCase() }), 3200);
    },
  });
  if (!recorder) { toast(t('msg.videoUnsupported'), 3600); return; }
  videoRec = { recorder, startedAt };
  recorder.start();
  updateVideoBtn();
  toast(t('msg.videoStarted'), 2600);
}

function updateReplayBtn() {
  const btn = $('btnReplay');
  if (!btn) return;
  if (replayRec) {
    btn.innerHTML = `${icon('stop', 15)}<span>${t('replay.stop')} ${fmtT(recStep() / 60)}</span>`;
    btn.classList.add('recording');
  } else {
    btn.innerHTML = `${icon('record', 15)}<span>${t('replay.label')}</span>`;
    btn.classList.remove('recording');
  }
}

function updateReplayPlayBtn() {
  const btn = $('btnReplayPlay');
  if (btn) btn.hidden = !lastReplay;
}

/* ----- playback ----- */
function teardownPlayback() {
  playback = null; savedLiveScene = null; savedPlaybackBackend = null;
  const bar = $('replayBar'); if (bar) bar.hidden = true;
}

function exitPlayback() {
  if (!playback) return;
  const restore = savedLiveScene;
  const back = savedPlaybackBackend;
  world.endDrag();
  teardownPlayback();
  if (back && world.core.backendId !== back) world = new PhysicsWorld(back);
  if (restore) { try { loadScene(JSON.parse(restore)); } catch { /* keep current world */ } }
  refreshPanel();
}

function openPlayback(rec) {
  const v = validateReplay(rec);
  if (!v.ok) { toast(t('msg.replayInvalid'), 3600); return; }
  if (replayRec) cancelReplayRecording();
  if (!playback) {
    savedLiveScene = JSON.stringify(currentScene());
    savedPlaybackBackend = world.core.backendId;
  }
  setRunning(false);
  if (world.core.backendId !== v.replay.backend) world = new PhysicsWorld(v.replay.backend);
  if (v.replay.settings) {
    settings = { ...settings, ...v.replay.settings };
    world.applySettings(settings);
    updateStatus();
  }
  world.loadSnapshot(JSON.parse(JSON.stringify(v.replay.initial)));
  playback = {
    data: v.replay, step: 0, playing: false, speed: 1, acc: 0, seekTarget: null,
    byStep: eventsByStep(v.replay.events),
    checkpoints: new Map([[0, v.replay.initial]]),
  };
  wirePlaybackBar();
  $('replayBar').hidden = false;
  $('pbVerdict').textContent = '';
  $('pbVerdict').className = 'pb-verdict';
  updateReplayBar();
  refreshPanel();
}

function applyReplayEvent(ev) {
  switch (ev.type) {
    case 'add': world.addBody(bodyData(ev.body)); break;
    case 'remove': world.removeBody(ev.id); break;
    case 'addConstraint': world.addConstraint(constraintData(ev.constraint)); break;
    case 'removeConstraint': world.removeConstraint(ev.id); break;
    case 'addHinge': world.addHinge(hingeData(ev.hinge)); break;
    case 'removeHinge': world.removeHinge(ev.id); break;
    case 'hingeMotor': world.setHingeMotor(ev.id, ev.value); break;
    case 'settings':
      settings = { ...settings, ...ev.settings };
      world.applySettings(settings); updateStatus();
      break;
    case 'regions': {
      for (const f of world.fluids()) world.removeFluid(f.id);
      for (const w of world.winds()) world.removeWind(w.id);
      for (const f of ev.fluids || []) world.addFluid(fluidData(f));
      for (const w of ev.winds || []) world.addWind(windData(w));
      // Emitters joined the regions event in 1.56; recordings made
      // before that carry no emitters field and leave them untouched.
      if (Array.isArray(ev.emitters)) {
        for (const e of world.emitters()) world.removeEmitter(e.id);
        for (const e of ev.emitters) world.addEmitter(emitterData(e));
      }
      break;
    }
    case 'bodyProps': applyBodyProps(ev.body); break;
    case 'blast': world.applyRadialImpulse(ev.x, ev.y, { radius: ev.radius, base: 2, power: 13 }); break;
    case 'dragStart': { const b = world.bodyById(ev.id); if (b) world.beginDrag(b, ev.x, ev.y); break; }
    case 'drag': if (world.dragging) world.moveDrag(ev.x, ev.y); break;
    case 'dragEnd': world.endDrag(); break;
  }
}

function applyBodyProps(d) {
  if (!d || !d.id) return;
  const b = world.bodyById(d.id); if (!b) return;
  if (d.width !== undefined && d.height !== undefined) {
    const cur = world.serializeBody(b);
    if (cur.width !== d.width || cur.height !== d.height || cur.radius !== d.radius || cur.sides !== d.sides) {
      world.resize(b, { width: d.width, height: d.height, radius: d.radius, sides: d.sides });
    }
  }
  const nb = world.bodyById(d.id) || b;
  world.setPosition(nb, d.x, d.y);
  world.setAngleDeg(nb, (d.angle || 0) * 180 / Math.PI);
  world.setVelocity(nb, d.vx || 0, d.vy || 0);
  world.setDensity(nb, d.density); world.setFriction(nb, d.friction);
  world.setFrictionAir(nb, d.frictionAir); world.setRestitution(nb, d.restitution);
  world.setStatic(nb, !!d.isStatic); world.setLockRotation(nb, !!d.lockRotation);
  world.setMagnet(nb, d.magnet || 0);
  if (d.label !== undefined && (nb.label || '') !== d.label) world.renameBody(nb, d.label);
}

/** Advance the player by n recorded steps, applying inputs at their steps. */
function stepPlayback(n) {
  if (!playback) return;
  for (let i = 0; i < n && playback.step < playback.data.steps; i++) {
    const evs = playback.byStep.get(playback.step);
    if (evs) for (const ev of evs) applyReplayEvent(ev);
    world.stepOnce();
    playback.step++;
    if (playback.step % PB_CHECKPOINT_EVERY === 0) playback.checkpoints.set(playback.step, world.snapshot());
  }
  if (playback.step >= playback.data.steps) finishPlayback();
}

function advancePlayback(dt) {
  playback.acc += dt * playback.speed;
  let n = 0;
  while (playback.acc >= world.fixedDt && n < 8) {
    stepPlayback(1);
    playback.acc -= world.fixedDt;
    n++;
    if (!playback || !playback.playing) break;
  }
  updateReplayBar();
}

function finishPlayback() {
  if (!playback) return;
  playback.playing = false;
  const mine = hashBodyStates(statesFromSnapshot(world.snapshot()));
  const el = $('pbVerdict');
  if (playback.data.finalHash && mine === playback.data.finalHash) {
    el.textContent = t('replay.exact');
    el.className = 'pb-verdict ok';
  } else if (playback.data.finalHash) {
    el.textContent = t('replay.diverged');
    el.className = 'pb-verdict warn';
  }
  updateReplayBar();
}

function scrubPlayback(target) {
  if (!playback) return;
  // 1.52: seeking is ASYNCHRONOUS. The slider only records the target;
  // the frame loop restores a checkpoint if needed and then catches up
  // in budgeted slices (advanceSeek), rendering as it goes. The 1.50
  // version re-stepped synchronously on EVERY slider input event — on
  // an ~800-body replay that queued seconds of physics per event and
  // scrubbing collapsed to ~2 FPS (user report).
  playback.playing = false;
  playback.seekTarget = Math.max(0, Math.min(playback.data.steps, Math.floor(Number(target) || 0)));
  updateReplayBar();
}

function restoreCheckpoint(target) {
  let cp = 0;
  for (const k of playback.checkpoints.keys()) if (k <= target && k > cp) cp = k;
  world.endDrag();
  world.loadSnapshot(JSON.parse(JSON.stringify(playback.checkpoints.get(cp))));
  playback.step = cp;
}

/** Frame-loop seek service: at most ~16 ms of stepping per frame. */
function advanceSeek() {
  if (!playback || playback.seekTarget == null) return;
  const target = playback.seekTarget;
  if (target < playback.step) restoreCheckpoint(target);
  if (target > playback.step) {
    const t0 = performance.now();
    while (playback && playback.step < target) {
      stepPlayback(1);
      if (performance.now() - t0 >= 16) break;
    }
  }
  if (playback && playback.step >= target) playback.seekTarget = null;
  if (playback) updateReplayBar();
}

function togglePlaybackPlay() {
  if (!playback) return;
  if (playback.step >= playback.data.steps && !playback.playing) scrubPlayback(0);
  playback.playing = !playback.playing;
  updateReplayBar();
}

function updateReplayBar() {
  if (!playback) return;
  const seek = $('pbSeek');
  seek.max = playback.data.steps;
  if (document.activeElement !== seek) seek.value = playback.step;
  $('pbTime').textContent = `${fmtT(playback.step / 60)} / ${fmtT(playback.data.steps / 60)}`;
  $('btnPbPlay').innerHTML = icon(playback.playing ? 'pause' : 'play', 15);
}

function wirePlaybackBar() {
  if (pbWired) return;
  pbWired = true;
  $('btnPbPlay').addEventListener('click', togglePlaybackPlay);
  $('btnPbExit').addEventListener('click', exitPlayback);
  $('btnPbExit').innerHTML = t('replay.exit');
  $('pbSeek').addEventListener('input', (e) => scrubPlayback(Number(e.target.value)));
  $('pbSpeed').addEventListener('change', (e) => { if (playback) playback.speed = Number(e.target.value) || 1; });
}

/* ---------------- status + main loop ---------------- */
function updateStatus() {
  $('stCount').textContent = t('st.objects', { n: world.count });
  $('stGravity').textContent = (settings.gravityEnabled
    ? `Gravity (${settings.gravityX}, ${settings.gravityY})` : 'Gravity Off')
    + (Number(settings.gravitation) > 0 ? ` · ${t('st.gravitation', { g: settings.gravitation })}` : '')
    + (world.fluidCount ? ` · ${t('st.fluids', { n: world.fluidCount })}` : '')
    + (world.windCount ? ` · ${t('st.winds', { n: world.windCount })}` : '');
  $('stSpeed').textContent = `Speed ${settings.speed.toFixed(1)}×`;
}
setInterval(() => {
  updateStatus();
  const b = selectedBody();
  if (b) panel.refreshBody(liveOf(b));
  if (challenge && panel.mode === 'challenge') panel.updateChallengeStats(challengeVM());
}, 250);

let lastT = performance.now(), fpsFrames = 0, fpsT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = now - lastT; lastT = now;
  fpsFrames++;
  if (now - fpsT >= 500) {
    $('stFps').textContent = `FPS ${Math.round(fpsFrames * 1000 / (now - fpsT))}`;
    if (replayRec) updateReplayBtn();
    if (videoRec) { updateVideoBtn(); if (performance.now() - videoRec.startedAt > 60500) videoRec.recorder.stop(); }
    fpsFrames = 0; fpsT = now;
  }
  // Fixed-timestep accumulator lives in the engine core: stable physics at
  // any display refresh rate, with spiral-of-death protection built in.
  if (playback) {
    if (playback.seekTarget != null && playback.step !== playback.seekTarget) advanceSeek();
    else if (playback.playing) advancePlayback(dt);
  }
  else if (running) world.advance(dt, settings.speed);
  if (replayRec && recStep() >= MAX_REPLAY_STEPS) stopReplayRecording();
  if (challenge && running && challenge.phase === 'run') stepChallenge();
  const anchor = springAnchorWorld();
  const hAnchor = hingeAnchorWorld();
  renderer.draw(world, {
    selectedId,
    selectedFluidId,
    selectedWindId,
    selectedEmitterId,
    selectedHingeId,
    hinges: world.hingeAnchors(),
    showGrid: settings.showGrid,
    showVectors: settings.showVectors,
    showTrails: settings.showTrails,
    preview,
    dragPoint,
    springPreview: anchor && springCur ? { a: anchor, b: springCur }
      : hAnchor && hingeCur ? { a: hAnchor, b: hingeCur } : null,
    blast: blastFx && (now - blastFx.startedAt) < 400
      ? { x: blastFx.x, y: blastFx.y, radius: blastFx.radius, age: (now - blastFx.startedAt) / 1000 }
      : null,
    goalZone: challenge ? { ...challenge.def.zone, won: challenge.phase === 'won' } : null,
    goalTarget: challengeTargetPos(),
  });
  if (blastFx && now - blastFx.startedAt >= 400) blastFx = null;
}

/* ---------------- landing (first visit) ---------------- */
let landingDemo = null; // {running} while the landing demo loop is alive

function showLanding() {
  const el = $('landing');
  el.hidden = false;
  startLandingDemo();
}
function hideLanding() {
  $('landing').hidden = true;
  if (landingDemo) landingDemo.running = false;
  store.saveVisited();
}

function startLandingDemo() {
  if (landingDemo) { landingDemo.running = true; return; }
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = $('landingCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.clientWidth || 520, H = canvas.clientHeight || 420;
  canvas.width = W; canvas.height = H;
  const pe = new PhysicsEngine({ enableSleeping: false });
  pe.addBody({ kind: 'rect', x: W / 2, y: H - 8, width: W + 60, height: 16, isStatic: true, friction: 0.5 });
  pe.addBody({ kind: 'rect', x: W * 0.3, y: H * 0.58, width: W * 0.44, height: 12, angle: 0.16, isStatic: true, friction: 0.15 });
  // a hanging spring pair to show constraints at a glance
  const hang = pe.addBody({ kind: 'circle', x: W * 0.74, y: H * 0.42, radius: 17, restitution: 0.5, frictionAir: 0.004 });
  pe.addConstraint({ bodyA: null, bodyB: pe.idOf(hang), pointA: { x: W * 0.74, y: 26 }, stiffness: 0.02, damping: 0.02, length: 120 });
  let n = 0;
  const fills = ['#ffffff', '#eef4fa', '#f2f2f3'];
  function spawn() {
    pe.addBody({
      kind: n % 3 === 1 ? 'polygon' : (n % 2 ? 'rect' : 'circle'), sides: 6,
      x: 40 + Math.random() * (W * 0.5), y: -24, radius: 14 + Math.random() * 10,
      width: 26 + Math.random() * 18, height: 26 + Math.random() * 18,
      angle: Math.random(), restitution: 0.45, userData: { fill: fills[n % 3] },
    });
    n++;
    const dyn = pe.allBodies().filter((b) => !b.isStatic);
    if (dyn.length > 26) pe.removeBody(pe.idOf(dyn[0]));
  }
  for (let i = 0; i < 8; i++) setTimeout(() => { if (landingDemo && landingDemo.running) spawn(); }, i * 170);
  const spawner = setInterval(() => { if (landingDemo && landingDemo.running) spawn(); }, 2400);
  landingDemo = { running: true, spawner };
  let last = performance.now();
  (function frame(now) {
    if (!landingDemo) return;
    requestAnimationFrame(frame);
    if (!landingDemo.running) { last = now; return; }
    const dt = now - last; last = now;
    pe.advance(dt, 1);
    ctx.clearRect(0, 0, W, H);
    for (const seg of pe.constraintSegments()) {
      ctx.strokeStyle = '#6d7278'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(seg.a.x, seg.a.y); ctx.lineTo(seg.b.x, seg.b.y); ctx.stroke();
    }
    pe.forEachBody((b) => {
      const v = b.vertices;
      ctx.beginPath(); ctx.moveTo(v[0].x, v[0].y);
      for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
      ctx.closePath();
      ctx.fillStyle = b.isStatic ? '#e9e9ec' : (pe.userDataOf(b).fill || '#fff');
      ctx.fill();
      ctx.strokeStyle = b.isStatic ? '#9a9da3' : '#3c4046'; ctx.lineWidth = 1.2; ctx.stroke();
    });
  })(performance.now());
}

/** Mark the landing language-picker chip matching the current language. */
function syncLangPicker() {
  const en = $('btnLangEn'), zh = $('btnLangZh');
  if (en) en.classList.toggle('active', getLang() === 'en');
  if (zh) zh.classList.toggle('active', getLang() === 'zh');
}

function initLanding() {
  $('landingLogo').innerHTML = icon('logo', 30);
  const wrap = $('landingPresets');
  for (const p of presetScenes()) {
    const c = document.createElement('button');
    c.className = 'chip';
    c.dataset.presetKey = p.key;
    c.textContent = presetDisplayName(p);
    c.addEventListener('click', () => { hideLanding(); loadPreset(p); });
    wrap.appendChild(c);
  }
  $('btnStartLab').addEventListener('click', () => { hideLanding(); openSceneNav(); });
  // First visit defaults to English (i18n.js); the picker is the guide.
  const en = $('btnLangEn'), zh = $('btnLangZh');
  if (en) en.addEventListener('click', () => setLang('en'));
  if (zh) zh.addEventListener('click', () => setLang('zh'));
  syncLangPicker();
  if (!store.loadVisited()) showLanding();
}

/* ---------------- boot ---------------- */
function boot() {
  syncLangFromStorage(); // stored choice, else first-run default: English
  applyI18n(); // static markup in the resolved language
  initChrome();
  initLab3D({
    toast,
    syncName: (n) => { if (appMode === '3d') $('projectName').value = n; },
  });
  initLanding();
  renderer.resize();
  camera.fit(renderer.view);
  updateZoomLabel();
  if (store.loadUISettings().panelHidden) $('panel').classList.add('hidden-panel');
  const auto = store.loadAutosave();
  loadScene(auto || defaultScene());
  resetHistory();
  setTool('select');
  setRunning(false);
  updateStatus();
  requestAnimationFrame(loop);
  // The hub is the home page: returning users land here first, then step
  // into the lab. A share link (#s=...) outranks the hub: the visitor came
  // for that scene, so it opens directly in the lab instead.
  openSharedSceneFromHash().then((opened) => {
    if (opened) return;
    if (store.loadVisited()) openSceneNav();
    else if (auto) toast(t('msg.autosaveRestored'));
  });
  checkForUpdate();
}
boot();
