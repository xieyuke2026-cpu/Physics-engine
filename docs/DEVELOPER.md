# MotionLab 开发者文档

面向二次开发者的完整调用文档：**PhysicsEngine**（通用 2D 物理核心）、
**PF 引擎**（平台格斗模块集）、**PhysicsEngine3D**（3D 核心）与 vendored 的
**Matter.js**。本文档在 GitHub 上可直接阅读；应用内「主界面 → 开发者文档」
是同一套内容的精简版。

- 在线站点：https://xieyuke2026-cpu.github.io/Physics-engine/
- 仓库结构：站点根目录即本仓库根目录（纯静态、无构建步骤）

## 当前版本

| 组件 | 版本 | 单一事实源 |
|---|---|---|
| MotionLab（应用） | 1.20 | `js/ui.js` 的 `APP_VERSION` |
| PhysicsEngine（2D 核心） | 1.2.0 | `js/engine/physics-engine.js` 的 `VERSION` / `PhysicsEngine.VERSION` |
| PF 引擎（平台格斗） | 1.1.0 | `js/pf/pf-config.js` 的 `PF_VERSION` / `PFEngine.VERSION` |
| PhysicsEngine3D（3D 核心） | 1.0.0 | `js/engine/physics-engine-3d.js` 的 `VERSION` |
| Matter.js（vendored） | 0.20.0 | 运行时读 `Matter.version`，不写死 |

---

## 一、PhysicsEngine（2D 物理核心）

项目无关的 Matter.js 封装：宿主项目不接触 Matter 内部，只用普通数据描述符
与公开 API。文件：`js/engine/physics-engine.js`（独立包见同仓库的
`physics-engine` 发布目录/技能说明）。

### 加载方式

浏览器（全局 Matter + 模块导入）：

```html
<script src="vendor/matter.min.js"></script>
<script type="module">
  import { PhysicsEngine, VERSION } from './js/engine/physics-engine.js';
  console.log(VERSION); // '1.2.0'
</script>
```

Node / 测试：先把 Matter 放到全局，或用 `PhysicsEngine.setMatter(Matter)`
显式注入，再 `new PhysicsEngine({ matter })` 也可以。

### 快速开始

```js
const pe = new PhysicsEngine({ enableSleeping: true }); // 构造选项见下
pe.setGravity(0, 1);

const ball = pe.addBody({ kind: 'circle', x: 120, y: 60, radius: 22, restitution: 0.6 });
pe.addBody({ kind: 'rect', x: 120, y: 320, width: 420, height: 20, isStatic: true, label: 'ground' });

// 弹簧：bodyA 为 null 表示固定在世界锚点
pe.addConstraint({ bodyA: null, pointA: { x: 120, y: 20 }, bodyB: pe.idOf(ball), stiffness: 0.02, damping: 0.05 });

function frame(elapsedMs) {
  const steps = pe.advance(elapsedMs, 1); // 固定步进累加器，返回本帧步数
  for (const b of pe.allBodies()) draw(b); // 宿主自己渲染
}
```

构造选项：`gravity {x,y}`、`enableSleeping`、`fixedDt`（默认 1000/60 ms）、
`maxSteps`（默认 5，防螺旋死亡）、`substeps`（1–8，防穿模，MotionLab 用 2）、
`matter`（注入的 Matter 模块）。

### 物体描述符（addBody）

`{ id?, kind: 'circle'|'rect'|'polygon', x, y, angle(弧度), width, height,
radius, sides, density, friction, frictionAir, restitution, isStatic,
lockRotation, vx, vy, label, userData }`——全部可序列化；`describeBody(body)`
读回实时状态（含 mass），`snapshot()` / `load(data)` 整体存取。

### API 速览

| 分类 | 方法 |
|---|---|
| 物体 | `addBody / removeBody / clear / bodyById / allBodies / forEachBody / count / pick(x,y) / describeBody / idOf / kindOf / userDataOf` |
| 约束 | `addConstraint / removeConstraint / constraintCount / describeConstraints / constraintSegments(out?)` |
| 步进 | `advance(ms, speed) / stepOnce() / step(dtMs, speed) / setSubsteps(n)` |
| 属性 | `setVelocity / setPosition / setAngleDeg / setDensity / setMass / setFriction / setFrictionAir / setRestitution / setStatic / setLockRotation / stopMotion / resize(body, patch) / wake(body)` |
| 拖拽 | `beginDrag(body,x,y) / moveDrag(x,y) / endDrag()`（真实物理约束，可甩掷） |
| 查询（1.2.0 新增） | `queryRegion(x,y,w,h)` AABB 区域查询；`raycast(x1,y1,x2,y2)` 射线命中（近→远，含命中点与距离） |
| 冲量（1.2.0 新增） | `addVelocity(body, dvx, dvy)`；`applyRadialImpulse(cx, cy, { radius, base, power, filter })` 径向冲击（大小 = base + power×(1−距离/半径)，返回受影响数量） |
| 存取 | `snapshot() / load(data)` |
| 事件 | `onCollision((bodyA, bodyB, pair) => …)`；`pe.onChange` 结构变化回调 |

坐标系：像素、y 向下；角度为弧度（`setAngleDeg` 除外）。约束描述符的端点
字段是 **`bodyA` / `bodyB`**（id 字符串；`bodyA: null` 表示世界锚点，锚点
坐标取 `pointA` 的世界坐标）。

### 版本历史

- 1.0.0 — 从 MotionLab 抽离为通用核心
- 1.1.0 — `substeps` 防穿模
- 1.2.0 — 空间查询（`queryRegion` / `raycast`）、冲量助手
  （`addVelocity` / `applyRadialImpulse`）、`pick()` 零分配优化

---

## 二、PF 引擎调用方式（平台格斗模块集）

PF 引擎是建立在 PhysicsEngine 之上的平台格斗底层：角色控制器（探地、土狼
时间、跳跃缓冲、二段跳、冲刺、受击硬直）、战斗系统（启动/生效/恢复三段、
独立判定框、伤害累积缩放击退、每攻击单次命中）、确定性 AI 状态机
（idle/approach/attack/retreat/recover）、一向通过的浮台与爆炸区判定。
模块位于 `js/pf/`：`pf-config`（参数与版本）、`pf-stage`（场地数据）、
`pf-physics`（唯一的引擎适配层）、`pf-character`、`pf-combat`、`pf-ai`、
`pf-renderer`、`pf-input`、`pf-lab`（对局逻辑 + UI 壳 + `PFEngine` 门面）。
游戏逻辑只经适配层调用 PhysicsEngine 公开 API，不接触 Matter。

### 方式 A：PFEngine 门面（推荐）

```js
import { PFEngine } from './js/pf/pf-lab.js';

PFEngine.VERSION; // '1.1.0'

// 1) 无头对局（无 DOM，适合工具、测试、服务器模拟）
const match = PFEngine.createMatch({ ai: 'normal' }); // ai 可为 'calm'|'normal'|'sharp' 或覆盖对象
const idle = { move: 0, jump: false, attack: false, dash: false };
for (let i = 0; i < 600; i++) {
  const events = match.step({ move: 1, jump: false, attack: false, dash: false });
  // events: 命中与 KO 事件；match.state: 'fight'|'over'；match.winner: 'player'|'dummy'|'draw'
}
console.log(match.debugInfo()); // 双方状态/伤害/速度/位置、AI 状态、步数、最近命中

// 2) 完整 UI 壳（全屏覆盖层：画布、调试面板、触屏按钮）——需要页面中存在
//    index.html 的 #pfLab 标记（或从 MotionLab 整页使用）
const lab = PFEngine.createLab(() => { /* 退出时回调 */ });
lab.enter();   // 打开并开局
lab.exit();    // 退出：释放监听、循环与物理世界

// 3) 调参（作用于共享参数表，影响之后创建的对局）
PFEngine.tune({ attack: { damage: 9 }, ai: { decideEvery: 8 } });
PFEngine.config.ATTACK.baseKnockback; // 读当前参数
PFEngine.stage.PLATFORMS;              // 场地平台数据
```

### 方式 B：直接使用类

```js
import { PFMatch, PFLab } from './js/pf/pf-lab.js';
import { FighterAI } from './js/pf/pf-ai.js';
import { PF_VERSION } from './js/pf/pf-config.js';

const m = new PFMatch({ ai: { decideEvery: 14 } }); // 每步调用 m.step(intent)
m.reset();                                          // 同配置重开一局
```

### 意图（intent）接口

玩家与 AI 共用同一输入结构，AI 输出与玩家输入完全同构：

```js
{ move: -1|0|1, jump: bool, attack: bool, dash: bool, face: -1|0|1 }
```

`jump/attack/dash` 为边沿触发（按下那一步为 true）；`face: 0` 表示不改变朝向。

### AI 档位

| 档位 | decideEvery | attackCooldown | 说明 |
|---|---|---|---|
| `calm` | 16 | 48 | 反应慢、攻击间隔长 |
| `normal` | 10 | 30 | 默认（即 `AI` 表） |
| `sharp` | 6 | 18 | 反应快、连绵进攻 |

也可传任意覆盖对象，如 `{ decideEvery: 12, retreatDamage: 50 }`，与默认值合并，
且只影响该 AI 实例。

### 主要参数（pf-config.js）

`FIGHTER`（速度/跳跃/冲刺/硬直）、`ATTACK`（三段帧数、伤害 7、击退
3.4 + 0.075×伤害%）、`AI`（决策间隔、范围、后退阈值）、`BLAST`（爆炸区
边界）、`WORLD`（960×540、gravityY 2.0、substeps 2）。步进为固定 60 步/秒，
渲染与逻辑解耦。

---

## 三、PhysicsEngine3D（3D 核心）

文件 `js/engine/physics-engine-3d.js`（cannon-es 驱动，`VERSION` 1.0.0），
与 2D 核心同构的描述符/快照设计；摩擦与弹性为世界级设置。MotionLab 的 3D
实验室界面自 v1.8 起隐藏（`FEATURE_3D = false` + `body.no-3d` 结构护栏），
代码与已存 3D 场景数据保留，核心本身仍可在独立包中单独使用。

## 四、Matter.js 说明

`vendor/matter.min.js` 为 vendored 的 **Matter.js 0.20.0**（2026-11 由
0.19.0 升级；全量测试套件无修改断言即全部通过后才采用）。应用运行时读取
实际加载的 `Matter.version` 展示，不写死版本号。升级策略：先在副本中跑完
引擎/逻辑/PF/UI 全部测试，断言不放宽的前提下通过才替换 vendored 文件。

## 五、本地开发与测试

```bash
python3 -m http.server 8000        # 本地预览 http://localhost:8000
node tests/engine-tests.mjs        # PhysicsEngine 核心（40 项）
node tests/run-tests.mjs           # 场景/逻辑（65 项）
node tests/pf-smoke.mjs            # PF 引擎逻辑（27 项）
node tests/smoke.mjs               # UI 冒烟（含样式完整性守卫）
node tests/nav-smoke.mjs tests/pf-ui-smoke.mjs tests/landing-smoke.mjs tests/lab3d-smoke.mjs
```

发布流程为静态文件直推 GitHub Pages；`version.json` 与入口资源的 `?v=`
参数随版本同步更新，应用内有新版本提示条。
