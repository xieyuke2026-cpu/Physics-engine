/* MotionLab AI assistant — local knowledge base (1.50).
   Curated chunks distilled from the developer docs, the preset catalogue
   and the engine manual. Retrieval is a pure keyword scorer (latin words +
   Chinese bigrams) — it only FETCHES reference material for the local
   model; all reasoning is done by the model itself. No data leaves the
   device. Pure module: Node-testable. */

export const KNOWLEDGE = [
  { id: 'stage', title: '舞台与坐标', keys: ['舞台', '坐标', '尺寸', '地面', 'stage', '坐标系', '多大'],
    text: '舞台宽 1280、高约 600。坐标单位是像素，x 向右、y 向下，原点在左上角。地面顶面 y=540，舞台自带边框：地面与左右墙是 isBound 物体。放物体时常用中心点：中央 (640, 300)，地面上方 y 约 500。' },
  { id: 'presets', title: '预设场景', keys: ['预设', 'preset', '牛顿摆', '多米诺', '金字塔', '蹦床', '桥', '漏斗', '保龄球', '摩天轮', '风车', '磁铁', '浮力', '轨道'],
    text: '实验室有 21 个内置预设：牛顿摆 cradle、多米诺 domino、金字塔 pyramid、斜坡 ramps、弹跳 bounce、双摆 doublependulum、桥 bridge、钉板 galton、蹦床 trampoline、漏斗 funnel、过山车 coaster、保龄球 bowling、引力轨道 orbit、浮力 buoyancy、磁铁 magnets、风洞 windtunnel、材料 materials、磁摆 magnetswing、水车风车 windmill、摩天轮 ferris、风车转轮 pinwheel。用 loadPreset 动作按 key 加载。' },
  { id: 'gravity', title: '重力', keys: ['重力', 'gravity', '月球', '木星', '零重力', '失重'],
    text: '重力预设：地球 earth (0, 1)、月球 moon (0, 0.17)、木星 jupiter (0, 2.5)、零重力 zero（关闭）、侧向 side (1, 0)。也可以用 setGravity 动作直接给 x/y 分量，范围 -3..3。引擎还有万有引力模式：物体之间互相吸引（gravitation），轨道预设就是这么做的。' },
  { id: 'fluids', title: '流体与浮力', keys: ['流体', '浮力', '水', 'fluid', 'buoyancy', '密度', '沉', '浮'],
    text: '流体是矩形区域：物体浸入后按「流体密度 ÷ 物体密度 × 浸没比例」受浮力（阿基米德原理），并有水中阻力与水流。木头密度约 0.0004 会浮，铁 0.01 会沉，冰 0.0009 浮得只露一点。流体区域本身不会流动蔓延；想让水蔓延铺开要在引擎之上加水柱模型，见示例 examples/spread.html（水坝决口）。' },
  { id: 'wind', title: '风区与阵风', keys: ['风', 'wind', '风洞', '阵风', 'gust', '吹'],
    text: '风区是矩形区域，power 0..2 决定强弱，风向由区域参数给定；阵风 gust 让风力按正弦周期起伏。风会推动区内物体（按重叠面积与密度混合速度），还会给流体表面带来 40% 强度的表面流（风生流），风车、水车预设演示了风-水-转动联动。' },
  { id: 'magnetism', title: '磁力', keys: ['磁', 'magnet', '磁铁', '吸引', '排斥', '极'],
    text: '物体可带磁性 magnet（-100..100，正为 N 极、负为 S 极）：同极相斥、异极相吸，力随距离平方衰减，作用范围 320px；未磁化的动态物体会被当作铁（等效强度 35）吸向磁体。磁铁预设与磁摆预设可以体验。' },
  { id: 'hinges', title: '铰链与马达', keys: ['铰链', 'hinge', '马达', 'motor', '转轴', '摩天轮', '旋转'],
    text: '铰链把两个物体（或物体与世界）钉在一点上相对转动；带马达的铰链会主动驱动相对角速度，有加速度上限并按转动惯量反比分配反作用。摩天轮、风车转轮预设都靠铰链+马达。铰链连接的物体簇彼此不碰撞。' },
  { id: 'constraints', title: '约束：弹簧与刚杆', keys: ['弹簧', '约束', 'constraint', '绳', '杆', '吊', 'spring'],
    text: '约束连接两个物体或物体与世界锚点：stiffness 接近 1 是刚杆（吊桥、牛顿摆的吊杆），较小是弹簧（蹦床、弹簧振子）。约束有 length（自然长度）与 damping（阻尼）。' },
  { id: 'backends', title: '双引擎后端', keys: ['后端', '引擎', 'backend', 'native', 'matter', '自研', '切换'],
    text: '实验室有两个物理后端：Matter.js（默认，成熟稳定）与自研 Native 引擎（实验性，PhysicsEngine 1.12 起）。设置里或用 setBackend 动作切换，切换时当前场景会被序列化并在新引擎里重演。Native 已知弱项：单柱高塔易倒、密堆沉降入睡比 Matter 慢、圆滚动阻力偏小滚得远。' },
  { id: 'scene-format', title: '场景格式', keys: ['场景格式', 'json', '导入', '导出', '分享', '格式', 'scene'],
    text: '场景是 motionlab-scene v2 的 JSON：{ format, version, name, bodies[], constraints[], hinges[], fluids[], winds[], settings }。物体字段：type 为 rectangle 或 circle，x/y 是中心，矩形有 width/height，圆有 radius，可选 density、restitution（弹性）、friction、isStatic、angle、label。导入有严格校验：文件 ≤2MB、物体 ≤2000、坐标 ±100000 等，超限会被拒绝。' },
  { id: 'bodies', title: '物体与材料', keys: ['物体', '材料', '弹性', '摩擦', '密度', 'restitution', '木', '铁', '冰', '球', '方块'],
    text: '常用量级：密度木 0.0004、冰 0.0009、铁 0.01、水 0.001；弹性 restitution 0 是落地不跳、0.9 非常弹；摩擦 friction 0 光滑、0.6 粗糙。材料预设（materials）把不同密度/弹性排成一排方便对比。静态物体 isStatic 不动，适合做地面、斜坡、支架。' },
  { id: 'examples', title: '开发者示例', keys: ['示例', 'example', '开发者', 'api', '二次开发', '扩展'],
    text: '仓库 examples/ 有四个独立示例页（源码可读）：万有引力轨道 orbit.html、流体浮力 buoyancy.html、种子钉板 galton.html、流体蔓延 spread.html。PhysicsEngine 是可复用的物理核心，开发者只用公开 API 就能在其上加自己的效果层（如蔓延示例的水柱模型），不必改引擎。' },
  { id: 'assistant', title: '助手能力', keys: ['你能做什么', '助手', '帮助', '功能', '会什么'],
    text: '我是 MotionLab 的本地 AI 助手，模型在你的设备上运行、不联网上传数据。我可以：聊天答疑（物理概念、引擎用法、你的场景库）、加载预设、生成新场景、往场景里加物体、调重力、切换物理后端、清空场景。生成的场景会经过和导入相同的严格校验，不合格会被拦下。' },
  { id: 'trouble', title: '常见问题', keys: ['穿模', '卡住', '不动', '睡', '性能', '帧率', 'fps', '慢', '问题'],
    text: '物体不动先看是不是暂停或睡着了（长时间静止会入睡省电，碰一下会醒）。高速小物体偶尔穿模是所有物理引擎的通病，加厚静态物体或降速可缓解。场景卡顿多因物体过多或碰撞峰值，极限压测在 M4 iPad 上 415 物体稳定 60 FPS。' },
];

const LATIN = /[a-z0-9_.]+/g;
function bigrams(s) {
  const out = [];
  const han = s.replace(/[^\u4e00-\u9fff]/g, '·');
  for (const seg of han.split('·')) for (let i = 0; i + 1 < seg.length; i++) out.push(seg.slice(i, i + 2));
  return out;
}
export function tokenize(text) {
  const low = String(text || '').toLowerCase();
  return [...(low.match(LATIN) || []), ...bigrams(low)];
}

/** Score chunks against the query; return up to k chunks with score > 0. */
export function retrieve(query, k = 3) {
  const qt = new Set(tokenize(query));
  if (!qt.size) return [];
  const scored = [];
  for (const c of KNOWLEDGE) {
    let score = 0;
    const keyTokens = new Set();
    for (const kw of c.keys) for (const t of tokenize(kw)) keyTokens.add(t);
    const titleTokens = new Set(tokenize(c.title));
    const textTokens = new Set(tokenize(c.text));
    for (const t of qt) {
      if (keyTokens.has(t)) score += 3;
      if (titleTokens.has(t)) score += 2;
      if (textTokens.has(t)) score += 1;
    }
    if (score > 0) scored.push({ chunk: c, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((s) => s.chunk);
}
