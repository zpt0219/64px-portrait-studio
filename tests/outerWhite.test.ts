import { describe, it, expect } from 'vitest';
import { findOuterWhiteOffsets } from '../src/core/outerWhite';
import { createEmptyDocument } from '../src/core/document';
import { SemanticZone } from '../src/core/types';
import { TRANSPARENT_INDEX } from '../src/core/constants';

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
});
