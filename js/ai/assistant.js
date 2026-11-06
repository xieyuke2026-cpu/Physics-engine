/* MotionLab AI assistant — panel controller (1.50).
   A local small model (Qwen2.5-0.5B-Instruct) runs in a Web Worker on the
   user's device. This module owns the chat panel, builds the model's
   context (core prompt + locally retrieved knowledge + live scene
   summary), and executes the model's validated actions through the host
   API the app exposes. The model is only downloaded after the user sends
   their first message. */
import { retrieve } from './knowledge.js';
import { t } from '../i18n.js';
import { extractActions, validateAction, describeAction } from './actions.js';

const CORE_PROMPT = `你是 MotionLab 的 AI 助手，在用户设备本地运行。MotionLab 是一个浏览器 2D 物理实验台（舞台宽 1280，地面顶面 y=540，坐标 y 向下）。
你的工作：用简洁中文回答物理与实验台的问题，并按要求动手改场景。回答要短，先给结论，不要说教。

当你需要动手时，先输出一个 \`\`\`action 代码块，里面是一个 JSON 对象，只能用下面这些动作；动作块之后再用 2~3 句简短说明你做了什么：
- {"action":"loadPreset","preset":"cradle"} 加载预设。可用 key：cradle 牛顿摆, domino 多米诺, pyramid 金字塔, ramps 斜坡, bounce 弹跳, doublependulum 双摆, bridge 桥, galton 钉板, trampoline 蹦床, funnel 漏斗, coaster 过山车, bowling 保龄球, orbit 引力轨道, buoyancy 浮力, magnets 磁铁, windtunnel 风洞, materials 材料, magnetswing 磁摆, windmill 风车, ferris 摩天轮, pinwheel 转轮
- {"action":"generateScene","scene":{...}} 生成全新场景。scene 是 motionlab-scene v2：{"format":"motionlab-scene","version":2,"name":"名字","bodies":[...]}。物体的 type 只能是 rectangle 或 circle，x/y 是中心坐标；矩形给 width/height，圆给 radius；可选 density、restitution、friction、isStatic、label。舞台自带地面和边框，不要再加地面。物体总数不超过 60。需要吊挂时用 constraints：{"bodyA":null,"bodyB":"物体id","pointA":{"x":锚点x,"y":锚点y},"pointB":{"x":0,"y":0},"stiffness":1,"length":长度}，物体要有 id 才能被引用。
- {"action":"addBodies","bodies":[...]} 往当前场景加物体（字段同上，最多 40 个）。
- {"action":"setGravity","preset":"moon"} 重力预设：earth 地球, moon 月球, jupiter 木星, zero 零重力, side 侧向；或 {"action":"setGravity","x":0,"y":0.5} 直接给分量（-3..3）。
- {"action":"setBackend","backend":"native"} 切换后端：matter 或 native。
- {"action":"clearScene"} 清空场景。
一次回复最多附一个 action 块。不需要动手就不要附。不要编造不存在的预设或动作。`;

/* ---------------- worker brain ---------------- */
class WorkerBrain {
  constructor(hostVersion) {
    this.hostVersion = hostVersion || '';
    this.worker = null; this.state = 'idle'; this.device = null; this.respawned = false;
    this.pending = new Map(); this.seq = 0; this.onProgress = null; this.loadWaiters = [];
    this.lastProgressAt = 0; this.watchdog = null;
  }
  ensure() {
    if (this.worker) return;
    const v = this.hostVersion ? `?v=${this.hostVersion}` : '';
    this.worker = new Worker(new URL(`./worker.js${v}`, import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.type === 'progress') { this.lastProgressAt = Date.now(); this.onProgress && this.onProgress(m); return; }
      if (m.type === 'loaded') {
        this.state = 'ready'; this.device = m.device; this.stopWatchdog();
        for (const w of this.loadWaiters.splice(0)) w.resolve(m.device);
        return;
      }
      if (m.type === 'loadError') {
        // A failed WebGPU init can poison the runtime for the whole worker;
        // respawn ONCE as a fresh worker forced to WASM before giving up.
        if (!this.respawned) {
          this.respawned = true;
          try { this.worker.terminate(); } catch { /* already gone */ }
          this.worker = null; this.state = 'loading';
          this.ensure();
          this.worker.postMessage({ type: 'load', forceWasm: true });
          return;
        }
        this.state = 'error'; this.stopWatchdog();
        try { this.worker.terminate(); } catch { /* gone */ }
        this.worker = null;
        for (const w of this.loadWaiters.splice(0)) w.reject(new Error(m.error));
        return;
      }
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === 'token') p.onToken(m.text);
      else if (m.type === 'done') { this.pending.delete(m.id); p.resolve(m.text); }
      else if (m.type === 'error') { this.pending.delete(m.id); p.reject(new Error(m.error)); }
    };
    this.worker.onerror = () => {
      if (this.state === 'loading') { this.state = 'error'; for (const w of this.loadWaiters.splice(0)) w.reject(new Error('worker failed')); }
    };
  }
  startWatchdog() {
    this.stopWatchdog();
    this.watchdog = setInterval(() => {
      if (this.state !== 'loading') { this.stopWatchdog(); return; }
      if (Date.now() - this.lastProgressAt < 90000) return;
      // No progress for 90s: session creation is stuck (the iPad 100% hang).
      // Respawn once as a fresh WASM worker; after that, fail cleanly and
      // TERMINATE so a stuck runtime stops eating the lab's frame rate.
      if (!this.respawned) {
        this.respawned = true;
        try { this.worker.terminate(); } catch { /* gone */ }
        this.worker = null; this.lastProgressAt = Date.now();
        this.ensure();
        this.worker.postMessage({ type: 'load', forceWasm: true });
        return;
      }
      this.stopWatchdog();
      try { this.worker.terminate(); } catch { /* gone */ }
      this.worker = null; this.state = 'error';
      for (const w of this.loadWaiters.splice(0)) w.reject(new Error(t('ai.err.timeout')));
    }, 5000);
  }
  stopWatchdog() { if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; } }
  unload() {
    this.stopWatchdog();
    if (this.worker) { try { this.worker.terminate(); } catch { /* gone */ } }
    this.worker = null; this.state = 'idle'; this.device = null; this.respawned = false;
    for (const p of this.pending.values()) p.reject(new Error('unloaded'));
    this.pending.clear();
  }
  load() {
    this.ensure();
    if (this.state === 'ready') return Promise.resolve(this.device);
    if (this.state !== 'loading') { this.state = 'loading'; this.lastProgressAt = Date.now(); this.startWatchdog(); this.worker.postMessage({ type: 'load' }); }
    return new Promise((resolve, reject) => this.loadWaiters.push({ resolve, reject }));
  }
  async chat(messages, onToken) {
    await this.load();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        // Generation stuck: kill the worker so the lab gets its CPU back.
        try { this.worker.terminate(); } catch { /* gone */ }
        this.worker = null; this.state = 'idle';
        reject(new Error(t('ai.err.gentimeout')));
      }, 150000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
        onToken,
      });
      this.worker.postMessage({ type: 'chat', id, messages });
    });
  }
}

/* ---------------- panel ---------------- */
export function createAssistant(host) {
  const $ = (id) => document.getElementById(id);
  const panel = $('aiPanel'), msgs = $('aiMessages'), input = $('aiInput'),
    sendBtn = $('aiSend'), status = $('aiStatus'), chips = $('aiChips');
  const brain = new WorkerBrain(host.version);
  const history = []; // {role, content} trimmed pairs (assistant side stores cleaned text + execution notes)
  let busy = false, greeted = false;


  function setStatus(text) { status.textContent = text; }
  function addMsg(role, text) {
    const div = document.createElement('div');
    div.className = `ai-msg ${role}`;
    div.textContent = text;
    msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight;
    return div;
  }
  function addNote(text) {
    const div = document.createElement('div');
    div.className = 'ai-note'; div.textContent = text;
    msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight;
  }

  const unloadBtn = $('aiUnload');
  if (unloadBtn) unloadBtn.addEventListener('click', () => {
    brain.unload();
    unloadBtn.hidden = true;
    setStatus(t('ai.status.unloaded'));
    addNote(t('ai.note.unloaded'));
  });

  brain.onProgress = (p) => {
    if (p.total > 0) setStatus(t('ai.status.downloading', { pct: Math.round((p.loaded / p.total) * 100) }));
  };

  function greet() {
    if (greeted) return; greeted = true;
    addMsg('assistant', t('ai.greet'));
    setStatus(t('ai.status.idle'));
  }

  async function execute(action) {
    const v = validateAction(action, { presetKeys: new Set(host.listPresets().map((p) => p.key)) });
    if (!v.ok) { addNote(t('ai.blocked', { err: v.error })); return t('ai.didfail', { err: v.error }); }
    const a = v.action;
    let r;
    switch (a.action) {
      case 'loadPreset': r = host.loadPreset(a.preset); break;
      case 'generateScene': r = host.importScene(a.scene); break;
      case 'addBodies': r = host.addBodies(a.bodies); break;
      case 'setGravity': r = host.setGravity(a.preset ? { preset: a.preset } : { x: a.x, y: a.y }); break;
      case 'setBackend': r = host.setBackend(a.backend); break;
      case 'clearScene': r = host.clearScene(); break;
      default: r = { ok: false, error: 'unknown' };
    }
    if (r && r.ok) {
      const label = describeAction(a, { presetName: host.listPresets().find((p) => p.key === a.preset)?.name });
      addNote(`✓ ${label}`);
      return t('ai.did', { label });
    }
    addNote(t('ai.failed', { err: (r && r.error) || 'unknown' }));
    return t('ai.didfail', { err: (r && r.error) || 'unknown' });
  }

  async function send(text) {
    const q = (text ?? input.value).trim();
    if (!q || busy) return;
    input.value = '';
    busy = true; sendBtn.disabled = true;
    addMsg('user', q);
    const bubble = addMsg('assistant', '');
    try {
      if (brain.state !== 'ready') setStatus(t('ai.status.loading'));
      const chunks = retrieve(q, 2);
      const kb = chunks.length ? `\n\n【参考资料】\n${chunks.map((c) => `《${c.title}》${c.text}`).join('\n')}` : '';
      const system = CORE_PROMPT + kb + `\n\n【当前状态】${host.describeScene()}`;
      const messages = [{ role: 'system', content: system },
        ...history.slice(-4), { role: 'user', content: q }];
      let streamed = '';
      const raw = await brain.chat(messages, (t) => {
        streamed += t;
        bubble.textContent = streamed.split('```')[0].trim() || '…';
        msgs.scrollTop = msgs.scrollHeight;
      });
      setStatus(t(brain.device === 'webgpu' ? 'ai.status.ready.webgpu' : 'ai.status.ready.wasm'));
      if (unloadBtn) unloadBtn.hidden = false;
      const { actions, text: clean } = extractActions(raw || streamed);
      let note = '';
      for (const a of actions.slice(0, 1)) note = await execute(a);
      bubble.textContent = clean || note || '…';
      history.push({ role: 'user', content: q }, { role: 'assistant', content: (clean || '') + note });
    } catch (e) {
      bubble.textContent = t('ai.err.bubble', { err: e.message || e });
      setStatus(t('ai.status.failed'));
    } finally {
      busy = false; sendBtn.disabled = false;
      msgs.scrollTop = msgs.scrollHeight;
    }
  }

  // chips (rebuilt on every open so a language switch is picked up)
  function renderChips() {
    chips.textContent = '';
    for (const n of [1, 2, 3, 4]) {
      const b = document.createElement('button');
      b.className = 'ai-chip'; b.textContent = t(`ai.chip${n}.label`);
      b.addEventListener('click', () => send(t(`ai.chip${n}.prompt`)));
      chips.appendChild(b);
    }
  }
  sendBtn.addEventListener('click', () => send());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('aiClose').addEventListener('click', () => toggle(false));

  function toggle(force) {
    const show = force !== undefined ? force : panel.hasAttribute('hidden');
    if (show) { panel.removeAttribute('hidden'); greet(); renderChips(); input.focus(); }
    else panel.setAttribute('hidden', '');
    return show;
  }
  return { toggle, send };
}
