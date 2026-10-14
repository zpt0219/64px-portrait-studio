/**
 * 动画 Sprite Sheet 与游戏元数据浏览器导出
 */

import { AnimationProject, GameEngineAnimationMetadata } from '../../core/animation/types';
import { IMAGE_WIDTH as W, IMAGE_HEIGHT as H } from '../../core/pixelGrid';
import { drawIndexedPixels } from './pixelCanvas';
import { canvasToBlob, downloadBlob } from './domUtils';

/**
 * 将 3×3 复合状态矩阵渲染为 192×192 Sprite Sheet Canvas
 * 行: 0=睁眼, 1=半睁, 2=闭眼
 * 列: 0=闭嘴, 1=微张, 2=大张
 */
export function renderMatrixSpriteSheet(project: AnimationProject, palette: string[]): HTMLCanvasElement {
  const sheetCanvas = document.createElement('canvas');
  sheetCanvas.width = 192;
  sheetCanvas.height = 192;
  const ctx = sheetCanvas.getContext('2d')!;

  const cellCanvas = document.createElement('canvas');
  cellCanvas.width = W;
  cellCanvas.height = H;
  const cellCtx = cellCanvas.getContext('2d')!;

  for (let e = 0; e < 3; e++) {
    for (let m = 0; m < 3; m++) {
      const framePixels = project.matrix[e][m];
      cellCtx.clearRect(0, 0, W, H);
      drawIndexedPixels(cellCtx, framePixels, palette);
      ctx.drawImage(cellCanvas, m * W, e * H);
    }
  }

  return sheetCanvas;
}

/**
 * 将单序列 (3 帧) 渲染为 192×64 横向条带 Canvas
 */
export function renderStripSpriteSheet(
  frames: [Uint8Array, Uint8Array, Uint8Array],
  palette: string[]
): HTMLCanvasElement {
  const sheetCanvas = document.createElement('canvas');
  sheetCanvas.width = W * 3;
  sheetCanvas.height = H;
  const ctx = sheetCanvas.getContext('2d')!;

  const cellCanvas = document.createElement('canvas');
  cellCanvas.width = W;
  cellCanvas.height = H;
  const cellCtx = cellCanvas.getContext('2d')!;

  for (let i = 0; i < 3; i++) {
    cellCtx.clearRect(0, 0, W, H);
    drawIndexedPixels(cellCtx, frames[i], palette);
    ctx.drawImage(cellCanvas, i * W, 0);
  }

  return sheetCanvas;
}

/**
 * 生成配套的游戏引擎元数据配置 JSON
 */
export function generateEngineMetadata(layout: 'matrix3x3' | 'strip_horizontal'): GameEngineAnimationMetadata {
  return {
    frameWidth: W,
    frameHeight: H,
    frameCount: layout === 'matrix3x3' ? 9 : 3,
    layout,
    animations: {
      blink: {
        fps: 12,
        frameIndices: [0, 1, 2, 1, 0],
        delaysMs: [3200, 60, 100, 60, 0],
      },
      talk: {
        fps: 10,
        frameIndices: [0, 1, 2, 1],
        loop: true,
        delaysMs: [90, 90, 90, 90],
      },
    },
  };
}

/**
 * 一键下载 3×3 全套 Sprite Sheet PNG
 */
export async function downloadMatrixSpriteSheet(
  project: AnimationProject,
  palette: string[],
  baseName = 'portrait_spritesheet_3x3'
): Promise<void> {
  const canvas = renderMatrixSpriteSheet(project, palette);
  const blob = await canvasToBlob(canvas);
  downloadBlob(blob, `${baseName}.png`);
}

/**
 * 一键下载游戏引擎配置 JSON
 */
export function downloadEngineMetadataJson(
  layout: 'matrix3x3' | 'strip_horizontal' = 'matrix3x3',
  baseName = 'portrait_animation_frames'
): void {
  const meta = generateEngineMetadata(layout);
  const jsonStr = JSON.stringify(meta, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  downloadBlob(blob, `${baseName}.json`);
}
