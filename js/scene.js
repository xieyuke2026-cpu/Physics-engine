/* scene.js — pure scene data model: defaults, serialization shape, validation.
   No DOM, no Matter dependency, so it can be unit-tested in Node. */

export const SCENE_FORMAT = 'motionlab-scene';
export const SCENE_VERSION = 1;
export const BODY_TYPES = ['circle', 'rectangle', 'polygon', 'line'];

export const DEFAULT_SETTINGS = {
  gravityX: 0,
  gravityY: 1,
  gravityEnabled: true,
  speed: 1,
  showGrid: true,
  showVectors: false,
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
    vx: num(partial.vx, 0),
    vy: num(partial.vy, 0),
    label: typeof partial.label === 'string' ? partial.label : '',
  };
  if (type === 'line') { d.isStatic = true; d.height = Math.min(d.height, 10); }
  return d;
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
  if (raw.version !== SCENE_VERSION) errors.push(`version 必须为 ${SCENE_VERSION}`);
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
