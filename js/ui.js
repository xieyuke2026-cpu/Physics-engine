/* ui.js — right property panel + settings modal rendering.
   The panel is rebuilt only when the selection changes; live values
   (position / velocity while simulating) are patched in place. */

import { icon } from './icons.js';

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

const TYPE_LABELS = { circle: 'Circle · 圆形', rectangle: 'Rectangle · 矩形', polygon: 'Polygon · 多边形', line: 'Static Line · 静态线段' };

export class Panel {
  /** cb: { onBodyProp(key,value), onBodySize(key,value), onSceneProp(key,value),
   *        onDeleteSelected(), onDuplicateSelected(), onSaveScene(), onNewScene(),
   *        onBodyAction(action), onSelectBody(id), onDeleteBody(id), onGravityPreset(key) } */
  constructor(root, cb) {
    this.root = root;
    this.cb = cb;
    this.mode = null;       // 'body' | 'scene'
    this.selectedId = null;
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

  showScene(settings, bodies) {
    const list = Array.isArray(bodies) ? bodies : [];
    const sig = list.map((b) => b.id).join(',');
    if (this.mode === 'scene' && this.root.childElementCount && this._sceneSig === sig) { this.refreshScene(settings, list.length); return; }
    this._sceneSig = sig;
    this.mode = 'scene'; this.selectedId = null;
    const r = this.root; r.innerHTML = '';
    r.appendChild(title('场景属性 Scene'));
    const ro = el(`<div class="readonly-grid"><span>物体数量</span><b data-ro="count">${list.length}</b>
      <span>引擎</span><b>Matter.js</b><span>格式</span><b>motionlab-scene v2</b></div>`);
    r.appendChild(ro);
    r.appendChild(title('重力与模拟'));
    const chips = el('<div class="chip-row"></div>');
    const chipDefs = [
      ['moon', '月球 0.17g'], ['earth', '地球 1g'], ['jupiter', '木星 2.5g'], ['zero', '零重力'], ['side', '侧向重力'],
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
    r.appendChild(switchRow('启用重力 Enable Gravity', 'gravityEnabled', settings.gravityEnabled));
    r.appendChild(title('显示'));
    r.appendChild(switchRow('显示网格 Grid', 'showGrid', settings.showGrid));
    r.appendChild(switchRow('速度向量 Vectors', 'showVectors', settings.showVectors));
    r.appendChild(switchRow('运动轨迹 Trails', 'showTrails', settings.showTrails));
    const save = el(`<button class="btn accent block">${icon('save', 16)} 保存场景</button>`);
    save.addEventListener('click', () => this.cb.onSaveScene());
    const nw = el(`<button class="btn block">${icon('plus', 16)} 新建场景</button>`);
    nw.addEventListener('click', () => this.cb.onNewScene());
    r.appendChild(save); r.appendChild(nw);
    if (list.length) {
      r.appendChild(title('物体列表 Objects'));
      const wrap = el('<div class="obj-list"></div>');
      for (const b of list) {
        const rowEl = el(`<button class="obj-row"><span class="o-name"></span><span class="o-type"></span></button>`);
        rowEl.querySelector('.o-name').textContent = b.label || b.type;
        rowEl.querySelector('.o-type').textContent = b.type + (b.isStatic ? ' · 静态' : '');
        rowEl.addEventListener('click', () => this.cb.onSelectBody(b.id));
        const del = el(`<span class="tb-btn icon o-del">${icon('trash', 16)}</span>`);
        del.addEventListener('click', (e) => { e.stopPropagation(); this.cb.onDeleteBody(b.id); });
        rowEl.appendChild(del);
        wrap.appendChild(rowEl);
      }
      r.appendChild(wrap);
    }
    r.appendChild(el('<p class="empty-note">在画布上点选一个物体，这里会显示它的物理参数。空白处双击可添加物体。</p>'));
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
    this.mode = 'body'; this.selectedId = data.id;
    const r = this.root; r.innerHTML = '';
    r.appendChild(title('物体属性 Object'));
    const head = el(`<div class="readonly-grid"><span>类型 Type</span><b>${TYPE_LABELS[data.type] || data.type}</b>
      <span>ID</span><b>${data.id.split('-').slice(0, 2).join('-')}</b></div>`);
    r.appendChild(head);
    r.appendChild(title('位置与尺寸'));
    r.appendChild(row(
      numField('Position X', 'x', live.x, { step: 1 }),
      numField('Position Y', 'y', live.y, { step: 1 }),
    ));
    if (data.type === 'circle') {
      r.appendChild(numField('Radius 半径', 'radius', data.radius, { step: 1, min: 4, max: 600 }));
    } else if (data.type === 'polygon') {
      r.appendChild(row(
        numField('Radius 半径', 'radius', data.radius, { step: 1, min: 6, max: 600 }),
        numField('Sides 边数', 'sides', data.sides, { step: 1, min: 3, max: 12 }),
      ));
    } else if (data.type === 'line') {
      r.appendChild(row(
        numField('Length 长度', 'width', data.width, { step: 1, min: 10, max: 2400 }),
        numField('Thickness 粗细', 'height', data.height, { step: 1, min: 4, max: 10 }),
      ));
    } else {
      r.appendChild(row(
        numField('Width 宽度', 'width', data.width, { step: 1, min: 4, max: 2400 }),
        numField('Height 高度', 'height', data.height, { step: 1, min: 4, max: 2400 }),
      ));
    }
    r.appendChild(row(
      numField('Angle 角度 (°)', 'angleDeg', live.angleDeg, { step: 1 }),
      numField('Velocity X', 'vx', live.vx, { step: 0.5 }),
    ));
    r.appendChild(row(
      numField('Mass 质量', 'mass', live.mass, { step: 0.1, min: 0.01 }),
      numField('Velocity Y', 'vy', live.vy, { step: 0.5 }),
    ));
    r.appendChild(title('实时数据 Live'));
    const liveRo = el(`<div class="readonly-grid">
      <span>速率 |v| (px/s)</span><b data-ro="speed">0</b>
      <span>动能 KE</span><b data-ro="ke">0</b>
      <span>角速度 (°/s)</span><b data-ro="angvel">0</b>
      <span>动量 |p|</span><b data-ro="momentum">0</b></div>`);
    r.appendChild(liveRo);
    this.ro = {
      speed: liveRo.querySelector('[data-ro="speed"]'),
      ke: liveRo.querySelector('[data-ro="ke"]'),
      angvel: liveRo.querySelector('[data-ro="angvel"]'),
      momentum: liveRo.querySelector('[data-ro="momentum"]'),
    };
    r.appendChild(title('材质 Material'));
    r.appendChild(numField('Density 密度', 'density', data.density, { step: 0.0005, min: 0.0001, max: 0.05 }));
    r.appendChild(sliderField('Friction 摩擦力', 'friction', data.friction, 0, 1, 0.01));
    r.appendChild(sliderField('Restitution 弹性', 'restitution', data.restitution, 0, 1, 0.01));
    r.appendChild(sliderField('Air Friction 空气阻力', 'frictionAir', data.frictionAir, 0, 0.1, 0.001));
    if (data.type !== 'line') {
      r.appendChild(switchRow('Static 静态物体', 'isStatic', data.isStatic));
      r.appendChild(switchRow('锁定旋转 Lock Rotation', 'lockRotation', data.lockRotation === true));
    } else r.appendChild(el('<p class="empty-note">线段始终为静态物体。</p>'));
    if (!data.isStatic) {
      const ops = el('<div class="btn-row"></div>');
      const mkOp = (ic, label, action) => {
        const b = el(`<button class="btn">${icon(ic, 15)} ${label}</button>`);
        b.addEventListener('click', () => this.cb.onBodyAction(action));
        return b;
      };
      ops.appendChild(mkOp('stop', '停止', 'stop'));
      ops.appendChild(mkOp('flip', '翻转X', 'flipX'));
      ops.appendChild(mkOp('flip', '翻转Y', 'flipY'));
      r.appendChild(ops);
    }
    const dup = el(`<button class="btn block">${icon('copy', 16)} 复制物体</button>`);
    dup.addEventListener('click', () => this.cb.onDuplicateSelected());
    const del = el(`<button class="btn danger block">${icon('trash', 16)} 删除物体</button>`);
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
  wrap.appendChild(title('显示'));
  wrap.appendChild(switchRow('显示网格 Grid', 'showGrid', ui.showGrid !== false));
  wrap.appendChild(switchRow('速度向量 Vectors', 'showVectors', ui.showVectors === true));
  wrap.appendChild(switchRow('运动轨迹 Trails', 'showTrails', ui.showTrails === true));
  wrap.appendChild(title('数据'));
  const note = el('<p class="empty-note">场景与设置保存在浏览器 localStorage 中，仅在本机有效。导出 JSON 可备份或分享实验场景。</p>');
  wrap.appendChild(note);
  const landing = el(`<button class="btn block">${icon('logo', 16)} 显示欢迎页</button>`);
  landing.addEventListener('click', () => cb.onShowLanding());
  wrap.appendChild(landing);
  const clear = el(`<button class="btn danger block">${icon('trash', 16)} 清除全部本地数据</button>`);
  clear.addEventListener('click', () => cb.onClearAll());
  wrap.appendChild(clear);
  wrap.appendChild(title('关于'));
  wrap.appendChild(el('<p class="empty-note">MotionLab 1.4 · 通用 physics-engine 核心 · Matter.js 0.19 · 纯静态部署（GitHub Pages）· 无后端、无 API Key。快捷键：空格 运行/暂停 · Ctrl+Z/Y 撤销/重做 · Ctrl+S 保存 · Ctrl+D 复制物体 · 方向键 微调位置 · R 旋转 15° · Delete 删除。</p>'));
  root.appendChild(wrap);
  root.querySelectorAll('input[type=checkbox][data-key]').forEach((inp) => {
    inp.addEventListener('change', () => cb.onUISetting(inp.dataset.key, inp.checked));
  });
}
