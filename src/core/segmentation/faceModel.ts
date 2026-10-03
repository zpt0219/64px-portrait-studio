import { PIXEL_COUNT, IMAGE_WIDTH as W } from '../pixelGrid';
import { Bbox, Point } from './types';
import { xOf, yOf, percentileInt, median, mean, clamp } from './stats';

export function cubicPoints(start: Point, control1: Point, control2: Point, end: Point, steps = 12): Point[] {
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
export function faceOutlinePoints(bbox: Bbox, asymmetry = 0.0, shearX = 0.0): Point[] {
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
export function rasterPolygon(points: Point[]): boolean[] {
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

export const FACE_EGG_MODEL = {
  eyeLineRatio: 0.45,
  minimumWidth: 16,
  maximumWidth: 30,
  skinWidthScale: 1.0,
  eyeSeparationWidthScale: 1.2,
  maximumAsymmetry: 0.14,
  maximumShearPixels: 2.0,
};

/**
 * 以双眼与下巴为锚点，在宽度 / 水平偏移 / 不对称 / 错切的小范围网格内搜索蛋形脸，
 * 目标：不覆盖外部白底、尽量覆盖可见皮肤、双眼必须在脸内。
 */
export function fitFaceEgg(
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
