/**
 * 眨眼动画帧生成器 (Open -> Half -> Closed)
 */

import { IMAGE_WIDTH as W } from '../pixelGrid';
import { SemanticZone } from '../types';
import { FacialAnchors, EyeFrameset, RectBbox } from './types';

function renderEyeHalf(
  pixels: Uint8Array,
  mask: Uint8Array,
  bbox: RectBbox,
  skinTone: number,
  eyelashColor: number
): void {
  const [minX, minY, maxX, maxY] = bbox;
  const halfY = minY + Math.max(1, Math.round((maxY - minY) * 0.45));

  // 上眼睑区域覆盖肤色
  for (let y = minY; y < halfY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = y * W + x;
      if (pixels[idx] !== 255 && mask[idx] !== SemanticZone.Hair) {
        pixels[idx] = skinTone;
      }
    }
  }

  // 下移后的眼线/睫毛
  for (let x = minX; x <= maxX; x++) {
    const idx = halfY * W + x;
    if (pixels[idx] !== 255 && mask[idx] !== SemanticZone.Hair) {
      pixels[idx] = eyelashColor;
    }
  }
}

function renderEyeClosed(
  pixels: Uint8Array,
  mask: Uint8Array,
  bbox: RectBbox,
  skinTone: number,
  eyelashColor: number
): void {
  const [minX, minY, maxX, maxY] = bbox;
  const closedY = minY + Math.max(1, Math.round((maxY - minY) * 0.6));

  // 1. 眼眶区域先由平滑眼睑肤色填充 (保护头发与透明)
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = y * W + x;
      if (pixels[idx] !== 255 && mask[idx] !== SemanticZone.Hair) {
        pixels[idx] = skinTone;
      }
    }
  }

  // 2. 绘制微带弧度的闭合睫毛曲线 (中心略微下弯，两端微扬)
  for (let x = minX; x <= maxX; x++) {
    const isCorner = x === minX || x === maxX;
    const targetY = isCorner ? Math.max(minY, closedY - 1) : Math.min(maxY, closedY);
    const idx = targetY * W + x;
    if (pixels[idx] !== 255 && mask[idx] !== SemanticZone.Hair) {
      pixels[idx] = eyelashColor;
    }
  }
}

/**
 * 为肖像生成睁眼、半睁、完全闭眼 3 帧
 */
export function generateBlinkFrames(
  basePixels: Uint8Array,
  semanticMask: Uint8Array,
  anchors: FacialAnchors
): EyeFrameset {
  const open = new Uint8Array(basePixels);
  const half = new Uint8Array(basePixels);
  const closed = new Uint8Array(basePixels);

  const { leftEyeBbox, rightEyeBbox, skinToneIndex, eyelashColorIndex } = anchors;

  // 渲染半睁
  renderEyeHalf(half, semanticMask, leftEyeBbox, skinToneIndex, eyelashColorIndex);
  renderEyeHalf(half, semanticMask, rightEyeBbox, skinToneIndex, eyelashColorIndex);

  // 渲染闭眼
  renderEyeClosed(closed, semanticMask, leftEyeBbox, skinToneIndex, eyelashColorIndex);
  renderEyeClosed(closed, semanticMask, rightEyeBbox, skinToneIndex, eyelashColorIndex);

  return { open, half, closed };
}
