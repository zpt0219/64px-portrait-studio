/**
 * 工程数据 (ProjectData) 的 Base64 编解码与合法性校验。
 * localStorage 自动暂存与工程 ZIP 共用同一数据结构。
 */

import { ProjectData, SemanticZone } from '../types';
import { TRANSPARENT_INDEX, isHairPresetKey } from '../data/palette';
import { PortraitDocument } from '../model/document';
import { PIXEL_COUNT } from './pixelGrid';
import { CURRENT_PROJECT_VERSION, upgradeProjectData } from './projectMigration';

export { CURRENT_PROJECT_VERSION, upgradeProjectData };

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface ProjectDecodeResult {
  document: PortraitDocument;
  warnings: string[];
}

/**
 * 将文档序列化为 ProjectData (纯函数，无 DOM 依赖，不修改输入文档)
 */
export function documentToProjectData(
  doc: PortraitDocument,
  timestamp: number = Math.floor(Date.now() / 1000)
): ProjectData {
  return {
    v: CURRENT_PROJECT_VERSION,
    palette: [...doc.palette],
    pixels: uint8ArrayToBase64(doc.pixelIndices),
    mask: uint8ArrayToBase64(doc.semanticMask),
    hairPreset: doc.currentHairPreset,
    ts: timestamp,
  };
}

/**
 * 将 ProjectData 反序列化为文档 (纯函数，无 DOM 依赖)
 * 系统级不变量保护：透明像素恒不入非背景蒙版。若发现不合规像素则自动修正并输出 warning。
 */
export function projectDataToDocument(data: ProjectData): ProjectDecodeResult {
  const pixelIndices = base64ToUint8Array(data.pixels);
  const semanticMask = base64ToUint8Array(data.mask);
  const warnings: string[] = [];
  let normalizedCount = 0;

  for (let i = 0; i < pixelIndices.length; i++) {
    if (pixelIndices[i] === TRANSPARENT_INDEX && semanticMask[i] !== SemanticZone.Background) {
      semanticMask[i] = SemanticZone.Background;
      normalizedCount++;
    }
  }

  if (normalizedCount > 0) {
    warnings.push(`已规范化 ${normalizedCount} 处透明像素的语义遮罩至背景分区 (SemanticZone.Background)`);
  }

  return {
    document: {
      palette: data.palette.map((h) => h.toUpperCase()),
      pixelIndices,
      semanticMask,
      currentHairPreset: data.hairPreset,
    },
    warnings,
  };
}

/**
 * 严格校验工程数据：版本号、36 色色板格式、4096 像素索引 (0~35 或 255)、4096 遮罩值 (0~4)、发色预设及时间戳
 */
export function validateProjectData(raw: unknown): {
  valid: boolean;
  error?: string;
  data?: ProjectData;
  upgraded?: boolean;
  fromVersion?: number;
} {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: '工程数据不是有效的 JSON 对象' };
  }

  let rawObj = raw as Record<string, unknown>;
  const rawV = typeof rawObj.v === 'number' && Number.isInteger(rawObj.v) ? rawObj.v : 1;
  let wasUpgraded = false;
  let fromVer = rawV;

  // 渐进式版本升级管道：当检测到历史存档版本 (v < CURRENT_PROJECT_VERSION)，逐级向上迁移
  if (rawV < CURRENT_PROJECT_VERSION) {
    try {
      const upgradeRes = upgradeProjectData(rawObj, CURRENT_PROJECT_VERSION);
      rawObj = upgradeRes.data;
      wasUpgraded = upgradeRes.upgraded;
      fromVer = upgradeRes.fromVersion;
    } catch (err) {
      return { valid: false, error: (err as Error).message };
    }
  } else if (rawV > CURRENT_PROJECT_VERSION || rawV <= 0) {
    return { valid: false, error: `不支持的工程 Schema 版本: ${rawV} (当前系统最高支持至 v${CURRENT_PROJECT_VERSION})` };
  }

  const d = rawObj;

  if (d.v !== CURRENT_PROJECT_VERSION) {
    return { valid: false, error: `不支持的工程 Schema 版本: ${String(d.v)} (当前仅支持 v${CURRENT_PROJECT_VERSION})` };
  }

  if (!Array.isArray(d.palette) || d.palette.length !== 36) {
    return {
      valid: false,
      error: `色板项目数异常：预期严格为 36 项，实际为 ${Array.isArray(d.palette) ? d.palette.length : 0} 项`,
    };
  }

  const hexRegex = /^#[0-9A-Fa-f]{6}$/;
  for (let i = 0; i < 36; i++) {
    if (typeof d.palette[i] !== 'string' || !hexRegex.test(d.palette[i])) {
      return { valid: false, error: `色板第 ${i} 项颜色格式无效: ${String(d.palette[i])}` };
    }
  }

  if (typeof d.pixels !== 'string') {
    return { valid: false, error: '缺少有效的 pixels 字段' };
  }

  let pixelsBytes: Uint8Array;
  try {
    pixelsBytes = base64ToUint8Array(d.pixels);
  } catch {
    return { valid: false, error: 'pixels 字段 Base64 解码失败' };
  }

  if (pixelsBytes.length !== PIXEL_COUNT) {
    return { valid: false, error: `pixels 像素点数量异常：应严格为 4096 像素，当前为 ${pixelsBytes.length}` };
  }

  for (let i = 0; i < PIXEL_COUNT; i++) {
    if (pixelsBytes[i] > 35 && pixelsBytes[i] !== TRANSPARENT_INDEX) {
      return { valid: false, error: `像素索引超出 36 色板范围 (0~35 或 255 透明): 索引 ${pixelsBytes[i]} at offset ${i}` };
    }
  }

  if (typeof d.mask !== 'string') {
    return { valid: false, error: '缺少有效的 mask 字段' };
  }

  let maskBytes: Uint8Array;
  try {
    maskBytes = base64ToUint8Array(d.mask);
  } catch {
    return { valid: false, error: 'mask 字段 Base64 解码失败' };
  }

  if (maskBytes.length !== PIXEL_COUNT) {
    return { valid: false, error: `mask 语义遮罩数据量异常：应严格为 4096 字节，当前为 ${maskBytes.length}` };
  }

  for (let i = 0; i < PIXEL_COUNT; i++) {
    if (maskBytes[i] > 4) {
      return { valid: false, error: `遮罩值超出 5 分区范围 (0~4): 值 ${maskBytes[i]} at offset ${i}` };
    }
  }

  // 严格校验 hairPreset
  let hairPreset: ProjectData['hairPreset'] = null;
  if (d.hairPreset !== null && d.hairPreset !== undefined) {
    if (!isHairPresetKey(d.hairPreset)) {
      return { valid: false, error: `无效的发色预设标识: ${String(d.hairPreset)}` };
    }
    hairPreset = d.hairPreset;
  }

  // 严格校验 ts
  let ts: number;
  if (d.ts !== undefined) {
    if (typeof d.ts !== 'number' || !Number.isFinite(d.ts)) {
      return { valid: false, error: `无效的工程时间戳 (ts): ${String(d.ts)}` };
    }
    ts = d.ts;
  } else {
    ts = Math.floor(Date.now() / 1000);
  }

  return {
    valid: true,
    data: {
      v: CURRENT_PROJECT_VERSION,
      palette: (d.palette as string[]).map((hex) => hex.toUpperCase()),
      pixels: d.pixels,
      mask: d.mask,
      hairPreset,
      ts,
    },
    upgraded: wasUpgraded,
    fromVersion: fromVer,
  };
}
