import { Rgb } from '../../utils/colorUtils';
import { IMAGE_WIDTH as W, MAX_CANVAS_COORD } from '../pixelGrid';
import { Bbox, FaceAnalysis } from './types';
import { isFaceSkin } from './stats';

const MOUTH_DETECTION_MODEL = {
  roiTopEyeChinRatio: 0.55,
  roiBottomEyeChinRatio: 0.9,
  roiHalfWidth: 6,
  minimumSkinNeighbours: 5,
};

const MOUTH_COLOR_MODEL = {
  pinkMinRed: 135,
  pinkMinRedGreenDelta: 30,
  pinkMinRedBlueDelta: 15,
  darkWarmMaxChannel: 155,
  darkWarmMinRedGreenDelta: 18,
  darkWarmMinRedBlueDelta: 5,
};

function isMouthColor(rgb: Rgb): boolean {
  const [red, green, blue] = rgb;
  const pinkOrRed =
    red >= MOUTH_COLOR_MODEL.pinkMinRed &&
    red - green >= MOUTH_COLOR_MODEL.pinkMinRedGreenDelta &&
    red - blue >= MOUTH_COLOR_MODEL.pinkMinRedBlueDelta;
  const darkWarm =
    Math.max(red, green, blue) <= MOUTH_COLOR_MODEL.darkWarmMaxChannel &&
    red - green >= MOUTH_COLOR_MODEL.darkWarmMinRedGreenDelta &&
    red - blue >= MOUTH_COLOR_MODEL.darkWarmMinRedBlueDelta;
  return (pinkOrRed || darkWarm) && !isFaceSkin(rgb);
}

function skinNeighbourCount(pixels: Rgb[], x: number, y: number): number {
  let count = 0;
  for (let ny = Math.max(0, y - 1); ny <= Math.min(MAX_CANVAS_COORD, y + 1); ny++) {
    for (let nx = Math.max(0, x - 1); nx <= Math.min(MAX_CANVAS_COORD, x + 1); nx++) {
      if ((nx !== x || ny !== y) && isFaceSkin(pixels[ny * W + nx])) count++;
    }
  }
  return count;
}

/** 双眼与下巴之间的 ROI 内，被肤色包围的红/暗暖色像素 */
export function detectMouth(pixels: Rgb[], face: FaceAnalysis): { offsets: number[]; roi: Bbox } {
  const eyeCenterX = (face.leftEyeCenter[0] + face.rightEyeCenter[0]) / 2;
  const eyeCenterY = (face.leftEyeCenter[1] + face.rightEyeCenter[1]) / 2;
  const eyeChinH = face.chinY - eyeCenterY;

  const roiLeft = Math.max(0, Math.round(eyeCenterX) - MOUTH_DETECTION_MODEL.roiHalfWidth);
  const roiRight = Math.min(MAX_CANVAS_COORD, Math.round(eyeCenterX) + MOUTH_DETECTION_MODEL.roiHalfWidth);
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
