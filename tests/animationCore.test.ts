import { describe, it, expect } from 'vitest';
import {
  detectFacialAnchors,
  generateBlinkFrames,
  generateMouthFrames,
  composeMatrix,
  createAnimationProject,
  FacialAnchors,
} from '../src/core/animation';
import { projectDataToDocument } from '../src/core/projectData';
import { PRESET_PORTRAIT_PROJECT } from '../src/core/presetAvatar';
import { PIXEL_COUNT, IMAGE_WIDTH as W } from '../src/core/pixelGrid';
import { SemanticZone } from '../src/core/types';

describe('Animation Core Algorithms', () => {
  const { document: doc } = projectDataToDocument(PRESET_PORTRAIT_PROJECT);

  it('detects valid facial anchors for preset blonde knight portrait', () => {
    const anchors = detectFacialAnchors(doc);

    // Left and right eye bounding boxes
    expect(anchors.leftEyeBbox[0]).toBeLessThan(anchors.leftEyeBbox[2]);
    expect(anchors.leftEyeBbox[1]).toBeLessThan(anchors.leftEyeBbox[3]);

    expect(anchors.rightEyeBbox[0]).toBeLessThan(anchors.rightEyeBbox[2]);
    expect(anchors.rightEyeBbox[1]).toBeLessThan(anchors.rightEyeBbox[3]);

    // Left eye is horizontally to the left of right eye
    expect(anchors.leftEyeBbox[0]).toBeLessThan(anchors.rightEyeBbox[0]);

    // Mouth is below eyes
    expect(anchors.mouthBbox[1]).toBeGreaterThanOrEqual(anchors.leftEyeBbox[1]);

    // Color indices are in valid range 0..35
    expect(anchors.skinToneIndex).toBeGreaterThanOrEqual(0);
    expect(anchors.skinToneIndex).toBeLessThan(36);

    expect(anchors.eyelashColorIndex).toBeGreaterThanOrEqual(0);
    expect(anchors.eyelashColorIndex).toBeLessThan(36);

    expect(anchors.mouthInteriorIndex).toBeGreaterThanOrEqual(0);
    expect(anchors.mouthInteriorIndex).toBeLessThan(36);
  });

  it('generates 3 blink frames with eyelid skin fill and curved eyelash line', () => {
    const anchors = detectFacialAnchors(doc);
    const { open, half, closed } = generateBlinkFrames(doc.pixelIndices, doc.semanticMask, anchors);

    expect(open).toHaveLength(PIXEL_COUNT);
    expect(half).toHaveLength(PIXEL_COUNT);
    expect(closed).toHaveLength(PIXEL_COUNT);

    // Frame 0 is identical to base
    expect(open).toEqual(doc.pixelIndices);

    // Half frame has differences in eye areas
    let diffHalf = 0;
    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (half[i] !== open[i]) diffHalf++;
    }
    expect(diffHalf).toBeGreaterThan(0);

    // Closed frame has more differences than half
    let diffClosed = 0;
    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (closed[i] !== open[i]) diffClosed++;
    }
    expect(diffClosed).toBeGreaterThan(diffHalf);

    // Hair pixels (mask === 1) and transparent (255) must never be overwritten
    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (doc.semanticMask[i] === SemanticZone.Hair) {
        expect(half[i]).toBe(doc.pixelIndices[i]);
        expect(closed[i]).toBe(doc.pixelIndices[i]);
      }
      if (doc.pixelIndices[i] === 255) {
        expect(half[i]).toBe(255);
        expect(closed[i]).toBe(255);
      }
    }
  });

  it('generates 3 mouth frames with progressive lip opening', () => {
    const anchors = detectFacialAnchors(doc);
    const { closed, half, open } = generateMouthFrames(doc.pixelIndices, anchors);

    expect(closed).toHaveLength(PIXEL_COUNT);
    expect(half).toHaveLength(PIXEL_COUNT);
    expect(open).toHaveLength(PIXEL_COUNT);

    // Frame 0 is identical to base
    expect(closed).toEqual(doc.pixelIndices);

    // Half has subtle change
    let diffHalf = 0;
    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (half[i] !== closed[i]) diffHalf++;
    }
    expect(diffHalf).toBeGreaterThan(0);

    // Open has larger change
    let diffOpen = 0;
    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (open[i] !== closed[i]) diffOpen++;
    }
    expect(diffOpen).toBeGreaterThan(diffHalf);
  });

  it('composes a 3x3 matrix representing 9 independent facial states', () => {
    const project = createAnimationProject(doc);
    const directMatrix = composeMatrix(doc.pixelIndices, project.eyeFrames, project.mouthFrames, project.anchors);
    expect(directMatrix).toEqual(project.matrix);

    expect(project.matrix).toHaveLength(3);
    for (let e = 0; e < 3; e++) {
      expect(project.matrix[e]).toHaveLength(3);
      for (let m = 0; m < 3; m++) {
        expect(project.matrix[e][m]).toHaveLength(PIXEL_COUNT);
      }
    }

    // matrix[0][0] is open eyes + closed mouth (base portrait)
    expect(project.matrix[0][0]).toEqual(doc.pixelIndices);

    // matrix[2][2] has both eye closed and mouth open modifications
    const closedOpen = project.matrix[2][2];
    expect(closedOpen).not.toEqual(doc.pixelIndices);

    // Verify eye region in matrix[2][2] matches eyeFrame closed
    const [lx, ly] = [project.anchors.rightEyeBbox[0] + 1, project.anchors.rightEyeBbox[1] + 1];
    const idx = ly * W + lx;
    if (doc.semanticMask[idx] !== SemanticZone.Hair) {
      expect(closedOpen[idx]).toBe(project.eyeFrames.closed[idx]);
    }
  });

  it('honors manual override anchors when provided', () => {
    const customAnchors: FacialAnchors = {
      leftEyeBbox: [10, 20, 20, 28],
      rightEyeBbox: [35, 20, 45, 28],
      mouthBbox: [25, 38, 35, 42],
      skinToneIndex: 7,
      eyelashColorIndex: 2,
      mouthInteriorIndex: 10,
      mouthLipIndex: 12,
    };

    const project = createAnimationProject(doc, customAnchors);
    expect(project.anchors).toEqual(customAnchors);
  });
});
