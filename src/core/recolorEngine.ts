/**
 * 发色识别与 4 阶色阶置换 (仅作用于 Hair 分区)
 */

import { SemanticZone, HairPresetKey } from '../types';
import { RAMPS_INFO, TRANSPARENT_INDEX, isHairPresetKey } from '../data/palette';
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

/** 兼容历史 5 色阶色板定义 (用于将旧版工程/外部图像平滑确定性收敛为新 4 阶体系) */
export const LEGACY_5_RAMPS: Record<HairPresetKey, string[]> = {
  "01_black_黑": ["#000000", "#080821", "#081039", "#212142", "#8473A5"],
  "02_brown_棕": ["#080821", "#3A2016", "#7B4239", "#DE6B42", "#FFFFFF"],
  "03_blonde_金": ["#6B0818", "#7B4239", "#C68C31", "#FFDE6B", "#FFFFFF"],
  "04_pink_粉": ["#6B106B", "#B5106B", "#C6218C", "#FFA5B5", "#FFFFFF"],
  "05_blue_蓝": ["#180852", "#08219C", "#0063CE", "#0884D6", "#DEEFEF"],
  "06_silver_银白": ["#080821", "#212142", "#8473A5", "#DEEFEF", "#FFFFFF"],
  "07_green_绿": ["#081039", "#21636B", "#3FA836", "#18CEA5", "#DEEFEF"],
  "08_purple_紫": ["#180852", "#421084", "#6329BD", "#8473A5", "#FFFFFF"],
  "09_red_红": ["#080821", "#6B0818", "#8C1031", "#A51831", "#DE6B42"]
};

/** 5 色阶到 4 色阶的经典收敛映射：0->0(暗), 1->1(影), 2->1(深中合并为影), 3->2(主), 4->3(光) */
const LEGACY_5_TO_4_MAP = [0, 1, 1, 2, 3];

/**
 * 头发区域核心发色投票，识别图像当前属于哪个发色预设 (纯白高光不参与)。
 * 自动同时兼容 4 阶新规范与历史 5 阶色板。命中像素不足 50 时视为无法识别。
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
    const candidateHexes = new Set([
      ...info.hexes.map((h) => h.toUpperCase()),
      ...(LEGACY_5_RAMPS[presetKey] || []).map((h) => h.toUpperCase()),
    ]);
    const score = Array.from(candidateHexes).reduce((sum, uh) => {
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
 * 1. 优先检查当前像素是否属于当前 4 阶发色色板 (sourceRamp)，若是，直接按色阶序号 (0~3) 映射；
 * 2. 若源图像包含旧版 5 色阶历史像素 (如旧工程导入)，按标准 5->4 收敛规则 (深与中合并为影色) 映射；
 * 3. 只有不在任何已知发色色板里的杂色，才执行默认算法 (按相对亮度就近匹配目标发色色阶)。
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
    // 1. 先看是不是当前发色 4 色阶色板色，是的话直接按序号 (0~3) 映射到目标发色对应阶位
    if (sourceRamp && sourceRamp.length === targetRamp.length) {
      tier = sourceRamp.findIndex((h) => h.toUpperCase() === colorHex);
    }

    // 2. 若当前像素来自旧版 5 色阶工程 (如历史归档)，通过 5->4 确定性收敛规则合并 (深与影合并为新影色)
    if (tier < 0 && effectiveSourceKey && LEGACY_5_RAMPS[effectiveSourceKey]) {
      const legacyIdx = LEGACY_5_RAMPS[effectiveSourceKey].findIndex((h) => h.toUpperCase() === colorHex);
      if (legacyIdx >= 0) {
        tier = LEGACY_5_TO_4_MAP[legacyIdx];
      }
    }

    // 3. 不在已知色板里的杂色才走相对亮度就近算法
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
