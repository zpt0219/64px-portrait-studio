import { describe, it, expect } from 'vitest';
import { uint8ArrayToBase64, base64ToUint8Array } from '../src/utils/base64';
import { percentile, percentileInt, median, mean, clamp } from '../src/utils/mathUtils';
import { encodeMinimalIndexedPng } from '../src/utils/minimalPng';
import { guessMimeType } from '../src/app/browser/domUtils';
import { PALETTE_36 } from '../src/core/constants';

describe('Utility Modules (src/utils & domUtils)', () => {
  describe('base64', () => {
    it('round-trips Uint8Array through base64 encoding and decoding', () => {
      const original = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
      const base64 = uint8ArrayToBase64(original);
      const decoded = base64ToUint8Array(base64);
      expect(Array.from(decoded)).toEqual(Array.from(original));
    });

    it('handles empty Uint8Array', () => {
      const empty = new Uint8Array(0);
      const base64 = uint8ArrayToBase64(empty);
      expect(base64).toBe('');
      expect(base64ToUint8Array(base64).length).toBe(0);
    });
  });

  describe('mathUtils', () => {
    it('calculates mean and median correctly', () => {
      expect(mean([1, 2, 3, 4, 5])).toBe(3);
      expect(median([1, 3, 5])).toBe(3);
      expect(median([1, 2, 3, 4])).toBe(2.5);
    });

    it('calculates percentiles and clamp correctly', () => {
      const values = [10, 20, 30, 40, 50];
      expect(percentile(values, 0)).toBe(10);
      expect(percentile(values, 1)).toBe(50);
      expect(percentileInt(values, 0.5)).toBe(30);

      expect(clamp(5, 10, 20)).toBe(10);
      expect(clamp(25, 10, 20)).toBe(20);
      expect(clamp(15, 10, 20)).toBe(15);
    });
  });

  describe('minimalPng', () => {
    it('encodes 64x64 indexed pixels into valid PNG bytes with PNG signature', async () => {
      const pixels = new Uint8Array(4096).fill(0);
      const blob = await encodeMinimalIndexedPng(pixels, [...PALETTE_36]);
      expect(blob.type).toBe('image/png');
      expect(blob.size).toBeGreaterThan(100);
      expect(blob.size).toBeLessThan(1500); // 极简 PNG 约 400 字节

      const buffer = new Uint8Array(await blob.arrayBuffer());
      // PNG 文件头校验: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
      expect(Array.from(buffer.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    });
  });

  describe('domUtils', () => {
    it('infers MIME type from file extension or file.type', () => {
      expect(guessMimeType({ type: 'image/webp', name: 'test.bin' } as File)).toBe('image/webp');
      expect(guessMimeType({ type: '', name: 'test.jpg' } as File)).toBe('image/jpeg');
      expect(guessMimeType({ type: '', name: 'test.jpeg' } as File)).toBe('image/jpeg');
      expect(guessMimeType({ type: '', name: 'test.webp' } as File)).toBe('image/webp');
      expect(guessMimeType({ type: '', name: 'test.bmp' } as File)).toBe('image/bmp');
      expect(guessMimeType({ type: '', name: 'test.png' } as File)).toBe('image/png');
      expect(guessMimeType({ type: '', name: 'unknown' } as File)).toBe('image/png');
    });
  });
});
