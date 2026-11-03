# 更新日志 Changelog

本仓库包含两个版本线：**MotionLab**（应用）与 **PhysicsEngine**（可复用物理核心，
位于 `js/engine/physics-engine.js`，另有 3D 核心 PhysicsEngine3D 1.0.0）。
格式参考 Keep a Changelog；最新在上。

## [MotionLab 1.24] — 2026-11-03

应用新增中文 / English 双语界面（PhysicsEngine 仍为 1.4.0，引擎未改）：

- **语言切换**：设置顶部新增「语言 Language」一节（中文 / English），点选即
  全应用即时切换——属性面板、工具提示、状态栏、主界面、落地页、PFLab 与
  开发者文档视图全部跟随；选择保存在 localStorage（`motionlab.lang`）。
- **首次进入英文引导**：没有存过语言时，界面默认英文，落地页顶部有醒目的
  语言选择（English / 中文），选完即整页切换并记住；落地页预设快捷入口与
  主界面预设卡片在英文下显示英文名（Newton's Cradle、Orbital Gravitation 等，
  场景数据本身不变）。
- **开发者文档双语**：新增 `docs/DEVELOPER-EN.md`（英文完整版），与中文版
  `docs/DEVELOPER.md` 顶部互链；应用内文档视图随语言切换中/英文版。
- **恢复出厂不改语言**：语言是设备偏好而非场景数据，「重置数据」不清除它
  （欢迎页会照常重现，并以当前语言显示）。
- 已知范围：隐藏中的 3D 实验室界面未做双语（仍为中文，恢复显示时再补）。
- 测试：MotionLab 全量 344 项（新增首访英文默认 + 落地页选语言、设置内
  切换即时重渲染、主界面/文档/预设名跟随、恢复出厂保留语言等断言）。

## [MotionLab 1.23] — 2026-11-02

引擎能力此前只有 API、没有界面入口，本版把它们接进实验室（PhysicsEngine 仍为 1.4.0）：

- **万有引力入口**：场景属性面板新增「世界效应 · 引力与浮力」一节——G 滑杆/数值
  与软化参数直接调 `setGravitation`，随场景存档；状态栏同步显示 G 与流体数。
- **流体（浮力）入口**：同节「添加流体区域」放一个默认水池；流体在画布上渲染为
  蓝色半透明区域（上沿为液面），点选后可编辑中心/宽高/密度/水中阻尼，删除工具
  也可点删。场景格式新增 `fluids` 数组（导入校验同步覆盖）。
- **重命名入口**：物体属性面板顶部新增「名称」输入框，走引擎 `renameBody`，
  改名即存档、物体列表与按名查找同步生效。
- **新预设**：「万有引力轨道」（无边框太空场景，G=30、普通重力关；注意帧体在
  两两引力下会以 面积×密度 的质量把行星拽偏，所以轨道场景不放地面墙壁；
  行星空气阻力为 0，否则轨道会衰减）与「浮力池」（软木/木块/铁块按密度分层）。
  预设总数 12 → 14。
- **工具栏悬停说明**：左侧工具栏每个按钮新增悬停气泡（`data-tip`），写明操作
  内容；原生 title 同步补全。
- **移除双击添加圆形**：按使用反馈删除该隐藏手势，建形只走形状工具。
- 测试：MotionLab 全量 328 项（新增轨道/浮沉预设实测、场景流体往返与校验、
  面板入口与双击移除的冒烟断言）。

## [MotionLab 1.22 / PhysicsEngine 1.4.0] — 2026-11-02

### PhysicsEngine 1.4.0

- **命名物体**：描述符新增 `name`；`getBodyByName` / `getBodiesByName`（可重名）、
  `renameBody`、`nameOf`；名字随快照保存。MotionLab 的物体标签即其引擎名。
- **万有引力**：`setGravitation(G, { softening })` 全体两两引力（静态体质量 = 面积 × 描述符密度），
  `setGravitation(0)` 关闭；总动量在引力下守恒（有测试）。
- **流体浮力**：`addFluid({ x, y, width, height, density, drag })` 流体区域——浮力按
  密度比 × 浸没比例施加，另带水中阻尼；快照携带流体。
- **公式库 Formulas**：动能/动量/冲量/万有引力/轨道与逃逸速度/胡克定律/单摆周期/浮力/
  阻力/摩擦/抛射程/向心加速度/势能等纯函数；实例测量 `bodyKineticEnergy`、
  `totalKineticEnergy`、`bodyMomentum`、`totalMomentum`、`centerOfMass`。
- **稳定性**：`PhysicsEngine.validateDescriptor()` 静态校验；setter 忽略非有限输入；
  构造选项 `maxSpeed` 速度封顶；`load()` 跳过坏条目并返回载入计数；
  `findNonFiniteBodies()` 健康审计。
- 测试：引擎单测 82 项（含轨道稳定性、浮沉、钉板确定性）。

### 开源生态

- 新增 MIT `LICENSE`、`CONTRIBUTING.md`、本更新日志。
- 新增 `examples/` 三个可直接打开的示例：万有引力轨道、流体浮力、种子钉板
  （GitHub Pages 上同样可访问：`examples/orbit.html` 等）。

## [MotionLab 1.21 / PhysicsEngine 1.3.0] — 2026-11-02

- **种子随机**：构造 `{ seed }`、`random / randomRange / randomInt / choice / shuffle`、
  `setSeed`（对齐 Matter 内部种子）；快照携带 RNG 状态。钉板确定性测试：同 seed 分格逐格一致。

## [MotionLab 1.20 / PhysicsEngine 1.2.0 / PF 引擎 1.1.0] — 2026-11-02

- PhysicsEngine 1.2.0：`queryRegion` / `raycast` 空间查询、`addVelocity` / `applyRadialImpulse`
  冲量助手、`pick()` 零分配。
- PF 引擎 1.1.0：`PFEngine` 门面（`createMatch` 无头对局 / `createLab` / `tune`）、AI 档位
  calm / normal / sharp。
- Matter.js 0.19.0 → 0.20.0（全套件零失败后替换）。
- 新增 `docs/DEVELOPER.md`（GitHub 直读的开发者文档）；3D 界面残留以结构护栏隐藏（代码保留）。

## [MotionLab 1.19] — 2026-11-02

- 开发者文档页版本号改为从单一事实源动态填充，不再写死。

## [MotionLab 1.18] — 2026-11-02

- 修复样式表一处被截断的规则导致其后全部样式（PFLab、文档页等）失效的问题；
  测试新增样式完整性守卫。PFLab 入口改到主界面侧边栏（手柄图标）。

## 更早版本（摘要）

- 1.14–1.17：PFLab 平台格斗实验室（独立模块，基于 PhysicsEngine 公开 API）。
- 1.13：版本号单一事实源；弹窗层级修复。
- 1.12：真实齿轮设置图标；开发者文档视图。
- 1.11：恢复出厂（重置全部本地数据）。
- 1.10：过山车回环预设重做；引擎 substeps 防穿模（PhysicsEngine 1.1.0）。
- 1.9：冲击波工具；保龄球预设。
- 1.8：3D 实验室下线隐藏（代码与数据保留，PhysicsEngine3D 1.0.0 仍在独立包中）。
- 1.3–1.7：首次访问落地页、项目主页（主界面）、3D 实验室、预设缩略图。
- 1.2：PhysicsEngine 从应用中抽离为通用核心（1.0.0）。
- 1.0–1.1：2D 物理沙盒本体、弹簧/连杆约束。
