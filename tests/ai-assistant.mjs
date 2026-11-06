/* AI assistant pure-logic tests (1.50): knowledge retrieval, action
   extraction/validation, scene summary. The model itself and the DOM panel
   are covered by the smoke suite + live verification.
   Run: node tests/ai-assistant.mjs */
import { retrieve, tokenize } from '../js/ai/knowledge.js';
import { extractActions, validateAction, describeAction, describeSceneSummary } from '../js/ai/actions.js';

let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log(`  ok  ${n}`); } else { fail++; console.log(`FAIL  ${n} ${x}`); } };

/* retrieval */
check('tokenize mixes latin + bigrams', tokenize('浮力 buoyancy').includes('浮力') && tokenize('浮力 buoyancy').includes('buoyancy'));
check('buoyancy query retrieves fluids chunk first', retrieve('浮力是怎么算的')[0]?.id === 'fluids');
check('backend query retrieves backends chunk', retrieve('怎么切换到自研后端')[0]?.id === 'backends');
check('gravity query retrieves gravity chunk', retrieve('把重力换成月球')[0]?.id === 'gravity');
check('irrelevant query retrieves nothing', retrieve('今天天气怎么样').length === 0);

/* extraction */
{
  const r = extractActions('好的，给你。\n```action\n{"action":"loadPreset","preset":"cradle"}\n```');
  check('fenced action extracted + stripped', r.actions.length === 1 && r.actions[0].preset === 'cradle' && !r.text.includes('loadPreset'));
}
{
  const r = extractActions('看这段代码：\n```js\nconst a = 1;\n```\n完了。');
  check('non-action fence preserved as text', r.actions.length === 0 && r.text.includes('const a = 1'));
}
{
  const r = extractActions('```action\n{not json}\n```');
  check('malformed action block kept as text, no action', r.actions.length === 0 && r.text.includes('not json'));
}
{
  const r = extractActions('{"action":"clearScene"}');
  check('bare JSON action extracted', r.actions.length === 1 && r.text === '');
}
check('plain chat yields no actions', extractActions('浮力就是排开水的重量。').actions.length === 0);

/* validation */
const ctx = { presetKeys: new Set(['cradle', 'domino']) };
check('loadPreset ok', validateAction({ action: 'loadPreset', preset: 'cradle' }, ctx).ok);
check('loadPreset unknown rejected', !validateAction({ action: 'loadPreset', preset: 'nope' }, ctx).ok);
check('setGravity preset ok', validateAction({ action: 'setGravity', preset: 'moon' }, ctx).ok);
check('setGravity xy clamped to ±3', (() => { const v = validateAction({ action: 'setGravity', x: 9, y: -9 }, ctx); return v.ok && v.action.x === 3 && v.action.y === -3; })());
check('setBackend native ok / bogus rejected', validateAction({ action: 'setBackend', backend: 'native' }, ctx).ok && !validateAction({ action: 'setBackend', backend: 'quantum' }, ctx).ok);
check('unknown action rejected', !validateAction({ action: 'rmEverything' }, ctx).ok);
check('addBodies ok + normalised ids/types', (() => {
  const v = validateAction({ action: 'addBodies', bodies: [{ kind: 'rect', x: 640, y: 300, width: 40, height: 40 }, { type: 'circle', x: 500, y: 200, radius: 15, density: 9 }] }, ctx);
  return v.ok && v.action.bodies[0].type === 'rectangle' && v.action.bodies[0].id === 'ai-0' && v.action.bodies[1].density === 0.05;
})());
check('addBodies over budget rejected', !validateAction({ action: 'addBodies', bodies: Array.from({ length: 41 }, () => ({ type: 'circle', x: 1, y: 1, radius: 5 })) }, ctx).ok);
check('addBodies out-of-stage rejected', !validateAction({ action: 'addBodies', bodies: [{ type: 'circle', x: 99999, y: 1, radius: 5 }] }, ctx).ok);
check('generateScene ok', validateAction({ action: 'generateScene', scene: { bodies: [{ type: 'circle', x: 640, y: 200, radius: 20 }] } }, ctx).ok);
check('generateScene oversized rejected', !validateAction({ action: 'generateScene', scene: { bodies: Array.from({ length: 121 }, () => ({ type: 'circle', x: 1, y: 1, radius: 5 })) } }, ctx).ok);
check('generateScene bad body rejected', !validateAction({ action: 'generateScene', scene: { bodies: [{ type: 'hexagon', x: 1, y: 1 }] } }, ctx).ok);

/* describe helpers */
check('describeAction names the preset', describeAction({ action: 'loadPreset', preset: 'cradle' }, { presetName: '牛顿摆' }).includes('牛顿摆'));
check('scene summary counts bodies + backend', (() => {
  const s = describeSceneSummary({ name: '测试', bodies: [{ type: 'circle' }, { type: 'circle' }, { type: 'rectangle', label: '板' }], constraints: [{}] }, 'native');
  return s.includes('circle×2') && s.includes('约束 1') && s.includes('native') && s.includes('板');
})());

/* ---- 1.55: dialect tolerance (live-caught: model wrote ```json + "act") ---- */
check('json fence + act key is extracted and normalised', (() => {
  const r = extractActions('我调用了预设。\n```json\n{"act": "loadPreset", "preset": "cradle"}\n```\n这样可以。');
  return r.actions.length === 1 && r.actions[0].action === 'loadPreset' && r.actions[0].preset === 'cradle'
    && !r.text.includes('loadPreset') && r.text.includes('这样可以');
})());
check('type key works as the action-name alias', (() => {
  const r = extractActions('```action\n{"type":"setGravity","preset":"moon"}\n```');
  return r.actions.length === 1 && r.actions[0].action === 'setGravity';
})());
check('unrelated JSON in a json fence stays as text', (() => {
  const r = extractActions('配置长这样：\n```json\n{"foo": 1}\n```');
  return r.actions.length === 0 && r.text.includes('"foo"');
})());
check('bare object with act key is extracted', (() => {
  const r = extractActions('{"act":"clearScene"}');
  return r.actions.length === 1 && r.actions[0].action === 'clearScene' && r.text === '';
})());

check('inline action JSON followed by prose is lifted out', (() => {
  const r = extractActions('{"action":"loadPreset","preset":"cradle" } 后面跟着一串说明文字。');
  return r.actions.length === 1 && r.actions[0].preset === 'cradle' && r.text.includes('说明文字');
})());
check('braces in ordinary prose are not treated as actions', (() => {
  const r = extractActions('集合写作 {1, 2, 3}，函数记作 f(x)={x}。');
  return r.actions.length === 0 && r.text.includes('{1, 2, 3}');
})());

console.log(`\nai-assistant tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
