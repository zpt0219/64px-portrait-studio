/**
 * 全局类型与 5 分区元数据
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
interface ZoneMeta {
  zone: SemanticZone;
  name: string;        // 中英文全称，如「头发 (Hair)」
  shortName: string;   // 中文简称，如「头发」
  color: string;       // 界面、覆盖层与导出遮罩配色 (HEX)
  hotkey: string;
}

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

/** 分区面板与「全部显示」使用的顺序 */
export const ALL_ZONES: SemanticZone[] = [
  SemanticZone.Hair,
  SemanticZone.Skin,
  SemanticZone.Eyes,
  SemanticZone.Clothes,
  SemanticZone.Background,
];

/** 工程 ZIP / LocalStorage 存储的统一数据结构 */
export interface ImageGemProjectData {
  v: number;                    // Schema 版本号 (1)
  palette: string[];            // 36 色 Hex 数组
  pixels: string;               // Base64(Uint8Array[4096]) — 色板索引 0~35 或 255 (透明)
  mask: string;                 // Base64(Uint8Array[4096]) — 语义分区 0~4
  hairPreset: string | null;    // 当前发色预设 key
  ts: number;                   // Unix 时间戳 (秒)
}

/** 撤销快照 (像素与遮罩双模式共享统一栈) */
export interface UndoSnapshot {
  pixelIndices: Uint8Array;     // 深拷贝 (4096 bytes)
  semanticMask: Uint8Array;     // 深拷贝 (4096 bytes)
  currentHairPreset?: string | null;
  selection?: RectSelection | null; // 选区快照
  palette?: string[];           // 色板快照 (36 色 Hex)
}

/** 运行时全局工作台状态 */
export interface StudioState {
  palette: string[];            // 当前 36 色色板 (可微调)
  pixelIndices: Uint8Array;     // 4096 像素 → 色板索引 (0~35, 255 为透明)
  semanticMask: Uint8Array;     // 4096 像素 → 语义分区 (0~4)
  currentHairPreset: string | null;
  activeMode: 'pixel' | 'mask'; // 当前工作模式
  activePaletteIndex: number;   // 前景色：当前选中的色板索引 (0~35 或 255 透明，鼠标左键绘制)
  bgPaletteIndex: number;       // 背景色：次选色板索引 (0~35 或 255 透明，鼠标右键绘制，默认 255 即透明)
  activeZone: SemanticZone;     // 遮罩模式：当前选中的分区类型 (0~4)
  showMaskOverlay: boolean;     // 是否显示半透明遮罩覆层
  visibleMaskZones: SemanticZone[]; // 多选可见的遮罩分区 (0~4)
  lockedMaskZones?: SemanticZone[]; // 上锁保护的遮罩分区 (禁止被其他遮罩或橡皮擦覆盖)
  activeMaskTool?: 'pen' | 'eraser' | 'bucket' | 'box_select'; // 遮罩工具：画笔 vs 橡皮擦 vs 油漆桶 vs 智能框选 (默认 'pen')
  maskMatchColors?: number[];   // 智能框选匹配色组 (色板索引列表 0~35 或 255)
  maskMatchPresetKey?: string;  // 匹配色组预设 Key
  maskBrushSize: 1 | 2 | 3 | 4; // 遮罩笔刷尺寸 (1, 2, 3, 4，默认 1)
  maskOpacity: number;          // 遮罩覆盖层透明度 0~1
  showGrid: boolean;            // 是否显示像素网格
  zoomLevel: number;            // 画布缩放倍数 (4, 6, 8, 12, 16, 24, 32)
  undoStack: UndoSnapshot[];    // 撤销栈 (上限 40)
  redoStack: UndoSnapshot[];    // 重做栈
  activeTool: 'pen' | 'eraser' | 'bucket' | 'eyedropper' | 'select'; // 当前修图工具：画笔 / 橡皮擦 / 油漆桶 / 吸管 / 矩形选区
  bucketConnectivity: 8 | 4;                             // 油漆桶连通邻域：8 邻居 (默认) 或 4 邻居
  isLoaded: boolean;            // 是否已载入有效头像
}

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
