/**
 * 发色识别与 5 阶色阶置换 (仅作用于 Hair 分区)
 */

import { SemanticZone } from '../types';
import { RAMPS_INFO, TRANSPARENT_INDEX } from '../data/palette';
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
export function detectHairPreset(indices: Uint8Array, mask: Uint8Array, palette: string[]): string | null {
  const hairCounts: Record<string, number> = {};
  for (let i = 0; i < PIXEL_COUNT; i++) {
    if (mask[i] !== SemanticZone.Hair || indices[i] === TRANSPARENT_INDEX) continue;
    const hex = palette[indices[i]];
    if (hex && hex !== '#FFFFFF') {
      hairCounts[hex] = (hairCounts[hex] || 0) + 1;
    }
  }

  let bestPreset: string | null = null;
  let bestScore = 0;
  for (const [presetKey, info] of Object.entries(RAMPS_INFO)) {
    const score = info.hexes.reduce((sum, h) => sum + (h === '#FFFFFF' ? 0 : hairCounts[h] || 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestPreset = presetKey;
    }
  }
  return bestScore >= 50 ? bestPreset : null;
}

/**
 * 把 Hair 分区像素从 sourcePreset 的色阶映射到 targetPreset 的同阶颜色。
 * 始终以未改动的 basePixels 为基准计算，反复切换预设不会累积失真。
 * 像素颜色不在源色阶中 (或源预设未知) 时，按相对亮度映射到最近的阶位。
 */
export function recolorHair(
  basePixels: Uint8Array,
  mask: Uint8Array,
  palette: string[],
  sourcePreset: string | null,
  targetPreset: string
): Uint8Array {
  const result = new Uint8Array(basePixels);
  const targetRamp = RAMPS_INFO[targetPreset]?.hexes;
  if (!targetRamp) return result;
  const sourceRamp = sourcePreset ? RAMPS_INFO[sourcePreset]?.hexes : undefined;

  for (let i = 0; i < PIXEL_COUNT; i++) {
    if (mask[i] !== SemanticZone.Hair || basePixels[i] === TRANSPARENT_INDEX) continue;
    const colorHex = palette[basePixels[i]];

    let tier = -1;
    if (sourceRamp && sourceRamp.length === targetRamp.length) {
      tier = sourceRamp.indexOf(colorHex);
      if (tier < 0) tier = nearestTierForColor(colorHex, sourceRamp);
    }
    if (tier < 0 || tier >= targetRamp.length) {
      tier = nearestTierForColor(colorHex, targetRamp);
    }

    const newHex = targetRamp[tier];
    let newIdx = palette.indexOf(newHex);
    if (newIdx === -1) newIdx = palette.indexOf(findNearestColor(newHex, palette));
    result[i] = newIdx >= 0 ? newIdx : 0;
  }
  return result;
}
