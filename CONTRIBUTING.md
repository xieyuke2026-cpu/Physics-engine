# 参与贡献 Contributing

欢迎！本仓库的目标是做一个**能在浏览器里直接用的物理实验平台**，以及一个
**可被任何项目复用的物理引擎核心**（PhysicsEngine）。无论你想修 bug、加预设、
还是给引擎加新能力，这份指南说明如何把改动跑起来、测好、提上来。

**联系维护者**：反馈邮箱 **motionlabphysics@agent.qq.com**（由维护者的 AI 助手 Muse 收件、整理并转交） · Reddit [u/MotionLab-Physics](https://www.reddit.com/user/MotionLab-Physics)

## 项目结构

| 路径 | 内容 |
|---|---|
| `index.html` / `css/` / `js/` | MotionLab 应用本体（无构建步骤，纯静态） |
| `js/engine/physics-engine.js` | **PhysicsEngine 2D 核心**（与宿主无关，可单独复用） |
| `js/engine/physics-engine-3d.js` | PhysicsEngine3D 核心（cannon-es） |
| `js/pf/` | PF 引擎 / PFLab 平台格斗模块（只依赖 PhysicsEngine 公开 API） |
| `docs/DEVELOPER.md` / `docs/DEVELOPER-EN.md` | 引擎与 PF 引擎的完整调用文档（中 / 英） |
| `examples/` | 三个独立示例页（轨道 / 浮力 / 种子钉板），可直接打开 |
| `tests/` | Node 自动化测试（见下） |
| `vendor/` | 第三方库原文件（matter.min.js 等），**不要手改** |

## 本地运行

无需安装任何东西。任选其一：

```bash
python3 -m http.server 8000   # 然后打开 http://localhost:8000
```

或直接用浏览器打开 `index.html`。示例页同理（`examples/orbit.html` 等）。

## 跑测试

需要 Node.js（仅测试用，应用本身零依赖、零构建）：

```bash
cd tests
node engine-tests.mjs      # PhysicsEngine 核心单测
node engine3d-tests.mjs    # 3D 核心单测
node run-tests.mjs         # MotionLab 场景/适配层逻辑
node pf-smoke.mjs          # PF 引擎逻辑
node smoke.mjs             # 应用冒烟（含样式表完整性守卫）
node nav-smoke.mjs         # 首页导航冒烟
node landing-smoke.mjs     # 落地页冒烟
node pf-ui-smoke.mjs       # PFLab 界面冒烟
node lab3d-smoke.mjs       # 3D 实验室冒烟（当前隐藏，代码保留）
```

改动引擎后，**全部测试必须通过**。新增引擎能力请同时补测试；
修 bug 请先加一条能复现它的测试。

## 引擎的两份副本

`js/engine/physics-engine.js` 还有一份独立打包副本（单独发布给其他项目用）。
本仓库内修改引擎时请保持 API 与文档一致；两份副本的测试用例相同，
行为不一致即视为 bug。

## 约定

- **引擎核心保持与宿主无关**：不引用 DOM、不引用 MotionLab 的文件格式；
  业务数据走描述符的 `userData`。
- 固定时间步进是契约：驱动引擎用 `advance(ms, speed)`，不要按帧传可变 dt。
- 角度单位是弧度（`setAngleDeg` 除外）；坐标单位是像素，y 轴向下。
- 代码风格：ES 模块、2 空格缩进、无分号以外的花哨语法；注释解释「为什么」，
  与既有代码保持一致。
- 版本号：应用版本在 `js/ui.js` 的 `APP_VERSION`，引擎版本在
  `physics-engine.js` 的 `VERSION`——改版本时一并同步 `version.json`、
  `index.html` 的 `?v=` 戳、README 徽章、`SECURITY.md` 的支持版本、
  `docs/DEVELOPER.md`（及英文版）与 `CHANGELOG.md`，并在
  `TEST-REPORT.md` 补当版测试记录。

## 提交流程

1. Fork 并新建分支（`feat/xxx`、`fix/xxx`）。
2. 改动 + 测试全过；涉及行为变化时更新 `docs/DEVELOPER.md` / 应用内文档。
3. 提交 PR，说明：改了什么、为什么、怎么验证的（测试输出或截图）。
4. 大功能（新物理系统、新模块）建议先开 Issue 讨论方案再动手。

## 许可证

MIT，见 `LICENSE`。提交代码即表示同意以 MIT 发布你的贡献。
第三方库（Matter.js、cannon-es）遵循其各自的许可证。
