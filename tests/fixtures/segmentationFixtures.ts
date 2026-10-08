import { Rgb } from '../../src/utils/colorUtils';
import { PIXEL_COUNT, IMAGE_WIDTH as W, IMAGE_HEIGHT as H } from '../../src/core/pixelGrid';

/**
 * 常用测试颜色常量 (RGB)
 */
export const FIXTURE_COLORS = {
  whiteBg: [255, 255, 255] as Rgb,
  lightGrayBg: [240, 240, 240] as Rgb,
  darkOutline: [30, 30, 30] as Rgb,
  hairBrown: [80, 48, 32] as Rgb,
  hairBlonde: [220, 190, 110] as Rgb,
  skinTone: [255, 222, 206] as Rgb,
  eyeSclera: [238, 238, 238] as Rgb,
  eyeInk: [20, 24, 45] as Rgb,
  eyeHighlight: [255, 255, 255] as Rgb,
  mouthRed: [205, 75, 75] as Rgb,
  clothesBlue: [45, 75, 155] as Rgb,
  shieldGreen: [35, 150, 65] as Rgb,
};

/**
 * 典型肖像关键坐标锚点，用于语义分区断言
 */
export const SYNTHETIC_PORTRAIT_ANCHORS = {
  // 背景角点
  bgTopLeft: { x: 2, y: 2 },
  bgTopRight: { x: 61, y: 2 },
  // 头发区域（头顶发冠）
  hairCrown: { x: 32, y: 14 },
  hairLeftTemple: { x: 19, y: 20 },
  hairRightTemple: { x: 44, y: 20 },
  // 额头与面部肤色
  forehead: { x: 32, y: 24 },
  cheekLeft: { x: 23, y: 34 },
  cheekRight: { x: 40, y: 34 },
  chin: { x: 32, y: 40 },
  // 双眼区域
  leftEyeCenter: { x: 27, y: 29 },
  rightEyeCenter: { x: 36, y: 29 },
  // 嘴唇
  mouth: { x: 32, y: 37 },
  // 衣服（肩部 / 胸口）
  clothesCenter: { x: 32, y: 52 },
  clothesLeftShoulder: { x: 18, y: 50 },
  clothesRightShoulder: { x: 45, y: 50 },
};

/**
 * 创建全白背景的空白画布
 */
export function createBlankCanvas(bg: Rgb = FIXTURE_COLORS.whiteBg): Rgb[] {
  return Array.from({ length: PIXEL_COUNT }, () => [...bg] as Rgb);
}

/**
 * 构建标准合成头像（包含背景、头发、皮肤、双眼、衣服完整五类区域）
 *
 * 尺寸布局：
 * - 0 <= y < 64, 0 <= x < 64
 * - 背景：全白 [255, 255, 255]，边缘 12 像素环绕
 * - 外轮廓：深灰 [30, 30, 30]
 * - 头发：y = 10..22, x = 16..47
 * - 面部皮肤：y = 23..41, x = 20..43 (色值 [255, 222, 206])
 * - 双眼：左眼 (25..29, 28..31), 右眼 (34..38, 28..31)
 * - 嘴唇：y = 37..38, x = 30..33
 * - 衣服：y = 43..61, x = 14..49
 */
export function createSyntheticPortraitRgb(): Rgb[] {
  const pixels = createBlankCanvas(FIXTURE_COLORS.whiteBg);

  const setPixel = (x: number, y: number, color: Rgb) => {
    if (x >= 0 && x < W && y >= 0 && y < H) {
      pixels[y * W + x] = [...color] as Rgb;
    }
  };

  const fillRect = (x1: number, y1: number, x2: number, y2: number, color: Rgb) => {
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        setPixel(x, y, color);
      }
    }
  };

  // 1. 衣服区域 (下半部胸肩)
  fillRect(14, 43, 49, 61, FIXTURE_COLORS.clothesBlue);

  // 2. 头发主体 (头顶与两侧)
  fillRect(16, 10, 47, 23, FIXTURE_COLORS.hairBrown);
  fillRect(16, 23, 19, 36, FIXTURE_COLORS.hairBrown); // 左侧鬓角
  fillRect(44, 23, 47, 36, FIXTURE_COLORS.hairBrown); // 右侧鬓角

  // 3. 脸部肤色核心 (y: 23..41, x: 20..43)
  fillRect(20, 23, 43, 41, FIXTURE_COLORS.skinTone);

  // 4. 左眼 (x: 25..29, y: 28..30)
  fillRect(25, 28, 29, 30, FIXTURE_COLORS.eyeSclera);
  fillRect(26, 28, 28, 30, FIXTURE_COLORS.eyeInk);
  setPixel(26, 28, FIXTURE_COLORS.eyeHighlight);

  // 5. 右眼 (x: 34..38, y: 28..30)
  fillRect(34, 28, 38, 30, FIXTURE_COLORS.eyeSclera);
  fillRect(35, 28, 37, 30, FIXTURE_COLORS.eyeInk);
  setPixel(35, 28, FIXTURE_COLORS.eyeHighlight);

  // 6. 嘴唇表情 (x: 30..33, y: 37)
  fillRect(30, 37, 33, 37, FIXTURE_COLORS.mouthRed);

  // 7. 外轮廓线 (围绕头顶与外围，使轮廓检测器能识别出有效 outlineColors)
  // 顶部轮廓
  for (let x = 15; x <= 48; x++) {
    setPixel(x, 9, FIXTURE_COLORS.darkOutline);
  }
  // 左侧轮廓
  for (let y = 10; y <= 61; y++) {
    setPixel(y < 43 ? 15 : 13, y, FIXTURE_COLORS.darkOutline);
  }
  // 右侧轮廓
  for (let y = 10; y <= 61; y++) {
    setPixel(y < 43 ? 48 : 50, y, FIXTURE_COLORS.darkOutline);
  }
  // 底部轮廓
  for (let x = 13; x <= 50; x++) {
    setPixel(x, 62, FIXTURE_COLORS.darkOutline);
  }

  return pixels;
}

/**
 * 构建无面部几何特性的单色道具样本（如绿色盾牌/方块）
 *
 * 预期行为：
 * - 面部检测返回 null；
 * - 自动降级至 FALLBACK_CHIN_Y (38) 规则；
 * - 上部轮廓归为头发，下部轮廓归为衣服，内部主体归为衣服；
 * - 背景归为 None (0)。
 */
export function createNonFaceObjectRgb(): Rgb[] {
  const pixels = createBlankCanvas(FIXTURE_COLORS.lightGrayBg);

  const setPixel = (x: number, y: number, color: Rgb) => {
    if (x >= 0 && x < W && y >= 0 && y < H) {
      pixels[y * W + x] = [...color] as Rgb;
    }
  };

  // 绘制中心绿色道具块 (x: 20..43, y: 16..47)
  for (let y = 16; y <= 47; y++) {
    for (let x = 20; x <= 43; x++) {
      setPixel(x, y, FIXTURE_COLORS.shieldGreen);
    }
  }

  // 绘制深色轮廓环绕道具四周
  for (let x = 19; x <= 44; x++) {
    setPixel(x, 15, FIXTURE_COLORS.darkOutline);
    setPixel(x, 48, FIXTURE_COLORS.darkOutline);
  }
  for (let y = 15; y <= 48; y++) {
    setPixel(19, y, FIXTURE_COLORS.darkOutline);
    setPixel(44, y, FIXTURE_COLORS.darkOutline);
  }

  return pixels;
}

/**
 * 构建金发与浅色背景/高光相邻的边界肖像样本
 * 检验浅色发色在邻近眼白与高光时不会引起漫延混乱
 */
export function createBlondePortraitRgb(): Rgb[] {
  const pixels = createSyntheticPortraitRgb();
  // 将头发改为金色
  for (let y = 10; y <= 23; y++) {
    for (let x = 16; x <= 47; x++) {
      const idx = y * W + x;
      // 保持外轮廓不变，仅替换原有深棕色头发
      if (
        pixels[idx][0] === FIXTURE_COLORS.hairBrown[0] &&
        pixels[idx][1] === FIXTURE_COLORS.hairBrown[1] &&
        pixels[idx][2] === FIXTURE_COLORS.hairBrown[2]
      ) {
        pixels[idx] = [...FIXTURE_COLORS.hairBlonde] as Rgb;
      }
    }
  }
  return pixels;
}
