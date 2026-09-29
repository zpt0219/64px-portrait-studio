/**
 * 主画布：像素与遮罩渲染、鼠标/键盘交互、工具分发、矩形选区交互。
 * 画布只读取 StudioState，所有修改通过回调交给 main 执行。
 */

import { StudioState, SemanticZone, ZONE_CONFIG, RectSelection } from '../types';
import { TRANSPARENT_INDEX } from '../data/palette';
import { getToolCursors } from '../utils/cursorUtils';
import { Patch, Layers, extractPatch } from '../core/editOps';
import { drawIndexedPixels } from '../core/pixelRender';
import { ContextBar } from './canvas/ContextBar';
import { SelectionStatsPanel } from './canvas/SelectionStatsPanel';
import {
  drawZoneOverlay,
  drawPatchPixels,
  drawMatchPreview,
  drawGrid,
  drawColorHighlight,
  drawMarchingAnts,
} from './canvas/overlays';

const ZOOM_STEPS = [4, 6, 8, 12, 16, 24, 32] as const;

interface CanvasEditorCallbacks {
  onStrokeStart: () => void;
  onPixelDraw: (x: number, y: number, paletteIndex: number) => void;
  onMaskDraw: (x: number, y: number, zone: SemanticZone) => void;
  onStrokeEnd: (didModify: boolean) => void;
  onColorPick: (paletteIndex: number, isBackground?: boolean) => void;
  onFileDrop: (file: File) => void;
  onRestoreStorage: () => void;
  onTriggerUpload: () => void;
  onZoomChange: (zoom: number) => void;
  onGridToggle: (showGrid: boolean) => void;
  onTogglePreview?: () => void;
  onRemoveOuterWhite?: () => void;
  onRedrawHook?: (offscreenCanvas: HTMLCanvasElement, isLoaded: boolean) => void;
  onOpenReplaceColor?: () => void;
  onFlipHorizontal?: () => void;
  onFlipVertical?: () => void;
  onRotateCW?: () => void;
  onSetBucketConnectivity?: (connectivity: 4 | 8) => void;
  onMaskBoxSelect?: (rect: RectSelection, action: 'add' | 'remove') => void;
  /** 油漆桶点击 (像素或遮罩模式)；replaceAll 为 Shift+点击的全域同色替换。返回是否修改了画面 */
  onBucket: (x: number, y: number, button: 0 | 2, replaceAll: boolean) => boolean;
  /** 选区拖动放下：把 patch 从 from 移到 (toX, toY)，copy 为 true 时保留原位置 */
  onMoveSelection: (patch: Patch, from: RectSelection, toX: number, toY: number, copy: boolean) => void;
}

export class CanvasEditor {
  private container: HTMLElement;
  private callbacks: CanvasEditorCallbacks;

  // DOM 元素
  private canvasWrapper: HTMLElement | null = null;
  private displayCanvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private hoverInfoEl: HTMLElement | null = null;
  private contextBar!: ContextBar;
  private selectionStats!: SelectionStatsPanel;
  private emptyStateEl: HTMLElement | null = null;

  // 离屏渲染
  private offscreenPixelCanvas: HTMLCanvasElement;
  private offscreenPixelCtx: CanvasRenderingContext2D;

  // 状态追踪
  private isMouseDown = false;
  private currentMouseButton: 0 | 2 = 0; // 0: 左键 (前景色), 2: 右键 (背景色)
  private currentIsAlt = false;          // 按住 Alt 键时执行吸管快速取色
  private currentIsShift = false;        // 按住 Shift 键 (油漆桶非连通全域替换等)
  private lastX = -1;
  private lastY = -1;
  private currentState: StudioState | null = null;
  private hasStorageSnapshot = false;
  private strokeModified = false;
  private isSpacePressed = false;
  private maskBoxAction: 'add' | 'remove' | null = null;

  // 矩形选区核心状态 (Aseprite 规范：框选、平移填白、Ctrl 复制)
  private currentSelection: RectSelection | null = null;
  private isBoxSelecting = false;
  private boxSelectStart: [number, number] = [0, 0];
  private boxSelectCurrent: RectSelection | null = null;

  // 选区平移与复制浮动图层
  private isMovingSelection = false;
  private dragStartPixel: [number, number] = [0, 0];
  private moveOffset: [number, number] = [0, 0];
  private isCopyMode = false;
  private wasCopyTriggered = false;
  private floatingPatch: { origX: number; origY: number; patch: Patch } | null = null;

  // 走马灯虚线动画 (Marching Ants)
  private marchingAntsTimer: number | null = null;
  private marchingAntsOffset = 0;

  // 通用色彩探针高亮状态 (调色板索引，null 为不高亮)
  private highlightedPaletteIndex: number | null = null;

  // 蒙版发色无损预览像素缓存 (非空时优先绘制此缓存，不破坏原始像素)
  private previewPixelIndices: Uint8Array | null = null;

  constructor(container: HTMLElement, callbacks: CanvasEditorCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.offscreenPixelCanvas = document.createElement('canvas');
    this.offscreenPixelCanvas.width = 64;
    this.offscreenPixelCanvas.height = 64;
    this.offscreenPixelCtx = this.offscreenPixelCanvas.getContext('2d')!;

    this.render();
    this.setupEventListeners();
  }

  public setHasStorageSnapshot(has: boolean): void {
    this.hasStorageSnapshot = has;
    this.updateEmptyState();
  }

  public setPreviewPixels(pixels: Uint8Array | null): void {
    this.previewPixelIndices = pixels;
    this.redraw();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="canvas-editor-area">
        <div class="canvas-toolbar">
          <div class="tool-group zoom-tool-group">
            <span class="toolbar-label">缩放:</span>
            <input type="range" class="zoom-range-slider" id="zoom-range-slider" min="0" max="6" step="1" value="3" title="调整画布缩放 (4×, 6×, 8×, 12×, 16×, 24×, 32×)">
            <span class="zoom-level-text" id="zoom-text">12×</span>
            <button class="tool-btn btn-zoom-reset" id="btn-zoom-fit" title="重置适合缩放 (12×)">12× 适合</button>
          </div>

          <div class="tool-divider"></div>

          <div class="tool-group">
            <button class="tool-btn" id="btn-toggle-grid" title="切换像素网格 (快捷键 G)">
              <span class="btn-icon">▦</span> 网格
            </button>
            <button class="tool-btn" id="btn-toggle-preview" title="请先载入头像以开启原寸预览 (快捷键 V)">
              <span class="btn-icon">👁️</span> 预览
            </button>
            <button class="tool-btn" id="btn-remove-outer-white" title="扣除外围连通白色背景为原生透明色 (仅清除外围背景白，保护眼白与服饰高光)">
              <span class="btn-icon">✂️</span> 扣外围白底
            </button>
          </div>

          <div class="canvas-coords-bar" id="hover-coords-bar">
            <span>X: -- Y: --</span>
            <span class="hover-color-chip" style="display:none;"></span>
            <span class="hover-zone-chip" style="display:none;"></span>
          </div>
        </div>

        <!-- 画布悬浮临时/上下文微调工具栏 (平时隐藏，选区或工具调参时显现) -->
        <div class="floating-context-bar" id="floating-context-bar" style="display: none;"></div>

        <!-- 选区颜色统计浮动面板 (平时隐藏，选区激活时显示) -->
        <div class="selection-color-stats-panel" id="selection-color-stats-panel" style="display: none;"></div>

        <div class="canvas-viewport" id="canvas-viewport">
          <div class="canvas-container" id="canvas-container">
            <canvas id="main-display-canvas" width="512" height="512"></canvas>
            <div class="empty-dropzone" id="empty-dropzone" style="display: none;">
              <div class="dropzone-icon">🖼️</div>
              <div class="dropzone-title">拖入工程 ZIP 或参考图片</div>
              <div class="dropzone-sub">工程 ZIP：完整恢复历史进度与图层遮罩 · 图片 (PNG/JPG/WebP)：新建项目并量化为 36 色</div>
              <div class="dropzone-actions">
                <button class="btn btn-primary" id="btn-empty-upload">点击选择文件</button>
              </div>
              <div class="restore-banner" id="restore-banner" style="display: none;">
                <span class="restore-banner-text">⚠️ 检测到上次未完成的编辑进度</span>
                <div class="restore-banner-actions">
                  <button class="btn btn-warning btn-sm" id="btn-restore-project">立即恢复</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.canvasWrapper = this.container.querySelector('#canvas-container');
    this.displayCanvas = this.container.querySelector('#main-display-canvas');
    this.ctx = this.displayCanvas ? this.displayCanvas.getContext('2d') : null;
    this.hoverInfoEl = this.container.querySelector('#hover-coords-bar');
    this.emptyStateEl = this.container.querySelector('#empty-dropzone');

    this.setupToolbarEvents();
  }

  private setupToolbarEvents(): void {
    const zoomSlider = this.container.querySelector('#zoom-range-slider') as HTMLInputElement | null;
    const zoomFitBtn = this.container.querySelector('#btn-zoom-fit');
    const toggleGridBtn = this.container.querySelector('#btn-toggle-grid');
    const togglePreviewBtn = this.container.querySelector('#btn-toggle-preview');

    zoomSlider?.addEventListener('input', (e) => {
      const idx = parseInt((e.target as HTMLInputElement).value, 10);
      const nextZoom = ZOOM_STEPS[idx] ?? 12;
      this.callbacks.onZoomChange(nextZoom);
    });

    zoomSlider?.addEventListener('change', () => {
      zoomSlider.blur();
    });

    zoomFitBtn?.addEventListener('click', () => {
      this.callbacks.onZoomChange(12);
    });

    toggleGridBtn?.addEventListener('click', () => {
      if (!this.currentState) return;
      this.callbacks.onGridToggle(!this.currentState.showGrid);
    });

    togglePreviewBtn?.addEventListener('click', () => {
      this.callbacks.onTogglePreview?.();
    });

    const removeOuterWhiteBtn = this.container.querySelector('#btn-remove-outer-white');
    removeOuterWhiteBtn?.addEventListener('click', () => {
      this.callbacks.onRemoveOuterWhite?.();
    });

    this.container.querySelector('#btn-empty-upload')?.addEventListener('click', () => {
      this.callbacks.onTriggerUpload();
    });

    this.container.querySelector('#btn-restore-project')?.addEventListener('click', () => {
      this.callbacks.onRestoreStorage();
    });

    this.contextBar = new ContextBar(this.container.querySelector('#floating-context-bar')!, {
      onFlipHorizontal: () => this.callbacks.onFlipHorizontal?.(),
      onFlipVertical: () => this.callbacks.onFlipVertical?.(),
      onRotateCW: () => this.callbacks.onRotateCW?.(),
      onOpenReplaceColor: () => this.callbacks.onOpenReplaceColor?.(),
      onCancelSelection: () => this.clearSelection(),
      onSetBucketConnectivity: (conn) => this.callbacks.onSetBucketConnectivity?.(conn),
    });

    this.selectionStats = new SelectionStatsPanel(this.container.querySelector('#selection-color-stats-panel')!, {
      onColorPick: (idx, isBg) => this.callbacks.onColorPick(idx, isBg),
      onHighlight: (idx) => this.setHighlightedColor(idx),
    });
  }

  private setupEventListeners(): void {
    if (!this.displayCanvas || !this.canvasWrapper) return;

    // 拖拽上传支持
    const viewport = this.container.querySelector('#canvas-viewport') as HTMLElement;
    viewport.addEventListener('dragover', (e) => {
      e.preventDefault();
      viewport.classList.add('dragover');
    });

    viewport.addEventListener('dragleave', (e) => {
      e.preventDefault();
      viewport.classList.remove('dragover');
    });

    viewport.addEventListener('drop', (e) => {
      e.preventDefault();
      viewport.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        this.callbacks.onFileDrop(e.dataTransfer.files[0]);
      }
    });

    // 阻止画布与视口默认右键菜单
    this.displayCanvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
    viewport.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    // 鼠标滚轮综合支持：
    // 1. 鼠标左右横向滚轮 (deltaX)：移动水平滚动条
    // 2. 按住 Shift + 上下滚轮：转为水平滚动条移动
    // 3. 按住 Ctrl / Cmd + 滚轮：步进缩放主画布
    viewport.addEventListener('wheel', (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const direction = e.deltaY < 0 ? 1 : -1;
        this.stepZoom(direction);
        return;
      }

      if (Math.abs(e.deltaX) > 0) {
        viewport.scrollLeft += e.deltaX;
        e.preventDefault();
      } else if (e.shiftKey && Math.abs(e.deltaY) > 0) {
        viewport.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });

    // 中键 (滚轮按下) 或按住空格键 + 鼠标左键拖拽平移视口
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let scrollStartX = 0;
    let scrollStartY = 0;

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code === 'Space' && !this.isSpacePressed && !(e.target as HTMLElement)?.matches('input, textarea')) {
        e.preventDefault();
        this.isSpacePressed = true;
        if (viewport) viewport.style.cursor = 'grab';
      }
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        this.isSpacePressed = false;
        if (!isPanning && viewport) {
          viewport.style.cursor = '';
        }
      }
    });

    viewport.addEventListener('mousedown', (e: MouseEvent) => {
      this.releaseControlFocus();
      if (e.button === 1 || (e.button === 0 && this.isSpacePressed)) {
        isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        scrollStartX = viewport.scrollLeft;
        scrollStartY = viewport.scrollTop;
        viewport.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }

      // 如果在视口空白处点击，且当前工具为选区工具，支持从画布外沿开始框选或点击取消选区
      if (
        e.button === 0 &&
        !this.isSpacePressed &&
        this.currentState &&
        this.currentState.isLoaded &&
        this.currentState.activeTool === 'select' &&
        e.target !== this.displayCanvas
      ) {
        const [rawX, rawY] = this.getPixelCoordsRaw(e);
        this.isMouseDown = true;
        this.isBoxSelecting = true;
        this.isMovingSelection = false;
        this.boxSelectStart = [rawX, rawY];
        this.lastX = rawX;
        this.lastY = rawY;
        this.boxSelectCurrent = { x: rawX, y: rawY, w: 1, h: 1 };
        this.currentSelection = null;
        this.updateSelectionToolbar();
        this.manageMarchingAntsAnimation();
        this.redraw();
        e.preventDefault();
      }
    });

    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (isPanning) {
        const dx = e.clientX - panStartX;
        const dy = e.clientY - panStartY;
        viewport.scrollLeft = scrollStartX - dx;
        viewport.scrollTop = scrollStartY - dy;
        e.preventDefault();
      }
    });

    window.addEventListener('mouseup', (e: MouseEvent) => {
      if (isPanning && (e.button === 1 || e.button === 0)) {
        isPanning = false;
        if (viewport) {
          viewport.style.cursor = this.isSpacePressed ? 'grab' : '';
        }
      }
    });

    // Ctrl 键、Alt 键与 Shift 键动态监听 (平移 vs 复制模式实时切换、Alt 吸管光标切换、Shift 油漆桶替换)
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        this.currentIsShift = true;
      }
      if (e.key === 'Alt') {
        if (this.isMovingSelection) {
          this.isCopyMode = true;
          this.wasCopyTriggered = true;
          if (this.displayCanvas) this.displayCanvas.style.cursor = 'copy';
          this.redraw();
        } else {
          this.updateCanvasCursor({ altKey: true });
        }
      }
      if (e.key === 'Control' || e.key === 'Meta') {
        if (this.isMovingSelection) {
          this.isCopyMode = true;
          this.wasCopyTriggered = true;
          if (this.displayCanvas) this.displayCanvas.style.cursor = 'copy';
          this.redraw();
        } else if (this.currentState?.activeTool === 'select' && this.currentSelection && this.displayCanvas) {
          if (this.lastX !== -1 && this.lastY !== -1 && this.isPixelInSelection(this.lastX, this.lastY, this.currentSelection)) {
            this.displayCanvas.style.cursor = 'copy';
          }
        }
      }
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        this.currentIsShift = false;
      }
      if (e.key === 'Alt') {
        this.updateCanvasCursor({ altKey: false });
      }
      if (e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt') {
        // 拖拽选区过程中不重置复制锁存状态：
        // 避免用户在松开鼠标按键前几十毫秒释放 Ctrl 键导致被意外判定为“非复制平移”而清空原位置像素
        if (!this.isMouseDown && !this.isMovingSelection) {
          this.isCopyMode = false;
          this.wasCopyTriggered = false;
        }
        if (this.currentState?.activeTool === 'select' && this.currentSelection && this.displayCanvas && !this.isMovingSelection) {
          if (this.lastX !== -1 && this.lastY !== -1 && this.isPixelInSelection(this.lastX, this.lastY, this.currentSelection)) {
            this.displayCanvas.style.cursor = 'move';
          }
        }
      }
    });

    // 窗口失焦保护：Alt+Tab 或点击其他窗口时重置修饰键状态，避免 Space 抓手 / Alt 吸色按键死锁
    window.addEventListener('blur', () => {
      this.isSpacePressed = false;
      this.currentIsAlt = false;
      this.currentIsShift = false;
      if (!this.isMouseDown && !this.isMovingSelection) {
        this.isCopyMode = false;
        this.wasCopyTriggered = false;
      }
      if (viewport && !isPanning) {
        viewport.style.cursor = '';
      }
      this.updateCanvasCursor();
    });

    // 鼠标移入画布时立即刷新对应工具光标
    this.displayCanvas.addEventListener('mouseenter', (e) => {
      this.updateCanvasCursor({ altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
    });

    // 鼠标画布绘制与选区交互事件 (支持左键前景色/选区、右键背景色、Alt 快速吸色、Ctrl 复制移动)
    this.displayCanvas.addEventListener('mousedown', (e) => {
      this.releaseControlFocus();
      if (!this.currentState || !this.currentState.isLoaded) return;
      if (this.isSpacePressed || (e.button !== 0 && e.button !== 2)) return; // 仅处理左键(0)与右键(2)，空格平移时不绘制

      if (this.highlightedPaletteIndex !== null) {
        this.highlightedPaletteIndex = null;
      }

      const [x, y] = this.getPixelCoords(e);
      this.lastX = x;
      this.lastY = y;

      // 矩形选区工具逻辑 (仅像素画图模式生效，Aseprite 规范)
      if (this.currentState.activeMode === 'pixel' && this.currentState.activeTool === 'select') {
        // 如果按住了 Alt 键，优先执行快速吸色 (支持在画布任意位置取色)
        if (e.altKey) {
          const offset = y * 64 + x;
          const colorIdx = this.currentState.pixelIndices[offset];
          const isBg = e.button === 2;
          this.callbacks.onColorPick(colorIdx, isBg);
          return;
        }

        if (e.button === 0) {
          if (this.currentSelection && this.isPixelInSelection(x, y, this.currentSelection)) {
            // 点击在当前选区内部 -> 开始移动/复制选区
            this.isMouseDown = true;
            this.isMovingSelection = true;
            this.isBoxSelecting = false;
            this.dragStartPixel = [x, y];
            this.moveOffset = [0, 0];
            const isModifier = e.ctrlKey || e.metaKey || e.altKey;
            this.isCopyMode = isModifier;
            this.wasCopyTriggered = isModifier;
            this.strokeModified = false;
            this.callbacks.onStrokeStart();

            const sel = this.currentSelection;
            this.floatingPatch = { origX: sel.x, origY: sel.y, patch: extractPatch(this.readLayers(), sel) };
            if (this.displayCanvas) {
              const isCopy = this.isCopyMode || this.wasCopyTriggered;
              this.displayCanvas.style.cursor = isCopy ? 'copy' : 'grabbing';
            }
            this.manageMarchingAntsAnimation();
            this.redraw();
            return;
          } else {
            // 点击在选区外部 -> 开始拖拽框选新选区 (若单点松开则自动取消选区)
            this.isMouseDown = true;
            this.isBoxSelecting = true;
            this.isMovingSelection = false;
            this.boxSelectStart = [x, y];
            this.boxSelectCurrent = { x, y, w: 1, h: 1 };
            this.currentSelection = null;
            this.updateSelectionToolbar();
            this.manageMarchingAntsAnimation();
            this.redraw();
            return;
          }
        }
        return;
      }

      // 遮罩模式下的智能色组框选工具 (左键批量加入，右键批量剔除)
      if (this.currentState.activeMode === 'mask' && this.currentState.activeMaskTool === 'box_select') {
        if (e.button === 0 || e.button === 2) {
          this.isMouseDown = true;
          this.isBoxSelecting = true;
          this.isMovingSelection = false;
          this.maskBoxAction = e.button === 0 ? 'add' : 'remove';
          this.boxSelectStart = [x, y];
          this.boxSelectCurrent = { x, y, w: 1, h: 1 };
          this.manageMarchingAntsAnimation();
          this.redraw();
          return;
        }
      }

      this.isMouseDown = true;
      this.currentMouseButton = e.button as 0 | 2;
      this.currentIsAlt = e.altKey;
      this.currentIsShift = e.shiftKey;
      this.strokeModified = false;
      this.callbacks.onStrokeStart();
      this.applyToolAt(x, y);
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.currentState || !this.currentState.isLoaded || !this.displayCanvas) return;

      const rect = this.displayCanvas.getBoundingClientRect();
      const inCanvas = (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      );

      if (this.isMouseDown) {
        this.currentIsAlt = e.altKey;

        // 1. 正在拖动已有选区 (平移/复制，鼠标移出画布外亦持续追踪)
        if (this.isMovingSelection && this.floatingPatch) {
          const [rawX, rawY] = this.getPixelCoordsRaw(e);
          const dx = rawX - this.dragStartPixel[0];
          const dy = rawY - this.dragStartPixel[1];
          this.moveOffset = [dx, dy];
          if (e.ctrlKey || e.metaKey || e.altKey) {
            this.isCopyMode = true;
            this.wasCopyTriggered = true;
          }
          const isCopy = this.isCopyMode || this.wasCopyTriggered;
          this.displayCanvas.style.cursor = isCopy ? 'copy' : 'grabbing';
          this.lastX = rawX;
          this.lastY = rawY;
          this.updateHoverInfo(rawX, rawY);
          this.redraw();
          return;
        }

        // 2. 正在框选新矩形选区 (鼠标移出画布外亦持续框选)
        if (this.isBoxSelecting) {
          const [rawX, rawY] = this.getPixelCoordsRaw(e);
          const x0 = Math.min(this.boxSelectStart[0], rawX);
          const y0 = Math.min(this.boxSelectStart[1], rawY);
          const x1 = Math.max(this.boxSelectStart[0], rawX);
          const y1 = Math.max(this.boxSelectStart[1], rawY);
          this.boxSelectCurrent = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
          this.lastX = rawX;
          this.lastY = rawY;
          this.updateHoverInfo(rawX, rawY);
          this.updateSelectionToolbar();
          this.redraw();
          return;
        }

        // 3. 常规画笔/橡皮/油漆桶工具 (像素坐标约束在 0~63 画布内)
        const [x, y] = this.getPixelCoords(e);
        if (inCanvas) {
          this.updateHoverInfo(x, y);
        } else {
          this.clearHoverInfo();
        }

        // 如果是油漆桶工具，点击单点即完成泛洪，拖拽时不重复填充
        if (this.currentState.activeTool !== 'bucket') {
          if (this.lastX !== -1 && this.lastY !== -1) {
            // Bresenham 插值，保证拖拽极快时不漏点
            this.drawLine(this.lastX, this.lastY, x, y);
          } else {
            this.applyToolAt(x, y);
          }
        }
        this.lastX = x;
        this.lastY = y;
        return;
      }

      // 未按鼠标按键时的悬停状态反馈
      if (inCanvas) {
        const [x, y] = this.getPixelCoords(e);
        this.updateHoverInfo(x, y);
        this.updateCanvasCursor({ altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, x, y });
        this.drawHoverCursor(x, y);
      } else {
        this.clearHoverInfo();
      }
    });

    window.addEventListener('mouseup', (e: MouseEvent) => {
      if (this.isMouseDown) {
        this.isMouseDown = false;
        const lastCoords: [number, number] = [this.lastX, this.lastY];
        this.lastX = -1;
        this.lastY = -1;

        if (this.isMovingSelection) {
          this.isMovingSelection = false;
          if (this.floatingPatch && this.currentState) {
            const [dx, dy] = this.moveOffset;
            if (dx !== 0 || dy !== 0) {
              const { origX, origY, patch } = this.floatingPatch;
              // 当前标记、锁存标记或 mouseup 时的修饰键任意一个为 true 即视为复制
              const isCopy = this.isCopyMode || this.wasCopyTriggered || e.ctrlKey || e.metaKey || e.altKey;
              const destX = origX + dx;
              const destY = origY + dy;
              this.callbacks.onMoveSelection(patch, { x: origX, y: origY, w: patch.w, h: patch.h }, destX, destY, isCopy);

              // 选区跟随到新位置 (与画布求交集)
              const finalRect: RectSelection = { x: destX, y: destY, w: patch.w, h: patch.h };
              this.currentSelection = this.intersectWithCanvas(finalRect);
              this.updateSelectionToolbar();

              this.callbacks.onStrokeEnd(true);
            } else {
              this.callbacks.onStrokeEnd(false);
            }
            this.floatingPatch = null;
            this.moveOffset = [0, 0];
            this.isCopyMode = false;
            this.wasCopyTriggered = false;
          }
          this.updateCanvasCursor({ ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey });
          this.manageMarchingAntsAnimation();
          if (this.currentState) {
            this.redraw();
          }
          return;
        }

        if (this.isBoxSelecting) {
          this.isBoxSelecting = false;

          // 遮罩模式下的智能色组框选处理 (左键批量划入，右键批量剔除)
          if (this.currentState && this.currentState.activeMode === 'mask' && this.currentState.activeMaskTool === 'box_select') {
            if (this.boxSelectCurrent) {
              const intersected = this.intersectWithCanvas(this.boxSelectCurrent);
              if (intersected) {
                const action = this.maskBoxAction || 'add';
                this.callbacks.onMaskBoxSelect?.(intersected, action);
              }
              this.boxSelectCurrent = null;
            }
            this.maskBoxAction = null;
            this.updateCanvasCursor();
            this.manageMarchingAntsAnimation();
            if (this.currentState) {
              this.redraw();
            }
            return;
          }

          if (this.boxSelectCurrent) {
            // 框选区域与画布求交集
            const intersected = this.intersectWithCanvas(this.boxSelectCurrent);

            // 如果单点点击且尺寸为 1x1，或者与画布交集为空，则按 Aseprite 规范取消选区 (Deselect)
            if (
              !intersected ||
              (intersected.w === 1 && intersected.h === 1 &&
               this.boxSelectStart[0] === lastCoords[0] && this.boxSelectStart[1] === lastCoords[1])
            ) {
              this.currentSelection = null;
            } else {
              this.currentSelection = intersected;
            }
            this.boxSelectCurrent = null;
            this.updateSelectionToolbar();
          }
          this.updateCanvasCursor();
          this.manageMarchingAntsAnimation();
          if (this.currentState) {
            this.redraw();
          }
          return;
        }

        this.callbacks.onStrokeEnd(this.strokeModified);
        if (this.currentSelection && this.strokeModified) {
          this.updateSelectionToolbar();
        }
        this.strokeModified = false;
        if (this.currentState) {
          this.redraw();
        }
      }
    });
  }

  /**
   * 将屏幕鼠标事件转换为未经边界限制的连续像素坐标 (支持负值和大于 63 的外围坐标)
   */
  private getPixelCoordsRaw(e: MouseEvent): [number, number] {
    if (!this.displayCanvas) return [0, 0];
    const rect = this.displayCanvas.getBoundingClientRect();
    const scaleX = 64 / rect.width;
    const scaleY = 64 / rect.height;
    const px = Math.floor((e.clientX - rect.left) * scaleX);
    const py = Math.floor((e.clientY - rect.top) * scaleY);
    return [px, py];
  }

  /**
   * 将屏幕鼠标事件转换为 0~63 的像素坐标 (边界限制在画布内)
   */
  private getPixelCoords(e: MouseEvent): [number, number] {
    const [rawX, rawY] = this.getPixelCoordsRaw(e);
    return [
      Math.max(0, Math.min(63, rawX)),
      Math.max(0, Math.min(63, rawY))
    ];
  }

  /**
   * 计算指定选区与画布 (0, 0, 64, 64) 的几何交集 (& 操作)
   * 若完全落在画布外部或无交集，返回 null
   */
  private intersectWithCanvas(rect: RectSelection): RectSelection | null {
    const x1 = Math.max(0, rect.x);
    const y1 = Math.max(0, rect.y);
    const x2 = Math.min(64, rect.x + rect.w);
    const y2 = Math.min(64, rect.y + rect.h);

    if (x2 > x1 && y2 > y1) {
      return {
        x: x1,
        y: y1,
        w: x2 - x1,
        h: y2 - y1,
      };
    }
    return null;
  }

  /**
   * 解除滑杆、复选框、按钮等控件焦点，避免键盘焦点被滞留导致全局快捷键受阻
   */
  private releaseControlFocus(): void {
    if (document.activeElement && document.activeElement !== document.body) {
      const activeEl = document.activeElement as HTMLElement;
      if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'BUTTON') {
        activeEl.blur();
      }
    }
  }

  /**
   * 计算指定笔刷尺寸的外接矩形范围 (用于印章覆盖与光标悬停线框)
   */
  public static getBrushRect(x: number, y: number, size: 1 | 2 | 3 | 4 = 1): { x: number; y: number; w: number; h: number } {
    if (size === 2) {
      return { x, y, w: 2, h: 2 };
    } else if (size === 3) {
      return { x: x - 1, y: y - 1, w: 3, h: 3 };
    } else if (size === 4) {
      return { x: x - 1, y: y - 1, w: 4, h: 4 };
    }
    return { x, y, w: 1, h: 1 };
  }

  /**
   * 获取指定笔刷尺寸相对于锚点的坐标偏移集合
   */
  public static getBrushOffsets(size: 1 | 2 | 3 | 4 = 1): { dx: number; dy: number }[] {
    const rect = CanvasEditor.getBrushRect(0, 0, size);
    const offsets: { dx: number; dy: number }[] = [];
    for (let dy = rect.y; dy < rect.y + rect.h; dy++) {
      for (let dx = rect.x; dx < rect.x + rect.w; dx++) {
        offsets.push({ dx, dy });
      }
    }
    return offsets;
  }

  /**
   * Bresenham 画线算法插值
   */
  private drawLine(x0: number, y0: number, x1: number, y1: number): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let cx = x0;
    let cy = y0;

    while (true) {
      this.applyToolAt(cx, cy);
      if (cx === x1 && cy === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        cx += sx;
      }
      if (e2 < dx) {
        err += dx;
        cy += sy;
      }
    }
  }

  /**
   * 在指定像素点应用当前工具 (支持左键前景色、右键背景色、Alt 快速吸色、遮罩多尺寸笔刷与锁定保护)
   */
  private applyToolAt(x: number, y: number): void {
    if (!this.currentState) return;

    // 1. Aseprite 快捷吸色：按住 Alt 点击 或 处于吸管工具
    // 吸管属于只读采样操作，不受选区范围限制，支持在画布全域任意点吸色 (左键前景色、右键背景色)
    if (this.currentIsAlt || (this.currentState.activeMode === 'pixel' && this.currentState.activeTool === 'eyedropper')) {
      const offset = y * 64 + x;
      const colorIdx = this.currentState.pixelIndices[offset];
      const isBg = this.currentMouseButton === 2;
      this.callbacks.onColorPick(colorIdx, isBg);
      return;
    }

    // 2. 如果当前处于像素模式且存在选区，所有像素绘制与修改操作严格约束在选区矩形内部
    if (this.currentState.activeMode === 'pixel' && this.currentSelection && !this.isPixelInSelection(x, y, this.currentSelection)) {
      return;
    }

    // 3. 油漆桶泛洪填充 (默认 8 邻居，可选 4 邻居)
    const isBucket = this.currentState.activeMode === 'pixel'
      ? this.currentState.activeTool === 'bucket'
      : this.currentState.activeMaskTool === 'bucket';

    if (isBucket) {
      // Shift+点击：非连通的全域同色替换 (仅像素模式)
      const replaceAll = this.currentState.activeMode === 'pixel' && this.currentIsShift;
      if (this.callbacks.onBucket(x, y, this.currentMouseButton, replaceAll)) {
        this.strokeModified = true;
      }
      return;
    }

    if (this.currentState.activeMode === 'pixel') {
      if (this.currentMouseButton === 0) {
        // 鼠标左键
        if (this.currentState.activeTool === 'pen') {
          const offset = y * 64 + x;
          if (this.currentState.pixelIndices[offset] !== this.currentState.activePaletteIndex) {
            this.strokeModified = true;
          }
          this.callbacks.onPixelDraw(x, y, this.currentState.activePaletteIndex);
        } else if (this.currentState.activeTool === 'eraser') {
          // 橡皮擦：清除为透明 (TRANSPARENT_INDEX = 255)
          const offset = y * 64 + x;
          if (this.currentState.pixelIndices[offset] !== TRANSPARENT_INDEX) {
            this.strokeModified = true;
          }
          this.callbacks.onPixelDraw(x, y, TRANSPARENT_INDEX);
          if (this.currentState.semanticMask[offset] !== SemanticZone.Background) {
            this.callbacks.onMaskDraw(x, y, SemanticZone.Background);
          }
        }
      } else if (this.currentMouseButton === 2) {
        // 鼠标右键：绘制背景色 (Aseprite 机制，默认透明 255 或右键选用的颜色)
        const bgIdx = this.currentState.bgPaletteIndex;
        const offset = y * 64 + x;
        if (this.currentState.pixelIndices[offset] !== bgIdx) {
          this.strokeModified = true;
        }
        this.callbacks.onPixelDraw(x, y, bgIdx);
        if (bgIdx === TRANSPARENT_INDEX && this.currentState.semanticMask[offset] !== SemanticZone.Background) {
          this.callbacks.onMaskDraw(x, y, SemanticZone.Background);
        }
      }
    } else {
      // 遮罩模式：支持 1~4px 方形笔刷与橡皮擦，严格遵守图层锁定保护
      const isEraser = this.currentState.activeMaskTool === 'eraser' || this.currentMouseButton === 2;
      const brushSize = this.currentState.maskBrushSize;
      const offsets = CanvasEditor.getBrushOffsets(brushSize);
      const lockedZones = this.currentState.lockedMaskZones;

      for (const offsetCoord of offsets) {
        const px = x + offsetCoord.dx;
        const py = y + offsetCoord.dy;
        if (px < 0 || px >= 64 || py < 0 || py >= 64) continue;

        const offset = py * 64 + px;
        const currentZone = this.currentState.semanticMask[offset];
        const isCurrentLocked = lockedZones.includes(currentZone);

        if (isEraser) {
          // 橡皮擦工具或鼠标右键：逐点删除遮罩 (擦除为背景分区 Background = 0)
          if (!isCurrentLocked && currentZone !== SemanticZone.Background) {
            this.strokeModified = true;
            this.callbacks.onMaskDraw(px, py, SemanticZone.Background);
          }
        } else if (this.currentMouseButton === 0) {
          // 鼠标左键：涂抹当前选中的分区遮罩
          const targetZone = this.currentState.activeZone;
          const isTargetLocked = lockedZones.includes(targetZone);

          if (!isCurrentLocked && !isTargetLocked && currentZone !== targetZone) {
            this.strokeModified = true;
            this.callbacks.onMaskDraw(px, py, targetZone);
          }
        }
      }
    }
  }

  /**
   * 更新悬停坐标及像素信息条
   */
  private updateHoverInfo(x: number, y: number): void {
    if (!this.currentState || !this.hoverInfoEl) return;

    if (this.isMovingSelection && this.floatingPatch) {
      const [dx, dy] = this.moveOffset;
      const isCopy = this.isCopyMode || this.wasCopyTriggered;
      const modeText = isCopy ? '📋 复制模式 (+Ctrl 原位保留)' : '✂️ 平移模式 (原位透明)';
      this.hoverInfoEl.innerHTML = `
        <span class="coord-tag">偏移: <b>ΔX:${dx >= 0 ? '+' + dx : dx} ΔY:${dy >= 0 ? '+' + dy : dy}</b></span>
        <span class="hover-text" style="color: ${isCopy ? '#10B981' : '#00E5FF'}; font-weight: 600;">${modeText}</span>
        <span style="opacity: 0.6; font-size: 11px;">[按住 Ctrl/Alt 切换复制]</span>
      `;
      return;
    }

    if (this.isBoxSelecting && this.boxSelectCurrent) {
      this.hoverInfoEl.innerHTML = `
        <span class="coord-tag">框选: <b>(${this.boxSelectCurrent.x}, ${this.boxSelectCurrent.y})</b></span>
        <span class="hover-text" style="color: #C084FC; font-weight: 600;">尺寸: ${this.boxSelectCurrent.w}×${this.boxSelectCurrent.h}</span>
      `;
      return;
    }

    if (x < 0 || x >= 64 || y < 0 || y >= 64) {
      this.clearHoverInfo();
      return;
    }

    const offset = y * 64 + x;
    const pixelsToRender = this.previewPixelIndices ?? this.currentState.pixelIndices;
    const colorIdx = pixelsToRender[offset];
    const isTrans = colorIdx === TRANSPARENT_INDEX;
    const colorHex = isTrans ? '透明' : (this.currentState.palette[colorIdx] || '#000000');
    const zone = this.currentState.semanticMask[offset] as SemanticZone;
    const zoneMeta = ZONE_CONFIG[zone] || ZONE_CONFIG[SemanticZone.Background];

    let selectionExtra = '';
    if (this.currentSelection) {
      const inSel = this.isPixelInSelection(x, y, this.currentSelection);
      if (inSel) {
        selectionExtra = `<span class="coord-tag" style="background: rgba(168, 85, 247, 0.25); color: #C084FC;">选区内 (拖拽平移)</span>`;
      }
    }

    const colorChipHtml = isTrans
      ? `<span class="hover-color-chip slot-transparent" style="width:12px; height:12px; border-radius:3px; display:inline-block;" title="透明/已删除像素"></span>`
      : `<span class="hover-color-chip" style="background-color: ${colorHex};" title="${colorHex}"></span>`;
    const colorTextHtml = isTrans
      ? `<span class="hover-text" style="color: #38bdf8; font-weight: 600;">[透明/已删除]</span>`
      : `<span class="hover-text">${colorHex} [#${colorIdx}]</span>`;

    this.hoverInfoEl.innerHTML = `
      <span class="coord-tag">X: <b>${x.toString().padStart(2, '0')}</b> Y: <b>${y.toString().padStart(2, '0')}</b></span>
      ${colorChipHtml}
      ${colorTextHtml}
      <span class="hover-zone-chip" style="border-left: 4px solid ${zoneMeta.color};">${zoneMeta.name}</span>
      ${selectionExtra}
    `;
  }

  private clearHoverInfo(): void {
    if (!this.hoverInfoEl) return;
    this.hoverInfoEl.innerHTML = `<span>X: -- Y: --</span>`;
    this.redraw();
  }

  /**
   * 动态更新画布光标为对应工具的小图标 (画笔 ✏️、橡皮 🧼、油漆桶 🪣、吸管 🧪、选区)
   */
  private updateCanvasCursor(e?: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; x?: number; y?: number }): void {
    if (!this.displayCanvas || !this.currentState) return;
    if (this.isSpacePressed) {
      this.displayCanvas.style.cursor = 'grab';
      return;
    }

    const cursors = getToolCursors();
    const isAlt = e?.altKey ?? false;

    // 遮罩模式光标调度
    if (this.currentState.activeMode === 'mask') {
      const maskTool = this.currentState.activeMaskTool;
      if (maskTool === 'eraser') {
        this.displayCanvas.style.cursor = cursors.eraser;
      } else if (maskTool === 'bucket') {
        this.displayCanvas.style.cursor = cursors.bucket;
      } else if (maskTool === 'box_select') {
        this.displayCanvas.style.cursor = 'crosshair';
      } else {
        this.displayCanvas.style.cursor = cursors.pen;
      }
      return;
    }

    // 像素模式光标调度
    // 1. 如果按下 Alt 键，或处于吸管工具，显示吸管小图标 🧪
    if (isAlt || this.currentState.activeTool === 'eyedropper') {
      this.displayCanvas.style.cursor = cursors.eyedropper;
      return;
    }

    // 2. 选区工具特殊处理 (选区内移动/复制，选区外十字框选)
    if (this.currentState.activeTool === 'select') {
      const px = e?.x ?? this.lastX;
      const py = e?.y ?? this.lastY;
      const isCopy = this.isCopyMode || this.wasCopyTriggered || e?.ctrlKey || e?.metaKey || e?.altKey;
      if (this.isMovingSelection) {
        this.displayCanvas.style.cursor = isCopy ? 'copy' : 'grabbing';
      } else if (this.currentSelection && px !== -1 && py !== -1 && this.isPixelInSelection(px, py, this.currentSelection)) {
        this.displayCanvas.style.cursor = isCopy ? 'copy' : 'move';
      } else {
        this.displayCanvas.style.cursor = 'crosshair';
      }
      return;
    }

    // 3. 油漆桶工具，显示油漆桶小图标 🪣
    if (this.currentState.activeTool === 'bucket') {
      this.displayCanvas.style.cursor = cursors.bucket;
      return;
    }

    // 4. 橡皮擦工具，显示橡皮小图标 🧼
    if (this.currentState.activeTool === 'eraser') {
      this.displayCanvas.style.cursor = cursors.eraser;
      return;
    }

    // 5. 默认画笔工具，显示画笔小图标 ✏️
    this.displayCanvas.style.cursor = cursors.pen;
  }

  /**
   * 在当前悬浮像素外围绘制淡白色/主题色/笔刷尺寸方形线框
   */
  private drawHoverCursor(x: number, y: number): void {
    this.redraw();
    if (!this.ctx || !this.currentState) return;
    if (this.currentState.activeMode === 'pixel' && this.currentState.activeTool === 'select') return; // 选区工具下不绘制光标线框
    if (this.currentState.activeMode === 'mask' && this.currentState.activeMaskTool === 'box_select') return; // 智能框选工具下不绘制画笔线框
    const zoom = this.currentState.zoomLevel;
    this.ctx.save();

    if (this.currentState.activeMode === 'mask') {
      const maskTool = this.currentState.activeMaskTool;
      if (maskTool === 'bucket') {
        this.ctx.strokeStyle = '#c084fc';
        this.ctx.lineWidth = 1.5;
        this.ctx.strokeRect(x * zoom + 0.5, y * zoom + 0.5, zoom - 1, zoom - 1);
      } else {
        const brushSize = this.currentState.maskBrushSize;
        const rect = CanvasEditor.getBrushRect(x, y, brushSize);
        if (maskTool === 'eraser') {
          this.ctx.strokeStyle = '#f472b6';
        } else {
          const zoneColor = ZONE_CONFIG[this.currentState.activeZone]?.color || '#00E5FF';
          this.ctx.strokeStyle = zoneColor;
        }
        this.ctx.lineWidth = 1.5;
        this.ctx.strokeRect(
          rect.x * zoom + 0.5,
          rect.y * zoom + 0.5,
          rect.w * zoom - 1,
          rect.h * zoom - 1
        );
      }
    } else {
      if (this.currentState.activeTool === 'bucket') {
        this.ctx.strokeStyle = '#c084fc';
        this.ctx.lineWidth = 1.5;
      } else if (this.currentState.activeTool === 'eraser') {
        this.ctx.strokeStyle = '#f472b6';
        this.ctx.lineWidth = 1.5;
      } else if (this.currentIsAlt || this.currentState.activeTool === 'eyedropper') {
        this.ctx.strokeStyle = '#38bdf8';
        this.ctx.lineWidth = 1.5;
      } else {
        this.ctx.strokeStyle = '#FFFFFF';
        this.ctx.lineWidth = 1;
      }
      this.ctx.strokeRect(x * zoom + 0.5, y * zoom + 0.5, zoom - 1, zoom - 1);
    }
    this.ctx.restore();
  }

  /**
   * 刷新整个画布渲染
   */
  public redraw(): void {
    const state = this.currentState;
    const ctx = this.ctx;
    if (!state || !ctx || !this.displayCanvas) return;
    if (!state.isLoaded) {
      this.updateEmptyState();
      return;
    }

    const zoom = state.zoomLevel;
    const canvasSize = 64 * zoom;

    if (this.displayCanvas.width !== canvasSize || this.displayCanvas.height !== canvasSize) {
      this.displayCanvas.width = canvasSize;
      this.displayCanvas.height = canvasSize;
      this.displayCanvas.style.width = `${canvasSize}px`;
      this.displayCanvas.style.height = `${canvasSize}px`;
    }

    ctx.imageSmoothingEnabled = false;

    // 1. 像素画绘制到离屏 64×64 (发色预览时优先绘制预览像素)
    drawIndexedPixels(this.offscreenPixelCtx, this.previewPixelIndices ?? state.pixelIndices, state.palette);

    // 2. 放大绘制到展示画布
    ctx.clearRect(0, 0, canvasSize, canvasSize);
    ctx.drawImage(this.offscreenPixelCanvas, 0, 0, 64, 64, 0, 0, canvasSize, canvasSize);

    // 3. 半透明分区遮罩
    const showMask = state.showMaskOverlay && state.maskOpacity > 0.01;
    const visibleZones = new Set(state.visibleMaskZones);
    if (showMask && visibleZones.size > 0) {
      drawZoneOverlay(ctx, state.semanticMask, visibleZones, state.maskOpacity, zoom);
    }

    // 4. 颜色探针高亮 (悬停在色板或选区统计行时)
    if (this.highlightedPaletteIndex !== null && state.activeMode === 'pixel') {
      drawColorHighlight(ctx, state.pixelIndices, this.highlightedPaletteIndex, zoom);
    }

    // 5. 像素网格 (放大倍数 >= 8 时)
    if (state.showGrid && zoom >= 8) {
      drawGrid(ctx, zoom);
    }

    // 6. 选区：拖动中的浮动块 / 正在框选 / 已有选区的走马灯
    if (this.isMovingSelection && this.floatingPatch) {
      const { origX, origY, patch } = this.floatingPatch;
      const destX = origX + this.moveOffset[0];
      const destY = origY + this.moveOffset[1];
      const isCopy = this.isCopyMode || this.wasCopyTriggered;
      const origRect = { x: origX, y: origY, w: patch.w, h: patch.h };

      // 剪切移动时原位置显示为透明
      if (!isCopy) ctx.clearRect(origX * zoom, origY * zoom, patch.w * zoom, patch.h * zoom);
      drawPatchPixels(ctx, patch, destX, destY, state.palette, zoom);
      if (showMask) {
        drawZoneOverlay(ctx, patch.mask, visibleZones, state.maskOpacity, zoom, { ...origRect, x: destX, y: destY });
      }
      if (isCopy) drawMarchingAnts(ctx, origRect, zoom, this.marchingAntsOffset, true);
    } else if (this.isBoxSelecting && this.boxSelectCurrent) {
      if (state.activeMode === 'mask' && state.activeMaskTool === 'box_select') {
        const fill = this.maskBoxAction === 'remove' ? 'rgba(239, 68, 68, 0.5)' : `${ZONE_CONFIG[state.activeZone].color}88`;
        drawMatchPreview(ctx, state.pixelIndices, this.boxSelectCurrent, new Set(state.maskMatchColors), fill, zoom);
      }
      drawMarchingAnts(ctx, this.boxSelectCurrent, zoom, this.marchingAntsOffset);
    } else if (state.activeMode === 'pixel' && this.currentSelection) {
      drawMarchingAnts(ctx, this.currentSelection, zoom, this.marchingAntsOffset);
    }

    // 7. 同步画中画实时预览
    this.callbacks.onRedrawHook?.(this.offscreenPixelCanvas, state.isLoaded);
  }

  public update(state: StudioState): void {
    this.currentState = state;
    if (!state.isLoaded || state.activeMode !== 'pixel') {
      this.highlightedPaletteIndex = null;
    }
    if (state.activeMode === 'mask' && this.currentSelection) {
      this.currentSelection = null;
    }
    this.updateToolbar();
    this.updateSelectionToolbar();
    this.updateEmptyState();
    this.updateCanvasCursor();
    this.redraw();
  }

  private updateToolbar(): void {
    if (!this.currentState) return;
    const zoomText = this.container.querySelector('#zoom-text');
    if (zoomText) {
      zoomText.textContent = `${this.currentState.zoomLevel}×`;
    }

    const zoomSlider = this.container.querySelector('#zoom-range-slider') as HTMLInputElement | null;
    if (zoomSlider) {
      const idx = ZOOM_STEPS.indexOf(this.currentState.zoomLevel as any);
      if (idx !== -1) {
        zoomSlider.value = idx.toString();
      }
    }

    const toggleGridBtn = this.container.querySelector('#btn-toggle-grid');
    if (toggleGridBtn) {
      if (this.currentState.showGrid) {
        toggleGridBtn.classList.add('active');
      } else {
        toggleGridBtn.classList.remove('active');
      }
    }



    const togglePreviewBtn = this.container.querySelector('#btn-toggle-preview') as HTMLElement | null;
    if (togglePreviewBtn) {
      if (!this.currentState.isLoaded) {
        togglePreviewBtn.classList.remove('active');
        togglePreviewBtn.style.opacity = '0.5';
        togglePreviewBtn.style.cursor = 'not-allowed';
        togglePreviewBtn.setAttribute('title', '请先载入头像以开启原寸预览 (快捷键 V)');
      } else {
        togglePreviewBtn.style.opacity = '1';
        togglePreviewBtn.style.cursor = 'pointer';
        togglePreviewBtn.setAttribute('title', '切换 1:1 原寸画中画实时预览 (快捷键 V)');
      }
    }
  }

  public setPreviewButtonActive(active: boolean): void {
    const btn = this.container.querySelector('#btn-toggle-preview') as HTMLElement | null;
    if (btn) {
      if (active && this.currentState?.isLoaded) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  }

  public getViewportElement(): HTMLElement | null {
    return this.container.querySelector('.canvas-editor-area') || this.container.querySelector('#canvas-viewport');
  }

  public stepZoom(direction: number): void {
    if (!this.currentState) return;
    const currentZoom = this.currentState.zoomLevel;
    let idx = ZOOM_STEPS.indexOf(currentZoom as any);
    if (idx === -1) idx = 2; // 默认 8x
    const nextIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + direction));
    const nextZoom = ZOOM_STEPS[nextIdx];
    if (nextZoom !== currentZoom) {
      this.callbacks.onZoomChange(nextZoom);
    }
  }

  private updateEmptyState(): void {
    if (!this.emptyStateEl || !this.displayCanvas) return;
    if (!this.currentState || !this.currentState.isLoaded) {
      this.emptyStateEl.style.display = 'flex';
      this.displayCanvas.style.display = 'none';

      const restoreBanner = this.container.querySelector('#restore-banner') as HTMLElement;
      if (restoreBanner) {
        restoreBanner.style.display = this.hasStorageSnapshot ? 'flex' : 'none';
      }
    } else {
      this.emptyStateEl.style.display = 'none';
      this.displayCanvas.style.display = 'block';
    }
  }

  // ===================== 矩形选区辅助方法 (Aseprite 规范) =====================

  public getSelection(): RectSelection | null {
    return this.currentSelection;
  }

  public setSelection(sel: RectSelection | null): void {
    this.currentSelection = sel ? this.intersectWithCanvas(sel) : null;
    this.updateSelectionToolbar();
    this.manageMarchingAntsAnimation();
    this.redraw();
  }

  public clearSelection(): void {
    if (this.currentSelection || this.isBoxSelecting || this.isMovingSelection) {
      this.currentSelection = null;
      this.isBoxSelecting = false;
      this.isMovingSelection = false;
      this.floatingPatch = null;
      this.moveOffset = [0, 0];
      this.updateSelectionToolbar();
      this.manageMarchingAntsAnimation();
      this.redraw();
    }
  }

  public selectAll(): void {
    this.setSelection({ x: 0, y: 0, w: 64, h: 64 });
  }

  public hasSelection(): boolean {
    return this.currentSelection !== null;
  }

  private readLayers(): Layers {
    const state = this.currentState!;
    return { pixels: state.pixelIndices, mask: state.semanticMask, lockedZones: new Set(state.lockedMaskZones) };
  }

  private isPixelInSelection(x: number, y: number, sel: RectSelection): boolean {
    return x >= sel.x && x < sel.x + sel.w && y >= sel.y && y < sel.y + sel.h;
  }

  /** 刷新依赖选区的浮动工具条与颜色统计面板 */
  private updateSelectionToolbar(): void {
    const state = this.currentState;
    if (!state) return;
    const boxSelecting = this.isBoxSelecting ? this.boxSelectCurrent : null;
    this.contextBar.update(state, this.currentSelection, boxSelecting);

    const showStats = state.isLoaded && state.activeMode === 'pixel' && this.currentSelection !== null;
    if (!showStats) this.highlightedPaletteIndex = null;
    this.selectionStats.update(state, showStats ? this.currentSelection : null);
  }

  /**
   * 通用高亮方法：在画布上高亮展示指定色槽的全部像素 (全画布 64×64 范围，选区内外统一参与)
   * 传入调色板索引 (0~35 或 255 代表透明色)；传入 null 则清除高亮并恢复正常渲染
   */
  public setHighlightedColor(paletteIndex: number | null): void {
    if (this.highlightedPaletteIndex === paletteIndex) return;
    this.highlightedPaletteIndex = paletteIndex;
    if (this.currentState && this.currentState.activeMode === 'pixel' && this.currentState.isLoaded) {
      this.redraw();
    }
  }

  private manageMarchingAntsAnimation(): void {
    const isPixel = this.currentState?.activeMode === 'pixel';
    const hasActiveSelection = isPixel && (this.currentSelection !== null || this.isBoxSelecting || this.isMovingSelection);
    if (hasActiveSelection && this.currentState?.isLoaded) {
      if (this.marchingAntsTimer === null) {
        this.marchingAntsTimer = window.setInterval(() => {
          this.marchingAntsOffset = (this.marchingAntsOffset + 1) % 8;
          this.redraw();
        }, 120);
      }
    } else {
      if (this.marchingAntsTimer !== null) {
        clearInterval(this.marchingAntsTimer);
        this.marchingAntsTimer = null;
      }
    }
  }

}
