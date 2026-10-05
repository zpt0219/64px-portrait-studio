/**
 * 把用户选择的图片文件解码并缩放居中到目标尺寸 (默认 64×64，需要 DOM 的 Image / canvas，所以不放在 ViewModel)
 */

import { DecodedImage } from '../../core/types';
import { IMAGE_WIDTH } from '../../core/constants';
import { guessMimeType, loadImage } from './domUtils';

/**
 * 各维度 ≤ targetWidth/targetHeight 时保持原尺寸，否则等比缩放到目标尺寸以内，居中放入透明画布。
 * 返回 null 表示读不到有效尺寸。
 */
export async function decodeImageFile(
  file: File,
  targetWidth: number = IMAGE_WIDTH,
  targetHeight: number = targetWidth,
  maxPixelArtScale: number = 4
): Promise<DecodedImage | null> {
  const img = await loadImage(await file.arrayBuffer(), guessMimeType(file));
  const origW = img.naturalWidth || img.width;
  const origH = img.naturalHeight || img.height;
  if (!origW || !origH) return null;

  let targetW = origW;
  let targetH = origH;
  if (origW > targetWidth || origH > targetHeight) {
    const scale = Math.min(targetWidth / origW, targetHeight / origH);
    targetW = Math.max(1, Math.min(targetWidth, Math.round(origW * scale)));
    targetH = Math.max(1, Math.min(targetHeight, Math.round(origH * scale)));
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, targetWidth, targetHeight);
  // 判定是否属于整数倍放大的像素画素材：宽高均能整除且放大倍数在设定上限以内
  const isPixelArtScaled =
    origW % targetW === 0 &&
    origH % targetH === 0 &&
    origW <= targetWidth * maxPixelArtScale;

  if (isPixelArtScaled) {
    ctx.imageSmoothingEnabled = false;
  } else {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }
  ctx.drawImage(
    img,
    Math.floor((targetWidth - targetW) / 2),
    Math.floor((targetHeight - targetH) / 2),
    targetW,
    targetH
  );

  return { rgba: ctx.getImageData(0, 0, targetWidth, targetHeight).data, origW, origH, targetW, targetH };
}
