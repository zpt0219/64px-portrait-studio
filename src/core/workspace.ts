/**
 * 多标签页工作区核心数据结构与纯函数 (Workspace & Tab Core Models)
 * 纯逻辑层，Zero-DOM，可在无浏览器环境下完整单测。
 */

import { PortraitDocument } from './document';
import { EditorSession } from './session';
import { CommandHandler } from '../command/commandHandler';
import { Patch } from './editOps';
import { ProjectData } from './types';
import { TRANSPARENT_INDEX } from './constants';
import { hexToRgb, rgbToOklab, oklabDistance, Lab } from '../utils/colorUtils';

export const MAX_TAB_COUNT = 12;

/**
 * 每个 Tab 独立保存的会话状态子集
 * 包含工作模式、选区、缩放、遮罩显隐与匹配色等
 */
export interface TabSessionState {
  isLoaded: boolean;
  activeMode: EditorSession['activeMode'];
  activeZone: EditorSession['activeZone'];
  visibleMaskZones: EditorSession['visibleMaskZones'];
  lockedMaskZones: EditorSession['lockedMaskZones'];
  maskMatchColors: EditorSession['maskMatchColors'];
  maskMatchPresetKey: EditorSession['maskMatchPresetKey'];
  maskMatchInitialized: EditorSession['maskMatchInitialized'];
  maskOpacity: EditorSession['maskOpacity'];
  showMaskOverlay: EditorSession['showMaskOverlay'];
  activePaletteIndex: EditorSession['activePaletteIndex'];
  bgPaletteIndex: EditorSession['bgPaletteIndex'];
  zoomLevel: EditorSession['zoomLevel'];
  selection: EditorSession['selection'];
}

export interface TabState {
  readonly id: string;
  name: string;
  doc: PortraitDocument;
  session: TabSessionState;
  handler: CommandHandler;
  cachedProjectData?: ProjectData;
}

export interface TabSummary {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly isLoaded: boolean;
}

export interface ClipboardPayload {
  patch: Patch;
  palette: string[];
}

export interface RemapResult {
  patch: Patch;
  approximatedCount: number;
  totalColors: number;
}

/** 从全局 EditorSession 中提取单 Tab 会话状态快照 */
export function extractTabSession(session: EditorSession): TabSessionState {
  return {
    isLoaded: session.isLoaded,
    activeMode: session.activeMode,
    activeZone: session.activeZone,
    visibleMaskZones: [...session.visibleMaskZones],
    lockedMaskZones: [...session.lockedMaskZones],
    maskMatchColors: [...session.maskMatchColors],
    maskMatchPresetKey: session.maskMatchPresetKey,
    maskMatchInitialized: session.maskMatchInitialized,
    maskOpacity: session.maskOpacity,
    showMaskOverlay: session.showMaskOverlay,
    activePaletteIndex: session.activePaletteIndex,
    bgPaletteIndex: session.bgPaletteIndex,
    zoomLevel: session.zoomLevel,
    selection: session.selection ? { ...session.selection } : null,
  };
}

/** 将 Tab 会话状态应用回全局 EditorSession (原地修改) */
export function applyTabSession(target: EditorSession, source: TabSessionState): void {
  target.isLoaded = source.isLoaded;
  target.activeMode = source.activeMode;
  target.activeZone = source.activeZone;
  target.visibleMaskZones = [...source.visibleMaskZones];
  target.lockedMaskZones = [...source.lockedMaskZones];
  target.maskMatchColors = [...source.maskMatchColors];
  target.maskMatchPresetKey = source.maskMatchPresetKey;
  target.maskMatchInitialized = source.maskMatchInitialized;
  target.maskOpacity = source.maskOpacity;
  target.showMaskOverlay = source.showMaskOverlay;
  target.activePaletteIndex = source.activePaletteIndex;
  target.bgPaletteIndex = source.bgPaletteIndex;
  target.zoomLevel = source.zoomLevel;
  target.selection = source.selection ? { ...source.selection } : null;
}

/** 将源文档的全部数据同步到全局单例文档中 (原地修改 Uint8Array，不换对象引用) */
export function syncDocumentInPlace(target: PortraitDocument, source: PortraitDocument): void {
  target.palette = [...source.palette];
  target.pixelIndices.set(source.pixelIndices);
  target.semanticMask.set(source.semanticMask);
  target.currentHairPreset = source.currentHairPreset;
}

/** 生成唯一递增的 Tab ID */
let tabIdCounter = 0;
export function createTabId(): string {
  tabIdCounter++;
  return `tab_${Date.now()}_${tabIdCounter}`;
}

/** 清理并格式化 Tab 命名，避免重名 (如 骑士 -> 骑士 (2)) */
export function generateTabName(rawName: string, existingNames: string[]): string {
  // 去除常见文件后缀
  let cleanName = rawName.trim().replace(/\.(png|jpg|jpeg|webp|zip|json)$/i, '');
  if (!cleanName) cleanName = '未命名';

  if (!existingNames.includes(cleanName)) {
    return cleanName;
  }

  // 去除已有的 (N) 后缀以便重新编号
  const baseMatch = cleanName.match(/^(.*?)(?:\s*\(\d+\))?$/);
  const base = baseMatch && baseMatch[1] ? baseMatch[1].trim() : cleanName;

  let index = 2;
  while (existingNames.includes(`${base} (${index})`)) {
    index++;
  }
  return `${base} (${index})`;
}

/**
 * 跨色板 Patch 重映射
 * 当从 Tab A 复制选区并粘贴到色板不同的 Tab B 时，
 * 优先按 Hex 精确匹配；若目标色板不存在相同色值，则通过 OKLab 感知色差寻找最近色，
 * 并统计近似匹配的颜色数量。
 */
export function remapPatch(
  patch: Patch,
  srcPalette: string[],
  dstPalette: string[]
): RemapResult {
  // 1. 若色板完全一致，直接深拷贝返回
  const isIdentical =
    srcPalette.length === dstPalette.length &&
    srcPalette.every((c, i) => c.toLowerCase() === dstPalette[i]?.toLowerCase());

  const newPixels = new Uint8Array(patch.pixels);
  const newMask = new Uint8Array(patch.mask);

  if (isIdentical) {
    return {
      patch: { w: patch.w, h: patch.h, pixels: newPixels, mask: newMask },
      approximatedCount: 0,
      totalColors: 0,
    };
  }

  // 2. 准备目标色板的 OKLab 预计算
  const dstLabs: Lab[] = dstPalette.map((hex) => rgbToOklab(hexToRgb(hex)));
  const dstHexLookup = new Map<string, number>();
  dstPalette.forEach((hex, idx) => {
    dstHexLookup.set(hex.toLowerCase(), idx);
  });

  const mappingCache = new Map<number, { dstIndex: number; isApprox: boolean }>();
  let approximatedCount = 0;
  const uniqueColorSet = new Set<number>();

  for (let i = 0; i < patch.pixels.length; i++) {
    const srcIndex = patch.pixels[i];
    if (srcIndex === TRANSPARENT_INDEX) {
      newPixels[i] = TRANSPARENT_INDEX;
      continue;
    }

    uniqueColorSet.add(srcIndex);

    let mapped = mappingCache.get(srcIndex);
    if (!mapped) {
      const srcHex = (srcPalette[srcIndex] || '#000000').toLowerCase();
      const exactIndex = dstHexLookup.get(srcHex);

      if (exactIndex !== undefined) {
        mapped = { dstIndex: exactIndex, isApprox: false };
      } else {
        // OKLab 最小感知色差最近邻搜索
        const srcLab = rgbToOklab(hexToRgb(srcHex));
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let d = 0; d < dstLabs.length; d++) {
          const dist = oklabDistance(srcLab, dstLabs[d]);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = d;
          }
        }
        mapped = { dstIndex: bestIdx, isApprox: true };
        approximatedCount++;
      }
      mappingCache.set(srcIndex, mapped);
    }

    newPixels[i] = mapped.dstIndex;
  }

  return {
    patch: { w: patch.w, h: patch.h, pixels: newPixels, mask: newMask },
    approximatedCount,
    totalColors: uniqueColorSet.size,
  };
}
