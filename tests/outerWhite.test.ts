import { describe, it, expect } from 'vitest';
import { findOuterWhiteOffsets, isWhiteRgb } from '../src/core/editOps';
import { createEmptyDocument } from '../src/core/document';
import { SemanticZone } from '../src/core/types';

describe('findOuterWhiteOffsets', () => {
  it('identifies outer border white pixels but stops at non-white boundaries', () => {
    const doc = createEmptyDocument();
    // Fill palette[1] as near-white #ffffff
    doc.palette[1] = '#ffffff';
    // Fill palette[2] as black #000000
    doc.palette[2] = '#000000';

    // Put white on the top border (0, 0)
    doc.pixelIndices[0] = 1;

    // Put black at (1, 0) to block horizontal flood
    doc.pixelIndices[1] = 2;

    const offsets = findOuterWhiteOffsets(doc, []);
    expect(offsets).toContain(0);
    expect(offsets).not.toContain(1);
  });

  it('protects Eyes semantic zone from being cleared as outer white', () => {
    const doc = createEmptyDocument();
    doc.palette[1] = '#ffffff';

    // Border pixel at (0, 0)
    doc.pixelIndices[0] = 1;
    doc.semanticMask[0] = SemanticZone.Eyes;

    const offsets = findOuterWhiteOffsets(doc, []);
    expect(offsets).not.toContain(0);
  });

  it('protects locked zones from being cleared', () => {
    const doc = createEmptyDocument();
    doc.palette[1] = '#ffffff';

    doc.pixelIndices[0] = 1;
    doc.semanticMask[0] = SemanticZone.Hair;

    const offsets = findOuterWhiteOffsets(doc, [SemanticZone.Hair]);
    expect(offsets).not.toContain(0);
  });

  it('supports custom whiteThreshold', () => {
    const doc = createEmptyDocument();
    // Palette 1 is #e0e0e0 (rgb 224, 224, 224) - below default 250
    doc.palette[1] = '#e0e0e0';
    doc.pixelIndices[0] = 1;

    // Default threshold should not treat #e0e0e0 as white
    expect(findOuterWhiteOffsets(doc, [])).toEqual([]);

    // Custom threshold of 220 should treat #e0e0e0 as white
    expect(findOuterWhiteOffsets(doc, [], 220)).toContain(0);
  });
});

describe('isWhiteRgb', () => {
  it('identifies white with default and custom thresholds', () => {
    expect(isWhiteRgb([255, 255, 255])).toBe(true);
    expect(isWhiteRgb([250, 250, 250])).toBe(true);
    expect(isWhiteRgb([249, 250, 250])).toBe(false);

    // Custom threshold
    expect(isWhiteRgb([240, 240, 240], 240)).toBe(true);
    expect(isWhiteRgb([239, 240, 240], 240)).toBe(false);
  });
});
