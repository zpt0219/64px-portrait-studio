/**
 * ImageGem Header Component
 * 顶部导航栏：品牌标识、工作台状态、文件上传触发、快速存盘、自动保存状态反馈
 * (已按需求移除顶部模式切换按钮，采用左-中-右 3 列直观布局)
 */

import { StudioState } from '../types';

export interface HeaderCallbacks {
  onFileSelect: (file: File) => void;
  onQuickSave: () => void;
  onExportZip: () => void;
  onReset: () => void;
}

export class Header {
  private container: HTMLElement;
  private callbacks: HeaderCallbacks;
  private fileInput: HTMLInputElement;
  private saveStatusEl: HTMLElement | null = null;

  constructor(container: HTMLElement, callbacks: HeaderCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.zip,.png,.jpg,.jpeg,.webp,image/*';
    this.fileInput.style.display = 'none';
    this.fileInput.addEventListener('change', this.handleFileChange.bind(this));
    document.body.appendChild(this.fileInput);

    this.render();
  }

  public triggerUpload(): void {
    this.fileInput.value = '';
    this.fileInput.click();
  }

  private handleFileChange(): void {
    if (this.fileInput.files && this.fileInput.files.length > 0) {
      const file = this.fileInput.files[0];
      this.callbacks.onFileSelect(file);
    }
  }

  private render(): void {
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
          <div class="header-status-pill">
            <span class="pill-dot"></span>
            <span class="pill-text">3 列并排工作台：左侧色板 · 中间画布 · 右侧遮罩</span>
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

    this.container.querySelector('#btn-import-file')?.addEventListener('click', () => this.triggerUpload());
    this.container.querySelector('#btn-quick-save')?.addEventListener('click', () => this.callbacks.onQuickSave());
    this.container.querySelector('#btn-export-zip')?.addEventListener('click', () => this.callbacks.onExportZip());
    this.container.querySelector('#btn-header-reset')?.addEventListener('click', () => this.callbacks.onReset());
  }

  public update(state: StudioState): void {
    const isLoaded = state.isLoaded;
    const btnSave = this.container.querySelector('#btn-quick-save') as HTMLButtonElement | null;
    const btnZip = this.container.querySelector('#btn-export-zip') as HTMLButtonElement | null;
    if (btnSave) btnSave.disabled = !isLoaded;
    if (btnZip) btnZip.disabled = !isLoaded;
  }

  public showSaveStatus(status: 'saving' | 'saved' | 'idle'): void {
    if (!this.saveStatusEl) return;
    const dot = this.saveStatusEl.querySelector('.indicator-dot') as HTMLElement;
    const text = this.saveStatusEl.querySelector('.indicator-text') as HTMLElement;

    if (status === 'saving') {
      dot.className = 'indicator-dot saving';
      text.innerText = '正在自动保存...';
    } else if (status === 'saved') {
      dot.className = 'indicator-dot saved';
      text.innerText = '已自动存盘';
    } else {
      dot.className = 'indicator-dot';
      text.innerText = '已就绪';
    }
  }
}
