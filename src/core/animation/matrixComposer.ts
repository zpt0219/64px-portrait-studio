/**
 * 3×3 复合状态矩阵合成器 (Eye × Mouth)
 */

import { IMAGE_WIDTH as W } from '../pixelGrid';
import { FacialAnchors, EyeFrameset, MouthFrameset, EyeFrame, MouthFrame } from './types';

/**
 * 将特定眼部帧与嘴型帧合成为单个 64×64 像素帧
 */
export function composeFrame(
  basePixels: Uint8Array,
  eyeFrame: Uint8Array,
  mouthFrame: Uint8Array,
  anchors: FacialAnchors
): Uint8Array {
  const result = new Uint8Array(basePixels);
  const { leftEyeBbox, rightEyeBbox, mouthBbox } = anchors;

  // 1. 将眼睛局部变化拷贝至结果
  const eyeBboxes = [leftEyeBbox, rightEyeBbox];
  for (const [minX, minY, maxX, maxY] of eyeBboxes) {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * W + x;
        result[idx] = eyeFrame[idx];
      }
    }
  }

  // 2. 将嘴巴局部变化拷贝至结果 (略扩 2 行以包容下唇移动)
  const [mMinX, mMinY, mMaxX, mMaxY] = mouthBbox;
  const mouthExtendedY = Math.min(63, mMaxY + 2);
  for (let y = mMinY; y <= mouthExtendedY; y++) {
    for (let x = mMinX; x <= mMaxX; x++) {
      const idx = y * W + x;
      result[idx] = mouthFrame[idx];
    }
  }

  return result;
}

/**
 * 合成完整的 3×3 (共 9 状态) 矩阵
 * matrix[eyeIdx 0..2][mouthIdx 0..2]
 * eyeIdx: 0=open, 1=half, 2=closed
 * mouthIdx: 0=closed, 1=half, 2=open
 */
export function composeMatrix(
  basePixels: Uint8Array,
  eyeFrames: EyeFrameset,
  mouthFrames: MouthFrameset,
  anchors: FacialAnchors
): Uint8Array[][] {
  const matrix: Uint8Array[][] = [];

  const eyeList: EyeFrame[] = ['open', 'half', 'closed'];
  const mouthList: MouthFrame[] = ['closed', 'half', 'open'];

  for (let e = 0; e < 3; e++) {
    const row: Uint8Array[] = [];
    const eyePixels = eyeFrames[eyeList[e]];
    for (let m = 0; m < 3; m++) {
      const mouthPixels = mouthFrames[mouthList[m]];
      row.push(composeFrame(basePixels, eyePixels, mouthPixels, anchors));
    }
    matrix.push(row);
  }

  return matrix;
}
