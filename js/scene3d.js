/* scene3d.js — 3D scene data model: defaults, serialization, validation, presets.
   Kept separate from scene.js so 2D and 3D scenes/presets never mix.
   Units are metres; Y is up; gravity default (0, -9.82, 0). */

export const SCENE3D_FORMAT = 'motionlab-scene-3d';
export const SCENE3D_VERSION = 1;
export const BODY3D_KINDS = ['box', 'sphere'];

export const DEFAULT_SETTINGS_3D = {
  gravityX: 0,
  gravityY: -9.82,
  gravityZ: 0,
  gravityEnabled: true,
  speed: 1,
  friction: 0.4,
  restitution: 0.25,
};

let _uid = 1;
export function nextId3(prefix = 'body3') {
  return `${prefix}-${Date.now().toString(36)}-${(_uid++).toString(36)}`;
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Plain-data 3D body (what gets saved / passed to PhysicsEngine3D). */
export function bodyData3D(partial = {}) {
  const kind = BODY3D_KINDS.includes(partial.kind) ? partial.kind : 'box';
  return {
    id: typeof partial.id === 'string' && partial.id ? partial.id : nextId3(),
    kind,
    x: num(partial.x, 0), y: num(partial.y, 1), z: num(partial.z, 0),
    sizeX: Math.max(0.05, num(partial.sizeX, 1)),
    sizeY: Math.max(0.05, num(partial.sizeY, 1)),
    sizeZ: Math.max(0.05, num(partial.sizeZ, 1)),
    radius: Math.max(0.05, num(partial.radius, 0.5)),
    euler: {
      x: num(partial.euler && partial.euler.x, 0),
      y: num(partial.euler && partial.euler.y, 0),
      z: num(partial.euler && partial.euler.z, 0),
    },
    quaternion: partial.quaternion && Number.isFinite(Number(partial.quaternion.w))
      ? { x: num(partial.quaternion.x, 0), y: num(partial.quaternion.y, 0), z: num(partial.quaternion.z, 0), w: num(partial.quaternion.w, 1) }
      : null,
    mass: Math.max(0, num(partial.mass, 1)),
    isStatic: partial.isStatic === true,
    isBound: partial.isBound === true,
    lockRotation: partial.lockRotation === true,
    vx: num(partial.vx, 0), vy: num(partial.vy, 0), vz: num(partial.vz, 0),
    label: typeof partial.label === 'string' ? partial.label : '',
  };
}

export function sceneData3D(partial = {}) {
  return {
    format: SCENE3D_FORMAT,
    version: SCENE3D_VERSION,
    name: typeof partial.name === 'string' && partial.name.trim() ? partial.name.trim() : 'Untitled 3D Scene',
    settings: { ...DEFAULT_SETTINGS_3D, ...(partial.settings || {}) },
    bodies: Array.isArray(partial.bodies) ? partial.bodies.map(bodyData3D) : [],
    updatedAt: num(partial.updatedAt, Date.now()),
  };
}

export function validateScene3D(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['场景不是对象'] };
  if (raw.format !== SCENE3D_FORMAT) errors.push(`format 必须是 ${SCENE3D_FORMAT}`);
  if (raw.version !== undefined && raw.version !== SCENE3D_VERSION) errors.push(`不支持的 3D 场景版本 ${raw.version}`);
  if (!Array.isArray(raw.bodies)) errors.push('bodies 必须是数组');
  else {
    const ids = new Set();
    raw.bodies.forEach((b, i) => {
      if (!b || typeof b !== 'object') { errors.push(`bodies[${i}] 不是对象`); return; }
      if (!BODY3D_KINDS.includes(b.kind)) errors.push(`bodies[${i}].kind 不支持：${b.kind}`);
      for (const k of ['x', 'y', 'z']) if (!Number.isFinite(Number(b[k]))) errors.push(`bodies[${i}].${k} 必须是有限数字`);
      if (b.id) { if (ids.has(b.id)) errors.push(`bodies[${i}].id 重复：${b.id}`); ids.add(b.id); }
    });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], scene: sceneData3D(raw) };
}

/** Ground slab shared by the starter scene and presets. Top surface at y=0. */
export function frameBodies3D() {
  return [
    bodyData3D({ id: 'bound-ground3', kind: 'box', x: 0, y: -0.5, z: 0, sizeX: 44, sizeY: 1, sizeZ: 44, isStatic: true, isBound: true, label: 'Ground' }),
  ];
}

export function defaultScene3D() {
  const bodies = frameBodies3D();
  bodies.push(bodyData3D({ kind: 'box', x: -2.2, y: 0.5, z: 0, label: 'Box' }));
  bodies.push(bodyData3D({ kind: 'box', x: -2.2, y: 1.55, z: 0, euler: { x: 0, y: 0.4, z: 0 }, label: 'Box' }));
  bodies.push(bodyData3D({ kind: 'sphere', x: 0.4, y: 2.6, z: 0.6, radius: 0.55, label: 'Ball' }));
  bodies.push(bodyData3D({ kind: 'sphere', x: 1.8, y: 0.5, z: -0.8, radius: 0.5, label: 'Ball' }));
  bodies.push(bodyData3D({ kind: 'box', x: 3.4, y: 1.4, z: 1.6, sizeX: 5.2, sizeY: 0.3, sizeZ: 2.2, euler: { x: 0, y: 0, z: 0.32 }, isStatic: true, label: 'Ramp' }));
  return sceneData3D({ name: 'Untitled 3D Scene', bodies });
}

/** Built-in 3D experiment presets (stable keys; UI renders in order). */
export function presetScenes3D() {
  const out = [];

  // Box tower with a sphere on top.
  {
    const bodies = frameBodies3D();
    for (let i = 0; i < 8; i++) {
      bodies.push(bodyData3D({
        kind: 'box', x: (i % 2 ? 0.06 : -0.06), y: 0.55 + i * 1.1, z: 0,
        sizeX: 1.6, sizeY: 1.05, sizeZ: 1.6, euler: { x: 0, y: (i % 3) * 0.16, z: 0 }, label: 'Tower Box',
      }));
    }
    bodies.push(bodyData3D({ kind: 'sphere', x: 0, y: 9.7, z: 0, radius: 0.6, label: 'Top Ball' }));
    bodies.push(bodyData3D({ kind: 'sphere', x: -6, y: 1.2, z: 2, radius: 0.7, vx: 5.2, label: 'Wrecking Ball' }));
    out.push({ key: 'tower3d', name: '方块高塔 3D', scene: sceneData3D({ name: '方块高塔 3D Box Tower', bodies }) });
  }

  // 3D pyramid of boxes.
  {
    const bodies = frameBodies3D();
    const s = 1.12;
    for (let layer = 0; layer < 4; layer++) {
      const n = 4 - layer;
      const y = (s / 2) + layer * s + 0.02;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        bodies.push(bodyData3D({
          kind: 'box', x: (i - (n - 1) / 2) * s, y, z: (j - (n - 1) / 2) * s,
          sizeX: s - 0.04, sizeY: s - 0.04, sizeZ: s - 0.04, label: 'Pyramid Box',
        }));
      }
    }
    bodies.push(bodyData3D({ kind: 'sphere', x: 6.5, y: 2.2, z: 0, radius: 0.8, vx: -4.5, label: 'Wrecking Ball' }));
    out.push({ key: 'pyramid3d', name: '立体金字塔', scene: sceneData3D({ name: '立体金字塔 3D Pyramid', bodies }) });
  }

  // Spheres rolling down two crossing ramps.
  {
    const bodies = frameBodies3D();
    bodies.push(bodyData3D({ kind: 'box', x: -2.6, y: 3.2, z: 0, sizeX: 6.4, sizeY: 0.3, sizeZ: 2.6, euler: { x: 0, y: 0, z: 0.3 }, isStatic: true, label: 'Ramp' }));
    bodies.push(bodyData3D({ kind: 'box', x: 2.4, y: 1.6, z: 0.4, sizeX: 6.4, sizeY: 0.3, sizeZ: 2.6, euler: { x: 0, y: 0, z: -0.26 }, isStatic: true, label: 'Ramp' }));
    for (let i = 0; i < 5; i++) {
      bodies.push(bodyData3D({ kind: 'sphere', x: -5.4 + i * 0.4, y: 5.6 + i * 0.9, z: (i % 2 ? 0.5 : -0.4), radius: 0.42, label: 'Ball' }));
    }
    out.push({ key: 'ramps3d', name: '斜坡滚球 3D', scene: sceneData3D({ name: '斜坡滚球 3D Ramps', bodies }) });
  }

  // Domino corridor in 3D + a pusher sphere.
  {
    const bodies = frameBodies3D();
    for (let i = 0; i < 9; i++) {
      bodies.push(bodyData3D({
        kind: 'box', x: -5.6 + i * 1.35, y: 1.05, z: 0, sizeX: 0.32, sizeY: 2.1, sizeZ: 1.3,
        euler: { x: 0, y: 0, z: i === 0 ? -0.14 : 0 }, label: 'Domino',
      }));
    }
    bodies.push(bodyData3D({ kind: 'sphere', x: -8.4, y: 0.55, z: 0, radius: 0.55, vx: 4.2, label: 'Pusher Ball' }));
    out.push({ key: 'domino3d', name: '多米诺走廊', scene: sceneData3D({ name: '多米诺走廊 Domino Corridor', bodies }) });
  }

  return out;
}
