import { describe, it, expect } from 'vitest';
import {
  validateProjectData,
  documentToProjectData,
  projectDataToDocument,
  uint8ArrayToBase64,
  CURRENT_PROJECT_VERSION,
} from '../src/core/projectData';
import { ProjectData, SemanticZone, HairPresetKey } from '../src/types';
import { PALETTE_36, TRANSPARENT_INDEX, RAMPS_INFO, isHairPresetKey } from '../src/data/palette';
import { PIXEL_COUNT } from '../src/core/pixelGrid';
import {
  createValidDocument,
  createEmptyDocument,
  assertDocumentEqual,
  assertDocumentInvariant,
} from './helpers/documentFixture';

describe('Project Data Codec and Validation (T01)', () => {
  function createValidRawProject(): Record<string, unknown> {
    const pixels = new Uint8Array(PIXEL_COUNT).fill(TRANSPARENT_INDEX);
    const mask = new Uint8Array(PIXEL_COUNT).fill(SemanticZone.Background);
    return {
      v: 1,
      palette: [...PALETTE_36],
      pixels: uint8ArrayToBase64(pixels),
      mask: uint8ArrayToBase64(mask),
      hairPreset: '01_black_黑',
      ts: 1700000000,
    };
  }

  describe('isHairPresetKey type guard', () => {
    it('accepts all 9 valid hair preset keys', () => {
      const keys = Object.keys(RAMPS_INFO);
      expect(keys).toHaveLength(9);
      for (const k of keys) {
        expect(isHairPresetKey(k)).toBe(true);
      }
    });

    it('rejects invalid strings, null, undefined, numbers, and prototype properties', () => {
      expect(isHairPresetKey('not-a-preset')).toBe(false);
      expect(isHairPresetKey('')).toBe(false);
      expect(isHairPresetKey(null)).toBe(false);
      expect(isHairPresetKey(undefined)).toBe(false);
      expect(isHairPresetKey(123)).toBe(false);
      expect(isHairPresetKey({})).toBe(false);
      // Prototype property test
      expect(isHairPresetKey('toString')).toBe(false);
      expect(isHairPresetKey('constructor')).toBe(false);
      expect(isHairPresetKey('valueOf')).toBe(false);
    });
  });

  describe('validateProjectData', () => {
    it('validates a correct project data object', () => {
      const raw = createValidRawProject();
      const res = validateProjectData(raw);
      expect(res.valid).toBe(true);
      expect(res.data).toBeDefined();
      expect(res.data?.hairPreset).toBe('01_black_黑');
      expect(res.data?.ts).toBe(1700000000);
    });

    it('accepts null or missing hairPreset', () => {
      const raw1 = createValidRawProject();
      raw1.hairPreset = null;
      const res1 = validateProjectData(raw1);
      expect(res1.valid).toBe(true);
      expect(res1.data?.hairPreset).toBeNull();

      const raw2 = createValidRawProject();
      delete raw2.hairPreset;
      const res2 = validateProjectData(raw2);
      expect(res2.valid).toBe(true);
      expect(res2.data?.hairPreset).toBeNull();
    });

    it('rejects invalid hairPreset string (B5)', () => {
      const raw = createValidRawProject();
      raw.hairPreset = 'not-a-preset';
      const res = validateProjectData(raw);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('发色预设');
    });

    it('rejects invalid hairPreset non-string types', () => {
      const rawNumber = createValidRawProject();
      rawNumber.hairPreset = 123;
      expect(validateProjectData(rawNumber).valid).toBe(false);

      const rawObj = createValidRawProject();
      rawObj.hairPreset = { preset: '01_black_黑' };
      expect(validateProjectData(rawObj).valid).toBe(false);
    });

    it('validates ts: accepts valid number or defaults missing ts', () => {
      const raw1 = createValidRawProject();
      raw1.ts = 123456789;
      const res1 = validateProjectData(raw1);
      expect(res1.valid).toBe(true);
      expect(res1.data?.ts).toBe(123456789);

      const raw2 = createValidRawProject();
      delete raw2.ts;
      const res2 = validateProjectData(raw2);
      expect(res2.valid).toBe(true);
      expect(typeof res2.data?.ts).toBe('number');
      expect(Number.isFinite(res2.data?.ts)).toBe(true);

      const raw3 = createValidRawProject();
      raw3.ts = 'not-a-number';
      expect(validateProjectData(raw3).valid).toBe(false);

      const raw4 = createValidRawProject();
      raw4.ts = Infinity;
      expect(validateProjectData(raw4).valid).toBe(false);
    });

    it('rejects non-object input', () => {
      expect(validateProjectData(null).valid).toBe(false);
      expect(validateProjectData(undefined).valid).toBe(false);
      expect(validateProjectData('string').valid).toBe(false);
      expect(validateProjectData(42).valid).toBe(false);
    });

    it('rejects unsupported schema version', () => {
      const raw = createValidRawProject();
      raw.v = 999;
      const res = validateProjectData(raw);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Schema');
    });

    it('rejects invalid palette length and format', () => {
      const rawShort = createValidRawProject();
      rawShort.palette = ['#000000'];
      expect(validateProjectData(rawShort).valid).toBe(false);

      const rawBadHex = createValidRawProject();
      (rawBadHex.palette as string[])[0] = 'not-hex';
      expect(validateProjectData(rawBadHex).valid).toBe(false);

      const rawShortHex = createValidRawProject();
      (rawShortHex.palette as string[])[0] = '#fff';
      expect(validateProjectData(rawShortHex).valid).toBe(false);
    });

    it('rejects invalid Base64 or corrupted bytes in pixels/mask', () => {
      const rawBadBase64 = createValidRawProject();
      rawBadBase64.pixels = '***not-base64***';
      expect(validateProjectData(rawBadBase64).valid).toBe(false);

      const rawShortPixels = createValidRawProject();
      rawShortPixels.pixels = uint8ArrayToBase64(new Uint8Array(100));
      expect(validateProjectData(rawShortPixels).valid).toBe(false);

      const rawOutRangePixel = createValidRawProject();
      const pixels = new Uint8Array(PIXEL_COUNT).fill(0);
      pixels[10] = 36; // out of range 0~35 and not 255
      rawOutRangePixel.pixels = uint8ArrayToBase64(pixels);
      expect(validateProjectData(rawOutRangePixel).valid).toBe(false);

      const rawOutRangeMask = createValidRawProject();
      const mask = new Uint8Array(PIXEL_COUNT).fill(0);
      mask[10] = 5; // out of range 0~4
      rawOutRangeMask.mask = uint8ArrayToBase64(mask);
      expect(validateProjectData(rawOutRangeMask).valid).toBe(false);
    });
  });

  describe('documentToProjectData & projectDataToDocument roundtrip', () => {
    it('roundtrips a valid document without mutation or loss', () => {
      const doc = createValidDocument({
        currentHairPreset: '02_brown_棕' as HairPresetKey,
        pixels: (setPixel) => {
          setPixel(0, 0, 0, SemanticZone.Background);
          setPixel(1, 0, 7, SemanticZone.Skin);
          setPixel(2, 0, 25, SemanticZone.Hair);
        },
      });

      const fixedTimestamp = 1710000000;
      const projectData = documentToProjectData(doc, fixedTimestamp);

      // Verify structure
      expect(projectData.v).toBe(CURRENT_PROJECT_VERSION);
      expect(projectData.hairPreset).toBe('02_brown_棕');
      expect(projectData.ts).toBe(fixedTimestamp);

      // Verify validation passes
      const validation = validateProjectData(projectData);
      expect(validation.valid).toBe(true);

      // Decode back
      const { document: restoredDoc, warnings } = projectDataToDocument(validation.data!);
      expect(warnings).toHaveLength(0);

      assertDocumentEqual(restoredDoc, doc);
      assertDocumentInvariant(restoredDoc);
    });

    it('does not mutate input document during documentToProjectData', () => {
      const doc = createEmptyDocument();
      const originalPalette = [...doc.palette];
      const originalPixels = new Uint8Array(doc.pixelIndices);
      const originalMask = new Uint8Array(doc.semanticMask);

      const data = documentToProjectData(doc);
      // Mutating data should not mutate doc
      data.palette[0] = '#999999';

      expect(doc.palette).toEqual(originalPalette);
      expect(doc.pixelIndices).toEqual(originalPixels);
      expect(doc.semanticMask).toEqual(originalMask);
    });

    it('normalizes legacy transparent pixel with non-background mask and produces a warning', () => {
      const pixels = new Uint8Array(PIXEL_COUNT).fill(TRANSPARENT_INDEX);
      const mask = new Uint8Array(PIXEL_COUNT).fill(SemanticZone.Background);
      // Legacy flaw: transparent pixel has Hair mask
      mask[5] = SemanticZone.Hair;
      mask[10] = SemanticZone.Skin;

      const legacyProject: ProjectData = {
        v: 1,
        palette: [...PALETTE_36],
        pixels: uint8ArrayToBase64(pixels),
        mask: uint8ArrayToBase64(mask),
        hairPreset: null,
        ts: 1700000000,
      };

      const { document: doc, warnings } = projectDataToDocument(legacyProject);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('2 处透明像素');
      expect(doc.semanticMask[5]).toBe(SemanticZone.Background);
      expect(doc.semanticMask[10]).toBe(SemanticZone.Background);
      assertDocumentInvariant(doc);
    });
  });
});
