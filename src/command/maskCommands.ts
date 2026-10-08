/**
 * 遮罩类命令：智能框选、颜色一键转遮罩、重新识别语义遮罩。
 * 核心算法逻辑统一收拢于 editOps，命令负责快照与历史生命周期。
 */

import { SemanticZone, RectSelection } from '../core/types';
import {
  FULL_CANVAS,
  MaskBoxSelectAction,
  boxSelectMask,
  assignColorToMask,
} from '../core/editOps';
import { layersOf } from '../core/document';
import { normalizeTransparentMask } from '../core/projectData';
import { PIXEL_COUNT } from '../core/pixelGrid';
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
    private readonly action: MaskBoxSelectAction,
    private readonly matchColors: Set<number>,
    private readonly target: SemanticZone,
    private readonly lockedZones: SemanticZone[]
  ) {
    super();
  }
  protected apply({ doc }: CommandContext): void {
    const layers = layersOf(doc, this.lockedZones);
    this.count = boxSelectMask(layers, this.rect, this.action, this.matchColors, this.target);
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
    const layers = layersOf(doc, this.lockedZones);
    this.count = assignColorToMask(layers, this.colorIdx, this.target, FULL_CANVAS);
  }
}

/** 用新识别出的遮罩替换当前遮罩 (识别由 ViewModel 事先完成，命令只保存结果) */
export class SetMaskCommand extends SnapshotCommand {
  readonly name = 'SetMask';
  constructor(private readonly mask: Uint8Array) {
    super();
  }

  override init(ctx: CommandContext): boolean {
    if (!this.mask || this.mask.length !== PIXEL_COUNT) {
      return false;
    }
    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (this.mask[i] > SemanticZone.Clothes) {
        return false;
      }
    }
    return super.init(ctx);
  }

  protected apply({ doc }: CommandContext): void {
    doc.semanticMask.set(this.mask);
    normalizeTransparentMask(doc.pixelIndices, doc.semanticMask);
  }
}
