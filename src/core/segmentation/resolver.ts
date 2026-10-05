import { Rgb, Lab, rgbToOklab, oklabDistance } from '../colorUtils';
import { IMAGE_WIDTH as W, PIXEL_COUNT, connectedComponents } from '../pixelGrid';
import { SemanticZone } from '../../types';
import { FaceAnalysis, ClaimedRegions } from './types';
import { xOf, yOf, isFaceSkin, maskInRect } from './stats';
import { detectMouth } from './mouthDetector';

function looksLikeExpressionColor(color: Rgb): boolean {
  const [red, green, blue] = color;
  return red >= 150 && red - green >= 25 && red - blue >= 12;
}

export function claimFaceRegions(
  pixels: Rgb[],
  foregroundMask: boolean[],
  claimed: Set<number>,
  face: FaceAnalysis
): ClaimedRegions {
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

export const FALLBACK_CHIN_Y = 38;

export function resolveSemanticMask(
  foregroundMask: boolean[],
  outlineMask: boolean[],
  regions: ClaimedRegions | null,
  chinY: number
): Uint8Array {
  const mask = new Uint8Array(PIXEL_COUNT);
  for (let i = 0; i < PIXEL_COUNT; i++) {
    if (!foregroundMask[i]) mask[i] = SemanticZone.Background;
    else if (regions?.eyes.has(i)) mask[i] = SemanticZone.Eyes;
    else if (regions?.hair.has(i)) mask[i] = SemanticZone.Hair;
    else if (regions?.skin.has(i)) mask[i] = SemanticZone.Skin;
    else if (outlineMask[i]) mask[i] = yOf(i) > chinY ? SemanticZone.Clothes : SemanticZone.Hair;
    else mask[i] = SemanticZone.Clothes;
  }
  return mask;
}
