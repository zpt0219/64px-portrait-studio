/**
 * ImageGem PNG tEXt / iTXt Chunk 二进制编解码与校验模块
 * 遵循 ISO/IEC 15948 PNG 国际标准规范
 * 零外部依赖，纯原生 ArrayBuffer / DataView / TextEncoder 实现
 */

import { ImageGemProjectData } from '../types';
import { TRANSPARENT_INDEX } from '../data/palette';

/** PNG 8 字节文件签名 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** ImageGem 工程元数据专有 Chunk 关键字 */
export const PROJECT_CHUNK_KEYWORD = 'ImageGemProject';

/** CRC-32 预计算查表 (ISO 3309) */
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

/**
 * 计算给定字节数组的 CRC32 校验和
 */
export function calculateCrc32(data: Uint8Array, offset = 0, length = data.length): number {
  let crc = 0xffffffff;
  for (let i = offset; i < offset + length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Uint8Array 转 Base64 字符串
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Base64 字符串转 Uint8Array
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 校验 ArrayBuffer 是否为合法的 PNG 文件
 */
export function isValidPng(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 8) return false;
  const bytes = new Uint8Array(buffer, 0, 8);
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

/**
 * 严格校验 ImageGemProjectData 合法性
 * 包含：版本号、36色色板格式、4096像素点索引范围(0~35)、4096遮罩值范围(0~4)
 */
export function validateProjectData(raw: unknown): { valid: boolean; error?: string; data?: ImageGemProjectData } {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: '工程数据不是有效的 JSON 对象' };
  }

  const d = raw as Record<string, unknown>;

  if (d.v !== 1) {
    return { valid: false, error: `不支持的工程 Schema 版本: ${d.v} (当前仅支持 v1)` };
  }

  // 36 色板校验
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

  // 像素索引校验
  if (typeof d.pixels !== 'string') {
    return { valid: false, error: '缺少有效的 pixels 字段' };
  }

  let pixelsBytes: Uint8Array;
  try {
    pixelsBytes = base64ToUint8Array(d.pixels);
  } catch {
    return { valid: false, error: 'pixels 字段 Base64 解码失败' };
  }

  if (pixelsBytes.length !== 4096) {
    return { valid: false, error: `pixels 像素点数量异常：应严格为 4096 像素，当前为 ${pixelsBytes.length}` };
  }

  for (let i = 0; i < 4096; i++) {
    if (pixelsBytes[i] > 35 && pixelsBytes[i] !== TRANSPARENT_INDEX) {
      return { valid: false, error: `像素索引超出 36 色板范围 (0~35 或 255 透明): 索引 ${pixelsBytes[i]} at offset ${i}` };
    }
  }

  // 遮罩分区校验
  if (typeof d.mask !== 'string') {
    return { valid: false, error: '缺少有效的 mask 字段' };
  }

  let maskBytes: Uint8Array;
  try {
    maskBytes = base64ToUint8Array(d.mask);
  } catch {
    return { valid: false, error: 'mask 字段 Base64 解码失败' };
  }

  if (maskBytes.length !== 4096) {
    return { valid: false, error: `mask 语义遮罩数据量异常：应严格为 4096 字节，当前为 ${maskBytes.length}` };
  }

  for (let i = 0; i < 4096; i++) {
    if (maskBytes[i] > 4) {
      return { valid: false, error: `遮罩值超出 5 分区范围 (0~4): 值 ${maskBytes[i]} at offset ${i}` };
    }
  }

  return {
    valid: true,
    data: {
      v: 1,
      palette: d.palette as string[],
      pixels: d.pixels,
      mask: d.mask,
      hairPreset: typeof d.hairPreset === 'string' ? d.hairPreset : null,
      ts: typeof d.ts === 'number' ? d.ts : Math.floor(Date.now() / 1000),
    },
  };
}

/**
 * 将 JavaScript 对象序列化为纯 ASCII 安全的 JSON 字符串
 * 非 ASCII 字符（如中文发色预设名）转义为 \uXXXX，确保 100% 兼容 ISO Latin-1 标准
 */
function toLatin1SafeJson(obj: unknown): string {
  return JSON.stringify(obj).replace(/[\u007F-\uFFFF]/g, (chr) => {
    return '\\u' + ('0000' + chr.charCodeAt(0).toString(16)).slice(-4);
  });
}

/**
 * 从 PNG 文件流中提取内嵌的 ImageGemProject 工程数据
 * @param buffer PNG 文件的 ArrayBuffer
 * @returns 成功且通过严格校验则返回 ImageGemProjectData，否则返回 null
 */
export function decodeProjectFromPng(buffer: ArrayBuffer): ImageGemProjectData | null {
  if (!isValidPng(buffer)) return null;

  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 8; // 跳过 8 字节签名

  const keywordBytes = new TextEncoder().encode(PROJECT_CHUNK_KEYWORD);

  while (offset + 8 <= buffer.byteLength) {
    const chunkLength = view.getUint32(offset);

    // 严密越界检查：防止畸形或损坏 Chunk 导致内存越界
    if (offset + 12 + chunkLength > buffer.byteLength) {
      console.warn('Malformed PNG: chunk length exceeds file bounds.');
      break;
    }

    const chunkType = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );

    const chunkDataOffset = offset + 8;
    const nextChunkOffset = chunkDataOffset + chunkLength + 4; // 数据长度 + 4字节CRC

    if (chunkType === 'tEXt' || chunkType === 'iTXt') {
      // 检查是否以 "ImageGemProject\0" 开头
      let isKeywordMatch = true;
      if (chunkLength > keywordBytes.length) {
        for (let k = 0; k < keywordBytes.length; k++) {
          if (bytes[chunkDataOffset + k] !== keywordBytes[k]) {
            isKeywordMatch = false;
            break;
          }
        }

        // 分隔符必须是 null 字符 (\0)
        if (isKeywordMatch && bytes[chunkDataOffset + keywordBytes.length] === 0) {
          let jsonStart = chunkDataOffset + keywordBytes.length + 1;

          // 若为 iTXt，额外跳过压缩标志 (1byte)、压缩方法 (1byte)、语言标签与翻译关键词
          if (chunkType === 'iTXt') {
            let p = jsonStart;
            // 跳过 compression flag (1) + compression method (1)
            p += 2;
            // 跳过 language tag (null-terminated)
            while (p < chunkDataOffset + chunkLength && bytes[p] !== 0) p++;
            p++; // skip null
            // 跳过 translated keyword (null-terminated)
            while (p < chunkDataOffset + chunkLength && bytes[p] !== 0) p++;
            p++; // skip null
            jsonStart = p;
          }

          const jsonEnd = chunkDataOffset + chunkLength;
          if (jsonStart < jsonEnd) {
            const jsonSlice = bytes.subarray(jsonStart, jsonEnd);
            try {
              const jsonText = new TextDecoder('utf-8').decode(jsonSlice);
              const rawData = JSON.parse(jsonText);
              const validation = validateProjectData(rawData);
              if (validation.valid && validation.data) {
                return validation.data;
              } else {
                console.warn('ImageGemProject metadata validation failed:', validation.error);
              }
            } catch (e) {
              console.warn('Failed to parse embedded ImageGemProject JSON:', e);
            }
          }
        }
      }
    }

    if (chunkType === 'IEND') {
      break;
    }

    offset = nextChunkOffset;
  }

  return null;
}

/**
 * 将 ImageGemProject 工程数据封装为标准 Latin-1 安全的 tEXt chunk 并嵌入到 PNG 中
 * @param pngBuffer 原始 64x64 PNG 的 ArrayBuffer
 * @param projectData 要嵌入的工程数据
 * @returns 注入 tEXt chunk 后的全新 PNG 二进制数据 (Uint8Array)
 */
export function encodeProjectToPng(pngBuffer: ArrayBuffer, projectData: ImageGemProjectData): Uint8Array {
  if (!isValidPng(pngBuffer)) {
    throw new Error('Provided buffer is not a valid PNG image.');
  }

  // 严格前置校验工程数据合法性
  const validation = validateProjectData(projectData);
  if (!validation.valid || !validation.data) {
    throw new Error(`Project data validation failed: ${validation.error}`);
  }

  const view = new DataView(pngBuffer);
  const bytes = new Uint8Array(pngBuffer);
  let offset = 8;
  let iendOffset = -1;

  // 线性扫描定位 IEND chunk，带越界防御
  while (offset + 8 <= pngBuffer.byteLength) {
    const chunkLength = view.getUint32(offset);
    if (offset + 12 + chunkLength > pngBuffer.byteLength) {
      break;
    }

    const chunkType = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );

    if (chunkType === 'IEND') {
      iendOffset = offset;
      break;
    }

    offset += 12 + chunkLength;
  }

  if (iendOffset === -1) {
    throw new Error('Invalid PNG: IEND chunk not found.');
  }

  // 构造 Latin-1 安全的 JSON 字符串（中文字符转为 \uXXXX）
  const encoder = new TextEncoder();
  const keywordEncoded = encoder.encode(PROJECT_CHUNK_KEYWORD);
  const safeJsonString = toLatin1SafeJson(validation.data);
  const jsonEncoded = encoder.encode(safeJsonString);

  // Chunk Data = Keyword (15) + null (1) + JSON
  const chunkDataLength = keywordEncoded.length + 1 + jsonEncoded.length;
  const chunkData = new Uint8Array(chunkDataLength);
  chunkData.set(keywordEncoded, 0);
  chunkData[keywordEncoded.length] = 0; // null separator
  chunkData.set(jsonEncoded, keywordEncoded.length + 1);

  // 计算 CRC32：Type ('tEXt') + Data
  const typeBytes = encoder.encode('tEXt');
  const crcPayload = new Uint8Array(4 + chunkDataLength);
  crcPayload.set(typeBytes, 0);
  crcPayload.set(chunkData, 4);
  const crcValue = calculateCrc32(crcPayload);

  // 构造完整的 tEXt chunk: Length (4) + Type (4) + Data + CRC (4)
  const totalChunkLength = 12 + chunkDataLength;
  const textChunk = new Uint8Array(totalChunkLength);
  const chunkView = new DataView(textChunk.buffer);

  chunkView.setUint32(0, chunkDataLength, false); // Length (big-endian)
  textChunk.set(typeBytes, 4);                     // Type
  textChunk.set(chunkData, 8);                     // Data
  chunkView.setUint32(8 + chunkDataLength, crcValue, false); // CRC (big-endian)

  // 拼接最终 PNG: [Header ~ IEND 前] + [tEXt Chunk] + [IEND 及后续内容]
  const beforeIend = bytes.subarray(0, iendOffset);
  const fromIend = bytes.subarray(iendOffset);

  const output = new Uint8Array(beforeIend.length + textChunk.length + fromIend.length);
  output.set(beforeIend, 0);
  output.set(textChunk, beforeIend.length);
  output.set(fromIend, beforeIend.length + textChunk.length);

  return output;
}
