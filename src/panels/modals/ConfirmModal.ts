/**
 * 通用多按钮确认对话框
 */

import { PromptOptions } from '../../app/ports';

export class ConfirmModal {
  private container: HTMLElement;
  private overlayEl: HTMLElement | null = null;
  private isOpen = false;
  private currentOptions: PromptOptions | null = null;
  private previousActiveElement: HTMLElement | null = null;
  private abortController = new AbortController();
  private _isDisposed = false;

  get isDisposed(): boolean {
    return this._isDisposed;
  }

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
      this.dismiss();
    });

    this.overlayEl.addEventListener('click', (e) => {
      if (e.target === this.overlayEl) {
        this.dismiss();
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (!this.isOpen || !this.overlayEl) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.dismiss();
        } else if (e.key === 'Tab') {
          const buttons = Array.from(this.overlayEl.querySelectorAll('button')) as HTMLButtonElement[];
          if (buttons.length > 0) {
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (e.shiftKey) {
              if (document.activeElement === first || !this.overlayEl.contains(document.activeElement)) {
                e.preventDefault();
                last.focus();
              }
            } else {
              if (document.activeElement === last || !this.overlayEl.contains(document.activeElement)) {
                e.preventDefault();
                first.focus();
              }
            }
          }
        }
      }, { capture: true, signal: this.abortController.signal });
    }
  }

  public show(options: PromptOptions): void {
    if (this._isDisposed || !this.overlayEl) return;

    if (this.isOpen && this.currentOptions) {
      const prev = this.currentOptions;
      this.currentOptions = null;
      prev.onDismiss?.();
    }

    if (!this.isOpen && typeof document !== 'undefined') {
      this.previousActiveElement = (document.activeElement as HTMLElement) || null;
    }

    this.currentOptions = options;
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
          this.currentOptions = null;
          this.close();
          btnSpec.onClick();
        });
        actionsEl.appendChild(btn);
      });
    }

    this.overlayEl.style.display = 'flex';

    if (actionsEl) {
      const primaryBtn = (actionsEl.querySelector('.btn-primary') as HTMLElement) ||
        (actionsEl.querySelector('button') as HTMLElement);
      primaryBtn?.focus?.();
    }
  }

  public getIsOpen(): boolean {
    return this.isOpen;
  }

  public dismiss(): void {
    const opts = this.currentOptions;
    this.currentOptions = null;
    this.close();
    opts?.onDismiss?.();
  }

  public close(): void {
    if (!this.overlayEl) return;
    this.isOpen = false;
    this.overlayEl.style.display = 'none';
    if (this.previousActiveElement) {
      try {
        this.previousActiveElement.focus?.();
      } catch {
        // ignore
      }
      this.previousActiveElement = null;
    }
  }

  public dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;
    if (this.isOpen) {
      this.dismiss();
    }
    this.abortController.abort();
    this.overlayEl?.remove();
    this.overlayEl = null;
    this.previousActiveElement = null;
  }
}
