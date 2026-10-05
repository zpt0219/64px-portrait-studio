/**
 * 核心领域类型定义
 */

/** 5 分区语义遮罩值 */
export const enum SemanticZone {
  Background = 0,
  Hair = 1,
  Skin = 2,
  Eyes = 3,
  Clothes = 4,
}

/** 5 分区配置信息与规范配色 */
export interface ZoneMeta {
  zone: SemanticZone;
  name: string;        // 中英文全称，如「头发 (Hair)」
  shortName: string;   // 中文简称，如「头发」
  color: string;       // 界面、覆盖层与导出遮罩配色 (HEX)
  hotkey: string;
}

/** 9 种内置发色预设键名 */
export type HairPresetKey =
  | '01_black_黑'
  | '02_brown_棕'
  | '03_blonde_金'
  | '04_pink_粉'
  | '05_blue_蓝'
  | '06_silver_银白'
  | '07_green_绿'
  | '08_purple_紫'
  | '09_red_红';

/** 工程 ZIP / LocalStorage 存储的统一数据结构 */
export interface ProjectData {
  v: number;                    // Schema 版本号 (1)
  palette: string[];            // 36 色 Hex 数组
  pixels: string;               // Base64(Uint8Array[4096]) — 色板索引 0~35 或 255 (透明)
  mask: string;                 // Base64(Uint8Array[4096]) — 语义分区 0~4
  hairPreset: HairPresetKey | null; // 当前发色预设 key
  ts: number;                   // Unix 时间戳 (秒)
}

export type PixelTool = 'pen' | 'eraser' | 'bucket' | 'eyedropper' | 'select';
export type MaskTool = 'pen' | 'eraser' | 'bucket' | 'box_select';
export type EditorMode = 'pixel' | 'mask';
export type BrushSize = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** 画布矩形选区 */
export interface RectSelection {
  x: number;                    // 起始 X (0~63)
  y: number;                    // 起始 Y (0~63)
  w: number;                    // 选区宽度 (1~64)
  h: number;                    // 选区高度 (1~64)
}

/** 发色色阶定义 */
export interface RampInfo {
  name: string;
  icon: string;
  hexes: string[];
}

/** 已按导入规则缩放、居中绘制到 64×64 的图片像素 */
export interface DecodedImage {
  rgba: Uint8ClampedArray; // 64×64×4
  origW: number;
  origH: number;
  targetW: number;
  targetH: number;
}

/** 色系分组定义 */
export interface PaletteFamily {
  id: string;
  name: string;
  icon: string;
  indices: number[];
}

/** 框选匹配预设定义 */
export interface MatchColorPreset {
  id: string;
  name: string;
  icon: string;
  getIndices: (palette: string[], currentHairPreset?: HairPresetKey | null) => number[];
}

export type { ToastLevel, SaveStatus } from '../command/events';
