/**
 * 语义遮罩自动识别流水线入口。
 *
 * 负责将 64×64 输入图像自动拆解并分类至以下语义分区 (SemanticZone)：
 * - None (0): 背景 / 无遮罩区域
 * - Hair (1): 头发区域
 * - Skin (2): 皮肤与面部表情区域
 * - Eyes (3): 眼白、虹膜与高光
 * - Clothes (4): 衣服与身体下部装饰
 */

import { Rgb } from '../../utils/colorUtils';
import { estimateForeground } from './background';
import { analyzePixelOutline } from './contour';
import { analyzeFace } from './faceAnalysis';
import { claimFaceRegions, resolveSemanticMask, FALLBACK_CHIN_Y } from './resolver';

export * from './types';

/**
 * 对 64×64 RGB 像素阵列自动执行语义识别，生成 4096 字节的语义遮罩 (SemanticZone Uint8Array)。
 *
 * 流水线包含五个主要阶段：
 * 1. 背景泛洪估算 (estimateForeground)：从画布四周边界采样并聚类，洪泛剔除背景
 * 2. 轮廓提取 (analyzePixelOutline)：提取前景与背景交界处连通的墨线/外轮廓
 * 3. 面部解剖结构分析 (analyzeFace)：定位肤色核心、推算脸框蛋形模型与眼部/发线几何特征
 * 4. 特征区域认领 (claimFaceRegions)：按置信度顺序认领双眼、嘴唇表情、面部/身体皮肤与发丝
 * 5. 遮罩综合决议 (resolveSemanticMask)：结合认领集与下巴分界线完成全图 4096 像素语义标注
 *
 * 若面部特征不足或为非人像道具，流水线安全降级：下巴线固定为 FALLBACK_CHIN_Y (38)，
 * 上部轮廓归为头发，下部轮廓与主体归为衣服。
 *
 * @param pixels 长度为 4096 的 [R, G, B] 像素数组
 * @returns 长度为 4096 的 Uint8Array，每个元素为 SemanticZone 枚举值 (0..4)
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

  return resolveSemanticMask(foregroundMask, outline.outlineMask, regions, chinY);
}
