import { afterEach, describe, expect, it, vi } from 'vitest';
import { processDecodedImage } from '../src/core/imageImport';
import { PALETTE_36 } from '../src/data/palette';
import { DecodedImage, SemanticZone } from '../src/types';
import { hexToRgb } from '../src/core/colorUtils';

vi.mock('../src/core/segmentation', () => ({ computeSemanticMask: () => { throw new Error('synthetic segmentation failure'); } }));

describe('Pure image import fallback', () => {
  afterEach(() => vi.restoreAllMocks());
  it('returns warnings without logging, preserves current palette and protects transparent pixels', () => {
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const palette = [...PALETTE_36];
    palette[5] = '#123456';
    const rgba = new Uint8ClampedArray(4096 * 4);
    for (let i = 0; i < 4096; i++) rgba.set([...hexToRgb(palette[5]), 255], i * 4);
    rgba.set([255, 0, 0, 255], 4);
    rgba.set([255, 0, 0, 127], 8);
    const before = new Uint8ClampedArray(rgba);
    const image: DecodedImage = { rgba, origW: 64, origH: 64, targetW: 64, targetH: 64 };
    const result = processDecodedImage(image, palette);
    expect(result.warnings).toEqual(['⚠️ 人脸特征识别未达标，请在遮罩模式手动涂抹头发区域']);
    expect(result.document.pixelIndices[0]).toBe(5);
    expect(result.document.semanticMask[0]).toBe(SemanticZone.Background);
    expect(result.document.semanticMask[1]).toBe(SemanticZone.Clothes);
    expect(result.document.pixelIndices[2]).toBe(255);
    expect(result.document.semanticMask[2]).toBe(SemanticZone.Background);
    expect(result.document.palette).toEqual(palette);
    expect(result.document.palette).not.toBe(palette);
    expect(rgba).toEqual(before);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
