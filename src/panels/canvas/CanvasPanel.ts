/**
 * 主画布面板 (对应 tile_map_editor_imgui 的 TileMapPanel)：
 * 鼠标 / 键盘输入 (空格键等同左键)、视口平移缩放、矩形选区与智能框选的交互状态机、悬停信息与光标。
 * 只读取 ViewModel 状态，所有修改都调用 ViewModel 方法；绘制交给 CanvasRenderer。
 */

import { SemanticZone, ZONE_CONFIG, RectSelection } from '../../types';
import { TRANSPARENT_INDEX } from '../../data/palette';
import { Patch, extractPatch } from '../../core/editOps';
import { hasSavedProject } from '../../core/storage';
import { layersOf } from '../../model/document';
import { EditorSession, clampToCanvas, isInRect } from '../../model/session';
import { ViewModel } from '../../app/viewModel';
import { EditorContext } from '../../app/editorContext';
import { Panel } from '../Panel';
import { getToolCursors } from './cursors';
import { CanvasRenderer } from './CanvasRenderer';
import { CanvasToolbar } from './CanvasToolbar';
import { ContextBar } from './ContextBar';
import { SelectionStatsPanel } from './SelectionStatsPanel';

/** 鼠标事件与空格键模拟左键共用的输入字段 */
type PointerInput = Pick<MouseEvent, 'clientX' | 'clientY' | 'button' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>;

/** 画布面板需要 App 提供的入口 (文件导入、弹窗、画中画) */
export interface CanvasHooks {
  onFileDrop: (file: File) => void;
  onTriggerUpload: () => void;
  onTogglePreview: () => void;
  onOpenReplaceColor: () => void;
}

export class CanvasPanel extends Panel {
  private displayCanvas!: HTMLCanvasElement;
  private viewport!: HTMLElement;
  private hoverInfoEl!: HTMLElement;
  private emptyStateEl!: HTMLElement;
  private renderer!: CanvasRenderer;
  private contextBar!: ContextBar;
  private selectionStats!: SelectionStatsPanel;

  /** 下一次 render 需要刷新工具条 / 空状态 / 光标 (走马灯动画帧只重画画布) */
  private uiDirty = true;
  private cursorDirty = true;

  // 鼠标与修饰键
  private isMouseDown = false;
  private currentMouseButton: 0 | 2 = 0; // 0 左键 (前景色)，2 右键 (背景色)
  private currentIsAlt = false;          // 按住 Alt：吸管快速取色
  private isShiftHeld = false;           // 悬停时按住 Shift：高亮全图与指向像素同色的像素
  private spacePress = false;            // 当前按下来自空格键 (等同左键)，由 keyup 而非 mouseup 结束
  private pointer: { clientX: number; clientY: number } | null = null; // 最近一次鼠标位置，供空格键定位
  private isPanning = false;
  private lastX = -1;
  private lastY = -1;
  private hover: { x: number; y: number } | null = null;

  // 矩形框选 (像素模式选区 / 遮罩模式智能框选共用)
  private boxSelect: { start: [number, number]; rect: RectSelection; maskAction: 'add' | 'remove' | null } | null = null;

  // 拖动选区 (Aseprite 规范：平移时原位置透明，按住 Ctrl/Alt 复制)
  private moving: {
    start: [number, number];
    offset: [number, number];
    floating: { origX: number; origY: number; patch: Patch };
  } | null = null;
  private isCopyMode = false;
  private wasCopyTriggered = false;

  /** 本面板自己修改选区时置位，用来区分外部清除选区 (Esc、切换模式) */
  private ownSelectionChange = false;

  private antsTimer: number | null = null;
  private antsOffset = 0;

  constructor(
    private readonly container: HTMLElement,
    vm: ViewModel,
    private readonly ctx: EditorContext,
    private readonly hooks: CanvasHooks
  ) {
    super(vm);
    this.build();
    this.setupEventListeners();
    this.markDirty();
  }

  private invalidate(): void {
    this.uiDirty = true;
    this.markDirty();
  }

  onDocumentReplaced(): void {
    this.cursorDirty = true;
    this.invalidate();
  }
  onPixelsChanged(): void {
    this.invalidate();
  }
  onMaskChanged(): void {
    this.markDirty();
  }
  onPaletteChanged(): void {
    this.invalidate();
  }
  onContextChanged(): void {
    this.markDirty();
  }
  onSessionChanged(keys: (keyof EditorSession)[]): void {
    const s = this.vm.session;
    if (!s.isLoaded || s.activeMode !== 'pixel') this.ctx.setHighlightedPaletteIndex(null);
    if (keys.includes('selection') && !s.selection) {
      // 选区统计面板随之消失，它的悬停高亮一并清除
      this.ctx.setHighlightedPaletteIndex(null);
      if (!this.ownSelectionChange) this.cancelSelectionInteraction();
    }
    this.cursorDirty = true;
    this.invalidate();
  }

  private setSelection(selection: RectSelection | null): void {
    this.ownSelectionChange = true;
    this.vm.setSelection(selection);
    this.ownSelectionChange = false;
  }

  /** 外部取消选区时，中止进行中的框选 / 拖动 */
  private cancelSelectionInteraction(): void {
    if (this.boxSelect?.maskAction === null) this.boxSelect = null;
    this.moving = null;
  }

  getViewportElement(): HTMLElement {
    return this.container.querySelector('.canvas-editor-area') as HTMLElement;
  }

  private build(): void {
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

        <!-- 画布悬浮上下文工具条 (选区或工具调参时显现) -->
        <div class="floating-context-bar" id="floating-context-bar" style="display: none;"></div>

        <!-- 选区颜色统计浮动面板 (选区激活时显示) -->
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

    const q = <T extends Element>(sel: string) => this.container.querySelector(sel) as T;
    this.displayCanvas = q<HTMLCanvasElement>('#main-display-canvas');
    this.viewport = q<HTMLElement>('#canvas-viewport');
    this.hoverInfoEl = q<HTMLElement>('#hover-coords-bar');
    this.emptyStateEl = q<HTMLElement>('#empty-dropzone');
    this.renderer = new CanvasRenderer(this.displayCanvas);

    new CanvasToolbar(q<HTMLElement>('.canvas-toolbar'), this.vm, this.ctx, this.hooks.onTogglePreview);

    q<HTMLElement>('#btn-empty-upload').addEventListener('click', () => this.hooks.onTriggerUpload());
    q<HTMLElement>('#btn-restore-project').addEventListener('click', () => this.vm.restoreFromStorage());

    this.contextBar = new ContextBar(q<HTMLElement>('#floating-context-bar'), {
      onFlipHorizontal: () => this.vm.flipContent('horizontal'),
      onFlipVertical: () => this.vm.flipContent('vertical'),
      onRotateCW: () => this.vm.rotateContentCW(),
      onOpenReplaceColor: () => this.hooks.onOpenReplaceColor(),
      onCancelSelection: () => this.vm.clearSelection(),
      onSetBucketConnectivity: (conn) => this.vm.setBucketConnectivity(conn),
    });

    this.selectionStats = new SelectionStatsPanel(q<HTMLElement>('#selection-color-stats-panel'), {
      onColorPick: (idx, isBg) => this.vm.pickColor(idx, isBg),
      onHighlight: (idx) => this.ctx.setHighlightedPaletteIndex(idx),
    });
  }

  // ===================== 渲染 =====================

  render(): void {
    const s = this.vm.session;
    if (this.uiDirty) {
      this.uiDirty = false;
      this.updateEmptyState();
      this.updateSelectionToolbar();
      this.manageMarchingAnts();
    }
    if (this.cursorDirty) {
      this.cursorDirty = false;
      this.updateCanvasCursor();
    }
    if (!s.isLoaded) return;

    const moving = this.moving;
    this.renderer.draw(this.vm, {
      floating: moving
        ? { ...moving.floating, dx: moving.offset[0], dy: moving.offset[1], copy: this.isCopyMode || this.wasCopyTriggered }
        : null,
      boxSelect: this.boxSelect ? { rect: this.boxSelect.rect, maskAction: this.boxSelect.maskAction } : null,
      hover: this.hover && !this.isMouseDown ? { ...this.hover, alt: this.currentIsAlt } : null,
      highlightedPaletteIndex: this.ctx.highlightedPaletteIndex ?? this.shiftProbeIndex(),
      antsOffset: this.antsOffset,
    });
  }

  /** 悬停时按住 Shift：指向像素的色板索引 (与色板悬停的颜色探针同一种高亮) */
  private shiftProbeIndex(): number | null {
    if (!this.isShiftHeld || !this.hover || this.isMouseDown || this.vm.session.activeMode !== 'pixel') return null;
    return this.vm.doc.pixelIndices[this.hover.y * 64 + this.hover.x];
  }

  private updateEmptyState(): void {
    const loaded = this.vm.session.isLoaded;
    this.emptyStateEl.style.display = loaded ? 'none' : 'flex';
    this.displayCanvas.style.display = loaded ? 'block' : 'none';
    if (!loaded) {
      const banner = this.container.querySelector('#restore-banner') as HTMLElement;
      banner.style.display = hasSavedProject() ? 'flex' : 'none';
    }
  }

  /** 刷新依赖选区的浮动工具条与颜色统计面板 */
  private updateSelectionToolbar(): void {
    const { doc, session } = this.vm;
    const boxSelecting = this.boxSelect && this.boxSelect.maskAction === null ? this.boxSelect.rect : null;
    this.contextBar.update(session, session.selection, boxSelecting);
    const showStats = session.isLoaded && session.activeMode === 'pixel' && session.selection !== null;
    this.selectionStats.update(doc, session, showStats ? session.selection : null);
  }

  private manageMarchingAnts(): void {
    const s = this.vm.session;
    const active = s.isLoaded && s.activeMode === 'pixel' && (s.selection !== null || this.boxSelect !== null || this.moving !== null);
    if (active && this.antsTimer === null) {
      this.antsTimer = window.setInterval(() => {
        this.antsOffset = (this.antsOffset + 1) % 8;
        this.markDirty();
      }, 120);
    } else if (!active && this.antsTimer !== null) {
      clearInterval(this.antsTimer);
      this.antsTimer = null;
    }
  }

  // ===================== 输入 =====================

  private setupEventListeners(): void {
    const viewport = this.viewport;
    const canvas = this.displayCanvas;

    // 拖拽上传
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
      const file = e.dataTransfer?.files?.[0];
      if (file) this.hooks.onFileDrop(file);
    });

    // 阻止画布与视口默认右键菜单
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    viewport.addEventListener('contextmenu', (e) => e.preventDefault());

    // 滚轮：横向滚轮 / Shift+滚轮水平滚动，Ctrl/Cmd+滚轮步进缩放
    viewport.addEventListener('wheel', (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.vm.stepZoom(e.deltaY < 0 ? 1 : -1);
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

    // 中键拖拽平移视口
    let panStartX = 0;
    let panStartY = 0;
    let scrollStartX = 0;
    let scrollStartY = 0;

    viewport.addEventListener('mousedown', (e: MouseEvent) => {
      this.releaseControlFocus();
      if (e.button === 1) {
        this.isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        scrollStartX = viewport.scrollLeft;
        scrollStartY = viewport.scrollTop;
        viewport.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }
      if (e.target !== canvas && this.onViewportMouseDown(e)) e.preventDefault();
    });

    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.isPanning) return;
      viewport.scrollLeft = scrollStartX - (e.clientX - panStartX);
      viewport.scrollTop = scrollStartY - (e.clientY - panStartY);
      e.preventDefault();
    });

    window.addEventListener('mouseup', (e: MouseEvent) => {
      if (this.isPanning && e.button === 1) {
        this.isPanning = false;
        viewport.style.cursor = '';
      }
    });

    // 空格等同左键；Shift 悬停同色高亮；Ctrl/Alt 在拖动选区时切换为复制；Alt 悬停显示吸管光标
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code === 'Space') this.onSpaceDown(e);
      if (e.key === 'Shift') this.setShiftHeld(true);
      if (e.key === 'Alt' && !this.isMouseDown) {
        this.currentIsAlt = true;
        this.markDirty();
      }
      if (e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta') {
        if (this.moving) {
          this.isCopyMode = true;
          this.wasCopyTriggered = true;
          canvas.style.cursor = 'copy';
          this.markDirty();
        } else if (e.key === 'Alt') {
          this.updateCanvasCursor({ altKey: true });
        } else if (this.pointerInSelection()) {
          canvas.style.cursor = 'copy';
        }
      }
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      if (e.code === 'Space' && this.spacePress) {
        this.spacePress = false;
        this.onMouseUp(this.pointerInput(e));
        this.onMouseMove(this.pointerInput(e)); // 恢复悬停线框与坐标信息
      }
      if (e.key === 'Shift') this.setShiftHeld(false);
      if (e.key === 'Alt') {
        if (!this.isMouseDown) {
          this.currentIsAlt = false;
          this.markDirty();
        }
        this.updateCanvasCursor({ altKey: false });
      }
      if (e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt') {
        // 拖动选区过程中不重置复制锁存：避免松开鼠标前先松开 Ctrl 被误判为剪切移动
        if (!this.isMouseDown && !this.moving) {
          this.isCopyMode = false;
          this.wasCopyTriggered = false;
        }
        if (!this.moving && this.pointerInSelection()) canvas.style.cursor = 'move';
      }
    });

    // 窗口失焦：收不到 keyup，结束空格按下并重置修饰键状态，避免笔划 / Alt 吸色死锁
    window.addEventListener('blur', () => {
      if (this.spacePress) {
        this.spacePress = false;
        this.onMouseUp({ clientX: 0, clientY: 0, button: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });
      }
      this.currentIsAlt = false;
      this.setShiftHeld(false);
      if (!this.isMouseDown && !this.moving) {
        this.isCopyMode = false;
        this.wasCopyTriggered = false;
      }
      if (!this.isPanning) viewport.style.cursor = '';
      this.updateCanvasCursor();
    });

    canvas.addEventListener('mouseenter', (e) => {
      this.updateCanvasCursor({ altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
    });

    canvas.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
    window.addEventListener('mousemove', (e) => {
      this.pointer = { clientX: e.clientX, clientY: e.clientY };
      this.onMouseMove(e);
    });
    window.addEventListener('mouseup', (e) => {
      if (!this.spacePress) this.onMouseUp(e); // 空格按下期间点鼠标不结束笔划
    });
  }

  /** 以最近的鼠标位置与键盘事件的修饰键构造一次左键输入 */
  private pointerInput(e: KeyboardEvent): PointerInput {
    const p = this.pointer ?? { clientX: -1, clientY: -1 };
    return { ...p, button: 0, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey };
  }

  /** 空格按下 = 在鼠标所在位置按下左键 (鼠标需在画布或视口空白处，且不被弹窗 / 浮动面板遮挡) */
  private onSpaceDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target?.isContentEditable || target?.matches('input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=color]), textarea, select')) return;
    e.preventDefault(); // 阻止页面滚动与按钮被空格触发
    if (e.repeat || this.isMouseDown || !this.pointer) return;
    const hit = document.elementFromPoint(this.pointer.clientX, this.pointer.clientY);
    const input = this.pointerInput(e);
    if (hit === this.displayCanvas) this.onCanvasMouseDown(input);
    else if (hit && this.viewport.contains(hit)) this.onViewportMouseDown(input);
    if (this.isMouseDown) this.spacePress = true;
  }

  private setShiftHeld(held: boolean): void {
    if (this.isShiftHeld === held) return;
    this.isShiftHeld = held;
    this.markDirty();
  }

  /** 选区工具在视口空白处按下：从画布外沿开始框选 (单击则取消选区)。返回是否处理 */
  private onViewportMouseDown(e: PointerInput): boolean {
    const s = this.vm.session;
    if (e.button !== 0 || this.isMouseDown || !s.isLoaded || s.activeMode !== 'pixel' || s.activeTool !== 'select') return false;
    const [rawX, rawY] = this.getPixelCoordsRaw(e);
    this.isMouseDown = true;
    this.startBoxSelect(rawX, rawY, null);
    this.lastX = rawX;
    this.lastY = rawY;
    return true;
  }

  private onCanvasMouseDown(e: PointerInput): void {
    this.releaseControlFocus();
    const s = this.vm.session;
    if (!s.isLoaded || this.isMouseDown) return;
    if (e.button !== 0 && e.button !== 2) return; // 只处理左右键

    this.ctx.setHighlightedPaletteIndex(null);
    this.hover = null;
    const [x, y] = this.getPixelCoords(e);
    this.lastX = x;
    this.lastY = y;

    // 像素模式矩形选区工具
    if (s.activeMode === 'pixel' && s.activeTool === 'select') {
      if (e.altKey) {
        this.vm.pickColor(this.vm.doc.pixelIndices[y * 64 + x], e.button === 2);
        return;
      }
      if (e.button !== 0) return;
      this.isMouseDown = true;
      const selection = s.selection;
      if (selection && isInRect(x, y, selection)) {
        // 选区内按下：开始移动 / 复制选区
        const isModifier = e.ctrlKey || e.metaKey || e.altKey;
        this.isCopyMode = isModifier;
        this.wasCopyTriggered = isModifier;
        this.moving = {
          start: [x, y],
          offset: [0, 0],
          floating: { origX: selection.x, origY: selection.y, patch: extractPatch(layersOf(this.vm.doc, []), selection) },
        };
        this.displayCanvas.style.cursor = isModifier ? 'copy' : 'grabbing';
        this.invalidate();
      } else {
        // 选区外按下：拖拽框选新选区 (单击松开则取消选区)
        this.startBoxSelect(x, y, null);
      }
      return;
    }

    // 遮罩模式智能框选 (左键划入，右键剔除)
    if (s.activeMode === 'mask' && s.activeMaskTool === 'box_select') {
      this.isMouseDown = true;
      this.startBoxSelect(x, y, e.button === 0 ? 'add' : 'remove');
      return;
    }

    this.isMouseDown = true;
    this.currentMouseButton = e.button as 0 | 2;
    this.currentIsAlt = e.altKey;
    this.vm.beginStroke(this.currentMouseButton, e.shiftKey);
    this.applyToolAt(x, y);
  }

  private startBoxSelect(x: number, y: number, maskAction: 'add' | 'remove' | null): void {
    this.moving = null;
    this.boxSelect = { start: [x, y], rect: { x, y, w: 1, h: 1 }, maskAction };
    if (maskAction === null) this.setSelection(null);
    this.invalidate();
  }

  private onMouseMove(e: PointerInput): void {
    if (!this.vm.session.isLoaded) return;
    const rect = this.displayCanvas.getBoundingClientRect();
    const inCanvas = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    this.setShiftHeld(e.shiftKey);

    if (!this.isMouseDown) {
      // 悬停反馈
      this.currentIsAlt = e.altKey;
      if (inCanvas) {
        const [x, y] = this.getPixelCoords(e);
        this.updateHoverInfo(x, y);
        this.updateCanvasCursor({ altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, x, y });
        this.hover = { x, y };
        this.markDirty();
      } else {
        this.clearHoverInfo();
      }
      return;
    }

    this.currentIsAlt = e.altKey;

    // 1. 拖动已有选区 (移出画布也持续追踪)
    if (this.moving) {
      const [rawX, rawY] = this.getPixelCoordsRaw(e);
      this.moving.offset = [rawX - this.moving.start[0], rawY - this.moving.start[1]];
      if (e.ctrlKey || e.metaKey || e.altKey) {
        this.isCopyMode = true;
        this.wasCopyTriggered = true;
      }
      this.displayCanvas.style.cursor = this.isCopyMode || this.wasCopyTriggered ? 'copy' : 'grabbing';
      this.lastX = rawX;
      this.lastY = rawY;
      this.updateHoverInfo(rawX, rawY);
      this.markDirty();
      return;
    }

    // 2. 框选 (移出画布也持续框选)
    if (this.boxSelect) {
      const [rawX, rawY] = this.getPixelCoordsRaw(e);
      const [sx, sy] = this.boxSelect.start;
      const x0 = Math.min(sx, rawX);
      const y0 = Math.min(sy, rawY);
      this.boxSelect.rect = { x: x0, y: y0, w: Math.max(sx, rawX) - x0 + 1, h: Math.max(sy, rawY) - y0 + 1 };
      this.lastX = rawX;
      this.lastY = rawY;
      this.updateHoverInfo(rawX, rawY);
      this.invalidate();
      return;
    }

    // 3. 画笔 / 橡皮 / 油漆桶 (坐标约束在画布内，Bresenham 插值避免快速拖动漏点)
    const [x, y] = this.getPixelCoords(e);
    if (inCanvas) this.updateHoverInfo(x, y);
    else this.clearHoverInfo();
    if (this.lastX !== -1 && this.lastY !== -1) this.drawLine(this.lastX, this.lastY, x, y);
    else this.applyToolAt(x, y);
    this.lastX = x;
    this.lastY = y;
  }

  private onMouseUp(e: PointerInput): void {
    if (!this.isMouseDown) return;
    this.isMouseDown = false;
    const lastCoords: [number, number] = [this.lastX, this.lastY];
    this.lastX = -1;
    this.lastY = -1;

    if (this.moving) {
      const { offset, floating } = this.moving;
      this.moving = null;
      const [dx, dy] = offset;
      if (dx !== 0 || dy !== 0) {
        const { origX, origY, patch } = floating;
        // 当前标记、锁存标记或松开时的修饰键任意一个为 true 即视为复制
        const copy = this.isCopyMode || this.wasCopyTriggered || e.ctrlKey || e.metaKey || e.altKey;
        this.vm.moveSelection(patch, { x: origX, y: origY, w: patch.w, h: patch.h }, origX + dx, origY + dy, copy);
      }
      this.isCopyMode = false;
      this.wasCopyTriggered = false;
      this.updateCanvasCursor({ ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey });
      this.invalidate();
      return;
    }

    if (this.boxSelect) {
      const { start, rect, maskAction } = this.boxSelect;
      this.boxSelect = null;
      const clamped = clampToCanvas(rect);
      if (maskAction) {
        if (clamped) this.vm.maskBoxSelect(clamped, maskAction);
      } else {
        // 单击 (1×1 且未移动) 或框在画布外：按 Aseprite 规范取消选区
        const isClick = clamped && clamped.w === 1 && clamped.h === 1 && start[0] === lastCoords[0] && start[1] === lastCoords[1];
        this.setSelection(!clamped || isClick ? null : clamped);
      }
      this.updateCanvasCursor();
      this.invalidate();
      return;
    }

    this.vm.endStroke();
    this.markDirty();
  }

  /** Bresenham 画线，逐点应用当前工具 */
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

  /** 按住 Alt 或吸管工具时取色 (不受选区限制)，否则交给当前笔划 */
  private applyToolAt(x: number, y: number): void {
    const s = this.vm.session;
    if (this.currentIsAlt || (s.activeMode === 'pixel' && s.activeTool === 'eyedropper')) {
      this.vm.pickColor(this.vm.doc.pixelIndices[y * 64 + x], this.currentMouseButton === 2);
      return;
    }
    this.vm.strokeAt(x, y);
  }

  // ===================== 坐标、悬停信息与光标 =====================

  /** 屏幕坐标 → 未经边界限制的像素坐标 (可为负或大于 63) */
  private getPixelCoordsRaw(e: { clientX: number; clientY: number }): [number, number] {
    const rect = this.displayCanvas.getBoundingClientRect();
    return [Math.floor(((e.clientX - rect.left) * 64) / rect.width), Math.floor(((e.clientY - rect.top) * 64) / rect.height)];
  }

  /** 屏幕坐标 → 限制在 0~63 的像素坐标 */
  private getPixelCoords(e: { clientX: number; clientY: number }): [number, number] {
    const [rawX, rawY] = this.getPixelCoordsRaw(e);
    return [Math.max(0, Math.min(63, rawX)), Math.max(0, Math.min(63, rawY))];
  }

  /** 悬停像素 (未按下时) 或拖动中的最后像素；不在画布上时为 null */
  private pointerPixel(): [number, number] | null {
    if (this.hover) return [this.hover.x, this.hover.y];
    return this.lastX !== -1 && this.lastY !== -1 ? [this.lastX, this.lastY] : null;
  }

  private pointerInSelection(): boolean {
    const s = this.vm.session;
    const p = this.pointerPixel();
    return s.activeMode === 'pixel' && s.activeTool === 'select' && s.selection !== null && p !== null && isInRect(p[0], p[1], s.selection);
  }

  /** 解除滑杆、按钮等控件焦点，避免键盘焦点滞留导致全局快捷键受阻 */
  private releaseControlFocus(): void {
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && (active.tagName === 'INPUT' || active.tagName === 'BUTTON')) {
      active.blur();
    }
  }

  private updateHoverInfo(x: number, y: number): void {
    const { doc, session } = this.vm;

    if (this.moving) {
      const [dx, dy] = this.moving.offset;
      const isCopy = this.isCopyMode || this.wasCopyTriggered;
      const modeText = isCopy ? '📋 复制模式 (+Ctrl 原位保留)' : '✂️ 平移模式 (原位透明)';
      this.hoverInfoEl.innerHTML = `
        <span class="coord-tag">偏移: <b>ΔX:${dx >= 0 ? '+' + dx : dx} ΔY:${dy >= 0 ? '+' + dy : dy}</b></span>
        <span class="hover-text" style="color: ${isCopy ? '#10B981' : '#00E5FF'}; font-weight: 600;">${modeText}</span>
        <span style="opacity: 0.6; font-size: 11px;">[按住 Ctrl/Alt 切换复制]</span>
      `;
      return;
    }

    if (this.boxSelect) {
      const r = this.boxSelect.rect;
      this.hoverInfoEl.innerHTML = `
        <span class="coord-tag">框选: <b>(${r.x}, ${r.y})</b></span>
        <span class="hover-text" style="color: #C084FC; font-weight: 600;">尺寸: ${r.w}×${r.h}</span>
      `;
      return;
    }

    if (x < 0 || x >= 64 || y < 0 || y >= 64) {
      this.clearHoverInfo();
      return;
    }

    const offset = y * 64 + x;
    const colorIdx = this.vm.displayPixels()[offset];
    const isTrans = colorIdx === TRANSPARENT_INDEX;
    const colorHex = isTrans ? '透明' : doc.palette[colorIdx] || '#000000';
    const zoneMeta = ZONE_CONFIG[doc.semanticMask[offset] as SemanticZone] || ZONE_CONFIG[SemanticZone.Background];

    const selectionExtra = session.selection && isInRect(x, y, session.selection)
      ? `<span class="coord-tag" style="background: rgba(168, 85, 247, 0.25); color: #C084FC;">选区内 (拖拽平移)</span>`
      : '';
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
    this.hoverInfoEl.innerHTML = `<span>X: -- Y: --</span>`;
    this.hover = null;
    this.markDirty();
  }

  /** 按当前工具设置画布光标 (画笔 ✏️、橡皮 🧼、油漆桶 🪣、吸管 🧪、选区) */
  private updateCanvasCursor(e?: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; x?: number; y?: number }): void {
    const canvas = this.displayCanvas;
    const s = this.vm.session;
    const cursors = getToolCursors();

    if (s.activeMode === 'mask') {
      const tool = s.activeMaskTool;
      canvas.style.cursor =
        tool === 'eraser' ? cursors.eraser : tool === 'bucket' ? cursors.bucket : tool === 'box_select' ? 'crosshair' : cursors.pen;
      return;
    }

    if (e?.altKey || s.activeTool === 'eyedropper') {
      canvas.style.cursor = cursors.eyedropper;
      return;
    }

    if (s.activeTool === 'select') {
      const [px, py] = e?.x !== undefined && e?.y !== undefined ? [e.x, e.y] : this.pointerPixel() ?? [-1, -1];
      const isCopy = this.isCopyMode || this.wasCopyTriggered || e?.ctrlKey || e?.metaKey || e?.altKey;
      if (this.moving) {
        canvas.style.cursor = isCopy ? 'copy' : 'grabbing';
      } else if (s.selection && px !== -1 && py !== -1 && isInRect(px, py, s.selection)) {
        canvas.style.cursor = isCopy ? 'copy' : 'move';
      } else {
        canvas.style.cursor = 'crosshair';
      }
      return;
    }

    canvas.style.cursor = s.activeTool === 'bucket' ? cursors.bucket : s.activeTool === 'eraser' ? cursors.eraser : cursors.pen;
  }
}
