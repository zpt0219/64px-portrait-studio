/**
 * 像素 + 遮罩的纯编辑操作。所有函数直接修改传入的 layers，返回是否 (或多少) 发生了变化。
 * 系统级不变量规则：像素设为透明 (255) 时，遮罩必须无条件清为 None (0)，
 * 透明像素不参与遮罩；分区锁保护手工分配的非 None 遮罩。
 */

import { SemanticZone, RectSelection } from './types';
import { TRANSPARENT_INDEX, ZONE_CONFIG, ALL_ZONES } from './constants';
import { IMAGE_WIDTH as W, IMAGE_HEIGHT as H, floodFill, borderOffsets } from './pixelGrid';
import { Rgb, hexToRgb } from '../utils/colorUtils';
import type { PortraitDocument } from './document';

export interface Layers {
  pixels: Uint8Array;
  mask: Uint8Array;
  lockedZones: Set<SemanticZone>;
}

/** 从画布上抠出的一块矩形像素与遮罩 */
export interface Patch {
  w: number;
  h: number;
  pixels: Uint8Array;
  mask: Uint8Array;
}

export const FULL_CANVAS: RectSelection = { x: 0, y: 0, w: W, h: H };

/**
 * 遮罩分配判定通用策略：
 * 判定给定像素是否允许被重新划分至 targetZone
 */
export function canAssignZone(
  pixelIndex: number, // 0~35 或 255
  currentZone: SemanticZone,
  targetZone: SemanticZone,
  lockedZones: ReadonlySet<SemanticZone> | SemanticZone[]
): boolean {
  // 1. 若像素为透明色，严禁分配任何非 None 遮罩 (透明像素不参与遮罩)
  if (pixelIndex === TRANSPARENT_INDEX && targetZone !== SemanticZone.None) {
    return false;
  }
  // 2. 当前分区已锁定，受保护不可被改写 (None 不可锁定)
  const isLocked = Array.isArray(lockedZones)
    ? (z: SemanticZone) => lockedZones.includes(z)
    : (z: SemanticZone) => lockedZones.has(z);

  if (currentZone !== SemanticZone.None && isLocked(currentZone)) {
    return false;
  }
  // 3. 目标分区已锁定，禁止向其写入 (None 永远可写入以清除)
  if (targetZone !== SemanticZone.None && isLocked(targetZone)) {
    return false;
  }
  // 4. 当前分区已是目标分区，无需改写
  if (currentZone === targetZone) {
    return false;
  }
  return true;
}

const inCanvas = (x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H;
const inRect = (x: number, y: number, r: RectSelection) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/** 对矩形内 (与画布相交部分) 的每个像素调用 fn(offset, 列, 行) */
function forEachInRect(rect: RectSelection, fn: (offset: number, c: number, r: number) => void): void {
  for (let r = 0; r < rect.h; r++) {
    for (let c = 0; c < rect.w; c++) {
      const x = rect.x + c;
      const y = rect.y + r;
      if (inCanvas(x, y)) fn(y * W + x, c, r);
    }
  }
}

/** 把像素设为透明；根据系统最高优先级不变量规则，遮罩必须无条件清为 None (不受分区锁阻碍) */
export function erase(layers: Layers, offset: number): void {
  layers.pixels[offset] = TRANSPARENT_INDEX;
  layers.mask[offset] = SemanticZone.None;
}

/** 抠出矩形块，超出画布的部分视为透明无遮罩 */
export function extractPatch(layers: Layers, rect: RectSelection): Patch {
  const patch: Patch = {
    w: rect.w,
    h: rect.h,
    pixels: new Uint8Array(rect.w * rect.h).fill(TRANSPARENT_INDEX),
    mask: new Uint8Array(rect.w * rect.h).fill(SemanticZone.None),
  };
  forEachInRect(rect, (offset, c, r) => {
    patch.pixels[r * rect.w + c] = layers.pixels[offset];
    patch.mask[r * rect.w + c] = layers.mask[offset];
  });
  return patch;
}

/** 把块盖到 (x, y)：透明像素不覆盖下方内容 */
export function stampPatch(layers: Layers, patch: Patch, x: number, y: number): void {
  forEachInRect({ x, y, w: patch.w, h: patch.h }, (offset, c, r) => {
    const i = r * patch.w + c;
    if (patch.pixels[i] !== TRANSPARENT_INDEX) {
      layers.pixels[offset] = patch.pixels[i];
      layers.mask[offset] = patch.mask[i];
    }
  });
}

/** 清空矩形为透明；根据系统最高优先级不变量规则，遮罩无条件清为 None (不受分区锁阻碍)，返回是否有变化 */
export function clearRect(layers: Layers, rect: RectSelection): boolean {
  let changed = false;
  forEachInRect(rect, (offset) => {
    if (layers.pixels[offset] !== TRANSPARENT_INDEX) {
      layers.pixels[offset] = TRANSPARENT_INDEX;
      changed = true;
    }
    if (layers.mask[offset] !== SemanticZone.None) {
      layers.mask[offset] = SemanticZone.None;
      changed = true;
    }
  });
  return changed;
}

/** 把块从 from 移到 to；cut 为 true 时原位置先清空 (剪切移动)，否则为复制 */
export function movePatch(layers: Layers, patch: Patch, from: RectSelection, toX: number, toY: number, cut: boolean): void {
  if (cut) forEachInRect(from, (offset) => erase(layers, offset));
  stampPatch(layers, patch, toX, toY);
}

/** 矩形内水平或垂直镜像 */
export function flipRect(layers: Layers, rect: RectSelection, axis: 'horizontal' | 'vertical'): void {
  const swap = (a: number, b: number) => {
    [layers.pixels[a], layers.pixels[b]] = [layers.pixels[b], layers.pixels[a]];
    [layers.mask[a], layers.mask[b]] = [layers.mask[b], layers.mask[a]];
  };
  const { x, y, w, h } = rect;
  if (axis === 'horizontal') {
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < Math.floor(w / 2); c++) {
        const lx = x + c;
        const rx = x + w - 1 - c;
        if (inCanvas(lx, y + r) && inCanvas(rx, y + r)) swap((y + r) * W + lx, (y + r) * W + rx);
      }
    }
  } else {
    for (let r = 0; r < Math.floor(h / 2); r++) {
      const ty = y + r;
      const by = y + h - 1 - r;
      for (let c = 0; c < w; c++) {
        if (inCanvas(x + c, ty) && inCanvas(x + c, by)) swap(ty * W + x + c, by * W + x + c);
      }
    }
  }
}

/**
 * 矩形内容顺时针旋转 90°：宽高互换，左上角尽量保持不动 (超出画布时向内平移)。
 * 返回旋转后的矩形。
 * 注意：原位置的遮罩会被无条件清为 None (不遵守分区锁)，与既有行为一致。
 */
export function rotateRectCW(layers: Layers, rect: RectSelection): RectSelection {
  const { w, h } = rect;
  const patch = extractPatch(layers, rect);
  forEachInRect(rect, (offset) => {
    layers.pixels[offset] = TRANSPARENT_INDEX;
    layers.mask[offset] = SemanticZone.None;
  });

  const rotated: RectSelection = {
    x: rect.x + h > W ? Math.max(0, W - h) : rect.x,
    y: rect.y + w > H ? Math.max(0, H - w) : rect.y,
    w: h,
    h: w,
  };
  // 旧 (c, r) → 新 (h - 1 - r, c)
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const x = rotated.x + (h - 1 - r);
      const y = rotated.y + c;
      if (inCanvas(x, y)) {
        layers.pixels[y * W + x] = patch.pixels[r * w + c];
        layers.mask[y * W + x] = patch.mask[r * w + c];
      }
    }
  }
  return rotated;
}

/** 把 scope 内所有 fromIndex 像素替换为 toIndex；替换成透明时遮罩一并清为 None (系统不变量无条件归 None) */
export function replaceColor(
  layers: Layers,
  fromIndex: number,
  toIndex: number,
  scope: RectSelection,
  out?: { maskChanged?: boolean }
): number {
  if (fromIndex === toIndex) return 0;
  let count = 0;
  forEachInRect(scope, (offset) => {
    if (layers.pixels[offset] !== fromIndex) return;
    if (toIndex === TRANSPARENT_INDEX) {
      if (out && layers.mask[offset] !== SemanticZone.None) {
        out.maskChanged = true;
      }
      erase(layers, offset);
    } else {
      layers.pixels[offset] = toIndex;
    }
    count++;
  });
  return count;
}

/** 从 (x, y) 开始泛洪替换同色像素，限定在 scope 内；填充透明时遮罩一并清为 None (系统不变量无条件归 None) */
export function floodFillPixels(
  layers: Layers,
  x: number,
  y: number,
  toIndex: number,
  diagonal: boolean,
  scope: RectSelection,
  out?: { maskChanged?: boolean }
): boolean {
  const start = y * W + x;
  const fromIndex = layers.pixels[start];
  if (fromIndex === toIndex || !inRect(x, y, scope)) return false;

  const region = floodFill(
    [start],
    (o) => layers.pixels[o] === fromIndex && inRect(o % W, Math.floor(o / W), scope),
    diagonal
  );
  for (const offset of region) {
    if (toIndex === TRANSPARENT_INDEX) {
      if (out && layers.mask[offset] !== SemanticZone.None) {
        out.maskChanged = true;
      }
      erase(layers, offset);
    } else {
      layers.pixels[offset] = toIndex;
    }
  }
  return region.length > 0;
}

/**
 * 从 (x, y) 开始，BFS 泛洪扩展相邻同色 (layers.pixels) 像素并划入 toZone 遮罩，限定在 scope 内；
 * 锁定分区的像素受保护不被覆盖或穿越；若 toZone (非 None) 本身被锁定则不操作。
 */
export function floodFillMask(
  layers: Layers,
  x: number,
  y: number,
  toZone: SemanticZone,
  diagonal: boolean,
  scope: RectSelection
): boolean {
  const start = y * W + x;
  if (!inRect(x, y, scope)) return false;
  if (toZone !== SemanticZone.None && layers.lockedZones.has(toZone)) return false;

  const fromColor = layers.pixels[start];
  // 关键防护：起点为透明色且非擦除操作时，禁止将透明区域填入遮罩
  if (fromColor === TRANSPARENT_INDEX && toZone !== SemanticZone.None) return false;
  const startZone = layers.mask[start] as SemanticZone;
  if (startZone !== SemanticZone.None && layers.lockedZones.has(startZone)) return false;

  const region = floodFill(
    [start],
    (o) =>
      layers.pixels[o] === fromColor &&
      !layers.lockedZones.has(layers.mask[o]) &&
      inRect(o % W, Math.floor(o / W), scope),
    diagonal
  );

  let changed = false;
  for (const offset of region) {
    const current = layers.mask[offset] as SemanticZone;
    if (canAssignZone(layers.pixels[offset], current, toZone, layers.lockedZones)) {
      layers.mask[offset] = toZone;
      changed = true;
    }
  }
  return changed;
}

/**
 * 全域（限定在 scope 内）把所有颜色为 fromColor 的非锁定像素划入 toZone 遮罩 (对应 Shift+油漆桶)；
 * 返回改动的像素数。
 */
export function assignColorToMask(
  layers: Layers,
  fromColor: number,
  toZone: SemanticZone,
  scope: RectSelection
): number {
  if (toZone !== SemanticZone.None && layers.lockedZones.has(toZone)) return 0;
  // 关键防护：禁止将全图透明像素批量划入非 None 遮罩
  if (fromColor === TRANSPARENT_INDEX && toZone !== SemanticZone.None) return 0;
  let count = 0;
  for (let py = scope.y; py < scope.y + scope.h; py++) {
    for (let px = scope.x; px < scope.x + scope.w; px++) {
      if (px < 0 || px >= W || py < 0 || py >= H) continue;
      const offset = py * W + px;
      if (layers.pixels[offset] !== fromColor) continue;
      const current = layers.mask[offset] as SemanticZone;
      if (!canAssignZone(layers.pixels[offset], current, toZone, layers.lockedZones)) continue;
      layers.mask[offset] = toZone;
      count++;
    }
  }
  return count;
}

export type MaskBoxSelectAction = 'add' | 'remove' | 'subtract' | 'clear';

/**
 * 选区框内像素遮罩操作：
 * - add: 属于 matchColors 匹配色组的像素划入 target 分区；
 * - clear: 框内所有在 target 分区的像素一律清除为 None；
 * - subtract: 不在 matchColors 的杂色像素从 target 分区剔除为 None；
 * - remove: 属于 matchColors 的像素从 target 分区剔除为 None；
 * 返回发生改动的像素数。
 */
export function boxSelectMask(
  layers: Layers,
  rect: RectSelection,
  action: MaskBoxSelectAction,
  matchColors: ReadonlySet<number>,
  target: SemanticZone
): number {
  // 若 add 操作的目标分区已锁定且非 None，直接拒绝
  if (action === 'add' && target !== SemanticZone.None && layers.lockedZones.has(target)) {
    return 0;
  }

  let count = 0;
  forEachInRect(rect, (offset) => {
    const color = layers.pixels[offset];
    const current = layers.mask[offset] as SemanticZone;

    if (action === 'add') {
      if (matchColors.has(color) && canAssignZone(color, current, target, layers.lockedZones)) {
        layers.mask[offset] = target;
        count++;
      }
    } else if (action === 'clear') {
      // 右键去所有颜色：框内属于 target 分区的像素清除为 None
      if (current === target && canAssignZone(color, current, SemanticZone.None, layers.lockedZones)) {
        layers.mask[offset] = SemanticZone.None;
        count++;
      }
    } else if (action === 'subtract') {
      // Shift 减法模式：所有不在匹配色组的像素 (杂色) 从 target 分区剔除为 None
      if (!matchColors.has(color) && current === target && canAssignZone(color, current, SemanticZone.None, layers.lockedZones)) {
        layers.mask[offset] = SemanticZone.None;
        count++;
      }
    } else if (action === 'remove') {
      // Alt 减法模式：属于匹配色组的像素从 target 分区剔除为 None
      if (matchColors.has(color) && current === target && canAssignZone(color, current, SemanticZone.None, layers.lockedZones)) {
        layers.mask[offset] = SemanticZone.None;
        count++;
      }
    }
  });

  return count;
}

/** 各分区的 RGB 配色；背景色因用途不同 (画布覆盖层 / 导出遮罩) 由调用方指定 */
export function zoneRgbTable(backgroundRgb: Rgb): Record<SemanticZone, Rgb> {
  const table = {} as Record<SemanticZone, Rgb>;
  table[SemanticZone.None] = backgroundRgb;
  for (const zone of ALL_ZONES) {
    table[zone] = hexToRgb(ZONE_CONFIG[zone].color);
  }
  return table;
}

export const DEFAULT_WHITE_THRESHOLD = 250;

/**
 * 快速判断 RGB 颜色是否属于近白背景色 (三通道均达到或超过阈值)
 */
export function isWhiteRgb(rgb: Rgb, threshold: number = DEFAULT_WHITE_THRESHOLD): boolean {
  return rgb[0] >= threshold && rgb[1] >= threshold && rgb[2] >= threshold;
}

/**
 * 计算从画布边缘 4-连通可达的白色背景像素偏移数组 (眼睛分区与锁定分区受保护)
 */
export function findOuterWhiteOffsets(
  doc: PortraitDocument,
  lockedZones: SemanticZone[],
  whiteThreshold: number = DEFAULT_WHITE_THRESHOLD
): number[] {
  const { pixelIndices, semanticMask, palette } = doc;
  const locked = new Set(lockedZones);
  const isBgWhiteOrTransparent = (offset: number): boolean => {
    const idx = pixelIndices[offset];
    if (idx === TRANSPARENT_INDEX) return true; // 透明像素允许通过以连通外围
    if (idx < 0 || idx >= palette.length) return false;
    const zone = semanticMask[offset];
    if (locked.has(zone) || zone === SemanticZone.Eyes) return false; // 保护锁定分区与眼白
    return isWhiteRgb(hexToRgb(palette[idx]), whiteThreshold);
  };

  return floodFill(borderOffsets(), isBgWhiteOrTransparent).filter(
    (offset) => pixelIndices[offset] !== TRANSPARENT_INDEX
  );
}
