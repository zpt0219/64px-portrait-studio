import { Rgb } from '../colorUtils';
import { IMAGE_WIDTH as W } from '../pixelGrid';
import { Bbox, FaceAnalysis } from './types';
import { isFaceSkin } from './stats';

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
export function detectMouth(pixels: Rgb[], face: FaceAnalysis): { offsets: number[]; roi: Bbox } {
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
