/**
 * 5 分区语义遮罩自动识别。
 *
 * 流程：
 * 1. 边框聚类估计背景 → 前景掩码
 * 2. 贴着背景的高频同色像素 → 外轮廓线
 * 3. 肤色连通域定位面部 → 双眼检测 → 发色种子区域 → 蛋形脸模型
 * 4. 眼睛下方 ROI 找嘴部
 * 5. 按 轮廓 → 眼睛 → 嘴/表情 → 脸部皮肤 → 身体皮肤 → 头发 的顺序依次认领像素，
 *    其余前景归入衣服，轮廓线按下巴高度分给头发或衣服。
 *
 * 所有阈值均为针对 64×64 二次元像素头像的经验值。
 */

import { SemanticZone } from '../types';
import { Rgb, Lab, rgbToOklab, oklabDistance } from './colorUtils';
import {
  IMAGE_WIDTH as W,
  PIXEL_COUNT,
  getNeighbours,
  borderOffsets,
  sideAndTopOffsets,
  connectedComponents,
  floodMask,
  maskFromOffsets,
} from './pixelGrid';

type Bbox = [number, number, number, number]; // [left, top, right, bottom]，闭区间
type Point = [number, number];

/* =========================================================================
 * 统计工具
 * ========================================================================= */

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const pos = fraction * (ordered.length - 1);
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return ordered[lower];
  const weight = pos - lower;
  return ordered[lower] * (1 - weight) + ordered[upper] * weight;
}

function percentileInt(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.round((ordered.length - 1) * fraction)];
}

function median(values: number[]): number {
  return percentile(values, 0.5);
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const xOf = (offset: number) => offset % W;
const yOf = (offset: number) => Math.floor(offset / W);
const sameRgb = (a: Rgb, b: Rgb) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const rgbKey = (c: Rgb) => `${c[0]},${c[1]},${c[2]}`;

/* =========================================================================
 * 颜色判定
 * ========================================================================= */

function isFaceSkin(rgb: Rgb): boolean {
  const [red, green, blue] = rgb;
  return (
    red >= 230 &&
    green >= 195 &&
    green <= 248 &&
    blue >= 175 &&
    blue <= 240 &&
    red - green >= 7 &&
    red - green <= 60 &&
    red - blue >= 8 &&
    Math.abs(green - blue) <= 48
  );
}

function isBackgroundWhite(rgb: Rgb): boolean {
  const minC = Math.min(rgb[0], rgb[1], rgb[2]);
  const maxC = Math.max(rgb[0], rgb[1], rgb[2]);
  return minC >= 239 && maxC - minC <= 20;
}

/** 从上、左、右三边连通进来的近白像素 */
function exteriorWhiteMask(pixels: Rgb[]): boolean[] {
  return floodMask(pixels.map(isBackgroundWhite), sideAndTopOffsets());
}

/* =========================================================================
 * 1. 背景估计
 * ========================================================================= */

/** 取边框像素中最大的 OKLab 颜色簇作为背景色，从四边泛洪得到背景掩码 */
function estimateForeground(pixels: Rgb[]): { backgroundMask: boolean[]; foregroundMask: boolean[] } {
  const labs = pixels.map(rgbToOklab);
  const offsets = borderOffsets();
  const borderLabs = offsets.map((idx) => labs[idx]);

  const clusterRadius = 0.08;
  let bestCount = -1;
  let bestL = -Infinity;
  let clusterSeed = borderLabs[0];

  for (const candidate of borderLabs) {
    let count = 0;
    for (const val of borderLabs) {
      if (oklabDistance(candidate, val) <= clusterRadius) count++;
    }
    if (count > bestCount || (count === bestCount && candidate[0] > bestL)) {
      bestCount = count;
      bestL = candidate[0];
      clusterSeed = candidate;
    }
  }

  const clusterLabs = borderLabs.filter((val) => oklabDistance(clusterSeed, val) <= clusterRadius);
  const center: Lab = [
    median(clusterLabs.map((l) => l[0])),
    median(clusterLabs.map((l) => l[1])),
    median(clusterLabs.map((l) => l[2])),
  ];

  const spread = percentile(clusterLabs.map((val) => oklabDistance(val, center)), 0.9);
  const threshold = Math.min(0.12, Math.max(0.045, spread + 0.025));

  const candidates = labs.map((val) => oklabDistance(val, center) <= threshold);
  const backgroundMask = floodMask(candidates, offsets);
  return { backgroundMask, foregroundMask: backgroundMask.map((bg) => !bg) };
}

/* =========================================================================
 * 2. 外轮廓线
 * ========================================================================= */

const OUTLINE_MIN_COMPONENT_PIXELS = 10;
const OUTLINE_MAX_OKLAB_DISTANCE = 0.035;

/**
 * 与背景相邻的前景像素中，能形成 ≥10 像素连通段的颜色视为轮廓色；
 * 再把与这些颜色相近、且与种子段相连的前景像素并入轮廓。
 */
function analyzePixelOutline(
  pixels: Rgb[],
  backgroundMask: boolean[],
  foregroundMask: boolean[]
): { outlineMask: boolean[]; outlineColors: Rgb[] } {
  const candidateMask = new Array<boolean>(PIXEL_COUNT).fill(false);
  for (let offset = 0; offset < PIXEL_COUNT; offset++) {
    if (!foregroundMask[offset]) continue;
    for (const nb of getNeighbours(offset, false)) {
      if (backgroundMask[nb]) {
        candidateMask[offset] = true;
        break;
      }
    }
  }

  const countsByColor = new Map<string, { count: number; rgb: Rgb }>();
  for (let offset = 0; offset < PIXEL_COUNT; offset++) {
    if (!candidateMask[offset]) continue;
    const p = pixels[offset];
    const entry = countsByColor.get(rgbKey(p)) || { count: 0, rgb: p };
    entry.count++;
    countsByColor.set(rgbKey(p), entry);
  }

  const sortedCandidates = Array.from(countsByColor.values()).sort((a, b) => b.count - a.count);
  const outlineColors: Rgb[] = [];
  const confirmedSeeds = new Set<number>();

  for (const { count, rgb } of sortedCandidates) {
    if (count < OUTLINE_MIN_COMPONENT_PIXELS) continue;
    const colorMask = candidateMask.map((c, i) => c && sameRgb(pixels[i], rgb));
    const qualifying = connectedComponents(colorMask, true).filter(
      (c) => c.length >= OUTLINE_MIN_COMPONENT_PIXELS
    );
    if (qualifying.length === 0) continue;

    outlineColors.push(rgb);
    for (const comp of qualifying) comp.forEach((offset) => confirmedSeeds.add(offset));
  }

  if (outlineColors.length === 0) {
    return { outlineMask: new Array<boolean>(PIXEL_COUNT).fill(false), outlineColors };
  }

  const colorLabs = outlineColors.map(rgbToOklab);
  const colorMatch = pixels.map((rgb, offset) => {
    if (!foregroundMask[offset]) return false;
    const lab = rgbToOklab(rgb);
    return colorLabs.some((clab) => oklabDistance(lab, clab) <= OUTLINE_MAX_OKLAB_DISTANCE);
  });

  const outlineOffsets: number[] = [];
  for (const comp of connectedComponents(colorMatch, true)) {
    if (comp.some((offset) => confirmedSeeds.has(offset))) outlineOffsets.push(...comp);
  }
  return { outlineMask: maskFromOffsets(outlineOffsets), outlineColors };
}

/* =========================================================================
 * 3a. 蛋形脸模型 (三次贝塞尔轮廓 + 扫描线填充)
 * ========================================================================= */

function cubicPoints(start: Point, control1: Point, control2: Point, end: Point, steps = 12): Point[] {
  const points: Point[] = [];
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const inv = 1 - t;
    const inv2 = inv * inv;
    const inv3 = inv2 * inv;
    const t2 = t * t;
    const t3 = t2 * t;
    points.push([
      inv3 * start[0] + 3 * inv2 * t * control1[0] + 3 * inv * t2 * control2[0] + t3 * end[0],
      inv3 * start[1] + 3 * inv2 * t * control1[1] + 3 * inv * t2 * control2[1] + t3 * end[1],
    ]);
  }
  return points;
}

/** bbox 内的对称蛋形脸轮廓点，asymmetry 控制左右宽度差，shearX 控制上下错切 */
function faceOutlinePoints(bbox: Bbox, asymmetry = 0.0, shearX = 0.0): Point[] {
  const [left, top, right, bottom] = bbox;
  const centerX = (left + right) / 2;
  const radiusX = (right - left) / 2;
  const height = bottom - top;

  const topLeft: Point = [centerX - radiusX * 0.38, top];
  const topRight: Point = [centerX + radiusX * 0.38, top];
  const rightMid: Point = [right, top + height * 0.38];
  const rightLower: Point = [centerX + radiusX * 0.65, top + height * 0.8];
  const chin: Point = [centerX, bottom];

  const rightCurve: Point[] = [
    topRight,
    ...cubicPoints(topRight, [centerX + radiusX * 0.78, top], [right, top + height * 0.16], rightMid),
    ...cubicPoints(rightMid, [right, top + height * 0.55], [centerX + radiusX * 0.86, top + height * 0.72], rightLower),
    ...cubicPoints(rightLower, [centerX + radiusX * 0.5, top + height * 0.9], [centerX + radiusX * 0.16, top + height * 0.99], chin),
  ];

  const leftCurve: Point[] = [...rightCurve].reverse().map(([x, y]) => [centerX - (x - centerX), y]);
  const points: Point[] = [topLeft, ...rightCurve, ...leftCurve.slice(1)];

  if (asymmetry === 0 && shearX === 0) return points;

  return points.map(([x, y]) => {
    const vertical = height === 0 ? 0.0 : (y - top) / height;
    const sideScale = x >= centerX ? 1 + asymmetry : 1 - asymmetry;
    const shiftedCenter = centerX + shearX * (0.5 - vertical);
    return [shiftedCenter + (x - centerX) * sideScale, y];
  });
}

/** 扫描线填充多边形 (像素中心采样) */
function rasterPolygon(points: Point[]): boolean[] {
  const mask = new Array<boolean>(PIXEL_COUNT).fill(false);
  const n = points.length;
  if (n < 3) return mask;

  const ys = points.map((p) => p[1]);
  const iMinY = Math.max(0, Math.floor(Math.min(63, ...ys)));
  const iMaxY = Math.min(63, Math.ceil(Math.max(0, ...ys)));

  for (let y = iMinY; y <= iMaxY; y++) {
    const scanY = y + 0.5;
    const nodeX: number[] = [];
    let j = n - 1;
    for (let i = 0; i < n; i++) {
      const yI = points[i][1];
      const yJ = points[j][1];
      if ((yI < scanY && yJ >= scanY) || (yJ < scanY && yI >= scanY)) {
        nodeX.push(points[i][0] + ((scanY - yI) / (yJ - yI)) * (points[j][0] - points[i][0]));
      }
      j = i;
    }
    nodeX.sort((a, b) => a - b);
    for (let k = 0; k + 1 < nodeX.length; k += 2) {
      const startX = Math.max(0, Math.ceil(nodeX[k] - 0.5));
      const endX = Math.min(63, Math.floor(nodeX[k + 1] - 0.5));
      for (let x = startX; x <= endX; x++) mask[y * W + x] = true;
    }
  }
  return mask;
}

const FACE_EGG_MODEL = {
  eyeLineRatio: 0.45,
  minimumWidth: 16,
  maximumWidth: 30,
  skinWidthScale: 1.0,
  eyeSeparationWidthScale: 1.2,
  maximumAsymmetry: 0.14,
  maximumShearPixels: 2.0,
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * 以双眼与下巴为锚点，在宽度 / 水平偏移 / 不对称 / 错切的小范围网格内搜索蛋形脸，
 * 目标：不覆盖外部白底、尽量覆盖可见皮肤、双眼必须在脸内。
 */
function fitFaceEgg(
  visibleSkinOffsets: number[],
  leftEyeCenter: Point,
  rightEyeCenter: Point,
  chinY: number,
  exteriorWhite: boolean[]
): { bbox: Bbox; mask: boolean[] } {
  const eyeMidX = (leftEyeCenter[0] + rightEyeCenter[0]) / 2;
  const eyeMidY = (leftEyeCenter[1] + rightEyeCenter[1]) / 2;
  const eyeToChin = Math.max(4.0, chinY - eyeMidY);
  const anchoredHeight = Math.max(10, Math.round(eyeToChin / (1.0 - FACE_EGG_MODEL.eyeLineRatio)) + 1);
  const bottom = clamp(Math.round(chinY), 0, 63);

  const skinXs = visibleSkinOffsets.map(xOf);
  const skinRows = new Map<number, number[]>();
  visibleSkinOffsets.forEach((o) => {
    const xs = skinRows.get(yOf(o)) || [];
    xs.push(xOf(o));
    skinRows.set(yOf(o), xs);
  });

  let robustSkinWidth = 16;
  if (skinXs.length > 0) {
    const pWidth = percentileInt(skinXs, 0.95) - percentileInt(skinXs, 0.05) + 1;
    const rowWidths = Array.from(skinRows.values()).map((xs) => Math.max(...xs) - Math.min(...xs) + 1);
    robustSkinWidth = Math.min(pWidth, Math.round(median(rowWidths)));
  }

  const eyeSeparation = Math.max(1.0, rightEyeCenter[0] - leftEyeCenter[0]);
  const width = clamp(
    Math.round(
      Math.max(
        robustSkinWidth * FACE_EGG_MODEL.skinWidthScale,
        eyeSeparation * FACE_EGG_MODEL.eyeSeparationWidthScale
      )
    ),
    FACE_EGG_MODEL.minimumWidth,
    FACE_EGG_MODEL.maximumWidth
  );

  const maxAsym = FACE_EGG_MODEL.maximumAsymmetry;
  const maxShear = FACE_EGG_MODEL.maximumShearPixels;
  const leftSkin = skinXs.filter((x) => x < eyeMidX).length;
  const rightSkin = skinXs.filter((x) => x > eyeMidX).length;
  const skinTotal = Math.max(1, leftSkin + rightSkin);
  const inferredAsymmetry = clamp(((rightSkin - leftSkin) / skinTotal) * 0.4, -maxAsym, maxAsym);
  const visibleCenter = skinXs.length > 0 ? mean(skinXs) : eyeMidX;
  const inferredShear = clamp(visibleCenter - eyeMidX, -maxShear, maxShear);

  const leftEyeOff = Math.round(leftEyeCenter[1]) * W + Math.round(leftEyeCenter[0]);
  const rightEyeOff = Math.round(rightEyeCenter[1]) * W + Math.round(rightEyeCenter[0]);

  let bestObjective = Infinity;
  let best: { bbox: Bbox; mask: boolean[] } | null = null;

  for (let candidateWidth = Math.max(FACE_EGG_MODEL.minimumWidth, width - 3); candidateWidth <= width; candidateWidth++) {
    const candidateHeight = Math.max(anchoredHeight, candidateWidth + 1);
    const candidateTop = Math.max(0, bottom - candidateHeight + 1);

    for (const centerShift of [-1, 0, 1]) {
      let left = Math.max(0, Math.round(eyeMidX + centerShift - (candidateWidth - 1) / 2));
      const right = Math.min(63, left + candidateWidth - 1);
      if (right === 63) left = right - candidateWidth + 1;
      const bbox: Bbox = [left, candidateTop, right, bottom];

      for (const deltaAsym of [-0.05, 0, 0.05]) {
        const asym = clamp(inferredAsymmetry + deltaAsym, -maxAsym, maxAsym);

        for (const deltaShear of [-1, 0, 1]) {
          const shearX = clamp(inferredShear + deltaShear, -maxShear, maxShear);
          const mask = rasterPolygon(faceOutlinePoints(bbox, asym, shearX));

          let bgCount = 0;
          for (let i = 0; i < PIXEL_COUNT; i++) {
            if (mask[i] && exteriorWhite[i]) bgCount++;
          }
          const coveredSkin = visibleSkinOffsets.filter((off) => mask[off]).length;
          const skinCov = coveredSkin / Math.max(1, visibleSkinOffsets.length);
          const eyesInside = mask[leftEyeOff] && mask[rightEyeOff];

          const objective =
            bgCount * 100 +
            (1 - skinCov) * 100 +
            (eyesInside ? 0 : 10000) +
            Math.abs(asym) * 2 +
            Math.abs(shearX) * 0.2;

          if (objective < bestObjective) {
            bestObjective = objective;
            best = { bbox, mask };
          }
        }
      }
    }
  }

  return best!;
}

/* =========================================================================
 * 3b. 眼睛检测 (眼白 + 瞳色 + 高光)
 * ========================================================================= */

const EYE_DETECTION_MODEL = {
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

function chroma(rgb: Rgb): { min: number; max: number } {
  return { min: Math.min(rgb[0], rgb[1], rgb[2]), max: Math.max(rgb[0], rgb[1], rgb[2]) };
}

function isSclera(rgb: Rgb): boolean {
  const { min, max } = chroma(rgb);
  return min >= EYE_DETECTION_MODEL.scleraMinChannel && max - min <= EYE_DETECTION_MODEL.scleraMaxChroma && !isFaceSkin(rgb);
}

function isEyeInk(rgb: Rgb): boolean {
  const [red, green, blue] = rgb;
  const { min, max } = chroma(rgb);
  const dark = max < EYE_DETECTION_MODEL.inkMaxChannel;
  const colourful = max - min >= EYE_DETECTION_MODEL.inkMinChroma;
  const blush = red > green + EYE_DETECTION_MODEL.blushRedOverGreen && red > blue + EYE_DETECTION_MODEL.blushRedOverBlue;
  return (dark || colourful) && !blush;
}

function isEyeHighlight(rgb: Rgb): boolean {
  const { min, max } = chroma(rgb);
  return min >= EYE_DETECTION_MODEL.highlightMinChannel && max - min <= EYE_DETECTION_MODEL.highlightMaxChroma && !isFaceSkin(rgb);
}

/** 矩形内满足条件的像素掩码 */
function maskInRect(rect: Bbox, test: (offset: number) => boolean): boolean[] {
  const [left, top, right, bottom] = rect;
  return Array.from({ length: PIXEL_COUNT }, (_, offset) => {
    const x = xOf(offset);
    const y = yOf(offset);
    return x >= left && x <= right && y >= top && y <= bottom && test(offset);
  });
}

/** 组件周围 radius 范围内 (限定在 rect 内) 的瞳色像素 */
function nearbyInk(pixels: Rgb[], comp: number[], radius: number, rect: Bbox): Set<number> {
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

interface HighlightPair {
  leftCenter: Point;
  rightCenter: Point;
  offsets: number[];
}

/** 左右各找一个小高光点 (周围有足够瞳色)，配对后作为最强的眼位证据 */
function detectEyeHighlightPair(
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
function estimateEyeLine(
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

interface EyeRegion {
  bbox: Bbox;
  detected: boolean; // false 表示没找到像素证据，退回几何预测
  confidence: number;
  scleraOffsets: number[];
  inkOffsets: number[];
  centerX: number;
  centerY: number;
}

function centeredBbox(centerX: number, centerY: number, width: number, height: number): Bbox {
  let left = Math.max(0, Math.round(centerX - (width - 1) / 2));
  const right = Math.min(63, left + width - 1);
  if (right === 63) left = right - width + 1;

  let top = Math.max(0, Math.round(centerY - (height - 1) / 2));
  const bottom = Math.min(63, top + height - 1);
  if (bottom === 63) top = bottom - height + 1;

  return [left, top, right, bottom];
}

function geometryFallbackEye(predBbox: Bbox, centerX: number, centerY: number): EyeRegion {
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
function detectEyeRegion(pixels: Rgb[], exteriorWhite: boolean[], predBbox: Bbox, eyeLineY: number): EyeRegion {
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
function anchorEyeToHighlight(eye: EyeRegion, hlCenter: Point): EyeRegion {
  const cx = clamp(eye.centerX, hlCenter[0] - 1, hlCenter[0] + 1);
  const cy = clamp(eye.centerY, hlCenter[1] - 1, hlCenter[1] + 1);
  const width = eye.bbox[2] - eye.bbox[0] + 1;
  const height = eye.bbox[3] - eye.bbox[1] + 1;
  return { ...eye, bbox: centeredBbox(cx, cy, width, height), centerX: cx, centerY: cy };
}

/* =========================================================================
 * 3c. 发色字典与头发掩码
 * ========================================================================= */

const HAIR_PALETTE_MODEL = {
  minimumExactColorPixels: 2,
  maximumOklabDistance: 0.04,
  seedHorizontalPadding: 4,
  seedVerticalPadding: 4,
  seedEyeLineExtension: 1,
};

/**
 * 脸框上方到眼线之间 (排除白底 / 眼睛 / 轮廓色 / 肤色) 出现 ≥2 次的颜色组成发色字典，
 * 与字典色相近且与种子区域相连的像素即头发。
 */
function analyzeHairMask(
  pixels: Rgb[],
  exteriorWhite: boolean[],
  outlineColors: Rgb[],
  faceOutlineBbox: Bbox,
  eyeLineY: number,
  eyeOffsets: Set<number>
): boolean[] {
  const [left, top, right] = faceOutlineBbox;
  const seedBbox: Bbox = [
    Math.max(0, left - HAIR_PALETTE_MODEL.seedHorizontalPadding),
    Math.max(0, top - HAIR_PALETTE_MODEL.seedVerticalPadding),
    Math.min(63, right + HAIR_PALETTE_MODEL.seedHorizontalPadding),
    Math.min(63, eyeLineY + HAIR_PALETTE_MODEL.seedEyeLineExtension),
  ];

  const outlineKeys = new Set(outlineColors.map(rgbKey));
  const seedOffsets = new Set<number>();
  const counts = new Map<string, { count: number; rgb: Rgb }>();

  for (let y = seedBbox[1]; y <= seedBbox[3]; y++) {
    for (let x = seedBbox[0]; x <= seedBbox[2]; x++) {
      const offset = y * W + x;
      const color = pixels[offset];
      const key = rgbKey(color);
      if (exteriorWhite[offset] || eyeOffsets.has(offset) || outlineKeys.has(key) || isFaceSkin(color)) {
        continue;
      }
      seedOffsets.add(offset);
      const item = counts.get(key) || { count: 0, rgb: color };
      item.count++;
      counts.set(key, item);
    }
  }

  const hairColors = Array.from(counts.values())
    .filter((v) => v.count >= HAIR_PALETTE_MODEL.minimumExactColorPixels)
    .map(({ rgb }) => ({ rgb, lab: rgbToOklab(rgb) }));

  if (hairColors.length === 0) return new Array<boolean>(PIXEL_COUNT).fill(false);

  const allowed = pixels.map((color, offset) => {
    if (exteriorWhite[offset]) return false;
    const lab = rgbToOklab(color);
    return hairColors.some(
      (e) => sameRgb(color, e.rgb) || oklabDistance(lab, e.lab) <= HAIR_PALETTE_MODEL.maximumOklabDistance
    );
  });

  const hairOffsets: number[] = [];
  for (const comp of connectedComponents(allowed, true)) {
    if (comp.some((offset) => seedOffsets.has(offset))) hairOffsets.push(...comp);
  }
  return maskFromOffsets(hairOffsets);
}

/* =========================================================================
 * 3. 面部分析
 * ========================================================================= */

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

interface FaceAnalysis {
  faceMask: boolean[];      // 严格的面部肤色核心
  faceModelMask: boolean[]; // 拟合出的蛋形脸
  hairMask: boolean[];
  faceBbox: Bbox;           // 蛋形脸外框
  visibleSkinBbox: Bbox;
  eyeLineY: number;
  chinY: number;
  leftEyeCenter: Point;
  rightEyeCenter: Point;
  eyeOffsets: number[];     // 眼白 + 瞳色 + 高光
}

function analyzeFace(pixels: Rgb[], outlineColors: Rgb[]): FaceAnalysis | null {
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

/* =========================================================================
 * 4. 嘴部
 * ========================================================================= */

const MOUTH_DETECTION_MODEL = {
  roiTopEyeChinRatio: 0.55,
  roiBottomEyeChinRatio: 0.9,
  roiHalfWidth: 6,
  minimumSkinNeighbours: 5,
};

function isMouthColor(rgb: Rgb): boolean {
  const [red, green, blue] = rgb;
  const pinkOrRed = red >= 135 && red - green >= 30 && red - blue >= 15;
  const darkWarm = Math.max(red, green, blue) <= 155 && red - green >= 18 && red - blue >= 5;
  return (pinkOrRed || darkWarm) && !isFaceSkin(rgb);
}

function skinNeighbourCount(pixels: Rgb[], x: number, y: number): number {
  let count = 0;
  for (let ny = Math.max(0, y - 1); ny <= Math.min(63, y + 1); ny++) {
    for (let nx = Math.max(0, x - 1); nx <= Math.min(63, x + 1); nx++) {
      if ((nx !== x || ny !== y) && isFaceSkin(pixels[ny * W + nx])) count++;
    }
  }
  return count;
}

/** 双眼与下巴之间的 ROI 内，被肤色包围的红/暗暖色像素 */
function detectMouth(pixels: Rgb[], face: FaceAnalysis): { offsets: number[]; roi: Bbox } {
  const eyeCenterX = (face.leftEyeCenter[0] + face.rightEyeCenter[0]) / 2;
  const eyeCenterY = (face.leftEyeCenter[1] + face.rightEyeCenter[1]) / 2;
  const eyeChinH = face.chinY - eyeCenterY;

  const roiLeft = Math.max(0, Math.round(eyeCenterX) - MOUTH_DETECTION_MODEL.roiHalfWidth);
  const roiRight = Math.min(63, Math.round(eyeCenterX) + MOUTH_DETECTION_MODEL.roiHalfWidth);
  const roiTop = Math.max(0, Math.round(eyeCenterY + eyeChinH * MOUTH_DETECTION_MODEL.roiTopEyeChinRatio));
  const roiBottom = Math.max(
    roiTop,
    Math.min(Math.round(face.chinY) - 1, Math.round(eyeCenterY + eyeChinH * MOUTH_DETECTION_MODEL.roiBottomEyeChinRatio))
  );

  const offsets: number[] = [];
  for (let y = roiTop; y <= roiBottom; y++) {
    for (let x = roiLeft; x <= roiRight; x++) {
      const offset = y * W + x;
      if (isMouthColor(pixels[offset]) && skinNeighbourCount(pixels, x, y) >= MOUTH_DETECTION_MODEL.minimumSkinNeighbours) {
        offsets.push(offset);
      }
    }
  }
  return { offsets, roi: [roiLeft, roiTop, roiRight, roiBottom] };
}

/* =========================================================================
 * 5. 依次认领像素
 * ========================================================================= */

function looksLikeExpressionColor(color: Rgb): boolean {
  const [red, green, blue] = color;
  return red >= 150 && red - green >= 25 && red - blue >= 12;
}

interface ClaimedRegions {
  eyes: Set<number>;
  skin: Set<number>; // 脸部皮肤 + 身体皮肤 + 嘴 / 表情
  hair: Set<number>;
}

function claimFaceRegions(pixels: Rgb[], foregroundMask: boolean[], claimed: Set<number>, face: FaceAnalysis): ClaimedRegions {
  const claimAll = (set: Set<number>) => set.forEach((o) => claimed.add(o));
  const unclaimed = (offsets: Iterable<number>) => new Set(Array.from(offsets).filter((o) => !claimed.has(o)));

  const eyes = unclaimed(face.eyeOffsets);
  claimAll(eyes);

  // 嘴：候选像素及其在 ROI 内的非肤色邻居，再加上蛋形脸内眼线以下的红色表情像素
  const mouth = detectMouth(pixels, face);
  let expression = unclaimed(mouth.offsets);
  if (expression.size > 0) {
    const [left, top, right, bottom] = mouth.roi;
    const nearMouth = new Set(expression);
    for (const offset of expression) {
      const x = xOf(offset);
      const y = yOf(offset);
      for (let ny = Math.max(top, y - 1); ny <= Math.min(bottom, y + 1); ny++) {
        for (let nx = Math.max(left, x - 1); nx <= Math.min(right, x + 1); nx++) {
          const cand = ny * W + nx;
          if (!claimed.has(cand) && !isFaceSkin(pixels[cand])) nearMouth.add(cand);
        }
      }
    }
    expression = nearMouth;
  }
  for (let offset = 0; offset < PIXEL_COUNT; offset++) {
    if (
      face.faceModelMask[offset] &&
      yOf(offset) >= face.eyeLineY &&
      !claimed.has(offset) &&
      !isFaceSkin(pixels[offset]) &&
      looksLikeExpressionColor(pixels[offset])
    ) {
      expression.add(offset);
    }
  }
  expression = unclaimed(expression);
  claimAll(expression);

  // 皮肤：肤色或与面部核心肤色相近
  const skinLabs: Lab[] = [];
  face.faceMask.forEach((enabled, i) => {
    if (enabled) skinLabs.push(rgbToOklab(pixels[i]));
  });
  const isSkinLike = (color: Rgb, maxDist: number) =>
    isFaceSkin(color) || skinLabs.some((sl) => oklabDistance(rgbToOklab(color), sl) <= maxDist);

  const faceSkin = new Set<number>();
  for (let offset = 0; offset < PIXEL_COUNT; offset++) {
    if (face.faceModelMask[offset] && !claimed.has(offset) && isSkinLike(pixels[offset], 0.045)) {
      faceSkin.add(offset);
    }
  }

  // 蛋形脸外、但在脸框附近且与已认领脸部皮肤相连的肤色 (耳朵、脸颊溢出)
  if (faceSkin.size > 0) {
    const left = Math.max(0, Math.min(face.faceBbox[0], face.visibleSkinBbox[0]) - 2);
    const top = Math.max(0, Math.min(face.faceBbox[1], face.visibleSkinBbox[1]) - 1);
    const right = Math.min(63, Math.max(face.faceBbox[2], face.visibleSkinBbox[2]) + 2);
    const bottom = Math.min(63, Math.max(face.faceBbox[3], face.visibleSkinBbox[3]) + 1);

    const connectedSkin = maskInRect([left, top, right, bottom], (o) => !claimed.has(o) && isSkinLike(pixels[o], 0.045));
    for (const comp of connectedComponents(connectedSkin, true)) {
      if (comp.some((o) => faceSkin.has(o))) comp.forEach((o) => faceSkin.add(o));
    }
  }
  claimAll(faceSkin);

  const bodySkin = new Set<number>();
  for (let offset = 0; offset < PIXEL_COUNT; offset++) {
    if (foregroundMask[offset] && yOf(offset) > face.chinY && !claimed.has(offset) && isSkinLike(pixels[offset], 0.035)) {
      bodySkin.add(offset);
    }
  }
  claimAll(bodySkin);

  const hair = new Set<number>();
  face.hairMask.forEach((enabled, i) => {
    if (enabled && !claimed.has(i)) hair.add(i);
  });

  return { eyes, skin: new Set([...expression, ...faceSkin, ...bodySkin]), hair };
}

/** 面部识别失败时，按此行号把轮廓线分给头发 (上) 或衣服 (下) */
const FALLBACK_CHIN_Y = 38;

/**
 * 对 64×64 RGB 像素自动生成 5 分区语义遮罩 (SemanticZone 值数组)。
 * 面部识别失败时只区分背景 / 前景：轮廓线按 FALLBACK_CHIN_Y 分给头发或衣服，其余前景归衣服。
 */
export function computeSemanticMask(pixels: Rgb[]): Uint8Array {
  const { backgroundMask, foregroundMask } = estimateForeground(pixels);
  const outline = analyzePixelOutline(pixels, backgroundMask, foregroundMask);
  const face = analyzeFace(pixels, outline.outlineColors);

  const claimed = new Set<number>();
  outline.outlineMask.forEach((enabled, i) => {
    if (enabled) claimed.add(i);
  });
  const regions = face ? claimFaceRegions(pixels, foregroundMask, claimed, face) : null;
  const chinY = face ? face.chinY : FALLBACK_CHIN_Y;

  const mask = new Uint8Array(PIXEL_COUNT);
  for (let i = 0; i < PIXEL_COUNT; i++) {
    if (!foregroundMask[i]) mask[i] = SemanticZone.Background;
    else if (regions?.eyes.has(i)) mask[i] = SemanticZone.Eyes;
    else if (regions?.hair.has(i)) mask[i] = SemanticZone.Hair;
    else if (regions?.skin.has(i)) mask[i] = SemanticZone.Skin;
    else if (outline.outlineMask[i]) mask[i] = yOf(i) > chinY ? SemanticZone.Clothes : SemanticZone.Hair;
    else mask[i] = SemanticZone.Clothes;
  }
  return mask;
}
