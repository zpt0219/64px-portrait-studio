/**
 * ViewModel (对应 tile_map_editor_imgui 的 ViewModel)：
 * - 每个用户意图一个方法，文档修改一律构造命令交给 CommandHandler，会话状态直接修改后广播 onSessionChanged；
 * - 实现 StudioEvents，作为命令事件的唯一接收者，扇出给所有已注册的监听者 (面板)；
 * - 作为外观门面 (Facade)，将图像导入、发色草稿、选区剪贴板、工程导出委托给领域子控制器；
 * - 不接触界面 DOM：提示消息走 onNotify 事件，需要用户确认的流程走注入的 StudioPrompts。
 */

import { SemanticZone, ZONE_CONFIG, ALL_ZONES, ProjectData, RectSelection, PixelTool, MaskTool, EditorMode, BrushSize, DecodedImage } from '../types';
import { TRANSPARENT_INDEX, MATCH_COLOR_PRESETS, ZONE_DEFAULT_MATCH_PRESET, paletteIndexLabel } from '../data/palette';
import { Rgb, hexToRgb } from '../core/colorUtils';
import { computeSemanticMask } from '../core/segmentation';
import { Patch } from '../core/editOps';
import { saveProjectDebounced, loadProjectFromStorage, clearProjectStorage, projectDataToDocument } from '../core/storage';
import { PortraitDocument, createEmptyDocument } from '../model/document';
import { EditorSession, createInitialSession, ZOOM_STEPS } from '../model/session';
import { CommandContext } from '../command/command';
import { CommandHandler } from '../command/commandHandler';
import { StudioEvents, ToastLevel, SaveStatus } from '../command/events';
import { StrokeCommand } from '../command/pixelCommands';
import { MaskBoxSelectCommand, AssignColorToZoneCommand, SetMaskCommand } from '../command/maskCommands';
import { SetPaletteColorCommand, ResetPaletteCommand } from '../command/paletteCommands';

import { ImageImportPipeline } from './controllers/ImageImportPipeline';
import { HairDraftController } from './controllers/HairDraftController';
import { SelectionService } from './controllers/SelectionService';
import { ExportService } from './controllers/ExportService';

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

export type { DecodedImage };

export class ViewModel implements StudioEvents {
  readonly doc: PortraitDocument = createEmptyDocument();
  readonly session: EditorSession = createInitialSession();

  private readonly ctx: CommandContext;
  private readonly handler: CommandHandler;
  private listeners: StudioEvents[] = [];
  private prompts: StudioPrompts = { confirm: () => {} };
  private stroke: StrokeCommand | null = null;

  // 领域子控制器
  private readonly importPipeline: ImageImportPipeline;
  private readonly hairDraft: HairDraftController;
  private readonly selectionService: SelectionService;
  private readonly exportService: ExportService;

  constructor() {
    this.ctx = { doc: this.doc, session: this.session, events: this };
    this.handler = new CommandHandler(this.ctx);

    this.importPipeline = new ImageImportPipeline(this);
    this.hairDraft = new HairDraftController(this);
    this.selectionService = new SelectionService(this);
    this.exportService = new ExportService(this);
  }

  // ===================== 控制器内部桥接访问 =====================

  get commandHandler(): CommandHandler {
    return this.handler;
  }

  get studioPrompts(): StudioPrompts {
    return this.prompts;
  }

  get lockedZonesList(): SemanticZone[] {
    return this.lockedZones;
  }

  patchSession(changes: Partial<EditorSession>): void {
    this.patch(changes);
  }

  replaceDocumentInternal(doc: PortraitDocument, session: Partial<EditorSession>): void {
    this.replaceDocument(doc, session);
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
    this.hairDraft.invalidatePreview();
    this.documentChanged((l) => l.onDocumentReplaced?.());
  }
  onPixelsChanged(): void {
    this.hairDraft.invalidatePreview();
    this.documentChanged((l) => l.onPixelsChanged?.());
  }
  onMaskChanged(): void {
    this.hairDraft.invalidatePreview();
    this.documentChanged((l) => l.onMaskChanged?.());
  }
  onPaletteChanged(): void {
    this.hairDraft.invalidatePreview();
    this.documentChanged((l) => l.onPaletteChanged?.());
  }
  onHairPresetChanged(): void {
    this.hairDraft.invalidatePreview();
    this.documentChanged((l) => l.onHairPresetChanged?.());
  }
  onSessionChanged(keys: (keyof EditorSession)[]): void {
    if (keys.includes('hairDraftPreset')) this.hairDraft.invalidatePreview();
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

  /** 文档被修改后：先触发防抖自动保存，再扇出事件 */
  private documentChanged(fn: (listener: StudioEvents) => void): void {
    if (this.session.isLoaded) {
      this.onSaveStatus('saving');
      saveProjectDebounced(this.doc, () => this.onSaveStatus('saved'));
    }
    this.fanOut(fn);
  }

  // ===================== 便捷辅助 =====================

  notify(message: string, level: ToastLevel = 'info'): void {
    this.onNotify(message, level);
  }

  /** 修改会话字段并广播变化的 key */
  private patch(changes: Partial<EditorSession>): void {
    const keys = Object.keys(changes) as (keyof EditorSession)[];
    if (keys.length === 0) return;
    Object.assign(this.session, changes);
    this.onSessionChanged(keys);
  }

  /** 当前被锁定的遮罩分区集合 */
  private get lockedZones(): SemanticZone[] {
    return this.session.lockedMaskZones;
  }

  // ===================== 文档生命周期 =====================

  /** 用新文档整体替换当前文档 (载入 / 重置)，同时清空撤销历史 */
  private replaceDocument(doc: PortraitDocument, session: Partial<EditorSession>): void {
    this.doc.palette = [...doc.palette];
    this.doc.pixelIndices = new Uint8Array(doc.pixelIndices);
    this.doc.semanticMask = new Uint8Array(doc.semanticMask);
    this.doc.currentHairPreset = doc.currentHairPreset;

    this.handler.clearHistory();
    this.patch({
      ...session,
      zoomLevel: this.session.zoomLevel,
      showGrid: this.session.showGrid,
      bucketConnectivity: this.session.bucketConnectivity,
    });
    this.onDocumentReplaced();
  }

  /** 从 ProjectData 载入 (工程 ZIP 恢复进度) */
  loadProject(data: ProjectData): void {
    const doc = projectDataToDocument(data);
    this.replaceDocument(doc, {
      visibleMaskZones: [],
      showMaskOverlay: false,
      activeMode: 'pixel',
      lockedMaskZones: [],
      activeMaskTool: 'pen',
      maskBrushSize: 1,
      maskMatchInitialized: false,
      isLoaded: true,
      selection: null,
      hairDraftPreset: null,
    });
  }

  /** 从 localStorage 恢复暂存进度 */
  restoreFromStorage(): void {
    const data = loadProjectFromStorage();
    if (!data) {
      this.notify('未检测到已暂存的有效工程数据', 'warning');
      return;
    }
    this.loadProject(data);
    this.notify('🎉 已成功从本地缓存恢复上次编辑进度！', 'success');
  }

  /** 导入普通图片 (委托给 ImageImportPipeline) */
  importImage(image: DecodedImage): void {
    this.importPipeline.importImage(image);
  }

  /** 清空画布与本地缓存；已载入头像时先确认 */
  requestReset(): void {
    if (!this.session.isLoaded) {
      this.reset();
      return;
    }
    this.prompts.confirm({
      icon: '↺',
      title: '清空画布',
      message: '确定要清空画布吗？',
      subMessage: '所有未导出的像素修图与遮罩数据将被完全重置，并清除本地自动保存记录。',
      buttons: [
        { label: '清空画布', className: 'btn-danger', onClick: () => this.reset() },
        { label: '取消', className: 'btn-ghost', onClick: () => {} },
      ],
    });
  }

  private reset(): void {
    clearProjectStorage();
    this.replaceDocument(createEmptyDocument(), createInitialSession());
    this.notify('已重置画布并清除本地暂存', 'info');
  }

  // ===================== 模式切换 =====================

  setMode(mode: EditorMode, onProceed?: () => void): void {
    if (mode === 'pixel' && this.session.hairDraftPreset !== null) {
      const draftName = this.hairDraft.hairDraftName();
      this.confirmHairDraft({
        icon: '💇',
        title: '切换至画板模式前发色确认',
        message: `当前正在试色新发色【${draftName}】，尚未固化到画面。`,
        subMessage: '切换到画板模式前，请选择是否将此发色替换应用到画面中：',
        applyLabel: '✓ 确认替换并切换',
        onApplied: () => {
          this.applyMode(mode);
          onProceed?.();
        },
        otherLabel: '✕ 放弃替换并切换',
        onOther: () => {
          this.discardHairRecolor();
          this.applyMode(mode);
          onProceed?.();
        },
        cancelLabel: '继续试色',
      });
      return;
    }

    if (this.session.activeMode === mode) {
      onProceed?.();
      return;
    }

    this.applyMode(mode);
    onProceed?.();
  }

  private applyZoneDefaultMatchPreset(zone: SemanticZone, changes: Partial<EditorSession>): void {
    const presetId = ZONE_DEFAULT_MATCH_PRESET[zone] || 'all_non_trans';
    const preset = MATCH_COLOR_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    changes.maskMatchPresetKey = preset.id;
    changes.maskMatchColors = preset.getIndices(this.doc.palette, this.doc.currentHairPreset);
  }

  private ensureMaskMode(changes: Partial<EditorSession>, switchPreset = true): void {
    if (this.session.activeMode !== 'mask') {
      changes.activeMode = 'mask';
      changes.selection = null;
    }
    if (!this.session.maskMatchInitialized) {
      changes.maskMatchInitialized = true;
      if (!changes.visibleMaskZones) {
        changes.visibleMaskZones = [...ALL_ZONES];
      }
      changes.showMaskOverlay = changes.visibleMaskZones.length > 0;
      const targetZone = changes.activeZone ?? this.session.activeZone;
      if (targetZone !== null) {
        this.applyZoneDefaultMatchPreset(targetZone, changes);
      }
    } else if (switchPreset) {
      const targetZone = changes.activeZone ?? this.session.activeZone;
      if (targetZone !== null) {
        this.applyZoneDefaultMatchPreset(targetZone, changes);
      }
    }
  }

  private applyMode(mode: EditorMode): void {
    const changes: Partial<EditorSession> = { activeMode: mode };
    if (mode === 'mask') {
      this.ensureMaskMode(changes, false);
      this.notify('🎭 已切换至【语义遮罩模式】(快捷键: W)');
    } else {
      changes.hairDraftPreset = null;
      this.notify('🎨 已切换至【像素修图模式】(快捷键: Q)');
    }
    this.patch(changes);
  }

  // ===================== 色板与颜色 =====================

  selectPaletteIndex(index: number): void {
    this.setMode('pixel', () => {
      this.patch({ activePaletteIndex: index });
      this.notify(`🎨 前景色: #${paletteIndexLabel(index)} ${this.doc.palette[index] || '透明'}`);
    });
  }

  pickColor(colorIdx: number, isBg: boolean): void {
    this.setMode('pixel', () => {
      if (isBg) {
        this.patch({ bgPaletteIndex: colorIdx });
        this.notify(`🎨 已吸取背景色: #${paletteIndexLabel(colorIdx)} ${this.doc.palette[colorIdx] || '透明'}`);
      } else {
        this.patch({ activePaletteIndex: colorIdx });
        this.notify(`🎨 已吸取前景色: #${paletteIndexLabel(colorIdx)} ${this.doc.palette[colorIdx] || '透明'}`);
      }
    });
  }

  selectBgPaletteIndex(index: number): void {
    this.setMode('pixel', () => {
      this.patch({ bgPaletteIndex: index });
      this.notify(`🎨 背景色: #${paletteIndexLabel(index)} ${this.doc.palette[index] || '透明'}`);
    });
  }

  swapFgBgColors(): void {
    const { activePaletteIndex, bgPaletteIndex } = this.session;
    this.patch({ activePaletteIndex: bgPaletteIndex, bgPaletteIndex: activePaletteIndex });
    this.notify('⇄ 已交换前景色与背景色 (快捷键: X)');
  }

  setActiveTool(tool: PixelTool): void {
    this.setMode('pixel', () => this.patch({ activeTool: tool }));
  }

  setBucketConnectivity(conn: 8 | 4): void {
    this.patch({ bucketConnectivity: conn });
    this.notify(`🪣 油漆桶连通邻域已设为: ${conn} 邻居`);
  }

  setZoom(zoom: number): void {
    if (zoom === this.session.zoomLevel) return;
    this.patch({ zoomLevel: zoom });
  }

  stepZoom(direction: number): void {
    const current = this.session.zoomLevel;
    const idx = ZOOM_STEPS.indexOf(current as typeof ZOOM_STEPS[number]);
    const nextIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, (idx === -1 ? 4 : idx) + direction));
    this.setZoom(ZOOM_STEPS[nextIdx]);
  }

  setGrid(show: boolean): void {
    this.patch({ showGrid: show });
    this.notify(show ? '🔲 网格已开启 (快捷键: G)' : '🔲 网格已隐藏 (快捷键: G)');
  }

  setPaletteColor(index: number, hex: string, gesture: number): void {
    if (index === TRANSPARENT_INDEX) return;
    this.handler.execute(new SetPaletteColorCommand(index, hex, gesture));
  }

  resetActiveColorToDefault(): void {
    const idx = this.session.activePaletteIndex;
    if (idx === TRANSPARENT_INDEX) return;
    this.handler.execute(new ResetPaletteCommand(idx));
    this.notify(`已将颜色 #${paletteIndexLabel(idx)} 还原为默认 36 色配色`);
  }

  requestResetAllPalette(): void {
    this.prompts.confirm({
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
    this.handler.execute(new ResetPaletteCommand(null));
    this.notify('已将全部 36 色调色板还原为默认 GBA 规范配色');
  }

  // ===================== 遮罩与分区 =====================

  setActiveZone(zone: SemanticZone, solo = true): void {
    const changes: Partial<EditorSession> = { activeZone: zone };
    if (solo) {
      changes.visibleMaskZones = [zone];
      changes.showMaskOverlay = true;
    } else if (!this.session.visibleMaskZones.includes(zone)) {
      changes.visibleMaskZones = [...this.session.visibleMaskZones, zone];
      changes.showMaskOverlay = true;
    }
    this.ensureMaskMode(changes);
    this.patch(changes);
    this.notify(`🎭 目标遮罩: 【${ZONE_CONFIG[zone].name}】 (快捷键: ${ZONE_CONFIG[zone].hotkey})`);
  }

  toggleZoneVisibility(zone: SemanticZone, visible: boolean): void {
    const current = new Set(this.session.visibleMaskZones);
    if (visible) current.add(zone);
    else current.delete(zone);
    const visibleMaskZones = ALL_ZONES.filter((z) => current.has(z));
    const showMaskOverlay = visibleMaskZones.length > 0;
    this.patch({ visibleMaskZones, showMaskOverlay });
    if (visibleMaskZones.length === 0 && this.session.activeMode === 'mask') {
      this.setMode('pixel');
    }
  }

  setAllZonesVisibility(visible: boolean): void {
    const visibleMaskZones = visible ? [...ALL_ZONES] : [];
    const showMaskOverlay = visible;
    this.patch({ visibleMaskZones, showMaskOverlay });
    if (!visible) {
      if (this.session.activeMode === 'mask') {
        this.setMode('pixel');
      } else {
        this.notify('已隐藏全部遮罩图层');
      }
    } else {
      this.notify('已显示全部 5 个遮罩图层');
    }
  }

  toggleLockZone(zone: SemanticZone): void {
    const current = new Set(this.session.lockedMaskZones);
    if (current.has(zone)) {
      current.delete(zone);
      this.notify(`🔓 已解锁【${ZONE_CONFIG[zone].name}】遮罩`);
    } else {
      current.add(zone);
      this.notify(`🔒 已锁定【${ZONE_CONFIG[zone].name}】遮罩，受保护不被覆盖或右键擦除`);
    }
    this.patch({ lockedMaskZones: ALL_ZONES.filter((z) => current.has(z)) });
  }

  setMaskOpacity(opacity: number): void {
    this.patch({ maskOpacity: Math.max(0, Math.min(1, opacity)) });
  }

  setActiveMaskTool(tool: MaskTool): void {
    const changes: Partial<EditorSession> = { activeMaskTool: tool };
    this.ensureMaskMode(changes, false);
    this.patch(changes);
  }

  setMaskBrushSize(size: BrushSize): void {
    this.patch({ maskBrushSize: size });
  }

  changeMaskBrushSize(delta: number): void {
    const next = Math.max(1, Math.min(10, this.session.maskBrushSize + delta)) as BrushSize;
    if (next !== this.session.maskBrushSize) {
      this.setMaskBrushSize(next);
      this.notify(`🖌️ 遮罩笔刷尺寸: ${next}×${next}`);
    }
  }

  setMaskMatchPreset(presetKey: string): void {
    const preset = MATCH_COLOR_PRESETS.find((p) => p.id === presetKey);
    if (!preset) return;
    this.patch({
      maskMatchPresetKey: presetKey,
      maskMatchColors: preset.getIndices(this.doc.palette, this.doc.currentHairPreset),
    });
  }

  addMaskMatchColor(colorIdx: number): void {
    const current = this.session.maskMatchColors;
    if (current.includes(colorIdx)) return;
    this.patch({
      maskMatchPresetKey: 'custom',
      maskMatchColors: [...current, colorIdx].sort((a, b) => a - b),
    });
  }

  removeMaskMatchColor(colorIdx: number): void {
    const next = this.session.maskMatchColors.filter((i) => i !== colorIdx);
    this.patch({ maskMatchPresetKey: 'custom', maskMatchColors: next });
  }

  maskBoxSelect(rect: RectSelection, action: 'add' | 'remove' | 'subtract' | 'clear'): void {
    const s = this.session;
    const matchColors = new Set(s.maskMatchColors);
    const target = s.activeZone;
    const targetMeta = ZONE_CONFIG[target];

    if (action !== 'clear' && matchColors.size === 0) {
      this.notify('⚠️ 匹配色组为空，请先在左侧选择颜色组或挑选颜色', 'warning');
      return;
    }

    const cmd = new MaskBoxSelectCommand(rect, action, matchColors, target, this.lockedZones);
    this.handler.execute(cmd);

    if (cmd.count === 0) {
      this.notify('框选范围内未找到符合条件的像素点', 'info');
      return;
    }

    if (action === 'clear') {
      this.notify(`🧹 已从【${targetMeta.name}】中清空 ${cmd.count} 个像素 (右键去所有颜色)`, 'success');
    } else if (action === 'subtract') {
      this.notify(`⚡ 去杂色完成：已将框内 ${cmd.count} 个非匹配色像素从【${targetMeta.name}】剔除`, 'success');
    } else if (action === 'remove') {
      this.notify(`✂️ 去匹配色完成：已将框内 ${cmd.count} 个匹配色像素从【${targetMeta.name}】剔除`, 'success');
    } else {
      this.notify(`✓ 智能划入完成：已将框内 ${cmd.count} 个匹配色像素划入【${targetMeta.name}】`, 'success');
    }
  }

  assignColorToZone(colorIdx: number): void {
    const target = this.session.activeZone;
    const targetMeta = ZONE_CONFIG[target];
    const hex = this.doc.palette[colorIdx] || `#${colorIdx}`;

    const cmd = new AssignColorToZoneCommand(colorIdx, target, this.lockedZones);
    this.handler.execute(cmd);

    if (cmd.count > 0) {
      this.notify(`✨ 已将全图 ${cmd.count} 个颜色 ${hex} 像素一键划入【${targetMeta.name}】！`, 'success');
    } else {
      this.notify('未找到可划入的有效未锁定像素', 'info');
    }
  }

  recomputeSemanticMask(): void {
    if (!this.session.isLoaded) return;
    try {
      const paletteRgb = this.doc.palette.map(hexToRgb);
      const pixels: Rgb[] = Array.from(this.doc.pixelIndices, (idx) =>
        idx === TRANSPARENT_INDEX ? [255, 255, 255] : paletteRgb[idx] || [0, 0, 0]
      );
      const mask = computeSemanticMask(pixels);
      for (let i = 0; i < this.doc.pixelIndices.length; i++) {
        if (this.doc.pixelIndices[i] === TRANSPARENT_INDEX) mask[i] = SemanticZone.Background;
      }
      this.handler.execute(new SetMaskCommand(mask));
      this.notify('✨ 5 分区语义遮罩已基于当前画布像素重新提取完成！', 'success');
    } catch (err) {
      console.error('Recompute mask failed:', err);
      this.notify('重新识别遮罩失败，请检查控制台错误日志', 'error');
    }
  }

  // ===================== 发色草稿 (委托给 HairDraftController) =====================

  hasHairDraft(): boolean {
    return this.hairDraft.hasHairDraft();
  }

  hairDraftName(): string {
    return this.hairDraft.hairDraftName();
  }

  displayPixels(): Uint8Array {
    return this.hairDraft.displayPixels();
  }

  applyHairPreset(presetKey: string): void {
    this.hairDraft.applyHairPreset(presetKey);
  }

  commitHairRecolor(): void {
    this.hairDraft.commitHairRecolor();
  }

  discardHairRecolor(): void {
    this.hairDraft.discardHairRecolor();
  }

  openHairRecolorPrompt(): void {
    this.hairDraft.openHairRecolorPrompt();
  }

  setHairPreset(presetKey: string): void {
    this.hairDraft.setHairPreset(presetKey);
  }

  getHairPresetKey(): string {
    return this.hairDraft.getHairPresetKey();
  }

  getHairRampIndices(presetKey?: string): number[] {
    return this.hairDraft.getHairRampIndices(presetKey);
  }

  confirmHairDraft(o: {
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
    this.hairDraft.confirmHairDraft(o);
  }

  // ===================== 笔划手势 =====================

  /** 鼠标按下：按当前工具开始一次笔划 (之后逐点 strokeAt，松开时 endStroke) */
  beginStroke(button: 0 | 2, shiftKey: boolean): void {
    if (!this.session.isLoaded) return;
    if (this.session.activeMode === 'pixel' && this.session.hairDraftPreset !== null) {
      this.setMode('pixel');
      return;
    }
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
      lockedZones: this.lockedZones,
      brushSize: s.maskBrushSize,
      selection: s.selection,
      diagonal: s.bucketConnectivity === 8,
    });
    cmd.init(this.ctx);
    this.stroke = cmd;
  }

  strokeAt(x: number, y: number): void {
    this.stroke?.dab(this.ctx, x, y);
  }

  endStroke(): void {
    const s = this.stroke;
    if (!s) return;
    this.stroke = null;
    if (s.end(this.ctx)) this.handler.commitExecuted(s);
  }

  // ===================== 选区与剪贴板 (委托给 SelectionService) =====================

  moveSelection(patch: Patch, from: RectSelection, toX: number, toY: number, copy: boolean): void {
    this.selectionService.moveSelection(patch, from, toX, toY, copy);
  }

  flipContent(axis: 'horizontal' | 'vertical'): void {
    this.selectionService.flipContent(axis);
  }

  rotateContentCW(): void {
    this.selectionService.rotateContentCW();
  }

  removeOuterWhite(): void {
    this.selectionService.removeOuterWhite();
  }

  replaceColor(fromIdx: number, toIdx: number, scope: 'selection' | 'all'): void {
    this.selectionService.replaceColor(fromIdx, toIdx, scope);
  }

  setSelection(selection: RectSelection | null): void {
    this.selectionService.setSelection(selection);
  }

  clearSelection(): boolean {
    return this.selectionService.clearSelection();
  }

  selectAll(): void {
    this.selectionService.selectAll();
  }

  hasClipboard(): boolean {
    return this.selectionService.hasClipboard();
  }

  copySelection(): boolean {
    return this.selectionService.copySelection();
  }

  cutSelection(): boolean {
    return this.selectionService.cutSelection();
  }

  deleteSelectionContent(): boolean {
    return this.selectionService.deleteSelectionContent();
  }

  pasteClipboard(): boolean {
    return this.selectionService.pasteClipboard();
  }

  // ===================== 撤销与重做 =====================

  canUndo(): boolean {
    return this.handler.canUndo();
  }

  canRedo(): boolean {
    return this.handler.canRedo();
  }

  undo(): void {
    this.stepHistory(() => this.handler.undo(), '撤销');
  }

  redo(): void {
    this.stepHistory(() => this.handler.redo(), '重做');
  }

  private stepHistory(step: () => boolean, message: string): void {
    if (this.session.hairDraftPreset !== null) {
      this.confirmHairDraft({
        icon: '↩️',
        title: `${message}前发色确认`,
        message: '当前有正在试色的新发色尚未固化。',
        subMessage: `${message}前，请选择是否将此发色固化应用到画面中：`,
        applyLabel: '✓ 应用发色后继续',
        onApplied: () => step(),
        otherLabel: '✕ 放弃预览后继续',
        onOther: () => {
          this.discardHairRecolor();
          step();
        },
        cancelLabel: `取消${message}`,
      });
      return;
    }
    step();
  }

  // ===================== 导出 (委托给 ExportService) =====================

  exportPng(): void {
    this.exportService.exportPng();
  }

  exportZip(): void {
    this.exportService.exportZip();
  }
}
