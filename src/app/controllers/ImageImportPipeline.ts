import { SemanticZone, DecodedImage, ToastLevel } from '../../types';
import { TRANSPARENT_INDEX } from '../../data/palette';
import { Rgb, hexToRgb, quantizeToPalette } from '../../core/colorUtils';
import { computeSemanticMask } from '../../core/segmentation';
import { PIXEL_COUNT } from '../../core/pixelGrid';
import { detectHairPreset } from '../../core/recolorEngine';
import { PortraitDocument } from '../../model/document';

export interface ImageImportResult {
  document: PortraitDocument;
  importInfo: {
    origW: number;
    origH: number;
    targetW: number;
    targetH: number;
    message: string;
  };
  warnings: string[];
}

/**
 * 纯输入输出的图片解码结果处理：
 * 接收原始图片像素与色板，完成 36 色量化、5 分区遮罩生成及透明保护，返回新文档与提示信息。
 * 纯领域算法，不包含任何 DOM 或全局状态副作用。
 */
export function processDecodedImage(image: DecodedImage, palette: string[]): ImageImportResult {
  const { rgba, origW, origH, targetW, targetH } = image;
  const rgbPixels: Rgb[] = [];
  const transparent = new Uint8Array(PIXEL_COUNT);
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 128) {
      transparent[i] = 1;
      rgbPixels.push([255, 255, 255]); // 纯白占位，不影响量化器
    } else {
      rgbPixels.push([rgba[o], rgba[o + 1], rgba[o + 2]]);
    }
  }

  // OKLab 36 色逐像素最近邻量化 (不使用 dithering)
  const indices = quantizeToPalette(rgbPixels, palette.map(hexToRgb));
  const warnings: string[] = [];
  let mask: Uint8Array;
  try {
    mask = computeSemanticMask(rgbPixels);
  } catch (err) {
    console.warn('Semantic analysis fallback to safe foreground:', err);
    warnings.push('⚠️ 人脸特征识别未达标，请在遮罩模式手动涂抹头发区域');
    const corner = rgbPixels[0];
    const isCornerBg = (p: Rgb) =>
      Math.abs(p[0] - corner[0]) + Math.abs(p[1] - corner[1]) + Math.abs(p[2] - corner[2]) < 25;
    mask = Uint8Array.from(rgbPixels, (p) => (isCornerBg(p) ? SemanticZone.Background : SemanticZone.Clothes));
  }

  for (let i = 0; i < PIXEL_COUNT; i++) {
    if (transparent[i]) {
      indices[i] = TRANSPARENT_INDEX;
      mask[i] = SemanticZone.Background;
    }
  }

  let message: string;
  if (origW > 64 || origH > 64) {
    message = `✨ 图片载入成功：原尺寸 ${origW}×${origH} 已智能缩放至 ${targetW}×${targetH} 并完成 36 色量化`;
  } else if (origW < 64 || origH < 64) {
    message = `✨ 图片载入成功：原尺寸 ${origW}×${origH} 已居中置入 64×64 画布并完成 36 色量化`;
  } else {
    message = '✨ 图片载入成功：已自动完成 36 色量化与 5 分区遮罩生成';
  }

  const document: PortraitDocument = {
    palette: [...palette],
    pixelIndices: indices,
    semanticMask: mask,
    currentHairPreset: detectHairPreset(indices, mask, palette),
  };

  return {
    document,
    importInfo: { origW, origH, targetW, targetH, message },
    warnings,
  };
}

export interface ImageImportHost {
  getPalette(): string[];
  applyImportResult(result: ImageImportResult): void;
  notify(message: string, level?: ToastLevel): void;
}

export class ImageImportPipeline {
  constructor(private readonly host: ImageImportHost) {}

  importImage(image: DecodedImage): void {
    const result = processDecodedImage(image, this.host.getPalette());
    this.host.applyImportResult(result);
    for (const w of result.warnings) {
      this.host.notify(w, 'warning');
    }
    this.host.notify(result.importInfo.message, 'success');
  }
}
