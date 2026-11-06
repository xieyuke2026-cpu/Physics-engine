/* app.js — application glue: toolbar, tools, pointer interaction, history,
   scene management, status bar, boot/restore. Physics lives in physics.js,
   drawing in render.js, panel DOM in ui.js, persistence in storage.js. */

import { icon, TOOL_ICONS } from './icons.js';
import { sceneData, bodyData, constraintData, hingeData, fluidData, windData, validateScene, defaultScene, presetScenes, DEFAULT_SETTINGS, jitteredScene, MAX_SCENE_JSON_BYTES, sceneJsonTooLarge } from './scene.js';
import { Recorder } from './record.js';
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

const world = new PhysicsWorld();
const renderer = new Renderer(canvas);
const camera = renderer.camera;
const recorder = new Recorder(canvas); // GIF recording (1.28, record.js)

let settings = { ...DEFAULT_SETTINGS };
let sceneName = 'Untitled Scene';
let running = false;
let tool = 'select';
let selectedId = null;
let staticDragId = null; // body id armed for direct static dragging (panel toggle)
let selectedFluidId = null;
let selectedWindId = null;
let selectedHingeId = null;
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
  });
}

function loadScene(scene, { markInitial = true } = {}) {
  const s = sceneData(scene);
  sceneName = s.name;
  settings = { ...s.settings };
  $('projectName').value = sceneName;
  world.loadScene(s);
  selectedId = null;
  selectedFluidId = null;
  selectedWindId = null;
  selectedHingeId = null;
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
  selectedId = world.dataIdOf(b);
  selectedFluidId = null; selectedWindId = null; selectedHingeId = null;
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
    panel.refreshBody(liveOf(b));
    pushHistorySoon(); scheduleAutosave();
  },
  onSelectBody(id) {
    if (!world.bodyById(id)) return;
    selectedId = id;
    selectedFluidId = null;
    selectedWindId = null;
    selectedHingeId = null;
    refreshPanel();
  },
  onDeleteBody(id) {
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
    panel.selectedId = null; panel.mode = null; // force scene panel rebuild so values show
    refreshPanel(); updateStatus();
    pushHistorySoon(); scheduleAutosave();
  },
  onBodySize(key, value) {
    const b = selectedBody(); if (!b) return;
    const patch = { [key]: key === 'sides' ? Math.round(value) : value };
    const nb = world.resize(b, patch);
    selectedId = world.dataIdOf(nb);
    panel.selectedId = null; // force form rebuild with new size values
    refreshPanel();
    pushHistorySoon(); scheduleAutosave();
  },
  onSceneProp(key, value) {
    if (key === 'seed') value = Math.min(4294967295, Math.max(0, Math.floor(Number(value) || 0)));
    settings[key] = value;
    world.applySettings(settings);
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
    pushHistorySoon(); scheduleAutosave();
    toast(name ? t('msg.renamed', { name }) : t('msg.nameCleared'));
  },
  onAddFluid() {
    const f = world.addFluid(fluidData({}));
    selectedFluidId = f.id; selectedId = null; selectedWindId = null; selectedHingeId = null;
    refreshPanel(); pushHistorySoon(); scheduleAutosave();
    toast(t('msg.fluidAdded'));
  },
  onSelectFluid(id) {
    if (!world.fluidById(id)) return;
    selectedFluidId = id; selectedId = null; selectedWindId = null; selectedHingeId = null;
    refreshPanel();
  },
  onDeleteFluid(id) {
    world.removeFluid(id);
    if (selectedFluidId === id) selectedFluidId = null;
    refreshPanel(); pushHistorySoon(); scheduleAutosave();
    toast(t('msg.fluidDeleted'));
  },
  onFluidProp(id, key, value) {
    world.updateFluid(id, { [key]: value });
    pushHistorySoon(); scheduleAutosave();
  },
  onAddWind() {
    const w = world.addWind(windData({}));
    selectedWindId = w.id; selectedId = null; selectedFluidId = null; selectedHingeId = null;
    refreshPanel(); pushHistorySoon(); scheduleAutosave();
    toast(t('msg.windAdded'));
  },
  onSelectWind(id) {
    if (!world.windById(id)) return;
    selectedWindId = id; selectedId = null; selectedFluidId = null; selectedHingeId = null;
    refreshPanel();
  },
  onDeleteWind(id) {
    world.removeWind(id);
    if (selectedWindId === id) selectedWindId = null;
    refreshPanel(); pushHistorySoon(); scheduleAutosave();
    toast(t('msg.windDeleted'));
  },
  onWindProp(id, key, value) {
    world.updateWind(id, { [key]: value });
    pushHistorySoon(); scheduleAutosave();
  },
  onShowScene() { selectedFluidId = null; selectedWindId = null; selectedHingeId = null; refreshPanel(); },
  onHingeProp(id, key, value) {
    if (key === 'motorSpeed') world.setHingeMotor(id, value);
    pushHistorySoon(); scheduleAutosave();
  },
  onDeleteHinge(id) {
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
    panel.selectedId = null; panel.mode = null; // force form rebuild with new values
    refreshPanel();
    pushHistorySoon(); scheduleAutosave();
    toast(t('msg.materialSet', { name: m.label }));
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
  panel.showScene(settings, world.allBodies().map((x) => world.serializeBody(x)), world.fluids(), world.winds());
}

function deleteSelected() {
  if (selectedHingeId) {
    world.removeHinge(selectedHingeId);
    selectedHingeId = null;
    refreshPanel(); pushHistorySoon(); scheduleAutosave();
    toast(t('msg.hingeDeleted'));
    return;
  }
  if (!selectedId) return;
  world.removeBody(selectedId);
  selectedId = null;
  refreshPanel(); pushHistorySoon(); scheduleAutosave();
  toast(t('msg.bodyDeleted'));
}
function duplicateSelected() {
  const b = selectedBody(); if (!b) return;
  const d = world.serializeBody(b);
  d.id = undefined; // fresh id assigned by bodyData
  d.x += 28; d.y += 28; d.vx = 0; d.vy = 0;
  const nb = world.addBody(bodyData(d));
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
function setRunning(v) { running = v; if (!v) world.endDrag(); updateTransport(); }

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
  if (created) {
    selectedHingeId = created.id;
    selectedId = null; selectedFluidId = null; selectedWindId = null;
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
      world.removeHinge(hg.id);
      if (selectedHingeId === hg.id) selectedHingeId = null;
      refreshPanel(); pushHistorySoon(); scheduleAutosave();
      toast(t('msg.hingeDeleted'));
      return;
    }
    // springs next: tapping near a spring line removes the spring, not a body
    const seg = pickSpring(w.x, w.y);
    if (seg) {
      world.removeConstraint(seg.id);
      refreshPanel(); pushHistorySoon(); scheduleAutosave();
      toast(t('msg.springDeleted'));
      return;
    }
    const b = world.pick(w.x, w.y);
    if (b) {
      const id = world.dataIdOf(b);
      world.removeBody(id);
      if (selectedId === id) selectedId = null;
      refreshPanel(); pushHistorySoon(); scheduleAutosave();
      toast(t('msg.bodyDeleted'));
      return;
    }
    const wn = pickWind(w);
    if (wn) {
      world.removeWind(wn.id);
      if (selectedWindId === wn.id) selectedWindId = null;
      refreshPanel(); pushHistorySoon(); scheduleAutosave();
      toast(t('msg.windDeleted'));
      return;
    }
    const f = pickFluid(w);
    if (f) {
      world.removeFluid(f.id);
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
      selectedId = null; selectedFluidId = null; selectedWindId = null;
      refreshPanel();
      gesture = { kind: 'none' };
      return;
    }
  }
  const b = world.pick(w.x, w.y);
  if (b) {
    selectedId = world.dataIdOf(b);
    selectedFluidId = null;
    selectedWindId = null;
    selectedHingeId = null;
    refreshPanel();
    if (b.isStatic && staticDragId === selectedId) {
      gesture = { kind: 'drag-static', body: b, offX: w.x - b.position.x, offY: w.y - b.position.y, moved: false };
    } else if (!b.isStatic) {
      if (running) { world.beginDrag(b, w.x, w.y); dragPoint = { x: w.x, y: w.y, bodyX: b.position.x, bodyY: b.position.y }; }
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
      const wn = pickWind(w);
      const f = wn ? null : pickFluid(w);
      selectedId = null;
      selectedHingeId = null;
      selectedWindId = wn ? wn.id : null;
      selectedFluidId = f ? f.id : null;
      refreshPanel();
      const rec = wn || f;
      gesture = rec
        ? { kind: 'drag-region', regionType: wn ? 'wind' : 'fluid', rec, offX: w.x - rec.x, offY: w.y - rec.y, moved: false }
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
    else world.updateFluid(gesture.rec.id, { x: nx, y: ny });
    gesture.rec.x = nx; gesture.rec.y = ny; // local copy: keep the grab offset stable
  } else if (gesture.kind === 'drag-static') {
    gesture.moved = true;
    world.setPosition(gesture.body, Math.round(w.x - gesture.offX), Math.round(w.y - gesture.offY));
    panel.refreshBody(liveOf(gesture.body));
  } else if (gesture.kind === 'drag-body') {
    gesture.moved = true;
    if (running && world.dragging) { world.moveDrag(w.x, w.y); dragPoint = { x: w.x, y: w.y, bodyX: gesture.body.position.x, bodyY: gesture.body.position.y }; }
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
    panel.mode = null; // force the region editor to rebuild with the new centre
    refreshPanel(); pushHistorySoon(); scheduleAutosave();
  }
  if (gesture.kind === 'drag-body') {
    world.endDrag(); dragPoint = null;
    if (gesture.moved) { pushHistorySoon(); scheduleAutosave(); }
  }
  if (gesture.kind === 'drag-static' && gesture.moved) { pushHistorySoon(); scheduleAutosave(); }
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
  const b = world.addBody(d);
  selectedId = world.dataIdOf(b);
  selectedFluidId = null;
  setTool('select');
  refreshPanel(); pushHistorySoon(); scheduleAutosave();
  if (d.magnet) toast(t('msg.magnetAdded'));
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const before = toWorld(e);
  camera.zoom *= e.deltaY < 0 ? 1.1 : 0.9;
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
  $('navSectionCurrent').hidden = view !== 'overview';
  $('navSectionSaved').hidden = view === 'presets' || view === 'docs';
  $('navSectionSaved3D').hidden = view === 'presets' || view === 'docs';
  $('navSectionPresets').hidden = view === 'library' || view === 'docs';
  $('navSectionPresets3D').hidden = view === 'library' || view === 'docs';
  $('navSectionDocs').hidden = view !== 'docs';
  $('navToolbar').style.display = view === 'presets' || view === 'docs' ? 'none' : '';
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
function openSettings() {
  renderSettings($('settingsBody'), settings, {
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
  const logo = $('logo');
  if (logo) logo.title = t('tb.logoTitle');
  const nav = $('btnNavSettings'); if (nav) nav.innerHTML = `${icon('settings', 16)} ${t('tb.settings')}`;
  const save = $('btnSave'); if (save) save.innerHTML = `${icon('save', 17)} ${t('tb.save')}`;
  const scenes = $('btnScenes'); if (scenes) scenes.innerHTML = `${icon('folder', 17)} ${t('tb.projects')}`;
  const nw = $('btnNewScene'); if (nw) nw.innerHTML = `${icon('plus', 16)} ${t('tb.newScene')}`;
  const dup = $('btnDuplicateScene'); if (dup) dup.innerHTML = `${icon('copy', 16)} ${t('tb.dupScene')}`;
  updateRecBtn();
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
  $('btnPlay').addEventListener('click', () => setRunning(!running));
  $('btnPause').addEventListener('click', () => setRunning(false));
  $('btnStep').addEventListener('click', () => {
    setRunning(false);
    world.step(1000 / 60, settings.speed);
    const b = selectedBody();
    if (b) panel.refreshBody(liveOf(b));
  });
  recorder.onAutoStop = () => stopRecording();
  $('btnRecord').addEventListener('click', () => { recorder.recording ? stopRecording() : startRecording(); });
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
    if (f.size > MAX_SCENE_JSON_BYTES) { toast(t('msg.importTooLarge'), 4200); return; }
    try {
      const text = await f.text();
      if (sceneJsonTooLarge(text)) { toast(t('msg.importTooLarge'), 4200); return; }
      const raw = JSON.parse(text);
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
    else if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); setRunning(!running); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedId || selectedHingeId)) { deleteSelected(); }
    else if (e.key === 'Escape') { selectedId = null; selectedFluidId = null; selectedWindId = null; selectedHingeId = null; staticDragId = null; springStart = null; springCur = null; hingeStart = null; hingeCur = null; refreshPanel(); }
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

/* ---------------- GIF recording (1.28) ---------------- */
function startRecording() {
  recorder.start();
  updateRecBtn();
  toast(t('msg.recStart'));
}
async function stopRecording() {
  if (!recorder.recording && !recorder.frameCount) return;
  const frames = recorder.frameCount;
  const blob = await recorder.stop();
  updateRecBtn();
  if (!blob || !frames) { toast(t('msg.recEmpty')); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(sceneName || 'motionlab').replace(/[\\/:*?"<>|]/g, '_')}.gif`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(t('msg.recDone', { n: frames }));
}
function updateRecBtn() {
  const btn = $('btnRecord');
  if (!btn) return;
  if (recorder.recording) {
    const s = Math.floor(recorder.elapsed);
    btn.innerHTML = `${icon('stop', 15)}<span>${t('rec.stop')} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</span>`;
    btn.classList.add('recording');
  } else {
    btn.innerHTML = `${icon('record', 15)}<span>${t('rec.label')}</span>`;
    btn.classList.remove('recording');
  }
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
}, 250);

let lastT = performance.now(), fpsFrames = 0, fpsT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = now - lastT; lastT = now;
  fpsFrames++;
  if (now - fpsT >= 500) {
    $('stFps').textContent = `FPS ${Math.round(fpsFrames * 1000 / (now - fpsT))}`;
    if (recorder.recording) updateRecBtn();
    fpsFrames = 0; fpsT = now;
  }
  // Fixed-timestep accumulator lives in the engine core: stable physics at
  // any display refresh rate, with spiral-of-death protection built in.
  if (running) world.advance(dt, settings.speed);
  const anchor = springAnchorWorld();
  const hAnchor = hingeAnchorWorld();
  renderer.draw(world, {
    selectedId,
    selectedFluidId,
    selectedWindId,
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
  });
  if (blastFx && now - blastFx.startedAt >= 400) blastFx = null;
  if (recorder.recording) recorder.capture();
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
