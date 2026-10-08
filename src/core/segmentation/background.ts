import { Rgb, Lab, rgbToOklab, oklabDistance } from '../../utils/colorUtils';
import { borderOffsets, floodMask } from '../pixelGrid';
import { median, percentile } from './stats';

/**
 * 画布边界背景识别模型阈值参数
 */
export const BACKGROUND_MODEL = {
  /** OKLab 颜色空间中聚类搜索半径：边框像素色差在 0.08 以内视为同一颜色簇 */
  clusterRadius: 0.08,
  /** 聚类内部颜色离散度计算所取的分位数 (90%) */
  spreadPercentile: 0.9,
  /** 背景容差距离下限 (避免阈值过紧导致同色背景截断) */
  thresholdMin: 0.045,
  /** 背景容差距离上限 (避免阈值过宽导致人物边缘渗入背景) */
  thresholdMax: 0.12,
  /** 在分位数离散度基础上附加的安全距离容差 */
  thresholdMargin: 0.025,
};

/**
 * 估算前景与背景区域。
 *
 * 算法过程：
 * 1. 采集画布四边 (252 个边界像素) 的 OKLab 颜色；
 * 2. 统计最大连通颜色簇作为背景代表色；
 * 3. 计算该颜色簇在中位点周围的离散分布，动态确定容差阈值；
 * 4. 从四边边界像素向内部泛洪，命中满足容差的像素标记为背景。
 *
 * @param pixels 长度为 4096 的 RGB 像素数组
 * @returns backgroundMask (背景掩码) 与 foregroundMask (前景掩码)
 */
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
