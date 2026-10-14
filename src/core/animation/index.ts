/**
 * 动画生成引擎统一入口
 */

import { PortraitDocument } from '../document';
import { FacialAnchors, AnimationProject } from './types';
import { detectFacialAnchors } from './anchorDetector';
import { generateBlinkFrames } from './blinkGenerator';
import { generateMouthFrames } from './mouthGenerator';
import { composeMatrix } from './matrixComposer';

export * from './types';
export * from './anchorDetector';
export * from './blinkGenerator';
export * from './mouthGenerator';
export * from './matrixComposer';

/**
 * 依据当前头像文档一键生成完整的动画工程
 */
export function createAnimationProject(
  doc: PortraitDocument,
  overrideAnchors?: FacialAnchors
): AnimationProject {
  const anchors = overrideAnchors ? { ...overrideAnchors } : detectFacialAnchors(doc);
  const eyeFrames = generateBlinkFrames(doc.pixelIndices, doc.semanticMask, anchors);
  const mouthFrames = generateMouthFrames(doc.pixelIndices, anchors);
  const matrix = composeMatrix(doc.pixelIndices, eyeFrames, mouthFrames, anchors);

  return {
    anchors,
    eyeFrames,
    mouthFrames,
    matrix,
  };
}
