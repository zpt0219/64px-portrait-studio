import { PixelTool, RectSelection } from '../core/types';
import { TRANSPARENT_INDEX, paletteIndexLabel } from '../core/constants';
import { IMAGE_WIDTH, IMAGE_HEIGHT } from '../core/pixelGrid';
import { clampToCanvas } from '../core/session';
import { layersOf } from '../core/document';
import { Patch, FULL_CANVAS, extractPatch, findOuterWhiteOffsets } from '../core/editOps';
import {
  MovePatchCommand,
  PastePatchCommand,
  ClearRectCommand,
  ReplaceColorCommand,
  ClearPixelsCommand,
} from '../command/pixelCommands';
import { FlipCommand, RotateCommand } from '../command/transformCommands';
import { SetPaletteColorCommand, ResetPaletteCommand, nextGestureId } from '../command/paletteCommands';
import { SubViewModel, StudioContext } from './subViewModel';

export class PixelViewModel implements SubViewModel {
  private clipboard: Patch | null = null;

  constructor(private readonly ctx: StudioContext) {}

  // ===================== 生命周期与清理 =====================

  canExit(callback: (allowed: boolean) => void): void {
    callback(true);
  }

  cleanup(): void {
    this.ctx.endStroke();
  }

  enter(): void {
    this.ctx.patchSession({
      activeMode: 'pixel',
      showMaskOverlay: false,
    });
    this.ctx.notify('🎨 已切换至【像素修图模式】(快捷键: Q)');
  }

  // ===================== 色板与颜色 =====================

  nextGestureId(): number {
    return nextGestureId();
  }

  selectPaletteIndex(index: number): void {
    this.ctx.setMode('pixel', () => {
      this.ctx.patchSession({ activePaletteIndex: index });
      this.ctx.notify(`🎨 前景色: #${paletteIndexLabel(index)} ${this.ctx.doc.palette[index] || '透明'}`);
    });
  }

  pickColor(colorIdx: number, isBg: boolean): void {
    this.ctx.setMode('pixel', () => {
      if (isBg) {
        this.ctx.patchSession({ bgPaletteIndex: colorIdx });
        this.ctx.notify(`🎨 已吸取背景色: #${paletteIndexLabel(colorIdx)} ${this.ctx.doc.palette[colorIdx] || '透明'}`);
      } else {
        this.ctx.patchSession({ activePaletteIndex: colorIdx });
        this.ctx.notify(`🎨 已吸取前景色: #${paletteIndexLabel(colorIdx)} ${this.ctx.doc.palette[colorIdx] || '透明'}`);
      }
    });
  }

  selectBgPaletteIndex(index: number): void {
    this.ctx.setMode('pixel', () => {
      this.ctx.patchSession({ bgPaletteIndex: index });
      this.ctx.notify(`🎨 背景色: #${paletteIndexLabel(index)} ${this.ctx.doc.palette[index] || '透明'}`);
    });
  }

  swapFgBgColors(): void {
    const { activePaletteIndex, bgPaletteIndex } = this.ctx.session;
    this.ctx.patchSession({ activePaletteIndex: bgPaletteIndex, bgPaletteIndex: activePaletteIndex });
    this.ctx.notify('⇄ 已交换前景色与背景色 (快捷键: X)');
  }

  setActiveTool(tool: PixelTool): void {
    this.ctx.setMode('pixel', () => this.ctx.patchSession({ activeTool: tool }));
  }

  setBucketConnectivity(conn: 8 | 4): void {
    this.ctx.patchSession({ bucketConnectivity: conn });
    this.ctx.notify(`🪣 油漆桶连通邻域已设为: ${conn} 邻居`);
  }

  setPaletteColor(index: number, hex: string, gesture = 0): void {
    if (this.ctx.isDisposed || index === TRANSPARENT_INDEX) return;
    this.ctx.execute(new SetPaletteColorCommand(index, hex, gesture));
  }

  resetPalette(index?: number | null): void {
    if (this.ctx.isDisposed) return;
    if (index === undefined || index === null) {
      this.resetAllPalette();
      return;
    }
    if (index === TRANSPARENT_INDEX) return;
    this.ctx.execute(new ResetPaletteCommand(index));
    this.ctx.notify(`已将颜色 #${paletteIndexLabel(index)} 还原为默认 36 色配色`);
  }

  resetActiveColorToDefault(): void {
    if (this.ctx.isDisposed) return;
    const idx = this.ctx.session.activePaletteIndex;
    if (idx === TRANSPARENT_INDEX) return;
    this.ctx.execute(new ResetPaletteCommand(idx));
    this.ctx.notify(`已将颜色 #${paletteIndexLabel(idx)} 还原为默认 36 色配色`);
  }

  requestResetAllPalette(): void {
    if (this.ctx.isDisposed) return;
    this.ctx.confirm({
      icon: '🎨',
      title: '恢复默认色板',
      message: '确定要将全部 36 色色板重置为初始调色板吗？',
      subMessage: '所有微调过的颜色将被覆盖还原。',
      buttons: [
        { label: '重置色板', className: 'btn-danger', onClick: () => this.resetAllPalette() },
        { label: '取消', className: 'btn-ghost', onClick: () => {} },
      ],
    });
  }

  private resetAllPalette(): void {
    if (this.ctx.isDisposed) return;
    this.ctx.execute(new ResetPaletteCommand(null));
    this.ctx.notify('已将全部 36 色调色板还原为默认 GBA 规范配色');
  }

  resetAllColors(): void {
    this.requestResetAllPalette();
  }

  // ===================== 选区与剪贴板 =====================

  moveSelection(patch: Patch, from: RectSelection, toX: number, toY: number, copy: boolean): void {
    this.ctx.execute(new MovePatchCommand(patch, from, toX, toY, copy, []));
  }

  flipContent(axis: 'horizontal' | 'vertical'): void {
    if (!this.ctx.session.isLoaded) return;
    const selection = this.ctx.session.selection;
    this.ctx.execute(new FlipCommand(selection ?? FULL_CANVAS, axis, []));
    const label = axis === 'horizontal' ? '↔ 水平' : '↕ 垂直';
    this.ctx.notify(`${label}翻转${selection ? '选区' : '整张画布'}完成`);
  }

  rotateContentCW(): void {
    if (!this.ctx.session.isLoaded) return;
    const selection = this.ctx.session.selection;
    this.ctx.execute(new RotateCommand(selection ?? FULL_CANVAS, selection !== null, []));
    this.ctx.notify(`↻ 顺时针旋转${selection ? '选区' : '整张画布'} 90° 完成`);
  }

  removeOuterWhite(): void {
    if (!this.ctx.session.isLoaded) {
      this.ctx.notify('请先载入 64×64 像素头像后再扣除白底', 'warning');
      return;
    }
    const toClear = findOuterWhiteOffsets(this.ctx.doc, this.ctx.session.lockedMaskZones);
    if (toClear.length === 0) {
      this.ctx.notify('ℹ️ 未检测到外围连通的白色背景像素', 'info');
      return;
    }
    this.ctx.execute(new ClearPixelsCommand(toClear));
    this.ctx.notify(`✂️ 已扣除 ${toClear.length} 个外围背景白像素为原生透明色 (人物眼白与高光完好)`, 'success');
  }

  replaceColor(fromIdx: number, toIdx: number, scope: 'selection' | 'all'): void {
    if (!this.ctx.session.isLoaded) return;
    if (fromIdx === toIdx) {
      this.ctx.notify('原颜色与目标颜色相同，无需替换', 'warning');
      return;
    }
    const rect = scope === 'selection' ? this.ctx.session.selection ?? FULL_CANVAS : FULL_CANVAS;
    const cmd = new ReplaceColorCommand(fromIdx, toIdx, rect, []);
    this.ctx.execute(cmd);
    if (cmd.count > 0) {
      this.ctx.notify(`🔄 已成功在${scope === 'selection' ? '选区内' : '整张画布'}替换 ${cmd.count} 个像素点`, 'success');
    } else {
      this.ctx.notify('未找到匹配的原颜色像素点', 'info');
    }
  }

  setSelection(selection: RectSelection | null): void {
    this.ctx.patchSession({ selection: selection ? clampToCanvas(selection) : null });
  }

  clearSelection(): boolean {
    if (!this.ctx.session.selection) return false;
    this.ctx.patchSession({ selection: null });
    return true;
  }

  selectAll(): void {
    this.setSelection({ x: 0, y: 0, w: IMAGE_WIDTH, h: IMAGE_HEIGHT });
  }

  hasClipboard(): boolean {
    return this.clipboard !== null;
  }

  copySelection(): boolean {
    const selection = this.ctx.session.selection;
    if (!this.ctx.session.isLoaded || !selection) return false;
    this.clipboard = extractPatch(layersOf(this.ctx.doc, []), selection);
    return true;
  }

  cutSelection(): boolean {
    return this.copySelection() && this.deleteSelectionContent();
  }

  deleteSelectionContent(): boolean {
    const selection = this.ctx.session.selection;
    if (!this.ctx.session.isLoaded || !selection) return false;
    return this.ctx.execute(new ClearRectCommand(selection, []));
  }

  pasteClipboard(): boolean {
    const clip = this.clipboard;
    if (!clip || !this.ctx.session.isLoaded) return false;
    const selection = this.ctx.session.selection;
    const x = Math.min(
      selection ? selection.x : Math.max(0, Math.floor((IMAGE_WIDTH - clip.w) / 2)),
      Math.max(0, IMAGE_WIDTH - clip.w)
    );
    const y = Math.min(
      selection ? selection.y : Math.max(0, Math.floor((IMAGE_HEIGHT - clip.h) / 2)),
      Math.max(0, IMAGE_HEIGHT - clip.h)
    );
    return this.ctx.execute(new PastePatchCommand(clip, x, y));
  }
}
