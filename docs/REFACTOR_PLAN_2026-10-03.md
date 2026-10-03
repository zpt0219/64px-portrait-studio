# 项目审查与下一轮重构计划

日期：2026-10-03。基线：HEAD `5708acd` 加当前全部未提交修改；不是只审查 HEAD。

可直接交给 Gemini Flash 执行的详细规格见 [GEMINI_FLASH_IMPLEMENTATION_GUIDE.md](GEMINI_FLASH_IMPLEMENTATION_GUIDE.md)，包含默认行为决策、T00–T11 任务、测试矩阵、交付要求和启动提示词。本文保留原始审查证据。

本次新增审查文档和诊断脚本，未修改应用实现，也未提交现有工作区改动。

## 1. 项目理解与验证范围

这是 Vite + 严格 TypeScript 的纯浏览器 64×64 像素头像编辑器，无 UI 框架。文档保存 36 色色板、4096 个像素索引、4096 个语义遮罩值和当前发色预设。工具、选区、分区显隐/锁定和发色草稿属于会话。

主要数据流：

```text
图片 / ZIP → App 解码、读取 → ViewModel / ImageImportPipeline → Document
Panel 用户输入 → ViewModel → CommandHandler → SnapshotCommand → Document
Document 事件 → 发色预览失效 + 防抖保存 + 面板下一帧刷新
Document + 发色草稿 → displayPixels() → CanvasRenderer / RealtimePreview
Document → PNG 编码 / ZIP 多文件打包 → 浏览器下载
```

已有分层值得保留：`core` 算法、`model` 数据、`command` 撤销、`app` 协调、`panels` 交互和渲染。64×64 文档快照约 8 KB，40 步撤销规模很小；本轮没有理由改成复杂的差量历史。

当前已完成的重构包括 segmentation 拆包、CSS 拆为 10 个文件、部分控制器提取、色板和分区卡片缓存、Vitest 引入。不要把这些再列为待开发工作。

本次验证：

- `npm test`：8 个文件、46 个测试全部通过。
- `npm run build`：TypeScript 检查和 Vite 生产构建通过。
- 额外诊断脚本复现下述 7 类问题。脚本在 Node 中调用真实业务代码；ZIP 案例使用 Canvas 替身记录渲染输入；保存失败和 PNG 编码失败使用故障注入。
- 未执行真实浏览器端到端测试、真实 ZIP 渲染图的解码比对、性能基准或视觉验收。因此不把静态代码观察直接当作浏览器实测结果。

严重级别：P1 为状态损坏、数据不一致或错误成功提示，应优先修复；P2 为输入校验和异常流程缺口。本次未发现必须定为 P0 的问题。

## 2. 已复现的问题

### B1 · P1：透明像素的遮罩规则不一致，存档往返改变数据

位置：`src/command/pixelCommands.ts:99`、`src/core/editOps.ts:75`、`src/core/storage.ts:47`。

两条独立路径：

1. 将前景色选成 255，使用左键画笔覆盖头发像素：只写透明像素，未清除头发遮罩。右键透明绘制和橡皮则会尝试清除遮罩。
2. 锁定头发后使用橡皮或清空选区：编辑代码刻意保留锁定遮罩；但读档代码强制把所有透明像素的遮罩设为 Background。

两者的实际结果都是：像素为 `255`，保存前遮罩为 `1`，读取相同存档后遮罩为 `0`。工程 ZIP 和自动保存共用该转换，所以都受影响。现有 `editOps` 测试还明确断言锁定遮罩应保留，说明当前系统内部存在规则冲突。

建议先确定规则优先级并集中实现。优先建议采用当前导入层声明的「透明像素只能属于背景」规则，在透明写入时同步归背景；这会改变锁定分区擦除后的既有行为，需要明确记录并调整相应测试。如果产品要保留透明位置的手工遮罩，则必须改成允许该状态、取消读档时的无条件丢弃，并检查预览与统计。两种规则都能实现，但编辑与存档必须一致。

验收：画笔、右键、橡皮、油漆桶、替色、删除、剪切、移动操作遵守同一规则；对合法文档做 encode/decode，像素与遮罩逐字节一致。

### B2 · P1：锁定目标分区可以被智能框选和按色划入修改

位置：`src/command/maskCommands.ts:37`、`:80`；对照 `src/command/pixelCommands.ts:129`。

复现：载入一个 Skin 像素，选中 Hair 并锁定 Hair，再分别执行遮罩画笔、智能框选 add、按颜色一键划入。

实际：画笔保持 Skin (`2`)，框选和一键划入却写成 Hair (`1`)。原因是后两条路径只检查像素当前分区是否锁定，漏检目标分区；油漆桶的纯函数路径已经检查目标锁。

建议将 `canAssignZone(current, target, policy)` 下沉为共享规则，画笔、油漆桶、框选和按色划入共同调用。避免在每个命令里重新实现一份锁判断。

验收：四种工具对锁定来源和锁定目标的处理一致；无变化不入历史、不报成功数量。

### B3 · P1：活动笔划缺少事务边界，撤销及换工程会混入旧快照

位置：`src/app/viewModel.ts:185`、`:649`、`:678`、`:749`；`src/command/commandHandler.ts:31`。

笔划从 begin 到 end 期间已经直接修改文档，但尚未进入历史。此时 `undo()` 可以恢复其它命令的完整快照；文档替换也只清历史，没有丢弃活动笔划。

复现 A：先完成第 1 笔；开始第 2 笔但不松手；撤销；继续绘制并结束第 2 笔；再次撤销。第 1 笔会从第 2 笔的 before 快照重新出现。

复现 B：旧工程的活动笔划尚未结束时载入新工程，然后 endStroke、undo。新工程明明刚清过历史，却出现可撤销命令，撤销会恢复旧工程数据。诊断中，新工程首像素 `8` 被恢复成旧工程的 `5`。

建议设立统一的手势事务管理：历史操作之前先结束当前笔划；换工程时先丢弃旧手势；手势记录 document generation，过期结束事件不能提交。模式切换、弹窗和其它文档命令也通过同一入口处理活动手势。

验收：笔划中 undo/redo、变换、载入、重置均不会复活旧数据；普通笔划仍只占一步历史。

### B4 · P1：自动保存失败仍报告保存成功

位置：`src/core/storage.ts:67`、`:79`；`src/panels/Header.ts:122`。

复现：注入一个 `setItem()` 抛异常的存储适配器，触发保存并等待 300 ms。

实际：异常仅写入 console，随后仍调用 onSaved。顶栏会显示「已自动存盘」，实际数据没有写入。

建议让保存返回明确的成功/失败结果，增加 failed 状态；只在写入成功后报告 saved。将防抖计时器和存储适配器从模块全局变量改为每个编辑器实例拥有的 AutosaveService，提供 flush/cancel/dispose。页面离开前处理待保存数据；没有存储后端时也不能默认为成功。

验收：配额不足、存储禁用、正常写入分别显示正确状态；失败后的下一次正常编辑能恢复保存；重置取消待保存任务。

### B5 · P2：工程校验接受未知发色预设

位置：`src/core/projectData.ts:104`；消费方 `src/app/controllers/HairDraftController.ts:116`。

复现：合法工程的 hairPreset 改为 `not-a-preset`，`validateProjectData()` 仍返回 valid=true。UI 不能匹配相应发色卡或下拉项，发色色阶查询返回空列表。

建议校验 hairPreset 必须为 null 或已知 key；旧格式兼容若需要降级为 null，应显式返回警告。类型采用 `HairPresetKey | null`，把 unknown 解析集中在 codec 边界。

验收：9 个合法预设、null、未知字符串、错误类型都有明确结果；持久化键名和 ZIP 根文件名保持兼容。

### B6 · P1：PNG 导出未等待异步结果，失败时仍提示成功

位置：`src/app/controllers/ExportService.ts:7`；`src/core/zipExporter.ts:230`。

复现：令 PNG 的 CompressionStream 构造抛异常，再调用 vm.exportPng。

实际：立即出现「已导出」通知，同时发生未处理的 Promise rejection。ZIP 导出已有 await/try-catch，但 PNG 路径遗漏。

建议两条导出流程都返回 Promise，统一 awaiting、错误处理和状态通知。成功提示只在编码和下载触发都完成后发出；这仍只代表触发下载，不能宣称文件已落盘。

验收：PNG 成功后通知；编码失败或 downloader 抛错时只报失败，无 unhandled rejection；取消发色确认不导出。

### B7 · P1：ZIP 内文件可能来自不同文档状态

位置：`src/core/zipExporter.ts:241`。

导出入口先序列化工程 JSON，随后跨多个 await 从同一可变 doc 读取像素、遮罩和色板。导出过程中编辑或换工程，会造成包内材料不一致。

复现：首像素设为色板索引 `1`，开始生成 ZIP，立即改为 `2`。包内 JSON 首像素仍为 `1`，Canvas 替身记录到 1x 渲染图的首像素却来自索引 `2`。真实 PNG 编码和 ZIP 打包均使用生产代码；替身仅记录 Canvas 输入，不验证浏览器 PNG 渲染本身。

建议在任何异步处理开始前深拷贝 palette、pixels、mask、hairPreset，所有包内文件共同读取一个 ExportSnapshot。快照成本很低，导出期间可以继续编辑。

验收：延迟编码/Canvas 回调，导出时继续画图、改色板、换工程；解码包内 PNG、渲染图、遮罩与 JSON，逐项匹配导出开始时的同一快照。

## 3. 结构问题与待验证项

### 已确认的结构缺口

- 控制器都接收完整 ViewModel，并通过新增公共 getter、patchSession、replaceDocumentInternal 回调它。文件变小了，但依赖权限仍然很宽，ViewModel 仍有 787 行。用窄接口消除控制器对整台编辑器的隐式依赖，比继续追求行数目标更有用。
- `core/zipExporter.ts` 和 `core/pixelRender.ts` 仍创建 DOM；ViewModel 的导出依赖链因此仍包含浏览器实现。`app/utils/download.ts` 已有抽取的下载函数，但 zipExporter 仍保留自己的副本，且新函数没有接入。
- `core/storage.ts` 的存储适配器和防抖计时器是模块全局，多个实例互相影响；project codec 又依赖这个含存储副作用的模块。
- MaskToolsPanel 的匹配色块每次 render 都清空重建，颜色列表改变时仍整段 innerHTML 重建；SelectionStatsPanel、HoverInfoBar 也继续使用 innerHTML。PalettePanel/MaskPanel 的缓存已落地，不应重复改造。当前没有性能数据，不能直接断言存在明显卡顿。
- 面板注册监听后缺少通用 dispose，App/CanvasPanel 有匿名全局监听，SelectionInteraction.dispose 尚未纳入统一生命周期。
- 测试主要覆盖纯函数、历史基本操作和模式切换；缺少文件往返、保存错误、活动手势交错及 UI 路径测试。segmentation 的两个测试不足以证明真实头像分割质量。
- `tsconfig.json` 仅 include src，构建不会类型检查 tests；部分模式测试使用 any，且构造了透明像素上有 Hair 遮罩的夹具，容易掩盖规则冲突。
- V3 文档声称全部实施完成，但 core DOM 迁移和部分 DOM 增量刷新并未完成，测试数也已变化。应更新实施状态和 README 目录，避免下一轮照着过时清单重复工作。

### 需要浏览器用例确认

- CanvasPanel 的 blur 仅结束空格模拟的笔划，普通鼠标笔划和中键平移未显式结束。若在窗口外松手且浏览器不补发 mouseup，可能恢复后继续绘制或平移。
- 全局快捷键和 CanvasPanel 的修饰键/空格处理分散；ConfirmModal 有 App 层保护，但缺少统一焦点管理。CanvasPanel 会先 preventDefault 空格，可能影响弹窗按钮的键盘激活。
- 隐藏最后一个遮罩时先改 visibleMaskZones，再询问是否切换模式；选择「继续试色」不会回滚显隐变化。需要定义取消操作是否应保持全部原状态。
- `stampPatch`、flip 和 rotate 对分区锁的处理不同于 mask 工具。旋转的注释明确标记“不遵守分区锁”；不能在尚未定义变换锁策略前，把所有差异都视为同一种 bug。
- 多次异步图片/ZIP 导入没有 request generation 或取消机制，完成顺序可能覆盖用户最新选择。用延迟解码夹具和浏览器交互验证。

## 4. 重构执行顺序

| 阶段 | 改动与交付 | 验收门槛 | 粗估 |
| --- | --- | --- | --- |
| 0：建立针对性基线 | 把 B1–B7 转成正式回归用例；增加合法文档夹具、往返断言、导出延迟与失败注入；为测试增加独立 typecheck 配置 | 用例能捕获现状缺陷，现有 46 个测试仍可运行；明确 B1 的规则选择 | 0.5–1 人日 |
| 1：规则与手势修复 | 统一遮罩写入/锁规则；透明规则覆盖所有写入路径；加入手势 begin/commit/cancel 与文档 generation；历史和换工程接入统一事务入口 | B1/B2/B3 通过；40 步历史、合并、无变化不入栈仍正确 | 1.5–2.5 人日 |
| 2：文件与持久化可靠性 | B4/B5/B6/B7；独立 codec；实例级 AutosaveService；异步导出状态处理；ExportSnapshot；导入顺序保护 | 保存失败可见，编码无未处理异常；ZIP/自动保存往返一致；旧工程格式兼容 | 1.5–2.5 人日 |
| 3：收紧应用边界 | 控制器依赖窄端口；App 负责注入 BrowserStorage、Canvas/ImageDecode、Downloader；core 保留纯数据算法、codec、PNG 编码；ZIP 渲染和下载移入浏览器基础设施 | 领域代码在 Node 下可运行；无需 DOM 的测试无需全局浏览器替身；公共业务入口保持稳定 | 1–2 人日 |
| 4：整理交互与刷新 | 统一输入/手势控制；加入 pointercancel/blur；App/Panel/交互对象统一 dispose；按事件来源过滤刷新；仅对反复重建且影响交互的 DOM 做节点复用 | 浏览器手势中断、弹窗键盘、选区拖动可回归；实例销毁后无监听/定时器残留 | 1–2 人日 |
| 5：文档与浏览器回归 | 更新 README、V3 实施状态与规则说明；固定样例头像与 ZIP；补端到端关键操作链；做一次性能采样 | test、test typecheck、build、浏览器回归通过；数据文件与界面结果一致 | 0.5–1 人日 |

总粗估 6.5–11 人日，按一位熟悉项目的开发者计算，非承诺工期；浏览器边界问题与规则决策会影响范围。最先完成阶段 0–2，结构整理可随后独立推进。每个可独立验收的修复单独提交，避免把行为变化和大规模文件迁移放进同一提交。

## 5. 目标依赖形态

```text
App 组装依赖
  ├─ BrowserStorage → AutosaveService
  ├─ BrowserImageDecoder → ImportCoordinator → ImportPipeline
  ├─ BrowserCanvasEncoder + Downloader → ExportService
  └─ ViewModel → CommandHandler + GestureTransaction
                  ↓
             Document / Session

core: editOps、color、segmentation、recolor、projectCodec、indexedPng
panels: 输入意图、DOM 组件、CanvasRenderer
```

控制器端口按需要划分，例如 SelectionService 只获得只读文档、必要的会话读取、executeCommand 和 setSelection；ImportPipeline 改为输入 DecodedImage + palette、返回新文档与导入信息的纯函数；导出只取得快照、编码器和下载器。不要创建一个等同于完整 ViewModel 的“大接口”来形式化解耦。

事件按每次操作的真实变化发出，避免像素油漆桶仅改颜色时也无条件发 onMaskChanged。统计缓存按像素/遮罩/色板 revision 失效，不按任意 session 改动重新扫描；4096 像素全量 Canvas 重绘继续保留，除非测量证明需要其它方式。

本轮保留原生 TypeScript 和快照命令，不引入框架、状态库或 Web Worker。segmentation 已拆包，先补代表性头像夹具和输出回归，再考虑改变算法。

## 6. 诊断脚本运行与结果

从项目根目录运行；使用仓库当前已有的 esbuild，不添加依赖：

```bash
node --input-type=module -e "import { build } from 'esbuild'; await build({entryPoints:['docs/review/reproduce-bugs.ts'],bundle:true,platform:'node',format:'esm',outfile:'/tmp/portrait-studio-review.mjs'});"
node /tmp/portrait-studio-review.mjs
```

脚本使用内存/故障存储替身，不访问用户 localStorage；ZIP 在内存生成，未触发下载。它是审查诊断，不是已通过的修复测试；修复完成后应将期望行为编写成正式 Vitest 断言。

本次输出：

```text
B1-transparent-pen-roundtrip {"pixel":255,"maskBefore":1,"maskRestored":0}
B1-locked-erase-roundtrip {"pixel":255,"maskBefore":1,"maskRestored":0}
B2-locked-target {"pen":2,"box":1,"assign":1}
B3-undo-during-stroke {"afterUndo":[255,255,255],"afterUndoStroke":[1,255,255]}
B3-document-replaced-during-stroke {"canUndo":true,"firstPixelAfterUndo":5}
B4-save-failure-reported-success {"onSaved":true,"warnings":["LocalStorage save failed:"]}
B5-invalid-preset-validation true
B6-png-failure {"notices":["💾 已导出纯净 8-bit 索引 PNG 头像"],"rejections":["simulated encoder failure"]}
B7-zip-mixed-revisions {"jsonPixelIndex":1,"renderFirst":[8,8,33,255],"expectedSavedRgba":[255,255,255,255]}
```
