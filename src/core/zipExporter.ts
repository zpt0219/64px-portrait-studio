/**
 * ImageGem Project ZIP Exporter
 * 将项目完整成果打包为标准 ZIP 归档文件：
 * 1. imagegem_project_64x64.png (内嵌 tEXt 状态元数据，可直接复原)
 * 2. imagegem_project.json (原始工程 JSON)
 * 3. README.txt (包含色板信息、图层说明、复原指南)
 * 4. renders/ (1x 64px, 4x 256px, 8x 512px 纯净渲染图，保留原生透明度)
 * 5. masks/ (5 色综合语义遮罩 1x & 8x，以及 5 个独立分区的单通道黑白二值图层遮罩)
 * 6. palette/ (36 色 JSON、Aseprite/GIMP 规范 .gpl 色板、色板色卡预览图)
 */

import JSZip from 'jszip';
import { StudioState, SemanticZone, ImageGemProjectData } from '../types';
import { stateToProjectData } from './storage';
import { validateProjectData } from './pngMetadata';
import { encodeMinimalIndexedPng } from './minimalPng';
import { TRANSPARENT_INDEX } from '../data/palette';
import { hexToRgb } from './colorUtils';

/**
 * 触发浏览器文件下载
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 将 Canvas 转为 PNG Blob
 */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas toBlob failed'));
    }, 'image/png');
  });
}

/**
 * 绘制指定缩放倍率的 36 色像素画布
 */
export function createPixelCanvas(state: StudioState, scale: number = 1): HTMLCanvasElement {
  const canvas64 = document.createElement('canvas');
  canvas64.width = 64;
  canvas64.height = 64;
  const ctx64 = canvas64.getContext('2d')!;

  const imgData = ctx64.createImageData(64, 64);
  const data = imgData.data;

  const paletteRgb = state.palette.map((hex) => hexToRgb(hex));

  for (let i = 0; i < 4096; i++) {
    const palIdx = state.pixelIndices[i];
    const dIdx = i * 4;
    if (palIdx === TRANSPARENT_INDEX) {
      data[dIdx] = 0;
      data[dIdx + 1] = 0;
      data[dIdx + 2] = 0;
      data[dIdx + 3] = 0;
    } else {
      const rgb = paletteRgb[palIdx] || [0, 0, 0];
      data[dIdx] = rgb[0];
      data[dIdx + 1] = rgb[1];
      data[dIdx + 2] = rgb[2];
      data[dIdx + 3] = 255;
    }
  }
  ctx64.putImageData(imgData, 0, 0);

  if (scale === 1) {
    return canvas64;
  }

  const targetSize = 64 * scale;
  const targetCanvas = document.createElement('canvas');
  targetCanvas.width = targetSize;
  targetCanvas.height = targetSize;
  const targetCtx = targetCanvas.getContext('2d')!;
  targetCtx.imageSmoothingEnabled = false;
  targetCtx.drawImage(canvas64, 0, 0, 64, 64, 0, 0, targetSize, targetSize);
  return targetCanvas;
}

/**
 * 绘制 5 色互斥综合语义遮罩画布 (黑/青/绿/紫/黄)
 */
export function createCompositeMaskCanvas(state: StudioState, scale: number = 1): HTMLCanvasElement {
  const canvas64 = document.createElement('canvas');
  canvas64.width = 64;
  canvas64.height = 64;
  const ctx64 = canvas64.getContext('2d')!;

  const imgData = ctx64.createImageData(64, 64);
  const data = imgData.data;

  // 5 分区规范配色: 黑/青/绿/紫/黄
  const zoneHexMap: Record<number, [number, number, number]> = {
    [SemanticZone.Background]: [0, 0, 0],         // #000000 背景 黑
    [SemanticZone.Hair]: [0, 229, 255],           // #00E5FF 头发 青
    [SemanticZone.Skin]: [34, 197, 94],           // #22C55E 皮肤 绿
    [SemanticZone.Eyes]: [168, 85, 247],          // #A855F7 眼睛 紫
    [SemanticZone.Clothes]: [255, 214, 0],        // #FFD600 衣服 黄
  };

  for (let i = 0; i < 4096; i++) {
    const zone = state.semanticMask[i];
    const rgb = zoneHexMap[zone] || [0, 0, 0];
    const dIdx = i * 4;
    data[dIdx] = rgb[0];
    data[dIdx + 1] = rgb[1];
    data[dIdx + 2] = rgb[2];
    data[dIdx + 3] = 255;
  }
  ctx64.putImageData(imgData, 0, 0);

  if (scale === 1) {
    return canvas64;
  }

  const targetSize = 64 * scale;
  const targetCanvas = document.createElement('canvas');
  targetCanvas.width = targetSize;
  targetCanvas.height = targetSize;
  const targetCtx = targetCanvas.getContext('2d')!;
  targetCtx.imageSmoothingEnabled = false;
  targetCtx.drawImage(canvas64, 0, 0, 64, 64, 0, 0, targetSize, targetSize);
  return targetCanvas;
}

/**
 * 绘制单个分区的单通道黑白二值遮罩 (白=选定分区, 黑=其他区域)
 * 便于导入游戏引擎、Photoshop 图层蒙版或作为 AI 控制网 (ControlNet / LoRA) 训练数据
 */
export function createBinaryMaskCanvas(state: StudioState, targetZone: SemanticZone, scale: number = 1): HTMLCanvasElement {
  const canvas64 = document.createElement('canvas');
  canvas64.width = 64;
  canvas64.height = 64;
  const ctx64 = canvas64.getContext('2d')!;

  const imgData = ctx64.createImageData(64, 64);
  const data = imgData.data;

  for (let i = 0; i < 4096; i++) {
    const isMatch = state.semanticMask[i] === targetZone;
    const dIdx = i * 4;
    const val = isMatch ? 255 : 0;
    data[dIdx] = val;
    data[dIdx + 1] = val;
    data[dIdx + 2] = val;
    data[dIdx + 3] = 255;
  }
  ctx64.putImageData(imgData, 0, 0);

  if (scale === 1) {
    return canvas64;
  }

  const targetSize = 64 * scale;
  const targetCanvas = document.createElement('canvas');
  targetCanvas.width = targetSize;
  targetCanvas.height = targetSize;
  const targetCtx = targetCanvas.getContext('2d')!;
  targetCtx.imageSmoothingEnabled = false;
  targetCtx.drawImage(canvas64, 0, 0, 64, 64, 0, 0, targetSize, targetSize);
  return targetCanvas;
}

/**
 * 绘制色板色卡预览图 (6 列 x 6 行 36 色色卡栅格)
 */
export function createPaletteSwatchCanvas(state: StudioState): HTMLCanvasElement {
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

    const hex = state.palette[i] || '#000000';
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
export function generateGplPalette(state: StudioState): string {
  const lines: string[] = [
    'GIMP Palette',
    'Name: 64px Portrait Studio 36 Color Palette',
    'Columns: 6',
    '#',
  ];

  state.palette.forEach((hex, idx) => {
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
export function generateReadme(state: StudioState): string {
  const hairPreset = state.currentHairPreset || '未选择 / 自定义发色';
  const nowStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  // 统计各遮罩分区像素数
  const zoneStats: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  for (let i = 0; i < 4096; i++) {
    const z = state.semanticMask[i];
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

3. renders/ (全尺寸纯净头像渲染图，支持透明背景)
   - avatar_64x64_1x.png     : 原寸 1× (64 × 64) 标准像素头像。
   - avatar_256x256_4x.png   : 最近邻无损放大 4× (256 × 256)。
   - avatar_512x512_8x.png   : 最近邻无损放大 8× (512 × 512) 高清像素头像。

4. masks/ (5 色语义互斥遮罩)
   - mask_5zone_composite_64x64.png     : 64×64 综合遮罩 (黑:背景, 青:头发, 绿:皮肤, 紫:眼睛, 黄:衣服)。
   - mask_5zone_composite_512x512_8x.png : 8× 512×512 高清综合遮罩。
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
 * 导出单个极简 64x64 纯净 PNG (8-bit 索引色，无冗余元数据，最小化体积)
 */
export async function exportProjectPng(state: StudioState): Promise<void> {
  if (!state.isLoaded) return;
  const finalBlob = await encodeMinimalIndexedPng(state.pixelIndices, state.palette);
  downloadBlob(finalBlob, `avatar_36color_64x64_${Date.now()}.png`);
}

/**
 * 打包并导出完整工程 ZIP (包含全部渲染图、遮罩、色板与工程数据)
 */
export async function exportProjectZip(
  state: StudioState,
  onProgress?: (step: string) => void
): Promise<void> {
  if (!state.isLoaded) return;

  onProgress?.('正在生成各分辨率渲染图与工程数据...');

  const zip = new JSZip();
  const projectData = stateToProjectData(state);

  // 1. 核心工程文件
  const minimalPngBlob = await encodeMinimalIndexedPng(state.pixelIndices, state.palette);
  const canvas64 = createPixelCanvas(state, 1);
  const blob64 = await canvasToBlob(canvas64);

  zip.file('imagegem_project_64x64.png', minimalPngBlob);
  zip.file('imagegem_project.json', JSON.stringify(projectData, null, 2));
  zip.file('README.txt', generateReadme(state));

  // 2. 渲染图 (1x, 4x, 8x)
  onProgress?.('正在导出 1x/4x/8x 像素头像...');
  const canvas256 = createPixelCanvas(state, 4);
  const canvas512 = createPixelCanvas(state, 8);

  const [blob256, blob512] = await Promise.all([
    canvasToBlob(canvas256),
    canvasToBlob(canvas512),
  ]);

  zip.file('renders/avatar_64x64_1x.png', blob64);
  zip.file('renders/avatar_256x256_4x.png', blob256);
  zip.file('renders/avatar_512x512_8x.png', blob512);

  // 3. 语义遮罩 (综合遮罩 + 5 个独立分区二值遮罩)
  onProgress?.('正在生成 5 分区语义遮罩与图层二值图...');
  const maskComposite64 = createCompositeMaskCanvas(state, 1);
  const maskComposite512 = createCompositeMaskCanvas(state, 8);

  const [blobMask64, blobMask512] = await Promise.all([
    canvasToBlob(maskComposite64),
    canvasToBlob(maskComposite512),
  ]);

  zip.file('masks/mask_5zone_composite_64x64.png', blobMask64);
  zip.file('masks/mask_5zone_composite_512x512_8x.png', blobMask512);

  // 各分区二值遮罩
  const [blobHair, blobSkin, blobEyes, blobClothes, blobBg] = await Promise.all([
    canvasToBlob(createBinaryMaskCanvas(state, SemanticZone.Hair)),
    canvasToBlob(createBinaryMaskCanvas(state, SemanticZone.Skin)),
    canvasToBlob(createBinaryMaskCanvas(state, SemanticZone.Eyes)),
    canvasToBlob(createBinaryMaskCanvas(state, SemanticZone.Clothes)),
    canvasToBlob(createBinaryMaskCanvas(state, SemanticZone.Background)),
  ]);

  zip.file('masks/layers/mask_hair_64x64.png', blobHair);
  zip.file('masks/layers/mask_skin_64x64.png', blobSkin);
  zip.file('masks/layers/mask_eyes_64x64.png', blobEyes);
  zip.file('masks/layers/mask_clothes_64x64.png', blobClothes);
  zip.file('masks/layers/mask_background_64x64.png', blobBg);

  // 4. 色板资源
  onProgress?.('正在打包 36 色色板与 Aseprite GPL 配置...');
  const palJson = state.palette.map((hex, i) => ({
    index: i,
    hex,
    rgb: hexToRgb(hex),
  }));
  zip.file('palette/palette_36.json', JSON.stringify(palJson, null, 2));
  zip.file('palette/palette_aseprite.gpl', generateGplPalette(state));

  const swatchCanvas = createPaletteSwatchCanvas(state);
  const swatchBlob = await canvasToBlob(swatchCanvas);
  zip.file('palette/palette_swatches.png', swatchBlob);

  // 5. 压缩并下载
  onProgress?.('正在压缩 ZIP 归档文件...');
  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  downloadBlob(zipBlob, `portrait_studio_project_${Date.now()}.zip`);
}

/**
 * 从 ZIP 归档文件中解包提取 ImageGem 工程数据
 * @param fileOrBuffer 用户选择或拖入的 ZIP 文件或二进制 ArrayBuffer
 * @returns 经过合法性严格校验的 ImageGemProjectData
 */
export async function importProjectZip(fileOrBuffer: File | ArrayBuffer): Promise<ImageGemProjectData> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(fileOrBuffer);
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
