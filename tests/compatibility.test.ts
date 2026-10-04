import { describe, it, expect } from 'vitest';
import { processDecodedImage } from '../src/core/imageImport';
import {
  validateProjectData,
  documentToProjectData,
  projectDataToDocument,
  uint8ArrayToBase64,
  CURRENT_PROJECT_VERSION,
} from '../src/core/projectData';
import { PALETTE_36, TRANSPARENT_INDEX } from '../src/data/palette';
import { DecodedImage, SemanticZone, ProjectData } from '../src/types';
import { PIXEL_COUNT, IMAGE_WIDTH as W, IMAGE_HEIGHT as H } from '../src/core/pixelGrid';
import { assertDocumentInvariant, assertDocumentEqual } from './helpers/documentFixture';

describe('Compatibility & Domain Pipeline Invariants (T11)', () => {
  const palette = [...PALETTE_36];

  function createRgbaBuffer(): Uint8ClampedArray {
    return new Uint8ClampedArray(PIXEL_COUNT * 4);
  }

  function setRgba(buf: Uint8ClampedArray, x: number, y: number, r: number, g: number, b: number, a = 255): void {
    const idx = (y * W + x) * 4;
    buf[idx] = r;
    buf[idx + 1] = g;
    buf[idx + 2] = b;
    buf[idx + 3] = a;
  }

  describe('Synthetic Decoded Image Processing', () => {
    it('processes portrait with skin, hair, and transparent background correctly', () => {
      const rgba = createRgbaBuffer();
      // Background is transparent (a = 0)
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          setRgba(rgba, x, y, 0, 0, 0, 0);
        }
      }

      // Draw head: Hair on top, Face in center
      // Hair: Dark brown [45, 25, 20]
      for (let y = 14; y < 26; y++) {
        for (let x = 20; x < 44; x++) {
          setRgba(rgba, x, y, 45, 25, 20, 255);
        }
      }
      // Face: Skin tone [255, 219, 172]
      for (let y = 26; y < 44; y++) {
        for (let x = 22; x < 42; x++) {
          setRgba(rgba, x, y, 255, 219, 172, 255);
        }
      }

      const img: DecodedImage = {
        rgba,
        origW: 64,
        origH: 64,
        targetW: 64,
        targetH: 64,
      };

      const result = processDecodedImage(img, palette);
      const doc = result.document;

      // Transparent corners must be transparent and Background mask
      expect(doc.pixelIndices[0]).toBe(TRANSPARENT_INDEX);
      expect(doc.semanticMask[0]).toBe(SemanticZone.Background);

      // Face center must be non-transparent and have Skin or Hair mask
      const faceIdx = 32 * W + 32;
      expect(doc.pixelIndices[faceIdx]).not.toBe(TRANSPARENT_INDEX);
      expect([SemanticZone.Skin, SemanticZone.Hair]).toContain(doc.semanticMask[faceIdx]);

      // Message for exact 64x64
      expect(result.importInfo.message).toContain('已自动完成 36 色量化与 5 分区遮罩生成');
      assertDocumentInvariant(doc);
    });

    it('processes different hair colors (e.g. golden blonde)', () => {
      const rgba = createRgbaBuffer();
      // Blonde hair [255, 215, 0]
      for (let y = 14; y < 26; y++) {
        for (let x = 20; x < 44; x++) {
          setRgba(rgba, x, y, 235, 195, 80, 255);
        }
      }
      for (let y = 26; y < 44; y++) {
        for (let x = 22; x < 42; x++) {
          setRgba(rgba, x, y, 255, 219, 172, 255);
        }
      }

      const img: DecodedImage = {
        rgba,
        origW: 64,
        origH: 64,
        targetW: 64,
        targetH: 64,
      };

      const result = processDecodedImage(img, palette);
      expect(result.document.pixelIndices[20 * W + 32]).not.toBe(TRANSPARENT_INDEX);
      assertDocumentInvariant(result.document);
    });

    it('formats appropriate message for small image centered', () => {
      const rgba = createRgbaBuffer();
      const img: DecodedImage = {
        rgba,
        origW: 32,
        origH: 32,
        targetW: 32,
        targetH: 32,
      };
      const result = processDecodedImage(img, palette);
      expect(result.importInfo.message).toContain('已居中置入 64×64 画布');
    });

    it('formats appropriate message for larger image scaled', () => {
      const rgba = createRgbaBuffer();
      const img: DecodedImage = {
        rgba,
        origW: 128,
        origH: 128,
        targetW: 64,
        targetH: 64,
      };
      const result = processDecodedImage(img, palette);
      expect(result.importInfo.message).toContain('已智能缩放至 64×64');
    });

    it('safely handles non-face uniform image without throwing error', () => {
      const rgba = createRgbaBuffer();
      // Pure solid magenta [255, 0, 255]
      for (let i = 0; i < PIXEL_COUNT; i++) {
        setRgba(rgba, i % W, Math.floor(i / W), 255, 0, 255, 255);
      }
      const img: DecodedImage = {
        rgba,
        origW: 64,
        origH: 64,
        targetW: 64,
        targetH: 64,
      };
      const result = processDecodedImage(img, palette);
      expect(result.document).toBeDefined();
      expect(result.document.pixelIndices).toHaveLength(PIXEL_COUNT);
      assertDocumentInvariant(result.document);
    });
  });

  describe('Legacy v1 Project Fixture Byte-Level Roundtrip', () => {
    it('loads legal legacy v1 project fixture and roundtrips with 100% fidelity', () => {
      const pixels = new Uint8Array(PIXEL_COUNT).fill(TRANSPARENT_INDEX);
      const mask = new Uint8Array(PIXEL_COUNT).fill(SemanticZone.Background);

      // Create a deterministic pattern
      for (let i = 100; i < 200; i++) {
        pixels[i] = i % 36;
        mask[i] = (i % 4) + 1; // Zones 1..4 (non-transparent)
      }

      const rawV1Project: ProjectData = {
        v: 1,
        palette: [...PALETTE_36],
        pixels: uint8ArrayToBase64(pixels),
        mask: uint8ArrayToBase64(mask),
        hairPreset: '01_black_黑',
        ts: 1709000000,
      };

      // 1. Validate
      const validation = validateProjectData(rawV1Project);
      expect(validation.valid).toBe(true);

      // 2. Decode to document
      const { document: doc1, warnings } = projectDataToDocument(validation.data!);
      expect(warnings).toHaveLength(0);
      assertDocumentInvariant(doc1);

      // 3. Encode back to project data
      const encodedData = documentToProjectData(doc1, 1709000000);
      expect(encodedData.v).toBe(CURRENT_PROJECT_VERSION);
      expect(encodedData.hairPreset).toBe('01_black_黑');
      expect(encodedData.pixels).toBe(validation.data!.pixels);
      expect(encodedData.mask).toBe(validation.data!.mask);

      // 4. Decode again
      const { document: doc2 } = projectDataToDocument(encodedData);
      assertDocumentEqual(doc1, doc2);
    });

    it('detects and corrects legacy transparent pixel flaw with warning', () => {
      const pixels = new Uint8Array(PIXEL_COUNT).fill(TRANSPARENT_INDEX);
      const mask = new Uint8Array(PIXEL_COUNT).fill(SemanticZone.Background);

      // Legacy flaw: transparent pixels tagged as Clothes and Hair
      mask[42] = SemanticZone.Clothes;
      mask[43] = SemanticZone.Hair;

      const legacyProject: ProjectData = {
        v: 1,
        palette: [...PALETTE_36],
        pixels: uint8ArrayToBase64(pixels),
        mask: uint8ArrayToBase64(mask),
        hairPreset: null,
        ts: 1700000000,
      };

      const { document: doc, warnings } = projectDataToDocument(legacyProject);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('2 处透明像素');

      // Normalized to Background (0)
      expect(doc.semanticMask[42]).toBe(SemanticZone.Background);
      expect(doc.semanticMask[43]).toBe(SemanticZone.Background);
      assertDocumentInvariant(doc);
    });
  });
});
