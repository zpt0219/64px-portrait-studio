/**
 * ImageGem Studio v2.0 - 主控制器与流程编排
 * 负责全局状态管理、双通道智能载入、撤销重做栈、发色管线调度与组件生命周期
 */

import {
  StudioState,
  SemanticZone,
  ZONE_CONFIG,
  UndoSnapshot,
  ImageGemProjectData,
  RectSelection,
} from './types';
import { PALETTE_36, RAMPS_INFO, TRANSPARENT_INDEX, MATCH_COLOR_PRESETS } from './data/palette';
import { hexToRgb, findNearestColor } from './core/colorUtils';
import { nearestTierForColor } from './core/recolorEngine';
import {
  StrictGeometryGate,
  MouthDetector,
  analyzeSemanticRegions,
  assignResidualRegions,
  mapImageToPalette,
  Rgb,
} from './core/remapCore';
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

class ImageGemApp {
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
      pixelIndices: new Uint8Array(4096).fill(TRANSPARENT_INDEX),
      semanticMask: new Uint8Array(4096),
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
      onSelectPaletteColor: (idx) => {
        if (this.state.activeMode === 'mask' && this.state.activeMaskTool === 'box_select') {
          this.addMaskMatchColor(idx);
          return;
        }
        this.selectPaletteIndex(idx);
      },
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
      onActivate: () => this.setMode('pixel'),
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

    // 1. 若为工程 ZIP 包：解包并 100% 完整恢复历史工程与遮罩
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
      const transparentFlags = new Uint8Array(4096);
      for (let i = 0; i < 4096; i++) {
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
      const fullPaletteRgb = this.state.palette.map((hex) => hexToRgb(hex));
      const remapResult = mapImageToPalette(rgbPixels, fullPaletteRgb, {
        mappingStrategy: 'oklab_nearest',
      });

      const newIndices = new Uint8Array(4096);
      for (let i = 0; i < 4096; i++) {
        if (transparentFlags[i]) {
          newIndices[i] = TRANSPARENT_INDEX;
          continue;
        }
        const mappedColor = remapResult.outputPixels[i];
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let p = 0; p < fullPaletteRgb.length; p++) {
          const pal = fullPaletteRgb[p];
          const dist =
            Math.abs(pal[0] - mappedColor[0]) +
            Math.abs(pal[1] - mappedColor[1]) +
            Math.abs(pal[2] - mappedColor[2]);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = p;
            if (dist === 0) break;
          }
        }
        newIndices[i] = bestIdx;
      }

      // 7. 运行核心几何门禁与语义分割，自动生成 5 分区互斥遮罩
      const newMask = this.generateSemanticMaskFromPixels(rgbPixels);
      for (let i = 0; i < 4096; i++) {
        if (transparentFlags[i]) {
          newMask[i] = SemanticZone.Background;
        }
      }

      // 8. 更新全局状态
      this.clearHairDraft();
      this.hasInitializedMaskMatchPreset = false;
      this.state.pixelIndices = newIndices;
      this.state.semanticMask = newMask;
      this.state.currentHairPreset = this.detectHairPreset(newIndices, newMask);
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
    const mask = new Uint8Array(4096);
    try {
      const gate = new StrictGeometryGate();
      const mouthDetector = new MouthDetector();
      const geom = gate.analyzeImage(pixels);
      const mouth = mouthDetector.analyzeImage(pixels, geom.face);
      const semInitial = analyzeSemanticRegions(pixels, geom, mouth);
      const sem = assignResidualRegions(
        semInitial,
        geom.outer.foregroundMask,
        geom.face.features.chin_y
      );

      const chinY = typeof geom.face.features.chin_y === 'number' ? geom.face.features.chin_y : 38;

      for (let i = 0; i < 4096; i++) {
        const isForeground = geom.outer.foregroundMask[i];
        if (!isForeground) {
          mask[i] = SemanticZone.Background;
          continue;
        }

        // 优先级：眼睛 > 头发 > 皮肤 > 衣服
        if (sem.eyeMask[i]) {
          mask[i] = SemanticZone.Eyes;
        } else if (sem.hairMask[i]) {
          mask[i] = SemanticZone.Hair;
        } else if (sem.faceSkinMask[i] || sem.bodySkinMask[i] || sem.mouthExpressionMask[i]) {
          mask[i] = SemanticZone.Skin;
        } else if (sem.clothingMask[i] || sem.otherMask[i]) {
          mask[i] = SemanticZone.Clothes;
        } else if (sem.outlineMask[i]) {
          // 轮廓像素智能归属
          const y = Math.floor(i / 64);
          if (y > chinY) {
            mask[i] = SemanticZone.Clothes;
          } else {
            mask[i] = SemanticZone.Hair;
          }
        } else {
          mask[i] = SemanticZone.Clothes;
        }
      }
    } catch (err) {
      console.warn('Semantic analysis fallback to safe foreground:', err);
      // 容错降级：检测四角连通背景色，其余前景保守归为 Clothes(4)，绝不全图染发
      const cornerColor = pixels[0];
      const isCornerBg = (p: Rgb) =>
        Math.abs(p[0] - cornerColor[0]) + Math.abs(p[1] - cornerColor[1]) + Math.abs(p[2] - cornerColor[2]) < 25;

      for (let i = 0; i < 4096; i++) {
        if (isCornerBg(pixels[i])) {
          mask[i] = SemanticZone.Background;
        } else {
          mask[i] = SemanticZone.Clothes;
        }
      }
      this.showToast('⚠️ 人脸特征识别未达标，请在遮罩模式手动涂抹头发区域', 'warning');
    }

    return mask;
  }

  /**
   * 自动识别图像当前所属的 9 大发色预设（基于头发掩码区域内的核心发色投票）
   */
  private detectHairPreset(indices: Uint8Array, mask: Uint8Array): string | null {
    const hairCounts: Record<string, number> = {};
    let totalHair = 0;
    for (let i = 0; i < 4096; i++) {
      if (mask[i] === SemanticZone.Hair && indices[i] !== TRANSPARENT_INDEX) {
        const hex = this.state.palette[indices[i]];
        if (hex && hex !== '#FFFFFF') {
          hairCounts[hex] = (hairCounts[hex] || 0) + 1;
          totalHair++;
        }
      }
    }
    if (totalHair === 0) return null;

    let bestPreset: string | null = null;
    let bestScore = 0;

    for (const [presetKey, info] of Object.entries(RAMPS_INFO)) {
      let score = 0;
      for (const h of info.hexes) {
        if (h === '#FFFFFF') continue;
        if (hairCounts[h]) score += hairCounts[h];
      }
      if (score > bestScore) {
        bestScore = score;
        bestPreset = presetKey;
      }
    }

    return bestScore >= 50 ? bestPreset : null;
  }

  /**
   * 载入完整的 ImageGemProjectData
   */
  private loadProjectData(data: ImageGemProjectData): void {
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
    if (this.state.lockedMaskZones?.includes(currentZone)) {
      return;
    }

    // 2. 如果目标分区自身已锁定且不是擦除为背景，禁止涂抹
    if (zone !== SemanticZone.Background && this.state.lockedMaskZones?.includes(zone)) {
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
    this.strokeStartSnapshot = {
      pixelIndices: new Uint8Array(this.state.pixelIndices),
      semanticMask: new Uint8Array(this.state.semanticMask),
      currentHairPreset: this.state.currentHairPreset,
      selection: this.canvasEditor ? this.canvasEditor.getSelection() : null,
      palette: [...this.state.palette],
    };
  }

  private onStrokeEnd(didModify: boolean): void {
    if (didModify && this.strokeStartSnapshot) {
      this.state.undoStack.push(this.strokeStartSnapshot);
      if (this.state.undoStack.length > 40) {
        this.state.undoStack.shift();
      }
      this.state.redoStack = [];
      if (this.hasUnappliedHairRecolor()) {
        this.recomputeHairRecolorPreview();
      }
      this.palettePanel.update(this.state);
      this.maskPanel.update(this.state);
      this.triggerAutoSave();
    }
    this.strokeStartSnapshot = null;
  }

  private selectPaletteIndex(index: number): void {
    if (this.state.activeMode === 'mask') {
      this.setMode('pixel', () => {
        this.selectPaletteIndexDirect(index);
      });
      return;
    }
    this.selectPaletteIndexDirect(index);
  }

  private selectPaletteIndexDirect(index: number): void {
    this.state.activePaletteIndex = index;
    this.state.activeMode = 'pixel';
    this.state.showMaskOverlay = false;
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
  }

  /**
   * 从画布吸管取色 (保持当前工具不变，不触发切画笔逻辑，防止拖拽微动误涂抹破坏画面 BUG-08)
   */
  private pickColorFromCanvas(colorIdx: number, isBg: boolean = false): void {
    if (this.state.activeMode === 'mask') {
      this.setMode('pixel', () => {
        this.pickColorFromCanvasDirect(colorIdx, isBg);
      });
      return;
    }
    this.pickColorFromCanvasDirect(colorIdx, isBg);
  }

  private pickColorFromCanvasDirect(colorIdx: number, isBg: boolean = false): void {
    if (isBg) {
      this.selectBgPaletteIndexDirect(colorIdx);
    } else {
      this.state.activePaletteIndex = colorIdx;
      this.state.activeMode = 'pixel';
      this.state.showMaskOverlay = false;
      this.syncAllViews();
      if (colorIdx === TRANSPARENT_INDEX) {
        this.showToast(`🧪 已吸取前景色：[透明色]`);
      } else {
        this.showToast(`🧪 已吸取前景色 #${colorIdx} (${this.state.palette[colorIdx]})`);
      }
    }
  }

  private selectBgPaletteIndex(index: number): void {
    if (this.state.activeMode === 'mask') {
      this.setMode('pixel', () => {
        this.selectBgPaletteIndexDirect(index);
      });
      return;
    }
    this.selectBgPaletteIndexDirect(index);
  }

  private selectBgPaletteIndexDirect(index: number): void {
    this.state.bgPaletteIndex = index;
    this.state.activeMode = 'pixel';
    this.state.showMaskOverlay = false;
    this.syncAllViews();
    if (index === TRANSPARENT_INDEX) {
      this.showToast(`已设置背景色：[透明色] (鼠标右键直接擦除)`);
    } else {
      this.showToast(`已设置背景色 #${index} (${this.state.palette[index]}) (右键绘制)`);
    }
  }

  private swapFgBgColors(): void {
    const temp = this.state.activePaletteIndex;
    this.state.activePaletteIndex = this.state.bgPaletteIndex ?? TRANSPARENT_INDEX;
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

  private setActiveTool(tool: 'pen' | 'eraser' | 'bucket' | 'eyedropper' | 'select'): void {
    if (this.state.activeMode === 'mask') {
      this.setMode('pixel', () => {
        this.setActiveToolDirect(tool);
      });
      return;
    }
    this.setActiveToolDirect(tool);
  }

  private setActiveToolDirect(tool: 'pen' | 'eraser' | 'bucket' | 'eyedropper' | 'select'): void {
    this.state.activeTool = tool;
    this.state.activeMode = 'pixel';
    this.state.showMaskOverlay = false;
    this.syncAllViews();
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

    // 切换遮罩分区时，若当前处于选区或吸管工具，自动平滑切回画笔工具 (BUG-04)
    if (this.state.activeTool === 'select' || this.state.activeTool === 'eyedropper') {
      this.state.activeTool = 'pen';
    }

    if (solo || !this.state.visibleMaskZones || this.state.visibleMaskZones.length <= 1) {
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
    const current = new Set(this.state.visibleMaskZones || []);
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
      this.state.visibleMaskZones = [
        SemanticZone.Hair,
        SemanticZone.Skin,
        SemanticZone.Eyes,
        SemanticZone.Clothes,
        SemanticZone.Background,
      ];
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
    const current = new Set(this.state.lockedMaskZones || []);
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
   * 切换工作区模式：'pixel' (像素模式) 或 'mask' (遮罩模式)
   * 离开蒙版模式前，若存在未固化的发色预览，弹窗提醒用户选择应用或放弃
   */
  private setMode(mode: 'pixel' | 'mask', onProceed?: () => void): void {
    if (mode === this.state.activeMode) {
      onProceed?.();
      return;
    }

    if (mode === 'pixel' && this.state.activeMode === 'mask' && this.hasUnappliedHairRecolor()) {
      const draftName = RAMPS_INFO[this.hairPresetDraft!]?.name || '新发色';
      this.confirmModal.show({
        icon: '🎨',
        title: '应用发色修改？',
        message: `检测到您正在预览发色【${draftName}】，尚未固化到画面。`,
        subMessage: '切换到像素绘制模式前，是否将当前发色修改应用到画布？',
        buttons: [
          {
            label: '✓ 应用并切换',
            className: 'btn-primary',
            onClick: () => {
              this.commitHairRecolor();
              this.applyModeDirect('pixel');
              onProceed?.();
            },
          },
          {
            label: '✕ 放弃修改并切换',
            className: 'btn-outline',
            onClick: () => {
              this.discardHairRecolor();
              this.applyModeDirect('pixel');
              onProceed?.();
            },
          },
          {
            label: '留在蒙版模式',
            className: 'btn-ghost',
            onClick: () => {
              // 留在蒙版模式，不执行模式切换
            },
          },
        ],
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
      if (!this.state.visibleMaskZones || this.state.visibleMaskZones.length === 0) {
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
    const presetKey = this.state.maskMatchPresetKey || 'current_hair';
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
    if (!this.state.maskMatchColors) {
      this.state.maskMatchColors = [];
    }
    if (!this.state.maskMatchColors.includes(colorIdx)) {
      this.state.maskMatchColors.push(colorIdx);
      this.state.maskMatchPresetKey = 'custom';
      this.canvasEditor.update(this.state);
      this.maskToolsPanel.update(this.state);
      const hex = this.state.palette[colorIdx] || (colorIdx === 255 ? 'transparent' : '#000000');
      this.showToast(`➕ 已将颜色 #${colorIdx === 255 ? '透' : colorIdx} (${hex}) 加入框选匹配组`);
    } else {
      this.showToast(`颜色 #${colorIdx === 255 ? '透' : colorIdx} 已在匹配组中`, 'info');
    }
  }

  private removeMaskMatchColor(colorIdx: number): void {
    if (!this.state.maskMatchColors) return;
    const idx = this.state.maskMatchColors.indexOf(colorIdx);
    if (idx >= 0) {
      this.state.maskMatchColors.splice(idx, 1);
      this.state.maskMatchPresetKey = 'custom';
      this.canvasEditor.update(this.state);
      this.maskToolsPanel.update(this.state);
      this.showToast(`✕ 已从框选匹配组移除颜色 #${colorIdx === 255 ? '透' : colorIdx}`);
    }
  }

  private handleMaskBoxSelect(rect: RectSelection, action: 'add' | 'remove'): void {
    if (!this.state.isLoaded) return;
    const matchColors = new Set(this.state.maskMatchColors || []);
    if (matchColors.size === 0) {
      this.showToast('当前匹配色组为空，请先在工具箱选择预设或添加颜色', 'warning');
      return;
    }

    const lockedZones = this.state.lockedMaskZones || [];
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
        this.showToast(`✨ 已将框内 ${count} 个匹配像素划入【${zoneMeta.name.split(' ')[0]}】遮罩`, 'success');
      } else {
        this.showToast(`🧼 已将框内 ${count} 个匹配像素从【${zoneMeta.name.split(' ')[0]}】遮罩剔除`, 'info');
      }
    } else {
      this.showToast('框选范围内未找到符合当前匹配色组的未锁定像素', 'info');
    }
  }

  private setActiveMaskTool(tool: 'pen' | 'eraser' | 'bucket' | 'box_select'): void {
    this.state.activeMaskTool = tool;
    this.syncAllViews();
  }

  private setMaskBrushSize(size: 1 | 2 | 3 | 4): void {
    this.state.maskBrushSize = size;
    this.syncAllViews();
    this.showToast(`🎯 遮罩笔刷尺寸: ${size}×${size} 像素`);
  }

  private changeMaskBrushSize(delta: number): void {
    const current = this.state.maskBrushSize || 1;
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
    const lockedZones = this.state.lockedMaskZones || [];

    if (lockedZones.includes(targetZone)) {
      this.showToast(`目标分区【${zoneMeta.name}】已锁定，请先解锁后再操作`, 'warning');
      return;
    }

    this.pushUndoSnapshot();

    let count = 0;
    for (let i = 0; i < 4096; i++) {
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
      this.showToast(`✨ 已将 ${count} 个 ${colorHex} 像素划入【${zoneMeta.name.split(' ')[0]}】遮罩`, 'success');
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

  /**
   * 基于未破坏的原始基准像素与当前语义遮罩计算发色置换
   * 无论切换多少次预设，均严格以 basePixels 作为基准，避免多次累积导致色阶崩溃与光影丢失
   */
  private computeHairRecolorPixels(basePixels: Uint8Array, mask: Uint8Array, presetKey: string): Uint8Array {
    const result = new Uint8Array(basePixels);
    const rampSpec = RAMPS_INFO[presetKey];
    if (!rampSpec) return result;

    const targetRamp = rampSpec.hexes;
    const currentRamp = this.state.currentHairPreset ? RAMPS_INFO[this.state.currentHairPreset]?.hexes : null;

    for (let i = 0; i < 4096; i++) {
      if (mask[i] !== SemanticZone.Hair) continue;
      const baseIdx = basePixels[i];
      if (baseIdx === TRANSPARENT_INDEX) continue;

      const currentColorHex = this.state.palette[baseIdx];
      let targetTier = -1;

      // 如果基准发色已知且均为 5 阶规范，优先采用严格 1:1 对称阶梯置换
      if (currentRamp && currentRamp.length === targetRamp.length) {
        const sourceTier = currentRamp.indexOf(currentColorHex);
        if (sourceTier >= 0) {
          targetTier = sourceTier;
        } else {
          targetTier = nearestTierForColor(currentColorHex, currentRamp);
        }
      }

      // 未知色阶或杂色像素，基于相对亮度感知距离平滑映射
      if (targetTier < 0 || targetTier >= targetRamp.length) {
        targetTier = nearestTierForColor(currentColorHex, targetRamp);
      }

      // 安全限制阶梯范围
      targetTier = Math.max(0, Math.min(targetRamp.length - 1, targetTier));
      const newHex = targetRamp[targetTier];

      // 在当前 36 色板中寻找对应项索引
      let newIdx = this.state.palette.indexOf(newHex);
      if (newIdx === -1) {
        const nearestHex = findNearestColor(newHex, this.state.palette);
        newIdx = this.state.palette.indexOf(nearestHex);
      }

      result[i] = newIdx >= 0 ? newIdx : 0;
    }

    return result;
  }

  /**
   * 重新计算发色预览并更新画布
   */
  private recomputeHairRecolorPreview(): void {
    if (!this.hasUnappliedHairRecolor() || !this.hairRecolorBase) return;
    this.recoloredPixels = this.computeHairRecolorPixels(
      this.hairRecolorBase,
      this.state.semanticMask,
      this.hairPresetDraft!
    );
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
    for (let i = 0; i < 4096; i++) {
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
    this.recoloredPixels = this.computeHairRecolorPixels(this.hairRecolorBase, this.state.semanticMask, presetKey);

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
   * 弹出全屏居中对话框供用户固化或还原发色修改
   */
  public openHairRecolorModal(): void {
    if (!this.hasUnappliedHairRecolor()) return;

    const draftName = RAMPS_INFO[this.hairPresetDraft!]?.name || '新发色';
    this.confirmModal.show({
      icon: '💇',
      title: '固化或还原发色',
      message: `当前正在预览发色【${draftName}】。`,
      subMessage: '请选择是否将此发色固化应用到画面中，或放弃并还原：',
      buttons: [
        {
          label: '✓ 确认应用并固化',
          className: 'btn-primary',
          onClick: () => {
            this.commitHairRecolor();
          },
        },
        {
          label: '✕ 放弃修改并还原',
          className: 'btn-outline',
          onClick: () => {
            this.discardHairRecolor();
          },
        },
        {
          label: '继续试色',
          className: 'btn-ghost',
          onClick: () => {},
        },
      ],
    });
  }

  /**
   * 重新识别语义遮罩 (不影响像素画已有绘制)
   */
  private recomputeSemanticMask(): void {
    if (!this.state.isLoaded) return;

    this.pushUndoSnapshot();

    // 根据当前 pixelIndices + palette 构造 RGB 数组 (透明像素以纯白作为背景基准传入分析器 BUG-09)
    const pixels: Rgb[] = [];
    const paletteRgb = this.state.palette.map((hex) => hexToRgb(hex));
    for (let i = 0; i < 4096; i++) {
      const idx = this.state.pixelIndices[i];
      if (idx === TRANSPARENT_INDEX) {
        pixels.push([255, 255, 255]);
      } else {
        pixels.push(paletteRgb[idx] || [0, 0, 0]);
      }
    }

    const newMask = this.generateSemanticMaskFromPixels(pixels);

    // 核心保护：所有原生透明像素必须强制为背景 SemanticZone.Background (0) (BUG-09)
    for (let i = 0; i < 4096; i++) {
      if (this.state.pixelIndices[i] === TRANSPARENT_INDEX) {
        newMask[i] = SemanticZone.Background;
      }
    }

    // 如果有锁定的遮罩分区，保留被锁定的像素！
    const lockedSet = new Set(this.state.lockedMaskZones || []);
    if (lockedSet.size > 0) {
      for (let i = 0; i < 4096; i++) {
        const oldZone = this.state.semanticMask[i];
        if (lockedSet.has(oldZone)) {
          newMask[i] = oldZone;
        }
      }
    }

    this.state.semanticMask = newMask;
    this.state.activeMode = 'mask';
    this.state.showMaskOverlay = true;
    if (!this.state.visibleMaskZones || this.state.visibleMaskZones.length === 0) {
      this.state.visibleMaskZones = [
        SemanticZone.Hair,
        SemanticZone.Skin,
        SemanticZone.Eyes,
        SemanticZone.Clothes,
        SemanticZone.Background,
      ];
    }

    if (this.hasUnappliedHairRecolor()) {
      this.recomputeHairRecolorPreview();
    }

    this.syncAllViews();
    this.triggerAutoSave();
    this.showToast('✨ 语义遮罩已重新识别完成并进入遮罩模式！', 'success');
  }

  /**
   * 扣除外围白色背景为原生透明色 (4-连通 BFS 泛洪算法，仅扣除从边界连通的白色，绝对保护眼白、高光、服饰内部白)
   */
  public removeOuterWhite(): void {
    if (!this.state.isLoaded) {
      this.showToast('请先载入 64×64 像素头像后再扣除白底', 'warning');
      return;
    }

    const { pixelIndices, semanticMask, palette } = this.state;
    const lockedSet = new Set(this.state.lockedMaskZones || []);

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

    const visited = new Uint8Array(4096);
    const queue = new Int32Array(4096);
    let head = 0;
    let tail = 0;

    // 1. 从 64×64 的四条外边界 (y=0, y=63, x=0, x=63) 开始搜寻所有背景白色或透明像素并入队
    for (let x = 0; x < 64; x++) {
      const topIdx = x;
      if (!visited[topIdx] && isBgWhiteOrTrans(topIdx)) {
        visited[topIdx] = 1;
        queue[tail++] = topIdx;
      }
      const bottomIdx = 4032 + x; // 63 * 64 + x
      if (!visited[bottomIdx] && isBgWhiteOrTrans(bottomIdx)) {
        visited[bottomIdx] = 1;
        queue[tail++] = bottomIdx;
      }
    }

    for (let y = 0; y < 64; y++) {
      const leftIdx = y * 64;
      if (!visited[leftIdx] && isBgWhiteOrTrans(leftIdx)) {
        visited[leftIdx] = 1;
        queue[tail++] = leftIdx;
      }
      const rightIdx = y * 64 + 63;
      if (!visited[rightIdx] && isBgWhiteOrTrans(rightIdx)) {
        visited[rightIdx] = 1;
        queue[tail++] = rightIdx;
      }
    }

    // 2. 4-连通 BFS 泛洪扩展，严格只向外围连通的白色像素扩散
    const toClear: number[] = [];

    while (head < tail) {
      const curr = queue[head++];
      const cx = curr & 63;

      // 如果当前像素非透明（是实体白色），记录需要扣除为透明
      if (pixelIndices[curr] !== TRANSPARENT_INDEX) {
        toClear.push(curr);
      }

      // 上下左右 4 邻域搜索
      if (cx > 0) {
        const n = curr - 1;
        if (!visited[n] && isBgWhiteOrTrans(n)) {
          visited[n] = 1;
          queue[tail++] = n;
        }
      }
      if (cx < 63) {
        const n = curr + 1;
        if (!visited[n] && isBgWhiteOrTrans(n)) {
          visited[n] = 1;
          queue[tail++] = n;
        }
      }
      if (curr >= 64) {
        const n = curr - 64;
        if (!visited[n] && isBgWhiteOrTrans(n)) {
          visited[n] = 1;
          queue[tail++] = n;
        }
      }
      if (curr < 4032) {
        const n = curr + 64;
        if (!visited[n] && isBgWhiteOrTrans(n)) {
          visited[n] = 1;
          queue[tail++] = n;
        }
      }
    }

    if (toClear.length === 0) {
      this.showToast('ℹ️ 未检测到外围连通的白色背景像素', 'info');
      return;
    }

    // 3. 提交一次性撤销快照 (支持 Ctrl+Z 撤销)
    this.pushUndoSnapshot();

    // 4. 将待扣除像素在原图数据中直接设为原生透明色与背景分区
    for (const idx of toClear) {
      pixelIndices[idx] = TRANSPARENT_INDEX;
      semanticMask[idx] = SemanticZone.Background;
    }

    // 5. 触发视图全量同步与自动存盘
    this.syncAllViews();
    this.triggerAutoSave();
    this.showToast(`✂️ 已扣除 ${toClear.length} 个外围背景白像素为原生透明色 (人物眼白与高光完好)`, 'success');
  }

  /**
   * 翻转内容统一调度：优先翻转选区，若无选区则翻转整张画布
   */
  public flipContent(axis: 'horizontal' | 'vertical'): void {
    if (!this.state.isLoaded) return;

    if (this.canvasEditor.hasSelection()) {
      this.canvasEditor.flipSelectionContent(axis);
      const label = axis === 'horizontal' ? '↔ 水平' : '↕ 垂直';
      this.showToast(`${label}翻转选区完成`);
    } else {
      this.flipCanvas(axis);
      const label = axis === 'horizontal' ? '↔ 水平' : '↕ 垂直';
      this.showToast(`${label}翻转整张画布完成`);
    }
  }

  /**
   * 整张 64×64 画布水平/垂直翻转
   */
  public flipCanvas(axis: 'horizontal' | 'vertical'): void {
    if (!this.state.isLoaded) return;
    this.pushUndoSnapshot();

    const pi = this.state.pixelIndices;
    const sm = this.state.semanticMask;

    if (axis === 'horizontal') {
      for (let y = 0; y < 64; y++) {
        const row = y * 64;
        for (let x = 0; x < 32; x++) {
          const l = row + x;
          const r = row + (63 - x);
          const tempP = pi[l];
          pi[l] = pi[r];
          pi[r] = tempP;

          const tempM = sm[l];
          sm[l] = sm[r];
          sm[r] = tempM;
        }
      }
    } else {
      for (let y = 0; y < 32; y++) {
        const topRow = y * 64;
        const botRow = (63 - y) * 64;
        for (let x = 0; x < 64; x++) {
          const t = topRow + x;
          const b = botRow + x;
          const tempP = pi[t];
          pi[t] = pi[b];
          pi[b] = tempP;

          const tempM = sm[t];
          sm[t] = sm[b];
          sm[b] = tempM;
        }
      }
    }

    this.syncAllViews();
    this.triggerAutoSave();
  }

  /**
   * 顺时针旋转90°统一调度：优先旋转选区，若无选区则旋转整张画布
   */
  public rotateContentCW(): void {
    if (!this.state.isLoaded) return;

    if (this.canvasEditor.hasSelection()) {
      this.canvasEditor.rotateSelectionContentCW();
      this.showToast('↻ 顺时针旋转选区 90° 完成');
    } else {
      this.rotateCanvasCW();
      this.showToast('↻ 顺时针旋转整张画布 90° 完成');
    }
  }

  /**
   * 整张 64×64 画布顺时针旋转 90°
   */
  public rotateCanvasCW(): void {
    if (!this.state.isLoaded) return;
    this.pushUndoSnapshot();

    const pi = this.state.pixelIndices;
    const sm = this.state.semanticMask;
    const oldP = new Uint8Array(pi);
    const oldM = new Uint8Array(sm);

    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        // 90° CW: new_x = 63 - y, new_y = x
        const newX = 63 - y;
        const newY = x;
        const oldOff = y * 64 + x;
        const newOff = newY * 64 + newX;
        pi[newOff] = oldP[oldOff];
        sm[newOff] = oldM[oldOff];
      }
    }

    this.syncAllViews();
    this.triggerAutoSave();
  }

  // ===================== 撤销与重做 =====================

  private pushUndoSnapshot(): void {
    const snapshot: UndoSnapshot = {
      pixelIndices: new Uint8Array(this.state.pixelIndices),
      semanticMask: new Uint8Array(this.state.semanticMask),
      currentHairPreset: this.state.currentHairPreset,
      selection: this.canvasEditor ? this.canvasEditor.getSelection() : null,
      palette: [...this.state.palette],
    };

    this.state.undoStack.push(snapshot);
    if (this.state.undoStack.length > 40) {
      this.state.undoStack.shift();
    }
    this.state.redoStack = [];
    this.palettePanel.update(this.state);
    this.maskPanel.update(this.state);
  }

  private undo(): void {
    if (this.hasUnappliedHairRecolor()) {
      this.discardHairRecolor();
    }
    if (this.state.undoStack.length === 0) return;

    const currentSnapshot: UndoSnapshot = {
      pixelIndices: new Uint8Array(this.state.pixelIndices),
      semanticMask: new Uint8Array(this.state.semanticMask),
      currentHairPreset: this.state.currentHairPreset,
      selection: this.canvasEditor ? this.canvasEditor.getSelection() : null,
      palette: [...this.state.palette],
    };
    this.state.redoStack.push(currentSnapshot);

    const prevSnapshot = this.state.undoStack.pop()!;
    this.state.pixelIndices.set(prevSnapshot.pixelIndices);
    this.state.semanticMask.set(prevSnapshot.semanticMask);
    this.state.currentHairPreset = prevSnapshot.currentHairPreset ?? null;
    if (prevSnapshot.palette) {
      this.state.palette = [...prevSnapshot.palette];
    }
    this.canvasEditor.setSelection(prevSnapshot.selection ?? null);

    this.syncAllViews();
    this.triggerAutoSave();
    this.showToast('↩️ 撤销成功');
  }

  private redo(): void {
    if (this.hasUnappliedHairRecolor()) {
      this.discardHairRecolor();
    }
    if (this.state.redoStack.length === 0) return;

    const currentSnapshot: UndoSnapshot = {
      pixelIndices: new Uint8Array(this.state.pixelIndices),
      semanticMask: new Uint8Array(this.state.semanticMask),
      currentHairPreset: this.state.currentHairPreset,
      selection: this.canvasEditor ? this.canvasEditor.getSelection() : null,
      palette: [...this.state.palette],
    };
    this.state.undoStack.push(currentSnapshot);

    const nextSnapshot = this.state.redoStack.pop()!;
    this.state.pixelIndices.set(nextSnapshot.pixelIndices);
    this.state.semanticMask.set(nextSnapshot.semanticMask);
    this.state.currentHairPreset = nextSnapshot.currentHairPreset ?? null;
    if (nextSnapshot.palette) {
      this.state.palette = [...nextSnapshot.palette];
    }
    this.canvasEditor.setSelection(nextSnapshot.selection ?? null);

    this.syncAllViews();
    this.triggerAutoSave();
    this.showToast('↪️ 重做成功');
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

    const count = this.canvasEditor.replaceColor(fromIdx, toIdx, scope);
    if (count > 0) {
      this.syncAllViews();
      this.triggerAutoSave();
      const scopeDesc = scope === 'selection' ? '选区内' : '整张画布';
      this.showToast(`🔄 已成功在${scopeDesc}替换 ${count} 个像素点`, 'success');
    } else {
      this.showToast('未找到匹配的原颜色像素点', 'info');
    }
  }

  // ===================== 全局快捷键与存盘 =====================

  private setupGlobalKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      // 仅忽略处于真正文本编辑状态下的按键 (如文本框输入中)，滑杆 (range)、复选框 (checkbox)、单选框 (radio) 等非文本输入组件不阻塞快捷键
      const target = e.target as HTMLElement | null;
      if (target) {
        if (target.isContentEditable || target.tagName === 'TEXTAREA') {
          return;
        }
        if (target.tagName === 'INPUT') {
          const type = ((target as HTMLInputElement).type || 'text').toLowerCase();
          const nonTextTypes = ['range', 'checkbox', 'radio', 'color', 'button', 'submit', 'reset'];
          if (!nonTextTypes.includes(type)) {
            return;
          }
        }
      }

      // 颜色替换弹窗开启期间，忽略全局快捷键，防止后台误触
      if (this.replaceColorModal?.getIsOpen()) {
        return;
      }

      const key = e.key.toLowerCase();
      const code = e.code;
      const ctrlOrCmd = e.ctrlKey || e.metaKey;

      // 颜色替换快捷键 (Shift+R)
      if (e.shiftKey && (key === 'r' || code === 'KeyR')) {
        e.preventDefault();
        this.openReplaceColorModal();
        return;
      }

      // 水平翻转快捷键 (Shift+H)
      if (e.shiftKey && (key === 'h' || code === 'KeyH')) {
        e.preventDefault();
        this.flipContent('horizontal');
        return;
      }

      // 垂直翻转快捷键 (Shift+V)
      if (e.shiftKey && (key === 'v' || code === 'KeyV')) {
        e.preventDefault();
        this.flipContent('vertical');
        return;
      }

      // 顺时针旋转90°快捷键 (Shift+T)
      if (e.shiftKey && (key === 't' || code === 'KeyT')) {
        e.preventDefault();
        this.rotateContentCW();
        return;
      }

      // 撤销 / 重做 (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y)
      if (ctrlOrCmd && (key === 'z' || code === 'KeyZ')) {
        e.preventDefault();
        if (e.shiftKey) {
          this.redo();
        } else {
          this.undo();
        }
        return;
      }

      if (ctrlOrCmd && (key === 'y' || code === 'KeyY')) {
        e.preventDefault();
        this.redo();
        return;
      }

      // 保存工程 ZIP (Ctrl+S)
      if (ctrlOrCmd && (key === 's' || code === 'KeyS')) {
        e.preventDefault();
        this.exportProjectZip();
        return;
      }

      // 复制选区 (Ctrl+C)
      if (ctrlOrCmd && (key === 'c' || code === 'KeyC')) {
        if (this.canvasEditor.hasSelection()) {
          e.preventDefault();
          const ok = this.canvasEditor.copySelection();
          if (ok) this.showToast('📋 已复制选区内容到剪贴板');
        }
        return;
      }

      // 剪切选区 (Ctrl+X)
      if (ctrlOrCmd && (key === 'x' || code === 'KeyX')) {
        if (this.canvasEditor.hasSelection()) {
          e.preventDefault();
          const ok = this.canvasEditor.cutSelection();
          if (ok) this.showToast('✂️ 已剪切选区内容到剪贴板');
        }
        return;
      }

      // 粘贴选区 (Ctrl+V)
      if (ctrlOrCmd && (key === 'v' || code === 'KeyV')) {
        if (this.canvasEditor.hasClipboard()) {
          e.preventDefault();
          const ok = this.canvasEditor.pasteClipboard();
          if (ok) this.showToast('📋 已从剪贴板粘贴选区');
          return;
        }
      }

      // 取消选区 (Ctrl+D)
      if (ctrlOrCmd && (key === 'd' || code === 'KeyD')) {
        e.preventDefault();
        if (this.canvasEditor.hasSelection()) {
          this.canvasEditor.clearSelection();
          this.showToast('已取消矩形选区');
        }
        return;
      }

      // 全选整张画布 (Ctrl+A)
      if (ctrlOrCmd && (key === 'a' || code === 'KeyA')) {
        e.preventDefault();
        this.canvasEditor.selectAll();
        this.showToast('已全选整张画布 (64×64)');
        return;
      }

      // 拦截 Ctrl+P 避免调出系统打印窗口，并友好切换为画笔工具
      if (ctrlOrCmd && (key === 'p' || code === 'KeyP')) {
        e.preventDefault();
        this.setActiveTool('pen');
        this.showToast('✏️ 已切换为画笔工具 (左键绘制前景色，右键绘制背景色)');
        return;
      }

      // 取消选区 (Escape)
      if (key === 'escape' || code === 'Escape') {
        if (this.canvasEditor.hasSelection()) {
          this.canvasEditor.clearSelection();
          this.showToast('已取消矩形选区');
        }
        return;
      }

      // 清空选区内容 (Delete / Backspace)
      if (key === 'delete' || key === 'backspace' || code === 'Delete' || code === 'Backspace') {
        if (this.canvasEditor.hasSelection()) {
          e.preventDefault();
          const didDelete = this.canvasEditor.deleteSelectionContent();
          if (didDelete) {
            this.showToast('🧼 已将选区内容清空为透明像素');
          }
          return;
        }
      }

      // 如果按住了 Ctrl / Meta / Alt 组合键 (且上面未处理)，避免误触单字母工具快捷键
      if (ctrlOrCmd || e.altKey) {
        return;
      }

      // 笔刷尺寸切换快捷键 ( [ 减小 / ] 增大)
      if (key === '[' || code === 'BracketLeft') {
        if (this.state.activeMode === 'mask') {
          this.changeMaskBrushSize(-1);
          return;
        }
      } else if (key === ']' || code === 'BracketRight') {
        if (this.state.activeMode === 'mask') {
          this.changeMaskBrushSize(1);
          return;
        }
      }

      // 单字母工具快捷键 (同时匹配 key 与 code，抗中文输入法 / CapsLock 干扰)
      if (key === 'q' || code === 'KeyQ') {
        this.setMode('pixel');
      } else if (key === 'w' || code === 'KeyW') {
        this.setMode('mask');
      } else if (key === 'm' || key === 's' || code === 'KeyM' || code === 'KeyS') {
        if (this.state.activeMode === 'mask') {
          this.setActiveMaskTool('box_select');
          this.showToast('🔲 已切换为智能框选工具 (左键拖拽匹配色划入遮罩，右键剔除)');
        } else {
          this.setActiveTool('select');
          this.showToast('⬚ 矩形选区工具：拖拽框选，选区内拖动平移 (原位透明)，按住 Ctrl 复制');
        }
      } else if (key === 'p' || code === 'KeyP') {
        if (this.state.activeMode === 'mask') {
          this.setActiveMaskTool('pen');
          this.showToast('✏️ 已切换为遮罩画笔');
        } else {
          this.setActiveTool('pen');
          this.showToast('✏️ 已切换为画笔工具 (左键绘制前景色，右键绘制背景色)');
        }
      } else if (key === 'b' || key === 'f' || code === 'KeyB' || code === 'KeyF') {
        if (this.state.activeMode === 'mask') {
          this.setActiveMaskTool('bucket');
          this.showToast(`🪣 已切换为遮罩油漆桶 (${this.state.bucketConnectivity} 邻居连通)`);
        } else {
          if (this.state.activeTool === 'bucket') {
            const nextConn = this.state.bucketConnectivity === 8 ? 4 : 8;
            this.setBucketConnectivity(nextConn);
          } else {
            this.setActiveTool('bucket');
            this.showToast(`🪣 已切换为油漆桶工具 (当前：${this.state.bucketConnectivity} 邻居连通)`);
          }
        }
      } else if (key === 'e' || code === 'KeyE') {
        if (this.state.activeMode === 'mask') {
          this.setActiveMaskTool('eraser');
          this.showToast('🧼 已切换为遮罩橡皮擦 (擦除为背景 0)');
        } else {
          this.setActiveTool('eraser');
          this.showToast('🧼 已切换为橡皮擦工具 (原生透明删除)');
        }
      } else if (key === 'i' || code === 'KeyI') {
        if (this.state.activeMode === 'mask') {
          this.showToast('吸管工具仅在像素画图模式下有效 (按 Q 切换)', 'info');
        } else {
          this.setActiveTool('eyedropper');
        }
      } else if (key === 'g' || code === 'KeyG') {
        this.setGrid(!this.state.showGrid);
      } else if (key === 'x' || code === 'KeyX') {
        this.swapFgBgColors();
      } else if (key === '0' || code === 'Digit0' || code === 'Numpad0') {
        this.setActiveZone(SemanticZone.Background);
        this.showToast('⚫ 已选择背景遮罩 [0]');
      } else if (key === '1' || code === 'Digit1' || code === 'Numpad1') {
        this.setActiveZone(SemanticZone.Hair);
        this.showToast('🔴 已选择头发遮罩 [1]');
      } else if (key === '2' || code === 'Digit2' || code === 'Numpad2') {
        this.setActiveZone(SemanticZone.Skin);
        this.showToast('🟢 已选择皮肤遮罩 [2]');
      } else if (key === '3' || code === 'Digit3' || code === 'Numpad3') {
        this.setActiveZone(SemanticZone.Eyes);
        this.showToast('🔵 已选择眼睛遮罩 [3]');
      } else if (key === '4' || code === 'Digit4' || code === 'Numpad4') {
        this.setActiveZone(SemanticZone.Clothes);
        this.showToast('🟡 已选择衣服遮罩 [4]');
      } else if (key === 'v' || code === 'KeyV') {
        this.toggleRealtimePreview();
      }
    });
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

  public async exportProjectPng(): Promise<void> {
    if (!this.state.isLoaded) {
      this.showToast('请先载入头像后再导出 PNG', 'warning');
      return;
    }

    if (this.hasUnappliedHairRecolor()) {
      const draftName = RAMPS_INFO[this.hairPresetDraft!]?.name || '新发色';
      this.confirmModal.show({
        icon: '💾',
        title: '导出 PNG 发色确认',
        message: `当前处于发色【${draftName}】预览状态，尚未固化到画布。`,
        subMessage: '请选择如何导出该头像 PNG：',
        buttons: [
          {
            label: '✓ 应用新发色并导出',
            className: 'btn-primary',
            onClick: async () => {
              this.commitHairRecolor();
              await this.doExportProjectPng();
            },
          },
          {
            label: '以原图发色导出',
            className: 'btn-outline',
            onClick: async () => {
              await this.doExportProjectPng();
            },
          },
          {
            label: '取消',
            className: 'btn-ghost',
            onClick: () => {},
          },
        ],
      });
      return;
    }

    await this.doExportProjectPng();
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

  public async exportProjectZip(): Promise<void> {
    if (!this.state.isLoaded) {
      this.showToast('请先载入头像后再导出工程 ZIP', 'warning');
      return;
    }

    if (this.hasUnappliedHairRecolor()) {
      const draftName = RAMPS_INFO[this.hairPresetDraft!]?.name || '新发色';
      this.confirmModal.show({
        icon: '📦',
        title: '导出 ZIP 发色确认',
        message: `当前处于发色【${draftName}】预览状态，尚未固化到工程中。`,
        subMessage: '请选择如何打包导出工程 ZIP：',
        buttons: [
          {
            label: '✓ 应用新发色并打包',
            className: 'btn-primary',
            onClick: async () => {
              this.commitHairRecolor();
              await this.doExportProjectZip();
            },
          },
          {
            label: '以原图发色打包',
            className: 'btn-outline',
            onClick: async () => {
              await this.doExportProjectZip();
            },
          },
          {
            label: '取消',
            className: 'btn-ghost',
            onClick: () => {},
          },
        ],
      });
      return;
    }

    await this.doExportProjectZip();
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
  new ImageGemApp();
});
