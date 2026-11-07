# MotionLab 开发者文档

> English version: [DEVELOPER-EN.md](DEVELOPER-EN.md)

面向二次开发者的完整调用文档：**PhysicsEngine**（通用 2D 物理核心）、
**PF 引擎**（平台格斗模块集）、**PhysicsEngine3D**（3D 核心）与 vendored 的
**Matter.js**。本文档在 GitHub 上可直接阅读；应用内「主界面 → 开发者文档」
是同一套内容的精简版。

- 在线站点：https://xieyuke2026-cpu.github.io/Physics-engine/
- 仓库结构：站点根目录即本仓库根目录（纯静态、无构建步骤）

## 当前版本

| 组件 | 版本 | 单一事实源 |
|---|---|---|
| MotionLab（应用） | 1.55 | `js/ui.js` 的 `APP_VERSION` |
| PhysicsEngine（2D 核心） | 1.12.7 | `js/engine/physics-engine.js` 的 `VERSION` / `PhysicsEngine.VERSION` |
| PF 引擎（平台格斗） | 1.1.0 | `js/pf/pf-config.js` 的 `PF_VERSION` / `PFEngine.VERSION` |
| PhysicsEngine3D（3D 核心） | 1.0.0 | `js/engine/physics-engine-3d.js` 的 `VERSION` |
| Matter.js（vendored） | 0.20.0 | 运行时读 `Matter.version`，不写死 |

**应用语言**：MotionLab 1.24 新增中文 / 英文界面切换。首次打开时界面以英文为主，
欢迎页会引导选择语言；选择保存在 localStorage（`motionlab.lang`），之后可在
「设置」里随时更改。文案词典在 `js/i18n.js`。

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
  console.log(VERSION); // '1.12.3'
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
| 随机种子（1.3.0 新增） | `new PhysicsEngine({ seed })`、`pe.seed`（读回种子）、`setSeed(n)`、`random()`、`randomRange(min, max)`、`randomInt(min, max)`、`choice(arr)`、`shuffle(arr)` |
| 命名（1.4.0 新增） | 描述符 `name` 字段、`nameOf(body)`、`getBodyByName(name)`、`getBodiesByName(name)`、`renameBody(bodyOrId, name)` |
| 万有引力（1.4.0 新增） | `setGravitation(G, { softening })`、`gravitation`（读配置）、`setGravitation(0)` 关闭 |
| 流体浮力（1.4.0 新增；1.9.0 联动；1.10.0 条件化） | `addFluid({ id?, x, y, width, height, density, drag, vx, vy })`、`removeFluid(id)`、`fluids()`、`fluidById(id)`、`fluidCount`、`fluidFlow(id)` |
| 磁力（1.5.0 新增） | 描述符字段 `magnet`（−100..100）、`setMagnetism(K, { range, softening })`、`magnetism`、`setMagnet(body, v)`、`magnetOf(body)`、`magnetCount` |
| 风场（1.5.0 新增；1.8.0 阵风） | `addWind({ id?, x, y, width, height, vx, vy, power, gust, gustPeriod })`、`removeWind(id)`、`winds()`、`windById(id)`、`windCount`、`simTime` |
| 铰链与马达（1.7.0 新增） | `addHinge({ id?, bodyA, bodyB, pointA, pointB, motorSpeed, motorPower })`、`removeHinge(id)`、`hingeById(id)`、`describeHinges()`、`hingeCount`、`hingeAnchors()`、`setHingeMotor(id, v)` |
| 公式与测量（1.4.0 新增） | `Formulas.*`（纯函数，见下）、`bodyKineticEnergy(body)`、`totalKineticEnergy()`、`bodyMomentum(body)`、`totalMomentum()`、`centerOfMass()` |
| 稳定性（1.4.0 新增） | `PhysicsEngine.validateDescriptor(desc)`、`findNonFiniteBodies()`、`{ maxSpeed }` / `setMaxSpeed(v)` |

坐标系：像素、y 向下；角度为弧度（`setAngleDeg` 除外）。约束描述符的端点
字段是 **`bodyA` / `bodyB`**（id 字符串；`bodyA: null` 表示世界锚点，锚点
坐标取 `pointA` 的世界坐标）。

### 后端接口（1.11.0）

引擎的公开 API 背后是可替换的求解器「后端」。注册表是唯一事实来源：模块
导出 `BACKENDS`（同 `PhysicsEngine.BACKENDS`），每项含
`id / name / status（'active' | 'experimental' | 'planned'）/ since / summary`：

| id | 名称 | 状态 |
| --- | --- | --- |
| `matter` | Matter.js | active（默认，自 1.0.0） |
| `native` | Native（自研） | experimental（自 1.12.0） |

- 构造：`PhysicsEngine.create({ backend: 'matter' })`（缺省即 matter）；直接 `new PhysicsEngine()` 等价。`create({ backend: 'native' })` 返回自研引擎实例（`native-engine.js`，类 `NativeEngine`）。
- 实例带 `backendId`，可随时读出当前求解器。
- `active` 与 `experimental` 都可构造（experimental 请宿主如实标注）；请求 planned 或未知的后端会**抛错**（消息写明状态），不静默回退：换求解器会改变模拟结果，宿主必须知情。
- 后端契约：后端须实现本类全部公开表面（物体 / 约束 / 铰链管理、流体 / 风场 / 磁力区域、固定步长 `advance`、快照、空间查询、种子随机流）。宿主只对这套 API 编程、不碰后端内部——MotionLab 1.41 已按此契约接入：设置里的后端选择器切换即以当前场景在新求解器上重建世界并重演，宿主代码零改动。
- Native 求解器要点（1.12.0）：顺序冲量 + 热启动、SAT + 参考面裁剪接触、休眠；力模型与马达按固定步踢一次（与子步数无关）；子步下限 2（单子步时高塔堆叠欠阻尼）；已知弱项：10 层单列高塔仍会倒、位置修正只做线性部分。专属行为测试见 `tests/native-tests.mjs`。
- **宿主契约（1.12.1）**：每个刚体——圆也不例外——必须暴露非空 `vertices` 并随位姿更新；宿主渲染器按顶点路径绘制每个刚体。1.12.0 的 Native 圆曾给出空 `vertices`，导致线上画布只剩网格而物理照常（引擎测试不渲染、应用冒烟不在 Native 下验绘制，两头漏检）——MotionLab 侧另有应用级 `tests/native-render.mjs` 守这条线。
- **Native 健壮性（1.12.2）**：参考面裁剪容忍 0/1 点退化线段（精确对齐的堆叠曾让大场景中途崩溃冻结）；休眠改平滑运动量 + 支撑记忆；热启动冲量只在首个子步施加（重复施加是按子步数放大的能量泄漏）。
- **孤儿睡眠体唤醒（1.12.3，双后端）**：睡眠体不吃重力，若无人复查支撑，删掉塔底或拖走支撑物会让上方整塔永远悬空。两后端每 15 个固定步运行支撑探测 `_wakeOrphans`：睡眠动态体若失去全部支撑即被唤醒——支撑指接触链（包围盒外扩 3 px 连通）到达非睡眠体（静态体计入锚点；注意 Matter 会把静态体也标记为休眠）、约束/铰链挂载、或流体区域重叠；零重力/重力关闭时探测豁免。

### 随机种子（1.3.0）

引擎内置一条 mulberry32 随机流（实例独立，与 `Math.random` 无关）：
构造时传 `{ seed }` 即得到**可复现**的序列——同一个 seed 产生同样的
`random()` 结果序列，适合程序化生成场景、出生点抖动、随机冲量等需要
「发个 seed 就能重演」的场合。不传 seed 时引擎随机选一个，可从
`pe.seed` 读回记录。`setSeed(n)` 随时重置序列，并同步 Matter 的
`Common._seed`。`snapshot()` 会带上 RNG 状态，`load()` 后随机流从
快照处继续，序列不跳变。

### 命名物体（1.4.0）

描述符可带 `name`（字符串，可重名——场景里常有几十个 `peg`）。
`getBodyByName` 返回第一个匹配，`getBodiesByName` 返回全部（插入序），
`renameBody` 接受物体或 id。名字随 `snapshot()` 保存、随 `load()` 还原。
在 MotionLab 中，物体的标签（label）即其引擎名。

### 万有引力（1.4.0）

`setGravitation(G, { softening = 100 })` 打开全体两两引力：每个动态体
每步受到 `a = Σ G·m_j·d / (|d|² + softening)^1.5` 的速度踢（每固定步一次，
与 substeps 无关）。静态体只吸引不移动，其质量按 **面积 × 描述符密度**
计算（Matter 中静态体的 density 是 Infinity，不能直接用）。总动量守恒。
复杂度 O(n²)/步，适合几十个体量级的轨道/行星模拟。轨道初速度用
`Formulas.orbitVelocity(G, M, r)` 计算即可得到近圆轨道（见示例
`examples/orbit.html`）。

### 流体区域与浮力（1.4.0）

`addFluid({ x, y, width, height, density = 0.0012, drag = 0.02, vx = 0, vy = 0 })`：
(x, y) 为区域**中心**，上沿即液面。动态体与区域重叠时，浮力经 Matter 的
力通道施加，大小与世界重力镜像、按 `(流体密度 / 物体密度) × 浸没比例`
缩放——全浸且密度相等时恰好中性悬浮；`drag` 为浸没时每子步的速度保留
衰减。浮力只在世界重力非零时生效。快照携带 `fluids` 数组。1.9.0 起：
`drag` 改为把速度向**有效流速**混合（流体自带流速 `vx/vy` + 风场重叠
时带入的表面水流，约风速四成 × 功率 × 水平重叠比例），并以 2.5 倍
系数衰减角速度——转子、桨叶在水里会被真实刹住；阻尼与水流在零重力
世界同样生效（只有浮力需要重力）。`fluidFlow(id)` 读回当前有效流速。
1.10.0 起浮力按成立条件算：浸没比例是部件多边形裁剪到流体矩形后的
**真实面积**比例（跨界只算浸到部分、圆形与斜放按真实形状），力作用在
浸没形心（**浮心**）上（斜浮体会被扶正或倾覆）；底面被其它物体贴合
密封的比例经三点采样检测，浮力随密封比例消退、顶面浸没时另有水柱
下压——贴池底的轻块不会自浮。

### 磁力（1.5.0）

描述符字段 `magnet` 是带符号的极性强度（−100..100，正为 N 极、负为 S 极）。
两个磁性体之间按 `F = K · s1 · s2 / (d² + ε²)` 相互作用：同号相斥、异号
相吸（即 `Formulas.magneticForce`）；磁性体还会以等效强度 35 吸引无磁性
的动态体（「铁」）。与引力相同，磁力以速度踢方式每固定步施加一次；双边
踢量为 力 ÷ 各自质量，故总动量守恒、轻体反应更强；单步踢速上限 0.8。
与引力不同，磁力是短程的：超出 `range`（默认 320）的配对完全无力，
内部用均匀网格做范围裁剪。全局用 `setMagnetism(K, { range, softening })`
调参，`setMagnetism(0)` 关闭；运行时改单个物体用 `setMagnet(body, v)`。

### 风场区域（1.5.0）

`addWind({ x, y, width, height, vx = 3, vy = 0, power = 1, gust = 0, gustPeriod = 6 })`：(x, y) 为
区域**中心**，(vx, vy) 是风速（px/步）。动态体与区域重叠时，其速度每子步
按比例混合趋向风速，混合率 ∝ 重叠面积比例 × `power` × (0.0012 ÷ 物体
密度)：轻体迅速被吹到风速，密实体几乎不动——流体的气态对应物（浮力靠
密度比，这里的混合率同样靠密度比）。快照携带 `winds` 数组。`gust`
（0..0.9，1.8.0）让风速按 (1 + gust × sin(2π × t ÷ gustPeriod)) 呼吸，
t 是引擎模拟时钟（全部区域同节奏，像一片天气系统）；时钟随快照
（`simMs`）保存，读档后阵风相位不跳变。

### 铰链与马达（1.7.0）

`addHinge({ bodyA, bodyB, pointA, pointB, motorSpeed = 0, motorPower = 0.0025 })`：
把两个物体钉在一个共享点上，只能绕该点相对转动（零长度刚性约束，与
牛顿摆摆杆同机制）；`bodyA` 传 `null` 时 pointA 是世界坐标里的固定铰座。
`motorSpeed` 是马达目标**相对角速度**（弧度/步，±0.3，正为顺时针），
每固定步以 `motorPower` 为上限加速逼近；两端都是动态体时反作用按
转动惯量反比分配，动量诚实。被马达驱动的物体不会休眠（休眠会把速度
清零、与驱动打架）。**碰撞分组**：铰链连通的物体簇共享一个负的
Matter 碰撞组——同一台机器的零件互不碰撞、可互相穿过，否则两根
端点铰接的杆折叠几度就会被自己的边角卡死；与机器外物体的碰撞照常。
铰链随快照保存（`hinges` 数组），删物体自动清理其铰链；
`hingeAnchors()` 返回解析后的世界铰点坐标，供渲染标记与拾取。

### Formulas 公式库（1.4.0）

`import { Formulas } from '.../physics-engine.js'`（或
`PhysicsEngine.Formulas`）。全部为纯函数，单位与引擎一致（px、px/步）：

| 公式 | 函数 |
|---|---|
| 动能 / 转动动能 | `kineticEnergy(m, vx, vy)` / `rotationalEnergy(I, ω)` |
| 动量 / 改速冲量 | `momentum(m, vx, vy)` / `impulseForDeltaV(m, dvx, dvy)` |
| 万有引力大小 | `gravitationalForce(G, m1, m2, r)` |
| 磁极作用力（有符号，1.5.0） | `magneticForce(K, s1, s2, d², ε²)`（正为斥、负为吸） |
| 环绕 / 逃逸速度 | `orbitVelocity(G, M, r)` / `escapeVelocity(G, M, r)` |
| 胡克定律 / 弹簧势能 | `springForce(k, x)` / `springEnergy(k, x)` |
| 单摆周期 | `pendulumPeriod(L, g)` |
| 阿基米德浮力（2D） | `buoyancyForce(ρ, 浸没面积, g)` |
| 二次阻力 / 最大静摩擦 | `dragForce(c, v)` / `frictionForce(μ, N)` |
| 抛射程 / 向心加速度 / 势能 | `projectileRange(v, θ, g)` / `centripetalAcceleration(v, r)` / `potentialEnergy(m, g, h)` |

配合实例测量（`totalMomentum()`、`centerOfMass()` 等）可直接验证守恒律。

### 稳定性与校验（1.4.0）

- `PhysicsEngine.validateDescriptor(desc)` 静态校验，返回问题清单（不抛错）；
  `addBody` 本身保持宽容（坏值回退默认值），导入器可用前者做严格把关。
- 位置/速度/角度 setter 与 `addVelocity` **忽略非有限输入**，防止 NaN 毒化世界；
  `findNonFiniteBodies()` 可审计世界健康。
- `{ maxSpeed }`（或 `setMaxSpeed(v)`）给速度封顶（px/步，0 = 关）：封顶在求解器
  之前执行，失控冲量不会把物体送出世界。
- `load()` 跳过非对象条目并返回 `{ bodies, constraints, fluids, winds, hinges }` 载入计数。

### 版本历史

- 1.0.0 — 从 MotionLab 抽离为通用核心
- 1.1.0 — `substeps` 防穿模
- 1.2.0 — 空间查询（`queryRegion` / `raycast`）、冲量助手
  （`addVelocity` / `applyRadialImpulse`）、`pick()` 零分配优化
- 1.3.0 — 种子随机（`seed` 选项、`random` 系列 API、快照携带 RNG 状态）
- 1.4.0 — 命名物体、万有引力、流体浮力、Formulas 公式库、稳定性加固
  （校验 / 非有限守卫 / 速度封顶）
- 1.5.0 — 磁力（`magnet` 描述符字段、极性互斥/相吸、吸铁、范围裁剪）、
  风场区域（`addWind`）、两两力通道优化（统一遍历 + 类型化数组 +
  引力对称配对，隔离基准约快 40%）
- 1.5.1 — 磁力修复：含静态磁铁的极对在动态磁体先添加时会被去重逻辑
  误跳过，现仅当较早一遍确实能处理该对时才去重（极对与添加顺序无关）
- 1.6.0 — 性能优化（行为不变）：两两力通道零分配（类型化缓冲复用、磁体
  列表/索引缓存、数值键池化网格）；引力拆为动态–动态对称环 + 动态–静态
  单向环，静态–静态配对不再计算（静态多的世界配对通道约快 40%）；流体
  跳过休眠体、约束线段池化；新增零分配迭代 forEachFluid / forEachWind
- 1.7.0 — 机械：铰链（addHinge，绕共享点转动）与马达（目标相对角速度，
  加速上限、反作用按转动惯量反比分配、驱动体不休眠）；铰链簇共享负
  碰撞组（同机零件互不碰撞）；hingeAnchors 供渲染/拾取；快照携带铰链
- 1.7.1 — 求解器：默认 constraintIterations 2 → 4（可用构造选项
  `constraintIterations` 覆盖）。多个刚性约束同时生效（铰链簇、三角
  锁定十字臂）时，2 次迭代会留下数像素级锚点误差（摩天轮实测轮毂
  漂移 28px、十字夹角误差 5.6°）；提到 4 后同一台机器轮毂精确锁定、
  夹角误差 <1°
- 1.8.0 — 风场阵风：区域新增 gust（0..0.9）与 gustPeriod（2..30 秒），
  有效风速按 (1 + gust × sin(2π × t ÷ 周期)) 呼吸；t 为引擎模拟时钟，
  全部区域同相（同一片天气），时钟随快照 simMs 保存、读档相位不跳变；
  gust = 0 时与旧行为逐位一致
- 1.10.0 — 浮力成立条件：真实浸没面积（多边形裁剪）、浮心着力、
  贴底密封检测（浮力随密封比例消退 + 水柱下压）；阻尼按真实面积缩放
- 1.9.0 — 模块联动：流体阻尼同时衰减角速度（2.5 倍系数，转子/桨叶
  在水里被刹住；风车加默认水实测慢约 23%，此前约 11% 且被阵风掩盖）；
  流体新增流速 vx/vy，阻尼向有效流速混合；风场与流体重叠时带入表面
  水流（阵风修正风速 × 40% × 功率 × 水平重叠），fluidFlow(id) 可读；
  流体阻尼/水流不再被零重力整体关掉（只有浮力需要重力）
- 1.11.0 — 后端接口正式化：`BACKENDS` 注册表（matter 使用中 / native
  自研规划中，目标 1.41）+ `PhysicsEngine.create({ backend })` 按注册表
  构造 + 实例 `backendId`；未就绪后端明确报错不静默回退，模拟行为零变化
- 1.12.0 — 自研 Native 后端落地（experimental）：`create({ backend:
  'native' })` 直接构造；从零编写的顺序冲量求解器覆盖全部公开接口
  （堆叠/休眠/铰链马达/真实浮力/磁力/引力/阵风/快照/种子随机），力模型
  按固定步踢一次、子步下限 2；专属行为测试 43 项（tests/native-tests.mjs）
- 1.12.7 — 新增 `noSleep` 描述符：标记的物体双后端永不入睡（Matter 走 `sleepThreshold: Infinity`，Native 在睡眠遍中跳过）。为多米诺这类「慢速不稳定」物体而设——倾倒中的牌运动量衰减到睡眠阈值以下会被中途冻住。场景格式经 `bodyData` 透传；新增双后端测试各 3 项。
- 1.12.6 — 快照保真修复：`describeBody` 新增 `va`（角速度）与 `sleeping` 字段，`addBody` 双后端均恢复二者——此前快照恢复会静默清零自旋并唤醒全部睡眠体，使热身后录制的回放与实况分家（牛顿摆实测 >14 px）。求解行为不变；新增双后端快照保真测试各 5 项。
- 1.12.5 — 性能优化（行为不变）：孤儿唤醒探测（双后端）改走均匀网格候选对（原 O(睡眠体×全体），约 800 物体时占步进总时间约 31%）；Native 接触排序/热启动键改数字键、求解器临时向量复用、支撑标记改步内戳记、形状同步跳过睡眠体。
- 1.12.4 — 双引擎 API 对齐：Native 补齐 `wake` / `setMaxSpeed` / `maxSpeed` / `clearFluids` / `clearWinds` / `dragBody`，`dragging` 两后端统一为布尔；新增 parity 与带框世界回归测试，求解行为不变。
- 1.12.3 — 孤儿睡眠体唤醒（双后端）：每 15 步支撑探测唤醒失去支撑的睡眠体（删掉塔底、拖走支撑物不再让上方物体悬空）；支撑 = 接触链到非睡眠体/约束铰链挂载/流体浸没；零重力豁免。
- 1.12.2 — Native 健壮性：参考面裁剪对「入射顶点恰落在侧平面上」的精确对齐堆积不再崩溃（极限场景曾因此中途冻结）；休眠改平滑运动量 + 支撑记忆（密集堆积入睡 72→163/705）；热启动冲量只在首个子步施加（重复施加是按子步数放大的能量泄漏）
- 1.12.1 — Native 宿主契约修复：圆形刚体补 `vertices` 多边形近似
  （10–25 边，与 Matter 一致）——宿主按顶点路径绘制每个刚体，1.12.0 的
  圆形顶点为空曾使画布只剩网格；求解行为无变化。**后端契约补充：每个
  刚体（含圆）必须暴露非空 `vertices` 并随位姿更新。**

---

### MotionLab 场景文件格式（宿主格式，1.39 导入加固）

引擎本身不认识文件格式；MotionLab 宿主的场景 JSON 结构为
`{ format: 'motionlab-scene', version: 2, name, settings, bodies, constraints, hinges, fluids, winds }`
（version 1 的旧文件仍可导入）。导入（含分享链接解压后的字节数）统一
上限 **2 MB**；数量预算：物体 ≤ 2000、约束 ≤ 500、铰链 ≤ 500、流体/风场
各 ≤ 20。`validateScene`（`js/scene.js`）逐项审计：坐标须有限且
|坐标| ≤ 100000，宽高 ∈ (0, 5000]、半径 ∈ (0, 2500]、边数 3–64 的整数、
弹性 0–2、场景名 ≤ 128 字、物体标签 ≤ 64 字；约束/铰链的端点必须引用
已存在的物体。超限或不合法的文件会被整体拒绝并给出中文原因，当前场景
不受影响。导出与分享链接走同一套校验。

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
node tests/engine-tests.mjs        # PhysicsEngine 核心（140 项）
node tests/native-tests.mjs        # Native 后端行为（53 项）
node tests/native-render.mjs       # Native 下真实应用绘制 + 零窗口错误（7 项）
node tests/run-tests.mjs           # 场景/逻辑（160 项）
node tests/smoke.mjs               # 应用冒烟（91 项）
node tests/nav-smoke.mjs           # 主界面/导航冒烟（39 项）
node tests/landing-smoke.mjs       # 落地页冒烟（18 项）
node --expose-gc tests/soak.mjs    # 内存浸泡（17 项；漏加 --expose-gc 会误报堆暴涨）
node tests/render-tests.mjs        # 渲染缓存（10 项）
node tests/pf-smoke.mjs            # PF 引擎逻辑（27 项）
node tests/pf-ui-smoke.mjs         # PF 界面冒烟（10 项）
node tests/engine3d-tests.mjs      # 3D 核心（22 项）
node tests/lab3d-smoke.mjs         # 3D 实验室冒烟（13 项）
# 全量 607 项（MotionLab 1.44 / PhysicsEngine 1.12.3 时点）
```

发布流程为静态文件直推 GitHub Pages；`version.json` 与入口资源的 `?v=`
参数随版本同步更新，应用内有新版本提示条。
