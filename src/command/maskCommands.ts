/**
 * 遮罩类命令：智能框选、颜色一键转遮罩、重新识别语义遮罩。锁定分区的像素一律跳过。
 */

import { SemanticZone, RectSelection } from '../types';
import { TRANSPARENT_INDEX } from '../data/palette';
import { IMAGE_WIDTH as W, IMAGE_HEIGHT as H, PIXEL_COUNT } from '../core/pixelGrid';
import { CommandContext, SnapshotCommand } from './command';

/** 框内像素遮罩操作：
 * add (左键): 属于匹配色组的像素划入 target 分区；
 * subtract (Shift+左键): 减法去杂色，不属于匹配色组但在 target 分区的像素剔除为背景；
 * remove (Alt+左键): 减法去匹配色，属于匹配色组且在 target 分区的像素剔除为背景；
 * clear (右键): 清空去所有颜色，框内所有在 target 分区的像素一律剔除为背景；
 * count 为改动像素数
 */
export class MaskBoxSelectCommand extends SnapshotCommand {
  readonly name = 'MaskBoxSelect';
  count = 0;
  constructor(
    private readonly rect: RectSelection,
    private readonly action: 'add' | 'remove' | 'subtract' | 'clear',
    private readonly matchColors: Set<number>,
    private readonly target: SemanticZone,
    private readonly lockedZones: SemanticZone[]
  ) {
    super();
  }
  protected apply({ doc }: CommandContext): void {
    const { x, y, w, h } = this.rect;
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        const offset = py * W + px;
        const color = doc.pixelIndices[offset];
        const current = doc.semanticMask[offset] as SemanticZone;
        if (this.lockedZones.includes(current)) continue;

        // 关键防护：透明像素永远不入非背景遮罩！
        if (this.action === 'add' && color === TRANSPARENT_INDEX) continue;

        if (this.action === 'clear') {
          // 右键去所有颜色：框内所有属于当前分区的像素全额清除为背景
          if (current === this.target) {
            doc.semanticMask[offset] = SemanticZone.Background;
            this.count++;
          }
        } else if (this.action === 'subtract') {
          // Shift 减法模式：所有不在匹配色组的像素 (杂色) 从 target 分区剔除
          if (!this.matchColors.has(color) && current === this.target) {
            doc.semanticMask[offset] = SemanticZone.Background;
            this.count++;
          }
        } else if (this.matchColors.has(color)) {
          if (this.action === 'add' && current !== this.target) {
            doc.semanticMask[offset] = this.target;
            this.count++;
          } else if (this.action === 'remove' && current === this.target) {
            // Alt 减法模式：属于匹配色组的像素从 target 分区剔除
            doc.semanticMask[offset] = SemanticZone.Background;
            this.count++;
          }
        }
      }
    }
  }
}

/** 全图所有 colorIdx 色像素划入 target 分区；count 为改动像素数 */
export class AssignColorToZoneCommand extends SnapshotCommand {
  readonly name = 'AssignColorToZone';
  count = 0;
  constructor(
    private readonly colorIdx: number,
    private readonly target: SemanticZone,
    private readonly lockedZones: SemanticZone[]
  ) {
    super();
  }
  protected apply({ doc }: CommandContext): void {
    // 关键防护：禁止将全图透明像素批量划入非背景遮罩
    if (this.colorIdx === TRANSPARENT_INDEX && this.target !== SemanticZone.Background) return;
    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (doc.pixelIndices[i] !== this.colorIdx) continue;
      const current = doc.semanticMask[i] as SemanticZone;
      if (this.lockedZones.includes(current) || current === this.target) continue;
      doc.semanticMask[i] = this.target;
      this.count++;
    }
  }
}

/** 用新识别出的遮罩替换当前遮罩 (识别由 ViewModel 事先完成，命令只保存结果) */
export class SetMaskCommand extends SnapshotCommand {
  readonly name = 'SetMask';
  constructor(private readonly mask: Uint8Array) {
    super();
  }
  protected apply({ doc }: CommandContext): void {
    doc.semanticMask.set(this.mask);
  }
}
