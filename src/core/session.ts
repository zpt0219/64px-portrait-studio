/**
 * 会话上下文：工具、颜色、分区显隐 / 锁定、缩放、选区、发色草稿……
 * (对应 tile_map_editor_imgui 的 TileMapHandler 上下文字段)。
 * 不进存档；除选区随撤销快照一起恢复外，其余都不进撤销，由 ViewModel 直接修改后广播 onSessionChanged。
 */

import { SemanticZone, RectSelection, PixelTool, MaskTool, EditorMode, BrushSize, HairPresetKey } from './types';
import { TRANSPARENT_INDEX } from './constants';
import { IMAGE_WIDTH as W, IMAGE_HEIGHT as H } from './pixelGrid';

/** 画布缩放档位 (每像素屏幕像素数) */
export const ZOOM_STEPS = [4, 6, 8, 12, 16, 24, 32] as const;
export const DEFAULT_ZOOM = 12;

export interface EditorSession {
  isLoaded: boolean;            // 是否已载入有效头像
  activeMode: EditorMode;       // 当前工作模式
  activeTool: PixelTool;        // 像素模式工具
  activePaletteIndex: number;   // 前景色 (0~35 或 255 透明，左键绘制)
  bgPaletteIndex: number;       // 背景色 (0~35 或 255 透明，右键绘制)
  bucketConnectivity: 8 | 4;    // 油漆桶连通邻域
  activeZone: SemanticZone;     // 遮罩模式当前分区
  visibleMaskZones: SemanticZone[]; // 覆盖层上显示的分区
  lockedMaskZones: SemanticZone[];  // 上锁保护的分区 (不被其他遮罩或橡皮擦覆盖)
  activeMaskTool: MaskTool;     // 遮罩模式工具
  maskBrushSize: BrushSize;     // 遮罩笔刷尺寸
  maskMatchColors: number[];    // 智能框选匹配色组 (色板索引)
  maskMatchPresetKey: string;   // 匹配色组预设 key ('custom' 为自定义)
  maskMatchInitialized: boolean; // 首次进入遮罩模式时才按预设初始化匹配色组
  maskOpacity: number;          // 遮罩覆盖层透明度 0~1
  showMaskOverlay: boolean;     // 是否显示遮罩覆盖层
  showGrid: boolean;            // 是否显示像素网格
  zoomLevel: number;            // 画布缩放倍数 (见 ZOOM_STEPS)
  selection: RectSelection | null; // 像素模式矩形选区 (随撤销快照恢复)
  hairDraftPreset: HairPresetKey | null;  // 未固化的发色预览；预览像素由文档实时派生
}

export function createInitialSession(): EditorSession {
  return {
    isLoaded: false,
    activeMode: 'pixel',
    activeTool: 'pen',
    activePaletteIndex: 0,
    bgPaletteIndex: TRANSPARENT_INDEX,
    bucketConnectivity: 8,
    activeZone: SemanticZone.Background,
    visibleMaskZones: [],
    lockedMaskZones: [],
    activeMaskTool: 'pen',
    maskBrushSize: 1,
    maskMatchColors: [],
    maskMatchPresetKey: 'all_colors',
    maskMatchInitialized: false,
    maskOpacity: 0.5,
    showMaskOverlay: false,
    showGrid: true,
    zoomLevel: DEFAULT_ZOOM,
    selection: null,
    hairDraftPreset: null,
  };
}

/** 矩形与画布求交；完全落在画布外时返回 null */
export function clampToCanvas(rect: RectSelection): RectSelection | null {
  const x1 = Math.max(0, rect.x);
  const y1 = Math.max(0, rect.y);
  const x2 = Math.min(W, rect.x + rect.w);
  const y2 = Math.min(H, rect.y + rect.h);
  return x2 > x1 && y2 > y1 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
}

export function isInRect(x: number, y: number, rect: RectSelection): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}
