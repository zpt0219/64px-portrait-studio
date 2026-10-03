/**
 * 顶栏：品牌标识、导入、导出 PNG / 工程 ZIP、清空、自动保存状态
 */

import { SaveStatus } from '../command/events';
import { ViewModel } from '../app/viewModel';
import { Panel } from './Panel';

export class Header extends Panel {
  private fileInput: HTMLInputElement;
  private saveStatusEl: HTMLElement | null = null;

  private btnModePixel: HTMLButtonElement | null = null;
  private btnModeMask: HTMLButtonElement | null = null;
  private btnSave: HTMLButtonElement | null = null;
  private btnZip: HTMLButtonElement | null = null;

  constructor(private readonly container: HTMLElement, vm: ViewModel, private readonly onFileSelect: (file: File) => void) {
    super(vm);
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.zip,.png,.jpg,.jpeg,.webp,image/*';
    this.fileInput.style.display = 'none';
    this.fileInput.addEventListener('change', this.handleFileChange.bind(this));
    document.body.appendChild(this.fileInput);

    this.build();
    this.markDirty();
  }

  onSessionChanged(): void {
    this.markDirty();
  }

  public triggerUpload(): void {
    this.fileInput.value = '';
    this.fileInput.click();
  }

  private handleFileChange(): void {
    if (this.fileInput.files && this.fileInput.files.length > 0) {
      const file = this.fileInput.files[0];
      this.onFileSelect(file);
    }
  }

  private build(): void {
    this.container.innerHTML = `
      <header class="app-header">
        <div class="header-brand">
          <div class="brand-logo">💎</div>
          <div class="brand-info">
            <div class="brand-title">64px Portrait Studio</div>
            <div class="brand-tag">36 色像素头像工坊</div>
          </div>
        </div>

        <div class="header-center">
          <div class="mode-segmented-control" id="header-mode-switcher" role="tablist">
            <button type="button" class="mode-segment-btn active" id="btn-mode-pixel" data-mode="pixel" title="切换至【像素修图模式】(快捷键: Q) - 选用 36 色色板、画笔、橡皮、油漆桶、吸管、选区">
              <span class="segment-icon">🎨</span>
              <span class="segment-label">像素修图</span>
              <kbd class="segment-kbd">Q</kbd>
            </button>
            <button type="button" class="mode-segment-btn" id="btn-mode-mask" data-mode="mask" title="切换至【语义遮罩模式】(快捷键: W) - 编辑 5 分区语义遮罩、智能框选匹配色、发色置换">
              <span class="segment-icon">🎭</span>
              <span class="segment-label">语义遮罩</span>
              <kbd class="segment-kbd">W</kbd>
            </button>
          </div>
        </div>

        <div class="header-actions">
          <div class="auto-save-indicator" id="auto-save-status">
            <span class="indicator-dot"></span>
            <span class="indicator-text">已就绪</span>
          </div>

          <button class="btn btn-outline" id="btn-import-file" title="支持导入工程 ZIP (完整恢复历史进度与遮罩) 或任意图片 PNG/JPG/WebP (作为新项目载入并量化为 36 色)">
            <span class="btn-icon">📁</span> 导入图片 / 工程
          </button>

          <button class="btn btn-primary" id="btn-quick-save" title="导出纯净 64×64 像素头像 PNG (极简无损体积，约 400 字节)">
            <span class="btn-icon">💾</span> 导出 PNG
          </button>

          <button class="btn btn-secondary" id="btn-export-zip" title="打包导出全部工程成果：工程PNG、1x/4x/8x全尺寸渲染图、5色语义遮罩、独立图层遮罩、工程JSON及色板">
            <span class="btn-icon">📦</span> 导出工程 ZIP
          </button>

          <button class="btn btn-ghost" id="btn-header-reset" title="清空画布与本地暂存缓存">
            <span class="btn-icon">↺</span>
          </button>
        </div>
      </header>
    `;

    this.saveStatusEl = this.container.querySelector('#auto-save-status');
    this.btnSave = this.container.querySelector('#btn-quick-save');
    this.btnZip = this.container.querySelector('#btn-export-zip');
    this.btnModePixel = this.container.querySelector('#btn-mode-pixel');
    this.btnModeMask = this.container.querySelector('#btn-mode-mask');

    this.btnModePixel?.addEventListener('click', () => this.vm.setMode('pixel'));
    this.btnModeMask?.addEventListener('click', () => this.vm.setMode('mask'));

    this.container.querySelector('#btn-import-file')?.addEventListener('click', () => this.triggerUpload());
    this.btnSave?.addEventListener('click', () => this.vm.exportPng());
    this.btnZip?.addEventListener('click', () => this.vm.exportZip());
    this.container.querySelector('#btn-header-reset')?.addEventListener('click', () => this.vm.requestReset());
  }

  render(): void {
    const isLoaded = this.vm.session.isLoaded;
    const isMask = this.vm.session.activeMode === 'mask';

    if (this.btnSave) this.btnSave.disabled = !isLoaded;
    if (this.btnZip) this.btnZip.disabled = !isLoaded;

    if (this.btnModePixel) this.btnModePixel.classList.toggle('active', !isMask);
    if (this.btnModeMask) this.btnModeMask.classList.toggle('active', isMask);
  }

  onSaveStatus(status: SaveStatus): void {
    if (!this.saveStatusEl) return;
    const dot = this.saveStatusEl.querySelector('.indicator-dot') as HTMLElement;
    const text = this.saveStatusEl.querySelector('.indicator-text') as HTMLElement;

    if (status === 'saving') {
      dot.className = 'indicator-dot saving';
      text.innerText = '正在自动保存...';
    } else if (status === 'saved') {
      dot.className = 'indicator-dot saved';
      text.innerText = '已自动存盘';
    } else if (status === 'error') {
      dot.className = 'indicator-dot error';
      text.innerText = '自动保存失败';
    }
  }

  protected onDispose(): void {
    this.fileInput.remove();
    this.container.innerHTML = '';
  }
}
