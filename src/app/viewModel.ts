/**
 * ViewModel (父中枢与协调器 StudioViewModel)：
 * - 拥有独立的双子 ViewModel：pixel (PixelViewModel) 与 mask (MaskViewModel)；
 * - 管理底层 PortraitDocument 与 EditorSession，负责持久化与文件导出；
 * - 协调模式切换 (canExit -> cleanup -> enter 严格生命周期)；
 * - 接收并分发 StudioEvents，对外提供干净统一的门面 (Facade)。
 */

import { SemanticZone, ProjectData, RectSelection, PixelTool, MaskTool, EditorMode, BrushSize, DecodedImage, HairPresetKey } from '../core/types';
import { AutosaveService, StorageSaveResult } from './services/AutosaveService';
import { projectDataToDocument } from '../core/projectData';
import { ExportBackend, PromptOptions, StudioPrompts, unavailableExports } from './ports';
import { PortraitDocument, createEmptyDocument, cloneDocument } from '../core/document';
import { EditorSession, createInitialSession, ZOOM_STEPS } from '../core/session';
import { Command, CommandContext } from '../command/command';
import { CommandHandler } from '../command/commandHandler';
import { StudioEvents, ToastLevel, SaveStatus } from '../command/events';
import { StrokeCommand } from '../command/pixelCommands';
import { Patch } from '../core/editOps';
import { processDecodedImage } from '../core/imageImport';
import { StudioContext } from './subViewModel';
import { PixelViewModel } from './pixelViewModel';
import { MaskViewModel } from './maskViewModel';

export class ViewModel implements StudioEvents {
  readonly doc: PortraitDocument = createEmptyDocument();
  readonly session: EditorSession = createInitialSession();

  readonly pixel: PixelViewModel;
  readonly mask: MaskViewModel;

  private documentGeneration = 0;
  private strokeGeneration = 0;
  private readonly autosave: AutosaveService;
  private readonly exports: ExportBackend;

  private readonly ctx: CommandContext;
  private readonly handler: CommandHandler;
  private listeners: StudioEvents[] = [];
  private prompts: StudioPrompts = { confirm: () => {} };
  private pendingPrompt: (() => void) | null = null;
  private stroke: StrokeCommand | null = null;
  private _isDisposed = false;

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  getDocumentGeneration(): number {
    return this.documentGeneration;
  }

  constructor(options?: { autosave?: AutosaveService; exports?: ExportBackend }) {
    this.autosave = options?.autosave ?? new AutosaveService();
    this.exports = options?.exports ?? unavailableExports;
    this.ctx = { doc: this.doc, session: this.session, events: this };
    this.handler = new CommandHandler(this.ctx);

    const studioContext = this.createStudioContext();
    this.pixel = new PixelViewModel(studioContext);
    this.mask = new MaskViewModel(studioContext);
  }

  private createStudioContext(): StudioContext {
    const self = this;
    return {
      doc: this.doc,
      session: this.session,
      get isDisposed() {
        return self._isDisposed;
      },
      getDocumentGeneration: () => this.documentGeneration,
      execute: (cmd) => this.execute(cmd),
      patchSession: (changes) => this.patch(changes),
      notify: (msg, lvl) => this.notify(msg, lvl),
      confirm: (opts) => this.confirmWithGeneration(opts),
      endStroke: () => this.endStroke(),
      setMode: (mode, onProceed) => this.setMode(mode, onProceed),
      notifyPreviewChanged: () => this.onPreviewChanged(),
    };
  }

  // ===================== 命令执行与会话管理 =====================

  execute(cmd: Command): boolean {
    if (this._isDisposed) return false;
    if (this.stroke) {
      this.endStroke();
    }
    return this.handler.execute(cmd);
  }

  executeCommand(cmd: Command): boolean {
    return this.execute(cmd);
  }

  patchSession(changes: Partial<EditorSession>): void {
    if (this._isDisposed) return;
    this.patch(changes);
  }

  setPrompts(prompts: StudioPrompts): void {
    this.prompts = prompts;
  }

  private confirmWithGeneration(options: PromptOptions): void {
    if (this._isDisposed) {
      options.onDismiss?.();
      return;
    }
    this.endStroke();
    this.cancelPendingPrompt();
    const gen = this.documentGeneration;
    let settled = false;
    const dismiss = () => {
      if (settled) return;
      settled = true;
      if (this.pendingPrompt === dismiss) this.pendingPrompt = null;
      options.onDismiss?.();
    };
    this.pendingPrompt = dismiss;
    const guardedButtons = options.buttons.map((b) => ({
      ...b,
      onClick: () => {
        if (settled) return;
        if (this._isDisposed || this.documentGeneration !== gen) {
          dismiss();
          return;
        }
        settled = true;
        if (this.pendingPrompt === dismiss) this.pendingPrompt = null;
        b.onClick();
      },
    }));
    this.prompts.confirm({
      ...options,
      buttons: guardedButtons,
      onDismiss: dismiss,
    });
  }

  private cancelPendingPrompt(): void {
    const dismiss = this.pendingPrompt;
    this.pendingPrompt = null;
    dismiss?.();
    this.prompts.dismiss?.();
  }

  /** 幂等销毁：刷新挂起自动保存，清空监听器，禁止后续写入 */
  dispose(): void {
    if (this._isDisposed) return;
    this.endStroke();
    this.cancelPendingPrompt();
    this.pixel.cleanup();
    this.mask.cleanup();
    this.mask.invalidateTrial();
    this.autosave.dispose();
    this._isDisposed = true;
    this.listeners = [];
  }

  flushAutosave(): StorageSaveResult | null {
    if (this._isDisposed) return null;
    this.endStroke();
    return this.autosave.flush();
  }

  // ===================== 事件扇出 =====================

  registerListener(listener: StudioEvents): void {
    this.listeners.push(listener);
  }

  unregisterListener(listener: StudioEvents): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  private fanOut(fn: (listener: StudioEvents) => void): void {
    if (this._isDisposed) return;
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
    this.mask.refreshHairMatchColors();
    this.documentChanged((l) => l.onPaletteChanged?.());
  }
  onHairPresetChanged(): void {
    this.mask.refreshHairMatchColors();
    this.documentChanged((l) => l.onHairPresetChanged?.());
  }
  onPreviewChanged(): void {
    this.fanOut((l) => l.onPreviewChanged?.());
  }
  onSessionChanged(keys: (keyof EditorSession)[]): void {
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

  private documentChanged(fn: (listener: StudioEvents) => void): void {
    if (this._isDisposed) return;
    if (this.session.isLoaded) {
      this.onSaveStatus('saving');
      const gen = this.documentGeneration;
      this.autosave.saveDebounced(this.doc, (result) => {
        if (this._isDisposed || this.documentGeneration !== gen) return;
        if (result.success) {
          this.onSaveStatus('saved');
        } else {
          this.onSaveStatus('error');
          this.notify('自动保存失败: 存储空间不足或受限', 'error');
        }
      });
    }
    this.fanOut(fn);
  }

  // ===================== 便捷辅助 =====================

  notify(message: string, level: ToastLevel = 'info'): void {
    if (this._isDisposed) return;
    this.onNotify(message, level);
  }

  private patch(changes: Partial<EditorSession>): void {
    if (this._isDisposed) return;
    const keys = Object.keys(changes) as (keyof EditorSession)[];
    if (keys.length === 0) return;
    const strokeFields: (keyof EditorSession)[] = [
      'activeMode', 'activeTool', 'activeMaskTool', 'activePaletteIndex', 'bgPaletteIndex',
      'activeZone', 'maskBrushSize', 'bucketConnectivity', 'lockedMaskZones', 'selection',
      'maskMatchColors',
    ];
    if (keys.some((k) => strokeFields.includes(k))) this.endStroke();
    Object.assign(this.session, changes);
    this.onSessionChanged(keys);
  }

  private get lockedZones(): SemanticZone[] {
    return this.session.lockedMaskZones;
  }

  // ===================== 文档生命周期 =====================

  private replaceDocument(doc: PortraitDocument, session: Partial<EditorSession>): void {
    if (this._isDisposed) return;
    this.documentGeneration++;
    this.stroke = null;
    this.cancelPendingPrompt();
    this.autosave.cancel();
    this.pixel.cleanup();
    this.mask.cleanup();
    this.mask.invalidateTrial();

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

  loadProject(data: ProjectData): void {
    if (this._isDisposed) return;
    const { document: doc, warnings } = projectDataToDocument(data);
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
    });
    if (warnings.length > 0) {
      this.notify(warnings.join('；'), 'warning');
    }
  }

  hasSavedProject(): boolean {
    return !this._isDisposed && this.autosave.hasSaved();
  }

  restoreFromStorage(): void {
    if (this._isDisposed) return;
    const data = this.autosave.load();
    if (!data) {
      this.notify('未检测到已暂存的有效工程数据', 'warning');
      return;
    }
    this.loadProject(data);
    this.notify('🎉 已成功从本地缓存恢复上次编辑进度！', 'success');
  }

  importImage(image: DecodedImage): void {
    if (this._isDisposed) return;
    const result = processDecodedImage(image, this.doc.palette);
    this.replaceDocument(result.document, {
      visibleMaskZones: [], showMaskOverlay: false, activeMode: 'pixel',
      activeZone: SemanticZone.Hair, lockedMaskZones: [], activeMaskTool: 'pen',
      maskBrushSize: 1, maskMatchInitialized: false, isLoaded: true,
      selection: null,
    });
    for (const warning of result.warnings) this.notify(warning, 'warning');
    this.notify(result.importInfo.message, 'success');
  }

  requestReset(): void {
    if (this._isDisposed) return;
    if (!this.session.isLoaded) {
      this.reset();
      return;
    }
    this.confirmWithGeneration({
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

  newBlankProject(): void {
    if (this._isDisposed) return;
    if (this.session.isLoaded) {
      this.confirmWithGeneration({
        icon: '📄',
        title: '新建空白项目',
        message: '确定要新建空白画布吗？',
        subMessage: '当前编辑中的未导出像素修图将被覆盖。',
        buttons: [
          { label: '新建画布', className: 'btn-danger', onClick: () => this.doNewBlankProject() },
          { label: '取消', className: 'btn-ghost', onClick: () => {} },
        ],
      });
      return;
    }
    this.doNewBlankProject();
  }

  private doNewBlankProject(): void {
    if (this._isDisposed) return;
    const doc = createEmptyDocument();
    this.replaceDocument(doc, {
      visibleMaskZones: [],
      showMaskOverlay: false,
      activeMode: 'pixel',
      activeZone: SemanticZone.Hair,
      lockedMaskZones: [],
      activeMaskTool: 'pen',
      maskBrushSize: 1,
      maskMatchInitialized: false,
      isLoaded: true,
      selection: null,
    });
    this.notify('已新建 64×64 空白画布', 'info');
  }

  private reset(): void {
    if (this._isDisposed) return;
    const result = this.autosave.clear();
    this.replaceDocument(createEmptyDocument(), createInitialSession());
    if (result.success) this.notify('已重置画布并清除本地暂存', 'info');
    else this.notify(`已重置画布，但未能清除本地暂存: ${result.error}`, 'warning');
  }

  // ===================== 核心模式切换 (严格生命周期与 Clean-up) =====================

  setMode(mode: EditorMode, onProceed?: () => void): void {
    if (this._isDisposed) return;
    this.endStroke();
    if (this.session.activeMode === mode) {
      onProceed?.();
      return;
    }

    const currentSub = this.session.activeMode === 'mask' ? this.mask : this.pixel;
    const targetSub = mode === 'mask' ? this.mask : this.pixel;

    currentSub.canExit((allowed) => {
      if (!allowed || this._isDisposed) return;
      currentSub.cleanup();
      targetSub.enter();
      onProceed?.();
    });
  }

  // ===================== 色板与颜色 (委托给 PixelViewModel) =====================

  nextGestureId(): number {
    return this.pixel.nextGestureId();
  }

  selectPaletteIndex(index: number): void {
    this.pixel.selectPaletteIndex(index);
  }

  pickColor(colorIdx: number, isBg: boolean): void {
    this.pixel.pickColor(colorIdx, isBg);
  }

  selectBgPaletteIndex(index: number): void {
    this.pixel.selectBgPaletteIndex(index);
  }

  swapFgBgColors(): void {
    this.pixel.swapFgBgColors();
  }

  setActiveTool(tool: PixelTool): void {
    this.pixel.setActiveTool(tool);
  }

  setBucketConnectivity(conn: 8 | 4): void {
    this.pixel.setBucketConnectivity(conn);
  }

  setPaletteColor(index: number, hex: string, gesture = 0): void {
    this.pixel.setPaletteColor(index, hex, gesture);
  }

  resetPalette(index?: number | null): void {
    this.pixel.resetPalette(index);
  }

  resetActiveColorToDefault(): void {
    this.pixel.resetActiveColorToDefault();
  }

  requestResetAllPalette(): void {
    this.pixel.requestResetAllPalette();
  }

  resetAllColors(): void {
    this.pixel.resetAllColors();
  }

  // ===================== 选区与剪贴板 (委托给 PixelViewModel) =====================

  moveSelection(patch: Patch, from: RectSelection, toX: number, toY: number, copy: boolean): void {
    this.pixel.moveSelection(patch, from, toX, toY, copy);
  }

  flipContent(axis: 'horizontal' | 'vertical'): void {
    this.pixel.flipContent(axis);
  }

  rotateContentCW(): void {
    this.pixel.rotateContentCW();
  }

  removeOuterWhite(): void {
    this.pixel.removeOuterWhite();
  }

  replaceColor(fromIdx: number, toIdx: number, scope: 'selection' | 'all'): void {
    this.pixel.replaceColor(fromIdx, toIdx, scope);
  }

  setSelection(selection: RectSelection | null): void {
    this.pixel.setSelection(selection);
  }

  clearSelection(): boolean {
    return this.pixel.clearSelection();
  }

  selectAll(): void {
    this.pixel.selectAll();
  }

  hasClipboard(): boolean {
    return this.pixel.hasClipboard();
  }

  copySelection(): boolean {
    return this.pixel.copySelection();
  }

  cutSelection(): boolean {
    return this.pixel.cutSelection();
  }

  deleteSelectionContent(): boolean {
    return this.pixel.deleteSelectionContent();
  }

  pasteClipboard(): boolean {
    return this.pixel.pasteClipboard();
  }

  // ===================== 遮罩与分区 (委托给 MaskViewModel) =====================

  setActiveZone(zone: SemanticZone, solo = true): void {
    this.mask.setActiveZone(zone, solo);
  }

  toggleZoneVisibility(zone: SemanticZone, visible: boolean): void {
    this.mask.toggleZoneVisibility(zone, visible);
  }

  setAllZonesVisibility(visible: boolean): void {
    this.mask.setAllZonesVisibility(visible);
  }

  toggleLockZone(zone: SemanticZone): void {
    this.mask.toggleLockZone(zone);
  }

  setMaskOpacity(opacity: number): void {
    this.mask.setMaskOpacity(opacity);
  }

  setActiveMaskTool(tool: MaskTool): void {
    this.mask.setActiveMaskTool(tool);
  }

  setMaskBrushSize(size: BrushSize): void {
    this.mask.setMaskBrushSize(size);
  }

  changeMaskBrushSize(delta: number): void {
    this.mask.changeMaskBrushSize(delta);
  }

  setMaskMatchPreset(presetKey: string): void {
    this.mask.setMaskMatchPreset(presetKey);
  }

  setMaskMatchPresetKey(presetKey: string): void {
    this.mask.setMaskMatchPresetKey(presetKey);
  }

  addMaskMatchColor(colorIdx: number): void {
    this.mask.addMaskMatchColor(colorIdx);
  }

  removeMaskMatchColor(colorIdx: number): void {
    this.mask.removeMaskMatchColor(colorIdx);
  }

  toggleMaskMatchColor(colorIdx: number): void {
    this.mask.toggleMaskMatchColor(colorIdx);
  }

  setCustomMaskMatchColors(indices: number[]): void {
    this.mask.setCustomMaskMatchColors(indices);
  }

  maskBoxSelect(rect: RectSelection, action: 'add' | 'remove' | 'subtract' | 'clear'): void {
    this.mask.maskBoxSelect(rect, action);
  }

  boxSelectMask(action: 'add' | 'remove' | 'subtract' | 'clear', rect: RectSelection): void {
    this.mask.boxSelectMask(action, rect);
  }

  assignColorToZone(colorIdx: number): void {
    this.mask.assignColorToZone(colorIdx);
  }

  recomputeSemanticMask(): void {
    this.mask.recomputeSemanticMask();
  }

  // ===================== 发色与预设 (委托给 MaskViewModel) =====================

  applyHairPreset(presetKey: HairPresetKey): void {
    this.mask.applyHairPreset(presetKey);
  }

  setHairPreset(presetKey: HairPresetKey): void {
    this.mask.setHairPreset(presetKey);
  }

  getHairPresetKey(): HairPresetKey {
    return this.mask.getHairPresetKey();
  }

  getHairRampIndices(presetKey?: HairPresetKey): number[] {
    return this.mask.getHairRampIndices(presetKey);
  }

  hasHairDraft(): boolean {
    return this.mask.hasHairDraft();
  }

  hairDraftName(): string {
    return this.mask.hairDraftName();
  }

  displayPixels(): Uint8Array {
    if (this.mask.hasPendingHairTrial) {
      return this.mask.getDisplayPixels(
        this.doc.pixelIndices,
        this.doc.semanticMask,
        this.doc.palette,
        this.doc.currentHairPreset
      );
    }
    return this.doc.pixelIndices;
  }

  discardHairRecolor(): void {
    this.mask.discardHairRecolor();
  }

  commitAllRecolors(): void {
    this.mask.commitAllRecolors();
  }

  discardAllRecolors(): void {
    this.mask.discardAllRecolors();
  }

  // ===================== 画布视图控制 =====================

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

  // ===================== 笔划手势 =====================

  beginStroke(button: 0 | 2, shiftKey: boolean): void {
    if (this._isDisposed || !this.session.isLoaded) return;
    if (this.stroke) {
      this.endStroke();
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
      lockedZones: s.activeMode === 'mask' ? [...this.lockedZones] : [],
      brushSize: s.maskBrushSize,
      selection: s.selection ? { ...s.selection } : null,
      diagonal: s.bucketConnectivity === 8,
    });
    cmd.init(this.ctx);
    this.strokeGeneration = this.documentGeneration;
    this.stroke = cmd;
  }

  strokeAt(x: number, y: number): void {
    if (this._isDisposed) return;
    if (!this.stroke || this.strokeGeneration !== this.documentGeneration) return;
    this.stroke.dab(this.ctx, x, y);
  }

  endStroke(): void {
    if (this._isDisposed) return;
    const s = this.stroke;
    if (!s) return;
    this.stroke = null;
    if (this.strokeGeneration !== this.documentGeneration) return;
    if (s.end(this.ctx)) this.handler.commitExecuted(s);
  }

  // ===================== 撤销与重做 =====================

  canUndo(): boolean {
    if (this.session.activeMode === 'mask' && this.mask.canUndoTrial()) {
      return true;
    }
    return this.handler.canUndo();
  }

  canRedo(): boolean {
    if (this.session.activeMode === 'mask' && this.mask.canRedoTrial()) {
      return true;
    }
    return this.handler.canRedo();
  }

  undo(): void {
    if (this._isDisposed) return;
    if (this.stroke) {
      this.endStroke();
    }
    if (this.session.activeMode === 'mask' && this.mask.canUndoTrial()) {
      this.mask.undoTrial();
      this.onHistoryChanged();
      return;
    }
    this.handler.undo();
  }

  redo(): void {
    if (this._isDisposed) return;
    if (this.stroke) {
      this.endStroke();
    }
    if (this.session.activeMode === 'mask' && this.mask.canRedoTrial()) {
      this.mask.redoTrial();
      this.onHistoryChanged();
      return;
    }
    this.handler.redo();
  }

  // ===================== 导出 =====================

  exportPng(): Promise<void> {
    return this.runExport('png');
  }

  exportZip(): Promise<void> {
    return this.runExport('zip');
  }

  private async runExport(kind: 'png' | 'zip'): Promise<void> {
    if (this._isDisposed || !this.session.isLoaded) return;
    this.endStroke();

    if (this.mask.hasPendingTrial) {
      const descriptions = this.mask.getPendingRecolorDescriptions();
      const isSingleHair = descriptions.length === 1 && descriptions[0].zone === SemanticZone.Hair;
      const title = '导出前换色确认';
      const message = isSingleHair
        ? `当前正在试色新发色【${descriptions[0].previewName}】，尚未固化到画面。`
        : `当前正在试色新配色${descriptions.map((d) => `【${d.name}：${d.previewName}】`).join('、')}，尚未固化到画面。`;
      const subMessage = isSingleHair
        ? '导出文件前，请选择是否将此发色替换应用到画面中：'
        : '导出文件前，请选择是否将这些换色替换应用到画面中：';

      return new Promise<void>((resolve) => {
        this.confirmWithGeneration({
          icon: '💾',
          title,
          message,
          subMessage,
          buttons: [
            {
              label: '✓ 确认换色并导出',
              className: 'btn-primary',
              onClick: async () => {
                this.mask.commitAllRecolors();
                await this.doRunExport(kind);
                resolve();
              },
            },
            {
              label: '✕ 放弃换色并导出',
              className: 'btn-danger',
              onClick: async () => {
                this.mask.discardAllRecolors();
                await this.doRunExport(kind);
                resolve();
              },
            },
            {
              label: '取消导出',
              className: 'btn-ghost',
              onClick: () => {
                resolve();
              },
            },
          ],
          onDismiss: () => {
            resolve();
          },
        });
      });
    }

    return this.doRunExport(kind);
  }

  private async doRunExport(kind: 'png' | 'zip'): Promise<void> {
    if (this._isDisposed || !this.session.isLoaded) return;
    this.endStroke();
    this.flushAutosave();
    const snapshot = cloneDocument(this.doc);
    try {
      if (kind === 'zip') {
        this.notify('正在打包工程 ZIP...', 'info');
        await this.exports.exportZip(snapshot);
        this.notify('🎉 成功导出完整工程 ZIP 包！', 'success');
      } else {
        await this.exports.exportPng(snapshot);
        this.notify('🎉 PNG 导出成功！', 'success');
      }
    } catch (err: unknown) {
      console.error(`Export ${kind} failed:`, err);
      const message = err instanceof Error ? err.message : String(err);
      if (kind === 'zip') {
        this.notify('导出工程 ZIP 失败，请重试', 'error');
      } else {
        this.notify(`PNG 导出失败: ${message}`, 'error');
      }
    }
  }
}
