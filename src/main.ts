/**
 * 应用入口与主控制器：持有全局状态，负责导入、编辑操作、撤销/重做、发色预览、快捷键与各面板同步
 */

import {
  StudioState,
  SemanticZone,
  ZONE_CONFIG,
  ALL_ZONES,
  UndoSnapshot,
  ProjectData,
  RectSelection,
  PixelTool,
  MaskTool,
} from './types';
import { PALETTE_36, RAMPS_INFO, TRANSPARENT_INDEX, MATCH_COLOR_PRESETS, paletteIndexLabel } from './data/palette';
import { Rgb, hexToRgb, quantizeToPalette } from './core/colorUtils';
import { detectHairPreset, recolorHair } from './core/recolorEngine';
import { computeSemanticMask } from './core/segmentation';
import { floodFill, borderOffsets, PIXEL_COUNT } from './core/pixelGrid';
import {
  saveProjectDebounced,
  loadProjectFromStorage,
  hasSavedProject,
  clearProjectStorage,
  projectDataToStatePatch,
} from './core/storage';

import { Header } from './components/Header';
import { CanvasEditor } from './components/CanvasEditor';
import { PalettePanel } from './components/PalettePanel';
import { MaskPanel } from './components/MaskPanel';
import { MaskToolsPanel } from './components/MaskToolsPanel';
import { RealtimePreview } from './components/RealtimePreview';
import { ReplaceColorModal } from './components/ReplaceColorModal';
import { ConfirmModal } from './components/ConfirmModal';
import { exportProjectPng, exportProjectZip, importProjectZip } from './core/zipExporter';
import {
  Layers,
  Patch,
  FULL_CANVAS,
  extractPatch,
  stampPatch,
  clearRect,
  movePatch,
  flipRect,
  rotateRectCW,
  replaceColor,
  floodFillPixels,
  floodFillMask,
} from './core/editOps';

/** 撤销栈上限 */
const UNDO_LIMIT = 40;

class PortraitStudioApp {
  private state: StudioState;
  private header!: Header;
  private canvasEditor!: CanvasEditor;
  private palettePanel!: PalettePanel;
  private maskPanel!: MaskPanel;
  private maskToolsPanel!: MaskToolsPanel;
  private palettePanelWrapper!: HTMLElement;
  private maskToolsPanelWrapper!: HTMLElement;
  private realtimePreview!: RealtimePreview;
  private replaceColorModal!: ReplaceColorModal;
  private confirmModal!: ConfirmModal;
  private toastContainer!: HTMLElement;
  private strokeStartSnapshot: UndoSnapshot | null = null;
  private clipboard: Patch | null = null;

  // 非破坏性发色置换缓冲区与草稿状态
  private hairRecolorBase: Uint8Array | null = null;
  private hairPresetDraft: string | null = null;
  private recoloredPixels: Uint8Array | null = null;
  private hasInitializedMaskMatchPreset = false;

  constructor() {
    this.state = this.createInitialState();
    this.buildDomLayout();
    this.initComponents();
    this.setupSplitterDragging();
    this.setupGlobalKeyboardShortcuts();
    this.checkInitialStorage();
  }

  private createInitialState(): StudioState {
    return {
      palette: [...PALETTE_36],
      pixelIndices: new Uint8Array(PIXEL_COUNT).fill(TRANSPARENT_INDEX),
      semanticMask: new Uint8Array(PIXEL_COUNT),
      currentHairPreset: null,
      activeMode: 'pixel',
      activePaletteIndex: 0,
      bgPaletteIndex: TRANSPARENT_INDEX,
      activeZone: SemanticZone.Hair,
      showMaskOverlay: false,
      visibleMaskZones: [SemanticZone.Hair],
      lockedMaskZones: [],
      activeMaskTool: 'pen',
      maskMatchPresetKey: 'current_hair',
      maskMatchColors: [],
      maskBrushSize: 1,
      maskOpacity: 0.5,
      showGrid: true,
      zoomLevel: 12,
      undoStack: [],
      redoStack: [],
      activeTool: 'pen',
      bucketConnectivity: 8,
      isLoaded: false,
    };
  }

  private buildDomLayout(): void {
    const appEl = document.getElementById('app');
    if (!appEl) throw new Error('Missing #app root element in index.html');

    appEl.innerHTML = `
      <div class="studio-layout">
        <div id="header-mount"></div>
        <main class="studio-main-body" id="studio-main-body">
          <div id="palette-mount" class="main-sidebar-pane palette-sidebar"></div>
          <div class="column-splitter" id="splitter-left" title="拖动调整左栏宽度">
            <div class="splitter-handle"></div>
          </div>
          <div id="canvas-mount" class="main-canvas-pane"></div>
          <div class="column-splitter" id="splitter-right" title="拖动调整右栏宽度">
            <div class="splitter-handle"></div>
          </div>
          <div id="mask-mount" class="main-sidebar-pane mask-sidebar"></div>
        </main>
      </div>
      <div class="toast-container" id="toast-container"></div>
    `;

    this.toastContainer = document.getElementById('toast-container')!;
  }

  private initComponents(): void {
    const headerMount = document.getElementById('header-mount')!;
    const paletteMount = document.getElementById('palette-mount')!;
    const canvasMount = document.getElementById('canvas-mount')!;
    const maskMount = document.getElementById('mask-mount')!;

    // 创建左侧双面板容器：像素面板 (Q) 与 遮罩工具箱 (W)
    paletteMount.innerHTML = `
      <div id="palette-panel-wrapper" style="height: 100%;"></div>
      <div id="mask-tools-panel-wrapper" style="height: 100%; display: none;"></div>
    `;
    this.palettePanelWrapper = paletteMount.querySelector('#palette-panel-wrapper') as HTMLElement;
    this.maskToolsPanelWrapper = paletteMount.querySelector('#mask-tools-panel-wrapper') as HTMLElement;

    this.header = new Header(headerMount, {
      onFileSelect: (file) => this.handleIncomingFile(file),
      onQuickSave: () => this.exportProjectPng(),
      onExportZip: () => this.exportProjectZip(),
      onReset: () => this.confirmReset(),
    });

    this.palettePanel = new PalettePanel(this.palettePanelWrapper, {
      onSelectPaletteColor: (idx) => this.selectPaletteIndex(idx),
      onSelectBgColor: (idx) => this.selectBgPaletteIndex(idx),
      onSwapFgBg: () => this.swapFgBgColors(),
      onModifyPaletteColor: (idx, hex) => this.modifyPaletteColor(idx, hex),
      onBeforePaletteModify: () => this.pushUndoSnapshot(),
      onResetActiveColor: () => this.resetActiveColorToDefault(),
      onResetAllPalette: () => this.resetAllPaletteToDefault(),
      onSelectTool: (tool) => this.setActiveTool(tool),
      onSetBucketConnectivity: (conn) => this.setBucketConnectivity(conn),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onSelectHairRamp: (presetKey) => {
        this.state.currentHairPreset = presetKey;
        this.maskPanel.update(this.state);
      },
      onHighlightPaletteColor: (colorIdx) => {
        this.canvasEditor.setHighlightedColor(colorIdx);
      },
    });

    this.maskToolsPanel = new MaskToolsPanel(this.maskToolsPanelWrapper, {
      onSelectMaskTool: (tool) => this.setActiveMaskTool(tool),
      onSelectBrushSize: (size) => this.setMaskBrushSize(size),
      onSetMatchPreset: (presetKey) => this.setMaskMatchPreset(presetKey),
      onAddMatchColor: (colorIdx) => this.addMaskMatchColor(colorIdx),
      onRemoveMatchColor: (colorIdx) => this.removeMaskMatchColor(colorIdx),
      onAssignColorToZone: (colorIdx) => this.assignColorToZone(colorIdx),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
    });

    this.canvasEditor = new CanvasEditor(canvasMount, {
      onStrokeStart: () => this.onStrokeStart(),
      onPixelDraw: (x, y, paletteIdx) => this.drawPixel(x, y, paletteIdx),
      onMaskDraw: (x, y, zone) => this.drawMask(x, y, zone),
      onStrokeEnd: (didModify) => this.onStrokeEnd(didModify),
      onColorPick: (colorIdx, isBg) => this.pickColorFromCanvas(colorIdx, isBg),
      onFileDrop: (file) => this.handleIncomingFile(file),
      onRestoreStorage: () => this.restoreFromStorage(),
      onTriggerUpload: () => this.header.triggerUpload(),
      onZoomChange: (zoom) => this.setZoom(zoom),
      onGridToggle: (show) => this.setGrid(show),
      onTogglePreview: () => this.toggleRealtimePreview(),
      onRemoveOuterWhite: () => this.removeOuterWhite(),
      onRedrawHook: (offscreenCanvas, isLoaded) => {
        this.realtimePreview.update(offscreenCanvas, isLoaded);
      },
      onOpenReplaceColor: () => this.openReplaceColorModal(),
      onFlipHorizontal: () => this.flipContent('horizontal'),
      onFlipVertical: () => this.flipContent('vertical'),
      onRotateCW: () => this.rotateContentCW(),
      onSetBucketConnectivity: (conn) => this.setBucketConnectivity(conn),
      onMaskBoxSelect: (rect, action) => this.handleMaskBoxSelect(rect, action),
      onBucket: (x, y, button, replaceAll) => this.bucketAt(x, y, button, replaceAll),
      onMoveSelection: (patch, from, toX, toY, copy) => movePatch(this.layers(), patch, from, toX, toY, !copy),
    });

    const viewportEl = this.canvasEditor.getViewportElement() || canvasMount;
    this.realtimePreview = new RealtimePreview(viewportEl, {
      onVisibilityChange: (visible) => {
        this.canvasEditor.setPreviewButtonActive(visible);
      },
    });

    this.maskPanel = new MaskPanel(maskMount, {
      onSelectZone: (zone, solo) => this.setActiveZone(zone, solo),
      onToggleZoneVisibility: (zone, visible) => this.toggleZoneVisibility(zone, visible),
      onSetAllZonesVisibility: (visible) => this.setAllZonesVisibility(visible),
      onToggleLockZone: (zone) => this.toggleLockZone(zone),
      onMaskOpacityChange: (op) => this.setMaskOpacity(op),
      onApplyHairPreset: (key) => this.applyHairPreset(key),
      onOpenHairModal: () => this.openHairRecolorModal(),
      onRecomputeSemanticMask: () => this.recomputeSemanticMask(),
      onActivate: () => this.setMode('mask'),
    });

    this.replaceColorModal = new ReplaceColorModal(document.body, {
      onConfirm: (fromIdx, toIdx, scope) => this.handleReplaceColor(fromIdx, toIdx, scope),
    });

    this.confirmModal = new ConfirmModal(document.body);

    this.syncAllViews();
  }

  private checkInitialStorage(): void {
    if (hasSavedProject()) {
      this.canvasEditor.setHasStorageSnapshot(true);
      this.showToast('检测到上次未完成的编辑进度，可点击中心卡片快速恢复', 'info');
    }
  }

  /**
   * 恢复 LocalStorage 中的工程进度
   */
  public restoreFromStorage(): void {
    const data = loadProjectFromStorage();
    if (!data) {
      this.showToast('未找到有效的本地缓存进度', 'warning');
      return;
    }
    this.loadProjectData(data);
    this.showToast('🎉 已成功恢复上次编辑的进度！', 'success');
  }

  /**
   * 重置工作区并清理 LocalStorage
   */
  public confirmReset(): void {
    if (this.state.isLoaded) {
      if (!confirm('确定要清空画布吗？当前工作区及本地自动存盘缓存将被清除。')) {
        return;
      }
    }
    this.clearHairDraft();
    this.hasInitializedMaskMatchPreset = false;
    clearProjectStorage();
    this.state = this.createInitialState();
    this.canvasEditor.clearSelection();
    this.canvasEditor.setHasStorageSnapshot(false);
    this.syncAllViews();
    this.showToast('已清空画布并重启新任务');
  }

  /**
   * 处理用户拖入或选择的文件 (工程 ZIP 或普通参考图片)
   */
  public async handleIncomingFile(file: File): Promise<void> {
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    const isZip = lowerName.endsWith('.zip') || file.type.includes('zip');
    const isImage =
      file.type.startsWith('image/') ||
      /\.(png|jpe?g|webp|bmp|gif)$/i.test(lowerName);

    if (!isZip && !isImage) {
      this.showToast('仅支持工程 ZIP 包或图片格式文件 (PNG, JPG, WebP 等)', 'error');
      return;
    }

    // 1. 工程 ZIP：完整恢复像素、遮罩与色板
    if (isZip) {
      try {
        const projectData = await importProjectZip(file);
        this.loadProjectData(projectData);
        this.showToast('🎉 成功载入工程 ZIP！已完整恢复画布、遮罩与色板', 'success');
      } catch (err) {
        console.error('Failed to import project zip:', err);
        this.showToast(`导入工程 ZIP 失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
      return;
    }

    // 2. 若为图片文件 (PNG/JPG/WebP)：一律作为【新建项目】载入，不再读取 PNG 附加元数据
    let mimeType = file.type;
    if (!mimeType) {
      if (lowerName.endsWith('.png')) mimeType = 'image/png';
      else if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) mimeType = 'image/jpeg';
      else if (lowerName.endsWith('.webp')) mimeType = 'image/webp';
      else if (lowerName.endsWith('.bmp')) mimeType = 'image/bmp';
      else mimeType = 'image/png';
    }

    try {
      const arrayBuffer = await file.arrayBuffer();

      // 解码图片获取原始物理尺寸
      const img = await this.loadImageFromArrayBuffer(arrayBuffer, mimeType);
      const origW = img.naturalWidth || img.width;
      const origH = img.naturalHeight || img.height;

      if (!origW || !origH) {
        this.showToast('无法读取有效图片尺寸，请重试', 'error');
        return;
      }

      // 3. 维度缩放规则：若各维度 <= 64 保持不变，若 > 64 则等比缩放到 64 以内
      let targetW = origW;
      let targetH = origH;
      const maxDim = Math.max(origW, origH);
      if (maxDim > 64) {
        const scale = 64 / maxDim;
        targetW = Math.max(1, Math.min(64, Math.round(origW * scale)));
        targetH = Math.max(1, Math.min(64, Math.round(origH * scale)));
      }

      // 4. 计算居中对齐偏移（未覆盖区域保留透明背景）
      const dx = Math.floor((64 - targetW) / 2);
      const dy = Math.floor((64 - targetH) / 2);

      // 5. 创建 64×64 离线 Canvas 绘制并提取像素
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.clearRect(0, 0, 64, 64);

      // 插值策略：像素艺术整数倍缩放使用 Nearest Neighbor 采样保真，其他平滑图像使用高质量插值
      if (origW % targetW === 0 && origH % targetH === 0 && origW <= 256) {
        ctx.imageSmoothingEnabled = false;
      } else {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
      }

      ctx.drawImage(img, dx, dy, targetW, targetH);
      const imgData = ctx.getImageData(0, 0, 64, 64);
      const rgba = imgData.data;

      const rgbPixels: Rgb[] = [];
      const transparentFlags = new Uint8Array(PIXEL_COUNT);
      for (let i = 0; i < PIXEL_COUNT; i++) {
        const offset = i * 4;
        const a = rgba[offset + 3];
        if (a < 128) {
          transparentFlags[i] = 1;
          rgbPixels.push([255, 255, 255]); // 纯白占位，不影响量化器
        } else {
          rgbPixels.push([rgba[offset], rgba[offset + 1], rgba[offset + 2]]);
        }
      }

      // 6. OKLab 36 色逐像素最近邻量化 (不使用 dithering)
      const newIndices = quantizeToPalette(rgbPixels, this.state.palette.map(hexToRgb));
      for (let i = 0; i < PIXEL_COUNT; i++) {
        if (transparentFlags[i]) newIndices[i] = TRANSPARENT_INDEX;
      }

      // 7. 语义分割，自动生成 5 分区互斥遮罩
      const newMask = this.generateSemanticMaskFromPixels(rgbPixels);
      for (let i = 0; i < PIXEL_COUNT; i++) {
        if (transparentFlags[i]) {
          newMask[i] = SemanticZone.Background;
        }
      }

      // 8. 更新全局状态
      this.clearHairDraft();
      this.hasInitializedMaskMatchPreset = false;
      this.state.pixelIndices = newIndices;
      this.state.semanticMask = newMask;
      this.state.currentHairPreset = detectHairPreset(newIndices, newMask, this.state.palette);
      this.state.visibleMaskZones = [SemanticZone.Hair];
      this.state.showMaskOverlay = false;
      this.state.activeMode = 'pixel';
      this.state.lockedMaskZones = [];
      this.state.activeMaskTool = 'pen';
      this.state.maskBrushSize = 1;
      this.state.isLoaded = true;
      this.state.undoStack = [];
      this.state.redoStack = [];
      this.canvasEditor.clearSelection();

      this.syncAllViews();
      this.triggerAutoSave();

      // 根据尺寸变化生成友好 Toast 反馈
      if (origW > 64 || origH > 64) {
        this.showToast(`✨ 图片载入成功：原尺寸 ${origW}×${origH} 已智能缩放至 ${targetW}×${targetH} 并完成 36 色量化`, 'success');
      } else if (origW < 64 || origH < 64) {
        this.showToast(`✨ 图片载入成功：原尺寸 ${origW}×${origH} 已居中置入 64×64 画布并完成 36 色量化`, 'success');
      } else {
        this.showToast('✨ 图片载入成功：已自动完成 36 色量化与 5 分区遮罩生成', 'success');
      }
    } catch (err) {
      console.error('File load error:', err);
      this.showToast('载入图片失败，请检查文件是否损坏', 'error');
    }
  }

  /**
   * 将普通 64x64 像素运行几何分析并归并为 5 分区互斥遮罩
   */
  private generateSemanticMaskFromPixels(pixels: Rgb[]): Uint8Array {
    try {
      return computeSemanticMask(pixels);
    } catch (err) {
      console.warn('Semantic analysis fallback to safe foreground:', err);
      // 容错降级：与左上角颜色相近的视为背景，其余前景保守归为衣服，绝不全图染发
      const cornerColor = pixels[0];
      const isCornerBg = (p: Rgb) =>
        Math.abs(p[0] - cornerColor[0]) + Math.abs(p[1] - cornerColor[1]) + Math.abs(p[2] - cornerColor[2]) < 25;
      this.showToast('⚠️ 人脸特征识别未达标，请在遮罩模式手动涂抹头发区域', 'warning');
      return Uint8Array.from(pixels, (p) => (isCornerBg(p) ? SemanticZone.Background : SemanticZone.Clothes));
    }
  }

  /**
   * 载入完整的 ProjectData
   */
  private loadProjectData(data: ProjectData): void {
    this.clearHairDraft();
    const patch = projectDataToStatePatch(data);
    this.state.palette = patch.palette;
    this.state.pixelIndices = patch.pixelIndices;
    this.state.semanticMask = patch.semanticMask;
    this.state.currentHairPreset = patch.currentHairPreset;
    this.state.visibleMaskZones = [SemanticZone.Hair];
    this.state.isLoaded = true;
    this.state.undoStack = [];
    this.state.redoStack = [];
    this.canvasEditor.clearSelection();

    this.syncAllViews();
    this.triggerAutoSave();
  }

  private loadImageFromArrayBuffer(buffer: ArrayBuffer, mimeType: string = 'image/png'): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const blob = new Blob([buffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });
  }

  // ===================== 编辑与交互逻辑 =====================

  private drawPixel(x: number, y: number, paletteIndex: number): void {
    const offset = y * 64 + x;
    if (this.state.pixelIndices[offset] !== paletteIndex) {
      this.state.pixelIndices[offset] = paletteIndex;
      this.canvasEditor.redraw();
    }
  }

  private drawMask(x: number, y: number, zone: SemanticZone): void {
    const offset = y * 64 + x;
    const currentZone = this.state.semanticMask[offset];
    if (currentZone === zone) return;

    // 1. 如果当前像素所在的分区已锁定，则受保护，禁止被其他遮罩涂抹或右键擦除！
    if (this.state.lockedMaskZones.includes(currentZone)) {
      return;
    }

    // 2. 如果目标分区自身已锁定且不是擦除为背景，禁止涂抹
    if (zone !== SemanticZone.Background && this.state.lockedMaskZones.includes(zone)) {
      return;
    }

    this.state.semanticMask[offset] = zone;

    // 如果正在预览发色，动态重新映射新涂抹或擦除的像素
    if (this.hasUnappliedHairRecolor()) {
      this.recomputeHairRecolorPreview();
    }

    this.canvasEditor.redraw();
  }

  private onStrokeStart(): void {
    if (!this.state.isLoaded) return;
    this.strokeStartSnapshot = this.takeSnapshot();
  }

  private onStrokeEnd(didModify: boolean): void {
    if (didModify && this.strokeStartSnapshot) {
      this.recordUndo(this.strokeStartSnapshot);
      if (this.hasUnappliedHairRecolor()) {
        this.recomputeHairRecolorPreview();
      }
      this.triggerAutoSave();
    }
    this.strokeStartSnapshot = null;
  }

  private selectPaletteIndex(index: number): void {
    this.setMode('pixel', () => {
      this.state.activePaletteIndex = index;
      // 若当前为选区、吸管，或橡皮擦且选了具体颜色，自动切回画笔
      if (
        this.state.activeTool === 'select' ||
        this.state.activeTool === 'eyedropper' ||
        (this.state.activeTool === 'eraser' && index !== TRANSPARENT_INDEX)
      ) {
        this.state.activeTool = 'pen';
      }
      this.syncAllViews();
      if (index === TRANSPARENT_INDEX) {
        this.showToast(`已选择前景色：[透明色] (绘制透明/删除)`);
      } else {
        this.showToast(`已选择前景色 #${index} (${this.state.palette[index]})`);
      }
    });
  }

  /**
   * 从画布吸管取色 (保持当前工具不变，避免拖拽微动误涂抹)
   */
  private pickColorFromCanvas(colorIdx: number, isBg: boolean = false): void {
    if (isBg) {
      this.selectBgPaletteIndex(colorIdx);
      return;
    }
    this.setMode('pixel', () => {
      this.state.activePaletteIndex = colorIdx;
      this.syncAllViews();
      if (colorIdx === TRANSPARENT_INDEX) {
        this.showToast(`🧪 已吸取前景色：[透明色]`);
      } else {
        this.showToast(`🧪 已吸取前景色 #${colorIdx} (${this.state.palette[colorIdx]})`);
      }
    });
  }

  private selectBgPaletteIndex(index: number): void {
    this.setMode('pixel', () => {
      this.state.bgPaletteIndex = index;
      this.syncAllViews();
      if (index === TRANSPARENT_INDEX) {
        this.showToast(`已设置背景色：[透明色] (鼠标右键直接擦除)`);
      } else {
        this.showToast(`已设置背景色 #${index} (${this.state.palette[index]}) (右键绘制)`);
      }
    });
  }

  private swapFgBgColors(): void {
    const temp = this.state.activePaletteIndex;
    this.state.activePaletteIndex = this.state.bgPaletteIndex;
    this.state.bgPaletteIndex = temp;
    this.syncAllViews();
    this.showToast(`⇄ 已交换前景色与背景色`);
  }

  private modifyPaletteColor(index: number, newHex: string): void {
    if (index === TRANSPARENT_INDEX) return;
    this.state.palette[index] = newHex;
    this.syncAllViews();
    this.triggerAutoSave();
  }

  private resetActiveColorToDefault(): void {
    const idx = this.state.activePaletteIndex;
    if (idx === TRANSPARENT_INDEX) return;
    this.pushUndoSnapshot();
    this.state.palette[idx] = PALETTE_36[idx];
    this.syncAllViews();
    this.triggerAutoSave();
    this.showToast(`已还原色板 #${idx} 为默认值 (${PALETTE_36[idx]})`);
  }

  private resetAllPaletteToDefault(): void {
    this.pushUndoSnapshot();
    this.state.palette = [...PALETTE_36];
    this.syncAllViews();
    this.triggerAutoSave();
    this.showToast('已重置全部 36 色板为 GBA 默认值');
  }

  private setActiveTool(tool: PixelTool): void {
    this.setMode('pixel', () => {
      this.state.activeTool = tool;
      this.syncAllViews();
    });
  }

  private setBucketConnectivity(conn: 8 | 4): void {
    this.state.bucketConnectivity = conn;
    this.syncAllViews();
    this.showToast(conn === 8 ? '🪣 油漆桶：已切换为 8 邻居连通 (含对角线)' : '🪣 油漆桶：已切换为 4 邻居连通 (十字四向)');
  }

  private setActiveZone(zone: SemanticZone, solo: boolean = false): void {
    this.state.activeZone = zone;
    this.state.activeMode = 'mask';
    this.state.showMaskOverlay = true;

    // 切换遮罩分区时，若当前处于选区或吸管工具，自动平滑切回画笔工具
    if (this.state.activeTool === 'select' || this.state.activeTool === 'eyedropper') {
      this.state.activeTool = 'pen';
    }

    if (solo || this.state.visibleMaskZones.length <= 1) {
      // 单选模式或明确 solo：仅显示当前选中的遮罩
      this.state.visibleMaskZones = [zone];
    } else {
      // 多选模式下：确保当前选中的遮罩画刷处于可见列表中，不破坏其余多选
      if (!this.state.visibleMaskZones.includes(zone)) {
        this.state.visibleMaskZones.push(zone);
      }
    }

    this.syncAllViews();
  }

  private toggleZoneVisibility(zone: SemanticZone, visible: boolean): void {
    const current = new Set(this.state.visibleMaskZones);
    if (visible) {
      current.add(zone);
      this.state.activeZone = zone;
      this.state.activeMode = 'mask';
      this.state.showMaskOverlay = true;
    } else {
      current.delete(zone);
      if (current.size === 0) {
        this.state.showMaskOverlay = false;
        this.state.activeMode = 'pixel';
      } else if (this.state.activeZone === zone) {
        this.state.activeZone = Array.from(current)[0];
      }
    }
    this.state.visibleMaskZones = Array.from(current);
    this.syncAllViews();
  }

  private setAllZonesVisibility(visible: boolean): void {
    if (visible) {
      this.state.visibleMaskZones = [...ALL_ZONES];
      this.state.activeMode = 'mask';
      this.state.showMaskOverlay = true;
    } else {
      this.state.visibleMaskZones = [];
      this.state.showMaskOverlay = false;
      this.state.activeMode = 'pixel';
    }
    this.syncAllViews();
  }

  private toggleLockZone(zone: SemanticZone): void {
    const meta = ZONE_CONFIG[zone];
    const current = new Set(this.state.lockedMaskZones);
    const isLocked = current.has(zone);

    if (isLocked) {
      current.delete(zone);
      this.showToast(`🔓 已解锁「${meta.name}」遮罩，现在可以编辑`);
    } else {
      current.add(zone);
      this.showToast(`🔒 已锁定「${meta.name}」遮罩，受保护防止被其他遮罩或橡皮擦覆盖！`, 'success');
    }

    this.state.lockedMaskZones = Array.from(current);
    this.syncAllViews();
  }

  /**
   * 切换工作区模式：'pixel' (像素模式) 或 'mask' (遮罩模式)，切换完成 (或已在目标模式) 后执行 onProceed。
   * 离开蒙版模式前，若存在未固化的发色预览，弹窗让用户选择应用或放弃。
   */
  private setMode(mode: 'pixel' | 'mask', onProceed?: () => void): void {
    if (mode === this.state.activeMode) {
      onProceed?.();
      return;
    }

    if (mode === 'pixel' && this.hasUnappliedHairRecolor()) {
      const switchToPixel = () => {
        this.applyModeDirect('pixel');
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

    this.applyModeDirect(mode);
    onProceed?.();
  }

  private applyModeDirect(mode: 'pixel' | 'mask'): void {
    this.state.activeMode = mode;
    if (mode === 'mask') {
      // 蒙版模式清空画布的选区，选区只服务画图模式
      this.canvasEditor.clearSelection();

      if (this.state.activeTool === 'select' || this.state.activeTool === 'eyedropper') {
        this.state.activeTool = 'pen';
      }
      this.state.showMaskOverlay = true;
      if (this.state.visibleMaskZones.length === 0) {
        this.state.visibleMaskZones = [this.state.activeZone || SemanticZone.Hair];
      }

      // 仅在首次进入遮罩模式时初始化一次匹配色组，后续切换遮罩分区不再自动重置
      if (!this.hasInitializedMaskMatchPreset) {
        this.hasInitializedMaskMatchPreset = true;
        this.initMaskMatchColors();
      }
    } else {
      this.state.showMaskOverlay = false;
    }
    this.syncAllViews();
  }

  private initMaskMatchColors(): void {
    const presetKey = this.state.maskMatchPresetKey;
    const preset = MATCH_COLOR_PRESETS.find((p) => p.id === presetKey) || MATCH_COLOR_PRESETS[0];
    this.state.maskMatchPresetKey = preset.id;
    this.state.maskMatchColors = preset.getIndices(this.state.palette, this.state.currentHairPreset);
  }

  private setMaskMatchPreset(presetKey: string): void {
    const preset = MATCH_COLOR_PRESETS.find((p) => p.id === presetKey);
    if (!preset) return;
    this.state.maskMatchPresetKey = presetKey;
    this.state.maskMatchColors = preset.getIndices(this.state.palette, this.state.currentHairPreset);
    this.canvasEditor.update(this.state);
    this.maskToolsPanel.update(this.state);
    this.showToast(`🎯 已加载【${preset.name}】(${this.state.maskMatchColors.length} 色) 到智能框选组`);
  }

  private addMaskMatchColor(colorIdx: number): void {
    if (!this.state.maskMatchColors.includes(colorIdx)) {
      this.state.maskMatchColors.push(colorIdx);
      this.state.maskMatchPresetKey = 'custom';
      this.canvasEditor.update(this.state);
      this.maskToolsPanel.update(this.state);
      const hex = this.state.palette[colorIdx] || (colorIdx === TRANSPARENT_INDEX ? 'transparent' : '#000000');
      this.showToast(`➕ 已将颜色 #${paletteIndexLabel(colorIdx)} (${hex}) 加入框选匹配组`);
    } else {
      this.showToast(`颜色 #${paletteIndexLabel(colorIdx)} 已在匹配组中`, 'info');
    }
  }

  private removeMaskMatchColor(colorIdx: number): void {
    const idx = this.state.maskMatchColors.indexOf(colorIdx);
    if (idx >= 0) {
      this.state.maskMatchColors.splice(idx, 1);
      this.state.maskMatchPresetKey = 'custom';
      this.canvasEditor.update(this.state);
      this.maskToolsPanel.update(this.state);
      this.showToast(`✕ 已从框选匹配组移除颜色 #${paletteIndexLabel(colorIdx)}`);
    }
  }

  private handleMaskBoxSelect(rect: RectSelection, action: 'add' | 'remove'): void {
    if (!this.state.isLoaded) return;
    const matchColors = new Set(this.state.maskMatchColors);
    if (matchColors.size === 0) {
      this.showToast('当前匹配色组为空，请先在工具箱选择预设或添加颜色', 'warning');
      return;
    }

    const lockedZones = this.state.lockedMaskZones;
    const targetZone = this.state.activeZone;
    const zoneMeta = ZONE_CONFIG[targetZone];

    if (action === 'add' && lockedZones.includes(targetZone)) {
      this.showToast(`目标分区【${zoneMeta.name}】已锁定，请先解锁后再操作`, 'warning');
      return;
    }

    this.pushUndoSnapshot();

    let count = 0;
    const { x, y, w, h } = rect;
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const px = x + c;
        const py = y + r;
        if (px < 0 || px >= 64 || py < 0 || py >= 64) continue;
        const offset = py * 64 + px;
        const colorIdx = this.state.pixelIndices[offset];

        if (matchColors.has(colorIdx)) {
          const currentZone = this.state.semanticMask[offset];
          if (lockedZones.includes(currentZone)) {
            continue; // 跳过锁定分区的像素
          }

          if (action === 'add') {
            if (currentZone !== targetZone) {
              this.state.semanticMask[offset] = targetZone;
              count++;
            }
          } else {
            // remove
            if (currentZone === targetZone) {
              this.state.semanticMask[offset] = SemanticZone.Background;
              count++;
            }
          }
        }
      }
    }

    if (count > 0) {
      if (this.hasUnappliedHairRecolor()) {
        this.recomputeHairRecolorPreview();
      }
      this.syncAllViews();
      this.triggerAutoSave();
      if (action === 'add') {
        this.showToast(`✨ 已将框内 ${count} 个匹配像素划入【${zoneMeta.shortName}】遮罩`, 'success');
      } else {
        this.showToast(`🧼 已将框内 ${count} 个匹配像素从【${zoneMeta.shortName}】遮罩剔除`, 'info');
      }
    } else {
      this.showToast('框选范围内未找到符合当前匹配色组的未锁定像素', 'info');
    }
  }

  private setActiveMaskTool(tool: MaskTool): void {
    this.state.activeMaskTool = tool;
    this.syncAllViews();
  }

  private setMaskBrushSize(size: 1 | 2 | 3 | 4): void {
    this.state.maskBrushSize = size;
    this.syncAllViews();
    this.showToast(`🎯 遮罩笔刷尺寸: ${size}×${size} 像素`);
  }

  private changeMaskBrushSize(delta: number): void {
    const current = this.state.maskBrushSize;
    const next = Math.max(1, Math.min(4, current + delta)) as 1 | 2 | 3 | 4;
    if (next !== current) {
      this.setMaskBrushSize(next);
    }
  }

  private assignColorToZone(colorIdx: number, targetZone: SemanticZone = this.state.activeZone): void {
    if (!this.state.isLoaded) {
      this.showToast('请先载入图片后再执行操作', 'warning');
      return;
    }
    const zoneMeta = ZONE_CONFIG[targetZone];
    const lockedZones = this.state.lockedMaskZones;

    if (lockedZones.includes(targetZone)) {
      this.showToast(`目标分区【${zoneMeta.name}】已锁定，请先解锁后再操作`, 'warning');
      return;
    }

    this.pushUndoSnapshot();

    let count = 0;
    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (this.state.pixelIndices[i] === colorIdx) {
        const currentZone = this.state.semanticMask[i];
        if (lockedZones.includes(currentZone)) {
          continue; // 跳过锁定分区的像素
        }
        if (currentZone !== targetZone) {
          this.state.semanticMask[i] = targetZone;
          count++;
        }
      }
    }

    if (count > 0) {
      if (this.hasUnappliedHairRecolor()) {
        this.recomputeHairRecolorPreview();
      }
      this.syncAllViews();
      this.triggerAutoSave();
      const colorHex = this.state.palette[colorIdx] || `#${colorIdx}`;
      this.showToast(`✨ 已将 ${count} 个 ${colorHex} 像素划入【${zoneMeta.shortName}】遮罩`, 'success');
    } else {
      this.showToast('该颜色的像素均已在当前分区中，或受到图层锁定保护', 'info');
    }
  }

  private setMaskOpacity(opacity: number): void {
    this.state.maskOpacity = opacity;
    this.canvasEditor.update(this.state);
    this.maskPanel.update(this.state);
  }

  private setZoom(zoom: number): void {
    this.state.zoomLevel = zoom;
    this.canvasEditor.update(this.state);
  }

  private setGrid(show: boolean): void {
    this.state.showGrid = show;
    this.canvasEditor.update(this.state);
  }

  /**
   * 判断是否存在未固化的发色草稿预览
   */
  public hasUnappliedHairRecolor(): boolean {
    return this.hairPresetDraft !== null && this.recoloredPixels !== null;
  }

  /**
   * 清理发色草稿预览缓存
   */
  private clearHairDraft(): void {
    this.hairRecolorBase = null;
    this.hairPresetDraft = null;
    this.recoloredPixels = null;
    this.canvasEditor.setPreviewPixels(null);
    this.maskPanel.setHairDraft(null);
  }

  /** 以首次预览时捕获的原始像素为基准，计算 presetKey 发色的预览像素 */
  private computeHairPreview(presetKey: string): Uint8Array {
    return recolorHair(
      this.hairRecolorBase!,
      this.state.semanticMask,
      this.state.palette,
      this.state.currentHairPreset,
      presetKey
    );
  }

  /**
   * 遮罩变化后重新计算发色预览并更新画布
   */
  private recomputeHairRecolorPreview(): void {
    if (!this.hasUnappliedHairRecolor() || !this.hairRecolorBase) return;
    this.recoloredPixels = this.computeHairPreview(this.hairPresetDraft!);
    this.canvasEditor.setPreviewPixels(this.recoloredPixels);
  }

  /**
   * 头发 9 大预设色板非破坏性预览置换：
   * 建立独立 64×64 预览层，不修改画布实际数据，可随意在 9 种发色间反复切换而零损耗
   */
  private applyHairPreset(presetKey: string): void {
    if (!this.state.isLoaded) return;
    const rampSpec = RAMPS_INFO[presetKey];
    if (!rampSpec) return;

    let hairPixelCount = 0;
    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (this.state.semanticMask[i] === SemanticZone.Hair) {
        hairPixelCount++;
      }
    }

    if (hairPixelCount === 0) {
      this.showToast('当前遮罩中未标记任何头发 (Hair) 区域，请先涂抹遮罩', 'warning');
      return;
    }

    // 首次置换发色时，捕获原始像素快照作为基准底图
    if (!this.hairRecolorBase) {
      this.hairRecolorBase = new Uint8Array(this.state.pixelIndices);
    }

    this.hairPresetDraft = presetKey;
    this.recoloredPixels = this.computeHairPreview(presetKey);

    // 注入画布预览与蒙版面板草稿态
    this.canvasEditor.setPreviewPixels(this.recoloredPixels);
    this.maskPanel.setHairDraft(presetKey);

    this.showToast(`🎨 正在预览发色: ${rampSpec.name} (${rampSpec.icon})，离开蒙版模式前可自由试色`);
  }

  /**
   * 固化发色预览修改到画布基底像素 (提交更改)
   */
  public commitHairRecolor(): void {
    if (!this.hasUnappliedHairRecolor()) return;

    this.pushUndoSnapshot();

    // 将预览图固化到画布基底
    this.state.pixelIndices.set(this.recoloredPixels!);
    this.state.currentHairPreset = this.hairPresetDraft;

    const appliedName = RAMPS_INFO[this.hairPresetDraft!]?.name || '新发色';

    // 清空预览草稿
    this.clearHairDraft();

    this.syncAllViews();
    this.triggerAutoSave();
    this.showToast(`✓ 发色【${appliedName}】已成功应用并固化到画布！`, 'success');
  }

  /**
   * 放弃发色预览修改，还原为原始发色
   */
  public discardHairRecolor(): void {
    if (!this.hasUnappliedHairRecolor()) return;

    this.clearHairDraft();
    this.syncAllViews();
    this.showToast('已放弃发色预览，恢复为原图', 'info');
  }

  /**
   * 弹出对话框供用户固化或还原发色预览
   */
  public openHairRecolorModal(): void {
    if (!this.hasUnappliedHairRecolor()) return;
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

  private hairDraftName(): string {
    return RAMPS_INFO[this.hairPresetDraft!]?.name || '新发色';
  }

  /**
   * 未固化发色预览的三选一对话框：第一个按钮先固化发色再执行 onApplied，第三个按钮什么都不做
   */
  private confirmHairDraft(options: {
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
    this.confirmModal.show({
      icon: options.icon,
      title: options.title,
      message: options.message,
      subMessage: options.subMessage,
      buttons: [
        {
          label: options.applyLabel,
          className: 'btn-primary',
          onClick: () => {
            this.commitHairRecolor();
            options.onApplied();
          },
        },
        { label: options.otherLabel, className: 'btn-outline', onClick: options.onOther },
        { label: options.cancelLabel, className: 'btn-ghost', onClick: () => {} },
      ],
    });
  }

  /**
   * 重新识别语义遮罩 (不影响像素画已有绘制)
   */
  private recomputeSemanticMask(): void {
    if (!this.state.isLoaded) return;

    this.pushUndoSnapshot();

    // 根据当前 pixelIndices + palette 构造 RGB 数组 (透明像素以纯白作为背景基准传入分析器)
    const pixels: Rgb[] = [];
    const paletteRgb = this.state.palette.map((hex) => hexToRgb(hex));
    for (let i = 0; i < PIXEL_COUNT; i++) {
      const idx = this.state.pixelIndices[i];
      if (idx === TRANSPARENT_INDEX) {
        pixels.push([255, 255, 255]);
      } else {
        pixels.push(paletteRgb[idx] || [0, 0, 0]);
      }
    }

    const newMask = this.generateSemanticMaskFromPixels(pixels);

    // 透明像素一律归为背景分区
    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (this.state.pixelIndices[i] === TRANSPARENT_INDEX) {
        newMask[i] = SemanticZone.Background;
      }
    }

    // 如果有锁定的遮罩分区，保留被锁定的像素！
    const lockedSet = new Set(this.state.lockedMaskZones);
    if (lockedSet.size > 0) {
      for (let i = 0; i < PIXEL_COUNT; i++) {
        const oldZone = this.state.semanticMask[i];
        if (lockedSet.has(oldZone)) {
          newMask[i] = oldZone;
        }
      }
    }

    this.state.semanticMask = newMask;
    this.state.activeMode = 'mask';
    this.state.showMaskOverlay = true;
    if (this.state.visibleMaskZones.length === 0) {
      this.state.visibleMaskZones = [...ALL_ZONES];
    }

    if (this.hasUnappliedHairRecolor()) {
      this.recomputeHairRecolorPreview();
    }

    this.syncAllViews();
    this.triggerAutoSave();
    this.showToast('✨ 语义遮罩已重新识别完成并进入遮罩模式！', 'success');
  }

  /**
   * 把从画布边缘 4-连通可达的白色像素改为透明 (眼睛分区与锁定分区不受影响，内部白色不会被扣除)
   */
  public removeOuterWhite(): void {
    if (!this.state.isLoaded) {
      this.showToast('请先载入 64×64 像素头像后再扣除白底', 'warning');
      return;
    }

    const { pixelIndices, semanticMask, palette } = this.state;
    const lockedSet = new Set(this.state.lockedMaskZones);

    // 辅助函数：判断指定像素索引是否为待扣除的白色 (包括透明像素以供连通遍历)
    const isBgWhiteOrTrans = (idx: number): boolean => {
      const palIdx = pixelIndices[idx];
      if (palIdx === TRANSPARENT_INDEX) return true; // 透明色允许通过以连通外围
      if (palIdx < 0 || palIdx >= palette.length) return false;

      // 如果所在分区被用户明确加锁，受保护不可扣除
      const zone = semanticMask[idx];
      if (lockedSet.has(zone)) return false;

      // 保护眼白：眼睛分区 (Eyes) 绝不作为外围白底扣除
      if (zone === SemanticZone.Eyes) return false;

      const hex = palette[palIdx];
      const rgb = hexToRgb(hex);
      return rgb[0] >= 250 && rgb[1] >= 250 && rgb[2] >= 250;
    };

    // 从四条外边界出发 4-连通泛洪，只扣除与外围连通的实体白色像素
    const toClear = floodFill(borderOffsets(), isBgWhiteOrTrans).filter(
      (idx) => pixelIndices[idx] !== TRANSPARENT_INDEX
    );

    if (toClear.length === 0) {
      this.showToast('ℹ️ 未检测到外围连通的白色背景像素', 'info');
      return;
    }

    this.pushUndoSnapshot();

    for (const idx of toClear) {
      pixelIndices[idx] = TRANSPARENT_INDEX;
      semanticMask[idx] = SemanticZone.Background;
    }

    this.syncAllViews();
    this.triggerAutoSave();
    this.showToast(`✂️ 已扣除 ${toClear.length} 个外围背景白像素为原生透明色 (人物眼白与高光完好)`, 'success');
  }

  /**
   * 翻转：有选区时翻转选区内容，否则翻转整张画布
   */
  public flipContent(axis: 'horizontal' | 'vertical'): void {
    if (!this.state.isLoaded) return;
    const selection = this.canvasEditor.getSelection();
    this.applyEdit(() => {
      flipRect(this.layers(), selection ?? FULL_CANVAS, axis);
      return true;
    });
    const label = axis === 'horizontal' ? '↔ 水平' : '↕ 垂直';
    this.showToast(`${label}翻转${selection ? '选区' : '整张画布'}完成`);
  }

  /**
   * 顺时针旋转 90°：有选区时旋转选区内容 (选区随之变形)，否则旋转整张画布
   */
  public rotateContentCW(): void {
    if (!this.state.isLoaded) return;
    const selection = this.canvasEditor.getSelection();
    this.applyEdit(() => {
      const rotated = rotateRectCW(this.layers(), selection ?? FULL_CANVAS);
      if (selection) this.canvasEditor.setSelection(rotated);
      return true;
    });
    this.showToast(`↻ 顺时针旋转${selection ? '选区' : '整张画布'} 90° 完成`);
  }

  /** 当前可编辑图层；被锁定分区的遮罩在清空类操作中受保护 */
  private layers(): Layers {
    return {
      pixels: this.state.pixelIndices,
      mask: this.state.semanticMask,
      lockedZones: new Set(this.state.lockedMaskZones),
    };
  }

  /** 编辑作用范围：有选区时为选区，否则为整张画布 */
  private editScope(): RectSelection {
    return this.canvasEditor.getSelection() ?? FULL_CANVAS;
  }

  /**
   * 执行一次独立编辑 (非画笔笔划)：有变化时记录撤销并存盘，随后刷新全部视图。
   */
  private applyEdit(edit: () => boolean): boolean {
    if (!this.state.isLoaded) return false;
    const snapshot = this.takeSnapshot();
    const changed = edit();
    if (changed) {
      this.recordUndo(snapshot);
      this.triggerAutoSave();
    }
    this.syncAllViews();
    return changed;
  }

  /**
   * 油漆桶 (在画布笔划内调用，撤销由笔划统一记录)。
   * 左键填前景色 / 当前分区，右键填背景色 / 背景分区；replaceAll 时改为全域同色替换。
   */
  private bucketAt(x: number, y: number, button: 0 | 2, replaceAll: boolean): boolean {
    const layers = this.layers();
    const diagonal = this.state.bucketConnectivity === 8;
    let changed: boolean;

    if (this.state.activeMode === 'mask') {
      const zone = button === 0 ? this.state.activeZone : SemanticZone.Background;
      changed = floodFillMask(layers, x, y, zone, diagonal, this.editScope());
    } else {
      const color = button === 0 ? this.state.activePaletteIndex : this.state.bgPaletteIndex;
      if (replaceAll) {
        const fromColor = layers.pixels[y * 64 + x];
        changed = replaceColor(layers, fromColor, color, this.editScope()) > 0;
      } else {
        changed = floodFillPixels(layers, x, y, color, diagonal, this.editScope());
      }
    }

    if (changed) this.canvasEditor.redraw();
    return changed;
  }

  private copySelection(): boolean {
    const selection = this.canvasEditor.getSelection();
    if (!this.state.isLoaded || !selection) return false;
    this.clipboard = extractPatch(this.layers(), selection);
    return true;
  }

  private cutSelection(): boolean {
    return this.copySelection() && this.deleteSelectionContent();
  }

  /** 把选区内容清空为透明 (保护锁定分区的遮罩) */
  private deleteSelectionContent(): boolean {
    const selection = this.canvasEditor.getSelection();
    if (!selection) return false;
    return this.applyEdit(() => clearRect(this.layers(), selection));
  }

  /** 粘贴到当前选区左上角 (无选区时居中)，粘贴结果成为新选区 */
  private pasteClipboard(): boolean {
    const clip = this.clipboard;
    if (!clip) return false;
    return this.applyEdit(() => {
      const selection = this.canvasEditor.getSelection();
      const x = Math.min(selection ? selection.x : Math.max(0, Math.floor((64 - clip.w) / 2)), Math.max(0, 64 - clip.w));
      const y = Math.min(selection ? selection.y : Math.max(0, Math.floor((64 - clip.h) / 2)), Math.max(0, 64 - clip.h));
      stampPatch(this.layers(), clip, x, y);
      this.canvasEditor.setSelection({ x, y, w: clip.w, h: clip.h });
      return true;
    });
  }

  // ===================== 撤销与重做 =====================

  private takeSnapshot(): UndoSnapshot {
    return {
      pixelIndices: new Uint8Array(this.state.pixelIndices),
      semanticMask: new Uint8Array(this.state.semanticMask),
      currentHairPreset: this.state.currentHairPreset,
      selection: this.canvasEditor.getSelection(),
      palette: [...this.state.palette],
    };
  }

  private restoreSnapshot(snapshot: UndoSnapshot): void {
    this.state.pixelIndices.set(snapshot.pixelIndices);
    this.state.semanticMask.set(snapshot.semanticMask);
    this.state.currentHairPreset = snapshot.currentHairPreset;
    this.state.palette = [...snapshot.palette];
    this.canvasEditor.setSelection(snapshot.selection);
  }

  /** 压入一条新的撤销记录 (清空重做栈)，并刷新撤销/重做按钮状态 */
  private recordUndo(snapshot: UndoSnapshot): void {
    this.state.undoStack.push(snapshot);
    if (this.state.undoStack.length > UNDO_LIMIT) {
      this.state.undoStack.shift();
    }
    this.state.redoStack = [];
    this.palettePanel.update(this.state);
    this.maskPanel.update(this.state);
  }

  private pushUndoSnapshot(): void {
    this.recordUndo(this.takeSnapshot());
  }

  private undo(): void {
    this.stepHistory(this.state.undoStack, this.state.redoStack, '↩️ 撤销成功');
  }

  private redo(): void {
    this.stepHistory(this.state.redoStack, this.state.undoStack, '↪️ 重做成功');
  }

  /** 从 from 栈取出一条快照恢复，并把当前状态存入 to 栈；未固化的发色预览会被放弃 */
  private stepHistory(from: UndoSnapshot[], to: UndoSnapshot[], message: string): void {
    if (this.hasUnappliedHairRecolor()) {
      this.discardHairRecolor();
    }
    if (from.length === 0) return;

    to.push(this.takeSnapshot());
    this.restoreSnapshot(from.pop()!);

    this.syncAllViews();
    this.triggerAutoSave();
    this.showToast(message);
  }

  // ===================== 列宽拖拽调整 =====================

  private setupSplitterDragging(): void {
    const splitterLeft = document.getElementById('splitter-left');
    const splitterRight = document.getElementById('splitter-right');
    const paletteMount = document.getElementById('palette-mount');
    const maskMount = document.getElementById('mask-mount');

    if (!splitterLeft || !splitterRight || !paletteMount || !maskMount) return;

    // 恢复本地存储的列宽偏好
    const savedLeftWidth = localStorage.getItem('imagegem_layout_left_width');
    if (savedLeftWidth) {
      const w = parseInt(savedLeftWidth, 10);
      if (!isNaN(w) && w >= 220 && w <= 480) {
        paletteMount.style.width = `${w}px`;
      } else {
        paletteMount.style.width = '280px';
      }
    } else {
      paletteMount.style.width = '280px';
    }

    const savedRightWidth = localStorage.getItem('imagegem_layout_right_width');
    if (savedRightWidth) {
      const w = parseInt(savedRightWidth, 10);
      if (!isNaN(w) && w >= 220 && w <= 520) {
        maskMount.style.width = `${w}px`;
      }
    }

    // 左分割线拖动逻辑
    let isDraggingLeft = false;
    let startXLeft = 0;
    let startWidthLeft = 0;

    splitterLeft.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDraggingLeft = true;
      startXLeft = e.clientX;
      startWidthLeft = paletteMount.offsetWidth;
      splitterLeft.classList.add('is-active');
      document.body.classList.add('is-resizing');
    });

    // 右分割线拖动逻辑
    let isDraggingRight = false;
    let startXRight = 0;
    let startWidthRight = 0;

    splitterRight.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDraggingRight = true;
      startXRight = e.clientX;
      startWidthRight = maskMount.offsetWidth;
      splitterRight.classList.add('is-active');
      document.body.classList.add('is-resizing');
    });

    window.addEventListener('mousemove', (e) => {
      if (isDraggingLeft) {
        const delta = e.clientX - startXLeft;
        const newWidth = Math.max(200, Math.min(480, startWidthLeft + delta));
        paletteMount.style.width = `${newWidth}px`;
      } else if (isDraggingRight) {
        const delta = startXRight - e.clientX;
        const newWidth = Math.max(220, Math.min(520, startWidthRight + delta));
        maskMount.style.width = `${newWidth}px`;
      }
    });

    window.addEventListener('mouseup', () => {
      if (isDraggingLeft) {
        isDraggingLeft = false;
        splitterLeft.classList.remove('is-active');
        document.body.classList.remove('is-resizing');
        localStorage.setItem('imagegem_layout_left_width', paletteMount.offsetWidth.toString());
      }
      if (isDraggingRight) {
        isDraggingRight = false;
        splitterRight.classList.remove('is-active');
        document.body.classList.remove('is-resizing');
        localStorage.setItem('imagegem_layout_right_width', maskMount.offsetWidth.toString());
      }
    });
  }

  // ===================== 颜色替换 (Shift+R / 选区工具条) =====================

  public openReplaceColorModal(): void {
    if (!this.state.isLoaded) {
      this.showToast('请先载入头像后再使用颜色替换功能', 'warning');
      return;
    }
    if (this.state.activeMode === 'mask') {
      this.setMode('pixel', () => {
        this.openReplaceColorModal();
      });
      return;
    }
    const selection = this.canvasEditor.getSelection();
    this.replaceColorModal.open(this.state, selection);
  }

  private handleReplaceColor(fromIdx: number, toIdx: number, scope: 'selection' | 'all'): void {
    if (!this.state.isLoaded) return;
    if (fromIdx === toIdx) {
      this.showToast('原颜色与目标颜色相同，无需替换', 'warning');
      return;
    }

    let count = 0;
    this.applyEdit(() => {
      count = replaceColor(this.layers(), fromIdx, toIdx, scope === 'selection' ? this.editScope() : FULL_CANVAS);
      return count > 0;
    });
    if (count > 0) {
      const scopeDesc = scope === 'selection' ? '选区内' : '整张画布';
      this.showToast(`🔄 已成功在${scopeDesc}替换 ${count} 个像素点`, 'success');
    } else {
      this.showToast('未找到匹配的原颜色像素点', 'info');
    }
  }

  // ===================== 全局快捷键与存盘 =====================

  private setupGlobalKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e) => this.handleShortcut(e));
  }

  /**
   * 全局快捷键。按以下顺序匹配，命中即停止：
   * 1. Shift+字母 (不论是否按 Ctrl)  2. Ctrl/Cmd+字母  3. Esc / Delete
   * 4. 其余带 Ctrl/Alt 的组合一律忽略  5. 单键 (工具、模式、分区)
   * 同时匹配 e.key 与 e.code，兼容中文输入法与 CapsLock。
   */
  private handleShortcut(e: KeyboardEvent): void {
    // 只在真正的文本输入中屏蔽快捷键；滑杆、复选框等非文本控件不阻塞
    const target = e.target as HTMLElement | null;
    if (target) {
      if (target.isContentEditable || target.tagName === 'TEXTAREA') return;
      if (target.tagName === 'INPUT') {
        const type = ((target as HTMLInputElement).type || 'text').toLowerCase();
        if (!['range', 'checkbox', 'radio', 'color', 'button', 'submit', 'reset'].includes(type)) return;
      }
    }
    // 颜色替换弹窗打开期间由弹窗自己处理按键
    if (this.replaceColorModal.getIsOpen()) return;

    const key = e.key.toLowerCase();
    const is = (...names: string[]) => names.includes(key) || names.includes(e.code);
    const letter = (ch: string) => is(ch, `Key${ch.toUpperCase()}`);
    const ctrlOrCmd = e.ctrlKey || e.metaKey;
    const inMask = this.state.activeMode === 'mask';
    const canvas = this.canvasEditor;

    type Action = () => void;
    // Shift+字母：画布变换
    const shiftActions: [string, Action][] = [
      ['r', () => this.openReplaceColorModal()],
      ['h', () => this.flipContent('horizontal')],
      ['v', () => this.flipContent('vertical')],
      ['t', () => this.rotateContentCW()],
    ];
    if (e.shiftKey) {
      for (const [ch, run] of shiftActions) {
        if (letter(ch)) {
          e.preventDefault();
          run();
          return;
        }
      }
    }

    // Ctrl/Cmd+字母：返回 false 表示不拦截浏览器默认行为
    const ctrlActions: [string, () => boolean][] = [
      ['z', () => (e.shiftKey ? this.redo() : this.undo(), true)],
      ['y', () => (this.redo(), true)],
      ['s', () => (this.exportProjectZip(), true)],
      ['c', () => {
        if (!canvas.hasSelection()) return false;
        if (this.copySelection()) this.showToast('📋 已复制选区内容到剪贴板');
        return true;
      }],
      ['x', () => {
        if (!canvas.hasSelection()) return false;
        if (this.cutSelection()) this.showToast('✂️ 已剪切选区内容到剪贴板');
        return true;
      }],
      ['v', () => {
        if (!this.clipboard) return false;
        if (this.pasteClipboard()) this.showToast('📋 已从剪贴板粘贴选区');
        return true;
      }],
      ['d', () => (this.clearSelectionWithToast(), true)],
      ['a', () => (canvas.selectAll(), this.showToast('已全选整张画布 (64×64)'), true)],
      // 拦截 Ctrl+P 避免调出打印窗口，顺便切换为画笔
      ['p', () => (this.setActiveTool('pen'), this.showToast('✏️ 已切换为画笔工具 (左键绘制前景色，右键绘制背景色)'), true)],
    ];
    if (ctrlOrCmd) {
      for (const [ch, run] of ctrlActions) {
        if (letter(ch)) {
          if (run()) e.preventDefault();
          return;
        }
      }
    }

    if (is('escape', 'Escape')) {
      this.clearSelectionWithToast();
      return;
    }
    if (is('delete', 'backspace', 'Delete', 'Backspace') && canvas.hasSelection()) {
      e.preventDefault();
      if (this.deleteSelectionContent()) this.showToast('🧼 已将选区内容清空为透明像素');
      return;
    }

    // 避免 Ctrl/Alt 组合误触单键快捷键
    if (ctrlOrCmd || e.altKey) return;

    // 遮罩模式下 [ / ] 调整笔刷尺寸
    if (inMask && is('[', 'BracketLeft')) return this.changeMaskBrushSize(-1);
    if (inMask && is(']', 'BracketRight')) return this.changeMaskBrushSize(1);

    // 同一个键在像素模式与遮罩模式下分别对应的工具
    const toolKey = (maskTool: MaskTool, maskToast: string, pixelAction: Action) =>
      () => {
        if (inMask) {
          this.setActiveMaskTool(maskTool);
          this.showToast(maskToast);
        } else {
          pixelAction();
        }
      };

    const singleKeyActions: [string[], Action][] = [
      [['q'], () => this.setMode('pixel')],
      [['w'], () => this.setMode('mask')],
      [['m', 's'], toolKey('box_select', '🔲 已切换为智能框选工具 (左键拖拽匹配色划入遮罩，右键剔除)', () => {
        this.setActiveTool('select');
        this.showToast('⬚ 矩形选区工具：拖拽框选，选区内拖动平移 (原位透明)，按住 Ctrl 复制');
      })],
      [['p'], toolKey('pen', '✏️ 已切换为遮罩画笔', () => {
        this.setActiveTool('pen');
        this.showToast('✏️ 已切换为画笔工具 (左键绘制前景色，右键绘制背景色)');
      })],
      [['b', 'f'], () => {
        if (inMask) {
          this.setActiveMaskTool('bucket');
          this.showToast(`🪣 已切换为遮罩油漆桶 (${this.state.bucketConnectivity} 邻居连通)`);
        } else if (this.state.activeTool === 'bucket') {
          // 已是油漆桶时再按一次切换 8/4 连通
          this.setBucketConnectivity(this.state.bucketConnectivity === 8 ? 4 : 8);
        } else {
          this.setActiveTool('bucket');
          this.showToast(`🪣 已切换为油漆桶工具 (当前：${this.state.bucketConnectivity} 邻居连通)`);
        }
      }],
      [['e'], toolKey('eraser', '🧼 已切换为遮罩橡皮擦 (擦除为背景 0)', () => {
        this.setActiveTool('eraser');
        this.showToast('🧼 已切换为橡皮擦工具 (原生透明删除)');
      })],
      [['i'], () => {
        if (inMask) this.showToast('吸管工具仅在像素画图模式下有效 (按 Q 切换)', 'info');
        else this.setActiveTool('eyedropper');
      }],
      [['g'], () => this.setGrid(!this.state.showGrid)],
      [['x'], () => this.swapFgBgColors()],
      [['v'], () => this.toggleRealtimePreview()],
    ];
    for (const [letters, run] of singleKeyActions) {
      if (letters.some(letter)) {
        run();
        return;
      }
    }

    // 0~4 选择遮罩分区
    for (const zone of ALL_ZONES) {
      const digit = ZONE_CONFIG[zone].hotkey;
      if (is(digit, `Digit${digit}`, `Numpad${digit}`)) {
        this.setActiveZone(zone);
        this.showToast(`🎭 已选择${ZONE_CONFIG[zone].shortName}遮罩 [${digit}]`);
        return;
      }
    }
  }

  private clearSelectionWithToast(): void {
    if (this.canvasEditor.hasSelection()) {
      this.canvasEditor.clearSelection();
      this.showToast('已取消矩形选区');
    }
  }

  private toggleRealtimePreview(): void {
    if (!this.state.isLoaded) {
      this.showToast('请先载入 64×64 像素头像后再开启原寸预览', 'warning');
      return;
    }
    this.realtimePreview.toggleVisibility();
    const isVisible = this.realtimePreview.getIsVisible();
    this.canvasEditor.setPreviewButtonActive(isVisible);
    this.showToast(isVisible ? '👁️ 原寸实时预览已开启' : '👁️ 原寸实时预览已隐藏');
  }

  public exportProjectPng(): void {
    this.exportWithHairDraftCheck({
      notLoadedMessage: '请先载入头像后再导出 PNG',
      icon: '💾',
      title: '导出 PNG 发色确认',
      notCommittedText: '尚未固化到画布',
      subMessage: '请选择如何导出该头像 PNG：',
      applyLabel: '✓ 应用新发色并导出',
      originalLabel: '以原图发色导出',
      doExport: () => this.doExportProjectPng(),
    });
  }

  private async doExportProjectPng(): Promise<void> {
    try {
      await exportProjectPng(this.state);
      this.showToast('🎉 纯净 64×64 PNG 导出成功！(极简无损体积，约 400 字节)', 'success');
    } catch (err) {
      console.error('Export PNG failed:', err);
      this.showToast('导出 PNG 失败', 'error');
    }
  }

  public exportProjectZip(): void {
    this.exportWithHairDraftCheck({
      notLoadedMessage: '请先载入头像后再导出工程 ZIP',
      icon: '📦',
      title: '导出 ZIP 发色确认',
      notCommittedText: '尚未固化到工程中',
      subMessage: '请选择如何打包导出工程 ZIP：',
      applyLabel: '✓ 应用新发色并打包',
      originalLabel: '以原图发色打包',
      doExport: () => this.doExportProjectZip(),
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
    if (!this.state.isLoaded) {
      this.showToast(o.notLoadedMessage, 'warning');
      return;
    }
    if (!this.hasUnappliedHairRecolor()) {
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

  private async doExportProjectZip(): Promise<void> {
    this.showToast('📦 正在打包工程 ZIP (含各倍率渲染图、5色遮罩、图层与色板)...', 'info');
    try {
      await exportProjectZip(this.state);
      this.showToast('🎉 工程 ZIP 打包下载完成！已包含完整元数据、渲染图、遮罩及色板', 'success');
    } catch (err) {
      console.error('Export ZIP failed:', err);
      this.showToast('导出工程 ZIP 失败', 'error');
    }
  }

  private triggerAutoSave(): void {
    this.header.showSaveStatus('saving');
    saveProjectDebounced(this.state, () => {
      this.header.showSaveStatus('saved');
    });
  }

  private syncAllViews(): void {
    this.header.update(this.state);
    this.canvasEditor.update(this.state);
    this.palettePanel.update(this.state);
    this.maskPanel.update(this.state);
    this.maskToolsPanel?.update(this.state);

    if (this.palettePanelWrapper && this.maskToolsPanelWrapper) {
      const isMask = this.state.activeMode === 'mask';
      this.palettePanelWrapper.style.display = isMask ? 'none' : '';
      this.maskToolsPanelWrapper.style.display = isMask ? '' : 'none';
    }
  }

  public showToast(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => {
        if (toast.parentElement) toast.parentElement.removeChild(toast);
      }, 300);
    }, 2800);
  }
}

// 启动应用
window.addEventListener('DOMContentLoaded', () => {
  new PortraitStudioApp();
});
