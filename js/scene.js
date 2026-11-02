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
    fluids: Array.isArray(partial.fluids) ? partial.fluids.map(fluidData) : [],
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
    for (const k of ['width', 'height', 'radius', 'density', 'friction', 'restitution']) {
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
  if (raw.fluids !== undefined) {
    if (!Array.isArray(raw.fluids)) errors.push('fluids 必须是数组');
    else {
      if (raw.fluids.length > 20) errors.push('流体区域数量超过上限 20');
      raw.fluids.forEach((f, i) => {
        if (!f || typeof f !== 'object') { errors.push(`fluids[${i}] 不是对象`); return; }
        for (const k of ['x', 'y', 'width', 'height', 'density', 'drag']) {
          if (f[k] !== undefined && !Number.isFinite(Number(f[k]))) errors.push(`fluids[${i}].${k} 必须是有限数字`);
        }
      });
    }
  }
  const s = raw.settings;
  if (s !== undefined) {
    if (!s || typeof s !== 'object') errors.push('settings 必须是对象');
    else {
      for (const k of ['gravityX', 'gravityY', 'speed', 'gravitation', 'gravitationSoftening']) {
        if (s[k] !== undefined && !Number.isFinite(Number(s[k]))) errors.push(`settings.${k} 必须是有限数字`);
      }
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

  return out;
}
