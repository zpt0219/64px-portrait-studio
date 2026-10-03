import { Rgb } from '../colorUtils';
import { IMAGE_WIDTH as W, connectedComponents } from '../pixelGrid';
import { Bbox, Point, HighlightPair, EyeRegion } from './types';
import { xOf, yOf, mean, clamp, isFaceSkin, maskInRect } from './stats';

export const EYE_DETECTION_MODEL = {
  scleraMinChannel: 190,
  scleraMaxChroma: 55,
  inkMaxChannel: 175,
  inkMinChroma: 55,
  blushRedOverGreen: 35,
  blushRedOverBlue: 25,
  horizontalDistancePenalty: 1.5,
  searchPadding: 2,
  minimumComponentScore: -5,
  maximumPairYDelta: 5,
  pairConfidenceThreshold: 0.6,
  eyeLineSearchTopRatio: 0.2,
  eyeLineSearchBottomRatio: 0.82,
  eyeLineComponentMaxArea: 16,
  eyeLineComponentMaxSpan: 6,
  highlightMinChannel: 225,
  highlightMaxChroma: 35,
  highlightMaxArea: 5,
  highlightMinNearbyInk: 8,
  highlightMaxPairYDelta: 3,
  highlightMaxGeometryYDelta: 8,
};

export function chroma(rgb: Rgb): { min: number; max: number } {
  return { min: Math.min(rgb[0], rgb[1], rgb[2]), max: Math.max(rgb[0], rgb[1], rgb[2]) };
}

export function isSclera(rgb: Rgb): boolean {
  const { min, max } = chroma(rgb);
  return min >= EYE_DETECTION_MODEL.scleraMinChannel && max - min <= EYE_DETECTION_MODEL.scleraMaxChroma && !isFaceSkin(rgb);
}

export function isEyeInk(rgb: Rgb): boolean {
  const [red, green, blue] = rgb;
  const { min, max } = chroma(rgb);
  const dark = max < EYE_DETECTION_MODEL.inkMaxChannel;
  const colourful = max - min >= EYE_DETECTION_MODEL.inkMinChroma;
  const blush = red > green + EYE_DETECTION_MODEL.blushRedOverGreen && red > blue + EYE_DETECTION_MODEL.blushRedOverBlue;
  return (dark || colourful) && !blush;
}

export function isEyeHighlight(rgb: Rgb): boolean {
  const { min, max } = chroma(rgb);
  return min >= EYE_DETECTION_MODEL.highlightMinChannel && max - min <= EYE_DETECTION_MODEL.highlightMaxChroma && !isFaceSkin(rgb);
}

/** 组件周围 radius 范围内 (限定在 rect 内) 的瞳色像素 */
export function nearbyInk(pixels: Rgb[], comp: number[], radius: number, rect: Bbox): Set<number> {
  const [left, top, right, bottom] = rect;
  const ink = new Set<number>();
  for (const off of comp) {
    const ox = xOf(off);
    const oy = yOf(off);
    for (let ny = Math.max(top, oy - radius); ny <= Math.min(bottom, oy + radius); ny++) {
      for (let nx = Math.max(left, ox - radius); nx <= Math.min(right, ox + radius); nx++) {
        const noff = ny * W + nx;
        if (isEyeInk(pixels[noff])) ink.add(noff);
      }
    }
  }
  return ink;
}

/** 左右各找一个小高光点 (周围有足够瞳色)，配对后作为最强的眼位证据 */
export function detectEyeHighlightPair(
  pixels: Rgb[],
  exteriorWhite: boolean[],
  predLeftX: number,
  predRightX: number,
  outlineBbox: Bbox
): HighlightPair | null {
  const [outlineLeft, outlineTop, outlineRight, outlineBottom] = outlineBbox;
  const outlineHeight = outlineBottom - outlineTop + 1;
  const searchTop = Math.round(outlineTop + (outlineHeight - 1) * 0.2);
  const searchBottom = Math.round(outlineTop + (outlineHeight - 1) * 0.86);
  const midpoint = (predLeftX + predRightX) / 2;

  const getCandidates = (left: number, right: number, predX: number) => {
    const rect: Bbox = [left, searchTop, right, searchBottom];
    const mask = maskInRect(rect, (o) => !exteriorWhite[o] && isEyeHighlight(pixels[o]));
    const output: { centerX: number; centerY: number; offsets: number[]; score: number }[] = [];

    for (const comp of connectedComponents(mask, true)) {
      if (comp.length > EYE_DETECTION_MODEL.highlightMaxArea) continue;
      const inkCount = nearbyInk(pixels, comp, 2, rect).size;
      if (inkCount < EYE_DETECTION_MODEL.highlightMinNearbyInk) continue;

      const cx = mean(comp.map(xOf));
      output.push({
        centerX: cx,
        centerY: mean(comp.map(yOf)),
        offsets: comp,
        score: Math.min(inkCount, 24) * 0.5 - Math.abs(cx - predX) * 0.5,
      });
    }
    return output;
  };

  const leftCands = getCandidates(outlineLeft, Math.floor(midpoint) - 1, predLeftX);
  const rightCands = getCandidates(Math.floor(midpoint) + 2, outlineRight, predRightX);
  const expectedSep = predRightX - predLeftX;

  let bestScore = -Infinity;
  let bestPair: [typeof leftCands[number], typeof rightCands[number]] | null = null;

  for (const left of leftCands) {
    for (const right of rightCands) {
      const yDelta = Math.abs(left.centerY - right.centerY);
      const sep = right.centerX - left.centerX;
      if (yDelta > EYE_DETECTION_MODEL.highlightMaxPairYDelta || sep < expectedSep * 0.65 || sep > expectedSep * 1.6) {
        continue;
      }
      const score = left.score + right.score - yDelta * 2 - Math.abs(sep - expectedSep);
      if (score > bestScore) {
        bestScore = score;
        bestPair = [left, right];
      }
    }
  }

  if (!bestPair) return null;
  const [left, right] = bestPair;
  return {
    leftCenter: [left.centerX, left.centerY],
    rightCenter: [right.centerX, right.centerY],
    offsets: Array.from(new Set([...left.offsets, ...right.offsets])).sort((a, b) => a - b),
  };
}

/** 没有高光时，用左右成对的小块眼白估计眼线高度 */
export function estimateEyeLine(
  pixels: Rgb[],
  exteriorWhite: boolean[],
  predLeftX: number,
  predRightX: number,
  geometryEyeLineY: number,
  outlineBbox: Bbox
): number | null {
  const [outlineLeft, outlineTop, outlineRight, outlineBottom] = outlineBbox;
  const outlineHeight = outlineBottom - outlineTop + 1;
  const searchTop = Math.round(outlineTop + (outlineHeight - 1) * EYE_DETECTION_MODEL.eyeLineSearchTopRatio);
  const searchBottom = Math.round(outlineTop + (outlineHeight - 1) * EYE_DETECTION_MODEL.eyeLineSearchBottomRatio);
  const midpoint = (predLeftX + predRightX) / 2;

  const getCandidates = (left: number, right: number, predX: number) => {
    const rect: Bbox = [left, searchTop, right, searchBottom];
    const mask = maskInRect(rect, (o) => !exteriorWhite[o] && isSclera(pixels[o]));
    const output: { centerX: number; centerY: number; score: number }[] = [];

    for (const comp of connectedComponents(mask, true)) {
      const xs = comp.map(xOf);
      const ys = comp.map(yOf);
      const spanX = Math.max(...xs) - Math.min(...xs) + 1;
      const spanY = Math.max(...ys) - Math.min(...ys) + 1;
      if (
        comp.length > EYE_DETECTION_MODEL.eyeLineComponentMaxArea ||
        spanX > EYE_DETECTION_MODEL.eyeLineComponentMaxSpan ||
        spanY > EYE_DETECTION_MODEL.eyeLineComponentMaxSpan
      ) {
        continue;
      }

      const inkCount = nearbyInk(pixels, comp, 1, rect).size;
      if (inkCount < 2) continue;

      const cx = mean(xs);
      output.push({
        centerX: cx,
        centerY: mean(ys),
        score: Math.min(comp.length, 8) + Math.min(inkCount, 10) * 0.5 - Math.abs(cx - predX),
      });
    }
    return output;
  };

  const leftCands = getCandidates(outlineLeft, Math.floor(midpoint) - 1, predLeftX);
  const rightCands = getCandidates(Math.floor(midpoint) + 2, outlineRight, predRightX);
  const expectedSep = predRightX - predLeftX;

  let bestVal = -Infinity;
  let bestY: number | null = null;

  for (const left of leftCands) {
    for (const right of rightCands) {
      const yDelta = Math.abs(left.centerY - right.centerY);
      if (yDelta > 3) continue;
      const sep = right.centerX - left.centerX;
      const pairY = (left.centerY + right.centerY) / 2;
      const upperFacePref = Math.min(4.0, Math.max(0.0, geometryEyeLineY - pairY) * 0.8);
      const score = left.score + right.score - yDelta * 3 - Math.abs(sep - expectedSep) + upperFacePref;
      if (score > bestVal) {
        bestVal = score;
        bestY = pairY;
      }
    }
  }
  return bestY;
}

export function centeredBbox(centerX: number, centerY: number, width: number, height: number): Bbox {
  let left = Math.max(0, Math.round(centerX - (width - 1) / 2));
  const right = Math.min(63, left + width - 1);
  if (right === 63) left = right - width + 1;

  let top = Math.max(0, Math.round(centerY - (height - 1) / 2));
  const bottom = Math.min(63, top + height - 1);
  if (bottom === 63) top = bottom - height + 1;

  return [left, top, right, bottom];
}

export function geometryFallbackEye(predBbox: Bbox, centerX: number, centerY: number): EyeRegion {
  return {
    bbox: predBbox,
    detected: false,
    confidence: 0.15,
    scleraOffsets: [],
    inkOffsets: [],
    centerX,
    centerY,
  };
}

/** 在预测眼框附近找眼白块，并收集紧邻眼白的瞳色像素 */
export function detectEyeRegion(pixels: Rgb[], exteriorWhite: boolean[], predBbox: Bbox, eyeLineY: number): EyeRegion {
  const pad = EYE_DETECTION_MODEL.searchPadding;
  const search: Bbox = [
    Math.max(0, predBbox[0] - pad),
    Math.max(0, predBbox[1] - pad),
    Math.min(63, predBbox[2] + pad),
    Math.min(63, predBbox[3] + pad),
  ];
  const [sLeft, sTop, sRight, sBottom] = search;
  const predCenterX = (predBbox[0] + predBbox[2]) / 2;

  const scleraMask = maskInRect(search, (o) => !exteriorWhite[o] && isSclera(pixels[o]));
  const candidates: { offsets: number[]; bbox: Bbox; centerY: number; score: number }[] = [];

  for (const comp of connectedComponents(scleraMask, true)) {
    const inkCount = nearbyInk(pixels, comp, 1, search).size;
    if (inkCount < 2) continue;

    const xs = comp.map(xOf);
    const ys = comp.map(yOf);
    const cx = mean(xs);
    const cy = mean(ys);
    candidates.push({
      offsets: comp,
      bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      centerY: cy,
      score:
        comp.length * 2 +
        Math.min(inkCount, 15) -
        Math.abs(cy - eyeLineY) * 4 -
        Math.abs(cx - predCenterX) * EYE_DETECTION_MODEL.horizontalDistancePenalty,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0 || candidates[0].score < EYE_DETECTION_MODEL.minimumComponentScore) {
    return geometryFallbackEye(predBbox, predCenterX, eyeLineY);
  }

  // 主眼白块 + 同一水平线上紧邻的其它眼白块
  const primary = candidates[0];
  const selected = candidates.filter((c) => {
    if (c === primary) return true;
    const hGap = Math.max(0, c.bbox[0] - primary.bbox[2] - 1, primary.bbox[0] - c.bbox[2] - 1);
    return Math.abs(c.centerY - primary.centerY) <= 2.5 && hGap <= 5;
  });

  const scleraOffsets = Array.from(new Set(selected.flatMap((c) => c.offsets))).sort((a, b) => a - b);
  const whiteXs = scleraOffsets.map(xOf);
  const whiteYs = scleraOffsets.map(yOf);

  const inkOffsets: number[] = [];
  for (let y = Math.max(sTop, Math.min(...whiteYs) - 2); y <= Math.min(sBottom, Math.max(...whiteYs) + 2); y++) {
    for (let x = Math.max(sLeft, Math.min(...whiteXs) - 3); x <= Math.min(sRight, Math.max(...whiteXs) + 3); x++) {
      const offset = y * W + x;
      if (isFaceSkin(pixels[offset]) || !isEyeInk(pixels[offset])) continue;
      const minChebyshev = Math.min(
        ...scleraOffsets.map((wo) => Math.max(Math.abs(x - xOf(wo)), Math.abs(y - yOf(wo))))
      );
      if (minChebyshev <= 3) inkOffsets.push(offset);
    }
  }

  const combined = Array.from(new Set([...scleraOffsets, ...inkOffsets]));
  const combXs = combined.map(xOf);
  const combYs = combined.map(yOf);
  const centerX = (Math.min(...combXs) + Math.max(...combXs)) / 2;
  const centerY = (Math.min(...combYs) + Math.max(...combYs)) / 2;

  const predW = predBbox[2] - predBbox[0] + 1;
  const predH = predBbox[3] - predBbox[1] + 1;
  const confidence =
    0.2 +
    Math.min(1.0, scleraOffsets.length / 8) * 0.3 +
    Math.min(1.0, inkOffsets.length / 16) * 0.25 +
    Math.max(0.0, 1 - Math.abs(mean(whiteYs) - eyeLineY) / 5) * 0.25;

  return {
    bbox: centeredBbox(centerX, centerY, predW, predH),
    detected: true,
    confidence,
    scleraOffsets,
    inkOffsets,
    centerX,
    centerY,
  };
}

/** 把眼睛中心拉到高光 ±1 像素范围内 */
export function anchorEyeToHighlight(eye: EyeRegion, hlCenter: Point): EyeRegion {
  const cx = clamp(eye.centerX, hlCenter[0] - 1, hlCenter[0] + 1);
  const cy = clamp(eye.centerY, hlCenter[1] - 1, hlCenter[1] + 1);
  const width = eye.bbox[2] - eye.bbox[0] + 1;
  const height = eye.bbox[3] - eye.bbox[1] + 1;
  return { ...eye, bbox: centeredBbox(cx, cy, width, height), centerX: cx, centerY: cy };
}
