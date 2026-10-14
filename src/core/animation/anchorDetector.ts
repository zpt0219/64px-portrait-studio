/**
 * 面部关键特征 (双眼、嘴部) 与代表色自动检测与锚定
 */

import { PortraitDocument } from '../document';
import { SemanticZone } from '../types';
import { IMAGE_WIDTH as W, IMAGE_HEIGHT as H, connectedComponents } from '../pixelGrid';
import { FacialAnchors, RectBbox } from './types';
import { hexToRgb } from '../../utils/colorUtils';

/** 限制坐标在 [0, 63] 范围内 */
function clampCoord(n: number): number {
  return Math.max(0, Math.min(63, Math.round(n)));
}

/** 规范化包围盒 */
export function normalizeBbox(minX: number, minY: number, maxX: number, maxY: number, minW = 4, minH = 3): RectBbox {
  let x1 = clampCoord(Math.min(minX, maxX));
  let y1 = clampCoord(Math.min(minY, maxY));
  let x2 = clampCoord(Math.max(minX, maxX));
  let y2 = clampCoord(Math.max(minY, maxY));

  if (x2 - x1 + 1 < minW) {
    const pad = Math.ceil((minW - (x2 - x1 + 1)) / 2);
    x1 = clampCoord(x1 - pad);
    x2 = clampCoord(x2 + pad);
  }
  if (y2 - y1 + 1 < minH) {
    const pad = Math.ceil((minH - (y2 - y1 + 1)) / 2);
    y1 = clampCoord(y1 - pad);
    y2 = clampCoord(y2 + pad);
  }
  return [x1, y1, x2, y2];
}

/** 颜色相对亮度 (0~255) */
function colorLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 检测双眼包围盒 */
function detectEyeBboxes(doc: PortraitDocument): { left: RectBbox; right: RectBbox } {
  const { semanticMask, pixelIndices } = doc;
  const eyeOffsets: number[] = [];

  for (let i = 0; i < semanticMask.length; i++) {
    if (semanticMask[i] === SemanticZone.Eyes && pixelIndices[i] !== 255) {
      eyeOffsets.push(i);
    }
  }

  // 1. 若蒙版中有标注眼睛像素
  if (eyeOffsets.length >= 4) {
    const maskBool = new Array(semanticMask.length).fill(false);
    for (const off of eyeOffsets) maskBool[off] = true;
    const comps = connectedComponents(maskBool, false).sort((a, b) => b.length - a.length);

    if (comps.length >= 2) {
      // 找到两个最大的眼睛连通块
      const comp1 = comps[0];
      const comp2 = comps[1];
      const xs1 = comp1.map((o) => o % W);
      const xs2 = comp2.map((o) => o % W);

      const cx1 = xs1.reduce((a, b) => a + b, 0) / xs1.length;
      const cx2 = xs2.reduce((a, b) => a + b, 0) / xs2.length;

      const leftComp = cx1 < cx2 ? comp1 : comp2;
      const rightComp = cx1 < cx2 ? comp2 : comp1;

      const lXs = leftComp.map((o) => o % W);
      const lYs = leftComp.map((o) => Math.floor(o / W));
      const rXs = rightComp.map((o) => o % W);
      const rYs = rightComp.map((o) => Math.floor(o / W));

      return {
        left: normalizeBbox(Math.min(...lXs) - 1, Math.min(...lYs) - 1, Math.max(...lXs) + 1, Math.max(...lYs) + 1, 6, 5),
        right: normalizeBbox(Math.min(...rXs) - 1, Math.min(...rYs) - 1, Math.max(...rXs) + 1, Math.max(...rYs) + 1, 6, 5),
      };
    } else if (comps.length === 1) {
      // 只有一个标注眼（如只标了一侧或两眼连通）
      const comp = comps[0];
      const xs = comp.map((o) => o % W);
      const ys = comp.map((o) => Math.floor(o / W));
      const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      if (cx >= 32) {
        // 标注的是右眼，在对称位置寻找左眼
        const rightBbox = normalizeBbox(Math.min(...xs) - 1, minY - 1, Math.max(...xs) + 1, maxY + 1, 6, 5);
        // 在对称区域搜索高频瞳色
        const searchMinX = clampCoord(Math.max(10, 32 - (rightBbox[2] - 32) - 8));
        const searchMaxX = clampCoord(Math.min(31, 32 - (rightBbox[0] - 32) + 4));
        const foundXs: number[] = [];
        const foundYs: number[] = [];

        for (let y = rightBbox[1]; y <= rightBbox[3]; y++) {
          for (let x = searchMinX; x <= searchMaxX; x++) {
            const p = pixelIndices[y * W + x];
            if (p !== 255 && (p === 0 || p === 1 || p === 2 || (p >= 23 && p <= 29))) {
              foundXs.push(x);
              foundYs.push(y);
            }
          }
        }

        const leftBbox = foundXs.length >= 3
          ? normalizeBbox(Math.min(...foundXs) - 1, Math.min(...foundYs) - 1, Math.max(...foundXs) + 1, Math.max(...foundYs) + 1, 6, 5)
          : normalizeBbox(Math.max(0, 32 - (rightBbox[2] - 32)), rightBbox[1], Math.min(31, 32 - (rightBbox[0] - 32)), rightBbox[3], 6, 5);

        return { left: leftBbox, right: rightBbox };
      } else {
        // 标注的是左眼，在对称位置寻找右眼
        const leftBbox = normalizeBbox(Math.min(...xs) - 1, minY - 1, Math.max(...xs) + 1, maxY + 1, 6, 5);
        const searchMinX = clampCoord(Math.max(32, 32 + (32 - leftBbox[2]) - 4));
        const searchMaxX = clampCoord(Math.min(54, 32 + (32 - leftBbox[0]) + 8));
        const foundXs: number[] = [];
        const foundYs: number[] = [];

        for (let y = leftBbox[1]; y <= leftBbox[3]; y++) {
          for (let x = searchMinX; x <= searchMaxX; x++) {
            const p = pixelIndices[y * W + x];
            if (p !== 255 && (p === 0 || p === 1 || p === 2 || (p >= 23 && p <= 29))) {
              foundXs.push(x);
              foundYs.push(y);
            }
          }
        }

        const rightBbox = foundXs.length >= 3
          ? normalizeBbox(Math.min(...foundXs) - 1, Math.min(...foundYs) - 1, Math.max(...foundXs) + 1, Math.max(...foundYs) + 1, 6, 5)
          : normalizeBbox(Math.max(32, 32 + (32 - leftBbox[2])), leftBbox[1], Math.min(63, 32 + (32 - leftBbox[0])), leftBbox[3], 6, 5);

        return { left: leftBbox, right: rightBbox };
      }
    }
  }

  // 2. 蒙版中无眼睛，基于像素色彩在面部常规区域扫描搜索
  const eyeColorSet = new Set([0, 1, 2, 23, 24, 25, 26, 27, 28, 29]);
  const leftCandidates: { x: number; y: number }[] = [];
  const rightCandidates: { x: number; y: number }[] = [];

  for (let y = 24; y <= 34; y++) {
    for (let x = 15; x <= 48; x++) {
      const p = pixelIndices[y * W + x];
      if (eyeColorSet.has(p)) {
        if (x < 32) leftCandidates.push({ x, y });
        else rightCandidates.push({ x, y });
      }
    }
  }

  let leftBbox: RectBbox;
  let rightBbox: RectBbox;

  if (leftCandidates.length >= 3) {
    const xs = leftCandidates.map((c) => c.x);
    const ys = leftCandidates.map((c) => c.y);
    leftBbox = normalizeBbox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 6, 5);
  } else {
    leftBbox = [18, 27, 25, 32];
  }

  if (rightCandidates.length >= 3) {
    const xs = rightCandidates.map((c) => c.x);
    const ys = rightCandidates.map((c) => c.y);
    rightBbox = normalizeBbox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 6, 5);
  } else {
    rightBbox = [30, 27, 37, 32];
  }

  return { left: leftBbox, right: rightBbox };
}

/** 检测嘴部包围盒 */
function detectMouthBbox(doc: PortraitDocument, leftEye: RectBbox, rightEye: RectBbox): RectBbox {
  const { pixelIndices } = doc;
  const midEyeX = (leftEye[0] + leftEye[2] + rightEye[0] + rightEye[2]) / 4;
  const maxEyeY = Math.max(leftEye[3], rightEye[3]);

  // 在双眼下方 4~15 像素之间搜索唇色像素 (粉、红、暗酒红)
  const mouthCandidates: { x: number; y: number }[] = [];
  const lipColors = new Set([10, 11, 12, 13, 14, 15, 30, 31, 32, 33, 34, 35, 0, 2]);

  const searchTop = clampCoord(maxEyeY + 4);
  const searchBottom = clampCoord(maxEyeY + 14);
  const searchLeft = clampCoord(midEyeX - 6);
  const searchRight = clampCoord(midEyeX + 6);

  for (let y = searchTop; y <= searchBottom; y++) {
    for (let x = searchLeft; x <= searchRight; x++) {
      const p = pixelIndices[y * W + x];
      if (lipColors.has(p)) {
        mouthCandidates.push({ x, y });
      }
    }
  }

  if (mouthCandidates.length > 0) {
    const xs = mouthCandidates.map((c) => c.x);
    const ys = mouthCandidates.map((c) => c.y);
    return normalizeBbox(Math.min(...xs) - 1, Math.min(...ys), Math.max(...xs) + 1, Math.max(...ys) + 1, 6, 3);
  }

  // 默认位置
  return normalizeBbox(midEyeX - 3, maxEyeY + 7, midEyeX + 3, maxEyeY + 9, 6, 3);
}

/** 提取代表性肤色、睫毛色、口腔内部色与唇色 */
function extractColors(
  doc: PortraitDocument,
  leftEye: RectBbox,
  rightEye: RectBbox,
  mouth: RectBbox
): { skinToneIndex: number; eyelashColorIndex: number; mouthInteriorIndex: number; mouthLipIndex: number } {
  const { pixelIndices, palette, semanticMask } = doc;

  // 1. 肤色：在双眼周围环形区域统计出现最多的肤色
  const skinCounts = new Map<number, number>();
  const scanBboxes = [leftEye, rightEye];

  for (const [minX, minY, maxX, maxY] of scanBboxes) {
    for (let y = Math.max(0, minY - 2); y <= Math.min(H - 1, maxY + 2); y++) {
      for (let x = Math.max(0, minX - 2); x <= Math.min(W - 1, maxX + 2); x++) {
        const off = y * W + x;
        const p = pixelIndices[off];
        if (p === 255) continue;
        if (semanticMask[off] === SemanticZone.Skin || (p >= 7 && p <= 9)) {
          skinCounts.set(p, (skinCounts.get(p) || 0) + 1);
        }
      }
    }
  }

  let skinToneIndex = 8; // 默认 #FFDECE
  let maxSkinCount = 0;
  for (const [idx, count] of skinCounts.entries()) {
    if (count > maxSkinCount) {
      maxSkinCount = count;
      skinToneIndex = idx;
    }
  }

  // 2. 睫毛闭眼深色：双眼顶部像素中亮度最低的颜色
  let eyelashColorIndex = 0; // 默认 #000000
  let minLum = Infinity;
  for (const [minX, minY, maxX] of scanBboxes) {
    for (let x = minX; x <= maxX; x++) {
      const p = pixelIndices[minY * W + x];
      if (p !== 255 && palette[p]) {
        const lum = colorLuminance(palette[p]);
        if (lum < minLum) {
          minLum = lum;
          eyelashColorIndex = p;
        }
      }
    }
  }
  // 若未找到足够深的颜色，使用色板中最暗的中性色或黑色
  if (minLum > 80) {
    const darkIdx = palette.findIndex((hex) => colorLuminance(hex) < 30);
    if (darkIdx >= 0) eyelashColorIndex = darkIdx;
  }

  // 3. 嘴唇固有色
  const lipCounts = new Map<number, number>();
  for (let y = mouth[1]; y <= mouth[3]; y++) {
    for (let x = mouth[0]; x <= mouth[2]; x++) {
      const p = pixelIndices[y * W + x];
      if (p !== 255 && p !== skinToneIndex) {
        lipCounts.set(p, (lipCounts.get(p) || 0) + 1);
      }
    }
  }

  let mouthLipIndex = 11; // 默认 #8C1031
  let maxLipCount = 0;
  for (const [idx, count] of lipCounts.entries()) {
    if (count > maxLipCount) {
      maxLipCount = count;
      mouthLipIndex = idx;
    }
  }

  // 4. 口腔内部暗色：在色板中选一个较深的暗红/暗棕色
  const interiorCandidates = [10, 11, 14, 0, 2];
  let mouthInteriorIndex = interiorCandidates[0];
  for (const cand of interiorCandidates) {
    if (cand < palette.length && cand !== skinToneIndex) {
      mouthInteriorIndex = cand;
      break;
    }
  }

  return { skinToneIndex, eyelashColorIndex, mouthInteriorIndex, mouthLipIndex };
}

/**
 * 核心对外入口：自动检测与定位面部关键特征锚点
 */
export function detectFacialAnchors(doc: PortraitDocument): FacialAnchors {
  const { left, right } = detectEyeBboxes(doc);
  const mouth = detectMouthBbox(doc, left, right);
  const colors = extractColors(doc, left, right, mouth);

  return {
    leftEyeBbox: left,
    rightEyeBbox: right,
    mouthBbox: mouth,
    skinToneIndex: colors.skinToneIndex,
    eyelashColorIndex: colors.eyelashColorIndex,
    mouthInteriorIndex: colors.mouthInteriorIndex,
    mouthLipIndex: colors.mouthLipIndex,
  };
}
