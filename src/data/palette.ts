import { RampInfo } from '../types';

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
  "#3A2016", "#7B4239", "#DE6B42", "#C68C31", "#FFDE6B",
  // 6. 青翠 (Green: #19 ~ #22)
  "#21636B", "#3FA836", "#529484", "#18CEA5",
  // 7. 蔚蓝 (Blue: #23 ~ #26)
  "#08219C", "#0063CE", "#0884D6", "#219CAD",
  // 8. 魅紫 (Purple: #27 ~ #29)
  "#180852", "#421084", "#6329BD",
  // 9. 粉樱 (Pink: #30 ~ #35)
  "#310839", "#6B106B", "#B5106B", "#C6218C", "#DE8C94", "#FFA5B5"
];

export const RAMPS_INFO: Record<string, RampInfo> = {
  "01_black_黑": { name: "黑色", icon: "🖤", hexes: ["#000000", "#080821", "#081039", "#212142", "#8473A5"] },
  "02_brown_棕": { name: "棕色", icon: "🤎", hexes: ["#080821", "#3A2016", "#7B4239", "#DE6B42", "#C68C31"] },
  "03_blonde_金": { name: "金色", icon: "💛", hexes: ["#6B0818", "#7B4239", "#C68C31", "#FFDE6B", "#FFFFFF"] },
  "04_pink_粉": { name: "粉色", icon: "💗", hexes: ["#6B106B", "#B5106B", "#C6218C", "#FFA5B5", "#FFFFFF"] },
  "05_blue_蓝": { name: "蓝色", icon: "💙", hexes: ["#180852", "#08219C", "#0063CE", "#0884D6", "#DEEFEF"] },
  "06_silver_银白": { name: "银白", icon: "🤍", hexes: ["#080821", "#212142", "#8473A5", "#DEEFEF", "#FFFFFF"] },
  "07_green_绿": { name: "绿色", icon: "💚", hexes: ["#081039", "#21636B", "#3FA836", "#18CEA5", "#DEEFEF"] },
  "08_purple_紫": { name: "紫色", icon: "💜", hexes: ["#180852", "#421084", "#6329BD", "#8473A5", "#FFFFFF"] },
  "09_red_红": { name: "红色", icon: "❤️", hexes: ["#080821", "#6B0818", "#8C1031", "#CE4242", "#DE6B42"] }
};

export const TIER_NAMES: string[] = ["绝墨轮廓", "基底暗部", "过渡中色", "发丝主色", "极光高光"];

export const WHITE_PALETTE_INDEX = 1; // #FFFFFF 纯白色 (眼白 / 高光 / 服饰白)
export const TRANSPARENT_INDEX = 255; // 原生透明色 (Aseprite 空白像素 / 橡皮擦删除值)

/** 36 色按色相环自然流序分类划分与规范 (连续 0~35 单调递增序号，黑白双色与透明独立排在首行) */
interface PaletteFamily {
  id: string;
  name: string;
  icon: string;
  indices: number[];
}

export const PALETTE_FAMILIES: PaletteFamily[] = [
  {
    id: "base",
    name: "基础",
    icon: "⚪",
    indices: [0, 1, 255] // 纯黑(#00)、纯白(#01)、透明色(255)
  },
  {
    id: "mono",
    name: "中性",
    icon: "🖤",
    indices: [2, 3, 4, 5, 6] // 深暗中性与冷灰/银灰阶
  },
  {
    id: "skin",
    name: "肤色",
    icon: "🧑",
    indices: [7, 8, 9] // 暖肤阴影(#07) -> 润肤色(#08) -> 极浅肤白(#09)
  },
  {
    id: "red",
    name: "绯红",
    icon: "❤️",
    indices: [10, 11, 12, 13] // 暗血红(#10) -> 深宝石红(#11) -> 鲜正红(#12) -> 亮赤红(#13)
  },
  {
    id: "gold",
    name: "金棕",
    icon: "💛",
    indices: [14, 15, 16, 17, 18] // 黑巧栗褐(#14) -> 暖褐棕(#15) -> 焦糖(#16) -> 琥珀金(#17) -> 灿金黄(#18)
  },
  {
    id: "green",
    name: "青翠",
    icon: "💚",
    indices: [19, 20, 21, 22] // 深青墨绿(#19) -> 草木森绿(#20) -> 翡翠中绿(#21) -> 薄荷亮绿(#22)
  },
  {
    id: "blue",
    name: "蔚蓝",
    icon: "💙",
    indices: [23, 24, 25, 26] // 皇家宝蓝(#23) -> 正蓝(#24) -> 亮天蓝(#25) -> 碧青湖蓝(#26)
  },
  {
    id: "purple",
    name: "魅紫",
    icon: "💜",
    indices: [27, 28, 29] // 午夜深紫(#27) -> 皇家暗紫(#28) -> 电光亮紫(#29)
  },
  {
    id: "pink",
    name: "粉樱",
    icon: "💗",
    indices: [30, 31, 32, 33, 34, 35] // 暗紫黑底(#30) -> 深紫红(#31) -> 宝石玫红(#32) -> 艳玫粉(#33) -> 灰樱粉(#34) -> 柔粉白(#35)
  }
];

interface MatchColorPreset {
  id: string;
  name: string;
  icon: string;
  getIndices: (palette: string[], currentHairPreset?: string | null) => number[];
}

export const MATCH_COLOR_PRESETS: MatchColorPreset[] = [
  {
    id: 'current_hair',
    name: '当前发色预设',
    icon: '💇',
    getIndices: (palette, currentHairPreset) => {
      const presetKey = currentHairPreset || Object.keys(RAMPS_INFO)[0];
      const ramp = RAMPS_INFO[presetKey];
      if (!ramp) return [];
      return ramp.hexes
        .map((hex) => palette.indexOf(hex))
        .filter((idx) => idx >= 0);
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
