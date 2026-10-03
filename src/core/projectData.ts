/**
 * 工程数据 (ProjectData) 的 Base64 编解码与合法性校验。
 * localStorage 自动暂存与工程 ZIP 共用同一数据结构。
 */

import { ProjectData } from '../types';
import { TRANSPARENT_INDEX } from '../data/palette';
import { PIXEL_COUNT } from './pixelGrid';

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

/**
 * 严格校验工程数据：版本号、36 色色板格式、4096 像素索引 (0~35 或 255)、4096 遮罩值 (0~4)
 */
export function validateProjectData(raw: unknown): { valid: boolean; error?: string; data?: ProjectData } {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: '工程数据不是有效的 JSON 对象' };
  }

  const d = raw as Record<string, unknown>;

  if (d.v !== 1) {
    return { valid: false, error: `不支持的工程 Schema 版本: ${d.v} (当前仅支持 v1)` };
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

  return {
    valid: true,
    data: {
      v: 1,
      palette: (d.palette as string[]).map((hex) => hex.toUpperCase()),
      pixels: d.pixels,
      mask: d.mask,
      hairPreset: typeof d.hairPreset === 'string' ? d.hairPreset : null,
      ts: typeof d.ts === 'number' ? d.ts : Math.floor(Date.now() / 1000),
    },
  };
}
