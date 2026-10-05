import { expect } from 'vitest';
import { PortraitDocument } from '../../src/core/document';
import { SemanticZone, HairPresetKey } from '../../src/core/types';
import { TRANSPARENT_INDEX, PALETTE_36, RAMPS_INFO } from '../../src/core/constants';
import { PIXEL_COUNT } from '../../src/core/pixelGrid';

export const VALID_HAIR_PRESET_KEYS = Object.keys(RAMPS_INFO) as HairPresetKey[];

/**
 * 校验 PortraitDocument 是否满足 §2.1 规定的文档不变量
 */
export function assertDocumentInvariant(doc: PortraitDocument): void {
  // 1. palette: 恰好 36 个 #RRGGBB 颜色
  expect(doc.palette).toHaveLength(36);
  for (let i = 0; i < doc.palette.length; i++) {
    expect(doc.palette[i]).toMatch(/^#[0-9A-Fa-f]{6}$/);
  }

  // 2. pixelIndices: 长度 4096，取值 0~35 或 255
  expect(doc.pixelIndices).toHaveLength(PIXEL_COUNT);
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const p = doc.pixelIndices[i];
    const isValid = (p >= 0 && p < 36) || p === TRANSPARENT_INDEX;
    if (!isValid) {
      throw new Error(`Invalid pixelIndex at ${i}: ${p}`);
    }
  }

  // 3. semanticMask: 长度 4096，取值 0~4
  expect(doc.semanticMask).toHaveLength(PIXEL_COUNT);
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const m = doc.semanticMask[i];
    const isValid = m >= SemanticZone.Background && m <= SemanticZone.Clothes;
    if (!isValid) {
      throw new Error(`Invalid semanticMask at ${i}: ${m}`);
    }
  }

  // 4. 透明位置约束：pixelIndices[i] 为 255 时，semanticMask[i] 必须为 Background
  for (let i = 0; i < PIXEL_COUNT; i++) {
    if (doc.pixelIndices[i] === TRANSPARENT_INDEX) {
      if (doc.semanticMask[i] !== SemanticZone.Background) {
        throw new Error(
          `Transparent pixel invariant violated at ${i}: pixel is 255 but mask is ${doc.semanticMask[i]}`
        );
      }
    }
  }

  // 5. currentHairPreset: null 或实际存在的 9 个预设 key
  if (doc.currentHairPreset !== null) {
    expect(VALID_HAIR_PRESET_KEYS).toContain(doc.currentHairPreset);
  }
}

/**
 * 比较两份文档内容是否逐字节/逐项一致（不比较时间戳与对象引用）
 */
export function assertDocumentEqual(actual: PortraitDocument, expected: PortraitDocument): void {
  expect(actual.palette.map((c) => c.toUpperCase())).toEqual(
    expected.palette.map((c) => c.toUpperCase())
  );
  expect(Array.from(actual.pixelIndices)).toEqual(Array.from(expected.pixelIndices));
  expect(Array.from(actual.semanticMask)).toEqual(Array.from(expected.semanticMask));
  expect(actual.currentHairPreset).toBe(expected.currentHairPreset);
}

/**
 * 创建合法的纯净空文档（全透明 + 全 Background 分区）
 */
export function createEmptyDocument(): PortraitDocument {
  const pixelIndices = new Uint8Array(PIXEL_COUNT);
  pixelIndices.fill(TRANSPARENT_INDEX);
  const semanticMask = new Uint8Array(PIXEL_COUNT);
  semanticMask.fill(SemanticZone.Background);

  return {
    palette: [...PALETTE_36],
    pixelIndices,
    semanticMask,
    currentHairPreset: null,
  };
}

/**
 * 创建合法的带有自定义像素和遮罩的文档夹具
 * 若要在指定坐标设置非背景分区，该助手会确保该坐标具有不透明像素值，满足不变量
 */
export function createValidDocument(options?: {
  palette?: string[];
  currentHairPreset?: HairPresetKey | null;
  pixels?: (setPixel: (x: number, y: number, colorIdx: number, zone?: SemanticZone) => void) => void;
}): PortraitDocument {
  const doc = createEmptyDocument();
  if (options?.palette) {
    doc.palette = [...options.palette];
  }
  if (options?.currentHairPreset !== undefined) {
    doc.currentHairPreset = options.currentHairPreset;
  }

  if (options?.pixels) {
    options.pixels((x, y, colorIdx, zone = SemanticZone.Skin) => {
      const idx = y * 64 + x;
      doc.pixelIndices[idx] = colorIdx;
      doc.semanticMask[idx] = colorIdx === TRANSPARENT_INDEX ? SemanticZone.Background : zone;
    });
  }

  assertDocumentInvariant(doc);
  return doc;
}
