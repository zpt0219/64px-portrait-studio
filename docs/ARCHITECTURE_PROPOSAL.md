# 架构重构提案：参照 tile_map_editor_imgui

> 日期：2026-09-29 · 基线：分支 `refactor/cleanup`（`36072e8`，尚未合并）
> 参照对象：`../tile_map_editor_imgui`（C++ / ImGui 桌面版 tilemap 编辑器）
> 目的：先把 imgui 版的架构讲清楚，再逐项对照本项目，看哪些能搬、哪些要改、哪些不搬。
> **状态：第 6 节全部按建议执行，并允许架构顺带修复；已于 2026-09-29 在分支 `refactor/architecture` 完成，执行记录见第 7 节。**

---

## 1. imgui 版架构速览

### 1.1 两层：UI 无关的 core + 桌面前端

```
desktop/src/                         src/ (静态库 adna，零 UI 依赖)
┌──────────────────────────┐         ┌──────────────────────────────────┐
│ main.cpp  GLFW/ImGui 主循环│         │ TileMapCommandHandler            │
│ App       布局/菜单/快捷键 │──调用──▶│   ├─ 命令队列 + undo/redo (上限 50)│
│ ViewModel 包装 handler     │         │   └─ TileMapHandler (会话上下文)   │
│ EditorContext 跨面板临时态 │◀─回调───│         └─ TileMap (文档)         │
│ panels/*  每个面板一个类   │         │ commands_*.cpp 按领域分组          │
└──────────────────────────┘         │ serialize/ render/ 算法模块         │
                                      └──────────────────────────────────┘
```

core 不知道 UI 存在，所以同一个二进制加 `--headless` 就能从 stdin 读 JSON 命令驱动（CI 和 AI 自动化都用它）。

### 1.2 数据分两层：文档 vs 会话上下文

`docs/STATE_PERSISTENCE_AND_UNDO.md` 的一句话准则：

> 只有 `TileMap` 树算「文档」，进存档，也进 undo。其余一切（笔刷、生成器参数、选中、编辑器开关）是「会话上下文」，住在 `TileMapHandler` 上，随 handler 一起存档，但默认不进 undo，直接改，不走命令栈。

| 层 | 持有 | 存档 | Undo |
|---|---|---|---|
| `TileMap` | 图层 / 对象 / 调色板 | ✅ | ✅ 走命令 |
| `TileMapHandler` | brush、settings、生成器参数、选中、各层参数 | ✅（handler 级根） | ❌ 直接改，然后 fan-out 回调 |
| `EditorContext`（desktop） | 跨面板的纯 UI 临时态，例如选中的 palette hash | ❌ | ❌ |
| 面板私有成员 | 拖拽状态机、hover、HUD pin | ❌ | ❌ |

### 1.3 命令模式（强制）

```cpp
class TileMapCommand {
  bool init();              // 捕获目标与旧值，返回 false 表示拒绝（不入栈）
  void execute();           // 改数据，然后 emit 回调
  bool undo();  void redo();
  bool mergeWith(cmd);      // 连续同类命令合并成一步（拖拽取色、打字、滑杆）
  void end();               // 下一条命令到来时，旧命令收尾
};
```

- `TileMapCommandHandler::addAndExecuteCommand(cmd)` 的流程：先尝试与栈顶合并，再调用 `init()`，然后截掉 redo 分支、入栈、`execute()`，最后按上限裁掉最旧的记录。
- 笔刷类手势用 phase 表示：0 = 开始，1 = 移动，2 = 结束。连续的移动靠 `mergeWith` 合成一条 undo。
- 规则：「选中耦合的命令，在 init 或构造时捕获目标，execute/undo 里不再读选中」。
- 快照式 undo 必须还原结果，不能用当前参数把算法重跑一遍（踩过的坑）。

### 1.4 回调扇出（Observer / Mediator）

```
Command.execute() ─emit─▶ TileMapCommandCallbacks (ViewModel 是唯一接收者)
                                   └─ fan_out ─▶ [各面板, TileRenderer, ...]
```

- 事件是有类型的：`onTileMapCreated`、`onTileMapRegionUpdated(rect)`、`onLayerTreeUpdated`、`onTiledObjectSelected`、`onPalettePropertyUpdated` 等等。
- 面板在构造时 `vm->register_panel(this)`，析构时注销，只 override 自己关心的事件。
- `fan_out` 先把面板列表复制一份再遍历，这样回调里注册或注销面板也安全。

### 1.5 ViewModel / App / Panel 分工

| 角色 | 职责 | 不做什么 |
|---|---|---|
| `ViewModel` | 每个用户意图对应一个方法（`update_layer_name`、`select_object` 等），内部构造命令并交给 handler；返回 `EditorResult{success, error_message}`；持有纯 UI 偏好（overlay、grid）和剪贴板 | 不画 UI |
| `App` | DockSpace 布局、菜单、全局快捷键、headless 命令分派；拥有 VM 和所有面板 | 不直接改数据 |
| `Panel` | 每帧 `draw()` 读取 live 状态画 UI；用户操作调用 VM 方法；交互状态机用私有 struct（`obj_drag_`、`marquee_`、`grp_` 等） | 不直接改 TileMap |
| `TileRenderer` | 画布的 CPU 像素缓冲加 GL 纹理；订阅回调累积脏矩形，`ensure_uploaded()` 时按需上传 | 不处理输入 |
| `ToolbarPanel` | 工具模式和缩放；一次性信号 `consume_reset_pan()`、`consume_fit_canvas()` 交给画布消费 | |

---

## 2. 本项目现状（refactor/cleanup 之后）

上一轮重构已经做到：状态修改全部收归 `main.ts`，纯编辑操作抽到 `core/editOps.ts`，`CanvasEditor` 拆出三个子模块。结构上还剩下面这些问题：

| # | 现状 | 对应 imgui 的哪一条 |
|---|---|---|
| A | `main.ts`（1826 行）一个类同时承担 App、ViewModel、CommandHandler 和 Handler：布局、分栏拖拽、快捷键、toast、全部编辑方法、undo 栈、自动保存、发色草稿 | 1.1、1.5 |
| B | `StudioState` 把文档（pixels / mask / palette / hairPreset）、会话上下文（工具、分区可见 / 锁定、缩放……）、撤销栈和 `isLoaded` 平铺在一个对象里 | 1.2 |
| C | Undo 是「整份快照 + 手动调用时机」：`takeSnapshot` / `recordUndo` / `strokeStartSnapshot` / `onBeforePaletteModify` 分散在各处，每条操作都要自己记得在正确时机拍快照 | 1.3 |
| D | 刷新靠 `syncAllViews()`（29 处）全量调 5 个面板的 `update(state)`；另有零散的 `maskPanel.update`、`canvasEditor.redraw()` 直调 | 1.4 |
| E | 选区住在 `CanvasEditor` 里，main 用 `getSelection()` / `setSelection()` 反向读写；它还进撤销快照 | 1.2、1.5 |
| F | 发色草稿（`hairRecolorBase` / `hairPresetDraft` / `recoloredPixels`）是 main 的私有字段，靠手动 `setPreviewPixels` 推给画布、`setHairDraft` 推给 MaskPanel。附录记录的「预览期间翻转整图，固化后翻转丢失」bug 就出在这里 | 1.2、1.4 |
| G | 编辑方法里夹着 `showToast`（78 处）和 `confirmModal`，业务逻辑和 UI 反馈混在一起 | 1.5 `EditorResult` |
| H | `CanvasEditor`（1393 行）仍然同时负责渲染、输入、选区状态机、工具栏按钮和空状态卡片 | 1.5 TileMapPanel + TileRenderer + Toolbar |

---

## 3. 目标架构（映射到 TS / Web）

### 3.1 目录

```
src/
  core/                    ← 纯算法，零 DOM（基本就是现有 core/，保持不动）
    segmentation.ts pixelGrid.ts colorUtils.ts editOps.ts recolorEngine.ts
    minimalPng.ts zipExporter.ts projectData.ts pixelRender.ts
  model/                   ← 对应 TileMap / TileMapHandler，零 DOM
    document.ts            PortraitDocument：palette, pixels, mask, hairPreset
    session.ts             EditorSession：工具 / 分区 / 笔刷 / 选区 / 发色草稿……
  command/                 ← 对应 src/command/，零 DOM
    command.ts             Command 基类 + DocumentMemento
    commandHandler.ts      队列、merge、undo/redo、上限 40
    events.ts              StudioEvents 回调接口
    pixelCommands.ts maskCommands.ts paletteCommands.ts
    transformCommands.ts hairCommands.ts documentCommands.ts
  app/                     ← 对应 desktop/src/
    main.ts                入口：new App()
    app.ts                 布局、分栏拖拽、快捷键表、toast、弹窗、存档触发
    viewModel.ts           用户意图 → 命令；事件 fan-out；剪贴板
    editorContext.ts       跨面板临时态：高亮色、hover 像素
    editorResult.ts        { ok, message, level }
  panels/
    Header.ts PalettePanel.ts MaskPanel.ts MaskToolsPanel.ts RealtimePreview.ts
    modals/ReplaceColorModal.ts modals/ConfirmModal.ts
    canvas/
      CanvasPanel.ts       输入、视口、交互状态机（选区 / 移动 / 框选）
      CanvasRenderer.ts    离屏像素缓冲 + 叠加层绘制
      CanvasToolbar.ts     缩放 / 网格 / 预览 / 变换按钮
      ContextBar.ts SelectionStatsPanel.ts overlays.ts
```

判断标准沿用 imgui：`core/`、`model/`、`command/` 三个目录里不允许出现 `document.*` 或 DOM 类型。

### 3.2 状态划分（对 `StudioState` 逐字段归类）

| 归属 | 字段 | 存档 | Undo |
|---|---|---|---|
| **Document** | `palette`、`pixelIndices`、`semanticMask`、`currentHairPreset` | ✅ ProjectData v1（不变） | ✅ |
| **Session** | `activeMode`、`activeTool`、`activePaletteIndex`、`bgPaletteIndex`、`bucketConnectivity`、`activeZone`、`visibleMaskZones`、`lockedMaskZones`、`activeMaskTool`、`maskBrushSize`、`maskMatchColors`、`maskMatchPresetKey`、`maskOpacity`、`showMaskOverlay`、`showGrid`、`zoomLevel`、`isLoaded` | ❌（现状就不存，见 Q4） | ❌ |
| **Session（特殊）** | `selection`（从 CanvasEditor 挪过来） | ❌ | ⚠️ 现在随快照一起恢复，见 Q3 |
| **Session（草稿）** | `hairDraft: { base, presetKey, preview } \| null` | ❌ | ❌，只有「固化」这一步是命令 |
| **CommandHandler** | `undoStack`、`redoStack` | ❌ | — |
| **EditorContext** | `highlightedPaletteIndex`、`hasStorageSnapshot` | ❌ | ❌ |
| **面板私有** | 画布拖拽 / 框选 / 移动状态机、空格平移、蚂蚁线计时器、分栏宽度 | ❌ | ❌ |

`lockedMaskZones` 虽然会影响编辑结果，但它属于「工具配置」（imgui 里的 brush 也是这样处理的）。命令在 `init()` 时把锁定集合捕获进来，这样 redo 不会因为用户后来改了锁定而结果不同。

### 3.3 命令与撤销

```ts
abstract class Command {
  abstract readonly name: string;            // 日志，以及 mergeWith 判断是否同类
  init(ctx: CommandContext): boolean { return true; }   // 捕获目标与参数；false = 拒绝
  abstract execute(ctx): void;
  abstract undo(ctx): void;
  redo(ctx) { this.execute(ctx); }
  mergeWith(next: Command): boolean { return false; }
}
```

**撤销粒度建议：沿用整份文档快照，把它封装进基类。** 64×64 的 pixels 加 mask 约 8 KB，加上色板，40 步总共也不到 400 KB；imgui 的对象级 memento 是为大地图省内存，本项目用不上。所以做一个 `DocumentMemento`：`init()` 拍 before，`execute()` 之后拍 after，`undo` / `redo` 直接 `set()`。大部分命令只需要写 `execute()`，需要记得拍快照的地方从 4 处以上收敛到零。

需要用上 imgui 机制的三个地方：

| 场景 | 现状 | 改成 |
|---|---|---|
| 画笔 / 遮罩笔划 | `onStrokeStart` 拍快照，`onStrokeEnd(didModify)` 决定是否入栈 | `StrokeCommand(phase)`：begin 入栈，move 用 `mergeWith` 并进栈顶，end 收尾；整笔没有改动就在 end 时丢弃 |
| 色板颜色拖拽 | `onBeforePaletteModify` 先压一条快照，拖动过程中直接改 | `SetPaletteColorCommand` 连续拖拽时 `mergeWith`，和 imgui 的 `UpdateLayerColor` 一样 |
| 导入新图 / 恢复存档 | 手动清空 `undoStack` / `redoStack` | `LoadDocumentCommand` 执行后调用 `handler.clearHistory()`（对应 imgui 的 `replacesTileMap`） |

命令清单（初稿）：`Stroke`（pixel / mask）、`Bucket`、`ReplaceColor`、`ClearRect`、`StampPatch`（粘贴）、`MovePatch`、`Flip`、`Rotate`、`RemoveOuterWhite`、`AssignColorToZone`、`MaskBoxSelect`、`RecomputeMask`、`SetPaletteColor`、`ResetPalette`、`CommitHairRecolor`、`LoadDocument`。

### 3.4 事件（对应 `TileMapCommandCallbacks`）

```ts
interface StudioEvents {
  onDocumentReplaced?(): void;               // 导入 / 恢复 / 重置 ≈ onTileMapCreated
  onPixelsChanged?(rect?: RectSelection): void;
  onMaskChanged?(rect?: RectSelection): void;
  onPaletteChanged?(): void;
  onSelectionChanged?(sel: RectSelection | null): void;
  onSessionChanged?(key: keyof EditorSession): void;   // 工具 / 分区 / 缩放……
  onHairDraftChanged?(): void;
  onHistoryChanged?(canUndo: boolean, canRedo: boolean): void;
}
```

- 命令的 `execute` / `undo` 负责 emit 文档类事件；VM 直接修改 session 后 emit `onSessionChanged`（对应 imgui 的 `update_brush`：直接改，然后 fan-out）。
- **发色预览变成派生状态**：`HairPreviewController` 订阅 `onMaskChanged`、`onPixelsChanged` 和 `onDocumentReplaced` 后自动重算。附录里那个 bug 会自然消失，但这算行为变化，见 Q7。
- 自动保存也作为订阅者：收到文档类事件就触发防抖保存（imgui 里 VM 的 `check_and_trigger_autosave` 也是挂在回调里的）。

### 3.5 面板刷新：DOM 不是立即模式（最大的差异）

ImGui 每帧重画，面板读 live 状态就完事。DOM 是保留模式，必须有人告诉面板该更新了。建议**用「脏标记 + rAF」模拟立即模式**：

```ts
abstract class Panel implements StudioEvents {
  constructor(protected vm: ViewModel) { vm.registerPanel(this); }
  protected markDirty() { this.vm.scheduleRender(this); }   // 同一帧内多次事件合并成一次
  abstract render(): void;                                   // ≈ draw()：从 vm 读取状态刷新 DOM
}
```

- 面板只 override 关心的事件，事件处理里只调 `markDirty()`；`render()` 在 `requestAnimationFrame` 里统一执行。这就是把 `TileRenderer` 的 `dirty_ + ensure_uploaded()` 推广到所有面板。
- 这样 `syncAllViews()` 的 29 处调用全部消失，也不会出现「忘记刷新某个面板」。
- 画布是 64×64，整张重绘很便宜，**不需要做 imgui 的脏矩形**；事件里带的 `rect` 先留着备用。

### 3.6 ViewModel 与 EditorResult

- 每个用户意图一个方法，例如 `selectPaletteIndex`、`bucketAt`、`flip`、`applyHairPreset`、`commitHairRecolor`。
- 返回 `EditorResult { ok, message?, level? }`。**toast 从业务逻辑里拿出去**：由 App 或调用方根据 result 决定是否提示。
- 需要确认的流程（例如「有未固化的发色，是否先固化」）：VM 提供查询方法 `hasHairDraft()`，App 负责弹窗，用户选完再调用 VM。弹窗属于 UI，VM 不碰。
- 剪贴板放在 VM 里（imgui 的 `clipboard_objects_` 也在 VM）。

### 3.7 画布拆分（对应 TileMapPanel / TileRenderer / Toolbar）

| 新模块 | 从 `CanvasEditor` 拿走的内容 |
|---|---|
| `CanvasRenderer` | 离屏 canvas、`redraw`、叠加层调用、给 RealtimePreview 的 hook；订阅文档 / 选区 / 草稿事件 |
| `CanvasToolbar` | `setupToolbarEvents`、`updateToolbar`、缩放档位；「适应窗口」之类用一次性 `consume*()` 信号 |
| `CanvasPanel` | 鼠标 / 键盘输入、坐标换算、工具分发；交互状态机收进私有 struct（`boxSelect`、`moveSelection`、`maskBox`），写法照搬 imgui 的 `marquee_` / `grp_` |

### 3.8 headless 钩子（可选，不属于测试框架）

imgui 用 `--headless` 加 JSON 命令做回归。对应到这里：在开发构建中暴露 `window.__studio = { vm }`，Playwright 冒烟脚本可以直接调用 VM 方法，不必模拟鼠标坐标。这不是测试框架，只是给已有的冒烟方式一个更稳定的入口。

---

## 4. 不搬的部分

| imgui 机制 | 不搬的原因 |
|---|---|
| hash 身份 / ADR-003 / `replacesTileMap` 防 UAF | JS 有 GC，也没有图层树；只保留「load 之后清空历史」的语义 |
| `Kind` 枚举（merge 热路径的性能优化） | 用字符串 `name` 就够了 |
| 脏矩形局部上传 | 64×64 整张重绘很便宜 |
| 宏系统，以及「Select 也是命令」的例外 | 本项目没有宏 |
| handler 级存档根（上下文也存档） | 现在只存文档；要不要存上下文见 Q4 |
| snake_case 方法名 | TS 用 camelCase，概念名保留（ViewModel / EditorContext / EditorResult / registerPanel / fanOut） |

---

## 5. 迁移步骤（草案，每步一个提交，每步都可运行）

验证方式沿用上一轮：`npm run build`，加上 Playwright 冒烟脚本，与基线逐项比对工程状态哈希、导出文件和截图。

1. **CommandHandler + DocumentMemento**：先用一个通用 `SnapshotCommand` 包住现有的 `applyEdit` / 笔划 / 色板拖拽，undo / redo 改走 handler。行为不变。
2. **拆 state**：`StudioState` 拆成 `PortraitDocument`、`EditorSession`、`EditorContext`；选区从 CanvasEditor 挪进 session。
3. **事件与 Panel 基类**：加 `StudioEvents` 和 VM fan-out、rAF 调度；各面板改为注册加 `render()`，删掉 `syncAllViews`。
4. **抽 ViewModel**：main.ts 里所有编辑方法搬进 `viewModel.ts`，返回 `EditorResult`；`app.ts` 只保留布局、快捷键、toast 和弹窗。
5. **按领域写具体命令**：把 1 里的通用快照命令逐个换成 3.3 的命令清单；笔划和色板拖拽改用 `mergeWith`。
6. **画布三拆**：`CanvasPanel` / `CanvasRenderer` / `CanvasToolbar`。
7. **发色草稿**：挪进 session，交给 `HairPreviewController` 订阅重算，固化做成命令（是否顺带修掉附录 bug，见 Q7）。
8. （可选）headless 钩子，冒烟脚本改为走 VM。

---

## 6. 讨论结果（均按建议执行）

| # | 问题 | 我的建议 |
|---|---|---|
| Q1 | 基于哪个分支？`refactor/cleanup` 还没合并，也没部署 | 先确认 cleanup 分支没问题并合并到 main，再从 main 开新分支 `refactor/architecture` |
| Q2 | 撤销粒度：整份文档快照，还是每条命令存差量？ | 整份快照（3.3），简单，64px 下内存可以忽略 |
| Q3 | 选区要不要继续进撤销？现在 undo 会连选区一起恢复 | 保持现状（DocumentMemento 附带选区），保证行为一致；以后想改再单独讨论 |
| Q4 | 会话上下文（工具、缩放、分区可见 / 锁定）要不要像 imgui 一样随存档保存？ | 这算新功能，本轮不做，先把结构分好 |
| Q5 | 面板刷新：rAF 脏标记，还是事件里直接更新 DOM？ | rAF 脏标记（3.5），最接近你熟悉的 `draw()` 心智模型 |
| Q6 | 要不要引入 UI 框架（React / Preact 等）？ | 不引入，vanilla TS 的 Panel 类和 imgui 面板一一对应 |
| Q7 | 范围：还是「纯重构、行为不变」？ | 是。附录里的 5 个行为 bug，新架构会让其中至少 1 个（发色预览 + 翻转）自然消失，要不要允许这类「架构顺带修复」请你定 |
| Q8 | headless 钩子要不要做？ | 建议做，成本低，冒烟脚本会更稳 |
| Q9 | `core/` 纯算法层要不要一起整理？ | 不动，上一轮已经整理过 |

---

## 7. 执行记录（2026-09-29，分支 `refactor/architecture`）

`refactor/cleanup` 已先快进合并到本地 `main`（未推送），再从 `main` 开出本分支。

| 提交 | 内容 |
|---|---|
| `17f9fed` | UI 无关的 `model/`（文档 / 会话）与 `command/`（命令、撤销栈、事件接口），此时还没接入 |
| `16dffd2` | `main.ts` 拆成 `app/`（App、ViewModel、EditorContext、Toaster、图片解码）与 `panels/`；画布拆成 CanvasPanel / CanvasRenderer / CanvasToolbar；`?debug` 钩子 |

第 5 节的 8 步没有逐步提交：中间形态（先用通用快照命令、再换成具体命令等）写完就要推倒，所以按层合成了两个提交，每个提交都能单独通过类型检查。

### 与方案不同的地方

| 方案 | 实际 | 原因 |
|---|---|---|
| ViewModel 方法返回 `EditorResult`，由调用方弹 toast | 提示消息走 `onNotify` 事件，`Toaster` 订阅后显示；需要结果的方法直接返回 `boolean` | 和 imgui 的 Logger → LogView 一样；原来 78 处 toast 夹在流程中间，改成事件后顺序和文案完全不变 |
| 需要确认的流程由 App 弹窗 | ViewModel 决定流程，通过注入的 `StudioPrompts.confirm()` 端口弹窗 | 发色草稿确认会从很多入口触发（切模式、选色、选工具、导出……），放在 App 会重复 |
| `LoadDocumentCommand` + `clearHistory` | `replaceDocument()` 直接替换并清空历史，不走命令栈 | 与 imgui 的 `new_map()` 一致；载入本来就不可撤销 |
| `hairCommands.ts` 单独一个文件 | 合进 `paletteCommands.ts` | 只有两条小命令 |
| `vm.scheduleRender(panel)` | rAF 调度器放在 `panels/Panel.ts` | ViewModel 不碰界面 |
| EditorContext 含 `hasStorageSnapshot` | 删掉，空状态直接读 `hasSavedProject()` | 两者在所有路径上等价 |
| 发色草稿 `{ base, presetKey, preview }` | 会话里只存 `hairDraftPreset`，预览由 ViewModel 从当前文档实时计算并缓存 | 不再需要 base 快照，这也是修复下面第 1 条 bug 的方式 |

### 行为变化（均为架构顺带修复）

1. **发色预览跟随文档**：预览期间做的整图翻转 / 旋转 / 扣白底 / 像素绘制，固化时不再被预览像素覆盖（原附录第 5 条）。
2. **确认弹窗打开时屏蔽全局快捷键**（原附录第 1 条）。
3. **清空画布、恢复默认色板改用站内确认弹窗**，不再用浏览器原生 `confirm()`（原附录第 3 条）。
4. **发色卡下拉框成为可撤销命令**：原来直接改 `currentHairPreset`，既不进撤销栈也不触发自动保存。
5. **遮罩油漆桶每笔只填一次**：原来拖动时是否在每个点重复填充，取决于像素模式下选的是不是油漆桶。
6. **面板随事件刷新**：原来遮罩笔划后遮罩工具箱的「颜色一键转遮罩」统计不刷新，要等下一次全量同步。
7. **没有产生变化的操作不再留下撤销记录**（例如没有命中像素的智能框选、对已是默认值的颜色点「还原色」）。
8. **重做恢复的是命令执行后的选区**：原来是按下撤销那一刻的选区。
9. **悬停线框不再被重绘擦掉**：原来走马灯或其它重绘会让画笔悬停线框消失，直到鼠标再次移动。

附录第 2 条（选区旋转不遵守分区锁）和第 4 条（工程校验不检查发色预设）与架构无关，保持原样。

### 上线试用后的调整（2026-09-30）

1. **空格键等同鼠标左键**，去掉「空格 + 左键拖动画布」。鼠标在画布（或选区工具下的视口空白处）上按下空格即在该处按下左键，按住空格移动即拖动，松开空格即松开左键；所有工具都适用。鼠标在其它面板、弹窗或画中画上时空格不起作用。中键拖动画布保留。
2. **悬停时按住 Shift 高亮同色像素**：在像素模式下，与指向像素同色的像素全部高亮，效果和悬停色板时的颜色探针相同，正好预览 Shift + 油漆桶会替换的范围。
3. **选区内悬停按 Ctrl 显示复制光标**：原来判断位置时用的是上一次按下鼠标时的坐标，悬停时一直是 -1，所以从来不会变成复制光标。
4. **按住 Alt 悬停时线框立即变为吸管蓝色**：原来要等下一次按下鼠标。

### 验证

- 每个提交都通过 `tsc`；最终 `npm run build` 通过。
- 冒烟脚本改了两处，让新旧版本走同一条路径：清空画布时若出现站内确认弹窗就点确认；遮罩油漆桶右键从拖动改为单击（对应上面第 3、5 条）。用改过的脚本重新录制基线（`36072e8`），与新版本比对：
  - 46 个操作步骤后的工程状态哈希：全部一致；
  - 导出 PNG、ZIP 内每个文件：全部一致；
  - 截图：唯一有内容差异的是遮罩工具箱的颜色统计（上面第 6 条，新版显示的是笔划后的正确百分比），其余只有个位数的抗锯齿像素差；
  - 面板点击路径的 DOM 状态（ui 脚本）：一致。
- 另写了一个通过 `?debug` 直接调用 ViewModel 的脚本，逐条验证上面的修复：预览期间翻转后固化、遮罩油漆桶拖动、弹窗屏蔽快捷键、下拉框撤销、站内确认、无变化不入栈、取色器拖动合并为一步撤销，全部通过。

### 未做

- `style.css` 仍未按组件拆分。
- 冒烟脚本仍在 scratchpad，没有放进仓库（沿用「不引入测试框架」的决定）。
