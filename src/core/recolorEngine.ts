/**
 * 发色识别与 4 阶色阶置换 (仅作用于 Hair 分区)
 */

import { SemanticZone, HairPresetKey } from './types';
import { RAMPS_INFO, TRANSPARENT_INDEX, isHairPresetKey } from './constants';
import { hexToRgb, findNearestColor } from './colorUtils';
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
 * 命中像素不足 50 时视为无法识别。
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
 * 把 Hair 分区像素从 sourcePreset 的色阶映射到 targetPreset 的同阶颜色。
 * 核心逻辑：
 * 1. 优先检查当前像素是否属于当前发色色板色 (sourceRamp)，若是，则直接按其色阶序号 (0~3) 映射到目标发色色板对应的阶位；
 * 2. 只有不在当前发色色板里的像素颜色 (或源发色色板未知)，才执行默认算法 (按相对亮度就近匹配目标发色色阶)。
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

  // 若未显式传入有效 sourcePreset，尝试根据遮罩内发色自动识别当前属于哪个预设色板
  const effectiveSourceKey = (sourcePreset && isHairPresetKey(sourcePreset))
    ? sourcePreset
    : detectHairPreset(basePixels, mask, palette);

  const sourceRamp = effectiveSourceKey ? RAMPS_INFO[effectiveSourceKey]?.hexes : undefined;

  for (let i = 0; i < PIXEL_COUNT; i++) {
    if (mask[i] !== SemanticZone.Hair || basePixels[i] === TRANSPARENT_INDEX) continue;
    const rawHex = palette[basePixels[i]];
    const colorHex = rawHex ? rawHex.toUpperCase() : '';

    let tier = -1;
    // 1. 先看是不是当前发色色板色，是的话根据色板序号映射到要换的发色色板色
    if (sourceRamp && sourceRamp.length === targetRamp.length) {
      tier = sourceRamp.findIndex((h) => h.toUpperCase() === colorHex);
    }

    // 2. 不在当前发色色板里的颜色才进行默认算法 (按相对亮度匹配到目标发色色阶)
    if (tier < 0 || tier >= targetRamp.length) {
      tier = nearestTierForColor(colorHex, targetRamp);
    }

    const newHex = targetRamp[tier];
    let newIdx = palette.findIndex((c) => c.toUpperCase() === newHex.toUpperCase());
    if (newIdx === -1) {
      const nearest = findNearestColor(newHex, palette);
      newIdx = palette.findIndex((c) => c.toUpperCase() === nearest.toUpperCase());
    }
    result[i] = newIdx >= 0 ? newIdx : 0;
  }
  return result;
}
