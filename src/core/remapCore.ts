/**
 * ImageGem Standalone Remap Core (TypeScript Edition).
 * Consolidated pixel-avatar geometry gating, feature detection, semantic region segmentation,
 * and OKLab palette reduction in pure, self-contained TypeScript.
 */

export const IMAGE_WIDTH = 64;
export const IMAGE_HEIGHT = 64;
export const PIXEL_COUNT = IMAGE_WIDTH * IMAGE_HEIGHT; // 4096

export type Rgb = [number, number, number];
export type Lab = [number, number, number];

const FOUR_NEIGHBOUR_DELTAS: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

const EIGHT_NEIGHBOUR_DELTAS: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export function borderOffsets(): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  const add = (offset: number) => {
    if (!seen.has(offset)) {
      seen.add(offset);
      result.push(offset);
    }
  };
  for (let x = 0; x < IMAGE_WIDTH; x++) add(x);
  for (let x = 0; x < IMAGE_WIDTH; x++) add((IMAGE_HEIGHT - 1) * IMAGE_WIDTH + x);
  for (let y = 0; y < IMAGE_HEIGHT; y++) add(y * IMAGE_WIDTH);
  for (let y = 0; y < IMAGE_HEIGHT; y++) add(y * IMAGE_WIDTH + IMAGE_WIDTH - 1);
  return result;
}

export function sideAndTopOffsets(): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  const add = (offset: number) => {
    if (!seen.has(offset)) {
      seen.add(offset);
      result.push(offset);
    }
  };
  for (let x = 0; x < IMAGE_WIDTH; x++) add(x);
  for (let y = 0; y < IMAGE_HEIGHT; y++) add(y * IMAGE_WIDTH);
  for (let y = 0; y < IMAGE_HEIGHT; y++) add(y * IMAGE_WIDTH + IMAGE_WIDTH - 1);
  return result;
}

export function* getNeighbours(offset: number, diagonal: boolean): Generator<number> {
  const x = offset % IMAGE_WIDTH;
  const y = Math.floor(offset / IMAGE_WIDTH);
  const deltas = diagonal ? EIGHT_NEIGHBOUR_DELTAS : FOUR_NEIGHBOUR_DELTAS;
  for (let i = 0; i < deltas.length; i++) {
    const [dx, dy] = deltas[i];
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < IMAGE_WIDTH && ny >= 0 && ny < IMAGE_HEIGHT) {
      yield ny * IMAGE_WIDTH + nx;
    }
  }
}

export function connectedComponents(mask: ArrayLike<boolean | number>, diagonal: boolean = false): number[][] {
  const seen = new Uint8Array(PIXEL_COUNT);
  const output: number[][] = [];

  for (let start = 0; start < PIXEL_COUNT; start++) {
    if (!mask[start] || seen[start]) continue;

    const stack: number[] = [start];
    seen[start] = 1;
    const component: number[] = [];

    while (stack.length > 0) {
      const offset = stack.pop()!;
      component.push(offset);
      for (const neighbour of getNeighbours(offset, diagonal)) {
        if (mask[neighbour] && !seen[neighbour]) {
          seen[neighbour] = 1;
          stack.push(neighbour);
        }
      }
    }
    output.push(component);
  }
  return output;
}

export function floodMask(candidates: ArrayLike<boolean | number>, seeds: Iterable<number>): boolean[] {
  const flooded = new Array<boolean>(PIXEL_COUNT).fill(false);
  const queue: number[] = [];
  let head = 0;

  for (const offset of seeds) {
    if (candidates[offset] && !flooded[offset]) {
      flooded[offset] = true;
      queue.push(offset);
    }
  }

  while (head < queue.length) {
    const offset = queue[head++];
    for (const neighbour of getNeighbours(offset, false)) {
      if (candidates[neighbour] && !flooded[neighbour]) {
        flooded[neighbour] = true;
        queue.push(neighbour);
      }
    }
  }
  return flooded;
}

/* =========================================================================
 * OKLab & Color Conversions
 * ========================================================================= */

function srgbChannelToLinear(value: number): number {
  const c = value / 255.0;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function rgbToOklab(rgb: Rgb): Lab {
  const r = srgbChannelToLinear(rgb[0]);
  const g = srgbChannelToLinear(rgb[1]);
  const b = srgbChannelToLinear(rgb[2]);

  const light = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const medium = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const short = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const lightRoot = Math.cbrt(light);
  const mediumRoot = Math.cbrt(medium);
  const shortRoot = Math.cbrt(short);

  return [
    0.2104542553 * lightRoot + 0.793617785 * mediumRoot - 0.0040720468 * shortRoot,
    1.9779984951 * lightRoot - 2.428592205 * mediumRoot + 0.4505937099 * shortRoot,
    0.0259040371 * lightRoot + 0.7827717662 * mediumRoot - 0.808675766 * shortRoot,
  ];
}

export function oklabDistance(first: Lab, second: Lab): number {
  const d0 = first[0] - second[0];
  const d1 = first[1] - second[1];
  const d2 = first[2] - second[2];
  return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
}

export function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const pos = fraction * (ordered.length - 1);
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return ordered[lower];
  const weight = pos - lower;
  return ordered[lower] * (1 - weight) + ordered[upper] * weight;
}

export function percentileInt(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.round((ordered.length - 1) * fraction)];
}

export function median(values: number[]): number {
  return percentile(values, 0.5);
}

/* =========================================================================
 * Background Estimation & Gating
 * ========================================================================= */

export interface BackgroundEstimate {
  backgroundMask: boolean[];
  foregroundMask: boolean[];
  rgb: Rgb;
  threshold: number;
  clusterSpread: number;
  borderClusterFraction: number;
}

export function isFaceSkin(rgb: Rgb): boolean {
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

export function isBackgroundWhite(rgb: Rgb): boolean {
  const minC = Math.min(rgb[0], rgb[1], rgb[2]);
  const maxC = Math.max(rgb[0], rgb[1], rgb[2]);
  return minC >= 239 && maxC - minC <= 20;
}

export function exteriorWhiteMask(pixels: Rgb[]): boolean[] {
  const candidates = pixels.map(isBackgroundWhite);
  return floodMask(candidates, sideAndTopOffsets());
}

export function estimateBackground(pixels: Rgb[]): BackgroundEstimate {
  const labs: Lab[] = pixels.map(rgbToOklab);
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
    percentile(clusterLabs.map((l) => l[0]), 0.5),
    percentile(clusterLabs.map((l) => l[1]), 0.5),
    percentile(clusterLabs.map((l) => l[2]), 0.5),
  ];

  const clusterDistances = clusterLabs.map((val) => oklabDistance(val, center));
  const spread = percentile(clusterDistances, 0.9);
  const threshold = Math.min(0.12, Math.max(0.045, spread + 0.025));

  const candidates = labs.map((val) => oklabDistance(val, center) <= threshold);
  const backgroundMask = floodMask(candidates, offsets);
  const foregroundMask = backgroundMask.map((bg) => !bg);

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let validBorderCount = 0;
  offsets.forEach((idx) => {
    if (oklabDistance(clusterSeed, labs[idx]) <= clusterRadius) {
      sumR += pixels[idx][0];
      sumG += pixels[idx][1];
      sumB += pixels[idx][2];
      validBorderCount++;
    }
  });

  const avgR = validBorderCount > 0 ? Math.round(sumR / validBorderCount) : 255;
  const avgG = validBorderCount > 0 ? Math.round(sumG / validBorderCount) : 255;
  const avgB = validBorderCount > 0 ? Math.round(sumB / validBorderCount) : 255;

  return {
    backgroundMask,
    foregroundMask,
    rgb: [avgR, avgG, avgB],
    threshold,
    clusterSpread: spread,
    borderClusterFraction: clusterLabs.length / borderLabs.length,
  };
}

/* =========================================================================
 * Pixel Outline Analysis
 * ========================================================================= */

const PIXEL_OUTLINE_MODEL = {
  minimumComponentPixels: 10,
  maximumOklabDistance: 0.035,
};

export interface PixelOutlineAnalysis {
  candidateMask: boolean[];
  outlineMask: boolean[];
  outlineColors: Rgb[];
  componentSizes: number[];
}

export function analyzePixelOutline(
  pixels: Rgb[],
  backgroundMask: boolean[],
  foregroundMask: boolean[]
): PixelOutlineAnalysis {
  const candidateMask = new Array<boolean>(PIXEL_COUNT).fill(false);
  for (let offset = 0; offset < PIXEL_COUNT; offset++) {
    if (foregroundMask[offset]) {
      let touchesBg = false;
      for (const nb of getNeighbours(offset, false)) {
        if (backgroundMask[nb]) {
          touchesBg = true;
          break;
        }
      }
      if (touchesBg) candidateMask[offset] = true;
    }
  }

  const countsByColor = new Map<string, { count: number; rgb: Rgb }>();
  for (let offset = 0; offset < PIXEL_COUNT; offset++) {
    if (candidateMask[offset]) {
      const p = pixels[offset];
      const key = `${p[0]},${p[1]},${p[2]}`;
      const entry = countsByColor.get(key) || { count: 0, rgb: p };
      entry.count++;
      countsByColor.set(key, entry);
    }
  }

  const sortedCandidates = Array.from(countsByColor.values()).sort((a, b) => b.count - a.count);
  const confirmedColors: Rgb[] = [];
  const confirmedSeeds = new Set<number>();
  const confirmedSizes: number[] = [];

  for (const { count, rgb } of sortedCandidates) {
    if (count < PIXEL_OUTLINE_MODEL.minimumComponentPixels) continue;
    const colorMask = new Array<boolean>(PIXEL_COUNT);
    for (let i = 0; i < PIXEL_COUNT; i++) {
      colorMask[i] =
        candidateMask[i] &&
        pixels[i][0] === rgb[0] &&
        pixels[i][1] === rgb[1] &&
        pixels[i][2] === rgb[2];
    }
    const components = connectedComponents(colorMask, true);
    const qualifying = components.filter((c) => c.length >= PIXEL_OUTLINE_MODEL.minimumComponentPixels);
    if (qualifying.length === 0) continue;

    confirmedColors.push(rgb);
    for (const comp of qualifying) {
      comp.forEach((offset) => confirmedSeeds.add(offset));
      confirmedSizes.push(comp.length);
    }
  }

  if (confirmedColors.length === 0) {
    return {
      candidateMask,
      outlineMask: new Array<boolean>(PIXEL_COUNT).fill(false),
      outlineColors: [],
      componentSizes: [],
    };
  }

  const colorLabs = confirmedColors.map(rgbToOklab);
  const maxDist = PIXEL_OUTLINE_MODEL.maximumOklabDistance;
  const colorMatch = new Array<boolean>(PIXEL_COUNT);
  for (let offset = 0; offset < PIXEL_COUNT; offset++) {
    if (!foregroundMask[offset]) {
      colorMatch[offset] = false;
      continue;
    }
    const lab = rgbToOklab(pixels[offset]);
    colorMatch[offset] = colorLabs.some((clab) => oklabDistance(lab, clab) <= maxDist);
  }

  const outlineOffsets = new Set<number>();
  for (const comp of connectedComponents(colorMatch, true)) {
    if (comp.some((offset) => confirmedSeeds.has(offset))) {
      comp.forEach((offset) => outlineOffsets.add(offset));
    }
  }

  const outlineMask = new Array<boolean>(PIXEL_COUNT);
  for (let i = 0; i < PIXEL_COUNT; i++) {
    outlineMask[i] = outlineOffsets.has(i);
  }

  return {
    candidateMask,
    outlineMask,
    outlineColors: confirmedColors,
    componentSizes: confirmedSizes.sort((a, b) => b - a),
  };
}

/* =========================================================================
 * Face Outline, Face Egg & Bézier Curves
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

function cubicPoints(
  start: [number, number],
  control1: [number, number],
  control2: [number, number],
  end: [number, number],
  steps: number = 12
): [number, number][] {
  const points: [number, number][] = [];
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

export function faceOutlinePoints(
  bbox: [number, number, number, number],
  asymmetry: number = 0.0,
  shearX: number = 0.0
): [number, number][] {
  const [left, top, right, bottom] = bbox;
  const centerX = (left + right) / 2;
  const radiusX = (right - left) / 2;
  const height = bottom - top;

  const topLeft: [number, number] = [centerX - radiusX * 0.38, top];
  const topRight: [number, number] = [centerX + radiusX * 0.38, top];
  const rightMid: [number, number] = [right, top + height * 0.38];
  const rightLower: [number, number] = [centerX + radiusX * 0.65, top + height * 0.8];
  const chin: [number, number] = [centerX, bottom];

  const rightCurve: [number, number][] = [
    topRight,
    ...cubicPoints(topRight, [centerX + radiusX * 0.78, top], [right, top + height * 0.16], rightMid),
    ...cubicPoints(rightMid, [right, top + height * 0.55], [centerX + radiusX * 0.86, top + height * 0.72], rightLower),
    ...cubicPoints(rightLower, [centerX + radiusX * 0.5, top + height * 0.9], [centerX + radiusX * 0.16, top + height * 0.99], chin),
  ];

  const leftCurve: [number, number][] = [...rightCurve].reverse().map(([x, y]) => [centerX - (x - centerX), y]);
  const points: [number, number][] = [topLeft, ...rightCurve, ...leftCurve.slice(1)];

  if (asymmetry === 0 && shearX === 0) return points;

  return points.map(([x, y]) => {
    const vertical = height === 0 ? 0.0 : (y - top) / height;
    const sideScale = x >= centerX ? 1 + asymmetry : 1 - asymmetry;
    const shiftedCenter = centerX + shearX * (0.5 - vertical);
    return [shiftedCenter + (x - centerX) * sideScale, y];
  });
}

function centeredBbox(centerX: number, centerY: number, width: number, height: number): [number, number, number, number] {
  let left = Math.max(0, Math.round(centerX - (width - 1) / 2));
  let right = Math.min(63, left + width - 1);
  if (right === 63) left = right - width + 1;

  let top = Math.max(0, Math.round(centerY - (height - 1) / 2));
  let bottom = Math.min(63, top + height - 1);
  if (bottom === 63) top = bottom - height + 1;

  return [left, top, right, bottom];
}

function deadZoneShift(error: number, tolerance: number): number {
  if (Math.abs(error) <= tolerance) return 0;
  const dir = error > 0 ? 1 : -1;
  return dir * Math.max(1, Math.round(Math.abs(error) - tolerance));
}

function neededLeftEyePadding(paddedOutlineLeft: number, leftEyeBbox: [number, number, number, number]): number {
  const configured = FACE_OUTLINE_MODEL.leftEyePadding;
  const unpadded = paddedOutlineLeft + configured;
  const available = leftEyeBbox[0] - unpadded;
  return available < FACE_OUTLINE_MODEL.leftEyeMinimumMargin ? configured : 0;
}

/* =========================================================================
 * Raster Polygon Filling (replacing Pillow ImageDraw.Draw.polygon)
 * ========================================================================= */

function rasterPolygon(points: [number, number][]): boolean[] {
  const mask = new Array<boolean>(PIXEL_COUNT).fill(false);
  const n = points.length;
  if (n < 3) return mask;

  let minY = 63;
  let maxY = 0;
  for (let i = 0; i < n; i++) {
    const y = points[i][1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const iMinY = Math.max(0, Math.floor(minY));
  const iMaxY = Math.min(63, Math.ceil(maxY));

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
    for (let k = 0; k < nodeX.length; k += 2) {
      if (k + 1 >= nodeX.length) break;
      const startX = Math.max(0, Math.ceil(nodeX[k] - 0.5));
      const endX = Math.min(63, Math.floor(nodeX[k + 1] - 0.5));
      for (let x = startX; x <= endX; x++) {
        mask[y * 64 + x] = true;
      }
    }
  }
  return mask;
}

export interface FaceEggAnalysis {
  bbox: [number, number, number, number];
  asymmetry: number;
  shearX: number;
  mask: boolean[];
  backgroundPixelCount: number;
  skinCoverage: number;
  reliable: boolean;
}

const FACE_EGG_MODEL = {
  eyeLineRatio: 0.45,
  minimumWidth: 16,
  maximumWidth: 30,
  skinWidthScale: 1.0,
  eyeSeparationWidthScale: 1.2,
  maximumAsymmetry: 0.14,
  maximumShearPixels: 2.0,
  minimumSkinCoverage: 0.6,
};

export function fitFaceEgg(
  visibleSkinOffsets: number[],
  leftEyeCenter: [number, number],
  rightEyeCenter: [number, number],
  chinY: number,
  exteriorWhite: boolean[]
): FaceEggAnalysis {
  const eyeMidX = (leftEyeCenter[0] + rightEyeCenter[0]) / 2;
  const eyeMidY = (leftEyeCenter[1] + rightEyeCenter[1]) / 2;
  const eyeToChin = Math.max(4.0, chinY - eyeMidY);
  const height = Math.max(10, Math.round(eyeToChin / (1.0 - FACE_EGG_MODEL.eyeLineRatio)) + 1);
  const bottom = Math.max(0, Math.min(63, Math.round(chinY)));

  const skinXs = visibleSkinOffsets.map((o) => o % 64);
  const skinRows = new Map<number, number[]>();
  visibleSkinOffsets.forEach((o) => {
    const y = Math.floor(o / 64);
    const xs = skinRows.get(y) || [];
    xs.push(o % 64);
    skinRows.set(y, xs);
  });

  let robustSkinWidth = 16;
  if (skinXs.length > 0) {
    const pLeft = percentileInt(skinXs, 0.05);
    const pRight = percentileInt(skinXs, 0.95);
    const pWidth = pRight - pLeft + 1;
    const rowWidths: number[] = [];
    skinRows.forEach((xs) => {
      if (xs.length > 0) rowWidths.push(Math.max(...xs) - Math.min(...xs) + 1);
    });
    robustSkinWidth = Math.min(pWidth, Math.round(median(rowWidths)));
  }

  const eyeSeparation = Math.max(1.0, rightEyeCenter[0] - leftEyeCenter[0]);
  let width = Math.round(
    Math.max(
      robustSkinWidth * FACE_EGG_MODEL.skinWidthScale,
      eyeSeparation * FACE_EGG_MODEL.eyeSeparationWidthScale
    )
  );
  width = Math.max(FACE_EGG_MODEL.minimumWidth, Math.min(FACE_EGG_MODEL.maximumWidth, width));
  const anchoredHeight = height;

  const leftSkin = skinXs.filter((x) => x < eyeMidX).length;
  const rightSkin = skinXs.filter((x) => x > eyeMidX).length;
  const skinTotal = Math.max(1, leftSkin + rightSkin);
  const inferredAsymmetry = Math.max(
    -FACE_EGG_MODEL.maximumAsymmetry,
    Math.min(FACE_EGG_MODEL.maximumAsymmetry, ((rightSkin - leftSkin) / skinTotal) * 0.4)
  );

  const visibleCenter = skinXs.length > 0 ? skinXs.reduce((a, b) => a + b, 0) / skinXs.length : eyeMidX;
  const inferredShear = Math.max(
    -FACE_EGG_MODEL.maximumShearPixels,
    Math.min(FACE_EGG_MODEL.maximumShearPixels, visibleCenter - eyeMidX)
  );

  let bestObjective = Infinity;
  let bestAnalysis: FaceEggAnalysis | null = null;
  const minW = FACE_EGG_MODEL.minimumWidth;

  for (let candidateWidth = Math.max(minW, width - 3); candidateWidth <= width; candidateWidth++) {
    const candidateHeight = Math.max(anchoredHeight, candidateWidth + 1);
    const candidateTop = Math.max(0, bottom - candidateHeight + 1);

    for (const centerShift of [-1, 0, 1]) {
      const centerX = eyeMidX + centerShift;
      let left = Math.max(0, Math.round(centerX - (candidateWidth - 1) / 2));
      let right = Math.min(63, left + candidateWidth - 1);
      if (right === 63) left = right - candidateWidth + 1;
      const bbox: [number, number, number, number] = [left, candidateTop, right, bottom];

      for (const deltaAsym of [-0.05, 0, 0.05]) {
        const asym = Math.max(
          -FACE_EGG_MODEL.maximumAsymmetry,
          Math.min(FACE_EGG_MODEL.maximumAsymmetry, inferredAsymmetry + deltaAsym)
        );

        for (const deltaShear of [-1, 0, 1]) {
          const shearX = Math.max(
            -FACE_EGG_MODEL.maximumShearPixels,
            Math.min(FACE_EGG_MODEL.maximumShearPixels, inferredShear + deltaShear)
          );

          const points = faceOutlinePoints(bbox, asym, shearX);
          const mask = rasterPolygon(points);

          let bgCount = 0;
          for (let i = 0; i < PIXEL_COUNT; i++) {
            if (mask[i] && exteriorWhite[i]) bgCount++;
          }

          let coveredSkin = 0;
          for (const off of visibleSkinOffsets) {
            if (mask[off]) coveredSkin++;
          }
          const skinCov = coveredSkin / Math.max(1, visibleSkinOffsets.length);

          const leftEyeOff = Math.round(leftEyeCenter[1]) * 64 + Math.round(leftEyeCenter[0]);
          const rightEyeOff = Math.round(rightEyeCenter[1]) * 64 + Math.round(rightEyeCenter[0]);
          const eyesInside = Boolean(mask[leftEyeOff] && mask[rightEyeOff]);

          const objective =
            bgCount * 100 +
            (1 - skinCov) * 100 +
            (eyesInside ? 0 : 10000) +
            Math.abs(asym) * 2 +
            Math.abs(shearX) * 0.2;

          const reliable = eyesInside && bgCount === 0 && skinCov >= FACE_EGG_MODEL.minimumSkinCoverage;

          if (objective < bestObjective) {
            bestObjective = objective;
            bestAnalysis = {
              bbox,
              asymmetry: asym,
              shearX,
              mask,
              backgroundPixelCount: bgCount,
              skinCoverage: skinCov,
              reliable,
            };
          }
        }
      }
    }
  }

  return bestAnalysis!;
}

/* =========================================================================
 * Eye Detection
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

function isSclera(rgb: Rgb): boolean {
  const minC = Math.min(rgb[0], rgb[1], rgb[2]);
  const maxC = Math.max(rgb[0], rgb[1], rgb[2]);
  return minC >= EYE_DETECTION_MODEL.scleraMinChannel && maxC - minC <= EYE_DETECTION_MODEL.scleraMaxChroma && !isFaceSkin(rgb);
}

function isEyeInk(rgb: Rgb): boolean {
  const [red, green, blue] = rgb;
  const maxC = Math.max(red, green, blue);
  const minC = Math.min(red, green, blue);
  const dark = maxC < EYE_DETECTION_MODEL.inkMaxChannel;
  const colourful = maxC - minC >= EYE_DETECTION_MODEL.inkMinChroma;
  const blush = red > green + EYE_DETECTION_MODEL.blushRedOverGreen && red > blue + EYE_DETECTION_MODEL.blushRedOverBlue;
  return (dark || colourful) && !blush;
}

function isEyeHighlight(rgb: Rgb): boolean {
  const minC = Math.min(rgb[0], rgb[1], rgb[2]);
  const maxC = Math.max(rgb[0], rgb[1], rgb[2]);
  return minC >= EYE_DETECTION_MODEL.highlightMinChannel && maxC - minC <= EYE_DETECTION_MODEL.highlightMaxChroma && !isFaceSkin(rgb);
}

interface HighlightPair {
  leftCenter: [number, number];
  rightCenter: [number, number];
  offsets: number[];
}

function detectEyeHighlightPair(
  pixels: Rgb[],
  exteriorWhite: boolean[],
  predLeftX: number,
  predRightX: number,
  outlineBbox: [number, number, number, number]
): HighlightPair | null {
  const [outlineLeft, outlineTop, outlineRight, outlineBottom] = outlineBbox;
  const outlineHeight = outlineBottom - outlineTop + 1;
  const searchTop = Math.round(outlineTop + (outlineHeight - 1) * 0.2);
  const searchBottom = Math.round(outlineTop + (outlineHeight - 1) * 0.86);
  const midpoint = (predLeftX + predRightX) / 2;

  const getCandidates = (left: number, right: number, predX: number) => {
    const mask = new Array<boolean>(PIXEL_COUNT);
    for (let offset = 0; offset < PIXEL_COUNT; offset++) {
      const x = offset % 64;
      const y = Math.floor(offset / 64);
      mask[offset] =
        x >= left &&
        x <= right &&
        y >= searchTop &&
        y <= searchBottom &&
        !exteriorWhite[offset] &&
        isEyeHighlight(pixels[offset]);
    }

    const output: Array<{
      centerX: number;
      centerY: number;
      offsets: number[];
      score: number;
    }> = [];

    for (const comp of connectedComponents(mask, true)) {
      if (comp.length > EYE_DETECTION_MODEL.highlightMaxArea) continue;
      const nearbyInk = new Set<number>();
      for (const off of comp) {
        const ox = off % 64;
        const oy = Math.floor(off / 64);
        for (let ny = Math.max(searchTop, oy - 2); ny <= Math.min(searchBottom, oy + 2); ny++) {
          for (let nx = Math.max(left, ox - 2); nx <= Math.min(right, ox + 2); nx++) {
            const noff = ny * 64 + nx;
            if (isEyeInk(pixels[noff])) nearbyInk.add(noff);
          }
        }
      }
      if (nearbyInk.size < EYE_DETECTION_MODEL.highlightMinNearbyInk) continue;

      const xs = comp.map((o) => o % 64);
      const ys = comp.map((o) => Math.floor(o / 64));
      const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
      output.push({
        centerX: cx,
        centerY: cy,
        offsets: comp,
        score: Math.min(nearbyInk.size, 24) * 0.5 - Math.abs(cx - predX) * 0.5,
      });
    }
    return output;
  };

  const leftCands = getCandidates(outlineLeft, Math.floor(midpoint) - 1, predLeftX);
  const rightCands = getCandidates(Math.floor(midpoint) + 2, outlineRight, predRightX);
  const expectedSep = predRightX - predLeftX;

  let bestScore = -Infinity;
  let bestPair: { left: any; right: any } | null = null;

  for (const left of leftCands) {
    for (const right of rightCands) {
      const yDelta = Math.abs(left.centerY - right.centerY);
      const sep = right.centerX - left.centerX;
      if (
        yDelta > EYE_DETECTION_MODEL.highlightMaxPairYDelta ||
        sep < expectedSep * 0.65 ||
        sep > expectedSep * 1.6
      ) {
        continue;
      }
      const score = left.score + right.score - yDelta * 2 - Math.abs(sep - expectedSep);
      if (score > bestScore) {
        bestScore = score;
        bestPair = { left, right };
      }
    }
  }

  if (!bestPair) return null;

  return {
    leftCenter: [bestPair.left.centerX, bestPair.left.centerY],
    rightCenter: [bestPair.right.centerX, bestPair.right.centerY],
    offsets: Array.from(new Set([...bestPair.left.offsets, ...bestPair.right.offsets])).sort((a, b) => a - b),
  };
}

function estimateEyeLine(
  pixels: Rgb[],
  exteriorWhite: boolean[],
  predLeftX: number,
  predRightX: number,
  geometryEyeLineY: number,
  outlineBbox: [number, number, number, number]
): number | null {
  const [outlineLeft, outlineTop, outlineRight, outlineBottom] = outlineBbox;
  const outlineHeight = outlineBottom - outlineTop + 1;
  const searchTop = Math.round(outlineTop + (outlineHeight - 1) * EYE_DETECTION_MODEL.eyeLineSearchTopRatio);
  const searchBottom = Math.round(outlineTop + (outlineHeight - 1) * EYE_DETECTION_MODEL.eyeLineSearchBottomRatio);
  const midpoint = (predLeftX + predRightX) / 2;

  const getCandidates = (left: number, right: number, predX: number) => {
    const mask = new Array<boolean>(PIXEL_COUNT);
    for (let offset = 0; offset < PIXEL_COUNT; offset++) {
      const x = offset % 64;
      const y = Math.floor(offset / 64);
      mask[offset] =
        x >= left &&
        x <= right &&
        y >= searchTop &&
        y <= searchBottom &&
        !exteriorWhite[offset] &&
        isSclera(pixels[offset]);
    }

    const output: Array<{ centerX: number; centerY: number; score: number }> = [];

    for (const comp of connectedComponents(mask, true)) {
      const xs = comp.map((o) => o % 64);
      const ys = comp.map((o) => Math.floor(o / 64));
      const spanX = Math.max(...xs) - Math.min(...xs) + 1;
      const spanY = Math.max(...ys) - Math.min(...ys) + 1;
      if (
        comp.length > EYE_DETECTION_MODEL.eyeLineComponentMaxArea ||
        spanX > EYE_DETECTION_MODEL.eyeLineComponentMaxSpan ||
        spanY > EYE_DETECTION_MODEL.eyeLineComponentMaxSpan
      ) {
        continue;
      }

      const adjacentInk = new Set<number>();
      for (const off of comp) {
        const ox = off % 64;
        const oy = Math.floor(off / 64);
        for (let ny = Math.max(searchTop, oy - 1); ny <= Math.min(searchBottom, oy + 1); ny++) {
          for (let nx = Math.max(left, ox - 1); nx <= Math.min(right, ox + 1); nx++) {
            const noff = ny * 64 + nx;
            if (isEyeInk(pixels[noff])) adjacentInk.add(noff);
          }
        }
      }
      if (adjacentInk.size < 2) continue;

      const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
      output.push({
        centerX: cx,
        centerY: cy,
        score: Math.min(comp.length, 8) + Math.min(adjacentInk.size, 10) * 0.5 - Math.abs(cx - predX),
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

interface EyeRegionResult {
  bbox: [number, number, number, number];
  searchBbox: [number, number, number, number];
  status: string;
  confidence: number;
  scleraOffsets: number[];
  inkOffsets: number[];
  centerX: number;
  centerY: number;
}

function detectEyeRegion(
  pixels: Rgb[],
  exteriorWhite: boolean[],
  predBbox: [number, number, number, number],
  eyeLineY: number
): EyeRegionResult {
  const pad = EYE_DETECTION_MODEL.searchPadding;
  const sLeft = Math.max(0, predBbox[0] - pad);
  const sTop = Math.max(0, predBbox[1] - pad);
  const sRight = Math.min(63, predBbox[2] + pad);
  const sBottom = Math.min(63, predBbox[3] + pad);
  const searchBbox: [number, number, number, number] = [sLeft, sTop, sRight, sBottom];
  const predCenterX = (predBbox[0] + predBbox[2]) / 2;

  const scleraMask = new Array<boolean>(PIXEL_COUNT);
  for (let offset = 0; offset < PIXEL_COUNT; offset++) {
    const x = offset % 64;
    const y = Math.floor(offset / 64);
    scleraMask[offset] =
      x >= sLeft &&
      x <= sRight &&
      y >= sTop &&
      y <= sBottom &&
      !exteriorWhite[offset] &&
      isSclera(pixels[offset]);
  }

  const candidates: Array<{
    offsets: number[];
    bbox: [number, number, number, number];
    centerY: number;
    score: number;
  }> = [];

  for (const comp of connectedComponents(scleraMask, true)) {
    const adjacentInk = new Set<number>();
    for (const off of comp) {
      const ox = off % 64;
      const oy = Math.floor(off / 64);
      for (let ny = Math.max(sTop, oy - 1); ny <= Math.min(sBottom, oy + 1); ny++) {
        for (let nx = Math.max(sLeft, ox - 1); nx <= Math.min(sRight, ox + 1); nx++) {
          const noff = ny * 64 + nx;
          if (isEyeInk(pixels[noff])) adjacentInk.add(noff);
        }
      }
    }
    if (adjacentInk.size < 2) continue;

    const xs = comp.map((o) => o % 64);
    const ys = comp.map((o) => Math.floor(o / 64));
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    const score =
      comp.length * 2 +
      Math.min(adjacentInk.size, 15) -
      Math.abs(cy - eyeLineY) * 4 -
      Math.abs(cx - predCenterX) * EYE_DETECTION_MODEL.horizontalDistancePenalty;

    candidates.push({
      offsets: comp,
      bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      centerY: cy,
      score,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0 || candidates[0].score < EYE_DETECTION_MODEL.minimumComponentScore) {
    return {
      bbox: predBbox,
      searchBbox,
      status: 'fallback_geometry',
      confidence: 0.15,
      scleraOffsets: [],
      inkOffsets: [],
      centerX: predCenterX,
      centerY: eyeLineY,
    };
  }

  const primary = candidates[0];
  const selected = [primary];
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    const hGap = Math.max(
      0,
      c.bbox[0] - primary.bbox[2] - 1,
      primary.bbox[0] - c.bbox[2] - 1
    );
    if (Math.abs(c.centerY - primary.centerY) <= 2.5 && hGap <= 5) {
      selected.push(c);
    }
  }

  const scleraOffsets = Array.from(new Set(selected.flatMap((c) => c.offsets))).sort((a, b) => a - b);
  const whiteXs = scleraOffsets.map((o) => o % 64);
  const whiteYs = scleraOffsets.map((o) => Math.floor(o / 64));

  const inkOffsets: number[] = [];
  const minWY = Math.min(...whiteYs);
  const maxWY = Math.max(...whiteYs);
  const minWX = Math.min(...whiteXs);
  const maxWX = Math.max(...whiteXs);

  for (let y = Math.max(sTop, minWY - 2); y <= Math.min(sBottom, maxWY + 2); y++) {
    for (let x = Math.max(sLeft, minWX - 3); x <= Math.min(sRight, maxWX + 3); x++) {
      const offset = y * 64 + x;
      if (isFaceSkin(pixels[offset]) || !isEyeInk(pixels[offset])) continue;
      let minChebyshev = Infinity;
      for (const wo of scleraOffsets) {
        const d = Math.max(Math.abs(x - (wo % 64)), Math.abs(y - Math.floor(wo / 64)));
        if (d < minChebyshev) minChebyshev = d;
      }
      if (minChebyshev <= 3) inkOffsets.push(offset);
    }
  }

  const combined = Array.from(new Set([...scleraOffsets, ...inkOffsets]));
  const combXs = combined.map((o) => o % 64);
  const combYs = combined.map((o) => Math.floor(o / 64));
  const evCenterX = (Math.min(...combXs) + Math.max(...combXs)) / 2;
  const evCenterY = (Math.min(...combYs) + Math.max(...combYs)) / 2;

  const predW = predBbox[2] - predBbox[0] + 1;
  const predH = predBbox[3] - predBbox[1] + 1;
  const finalBbox = centeredBbox(evCenterX, evCenterY, predW, predH);

  const detectedCenterY = whiteYs.reduce((a, b) => a + b, 0) / whiteYs.length;
  const confidence =
    0.2 +
    Math.min(1.0, scleraOffsets.length / 8) * 0.3 +
    Math.min(1.0, inkOffsets.length / 16) * 0.25 +
    Math.max(0.0, 1 - Math.abs(detectedCenterY - eyeLineY) / 5) * 0.25;

  return {
    bbox: finalBbox,
    searchBbox,
    status: 'sclera_ink',
    confidence,
    scleraOffsets,
    inkOffsets,
    centerX: evCenterX,
    centerY: evCenterY,
  };
}

function anchorEyeToHighlight(eye: EyeRegionResult, hlCenter: [number, number]): EyeRegionResult {
  const cx = Math.min(hlCenter[0] + 1, Math.max(hlCenter[0] - 1, eye.centerX));
  const cy = Math.min(hlCenter[1] + 1, Math.max(hlCenter[1] - 1, eye.centerY));
  const width = eye.bbox[2] - eye.bbox[0] + 1;
  const height = eye.bbox[3] - eye.bbox[1] + 1;
  return {
    ...eye,
    bbox: centeredBbox(cx, cy, width, height),
    centerX: cx,
    centerY: cy,
  };
}

/* =========================================================================
 * Hair Palette Analysis
 * ========================================================================= */

const HAIR_PALETTE_MODEL = {
  minimumExactColorPixels: 2,
  maximumOklabDistance: 0.04,
  seedHorizontalPadding: 4,
  seedVerticalPadding: 4,
  seedEyeLineExtension: 1,
};

export interface HairColorEntry {
  rgb: Rgb;
  role: 'highlight' | 'shadow' | 'base';
  pixelCount: number;
  oklabCenter: Lab;
}

export interface HairPaletteAnalysis {
  entries: HairColorEntry[];
  hairMask: boolean[];
  seedBbox: [number, number, number, number];
  confidence: number;
}

export function analyzeHairPalette(
  pixels: Rgb[],
  exteriorWhite: boolean[],
  outlineColors: Rgb[],
  faceOutlineBbox: [number, number, number, number],
  eyeLineY: number,
  eyeOffsets: Set<number>
): HairPaletteAnalysis {
  const [left, top, right] = faceOutlineBbox;
  const hPad = HAIR_PALETTE_MODEL.seedHorizontalPadding;
  const vPad = HAIR_PALETTE_MODEL.seedVerticalPadding;
  const seedBbox: [number, number, number, number] = [
    Math.max(0, left - hPad),
    Math.max(0, top - vPad),
    Math.min(63, right + hPad),
    Math.min(63, eyeLineY + HAIR_PALETTE_MODEL.seedEyeLineExtension),
  ];

  const outlineHexSet = new Set(outlineColors.map((c) => `${c[0]},${c[1]},${c[2]}`));
  const seedOffsets = new Set<number>();
  const counts = new Map<string, { count: number; rgb: Rgb }>();

  for (let y = seedBbox[1]; y <= seedBbox[3]; y++) {
    for (let x = seedBbox[0]; x <= seedBbox[2]; x++) {
      const offset = y * 64 + x;
      const color = pixels[offset];
      const key = `${color[0]},${color[1]},${color[2]}`;
      if (exteriorWhite[offset] || eyeOffsets.has(offset) || outlineHexSet.has(key) || isFaceSkin(color)) {
        continue;
      }
      seedOffsets.add(offset);
      const item = counts.get(key) || { count: 0, rgb: color };
      item.count++;
      counts.set(key, item);
    }
  }

  const qualifying = Array.from(counts.values())
    .filter((v) => v.count >= HAIR_PALETTE_MODEL.minimumExactColorPixels)
    .sort((a, b) => b.count - a.count);

  if (qualifying.length === 0) {
    return {
      entries: [],
      hairMask: new Array<boolean>(PIXEL_COUNT).fill(false),
      seedBbox,
      confidence: 0.0,
    };
  }

  const dominantLab = rgbToOklab(qualifying[0].rgb);
  const entries: HairColorEntry[] = qualifying.map(({ rgb, count }) => {
    const lab = rgbToOklab(rgb);
    const role: 'highlight' | 'shadow' | 'base' =
      lab[0] >= dominantLab[0] + 0.08 ? 'highlight' : lab[0] <= dominantLab[0] - 0.08 ? 'shadow' : 'base';
    return { rgb, role, pixelCount: count, oklabCenter: lab };
  });

  const maxDist = HAIR_PALETTE_MODEL.maximumOklabDistance;
  const allowed = new Array<boolean>(PIXEL_COUNT);
  for (let offset = 0; offset < PIXEL_COUNT; offset++) {
    if (exteriorWhite[offset]) {
      allowed[offset] = false;
      continue;
    }
    const color = pixels[offset];
    const lab = rgbToOklab(color);
    allowed[offset] = entries.some(
      (e) =>
        (color[0] === e.rgb[0] && color[1] === e.rgb[1] && color[2] === e.rgb[2]) ||
        oklabDistance(lab, e.oklabCenter) <= maxDist
    );
  }

  const hairOffsets = new Set<number>();
  for (const comp of connectedComponents(allowed, true)) {
    if (comp.some((offset) => seedOffsets.has(offset))) {
      comp.forEach((offset) => hairOffsets.add(offset));
    }
  }

  const hairMask = new Array<boolean>(PIXEL_COUNT);
  for (let i = 0; i < PIXEL_COUNT; i++) {
    hairMask[i] = hairOffsets.has(i);
  }

  const confidence = Math.min(1.0, seedOffsets.size / 20) * Math.min(1.0, entries.length / 3);

  return {
    entries,
    hairMask,
    seedBbox,
    confidence,
  };
}

function bottomExposedOffsets(pixels: Rgb[], exteriorWhite: boolean[], hairPalette: HairPaletteAnalysis): number[] {
  const exposed: number[] = [];
  const maxDist = HAIR_PALETTE_MODEL.maximumOklabDistance;

  for (let y = 61; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const offset = y * 64 + x;
      if (exteriorWhite[offset]) continue;
      const c = pixels[offset];
      const clab = rgbToOklab(c);
      const isHair = hairPalette.entries.some(
        (e) =>
          (c[0] === e.rgb[0] && c[1] === e.rgb[1] && c[2] === e.rgb[2]) ||
          oklabDistance(clab, e.oklabCenter) <= maxDist
      );
      if (isHair) continue;

      let touchesBg = false;
      for (const nb of getNeighbours(offset, false)) {
        if (exteriorWhite[nb]) {
          touchesBg = true;
          break;
        }
      }
      if (touchesBg) exposed.push(offset);
    }
  }
  return exposed;
}

/* =========================================================================
 * Geometry Pre-Judge & Face Geometry Analysis
 * ========================================================================= */

function longestRun(values: boolean[]): number {
  let longest = 0;
  let current = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i]) {
      current++;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest;
}

export interface GeometryAnalysis {
  decision: 'pass' | 'reject' | 'uncertain';
  reasons: string[];
  features: Record<string, any>;
  background: Record<string, any>;
  foregroundMask: boolean[];
  outline: PixelOutlineAnalysis;
}

export class GeometryPreJudge {
  public analyzeImage(pixels: Rgb[]): GeometryAnalysis {
    const estimate = estimateBackground(pixels);
    const bgMask = estimate.backgroundMask;
    const fgMask = estimate.foregroundMask;
    const bgCount = bgMask.filter(Boolean).length;

    const fgOffsets: number[] = [];
    let nonwhiteBgCount = 0;
    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (fgMask[i]) fgOffsets.push(i);
      if (bgMask[i] && (pixels[i][0] !== 255 || pixels[i][1] !== 255 || pixels[i][2] !== 255)) {
        nonwhiteBgCount++;
      }
    }

    const outline = analyzePixelOutline(pixels, bgMask, fgMask);
    const backgroundData = {
      rgb: estimate.rgb,
      oklab_threshold: estimate.threshold,
      border_cluster_spread: estimate.clusterSpread,
      border_cluster_fraction: estimate.borderClusterFraction,
      connected_pixel_count: bgCount,
      nonwhite_connected_pixel_count: nonwhiteBgCount,
    };

    if (fgOffsets.length === 0) {
      return {
        decision: 'uncertain',
        reasons: ['foreground_missing'],
        features: {},
        background: backgroundData,
        foregroundMask: fgMask,
        outline,
      };
    }

    const xs = fgOffsets.map((o) => o % 64);
    const ys = fgOffsets.map((o) => Math.floor(o / 64));
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);

    const edgeValues = {
      top: Array.from({ length: 64 }, (_, x) => fgMask[x]),
      bottom: Array.from({ length: 64 }, (_, x) => fgMask[63 * 64 + x]),
      left: Array.from({ length: 64 }, (_, y) => fgMask[y * 64]),
      right: Array.from({ length: 64 }, (_, y) => fgMask[y * 64 + 63]),
    };

    const edgeCounts = {
      top: edgeValues.top.filter(Boolean).length,
      bottom: edgeValues.bottom.filter(Boolean).length,
      left: edgeValues.left.filter(Boolean).length,
      right: edgeValues.right.filter(Boolean).length,
    };

    const edgeRuns = {
      top: longestRun(edgeValues.top),
      bottom: longestRun(edgeValues.bottom),
      left: longestRun(edgeValues.left),
      right: longestRun(edgeValues.right),
    };

    const contentEdgeValues = {
      top: Array.from({ length: 64 }, (_, x) => fgMask[x] && !outline.outlineMask[x]),
      left_upper: Array.from({ length: 32 }, (_, y) => fgMask[y * 64] && !outline.outlineMask[y * 64]),
      right_upper: Array.from({ length: 32 }, (_, y) => fgMask[y * 64 + 63] && !outline.outlineMask[y * 64 + 63]),
    };

    const contentEdgeCounts = {
      top: contentEdgeValues.top.filter(Boolean).length,
      left_upper: contentEdgeValues.left_upper.filter(Boolean).length,
      right_upper: contentEdgeValues.right_upper.filter(Boolean).length,
    };

    const contentEdgeRuns = {
      top: longestRun(contentEdgeValues.top),
      left_upper: longestRun(contentEdgeValues.left_upper),
      right_upper: longestRun(contentEdgeValues.right_upper),
    };

    const rowWidths: number[] = [];
    for (let y = 0; y < 64; y++) {
      let rMin = 64;
      let rMax = -1;
      for (let x = 0; x < 64; x++) {
        if (fgMask[y * 64 + x]) {
          if (x < rMin) rMin = x;
          if (x > rMax) rMax = x;
        }
      }
      rowWidths.push(rMax >= 0 ? rMax - rMin + 1 : 0);
    }

    const fgComponents = connectedComponents(fgMask, false);
    const smallComponents = fgComponents.filter((c) => c.length <= 4).length;
    const foregroundRatio = fgOffsets.length / PIXEL_COUNT;

    const features = {
      margin_top: top,
      margin_bottom: 63 - bottom,
      margin_left: left,
      margin_right: 63 - right,
      bbox_width: right - left + 1,
      bbox_height: bottom - top + 1,
      bbox_width_ratio: (right - left + 1) / 64,
      bbox_height_ratio: (bottom - top + 1) / 64,
      foreground_ratio: foregroundRatio,
      centroid_x: xs.reduce((a, b) => a + b, 0) / xs.length / 63,
      centroid_y: ys.reduce((a, b) => a + b, 0) / ys.length / 63,
      top_edge_count: edgeCounts.top,
      bottom_edge_count: edgeCounts.bottom,
      left_edge_count: edgeCounts.left,
      right_edge_count: edgeCounts.right,
      top_edge_longest_run: edgeRuns.top,
      bottom_edge_longest_run: edgeRuns.bottom,
      left_edge_longest_run: edgeRuns.left,
      right_edge_longest_run: edgeRuns.right,
      top_content_edge_count: contentEdgeCounts.top,
      top_content_edge_longest_run: contentEdgeRuns.top,
      left_upper_content_edge_count: contentEdgeCounts.left_upper,
      right_upper_content_edge_count: contentEdgeCounts.right_upper,
      left_upper_content_edge_longest_run: contentEdgeRuns.left_upper,
      right_upper_content_edge_longest_run: contentEdgeRuns.right_upper,
      outline_colors: outline.outlineColors,
      outline_candidate_count: outline.candidateMask.filter(Boolean).length,
      outline_pixel_count: outline.outlineMask.filter(Boolean).length,
      row_widths: rowWidths,
      upper_width_mean: rowWidths.slice(0, 22).reduce((a, b) => a + b, 0) / 22,
      middle_width_mean: rowWidths.slice(22, 44).reduce((a, b) => a + b, 0) / 22,
      lower_width_mean: rowWidths.slice(44).reduce((a, b) => a + b, 0) / 20,
      component_count: fgComponents.length,
      small_component_count: smallComponents,
      nonwhite_background_pixel_count: nonwhiteBgCount,
    };

    const bgBorderMatches = borderOffsets().filter((off) => bgMask[off]).length;
    const bgUncertain =
      estimate.borderClusterFraction < 0.15 ||
      estimate.clusterSpread > 0.1 ||
      bgCount < 64 ||
      bgBorderMatches < 16;

    if (bgUncertain) {
      return {
        decision: 'uncertain',
        reasons: ['background_uncertain'],
        features,
        background: backgroundData,
        foregroundMask: fgMask,
        outline,
      };
    }

    const reasons: string[] = [];
    if (nonwhiteBgCount > 0) reasons.push('background_not_white');
    if (features.margin_bottom > 0) reasons.push('bottom_gap');
    if (contentEdgeCounts.top >= 3 && contentEdgeRuns.top >= 2) reasons.push('top_cropped');
    if (Math.max(contentEdgeRuns.left_upper, contentEdgeRuns.right_upper) >= 16) reasons.push('side_cropped');
    if (foregroundRatio >= 0.9) reasons.push('foreground_too_large');
    else if (foregroundRatio <= 0.18) reasons.push('foreground_too_small');

    return {
      decision: reasons.length > 0 ? 'reject' : 'pass',
      reasons,
      features,
      background: backgroundData,
      foregroundMask: fgMask,
      outline,
    };
  }
}

export interface FaceGeometryAnalysis {
  decision: 'pass' | 'reject' | 'uncertain';
  reasons: string[];
  features: Record<string, any>;
  faceMask: boolean[];
  exteriorWhiteMask: boolean[];
  faceModelMask: boolean[] | null;
  hairMask: boolean[] | null;
  hairPalette: HairPaletteAnalysis | null;
}

export class FaceGeometryJudge {
  public analyzeImage(pixels: Rgb[], outline?: PixelOutlineAnalysis): FaceGeometryAnalysis {
    const skinMask = pixels.map(isFaceSkin);
    const exterior = exteriorWhiteMask(pixels);

    if (!outline) {
      const bg = estimateBackground(pixels);
      outline = analyzePixelOutline(pixels, bg.backgroundMask, bg.foregroundMask);
    }

    const candidates = connectedComponents(skinMask, true)
      .filter((comp) => {
        const topY = Math.min(...comp.map((o) => Math.floor(o / 64)));
        return comp.length >= 60 && topY <= 54;
      })
      .sort((a, b) => b.length - a.length);

    if (candidates.length === 0) {
      return this.uncertain('face_not_found', exterior);
    }

    const component = candidates[0];
    const secondComponent = candidates.length > 1 ? candidates[1] : null;
    const secondRatio = secondComponent ? secondComponent.length / component.length : 0.0;

    const counts: number[] = Array.from({ length: 64 }, (_, y) =>
      component.filter((o) => Math.floor(o / 64) === y).length
    );

    const smoothed: number[] = [];
    for (let y = 0; y < 64; y++) {
      const window = counts.slice(Math.max(0, y - 1), Math.min(64, y + 2));
      smoothed.push(median(window));
    }

    const peak = Math.max(...smoothed);
    const wideThreshold = Math.max(7.0, peak * 0.55);
    const wideRows: number[] = [];
    smoothed.forEach((val, y) => {
      if (val >= wideThreshold) wideRows.push(y);
    });

    const segments: number[][] = [];
    let curSeg: number[] = [];
    for (const row of wideRows) {
      if (curSeg.length > 0 && row > curSeg[curSeg.length - 1] + 1) {
        segments.push(curSeg);
        curSeg = [];
      }
      curSeg.push(row);
    }
    if (curSeg.length > 0) segments.push(curSeg);

    if (segments.length === 0) {
      return this.uncertain('face_core_not_found', exterior);
    }

    segments.sort(
      (a, b) =>
        b.reduce((acc, r) => acc + counts[r], 0) - a.reduce((acc, r) => acc + counts[r], 0)
    );
    const core = segments[0];
    let faceTop = core[0];
    let faceBottom = core[core.length - 1];

    const lowThreshold = Math.max(3.0, peak * 0.28);
    while (faceTop > 0 && smoothed[faceTop - 1] >= lowThreshold) faceTop--;
    while (faceBottom < 63 && smoothed[faceBottom + 1] >= lowThreshold) faceBottom++;

    const faceOffsets = component.filter((o) => {
      const y = Math.floor(o / 64);
      return y >= faceTop && y <= faceBottom;
    });

    if (faceOffsets.length < 80 || faceBottom - faceTop + 1 < 8) {
      return this.uncertain('face_core_too_weak', exterior);
    }

    const faceXs = faceOffsets.map((o) => o % 64);
    const faceYs = faceOffsets.map((o) => Math.floor(o / 64));
    const faceLeft = percentileInt(faceXs, 0.05);
    const faceRight = percentileInt(faceXs, 0.95);
    const faceWidth = faceRight - faceLeft + 1;
    const faceHeight = faceBottom - faceTop + 1;
    const faceCenterX = faceXs.reduce((a, b) => a + b, 0) / faceXs.length;
    const faceCenterY = faceYs.reduce((a, b) => a + b, 0) / faceYs.length;

    const faceRowWidths: number[] = [];
    for (let y = faceTop; y <= faceBottom; y++) {
      const rowXs = faceOffsets.filter((o) => Math.floor(o / 64) === y).map((o) => o % 64);
      if (rowXs.length > 0) {
        faceRowWidths.push(Math.max(...rowXs) - Math.min(...rowXs) + 1);
      }
    }

    const outlineAnchorWidth = median(faceRowWidths);
    const outlineCenterX = median(faceXs);
    const baseOutlineWidth = Math.max(
      FACE_OUTLINE_MODEL.minimumWidth,
      Math.min(
        FACE_OUTLINE_MODEL.maximumWidth,
        Math.round(outlineAnchorWidth * FACE_OUTLINE_MODEL.medianRowWidthScale)
      )
    );
    const geometryEyeLineY =
      faceTop + Math.round((faceHeight - 1) * FACE_OUTLINE_MODEL.eyeLineFromFaceTop);
    const outlineHeight = Math.round(baseOutlineWidth * FACE_OUTLINE_MODEL.heightToWidth);
    let outlineBottom = Math.min(63, faceBottom + FACE_OUTLINE_MODEL.chinPadding);
    let outlineTop = Math.max(0, outlineBottom - outlineHeight + 1);
    let outlineLeft = Math.max(
      0,
      Math.round(outlineCenterX - (baseOutlineWidth - 1) / 2) - FACE_OUTLINE_MODEL.leftEyePadding
    );
    let outlineRight = Math.min(
      63,
      Math.round(outlineCenterX - (baseOutlineWidth - 1) / 2) + baseOutlineWidth - 1
    );

    const eyeWidth = Math.max(
      FACE_OUTLINE_MODEL.minimumEyeWidth,
      Math.min(
        FACE_OUTLINE_MODEL.maximumEyeWidth,
        Math.round(outlineAnchorWidth * FACE_OUTLINE_MODEL.eyeWidthScale)
      )
    );
    const eyeSeparation = Math.max(
      (eyeWidth + 1) / 2,
      outlineAnchorWidth * FACE_OUTLINE_MODEL.eyeCenterSeparationScale
    );
    const eyeHeight = Math.max(
      FACE_OUTLINE_MODEL.minimumEyeHeight,
      Math.min(
        FACE_OUTLINE_MODEL.maximumEyeHeight,
        Math.round(faceHeight * FACE_OUTLINE_MODEL.eyeHeightScale)
      )
    );

    let finalOutlineCenterX = (outlineLeft + outlineRight) / 2;
    const predLeftX = finalOutlineCenterX - eyeSeparation;
    const predRightX = finalOutlineCenterX + eyeSeparation;
    const outlineBbox: [number, number, number, number] = [outlineLeft, outlineTop, outlineRight, outlineBottom];

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

    const detectedSeparation = rightEye.centerX - leftEye.centerX;
    if (detectedSeparation < eyeWidth) {
      leftEye = {
        bbox: predLeftEyeBbox,
        searchBbox: leftEye.searchBbox,
        status: 'fallback_geometry',
        confidence: 0.15,
        scleraOffsets: [],
        inkOffsets: [],
        centerX: predLeftX,
        centerY: eyeLineY,
      };
      highlightPair = null;
      rightEye = {
        bbox: predRightEyeBbox,
        searchBbox: rightEye.searchBbox,
        status: 'fallback_geometry',
        confidence: 0.15,
        scleraOffsets: [],
        inkOffsets: [],
        centerX: predRightX,
        centerY: eyeLineY,
      };
    }

    const bothPixelDetected = leftEye.status === 'sclera_ink' && rightEye.status === 'sclera_ink';
    const pairAlignment = Math.max(
      0.0,
      1 - Math.abs(leftEye.centerY - rightEye.centerY) / EYE_DETECTION_MODEL.maximumPairYDelta
    );
    let eyePairConfidence =
      Math.min(leftEye.confidence, rightEye.confidence) * (0.75 + pairAlignment * 0.25);
    if (highlightPair && bothPixelDetected) {
      eyePairConfidence = Math.min(1.0, eyePairConfidence + 0.08);
    }

    const eyeDetectionStatus =
      highlightPair && bothPixelDetected && eyePairConfidence >= EYE_DETECTION_MODEL.pairConfidenceThreshold
        ? 'paired_highlight_sclera_ink'
        : bothPixelDetected && eyePairConfidence >= EYE_DETECTION_MODEL.pairConfidenceThreshold
        ? 'paired_sclera_ink'
        : bothPixelDetected
        ? 'paired_low_confidence'
        : 'geometry_fallback';

    let appliedLeftEyePadding = FACE_OUTLINE_MODEL.leftEyePadding;
    if (eyeDetectionStatus !== 'geometry_fallback') {
      appliedLeftEyePadding = neededLeftEyePadding(outlineLeft, leftEye.bbox);
      outlineLeft += FACE_OUTLINE_MODEL.leftEyePadding - appliedLeftEyePadding;
      finalOutlineCenterX = (outlineLeft + outlineRight) / 2;
    }

    const initialOutlineBbox: [number, number, number, number] = [
      outlineLeft,
      outlineTop,
      outlineRight,
      outlineBottom,
    ];
    let faceOutlineLinkStatus = 'eye_evidence_unavailable';
    let outlineShiftX = 0;
    let outlineShiftY = 0;

    if (
      eyeDetectionStatus !== 'geometry_fallback' &&
      eyePairConfidence >= EYE_DETECTION_MODEL.pairConfidenceThreshold
    ) {
      const eyeMidpointX = (leftEye.centerX + rightEye.centerX) / 2;
      const eyeMidpointY = (leftEye.centerY + rightEye.centerY) / 2;
      const reqErrX = eyeMidpointX - (outlineLeft + outlineRight) / 2;
      const reqErrY =
        eyeMidpointY - (outlineTop + (outlineHeight - 1) * FACE_OUTLINE_MODEL.linkedEyeHeightRatio);

      if (
        Math.abs(reqErrX) <= FACE_OUTLINE_MODEL.linkedMaxAnchorError &&
        Math.abs(reqErrY) <= FACE_OUTLINE_MODEL.linkedMaxAnchorError
      ) {
        const reqShiftX = deadZoneShift(reqErrX, FACE_OUTLINE_MODEL.linkedHorizontalDeadZone);
        const reqShiftY = deadZoneShift(reqErrY, FACE_OUTLINE_MODEL.linkedVerticalDeadZone);
        outlineShiftX = Math.max(
          -FACE_OUTLINE_MODEL.linkedMaxHorizontalShift,
          Math.min(FACE_OUTLINE_MODEL.linkedMaxHorizontalShift, reqShiftX)
        );
        outlineShiftY = Math.max(
          -Math.min(FACE_OUTLINE_MODEL.linkedMaxVerticalShift, outlineBottom - faceBottom),
          Math.min(FACE_OUTLINE_MODEL.linkedMaxVerticalShift, reqShiftY)
        );
        outlineShiftX = Math.max(-outlineLeft, Math.min(63 - outlineRight, outlineShiftX));
        outlineShiftY = Math.max(-outlineTop, Math.min(63 - outlineBottom, outlineShiftY));

        outlineLeft += outlineShiftX;
        outlineRight += outlineShiftX;
        outlineTop += outlineShiftY;
        outlineBottom += outlineShiftY;
        finalOutlineCenterX = (outlineLeft + outlineRight) / 2;
        faceOutlineLinkStatus =
          outlineShiftX || outlineShiftY ? 'linked_to_eyes' : 'within_eye_tolerance';
      } else {
        faceOutlineLinkStatus = 'eye_anchor_outlier';
      }
    }

    const eyeOffsets = new Set<number>([
      ...leftEye.scleraOffsets,
      ...rightEye.scleraOffsets,
      ...leftEye.inkOffsets,
      ...rightEye.inkOffsets,
      ...(highlightPair ? highlightPair.offsets : []),
    ]);

    const hairPalette = analyzeHairPalette(
      pixels,
      exterior,
      outline.outlineColors,
      [outlineLeft, outlineTop, outlineRight, outlineBottom],
      eyeLineY,
      eyeOffsets
    );

    const exposedOffsets = bottomExposedOffsets(pixels, exterior, hairPalette);

    const faceEgg = fitFaceEgg(
      faceOffsets,
      [leftEye.centerX, leftEye.centerY],
      [rightEye.centerX, rightEye.centerY],
      faceBottom,
      exterior
    );

    const [eggLeft, eggTop, eggRight, eggBottom] = faceEgg.bbox;
    const eggWidth = eggRight - eggLeft + 1;
    const eggHeight = eggBottom - eggTop + 1;
    const eggCenterX = (eggLeft + eggRight) / 2;
    const eggCenterY = (eggTop + eggBottom) / 2;
    const ambiguityBandBottom = faceBottom + Math.max(2, Math.round(faceHeight * 0.25));

    let ambiguityStatus = 'none';
    const primaryEyeConfirmed =
      eyeDetectionStatus.startsWith('paired_') && eyePairConfidence >= 0.75;

    let competingRatio = 0.0;
    for (let i = 1; i < candidates.length; i++) {
      const cand = candidates[i];
      const ys = cand.map((o) => Math.floor(o / 64));
      const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
      if (cy <= ambiguityBandBottom) {
        const r = cand.length / component.length;
        if (r > competingRatio) competingRatio = r;
      }
    }

    if (competingRatio >= 0.72) {
      ambiguityStatus = 'competing_face_height';
    } else if (secondRatio >= 0.72) {
      ambiguityStatus = primaryEyeConfirmed
        ? 'resolved_below_face_with_confirmed_eyes'
        : 'resolved_below_face';
    }

    const faceSet = new Set(faceOffsets);
    const faceMask = new Array<boolean>(PIXEL_COUNT);
    for (let i = 0; i < PIXEL_COUNT; i++) faceMask[i] = faceSet.has(i);

    const features: Record<string, any> = {
      face_bbox: faceEgg.bbox,
      visible_skin_bbox: [faceLeft, faceTop, faceRight, faceBottom],
      face_outline_bbox: faceEgg.bbox,
      face_outline_initial_bbox: initialOutlineBbox,
      face_outline_link_status: faceOutlineLinkStatus,
      face_outline_shift_x: outlineShiftX,
      face_outline_shift_y: outlineShiftY,
      face_outline_left_eye_padding: appliedLeftEyePadding,
      face_outline_width: eggWidth,
      face_outline_height: eggHeight,
      face_outline_anchor_width: outlineAnchorWidth,
      face_outline_center_x: eggCenterX,
      face_outline_asymmetry: faceEgg.asymmetry,
      face_outline_shear_x: faceEgg.shearX,
      face_egg: faceEgg,
      eye_line_y: eyeLineY,
      left_eye_bbox: leftEye.bbox,
      right_eye_bbox: rightEye.bbox,
      left_eye_search_bbox: leftEye.searchBbox,
      right_eye_search_bbox: rightEye.searchBbox,
      left_eye_status: leftEye.status,
      right_eye_status: rightEye.status,
      left_eye_confidence: leftEye.confidence,
      right_eye_confidence: rightEye.confidence,
      left_eye_center_x: leftEye.centerX,
      left_eye_center_y: leftEye.centerY,
      right_eye_center_x: rightEye.centerX,
      right_eye_center_y: rightEye.centerY,
      eye_pair_confidence: eyePairConfidence,
      eye_detection_status: eyeDetectionStatus,
      eye_sclera_offsets: Array.from(
        new Set([...leftEye.scleraOffsets, ...rightEye.scleraOffsets])
      ).sort((a, b) => a - b),
      eye_ink_offsets: Array.from(new Set([...leftEye.inkOffsets, ...rightEye.inkOffsets])).sort(
        (a, b) => a - b
      ),
      eye_highlight_offsets: highlightPair ? highlightPair.offsets : [],
      eye_highlight_pair_status: highlightPair ? 'paired' : 'not_found',
      left_eye_highlight_center: highlightPair ? highlightPair.leftCenter : null,
      right_eye_highlight_center: highlightPair ? highlightPair.rightCenter : null,
      eye_region_width: eyeWidth,
      eye_region_height: eyeHeight,
      face_width: eggWidth,
      face_height: eggHeight,
      visible_skin_width: faceWidth,
      visible_skin_height: faceHeight,
      visible_skin_center_x: faceCenterX,
      visible_skin_center_y: faceCenterY,
      face_center_x: eggCenterX,
      face_center_y: eggCenterY,
      chin_y: eggBottom,
      visible_body_height: 63 - eggBottom,
      skin_component_area: component.length,
      face_core_area: faceOffsets.length,
      face_ambiguity_status: ambiguityStatus,
      primary_eye_confirmed: primaryEyeConfirmed,
      hair_color_dictionary: hairPalette,
      bottom_exposed_offsets: exposedOffsets,
      bottom_exposed_count: exposedOffsets.length,
    };

    if (ambiguityStatus === 'competing_face_height') {
      return {
        decision: 'uncertain',
        reasons: ['face_ambiguous'],
        features,
        faceMask,
        exteriorWhiteMask: exterior,
        faceModelMask: faceEgg.mask,
        hairMask: hairPalette.hairMask,
        hairPalette,
      };
    }

    const reasons: string[] = [];
    if (eggTop <= 24 || eggCenterY < 32.0 || eggBottom <= 38) reasons.push('face_too_high');
    if (eggTop >= 41 || eggCenterY > 42.0) reasons.push('face_too_low');
    if (eggHeight >= 29) reasons.push('face_too_large');
    if (!faceEgg.reliable) reasons.push('face_model_unreliable');

    if (reasons.length > 0) {
      return {
        decision: 'reject',
        reasons: Array.from(new Set(reasons)),
        features,
        faceMask,
        exteriorWhiteMask: exterior,
        faceModelMask: faceEgg.mask,
        hairMask: hairPalette.hairMask,
        hairPalette,
      };
    }

    const nearBoundary =
      [25, 26, 39, 40].includes(eggTop) ||
      eggCenterY < 33 ||
      eggCenterY > 41 ||
      eggHeight === 19 ||
      [39, 49].includes(eggBottom);

    return {
      decision: nearBoundary ? 'uncertain' : 'pass',
      reasons: nearBoundary ? ['near_geometry_boundary'] : [],
      features,
      faceMask,
      exteriorWhiteMask: exterior,
      faceModelMask: faceEgg.mask,
      hairMask: hairPalette.hairMask,
      hairPalette,
    };
  }

  private uncertain(reason: string, exterior: boolean[]): FaceGeometryAnalysis {
    return {
      decision: 'uncertain',
      reasons: [reason],
      features: {
        face_bbox: null,
        eye_line_y: null,
        chin_y: null,
        visible_body_height: null,
        eye_sclera_offsets: [],
        eye_ink_offsets: [],
        eye_highlight_offsets: [],
        bottom_exposed_count: null,
      },
      faceMask: new Array<boolean>(PIXEL_COUNT).fill(false),
      exteriorWhiteMask: exterior,
      faceModelMask: null,
      hairMask: null,
      hairPalette: null,
    };
  }
}

/* =========================================================================
 * Strict Geometry Gate
 * ========================================================================= */

function clampSeverity(val: number): number {
  return Math.max(0.0, Math.min(1.0, val));
}

function severityBelow(val: number | null, healthy: number, full: number): number {
  if (val === null || val === undefined) return 1.0;
  if (val >= healthy) return 0.0;
  return clampSeverity((healthy - val) / (healthy - full));
}

function severityAbove(val: number | null, healthy: number, full: number): number {
  if (val === null || val === undefined) return 1.0;
  if (val <= healthy) return 0.0;
  return clampSeverity((val - healthy) / (full - healthy));
}

function bodyTooShortSeverity(val: number | null): number {
  if (val === null || val === undefined) return 1.0;
  if (val >= 17) return 0.0;
  if (val >= 15) return val === 16 ? 0.08 : 0.16;
  if (val >= 12) return clampSeverity(((15.0 - val) / 3.0) * 0.84 + 0.16);
  return 1.0;
}

export interface GeometryGateCheck {
  checkId: string;
  reason: string | null;
  severity: number;
  weight: number;
  penalty: number;
}

export interface GeometryGateAnalysis {
  decision: 'pass' | 'reject';
  reasons: string[];
  score: number;
  checks: GeometryGateCheck[];
  outer: GeometryAnalysis;
  face: FaceGeometryAnalysis;
}

const GATE_WEIGHTS: Record<string, number> = {
  outer_reliability: 100.0,
  background_quality: 45.0,
  bottom_contact: 45.0,
  top_crop: 42.0,
  side_crop: 42.0,
  foreground_scale: 42.0,
  face_reliability: 100.0,
  face_vertical_position: 15.0,
  face_size: 15.0,
  bottom_outline: 45.0,
};

export class StrictGeometryGate {
  private outerJudge = new GeometryPreJudge();
  private faceJudge = new FaceGeometryJudge();

  public analyzeImage(pixels: Rgb[]): GeometryGateAnalysis {
    const outer = this.outerJudge.analyzeImage(pixels);
    const face = this.faceJudge.analyzeImage(pixels, outer.outline);

    const checks: GeometryGateCheck[] = [];
    const add = (checkId: string, reason: string | null, severity: number) => {
      const weight = GATE_WEIGHTS[checkId] || 10.0;
      const s = clampSeverity(severity);
      checks.push({
        checkId,
        reason: s > 0 ? reason : null,
        severity: s,
        weight,
        penalty: Math.round(s * weight * 1000000) / 1000000,
      });
    };

    const outerUncertain = outer.decision === 'uncertain';
    add('outer_reliability', outerUncertain ? `outer_${outer.reasons[0] || 'uncertain'}` : null, outerUncertain ? 1.0 : 0.0);

    const nonwhite = outer.features.nonwhite_background_pixel_count;
    add('background_quality', 'outer_background_not_white', severityAbove(nonwhite, 0, 16));

    const marginBot = outer.features.margin_bottom;
    add('bottom_contact', 'outer_bottom_gap', severityAbove(marginBot, 0, 3));

    const topObs = Math.max(outer.features.top_content_edge_count || 0, outer.features.top_content_edge_longest_run || 0);
    add('top_crop', 'outer_top_cropped', severityAbove(topObs, 2, 20));

    const sideObs = Math.max(
      outer.features.left_upper_content_edge_longest_run || 0,
      outer.features.right_upper_content_edge_longest_run || 0
    );
    add('side_crop', 'outer_side_cropped', severityAbove(sideObs, 15, 32));

    const fgRatio = outer.features.foreground_ratio;
    const tooSmall = severityBelow(fgRatio, 0.18, 0.08);
    const tooLarge = severityAbove(fgRatio, 0.9, 1.0);
    add('foreground_scale', tooSmall >= tooLarge ? 'outer_foreground_too_small' : 'outer_foreground_too_large', Math.max(tooSmall, tooLarge));

    const faceEgg = face.features.face_egg;
    const eggUnreliable = faceEgg && faceEgg.reliable === false;
    const faceUnreliable = eggUnreliable || (face.decision === 'uncertain' && face.reasons.length > 0);
    add('face_reliability', faceUnreliable ? `face_${face.reasons[0] || 'uncertain'}` : null, faceUnreliable ? 1.0 : 0.0);

    const faceTop = face.features.face_bbox ? face.features.face_bbox[1] : null;
    const faceCenterY = face.features.face_center_y;
    const bodyH = face.features.visible_body_height;
    const highSev = Math.max(severityBelow(faceTop, 18, 13), severityBelow(faceCenterY, 29, 25), severityAbove(bodyH, 22, 27));
    const lowSev = Math.max(severityAbove(faceTop, 27, 32), severityAbove(faceCenterY, 38, 43), bodyTooShortSeverity(bodyH));
    add('face_vertical_position', highSev >= lowSev ? 'face_face_too_high' : 'face_face_too_low', Math.max(highSev, lowSev));

    const faceH = face.features.face_height;
    add('face_size', 'face_face_too_large', severityAbove(faceH, 28, 32));

    const botExp = face.features.bottom_exposed_count;
    add('bottom_outline', 'bottom_outline_leak', severityAbove(botExp, 6, 22));

    const totalPenalty = checks.reduce((sum, c) => sum + c.penalty, 0);
    const score = Math.max(0.0, 100.0 - totalPenalty);
    const decision = score >= 60.0 ? 'pass' : 'reject';
    const reasons = Array.from(new Set(checks.filter((c) => c.severity > 0 && c.reason).map((c) => c.reason!)));

    return {
      decision,
      reasons,
      score,
      checks,
      outer,
      face,
    };
  }
}

/* =========================================================================
 * Mouth Detector
 * ========================================================================= */

const MOUTH_DETECTION_MODEL = {
  roiTopEyeChinRatio: 0.55,
  roiBottomEyeChinRatio: 0.9,
  roiHalfWidth: 6,
  minimumSkinNeighbours: 5,
  minimumCandidatePixels: 2,
  minimumHorizontalSpan: 2,
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
      if (nx === x && ny === y) continue;
      if (isFaceSkin(pixels[ny * 64 + nx])) count++;
    }
  }
  return count;
}

export interface MouthDetectionAnalysis {
  decision: 'pass' | 'reject' | 'uncertain';
  reasons: string[];
  features: Record<string, any>;
  candidateOffsets: number[];
  face: FaceGeometryAnalysis;
}

export class MouthDetector {
  private faceJudge = new FaceGeometryJudge();

  public analyzeImage(pixels: Rgb[], face?: FaceGeometryAnalysis): MouthDetectionAnalysis {
    if (!face) face = this.faceJudge.analyzeImage(pixels);

    const f = face.features;
    const req = [f.left_eye_center_x, f.left_eye_center_y, f.right_eye_center_x, f.right_eye_center_y, f.chin_y];
    if (req.some((v) => v === null || v === undefined)) {
      return {
        decision: 'uncertain',
        reasons: ['mouth_anchor_unavailable'],
        features: { mouth_roi: null, mouth_candidate_count: 0, mouth_horizontal_span: 0, mouth_confidence: 0.0 },
        candidateOffsets: [],
        face,
      };
    }

    const eyeCenterX = (f.left_eye_center_x + f.right_eye_center_x) / 2;
    const eyeCenterY = (f.left_eye_center_y + f.right_eye_center_y) / 2;
    const eyeChinH = f.chin_y - eyeCenterY;

    const roiLeft = Math.max(0, Math.round(eyeCenterX) - MOUTH_DETECTION_MODEL.roiHalfWidth);
    const roiRight = Math.min(63, Math.round(eyeCenterX) + MOUTH_DETECTION_MODEL.roiHalfWidth);
    const roiTop = Math.max(0, Math.round(eyeCenterY + eyeChinH * MOUTH_DETECTION_MODEL.roiTopEyeChinRatio));
    let roiBottom = Math.min(Math.round(f.chin_y) - 1, Math.round(eyeCenterY + eyeChinH * MOUTH_DETECTION_MODEL.roiBottomEyeChinRatio));
    roiBottom = Math.max(roiTop, roiBottom);

    const candidateOffsets: number[] = [];
    for (let y = roiTop; y <= roiBottom; y++) {
      for (let x = roiLeft; x <= roiRight; x++) {
        const offset = y * 64 + x;
        if (isMouthColor(pixels[offset]) && skinNeighbourCount(pixels, x, y) >= MOUTH_DETECTION_MODEL.minimumSkinNeighbours) {
          candidateOffsets.push(offset);
        }
      }
    }

    const xs = candidateOffsets.map((o) => o % 64);
    const count = candidateOffsets.length;
    const horizontalSpan = xs.length > 0 ? Math.max(...xs) - Math.min(...xs) + 1 : 0;

    const reasons: string[] = [];
    if (count === 0) reasons.push('mouth_missing');
    else if (count < MOUTH_DETECTION_MODEL.minimumCandidatePixels) reasons.push('mouth_single_pixel');
    else if (horizontalSpan < MOUTH_DETECTION_MODEL.minimumHorizontalSpan) reasons.push('mouth_no_horizontal_structure');

    const confidence = Math.min(1.0, (count / 3) * 0.6 + (horizontalSpan / 4) * 0.4);

    return {
      decision: reasons.length > 0 ? 'reject' : 'pass',
      reasons,
      features: {
        mouth_roi: [roiLeft, roiTop, roiRight, roiBottom],
        mouth_candidate_count: count,
        mouth_horizontal_span: horizontalSpan,
        mouth_confidence: confidence,
        eye_center_x: eyeCenterX,
        eye_center_y: eyeCenterY,
        chin_y: f.chin_y,
      },
      candidateOffsets,
      face,
    };
  }
}

/* =========================================================================
 * Semantic Regions & Residuals
 * ========================================================================= */

function looksLikeExpressionColor(color: Rgb): boolean {
  const [red, green, blue] = color;
  return red >= 150 && red - green >= 25 && red - blue >= 12;
}

export interface SemanticRegionAnalysis {
  outlineMask: boolean[];
  eyeMask: boolean[];
  mouthExpressionMask: boolean[];
  faceSkinMask: boolean[];
  bodySkinMask: boolean[];
  hairMask: boolean[];
  clothingMask: boolean[];
  otherMask: boolean[];
}

export function analyzeSemanticRegions(
  pixels: Rgb[],
  geometry: GeometryGateAnalysis,
  mouth: MouthDetectionAnalysis
): SemanticRegionAnalysis {
  const claimed = new Set<number>();

  const outline = new Set<number>();
  geometry.outer.outline.outlineMask.forEach((enabled, i) => {
    if (enabled) outline.add(i);
  });
  outline.forEach((o) => claimed.add(o));

  const f = geometry.face.features;
  const eyes = new Set<number>([
    ...(f.eye_sclera_offsets || []),
    ...(f.eye_ink_offsets || []),
    ...(f.eye_highlight_offsets || []),
  ]);
  for (const o of claimed) eyes.delete(o);
  eyes.forEach((o) => claimed.add(o));

  let mouthExpression = new Set<number>(mouth.candidateOffsets);
  for (const o of claimed) mouthExpression.delete(o);

  const roi = mouth.features.mouth_roi;
  if (mouthExpression.size > 0 && Array.isArray(roi) && roi.length === 4) {
    const [left, top, right, bottom] = roi;
    const nearMouth = new Set(mouthExpression);
    for (const offset of mouthExpression) {
      const x = offset % 64;
      const y = Math.floor(offset / 64);
      for (let ny = Math.max(top, y - 1); ny <= Math.min(bottom, y + 1); ny++) {
        for (let nx = Math.max(left, x - 1); nx <= Math.min(right, x + 1); nx++) {
          const cand = ny * 64 + nx;
          if (!claimed.has(cand) && !isFaceSkin(pixels[cand])) {
            nearMouth.add(cand);
          }
        }
      }
    }
    mouthExpression = nearMouth;
  }

  const faceModel = geometry.face.faceModelMask || new Array<boolean>(PIXEL_COUNT).fill(false);
  const eyeLine = f.eye_line_y;
  if (typeof eyeLine === 'number') {
    for (let offset = 0; offset < PIXEL_COUNT; offset++) {
      if (
        faceModel[offset] &&
        Math.floor(offset / 64) >= eyeLine &&
        !claimed.has(offset) &&
        !isFaceSkin(pixels[offset]) &&
        looksLikeExpressionColor(pixels[offset])
      ) {
        mouthExpression.add(offset);
      }
    }
  }
  for (const o of claimed) mouthExpression.delete(o);
  mouthExpression.forEach((o) => claimed.add(o));

  const strictFaceSkin: number[] = [];
  geometry.face.faceMask.forEach((enabled, i) => {
    if (enabled) strictFaceSkin.push(i);
  });
  const skinLabs = strictFaceSkin.map((o) => rgbToOklab(pixels[o]));

  const faceSkin = new Set<number>();
  for (let offset = 0; offset < PIXEL_COUNT; offset++) {
    if (!faceModel[offset] || claimed.has(offset)) continue;
    const color = pixels[offset];
    if (isFaceSkin(color) || skinLabs.some((sl) => oklabDistance(rgbToOklab(color), sl) <= 0.045)) {
      faceSkin.add(offset);
    }
  }

  const faceBbox = f.face_bbox;
  const visibleSkinBbox = f.visible_skin_bbox;
  if (Array.isArray(faceBbox) && faceBbox.length === 4 && faceSkin.size > 0) {
    let [left, top, right, bottom] = faceBbox;
    if (Array.isArray(visibleSkinBbox) && visibleSkinBbox.length === 4) {
      left = Math.min(left, visibleSkinBbox[0]);
      top = Math.min(top, visibleSkinBbox[1]);
      right = Math.max(right, visibleSkinBbox[2]);
      bottom = Math.max(bottom, visibleSkinBbox[3]);
    }
    left = Math.max(0, left - 2);
    top = Math.max(0, top - 1);
    right = Math.min(63, right + 2);
    bottom = Math.min(63, bottom + 1);

    const connectedSkin = new Array<boolean>(PIXEL_COUNT);
    for (let offset = 0; offset < PIXEL_COUNT; offset++) {
      const x = offset % 64;
      const y = Math.floor(offset / 64);
      connectedSkin[offset] =
        x >= left &&
        x <= right &&
        y >= top &&
        y <= bottom &&
        !claimed.has(offset) &&
        (isFaceSkin(pixels[offset]) || skinLabs.some((sl) => oklabDistance(rgbToOklab(pixels[offset]), sl) <= 0.045));
    }

    for (const comp of connectedComponents(connectedSkin, true)) {
      if (comp.some((o) => faceSkin.has(o))) {
        comp.forEach((o) => faceSkin.add(o));
      }
    }
  }
  faceSkin.forEach((o) => claimed.add(o));

  const chin = f.chin_y;
  const bodySkin = new Set<number>();
  if (typeof chin === 'number') {
    for (let offset = 0; offset < PIXEL_COUNT; offset++) {
      if (!geometry.outer.foregroundMask[offset] || Math.floor(offset / 64) <= chin || claimed.has(offset)) {
        continue;
      }
      const color = pixels[offset];
      if (isFaceSkin(color) || skinLabs.some((sl) => oklabDistance(rgbToOklab(color), sl) <= 0.035)) {
        bodySkin.add(offset);
      }
    }
  }
  bodySkin.forEach((o) => claimed.add(o));

  const sourceHair = geometry.face.hairMask || new Array<boolean>(PIXEL_COUNT).fill(false);
  const hair = new Set<number>();
  sourceHair.forEach((enabled, i) => {
    if (enabled && !claimed.has(i)) hair.add(i);
  });

  const toMask = (set: Set<number>) => {
    const arr = new Array<boolean>(PIXEL_COUNT).fill(false);
    set.forEach((o) => (arr[o] = true));
    return arr;
  };

  return {
    outlineMask: toMask(outline),
    eyeMask: toMask(eyes),
    mouthExpressionMask: toMask(mouthExpression),
    faceSkinMask: toMask(faceSkin),
    bodySkinMask: toMask(bodySkin),
    hairMask: toMask(hair),
    clothingMask: new Array<boolean>(PIXEL_COUNT).fill(false),
    otherMask: new Array<boolean>(PIXEL_COUNT).fill(false),
  };
}

export function assignResidualRegions(
  analysis: SemanticRegionAnalysis,
  foregroundMask: boolean[],
  chinY?: number | null
): SemanticRegionAnalysis {
  const claimed = new Array<boolean>(PIXEL_COUNT);
  for (let i = 0; i < PIXEL_COUNT; i++) {
    claimed[i] =
      analysis.outlineMask[i] ||
      analysis.eyeMask[i] ||
      analysis.mouthExpressionMask[i] ||
      analysis.faceSkinMask[i] ||
      analysis.bodySkinMask[i] ||
      analysis.hairMask[i];
  }

  const boundary = typeof chinY === 'number' ? chinY - 1 : 43;
  const lowerResidual = new Array<boolean>(PIXEL_COUNT);
  const other = new Set<number>();
  const clothing = new Set<number>();

  for (let offset = 0; offset < PIXEL_COUNT; offset++) {
    const isFg = foregroundMask[offset];
    const isCl = claimed[offset];
    const y = Math.floor(offset / 64);
    if (isFg && !isCl) {
      if (y >= boundary) {
        lowerResidual[offset] = true;
      } else {
        other.add(offset);
      }
    } else {
      lowerResidual[offset] = false;
    }
  }

  for (const comp of connectedComponents(lowerResidual, true)) {
    const touchesBottom = comp.some((o) => Math.floor(o / 64) === 63);
    if (touchesBottom || comp.length >= 30) {
      comp.forEach((o) => clothing.add(o));
    } else {
      comp.forEach((o) => other.add(o));
    }
  }

  const toMask = (set: Set<number>) => {
    const arr = new Array<boolean>(PIXEL_COUNT).fill(false);
    set.forEach((o) => (arr[o] = true));
    return arr;
  };

  return {
    ...analysis,
    clothingMask: toMask(clothing),
    otherMask: toMask(other),
  };
}

/* =========================================================================
 * Palette Reduction & Mapping
 * ========================================================================= */

function squaredDistance(first: Lab, second: Lab): number {
  const d0 = first[0] - second[0];
  const d1 = first[1] - second[1];
  const d2 = first[2] - second[2];
  return d0 * d0 + d1 * d1 + d2 * d2;
}

function hueDifference(first: Lab, second: Lab): number {
  const h1 = Math.atan2(first[2], first[1]);
  const h2 = Math.atan2(second[2], second[1]);
  const diff = Math.abs(h1 - h2);
  return Math.min(diff, Math.PI * 2 - diff);
}

function nearestPaletteIndex(sourceLab: Lab, paletteLabs: Lab[], strategy: string): number {
  let candidates: number[] = Array.from({ length: paletteLabs.length }, (_, i) => i);
  const sourceChroma = Math.hypot(sourceLab[1], sourceLab[2]);

  if (strategy === 'hue_priority' && sourceLab[0] >= 0.65 && sourceChroma <= 0.075) {
    const lowChroma = candidates.filter(
      (idx) => Math.hypot(paletteLabs[idx][1], paletteLabs[idx][2]) <= Math.max(0.045, sourceChroma * 1.25)
    );
    if (lowChroma.length > 0) {
      if (sourceLab[2] <= 0.015) {
        const coolOrNeutral = lowChroma.filter((idx) => paletteLabs[idx][2] <= 0.025);
        if (coolOrNeutral.length > 0) candidates = coolOrNeutral;
        else candidates = lowChroma;
      } else {
        candidates = lowChroma;
      }
    }
  } else if (strategy === 'hue_priority' && sourceLab[0] >= 0.8) {
    const highlightCands = candidates.filter(
      (idx) =>
        Math.abs(paletteLabs[idx][0] - sourceLab[0]) <= 0.15 &&
        Math.hypot(paletteLabs[idx][1], paletteLabs[idx][2]) <= Math.max(0.06, sourceChroma * 1.75)
    );
    if (highlightCands.length > 0) candidates = highlightCands;
  } else if (strategy === 'hue_priority' && sourceChroma >= 0.055) {
    const sameHue = candidates.filter(
      (idx) =>
        Math.hypot(paletteLabs[idx][1], paletteLabs[idx][2]) >= sourceChroma * 0.65 &&
        hueDifference(sourceLab, paletteLabs[idx]) <= (45 * Math.PI) / 180
    );
    if (sameHue.length > 0) candidates = sameHue;
  }

  let bestIdx = candidates[0];
  let bestDist = Infinity;
  for (const idx of candidates) {
    const d = squaredDistance(sourceLab, paletteLabs[idx]);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = idx;
    }
  }
  return bestIdx;
}

export interface PaletteMappingResult {
  outputPixels: Rgb[];
  sourceColorCount: number;
  outputColorCount: number;
  measuredPixelCount: number;
  changedPixelCount: number;
  weightedMeanDistance: number;
  maximumDistance: number;
}

export function mapImageToPalette(
  pixels: Rgb[],
  palette: Rgb[],
  options: {
    measurementMask?: boolean[];
    mappingStrategy?: 'oklab_nearest' | 'hue_priority';
    unmeasuredColor?: Rgb;
  } = {}
): PaletteMappingResult {
  const mappingStrategy = options.mappingStrategy || 'oklab_nearest';
  const paletteLabs = palette.map(rgbToOklab);
  const cache = new Map<string, { color: Rgb; dist: number }>();

  const output: Rgb[] = [];
  const distances: number[] = [];
  let changed = 0;

  const measuredMask = options.measurementMask || new Array<boolean>(pixels.length).fill(true);

  for (let offset = 0; offset < pixels.length; offset++) {
    const src = pixels[offset];
    if (!measuredMask[offset] && options.unmeasuredColor) {
      output.push(options.unmeasuredColor);
      continue;
    }

    const key = `${src[0]},${src[1]},${src[2]}`;
    let cached = cache.get(key);
    if (!cached) {
      const srcLab = rgbToOklab(src);
      const idx = nearestPaletteIndex(srcLab, paletteLabs, mappingStrategy);
      const dist = Math.sqrt(squaredDistance(srcLab, paletteLabs[idx]));
      cached = { color: palette[idx], dist };
      cache.set(key, cached);
    }

    output.push(cached.color);
    if (measuredMask[offset]) {
      distances.push(cached.dist);
      if (
        cached.color[0] !== src[0] ||
        cached.color[1] !== src[1] ||
        cached.color[2] !== src[2]
      ) {
        changed++;
      }
    }
  }

  const srcColorSet = new Set(pixels.map((p) => `${p[0]},${p[1]},${p[2]}`));
  const outColorSet = new Set(output.map((p) => `${p[0]},${p[1]},${p[2]}`));
  const meanDist = distances.length > 0 ? distances.reduce((a, b) => a + b, 0) / distances.length : 0.0;
  const maxDist = distances.length > 0 ? Math.max(...distances) : 0.0;

  return {
    outputPixels: output,
    sourceColorCount: srcColorSet.size,
    outputColorCount: outColorSet.size,
    measuredPixelCount: distances.length,
    changedPixelCount: changed,
    weightedMeanDistance: meanDist,
    maximumDistance: maxDist,
  };
}
