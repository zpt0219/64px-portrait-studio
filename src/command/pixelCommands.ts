/**
 * 像素类命令：笔划 (画笔 / 橡皮 / 油漆桶，像素与遮罩模式共用)、选区剪贴与移动、替换色、扣外围白底
 */

import { SemanticZone, RectSelection, EditorMode, PixelTool, MaskTool, BrushSize } from '../core/types';
import { TRANSPARENT_INDEX } from '../core/constants';
import { IMAGE_WIDTH as W, IMAGE_HEIGHT as H } from '../core/pixelGrid';
import {
  Patch,
  FULL_CANVAS,
  stampPatch,
  clearRect,
  movePatch,
  replaceColor,
  floodFillPixels,
  floodFillMask,
  assignColorToMask,
  canAssignZone,
} from '../core/editOps';
import { layersOf } from '../core/document';
import { clampToCanvas, isInRect } from '../core/session';
import { CommandContext, SnapshotCommand } from './command';

/** 方形笔刷覆盖的矩形 (锚点为鼠标所在像素，1~10 均居中覆盖) */
export function brushRect(x: number, y: number, size: BrushSize): RectSelection {
  const offset = Math.floor((size - 1) / 2);
  return { x: x - offset, y: y - offset, w: size, h: size };
}

/** 笔划开始时捕获的全部工具参数 (笔划过程中不再读取会话状态) */
export interface StrokeParams {
  mode: EditorMode;
  pixelTool: PixelTool;
  maskTool: MaskTool;
  button: 0 | 2;             // 0 左键：前景色 / 当前分区；2 右键：背景色 / 擦除遮罩
  replaceAll: boolean;       // Shift+油漆桶：全域同色替换 (像素模式改颜色，遮罩模式改遮罩)
  fg: number;
  bg: number;
  zone: SemanticZone;
  lockedZones: SemanticZone[];
  brushSize: BrushSize;
  selection: RectSelection | null; // 像素模式下绘制限定在选区内
  diagonal: boolean;         // 油漆桶 8 邻居连通
}

/**
 * 一次鼠标按下到松开的笔划。由画布逐点调用 dab()，松开时 end() 判断是否有变化并入撤销栈。
 * 油漆桶每次笔划只填充一次。
 */
export class StrokeCommand extends SnapshotCommand {
  readonly name = 'Stroke';
  private bucketDone = false;
  private pixelsChanged = false;
  private maskChanged = false;

  constructor(private readonly p: StrokeParams) {
    super();
  }

  protected apply(): void {
    // 笔划通过 dab() 逐点修改，不走一次性 execute()
  }

  dab(ctx: CommandContext, x: number, y: number): void {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const p = this.p;
    const pixelMode = p.mode === 'pixel';
    if (pixelMode && p.selection && !isInRect(x, y, p.selection)) return;

    const isBucket = pixelMode ? p.pixelTool === 'bucket' : p.maskTool === 'bucket';
    if (isBucket) {
      if (!this.bucketDone) {
        this.bucketDone = true;
        this.bucket(ctx, x, y);
      }
    } else if (pixelMode) {
      this.paintPixel(ctx, x, y);
    } else {
      this.paintMask(ctx, x, y);
    }

    if (this.pixelsChanged) ctx.events.onPixelsChanged?.();
    if (this.maskChanged) ctx.events.onMaskChanged?.();
    this.pixelsChanged = this.maskChanged = false;
  }

  /** 松开鼠标：返回整笔是否改动了文档 */
  end(ctx: CommandContext): boolean {
    return this.finish(ctx, false);
  }

  private forceClearMaskToBackground(ctx: CommandContext, offset: number): void {
    if (ctx.doc.semanticMask[offset] !== SemanticZone.Background) {
      ctx.doc.semanticMask[offset] = SemanticZone.Background;
      this.maskChanged = true;
    }
  }

  private paintPixel(ctx: CommandContext, x: number, y: number): void {
    const { p } = this;
    const offset = y * W + x;
    const color = p.button === 2 ? p.bg : (p.pixelTool === 'eraser' ? TRANSPARENT_INDEX : p.fg);
    this.setPixel(ctx, offset, color);
    if (color === TRANSPARENT_INDEX) {
      this.forceClearMaskToBackground(ctx, offset);
    }
  }

  private paintMask(ctx: CommandContext, x: number, y: number): void {
    const { p } = this;
    const erase = p.maskTool === 'eraser' || p.button === 2;
    const rect = brushRect(x, y, p.brushSize);
    for (let py = rect.y; py < rect.y + rect.h; py++) {
      for (let px = rect.x; px < rect.x + rect.w; px++) {
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        const offset = py * W + px;
        // 关键防护：涂抹遮罩时跳过透明像素；擦除时允许擦除可能遗留在透明像素上的旧遮罩
        if (!erase && ctx.doc.pixelIndices[offset] === TRANSPARENT_INDEX) continue;
        this.setZone(ctx, py * W + px, erase ? SemanticZone.Background : p.zone);
      }
    }
  }

  private setPixel(ctx: CommandContext, offset: number, color: number): void {
    if (ctx.doc.pixelIndices[offset] === color) return;
    ctx.doc.pixelIndices[offset] = color;
    this.pixelsChanged = true;
  }

  /** 使用统一策略判定是否可划入该分区 */
  private setZone(ctx: CommandContext, offset: number, zone: SemanticZone): void {
    const mask = ctx.doc.semanticMask;
    const current = mask[offset] as SemanticZone;
    const color = ctx.doc.pixelIndices[offset];
    if (!canAssignZone(color, current, zone, this.p.lockedZones)) return;
    mask[offset] = zone;
    this.maskChanged = true;
  }

  private bucket(ctx: CommandContext, x: number, y: number): void {
    const { p } = this;
    const layers = layersOf(ctx.doc, p.mode === 'mask' ? p.lockedZones : []);
    const scope = p.selection ?? FULL_CANVAS;
    if (p.mode === 'mask') {
      const zone = p.button === 0 ? p.zone : SemanticZone.Background;
      if (p.replaceAll) {
        const fromColor = layers.pixels[y * W + x];
        this.maskChanged = assignColorToMask(layers, fromColor, zone, scope) > 0;
      } else {
        this.maskChanged = floodFillMask(layers, x, y, zone, p.diagonal, scope);
      }
      return;
    }
    const color = p.button === 0 ? p.fg : p.bg;
    if (color === TRANSPARENT_INDEX) {
      const maskBefore = new Uint8Array(ctx.doc.semanticMask);
      if (p.replaceAll) {
        const fromColor = layers.pixels[y * W + x];
        this.pixelsChanged = replaceColor(layers, fromColor, color, scope) > 0;
      } else {
        this.pixelsChanged = floodFillPixels(layers, x, y, color, p.diagonal, scope);
      }
      if (this.pixelsChanged) {
        let changed = false;
        for (let i = 0; i < maskBefore.length; i++) {
          if (maskBefore[i] !== ctx.doc.semanticMask[i]) {
            changed = true;
            break;
          }
        }
        this.maskChanged = changed;
      } else {
        this.maskChanged = false;
      }
    } else {
      if (p.replaceAll) {
        const fromColor = layers.pixels[y * W + x];
        this.pixelsChanged = replaceColor(layers, fromColor, color, scope) > 0;
      } else {
        this.pixelsChanged = floodFillPixels(layers, x, y, color, p.diagonal, scope);
      }
      this.maskChanged = false;
    }
  }
}

/** 选区拖动放下：把块从 from 移到 (toX, toY)，copy 为 false 时原位置清空；选区跟随到新位置 */
export class MovePatchCommand extends SnapshotCommand {
  readonly name = 'MovePatch';
  constructor(
    private readonly patch: Patch,
    private readonly from: RectSelection,
    private readonly toX: number,
    private readonly toY: number,
    private readonly copy: boolean,
    private readonly lockedZones: SemanticZone[]
  ) {
    super();
  }
  protected apply({ doc, session }: CommandContext): void {
    movePatch(layersOf(doc, this.lockedZones), this.patch, this.from, this.toX, this.toY, !this.copy);
    session.selection = clampToCanvas({ x: this.toX, y: this.toY, w: this.patch.w, h: this.patch.h });
  }
}

/** 粘贴剪贴板到 (x, y)，粘贴结果成为新选区 */
export class PastePatchCommand extends SnapshotCommand {
  readonly name = 'PastePatch';
  constructor(private readonly patch: Patch, private readonly x: number, private readonly y: number) {
    super();
  }
  protected apply({ doc, session }: CommandContext): void {
    stampPatch(layersOf(doc, []), this.patch, this.x, this.y);
    session.selection = clampToCanvas({ x: this.x, y: this.y, w: this.patch.w, h: this.patch.h });
  }
}

/** 把矩形清空为透明 (锁定分区的遮罩保留) */
export class ClearRectCommand extends SnapshotCommand {
  readonly name = 'ClearRect';
  constructor(private readonly rect: RectSelection, private readonly lockedZones: SemanticZone[]) {
    super();
  }
  protected apply({ doc }: CommandContext): void {
    clearRect(layersOf(doc, this.lockedZones), this.rect);
  }
}

/** 把 scope 内的 from 色替换为 to 色；count 为替换的像素数 */
export class ReplaceColorCommand extends SnapshotCommand {
  readonly name = 'ReplaceColor';
  count = 0;
  constructor(
    private readonly from: number,
    private readonly to: number,
    private readonly scope: RectSelection,
    private readonly lockedZones: SemanticZone[]
  ) {
    super();
  }
  protected apply({ doc }: CommandContext): void {
    this.count = replaceColor(layersOf(doc, this.lockedZones), this.from, this.to, this.scope);
  }
}

/** 把给定像素设为透明并归入背景分区 (扣外围白底) */
export class ClearPixelsCommand extends SnapshotCommand {
  readonly name = 'ClearPixels';
  constructor(private readonly offsets: number[]) {
    super();
  }
  protected apply({ doc }: CommandContext): void {
    for (const offset of this.offsets) {
      doc.pixelIndices[offset] = TRANSPARENT_INDEX;
      doc.semanticMask[offset] = SemanticZone.Background;
    }
  }
}
