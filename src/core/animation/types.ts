/**
 * 动画生成器领域类型定义
 */

export type EyeFrame = 'open' | 'half' | 'closed';
export type MouthFrame = 'closed' | 'half' | 'open';

export const EYE_FRAMES: EyeFrame[] = ['open', 'half', 'closed'];
export const MOUTH_FRAMES: MouthFrame[] = ['closed', 'half', 'open'];

/** 矩形包围盒 [minX, minY, maxX, maxY] (0 <= min <= max < 64) */
export type RectBbox = [number, number, number, number];

/** 面部特征定位与配色锚点 */
export interface FacialAnchors {
  leftEyeBbox: RectBbox;
  rightEyeBbox: RectBbox;
  mouthBbox: RectBbox;
  skinToneIndex: number;        // 眼睑填补肤色索引 (0~35)
  eyelashColorIndex: number;    // 闭眼睫毛线条深色索引 (0~35)
  mouthInteriorIndex: number;   // 口腔内部深色阴影索引 (0~35)
  mouthLipIndex: number;        // 嘴唇线条固有色索引 (0~35)
}

/** 动画单组件帧切片 */
export interface EyeFrameset {
  open: Uint8Array;
  half: Uint8Array;
  closed: Uint8Array;
}

export interface MouthFrameset {
  closed: Uint8Array;
  half: Uint8Array;
  open: Uint8Array;
}

/** 完整动画集合与 3×3 矩阵 */
export interface AnimationProject {
  anchors: FacialAnchors;
  eyeFrames: EyeFrameset;
  mouthFrames: MouthFrameset;
  /** 3×3 组合矩阵: matrix[eyeIndex 0..2][mouthIndex 0..2] 对应 64×64 完整帧 (4096 字节) */
  matrix: Uint8Array[][];
}

/** 游戏引擎元数据规范 */
export interface GameEngineAnimationMetadata {
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  layout: 'matrix3x3' | 'strip_horizontal';
  animations: {
    blink: {
      fps: number;
      frameIndices: number[];
      delaysMs: number[];
    };
    talk: {
      fps: number;
      frameIndices: number[];
      loop: boolean;
      delaysMs: number[];
    };
  };
}
