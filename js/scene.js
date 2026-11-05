/* scene.js — pure scene data model: defaults, serialization shape, validation.
   No DOM, no Matter dependency, so it can be unit-tested in Node. */

export const SCENE_FORMAT = 'motionlab-scene';
export const SCENE_VERSION = 2;
export const BODY_TYPES = ['circle', 'rectangle', 'polygon', 'line'];

export const DEFAULT_SETTINGS = {
  gravityX: 0,
  gravityY: 1,
  gravityEnabled: true,
  speed: 1,
  showGrid: true,
  showVectors: false,
  showTrails: false,
  // Pairwise Newtonian gravitation (PhysicsEngine.setGravitation). 0 = off.
  gravitation: 0,
  gravitationSoftening: 100,
  // Seed for the engine's RNG stream (PhysicsEngine.setSeed). Every
  // random process in the app (the Random Jitter action, future random
  // features) draws from this stream, so a scene + its seed replays
  // the exact same random outcomes. Refresh it in the scene panel.
  seed: 1,
};

let _uid = 1;
export function nextId(prefix = 'body') {
  return `${prefix}-${Date.now().toString(36)}-${(_uid++).toString(36)}`;
}

/** A plain-data description of one body (what gets saved to JSON / localStorage). */
export function bodyData(partial = {}) {
  const type = BODY_TYPES.includes(partial.type) ? partial.type : 'rectangle';
  const d = {
    id: typeof partial.id === 'string' && partial.id ? partial.id : nextId(),
    type,
    x: num(partial.x, 0),
    y: num(partial.y, 0),
    angle: num(partial.angle, 0),            // radians
    width: num(partial.width, 64),
    height: num(partial.height, 64),
    radius: num(partial.radius, 30),
    sides: Math.max(3, Math.round(num(partial.sides, 6))),
    density: num(partial.density, 0.001),
    friction: num(partial.friction, 0.3),
    frictionAir: num(partial.frictionAir, 0.01),
    restitution: num(partial.restitution, 0.2),
    magnet: Math.min(100, Math.max(-100, num(partial.magnet, 0))),
    isStatic: partial.isStatic === true || type === 'line',
    isBound: partial.isBound === true,       // ground / walls that belong to the scene frame
    lockRotation: partial.lockRotation === true,
    vx: num(partial.vx, 0),
    vy: num(partial.vy, 0),
    label: typeof partial.label === 'string' ? partial.label : '',
  };
  if (type === 'line') { d.isStatic = true; d.height = Math.min(d.height, 10); }
  return d;
}

/** A plain-data spring / rod constraint. bodyA === null means pointA is a fixed
 *  world anchor; otherwise pointA/pointB are offsets from each body's centre. */
export function constraintData(partial = {}) {
  const pt = (p, fb) => (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
    ? { x: Number(p.x), y: Number(p.y) } : fb;
  return {
    id: typeof partial.id === 'string' && partial.id ? partial.id : nextId('spring'),
    bodyA: typeof partial.bodyA === 'string' && partial.bodyA ? partial.bodyA : null,
    bodyB: typeof partial.bodyB === 'string' && partial.bodyB ? partial.bodyB : null,
    pointA: pt(partial.pointA, { x: 0, y: 0 }),
    pointB: pt(partial.pointB, { x: 0, y: 0 }),
    stiffness: Math.min(1, Math.max(0.001, num(partial.stiffness, 0.08))),
    damping: Math.min(1, Math.max(0, num(partial.damping, 0.05))),
    length: partial.length === null || partial.length === undefined ? null : Math.max(0, num(partial.length, 0)),
  };
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** A plain-data hinge (revolute joint, 1.28). bodyA === null means pointA is a
 *  fixed world mount; otherwise pointA/pointB are offsets from each body's
 *  centre. motorSpeed is the motor target in rad/step (0 = plain hinge). */
export function hingeData(partial = {}) {
  const pt = (p, fb) => (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
    ? { x: Number(p.x), y: Number(p.y) } : fb;
  return {
    id: typeof partial.id === 'string' && partial.id ? partial.id : nextId('hinge'),
    bodyA: typeof partial.bodyA === 'string' && partial.bodyA ? partial.bodyA : null,
    bodyB: typeof partial.bodyB === 'string' && partial.bodyB ? partial.bodyB : null,
    pointA: pt(partial.pointA, { x: 0, y: 0 }),
    pointB: pt(partial.pointB, { x: 0, y: 0 }),
    motorSpeed: Math.min(0.3, Math.max(-0.3, num(partial.motorSpeed, 0))),
    motorPower: Math.min(0.05, Math.max(0.0001, num(partial.motorPower, 0.0025))),
  };
}

/** A plain-data fluid region (buoyancy). (x, y) is the region CENTRE and its
 *  top edge is the surface, matching PhysicsEngine.addFluid. */
export function fluidData(partial = {}) {
  return {
    id: typeof partial.id === 'string' && partial.id ? partial.id : nextId('fluid'),
    x: num(partial.x, 640),
    y: num(partial.y, 455),
    width: Math.min(4000, Math.max(20, num(partial.width, 760))),
    height: Math.min(2000, Math.max(10, num(partial.height, 170))),
    density: Math.min(0.05, Math.max(0.00005, num(partial.density, 0.0012))),
    drag: Math.min(1, Math.max(0, num(partial.drag, 0.02))),
    vx: Math.min(16, Math.max(-16, num(partial.vx, 0))),
    vy: Math.min(16, Math.max(-16, num(partial.vy, 0))),
  };
}

/** A plain-data wind region (target-velocity field). (x, y) is the region
 *  CENTRE; (vx, vy) is the wind velocity in px/step, matching
 *  PhysicsEngine.addWind. */
export function windData(partial = {}) {
  return {
    id: typeof partial.id === 'string' && partial.id ? partial.id : nextId('wind'),
    x: num(partial.x, 640),
    y: num(partial.y, 300),
    width: Math.min(4000, Math.max(20, num(partial.width, 760))),
    height: Math.min(2000, Math.max(10, num(partial.height, 260))),
    vx: Math.min(16, Math.max(-16, num(partial.vx, 4))),
    vy: Math.min(16, Math.max(-16, num(partial.vy, 0))),
    power: Math.min(2, Math.max(0, num(partial.power, 1))),
    gust: Math.min(0.9, Math.max(0, num(partial.gust, 0))),
    gustPeriod: Math.min(30, Math.max(2, num(partial.gustPeriod, 6))),
  };
}

export function sceneData(partial = {}) {
  return {
    format: SCENE_FORMAT,
    version: SCENE_VERSION,
    name: typeof partial.name === 'string' && partial.name.trim() ? partial.name.trim() : 'Untitled Scene',
    settings: { ...DEFAULT_SETTINGS, ...(partial.settings || {}) },
    bodies: Array.isArray(partial.bodies) ? partial.bodies.map(bodyData) : [],
    constraints: Array.isArray(partial.constraints) ? partial.constraints.map(constraintData).filter((c) => c.bodyB) : [],
    hinges: Array.isArray(partial.hinges) ? partial.hinges.map(hingeData).filter((h) => h.bodyB) : [],
    fluids: Array.isArray(partial.fluids) ? partial.fluids.map(fluidData) : [],
    winds: Array.isArray(partial.winds) ? partial.winds.map(windData) : [],
    updatedAt: typeof partial.updatedAt === 'number' ? partial.updatedAt : Date.now(),
  };
}

/** Validate imported / loaded JSON. Returns {ok, errors[], scene?}. Never throws. */
export function validateScene(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['根节点必须是对象'] };
  }
  if (raw.format !== SCENE_FORMAT) errors.push(`format 必须为 "${SCENE_FORMAT}"`);
  if (raw.version !== 1 && raw.version !== SCENE_VERSION) errors.push(`version 必须为 1 或 ${SCENE_VERSION}`);
  if (!Array.isArray(raw.bodies)) {
    errors.push('bodies 必须是数组');
    return { ok: false, errors };
  }
  if (raw.bodies.length > 2000) errors.push('物体数量超过上限 2000');
  raw.bodies.forEach((b, i) => {
    if (!b || typeof b !== 'object') { errors.push(`bodies[${i}] 不是对象`); return; }
    if (!BODY_TYPES.includes(b.type)) errors.push(`bodies[${i}].type 无效: ${String(b.type)}`);
    for (const k of ['x', 'y']) {
      if (!Number.isFinite(Number(b[k]))) errors.push(`bodies[${i}].${k} 必须是有限数字`);
    }
    for (const k of ['width', 'height', 'radius', 'density', 'friction', 'restitution', 'magnet']) {
      if (b[k] !== undefined && !Number.isFinite(Number(b[k]))) errors.push(`bodies[${i}].${k} 必须是有限数字`);
    }
    if (b.density !== undefined && Number(b.density) < 0) errors.push(`bodies[${i}].density 不能为负`);
    if (b.restitution !== undefined && (Number(b.restitution) < 0 || Number(b.restitution) > 2)) {
      errors.push(`bodies[${i}].restitution 超出范围 0–2`);
    }
  });
  if (raw.constraints !== undefined) {
    if (!Array.isArray(raw.constraints)) errors.push('constraints 必须是数组');
    else {
      if (raw.constraints.length > 500) errors.push('约束数量超过上限 500');
      const ids = new Set(raw.bodies.map((b) => b && b.id));
      raw.constraints.forEach((c, i) => {
        if (!c || typeof c !== 'object') { errors.push(`constraints[${i}] 不是对象`); return; }
        if (typeof c.bodyB !== 'string' || !ids.has(c.bodyB)) errors.push(`constraints[${i}].bodyB 必须引用已存在的物体`);
        if (c.bodyA !== null && c.bodyA !== undefined && !ids.has(c.bodyA)) errors.push(`constraints[${i}].bodyA 必须引用已存在的物体或为 null`);
        if (c.stiffness !== undefined && (!Number.isFinite(Number(c.stiffness)) || Number(c.stiffness) <= 0 || Number(c.stiffness) > 1)) {
          errors.push(`constraints[${i}].stiffness 超出范围 (0, 1]`);
        }
        for (const pk of ['pointA', 'pointB']) {
          const p = c[pk];
          if (p !== undefined && (!p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y)))) {
            errors.push(`constraints[${i}].${pk} 必须是有限坐标`);
          }
        }
      });
    }
  }
  if (raw.hinges !== undefined) {
    if (!Array.isArray(raw.hinges)) errors.push('hinges 必须是数组');
    else {
      if (raw.hinges.length > 500) errors.push('铰链数量超过上限 500');
      const ids = new Set(raw.bodies.map((b) => b && b.id));
      raw.hinges.forEach((h, i) => {
        if (!h || typeof h !== 'object') { errors.push(`hinges[${i}] 不是对象`); return; }
        if (typeof h.bodyB !== 'string' || !ids.has(h.bodyB)) errors.push(`hinges[${i}].bodyB 必须引用已存在的物体`);
        if (h.bodyA !== null && h.bodyA !== undefined && !ids.has(h.bodyA)) errors.push(`hinges[${i}].bodyA 必须引用已存在的物体或为 null`);
        if (h.motorSpeed !== undefined && (!Number.isFinite(Number(h.motorSpeed)) || Math.abs(Number(h.motorSpeed)) > 0.3)) {
          errors.push(`hinges[${i}].motorSpeed 超出范围 [-0.3, 0.3]`);
        }
        for (const pk of ['pointA', 'pointB']) {
          const p = h[pk];
          if (p !== undefined && (!p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y)))) {
            errors.push(`hinges[${i}].${pk} 必须是有限坐标`);
          }
        }
      });
    }
  }
  if (raw.fluids !== undefined) {
    if (!Array.isArray(raw.fluids)) errors.push('fluids 必须是数组');
    else {
      if (raw.fluids.length > 20) errors.push('流体区域数量超过上限 20');
      raw.fluids.forEach((f, i) => {
        if (!f || typeof f !== 'object') { errors.push(`fluids[${i}] 不是对象`); return; }
        for (const k of ['x', 'y', 'width', 'height', 'density', 'drag', 'vx', 'vy']) {
          if (f[k] !== undefined && !Number.isFinite(Number(f[k]))) errors.push(`fluids[${i}].${k} 必须是有限数字`);
        }
      });
    }
  }
  if (raw.winds !== undefined) {
    if (!Array.isArray(raw.winds)) errors.push('winds 必须是数组');
    else {
      if (raw.winds.length > 20) errors.push('风场区域数量超过上限 20');
      raw.winds.forEach((w, i) => {
        if (!w || typeof w !== 'object') { errors.push(`winds[${i}] 不是对象`); return; }
        for (const k of ['x', 'y', 'width', 'height', 'vx', 'vy', 'power', 'gust', 'gustPeriod']) {
          if (w[k] !== undefined && !Number.isFinite(Number(w[k]))) errors.push(`winds[${i}].${k} 必须是有限数字`);
        }
      });
    }
  }
  const s = raw.settings;
  if (s !== undefined) {
    if (!s || typeof s !== 'object') errors.push('settings 必须是对象');
    else {
      for (const k of ['gravityX', 'gravityY', 'speed', 'gravitation', 'gravitationSoftening', 'seed']) {
        if (s[k] !== undefined && !Number.isFinite(Number(s[k]))) errors.push(`settings.${k} 必须是有限数字`);
      }
      if (s.seed !== undefined && (Number(s.seed) < 0 || Number(s.seed) > 4294967295 || !Number.isInteger(Number(s.seed)))) errors.push('settings.seed 必须是 0..4294967295 的整数');
      if (s.speed !== undefined && (Number(s.speed) <= 0 || Number(s.speed) > 4)) errors.push('settings.speed 超出范围 (0, 4]');
      if (s.gravitation !== undefined && Number(s.gravitation) < 0) errors.push('settings.gravitation 不能为负');
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], scene: sceneData(raw) };
}

/** The starter scene: ground + two walls, a few bodies that demonstrate gravity/collision. */
export function defaultScene() {
  const W = 1280, groundY = 560;
  return sceneData({
    name: 'Untitled Scene',
    bodies: [
      bodyData({ id: 'bound-ground', type: 'rectangle', x: W / 2, y: groundY, width: W, height: 40, isStatic: true, isBound: true, friction: 0.6, label: 'Ground' }),
      bodyData({ id: 'bound-left', type: 'rectangle', x: 20, y: 240, width: 40, height: 680, isStatic: true, isBound: true, label: 'Wall L' }),
      bodyData({ id: 'bound-right', type: 'rectangle', x: W - 20, y: 240, width: 40, height: 680, isStatic: true, isBound: true, label: 'Wall R' }),
      bodyData({ type: 'rectangle', x: 470, y: 470, width: 260, height: 18, angle: 0.16, isStatic: true, friction: 0.2, label: 'Ramp' }),
      bodyData({ type: 'circle', x: 380, y: 120, radius: 30, restitution: 0.55, label: 'Ball' }),
      bodyData({ type: 'rectangle', x: 640, y: 90, width: 58, height: 58, restitution: 0.25, label: 'Box' }),
      bodyData({ type: 'rectangle', x: 700, y: 180, width: 58, height: 58, angle: 0.4, label: 'Box' }),
      bodyData({ type: 'polygon', x: 830, y: 110, sides: 6, radius: 34, restitution: 0.35, label: 'Hexagon' }),
      bodyData({ type: 'circle', x: 900, y: 60, radius: 20, density: 0.003, restitution: 0.7, label: 'Ball' }),
    ],
  });
}

/** Ground + walls shared by the starter scene and the presets. */
export function frameBodies() {
  const W = 1280, groundY = 560;
  return [
    bodyData({ id: 'bound-ground', type: 'rectangle', x: W / 2, y: groundY, width: W, height: 40, isStatic: true, isBound: true, friction: 0.6, label: 'Ground' }),
    bodyData({ id: 'bound-left', type: 'rectangle', x: 20, y: 240, width: 40, height: 680, isStatic: true, isBound: true, label: 'Wall L' }),
    bodyData({ id: 'bound-right', type: 'rectangle', x: W - 20, y: 240, width: 40, height: 680, isStatic: true, isBound: true, label: 'Wall R' }),
  ];
}

const GROUND_TOP = 540;

/** Built-in experiment presets. Each returns a full sceneData object.
 *  Keys are stable; the UI renders this list in order. */
export function presetScenes() {
  const out = [];

  // Newton's cradle — five pendulum balls on rigid rods, first ball pulled aside.
  {
    const bodies = frameBodies();
    const constraints = [];
    const n = 5, r = 22, L = 190, topY = 70, cx = 640;
    for (let i = 0; i < n; i++) {
      const ax = cx + (i - (n - 1) / 2) * (r * 2 + 1);
      let bx = ax, by = topY + L;
      if (i === 0) { const a = 0.62; bx = ax - Math.sin(a) * L; by = topY + Math.cos(a) * L; }
      const id = `cradle-ball-${i}`;
      bodies.push(bodyData({ id, type: 'circle', x: bx, y: by, radius: r, density: 0.004, friction: 0.05, frictionAir: 0.0005, restitution: 0.95, label: 'Pendulum Ball' }));
      constraints.push(constraintData({ bodyA: null, bodyB: id, pointA: { x: ax, y: topY }, pointB: { x: 0, y: 0 }, stiffness: 1, damping: 0, length: L }));
    }
    bodies.push(bodyData({ type: 'rectangle', x: cx, y: topY - 8, width: n * 45 + 60, height: 14, isStatic: true, label: 'Beam' }));
    out.push({ key: 'cradle', name: '牛顿摆', scene: sceneData({ name: '牛顿摆 Newton\'s Cradle', bodies, constraints }) });
  }

  // Dominoes — a row of thin blocks; the first one is already tipping.
  {
    const bodies = frameBodies();
    const n = 11, w = 16, h = 96;
    for (let i = 0; i < n; i++) {
      bodies.push(bodyData({
        type: 'rectangle', x: 190 + i * 62, y: GROUND_TOP - h / 2, width: w, height: h,
        angle: i === 0 ? 0.22 : 0, restitution: 0.05, friction: 0.35, label: 'Domino',
      }));
    }
    bodies.push(bodyData({ type: 'circle', x: 118, y: GROUND_TOP - 18, radius: 18, vx: 6, restitution: 0.3, label: 'Ball' }));
    out.push({ key: 'domino', name: '多米诺骨牌', scene: sceneData({ name: '多米诺骨牌 Dominoes', bodies }) });
  }

  // Pyramid stack of boxes.
  {
    const bodies = frameBodies();
    const s = 46, rows = 6;
    for (let row = 0; row < rows; row++) {
      const count = rows - row;
      const y = GROUND_TOP - s / 2 - row * s;
      for (let i = 0; i < count; i++) {
        bodies.push(bodyData({
          type: 'rectangle', x: 640 + (i - (count - 1) / 2) * (s + 2), y, width: s, height: s,
          friction: 0.5, restitution: 0.05, label: 'Box',
        }));
      }
    }
    bodies.push(bodyData({ type: 'circle', x: 200, y: 180, radius: 26, density: 0.004, restitution: 0.4, label: 'Wrecking Ball' }));
    out.push({ key: 'pyramid', name: '方块金字塔', scene: sceneData({ name: '方块金字塔 Pyramid', bodies }) });
  }

  // Two ramps with a staggered set of balls.
  {
    const bodies = frameBodies();
    bodies.push(bodyData({ type: 'rectangle', x: 330, y: 330, width: 380, height: 16, angle: 0.22, isStatic: true, friction: 0.15, label: 'Ramp' }));
    bodies.push(bodyData({ type: 'rectangle', x: 880, y: 460, width: 420, height: 16, angle: -0.18, isStatic: true, friction: 0.15, label: 'Ramp' }));
    for (let i = 0; i < 5; i++) {
      bodies.push(bodyData({ type: 'circle', x: 190 + i * 14, y: 190 - i * 34, radius: 17, restitution: 0.45, friction: 0.1, label: 'Ball' }));
    }
    bodies.push(bodyData({ type: 'polygon', x: 1010, y: 120, sides: 6, radius: 30, restitution: 0.35, label: 'Hexagon' }));
    out.push({ key: 'ramps', name: '斜坡滚球', scene: sceneData({ name: '斜坡滚球 Ramps', bodies }) });
  }

  // Bouncy balls of different sizes and restitution.
  {
    const bodies = frameBodies();
    const defs = [
      { x: 300, r: 34, e: 0.92 }, { x: 430, r: 24, e: 0.85 }, { x: 540, r: 40, e: 0.78 },
      { x: 700, r: 20, e: 0.95 }, { x: 820, r: 30, e: 0.88 }, { x: 960, r: 26, e: 0.8 },
    ];
    defs.forEach((d, i) => bodies.push(bodyData({
      type: 'circle', x: d.x, y: 120 + (i % 3) * 40, radius: d.r,
      restitution: d.e, friction: 0.08, frictionAir: 0.001, label: 'Bouncy Ball',
    })));
    bodies.push(bodyData({ type: 'rectangle', x: 640, y: 330, width: 150, height: 16, isStatic: true, angle: 0.1, label: 'Platform' }));
    out.push({ key: 'bounce', name: '高弹球阵列', scene: sceneData({ name: '高弹球阵列 Bouncy Balls', bodies }) });
  }

  // Double pendulum — two rigid rods chained; tiny differences explode into chaos.
  {
    const bodies = frameBodies();
    const constraints = [];
    const ax = 640, ay = 90, L1 = 150, L2 = 140;
    const a1 = 2.2, a2 = 3.3;
    const jx = ax + Math.sin(a1) * L1, jy = ay + Math.cos(a1) * L1;
    const bx = jx + Math.sin(a2) * L2, by = jy + Math.cos(a2) * L2;
    bodies.push(bodyData({ id: 'dp-joint', type: 'circle', x: jx, y: jy, radius: 15, density: 0.002, frictionAir: 0.0005, restitution: 0, label: 'Joint' }));
    bodies.push(bodyData({ id: 'dp-bob', type: 'circle', x: bx, y: by, radius: 22, density: 0.003, frictionAir: 0.0005, restitution: 0, label: 'Bob' }));
    constraints.push(constraintData({ bodyA: null, bodyB: 'dp-joint', pointA: { x: ax, y: ay }, pointB: { x: 0, y: 0 }, stiffness: 1, damping: 0, length: L1 }));
    constraints.push(constraintData({ bodyA: 'dp-joint', bodyB: 'dp-bob', pointA: { x: 0, y: 0 }, pointB: { x: 0, y: 0 }, stiffness: 1, damping: 0, length: L2 }));
    bodies.push(bodyData({ type: 'rectangle', x: ax, y: ay - 8, width: 150, height: 14, isStatic: true, label: 'Beam' }));
    out.push({
      key: 'doublependulum', name: '双摆混沌',
      scene: sceneData({ name: '双摆混沌 Double Pendulum', bodies, constraints, settings: { ...DEFAULT_SETTINGS, showTrails: true } }),
    });
  }

  // Plank bridge on two piers, chained with stiff springs, carrying a heavy load.
  {
    const bodies = frameBodies();
    const constraints = [];
    const deckY = 372, n = 7, pw = 92;
    bodies.push(bodyData({ id: 'bridge-pier-l', type: 'rectangle', x: 330, y: 460, width: 64, height: 160, isStatic: true, friction: 0.6, label: 'Pier' }));
    bodies.push(bodyData({ id: 'bridge-pier-r', type: 'rectangle', x: 950, y: 460, width: 64, height: 160, isStatic: true, friction: 0.6, label: 'Pier' }));
    const firstCx = 330 + 32 + pw / 2; // 408
    for (let i = 0; i < n; i++) {
      bodies.push(bodyData({
        id: `bridge-plank-${i}`, type: 'rectangle', x: firstCx + i * pw, y: deckY,
        width: pw - 2, height: 14, density: 0.0012, friction: 0.5, restitution: 0.05, label: 'Plank',
      }));
    }
    const link = (a, b, pa, pb, len) => constraints.push(constraintData({
      bodyA: a, bodyB: b, pointA: pa, pointB: pb, stiffness: 0.85, damping: 0.08, length: len,
    }));
    link('bridge-pier-l', 'bridge-plank-0', { x: 32, y: -80 }, { x: -pw / 2, y: 0 }, 14);
    for (let i = 0; i < n - 1; i++) link(`bridge-plank-${i}`, `bridge-plank-${i + 1}`, { x: pw / 2, y: 0 }, { x: -pw / 2, y: 0 }, 2);
    link('bridge-pier-r', `bridge-plank-${n - 1}`, { x: -32, y: -80 }, { x: pw / 2, y: 0 }, 14);
    bodies.push(bodyData({ type: 'rectangle', x: 640, y: deckY - 42, width: 56, height: 56, density: 0.005, friction: 0.6, label: 'Heavy Load' }));
    bodies.push(bodyData({ type: 'circle', x: 500, y: deckY - 30, radius: 21, density: 0.003, restitution: 0.2, label: 'Load Ball' }));
    out.push({ key: 'bridge', name: '桥梁承重', scene: sceneData({ name: '桥梁承重 Plank Bridge', bodies, constraints }) });
  }

  // Galton board — balls rain through staggered pegs into bins (probability in action).
  {
    const bodies = frameBodies();
    // entry guides
    bodies.push(bodyData({ type: 'rectangle', x: 486, y: 96, width: 250, height: 14, angle: 0.5, isStatic: true, friction: 0.1, label: 'Guide' }));
    bodies.push(bodyData({ type: 'rectangle', x: 794, y: 96, width: 250, height: 14, angle: -0.5, isStatic: true, friction: 0.1, label: 'Guide' }));
    // pegs
    for (let row = 0; row < 6; row++) {
      const y = 208 + row * 40;
      const off = row % 2 ? 32 : 0;
      for (let x = 424 + off; x <= 856; x += 64) {
        bodies.push(bodyData({ type: 'circle', x, y, radius: 7, isStatic: true, friction: 0.05, restitution: 0.4, label: 'Peg' }));
      }
    }
    // bins
    for (let i = 0; i <= 8; i++) {
      bodies.push(bodyData({ type: 'rectangle', x: 392 + i * 64, y: 492, width: 8, height: 96, isStatic: true, friction: 0.2, label: 'Bin Wall' }));
    }
    // balls queued above the entry
    for (let i = 0; i < 12; i++) {
      bodies.push(bodyData({
        type: 'circle', x: 628 + (i % 2) * 24, y: 24 + Math.floor(i / 2) * 27, radius: 11,
        restitution: 0.35, friction: 0.05, frictionAir: 0.002, label: 'Ball',
      }));
    }
    out.push({ key: 'galton', name: '钉板概率', scene: sceneData({ name: '钉板概率 Galton Board', bodies }) });
  }

  // Trampoline — springy net of chained segments between two posts.
  {
    const bodies = frameBodies();
    const constraints = [];
    const netY = 372, n = 6, segW = 78;
    bodies.push(bodyData({ id: 'tramp-post-l', type: 'rectangle', x: 380, y: 456, width: 26, height: 168, isStatic: true, friction: 0.5, label: 'Post' }));
    bodies.push(bodyData({ id: 'tramp-post-r', type: 'rectangle', x: 900, y: 456, width: 26, height: 168, isStatic: true, friction: 0.5, label: 'Post' }));
    const span = (900 - 13) - (380 + 13); // 494 between inner faces
    const step = span / n;
    for (let i = 0; i < n; i++) {
      bodies.push(bodyData({
        id: `tramp-seg-${i}`, type: 'rectangle', x: 393 + step * (i + 0.5), y: netY,
        width: segW, height: 8, density: 0.0008, friction: 0.4, restitution: 0.1, label: 'Net',
      }));
    }
    const spring = (a, b, pa, pb, len) => constraints.push(constraintData({
      bodyA: a, bodyB: b, pointA: pa, pointB: pb, stiffness: 0.22, damping: 0.05, length: len,
    }));
    spring('tramp-post-l', 'tramp-seg-0', { x: 13, y: -84 }, { x: -segW / 2, y: 0 }, 6);
    for (let i = 0; i < n - 1; i++) spring(`tramp-seg-${i}`, `tramp-seg-${i + 1}`, { x: segW / 2, y: 0 }, { x: -segW / 2, y: 0 }, step - segW);
    spring('tramp-post-r', `tramp-seg-${n - 1}`, { x: -13, y: -84 }, { x: segW / 2, y: 0 }, 6);
    bodies.push(bodyData({ type: 'circle', x: 640, y: 190, radius: 27, density: 0.003, restitution: 0.15, frictionAir: 0.002, label: 'Jumper' }));
    bodies.push(bodyData({ type: 'rectangle', x: 760, y: 120, width: 44, height: 44, density: 0.002, restitution: 0.1, label: 'Box' }));
    out.push({ key: 'trampoline', name: '蹦床弹簧网', scene: sceneData({ name: '蹦床弹簧网 Trampoline', bodies, constraints }) });
  }

  // Funnel — small balls pour through a V funnel into the bin below.
  {
    const bodies = frameBodies();
    bodies.push(bodyData({ type: 'rectangle', x: 517, y: 258, width: 252, height: 16, angle: 0.71, isStatic: true, friction: 0.1, label: 'Funnel Wall' }));
    bodies.push(bodyData({ type: 'rectangle', x: 763, y: 258, width: 252, height: 16, angle: -0.71, isStatic: true, friction: 0.1, label: 'Funnel Wall' }));
    bodies.push(bodyData({ type: 'rectangle', x: 470, y: 486, width: 10, height: 108, isStatic: true, label: 'Bin Wall' }));
    bodies.push(bodyData({ type: 'rectangle', x: 810, y: 486, width: 10, height: 108, isStatic: true, label: 'Bin Wall' }));
    for (let i = 0; i < 16; i++) {
      bodies.push(bodyData({
        type: 'circle', x: 520 + (i % 8) * 34, y: 84 + Math.floor(i / 8) * 30, radius: 10.5,
        restitution: 0.25, friction: 0.08, frictionAir: 0.002, label: 'Bead',
      }));
    }
    out.push({ key: 'funnel', name: '漏斗沙漏', scene: sceneData({ name: '漏斗沙漏 Funnel', bodies }) });
  }

  // Loop coaster — a ball on a rigid guide rod races around inside a ring
  // track. (A free-riding ball cannot reliably loop in Matter: chord corners
  // block a flat entry and the climb is energy-marginal. The rod guarantees
  // the loop; measured ~1.7 full loops before it settles into a swing.)
  {
    const bodies = frameBodies();
    const C = { x: 730, y: 380 }, R = 114, rp = 84.5;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      bodies.push(bodyData({
        type: 'rectangle', x: C.x + Math.cos(a) * R, y: C.y + Math.sin(a) * R,
        width: 34, height: 13, angle: a + Math.PI / 2, isStatic: true, friction: 0.05, label: 'Loop Track',
      }));
    }
    bodies.push(bodyData({ type: 'circle', x: C.x, y: C.y, radius: 10, isStatic: true, label: 'Hub' }));
    bodies.push(bodyData({ type: 'rectangle', x: 690, y: 517, width: 12, height: 46, isStatic: true, label: 'Support' }));
    bodies.push(bodyData({ type: 'rectangle', x: 770, y: 517, width: 12, height: 46, isStatic: true, label: 'Support' }));
    const th = -130 * Math.PI / 180, u = 8.5;
    const ball = bodyData({
      type: 'circle', x: C.x + Math.cos(th) * rp, y: C.y + Math.sin(th) * rp, radius: 15,
      friction: 0.01, frictionAir: 0.001, restitution: 0, density: 0.002, label: 'Coaster Ball',
    });
    ball.vx = u * Math.sin(th);
    ball.vy = u * -Math.cos(th);
    bodies.push(ball);
    bodies.push(bodyData({ type: 'circle', x: 140, y: 505, radius: 14, restitution: 0.4, label: 'Free Ball' }));
    const rod = constraintData({ bodyA: null, bodyB: ball.id, pointA: { x: C.x, y: C.y }, pointB: { x: 0, y: 0 }, stiffness: 1, damping: 0, length: rp });
    out.push({ key: 'coaster', name: '过山车回环', scene: sceneData({ name: '过山车回环 Loop Coaster', bodies, constraints: [rod] }) });
  }

  // Bowling — one heavy ball vs a pyramid cluster of six triangle pins.
  {
    const bodies = frameBodies();
    bodies.push(bodyData({ type: 'circle', x: 210, y: GROUND_TOP - 26, radius: 26, density: 0.006, friction: 0.08, restitution: 0.1, vx: 10.5, label: 'Bowling Ball' }));
    const pinRows = [
      { y: GROUND_TOP - 21, xs: [950, 995, 1040] },
      { y: GROUND_TOP - 62, xs: [972, 1017] },
      { y: GROUND_TOP - 103, xs: [995] },
    ];
    for (const row of pinRows) {
      for (const x of row.xs) {
        bodies.push(bodyData({
          type: 'polygon', x, y: row.y, sides: 3, radius: 24,
          density: 0.0008, friction: 0.3, restitution: 0.2, label: 'Pin',
        }));
      }
    }
    out.push({ key: 'bowling', name: '保龄球', scene: sceneData({ name: '保龄球 Bowling', bodies }) });
  }

  // Orbital gravitation — pairwise Newtonian attraction (scene gravitation
  // setting), ordinary gravity OFF. Launch speeds are PhysicsEngine's
  // Formulas.orbitVelocity(G, M_sun, r) with M_sun = density × π r²
  // = 0.004 × π × 26² ≈ 8.49: r=180 → ≈1.19 px/step, r=240 → ≈1.03 px/step.
  // NOTE: no frame bodies here on purpose — under pairwise gravitation the
  // ground/walls (huge area × density) would out-pull the sun and wreck the
  // orbit. Space has no floor.
  {
    const bodies = [];
    const sun = { x: 640, y: 290 };
    bodies.push(bodyData({ type: 'circle', x: sun.x, y: sun.y, radius: 26, density: 0.004, isStatic: true, frictionAir: 0, label: 'Sun 恒星' }));
    bodies.push(bodyData({ type: 'circle', x: sun.x + 180, y: sun.y, radius: 13, density: 0.002, frictionAir: 0, restitution: 0, vy: -1.19, label: 'Planet 行星' }));
    bodies.push(bodyData({ type: 'circle', x: sun.x - 240, y: sun.y, radius: 10, density: 0.002, frictionAir: 0, restitution: 0, vy: 1.03, label: 'Planet 行星' }));
    out.push({
      key: 'orbit', name: '万有引力轨道',
      scene: sceneData({
        name: '万有引力轨道 Orbital Gravitation', bodies,
        settings: { ...DEFAULT_SETTINGS, gravityEnabled: false, gravitation: 30, gravitationSoftening: 100, showTrails: true },
      }),
    });
  }

  // Buoyancy pool — one fluid region, three densities: cork floats high,
  // wood sits at the surface, iron sinks to the tank floor.
  {
    const bodies = frameBodies();
    bodies.push(bodyData({ type: 'rectangle', x: 254, y: 455, width: 12, height: 170, isStatic: true, friction: 0.4, label: 'Tank Wall' }));
    bodies.push(bodyData({ type: 'rectangle', x: 1026, y: 455, width: 12, height: 170, isStatic: true, friction: 0.4, label: 'Tank Wall' }));
    bodies.push(bodyData({ type: 'rectangle', x: 420, y: 300, width: 56, height: 56, density: 0.0003, friction: 0.4, label: 'Cork 软木' }));
    bodies.push(bodyData({ type: 'rectangle', x: 640, y: 250, width: 56, height: 56, density: 0.0008, friction: 0.4, label: 'Wood 木块' }));
    bodies.push(bodyData({ type: 'rectangle', x: 860, y: 300, width: 48, height: 48, density: 0.008, friction: 0.4, label: 'Iron 铁块' }));
    out.push({
      key: 'buoyancy', name: '浮力池',
      scene: sceneData({
        name: '浮力池 Buoyancy Pool', bodies,
        fluids: [fluidData({ x: 640, y: 455, width: 760, height: 170, density: 0.0012, drag: 0.03 })],
      }),
    });
  }

  // Magnet array — two fixed poles (N +90 / S −90) sort loose magnetic
  // balls by polarity: opposite poles attract, like poles repel, and plain
  // iron balls are pulled to whichever magnet they fall near.
  {
    const bodies = frameBodies();
    bodies.push(bodyData({ type: 'circle', x: 430, y: 300, radius: 26, isStatic: true, friction: 0.4, magnet: 100, label: 'Magnet N 磁铁' }));
    bodies.push(bodyData({ type: 'circle', x: 850, y: 300, radius: 26, isStatic: true, friction: 0.4, magnet: -100, label: 'Magnet S 磁铁' }));
    bodies.push(bodyData({ type: 'circle', x: 548, y: 300, radius: 16, density: 0.0015, friction: 0.4, frictionAir: 0.002, restitution: 0.2, magnet: -80, label: 'S Ball 磁球' }));
    bodies.push(bodyData({ type: 'circle', x: 732, y: 300, radius: 16, density: 0.0015, friction: 0.4, frictionAir: 0.002, restitution: 0.2, magnet: 80, label: 'N Ball 磁球' }));
    bodies.push(bodyData({ type: 'circle', x: 430, y: 170, radius: 14, density: 0.003, friction: 0.4, frictionAir: 0.002, restitution: 0.2, label: 'Iron Ball 铁球' }));
    bodies.push(bodyData({ type: 'circle', x: 850, y: 170, radius: 14, density: 0.003, friction: 0.4, frictionAir: 0.002, restitution: 0.2, label: 'Iron Ball 铁球' }));
    bodies.push(bodyData({ type: 'circle', x: 500, y: 520, radius: 14, density: 0.003, friction: 0.4, frictionAir: 0.002, restitution: 0.2, label: 'Iron Ball 铁球' }));
    bodies.push(bodyData({ type: 'circle', x: 780, y: 520, radius: 14, density: 0.003, friction: 0.4, frictionAir: 0.002, restitution: 0.2, label: 'Iron Ball 铁球' }));
    out.push({ key: 'magnets', name: '磁铁阵列', scene: sceneData({ name: '磁铁阵列 Magnet Array', bodies }) });
  }

  // Wind tunnel — one wide wind field blows light balls and paper across
  // the stage while a wood block creeps and an iron block stays put:
  // the blend rate scales with (reference density / body density).
  {
    const bodies = frameBodies();
    bodies.push(bodyData({ type: 'rectangle', x: 270, y: 486, width: 300, height: 14, isStatic: true, friction: 0.4, label: 'Shelf 平台' }));
    for (let i = 0; i < 3; i++) {
      bodies.push(bodyData({ type: 'circle', x: 190 + i * 45, y: 450, radius: 13, density: 0.0003, friction: 0.3, frictionAir: 0.002, restitution: 0.4, label: 'Foam Ball 泡沫球' }));
    }
    bodies.push(bodyData({ type: 'rectangle', x: 200, y: 200, width: 34, height: 10, density: 0.0002, friction: 0.3, frictionAir: 0.002, restitution: 0.2, label: 'Paper 纸片' }));
    bodies.push(bodyData({ type: 'rectangle', x: 260, y: 160, width: 34, height: 10, density: 0.0002, friction: 0.3, frictionAir: 0.002, restitution: 0.2, label: 'Paper 纸片' }));
    bodies.push(bodyData({ type: 'rectangle', x: 330, y: 505, width: 44, height: 44, density: 0.02, friction: 0.9, frictionAir: 0.002, restitution: 0.1, label: 'Iron 铁块' }));
    bodies.push(bodyData({ type: 'rectangle', x: 430, y: 505, width: 44, height: 44, density: 0.001, friction: 0.5, frictionAir: 0.002, restitution: 0.1, label: 'Wood 木块' }));
    bodies.push(bodyData({ type: 'rectangle', x: 700, y: 380, width: 200, height: 14, angle: -0.15, isStatic: true, friction: 0.2, label: 'Ramp 斜坡' }));
    bodies.push(bodyData({ type: 'rectangle', x: 1000, y: 490, width: 12, height: 100, isStatic: true, friction: 0.4, label: 'Bin Wall 收集墙' }));
    out.push({
      key: 'windtunnel', name: '风洞实验',
      scene: sceneData({
        name: '风洞实验 Wind Tunnel', bodies,
        winds: [windData({ x: 640, y: 320, width: 1000, height: 420, vx: 5, vy: 0, power: 1 })],
      }),
    });
  }

  // Materials lab — five balls of different materials race down one ramp:
  // ice slides, rubber grips and bounces, iron ploughs through the crates.
  // The same five materials are one tap away in the body panel (1.26).
  {
    const bodies = frameBodies();
    bodies.push(bodyData({ type: 'rectangle', x: 640, y: 360, width: 900, height: 16, angle: 0.14, isStatic: true, friction: 0.15, label: 'Ramp 斜坡' }));
    const mats = [
      ['Foam 泡沫球', { density: 0.0003, friction: 0.3, restitution: 0.4 }],
      ['Wood 木球', { density: 0.001, friction: 0.45, restitution: 0.2 }],
      ['Rubber 橡胶球', { density: 0.0011, friction: 0.9, restitution: 0.85 }],
      ['Ice 冰球', { density: 0.0009, friction: 0.03, restitution: 0.05 }],
      ['Iron 铁球', { density: 0.008, friction: 0.5, restitution: 0.1 }],
    ];
    mats.forEach(([label, m], i) => {
      const x = 250 + i * 46;
      const y = 360 + Math.tan(0.14) * (x - 640) - 26;
      bodies.push(bodyData({ type: 'circle', x, y, radius: 16, frictionAir: 0.001, label, ...m }));
    });
    for (let i = 0; i < 3; i++) {
      bodies.push(bodyData({ type: 'rectangle', x: 1060, y: GROUND_TOP - 22 - i * 45, width: 44, height: 44, density: 0.001, friction: 0.5, label: 'Crate 木箱' }));
    }
    out.push({ key: 'materials', name: '材质实验室', scene: sceneData({ name: '材质实验室 Materials Lab', bodies }) });
  }

  // Magnet swing — an S-pole pendulum ball swings past a fixed N magnet
  // and ends up hanging pulled toward it instead of straight down.
  {
    const bodies = frameBodies();
    bodies.push(bodyData({ type: 'rectangle', x: 640, y: 92, width: 300, height: 14, isStatic: true, label: 'Beam 横梁' }));
    bodies.push(bodyData({ id: 'swing-ball', type: 'circle', x: 640, y: 332, radius: 16, density: 0.0015, friction: 0.2, frictionAir: 0.0005, restitution: 0.2, magnet: -80, vx: 3, label: 'S Ball 磁球' }));
    bodies.push(bodyData({ type: 'circle', x: 800, y: 372, radius: 26, isStatic: true, friction: 0.4, magnet: 100, label: 'Magnet N 磁铁' }));
    const constraints = [constraintData({ bodyA: null, bodyB: 'swing-ball', pointA: { x: 640, y: 100 }, pointB: { x: 0, y: 0 }, stiffness: 1, damping: 0.02, length: 232 })];
    out.push({ key: 'magnetswing', name: '磁铁秋千', scene: sceneData({ name: '磁铁秋千 Magnet Swing', bodies, constraints }) });
  }

  // Motor windmill (1.28) — a rotor bar pinned at its centre to a fixed
  // mount, driven by a hinge motor; ball tips ride the bar ends.
  {
    const bodies = frameBodies();
    bodies.push(bodyData({ id: 'wm-post', type: 'rectangle', x: 640, y: 430, width: 26, height: 300, isStatic: true, friction: 0.5, label: 'Post 支柱' }));
    bodies.push(bodyData({ id: 'wm-hub', type: 'circle', x: 640, y: 280, radius: 15, isStatic: true, friction: 0.4, label: 'Hub 轮毂' }));
    bodies.push(bodyData({ id: 'wm-rotor', type: 'rectangle', x: 640, y: 280, width: 300, height: 22, density: 0.0015, friction: 0.3, frictionAir: 0.001, label: 'Rotor 转子' }));
    bodies.push(bodyData({ id: 'wm-tip-l', type: 'circle', x: 490, y: 280, radius: 17, density: 0.002, friction: 0.3, frictionAir: 0.001, label: 'Tip 球' }));
    bodies.push(bodyData({ id: 'wm-tip-r', type: 'circle', x: 790, y: 280, radius: 17, density: 0.002, friction: 0.3, frictionAir: 0.001, label: 'Tip 球' }));
    const hinges = [
      hingeData({ bodyA: null, bodyB: 'wm-rotor', pointA: { x: 640, y: 280 }, pointB: { x: 0, y: 0 }, motorSpeed: 0.05 }),
      hingeData({ bodyA: 'wm-rotor', bodyB: 'wm-tip-l', pointA: { x: -150, y: 0 }, pointB: { x: 0, y: 0 } }),
      hingeData({ bodyA: 'wm-rotor', bodyB: 'wm-tip-r', pointA: { x: 150, y: 0 }, pointB: { x: 0, y: 0 } }),
      // cluster linkage: the rotor sweeps through the post/hub space as
      // it turns; as one machine they must not collide with each other
      hingeData({ bodyA: 'wm-post', bodyB: 'wm-hub', pointA: { x: 0, y: -150 }, pointB: { x: 0, y: 0 } }),
      hingeData({ bodyA: 'wm-hub', bodyB: 'wm-rotor', pointA: { x: 0, y: 0 }, pointB: { x: 0, y: 0 } }),
    ];
    out.push({ key: 'windmill', name: '马达风车', scene: sceneData({ name: '马达风车 Motor Windmill', bodies, hinges }) });
  }

  // Ferris wheel (1.28, fixed 1.29) — two crossed bars on motor hinges.
  // Three measured lessons shaped this build:
  // 1. The bars are locked at 90° by two triangulating rods: independent
  //    hub motors regulate speed, never phase, so without the rods the
  //    cross folds shut (81° of drift in 60 s) and the wheel stalls into
  //    rocking instead of turning.
  // 2. Cabins hinge at their CENTRE on the arm ends. A hinge pin offset
  //    from a body's centre is not a free pendulum pivot in Matter's
  //    solver (a displaced body stays displaced), and a rod-hung cabin
  //    swings into its own arm at the top of the wheel; a centre hinge
  //    exerts no torque, so cabins keep their upright orientation.
  // 3. The legs and hub carry decorative hinges so the WHOLE machine is
  //    one hinge cluster: in 2D the A-frame legs converge inside the
  //    wheel's disc, and orbiting cabins would clip them and get spun;
  //    cluster members never collide with each other (outside objects
  //    still collide with every part normally).
  {
    const bodies = frameBodies();
    bodies.push(bodyData({ id: 'fw-leg-l', type: 'rectangle', x: 575, y: 420, width: 20, height: 300, angle: 0.42, isStatic: true, friction: 0.5, label: 'Leg 支架' }));
    bodies.push(bodyData({ id: 'fw-leg-r', type: 'rectangle', x: 705, y: 420, width: 20, height: 300, angle: -0.42, isStatic: true, friction: 0.5, label: 'Leg 支架' }));
    bodies.push(bodyData({ id: 'fw-hub', type: 'circle', x: 640, y: 270, radius: 14, isStatic: true, friction: 0.4, label: 'Hub 轮毂' }));
    bodies.push(bodyData({ id: 'fw-bar-h', type: 'rectangle', x: 640, y: 270, width: 340, height: 16, density: 0.0012, friction: 0.3, frictionAir: 0.001, label: 'Arm 横臂' }));
    bodies.push(bodyData({ id: 'fw-bar-v', type: 'rectangle', x: 640, y: 270, width: 16, height: 340, density: 0.0012, friction: 0.3, frictionAir: 0.001, label: 'Arm 竖臂' }));
    const hinges = [
      hingeData({ bodyA: null, bodyB: 'fw-bar-h', pointA: { x: 640, y: 270 }, pointB: { x: 0, y: 0 }, motorSpeed: 0.012 }),
      hingeData({ bodyA: null, bodyB: 'fw-bar-v', pointA: { x: 640, y: 270 }, pointB: { x: 0, y: 0 }, motorSpeed: 0.012 }),
      // cluster linkage only (both ends static; the solver ignores them)
      hingeData({ bodyA: 'fw-leg-l', bodyB: 'fw-hub', pointA: { x: 0, y: -150 }, pointB: { x: 0, y: 0 } }),
      hingeData({ bodyA: 'fw-leg-r', bodyB: 'fw-hub', pointA: { x: 0, y: -150 }, pointB: { x: 0, y: 0 } }),
      hingeData({ bodyA: 'fw-hub', bodyB: 'fw-bar-h', pointA: { x: 0, y: 0 }, pointB: { x: 0, y: 0 } }),
      // links the vertical arm (and its cabins) into the same cluster —
      // the cross rods are plain constraints and do NOT link clusters,
      // so without this hinge the two arms collide at the crossing
      hingeData({ bodyA: 'fw-bar-h', bodyB: 'fw-bar-v', pointA: { x: 0, y: 0 }, pointB: { x: 0, y: 0 } }),
    ];
    const rodLen = Math.hypot(140, 140);
    const constraints = [
      constraintData({ bodyA: 'fw-bar-h', bodyB: 'fw-bar-v', pointA: { x: 140, y: 0 }, pointB: { x: 0, y: 140 }, stiffness: 1, damping: 0.1, length: rodLen }),
      constraintData({ bodyA: 'fw-bar-h', bodyB: 'fw-bar-v', pointA: { x: -140, y: 0 }, pointB: { x: 0, y: -140 }, stiffness: 1, damping: 0.1, length: rodLen }),
    ];
    const cabDefs = [
      ['fw-bar-h', { x: -170, y: 0 }, 470, 270], ['fw-bar-h', { x: 170, y: 0 }, 810, 270],
      ['fw-bar-v', { x: 0, y: -170 }, 640, 100], ['fw-bar-v', { x: 0, y: 170 }, 640, 440],
    ];
    cabDefs.forEach(([arm, pa, cx, cy], i) => {
      const id = `fw-cab-${i + 1}`;
      bodies.push(bodyData({ id, type: 'rectangle', x: cx, y: cy, width: 46, height: 32, density: 0.001, friction: 0.4, frictionAir: 0.008, label: 'Cabin 座舱' }));
      hinges.push(hingeData({ bodyA: arm, bodyB: id, pointA: pa, pointB: { x: 0, y: 0 } }));
    });
    out.push({ key: 'ferris', name: '摩天轮', scene: sceneData({ name: '摩天轮 Ferris Wheel', bodies, hinges, constraints }) });
  }

  // Pinwheel (1.30) — a windmill driven ONLY by a wind region (no motor):
  // the wind band covers just the top half of the rotor, so each sail is
  // pushed sideways as it crosses the top and coasts around the bottom —
  // an undershot-wheel drive that works with the wind model's
  // centre-of-mass blending (a symmetric rotor in a uniform full field
  // would see its torques cancel). Structure reuses the ferris lessons:
  // triangulating rods lock the cross, and post/arms/sails form one
  // hinge cluster. The region gusts (engine 1.8.0), so the wheel
  // visibly surges and settles: measured ω ≈ 0.013 rad/step steady
  // (≈8 s/rev), breathing 0.010–0.016 with gust 0.5 / 8 s.
  {
    const bodies = frameBodies();
    bodies.push(bodyData({ id: 'pw-post', type: 'rectangle', x: 640, y: 395, width: 24, height: 290, isStatic: true, friction: 0.5, label: 'Post 支柱' }));
    bodies.push(bodyData({ id: 'pw-bar-h', type: 'rectangle', x: 640, y: 250, width: 400, height: 14, density: 0.0012, friction: 0.3, frictionAir: 0.002, label: 'Arm 横臂' }));
    bodies.push(bodyData({ id: 'pw-bar-v', type: 'rectangle', x: 640, y: 250, width: 14, height: 400, density: 0.0012, friction: 0.3, frictionAir: 0.002, label: 'Arm 竖臂' }));
    const hinges = [
      hingeData({ bodyA: null, bodyB: 'pw-bar-h', pointA: { x: 640, y: 250 }, pointB: { x: 0, y: 0 }, motorSpeed: 0 }),
      hingeData({ bodyA: null, bodyB: 'pw-bar-v', pointA: { x: 640, y: 250 }, pointB: { x: 0, y: 0 }, motorSpeed: 0 }),
      hingeData({ bodyA: 'pw-bar-h', bodyB: 'pw-bar-v', pointA: { x: 0, y: 0 }, pointB: { x: 0, y: 0 } }),
      hingeData({ bodyA: 'pw-post', bodyB: 'pw-bar-h', pointA: { x: 0, y: -145 }, pointB: { x: 0, y: 0 } }),
    ];
    const rodLen = Math.hypot(140, 140);
    const constraints = [
      constraintData({ bodyA: 'pw-bar-h', bodyB: 'pw-bar-v', pointA: { x: 140, y: 0 }, pointB: { x: 0, y: 140 }, stiffness: 1, damping: 0.1, length: rodLen }),
      constraintData({ bodyA: 'pw-bar-h', bodyB: 'pw-bar-v', pointA: { x: -140, y: 0 }, pointB: { x: 0, y: -140 }, stiffness: 1, damping: 0.1, length: rodLen }),
    ];
    const tilt = 0.61; // sails pitched ~35°, classic pinwheel look
    const sailDefs = [
      ['pw-bar-h', { x: 200, y: 0 }, 840, 250, tilt],
      ['pw-bar-v', { x: 0, y: 200 }, 640, 450, tilt + Math.PI / 2],
      ['pw-bar-h', { x: -200, y: 0 }, 440, 250, tilt + Math.PI],
      ['pw-bar-v', { x: 0, y: -200 }, 640, 50, tilt - Math.PI / 2],
    ];
    sailDefs.forEach(([arm, pa, cx, cy, ang], i) => {
      const id = `pw-sail-${i + 1}`;
      bodies.push(bodyData({ id, type: 'rectangle', x: cx, y: cy, width: 76, height: 50, angle: ang, density: 0.0006, friction: 0.3, frictionAir: 0.004, label: 'Sail 帆叶' }));
      hinges.push(hingeData({ bodyA: arm, bodyB: id, pointA: pa, pointB: { x: 0, y: 0 } }));
    });
    out.push({ key: 'pinwheel', name: '风车', scene: sceneData({
      name: '风车 Pinwheel', bodies, hinges, constraints,
      winds: [windData({ x: 640, y: 148, width: 780, height: 204, vx: 5, vy: 0, power: 1, gust: 0.5, gustPeriod: 8 })],
    }) });
  }

  return out;
}
