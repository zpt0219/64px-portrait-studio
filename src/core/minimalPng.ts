/**
 * ImageGem Minimal Indexed-Color PNG Encoder
 * 遵循 ISO/IEC 15948 PNG 国际标准规范 (Color Type 3, Indexed Color + PLTE + tRNS)
 * 无任何多余 metadata chunk，将 64×64 36 色像素图体积压缩至约 400 字节。
 */

import { hexToRgb } from './colorUtils';
import { TRANSPARENT_INDEX } from '../data/palette';

/** PNG 8 字节文件签名 */
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** CRC-32 预计算查表 (ISO 3309) */
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

function calculateCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 创建标准 PNG Chunk: [4字节长度] + [4字节Type] + [Data] + [4字节CRC32]
 */
function createChunk(typeStr: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(typeStr);
  const chunkLength = data.length;
  const chunk = new Uint8Array(12 + chunkLength);
  const view = new DataView(chunk.buffer);

  // 1. Length (big-endian)
  view.setUint32(0, chunkLength, false);

  // 2. Type
  chunk.set(typeBytes, 4);

  // 3. Data
  chunk.set(data, 8);

  // 4. CRC32 (Type + Data)
  const crcPayload = new Uint8Array(4 + chunkLength);
  crcPayload.set(typeBytes, 0);
  crcPayload.set(data, 4);
  const crcVal = calculateCrc32(crcPayload);
  view.setUint32(8 + chunkLength, crcVal, false);

  return chunk;
}

/**
 * 针对 64x64 图像编码标准 8-bit 索引色极简 PNG (带原生透明度)
 * @param pixels 4096 长度的像素索引数组 (0~35 为色板序号，255 为透明)
 * @param palette 36 色色板 Hex 数组
 * @returns 极简无损 PNG 的 Blob (约 350~500 字节)
 */
export async function encodeMinimalIndexedPng(
  pixels: Uint8Array,
  palette: string[]
): Promise<Blob> {
  const width = 64;
  const height = 64;

  // 1. IHDR Chunk (13 字节)
  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdrData[8] = 8; // 8-bit bit depth
  ihdrData[9] = 3; // Color Type 3: Indexed-colour
  ihdrData[10] = 0; // Compression method: 0 (deflate)
  ihdrData[11] = 0; // Filter method: 0 (adaptive)
  ihdrData[12] = 0; // Interlace method: 0 (none)
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // 2. PLTE Chunk (色板表: 36 色 + 1 独立透明色槽位, 总计 37 个 RGB 实体)
  const numColors = palette.length;
  const transparentSlot = numColors; // 槽位 36 专门表示透明
  const plteData = new Uint8Array((numColors + 1) * 3);

  for (let i = 0; i < numColors; i++) {
    const rgb = hexToRgb(palette[i]);
    plteData[i * 3] = rgb[0];
    plteData[i * 3 + 1] = rgb[1];
    plteData[i * 3 + 2] = rgb[2];
  }
  // 索引 36 设置占位 RGB [0, 0, 0]
  plteData[transparentSlot * 3] = 0;
  plteData[transparentSlot * 3 + 1] = 0;
  plteData[transparentSlot * 3 + 2] = 0;

  const plteChunk = createChunk('PLTE', plteData);

  // 3. tRNS Chunk (透明度映射: 0~35 均为不透明 255, 槽位 36 为 0)
  const trnsData = new Uint8Array(transparentSlot + 1);
  trnsData.fill(255);
  trnsData[transparentSlot] = 0; // 完全透明
  const trnsChunk = createChunk('tRNS', trnsData);

  // 4. IDAT Chunk (图像扫描线 + 逐行 Filter 0 None)
  // 64 行，每行 1 字节 filter(0) + 64 字节像素索引 = 65 字节 * 64 = 4160 字节
  const scanlines = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (width + 1);
    scanlines[rowOffset] = 0; // Filter None

    for (let x = 0; x < width; x++) {
      const pIdx = pixels[y * width + x];
      if (pIdx === TRANSPARENT_INDEX) {
        scanlines[rowOffset + 1 + x] = transparentSlot;
      } else {
        scanlines[rowOffset + 1 + x] = pIdx < numColors ? pIdx : 0;
      }
    }
  }

  // 5. zlib/deflate 压缩
  let compressedIdatData: Uint8Array;
  if (typeof CompressionStream !== 'undefined') {
    const stream = new Response(scanlines).body!.pipeThrough(new CompressionStream('deflate'));
    compressedIdatData = new Uint8Array(await new Response(stream).arrayBuffer());
  } else {
    // 降级防御：极罕见无 CompressionStream 环境下构建无压缩 zlib 流
    compressedIdatData = fallbackZlibStore(scanlines);
  }

  const idatChunk = createChunk('IDAT', compressedIdatData);

  // 6. IEND Chunk (0 字节)
  const iendChunk = createChunk('IEND', new Uint8Array(0));

  // 7. 组装完整 PNG
  const totalLength =
    PNG_SIGNATURE.length +
    ihdrChunk.length +
    plteChunk.length +
    trnsChunk.length +
    idatChunk.length +
    iendChunk.length;

  const finalPngBytes = new Uint8Array(totalLength);
  let pos = 0;

  finalPngBytes.set(PNG_SIGNATURE, pos);
  pos += PNG_SIGNATURE.length;

  finalPngBytes.set(ihdrChunk, pos);
  pos += ihdrChunk.length;

  finalPngBytes.set(plteChunk, pos);
  pos += plteChunk.length;

  finalPngBytes.set(trnsChunk, pos);
  pos += trnsChunk.length;

  finalPngBytes.set(idatChunk, pos);
  pos += idatChunk.length;

  finalPngBytes.set(iendChunk, pos);

  return new Blob([finalPngBytes as unknown as BlobPart], { type: 'image/png' });
}

/**
 * 降级无压缩 zlib 流封装 (RFC 1950)
 */
function fallbackZlibStore(data: Uint8Array): Uint8Array {
  // zlib header: 0x78 0x01 (No compression / low)
  const len = data.length;
  // BFINAL=1, BTYPE=00 (uncompressed blocks max 65535)
  const numBlocks = Math.ceil(len / 65535);
  const out = new Uint8Array(2 + numBlocks * 5 + len + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let inPos = 0;
  let outPos = 2;

  for (let b = 0; b < numBlocks; b++) {
    const blockLen = Math.min(len - inPos, 65535);
    const isFinal = (b === numBlocks - 1) ? 1 : 0;
    out[outPos++] = isFinal;
    out[outPos++] = blockLen & 0xff;
    out[outPos++] = (blockLen >> 8) & 0xff;
    const nlen = blockLen ^ 0xffff;
    out[outPos++] = nlen & 0xff;
    out[outPos++] = (nlen >> 8) & 0xff;
    out.set(data.subarray(inPos, inPos + blockLen), outPos);
    inPos += blockLen;
    outPos += blockLen;
  }

  // Adler-32
  let s1 = 1;
  let s2 = 0;
  for (let i = 0; i < len; i++) {
    s1 = (s1 + data[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  const adler = ((s2 << 16) | s1) >>> 0;
  out[outPos++] = (adler >> 24) & 0xff;
  out[outPos++] = (adler >> 16) & 0xff;
  out[outPos++] = (adler >> 8) & 0xff;
  out[outPos++] = adler & 0xff;

  return out.subarray(0, outPos);
}
