# 64px Portrait Studio

面向 **64×64 像素头像** 的 36 色编辑工作台。纯前端（Vite + TypeScript，无框架），所有处理都在浏览器本地完成。

## 功能

- **导入**：任意尺寸图片（PNG / JPG / WebP / BMP / GIF），超过 64px 的等比缩放后居中置入 64×64 画布；工程 ZIP 可完整恢复。
- **36 色量化**：OKLab 感知色差最近邻映射，不使用抖动。
- **像素修图**：画笔、橡皮、油漆桶（4/8 邻接）、吸管、矩形选区（复制/剪切/粘贴/翻转/旋转）、全局换色、前景/背景色、撤销/重做（40 步）。
- **5 分区语义遮罩**：背景 / 头发 / 皮肤 / 眼睛 / 衣服，自动识别 + 手动涂抹（画笔、橡皮、油漆桶、按色组智能框选），支持分区锁定与可见性切换。
- **9 大发色一键置换**：黑、棕、金、粉、蓝、银白、绿、紫、红，按 5 阶色阶对称映射，仅作用于头发区域；非破坏式预览，确认后才固化。
- **持久化**：编辑状态自动暂存到 localStorage；可导出极简 8-bit 索引 PNG 与工程 ZIP（含遮罩、色板、GPL 调色板等）。

## 开发与测试

```bash
npm install
npm run dev              # 启动开发服务器 (http://localhost:8089/64px-portrait-studio/)
npm test                 # 运行全部 Vitest 单元与集成测试套件
npm run typecheck        # 源码严格类型检查
npm run typecheck:tests  # 测试代码严格类型检查
npm run build            # 类型检查 + 生产构建到 dist/
npm run preview          # 预览生产构建包
```

> `vite.config.ts` 中 `base` 为 `/64px-portrait-studio/`，与 GitHub Pages 仓库路径一致；仓库改名或部署到其它路径时需同步修改。

## 核心业务与领域规则

- **透明与遮罩归一化**：
  - 透明像素（索引 `255`）在语义遮罩中始终严格归一化为 `SemanticZone.Background`（`0`）。
  - 画笔绘制透明色、右键透明背景色、橡皮擦除、选区清空与剪切时，无论该像素是否位于遮罩锁定分区，像素均清为空且对应遮罩重置为 `Background`。
  - 禁止将透明像素一键批量划入非背景遮罩。
- **遮罩图层锁定**：
  - 锁定分区（Locked Zones）保护该区域像素与遮罩不被非透明绘制覆盖；目标分区被锁定时禁止写入或划入其他颜色。
- **持久化与容错**：
  - 编辑操作经 300ms 防抖自动暂存到 localStorage。
  - 若遭遇无痕浏览限制或配额超限（QuotaExceededError），系统明确标记状态为 `'error'` 并触发 Toast 警告，不再静默成功。
- **发色草稿与模式切换**：
  - 发色置换预览采用独立会话草稿，试色期间绝不修改底层 `PortraitDocument`，确认固化时一次性提交命令入撤销栈。
  - 模式切换弹窗具有取消原子性保护，取消操作完整恢复原有显隐与草稿视图。
- **快照与导出隔离**：
  - PNG 与 ZIP 打包在异步开始前即深拷贝瞬态快照（`cloneDocument`），杜绝打包期间被后续编辑或并发导出污染；try...finally 安全回收 ObjectURL。
- **生命周期与性能**：
  - 面板与应用支持统一幂等 `dispose()`，清理全局事件、走马灯定时器与脏渲染队列。
  - 遮罩工具卡片、悬停信息栏、选区统计面板全面实施轻量级 DOM 缓存与增量 class/style 刷新，杜绝无效整树重排。

## 架构

参照 `tile_map_editor_imgui` 的分层 (详见 [docs/ARCHITECTURE_PROPOSAL.md](docs/ARCHITECTURE_PROPOSAL.md))：

```
面板 (panels/) ──调用──▶ ViewModel ──命令──▶ CommandHandler ──修改──▶ PortraitDocument
      ▲                     │                                        EditorSession
      └──── markDirty ◀─ fan-out ◀──────────── StudioEvents ◀────────────┘
```

- `core/`、`model/`、`command/` 不接触界面 DOM。
- 四个业务控制器 `ExportService`、`HairDraftController`、`ImportCoordinator`、`SelectionService` 仅依赖窄端口；图片量化与分区处理为 `core/imageImport.ts` 的纯函数。
- App 组装浏览器存储、Canvas、图片解码和下载实现。ViewModel 默认构造支持无浏览器运行；未注入持久化或导出能力时返回失败，不误报成功。
- 文档 (色板 / 像素 / 遮罩 / 发色预设) 只能通过命令修改，命令负责撤销 / 重做与事件；会话状态 (工具、分区、缩放、选区……) 由 ViewModel 直接修改后广播。
- 面板在事件回调里只 `markDirty()`，下一帧统一 `render()`，相当于 ImGui 的每帧 `draw()`。
- URL 带 `?debug` 时 `window.__studio` 暴露 App，自动化脚本可以直接调用 `window.__studio.vm`。

## 目录结构

```
src/
├── main.ts                  # 入口：创建 App (?debug 时挂到 window.__studio)
├── style.css
├── app/                     # 对应 imgui 的 desktop 层
│   ├── app.ts               # 布局、分栏拖拽、快捷键表、文件导入、弹窗、统一生命周期
│   ├── viewModel.ts         # 用户意图外观门面；事件扇出；持久化调度
│   ├── editorContext.ts     # 跨面板的纯界面状态 (高亮色、画中画开关)
│   ├── ports.ts             # 导出与确认端口契约
│   ├── adapters/BrowserStorage.ts # 安全接入浏览器 localStorage
│   ├── services/AutosaveService.ts # 注入存储的实例级自动保存
│   ├── browser/
│   │   ├── imageDecode.ts   # Image / Canvas 解码并缩放居中到 64×64
│   │   ├── pixelCanvas.ts   # 色板索引像素绘制与最近邻缩放
│   │   └── projectArchive.ts # Canvas 资源、ZIP 打包与浏览器导出
│   ├── toaster.ts           # 提示消息 (订阅 onNotify)
│   ├── controllers/         # 独立业务子领域控制器 (依赖窄端口)
│   │   ├── ExportService.ts       # ZIP 与 PNG 快照导出，无 UI 依赖
│   │   ├── HairDraftController.ts # 发色非破坏性草稿预览与固化
│   │   ├── ImportCoordinator.ts   # 异步导入序号隔离与防漂移
│   │   └── SelectionService.ts    # 选区剪贴板与几何变换
│   └── utils/
│       └── download.ts      # 浏览器下载与 ObjectURL 回收
├── model/
│   ├── document.ts          # PortraitDocument：进存档、进撤销的数据
│   └── session.ts           # EditorSession：工具、分区、缩放、选区、发色草稿
├── command/
│   ├── command.ts           # Command 基类、SnapshotCommand (快照式撤销)
│   ├── commandHandler.ts    # 撤销 / 重做栈 (上限 40)、合并
│   ├── events.ts            # StudioEvents 事件接口
│   ├── pixelCommands.ts     # 笔划、选区移动 / 粘贴 / 清空、替换色、扣白底
│   ├── transformCommands.ts # 翻转、旋转
│   ├── maskCommands.ts      # 智能框选、颜色转遮罩、重新识别
│   └── paletteCommands.ts   # 色板颜色、发色预设、固化发色
├── panels/
│   ├── Panel.ts             # 面板基类 (脏标记 + requestAnimationFrame 渲染调度 + dispose)
│   ├── Header.ts            # 顶栏：导入 / 导出 / 清空 / 暂存状态
│   ├── PalettePanel.ts      # 像素模式左栏：工具与 36 色色板
│   ├── MaskToolsPanel.ts    # 遮罩模式左栏：遮罩工具与匹配色组 (DOM 节点复用)
│   ├── MaskPanel.ts         # 右栏：分区列表与发色预设 (像素统计缓存)
│   ├── RealtimePreview.ts   # 画中画实时预览
│   ├── canvas/
│   │   ├── CanvasPanel.ts         # 画布输入：工具分发、选区 / 框选交互、缩放平移、悬停信息
│   │   ├── CanvasRenderer.ts      # 画布绘制
│   │   ├── CanvasToolbar.ts       # 缩放 / 网格 / 预览 / 扣白底
│   │   ├── ContextBar.ts          # 画布上方的浮动上下文工具条
│   │   ├── SelectionInteraction.ts# 选区拖动、框选、走马灯定时器交互
│   │   ├── SelectionStatsPanel.ts # 选区颜色统计面板 (增量 class 切换)
│   │   ├── HoverInfoBar.ts        # 悬停像素坐标与颜色固定 DOM 状态栏
│   │   ├── overlays.ts            # 遮罩覆盖层、网格、高亮、走马灯等绘制函数
│   │   └── cursors.ts             # Aseprite 风格 SVG 工具光标与矢量图标
│   └── modals/
│       ├── ReplaceColorModal.ts
│       └── ConfirmModal.ts
├── core/
│   ├── segmentation.ts      # 5 分区语义遮罩自动识别 (背景、轮廓、面部/眼睛/嘴、头发)
│   ├── editOps.ts           # 像素 + 遮罩的纯编辑操作 (泛洪、替换、选区块移动/翻转/旋转)
│   ├── recolorEngine.ts     # 发色识别与 5 阶色阶置换
│   ├── colorUtils.ts        # 颜色转换、OKLab 色差、色板量化
│   ├── pixelGrid.ts         # 64×64 网格常量、邻域、连通域、泛洪
│   ├── maskColors.ts        # 语义分区 RGB 查表
│   ├── imageImport.ts       # 纯像素量化、语义识别与导入结果
│   ├── projectData.ts       # 工程数据 Base64 编解码与校验、旧版工程迁移
│   ├── projectArchive.ts    # 无 DOM 的工程 ZIP 读取与校验
│   └── minimalPng.ts        # 8-bit 索引 PNG 编码与 CRC32
├── data/palette.ts          # 36 色色板、9 大发色色阶、色系分组（唯一事实数据源）
└── types/index.ts           # SemanticZone、ZONE_CONFIG、工具类型、端口契约等
```

## 数据模型

- `pixelIndices: Uint8Array(4096)` — 每像素的色板索引，`0~35` 为颜色，`255` 为透明。
- `semanticMask: Uint8Array(4096)` — 每像素的分区，`0` 背景 / `1` 头发 / `2` 皮肤 / `3` 眼睛 / `4` 衣服。
- 色板变更记录见 [docs/PALETTE_CHANGELOG.md](docs/PALETTE_CHANGELOG.md)。

## 文档

- [docs/GEMINI_FLASH_IMPLEMENTATION_GUIDE.md](docs/GEMINI_FLASH_IMPLEMENTATION_GUIDE.md) — 重构与修复路线图实施指南 (T00–T11)
- [docs/T07_BROWSER_ADAPTER_MIGRATION.md](docs/T07_BROWSER_ADAPTER_MIGRATION.md) — 浏览器适配器迁移与新旧输出对照验收
- [docs/IMPLEMENTATION_PROGRESS.md](docs/IMPLEMENTATION_PROGRESS.md) — 任务实施跟踪与验收记录
- [docs/PALETTE_CHANGELOG.md](docs/PALETTE_CHANGELOG.md) — 36 色色板演进记录
- [docs/HAIR_COLOR_UNIFICATION_SOP.md](docs/HAIR_COLOR_UNIFICATION_SOP.md) — 发色统一化 SOP
- [docs/ARCHITECTURE_PROPOSAL.md](docs/ARCHITECTURE_PROPOSAL.md) — 参照 tile_map_editor_imgui 的架构重构方案

## License

[MIT](LICENSE)
