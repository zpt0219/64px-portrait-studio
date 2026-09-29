/**
 * ViewModel (对应 tile_map_editor_imgui 的 ViewModel)：
 * - 每个用户意图一个方法，文档修改一律构造命令交给 CommandHandler，会话状态直接修改后广播 onSessionChanged；
 * - 实现 StudioEvents，作为命令事件的唯一接收者，扇出给所有已注册的监听者 (面板)；
 * - 不接触界面 DOM：提示消息走 onNotify 事件，需要用户确认的流程走注入的 StudioPrompts。
 */

import { SemanticZone, ZONE_CONFIG, ALL_ZONES, ProjectData, RectSelection, PixelTool, MaskTool, EditorMode, BrushSize } from '../types';
import { RAMPS_INFO, TRANSPARENT_INDEX, MATCH_COLOR_PRESETS, paletteIndexLabel } from '../data/palette';
import { Rgb, hexToRgb, quantizeToPalette } from '../core/colorUtils';
import { detectHairPreset, recolorHair } from '../core/recolorEngine';
import { computeSemanticMask } from '../core/segmentation';
import { floodFill, borderOffsets, PIXEL_COUNT, IMAGE_WIDTH as W, IMAGE_HEIGHT as H } from '../core/pixelGrid';
import { Patch, FULL_CANVAS, extractPatch } from '../core/editOps';
import { saveProjectDebounced, loadProjectFromStorage, clearProjectStorage, projectDataToDocument } from '../core/storage';
import { exportProjectPng, exportProjectZip } from '../core/zipExporter';
import { PortraitDocument, createEmptyDocument, layersOf } from '../model/document';
import { EditorSession, createInitialSession, clampToCanvas, ZOOM_STEPS } from '../model/session';
import { CommandContext } from '../command/command';
import { CommandHandler } from '../command/commandHandler';
import { StudioEvents, ToastLevel, SaveStatus } from '../command/events';
import {
  StrokeCommand,
  MovePatchCommand,
  PastePatchCommand,
  ClearRectCommand,
  ReplaceColorCommand,
  ClearPixelsCommand,
} from '../command/pixelCommands';
import { FlipCommand, RotateCommand } from '../command/transformCommands';
import { MaskBoxSelectCommand, AssignColorToZoneCommand, SetMaskCommand } from '../command/maskCommands';
import {
  SetPaletteColorCommand,
  ResetPaletteCommand,
  SetHairPresetCommand,
  CommitHairRecolorCommand,
} from '../command/paletteCommands';

export interface PromptButton {
  label: string;
  className?: string; // 'btn-primary' / 'btn-outline' / 'btn-ghost' ...
  onClick: () => void;
}

export interface PromptOptions {
  icon?: string;
  title: string;
  message: string;
  subMessage?: string;
  buttons: PromptButton[];
}

/** 由界面层实现的确认对话框端口 */
export interface StudioPrompts {
  confirm(options: PromptOptions): void;
}

/** 已按导入规则缩放、居中绘制到 64×64 的图片像素 */
export interface DecodedImage {
  rgba: Uint8ClampedArray; // 64×64×4
  origW: number;
  origH: number;
  targetW: number;
  targetH: number;
}

export class ViewModel implements StudioEvents {
  readonly doc: PortraitDocument = createEmptyDocument();
  readonly session: EditorSession = createInitialSession();

  private readonly ctx: CommandContext;
  private readonly handler: CommandHandler;
  private listeners: StudioEvents[] = [];
  private prompts: StudioPrompts = { confirm: () => {} };
  private clipboard: Patch | null = null;
  private stroke: StrokeCommand | null = null;
  /** 发色预览像素缓存；文档或草稿变化时置空，下次读取时重算 */
  private hairPreview: Uint8Array | null = null;

  constructor() {
    this.ctx = { doc: this.doc, session: this.session, events: this };
    this.handler = new CommandHandler(this.ctx);
  }

  setPrompts(prompts: StudioPrompts): void {
    this.prompts = prompts;
  }

  // ===================== 事件扇出 =====================

  registerListener(listener: StudioEvents): void {
    this.listeners.push(listener);
  }

  unregisterListener(listener: StudioEvents): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  /** 先复制列表再遍历：回调中注册 / 注销监听者也安全 */
  private fanOut(fn: (listener: StudioEvents) => void): void {
    for (const listener of [...this.listeners]) fn(listener);
  }

  onDocumentReplaced(): void {
    this.documentChanged((l) => l.onDocumentReplaced?.());
  }
  onPixelsChanged(): void {
    this.documentChanged((l) => l.onPixelsChanged?.());
  }
  onMaskChanged(): void {
    this.documentChanged((l) => l.onMaskChanged?.());
  }
  onPaletteChanged(): void {
    this.documentChanged((l) => l.onPaletteChanged?.());
  }
  onHairPresetChanged(): void {
    this.documentChanged((l) => l.onHairPresetChanged?.());
  }
  onSessionChanged(keys: (keyof EditorSession)[]): void {
    if (keys.includes('hairDraftPreset')) this.hairPreview = null;
    this.fanOut((l) => l.onSessionChanged?.(keys));
  }
  onHistoryChanged(): void {
    this.fanOut((l) => l.onHistoryChanged?.());
  }
  onContextChanged(): void {
    this.fanOut((l) => l.onContextChanged?.());
  }
  onNotify(message: string, level: ToastLevel): void {
    this.fanOut((l) => l.onNotify?.(message, level));
  }
  onSaveStatus(status: SaveStatus): void {
    this.fanOut((l) => l.onSaveStatus?.(status));
  }

  /** 文档任何部分变化：作废发色预览缓存、广播，并触发防抖自动保存 */
  private documentChanged(fn: (listener: StudioEvents) => void): void {
    this.hairPreview = null;
    this.fanOut(fn);
    if (this.session.isLoaded) {
      this.onSaveStatus('saving');
      saveProjectDebounced(this.doc, () => this.onSaveStatus('saved'));
    }
  }

  notify(message: string, level: ToastLevel = 'info'): void {
    this.onNotify(message, level);
  }

  /** 修改会话状态并广播；遮罩模式下不保留选区 (选区只服务像素模式) */
  private patch(changes: Partial<EditorSession>): void {
    Object.assign(this.session, changes);
    const keys = Object.keys(changes) as (keyof EditorSession)[];
    if (this.session.activeMode === 'mask' && this.session.selection) {
      this.session.selection = null;
      keys.push('selection');
    }
    this.onSessionChanged(keys);
  }

  private get lockedZones(): SemanticZone[] {
    return this.session.lockedMaskZones;
  }

  // ===================== 载入 / 重置 =====================

  /** 整体替换文档 (不走命令栈，清空撤销历史) */
  private replaceDocument(doc: PortraitDocument, session: Partial<EditorSession>): void {
    this.stroke = null;
    Object.assign(this.doc, doc);
    this.patch(session);
    this.handler.clearHistory();
    this.onDocumentReplaced();
  }

  loadProject(data: ProjectData): void {
    this.replaceDocument(projectDataToDocument(data), {
      visibleMaskZones: [SemanticZone.Hair],
      isLoaded: true,
      selection: null,
      hairDraftPreset: null,
    });
  }

  restoreFromStorage(): void {
    const data = loadProjectFromStorage();
    if (!data) {
      this.notify('未找到有效的本地缓存进度', 'warning');
      return;
    }
    this.loadProject(data);
    this.notify('🎉 已成功恢复上次编辑的进度！', 'success');
  }

  /** 导入普通图片：36 色量化 + 自动 5 分区遮罩，作为新项目载入 */
  importImage(image: DecodedImage): void {
    const { rgba, origW, origH, targetW, targetH } = image;
    const rgbPixels: Rgb[] = [];
    const transparent = new Uint8Array(PIXEL_COUNT);
    for (let i = 0; i < PIXEL_COUNT; i++) {
      const o = i * 4;
      if (rgba[o + 3] < 128) {
        transparent[i] = 1;
        rgbPixels.push([255, 255, 255]); // 纯白占位，不影响量化器
      } else {
        rgbPixels.push([rgba[o], rgba[o + 1], rgba[o + 2]]);
      }
    }

    // OKLab 36 色逐像素最近邻量化 (不使用 dithering)
    const palette = this.doc.palette;
    const indices = quantizeToPalette(rgbPixels, palette.map(hexToRgb));
    const mask = this.segment(rgbPixels);
    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (transparent[i]) {
        indices[i] = TRANSPARENT_INDEX;
        mask[i] = SemanticZone.Background;
      }
    }

    this.replaceDocument(
      { palette, pixelIndices: indices, semanticMask: mask, currentHairPreset: detectHairPreset(indices, mask, palette) },
      {
        visibleMaskZones: [SemanticZone.Hair],
        showMaskOverlay: false,
        activeMode: 'pixel',
        lockedMaskZones: [],
        activeMaskTool: 'pen',
        maskBrushSize: 1,
        maskMatchInitialized: false,
        isLoaded: true,
        selection: null,
        hairDraftPreset: null,
      }
    );

    if (origW > 64 || origH > 64) {
      this.notify(`✨ 图片载入成功：原尺寸 ${origW}×${origH} 已智能缩放至 ${targetW}×${targetH} 并完成 36 色量化`, 'success');
    } else if (origW < 64 || origH < 64) {
      this.notify(`✨ 图片载入成功：原尺寸 ${origW}×${origH} 已居中置入 64×64 画布并完成 36 色量化`, 'success');
    } else {
      this.notify('✨ 图片载入成功：已自动完成 36 色量化与 5 分区遮罩生成', 'success');
    }
  }

  /** 语义分割；失败时降级：与左上角颜色相近的视为背景，其余前景保守归为衣服 */
  private segment(pixels: Rgb[]): Uint8Array {
    try {
      return computeSemanticMask(pixels);
    } catch (err) {
      console.warn('Semantic analysis fallback to safe foreground:', err);
      const corner = pixels[0];
      const isCornerBg = (p: Rgb) =>
        Math.abs(p[0] - corner[0]) + Math.abs(p[1] - corner[1]) + Math.abs(p[2] - corner[2]) < 25;
      this.notify('⚠️ 人脸特征识别未达标，请在遮罩模式手动涂抹头发区域', 'warning');
      return Uint8Array.from(pixels, (p) => (isCornerBg(p) ? SemanticZone.Background : SemanticZone.Clothes));
    }
  }

  /** 清空画布与本地缓存；已载入头像时先确认 */
  requestReset(): void {
    if (!this.session.isLoaded) {
      this.reset();
      return;
    }
    this.prompts.confirm({
      icon: '↺',
      title: '清空画布？',
      message: '确定要清空画布吗？当前工作区及本地自动存盘缓存将被清除。',
      buttons: [
        { label: '清空画布', className: 'btn-primary', onClick: () => this.reset() },
        { label: '取消', className: 'btn-ghost', onClick: () => {} },
      ],
    });
  }

  private reset(): void {
    clearProjectStorage();
    this.replaceDocument(createEmptyDocument(), createInitialSession());
    this.notify('已清空画布并重启新任务');
  }

  // ===================== 模式、工具与颜色 =====================

  /**
   * 切换工作模式，完成 (或已在目标模式) 后执行 onProceed。
   * 离开遮罩模式前若有未固化的发色预览，先让用户选择应用或放弃。
   */
  setMode(mode: EditorMode, onProceed?: () => void): void {
    if (mode === this.session.activeMode) {
      onProceed?.();
      return;
    }

    if (mode === 'pixel' && this.hasHairDraft()) {
      const switchToPixel = () => {
        this.applyMode('pixel');
        onProceed?.();
      };
      this.confirmHairDraft({
        icon: '🎨',
        title: '应用发色修改？',
        message: `检测到您正在预览发色【${this.hairDraftName()}】，尚未固化到画面。`,
        subMessage: '切换到像素绘制模式前，是否将当前发色修改应用到画布？',
        applyLabel: '✓ 应用并切换',
        onApplied: switchToPixel,
        otherLabel: '✕ 放弃修改并切换',
        onOther: () => {
          this.discardHairRecolor();
          switchToPixel();
        },
        cancelLabel: '留在蒙版模式',
      });
      return;
    }

    this.applyMode(mode);
    onProceed?.();
  }

  private applyMode(mode: EditorMode): void {
    const s = this.session;
    if (mode === 'pixel') {
      this.patch({ activeMode: 'pixel', showMaskOverlay: false });
      return;
    }
    const changes: Partial<EditorSession> = { activeMode: 'mask', showMaskOverlay: true };
    if (s.activeTool === 'select' || s.activeTool === 'eyedropper') changes.activeTool = 'pen';
    if (s.visibleMaskZones.length === 0) changes.visibleMaskZones = [s.activeZone || SemanticZone.Hair];
    // 仅在首次进入遮罩模式时按预设初始化匹配色组，之后切换不再重置
    if (!s.maskMatchInitialized) {
      const preset = MATCH_COLOR_PRESETS.find((p) => p.id === s.maskMatchPresetKey) || MATCH_COLOR_PRESETS[0];
      changes.maskMatchInitialized = true;
      changes.maskMatchPresetKey = preset.id;
      changes.maskMatchColors = preset.getIndices(this.doc.palette, this.doc.currentHairPreset);
    }
    this.patch(changes);
  }

  selectPaletteIndex(index: number): void {
    this.setMode('pixel', () => {
      const tool = this.session.activeTool;
      const changes: Partial<EditorSession> = { activePaletteIndex: index };
      // 选区、吸管，或橡皮擦时选了具体颜色：自动切回画笔
      if (tool === 'select' || tool === 'eyedropper' || (tool === 'eraser' && index !== TRANSPARENT_INDEX)) {
        changes.activeTool = 'pen';
      }
      this.patch(changes);
      if (index === TRANSPARENT_INDEX) {
        this.notify(`已选择前景色：[透明色] (绘制透明/删除)`);
      } else {
        this.notify(`已选择前景色 #${index} (${this.doc.palette[index]})`);
      }
    });
  }

  /** 从画布吸管取色 (保持当前工具不变，避免拖拽微动误涂抹) */
  pickColor(colorIdx: number, isBg: boolean): void {
    if (isBg) {
      this.selectBgPaletteIndex(colorIdx);
      return;
    }
    this.setMode('pixel', () => {
      this.patch({ activePaletteIndex: colorIdx });
      if (colorIdx === TRANSPARENT_INDEX) {
        this.notify(`🧪 已吸取前景色：[透明色]`);
      } else {
        this.notify(`🧪 已吸取前景色 #${colorIdx} (${this.doc.palette[colorIdx]})`);
      }
    });
  }

  selectBgPaletteIndex(index: number): void {
    this.setMode('pixel', () => {
      this.patch({ bgPaletteIndex: index });
      if (index === TRANSPARENT_INDEX) {
        this.notify(`已设置背景色：[透明色] (鼠标右键直接擦除)`);
      } else {
        this.notify(`已设置背景色 #${index} (${this.doc.palette[index]}) (右键绘制)`);
      }
    });
  }

  swapFgBgColors(): void {
    const { activePaletteIndex, bgPaletteIndex } = this.session;
    this.patch({ activePaletteIndex: bgPaletteIndex, bgPaletteIndex: activePaletteIndex });
    this.notify(`⇄ 已交换前景色与背景色`);
  }

  setActiveTool(tool: PixelTool): void {
    this.setMode('pixel', () => this.patch({ activeTool: tool }));
  }

  setBucketConnectivity(conn: 8 | 4): void {
    this.patch({ bucketConnectivity: conn });
    this.notify(conn === 8 ? '🪣 油漆桶：已切换为 8 邻居连通 (含对角线)' : '🪣 油漆桶：已切换为 4 邻居连通 (十字四向)');
  }

  setZoom(zoom: number): void {
    this.patch({ zoomLevel: zoom });
  }

  /** 按缩放档位步进 (direction: +1 放大，-1 缩小) */
  stepZoom(direction: number): void {
    const current = this.session.zoomLevel;
    let idx = ZOOM_STEPS.indexOf(current as (typeof ZOOM_STEPS)[number]);
    if (idx === -1) idx = 2;
    const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + direction))];
    if (next !== current) this.setZoom(next);
  }

  setGrid(show: boolean): void {
    this.patch({ showGrid: show });
  }

  // ===================== 色板 =====================

  /** 取色器微调颜色；gesture 标识一次连续拖动，同一次拖动合并为一步撤销 */
  setPaletteColor(index: number, hex: string, gesture: number): void {
    if (index === TRANSPARENT_INDEX) return;
    this.handler.execute(new SetPaletteColorCommand(index, hex, gesture));
  }

  resetActiveColorToDefault(): void {
    const idx = this.session.activePaletteIndex;
    if (idx === TRANSPARENT_INDEX) return;
    this.handler.execute(new ResetPaletteCommand(idx));
    this.notify(`已还原色板 #${idx} 为默认值 (${this.doc.palette[idx]})`);
  }

  requestResetAllPalette(): void {
    this.prompts.confirm({
      icon: '🎨',
      title: '恢复默认色板？',
      message: '确定要将全部色板恢复为默认的 GBA 36 色板吗？',
      buttons: [
        { label: '恢复默认 36 色', className: 'btn-primary', onClick: () => this.resetAllPalette() },
        { label: '取消', className: 'btn-ghost', onClick: () => {} },
      ],
    });
  }

  private resetAllPalette(): void {
    this.handler.execute(new ResetPaletteCommand(null));
    this.notify('已重置全部 36 色板为 GBA 默认值');
  }

  // ===================== 遮罩分区 =====================

  setActiveZone(zone: SemanticZone, solo = false): void {
    const s = this.session;
    const changes: Partial<EditorSession> = { activeZone: zone, activeMode: 'mask', showMaskOverlay: true };
    if (s.activeTool === 'select' || s.activeTool === 'eyedropper') changes.activeTool = 'pen';
    if (solo || s.visibleMaskZones.length <= 1) {
      changes.visibleMaskZones = [zone];
    } else if (!s.visibleMaskZones.includes(zone)) {
      changes.visibleMaskZones = [...s.visibleMaskZones, zone];
    }
    this.patch(changes);
  }

  toggleZoneVisibility(zone: SemanticZone, visible: boolean): void {
    const current = new Set(this.session.visibleMaskZones);
    const changes: Partial<EditorSession> = {};
    if (visible) {
      current.add(zone);
      Object.assign(changes, { activeZone: zone, activeMode: 'mask', showMaskOverlay: true });
    } else {
      current.delete(zone);
      if (current.size === 0) {
        Object.assign(changes, { showMaskOverlay: false, activeMode: 'pixel' });
      } else if (this.session.activeZone === zone) {
        changes.activeZone = Array.from(current)[0];
      }
    }
    changes.visibleMaskZones = Array.from(current);
    this.patch(changes);
  }

  setAllZonesVisibility(visible: boolean): void {
    this.patch(
      visible
        ? { visibleMaskZones: [...ALL_ZONES], activeMode: 'mask', showMaskOverlay: true }
        : { visibleMaskZones: [], showMaskOverlay: false, activeMode: 'pixel' }
    );
  }

  toggleLockZone(zone: SemanticZone): void {
    const meta = ZONE_CONFIG[zone];
    const locked = new Set(this.session.lockedMaskZones);
    if (locked.has(zone)) {
      locked.delete(zone);
      this.notify(`🔓 已解锁「${meta.name}」遮罩，现在可以编辑`);
    } else {
      locked.add(zone);
      this.notify(`🔒 已锁定「${meta.name}」遮罩，受保护防止被其他遮罩或橡皮擦覆盖！`, 'success');
    }
    this.patch({ lockedMaskZones: Array.from(locked) });
  }

  setMaskOpacity(opacity: number): void {
    this.patch({ maskOpacity: opacity });
  }

  setActiveMaskTool(tool: MaskTool): void {
    this.patch({ activeMaskTool: tool });
  }

  setMaskBrushSize(size: BrushSize): void {
    this.patch({ maskBrushSize: size });
    this.notify(`🎯 遮罩笔刷尺寸: ${size}×${size} 像素`);
  }

  changeMaskBrushSize(delta: number): void {
    const current = this.session.maskBrushSize;
    const next = Math.max(1, Math.min(4, current + delta)) as BrushSize;
    if (next !== current) this.setMaskBrushSize(next);
  }

  // ===================== 智能框选匹配色组 =====================

  setMaskMatchPreset(presetKey: string): void {
    const preset = MATCH_COLOR_PRESETS.find((p) => p.id === presetKey);
    if (!preset) return;
    const colors = preset.getIndices(this.doc.palette, this.doc.currentHairPreset);
    this.patch({ maskMatchPresetKey: presetKey, maskMatchColors: colors });
    this.notify(`🎯 已加载【${preset.name}】(${colors.length} 色) 到智能框选组`);
  }

  addMaskMatchColor(colorIdx: number): void {
    const colors = this.session.maskMatchColors;
    if (colors.includes(colorIdx)) {
      this.notify(`颜色 #${paletteIndexLabel(colorIdx)} 已在匹配组中`, 'info');
      return;
    }
    this.patch({ maskMatchColors: [...colors, colorIdx], maskMatchPresetKey: 'custom' });
    const hex = this.doc.palette[colorIdx] || (colorIdx === TRANSPARENT_INDEX ? 'transparent' : '#000000');
    this.notify(`➕ 已将颜色 #${paletteIndexLabel(colorIdx)} (${hex}) 加入框选匹配组`);
  }

  removeMaskMatchColor(colorIdx: number): void {
    const colors = this.session.maskMatchColors;
    if (!colors.includes(colorIdx)) return;
    this.patch({ maskMatchColors: colors.filter((c) => c !== colorIdx), maskMatchPresetKey: 'custom' });
    this.notify(`✕ 已从框选匹配组移除颜色 #${paletteIndexLabel(colorIdx)}`);
  }

  /** 智能框选：框内匹配色像素划入 (add) 或剔除出 (remove) 当前分区 */
  maskBoxSelect(rect: RectSelection, action: 'add' | 'remove'): void {
    if (!this.session.isLoaded) return;
    const matchColors = new Set(this.session.maskMatchColors);
    if (matchColors.size === 0) {
      this.notify('当前匹配色组为空，请先在工具箱选择预设或添加颜色', 'warning');
      return;
    }
    const target = this.session.activeZone;
    const zoneMeta = ZONE_CONFIG[target];
    if (action === 'add' && this.lockedZones.includes(target)) {
      this.notify(`目标分区【${zoneMeta.name}】已锁定，请先解锁后再操作`, 'warning');
      return;
    }

    const cmd = new MaskBoxSelectCommand(rect, action, matchColors, target, this.lockedZones);
    this.handler.execute(cmd);
    if (cmd.count === 0) {
      this.notify('框选范围内未找到符合当前匹配色组的未锁定像素', 'info');
    } else if (action === 'add') {
      this.notify(`✨ 已将框内 ${cmd.count} 个匹配像素划入【${zoneMeta.shortName}】遮罩`, 'success');
    } else {
      this.notify(`🧼 已将框内 ${cmd.count} 个匹配像素从【${zoneMeta.shortName}】遮罩剔除`, 'info');
    }
  }

  /** 全图该颜色的非锁定像素一键划入当前分区 */
  assignColorToZone(colorIdx: number): void {
    if (!this.session.isLoaded) {
      this.notify('请先载入图片后再执行操作', 'warning');
      return;
    }
    const target = this.session.activeZone;
    const zoneMeta = ZONE_CONFIG[target];
    if (this.lockedZones.includes(target)) {
      this.notify(`目标分区【${zoneMeta.name}】已锁定，请先解锁后再操作`, 'warning');
      return;
    }

    const cmd = new AssignColorToZoneCommand(colorIdx, target, this.lockedZones);
    this.handler.execute(cmd);
    if (cmd.count > 0) {
      const colorHex = this.doc.palette[colorIdx] || `#${colorIdx}`;
      this.notify(`✨ 已将 ${cmd.count} 个 ${colorHex} 像素划入【${zoneMeta.shortName}】遮罩`, 'success');
    } else {
      this.notify('该颜色的像素均已在当前分区中，或受到图层锁定保护', 'info');
    }
  }

  /** 基于当前像素重新识别语义遮罩 (锁定分区保留原值)，并进入遮罩模式 */
  recomputeSemanticMask(): void {
    if (!this.session.isLoaded) return;
    const { pixelIndices, semanticMask } = this.doc;
    const paletteRgb = this.doc.palette.map(hexToRgb);
    // 透明像素以纯白作为背景基准传入分析器
    const pixels: Rgb[] = Array.from(pixelIndices, (idx) =>
      idx === TRANSPARENT_INDEX ? [255, 255, 255] : paletteRgb[idx] || [0, 0, 0]
    );

    const mask = this.segment(pixels);
    const locked = new Set(this.lockedZones);
    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (pixelIndices[i] === TRANSPARENT_INDEX) mask[i] = SemanticZone.Background;
      if (locked.has(semanticMask[i])) mask[i] = semanticMask[i];
    }
    this.handler.execute(new SetMaskCommand(mask));

    this.patch({
      activeMode: 'mask',
      showMaskOverlay: true,
      visibleMaskZones: this.session.visibleMaskZones.length === 0 ? [...ALL_ZONES] : this.session.visibleMaskZones,
    });
    this.notify('✨ 语义遮罩已重新识别完成并进入遮罩模式！', 'success');
  }

  // ===================== 发色预览 =====================

  hasHairDraft(): boolean {
    return this.session.hairDraftPreset !== null;
  }

  hairDraftName(): string {
    return RAMPS_INFO[this.session.hairDraftPreset!]?.name || '新发色';
  }

  /** 画布显示用的像素：有发色草稿时为基于当前文档实时计算的预览，否则为文档像素 */
  displayPixels(): Uint8Array {
    const draft = this.session.hairDraftPreset;
    if (!draft) return this.doc.pixelIndices;
    if (!this.hairPreview) {
      const { pixelIndices, semanticMask, palette, currentHairPreset } = this.doc;
      this.hairPreview = recolorHair(pixelIndices, semanticMask, palette, currentHairPreset, draft);
    }
    return this.hairPreview;
  }

  /** 非破坏性预览 9 大发色预设之一 (不修改文档，可反复切换) */
  applyHairPreset(presetKey: string): void {
    if (!this.session.isLoaded) return;
    const ramp = RAMPS_INFO[presetKey];
    if (!ramp) return;
    if (!this.doc.semanticMask.includes(SemanticZone.Hair)) {
      this.notify('当前遮罩中未标记任何头发 (Hair) 区域，请先涂抹遮罩', 'warning');
      return;
    }
    this.patch({ hairDraftPreset: presetKey });
    this.notify(`🎨 正在预览发色: ${ramp.name} (${ramp.icon})，离开蒙版模式前可自由试色`);
  }

  /** 固化发色预览到文档 */
  commitHairRecolor(): void {
    if (!this.hasHairDraft()) return;
    const name = this.hairDraftName();
    this.handler.execute(new CommitHairRecolorCommand(new Uint8Array(this.displayPixels()), this.session.hairDraftPreset!));
    this.patch({ hairDraftPreset: null });
    this.notify(`✓ 发色【${name}】已成功应用并固化到画布！`, 'success');
  }

  discardHairRecolor(): void {
    if (!this.hasHairDraft()) return;
    this.patch({ hairDraftPreset: null });
    this.notify('已放弃发色预览，恢复为原图', 'info');
  }

  openHairRecolorPrompt(): void {
    if (!this.hasHairDraft()) return;
    this.confirmHairDraft({
      icon: '💇',
      title: '固化或还原发色',
      message: `当前正在预览发色【${this.hairDraftName()}】。`,
      subMessage: '请选择是否将此发色固化应用到画面中，或放弃并还原：',
      applyLabel: '✓ 确认应用并固化',
      onApplied: () => {},
      otherLabel: '✕ 放弃修改并还原',
      onOther: () => this.discardHairRecolor(),
      cancelLabel: '继续试色',
    });
  }

  /** 发色卡下拉框：设定当前发色预设 */
  setHairPreset(presetKey: string): void {
    this.handler.execute(new SetHairPresetCommand(presetKey));
  }

  /** 未固化发色预览的三选一对话框：第一个按钮先固化再执行 onApplied，第三个按钮什么都不做 */
  private confirmHairDraft(o: {
    icon: string;
    title: string;
    message: string;
    subMessage: string;
    applyLabel: string;
    onApplied: () => void;
    otherLabel: string;
    onOther: () => void;
    cancelLabel: string;
  }): void {
    this.prompts.confirm({
      icon: o.icon,
      title: o.title,
      message: o.message,
      subMessage: o.subMessage,
      buttons: [
        {
          label: o.applyLabel,
          className: 'btn-primary',
          onClick: () => {
            this.commitHairRecolor();
            o.onApplied();
          },
        },
        { label: o.otherLabel, className: 'btn-outline', onClick: o.onOther },
        { label: o.cancelLabel, className: 'btn-ghost', onClick: () => {} },
      ],
    });
  }

  // ===================== 画布编辑 =====================

  /** 鼠标按下：按当前工具开始一次笔划 (之后逐点 strokeAt，松开时 endStroke) */
  beginStroke(button: 0 | 2, shiftKey: boolean): void {
    if (!this.session.isLoaded) return;
    const s = this.session;
    const cmd = new StrokeCommand({
      mode: s.activeMode,
      pixelTool: s.activeTool,
      maskTool: s.activeMaskTool,
      button,
      replaceAll: shiftKey,
      fg: s.activePaletteIndex,
      bg: s.bgPaletteIndex,
      zone: s.activeZone,
      lockedZones: [...s.lockedMaskZones],
      brushSize: s.maskBrushSize,
      selection: s.selection,
      diagonal: s.bucketConnectivity === 8,
    });
    if (cmd.init(this.ctx)) this.stroke = cmd;
  }

  strokeAt(x: number, y: number): void {
    this.stroke?.dab(this.ctx, x, y);
  }

  /** 鼠标松开：整笔有改动时入撤销栈 */
  endStroke(): void {
    const cmd = this.stroke;
    this.stroke = null;
    if (cmd?.end(this.ctx)) this.handler.commitExecuted(cmd);
  }

  /** 选区拖动放下：把 patch 从 from 移到 (toX, toY)，copy 为 true 时保留原位置 */
  moveSelection(patch: Patch, from: RectSelection, toX: number, toY: number, copy: boolean): void {
    this.handler.execute(new MovePatchCommand(patch, from, toX, toY, copy, this.lockedZones));
  }

  /** 翻转：有选区时翻转选区内容，否则翻转整张画布 */
  flipContent(axis: 'horizontal' | 'vertical'): void {
    if (!this.session.isLoaded) return;
    const selection = this.session.selection;
    this.handler.execute(new FlipCommand(selection ?? FULL_CANVAS, axis, this.lockedZones));
    const label = axis === 'horizontal' ? '↔ 水平' : '↕ 垂直';
    this.notify(`${label}翻转${selection ? '选区' : '整张画布'}完成`);
  }

  /** 顺时针旋转 90°：有选区时旋转选区内容 (选区随之变形)，否则旋转整张画布 */
  rotateContentCW(): void {
    if (!this.session.isLoaded) return;
    const selection = this.session.selection;
    this.handler.execute(new RotateCommand(selection ?? FULL_CANVAS, selection !== null, this.lockedZones));
    this.notify(`↻ 顺时针旋转${selection ? '选区' : '整张画布'} 90° 完成`);
  }

  /** 把从画布边缘 4-连通可达的白色像素改为透明 (眼睛分区与锁定分区不受影响) */
  removeOuterWhite(): void {
    if (!this.session.isLoaded) {
      this.notify('请先载入 64×64 像素头像后再扣除白底', 'warning');
      return;
    }
    const { pixelIndices, semanticMask, palette } = this.doc;
    const locked = new Set(this.lockedZones);
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
      this.notify('ℹ️ 未检测到外围连通的白色背景像素', 'info');
      return;
    }
    this.handler.execute(new ClearPixelsCommand(toClear));
    this.notify(`✂️ 已扣除 ${toClear.length} 个外围背景白像素为原生透明色 (人物眼白与高光完好)`, 'success');
  }

  /** 在选区 (scope 为 selection 时) 或整张画布内把 from 色替换为 to 色 */
  replaceColor(fromIdx: number, toIdx: number, scope: 'selection' | 'all'): void {
    if (!this.session.isLoaded) return;
    if (fromIdx === toIdx) {
      this.notify('原颜色与目标颜色相同，无需替换', 'warning');
      return;
    }
    const rect = scope === 'selection' ? this.session.selection ?? FULL_CANVAS : FULL_CANVAS;
    const cmd = new ReplaceColorCommand(fromIdx, toIdx, rect, this.lockedZones);
    this.handler.execute(cmd);
    if (cmd.count > 0) {
      this.notify(`🔄 已成功在${scope === 'selection' ? '选区内' : '整张画布'}替换 ${cmd.count} 个像素点`, 'success');
    } else {
      this.notify('未找到匹配的原颜色像素点', 'info');
    }
  }

  // ===================== 选区与剪贴板 =====================

  setSelection(selection: RectSelection | null): void {
    this.patch({ selection: selection ? clampToCanvas(selection) : null });
  }

  /** 取消选区，返回之前是否有选区 */
  clearSelection(): boolean {
    if (!this.session.selection) return false;
    this.patch({ selection: null });
    return true;
  }

  selectAll(): void {
    this.setSelection({ x: 0, y: 0, w: W, h: H });
  }

  hasClipboard(): boolean {
    return this.clipboard !== null;
  }

  copySelection(): boolean {
    const selection = this.session.selection;
    if (!this.session.isLoaded || !selection) return false;
    this.clipboard = extractPatch(layersOf(this.doc, this.lockedZones), selection);
    return true;
  }

  cutSelection(): boolean {
    return this.copySelection() && this.deleteSelectionContent();
  }

  /** 把选区内容清空为透明 (保护锁定分区的遮罩)，返回是否有变化 */
  deleteSelectionContent(): boolean {
    const selection = this.session.selection;
    if (!this.session.isLoaded || !selection) return false;
    return this.handler.execute(new ClearRectCommand(selection, this.lockedZones));
  }

  /** 粘贴到当前选区左上角 (无选区时居中)，粘贴结果成为新选区 */
  pasteClipboard(): boolean {
    const clip = this.clipboard;
    if (!clip || !this.session.isLoaded) return false;
    const selection = this.session.selection;
    const x = Math.min(selection ? selection.x : Math.max(0, Math.floor((W - clip.w) / 2)), Math.max(0, W - clip.w));
    const y = Math.min(selection ? selection.y : Math.max(0, Math.floor((H - clip.h) / 2)), Math.max(0, H - clip.h));
    return this.handler.execute(new PastePatchCommand(clip, x, y));
  }

  // ===================== 撤销与重做 =====================

  canUndo(): boolean {
    return this.handler.canUndo();
  }

  canRedo(): boolean {
    return this.handler.canRedo();
  }

  undo(): void {
    this.stepHistory(() => this.handler.undo(), '↩️ 撤销成功');
  }

  redo(): void {
    this.stepHistory(() => this.handler.redo(), '↪️ 重做成功');
  }

  /** 未固化的发色预览先放弃；遮罩模式下恢复出来的选区不保留 */
  private stepHistory(step: () => boolean, message: string): void {
    if (this.hasHairDraft()) this.discardHairRecolor();
    if (!step()) return;
    if (this.session.activeMode === 'mask' && this.session.selection) this.patch({ selection: null });
    this.notify(message);
  }

  // ===================== 导出 =====================

  exportPng(): void {
    this.exportWithHairDraftCheck({
      notLoadedMessage: '请先载入头像后再导出 PNG',
      icon: '💾',
      title: '导出 PNG 发色确认',
      notCommittedText: '尚未固化到画布',
      subMessage: '请选择如何导出该头像 PNG：',
      applyLabel: '✓ 应用新发色并导出',
      originalLabel: '以原图发色导出',
      doExport: async () => {
        try {
          await exportProjectPng(this.doc);
          this.notify('🎉 纯净 64×64 PNG 导出成功！(极简无损体积，约 400 字节)', 'success');
        } catch (err) {
          console.error('Export PNG failed:', err);
          this.notify('导出 PNG 失败', 'error');
        }
      },
    });
  }

  exportZip(): void {
    this.exportWithHairDraftCheck({
      notLoadedMessage: '请先载入头像后再导出工程 ZIP',
      icon: '📦',
      title: '导出 ZIP 发色确认',
      notCommittedText: '尚未固化到工程中',
      subMessage: '请选择如何打包导出工程 ZIP：',
      applyLabel: '✓ 应用新发色并打包',
      originalLabel: '以原图发色打包',
      doExport: async () => {
        this.notify('📦 正在打包工程 ZIP (含各倍率渲染图、5色遮罩、图层与色板)...', 'info');
        try {
          await exportProjectZip(this.doc);
          this.notify('🎉 工程 ZIP 打包下载完成！已包含完整元数据、渲染图、遮罩及色板', 'success');
        } catch (err) {
          console.error('Export ZIP failed:', err);
          this.notify('导出工程 ZIP 失败', 'error');
        }
      },
    });
  }

  /** 导出前若有未固化的发色预览，先让用户选择「应用后导出」或「按原发色导出」 */
  private exportWithHairDraftCheck(o: {
    notLoadedMessage: string;
    icon: string;
    title: string;
    notCommittedText: string;
    subMessage: string;
    applyLabel: string;
    originalLabel: string;
    doExport: () => Promise<void>;
  }): void {
    if (!this.session.isLoaded) {
      this.notify(o.notLoadedMessage, 'warning');
      return;
    }
    if (!this.hasHairDraft()) {
      void o.doExport();
      return;
    }
    this.confirmHairDraft({
      icon: o.icon,
      title: o.title,
      message: `当前处于发色【${this.hairDraftName()}】预览状态，${o.notCommittedText}。`,
      subMessage: o.subMessage,
      applyLabel: o.applyLabel,
      onApplied: () => void o.doExport(),
      otherLabel: o.originalLabel,
      onOther: () => void o.doExport(),
      cancelLabel: '取消',
    });
  }
}
