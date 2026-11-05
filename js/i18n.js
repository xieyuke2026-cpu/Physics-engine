/* i18n.js — MotionLab language support (中文 / English).
   - Language persists in localStorage 'motionlab.lang' ('zh' | 'en').
   - First visit (nothing stored): English is the primary language, and the
     landing page guides the visitor to pick a language (Ryan, 2026-11-03).
   - t(key, vars): dictionary lookup with {var} interpolation, zh fallback.
   - L(zh, en): pick a literal pair by current language (for code that builds
     bilingual-by-default labels; zh strings stay byte-identical to the
     pre-i18n UI so Chinese mode is unchanged).
   - applyI18n(root): rewrites [data-i18n] text, [data-i18n-title] titles,
     [data-i18n-tip] data-tip bubbles, [data-i18n-ph] placeholders and
     [data-lang] blocks (docs zh/en) in static markup.
   - setLang() persists, re-applies static markup and fires 'ml-lang' on
     window so dynamic surfaces (panel, hub, hints) can re-render. */

const KEY_LANG = 'motionlab.lang';

function readStored() {
  try {
    const v = localStorage.getItem(KEY_LANG);
    return v === 'zh' || v === 'en' ? v : null;
  } catch { return null; }
}

let current = readStored() || 'en'; // first run: English primary (see header)

export function getLang() { return current; }
export function hasStoredLang() { return readStored() !== null; }

/** Boot-time resolution: a stored choice wins; nothing stored means the
 *  first-run default (English). Called once by app.js boot(). */
export function syncLangFromStorage() {
  current = readStored() || 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = current === 'en' ? 'en' : 'zh-CN';
}

export function setLang(lang, { apply = true } = {}) {
  if (lang !== 'zh' && lang !== 'en') return;
  current = lang;
  try { localStorage.setItem(KEY_LANG, lang); } catch { /* private mode */ }
  if (typeof document !== 'undefined') document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  if (apply) {
    applyI18n();
    // Use the window's own CustomEvent constructor: a bare global CustomEvent
    // may belong to another realm (Node/jsdom), whose events dispatchEvent
    // on a DOM window rejects.
    if (typeof window !== 'undefined' && window.CustomEvent) window.dispatchEvent(new window.CustomEvent('ml-lang'));
  }
}

export function L(zh, en) { return current === 'en' ? en : zh; }

const DICT = {
  /* ---------- top bar / chrome ---------- */
  'tb.projects': ['我的项目', 'My Projects'],
  'tb.save': ['保存', 'Save'],
  'tb.settings': ['设置', 'Settings'],
  'tb.newScene': ['新建场景', 'New Scene'],
  'tb.dupScene': ['复制当前场景', 'Duplicate Scene'],
  'tb.enterLab': ['进入实验室', 'Enter Lab'],
  'tb.logoTitle': ['回到首页（我的项目）', 'Back to home (My Projects)'],
  'tb.title.scenes': ['我的项目：储存与打开场景', 'My Projects: store & open scenes'],
  'tb.title.undo': ['撤销 (Ctrl+Z)', 'Undo (Ctrl+Z)'],
  'tb.title.redo': ['重做 (Ctrl+Shift+Z)', 'Redo (Ctrl+Shift+Z)'],
  'tb.title.play': ['运行', 'Run'],
  'tb.title.pause': ['暂停', 'Pause'],
  'tb.title.step': ['单步运行一帧', 'Step one frame'],
  'tb.title.reset': ['重置场景', 'Reset scene'],
  'tb.title.record': ['录制 GIF：录下画布动画并导出', 'Record GIF: capture the canvas animation'],
  'tb.title.save': ['保存场景 (Ctrl+S)', 'Save scene (Ctrl+S)'],
  'tb.title.shot': ['导出画布截图 PNG', 'Export canvas screenshot (PNG)'],
  'tb.title.export': ['导出 JSON', 'Export JSON'],
  'tb.title.import': ['导入 JSON', 'Import JSON'],
  'tb.title.settings': ['设置', 'Settings'],
  'tb.title.panel': ['折叠 / 展开属性面板', 'Collapse / expand property panel'],
  'tb.title.zoomOut': ['缩小', 'Zoom out'],
  'tb.title.zoomIn': ['放大', 'Zoom in'],
  'tb.title.zoomFit': ['适应画布', 'Fit view'],
  'transport.run': ['运行', 'Run'],
  'transport.pause': ['暂停', 'Pause'],
  'st.running': ['运行中 Running', 'Running'],
  'st.paused': ['已暂停 Paused', 'Paused'],
  'st.objects': ['物体 {n}', 'Objects: {n}'],
  'st.gravitation': ['万有引力 G {g}', 'Gravitation G {g}'],
  'st.fluids': ['流体 {n}', 'Fluids: {n}'],
  'st.winds': ['风场 {n}', 'Winds: {n}'],
  'tb.title.share': ['分享场景（复制链接）', 'Share scene (copy link)'],

  'tb.mode2d': ['2D 实验室', '2D Lab'],
  'tb.mode3d': ['3D 实验室', '3D Lab'],

  /* ---------- tool rail: short titles + hover tips ---------- */
  'toolT.select': ['选择：点选物体查看参数，拖拽移动物体', 'Select: click a body for properties, drag to move'],
  'toolT.move': ['移动：拖拽物体或平移画布', 'Move: drag bodies or pan the canvas'],
  'toolT.circle': ['圆形：在画布上拖拽画出圆形', 'Circle: drag on the canvas to draw'],
  'toolT.rectangle': ['矩形：在画布上拖拽画出矩形', 'Rectangle: drag on the canvas to draw'],
  'toolT.polygon': ['多边形：拖拽确定半径，创建正六边形', 'Polygon: drag to set radius, creates a hexagon'],
  'toolT.triangle': ['三角形：拖拽确定大小，创建三角形', 'Triangle: drag to set size'],
  'toolT.line': ['静态线段：拖拽画出斜坡，始终为静态', 'Static line: drag to draw a ramp, always static'],
  'toolT.magnet': ['磁铁：在画布上点按或拖拽，放一个固定的 N 极磁铁', 'Magnet: tap or drag on the canvas to place a fixed N-pole magnet'],
  'toolT.spring': ['弹簧 / 连杆：依次点两个物体连接，点空白为固定锚点', 'Spring / rod: tap two bodies to connect; empty space = fixed anchor'],
  'toolT.hinge': ['铰链：依次点两个物体以同一点铰接，可加马达旋转', 'Hinge: tap two bodies to pin them at one point; add a motor to spin'],
  'toolT.blast': ['冲击波：在画布上点按，推开附近物体', 'Blast: tap the canvas to push nearby bodies'],
  'toolT.delete': ['删除：点按物体、弹簧、流体或风场区域将其删除', 'Delete: tap a body, spring, fluid or wind region to remove it'],
  /* ---------- tool rail tips ---------- */
  'tool.select': ['选择 — 点选物体看参数 · 拖拽移动物体 · 拖拽流体/风场区域移动位置', 'Select — click a body for its properties · drag to move it · drag a fluid or wind region to move it'],
  'tool.move': ['移动 — 拖拽物体移动 · 拖拽空白平移画布 · 滚轮 / 双指缩放', 'Move — drag bodies to move them · drag empty space to pan · wheel / pinch to zoom'],
  'tool.circle': ['圆形 — 在画布上拖拽画圆，松手创建（点按直接放一个）', 'Circle — drag on the canvas to size it, release to create (a tap drops a default one)'],
  'tool.rectangle': ['矩形 — 拖拽画出矩形，松手创建', 'Rectangle — drag to draw, release to create'],
  'tool.polygon': ['多边形 — 拖拽确定半径，创建正六边形', 'Polygon — drag to set the radius; creates a hexagon'],
  'tool.triangle': ['三角形 — 拖拽确定大小，创建三角形', 'Triangle — drag to set the size, release to create'],
  'tool.line': ['静态线段 — 拖拽画出斜坡（始终静态），松手创建', 'Static line — drag to draw a ramp (always static), release to create'],
  'tool.magnet': ['磁铁 — 点按放一个固定磁铁（N 极），拖拽定大小；在属性里可改极性', 'Magnet — tap to place a fixed magnet (N pole), drag to size it; flip the pole in its properties'],
  'tool.spring': ['弹簧 / 连杆 — 先点起点物体，再点第二个物体；点空白 = 固定锚点', 'Spring / rod — tap a start body, then a second body; empty space = fixed anchor'],
  'tool.hinge': ['铰链 — 先在第一个物体上点铰接点，再点第二个物体；点空白 = 固定铰座', 'Hinge — tap the pin point on a first body, then a second body; empty space = fixed mount'],
  'tool.blast': ['冲击波 — 在画布上点按，产生冲击波推开附近物体', 'Blast — tap the canvas to send a shockwave that pushes nearby bodies'],
  'tool.delete': ['删除 — 点按物体、弹簧线、流体或风场区域将其删除', 'Delete — tap a body, a spring line, a fluid or a wind region to remove it'],

  /* ---------- stage hints ---------- */
  'hint.select': ['点选物体查看参数 · 拖拽物体移动 · 拖拽流体/风场区域可移动位置', 'Click a body for its properties · drag to move · drag a fluid or wind region to move it'],
  'hint.move': ['拖拽物体移动 · 拖拽空白平移画布 · 滚轮 / 双指缩放', 'Drag bodies to move · drag empty space to pan · wheel / pinch to zoom'],
  'hint.circle': ['在画布上点按或拖拽画出圆形，松手创建', 'Tap or drag on the canvas to draw a circle, release to create'],
  'hint.rectangle': ['在画布上拖拽画出矩形，松手创建', 'Drag on the canvas to draw a rectangle, release to create'],
  'hint.polygon': ['点按或拖拽确定半径，创建正六边形', 'Tap or drag to set the radius; creates a hexagon'],
  'hint.triangle': ['点按或拖拽确定大小，创建三角形', 'Tap or drag to set the size; creates a triangle'],
  'hint.line': ['拖拽画出静态线段（斜坡），松手创建', 'Drag to draw a static line (ramp), release to create'],
  'hint.magnet': ['点按或拖拽放一个固定磁铁（N 极 +100）；选中后在「材质」里改数值可换 S 极', 'Tap or drag to place a fixed magnet (N pole, +100); select it and change the Material value to flip it to S'],
  'hint.springStart': ['先点一个物体作为弹簧起点（点空白 = 固定锚点）', 'Tap a body as the spring start (empty space = fixed anchor)'],
  'hint.springNext': ['再点第二个物体（或空白处作为固定锚点）完成弹簧', 'Tap a second body (or empty space as a fixed anchor) to finish the spring'],
  'hint.hinge': ['铰链 — 先点铰接点，再点第二个物体', 'Hinge — tap the pin point, then a second body'],
  'hint.hingeStart': ['在第一个物体上点一下铰接点（点空白 = 固定铰座）', 'Tap the pin point on a first body (empty space = fixed mount)'],
  'rail.select': ['选择', 'Select'],
  'rail.create': ['创建', 'Create'],
  'rail.connect': ['连接', 'Connect'],
  'rail.act': ['作用', 'Act'],
  'hint.hingeNext': ['再点第二个物体，铰链就建在这个点上', 'Tap a second body — the hinge is pinned at that point'],
  'hint.blast': ['在画布上点按，产生一圈冲击波，把附近的物体推开', 'Tap the canvas to blast nearby bodies away'],
  'hint.delete': ['点按物体删除 · 点按弹簧线可删除弹簧 · 点按流体/风场区域可删除区域', 'Tap a body to delete it · tap a spring line to delete the spring · tap a fluid/wind region to delete it'],

  /* ---------- landing ---------- */
  'land.pickLang': ['选择语言 / Choose your language', 'Choose your language / 选择语言'],
  'land.h1': ['在浏览器里，<br>做真实的物理实验', 'Real physics experiments,<br>right in your browser'],
  'land.sub': ['重力、碰撞、摩擦、弹性、弹簧——全部由真实刚体物理引擎实时计算。创建物体、调整参数、搭一个牛顿摆，再把实验场景保存下来。', 'Gravity, collisions, friction, elasticity and springs — all computed live by a real rigid-body physics engine. Create bodies, tune parameters, build a Newton\'s cradle, and save your experiments.'],
  'land.feat1t': ['真实物理', 'Real physics'],
  'land.feat1d': ['密度、摩擦、弹性实时生效，拖拽物体还能扔出去', 'Density, friction and elasticity take effect in real time — you can even throw bodies around'],
  'land.feat2t': ['弹簧与连杆', 'Springs & rods'],
  'land.feat2d': ['两点连线就能做单摆、吊桥和牛顿摆', 'Connect two points to build pendulums, suspension bridges and Newton\'s cradles'],
  'land.feat3t': ['场景存档', 'Scene library'],
  'land.feat3d': ['自动保存、场景库、JSON 导入导出，刷新不丢失', 'Autosave, a scene library and JSON import/export — a refresh loses nothing'],
  'land.try': ['直接试一个实验：', 'Try an experiment right away:'],
  'land.cta': ['开始使用', 'Get Started'],
  'land.note': ['这一页只在第一次打开时出现；之后会直接进入实验室。想再看时，在「设置」里点「显示欢迎页」。', 'This page appears only on your first visit; afterwards you land in the lab directly. To see it again, choose "Show welcome page" in Settings. Language can be changed anytime in Settings.'],
  'land.demoCap': ['实时演示 · 与实验室共用同一台物理引擎', 'Live demo · powered by the same physics engine as the lab'],

  /* ---------- home hub ---------- */
  'hub.brandSub': ['我的项目 · 首页', 'My Projects · Home'],
  'hub.nav.overview': ['概览', 'Overview'],
  'hub.nav.library': ['场景库', 'Scene Library'],
  'hub.nav.presets': ['实验预设', 'Presets'],
  'hub.nav.docs': ['开发者文档', 'Developer Docs'],
  'hub.title.overview': ['我的项目', 'My Projects'],
  'hub.title.library': ['场景库', 'Scene Library'],
  'hub.title.presets': ['实验预设', 'Presets'],
  'hub.title.docs': ['开发者文档', 'Developer Docs'],
  'hub.sub': ['场景都保存在这台设备的浏览器里。点开任意卡片即可继续实验，也可以导出 JSON 备份或分享。', 'Scenes live in this device\'s browser. Open any card to keep experimenting, or export JSON to back up and share.'],
  'hub.searchPh': ['搜索已保存场景…', 'Search saved scenes…'],
  'hub.sec.current': ['当前与恢复', 'Current & Resume'],
  'hub.sec.presets': ['2D 实验预设', '2D Presets'],
  'hub.sec.presets3d': ['3D 实验预设', '3D Presets'],
  'hub.sec.saved': ['已保存的 2D 场景', 'Saved 2D Scenes'],
  'hub.sec.saved3d': ['已保存的 3D 场景', 'Saved 3D Scenes'],
  'hub.sec.docs': ['开发者文档 · 通用物理引擎 PhysicsEngine', 'Developer Docs · PhysicsEngine Core'],
  'hub.pfLaunch': ['PFLab 平台格斗', 'PFLab Platform Fighter'],
  'hub.pfTitle': ['打开 PFLab 平台格斗实验室', 'Open the PFLab platform-fighter lab'],
  'hub.storage': ['保存在本机浏览器 · {scenes} 个场景 · {presets} 个预设', 'Stored in this browser · {scenes} scenes · {presets} presets'],
  'hub.storage3d': ['保存在本机浏览器 · 2D 场景 {s2} · 3D 场景 {s3} · 预设 {presets}', 'Stored in this browser · {s2} 2D scenes · {s3} 3D scenes · {presets} presets'],
  'card.sub': ['{n} 个物体{c} · {date}', '{n} objects{c} · {date}'],
  'card.subSprings': [' · {n} 个弹簧', ' · {n} springs'],
  'card.badgeCurrent': ['2D · 当前', '2D · Current'],
  'card.badgeEditing': ['2D · 正在编辑', '2D · Editing'],
  'card.badgeAuto': ['2D · 自动保存', '2D · Autosave'],
  'card.autosaveName': ['上次自动保存', 'Last autosave'],
  'card.open': ['打开', 'Open'],
  'card.rename': ['重命名', 'Rename'],
  'card.duplicate': ['复制', 'Duplicate'],
  'card.export': ['导出', 'Export'],
  'card.delete': ['删除', 'Delete'],
  'card.saveToLib': ['保存到场景库', 'Save to Library'],
  'card.keepEditing': ['继续编辑', 'Keep Editing'],
  'card.restore': ['恢复这个进度', 'Restore'],
  'card.loadRun': ['载入并运行', 'Load & Run'],
  'card.share': ['分享', 'Share'],
  'hub.import': ['导入场景', 'Import Scene'],
  'card.presetTitle': ['点击卡片也可直接载入并运行', 'Click the card to load and run it directly'],
  'hub.emptyNoMatch': ['没有匹配的场景。', 'No matching scenes.'],
  'hub.emptySaved': ['暂无已保存场景。在实验室里点顶部「保存」，或用上方「复制当前场景」，就会出现在这里。', 'No saved scenes yet. Use Save in the lab, or "Duplicate Scene" above, and they will appear here.'],

  /* ---------- settings / update bar ---------- */
  'set.title': ['设置', 'Settings'],
  'update.text': ['发现新版本', 'A new version is available'],
  'update.reload': ['立即刷新', 'Reload now'],
  'update.msg': ['发现新版本 MotionLab {v}（当前 {cur}）', 'MotionLab {v} is available (you are on {cur})'],

  /* ---------- toasts & dialogs (app.js) ---------- */
  'msg.bodyDeleted': ['物体已删除', 'Body deleted'],
  'msg.fluidDeleted': ['流体区域已删除', 'Fluid region deleted'],
  'msg.springDeleted': ['弹簧已删除', 'Spring deleted'],
  'msg.renamed': ['已重命名为「{name}」', 'Renamed to "{name}"'],
  'msg.nameCleared': ['已清除物体名称', 'Body name cleared'],
  'msg.fluidAdded': ['已添加流体区域：点选蓝色区域可调密度与范围，往里面丢不同密度的物体试试浮力', 'Fluid region added: click the blue region to tune density and size — drop bodies of different densities in and watch buoyancy'],
  'msg.windAdded': ['已添加风场区域：点选区域可调风向与风速，往里面放轻的物体试试被吹走的感觉', 'Wind region added: click the region to tune direction and speed — put light bodies inside and watch them blow away'],
  'msg.windDeleted': ['风场区域已删除', 'Wind region deleted'],
  'msg.magnetAdded': ['已添加磁铁（N 极 +100，固定不动）：选中它在「材质」里改磁性数值可换成 S 极', 'Magnet added (N pole, +100, fixed): select it and change the Magnetism value in Material to flip it to S'],
  'msg.materialSet': ['材质已设为「{name}」', 'Material set to "{name}"'],
  'msg.shareCopied': ['分享链接已复制：发给任何人，对方打开链接就直接进入这个场景', 'Share link copied: anyone opening it lands right in this scene'],
  'msg.sharePrompt': ['复制这条链接即可分享场景：', 'Copy this link to share the scene:'],
  'msg.shareOpened': ['已打开分享的场景「{name}」', 'Opened shared scene "{name}"'],
  'msg.shareInvalid': ['分享链接无效或已损坏', 'This share link is invalid or corrupted'],
  'msg.blast': ['冲击波推开了 {n} 个物体', 'Blast pushed {n} bodies'],
  'msg.springStartBody': ['已选起点，再点第二个物体或空白锚点', 'Start set — tap a second body or an empty-space anchor'],
  'msg.springStartAnchor': ['已放置固定锚点，再点一个物体', 'Fixed anchor placed — now tap a body'],
  'msg.springSameBody': ['弹簧两端不能是同一个物体', 'A spring cannot connect a body to itself'],
  'msg.springNeedBody': ['弹簧至少一端要连接物体', 'At least one end of a spring must attach to a body'],
  'msg.springCreated': ['弹簧已创建', 'Spring created'],
  'msg.springFailed': ['弹簧创建失败', 'Could not create the spring'],
  'msg.hingeStartBody': ['已选铰接点，再点第二个物体', 'Pin point set — tap a second body'],
  'msg.hingeStartAnchor': ['已放置固定铰座，再点一个物体', 'Fixed mount placed — now tap a body'],
  'msg.hingeSameBody': ['铰链两端不能是同一个物体', 'A hinge cannot pin a body to itself'],
  'msg.hingeNeedBody': ['铰链至少一端要连接物体', 'At least one side of a hinge must be a body'],
  'msg.hingeCreated': ['铰链已创建：点选铰链圆点可设马达转速', 'Hinge created: tap its pin marker to set a motor speed'],
  'msg.hingeFailed': ['铰链创建失败', 'Could not create the hinge'],
  'msg.hingeDeleted': ['铰链已删除', 'Hinge deleted'],
  'msg.recStart': ['开始录制 GIF（最长 20 秒，点「停止」结束）', 'Recording GIF (up to 20s — tap Stop to finish)'],
  'msg.recDone': ['GIF 已导出（{n} 帧）', 'GIF exported ({n} frames)'],
  'msg.recEmpty': ['没有录到画面，先让实验运行起来再录', 'Nothing captured — start the simulation first'],
  'msg.recBusy': ['正在生成 GIF…', 'Encoding GIF…'],
  'rec.label': ['录制', 'Record'],
  'rec.stop': ['停止', 'Stop'],
  'msg.saved': ['已保存场景「{name}」', 'Saved scene "{name}"'],
  'msg.saveFailed': ['保存失败：localStorage 不可用或已满', 'Save failed: localStorage unavailable or full'],
  'msg.newSceneConfirm': ['新建场景？当前未保存的修改将保留在自动保存中，但不会写入场景库。', 'Start a new scene? Unsaved changes stay in the autosave but are not written to the library.'],
  'msg.newScene': ['已新建场景', 'New scene created'],
  'msg.sceneReset': ['场景已重置', 'Scene reset'],
  'msg.opened': ['已打开场景「{name}」', 'Opened scene "{name}"'],
  'msg.renamePrompt': ['新的场景名称：', 'New scene name:'],
  'msg.renamedOk': ['已重命名', 'Renamed'],
  'msg.renameFailed': ['重命名失败：名称已存在或保存失败', 'Rename failed: the name exists or saving failed'],
  'msg.duplicated': ['已复制为「{name}」', 'Duplicated as "{name}"'],
  'msg.deleteSceneConfirm': ['删除场景「{name}」？此操作不可恢复。', 'Delete scene "{name}"? This cannot be undone.'],
  'msg.sceneDeleted': ['场景已删除', 'Scene deleted'],
  'msg.currentDuplicated': ['当前场景已复制为「{name}」', 'Current scene duplicated as "{name}"'],
  'msg.shotFailed': ['截图失败', 'Screenshot failed'],
  'msg.shotOk': ['画布截图 PNG 已导出', 'Canvas screenshot exported as PNG'],
  'msg.exportOk': ['场景 JSON 已导出', 'Scene JSON exported'],
  'msg.importFailed': ['导入失败：{err}', 'Import failed: {err}'],
  'msg.importNotJson': ['导入失败：文件不是有效的 JSON', 'Import failed: the file is not valid JSON'],
  'msg.imported': ['已导入场景「{name}」', 'Imported scene "{name}"'],
  'msg.resetConfirm': ['重置 MotionLab 的全部数据？\n将删除场景库（含 3D）、自动保存、设置与偏好，恢复到第一次打开的状态。此操作不可撤销。', 'Reset all MotionLab data?\nThis deletes the scene library (including 3D), autosaves, settings and preferences, returning to a first-run state. This cannot be undone.'],
  'msg.resetDone': ['已重置：全部数据恢复初始', 'Reset complete: all data restored to defaults'],
  'msg.autosaveRestored': ['已恢复上次自动保存的场景', 'Restored your last autosaved scene'],
  'msg.pfFailed': ['PFLab 打开失败：{err}', 'PFLab failed to open: {err}'],
  'msg.copySuffix': ['副本', 'copy'],
  'msg.presetLoaded': ['已载入预设「{name}」，模拟运行中', 'Loaded preset "{name}" — simulation running'],

  /* ---------- PFLab ---------- */
  'pf.sub': ['平台格斗实验室', 'Platform Fighter Lab'],
  'pf.pause': ['暂停', 'Pause'],
  'pf.resume': ['继续', 'Resume'],
  'pf.restart': ['重新开始', 'Restart'],
  'pf.back': ['返回 MotionLab', 'Back to MotionLab'],
  'pf.rematch': ['再来一局', 'Rematch'],
  'pf.fighting': ['对战中', 'Fighting'],
  'pf.paused': ['已暂停', 'Paused'],
  'pf.over': ['对局结束', 'Match over'],
  'pf.winPlayer': ['玩家获胜', 'Player wins'],
  'pf.winAI': ['AI 获胜', 'AI wins'],
  'pf.draw': ['同归于尽 · 平局', 'Double KO · Draw'],
  'pf.debug': ['调试面板', 'Debug Panel'],
  'pf.pState': ['玩家状态', 'Player state'],
  'pf.pDmg': ['玩家伤害', 'Player damage'],
  'pf.pVel': ['玩家速度', 'Player velocity'],
  'pf.aState': ['AI 状态', 'AI state'],
  'pf.aDecision': ['AI 决策', 'AI decision'],
  'pf.aDmg': ['AI 伤害', 'AI damage'],
  'pf.aVel': ['AI 速度', 'AI velocity'],
  'pf.fpsSteps': ['FPS / 步数', 'FPS / steps'],
  'pf.lastHit': ['最近命中', 'Last hit'],
  'pf.hitLine': ['step {step}：{who} 命中，伤害 {dmg}%，击退 {kb}', 'step {step}: {who} hit, damage {dmg}%, knockback {kb}'],
  'pf.whoPlayer': ['玩家', 'Player'],
  'pf.whoAI': ['AI', 'AI'],
  'pf.footer': ['键盘：A / D 移动 · W 跳跃（可二段跳）· J 攻击 · K 冲刺 ｜ 触屏：左侧方向，右侧跳 / 攻 / 闪 ｜ 将对手打出场地边缘即获胜，伤害越高被击飞越远', 'Keyboard: A / D move · W jump (double jump) · J attack · K dash | Touch: left side to move, right side jump / attack / dash | Knock your opponent out of the arena to win — the more damage, the farther they fly'],
  'pf.tJump': ['跳', 'Jump'],
  'pf.tAttack': ['攻', 'Atk'],
  'pf.tDash': ['闪', 'Dash'],
};

export function t(key, vars = {}) {
  const pair = DICT[key];
  let s = pair ? pair[current === 'en' ? 1 : 0] : key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/* Preset display names by key (scene data itself stays bilingual). */
const PRESET_EN = {
  cradle: "Newton's Cradle", domino: 'Dominoes', pyramid: 'Pyramid',
  ramps: 'Ramps & Ball', bounce: 'Bouncy Balls', doublependulum: 'Double Pendulum Chaos',
  bridge: 'Plank Bridge', galton: 'Galton Board', trampoline: 'Trampoline Net',
  funnel: 'Funnel Hourglass', coaster: 'Loop Coaster', bowling: 'Bowling',
  orbit: 'Orbital Gravitation', buoyancy: 'Buoyancy Pool',
  magnets: 'Magnet Array', windtunnel: 'Wind Tunnel',
  materials: 'Materials Lab', magnetswing: 'Magnet Swing',
};
export function presetDisplayName(p) {
  return current === 'en' && PRESET_EN[p.key] ? PRESET_EN[p.key] : p.name;
}

export function applyI18n(root) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope || !scope.querySelectorAll) return;
  scope.querySelectorAll('[data-i18n]').forEach((n) => { n.innerHTML = t(n.dataset.i18n); });
  scope.querySelectorAll('[data-i18n-text]').forEach((n) => { n.textContent = t(n.dataset.i18nText); });
  scope.querySelectorAll('[data-i18n-title]').forEach((n) => { n.title = t(n.dataset.i18nTitle); });
  scope.querySelectorAll('[data-i18n-tip]').forEach((n) => { n.dataset.tip = t(n.dataset.i18nTip); });
  scope.querySelectorAll('[data-i18n-ph]').forEach((n) => { n.placeholder = t(n.dataset.i18nPh); });
  scope.querySelectorAll('[data-lang]').forEach((n) => { n.hidden = n.dataset.lang !== current; });
}
