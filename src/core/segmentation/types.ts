export type Bbox = [number, number, number, number]; // [left, top, right, bottom]，闭区间
export type Point = [number, number];

export interface HighlightPair {
  leftCenter: Point;
  rightCenter: Point;
  offsets: number[];
}

export interface EyeRegion {
  bbox: Bbox;
  detected: boolean; // false 表示没找到像素证据，退回几何预测
  confidence: number;
  scleraOffsets: number[];
  inkOffsets: number[];
  centerX: number;
  centerY: number;
}

export interface FaceAnalysis {
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

export interface ClaimedRegions {
  eyes: Set<number>;
  skin: Set<number>; // 脸部皮肤 + 身体皮肤 + 嘴 / 表情
  hair: Set<number>;
}
