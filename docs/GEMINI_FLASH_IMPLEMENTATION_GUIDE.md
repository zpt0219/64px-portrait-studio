# Gemini Flash 实施交接：64px Portrait Studio

文档日期：2026-10-03。

这是可以直接交给代码代理执行的实施规格。目标是修复已复现的 7 类缺陷，再完成与这些缺陷相关的结构重构。本文的实现约定是本方案给出的默认选择；其中有意改变既有行为的地方已明确标出。用户若另有指示，以用户指示为准。

请按任务编号逐项完成。不要将全文理解为一次性重写指令。先完成 T00–T06，再实施 T07–T11；每项完成后运行该项验证并更新进度记录，继续下一项。只有真实阻塞或用户明确要求停止时才暂停。

## 0. 执行前必须知道的事

### 0.1 工作区与基线

- 项目根目录：`/home/pt/Desktop/64px-portrait-studio`。
- 审查基线：HEAD `5708acd` 加当前所有未提交改动。开始时重新检查实际状态，不要假定 HEAD、行号或测试数量仍然一致。
- 工作区已经包含用户尚未提交的重构：controllers、segmentation 拆包、样式拆分、测试、面板缓存等。它们是当前实现的一部分，必须保留并在其上工作。
- 不执行 `git reset --hard`、`git clean`、整目录恢复或覆盖。不要因文件未跟踪就删除它。
- 不自动提交、推送、创建 PR 或部署。用户当前要交接实施，不代表授权发布。
- 开始时读取适用的 AGENTS.md。本文不能覆盖用户或项目更高优先级的指示。

### 0.2 成功目标

1. 合法文档经自动保存或工程 ZIP 往返，像素、遮罩、色板和发色预设一致。
2. 遮罩工具统一遵守来源分区锁、目标分区锁和透明规则。
3. 手势中执行历史、变换、导入、重置不会复活旧快照。
4. 保存、PNG/ZIP 导出失败能正确报告，成功状态有实际依据。
5. 导出期间继续编辑，ZIP 内所有文件仍来自同一个快照。
6. 领域模块不通过依赖链暗中取得浏览器 DOM、下载或全局 localStorage。
7. 有正式回归测试和可追踪的验证证据。

### 0.3 保留与不扩展的范围

保留：Vite、原生 TypeScript、三栏 UI、36 色、9 大发色、5 分区、64×64、快照式撤销、40 步历史、现有快捷键、PNG/ZIP 文件格式和导入量化算法。

不引入 React/Vue、通用状态库、DI 框架、事件总线库、Web Worker 或差量撤销。不要修改自动分割算法的阈值、色板数据和发色映射来“顺便优化”。不要重复拆分已拆好的 segmentation 和 CSS。不要为达到任意行数目标继续分文件。

本轮不重定义几何变换的锁定语义：翻转、旋转、移动、粘贴仍让像素和对应遮罩一起变换，遮罩锁仅约束遮罩工具；透明规范化则在所有像素写入路径生效。该默认选择应写入代码注释和用户说明。若后续要求几何变换也保护锁定区域，作为单独功能设计，不能在本轮偷偷引入。

### 0.4 已有证据与限制

审查时 `npm test` 为 8 个文件、46 个测试通过；`npm run build` 通过。不能据此认为行为正确。

`docs/review/reproduce-bugs.ts` 调用真实业务代码复现缺陷，使用内存存储、故障注入和 Canvas 替身。该脚本只是诊断，不是正式回归测试；ZIP 替身记录了渲染输入，不代表真实浏览器 PNG 已解码验证。

原始审查详见 `docs/REFACTOR_PLAN_2026-10-03.md`。V3 文档的“全部阶段完成”与代码不符，不应当作为验收结果。

## 1. 先建立项目地图

```text
src/main.ts
  → App：组装面板、弹窗、快捷键、文件导入
     → ViewModel：文档/会话、事件扇出、用户意图
        → CommandHandler：历史、合并、撤销/重做
           → SnapshotCommand / StrokeCommand：修改和快照
        → ImageImportPipeline / HairDraftController / SelectionService / ExportService
     → Panel：下一帧合并刷新
        → CanvasPanel：输入；CanvasRenderer：绘制
        → PalettePanel / MaskToolsPanel / MaskPanel / RealtimePreview

core：编辑纯函数、颜色、分割、发色、工程数据、PNG、ZIP、存储
model：PortraitDocument / EditorSession
```

`PortraitDocument` 当前包含 palette、pixelIndices、semanticMask、currentHairPreset。`EditorSession` 包含模式、工具、颜色、选区、锁定/显隐、发色草稿等。选区进入撤销快照，其余会话字段大多不进历史；会话不进入工程文件。

文档所有正常修改通过命令。载入/重置是文档整体替换并清历史。面板不能直接写文档。发色试色是非破坏性的 `displayPixels()`，固化才写入文档。

先阅读的文件顺序：

1. `package.json`、`tsconfig.json`、README。
2. `src/model/document.ts`、`src/model/session.ts`、`src/types/index.ts`。
3. `src/command/command.ts`、`commandHandler.ts`、`pixelCommands.ts`、`maskCommands.ts`。
4. `src/core/editOps.ts`、`projectData.ts`、`storage.ts`、`zipExporter.ts`。
5. `src/app/viewModel.ts` 和四个 controllers。
6. `src/app/app.ts`、`src/panels/canvas/CanvasPanel.ts`、两个 modals。
7. 现有 tests 和诊断脚本。

## 2. 本轮采用的行为约定

### 2.1 文档不变量

| 数据 | 规则 |
| --- | --- |
| palette | 恰好 36 个 `#RRGGBB` 颜色 |
| pixelIndices | 长度 4096；值 0–35 或 255 |
| semanticMask | 长度 4096；值 0–4 |
| 透明位置 | pixelIndices[i] 为 255 时，semanticMask[i] 必须为 Background |
| currentHairPreset | null 或实际存在的 9 个预设 key |
| 文档历史 | 新文档不继承旧文档的命令或活动笔划 |
| 发色预览 | 不直接写 doc；pixels/mask/palette/hairPreset 改动后缓存失效 |

**有意的行为变化：**旧实现允许擦除像素但保留锁定遮罩。本轮采用“透明必为背景”，因此显式像素删除会同步清除遮罩，即使该遮罩分区已锁定。锁不会阻止像素编辑；它阻止直接遮罩重分类。这是解决 B1 的默认规格，不是当前已经满足的行为。

透明规范化应在真实写入路径发生，而不是只在读档时补救。正常保存和读取不得偷偷修复一份刚由编辑器产生的文档。

### 2.2 遮罩工具锁规则

直接修改遮罩时：

1. 当前来源分区已锁定：拒绝。
2. 非 Background 的目标分区已锁定：拒绝。
3. 目标与当前相同：无变化。
4. 透明像素只能设 Background。
5. 油漆桶不得穿越锁定来源像素。
6. Background 作为擦除目标不额外受目标锁限制，但来源锁仍生效；这与现有画笔/桶的判断一致。

这组规则用于画笔、橡皮、右键遮罩擦除、桶、Shift+桶、框选和按色划入。显式“重新识别整个遮罩”继续视为整体替换，不在本轮新增保留锁定区域功能。

### 2.3 活动手势规则

| 操作 | 活动笔划的处理 |
| --- | --- |
| 普通 mouseup / 空格 keyup | 提交一次；无变化不入栈 |
| undo | 先提交活动笔划，再撤销；松手后不能重新提交 |
| redo | 先提交活动笔划，再尝试重做；若提交新修改已截断 redo，则不重做旧分支 |
| 其它文档命令 | 先提交活动笔划，再执行新命令 |
| 模式/工具/颜色切换 | 先结束当前手势，避免旧参数继续绘制 |
| 打开弹窗 / 发色确认 | 先结束当前手势 |
| 换工程 / 导入完成 / 重置 | 作废旧手势，再替换文档并清历史；不把旧手势提交到新工程 |
| 窗口失焦 / pointercancel | 对普通绘制提交当前结果；取消尚未落下的选区移动/框选；停止平移 |
| 同一结束事件重复到达 | 无操作 |
| 旧文档的结束事件晚到 | 无操作 |

框选/拖动只保存临时预览，没有落下前不应写文档。取消移动时不要回滚其它已完成的文档命令。

### 2.4 持久化和导出规则

- 自动保存防抖为 300 ms，每个编辑器实例独立；写入成功才 saved，失败则 failed。
- 页面隐藏和 pagehide 时尝试 flush；不能承诺浏览器强制终止时一定落盘。
- 重置先取消待保存任务，再清除项目存储。不得让待保存回调重新写回被清空的旧工程。
- PNG/ZIP 快照在发色确认完成、活动笔划结束之后，第一次异步编码之前捕获。
- 导出时继续编辑允许；每个包只读取自己的快照。
- “按原发色导出”使用 doc 的像素，不使用 displayPixels；保留试色草稿，遵循现有语义。
- 取消或关闭导出确认弹窗，应结束此次导出等待，不导出、不成功通知。
- 成功通知仅代表编码成功并触发下载，不声称磁盘保存已经完成。
- 多次导入以最新发起请求为准；过期请求不写文档，也不显示过期的成功/失败通知。

### 2.5 工程兼容性

保持 Schema v1、字段名称、`imagegem_project_autosave_v2`、ZIP 根目录 `imagegem_project.json` 和现有导出目录/文件名。

- 现有合法 v1 工程继续可读取；色板大写化沿用现状，测试比较采用规范化后的颜色。
- hairPreset 缺失/null 可兼容为 null；未知字符串、其它错误类型拒绝，并给出可读错误。
- 旧文件中透明像素带非背景遮罩：允许载入并规范化为背景，同时报告一次导入修复提示。不要静默宣称逐字节原样恢复。
- 正常新工程往返必须无修复提示、无内容变化。
- ts 缺失可沿用默认时间；若提供了时间，应验证为有限合法数字。时间不是文档内容相等断言的一部分。

## 3. 缺陷索引：用于对照实现

| ID | 问题 | 主要定位 | 实际复现结果 | 修复任务 |
| --- | --- | --- | --- | --- |
| B1 | 透明遮罩在往返中丢失 | pixelCommands.paintPixel、editOps.erase/clearRect、storage.projectDataToDocument | pixel=255、maskBefore=1、maskRestored=0 | T01/T02 |
| B2 | 目标锁被绕过 | MaskBoxSelectCommand、AssignColorToZoneCommand | pen 保持 Skin=2；box/assign 改为 Hair=1 | T03 |
| B3 | 手势交错污染历史 | ViewModel.begin/endStroke、stepHistory、replaceDocument | 第二笔撤销后第一笔复活；新工程 undo 恢复旧像素 | T04 |
| B4 | 保存失败报成功 | storage.saveProjectImmediate/saveProjectDebounced、Header.onSaveStatus | setItem 抛异常后 onSaved=true | T06 |
| B5 | 非法发色预设通过校验 | validateProjectData | `not-a-preset` → valid=true | T01 |
| B6 | PNG 异步错误失管 | ExportService.exportPng | success 通知 + unhandled rejection | T05 |
| B7 | ZIP 文件状态混杂 | generateProjectZipBlob | JSON index=1、渲染输入来自 index=2 | T05 |

原诊断中的旧输出是缺陷证据。修复后不要让正式测试继续断言这些错误输出。

## 4. 任务执行规范

每项按这个顺序进行：读相关实现 → 写能够验证目标行为的测试 → 观察当前失败 → 做小范围修改 → 通过定向测试 → 全量类型检查/测试/构建 → 写进度记录。

允许在本地短暂存在失败测试以确认复现；交付批次不能留下失败测试，不使用 skip、todo 或放宽断言掩盖问题。不要删除有效测试来通过构建。变更既有测试期望，仅限本文明确说明的语义变化，并附上理由。

在 `docs/IMPLEMENTATION_PROGRESS.md` 记录每项：状态、修改文件、行为变化、验证命令/结果、尚未验证项。实际测试数量和耗时按执行结果填写，不复制本文历史数字。

如果上下文需要重新开始，先读本文、进度记录和当前 git diff，从首个未完成任务继续。不要重新生成整套文件覆盖已做工作。

### T00 · 建立可执行基线和合法夹具

**文件：**package.json、tsconfig.tests.json（新增）、tests/helpers/documentFixture.ts（建议新增）、现有 tests。

步骤：

1. 记录 git status、当前 HEAD、node/npm 版本、现有 test/build 结果；不得把已有用户改动当成本轮自己的修改。
2. 增加 `typecheck:tests`，用独立配置检查 src 与 tests。配置继承 tsconfig.json，include 明确覆盖 `src`、`tests`；保留严格检查，不把 strict 改 false。若测试引用 Node 内置模块，给 devDependencies 加合适的 `@types/node` 并更新锁文件；无需时不添加。
3. 将 modeSwitching 测试中的 `promptOptions: any` 改为有类型的捕获工具。例如函数返回 `{ getLatest(): PromptOptions }`，没有捕获时抛清晰错误，避免闭包赋值触发 TS 错误后用 any 掩盖。
4. 定义合法文档夹具：新文档默认全透明+Background；指定 Hair/Skin 时必须先指定不透明像素。特别修正当前 modeSwitching 中只有遮罩、像素仍为透明的夹具。
5. 提供 `assertDocumentInvariant(doc)` 和文档内容比较助手，逐字节比较 pixels/mask、比较 palette/preset，不比较 timestamp、UI 会话和对象引用。

**验收：**原有有效用例通过，测试文件类型检查通过，build 通过。不要在此阶段修改产品行为。

### T01 · 独立工程 codec 和合法发色类型

**相关：**B1/B5。**文件：**core/projectData.ts、core/storage.ts、types/index.ts、model/document.ts、data/palette.ts、ZIP 导入调用处、tests/projectData.test.ts（新增）。

步骤：

1. 将 documentToProjectData / projectDataToDocument 从 storage 移入纯工程 codec，可直接扩展 projectData.ts，暂时不再新建第三个 codec 文件。
2. 保留纯 Base64 编解码、Schema 校验和文档转换；codec 不访问 localStorage/window/document，不通知 UI。时间可作为参数传入，默认 Date.now 只是时间来源。
3. 增加真实的 HairPresetKey 类型和 `isHairPresetKey(unknown)`。注意当前 RAMPS_INFO 是 `Record<string, RampInfo>`，对它使用 keyof 得到的仍然是 string，不能称为限制了 9 个 key。可让常量对象使用 `satisfies` 保留字面量键推导，或集中定义明确的九个 key；不要在多个文件手写九份列表。运行时guard使用typeof string和Object.hasOwn，不用`value in RAMPS_INFO`，避免接受`toString`等原型属性。
4. 内部文档/草稿/命令使用受约束的类型；从 DOM dataset、select.value 和未知 JSON 进入时做 guard，不使用盲目 `as HairPresetKey` 绕过验证。
5. 校验 hairPreset 和 ts；沿用 v1 的结构校验、4096 长度、索引范围、36 色格式。对旧透明遮罩规范化返回警告信息，调用层负责显示一次提示。
6. 旧导出路径和 localStorage 读取都改为调用同一 codec；不要发生 ZIP 导入校验一套、自动恢复校验另一套。

测试必须包括：合法九个 key、null、missing、非法 string、错误类型；损坏 Base64、长度错误、像素值36、遮罩值5、错误 hex、未知版本；合法内容往返；旧透明遮罩规范化有警告；所有输入数组/色板不被 codec 意外修改。

**验收：**B5 拒绝非法预设；codec 在 Node 下独立可测；暂未修复写入规则的 B1 测试留到 T02 同一修复批次完成，不能作为完成报告中的通过项。

### T02 · 在写入处统一透明规则

**相关：**B1。**文件：**core/editOps.ts、command/pixelCommands.ts、transformCommands.ts、paletteCommands.ts、tests/editOps.test.ts、tests/pixelCommands.test.ts（新增）、tests/projectData.test.ts。

步骤：

1. 建立共享的像素写入/擦除小函数。写255时，像素和遮罩一起设为透明/Background；写不透明色时保留该位置现有合法遮罩。
2. 修复 paintPixel 的左键 pen=255 分支；右键、eraser 使用相同规则。不能只加一次“结束后全量规范化”掩盖绘制过程中的错误事件和预览。
3. 让 clearRect、erase、movePatch 的源清除、replaceColor 到透明、floodFillPixels 到透明都用同一规则。
4. 检查 stampPatch、旋转结果和 CommitHairRecolorCommand 不引入非法透明遮罩；输入为合法 patch 时不得丢失非透明像素的遮罩。
5. 更新既有 clearRect 测试中“透明但保留锁定 Skin”的期望，注明这属于 §2.1 的行为修复。
6. 命令返回实际改变，像素或遮罩变化分别发正确事件；不要让无变化笔划产生历史。

**矩阵：**左键透明笔、右键透明色、橡皮、普通桶、Shift+桶、替色、删除、剪切、移动源清除，分别在锁定/未锁定分区验证 pixel=255、mask=Background。每种代表路径至少加一个 undo/redo 恢复和 encode/decode 一致断言。

**验收：**B1 新合法工程往返不丢遮罩；每次写入后的文档满足不变量；锁定行为变化已在测试和说明中注明。

### T03 · 统一直接遮罩编辑的锁规则

**相关：**B2。**文件：**core/editOps.ts 或 core/editPolicy.ts（必要时新增）、command/maskCommands.ts、command/pixelCommands.ts、tests/maskCommands.test.ts（新增）。

建议共享判断的概念接口：

```ts
canAssignZone(
  pixelIndex: number,
  current: SemanticZone,
  target: SemanticZone,
  locked: ReadonlySet<SemanticZone>,
): boolean
```

实现可调整，但所有遮罩编辑调用同一规则；无变化是否另行判断可以自行选择，须保持统一。不要给 pixel erase 使用这个规则，因为 §2.1 规定透明规范化优先。

步骤：在框选 add 与一键划入补齐目标锁；画笔和桶复用判断；保持框选四种 action、锁定区域不可被桶穿越、透明防护。count 必须统计真正改变的像素，不能把本来已是 Background 的擦除计为1。

**验收矩阵：**四类工具×来源锁/目标锁/均未锁；框选 add/remove/subtract/clear；transparent；目标等于当前。拒绝操作不修改文档、不入历史、不报成功数量。

### T04 · 给活动手势建立事务边界

**相关：**B3。**文件：**app/viewModel.ts、command/command.ts、commandHandler.ts、四个 controllers 的命令入口、CanvasPanel.ts、SelectionInteraction.ts、tests/gestureHistory.test.ts（新增）。

建议增加小型 GestureTransaction 或在 ViewModel 内先实现同等能力，不必强制引入泛型事务框架。

步骤：

1. 保存活动 stroke 与创建时的 document generation；工具参数中的 lockedZones、selection 都复制，不能引用将被会话修改的数组/对象。
2. 提供 finishActiveGesture 和 invalidateActiveGesture。finish 取出后先清空引用，再 end/commit，避免事件重入重复提交。invalidate 不能在新文档上运行旧快照 undo。
3. 所有普通命令统一通过一个受事务保护的 `executeCommand(cmd)` 入口。当前 SelectionService/HairDraftController 直接拿 commandHandler.execute 的调用必须接入；不能只在 vm.undo 前补 endStroke。
4. undo/redo、模式/工具/颜色切换、弹窗打开和 export 都按 §2.3 处理。beginStroke 不能覆盖一条尚未结束的笔划。
5. replaceDocument 在任何新数据写入之前作废手势并递增 generation，再替换文档/清历史。向 CanvasPanel 发出可取消交互的事件，不靠 selection=null 碰巧清状态。
6. CanvasPanel 的 isMouseDown、lastX/Y、spacePress、选区移动/框选在外部中断时同时清空。只清 ViewModel.stroke 会造成仍按住鼠标时错误继续新一轮输入。
7. 实现 generation/token 后，旧 token 的 dab/end 不能影响新文档或新手势；同一次 end 两次调用不重复入栈。对普通 abort 的回滚若需要，明确区分 rollback 与“换文档时丢弃旧引用”，不能混用。

**关键测试步骤与期望：**

- 完成第1笔 index0=1；开始第2笔 index1=2；undo → `[1,255,255]`，第二笔已被提交并撤销；后续旧 strokeAt/end 不写入；redo 可恢复合法第2笔。
- 旧工程活动笔划期间载入首像素8的新工程；旧 end 到达 → canUndo=false；undo 不改变新工程首像素8。
- 活动笔划+flip：历史为笔划、flip两步；逐步 undo 顺序正确。
- 活动笔划+颜色切换：旧笔使用旧颜色结束，新一次按下使用新色；不在一个快照里混入未受控的修改。
- 无变化笔划、不透明/遮罩笔划、桶、多点笔划各只产生所需历史；40 步上限和 palette gesture 合并仍正确。
- 发色草稿确认、放弃、取消继续遵循现有非破坏性预览语义，且不重入提交。

**验收：**B3 两条复现均修复；命令入口不再绕过活动手势保护；外部操作之后画布交互状态与 ViewModel 一致。

### T05 · 导出快照、异步完成和异常管理

**相关：**B6/B7。**文件：**app/controllers/ExportService.ts、core/zipExporter.ts、model/document.ts（快照 helper）、viewModel.ts 导出入口、ConfirmModal.ts、tests/exportService.test.ts、tests/zipExporter.test.ts（新增）。

先修可靠性，浏览器文件迁移留给 T07；不要在一个大补丁里同时改导出行为和所有 import 路径。

建议依赖接口：

```ts
interface ExportPorts {
  captureDocument(): PortraitDocument; // 返回深拷贝；不能是 vm.doc 别名
  resolveHairDraft(): Promise<'committed' | 'original' | 'cancelled'>;
  encodePng(snapshot: PortraitDocument): Promise<Blob>;
  encodeZip(snapshot: PortraitDocument): Promise<Blob>;
  download(blob: Blob, filename: string): void | Promise<void>;
  notify(message: string, level: ToastLevel): void;
}
```

示意接口不要求照抄；核心要求是纯输入、可注入、可等待、可捕获异常。运行中的快照由导出任务私有拥有，领域代码不再改写它。

步骤：

1. 增加 cloneDocument/captureExportSnapshot helper，复制 palette、pixels、mask，保留 preset 值；只复制外层对象或使用 Uint8Array.subarray 都不算深拷贝。
2. 发色确认完成后、第一次编码调用前拍快照。PNG 和 ZIP 都用同一策略；ZIP 的 JSON、minimal PNG、1x/4x/8x、综合/分区遮罩、README、GPL、色板预览全用 snapshot。
3. 保证公共 generateProjectZipBlob(doc) 自身也在首次 await 前取得私有快照，避免调用它的其它代码重新出现 B7。若上层已有快照，可约定所有权，但公共边界不能盲信传入 doc 不变。
4. exportPng/exportZip 返回可等待的 Promise；内部统一 try/catch，把编码错误、Canvas.toBlob null 和下载器错误转换为失败结果/通知。UI 忽略返回值时也不会出现 unhandled rejection。
5. 修复导出确认 Promise：按钮选择、Esc、X、点遮罩关闭都恰好结束一次等待；取消不下载。可给 PromptOptions 加可选 onDismiss，并让 ConfirmModal 区分 button 与 dismiss。注意“点击按钮先 close 再执行按钮回调”的旧实现，不能让 close 的取消回调先于按钮动作 resolve(cancelled)。
6. “应用发色”先 commit 后拍快照；“原发色”拍 doc，不读取预览，不丢掉草稿；“取消”无副作用。若确认过程中已经切换文档，用 generation 判断该次请求过期并取消。
7. 使用现有 app/utils/download.ts 作为最终下载实现；删除已不使用的副本，避免两份不同 revoke 策略。下载器只负责浏览器动作，不知道 ViewModel。

**测试矩阵：**

| 场景 | 断言 |
| --- | --- |
| PNG 正常 | Promise 完成、download一次、之后才success |
| encoder pending | 尚无success、尚未download |
| encoder reject | failure一次、无success/download、无未处理拒绝 |
| downloader throw/reject | failure，无success |
| Canvas.toBlob null | ZIP明确失败，不继续生成成功提示 |
| 发色应用后导出 | 快照包含固化像素和新preset |
| 原发色导出 | 使用文档像素，草稿保留 |
| 按钮取消/Esc/X/背景关闭 | Promise结束，零下载 |
| 迟到确认回调 | 新文档不被旧确认修改 |
| 导出后改 pixels、mask、palette、preset | 传给全部编码/资源生成路径的都是旧快照 |
| 两次并发导出 | 每次拥有自己的快照，不共享可变缓存 |

ZIP 测试分两层：单元测试使用可控编码器/Canvas替身，证明快照一致和调用顺序；浏览器集成用实际生成 PNG，解码并逐像素对照 JSON。不要以替身“返回假 PNG”的测试冒充真实 PNG 正确性验证。

PNG 纯编码另加一次格式测试：签名、IHDR宽高64、PLTE、tRNS、透明槽、IDAT解压后的逐行filter和索引，必要时CRC；有/无 CompressionStream 两条路径都可解码。这验证导出内容，而不只是“返回Blob”。

**验收：**B6/B7 修复，PNG和ZIP都能await；正常路径只报告实际成功，错误路径无未处理Promise。

### T06 · 实例级自动保存和存储失败状态

**相关：**B4。**文件：**app/services/AutosaveService.ts（建议新增）、app/adapters/BrowserStorage.ts（建议新增）、core/storage.ts、app/viewModel.ts、app/app.ts、command/events.ts、Header.ts、tests/autosave.test.ts（新增）。

概念接口：

```ts
interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// 实例对象；所有定时器、待保存内容、状态都属于这一实例。
class AutosaveService {
  schedule(doc: PortraitDocument): void;
  flush(): SaveResult;
  cancel(): void;
  load(): LoadResult;
  clear(): SaveResult;
  dispose(): void;
}
```

这是结构示意，不是可直接编译的声明。结果建议使用成功/失败的 discriminated union；错误由调用方展示，不吞掉后报success。

步骤：

1. 从 core/storage.ts 移出 activeStore、debounceTimer；每个 ViewModel 注入自己的 AutosaveService/端口。测试提供新的内存Map，而不是调用全局setStorageAdapter。
2. schedule 保存私有的最新文档快照或采用有明确所有权的待保存数据；相同实例的快速改动覆盖旧pending，300 ms 后只写最后一次内容。
3. 保存前状态 saving；setItem真正成功后saved；抛异常时failed。添加 Header 的failed样式和可读文案，如“自动保存失败，请导出工程备份”，不弹出确认阻塞编辑。失败后的下一次正常写入回到saved。
4. BrowserStorage 不能在模块导入阶段读取window.localStorage。取得后端以及每次get/set/remove都可能抛异常；返回明确失败。没有后端时不能静默当saved。
5. clear 先cancel，然后remove；clear失败不能提示“已清除缓存”。重置画布可继续，但失败结果需要正确通知，旧定时器不能回写。
6. flush 只处理pending，成功后移除pending并取消timer；重复flush不重复写；cancel/dispose后timer不会执行。
7. App在visibilitychange为hidden、pagehide时flush；dispose按约定flush后释放。所有状态回调要能识别已销毁/旧generation，不能让旧文档的保存状态覆盖新文档。
8. 列宽偏好当前在app.ts直接读写localStorage，也改用安全的BrowserStorage；失败采用默认布局并不中断App初始化。项目autosave与布局偏好仍使用不同key。
9. hasSavedProject不再仅以字符串length>50宣称存在有效工程；走codec，损坏工程不能显示可成功恢复的入口。可缓存校验结果避免每次render重复parse。

**用例：**299 ms不写、300 ms写一次；多次schedule只写最后内容；setItem quota/security异常failed；failed后正常saved；getItem/removeItem异常可读错误；两个实例独立timer/store；cancel/clear/dispose无迟到写；pagehideflush；重置与载入交错；非法存档恢复不改变现有文档。

**验收：**B4修复；领域测试无真实localStorage；不存在模块全局可变存储或防抖计时器。

### T07 · 收紧模块和控制器依赖

**文件：**四个controllers、viewModel.ts、app.ts、core/zipExporter.ts、pixelRender.ts、storage.ts及所有调用处。

T01–T06通过后再做这一项，迁移只改变依赖方向，不再次重定义行为。

建议最终布局：

```text
src/core/
  editOps.ts / editPolicy.ts
  projectData.ts              # codec + validation + pure conversion
  minimalPng.ts               # bytes/Blob编码，无DOM
  pixelRender.ts              # 若含浏览器绘制，迁到browser/render而非伪装纯core
  segmentation/ / colorUtils.ts / recolorEngine.ts / pixelGrid.ts
src/app/
  viewModel.ts
  controllers/
    SelectionService.ts
    HairDraftController.ts
    ExportService.ts
    ImportCoordinator.ts      # 异步请求顺序、应用结果
  services/AutosaveService.ts
  adapters/BrowserStorage.ts
  browser/
    projectArchive.ts         # ZIP组装/读取及Canvas资源生成
    pixelCanvas.ts            # Canvas绘制/缩放
  imageDecode.ts
  utils/download.ts
```

文件名可合理调整；不要为了严格照树新增大量空目录。JSZip的纯归档读取逻辑可以保留为独立无DOM模块，但不要和绘制/下载混在一起后整体称为纯core。

步骤：

1. ExportService只依赖ExportPorts；SelectionService只依赖文档/会话读取、executeCommand、setSelection、notify等窄端口；HairDraftController只获取预览所需输入、草稿修改、命令派发与确认端口。
2. SelectionService不得直接访问CommandHandler；受保护的executeCommand保证T04事务机制不会被迁移绕过。
3. ImageImportPipeline改成纯输入→输出：DecodedImage+palette→{doc, importInfo, warnings}。App/ImportCoordinator应用文档和提示；fallback信息随返回值传递，不在算法里notify。算法、量化和默认使用当前palette的行为不变。
4. 将ZIP Canvas生成/下载、createScaledCanvas、drawIndexedPixels等真正浏览器绘制移出core。依赖CanvasRenderingContext2D的函数即使不调用createElement，也仍是浏览器适配实现，不能冒称Node纯算法。
5. App完成浏览器实现的组装注入。ViewModel的默认构造可给测试提供无IO实现，但不能悄悄读取全局浏览器；无IO状态不得报告保存成功。
6. 用getter/读取函数获取当前文档数组，避免控制器缓存换工程前的pixelIndices引用。纯函数以参数获取数据；不要让控制器读文档的同时任意写它。
7. 删除过渡期公共getter/bridge，只在所有调用已迁移后删除。必要的re-export可以短期保留并注明迁移用途，最终避免无人使用的兼容壳。

**依赖检查：**

```bash
rg -n 'window\.|document\.|localStorage|HTMLCanvasElement|CanvasRenderingContext2D' src/core src/model src/command
rg -n 'import.*ViewModel|commandHandler|replaceDocumentInternal|patchSession' src/app/controllers
rg -n 'downloadBlob' src
```

检查每一条命中，不要求机械“零关键词”（注释/类型可能解释用途），但纯领域实现不能依赖DOM。Blob/CompressionStream可保留在编码实现，Node中可用或已有fallback，测试不得为了导入纯领域代码先创建document。

**验收：**领域控制器不再import完整ViewModel；浏览器依赖由App注入；最终迁移前后相同测试输入得到相同文档/文件内容。

### T08 · 导入顺序、确认取消和UI手势中断

**文件：**ImportCoordinator或App.handleIncomingFile、CanvasPanel、SelectionInteraction、ConfirmModal、ReplaceColorModal、ViewModel模式/显隐切换。

这几项此前仅有静态证据，必须先添加可控制的复现用例，再标记为已修复。

1. **导入顺序：**每次用户选择/拖入文件发起时increment requestId；异步ZIP读取或图片解码返回后检查ID和disposed。新请求尚未完成时，旧请求也不得先写入。reset、restore和其它明确换文档意图应使pending导入失效。已经开始的纯算法无法取消时，只丢弃结果。通过延迟promise测试A后发B、B先返回、A后返回，最终保持B；失败过期请求不提示。
2. **blur：**统一结束鼠标/空格绘制，取消临时框选/移动，停止中键平移，重置修饰键和copy latch。补pointercancel及可靠的mouseup所有权处理；可以使用Pointer Events+capture，但不要只替换事件名称而漏掉右键/空格兼容。
3. **弹窗输入：**App和CanvasPanel共享modal-open状态/输入守卫；有弹窗时不执行画布快捷键，不对原生按钮Space/Enter盲目preventDefault。ConfirmModal打开时把焦点移入，关闭恢复先前焦点，Tab不跑到画布工具；ReplaceColorModal的Enter确认语义保留。避免在window监听中仅用stopPropagation阻止同一节点其它监听，必要时采用明确统一路由。
4. **模式取消原子性：**隐藏最后一个遮罩并触发发色确认时，不提前永久修改显隐状态。应用/放弃后才提交目标模式和显隐；选择继续试色、Esc/X关闭则保留此前visibleMaskZones/showMaskOverlay/mode/draft。测试完整会话状态，不只断言activeMode。
5. **外部变化取消拖动：**载入、reset、undo/redo、切换模式后，旧floating patch不能再在松手时盖到文档。generation检查与T04配合。

**验收：**有正式延迟导入测试；真实浏览器验证窗口外松手后不粘笔、弹窗键盘可用、取消保持旧会话、迟到拖动不写入新文档。

### T09 · 统一dispose与渲染调度生命周期

**文件：**Panel.ts、App、Header、CanvasPanel、RealtimePreview、两种Modal、SelectionInteraction、Toaster和服务对象。

步骤：

1. Panel增加幂等dispose：注销VM监听，从dirtyPanels移除，销毁后markDirty无效；flush快照遍历时也不能render已经销毁的panel。
2. 全局事件绑定使用可移除函数引用或实例级AbortController；dispose解除listener、取消timer/RAF、释放控件/隐藏fileInput，移除实例拥有的DOM节点。
3. App明确保存所有创建对象的引用，而不是new之后丢掉，集中dispose；调用SelectionInteraction.dispose、AutosaveService.dispose和导入请求作废。
4. Toaster的延迟移除也纳入清理；RealtimePreview全局move/up监听解除；Modal退出时处理未完成确认Promise。
5. dispose期间禁止产生新的UI/文档写入。flush保存按T06约定在IO仍可用时先做，之后才解除其通知监听。

**验收：**构造→dispose→再次dispose无异常；dispose后窗口键鼠事件不调用旧VM；活动走马灯/Toast不再tick；重复挂载不会出现重复命令；dirty queue不渲染已销毁Panel。

### T10 · 小范围优化DOM刷新与事件

**文件：**MaskToolsPanel、SelectionStatsPanel、HoverInfoBar、MaskPanel、CanvasPanel和StrokeCommand事件。

先记录一组可复现操作的render次数、DOM节点是否重建和简单性能采样。没有测量就不要写“解决卡顿”“零延迟”。

步骤：

1. MaskToolsPanel匹配色块仅在matchColors/palette变化时更新，缓存节点或小型keyed更新；Add弹出层不能因 unrelated session event被全量重建导致焦点丢失。
2. 画面颜色列表最多36种，复用卡片，按pixels/mask/zone/locks/palette实际变化刷新；透明不作为可划入非背景的颜色。
3. SelectionStatsPanel用selection+pixels+palette计算结果，active foreground/background只更新class；缓存统计不缓存失效的像素引用。
4. HoverInfoBar保留固定结构，根据pixel/moving/box状态切换，textContent/styles更新；状态提示不继续每次mouse move拼整段innerHTML。
5. MaskPanel只在mask/doc变化时重算zone counts，避免zoom/opacity/tool变动都扫描4096像素；预设badge只在状态变化时写DOM。
6. StrokeCommand桶只改不透明颜色时不发onMaskChanged；实际清除遮罩时才发。不要只根据pixelsChanged设maskChanged，记录真实变化。
7. 保留64×64整图Canvas重绘和现有RAF合并，不添加脏矩形复杂度。确保走马灯仍只刷新Canvas所需部分。

**验收：**DOM交互结果一致，切色/撤销/发色预览/高亮不失效；opacity/zoom不重算颜色统计；hover不全量重建信息节点；计数或性能证据可复查。不添加与实现逐行镜像的测试。

### T11 · 兼容性、浏览器验证和文档收尾

**文件：**README、docs/REFACTOR_PROPOSAL_V3.md、docs/IMPLEMENTATION_PROGRESS.md、tests/fixtures、必要的集成测试配置。

步骤：

1. 用固定输入检验量化/segmentation/recolor未被T07迁移改变；选择肤色头像、不同发色、透明背景、小图居中、非64大图、无可识别脸的输入。夹具可用小型合成像素图，不依赖网络下载或随机图片。
2. 保留一个合法旧版v1工程fixture，读→写→读逐字节比对规范化后的document；旧透明遮罩fixture单独验证修复提示。
3. 在真实浏览器导出ZIP，验证实际PNG与mask内容，使用临时浏览器存储隔离用户工程。若缺少浏览器工具，完成单元与构建检查，将未执行项明确记录，不能用截图想象或替身结果填补。
4. 更新README当前目录、测试命令、透明与锁规则、保存失败、发色草稿处理；V3实施状态按真实完成项写，不保留笼统“全部完成”。
5. 更新诊断脚本的已迁移imports/注释，或明确将它归档为历史缺陷复现。不得保留一份README声称可运行但已断import的脚本。正式回归以tests为准。
6. 写最终交付报告：完成任务、行为变化、实际测试结果、未验证限制，引用文件位置；没有真实执行的检查不能写passed。

**验收：**§5的最终清单全部有证据；无法执行的浏览器检查列为未验证，实施报告不得宣称全量验收已完成。

## 5. 最终验收清单

### 5.1 必跑命令

开始时：

```bash
git status --short
git rev-parse HEAD
node --version
npm --version
npm test
npm run build
```

实施中按任务跑定向测试，例如：

```bash
npm test -- tests/projectData.test.ts
npm test -- tests/maskCommands.test.ts tests/gestureHistory.test.ts
npm test -- tests/exportService.test.ts tests/autosave.test.ts
```

文件名称按实际实现调整。定向通过后，交付批次和最终运行：

```bash
npm run typecheck
npm run typecheck:tests
npm test
npm run build
git diff --check
git status --short
```

`typecheck:tests`由T00加入；不要写一个总是exit 0的脚本占位。git diff --check也会检查原有用户diff，若发现原有问题需区分来源；新创建未跟踪文件需另外检查，不能以diff未显示它们就宣称无问题。

普通npm install/npm ci仅在依赖尚未安装或合理变更依赖时执行；锁文件已有未提交变化，不能用重新生成锁文件抹掉现有内容。不要自动升级Vite/TypeScript等无关依赖。

### 5.2 核心回归覆盖表

| 类别 | 最小验收内容 |
| --- | --- |
| 文档夹具 | 合法palette/indices/mask/preset，透明→Background |
| 工程codec | 合法/非法输入、旧工程迁移提示、合法往返、输入不被修改 |
| 发色key | 9个合法key/null、missing兼容、未知/错误类型/原型属性拒绝 |
| 透明写入 | pen/右键/eraser/bucket/替色/删除/剪切/移动，含锁定区域 |
| 遮罩锁 | 来源锁、目标锁、透明、Background擦除、四种框选action |
| 计数/事件 | 无变化不报修改、不入栈；只发实际pixels/mask差异 |
| 手势历史 | 单笔合并、undo/redo交错、变换交错、旧end、换文档、40步上限 |
| 色板命令 | 同gesture合并；undo之后新编辑截断redo；不同gesture不合并 |
| 发色草稿 | 预览不改doc；commit/discard/cancel；文档变换后预览刷新 |
| PNG | 成功顺序、错误通知、下载异常、编码内容/透明槽/fallback |
| ZIP | 全包同快照；编码过程中编辑/换工程/并发导出不污染 |
| 保存 | 300ms防抖、失败状态、失败恢复、cancel/flush/clear、实例隔离 |
| 导入 | B覆盖A、过期失败静默、reset使pending失效 |
| Modal | 取消/关闭结束Promise、焦点/Space/Enter/Esc、原状态恢复 |
| 生命周期 | dispose幂等、事件解除、timer/dirty queue不残留 |
| 刷新 | 依赖变化才统计、缓存不陈旧、hover不重建固定节点 |

不要追求固定新增测试数。参数化测试可以覆盖矩阵，但必须验证输出内容和副作用，不能只断言“调用一次”或“没有抛错”。

### 5.3 浏览器手动/自动冒烟流程

用独立浏览器profile或临时测试origin，不修改用户现有自动保存。开发服务使用项目现有base `/64px-portrait-studio/`，可加`?debug`使用window.__studio；不要为测试暴露新的生产调试接口。

1. 空工程启动：无控制台异常；有损坏缓存时不误报可恢复；存储不可用也能正常显示布局。
2. 导入正常头像：量化到36色、遮罩生成；导入小图居中、非64大图缩放行为不变。
3. 像素编辑：左右键颜色、透明pen、eraser、4/8桶、Shift桶、替色；每步undo/redo可恢复合法文档。
4. 遮罩编辑：锁来源/目标；pen/eraser/bucket/框选四action/按色划入结果一致。
5. 选区：矩形框选、拖动移动、Ctrl复制、复制/剪切/粘贴/删除、翻转/旋转、跨画布边界、Esc取消。
6. 绘制中按undo、换工具、flip；新图导入后旧鼠标松手；窗口外松手再返回；不能继续粘笔或复活旧像素。
7. 发色：预览多个预设、几何变换后重新预览、固化/放弃；切模式确认取消时原显隐和草稿保留。
8. 弹窗：Tab、Shift+Tab、Enter、Space、Esc；画布快捷键被阻断；关闭后焦点恢复；发色导出确认关闭时没有挂起Promise。
9. 导出PNG与ZIP：解码内容，PNG透明正确；ZIP内JSON、1x/4x/8x、mask层和palette一致；打包时继续编辑，新编辑不能混进旧快照。
10. 自动保存：编辑后恢复同内容；失败显示失败而非成功；恢复存储后再编辑成功；300ms内reset后不会重新出现旧工程。
11. 连续导入A/B：人为延迟A使其晚完成，最终必须是B；reset期间旧导入返回不得写入。
12. 挂载/销毁后重建：没有重复快捷键、重复timer、重复Toast或孤立隐藏文件输入。

每项记录实测环境、通过/失败/未执行。浏览器未知能力或无工具时不要安装不必要的大量环境，更不要伪造结果；先完成可执行验证并报告限制。

## 6. 易错实现提醒

| 易错做法 | 正确要求 |
| --- | --- |
| 只在导入时清透明mask | 写入时维护不变量；旧档迁移另处理 |
| 每个工具复制一段锁判断 | 共用规则，保留桶的通行限制 |
| undo前endStroke，但services仍裸用handler | 普通命令都经事务保护入口 |
| 换文档后才对旧笔划undo | 先作废旧手势，不在新doc上运行旧快照 |
| deep clone只spread外层doc | palette和两份Uint8Array必须复制 |
| readonly PortraitDocument就当运行时不可变 | readonly不保护数组内容，导出必须私有拷贝 |
| exportPng返回void后在调用点加void | void不处理rejection，内部必须await/catch |
| Promise确认只处理按钮 | Esc/X/遮罩关闭也resolve；按钮close不得抢先resolve取消 |
| 自动保存catch后继续onSaved | 返回明确失败，只成功写入才saved |
| new服务却仍使用模块全局timer | timer/store/pending/callback均属于实例 |
| 用本次timestamp差异判断往返失败 | 比较document内容，不比较时间 |
| 实施迁移后旧控制器缓存数组 | getter读取当前doc，避免旧数组引用 |
| 模块导入时访问window/localStorage | 浏览器适配器在App组装时取得能力并处理异常 |
| 建“大端口接口”复制VM全部方法 | 按控制器职责只暴露必要权限 |
| DOM优化缓存后不做失效 | 明确pixels/mask/palette/selection依赖和revision |
| 把诊断脚本exit0当修复证明 | 转成正式目标行为断言并执行 |
| 通过测试但删掉原测试或降低strict | 修复实现；语义改变单独注明；维持严格检查 |
| 声称全部完成却没有浏览器证据 | 分开报告实现、单元验证、浏览器验收状态 |

特别注意现有ViewModel文档对象外壳可能保持不变，但pixelIndices/mask在replaceDocument时被换成新数组；引用所有权要按数组考虑。

## 7. 分批交付和进度模板

建议批次：

| 批次 | 任务 | 交付重点 |
| --- | --- | --- |
| A | T00–T03 | 合法数据、codec、透明规则、遮罩锁 |
| B | T04 | 手势/历史稳定性 |
| C | T05–T06 | PNG/ZIP快照与保存失败 |
| D | T07 | 依赖迁移与窄接口 |
| E | T08–T10 | 导入/弹窗/生命周期/刷新 |
| F | T11 | 文件兼容、浏览器验收、文档 |

每批完成后清楚报告，不必等待额外许可才开始下一批（除非用户已另有限制）。不要自动执行git commit；仅报告适合分拆的变更，交由用户决定提交。

如果一次执行的上下文不足，至少完成当前单项的验证与记录；进度里明确下一项入口和未完成内容，不能用“全部阶段完成”结束。用户要求持续执行时，继续推进直到范围完成。

在`docs/IMPLEMENTATION_PROGRESS.md`使用如下模板：

```markdown
# 实施进度

## 基线
- 实际HEAD：...
- 开始时已有未提交修改：...
- node/npm：...
- 初始test/build：真实命令与结果
- 默认行为：采用交接文档§2；任何偏离单独记录

## 任务状态
| ID | 状态 | 变更文件 | 验证证据 | 未验证/下一步 |
| --- | --- | --- | --- | --- |
| T00 | 未开始 | | | |
...保留T00–T11全部行...

## 行为变化
- 透明像素清遮罩优先于分区锁：...
- 其它行为变化及对应测试：...

## 最近完成任务
- 编号、输出、实际测试

## 下一项
- 编号、相关文件、仍需处理的问题

## 最终验证
- typecheck / typecheck:tests / test / build / diff检查
- 浏览器实测：通过、失败、未执行分别记录
```

每个任务只能标“未开始”“进行中”“实现完成待验证”“验证通过”“阻塞”。阻塞须说明具体原因，不用推测性风险替代原因。

## 8. 可以直接复制给 Gemini Flash 的启动提示词

```text
请在 /home/pt/Desktop/64px-portrait-studio 实施修复和重构。

先完整阅读 docs/GEMINI_FLASH_IMPLEMENTATION_GUIDE.md，并按其中T00–T11顺序执行；原审查证据在docs/REFACTOR_PLAN_2026-10-03.md，诊断脚本在docs/review/reproduce-bugs.ts。

当前工作区已有大量未提交重构，必须保留，不能reset/clean/恢复覆盖。读取适用AGENTS.md；以实际当前代码为准定位，不机械依赖旧行号。本轮采用交接文档§2的默认行为约定；透明删除同步清mask是有意修复，须更新相关旧测试并记录理由。

先修B1–B7，再做依赖与交互整理。每项先建立可验证的目标行为用例，再修改实现。禁止通过删除测试、skip测试或降低TypeScript strict来过关。不要重写UI框架、修改色板/分割算法或新增无关功能。

每项运行定向测试；交付批次运行typecheck、typecheck:tests、npm test、npm run build。更新docs/IMPLEMENTATION_PROGRESS.md，记录实际修改、测试结果、行为变化和未验证项。真实浏览器测试、替身单测和构建必须分别报告，不能把未执行项写成通过。

请继续实施到范围完成，不停留在计划或口头说明。按文档批次报告进度，只有真实阻塞或用户要求停止才暂停。不自动提交、推送或部署。如果上下文重启，读取进度记录继续首个未完成任务，不覆盖已有工作。

最终给出完成任务、实际验证结果、文件位置和剩余限制。
```

若Gemini运行环境不能读取本地文件，将本文件全文连同项目代码提供给它；仅发送本文文件路径不会让另一个没有共享文件系统的模型获得文档内容。
