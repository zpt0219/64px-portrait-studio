# 64px Portrait Studio

面向 **64×64 像素头像** 的 36 色编辑工作台。纯前端（Vite + TypeScript，无框架），所有处理都在浏览器本地完成。

## 功能

- **导入**：任意尺寸图片（PNG / JPG / WebP / BMP / GIF），超过 64px 的等比缩放后居中置入 64×64 画布；工程 ZIP 可完整恢复。
- **36 色量化**：OKLab 感知色差最近邻映射，不使用抖动。
- **像素修图**：画笔、橡皮、油漆桶（4/8 邻接）、吸管、矩形选区（复制/剪切/粘贴/翻转/旋转）、全局换色、前景/背景色、撤销/重做（40 步）。
- **5 分区语义遮罩**：背景 / 头发 / 皮肤 / 眼睛 / 衣服，自动识别 + 手动涂抹（画笔、橡皮、油漆桶、按色组智能框选），支持分区锁定与可见性切换。
- **9 大发色一键置换**：黑、棕、金、粉、蓝、银白、绿、紫、红，按 5 阶色阶对称映射，仅作用于头发区域；非破坏式预览，确认后才固化。
- **持久化**：编辑状态自动暂存到 localStorage；可导出极简 8-bit 索引 PNG 与工程 ZIP（含遮罩、色板、GPL 调色板等）。

## 开发

```bash
npm install
npm run dev        # http://localhost:8089/64px-portrait-studio/
npm run build      # 类型检查 + 生产构建到 dist/
npm run preview
```

> `vite.config.ts` 中 `base` 为 `/64px-portrait-studio/`，与 GitHub Pages 仓库路径一致；仓库改名或部署到其它路径时需同步修改。

## 架构

参照 `tile_map_editor_imgui` 的分层 (详见 [docs/ARCHITECTURE_PROPOSAL.md](docs/ARCHITECTURE_PROPOSAL.md))：

```
面板 (panels/) ──调用──▶ ViewModel ──命令──▶ CommandHandler ──修改──▶ PortraitDocument
      ▲                     │                                        EditorSession
      └──── markDirty ◀─ fan-out ◀──────────── StudioEvents ◀────────────┘
```

- `core/`、`model/`、`command/` 不接触界面 DOM。
- 文档 (色板 / 像素 / 遮罩 / 发色预设) 只能通过命令修改，命令负责撤销 / 重做与事件；会话状态 (工具、分区、缩放、选区……) 由 ViewModel 直接修改后广播。
- 面板在事件回调里只 `markDirty()`，下一帧统一 `render()`，相当于 ImGui 的每帧 `draw()`。
- URL 带 `?debug` 时 `window.__studio` 暴露 App，自动化脚本可以直接调用 `window.__studio.vm`。

## 目录结构

```
src/
├── main.ts                  # 入口：创建 App (?debug 时挂到 window.__studio)
├── style.css
├── app/                     # 对应 imgui 的 desktop 层
│   ├── app.ts               # 布局、分栏拖拽、快捷键表、文件导入、弹窗
│   ├── viewModel.ts         # 用户意图 → 命令 / 会话修改；事件扇出；剪贴板
│   ├── editorContext.ts     # 跨面板的纯界面状态 (高亮色、画中画开关)
│   ├── imageDecode.ts       # 图片文件解码并缩放居中到 64×64
│   └── toaster.ts           # 提示消息 (订阅 onNotify)
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
│   ├── Panel.ts             # 面板基类 (脏标记 + requestAnimationFrame)
│   ├── Header.ts            # 顶栏：导入 / 导出 / 清空
│   ├── PalettePanel.ts      # 像素模式左栏：工具与 36 色色板
│   ├── MaskToolsPanel.ts    # 遮罩模式左栏：遮罩工具与匹配色组
│   ├── MaskPanel.ts         # 右栏：分区列表与发色预设
│   ├── RealtimePreview.ts   # 画中画实时预览
│   ├── canvas/
│   │   ├── CanvasPanel.ts         # 画布输入：工具分发、选区 / 框选交互、缩放平移、悬停信息
│   │   ├── CanvasRenderer.ts      # 画布绘制
│   │   ├── CanvasToolbar.ts       # 缩放 / 网格 / 预览 / 扣白底
│   │   ├── ContextBar.ts          # 画布上方的浮动上下文工具条
│   │   ├── SelectionStatsPanel.ts # 选区颜色统计面板
│   │   ├── overlays.ts            # 遮罩覆盖层、网格、高亮、走马灯等绘制函数
│   │   └── cursors.ts             # emoji 工具光标
│   └── modals/
│       ├── ReplaceColorModal.ts
│       └── ConfirmModal.ts
├── core/
│   ├── segmentation.ts      # 5 分区语义遮罩自动识别 (背景、轮廓、面部/眼睛/嘴、头发)
│   ├── editOps.ts           # 像素 + 遮罩的纯编辑操作 (泛洪、替换、选区块移动/翻转/旋转)
│   ├── recolorEngine.ts     # 发色识别与 5 阶色阶置换
│   ├── colorUtils.ts        # 颜色转换、OKLab 色差、色板量化
│   ├── pixelGrid.ts         # 64×64 网格常量、邻域、连通域、泛洪
│   ├── pixelRender.ts       # 色板索引像素的 Canvas 渲染
│   ├── projectData.ts       # 工程数据 Base64 编解码与校验
│   ├── storage.ts           # localStorage 自动暂存
│   ├── zipExporter.ts       # 工程 ZIP 导入导出
│   └── minimalPng.ts        # 8-bit 索引 PNG 编码
├── data/palette.ts          # 36 色色板、9 大发色色阶、色系分组（唯一事实数据源）
└── types/index.ts           # SemanticZone、ZONE_CONFIG、工具类型等
```

## 数据模型

- `pixelIndices: Uint8Array(4096)` — 每像素的色板索引，`0~35` 为颜色，`255` 为透明。
- `semanticMask: Uint8Array(4096)` — 每像素的分区，`0` 背景 / `1` 头发 / `2` 皮肤 / `3` 眼睛 / `4` 衣服。
- 色板变更记录见 [docs/PALETTE_CHANGELOG.md](docs/PALETTE_CHANGELOG.md)。

## 文档

- [docs/PALETTE_CHANGELOG.md](docs/PALETTE_CHANGELOG.md) — 36 色色板演进记录
- [docs/HAIR_COLOR_UNIFICATION_SOP.md](docs/HAIR_COLOR_UNIFICATION_SOP.md) — 发色统一化 SOP
- [docs/archive/IMAGEGEM_STUDIO_DESIGN_PLAN.md](docs/archive/IMAGEGEM_STUDIO_DESIGN_PLAN.md) — 早期设计方案（已归档，多处与现状不符，以代码为准）
- [docs/REFACTOR_FINDINGS.md](docs/REFACTOR_FINDINGS.md) — 2026-09 可读性重构的审查与执行记录
- [docs/ARCHITECTURE_PROPOSAL.md](docs/ARCHITECTURE_PROPOSAL.md) — 参照 tile_map_editor_imgui 的架构重构方案与执行记录

## License

[MIT](LICENSE)
