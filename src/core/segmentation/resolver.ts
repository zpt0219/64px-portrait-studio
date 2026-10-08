import { Rgb, Lab, rgbToOklab, oklabDistance } from '../../utils/colorUtils';
import { IMAGE_WIDTH as W, PIXEL_COUNT, connectedComponents, MAX_CANVAS_COORD } from '../pixelGrid';
import { SemanticZone } from '../types';
import { FaceAnalysis, ClaimedRegions } from './types';
import { xOf, yOf, isFaceSkin, maskInRect } from './stats';
import { detectMouth } from './mouthDetector';

/** 脸部蛋形模型区域内与代表肤色聚类的最大 OKLab 色差容差 */
export const SKIN_OKLAB_DISTANCE_FACE = 0.045;
/** 身体下部（下巴以下）裸露皮肤与代表肤色聚类的最大 OKLab 色差容差 */
export const SKIN_OKLAB_DISTANCE_BODY = 0.035;

function looksLikeExpressionColor(color: Rgb): boolean {
  const [red, green, blue] = color;
  return red >= 150 && red - green >= 25 && red - blue >= 12;
}

/**
 * 依据面部解剖模型，由高到低置信度认领各面部特征区域像素集合。
 *
 * 认领次序：
 * 1. 眼睛 (眼白、瞳孔、高光)
 * 2. 嘴唇与面部表情红晕
 * 3. 蛋形脸模型内的面部皮肤与耳廓连通皮肤
 * 4. 颈部与身体皮肤 (下巴以下)
 * 5. 发丝区域
 *
 * @param pixels 图像 RGB 像素
 * @param foregroundMask 前景像素掩码
 * @param claimed 已认领不可抢占的像素集合 (初始包含外轮廓)
 * @param face 面部几何与模型分析结果
 * @returns 眼睛、皮肤与头发的认领集合
 */
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
    if (face.faceModelMask[offset] && !claimed.has(offset) && isSkinLike(pixels[offset], SKIN_OKLAB_DISTANCE_FACE)) {
      faceSkin.add(offset);
    }
  }

  // 蛋形脸外、但在脸框附近且与已认领脸部皮肤相连的肤色 (耳朵、脸颊溢出)
  if (faceSkin.size > 0) {
    const left = Math.max(0, Math.min(face.faceBbox[0], face.visibleSkinBbox[0]) - 2);
    const top = Math.max(0, Math.min(face.faceBbox[1], face.visibleSkinBbox[1]) - 1);
    const right = Math.min(MAX_CANVAS_COORD, Math.max(face.faceBbox[2], face.visibleSkinBbox[2]) + 2);
    const bottom = Math.min(MAX_CANVAS_COORD, Math.max(face.faceBbox[3], face.visibleSkinBbox[3]) + 1);

    const connectedSkin = maskInRect([left, top, right, bottom], (o) => !claimed.has(o) && isSkinLike(pixels[o], SKIN_OKLAB_DISTANCE_FACE));
    for (const comp of connectedComponents(connectedSkin, true)) {
      if (comp.some((o) => faceSkin.has(o))) comp.forEach((o) => faceSkin.add(o));
    }
  }
  claimAll(faceSkin);

  const bodySkin = new Set<number>();
  for (let offset = 0; offset < PIXEL_COUNT; offset++) {
    if (foregroundMask[offset] && yOf(offset) > face.chinY && !claimed.has(offset) && isSkinLike(pixels[offset], SKIN_OKLAB_DISTANCE_BODY)) {
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

/** 当未检测到有效人像面部时，所采用的默认下巴分界线 Y 坐标 (0..63) */
export const FALLBACK_CHIN_Y = 38;

/**
 * 依据前景掩码、轮廓掩码、各特征认领集合以及下巴分界线，计算最终全图 4096 像素语义分区。
 *
 * 分区归类优先级：
 * 1. 非前景像素 -> None (0)
 * 2. 眼睛认领集 -> Eyes (3)
 * 3. 头发认领集 -> Hair (1)
 * 4. 皮肤认领集 -> Skin (2)
 * 5. 轮廓墨线 -> 若 Y > chinY 则归入 Clothes (4)，否则归入 Hair (1)
 * 6. 其余前景像素 -> Clothes (4)
 *
 * @param foregroundMask 前景掩码
 * @param outlineMask 轮廓墨线掩码
 * @param regions 特征认领集合 (为 null 时采用降级逻辑)
 * @param chinY 下巴分界线 Y 坐标
 * @returns 长度 4096 的语义分区掩码 Uint8Array (值 0..4)
 */
export function resolveSemanticMask(
  foregroundMask: boolean[],
  outlineMask: boolean[],
  regions: ClaimedRegions | null,
  chinY: number
): Uint8Array {
  const mask = new Uint8Array(PIXEL_COUNT);
  for (let i = 0; i < PIXEL_COUNT; i++) {
    if (!foregroundMask[i]) mask[i] = SemanticZone.None;
    else if (regions?.eyes.has(i)) mask[i] = SemanticZone.Eyes;
    else if (regions?.hair.has(i)) mask[i] = SemanticZone.Hair;
    else if (regions?.skin.has(i)) mask[i] = SemanticZone.Skin;
    else if (outlineMask[i]) mask[i] = yOf(i) > chinY ? SemanticZone.Clothes : SemanticZone.Hair;
    else mask[i] = SemanticZone.Clothes;
  }
  return mask;
}
