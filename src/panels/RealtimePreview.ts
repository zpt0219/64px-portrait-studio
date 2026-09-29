/**
 * 画中画实时预览：1×~4× 原寸预览，可切换 GBA 液晶 / 棋盘格背景，可拖拽、可最小化
 */

import { drawIndexedPixels } from '../core/pixelRender';
import { ViewModel } from '../app/viewModel';
import { EditorContext } from '../app/editorContext';
import { Panel } from './Panel';

type PreviewBgMode = 'lcd' | 'checker';

export class RealtimePreview extends Panel {

  // DOM 元素
  private rootEl: HTMLElement | null = null;
  private headerEl: HTMLElement | null = null;
  private previewCanvas: HTMLCanvasElement | null = null;
  private previewCtx: CanvasRenderingContext2D | null = null;
  private scaleSlider: HTMLInputElement | null = null;
  private scaleBadge: HTMLElement | null = null;
  private dimensionBadge: HTMLElement | null = null;
  private stageWrapper: HTMLElement | null = null;

  // 状态
  private scale: number = 2; // 1, 2, 3, 4
  private isMinimized: boolean = false;
  private sourceCanvas: HTMLCanvasElement;
  private sourceCtx: CanvasRenderingContext2D;

  // 拖拽控制
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private initialLeft = 0;
  private initialTop = 0;

  constructor(private readonly container: HTMLElement, vm: ViewModel, private readonly ctx: EditorContext) {
    super(vm);
    this.sourceCanvas = document.createElement('canvas');
    this.sourceCanvas.width = 64;
    this.sourceCanvas.height = 64;
    this.sourceCtx = this.sourceCanvas.getContext('2d')!;

    this.build();
    this.setupEvents();
    this.markDirty();
  }

  onDocumentReplaced(): void {
    this.markDirty();
  }
  onPixelsChanged(): void {
    this.markDirty();
  }
  onMaskChanged(): void {
    this.markDirty();
  }
  onPaletteChanged(): void {
    this.markDirty();
  }
  onHairPresetChanged(): void {
    this.markDirty();
  }
  onSessionChanged(): void {
    this.markDirty();
  }
  onContextChanged(): void {
    this.markDirty();
  }

  private build(): void {
    const card = document.createElement('div');
    card.className = 'pip-preview-card';
    card.id = 'pip-preview-card';

    card.innerHTML = `
      <div class="pip-header" id="pip-header">
        <div class="pip-title">
          <span class="pip-icon">🖼️</span>
          <span class="pip-title-text">原寸实时预览</span>
          <span class="pip-dimension-badge" id="pip-dimension-badge">128×128</span>
        </div>
        <div class="pip-header-actions">
          <button class="pip-action-btn" id="pip-btn-minimize" title="最小化/还原 (折叠为便签)">_</button>
          <button class="pip-action-btn pip-btn-close" id="pip-btn-close" title="隐藏预览 (快捷键 V)">✕</button>
        </div>
      </div>

      <div class="pip-body" id="pip-body">
        <div class="pip-stage-wrapper pip-bg-lcd" id="pip-stage-wrapper">
          <canvas id="pip-display-canvas" width="128" height="128"></canvas>
          <div class="pip-empty-placeholder" id="pip-empty-placeholder" style="display: flex;">
            <span>等待导入头像...</span>
          </div>
        </div>

        <div class="pip-controls">
          <div class="pip-slider-row">
            <span class="pip-label">倍率:</span>
            <input type="range" class="pip-range-slider" id="pip-scale-slider" min="1" max="4" step="1" value="2">
            <span class="pip-scale-badge" id="pip-scale-badge">2×</span>
          </div>

          <div class="pip-bg-row">
            <span class="pip-label">背景:</span>
            <div class="pip-bg-chips">
              <button class="pip-bg-btn active" data-bg="lcd" title="GBA 液晶色调">🎮 GBA</button>
              <button class="pip-bg-btn" data-bg="checker" title="透明棋盘格">🏁 棋盘</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 最小化折叠形态胶囊 -->
      <div class="pip-minimized-pill" id="pip-minimized-pill" style="display: none;">
        <span class="pill-icon">🖼️</span>
        <span class="pill-text" id="pip-pill-text">2× (128px) 预览</span>
        <button class="pill-restore-btn" id="pip-btn-restore" title="展开预览窗">⤢</button>
      </div>
    `;

    const initialWidth = Math.max(220, 64 * this.scale + 52);
    card.style.width = `${initialWidth}px`;
    card.style.display = 'none'; // 未载入图像时默认隐藏

    this.container.appendChild(card);
    this.rootEl = card;
    this.headerEl = card.querySelector('#pip-header');
    this.previewCanvas = card.querySelector('#pip-display-canvas');
    this.previewCtx = this.previewCanvas ? this.previewCanvas.getContext('2d') : null;
    this.scaleSlider = card.querySelector('#pip-scale-slider');
    this.scaleBadge = card.querySelector('#pip-scale-badge');
    this.dimensionBadge = card.querySelector('#pip-dimension-badge');
    this.stageWrapper = card.querySelector('#pip-stage-wrapper');
  }

  private setupEvents(): void {
    if (!this.rootEl) return;

    // 1. 倍率滑杆控制 (1~4x)
    this.scaleSlider?.addEventListener('input', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      this.setScale(val);
    });
    this.scaleSlider?.addEventListener('change', () => {
      this.scaleSlider?.blur();
    });

    // 2. 背景切换
    const bgBtns = this.rootEl.querySelectorAll('.pip-bg-btn');
    bgBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        bgBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.getAttribute('data-bg') as PreviewBgMode;
        this.setBgMode(mode);
      });
    });

    // 3. 最小化与还原
    const minimizeBtn = this.rootEl.querySelector('#pip-btn-minimize');
    const restoreBtn = this.rootEl.querySelector('#pip-btn-restore');
    minimizeBtn?.addEventListener('click', () => this.toggleMinimize());
    restoreBtn?.addEventListener('click', () => this.toggleMinimize());

    // 4. 关闭 / 隐藏
    const closeBtn = this.rootEl.querySelector('#pip-btn-close');
    closeBtn?.addEventListener('click', () => this.ctx.setPreviewVisible(false));

    // 5. 窗口拖拽交互 (仅在 header 触发)
    this.headerEl?.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('.pip-action-btn')) return;
      if (!this.rootEl) return;

      this.isDragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;

      const rect = this.rootEl.getBoundingClientRect();
      const parentRect = this.container.getBoundingClientRect();

      this.initialLeft = rect.left - parentRect.left;
      this.initialTop = rect.top - parentRect.top;

      this.rootEl.classList.add('dragging');
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging || !this.rootEl) return;

      const deltaX = e.clientX - this.dragStartX;
      const deltaY = e.clientY - this.dragStartY;

      const parentRect = this.container.getBoundingClientRect();
      const cardRect = this.rootEl.getBoundingClientRect();

      let newLeft = this.initialLeft + deltaX;
      let newTop = this.initialTop + deltaY;

      // 视窗边界吸附与限制 (保留顶部 46px 避免遮挡工具栏)
      const minTop = 46;
      const maxLeft = parentRect.width - cardRect.width - 10;
      const maxTop = parentRect.height - cardRect.height - 10;

      newLeft = Math.max(10, Math.min(maxLeft, newLeft));
      newTop = Math.max(minTop, Math.min(maxTop, newTop));

      this.rootEl.style.left = `${newLeft}px`;
      this.rootEl.style.top = `${newTop}px`;
      this.rootEl.style.right = 'auto';
      this.rootEl.style.bottom = 'auto';
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.rootEl?.classList.remove('dragging');
      }
    });
  }

  public setScale(scale: number): void {
    this.scale = Math.max(1, Math.min(4, scale));

    if (this.scaleSlider) {
      this.scaleSlider.value = this.scale.toString();
    }
    if (this.scaleBadge) {
      this.scaleBadge.textContent = `${this.scale}×`;
    }
    const pxSize = 64 * this.scale;
    if (this.dimensionBadge) {
      this.dimensionBadge.textContent = `${pxSize}×${pxSize}`;
    }

    const pillText = this.rootEl?.querySelector('#pip-pill-text');
    if (pillText) {
      pillText.textContent = `${this.scale}× (${pxSize}px) 预览`;
    }

    // 动态调整卡片整体宽度，确保 1x~4x 尺寸下内部舞台与画布完整展示，绝不裁切
    if (this.rootEl && !this.isMinimized) {
      const minCardWidth = 220;
      const neededWidth = Math.max(minCardWidth, pxSize + 52);
      this.rootEl.style.width = `${neededWidth}px`;

      // 若展开后右侧超出视窗边界，向左平移自适应
      if (this.container) {
        const parentRect = this.container.getBoundingClientRect();
        const currentRect = this.rootEl.getBoundingClientRect();
        if (currentRect.right > parentRect.right - 10) {
          const newLeft = Math.max(10, parentRect.width - neededWidth - 10);
          this.rootEl.style.left = `${newLeft}px`;
          this.rootEl.style.right = 'auto';
        }
      }
    }

    this.redrawCanvas();
  }

  private setBgMode(mode: PreviewBgMode): void {
    if (!this.stageWrapper) return;

    this.stageWrapper.classList.remove('pip-bg-lcd', 'pip-bg-checker');
    this.stageWrapper.classList.add(`pip-bg-${mode}`);
  }

  public toggleMinimize(): void {
    this.isMinimized = !this.isMinimized;
    if (!this.rootEl) return;

    const bodyEl = this.rootEl.querySelector('#pip-body') as HTMLElement;
    const headerEl = this.rootEl.querySelector('#pip-header') as HTMLElement;
    const pillEl = this.rootEl.querySelector('#pip-minimized-pill') as HTMLElement;

    if (this.isMinimized) {
      this.rootEl.classList.add('minimized');
      this.rootEl.style.width = 'auto';
      if (bodyEl) bodyEl.style.display = 'none';
      if (headerEl) headerEl.style.display = 'none';
      if (pillEl) pillEl.style.display = 'flex';
    } else {
      this.rootEl.classList.remove('minimized');
      const pxSize = 64 * this.scale;
      const neededWidth = Math.max(220, pxSize + 52);
      this.rootEl.style.width = `${neededWidth}px`;
      if (bodyEl) bodyEl.style.display = 'block';
      if (headerEl) headerEl.style.display = 'flex';
      if (pillEl) pillEl.style.display = 'none';
      this.redrawCanvas();
    }
  }

  /** 与主画布显示同一份像素 (有发色草稿时为预览像素) */
  render(): void {
    if (!this.rootEl) return;
    const isLoaded = this.vm.session.isLoaded;
    this.rootEl.style.display = isLoaded && this.ctx.previewVisible ? 'block' : 'none';
    if (!isLoaded) return;

    const placeholder = this.rootEl.querySelector('#pip-empty-placeholder') as HTMLElement;
    if (placeholder) placeholder.style.display = 'none';
    if (this.previewCanvas) this.previewCanvas.style.display = 'block';

    drawIndexedPixels(this.sourceCtx, this.vm.displayPixels(), this.vm.doc.palette);
    this.redrawCanvas();
  }

  private redrawCanvas(): void {
    if (!this.previewCanvas || !this.previewCtx || !this.vm.session.isLoaded) return;
    if (this.isMinimized || !this.ctx.previewVisible) return;

    const targetSize = 64 * this.scale;

    if (this.previewCanvas.width !== targetSize || this.previewCanvas.height !== targetSize) {
      this.previewCanvas.width = targetSize;
      this.previewCanvas.height = targetSize;
      this.previewCanvas.style.width = `${targetSize}px`;
      this.previewCanvas.style.height = `${targetSize}px`;
    }

    // 禁用平滑，保持像素锐利
    this.previewCtx.imageSmoothingEnabled = false;
    this.previewCtx.clearRect(0, 0, targetSize, targetSize);

    this.previewCtx.drawImage(
      this.sourceCanvas,
      0,
      0,
      64,
      64,
      0,
      0,
      targetSize,
      targetSize
    );
  }
}
