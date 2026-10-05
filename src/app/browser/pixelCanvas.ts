/**
 * 色板索引像素与分区遮罩的 Canvas 渲染工具
 */

import { TRANSPARENT_INDEX } from '../../core/constants';
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
