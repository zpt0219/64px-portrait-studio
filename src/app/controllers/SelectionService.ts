import { RectSelection, SemanticZone, ToastLevel } from '../../types';
import { TRANSPARENT_INDEX } from '../../data/palette';
import { hexToRgb } from '../../core/colorUtils';
import { floodFill, borderOffsets, IMAGE_WIDTH as W, IMAGE_HEIGHT as H } from '../../core/pixelGrid';
import { Patch, FULL_CANVAS, extractPatch } from '../../core/editOps';
import { layersOf, PortraitDocument } from '../../model/document';
import { EditorSession, clampToCanvas } from '../../model/session';
import { Command } from '../../command/command';
import {
  MovePatchCommand,
  PastePatchCommand,
  ClearRectCommand,
  ReplaceColorCommand,
  ClearPixelsCommand,
} from '../../command/pixelCommands';
import { FlipCommand, RotateCommand } from '../../command/transformCommands';

export interface SelectionHost {
  getDoc(): PortraitDocument;
  getSession(): EditorSession;
  getLockedZones(): SemanticZone[];
  executeCommand(cmd: Command): boolean;
  patchSession(patch: Partial<EditorSession>): void;
  notify(message: string, level?: ToastLevel): void;
}

export class SelectionService {
  private clipboard: Patch | null = null;

  constructor(private readonly host: SelectionHost) {}

  moveSelection(patch: Patch, from: RectSelection, toX: number, toY: number, copy: boolean): void {
    this.host.executeCommand(new MovePatchCommand(patch, from, toX, toY, copy, this.host.getLockedZones()));
  }

  /** 翻转：有选区时翻转选区内容，否则翻转整张画布 */
  flipContent(axis: 'horizontal' | 'vertical'): void {
    const session = this.host.getSession();
    if (!session.isLoaded) return;
    const selection = session.selection;
    this.host.executeCommand(new FlipCommand(selection ?? FULL_CANVAS, axis, this.host.getLockedZones()));
    const label = axis === 'horizontal' ? '↔ 水平' : '↕ 垂直';
    this.host.notify(`${label}翻转${selection ? '选区' : '整张画布'}完成`);
  }

  /** 顺时针旋转 90°：有选区时旋转选区内容 (选区随之变形)，否则旋转整张画布 */
  rotateContentCW(): void {
    const session = this.host.getSession();
    if (!session.isLoaded) return;
    const selection = session.selection;
    this.host.executeCommand(new RotateCommand(selection ?? FULL_CANVAS, selection !== null, this.host.getLockedZones()));
    this.host.notify(`↻ 顺时针旋转${selection ? '选区' : '整张画布'} 90° 完成`);
  }

  /** 把从画布边缘 4-连通可达的白色像素改为透明 (眼睛分区与锁定分区不受影响) */
  removeOuterWhite(): void {
    const session = this.host.getSession();
    if (!session.isLoaded) {
      this.host.notify('请先载入 64×64 像素头像后再扣除白底', 'warning');
      return;
    }
    const { pixelIndices, semanticMask, palette } = this.host.getDoc();
    const locked = new Set(this.host.getLockedZones());
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
      this.host.notify('ℹ️ 未检测到外围连通的白色背景像素', 'info');
      return;
    }
    this.host.executeCommand(new ClearPixelsCommand(toClear));
    this.host.notify(`✂️ 已扣除 ${toClear.length} 个外围背景白像素为原生透明色 (人物眼白与高光完好)`, 'success');
  }

  /** 在选区 (scope 为 selection 时) 或整张画布内把 from 色替换为 to 色 */
  replaceColor(fromIdx: number, toIdx: number, scope: 'selection' | 'all'): void {
    const session = this.host.getSession();
    if (!session.isLoaded) return;
    if (fromIdx === toIdx) {
      this.host.notify('原颜色与目标颜色相同，无需替换', 'warning');
      return;
    }
    const rect = scope === 'selection' ? session.selection ?? FULL_CANVAS : FULL_CANVAS;
    const cmd = new ReplaceColorCommand(fromIdx, toIdx, rect, this.host.getLockedZones());
    this.host.executeCommand(cmd);
    if (cmd.count > 0) {
      this.host.notify(`🔄 已成功在${scope === 'selection' ? '选区内' : '整张画布'}替换 ${cmd.count} 个像素点`, 'success');
    } else {
      this.host.notify('未找到匹配的原颜色像素点', 'info');
    }
  }

  setSelection(selection: RectSelection | null): void {
    this.host.patchSession({ selection: selection ? clampToCanvas(selection) : null });
  }

  /** 取消选区，返回之前是否有选区 */
  clearSelection(): boolean {
    if (!this.host.getSession().selection) return false;
    this.host.patchSession({ selection: null });
    return true;
  }

  selectAll(): void {
    this.setSelection({ x: 0, y: 0, w: W, h: H });
  }

  hasClipboard(): boolean {
    return this.clipboard !== null;
  }

  copySelection(): boolean {
    const session = this.host.getSession();
    const selection = session.selection;
    if (!session.isLoaded || !selection) return false;
    this.clipboard = extractPatch(layersOf(this.host.getDoc(), this.host.getLockedZones()), selection);
    return true;
  }

  cutSelection(): boolean {
    return this.copySelection() && this.deleteSelectionContent();
  }

  /** 把选区内容清空为透明 (保护锁定分区的遮罩)，返回是否有变化 */
  deleteSelectionContent(): boolean {
    const session = this.host.getSession();
    const selection = session.selection;
    if (!session.isLoaded || !selection) return false;
    return this.host.executeCommand(new ClearRectCommand(selection, this.host.getLockedZones()));
  }

  /** 粘贴到当前选区左上角 (无选区时居中)，粘贴结果成为新选区 */
  pasteClipboard(): boolean {
    const clip = this.clipboard;
    const session = this.host.getSession();
    if (!clip || !session.isLoaded) return false;
    const selection = session.selection;
    const x = Math.min(selection ? selection.x : Math.max(0, Math.floor((W - clip.w) / 2)), Math.max(0, W - clip.w));
    const y = Math.min(selection ? selection.y : Math.max(0, Math.floor((H - clip.h) / 2)), Math.max(0, H - clip.h));
    return this.host.executeCommand(new PastePatchCommand(clip, x, y));
  }
}
