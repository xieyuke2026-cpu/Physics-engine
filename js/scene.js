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

export function sceneData(partial = {}) {
  return {
    format: SCENE_FORMAT,
    version: SCENE_VERSION,
    name: typeof partial.name === 'string' && partial.name.trim() ? partial.name.trim() : 'Untitled Scene',
    settings: { ...DEFAULT_SETTINGS, ...(partial.settings || {}) },
    bodies: Array.isArray(partial.bodies) ? partial.bodies.map(bodyData) : [],
    constraints: Array.isArray(partial.constraints) ? partial.constraints.map(constraintData).filter((c) => c.bodyB) : [],
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
  const s = raw.settings;
  if (s !== undefined) {
    if (!s || typeof s !== 'object') errors.push('settings 必须是对象');
    else {
      for (const k of ['gravityX', 'gravityY', 'speed']) {
        if (s[k] !== undefined && !Number.isFinite(Number(s[k]))) errors.push(`settings.${k} 必须是有限数字`);
      }
      if (s.speed !== undefined && (Number(s.speed) <= 0 || Number(s.speed) > 4)) errors.push('settings.speed 超出范围 (0, 4]');
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

  return out;
}
