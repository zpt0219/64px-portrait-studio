import { Rgb, rgbToOklab, oklabDistance } from '../../utils/colorUtils';
import { PIXEL_COUNT, getNeighbours, connectedComponents, maskFromOffsets } from '../pixelGrid';
import { sameRgb, rgbKey } from './stats';

/** 构成有效外轮廓种子段的最小连通像素数量（过滤杂色孤立噪点） */
const OUTLINE_MIN_COMPONENT_PIXELS = 10;
/** 与种子轮廓色合并归类时的最大 OKLab 色差容差 */
const OUTLINE_MAX_OKLAB_DISTANCE = 0.035;

/**
 * 提取像素人物的外轮廓线 (墨线)。
 *
 * 算法过程：
 * 1. 寻找与背景相邻的前景像素候选集；
 * 2. 统计各颜色在该集合中的连通段，满足 ≥10 像素的颜色认定为轮廓墨线色；
 * 3. 沿种子连通段向外扩展，将色差在 0.035 以内的相连像素合并为完整轮廓掩码。
 *
 * @param pixels 图像 RGB 像素
 * @param backgroundMask 背景掩码
 * @param foregroundMask 前景掩码
 * @returns outlineMask (轮廓像素掩码) 与 outlineColors (认定的轮廓颜色列表)
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
