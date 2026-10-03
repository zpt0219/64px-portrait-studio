import { SemanticZone, DecodedImage } from '../../types';
import { TRANSPARENT_INDEX } from '../../data/palette';
import { Rgb, hexToRgb, quantizeToPalette } from '../../core/colorUtils';
import { computeSemanticMask } from '../../core/segmentation';
import { PIXEL_COUNT } from '../../core/pixelGrid';
import { detectHairPreset } from '../../core/recolorEngine';
import type { ViewModel } from '../viewModel';

export class ImageImportPipeline {
  constructor(private readonly vm: ViewModel) {}

  /** 导入普通图片：36 色量化 + 自动 5 分区遮罩，作为新项目载入 */
  importImage(image: DecodedImage): void {
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
    const palette = this.vm.doc.palette;
    const indices = quantizeToPalette(rgbPixels, palette.map(hexToRgb));
    const mask = this.segment(rgbPixels);
    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (transparent[i]) {
        indices[i] = TRANSPARENT_INDEX;
        mask[i] = SemanticZone.Background;
      }
    }

    this.vm.replaceDocumentInternal(
      { palette, pixelIndices: indices, semanticMask: mask, currentHairPreset: detectHairPreset(indices, mask, palette) },
      {
        visibleMaskZones: [],
        showMaskOverlay: false,
        activeMode: 'pixel',
        activeZone: SemanticZone.Background,
        lockedMaskZones: [],
        activeMaskTool: 'pen',
        maskBrushSize: 1,
        maskMatchInitialized: false,
        isLoaded: true,
        selection: null,
        hairDraftPreset: null,
      }
    );

    if (origW > 64 || origH > 64) {
      this.vm.notify(`✨ 图片载入成功：原尺寸 ${origW}×${origH} 已智能缩放至 ${targetW}×${targetH} 并完成 36 色量化`, 'success');
    } else if (origW < 64 || origH < 64) {
      this.vm.notify(`✨ 图片载入成功：原尺寸 ${origW}×${origH} 已居中置入 64×64 画布并完成 36 色量化`, 'success');
    } else {
      this.vm.notify('✨ 图片载入成功：已自动完成 36 色量化与 5 分区遮罩生成', 'success');
    }
  }

  /** 语义分割；失败时降级：与左上角颜色相近的视为背景，其余前景保守归为衣服 */
  private segment(pixels: Rgb[]): Uint8Array {
    try {
      return computeSemanticMask(pixels);
    } catch (err) {
      console.warn('Semantic analysis fallback to safe foreground:', err);
      const corner = pixels[0];
      const isCornerBg = (p: Rgb) =>
        Math.abs(p[0] - corner[0]) + Math.abs(p[1] - corner[1]) + Math.abs(p[2] - corner[2]) < 25;
      this.vm.notify('⚠️ 人脸特征识别未达标，请在遮罩模式手动涂抹头发区域', 'warning');
      return Uint8Array.from(pixels, (p) => (isCornerBg(p) ? SemanticZone.Background : SemanticZone.Clothes));
    }
  }
}
