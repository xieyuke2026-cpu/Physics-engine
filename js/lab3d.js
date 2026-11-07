/* lab3d.js — the 3D lab controller: PhysicsWorld3D + view3d + panel/tools.
 * Self-contained: app.js only switches modes and routes home-card actions in.
 * 3D scenes live in their own storage (storage.js *3D functions). */

import { icon } from './icons.js';
import { PhysicsWorld3D } from './physics3d.js';
import { createView3D } from './view3d.js';
import {
  sceneData3D, bodyData3D, defaultScene3D, presetScenes3D, DEFAULT_SETTINGS_3D,
} from './scene3d.js';
import * as store from './storage.js';

const $ = (id) => document.getElementById(id);

let deps = { toast: () => {}, syncName: () => {} };
let world, view, canvas;
let active = false;
let running = false;
let rafId = 0;
let lastTs = 0;
let sceneName = 'Untitled 3D Scene';
let settings = { ...DEFAULT_SETTINGS_3D };
let initialScene = null;         // for Reset
let selectedId = null;
let tool = 'select';
let panelKey = '';               // rebuild panel when this changes
let autosaveTimer = 0;
let fpsFrames = 0, fpsTime = 0;
let liveTimer = 0;

const selectedBody = () => (selectedId ? world.bodyById(selectedId) : null);

function currentScene() {
  return world.serializeScene(sceneName, settings);
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => { if (active) store.saveAutosave3D(currentScene()); }, 700);
}

function loadScene(scene, { run = false } = {}) {
  const s = sceneData3D(JSON.parse(JSON.stringify(scene)));
  sceneName = s.name;
  settings = { ...DEFAULT_SETTINGS_3D, ...s.settings };
  world.loadScene(s);
  initialScene = s;
  selectedId = null;
  panelKey = '';
  setRunning(run);
  deps.syncName(sceneName);
  renderPanel(true);
  updateStatus();
  scheduleAutosave();
}

function setRunning(v) {
  running = v;
  $('btn3Play').classList.toggle('active', running);
  updateStatus();
}

function updateStatus() {
  $('st3Count').textContent = `物体 ${world.count}`;
  $('st3State').textContent = running ? '运行中' : '已暂停';
  $('st3State').style.color = running ? 'var(--ok)' : '';
  $('st3Gravity').textContent = settings.gravityEnabled
    ? `Gravity (${settings.gravityX}, ${settings.gravityY}, ${settings.gravityZ})` : 'Gravity Off';
  $('st3Speed').textContent = `Speed ${settings.speed.toFixed(1)}×`;
  $('st3Render').textContent = view.mode === 'webgl' ? '渲染 WebGL' : '渲染 线框（WebGL 不可用）';
}

/* ---------------- panel ---------------- */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function numRow(label, value, step, onChange) {
  const row = el('label', 'fld');
  row.appendChild(el('span', 'fld-label', label));
  const input = document.createElement('input');
  input.type = 'number'; input.value = String(Math.round(value * 1000) / 1000);
  input.step = String(step); input.className = 'fld-input';
  input.addEventListener('change', () => { const v = parseFloat(input.value); if (Number.isFinite(v)) onChange(v); });
  row.appendChild(input);
  return row;
}
function toggleRow(label, value, onChange) {
  const row = el('label', 'fld');
  row.appendChild(el('span', 'fld-label', label));
  const input = document.createElement('input');
  input.type = 'checkbox'; input.checked = !!value; input.className = 'fld-check';
  input.addEventListener('change', () => onChange(input.checked));
  row.appendChild(input);
  return row;
}
function sliderRow(label, value, min, max, step, fmt, onChange) {
  const row = el('div', 'fld');
  const lab = el('span', 'fld-label', `${label} `);
  const val = el('span', 'fld-val', fmt(value));
  lab.appendChild(val);
  row.appendChild(lab);
  const input = document.createElement('input');
  input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value; input.className = 'fld-range';
  input.addEventListener('input', () => { const v = parseFloat(input.value); val.textContent = fmt(v); onChange(v); });
  row.appendChild(input);
  return row;
}
function sectionTitle(text) {
  const d = el('div', 'panel-title');
  const dot = el('span', 'dot'); d.appendChild(dot); d.appendChild(document.createTextNode(text));
  return d;
}
function actionBtn(ic, text, fn, danger = false) {
  const b = el('button', 'btn' + (danger ? ' danger' : ''));
  b.innerHTML = `${icon(ic, 15)} ${text}`;
  b.addEventListener('click', fn);
  return b;
}

function renderPanel(force = false) {
  const key = selectedId || '__scene__';
  if (!force && key === panelKey) { updateLive(); return; }
  panelKey = key;
  const host = $('panel3dBody');
  host.innerHTML = '';
  const body = selectedBody();
  if (body) {
    const d = world.core.describeBody(body);
    host.appendChild(sectionTitle(d.kind === 'sphere' ? '球体 Sphere' : '方块 Box'));
    const pos = { x: d.x, y: d.y, z: d.z };
    const setPos = (axis) => (v) => { pos[axis] = v; world.core.setPosition(body, pos.x, pos.y, pos.z); scheduleAutosave(); };
    host.appendChild(numRow('位置 X', d.x, 0.1, setPos('x')));
    host.appendChild(numRow('位置 Y', d.y, 0.1, setPos('y')));
    host.appendChild(numRow('位置 Z', d.z, 0.1, setPos('z')));
    if (d.kind === 'sphere') {
      host.appendChild(numRow('半径', d.radius, 0.05, (v) => { selectedId = world.core.idOf(world.core.resize(body, { radius: Math.max(0.05, v) })); renderPanel(true); scheduleAutosave(); }));
    } else {
      const setSize = (axis) => (v) => { selectedId = world.core.idOf(world.core.resize(body, { [axis]: Math.max(0.05, v) })); renderPanel(true); scheduleAutosave(); };
      host.appendChild(numRow('尺寸 X', d.sizeX, 0.1, setSize('sizeX')));
      host.appendChild(numRow('尺寸 Y', d.sizeY, 0.1, setSize('sizeY')));
      host.appendChild(numRow('尺寸 Z', d.sizeZ, 0.1, setSize('sizeZ')));
    }
    host.appendChild(numRow('质量 kg', d.mass, 0.1, (v) => { if (!d.isStatic) { world.core.setMass(body, Math.max(0.01, v)); scheduleAutosave(); } }));
    const vel = { x: d.vx, y: d.vy, z: d.vz };
    const setVel = (axis) => (v) => { vel[axis] = v; world.core.setVelocity(body, vel.x, vel.y, vel.z); };
    host.appendChild(numRow('速度 X', d.vx, 0.1, setVel('x')));
    host.appendChild(numRow('速度 Y', d.vy, 0.1, setVel('y')));
    host.appendChild(numRow('速度 Z', d.vz, 0.1, setVel('z')));
    host.appendChild(toggleRow('静态（不受力）', d.isStatic, (v) => { world.core.setStatic(body, v); renderPanel(true); scheduleAutosave(); }));
    host.appendChild(toggleRow('锁定旋转', d.lockRotation, (v) => { world.core.setLockRotation(body, v); scheduleAutosave(); }));
    const live = el('div', 'live-box');
    live.id = 'live3d';
    host.appendChild(live);
    const acts = el('div', 'btn-row');
    acts.appendChild(actionBtn('stop', '停止运动', () => world.core.stopMotion(body)));
    acts.appendChild(actionBtn('copy', '复制', () => {
      const nd = world.serializeBody(body);
      delete nd.id;
      nd.x += 1.2; nd.y += 0.2;
      const nb = world.addBody(nd);
      selectedId = world.core.idOf(nb);
      renderPanel(true); scheduleAutosave(); updateStatus();
    }));
    acts.appendChild(actionBtn('trash', '删除', () => {
      world.removeBody(world.core.idOf(body));
      selectedId = null; renderPanel(true); scheduleAutosave(); updateStatus();
    }, true));
    host.appendChild(acts);
  } else {
    host.appendChild(sectionTitle('3D 场景 Scene'));
    host.appendChild(sliderRow('重力 Y', settings.gravityY, -20, 0, 0.1, (v) => v.toFixed(1), (v) => { settings.gravityY = v; world.applySettings(settings); updateStatus(); scheduleAutosave(); }));
    host.appendChild(toggleRow('重力开关', settings.gravityEnabled, (v) => { settings.gravityEnabled = v; world.applySettings(settings); updateStatus(); scheduleAutosave(); }));
    host.appendChild(sliderRow('模拟速度', settings.speed, 0.25, 2, 0.25, (v) => `${v.toFixed(2)}×`, (v) => { settings.speed = v; updateStatus(); scheduleAutosave(); }));
    host.appendChild(sliderRow('摩擦（全局）', settings.friction, 0, 1, 0.05, (v) => v.toFixed(2), (v) => { settings.friction = v; world.applySettings(settings); scheduleAutosave(); }));
    host.appendChild(sliderRow('弹性（全局）', settings.restitution, 0, 0.95, 0.05, (v) => v.toFixed(2), (v) => { settings.restitution = v; world.applySettings(settings); scheduleAutosave(); }));
    host.appendChild(sectionTitle('物体列表 Objects'));
    const list = el('div', 'obj-list');
    for (const b of world.allBodies()) {
      const d = world.core.describeBody(b);
      const item = el('button', 'obj-item');
      item.innerHTML = `${icon(d.kind === 'sphere' ? 'circle' : 'cube', 15)}<span></span>`;
      item.querySelector('span').textContent = d.label || d.kind;
      item.addEventListener('click', () => { selectedId = d.id; renderPanel(true); });
      list.appendChild(item);
    }
    host.appendChild(list);
    host.appendChild(sectionTitle('3D 实验预设'));
    const grid = el('div', 'btn-col');
    for (const p of presetScenes3D()) {
      const b = el('button', 'btn');
      b.textContent = p.name;
      b.addEventListener('click', () => { loadScene(p.scene, { run: true }); deps.toast(`已载入预设「${p.name}」`); });
      grid.appendChild(b);
    }
    host.appendChild(grid);
  }
  updateLive();
}

function updateLive() {
  const live = $('live3d');
  if (!live) return;
  const body = selectedBody();
  if (!body) return;
  const d = world.core.describeBody(body);
  live.textContent = `速率 ${d.speed.toFixed(2)} m/s · ${d.sleeping ? '休眠中' : '活动中'} · 质量 ${d.mass.toFixed(2)} kg`;
}

/* ---------------- pointer interaction ---------------- */
let ptrs = new Map();
let orbitDrag = null;   // {x, y, button}
let bodyDrag = null;    // {body, planeY? point, offset}
let pinch = null;       // {dist}

function groundPoint(e) {
  const ray = view.rayFromEvent(e);
  if (!ray || Math.abs(ray.dir.y) < 1e-4) return null;
  const t = -ray.origin.y / ray.dir.y;
  if (t < 0) return null;
  return { x: ray.origin.x + ray.dir.x * t, y: 0, z: ray.origin.z + ray.dir.z * t };
}
function planePoint(e, planePoint0, planeNormal) {
  const ray = view.rayFromEvent(e);
  if (!ray) return null;
  const denom = ray.dir.x * planeNormal.x + ray.dir.y * planeNormal.y + ray.dir.z * planeNormal.z;
  if (Math.abs(denom) < 1e-5) return null;
  const t = ((planePoint0.x - ray.origin.x) * planeNormal.x + (planePoint0.y - ray.origin.y) * planeNormal.y + (planePoint0.z - ray.origin.z) * planeNormal.z) / denom;
  if (t < 0) return null;
  return { x: ray.origin.x + ray.dir.x * t, y: ray.origin.y + ray.dir.y * t, z: ray.origin.z + ray.dir.z * t };
}
function camForward() {
  // forward = target - camera position, normalized (mirror of view basis)
  const sp = Math.sin(view.phi);
  return {
    x: -sp * Math.sin(view.theta),
    y: -Math.cos(view.phi),
    z: -sp * Math.cos(view.theta),
  };
}

function onPointerDown(e) {
  canvas.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
    orbitDrag = null; bodyDrag = null; world.core.endDrag();
    return;
  }
  const ray = view.rayFromEvent(e);
  const hit = ray ? world.pick(ray.origin, ray.dir) : null;
  if (tool === 'box' || tool === 'sphere') {
    const p = groundPoint(e) || { x: 0, y: 3, z: 0 };
    const data = tool === 'box'
      ? bodyData3D({ kind: 'box', x: p.x, y: 3.2, z: p.z, label: 'Box' })
      : bodyData3D({ kind: 'sphere', x: p.x, y: 3.2, z: p.z, radius: 0.55, label: 'Ball' });
    const b = world.addBody(data);
    selectedId = world.core.idOf(b);
    renderPanel(true); updateStatus(); scheduleAutosave();
    return;
  }
  if (hit && tool === 'delete') {
    if (!world.core.userDataOf(hit).isBound) {
      world.removeBody(world.core.idOf(hit));
      if (selectedId === world.core.idOf(hit)) selectedId = null;
      renderPanel(true); updateStatus(); scheduleAutosave();
    }
    return;
  }
  if (hit && tool === 'select' && !world.core.userDataOf(hit).isBound) {
    selectedId = world.core.idOf(hit);
    renderPanel(true);
    const hp = { x: hit.position.x, y: hit.position.y, z: hit.position.z };
    bodyDrag = { body: hit, plane: hp, normal: camForward() };
    const rayNow = view.rayFromEvent(e);
    const hitPoint = planePoint(e, hp, bodyDrag.normal) || hp;
    // drag from the body's centre projection to keep it stable
    world.core.beginDrag(hit, hitPoint);
    if (rayNow) { /* ray kept for symmetry */ }
    return;
  }
  if (hit) { selectedId = world.core.idOf(hit); renderPanel(true); }
  else if (tool === 'select' && e.button === 0) { selectedId = null; renderPanel(true); }
  orbitDrag = { x: e.clientX, y: e.clientY, button: e.button };
}
function onPointerMove(e) {
  if (!ptrs.has(e.pointerId)) return;
  const prev = ptrs.get(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch.dist > 0) view.dist = Math.min(60, Math.max(4, view.dist * (pinch.dist / d)));
    pinch.dist = d;
    return;
  }
  if (bodyDrag) {
    const p = planePoint(e, bodyDrag.plane, bodyDrag.normal);
    if (p) world.core.moveDrag(p);
    return;
  }
  if (orbitDrag) {
    const dx = e.clientX - orbitDrag.x, dy = e.clientY - orbitDrag.y;
    orbitDrag.x = e.clientX; orbitDrag.y = e.clientY;
    if (orbitDrag.button === 2 || e.shiftKey) {
      const s = view.dist * 0.0016;
      const sp = Math.sin(view.phi);
      const right = { x: Math.cos(view.theta), y: 0, z: -Math.sin(view.theta) };
      const upv = { x: -Math.cos(view.phi) * Math.sin(view.theta), y: Math.sin(view.phi), z: -Math.cos(view.phi) * Math.cos(view.theta) };
      view.target.x -= (right.x * -dx + upv.x * dy) * s;
      view.target.y -= (right.y * -dx + upv.y * dy) * s;
      view.target.z -= (right.z * -dx + upv.z * dy) * s;
      void sp;
    } else {
      view.theta -= dx * 0.005;
      view.phi = Math.min(1.5, Math.max(0.12, view.phi - dy * 0.005));
    }
  }
}
function onPointerUp(e) {
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (bodyDrag && ptrs.size === 0) { world.core.endDrag(); bodyDrag = null; scheduleAutosave(); }
  if (ptrs.size === 0) orbitDrag = null;
}
function onWheel(e) {
  e.preventDefault();
  view.dist = Math.min(60, Math.max(4, view.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
}

/* ---------------- main loop ---------------- */
function loop(ts) {
  if (!active) return;
  rafId = requestAnimationFrame(loop);
  const dt = Math.min(100, ts - (lastTs || ts));
  lastTs = ts;
  if (running) world.advance(dt, settings.speed);
  view.sync(world.viewBodies(), selectedId);
  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 500) {
    $('st3Fps').textContent = `FPS ${Math.round(fpsFrames * 1000 / fpsTime)}`;
    fpsFrames = 0; fpsTime = 0;
  }
  liveTimer += dt;
  if (liveTimer > 200) { liveTimer = 0; if (selectedId) updateLive(); }
}

/* ---------------- public API ---------------- */
export function initLab3D(d) {
  deps = d;
  world = new PhysicsWorld3D();
  canvas = $('world3d');
  view = createView3D(canvas);

  // chrome icons
  document.querySelectorAll('#toolrail3d .tool-btn').forEach((b) => {
    const t = b.dataset.t3;
    b.innerHTML = icon(t === 'box' ? 'cube' : t === 'sphere' ? 'circle' : t === 'delete' ? 'trash' : 'select', 20);
    b.classList.toggle('active', t === tool);
    b.addEventListener('click', () => {
      tool = t;
      document.querySelectorAll('#toolrail3d .tool-btn').forEach((x) => x.classList.toggle('active', x.dataset.t3 === t));
    });
  });
  $('btn3Play').innerHTML = icon('play', 18);
  $('btn3Pause').innerHTML = icon('pause', 18);
  $('btn3Step').innerHTML = icon('step', 18);
  $('btn3Reset').innerHTML = icon('reset', 18);
  $('btn3Save').innerHTML = `${icon('save', 16)} 保存 3D 场景`;
  $('btn3Cam').innerHTML = `${icon('camera', 16)} 重置视角`;
  $('btn3Play').addEventListener('click', () => setRunning(true));
  $('btn3Pause').addEventListener('click', () => setRunning(false));
  $('btn3Step').addEventListener('click', () => { setRunning(false); world.stepOnce(); });
  $('btn3Reset').addEventListener('click', () => { if (initialScene) loadScene(initialScene); deps.toast('3D 场景已重置'); });
  $('btn3Save').addEventListener('click', () => {
    if (store.saveScene3DToLibrary(currentScene())) deps.toast(`已保存到 3D 场景库「${sceneName}」`);
    else deps.toast('保存失败：浏览器存储不可用', 3000);
  });
  $('btn3Cam').addEventListener('click', () => view.resetCamera());

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const auto = store.loadAutosave3D();
  loadScene(auto || defaultScene3D());
  updateStatus();
}

export function setLab3DActive(v) {
  active = v;
  if (v) {
    view.resize();
    lastTs = 0;
    rafId = requestAnimationFrame(loop);
    renderPanel(true);
    updateStatus();
  } else {
    cancelAnimationFrame(rafId);
    setRunning(false);
    store.saveAutosave3D(currentScene());
  }
}

export function lab3DLoadScene(scene, opts) { loadScene(scene, opts); }
export function lab3DCurrentName() { return sceneName; }
export function lab3DRename(name) { sceneName = name; scheduleAutosave(); }
