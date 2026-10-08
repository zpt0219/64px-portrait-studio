import { describe, it, expect } from 'vitest';
import { computeSemanticMask } from '../src/core/segmentation';
import { estimateForeground } from '../src/core/segmentation/background';
import { analyzePixelOutline } from '../src/core/segmentation/contour';
import { analyzeFace } from '../src/core/segmentation/faceAnalysis';
import { Rgb } from '../src/utils/colorUtils';
import { PIXEL_COUNT, IMAGE_WIDTH as W, IMAGE_HEIGHT as H } from '../src/core/pixelGrid';
import { SemanticZone } from '../src/core/types';
import {
  createSyntheticPortraitRgb,
  createNonFaceObjectRgb,
  createBlondePortraitRgb,
  SYNTHETIC_PORTRAIT_ANCHORS,
} from './fixtures/segmentationFixtures';

describe('computeSemanticMask', () => {
  it('handles uniform background image without crashing', () => {
    // Pure black background image
    const pixels: Rgb[] = Array.from({ length: PIXEL_COUNT }, () => [0, 0, 0] as Rgb);
    const mask = computeSemanticMask(pixels);
    expect(mask.length).toBe(PIXEL_COUNT);
    // Entire image should be Background
    for (let i = 0; i < PIXEL_COUNT; i++) {
      expect(mask[i]).toBe(SemanticZone.None);
    }
  });

  it('identifies centered skin tone patch as face/skin', () => {
    // Background: white [255, 255, 255]
    const pixels: Rgb[] = Array.from({ length: PIXEL_COUNT }, () => [255, 255, 255] as Rgb);
    // Draw a face patch in the center with skin color [255, 222, 206] (#FFDECE)
    for (let y = 20; y < 40; y++) {
      for (let x = 20; x < 44; x++) {
        pixels[y * W + x] = [255, 222, 206];
      }
    }
    const mask = computeSemanticMask(pixels);
    expect(mask.length).toBe(PIXEL_COUNT);
    // Background corner should be Background
    expect(mask[0]).toBe(SemanticZone.None);
    // Center of face patch should be Skin or Hair/Eyes/Face
    const centerZone = mask[30 * W + 32];
    expect([SemanticZone.Skin, SemanticZone.Hair]).toContain(centerZone);
  });

  describe('Synthetic Portrait Fixture', () => {
    it('classifies synthetic portrait into appropriate semantic zones', () => {
      const portrait = createSyntheticPortraitRgb();
      const mask = computeSemanticMask(portrait);

      expect(mask.length).toBe(PIXEL_COUNT);

      // 1. Invariant: all values in valid range 0..4
      for (let i = 0; i < PIXEL_COUNT; i++) {
        expect(mask[i]).toBeGreaterThanOrEqual(SemanticZone.None);
        expect(mask[i]).toBeLessThanOrEqual(SemanticZone.Clothes);
      }

      // 2. Background anchor points must be SemanticZone.None
      const bgTopLeftIdx = SYNTHETIC_PORTRAIT_ANCHORS.bgTopLeft.y * W + SYNTHETIC_PORTRAIT_ANCHORS.bgTopLeft.x;
      const bgTopRightIdx = SYNTHETIC_PORTRAIT_ANCHORS.bgTopRight.y * W + SYNTHETIC_PORTRAIT_ANCHORS.bgTopRight.x;
      expect(mask[bgTopLeftIdx]).toBe(SemanticZone.None);
      expect(mask[bgTopRightIdx]).toBe(SemanticZone.None);

      // 3. Hair crown & temples anchors
      const hairCrownIdx = SYNTHETIC_PORTRAIT_ANCHORS.hairCrown.y * W + SYNTHETIC_PORTRAIT_ANCHORS.hairCrown.x;
      const hairLeftIdx = SYNTHETIC_PORTRAIT_ANCHORS.hairLeftTemple.y * W + SYNTHETIC_PORTRAIT_ANCHORS.hairLeftTemple.x;
      const hairRightIdx = SYNTHETIC_PORTRAIT_ANCHORS.hairRightTemple.y * W + SYNTHETIC_PORTRAIT_ANCHORS.hairRightTemple.x;
      expect(mask[hairCrownIdx]).toBe(SemanticZone.Hair);
      expect(mask[hairLeftIdx]).toBe(SemanticZone.Hair);
      expect(mask[hairRightIdx]).toBe(SemanticZone.Hair);

      // 4. Face/Skin anchors (forehead, cheeks, mouth, chin)
      const foreheadIdx = SYNTHETIC_PORTRAIT_ANCHORS.forehead.y * W + SYNTHETIC_PORTRAIT_ANCHORS.forehead.x;
      const cheekLeftIdx = SYNTHETIC_PORTRAIT_ANCHORS.cheekLeft.y * W + SYNTHETIC_PORTRAIT_ANCHORS.cheekLeft.x;
      const cheekRightIdx = SYNTHETIC_PORTRAIT_ANCHORS.cheekRight.y * W + SYNTHETIC_PORTRAIT_ANCHORS.cheekRight.x;
      const chinIdx = SYNTHETIC_PORTRAIT_ANCHORS.chin.y * W + SYNTHETIC_PORTRAIT_ANCHORS.chin.x;
      const mouthIdx = SYNTHETIC_PORTRAIT_ANCHORS.mouth.y * W + SYNTHETIC_PORTRAIT_ANCHORS.mouth.x;
      expect(mask[foreheadIdx]).toBe(SemanticZone.Skin);
      expect(mask[cheekLeftIdx]).toBe(SemanticZone.Skin);
      expect(mask[cheekRightIdx]).toBe(SemanticZone.Skin);
      expect(mask[chinIdx]).toBe(SemanticZone.Skin);
      expect(mask[mouthIdx]).toBe(SemanticZone.Skin);

      // 5. Eye region anchors
      const leftEyeIdx = SYNTHETIC_PORTRAIT_ANCHORS.leftEyeCenter.y * W + SYNTHETIC_PORTRAIT_ANCHORS.leftEyeCenter.x;
      const rightEyeIdx = SYNTHETIC_PORTRAIT_ANCHORS.rightEyeCenter.y * W + SYNTHETIC_PORTRAIT_ANCHORS.rightEyeCenter.x;
      expect([SemanticZone.Eyes, SemanticZone.Skin]).toContain(mask[leftEyeIdx]);
      expect([SemanticZone.Eyes, SemanticZone.Skin]).toContain(mask[rightEyeIdx]);

      // 6. Clothes anchors (chest and shoulders)
      const clothesCenterIdx = SYNTHETIC_PORTRAIT_ANCHORS.clothesCenter.y * W + SYNTHETIC_PORTRAIT_ANCHORS.clothesCenter.x;
      const clothesLeftIdx = SYNTHETIC_PORTRAIT_ANCHORS.clothesLeftShoulder.y * W + SYNTHETIC_PORTRAIT_ANCHORS.clothesLeftShoulder.x;
      const clothesRightIdx = SYNTHETIC_PORTRAIT_ANCHORS.clothesRightShoulder.y * W + SYNTHETIC_PORTRAIT_ANCHORS.clothesRightShoulder.x;
      expect(mask[clothesCenterIdx]).toBe(SemanticZone.Clothes);
      expect(mask[clothesLeftIdx]).toBe(SemanticZone.Clothes);
      expect(mask[clothesRightIdx]).toBe(SemanticZone.Clothes);
    });

    it('handles blonde hair portrait consistently', () => {
      const blondePortrait = createBlondePortraitRgb();
      const mask = computeSemanticMask(blondePortrait);

      expect(mask.length).toBe(PIXEL_COUNT);

      // Background remains None
      const bgIdx = SYNTHETIC_PORTRAIT_ANCHORS.bgTopLeft.y * W + SYNTHETIC_PORTRAIT_ANCHORS.bgTopLeft.x;
      expect(mask[bgIdx]).toBe(SemanticZone.None);

      // Face skin anchor remains Skin
      const cheekIdx = SYNTHETIC_PORTRAIT_ANCHORS.cheekLeft.y * W + SYNTHETIC_PORTRAIT_ANCHORS.cheekLeft.x;
      expect(mask[cheekIdx]).toBe(SemanticZone.Skin);

      // Clothes anchor remains Clothes
      const clothesIdx = SYNTHETIC_PORTRAIT_ANCHORS.clothesCenter.y * W + SYNTHETIC_PORTRAIT_ANCHORS.clothesCenter.x;
      expect(mask[clothesIdx]).toBe(SemanticZone.Clothes);
    });
  });

  describe('Pipeline Sub-stages', () => {
    it('estimateForeground cleanly separates border background from synthetic portrait silhouette', () => {
      const portrait = createSyntheticPortraitRgb();
      const { backgroundMask, foregroundMask } = estimateForeground(portrait);

      // Four canvas corners must be background
      expect(backgroundMask[0]).toBe(true);
      expect(backgroundMask[W - 1]).toBe(true);
      expect(backgroundMask[(H - 1) * W]).toBe(true);
      expect(backgroundMask[H * W - 1]).toBe(true);

      // Portrait center must be foreground
      const centerIdx = 30 * W + 32;
      expect(foregroundMask[centerIdx]).toBe(true);
      expect(backgroundMask[centerIdx]).toBe(false);

      // Mutual exclusivity
      for (let i = 0; i < PIXEL_COUNT; i++) {
        expect(backgroundMask[i]).toBe(!foregroundMask[i]);
      }
    });

    it('analyzeFace extracts anatomical structure on synthetic portrait and returns null on non-face', () => {
      const portrait = createSyntheticPortraitRgb();
      const { backgroundMask, foregroundMask } = estimateForeground(portrait);
      const outline = analyzePixelOutline(portrait, backgroundMask, foregroundMask);
      const face = analyzeFace(portrait, outline.outlineColors);

      expect(face).not.toBeNull();
      if (face) {
        expect(face.chinY).toBeGreaterThanOrEqual(35);
        expect(face.chinY).toBeLessThanOrEqual(45);
        expect(face.eyeLineY).toBeGreaterThanOrEqual(25);
        expect(face.eyeLineY).toBeLessThanOrEqual(35);
        expect(face.leftEyeCenter[0]).toBeLessThan(face.rightEyeCenter[0]);
      }

      // Non-face object must return null
      const nonFace = createNonFaceObjectRgb();
      const nonFaceEstimate = estimateForeground(nonFace);
      const nonFaceOutline = analyzePixelOutline(nonFace, nonFaceEstimate.backgroundMask, nonFaceEstimate.foregroundMask);
      const nonFaceAnalysis = analyzeFace(nonFace, nonFaceOutline.outlineColors);
      expect(nonFaceAnalysis).toBeNull();
    });
  });

  describe('Non-Face Object Fallback', () => {
    it('gracefully degrades to chin fallback when no face is present', () => {
      const objectRgb = createNonFaceObjectRgb();
      const mask = computeSemanticMask(objectRgb);

      expect(mask.length).toBe(PIXEL_COUNT);

      // Corners should be None (background)
      expect(mask[0]).toBe(SemanticZone.None);
      expect(mask[W - 1]).toBe(SemanticZone.None);

      // Object interior (shield green at 32, 30) should be Clothes (fallback chin behavior)
      const centerIdx = 30 * W + 32;
      expect(mask[centerIdx]).toBe(SemanticZone.Clothes);

      // Upper outline (y = 15, x = 32) is above FALLBACK_CHIN_Y (38), so it becomes Hair
      const upperOutlineIdx = 15 * W + 32;
      expect(mask[upperOutlineIdx]).toBe(SemanticZone.Hair);

      // Lower outline (y = 48, x = 32) is below FALLBACK_CHIN_Y (38), so it becomes Clothes
      const lowerOutlineIdx = 48 * W + 32;
      expect(mask[lowerOutlineIdx]).toBe(SemanticZone.Clothes);
    });
  });

  describe('Invariants and Edge Cases', () => {
    it('handles uniform white image returning all None (0)', () => {
      const whitePixels: Rgb[] = Array.from({ length: PIXEL_COUNT }, () => [255, 255, 255] as Rgb);
      const mask = computeSemanticMask(whitePixels);
      expect(mask).toBeInstanceOf(Uint8Array);
      expect(mask.length).toBe(PIXEL_COUNT);
      for (let i = 0; i < PIXEL_COUNT; i++) {
        expect(mask[i]).toBe(SemanticZone.None);
      }
    });

    it('satisfies semantic mask bounds invariant on diverse inputs', () => {
      const inputs = [
        Array.from({ length: PIXEL_COUNT }, () => [0, 0, 0] as Rgb),
        Array.from({ length: PIXEL_COUNT }, () => [255, 255, 255] as Rgb),
        createSyntheticPortraitRgb(),
        createNonFaceObjectRgb(),
        createBlondePortraitRgb(),
      ];

      for (const input of inputs) {
        const mask = computeSemanticMask(input);
        expect(mask).toBeInstanceOf(Uint8Array);
        expect(mask.length).toBe(PIXEL_COUNT);
        for (let i = 0; i < PIXEL_COUNT; i++) {
          const zone = mask[i];
          expect(zone).toBeGreaterThanOrEqual(SemanticZone.None);
          expect(zone).toBeLessThanOrEqual(SemanticZone.Clothes);
          expect(Number.isInteger(zone)).toBe(true);
        }
      }
    });
  });
});
