/**
 * 把用户选择的图片文件解码并缩放居中到 64×64 (需要 DOM 的 Image / canvas，所以不放在 ViewModel)
 */

import { DecodedImage } from '../../types';

function guessMimeType(file: File): string {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.bmp')) return 'image/bmp';
  return 'image/png';
}

function loadImage(buffer: ArrayBuffer, mimeType: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([buffer], { type: mimeType }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

/**
 * 各维度 ≤ 64 时保持原尺寸，否则等比缩放到 64 以内，居中放入 64×64 透明画布。
 * 返回 null 表示读不到有效尺寸。
 */
export async function decodeImageFile(file: File): Promise<DecodedImage | null> {
  const img = await loadImage(await file.arrayBuffer(), guessMimeType(file));
  const origW = img.naturalWidth || img.width;
  const origH = img.naturalHeight || img.height;
  if (!origW || !origH) return null;

  let targetW = origW;
  let targetH = origH;
  const maxDim = Math.max(origW, origH);
  if (maxDim > 64) {
    const scale = 64 / maxDim;
    targetW = Math.max(1, Math.min(64, Math.round(origW * scale)));
    targetH = Math.max(1, Math.min(64, Math.round(origH * scale)));
  }

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, 64, 64);
  // 像素画整数倍缩放用最近邻保真，其余平滑图像用高质量插值
  if (origW % targetW === 0 && origH % targetH === 0 && origW <= 256) {
    ctx.imageSmoothingEnabled = false;
  } else {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }
  ctx.drawImage(img, Math.floor((64 - targetW) / 2), Math.floor((64 - targetH) / 2), targetW, targetH);

  return { rgba: ctx.getImageData(0, 0, 64, 64).data, origW, origH, targetW, targetH };
}
