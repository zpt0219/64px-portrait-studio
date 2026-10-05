import { TRANSPARENT_INDEX } from './constants';
import { Rgb, hexToRgb } from '../utils/colorUtils';
import { floodFill, borderOffsets } from './pixelGrid';
import { SemanticZone } from './types';
import { PortraitDocument } from './document';

export const DEFAULT_WHITE_THRESHOLD = 250;

/**
 * 快速判断 RGB 颜色是否属于近白背景色 (三通道均达到或超过阈值)
 */
export function isWhiteRgb(rgb: Rgb, threshold: number = DEFAULT_WHITE_THRESHOLD): boolean {
  return rgb[0] >= threshold && rgb[1] >= threshold && rgb[2] >= threshold;
}

/**
 * 计算从画布边缘 4-连通可达的白色背景像素偏移数组 (眼睛分区与锁定分区受保护)
 */
export function findOuterWhiteOffsets(
  doc: PortraitDocument,
  lockedZones: SemanticZone[],
  whiteThreshold: number = DEFAULT_WHITE_THRESHOLD
): number[] {
  const { pixelIndices, semanticMask, palette } = doc;
  const locked = new Set(lockedZones);
  const isBgWhiteOrTransparent = (offset: number): boolean => {
    const idx = pixelIndices[offset];
    if (idx === TRANSPARENT_INDEX) return true; // 透明像素允许通过以连通外围
    if (idx < 0 || idx >= palette.length) return false;
    const zone = semanticMask[offset];
    if (locked.has(zone) || zone === SemanticZone.Eyes) return false; // 保护锁定分区与眼白
    return isWhiteRgb(hexToRgb(palette[idx]), whiteThreshold);
  };

  return floodFill(borderOffsets(), isBgWhiteOrTransparent).filter(
    (offset) => pixelIndices[offset] !== TRANSPARENT_INDEX
  );
}
