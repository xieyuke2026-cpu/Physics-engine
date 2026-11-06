/* MotionLab AI assistant — action protocol (1.50).
   The local model may append fenced ```action blocks with one JSON object
   each. Everything here is pure and defensive: extraction, validation and
   normalisation happen BEFORE the host executes anything, and generated
   scenes still go through the app's own validateScene() afterwards.
   Budgets mirror the 1.39 import hardening, tightened for model output. */

export const ACTION_TYPES = ['loadPreset', 'generateScene', 'addBodies', 'setGravity', 'setBackend', 'clearScene'];
export const GRAVITY_PRESETS = ['earth', 'moon', 'jupiter', 'zero', 'side'];
export const MAX_ADD_BODIES = 40;
export const MAX_SCENE_BODIES = 120;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** Pull every action block out of a model reply. Returns { actions, text }
    where text has the blocks stripped (malformed blocks are dropped). */
export function extractActions(text) {
  const actions = [];
  let clean = String(text || '');
  const fence = /```(?:action|json)?\s*\n?([\s\S]*?)```/g;
  clean = clean.replace(fence, (m, body) => {
    try {
      const o = JSON.parse(body.trim());
      if (o && typeof o.action === 'string') { actions.push(o); return ''; }
    } catch { /* not an action block — keep the text */ }
    return m;
  });
  // bare single-object replies without a fence
  if (!actions.length) {
    const t = clean.trim();
    if (t.startsWith('{') && t.endsWith('}')) {
      try { const o = JSON.parse(t); if (o && typeof o.action === 'string') { actions.push(o); clean = ''; } } catch { /* keep text */ }
    }
  }
  return { actions, text: clean.trim() };
}

function checkBody(b, i) {
  if (!b || typeof b !== 'object') return `第 ${i + 1} 个物体不是对象`;
  const type = b.type || b.kind;
  if (type !== 'rectangle' && type !== 'circle' && type !== 'rect') return `第 ${i + 1} 个物体类型不支持：${type}`;
  if (!finite(b.x) || !finite(b.y)) return `第 ${i + 1} 个物体坐标缺失`;
  if (b.x < -200 || b.x > 1480 || b.y < -300 || b.y > 900) return `第 ${i + 1} 个物体坐标超出舞台范围`;
  if ((type === 'rectangle' || type === 'rect') && (!finite(b.width) || !finite(b.height) || b.width <= 0 || b.height <= 0 || b.width > 900 || b.height > 900))
    return `第 ${i + 1} 个矩形尺寸非法`;
  if (type === 'circle' && (!finite(b.radius) || b.radius <= 0 || b.radius > 320)) return `第 ${i + 1} 个圆半径非法`;
  return null;
}

function normalizeBody(b, prefix, i) {
  const type = (b.type || b.kind) === 'circle' ? 'circle' : 'rectangle';
  const out = { id: `${prefix}-${i}`, type, x: Math.round(b.x), y: Math.round(b.y) };
  if (type === 'circle') out.radius = Math.round(b.radius);
  else { out.width = Math.round(b.width); out.height = Math.round(b.height); }
  if (finite(b.density)) out.density = clamp(b.density, 0.00001, 0.05);
  if (finite(b.restitution)) out.restitution = clamp(b.restitution, 0, 1.5);
  if (finite(b.friction)) out.friction = clamp(b.friction, 0, 2);
  if (finite(b.angle)) out.angle = clamp(b.angle, -Math.PI, Math.PI);
  if (b.isStatic === true) out.isStatic = true;
  if (typeof b.label === 'string' && b.label) out.label = b.label.slice(0, 32);
  return out;
}

/** Validate + normalise one raw action. ctx = { presetKeys: Set<string> }.
    Returns { ok:true, action } or { ok:false, error }. */
export function validateAction(raw, ctx) {
  if (!raw || typeof raw.action !== 'string') return { ok: false, error: '动作缺少 action 字段' };
  switch (raw.action) {
    case 'loadPreset': {
      if (!ctx.presetKeys.has(raw.preset)) return { ok: false, error: `未知预设：${raw.preset}` };
      return { ok: true, action: { action: 'loadPreset', preset: raw.preset } };
    }
    case 'setGravity': {
      if (raw.preset !== undefined) {
        if (!GRAVITY_PRESETS.includes(raw.preset)) return { ok: false, error: `未知重力预设：${raw.preset}` };
        return { ok: true, action: { action: 'setGravity', preset: raw.preset } };
      }
      if (!finite(raw.x) || !finite(raw.y)) return { ok: false, error: 'setGravity 需要 preset 或 x/y' };
      return { ok: true, action: { action: 'setGravity', x: clamp(raw.x, -3, 3), y: clamp(raw.y, -3, 3) } };
    }
    case 'setBackend': {
      if (raw.backend !== 'matter' && raw.backend !== 'native') return { ok: false, error: `未知后端：${raw.backend}` };
      return { ok: true, action: { action: 'setBackend', backend: raw.backend } };
    }
    case 'clearScene':
      return { ok: true, action: { action: 'clearScene' } };
    case 'addBodies': {
      if (!Array.isArray(raw.bodies) || !raw.bodies.length) return { ok: false, error: 'addBodies 需要非空 bodies 数组' };
      if (raw.bodies.length > MAX_ADD_BODIES) return { ok: false, error: `一次最多添加 ${MAX_ADD_BODIES} 个物体` };
      for (let i = 0; i < raw.bodies.length; i++) { const e = checkBody(raw.bodies[i], i); if (e) return { ok: false, error: e }; }
      return { ok: true, action: { action: 'addBodies', bodies: raw.bodies.map((b, i) => normalizeBody(b, 'ai', i)) } };
    }
    case 'generateScene': {
      const s = raw.scene;
      if (!s || typeof s !== 'object' || !Array.isArray(s.bodies)) return { ok: false, error: 'generateScene 需要 scene.bodies 数组' };
      const total = s.bodies.length + (s.constraints?.length || 0) + (s.hinges?.length || 0) + (s.fluids?.length || 0) + (s.winds?.length || 0);
      if (s.bodies.length > MAX_SCENE_BODIES) return { ok: false, error: `生成场景物体过多（>${MAX_SCENE_BODIES}）` };
      if (total > 200) return { ok: false, error: '生成场景元素总数过多（>200）' };
      for (let i = 0; i < s.bodies.length; i++) { const e = checkBody(s.bodies[i], i); if (e) return { ok: false, error: e }; }
      return { ok: true, action: { action: 'generateScene', scene: s } };
    }
    default:
      return { ok: false, error: `未知动作：${raw.action}` };
  }
}

/** One-line human summary of an executed action (for the chat log). */
export function describeAction(a, ctx = {}) {
  switch (a.action) {
    case 'loadPreset': return `加载预设「${ctx.presetName || a.preset}」`;
    case 'generateScene': return `生成新场景（${a.scene.bodies.length} 个物体）`;
    case 'addBodies': return `添加 ${a.bodies.length} 个物体`;
    case 'setGravity': return a.preset ? `重力设为 ${a.preset}` : `重力设为 (${a.x}, ${a.y})`;
    case 'setBackend': return `切换后端为 ${a.backend === 'native' ? 'Native（自研）' : 'Matter.js'}`;
    case 'clearScene': return '清空场景';
    default: return a.action;
  }
}

/** Compact scene summary fed to the model as context. Pure. */
export function describeSceneSummary(scene, backendId) {
  if (!scene || !Array.isArray(scene.bodies)) return '当前场景为空。';
  const counts = {};
  for (const b of scene.bodies) counts[b.type] = (counts[b.type] || 0) + 1;
  const parts = Object.entries(counts).map(([k, v]) => `${k}×${v}`).join('、');
  const labels = scene.bodies.filter((b) => b.label).slice(0, 8).map((b) => b.label).join('、');
  return `当前场景「${scene.name || '未命名'}」：共 ${scene.bodies.length} 个物体（${parts}）`
    + `${scene.constraints?.length ? `，约束 ${scene.constraints.length}` : ''}${scene.hinges?.length ? `，铰链 ${scene.hinges.length}` : ''}`
    + `${scene.fluids?.length ? `，流体 ${scene.fluids.length}` : ''}${scene.winds?.length ? `，风区 ${scene.winds.length}` : ''}`
    + `${labels ? `；带标签的物体有：${labels}` : ''}。物理后端：${backendId || 'matter'}。`;
}
