/**
 * 统一核心常量与配置数据表
 */

import {
  SemanticZone,
  ZoneMeta,
  HairPresetKey,
  RampInfo,
  PaletteFamily,
  MatchColorPreset,
} from './types';

export { SemanticZone };

// ===================== 画布与像素规格 =====================
export const IMAGE_WIDTH = 64;
export const IMAGE_HEIGHT = 64;
export const PIXEL_COUNT = IMAGE_WIDTH * IMAGE_HEIGHT; // 4096

// ===================== 特殊色彩与索引 =====================
export const WHITE_PALETTE_INDEX = 1; // #FFFFFF 纯白色 (眼白 / 高光 / 服饰白)
export const TRANSPARENT_INDEX = 255; // 原生透明色 (Aseprite 空白像素 / 橡皮擦删除值)

// ===================== 5 分区语义遮罩配置 =====================
export const ZONE_CONFIG: Record<SemanticZone, ZoneMeta> = {
  [SemanticZone.Background]: {
    zone: SemanticZone.Background,
    name: '背景 (Background)',
    shortName: '背景',
    color: '#64748B',
    hotkey: '0',
  },
  [SemanticZone.Hair]: {
    zone: SemanticZone.Hair,
    name: '头发 (Hair)',
    shortName: '头发',
    color: '#00E5FF',
    hotkey: '1',
  },
  [SemanticZone.Skin]: {
    zone: SemanticZone.Skin,
    name: '皮肤 (Skin)',
    shortName: '皮肤',
    color: '#22C55E',
    hotkey: '2',
  },
  [SemanticZone.Eyes]: {
    zone: SemanticZone.Eyes,
    name: '眼睛 (Eyes)',
    shortName: '眼睛',
    color: '#A855F7',
    hotkey: '3',
  },
  [SemanticZone.Clothes]: {
    zone: SemanticZone.Clothes,
    name: '衣服 (Clothes)',
    shortName: '衣服',
    color: '#FFD600',
    hotkey: '4',
  },
};

export const ALL_ZONES: SemanticZone[] = [
  SemanticZone.Hair,
  SemanticZone.Skin,
  SemanticZone.Eyes,
  SemanticZone.Clothes,
  SemanticZone.Background,
];

// ===================== 36 色默认基准色板 =====================
export const PALETTE_36: string[] = [
  // 1. 基础 (Base: #00 ~ #01, #透 255)
  "#000000", "#FFFFFF",
  // 2. 中性 (Mono: #02 ~ #06)
  "#080821", "#081039", "#212142", "#8473A5", "#DEEFEF",
  // 3. 肤色 (Skin: #07 ~ #09)
  "#E8A682", "#FFDECE", "#FFEFD6",
  // 4. 绯红 (Red: #10 ~ #13)
  "#6B0818", "#8C1031", "#A51831", "#CE4242",
  // 5. 金棕 (Gold: #14 ~ #18)
  "#3A2016", "#7B4239", "#DE6B42", "#F7B529", "#FFDE6B",
  // 6. 青翠 (Green: #19 ~ #22)
  "#21636B", "#105229", "#529484", "#18CEA5",
  // 7. 蔚蓝 (Blue: #23 ~ #26)
  "#08219C", "#0063CE", "#0884D6", "#CEC6DE",
  // 8. 魅紫 (Purple: #27 ~ #29)
  "#180852", "#421084", "#6329BD",
  // 9. 粉樱 (Pink: #30 ~ #35)
  "#310839", "#6B106B", "#B5106B", "#C6218C", "#DE8C94", "#FFA5B5"
];

// ===================== 9 种内置发色方案 =====================
export const RAMPS_INFO: Record<HairPresetKey, RampInfo> = {
  "01_black_黑": { name: "黑色", icon: "🖤", hexes: ["#080821", "#081039", "#212142", "#8473A5"] },
  "02_brown_棕": { name: "棕色", icon: "🤎", hexes: ["#080821", "#3A2016", "#7B4239", "#DE6B42"] },
  "03_blonde_金": { name: "金色", icon: "💛", hexes: ["#6B0818", "#7B4239", "#FFDE6B", "#FFFFFF"] },
  "04_pink_粉": { name: "粉色", icon: "💗", hexes: ["#6B106B", "#C6218C", "#FFA5B5", "#FFFFFF"] },
  "05_blue_蓝": { name: "蓝色", icon: "💙", hexes: ["#180852", "#08219C", "#0884D6", "#DEEFEF"] },
  "06_silver_银白": { name: "银白", icon: "🤍", hexes: ["#080821", "#8473A5", "#DEEFEF", "#FFFFFF"] },
  "07_green_绿": { name: "绿色", icon: "💚", hexes: ["#081039", "#21636B", "#18CEA5", "#DEEFEF"] },
  "08_purple_紫": { name: "紫色", icon: "💜", hexes: ["#180852", "#421084", "#6329BD", "#DEEFEF"] },
  "09_red_红": { name: "红色", icon: "❤️", hexes: ["#080821", "#6B0818", "#A51831", "#E8A682"] }
};

export const TIER_NAMES: string[] = ["绝墨轮廓", "发丝阴影", "发丝主色", "极光高光"];

// ===================== 色系分组与匹配预设 =====================
export const PALETTE_FAMILIES: PaletteFamily[] = [
  { id: "base", name: "基础", icon: "⚪", indices: [0, 1, 255] },
  { id: "mono", name: "中性", icon: "🖤", indices: [2, 3, 4, 5, 6] },
  { id: "skin", name: "肤色", icon: "🧑", indices: [7, 8, 9] },
  { id: "red", name: "绯红", icon: "❤️", indices: [10, 11, 12, 13] },
  { id: "gold", name: "金棕", icon: "💛", indices: [14, 15, 16, 17, 18] },
  { id: "green", name: "青翠", icon: "💚", indices: [19, 20, 21, 22] },
  { id: "blue", name: "蔚蓝", icon: "💙", indices: [23, 24, 25, 26] },
  { id: "purple", name: "魅紫", icon: "💜", indices: [27, 28, 29] },
  { id: "pink", name: "粉樱", icon: "💗", indices: [30, 31, 32, 33, 34, 35] },
];

export const MATCH_COLOR_PRESETS: MatchColorPreset[] = [
  {
    id: 'all_colors',
    name: '全颜色模式 (不包括透明)',
    icon: '🌈',
    getIndices: (palette) => Array.from({ length: Math.min(36, palette.length) }, (_, i) => i),
  },
  {
    id: 'current_hair',
    name: '当前发色预设',
    icon: '💇',
    getIndices: (palette, currentHairPreset) => {
      const presetKey: HairPresetKey = (currentHairPreset && isHairPresetKey(currentHairPreset))
        ? currentHairPreset
        : (Object.keys(RAMPS_INFO)[0] as HairPresetKey);
      const ramp = RAMPS_INFO[presetKey];
      if (!ramp) return [];
      return ramp.hexes
        .map((hex: string) => palette.indexOf(hex))
        .filter((idx: number) => idx >= 0);
    },
  },
  {
    id: 'skin',
    name: '经典肤色组 (3色)',
    icon: '🧑',
    getIndices: () => [7, 8, 9],
  },
  {
    id: 'eyes',
    name: '瞳孔高频色 (深墨/高光)',
    icon: '👀',
    getIndices: (palette) => [0, 1, 2, 23, 24].filter((idx) => idx < palette.length),
  },
  ...PALETTE_FAMILIES.filter((f) => f.id !== 'base' && f.id !== 'skin').map((f) => ({
    id: f.id,
    name: `${f.name}色系 (${f.indices.length}色)`,
    icon: f.icon,
    getIndices: () => f.indices,
  })),
];

export const ZONE_DEFAULT_MATCH_PRESET: Partial<Record<SemanticZone, string>> = {
  [SemanticZone.Hair]: 'current_hair',
  [SemanticZone.Skin]: 'skin',
  [SemanticZone.Eyes]: 'eyes',
};

// ===================== 辅助判断纯函数 =====================
export function isHairPresetKey(key: unknown): key is HairPresetKey {
  return typeof key === 'string' && Object.hasOwn(RAMPS_INFO, key);
}

export function paletteIndexLabel(index: number): string {
  return index === TRANSPARENT_INDEX ? '透' : String(index);
}
