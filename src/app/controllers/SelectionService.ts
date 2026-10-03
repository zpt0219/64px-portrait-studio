import { RectSelection, SemanticZone } from '../../types';
import { TRANSPARENT_INDEX } from '../../data/palette';
import { hexToRgb } from '../../core/colorUtils';
import { floodFill, borderOffsets, IMAGE_WIDTH as W, IMAGE_HEIGHT as H } from '../../core/pixelGrid';
import { Patch, FULL_CANVAS, extractPatch } from '../../core/editOps';
import { layersOf } from '../../model/document';
import { clampToCanvas } from '../../model/session';
import {
  MovePatchCommand,
  PastePatchCommand,
  ClearRectCommand,
  ReplaceColorCommand,
  ClearPixelsCommand,
} from '../../command/pixelCommands';
import { FlipCommand, RotateCommand } from '../../command/transformCommands';
import type { ViewModel } from '../viewModel';

export class SelectionService {
  private clipboard: Patch | null = null;

  constructor(private readonly vm: ViewModel) {}

  moveSelection(patch: Patch, from: RectSelection, toX: number, toY: number, copy: boolean): void {
    this.vm.commandHandler.execute(new MovePatchCommand(patch, from, toX, toY, copy, this.vm.lockedZonesList));
  }

  /** 翻转：有选区时翻转选区内容，否则翻转整张画布 */
  flipContent(axis: 'horizontal' | 'vertical'): void {
    if (!this.vm.session.isLoaded) return;
    const selection = this.vm.session.selection;
    this.vm.commandHandler.execute(new FlipCommand(selection ?? FULL_CANVAS, axis, this.vm.lockedZonesList));
    const label = axis === 'horizontal' ? '↔ 水平' : '↕ 垂直';
    this.vm.notify(`${label}翻转${selection ? '选区' : '整张画布'}完成`);
  }

  /** 顺时针旋转 90°：有选区时旋转选区内容 (选区随之变形)，否则旋转整张画布 */
  rotateContentCW(): void {
    if (!this.vm.session.isLoaded) return;
    const selection = this.vm.session.selection;
    this.vm.commandHandler.execute(new RotateCommand(selection ?? FULL_CANVAS, selection !== null, this.vm.lockedZonesList));
    this.vm.notify(`↻ 顺时针旋转${selection ? '选区' : '整张画布'} 90° 完成`);
  }

  /** 把从画布边缘 4-连通可达的白色像素改为透明 (眼睛分区与锁定分区不受影响) */
  removeOuterWhite(): void {
    if (!this.vm.session.isLoaded) {
      this.vm.notify('请先载入 64×64 像素头像后再扣除白底', 'warning');
      return;
    }
    const { pixelIndices, semanticMask, palette } = this.vm.doc;
    const locked = new Set(this.vm.lockedZonesList);
    const isBgWhiteOrTransparent = (offset: number): boolean => {
      const idx = pixelIndices[offset];
      if (idx === TRANSPARENT_INDEX) return true; // 透明像素允许通过以连通外围
      if (idx < 0 || idx >= palette.length) return false;
      const zone = semanticMask[offset];
      if (locked.has(zone) || zone === SemanticZone.Eyes) return false; // 保护锁定分区与眼白
      const rgb = hexToRgb(palette[idx]);
      return rgb[0] >= 250 && rgb[1] >= 250 && rgb[2] >= 250;
    };

    const toClear = floodFill(borderOffsets(), isBgWhiteOrTransparent).filter(
      (offset) => pixelIndices[offset] !== TRANSPARENT_INDEX
    );
    if (toClear.length === 0) {
      this.vm.notify('ℹ️ 未检测到外围连通的白色背景像素', 'info');
      return;
    }
    this.vm.commandHandler.execute(new ClearPixelsCommand(toClear));
    this.vm.notify(`✂️ 已扣除 ${toClear.length} 个外围背景白像素为原生透明色 (人物眼白与高光完好)`, 'success');
  }

  /** 在选区 (scope 为 selection 时) 或整张画布内把 from 色替换为 to 色 */
  replaceColor(fromIdx: number, toIdx: number, scope: 'selection' | 'all'): void {
    if (!this.vm.session.isLoaded) return;
    if (fromIdx === toIdx) {
      this.vm.notify('原颜色与目标颜色相同，无需替换', 'warning');
      return;
    }
    const rect = scope === 'selection' ? this.vm.session.selection ?? FULL_CANVAS : FULL_CANVAS;
    const cmd = new ReplaceColorCommand(fromIdx, toIdx, rect, this.vm.lockedZonesList);
    this.vm.commandHandler.execute(cmd);
    if (cmd.count > 0) {
      this.vm.notify(`🔄 已成功在${scope === 'selection' ? '选区内' : '整张画布'}替换 ${cmd.count} 个像素点`, 'success');
    } else {
      this.vm.notify('未找到匹配的原颜色像素点', 'info');
    }
  }

  setSelection(selection: RectSelection | null): void {
    this.vm.patchSession({ selection: selection ? clampToCanvas(selection) : null });
  }

  /** 取消选区，返回之前是否有选区 */
  clearSelection(): boolean {
    if (!this.vm.session.selection) return false;
    this.vm.patchSession({ selection: null });
    return true;
  }

  selectAll(): void {
    this.setSelection({ x: 0, y: 0, w: W, h: H });
  }

  hasClipboard(): boolean {
    return this.clipboard !== null;
  }

  copySelection(): boolean {
    const selection = this.vm.session.selection;
    if (!this.vm.session.isLoaded || !selection) return false;
    this.clipboard = extractPatch(layersOf(this.vm.doc, this.vm.lockedZonesList), selection);
    return true;
  }

  cutSelection(): boolean {
    return this.copySelection() && this.deleteSelectionContent();
  }

  /** 把选区内容清空为透明 (保护锁定分区的遮罩)，返回是否有变化 */
  deleteSelectionContent(): boolean {
    const selection = this.vm.session.selection;
    if (!this.vm.session.isLoaded || !selection) return false;
    return this.vm.commandHandler.execute(new ClearRectCommand(selection, this.vm.lockedZonesList));
  }

  /** 粘贴到当前选区左上角 (无选区时居中)，粘贴结果成为新选区 */
  pasteClipboard(): boolean {
    const clip = this.clipboard;
    if (!clip || !this.vm.session.isLoaded) return false;
    const selection = this.vm.session.selection;
    const x = Math.min(selection ? selection.x : Math.max(0, Math.floor((W - clip.w) / 2)), Math.max(0, W - clip.w));
    const y = Math.min(selection ? selection.y : Math.max(0, Math.floor((H - clip.h) / 2)), Math.max(0, H - clip.h));
    return this.vm.commandHandler.execute(new PastePatchCommand(clip, x, y));
  }
}
