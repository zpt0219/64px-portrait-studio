# 二次复查与直接修复记录

日期：2026-10-03。范围：Gemini 对第一次审查 R1–R7 的返工，以及沿这些路径发现的遗漏。本轮直接修复代码，没有再移交 Gemini。

## 结果

Gemini 版本的 20 个测试文件、142 个测试全部通过，原 R1 笔划中撤销/换图、R3 列宽存储异常、R4 油漆桶起点等已修复。但补充真实调用路径后，首批 13 个用例全部失败，证实仍有遗漏。

本轮修复后：**21 个文件、159 个测试通过；两套类型检查、生产构建和 diff-check 通过。** 原 B1–B7 与 R1–R7 诊断脚本均已重跑。真实浏览器使用独立端口导入合成工程，完成部分交互与实际导出校验。

## 本轮修复

| 问题 | 修复与验证 |
| --- | --- |
| 默认 localStorage 适配器吞掉 quota/security 异常，仍返回保存成功；无存储也误报成功 | 默认写入让错误传至 AutosaveService，统一转换为失败结果；用真实默认适配器注入配额异常/无存储测试 |
| 删除缓存失败却提示“已清除” | clear 返回结果，先取消防抖；画布仍能重置，缓存删除失败则准确提示警告 |
| 实例计时器独立，但 store 仍跟随全局适配器切换 | ViewModel 创建时捕获 store；验证 A/B 两个适配器分别保存各自实例 |
| 换图/销毁屏蔽旧确认回调，却未结束旧导出等待 | ViewModel 管理待确认的取消回调，替换/销毁时取消并关闭界面；过期按钮不能执行，取消仍能释放等待；PNG/ZIP × 换图/销毁四种路径覆盖 |
| dispose 后还能发起 PNG/ZIP/Mask 导出 | 三个入口拒绝已销毁对象，ExportPorts 的 isLoaded 同时检查生命周期 |
| 换色、开弹窗、导出时未结束活动笔划 | 在会话参数变化、模式切换、确认、导出和保存 flush 前结束笔划；保持命令入口的提交边界 |
| Esc 关闭确认后继续触发 App 快捷键，原选区被清除 | 确认弹窗在 capture 阶段处理取消；App 忽略已被消费的按键；单元断言及真实浏览器验证选区保留 |
| 颜色替换弹窗没有接管/恢复焦点，Tab 能跑出弹窗；聚焦取消按钮时 Enter 也可能执行替换 | 增加焦点恢复和 Tab 范围；聚焦按钮时保留原生 Enter 激活；关闭/销毁后不执行确认；浏览器验证取消按钮 Enter 不改变工程 |
| 空格拖动选区时失焦走普通 mouseup，临时移动被提交 | 将指针取消作为独立路径：提交普通笔划，取消临时移动/框选，不走选区 mouseup；验证像素保持不变 |
| 背景/衣服匹配组默认 ID 不存在，出现“0 色” | 统一为实际存在的 all_colors；初始化及从其它分区切回都恢复 36 色；浏览器复测显示 36 色 |

相关文件：`src/app/viewModel.ts`、`src/core/storage.ts`、`src/app/app.ts`、两种 Modal、`src/panels/canvas/CanvasPanel.ts`、`src/model/session.ts`。

新增正式测试：`tests/reviewFollowup.test.ts`，共 17 个用例。另加强 `tests/zipExporter.test.ts`：导出过程中修改原文档后，除 JSON 外，同时核对头像及综合遮罩的实际 Canvas 输入，避免固定假 PNG 掩盖 B7 回归。

历史诊断 `docs/review/reproduce-bugs.ts` 已适配新 codec 的 document 返回值及保存结果回调，可再次直接运行。

## 本轮验证证据

| 验证 | 结果 |
| --- | --- |
| npm run typecheck | 通过 |
| npm run typecheck:tests | 通过 |
| npm test | 21 个文件，159 个测试通过 |
| npm run build | 通过；Vite 66 modules |
| git diff --check | 通过 |
| 原 B1–B7 诊断 | 透明/锁规则、历史、存储失败、预设校验、PNG 错误、ZIP 渲染快照符合原诊断目标 |
| R1–R7 诊断 | 输出符合目标；诊断打印不替代正式断言 |

## 真实浏览器检查

环境：Codex In-app Browser；`http://127.0.0.1:5189/64px-portrait-studio/`。使用合成 ZIP（48×48 两色区域、Hair/Skin 遮罩与透明边缘），独立 origin 隔离日常工程缓存。

已实测：

- 导入后像素与遮罩计数正确，自动保存状态正常。
- 确认弹窗聚焦按钮；Shift+Tab 留在弹窗；Esc 关闭恢复先前焦点。
- 全选画布后打开确认，再按 Esc，仍保留 64×64 选区。修复前该路径会清选区。
- 颜色替换弹窗聚焦确认按钮，Tab 从末尾回到首按钮，Shift+Tab 回到末尾；Enter 激活取消按钮不执行替换。
- 切入背景遮罩时显示 36 色匹配组。
- 通过界面实际下载工程 ZIP，并解码其中 11 张 PNG：工程 PNG、1×/4×/8×头像、64/512 综合遮罩、5 个二值分区遮罩；所有像素与该 ZIP 的 JSON 一致。JSON 也与导入夹具完全一致，验证取消替换没有修改数据。
- 本轮浏览器检查没有记录到 console error。

实际导出临时归档：`/tmp/portrait-browser-export.zip`。IAB 的 download 事件等待超时，但文件实际落入 Downloads；核对后移至此临时位置并使用文件内容验证，没有把等待事件当作下载证据。

可复用校验器：`docs/review/verify-browser-export.py`。使用带 Pillow 的 Python 执行：

```bash
python3 docs/review/verify-browser-export.py /path/to/project.zip
```

本轮使用工作区捆绑的 Python，没有安装额外浏览器/图片依赖。

## 验证边界

上述浏览器结果只覆盖列出的路径。配额异常、并发导入、销毁后调用、空格拖动失焦等主要由正式测试/故障注入验证；没有执行强制浏览器进程终止、完整鼠标操作矩阵或性能基准。

原指南 T07 的完整浏览器适配器迁移仍是未完成的架构任务，core 内仍有 Canvas/下载/存储实现。本轮修复通过不等同于原 T00–T11 全量重构验收。首次审查文件和此前 142 测试的记录保留为阶段历史，以本文件与下面的复查补充为当前结果。
