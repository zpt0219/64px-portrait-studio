# Gemini 实现审查与返工清单

审查日期：2026-10-03。基线：`32280f8`。范围：当前工作区中 Gemini 的未提交修改，对照 `GEMINI_FLASH_IMPLEMENTATION_GUIDE.md` 的原始任务与验收标准。

## 结论

**暂不能按“全部完成”验收。** 构建和现有测试通过，但原 B3 仍可复现，另有新的遮罩填充回归。自动保存实例隔离、过期确认隔离和生命周期保护也没有完成。

本轮只审查，未修复业务实现。新增本报告和诊断脚本，便于再次交给 Gemini。以下 P1 应优先修复，P2 应在本次重构验收前补齐。

## 已执行的验证及其边界

| 检查 | 本轮结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run typecheck:tests` | 通过 |
| `npm test` | 19 个文件、133 个测试通过 |
| `npm run build` | 通过 |
| `git diff --check` | 通过 |
| 原 B1–B7 诊断 | 临时适配新 codec 返回值、保存回调后重跑；B3 两条路径失败，其余原诊断路径通过 |
| 本轮新增诊断 | 下列 R1–R7 的关键路径均用真实业务方法和内存存储/DOM 替身复现 |
| 真实浏览器集成、实际 ZIP 内 PNG 解码 | 本轮未执行，不计为通过 |

现有历史诊断脚本 `docs/review/reproduce-bugs.ts` 未同步 `projectDataToDocument()` 的新返回结构，直接执行会在 B1 报错；其 B4 回调也没有读取 `result.success`。本轮使用临时副本适配接口，没有修改该历史脚本。

## R1 · P1：活动笔划事务未实现，旧快照仍能污染历史和新文档

位置：`src/app/viewModel.ts:245–258`、`:740–773`、`:840–845`；`src/panels/canvas/CanvasPanel.ts:98–102`。

`undo/redo` 没有先提交活动笔划，`replaceDocument` 没有在替换前作废笔划，`beginStroke` 可以直接覆盖旧笔划。`executeCommand` 也没有统一结束活动手势。Canvas 清除了自己的鼠标标志，却没有同步清除 ViewModel 内的 `stroke`，无法建立事务边界。

复现一：完成像素 0 写颜色 1 的笔划；开始第二笔，在像素 1 写颜色 2；不松手调用 undo；继续 dab，end；再 undo。实际第一次 undo 后前 3 像素为 `[255,255,255]`，第二次 undo 后为 `[1,255,255]`。已撤销的第一笔被旧快照恢复。

复现二：旧工程首像素为 5，活动笔划期间载入首像素为 8 的新工程；调用旧 endStroke，再 undo。实际 `canUndo=true`，新工程首像素被还原为旧工程的 **5**。期望无旧历史，始终为 **8**。

返工：严格实施原指南 **T04**，统一命令入口；笔划、文档使用 generation/token；换图前作废；undo/redo 和其他命令前结束笔划；复制 selection/lockedZones 参数；begin 不覆盖未结束笔划。同步 Canvas 中断行为。

必须新增 ViewModel 集成断言：笔划中 undo/redo、笔划中 flip、换图后旧 dab/end、重复 end、换色/换工具。`tests/gestureHistory.test.ts` 当前只测色板命令合并，不能替代这些测试。

## R2 · P1：旧确认仍能清空后来载入的新工程

位置：`src/app/viewModel.ts:298–317`；`src/app/app.ts:124–126`。

清空确认的按钮直接调用当前 ViewModel 的 reset，没有捕获文档身份。文档替换后，App 仅取消导入请求，没有使旧确认失效。

可发生的用户路径：在已载入工程 A 中启动异步导入 B；B 仍在解码时打开清空确认；B 返回并替换文档；点击旧确认的“清空画布”。本轮调用相同方法序列后，新图首像素 8 变为 255，`isLoaded=false`。

返工：文档替换时使旧确认失效并关闭；回调执行前核对创建时的 generation，过期则取消。该规则也应用于发色、模式切换、历史与导出确认。ExportService 当前确认后直接 captureDocument，同样缺少原指南 §2/T05 要求的过期检查。

验收：延迟导入返回后点击旧清空/发色/导出按钮，不清新图、不应用旧请求、不导出新图；取消的导出 Promise 正常结束。

## R3 · P1：存储受限仍可中断 App 初始化

位置：`src/app/app.ts:172–176`、`:202`。

列宽读取/写入直接访问全局 localStorage，没有异常保护。即使工程存储层捕获了 SecurityError，App 构造时 `setupSplitterDragging()` 仍会抛错，后续快捷键等初始化无法完成。

本轮给 localStorage 属性注入抛出 SecurityError 的 getter，调用实际 `setupSplitterDragging()`，异常直接逸出。这是故障注入验证，不是真实浏览器端到端测试。

返工：通过安全浏览器存储适配器读取列宽，异常时使用默认宽度；写入失败不阻断界面。新增 App 初始化层面的受限存储测试，不能只测试 `core/storage.ts`。

## R4 · P2：新的遮罩油漆桶在起点已属于目标分区时整次失效

位置：`src/core/editOps.ts:243–244`。

新增起点检查使用 `canAssignZone`。该函数在 currentZone 与 targetZone 相同时返回 false，因此 BFS 尚未遍历就退出。起点无需改写，并不表示相邻同色区域都无需改写。

复现：相邻两个不透明像素的颜色都为 5，遮罩分别为 Hair 和 Skin，无锁；从 Hair 像素向 Hair 填充。实际返回 false，相邻像素仍为 Skin(2)；期望相邻像素变为 Hair(1)。从已是 Background 的点擦除相邻同色遮罩也会遭遇同类问题。

返工：区分“允许遍历”与“实际需要改写”；起点只检查越界、透明政策、源/目标锁等条件，允许穿过已是目标分区的同色点。保留逐点赋值策略。

验收：添加上述 Hair/Skin 及 Background 擦除案例，并确认锁定分区依旧不能改写或穿越。

## R5 · P2：自动保存仍为全局状态，缺少页面退出 flush

位置：`src/core/storage.ts:35–45`、`:73–96`；`src/app/viewModel.ts:143–147`。

`activeStore`、`debounceTimer`、`pendingDoc` 和回调仍在模块全局，两个 ViewModel 的 schedule 会互相覆盖，dispose 也会 flush 另一个实例的内容。

本轮创建首像素分别为 5/8 的 A/B 两个实例，依次修改色板，然后 dispose A。实际只保存了 B（首像素 8），A 状态停在 saving，B 变为 saved。这未满足原指南 T06 的实例隔离要求。

另外，src 内没有 pagehide/visibilitychange 的 flush 注册。编辑后 300ms 防抖尚未到期便刷新或离开页面，最后一次修改没有主动落盘机会；`App.dispose()` 不会由浏览器自动调用。

返工：实现按实例注入的 AutosaveService 与 store/key；增加 cancel/flush/dispose，绑定 pagehide、hidden 的 flush；处理 get/remove 失败、旧 generation 回调。无 IO 的适配器不得报告保存成功。

验收：两个实例独立 timer/store；299ms 不写、300ms 写一次；dispose A 不保存 B；pagehide/hidden flush；clear/get/set 各种故障返回可读失败状态；换图/重置无迟到写入。

## R6 · P2：销毁后仍可修改文档

位置：`src/app/viewModel.ts:459–461`，其他直接调用 handler 的入口及 beginStroke/loadProject 也需审查。

新增 executeCommand 的 `_isDisposed` 检查没有覆盖所有写入路径。setPaletteColor 仍直接 handler.execute。

复现：`vm.dispose(); vm.setPaletteColor(0, '#123456')`。实际颜色从 `#000000` 变为 `#123456`。事件扇出被屏蔽只能让 UI 不收到通知，不能阻止状态变化。

返工：所有文档/会话写入口统一保护；dispose 同时作废活动手势与异步 token。不能只通过“监听器没有被调用”来断言对象没有变化。

验收：dispose 后命令、stroke、load/import、历史、旧确认回调均不能改变 doc/session/history，不能发起 IO；重复 dispose 无副作用。

## R7 · P2：替换已打开的确认没有取消旧请求

位置：`src/panels/modals/ConfirmModal.ts:77–81`；`src/app/controllers/ExportService.ts:30–44`。

show 直接覆盖 currentOptions，未调用旧 onDismiss。本轮先 show 带 onDismiss 的确认，再 show 新确认，旧回调调用次数仍为 0。

PNG/ZIP 导出等待确认时，只在 proceed 或 cancel 分支 resolve。如果该确认被另一个确认替换，原导出 Promise 会永久挂起。当前 show 也没有移入焦点/Tab 范围控制，背景按钮仍可能经键盘触发第二个确认；不能依赖遮罩阻止鼠标点击来保证单一请求。

返工：明确选择排队或替换取消；替换必须恰好一次结束旧请求。实现原指南 T08 的移入焦点、Tab 限制、关闭恢复焦点和统一弹窗输入守卫。

验收：替换确认、Esc、遮罩关闭、dispose 都结束旧导出 Promise；按钮的确认与取消回调不重复触发；真实浏览器验证 Tab/Shift+Tab/Enter/Space/Esc。

## 实施报告与测试证据需要纠正

1. 原指南 **T04 是活动手势事务，T05 是导出，T06 是实例自动保存**。进度表改了任务映射，并用色板合并测试宣称 B3 完成；应恢复原任务编号逐项核对。
2. `IMPLEMENTATION_PROGRESS.md:59–73` 将浏览器冒烟全标“自动化通过”，但明确未执行真实浏览器。第 6 项没有 ViewModel 笔划事务测试，第 8 项 lifecycle 测试验证 dispose，不验证焦点。应把单元证据和未执行的浏览器项目分开列。
3. `tests/zipExporter.test.ts` 的 Canvas 返回固定字符串 `mock-blob-png`，快照案例只检查 JSON，没有记录/核对渲染输入。原 B7 恰是 JSON 与渲染版本不一致，仅 JSON 断言抓不住这个回归。本轮适配历史诊断后的 Canvas 输入对照通过，但仍未验证实际 PNG 解码。
4. T07 只完成部分端口改造；`core/storage.ts` 仍管理浏览器存储，`core/zipExporter.ts` 仍管理 Canvas/下载，ExportService 仍直接依赖该实现，没有完成指南要求的 App 组装注入边界。
5. 不应继续使用“全部完成”的结论。将实现状态、单元验证、真实浏览器验收分别报告，未执行项如实标注。

## 已改善的内容

原 B1 透明写入/擦除会清背景遮罩，原 B2 目标锁规则基本统一；原 B4 配额失败正确返回失败；原 B5 非法发色预设被拒绝；原 B6 PNG 编码异常有错误通知且无未处理拒绝；原 B7 ZIP 导出入口深拷贝快照。本轮对应的原诊断路径通过，仍应补足上述测试覆盖。

新增 ImportCoordinator 的顺序隔离、纯图像处理入口、部分 Panel/Toaster 生命周期清理和 DOM 缓存可保留。返工优先修可靠性，无需整体重写。

## 给 Gemini 的执行顺序

1. 先为 R1/R2 写能在当前代码上失败的断言，再修笔划事务与文档 generation。
2. 修 R3/R4，加入 App 初始化故障和油漆桶邻域测试。
3. 完成 R5/R6/R7，补实例保存、销毁后状态不变、确认替换/焦点测试。
4. 补 T07 边界与 ZIP 渲染/实际文件验证；按真实能力执行浏览器验收，不能用假 PNG 或 DOM 替身代替。
5. 最后重跑两个 typecheck、完整测试、build、diff-check，更新原编号的实施表；每个修复注明证据与仍未验证项。

## 运行本轮诊断

在仓库根目录执行以下两个命令。使用已有 esbuild，不需要安装依赖；输出在 `/tmp`，不修改浏览器的 localStorage。

```bash
node --input-type=module -e "import { build } from 'esbuild'; await build({entryPoints:['docs/review/reproduce-gemini-review.ts'],bundle:true,platform:'node',format:'esm',outfile:'/tmp/portrait-gemini-review.mjs'});"
node /tmp/portrait-gemini-review.mjs
```

诊断目前打印 8 组结果：stroke-undo、stroke-load、flood-start-target、disposed-palette、global-autosave、stale-reset、modal-replaced、storage-startup。它打印实际值，不代表测试通过；应把目标行为转化为正式的失败断言后修复。
