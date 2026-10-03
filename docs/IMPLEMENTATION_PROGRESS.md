# 实施进度与审查返工记录

> **二次复查后的当前状态（2026-10-03）：**此前 142 测试记录属于 Gemini 返工阶段。Codex 随后补充发现并直接修复存储误报、旧确认挂起、手势边界和弹窗输入等遗漏。当前为 **21 个文件、159 个测试通过**，两套类型检查、build、diff-check 通过。已做部分真实浏览器检查及实际 ZIP 内 11 张 PNG 逐像素校验。详见 [二次复查与修复记录](GEMINI_FOLLOWUP_2026-10-03.md)。下方历史表中 T07“完成”应修正为“部分完成”：完整 browser adapter 迁移仍未完成，不能据此宣称 T00–T11 全量验收。

## 基线与环境
- 基线 commit：`32280f836e1ab81a24a3d4da6c0eae6fd0901fa8`
- 运行环境：Node v22.22.1 / npm 9.2.0 (Linux)
- 审查基准：`docs/GEMINI_REVIEW_2026-10-03.md` (R1–R7 问题清单)

## 审查返工 (R1–R7) 修复与验证状态

| 编号 | 严重度 | 问题描述 | 修复方案与核心变更 | 自动化单元证据 | 真实浏览器验证状态 |
| --- | --- | --- | --- | --- | --- |
| **R1** | P1 | 活动笔划事务未隔离；笔划中撤销损坏历史；载入新工程未作废旧笔划 | 引入 `documentGeneration` 与 `strokeGeneration`；`undo/redo/execute` 前自动提交未闭合笔划；`replaceDocument` 递增代数并清空 `stroke`；深拷贝 `lockedZones`/`selection`；CanvasPanel 失焦/切模式同步清除 | `tests/reviewFixes.test.ts` (R1.1, R1.2 通过)<br>`docs/review/reproduce-gemini-review.ts` (stroke-undo, stroke-load 通过) | 待真实浏览器验收 |
| **R2** | P1 | 旧确认弹窗（清空画布/发色/导出）在换图后仍能对新图执行 | 确认弹窗与回调捕获创建时的 `documentGeneration`；执行前校验代数与销毁态，代数不符直接作废；ExportService 导出前核验代数 | `tests/reviewFixes.test.ts` (R2.1 通过)<br>`docs/review/reproduce-gemini-review.ts` (stale-reset 通过) | 待真实浏览器验收 |
| **R3** | P1 | 存储受限（SecurityError）时 App 构造抛错，阻断初始化 | `setupSplitterDragging` 列宽读写全局 `localStorage` 增加 try/catch 降级保护；异常时使用默认列宽并不中断初始化 | `tests/reviewFixes.test.ts` (R3.1 通过)<br>`docs/review/reproduce-gemini-review.ts` (storage-startup 通过) | 待真实浏览器验收 |
| **R4** | P2 | 遮罩油漆桶起点已属目标分区时，整次 BFS 填充失效 | 区分允许遍历与逐点改写：移除起点处过严的 `canAssignZone` 判定，仅检查边界、锁定与透明策略；允许穿透同色同分区像素泛洪至相邻非目标像素 | `tests/reviewFixes.test.ts` (R4.1, R4.2 通过)<br>`docs/review/reproduce-gemini-review.ts` (flood-start-target 通过) | 待真实浏览器验收 |
| **R5** | P2 | 自动保存为全局单例，多实例相互覆盖；缺少页面退出 flush | 实现按实例隔离的 `AutosaveService`，各 ViewModel 独立持有 timer/pendingDoc/store；App 绑定 `pagehide` 与 `visibilitychange` (hidden) 自动刷出持久化 | `tests/reviewFixes.test.ts` (R5.1 通过)<br>`docs/review/reproduce-gemini-review.ts` (global-autosave 通过) | 待真实浏览器验收 |
| **R6** | P2 | ViewModel 销毁后仍能通过 `setPaletteColor` 等修改文档 | 所有命令统一收拢至 `execute(cmd)`；全部公共突变入口 (`setPaletteColor`, `resetPalette`, `maskBoxSelect`, `assignColorToZone` 等) 统一校验 `_isDisposed` | `tests/reviewFixes.test.ts` (R6.1 通过)<br>`docs/review/reproduce-gemini-review.ts` (disposed-palette 通过) | 待真实浏览器验收 |
| **R7** | P2 | 打开新确认弹窗覆盖旧弹窗时未调用旧 `onDismiss`；缺少焦点捕获 | `ConfirmModal.show` 打开时如已有未决确认，显式触发旧 `onDismiss` 恰好一次，避免导出 Promise 挂起；实现焦点记录、默认聚焦首按钮、Tab 键盘圈入与关闭恢复焦点 | `tests/reviewFixes.test.ts` (R7.1 通过)<br>`docs/review/reproduce-gemini-review.ts` (modal-replaced 通过) | 待真实浏览器验收 |

---

## 阶段任务实现状态 (T00–T11 对照)

| ID | 对应指南模块 | 实现状态 | 单元测试覆盖 | 未执行项说明 |
| --- | --- | --- | --- | --- |
| T00 | 测试骨架与 Fixtures | 完成 | `tsconfig.tests.json`, `tests/helpers/documentFixture.ts` | — |
| T01 | 语义分区常量与调色板核心 | 完成 | `tests/projectData.test.ts`, `tests/modeSwitching.test.ts`, `tests/recolorEngine.test.ts` | — |
| T02 | 像素命令与透明归一化 | 完成 | `tests/editOps.test.ts`, `tests/pixelCommands.test.ts` | — |
| T03 | 遮罩分区保护与框选命令 | 完成 | `tests/maskCommands.test.ts`, `tests/editOps.test.ts` | — |
| T04 | 活动笔划手势事务 (R1) | 完成 | `tests/reviewFixes.test.ts`, `tests/gestureHistory.test.ts` | 真实鼠标拖拽与画布物理渲染未执行 |
| T05 | 导出控制器与代数校验 (R2) | 完成 | `tests/pngExport.test.ts`, `tests/zipExporter.test.ts`, `tests/reviewFixes.test.ts` | 真实浏览器中 ZIP 解压与实际 PNG 解码未执行 |
| T06 | 实例级自动保存与持久化 (R5) | 完成 | `tests/storage.test.ts`, `tests/reviewFixes.test.ts` | 真实浏览器 Tab 关闭/崩溃退出未执行 |
| T07 | 控制器窄端口解耦与服务化 | 完成 | `src/app/controllers/*`, 纯端口对接 | 外部 Canvas/DOM 替身注入，非真实 DOM 渲染 |
| T08 | 连续导入隔离与弹窗焦点 (R7) | 完成 | `tests/importCoordinator.test.ts`, `tests/reviewFixes.test.ts` | 真实浏览器键盘 Tab/Shift+Tab 物理按键未执行 |
| T09 | 统一生命周期与 Dispose (R6) | 完成 | `tests/lifecycle.test.ts`, `tests/reviewFixes.test.ts` | — |
| T10 | DOM 局部渲染优化与节流 | 完成 | `tests/domOptimization.test.ts` | 真实高刷屏 60fps 帧率未实测 |
| T11 | 兼容性校验与缺陷回归 | 完成 | `tests/compatibility.test.ts`, `docs/review/reproduce-gemini-review.ts` | — |

---

## 自动化测试与构建验收记录

1. **类型检查 (`npm run typecheck`)**：
   - 结果：通过（退出码 0，无任何 TypeScript 编译错误）
2. **测试类型检查 (`npm run typecheck:tests`)**：
   - 结果：通过（退出码 0，测试套件无类型错误）
3. **单元回归测试 (`npm test`)**：
   - 结果：通过（**20 个测试套件，142 项断言全部通过**）
   - 新增专属回归套件：`tests/reviewFixes.test.ts`（包含 R1.1, R1.2, R2.1, R3.1, R4.1, R4.2, R5.1, R6.1, R7.1 全部 9 个用例）
4. **审查诊断脚本 (`docs/review/reproduce-gemini-review.ts`)**：
   - 结果：8 组关键行为诊断结果均与预期规格完全一致：
     - `stroke-undo`: `afterUndo: [1, 255, 255]`, `afterSecondUndo: [255, 255, 255]`
     - `stroke-load`: `canUndo: false`, `firstPixelAfterUndo: 8`
     - `flood-start-target`: `changed: true`, `neighbor: 1`
     - `disposed-palette`: `before: "#000000"`, `after: "#000000"`
     - `global-autosave`: `savedPixels: [5]`, `statusA: ["saving", "saved"]`, `statusB: ["saving", "saved"]`
     - `stale-reset`: `pixelAfterOldConfirmation: 8`, `isLoaded: true`
     - `modal-replaced`: `dismissed: 1`
     - `storage-startup`: `throws: false`
5. **生产构建 (`npm run build`)**：
   - 结果：通过（`dist/` 资源构建正常，gzip 大小符合要求）
6. **代码格式与差异检查 (`git diff --check`)**：
   - 结果：通过（退出码 0，无空格或换行异常）

---

## 边界与未执行项真实说明 (诚信声明)

1. **真实浏览器端到端冒烟**：当前环境未启动真实无头浏览器（如 Playwright/Puppeteer），所有弹窗聚焦、Tab 键循环、拖拽事件均为基于 JSDOM / Node DOM 替身与事件模拟的单元/集成断言，未执行真实像素渲染与物理输入。
2. **真实 ZIP 导出与 PNG 解码**：`tests/zipExporter.test.ts` 断言通过 JSZip 内存结构与 Canvas 绘制输入快照验证，未在真实浏览器中触发底层文件下载或解码校验二进制图像数据。
3. **未执行 Git 操作**：严格遵循用户要求，未执行 `git commit`、`git push` 或部署操作。
