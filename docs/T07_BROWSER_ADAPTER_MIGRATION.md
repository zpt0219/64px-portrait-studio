# T07 浏览器适配器迁移与验收

2026-10-03，Codex 实施。迁移基线：`81e87961cdc386426edfc4ece0420193e6a57b8e`。

T07 已完成。修改依赖方向与服务组装方式，保留现有量化、分区、透明保护、编辑事务、草稿确认、存档格式和导出文件结构。

## 最终依赖边界

- `core/`、`model/`、`command/`：纯数据、领域算法与命令。PNG 编码仍使用可在 Node 中运行的 Blob/CompressionStream；ZIP 读取使用 JSZip，不创建 DOM。
- `app/controllers/`：依赖窄端口，不导入 ViewModel 或具体浏览器实现。异步导入保持请求序号隔离；导出保持文档快照与旧确认取消机制。
- `app/viewModel.ts`：组装领域控制器、应用纯导入结果并发送事件。当前文档通过读取函数提供给控制器，导出时深拷贝快照。
- `app/app.ts`：组装 `BrowserStorage`、`AutosaveService`、浏览器导出与图片解码，显式注入 ViewModel / ImportCoordinator。启动恢复提示、恢复入口和列宽偏好均使用相应实例存储。
- `app/browser/`：Image 解码、Canvas 绘制/缩放、色卡与遮罩资源、ZIP 打包和浏览器导出。下载统一使用 `app/utils/download.ts`。

| 原模块 | 最终位置与职责 |
| --- | --- |
| `core/storage.ts` | `app/services/AutosaveService.ts`：实例保存调度；`app/adapters/BrowserStorage.ts`：浏览器存储接入；codec 保留在 `core/projectData.ts` |
| `core/zipExporter.ts` | `app/browser/projectArchive.ts`：资源生成、打包与下载；`core/projectArchive.ts`：读取与验证工程数据 |
| `core/pixelRender.ts` | `app/browser/pixelCanvas.ts`：Canvas 绘制；`core/maskColors.ts`：纯颜色查表 |
| `app/imageDecode.ts` | `app/browser/imageDecode.ts`：具体 Image/Canvas 解码实现 |
| `app/controllers/ImageImportPipeline.ts` | `core/imageImport.ts`：`DecodedImage + palette → {document, importInfo, warnings}` |
| ViewModel 内的确认接口 | `app/ports.ts`：确认与导出接口，控制器无需依赖 ViewModel 类型 |

删除旧模块及存储全局适配器、单例保存函数、兼容 re-export。正式测试和历史诊断脚本均已改为显式服务注入。

## 无浏览器使用与失败语义

`new ViewModel()` 可以在没有 window/document/localStorage/Image 的环境构造和编辑。默认存储不执行 IO，写入返回失败，自动保存状态为 `error`；默认导出端口拒绝请求，由现有通知流程报告失败。测试如需正常保存，应注入实例级内存存储。

```ts
const vm = new ViewModel({
  autosave: new AutosaveService(store),
  exports: { exportPng, exportZip, exportMaskPng },
});
```

导出实现可以是对象或带原型方法的类；ViewModel 调用保留实现的 receiver。图片分区降级通过 `warnings` 返回，纯算法不写日志或发送通知；应用层决定如何显示。

## 自动化验收

全部通过：`npm run typecheck`、`npm run typecheck:tests`、`npm test`、`npm run build`、`git diff --check`。

23 个测试文件、164 个测试，其中原有 159 个案例保留。新增 5 个案例：

1. 对全部核心、模型、命令、控制器以及 ViewModel 的传递依赖进行 AST 检查；禁止浏览器模块、DOM/Canvas 全局依赖及核心层日志副作用。
2. 把浏览器全局对象设置为抛错 getter，再导入、构造、编辑和导出默认 ViewModel；确认从未访问这些对象，且未误报保存成功。
3. 注入带原型方法的导出实现，验证 receiver、换工程后的文档读取和独立快照。
4. 从 Uint8Array 读取工程 ZIP，无需 File、Canvas 或浏览器存储。
5. 强制分区算法异常，验证警告返回、当前色板、透明阈值保护和输入不变，且无日志副作用。

存储、导出、生命周期、模式切换和 R1–R7 测试迁移后仍通过。两个历史诊断脚本也已实际运行，结果保持先前修复后的行为。

## 真实浏览器对照

迁移版本使用生产构建 + Vite preview；另在临时目录从基线 commit 解包，运行旧版本。所有输入均为合成夹具，使用独立 localhost 端口；未读取用户实际工程。干净依赖缓存下的迁移版本开发服务器也已启动并验证界面正常。

| 操作 | 结果 |
| --- | --- |
| 导入合成旧工程 ZIP | 像素、遮罩、色板与预设恢复；保存状态显示“已自动存盘” |
| 新旧版本导入同一 48×48 PNG | 均居中放入 64×64；像素、色板、分区与预设完全相同 |
| 导出上述两组工程 | ZIP 文件目录一致；JSON 除 `ts` 外一致；README 除导出时间外一致；JSON/GPL 色板文件逐字节一致 |
| 比较每组 ZIP 全部 PNG | 每组 12 张图片（含色卡）尺寸与解码 RGBA 像素完全一致 |
| 校验导出内部一致性 | 每组 11 张头像/遮罩 PNG 与工程 JSON 逐像素匹配，覆盖 1×/4×/8× 与五个独立分区 |
| 独立 PNG 下载 | 正常下载；与同次工程 ZIP 内极简 PNG 一致 |
| 刷新后点击“立即恢复” | 恢复最近一次图片导入结果，分区统计保持一致 |
| 浏览器错误日志 | 生产构建验收流程无 warning/error |

导出时间戳与 ZIP 容器时间字段本就随运行变化，不比较整个 ZIP 的二进制字节。

保留于本机的本轮验收产物：`/tmp/portrait-t07-project-export.zip`、`/tmp/portrait-t07-image-before.zip`、`/tmp/portrait-t07-image-after.zip`、`/tmp/portrait-t07-browser.jpg`。它们是临时证据，不是提交的产品资源。

验证工具已支持新旧导出对照（需要 Pillow）：

```bash
python3 docs/review/verify-browser-export.py /tmp/portrait-t07-image-after.zip \
  --compare-export /tmp/portrait-t07-image-before.zip
python3 docs/review/verify-browser-export.py /tmp/portrait-t07-project-export.zip \
  --reference /tmp/portrait-review-fixture.zip \
  --compare-export /tmp/portrait-browser-export.zip
```

本轮验收聚焦 T07 的依赖边界与行为等价，不将单次浏览器冒烟扩大宣称为所有历史任务的完整端到端验收。
