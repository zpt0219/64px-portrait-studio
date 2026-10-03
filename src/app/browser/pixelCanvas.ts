/**
 * 色板索引像素与分区遮罩的 Canvas 渲染工具
 */

import { TRANSPARENT_INDEX } from '../../data/palette';
import { hexToRgb } from '../../core/colorUtils';
import { IMAGE_WIDTH, IMAGE_HEIGHT, PIXEL_COUNT } from '../../core/pixelGrid';

/** 把 64×64 色板索引写入 ctx 左上角 (透明索引写为全透明) */
export function drawIndexedPixels(ctx: CanvasRenderingContext2D, indices: Uint8Array, palette: string[]): void {
  const imgData = ctx.createImageData(IMAGE_WIDTH, IMAGE_HEIGHT);
  const data = imgData.data;
  const paletteRgb = palette.map(hexToRgb);

  for (let i = 0; i < PIXEL_COUNT; i++) {
    const palIdx = indices[i];
    if (palIdx === TRANSPARENT_INDEX) continue; // createImageData 默认全 0 即透明
    const rgb = paletteRgb[palIdx] || [0, 0, 0];
    data.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
  }
  ctx.putImageData(imgData, 0, 0);
}

/** 新建 64×64 canvas 并用 paint 绘制，scale > 1 时最近邻放大 */
export function createScaledCanvas(paint: (ctx: CanvasRenderingContext2D) => void, scale = 1): HTMLCanvasElement {
  const canvas64 = document.createElement('canvas');
  canvas64.width = IMAGE_WIDTH;
  canvas64.height = IMAGE_HEIGHT;
  paint(canvas64.getContext('2d')!);
  if (scale === 1) return canvas64;

  const target = document.createElement('canvas');
  target.width = IMAGE_WIDTH * scale;
  target.height = IMAGE_HEIGHT * scale;
  const ctx = target.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas64, 0, 0, target.width, target.height);
  return target;
}
