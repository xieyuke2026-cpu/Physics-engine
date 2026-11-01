/* app.js — application glue: toolbar, tools, pointer interaction, history,
   scene management, status bar, boot/restore. Physics lives in physics.js,
   drawing in render.js, panel DOM in ui.js, persistence in storage.js. */

import { icon, TOOL_ICONS } from './icons.js';
import { sceneData, bodyData, constraintData, validateScene, defaultScene, presetScenes, DEFAULT_SETTINGS } from './scene.js';
import { PhysicsWorld } from './physics.js';
import { Renderer } from './render.js';
import { Panel, renderSettings } from './ui.js';
import * as store from './storage.js';

const $ = (id) => document.getElementById(id);
const canvas = $('world');

const world = new PhysicsWorld();
const renderer = new Renderer(canvas);
const camera = renderer.camera;

let settings = { ...DEFAULT_SETTINGS };
let sceneName = 'Untitled Scene';
let running = false;
let tool = 'select';
let selectedId = null;
let initialSnapshot = null;   // for Reset: state at load / last save
let preview = null;
let dragPoint = null;
let springStart = null;   // {bodyId|null, offset:{x,y}, point:{x,y}} first spring endpoint
let springCur = null;     // current pointer world pos while placing a spring

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
  });
}

function loadScene(scene, { markInitial = true } = {}) {
  const s = sceneData(scene);
  sceneName = s.name;
  settings = { ...s.settings };
  $('projectName').value = sceneName;
  world.loadScene(s);
  selectedId = null;
  springStart = null; springCur = null;
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
      case 'isStatic': world.setStatic(b, value); break;
      case 'lockRotation': world.setLockRotation(b, value); break;
    }
    panel.refreshBody(liveOf(b));
    pushHistorySoon(); scheduleAutosave();
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
    refreshPanel();
  },
  onDeleteBody(id) {
    world.removeBody(id);
    if (selectedId === id) selectedId = null;
    refreshPanel(); pushHistorySoon(); scheduleAutosave();
    toast('物体已删除');
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
    settings[key] = value;
    world.applySettings(settings);
    updateStatus();
    pushHistorySoon(); scheduleAutosave();
  },
  onDeleteSelected() { deleteSelected(); },
  onDuplicateSelected() { duplicateSelected(); },
  onSaveScene() { saveCurrent(); },
  onNewScene() { newScene(); },
});

function refreshPanel() {
  const b = selectedBody();
  if (b) panel.showBody(world.serializeBody(b), liveOf(b));
  else panel.showScene(settings, world.allBodies().map((x) => world.serializeBody(x)));
}

function deleteSelected() {
  if (!selectedId) return;
  world.removeBody(selectedId);
  selectedId = null;
  refreshPanel(); pushHistorySoon(); scheduleAutosave();
  toast('物体已删除');
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
  play.innerHTML = running ? `${icon('pause', 17)} 暂停` : `${icon('play', 17)} 运行`;
  play.classList.toggle('is-running', running);
  $('btnPause').disabled = !running;
  const st = $('stState');
  st.textContent = running ? '运行中 Running' : '已暂停 Paused';
  st.classList.toggle('running', running);
}
function setRunning(v) { running = v; if (!v) world.endDrag(); updateTransport(); }

/* ---------------- scene actions ---------------- */
function saveCurrent() {
  sceneName = $('projectName').value.trim() || 'Untitled Scene';
  const s = currentScene();
  if (store.saveSceneToLibrary(s)) {
    initialSnapshot = JSON.stringify(s);
    toast(`已保存场景「${sceneName}」`);
  } else toast('保存失败：localStorage 不可用或已满', 3200);
}
function newScene() {
  if (!confirm('新建场景？当前未保存的修改将保留在自动保存中，但不会写入场景库。')) return;
  setRunning(false);
  loadScene(defaultScene());
  resetHistory();
  toast('已新建场景');
}
function resetScene() {
  if (!initialSnapshot) return;
  setRunning(false);
  history.applying = true;
  loadScene(JSON.parse(initialSnapshot), { markInitial: false });
  history.applying = false;
  pushHistory();
  toast('场景已重置');
}

/* ---------------- pointer interaction ---------------- */
const pointers = new Map();
let gesture = null; // {kind:'create'|'drag-body'|'pan'|'pinch', ...}

function toWorld(e) {
  const r = canvas.getBoundingClientRect();
  return camera.screenToWorld(e.clientX - r.left, e.clientY - r.top, renderer.view);
}
function hintFor(t) {
  const hints = {
    select: '点选物体查看参数 · 拖拽物体移动 · 双击空白添加圆形',
    move: '拖拽物体移动 · 拖拽空白平移画布 · 滚轮 / 双指缩放',
    circle: '在画布上点按或拖拽画出圆形，松手创建',
    rectangle: '在画布上拖拽画出矩形，松手创建',
    polygon: '点按或拖拽确定半径，创建正六边形',
    triangle: '点按或拖拽确定大小，创建三角形',
    line: '拖拽画出静态线段（斜坡），松手创建',
    spring: springStart ? '再点第二个物体（或空白处作为固定锚点）完成弹簧' : '先点一个物体作为弹簧起点（点空白 = 固定锚点）',
    delete: '点按物体删除 · 点按弹簧线可删除弹簧',
  };
  $('stageHint').textContent = hints[t] || '';
}
function setTool(t) {
  tool = t;
  if (t !== 'spring') { springStart = null; springCur = null; }
  document.querySelectorAll('.tool-btn').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  hintFor(t);
  canvas.style.cursor = t === 'move' ? 'grab' : t === 'delete' ? 'not-allowed' : 'crosshair';
  if (t === 'select') canvas.style.cursor = 'default';
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
    toast(b ? '已选起点，再点第二个物体或空白锚点' : '已放置固定锚点，再点一个物体');
    return;
  }
  const start = springStart;
  springStart = null; springCur = null;
  hintFor('spring');
  if (b && start.bodyId && world.dataIdOf(b) === start.bodyId) { toast('弹簧两端不能是同一个物体'); return; }
  if (!b && !start.bodyId) { toast('弹簧至少一端要连接物体'); return; }
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
    toast('弹簧已创建');
  } else toast('弹簧创建失败');
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
  if (tool === 'circle' || tool === 'rectangle' || tool === 'polygon' || tool === 'triangle' || tool === 'line') {
    gesture = { kind: 'create', start: w, cur: w };
    updatePreview();
    return;
  }
  if (tool === 'spring') { handleSpringTap(w); return; }
  if (tool === 'delete') {
    // springs first: tapping near a spring line removes the spring, not a body
    const seg = pickSpring(w.x, w.y);
    if (seg) {
      world.removeConstraint(seg.id);
      refreshPanel(); pushHistorySoon(); scheduleAutosave();
      toast('弹簧已删除');
      return;
    }
    const b = world.pick(w.x, w.y);
    if (b) {
      const id = world.dataIdOf(b);
      world.removeBody(id);
      if (selectedId === id) selectedId = null;
      refreshPanel(); pushHistorySoon(); scheduleAutosave();
      toast('物体已删除');
    }
    return;
  }
  // select / move
  const b = world.pick(w.x, w.y);
  if (b) {
    selectedId = world.dataIdOf(b);
    refreshPanel();
    if (!b.isStatic) {
      if (running) { world.beginDrag(b, w.x, w.y); dragPoint = { x: w.x, y: w.y, bodyX: b.position.x, bodyY: b.position.y }; }
      gesture = { kind: 'drag-body', body: b, offX: w.x - b.position.x, offY: w.y - b.position.y, moved: false };
    } else if (tool === 'move') {
      gesture = { kind: 'pan', sx: e.clientX, sy: e.clientY, camX: camera.x, camY: camera.y };
    }
  } else {
    if (tool === 'move') {
      gesture = { kind: 'pan', sx: e.clientX, sy: e.clientY, camX: camera.x, camY: camera.y };
    } else {
      selectedId = null; refreshPanel();
      gesture = { kind: 'none' };
    }
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (tool === 'spring' && springStart) springCur = toWorld(e);
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
  else if (gesture.kind === 'drag-body') {
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
  if (gesture.kind === 'drag-body') {
    world.endDrag(); dragPoint = null;
    if (gesture.moved) { pushHistorySoon(); scheduleAutosave(); }
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
  if (tool === 'circle' || tool === 'polygon' || tool === 'triangle') preview = { kind: 'circle', x: s.x, y: s.y, r: Math.max(6, Math.hypot(dx, dy)) };
  else if (tool === 'line') preview = { kind: 'line', x1: s.x, y1: s.y, x2: c.x, y2: c.y };
  else preview = { kind: 'rectangle', x: (s.x + c.x) / 2, y: (s.y + c.y) / 2, w: Math.max(6, Math.abs(dx)), h: Math.max(6, Math.abs(dy)) };
}

function finalizeCreate() {
  const { start: s, cur: c } = gesture;
  const dx = c.x - s.x, dy = c.y - s.y;
  const dist = Math.hypot(dx, dy);
  let d = null;
  if (tool === 'circle') d = bodyData({ type: 'circle', x: s.x, y: s.y, radius: dist > 6 ? dist : 30, restitution: 0.4, label: 'Ball' });
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
  setTool('select');
  refreshPanel(); pushHistorySoon(); scheduleAutosave();
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

canvas.addEventListener('dblclick', (e) => {
  if (tool !== 'select' && tool !== 'move') return;
  const w = toWorld(e);
  if (world.pick(w.x, w.y)) return;
  const b = world.addBody(bodyData({ type: 'circle', x: w.x, y: w.y, radius: 28, restitution: 0.45, label: 'Ball' }));
  selectedId = world.dataIdOf(b);
  refreshPanel(); pushHistorySoon(); scheduleAutosave();
});

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

function renderSceneList() {
  const list = $('sceneList');
  list.innerHTML = '';
  const scenes = store.loadScenes();
  const names = Object.keys(scenes).sort((a, b) => (scenes[b].updatedAt || 0) - (scenes[a].updatedAt || 0));
  if (!names.length) {
    list.appendChild(Object.assign(document.createElement('p'), { className: 'empty-note', textContent: '暂无已保存场景。点击顶部「保存」将当前场景存入场景库。' }));
    return;
  }
  for (const name of names) {
    const s = scenes[name];
    const item = document.createElement('div');
    item.className = 'scene-item' + (name === sceneName ? ' current' : '');
    item.innerHTML = `<div class="scene-meta"><div class="scene-name"></div>
      <div class="scene-sub">${s.bodies.length} 个物体 · ${new Date(s.updatedAt || Date.now()).toLocaleString()}</div></div>`;
    item.querySelector('.scene-name').textContent = name;
    const mkBtn = (ic, titleText, fn) => {
      const b = document.createElement('button');
      b.className = 'tb-btn icon'; b.innerHTML = icon(ic, 18); b.title = titleText;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    item.appendChild(mkBtn('edit', '重命名', () => {
      const nn = prompt('新的场景名称：', name);
      if (!nn || !nn.trim() || nn.trim() === name) return;
      if (store.renameSceneInLibrary(name, nn.trim())) {
        if (sceneName === name) { sceneName = nn.trim(); $('projectName').value = sceneName; }
        renderSceneList(); toast('已重命名');
      } else toast('重命名失败：名称已存在或保存失败', 3000);
    }));
    item.appendChild(mkBtn('copy', '复制场景', () => {
      let nn = `${name} 副本`; let i = 2;
      const all = store.loadScenes();
      while (all[nn]) nn = `${name} 副本 ${i++}`;
      if (store.saveSceneToLibrary({ ...s, name: nn })) { renderSceneList(); toast(`已复制为「${nn}」`); }
    }));
    item.appendChild(mkBtn('trash', '删除场景', () => {
      if (!confirm(`删除场景「${name}」？此操作不可恢复。`)) return;
      store.deleteSceneFromLibrary(name); renderSceneList(); toast('场景已删除');
    }));
    item.addEventListener('click', () => {
      setRunning(false);
      loadScene(s); resetHistory(); closeModal('modalScenes');
      toast(`已加载场景「${name}」`);
    });
    list.appendChild(item);
  }
}
function renderPresetList() {
  const wrap = $('presetList');
  wrap.innerHTML = '';
  for (const p of presetScenes()) {
    const b = document.createElement('button');
    b.className = 'preset-btn';
    b.innerHTML = `${icon('layers', 17)}<span></span><span class="p-sub">${p.scene.bodies.length} 物体</span>`;
    b.querySelector('span').textContent = p.name;
    b.addEventListener('click', () => {
      loadScene(p.scene);
      resetHistory();
      closeModal('modalScenes');
      setRunning(true);
      toast(`已载入预设「${p.name}」，模拟运行中`);
    });
    wrap.appendChild(b);
  }
}
$('btnScenes').addEventListener('click', () => { renderPresetList(); renderSceneList(); openModal('modalScenes'); });
$('btnNewScene').addEventListener('click', () => { closeModal('modalScenes'); newScene(); });
$('btnDuplicateScene').addEventListener('click', () => {
  let nn = `${sceneName} 副本`; let i = 2;
  const all = store.loadScenes();
  while (all[nn]) nn = `${sceneName} 副本 ${i++}`;
  if (store.saveSceneToLibrary({ ...currentScene(), name: nn })) { renderSceneList(); toast(`当前场景已复制为「${nn}」`); }
});

/* ---------------- settings modal ---------------- */
$('btnSettings').addEventListener('click', () => {
  renderSettings($('settingsBody'), settings, {
    onUISetting(key, value) {
      settings[key] = value;
      scheduleAutosave();
    },
    onClearAll() {
      if (!confirm('清除 MotionLab 的全部本地数据（场景库、自动保存、设置）？')) return;
      try {
        localStorage.removeItem('motionlab.scenes.v1');
        localStorage.removeItem('motionlab.autosave.v1');
        localStorage.removeItem('motionlab.ui.v1');
      } catch {}
      closeModal('modalSettings');
      setRunning(false);
      loadScene(defaultScene()); resetHistory();
      toast('本地数据已清除');
    },
  });
  openModal('modalSettings');
});

/* ---------------- toolbar wiring ---------------- */
function initChrome() {
  $('logo').innerHTML = icon('logo', 26);
  $('btnUndo').innerHTML = icon('undo'); $('btnRedo').innerHTML = icon('redo');
  $('btnPause').innerHTML = icon('pause'); $('btnReset').innerHTML = icon('reset');
  $('btnStep').innerHTML = icon('step'); $('btnShot').innerHTML = icon('camera');
  $('btnSettings').innerHTML = icon('settings'); $('btnPanel').innerHTML = icon('panel');
  $('btnSave').innerHTML = `${icon('save', 17)} 保存`;
  $('btnExport').innerHTML = icon('export'); $('btnImport').innerHTML = icon('import');
  $('btnScenes').innerHTML = `${icon('folder', 17)} 场景`;
  $('btnZoomIn').innerHTML = icon('plus', 17); $('btnZoomOut').innerHTML = icon('minus', 17);
  $('btnNewScene').innerHTML = `${icon('plus', 16)} 新建场景`;
  $('btnDuplicateScene').innerHTML = `${icon('copy', 16)} 复制当前场景`;
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
  $('btnShot').addEventListener('click', () => {
    renderer.draw(world, {
      selectedId, showGrid: settings.showGrid, showVectors: settings.showVectors,
      showTrails: settings.showTrails, preview: null, dragPoint: null, springPreview: null,
    });
    canvas.toBlob((blob) => {
      if (!blob) { toast('截图失败'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(sceneName || 'motionlab').replace(/[\\/:*?"<>|]/g, '_')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('画布截图 PNG 已导出');
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
    toast('场景 JSON 已导出');
  });
  $('btnImport').addEventListener('click', () => $('fileImport').click());
  $('fileImport').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const text = await f.text();
      const raw = JSON.parse(text);
      const v = validateScene(raw);
      if (!v.ok) { toast(`导入失败：${v.errors.slice(0, 2).join('；')}`, 4200); return; }
      setRunning(false);
      loadScene(v.scene); resetHistory();
      toast(`已导入场景「${v.scene.name}」`);
    } catch { toast('导入失败：文件不是有效的 JSON', 3600); }
  });
  $('projectName').addEventListener('change', () => {
    const nn = $('projectName').value.trim();
    if (!nn) { $('projectName').value = sceneName; return; }
    const old = sceneName;
    sceneName = nn;
    const lib = store.loadScenes();
    if (lib[old]) store.renameSceneInLibrary(old, nn);
    scheduleAutosave();
  });
  window.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); applyHistory(e.shiftKey ? 1 : -1); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); applyHistory(1); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveCurrent(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); }
    else if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); setRunning(!running); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { deleteSelected(); }
    else if (e.key === 'Escape') { selectedId = null; springStart = null; springCur = null; refreshPanel(); }
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

/* ---------------- status + main loop ---------------- */
function updateStatus() {
  $('stCount').textContent = `物体 ${world.count}`;
  $('stGravity').textContent = settings.gravityEnabled
    ? `Gravity (${settings.gravityX}, ${settings.gravityY})` : 'Gravity Off';
  $('stSpeed').textContent = `Speed ${settings.speed.toFixed(1)}×`;
}
setInterval(() => {
  updateStatus();
  const b = selectedBody();
  if (b) panel.refreshBody(liveOf(b));
}, 250);

let lastT = performance.now(), fpsFrames = 0, fpsT = performance.now(), acc = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = now - lastT; lastT = now;
  fpsFrames++;
  if (now - fpsT >= 500) {
    $('stFps').textContent = `FPS ${Math.round(fpsFrames * 1000 / (now - fpsT))}`;
    fpsFrames = 0; fpsT = now;
  }
  if (running) {
    acc += Math.min(dt, 100);
    const stepMs = 1000 / 60;
    while (acc >= stepMs) { world.step(stepMs, settings.speed); acc -= stepMs; }
  } else acc = 0;
  const anchor = springAnchorWorld();
  renderer.draw(world, {
    selectedId,
    showGrid: settings.showGrid,
    showVectors: settings.showVectors,
    showTrails: settings.showTrails,
    preview,
    dragPoint,
    springPreview: anchor && springCur ? { a: anchor, b: springCur } : null,
  });
}

/* ---------------- boot ---------------- */
function boot() {
  initChrome();
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
  if (auto) toast('已恢复上次自动保存的场景');
}
boot();
