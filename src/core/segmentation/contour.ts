import { Rgb, rgbToOklab, oklabDistance } from '../../utils/colorUtils';
import { PIXEL_COUNT, getNeighbours, connectedComponents, maskFromOffsets } from '../pixelGrid';
import { sameRgb, rgbKey } from './stats';

const OUTLINE_MIN_COMPONENT_PIXELS = 10;
const OUTLINE_MAX_OKLAB_DISTANCE = 0.035;

/**
 * 与背景相邻的前景像素中，能形成 ≥10 像素连通段的颜色视为轮廓色；
 * 再把与这些颜色相近、且与种子段相连的前景像素并入轮廓。
 */
export function analyzePixelOutline(
  pixels: Rgb[],
  backgroundMask: boolean[],
  foregroundMask: boolean[]
): { outlineMask: boolean[]; outlineColors: Rgb[] } {
  const candidateMask = new Array<boolean>(PIXEL_COUNT).fill(false);
  for (let offset = 0; offset < PIXEL_COUNT; offset++) {
    if (!foregroundMask[offset]) continue;
    for (const nb of getNeighbours(offset, false)) {
      if (backgroundMask[nb]) {
        candidateMask[offset] = true;
        break;
      }
    }
  }

  const countsByColor = new Map<string, { count: number; rgb: Rgb }>();
  for (let offset = 0; offset < PIXEL_COUNT; offset++) {
    if (!candidateMask[offset]) continue;
    const p = pixels[offset];
    const entry = countsByColor.get(rgbKey(p)) || { count: 0, rgb: p };
    entry.count++;
    countsByColor.set(rgbKey(p), entry);
  }

  const sortedCandidates = Array.from(countsByColor.values()).sort((a, b) => b.count - a.count);
  const outlineColors: Rgb[] = [];
  const confirmedSeeds = new Set<number>();

  for (const { count, rgb } of sortedCandidates) {
    if (count < OUTLINE_MIN_COMPONENT_PIXELS) continue;
    const colorMask = candidateMask.map((c, i) => c && sameRgb(pixels[i], rgb));
    const qualifying = connectedComponents(colorMask, true).filter(
      (c) => c.length >= OUTLINE_MIN_COMPONENT_PIXELS
    );
    if (qualifying.length === 0) continue;

    outlineColors.push(rgb);
    for (const comp of qualifying) comp.forEach((offset) => confirmedSeeds.add(offset));
  }

  if (outlineColors.length === 0) {
    return { outlineMask: new Array<boolean>(PIXEL_COUNT).fill(false), outlineColors };
  }

  const colorLabs = outlineColors.map(rgbToOklab);
  const colorMatch = pixels.map((rgb, offset) => {
    if (!foregroundMask[offset]) return false;
    const lab = rgbToOklab(rgb);
    return colorLabs.some((clab) => oklabDistance(lab, clab) <= OUTLINE_MAX_OKLAB_DISTANCE);
  });

  const outlineOffsets: number[] = [];
  for (const comp of connectedComponents(colorMatch, true)) {
    if (comp.some((offset) => confirmedSeeds.has(offset))) outlineOffsets.push(...comp);
  }
  return { outlineMask: maskFromOffsets(outlineOffsets), outlineColors };
}
