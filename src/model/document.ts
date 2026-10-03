/**
 * 文档：进存档、进撤销的全部数据 (对应 tile_map_editor_imgui 的 TileMap)。
 * 只能通过 command/ 下的命令修改；载入 / 重置时由 ViewModel 整体替换并清空历史。
 */

import { SemanticZone, HairPresetKey } from '../types';
import { PALETTE_36, TRANSPARENT_INDEX } from '../data/palette';
import { PIXEL_COUNT } from '../core/pixelGrid';
import { Layers } from '../core/editOps';

export interface PortraitDocument {
  palette: string[];            // 当前 36 色色板 (可微调)
  pixelIndices: Uint8Array;     // 4096 像素 → 色板索引 (0~35, 255 为透明)
  semanticMask: Uint8Array;     // 4096 像素 → 语义分区 (0~4)
  currentHairPreset: HairPresetKey | null; // 已固化的发色预设 key
}

export function createEmptyDocument(): PortraitDocument {
  return {
    palette: [...PALETTE_36],
    pixelIndices: new Uint8Array(PIXEL_COUNT).fill(TRANSPARENT_INDEX),
    semanticMask: new Uint8Array(PIXEL_COUNT),
    currentHairPreset: null,
  };
}

/** 编辑操作所需的图层视图；lockedZones 内的遮罩在清空类操作中受保护 */
export function layersOf(doc: PortraitDocument, lockedZones: Iterable<SemanticZone>): Layers {
  return { pixels: doc.pixelIndices, mask: doc.semanticMask, lockedZones: new Set(lockedZones) };
}

/**
 * 创建 PortraitDocument 的独立深拷贝快照 (用于导出、存档或状态比较)
 * 必须复制全部 Uint8Array 缓冲区，禁止引用共享或 subarray 视图
 */
export function cloneDocument(doc: PortraitDocument): PortraitDocument {
  return {
    palette: [...doc.palette],
    pixelIndices: new Uint8Array(doc.pixelIndices),
    semanticMask: new Uint8Array(doc.semanticMask),
    currentHairPreset: doc.currentHairPreset,
  };
}
