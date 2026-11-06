/* ui.js — right property panel + settings modal rendering.
   The panel is rebuilt only when the selection changes; live values
   (position / velocity while simulating) are patched in place. */

import { icon } from './icons.js';
import { VERSION as ENGINE_VERSION, BACKENDS as ENGINE_BACKENDS } from './engine/physics-engine.js';
import { PF_VERSION } from './pf/pf-config.js';
import { L, getLang } from './i18n.js';

/** MotionLab app version — the single source of truth for the app version. */
export const APP_VERSION = '1.40';

const fmt = (n, d = 2) => {
  const v = Number(n);
  return Number.isFinite(v) ? String(Math.round(v * 10 ** d) / 10 ** d) : '0';
};

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function numField(label, key, value, { step = 1, min, max } = {}) {
  const wrap = el(`<div class="field"><label>${label}</label>
    <input type="number" data-key="${key}" step="${step}"
      ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''} value="${fmt(value, 4)}"></div>`);
  return wrap;
}
function row(...fields) {
  const r = el('<div class="field-row"></div>');
  fields.forEach((f) => r.appendChild(f));
  return r;
}
function sliderField(label, key, value, min, max, step) {
  const wrap = el(`<div class="field"><label>${label}<span class="range-val" data-val>${fmt(value)}</span></label>
    <input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${value}"></div>`);
  return wrap;
}
function switchRow(label, key, checked) {
  return el(`<div class="switch-row"><span>${label}</span>
    <label class="switch"><input type="checkbox" data-key="${key}" ${checked ? 'checked' : ''}><i></i></label></div>`);
}
function title(text) { return el(`<div class="panel-title"><span class="dot"></span>${text}</div>`); }

function typeLabel(type) {
  const m = {
    circle: ['Circle · 圆形', 'Circle'], rectangle: ['Rectangle · 矩形', 'Rectangle'],
    polygon: ['Polygon · 多边形', 'Polygon'], line: ['Static Line · 静态线段', 'Static Line'],
  }[type];
  return m ? L(m[0], m[1]) : type;
}

export class Panel {
  /** cb: { onBodyProp(key,value), onBodySize(key,value), onSceneProp(key,value),
   *        onDeleteSelected(), onDuplicateSelected(), onSaveScene(), onNewScene(),
   *        onBodyAction(action), onSelectBody(id), onDeleteBody(id), onGravityPreset(key),
   *        onBodyRename(name), onAddFluid(), onSelectFluid(id), onDeleteFluid(id),
   *        onFluidProp(id,key,value), onAddWind(), onSelectWind(id), onDeleteWind(id),
   *        onWindProp(id,key,value), onShowScene(), onAddMagnet(), onMaterialPreset(key),
   *        onHingeProp(id,key,value), onDeleteHinge(id) } */
  constructor(root, cb) {
    this.root = root;
    this.cb = cb;
    this.mode = null;       // 'body' | 'scene' | 'fluid' | 'wind' | 'hinge'
    this.selectedId = null;
    this.selectedHingeId = null;
    this.staticDragId = null; // body id with static-drag armed (set by the app)
    this.inputs = new Map();
    this.ro = {};
  }

  _collectInputs() {
    this.inputs.clear();
    this.root.querySelectorAll('[data-key]').forEach((n) => this.inputs.set(n.dataset.key, n));
  }

  _wireNumbers(scope, handler) {
    scope.querySelectorAll('input[type=number][data-key]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const v = Number(inp.value);
        if (Number.isFinite(v)) handler(inp.dataset.key, v);
      });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    });
    scope.querySelectorAll('input[type=range][data-key]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const valEl = inp.closest('.field')?.querySelector('[data-val]');
        if (valEl) valEl.textContent = fmt(Number(inp.value));
        handler(inp.dataset.key, Number(inp.value));
      });
    });
    scope.querySelectorAll('input[type=checkbox][data-key]').forEach((inp) => {
      inp.addEventListener('change', () => handler(inp.dataset.key, inp.checked));
    });
  }

  showScene(settings, bodies, fluids, winds) {
    const list = Array.isArray(bodies) ? bodies : [];
    const flist = Array.isArray(fluids) ? fluids : [];
    const wlist = Array.isArray(winds) ? winds : [];
    const sig = list.map((b) => b.id).join(',') + '|' + flist.map((f) => `${f.id}:${f.density}`).join(',') + '|' + wlist.map((w) => `${w.id}:${w.vx},${w.vy}`).join(',') + '|seed:' + (settings.seed ?? '');
    if (this.mode === 'scene' && this.root.childElementCount && this._sceneSig === sig) { this.refreshScene(settings, list.length); return; }
    this._sceneSig = sig;
    this.mode = 'scene'; this.selectedId = null; this.selectedFluidId = null; this.selectedWindId = null; this.selectedHingeId = null;
    const r = this.root; r.innerHTML = '';
    r.appendChild(title(L('场景属性 Scene', 'Scene Properties')));
    const ro = el(`<div class="readonly-grid"><span>${L('物体数量', 'Bodies')}</span><b data-ro="count">${list.length}</b>
      <span>${L('引擎', 'Engine')}</span><b>Matter.js</b><span>${L('格式', 'Format')}</span><b>motionlab-scene v2</b></div>`);
    r.appendChild(ro);
    r.appendChild(title(L('重力与模拟', 'Gravity & Simulation')));
    const chips = el('<div class="chip-row"></div>');
    const chipDefs = [
      ['moon', L('月球 0.17g', 'Moon 0.17g')], ['earth', L('地球 1g', 'Earth 1g')], ['jupiter', L('木星 2.5g', 'Jupiter 2.5g')], ['zero', L('零重力', 'Zero gravity')], ['side', L('侧向重力', 'Sideways gravity')],
    ];
    for (const [key, label] of chipDefs) {
      const c = el(`<button class="chip">${label}</button>`);
      c.addEventListener('click', () => this.cb.onGravityPreset(key));
      chips.appendChild(c);
    }
    r.appendChild(chips);
    const gx = numField('Gravity X', 'gravityX', settings.gravityX, { step: 0.1, min: -3, max: 3 });
    const gy = numField('Gravity Y', 'gravityY', settings.gravityY, { step: 0.1, min: -3, max: 3 });
    r.appendChild(row(gx, gy));
    r.appendChild(sliderField('Simulation Speed', 'speed', settings.speed, 0.1, 2, 0.1));
    r.appendChild(switchRow(L('启用重力 Enable Gravity', 'Enable Gravity'), 'gravityEnabled', settings.gravityEnabled));
    r.appendChild(title(L('随机种子 Random Seed', 'Random Seed')));
    r.appendChild(el(`<p class="empty-note">${L('种子决定场景的随机走向：「刷新种子」会立刻按新种子重演场景——动态物体的起始位置按种子重新微偏（钉板换种子，落点分布就变）；同一个种子重演，结果一模一样。种子会随场景一起保存和分享。', 'The seed drives the scene’s random outcomes: Refresh Seed immediately replays the scene under the new seed — dynamic bodies’ starting positions are re-jittered from the seed (a new seed changes where the Galton balls land); the same seed replays identically. The seed is saved and shared with the scene.')}</p>`));
    r.appendChild(numField(L('种子 Seed', 'Seed'), 'seed', settings.seed ?? 1, { step: 1, min: 0, max: 4294967295 }));
    const seedRow = el('<div class="field-row"></div>');
    const btnSeed = el(`<button class="btn block" data-refresh-seed>${L('刷新种子', 'Refresh Seed')}</button>`);
    btnSeed.addEventListener('click', () => this.cb.onRefreshSeed());
    const btnJitter = el(`<button class="btn block" data-jitter>${L('随机扰动', 'Random Jitter')}</button>`);
    btnJitter.addEventListener('click', () => this.cb.onRandomJitter());
    const btnReplay = el(`<button class="btn block" data-seed-replay>${L('按种子重演', 'Seeded Replay')}</button>`);
    btnReplay.addEventListener('click', () => this.cb.onSeedReplay());
    seedRow.appendChild(btnSeed); seedRow.appendChild(btnReplay); seedRow.appendChild(btnJitter);
    r.appendChild(seedRow);
    r.appendChild(title(L('世界效应 · 引力、浮力与风场', 'World Effects · Gravitation, Fluids & Wind')));
    r.appendChild(el(`<p class="empty-note">${L('万有引力让所有物体两两相吸（牛顿公式，连地面和墙壁也会参与），适合行星轨道类实验；建议同时关掉上面的普通重力，或直接载入「万有引力轨道」预设。G = 0 即关闭。', 'Pairwise gravitation pulls every body toward every other (Newton\'s law — floors and walls join in), ideal for planetary orbits. Turn regular gravity off above, or load the "Orbital Gravitation" preset. G = 0 disables it.')}</p>`));
    r.appendChild(sliderField(L('万有引力 Gravitation G', 'Gravitation G'), 'gravitation', settings.gravitation || 0, 0, 60, 1));
    r.appendChild(row(
      numField(L('引力强度 G', 'Gravitation G'), 'gravitation', settings.gravitation || 0, { step: 1, min: 0, max: 500 }),
      numField(L('软化 Softening', 'Softening'), 'gravitationSoftening', settings.gravitationSoftening ?? 100, { step: 10, min: 0, max: 2000 }),
    ));
    r.appendChild(el(`<p class="empty-note">${L('流体区域提供浮力：密度比流体小的物体浮起、大的沉底。点「添加」放一个默认水池，再点选蓝色区域编辑它的密度与范围；区域在画布上可以直接拖动改位置。', 'Fluid regions provide buoyancy: bodies less dense than the fluid float, denser ones sink. Add a default pool, then click the blue region to edit its density and size — and drag regions on the canvas to move them.')}</p>`));
    const addFluid = el(`<button class="btn block">${icon('plus', 16)}${L(' 添加流体区域（浮力）', ' Add Fluid Region (Buoyancy)')}</button>`);
    addFluid.addEventListener('click', () => this.cb.onAddFluid());
    r.appendChild(addFluid);
    if (flist.length) {
      const fwrap = el('<div class="obj-list"></div>');
      flist.forEach((f, i) => {
        const rowEl = el(`<button class="obj-row"><span class="o-name">${L(`流体 ${i + 1}`, `Fluid ${i + 1}`)}</span><span class="o-type">${L(`密度 ${f.density}`, `density ${f.density}`)} · ${Math.round(f.width)}×${Math.round(f.height)}</span></button>`);
        rowEl.addEventListener('click', () => this.cb.onSelectFluid(f.id));
        const del = el(`<span class="tb-btn icon o-del">${icon('trash', 16)}</span>`);
        del.addEventListener('click', (e) => { e.stopPropagation(); this.cb.onDeleteFluid(f.id); });
        rowEl.appendChild(del);
        fwrap.appendChild(rowEl);
      });
      r.appendChild(fwrap);
    }
    r.appendChild(el(`<p class="empty-note">${L('风场区域是一块带方向的空气：区域内的物体被吹向风速的方向，越轻吹得越快，密实铁块几乎不动。点「添加」放一块默认向右吹的风场，再点选区域编辑风向与范围；区域在画布上可以直接拖动改位置。', 'A wind region is a block of moving air: bodies inside are blown toward the wind velocity — lighter bodies go faster, dense iron barely stirs. Add a default rightward field, then click the region to edit its direction and size — regions can be dragged on the canvas to move them.')}</p>`));
    const addWind = el(`<button class="btn block">${icon('plus', 16)}${L(' 添加风场区域（风）', ' Add Wind Region')}</button>`);
    addWind.addEventListener('click', () => this.cb.onAddWind());
    r.appendChild(addWind);
    if (wlist.length) {
      const wwrap = el('<div class="obj-list"></div>');
      wlist.forEach((w, i) => {
        const rowEl = el(`<button class="obj-row"><span class="o-name">${L(`风场 ${i + 1}`, `Wind ${i + 1}`)}</span><span class="o-type">${L(`风速 (${w.vx}, ${w.vy})`, `wind (${w.vx}, ${w.vy})`)} · ${Math.round(w.width)}×${Math.round(w.height)}</span></button>`);
        rowEl.addEventListener('click', () => this.cb.onSelectWind(w.id));
        const del = el(`<span class="tb-btn icon o-del">${icon('trash', 16)}</span>`);
        del.addEventListener('click', (e) => { e.stopPropagation(); this.cb.onDeleteWind(w.id); });
        rowEl.appendChild(del);
        wwrap.appendChild(rowEl);
      });
      r.appendChild(wwrap);
    }
    r.appendChild(el(`<p class="empty-note">${L('磁铁是一个固定不动的圆：自带磁极，会吸住或推开附近的磁性物体与铁质物体。点「添加」在画布中心放一个 N 极磁铁（+100），选中后在它的「材质」一节改磁性数值就能换成 S 极；左侧工具栏的磁铁工具也可以直接在画布上放。', 'A magnet is a fixed circle with a pole: it attracts or repels nearby magnetic and iron bodies. Add one at the canvas centre (N pole, +100), then select it and change the Magnetism value in its Material section to flip it to S — or place magnets directly with the Magnet tool in the left rail.')}</p>`));
    const addMagnet = el(`<button class="btn block">${icon('magnet', 16)}${L(' 添加磁铁（N 极）', ' Add Magnet (N pole)')}</button>`);
    addMagnet.addEventListener('click', () => this.cb.onAddMagnet());
    r.appendChild(addMagnet);
    r.appendChild(title(L('显示', 'Display')));
    r.appendChild(switchRow(L('显示网格 Grid', 'Show Grid'), 'showGrid', settings.showGrid));
    r.appendChild(switchRow(L('速度向量 Vectors', 'Show Vectors'), 'showVectors', settings.showVectors));
    r.appendChild(switchRow(L('运动轨迹 Trails', 'Show Trails'), 'showTrails', settings.showTrails));
    const save = el(`<button class="btn accent block">${icon('save', 16)}${L(' 保存场景', ' Save Scene')}</button>`);
    save.addEventListener('click', () => this.cb.onSaveScene());
    const nw = el(`<button class="btn block">${icon('plus', 16)}${L(' 新建场景', ' New Scene')}</button>`);
    nw.addEventListener('click', () => this.cb.onNewScene());
    r.appendChild(save); r.appendChild(nw);
    if (list.length) {
      r.appendChild(title(L('物体列表 Objects', 'Objects')));
      const wrap = el('<div class="obj-list"></div>');
      for (const b of list) {
        const rowEl = el(`<button class="obj-row"><span class="o-name"></span><span class="o-type"></span></button>`);
        rowEl.querySelector('.o-name').textContent = b.label || b.type;
        rowEl.querySelector('.o-type').textContent = b.type + (b.isStatic ? L(' · 静态', ' · static') : '');
        rowEl.addEventListener('click', () => this.cb.onSelectBody(b.id));
        const del = el(`<span class="tb-btn icon o-del">${icon('trash', 16)}</span>`);
        del.addEventListener('click', (e) => { e.stopPropagation(); this.cb.onDeleteBody(b.id); });
        rowEl.appendChild(del);
        wrap.appendChild(rowEl);
      }
      r.appendChild(wrap);
    }
    r.appendChild(el(`<p class="empty-note">${L('在画布上点选一个物体，这里会显示它的物理参数；点选流体/风场区域可编辑区域参数，在物体的「名称」框里还能给它改名。', 'Click a body on the canvas to see its physics parameters here; click a fluid or wind region to edit it, and rename bodies in the Name field of their panel.')}</p>`));
    this._wireNumbers(r, (k, v) => this.cb.onSceneProp(k, v));
    this._collectInputs();
  }

  refreshScene(settings, bodyCount) {
    const c = this.root.querySelector('[data-ro="count"]');
    if (c) c.textContent = String(bodyCount);
    this._setIfIdle('gravityX', settings.gravityX); this._setIfIdle('gravityY', settings.gravityY);
    this._setIfIdle('speed', settings.speed);
  }

  showBody(data, live) {
    const sameTarget = this.mode === 'body' && this.selectedId === data.id;
    if (sameTarget) { this.refreshBody(live); return; }
    this.mode = 'body'; this.selectedId = data.id; this.selectedFluidId = null; this.selectedWindId = null; this.selectedHingeId = null;
    const r = this.root; r.innerHTML = '';
    r.appendChild(title(L('物体属性 Object', 'Object Properties')));
    const head = el(`<div class="readonly-grid"><span>${L('类型 Type', 'Type')}</span><b>${typeLabel(data.type)}</b>
      <span>ID</span><b>${data.id.split('-').slice(0, 2).join('-')}</b></div>`);
    r.appendChild(head);
    const nameField = el(`<div class="field"><label>${L('名称 Name（可重命名，改完按回车）', 'Name (rename — press Enter to apply)')}</label><input type="text" data-name-input maxlength="60" spellcheck="false"></div>`);
    const nameInput = nameField.querySelector('input');
    nameInput.value = data.label || '';
    nameInput.addEventListener('change', () => this.cb.onBodyRename(nameInput.value.trim()));
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); e.stopPropagation(); });
    r.appendChild(nameField);
    r.appendChild(title(L('位置与尺寸', 'Position & Size')));
    r.appendChild(row(
      numField('Position X', 'x', live.x, { step: 1 }),
      numField('Position Y', 'y', live.y, { step: 1 }),
    ));
    if (data.type === 'circle') {
      r.appendChild(numField(L('Radius 半径', 'Radius'), 'radius', data.radius, { step: 1, min: 4, max: 600 }));
    } else if (data.type === 'polygon') {
      r.appendChild(row(
        numField(L('Radius 半径', 'Radius'), 'radius', data.radius, { step: 1, min: 6, max: 600 }),
        numField(L('Sides 边数', 'Sides'), 'sides', data.sides, { step: 1, min: 3, max: 12 }),
      ));
    } else if (data.type === 'line') {
      r.appendChild(row(
        numField(L('Length 长度', 'Length'), 'width', data.width, { step: 1, min: 10, max: 2400 }),
        numField(L('Thickness 粗细', 'Thickness'), 'height', data.height, { step: 1, min: 4, max: 10 }),
      ));
    } else {
      r.appendChild(row(
        numField(L('Width 宽度', 'Width'), 'width', data.width, { step: 1, min: 4, max: 2400 }),
        numField(L('Height 高度', 'Height'), 'height', data.height, { step: 1, min: 4, max: 2400 }),
      ));
    }
    r.appendChild(row(
      numField(L('Angle 角度 (°)', 'Angle (°)'), 'angleDeg', live.angleDeg, { step: 1 }),
      numField('Velocity X', 'vx', live.vx, { step: 0.5 }),
    ));
    r.appendChild(row(
      numField(L('Mass 质量', 'Mass'), 'mass', live.mass, { step: 0.1, min: 0.01 }),
      numField('Velocity Y', 'vy', live.vy, { step: 0.5 }),
    ));
    r.appendChild(title(L('实时数据 Live', 'Live Data')));
    const liveRo = el(`<div class="readonly-grid">
      <span>${L('速率 |v| (px/s)', 'Speed |v| (px/s)')}</span><b data-ro="speed">0</b>
      <span>${L('动能 KE', 'Kinetic Energy KE')}</span><b data-ro="ke">0</b>
      <span>${L('角速度 (°/s)', 'Angular Vel. (°/s)')}</span><b data-ro="angvel">0</b>
      <span>${L('动量 |p|', 'Momentum |p|')}</span><b data-ro="momentum">0</b></div>`);
    r.appendChild(liveRo);
    this.ro = {
      speed: liveRo.querySelector('[data-ro="speed"]'),
      ke: liveRo.querySelector('[data-ro="ke"]'),
      angvel: liveRo.querySelector('[data-ro="angvel"]'),
      momentum: liveRo.querySelector('[data-ro="momentum"]'),
    };
    r.appendChild(title(L('材质 Material', 'Material')));
    const matRow = el('<div class="chip-row"></div>');
    const matDefs = [
      ['foam', L('泡沫', 'Foam')], ['wood', L('木头', 'Wood')], ['rubber', L('橡胶', 'Rubber')], ['ice', L('冰', 'Ice')], ['iron', L('铁', 'Iron')],
    ];
    for (const [key, label] of matDefs) {
      const c = el(`<button class="chip" data-mat="${key}">${label}</button>`);
      c.addEventListener('click', () => this.cb.onMaterialPreset(key));
      matRow.appendChild(c);
    }
    r.appendChild(matRow);
    r.appendChild(el(`<p class="empty-note">${L('一键套用材质预设（密度 / 摩擦 / 弹性 / 空气阻力一组写入），或在下面逐项手调。', 'One-tap material presets (density / friction / restitution / air friction written as a set), or fine-tune each value below.')}</p>`));
    r.appendChild(numField(L('Density 密度', 'Density'), 'density', data.density, { step: 0.0005, min: 0.0001, max: 0.05 }));
    r.appendChild(sliderField(L('Friction 摩擦力', 'Friction'), 'friction', data.friction, 0, 1, 0.01));
    r.appendChild(sliderField(L('Restitution 弹性', 'Restitution'), 'restitution', data.restitution, 0, 1, 0.01));
    r.appendChild(sliderField(L('Air Friction 空气阻力', 'Air Friction'), 'frictionAir', data.frictionAir, 0, 0.1, 0.001));
    r.appendChild(sliderField(L('磁性 Magnetism（+N 极 / −S 极）', 'Magnetism (+N / −S pole)'), 'magnet', data.magnet || 0, -100, 100, 5));
    r.appendChild(el(`<p class="empty-note">${L('磁极：同极相斥、异极相吸（作用范围约 320），磁铁还会吸引没有磁性的铁质物体；轻的物体反应更强。0 = 无磁性。', 'Poles: like poles repel, opposite poles attract (range ≈ 320); magnets also pull unmagnetised iron bodies, and lighter bodies react more. 0 = not magnetic.')}</p>`));
    if (data.type !== 'line') {
      r.appendChild(switchRow(L('Static 静态物体', 'Static'), 'isStatic', data.isStatic));
      r.appendChild(switchRow(L('锁定旋转 Lock Rotation', 'Lock Rotation'), 'lockRotation', data.lockRotation === true));
    } else r.appendChild(el(`<p class="empty-note">${L('线段始终为静态物体。', 'Lines are always static.')}</p>`));
    if (!data.isStatic) {
      const ops = el('<div class="btn-row"></div>');
      const mkOp = (ic, label, action) => {
        const b = el(`<button class="btn">${icon(ic, 15)} ${label}</button>`);
        b.addEventListener('click', () => this.cb.onBodyAction(action));
        return b;
      };
      ops.appendChild(mkOp('stop', L('停止', 'Stop'), 'stop'));
      ops.appendChild(mkOp('flip', L('翻转X', 'Flip X'), 'flipX'));
      ops.appendChild(mkOp('flip', L('翻转Y', 'Flip Y'), 'flipY'));
      r.appendChild(ops);
    }
    const sdBtn = el(`<button class="btn block" data-drag-static>${icon('move', 15)} ${L('拖动静态物体', 'Drag Static Body')}</button>`);
    if (!data.isStatic) {
      sdBtn.disabled = true;
      sdBtn.title = L('仅静态物体可用', 'Static bodies only');
    } else {
      if (this.staticDragId === data.id) sdBtn.classList.add('armed');
      sdBtn.addEventListener('click', () => this.cb.onToggleStaticDrag && this.cb.onToggleStaticDrag(data.id));
    }
    r.appendChild(sdBtn);
    r.appendChild(el(`<p class="empty-note">${L('开启后直接在画布上拖动这个静态物体改位置（运行中也可以，拖动的是位置本身、不受物理拖拽影响）。仅静态物体可用；动态物体用物理拖拽或上面的 Position 输入框。', 'When on, drag this static body directly on the canvas to reposition it (works while running; it moves the position itself, not a physics drag). Static bodies only — dynamic bodies use physics dragging or the Position fields above.')}</p>`));
    const dup = el(`<button class="btn block">${icon('copy', 16)}${L(' 复制物体', ' Duplicate Body')}</button>`);
    dup.addEventListener('click', () => this.cb.onDuplicateSelected());
    const del = el(`<button class="btn danger block">${icon('trash', 16)}${L(' 删除物体', ' Delete Body')}</button>`);
    del.addEventListener('click', () => this.cb.onDeleteSelected());
    r.appendChild(dup); r.appendChild(del);

    this._wireNumbers(r, (k, v) => {
      if (['width', 'height', 'radius', 'sides'].includes(k)) this.cb.onBodySize(k, v);
      else this.cb.onBodyProp(k, v);
    });
    // static switch handled via checkbox wiring above using data-key=isStatic -> onBodyProp
    this._collectInputs();
    this.refreshBody(live);
  }

  /** Wind-region editor: geometry + wind velocity/power, wired to onWindProp. */
  showWind(wind) {
    if (this.mode === 'wind' && this.selectedWindId === wind.id && this.root.childElementCount) return;
    this.mode = 'wind'; this.selectedId = null; this.selectedFluidId = null; this.selectedWindId = wind.id; this.selectedHingeId = null;
    const r = this.root; r.innerHTML = '';
    r.appendChild(title(L('风场区域 Wind · 风', 'Wind Region')));
    r.appendChild(el(`<p class="empty-note">${L('区域内的物体被吹向风速 (vx, vy) 的方向：密度越小吹得越快（按 0.0012 ÷ 物体密度 放大），密实重物几乎不动。负数表示向左/向上吹。强度 Power 整体放大或减弱这个效果。也可以直接在画布上拖动这块区域来移动它。', 'Bodies inside are blended toward the wind velocity (vx, vy): the lower a body\'s density, the faster it goes (scaled by 0.0012 ÷ body density); dense blocks barely stir. Negative values blow left/up. Power scales the whole effect. You can also drag this region on the canvas to move it.')}</p>`));
    r.appendChild(row(
      numField(L('中心 X', 'Center X'), 'wx', wind.x, { step: 5 }),
      numField(L('中心 Y', 'Center Y'), 'wy', wind.y, { step: 5 }),
    ));
    r.appendChild(row(
      numField(L('Width 宽度', 'Width'), 'wwidth', wind.width, { step: 10, min: 20, max: 4000 }),
      numField(L('Height 高度', 'Height'), 'wheight', wind.height, { step: 10, min: 10, max: 2000 }),
    ));
    r.appendChild(sliderField(L('风速 X Wind X', 'Wind X'), 'wvx', wind.vx, -12, 12, 0.5));
    r.appendChild(sliderField(L('风速 Y Wind Y', 'Wind Y'), 'wvy', wind.vy, -12, 12, 0.5));
    r.appendChild(sliderField(L('强度 Power', 'Power'), 'wpower', wind.power, 0, 2, 0.1));
    r.appendChild(sliderField(L('阵风 Gust', 'Gust'), 'wgust', wind.gust || 0, 0, 0.9, 0.05));
    r.appendChild(sliderField(L('阵风周期 Gust Period (s)', 'Gust Period (s)'), 'wgustPeriod', wind.gustPeriod || 6, 2, 30, 1));
    r.appendChild(el(`<p class="empty-note">${L('阵风让风速按正弦呼吸：一阵强、一阵弱（全部风场同节奏，像真实天气）。阵风 0 = 恒定风。风车预设就靠它忽快忽慢。', 'Gusts make the wind breathe on a sine cycle — stronger, then weaker (all regions share one rhythm, like real weather). Gust 0 = steady wind. The Pinwheel preset uses it to surge and settle.')}</p>`));
    const back = el(`<button class="btn block">${L('返回场景属性', 'Back to Scene Properties')}</button>`);
    back.addEventListener('click', () => this.cb.onShowScene());
    const del = el(`<button class="btn danger block">${icon('trash', 16)}${L(' 删除风场区域', ' Delete Wind Region')}</button>`);
    del.addEventListener('click', () => this.cb.onDeleteWind(wind.id));
    r.appendChild(back); r.appendChild(del);
    this._wireNumbers(r, (k, v) => {
      const map = { wx: 'x', wy: 'y', wwidth: 'width', wheight: 'height', wvx: 'vx', wvy: 'vy', wpower: 'power', wgust: 'gust', wgustPeriod: 'gustPeriod' };
      if (map[k]) this.cb.onWindProp(wind.id, map[k], v);
    });
    this._collectInputs();
  }

  /** Hinge editor (1.28): connection summary + motor speed, wired to
   *  onHingeProp / onDeleteHinge. aLabel is null for a fixed world mount. */
  showHinge(hinge, aLabel, bLabel) {
    if (this.mode === 'hinge' && this.selectedHingeId === hinge.id && this.root.childElementCount) return;
    this.mode = 'hinge'; this.selectedId = null; this.selectedFluidId = null; this.selectedWindId = null; this.selectedHingeId = hinge.id;
    this._hingeView = { hinge, aLabel, bLabel };
    const r = this.root; r.innerHTML = '';
    r.appendChild(title(L('铰链 Hinge · 马达', 'Hinge · Motor')));
    r.appendChild(el(`<p class="empty-note">${L('两个物体被钉在同一点上，只能绕这个点相对转动。同一台「机器」里的零件互不碰撞，可以互相穿过——这样折叠、旋转才不会被自己的边角卡住。马达速度为 0 时就是普通铰链；设上速度后，第二个物体会相对第一个匀速转起来（正 = 顺时针）。', 'Two bodies pinned at one point can only rotate around it. Parts of one "machine" never collide with each other, so folding and spinning never jam on their own corners. Motor speed 0 is a plain hinge; set a speed and the second body turns steadily relative to the first (positive = clockwise).')}</p>`));
    const aName = aLabel === null || aLabel === undefined ? L('固定铰座（世界）', 'Fixed mount (world)') : aLabel;
    r.appendChild(el(`<p class="empty-note"><strong>${aName}</strong> ⟷ <strong>${bLabel || hinge.bodyB}</strong></p>`));
    const rpm = Math.abs(hinge.motorSpeed) * 573;
    r.appendChild(sliderField(L('马达速度 Motor（弧度/步）', 'Motor speed (rad/step)'), 'hmotor', hinge.motorSpeed, -0.15, 0.15, 0.005));
    r.appendChild(el(`<p class="empty-note">${L(`当前约 ${rpm.toFixed(0)} 转/分（${hinge.motorSpeed > 0 ? '顺时针' : hinge.motorSpeed < 0 ? '逆时针' : '已停转'}）。`, `Currently ≈ ${rpm.toFixed(0)} rpm (${hinge.motorSpeed > 0 ? 'clockwise' : hinge.motorSpeed < 0 ? 'counter-clockwise' : 'stopped'}).`)}</p>`));
    const rowBtns = el('<div class="btn-row"></div>');
    const stop = el(`<button class="btn">${L('停转', 'Stop')}</button>`);
    stop.addEventListener('click', () => { this.cb.onHingeProp(hinge.id, 'motorSpeed', 0); this.mode = null; this.showHinge({ ...hinge, motorSpeed: 0 }, aLabel, bLabel); });
    const rev = el(`<button class="btn">${L('反转方向', 'Reverse')}</button>`);
    rev.addEventListener('click', () => { const v = -hinge.motorSpeed || 0.03; this.cb.onHingeProp(hinge.id, 'motorSpeed', v); this.mode = null; this.showHinge({ ...hinge, motorSpeed: v }, aLabel, bLabel); });
    rowBtns.appendChild(stop); rowBtns.appendChild(rev);
    r.appendChild(rowBtns);
    const back = el(`<button class="btn block">${L('返回场景属性', 'Back to Scene Properties')}</button>`);
    back.addEventListener('click', () => this.cb.onShowScene());
    const del = el(`<button class="btn danger block">${icon('trash', 16)}${L(' 删除铰链', ' Delete Hinge')}</button>`);
    del.addEventListener('click', () => this.cb.onDeleteHinge(hinge.id));
    r.appendChild(back); r.appendChild(del);
    this._wireNumbers(r, (k, v) => {
      if (k === 'hmotor') this.cb.onHingeProp(hinge.id, 'motorSpeed', v);
    });
    this._collectInputs();
  }

  /** Fluid-region editor: geometry + density/drag, wired to onFluidProp. */
  showFluid(fluid) {
    if (this.mode === 'fluid' && this.selectedFluidId === fluid.id && this.root.childElementCount) return;
    this.mode = 'fluid'; this.selectedId = null; this.selectedFluidId = fluid.id; this.selectedWindId = null; this.selectedHingeId = null;
    const r = this.root; r.innerHTML = '';
    r.appendChild(title(L('流体区域 Fluid · 浮力', 'Fluid Region · Buoyancy')));
    r.appendChild(el(`<p class="empty-note">${L('区域上沿是液面。浮力按「流体密度 ÷ 物体密度 × 浸没比例」计算：物体密度小于流体就浮起，大于就沉底。默认水的密度约 0.0012。也可以直接在画布上拖动这块区域来移动它。', 'The top edge of the region is the surface. Buoyancy = fluid density ÷ body density × submerged fraction: bodies less dense than the fluid float, denser ones sink. Default water density ≈ 0.0012. You can also drag this region on the canvas to move it.')}</p>`));
    r.appendChild(row(
      numField(L('中心 X', 'Center X'), 'fx', fluid.x, { step: 5 }),
      numField(L('中心 Y', 'Center Y'), 'fy', fluid.y, { step: 5 }),
    ));
    r.appendChild(row(
      numField(L('Width 宽度', 'Width'), 'fwidth', fluid.width, { step: 10, min: 20, max: 4000 }),
      numField(L('Height 高度', 'Height'), 'fheight', fluid.height, { step: 10, min: 10, max: 2000 }),
    ));
    r.appendChild(numField(L('Density 流体密度', 'Fluid Density'), 'fdensity', fluid.density, { step: 0.0002, min: 0.00005, max: 0.05 }));
    r.appendChild(sliderField(L('Drag 水中阻尼', 'In-fluid Drag'), 'fdrag', fluid.drag, 0, 0.2, 0.005));
    r.appendChild(sliderField(L('流速 X Flow X', 'Flow X'), 'fvx', fluid.vx || 0, -8, 8, 0.25));
    r.appendChild(sliderField(L('流速 Y Flow Y', 'Flow Y'), 'fvy', fluid.vy || 0, -8, 8, 0.25));
    r.appendChild(el(`<p class="empty-note">${L('水中的阻尼同时作用于平移和旋转——转动的桨叶、风车臂在水里会被明显拖慢。有流速时物体会顺流漂。风场吹过水面还会带出表面水流（约风速的四成），不用连线，区域重叠就生效。', 'In-fluid drag acts on rotation as well as translation — spinning paddles and windmill arms slow down noticeably in water. A flow carries bodies downstream. Wind blowing over the surface also drives a surface current (about 40% of the wind speed) — no wiring needed, overlapping regions are enough.')}</p>`));
    const back = el(`<button class="btn block">${L('返回场景属性', 'Back to Scene Properties')}</button>`);
    back.addEventListener('click', () => this.cb.onShowScene());
    const del = el(`<button class="btn danger block">${icon('trash', 16)}${L(' 删除流体区域', ' Delete Fluid Region')}</button>`);
    del.addEventListener('click', () => this.cb.onDeleteFluid(fluid.id));
    r.appendChild(back); r.appendChild(del);
    this._wireNumbers(r, (k, v) => {
      const map = { fx: 'x', fy: 'y', fwidth: 'width', fheight: 'height', fdensity: 'density', fdrag: 'drag', fvx: 'vx', fvy: 'vy' };
      if (map[k]) this.cb.onFluidProp(fluid.id, map[k], v);
    });
    this._collectInputs();
  }

  _setIfIdle(key, value) {
    const inp = this.inputs.get(key);
    if (inp && document.activeElement !== inp && inp.type !== 'checkbox') inp.value = fmt(value, 4);
  }

  /** Patch live readouts (position / velocity / angle / mass) without stealing focus. */
  refreshBody(live) {
    if (this.mode !== 'body' || !live) return;
    this._setIfIdle('x', live.x); this._setIfIdle('y', live.y);
    this._setIfIdle('vx', live.vx); this._setIfIdle('vy', live.vy);
    this._setIfIdle('angleDeg', live.angleDeg); this._setIfIdle('mass', live.mass);
    if (this.ro.speed) this.ro.speed.textContent = fmt(live.speedPxS, 0);
    if (this.ro.ke) this.ro.ke.textContent = fmt(live.ke, 1);
    if (this.ro.angvel) this.ro.angvel.textContent = fmt(live.angVelDegS, 0);
    if (this.ro.momentum) this.ro.momentum.textContent = fmt(live.momentum, 1);
  }
}

export function renderSettings(root, ui, cb) {
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.appendChild(title(L('语言 Language', 'Language')));
  const langRow = el('<div class="lang-switch"></div>');
  for (const [code, label] of [['zh', '中文'], ['en', 'English']]) {
    const b = el(`<button class="btn${getLang() === code ? ' active' : ''}">${label}</button>`);
    b.addEventListener('click', () => { if (cb.onLanguage) cb.onLanguage(code); });
    langRow.appendChild(b);
  }
  wrap.appendChild(langRow);
  wrap.appendChild(title(L('显示', 'Display')));
  wrap.appendChild(switchRow(L('显示网格 Grid', 'Show Grid'), 'showGrid', ui.showGrid !== false));
  wrap.appendChild(switchRow(L('速度向量 Vectors', 'Show Vectors'), 'showVectors', ui.showVectors === true));
  wrap.appendChild(switchRow(L('运动轨迹 Trails', 'Show Trails'), 'showTrails', ui.showTrails === true));
  wrap.appendChild(title(L('数据', 'Data')));
  const note = el(`<p class="empty-note">${L('场景与设置保存在浏览器 localStorage 中，仅在本机有效。导出 JSON 可备份或分享实验场景。', 'Scenes and settings are stored in this browser\'s localStorage, on this device only. Export JSON to back up or share an experiment.')}</p>`);
  wrap.appendChild(note);
  const landing = el(`<button class="btn block">${icon('logo', 16)}${L(' 显示欢迎页', ' Show Welcome Page')}</button>`);
  landing.addEventListener('click', () => cb.onShowLanding());
  wrap.appendChild(landing);
  const clear = el(`<button class="btn danger block">${icon('trash', 16)}${L(' 重置数据（恢复初始）', ' Reset Data (Factory Reset)')}</button>`);
  clear.addEventListener('click', () => cb.onClearAll());
  wrap.appendChild(clear);
  wrap.appendChild(title(L('关于', 'About')));
  // Backend registry (1.40): rendered from the engine's own BACKENDS list —
  // the picker becomes real when the native backend lands in 1.41.
  const backendLine = ENGINE_BACKENDS.map((b) => (b.status === 'active'
    ? `${b.name}${L('（当前）', ' (current)')}`
    : `${b.name}${L('（开发中）', ' (in development)')}`)).join(' · ');
  wrap.appendChild(el(`<p class="empty-note">${L('物理引擎后端', 'Physics backend')}: ${backendLine}</p>`));
  const matterVersion = (typeof window !== 'undefined' && window.Matter && window.Matter.version) || '0.20.0';
  wrap.appendChild(el(`<p class="empty-note">${L(`MotionLab ${APP_VERSION} · PhysicsEngine ${ENGINE_VERSION} · Matter.js ${matterVersion} · PFLab ${PF_VERSION} · 纯静态部署（GitHub Pages）· 无后端、无 API Key。快捷键：空格 运行/暂停 · Ctrl+Z/Y 撤销/重做 · Ctrl+S 保存 · Ctrl+D 复制物体 · 方向键 微调位置 · R 旋转 15° · Delete 删除。`, `MotionLab ${APP_VERSION} · PhysicsEngine ${ENGINE_VERSION} · Matter.js ${matterVersion} · PFLab ${PF_VERSION} · Fully static (GitHub Pages) · no backend, no API key. Shortcuts: Space run/pause · Ctrl+Z/Y undo/redo · Ctrl+S save · Ctrl+D duplicate body · Arrow keys nudge · R rotate 15° · Delete remove.`)}</p>`));
  root.appendChild(wrap);
  root.querySelectorAll('input[type=checkbox][data-key]').forEach((inp) => {
    inp.addEventListener('change', () => cb.onUISetting(inp.dataset.key, inp.checked));
  });
}
