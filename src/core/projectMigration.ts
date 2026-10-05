/**
 * 工程版本迁移引擎 (Project Migration Pipeline)
 * 
 * 职责：
 * 1. 识别工程存档的 Schema 版本号 (v)。
 * 2. 对比应用当前支持的 Schema 版本 (CURRENT_PROJECT_VERSION)。
 * 3. 采用链式渐进迁移策略 (如 v1 -> v2 -> v3)，确保历史工程平滑升级。
 */

import { SemanticZone, HairPresetKey } from './types';
import { RAMPS_INFO, TRANSPARENT_INDEX, isHairPresetKey } from './constants';
import { findNearestColor } from '../utils/colorUtils';
import { PIXEL_COUNT } from './pixelGrid';
import { uint8ArrayToBase64, base64ToUint8Array } from './projectData';

/** 当前工作台支持的最新工程 Schema 版本 */
export const CURRENT_PROJECT_VERSION = 2;

/**
 * v1 历史 5 色阶发色定义表
 * 用于精准识别 v1 存档中头发像素的旧阶位 (0:暗, 1:深, 2:影/中, 3:主, 4:光)
 */
export const V1_HAIR_RAMPS: Record<HairPresetKey, string[]> = {
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

/** 5 色阶收敛到 4 色阶的标准法则：深(1)与影(2)合并为统一发丝阴影(1) */
const MAP_5_TO_4 = [0, 1, 1, 2, 3];

/**
 * 针对 v1 头发像素的启发式预设投票探测
 */
function detectV1HairPreset(
  pixels: Uint8Array,
  mask: Uint8Array,
  palette: string[]
): HairPresetKey | null {
  const hairCounts: Record<string, number> = {};
  for (let i = 0; i < PIXEL_COUNT; i++) {
    if (mask[i] !== SemanticZone.Hair || pixels[i] === TRANSPARENT_INDEX) continue;
    const hex = palette[pixels[i]]?.toUpperCase() || '';
    if (hex && hex !== '#FFFFFF') {
      hairCounts[hex] = (hairCounts[hex] || 0) + 1;
    }
  }

  let bestPreset: HairPresetKey | null = null;
  let bestScore = 0;
  for (const [presetKey, ramp5] of Object.entries(V1_HAIR_RAMPS) as [HairPresetKey, string[]][]) {
    const score = ramp5.reduce((sum, h) => {
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
 * 版本迁移阶梯：v1 -> v2 (5 色阶发色全面收敛为经典 4 色阶规范)
 */
export function migrateV1ToV2(raw: Record<string, unknown>): Record<string, unknown> {
  const data = { ...raw };
  const palette = Array.isArray(data.palette) ? (data.palette as string[]).map((c) => String(c).toUpperCase()) : [];

  if (typeof data.pixels !== 'string' || typeof data.mask !== 'string' || palette.length === 0) {
    data.v = 2;
    return data;
  }

  let pixels: Uint8Array;
  let mask: Uint8Array;
  try {
    pixels = base64ToUint8Array(data.pixels);
    mask = base64ToUint8Array(data.mask);
  } catch {
    data.v = 2;
    return data;
  }

  if (pixels.length !== PIXEL_COUNT || mask.length !== PIXEL_COUNT) {
    data.v = 2;
    return data;
  }

  // 识别源发色预设
  const presetKey: HairPresetKey | null = (typeof data.hairPreset === 'string' && isHairPresetKey(data.hairPreset))
    ? data.hairPreset
    : detectV1HairPreset(pixels, mask, palette);

  if (presetKey && V1_HAIR_RAMPS[presetKey] && RAMPS_INFO[presetKey]) {
    const sourceRamp5 = V1_HAIR_RAMPS[presetKey].map((h) => h.toUpperCase());
    const targetRamp4 = RAMPS_INFO[presetKey].hexes.map((h) => h.toUpperCase());

    // 缓存目标 4 阶颜色在 palette 中的索引
    const targetIndices = targetRamp4.map((targetHex) => {
      let idx = palette.findIndex((c) => c === targetHex);
      if (idx === -1) {
        const nearest = findNearestColor(targetHex, palette);
        idx = palette.findIndex((c) => c === nearest.toUpperCase());
      }
      return idx >= 0 ? idx : 0;
    });

    let modified = false;
    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (mask[i] !== SemanticZone.Hair || pixels[i] === TRANSPARENT_INDEX) continue;
      const currentHex = palette[pixels[i]];
      if (!currentHex) continue;

      // 检查是否属于旧 5 色阶
      const tier5Idx = sourceRamp5.indexOf(currentHex);
      if (tier5Idx >= 0) {
        const targetTier4Idx = MAP_5_TO_4[tier5Idx];
        const newPaletteIdx = targetIndices[targetTier4Idx];
        if (pixels[i] !== newPaletteIdx) {
          pixels[i] = newPaletteIdx;
          modified = true;
        }
      }
    }

    if (modified) {
      data.pixels = uint8ArrayToBase64(pixels);
    }
  }

  data.v = 2;
  return data;
}

/** 渐进式版本迁移执行管道注册表 */
type MigratorFn = (raw: Record<string, unknown>) => Record<string, unknown>;

const MIGRATION_PIPELINE: Record<number, MigratorFn> = {
  1: migrateV1ToV2,
  // 未来版本若升级到 v3，在此挂载 2: migrateV2ToV3 即可
};

export interface UpgradeResult {
  data: Record<string, unknown>;
  upgraded: boolean;
  fromVersion: number;
  toVersion: number;
  stepsApplied: string[];
}

/**
 * 工程数据升级主函数：检测版本并逐级升级到 targetVersion
 * 
 * 示例：当前 app 为 v3，输入存档为 v1 -> 自动按顺序执行 v1 -> v2 -> v3
 */
export function upgradeProjectData(
  raw: unknown,
  targetVersion: number = CURRENT_PROJECT_VERSION
): UpgradeResult {
  if (!raw || typeof raw !== 'object') {
    throw new Error('无法升级工程数据：输入不是有效的 JSON 对象');
  }

  const data: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  const rawVersion = typeof data.v === 'number' && Number.isInteger(data.v) ? data.v : 1;

  if (rawVersion > targetVersion) {
    throw new Error(`不支持的未来版本工程 Schema: v${rawVersion} (当前应用最高支持 v${targetVersion})`);
  }

  if (rawVersion <= 0) {
    throw new Error(`无效的工程 Schema 版本号: ${rawVersion}`);
  }

  let currentV = rawVersion;
  const stepsApplied: string[] = [];

  while (currentV < targetVersion) {
    const migrator = MIGRATION_PIPELINE[currentV];
    if (!migrator) {
      throw new Error(`缺少从版本 v${currentV} 到 v${currentV + 1} 的工程升级适配器`);
    }

    const nextData = migrator(data);
    Object.assign(data, nextData);
    stepsApplied.push(`v${currentV} -> v${currentV + 1}`);
    currentV++;
    data.v = currentV;
  }

  return {
    data,
    upgraded: rawVersion < targetVersion,
    fromVersion: rawVersion,
    toVersion: targetVersion,
    stepsApplied,
  };
}
