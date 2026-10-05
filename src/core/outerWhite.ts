import { TRANSPARENT_INDEX } from './constants';
import { hexToRgb } from '../utils/colorUtils';
import { floodFill, borderOffsets } from './pixelGrid';
import { SemanticZone } from './types';
import { PortraitDocument } from './document';

/**
 * 计算从画布边缘 4-连通可达的白色背景像素偏移数组 (眼睛分区与锁定分区受保护)
 */
export function findOuterWhiteOffsets(doc: PortraitDocument, lockedZones: SemanticZone[]): number[] {
  const { pixelIndices, semanticMask, palette } = doc;
  const locked = new Set(lockedZones);
  const isBgWhiteOrTransparent = (offset: number): boolean => {
    const idx = pixelIndices[offset];
    if (idx === TRANSPARENT_INDEX) return true; // 透明像素允许通过以连通外围
    if (idx < 0 || idx >= palette.length) return false;
    const zone = semanticMask[offset];
    if (locked.has(zone) || zone === SemanticZone.Eyes) return false; // 保护锁定分区与眼白
    const rgb = hexToRgb(palette[idx]);
    return rgb[0] >= 250 && rgb[1] >= 250 && rgb[2] >= 250;
  };

  return floodFill(borderOffsets(), isBgWhiteOrTransparent).filter(
    (offset) => pixelIndices[offset] !== TRANSPARENT_INDEX
  );
}
