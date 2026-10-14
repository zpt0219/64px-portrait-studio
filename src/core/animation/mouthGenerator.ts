/**
 * 张嘴对话嘴型动画帧生成器 (Closed -> Half -> Open)
 */

import { IMAGE_WIDTH as W } from '../pixelGrid';
import { FacialAnchors, MouthFrameset, RectBbox } from './types';

function renderMouthHalf(
  pixels: Uint8Array,
  bbox: RectBbox,
  lipColor: number,
  interiorColor: number
): void {
  const [minX, minY, maxX, maxY] = bbox;
  const midX = (minX + maxX) / 2;
  const midY = Math.round((minY + maxY) / 2);

  const openX1 = Math.round(midX - 1);
  const openX2 = Math.round(midX + 1);

  // 左右嘴角保持
  const leftCorner = midY * W + minX;
  const rightCorner = midY * W + maxX;
  if (pixels[leftCorner] !== 255) pixels[leftCorner] = lipColor;
  if (pixels[rightCorner] !== 255) pixels[rightCorner] = lipColor;

  // 嘴中段 1px 微张暗部开口
  for (let x = openX1; x <= openX2; x++) {
    const idx = midY * W + x;
    if (pixels[idx] !== 255) pixels[idx] = interiorColor;

    // 下唇轮廓微移
    const lowerIdx = (midY + 1) * W + x;
    if (lowerIdx < pixels.length && pixels[lowerIdx] !== 255) {
      pixels[lowerIdx] = lipColor;
    }
  }
}

function renderMouthOpen(
  pixels: Uint8Array,
  bbox: RectBbox,
  lipColor: number,
  interiorColor: number
): void {
  const [minX, minY, maxX, maxY] = bbox;
  const midX = (minX + maxX) / 2;
  const midY = Math.round((minY + maxY) / 2);

  const openRadius = Math.max(1, Math.round((maxX - minX) * 0.35));
  const openX1 = Math.max(minX, Math.round(midX - openRadius));
  const openX2 = Math.min(maxX, Math.round(midX + openRadius));

  // 嘴角固定
  const leftCorner = midY * W + minX;
  const rightCorner = midY * W + maxX;
  if (pixels[leftCorner] !== 255) pixels[leftCorner] = lipColor;
  if (pixels[rightCorner] !== 255) pixels[rightCorner] = lipColor;

  // 上层开口腔内闭塞暗影
  for (let x = openX1; x <= openX2; x++) {
    const upperIdx = midY * W + x;
    if (pixels[upperIdx] !== 255) pixels[upperIdx] = interiorColor;

    // 中间层张开 (舌面红润色)
    const midIdx = (midY + 1) * W + x;
    if (midIdx < pixels.length && pixels[midIdx] !== 255) {
      pixels[midIdx] = lipColor;
    }

    // 下唇线向下扩展 1 行
    const lowerIdx = (midY + 2) * W + x;
    if (lowerIdx < pixels.length && pixels[lowerIdx] !== 255) {
      pixels[lowerIdx] = lipColor;
    }
  }
}

/**
 * 为肖像生成闭嘴、微张、大张 3 帧
 */
export function generateMouthFrames(
  basePixels: Uint8Array,
  anchors: FacialAnchors
): MouthFrameset {
  const closed = new Uint8Array(basePixels);
  const half = new Uint8Array(basePixels);
  const open = new Uint8Array(basePixels);

  const { mouthBbox, mouthLipIndex, mouthInteriorIndex } = anchors;

  renderMouthHalf(half, mouthBbox, mouthLipIndex, mouthInteriorIndex);
  renderMouthOpen(open, mouthBbox, mouthLipIndex, mouthInteriorIndex);

  return { closed, half, open };
}
