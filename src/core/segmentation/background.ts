import { Rgb, Lab, rgbToOklab, oklabDistance } from '../../utils/colorUtils';
import { borderOffsets, floodMask } from '../pixelGrid';
import { median, percentile } from './stats';

export const BACKGROUND_MODEL = {
  clusterRadius: 0.08,
  spreadPercentile: 0.9,
  thresholdMin: 0.045,
  thresholdMax: 0.12,
  thresholdMargin: 0.025,
};

/** 取边框像素中最大的 OKLab 颜色簇作为背景色，从四边泛洪得到背景掩码 */
export function estimateForeground(pixels: Rgb[]): { backgroundMask: boolean[]; foregroundMask: boolean[] } {
  const labs = pixels.map(rgbToOklab);
  const offsets = borderOffsets();
  const borderLabs = offsets.map((idx) => labs[idx]);

  const clusterRadius = BACKGROUND_MODEL.clusterRadius;
  let bestCount = -1;
  let bestL = -Infinity;
  let clusterSeed = borderLabs[0];

  for (const candidate of borderLabs) {
    let count = 0;
    for (const val of borderLabs) {
      if (oklabDistance(candidate, val) <= clusterRadius) count++;
    }
    if (count > bestCount || (count === bestCount && candidate[0] > bestL)) {
      bestCount = count;
      bestL = candidate[0];
      clusterSeed = candidate;
    }
  }

  const clusterLabs = borderLabs.filter((val) => oklabDistance(clusterSeed, val) <= clusterRadius);
  const center: Lab = [
    median(clusterLabs.map((l) => l[0])),
    median(clusterLabs.map((l) => l[1])),
    median(clusterLabs.map((l) => l[2])),
  ];

  const spread = percentile(clusterLabs.map((val) => oklabDistance(val, center)), BACKGROUND_MODEL.spreadPercentile);
  const threshold = Math.min(
    BACKGROUND_MODEL.thresholdMax,
    Math.max(BACKGROUND_MODEL.thresholdMin, spread + BACKGROUND_MODEL.thresholdMargin)
  );

  const candidates = labs.map((val) => oklabDistance(val, center) <= threshold);
  const backgroundMask = floodMask(candidates, offsets);
  return { backgroundMask, foregroundMask: backgroundMask.map((bg) => !bg) };
}
