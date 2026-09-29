/**
 * ImageGem ConfirmModal Component
 * 通用优雅的模态确认对话框组件，用于模式切换、导出拦截等确认场景
 */

interface ConfirmModalButton {
  label: string;
  className?: string; // e.g. 'btn-primary', 'btn-secondary', 'btn-outline', 'btn-ghost'
  onClick: () => void;
}

interface ConfirmModalOptions {
  icon?: string;
  title: string;
  message: string;
  subMessage?: string;
  buttons: ConfirmModalButton[];
}

export class ConfirmModal {
  private container: HTMLElement;
  private overlayEl: HTMLElement | null = null;
  private isOpen = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
    this.setupEvents();
  }

  private render(): void {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-modal-overlay';
    overlay.id = 'confirm-modal-overlay';
    overlay.style.display = 'none';

    overlay.innerHTML = `
      <div class="confirm-modal-card" role="dialog" aria-modal="true">
        <div class="confirm-modal-header">
          <div class="confirm-modal-title-group">
            <span class="confirm-modal-icon" id="confirm-modal-icon">🎨</span>
            <span class="confirm-modal-title" id="confirm-modal-title">确认操作</span>
          </div>
          <button class="confirm-modal-close-btn" id="confirm-modal-close" title="关闭 (Esc)">✕</button>
        </div>
        <div class="confirm-modal-body">
          <p class="confirm-modal-message" id="confirm-modal-message"></p>
          <p class="confirm-modal-submessage" id="confirm-modal-submessage" style="display:none;"></p>
        </div>
        <div class="confirm-modal-footer" id="confirm-modal-actions"></div>
      </div>
    `;

    this.container.appendChild(overlay);
    this.overlayEl = overlay;
  }

  private setupEvents(): void {
    if (!this.overlayEl) return;

    this.overlayEl.querySelector('#confirm-modal-close')?.addEventListener('click', () => {
      this.close();
    });

    this.overlayEl.addEventListener('click', (e) => {
      if (e.target === this.overlayEl) {
        this.close();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });
  }

  public show(options: ConfirmModalOptions): void {
    if (!this.overlayEl) return;

    this.isOpen = true;

    const iconEl = this.overlayEl.querySelector('#confirm-modal-icon') as HTMLElement;
    const titleEl = this.overlayEl.querySelector('#confirm-modal-title') as HTMLElement;
    const msgEl = this.overlayEl.querySelector('#confirm-modal-message') as HTMLElement;
    const subMsgEl = this.overlayEl.querySelector('#confirm-modal-submessage') as HTMLElement;
    const actionsEl = this.overlayEl.querySelector('#confirm-modal-actions') as HTMLElement;

    if (iconEl) iconEl.textContent = options.icon || '🎨';
    if (titleEl) titleEl.textContent = options.title;
    if (msgEl) msgEl.textContent = options.message;

    if (subMsgEl) {
      if (options.subMessage) {
        subMsgEl.textContent = options.subMessage;
        subMsgEl.style.display = 'block';
      } else {
        subMsgEl.style.display = 'none';
      }
    }

    if (actionsEl) {
      actionsEl.innerHTML = '';
      options.buttons.forEach((btnSpec, idx) => {
        const btn = document.createElement('button');
        btn.className = `btn ${btnSpec.className || (idx === 0 ? 'btn-primary' : 'btn-outline')}`;
        btn.textContent = btnSpec.label;
        btn.addEventListener('click', () => {
          this.close();
          btnSpec.onClick();
        });
        actionsEl.appendChild(btn);
      });
    }

    this.overlayEl.style.display = 'flex';
  }

  public close(): void {
    if (!this.overlayEl) return;
    this.isOpen = false;
    this.overlayEl.style.display = 'none';
  }
}
