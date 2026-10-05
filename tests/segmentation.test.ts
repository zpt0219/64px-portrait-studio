import { describe, it, expect } from 'vitest';
import { computeSemanticMask } from '../src/core/segmentation';
import { Rgb } from '../src/core/colorUtils';
import { PIXEL_COUNT, IMAGE_WIDTH as W } from '../src/core/pixelGrid';
import { SemanticZone } from '../src/core/types';

describe('computeSemanticMask', () => {
  it('handles uniform background image without crashing', () => {
    // Pure black background image
    const pixels: Rgb[] = Array.from({ length: PIXEL_COUNT }, () => [0, 0, 0] as Rgb);
    const mask = computeSemanticMask(pixels);
    expect(mask.length).toBe(PIXEL_COUNT);
    // Entire image should be Background
    for (let i = 0; i < PIXEL_COUNT; i++) {
      expect(mask[i]).toBe(SemanticZone.Background);
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
    expect(mask[0]).toBe(SemanticZone.Background);
    // Center of face patch should be Skin or Hair/Eyes/Face
    const centerZone = mask[30 * W + 32];
    expect([SemanticZone.Skin, SemanticZone.Hair]).toContain(centerZone);
  });
});
