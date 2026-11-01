/**
 * 多标签页栏 (TabBar)：
 * 显示当前工作区的所有图片标签页、缩略图、激活高亮、关闭按钮、重命名与新建入口。
 */

import { Panel } from './Panel';
import { ViewModel } from '../app/viewModel';
import { drawIndexedPixels } from '../app/browser/pixelCanvas';

export class TabBar extends Panel {
  private scrollAreaEl!: HTMLElement;
  private btnAddEl!: HTMLElement;
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D;
  private editingTabId: string | null = null;

  constructor(private readonly container: HTMLElement, vm: ViewModel) {
    super(vm);
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCanvas.width = 64;
    this.offscreenCanvas.height = 64;
    this.offscreenCtx = this.offscreenCanvas.getContext('2d')!;

    this.build();
    this.markDirty();
  }

  onTabsChanged(): void {
    this.markDirty();
  }

  onDocumentReplaced(): void {
    this.markDirty();
  }

  onPixelsChanged(): void {
    this.markDirty();
  }

  onPaletteChanged(): void {
    this.markDirty();
  }

  private build(): void {
    this.container.innerHTML = `
      <div class="app-tabbar" id="app-tabbar">
        <div class="tabbar-scroll-area" id="tabbar-scroll-area"></div>
        <div class="tabbar-actions">
          <button type="button" class="btn-ghost tabbar-btn-add" id="btn-tab-add" title="新建空白标签页 (Alt+N)">＋</button>
        </div>
      </div>
    `;

    this.scrollAreaEl = this.container.querySelector('#tabbar-scroll-area')!;
    this.btnAddEl = this.container.querySelector('#btn-tab-add')!;

    this.btnAddEl.addEventListener('click', () => {
      this.vm.newBlankProject(false);
    });

    // 横向滚轮滚动
    this.scrollAreaEl.addEventListener('wheel', (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        this.scrollAreaEl.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  }

  render(): void {
    if (this._isDisposed) return;
    const tabs = this.vm.getTabs();

    this.scrollAreaEl.innerHTML = '';

    for (const tab of tabs) {
      const isEditing = this.editingTabId === tab.id;
      const tabEl = document.createElement('div');
      tabEl.className = `tab-item ${tab.isActive ? 'active' : ''}`;
      tabEl.dataset.tabId = tab.id;
      tabEl.title = `${tab.name} (${tab.isLoaded ? '已载入' : '空白'}) - 双击重命名，中键关闭`;

      // 缩略图 Canvas
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.className = 'tab-thumb';
      thumbCanvas.width = 16;
      thumbCanvas.height = 16;
      this.renderThumbnail(thumbCanvas, tab.id, tab.isActive);

      // 标题文本
      const titleEl = document.createElement('span');
      titleEl.className = `tab-title ${isEditing ? 'editing' : ''}`;
      titleEl.textContent = tab.name;
      titleEl.dataset.tabId = tab.id;

      if (isEditing) {
        titleEl.contentEditable = 'true';
        setTimeout(() => {
          titleEl.focus();
          const range = document.createRange();
          range.selectNodeContents(titleEl);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }, 0);

        const finishEdit = () => {
          if (this.editingTabId !== tab.id) return;
          this.editingTabId = null;
          const newName = titleEl.textContent?.trim() || tab.name;
          this.vm.renameTab(tab.id, newName);
          this.markDirty();
        };

        titleEl.addEventListener('blur', finishEdit);
        titleEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            titleEl.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            this.editingTabId = null;
            this.markDirty();
          }
        });
      } else {
        // 双击开启重命名
        titleEl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          this.editingTabId = tab.id;
          this.markDirty();
        });
      }

      // 关闭按钮
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'tab-close-btn';
      closeBtn.dataset.tabId = tab.id;
      closeBtn.title = '关闭标签页 (Alt+W)';
      closeBtn.innerHTML = '✕';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.vm.closeTab(tab.id);
      });

      // 单击切换
      tabEl.addEventListener('click', () => {
        if (!tab.isActive && !isEditing) {
          this.vm.switchTab(tab.id);
        }
      });

      // 鼠标中键直接关闭
      tabEl.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          this.vm.closeTab(tab.id);
        }
      });

      tabEl.appendChild(thumbCanvas);
      tabEl.appendChild(titleEl);
      tabEl.appendChild(closeBtn);
      this.scrollAreaEl.appendChild(tabEl);
    }
  }

  private renderThumbnail(thumbCanvas: HTMLCanvasElement, tabId: string, isActive: boolean): void {
    const ctx = thumbCanvas.getContext('2d');
    if (!ctx) return;

    let pixels: Uint8Array;
    let palette: string[];

    if (isActive) {
      pixels = this.vm.doc.pixelIndices;
      palette = this.vm.doc.palette;
    } else {
      const tab = this.vm.tabs.getActiveTabId() === tabId
        ? this.vm.tabs.getActiveTab()
        : this.vm.tabs.getAllTabsForStorage().find((t) => t.id === tabId);
      if (!tab) return;
      pixels = tab.doc.pixelIndices;
      palette = tab.doc.palette;
    }

    this.offscreenCtx.clearRect(0, 0, 64, 64);
    drawIndexedPixels(this.offscreenCtx, pixels, palette);

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 16, 16);
    ctx.drawImage(this.offscreenCanvas, 0, 0, 16, 16);
  }

  protected onDispose(): void {
    this.container.innerHTML = '';
  }
}
