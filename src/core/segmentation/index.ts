/**
 * 5 分区语义遮罩自动识别流水线入口。
 */

import { Rgb } from '../colorUtils';
import { estimateForeground } from './background';
import { analyzePixelOutline } from './contour';
import { analyzeFace } from './faceAnalysis';
import { claimFaceRegions, resolveSemanticMask, FALLBACK_CHIN_Y } from './resolver';

export * from './types';

/**
 * 对 64×64 RGB 像素自动生成 5 分区语义遮罩 (SemanticZone 值数组)。
 * 面部识别失败时只区分背景 / 前景：轮廓线按 FALLBACK_CHIN_Y 分给头发或衣服，其余前景归衣服。
 */
export function computeSemanticMask(pixels: Rgb[]): Uint8Array {
  const { backgroundMask, foregroundMask } = estimateForeground(pixels);
  const outline = analyzePixelOutline(pixels, backgroundMask, foregroundMask);
  const face = analyzeFace(pixels, outline.outlineColors);

  const claimed = new Set<number>();
  outline.outlineMask.forEach((enabled, i) => {
    if (enabled) claimed.add(i);
  });
  const regions = face ? claimFaceRegions(pixels, foregroundMask, claimed, face) : null;
  const chinY = face ? face.chinY : FALLBACK_CHIN_Y;

  return resolveSemanticMask(foregroundMask, outline.outlineMask, regions, chinY);
}
