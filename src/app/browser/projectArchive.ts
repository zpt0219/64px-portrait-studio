/**
 * 工程导出与导入：极简 PNG 与完整工程 ZIP
 * ZIP 内容：
 * 1. imagegem_project_64x64.png (8-bit 索引色极简 PNG，无元数据)
 * 2. imagegem_project.json (原始工程 JSON)
 * 3. README.txt (包含色板信息、图层说明、复原指南)
 * 4. renders/ (64px 纯净渲染图，保留原生透明度)
 * 5. masks/ (64px 5 色综合语义遮罩，以及 5 个独立分区的单通道黑白二值图层遮罩)
 * 6. palette/ (36 色 JSON、Aseprite/GIMP 规范 .gpl 色板、色板色卡预览图)
 */

import JSZip from 'jszip';
import { SemanticZone, ProjectData } from '../../types';
import { PortraitDocument, cloneDocument } from '../../model/document';
import { documentToProjectData, validateProjectData, CURRENT_PROJECT_VERSION, upgradeProjectData } from '../../core/projectData';
import { encodeMinimalIndexedPng } from '../../core/minimalPng';
import { Rgb, hexToRgb } from '../../core/colorUtils';
import { drawIndexedPixels } from './pixelCanvas';
import { zoneRgbTable } from '../../core/maskColors';
import { IMAGE_WIDTH, IMAGE_HEIGHT, PIXEL_COUNT } from '../../core/pixelGrid';

import { downloadBlob } from '../utils/download';

/**
 * 将 Canvas 转为 PNG Blob (支持异步 Promise 异常捕获)
 */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas 导出 Blob 失败'));
      }, 'image/png');
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * 64×64 像素头像 Canvas (保留透明)
 */
function createPixelCanvas(doc: PortraitDocument): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_WIDTH;
  canvas.height = IMAGE_HEIGHT;
  drawIndexedPixels(canvas.getContext('2d')!, doc.pixelIndices, doc.palette);
  return canvas;
}

/**
 * 按 SemanticZone 值逐像素填色的 64×64 遮罩画布
 */
function createMaskCanvas(doc: PortraitDocument, colorOf: (zone: SemanticZone) => Rgb): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_WIDTH;
  canvas.height = IMAGE_HEIGHT;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(IMAGE_WIDTH, IMAGE_HEIGHT);
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const rgb = colorOf(doc.semanticMask[i] as SemanticZone) || [0, 0, 0];
    imgData.data.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/** 5 色互斥综合语义遮罩 (64×64，背景为纯黑) */
function createCompositeMaskCanvas(doc: PortraitDocument): HTMLCanvasElement {
  const table = zoneRgbTable([0, 0, 0]);
  return createMaskCanvas(doc, (zone) => table[zone]);
}

/**
 * 单个分区的黑白二值遮罩 (白=选定分区, 黑=其他区域)
 * 便于导入游戏引擎、Photoshop 图层蒙版或作为 AI 训练数据
 */
function createBinaryMaskCanvas(doc: PortraitDocument, targetZone: SemanticZone): HTMLCanvasElement {
  return createMaskCanvas(doc, (zone) => (zone === targetZone ? [255, 255, 255] : [0, 0, 0]));
}

/**
 * 绘制色板色卡预览图 (6 列 x 6 行 36 色色卡栅格)
 */
function createPaletteSwatchCanvas(doc: PortraitDocument): HTMLCanvasElement {
  const chipSize = 32;
  const gap = 4;
  const padding = 12;
  const cols = 6;
  const rows = 6;

  const w = padding * 2 + cols * chipSize + (cols - 1) * gap;
  const h = padding * 2 + rows * chipSize + (rows - 1) * gap;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // 深色卡片背景
  ctx.fillStyle = '#0f111a';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#222638';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  for (let i = 0; i < 36; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = padding + col * (chipSize + gap);
    const y = padding + row * (chipSize + gap);

    const hex = doc.palette[i] || '#000000';
    ctx.fillStyle = hex;
    ctx.fillRect(x, y, chipSize, chipSize);

    // 细边框
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.strokeRect(x + 0.5, y + 0.5, chipSize - 1, chipSize - 1);

    // 索引小字
    ctx.fillStyle = (i === 1) ? '#000000' : '#ffffff';
    ctx.font = '10px monospace';
    ctx.fillText(String(i), x + 3, y + chipSize - 4);
  }

  return canvas;
}

/**
 * 生成 Aseprite / GIMP 标准格式的色板文件 (.gpl)
 */
function generateGplPalette(doc: PortraitDocument): string {
  const lines: string[] = [
    'GIMP Palette',
    'Name: 64px Portrait Studio 36 Color Palette',
    'Columns: 6',
    '#',
  ];

  doc.palette.forEach((hex, idx) => {
    const rgb = hexToRgb(hex);
    const r = rgb[0].toString().padStart(3, ' ');
    const g = rgb[1].toString().padStart(3, ' ');
    const b = rgb[2].toString().padStart(3, ' ');
    lines.push(`${r} ${g} ${b} ${hex.toUpperCase()} [${idx}]`);
  });

  return lines.join('\n');
}

/**
 * 生成 README.txt 导出说明文件
 */
function generateReadme(doc: PortraitDocument): string {
  const hairPreset = doc.currentHairPreset || '未选择 / 自定义发色';
  const nowStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  // 统计各遮罩分区像素数
  const zoneStats: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const z = doc.semanticMask[i];
    if (zoneStats[z] !== undefined) zoneStats[z]++;
  }

  return `================================================================================
💎 64px Portrait Studio · 完整工程导出成果包
================================================================================

导出时间: ${nowStr}
像素规格: 64 × 64 像素 (标准 GBA 复古头像规格)
当前发色预设: ${hairPreset}

【语义遮罩像素统计】:
- 背景 (Background [0]): ${zoneStats[0]} 像素 (含原生透明底)
- 头发 (Hair       [1]): ${zoneStats[1]} 像素
- 皮肤 (Skin       [2]): ${zoneStats[2]} 像素
- 眼睛 (Eyes       [3]): ${zoneStats[3]} 像素
- 衣服 (Clothes    [4]): ${zoneStats[4]} 像素

--------------------------------------------------------------------------------
📁 成果包文件结构与说明:
--------------------------------------------------------------------------------

1. imagegem_project_64x64.png
   - 标准 64×64 PNG 极简无损头像 (8-bit 索引色规范，无冗余元数据，体积约 400 字节)。

2. imagegem_project.json
   - 包含色板、像素索引 Base64、遮罩数据 Base64 及元数据的纯净完整工程配置。
   - 拖拽本 ZIP 压缩包至 64px Portrait Studio即可 100% 原样复原所有进度与遮罩！

3. renders/ (纯净头像渲染图，支持透明背景)
   - avatar_64x64.png        : 标准 64 × 64 像素头像。

4. masks/ (5 色语义互斥遮罩)
   - mask_5zone_composite_64x64.png     : 64×64 综合遮罩 (黑:背景, 青:头发, 绿:皮肤, 紫:眼睛, 黄:衣服)。
   - layers/ (各分区独立单通道黑白二值图，白=当前分区，黑=其他):
     * mask_hair_64x64.png       : 头发图层二值遮罩 (方便针对头发进行重绘/调色)
     * mask_skin_64x64.png       : 皮肤图层二值遮罩
     * mask_eyes_64x64.png       : 眼睛图层二值遮罩
     * mask_clothes_64x64.png    : 衣服图层二值遮罩
     * mask_background_64x64.png : 背景图层二值遮罩

5. palette/ (36 色复古色板资源)
   - palette_36.json         : 36 色色板 Hex 与 RGB 结构化数据。
   - palette_aseprite.gpl    : Aseprite / GIMP 标准色板格式，可直接载入 Aseprite 色板面板使用。
   - palette_swatches.png    : 36 色色卡视觉预览图。

================================================================================
感谢使用 64px Portrait Studio！
================================================================================
`;
}

/**
 * 生成单个极简 64x64 纯净 PNG Blob (8-bit 索引色)
 * 采用独立快照，避免导出异步期间状态被并发修改 (B7 防御)
 */
export async function generateProjectPngBlob(doc: PortraitDocument): Promise<Blob> {
  const snapshot = cloneDocument(doc);
  return encodeMinimalIndexedPng(snapshot.pixelIndices, snapshot.palette);
}

/**
 * 导出单个极简 64x64 纯净 PNG (8-bit 索引色，无冗余元数据，最小化体积)
 */
export async function exportProjectPng(
  doc: PortraitDocument,
  downloader: (blob: Blob, filename: string) => void = downloadBlob
): Promise<void> {
  const snapshot = cloneDocument(doc);
  const finalBlob = await generateProjectPngBlob(snapshot);
  downloader(finalBlob, `avatar_36color_64x64_${Date.now()}.png`);
}

/**
 * 导出 5 色综合语义遮罩 PNG (64×64)
 */
export async function exportMaskPng(
  doc: PortraitDocument,
  scale = 1,
  downloader: (blob: Blob, filename: string) => void = downloadBlob
): Promise<void> {
  const snapshot = cloneDocument(doc);
  const canvas = createCompositeMaskCanvas(snapshot);
  const blob = await canvasToBlob(canvas);
  downloader(blob, `mask_composite_${scale}x_${Date.now()}.png`);
}

/**
 * 打包并生成完整工程 ZIP Blob (包含全部渲染图、遮罩、色板与工程数据)
 * 关键安全规则 (B7): 在首次 await 发生前必须执行 cloneDocument，
 * 确保所有渲染图、二值遮罩、JSON 工程数据及色板来自完全同一瞬态快照。
 */
export async function generateProjectZipBlob(doc: PortraitDocument): Promise<Blob> {
  const snapshot = cloneDocument(doc);
  const zip = new JSZip();
  const projectData = documentToProjectData(snapshot);

  // 1. 核心工程文件
  const minimalPngBlob = await encodeMinimalIndexedPng(snapshot.pixelIndices, snapshot.palette);
  const canvas64 = createPixelCanvas(snapshot);
  const blob64 = await canvasToBlob(canvas64);

  zip.file('imagegem_project_64x64.png', minimalPngBlob);
  zip.file('imagegem_project.json', JSON.stringify(projectData, null, 2));
  zip.file('README.txt', generateReadme(snapshot));

  // 2. 渲染图 (仅提供 64px 标准原寸)
  zip.file('renders/avatar_64x64.png', blob64);

  // 3. 语义遮罩 (64px 综合遮罩 + 5 个独立分区 64px 二值遮罩)
  const maskComposite64 = createCompositeMaskCanvas(snapshot);
  const blobMask64 = await canvasToBlob(maskComposite64);

  zip.file('masks/mask_5zone_composite_64x64.png', blobMask64);

  // 各分区二值遮罩
  const [blobHair, blobSkin, blobEyes, blobClothes, blobBg] = await Promise.all([
    canvasToBlob(createBinaryMaskCanvas(snapshot, SemanticZone.Hair)),
    canvasToBlob(createBinaryMaskCanvas(snapshot, SemanticZone.Skin)),
    canvasToBlob(createBinaryMaskCanvas(snapshot, SemanticZone.Eyes)),
    canvasToBlob(createBinaryMaskCanvas(snapshot, SemanticZone.Clothes)),
    canvasToBlob(createBinaryMaskCanvas(snapshot, SemanticZone.Background)),
  ]);

  zip.file('masks/layers/mask_hair_64x64.png', blobHair);
  zip.file('masks/layers/mask_skin_64x64.png', blobSkin);
  zip.file('masks/layers/mask_eyes_64x64.png', blobEyes);
  zip.file('masks/layers/mask_clothes_64x64.png', blobClothes);
  zip.file('masks/layers/mask_background_64x64.png', blobBg);

  // 4. 色板资源
  const palJson = snapshot.palette.map((hex, i) => ({
    index: i,
    hex,
    rgb: hexToRgb(hex),
  }));
  zip.file('palette/palette_36.json', JSON.stringify(palJson, null, 2));
  zip.file('palette/palette_aseprite.gpl', generateGplPalette(snapshot));

  const swatchCanvas = createPaletteSwatchCanvas(snapshot);
  const swatchBlob = await canvasToBlob(swatchCanvas);
  zip.file('palette/palette_swatches.png', swatchBlob);

  // 5. 压缩
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

/**
 * 打包并导出完整工程 ZIP (包含全部渲染图、遮罩、色板与工程数据)
 */
export async function exportProjectZip(
  doc: PortraitDocument,
  downloader: (blob: Blob, filename: string) => void = downloadBlob
): Promise<void> {
  const snapshot = cloneDocument(doc);
  const zipBlob = await generateProjectZipBlob(snapshot);
  downloader(zipBlob, `portrait_studio_project_${Date.now()}.zip`);
}

/**
 * 从 ZIP 归档文件中解包提取工程数据
 * @returns 经过合法性严格校验的 ProjectData
 */
export async function importProjectZip(file: Parameters<typeof JSZip.loadAsync>[0]): Promise<ProjectData> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (err) {
    throw new Error('无法读取 ZIP 文件，可能已损坏或非合法 ZIP 归档');
  }

  // 1. 优先读取根目录下的 imagegem_project.json
  let jsonFile = zip.file('imagegem_project.json');

  // 2. 容错搜索：若文件名有变动，查找任意以 .json 结尾的文件
  if (!jsonFile) {
    const jsonFiles = zip.file(/\.json$/i);
    if (jsonFiles && jsonFiles.length > 0) {
      jsonFile = jsonFiles[0];
    }
  }

  if (!jsonFile) {
    throw new Error('ZIP 归档中未找到工程配置文件 (imagegem_project.json)');
  }

  let jsonText: string;
  try {
    jsonText = await jsonFile.async('string');
  } catch (err) {
    throw new Error('读取工程 JSON 文件内容失败');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error('工程 JSON 配置文件解析失败：JSON 语法格式无效');
  }

  const validation = validateProjectData(parsed);
  if (!validation.valid || !validation.data) {
    throw new Error(validation.error || '工程数据校验失败');
  }

  return validation.data;
}

/**
 * 直接对 ZIP 归档二进制执行工程 Schema 版本迁移 (纯异步流水线)
 * 检查 ZIP 中的 imagegem_project.json 版本，并逐步升级到当前 targetVersion (如 v1 -> v2 -> v3)
 */
export async function upgradeProjectZip(
  archiveBytes: Uint8Array,
  targetVersion: number = CURRENT_PROJECT_VERSION
): Promise<{ zipBytes: Uint8Array; upgraded: boolean; fromVersion: number; toVersion: number }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(archiveBytes);
  } catch (err) {
    throw new Error('无法读取 ZIP 文件，可能已损坏或非合法 ZIP 归档');
  }

  let jsonFile = zip.file('imagegem_project.json');
  if (!jsonFile) {
    const jsonFiles = zip.file(/\.json$/i);
    if (jsonFiles && jsonFiles.length > 0) jsonFile = jsonFiles[0];
  }
  if (!jsonFile) {
    throw new Error('ZIP 归档中未找到工程配置文件 (imagegem_project.json)');
  }

  let jsonText: string;
  try {
    jsonText = await jsonFile.async('string');
  } catch (err) {
    throw new Error('读取工程 JSON 文件内容失败');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error('工程 JSON 配置文件解析失败：JSON 语法格式无效');
  }

  const upgradeResult = upgradeProjectData(parsed, targetVersion);

  if (!upgradeResult.upgraded) {
    return {
      zipBytes: archiveBytes,
      upgraded: false,
      fromVersion: upgradeResult.fromVersion,
      toVersion: targetVersion,
    };
  }

  // 覆写已升级的 JSON 配置文件
  zip.file(jsonFile.name, JSON.stringify(upgradeResult.data, null, 2));

  const upgradedZip = await zip.generateAsync({ type: 'uint8array' });
  return {
    zipBytes: upgradedZip,
    upgraded: true,
    fromVersion: upgradeResult.fromVersion,
    toVersion: targetVersion,
  };
}


