import { Rgb, rgbToOklab, oklabDistance } from '../colorUtils';
import { IMAGE_WIDTH as W, PIXEL_COUNT, connectedComponents, maskFromOffsets } from '../pixelGrid';
import { Bbox } from './types';
import { rgbKey, sameRgb, isFaceSkin } from './stats';

const HAIR_PALETTE_MODEL = {
  minimumExactColorPixels: 2,
  maximumOklabDistance: 0.04,
  seedHorizontalPadding: 4,
  seedVerticalPadding: 4,
  seedEyeLineExtension: 1,
};

/**
 * 脸框上方到眼线之间 (排除白底 / 眼睛 / 轮廓色 / 肤色) 出现 ≥2 次的颜色组成发色字典，
 * 与字典色相近且与种子区域相连的像素即头发。
 */
export function analyzeHairMask(
  pixels: Rgb[],
  exteriorWhite: boolean[],
  outlineColors: Rgb[],
  faceOutlineBbox: Bbox,
  eyeLineY: number,
  eyeOffsets: Set<number>
): boolean[] {
  const [left, top, right] = faceOutlineBbox;
  const seedBbox: Bbox = [
    Math.max(0, left - HAIR_PALETTE_MODEL.seedHorizontalPadding),
    Math.max(0, top - HAIR_PALETTE_MODEL.seedVerticalPadding),
    Math.min(63, right + HAIR_PALETTE_MODEL.seedHorizontalPadding),
    Math.min(63, eyeLineY + HAIR_PALETTE_MODEL.seedEyeLineExtension),
  ];

  const outlineKeys = new Set(outlineColors.map(rgbKey));
  const seedOffsets = new Set<number>();
  const counts = new Map<string, { count: number; rgb: Rgb }>();

  for (let y = seedBbox[1]; y <= seedBbox[3]; y++) {
    for (let x = seedBbox[0]; x <= seedBbox[2]; x++) {
      const offset = y * W + x;
      const color = pixels[offset];
      const key = rgbKey(color);
      if (exteriorWhite[offset] || eyeOffsets.has(offset) || outlineKeys.has(key) || isFaceSkin(color)) {
        continue;
      }
      seedOffsets.add(offset);
      const item = counts.get(key) || { count: 0, rgb: color };
      item.count++;
      counts.set(key, item);
    }
  }

  const hairColors = Array.from(counts.values())
    .filter((v) => v.count >= HAIR_PALETTE_MODEL.minimumExactColorPixels)
    .map(({ rgb }) => ({ rgb, lab: rgbToOklab(rgb) }));

  if (hairColors.length === 0) return new Array<boolean>(PIXEL_COUNT).fill(false);

  const allowed = pixels.map((color, offset) => {
    if (exteriorWhite[offset]) return false;
    const lab = rgbToOklab(color);
    return hairColors.some(
      (e) => sameRgb(color, e.rgb) || oklabDistance(lab, e.lab) <= HAIR_PALETTE_MODEL.maximumOklabDistance
    );
  });

  const hairOffsets: number[] = [];
  for (const comp of connectedComponents(allowed, true)) {
    if (comp.some((offset) => seedOffsets.has(offset))) hairOffsets.push(...comp);
  }
  return maskFromOffsets(hairOffsets);
}
