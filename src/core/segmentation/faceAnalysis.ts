import { Rgb } from '../colorUtils';
import { connectedComponents, maskFromOffsets } from '../pixelGrid';
import { Bbox, Point, FaceAnalysis } from './types';
import {
  xOf,
  yOf,
  percentileInt,
  median,
  clamp,
  isFaceSkin,
  exteriorWhiteMask,
} from './stats';
import {
  EYE_DETECTION_MODEL,
  detectEyeHighlightPair,
  estimateEyeLine,
  centeredBbox,
  geometryFallbackEye,
  detectEyeRegion,
  anchorEyeToHighlight,
} from './eyeDetector';
import { fitFaceEgg } from './faceModel';
import { analyzeHairMask } from './hairDetector';

const FACE_OUTLINE_MODEL = {
  medianRowWidthScale: 1.15,
  minimumWidth: 26,
  maximumWidth: 28,
  heightToWidth: 1.5,
  eyeLineFromFaceTop: 0.3,
  eyeCenterSeparationScale: 0.34,
  eyeWidthScale: 0.38,
  minimumEyeWidth: 9,
  maximumEyeWidth: 10,
  eyeHeightScale: 0.38,
  minimumEyeHeight: 7,
  maximumEyeHeight: 9,
  leftEyePadding: 2,
  leftEyeMinimumMargin: 2,
  chinPadding: 2,
  linkedEyeHeightRatio: 0.62,
  linkedMaxHorizontalShift: 3,
  linkedMaxVerticalShift: 3,
  linkedMaxAnchorError: 6,
  linkedHorizontalDeadZone: 2.0,
  linkedVerticalDeadZone: 3.0,
};

function deadZoneShift(error: number, tolerance: number): number {
  if (Math.abs(error) <= tolerance) return 0;
  return Math.sign(error) * Math.max(1, Math.round(Math.abs(error) - tolerance));
}

export function analyzeFace(pixels: Rgb[], outlineColors: Rgb[]): FaceAnalysis | null {
  const exterior = exteriorWhiteMask(pixels);

  // 最大的、顶部不太靠下的肤色连通域即面部
  const component = connectedComponents(pixels.map(isFaceSkin), true)
    .filter((comp) => comp.length >= 60 && Math.min(...comp.map(yOf)) <= 54)
    .sort((a, b) => b.length - a.length)[0];
  if (!component) return null;

  // 按行统计肤色宽度 (3 行中值平滑)，取最宽的连续行段作为脸部核心，再向上下低阈值扩展
  const counts = Array.from({ length: 64 }, (_, y) => component.filter((o) => yOf(o) === y).length);
  const smoothed = counts.map((_, y) => median(counts.slice(Math.max(0, y - 1), Math.min(64, y + 2))));

  const peak = Math.max(...smoothed);
  const wideThreshold = Math.max(7.0, peak * 0.55);
  const segments: number[][] = [];
  smoothed.forEach((val, y) => {
    if (val < wideThreshold) return;
    const last = segments[segments.length - 1];
    if (last && y === last[last.length - 1] + 1) last.push(y);
    else segments.push([y]);
  });
  if (segments.length === 0) return null;

  const rowSum = (seg: number[]) => seg.reduce((acc, r) => acc + counts[r], 0);
  const core = segments.sort((a, b) => rowSum(b) - rowSum(a))[0];
  let faceTop = core[0];
  let faceBottom = core[core.length - 1];

  const lowThreshold = Math.max(3.0, peak * 0.28);
  while (faceTop > 0 && smoothed[faceTop - 1] >= lowThreshold) faceTop--;
  while (faceBottom < 63 && smoothed[faceBottom + 1] >= lowThreshold) faceBottom++;

  const faceOffsets = component.filter((o) => yOf(o) >= faceTop && yOf(o) <= faceBottom);
  if (faceOffsets.length < 80 || faceBottom - faceTop + 1 < 8) return null;

  const faceXs = faceOffsets.map(xOf);
  const faceHeight = faceBottom - faceTop + 1;
  const visibleSkinBbox: Bbox = [percentileInt(faceXs, 0.05), faceTop, percentileInt(faceXs, 0.95), faceBottom];

  const faceRowWidths: number[] = [];
  for (let y = faceTop; y <= faceBottom; y++) {
    const rowXs = faceOffsets.filter((o) => yOf(o) === y).map(xOf);
    if (rowXs.length > 0) faceRowWidths.push(Math.max(...rowXs) - Math.min(...rowXs) + 1);
  }

  // 由肤色核心推算脸框与双眼的几何预测位置
  const M = FACE_OUTLINE_MODEL;
  const outlineAnchorWidth = median(faceRowWidths);
  const outlineCenterX = median(faceXs);
  const baseOutlineWidth = clamp(Math.round(outlineAnchorWidth * M.medianRowWidthScale), M.minimumWidth, M.maximumWidth);
  const geometryEyeLineY = faceTop + Math.round((faceHeight - 1) * M.eyeLineFromFaceTop);
  const outlineHeight = Math.round(baseOutlineWidth * M.heightToWidth);
  let outlineBottom = Math.min(63, faceBottom + M.chinPadding);
  let outlineTop = Math.max(0, outlineBottom - outlineHeight + 1);
  const outlineLeftUnpadded = Math.round(outlineCenterX - (baseOutlineWidth - 1) / 2);
  let outlineLeft = Math.max(0, outlineLeftUnpadded - M.leftEyePadding);
  let outlineRight = Math.min(63, outlineLeftUnpadded + baseOutlineWidth - 1);

  const eyeWidth = clamp(Math.round(outlineAnchorWidth * M.eyeWidthScale), M.minimumEyeWidth, M.maximumEyeWidth);
  const eyeSeparation = Math.max((eyeWidth + 1) / 2, outlineAnchorWidth * M.eyeCenterSeparationScale);
  const eyeHeight = clamp(Math.round(faceHeight * M.eyeHeightScale), M.minimumEyeHeight, M.maximumEyeHeight);

  const outlineCenter = (outlineLeft + outlineRight) / 2;
  const predLeftX = outlineCenter - eyeSeparation;
  const predRightX = outlineCenter + eyeSeparation;
  const outlineBbox: Bbox = [outlineLeft, outlineTop, outlineRight, outlineBottom];

  // 眼线高度：高光对 > 眼白对 > 几何预测
  let highlightPair = detectEyeHighlightPair(pixels, exterior, predLeftX, predRightX, outlineBbox);
  if (highlightPair) {
    const hlEyeLine = (highlightPair.leftCenter[1] + highlightPair.rightCenter[1]) / 2;
    if (Math.abs(hlEyeLine - geometryEyeLineY) > EYE_DETECTION_MODEL.highlightMaxGeometryYDelta) {
      highlightPair = null;
    }
  }

  const estimatedEyeLineY = highlightPair
    ? (highlightPair.leftCenter[1] + highlightPair.rightCenter[1]) / 2
    : estimateEyeLine(pixels, exterior, predLeftX, predRightX, geometryEyeLineY, outlineBbox);

  const eyeLineY = Math.round(
    estimatedEyeLineY !== null &&
      Math.abs(estimatedEyeLineY - geometryEyeLineY) <= EYE_DETECTION_MODEL.highlightMaxGeometryYDelta
      ? estimatedEyeLineY
      : geometryEyeLineY
  );

  const predLeftEyeBbox = centeredBbox(predLeftX, eyeLineY, eyeWidth, eyeHeight);
  const predRightEyeBbox = centeredBbox(predRightX, eyeLineY, eyeWidth, eyeHeight);
  let leftEye = detectEyeRegion(pixels, exterior, predLeftEyeBbox, eyeLineY);
  let rightEye = detectEyeRegion(pixels, exterior, predRightEyeBbox, eyeLineY);

  if (highlightPair) {
    leftEye = anchorEyeToHighlight(leftEye, highlightPair.leftCenter);
    rightEye = anchorEyeToHighlight(rightEye, highlightPair.rightCenter);
  }

  // 两眼间距小于一只眼宽 → 检测不可信，整体退回几何预测
  if (rightEye.centerX - leftEye.centerX < eyeWidth) {
    leftEye = geometryFallbackEye(predLeftEyeBbox, predLeftX, eyeLineY);
    rightEye = geometryFallbackEye(predRightEyeBbox, predRightX, eyeLineY);
    highlightPair = null;
  }

  const bothDetected = leftEye.detected && rightEye.detected;
  const pairAlignment = Math.max(0.0, 1 - Math.abs(leftEye.centerY - rightEye.centerY) / EYE_DETECTION_MODEL.maximumPairYDelta);
  let eyePairConfidence = Math.min(leftEye.confidence, rightEye.confidence) * (0.75 + pairAlignment * 0.25);
  if (highlightPair && bothDetected) {
    eyePairConfidence = Math.min(1.0, eyePairConfidence + 0.08);
  }

  // 双眼都检测到时，按左眼位置决定脸框左侧是否需要额外留白
  if (bothDetected) {
    const available = leftEye.bbox[0] - (outlineLeft + M.leftEyePadding);
    const appliedLeftEyePadding = available < M.leftEyeMinimumMargin ? M.leftEyePadding : 0;
    outlineLeft += M.leftEyePadding - appliedLeftEyePadding;
  }

  // 双眼可信时，把脸框微调到与眼睛中点对齐 (带死区与最大位移限制)
  if (bothDetected && eyePairConfidence >= EYE_DETECTION_MODEL.pairConfidenceThreshold) {
    const eyeMidpointX = (leftEye.centerX + rightEye.centerX) / 2;
    const eyeMidpointY = (leftEye.centerY + rightEye.centerY) / 2;
    const reqErrX = eyeMidpointX - (outlineLeft + outlineRight) / 2;
    const reqErrY = eyeMidpointY - (outlineTop + (outlineHeight - 1) * M.linkedEyeHeightRatio);

    if (Math.abs(reqErrX) <= M.linkedMaxAnchorError && Math.abs(reqErrY) <= M.linkedMaxAnchorError) {
      let shiftX = clamp(deadZoneShift(reqErrX, M.linkedHorizontalDeadZone), -M.linkedMaxHorizontalShift, M.linkedMaxHorizontalShift);
      let shiftY = clamp(
        deadZoneShift(reqErrY, M.linkedVerticalDeadZone),
        -Math.min(M.linkedMaxVerticalShift, outlineBottom - faceBottom),
        M.linkedMaxVerticalShift
      );
      shiftX = clamp(shiftX, -outlineLeft, 63 - outlineRight);
      shiftY = clamp(shiftY, -outlineTop, 63 - outlineBottom);

      outlineLeft += shiftX;
      outlineRight += shiftX;
      outlineTop += shiftY;
      outlineBottom += shiftY;
    }
  }

  const eyeOffsets = new Set<number>([
    ...leftEye.scleraOffsets,
    ...rightEye.scleraOffsets,
    ...leftEye.inkOffsets,
    ...rightEye.inkOffsets,
    ...(highlightPair ? highlightPair.offsets : []),
  ]);

  const hairMask = analyzeHairMask(
    pixels,
    exterior,
    outlineColors,
    [outlineLeft, outlineTop, outlineRight, outlineBottom],
    eyeLineY,
    eyeOffsets
  );

  const leftEyeCenter: Point = [leftEye.centerX, leftEye.centerY];
  const rightEyeCenter: Point = [rightEye.centerX, rightEye.centerY];
  const faceEgg = fitFaceEgg(faceOffsets, leftEyeCenter, rightEyeCenter, faceBottom, exterior);

  return {
    faceMask: maskFromOffsets(faceOffsets),
    faceModelMask: faceEgg.mask,
    hairMask,
    faceBbox: faceEgg.bbox,
    visibleSkinBbox,
    eyeLineY,
    chinY: faceEgg.bbox[3],
    leftEyeCenter,
    rightEyeCenter,
    eyeOffsets: Array.from(eyeOffsets),
  };
}
