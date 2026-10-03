import { importProjectZip } from '../src/core/projectArchive';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';
import {
  generateProjectZipBlob,
} from '../src/app/browser/projectArchive';
import { base64ToUint8Array } from '../src/core/projectData';
import { cloneDocument } from '../src/model/document';
import { createValidDocument, VALID_HAIR_PRESET_KEYS } from './helpers/documentFixture';
import { SemanticZone } from '../src/types';
import { hexToRgb } from '../src/core/colorUtils';

describe('ZIP Exporter & Snapshot State Consistency (T07 / B7)', () => {
  let originalDocument: any;
  let originalUrl: any;
  let renderedImages: Uint8ClampedArray[];

  beforeEach(() => {
    originalDocument = globalThis.document;
    originalUrl = globalThis.URL;
    renderedImages = [];

    const mockBody = {
      appendChild: vi.fn((child) => child),
      removeChild: vi.fn((child) => child),
    };

    const mockDocument = {
      body: mockBody,
      createElement: vi.fn((tag: string) => {
        if (tag === 'a') {
          return {
            href: '',
            download: '',
            click: vi.fn(),
          };
        }
        if (tag === 'canvas') {
          return {
            width: 0,
            height: 0,
            getContext: vi.fn(() => ({
              createImageData: vi.fn((w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })),
              putImageData: vi.fn((image: ImageData) => {
                renderedImages.push(new Uint8ClampedArray(image.data));
              }),
              drawImage: vi.fn(),
              imageSmoothingEnabled: false,
              fillRect: vi.fn(),
              strokeRect: vi.fn(),
              fillText: vi.fn(),
            })),
            toBlob: vi.fn((cb: BlobCallback) => cb(new Blob(['mock-blob-png'], { type: 'image/png' }))),
          };
        }
        return {};
      }),
    };

    globalThis.document = mockDocument as any;

    const mockURL = {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    };

    globalThis.URL = mockURL as any;
  });

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.URL = originalUrl;
    vi.restoreAllMocks();
  });

  describe('cloneDocument deep isolation', () => {
    it('creates an independent deep copy where mutations to the original do not affect clone', () => {
      const doc = createValidDocument({
        pixels: (set) => {
          set(0, 0, 10, SemanticZone.Hair);
        },
      });

      const clone = cloneDocument(doc);

      // Mutate original
      doc.palette[0] = '#FFFFFF';
      doc.pixelIndices[0] = 30;
      doc.semanticMask[0] = SemanticZone.Skin;
      doc.currentHairPreset = null;

      expect(clone.palette[0]).not.toBe('#FFFFFF');
      expect(clone.pixelIndices[0]).toBe(10);
      expect(clone.semanticMask[0]).toBe(SemanticZone.Hair);
    });
  });

  describe('generateProjectZipBlob snapshot isolation (B7)', () => {
    it('guarantees that mutating doc after initiating export does not alter the generated ZIP', async () => {
      const presetA = VALID_HAIR_PRESET_KEYS[0];
      const doc = createValidDocument({
        currentHairPreset: presetA,
        pixels: (set) => {
          set(0, 0, 15, SemanticZone.Hair);
          set(1, 0, 20, SemanticZone.Clothes);
        },
      });

      const originalHairRgba = [...hexToRgb(doc.palette[15]), 255];
      const originalClothesRgba = [...hexToRgb(doc.palette[20]), 255];

      // Start export and immediately mutate doc while export is in flight
      const zipBlobPromise = generateProjectZipBlob(doc);

      // Immediate concurrent mutations (simulating user drawing during export)
      doc.pixelIndices[0] = 5;
      doc.pixelIndices[1] = 255;
      doc.semanticMask[0] = SemanticZone.Skin;
      doc.semanticMask[1] = SemanticZone.Background;
      doc.palette[0] = '#000000';
      doc.currentHairPreset = null;

      const zipBlob = await zipBlobPromise;
      expect(zipBlob).toBeInstanceOf(Blob);

      // Load ZIP and inspect JSON content
      const zip = await JSZip.loadAsync(zipBlob);
      const jsonFile = zip.file('imagegem_project.json');
      expect(jsonFile).not.toBeNull();

      const jsonText = await jsonFile!.async('string');
      const parsed = JSON.parse(jsonText);

      // Verify that the ZIP retained the snapshot state (15 and 20), NOT the mutated state (5 and 255)
      const pixels = base64ToUint8Array(parsed.pixels);
      const mask = base64ToUint8Array(parsed.mask);
      expect(pixels[0]).toBe(15);
      expect(pixels[1]).toBe(20);
      expect(mask[0]).toBe(SemanticZone.Hair);
      expect(mask[1]).toBe(SemanticZone.Clothes);
      expect(parsed.hairPreset).toBe(presetA);
      // The original B7 bug mixed correct JSON with later render/mask data.
      // Inspect actual Canvas inputs instead of treating dummy blobs as pixels.
      expect(renderedImages).toHaveLength(10);
      for (const image of renderedImages.slice(0, 3)) {
        expect([...image.slice(0, 4)]).toEqual(originalHairRgba);
        expect([...image.slice(4, 8)]).toEqual(originalClothesRgba);
      }
      for (const image of renderedImages.slice(3, 5)) {
        expect([...image.slice(0, 4)]).toEqual([0, 229, 255, 255]);
        expect([...image.slice(4, 8)]).toEqual([255, 214, 0, 255]);
      }
    });

    it('roundtrips project through ZIP import', async () => {
      const presetB = VALID_HAIR_PRESET_KEYS[1];
      const doc = createValidDocument({
        currentHairPreset: presetB,
        pixels: (set) => {
          set(5, 5, 8, SemanticZone.Eyes);
        },
      });

      const zipBlob = await generateProjectZipBlob(doc);
      const file = new File([zipBlob], 'project.zip');

      const imported = await importProjectZip(file);
      expect(imported.v).toBe(1);
      expect(imported.hairPreset).toBe(presetB);
      const importedPixels = base64ToUint8Array(imported.pixels);
      const importedMask = base64ToUint8Array(imported.mask);
      expect(importedPixels[5 * 64 + 5]).toBe(8);
      expect(importedMask[5 * 64 + 5]).toBe(SemanticZone.Eyes);
    });

    it('rejects invalid or corrupted zip file', async () => {
      const corruptedFile = new File([new Uint8Array([1, 2, 3, 4, 5])], 'corrupt.zip');
      await expect(importProjectZip(corruptedFile)).rejects.toThrow('无法读取 ZIP 文件');
    });
  });
});
