# 64px Portrait Studio 代码审查：可读性与重构 Findings

> 审查日期：2026-09-29 · 基线提交 `bf39b1b` · 范围：`src/` 全部 TS（约 1.1 万行）与 `style.css`（3376 行）
> 目标：清晰可读、删除死代码；**不加新功能、不改行为**。

## 0. 总览

| 文件 | 行数 | 主要问题 |
|---|---:|---|
| `core/remapCore.ts` | 2567 | 从 Python 移植而来；约 1/5 是只算不用的诊断/评分代码 |
| `components/CanvasEditor.ts` | 2455 | 身兼渲染、输入、选区状态机、剪贴板和两个浮动面板；直接改写 main 持有的 state |
| `main.ts` | 2231 | 快照/确认弹窗/模式切换样板重复多次；快捷键是约 250 行的 if 链 |
| `core/pngMetadata.ts` | 351 | 约 70% 是已废弃的「PNG 内嵌工程数据」代码 |
| `core/recolorEngine.ts` | 91 | 约 75% 是旧版 issueDetector 遗留 |

当前状态：`tsc --noEmit` 通过；**项目没有任何测试**。

---

## 1. 验证方式（已定）

**不引入测试框架，不做遮罩快照。** 原因：自动遮罩的结果本来就不准，逐像素保持不变没有意义；用户会在遮罩模式里手动修正。

每步重构后的验证：
- `npm run build`：类型检查加构建。
- 手动冒烟：导入一张图、画笔/油漆桶/选区移动、遮罩涂抹、发色预览与固化、撤销/重做、导出 PNG/ZIP、重新导入 ZIP。

原则仍然是「不刻意改变行为」。但裁剪 `remapCore` 时，如果自动遮罩出现细微差异，可以接受。

---

## 2. P0：死代码（可直接删除，零行为影响）

### 2.1 废弃的 PNG 内嵌工程数据功能：`core/pngMetadata.ts`

`main.ts:315` 注释已写明「不再读取 PNG 附加元数据」，导出 PNG 走的是 `minimalPng.ts`。

- **完全无调用**：`decodeProjectFromPng`、`encodeProjectToPng`、`isValidPng`、`PROJECT_CHUNK_KEYWORD`、`toLatin1SafeJson`、`PNG_SIGNATURE`。
- `calculateCrc32` 只被上面的 `encodeProjectToPng` 使用，而且和 `minimalPng.ts` 里有一份重复的 CRC 实现。
- **仍在用的部分**：`uint8ArrayToBase64`、`base64ToUint8Array`、`validateProjectData`，属于「工程数据序列化与校验」。
- **建议**：删掉废弃部分（约 250 行），剩余部分改名，比如 `projectData.ts`，或者并入 `storage.ts`。

### 2.2 旧版发色引擎遗留：`core/recolorEngine.ts`

- 无调用：`mappedTierForIndex`、`mappedColorForIndex`、`applyConnected`（约 70 行）。
- 唯一在用的是 `nearestTierForColor`。建议挪到发色相关模块，然后删除本文件。

### 2.3 类型遗留：`types/index.ts`

- 无引用：`IssueDetectorState`（注释写着「旧版 issueDetector 兼容接口」）、`RepairMode`、`OutlineStrategy`。
- `ToneStrategy` 只被 2.2 的死代码使用。
- `ZoneMeta.displayRgba` 字段从未被读取。
- 文件头仍写「ImageGem Studio v2.0」。

### 2.4 `remapCore.ts`：只算不用的诊断与评分（最大的一块，约 400–500 行）

`main.ts:459 generateSemanticMaskFromPixels` 只消费以下内容：
- `geom.outer.foregroundMask`、`geom.outer.outline`
- `geom.face.faceMask`、`faceModelMask`、`hairMask`
- 少数 `face.features` 字段：眼睛 offsets、`face_bbox`、`visible_skin_bbox`、`eye_line_y`、`chin_y`、双眼中心
- `mouth.candidateOffsets`、`mouth.features.mouth_roi`

**从来没有人读** `decision`、`score`、`reasons`、`checks`。因此下面这些代码的结果被整体丢弃：

| 死代码 | 位置 |
|---|---|
| `StrictGeometryGate` 的全部评分：`GATE_WEIGHTS`、`clampSeverity`、`severityBelow`/`severityAbove`、`bodyTooShortSeverity`、score、checks | `remapCore.ts:1959-2093` |
| `GeometryPreJudge` 约 30 个 `features` 字段、`backgroundData`、reject/uncertain 判定（只需要前景掩码和 outline） | `remapCore.ts:1304-1477` |
| `FaceGeometryJudge` 的 decision/reasons、`nearBoundary`、ambiguity 判定、约 60 个诊断 features | `remapCore.ts:1794-1933` |
| `bottomExposedOffsets` 函数本身（只服务于评分） | `remapCore.ts:1247-1275` |
| `MouthDetector` 的 decision/reasons/confidence | `remapCore.ts:2176-2197` |
| `estimateBackground` 的平均色 rgb、threshold/spread 输出 | `remapCore.ts:260-284` |
| `analyzeHairPalette` 的 `role`、`confidence`、`seedBbox` 输出 | `remapCore.ts:1201-1244` |
| `mapImageToPalette` 的 `hue_priority` 策略分支、`measurementMask`/`unmeasuredColor` 选项、6 个统计字段（调用方只传 `oklab_nearest`，只读 `outputPixels`） | `remapCore.ts:2449-2567` |
| `assignResidualRegions` 区分 clothing 与 other，但 main 把两者都归为 Clothes | `remapCore.ts:2373` / `main.ts:489` |

**建议**：
- 直接裁掉上面这些代码。旧 Python 原版已删除，不需要保持同步。
- 把 `features: Record<string, any>` 改成显式类型，只保留下游真正用到的字段。
- 这一步是整个重构收益最大的地方，`any` 也会随之消失。
- 文件头和注释里「replacing Pillow ImageDraw」这类移植痕迹一并清理。

### 2.5 零散的无调用代码

| 项 | 位置 |
|---|---|
| `discardStorageSnapshot()` | `main.ts:247` |
| `setMaskVisibility()` 与 `MaskPanel` 的 `onToggleMaskVisibility` 回调（面板从不触发） | `main.ts:1130`、`MaskPanel.ts:15` |
| `CanvasEditor.destroy` / `getHighlightedColor` / `getOffscreenCanvas` | `CanvasEditor.ts` |
| `RealtimePreview.getBgMode` / `getScale`；`setBgMode` 里移除 `pip-bg-dark`/`pip-bg-light` 两个不存在的类 | `RealtimePreview.ts` |
| `ConfirmModalOptions.onClose`（从未传入），以及相关的 `activeOnClose` 逻辑 | `ConfirmModal.ts` |
| `ReplaceColorModal` 的 `onClose` 回调（main 传的是空函数） | `ReplaceColorModal.ts:12`、`main.ts:232` |
| `exportProjectZip` 的 `onProgress` 参数（从未传入） | `zipExporter.ts:327` |
| `importProjectZip` 的 `ArrayBuffer` 分支（只传 File） | `zipExporter.ts:417` |
| `colorUtils.rgbToHex` | `colorUtils.ts:13` |
| `vite.config.ts` 与 `tsconfig.json` 的 `@/` 路径别名（全项目 0 处使用） | 配置文件 |
| CSS 无引用类：`active-color-hex`、`active-color-info`、`btn-danger-outline`、`btn-link`、`control-sidebar`、`mask-tool-btn-group`、`mask-tools-row` | `style.css` |
| `pctFormatted` 三元表达式的前两个分支完全相同 | `CanvasEditor.ts:2196` |
| `createInitialState` 里的 `maskMatchColors: [14..18]` 在首次进入遮罩模式时必定被覆盖 | `main.ts:88` |

另有大量「只在本文件用却 export」的符号（例如 `remapCore` 的各种 helper、`zipExporter` 的 canvas 工厂函数），可以顺手去掉 `export`，让模块边界更清晰。

---

## 3. P1：重复代码（合并后更易读）

### 3.1 两套 OKLab 实现
`colorUtils.ts` 的 `rgbToOklab`/`oklabDistance`（入参 hex）与 `remapCore.ts:131-161` 的同名函数（入参 Rgb）系数相同。

**建议**：`remapCore` 版保留为唯一实现，`colorUtils` 在它之上包一层 hex 版本。

### 3.2 hex 转 RGB 的内联副本
`CanvasEditor.ts:1436` 手写了一遍 `hexToRgb`。

### 3.3 5 分区颜色写了 5 遍
- 权威来源：`ZONE_CONFIG`（hex）。
- 再在别处写死 RGB 数组：`CanvasEditor.ts:1475`、`CanvasEditor.ts:1557`（同一函数内两次）、`zipExporter.ts:105`。
- `MaskPanel` 靠 `zone === Clothes || Hair` 判断是否浅色。

**建议**：`ZONE_CONFIG` 增加 `rgb` 字段，其余地方全部引用它。

### 3.4 泛洪填充 5 份
- `CanvasEditor.floodFillPixel` / `floodFillMask`：两份几乎逐行相同。
- `main.removeOuterWhite`：手写 BFS 加四条边入队。
- `remapCore.floodMask` / `connectedComponents`。
- 已死的 `recolorEngine.applyConnected`。

**建议**：抽出一个通用 `floodFill(start | seeds, predicate, connectivity)`。

### 3.5 撤销快照构造 4 遍
`main.ts` 的 `onStrokeStart`、`pushUndoSnapshot`、`undo`、`redo` 各写了一遍相同的对象字面量；undo 与 redo 的恢复逻辑也镜像重复。

**建议**：抽成 `takeSnapshot()` + `restoreSnapshot()`。

### 3.6 「未固化发色」确认弹窗 4 遍
`setMode`、`exportProjectPng`、`exportProjectZip`、`openHairRecolorModal` 都是同一个三按钮结构（应用 / 放弃 / 取消）。

**建议**：抽成 `confirmHairDraft({ title, onApply, onDiscard })`。

### 3.7 「遮罩模式先切回像素模式再执行」样板 4 遍
`selectPaletteIndex`、`pickColorFromCanvas`、`selectBgPaletteIndex`、`setActiveTool` 各自配一个 `*Direct` 孪生方法。

**建议**：用一个 `inPixelMode(fn)` 包装，删掉 4 个 `*Direct` 方法。另外 `PalettePanel` 在每次点击前还会先调一次 `onActivate()`（即 `setMode('pixel')`），和前面的逻辑重复。

### 3.8 选区像素块读写 5 遍
在 `CanvasEditor` 里：
- 「按矩形抽取 pixels+mask 块，越界填透明」出现 3 次：拖动选区、`copySelection`、`rotateSelectionContentCW`。
- 「把块写回画布并跳过透明像素」出现 2 次：拖动放下、`pasteClipboard`。

**建议**：抽成 `extractPatch(rect)` / `stampPatch(patch, x, y)`。

### 3.9 整图与选区的翻转/旋转
`main.flipCanvas` / `rotateCanvasCW` 与 `CanvasEditor.flipSelectionContent` / `rotateSelectionContentCW` 是同一算法，只是作用矩形不同。

**建议**：整图视为 `{0,0,64,64}` 的选区，统一成一套实现。

### 3.10 其它
- **pixels 转 RGB 数组**：`main.ts:371` 导入流程和 `main.ts:1343` 重识别流程各构造一遍，而且都要做「透明像素当白色喂给分析器，结果再强制设为 Background」。
- **8-bit 像素渲染**：`CanvasEditor.redraw` 与 `zipExporter.createPixelCanvas` 各写一遍；另外 `zipExporter` 的 3 个 canvas 工厂函数共享同样的「64 转 scale 倍放大」尾巴。
- **CRC32 表**：`pngMetadata.ts` 与 `minimalPng.ts` 各一份。删掉 2.1 的死代码后自然消失。
- **量化结果绕了一圈**：导入时 `mapImageToPalette` 返回 RGB，`main.ts:396-411` 再用 L1 距离把 RGB 反查回索引。**建议**：让量化函数直接返回色板索引。
- **分区显示名**：`zoneMeta.name.split(' ')[0]` 出现 6 次。**建议**：`ZONE_CONFIG` 加一个 `shortName` 字段。
- **「全部 5 个分区」数组**：写了 3 遍（`main.ts:840`、`main.ts:1378`、`MaskPanel.ts:193`）。
- **魔法数**：`64`、`4096`、`63`、`4032`、`255`（透明）、`36` 在各文件中硬编码，但 `remapCore` 已经导出了 `IMAGE_WIDTH`/`PIXEL_COUNT`，`palette.ts` 也有 `TRANSPARENT_INDEX`。

---

## 4. P2：结构问题（收益大，但改动面也大）

### 4.1 `CanvasEditor` 职责过多（2455 行）
**建议**按职责拆分：
- 纯渲染（`redraw` 与各层叠加）
- 输入与工具分发（`applyToolAt`、鼠标事件）
- 选区状态机与剪贴板
- 两个浮动 UI：上下文工具条、选区颜色统计面板

外部接口保持不变。

### 4.2 状态所有权不清
`StudioState` 由 `main` 持有，但 `CanvasEditor` 会直接改写它的 `pixelIndices`/`semanticMask`，涉及泛洪、替换色、选区移动、粘贴、删除、翻转、旋转；同时它又通过 `onPixelDraw`/`onMaskDraw` 回调让 main 改。两种路径并存。

**已定：由 main 修改。** `CanvasEditor` 只负责把用户输入翻译成意图并回调，不再写 `StudioState`。
- 需要搬到 main 的修改：泛洪（像素/遮罩）、替换色、选区移动放下、粘贴、删除、选区翻转与旋转。
- 画布仍保留只属于交互的临时状态：当前选区矩形、拖动中的浮动块、剪贴板、高亮色。
- 回调改成语义化的意图，例如 `onFloodFill(x, y, target)`、`onCommitPatch(patch, x, y, cut)`、`onDeleteSelection(rect)`。锁定分区检查、撤销快照、`strokeModified` 判定统一由 main 负责。
- 顺带收益：3.8/3.9 的 patch 读写和翻转/旋转能合并成 main 里的一套实现；`onStrokeStart`/`onStrokeEnd` 只剩画笔连续笔划还需要。
- 本次不引入新的状态库。

### 4.3 `main.ts` 快捷键 if 链（`main.ts:1830-2073`，约 250 行）
**建议**改成声明式表：`{ key, mods, mode, action }[]`。可读性会大幅提升，也方便核对快捷键冲突，比如 `S` 在像素模式是选区、在遮罩模式是框选。

### 4.4 可选字段制造的防御性噪音
`StudioState` 的这些字段标了 `?`，但初始化时一定赋值，导致代码里散布大量 `|| []`、`?? 8`、`|| 'pen'`：
- `lockedMaskZones?`、`activeMaskTool?`、`maskMatchColors?`、`maskMatchPresetKey?`
- 以及 `bgPaletteIndex ?? TRANSPARENT_INDEX`、`bucketConnectivity ?? 8`、`showMaskOverlay ?? true` 等回退写法

**建议**：去掉 `?`，让这些回退代码随之删除。

### 4.5 面板每次 `update` 全量重建 DOM 并逐个绑监听
每次 `syncAllViews` 都会重建：
- `PalettePanel`：36 个色块，每块 2 个监听器
- `MaskPanel`：5 张分区卡、9 张发色卡
- `MaskToolsPanel`：匹配色块

**建议**：改为容器级事件委托（`MaskToolsPanel` 的颜色列表已经这样做了，可以作为统一范式）。`PalettePanel` 的 5 个工具按钮也可以改成 `data-tool` 属性配一个监听器，和 `MaskToolsPanel` 保持一致。

### 4.6 键盘监听分散在 5 处
- `main`（全局快捷键）
- `CanvasEditor` × 2（空格平移；Alt/Ctrl/Shift 修饰键）
- `ReplaceColorModal`（capture 阶段拦截）
- `ConfirmModal`

`main.ts:1848` 检查 `replaceColorModal.getIsOpen()` 是多余的，因为那个弹窗已经在 capture 阶段 `stopPropagation`。**建议**：两个弹窗采用同一种拦截方式。

### 4.7 `style.css` 单文件 3376 行
已经按组件分段，结构尚可。可选：按组件拆成多个 CSS 文件，由 Vite 直接 import。TS 模板里有约 30 处内联 `style="..."`，其中固定样式可以移进 CSS。优先级低。

---

## 5. P3：命名与注释

- **旧名 `ImageGem`**：残留约 49 处（类名 `ImageGemApp`、`ImageGemProjectData`、各文件头注释、`console.warn` 前缀）。**建议**统一为 Portrait Studio。
  - ⚠️ localStorage key `imagegem_*` 和 ZIP 内的文件名 `imagegem_project.json` 属于持久化格式，**不改**。ZIP 导入虽然有 `*.json` 兜底，但改名会影响旧版本读新包。
- **注释营销化、与代码不符**：
  - 例如「视网膜级」「绝对零延迟」「100% 原样复原」。
  - `zipExporter.ts` 文件头仍说 PNG「内嵌 tEXt 状态元数据」。
  - `main.ts:769` 的 toast 与 `PalettePanel` 的 confirm 文案里写着「GBA 36 色」。
  - 快捷键 toast 用的 emoji 颜色（🔴头发 / 🔵眼睛）与实际分区配色（青 / 紫）不一致。
  - **建议**：注释只描述「为什么」，删掉形容词。
- **`BUG-04`/`BUG-05`/`BUG-08`/`BUG-09` 引用**：指向一份仓库里不存在的清单，要么补上背景说明，要么删掉编号。
- **`remapCore` 的 snake_case**：字段名如 `face_bbox`、`eye_line_y` 来自 Python 移植，与 TS 其余部分的 camelCase 不一致。可以随 2.4 的类型化一并改。
- **过时文档**：`docs/IMAGEGEM_STUDIO_DESIGN_PLAN.md`，README 自己已标注部分过时。**建议**：删掉，或移到 `docs/archive/`。

---

## 6. 决策记录

| 问题 | 结论 |
|---|---|
| 是否引入测试框架、做遮罩快照 | **不做**。自动遮罩本来就不准，靠构建 + 手动冒烟验证（第 1 节） |
| `remapCore` 是否需要和 Python 原版同步 | **不需要**。Python 原版已删除，可以直接裁剪（2.4） |
| 状态由谁修改 | **main 修改**。画布只报告意图（4.2） |
| 做到哪一步 | 待定。按第 7 节分批提交，可在任意一步叫停 |

## 7. 执行顺序（每步一个提交，每步都 `npm run build` + 手动冒烟）

1. **P0 死代码删除**：2.1、2.2、2.3、2.5，以及多余的 export。风险极低。
2. **`remapCore` 裁剪与类型化**（2.4）。
3. **P1 纯函数级去重**：3.1–3.4、3.10 的常量与分区元数据。
4. **`main.ts` 样板去重**：3.5–3.7，外加快捷键表（4.3）。
5. **状态修改收归 main**（4.2）：同时合并选区 patch 读写与翻转/旋转（3.8、3.9）。
6. **`CanvasEditor` 按职责拆分**（4.1）。第 5 步之后画布只剩渲染和交互，拆分会简单很多。
7. **面板事件委托**（4.5）、可选字段收紧（4.4）、命名与注释清理（第 5 节）。

预计规模：
- 第 1–2 步可删约 800–1000 行。
- 第 3–6 步再净减约 500–800 行。

---

## 附：审查中顺带发现的行为问题（不属于本次「只重构」范围，默认不修，仅记录）

1. **ConfirmModal 打开时全局快捷键仍会触发**：它的 keydown 不在 capture 阶段，也只拦截了 Esc。比如弹窗开着按 `Q`/`W` 会切换模式。`ReplaceColorModal` 有正确拦截。
2. **选区旋转不遵守分区锁**：`rotateSelectionContentCW` 会把锁定分区的遮罩也清成 Background，而移动、删除、替换色都会跳过锁定分区。
3. **确认方式不一致**：`confirmReset` 和「恢复默认 36 色」用的是浏览器原生 `confirm()`，其余确认都用 `ConfirmModal`。
4. **工程校验漏检发色预设**：`validateProjectData` 不校验 `hairPreset` 是否存在于 `RAMPS_INFO`，导入的非法值会让相关 UI 静默失效。

---

## 8. 执行记录（2026-09-29，分支 `refactor/cleanup`）

7 步全部完成，每步一个提交：

| 提交 | 内容 |
|---|---|
| `c3ffe24` | 第 1 步：删除死代码（`pngMetadata` → `projectData.ts`、旧版 recolorEngine、无调用方法/回调/选项、CSS 死类、`@/` 别名） |
| `8521420` | 第 2 步：`remapCore.ts` (2567 行) → `segmentation.ts` + `pixelGrid.ts` + `colorUtils.ts` (合计 1451 行)，全类型化 |
| `003a881` | 第 3 步：分区元数据 / 配色、像素渲染、泛洪、魔法数去重 |
| `05a5907` | 第 4 步：`main.ts` 撤销快照、发色确认弹窗、模式切换样板去重；快捷键改表驱动；发色逻辑移入 `recolorEngine.ts` |
| `0ced68f` | 第 5 步：状态修改全部收归 main；新增 `core/editOps.ts`；剪贴板移到 main |
| `6c55cd2` | 第 6 步：`CanvasEditor` 拆出 `canvas/ContextBar.ts`、`canvas/SelectionStatsPanel.ts`、`canvas/overlays.ts` |
| `bf8bc42` | 第 7 步：可选字段收紧、面板事件委托、命名与注释清理、文档更新 |

规模：`src/` 下 TS 从约 11 300 行降到 8 870 行；`main.ts` 2231 → 1826，`CanvasEditor.ts` 2455 → 1393。

### 验证方式

- 每步 `npm run build`（类型检查 + 构建）。
- Playwright 冒烟脚本，在原版 (`bf39b1b`) 与每步结果上跑同一套操作并逐项比对：
  - 44 个操作步骤后的工程状态哈希：两张样例图的导入、自动遮罩、重新识别，以及画笔、油漆桶、选区、翻转、旋转、剪贴板、替换色、撤销/重做、遮罩工具、发色预览/固化/放弃、ZIP 往返。
  - 导出的 PNG 与 ZIP 内每个文件。
  - 6 张中间状态截图：选区与统计面板、颜色高亮、上下文工具条、遮罩覆盖层、框选预览。
  - 事件委托后各面板点击路径的 DOM 状态。
- 结果：所有比对项与原版一致，**自动遮罩输出逐像素不变**。

### 有意的可见变化

- 数字键 0~4 选择分区时的 toast：原来的 🔴🟢🔵 与实际分区配色不符，统一改为 🎭。
- 遮罩工具箱提示文字：原文「在色板点击颜色亦可快速追加」不成立（遮罩模式下色板面板是隐藏的），改为「点击『➕ 添加』追加颜色」。

### 未做 / 保留

- 附录中的 4 个行为问题均未修改。另发现第 5 个：遮罩模式下有未固化发色预览时按 Shift+H / Shift+V / Shift+T 翻转或旋转整图，预览不会更新，之后固化发色会用预览像素覆盖掉这次翻转。重构保持原样。其中「选区旋转不遵守分区锁」在 `editOps.rotateRectCW` 的注释里做了标注。
- `GBA` 字样保留：这是色板本身的名称，见 `PALETTE_CHANGELOG.md`。
- `style.css` 未按组件拆分（4.7，优先级低）；TS 模板中的内联样式未迁移。
- `CanvasEditor.ts` 仍有约 1400 行，主要是鼠标/键盘交互、光标与悬停信息；可以继续拆分，但收益递减。
