import { describe, it, expect } from 'vitest';
import {
  IMAGE_WIDTH,
  IMAGE_HEIGHT,
  PIXEL_COUNT,
  getNeighbours,
  borderOffsets,
  sideAndTopOffsets,
  connectedComponents,
  floodFill,
  maskFromOffsets,
} from '../src/core/pixelGrid';

describe('pixelGrid', () => {
  it('constants have correct dimensions', () => {
    expect(IMAGE_WIDTH).toBe(64);
    expect(IMAGE_HEIGHT).toBe(64);
    expect(PIXEL_COUNT).toBe(4096);
  });

  it('getNeighbours returns valid bounds without wrapping', () => {
    // Top-left corner (0, 0)
    const corner4 = Array.from(getNeighbours(0, false));
    expect(corner4.sort()).toEqual([1, 64].sort());

    const corner8 = Array.from(getNeighbours(0, true));
    expect(corner8.sort()).toEqual([1, 64, 65].sort());

    // Center pixel (10, 10)
    const center = 10 * 64 + 10;
    const center4 = Array.from(getNeighbours(center, false));
    expect(center4.length).toBe(4);
    const center8 = Array.from(getNeighbours(center, true));
    expect(center8.length).toBe(8);
  });

  it('borderOffsets and sideAndTopOffsets count correctly', () => {
    const borders = borderOffsets();
    // 64 * 4 - 4 (corners) = 252
    expect(borders.length).toBe(252);

    const sideAndTop = sideAndTopOffsets();
    // Top (64) + Left (63 excluding 0,0) + Right (63 excluding 63,0) = 190
    expect(sideAndTop.length).toBe(190);
  });

  it('connectedComponents finds distinct connected regions', () => {
    const mask = new Uint8Array(PIXEL_COUNT);
    // Region 1: (0,0) and (0,1)
    mask[0] = 1;
    mask[1] = 1;

    // Region 2: (10,10)
    mask[10 * 64 + 10] = 1;

    const comps = connectedComponents(mask, false);
    expect(comps.length).toBe(2);
    expect(comps.some((c) => c.length === 2)).toBe(true);
    expect(comps.some((c) => c.length === 1)).toBe(true);
  });

  it('floodFill fills predicate area and respects bounds', () => {
    const data = new Uint8Array(PIXEL_COUNT).fill(0);
    // Draw a small 2x2 box of 1s
    data[0] = 1; data[1] = 1;
    data[64] = 1; data[64 + 1] = 1;

    const filled = floodFill([0], (offset) => data[offset] === 1, false);
    expect(filled.sort()).toEqual([0, 1, 64, 65].sort());
  });

  it('maskFromOffsets builds a boolean mask', () => {
    const mask = maskFromOffsets([0, 5, 10]);
    expect(mask.length).toBe(PIXEL_COUNT);
    expect(mask[0]).toBe(true);
    expect(mask[5]).toBe(true);
    expect(mask[10]).toBe(true);
    expect(mask[1]).toBe(false);
  });
});
