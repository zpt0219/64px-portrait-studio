import { describe, it, expect } from 'vitest';
import {
  extractPatch,
  stampPatch,
  clearRect,
  flipRect,
  rotateRectCW,
  replaceColor,
  floodFillPixels,
  assignColorToMask,
  zoneRgbTable,
  FULL_CANVAS,
  Layers,
} from '../src/core/editOps';
import { SemanticZone } from '../src/core/types';
import { TRANSPARENT_INDEX } from '../src/core/constants';
import { PIXEL_COUNT, IMAGE_WIDTH as W } from '../src/core/pixelGrid';

function createTestLayers(): Layers {
  const pixels = new Uint8Array(PIXEL_COUNT).fill(TRANSPARENT_INDEX);
  const mask = new Uint8Array(PIXEL_COUNT).fill(SemanticZone.Background);
  const lockedZones = new Set<SemanticZone>();
  return { pixels, mask, lockedZones };
}

describe('editOps', () => {
  it('extractPatch and stampPatch roundtrip', () => {
    const layers = createTestLayers();
    // Set a 2x2 area at (5, 5)
    layers.pixels[5 * W + 5] = 1;
    layers.pixels[5 * W + 6] = 2;
    layers.pixels[6 * W + 5] = 3;
    layers.pixels[6 * W + 6] = 4;
    layers.mask[5 * W + 5] = SemanticZone.Hair;
    layers.mask[5 * W + 6] = SemanticZone.Skin;
    layers.mask[6 * W + 5] = SemanticZone.Eyes;
    layers.mask[6 * W + 6] = SemanticZone.Clothes;

    const patch = extractPatch(layers, { x: 5, y: 5, w: 2, h: 2 });
    expect(patch.w).toBe(2);
    expect(patch.h).toBe(2);
    expect(Array.from(patch.pixels)).toEqual([1, 2, 3, 4]);
    expect(Array.from(patch.mask)).toEqual([
      SemanticZone.Hair,
      SemanticZone.Skin,
      SemanticZone.Eyes,
      SemanticZone.Clothes,
    ]);

    // Stamp it to (10, 10)
    stampPatch(layers, patch, 10, 10);
    expect(layers.pixels[10 * W + 10]).toBe(1);
    expect(layers.pixels[10 * W + 11]).toBe(2);
    expect(layers.pixels[11 * W + 10]).toBe(3);
    expect(layers.pixels[11 * W + 11]).toBe(4);
    expect(layers.mask[10 * W + 10]).toBe(SemanticZone.Hair);
    expect(layers.mask[10 * W + 11]).toBe(SemanticZone.Skin);
    expect(layers.mask[11 * W + 10]).toBe(SemanticZone.Eyes);
    expect(layers.mask[11 * W + 11]).toBe(SemanticZone.Clothes);
  });

  it('clearRect clears pixels and resets mask to background even if zone is locked', () => {
    const layers = createTestLayers();
    layers.pixels[2 * W + 2] = 5;
    layers.mask[2 * W + 2] = SemanticZone.Hair;

    layers.pixels[2 * W + 3] = 6;
    layers.mask[2 * W + 3] = SemanticZone.Skin;
    layers.lockedZones.add(SemanticZone.Skin); // Lock skin

    const changed = clearRect(layers, { x: 2, y: 2, w: 2, h: 1 });
    expect(changed).toBe(true);

    // Pixel at (2,2) should be transparent, mask should be Background
    expect(layers.pixels[2 * W + 2]).toBe(TRANSPARENT_INDEX);
    expect(layers.mask[2 * W + 2]).toBe(SemanticZone.Background);

    // Pixel at (3,2) should be transparent, and mask must be Background (T02 invariant overrides zone lock)
    expect(layers.pixels[2 * W + 3]).toBe(TRANSPARENT_INDEX);
    expect(layers.mask[2 * W + 3]).toBe(SemanticZone.Background);
  });

  it('flipRect flips horizontal and vertical', () => {
    const layers = createTestLayers();
    // 2x2 square at (0, 0)
    layers.pixels[0] = 1; layers.pixels[1] = 2;
    layers.pixels[W] = 3; layers.pixels[W + 1] = 4;

    flipRect(layers, { x: 0, y: 0, w: 2, h: 2 }, 'horizontal');
    expect(layers.pixels[0]).toBe(2);
    expect(layers.pixels[1]).toBe(1);
    expect(layers.pixels[W]).toBe(4);
    expect(layers.pixels[W + 1]).toBe(3);

    flipRect(layers, { x: 0, y: 0, w: 2, h: 2 }, 'vertical');
    expect(layers.pixels[0]).toBe(4);
    expect(layers.pixels[1]).toBe(3);
    expect(layers.pixels[W]).toBe(2);
    expect(layers.pixels[W + 1]).toBe(1);
  });

  it('rotateRectCW rotates 90 degrees clockwise', () => {
    const layers = createTestLayers();
    // 2x2 square at (0,0):
    // 1 2
    // 3 4
    layers.pixels[0] = 1; layers.pixels[1] = 2;
    layers.pixels[W] = 3; layers.pixels[W + 1] = 4;

    rotateRectCW(layers, { x: 0, y: 0, w: 2, h: 2 });
    // After 90 deg CW:
    // 3 1
    // 4 2
    expect(layers.pixels[0]).toBe(3);
    expect(layers.pixels[1]).toBe(1);
    expect(layers.pixels[W]).toBe(4);
    expect(layers.pixels[W + 1]).toBe(2);
  });

  it('replaceColor replaces colors in selection or full canvas', () => {
    const layers = createTestLayers();
    layers.pixels[0] = 5;
    layers.pixels[1] = 5;
    layers.pixels[2] = 5;

    // Replace within { x: 0, y: 0, w: 2, h: 1 }
    const changed = replaceColor(layers, 5, 10, { x: 0, y: 0, w: 2, h: 1 });
    expect(changed).toBe(2);
    expect(layers.pixels[0]).toBe(10);
    expect(layers.pixels[1]).toBe(10);
    expect(layers.pixels[2]).toBe(5); // Outside selection untouched
  });

  it('floodFillPixels performs 4-way and 8-way connectivity correctly', () => {
    const layers = createTestLayers();
    // Diagonal points
    layers.pixels[0] = 1;
    layers.pixels[W + 1] = 1;

    // 4-way connectivity from (0, 0) should NOT reach (1, 1)
    floodFillPixels(layers, 0, 0, 9, false, FULL_CANVAS);
    expect(layers.pixels[0]).toBe(9);
    expect(layers.pixels[W + 1]).toBe(1);

    // 8-way connectivity from (1, 1) to (2, 2)
    layers.pixels[2 * W + 2] = 1;
    floodFillPixels(layers, 1, 1, 9, true, FULL_CANVAS);
    expect(layers.pixels[W + 1]).toBe(9);
    expect(layers.pixels[2 * W + 2]).toBe(9);
  });

  it('assignColorToMask assigns pixels of target color to semantic zone', () => {
    const layers = createTestLayers();
    layers.pixels[10] = 7;
    layers.pixels[20] = 7;
    layers.pixels[30] = 8;

    const count = assignColorToMask(layers, 7, SemanticZone.Clothes, FULL_CANVAS);
    expect(count).toBe(2);
    expect(layers.mask[10]).toBe(SemanticZone.Clothes);
    expect(layers.mask[20]).toBe(SemanticZone.Clothes);
    expect(layers.mask[30]).toBe(SemanticZone.Background);
  });

  it('zoneRgbTable produces table for all semantic zones with specified background', () => {
    const table = zoneRgbTable([10, 20, 30]);
    expect(table[SemanticZone.Background]).toEqual([10, 20, 30]);
    expect(table[SemanticZone.Hair]).toBeDefined();
    expect(table[SemanticZone.Skin]).toBeDefined();
    expect(table[SemanticZone.Eyes]).toBeDefined();
    expect(table[SemanticZone.Clothes]).toBeDefined();
  });
});

