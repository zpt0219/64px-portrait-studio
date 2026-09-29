/**
 * 变换命令：选区或整张画布的翻转、顺时针旋转 90°
 */

import { SemanticZone, RectSelection } from '../types';
import { flipRect, rotateRectCW } from '../core/editOps';
import { layersOf } from '../model/document';
import { clampToCanvas } from '../model/session';
import { CommandContext, SnapshotCommand } from './command';

export class FlipCommand extends SnapshotCommand {
  readonly name = 'Flip';
  constructor(
    private readonly rect: RectSelection,
    private readonly axis: 'horizontal' | 'vertical',
    private readonly lockedZones: SemanticZone[]
  ) {
    super();
  }
  protected apply({ doc }: CommandContext): void {
    flipRect(layersOf(doc, this.lockedZones), this.rect, this.axis);
  }
}

/** 旋转 rect 内容；rect 是选区时选区随之变形 */
export class RotateCommand extends SnapshotCommand {
  readonly name = 'Rotate';
  constructor(
    private readonly rect: RectSelection,
    private readonly isSelection: boolean,
    private readonly lockedZones: SemanticZone[]
  ) {
    super();
  }
  protected apply({ doc, session }: CommandContext): void {
    const rotated = rotateRectCW(layersOf(doc, this.lockedZones), this.rect);
    if (this.isSelection) session.selection = clampToCanvas(rotated);
  }
}
