# MotionLab — 2D Physics Sandbox

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![PhysicsEngine](https://img.shields.io/badge/PhysicsEngine-1.12.4-blue.svg)
![Matter.js](https://img.shields.io/badge/Matter.js-0.20.0-lightgrey.svg)
![Tests](https://img.shields.io/badge/tests-628%20passing-brightgreen.svg)

[![MotionLab 演示 — 万有引力轨道：两颗行星在两两引力下绕恒星运行（动画轨迹为 PhysicsEngine 实时模拟数据，点击在线试玩）](docs/demo.svg)](https://xieyuke2026-cpu.github.io/Physics-engine/)

**📬 联系 / Contact**：反馈邮箱 **motionlabphysics@agent.qq.com**（由维护者的 AI 助手 Muse 收件、整理并转交） · Reddit [**u/MotionLab-Physics**](https://www.reddit.com/user/MotionLab-Physics)

## English

**MotionLab** is a browser-based 2D physics sandbox — no build step, no backend, open the page and play on desktop or tablet. Create rigid bodies, tune gravity, friction and elasticity, connect springs, rods and motorised hinges, add pairwise gravitation, fluid buoyancy, magnetism and gusting wind, then save experiments as portable JSON scenes or share links.

It runs on **two switchable solver backends** behind one API: the battle-tested **Matter.js** backend (the default) and **Native**, a solver written from scratch in this repo (experimental) — the same scene replays on either engine, so you can compare how they feel.

Its physics layer, **PhysicsEngine**, is a standalone open-source 2D physics core designed for reuse in other projects (see *Reuse* below). A platform-fighter prototype, **PFLab**, is included as a demonstration of what the same API can build.

- **Live demo**: https://xieyuke2026-cpu.github.io/Physics-engine/
- **Examples**: [Orbital gravitation](https://xieyuke2026-cpu.github.io/Physics-engine/examples/orbit.html) · [Fluid buoyancy](https://xieyuke2026-cpu.github.io/Physics-engine/examples/buoyancy.html) · [Seeded Galton board](https://xieyuke2026-cpu.github.io/Physics-engine/examples/galton.html) · [Fluid spreading — dam breach](https://xieyuke2026-cpu.github.io/Physics-engine/examples/spread.html)
- **Developer docs**: [docs/DEVELOPER-EN.md](docs/DEVELOPER-EN.md) （中文版：[docs/DEVELOPER.md](docs/DEVELOPER.md))
- **Changelog**: [CHANGELOG.md](CHANGELOG.md) · **License**: MIT

中文完整文档在下方 ↓ Full documentation in Chinese below.

---

一个运行在浏览器中的 2D 物理模拟与实验平台。设计关键词：Minimalist · Scientific ·
Interactive · Responsive · Lightweight——黑白灰为主、低饱和蓝为强调色的科学软件风格，
全部图标为统一线条风格的 SVG。

- **在线试玩**：https://xieyuke2026-cpu.github.io/Physics-engine/
- **本地运行**：任意静态服务器即可，如 `python3 -m http.server 8000`；无后端、无构建、无 API Key。
- **开发者文档**：[docs/DEVELOPER.md](docs/DEVELOPER.md)（English: [docs/DEVELOPER-EN.md](docs/DEVELOPER-EN.md)）——PhysicsEngine 与 PF 引擎的完整 API 与接入方式。
- **更新记录**：[CHANGELOG.md](CHANGELOG.md)（功能列表不再塞版本日志，历史都在那里）。

## 功能

### 物理模拟

- 刚体：圆形、矩形、正多边形、三角形、静态线段（斜坡）；重力（X/Y 可调、可关闭、月球/木星等预设）、摩擦、弹性、旋转、质量与密度。
- 约束与机械：弹簧 / 连杆（两点放置，低刚度画作弹簧、高刚度即连杆）、铰链与马达（同机零件互不碰撞、马达匀速驱动）、删除物体自动清理其约束与铰链。
- 求解品质：固定时间步 + 子步进防穿模（高速物体不跳过薄墙）；刚体休眠（静止自动睡、碰撞/编辑/拖拽自动醒），且**失去支撑的睡眠物体会自动醒来掉落**——删掉塔底不会留下悬空的塔。
- 场景自带地面与左右墙作为框架物体，可选中、调参、删除。

### 世界效应（引擎级力模型）

- **万有引力**：全体两两牛顿引力 + 软化防奇点，静态体按面积×密度计质量。
- **流体浮力**：按真实浸没面积与浮心施力（斜浮体自扶正）、底面密封时浮力消退（贴池底的轻块不自浮）；流体可带流速，阻尼同时刹平移与旋转。
- **磁力**：带符号极性（同斥异吸、吸无磁性的铁），范围与强度可调。
- **风场**：速度混合率按密度区分轻重物体；带「阵风」呼吸；**模块联动**——风吹过水面带出表面水流、顺流漂物。
- **种子随机**：引擎级可复现随机流，种子随场景保存；「随机扰动」「按种子重演」结果完全可复现（钉板换种子，落点分布随之改变）。

### 双引擎

- 同一公开 API、两个求解器后端：**Matter.js**（默认、成熟稳定）与 **Native**（本仓库从零编写的顺序冲量求解器，实验性）。
- 后端由注册表 `PhysicsEngine.BACKENDS` 管理，`PhysicsEngine.create({ backend })` 构造；设置里切换即以当前场景重建并重演，场景属性面板会显示当前后端。

### 编辑与交互

- 工具栏：选择 / 移动 / 圆 / 矩形 / 多边形 / 三角形 / 线段 / 磁铁 / 弹簧 / 铰链 / 冲击波（径向推开一片物体）/ 删除，带悬停说明。
- 点按放置或拖拽定尺寸创建；运行中物理拖拽可投掷物体；静态物体可开启「拖动静态」直接改位。
- 画布缩放（滚轮 / 捏合 / 按钮）与平移；播放 / 暂停 / 单步；Undo / Redo；快捷键（空格播放、Delete 删除、Ctrl+D 复制、方向键微调、R 旋转）。
- 属性面板：名称（可重命名）、位置/尺寸/角度、密度/摩擦/空气阻力/弹性、材质一键预设（泡沫/木头/橡胶/冰/铁）与磁性设置、实时读数（速率/动能/角速度/动量）；未选中时是场景属性（重力、世界效应区域的添加与编辑、随机种子、物体列表）。
- 导出：画布截图 PNG；**GIF 录制**（零依赖自研编码器，12 fps、最长 20 秒）。

### 场景与分享

- **21 个预设**：牛顿摆、多米诺、金字塔、斜坡、高弹阵列、双摆、桥梁、钉板、蹦床、漏斗、过山车、保龄球、万有引力轨道、浮力池、磁铁阵列、风洞、材质实验室、磁铁秋千、马达风车、摩天轮、纯风风车——首页带缩略图，一键载入。
- 场景库（localStorage 保存/复制/重命名/搜索）+ 自动保存与恢复；主界面为工作台布局（场景/预设列表 + 详情检查器）。
- **JSON 导入/导出**（格式 `motionlab-scene` v2，旧版 v1 可导入）：导入有 2 MB 上限与逐项校验（数量预算、坐标与尺寸范围），坏文件整体拒绝并说明原因，不伤当前场景。
- **分享链接**：整个场景压缩进一条 `#s=` 链接，对方打开即进入该场景。
- 打开页面会检查 `version.json`，有新版本时顶部提示一键刷新，不怕缓存旧版。

### PFLab（引擎演示）

基于同一个 PhysicsEngine 构建的平台格斗原型（`js/pf/`，从主界面进入）：角色控制器（二段跳/冲刺/土狼时间）、三段式攻击判定、伤害击飞、确定性 AI 假人（三种档位）、键盘与触屏虚拟键。它同时是引擎 API 的完整度演示——战斗判定与 AI 只调用公开 API。

## 复用 PhysicsEngine（开源）

本仓库以 **MIT 许可证开源**（见 [LICENSE](LICENSE)），核心目标之一就是让物理核心能被任何项目直接复用：

- **三个文件**：`js/engine/physics-engine.js`（引擎 + 后端注册表）+ `js/engine/native-engine.js`（自研后端）+ `vendor/matter.min.js`（默认后端）；另有 **TypeScript 类型声明** `js/engine/physics-engine.d.ts`，无构建也可获得类型提示。
- **最小示例**：

```html
<script src="matter.min.js"></script>
<script type="module">
  import { PhysicsEngine } from './physics-engine.js';
  const pe = new PhysicsEngine({ enableSleeping: true, substeps: 2 });
  pe.addBody({ kind: 'rect', x: 400, y: 560, width: 800, height: 40, isStatic: true });
  pe.addBody({ kind: 'circle', x: 400, y: 120, radius: 18, restitution: 0.6 });
  let last = performance.now();
  (function frame(now) { pe.advance(now - last); last = now; requestAnimationFrame(frame); })(last);
  // 每帧读 pe.allBodies() 的 position / angle 自行绘制
</script>
```

- **能力速览**：固定步进、休眠、种子随机、物体命名、空间查询（区域/射线）、冲量助手、快照/还原（纯 JSON）、`Formulas` 公式库（动能/动量/轨道速度/浮力等），以及上文全部世界效应。完整 API 见开发者文档。
- **在线示例**：[万有引力轨道](https://xieyuke2026-cpu.github.io/Physics-engine/examples/orbit.html) · [流体浮力](https://xieyuke2026-cpu.github.io/Physics-engine/examples/buoyancy.html) · [种子钉板](https://xieyuke2026-cpu.github.io/Physics-engine/examples/galton.html) · [流体蔓延（水坝决口）](https://xieyuke2026-cpu.github.io/Physics-engine/examples/spread.html)（源码在 `examples/`）。
- **独立包**：`~/workspace/physics-engine/` 是同一核心的独立打包（引擎 + 类型声明 + 测试 + 示例），与站内副本保持同步。
- **PF 引擎**（`js/pf/`）：平台格斗模块集，同样可独立调用（门面 `PFEngine`、无头对局、AI 档位与调参）。
- 参与开发：[CONTRIBUTING.md](CONTRIBUTING.md) · 安全政策：[SECURITY.md](SECURITY.md) · 测试报告：[TEST-REPORT.md](TEST-REPORT.md)

## 项目结构

```
index.html            页面骨架（顶栏 / 左工具栏 / 画布 / 右面板 / 状态栏 / 弹窗 / 主界面）
css/style.css         全部样式（黑白灰 + 低饱和蓝，iPad 13" 横屏优先）
js/icons.js           统一 SVG 图标集（1.7 线宽、24 网格）
js/scene.js           纯数据层：场景/物体数据模型、默认值、导入校验（无 DOM 依赖，可单测）
js/engine/physics-engine.js   通用可复用物理核心：固定步进、休眠、描述符建体/序列化、
                      约束/铰链管理、力模型、双后端注册表（与 MotionLab 格式无关）
js/engine/native-engine.js    自研 Native 求解器后端（顺序冲量、SAT 接触、休眠）
js/engine/physics-engine.d.ts PhysicsEngine 的 TypeScript 类型声明
js/physics.js         薄适配层：MotionLab 场景格式 ⇄ 通用引擎描述符
js/render.js          Canvas 渲染器 + 相机（静态层/背景层离屏缓存、视口裁剪）
js/record.js          GIF 录制导出（零依赖 GIF89a 编码器）
js/ui.js              右侧属性面板与设置弹窗
js/storage.js         localStorage：场景库、自动保存、UI 设置（损坏数据自动回退）
js/app.js             应用装配：工具与指针交互、历史记录、场景管理、主循环
js/pf/                PFLab 平台格斗模块（PF 引擎）
vendor/matter.min.js  Matter.js 0.20.0（本地托管，不依赖 CDN）
tests/                Node 测试套件（见下）
```

UI、物理引擎、场景管理三层分离：`ui.js` 不直接接触 Matter，`physics.js` 不操作 DOM，
`scene.js` 是可独立测试的纯数据模块。3D 实验室界面已隐藏（`FEATURE_3D = false`），
3D 核心 PhysicsEngine3D 与已存场景保留，独立用法见开发者文档。

## 数据格式

场景导出 JSON（节选）——保存的是物理对象与参数本身，导入后完整重建物理世界：

```json
{
  "format": "motionlab-scene",
  "version": 2,
  "name": "Untitled Scene",
  "settings": { "gravityX": 0, "gravityY": 1, "gravityEnabled": true, "speed": 1, "seed": 1 },
  "bodies": [
    { "id": "body-…", "type": "circle", "x": 380, "y": 120, "radius": 30,
      "density": 0.001, "friction": 0.3, "restitution": 0.55, "isStatic": false, "lockRotation": false }
  ],
  "constraints": [
    { "id": "spring-…", "bodyA": null, "bodyB": "body-…",
      "pointA": { "x": 380, "y": 40 }, "pointB": { "x": 0, "y": 0 },
      "stiffness": 0.08, "damping": 0.05, "length": 80 }
  ]
}
```

格式细节与导入限制见 [开发者文档](docs/DEVELOPER.md) 的「场景文件格式」一节。

## 部署

纯静态站点：仓库 Settings → Pages → Source 选 `Deploy from a branch`、分支 `main`、目录 `/ (root)` 即可，无需 Actions 构建。

## 已知问题

- 画布世界未做无限边界管理：把物体拖到很远处后需用「适应画布」按钮找回视角。
- 极端参数组合（如弹性 1 + 高速）在 Matter 后端仍可能有轻微抖动（休眠与子步已大幅缓解）；也可切换到 Native 后端对比。
- 深色模式未实现（设计已预留）。
- Apple Pencil 专属功能未实现（按需求暂缓）。
- Native 后端仍为实验性：密集堆积的沉降与入睡速度与 Matter 有差异，默认后端保持 Matter。

## 测试

全量 **607 项**（13 个套件，Node 直接运行）：引擎核心 140、Native 后端 53 + 渲染 7、
场景/逻辑 160、应用冒烟 91、导航 39、落地页 18、内存浸泡 17、渲染 10、PF 27+10、3D 22+13。
逐项结果与历次定位记录见 [TEST-REPORT.md](TEST-REPORT.md)。

## 联系与反馈 / Contact & Feedback

- 功能建议、bug 反馈与玩法分享：Discussions、Issues，或发邮件到项目反馈邮箱
  **motionlabphysics@agent.qq.com**（由维护者的 AI 助手 Muse 收件、整理并转交维护者）
- For suggestions, bug reports, or ideas, you can also email the project inbox:
  **motionlabphysics@agent.qq.com** (received and triaged by Muse, the maintainer's AI
  assistant, and forwarded to the maintainer)
- Reddit：[u/MotionLab-Physics](https://www.reddit.com/user/MotionLab-Physics)（发帖与更新动态都在那里）
