# 安全政策 Security Policy

## 项目性质（先说清楚）

MotionLab / PhysicsEngine 是一个**纯客户端、纯静态**的项目：

- 没有后端服务器、没有数据库、没有账号系统；
- 不收集、不上传任何用户数据；场景与设置只保存在使用者自己浏览器的
  localStorage 中；
- 不使用任何 API Key 或第三方跟踪脚本。

因此本项目的安全面主要在于**导入不可信的场景 JSON 文件**以及
**在第三方站点以非预期方式嵌入/加载引擎文件**这类场景。

## 支持的版本

| 版本 | 是否提供安全修复 |
| --- | --- |
| MotionLab 1.50.x（当前） | ✅ |
| MotionLab 1.49.x | ✅ |
| MotionLab 1.48.x | ✅ |
| PhysicsEngine 1.12.x（当前） | ✅ |
| 更早版本 | ❌（请升级到最新版） |

## 报告漏洞

如果你发现安全问题（例如：导入特制的场景 JSON 能让页面执行任意
脚本、造成浏览器卡死/崩溃，或引擎 API 的输入校验可被绕过）：

1. **请不要公开开 Issue 详细披露**可利用的细节；
2. 优先使用 GitHub 的私密漏洞报告：在本仓库页面点击
   **Security → Report a vulnerability**；
3. 如果该入口未开启，请开一个标题为 `[security]` 的 Issue，
   只写一句概述，维护者会通过 GitHub 与你私下联系细节；
4. 也可以直接发邮件到项目反馈邮箱 **motionlabphysics@agent.qq.com**
   （标题注明 `[security]`，由维护者的 AI 助手 Muse 收件并转交）；
5. 或通过 Reddit 私信维护者 [u/MotionLab-Physics](https://www.reddit.com/user/MotionLab-Physics)
   先取得联系，再另行约定私密渠道交换细节。

报告时请尽量附上：受影响的版本、复现步骤、一个最小化的恶意
场景 JSON（如适用）以及影响范围。

维护者会在确认后尽快修复，并在修复发布时致谢报告者（除非你
希望匿名）。

## 不属于漏洞的情况

- 物理模拟结果不精确、物体高速穿模等**模拟质量问题**——欢迎按普通
  Issue / PR 反馈；
- 使用者自己把场景保存在不安全的共享设备上造成的数据可见性问题
  （数据只存在本机浏览器中）。


---

# Security Policy (English)

## What this project is (read this first)

MotionLab / PhysicsEngine is a **purely client-side, purely static** project:

- No backend server, no database, no account system;
- It collects and uploads no user data; scenes and settings live only in
  the user's own browser localStorage;
- No API keys and no third-party tracking scripts.

Its security surface is therefore mainly about **importing untrusted
scene JSON files** and **engine files being embedded or loaded in
unexpected ways on third-party sites**.

## Supported versions

| Version | Security fixes |
| --- | --- |
| MotionLab 1.50.x (current) | ✅ |
| MotionLab 1.49.x | ✅ |
| MotionLab 1.48.x | ✅ |
| PhysicsEngine 1.12.x (current) | ✅ |
| Older versions | ❌ (please upgrade to the latest) |

## Reporting a vulnerability

If you find a security problem (for example: a crafted scene JSON that
makes the page execute arbitrary script or hang/crash the browser, or a
way to bypass the engine API's input validation):

1. **Please do not open a public Issue** with exploitable details;
2. Prefer GitHub's private vulnerability reporting: on this repository's
   page, click **Security → Report a vulnerability**;
3. If that entry is not enabled, open an Issue titled `[security]` with
   only a one-line summary; the maintainer will contact you privately
   through GitHub for details;
4. Or email the project inbox **motionlabphysics@agent.qq.com**
   (put `[security]` in the subject; the mail is received by Muse, the
   maintainer's AI assistant, and forwarded to the maintainer);
5. Or contact the maintainer by Reddit DM,
   [u/MotionLab-Physics](https://www.reddit.com/user/MotionLab-Physics),
   first, and agree on a private channel for the details.

When reporting, please include where possible: the affected version,
reproduction steps, a minimal malicious scene JSON (if applicable), and
the impact.

The maintainer will fix confirmed issues as soon as possible and will
credit the reporter in the fix release (unless you prefer to stay
anonymous).

## Not vulnerabilities

- **Simulation quality issues** such as imprecise physics results or
  fast objects tunnelling — please report those as regular
  Issues / PRs;
- Data visibility problems caused by users saving scenes on unsafe
  shared devices (the data only exists in the local browser).
