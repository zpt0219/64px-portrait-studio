/**
 * 色板与发色命令
 */

import { PALETTE_36 } from '../data/palette';
import { Command, CommandContext, SnapshotCommand } from './command';

/**
 * 修改一个色板颜色。同一次取色器拖动 (gesture 相同) 内的连续修改合并成一步撤销。
 */
export class SetPaletteColorCommand extends SnapshotCommand {
  readonly name = 'SetPaletteColor';
  constructor(private readonly index: number, private hex: string, private readonly gesture: number) {
    super();
  }
  protected apply({ doc }: CommandContext): void {
    doc.palette[this.index] = this.hex;
  }
  mergeWith(next: Command, ctx: CommandContext): boolean {
    if (!(next instanceof SetPaletteColorCommand) || next.gesture !== this.gesture || next.index !== this.index) {
      return false;
    }
    this.hex = next.hex;
    this.apply(ctx);
    this.finish(ctx, true);
    return true;
  }
}

/** 把一个色板颜色 (index) 或全部 36 色 (index 为 null) 恢复为默认值 */
export class ResetPaletteCommand extends SnapshotCommand {
  readonly name = 'ResetPalette';
  constructor(private readonly index: number | null) {
    super();
  }
  protected apply({ doc }: CommandContext): void {
    if (this.index === null) doc.palette = [...PALETTE_36];
    else doc.palette[this.index] = PALETTE_36[this.index];
  }
}

/** 设定当前发色预设 (发色卡下拉框) */
export class SetHairPresetCommand extends SnapshotCommand {
  readonly name = 'SetHairPreset';
  constructor(private readonly presetKey: string) {
    super();
  }
  protected apply({ doc }: CommandContext): void {
    doc.currentHairPreset = this.presetKey;
  }
}

/** 固化发色预览：写入预览像素并记下新发色预设 */
export class CommitHairRecolorCommand extends SnapshotCommand {
  readonly name = 'CommitHairRecolor';
  constructor(private readonly pixels: Uint8Array, private readonly presetKey: string) {
    super();
  }
  protected apply({ doc }: CommandContext): void {
    doc.pixelIndices.set(this.pixels);
    doc.currentHairPreset = this.presetKey;
  }
}
