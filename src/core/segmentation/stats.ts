import { Rgb } from '../../utils/colorUtils';
import { IMAGE_WIDTH as W, PIXEL_COUNT, floodMask, sideAndTopOffsets } from '../pixelGrid';
import { Bbox } from './types';

import { percentile, percentileInt, median, mean, clamp } from '../../utils/mathUtils';

export { percentile, percentileInt, median, mean, clamp };

export const xOf = (offset: number) => offset % W;
export const yOf = (offset: number) => Math.floor(offset / W);
export const sameRgb = (a: Rgb, b: Rgb) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
export const rgbKey = (c: Rgb) => `${c[0]},${c[1]},${c[2]}`;

export function isFaceSkin(rgb: Rgb): boolean {
  const [red, green, blue] = rgb;
  return (
    red >= 230 &&
    green >= 195 &&
    green <= 248 &&
    blue >= 175 &&
    blue <= 240 &&
    red - green >= 7 &&
    red - green <= 60 &&
    red - blue >= 8 &&
    Math.abs(green - blue) <= 48
  );
}

function isBackgroundWhite(rgb: Rgb): boolean {
  const minC = Math.min(rgb[0], rgb[1], rgb[2]);
  const maxC = Math.max(rgb[0], rgb[1], rgb[2]);
  return minC >= 239 && maxC - minC <= 20;
}

/** 从上、左、右三边连通进来的近白像素 */
export function exteriorWhiteMask(pixels: Rgb[]): boolean[] {
  return floodMask(pixels.map(isBackgroundWhite), sideAndTopOffsets());
}

/** 矩形内满足条件的像素掩码 */
export function maskInRect(rect: Bbox, test: (offset: number) => boolean): boolean[] {
  const [left, top, right, bottom] = rect;
  return Array.from({ length: PIXEL_COUNT }, (_, offset) => {
    const x = xOf(offset);
    const y = yOf(offset);
    return x >= left && x <= right && y >= top && y <= bottom && test(offset);
  });
}
