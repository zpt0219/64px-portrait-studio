import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  rgbToOklab,
  oklabDistance,
  findNearestColor,
  quantizeToPalette,
  Rgb,
} from '../src/core/colorUtils';
import { PALETTE_36 } from '../src/core/constants';

describe('colorUtils', () => {
  it('hexToRgb parses hex colors correctly', () => {
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255]);
    expect(hexToRgb('#ff0000')).toEqual([255, 0, 0]);
    expect(hexToRgb('#00ff00')).toEqual([0, 255, 0]);
    expect(hexToRgb('#0000ff')).toEqual([0, 0, 255]);
    expect(hexToRgb('123456')).toEqual([18, 52, 86]);
  });

  it('rgbToOklab and oklabDistance calculates perceptual distances', () => {
    const labBlack = rgbToOklab([0, 0, 0]);
    const labWhite = rgbToOklab([255, 255, 255]);
    expect(labBlack[0]).toBeCloseTo(0, 2);
    expect(labWhite[0]).toBeCloseTo(1, 2);

    const distSame = oklabDistance([100, 100, 100], [100, 100, 100]);
    expect(distSame).toBe(0);

    const distDiff = oklabDistance([0, 0, 0], [255, 255, 255]);
    expect(distDiff).toBeGreaterThan(0.9);
  });

  it('findNearestColor finds closest palette match', () => {
    // Pure black should map to #000000 (which is PALETTE_36[0])
    const nearestBlack = findNearestColor('#000000', PALETTE_36);
    expect(nearestBlack.toUpperCase()).toBe(PALETTE_36[0].toUpperCase());

    // Pure white should map to #FFFFFF (which is PALETTE_36[1])
    const nearestWhite = findNearestColor('#FFFFFF', PALETTE_36);
    expect(nearestWhite.toUpperCase()).toBe(PALETTE_36[1].toUpperCase());
  });

  it('quantizeToPalette quantizes an RGB buffer to palette indices', () => {
    const paletteRgb: Rgb[] = PALETTE_36.map(hexToRgb);
    // 2 pixels: 1st black, 2nd white
    const pixels: Rgb[] = [
      [0, 0, 0],
      [255, 255, 255],
    ];
    const indices = quantizeToPalette(pixels, paletteRgb);
    expect(indices.length).toBe(2);
    expect(indices[0]).toBe(0); // Black index in PALETTE_36 is 0
    expect(indices[1]).toBe(1); // White index in PALETTE_36 is 1
  });
});
