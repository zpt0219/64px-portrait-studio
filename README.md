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

## 目录结构

```
src/
├── main.ts                  # ImageGemApp：全局状态、导入流程、发色置换、撤销/重做、快捷键
├── style.css
├── components/
│   ├── CanvasEditor.ts      # 画布：绘制工具、选区、遮罩覆盖层、缩放平移
│   ├── Header.ts            # 顶栏：导入 / 导出 / 模式切换
│   ├── PalettePanel.ts      # 36 色色板
│   ├── MaskPanel.ts         # 分区列表与发色预设
│   ├── MaskToolsPanel.ts    # 遮罩工具与匹配色组
│   ├── RealtimePreview.ts   # 画中画实时预览
│   ├── ReplaceColorModal.ts
│   └── ConfirmModal.ts
├── core/
│   ├── remapCore.ts         # 几何门禁、面部/嘴部检测、语义分割、OKLab 色板映射
│   ├── recolorEngine.ts     # 发色阶位映射
│   ├── colorUtils.ts        # 颜色转换与色差
│   ├── storage.ts           # localStorage 自动暂存
│   ├── zipExporter.ts       # 工程 ZIP 导入导出、各类导出画布
│   ├── minimalPng.ts        # 8-bit 索引 PNG 编码
│   └── pngMetadata.ts       # CRC32 / Base64 / 工程数据校验
├── data/palette.ts          # 36 色色板、9 大发色色阶、色系分组（唯一事实数据源）
├── types/index.ts           # StudioState、SemanticZone 等类型
└── utils/cursorUtils.ts
```

## 数据模型

- `pixelIndices: Uint8Array(4096)` — 每像素的色板索引，`0~35` 为颜色，`255` 为透明。
- `semanticMask: Uint8Array(4096)` — 每像素的分区，`0` 背景 / `1` 头发 / `2` 皮肤 / `3` 眼睛 / `4` 衣服。
- 色板变更记录见 [docs/PALETTE_CHANGELOG.md](docs/PALETTE_CHANGELOG.md)。

## 文档

- [docs/PALETTE_CHANGELOG.md](docs/PALETTE_CHANGELOG.md) — 36 色色板演进记录
- [docs/HAIR_COLOR_UNIFICATION_SOP.md](docs/HAIR_COLOR_UNIFICATION_SOP.md) — 发色统一化 SOP
- [docs/IMAGEGEM_STUDIO_DESIGN_PLAN.md](docs/IMAGEGEM_STUDIO_DESIGN_PLAN.md) — 早期设计方案（部分内容已过时：输入尺寸限制、工程 PNG 格式、分区配色均已变更，以代码为准）

## License

[MIT](LICENSE)
