import { Rgb } from '../../utils/colorUtils';
import { IMAGE_WIDTH as W, PIXEL_COUNT, floodMask, sideAndTopOffsets } from '../pixelGrid';
import { Bbox } from './types';

import { percentile, percentileInt, median, mean, clamp } from '../../utils/mathUtils';

export { percentile, percentileInt, median, mean, clamp };

export const xOf = (offset: number) => offset % W;
export const yOf = (offset: number) => Math.floor(offset / W);
export const sameRgb = (a: Rgb, b: Rgb) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
export const rgbKey = (c: Rgb) => `${c[0]},${c[1]},${c[2]}`;

export const SKIN_COLOR_MODEL = {
  minRed: 230,
  minGreen: 195,
  maxGreen: 248,
  minBlue: 175,
  maxBlue: 240,
  minRedGreenDelta: 7,
  maxRedGreenDelta: 60,
  minRedBlueDelta: 8,
  maxGreenBlueDelta: 48,
};

export const BG_WHITE_MODEL = {
  minChannel: 239,
  maxChroma: 20,
};

export function isFaceSkin(rgb: Rgb): boolean {
  const [red, green, blue] = rgb;
  const M = SKIN_COLOR_MODEL;
  return (
    red >= M.minRed &&
    green >= M.minGreen &&
    green <= M.maxGreen &&
    blue >= M.minBlue &&
    blue <= M.maxBlue &&
    red - green >= M.minRedGreenDelta &&
    red - green <= M.maxRedGreenDelta &&
    red - blue >= M.minRedBlueDelta &&
    Math.abs(green - blue) <= M.maxGreenBlueDelta
  );
}

function isBackgroundWhite(rgb: Rgb): boolean {
  const minC = Math.min(rgb[0], rgb[1], rgb[2]);
  const maxC = Math.max(rgb[0], rgb[1], rgb[2]);
  return minC >= BG_WHITE_MODEL.minChannel && maxC - minC <= BG_WHITE_MODEL.maxChroma;
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
