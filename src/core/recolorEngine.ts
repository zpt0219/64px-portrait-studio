/**
 * 发色识别与 4 阶色阶置换 (仅作用于 Hair 分区)
 */

import { SemanticZone, HairPresetKey } from './types';
import { RAMPS_INFO, TRANSPARENT_INDEX, isHairPresetKey } from './constants';
import { hexToRgb, findNearestColor } from '../utils/colorUtils';
import { PIXEL_COUNT } from './pixelGrid';

/** 按相对亮度找出 ramp 中最接近 hex 的阶位 */
export function nearestTierForColor(hex: string, ramp: string[]): number {
  const rgb = hexToRgb(hex);
  const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  let best = 0;
  let bestDistance = Infinity;

  ramp.forEach((candidate, index) => {
    const c = hexToRgb(candidate);
    const d = Math.abs(lum - (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]));
    if (d < bestDistance) {
      bestDistance = d;
      best = index;
    }
  });

  return best;
}

/**
 * 头发区域核心发色投票，识别图像当前属于哪个发色预设 (纯白高光不参与)。
 * 只要最高票数 > 0 即返回对应预设，否则返回 null。
 */
export function detectHairPreset(indices: Uint8Array, mask: Uint8Array, palette: string[]): HairPresetKey | null {
  const hairCounts: Record<string, number> = {};
  for (let i = 0; i < PIXEL_COUNT; i++) {
    if (mask[i] !== SemanticZone.Hair || indices[i] === TRANSPARENT_INDEX) continue;
    const rawHex = palette[indices[i]];
    const hex = rawHex ? rawHex.toUpperCase() : '';
    if (hex && hex !== '#FFFFFF') {
      hairCounts[hex] = (hairCounts[hex] || 0) + 1;
    }
  }

  let bestPreset: HairPresetKey | null = null;
  let bestScore = 0;
  for (const [presetKey, info] of Object.entries(RAMPS_INFO) as [HairPresetKey, (typeof RAMPS_INFO)[HairPresetKey]][]) {
    const score = info.hexes.reduce((sum, h) => {
      const uh = h.toUpperCase();
      return sum + (uh === '#FFFFFF' ? 0 : hairCounts[uh] || 0);
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      bestPreset = presetKey;
    }
  }
  return bestScore > 0 ? bestPreset : null;
}

/**
 * 步骤 A：确定改色参考的有效源预设。
 * 若传入了合法的 sourcePreset 则直接使用；否则从当前像素中自动投票识别。
 */
export function resolveEffectiveSourceKey(
  sourcePreset: HairPresetKey | null,
  basePixels: Uint8Array,
  mask: Uint8Array,
  palette: string[]
): HairPresetKey | null {
  if (sourcePreset && isHairPresetKey(sourcePreset)) {
    return sourcePreset;
  }
  return detectHairPreset(basePixels, mask, palette);
}

/**
 * 步骤 B：为单个头发像素确定目标色阶位 (0~3)。
 * 1. 精确阶位优先：若源色阶存在且与目标阶数一致，匹配像素在源色板的阶位；
 * 2. 亮度兜底：若不在源色板中（或源色板未知），按相对亮度就近匹配目标阶位。
 */
export function resolveTierForPixel(
  colorHex: string,
  sourceRamp: string[] | undefined,
  targetRamp: string[]
): number {
  if (sourceRamp && sourceRamp.length === targetRamp.length) {
    const tier = sourceRamp.findIndex((h) => h.toUpperCase() === colorHex);
    if (tier >= 0 && tier < targetRamp.length) {
      return tier;
    }
  }
  return nearestTierForColor(colorHex, targetRamp);
}

/**
 * 步骤 C：将目标十六进制色号解析为色板索引。
 * 1. 精确匹配优先（大小写归一化）；
 * 2. 缺色时使用 OKLab 最近邻查找兜底。
 */
export function resolvePaletteIndex(targetHex: string, palette: string[]): number {
  const upper = targetHex.toUpperCase();
  const exactIdx = palette.findIndex((c) => c.toUpperCase() === upper);
  if (exactIdx >= 0) return exactIdx;

  const nearest = findNearestColor(targetHex, palette);
  const nearestIdx = palette.findIndex((c) => c.toUpperCase() === nearest.toUpperCase());
  return nearestIdx >= 0 ? nearestIdx : 0;
}

/**
 * 把 Hair 分区像素从 sourcePreset 的色阶映射到 targetPreset 的同阶颜色。
 * 核心流水线：
 * 1. 确认有效源预设 (显式传入或投票识别)；
 * 2. 遍历 Hair 像素，逐像素识别阶位 (精确阶位优先，相对亮度兜底)；
 * 3. 将目标阶位颜色映射回当前色板索引 (精确匹配优先，最近邻兜底)。
 */
export function recolorHair(
  basePixels: Uint8Array,
  mask: Uint8Array,
  palette: string[],
  sourcePreset: HairPresetKey | null,
  targetPreset: HairPresetKey
): Uint8Array {
  const result = new Uint8Array(basePixels);
  if (!isHairPresetKey(targetPreset)) return result;
  const targetRamp = RAMPS_INFO[targetPreset]?.hexes;
  if (!targetRamp) return result;

  const effectiveSourceKey = resolveEffectiveSourceKey(sourcePreset, basePixels, mask, palette);
  const sourceRamp = effectiveSourceKey ? RAMPS_INFO[effectiveSourceKey]?.hexes : undefined;

  for (let i = 0; i < PIXEL_COUNT; i++) {
    if (mask[i] !== SemanticZone.Hair || basePixels[i] === TRANSPARENT_INDEX) continue;
    const rawHex = palette[basePixels[i]];
    const colorHex = rawHex ? rawHex.toUpperCase() : '';

    const tier = resolveTierForPixel(colorHex, sourceRamp, targetRamp);
    const targetHex = targetRamp[tier];
    result[i] = resolvePaletteIndex(targetHex, palette);
  }
  return result;
}
